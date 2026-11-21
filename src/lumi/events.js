'use strict';

/**
 * Lumi games: live updates. An in-process pub/sub (replaces erinne's Valkey `events` + rooms_bus) and a tiny
 * Server-Sent Events writer for the browser's EventSource.
 *
 * Wire format matches erinne's rooms_bus.sse exactly, so public/lumi/**.js listens unchanged:
 *     ": hello\n\n"                                 once, when the stream opens
 *     "event: <kind>\ndata: <json>\n\n"             one per event (the page does addEventListener(kind, ...))
 *     ": ping\n\n"                                  heartbeat (every 25 s here)
 */

const { EventEmitter } = require('node:events');

const HEARTBEAT_MS = 25_000;          // comment line every 25 s keeps proxies from closing the stream
const MAX_STREAMS_PER_USER = 8;       // one player can't hold more streams open than this (tabs, reconnects)

const bus = new EventEmitter();       // channel name -> listeners
bus.setMaxListeners(0);               // many open streams per channel is normal
const open = new Set();               // every live stream handle, so stopAll() can close them
const perUser = new Map();            // user id -> number of open streams

/**
 * Tell everyone listening on `channel` that `event` happened. data must be JSON-serialisable.
 * Example: publish('town', 'said', { id, uid, text }) or publish(`party:${code}`, 'party', view).
 */
/**
 * Lumi-Town news (src/lumi/discord/news.js listens): game code publishes here INSIDE its transaction, so every event
 * carries the ref that proves it committed; news.js checks that ref before posting anything.
 *   'win'      { uid, game, kind, amount, ref }       a prize paid by sgc.pay (news keeps only the big ones)
 *   'owed'     { uid, game, kind, amount, ref }       an owed prize finally paid by treasury.payOwed
 *   'showdown' { game, uid, name, racers, ref }       a finished showdown and its winner (ref = the winner's run prize)
 */
const NEWS_CHANNEL = 'lumi:news';

function publish(channel, event, data) {
  bus.emit(String(channel), { event: String(event), data });   // synchronous fan-out to subscribers
}

/** Listen to a channel without a stream (server-side use). Returns an unsubscribe function. */
function subscribe(channel, fn) {
  const name = String(channel);                                // channels are strings
  bus.on(name, fn);                                            // fn({ event, data })
  return () => bus.off(name, fn);                              // call to stop listening
}

// One SSE frame in erinne's format.
function frame(event, data, id) {
  const head = id === undefined || id === null ? '' : `id: ${id}\n`;     // optional event id
  return `${head}event: ${event}\ndata: ${JSON.stringify(data === undefined ? {} : data)}\n\n`; // event + JSON line
}

/**
 * Turn the current request into an SSE stream of `channel` (call it from a route handler and return nothing).
 * @param {object} ctx       the router's ctx ({ req, res, user, ... })
 * @param {string|null} channel  channel to relay (null: only what you send() yourself)
 * @param {object} [opts]
 *   onOpen(stream)               called once after the headers and ": hello" (send the first state here)
 *   onClose()                    called once when the stream ends for any reason
 *   filter(event, data, ctx)     per-viewer relay: return null/false to skip, true to pass as-is,
 *                                or [event, data] to send something else (erinne's _relay)
 *   heartbeatMs                  default 25000
 * @returns {{ send(event, data, id?), comment(text), close(), closed: boolean }}
 */
