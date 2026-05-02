'use strict';

/**
 * SGCServer — OAuth 2.0 endpoints (Phase 3 of split).
 *
 * Implements two grants:
 *  - client_credentials: machine-to-machine, returns an access token bound to
 *    an api_apps row + its scopes. Replaces the cumbersome "user link code"
 *    flow for app-only operations.
 *  - authorization_code (with PKCE): user consents in their browser, the app
 *    receives a short-lived code, exchanges it for an access token + an
 *    external_account_links row.
 *
 * Issued access tokens are persisted in oauth_access_tokens and validated by
 * the API server's bearer auth path: tokens beginning with `sgc_at_` are
 * looked up in oauth_access_tokens; others fall back to api_keys.
 *
 * Tables (created lazily on first use):
 *   - oauth_clients
 *   - oauth_authorization_codes
 *   - oauth_access_tokens
 *
 * Note: link codes are kept as a non-OAuth fallback for non-browser
 * environments (Minecraft plugins, CLI tools).
 */

const crypto = require('node:crypto');
const { logger } = require('./logger');
const { getEconomyDb, getAccountInfo } = require('./economyStore');
const { getApiApp, upsertExternalAccountLink } = require('./apiKeyStore');

const ACCESS_TOKEN_PREFIX = 'sgc_at_';
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;          // 5 minutes
const ACCESS_TOKEN_TTL_S = 24 * 60 * 60;         // 24 hours
const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;   // 30 days

function db() { return getEconomyDb(); }

