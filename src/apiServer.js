'use strict';

/**
 * SadGirlCoin External API — public HTTP server.
 *
 * Exposes a JSON REST API on its own port (default 7788) that lets registered
 * third-party apps (Minecraft plugins, sister bots, web apps) read balances,
 * charge/credit linked Discord users, transfer between linked users, and
 * (with privilege) mint new SGC.
 *
 * Auth model:
 *   - Each app has one or more `sgc_live_*` bearer tokens issued via the web
 *     control panel.
 *   - Discord users link to an app via /linkapp -> redeem one-time code.
 *   - Once linked, the app can debit the user freely within its scopes and
 *     rate-limit budget. Users revoke with /unlinkapp; admin can disable the
 *     entire app from the panel.
 *
 * No new dependencies — raw `node:http`, mirroring src/leaderboardServer.js
 * and src/webPanel.js conventions.
 */

const http = require('node:http');
const { URL } = require('node:url');

const { logger } = require('./logger');
const { getBalance } = require('./sadgirlEconomyStore');
const {
  lookupApiKey,
  consumeLinkCode,
  getLinkByExternal,
  revokeLinkByExternal,
  apiChargeUser,
  apiCreditUser,
  apiP2PTransfer,
  apiUserTransactions,
  getIdempotentResponse,
  storeIdempotentResponse,
  purgeOldIdempotency,
  purgeExpiredLinkCodes,
  checkRateLimit,
  trackRequest,
  cleanUpRateLimitLog,
} = require('./apiKeyStore');

let server = null;
let host = '0.0.0.0';
let port = 7788;
let linkCodeTtlMs = 600_000;
let purgeTimer = null;

const MAX_BODY_BYTES = 8 * 1024;

// ---------------------------------------------------------------------------
// Per-app rate limiting (token bucket; same pattern as leaderboardServer.js).
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map(); // appId -> { count, windowStart }

// Rate limiting for link code redemption (per Discord ID + per IP)
const REDEEM_RATE_WINDOW_MS = 60_000;
const redeemBucketsDiscord = new Map(); // discordId -> { count, windowStart }
const redeemBucketsIp = new Map(); // clientIp -> { count, windowStart }

function rateLimitRedeemDiscord(discordId) {
  const now = Date.now();
  const bucket = redeemBucketsDiscord.get(discordId);
  if (!bucket || now - bucket.windowStart >= REDEEM_RATE_WINDOW_MS) {
    redeemBucketsDiscord.set(discordId, { count: 1, windowStart: now });
    return { ok: true, retryAfter: 0 };
  }
  bucket.count++;
  if (bucket.count > 5) { // 5 per minute per Discord ID
    const retryAfter = Math.max(1, Math.ceil((REDEEM_RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000));
    return { ok: false, retryAfter };
  }
  return { ok: true, retryAfter: 0 };
}

function rateLimitRedeemIp(clientIp) {
  const now = Date.now();
  const bucket = redeemBucketsIp.get(clientIp);
  if (!bucket || now - bucket.windowStart >= REDEEM_RATE_WINDOW_MS) {
    redeemBucketsIp.set(clientIp, { count: 1, windowStart: now });
    return { ok: true, retryAfter: 0 };
  }
  bucket.count++;
  if (bucket.count > 3) { // 3 per minute per IP
    const retryAfter = Math.max(1, Math.ceil((REDEEM_RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000));
    return { ok: false, retryAfter };
  }
  return { ok: true, retryAfter: 0 };
}

// Cleanup old redeem rate limit buckets
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of redeemBucketsDiscord) {
    if (now - b.windowStart >= REDEEM_RATE_WINDOW_MS * 2) redeemBucketsDiscord.delete(k);
  }
  for (const [k, b] of redeemBucketsIp) {
    if (now - b.windowStart >= REDEEM_RATE_WINDOW_MS * 2) redeemBucketsIp.delete(k);
  }
}, REDEEM_RATE_WINDOW_MS).unref?.();

