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

/** @type {Map<string, {discordId: string, username: string, avatar: string, roles: string[], isPanelAdmin: boolean, expiresAt: number}>} */
const sessions = new Map();
/** @type {Map<string, {expiresAt: number, accessLevel: 'panel'|'member', nextPath: string}>} */
const oauthStates = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (sess.expiresAt <= now) sessions.delete(token);
  }
  for (const [state, entry] of oauthStates) {
    if (entry.expiresAt <= now) oauthStates.delete(state);
  }
}, CLEANUP_INTERVAL_MS).unref();

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

function getBasePath() {
  return (process.env.WEB_PANEL_BASE_PATH || '').replace(/\/+$/u, '');
}

function panelPath(path) {
  return `${getBasePath()}${path}`;
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

function buildSessionCookieHeader(signedToken) {
  const { sessionTtlMs, secureCookies } = getPanelAuthConfig();
  return buildSetCookieHeader(SESSION_COOKIE_NAME, signedToken, {
    maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
    secure: secureCookies,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

function buildClearCookieHeader() {
  const { secureCookies } = getPanelAuthConfig();
  return buildSetCookieHeader(SESSION_COOKIE_NAME, '', {
    maxAgeSeconds: 0,
    secure: secureCookies,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

function normalizeNextPath(nextPath) {
  const raw = String(nextPath || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function generateOAuthState({ accessLevel = 'panel', nextPath = '/' } = {}) {
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, {
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    accessLevel: accessLevel === 'member' ? 'member' : 'panel',
    nextPath: normalizeNextPath(nextPath),
  });
  return state;
}

function consumeOAuthState(state) {
  if (!state) return null;
  const entry = oauthStates.get(state);
  if (!entry) return null;
  oauthStates.delete(state);
  return entry.expiresAt > Date.now() ? entry : null;
}

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

async function fetchGuildMember(accessToken) {
  const { panelGuildId } = getPanelAuthConfig();
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

function handleLoginRoute(req, res) {
  const { clientId, redirectUri } = getPanelAuthConfig();
  if (!clientId || !redirectUri) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Discord OAuth is not configured on this panel.');
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = parseRequestUrl(req);
  } catch {
    parsedUrl = new URL('http://localhost/auth/discord/login');
  }

  const nextPath = normalizeNextPath(parsedUrl.searchParams.get('next') || '/');
  const accessLevel = parsedUrl.searchParams.get('mode') === 'member' ? 'member' : 'panel';
  const state = generateOAuthState({ accessLevel, nextPath });
  res.writeHead(302, { Location: buildDiscordAuthorizeUrl(state) });
  res.end();
}

async function handleCallbackRoute(req, res, parsedUrl) {
  const buildError = (status, msg) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Error</title>
      <style>body{background:#0a0a0f;color:#c9c9d1;font-family:monospace;padding:40px;}</style>
      </head><body><h1 style="color:#ff4444;">Access Denied</h1><p>${msg}</p>
      <br><a href="${panelPath('/auth/discord/login')}" style="color:#ff69b4;">Try again</a></body></html>`);
  };

  const code = parsedUrl.searchParams.get('code');
  const state = parsedUrl.searchParams.get('state');
  if (!code || !state) return buildError(400, 'Missing code or state parameter.');

  const stateEntry = consumeOAuthState(state);
  if (!stateEntry) return buildError(400, 'Invalid or expired OAuth state. Please try logging in again.');

  let tokens;
  try {
    tokens = await exchangeCode(code);
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
    member = await fetchGuildMember(tokens.access_token);
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

  res.writeHead(302, {
    'Set-Cookie': buildSessionCookieHeader(signedToken),
    Location: stateEntry.nextPath || '/',
  });
  res.end();
}

function handleLogoutRoute(req, res) {
  destroySession(req);
  res.writeHead(302, {
    'Set-Cookie': buildClearCookieHeader(),
    Location: panelPath('/auth/discord/login'),
  });
  res.end();
}

function renderLoginPage(message) {
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
  ${message ? `<div class="error-msg">${message}</div>` : ''}
  <a href="${panelPath('/auth/discord/login')}" class="discord-btn">Sign in with Discord</a>
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

function getTrustedHosts() {
  const raw = process.env.WEB_PANEL_TRUSTED_ORIGINS || '';
  return raw.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      try { return new URL(entry).host; } catch { return entry; }
    });
}

function validateSameOrigin(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }
  const host = getRealHost(req);
  const trusted = getTrustedHosts();
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

function buildUserBadgeHtml(session) {
  if (!session) return '';
  const avatarUrl = session.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(session.discordId)}/${encodeURIComponent(session.avatar)}.png?size=32`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  return `<div style="display:flex;align-items:center;gap:10px;margin-left:auto;">
    <img src="${avatarUrl}" alt="" style="width:26px;height:26px;border-radius:50%;border:1px solid #ff69b4;vertical-align:middle;">
    <span style="font-family:'VT323',monospace;font-size:18px;color:#ff69b4;">${session.username}</span>
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
  getSession,
  destroySession,
};
