'use strict';

/**
 * SGCServer — privileged internal routes (Phase 2 of split).
 *
 * These routes are mounted on a separate listener bound to 127.0.0.1 only.
 * They authenticate via SGC_INTERNAL_TOKEN (the static bearer LumiBot
 * presents from src/sgcClient.js) and bypass all rate limiting.
 *
 * They expose the economy primitives LumiBot needs from game modules,
 * scheduler, vcRewards, etc. — direct equivalents of the in-process
 * `sadgirlEconomyStore` API but over HTTP.
 *
 * IMPORTANT: every route here is privileged and must NEVER be exposed
 * publicly. The internal listener binds to 127.0.0.1 by default.
 */

const { logger } = require('./logger');
const economyStore = require('./economyStore');
const { lookupInternalToken } = require('./apiKeyStore');

const {
  ensureAccount,
  getAccountInfo,
  getBalance,
  adjustBalance,
  transferCoins,
  getTopHolders,
  getSystemState,
  setSystemState,
  CENTRAL_BANK_USER_ID,
  TOUHOU_MGMT_USER_ID,
} = economyStore;

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function authenticateInternal(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return lookupInternalToken(token);
}

/**
 * Route the request. Returns true if a route matched (response written),
 * false otherwise so the caller can fall through to a 404.
 *
 * Helpers (sendJson/sendError/readJsonBody) are passed in from server.js
 * to avoid duplicating HTTP plumbing.
 */
async function handleInternalRequest(req, res, helpers) {
  const { url, method, sendJson, sendError, readJsonBody } = helpers;
  const pathname = url.pathname;

  // Liveness — no auth, useful for sgcClient health checks.
  if (pathname === '/internal/healthz' && method === 'GET') {
    sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
    return true;
  }

  if (!pathname.startsWith('/internal/')) return false;

  const auth = authenticateInternal(req);
  if (!auth) {
    logger.warn(`Internal route auth failed: ${method} ${pathname}`);
    sendError(res, 401, 'unauthorized', 'Missing or invalid SGC_INTERNAL_TOKEN');
    return true;
  }

  let m;
  try {
    // ---------------------------------------------------------------------
    // Account ops
    // ---------------------------------------------------------------------
    if (pathname === '/internal/accounts/ensure' && method === 'POST') {
      const body = await readJsonBody(req);
      const userId = String(body.user_id || '').trim();
      const username = body.username ? String(body.username) : undefined;
      if (!userId) { sendError(res, 400, 'bad_request', 'user_id required'); return true; }
      ensureAccount(userId, username);
      sendJson(res, 200, { ok: true, account: getAccountInfo(userId) });
      return true;
    }

    if ((m = pathname.match(/^\/internal\/accounts\/([^/]+)\/balance$/u)) && method === 'GET') {
      const userId = decodeURIComponent(m[1]);
      sendJson(res, 200, { user_id: userId, balance: getBalance(userId) });
      return true;
    }

    if ((m = pathname.match(/^\/internal\/accounts\/([^/]+)$/u)) && method === 'GET') {
      const userId = decodeURIComponent(m[1]);
      const acct = getAccountInfo(userId);
      if (!acct) { sendError(res, 404, 'not_found', 'Account not found'); return true; }
      sendJson(res, 200, { account: acct });
      return true;
    }

    if (pathname === '/internal/accounts/top' && method === 'GET') {
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 25));
      sendJson(res, 200, { accounts: getTopHolders(limit) });
      return true;
    }

    if (pathname === '/internal/accounts/adjust' && method === 'POST') {
      const body = await readJsonBody(req);
      const userId = String(body.user_id || '').trim();
      const delta = Number(body.delta);
      const note = String(body.note || '').slice(0, 200);
      if (!userId || !Number.isFinite(delta)) {
        sendError(res, 400, 'bad_request', 'user_id and numeric delta required');
        return true;
      }
      logger.debug(`internal/accounts/adjust user=${userId} delta=${delta} note=${note}`);
      const result = adjustBalance(userId, delta, note);
      sendJson(res, 200, { ok: true, result, balance: getBalance(userId) });
      return true;
    }

    // ---------------------------------------------------------------------
    // Transactions
    // ---------------------------------------------------------------------
    if (pathname === '/internal/transactions/transfer' && method === 'POST') {
      const body = await readJsonBody(req);
      const fromUserId = String(body.from_user_id || '').trim();
      const toUserId = String(body.to_user_id || '').trim();
      const amount = Number(body.amount);
      const note = String(body.note || '').slice(0, 200);
      if (!fromUserId || !toUserId || !Number.isFinite(amount) || amount <= 0) {
        sendError(res, 400, 'bad_request', 'from_user_id, to_user_id, positive amount required');
        return true;
      }
      logger.debug(`internal/transactions/transfer ${fromUserId}→${toUserId} amount=${amount}`);
      const result = transferCoins(fromUserId, toUserId, amount, note);
      sendJson(res, result.success ? 200 : 400, result);
      return true;
    }

    // ---------------------------------------------------------------------
    // System state
    // ---------------------------------------------------------------------
    if ((m = pathname.match(/^\/internal\/economy\/state\/(.+)$/u)) && method === 'GET') {
      const key = decodeURIComponent(m[1]);
      sendJson(res, 200, { key, value: getSystemState(key) });
      return true;
    }

    if ((m = pathname.match(/^\/internal\/economy\/state\/(.+)$/u)) && method === 'POST') {
      const key = decodeURIComponent(m[1]);
      const body = await readJsonBody(req);
      const value = body.value;
      setSystemState(key, value == null ? null : String(value));
      sendJson(res, 200, { ok: true, key });
      return true;
    }

    // ---------------------------------------------------------------------
    // Constants (handy for sgcClient bootstraps)
    // ---------------------------------------------------------------------
    if (pathname === '/internal/constants' && method === 'GET') {
      sendJson(res, 200, {
        central_bank_user_id: CENTRAL_BANK_USER_ID,
        touhou_mgmt_user_id: TOUHOU_MGMT_USER_ID,
      });
      return true;
    }

    sendError(res, 404, 'not_found', `Unknown internal route: ${method} ${pathname}`);
    return true;
  } catch (err) {
    logger.error(`Internal route error (${method} ${pathname}): ${err.message}`);
    sendError(res, err.statusCode || 500, 'internal_error', err.message);
    return true;
  }
}

module.exports = { handleInternalRequest };
