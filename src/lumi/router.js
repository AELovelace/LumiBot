'use strict';

/**
 * Lumi games: a small route table (so we never grow another if-chain like gameWebServer's).
 *
 *   router.route('GET',  '/api/lumi-pet/state', handler)                       // auth on by default
 *   router.route('POST', '/api/lumi-pet/act', handler, { money: true })        // one money action per player at a time
 *   router.route('GET',  '/api/lumi-pet/houses/:host', handler)                // ctx.params.host
 *
 * Patterns are paths UNDER the base path (/lumipet). handler(ctx) may be async. ctx:
 *   { req, res, url, method, path, params, query, body, user, ip,
 *     json(status, body), html(status, html), redirect(location, status), streaming }
 * Return value -> JSON 200 (undefined -> {ok:true}); or answer yourself with ctx.json/html/redirect or events.sse().
 * Throw a LumiError for a "no" (status + JSON {error, detail, code, ...extra}); anything else is a logged 500.
 * Options: auth (default true), money (default false), body (parse JSON on POST, default true),
 *          maxBody (bytes the JSON body may have, default 16 KB; e.g. a finished run's long log),
 *          raw (handler writes res itself, e.g. OAuth; default false).
 */

const { logger } = require('../logger');
const { validateSameOrigin, getTrustedHosts, getClientIp, buildFrameAncestorsDirective } = require('../webPanelAuth');
const { CoinMoveError } = require('../sadgirlEconomyStore');
const { LumiError, isLumiError } = require('./errors');
const locks = require('./locks');                                                          // the per-player money lock (shared with Discord)

const BODY_LIMIT = 16 * 1024;                                         // biggest JSON body a page may send (16 KB)
const RATE_PER_SEC = Number(process.env.LUMI_API_RATE_PER_SEC) || 20; // token refill per second per IP on /api/*
const RATE_BURST = Number(process.env.LUMI_API_RATE_BURST) || 120;    // bucket size per IP
const BUCKETS_MAX = 20_000;                                           // most IPs tracked at once

/** Headers on every Lumi response. Pages carry no inline script, so script-src can be 'self'. */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',                                                    // no MIME sniffing
  'referrer-policy': 'strict-origin-when-cross-origin',                                    // don't leak paths cross-site
  'permissions-policy': 'interest-cohort=(), browsing-topics=()',                          // no ad tracking APIs
  'content-security-policy': [
    "default-src 'self'",                                                                  // everything from us...
    "script-src 'self'",                                                                   // ...scripts only from /lumipet/static
    "style-src 'self' 'unsafe-inline'",                                                    // the games set inline styles
    "img-src 'self' data: blob: https://cdn.discordapp.com",                               // art + Discord avatars
    "media-src 'self' data: blob:",                                                        // sounds
    "font-src 'self' data:",                                                               // no external fonts
    "connect-src 'self'",                                                                  // fetch + EventSource to us only
    "object-src 'none'",                                                                   // no plugins
    "base-uri 'self'",                                                                     // no <base> tricks
    "form-action 'self'",                                                                  // forms post to us only
    buildFrameAncestorsDirective('LUMI_FRAME_ANCESTORS'),                                  // who may iframe Lumi
  ].join('; '),
};

// ---------------------------------------------------------------------------------------------- responses

function applyHeaders(res, extra = {}) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);             // safety headers
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);                         // caller's headers
}

/** Send JSON (no-store). */
function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return;                                        // already answered
  applyHeaders(res, { 'cache-control': 'no-store' });                                      // never cache player data
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });            // JSON
  res.end(JSON.stringify(body === undefined ? { ok: true } : body));                        // the body
}

/** Send an HTML page (no-store). */
function sendHtml(res, status, html) {
  if (res.headersSent || res.writableEnded) return;                                        // already answered
  applyHeaders(res, { 'cache-control': 'no-store' });                                      // pages carry the player's balance
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });                   // HTML
  res.end(html);                                                                           // the page
}

