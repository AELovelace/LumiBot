'use strict';

/**
 * Main-process worker pool and IPC orchestrator.
 *
 * Responsibilities:
 *   - Spawn and supervise long-lived worker threads grouped by "engine".
 *   - Route command messages to a stable worker (hashed by channelId so
 *     all events for one game session reach the same worker), and await
 *     replies via a request/reply id scheme.
 *   - Bridge brokered DB requests from workers to the main-process store.
 *   - Surface fire-and-forget worker events to subscribed handlers.
 *   - Restart workers on unexpected exit; reject pending requests cleanly.
 *
 * This module deliberately knows nothing about specific games. Game
 * adapters call `manager.sendCommand('blackjack', 'play', { ... })` and
 * subscribe with `manager.onEngineEvent('blackjack', handler)`.
 */

const { Worker } = require('node:worker_threads');

const { logger } = require('../logger');
const { MSG_TYPES, nextId } = require('./protocol');
const { handleDbRequest } = require('./dbBroker');

const DEFAULT_REPLY_TIMEOUT_MS = 10_000;
const RESTART_BACKOFF_MS = 1_000;

class PoolWorker {
  constructor(id, worker) {
    this.id = id;
    this.worker = worker;
    this.alive = true;
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
  }
}

class WorkerManager {
  constructor() {
    /** @type {Map<string, { scriptPath: string, poolSize: number, pool: PoolWorker[], routeIndex: number }>} */
    this.engines = new Map();
    /** @type {Map<string, Set<Function>>} */
    this.eventHandlers = new Map();
    this.shuttingDown = false;
    this.replyTimeoutMs = DEFAULT_REPLY_TIMEOUT_MS;
  }

  /**
   * Register an engine. Must be called BEFORE start().
   * @param {string} name
   * @param {{ scriptPath: string, poolSize?: number }} opts
   */
  registerEngine(name, { scriptPath, poolSize = 1 }) {
    if (this.engines.has(name)) {
      throw new Error(`Engine already registered: ${name}`);
    }
    if (typeof scriptPath !== 'string' || !scriptPath) {
      throw new Error(`scriptPath required for engine '${name}'`);
    }
    this.engines.set(name, {
      scriptPath,
      poolSize: Math.max(1, poolSize | 0),
      pool: [],
      routeIndex: 0,
    });
  }

