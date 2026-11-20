'use strict';

/**
 * Texas Hold'em engine worker.
 *
 * Owns per-channel table state, deck, betting rounds, turn timers,
 * CPU autopilot, and the between-hand timer.
 *
 * Lifecycle events emitted to the adapter:
 *   - `render`        { channelId, content, buttonState }
 *       Adapter should edit the current table message + buttons.
 *   - `tableClosed`   { channelId, content }
 *       Adapter should edit the table message with disabled buttons
 *       and drop its session.
 *   - `payoutFailed`  { channelId, userId, amount, error }
 */

const { registerCommand, emitEvent, dbCall } = require('../../runtime');
const E = require('./engine');

let settings = { ...E.DEFAULTS };

const tables = new Map();
const turnTimers = new Map();
const nextHandTimers = new Map();
const WEB_PRESENCE_TIMEOUT_MS = 45 * 1000;
// Tables that have been opened by `play` but are waiting for the adapter to
// signal `tableReady` before the first hand is started. Prevents render events
// from racing the adapter's fetchReply().
const pendingReady = new Set();

function markWebPresence(player) {
  if (!player || E.isCpuPlayer(player)) return;
  player.webLastSeenAt = Date.now();
}

async function pruneStaleWebPlayers(table) {
  if (!table) return { removed: [] };
  const cutoff = Date.now() - WEB_PRESENCE_TIMEOUT_MS;
  const staleIds = [];
  for (const player of E.getHumanPlayers(table)) {
    if (!player?.webLastSeenAt || player.webLastSeenAt >= cutoff) continue;
    staleIds.push(player.userId);
  }
  const removed = [];
  for (const userId of staleIds) {
    const player = table.players.get(userId);
    if (!player) continue;
    removed.push(player.username || userId);
    await removePlayerFromTable(table, userId, { publicReason: `${player.username} timed out and was removed from the web table.` });
    if (!tables.has(table.channelId)) break;
  }
  return { removed };
}

