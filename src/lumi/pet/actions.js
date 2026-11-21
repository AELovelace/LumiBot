'use strict';

/**
 * Lumi Pet: the ONE way to run a care action or purchase, used by the website (routes/pet.js POST /api/lumi-pet/act)
 * and by Discord (src/lumi/discord). Nothing else should call lumipet.act() for a player's own action.
 *
 *   runPetAction(uid, username, input, { onceRef, lock })
 *     input     the same choices the website sends ({ action, item, count, ... }), checked against ACT_FORM
 *     onceRef   optional: a key that may only ever run once (Discord passes 'lumi-discord:<interaction id>'), claimed
 *               in lumi_coin_refs inside the same transaction, so a retried interaction can't buy twice
 *     lock      true: take the per-player money lock here (Discord). The website's router already holds it for
 *               { money: true } routes, so routes/pet.js leaves this false.
 *   -> the act() result with blocked names (what the website's JSON answer has always been)
 *
 * Errors: Lumi refusing (PetError) becomes a 400 LumiError with her words; not enough SGC is a 402; an onceRef that
 * already ran is a 409 'already_done'; an overlapping action is a 409 'busy'.
 */

const { tx, getDb, nowMs } = require('../db');
const events = require('../events');
const users = require('../users');
const locks = require('../locks');
const { LumiError, badRequest } = require('../errors');
const { form } = require('../town/forms');
const lumipet = require('./lumipet');
const lumihouse = require('./lumihouse');
const lumitown = require('../town/lumitown');

// erinne PetAction: only choices (which thing, how many); the server decides every result.
const ACT_FORM = {
  action: { type: 'str', choices: lumipet.ACTIONS },                                // what to do
  item: { type: 'str', max: 40, nullable: true, default: null },                    // which thing
  count: { type: 'int', min: 1, max: lumipet.MAX_HELD, default: 1 },                // how many (buy)
  moments: { type: 'int', min: 0, max: lumipet.MAX_MOMENTS, default: 0 },           // only read by "import"
  glow: { type: 'str', max: 20, nullable: true, default: null },                    // a glow colour
  slot: { type: 'int', min: 0, max: 9, nullable: true, default: null },             // a mod slot
  name: { type: 'str', max: 40, nullable: true, default: null },                    // her name
  colour: { type: 'str', max: 7, nullable: true, default: null },                   // '#rrggbb' or ''
  spot: { type: 'str', max: 40, nullable: true, default: null },                    // a spot for decorate/paint
  home: { type: 'str', choices: ['flat', 'house'], default: 'flat' },               // which home decorate/paint furnish
};

const ONCE_REF = /^[\x21-\x7e]{1,200}$/u;                                           // same shape sgc.js accepts for refs

/** Run fn; a PetError (Lumi refusing) becomes a 400 with her words (erinne HTTPException 400). */
function refusals(fn) {
  try {
    return fn();                                                                    // the work
  } catch (error) {
    if (error instanceof lumipet.PetError) throw badRequest(error.message, 'refused'); // her words
    throw error;                                                                    // LumiErrors (402 ...) and bugs pass through
  }
}

/** erinne _named: the Settings list of who she blocked needs their names (the save keeps only ids). */
function named(data) {
  const blocked = ((data.pet || {}).blocked || []).map((uid) => ({ id: String(uid), name: users.displayName(uid) === 'Someone' ? `someone (${uid})` : users.displayName(uid) })); // id + name
  return { ...data, blocked };                                                      // with names
}

/** Claim a run-once key inside the open transaction; a second claim is a 409 (and the whole tx rolls back). */
function claimOnce(ref, uid) {
  if (typeof ref !== 'string' || !ONCE_REF.test(ref)) throw new Error(`runPetAction: bad onceRef "${ref}".`); // programming bug
  const db = getDb();                                                               // economy DB
  if (db.prepare('SELECT 1 FROM lumi_coin_refs WHERE ref = ?').get(ref)) {          // ran before
    throw new LumiError(409, 'already_done', 'That was already done.');             // never twice
  }
  db.prepare('INSERT INTO lumi_coin_refs (ref, user_id, amount, at) VALUES (?, ?, 0, ?)').run(ref, String(uid), nowMs()); // claim (amount 0: it is a guard, not a payout)
}

/** The action itself (no lock): validate, run act() with the coins in one transaction, then tell the town. */
function runUnlocked(uid, username, input, onceRef) {
  const body = form(input, ACT_FORM);                                               // only choices (400 on anything odd)
  const id = String(uid);                                                           // Discord id
  const done = refusals(() => tx(() => {                                            // pet + coins (+ the once-claim) together
    if (onceRef !== undefined && onceRef !== null) claimOnce(onceRef, id);          // rolls back with a refusal, so a retry can run
    return lumipet.act(id, body.action, {
      item: body.item, count: body.count, moments: body.moments, glow: body.glow, slot: body.slot, // the choices
      name: body.name, colour: body.colour, spot: body.spot, home: body.home, username,
    });
  }));
  lumitown.forgetLook(id);                                                          // her look may have changed: town sees it at once
  const said = done.said || {};                                                     // what happened
  if (said.door === 'closed' || 'block' in said) {                                  // door shut or someone blocked: guests go home
    const out = lumihouse.HOUSES.sendHome(id, said.block === undefined ? null : said.block); // who must leave
    if (out.length) {
      events.publish(lumitown.CHANNEL, 'home', { kind: 'home', host: id, out });    // their pages walk them home
      events.publish(lumitown.CHANNEL, 'moved', { kind: 'moved' });                 // everyone looks again
    }
  }
  return named(done);                                                               // with blocked names
}

/** Run one care action or purchase for a player. See the header for options. */
function runPetAction(uid, username, input, { onceRef = null, lock = false } = {}) {
  if (!lock) return runUnlocked(uid, username, input, onceRef);                     // caller (the router) holds the lock
  if (!locks.take(uid)) throw locks.busyError();                                    // Discord: take it here (sync, no await gap)
  try {
    return runUnlocked(uid, username, input, onceRef);                              // the action
  } finally {
    locks.release(uid);                                                             // always free it
  }
}

module.exports = {
  runPetAction,   // the one entry for care actions and purchases
  refusals,       // PetError -> 400 (also used by routes/dungeon.js via routes/pet.js)
  named,          // add blocked players' names
  ACT_FORM,       // the allowed choices
};
