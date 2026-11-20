'use strict';

/**
 * Lumi City's API (erinne mnemerynne/web/games.py pet_heights, pet_heights_floor, pet_city, pet_estate).
 *   GET  /api/lumi-pet/heights/:town          a town's Lumi Heights: floors people live on, and her own flat
 *   GET  /api/lumi-pet/heights/:town/:floor   one floor's 8 doors with nameplates (closed/blocked doors stay unnamed)
 *   GET  /api/lumi-pet/city                   the whole city (lumicity.view)
 *   POST /api/lumi-pet/estate                 one thing done in Lumi City (lumicity.act); city news on the town stream
 * Coins are in lumicity.act (game 'city'). Also creates the lumi_flats table (lumicity.init).
 */

const { tx } = require('../db');
const save = require('../pet/save');
const events = require('../events');
const tuning = require('../tuning');
const { badRequest, notFound, LumiError } = require('../errors');
const lumipet = require('../pet/lumipet');
const lumihouse = require('../pet/lumihouse');
const lumitown = require('../town/lumitown');
const lumicity = require('../city/lumicity');
const { form } = require('../town/forms');

// Lumi City's tuning keys (erinne natives, for the admin preview): replaces games.js's placeholder entry.
tuning.define('city', {
  label: 'Lumi City (real estate)',                                                 // admin page name
  priceKeys: { plot: null, style: null, yard: null, capsule: lumicity.ESTATE.capsule.price }, // plots vary by lot; styles/yard by item id
  payoutKeys: { sale: null, buyback: null },                                        // office buyback (exact SGC); Keepsake repeats
});

const CITY_NEWS = ['buy', 'buy_listing', 'list', 'unlist', 'sell', 'style_set', 'yard_set']; // what changes the city everyone sees

// erinne EstateAction.
const ESTATE_FORM = {
  action: { type: 'str', choices: ['home_town', 'buy', 'buy_listing', 'list', 'unlist', 'sell', 'style_buy', 'style_set', 'yard_buy', 'yard_set', 'capsule'] }, // what
  plot: { type: 'str', pattern: /^[lr]-\d{1,3}-[1-8]$/u, nullable: true, default: null }, // "l-3-5"
  price: { type: 'int', min: 1, max: 10_000_000, nullable: true, default: null },   // a listing's SGC price (list / buy_listing)
  version: { type: 'int', min: 0, nullable: true, default: null },                 // the listing's version she saw
  item: { type: 'str', pattern: /^([a-z][a-z0-9-]{0,31})?$/u, nullable: true, default: null }, // a town, style or yard piece; "" clears
  slot: { type: 'str', pattern: /^[a-z]{1,20}$/u, nullable: true, default: null },  // a yard slot
};

/** The town in a path: left or right (erinne Literal -> 422). */
function townParam(ctx) {
  const town = String(ctx.params.town || '');                                       // the path piece
  if (!lumicity.TOWNS.includes(town)) throw new LumiError(422, 'invalid', 'town is left or right.'); // Literal["left","right"]
  return town;                                                                      // 'left' / 'right'
}

/** Add the Lumi City routes (index.js calls this once). */
function register(router) {
  lumicity.init();                                                                  // CREATE TABLE IF NOT EXISTS lumi_flats

  router.get('/api/lumi-pet/heights/:town', (ctx) => {                              // erinne pet_heights
    const town = townParam(ctx);                                                    // which Lumi Heights
    const floors = [...new Set(lumicity.residents(town).filter((uid) => lumipet._person(uid)).map((uid) => lumicity.apartment(uid).floor))].sort((a, b) => a - b); // lived-on floors
    const me = ctx.user.id;                                                         // Discord id
    return { town, floors, me: { apt: lumicity.apartment(me), town: lumicity.homeTown(me) } }; // her flat too
  });

  router.get('/api/lumi-pet/heights/:town/:floor', (ctx) => {                       // erinne pet_heights_floor
    const town = townParam(ctx);                                                    // which Lumi Heights
    const floor = /^\d{1,7}$/u.test(String(ctx.params.floor)) ? parseInt(ctx.params.floor, 10) : 0; // the floor number
    if (floor < 1 || floor > 1_000_000) throw notFound("There's no such floor.");  // out of range
    const me = ctx.user.id;                                                         // Discord id
    const living = new Set(lumicity.residents(town));                               // who lives in this town
    const doors = [];                                                               // the hallway
    for (let door = 1; door <= 8; door += 1) {
      const n = (floor - 1) * 8 + door;                                             // the flat number behind this door
      const uid = lumicity.flatOwner(n);                                            // whose (apartment() turned around)
      const entry = { door, label: lumicity.aptOfNumber(n).label, id: null, name: null, lumi: null, home: false, open: false }; // unnamed until we know better
      const person = uid && living.has(uid) ? lumipet._person(uid) : null;          // a resident here?
      if (person) {
        const { door: setting, blocked } = save.door(uid);                          // their front door
        const way = lumihouse.access(setting, blocked, uid, me, lumihouse.HOUSES);  // may she knock?
        if (way !== 'closed') {                                                     // closed or blocked keeps its name to itself
          Object.assign(entry, { id: uid, name: person.username, lumi: save.look(uid).name, home: lumihouse.HOUSES.home(uid, 'flat'), open: way === 'own' || way === 'in' }); // named
        }
      }
      doors.push(entry);                                                            // one door
    }
    return { town, floor, doors };                                                  // the hallway
  });

  router.get('/api/lumi-pet/city', (ctx) => lumicity.view(ctx.user.id));            // erinne pet_city (read-only)

  router.post('/api/lumi-pet/estate', (ctx) => {                                    // erinne pet_estate
    const body = form(ctx.body, ESTATE_FORM);                                       // only choices
    let done;                                                                       // the result
    try {
      done = tx(() => lumicity.act(ctx.user.id, body.action, {                      // plot + coins + save together
        plot: body.plot, price: body.price, version: body.version, item: body.item, slot: body.slot, username: ctx.user.name,
      }));
    } catch (error) {
      if (error instanceof lumipet.PetError) throw badRequest(error.message, 'refused'); // her words, nothing changed
      throw error;                                                                  // 402 / bugs pass through
    }
    if (CITY_NEWS.includes(body.action)) events.publish(lumitown.CHANNEL, 'city', { kind: 'city' }); // every page fetches the city again
    lumitown.forgetLook(ctx.user.id);                                               // (her save changed)
    return done;                                                                    // {said, ...view}
  }, { money: true });                                                              // one money action at a time
}

module.exports = { register, CITY_NEWS, ESTATE_FORM };
