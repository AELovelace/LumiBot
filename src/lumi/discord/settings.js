'use strict';

/**
 * Lumi-Town on Discord: the admin knobs, read live from the web panel's settings (src/panelSettings.js SCHEMA,
 * category "Lumi-Town Discord", shown on the panel's Economy page). Every getter clamps to a safe range, so a typo on
 * the panel can't make Lumi spam or stall.
 */

const { getSetting } = require('../../panelSettings');

/** "true"/"1"/"yes"/"on" -> true. */
function truthy(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());    // panel strings
}

/** A number setting, clamped to [min, max] (the default if unreadable). */
function num(key, min, max) {
  const value = Number(getSetting(key));                                               // stored or default
  if (!Number.isFinite(value)) return min;                                             // junk: the safe end
  return Math.min(max, Math.max(min, value));                                          // clamp
}

module.exports = {
  /** Are reminder DMs paused by an admin? */
  remindPaused: () => truthy(getSetting('lumi.discord.remindPaused')),
  /** How often the reminder sweep runs (ms): 1 minute .. 1 hour. */
  remindIntervalMs: () => num('lumi.discord.remindIntervalMs', 60_000, 3_600_000),
  /** Is Lumi-Town news switched on? */
  newsEnabled: () => truthy(getSetting('lumi.discord.newsEnabled')),
  /** A prize at least this big (SGC) is news. */
  newsBigWin: () => num('lumi.discord.newsBigWin', 1, Number.MAX_SAFE_INTEGER),
  /** How long news waits to be batched into one post (ms): 10 s .. 1 hour. */
  newsBatchMs: () => num('lumi.discord.newsBatchMs', 10_000, 3_600_000),
  /** The LA hour (0-23) for the daily bank summary, or null when it's off (24 or more). */
  newsDailyHour: () => {
    const hour = Math.floor(num('lumi.discord.newsDailyHour', 0, 1000));               // 0..
    return hour >= 24 ? null : hour;                                                   // 24+ = off
  },
  truthy,  // tests
};
