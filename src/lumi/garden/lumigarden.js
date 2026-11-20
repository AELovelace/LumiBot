'use strict';

/**
 * Lumi Pet's Stardust Garden, ported from erinne mnemerynne/lumigarden.py (commit 0ddc466): a little flower farm that
 * feeds a powder press. Plots hold flowers; trimmed flowers give starpowder; the press squeezes powder into coins
 * (each further band of coins in a day costs twice the powder of the band before). Helpers, abilities, watering,
 * fertilizing, gifts, decorations, the Seedling Capsule and moonrise are all here, exactly as erinne.
 *
 * LumiBot changes (CONTRACT.md):
 *  - Coins are SadGirlCoin through sgc.js (call everything that pays or charges INSIDE db.tx()):
 *      press:  sgc.pay(..., 'garden', 'press', 'lumi-garden:<uid>:<coins ever made>')       (erinne lumigarden.py:272)
 *      token:  sgc.pay(..., 'garden', 'token', 'lumi-garden-token:<uid>:<now>')             (erinne lumigarden.py:335)
 *      plot:   sgc.spend(..., 'garden', 'shop', { key: 'plot' })                            (erinne lumigarden.py:440)
 *      seed:   sgc.spend(..., 'garden', 'shop', { key: <flower id> })                       (erinne lumigarden.py:484)
 *  - The press still counts erinne's native "press coins" (its doubling bands are game logic). Native coins that
 *    don't yet make a whole SGC wait in state.unpaid and go out with the next squeeze, so nothing is lost to rounding.
 *  - Notes say `coins` = SGC actually paid now, `made` = press coins squeezed, plus `owed` / `capped` when the bank
 *    was closed or today's garden cap bit.
 *  - `who` is a Discord id string or { id, name } (ctx.user). Times are whole ms. `rng` has random() and randrange(n).
 *  - The battle numbers the garden reads (skill tree nodes, basic moves, mods, bonuses) come straight from the pet
 *    save's battle.json (save.BATTLE), so this module does not wait on the battle module.
 * Like erinne, this module never loads or saves a PET: the pet module hands it the pet and saves it afterwards.
 */

const crypto = require('node:crypto');                                           // the secure default rng
const fs = require('node:fs');                                                   // read garden.json
const path = require('node:path');                                               // its path
const { getDb, dayKey } = require('../db');                                      // the DB + the LA day
const sgc = require('../sgc');                                                   // the only door to coins
const tuning = require('../tuning');                                             // payout scaling (for the press carry)
const { LumiError, notEnoughSGC } = require('../errors');                         // refusals
const save = require('../pet/save');                                             // battle.json (save.BATTLE)
const { person } = require('../minis/who');                                      // who -> { id, name }

const GAME = 'garden';                                                           // tuning / ledger id (erinne "lumi-pet")
const MIN = 60_000;                                                              // one minute in ms
const TREES = ['fighter', 'thief', 'monk', 'mage', 'cleric', 'paladin'];          // the six class trees
const SKILL_MULT = 1.25;                                                         // each learned skill in a tree lifts its helper by this
const LEVEL_BONUS = 0.02;                                                        // each level after the first adds this to everything
const PRESS_WINDOW = 10_000;                                                     // presses are counted over at most this long
const PRESS_SPARE = 3;                                                           // a few presses of slack
const LUCKY_CAP = 0.5;                                                           // the Thief can only make so many presses lucky
const GIFT_CAP = 0.25;                                                           // and gifts only so common
const MAX_GARDENS = 99;                                                          // most gardens
const MAX_COPIES = 99;                                                           // of any one decoration in the store
const BRANCHES = ['root', 'quick', 'slow', 'perennial', 'crown'];                // where a flower sits on the tree page
const SHAPES = ['daisy', 'bell', 'puff', 'star', 'poppy', 'spike', 'clover', 'trumpet', 'mushroom', 'tulip', 'sun', 'hearts', 'cactus', 'rose',
  'lotus', 'orchid', 'cluster', 'lily', 'iris', 'fern', 'wisteria'];              // how a flower is drawn (garden-art.js)
const RARITIES = ['common', 'rare', 'epic', 'legendary'];                        // capsule rarities, in order
const LEGACY_DECOR = {                                                           // the first seven cosmetics became decorations
  'picket-fence': 'fence-0-snowy', 'stone-path': 'path-0-snowy', 'glow-borders': 'edging-0-snowy', 'garden-gnome': 'statue-0-rosy',
  'scarecrow-lumi': 'scarecrow-0-golden', 'golden-press': 'press-0-golden', 'firefly-lamps': 'lamps-0-golden',
};
const ID_RE = /^[a-z0-9-]{1,40}$/u;                                              // catalog ids
const COLOUR_RE = /^#[0-9a-f]{6}$/u;                                             // '#rrggbb'

// ---------------------------------------------------------------------------------------------- battle numbers

const MAX_LEVEL = 50;                                                            // lumibattle.MAX_LEVEL
const BONUS_KEYS = ['attack', 'defense', 'magic', 'ward', 'speed', 'hp', 'mp', 'crit', 'dodge', 'coins']; // lumibattle.BONUS_KEYS
const POTION_CAP = 10;                                                           // lumibattle.POTION_CAP
const MOD_SLOT_LEVELS = [10, 15, 25, 35, 45];                                    // lumibattle.MOD_SLOTS: the level each slot opens at
const _NODES = Object.fromEntries((save.BATTLE.trees || []).flatMap((tree) => (tree.nodes || []).map((node, index) => [node.id, { ...node, tree: tree.id, index }]))); // lumibattle._NODES
const _BASICS = Object.fromEntries((save.BATTLE.basics || []).map((move) => [move.id, move])); // lumibattle._BASICS
const _MODS = Object.fromEntries((save.BATTLE.mods || []).map((mod) => [mod.id, mod])); // lumibattle._MODS

/** erinne lumibattle.bonuses(pet): every percentage her passives and fitted (unlocked) mods add up to. */
function bonuses(pet) {
  const total = Object.fromEntries(BONUS_KEYS.map((key) => [key, 0]));           // all zero
  const skills = Array.isArray(pet.skills) ? pet.skills : [];                    // learned skills
  const mods = Array.isArray(pet.mods) ? pet.mods : [];                          // fitted mods
  const sources = [
    ...skills.filter((s) => s in _NODES).map((s) => _NODES[s].bonus),            // passives
    ...mods.map((m, i) => (m in _MODS && i < MOD_SLOT_LEVELS.length && pet.level >= MOD_SLOT_LEVELS[i] ? _MODS[m].bonus : null)), // open slots only
  ];
  for (const bonus of sources.filter(Boolean)) {
    for (const [key, amount] of Object.entries(bonus)) total[key] = (total[key] || 0) + amount; // add each percentage
  }
  return total;                                                                  // { attack: 6, ... }
}

// ---------------------------------------------------------------------------------------------- small helpers

