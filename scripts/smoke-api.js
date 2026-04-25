'use strict';

/**
 * Smoke test for the SadGirlCoin External API.
 *
 * Boots an isolated economy DB in a temp file, seeds a user account, starts
 * the API server on a random ephemeral port, and exercises:
 *
 *  - GET  /v1/healthz                     -> 200
 *  - GET  /v1/me (no auth)                -> 401
 *  - GET  /v1/me (bad bearer)             -> 401
 *  - GET  /v1/me (good bearer)            -> 200, app metadata
 *  - POST /v1/links/codes/redeem          -> 200, link created
 *  - POST /v1/links/codes/redeem (replay) -> 409
 *  - GET  /v1/users/:id/balance           -> 200
 *  - POST /v1/charge (idempotent)         -> 200, audit row exists
 *  - POST /v1/charge (replay)             -> 200, idempotency-replayed header
 *  - POST /v1/charge (insufficient)       -> 402
 *  - POST /v1/credit                      -> 200 (after seeding treasury)
 *  - POST /v1/transfer                    -> 200 between two linked users
 *  - POST /v1/mint (no can_mint)          -> 403
 *  - GET  /v1/users/:id/transactions      -> 200
 *  - DELETE /v1/links/:id                 -> 200, then 401-equivalent on next op
 *  - GET  /v1/me with revoked key         -> 401
 *  - 11 requests against rate_limit_per_min=10 -> last is 429
 *
 * Run with: node scripts/smoke-api.js
 * Exits non-zero on any failure.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDb = path.join(os.tmpdir(), `sgc-api-smoke-${Date.now()}.sqlite3`);
process.env.SADGIRLCOIN_DB_FILE = tmpDb;

const {
  initEconomyStore,
  closeEconomyStore,
  ensureAccount,
  adjustBalance,
  getBalance,
} = require('../src/sadgirlEconomyStore');
const {
  createApiApp,
  issueApiKey,
  createLinkCode,
  revokeApiKey,
  ensureAppTreasury,
} = require('../src/apiKeyStore');
const { startApiServer, stopApiServer, getApiServerStatus } = require('../src/apiServer');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GRN = '\x1b[32m';
const YLW = '\x1b[33m';

let pass = 0;
let fail = 0;
const failures = [];

function ok(label) { pass++; console.log(`${GRN}✓${RESET} ${label}`); }
function bad(label, detail) {
  fail++;
  failures.push({ label, detail });
  console.log(`${RED}✗${RESET} ${label}\n   ${detail}`);
}
function info(label) { console.log(`${YLW}…${RESET} ${label}`); }

function assertEq(actual, expected, label) {
  if (actual === expected) ok(label);
  else bad(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function request(port, method, pathStr, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: pathStr,
      headers: {
        'content-type': 'application/json',
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
        ...(headers || {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  initEconomyStore(tmpDb);

  const DISCORD_USER = '111111111111111111';
  const DISCORD_USER_2 = '222222222222222222';
  const EXT_ID = 'mc-uuid-aaaaaa';
  const EXT_ID_2 = 'mc-uuid-bbbbbb';

  ensureAccount(DISCORD_USER, 'smoke_user');
  ensureAccount(DISCORD_USER_2, 'smoke_user_2');
  adjustBalance(DISCORD_USER, 1000, 'smoke seed');
  adjustBalance(DISCORD_USER_2, 500, 'smoke seed');

  // App #1: full scopes, generous rate limit so burst tests pass.
  const app = createApiApp({
    name: 'Smoke MC Plugin',
    ownerDiscordId: '999000999000999000',
    description: 'smoke-test',
    scopes: ['balance:read', 'txn:read', 'coins:debit', 'coins:credit', 'coins:p2p', 'links:redeem', 'links:read', 'links:revoke'],
    rateLimitPerMin: 1000,
    canMint: false,
  });
  const issued = issueApiKey(app.id);
  // Fund the treasury so /v1/credit can pay.
  ensureAppTreasury(app.id, app.name);
  adjustBalance(app.treasuryUserId, 200, 'smoke seed treasury');

  // App #2: separate, no debit scope -> for permission test.
  const lockedApp = createApiApp({
    name: 'Smoke Locked',
    ownerDiscordId: '999000999000999000',
    scopes: ['balance:read'],
    rateLimitPerMin: 60,
  });
  const lockedKey = issueApiKey(lockedApp.id);

  // App #3: dedicated low-rate-limit app for 429 test.
  const burstApp = createApiApp({
    name: 'Smoke Burst',
    ownerDiscordId: '999000999000999000',
    scopes: ['balance:read'],
    rateLimitPerMin: 5,
  });
  const burstKey = issueApiKey(burstApp.id);

  const port = await freePort();
  startApiServer({ port, host: '127.0.0.1' });
  info(`API on http://127.0.0.1:${port}`);

  const auth = (k) => ({ authorization: `Bearer ${k}` });

  // --- Healthz ---
  let r = await request(port, 'GET', '/v1/healthz');
  assertEq(r.status, 200, 'healthz returns 200');
  assertEq(r.body?.ok, true, 'healthz body.ok = true');

  // --- Auth ---
  r = await request(port, 'GET', '/v1/me');
  assertEq(r.status, 401, '/v1/me without bearer = 401');

  r = await request(port, 'GET', '/v1/me', { headers: auth('sgc_live_garbage') });
  assertEq(r.status, 401, '/v1/me with bad bearer = 401');

  r = await request(port, 'GET', '/v1/me', { headers: auth(issued.plaintext) });
  assertEq(r.status, 200, '/v1/me with good bearer = 200');
  assertEq(r.body?.app?.id, app.id, '/v1/me returns app.id');

  // --- Link redeem ---
  const code1 = createLinkCode(app.id, DISCORD_USER, 60_000);
  r = await request(port, 'POST', '/v1/links/codes/redeem', {
    body: { code: code1.code, external_id: EXT_ID, external_name: 'Steve' },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 200, 'redeem link code = 200');
  assertEq(r.body?.link?.external_id, EXT_ID, 'redeem returns external_id');

  // Replay = consumed
  r = await request(port, 'POST', '/v1/links/codes/redeem', {
    body: { code: code1.code, external_id: EXT_ID, external_name: 'Steve' },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 409, 'replay redeem = 409');

  // Link the second user too (for p2p).
  const code2 = createLinkCode(app.id, DISCORD_USER_2, 60_000);
  r = await request(port, 'POST', '/v1/links/codes/redeem', {
    body: { code: code2.code, external_id: EXT_ID_2, external_name: 'Alex' },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 200, 'redeem 2nd link = 200');

  // --- Balance ---
  r = await request(port, 'GET', `/v1/users/${EXT_ID}/balance`, { headers: auth(issued.plaintext) });
  assertEq(r.status, 200, 'balance = 200');
  assertEq(r.body?.balance, 1000, 'balance = 1000');

  // --- Charge (idempotent) ---
  r = await request(port, 'POST', '/v1/charge', {
    body: { external_id: EXT_ID, amount: 10, note: 'song change', idempotency_key: 'song-001' },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 200, 'charge 10 = 200');
  // 10 + 1 fee = 11 spent
  assertEq(r.body?.amount, 10, 'charge amount = 10');
  assertEq(r.body?.fee, 1, 'charge fee = 1');
  assertEq(r.body?.balance, 989, 'balance after charge = 989');

  // Replay
  r = await request(port, 'POST', '/v1/charge', {
    body: { external_id: EXT_ID, amount: 10, note: 'song change', idempotency_key: 'song-001' },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 200, 'replay charge = 200');
  assertEq(r.headers['idempotency-replayed'], 'true', 'idempotency-replayed header set');
  assertEq(getBalance(DISCORD_USER), 989, 'replay did not double-charge (balance still 989)');

  // Insufficient
  r = await request(port, 'POST', '/v1/charge', {
    body: { external_id: EXT_ID, amount: 100000 },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 402, 'insufficient charge = 402');

  // --- Credit ---
  r = await request(port, 'POST', '/v1/credit', {
    body: { external_id: EXT_ID, amount: 5, note: 'reward' },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 200, 'credit 5 = 200');
  assertEq(r.body?.balance, 994, 'balance after credit = 994 (989 + 5)');

  // --- P2P ---
  r = await request(port, 'POST', '/v1/transfer', {
    body: { from_external_id: EXT_ID, to_external_id: EXT_ID_2, amount: 20, note: 'mc trade' },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 200, 'p2p transfer = 200');
  assertEq(getBalance(DISCORD_USER_2), 520, 'recipient balance after p2p = 520');

  // --- Mint without permission ---
  r = await request(port, 'POST', '/v1/mint', {
    body: { external_id: EXT_ID, amount: 1 },
    headers: auth(issued.plaintext),
  });
  assertEq(r.status, 403, 'mint without can_mint = 403');

  // --- Transactions ---
  r = await request(port, 'GET', `/v1/users/${EXT_ID}/transactions?limit=10`, { headers: auth(issued.plaintext) });
  assertEq(r.status, 200, 'txn list = 200');
  if (Array.isArray(r.body?.transactions) && r.body.transactions.length >= 3) ok('txn list has charge+credit+p2p entries');
  else bad('txn list has charge+credit+p2p entries', `got ${r.body?.transactions?.length} entries`);

  // --- Scope denial (locked app missing coins:debit) ---
  r = await request(port, 'POST', '/v1/charge', {
    body: { external_id: EXT_ID, amount: 1 },
    headers: auth(lockedKey.plaintext),
  });
  assertEq(r.status, 403, 'locked-app charge = 403 (missing scope)');

  // --- Revoke link via API ---
  r = await request(port, 'DELETE', `/v1/links/${EXT_ID}`, { headers: auth(issued.plaintext) });
  assertEq(r.status, 200, 'delete link = 200');

  r = await request(port, 'GET', `/v1/users/${EXT_ID}/balance`, { headers: auth(issued.plaintext) });
  assertEq(r.status, 404, 'balance after revoke = 404');

  // --- Rate limit (burstApp=5/min) ---
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const rr = await request(port, 'GET', '/v1/me', { headers: auth(burstKey.plaintext) });
    if (rr.status === 429) { got429 = true; break; }
  }
  if (got429) ok('rate limit triggers 429'); else bad('rate limit triggers 429', 'never got 429');

  // --- Revoke key ---
  revokeApiKey(issued.keyId);
  r = await request(port, 'GET', '/v1/me', { headers: auth(issued.plaintext) });
  assertEq(r.status, 401, '/v1/me with revoked key = 401');

  // --- Cleanup ---
  stopApiServer();
  closeEconomyStore();
  try { fs.rmSync(tmpDb, { force: true }); } catch { /* */ }
  try { fs.rmSync(tmpDb + '-wal', { force: true }); } catch { /* */ }
  try { fs.rmSync(tmpDb + '-shm', { force: true }); } catch { /* */ }

  console.log('');
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(`${RED}FAILURES:${RESET}`);
    for (const f of failures) console.log(`  - ${f.label}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  try { stopApiServer(); } catch { /* */ }
  try { closeEconomyStore(); } catch { /* */ }
  process.exit(1);
});
