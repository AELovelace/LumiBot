'use strict';

/**
 * SGCServer — public HTTP API + OAuth endpoints + internal listener.
 *
 * Listens on TWO sockets:
 *   1. Public API + OAuth on SGC_API_HOST:SGC_API_PORT (default 0.0.0.0:7788)
 *      - /v1/*       — third-party app routes (existing API surface)
 *      - /oauth/*    — OAuth 2 token / authorize / revoke (Phase 3)
 *      - /v1/healthz — liveness, no auth
 *   2. Internal-only on SGC_INTERNAL_HOST:SGC_INTERNAL_PORT (default 127.0.0.1:7789)
 *      - /internal/* — privileged routes for LumiBot (Phase 2)
 *
 * Bearer auth on /v1/* accepts both api_keys (`sgc_live_*`) and OAuth
 * access tokens (`sgc_at_*`).
 */

const http = require('node:http');
const { URL } = require('node:url');

const { logger } = require('./logger');
const { getBalance, getEconomyDb, getSystemState, ensureAccount, transferCoins, CENTRAL_BANK_USER_ID } = require('./economyStore');
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
  trackRequest,
  cleanUpRateLimitLog,
} = require('./apiKeyStore');
const oauth = require('./oauthServer');
const { handleInternalRequest } = require('./internalRoutes');

let publicServer = null;
let internalServer = null;
let purgeTimer = null;

const MAX_BODY_BYTES = 16 * 1024;
const BRIDGE_IDEMPOTENCY_APP_ID = '__bridge_company_payout__';
const DEFAULT_BRIDGE_MAX_PAYOUT_AMOUNT = 250_000;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map();

const REDEEM_RATE_WINDOW_MS = 60_000;
const redeemBucketsDiscord = new Map();
const redeemBucketsIp = new Map();

function rateLimitRedeemDiscord(discordId) {
  const now = Date.now();
  const bucket = redeemBucketsDiscord.get(discordId);
  if (!bucket || now - bucket.windowStart >= REDEEM_RATE_WINDOW_MS) {
    redeemBucketsDiscord.set(discordId, { count: 1, windowStart: now });
    return { ok: true, retryAfter: 0 };
  }
  bucket.count++;
  if (bucket.count > 5) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((REDEEM_RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000)) };
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
  if (bucket.count > 3) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((REDEEM_RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of redeemBucketsDiscord) if (now - b.windowStart >= REDEEM_RATE_WINDOW_MS * 2) redeemBucketsDiscord.delete(k);
  for (const [k, b] of redeemBucketsIp) if (now - b.windowStart >= REDEEM_RATE_WINDOW_MS * 2) redeemBucketsIp.delete(k);
}, REDEEM_RATE_WINDOW_MS).unref?.();

function rateLimitCheck(appId, perMinute) {
  if (!perMinute || perMinute <= 0) return { ok: true, retryAfter: 0, remaining: 0 };
  const now = Date.now();
  const bucket = rateBuckets.get(appId);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(appId, { count: 1, windowStart: now });
    return { ok: true, retryAfter: 0, remaining: perMinute - 1 };
  }
  bucket.count++;
  if (bucket.count > perMinute) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - bucket.windowStart)) / 1000)), remaining: 0 };
  }
  return { ok: true, retryAfter: 0, remaining: Math.max(0, perMinute - bucket.count) };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (now - b.windowStart >= RATE_WINDOW_MS * 2) rateBuckets.delete(k);
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
        const err = new Error('payload_too_large'); err.statusCode = 413;
        reject(err); try { req.destroy(); } catch { /* */ } return;
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
      const err = new Error('body_not_object'); err.statusCode = 400; throw err;
    }
    return parsed;
  } catch (err) {
    if (err.statusCode) throw err;
    const e = new Error('invalid_json'); e.statusCode = 400; throw e;
  }
}

/**
 * Reads either application/json or application/x-www-form-urlencoded.
 * Used by /oauth/token (RFC 6749 mandates form-urlencoded).
 */
