'use strict';

/**
 * Lumi-Town: the per-player money lock ("one money action at a time per player").
 *
 * The website's money routes (router.js, routes with { money: true }) and the Discord side (src/lumi/discord) both
 * take this same lock. A snack bought on the website and a snack bought from a Discord button can therefore never
 * run at the same time for the same player.
 *
 * It is an in-memory Set: Lumi-Town runs in one Node process (docs/plans/lumi-games-port.md §9), and a lock only has
 * to last for one action, so nothing needs to survive a restart.
 *
 *   take(uid)              -> true if you got it, false if it is already held
 *   release(uid)           -> let it go (always call it, in a finally)
 *   withUserLock(uid, fn)  -> take, run fn (sync or async), release; throws a 409 'busy' LumiError if already held
 */

const { LumiError } = require('./errors');

const BUSY_MESSAGE = 'One thing at a time, please: your last action is still going.'; // the same words the website always used
const busy = new Set();                                                                // player ids with a money action in flight

/** Try to take the lock for this player. Returns true if taken, false if someone already holds it. */
function take(uid) {
  const id = String(uid);                                                              // Discord ids are strings everywhere
  if (busy.has(id)) return false;                                                      // already running something
  busy.add(id);                                                                        // ours now
  return true;                                                                         // taken
}

/** Release the lock for this player (safe to call when not held). */
function release(uid) {
  busy.delete(String(uid));                                                            // free it
}

/** Is this player's lock held right now? (tests and the admin page) */
function isBusy(uid) {
  return busy.has(String(uid));                                                        // held?
}

/** The error a second, overlapping action gets (HTTP 409 on the website, an ephemeral reply on Discord). */
function busyError() {
  return new LumiError(409, 'busy', BUSY_MESSAGE);                                     // same code + words as before
}

/** Take the lock, run fn, always release. fn may be sync or async; its result (or throw) is passed through. */
async function withUserLock(uid, fn) {
  if (!take(uid)) throw busyError();                                                   // someone else got there first
  try {
    return await fn();                                                                 // the money action
  } finally {
    release(uid);                                                                      // always free it, even on a throw
  }
}

module.exports = {
  take,           // take(uid) -> bool
  release,        // release(uid)
  isBusy,         // isBusy(uid) -> bool
  busyError,      // the 409 'busy' LumiError
  withUserLock,   // withUserLock(uid, fn) -> fn's result
  BUSY_MESSAGE,   // the words, for tests
};
