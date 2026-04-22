'use strict';

/**
 * Horseracing engine worker.
 *
 * Owns per-channel lobby state, betting timers, race tick intervals, and
 * the in-memory cache of persistent win stats (loaded lazily via the DB
 * broker).
 *
 * Lifecycle events emitted to the adapter:
 *   - `bettingOpen`   { channelId, content, raceNumber }
 *       Worker has started a new betting round and the adapter should
 *       send a NEW message with the betting buttons.
 *   - `bettingUpdate` { channelId, content }
 *       Adapter should edit the current betting message.
 *   - `bettingClosed` { channelId, content }
 *       Adapter should disable buttons on the current betting message.
 *   - `raceStart`     { channelId, content }
 *       Adapter should send a NEW race message (no buttons).
 *   - `raceFrame`     { channelId, content }
 *       Adapter should edit the current race message.
 *   - `raceFinished`  { channelId, content }
 *       Adapter should edit the current race message with final results.
 *   - `lobbyClosed`   { channelId, target: 'betting'|'race', content }
 *       Lobby is gone — adapter should disable/edit the relevant message.
 */

const { registerCommand, emitEvent, dbCall } = require('../../runtime');
const E = require('./engine');

let settings = { ...E.DEFAULTS };

const lobbies = new Map();
const bettingTimers = new Map();
const raceTimers = new Map();

let winStats = null;
let winStatsLoading = null;

async function ensureWinStats() {
  if (winStats) return winStats;
  if (winStatsLoading) return winStatsLoading;
  winStatsLoading = (async () => {
    try {
      const raw = await dbCall('getSystemState', { key: E.WIN_STATS_KEY });
      const next = E.emptyWinStats();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          for (const h of E.HORSES) {
            if (Number.isFinite(parsed[h])) next[h] = parsed[h];
          }
        } catch { /* ignore parse errors */ }
      }
      winStats = next;
    } catch {
      winStats = E.emptyWinStats();
    }
    winStatsLoading = null;
    return winStats;
  })();
  return winStatsLoading;
}

async function persistWinStats() {
  if (!winStats) return;
  try {
    await dbCall('setSystemState', { key: E.WIN_STATS_KEY, value: JSON.stringify(winStats) });
  } catch { /* best-effort */ }
}