  /** Subscribe to events emitted by workers of `engineName`. */
  onEngineEvent(engineName, handler) {
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function');
    }
    if (!this.eventHandlers.has(engineName)) {
      this.eventHandlers.set(engineName, new Set());
    }
    this.eventHandlers.get(engineName).add(handler);
  }

  /** Spawn the configured pool for every registered engine. */
  start() {
    for (const [name, engine] of this.engines) {
      for (let i = 0; i < engine.poolSize; i++) {
        this._spawn(name, i);
      }
      logger.info(`WorkerManager: started ${engine.poolSize} worker(s) for engine '${name}'.`);
    }
  }

  _spawn(engineName, slot) {
    const engine = this.engines.get(engineName);
    if (!engine) return;

    let worker;
    try {
      worker = new Worker(engine.scriptPath, {
        workerData: { engineName, slot },
      });
    } catch (err) {
      logger.error(`WorkerManager: failed to spawn ${engineName}#${slot}`, err.message);
      return;
    }

    const pw = new PoolWorker(`${engineName}#${slot}`, worker);
    engine.pool[slot] = pw;

    worker.on('message', (msg) => this._onMessage(engineName, pw, msg));

    worker.on('error', (err) => {
      logger.error(`WorkerManager[${pw.id}]: worker error`, err && err.message ? err.message : err);
    });

    worker.on('exit', (code) => {
      pw.alive = false;
      // Reject all in-flight requests so callers don't hang.
      for (const [, p] of pw.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`Worker ${pw.id} exited (code ${code}) before reply.`));
      }
      pw.pending.clear();

      if (this.shuttingDown) return;
      logger.warn(`WorkerManager[${pw.id}]: exited (code ${code}); restarting in ${RESTART_BACKOFF_MS}ms.`);
      setTimeout(() => {
        if (!this.shuttingDown) this._spawn(engineName, slot);
      }, RESTART_BACKOFF_MS).unref();
    });
  }

  _routeWorker(engineName, channelId) {
    const engine = this.engines.get(engineName);
    if (!engine) {
      throw new Error(`Engine not registered: ${engineName}`);
    }
    const live = engine.pool.filter((w) => w && w.alive);
    if (live.length === 0) {
      throw new Error(`No live workers for engine '${engineName}'.`);
    }
    if (typeof channelId === 'string' && channelId.length > 0) {
      // Stable hash so a channel/session always lands on the same worker.
      let h = 0;
      for (let i = 0; i < channelId.length; i++) {
        h = ((h * 31) + channelId.charCodeAt(i)) >>> 0;
      }
      return live[h % live.length];
    }
    engine.routeIndex = (engine.routeIndex + 1) % live.length;
    return live[engine.routeIndex];
  }

  /**
   * Send a command to a worker and await its reply.
   * @param {string} engineName
   * @param {string} cmd
   * @param {object} [args]
   * @param {{ channelId?: string|null, timeoutMs?: number }} [opts]
   */
  sendCommand(engineName, cmd, args = {}, opts = {}) {
    const channelId = opts.channelId ?? null;
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : this.replyTimeoutMs;

    let pw;
    try {
      pw = this._routeWorker(engineName, channelId);
    } catch (err) {
      return Promise.reject(err);
    }

    const id = nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pw.pending.delete(id)) {
          reject(new Error(`Worker ${pw.id} command '${cmd}' timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);

      pw.pending.set(id, { resolve, reject, timer });

      try {
        pw.worker.postMessage({ type: MSG_TYPES.CMD, id, cmd, args });
      } catch (err) {
        pw.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  _onMessage(engineName, pw, msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case MSG_TYPES.REPLY: {
        const pending = pw.pending.get(msg.id);
        if (!pending) return;
        pw.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error || 'worker-error'));
        return;
      }

      case MSG_TYPES.EVENT: {
        const handlers = this.eventHandlers.get(engineName);
        if (!handlers) return;
        for (const fn of handlers) {
          try {
            fn(msg);
          } catch (err) {
            logger.warn(`WorkerManager[${pw.id}]: event handler threw`, err.message);
          }
        }
        return;
      }

      case MSG_TYPES.DB_REQ: {
        // better-sqlite3 is sync, so this resolves immediately on the
        // main thread. The work is bounded and replaces what the worker
        // would otherwise do directly on its own.
        let reply;
        try {
          const result = handleDbRequest(msg.op, msg.args);
          reply = { type: MSG_TYPES.DB_REPLY, id: msg.id, ok: true, result };
        } catch (err) {
          reply = {
            type: MSG_TYPES.DB_REPLY,
            id: msg.id,
            ok: false,
            error: err && err.message ? err.message : String(err),
          };
        }
        try {
          pw.worker.postMessage(reply);
        } catch (err) {
          logger.warn(`WorkerManager[${pw.id}]: failed to post db reply`, err.message);
        }
        return;
      }

      case MSG_TYPES.PONG:
        // Reserved for future health probes.
        return;

      default:
        // Unknown message types are ignored on purpose so the protocol
        // can grow without crashing older deployments.
        return;
    }
  }

  /** Voluntarily ask all workers to exit and tear down the pool. */
  async shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const terminations = [];
    for (const [, engine] of this.engines) {
      for (const pw of engine.pool) {
        if (!pw || !pw.alive) continue;
        try { pw.worker.postMessage({ type: MSG_TYPES.SHUTDOWN }); }
        catch { /* worker may already be exiting */ }
        terminations.push(pw.worker.terminate().catch(() => {}));
      }
    }
    await Promise.all(terminations);
    logger.info('WorkerManager: all workers terminated.');
  }
}

const manager = new WorkerManager();

module.exports = { manager, WorkerManager };
