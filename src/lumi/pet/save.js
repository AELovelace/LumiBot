'use strict';

/**
 * Lumi Pet's SAVE MODEL, ported from erinne mnemerynne/lumipet.py (only the parts every game depends on):
 * the item catalogs (with erinne's start-up validation), the fresh save, load (with erinne's migrations), save,
 * peek, look, placed and the lookup tables (_WEAR, _DECOR, _ITEMS ...). Everything else in lumipet.py (care actions,
 * shop, decay, capsules, snapshot) belongs to the pet module (src/lumi/pet/*.js, the pet agent's work).
 *
 * A pet is ONE JSON document in lumi_pets(user_id TEXT, data TEXT). User ids are Discord id STRINGS everywhere,
 * including inside the save (erinne used integers, e.g. in `blocked`). Times are whole milliseconds.
 *
 * Hooks for the modules that own the rest (all optional, see CONTRACT.md):
 *   setAdvance(fn(pet, now))          catch a pet up to `now` (needs decay + mending): pet module
 *   addFreshFields(fn() -> object)    fields merged under every save, e.g. battle fields: battle module
 *   setSettlePoints(fn(pet))          stat-points migration for pre-stat-point saves: battle module
 */

const fs = require('node:fs');
const path = require('node:path');
const { getDb, nowMs, dayKey } = require('../db');

const DATA = path.join(__dirname, '..', 'data');            // src/lumi/data (copied from erinne lumipet_data)
const GAME = 'pet';                                          // tuning/ledger id for Lumi Pet (erinne used "lumi-pet")
const HOUR = 3_600_000;                                      // one hour in ms
const START = 85.0;                                          // where a new pet's meters begin
const KINDS = ['snacks', 'treats', 'toys'];                  // item kinds in items.json
const BOOSTS = ['power', 'guard', 'luck'];                   // what a treat lends the next fight
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']; // capsule rarities, in order
const PRIZE_GAMES = { 'lumi-soft': 'Lumi-Soft' };           // pieces won in another game, by prize id
const GLOWS = ['rose', 'lagoon', 'starlight', 'zephyr', 'wisp', 'umbra']; // her glow colours (lumibattle.GLOW_ELEMENT keys)
const DOORS = ['knock', 'open', 'closed'];                   // her front door for visitors; the first is the default
const HOMES = ['flat', 'house'];                             // her flat in Lumi Heights, and her house on a Lumi City plot
const GUESTBOOK_MAX = 30;                                    // guestbook keeps the last 30 lines
const BLOCKED_MAX = 200;                                     // guard on the block list's length
const MOVE_IN = 1;                                           // pet.moved_in: the house reset that began the move-in has happened
const NAME_MAX = 16;                                         // longest Lumi name
const ID_RE = /^[a-z0-9-]{1,40}$/u;                          // catalog ids
const NAME_RE = new RegExp(`^[\\p{L}\\p{N}\\p{M}_' .-]{1,${NAME_MAX}}$`, 'u'); // letters (any alphabet), digits, spaces, ' . -
const COLOUR_RE = /^#[0-9a-f]{6}$/u;                         // '#rrggbb'
const COLOUR_PAINT_RE = /^#[0-9a-f]{6}$/u;                   // a paint colour on a paintable wall/floor
// Battle defaults (erinne lumibattle.fresh_fields) so a save is complete before the battle module lands.
const MOD_SLOT_COUNT = 5;                                    // lumibattle.MOD_SLOTS has five slots
const STAT_KEYS = ['hp', 'attack', 'defense', 'magic', 'ward', 'speed', 'mp']; // lumibattle.STAT_KEYS

class PetError extends Error {}                              // "refused; the message is safe to show" (erinne PetError)

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); // one data file
const isInt = (v) => Number.isInteger(v);                   // Python isinstance(v, int)

// ---------------------------------------------------------------------------------------------- data loaders

// erinne _bad_game_prize: a "prize" entry must name a known game, be free, nothing else's, and say how to win it.
function badGamePrize(item) {
  return typeof item.prize !== 'string' || !(item.prize in PRIZE_GAMES) || item.price !== 0 || 'rarity' in item
    || Boolean(item.found) || Boolean(item.worn) || typeof item.how !== 'string' || !item.how.trim(); // any rule broken
}

