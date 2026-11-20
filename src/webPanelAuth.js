'use strict';

const crypto = require('node:crypto');
const { URL } = require('node:url');

const { logger } = require('./logger');

// Role IDs allowed to access the admin panel.
const PANEL_ALLOWED_ROLE_IDS = new Set([
  '901304657937317909', // Owner
  '901304988083572756', // Moderator
]);

const DISCORD_API_BASE = 'https://discord.com/api';
const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = `${DISCORD_API_BASE}/oauth2/token`;
const SESSION_COOKIE_NAME = 'sgc_panel_sess';
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const OAUTH_STATE_MAX_ENTRIES = 5000;                 // most pending logins kept in memory; the oldest is dropped past this
const OAUTH_STATE_COOKIE_PREFIX = 'sgc_oauth_';       // name prefix of the short-lived cookie that ties a login to one browser
const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;         // length of one login rate-limit window (1 minute)
const LOGIN_RATE_LIMIT_MAX = 30;                      // login starts allowed per client IP in one window
const LOGIN_RATE_BUCKETS_MAX = 10000;                 // most IPs tracked at once, so the limiter itself can't fill memory

/** @type {Map<string, {discordId: string, username: string, avatar: string, roles: string[], isPanelAdmin: boolean, expiresAt: number}>} */
const sessions = new Map();
/** @type {Map<string, {expiresAt: number, accessLevel: 'panel'|'member', nextPath: string, popup: boolean, redirectUri: string}>} */
const oauthStates = new Map();
/** @type {Map<string, {windowStart: number, count: number}>} */
const loginRateBuckets = new Map();                   // client IP -> login starts counted in its current window

setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (sess.expiresAt <= now) sessions.delete(token);
  }
  for (const [state, entry] of oauthStates) {
    if (entry.expiresAt <= now) oauthStates.delete(state);
  }
  for (const [ip, bucket] of loginRateBuckets) {                                       // walk every tracked IP
    if (now - bucket.windowStart >= LOGIN_RATE_LIMIT_WINDOW_MS) loginRateBuckets.delete(ip);   // forget IPs whose window has ended
  }
}, CLEANUP_INTERVAL_MS).unref();

function getPanelAuthConfig(overrides = {}) {
  return {
    clientId: process.env.DISCORD_OAUTH_CLIENT_ID?.trim() || '',
    clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET?.trim() || '',
    redirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() || '',
    panelGuildId: process.env.DISCORD_PANEL_GUILD_ID?.trim() || '895446230967148544',
    sessionSecret: process.env.WEB_PANEL_SESSION_SECRET?.trim() || '',
    sessionTtlMs: parseEnvPositiveInt(process.env.WEB_PANEL_SESSION_TTL_MS, 7_200_000),
    secureCookies: parseEnvBoolean(process.env.WEB_PANEL_SECURE_COOKIES, true),
    ...overrides,
  };
}

function getBasePath(envVarName = 'WEB_PANEL_BASE_PATH') {
  return (process.env[envVarName] || '').replace(/\/+$/u, '');
}

function buildBasePathPath(path, envVarName = 'WEB_PANEL_BASE_PATH') {
  return `${getBasePath(envVarName)}${path}`;
}

