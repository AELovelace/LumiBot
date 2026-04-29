'use strict';

/**
 * Slots engine worker.
 *
 * One lobby per channel. Each lobby has up to N players. Players can:
 *   - join (creates lobby if absent)
 *   - leave (closes lobby if last to leave)
 *   - setBet
 *   - spin (deducts bet, animates frames, evaluates, pays out)
 *
 * The worker emits `render` events with structured embed data; the main-
 * process adapter rebuilds the discord.js Embed from that payload. We
 * deliberately do NOT cross thread boundary with class instances.
 */

const { registerCommand, emitEvent, dbCall } = require('../../runtime');
const E = require('./engine');

let settings = { ...E.DEFAULTS };

const lobbies = new Map();
const idleTimers = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    closeLobby(channelId, 'idle');
  }, settings.idleTimeoutMs);
  idleTimers.set(channelId, t);
}

function buildLobbyPayload(lobby) {
  const players = [...lobby.players.values()];
  const fields = [];
  for (const p of players) {
    fields.push({
      name: p.username,
      value: [
        `Bet: **${p.bet}** SGC`,
        p.statusText,
        E.renderCompactGrid(p.grid),
      ].join('\n'),
      inline: true,
    });
  }
  for (let seat = players.length + 1; seat <= settings.maxPlayers; seat++) {
    fields.push({
      name: `Open Seat ${seat}`,
      value: [
        'Available',
        E.renderCompactGrid(E.placeholderGrid()),
        '`/lumi-slots start` to join',
      ].join('\n'),
      inline: true,
    });
  }

  return {
    channelId: lobby.channelId,
    embed: {
      color: 0xC0392B,
      title: `🎰 Slot Machine — Momiji Casino (${players.length}/${settings.maxPlayers} seats)`,
      description: [
        'Set your bet and hit **Spin**.',
        `3-of-a-kind: row **${settings.horizontalMultiplier}×** · diagonal **${settings.diagonalMultiplier}×** | Hands **${settings.handMultiplier}×**: 💎💎⭐ · 7️⃣7️⃣💎 · 🍒🍒🔔`,
        'Up to 3 players can share this play area at once.',
      ].join('\n'),
      fields,
      footer: lobby.lastEvent || 'Pick a bet, then pull the lever.',
    },
  };
}

function emitRender(channelId) {
  const lobby = lobbies.get(channelId);
  if (!lobby) return;
  emitEvent('render', buildLobbyPayload(lobby));
}

function closeLobby(channelId, reason) {
  const lobby = lobbies.get(channelId);
  if (!lobby) return;
  clearIdleTimer(channelId);
  lobbies.delete(channelId);
  let content;
  if (reason === 'allLeft') content = '🎰 **Slot Machine — Closed** (everyone left)';
  else if (reason === 'idle') content = '🎰 **Slot Machine — Closed** (idle timeout)';
  else content = '🎰 **Slot Machine — Closed**';
  emitEvent('lobbyClosed', { channelId, content });
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

  await dbCall('ensureAccount', { userId, username });

  let lobby = lobbies.get(channelId);
  const isNew = !lobby;
  if (!lobby) {
    lobby = E.makeLobby(channelId);
    lobbies.set(channelId, lobby);
  }
  if (lobby.players.has(userId)) {
    return { ok: false, reason: 'already_joined', isNew: false, ...buildLobbyPayload(lobby) };
  }
  if (lobby.players.size >= settings.maxPlayers) {
    if (isNew) lobbies.delete(channelId); // shouldn't happen but defensive
    return { ok: false, reason: 'full', max: settings.maxPlayers };
  }

  lobby.players.set(userId, E.createPlayer(userId, username, settings));
  lobby.lastEvent = `${username} joined the slot bank.`;
  startIdleTimer(channelId);

  return { ok: true, isNew, ...buildLobbyPayload(lobby) };
});

registerCommand('leave', async ({ channelId, userId } = {}) => {
  const lobby = lobbies.get(channelId);
  if (!lobby || !lobby.players.has(userId)) {
    return { ok: false, reason: 'not_in_lobby' };
  }
  const player = lobby.players.get(userId);
  if (player.spinning) {
    return { ok: false, reason: 'spinning' };
  }
  lobby.players.delete(userId);
  lobby.lastEvent = `${player.username} left the slot bank.`;

  if (lobby.players.size === 0) {
    closeLobby(channelId, 'allLeft');
    return { ok: true, closed: true };
  }
  startIdleTimer(channelId);
  return { ok: true, closed: false, ...buildLobbyPayload(lobby) };
});