/** items.json: snacks, treats, toys - validated exactly like erinne's load_catalog. Throws on a bad file. */
function loadCatalog(data = readJson('items.json')) {
  const seen = new Set();                                                           // ids used so far
  for (const kind of KINDS) {
    if (!Array.isArray(data[kind]) || !data[kind].length) throw new Error(`Lumi Pet's catalog needs some ${kind}.`); // each kind present
    for (const item of data[kind]) {
      if (!item || typeof item !== 'object' || !ID_RE.test(String(item.id || '')) || seen.has(item.id)) throw new Error(`Lumi Pet's catalog has a bad or repeated id in ${kind}.`); // ids
      seen.add(item.id);                                                            // remember it
      if (!item.name || !item.icon || !isInt(item.price) || item.price < 0 || item.price > 100_000) throw new Error(`Lumi Pet's ${item.id} needs a name, an icon and a price.`); // basics
      const numbers = kind === 'toys' ? ['minutes', 'joy', 'energy', 'hunger'] : ['fullness', 'joy']; // per-kind numbers
      if (numbers.some((n) => !isInt(item[n]) || item[n] < -100 || item[n] > 100)) throw new Error(`Lumi Pet's ${item.id} has a number out of range.`); // -100..100
      if (kind === 'toys' && !(item.minutes >= 1 && item.minutes <= 30)) throw new Error(`Lumi Pet's ${item.id} needs a play time of 1 to 30 minutes.`); // play time
      if (kind === 'treats' && !BOOSTS.includes(item.boost)) throw new Error(`Lumi Pet's ${item.id} needs a known boost.`); // boost
      if ('rarity' in item && (kind !== 'toys' || !RARITIES.includes(item.rarity) || item.price)) throw new Error(`Lumi Pet's ${item.id} can only be a capsule prize if it's an unsold toy.`); // capsule toys
    }
  }
  for (const kind of ['snacks', 'toys']) {                                          // nobody is left with nothing
    if (!data[kind].some((item) => item.price === 0 && !('rarity' in item))) throw new Error(`Lumi Pet's catalog needs a free item among its ${kind}.`);
  }
  return data;                                                                      // validated
}

/** house.json: the spots and their pieces - validated like erinne's load_house. */
function loadHouse(data = readJson('house.json')) {
  const seen = new Set();                                                           // ids used so far
  if (!Array.isArray(data.spots) || !data.spots.length) throw new Error("Lumi's house needs some spots."); // spots present
  for (const spot of data.spots) {
    if (!spot || typeof spot !== 'object' || !ID_RE.test(String(spot.id || '')) || seen.has(spot.id) || !spot.name) throw new Error("Lumi's house has a bad or repeated spot."); // spot ids
    seen.add(spot.id);                                                              // remember it
    if ('same_as' in spot) {                                                        // another room's wall/floor sharing pieces
      const base = data.spots.find((o) => o.id === spot.same_as);                   // the spot it copies
      if (!base || base === spot || 'same_as' in base || (spot.items && spot.items.length) || data.spots.indexOf(base) > data.spots.indexOf(spot)) {
        throw new Error(`The ${spot.id} spot must share an earlier spot's pieces and have none of its own.`);
      }
      continue;                                                                     // nothing of its own to check
    }
    if (!Array.isArray(spot.items) || !spot.items.length) throw new Error(`The ${spot.id} spot needs something to put in it.`); // pieces present
    for (const item of spot.items) {
      if (!item || typeof item !== 'object' || !ID_RE.test(String(item.id || '')) || seen.has(item.id) || !item.name) throw new Error(`The ${spot.id} spot has a bad or repeated object.`); // piece ids
      seen.add(item.id);                                                            // remember it
      if (!isInt(item.price) || item.price < 0 || item.price > 100_000) throw new Error(`The house's ${item.id} needs a price.`); // price
      if ('rarity' in item && (!RARITIES.includes(item.rarity) || item.price || item.found)) throw new Error(`The house's ${item.id} can't be a Star Capsule prize as well as sold or found.`); // capsule decor
      if (item.worn && (item.price || 'rarity' in item || item.found || !isInt(item.box))) throw new Error(`The house's ${item.id} is a worn piece: free, from a numbered moving box, never sold, won or found.`); // moving-box piece
      if ('prize' in item && badGamePrize(item)) throw new Error(`The house's ${item.id} is a game prize: free, never sold, won from a capsule, found or worn, and it says how to win it.`); // game prize
    }
    const first = spot.items[0];                                                    // the free default
    if (first.price !== 0 || 'rarity' in first || 'prize' in first) throw new Error(`The ${spot.id} spot's first object must be free.`);
    const free = spot.items.slice(1).filter((i) => !i.price && !i.worn && !('rarity' in i) && !i.found && !('prize' in i)).map((i) => i.id); // free extras
    if (free.length) throw new Error(`Only a spot's first object and worn pieces are free: ${free.join(', ')} needs a price.`);
  }
  const boxes = data.spots.flatMap((s) => (s.items || []).filter((i) => i.worn).map((i) => i.box)).sort((a, b) => a - b); // box numbers
  if (boxes.some((b, i) => b !== i + 1)) throw new Error('The moving boxes must be numbered 1, 2, 3 and so on, one worn piece each.'); // 1..n
  return data;                                                                      // validated
}