function panelPath(path) {
  return buildBasePathPath(path, 'WEB_PANEL_BASE_PATH');
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

function validateAuthConfig() {
  const cfg = getPanelAuthConfig();
  const warnings = [];
  if (!cfg.clientId) warnings.push('DISCORD_OAUTH_CLIENT_ID is not set - OAuth login will fail');
  if (!cfg.clientSecret) warnings.push('DISCORD_OAUTH_CLIENT_SECRET is not set - OAuth login will fail');
  if (!cfg.redirectUri) warnings.push('DISCORD_OAUTH_REDIRECT_URI is not set - OAuth login will fail');
  if (!cfg.panelGuildId) warnings.push('DISCORD_PANEL_GUILD_ID is not set - defaulting to 895446230967148544');
  if (cfg.sessionSecret && cfg.sessionSecret.length < 32) {
    warnings.push('WEB_PANEL_SESSION_SECRET is shorter than 32 characters - use a longer random value');
  }
  return warnings;
}

function assertAuthConfigOrThrow() {
  const cfg = getPanelAuthConfig();
  if (!cfg.sessionSecret) {
    throw new Error(
      'WEB_PANEL_SESSION_SECRET is required and must be set to a long random value (>= 32 chars). ' +
      'Refusing to start the web panel with unsigned sessions.'
    );
  }
}

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

function buildSetCookieHeader(name, value, { maxAgeSeconds, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let header = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) header += '; HttpOnly';
  if (secure) header += '; Secure';
  if (maxAgeSeconds != null) header += `; Max-Age=${maxAgeSeconds}`;
  return header;
}

function signToken(token, secret) {
  const sig = crypto.createHmac('sha256', secret).update(token).digest('hex');
  return `${token}.${sig}`;
}

function verifyToken(signed, secret) {
  if (!secret) return null;
  const dotIdx = signed.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const token = signed.slice(0, dotIdx);
  const expected = crypto.createHmac('sha256', secret).update(token).digest('hex');
  const actual = signed.slice(dotIdx + 1);
  if (actual.length !== expected.length) return null;
  const expBuf = Buffer.from(expected, 'hex');
  const actBuf = Buffer.from(actual, 'hex');
  if (expBuf.length !== actBuf.length) return null;
  if (!crypto.timingSafeEqual(expBuf, actBuf)) return null;
  return token;
}

function createSession(discordId, username, avatar, roles, { isPanelAdmin = false } = {}) {
  const { sessionSecret, sessionTtlMs } = getPanelAuthConfig();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    discordId,
    username,
    avatar,
    roles,
    isPanelAdmin: Boolean(isPanelAdmin),
    expiresAt: Date.now() + sessionTtlMs,
  });
  return signToken(token, sessionSecret);
}

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

function destroySession(req) {
  const { sessionSecret } = getPanelAuthConfig();
  const cookies = parseCookies(req);
  const signed = cookies[SESSION_COOKIE_NAME];
  if (!signed) return;
  const token = verifyToken(signed, sessionSecret);
  if (token) sessions.delete(token);
}

function buildSessionCookieHeader(signedToken, opts = {}) {
  const { sessionTtlMs, secureCookies } = getPanelAuthConfig();
  return buildSetCookieHeader(SESSION_COOKIE_NAME, signedToken, {
    maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
    secure: opts.secure ?? secureCookies,
    httpOnly: true,
    sameSite: opts.sameSite || 'Lax',
  });
}

function buildClearCookieHeader(opts = {}) {
  const { secureCookies } = getPanelAuthConfig();
  return buildSetCookieHeader(SESSION_COOKIE_NAME, '', {
    maxAgeSeconds: 0,
    secure: opts.secure ?? secureCookies,
    httpOnly: true,
    sameSite: opts.sameSite || 'Lax',
  });
}

// Backslashes and control characters (tab, newline, DEL...) that browsers may treat as "/" or strip out.
const UNSAFE_NEXT_PATH_CHARS = /[\\\u0000-\u001f\u007f]/u;   // any of these in a redirect target means "refuse it"

/**
 * The place to send someone after login. Only a path on this same site is allowed; anything that could
 * leave the site (//evil.com, /\evil.com, /%5Cevil.com, /\tevil...) falls back to "/".
 */
