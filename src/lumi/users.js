'use strict';

/**
 * Lumi games: who is who. Remembers each player's Discord display name and avatar when they use Lumi (auth.js
 * calls remember() on every request), so town, houses and parties can name OTHER players: displayName(uid).
 * Stored in lumi_users (survives restarts) with a small in-memory cache in front.
 */

const { getDb, nowMs } = require('./db');

const cache = new Map();          // uid -> { name, avatar, at }
const CACHE_MAX = 5000;           // most players kept in memory
const REFRESH_MS = 10 * 60_000;   // re-save an unchanged name at most every 10 minutes

/** Note a player's current name/avatar (cheap: writes only when something changed or it's been a while). */
function remember(uid, name, avatar = '') {
  const id = String(uid || '');                                                     // Discord id as text
  if (!id) return;                                                                  // nothing to remember
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 64); // no control chars, short
  const known = cache.get(id);                                                      // what we had
  const now = nowMs();                                                              // one clock reading
  if (known && known.name === clean && known.avatar === String(avatar || '') && now - known.at < REFRESH_MS) return; // nothing new
  if (cache.size >= CACHE_MAX && !known) cache.delete(cache.keys().next().value);  // drop the oldest entry
  cache.set(id, { name: clean, avatar: String(avatar || ''), at: now });            // update memory
  try {
    getDb().prepare(`
      INSERT INTO lumi_users (user_id, name, avatar, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, updated_at = excluded.updated_at
    `).run(id, clean, String(avatar || ''), now);                                   // persist it
  } catch { /* table missing before init: memory is enough */ }
}

// The stored row for a player (memory first, then lumi_users, then their SGC account name).
function lookup(uid) {
  const id = String(uid || '');                                                     // Discord id as text
  if (cache.has(id)) return cache.get(id);                                          // fast path
  let row = null;                                                                   // what the DB knows
  try {
    row = getDb().prepare('SELECT name, avatar, updated_at AS at FROM lumi_users WHERE user_id = ?').get(id) // Lumi's own record
      || getDb().prepare("SELECT username AS name, '' AS avatar, 0 AS at FROM accounts WHERE user_id = ?").get(id); // or their SGC account
  } catch { row = null; }                                                           // DB not ready
  if (row) cache.set(id, { name: row.name || '', avatar: row.avatar || '', at: row.at || 0 }); // keep it handy
  return row ? cache.get(id) : null;                                                // null: never seen
}

/** A player's display name for other players to see ('Someone' when unknown). */
function displayName(uid) {
  const row = lookup(uid);                                                          // cached record
  return row && row.name ? row.name : 'Someone';                                    // never empty
}

/** A player's Discord avatar URL (the default avatar when unknown). */
function avatarUrl(uid, size = 64) {
  const row = lookup(uid);                                                          // cached record
  if (row && row.avatar && /^[a-z0-9_]{1,64}$/iu.test(row.avatar)) {               // only a real avatar hash
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(uid)}/${row.avatar}.png?size=${size}`; // their picture
  }
  return 'https://cdn.discordapp.com/embed/avatars/0.png';                          // Discord's default
}

module.exports = {
  remember,     // remember(uid, name, avatar)
  displayName,  // displayName(uid) -> 'Name'
  avatarUrl,    // avatarUrl(uid, size)
};