registerCommand('setBet', async ({ channelId, userId, username, amount } = {}) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'bad_amount' };
  }
  await dbCall('ensureAccount', { userId, username });

  let lobby = lobbies.get(channelId);
  if (!lobby) {
    lobby = E.makeLobby(channelId);
    lobbies.set(channelId, lobby);
  }
  if (!lobby.players.has(userId)) {
    if (lobby.players.size >= settings.maxPlayers) {
      return { ok: false, reason: 'full', max: settings.maxPlayers };
    }
    lobby.players.set(userId, E.createPlayer(userId, username, settings));
  }
  const player = lobby.players.get(userId);
  if (player.spinning) {
    return { ok: false, reason: 'spinning' };
  }
  const balance = await dbCall('getBalance', { userId });
  if (balance < amount) {
    return { ok: false, reason: 'insufficient', balance, amount };
  }

  player.bet = amount;
  player.statusText = 'Ready';
  lobby.lastEvent = `${player.username} set their bet to ${amount} SGC.`;
  startIdleTimer(channelId);
  return { ok: true, ...buildLobbyPayload(lobby) };
});

registerCommand('spin', async ({ channelId, userId, username } = {}) => {
  let lobby = lobbies.get(channelId);
  if (!lobby) {
    return { ok: false, reason: 'no_lobby' };
  }
  if (!lobby.players.has(userId)) {
    if (lobby.players.size >= settings.maxPlayers) {
      return { ok: false, reason: 'full', max: settings.maxPlayers };
    }
    await dbCall('ensureAccount', { userId, username });
    lobby.players.set(userId, E.createPlayer(userId, username, settings));
    lobby.lastEvent = `${username} joined the slot bank.`;
  }
  const player = lobby.players.get(userId);
  if (player.spinning) {
    return { ok: false, reason: 'spinning' };
  }

  await dbCall('ensureAccount', { userId, username: player.username });
  const balance = await dbCall('getBalance', { userId });
  if (balance < player.bet) {
    return { ok: false, reason: 'insufficient', balance, bet: player.bet };
  }
  const placed = await dbCall('placeCasinoBet', {
    userId, username: player.username, amount: player.bet, gameType: 'slots',
  });
  if (!placed || !placed.success) {
    return { ok: false, reason: 'bet_failed', error: placed && placed.error };
  }

  player.spinning = true;
  player.statusText = 'Spinning...';
  lobby.lastEvent = `${player.username} spins for ${player.bet} SGC.`;
  startIdleTimer(channelId);

  setImmediate(() => { void runSpin(channelId, userId); });

  return { ok: true, ...buildLobbyPayload(lobby) };
});

async function runSpin(channelId, userId) {
  const lobby = lobbies.get(channelId);
  if (!lobby) return;
  const player = lobby.players.get(userId);
  if (!player) return;

  const finalGrid = E.randomGrid();

  // Initial spin frame
  player.grid = E.randomGrid();
  emitRender(channelId);

  for (let f = 1; f < settings.spinFrames; f++) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(settings.spinFrameMs);
    const stillHere = lobbies.get(channelId);
    if (!stillHere || !stillHere.players.has(userId)) return;
    const frameGrid = f === settings.spinFrames - 1 ? finalGrid : E.randomGrid();
    player.grid = frameGrid;
    player.statusText = f < settings.spinFrames - 1 ? 'Spinning...' : 'Stopping...';
    emitRender(channelId);
  }

  const { totalMultiplier, wins } = E.evaluateGrid(finalGrid, settings);
  const payout = Math.floor(player.bet * totalMultiplier);

  if (payout > 0) {
    try {
      await dbCall('payCasinoPayout', { userId, amount: payout, gameType: 'slots' });
    } catch (err) {
      emitEvent('payoutFailed', { channelId, userId, amount: payout, error: err && err.message });
    }
  }

  let newBal = 0;
  try {
    newBal = await dbCall('getBalance', { userId });
  } catch { /* ignore */ }

  if (wins.length > 0) {
    player.statusText = `Won ${payout.toLocaleString()} • Bal ${newBal.toLocaleString()}`;
    lobby.lastEvent = `${player.username}: +${payout.toLocaleString()} SGC, bal ${newBal.toLocaleString()}.`;
  } else {
    player.statusText = `Lost ${player.bet.toLocaleString()} • Bal ${newBal.toLocaleString()}`;
    lobby.lastEvent = `${player.username}: -${player.bet.toLocaleString()} SGC, bal ${newBal.toLocaleString()}.`;
  }
  player.spinning = false;

  emitEvent('spinComplete', { channelId, userId, bet: player.bet, payout, multiplier: totalMultiplier, winCount: wins.length });
  emitRender(channelId);
  startIdleTimer(channelId);
}

registerCommand('debugSnapshot', async ({ channelId } = {}) => {
  const lobby = lobbies.get(channelId);
  if (!lobby) return { exists: false };
  return {
    exists: true,
    playerCount: lobby.players.size,
    players: [...lobby.players.values()].map((p) => ({
      userId: p.userId, bet: p.bet, spinning: p.spinning, statusText: p.statusText,
    })),
  };
});

registerCommand('getLobby', async ({ channelId } = {}) => {
  const lobby = lobbies.get(channelId);
  if (!lobby) return { ok: false, exists: false };
  return { ok: true, exists: true, ...buildLobbyPayload(lobby) };
});