function normalizeNextPath(nextPath) {
  const raw = String(nextPath || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (UNSAFE_NEXT_PATH_CHARS.test(raw)) return '/';                 // a raw backslash or control character: refuse
  let decoded;                                                       // the path with %XX escapes turned back into characters
  try { decoded = decodeURIComponent(raw); } catch { return '/'; }   // a broken %-escape: refuse
  if (decoded.startsWith('//') || UNSAFE_NEXT_PATH_CHARS.test(decoded)) return '/';   // %2F%2F or %5C hiding a way off-site: refuse
  let resolved;                                                      // where a browser would actually land
  try { resolved = new URL(raw, 'http://x'); } catch { return '/'; } // not even a valid URL: refuse
  if (resolved.origin !== 'http://x') return '/';                   // it would leave this site: refuse
  return raw;                                                        // safe same-site path: keep it as given
}

// Drop the oldest pending logins once the map is full, so flooding the login URL can't use up memory.
function enforceOAuthStateCap() {
  if (oauthStates.size < OAUTH_STATE_MAX_ENTRIES) return;           // still room: nothing to do
  const now = Date.now();                                            // one clock reading for the sweep
  for (const [state, entry] of oauthStates) {                        // first throw away anything already expired
    if (entry.expiresAt <= now) oauthStates.delete(state);           // expired: remove it
  }
  for (const state of oauthStates.keys()) {                          // Maps keep insertion order, so this walks oldest first
    if (oauthStates.size < OAUTH_STATE_MAX_ENTRIES) break;           // enough room again: stop
    oauthStates.delete(state);                                       // evict the oldest pending login
  }
}

function generateOAuthState({ accessLevel = 'panel', nextPath = '/', popup = false, redirectUri = '' } = {}) {
  const state = crypto.randomBytes(24).toString('hex');
  enforceOAuthStateCap();                                            // make room before adding another pending login
  oauthStates.set(state, {
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    accessLevel: accessLevel === 'member' ? 'member' : 'panel',
    nextPath: normalizeNextPath(nextPath),
    popup: Boolean(popup),
    redirectUri: String(redirectUri || ''),   // the callback Discord was given; the code exchange must send the same one
  });
  return state;
}

// Hosts other than the configured redirect URI's own that may receive the Discord callback, e.g. a second
// public domain that serves this site. Comma-separated host names.
function getOAuthPublicHosts() {
  return String(process.env.DISCORD_OAUTH_PUBLIC_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      try { return new URL(entry.includes('://') ? entry : `https://${entry}`).host; } catch { return entry; }
    });
}

/**
 * The redirect URI for this login: the configured one, moved onto the host the person is using when that
 * host is in DISCORD_OAUTH_PUBLIC_HOSTS, so the callback (and the session cookie it sets) lands on the
 * same origin the login began on. Any other host keeps the configured URI.
 */
function resolveRedirectUri(req, configured) {
  let uri;
  try { uri = new URL(configured); } catch { return configured; }
  const host = getRealHost(req).toLowerCase();
  if (!host || host === uri.host.toLowerCase()) return configured;   // already the configured host
  if (!getOAuthPublicHosts().includes(host)) return configured;       // unknown host: never follow it
  uri.protocol = 'https:';                                            // public hosts are always https
  uri.host = host;                                                    // same path: /lumibot/auth/discord/callback
  return uri.toString();
}

// A value placed inside a <script> block: JSON, with "<", ">" and "&" escaped so a "</script>" or "<!--" can't
// end the block, and U+2028/U+2029 escaped because older JavaScript engines treat them as line breaks in strings.
function scriptJson(value) {
  const json = JSON.stringify(value);                 // plain JSON text (undefined for undefined/functions)
  if (json === undefined) return 'undefined';         // same text a template would have printed before
  return json
    .replace(/</gu, '\\u003c')                         // "<" can't start "</script>" or "<!--"
    .replace(/>/gu, '\\u003e')                         // ">" can't finish "-->" either
    .replace(/&/gu, '\\u0026')                         // "&" can't form HTML entities
    .replace(/\u2028/gu, '\\u2028')                    // LINE SEPARATOR written as an escape, not a raw character
    .replace(/\u2029/gu, '\\u2029');                   // PARAGRAPH SEPARATOR likewise
}

// The cookie that holds one login's state: named from the state's start, so two logins at once don't clash.
function oauthStateCookieName(state) {
  return `${OAUTH_STATE_COOKIE_PREFIX}${String(state || '').slice(0, 16)}`;   // e.g. sgc_oauth_1a2b3c4d5e6f7a8b
}

// Constant-time string comparison, so an attacker can't guess a value one character at a time.
function safeEqualStrings(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');  // first value as bytes
  const bBuf = Buffer.from(String(b || ''), 'utf8');  // second value as bytes
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;   // empty or different lengths never match
  return crypto.timingSafeEqual(aBuf, bBuf);          // compare every byte in the same amount of time
}

// Is this address the machine itself (where nginx or the arcade proxy usually runs)?
function isLoopbackAddress(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';   // IPv4, IPv6, and IPv4-in-IPv6 loopback
}

// Extra proxy addresses whose X-Real-IP / X-Forwarded-For headers we believe (comma-separated env list).
function getTrustedProxyIps() {
  return String(process.env.WEB_TRUSTED_PROXY_IPS || '')   // e.g. "10.0.0.5,10.0.0.6"
    .split(',')                                             // one entry per address
    .map((s) => s.trim())                                   // drop stray spaces
    .filter(Boolean);                                       // drop empty entries
}

