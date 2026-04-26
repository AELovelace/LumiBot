'use strict';

/**
 * SGCServer — API key + link + transaction store.
 *
 * Mostly a port of LumiBot's src/apiKeyStore.js with the following additions
 * for the split:
 *  - `is_internal` column on api_apps (added via lazy migration).
 *  - `getInternalApp()` synthesizes a privileged in-memory "app" backed by
 *    the SGC_INTERNAL_TOKEN env var so LumiBot can call /internal/* routes
 *    without registering a real api_apps row.
 *  - Verbose [SGC] logging on every coin op while we burn in the split.
 */

const crypto = require('node:crypto');
const { logger } = require('./logger');
const {
  getEconomyDb,
  ensureAccount,
  transferCoins,
  adjustBalance,
  CENTRAL_BANK_USER_ID,
} = require('./economyStore');

let fireWebhookEvent = null; // Lazy-loaded to avoid circular dependency.

const VALID_SCOPES = Object.freeze([
  'balance:read',
  'txn:read',
  'coins:debit',
  'coins:credit',
  'coins:p2p',
  'coins:mint',
  'links:redeem',
  'links:read',
  'links:revoke',
  // Internal-only super-scopes (Phase 2).
  'internal:*',
]);

const KEY_PLAINTEXT_PREFIX = 'sgc_live_';
const APP_TREASURY_PREFIX = '__APP_';
const INTERNAL_APP_ID = '__internal__';

function db() { return getEconomyDb(); }

