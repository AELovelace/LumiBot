'use strict';

/**
 * Lumi games: logging in. Lumi has its own login under the base path (default /lumipet), with its own cookie
 * `lumi_sess` (Path=/lumipet) and its own Discord redirect URI, but the SAME rule as the games app: you must be a
 * member of Doll's Discord server (webPanelAuth checks that in the OAuth callback, mode=member).
 *
 * Routes (registered on the router by index.js):
 *   GET  /lumipet/login                      small page with a "Sign in with Discord" button
 *   GET  /lumipet/auth/discord/login         starts Discord OAuth (rate-limited by webPanelAuth)
 *   GET  /lumipet/auth/discord/callback      Discord comes back here; sets lumi_sess
 *   POST /lumipet/auth/logout                ends the session (same-origin only)
 */

const {
  handleLoginRoute,      // starts OAuth
  handleCallbackRoute,   // finishes OAuth + member check + session cookie
  handleLogoutRoute,     // clears the session
  requireUserAuth,       // reads a session from a cookie
  normalizeNextPath,     // same-site redirect targets only
} = require('../webPanelAuth');
const { ensureAccount } = require('../sadgirlEconomyStore');
const users = require('./users');
const { unauthorized } = require('./errors');

const BASE = (process.env.LUMI_WEB_BASE_PATH || '/lumipet').replace(/\/+$/u, '') || '/lumipet'; // e.g. /lumipet
const COOKIE_NAME = 'lumi_sess';   // Lumi's own session cookie

// Env flags read once at start.
function envBool(name, fallback) {
  const raw = String(process.env[name] || '').trim().toLowerCase();                // '' when unset
  if (!raw) return fallback;                                                        // unset: default
  return ['1', 'true', 'yes', 'on'].includes(raw);                                  // truthy words
}

/** Cookie settings shared by login and logout (name and path must match for the browser to clear it). */
function cookieOptions() {
  return {
    cookieName: COOKIE_NAME,                                                        // lumi_sess
    cookiePath: BASE,                                                               // only sent to /lumipet/*
    sameSite: process.env.LUMI_SESSION_SAMESITE?.trim() || 'Lax',                   // top-level app: Lax is right
    secure: envBool('LUMI_SESSION_SECURE', true),                                   // https only (set false for local http tests)
  };
}

/** The Discord redirect URI for Lumi logins (LUMI_DISCORD_OAUTH_REDIRECT_URI). */
function redirectUri() {
  return process.env.LUMI_DISCORD_OAUTH_REDIRECT_URI?.trim() || '';                 // empty: login answers 503
}

/** A redirect target that stays inside Lumi ('/lumipet/...'); anything else becomes the hub. */
function lumiNext(raw) {
  const next = normalizeNextPath(raw || `${BASE}/`);                                // same-site only
  return next === BASE || next.startsWith(`${BASE}/`) ? next : `${BASE}/`;          // inside Lumi only
}

/**
 * The logged-in player, or null. Also keeps their SGC account and display name fresh.
 * @returns {{id: string, name: string, avatar: string} | null}
 */
function currentUser(req) {
  const session = requireUserAuth(req, { cookieName: COOKIE_NAME });                // lumi_sess only
  if (!session) return null;                                                        // not logged in
  const user = { id: String(session.discordId), name: String(session.username || ''), avatar: String(session.avatar || '') }; // the shape games use
  ensureAccount(user.id, user.name);                                                // same as the games app's requireMemberSession
  users.remember(user.id, user.name, user.avatar);                                  // for displayName() elsewhere
  return user;                                                                      // { id, name, avatar }
}

/** The logged-in player, or throw LumiError 401 'login_required'. ctx is the router's ctx (or anything with .req). */
function requireUser(ctx) {
  const user = currentUser(ctx.req);                                                // read the cookie
  if (!user) throw unauthorized('Please log in to play.', 'login_required');        // the router turns this into 401 / a login redirect
  return user;                                                                      // { id, name, avatar }
}

// HTML-escape for the login page.
function esc(text) {
  return String(text).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;'); // all five
}

/** The /lumipet/login page (no inline script, so it works under script-src 'self'). */
function renderLoginPage(next) {
  const href = `${BASE}/auth/discord/login?mode=member&next=${encodeURIComponent(lumiNext(next))}`; // member login, back to where they were
  return `<!doctype html>
<html lang="en" data-theme="neon">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumi · Sign in</title>
<link rel="icon" href="${BASE}/static/icons/lumi.svg">
<link rel="stylesheet" href="${BASE}/static/theme.css">
<link rel="stylesheet" href="${BASE}/static/hub.css">
</head>
<body>
<main class="hub hub-login">
  <section class="hub-card hub-hello">
    <p class="hub-eyebrow">// LUMI-TOWN</p>
    <h1 class="hub-title">LUMI<span>PET</span></h1>
    <p>Lumi and her games, for members of the SadGirlsClub Discord. Every coin is real SadGirlCoin.</p>
    <p><a class="hub-button" href="${esc(href)}">Sign in with Discord</a></p>
  </section>
</main>
</body>
</html>`;
}

/** Register the login/logout routes on the router (index.js calls this first). */
function register(router) {
  router.route('GET', '/login', (ctx) => {                                          // the login page
    ctx.html(200, renderLoginPage(ctx.query.next));                                 // send it
  }, { auth: false });
  router.route('GET', '/auth/discord/login', (ctx) => {                             // start OAuth
    handleLoginRoute(ctx.req, ctx.res, { authConfig: { redirectUri: redirectUri() } }); // webPanelAuth does the rest
  }, { auth: false, raw: true });
  router.route('GET', '/auth/discord/callback', async (ctx) => {                    // Discord came back
    await handleCallbackRoute(ctx.req, ctx.res, ctx.url, {
      basePath: BASE,                                                               // for its error page's link
      loginPath: `${BASE}/login`,                                                   // "try again" goes here
      authConfig: { redirectUri: redirectUri() },                                   // must match the login step
      popupMessageType: 'lumi-auth-complete',                                       // (only used for popup logins)
      cookieOptions: cookieOptions(),                                               // lumi_sess, Path=/lumipet
    });
  }, { auth: false, raw: true });
  router.route('POST', '/auth/logout', (ctx) => {                                   // log out (router already checked same-origin)
    handleLogoutRoute(ctx.req, ctx.res, { loginPath: `${BASE}/login`, cookieOptions: cookieOptions() }); // clears lumi_sess
  }, { auth: false, raw: true, body: false });
}

module.exports = {
  BASE,              // '/lumipet'
  COOKIE_NAME,       // 'lumi_sess'
  cookieOptions,     // cookie settings
  currentUser,       // req -> user | null
  requireUser,       // ctx -> user (or throws 401)
  lumiNext,          // safe in-app redirect target
  renderLoginPage,   // the login page HTML
  register,          // add the auth routes to the router
};