class GardenError extends LumiError {                                            // erinne GardenError: refused, safe to show
  constructor(message) {
    super(400, 'refused', message);                                              // a 400 if it ever reaches the router as-is
    this.name = 'GardenError';                                                   // for logs
  }
}

const whole = (v, low, high) => Number.isInteger(v) && v >= low && v <= high;    // erinne _whole
const within = (v, low, high) => typeof v === 'number' && v >= low && v <= high; // erinne `low <= v <= high` on a number
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);        // own key only
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);                  // list/tuple equality

/** Python's round(): halves go to the even neighbour (round(2.5) == 2). */
function pyRound(x) {
  const f = Math.floor(x);                                                       // the floor
  const d = x - f;                                                               // the fraction
  if (d > 0.5) return f + 1;                                                     // more than half: up
  if (d < 0.5) return f;                                                         // less than half: down
  return f % 2 === 0 ? f : f + 1;                                                // exactly half: to even
}

/** The secure default rng (erinne random.SystemRandom). */
const SECURE = {
  random: () => crypto.randomInt(0, 2 ** 47) / 2 ** 47,                          // [0, 1) (randomInt spans < 2^48)
  randrange: (n) => crypto.randomInt(0, n),                                      // 0..n-1
};

// ---------------------------------------------------------------------------------------------- the catalog

/**
 * erinne load_catalog: garden.json, validated so a bad entry stops the server at start. `source`: a data object, a
 * path, or nothing (src/lumi/data/garden.json). Throws Error("Lumi's garden: ...") on anything wrong.
 */
function loadCatalog(source) {
  const data = source && typeof source === 'object' ? source                     // a data object (tests)
    : JSON.parse(fs.readFileSync(source || path.join(save.DATA, 'garden.json'), 'utf8')); // or the file
  const bad = (what) => new Error(`Lumi's garden: ${what}`);                     // the error shape

  const plots = data.plots;                                                      // plot rules
  const press = data.press;                                                      // press rules
  if (!plots || typeof plots !== 'object' || !whole(plots.start, 1, 16) || !whole(plots.max, plots.start, 16)
    || !whole(plots.price, 1, 100_000) || !within(plots.growth === undefined ? 0 : plots.growth, 1, 3)) {
    throw bad('plots need start, max (16 at most), price and growth.');
  }
  if (!press || typeof press !== 'object' || ['powder_per_coin', 'band', 'tap', 'max_rate', 'lucky', 'lucky_chance', 'away_hours', 'away_kept', 'present_seconds']
    .some((key) => !whole(press[key], 1, 100_000))) {
    throw bad('the press needs whole numbers for every setting.');
  }
  if (!within(data.fresh === undefined ? 0 : data.fresh, 1, 10) || !whole(data.reminder_minutes, 1, 1440)) {
    throw bad('fresh and reminder_minutes are missing or out of range.');
  }
  const seen = new Set();                                                        // ids used so far
  const named = (thing, what) => {                                               // erinne named()
    if (!thing || typeof thing !== 'object' || !ID_RE.test(String(thing.id === undefined ? '' : thing.id)) || seen.has(thing.id) || !thing.name) {
      throw bad(`a ${what} has a bad or repeated id, or no name.`);
    }
    seen.add(thing.id);                                                          // remember it
  };

  const flowers = data.flowers;                                                  // the ladder
  if (!Array.isArray(flowers) || !flowers.length) throw bad('there are no flowers.');
  for (const flower of flowers) {
    named(flower, 'flower');                                                     // id + name
    if (!['cut', 'perennial'].includes(flower.sort) || !whole(flower.minutes, 1, 2880) || !whole(flower.powder, 1, 10_000_000)
      || !whole(flower.coins, 0, 100_000) || !whole(flower.stardust, 0, 100_000_000) || (flower.coins && flower.stardust)
      || !whole(flower.level, 1, MAX_LEVEL) || !whole(flower.needs, 0, 10 ** 12)
      || !COLOUR_RE.test(String(flower.colour)) || !COLOUR_RE.test(String(flower.heart)) || !whole(flower.petals, 3, 16)
      || !SHAPES.includes(flower.shape) || !within(flower.size === undefined ? 0 : flower.size, 0.5, 2)) {
      throw bad(`${flower.id} is missing something, or has both a coin and a stardust price.`);
    }
  }
  const first = flowers[0];                                                      // the starter flower
  if (first.coins || first.stardust || first.needs || first.level !== 1 || !same(first.after, [])) {
    throw bad('the first flower must be free and need no other, so a new garden always has something to plant.');
  }
  const earlier = new Set();                                                     // flowers listed so far
  for (const flower of flowers) {                                                // the tree has no loops
    const after = flower.after;                                                  // what it opens from
    if (!BRANCHES.includes(flower.branch) || !Array.isArray(after) || (earlier.size && !after.length)
      || after.some((one) => typeof one !== 'string' || !earlier.has(one)) || new Set(after).size !== after.length) {
      throw bad(`${flower.id} needs a branch, and opens only from flowers listed before it.`);
    }
    earlier.add(flower.id);                                                      // now it may be opened from
  }
  const needs = flowers.map((f) => f.needs);                                     // unlock gates
  if (!same(needs, [...needs].sort((a, b) => a - b))) throw bad('flowers must be listed in the order they unlock.');
  const helpers = data.helpers;                                                  // one per tree
  if (!Array.isArray(helpers) || !same(helpers.filter((h) => h && typeof h === 'object').map((h) => h.id), TREES)) {
    throw bad('there must be one helper per class tree, in order.');
  }
  for (const helper of helpers) {
    named(helper, 'helper');                                                     // id + name
    if (!helper.about || !whole(helper.cost, 1, 10 ** 9) || !within(helper.growth === undefined ? 0 : helper.growth, 1.05, 3)
      || !Array.isArray(helper.mods) || helper.mods.some((key) => !BONUS_KEYS.includes(key))) {
      throw bad(`helper ${helper.id} is missing something.`);
    }
  }
  const abilities = data.abilities;                                              // one per tree
  if (!abilities || typeof abilities !== 'object' || !same(Object.keys(abilities), TREES) || Object.values(abilities).some(
    (a) => !a || typeof a !== 'object' || !a.name || !a.about || !whole(a.seconds, 0, 3600) || !whole(a.cooldown, 10, 86_400))) {
    throw bad('there must be one ability per class tree, with name, about, seconds and cooldown.');
  }
  if (new Set(flowers.map((f) => `${f.shape}|${f.petals}|${f.colour}`)).size !== flowers.length) {
    throw bad('two flowers would look the same: each needs its own shape, petals or colour.');
  }
  if (!Array.isArray(data.upgrades) || !data.upgrades.length) throw bad('there are no upgrades.');
  for (const thing of data.upgrades) {
    named(thing, 'upgrade');                                                     // id + name
    if (!thing.about || !whole(thing.max, 1, 10 ** 12)) throw bad(`${thing.id} needs words and a max.`);
  }
  const decor = data.decor;                                                      // decorations
  const capsule = decor && typeof decor === 'object' ? decor.capsule : null;     // the Seedling Capsule
  if (!capsule || typeof capsule !== 'object' || !capsule.name || !whole(capsule.price, 1, 10 ** 9)
    || !capsule.odds || typeof capsule.odds !== 'object' || !same(Object.keys(capsule.odds), RARITIES)
    || Object.values(capsule.odds).reduce((a, b) => a + b, 0) !== 100 || Object.values(capsule.odds).some((v) => !whole(v, 1, 100))
    || !capsule.sell || typeof capsule.sell !== 'object' || !same(Object.keys(capsule.sell), RARITIES)
    || Object.values(capsule.sell).some((v) => !whole(v, 1, capsule.price * 100))) {
    throw bad('the capsule needs a name, a price, odds that add up to 100 and a selling price for each rarity.');
  }
  if (capsule.sell.common >= capsule.price) throw bad('a common capsule prize must sell for less than a capsule costs.');
  if (!Array.isArray(decor.slots) || !decor.slots.length) throw bad('there are no decoration slots.');
  for (const slot of decor.slots) {
    named(slot, 'decoration slot');                                              // id + name
    const things = slot.things;                                                  // the shapes it can hold
    if (!Array.isArray(things) || !things.length || !Array.isArray(slot.items) || !slot.items.length) {
      throw bad(`slot ${slot.id} needs its things and its items.`);
    }
    for (const item of slot.items) {
      named(item, 'decoration');                                                 // id + name
      const sold = item.rarity === 'shop';                                       // bought with starpowder?
      if (!whole(item.thing, 0, things.length - 1) || !COLOUR_RE.test(String(item.a)) || !COLOUR_RE.test(String(item.b))
        || (!sold && !RARITIES.includes(item.rarity)) || !whole(item.stardust, sold ? 1 : 0, 10 ** 12) || (item.stardust && !sold)) {
        throw bad(`decoration ${item.id} is missing something: sold ones have a price, capsule ones a rarity and none.`);
      }
    }
  }
  if (RARITIES.some((rarity) => !decor.slots.some((slot) => slot.items.some((item) => item.rarity === rarity)))) {
    throw bad('the capsule needs at least one prize of every rarity.');
  }
  const { water, feed, moonrise: moon, gifts } = data;                           // minigames, moonrise, gifts
  if (!water || typeof water !== 'object' || !whole(water.rounds, 1, 12) || !whole(water.share, 1, 20) || !whole(water.cooldown, 10, 86_400)
    || water.rounds * water.share > 90) {
    throw bad("watering needs rounds, share and cooldown, and can't skip a whole flower.");
  }
  if (!feed || typeof feed !== 'object' || ['seconds', 'per', 'minutes', 'max', 'cooldown'].some((key) => !whole(feed[key], 1, 86_400))) {
    throw bad('fertilizing needs seconds, per, minutes, max and cooldown.');
  }
  if (!moon || typeof moon !== 'object' || !whole(moon.needs, 1, 10 ** 15) || !within(moon.growth === undefined ? 0 : moon.growth, 1, 10)) {
    throw bad('moonrise needs how much powder it asks for, and its growth.');
  }
  if (!gifts || typeof gifts !== 'object' || ['chance', 'burst', 'snack', 'potion', 'token', 'token_days', 'token_coins'].some((key) => !whole(gifts[key], 0, 100_000))
    || gifts.burst < 1) {
    throw bad('gifts need whole numbers, and a burst of powder must be possible.');
  }
  return data;                                                                   // validated
}