/** closet.json: wearable slots, the two capsules and rarity values - validated like erinne's load_closet. */
function loadCloset(data = readJson('closet.json')) {
  const seen = new Set();                                                           // ids used so far
  const okOdds = (odds, exact) => odds && typeof odds === 'object' && Object.keys(odds).length
    && (exact ? JSON.stringify(Object.keys(odds)) === JSON.stringify(RARITIES) : Object.keys(odds).every((r) => RARITIES.includes(r)))
    && Object.values(odds).every((v) => isInt(v) && v >= 1) && Object.values(odds).reduce((a, b) => a + b, 0) === 100; // odds add to 100
  const c = data.capsule;                                                           // Star Capsule
  if (!c || !c.name || !isInt(c.price) || c.price < 1 || c.price > 100_000 || !okOdds(c.odds, true)) throw new Error('The Star Capsule needs a price and odds for every rarity that add up to 100.');
  const m = data.moon;                                                              // Moon Capsule
  if (!m || !m.name || !isInt(m.price) || m.price < 1 || m.price > 100_000 || !okOdds(m.odds, false)) throw new Error('The Moon Capsule needs a price and odds that add up to 100.');
  const v = data.values;                                                            // what each rarity is worth
  if (!v || JSON.stringify(Object.keys(v)) !== JSON.stringify(RARITIES) || Object.values(v).some((n) => !isInt(n) || n < 2 || n > 100_000)) throw new Error('The closet needs a value for every rarity, so a repeat can pay back half of it.');
  for (const slot of data.slots && data.slots.length ? data.slots : [null]) {
    if (!slot || typeof slot !== 'object' || !ID_RE.test(String(slot.id || '')) || seen.has(slot.id) || !slot.name || !(slot.items && slot.items.length)) throw new Error("Lumi's closet has a bad or repeated slot.");
    seen.add(slot.id);                                                              // remember it
    for (const item of slot.items) {
      if (!item || typeof item !== 'object' || !ID_RE.test(String(item.id || '')) || seen.has(item.id) || !item.name
        || (!RARITIES.includes(item.rarity) && !('prize' in item)) || !isInt(item.price) || item.price < 0 || item.price > 100_000) throw new Error(`Lumi's closet has a bad or repeated accessory in ${slot.id}.`);
      if ('prize' in item && badGamePrize(item)) throw new Error(`Lumi's ${item.id} is a game prize: free, never sold or won from a capsule, and it says how to win it.`);
      seen.add(item.id);                                                            // remember it
    }
  }
  return data;                                                                      // validated
}

const CATALOG = loadCatalog();                                                      // items.json (throws at start if broken)
const HOUSE = loadHouse();                                                          // house.json
const CLOSET = loadCloset();                                                        // closet.json
const BATTLE = readJson('battle.json');                                             // battle.json (the battle module validates it)
const WEAR = Object.fromEntries(CLOSET.slots.flatMap((slot) => slot.items.map((item) => [item.id, { ...item, slot: slot.id }]))); // _WEAR: accessory id -> item + slot
const DECOR = Object.fromEntries(HOUSE.spots.flatMap((spot) => (spot.items || []).map((item) => [item.id, { ...item, spot: spot.id }]))); // _DECOR: piece id -> item + spot
const ITEMS = Object.fromEntries(KINDS.flatMap((kind) => CATALOG[kind].map((item) => [item.id, { ...item, kind }]))); // _ITEMS: snack/treat/toy id -> item + kind
const PRIZES = [                                                                    // _PRIZES: all a capsule can give, clothes then toys then decor
  ...Object.values(WEAR).filter((i) => 'rarity' in i),
  ...Object.values(ITEMS).filter((i) => 'rarity' in i),
  ...Object.values(DECOR).filter((i) => 'rarity' in i),
];
const BOXES = Object.values(DECOR).filter((p) => p.worn).sort((a, b) => a.box - b.box); // moving boxes in unpacking order
const SPOTS = Object.fromEntries(HOUSE.spots.map((s) => [s.id, s]));                // _SPOTS: spot id -> spot
const BASIC_MOVES = BATTLE.basics.map((m) => m.id);                                 // the two moves she is born with

