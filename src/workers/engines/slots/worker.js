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
  const timer = idleTimers.get(channelId);
  if (!timer) return;
  clearTimeout(timer);
  idleTimers.delete(channelId);
}

function startIdleTimer(channelId) {
  clearIdleTimer(channelId);
  const timer = setTimeout(() => {
    idleTimers.delete(channelId);
    closeLobby(channelId, 'idle');
  }, settings.idleTimeoutMs);
  idleTimers.set(channelId, timer);
}

function buildLobbyPayload(lobby) {
  const players = [...lobby.players.values()];
  const fields = [];

  for (const player of players) {
    fields.push({
      name: player.username,
      value: [
        `Bet: **${player.bet}** SGC`,
        player.statusText,
        E.renderCompactGrid(player.grid),
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
        E.buildPayoutSummary(),
        `Bet buttons: ${E.BET_OPTIONS.join(' / ')} SGC.`,
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

  let content = '🎰 **Slot Machine — Closed**';
  if (reason === 'allLeft') content = '🎰 **Slot Machine — Closed** (everyone left)';
  else if (reason === 'idle') content = '🎰 **Slot Machine — Closed** (idle timeout)';

  emitEvent('lobbyClosed', { channelId, content });
}

registerCommand('setSettings', async (next) => {
  if (next && typeof next === 'object') {
    const merged = { ...settings };
    for (const [key, value] of Object.entries(next)) {
      if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
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
    if (isNew) lobbies.delete(channelId);
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
  if (!Number.isInteger(amount) || !E.isAllowedBet(amount)) {
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

  // Audit #9: the world may have changed while we waited on the DB, so look again before touching the bet.
  if (lobbies.get(channelId) !== lobby || lobby.players.get(userId) !== player) { // lobby closed or player left/rejoined mid-await
    return { ok: false, reason: 'not_in_lobby' }; // don't write a bet onto a stale player object
  }
  if (player.spinning) { // a spin started while we were awaiting getBalance
    return { ok: false, reason: 'spinning' }; // refuse: bets can't change once the lever is pulled
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
    lobby = lobbies.get(channelId); // re-read: the lobby may have closed while we awaited ensureAccount
    if (!lobby) return { ok: false, reason: 'no_lobby' }; // it did close, so there is nothing to spin in
    if (!lobby.players.has(userId)) { // a parallel click may already have seated this user; don't overwrite them
      if (lobby.players.size >= settings.maxPlayers) { // someone else took the last seat during the await
        return { ok: false, reason: 'full', max: settings.maxPlayers }; // so we're full now
      }
      lobby.players.set(userId, E.createPlayer(userId, username, settings)); // seat the new player
      lobby.lastEvent = `${username} joined the slot bank.`; // announce the join in the footer
    }
  }

  const player = lobby.players.get(userId);
  if (player.spinning) {
    return { ok: false, reason: 'spinning' };
  }

  // Audit #9: lock the machine and freeze the wager BEFORE the first await, so a double click
  // can't place two bets and a setBet landing mid-spin can't change what gets paid out.
  player.spinning = true; // synchronous lock: any other spin/setBet for this player now bounces
  const wager = player.bet; // the exact amount we debit AND later pay against; never re-read player.bet
  player.activeWager = wager; // expose the frozen wager on the player for debug/inspection

  let placed; // result of the debit, filled in inside the try below
  try {
    await dbCall('ensureAccount', { userId, username: player.username });
    const balance = await dbCall('getBalance', { userId });
    if (balance < wager) {
      player.spinning = false; // early return: release the lock so they can try again
      player.activeWager = null; // no wager is riding any more
      return { ok: false, reason: 'insufficient', balance, bet: wager };
    }

    placed = await dbCall('placeCasinoBet', { // debit exactly the frozen wager
      userId,
      username: player.username,
      amount: wager,
      gameType: 'slots',
    });
  } catch (err) {
    player.spinning = false; // DB error: release the lock so the player isn't stuck forever
    player.activeWager = null; // nothing was (knowingly) wagered
    throw err; // let the runtime report the error to the caller like before
  }
  if (!placed || !placed.success) {
    player.spinning = false; // debit refused: release the lock
    player.activeWager = null; // nothing is riding
    return { ok: false, reason: 'bet_failed', error: placed && placed.error };
  }

  player.statusText = 'Spinning...';
  lobby.lastEvent = `${player.username} spins for ${wager} SGC.`; // show the frozen wager, not whatever player.bet is now
  if (lobbies.get(channelId) === lobby) startIdleTimer(channelId); // only re-arm the idle timer if the lobby is still alive

  setImmediate(() => {
    void runSpin(channelId, userId, player, wager); // hand the frozen wager + player object to the payout step
  });

  return { ok: true, ...buildLobbyPayload(lobby) };
});

async function runSpin(channelId, userId, player, wager) {
  // `player` and `wager` are captured at bet time (audit #9). The coins are already taken,
  // so even if the lobby closes mid-animation we still evaluate and pay - we just stop drawing frames.
  const finalGrid = E.randomGrid();

  player.grid = E.randomGrid();
  emitRender(channelId);

  for (let frame = 1; frame < settings.spinFrames; frame++) {
    await sleep(settings.spinFrameMs);
    const currentLobby = lobbies.get(channelId);
    if (!currentLobby || currentLobby.players.get(userId) !== player) break; // lobby/player gone: skip the rest of the animation but still pay below
    player.grid = frame === settings.spinFrames - 1 ? finalGrid : E.randomGrid();
    player.statusText = frame < settings.spinFrames - 1 ? 'Spinning...' : 'Stopping...';
    emitRender(channelId);
  }
  player.grid = finalGrid; // make sure the stored grid is the one we actually evaluate

  const { totalPoints, wins } = E.evaluateGrid(finalGrid);
  const payout = wager * totalPoints; // pay on the FROZEN wager only - setBet can't move this any more

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
  } catch {
    newBal = 0;
  }

  const lobby = lobbies.get(channelId) || { lastEvent: null }; // live lobby for the footer, or a throwaway if it closed mid-spin
  if (wins.length > 0) {
    player.statusText = `Won ${payout.toLocaleString()} • ${totalPoints} pts × ${wager} • Bal ${newBal.toLocaleString()}`; // report the frozen wager
    lobby.lastEvent = `${player.username}: ${totalPoints} pts × ${wager} = +${payout.toLocaleString()} SGC, bal ${newBal.toLocaleString()}.`; // footer uses the frozen wager too
  } else {
    player.statusText = `Lost ${wager.toLocaleString()} • Bal ${newBal.toLocaleString()}`; // the amount actually lost
    lobby.lastEvent = `${player.username}: -${wager.toLocaleString()} SGC, bal ${newBal.toLocaleString()}.`; // footer shows the real loss
  }
  player.spinning = false; // spin finished: unlock the player for the next bet/spin
  player.activeWager = null; // nothing is riding any more

  emitEvent('spinComplete', {
    channelId,
    userId,
    bet: wager, // tell the adapter the wager that was actually debited and paid against
    payout,
    points: totalPoints,
    multiplier: totalPoints,
    winCount: wins.length,
    wins,
  });
  emitRender(channelId);
  if (lobbies.has(channelId)) startIdleTimer(channelId); // only re-arm the idle timer if a lobby still exists here
}

registerCommand('debugSnapshot', async ({ channelId } = {}) => {
  const lobby = lobbies.get(channelId);
  if (!lobby) return { exists: false };
  return {
    exists: true,
    playerCount: lobby.players.size,
    players: [...lobby.players.values()].map((player) => ({
      userId: player.userId,
      bet: player.bet,
      spinning: player.spinning,
      statusText: player.statusText,
    })),
  };
});

registerCommand('getLobby', async ({ channelId } = {}) => {
  const lobby = lobbies.get(channelId);
  if (!lobby) return { ok: false, exists: false };
  return { ok: true, exists: true, ...buildLobbyPayload(lobby) };
});

registerCommand('listLobbies', async () => ({
  ok: true,
  lobbies: [...lobbies.values()].map((lobby) => {
    const players = [...lobby.players.values()];
    return {
      channelId: lobby.channelId,
      playerCount: players.length,
      maxPlayers: settings.maxPlayers,
      lastEvent: lobby.lastEvent || 'Pick a bet, then pull the lever.',
      players: players.map((player) => ({
        userId: player.userId,
        username: player.username,
        bet: player.bet,
        spinning: player.spinning,
        statusText: player.statusText,
      })),
    };
  }),
}));
