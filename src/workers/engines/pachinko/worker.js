'use strict';

/**
 * Pachinko engine worker.
 *
 * One drop = one command. The worker:
 *   - validates balance, places the bet via the DB broker
 *   - simulates the path
 *   - emits 'frame' events for each animation row
 *   - pays out, emits 'finalresult'
 *
 * The adapter on the main thread translates these events into editReply
 * calls on the original interaction's message.
 */

const { registerCommand, emitEvent, dbCall } = require('../../runtime');
const E = require('./engine');

let settings = { ...E.DEFAULTS };

const activeChannels = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

registerCommand('drop', async ({ channelId, userId, username, peg, bet } = {}) => {
  if (typeof channelId !== 'string' || typeof userId !== 'string') {
    return { ok: false, reason: 'bad_args' };
  }
  if (!Number.isInteger(peg) || peg < 1 || peg > settings.gridWidth) {
    return { ok: false, reason: 'bad_peg' };
  }
  if (!Number.isInteger(bet) || bet <= 0) {
    return { ok: false, reason: 'bad_bet' };
  }

  if (activeChannels.has(channelId)) {
    return { ok: false, reason: 'busy' };
  }

  await dbCall('ensureAccount', { userId, username });
  const balance = await dbCall('getBalance', { userId });
  if (balance < bet) {
    return { ok: false, reason: 'insufficient', balance, bet };
  }

  const placed = await dbCall('placePachinkoBet', { userId, username, amount: bet });
  if (!placed || !placed.success) {
    return { ok: false, reason: 'bet_failed', error: placed && placed.error };
  }

  activeChannels.add(channelId);

  // Run animation asynchronously; reply immediately so adapter can post the
  // initial message and listen for events.
  const path = E.simulateDrop(settings);
  const landedPos = path[path.length - 1];
  const landedPeg = landedPos + 1;
  const multiplier = E.getMultiplier(peg, landedPeg);
  const payout = Math.floor(bet * multiplier);

  setImmediate(() => { void runAnimation({ channelId, userId, username, peg, bet, path, landedPeg, multiplier, payout }); });

  return {
    ok: true,
    initial: {
      header: `🎰 **Pachinko!** ${username} bet **${bet.toLocaleString()} SGC** on peg **${peg}**`,
      firstRow: E.renderRow(path[0], settings.gridWidth),
    },
  };
});

async function runAnimation(ctx) {
  const { channelId, userId, peg, bet, path, landedPeg, multiplier, payout } = ctx;
  const header = `🎰 **Pachinko!** ${ctx.username} bet **${bet.toLocaleString()} SGC** on peg **${peg}**`;
  const rows = [E.renderRow(path[0], settings.gridWidth)];

  try {
    for (let row = 1; row < path.length; row++) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(settings.rowDelayMs);
      rows.push(E.renderRow(path[row], settings.gridWidth));
      emitEvent('frame', { channelId, content: `${header}\n${rows.join('\n')}` });
    }

    await sleep(settings.rowDelayMs);
    rows.push(E.renderPegNumbers(settings.gridWidth));
    emitEvent('frame', { channelId, content: `${header}\n${rows.join('\n')}` });

    if (payout > 0) {
      try {
        await dbCall('payPachinkoPayout', { userId, amount: payout });
      } catch (err) {
        emitEvent('payoutFailed', { channelId, userId, amount: payout, error: err && err.message });
      }
    }

    await sleep(Math.floor(settings.rowDelayMs / 2));

    const resultLines = [`<@${userId}> — Ball landed on peg **${landedPeg}**!`];
    if (multiplier === 2) {
      resultLines.push(`🎉 **EXACT HIT!** You win **${payout.toLocaleString()} SGC** (2×)!`);
    } else if (multiplier === 1.5) {
      resultLines.push(`✨ Close! 1 off — you win **${payout.toLocaleString()} SGC** (1.5×).`);
    } else if (multiplier === 1) {
      resultLines.push(`😐 2 off — you get your bet back: **${payout.toLocaleString()} SGC** (1×).`);
    } else {
      resultLines.push(`💀 Too far off — you lose **${bet.toLocaleString()} SGC**. Better luck next time!`);
    }

    emitEvent('finalresult', {
      channelId, userId, peg, bet, landedPeg, multiplier, payout,
      resultText: resultLines.join('\n'),
    });
  } finally {
    activeChannels.delete(channelId);
  }
}
