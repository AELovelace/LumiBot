'use strict';

/**
 * Lumi's arcade API: Yarn Pop (breakout), Lumi Conga (snake) and Teacup Tower (erinne web/games.py "Breakout and
 * Snake" section). Solo runs cost an entry and pay their checked score; showdown tables seat two racers and up to five
 * watchers, who see both boards live through the table's stream (which is also how the server knows a player is still
 * there: lobby.PRESENCE).
 *
 *   POST /api/<slug>/run                    start a solo run (charges the entry)        -> { run, seed, entry, coins }
 *   POST /api/<slug>/run/finish             a run ended: check it (and pay a solo run)  -> { score, distance, paid, ... }
 *   GET  /api/<slug>/tables                 the showdown lobby                          -> { tables: [...] }
 *   POST /api/<slug>/tables                 start a table (you sit as P1)               -> the table
 *   GET  /api/<slug>/tables/:code           the table as you see it                     -> the table
 *   POST /api/<slug>/tables/:code           join | leave | ready | seat | stand | bet   -> the table | { left: true }
 *   POST /api/<slug>/tables/:code/board     a racer's live board (memory only)          -> { ok: true }
 *   GET  /api/<slug>/tables/:code/stream    SSE: "table", "boards", "end"
 * <slug> is breakout, snake or teacup-tower; each path is registered for exactly those three (anything else 404s,
 * and other games' /api/<x>/run routes are never shadowed). erinne's TV routes (rooms/:code/tv, tv/input, tv/manage)
 * and casino /rooms are not ported.
 */

const { tx } = require('../db');                          // transactions
const sgc = require('../sgc');                            // balances
const tuning = require('../tuning');                      // admin-page definitions
const { LumiError } = require('../errors');               // player-facing "no"s
const events = require('../events');                      // SSE in erinne's wire format
const arcade = require('../arcade/arcade');               // runs and their checks
const showdown = require('../arcade/showdown');           // tables, bets, Hub
const lobby = require('../arcade/lobby');                 // PRESENCE

const FINISH_BODY_LIMIT = 1024 * 1024;                    // a long Lumi Conga run sends many turns (erinne allows 50,000)
const LOOK_EVERY_MS = 2000;                               // a stream looks at its table at least this often (timers, away flags)
const BOARDS_GAP_MS = 120;                                // at most about eight board updates a second per stream
const STREAM_PING_MS = 15000;                             // erinne pinged showdown streams every 15 s

/** The admin page entries for the three games (erinne natives). Uncapped by default; scores are partly client-reported, so an admin may set a cap. */
function defineTuning() {
  const labels = { breakout: 'Yarn Pop', snake: 'Lumi Conga', 'teacup-tower': 'Teacup Tower' }; // shelf names
  for (const slug of arcade.GAMES) {
    tuning.define(slug, {
      label: labels[slug],                                                   // admin page name
      priceKeys: { entry: arcade.ENTRY, bet: null },                         // 25 a run/race; bets are 1-100 chips
      payoutKeys: { win: 1, betwin: null },                                  // 1 per point/block/floor; a winning bet's chips again
      defaults: { dailyCap: 0 },                                             // uncapped by default (Doll's call); admins can set a cap per game
    });
  }
}

// 422 for a request body that doesn't fit (erinne's pydantic models refuse these).
function invalid(message) {
  return new LumiError(422, 'invalid', message || "That request doesn't look right."); // erinne answered 422
}

// A whole number within [min, max] (pydantic strict int: no strings, no floats, no booleans).
function isInt(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;        // strict
}

// A number within 0..1 (pydantic float with ge=0, le=1).
function isUnit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; // a fraction
}

// Refuse any key not in `allowed` (pydantic extra="forbid").
function onlyKeys(body, allowed) {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw invalid(`Unexpected field "${key}".`); // extra field
}

/** erinne RunFinish: what a finished run claims. Returns a clean claim object. */
function readRunFinish(body) {
  onlyKeys(body, ['run', 'moves', 'turns', 'died', 'score', 'level']);      // nothing else (a "coins" field is refused)
  const claim = { run: body.run, moves: 0, turns: [], died: false, score: 0, level: 1 }; // defaults
  if (!isInt(body.run, 1, Number.MAX_SAFE_INTEGER)) throw invalid('Which run was that?'); // required
  if (body.moves !== undefined) { if (!isInt(body.moves, 0, 200000)) throw invalid('Bad move count.'); claim.moves = body.moves; } // Snake moves
  if (body.turns !== undefined) {
    if (!Array.isArray(body.turns) || body.turns.length > 50000) throw invalid('Bad turns.'); // a list, not too long
    for (const t of body.turns) {
      if (!Array.isArray(t) || t.length !== 2 || !isInt(t[0], -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) || !isInt(t[1], 0, 3)) throw invalid('Bad turns.'); // [move, direction 0-3]
    }
    claim.turns = body.turns.map((t) => [t[0], t[1]]);                       // clean copies
  }
  if (body.died !== undefined) { if (typeof body.died !== 'boolean') throw invalid('Bad died flag.'); claim.died = body.died; } // Snake: last move killed it
  if (body.score !== undefined) { if (!isInt(body.score, 0, 1000000)) throw invalid('Bad score.'); claim.score = body.score; } // Breakout bricks / Teacup floor
  if (body.level !== undefined) { if (!isInt(body.level, 1, 500)) throw invalid('Bad level.'); claim.level = body.level; } // Breakout level
  return claim;                                                              // checked shape
}

