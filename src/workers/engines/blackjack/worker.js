'use strict';

/**
 * Blackjack engine worker.
 *
 * Runs in its own thread. Owns:
 *   - Per-channel game state (`tables`).
 *   - Per-channel idle and between-hands timers.
 *   - All synchronous game logic (deal, hit, stay, surrender, resolve).
 *   - Brokered DB calls for balance checks, bet placement, and payouts.
 *
 * Does NOT own: Discord interactions, message edits, or button collectors.
 * The main-process Discord adapter (src/blackjackAdapter.js) translates
 * the events emitted from this worker into Discord side effects.
 *
 * Render contract returned to the adapter:
 *   { content: string, controls: { mode: 'play' | 'pause' | 'closed',
 *                                  anyPlaying?: boolean,
 *                                  anySurrenderable?: boolean } }
 */

const { registerCommand, emitEvent, dbCall } = require('../../runtime');
const E = require('./engine');

const tables = new Map();
const idleTimers = new Map();
const betweenHandsTimers = new Map();

let settings = { ...E.DEFAULTS };

// ---------------------------------------------------------------------------
// Timer helpers
// ---------------------------------------------------------------------------

function clearIdleTimer(channelId) {
  const t = idleTimers.get(channelId);
  if (t) {
    clearTimeout(t);
    idleTimers.delete(channelId);
  }
}

function startIdleTimer(channelId) {
  clearIdleTimer(channelId);
  const t = setTimeout(() => {
    idleTimers.delete(channelId);
    void onIdle(channelId);
  }, settings.idleTimeoutMs);
  idleTimers.set(channelId, t);
}

function clearBetweenHandsTimer(channelId) {
  const t = betweenHandsTimers.get(channelId);
  if (t) {
    clearTimeout(t);
    betweenHandsTimers.delete(channelId);
  }
}