/** Which shelf of her save keeps a prize: 'decor', 'toys' or 'closet' (erinne _shelf). */
function shelf(prize) {
  return 'spot' in prize ? 'decor' : prize.kind === 'toys' ? 'toys' : 'closet';     // by what it is
}

// ---------------------------------------------------------------------------------------------- hooks

let advanceHook = null;                                                             // pet module: decay + mending
const freshFieldHooks = [];                                                         // modules adding default fields
let settlePointsHook = null;                                                        // battle module: stat-point migration
let moveInRefundHook = null;                                                        // pet module: pays the move-in refund

/** Pet module: catch a pet up to `now` on every load (decay, finished naps, mending). fn(pet, now). */
function setAdvance(fn) { advanceHook = typeof fn === 'function' ? fn : null; }     // replace (null removes)
/** Any module: fields merged UNDER every save (older saves gain them). fn() -> object. */
function addFreshFields(fn) { if (typeof fn === 'function') freshFieldHooks.push(fn); } // add one
/** Battle module: erinne's settle_points for saves from before stat points. fn(pet). */
function setSettlePoints(fn) { settlePointsHook = typeof fn === 'function' ? fn : null; } // replace
/** Pet module: pay the move-in refund (sgc.pay(..., 'pet', 'movein', `lumi-move-in:${uid}`)). fn(uid, pet, worthNative). */
function setMoveInRefund(fn) { moveInRefundHook = typeof fn === 'function' ? fn : null; } // replace

/** erinne lumibattle.fresh_fields(): what a pet needs for battles. */
function battleFreshFields() {
  return {
    level: 1, exp: 0, skills: [], moves: [...BASIC_MOVES], mods: new Array(MOD_SLOT_COUNT).fill(null), mods_owned: [], // progress + kit
    potions: 0, faint_until: 0, wins: 0, losses: 0, wound: 0.0,                     // fight state
    stat_points: Object.fromEntries(STAT_KEYS.map((k) => [k, 0])), auto_stats: false, stat_reset_free: 0, // stat points
    used: {}, kit: {},                                                              // move usage + fight items
  };
}

// ---------------------------------------------------------------------------------------------- the save

/** erinne _fresh_estate(): her Lumi City things (house styles, yard pieces, her house's rooms). */
function freshEstate() {
  return { styles: [], yard: [], rooms: {} };                                       // all empty
}

/** erinne _fresh(now): a brand-new companion. */
function fresh(now = nowMs()) {
  const extra = Object.assign({}, ...freshFieldHooks.map((fn) => fn() || {}));      // other modules' defaults
  return {
    version: 2, hunger: START, energy: START, joy: START, updated: now, moments: 0, memory: null, // meters
    glow: 'rose', rest: 'auto', restUntil: 0, task: null, done: null, cooldowns: {}, // state
    inventory: {}, toys: [], boost: null, imported: false, low: {}, seen: now, house: {}, decor: [], // things
    outfit: {}, closet: [], storyteller: 'library', garden_reminders: true,         // wear + settings
    town_seen: true,                                                                // others see her in town
    room_mode: true,                                                                // walk-and-click rooms
    door: 'knock', blocked: [],                                                     // visitors to her flat (blocked: Discord id strings)
    name: 'Lumi', colour: null,                                                     // her name; her own colour (null: her glow's)
    moved_in: MOVE_IN, unpacked: 0, box_day: '',                                    // moving boxes
    home_town: null,                                                                // 'left' or 'right' once picked
    estate: freshEstate(),                                                          // Lumi City things
    ...battleFreshFields(),                                                         // battle fields
    ...extra,                                                                       // module defaults
  };
}

/** erinne estate_of(pet): her estate, made whole in place (old or broken saves get the missing parts). */
function estateOf(pet) {
  const estate = pet.estate && typeof pet.estate === 'object' && !Array.isArray(pet.estate) ? pet.estate : {}; // non-objects start again
  for (const [key, empty] of Object.entries(freshEstate())) {
    const ok = Array.isArray(empty) ? Array.isArray(estate[key]) : estate[key] && typeof estate[key] === 'object' && !Array.isArray(estate[key]); // same type?
    if (!ok) estate[key] = empty;                                                   // missing/mistyped part: empty
  }
  pet.estate = estate;                                                              // put back
  if (![null, 'left', 'right'].includes(pet.home_town === undefined ? null : pet.home_town)) pet.home_town = null; // not one of the two: unpicked
  return estate;                                                                    // the estate
}