/** erinne ShowdownMove: only what a player chose. Returns { action, target, amount }. */
function readMove(body) {
  onlyKeys(body, ['action', 'target', 'amount']);                            // nothing else
  const actions = ['join', 'leave', 'ready', 'seat', 'stand', 'bet'];        // allowed actions
  if (!actions.includes(body.action)) throw invalid("That isn't something you can do here."); // Literal[...]
  const target = body.target === undefined ? '' : body.target;              // default ''
  if (!['', 'p1', 'p2'].includes(target)) throw invalid('Bet on P1 or P2.'); // Literal["", "p1", "p2"]
  const amount = body.amount === undefined ? 0 : body.amount;               // default 0
  if (!isInt(amount, 0, showdown.BET_LIMIT)) throw invalid('Bad bet amount.'); // strict int 0..500
  return { action: body.action, target, amount };                           // clean move
}

/** erinne Board: a racer's live board (only ever drawn, never scored). Returns a clean copy. */
function readBoard(body) {
  const keys = ['score', 'level', 'lives', 'bat', 'wide', 'balls', 'bricks', 'length', 'alive', 'points', 'food', 'kinds', 'height', 'frame']; // the fields
  onlyKeys(body, keys);                                                      // nothing else
  const b = { score: 0, level: 0, lives: 0, bat: 0.5, wide: false, balls: [], bricks: '', length: 0, alive: true, points: [], food: [], kinds: '', height: 0, frame: 0 }; // defaults
  const set = (key, ok) => { if (body[key] !== undefined) { if (!ok(body[key])) throw invalid(`Bad board ${key}.`); b[key] = body[key]; } }; // check + copy
  set('score', (v) => isInt(v, 0, 1000000));                                 // points
  set('level', (v) => isInt(v, 0, 500));                                     // Breakout level
  set('lives', (v) => isInt(v, 0, 9));                                       // Breakout lives
  set('bat', isUnit);                                                        // bat position 0..1
  set('wide', (v) => typeof v === 'boolean');                                // wide bat?
  set('balls', (v) => Array.isArray(v) && v.length <= 8 && v.every((p) => Array.isArray(p) && p.length === 2 && isUnit(p[0]) && isUnit(p[1]))); // [x, y] fractions
  set('bricks', (v) => typeof v === 'string' && v.length <= 108 && /^[0-6]*$/u.test(v)); // 18 x 6 colour codes
  set('length', (v) => isInt(v, 0, 400));                                    // Snake length
  set('alive', (v) => typeof v === 'boolean');                               // still going?
  set('points', (v) => Array.isArray(v) && v.length <= 600 && v.every(isUnit)); // body x/y pairs
  set('food', (v) => Array.isArray(v) && v.length <= 3 && v.every((n) => isInt(n, 0, 20))); // column, row, kind
  set('kinds', (v) => typeof v === 'string' && v.length <= 400 && /^[1-4]*$/u.test(v)); // conga colours
  set('height', (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9); // Teacup view height
  set('frame', (v) => isInt(v, 0, 100000000));                               // Teacup frame
  b.balls = b.balls.map((p) => [p[0], p[1]]);                                // clean copies
  b.points = b.points.slice();                                               // clean copy
  b.food = b.food.slice();                                                   // clean copy
  return b;                                                                  // safe to show others
}

// Who is at a table: 'user:<discord id>' (erinne _table_identity for a signed-in browser; TV seats are not ported).
function actorOf(ctx) {
  return `user:${ctx.user.id}`;                                              // one seat per account
}

/** The table's live stream (erinne showdown_stream): "table" on change, "boards" while racing, "end" when gone. */
function stream(ctx, slug) {
  const code = ctx.params.code;                                              // the table
  const actor = actorOf(ctx);                                                // the viewer
  const first = showdown.look(slug, code, actor);                            // 404 when closed (before any stream starts)
  if (first.you === null) throw new LumiError(403, 'forbidden', 'Join this table first.'); // watchers and racers only
  const table = showdown._key(code);                                         // PRESENCE key
  const strip = (view) => { const { server_time: _t, ...rest } = view; return JSON.stringify(rest); }; // compare without the clock
  let shown = strip(first);                                                  // what this viewer last saw
  let seen = [0, 0];                                                         // Hub counters last handled
  let lookedAt = Date.now();                                                 // last full look
  let boardsAt = 0;                                                          // last boards sent
  let timer = null;                                                          // the periodic look
  let pending = null;                                                        // a delayed boards send
  let stop = null;                                                           // Hub unlisten
  let handle = null;                                                         // the SSE stream

  const end = (reason) => { handle.send('end', { reason }); handle.close(); }; // tell the page and hang up

  function check() {
    if (!handle || handle.closed) return;                                    // gone
    const [tableV, boardsV] = showdown.HUB.version(code);                    // what changed
    if (tableV !== seen[0] || Date.now() - lookedAt >= LOOK_EVERY_MS) {
      seen[0] = tableV;                                                      // handled
      lookedAt = Date.now();                                                 // looked now
      let now;                                                               // the fresh view
      try {
        now = showdown.look(slug, code, actor);                              // may catch the table up
      } catch {
        end('This table has closed.');                                       // closed (or unreadable): the page goes back to the lobby
        return;                                                              // done
      }
      if (now.you === null) { end('Your seat was given up.'); return; }      // let go
      const view = strip(now);                                               // compare
      if (view !== shown) { shown = view; handle.send('table', now); }       // changed: send it
    }
    if (boardsV !== seen[1]) {
      const wait = BOARDS_GAP_MS - (Date.now() - boardsAt);                  // throttle boards
      if (wait > 0) {
        if (!pending) pending = setTimeout(() => { pending = null; check(); }, wait); // try again shortly
        return;                                                              // not yet
      }
      seen[1] = boardsV;                                                     // handled
      boardsAt = Date.now();                                                 // sent now
      handle.send('boards', showdown.HUB.snapshot(code));                    // every racer's latest board
    }
  }

  handle = events.sse(ctx, null, {
    heartbeatMs: STREAM_PING_MS,                                             // ": ping" every 15 s
    onOpen(s) {
      handle = s;                                                            // (sse returns it too)
      lobby.PRESENCE.opened(table, actor);                                   // there while this stream is open
      stop = showdown.HUB.listen(code, check);                               // wake on every change
      seen = showdown.HUB.version(code);                                     // start from now
      s.send('table', first);                                                // the table first
      timer = setInterval(check, LOOK_EVERY_MS);                             // timers and away flags need a look too
      if (typeof timer.unref === 'function') timer.unref();                  // never keeps the process alive
    },
    onClose() {
      if (timer) clearInterval(timer);                                       // stop looking
      if (pending) clearTimeout(pending);                                    // no delayed send
      if (stop) stop();                                                      // stop listening
      lobby.PRESENCE.closed(table, actor);                                   // the grace period starts now
    },
  });
}

/** Add the arcade routes (exact paths for each of the three games). */
function register(router) {
  defineTuning();                                                            // admin page entries (after games.js defaults)
  for (const slug of arcade.GAMES) {
    const api = `/api/${slug}`;                                              // e.g. /api/breakout

    router.post(`${api}/run`, (ctx) => tx(() => {                            // a solo run: entry + seed
      const started = arcade.start(ctx.user.id, ctx.user.name, slug);        // charges the entry (402 when short)
      return { ...started, coins: sgc.balance(ctx.user.id) };               // with the new balance
    }), { money: true });

    router.post(`${api}/run/finish`, (ctx) => {                              // a run ended
      const claim = readRunFinish(ctx.body);                                 // the claim (the router read up to FINISH_BODY_LIMIT)
      return tx(() => {
        const result = arcade.finish(ctx.user.id, ctx.user.name, slug, claim.run, claim); // checked (+ paid when solo)
        if (result.room) showdown.record(slug, result.room, claim.run, result); // a race's result goes to its table
        return result;                                                       // what the server made of it
      });
    }, { money: true, maxBody: FINISH_BODY_LIMIT });                         // a long Lumi Conga log is bigger than 16 KB

    router.get(`${api}/tables`, (ctx) => ({ tables: showdown.tables(slug, actorOf(ctx)) })); // the lobby

    router.post(`${api}/tables`, (ctx) => showdown.create(slug, actorOf(ctx), ctx.user.name, ctx.user.id), { money: true }); // a new table

    router.get(`${api}/tables/:code`, (ctx) => showdown.look(slug, ctx.params.code, actorOf(ctx))); // one table

    router.post(`${api}/tables/:code`, (ctx) => {                            // one thing at the table
      const move = readMove(ctx.body);                                       // checked shape
      return showdown.act(slug, ctx.params.code, actorOf(ctx), ctx.user.name, ctx.user.id, move.action, { target: move.target, amount: move.amount }); // do it
    }, { money: true });

    router.post(`${api}/tables/:code/board`, (ctx) => {                      // a racer's live board
      const board = readBoard(ctx.body);                                     // checked shape (422 otherwise)
      const actor = actorOf(ctx);                                            // who sent it
      const seat = showdown.racingSeat(slug, ctx.params.code, actor);        // racing here right now?
      if (!seat) throw new LumiError(409, 'not_racing', "You aren't racing at this table right now."); // erinne 409
      lobby.PRESENCE.seen(showdown._key(ctx.params.code), actor);            // still here
      showdown.HUB.push(ctx.params.code, seat, board);                       // memory only
      return { ok: true };                                                   // erinne answered 204
    });

    router.get(`${api}/tables/:code/stream`, (ctx) => { stream(ctx, slug); }); // the live table (not money)
  }
}

module.exports = { register, readRunFinish, readMove, readBoard, defineTuning }; // validators exported for tests
