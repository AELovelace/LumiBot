/**
 * Discord OAuth2 authentication for the SGC web panel.
 *
 * Flow:
 *   /auth/discord/login  → redirect to Discord OAuth authorize URL
 *   /auth/discord/callback → exchange code, verify guild + role, issue session cookie
 *   /auth/logout         → destroy session
 *
 * Authorization: user must be a member of DISCORD_PANEL_GUILD_ID and hold one of
 * the two fixed allowed role IDs (Owner or Moderator).
 *
 * Discord tokens are discarded immediately after the access decision is made.
 * The panel issues its own opaque session cookie (HttpOnly, SameSite=Lax).
 */

'use strict';

const crypto = require('node:crypto');
const { logger } = require('./logger');

// ---------------------------------------------------------------------------
// Fixed authorization constants
// ---------------------------------------------------------------------------

/** Role IDs allowed to access the panel. Never changes at runtime. */
const PANEL_ALLOWED_ROLE_IDS = new Set([
  '901304657937317909', // Owner
  '901304988083572756', // Moderator
]);

const DISCORD_API_BASE = 'https://discord.com/api';
const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = `${DISCORD_API_BASE}/oauth2/token`;

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/**
 * session token (hex) → { discordId, username, avatar, roles[], expiresAt }
 * @type {Map<string, object>}
 */
const sessions = new Map();

/**
 * CSRF state token (hex) → { expiresAt }
 * @type {Map<string, object>}
 */
const oauthStates = new Map();

// Cleanup stale sessions and states every 10 minutes.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (sess.expiresAt <= now) sessions.delete(token);
  }
  for (const [state, entry] of oauthStates) {
    if (entry.expiresAt <= now) oauthStates.delete(state);
  }
}, CLEANUP_INTERVAL_MS).unref();

// ---------------------------------------------------------------------------
// Config helpers (read env directly to avoid circular deps with config.js)
// ---------------------------------------------------------------------------

function getPanelAuthConfig() {
  return {
    clientId: process.env.DISCORD_OAUTH_CLIENT_ID?.trim() || '',
    clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET?.trim() || '',
    redirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() || '',
    panelGuildId: process.env.DISCORD_PANEL_GUILD_ID?.trim() || '895446230967148544',
    sessionSecret: process.env.WEB_PANEL_SESSION_SECRET?.trim() || '',
    sessionTtlMs: parseEnvPositiveInt(process.env.WEB_PANEL_SESSION_TTL_MS, 7_200_000),
    secureCookies: parseEnvBoolean(process.env.WEB_PANEL_SECURE_COOKIES, false),
  };
}

function parseEnvPositiveInt(value, fallback) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) || n <= 0 ? fallback : n;
}

function parseEnvBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

/**
 * Returns an array of warning strings for misconfigured/missing OAuth settings.
 * Called at startup from webPanel.js.
 */
function validateAuthConfig() {
  const cfg = getPanelAuthConfig();
  const warnings = [];

  if (!cfg.clientId) warnings.push('DISCORD_OAUTH_CLIENT_ID is not set — OAuth login will fail');
  if (!cfg.clientSecret) warnings.push('DISCORD_OAUTH_CLIENT_SECRET is not set — OAuth login will fail');
  if (!cfg.redirectUri) warnings.push('DISCORD_OAUTH_REDIRECT_URI is not set — OAuth login will fail');
  if (!cfg.panelGuildId) warnings.push('DISCORD_PANEL_GUILD_ID is not set — defaulting to 895446230967148544');
  if (cfg.sessionSecret && cfg.sessionSecret.length < 32) {
    warnings.push('WEB_PANEL_SESSION_SECRET is shorter than 32 characters — use a longer random value');
  }

  return warnings;
}

/**
 * Throws if mandatory auth config is missing. Called at startup before the
 * panel binds its socket — refuses to run unsigned sessions.
 */
function assertAuthConfigOrThrow() {
  const cfg = getPanelAuthConfig();
  if (!cfg.sessionSecret) {
    throw new Error(
      'WEB_PANEL_SESSION_SECRET is required and must be set to a long random value (>= 32 chars). ' +
      'Refusing to start the web panel with unsigned sessions.'
    );
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'sgc_panel_sess';

/**
 * Parse cookies from the Cookie header into a plain object.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Record<string, string>}
 */
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 1) continue;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (name) result[name] = decodeURIComponent(val);
  }
  return result;
}

/**
 * Build a Set-Cookie header value.
 */
