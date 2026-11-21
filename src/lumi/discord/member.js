'use strict';

/**
 * Lumi-Town on Discord: "is this person a member of the club?"
 *
 * The website lets in members of DISCORD_PANEL_GUILD_ID (checked at login, webPanelAuth.js). Discord commands are
 * global, so they can be used in other servers or in DMs. Before any pet action from Discord we ask the same question
 * with the bot's own view of that guild.
 *
 *   isClubMember(client, userId) -> Promise<boolean>
 *
 * Answers are cached: a "yes" for 10 minutes, a "no" for 1 minute (so someone who just joined isn't kept out long).
 * Lookups for the same user at the same moment share one request. If Discord itself fails (not "unknown member"),
 * the error is thrown and nothing is cached, so the caller can say "try again".
 */

const { getPanelAuthConfig } = require('../../webPanelAuth');

const YES_TTL_MS = 10 * 60 * 1000;     // a member stays a member for 10 minutes in the cache
const NO_TTL_MS = 60 * 1000;           // a non-member is asked again after 1 minute
const UNKNOWN_MEMBER = 10007;          // Discord API error: that user is not in the guild
const UNKNOWN_GUILD = 10004;           // Discord API error: the bot isn't in that guild

const cache = new Map();               // userId -> { member: bool, until: ms }
const pending = new Map();             // userId -> Promise<bool> (one lookup at a time per user)
let clock = () => Date.now();          // tests swap this

/** The guild whose members may play (the same one the website checks). */
function clubGuildId() {
  return getPanelAuthConfig().panelGuildId;                                            // DISCORD_PANEL_GUILD_ID (or its default)
}

/** Ask Discord (through the bot) whether userId is in the club guild. */
async function lookup(client, userId) {
  const guildId = clubGuildId();                                                       // where to look
  let guild = client.guilds.cache.get(guildId);                                        // usually already cached
  if (!guild) {
    try {
      guild = await client.guilds.fetch(guildId);                                      // not cached: fetch it
    } catch (error) {
      if (error && error.code === UNKNOWN_GUILD) return false;                         // bot isn't in the club guild: nobody passes
      throw error;                                                                     // Discord trouble: let the caller retry
    }
  }
  try {
    await guild.members.fetch({ user: String(userId), force: true });                  // one member, asked fresh (our own cache above limits calls)
    return true;                                                                       // found: a member
  } catch (error) {
    if (error && error.code === UNKNOWN_MEMBER) return false;                          // not in the guild
    throw error;                                                                       // Discord trouble: don't cache a guess
  }
}

/** Is userId a member of the club? Cached; concurrent calls for one user share a lookup. */
async function isClubMember(client, userId) {
  const id = String(userId);                                                           // snowflakes are strings
  const hit = cache.get(id);                                                           // cached answer?
  if (hit && hit.until > clock()) return hit.member;                                   // still fresh
  if (pending.has(id)) return pending.get(id);                                         // someone is already asking
  const ask = lookup(client, id)
    .then((member) => {
      cache.set(id, { member, until: clock() + (member ? YES_TTL_MS : NO_TTL_MS) });   // remember the answer
      return member;                                                                   // pass it on
    })
    .finally(() => pending.delete(id));                                                // let the next asker through
  pending.set(id, ask);                                                                // share it
  return ask;                                                                          // the answer
}

/** Forget cached answers (one user, or everyone). */
function forget(userId) {
  if (userId === undefined) cache.clear();                                             // everyone
  else cache.delete(String(userId));                                                   // just them
}

/** Tests: fake the clock (pass null to go back to Date.now). */
function setClock(fn) {
  clock = typeof fn === 'function' ? fn : () => Date.now();                            // swap
}

module.exports = {
  isClubMember,   // (client, userId) -> Promise<boolean>
  clubGuildId,    // the guild id members must be in
  forget,         // clear the cache
  setClock,       // tests only
  YES_TTL_MS,     // 10 min
  NO_TTL_MS,      // 1 min
};
