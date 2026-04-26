'use strict';

/**
 * LumiBot → SGCServer HTTP client (Phase 4 of split).
 *
 * Thin wrapper over node:http that calls SGCServer's /internal/* routes
 * using SGC_INTERNAL_TOKEN bearer auth.
 *
 * NOTE: After the split, LumiBot and SGCServer share the same SQLite file,
 * so most LumiBot code paths can keep using sadgirlEconomyStore directly
 * for performance. This client exists for two reasons:
 *
 *   1. Health checks / smoke tests against the running SGCServer process.
 *   2. Future migration: any LumiBot module can switch to sgcClient if we
 *      ever want to deploy SGCServer on a different host.
 *
 * If SGC_SERVER_INTERNAL_URL is not set, every method short-circuits and
 * returns null/false so callers can fall back to in-process behaviour.
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const { logger } = require('./logger');
const { config } = require('./config');

function baseUrl() {
  return (config.sgcServerInternalUrl || process.env.SGC_SERVER_INTERNAL_URL || '').trim();
}

function token() {
  return (config.sgcInternalToken || process.env.SGC_INTERNAL_TOKEN || '').trim();
}

function isEnabled() {
  return Boolean(baseUrl() && token());
}

/**
 * Low-level request. Resolves with { status, body } or rejects on transport error.
 */
function rawRequest(method, pathname, { body = null, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try { urlObj = new URL(pathname.replace(/^\//, ''), baseUrl().endsWith('/') ? baseUrl() : baseUrl() + '/'); }
    catch (err) { return reject(err); }

    const protocol = urlObj.protocol === 'https:' ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const req = protocol.request(urlObj, {
      method,
      headers: {
        'Authorization': `Bearer ${token()}`,
        'Accept': 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = raw; } }
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`SGCServer timeout ${method} ${pathname}`)); });
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Call wrapper: returns parsed JSON body on 2xx, or null on transport
 * failure / 4xx / 5xx (logs the failure). Use rawRequest if you need
 * status code visibility.
 */
async function call(method, pathname, options = {}) {
  if (!isEnabled()) return null;
  try {
    const { status, body } = await rawRequest(method, pathname, options);
    if (status < 200 || status >= 300) {
      logger.warn(`sgcClient ${method} ${pathname} -> ${status} ${body && body.error ? body.error.message : ''}`);
      return null;
    }
    return body;
  } catch (err) {
    logger.warn(`sgcClient ${method} ${pathname} failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

async function ping() {
  if (!baseUrl()) return false;
  try {
    const { status } = await rawRequest('GET', '/internal/healthz', { timeoutMs: 2000 });
    return status === 200;
  } catch { return false; }
}

async function ensureAccount(userId, username) {
  return call('POST', '/internal/accounts/ensure', { body: { user_id: userId, username } });
}

async function getBalance(userId) {
  const r = await call('GET', `/internal/accounts/${encodeURIComponent(userId)}/balance`);
  return r ? r.balance : null;
}

async function getAccount(userId) {
  const r = await call('GET', `/internal/accounts/${encodeURIComponent(userId)}`);
  return r ? r.account : null;
}

async function getTopAccounts(limit = 25) {
  const r = await call('GET', `/internal/accounts/top?limit=${encodeURIComponent(limit)}`);
  return r ? r.accounts : null;
}

async function adjustBalance(userId, delta, note = '') {
  return call('POST', '/internal/accounts/adjust', { body: { user_id: userId, delta, note } });
}

async function transfer(fromUserId, toUserId, amount, note = '') {
  return call('POST', '/internal/transactions/transfer', { body: { from_user_id: fromUserId, to_user_id: toUserId, amount, note } });
}

async function getSystemState(key) {
  const r = await call('GET', `/internal/economy/state/${encodeURIComponent(key)}`);
  return r ? r.value : null;
}

async function setSystemState(key, value) {
  return call('POST', `/internal/economy/state/${encodeURIComponent(key)}`, { body: { value } });
}

module.exports = {
  isEnabled,
  ping,
  ensureAccount,
  getBalance,
  getAccount,
  getTopAccounts,
  adjustBalance,
  transfer,
  getSystemState,
  setSystemState,
  // Escape hatch for ad-hoc internal routes.
  rawRequest,
  call,
};