/**
 * The visitor's IP address. Proxy headers are only believed when the connection itself comes from a trusted
 * proxy (this machine, or WEB_TRUSTED_PROXY_IPS); anyone else could simply type a fake X-Real-IP header.
 */
function getClientIp(req) {
  const peer = String(req.socket?.remoteAddress || '');                          // who actually opened the TCP connection
  const peerIsProxy = isLoopbackAddress(peer) || getTrustedProxyIps().includes(peer);   // is that a proxy we trust?
  if (peerIsProxy) {
    const realIp = req.headers['x-real-ip'];                                       // nginx's usual "real client" header
    if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();         // use it when present
    const forwarded = req.headers['x-forwarded-for'];                              // the other common proxy header
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const hops = forwarded.split(',');                                           // "client, proxy1, proxy2"
      return hops[hops.length - 1].trim();                                         // the entry our proxy added is the last one
    }
  }
  return peer || 'unknown';                                                        // no trusted proxy: the connection's own address
}

// Count one login start for this IP; false once it has started too many logins this minute.
function takeLoginRateToken(ip) {
  const now = Date.now();                                                          // one clock reading
  let bucket = loginRateBuckets.get(ip);                                           // this IP's counter, if any
  if (!bucket || now - bucket.windowStart >= LOGIN_RATE_LIMIT_WINDOW_MS) {         // none yet, or its minute is over
    if (!bucket && loginRateBuckets.size >= LOGIN_RATE_BUCKETS_MAX) {              // limiter full and this is a new IP
      const oldestIp = loginRateBuckets.keys().next().value;                       // the IP tracked the longest
      loginRateBuckets.delete(oldestIp);                                           // forget it to make room
    }
    bucket = { windowStart: now, count: 0 };                                       // start a fresh minute
    loginRateBuckets.set(ip, bucket);                                              // remember it
  }
  bucket.count += 1;                                                               // count this login start
  return bucket.count <= LOGIN_RATE_LIMIT_MAX;                                     // allowed while under the limit
}

function consumeOAuthState(state) {
  if (!state) return null;
  const entry = oauthStates.get(state);
  if (!entry) return null;
  oauthStates.delete(state);
  return entry.expiresAt > Date.now() ? entry : null;
}

function buildDiscordAuthorizeUrl(state, cfg = getPanelAuthConfig()) {
  const { clientId, redirectUri } = cfg;
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

async function exchangeCode(code, cfg = getPanelAuthConfig()) {
  const { clientId, clientSecret, redirectUri } = cfg;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: redirectUri,
  });

  const resp = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '(unreadable)');
    throw new Error(`Discord token exchange failed: ${resp.status} ${text}`);
  }

  return resp.json();
}

async function fetchDiscordUser(accessToken) {
  const resp = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Failed to fetch Discord user: ${resp.status}`);
  return resp.json();
}

async function fetchGuildMember(accessToken, cfg = getPanelAuthConfig()) {
  const { panelGuildId } = cfg;
  const resp = await fetch(
    `${DISCORD_API_BASE}/users/@me/guilds/${panelGuildId}/member`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (resp.status === 403 || resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Failed to fetch guild member: ${resp.status}`);
  return resp.json();
}

function checkMemberAccess(member) {
  if (!member) return { allowed: false, reason: 'not_in_guild' };
  return { allowed: true, reason: 'ok' };
}

function checkPanelAccess(member) {
  const memberAccess = checkMemberAccess(member);
  if (!memberAccess.allowed) return memberAccess;
  if (!Array.isArray(member.roles)) return { allowed: false, reason: 'no_roles' };
  const hasAllowedRole = member.roles.some((roleId) => PANEL_ALLOWED_ROLE_IDS.has(roleId));
  return hasAllowedRole ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'insufficient_role' };
}

function parseRequestUrl(req) {
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return new URL(req.url, `${proto}://${host}`);
}