function clearBettingTimer(channelId) {
  const t = bettingTimers.get(channelId);
  if (t) { clearTimeout(t); bettingTimers.delete(channelId); }
}
function clearRaceTimer(channelId) {
  const t = raceTimers.get(channelId);
  if (t) { clearInterval(t); raceTimers.delete(channelId); }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function buildBettingContent(lobby, balances) {
  const stats = winStats || E.emptyWinStats();
  const underdog = E.getUnderdog(stats);
  const underdogNote = underdog ? `\n🔥 **Horse ${underdog}** is the underdog — 2× payout if it wins!` : '';
  const playerList = [...lobby.players.values()].map((p) => {
    const balance = balances[p.userId] ?? 0;
    const affordNote = balance < p.bet ? ` | Can't afford current bet (${balance} SGC)` : '';
    return `• ${p.username} — Horse: ${p.horse ?? '?'} | Bet: ${p.bet} SGC${affordNote}`;
  }).join('\n');

  return [
    `🏇 **Horse Race — Betting Open** *(Race #${lobby.raceNumber})*`,
    `Pick your horse and set your bet! Race starts in **${settings.bettingWindowMs / 1000}s**.${underdogNote}`,
    `📊 Stats: ${E.statsLine(stats)}`,
    '',
    `**Players:**\n${playerList || '_No one yet — use /lumi-horserace start to join!_'}`,
  ].join('\n');
}

async function buildBettingContentFromDb(lobby) {
  const balances = {};
  for (const p of lobby.players.values()) {
    try {
      balances[p.userId] = await dbCall('getBalance', { userId: p.userId });
    } catch { balances[p.userId] = 0; }
  }
  return buildBettingContent(lobby, balances);
}

// ---------------------------------------------------------------------------
// Race execution
// ---------------------------------------------------------------------------

async function startBettingRound(channelId, isFirst = false) {
  const lobby = lobbies.get(channelId);
  if (!lobby) return null;
  await ensureWinStats();
  lobby.phase = 'betting';
  for (const p of lobby.players.values()) p.horse = null;

  const content = await buildBettingContentFromDb(lobby);

  if (!isFirst) {
    emitEvent('bettingOpen', { channelId, content, raceNumber: lobby.raceNumber });
  }

  scheduleBettingTimer(channelId);
  return content;
}

function scheduleBettingTimer(channelId) {
  clearBettingTimer(channelId);
  const t = setTimeout(() => {
    bettingTimers.delete(channelId);
    void runRace(channelId);
  }, settings.bettingWindowMs);
  bettingTimers.set(channelId, t);
}

async function runRace(channelId) {
  const lobby = lobbies.get(channelId);
  if (!lobby) return;
  await ensureWinStats();

  // Collect funded bets
  const racers = [];
  let totalPool = 0;
  const unfunded = [];
  for (const [uid, p] of [...lobby.players]) {
    if (!p.horse) continue;
    try {
      await dbCall('ensureAccount', { userId: uid, username: p.username });
      const bal = await dbCall('getBalance', { userId: uid });
      if (bal < p.bet) { unfunded.push(`${p.username} (${bal}/${p.bet} SGC)`); p.horse = null; continue; }
      const placed = await dbCall('placeCasinoBet', {
        userId: uid, username: p.username, amount: p.bet, gameType: 'horserace',
      });
      if (!placed || !placed.success) { unfunded.push(`${p.username} (${bal}/${p.bet} SGC)`); p.horse = null; continue; }
      racers.push({ userId: uid, username: p.username, horse: p.horse, bet: p.bet });
      totalPool += p.bet;
    } catch {
      unfunded.push(`${p.username} (db error)`);
      p.horse = null;
    }
  }

  if (racers.length === 0) {
    if (unfunded.length > 0) {
      emitEvent('bettingClosed', {
        channelId,
        content: `🏇 Race cancelled — nobody could cover their current bet. ${unfunded.join(', ')}`,
      });
    }
    if (lobby.players.size > 0) {
      const content = await startBettingRound(channelId, false);
      if (content) emitEvent('bettingOpen', { channelId, content, raceNumber: lobby.raceNumber });
    } else {
      tearDown(channelId, 'allLeft');
    }
    return;
  }

  // Disable old betting buttons (do NOT emit lobbyClosed; race continues).
  emitEvent('bettingClosed', { channelId, content: null });

  // Start race
  lobby.phase = 'racing';
  const positions = [0, 0, 0, 0];
  const underdog = E.getUnderdog(winStats);
  const betsLine = racers.map((r) => `${r.username} → Horse ${r.horse} (${r.bet} SGC)`).join('  |  ');
  const initialBody = `🏇 **Race #${lobby.raceNumber}** — And they're off!\n🎫 ${betsLine}\n\`\`\`\n${E.renderTrack(positions, settings.trackWidth)}\n\`\`\``;
  emitEvent('raceStart', { channelId, content: initialBody });

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      const { finished, winner } = E.tickPositions(positions, settings.trackWidth);
      const body = `🏇 **Race #${lobby.raceNumber}** — ${finished ? 'Finished!' : 'Racing...'}\n🎫 ${betsLine}\n\`\`\`\n${E.renderTrack(positions, settings.trackWidth)}\n\`\`\``;
      emitEvent('raceFrame', { channelId, content: body });
      if (finished) {
        clearInterval(interval);
        raceTimers.delete(channelId);
        resolve(winner);
      }
    }, settings.raceTickMs);
    raceTimers.set(channelId, interval);
  }).then(async (winner) => {
    winStats[winner] = (winStats[winner] || 0) + 1;
    await persistWinStats();
    lobby.raceNumber += 1;

    const isUnderdog = underdog === winner;
    const multiplier = isUnderdog ? 2 : 1;
    const winners = racers.filter((r) => r.horse === winner);
    const losers = racers.filter((r) => r.horse !== winner);

    const lines = [
      `🏆 **Horse ${winner} wins!** ${isUnderdog ? '*(2× underdog bonus!)*' : ''}`,
      `Prize pool: **${totalPool} SGC**${isUnderdog ? ' × 2' : ''}`,
      '',
    ];

    if (winners.length > 0) {
      const effectivePool = totalPool * multiplier;
      const share = Math.floor(effectivePool / winners.length);
      for (const w of winners) {
        try {
          await dbCall('payCasinoPayout', { userId: w.userId, amount: share, gameType: 'horserace' });
        } catch (err) {
          emitEvent('payoutFailed', { channelId, userId: w.userId, amount: share, error: err && err.message });
        }
        let newBal = 0;
        try { newBal = await dbCall('getBalance', { userId: w.userId }); } catch { /* ignore */ }
        lines.push(`✅ ${w.username} (Horse ${w.horse}) — won **${share.toLocaleString()} SGC** (bet ${w.bet}) → Balance: **${newBal.toLocaleString()} SGC**`);
      }
    } else {
      lines.push('No one picked the winner — house wins!');
    }
    for (const l of losers) {
      let newBal = 0;
      try { newBal = await dbCall('getBalance', { userId: l.userId }); } catch { /* ignore */ }
      lines.push(`❌ ${l.username} (Horse ${l.horse}) — lost **${l.bet} SGC** → Balance: **${newBal.toLocaleString()} SGC**`);
    }
    lines.push('', `📊 Win Stats: ${E.statsLine(winStats)}`);

    const finalRaceBody = `🏇 **Race #${lobby.raceNumber - 1}** — Finished!\n🎫 ${betsLine}\n\`\`\`\n${E.renderTrack(positions, settings.trackWidth)}\n\`\`\`\n${lines.join('\n')}`;
    emitEvent('raceFinished', { channelId, content: finalRaceBody });

    if (lobby.players.size > 0) {
      const content = await startBettingRound(channelId, false);
      if (content) {
        // startBettingRound only emits 'bettingOpen' when isFirst===false,
        // which is already the case, so it has been emitted. Nothing else to do.
      }
    } else {
      tearDown(channelId, 'allLeft');
    }
  });
}

