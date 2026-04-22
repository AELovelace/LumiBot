'use strict';

/**
 * Smoke test for the Pachinko worker engine.
 * Seeds a test user with a balance, fires a drop, listens for frame
 * events and the final result, then restores the balance.
 */

const path = require('node:path');
const { manager } = require('../src/workers/workerManager');
const store = require('../src/sadgirlEconomyStore');
const { logger } = require('../src/logger');

const TEST_DB = path.resolve(__dirname, '..', 'data', 'sadgirlcoin.sqlite3');

const TEST_USER = '__pk_smoke_user__';
const TEST_USERNAME = '__pk_smoke_user__';
const TEST_CHANNEL = '__pk_smoke_channel__';
const SEED_BALANCE = 200;
const TEST_BET = 5;
const TEST_PEG = 5;

async function main() {
  store.initEconomyStore(TEST_DB);
  store.ensureAccount(TEST_USER, TEST_USERNAME);
  const startBal = store.getBalance(TEST_USER);
  if (startBal < SEED_BALANCE) {
    store.adjustBalance(TEST_USER, SEED_BALANCE - startBal, 'pk-smoke seed');
  }
  const seededBal = store.getBalance(TEST_USER);

  manager.registerEngine('pachinko', {
    scriptPath: path.resolve(__dirname, '..', 'src', 'workers', 'engines', 'pachinko', 'worker.js'),
    poolSize: 1,
  });
  manager.start();

  const events = [];
  manager.onEngineEvent('pachinko', (evt) => { events.push(evt); });

  // Speed up the animation so the smoke test runs quickly.
  await manager.sendCommand('pachinko', 'setSettings', { rowDelayMs: 5 });
  logger.info('pk-smoke: setSettings OK');

  const result = await manager.sendCommand(
    'pachinko',
    'drop',
    { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME, peg: TEST_PEG, bet: TEST_BET },
    { channelId: TEST_CHANNEL },
  );
  if (!result.ok) throw new Error(`drop failed: ${JSON.stringify(result)}`);
  logger.info('pk-smoke: drop OK');

  const final = await waitFor(events, (e) => e.name === 'finalresult', 5000);
  if (!final) throw new Error('no finalresult event');
  if (final.channelId !== TEST_CHANNEL) throw new Error('finalresult channelId mismatch');
  if (typeof final.payout !== 'number') throw new Error('finalresult missing payout');
  logger.info(`pk-smoke: finalresult OK (landed ${final.landedPeg}, mult ${final.multiplier}\u00d7, payout ${final.payout})`);

  // Drop a moment so the worker can release the activeChannels lock and
  // settle any final logging.
  await sleep(100);

  // Restore balance drift.
  const finalBal = store.getBalance(TEST_USER);
  const drift = finalBal - seededBal;
  if (drift !== 0) {
    store.adjustBalance(TEST_USER, -drift, 'pk-smoke restore');
  }

  await manager.shutdown();
  store.closeEconomyStore();
  logger.info('pk-smoke: PASS');
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(events, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    // eslint-disable-next-line no-await-in-loop
    await sleep(20);
  }
  return null;
}

main().catch((err) => {
  logger.error('pk-smoke: FAIL', err && err.stack || err);
  process.exit(1);
});