const CATALOG = loadCatalog();                                                   // garden.json (throws at start if broken)
const _FLOWERS = Object.fromEntries(CATALOG.flowers.map((flower, rung) => [flower.id, { ...flower, rung }])); // id -> flower + ladder rung
const _HELPERS = Object.fromEntries(CATALOG.helpers.map((helper) => [helper.id, helper])); // id -> helper
const _DECOR = Object.fromEntries(CATALOG.decor.slots.flatMap((slot) => slot.items.map((item) => [item.id, { ...item, slot: slot.id }]))); // id -> decoration + slot
const _PRIZES = Object.fromEntries(RARITIES.map((rarity) => [rarity, Object.values(_DECOR).filter((item) => item.rarity === rarity)])); // what the capsule can give
const _UPGRADES = Object.fromEntries(CATALOG.upgrades.map((thing) => [thing.id, thing])); // id -> upgrade

// ---------------------------------------------------------------------------------------------- the saved garden

/** An empty plot. */
function _empty() {
  return { flower: null, ready_at: 0, grow: 0, last: null };                     // nothing growing
}

/** A brand-new garden: a few empty plots, and only the first flower to plant. */
function _starter() {
  return { plots: Array.from({ length: CATALOG.plots.start }, _empty), unlocked: [CATALOG.flowers[0].id], given: 0.0, decor: {} }; // starter garden
}

/** erinne fresh(now): a whole new garden save. (unpaid: LumiBot's press coins waiting to make a whole SGC.) */
function fresh(now) {
  return {
    gardens: [_starter()], at: 0, powder: 0.0, squeezed: 0.0, day: '', coins_today: 0, paid: 0, earned: 0.0, unpaid: 0, // the press
    helpers: Object.fromEntries(TREES.map((tree) => [tree, 0])), decor: {}, upgrades: {}, moonrises: 0, cooldowns: {}, effects: {}, // progress
    water: null, feed: null, tick: now, press_at: now, seen: now, token_at: 0, away: null,                       // clocks
  };
}

/** erinne current(): this player's garden as saved (a new one if they never opened it). Not caught up: see advance. */
function current(uid, now) {
  const row = getDb().prepare('SELECT state FROM lumi_gardens WHERE user_id = ?').get(String(uid)); // the saved row
  let saved = null;                                                              // parsed state
  if (row) { try { saved = JSON.parse(row.state); } catch { saved = null; } }    // unreadable: start again
  const state = saved && typeof saved === 'object' ? { ...fresh(now), ...saved } : fresh(now); // defaults under the save
  for (const garden of state.gardens) {                                          // gardens saved before decorations had slots
    if (!garden.decor || typeof garden.decor !== 'object') garden.decor = {};    // setdefault
    garden.decor = Object.fromEntries(Object.entries(garden.decor).filter(([slot, item]) => (_DECOR[item] || {}).slot === slot)); // drop retired things
  }
  const cosmetics = Array.isArray(state.cosmetics) ? state.cosmetics : [];       // the first seven cosmetics
  delete state.cosmetics;                                                        // state.pop("cosmetics")
  for (const old of cosmetics) {
    const fresher = LEGACY_DECOR[old];                                           // what it became
    if (fresher) {
      state.decor[fresher] = (state.decor[fresher] || 0) + 1;                    // keep it
      const slot = _DECOR[fresher].slot;                                         // where it goes
      if (!has(state.gardens[0].decor, slot)) state.gardens[0].decor[slot] = fresher; // and put it out
    }
  }
  state.decor = Object.fromEntries(Object.entries(state.decor).filter(([item, count]) => item in _DECOR && count > 0)); // only real things
  return state;                                                                  // the live garden
}

