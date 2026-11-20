'use strict';

/**
 * Lumi Dungeons with friends: the party API (port of erinne mnemerynne/web/games.py, the lumiparty routes).
 * Online parties only: erinne's couch/TV endpoints (parties/:code/tv/input, tv/close) are not ported.
 *
 *   GET  /api/lumi-pet/parties               open parties + my own ({ parties, mine })
 *   POST /api/lumi-pet/parties               make one ({ mode: 'online' }) -> the party as I see it
 *   GET  /api/lumi-pet/parties/:code         the party as I see it (caught up on its clocks)
 *   POST /api/lumi-pet/parties/:code         one thing I do there (erinne PartyMove)
 *   GET  /api/lumi-pet/parties/:code/stream  SSE: "party" (first state at once, then whenever it changes), "end"
 *
 * The stream listens on events channel `party:<code>`; lumiparty publishes "changed" there after every change, and
 * each open stream looks again for its own viewer (erinne's per-viewer relay) and also every 2 s for the clocks.
 */

const { tx } = require('../db');                             // transactions
const events = require('../events');                         // SSE
const { LumiError, badRequest, forbidden } = require('../errors'); // refusals
const P = require('../party/lumiparty');                     // the party itself

const lobby = () => require('../arcade/lobby');              // lobby.PRESENCE (ported by the arcade agent; lazy)

const ACTIONS = new Set(['join', 'leave', 'ready', 'env', 'start', 'vote', 'move', 'back', 'descend', 'take', 'look', 'unlock', // erinne PARTY_ACTIONS
  'potion', 'sokoban', 'lights', 'rune', 'cup', 'flip', 'pass', 'abandon', 'fight']);
const FIGHT_TARGET = 'move[0-3]|defend|run|potion|ether|x-attack|x-defend|x-speed';  // a co-op fight turn's target
const TARGET_RE = new RegExp('^(|[nesw]|back|descend|home|m[0-9]{1,20}|' + FIGHT_TARGET + ')$'); // erinne's pattern (Discord ids are up to 20 digits)
const MOVE_KEYS = new Set(['action', 'way', 'target', 'item', 'moves', 'picks', 'foe', 'ally', 'turn']); // extra="forbid"
const POLL_MS = 2000;                                        // a stream looks again this often (votes, turns, away)
const PING_MS = 15_000;                                      // erinne's party stream pinged every 15 s

/** erinne's pydantic 422: the body isn't a move the page can send. */
function invalid(what) {
  return new LumiError(422, 'invalid', `That isn't a move the party understands (${what}).`); // 422 like FastAPI
}

/** erinne PartyMove, checked by hand. Returns the clean fields for lumiparty.act. */
function readMove(body) {
  for (const key of Object.keys(body)) if (!MOVE_KEYS.has(key)) throw invalid(key);         // no extra fields
  const action = body.action;                                                                // required
  if (!ACTIONS.has(action)) throw invalid('action');                                         // one of the known actions
  const way = body.way === undefined ? null : body.way;                                      // optional
  if (way !== null && !['n', 'e', 's', 'w'].includes(way)) throw invalid('way');             // a way or nothing
  const target = body.target === undefined ? '' : body.target;                               // default ''
  if (typeof target !== 'string' || target.length > 24 || !TARGET_RE.test(target)) throw invalid('target'); // the pattern
  const item = body.item === undefined ? '' : body.item;                                     // default ''
  if (typeof item !== 'string' || item.length > 40) throw invalid('item');                   // short text
  const moves = body.moves === undefined ? '' : body.moves;                                  // default ''
  if (typeof moves !== 'string' || moves.length > 600 || !/^[udlr]*$/u.test(moves)) throw invalid('moves'); // crate moves
  const picks = body.picks === undefined ? [] : body.picks;                                  // default []
  if (!Array.isArray(picks) || picks.length > 200) throw invalid('picks');                   // a short list
  if (picks.some((p) => !(Number.isInteger(p) || (typeof p === 'string' && p.length <= 40)))) throw invalid('picks'); // ints or short strings
  const small = (v, name, max) => {                                                          // an optional strict int
    if (v === undefined || v === null) return null;                                          // not given
    if (!Number.isInteger(v) || v < 0 || (max !== null && v > max)) throw invalid(name);     // out of range
    return v;                                                                                // ok
  };
  return { action, way, target, item, moves, picks, foe: small(body.foe, 'foe', 2), ally: small(body.ally, 'ally', 2), turn: small(body.turn, 'turn', null) }; // clean
}

/** erinne _look_party: a look, inside a transaction only when the party's clocks are due. An idle party's close is kept. */
function lookParty(code, userId) {
  const now = P._ms();                                                                       // one moment for both
  if (!P.due(code, now)) return P.look(code, userId, now);                                   // nothing to catch up: read only
  const out = tx(() => {                                                                     // its clocks are due: write
    try {
      return { view: P.look(code, userId) };                                                 // caught up
    } catch (error) {
      if (error instanceof P.PartyError) return { error };                                   // e.g. broken up: keep the close
      throw error;                                                                           // a bug rolls back
    }
  });
  if (out.error) throw out.error;                                                            // now say so
  return out.view;                                                                           // the view
}