function startBetweenHandsTimer(channelId) {
  clearBetweenHandsTimer(channelId);
  const t = setTimeout(() => {
    betweenHandsTimers.delete(channelId);
    void dealNewHand(channelId);
  }, settings.betweenHandsMs);
  betweenHandsTimers.set(channelId, t);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderControls(table, mode) {
  if (mode === 'closed') return { mode: 'closed' };
  if (mode === 'pause') return { mode: 'pause' };
  return {
    mode: 'play',
    anyPlaying: E.hasActivePlayers(table),
    anySurrenderable: [...table.players.values()].some(E.canPlayerSurrender),
  };
}

function renderHeader(mode) {
  switch (mode) {
    case 'play':         return '🃏 **Blackjack Table**';
    case 'newhand':      return '🃏 **Blackjack Table** — New hand dealt!';
    case 'finalresults': return `🃏 **Blackjack — Results** *(next hand in ${settings.betweenHandsMs / 1000}s…)*`;
    case 'closed':       return '🃏 **Blackjack Table — Closed**';
    case 'pause':        return '🃏 **Blackjack Table**';
    default:             return '🃏 **Blackjack Table**';
  }
}

function buildRender(table, mode) {
  const hideDealer = (mode === 'play' || mode === 'newhand');
  const body = `\`\`\`\n${E.renderTableContent(table, hideDealer)}\n\`\`\``;
  const content = `${renderHeader(mode)}\n${body}`;
  let controlsMode = 'play';
  if (mode === 'closed') controlsMode = 'closed';
  else if (mode === 'finalresults' || mode === 'pause') controlsMode = 'pause';
  return { content, controls: renderControls(table, controlsMode) };
}

// ---------------------------------------------------------------------------
// Lifecycle helpers
// ---------------------------------------------------------------------------

function tearDownTable(channelId, content) {
  clearIdleTimer(channelId);
  clearBetweenHandsTimer(channelId);
  tables.delete(channelId);
  emitEvent('tableClosed', {
    channelId,
    content: content ?? '🃏 **Blackjack Table — Closed**',
    controls: { mode: 'closed' },
  });
}

async function onIdle(channelId) {
  const table = tables.get(channelId);
  if (!table || table.resolving) return;
  for (const player of table.players.values()) {
    if (player.status === 'playing') player.status = 'standing';
  }
  await resolveAndPause(channelId);
}

async function payPayouts(channelId, payouts) {
  for (const p of payouts) {
    try {
      await dbCall('payCasinoPayout', {
        userId: p.userId,
        amount: p.amount,
        gameType: 'blackjack',
      });
    } catch (err) {
      emitEvent('payoutFailed', {
        channelId,
        userId: p.userId,
        amount: p.amount,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
}

async function resolveAndPause(channelId) {
  const table = tables.get(channelId);
  if (!table || table.resolving) return;
  table.resolving = true;
  clearIdleTimer(channelId);

  const { payouts } = E.resolveHand(table, settings, () => E.drawCard(table, settings));
  await payPayouts(channelId, payouts);

  const render = buildRender(table, 'finalresults');
  emitEvent('render', { channelId, action: 'finalresults', ...render });

  startBetweenHandsTimer(channelId);
}

async function dealNewHand(channelId) {
  clearBetweenHandsTimer(channelId);
  const table = tables.get(channelId);
  if (!table) return;

  const kicked = [];
  for (const [uid, player] of [...table.players]) {
    const bet = player.nextBet ?? player.bet;
    let funded = false;
    try {
      await dbCall('ensureAccount', { userId: uid, username: player.username });
      const balance = await dbCall('getBalance', { userId: uid });
      if (balance >= bet) {
        const placed = await dbCall('placeCasinoBet', {
          userId: uid,
          username: player.username,
          amount: bet,
          gameType: 'blackjack',
        });
        funded = Boolean(placed && placed.success);
      }
    } catch {
      funded = false;
    }

    if (!funded) {
      kicked.push(player.username);
      table.players.delete(uid);
      continue;
    }

    player.hand = [E.drawCard(table, settings), E.drawCard(table, settings)];
    player.bet = bet;
    player.status = E.isNaturalBlackjack(player.hand) ? 'blackjack' : 'playing';
    player.result = null;
    player.surrendered = false;
  }

  if (table.players.size === 0) {
    const reason = kicked.length
      ? `(${kicked.join(', ')} couldn't cover bet)`
      : '(no players)';
    tearDownTable(channelId, `🃏 **Blackjack Table — Closed** ${reason}`);
    return;
  }

  table.dealerHand = [E.drawCard(table, settings), E.drawCard(table, settings)];
  table.resolving = false;

  const render = buildRender(table, 'newhand');
  if (kicked.length) {
    render.content = render.content.replace(
      '— New hand dealt!',
      `— New hand dealt!\n*${kicked.join(', ')} removed (insufficient balance)*`,
    );
  }
  emitEvent('render', { channelId, action: 'newhand', ...render });

  if (E.allPlayersDone(table)) {
    await resolveAndPause(channelId);
  } else {
    startIdleTimer(channelId);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

registerCommand('setSettings', async (next) => {
  if (next && typeof next === 'object') {
    const merged = { ...settings };
    for (const [k, v] of Object.entries(next)) {
      if (typeof v === 'number' && Number.isFinite(v)) merged[k] = v;
    }
    settings = merged;
  }
  return { settings };
});

registerCommand('play', async ({ channelId, userId, username, bet } = {}) => {
  if (typeof channelId !== 'string' || typeof userId !== 'string') {
    return { ok: false, reason: 'bad_args' };
  }
  if (!Number.isInteger(bet) || bet <= 0) {
    return { ok: false, reason: 'bad_args' };
  }

  let table = tables.get(channelId);
  if (table && table.resolving) {
    return { ok: false, reason: 'between_hands' };
  }
  if (table && table.players.has(userId)) {
    return { ok: false, reason: 'already_playing' };
  }
  if (table && table.players.size >= settings.maxPlayers) {
    return { ok: false, reason: 'full', max: settings.maxPlayers };
  }

  await dbCall('ensureAccount', { userId, username });
  const balance = await dbCall('getBalance', { userId });
  if (balance < bet) {
    return { ok: false, reason: 'insufficient', balance, bet };
  }
  const placed = await dbCall('placeCasinoBet', {
    userId, username, amount: bet, gameType: 'blackjack',
  });
  if (!placed || !placed.success) {
    return { ok: false, reason: 'bet_failed', error: placed && placed.error };
  }

  const isNew = !table;
  if (!table) {
    table = E.makeTable(channelId);
    tables.set(channelId, table);
    table.dealerHand = [E.drawCard(table, settings), E.drawCard(table, settings)];
  }

  const hand = [E.drawCard(table, settings), E.drawCard(table, settings)];
  table.players.set(userId, {
    userId,
    username,
    hand,
    bet,
    nextBet: bet,
    status: E.isNaturalBlackjack(hand) ? 'blackjack' : 'playing',
    result: null,
    surrendered: false,
  });

  startIdleTimer(channelId);
  const render = buildRender(table, 'play');

  if (E.allPlayersDone(table)) {
    setImmediate(() => { void resolveAndPause(channelId); });
    return { ok: true, isNew, willResolve: true, ...render };
  }

  return { ok: true, isNew, ...render };
});

function _commonAct(channelId, userId, mutate) {
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  if (table.resolving) return { ok: false, reason: 'resolving' };
  const player = table.players.get(userId);
  if (!player || player.status !== 'playing') {
    return { ok: false, reason: 'not_playing' };
  }
  const guard = mutate(table, player);
  if (guard && guard.error) return guard.error;

  startIdleTimer(channelId);
  const render = buildRender(table, 'play');
  if (E.allPlayersDone(table)) {
    setImmediate(() => { void resolveAndPause(channelId); });
    return { ok: true, willResolve: true, ...render };
  }
  return { ok: true, ...render };
}

registerCommand('hit', async ({ channelId, userId } = {}) => {
  return _commonAct(channelId, userId, (table, player) => {
    player.hand.push(E.drawCard(table, settings));
    const v = E.handValue(player.hand);
    if (v > 21) player.status = 'bust';
    else if (v === 21) player.status = 'standing';
  });
});

registerCommand('stay', async ({ channelId, userId } = {}) => {
  return _commonAct(channelId, userId, (_table, player) => {
    player.status = 'standing';
  });
});

registerCommand('surrender', async ({ channelId, userId } = {}) => {
  return _commonAct(channelId, userId, (_table, player) => {
    if (!E.canPlayerSurrender(player)) {
      return { error: { ok: false, reason: 'cannot_surrender' } };
    }
    player.status = 'surrendered';
    return null;
  });
});

registerCommand('leave', async ({ channelId, userId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  const player = table.players.get(userId);
  if (!player) return { ok: false, reason: 'not_playing' };

  const duringHand = !table.resolving;
  const lostBet = player.bet;
  table.players.delete(userId);

  if (table.players.size === 0) {
    tearDownTable(channelId, '🃏 **Blackjack Table — Everyone left.**');
    return { ok: true, duringHand, lostBet, closed: true };
  }

  if (!table.resolving && E.allPlayersDone(table)) {
    setImmediate(() => { void resolveAndPause(channelId); });
    return { ok: true, duringHand, lostBet, willResolve: true };
  }

  if (table.resolving) {
    return { ok: true, duringHand, lostBet };
  }

  const render = buildRender(table, 'play');
  return { ok: true, duringHand, lostBet, ...render };
});

registerCommand('setBet', async ({ channelId, userId, amount } = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'bad_args' };
  }
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  const player = table.players.get(userId);
  if (!player) return { ok: false, reason: 'not_at_table' };
  player.nextBet = amount;
  return { ok: true, amount };
});

registerCommand('reset', async ({ channelId } = {}) => {
  if (!tables.has(channelId)) return { ok: true };
  tearDownTable(channelId, '🃏 **Blackjack Table — reset.**');
  return { ok: true };
});

registerCommand('debugSnapshot', async ({ channelId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return null;
  return {
    channelId: table.channelId,
    resolving: table.resolving,
    dealerHand: table.dealerHand,
    players: [...table.players.values()].map((p) => ({
      userId: p.userId,
      username: p.username,
      bet: p.bet,
      nextBet: p.nextBet,
      status: p.status,
      handValue: E.handValue(p.hand),
      result: p.result,
    })),
    shoeRemaining: table.shoe.cards.length,
  };
});