function buildSetCookieHeader(name, value, { maxAgeSeconds, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let header = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) header += '; HttpOnly';
  if (secure) header += '; Secure';
  if (maxAgeSeconds != null) header += `; Max-Age=${maxAgeSeconds}`;
  return header;
}

/**
 * Sign a session token with HMAC-SHA256 using the session secret.
 * Returns "token.signature" — both parts are hex strings.
 */
function signToken(token, secret) {
  const sig = crypto.createHmac('sha256', secret).update(token).digest('hex');
  return `${token}.${sig}`;
}

/**
 * Verify and extract the raw token from a signed token string.
 * Returns null if verification fails.
 */
function verifyToken(signed, secret) {
  if (!secret) return null;
  const dotIdx = signed.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const token = signed.slice(0, dotIdx);
  const expected = crypto.createHmac('sha256', secret).update(token).digest('hex');
  const actual = signed.slice(dotIdx + 1);
  if (actual.length !== expected.length) return null;
  // Constant-time comparison
  const expBuf = Buffer.from(expected, 'hex');
  const actBuf = Buffer.from(actual, 'hex');
  if (expBuf.length !== actBuf.length) return null;
  if (!crypto.timingSafeEqual(expBuf, actBuf)) return null;
  return token;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Create a new panel session for an authenticated user.
 * @returns {string} signed session cookie value
 */
function createSession(discordId, username, avatar, roles) {
  const { sessionSecret, sessionTtlMs } = getPanelAuthConfig();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    discordId,
    username,
    avatar,
    roles,
    expiresAt: Date.now() + sessionTtlMs,
  });
  return signToken(token, sessionSecret);
}

/**
 * Resolve a session from the incoming request cookies.
 * Returns the session object or null.
 */
