'use strict';

/**
 * Who is playing, for the coin calls. Game code may be handed a Discord id string (as the pet module does) or the
 * router's ctx.user ({ id, name }). sgc.spend/pay want both an id string and a name: the name only labels the SGC
 * account, so an unknown name is '' (ensureAccount keeps the old label then), never 'Someone'.
 */

const users = require('../users');                                               // lumi_users cache (names)

/** who: '1234...' or { id, name } -> { id: '1234...', name: 'Doll' | '' } */
function person(who) {
  if (who && typeof who === 'object') {                                          // ctx.user or similar
    const id = String(who.id);                                                   // ids are strings everywhere
    return { id, name: typeof who.name === 'string' && who.name ? who.name : known(id) }; // its own name, else the cache
  }
  const id = String(who);                                                        // a bare Discord id
  return { id, name: known(id) };                                                // name from the cache
}

// The cached display name, or '' when Lumi has never seen this player.
function known(id) {
  const name = users.displayName(id);                                            // 'Someone' when unknown
  return name === 'Someone' ? '' : name;                                         // never write 'Someone' onto an account
}

/** The player-facing words for a sgc.pay result that wasn't simply paid (empty string when it was). */
function payWords(result, limitName) {
  if (!result) return '';                                                        // nothing paid at all
  if (result.owed > 0) return 'Lumi-Town Bank is closed for a moment, your prize is saved.'; // owed: paid by a later sweep
  if (result.capped) return `You hit today's ${limitName} limit.`;              // the daily cap bit
  return '';                                                                     // a plain payment
}

module.exports = { person, payWords };
