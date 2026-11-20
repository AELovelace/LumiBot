'use strict';

/**
 * Lumi Pet's own API (erinne mnemerynne/web/games.py: pet_visit, pet_state, pet_act, _named).
 *   POST /api/lumi-pet/visit   the first visit of the LA day pays a little SGC (pay 'pet','visit', ref lumi-pet:<uid>:<day>)
 *   GET  /api/lumi-pet/state   Lumi as she is now, caught up
 *   POST /api/lumi-pet/act     one care action or purchase (lumipet.act); a refusal is 400 and changes nothing
 * Fights, dungeon, garden and party routes belong to their own modules (they call lumipet.fightStart etc.).
 */

const { tx, dayKey } = require('../db');
const sgc = require('../sgc');
const users = require('../users');
const events = require('../events');
const { badRequest } = require('../errors');
const lumipet = require('../pet/lumipet');
const lumihouse = require('../pet/lumihouse');
const lumitown = require('../town/lumitown');
const { form } = require('../town/forms');

const PET_VISIT = 25;                                                               // erinne coins.PET_VISIT (native)

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

/** Add the Lumi Pet routes (index.js calls this once). */
function register(router) {
  router.post('/api/lumi-pet/visit', (ctx) => tx(() => {                            // one transaction: ref + coins
    const uid = ctx.user.id;                                                        // Discord id
    const r = sgc.pay(uid, ctx.user.name, PET_VISIT, 'pet', 'visit', `lumi-pet:${uid}:${dayKey()}`); // once per LA day
    return { paid: r.paid, owed: r.owed, capped: r.capped, coins: sgc.balance(uid) }; // what the page shows
  }), { money: true });                                                             // one money action at a time

  router.get('/api/lumi-pet/state', (ctx) => tx(() => named(lumipet.state(ctx.user.id)))); // read + catch up (saves)

  router.post('/api/lumi-pet/act', (ctx) => {
    const body = form(ctx.body, ACT_FORM);                                          // only choices
    const uid = ctx.user.id;                                                        // Discord id
    const done = refusals(() => tx(() => lumipet.act(uid, body.action, {            // pet + coins together
      item: body.item, count: body.count, moments: body.moments, glow: body.glow, slot: body.slot, // the choices
      name: body.name, colour: body.colour, spot: body.spot, home: body.home, username: ctx.user.name,
    })));
    lumitown.forgetLook(uid);                                                       // her look may have changed: town sees it at once
    const said = done.said || {};                                                   // what happened
    if (said.door === 'closed' || 'block' in said) {                                // door shut or someone blocked: guests go home
      const out = lumihouse.HOUSES.sendHome(uid, said.block === undefined ? null : said.block); // who must leave
      if (out.length) {
        events.publish(lumitown.CHANNEL, 'home', { kind: 'home', host: uid, out }); // their pages walk them home
        events.publish(lumitown.CHANNEL, 'moved', { kind: 'moved' });               // everyone looks again
      }
    }
    return named(done);                                                             // with blocked names
  }, { money: true });                                                              // one money action at a time
}

module.exports = { register, refusals, named, ACT_FORM, PET_VISIT };
