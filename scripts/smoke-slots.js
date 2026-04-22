'use strict';

/**
 * Smoke test for the worker-backed Slots engine.
 *
 * Exercises join → setBet → spin → spinComplete event → leave →
 * lobbyClosed event using the real economy DB. Restores any net
 * balance drift on cleanup.
 */

const path = require('node:path');
const store = require('../src/sadgirlEconomyStore');
const { manager } = require('../src/workers/workerManager');
const { logger } = require('../src/logger');

const TEST_DB = path.resolve(__dirname, '..', 'data', 'sadgirlcoin.sqlite3');
const TEST_USER = '__sl_smoke_user__';
const TEST_USERNAME = 'sl_smoke';
const TEST_CHANNEL = '__sl_smoke_channel__';
const SEED_BALANCE = 200;
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

async function main() {
  store.initEconomyStore(TEST_DB);
  store.ensureAccount(TEST_USER, TEST_USERNAME);
  const startBal = store.getBalance(TEST_USER);
  if (startBal < SEED_BALANCE) {
    store.adjustBalance(TEST_USER, SEED_BALANCE - startBal, 'sl-smoke seed');
  }
  const seededBal = store.getBalance(TEST_USER);

  manager.registerEngine('slots', {
    scriptPath: path.resolve(__dirname, '..', 'src', 'workers', 'engines', 'slots', 'worker.js'),
    poolSize: 1,
  });
  manager.start();

  const events = [];
  manager.onEngineEvent('slots', (evt) => events.push(evt));

  // Speed everything up.
  await manager.sendCommand('slots', 'setSettings', { spinFrames: 3, spinFrameMs: 20, idleTimeoutMs: 5000 });
  logger.info('sl-smoke: setSettings OK');

  const join = await manager.sendCommand('slots', 'join', { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME }, { channelId: TEST_CHANNEL });
  if (!join.ok) throw new Error(`join failed: ${JSON.stringify(join)}`);
  if (!join.isNew) throw new Error('expected isNew=true');
  if (!join.embed || !Array.isArray(join.embed.fields)) throw new Error('join missing embed payload');
  logger.info('sl-smoke: join OK');

  const setBet = await manager.sendCommand('slots', 'setBet', { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME, amount: TEST_BET }, { channelId: TEST_CHANNEL });
  if (!setBet.ok) throw new Error(`setBet failed: ${JSON.stringify(setBet)}`);
  logger.info('sl-smoke: setBet OK');

  const spin = await manager.sendCommand('slots', 'spin', { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME }, { channelId: TEST_CHANNEL });
  if (!spin.ok) throw new Error(`spin failed: ${JSON.stringify(spin)}`);
  logger.info('sl-smoke: spin OK');

  const complete = await waitForEvent(events, (e) => e.name === 'spinComplete' && e.userId === TEST_USER, 5000);
  if (!complete) throw new Error('no spinComplete event');
  logger.info(`sl-smoke: spinComplete OK (bet=${complete.bet} payout=${complete.payout} mult=${complete.multiplier} wins=${complete.winCount})`);

  // We should have received several render events through the spin.
  const renders = events.filter((e) => e.name === 'render').length;
  if (renders < 2) throw new Error(`expected >=2 render events, got ${renders}`);
  logger.info(`sl-smoke: render events OK (${renders})`);

  // Leave to close the lobby.
  events.length = 0;
  const leave = await manager.sendCommand('slots', 'leave', { channelId: TEST_CHANNEL, userId: TEST_USER }, { channelId: TEST_CHANNEL });
  if (!leave.ok || !leave.closed) throw new Error(`leave failed: ${JSON.stringify(leave)}`);
  const closed = await waitForEvent(events, (e) => e.name === 'lobbyClosed', 2000);
  if (!closed) throw new Error('no lobbyClosed event');
  logger.info('sl-smoke: lobbyClosed OK');

  // Restore any balance drift (we placed a bet and possibly got a payout).
  const finalBal = store.getBalance(TEST_USER);
  const drift = finalBal - seededBal;
  if (drift !== 0) {
    store.adjustBalance(TEST_USER, -drift, 'sl-smoke restore');
  }

  await manager.shutdown();
  store.closeEconomyStore();
  logger.info('sl-smoke: PASS');
  process.exit(0);
}

main().catch((err) => {
  logger.error('sl-smoke: FAIL', err && err.stack || err);
  process.exit(1);
});