function rateLimitCheck(appId, perMinute) {
  const now = Date.now();
  const bucket = rateBuckets.get(appId);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(appId, { count: 1, windowStart: now });
    return { ok: true, retryAfter: 0, remaining: perMinute - 1 };
  }
  bucket.count++;
  if (bucket.count > perMinute) {
    const retryAfter = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000));
    return { ok: false, retryAfter, remaining: 0 };
  }
  return { ok: true, retryAfter: 0, remaining: Math.max(0, perMinute - bucket.count) };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) {
    if (now - b.windowStart >= RATE_WINDOW_MS * 2) rateBuckets.delete(k);
  }
}, RATE_WINDOW_MS).unref?.();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'interest-cohort=(), browsing-topics=()',
  'cache-control': 'no-store',
};

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

function sendJson(res, status, body, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  applySecurityHeaders(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('payload_too_large');
        err.statusCode = 413;
        reject(err);
        try { req.destroy(); } catch { /* */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('body_not_object');
      err.statusCode = 400;
      throw err;
    }
    return parsed;
  } catch (err) {
    if (err.statusCode) throw err;
    const e = new Error('invalid_json');
    e.statusCode = 400;
    throw e;
  }
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return lookupApiKey(token);
}

function requireScope(app, scope) {
  return Array.isArray(app.scopes) && app.scopes.includes(scope);
}

function positiveAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return null;
  if (n > 1_000_000_000) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Route dispatch
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendError(res, 400, 'bad_request', 'Invalid URL');
  }
  const pathname = parsedUrl.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // Liveness — no auth.
  if (pathname === '/v1/healthz' && method === 'GET') {
    return sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
  }

  // Everything else requires auth.
  if (!pathname.startsWith('/v1/')) {
    return sendError(res, 404, 'not_found', 'Unknown route');
  }

  const auth = authenticate(req);
  if (!auth) return sendError(res, 401, 'unauthorized', 'Missing or invalid Authorization bearer token');

  const { app } = auth;

  // Rate limit per-app.
  const rl = rateLimitCheck(app.id, app.rateLimitPerMin || 60);
  res.setHeader('x-ratelimit-limit', String(app.rateLimitPerMin || 60));
  res.setHeader('x-ratelimit-remaining', String(rl.remaining));
  if (!rl.ok) {
    return sendError(res, 429, 'rate_limited', 'Too many requests', { retry_after_s: rl.retryAfter });
  }

  // Identity probe.
  if (pathname === '/v1/me' && method === 'GET') {
    return sendJson(res, 200, {
      app: {
        id: app.id,
        name: app.name,
        scopes: app.scopes,
        rate_limit_per_min: app.rateLimitPerMin,
        can_mint: app.canMint,
        treasury_balance: getBalance(app.treasuryUserId),
      },
    });
  }

  // ---------- Links ----------
  if (pathname === '/v1/links/codes/redeem' && method === 'POST') {
    if (!requireScope(app, 'links:redeem')) return sendError(res, 403, 'forbidden', 'Missing scope: links:redeem');
    
    // Rate limit link code redemption (prevent brute force)
    let body;
    try { body = await readJsonBody(req); } catch (err) { return sendError(res, err.statusCode || 400, 'bad_request', err.message); }
    const discordId = String(body.discord_id || '').trim();
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';
    
    const rlDiscord = rateLimitRedeemDiscord(discordId);
    if (!rlDiscord.ok) return sendError(res, 429, 'rate_limited', 'Too many link code redemptions from this Discord ID', { retry_after_s: rlDiscord.retryAfter });
    
    const rlIp = rateLimitRedeemIp(String(clientIp));
    if (!rlIp.ok) return sendError(res, 429, 'rate_limited', 'Too many link code redemptions from this IP', { retry_after_s: rlIp.retryAfter });
    
    const code = String(body.code || '').trim().toUpperCase();
    const externalId = String(body.external_id || '').trim();
    const externalName = String(body.external_name || '').trim();
    if (!code || !externalId) return sendError(res, 400, 'bad_request', 'code and external_id are required');

    const result = consumeLinkCode(app.id, code, externalId, externalName);
    if (result.error) {
      const map = {
        invalid_code: 404,
        code_already_used: 409,
        code_expired: 410,
        external_id_already_linked: 409,
        discord_already_linked_to_different_external_id: 409,
      };
      return sendError(res, map[result.error] || 400, result.error, result.error.replace(/_/g, ' '));
    }
    return sendJson(res, 200, {
      link: {
        id: result.link.id,
        external_id: result.link.external_id,
        external_name: result.link.external_name,
        created_at: result.link.created_at,
      },
    });
  }

  let m;
  if ((m = pathname.match(/^\/v1\/links\/by-external\/(.+)$/u)) && method === 'GET') {
    if (!requireScope(app, 'links:read')) return sendError(res, 403, 'forbidden', 'Missing scope: links:read');
    const link = getLinkByExternal(app.id, decodeURIComponent(m[1]));
    if (!link) return sendError(res, 404, 'not_found', 'Link not found');
    return sendJson(res, 200, {
      link: {
        id: link.id,
        external_id: link.external_id,
        external_name: link.external_name,
        created_at: link.created_at,
      },
    });
  }

  if ((m = pathname.match(/^\/v1\/links\/(.+)$/u)) && method === 'DELETE') {
    if (!requireScope(app, 'links:revoke')) return sendError(res, 403, 'forbidden', 'Missing scope: links:revoke');
    const ok = revokeLinkByExternal(app.id, decodeURIComponent(m[1]));
    if (!ok) return sendError(res, 404, 'not_found', 'Link not found');
    return sendJson(res, 200, { revoked: true });
  }

  // ---------- Balance / transactions ----------
  if ((m = pathname.match(/^\/v1\/users\/([^/]+)\/balance$/u)) && method === 'GET') {
    if (!requireScope(app, 'balance:read')) return sendError(res, 403, 'forbidden', 'Missing scope: balance:read');
    const link = getLinkByExternal(app.id, decodeURIComponent(m[1]));
    if (!link) return sendError(res, 404, 'not_found', 'User not linked');
    return sendJson(res, 200, {
      external_id: link.external_id,
      balance: getBalance(link.discord_id),
    });
  }

  if ((m = pathname.match(/^\/v1\/users\/([^/]+)\/transactions$/u)) && method === 'GET') {
    if (!requireScope(app, 'txn:read')) return sendError(res, 403, 'forbidden', 'Missing scope: txn:read');
    const limit = Number(parsedUrl.searchParams.get('limit')) || 25;
    const result = apiUserTransactions({ app, externalId: decodeURIComponent(m[1]), limit });
    if (!result) return sendError(res, 404, 'not_found', 'User not linked');
    return sendJson(res, 200, {
      external_id: result.link.external_id,
      transactions: result.transactions,
    });
  }

  // ---------- Coin ops (idempotent) ----------
  if (pathname === '/v1/charge' && method === 'POST') {
    return runIdempotent(req, res, app, 'coins:debit', async (body) => {
      const externalId = String(body.external_id || '').trim();
      const amount = positiveAmount(body.amount);
      if (!externalId || !amount) return [400, { error: { code: 'bad_request', message: 'external_id and positive integer amount required' } }];
      const r = apiChargeUser({ app, externalId, amount, note: String(body.note || '').slice(0, 160) });
      if (!r.success) return [r.code || 400, { error: { code: r.error, message: r.error } }];
      return [200, {
        ok: true,
        amount: r.amount,
        fee: r.fee,
        from: r.from,
        to: r.to,
        balance: getBalance(r.from.discord_id),
      }];
    });
  }

  if (pathname === '/v1/credit' && method === 'POST') {
    return runIdempotent(req, res, app, 'coins:credit', async (body) => {
      const externalId = String(body.external_id || '').trim();
      const amount = positiveAmount(body.amount);
      if (!externalId || !amount) return [400, { error: { code: 'bad_request', message: 'external_id and positive integer amount required' } }];
      const r = apiCreditUser({ app, externalId, amount, note: String(body.note || '').slice(0, 160), mint: false });
      if (!r.success) return [r.code || 400, { error: { code: r.error, message: r.error } }];
      return [200, {
        ok: true,
        amount: r.amount,
        fee: r.fee,
        from: r.from,
        to: r.to,
        balance: getBalance(r.to.discord_id),
      }];
    });
  }

  if (pathname === '/v1/transfer' && method === 'POST') {
    return runIdempotent(req, res, app, 'coins:p2p', async (body) => {
      const fromExternalId = String(body.from_external_id || '').trim();
      const toExternalId = String(body.to_external_id || '').trim();
      const amount = positiveAmount(body.amount);
      if (!fromExternalId || !toExternalId || !amount) {
        return [400, { error: { code: 'bad_request', message: 'from_external_id, to_external_id, positive amount required' } }];
      }
      const r = apiP2PTransfer({ app, fromExternalId, toExternalId, amount, note: String(body.note || '').slice(0, 160) });
      if (!r.success) return [r.code || 400, { error: { code: r.error, message: r.error } }];
      return [200, { ok: true, amount: r.amount, fee: r.fee, from: r.from, to: r.to }];
    });
  }

  if (pathname === '/v1/mint' && method === 'POST') {
    return runIdempotent(req, res, app, 'coins:mint', async (body) => {
      if (!app.canMint) return [403, { error: { code: 'forbidden', message: 'App not authorized to mint' } }];
      const externalId = String(body.external_id || '').trim();
      const amount = positiveAmount(body.amount);
      if (!externalId || !amount) return [400, { error: { code: 'bad_request', message: 'external_id and positive amount required' } }];
      const r = apiCreditUser({ app, externalId, amount, note: String(body.note || '').slice(0, 160), mint: true });
      if (!r.success) return [r.code || 400, { error: { code: r.error, message: r.error } }];
      return [200, { ok: true, amount: r.amount, minted: true, to: r.to }];
    });
  }

  return sendError(res, 404, 'not_found', `Unknown route: ${method} ${pathname}`);
}

