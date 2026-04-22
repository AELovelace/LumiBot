'use strict';

/**
 * Smoke test for the Phase 1 worker runtime.
 *
 * Spawns the echo engine with a small pool, then:
 *   1. Round-trips a command + reply.
 *   2. Verifies engine event delivery to the main process.
 *   3. Exercises a brokered DB call (getBalance) for an unknown user
 *      so it returns 0 without needing a populated database.
 *
 * This script does NOT touch Discord; it validates only the worker IPC
 * machinery added in Phase 1. Run with: `node scripts/smoke-workers.js`.
 */

const path = require('node:path');

// Initialise the economy store so the broker has a DB handle to talk to.
const { initEconomyStore, closeEconomyStore } = require('../src/sadgirlEconomyStore');
const { manager } = require('../src/workers/workerManager');
const { logger } = require('../src/logger');

const TEST_DB = path.resolve(__dirname, '..', 'data', 'sadgirlcoin.sqlite3');

async function main() {
  initEconomyStore(TEST_DB);

  manager.registerEngine('echo', {
    scriptPath: path.resolve(__dirname, '..', 'src', 'workers', 'engines', 'echo', 'worker.js'),
    poolSize: 2,
  });

  const events = [];
  manager.onEngineEvent('echo', (evt) => events.push(evt));

  manager.start();

  // 1) Command round-trip.
  const echoed = await manager.sendCommand('echo', 'echo', { value: 'hello' });
  if (!echoed || echoed.value !== 'hello') {
    throw new Error(`echo round-trip failed: ${JSON.stringify(echoed)}`);
  }
  logger.info('smoke: echo round-trip OK');

  // 2) Event delivery (give Node a tick to flush the message channel).
  await manager.sendCommand('echo', 'emit', { name: 'smoke', payload: { ok: 1 } });
  await new Promise((r) => setImmediate(r));
  const sawEvent = events.some((e) => e.name === 'smoke' && e.ok === 1);
  if (!sawEvent) {
    throw new Error(`event delivery failed; received: ${JSON.stringify(events)}`);
  }
  logger.info('smoke: event delivery OK');

  // 3) Brokered DB call. An unknown user yields a 0 balance, which is
  //    a safe read that exercises the full RPC path without mutation.
  const balance = await manager.sendCommand('echo', 'balance', {
    userId: '__smoke_unknown_user__',
  });
  if (balance !== 0) {
    throw new Error(`brokered db call returned unexpected balance: ${balance}`);
  }
  logger.info('smoke: brokered db call OK');

  await manager.shutdown();
  closeEconomyStore();
  logger.info('smoke: PASS');
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('smoke: FAIL', err && err.stack ? err.stack : err);
  try { await manager.shutdown(); } catch { /* ignore */ }
  try { closeEconomyStore(); } catch { /* ignore */ }
  process.exit(1);
});
