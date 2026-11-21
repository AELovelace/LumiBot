'use strict';

/**
 * Lumi-Town on Discord: button / menu ids. No dependencies on purpose, so card.js, command.js and index.js can all
 * use it without a require loop.
 *
 *   customId('feed', ownerId, 'cookie')  -> 'lumipet:feed:<ownerId>:cookie'   (Discord allows 100 characters)
 *   parseCustomId('lumipet:feed:1:cookie') -> { verb: 'feed', args: ['1', 'cookie'] }  (null if not Lumi's)
 */

const CUSTOM_ID_PREFIX = 'lumipet:';     // every Lumi button/select customId starts with this
const CUSTOM_ID_MAX = 100;               // Discord's limit

/** Split 'lumipet:<verb>:<a>:<b>' into { verb, args: [a, b] } (null if not ours). */
function parseCustomId(customId) {
  const text = String(customId || '');                                                 // may be undefined
  if (!text.startsWith(CUSTOM_ID_PREFIX)) return null;                                 // not Lumi's
  const [verb, ...args] = text.slice(CUSTOM_ID_PREFIX.length).split(':');             // pieces
  return verb ? { verb, args } : null;                                                 // a verb is required
}

/** Build a customId; throws if it would be longer than Discord allows. */
function customId(verb, ...args) {
  const id = [CUSTOM_ID_PREFIX + verb, ...args.map(String)].join(':');                // join
  if (id.length > CUSTOM_ID_MAX) throw new Error(`customId too long (${id.length}): ${id}`); // Discord's limit
  return id;                                                                           // done
}

module.exports = { customId, parseCustomId, CUSTOM_ID_PREFIX, CUSTOM_ID_MAX };
