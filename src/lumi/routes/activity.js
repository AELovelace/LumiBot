'use strict';

/**
 * Lumi Pet as a Discord Activity (docs/plans/lumi-town-discord.md §7, phase D6). Off unless LUMI_ACTIVITY_ENABLED=true.
 *
 *   GET  /lumipet/activity/               the page Discord opens inside the Activity (the "/" URL mapping points here).
 *                                         It loads Discord's Embedded App SDK (vendored: public/lumi/vendor, built by
 *                                         `npm run build:activity-sdk`) and public/lumi/activity/boot.js, which runs
 *                                         ready() -> authorize() -> POST below -> authenticate() -> her house.
 *   POST /lumipet/api/activity/session    { code } from authorize(): swapped for a token with the bot's OAuth app
 *                                         (no redirect_uri, as Discord's Activity guide does), the user read from
 *                                         /users/@me, the same club-member check as everywhere, then a lumi_sess
 *                                         cookie made for an iframe: SameSite=None; Secure; Partitioned (Discord's
 *                                         networking guide). Answers { next, access_token } (identify scope only;
 *                                         the page hands it to the SDK's authenticate()).
 *
 * Setup (Discord developer portal and .env) is in docs/LUMI_GAMES.md "Discord Activity".
 */

const { getPanelAuthConfig, createSession } = require('../../webPanelAuth');
const { LumiError, badRequest } = require('../errors');
const { form } = require('../town/forms');
const staticFiles = require('../static');
const users = require('../users');
const { ensureAccount } = require('../../sadgirlEconomyStore');
const { logger } = require('../../logger');

const DISCORD_API = 'https://discord.com/api';      // Discord's REST API
const SDK = 'vendor/discord-embedded-app-sdk.js';   // the bundled Embedded App SDK (public/lumi)
const BOOT = 'activity/boot.js';                     // our page script (public/lumi)
const COOKIE = 'lumi_sess';                          // the same session cookie as the website

let fetchFn = (...args) => fetch(...args);          // tests swap this

/** LUMI_ACTIVITY_ENABLED (default false): is the Activity switched on? */
function enabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.LUMI_ACTIVITY_ENABLED || '').trim().toLowerCase()); // off unless asked
}

/** 404 unless the Activity is on (so it doesn't exist at all when off). */
function mustBeOn() {
  if (!enabled()) throw new LumiError(404, 'not_found', 'Not found.');                // invisible when off
}

