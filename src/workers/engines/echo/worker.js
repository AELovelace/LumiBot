'use strict';

/**
 * Echo engine — a smoke-test worker used to verify that the worker
 * runtime, command/reply path, event channel, and DB broker are wired
 * up correctly before any real game engine is migrated.
 *
 * Commands:
 *   echo({ value })           -> { value }                 (round-trip)
 *   balance({ userId })       -> number                    (broker test)
 *   emit({ name, payload })   -> { emitted: true }         (event test)
 */

const { registerCommand, emitEvent, dbCall } = require('../../runtime');

registerCommand('echo', async ({ value } = {}) => ({ value: value ?? null }));

registerCommand('balance', async ({ userId } = {}) => {
  return await dbCall('getBalance', { userId });
});

registerCommand('emit', async ({ name, payload } = {}) => {
  if (typeof name !== 'string' || !name) {
    throw new Error('event name required');
  }
  emitEvent(name, payload && typeof payload === 'object' ? payload : {});
  return { emitted: true };
});