async function readJsonOrForm(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  if (ct.includes('application/x-www-form-urlencoded')) {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw).entries()) out[k] = v;
    return out;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* */ }
  const e = new Error('invalid_request_body'); e.statusCode = 400; throw e;
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function getPublicOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim() || 'localhost';
  return `${proto}://${host}`;
}

/**
 * Unified bearer auth: tries OAuth access tokens first (sgc_at_*), then
 * legacy API keys (sgc_live_*).
 */
function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;
  if (token.startsWith(oauth.ACCESS_TOKEN_PREFIX)) {
    const r = oauth.lookupAccessToken(token);
    if (r) {
      return {
        app: r.app,
        keyId: r.tokenId,
        keyPrefix: 'oauth',
        via: 'oauth',
        discordId: r.discordId,
        scope: r.scope,
        userProfile: r.userProfile || null,
      };
    }
    return null;
  }
  const r = lookupApiKey(token);
  if (r) return { ...r, via: 'api_key' };
  return null;
}

function requireScope(app, scope) {
  return Array.isArray(app.scopes) && (app.scopes.includes(scope) || app.scopes.includes('internal:*'));
}

function positiveAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return null;
  if (n > 1_000_000_000) return null;
  return n;
}

function getBridgeToken() {
  return String(getSystemState('bridge.token') || process.env.SGC_BRIDGE_TOKEN || '').trim();
}

function getBridgeTreasuryUserId() {
  return String(getSystemState('bridge.treasury_user_id') || process.env.SGC_BRIDGE_TREASURY_USER_ID || '').trim();
}

function getBridgeMode() {
  const raw = String(getSystemState('bridge.mode') || process.env.SGC_BRIDGE_MODE || 'treasury').trim().toLowerCase();
  return raw === 'mint' ? 'mint' : 'treasury';
}