function clearTurnTimer(channelId) {
  const t = turnTimers.get(channelId);
  if (t) { clearTimeout(t); turnTimers.delete(channelId); }
}
function clearNextHandTimer(channelId) {
  const t = nextHandTimers.get(channelId);
  if (t) { clearTimeout(t); nextHandTimers.delete(channelId); }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function emitRender(table, opts = {}) {
  const content = E.buildTableContent(table, opts);
  const bs = E.buttonState(table, { closed: !!opts.closed });
  emitEvent('render', { channelId: table.channelId, content, buttonState: bs });
}

async function emitClosed(table, reason) {
  emitEvent('tableClosed', {
    channelId: table.channelId,
    content: `**Texas Hold'em Table - Closed** ${reason}`,
  });
}

// ---------------------------------------------------------------------------
// CPU seating
// ---------------------------------------------------------------------------

function getCpuAnte(table) {
  const humans = E.getHumanPlayers(table);
  const anchor = humans[0];
  return Math.max(1, anchor ? (anchor.nextBet ?? anchor.bet) : 5);
}

function ensureCpuSeat(table) {
  if (E.getHumanPlayers(table).length !== 1) return;
  const ante = getCpuAnte(table);
  const cpu = E.getCpuPlayer(table);
  if (cpu) { cpu.bet = ante; cpu.nextBet = ante; return; }
  table.players.set(E.CPU_USER_ID, E.createPlayerState(E.CPU_USER_ID, E.CPU_USERNAME, ante, { isCpu: true }));
}

function removeCpuSeat(table) {
  const cpu = E.getCpuPlayer(table);
  if (cpu && !cpu.inHand) table.players.delete(E.CPU_USER_ID);
}

function syncCpuSeat(table) {
  const humans = E.getHumanPlayers(table).length;
  if (humans <= 0) { table.players.delete(E.CPU_USER_ID); return; }
  if (humans === 1) { ensureCpuSeat(table); return; }
  removeCpuSeat(table);
}

// ---------------------------------------------------------------------------
// Turn-safety helpers (audit #18)
// ---------------------------------------------------------------------------

/** Capture "whose turn is it and what does the betting look like" before a money action awaits the DB. */
function snapshotTurn(table, player) {
  return {
    handId: table.handId || 0, // which hand we're in (bumped every startHand)
    phase: table.phase, // preflop / flop / turn / river
    currentRoundBet: table.currentRoundBet || 0, // the bet to match right now
    roundBet: player.roundBet || 0, // what this player has already put in this round
  };
}

/** After an await: is it STILL this player's same turn, with the same numbers we priced the action on? */
function isSameTurn(table, player, snap) {
  return tables.get(table.channelId) === table // table wasn't closed/replaced
    && table.players.get(player.userId) === player // player didn't leave
    && E.isHandActive(table) // hand is still being played
    && (table.handId || 0) === snap.handId // ...and it's the same hand
    && table.phase === snap.phase // same betting street
    && table.currentPlayerId === player.userId // still their turn (turn timer didn't move it on)
    && player.inHand && player.status === 'active' && player.needsAction // not auto-folded/auto-checked meanwhile
    && (table.currentRoundBet || 0) === snap.currentRoundBet // nobody changed the bet to match
    && (player.roundBet || 0) === snap.roundBet; // and their own contribution didn't change
}

/** Give coins back via the brokered payCasinoPayout op when a debit can't be used. Returns true on success. */
async function refundHoldem(channelId, userId, amount) {
  try {
    await dbCall('payCasinoPayout', { userId, amount, gameType: 'holdem_refund' }); // credit back; ledger type 'holdem_refund_win'
    return true; // refund landed
  } catch (err) {
    emitEvent('payoutFailed', { channelId, userId, amount, error: err && err.message }); // surface the failure like a failed payout
    return false; // refund failed
  }
}

// ---------------------------------------------------------------------------
// Hand lifecycle
// ---------------------------------------------------------------------------

async function closeTable(table, reason = 'Table closed.') {
  clearTurnTimer(table.channelId);
  clearNextHandTimer(table.channelId);
  tables.delete(table.channelId);
  pendingReady.delete(table.channelId);
  await emitClosed(table, reason);
}

function resetRoundState(table) {
  table.turnOrder = E.getActivePlayers(table).map((p) => p.userId);
  table.turnCursor = 0;
  table.currentPlayerId = null;
  table.currentRoundBet = 0;
  for (const p of E.getPlayersInHand(table)) {
    p.needsAction = p.status === 'active';
    p.roundBet = 0;
  }
}

async function scheduleTurn(table) {
  clearTurnTimer(table.channelId);
  const active = E.getActivePlayers(table);
  if (active.length <= 1) {
    if (active.length === 1) await resolveLoneWinner(table, active[0], 'everyone else folded');
    return;
  }
  const nextPlayer = E.findPendingActionPlayer(table);
  if (!nextPlayer) { await advancePhase(table); return; }
  table.currentPlayerId = nextPlayer.userId;
  emitRender(table);

  if (E.isCpuPlayer(nextPlayer)) {
    const t = setTimeout(async () => {
      turnTimers.delete(table.channelId);
      const cpu = table.players.get(E.CPU_USER_ID);
      if (!cpu || !cpu.inHand || cpu.status !== 'active' || !cpu.needsAction) return;
      const callAmt = Math.max(0, (table.currentRoundBet || 0) - (cpu.roundBet || 0));
      if (callAmt > 0) {
        cpu.roundBet += callAmt;
        table.pot += callAmt;
        table.notice = `*${cpu.username} called ${callAmt.toLocaleString()} SGC.*`;
      } else {
        table.notice = `*${cpu.username} checked.*`;
      }
      cpu.needsAction = false;
      table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
      await scheduleTurn(table);
    }, settings.cpuActionDelayMs);
    t.unref?.();
    turnTimers.set(table.channelId, t);
    return;
  }

  const t = setTimeout(async () => {
    turnTimers.delete(table.channelId);
    const player = table.players.get(table.currentPlayerId);
    if (!player || !player.inHand || player.status !== 'active' || !player.needsAction) return;
    const owed = Math.max(0, (table.currentRoundBet || 0) - (player.roundBet || 0));
    if (owed > 0) {
      player.status = 'folded';
      player.needsAction = false;
      table.notice = `*${player.username} timed out and was auto-folded (outstanding bet of ${owed.toLocaleString()} SGC).*`;
    } else {
      player.needsAction = false;
      table.notice = `*${player.username} timed out and was auto-checked.*`;
    }
    table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
    await scheduleTurn(table);
  }, settings.actionTimeoutMs);
  t.unref?.();
  turnTimers.set(table.channelId, t);
}

async function startDecisionRound(table, phase) {
  table.phase = phase;
  table.notice = null;
  resetRoundState(table);
  await scheduleTurn(table);
}

async function prepareWaitingState(table, notice = null) {
  clearTurnTimer(table.channelId);
  clearNextHandTimer(table.channelId);
  table.phase = 'waiting';
  table.currentPlayerId = null;
  table.community = [];
  table.deck = [];
  table.pot = 0;
  table.currentRoundBet = 0;
  table.turnOrder = [];
  table.turnCursor = 0;
  table.notice = notice;
  for (const p of E.getSeatedPlayers(table)) {
    p.inHand = false;
    p.status = 'waiting';
    p.needsAction = false;
    p.holeCards = [];
    p.bestHand = null;
  }
  syncCpuSeat(table);
  if (E.getHumanPlayers(table).length === 0) {
    await closeTable(table, '(no human players)');
    return;
  }
  emitRender(table);
}

async function scheduleNextHand(table, notice = null, { keepCurrentMessage = false } = {}) {
  clearTurnTimer(table.channelId);
  clearNextHandTimer(table.channelId);
  if (E.getHumanPlayers(table).length === 0) {
    await closeTable(table, '(everyone left)');
    return;
  }
  syncCpuSeat(table);
  if (E.getSeatedPlayers(table).length < 2) {
    await prepareWaitingState(table, notice || '*Waiting for one more player...*');
    return;
  }
  table.phase = 'between';
  table.currentPlayerId = null;
  table.notice = notice || null;
  if (!keepCurrentMessage) {
    table.notice = notice || `*Next hand in ${settings.betweenHandsMs / 1000}s...*`;
    emitRender(table);
  }
  const t = setTimeout(() => {
    nextHandTimers.delete(table.channelId);
    void startHand(table);
  }, settings.betweenHandsMs);
  t.unref?.();
  nextHandTimers.set(table.channelId, t);
}

async function startHand(table) {
  // Guard: two joins (or a join + the next-hand timer) can both call startHand while phase is still
  // 'waiting'; without this each call would collect antes, charging everyone twice.
  if (table.startingHand) return; // a startHand is already mid-await for this table
  table.startingHand = true; // claim it SYNCHRONOUSLY before any await
  try {
    await startHandInner(table); // the real work lives below
  } finally {
    table.startingHand = false; // always release the claim
  }
}

async function startHandInner(table) {
  clearTurnTimer(table.channelId);
  clearNextHandTimer(table.channelId);
  for (const p of E.getSeatedPlayers(table)) {
    p.inHand = false;
    p.status = 'waiting';
    p.needsAction = false;
    p.holeCards = [];
    p.bestHand = null;
  }
  syncCpuSeat(table);
  await pruneStaleWebPlayers(table);
  if (!tables.has(table.channelId)) return;
  const seated = E.getSeatedPlayers(table);
  if (seated.length < 2) {
    await prepareWaitingState(table, '*Waiting for one more player...*');
    return;
  }

  const kickedNames = [];
  const kickedIds = [];
  const eligible = [];

  for (const p of seated) {
    const ante = p.nextBet ?? p.bet;
    if (E.isCpuPlayer(p)) { eligible.push({ player: p, ante }); continue; }
    try {
      await dbCall('ensureAccount', { userId: p.userId, username: p.username });
      const bal = await dbCall('getBalance', { userId: p.userId });
      if (bal < ante) { kickedNames.push(p.username); kickedIds.push(p.userId); continue; }
    } catch {
      kickedNames.push(p.username); kickedIds.push(p.userId); continue;
    }
    eligible.push({ player: p, ante });
  }

  for (const id of kickedIds) table.players.delete(id);

  if (eligible.length < 2) {
    const notice = kickedNames.length
      ? `*${kickedNames.join(', ')} removed (insufficient balance). Waiting for more players...*`
      : '*Waiting for one more player...*';
    await prepareWaitingState(table, notice);
    return;
  }

  table.handId = (table.handId || 0) + 1; // new hand number, so in-flight actions from the last hand can tell it changed
  table.deck = E.createDeck();
  table.community = [];
  table.pot = 0;
  table.currentRoundBet = 0;
  table.notice = kickedNames.length ? `*${kickedNames.join(', ')} removed (insufficient balance).*` : null;

  const anteDebits = []; // humans we actually charged an ante, so we can refund them if the hand can't start
  for (const { player, ante } of eligible) {
    if (tables.get(table.channelId) !== table) break; // table closed mid-loop: stop charging people
    if (table.players.get(player.userId) !== player) continue; // they left while we were charging someone else: skip
    if (!E.isCpuPlayer(player)) {
      try {
        const r = await dbCall('placeCasinoBet', {
          userId: player.userId, username: player.username, amount: ante, gameType: 'holdem',
        });
        if (!r || !r.success) { table.players.delete(player.userId); kickedNames.push(player.username); continue; }
      } catch {
        table.players.delete(player.userId); kickedNames.push(player.username); continue;
      }
      if (tables.get(table.channelId) !== table || table.players.get(player.userId) !== player) { // they left / table closed during the debit
        await refundHoldem(table.channelId, player.userId, ante); // give the ante back; they aren't in this hand
        continue; // don't deal them in
      }
      anteDebits.push({ userId: player.userId, ante }); // remember the debit in case we need to unwind
    }
    player.bet = ante;
    player.nextBet = ante;
    player.inHand = true;
    player.status = 'active';
    player.needsAction = true;
    player.holeCards = [E.drawCard(table), E.drawCard(table)];
    player.bestHand = null;
    table.pot += ante;
  }

  if (tables.get(table.channelId) !== table) { // table closed while antes were being collected
    for (const d of anteDebits) await refundHoldem(table.channelId, d.userId, d.ante); // refund every ante we took
    return; // nothing left to run
  }

  if (E.getPlayersInHand(table).length < 2) {
    // Not enough funded players: prepareWaitingState zeroes the pot, so refund the antes first or they vanish.
    for (const d of anteDebits) await refundHoldem(table.channelId, d.userId, d.ante); // give each charged human their ante back
    if (tables.get(table.channelId) !== table) return; // table closed during the refunds: nothing to reset
    await prepareWaitingState(table, '*Not enough funded players to start a hand.*');
    return;
  }

  await startDecisionRound(table, 'preflop');
}

async function advancePhase(table) {
  clearTurnTimer(table.channelId);
  table.currentPlayerId = null;
  if (table.phase === 'preflop') {
    table.community.push(E.drawCard(table), E.drawCard(table), E.drawCard(table));
    table.notice = '*Flop dealt.*';
    await startDecisionRound(table, 'flop');
    return;
  }
  if (table.phase === 'flop') {
    table.community.push(E.drawCard(table));
    table.notice = '*Turn card dealt.*';
    await startDecisionRound(table, 'turn');
    return;
  }
  if (table.phase === 'turn') {
    table.community.push(E.drawCard(table));
    table.notice = '*River card dealt.*';
    await startDecisionRound(table, 'river');
    return;
  }
  if (table.phase === 'river') await resolveShowdown(table);
}

async function resolveLoneWinner(table, winner, reason = '') {
  // Guard: only a hand that is still being played can be won. Without this, a player leaving while the
  // pot is already being paid (phase 'showdown') or while antes are still being collected would pay the pot again.
  if (!E.isHandActive(table)) return; // hand already resolved / not started: never pay the pot twice
  clearTurnTimer(table.channelId);
  table.phase = 'showdown';
  table.currentPlayerId = null;
  const payout = table.pot;
  if (!E.isCpuPlayer(winner) && payout > 0) {
    try { await dbCall('payCasinoPayout', { userId: winner.userId, amount: payout, gameType: 'holdem' }); }
    catch (err) {
      emitEvent('payoutFailed', { channelId: table.channelId, userId: winner.userId, amount: payout, error: err && err.message });
    }
  }
  for (const p of E.getPlayersInHand(table)) {
    if (p.userId === winner.userId) p.bestHand = { label: `Winner by default (+${payout.toLocaleString()} SGC)` };
  }
  const footer = E.isCpuPlayer(winner)
    ? `**Winner:** ${winner.username} by ${reason || 'default'}\nHouse keeps the pot: **${payout.toLocaleString()} SGC**`
    : `**Winner:** ${E.formatPlayerRef(winner)} by ${reason || 'default'}\nPayout: **${payout.toLocaleString()} SGC**`;
  emitRender(table, { header: "**Texas Hold'em - Hand Over**", footer });
  await scheduleNextHand(table, null, { keepCurrentMessage: true });
}

async function resolveShowdown(table) {
  clearTurnTimer(table.channelId);
  table.phase = 'showdown';
  table.currentPlayerId = null;
  const contenders = E.getActivePlayers(table);
  if (contenders.length === 0) {
    await scheduleNextHand(table, '*No live hands remained. Starting over...*');
    return;
  }
  let bestEval = null;
  let winners = [];
  for (const p of contenders) {
    p.bestHand = E.evaluateSeven([...p.holeCards, ...table.community]);
    if (!bestEval || E.compareEvaluations(p.bestHand, bestEval) > 0) {
      bestEval = p.bestHand;
      winners = [p];
    } else if (E.compareEvaluations(p.bestHand, bestEval) === 0) {
      winners.push(p);
    }
  }
  const baseShare = Math.floor(table.pot / winners.length);
  let remainder = table.pot % winners.length;
  const payoutLines = [];
  for (const w of winners) {
    const payout = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    if (!E.isCpuPlayer(w) && payout > 0) {
      try { await dbCall('payCasinoPayout', { userId: w.userId, amount: payout, gameType: 'holdem' }); }
      catch (err) {
        emitEvent('payoutFailed', { channelId: table.channelId, userId: w.userId, amount: payout, error: err && err.message });
      }
    }
    payoutLines.push(E.isCpuPlayer(w)
      ? `${w.username} keeps **${payout.toLocaleString()} SGC**`
      : `${E.formatPlayerRef(w)} +**${payout.toLocaleString()} SGC**`);
  }
  for (const p of E.getPlayersInHand(table)) {
    if (!p.bestHand && p.status === 'folded') p.bestHand = { label: 'Folded' };
  }
  const footer = [
    `**Winning hand:** ${bestEval && bestEval.label || 'Unknown'}`,
    `**Winner${winners.length === 1 ? '' : 's'}:** ${winners.map(E.formatPlayerRef).join(', ')}`,
    `**Payouts:** ${payoutLines.join(' | ')}`,
  ].join('\n');
  emitRender(table, {
    header: `**Texas Hold'em - Showdown** *(next hand in ${settings.betweenHandsMs / 1000}s...)*`,
    revealAll: true,
    footer,
  });
  await scheduleNextHand(table, null, { keepCurrentMessage: true });
}

async function removePlayerFromTable(table, userId, { publicReason = null } = {}) {
  const player = table.players.get(userId);
  if (!player) return;
  const wasInHand = player.inHand;
  const wasCurrent = table.currentPlayerId === userId;
  table.players.delete(userId);

  if (E.getHumanPlayers(table).length === 0) {
    clearNextHandTimer(table.channelId);
    await closeTable(table, '(everyone left)');
    return;
  }
  if (!wasInHand) {
    syncCpuSeat(table);
    table.notice = publicReason ? `*${publicReason}*` : null;
    if (table.phase === 'waiting' && E.getSeatedPlayers(table).length >= 2) {
      await startHand(table); return;
    }
    emitRender(table); return;
  }
  if (E.getActivePlayers(table).length === 1) {
    await resolveLoneWinner(table, E.getActivePlayers(table)[0], 'everyone else folded');
    return;
  }
  table.notice = publicReason ? `*${publicReason}*` : null;
  if (E.isHandActive(table)) { await scheduleTurn(table); return; }
  syncCpuSeat(table);
  emitRender(table);
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
  if (typeof channelId !== 'string' || typeof userId !== 'string' || !Number.isInteger(bet) || bet <= 0) {
    return { ok: false, reason: 'bad_args' };
  }
  await dbCall('ensureAccount', { userId, username });
  const balance = await dbCall('getBalance', { userId });
  if (balance < bet) return { ok: false, reason: 'insufficient', balance, bet };

  let table = tables.get(channelId);
  if (table && table.players.has(userId)) return { ok: false, reason: 'already_seated' };
  if (table && E.getHumanPlayers(table).length >= settings.maxPlayers) {
    return { ok: false, reason: 'table_full', maxPlayers: settings.maxPlayers };
  }

  if (!table) {
    table = E.makeTable(channelId);
    table.players.set(userId, E.createPlayerState(userId, username, bet));
    markWebPresence(table.players.get(userId));
    syncCpuSeat(table);
    tables.set(channelId, table);
    pendingReady.add(channelId);
    const content = E.buildTableContent(table);
    const bs = E.buttonState(table);
    return { ok: true, isNew: true, content, buttonState: bs };
  }

  table.players.set(userId, E.createPlayerState(userId, username, bet));
  markWebPresence(table.players.get(userId));
  syncCpuSeat(table);
  const handOpen = E.isHandActive(table);
  if (table.phase === 'waiting' && E.getSeatedPlayers(table).length >= 2) {
    await startHand(table);
  } else {
    emitRender(table);
  }
  return { ok: true, isNew: false, handOpen, ante: bet };
});