function tearDown(channelId, reason) {
  clearBettingTimer(channelId);
  clearRaceTimer(channelId);
  lobbies.delete(channelId);
  let content;
  if (reason === 'allLeft') content = '🏇 **Horse Race — Closed** (everyone left)';
  else if (reason === 'noBets') content = '🏇 **Horse Race — Closed** (no funded bets placed)';
  else content = '🏇 **Horse Race — Closed**';
  emitEvent('lobbyClosed', { channelId, target: 'betting', content });
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

registerCommand('join', async ({ channelId, userId, username } = {}) => {
  if (typeof channelId !== 'string' || typeof userId !== 'string') {
    return { ok: false, reason: 'bad_args' };
  }
  await ensureWinStats();
  await dbCall('ensureAccount', { userId, username });
  const balance = await dbCall('getBalance', { userId });
  if (balance < settings.defaultBet) {
    return { ok: false, reason: 'insufficient_to_join', balance, minBet: settings.defaultBet };
  }

  let lobby = lobbies.get(channelId);
  const isNew = !lobby;
  if (!lobby) {
    lobby = E.makeLobby(channelId);
    lobbies.set(channelId, lobby);
  }
  if (lobby.players.has(userId)) {
    return { ok: false, reason: 'already_joined' };
  }
  lobby.players.set(userId, E.createPlayer(userId, username, settings.defaultBet));

  if (isNew) {
    const content = await startBettingRound(channelId, true);
    return { ok: true, isNew: true, content, raceNumber: lobby.raceNumber };
  }
  if (lobby.phase === 'betting') {
    const content = await buildBettingContentFromDb(lobby);
    emitEvent('bettingUpdate', { channelId, content });
  }
  return { ok: true, isNew: false };
});

registerCommand('leave', async ({ channelId, userId } = {}) => {
  const lobby = lobbies.get(channelId);
  if (!lobby || !lobby.players.has(userId)) {
    return { ok: false, reason: 'not_in_lobby' };
  }
  lobby.players.delete(userId);
  if (lobby.players.size === 0) {
    tearDown(channelId, 'allLeft');
    return { ok: true, closed: true };
  }
  if (lobby.phase === 'betting') {
    const content = await buildBettingContentFromDb(lobby);
    emitEvent('bettingUpdate', { channelId, content });
  }
  return { ok: true, closed: false };
});

registerCommand('pickHorse', async ({ channelId, userId, username, horse } = {}) => {
  if (!E.HORSES.includes(horse)) return { ok: false, reason: 'bad_horse' };
  await dbCall('ensureAccount', { userId, username });
  const balance = await dbCall('getBalance', { userId });

  let lobby = lobbies.get(channelId);
  if (!lobby) return { ok: false, reason: 'no_lobby' };
  if (lobby.phase !== 'betting') return { ok: false, reason: 'not_betting' };

  if (!lobby.players.has(userId)) {
    if (balance < settings.defaultBet) {
      return { ok: false, reason: 'insufficient_to_join', balance, minBet: settings.defaultBet };
    }
    lobby.players.set(userId, E.createPlayer(userId, username, settings.defaultBet));
  }
  const player = lobby.players.get(userId);
  if (balance < player.bet) {
    return { ok: false, reason: 'cannot_afford_bet', balance, bet: player.bet };
  }
  player.horse = horse;
  const content = await buildBettingContentFromDb(lobby);
  emitEvent('bettingUpdate', { channelId, content });
  return { ok: true, horse };
});

registerCommand('setBet', async ({ channelId, userId, username, amount } = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'bad_amount' };
  await dbCall('ensureAccount', { userId, username });
  const balance = await dbCall('getBalance', { userId });

  let lobby = lobbies.get(channelId);
  if (!lobby) return { ok: false, reason: 'no_lobby' };
  if (lobby.phase !== 'betting') return { ok: false, reason: 'not_betting' };

  if (!lobby.players.has(userId)) {
    if (balance < amount) return { ok: false, reason: 'insufficient', balance, amount };
    lobby.players.set(userId, E.createPlayer(userId, username, settings.defaultBet));
  }
  const player = lobby.players.get(userId);
  if (balance < amount) return { ok: false, reason: 'insufficient', balance, amount };
  player.bet = amount;
  const content = await buildBettingContentFromDb(lobby);
  emitEvent('bettingUpdate', { channelId, content });
  return { ok: true, amount };
});

registerCommand('debugSnapshot', async ({ channelId } = {}) => {
  const lobby = lobbies.get(channelId);
  if (!lobby) return { exists: false };
  return {
    exists: true,
    phase: lobby.phase,
    raceNumber: lobby.raceNumber,
    players: [...lobby.players.values()],
  };
});
