'use strict';

/**
 * Smoke test for the worker-backed Texas Hold'em engine.
 *
 * One human + Lumi CPU. Drives the full lifecycle:
 *   play (isNew) → tableReady → CPU autoplays → human peeks/checks/folds →
 *   resolveLoneWinner → between → leave → tableClosed.
 *
 * Restores any net balance drift afterward.
 */

const path = require('node:path');
const store = require('../src/sadgirlEconomyStore');
const { manager } = require('../src/workers/workerManager');
const { logger } = require('../src/logger');

const TEST_DB = path.resolve(__dirname, '..', 'data', 'sadgirlcoin.sqlite3');
const TEST_USER = '__th_smoke_user__';
const TEST_USERNAME = 'th_smoke';
const TEST_CHANNEL = '__th_smoke_channel__';
const SEED_BALANCE = 500;
const TEST_BET = 5;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForEvent(events, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    // eslint-disable-next-line no-await-in-loop
    await sleep(20);
  }
  return null;
}

async function snapshot() {
  return manager.sendCommand('holdem', 'debugSnapshot', { channelId: TEST_CHANNEL }, { channelId: TEST_CHANNEL });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await snapshot();
    if (predicate(snap)) return snap;
    // eslint-disable-next-line no-await-in-loop
    await sleep(30);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

async function main() {
  store.initEconomyStore(TEST_DB);
  store.ensureAccount(TEST_USER, TEST_USERNAME);
  const startBal = store.getBalance(TEST_USER);
  if (startBal < SEED_BALANCE) {
    store.adjustBalance(TEST_USER, SEED_BALANCE - startBal, 'th-smoke seed');
  }
  const seededBal = store.getBalance(TEST_USER);

  manager.registerEngine('holdem', {
    scriptPath: path.resolve(__dirname, '..', 'src', 'workers', 'engines', 'holdem', 'worker.js'),
    poolSize: 1,
  });
  manager.start();

  const events = [];
  manager.onEngineEvent('holdem', (evt) => events.push(evt));

  // Speed everything way up: tiny CPU delay, short timeout, instant between-hands.
  await manager.sendCommand('holdem', 'setSettings', {
    cpuActionDelayMs: 20,
    actionTimeoutMs: 2_000,
    betweenHandsMs: 200,
    maxPlayers: 6,
  });
  logger.info('th-smoke: setSettings OK');

  const play = await manager.sendCommand(
    'holdem',
    'play',
    { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME, bet: TEST_BET },
    { channelId: TEST_CHANNEL },
  );
  if (!play.ok) throw new Error(`play failed: ${JSON.stringify(play)}`);
  if (!play.isNew) throw new Error('expected isNew=true');
  if (typeof play.content !== 'string') throw new Error('play missing content');
  if (!play.buttonState) throw new Error('play missing buttonState');
  logger.info('th-smoke: play OK (isNew, ante seated)');

  const ready = await manager.sendCommand('holdem', 'tableReady', { channelId: TEST_CHANNEL }, { channelId: TEST_CHANNEL });
  if (!ready.ok || !ready.started) throw new Error(`tableReady failed: ${JSON.stringify(ready)}`);
  logger.info('th-smoke: tableReady OK (hand started)');

  // Wait until the table is in a hand phase.
  const handSnap = await waitFor(
    (s) => s.exists && (['preflop', 'flop', 'turn', 'river'].includes(s.phase)),
    3000,
    'hand to begin',
  );
  logger.info(`th-smoke: in hand (phase=${handSnap.phase}, pot=${handSnap.pot})`);

  // Peek.
  const peek = await manager.sendCommand('holdem', 'peek', { channelId: TEST_CHANNEL, userId: TEST_USER }, { channelId: TEST_CHANNEL });
  if (!peek.ok) throw new Error(`peek failed: ${JSON.stringify(peek)}`);
  if (!/Your cards:/.test(peek.content)) throw new Error('peek content malformed');
  logger.info('th-smoke: peek OK');

  // It might be the CPU's turn first — wait until it's our turn.
  await waitFor((s) => s.exists && s.currentPlayerId === TEST_USER, 3000, 'human turn');

  // Fold to end the hand quickly.
  const fold = await manager.sendCommand('holdem', 'fold', { channelId: TEST_CHANNEL, userId: TEST_USER }, { channelId: TEST_CHANNEL });
  if (!fold.ok) throw new Error(`fold failed: ${JSON.stringify(fold)}`);
  logger.info('th-smoke: fold OK');

  // After fold, CPU wins by default → between phase → restart.
  // We should see at least a few render events after the fold.
  const renders = events.filter((e) => e.name === 'render').length;
  if (renders < 2) throw new Error(`expected several render events, got ${renders}`);
  logger.info(`th-smoke: render events OK (${renders})`);

  // Leave to close the table (CPU is the only seat left → adapter would close).
  events.length = 0;
  const leave = await manager.sendCommand('holdem', 'leave', { channelId: TEST_CHANNEL, userId: TEST_USER }, { channelId: TEST_CHANNEL });
  if (!leave.ok) throw new Error(`leave failed: ${JSON.stringify(leave)}`);
  const closed = await waitForEvent(events, (e) => e.name === 'tableClosed', 2000);
  if (!closed) throw new Error('no tableClosed event');
  logger.info('th-smoke: tableClosed OK');

  // Restore balance drift caused by the hand.
  const finalBal = store.getBalance(TEST_USER);
  const drift = finalBal - seededBal;
  if (drift !== 0) {
    store.adjustBalance(TEST_USER, -drift, 'th-smoke restore');
  }

  await manager.shutdown();
  store.closeEconomyStore();
  logger.info('th-smoke: PASS');
  process.exit(0);
}

main().catch((err) => {
  logger.error('th-smoke: FAIL', err && err.stack || err);
  process.exit(1);
});