function handleLoginRoute(req, res, opts = {}) {
  const cfg = getPanelAuthConfig(opts.authConfig);
  const { clientId, redirectUri } = cfg;
  if (!clientId || !redirectUri) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Discord OAuth is not configured on this panel.');
    return;
  }

  if (!takeLoginRateToken(getClientIp(req))) {                                    // this IP started too many logins this minute
    res.writeHead(429, {
      'Content-Type': 'text/plain',                                                 // plain text reply
      'Retry-After': String(Math.ceil(LOGIN_RATE_LIMIT_WINDOW_MS / 1000)),          // tell the browser when to try again
    });
    res.end('Too many login attempts. Please wait a minute and try again.');       // friendly message
    return;                                                                         // no new OAuth state is stored
  }

  let parsedUrl;
  try {
    parsedUrl = parseRequestUrl(req);
  } catch {
    parsedUrl = new URL('http://localhost/auth/discord/login');
  }

  const nextPath = normalizeNextPath(parsedUrl.searchParams.get('next') || '/');
  const accessLevel = parsedUrl.searchParams.get('mode') === 'member' ? 'member' : 'panel';
  const popup = parsedUrl.searchParams.get('popup') === '1';
  const callbackUri = resolveRedirectUri(req, redirectUri);   // this host's callback when it's an allowed one
  const state = generateOAuthState({ accessLevel, nextPath, popup, redirectUri: callbackUri });
  // Bind this login to this browser: only the browser holding this cookie may finish it at the callback,
  // so nobody can send a victim a callback link that logs them in as somebody else (login CSRF).
  const stateCookie = buildSetCookieHeader(oauthStateCookieName(state), state, {
    maxAgeSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),   // gone after 5 minutes, like the state itself
    secure: parsedUrl.protocol === 'https:',                // Secure whenever the page is served over https
    httpOnly: true,                                         // page scripts can't read it
    sameSite: 'Lax',                                        // still sent when Discord redirects back (top-level GET)
    path: '/',                                              // visible to the callback whatever base path it uses
  });
  res.writeHead(302, {
    Location: buildDiscordAuthorizeUrl(state, { ...cfg, redirectUri: callbackUri }),
    'Set-Cookie': stateCookie,                              // hand the browser its half of the state check
  });
  res.end();
}

// A Set-Cookie value that deletes the state cookie once the login has been checked.
function buildClearStateCookieHeader(state) {
  return buildSetCookieHeader(oauthStateCookieName(state), '', { maxAgeSeconds: 0, httpOnly: true, sameSite: 'Lax', path: '/' });   // Max-Age=0 removes it
}

