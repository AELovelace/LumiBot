'use strict';

/**
 * Smoke test for the public leaderboard HTTP server.
 *
 * Starts the server on an ephemeral high port, hits / and /healthz,
 * /healthz, and verifies the rendered HTML mirror file is written.
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../src/sadgirlEconomyStore');
const { startLeaderboardServer, stopLeaderboardServer, getLeaderboardServerStatus } = require('../src/leaderboardServer');
const { logger } = require('../src/logger');

const TEST_DB = path.resolve(__dirname, '..', 'data', 'sadgirlcoin.sqlite3');
const PORT = 7790; // ephemeral, unlikely to clash
const HOST = '127.0.0.1';
const OUTPUT_FILE = path.join(os.tmpdir(), `lb-smoke-${process.pid}.html`);

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path: pathname }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

async function main() {
  store.initEconomyStore(TEST_DB);

  startLeaderboardServer({ port: PORT, host: HOST, outputFile: OUTPUT_FILE });
  // Give the listen() callback a tick to land.
  await new Promise((r) => setTimeout(r, 100));

  const status = getLeaderboardServerStatus();
  if (!status.running) throw new Error('server not running');
  if (status.port !== PORT) throw new Error(`port mismatch: ${status.port}`);
  logger.info(`lb-smoke: server up on ${status.host}:${status.port}`);

  const root = await get('/');
  if (root.status !== 200) throw new Error(`/ status ${root.status}`);
  if (!/SADGIRLCOIN/.test(root.body)) throw new Error('/ html missing SADGIRLCOIN title');
  if (!/TOP 50 HOLDERS/.test(root.body)) throw new Error('/ html missing top holders section');
  if (!/PATRONS/.test(root.body)) throw new Error('/ html missing patrons section');
  if (!/auto-reloads every 60s/.test(root.body)) throw new Error('/ html missing refresh blurb');
  logger.info(`lb-smoke: GET / OK (${root.body.length} bytes)`);

  const json = await get('/api/leaderboard.json');
  if (json.status !== 404) throw new Error(`/api/leaderboard.json should be removed, got ${json.status}`);
  logger.info('lb-smoke: GET /api/leaderboard.json correctly disabled (404)');

  const health = await get('/healthz');
  if (health.status !== 200 || health.body !== 'ok') throw new Error('healthz failed');
  logger.info('lb-smoke: GET /healthz OK');

  const missing = await get('/does-not-exist');
  if (missing.status !== 404) throw new Error(`expected 404, got ${missing.status}`);
  logger.info('lb-smoke: GET /does-not-exist OK (404)');

  if (!fs.existsSync(OUTPUT_FILE)) throw new Error(`mirror file not written: ${OUTPUT_FILE}`);
  const fileBytes = fs.statSync(OUTPUT_FILE).size;
  if (fileBytes < 500) throw new Error(`mirror file suspiciously small: ${fileBytes} bytes`);
  logger.info(`lb-smoke: HTML mirror file written (${fileBytes} bytes)`);

  stopLeaderboardServer();
  store.closeEconomyStore();
  try { fs.unlinkSync(OUTPUT_FILE); } catch { /* ignore */ }
  logger.info('lb-smoke: PASS');
  process.exit(0);
}

main().catch((err) => {
  logger.error('lb-smoke: FAIL', err && err.stack || err);
  try { stopLeaderboardServer(); } catch { /* ignore */ }
  process.exit(1);
});
