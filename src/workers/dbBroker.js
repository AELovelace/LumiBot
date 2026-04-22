'use strict';

/**
 * Main-process broker for database operations requested by workers.
 *
 * Design notes:
 *  - `better-sqlite3` is synchronous and process-bound. We do NOT open
 *    new connections inside workers; instead workers send DB requests
 *    over the worker channel and the main process executes them against
 *    the existing economy store handle.
 *  - Phase 1 keeps the DB on the main thread. The broker exists so that
 *    later phases can swap in pooled / async backends without changing
 *    every game engine.
 *  - Every operation must be explicitly whitelisted here. Worker code is
 *    trusted, but treating it as untrusted keeps the surface area small
 *    and auditable.
 */

const store = require('../sadgirlEconomyStore');

function _requireUserId(userId) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('userId required');
  }
}

function _requirePositiveInt(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

const HANDLERS = Object.freeze({
  ensureAccount: ({ userId, username }) => {
    _requireUserId(userId);
    store.ensureAccount(userId, typeof username === 'string' ? username : '');
    return true;
  },

  getBalance: ({ userId }) => {
    _requireUserId(userId);
    return store.getBalance(userId);
  },

  placeCasinoBet: ({ userId, username, amount, gameType }) => {
    _requireUserId(userId);
    _requirePositiveInt('amount', amount);
    return store.placeCasinoBet(
      userId,
      typeof username === 'string' ? username : '',
      amount,
      typeof gameType === 'string' && gameType ? gameType : 'casino',
    );
  },

  payCasinoPayout: ({ userId, amount, gameType }) => {
    _requireUserId(userId);
    _requirePositiveInt('amount', amount);
    store.payCasinoPayout(
      userId,
      amount,
      typeof gameType === 'string' && gameType ? gameType : 'casino',
    );
    return true;
  },

  placePachinkoBet: ({ userId, username, amount }) => {
    _requireUserId(userId);
    _requirePositiveInt('amount', amount);
    return store.placePachinkoBet(
      userId,
      typeof username === 'string' ? username : '',
      amount,
    );
  },

  payPachinkoPayout: ({ userId, amount }) => {
    _requireUserId(userId);
    _requirePositiveInt('amount', amount);
    store.payPachinkoPayout(userId, amount);
    return true;
  },

  getSystemState: ({ key }) => {
    if (typeof key !== 'string' || !key) throw new Error('key required');
    return store.getSystemState(key);
  },

  setSystemState: ({ key, value }) => {
    if (typeof key !== 'string' || !key) throw new Error('key required');
    store.setSystemState(key, typeof value === 'string' ? value : String(value));
    return true;
  },
});

/**
 * Execute a brokered DB request. Returns the handler result; throws on
 * unknown op or validation failure. The caller is responsible for
 * marshalling the result back to the requesting worker.
 */
function handleDbRequest(op, args) {
  const handler = HANDLERS[op];
  if (!handler) {
    throw new Error(`db op not allowed: ${op}`);
  }
  return handler(args || {});
}

const ALLOWED_OPS = Object.freeze(Object.keys(HANDLERS));

module.exports = { handleDbRequest, ALLOWED_OPS };