function getSession(req) {
  const { sessionSecret } = getPanelAuthConfig();
  const cookies = parseCookies(req);
  const signed = cookies[SESSION_COOKIE_NAME];
  if (!signed) return null;
  const token = verifyToken(signed, sessionSecret);
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (sess.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

/**
 * Destroy the session from the incoming request (logout).
 */
function destroySession(req) {
  const { sessionSecret } = getPanelAuthConfig();
  const cookies = parseCookies(req);
  const signed = cookies[SESSION_COOKIE_NAME];
  if (!signed) return;
  const token = verifyToken(signed, sessionSecret);
  if (token) sessions.delete(token);
}

/**
 * Build the Set-Cookie header for issuing a new session.
 */
function buildSessionCookieHeader(signedToken) {
  const { sessionTtlMs, secureCookies } = getPanelAuthConfig();
  return buildSetCookieHeader(SESSION_COOKIE_NAME, signedToken, {
    maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
    secure: secureCookies,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

/**
 * Build a Set-Cookie header that clears the session cookie.
 */
function buildClearCookieHeader() {
  const { secureCookies } = getPanelAuthConfig();
  return buildSetCookieHeader(SESSION_COOKIE_NAME, '', {
    maxAgeSeconds: 0,
    secure: secureCookies,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

// ---------------------------------------------------------------------------
// CSRF state management
// ---------------------------------------------------------------------------

const OAUTH_STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateOAuthState() {
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
  return state;
}

/** Returns true and deletes the state if it is valid, false otherwise. */
function consumeOAuthState(state) {
  if (!state) return false;
  const entry = oauthStates.get(state);
  if (!entry) return false;
  oauthStates.delete(state);
  return entry.expiresAt > Date.now();
}

// ---------------------------------------------------------------------------
// Discord OAuth helpers
// ---------------------------------------------------------------------------

/**
 * Build the Discord authorization URL to redirect the user to.
 */
function buildDiscordAuthorizeUrl(state) {
  const { clientId, redirectUri } = getPanelAuthConfig();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'identify guilds.members.read',
    redirect_uri: redirectUri,
    state,
    prompt: 'consent',
  });
  return `${DISCORD_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange the authorization code for tokens at Discord's token endpoint.
 * Returns the token response JSON or throws.
 */
async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = getPanelAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: redirectUri,
  });

  const resp = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Discord recommends HTTP Basic auth for the token endpoint.
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '(unreadable)');
    throw new Error(`Discord token exchange failed: ${resp.status} ${text}`);
  }

  return resp.json();
}

/**
 * Fetch the Discord user identified by the access token.
 */
async function fetchDiscordUser(accessToken) {
  const resp = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch Discord user: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Fetch the panel guild member object for the authenticated user.
 * Returns null if the user is not in the guild (403/404 from Discord).
 */
async function fetchGuildMember(accessToken) {
  const { panelGuildId } = getPanelAuthConfig();
  const resp = await fetch(
    `${DISCORD_API_BASE}/users/@me/guilds/${panelGuildId}/member`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (resp.status === 403 || resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`Failed to fetch guild member: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Decide whether the guild member is allowed into the panel.
 * Returns { allowed: boolean, reason: string }
 */
function checkAccess(member) {
  if (!member) {
    return { allowed: false, reason: 'not_in_guild' };
  }
  if (!Array.isArray(member.roles)) {
    return { allowed: false, reason: 'no_roles' };
  }
  const hasAllowedRole = member.roles.some((roleId) => PANEL_ALLOWED_ROLE_IDS.has(roleId));
  if (!hasAllowedRole) {
    return { allowed: false, reason: 'insufficient_role' };
  }
  return { allowed: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /auth/discord/login
 * Redirects user to Discord OAuth authorize page.
 */
function handleLoginRoute(req, res) {
  const { clientId, redirectUri } = getPanelAuthConfig();

  if (!clientId || !redirectUri) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Discord OAuth is not configured on this panel.');
    return;
  }

  const state = generateOAuthState();
  const url = buildDiscordAuthorizeUrl(state);
  res.writeHead(302, { Location: url });
  res.end();
}

/**
 * GET /auth/discord/callback?code=...&state=...
 * Handles the OAuth callback from Discord.
 */
async function handleCallbackRoute(req, res, parsedUrl) {
  const buildError = (status, msg) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Error</title>
      <style>body{background:#0a0a0f;color:#c9c9d1;font-family:monospace;padding:40px;}</style>
      </head><body><h1 style="color:#ff4444;">Access Denied</h1><p>${msg}</p>
      <br><a href="/auth/discord/login" style="color:#ff69b4;">Try again</a></body></html>`);
  };

  const code = parsedUrl.searchParams.get('code');
  const state = parsedUrl.searchParams.get('state');

  if (!code || !state) {
    return buildError(400, 'Missing code or state parameter.');
  }

  if (!consumeOAuthState(state)) {
    return buildError(400, 'Invalid or expired OAuth state. Please try logging in again.');
  }

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    logger.error('[auth] Token exchange error:', err.message);
    return buildError(500, 'Failed to exchange authorization code with Discord.');
  }

  const accessToken = tokens.access_token;

  let discordUser;
  try {
    discordUser = await fetchDiscordUser(accessToken);
  } catch (err) {
    logger.error('[auth] User fetch error:', err.message);
    return buildError(500, 'Failed to retrieve your Discord identity.');
  }

  let member;
  try {
    member = await fetchGuildMember(accessToken);
  } catch (err) {
    logger.error('[auth] Guild member fetch error:', err.message);
    return buildError(500, 'Failed to verify your server membership.');
  }

  // Discord tokens are discarded from here — we only use the access decision.
  const { allowed, reason } = checkAccess(member);

  if (!allowed) {
    logger.info(`[auth] Access denied for Discord user ${discordUser.id} (${discordUser.username}) — reason: ${reason}`);
    const reasonMsg = reason === 'not_in_guild'
      ? 'You are not a member of the required Discord server.'
      : 'You do not have the required role to access this panel.';
    return buildError(403, reasonMsg);
  }

  // Issue panel session
  const signedToken = createSession(discordUser.id, discordUser.username, discordUser.avatar, member.roles);
  logger.info(`[auth] Login successful: ${discordUser.id} (${discordUser.username})`);

  res.writeHead(302, {
    'Set-Cookie': buildSessionCookieHeader(signedToken),
    Location: '/',
  });
  res.end();
}

/**
 * POST /auth/logout
 * Destroys the session and clears the cookie.
 */
function handleLogoutRoute(req, res) {
  destroySession(req);
  res.writeHead(302, {
    'Set-Cookie': buildClearCookieHeader(),
    Location: '/auth/discord/login',
  });
  res.end();
}

/**
 * Render the login page (shown to unauthenticated visitors).
 */
function renderLoginPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SGC Panel — Login</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Space+Mono:wght@400;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#0a0a0f; color:#c9c9d1;
    font-family:'Space Mono','Courier New',monospace;
    font-size:14px; line-height:1.6; min-height:100vh;
    display:flex; align-items:center; justify-content:center;
  }
  body::before {
    content:''; position:fixed; top:0;left:0;right:0;bottom:0;
    background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.15) 4px);
    pointer-events:none; z-index:9999;
  }
  .login-box {
    background:#12121f; border:1px solid #ff69b4;
    padding:40px 48px; max-width:420px; width:100%; text-align:center;
    position:relative;
  }
  .login-box::before {
    content:''; position:absolute; top:0;left:0; width:4px; height:100%; background:#ff69b4;
  }
  h1 { font-family:'VT323',monospace; font-size:36px; color:#ff69b4;
    text-shadow:0 0 10px rgba(255,105,180,0.5); letter-spacing:2px; margin-bottom:8px; }
  .subtitle { color:#888; font-size:12px; margin-bottom:32px; }
  .discord-btn {
    display:inline-block; width:100%; padding:14px 24px;
    background:#5865F2; color:#fff; text-decoration:none;
    font-family:'VT323',monospace; font-size:22px; letter-spacing:1px;
    border:none; cursor:pointer; transition:background 0.2s;
  }
  .discord-btn:hover { background:#4752c4; }
  .notice { color:#666; font-size:11px; margin-top:24px; }
  .notice a { color:#ff69b4; }
  .error-msg { color:#ff4444; font-size:13px; margin-bottom:16px;
    background:rgba(255,68,68,0.1); border:1px solid #ff4444; padding:8px 12px; }
</style>
</head>
<body>
<div class="login-box">
  <h1>SGC PANEL</h1>
  <div class="subtitle">SadGirlsClub Economy Control // auth required</div>
  ${message ? `<div class="error-msg">${message}</div>` : ''}
  <a href="/auth/discord/login" class="discord-btn">Sign in with Discord</a>
  <div class="notice">Access is limited to server modmins.<br>
    Questions? <a href="https://discord.gg/">Join the server</a>.</div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Auth gate middleware
// ---------------------------------------------------------------------------

/**
 * Check if the request has a valid panel session.
 * Returns the session object if authenticated, null otherwise.
 */
function requireAuth(req) {
  return getSession(req);
}

/**
 * CSRF defense: for state-changing requests (POST/PUT/PATCH/DELETE), confirm
 * the request originated from the same origin as the panel itself by checking
 * the `Origin` header (sent by all modern browsers on cross-origin POSTs)
 * with a `Referer` fallback. SameSite=Lax cookies already block most cross-
 * site form submissions; this is defense-in-depth.
 *
 * Returns { ok: true } if safe, or { ok: false, reason } if rejected.
 * Safe (read-only) methods always return { ok: true }.
 */
function getRealHost(req) {
  return req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host || '';
}

function validateSameOrigin(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }
  const host = getRealHost(req);
  if (!host) return { ok: false, reason: 'missing host header' };

  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { return { ok: false, reason: 'malformed origin' }; }
    if (parsed.host !== host) return { ok: false, reason: `origin host ${parsed.host} != ${host}` };
    return { ok: true };
  }

  const referer = req.headers.referer || req.headers.referrer;
  if (referer) {
    let parsed;
    try { parsed = new URL(referer); } catch { return { ok: false, reason: 'malformed referer' }; }
    if (parsed.host !== host) return { ok: false, reason: `referer host ${parsed.host} != ${host}` };
    return { ok: true };
  }

  // Neither header present on a state-changing request — reject.
  return { ok: false, reason: 'missing Origin and Referer headers' };
}

/**
 * Build the user badge HTML fragment injected into the panel nav.
 */
function buildUserBadgeHtml(session) {
  if (!session) return '';
  const avatarUrl = session.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(session.discordId)}/${encodeURIComponent(session.avatar)}.png?size=32`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  return `<div style="display:flex;align-items:center;gap:10px;margin-left:auto;">
    <img src="${avatarUrl}" alt="" style="width:26px;height:26px;border-radius:50%;border:1px solid #ff69b4;vertical-align:middle;">
    <span style="font-family:'VT323',monospace;font-size:18px;color:#ff69b4;">${session.username}</span>
    <form method="POST" action="/auth/logout" style="display:inline;margin:0;">
      <button type="submit" style="background:transparent;border:1px solid #666;color:#888;font-family:'VT323',monospace;font-size:16px;padding:4px 10px;cursor:pointer;">Logout</button>
    </form>
  </div>`;
}

module.exports = {
  validateAuthConfig,
  assertAuthConfigOrThrow,
  handleLoginRoute,
  handleCallbackRoute,
  handleLogoutRoute,
  renderLoginPage,
  requireAuth,
  buildUserBadgeHtml,
  validateSameOrigin,
  // Exported for testing/internal use
  getSession,
  destroySession,
};