/**
 * Wraps a coin-op handler with scope check, body parsing, and idempotency.
 * `handler(body)` returns [statusCode, responseBody].
 */
async function runIdempotent(req, res, app, scope, handler) {
  if (!requireScope(app, scope)) return sendError(res, 403, 'forbidden', `Missing scope: ${scope}`);

  let body;
  try { body = await readJsonBody(req); } catch (err) {
    return sendError(res, err.statusCode || 400, 'bad_request', err.message);
  }

  const idempotencyKey = String(req.headers['idempotency-key'] || body.idempotency_key || '').slice(0, 128);
  if (idempotencyKey) {
    const cached = getIdempotentResponse(app.id, idempotencyKey);
    if (cached) {
      res.setHeader('idempotency-replayed', 'true');
      return sendJson(res, cached.status, cached.body);
    }
  }

  let status; let payload;
  try {
    [status, payload] = await handler(body);
  } catch (err) {
    logger.error(`API handler error (app=${app.id}): ${err.message}`);
    return sendError(res, 500, 'internal_error', 'Internal error');
  }

  if (idempotencyKey && status >= 200 && status < 500) {
    storeIdempotentResponse(app.id, idempotencyKey, status, payload);
  }
  return sendJson(res, status, payload);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startApiServer(opts = {}) {
  if (server) return;
  port = Number(opts.port) || port;
  host = opts.host || host;
  linkCodeTtlMs = Number(opts.linkCodeTtlMs) || linkCodeTtlMs;

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      logger.error(`API server: unhandled error ${err.message}`);
      try { sendError(res, 500, 'internal_error', 'Internal error'); } catch { /* */ }
    });
  });
  server.on('error', (err) => {
    logger.error(`API server: socket error on ${host}:${port}: ${err.message}`);
  });
  server.listen(port, host, () => {
    logger.info(`SadGirlCoin API: listening on http://${host}:${port}/v1`);
  });

  // Periodic janitor for expired link codes + stale idempotency rows + old rate limit logs.
  purgeTimer = setInterval(() => {
    purgeExpiredLinkCodes();
    purgeOldIdempotency();
    cleanUpRateLimitLog();
  }, 60 * 60 * 1000);
  purgeTimer.unref?.();
}

function stopApiServer() {
  if (purgeTimer) { clearInterval(purgeTimer); purgeTimer = null; }
  if (server) {
    try { server.close(); } catch { /* */ }
    server = null;
  }
}

function getApiServerStatus() {
  return { running: Boolean(server), host, port, linkCodeTtlMs };
}

function getLinkCodeTtlMs() { return linkCodeTtlMs; }

module.exports = {
  startApiServer,
  stopApiServer,
  getApiServerStatus,
  getLinkCodeTtlMs,
  _internal: { handleRequest, rateLimitCheck },
};
