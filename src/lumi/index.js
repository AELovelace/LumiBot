'use strict';

/**
 * Lumi games (Lumi-Town) entry point. Wiring:
 *   src/index.js          initLumiGames() after the economy + private stock stores, stopLumiGames() on shutdown
 *   src/gameWebServer.js  handleLumiRequest(req, res, url) at the top of handleRequest, for /lumipet and /lumipet/*
 * Pages come from src/lumi/views/*.js (each exports register(pages)); API routes from src/lumi/routes/*.js
 * (each exports register(router)). Game agents only ADD files there. Contract: src/lumi/CONTRACT.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('../logger');
const { ensureLumiAccounts } = require('../sadgirlEconomyStore');
const { getDb } = require('./db');
const { createLumiSchema } = require('./schema');
const tuning = require('./tuning');
const treasury = require('./treasury');
const events = require('./events');
const auth = require('./auth');
const pages = require('./pages');
const sgc = require('./sgc');
const save = require('./pet/save');
const { createRouter, sendError, sendRedirect, sendHtml } = require('./router');
const { serveStatic } = require('./static');
const { notFound } = require('./errors');
const { defineDefaults } = require('./games');

const BASE = auth.BASE;           // '/lumipet' (LUMI_WEB_BASE_PATH)
let router = null;                // built once
let initialized = false;          // true between initLumiGames and stopLumiGames

/** Is this path Lumi's? ('/lumipet' or anything under '/lumipet/') */
function isLumiPath(pathname) {
  return pathname === BASE || String(pathname || '').startsWith(`${BASE}/`);       // exact base or below it
}

// Require every .js file in a folder (name order) and hand each to `use`; a broken module is logged, not fatal.
function loadModules(folder, use) {
  const dir = path.join(__dirname, folder);                                         // src/lumi/<folder>
  let files = [];                                                                   // its .js files
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch { return; } // no folder: nothing to load
  for (const file of files) {
    try {
      const mod = require(path.join(dir, file));                                    // load it
      if (typeof mod.register !== 'function') { logger.warn(`Lumi: ${folder}/${file} has no register(); skipped.`); continue; } // not a module
      use(mod, file);                                                               // register it
    } catch (error) {
      logger.error(`Lumi: ${folder}/${file} failed to load: ${error.stack || error.message}`); // loud, but the rest still loads
    }
  }
}

// The hub at /lumipet/.
function hub(ctx) {
  sendHtml(ctx.res, 200, pages.renderHub({ user: ctx.user, coins: sgc.balance(ctx.user.id), look: save.look(ctx.user.id) })); // the page
}

// /lumipet/<slug>: a registered page (login needed), an alias (redirect), or 404.
function pageRoute(ctx) {
  const slug = ctx.params.slug;                                                     // the URL piece
  const target = pages.aliasOf(slug);                                               // a short name?
  if (target) { sendRedirect(ctx.res, `${BASE}/${target}${ctx.url.search}`); return; } // /lumipet/yarn-pop -> /lumipet/breakout
  if (!pages.getPage(slug)) throw notFound('There is no such Lumi page.', 'no_page'); // unknown: 404 (before any login redirect)
  const user = auth.requireUser(ctx);                                               // throws 401 -> the router redirects to login
  sendHtml(ctx.res, 200, pages.render(slug, { user }));                             // the game page
}

// Build the router: auth routes, every routes/*.js module, then the page routes (last, so modules win).
function buildRouter() {
  const r = createRouter({ base: BASE, auth });                                     // the table
  pages.configure({ base: BASE });                                                  // page URLs
  auth.register(r);                                                                 // /login, /auth/...
  loadModules('views', (mod) => mod.register(pages));                               // pages
  loadModules('routes', (mod) => mod.register(r));                                  // APIs
  r.get('/', hub);                                                                  // the hub (login needed)
  r.get('/:slug', pageRoute, { auth: false });                                      // game pages (checks login itself)
  return r;                                                                         // ready
}

/**
 * Start Lumi-Town: tables, accounts, the LUMI stock, tuning, routes/pages and the treasury sweep scheduler.
 * Call after initEconomyStore() and initPrivateStockStore(). opts.scheduler:false skips the sweep timer (tests).
 */
function initLumiGames({ scheduler = true } = {}) {
  const db = getDb();                                                               // the economy DB (throws if not open)
  try { db.pragma('busy_timeout = 5000'); } catch { /* in-memory DBs don't care */ } // SGCServer writes the same file: wait, don't fail
  createLumiSchema(db);                                                             // every lumi_* table
  ensureLumiAccounts();                                                             // the nine __LUMI_*__ accounts
  try {
    require('../privateStockStore').ensureLumiHoldingsStock();                      // LUMI on Doll Street
  } catch (error) {
    logger.warn(`Lumi: could not list LUMI on the exchange (${error.message}).`);   // exchange off: Lumi still runs
  }
  defineDefaults();                                                                 // every game's tuning id
  tuning.reload();                                                                  // read the settings
  if (!router) router = buildRouter();                                              // routes + pages (once per process)
  if (scheduler) treasury.start();                                                  // the 15-minute sweep
  initialized = true;                                                               // open for requests
  logger.info(`Lumi-Town ready at ${BASE}/ (${router.list().length} routes, ${pages.listPages().length} pages).`); // breadcrumb
}

/** Stop the sweep timer and close every live stream (shutdown). */
function stopLumiGames() {
  initialized = false;                                                              // refuse new requests
  treasury.stop();                                                                  // no more sweeps
  events.stopAll();                                                                 // end SSE streams
}

/**
 * Handle a request if it is Lumi's. Returns true when it answered (always, for /lumipet paths once started),
 * false when the path isn't Lumi's or Lumi isn't running (the caller carries on as before).
 */
async function handleLumiRequest(req, res, url) {
  if (!initialized || !router || !isLumiPath(url.pathname)) return false;           // not ours
  try {
    if (url.pathname === BASE) { sendRedirect(res, `${BASE}/${url.search}`, 301); return true; } // /lumipet -> /lumipet/
    const staticPrefix = `${BASE}/static/`;                                         // where files live
    if (url.pathname.startsWith(staticPrefix)) {                                    // a static file
      serveStatic(req, res, url.pathname.slice(staticPrefix.length), url);          // safe file server
      return true;
    }
    const handled = await router.handle(req, res, url);                             // API, auth or a page
    if (!handled) sendError(res, 404, 'not_found', 'Not found.');                    // nothing matched
    return true;
  } catch (error) {
    logger.error(`Lumi request ${req.method} ${url.pathname} crashed: ${error.stack || error.message}`); // a bug outside the router
    sendError(res, 500, 'internal_error', 'Something went wrong. Please try again.'); // plain 500
    return true;
  }
}

/** The router (tests and the admin page use it). */
function getRouter() {
  return router;                                                                    // null before init
}

module.exports = {
  BASE,               // '/lumipet'
  initLumiGames,      // start
  stopLumiGames,      // stop
  handleLumiRequest,  // the gameWebServer hook
  isLumiPath,         // path check
  getRouter,          // the router
};
