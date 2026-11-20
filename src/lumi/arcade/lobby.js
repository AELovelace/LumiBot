'use strict';

/**
 * What every multiplayer table shares: who is still there, and table codes (erinne mnemerynne/lobby.py).
 *
 * Arcade showdowns (showdown.js) and Lumi parties keep their tables in the database, but whether a player is still at
 * one is not worth a database write: it lives here, in memory. After a restart nobody has been heard from yet, so
 * everybody is treated as just arrived and gets the full grace period to come back.
 *
 * A player counts as there while:
 *  - a live stream for the table is open on their page (showdowns, parties), or
 *  - their page asked about the table recently.
 *
 * Table keys: erinne used tuples like ("arcade", code). Here a key may be an array (['arcade', code]) or a string;
 * both are turned into one string by tableKey(), so ['arcade', 'AB12CD34'] and 'arcade\u001fAB12CD34' are the same.
 * Times are SECONDS (like erinne's time.monotonic()); the default clock is db.nowMs() / 1000 so tests that fake the
 * Lumi clock with db.setClock() move presence too. Tests may also build their own Presence(clock).
 */

const crypto = require('node:crypto');            // random table codes
const { getDb, nowMs } = require('../db');        // the economy DB + the test-swappable clock

const SEP = '\u001f';                              // joins the parts of an array key (a character no code contains)
const TABLE_NAME = /^lumi_[a-z_]{1,40}$/u;         // newCode() only looks in lumi_* tables (the name goes into SQL)

/** One string for a table key: ['arcade', code] -> 'arcade<US>code'; a string stays itself. */
function tableKey(table) {
  return Array.isArray(table) ? table.map(String).join(SEP) : String(table); // arrays joined, strings as they are
}

class Presence {
  /** @param {() => number} [clock] seconds now (default: the Lumi clock in seconds) */
  constructor(clock = () => nowMs() / 1000) {
    this.clock = clock;                            // where "now" comes from
    this._tables = new Map();                      // table key -> Map(actor -> { seen: seconds, streams: count })
  }

  // The record for (table, actor), made when missing (create=true) or null.
  _entry(table, actor, create) {
    const key = tableKey(table);                   // one string per table
    let actors = this._tables.get(key);            // this table's players
    if (!actors) {
      if (!create) return null;                    // nothing known about the table
      actors = new Map();                          // first player heard from here
      this._tables.set(key, actors);               // remember the table
    }
    let entry = actors.get(String(actor));         // this player's record
    if (!entry && create) {
      entry = { seen: this.clock(), streams: 0 };  // heard from just now
      actors.set(String(actor), entry);            // remember them
    }
    return entry || null;                          // the record (or null)
  }

  /** This player just asked about this table, or did something at it. */
  seen(table, actor) {
    this._entry(table, actor, true).seen = this.clock(); // last heard from: now
  }

  /** A stream for this table opened on the player's page: they count as there until it closes. */
  opened(table, actor) {
    const entry = this._entry(table, actor, true); // their record
    entry.streams += 1;                            // one more open stream
    entry.seen = this.clock();                     // and heard from now
  }

  /** That stream ended (the game closed, the page reloaded, the network dropped). The grace period starts now. */
  closed(table, actor) {
    const entry = this._entry(table, actor, true); // their record
    entry.streams = Math.max(0, entry.streams - 1); // one fewer stream (never below zero)
    entry.seen = this.clock();                     // the grace period counts from now
  }

  /** Whether a stream for this table is open on this player's page right now. */
  streaming(table, actor) {
    const entry = this._entry(table, actor, false); // their record, if any
    return Boolean(entry && entry.streams > 0);    // any stream open?
  }

  /**
   * Seconds since this player was last heard from at this table; 0 while a stream is open. Someone this process has
   * never heard of (a seat saved before a restart) is taken as here now, so they get the whole grace period.
   */
  quietFor(table, actor) {
    const entry = this._entry(table, actor, true); // their record (made "just now" when new)
    if (entry.streams > 0) return 0;               // a stream is open: right here
    return Math.max(0, this.clock() - entry.seen); // seconds since last heard from
  }

  /** The table is gone: drop everything about it. */
  forget(table) {
    this._tables.delete(tableKey(table));          // every player record for that table
  }

  /** How many tables have records (status/tests). */
  size() {
    return this._tables.size;                      // tables known
  }
}

const PRESENCE = new Presence();                    // the one record for this process: showdown.js and parties use it

/**
 * A fresh eight-character table code (e.g. '3FA9C01B'), unused in `table` (lumi_arcade_rooms, lumi_parties ...).
 * Synchronous; call it inside your db.tx() so nobody else takes the code before you insert it.
 */
function newCode(table) {
  if (!TABLE_NAME.test(String(table))) throw new Error(`lobby.newCode: bad table "${table}"`); // never SQL from outside
  const look = getDb().prepare(`SELECT 1 FROM ${table} WHERE code = ?`); // is this code taken?
  for (;;) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex characters, like secrets.token_hex(4)
    if (!look.get(code)) return code;              // free: use it
  }
}

const lobby = {
  Presence,  // the class (tests build their own with a fake clock)
  PRESENCE,  // the shared record (replaceable: callers read lobby.PRESENCE each time)
  newCode,   // a free table code
  tableKey,  // the string form of a table key
};

module.exports = lobby;                             // showdown.js and the party module use lobby.PRESENCE
