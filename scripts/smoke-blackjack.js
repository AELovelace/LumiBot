'use strict';

/**
 * Smoke test for the worker-backed Blackjack engine.
 *
 * Spawns a single worker (with GAME_WORKERS_BLACKJACK semantics) and
 * exercises:
 *   1. setSettings — reduce idle/between-hands so the test runs fast.
 *   2. play — a single player joins (forces a known card sequence is NOT
 *      attempted; only ok-shape is verified).
 *   3. stay — single player resolves the hand, expects finalresults
 *      and then a newhand event after BETWEEN_HANDS_MS.
 *   4. leave — player leaves between hands; tableClosed event is fired.
 *
 * Uses the real economy DB so the broker can place/refund bets. After
 * the run the test reverses any net change so it's safe to re-run.
 */

const path = require('node:path');

const { initEconomyStore, closeEconomyStore, ensureAccount, adjustBalance, getBalance } =
  require('../src/sadgirlEconomyStore');
const { manager } = require('../src/workers/workerManager');
const { logger } = require('../src/logger');

const TEST_DB = path.resolve(__dirname, '..', 'data', 'sadgirlcoin.sqlite3');
const TEST_USER = '__bj_smoke_user__';
const TEST_USERNAME = 'bj_smoke';
const TEST_CHANNEL = '__bj_smoke_channel__';
const TEST_BET = 5;
const SEED_BALANCE = 200;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForEvent(events, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await wait(25);
  }
  throw new Error(`timed out waiting for event matching predicate`);
}

async function main() {
  initEconomyStore(TEST_DB);

  // Seed the test account so the worker can place a bet.
  ensureAccount(TEST_USER, TEST_USERNAME);
  const startingBalance = getBalance(TEST_USER);
  if (startingBalance < SEED_BALANCE) {
    adjustBalance(TEST_USER, SEED_BALANCE - startingBalance, 'bj smoke seed');
  }
  const seededBalance = getBalance(TEST_USER);

  manager.registerEngine('blackjack', {
    scriptPath: path.resolve(__dirname, '..', 'src', 'workers', 'engines', 'blackjack', 'worker.js'),
    poolSize: 1,
  });

  const events = [];
  manager.onEngineEvent('blackjack', (evt) => {
    if (evt && evt.channelId === TEST_CHANNEL) events.push(evt);
  });

  manager.start();

  try {
    // 1) Tighten timings so resolve + newhand happen quickly.
    await manager.sendCommand('blackjack', 'setSettings', {
      idleTimeoutMs: 250,
      betweenHandsMs: 200,
    });
    logger.info('bj-smoke: setSettings OK');

    // 2) Play.
    const play = await manager.sendCommand('blackjack', 'play', {
      channelId: TEST_CHANNEL,
      userId: TEST_USER,
      username: TEST_USERNAME,
      bet: TEST_BET,
    }, { channelId: TEST_CHANNEL });
    if (!play.ok) throw new Error(`play failed: ${JSON.stringify(play)}`);
    if (!play.isNew) throw new Error('expected isNew=true on first play');
    if (!play.content || !play.content.includes('Blackjack Table')) {
      throw new Error('play render content missing');
    }
    logger.info('bj-smoke: play OK');

    // 3) Stay -> resolve. Some hands may natural-21 and willResolve fires
    //    immediately on play; handle both.
    if (!play.willResolve) {
      const stay = await manager.sendCommand('blackjack', 'stay', {
        channelId: TEST_CHANNEL, userId: TEST_USER,
      }, { channelId: TEST_CHANNEL });
      if (!stay.ok) throw new Error(`stay failed: ${JSON.stringify(stay)}`);
      if (!stay.willResolve) throw new Error('expected willResolve after solo stay');
    }
    logger.info('bj-smoke: stay/auto-resolve scheduled');

    // 4) Wait for finalresults render then a newhand render.
    await waitForEvent(events, (e) => e.name === 'render' && e.action === 'finalresults');
    logger.info('bj-smoke: finalresults event OK');
    await waitForEvent(events, (e) => e.name === 'render' && e.action === 'newhand', 6_000);
    logger.info('bj-smoke: newhand event OK');

    // 5) Leave -> tableClosed (sole player).
    const leave = await manager.sendCommand('blackjack', 'leave', {
      channelId: TEST_CHANNEL, userId: TEST_USER,
    }, { channelId: TEST_CHANNEL });
    if (!leave.ok) throw new Error(`leave failed: ${JSON.stringify(leave)}`);
    if (!leave.closed) throw new Error('expected closed=true on solo leave');
    await waitForEvent(events, (e) => e.name === 'tableClosed');
    logger.info('bj-smoke: tableClosed event OK');

    logger.info('bj-smoke: PASS');
  } finally {
    // Restore the test account's balance to its pre-test value so reruns
    // start from a known state (we don't care about exact win/loss math
    // for the smoke run; we just don't want the account to drift).
    try {
      const finalBalance = getBalance(TEST_USER);
      const drift = finalBalance - seededBalance;
      if (drift !== 0) adjustBalance(TEST_USER, -drift, 'bj smoke cleanup');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('bj-smoke: cleanup failed', err.message);
    }
    try { await manager.shutdown(); } catch { /* ignore */ }
    try { closeEconomyStore(); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('bj-smoke: FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