let schemaInitialized = false;
function ensureOAuthSchema() {
  if (schemaInitialized) return;
  if (!db()) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id      TEXT PRIMARY KEY,
      client_secret  TEXT NOT NULL,
      app_id         TEXT NOT NULL REFERENCES api_apps(id),
      redirect_uris  TEXT NOT NULL DEFAULT '[]',
      grant_types    TEXT NOT NULL DEFAULT '["client_credentials"]',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at     TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_clients_app ON oauth_clients(app_id);

    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code           TEXT PRIMARY KEY,
      client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id),
      app_id         TEXT NOT NULL,
      discord_id     TEXT NOT NULL,
      redirect_uri   TEXT NOT NULL,
      scope          TEXT NOT NULL DEFAULT '',
      code_challenge TEXT,
      code_challenge_method TEXT,
      external_id    TEXT NOT NULL DEFAULT '',
      external_name  TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at     TEXT NOT NULL,
      consumed_at    TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      token_hash     TEXT PRIMARY KEY,
      client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id),
      app_id         TEXT NOT NULL,
      discord_id     TEXT,
      scope          TEXT NOT NULL DEFAULT '',
      grant_type     TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at     TEXT NOT NULL,
      revoked_at     TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_at_client ON oauth_access_tokens(client_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_at_expires ON oauth_access_tokens(expires_at);
  `);
  schemaInitialized = true;
  logger.info('OAuth schema initialized.');
}

// ---------------------------------------------------------------------------
// Client management
// ---------------------------------------------------------------------------

function generateClientId() { return `sgc_client_${crypto.randomBytes(8).toString('hex')}`; }
function generateClientSecret() { return `sgc_secret_${crypto.randomBytes(32).toString('hex')}`; }
function hashSecret(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }
function constantTimeEquals(a, b) {
  const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function normalizeRedirectUris(redirectUris) {
  if (!Array.isArray(redirectUris)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of redirectUris) {
    const raw = String(entry || '').trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`Invalid redirect URI: ${raw}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported redirect URI protocol: ${raw}`);
    }
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeGrantTypes(grantTypes) {
  const allowed = new Set(['client_credentials', 'authorization_code']);
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(grantTypes) ? grantTypes : []) {
    const normalized = String(entry || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    if (!allowed.has(normalized)) throw new Error(`Unknown grant type: ${normalized}`);
    seen.add(normalized);
    out.push(normalized);
  }
  return out.length > 0 ? out : ['client_credentials'];
}

function createOAuthClient({ appId, redirectUris = [], grantTypes = ['client_credentials'] }) {
  ensureOAuthSchema();
  const app = getApiApp(appId);
  if (!app) throw new Error('App not found');
  const normalizedRedirectUris = normalizeRedirectUris(redirectUris);
  const normalizedGrantTypes = normalizeGrantTypes(grantTypes);
  const clientId = generateClientId();
  const secretPlain = generateClientSecret();
  const secretHash = hashSecret(secretPlain);
  db().prepare(`
    INSERT INTO oauth_clients (client_id, client_secret, app_id, redirect_uris, grant_types)
    VALUES (?, ?, ?, ?, ?)
  `).run(clientId, secretHash, appId, JSON.stringify(normalizedRedirectUris), JSON.stringify(normalizedGrantTypes));
  logger.info(`OAuth client created: ${clientId} for app ${appId}`);
  return {
    clientId,
    clientSecret: secretPlain,
    appId,
    redirectUris: normalizedRedirectUris,
    grantTypes: normalizedGrantTypes,
  };
}

function getOAuthClient(clientId) {
  ensureOAuthSchema();
  const row = db().prepare('SELECT * FROM oauth_clients WHERE client_id = ? AND revoked_at IS NULL').get(clientId);
  if (!row) return null;
  let redirectUris = []; let grantTypes = [];
  try { redirectUris = JSON.parse(row.redirect_uris || '[]'); } catch { /* */ }
  try { grantTypes = JSON.parse(row.grant_types || '[]'); } catch { /* */ }
  return { ...row, redirectUris, grantTypes };
}

function listOAuthClientsForApp(appId) {
  ensureOAuthSchema();
  const rows = db().prepare(`
    SELECT * FROM oauth_clients
    WHERE app_id = ?
    ORDER BY created_at DESC
  `).all(appId);
  return rows.map((row) => {
    let redirectUris = [];
    let grantTypes = [];
    try { redirectUris = JSON.parse(row.redirect_uris || '[]'); } catch { /* */ }
    try { grantTypes = JSON.parse(row.grant_types || '[]'); } catch { /* */ }
    return { ...row, redirectUris, grantTypes };
  });
}

function revokeOAuthClient(clientId) {
  ensureOAuthSchema();
  const r = db().prepare(`
    UPDATE oauth_clients
    SET revoked_at = COALESCE(revoked_at, datetime('now'))
    WHERE client_id = ?
  `).run(clientId);
  return r.changes > 0;
}

function verifyClientCredentials(clientId, clientSecret) {
  const client = getOAuthClient(clientId);
  if (!client) return null;
  if (!constantTimeEquals(client.client_secret, hashSecret(clientSecret))) return null;
  return client;
}

// ---------------------------------------------------------------------------
// Token issuance
// ---------------------------------------------------------------------------

function generateAccessTokenPlaintext() {
  return `${ACCESS_TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

function issueAccessToken({ clientId, appId, discordId = null, scope = '', grantType }) {
  ensureOAuthSchema();
  const plaintext = generateAccessTokenPlaintext();
  const tokenHash = hashSecret(plaintext);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_S * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db().prepare(`
    INSERT INTO oauth_access_tokens (token_hash, client_id, app_id, discord_id, scope, grant_type, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tokenHash, clientId, appId, discordId, scope, grantType, expiresAt);
  logger.debug(`OAuth access token issued: client=${clientId} app=${appId} grant=${grantType} discord=${discordId || '-'}`);
  return { plaintext, expiresIn: ACCESS_TOKEN_TTL_S };
}

function buildOAuthUserProfile(discordId, appId) {
  if (!discordId) return null;
  const app = getApiApp(appId);
  if (!app || !app.oauthExposeDiscordName) return null;
  const account = getAccountInfo(discordId);
  const discordUsername = String(account?.username || '').trim() || null;
  return {
    discord_id: String(discordId),
    discord_username: discordUsername,
    discord_name: discordUsername,
  };
}

/**
 * Validate an OAuth access token. Returns { app, discordId, scope, tokenId }
 * or null. Used by the API server's bearer auth path.
 */
function lookupAccessToken(plaintext) {
  ensureOAuthSchema();
  if (typeof plaintext !== 'string' || !plaintext.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const tokenHash = hashSecret(plaintext);
  const row = db().prepare(`
    SELECT * FROM oauth_access_tokens WHERE token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Date.parse(row.expires_at + 'Z') < Date.now()) return null;
  const app = getApiApp(row.app_id);
  if (!app || app.disabledAt) return null;

  // Use the OAuth scope intersected with the app's scopes.
  let oauthScopes = [];
  try { oauthScopes = String(row.scope || '').split(/\s+/).filter(Boolean); } catch { /* */ }
  const effectiveScopes = oauthScopes.length > 0
    ? app.scopes.filter((s) => oauthScopes.includes(s))
    : app.scopes;
  return {
    app: { ...app, scopes: effectiveScopes },
    discordId: row.discord_id,
    scope: row.scope,
    tokenId: row.token_hash,
    userProfile: buildOAuthUserProfile(row.discord_id, row.app_id),
  };
}

function revokeAccessToken(plaintext) {
  ensureOAuthSchema();
  const tokenHash = hashSecret(plaintext);
  const r = db().prepare(`UPDATE oauth_access_tokens SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL`).run(tokenHash);
  return r.changes > 0;
}

function purgeExpiredTokens() {
  ensureOAuthSchema();
  try {
    const r = db().prepare(`DELETE FROM oauth_access_tokens WHERE expires_at < datetime('now', '-1 day')`).run();
    if (r.changes) logger.debug(`oauth_access_tokens: purged ${r.changes} expired rows`);
  } catch (err) {
    logger.warn(`oauth_access_tokens purge failed: ${err.message}`);
  }
}

function validateAuthorizationRequest({
  clientId,
  redirectUri,
  responseType = 'code',
  scope = '',
  state,
  codeChallenge,
  codeChallengeMethod,
  externalId,
  externalName = '',
  expectedAppId = null,
}) {
  if (responseType !== 'code') return { error: 'unsupported_response_type', message: 'response_type must be "code"' };
  const client = getOAuthClient(clientId);
  if (!client) return { error: 'invalid_client', message: 'Unknown client_id' };
  if (expectedAppId && client.app_id !== expectedAppId) {
    return { error: 'invalid_client', message: 'OAuth client does not belong to this app' };
  }
  if (!client.grantTypes.includes('authorization_code')) {
    return { error: 'unauthorized_client', message: 'Client not allowed to use authorization_code' };
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return { error: 'invalid_request', message: 'redirect_uri not registered for this client' };
  }
  if (!state) return { error: 'invalid_request', message: 'state is required' };
  if (!codeChallenge) return { error: 'invalid_request', message: 'code_challenge is required' };
  if (codeChallengeMethod !== 'S256') {
    return { error: 'invalid_request', message: 'code_challenge_method must be S256' };
  }
  if (!externalId) return { error: 'invalid_request', message: 'external_id is required' };
  if (externalId.length > 200) return { error: 'invalid_request', message: 'external_id too long' };
  if (externalName.length > 80) return { error: 'invalid_request', message: 'external_name too long' };
  const app = getApiApp(client.app_id);
  if (!app || app.disabledAt) return { error: 'invalid_client', message: 'App disabled' };
  if (scope) {
    const requestedScopes = scope.split(/\s+/).filter(Boolean);
    const invalidScope = requestedScopes.find((entry) => !app.scopes.includes(entry));
    if (invalidScope) return { error: 'invalid_scope', message: `Scope not allowed: ${invalidScope}` };
  }
  return { client, app };
}

function createAuthorizationUrl({
  publicBaseUrl,
  clientId,
  redirectUri,
  scope = '',
  state,
  codeChallenge,
  codeChallengeMethod = 'S256',
  externalId,
  externalName = '',
  expectedAppId = null,
}) {
  ensureOAuthSchema();
  const normalizedRedirectUri = String(redirectUri || '').trim();
  const normalizedScope = String(scope || '').trim();
  const normalizedState = String(state || '').trim();
  const normalizedCodeChallenge = String(codeChallenge || '').trim();
  const normalizedMethod = String(codeChallengeMethod || '').trim() || 'S256';
  const normalizedExternalId = String(externalId || '').trim();
  const normalizedExternalName = String(externalName || '').trim();

  const validation = validateAuthorizationRequest({
    clientId: String(clientId || '').trim(),
    redirectUri: normalizedRedirectUri,
    responseType: 'code',
    scope: normalizedScope,
    state: normalizedState,
    codeChallenge: normalizedCodeChallenge,
    codeChallengeMethod: normalizedMethod,
    externalId: normalizedExternalId,
    externalName: normalizedExternalName,
    expectedAppId,
  });
  if (validation.error) return validation;

  let authorizeUrl;
  try {
    authorizeUrl = new URL('/oauth/authorize', publicBaseUrl);
  } catch {
    return { error: 'invalid_request', message: 'public_base_url is invalid' };
  }

  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', String(clientId || '').trim());
  authorizeUrl.searchParams.set('redirect_uri', normalizedRedirectUri);
  authorizeUrl.searchParams.set('state', normalizedState);
  authorizeUrl.searchParams.set('code_challenge', normalizedCodeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', normalizedMethod);
  authorizeUrl.searchParams.set('external_id', normalizedExternalId);
  if (normalizedScope) authorizeUrl.searchParams.set('scope', normalizedScope);
  if (normalizedExternalName) authorizeUrl.searchParams.set('external_name', normalizedExternalName);

  return {
    authorizeUrl: authorizeUrl.toString(),
    client: validation.client,
    app: validation.app,
  };
}

// ---------------------------------------------------------------------------
// Authorization codes (auth-code grant)
// ---------------------------------------------------------------------------

function createAuthorizationCode({
  clientId, appId, discordId, redirectUri, scope = '',
  codeChallenge = null, codeChallengeMethod = null,
  externalId = '', externalName = '',
}) {
  ensureOAuthSchema();
  const code = `sgc_code_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
  db().prepare(`
    INSERT INTO oauth_authorization_codes (
      code, client_id, app_id, discord_id, redirect_uri, scope,
      code_challenge, code_challenge_method, external_id, external_name, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, clientId, appId, discordId, redirectUri, scope,
    codeChallenge, codeChallengeMethod, externalId, externalName, expiresAt);
  logger.debug(`OAuth auth code issued for client=${clientId} discord=${discordId}`);
  return code;
}

function consumeAuthorizationCode({ code, clientId, redirectUri, codeVerifier = null }) {
  ensureOAuthSchema();
  const row = db().prepare('SELECT * FROM oauth_authorization_codes WHERE code = ?').get(code);
  if (!row) return { error: 'invalid_grant' };
  if (row.consumed_at) return { error: 'invalid_grant' };
  if (Date.parse(row.expires_at + 'Z') < Date.now()) return { error: 'invalid_grant' };
  if (row.client_id !== clientId) return { error: 'invalid_client' };
  if (row.redirect_uri !== redirectUri) return { error: 'invalid_grant' };

  if (row.code_challenge) {
    if (!codeVerifier) return { error: 'invalid_grant' };
    let computed;
    if (row.code_challenge_method === 'S256') {
      computed = crypto.createHash('sha256').update(codeVerifier, 'utf8').digest('base64')
        .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    } else {
      computed = codeVerifier;
    }
    if (!constantTimeEquals(computed, row.code_challenge)) return { error: 'invalid_grant' };
  }

  db().prepare(`UPDATE oauth_authorization_codes SET consumed_at = datetime('now') WHERE code = ?`).run(code);

  // Create the external_account_links row if external_id was supplied.
  if (row.external_id) {
    const linked = upsertExternalAccountLink({
      appId: row.app_id,
      discordId: row.discord_id,
      externalId: row.external_id,
      externalName: row.external_name,
    });
    if (linked.error) return { error: linked.error };
  }

  return {
    appId: row.app_id,
    discordId: row.discord_id,
    scope: row.scope,
  };
}

// ---------------------------------------------------------------------------
// HTTP handlers (called from server.js)
// ---------------------------------------------------------------------------

async function handleTokenEndpoint(req, res, { readJsonOrForm, sendJson, sendError }) {
  let body;
  try { body = await readJsonOrForm(req); }
  catch (err) { return sendError(res, 400, 'invalid_request', err.message); }

  const grantType = String(body.grant_type || '').trim();
  let clientId = String(body.client_id || '').trim();
  let clientSecret = String(body.client_secret || '').trim();

  // Support HTTP Basic for client auth (RFC 6749 §2.3.1).
  const auth = req.headers['authorization'] || '';
  if (!clientId && auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx >= 0) { clientId = decoded.slice(0, idx); clientSecret = decoded.slice(idx + 1); }
    } catch { /* */ }
  }

  const client = verifyClientCredentials(clientId, clientSecret);
  if (!client) {
    logger.warn(`OAuth /token: invalid client_credentials (client_id=${clientId || 'none'})`);
    return sendError(res, 401, 'invalid_client', 'Bad client_id or client_secret');
  }
  if (!client.grantTypes.includes(grantType)) {
    return sendError(res, 400, 'unsupported_grant_type', `Client not allowed: ${grantType}`);
  }

  if (grantType === 'client_credentials') {
    const app = getApiApp(client.app_id);
    if (!app || app.disabledAt) return sendError(res, 400, 'invalid_client', 'App disabled');
    const requestedScope = String(body.scope || '').trim();
    const grantedScope = requestedScope
      ? requestedScope.split(/\s+/).filter((s) => app.scopes.includes(s)).join(' ')
      : app.scopes.join(' ');
    const { plaintext, expiresIn } = issueAccessToken({
      clientId: client.client_id, appId: client.app_id,
      scope: grantedScope, grantType: 'client_credentials',
    });
    return sendJson(res, 200, {
      access_token: plaintext, token_type: 'Bearer',
      expires_in: expiresIn, scope: grantedScope,
    });
  }

  if (grantType === 'authorization_code') {
    const code = String(body.code || '').trim();
    const redirectUri = String(body.redirect_uri || '').trim();
    const codeVerifier = String(body.code_verifier || '').trim() || null;
    const result = consumeAuthorizationCode({ code, clientId, redirectUri, codeVerifier });
    if (result.error) return sendError(res, 400, result.error, result.error);
    const { plaintext, expiresIn } = issueAccessToken({
      clientId, appId: result.appId, discordId: result.discordId,
      scope: result.scope, grantType: 'authorization_code',
    });
    const response = {
      access_token: plaintext, token_type: 'Bearer',
      expires_in: expiresIn, scope: result.scope,
    };
    const userProfile = buildOAuthUserProfile(result.discordId, result.appId);
    if (userProfile) {
      response.user = userProfile;
      response.discord_id = userProfile.discord_id;
      response.discord_username = userProfile.discord_username;
      response.discord_name = userProfile.discord_name;
    }
    return sendJson(res, 200, response);
  }

  return sendError(res, 400, 'unsupported_grant_type', `Unknown grant_type: ${grantType}`);
}

async function handleRevokeEndpoint(req, res, { readJsonOrForm, sendJson, sendError }) {
  let body;
  try { body = await readJsonOrForm(req); }
  catch (err) { return sendError(res, 400, 'invalid_request', err.message); }
  const token = String(body.token || '').trim();
  if (!token) return sendError(res, 400, 'invalid_request', 'token is required');
  revokeAccessToken(token);
  // RFC 7009: respond 200 even if token was unknown.
  return sendJson(res, 200, { revoked: true });
}

/**
 * Authorize endpoint. This is a minimal browser-facing handler that returns
 * a tiny HTML page (or, more usefully, redirects to the LumiBot web panel's
 * existing OAuth consent page). For Phase 3 we provide a no-frills page
 * that requires the user to be already authenticated to the SGC web panel.
 *
 * Production deployments should redirect users through the panel's Discord
 * OAuth flow first, then call back into createAuthorizationCode().
 */
async function handleAuthorizeEndpoint(req, res, { url, sendError }) {
  const validation = validateAuthorizationRequest({
    clientId: url.searchParams.get('client_id') || '',
    redirectUri: String(url.searchParams.get('redirect_uri') || '').trim(),
    responseType: url.searchParams.get('response_type') || '',
    scope: String(url.searchParams.get('scope') || '').trim(),
    state: String(url.searchParams.get('state') || '').trim(),
    codeChallenge: String(url.searchParams.get('code_challenge') || '').trim(),
    codeChallengeMethod: String(url.searchParams.get('code_challenge_method') || '').trim(),
    externalId: String(url.searchParams.get('external_id') || '').trim(),
    externalName: String(url.searchParams.get('external_name') || '').trim(),
  });
  if (validation.error) return sendError(res, 400, validation.error, validation.message);
  res.writeHead(302, {
    location: `/oauth/consent?${url.searchParams.toString()}`,
    'cache-control': 'no-store',
  });
  res.end();
}

module.exports = {
  ensureOAuthSchema,
  // Client mgmt
  createOAuthClient, getOAuthClient, listOAuthClientsForApp, revokeOAuthClient,
  // Token ops
  issueAccessToken, lookupAccessToken, revokeAccessToken, purgeExpiredTokens,
  // Auth code grant
  createAuthorizationCode, consumeAuthorizationCode,
  createAuthorizationUrl,
  // HTTP handlers
  handleTokenEndpoint, handleRevokeEndpoint, handleAuthorizeEndpoint,
  // Constants
  ACCESS_TOKEN_PREFIX,
};