/** Send a redirect. */
function sendRedirect(res, location, status = 302) {
  if (res.headersSent || res.writableEnded) return;                                        // already answered
  applyHeaders(res, { 'cache-control': 'no-store' });                                      // don't cache redirects
  res.writeHead(status, { location });                                                     // where to go
  res.end();                                                                               // no body
}

/** Send an error as JSON: { error, detail, code, ...extra }. */
function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { ...extra, error: message, detail: message, code });              // detail = erinne's common.js field
}

// ---------------------------------------------------------------------------------------------- request helpers

// Read the whole body up to `limit` bytes. Too big -> 413 at once, but the socket is NOT destroyed: the rest of the
// upload is read and thrown away, so the client actually receives the 413 instead of a connection reset.
function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let total = 0;                                                                         // bytes so far
    const chunks = [];                                                                     // the pieces
    let done = false;                                                                      // answered already?
    req.on('data', (chunk) => {
      if (done) return;                                                                    // refused: drain and ignore the rest
      total += chunk.length;                                                               // count
      if (total > limit) {                                                                 // too big
        done = true;                                                                       // stop keeping pieces
        chunks.length = 0;                                                                 // drop what we kept
        reject(new LumiError(413, 'too_large', 'That request is too big.'));               // 413 (the rest drains, so the answer arrives)
        return;
      }
      chunks.push(chunk);                                                                  // keep it
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } }); // all of it
    req.on('error', (error) => { if (!done) { done = true; reject(error); } });            // socket error
  });
}

/** Parse a JSON object body up to `limit` bytes (empty body -> {}); 400 'bad_json' for anything else, 413 when too big. */
async function readJsonBody(req, limit = BODY_LIMIT) {
  const raw = await readBody(req, limit);                                                  // text
  if (!raw.trim()) return {};                                                              // empty POST
  let parsed;                                                                              // the value
  try { parsed = JSON.parse(raw); } catch { throw new LumiError(400, 'bad_json', 'That request was not valid JSON.'); } // broken JSON
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new LumiError(400, 'bad_json', 'The request body must be a JSON object.'); // objects only
  return parsed;                                                                           // the object
}

// URLSearchParams -> plain object (first value of each key).
function queryObject(url) {
  const out = {};                                                                          // result
  for (const [k, v] of url.searchParams) if (!(k in out)) out[k] = v;                      // first wins
  return out;                                                                              // { key: 'value' }
}

// ---------------------------------------------------------------------------------------------- rate limit

const buckets = new Map();                                                                 // ip -> { tokens, at }

/** Take one token for this IP; false when its bucket is empty. */
function takeToken(ip, now = Date.now()) {
  let b = buckets.get(ip);                                                                 // this IP's bucket
  if (!b) {
    if (buckets.size >= BUCKETS_MAX) buckets.delete(buckets.keys().next().value);          // forget the oldest IP
    b = { tokens: RATE_BURST, at: now };                                                   // a full bucket
    buckets.set(ip, b);                                                                    // track it
  }
  b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);        // refill since last time
  b.at = now;                                                                              // remember when
  if (b.tokens < 1) return false;                                                          // empty: slow down
  b.tokens -= 1;                                                                           // spend one
  return true;                                                                             // allowed
}

const sweeper = setInterval(() => {                                                        // drop idle full buckets now and then
  const now = Date.now();                                                                  // one clock reading
  for (const [ip, b] of buckets) if (now - b.at > 10 * 60_000) buckets.delete(ip);         // idle 10 min: forget
}, 5 * 60_000);
if (typeof sweeper.unref === 'function') sweeper.unref();                                  // never keeps the process alive

// ---------------------------------------------------------------------------------------------- the router