// The stored JSON for a player, parsed; null when none or unreadable.
function readRow(uid) {
  const row = getDb().prepare('SELECT data FROM lumi_pets WHERE user_id = ?').get(String(uid)); // the save row
  if (!row) return null;                                                            // no Lumi yet
  try {
    const pet = JSON.parse(row.data);                                               // parse
    return pet && typeof pet === 'object' && !Array.isArray(pet) ? pet : null;      // must be an object
  } catch {
    return null;                                                                    // unreadable: as if none
  }
}

/** erinne _save: write the whole save (upsert). Call inside db.tx(). */
function save(uid, pet) {
  getDb().prepare(`
    INSERT INTO lumi_pets (user_id, data) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
  `).run(String(uid), JSON.stringify(pet));                                         // one JSON document
}

/** What the move-in refund is worth in erinne coins (bought pieces at price, capsule pieces at their rarity value). */
function moveInWorth(pet) {
  return [...new Set(Array.isArray(pet.decor) ? pet.decor : [])].filter((id) => id in DECOR) // each owned piece once
    .reduce((sum, id) => sum + (DECOR[id].price || ('rarity' in DECOR[id] ? CLOSET.values[DECOR[id].rarity] : 0)), 0); // its worth
}

/**
 * erinne load(): this player's pet, caught up to now and SAVED. Call inside db.tx().
 * Merges fresh defaults under the save (older saves gain new fields), runs erinne's migrations (stat points,
 * move-in), makes the estate whole, runs the advance hook (decay: pet module), marks a visit unless seen:false.
 */
function load(uid, { now = nowMs(), seen = true } = {}) {
  const saved = readRow(uid);                                                       // what's stored
  const pet = saved ? { ...fresh(now), ...saved } : fresh(now);                     // defaults under the save
  if (saved && !('stat_points' in saved) && settlePointsHook) settlePointsHook(pet); // pre-stat-point save (battle module)
  if (saved && saved.moved_in !== MOVE_IN) {                                        // pre-move-in save: the house starts again
    const worth = moveInWorth(pet);                                                 // what her old pieces were worth
    Object.assign(pet, { house: {}, decor: [], moved_in: MOVE_IN, unpacked: 0, box_day: '' }); // empty the house
    if (worth && moveInRefundHook) moveInRefundHook(String(uid), pet, worth);        // pet module pays it (ref lumi-move-in:<uid>)
  }
  estateOf(pet);                                                                    // pre-Lumi-City or broken estate
  if (Array.isArray(pet.blocked)) pet.blocked = pet.blocked.map(String).slice(0, BLOCKED_MAX); // ids as strings
  if (advanceHook) advanceHook(pet, now);                                           // decay etc. (pet module)
  else pet.updated = Math.max(Number(pet.updated) || 0, now);                       // without it: just move the clock
  if (seen) pet.seen = now;                                                         // a visit
  save(uid, pet);                                                                   // write it back
  return pet;                                                                       // the live save
}

/** erinne _peek: the save as stored, without catching up or counting a visit (null when no Lumi yet). Read-only. */
function peek(uid) {
  return readRow(uid);                                                              // parsed or null
}

/** Does this player have a Lumi yet? */
function exists(uid) {
  return Boolean(getDb().prepare('SELECT 1 FROM lumi_pets WHERE user_id = ?').get(String(uid))); // a row?
}

/**
 * erinne look(): how this player's Lumi looks, for drawing her anywhere else (arcade, town, parties, tables).
 * Read-only; someone without a Lumi gets a fresh one's look. Retired clothes are dropped.
 * @returns {{glow: string, outfit: object, colour: string|null, name: string}}
 */
function look(uid) {
  const pet = readRow(uid) || {};                                                   // their save or nothing
  const glow = GLOWS.includes(pet.glow) ? pet.glow : 'rose';                        // a retired colour falls back to rose
  const outfit = pet.outfit && typeof pet.outfit === 'object' && !Array.isArray(pet.outfit) ? pet.outfit : {}; // slot -> item
  const worn = Object.fromEntries(Object.entries(outfit).filter(([slot, item]) => typeof item === 'string' && WEAR[item] && WEAR[item].slot === slot)); // still valid only
  const colour = typeof pet.colour === 'string' && COLOUR_RE.test(pet.colour) ? pet.colour : null; // '#rrggbb' or null
  const name = typeof pet.name === 'string' && NAME_RE.test(pet.name) ? pet.name : 'Lumi'; // her name or 'Lumi'
  return { glow, outfit: worn, colour, name };                                      // what others draw
}

