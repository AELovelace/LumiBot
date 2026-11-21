'use strict';

/**
 * Lumi-Town on Discord: each player's own choices (table lumi_discord_prefs, src/lumi/schema.js).
 *
 *   get(uid)                 -> { remind, tz, newsHidden, dmFailedAt }  (defaults when they never chose)
 *   setRemind(uid, on)       DM reminders on/off (turning on clears an old "can't DM you")
 *   setTz(uid, tz)           their IANA timezone for quiet hours (validated), or null for Los Angeles
 *   setNewsHidden(uid, on)   keep their name out of Lumi-Town news
 *   markDmFailed(uid)        Discord said "can't DM this user": switch reminders off and remember when
 *   remindBatch(after, n)    up to n user ids with reminders on, in id order after `after` (the sweep's cursor)
 *   hiddenSet(ids)           which of these ids asked not to be named in news
 *   validTz(tz)              is this a timezone Node knows?
 */

const { getDb, nowMs } = require('../db');

const DEFAULT_TZ = 'America/Los_Angeles';   // Lumi's own day, and everyone's clock until they pick one

/** Is tz an IANA timezone this Node knows ('Europe/London', 'America/New_York' ...)? */
function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;                  // shape first
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });                                // throws RangeError if unknown
    return true;
  } catch {
    return false;
  }
}

/** One player's row (or the defaults). */
function get(uid) {
  const row = getDb().prepare('SELECT remind, tz, news_hidden, dm_failed_at FROM lumi_discord_prefs WHERE user_id = ?').get(String(uid)); // their choices
  return {
    remind: Boolean(row && row.remind),                                                // off unless they turned it on
    tz: row && row.tz && validTz(row.tz) ? row.tz : null,                              // null = Los Angeles
    newsHidden: Boolean(row && row.news_hidden),                                       // named by default
    dmFailedAt: row && row.dm_failed_at ? Number(row.dm_failed_at) : null,             // last "can't DM"
  };
}

/** Make sure the row exists, then run an UPDATE on it. */
function update(uid, sql, ...args) {
  const db = getDb();                                                                  // economy DB
  const id = String(uid);                                                              // Discord id
  db.prepare('INSERT OR IGNORE INTO lumi_discord_prefs (user_id, updated_at) VALUES (?, ?)').run(id, nowMs()); // a row to update
  db.prepare(`UPDATE lumi_discord_prefs SET ${sql}, updated_at = ? WHERE user_id = ?`).run(...args, nowMs(), id); // the change
  return get(id);                                                                      // what it is now
}

/** Reminders on/off. Turning on forgets an old DM failure (they may have opened their DMs since). */
function setRemind(uid, on) {
  return on ? update(uid, 'remind = 1, dm_failed_at = NULL') : update(uid, 'remind = 0'); // switch
}

/** Their timezone (null = Los Angeles). Throws on an unknown zone. */
function setTz(uid, tz) {
  if (tz !== null && !validTz(tz)) throw new Error(`Unknown timezone "${tz}".`);      // the caller shows this
  return update(uid, 'tz = ?', tz);                                                    // stored
}

/** Hide (true) or show (false) their name in Lumi-Town news. */
function setNewsHidden(uid, hidden) {
  return update(uid, 'news_hidden = ?', hidden ? 1 : 0);                               // stored
}

/** Discord refused to DM them: reminders off, and when it happened. */
function markDmFailed(uid) {
  return update(uid, 'remind = 0, dm_failed_at = ?', nowMs());                         // stored
}

/** Up to `limit` ids with reminders on, after `after` in id order ('' = from the start). */
function remindBatch(after = '', limit = 100) {
  return getDb().prepare('SELECT user_id FROM lumi_discord_prefs WHERE remind = 1 AND user_id > ? ORDER BY user_id LIMIT ?')
    .all(String(after), limit).map((row) => row.user_id);                              // ids
}

/** Of these ids, which asked not to be named in news? */
function hiddenSet(ids) {
  const list = [...new Set((ids || []).map(String))];                                  // unique ids
  if (!list.length) return new Set();                                                  // nobody
  const marks = list.map(() => '?').join(',');                                         // ?,?,?
  const rows = getDb().prepare(`SELECT user_id FROM lumi_discord_prefs WHERE news_hidden = 1 AND user_id IN (${marks})`).all(...list); // hidden ones
  return new Set(rows.map((row) => row.user_id));                                      // as a set
}

/** How many players have reminders on (admin breadcrumbs). */
function remindCount() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM lumi_discord_prefs WHERE remind = 1').get().n; // count
}

module.exports = {
  get, setRemind, setTz, setNewsHidden, markDmFailed, remindBatch, hiddenSet, remindCount, validTz,
  DEFAULT_TZ,   // 'America/Los_Angeles'
};