// ---------------------------------------------------------------------------
// Lazy migration: add is_internal column to api_apps if missing.
// Phase 2 of the split.
// ---------------------------------------------------------------------------
let migrationsRun = false;
function ensureMigrations() {
  if (migrationsRun) return;
  if (!db()) return;
  try {
    const cols = db().pragma('table_info(api_apps)').map((c) => c.name);
    if (!cols.includes('is_internal')) {
      logger.info('Migrating api_apps: adding is_internal column.');
      db().exec("ALTER TABLE api_apps ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0");
    }
    migrationsRun = true;
  } catch (err) {
    logger.warn(`api_apps migration check failed (non-fatal): ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// ID + hash helpers
// ---------------------------------------------------------------------------

function randomId(prefix, bytes = 12) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

function generateApiKeyPlaintext() {
  return `${KEY_PLAINTEXT_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

function hashApiKey(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext), 'utf8').digest('hex');
}

function constantTimeEquals(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateLinkCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += LINK_CODE_ALPHABET[bytes[i] % LINK_CODE_ALPHABET.length];
    if (i === 2) out += '-';
  }
  return out;
}

function appTreasuryUserId(appId) {
  return `${APP_TREASURY_PREFIX}${appId}__`;
}

function ensureAppTreasury(appId, displayName) {
  const uid = appTreasuryUserId(appId);
  const existing = db().prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(uid);
  if (!existing) {
    db().prepare('INSERT INTO accounts (user_id, username) VALUES (?, ?)').run(uid, `App Treasury: ${displayName}`);
  }
  return uid;
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  const seen = new Set();
  const out = [];
  for (const s of scopes) {
    const normalized = String(s || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    if (!VALID_SCOPES.includes(normalized)) throw new Error(`Unknown scope: ${normalized}`);
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function rowToApp(row) {
  if (!row) return null;
  let scopes = [];
  try { scopes = JSON.parse(row.scopes || '[]'); } catch { scopes = []; }
  return {
    id: row.id,
    name: row.name,
    ownerDiscordId: row.owner_discord_id,
    description: row.description,
    scopes,
    rateLimitPerMin: row.rate_limit_per_min,
    canMint: Boolean(row.can_mint),
    isInternal: Boolean(row.is_internal),
    webhookUrl: row.webhook_url || null,
    webhookSecret: row.webhook_secret || null,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    treasuryUserId: appTreasuryUserId(row.id),
  };
}

// ---------------------------------------------------------------------------
// Internal app (Phase 2 — privileged tier)
// ---------------------------------------------------------------------------

function getInternalApp() {
  return {
    id: INTERNAL_APP_ID,
    name: 'LumiBot Internal',
    ownerDiscordId: 'system',
    description: 'Synthetic app for LumiBot privileged access',
    scopes: VALID_SCOPES.slice(),
    rateLimitPerMin: 0,         // 0 == no rate limit
    canMint: true,
    isInternal: true,
    webhookUrl: null,
    webhookSecret: null,
    createdAt: null,
    disabledAt: null,
    treasuryUserId: CENTRAL_BANK_USER_ID, // internal "treasury" is the bank
  };
}

function lookupInternalToken(plaintext) {
  const expected = (process.env.SGC_INTERNAL_TOKEN || '').trim();
  if (!expected) return null;
  if (typeof plaintext !== 'string' || !plaintext) return null;
  if (!constantTimeEquals(plaintext, expected)) return null;
  logger.debug('Authenticated internal request via SGC_INTERNAL_TOKEN.');
  return { app: getInternalApp(), keyId: '__internal__', keyPrefix: 'sgc_internal' };
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

function createApiApp({
  name,
  ownerDiscordId,
  description = '',
  scopes = [],
  rateLimitPerMin = 60,
  canMint = false,
  webhookUrl = null,
  isInternal = false,
}) {
  ensureMigrations();
  if (!name || !ownerDiscordId) throw new Error('name and ownerDiscordId are required');
  const normScopes = normalizeScopes(scopes);
  const id = randomId('app', 6);
  const webhookSecret = webhookUrl ? crypto.randomBytes(32).toString('hex') : null;

  db().prepare(`
    INSERT INTO api_apps (id, name, owner_discord_id, description, scopes,
                          rate_limit_per_min, can_mint, webhook_url, webhook_secret, is_internal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(name).slice(0, 80),
    String(ownerDiscordId),
    String(description || '').slice(0, 500),
    JSON.stringify(normScopes),
    Math.max(1, Math.floor(Number(rateLimitPerMin) || 60)),
    canMint ? 1 : 0,
    webhookUrl || null,
    webhookSecret,
    isInternal ? 1 : 0,
  );

  ensureAppTreasury(id, name);
  logger.info(`API app created: ${id} (${name}) by ${ownerDiscordId}${isInternal ? ' [INTERNAL]' : ''}`);
  return getApiApp(id);
}

function getApiApp(appId) {
  ensureMigrations();
  return rowToApp(db().prepare('SELECT * FROM api_apps WHERE id = ?').get(appId));
}

function listApiApps({ includeDisabled = true } = {}) {
  ensureMigrations();
  const rows = includeDisabled
    ? db().prepare('SELECT * FROM api_apps ORDER BY created_at DESC').all()
    : db().prepare('SELECT * FROM api_apps WHERE disabled_at IS NULL ORDER BY created_at DESC').all();
  return rows.map(rowToApp);
}

function disableApp(appId) {
  const txn = db().transaction(() => {
    db().prepare("UPDATE api_apps SET disabled_at = datetime('now') WHERE id = ? AND disabled_at IS NULL").run(appId);
    db().prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE app_id = ?").run(appId);
    db().prepare("UPDATE external_account_links SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE app_id = ?").run(appId);
  });
  txn();
}

function enableApp(appId) {
  db().prepare('UPDATE api_apps SET disabled_at = NULL WHERE id = ?').run(appId);
}

function updateApp(appId, { rateLimitPerMin, scopes, webhookUrl, description, name } = {}) {
  const app = getApiApp(appId);
  if (!app) throw new Error('App not found');
  const sets = [];
  const params = [];
  if (typeof rateLimitPerMin === 'number') { sets.push('rate_limit_per_min = ?'); params.push(Math.max(1, Math.floor(rateLimitPerMin))); }
  if (Array.isArray(scopes)) { sets.push('scopes = ?'); params.push(JSON.stringify(normalizeScopes(scopes))); }
  if (webhookUrl !== undefined) {
    sets.push('webhook_url = ?'); params.push(webhookUrl || null);
    if (webhookUrl && !app.webhookSecret) {
      sets.push('webhook_secret = ?'); params.push(crypto.randomBytes(32).toString('hex'));
    }
  }
  if (typeof description === 'string') { sets.push('description = ?'); params.push(description.slice(0, 500)); }
  if (typeof name === 'string' && name.trim()) { sets.push('name = ?'); params.push(name.trim().slice(0, 80)); }
  if (!sets.length) return app;
  params.push(appId);
  db().prepare(`UPDATE api_apps SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getApiApp(appId);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function issueApiKey(appId) {
  const app = getApiApp(appId);
  if (!app) throw new Error('App not found');
  if (app.disabledAt) throw new Error('App is disabled');
  const plaintext = generateApiKeyPlaintext();
  const keyId = randomId('key', 6);
  const keyHash = hashApiKey(plaintext);
  const keyPrefix = plaintext.slice(0, KEY_PLAINTEXT_PREFIX.length + 8);
  db().prepare(`INSERT INTO api_keys (id, app_id, key_hash, key_prefix) VALUES (?, ?, ?, ?)`)
    .run(keyId, appId, keyHash, keyPrefix);
  logger.info(`API key issued: ${keyId} for app ${appId} (prefix ${keyPrefix})`);
  return { keyId, plaintext, keyPrefix };
}

function listKeysForApp(appId) {
  return db().prepare(
    'SELECT id, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE app_id = ? ORDER BY created_at DESC',
  ).all(appId);
}

function revokeApiKey(keyId) {
  db().prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(keyId);
}

function lookupApiKey(plaintext) {
  ensureMigrations();
  if (typeof plaintext !== 'string' || !plaintext.startsWith(KEY_PLAINTEXT_PREFIX)) return null;
  const keyHash = hashApiKey(plaintext);
  const keyRow = db().prepare(`
    SELECT k.id AS key_id, k.app_id, k.key_hash, k.key_prefix, k.revoked_at
    FROM api_keys k WHERE k.key_hash = ?
  `).get(keyHash);
  if (!keyRow) return null;
  if (keyRow.revoked_at) return null;
  if (!constantTimeEquals(keyRow.key_hash, keyHash)) return null;
  const app = getApiApp(keyRow.app_id);
  if (!app || app.disabledAt) return null;
  try {
    db().prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(keyRow.key_id);
  } catch { /* ignore */ }
  return { app, keyId: keyRow.key_id, keyPrefix: keyRow.key_prefix };
}

// ---------------------------------------------------------------------------
// Link codes + external account links
// ---------------------------------------------------------------------------

function createLinkCode(appId, discordId, ttlMs = 600_000) {
  if (!db()) throw new Error('Economy database not initialized');
  const app = getApiApp(appId);
  if (!app) throw new Error('App not found');
  if (app.disabledAt) throw new Error('App is disabled');
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString().replace('T', ' ').slice(0, 19);
    try {
      db().prepare(`INSERT INTO api_link_codes (code, app_id, discord_id, expires_at) VALUES (?, ?, ?, ?)`)
        .run(code, appId, String(discordId), expiresAt);
      return { code, expiresAt, ttlMs };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw new Error('Failed to generate unique link code');
}

function consumeLinkCode(appId, code, externalId, externalName = '') {
  if (!appId || !code || !externalId) return { error: 'app_id, code, external_id required' };
  const result = db().transaction(() => {
    const row = db().prepare('SELECT * FROM api_link_codes WHERE code = ? AND app_id = ?').get(String(code).toUpperCase(), appId);
    if (!row) return { error: 'invalid_code' };
    if (row.consumed_at) return { error: 'code_already_used' };
    if (Date.parse(row.expires_at + 'Z') < Date.now()) return { error: 'code_expired' };

    const existing = db().prepare(
      'SELECT * FROM external_account_links WHERE app_id = ? AND discord_id = ? AND revoked_at IS NULL',
    ).get(appId, row.discord_id);
    if (existing && existing.external_id !== String(externalId)) {
      return { error: 'discord_already_linked_to_different_external_id' };
    }
    const claim = db().prepare(
      'SELECT discord_id FROM external_account_links WHERE app_id = ? AND external_id = ? AND revoked_at IS NULL',
    ).get(appId, String(externalId));
    if (claim && claim.discord_id !== row.discord_id) {
      return { error: 'external_id_already_linked' };
    }

    db().prepare("UPDATE api_link_codes SET consumed_at = datetime('now') WHERE code = ?").run(row.code);

    if (existing) {
      db().prepare("UPDATE external_account_links SET external_name = ? WHERE id = ?")
        .run(String(externalName || '').slice(0, 80), existing.id);
      const refreshed = db().prepare('SELECT * FROM external_account_links WHERE id = ?').get(existing.id);
      return { discordId: row.discord_id, link: refreshed };
    }

    const info = db().prepare(`
      INSERT INTO external_account_links (app_id, discord_id, external_id, external_name)
      VALUES (?, ?, ?, ?)
    `).run(appId, row.discord_id, String(externalId), String(externalName || '').slice(0, 80));
    const link = db().prepare('SELECT * FROM external_account_links WHERE id = ?').get(info.lastInsertRowid);
    ensureAccount(row.discord_id);
    return { discordId: row.discord_id, link };
  })();

  if (result.link && !result.error) {
    try {
      if (!fireWebhookEvent) fireWebhookEvent = require('./webhookDispatcher').fireWebhookEvent;
      fireWebhookEvent(appId, 'link.created', {
        event: 'link.created',
        external_id: result.link.external_id,
        app_id: appId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn(`Failed to fire link.created webhook: ${err.message}`);
    }
  }
  return result;
}

function getLinkByExternal(appId, externalId) {
  return db().prepare(
    'SELECT * FROM external_account_links WHERE app_id = ? AND external_id = ? AND revoked_at IS NULL',
  ).get(appId, String(externalId));
}

function getLinkByDiscord(appId, discordId) {
  return db().prepare(
    'SELECT * FROM external_account_links WHERE app_id = ? AND discord_id = ? AND revoked_at IS NULL',
  ).get(appId, String(discordId));
}

function listLinksForApp(appId) {
  return db().prepare(
    'SELECT * FROM external_account_links WHERE app_id = ? ORDER BY (revoked_at IS NULL) DESC, created_at DESC LIMIT 500',
  ).all(appId);
}

function listLinksForDiscordUser(discordId) {
  return db().prepare(`
    SELECT l.*, a.name AS app_name, a.disabled_at AS app_disabled_at
    FROM external_account_links l
    JOIN api_apps a ON a.id = l.app_id
    WHERE l.discord_id = ? AND l.revoked_at IS NULL
    ORDER BY l.created_at DESC
  `).all(String(discordId));
}

function revokeLinkByExternal(appId, externalId) {
  const r = db().prepare(
    "UPDATE external_account_links SET revoked_at = datetime('now') WHERE app_id = ? AND external_id = ? AND revoked_at IS NULL",
  ).run(appId, String(externalId));
  return r.changes > 0;
}

function revokeLinkByDiscord(appId, discordId) {
  const r = db().prepare(
    "UPDATE external_account_links SET revoked_at = datetime('now') WHERE app_id = ? AND discord_id = ? AND revoked_at IS NULL",
  ).run(appId, String(discordId));
  return r.changes > 0;
}

function revokeLinkById(linkId) {
  const r = db().prepare(
    "UPDATE external_account_links SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
  ).run(linkId);
  return r.changes > 0;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

function getIdempotentResponse(appId, clientKey) {
  if (!clientKey) return null;
  const composite = `${appId}:${clientKey}`;
  const row = db().prepare('SELECT response_json, status_code FROM api_idempotency WHERE key = ?').get(composite);
  if (!row) return null;
  try { return { status: row.status_code, body: JSON.parse(row.response_json) }; }
  catch { return null; }
}

function storeIdempotentResponse(appId, clientKey, status, body) {
  if (!clientKey) return;
  const composite = `${appId}:${clientKey}`;
  try {
    db().prepare(`
      INSERT INTO api_idempotency (key, response_json, status_code) VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `).run(composite, JSON.stringify(body), Number(status) || 200);
  } catch (err) {
    logger.warn(`api_idempotency store failed: ${err.message}`);
  }
}

function purgeOldIdempotency(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString().replace('T', ' ').slice(0, 19);
  try {
    const r = db().prepare("DELETE FROM api_idempotency WHERE created_at < ?").run(cutoff);
    if (r.changes) logger.info(`api_idempotency: purged ${r.changes} stale rows`);
  } catch (err) {
    logger.warn(`api_idempotency purge failed: ${err.message}`);
  }
}

function purgeExpiredLinkCodes() {
  try {
    const r = db().prepare(
      "DELETE FROM api_link_codes WHERE consumed_at IS NULL AND expires_at < datetime('now', '-1 hour')",
    ).run();
    if (r.changes) logger.info(`api_link_codes: purged ${r.changes} stale codes`);
  } catch (err) {
    logger.warn(`api_link_codes purge failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// API-mediated coin movements
// ---------------------------------------------------------------------------

function apiChargeUser({ app, externalId, amount, note = '' }) {
  const link = getLinkByExternal(app.id, externalId);
  if (!link) return { success: false, error: 'user_not_linked', code: 404 };

  logger.debug(`[charge] app=${app.id} external=${externalId} discord=${link.discord_id} amount=${amount}`);
  const result = transferCoins(
    link.discord_id,
    app.treasuryUserId,
    amount,
    `api:${app.id}:debit ${note || ''}`.trim().slice(0, 200),
  );
  if (!result.success) return { success: false, error: result.error, code: 402 };

  try {
    if (!fireWebhookEvent) fireWebhookEvent = require('./webhookDispatcher').fireWebhookEvent;
    fireWebhookEvent(app.id, 'transaction.completed', {
      event: 'transaction.completed', type: 'charge',
      external_id: link.external_id, amount: result.amount, fee: result.fee,
      app_id: app.id, timestamp: new Date().toISOString(),
    });
  } catch (err) { logger.warn(`Failed to fire transaction webhook: ${err.message}`); }

  return {
    success: true, fee: result.fee, amount,
    from: { external_id: link.external_id, discord_id: link.discord_id },
    to: { app_id: app.id, treasury_user_id: app.treasuryUserId },
  };
}

function apiCreditUser({ app, externalId, amount, note = '', mint = false }) {
  const link = getLinkByExternal(app.id, externalId);
  if (!link) return { success: false, error: 'user_not_linked', code: 404 };

  logger.debug(`[credit] app=${app.id} external=${externalId} discord=${link.discord_id} amount=${amount} mint=${mint}`);

  if (mint) {
    if (!app.canMint) return { success: false, error: 'mint_not_authorized', code: 403 };
    const txn = db().transaction(() => {
      ensureAccount(link.discord_id);
      db().prepare(
        "UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now') WHERE user_id = ?",
      ).run(amount, amount, link.discord_id);
      db().prepare(
        "UPDATE accounts SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?",
      ).run(amount, CENTRAL_BANK_USER_ID);
      db().prepare(`
        INSERT INTO transactions (from_user_id, to_user_id, amount, fee, type, note)
        VALUES (?, ?, ?, 0, 'api:mint', ?)
      `).run(CENTRAL_BANK_USER_ID, link.discord_id, amount, `api:${app.id}:mint ${note || ''}`.trim().slice(0, 200));
    });
    txn();
    try {
      if (!fireWebhookEvent) fireWebhookEvent = require('./webhookDispatcher').fireWebhookEvent;
      fireWebhookEvent(app.id, 'transaction.completed', {
        event: 'transaction.completed', type: 'mint',
        external_id: link.external_id, amount, minted: true,
        app_id: app.id, timestamp: new Date().toISOString(),
      });
    } catch (err) { logger.warn(`Failed to fire transaction webhook: ${err.message}`); }
    return { success: true, amount, minted: true, to: { external_id: link.external_id, discord_id: link.discord_id } };
  }

  const result = transferCoins(
    app.treasuryUserId,
    link.discord_id,
    amount,
    `api:${app.id}:credit ${note || ''}`.trim().slice(0, 200),
  );
  if (!result.success) return { success: false, error: result.error, code: 402 };

  return {
    success: true, fee: result.fee, amount,
    from: { app_id: app.id, treasury_user_id: app.treasuryUserId },
    to: { external_id: link.external_id, discord_id: link.discord_id },
  };
}

function apiP2PTransfer({ app, fromExternalId, toExternalId, amount, note = '' }) {
  const fromLink = getLinkByExternal(app.id, fromExternalId);
  const toLink = getLinkByExternal(app.id, toExternalId);
  if (!fromLink) return { success: false, error: 'from_user_not_linked', code: 404 };
  if (!toLink) return { success: false, error: 'to_user_not_linked', code: 404 };

  logger.debug(`[p2p] app=${app.id} ${fromExternalId}→${toExternalId} amount=${amount}`);
  const result = transferCoins(
    fromLink.discord_id, toLink.discord_id, amount,
    `api:${app.id}:p2p ${note || ''}`.trim().slice(0, 200),
  );
  if (!result.success) return { success: false, error: result.error, code: 402 };

  try {
    if (!fireWebhookEvent) fireWebhookEvent = require('./webhookDispatcher').fireWebhookEvent;
    fireWebhookEvent(app.id, 'transaction.completed', {
      event: 'transaction.completed', type: 'transfer',
      from_external_id: fromLink.external_id, to_external_id: toLink.external_id,
      amount: result.amount, fee: result.fee,
      app_id: app.id, timestamp: new Date().toISOString(),
    });
  } catch (err) { logger.warn(`Failed to fire transaction webhook: ${err.message}`); }

  return {
    success: true, fee: result.fee, amount,
    from: { external_id: fromLink.external_id, discord_id: fromLink.discord_id },
    to: { external_id: toLink.external_id, discord_id: toLink.discord_id },
  };
}

function apiUserTransactions({ app, externalId, limit = 25 }) {
  const link = getLinkByExternal(app.id, externalId);
  if (!link) return null;
  const rows = db().prepare(`
    SELECT id, from_user_id, to_user_id, amount, fee, type, note, created_at
    FROM transactions
    WHERE (from_user_id = ? OR to_user_id = ?)
      AND note LIKE ?
    ORDER BY id DESC
    LIMIT ?
  `).all(link.discord_id, link.discord_id, `api:${app.id}:%`, Math.max(1, Math.min(100, Number(limit) || 25)));
  return { link, transactions: rows };
}

function withdrawAppTreasury(appId, toDiscordId, amount, note = 'app treasury withdrawal') {
  const app = getApiApp(appId);
  if (!app) return { success: false, error: 'app_not_found' };
  return transferCoins(app.treasuryUserId, toDiscordId, amount, note);
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function checkRateLimit(appId) {
  if (!db()) return { ok: false, error: 'No database' };
  try {
    const app = getApiApp(appId);
    if (!app) return { ok: false, error: 'app_not_found', code: 404 };
    if (app.isInternal) return { ok: true }; // Internal apps bypass rate limit (Phase 2)
    if (!app.rateLimitPerMin) return { ok: true };

    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);
    const result = db().prepare(`
      SELECT COUNT(*) as count FROM api_rate_limit_log WHERE app_id = ? AND timestamp > ?
    `).get(appId, oneMinuteAgo);
    const requestsInWindow = result?.count || 0;
    return {
      ok: requestsInWindow < app.rateLimitPerMin,
      rateLimit: app.rateLimitPerMin,
      requestsInWindow,
      retryAfterSeconds: 60 - (Date.now() % 60_000) / 1000,
    };
  } catch (err) {
    logger.warn(`Rate limit check error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function trackRequest(appId, method = 'api') {
  if (!db()) return;
  if (appId === INTERNAL_APP_ID) return; // don't log synthetic internal app
  try {
    db().prepare(`INSERT INTO api_rate_limit_log (app_id, method) VALUES (?, ?)`).run(appId, method);
  } catch (err) { logger.warn(`Failed to log rate limit request: ${err.message}`); }
}

function cleanUpRateLimitLog() {
  if (!db()) return;
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const result = db().prepare(`DELETE FROM api_rate_limit_log WHERE timestamp < ?`).run(oneDayAgo);
    if (result.changes > 0) logger.debug(`Rate limit log cleanup: removed ${result.changes} old entries.`);
  } catch (err) { logger.warn(`Rate limit log cleanup error: ${err.message}`); }
}

module.exports = {
  VALID_SCOPES, KEY_PLAINTEXT_PREFIX, INTERNAL_APP_ID,
  hashApiKey, generateApiKeyPlaintext, appTreasuryUserId, ensureAppTreasury,
  ensureMigrations,
  // Apps
  createApiApp, getApiApp, listApiApps, disableApp, enableApp, updateApp,
  // Internal app
  getInternalApp, lookupInternalToken,
  // Keys
  issueApiKey, listKeysForApp, revokeApiKey, lookupApiKey,
  // Links
  createLinkCode, consumeLinkCode, getLinkByExternal, getLinkByDiscord,
  listLinksForApp, listLinksForDiscordUser,
  revokeLinkByExternal, revokeLinkByDiscord, revokeLinkById,
  // Idempotency
  getIdempotentResponse, storeIdempotentResponse, purgeOldIdempotency, purgeExpiredLinkCodes,
  // Coin ops
  apiChargeUser, apiCreditUser, apiP2PTransfer, apiUserTransactions, withdrawAppTreasury,
  // Rate limiting
  checkRateLimit, trackRequest, cleanUpRateLimitLog,
  // Util
  unsafe_adjustBalance: adjustBalance,
};