/** erinne town_seen(): may others see her in Lumi Town? (on unless turned off). Read-only. */
function townSeen(uid) {
  const pet = readRow(uid) || {};                                                   // their save
  return pet.town_seen !== false;                                                   // default on
}

/** erinne door(): her front door (knock/open/closed) and who she blocked. No Lumi yet: closed. Read-only. */
function door(uid) {
  const pet = readRow(uid);                                                         // their save
  if (!pet) return { door: 'closed', blocked: [] };                                 // no flat to visit
  const blocked = (Array.isArray(pet.blocked) ? pet.blocked : []).map(String);      // ids as strings
  return { door: DOORS.includes(pet.door) ? pet.door : DOORS[0], blocked };         // knock by default
}

/** erinne _takes(spot): whose pieces a spot takes (its own, or the spot it shares them with). */
function takes(spotId) {
  return (SPOTS[spotId] && SPOTS[spotId].same_as) || spotId;                        // shared or own
}

/**
 * erinne placed(pet): what stands in every spot - her choice where still valid, a paint colour on a paintable
 * spot, else the spot's free first piece (unless that's a worn piece still in its box). Shared spots left
 * unchosen are left out (the page shows the bedroom's there).
 */
function placed(pet) {
  const house = pet.house && typeof pet.house === 'object' && !Array.isArray(pet.house) ? pet.house : {}; // her choices
  const out = {};                                                                   // spot -> piece or colour
  for (const spot of HOUSE.spots) {
    const chosen = house[spot.id];                                                  // what she picked
    const paintable = SPOTS[takes(spot.id)].paintable;                              // may it hold paint?
    if (typeof chosen === 'string' && paintable && COLOUR_PAINT_RE.test(chosen)) out[spot.id] = chosen; // paint
    else if (DECOR[chosen] && DECOR[chosen].spot === takes(spot.id)) out[spot.id] = chosen; // a valid piece
    else if ('same_as' in spot) continue;                                           // follows the bedroom's
    else if (!spot.items[0].worn) out[spot.id] = spot.items[0].id;                  // the free default
  }
  return out;                                                                       // what stands where
}

/** erinne boxes(): her moving boxes for the page (one may be opened per LA day). */
function boxes(pet) {
  const left = BOXES.slice(Number(pet.unpacked) || 0);                              // still packed
  return { left: left.length, total: BOXES.length, next: left.length ? left[0].name : null, ready: left.length > 0 && pet.box_day !== dayKey() }; // erinne's shape
}

/** erinne _guestbook(): her guestbook lines, oldest first, malformed ones left out. */
function guestbook(pet) {
  const keep = ['id', 'uid', 'name', 'lumi', 'text', 'at'];                         // required fields
  return (Array.isArray(pet.guestbook) ? pet.guestbook : []).filter((e) => e && typeof e === 'object' && keep.every((k) => k in e)); // valid lines
}

module.exports = {
  // constants
  GAME, HOUR, START, KINDS, BOOSTS, RARITIES, PRIZE_GAMES, GLOWS, DOORS, HOMES, GUESTBOOK_MAX, BLOCKED_MAX,
  MOVE_IN, NAME_MAX, NAME_RE, COLOUR_RE, COLOUR_PAINT_RE, STAT_KEYS, MOD_SLOT_COUNT, DATA,
  PetError,                       // refusal with a safe message
  // data (validated at load) and lookup tables (erinne's _WEAR, _DECOR, _ITEMS, _PRIZES, BOXES, _SPOTS)
  CATALOG, HOUSE, CLOSET, BATTLE, WEAR, DECOR, ITEMS, PRIZES, BOXES, SPOTS, BASIC_MOVES,
  loadCatalog, loadHouse, loadCloset, readJson, // loaders (validate a data object or the file)
  shelf,                          // prize -> 'decor' | 'toys' | 'closet'
  // hooks
  setAdvance, addFreshFields, setSettlePoints, setMoveInRefund,
  // the save
  fresh, freshEstate, battleFreshFields, estateOf, load, save, peek, exists, look, townSeen, door,
  takes, placed, boxes, guestbook, moveInWorth,
};