async function handleCallbackRoute(req, res, parsedUrl, opts = {}) {
  const cfg = getPanelAuthConfig(opts.authConfig);
  const loginPath = opts.loginPath || `${opts.basePath || ''}/auth/discord/login`;
  const buildError = (status, msg) => {
    const safeMsg = String(msg || '')
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;');
    const safeLoginPath = String(loginPath || '')
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;');
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Error</title>
      <style>body{background:#0a0a0f;color:#c9c9d1;font-family:monospace;padding:40px;}</style>
      </head><body><h1 style="color:#ff4444;">Access Denied</h1><p>${safeMsg}</p>
      <br><a href="${safeLoginPath}" style="color:#ff69b4;">Try again</a></body></html>`);
  };

  const code = parsedUrl.searchParams.get('code');
  const state = parsedUrl.searchParams.get('state');
  if (!code || !state) return buildError(400, 'Missing code or state parameter.');

  const browserState = parseCookies(req)[oauthStateCookieName(state)];             // the state this browser was given at login start
  if (!safeEqualStrings(browserState, state)) {                                     // missing or different: this browser didn't start this login
    return buildError(400, 'This login was not started in this browser (or it took longer than 5 minutes). Please try logging in again.');
  }

  const stateEntry = consumeOAuthState(state);
  if (!stateEntry) return buildError(400, 'Invalid or expired OAuth state. Please try logging in again.');

  let tokens;
  try {
    tokens = await exchangeCode(code, { ...cfg, redirectUri: stateEntry.redirectUri || cfg.redirectUri });   // must match the authorize step
  } catch (err) {
    logger.error('[auth] Token exchange error:', err.message);
    return buildError(500, 'Failed to exchange authorization code with Discord.');
  }

  let discordUser;
  try {
    discordUser = await fetchDiscordUser(tokens.access_token);
  } catch (err) {
    logger.error('[auth] User fetch error:', err.message);
    return buildError(500, 'Failed to retrieve your Discord identity.');
  }

  let member;
  try {
    member = await fetchGuildMember(tokens.access_token, cfg);
  } catch (err) {
    logger.error('[auth] Guild member fetch error:', err.message);
    return buildError(500, 'Failed to verify your server membership.');
  }

  const memberAccess = checkMemberAccess(member);
  if (!memberAccess.allowed) {
    logger.info(`[auth] Access denied for Discord user ${discordUser.id} (${discordUser.username}) - reason: ${memberAccess.reason}`);
    return buildError(403, 'You are not a member of the required Discord server.');
  }

  const panelAccess = checkPanelAccess(member);
  if (stateEntry.accessLevel === 'panel' && !panelAccess.allowed) {
    logger.info(`[auth] Access denied for Discord user ${discordUser.id} (${discordUser.username}) - reason: ${panelAccess.reason}`);
    return buildError(403, 'You do not have the required role to access this panel.');
  }

  const signedToken = createSession(discordUser.id, discordUser.username, discordUser.avatar, member.roles, {
    isPanelAdmin: panelAccess.allowed,
  });
  logger.info(`[auth] Login successful: ${discordUser.id} (${discordUser.username})`);

  if (stateEntry.popup) {
    const popupMessageType = opts.popupMessageType || 'auth-complete';
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': [buildSessionCookieHeader(signedToken, opts.cookieOptions), buildClearStateCookieHeader(state)],   // log in + drop the used state cookie
    });
    // The page that opened this popup is on this same origin (its login link is relative), so the message goes
    // to window.location.origin, whichever host that is (sadgirlsclub.wtf, or the arcade). Opened as a full page
    // instead (popups blocked, a TV's kiosk browser), there is no opener: carry on to where the login began.
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Complete</title></head><body>
<script>
  let told = false;
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: ${scriptJson(popupMessageType)} }, window.location.origin);
      told = true;
    }
  } catch {}
  if (told) window.close();
  else window.location.replace(${scriptJson(stateEntry.nextPath || '/')});
</script>
Login complete. You can close this window.
</body></html>`);
    return;
  }

  res.writeHead(302, {
    'Set-Cookie': [buildSessionCookieHeader(signedToken, opts.cookieOptions), buildClearStateCookieHeader(state)],   // log in + drop the used state cookie
    Location: normalizeNextPath(stateEntry.nextPath),   // checked again right before redirecting, belt and braces
  });
  res.end();
}

function handleLogoutRoute(req, res, opts = {}) {
  const loginPath = opts.loginPath || `${opts.basePath || ''}/auth/discord/login`;
  destroySession(req);
  res.writeHead(302, {
    'Set-Cookie': buildClearCookieHeader(opts.cookieOptions),
    Location: loginPath,
  });
  res.end();
}

