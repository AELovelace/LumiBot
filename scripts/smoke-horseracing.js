'use strict';

/**
 * Smoke test for the worker-backed Horseracing engine.
 *
 * Drives a full lifecycle: join (isNew) → pickHorse → setBet →
 * wait for raceStart + raceFinished (driven by the betting timer) →
 * leave → wait for lobbyClosed. Restores any balance drift afterward.
 */

const path = require('node:path');
const store = require('../src/sadgirlEconomyStore');
const { manager } = require('../src/workers/workerManager');
const { logger } = require('../src/logger');

const TEST_DB = path.resolve(__dirname, '..', 'data', 'sadgirlcoin.sqlite3');
const TEST_USER = '__hr_smoke_user__';
const TEST_USERNAME = 'hr_smoke';
const TEST_CHANNEL = '__hr_smoke_channel__';
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
    store.adjustBalance(TEST_USER, SEED_BALANCE - startBal, 'hr-smoke seed');
  }
  const seededBal = store.getBalance(TEST_USER);

  manager.registerEngine('horseracing', {
    scriptPath: path.resolve(__dirname, '..', 'src', 'workers', 'engines', 'horseracing', 'worker.js'),
    poolSize: 1,
  });
  manager.start();

  const events = [];
  manager.onEngineEvent('horseracing', (evt) => events.push(evt));

  // Speed everything up so the full lifecycle runs in <2s.
  await manager.sendCommand('horseracing', 'setSettings', {
    bettingWindowMs: 250,
    raceTickMs: 10,
    trackWidth: 8,
    defaultBet: TEST_BET,
  });
  logger.info('hr-smoke: setSettings OK');

  const join = await manager.sendCommand(
    'horseracing',
    'join',
    { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME },
    { channelId: TEST_CHANNEL },
  );
  if (!join.ok) throw new Error(`join failed: ${JSON.stringify(join)}`);
  if (!join.isNew) throw new Error('expected isNew=true');
  if (typeof join.content !== 'string' || join.content.length === 0) throw new Error('join missing initial content');
  logger.info('hr-smoke: join OK');

  const pick = await manager.sendCommand(
    'horseracing',
    'pickHorse',
    { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME, horse: 'A' },
    { channelId: TEST_CHANNEL },
  );
  if (!pick.ok) throw new Error(`pickHorse failed: ${JSON.stringify(pick)}`);
  logger.info('hr-smoke: pickHorse OK');

  const setBet = await manager.sendCommand(
    'horseracing',
    'setBet',
    { channelId: TEST_CHANNEL, userId: TEST_USER, username: TEST_USERNAME, amount: TEST_BET },
    { channelId: TEST_CHANNEL },
  );
  if (!setBet.ok) throw new Error(`setBet failed: ${JSON.stringify(setBet)}`);
  logger.info('hr-smoke: setBet OK');

  const raceStart = await waitForEvent(events, (e) => e.name === 'raceStart', 2000);
  if (!raceStart) throw new Error('no raceStart event');
  logger.info('hr-smoke: raceStart OK');

  const raceFinished = await waitForEvent(events, (e) => e.name === 'raceFinished', 5000);
  if (!raceFinished) throw new Error('no raceFinished event');
  const frames = events.filter((e) => e.name === 'raceFrame').length;
  if (frames < 1) throw new Error(`expected >=1 raceFrame, got ${frames}`);
  logger.info(`hr-smoke: raceFinished OK (${frames} frames)`);

  // After race finishes, the lobby restarts a new betting round.
  // Leave to drain the lobby + close it down.
  events.length = 0;
  const leave = await manager.sendCommand(
    'horseracing',
    'leave',
    { channelId: TEST_CHANNEL, userId: TEST_USER },
    { channelId: TEST_CHANNEL },
  );
  if (!leave.ok) throw new Error(`leave failed: ${JSON.stringify(leave)}`);
  const closed = await waitForEvent(events, (e) => e.name === 'lobbyClosed', 2000);
  if (!closed) throw new Error('no lobbyClosed event');
  logger.info('hr-smoke: lobbyClosed OK');

  // Restore any balance drift caused by the race.
  const finalBal = store.getBalance(TEST_USER);
  const drift = finalBal - seededBal;
  if (drift !== 0) {
    store.adjustBalance(TEST_USER, -drift, 'hr-smoke restore');
  }

  await manager.shutdown();
  store.closeEconomyStore();
  logger.info('hr-smoke: PASS');
  process.exit(0);
}

main().catch((err) => {
  logger.error('hr-smoke: FAIL', err && err.stack || err);
  process.exit(1);
});