/** erinne save(): write the garden (upsert). Call inside db.tx(). */
function saveGarden(uid, state) {
  getDb().prepare(`
    INSERT INTO lumi_gardens (user_id, state) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = datetime('now')
  `).run(String(uid), JSON.stringify(state));                                    // one JSON document
}

// ---------------------------------------------------------------------------------------------- every number

/** erinne _build: how much Lumi's own build lifts a helper (skills learned in its tree, and her bonus percentages). */
function _build(pet, helper) {
  const skills = Array.isArray(pet.skills) ? pet.skills : [];                    // learned skills
  const learned = skills.filter((skill) => (_NODES[skill] || {}).tree === helper.id).length; // in this tree
  const extra = bonuses(pet);                                                    // her percentages
  return SKILL_MULT ** learned * (1 + helper.mods.reduce((sum, key) => sum + extra[key], 0) / 100); // the lift
}

/** erinne rates(): the garden's numbers right now. */
function rates(state, pet, now) {
  const press = CATALOG.press;                                                   // press rules
  const level = state.helpers;                                                   // helper levels
  const ups = state.upgrades;                                                    // permanent upgrades
  const effects = state.effects;                                                 // running abilities
  const up = (key) => ups[key] || 0;                                             // ups.get(key, 0)
  const lift = Object.fromEntries(TREES.map((tree) => [tree, _build(pet, _HELPERS[tree])])); // each helper's lift
  const double = (effects.double || 0) > now ? 2 : 1;                            // Paladin's blessing
  const everything = (1 + 0.05 * level.paladin * lift.paladin) * (1 + LEVEL_BONUS * (pet.level - 1)); // everything lifted
  const strong = 1 + 0.25 * up('strong-press');                                  // Strong Press upgrade
  const frenzy = (effects.frenzy || 0) > now ? (effects.frenzy_by === undefined ? 1 : effects.frenzy_by) : 1; // Fighter's frenzy
  return {
    tap: press.tap * (1 + 0.5 * level.fighter) * lift.fighter * everything * strong * frenzy * double, // powder a press
    lucky: (effects.lucky || 0) > now ? 1.0 : Math.min(LUCKY_CAP, (press.lucky_chance + level.thief * lift.thief) / 100), // lucky chance
    lucky_by: press.lucky,                                                       // a lucky press counts this many times
    idle: 0.2 * level.monk * lift.monk * everything * strong,                    // powder a second, before doubling
    double,                                                                      // 1 or 2
    growth: Math.max(0.4, 1 / (1 + 0.03 * level.mage * lift.mage)) * 0.95 ** up('rich-soil'), // share of each flower's time
    fresh: CATALOG.fresh * (1 + 0.1 * level.cleric * lift.cleric) * (1 + 0.25 * up('long-bloom')), // how long a flower stays fresh
    kept: Math.min(1.0, press.away_kept / 100 + 0.03 * level.cleric * lift.cleric), // share kept while away
    away_ms: (press.away_hours + up('night-shift')) * 60 * MIN,                  // longest counted absence
    yield: everything * double,                                                  // harvest multiplier
    cool: 0.9 ** up('quick-paws'),                                               // cooldown multiplier
    gift: Math.min(GIFT_CAP, (CATALOG.gifts.chance + 0.3 * level.thief * lift.thief + up('lucky-clover')) / 100), // gift chance
  };
}

/** erinne price(): powder for the next press coin (each further band in a day costs twice the band before). */
function price(state) {
  const press = CATALOG.press;                                                   // press rules
  return press.powder_per_coin * 2.0 ** Math.floor(state.coins_today / press.band); // doubling bands
}

// Pay the press coins waiting in state.unpaid, as whole SGC: the smallest native amount that makes the same SGC goes
// out (sgc.pay scales it), the rest keeps waiting. Ref: erinne's 'lumi-garden:<uid>:<coins ever made>'.
function _payPress(p, state) {
  const total = state.unpaid;                                                    // press coins waiting
  const sgcNow = total > 0 ? tuning.scalePayout(GAME, 'press', total) : 0;       // SGC they make
  if (sgcNow < 1) return { paid: 0, owed: 0, capped: false };                    // not a whole SGC yet: keep waiting
  let low = 1;                                                                   // binary search: smallest native
  let high = total;                                                              // that still makes `sgcNow` SGC
  while (low < high) {
    const mid = Math.floor((low + high) / 2);                                    // halfway
    if (tuning.scalePayout(GAME, 'press', mid) >= sgcNow) high = mid; else low = mid + 1; // narrow it
  }
  state.unpaid = total - low;                                                    // the rest keeps waiting
  return sgc.pay(p.id, p.name, low, GAME, 'press', `lumi-garden:${p.id}:${state.paid}`); // bank -> player (capped, pay-once)
}

/**
 * erinne _squeeze: press up to `powder` from the hopper (a lucky press counts `by` times over) and pay any whole
 * coins it makes. Returns { used, made (press coins), paid (SGC), owed, capped }.
 */
function _squeeze(who, state, powder, by = 1.0) {
  const today = dayKey();                                                        // the LA day
  if (state.day !== today) { state.day = today; state.coins_today = 0; }         // a new day: the press is quick again
  const used = Math.max(0.0, Math.min(state.powder, powder));                    // what comes out of the hopper
  state.powder -= used;                                                          // take it
  state.squeezed += used * by;                                                   // onto the plate
  let made = 0;                                                                  // press coins made
  while (state.squeezed >= price(state) && made < 100_000) {
    state.squeezed -= price(state);                                              // one coin's worth
    state.coins_today += 1;                                                      // counts toward the bands
    made += 1;                                                                   // one more
  }
  let result = { paid: 0, owed: 0, capped: false };                              // nothing paid yet
  if (made) {
    state.paid += made;                                                          // coins ever made (names the ref)
    state.unpaid = (state.unpaid || 0) + made;                                   // waiting to become SGC
    result = _payPress(person(who), state);                                      // pay whole SGC
  }
  return { used, made, paid: result.paid, owed: result.owed, capped: result.capped }; // what happened
}

// Copy a squeeze's money onto a note: coins (SGC paid), made, and owed/capped only when they happened.
function _money(note, ...squeezes) {
  note.coins = squeezes.reduce((sum, s) => sum + s.paid, 0);                     // SGC paid now
  note.made = squeezes.reduce((sum, s) => sum + s.made, 0);                      // press coins squeezed
  const owed = squeezes.reduce((sum, s) => sum + s.owed, 0);                     // SGC owed by a closed bank
  if (owed) note.owed = owed;                                                    // say so
  if (squeezes.some((s) => s.capped)) note.capped = true;                        // today's cap bit
  return note;                                                                   // the note
}

/**
 * erinne advance(): catch the press up to now. A short gap (page open) squeezes at the full rate; a longer one is
 * time away, paid at the kept share and only up to the away limit. Call inside db.tx() (it may pay).
 */
