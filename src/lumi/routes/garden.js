'use strict';

/**
 * Lumi's Garden API (erinne web/games.py pet_garden, ~line 897):
 *   POST /api/lumi-pet/garden  { action, item?, plot?, count?, picks? } -> the pet snapshot + { said }
 * The page only sends choices, never amounts (erinne GardenStep). The work is lumipet.gardenAct (the pet module),
 * which calls src/lumi/garden/lumigarden.js; this file checks the body and wraps it in one transaction.
 */

const { tx } = require('../db');                                                 // transactions
const tuning = require('../tuning');                                             // admin knobs
const { badRequest, LumiError } = require('../errors');                          // answers
const G = require('../garden/lumigarden');                                       // the garden (catalog for tuning keys)
const { onlyKeys, isInt, invalid } = require('../minis/body');                   // erinne's pydantic checks

const ACTIONS = ['look', 'press', 'plot', 'plant', 'dig', 'trim', 'trim_all', 'unlock', 'decor_buy', 'decor_place', 'decor_sell', 'capsule', 'helper', 'ability',
  'water_start', 'water_answer', 'feed_start', 'feed_end', 'moonrise', 'garden'];  // erinne GardenStep.action

// Admin page entry: plots and every coin flower are 'shop' spends keyed by 'plot' or the flower id (native prices).
tuning.define('garden', {
  label: 'Lumi’s Garden',                                                        // admin name
  priceKeys: { plot: G.CATALOG.plots.price, ...Object.fromEntries(G.CATALOG.flowers.filter((f) => f.coins).map((f) => [f.id, f.coins])) }, // shop keys
  payoutKeys: { press: null, token: G.CATALOG.gifts.token_coins },               // press coins (native), the token gift
});

// erinne GardenStep: action, item (<= 40 chars), plot 0..15, count 0..2000, picks (<= 12 of 0..3). Nothing else.
function checkStep(body) {
  onlyKeys(body, ['action', 'item', 'plot', 'count', 'picks']);                  // never an amount
  if (!ACTIONS.includes(body.action)) throw invalid("Lumi doesn't know that one."); // a known action
  if (body.item !== undefined && body.item !== null && (typeof body.item !== 'string' || body.item.length > 40)) throw invalid('Which one?'); // an id
  if (body.plot !== undefined && body.plot !== null && !isInt(body.plot, 0, 15)) throw invalid('Choose one of the plots.'); // a plot
  if (body.count !== undefined && !isInt(body.count, 0, 2000)) throw invalid('That is too many presses.'); // presses / garden index
  if (body.picks !== undefined && (!Array.isArray(body.picks) || body.picks.length > 12 || body.picks.some((p) => !isInt(p, 0, 3)))) throw invalid('Those cans are not right.'); // watering
}

/** Add the garden route. */
function register(router) {
  router.post('/api/lumi-pet/garden', (ctx) => {
    const body = ctx.body;                                                       // the choice
    checkStep(body);                                                             // choices only
    const lumipet = require('../pet/lumipet');                                   // the pet module (lazy: written in parallel)
    try {
      return tx(() => lumipet.gardenAct(ctx.user.id, body.action, {             // garden + coins + pet in one transaction
        item: body.item === undefined ? null : body.item,                        // flower / helper / decoration / move
        plot: body.plot === undefined ? null : body.plot,                        // which plot
        count: body.count === undefined ? 0 : body.count,                        // presses, or which garden
        picks: body.picks === undefined ? [] : body.picks,                       // watering answer
        username: ctx.user.name,                                                 // labels her SGC account
      }));
    } catch (error) {
      if (error instanceof LumiError) throw error;                               // already an answer (402, GardenError 400 ...)
      if (error && (error.name === 'PetError' || error instanceof lumipet.PetError)) throw badRequest(error.message, 'refused'); // erinne: PetError -> 400
      throw error;                                                               // a bug
    }
  }, { money: true });                                                           // one action at a time per player
}

module.exports = { register, ACTIONS, checkStep };