// '/api/x/:id/*' -> matcher function returning params or null.
function compile(pattern) {
  const parts = String(pattern).split('/').filter(Boolean);                               // segments
  return (path) => {
    const segs = path.split('/').filter(Boolean);                                          // the request's segments
    const params = {};                                                                     // collected params
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];                                                                  // pattern segment
      if (p === '*') { params.rest = segs.slice(i).join('/'); return params; }             // wildcard tail
      if (i >= segs.length) return null;                                                   // request too short
      if (p.startsWith(':')) {
        try { params[p.slice(1)] = decodeURIComponent(segs[i]); } catch { return null; }   // a broken %-escape never matches
      } else if (p !== segs[i]) {
        return null;                                                                       // literal mismatch
      }
    }
    return segs.length === parts.length ? params : null;                                   // exact length
  };
}

/**
 * Make a router. opts.base: the base path ('/lumipet'); opts.auth: { requireUser(ctx) } (auth.js);
 * opts.trustedOriginsEnv: env var listing extra hosts allowed to POST (LUMI_TRUSTED_ORIGINS).
 */
function createRouter({ base, auth, trustedOriginsEnv = 'LUMI_TRUSTED_ORIGINS' }) {
  const routes = [];                                                                       // [{ method, pattern, match, handler, opts }]

  /** Add a route. method: GET/POST/PUT/DELETE. Returns the router (chainable). */
  function route(method, pattern, handler, opts = {}) {
    const m = String(method).toUpperCase();                                                // normalise
    if (typeof handler !== 'function') throw new Error(`router.route: handler for ${m} ${pattern} is not a function`); // programming bug
    if (routes.some((r) => r.method === m && r.pattern === pattern)) throw new Error(`router.route: ${m} ${pattern} is registered twice`); // two modules claimed it
    const options = { auth: true, money: false, body: true, raw: false, maxBody: BODY_LIMIT, ...opts }; // defaults, then the route's own
    if (!Number.isSafeInteger(options.maxBody) || options.maxBody < 1) throw new Error(`router.route: maxBody for ${m} ${pattern} must be a positive whole number of bytes`); // programming bug
    routes.push({ method: m, pattern, match: compile(pattern), handler, opts: options }); // store
    return api;                                                                            // chainable
  }

  /** Find the route for a method + path: { route, params } | { allowed: [...] } | null. */
  function find(method, path) {
    const want = method === 'HEAD' ? 'GET' : method;                                       // HEAD is answered like GET
    const allowed = new Set();                                                             // methods that would match
    for (const r of routes) {
      const params = r.match(path);                                                        // does the path fit?
      if (!params) continue;                                                               // no
      if (r.method === want) return { route: r, params };                                  // first registered wins
      allowed.add(r.method);                                                               // path fits, method doesn't
    }
    return allowed.size ? { allowed: [...allowed] } : null;                                // 405 or no match
  }

  /** Handle one request. Returns true when a route answered (or an error was sent), false when nothing matched. */
  async function handle(req, res, url) {
    const method = String(req.method || 'GET').toUpperCase();                              // GET, POST...
    const path = url.pathname === base ? '/' : url.pathname.slice(base.length) || '/';     // path under the base
    const isApi = path.startsWith('/api/');                                                // JSON API or a page?
    const found = find(method, path);                                                      // the route
    if (!found) return false;                                                              // not ours: caller sends 404
    if (found.allowed) { sendError(res, 405, 'method_not_allowed', 'That method is not allowed here.'); return true; } // wrong method

    const { route: r, params } = found;                                                    // the match
    const ip = getClientIp(req);                                                           // who is calling
    const ctx = {
      req, res, url, method, path, params, ip,                                             // request facts
      query: queryObject(url),                                                             // ?a=1 -> { a: '1' }
      body: {},                                                                            // filled for POST
      user: null,                                                                          // filled when auth
      streaming: false,                                                                    // events.sse sets this
      json: (status, body) => sendJson(res, status, body),                                 // answer JSON
      html: (status, html) => sendHtml(res, status, html),                                 // answer HTML
      redirect: (location, status) => sendRedirect(res, location, status),                 // answer a redirect
    };
    let lockedUid = null;                                                                  // set while holding the money lock
    try {
      const sessionId = isApi && typeof auth.sessionUserId === 'function' ? auth.sessionUserId(req) : null; // logged in? (light read)
      if (isApi && !takeToken(sessionId ? `user:${sessionId}` : ip)) throw new LumiError(429, 'slow_down', 'Slow down a little, please.'); // token bucket per player (per IP when logged out): Discord Activity players share the proxy's IPs
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = validateSameOrigin(req, getTrustedHosts(trustedOriginsEnv));        // CSRF guard on every write
        if (!origin.ok) throw new LumiError(403, 'cross_site', `Cross-site request blocked: ${origin.reason}`); // refuse
      }
      if (r.opts.auth) ctx.user = auth.requireUser(ctx);                                   // throws 401 when logged out
      if (!r.opts.raw && r.opts.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) ctx.body = await readJsonBody(req, r.opts.maxBody); // JSON body (per-route size cap)
      if (r.opts.money) {
        if (!ctx.user) throw new Error(`route ${r.pattern} has money:true but auth:false`); // a money route always knows who pays
        if (!locks.take(ctx.user.id)) throw locks.busyError();                             // in-flight lock (locks.js, shared with Discord)
        lockedUid = ctx.user.id;                                                           // remember to free it
      }
      const result = await r.handler(ctx);                                                 // the game's code
      if (ctx.streaming || r.opts.raw || res.headersSent || res.writableEnded) return true; // it answered itself
      sendJson(res, 200, result === undefined ? { ok: true } : result);                    // the usual JSON answer
      return true;                                                                         // handled
    } catch (error) {
      if (res.headersSent || res.writableEnded) {                                          // too late to answer
        if (!isLumiError(error)) logger.error(`Lumi ${method} ${url.pathname} failed after answering: ${error.stack || error.message}`); // log bugs
        return true;                                                                       // nothing more to do
      }
      if (isLumiError(error)) {
        if (error.status === 401 && !isApi && method === 'GET') {                          // a page while logged out
          sendRedirect(res, `${base}/login?next=${encodeURIComponent(url.pathname + url.search)}`); // to the login page
          return true;
        }
        sendJson(res, error.status, error.toJSON());                                        // the player's "no"
        return true;
      }
      if (error instanceof CoinMoveError && error.code === 'insufficient_funds') {         // a raw store refusal that slipped through
        sendError(res, 402, 'not_enough_sgc', `You need ${error.need} SGC for that, but you have ${error.have}.`, { need: error.need, have: error.have });
        return true;
      }
      if (error && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED')) {     // SGCServer was writing the same file
        sendError(res, 503, 'try_again', 'Lumi-Town is busy for a moment. Please try again.'); // retryable
        return true;
      }
      logger.error(`Lumi ${method} ${url.pathname} failed: ${error && (error.stack || error.message)}`); // a real bug
      sendError(res, 500, 'internal_error', 'Something went wrong. Please try again.');     // plain 500
      return true;
    } finally {
      if (lockedUid) locks.release(lockedUid);                                             // always free the money lock
    }
  }

  /** Every registered route (for docs and tests). */
  function list() {
    return routes.map((r) => ({ method: r.method, pattern: r.pattern, ...r.opts }));      // plain objects
  }

  const api = {
    route,                                                                                 // route(method, pattern, handler, opts)
    get: (pattern, handler, opts) => route('GET', pattern, handler, opts),                 // shorthand
    post: (pattern, handler, opts) => route('POST', pattern, handler, opts),               // shorthand
    handle,                                                                                // handle(req, res, url) -> bool
    list,                                                                                  // registered routes
    base,                                                                                  // '/lumipet'
  };
  return api;                                                                              // the router
}

module.exports = {
  createRouter,       // make a router
  sendJson,           // JSON answer with Lumi's headers
  sendHtml,           // HTML answer with Lumi's headers
  sendRedirect,       // redirect with Lumi's headers
  sendError,          // JSON error answer
  readJsonBody,       // JSON body reader (16 KB unless a limit is given)
  BODY_LIMIT,         // the default body cap (16 KB)
  SECURITY_HEADERS,   // the header set (static.js uses it too)
  takeToken,          // the per-IP limiter (exported for tests)
};