function advance(who, state, pet, now) {
  const start = state.tick;                                                      // last caught up
  now = Math.max(now, state.tick);                                               // never backwards
  const gap = now - start;                                                       // how long since
  if (gap) {
    const numbers = rates(state, pet, now);                                      // the numbers now
    const present = CATALOG.press.present_seconds * 1000;                        // "still looking" window
    let counted = gap <= present ? gap : present + Math.min(gap - present, numbers.away_ms) * numbers.kept; // away is kept in part
    counted += Math.max(0, Math.min(now, state.effects.double || 0) - start);    // the doubled stretch counts twice
    const squeezed = _squeeze(who, state, numbers.idle * counted / 1000);        // the helpers' squeezing
    if (gap > present) state.away = _money({ ms: gap, powder: squeezed.used }, squeezed); // for the page to say once
  }
  state.tick = now;                                                              // caught up
  if (state.feed && now > state.feed.until + MIN) state.feed = null;             // a fertilizer round nobody finished
}

// ---------------------------------------------------------------------------------------------- flowers

/** erinne _stage: empty, growing, ready or overgrown. */
function _stage(plot, numbers, now) {
  if (!plot.flower) return 'empty';                                              // nothing there
  if (now < plot.ready_at) return 'growing';                                     // not yet
  return now > plot.ready_at + numbers.fresh * plot.grow ? 'overgrown' : 'ready'; // fresh for `fresh` x its growing time
}

/** erinne _growing: every flower still on its way, in every garden. */
function _growing(state, now) {
  return state.gardens.flatMap((garden) => garden.plots.filter((plot) => plot.flower && plot.ready_at > now)); // growing plots
}

/** erinne _plant. */
function _plant(plot, flower, numbers, now) {
  const grow = Math.max(1000, Math.trunc(flower.minutes * MIN * numbers.growth)); // its growing time
  Object.assign(plot, { flower: flower.id, grow, ready_at: now + grow, last: flower.id }); // in it goes
}

/** erinne _trim: harvest one ready flower; returns the powder it gave. */
function _trim(state, garden, plot, numbers, now) {
  const flower = _FLOWERS[plot.flower];                                          // what it is
  const got = flower.powder * numbers.yield * (_stage(plot, numbers, now) === 'overgrown' ? 0.5 : 1); // half if overgrown
  state.powder += got;                                                           // into the hopper
  state.earned += got;                                                           // lifetime
  garden.given += got;                                                           // this garden's ladder
  if (flower.sort === 'cut') Object.assign(plot, { flower: null, ready_at: 0, grow: 0 }); // a cut flower leaves
  else _plant(plot, flower, numbers, now);                                       // a perennial grows back
  return got;                                                                    // powder given
}

/** erinne _gift: something extra turned up in a harvest (token, potion, snack or a burst of powder). */
function _gift(who, state, pet, got, now, rng, pantry, held) {
  const odds = CATALOG.gifts;                                                    // gift table
  let roll = rng.randrange(odds.burst + odds.snack + odds.potion + odds.token);  // one roll
  if (roll < odds.token && now - state.token_at >= odds.token_days * 24 * 60 * MIN) {
    state.token_at = now;                                                        // not again for a week
    const p = person(who);                                                       // who to pay
    const paid = sgc.pay(p.id, p.name, odds.token_coins, GAME, 'token', `lumi-garden-token:${p.id}:${now}`); // erinne ref
    const note = { kind: 'token', coins: paid.paid };                            // SGC paid
    if (paid.owed) note.owed = paid.owed;                                        // bank closed: saved
    if (paid.capped) note.capped = true;                                         // today's cap
    return note;                                                                 // the gift
  }
  roll -= odds.token;                                                            // next band
  if (roll >= 0 && roll < odds.potion && (pet.potions || 0) < POTION_CAP) {
    pet.potions = (pet.potions || 0) + 1;                                        // a potion
    return { kind: 'potion' };
  }
  roll -= odds.potion;                                                           // next band
  if (!pet.inventory || typeof pet.inventory !== 'object') pet.inventory = {};   // always a bag
  const room = pantry.filter((snack) => (pet.inventory[snack] || 0) < held);     // snacks with room
  if (roll >= 0 && roll < odds.snack && room.length) {
    const snack = room[rng.randrange(room.length)];                              // which snack
    pet.inventory[snack] = (pet.inventory[snack] || 0) + 1;                      // into her bag
    return { kind: 'snack', item: snack };
  }
  const burst = got * 5;                                                         // otherwise: a burst of powder
  state.powder += burst;                                                         // into the hopper
  state.earned += burst;                                                         // lifetime
  return { kind: 'burst', powder: burst };
}

/** erinne _skip: move every growing flower forward by by(plot) ms; returns how many moved. */
function _skip(state, now, by) {
  let moved = 0;                                                                 // count
  for (const plot of _growing(state, now)) {
    plot.ready_at = Math.max(now, plot.ready_at - Math.trunc(by(plot)));         // sooner, never in the past
    moved += 1;                                                                  // one more
  }
  return moved;                                                                  // how many
}

/** erinne spare(): how many of a decoration sit in the store (owned, less one per garden it stands in). */
function spare(state, item) {
  return (state.decor[item] || 0) - state.gardens.filter((garden) => Object.values(garden.decor).includes(item)).length; // owned - placed
}

/** erinne worth(): what a spare decoration sells for, in starpowder. */
function worth(item) {
  return item.rarity === 'shop' ? Math.floor(item.stardust / 2) : CATALOG.decor.capsule.sell[item.rarity]; // half price, or by rarity
}

/** erinne opens(): may this garden unlock this kind now, as far as the tree goes? */
function opens(garden, flower) {
  return !garden.unlocked.includes(flower.id) && flower.after.some((one) => garden.unlocked.includes(one)); // not yet, and a parent is
}

/** erinne moonrise_needs(). */
function moonriseNeeds(state) {
  return CATALOG.moonrise.needs * CATALOG.moonrise.growth ** state.moonrises;    // grows with each moonrise
}

/** erinne _cool: refuse something still cooling down, then start its cooldown. */
function _cool(state, key, seconds, numbers, now) {
  const left = (state.cooldowns[key] || 0) - now;                                // ms still to wait
  if (left > 0) throw new GardenError(`Not yet: ready again in ${Math.max(1, pyRound(left / 1000))} seconds.`);
  state.cooldowns[key] = now + Math.trunc(seconds * 1000 * numbers.cool);       // start it
}

/** erinne _ability: which tree's ability an equipped move fires, and how strongly. -> [tree, strength] */
function _ability(pet, move) {
  const node = _NODES[move];                                                     // a skill tree move?
  if (node) return [node.tree, 1 + 0.25 * node.index];                           // deeper is stronger
  return [_BASICS[move].magic ? 'mage' : 'fighter', 0.5];                        // her first moves: small versions
}

// ---------------------------------------------------------------------------------------------- one choice

