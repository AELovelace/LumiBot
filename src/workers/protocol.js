'use strict';

/**
 * Shared IPC protocol between the main process and game-engine workers.
 *
 * Message envelope shape (all messages are plain JSON-cloneable objects):
 *   { type: <MSG_TYPES.*>, id?: string, ...payload }
 *
 * Reply messages echo back the original `id`. Events and broadcasts have
 * no `id`. Every cross-thread message MUST set `type` to a value in
 * MSG_TYPES so unknown messages can be ignored safely.
 */

const MSG_TYPES = Object.freeze({
  CMD: 'cmd',                 // main -> worker: invoke a registered command
  REPLY: 'reply',             // worker -> main: reply to a CMD (with id)
  EVENT: 'event',             // worker -> main: fire-and-forget broadcast
  DB_REQ: 'db.req',           // worker -> main: request a brokered DB op
  DB_REPLY: 'db.reply',       // main -> worker: reply to a DB_REQ (with id)
  PING: 'ping',               // main -> worker: optional health probe
  PONG: 'pong',               // worker -> main: response to PING
  SHUTDOWN: 'shutdown',       // main -> worker: voluntary shutdown signal
});

let _counter = 0;

/**
 * Generate a short, monotonically increasing message id. Collision-free
 * within a single process; ids are not meaningful across workers.
 */
function nextId() {
  _counter = (_counter + 1) >>> 0;
  return `m${_counter.toString(36)}`;
}

module.exports = { MSG_TYPES, nextId };
