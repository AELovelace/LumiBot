'use strict';

/**
 * Worker-side runtime helper.
 *
 * Engine workers `require('../../runtime')` (relative to the worker's
 * own location under src/workers/engines/<name>/) and use the exported
 * helpers to register command handlers, emit events, and call brokered
 * DB operations. This module hides the message-protocol bookkeeping so
 * each engine can focus on its own state machine.
 */

const { parentPort, workerData } = require('node:worker_threads');

const { MSG_TYPES, nextId } = require('./protocol');

if (!parentPort) {
  throw new Error('worker runtime can only be loaded inside a Worker thread');
}

const DB_TIMEOUT_MS = 10_000;

const commandHandlers = new Map();
const dbPending = new Map();

/**
 * Register a command handler. The handler receives the args object and
 * may return a value or a promise. The return value is sent back to the
 * main process as the reply. Throwing rejects the calling promise on
 * the main side with the error message.
 */
function registerCommand(name, handler) {
  if (typeof name !== 'string' || !name) {
    throw new Error('command name required');
  }
  if (typeof handler !== 'function') {
    throw new Error(`command handler for '${name}' must be a function`);
  }
  if (commandHandlers.has(name)) {
    throw new Error(`command already registered: ${name}`);
  }
  commandHandlers.set(name, handler);
}

/** Fire a one-way event back to the main process. */
function emitEvent(name, payload = {}) {
  if (typeof name !== 'string' || !name) {
    throw new Error('event name required');
  }
  parentPort.postMessage({ type: MSG_TYPES.EVENT, name, ...payload });
}

/** Invoke a brokered DB op on the main thread; returns a promise. */
function dbCall(op, args = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId();
    const timer = setTimeout(() => {
      if (dbPending.delete(id)) {
        reject(new Error(`db op '${op}' timed out after ${DB_TIMEOUT_MS}ms`));
      }
    }, DB_TIMEOUT_MS);

    dbPending.set(id, { resolve, reject, timer });
    parentPort.postMessage({ type: MSG_TYPES.DB_REQ, id, op, args });
  });
}

async function _handleCmd(msg) {
  const handler = commandHandlers.get(msg.cmd);
  if (!handler) {
    parentPort.postMessage({
      type: MSG_TYPES.REPLY,
      id: msg.id,
      ok: false,
      error: `unknown command: ${msg.cmd}`,
    });
    return;
  }

  try {
    const result = await handler(msg.args || {});
    parentPort.postMessage({
      type: MSG_TYPES.REPLY,
      id: msg.id,
      ok: true,
      result: result === undefined ? null : result,
    });
  } catch (err) {
    parentPort.postMessage({
      type: MSG_TYPES.REPLY,
      id: msg.id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
}

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case MSG_TYPES.CMD:
      void _handleCmd(msg);
      return;

    case MSG_TYPES.DB_REPLY: {
      const pending = dbPending.get(msg.id);
      if (!pending) return;
      dbPending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error || 'db-error'));
      return;
    }

    case MSG_TYPES.PING:
      parentPort.postMessage({ type: MSG_TYPES.PONG });
      return;

    case MSG_TYPES.SHUTDOWN:
      // Give in-flight handlers a tick to finish, then exit.
      setImmediate(() => process.exit(0));
      return;

    default:
      return;
  }
});

module.exports = {
  workerData,
  registerCommand,
  emitEvent,
  dbCall,
};