/** Charge a garden shop price in SGC, with the garden's own words when she's short. */
function _shop(who, native, key, words) {
  const p = person(who);                                                         // the buyer
  try {
    return sgc.spend(p.id, p.name, native, GAME, 'shop', { key });              // -> Starpowder Nursery
  } catch (error) {
    if (error instanceof LumiError && error.status === 402) throw notEnoughSGC(error.extra.need, error.extra.have, words); // garden wording
    throw error;                                                                 // game off etc.
  }
}

/**
 * erinne act(): one thing the person chose in the garden. Changes the garden and perhaps the pet (the caller saves
 * both) and returns a note for the page. Call INSIDE db.tx(), after advance. Throws GardenError (400) or a 402.
 * opts: { item, plot, count, picks, pantry, held, username } (username labels the SGC account when `who` is an id)
 */
function act(who, pet, state, action, now, rng, { item = null, plot = null, count = 0, picks = null, pantry = null, held = 99, username = null } = {}) {
  if (username && (who === null || typeof who !== 'object')) who = { id: String(who), name: String(username) }; // the pet module passes the name here
  rng = rng || SECURE;                                                           // secure by default
  const numbers = rates(state, pet, now);                                        // the numbers now
  picks = picks || [];                                                           // watering answer
  const garden = state.gardens[state.at];                                        // the garden being shown
  state.seen = now;                                                              // she has looked
  state.away = null;                                                             // nothing ready is news any more

  const bed = () => {                                                            // the chosen plot
    if (plot === null || plot === undefined || !(plot >= 0 && plot < garden.plots.length)) throw new GardenError('Choose one of the plots.');
    return garden.plots[plot];                                                   // it
  };
  const harvest = (beds, replant) => {                                           // trim some plots
    let got = 0.0;                                                               // powder
    let gift = null;                                                             // at most one gift
    for (const one of beds) {
      const kind = one.flower;                                                   // what grew there
      const gave = _trim(state, garden, one, numbers, now);                      // harvest it
      got += gave;                                                               // add it up
      if (replant && !one.flower) _plant(one, _FLOWERS[kind], numbers, now);     // a cut flower: straight back in
      if (gift === null && rng.random() < numbers.gift) gift = _gift(who, state, pet, gave, now, rng, pantry || [], held); // a gift?
    }
    return { trimmed: beds.length, powder: got, gift };                          // the note
  };

  if (action === 'look') return null;                                            // just looking
  if (action === 'press') {
    const allowed = Math.trunc(Math.min(now - state.press_at, PRESS_WINDOW) / 1000 * CATALOG.press.max_rate) + PRESS_SPARE; // a human rate
    const pressed = Math.max(0, Math.min(count, allowed));                       // counted presses
    state.press_at = now;                                                        // counted up to now
    let lucky = 0;                                                               // lucky presses
    for (let i = 0; i < pressed; i++) if (rng.random() < numbers.lucky) lucky += 1; // roll each
    const plain = _squeeze(who, state, numbers.tap * (pressed - lucky));         // ordinary presses
    const bonus = _squeeze(who, state, numbers.tap * lucky, numbers.lucky_by);   // lucky ones count lucky_by times
    return _money({ pressed, lucky, powder: plain.used + bonus.used }, plain, bonus); // the note
  }
  if (action === 'plot') {
    if (garden.plots.length >= CATALOG.plots.max) throw new GardenError('This garden has every plot it can hold.');
    const paid = _shop(who, plotPrice(garden), 'plot', 'Not enough SGC for another plot.'); // charge it
    garden.plots.push(_empty());                                                 // dig it
    return { bought: 'plot', paid };                                             // SGC charged
  }
  if (action === 'plant') {
    const flower = _FLOWERS[item || ''];                                         // which flower
    if (!flower || !garden.unlocked.includes(item)) throw new GardenError("This garden hasn't unlocked that flower yet.");
    if (bed().flower) throw new GardenError('Something is already growing there.');
    _plant(bed(), flower, numbers, now);                                         // plant it
    return { planted: item };
  }
  if (action === 'trim') {
    if (!['ready', 'overgrown'].includes(_stage(bed(), numbers, now))) throw new GardenError('Nothing there is ready to trim yet.');
    return harvest([bed()], false);                                              // one plot
  }
  if (action === 'dig') {                                                        // take a flower out
    const one = bed();                                                           // the plot
    if (!one.flower) throw new GardenError('That plot is already empty.');
    const name = _FLOWERS[one.flower].name;                                      // for the note
    const said = ['ready', 'overgrown'].includes(_stage(one, numbers, now)) ? harvest([one], false) : {}; // a ready one gives its powder first
    Object.assign(one, { flower: null, ready_at: 0, grow: 0 });                  // out it comes
    return { ...said, dug: name };
  }
  if (action === 'trim_all') {
    const ready = garden.plots.filter((one) => ['ready', 'overgrown'].includes(_stage(one, numbers, now))); // every ready plot
    if (!ready.length) throw new GardenError('Nothing is ready to trim yet.');
    return harvest(ready, true);                                                 // trim and replant
  }
  if (action === 'unlock') {
    const flower = _FLOWERS[item || ''];                                         // which flower
    if (!flower || garden.unlocked.includes(item)) throw new GardenError("That isn't a flower this garden can unlock.");
    if (!opens(garden, flower)) {
      const names = flower.after.map((one) => _FLOWERS[one].name).join(' or '); // its parents
      throw new GardenError(`${flower.name} grows from ${names}: unlock ${flower.after.length > 1 ? 'one of them' : 'it'} first.`);
    }
    if (garden.given < flower.needs) throw new GardenError(`This garden needs to have given ${flower.needs.toLocaleString('en-US')} starpowder first.`);
    if (pet.level < flower.level) throw new GardenError(`${flower.name} needs Lumi to be level ${flower.level}.`);
    if (flower.stardust) {                                                       // a boutique flower: starpowder only
      if (state.powder < flower.stardust) throw new GardenError('Not enough starpowder for that.');
      state.powder -= flower.stardust;                                           // pay in powder
    } else {
      _shop(who, flower.coins, flower.id, 'Not enough SGC for that.');          // pay in SGC (key: the flower id)
    }
    garden.unlocked.push(item);                                                  // unlocked
    return { unlocked: item };
  }
  if (['decor_buy', 'decor_place', 'decor_sell'].includes(action)) {
    const thing = _DECOR[item || ''];                                            // which decoration
    if (!thing) throw new GardenError("That isn't a decoration.");
    const here = garden.decor[thing.slot] === item;                              // standing in this garden?
    if (action === 'decor_buy') {                                                // one more, put out at once
      if (thing.rarity !== 'shop') throw new GardenError(`${thing.name} only comes from the ${CATALOG.decor.capsule.name}.`);
      if ((state.decor[item] || 0) >= MAX_COPIES) throw new GardenError("The store can't hold any more of those.");
      if (state.powder < thing.stardust) throw new GardenError('Not enough starpowder for that.');
      state.powder -= thing.stardust;                                            // pay in powder
      state.decor[item] = (state.decor[item] || 0) + 1;                          // one more owned
      garden.decor[thing.slot] = item;                                           // out it goes
      return { bought: item, paid: thing.stardust };
    }
    if (action === 'decor_place') {                                              // put it out, or away
      if (here) {
        delete garden.decor[thing.slot];                                         // put away
        return { stored: item };
      }
      if (spare(state, item) < 1) throw new GardenError(state.decor[item] ? "There isn't a spare one of those in the store." : "Lumi doesn't have that one yet.");
      garden.decor[thing.slot] = item;                                           // put out
      return { placed: item };
    }
    if (spare(state, item) < 1) throw new GardenError("There isn't a spare one of those to sell. Put it away first.");
    state.decor[item] -= 1;                                                      // one fewer
    if (state.decor[item] <= 0) delete state.decor[item];                        // none left
    state.powder += worth(thing);                                                // sold for powder
    return { sold: item, powder: worth(thing) };
  }
  if (action === 'capsule') {                                                    // the Seedling Capsule
    const rules = CATALOG.decor.capsule;                                         // its rules
    if (state.powder < rules.price) throw new GardenError('Not enough starpowder for a capsule.');
    state.powder -= rules.price;                                                 // pay in powder
    let roll = rng.randrange(100);                                               // the rarity roll
    let rolled = RARITIES[RARITIES.length - 1];                                  // legendary if nothing else
    for (const [rarity, chance] of Object.entries(rules.odds)) {
      if (roll < chance) { rolled = rarity; break; }                             // this rarity
      roll -= chance;                                                            // next band
    }
    const notFull = _PRIZES[rolled].filter((prize) => (state.decor[prize.id] || 0) < MAX_COPIES); // prizes with room
    const pool = notFull.length ? notFull : _PRIZES[rolled];                     // or all of them
    const won = pool[rng.randrange(pool.length)];                                // the prize
    state.decor[won.id] = Math.min(MAX_COPIES, (state.decor[won.id] || 0) + 1); // into the store
    if (!has(garden.decor, won.slot)) garden.decor[won.slot] = won.id;           // an empty slot: straight out
    return { capsule: won.id, rarity: rolled, copies: state.decor[won.id], paid: rules.price };
  }
  if (action === 'helper') {
    const helper = _HELPERS[item || ''];                                         // which helper
    if (!helper) throw new GardenError("That isn't one of Lumi's helpers.");
    const cost = helperCost(state, item);                                        // its next level
    if (state.powder < cost) throw new GardenError('Not enough starpowder for that.');
    state.powder -= cost;                                                        // pay in powder
    state.helpers[item] += 1;                                                    // one level up
    return { helper: item, level: state.helpers[item] };
  }
  if (action === 'ability') {
    const moves = Array.isArray(pet.moves) ? pet.moves : [];                     // equipped moves
    if (!moves.includes(item) || (!(item in _NODES) && !(item in _BASICS))) {
      throw new GardenError("Lumi doesn't have that move ready. Her moves are chosen in Battle.");
    }
    const [tree, strength] = _ability(pet, item);                                // which ability, how strong
    const about = CATALOG.abilities[tree];                                       // its numbers
    const effects = state.effects;                                               // running effects
    if (tree === 'cleric' && !state.gardens.some((g) => g.plots.some((one) => _stage(one, numbers, now) === 'overgrown'))) {
      throw new GardenError('Nothing is overgrown just now.');
    }
    if (tree === 'mage' && !_growing(state, now).length) throw new GardenError('Nothing is growing just now.');
    _cool(state, `move:${item}`, about.cooldown, numbers, now);                  // cooldown (refuses if cooling)
    if (tree === 'fighter') {
      effects.frenzy = now + about.seconds * 1000;                               // Frenzy runs
      effects.frenzy_by = 1 + 2 * strength;                                      // presses count more
    } else if (tree === 'thief') {
      effects.lucky = now + Math.trunc(about.seconds * strength * 1000);         // every press lucky
    } else if (tree === 'monk') {
      const lump = _squeeze(who, state, (numbers.idle * about.seconds + numbers.tap * 20) * strength); // a lump squeeze
      return _money({ ability: tree, powder: lump.used }, lump);                 // with its coins
    } else if (tree === 'mage') {
      return { ability: tree, moved: _skip(state, now, (one) => 0.04 * strength * one.grow) }; // everything grows a bit
    } else if (tree === 'cleric') {
      const freshAgain = state.gardens.flatMap((g) => g.plots.filter((one) => _stage(one, numbers, now) === 'overgrown')); // overgrown plots
      for (const one of freshAgain) one.ready_at = now;                          // fresh again
      return { ability: tree, moved: freshAgain.length };
    } else {
      effects.double = now + Math.trunc(about.seconds * strength * 1000);        // Paladin: everything doubled
    }
    return { ability: tree };
  }
  if (action === 'water_start') {
    const rules = CATALOG.water;                                                 // watering rules
    _cool(state, 'water', rules.cooldown, numbers, now);                         // cooldown
    state.water = { seq: Array.from({ length: rules.rounds }, () => rng.randrange(4)), round: 1 }; // the sequence
    return { water: 'start' };
  }
  if (action === 'water_answer') {
    const game = state.water;                                                    // the round in play
    const rules = CATALOG.water;                                                 // watering rules
    if (!game) throw new GardenError('The watering cans are put away. Start a round first.');
    const right = same(picks, game.seq.slice(0, game.round));                    // repeated correctly?
    if (right && game.round < rules.rounds) {
      game.round += 1;                                                           // one longer
      return { water: 'more', round: game.round };
    }
    const done = right ? game.round : game.round - 1;                            // rounds earned
    state.water = null;                                                          // put away
    const moved = _skip(state, now, (one) => rules.share / 100 * done * one.grow); // share per round
    return { water: 'done', rounds: done, moved, right };
  }
  if (action === 'feed_start') {
    const rules = CATALOG.feed;                                                  // fertilizer rules
    _cool(state, 'feed', rules.cooldown, numbers, now);                          // cooldown
    state.feed = { until: now + rules.seconds * 1000 };                          // the round ends then
    return { feed: 'start' };
  }
  if (action === 'feed_end') {
    const game = state.feed;                                                     // the round in play
    const rules = CATALOG.feed;                                                  // fertilizer rules
    if (!game) throw new GardenError('The fertilizer is put away. Start a round first.');
    state.feed = null;                                                           // put away
    const counted = now <= game.until + 5000 ? Math.max(0, Math.min(count, rules.seconds * CATALOG.press.max_rate + PRESS_SPARE)) : 0; // too late: nothing
    const minutes = Math.min(rules.max, Math.floor(counted / rules.per) * rules.minutes); // minutes skipped
    return { feed: 'done', presses: counted, minutes, moved: _skip(state, now, () => minutes * MIN) };
  }
  if (action === 'moonrise') {
    if (garden.plots.length < CATALOG.plots.max || garden.given < moonriseNeeds(state)) {
      throw new GardenError("This garden isn't ready for a moonrise yet: it needs every plot, and more starpowder given.");
    }
    if (item === 'garden') {
      if (state.gardens.length >= MAX_GARDENS) throw new GardenError('Lumi has all the gardens she can look after.');
    } else if (!(item in _UPGRADES) || (state.upgrades[item] || 0) >= _UPGRADES[item].max) {
      throw new GardenError('Choose a permanent upgrade, or another garden.');
    }
    state.gardens[state.at] = _starter();                                        // this garden starts over
    state.moonrises += 1;                                                        // one more moonrise
    if (item === 'garden') state.gardens.push(_starter());                       // a new garden
    else state.upgrades[item] = (state.upgrades[item] || 0) + 1;                 // or an upgrade
    return { moonrise: item };
  }
  if (action === 'garden') {
    if (!(count >= 0 && count < state.gardens.length)) throw new GardenError("Lumi doesn't have that garden.");
    state.at = count;                                                            // show that one
    return null;
  }
  throw new GardenError("Lumi doesn't know that one.");                         // unknown action
}

