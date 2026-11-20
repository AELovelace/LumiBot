'use strict';

/**
 * Lumi games: the database helpers every Lumi module shares (see src/lumi/CONTRACT.md).
 *
 * All Lumi tables live in the ECONOMY database (the same SQLite file as SadGirlCoin accounts), so a game change
 * and the coins it costs or pays can commit together in ONE transaction: tx(() => { ...game rows...; sgc.spend(...) }).
 */

const { getEconomyDb } = require('../sadgirlEconomyStore'); // the one shared economy SQLite handle

const LA_DAY = new Intl.DateTimeFormat('en-CA', {             // en-CA prints dates as YYYY-MM-DD
  timeZone: 'America/Los_Angeles',                            // every Lumi "day" (daily caps, visits) is an LA day
  year: 'numeric',                                            // 2026
  month: '2-digit',                                           // 11
  day: '2-digit',                                             // 19
});

let clock = null;                                             // tests may swap the clock with setClock(fn)

/** The economy DB handle. Throws when the economy store has not been opened yet. */
function getDb() {
  const db = getEconomyDb();                                  // set by initEconomyStore()
  if (!db) throw new Error('Lumi: the economy database is not open yet.'); // a startup-order bug, never a player error
  return db;                                                  // better-sqlite3 Database
}

/**
 * Run fn() inside one database transaction and return what it returns. If fn throws, EVERYTHING it wrote
 * (game rows and coin moves) is rolled back. fn must be synchronous: better-sqlite3 refuses a promise.
 * Calling tx() inside another tx() is fine: the inner one becomes a savepoint of the outer one.
 */
function tx(fn) {
  return getDb().transaction(fn)();                           // commit on return, roll back on throw
}

/** True while a transaction is open on the economy DB (sgc.js uses it to insist it is called inside tx()). */
function inTransaction() {
  return Boolean(getDb().inTransaction);                      // better-sqlite3 tracks this for us
}

/** Milliseconds since 1970, like Date.now(), but swappable in tests with setClock(). */
function nowMs() {
  return clock ? clock() : Date.now();                        // the test clock when one is set
}

/** The Lumi day for a time (default: now) as 'YYYY-MM-DD' in America/Los_Angeles. */
function dayKey(ts) {
  const when = ts === undefined ? nowMs() : Number(ts);       // default to "now"
  return LA_DAY.format(new Date(when));                       // e.g. '2026-11-19'
}

/** Tests only: make nowMs()/dayKey() use fn() instead of the real clock (null puts the real clock back). */
function setClock(fn) {
  clock = typeof fn === 'function' ? fn : null;               // anything else means "real clock"
}

/** Parse a JSON column, returning `fallback` for NULL or broken text (a bad row never crashes a page). */
function parseJson(text, fallback = null) {
  if (text === null || text === undefined || text === '') return fallback; // nothing stored
  try { return JSON.parse(text); } catch { return fallback; } // broken JSON: the fallback
}

module.exports = {
  getDb,          // the economy DB handle
  tx,             // run a function in one transaction
  inTransaction,  // is a transaction open right now?
  nowMs,          // current time in ms (test-swappable)
  dayKey,         // 'YYYY-MM-DD' in Los Angeles
  setClock,       // tests: fake the clock
  parseJson,      // safe JSON.parse for columns
};
