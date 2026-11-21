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
const lumipet = require('../pet/lumipet');
const { runPetAction, refusals, named, ACT_FORM } = require('../pet/actions');    // the one care/purchase entry (shared with Discord)

const PET_VISIT = 25;                                                               // erinne coins.PET_VISIT (native)

/** Add the Lumi Pet routes (index.js calls this once). */
function register(router) {
  router.post('/api/lumi-pet/visit', (ctx) => tx(() => {                            // one transaction: ref + coins
    const uid = ctx.user.id;                                                        // Discord id
    const r = sgc.pay(uid, ctx.user.name, PET_VISIT, 'pet', 'visit', `lumi-pet:${uid}:${dayKey()}`); // once per LA day
    return { paid: r.paid, owed: r.owed, capped: r.capped, coins: sgc.balance(uid) }; // what the page shows
  }), { money: true });                                                             // one money action at a time

  router.get('/api/lumi-pet/state', (ctx) => tx(() => named(lumipet.state(ctx.user.id)))); // read + catch up (saves)

  router.post('/api/lumi-pet/act', (ctx) => runPetAction(ctx.user.id, ctx.user.name, ctx.body), { money: true }); // pet/actions.js; the router holds the money lock
}

module.exports = { register, refusals, named, ACT_FORM, PET_VISIT };