/** What changes on a page between two looks (erinne's `mark`): the revision and who is away. */
function markOf(view) {
  return JSON.stringify([view.revision, view.members.map((m) => m.away)]);                   // compare as text
}

function register(router) {
  router.get('/api/lumi-pet/parties', (ctx) => {                                             // open parties + mine
    tx(() => P.sweep());                                                                     // idle ones break up first
    return { parties: P.parties(ctx.user.id), mine: P.codeOf(ctx.user.id) };                 // the list
  });

  router.post('/api/lumi-pet/parties', (ctx) => {                                            // make a party
    const body = ctx.body || {};                                                             // { mode }
    for (const key of Object.keys(body)) if (key !== 'mode') throw invalid(key);             // extra="forbid"
    const mode = body.mode === undefined ? 'online' : body.mode;                             // default online
    if (mode === 'couch') throw badRequest("Parties around one TV aren't part of Lumi-Town. Make an online party and share its code."); // TV play is off
    if (mode !== 'online') throw invalid('mode');                                            // only these two
    const now = P._ms();                                                                     // the time
    return tx(() => P.view(P.create(ctx.user.id, ctx.user.name, now), ctx.user.id, { now })); // made, as I see it
  });

  router.get('/api/lumi-pet/parties/:code', (ctx) => lookParty(ctx.params.code, ctx.user.id)); // the party as I see it

  router.post('/api/lumi-pet/parties/:code', (ctx) => {                                      // one thing I do there
    const move = readMove(ctx.body || {});                                                   // checked
    return tx(() => P.act(ctx.params.code, ctx.user.id, move.action, null, null, {           // in one transaction (coins too)
      name: ctx.user.name, way: move.way, target: move.target, item: move.item, moves: move.moves,
      picks: move.picks, foe: move.foe, ally: move.ally, turn: move.turn,
    }));
  }, { money: true });                                                                       // going home pays SGC

  router.get('/api/lumi-pet/parties/:code/stream', (ctx) => {                                // the party, live
    const uid = ctx.user.id;                                                                 // the viewer
    const first = lookParty(ctx.params.code, uid);                                           // 404 if broken up (plain JSON)
    if (first.you === null) throw forbidden('Join this party first.');                       // members only
    const code = first.code;                                                                 // its real code
    const table = P._table(code);                                                            // presence key
    const actor = `user:${uid}`;                                                             // this page
    let shown = markOf(first);                                                               // what this page has
    let timer = null;                                                                        // the 2 s clock
    let stream = null;                                                                       // the SSE handle
    let ended = false;                                                                       // "end" sent?

    const check = () => {                                                                    // look again for this viewer: [event, data] or null
      if (ended) return null;                                                                // already over
      let now;                                                                               // the fresh view
      try {
        now = lookParty(code, uid);                                                          // as they see it now
      } catch (error) {
        if (!(error instanceof P.PartyError)) throw error;                                   // a bug
        ended = true;                                                                        // over
        return ['end', { reason: 'The party has broken up.' }];                              // erinne's words
      }
      if (now.you === null) { ended = true; return ['end', { reason: "You've left the party." }]; } // they left
      const mark = markOf(now);                                                              // what changed?
      if (mark === shown) return null;                                                       // nothing for this page
      shown = mark;                                                                          // remember
      return ['party', now];                                                                 // the new view
    };
    const closeSoon = () => setImmediate(() => { if (stream) stream.close(); });             // end the stream after "end" goes out

    stream = events.sse(ctx, `party:${code}`, {                                              // channel lumiparty wakes
      heartbeatMs: PING_MS,                                                                  // ": ping" every 15 s
      onOpen(s) {
        lobby().PRESENCE.opened(table, actor);                                               // lobby.PRESENCE.opened: counts as there
        s.send('party', first);                                                              // erinne sends the party first
        timer = setInterval(() => {                                                          // clocks need a look too
          let out = null;                                                                    // what to send
          try { out = check(); } catch { out = null; }                                       // a failed look waits for the next
          if (!out) return;                                                                  // nothing new
          s.send(out[0], out[1]);                                                            // send it
          if (out[0] === 'end') closeSoon();                                                 // and finish
        }, POLL_MS);
        if (typeof timer.unref === 'function') timer.unref();                                // never keeps the process alive
      },
      onClose() {
        if (timer) clearInterval(timer);                                                     // stop looking
        try { lobby().PRESENCE.closed(table, actor); } catch { /* presence gone */ }          // lobby.PRESENCE.closed: grace starts
      },
      filter() {                                                                             // erinne's per-viewer relay on a wake
        const out = check();                                                                 // look as this viewer
        if (out && out[0] === 'end') closeSoon();                                            // the last word
        return out;                                                                          // [event, data] or null
      },
    });
  });
}

module.exports = { register, readMove, lookParty };