/** HTML-escape. */
function esc(text) {
  return String(text).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

/** A versioned /lumipet/static URL. */
function staticUrl(base, rel) {
  return `${base}/static/${rel}?v=${staticFiles.version(rel)}`;                       // cache-busting like pages.js
}

/** The Activity's page: a "waking Lumi up" screen while boot.js signs them in (no inline script: CSP). */
function page(base) {
  const boot = { clientId: getPanelAuthConfig().clientId, base, next: `${base}/lumi-pet` }; // what boot.js needs
  const json = JSON.stringify(boot).replace(/</gu, '\\u003c');                        // safe inside <script>
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumi Pet</title>
<style>
  html,body{margin:0;height:100%;background:#1b1530;color:#fce1f2;font:16px/1.5 system-ui,sans-serif}
  main{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;text-align:center;padding:0 16px}
  .moon{font-size:56px;animation:glow 2s ease-in-out infinite alternate}
  @keyframes glow{from{opacity:.55}to{opacity:1}}
</style>
</head><body>
<main><div class="moon">🌙</div><p id="activity-msg">Waking Lumi up…</p></main>
<script type="application/json" id="lumi-activity">${json}</script>
<script src="${esc(staticUrl(base, SDK))}"></script>
<script src="${esc(staticUrl(base, BOOT))}"></script>
</body></html>`;
}

/** Swap an Activity authorize() code for a token (Discord's Activity guide: no redirect_uri). */
async function exchange(code) {
  const { clientId, clientSecret } = getPanelAuthConfig();                            // the bot's OAuth app
  if (!clientId || !clientSecret) throw new LumiError(503, 'not_configured', 'The Activity login is not set up yet.'); // .env missing
  const response = await fetchFn(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code }).toString(),
    signal: AbortSignal.timeout(10_000),                                              // never hang a request
  });
  const data = await response.json().catch(() => ({}));                              // Discord's answer
  if (!response.ok || !data.access_token) throw new LumiError(401, 'bad_code', 'Discord did not accept that sign-in. Please close and reopen the Activity.'); // stale/used code
  return data.access_token;                                                           // identify scope
}

/** Who that token belongs to. */
async function whoIs(token) {
  const response = await fetchFn(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const data = await response.json().catch(() => ({}));                              // { id, username, avatar, ... }
  if (!response.ok || !/^\d{15,20}$/u.test(String(data.id || ''))) throw new LumiError(401, 'bad_token', 'Discord did not say who you are. Please reopen the Activity.');
  return { id: String(data.id), name: String(data.username || data.global_name || 'Someone'), avatar: String(data.avatar || '') };
}

/** The Set-Cookie for a session inside Discord's iframe: SameSite=None; Secure; Partitioned (+ HttpOnly). */
function iframeCookie(base, token) {
  const maxAge = Math.floor(getPanelAuthConfig().sessionTtlMs / 1000);                // the same lifetime as the website
  return `${COOKIE}=${encodeURIComponent(token)}; Path=${base}; Max-Age=${maxAge}; SameSite=None; Secure; HttpOnly; Partitioned`;
}

/** Add the Activity routes (index.js loads every routes/*.js). */
function register(router) {
  const base = router.base;                                                           // '/lumipet'

  router.get('/activity', (ctx) => {                                                 // the Activity's entry page (/activity and /activity/ both land here)
    mustBeOn();
    ctx.res.setHeader('cache-control', 'no-store');                                   // always fresh
    ctx.html(200, page(base));
  }, { auth: false });

  router.post('/api/activity/session', async (ctx) => {                              // sign in from inside Discord
    mustBeOn();
    const body = form(ctx.body, { code: { type: 'str', max: 200 } });                 // only the code
    if (!/^[A-Za-z0-9_-]{10,200}$/u.test(body.code)) throw badRequest('That sign-in code looks wrong.', 'bad_code'); // shape
    const discord = require('../discord');                                            // the bot side
    if (!discord.isEnabled() || !discord.getClient()) throw new LumiError(503, 'discord_off', 'Lumi can’t reach Discord right now. Please try again later.'); // member check needs the bot
    const token = await exchange(body.code);                                          // code -> token
    const user = await whoIs(token);                                                  // token -> who
    let member = false;
    try {
      member = await require('../discord/member').isClubMember(discord.getClient(), user.id); // the same club rule
    } catch (error) {
      logger.warn(`Lumi Activity: member check failed for ${user.id} (${error.message}).`);
      throw new LumiError(503, 'try_again', "I couldn't check that you're in the club just now. Please try again in a moment.");
    }
    if (!member) throw new LumiError(403, 'not_member', 'Lumi-Town is for members of the club. 💜');
    ensureAccount(user.id, user.name);                                                // their SGC account
    users.remember(user.id, user.name, user.avatar);                                  // their name for others
    const session = createSession(user.id, user.name, user.avatar, []);               // the same session as a website login
    ctx.res.setHeader('set-cookie', iframeCookie(base, session));                     // works inside Discord's iframe
    logger.info(`Lumi Activity: player ${user.id} signed in from inside Discord.`);   // breadcrumb
    return { next: `${base}/lumi-pet`, access_token: token };                         // the page goes home
  }, { auth: false });
}

module.exports = {
  register, enabled, page, iframeCookie,
  _setFetch: (fn) => { fetchFn = typeof fn === 'function' ? fn : (...args) => fetch(...args); }, // tests
};