registerCommand('tableReady', async ({ channelId } = {}) => {
  if (!pendingReady.has(channelId)) return { ok: true, started: false };
  pendingReady.delete(channelId);
  const table = tables.get(channelId);
  if (!table) return { ok: true, started: false };
  if (E.getSeatedPlayers(table).length >= 2 && table.phase === 'waiting') {
    await startHand(table);
    return { ok: true, started: true };
  }
  emitRender(table);
  return { ok: true, started: false };
});

registerCommand('leave', async ({ channelId, userId } = {}) => {
  const table = tables.get(channelId);
  if (!table || !table.players.has(userId)) return { ok: false, reason: 'not_seated' };
  const player = table.players.get(userId);
  markWebPresence(player);
  const duringHand = player.inHand && E.isHandActive(table);
  const ante = player.bet;
  await removePlayerFromTable(table, userId, { publicReason: `${player.username} left the table.` });
  return { ok: true, duringHand, ante };
});

registerCommand('bet', async ({ channelId, userId, amount } = {}) => {
  const table = tables.get(channelId);
  if (!table || !table.players.has(userId)) return { ok: false, reason: 'not_seated' };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'bad_amount' };
  const player = table.players.get(userId);
  player.nextBet = amount;
  markWebPresence(player);
  if (!player.inHand) player.bet = amount;
  if (!E.isHandActive(table)) emitRender(table);
  return { ok: true, amount };
});