function sse(ctx, channel, { onOpen, onClose, filter, heartbeatMs = HEARTBEAT_MS } = {}) {
  const { req, res } = ctx;                                    // node request/response
  const uid = ctx.user ? String(ctx.user.id) : '';             // who is listening (for the per-user cap)
  if (uid && (perUser.get(uid) || 0) >= MAX_STREAMS_PER_USER) { // too many already
    res.writeHead(429, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); // refuse politely
    res.end(JSON.stringify({ error: 'Too many live connections. Close a tab and try again.', detail: 'Too many live connections. Close a tab and try again.', code: 'too_many_streams' }));
    ctx.streaming = true;                                      // the router must not answer again
    return { send() {}, comment() {}, close() {}, closed: true }; // a dead handle
  }
  ctx.streaming = true;                                        // tell the router we answered ourselves
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',        // SSE
    'cache-control': 'no-cache, no-store',                     // never cached
    connection: 'keep-alive',                                  // hold the socket
    'x-accel-buffering': 'no',                                 // nginx: don't buffer this response
    'x-content-type-options': 'nosniff',                       // same safety headers as JSON
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders(); // send the headers right away
  if (req.socket && typeof req.socket.setTimeout === 'function') req.socket.setTimeout(0); // no idle timeout on a stream
  if (req.socket && typeof req.socket.setNoDelay === 'function') req.socket.setNoDelay(true); // small frames go out at once

  const stream = {
    closed: false,                                             // flips once
    send(event, data, id) {                                    // write one event
      if (stream.closed || res.writableEnded) return false;    // gone
      return res.write(frame(event, data, id));                // false = kernel buffer full (the browser is slow)
    },
    comment(text) {                                            // write a comment line (ignored by EventSource)
      if (stream.closed || res.writableEnded) return false;    // gone
      return res.write(`: ${String(text).replace(/[\r\n]+/gu, ' ')}\n\n`); // one line only
    },
    close() { cleanup(); },                                    // end the stream from the server side
  };

  let unsubscribe = null;                                      // set below when a channel is relayed
  const beat = setInterval(() => stream.comment('ping'), Math.max(1000, heartbeatMs)); // keepalive
  if (typeof beat.unref === 'function') beat.unref();          // never keeps the process alive
  if (uid) perUser.set(uid, (perUser.get(uid) || 0) + 1);      // count this stream
  open.add(stream);                                            // remember it for stopAll()

  function cleanup() {
    if (stream.closed) return;                                 // only once
    stream.closed = true;                                      // mark dead
    clearInterval(beat);                                       // stop the heartbeat
    if (unsubscribe) unsubscribe();                            // stop relaying
    open.delete(stream);                                       // forget it
    if (uid) {
      const n = (perUser.get(uid) || 1) - 1;                   // one fewer for this user
      if (n <= 0) perUser.delete(uid); else perUser.set(uid, n); // tidy the map
    }
    try { if (!res.writableEnded) res.end(); } catch { /* socket already gone */ } // finish the response
    if (typeof onClose === 'function') {
      try { onClose(); } catch { /* a cleanup error must not crash the server */ } // caller's cleanup
    }
  }

  req.on('close', cleanup);                                    // browser went away
  res.on('close', cleanup);                                    // response closed
  res.on('error', cleanup);                                    // socket error

  res.write(': hello\n\n');                                    // erinne's first line
  if (channel !== null && channel !== undefined) {
    unsubscribe = subscribe(channel, ({ event, data }) => {    // relay this channel
      if (stream.closed) return;                               // gone meanwhile
      let out = [event, data];                                 // default: as published
      if (typeof filter === 'function') {
        let verdict;                                           // what the filter said
        try { verdict = filter(event, data, ctx); } catch { verdict = null; } // a filter bug skips the event
        if (!verdict) return;                                  // null/false: not for this viewer
        if (Array.isArray(verdict)) out = verdict;             // [event, data]: send this instead
      }
      stream.send(out[0], out[1]);                             // write it
    });
  }
  if (typeof onOpen === 'function') {
    try { onOpen(stream); } catch { cleanup(); }               // a failing first send ends the stream
  }
  return stream;                                               // the handle
}

/** Close every open stream (used by stopLumiGames on shutdown). */
function stopAll() {
  for (const stream of [...open]) stream.close();              // each cleans itself up
}

/** How many streams are open (for status and tests). */
function openCount() {
  return open.size;                                            // live streams
}

module.exports = {
  publish,     // publish(channel, event, data)
  subscribe,   // subscribe(channel, fn) -> unsubscribe
  sse,         // sse(ctx, channel, { onOpen, onClose, filter }) -> stream
  stopAll,     // close every stream
  openCount,   // number of open streams
  frame,       // the wire format, exported for tests
  NEWS_CHANNEL, // 'lumi:news' (Lumi-Town news for Discord)
};