/** erinne plot_price: the next plot's native price (each costs `growth` times the one before). */
function plotPrice(garden) {
  const rules = CATALOG.plots;                                                   // plot rules
  return pyRound(rules.price * rules.growth ** (garden.plots.length - rules.start)); // Python round()
}

/** erinne helper_cost: starpowder for a helper's next level. */
function helperCost(state, helper) {
  return Math.floor(_HELPERS[helper].cost * _HELPERS[helper].growth ** state.helpers[helper]); // grows per level
}

// ---------------------------------------------------------------------------------------------- reminders

/**
 * erinne ready_since(): slow flowers ready that the person hasn't seen. Returns a string naming this batch (one
 * batch is one reminder), or null. Quick flowers never count. (LumiBot: for the Phase 7 Discord DM reminders.)
 */
function readySince(state, now) {
  const moments = [];                                                            // ready moments
  for (const garden of state.gardens) {
    for (const plot of garden.plots) {
      if (plot.flower && state.seen < plot.ready_at && plot.ready_at <= now && _FLOWERS[plot.flower].minutes >= CATALOG.reminder_minutes) {
        moments.push(plot.ready_at);                                             // a slow flower, newly ready
      }
    }
  }
  return moments.length ? String(Math.min(...moments)) : null;                   // the earliest names the batch
}