registerCommand('peek', async ({ channelId, userId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  const player = table.players.get(userId);
  if (!player) return { ok: false, reason: 'not_seated' };
  markWebPresence(player);
  if (!player.inHand || player.holeCards.length !== 2) {
    return { ok: false, reason: 'not_in_hand' };
  }
  const lines = [
    `Your cards: ${E.formatCards(player.holeCards)}`,
    `Board: ${E.renderCommunityCards(table.community)}`,
    `Pot: ${table.pot.toLocaleString()} SGC`,
  ];
  if ((table.currentRoundBet || 0) > 0) {
    const owed = table.currentRoundBet - (player.roundBet || 0);
    if (owed > 0) lines.push(`To call: **${owed.toLocaleString()} SGC**`);
  }
  return { ok: true, content: lines.join('\n') };
});

registerCommand('check', async ({ channelId, userId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  const player = table.players.get(userId);
  if (!player) return { ok: false, reason: 'not_seated' };
  markWebPresence(player);
  if (!E.isHandActive(table) || !player.inHand || player.status !== 'active') {
    return { ok: false, reason: 'not_active' };
  }
  if (table.currentPlayerId !== player.userId) {
    return { ok: false, reason: 'not_your_turn', currentRef: E.formatPlayerRefById(table, table.currentPlayerId) };
  }
  if (table.actionBusy) return { ok: false, reason: 'busy' }; // audit #18: another action on this table is mid-await (e.g. double click)
  const callAmt = (table.currentRoundBet || 0) - (player.roundBet || 0);
  if (callAmt > 0) {
    const turn = snapshotTurn(table, player); // remember exactly whose turn/what bet this is, before awaiting
    table.actionBusy = true; // lock the table SYNCHRONOUSLY before the first await
    try {
      await dbCall('ensureAccount', { userId: player.userId, username: player.username });
      const bal = await dbCall('getBalance', { userId: player.userId });
      if (bal < callAmt) return { ok: false, reason: 'cannot_call', need: callAmt, balance: bal };
      if (!isSameTurn(table, player, turn)) return { ok: false, reason: 'turn_changed' }; // turn timer fired / player left while we checked the balance
      const r = await dbCall('placeCasinoBet', { userId: player.userId, username: player.username, amount: callAmt, gameType: 'holdem' });
      if (!r || !r.success) return { ok: false, reason: 'call_failed' };
      if (!isSameTurn(table, player, turn)) { // the turn moved on while the debit was in flight
        const refunded = await refundHoldem(table.channelId, player.userId, callAmt); // give the coins back: the call never happened
        return { ok: false, reason: 'turn_changed', refunded }; // tell the caller it was too late
      }
    } finally {
      table.actionBusy = false; // always unlock, even on early returns or DB errors
    }
    player.roundBet += callAmt;
    table.pot += callAmt;
    table.notice = `*${player.username} called ${callAmt.toLocaleString()} SGC.*`;
  } else {
    table.notice = `*${player.username} checked.*`;
  }
  player.needsAction = false;
  table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
  await scheduleTurn(table);
  return { ok: true, called: callAmt > 0, amount: callAmt };
});

registerCommand('fold', async ({ channelId, userId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  const player = table.players.get(userId);
  if (!player) return { ok: false, reason: 'not_seated' };
  markWebPresence(player);
  if (!E.isHandActive(table) || !player.inHand || player.status !== 'active') {
    return { ok: false, reason: 'not_active' };
  }
  if (table.currentPlayerId !== player.userId) {
    return { ok: false, reason: 'not_your_turn', currentRef: E.formatPlayerRefById(table, table.currentPlayerId) };
  }
  if (table.actionBusy) return { ok: false, reason: 'busy' }; // a call/raise is mid-debit; don't fold underneath it
  player.status = 'folded';
  player.needsAction = false;
  table.notice = `*${player.username} folded.*`;
  table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
  await scheduleTurn(table);
  return { ok: true };
});

registerCommand('raise', async ({ channelId, userId, username, amount } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  const player = table.players.get(userId);
  if (!player) return { ok: false, reason: 'not_seated' };
  markWebPresence(player);
  if (!E.isHandActive(table) || !player.inHand || player.status !== 'active') {
    return { ok: false, reason: 'not_active' };
  }
  if (table.currentPlayerId !== player.userId) {
    return { ok: false, reason: 'not_your_turn', currentRef: E.formatPlayerRefById(table, table.currentPlayerId) };
  }
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, reason: 'bad_amount' };
  if (table.actionBusy) return { ok: false, reason: 'busy' }; // audit #18: another action on this table is mid-await (e.g. double click)
  const callGap = Math.max(0, (table.currentRoundBet || 0) - (player.roundBet || 0));
  const totalCost = callGap + amount;
  const turn = snapshotTurn(table, player); // remember exactly whose turn/what bet this is, before awaiting
  table.actionBusy = true; // lock the table SYNCHRONOUSLY before the first await
  try {
    await dbCall('ensureAccount', { userId: player.userId, username: player.username || username });
    const bal = await dbCall('getBalance', { userId: player.userId });
    if (bal < totalCost) return { ok: false, reason: 'insufficient', need: totalCost, balance: bal, callGap, raise: amount };
    if (!isSameTurn(table, player, turn)) return { ok: false, reason: 'turn_changed' }; // turn timer fired / player left while we checked the balance
    const r = await dbCall('placeCasinoBet', { userId: player.userId, username: player.username, amount: totalCost, gameType: 'holdem' });
    if (!r || !r.success) return { ok: false, reason: 'raise_failed' };
    if (!isSameTurn(table, player, turn)) { // the turn moved on while the debit was in flight
      const refunded = await refundHoldem(table.channelId, player.userId, totalCost); // give the coins back: the raise never happened
      return { ok: false, reason: 'turn_changed', refunded }; // tell the caller it was too late
    }
  } finally {
    table.actionBusy = false; // always unlock, even on early returns or DB errors
  }
  player.roundBet += totalCost;
  table.pot += totalCost;
  table.currentRoundBet = player.roundBet;
  for (const p of E.getActivePlayers(table)) {
    if (p.userId !== player.userId && p.roundBet < table.currentRoundBet) p.needsAction = true;
  }
  player.needsAction = false;
  table.notice = `*${player.username} raised ${amount.toLocaleString()} SGC${callGap > 0 ? ` (called ${callGap.toLocaleString()} + raised ${amount.toLocaleString()})` : ''} — bet is now ${table.currentRoundBet.toLocaleString()} SGC.*`;
  table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
  await scheduleTurn(table);
  return { ok: true, amount, callGap, totalCost, currentBet: table.currentRoundBet };
});

registerCommand('debugSnapshot', async ({ channelId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { exists: false };
  return {
    exists: true,
    phase: table.phase,
    pot: table.pot,
    community: table.community.length,
    currentPlayerId: table.currentPlayerId,
    players: E.getSeatedPlayers(table).map((p) => ({
      userId: p.userId, username: p.username, inHand: p.inHand, status: p.status,
      bet: p.bet, roundBet: p.roundBet, needsAction: p.needsAction,
    })),
  };
});

registerCommand('touch', async ({ channelId, userId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { ok: false, reason: 'no_table' };
  const player = table.players.get(userId);
  if (!player || E.isCpuPlayer(player)) return { ok: false, reason: 'not_seated' };
  markWebPresence(player);
  return { ok: true };
});

registerCommand('getTable', async ({ channelId } = {}) => {
  const table = tables.get(channelId);
  if (!table) return { ok: false, exists: false };
  await pruneStaleWebPlayers(table);
  if (!tables.has(channelId)) return { ok: false, exists: false };
  return {
    ok: true,
    exists: true,
    phase: table.phase,
    content: E.buildTableContent(table),
    buttonState: E.buttonState(table),
  };
});

registerCommand('listTables', async () => ({
  ok: true,
  tables: [...tables.values()].map((table) => ({
    channelId: table.channelId,
    phase: table.phase,
    playerCount: E.getHumanPlayers(table).length,
    maxPlayers: settings.maxPlayers,
    content: E.buildTableContent(table),
    buttonState: E.buttonState(table),
  })),
}));