function renderLoginPage(message, opts = {}) {
  const loginPath = `${opts.basePath || ''}/auth/discord/login`;
  const safeMessage = String(message || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
  const safeLoginPath = String(loginPath)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SGC Panel - Login</title>
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
  ${message ? `<div class="error-msg">${safeMessage}</div>` : ''}
  <a href="${safeLoginPath}" class="discord-btn">Sign in with Discord</a>
  <div class="notice">Access is limited to server modmins.<br>
    Questions? <a href="https://discord.gg/">Join the server</a>.</div>
</div>
</body>
</html>`;
}

function requireAuth(req) {
  const session = getSession(req);
  return session?.isPanelAdmin ? session : null;
}

function requireUserAuth(req) {
  return getSession(req);
}

function getRealHost(req) {
  return req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host || '';
}

// Turn "https://arcade.example" or "arcade.example" entries into bare hosts ("arcade.example").
function normalizeTrustedHosts(list) {
  return (Array.isArray(list) ? list : [])          // anything that isn't a list counts as "no extra hosts"
    .map((s) => String(s || '').trim())             // tidy each entry
    .filter(Boolean)                                // skip blanks
    .map((entry) => {
      try { return new URL(entry).host; } catch { return entry; }   // full origin -> host; a bare host stays as is
    });
}

/**
 * Hosts listed in one app's trusted-origins env var (comma-separated). Each app has its own list:
 * WEB_PANEL_TRUSTED_ORIGINS (admin panel), WEB_APP_TRUSTED_ORIGINS (Lumi Web), GAME_WEB_TRUSTED_ORIGINS (Lumi Games),
 * so trusting the arcade for games no longer trusts it for admin POSTs.
 */
function getTrustedHosts(envVarName = 'WEB_PANEL_TRUSTED_ORIGINS') {
  const raw = process.env[envVarName] || '';        // the chosen app's list, or nothing
  return normalizeTrustedHosts(raw.split(','));      // one host per comma-separated entry
}

/**
 * CSP "frame-ancestors" for a member app: the app itself ('self') plus the sites listed (space- or comma-separated)
 * in envVarName, e.g. GAME_WEB_FRAME_ANCESTORS="https://sadgirlsclub.wtf".
 * Only those sites may show the app inside an iframe, which stops other sites from tricking clicks (clickjacking).
 */
function buildFrameAncestorsDirective(envVarName) {
  const extra = String(process.env[envVarName] || '')                     // the env list, or nothing
    .split(/[\s,]+/u)                                                      // one source per space/comma-separated entry
    .map((s) => s.trim())                                                  // tidy each entry
    .filter((src) => /^(https?:\/\/)?[a-z0-9*.-]+(:\d{1,5})?$/iu.test(src));   // only plain origins/hosts: no quotes or ";" that could bend the header
  return `frame-ancestors ${["'self'", ...new Set(extra)].join(' ')}`;    // always allow the app itself first
}

function validateSameOrigin(req, trustedHosts = []) {   // trustedHosts: extra hosts this app accepts besides its own
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }
  const host = getRealHost(req);
  const trusted = normalizeTrustedHosts(trustedHosts);   // only the calling app's own list is trusted
  const allowed = new Set([host, ...trusted].filter(Boolean));
  if (allowed.size === 0) return { ok: false, reason: 'missing host header' };

  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let parsed;
    try { parsed = new URL(origin); } catch { return { ok: false, reason: `malformed origin: ${origin}` }; }
    if (!allowed.has(parsed.host)) {
      return { ok: false, reason: `origin host ${parsed.host} not in allowed [${[...allowed].join(',')}]` };
    }
    return { ok: true };
  }

  const referer = req.headers.referer || req.headers.referrer;
  if (referer) {
    let parsed;
    try { parsed = new URL(referer); } catch { return { ok: false, reason: 'malformed referer' }; }
    if (!allowed.has(parsed.host)) {
      return { ok: false, reason: `referer host ${parsed.host} not in allowed [${[...allowed].join(',')}]` };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'missing Origin and Referer headers' };
}

function validateWebSocketOrigin(req, trustedHosts = []) {   // trustedHosts: extra hosts this app accepts besides its own
  const host = getRealHost(req);
  const trusted = normalizeTrustedHosts(trustedHosts);       // only the calling app's own list is trusted
  const allowed = new Set([host, ...trusted].filter(Boolean));
  if (allowed.size === 0) return { ok: false, reason: 'missing host header' };

  const origin = req.headers.origin;
  if (!origin || origin === 'null') {
    return { ok: false, reason: 'missing Origin header' };
  }

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, reason: `malformed origin: ${origin}` };
  }
  if (!allowed.has(parsed.host)) {
    return { ok: false, reason: `origin host ${parsed.host} not in allowed [${[...allowed].join(', ')}]` };
  }
  return { ok: true };
}

function buildUserBadgeHtml(session) {
  if (!session) return '';
  const avatarUrl = session.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(session.discordId)}/${encodeURIComponent(session.avatar)}.png?size=32`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const safeUsername = String(session.username || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
  return `<div style="display:flex;align-items:center;gap:10px;margin-left:auto;">
    <img src="${avatarUrl}" alt="" style="width:26px;height:26px;border-radius:50%;border:1px solid #ff69b4;vertical-align:middle;">
    <span style="font-family:'VT323',monospace;font-size:18px;color:#ff69b4;">${safeUsername}</span>
    <form method="POST" action="${panelPath('/auth/logout')}" style="display:inline;margin:0;">
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
  requireUserAuth,
  buildUserBadgeHtml,
  validateSameOrigin,
  validateWebSocketOrigin,
  getTrustedHosts,      // read one app's trusted-origins env var
  buildFrameAncestorsDirective,   // CSP frame-ancestors from 'self' plus one app's env list
  getClientIp,          // visitor IP, believing proxy headers only from trusted proxies
  normalizeNextPath,    // safe same-site redirect target (exported for tests)
  scriptJson,           // JSON that is safe to print inside a <script> block
  getSession,
  destroySession,
};