function getBridgeMaxPayoutAmount() {
  const runtimeValue = getSystemState('bridge.max_payout_amount');
  const raw = Number(runtimeValue || process.env.SGC_BRIDGE_MAX_PAYOUT_AMOUNT || DEFAULT_BRIDGE_MAX_PAYOUT_AMOUNT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BRIDGE_MAX_PAYOUT_AMOUNT;
}

function authenticateBridge(req) {
  const expected = getBridgeToken();
  const supplied = bearerToken(req);
  return Boolean(expected) && Boolean(supplied) && supplied === expected;
}

function resolveCompanyStock(stockRef) {
  if (stockRef === undefined || stockRef === null) return null;
  const raw = String(stockRef).trim();
  if (!raw) return null;
  const db = getEconomyDb();
  if (!db) return null;
  if (/^\d+$/u.test(raw)) {
    return db.prepare('SELECT * FROM bb_stocks WHERE id = ?').get(Number(raw)) || null;
  }
  return db.prepare('SELECT * FROM bb_stocks WHERE lower(ticker) = lower(?)').get(raw) || null;
}

function normalizeBridgePayoutBody(body) {
  const stock = body.stock ?? body.stock_id ?? body.ticker ?? '';
  return {
    stock,
    amount: positiveAmount(body.amount),
    note: String(body.note || '').trim().slice(0, 160),
  };
}

async function handleBridgeCompanyPayout(req, res) {
  const bridgeToken = getBridgeToken();
  const bridgeTreasuryUserId = getBridgeTreasuryUserId();
  const bridgeMode = getBridgeMode();
  const bridgeMaxPayoutAmount = getBridgeMaxPayoutAmount();

  if (!bridgeToken) {
    return sendError(res, 503, 'bridge_disabled', 'Bridge payout endpoint is not configured');
  }
  if (!authenticateBridge(req)) {
    return sendError(res, 401, 'unauthorized', 'Missing or invalid bridge bearer token');
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendError(res, err.statusCode || 400, 'bad_request', err.message); }

  const payload = normalizeBridgePayoutBody(body);
  if (!payload.stock || !payload.amount) {
    return sendError(res, 400, 'bad_request', 'stock and positive integer amount required');
  }
  if (payload.amount > bridgeMaxPayoutAmount) {
    return sendError(res, 400, 'amount_too_large', `Amount exceeds configured bridge max of ${bridgeMaxPayoutAmount}`);
  }
  if (bridgeMode === 'treasury' && !bridgeTreasuryUserId) {
    return sendError(res, 503, 'bridge_not_funded', 'Bridge treasury source account is not configured');
  }

  const idempotencyKey = String(req.headers['idempotency-key'] || body.idempotency_key || '').slice(0, 128);
  if (idempotencyKey) {
    const cached = getIdempotentResponse(BRIDGE_IDEMPOTENCY_APP_ID, idempotencyKey);
    if (cached) {
      res.setHeader('idempotency-replayed', 'true');
      return sendJson(res, cached.status, cached.body);
    }
  }

  const stock = resolveCompanyStock(payload.stock);
  if (!stock) {
    return sendError(res, 404, 'stock_not_found', 'Stock identifier did not match a company');
  }
  if (stock.entity_type !== 'guild') {
    return sendError(res, 400, 'not_a_real_company', 'Synthetic stocks cannot receive company payouts');
  }

  const companyUserId = `__BIG_BUSINESS_${stock.guild_id}__`;
  ensureAccount(companyUserId, stock.business_name);

  let fee = 0;
  let minted = false;
  if (bridgeMode === 'mint') {
    const db = getEconomyDb();
    const note = `bridge:${stock.ticker} ${payload.note}`.trim().slice(0, 200);
    const txn = db.transaction(() => {
      ensureAccount(companyUserId, stock.business_name);
      db.prepare(
        "UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now') WHERE user_id = ?",
      ).run(payload.amount, payload.amount, companyUserId);
      db.prepare(
        "UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?",
      ).run(payload.amount, CENTRAL_BANK_USER_ID);
      db.prepare(`
        INSERT INTO transactions (from_user_id, to_user_id, amount, fee, type, note)
        VALUES (?, ?, ?, 0, 'api:mint', ?)
      `).run(CENTRAL_BANK_USER_ID, companyUserId, payload.amount, note);
    });
    txn();
    minted = true;
  } else {
    const transfer = transferCoins(
      bridgeTreasuryUserId,
      companyUserId,
      payload.amount,
      `bridge:${stock.ticker} ${payload.note}`.trim().slice(0, 200),
    );
    if (!transfer.success) {
      return sendError(res, 402, 'insufficient_funds', transfer.error || 'Bridge treasury could not fund payout');
    }
    fee = transfer.fee;
  }

  const responseBody = {
    ok: true,
    mode: bridgeMode,
    stock: {
      id: stock.id,
      ticker: stock.ticker,
      business_name: stock.business_name,
      guild_id: stock.guild_id,
    },
    company_account: {
      user_id: companyUserId,
      balance: getBalance(companyUserId),
    },
    source_account: {
      user_id: bridgeMode === 'mint' ? CENTRAL_BANK_USER_ID : bridgeTreasuryUserId,
      balance: getBalance(bridgeMode === 'mint' ? CENTRAL_BANK_USER_ID : bridgeTreasuryUserId),
    },
    amount: payload.amount,
    fee,
    minted,
  };

  if (idempotencyKey) {
    storeIdempotentResponse(BRIDGE_IDEMPOTENCY_APP_ID, idempotencyKey, 200, responseBody);
  }
  return sendJson(res, 200, responseBody);
}

// ---------------------------------------------------------------------------
// Public route dispatch (API + OAuth)
// ---------------------------------------------------------------------------

async function handlePublicRequest(req, res) {
  let parsedUrl;
  try { parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return sendError(res, 400, 'bad_request', 'Invalid URL'); }
  const pathname = parsedUrl.pathname;
  const method = (req.method || 'GET').toUpperCase();

  logger.debug(`Public ${method} ${pathname}`);

  // Liveness
  if (pathname === '/v1/healthz' && method === 'GET') {
    return sendJson(res, 200, { ok: true, ts: new Date().toISOString(), service: 'SGCServer' });
  }

  if (pathname === '/v1/bridge/company/payout' && method === 'POST') {
    return handleBridgeCompanyPayout(req, res);
  }

  // ----- OAuth endpoints -----
  if (pathname === '/oauth/token' && method === 'POST') {
    return oauth.handleTokenEndpoint(req, res, { readJsonOrForm, sendJson, sendError });
  }
  if (pathname === '/oauth/revoke' && method === 'POST') {
    return oauth.handleRevokeEndpoint(req, res, { readJsonOrForm, sendJson, sendError });
  }
  if (pathname === '/oauth/authorize' && method === 'GET') {
    return oauth.handleAuthorizeEndpoint(req, res, { url: parsedUrl, sendError });
  }

  if (!pathname.startsWith('/v1/')) return sendError(res, 404, 'not_found', 'Unknown route');

  const auth = authenticate(req);
  if (!auth) return sendError(res, 401, 'unauthorized', 'Missing or invalid Authorization bearer token');

  const { app } = auth;

  // Rate limit per-app (internal apps + zero-rate apps bypass).
  if (!app.isInternal && app.rateLimitPerMin) {
    const rl = rateLimitCheck(app.id, app.rateLimitPerMin);
    res.setHeader('x-ratelimit-limit', String(app.rateLimitPerMin));
    res.setHeader('x-ratelimit-remaining', String(rl.remaining));
    if (!rl.ok) return sendError(res, 429, 'rate_limited', 'Too many requests', { retry_after_s: rl.retryAfter });
    try { trackRequest(app.id, method); } catch { /* */ }
  }

  // Identity probe.
  if (pathname === '/v1/me' && method === 'GET') {
    const response = {
      app: {
        id: app.id, name: app.name, scopes: app.scopes,
        rate_limit_per_min: app.rateLimitPerMin,
        can_mint: app.canMint, is_internal: Boolean(app.isInternal),
        treasury_balance: getBalance(app.treasuryUserId),
        auth_via: auth.via,
      },
    };
    if (auth.via === 'oauth' && auth.userProfile) {
      response.user = auth.userProfile;
      response.discord_id = auth.userProfile.discord_id;
      response.discord_username = auth.userProfile.discord_username;
      response.discord_name = auth.userProfile.discord_name;
    }
    return sendJson(res, 200, response);
  }

  // ---------- Links ----------
  if (pathname === '/v1/links/oauth/start' && method === 'POST') {
    if (!requireScope(app, 'links:redeem')) return sendError(res, 403, 'forbidden', 'Missing scope: links:redeem');
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { return sendError(res, err.statusCode || 400, 'bad_request', err.message); }

    const clientId = String(body.client_id || '').trim();
    const redirectUri = String(body.redirect_uri || '').trim();
    const scope = String(body.scope || '').trim();
    const state = String(body.state || '').trim();
    const codeChallenge = String(body.code_challenge || '').trim();
    const codeChallengeMethod = String(body.code_challenge_method || '').trim() || 'S256';
    const externalId = String(body.external_id || '').trim();
    const externalName = String(body.external_name || '').trim();

    const result = oauth.createAuthorizationUrl({
      publicBaseUrl: getPublicOrigin(req),
      clientId,
      redirectUri,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod,
      externalId,
      externalName,
      expectedAppId: app.id,
    });
    if (result.error) return sendError(res, 400, result.error, result.message || result.error);

    return sendJson(res, 200, {
      oauth: {
        authorize_url: result.authorizeUrl,
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        external_id: externalId,
        external_name: externalName,
        code_challenge_method: codeChallengeMethod,
      },
      fallback: {
        method: 'link_code',
        supported: true,
        redeem_endpoint: '/v1/links/codes/redeem',
        instructions: 'If browser OAuth is unavailable, ask the player to run /lumi-link in Discord and redeem the one-time code through the legacy endpoint.',
      },
    });
  }

  if (pathname === '/v1/links/codes/redeem' && method === 'POST') {
    if (!requireScope(app, 'links:redeem')) return sendError(res, 403, 'forbidden', 'Missing scope: links:redeem');
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { return sendError(res, err.statusCode || 400, 'bad_request', err.message); }
    const discordId = String(body.discord_id || '').trim();
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';
    const rlD = rateLimitRedeemDiscord(discordId);
    if (!rlD.ok) return sendError(res, 429, 'rate_limited', 'Too many link code redemptions from this Discord ID', { retry_after_s: rlD.retryAfter });
    const rlI = rateLimitRedeemIp(String(clientIp));
    if (!rlI.ok) return sendError(res, 429, 'rate_limited', 'Too many link code redemptions from this IP', { retry_after_s: rlI.retryAfter });
    const code = String(body.code || '').trim().toUpperCase();
    const externalId = String(body.external_id || '').trim();
    const externalName = String(body.external_name || '').trim();
    if (!code || !externalId) return sendError(res, 400, 'bad_request', 'code and external_id are required');
    const result = consumeLinkCode(app.id, code, externalId, externalName);
    if (result.error) {
      const map = {
        invalid_code: 404, code_already_used: 409, code_expired: 410,
        external_id_already_linked: 409,
        discord_already_linked_to_different_external_id: 409,
      };
      const extra = {};
      if (result.conflictingExternalId) {
        extra.conflicting_external_id = result.conflictingExternalId;
      }
      return sendError(res, map[result.error] || 400, result.error, result.error.replace(/_/g, ' '), extra);
    }
    return sendJson(res, 200, {
      link: {
        id: result.link.id, external_id: result.link.external_id,
        external_name: result.link.external_name, created_at: result.link.created_at,
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
        id: link.id, external_id: link.external_id,
        external_name: link.external_name, created_at: link.created_at,
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
    return sendJson(res, 200, { external_id: link.external_id, balance: getBalance(link.discord_id) });
  }

  if ((m = pathname.match(/^\/v1\/users\/([^/]+)\/transactions$/u)) && method === 'GET') {
    if (!requireScope(app, 'txn:read')) return sendError(res, 403, 'forbidden', 'Missing scope: txn:read');
    const limit = Number(parsedUrl.searchParams.get('limit')) || 25;
    const result = apiUserTransactions({ app, externalId: decodeURIComponent(m[1]), limit });
    if (!result) return sendError(res, 404, 'not_found', 'User not linked');
    return sendJson(res, 200, { external_id: result.link.external_id, transactions: result.transactions });
  }

  // ---------- Coin ops (idempotent) ----------
  if (pathname === '/v1/charge' && method === 'POST') {
    return runIdempotent(req, res, app, 'coins:debit', async (body) => {
      const externalId = String(body.external_id || '').trim();
      const amount = positiveAmount(body.amount);
      if (!externalId || !amount) return [400, { error: { code: 'bad_request', message: 'external_id and positive integer amount required' } }];
      const r = apiChargeUser({ app, externalId, amount, note: String(body.note || '').slice(0, 160) });
      if (!r.success) return [r.code || 400, { error: { code: r.error, message: r.error } }];
      return [200, { ok: true, amount: r.amount, fee: r.fee, from: r.from, to: r.to, balance: getBalance(r.from.discord_id) }];
    });
  }

  if (pathname === '/v1/credit' && method === 'POST') {
    return runIdempotent(req, res, app, 'coins:credit', async (body) => {
      const externalId = String(body.external_id || '').trim();
      const amount = positiveAmount(body.amount);
      if (!externalId || !amount) return [400, { error: { code: 'bad_request', message: 'external_id and positive integer amount required' } }];
      const r = apiCreditUser({ app, externalId, amount, note: String(body.note || '').slice(0, 160), mint: false });
      if (!r.success) return [r.code || 400, { error: { code: r.error, message: r.error } }];
      return [200, { ok: true, amount: r.amount, fee: r.fee, from: r.from, to: r.to, balance: getBalance(r.to.discord_id) }];
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

async function runIdempotent(req, res, app, scope, handler) {
  if (!requireScope(app, scope)) return sendError(res, 403, 'forbidden', `Missing scope: ${scope}`);
  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendError(res, err.statusCode || 400, 'bad_request', err.message); }

  const idempotencyKey = String(req.headers['idempotency-key'] || body.idempotency_key || '').slice(0, 128);
  if (idempotencyKey) {
    const cached = getIdempotentResponse(app.id, idempotencyKey);
    if (cached) {
      res.setHeader('idempotency-replayed', 'true');
      return sendJson(res, cached.status, cached.body);
    }
  }
  let status; let payload;
  try { [status, payload] = await handler(body); }
  catch (err) {
    logger.error(`API handler error (app=${app.id}): ${err.message}`);
    return sendError(res, 500, 'internal_error', 'Internal error');
  }
  if (idempotencyKey && status >= 200 && status < 500) {
    storeIdempotentResponse(app.id, idempotencyKey, status, payload);
  }
  return sendJson(res, status, payload);
}

// ---------------------------------------------------------------------------
// Internal route dispatch
// ---------------------------------------------------------------------------

async function handleInternalSocket(req, res) {
  let parsedUrl;
  try { parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return sendError(res, 400, 'bad_request', 'Invalid URL'); }
  const method = (req.method || 'GET').toUpperCase();
  logger.debug(`Internal ${method} ${parsedUrl.pathname}`);

  const handled = await handleInternalRequest(req, res, {
    url: parsedUrl, method,
    sendJson, sendError, readJsonBody,
  });
  if (!handled) sendError(res, 404, 'not_found', 'Unknown internal route');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startApiServer(opts = {}) {
  if (publicServer) return;

  const publicHost = opts.host || process.env.SGC_API_HOST || '0.0.0.0';
  const publicPort = Number(opts.port || process.env.SGC_API_PORT) || 7788;
  const internalHost = opts.internalHost || process.env.SGC_INTERNAL_HOST || '127.0.0.1';
  const internalPort = Number(opts.internalPort || process.env.SGC_INTERNAL_PORT) || 7789;

  publicServer = http.createServer((req, res) => {
    handlePublicRequest(req, res).catch((err) => {
      logger.error(`Public server: unhandled error ${err.message}`);
      try { sendError(res, 500, 'internal_error', 'Internal error'); } catch { /* */ }
    });
  });
  publicServer.on('error', (err) => logger.error(`Public server socket error on ${publicHost}:${publicPort}: ${err.message}`));
  publicServer.listen(publicPort, publicHost, () => {
    logger.info(`SGCServer public API listening on http://${publicHost}:${publicPort}/ (v1 + oauth)`);
  });

  if (!process.env.SGC_INTERNAL_TOKEN) {
    logger.warn('SGC_INTERNAL_TOKEN not set — internal listener will reject all requests.');
  }
  internalServer = http.createServer((req, res) => {
    handleInternalSocket(req, res).catch((err) => {
      logger.error(`Internal server: unhandled error ${err.message}`);
      try { sendError(res, 500, 'internal_error', 'Internal error'); } catch { /* */ }
    });
  });
  internalServer.on('error', (err) => logger.error(`Internal server socket error on ${internalHost}:${internalPort}: ${err.message}`));
  internalServer.listen(internalPort, internalHost, () => {
    logger.info(`SGCServer internal API listening on http://${internalHost}:${internalPort}/internal/ [LumiBot only]`);
  });

  // Periodic janitor.
  purgeTimer = setInterval(() => {
    purgeExpiredLinkCodes();
    purgeOldIdempotency();
    cleanUpRateLimitLog();
    try { oauth.purgeExpiredTokens(); } catch { /* */ }
  }, 60 * 60 * 1000);
  purgeTimer.unref?.();
}

function stopApiServer() {
  if (purgeTimer) { clearInterval(purgeTimer); purgeTimer = null; }
  if (publicServer) { try { publicServer.close(); } catch { /* */ } publicServer = null; }
  if (internalServer) { try { internalServer.close(); } catch { /* */ } internalServer = null; }
}

module.exports = { startApiServer, stopApiServer };