// ---------------------------------------------------------------------------------------------- what the page is told

/**
 * erinne view(): the garden as the page draws it, every price and time worked out here. Times are ms from `now`.
 * Prices stay erinne's native numbers (plot_price, flowers[].coins); the page shows them with
 * LumiPrice('garden', 'plot' | <flower id>, native), the same keys the server charges with.
 */
function view(state, pet, now) {
  const numbers = rates(state, pet, now);                                        // the numbers now
  const garden = state.gardens[state.at];                                        // the garden shown
  const plots = garden.plots.map((plot) => ({ flower: plot.flower, last: plot.last, stage: _stage(plot, numbers, now), ready_in: plot.flower ? plot.ready_at - now : 0, grow: plot.grow })); // plots
  const flowers = CATALOG.flowers.map((flower) => ({                             // every flower, with this garden's state
    ...flower, unlocked: garden.unlocked.includes(flower.id), next: opens(garden, flower),
    powder_now: flower.powder * numbers.yield, minutes_now: flower.minutes * numbers.growth,
  }));
  const moves = [];                                                              // her abilities
  for (const move of Array.isArray(pet.moves) ? pet.moves : []) {
    if (move in _NODES || move in _BASICS) {
      const [tree, strength] = _ability(pet, move);                              // which ability
      const entry = _NODES[move] || _BASICS[move];                               // the move
      moves.push({ id: move, move: entry.name, tree, name: CATALOG.abilities[tree].name, about: CATALOG.abilities[tree].about,
        strength, ready_in: (state.cooldowns[`move:${move}`] || 0) - now });
    }
  }
  const water = state.water;                                                     // watering round
  const feed = state.feed;                                                       // fertilizer round
  const full = garden.plots.length >= CATALOG.plots.max;                         // every plot dug?
  const shown = {};                                                              // rates for the page
  for (const key of ['tap', 'lucky', 'lucky_by', 'idle', 'double', 'growth', 'fresh', 'kept', 'yield', 'gift']) shown[key] = numbers[key];
  shown.away_hours = numbers.away_ms / 60 / MIN;                                 // hours kept while away
  const effects = {};                                                            // running effects, ms left
  for (const key of ['frenzy', 'lucky', 'double']) if ((state.effects[key] || 0) > now) effects[key] = state.effects[key] - now;
  return {
    at: state.at, gardens: state.gardens.length, plots, plot_price: full ? null : plotPrice(garden),
    given: garden.given, flowers,
    powder: state.powder, squeezed: state.squeezed, price: price(state), coins_today: state.coins_today, band: CATALOG.press.band,
    rates: shown,
    helpers: CATALOG.helpers.map((helper) => ({ id: helper.id, name: helper.name, about: helper.about, level: state.helpers[helper.id], cost: helperCost(state, helper.id) })),
    moves,
    effects,
    water: { ready_in: (state.cooldowns.water || 0) - now, rounds: CATALOG.water.rounds, share: CATALOG.water.share, show: water ? water.seq.slice(0, water.round) : null },
    feed: { ready_in: (state.cooldowns.feed || 0) - now, seconds: CATALOG.feed.seconds, per: CATALOG.feed.per, max: CATALOG.feed.max, until_in: feed ? feed.until - now : null },
    decor: { placed: garden.decor, owned: state.decor, spare: Object.fromEntries(Object.keys(state.decor).map((item) => [item, spare(state, item)])) },
    upgrades: CATALOG.upgrades.map((thing) => ({ ...thing, count: state.upgrades[thing.id] || 0 })),
    moonrise: { needs: moonriseNeeds(state), ready: full && garden.given >= moonriseNeeds(state), count: state.moonrises },
    away: state.away, max_rate: CATALOG.press.max_rate,
  };
}

module.exports = {
  // constants (erinne names)
  GAME, MIN, TREES, SKILL_MULT, LEVEL_BONUS, PRESS_WINDOW, PRESS_SPARE, LUCKY_CAP, GIFT_CAP, MAX_GARDENS, MAX_COPIES,
  BRANCHES, SHAPES, RARITIES, LEGACY_DECOR, POTION_CAP, MAX_LEVEL, BONUS_KEYS,
  GardenError,                       // refusal (a LumiError 400)
  loadCatalog, CATALOG, _FLOWERS, _HELPERS, _DECOR, _PRIZES, _UPGRADES, _NODES, _BASICS, // data
  _empty, _starter, fresh, current, save: saveGarden, // the saved garden (erinne save -> save)
  bonuses, _build, rates, price, _squeeze, advance,  // numbers + the press
  _stage, _growing, _plant, _trim, _gift, _skip, spare, worth, opens, moonriseNeeds, _cool, _ability, // flowers
  act, plotPrice, helperCost, readySince, view,      // choices + the page
  pyRound, SECURE,                                   // helpers (tests)
};
