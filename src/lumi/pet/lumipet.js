'use strict';

/**
 * Lumi Pet on the server, ported from erinne mnemerynne/lumipet.py (commit 0ddc466): one companion per player, with
 * needs that run down while away. Everything in lumipet.py that pet/save.js doesn't already hold lives here: the decay
 * curve and catch-up (advance), care actions, the shop (snacks, toys, decor, wear), capsules with the duplicate
 * buyback, the closet, the house/rooms/moving boxes, the move-in refund, the visitor's view of a flat, the guestbook,
 * and the page's snapshot. The fight/dungeon/garden wrappers (fight_start ... garden_act) are here too, calling the
 * battle, dungeon, garden and party modules LAZILY (they are written in parallel; a missing one never breaks the pet).
 *
 * Coins (CONTRACT.md section 5): erinne's native prices go to sgc.spend; prizes to sgc.pay with pay-once refs.
 *   snacks, treats, toys      sgc.spend(..., 'pet', 'snacks',   { key: item.id })   one charge per unit bought
 *   decor, wear               sgc.spend(..., 'pet', 'boutique', { key: item.id })
 *   Star / Moon Capsule       sgc.spend(..., 'pet', 'capsule',  { key: 'capsule' | 'moon' })
 *   capsule repeat buyback    sgc.pay(..., 'pet', 'buyback', 'lumi-buyback:<uid>:<roll id>', { cap: false })
 *   move-in refund            sgc.pay(..., 'pet', 'movein',  'lumi-move-in:<uid>',            { cap: false })
 * Every function that writes must run inside db.tx() (the pet and its coins commit together).
 * User ids are Discord id STRINGS everywhere. Times are whole milliseconds. `rng` is a function returning [0, 1).
 *
 * Other modules: require('../pet/lumipet') - it re-exports pet/save.js (fresh, load, _save, _peek, look, placed,
 * _DECOR, _WEAR, _ITEMS, _PRIZES, CLOSET, HOUSE ...) under erinne's names converted to camelCase.
 */

const crypto = require('node:crypto');
const { logger } = require('../../logger');
const save = require('./save');
const sgc = require('../sgc');
const { getDb, nowMs, dayKey } = require('../db');
const { LumiError, notEnoughSGC } = require('../errors');

const {
  GAME, HOUR, START, KINDS, BOOSTS, RARITIES, PRIZE_GAMES, GLOWS, DOORS, HOMES, GUESTBOOK_MAX, BLOCKED_MAX, MOVE_IN,
  NAME_MAX, NAME_RE, COLOUR_RE, COLOUR_PAINT_RE, PetError, CATALOG, HOUSE, CLOSET, BATTLE, WEAR, DECOR, ITEMS, PRIZES,
  BOXES, SPOTS,
} = save;                                                                           // the shared save model's names

const LAST_QUARTER_HOURS = 24;                                                      // the last 25% of any meter takes a day
const DECAY = { hunger: 30.0, energy: 40.0, joy: 40.0 };                            // B: smaller empties faster at the top
const COOLDOWN = 30_000;                                                            // between two of the same quick care
const NAP_MINUTES = 5;                                                              // a nap is a timed rest
const NAP_ENERGY = 35;                                                              // what a finished nap gives
const AWAKE_MS = 15 * 60_000;                                                       // a gentle wake keeps her up this long
const CUDDLE_JOY = 5;                                                               // joy from one cuddle
const MAX_MOMENTS = 999_999;                                                        // happy moments counter ceiling
const MAX_HELD = 99;                                                                // of any one snack or treat
const LOW = 25.0;                                                                   // under this a need is worth a reminder
const REMIND_EVERY = 3 * HOUR;                                                      // reminders (Phase 7): at most one per 3 h
const QUIET = [22, 7];                                                              // reminders: none 22:00-07:00
const REMIND_ORDER = ['hunger', 'energy', 'joy', 'nap', 'garden'];                  // which reminder wins
const ACTIONS = ['cuddle', 'feed', 'play', 'nap', 'wake', 'buy', 'decorate', 'wear', 'capsule', 'glow', 'import', 'storyteller',
  'learn', 'respec', 'equip', 'mod', 'potions', 'heal', 'drink', 'garden_reminders', 'town_seen', 'room_mode', 'paint',
  'unpack', 'name', 'colour', 'stat', 'stats_auto', 'auto_stats', 'stats_reset', 'kit',
  'door', 'block', 'unblock', 'guestbook_remove'];                                  // erinne PetAction.action (web/games.py)
const PROGRESS = ['learn', 'respec', 'equip', 'mod', 'potions', 'heal', 'drink', 'stat', 'stats_auto', 'auto_stats', 'stats_reset', 'kit']; // lumibattle.progress handles these
const UID_RE = /^\d{1,25}$/u;                                                       // a Discord id

// ---------------------------------------------------------------------------------------------- sibling modules

const SIBLINGS = {                                                                  // written by other agents, in parallel
  battle: '../dungeon/lumibattle',                                                  // fights, skills, mods, health
  dungeon: '../dungeon/lumidungeon',                                                // dungeon runs
  tales: '../dungeon/lumitales',                                                    // the dungeon's words
  garden: '../garden/lumigarden',                                                   // the Stardust Garden
  party: '../party/lumiparty',                                                      // co-op parties
};
const missingLogged = new Set();                                                    // log each missing module once

/** A sibling module, required lazily; null when it isn't there (yet) or fails to load (logged once). */
function sibling(name) {
  try {
    return require(SIBLINGS[name]);                                                 // node caches it after the first time
  } catch (error) {
    if (!missingLogged.has(name)) {                                                 // say it once, not on every request
      missingLogged.add(name);                                                      // remember we said it
      const quiet = error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(SIBLINGS[name].slice(3)); // simply not written yet
      if (quiet) logger.info(`Lumi Pet: ${name} module not present; its parts of the pet are skipped.`); // expected while porting
      else logger.error(`Lumi Pet: ${name} module failed to load: ${error && (error.stack || error.message)}`); // a real bug
    }
    return null;                                                                    // the pet carries on without it
  }
}

/** Call fn(mod) if the sibling has it, else return `fallback`. */
function withSibling(name, fn, fallback) {
  const mod = sibling(name);                                                        // the module or null
  return mod ? fn(mod) : fallback;                                                  // use it, or the fallback
}

// A sibling's refusal (BattleError, DungeonError, GardenError) becomes a PetError with the same words.
function asPetError(error, mod, ...classes) {
  if (error instanceof PetError || error instanceof LumiError) return error;        // already ours
  for (const name of classes) {
    if (mod && typeof mod[name] === 'function' && error instanceof mod[name]) return new PetError(error.message); // refused: safe words
  }
  return error;                                                                     // a bug: let it surface
}

// ---------------------------------------------------------------------------------------------- small helpers

/** erinne now_ms(). */
function nowMsFn() {
  return nowMs();                                                                   // the (test-swappable) clock
}

/** A player's name for their SGC account ('' when unknown; the auth layer keeps it fresh on every request). */
function _nameOf(uid) {
  try {
    const row = getDb().prepare('SELECT name FROM lumi_users WHERE user_id = ?').get(String(uid)) // Lumi's own record
      || getDb().prepare('SELECT username AS name FROM accounts WHERE user_id = ?').get(String(uid)); // or their SGC account
    return row && row.name ? String(row.name) : '';                                 // the name or ''
  } catch {
    return '';                                                                      // DB not ready: no name
  }
}

/**
 * erinne web/games.py _person(uid): someone Lumi knows (they have opened Lumi, or have an SGC account), as
 * {id, username}; null for a stranger or a junk id. LumiBot has no "inactive account", so known = active.
 */
function _person(uid) {
  const id = String(uid);                                                           // Discord id string
  if (!UID_RE.test(id)) return null;                                                // not an id at all
  let row = null;                                                                   // what the DB knows
  try {
    row = getDb().prepare('SELECT name FROM lumi_users WHERE user_id = ?').get(id)  // Lumi's own record
      || getDb().prepare('SELECT username AS name FROM accounts WHERE user_id = ?').get(id); // or their SGC account
  } catch { row = null; }                                                           // DB not ready
  if (!row) return null;                                                            // a stranger
  return { id, username: row.name ? String(row.name) : 'Someone' };                 // never empty
}

/** A random [0, 1) number from the system's secure source (erinne random.SystemRandom). */
function secureRandom() {
  return crypto.randomInt(0, 2 ** 47) / 2 ** 47;                                    // 47 random bits as a fraction
}

/** rng.randrange(n): rng is a [0, 1) function, or an object with randrange(n) / random() (the battle and garden modules' rng). */
function randrange(rng, n) {
  if (rng && typeof rng === 'object' && typeof rng.randrange === 'function') return rng.randrange(n); // their rng object
  const draw = rng && typeof rng === 'object' && typeof rng.random === 'function' ? () => rng.random() : (typeof rng === 'function' ? rng : secureRandom); // a [0, 1) source
  return Math.min(n - 1, Math.floor(draw() * n));                                   // 0..n-1
}

/** A short random hex id (erinne secrets.token_hex(6)). */
function tokenHex(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');                                 // 12 hex characters by default
}

/** Charge for something the pet shop sells; a 402 says it in Lumi's words (need/have kept for the page). */
function charge(uid, username, native, kind, key) {
  try {
    return sgc.spend(uid, username, native, GAME, kind, { key });                   // -> SGC charged
  } catch (error) {
    if (error instanceof LumiError && error.code === 'not_enough_sgc') throw notEnoughSGC(error.extra.need, error.extra.have, 'Not enough SGC for that.'); // erinne "Not enough coins for that."
    throw error;                                                                    // game_off etc. pass through
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);       // a plain object?

// ---------------------------------------------------------------------------------------------- the curve

/** The curve's time constant in hours, chosen so 25% down to 0% takes LAST_QUARTER_HOURS. */
function _tau(b) {
  return LAST_QUARTER_HOURS / (Math.exp(100 / b) - Math.exp(75 / b));               // erinne _tau
}

/** A meter `hours` later: value = 100 - b*ln(1 + t/tau), moved along from where `value` sits. */
function decayed(value, hours, b) {
  if (hours <= 0) return value;                                                     // no time, no change
  const tau = _tau(b);                                                              // time constant
  const elapsed = tau * (Math.exp((100 - value) / b) - 1);                          // hours since this meter was full
  return Math.max(0.0, 100 - b * Math.log(1 + (elapsed + hours) / tau));            // never below zero
}

/** 0..100. */
function _clamp(value) {
  return Math.max(0.0, Math.min(100.0, value));                                     // erinne _clamp
}

/**
 * erinne advance(pet, now): catch a pet up to `now`. A finished nap or play pays its reward at the moment it finished,
 * and the rest of the absence decays from there. Health mends with time (lumibattle.mend) when the battle module is in.
 */
function advance(pet, now) {
  now = Math.max(now, Number(pet.updated) || 0);                                    // a clock that runs backwards changes nothing
  let start = Number(pet.updated) || now;                                           // where we decay from
  const battle = sibling('battle');                                                 // health mending lives there
  const decayUntil = (moment) => {
    const hours = Math.max(0, moment - start) / HOUR;                               // time to decay
    if (battle && typeof battle.mend === 'function' && battle.MEND_MS) {            // her health comes back with time
      const resting = pet.task && pet.task.kind === 'nap' ? (battle.NAP_MEND || 1) : 1; // a nap mends faster
      battle.mend(pet, resting * Math.max(0, moment - start) / battle.MEND_MS);     // mend a share of a bar
    }
    for (const [meter, b] of Object.entries(DECAY)) pet[meter] = decayed(Number(pet[meter]) || 0, hours, b); // each need runs down
    start = Math.max(start, moment);                                                // moved on
  };
  const task = pet.task;                                                            // a nap or play under way?
  if (task && now >= task.finishesAt) {
    decayUntil(task.finishesAt);                                                    // decay up to when it finished
    for (const [meter, amount] of Object.entries(task.rewards || {})) pet[meter] = _clamp(pet[meter] + amount); // its reward, then
    pet.moments = Math.min(MAX_MOMENTS, (pet.moments || 0) + 1);                    // a happy moment
    pet.done = { kind: task.kind, item: task.item === undefined ? null : task.item, at: task.finishesAt }; // for the page to announce once
    pet.task = null;                                                                // finished
  }
  decayUntil(now);                                                                  // the rest of the absence
  pet.cooldowns = Object.fromEntries(Object.entries(isObj(pet.cooldowns) ? pet.cooldowns : {}).filter(([, until]) => until > now)); // drop expired cooldowns
  pet.updated = now;                                                                // caught up
  _markLow(pet, now);                                                               // low-need episodes
}

/** Note when each need first dropped under LOW, and forget it once it's back up. */
function _markLow(pet, now) {
  if (!isObj(pet.low)) pet.low = {};                                                // a broken save starts again
  for (const meter of Object.keys(DECAY)) {
    if (pet[meter] < LOW) { if (!(meter in pet.low)) pet.low[meter] = now; }        // setdefault
    else delete pet.low[meter];                                                     // back up: episode over
  }
}

/** erinne load(conn, uid, now, seen=): this player's pet, caught up and saved. INSIDE db.tx(). */
function load(uid, now = nowMs(), { seen = true } = {}) {
  return save.load(String(uid), { now, seen });                                     // save.js runs the migrations + advance hook
}

// The move-in refund (erinne _move_in): paid once by its ref, no daily cap (save.js calls this from load).
function moveInRefund(uid, pet, worth) {
  if (!worth) return 0;                                                             // nothing was worth anything
  const done = sgc.pay(String(uid), _nameOf(uid), worth, GAME, 'movein', `lumi-move-in:${uid}`, { cap: false }); // bank -> player
  return done.paid;                                                                 // SGC given back now (owed is paid later)
}

save.setAdvance(advance);                                                           // every save.load catches up with our curve
save.setMoveInRefund(moveInRefund);                                                 // and pays the move-in refund

// ---------------------------------------------------------------------------------------------- homes

/** Whether this player owns a plot in Lumi City (so has a house to furnish or visit). */
function hasPlot(uid) {
  return Boolean(getDb().prepare('SELECT 1 FROM lumi_plots WHERE user_id = ?').get(String(uid))); // a row?
}

/**
 * erinne house_view(uid, home): her flat (or her house on her Lumi City plot) as a visitor sees it: what stands in every
 * spot, moving boxes still packed, her look and the guestbook (never who signed by account). Read-only.
 */
function houseView(uid, home = 'flat') {
  const pet = save.peek(uid) || {};                                                 // her save as stored
  let house;                                                                        // spot -> piece
  let packed = 0;                                                                   // boxes still to unpack
  if (home === 'house') {
    const rooms = save.estateOf(pet).rooms;                                         // the house's own rooms
    house = save.placed({ ...pet, house: rooms });                                  // furnished from the same furniture
  } else {
    house = save.placed({ ...pet, house: isObj(pet.house) ? pet.house : {} });      // her flat
    packed = Math.max(0, BOXES.length - (parseInt(pet.unpacked, 10) || 0));         // boxes still packed in her flat
  }
  return {
    house, boxes: packed, look: save.look(uid),                                     // what a visitor sees
    guestbook: save.guestbook(pet).map((e) => ({ id: e.id, name: e.name, lumi: e.lumi, text: e.text, at: e.at })), // never the uid
  };
}

/**
 * erinne sign(host, guest, name, lumi, text, now): a visitor signs the host's guestbook (the route checks they may be
 * there; text is already cleaned). Written without catching her up or counting a visit. INSIDE db.tx().
 */
function sign(host, guest, name, lumi, text, now = nowMs()) {
  const pet = save.peek(host);                                                      // the host's save as stored
  if (!pet) throw new PetError("There's no guestbook there.");                      // no Lumi, no book
  const book = save.guestbook(pet);                                                 // valid lines
  book.push({ id: tokenHex(6), uid: String(guest), name, lumi, text, at: now });    // the new line
  pet.guestbook = book.slice(-GUESTBOOK_MAX);                                       // only the last 30
  save.save(host, pet);                                                             // written back
  return pet.guestbook;                                                             // the book
}

// ---------------------------------------------------------------------------------------------- the page's view

/** Her Stardust Garden caught up to now and saved (erinne _garden). Null without the garden module. */
function _garden(uid, pet, now) {
  const garden = sibling('garden');                                                 // the garden module
  if (!garden) return null;                                                         // not there yet
  const state = garden.current(uid, now);                                           // her garden
  garden.advance(uid, state, pet, now);                                             // helpers' squeezing counts
  garden.save(uid, state);                                                          // saved
  return state;                                                                     // caught up
}

/** Her health for the page (erinne _health): the trip's own count while out, else home health and mend time. */
function _health(run, pet) {
  const battle = sibling('battle');                                                 // health lives there
  if (!battle) return { hp: 0, max: 0, mends_in: 0, out: false };                   // no battles yet: nothing to show
  const full = battle.stats(pet).hp;                                                // a full bar
  if (run && !run.over) return { hp: Math.min(full, run.hp), max: full, mends_in: 0, out: true }; // out exploring
  return { hp: battle.health(pet), max: full, mends_in: battle.mendsIn(pet), out: false }; // at home
}

/** Bought food gives back a share of her health: at home, or to the trip's count if she is out (erinne _eat). */
function _eat(uid, pet, share) {
  const party = sibling('party');                                                   // out with a party?
  if (party && party.heal(uid, share)) return;                                      // their trip's count
  const dungeon = sibling('dungeon');                                               // out on her own?
  const battle = sibling('battle');                                                 // health
  const run = dungeon ? dungeon.current(uid) : null;                                // her trip
  if (run && !run.over) {
    if (!run.fight && battle) {                                                     // not mid-fight
      const full = battle.stats(pet).hp;                                            // a full bar
      run.hp = Math.min(full, run.hp + Math.floor(full * share));                   // the trip's count goes up
      dungeon._save(uid, run);                                                      // saved
    }
  } else if (battle) {
    battle.mend(pet, share);                                                        // at home: her own health
  }
}

/** The battle catalog parts the page needs (lumibattle.CATALOG basics/trees/mods + RULES). */
function battleView() {
  const battle = sibling('battle');                                                 // the battle module
  const cat = battle && battle.CATALOG ? battle.CATALOG : BATTLE;                   // its validated catalog, else the raw file
  return { basics: cat.basics, trees: cat.trees, mods: cat.mods, rules: battle && battle.RULES ? battle.RULES : {} }; // erinne's shape
}

/** erinne snapshot(uid, pet, now): what the page draws. `now` is the server's clock. Read-mostly (the garden saves). */
function snapshot(uid, pet, now) {
  const outfit = isObj(pet.outfit) ? pet.outfit : {};                               // slot -> item
  const worn = Object.fromEntries(Object.entries(outfit).filter(([slot, item]) => WEAR[item] && WEAR[item].slot === slot)); // drop anything retired
  const dungeon = sibling('dungeon');                                               // her trips
  const party = sibling('party');                                                   // her party
  let run = dungeon ? dungeon.current(uid) : null;                                  // her own trip
  const mine = party ? party.mine(uid) : null;                                      // her party
  const partyInfo = mine ? { code: mine.code, phase: mine.phase, mode: mine.mode } : null; // what the page shows
  let runView = null;                                                               // the trip as the page draws it
  if (mine && mine.phase === 'trip' && party) {                                     // out with friends: the party's trip is hers
    runView = party.view(mine, uid, { now }).run;                                   // the party's run
    run = { over: null, hp: runView.hp, satchel: { potions: runView.satchel.potions }, fight: null }; // the bits health needs
  } else {
    runView = dungeon ? dungeon.view(run, pet) : null;                              // her own trip
  }
  const estate = save.estateOf(pet);                                                // her Lumi City things
  const meters = Object.fromEntries(Object.keys(DECAY).map((m) => [m, Math.round(pet[m] * 10) / 10])); // one decimal
  const battle = sibling('battle');                                                 // fights
  const garden = sibling('garden');                                                 // the garden
  return {
    pet: { ...pet, ...meters, house: save.placed(pet), outfit: worn, estate: { ...estate, rooms: save.placed({ house: estate.rooms }) } }, // her save, tidied
    now,                                                                            // the server's clock
    coins: sgc.balance(uid),                                                        // SGC (erinne coins.peek)
    catalog: CATALOG, house: HOUSE, closet: CLOSET,                                 // the shop's data
    battle: battleView(),                                                           // fight catalog + rules
    progress: battle ? battle.summary(pet) : null,                                  // level, EXP, points
    fight: battle ? battle.current(uid) : null,                                     // a fight under way
    potions_ready: dungeon ? dungeon.potionsReady(run, pet) : 0,                    // potions for the trip
    health: _health(run, pet), party: partyInfo, boxes: save.boxes(pet),            // health, party, moving boxes
    garden: garden ? garden.view(_garden(uid, pet, now), pet, now) : null,          // the Stardust Garden
    garden_decor: garden && garden.CATALOG ? garden.CATALOG.decor : [],             // the garden's fixed decorations
    dungeon: { environments: dungeon ? dungeon.openEnvironments(pet) : [], run: runView }, // the dungeons
  };
}

/** erinne state(uid, now): read the pet (catching it up). INSIDE db.tx(). */
function state(uid, now = nowMs()) {
  return snapshot(uid, load(uid, now), now);                                        // load + snapshot
}

// ---------------------------------------------------------------------------------------------- care helpers

/** Refuse a quick care repeated too soon, then start its cooldown. */
function _cool(pet, key, now) {
  if ((pet.cooldowns[key] || 0) > now) throw new PetError('Lumi is still enjoying that. Try again in a moment.'); // too soon
  pet.cooldowns[key] = now + COOLDOWN;                                              // start it
}

/** A happy moment with a memory. */
function _moment(pet, memory) {
  pet.moments = Math.min(MAX_MOMENTS, (pet.moments || 0) + 1);                     // one more
  pet.memory = memory;                                                              // what it was
}

/**
 * erinne _roll(pool, odds, rng): a rarity first by `odds` ({rarity: chance out of 100}, in order), then equally among
 * the pool's prizes of that rarity. Shared with Lumi City's Keepsake Capsule. Returns [prize, rarity].
 */
function _roll(pool, odds, rng) {
  let roll = randrange(rng, 100);                                                   // 0..99
  let rolled = RARITIES[RARITIES.length - 1];                                       // the last rarity if the odds fall short
  for (const [rarity, chance] of Object.entries(odds)) {
    if (roll < chance) { rolled = rarity; break; }                                  // landed in this rarity's share
    roll -= chance;                                                                 // on to the next share
  }
  const choices = pool.filter((prize) => prize.rarity === rolled);                  // everything of that rarity
  return [choices[randrange(rng, choices.length)], rolled];                         // one of them, all equally likely
}

/** A busy refusal (napping or playing). */
function busyLine(pet) {
  return pet.task.kind === 'nap' ? 'Lumi is busy napping.' : 'Lumi is busy playing.'; // erinne's words
}

// ---------------------------------------------------------------------------------------------- act

/**
 * erinne act(uid, action, item=, count=, moments=, glow=, slot=, name=, colour=, spot=, home=, now=, rng=).
 * One thing the person chose to do. INSIDE db.tx(): the pet and any coins save together or not at all.
 * opts.username: the player's display name for their SGC account. Returns {...snapshot, said}.
 */
function act(uid, action, opts = {}) {
  uid = String(uid);                                                                // Discord id string
  const { item = null, moments = 0, glow = null, slot = null, name = null, colour = null, spot = null, home = 'flat', rng = null } = opts; // the choices
  let count = opts.count === undefined ? 1 : opts.count;                            // how many (buy)
  const username = opts.username === undefined ? _nameOf(uid) : opts.username;      // for the SGC account
  const now = opts.now === undefined || opts.now === null ? nowMs() : opts.now;     // one clock reading
  const pet = load(uid, now);                                                       // caught up first
  const thing = item !== null && item !== undefined ? ITEMS[item] || null : null;   // a snack/treat/toy, if named
  let said = null;                                                                  // what just happened, for the page
  if (!HOMES.includes(home)) throw new PetError('Lumi only has a flat and a house.'); // flat or house
  if (home === 'house' && (action === 'decorate' || action === 'paint') && !hasPlot(uid)) throw new PetError("I haven't got a house yet! The office in Downtown sells plots."); // no plot
  if (!isObj(pet.house)) pet.house = {};                                            // a broken save's house
  for (const key of ['inventory', 'cooldowns', 'outfit']) if (!isObj(pet[key])) pet[key] = {}; // broken parts start again
  for (const key of ['toys', 'decor', 'closet']) if (!Array.isArray(pet[key])) pet[key] = []; // broken lists start again
  const rooms = home === 'house' ? save.estateOf(pet).rooms : pet.house;            // where decorate and paint put things

  if (action === 'cuddle') {
    _cool(pet, 'cuddle', now);                                                      // not too often
    pet.joy = _clamp(pet.joy + CUDDLE_JOY);                                         // a little joy
    _moment(pet, 'cuddle');                                                         // and a moment
  } else if (action === 'feed') {
    if (!thing || !['snacks', 'treats'].includes(thing.kind)) throw new PetError('Choose something from the pantry.'); // food only
    if (thing.price && (pet.inventory[item] || 0) < 1) throw new PetError(`There's no ${thing.name.toLowerCase()} left. The shop has more.`); // none left
    _cool(pet, 'feed', now);                                                        // not too often
    if (thing.price) {                                                              // bought food: used up, and mends her
      _eat(uid, pet, Math.max(0, thing.fullness) / 100);                            // a share of her health back
      pet.inventory[item] -= 1;                                                     // one fewer
      if (pet.inventory[item] <= 0) delete pet.inventory[item];                     // none left: tidy
    }
    pet.hunger = _clamp(pet.hunger + thing.fullness);                               // fuller
    pet.joy = _clamp(pet.joy + thing.joy);                                          // happier
    if (thing.kind === 'treats') pet.boost = thing.boost;                           // a boost for the next fight
    _moment(pet, 'snack');                                                          // a moment
  } else if (action === 'play' || action === 'nap') {
    if (pet.task) throw new PetError(busyLine(pet));                                // one thing at a time
    if (action === 'play') {
      if (!thing || thing.kind !== 'toys' || ((thing.price || 'rarity' in thing) && !pet.toys.includes(item))) throw new PetError("Choose a toy from Lumi's toy box."); // owned toys only
      const rewards = { joy: thing.joy, energy: thing.energy, hunger: thing.hunger }; // what it gives at the end
      pet.task = { kind: 'play', item, started: now, finishesAt: now + thing.minutes * 60_000, rewards }; // timed play
      pet.rest = 'awake'; pet.restUntil = now + AWAKE_MS;                           // playing wakes her
      pet.memory = 'play';                                                          // what she's doing
    } else {
      pet.task = { kind: 'nap', item: null, started: now, finishesAt: now + NAP_MINUTES * 60_000, rewards: { energy: NAP_ENERGY } }; // a timed nap
      pet.rest = 'nap'; pet.restUntil = now + NAP_MINUTES * 60_000;                 // asleep until then
      pet.memory = 'rest';                                                          // resting
    }
    pet.done = null;                                                                // a new task: nothing to announce
  } else if (action === 'wake') {
    if (pet.task && pet.task.kind === 'nap') pet.task = null;                       // a nap cut short earns nothing
    pet.rest = 'awake'; pet.restUntil = now + AWAKE_MS;                             // up for a while
    pet.memory = 'rest';                                                            // a quiet moment
  } else if (action === 'buy') {
    if (!thing || !thing.price) throw new PetError("The shop doesn't sell that.");  // free or unknown things aren't sold
    if (thing.kind === 'toys') {
      if (pet.toys.includes(item)) throw new PetError('Lumi already has that toy.'); // one of each toy
      count = 1;                                                                    // a toy is one toy
    } else if (!Number.isInteger(count) || count < 1 || count > MAX_HELD || (pet.inventory[item] || 0) + count > MAX_HELD) {
      throw new PetError(`Lumi's pantry holds up to ${MAX_HELD} of each.`);         // the pantry's limit
    }
    let paid = 0;                                                                   // SGC charged in all
    for (let i = 0; i < count; i += 1) paid += charge(uid, username, thing.price, 'snacks', item); // one charge per unit (so a per-item override is per unit)
    if (thing.kind === 'toys') pet.toys.push(item);                                 // into the toy box
    else pet.inventory[item] = (pet.inventory[item] || 0) + count;                  // into the pantry
    said = { bought: item, count, paid };                                           // SGC actually charged
  } else if (action === 'decorate') {
    const piece = item !== null && item !== undefined ? DECOR[item] || null : null; // a house piece
    if (!piece) throw new PetError("That isn't something for Lumi's house.");       // unknown
    const owned = pet.decor.includes(item);                                         // already hers?
    if (piece.found && !owned) throw new PetError("That one can't be bought. It's waiting somewhere in the dungeon."); // a dungeon find
    if ('rarity' in piece && !owned) throw new PetError('That one only comes from a capsule.'); // capsule-only
    if ('prize' in piece && !owned) throw new PetError(`That's a ${PRIZE_GAMES[piece.prize]} prize: ${piece.how}.`); // a game prize
    if (piece.worn && !owned) throw new PetError(`That's still packed in a moving box. Lumi unpacks one a day (box ${piece.box} of ${BOXES.length}).`); // still boxed
    const target = spot !== null && spot !== undefined ? spot : piece.spot;         // its own spot, or a shared wall/floor
    if (!(target in SPOTS) || save.takes(target) !== piece.spot) throw new PetError("That doesn't go there."); // wrong spot
    if (piece.price && !owned) {                                                    // not hers yet: buy it first
      const paid = charge(uid, username, piece.price, 'boutique', item);            // Lumi's Boutique
      pet.decor.push(item);                                                         // hers now
      said = { bought: item, count: 1, paid };                                      // SGC charged
    }
    rooms[target] = item;                                                           // into the spot (flat or house)
  } else if (action === 'paint') {
    const cleaned = String(colour || '').trim().toLowerCase();                      // '#rrggbb'
    if (!(spot in SPOTS) || !SPOTS[save.takes(spot)].paintable) throw new PetError('Only walls and floors can be painted.'); // paintable only
    if (!COLOUR_PAINT_RE.test(cleaned)) throw new PetError('A colour is # and six hex digits, like #ff8ecb.'); // a real colour
    rooms[spot] = cleaned;                                                          // painted (free)
  } else if (action === 'wear') {
    const piece = item !== null && item !== undefined ? WEAR[item] || null : null;  // an accessory
    if (!piece) throw new PetError("That isn't something Lumi can wear.");          // unknown
    if (!pet.closet.includes(item)) {                                               // not hers yet
      if ('prize' in piece) throw new PetError(`That's a ${PRIZE_GAMES[piece.prize]} prize: ${piece.how}.`); // a game prize
      if (!piece.price) throw new PetError('That one only comes from a capsule.');  // capsule-only
      const paid = charge(uid, username, piece.price, 'boutique', item);            // Lumi's Boutique
      pet.closet.push(item);                                                        // hers now
      said = { bought: item, count: 1, paid };                                      // SGC charged
    }
    if (pet.outfit[piece.slot] === item && said === null) delete pet.outfit[piece.slot]; // worn already: take it off
    else pet.outfit[piece.slot] = item;                                             // put it on
  } else if (action === 'capsule') {
    if (item !== null && item !== undefined && item !== 'moon') throw new PetError("Lumi doesn't know that capsule."); // Star (null) or Moon
    const kind = CLOSET[item ? 'moon' : 'capsule'];                                 // which capsule
    const owned = (prize) => pet[save.shelf(prize)].includes(prize.id);             // already in her closet, toy box or house
    const pool = PRIZES.filter((prize) => prize.rarity in kind.odds);               // what it can give
    if (pool.every(owned)) throw new PetError(`Lumi already has everything the ${kind.name} holds!`); // checked before charging
    const paid = charge(uid, username, kind.price, 'capsule', item ? 'moon' : 'capsule'); // Moon Capsule Co.
    const [won, rolled] = _roll(pool, kind.odds, rng);                              // a rarity, then a prize
    said = { capsule: won.id, name: won.name, rarity: rolled, paid };               // what came out
    if (owned(won)) {                                                               // a repeat: bought back for half its value
      const native = Math.floor((won.price || CLOSET.values[rolled]) / 2);          // erinne's buyback (native)
      const back = sgc.pay(uid, username, native, GAME, 'buyback', `lumi-buyback:${uid}:${tokenHex(8)}`, { cap: false }); // bank -> player
      Object.assign(said, { duplicate: true, buyback: back.paid, buyback_owed: back.owed }); // SGC back now (or owed)
    } else if ('spot' in won) {
      pet.decor.push(won.id);                                                       // hers
      pet.house[won.spot] = won.id;                                                 // straight into the room
    } else if (save.shelf(won) === 'toys') {
      pet.toys.push(won.id);                                                        // into her toy box
    } else {
      pet.closet.push(won.id);                                                      // into her closet
      pet.outfit[won.slot] = won.id;                                                // she wears it straight away
    }
  } else if (action === 'unpack') {
    const today = dayKey(now);                                                      // the LA day
    if ((pet.unpacked || 0) >= BOXES.length) throw new PetError("Every box is unpacked. Lumi's all moved in!"); // nothing left
    if (pet.box_day === today) throw new PetError('Lumi has unpacked enough for one day. Another box tomorrow!'); // one a day
    const piece = BOXES[pet.unpacked || 0];                                         // the next box
    pet.unpacked = (pet.unpacked || 0) + 1;                                         // one more done
    pet.box_day = today;                                                            // today's box
    if (!pet.decor.includes(piece.id)) pet.decor.push(piece.id);                    // hers
    const putOut = !(piece.spot in pet.house);                                      // its spot still empty?
    if (putOut) pet.house[piece.spot] = piece.id;                                   // out it goes
    said = { unpacked: piece.id, name: piece.name, put_out: putOut, left: BOXES.length - pet.unpacked }; // for the page
    _moment(pet, 'unpack');                                                         // a moment
  } else if (action === 'name') {
    const cleaned = String(name || '').split(/\s+/u).filter(Boolean).join(' ');     // " ".join(name.split())
    if (!NAME_RE.test(cleaned) || !/[\p{L}\p{N}]/u.test(cleaned)) throw new PetError(`A name is 1 to ${NAME_MAX} letters or numbers (spaces, ' . and - are fine too).`); // a real name
    pet.name = cleaned;                                                             // renamed
  } else if (action === 'colour') {
    const cleaned = String(colour || '').trim().toLowerCase();                      // '#rrggbb' or ''
    if (cleaned && !COLOUR_RE.test(cleaned)) throw new PetError('A colour is # and six hex digits, like #ff8ecb.'); // a real colour
    pet.colour = cleaned || null;                                                   // '' goes back to her glow's
  } else if (action === 'garden_reminders') {
    pet.garden_reminders = !(pet.garden_reminders !== false);                       // toggle (default on)
  } else if (action === 'town_seen') {
    pet.town_seen = !(pet.town_seen !== false);                                     // toggle (default on)
  } else if (action === 'door') {
    const nowDoor = DOORS.includes(pet.door) ? pet.door : DOORS[0];                 // knock by default
    if (item !== null && item !== undefined && !DOORS.includes(item)) throw new PetError('A door is knock, open or closed.'); // known doors only
    pet.door = item || DOORS[(DOORS.indexOf(nowDoor) + 1) % DOORS.length];          // set it, or the next one
    said = { door: pet.door };                                                      // the route sends guests home if closed
  } else if (action === 'guestbook_remove') {
    pet.guestbook = save.guestbook(pet).filter((e) => e.id !== item);               // that line out
  } else if (action === 'block' || action === 'unblock') {
    const who = String(item || '');                                                 // their Discord id
    if (!UID_RE.test(who) || who === uid) throw new PetError('Choose someone to block.'); // a real other person
    const blocked = (Array.isArray(pet.blocked) ? pet.blocked : []).map(String).filter((b) => UID_RE.test(b) && b !== who); // the rest
    if (action === 'block') {
      if (blocked.length >= BLOCKED_MAX) throw new PetError("That's a lot of people blocked already."); // a guard
      blocked.push(who);                                                            // blocked
    }
    pet.blocked = blocked;                                                          // saved
    said = { [action]: who };                                                       // the route sends them home
  } else if (action === 'room_mode') {
    pet.room_mode = !(pet.room_mode !== false);                                     // toggle (default on)
  } else if (action === 'storyteller') {
    pet.storyteller = pet.storyteller === 'live' ? 'library' : 'live';              // a preference only
  } else if (action === 'glow') {
    if (!GLOWS.includes(glow)) throw new PetError("Choose one of Lumi's glow colours."); // known glows
    pet.glow = glow;                                                                // her colour
  } else if (PROGRESS.includes(action)) {
    const dungeon = sibling('dungeon');                                             // her trip
    const party = sibling('party');                                                 // her party
    const run = action === 'drink' && dungeon ? dungeon.current(uid) : null;        // out exploring?
    if ((run && !run.over) || (action === 'drink' && party && party.onTrip(uid))) throw new PetError('Lumi is out exploring. She can drink it there, in Lumi Dungeons.'); // not at home
    const battle = sibling('battle');                                               // skills, mods, potions
    if (!battle) throw new PetError("Lumi Dungeons isn't open yet.");               // module not in yet
    try {
      said = battle.progress(uid, pet, action, item, slot, count, now, username) || null; // lumibattle.progress (spends battle,shop)
    } catch (error) {
      throw asPetError(error, battle, 'BattleError');                               // its refusal in Lumi's words
    }
  } else if (action === 'import') {
    if (!pet.imported) {                                                            // once per account
      pet.imported = true;                                                          // taken
      pet.moments = Math.min(MAX_MOMENTS, (pet.moments || 0) + Math.max(0, Number(moments) || 0)); // a keepsake number
      if (GLOWS.includes(glow)) pet.glow = glow;                                    // her old glow
    }
  } else {
    throw new PetError("Lumi doesn't know that one.");                              // unknown action
  }

  _markLow(pet, now);                                                               // a snack may end an episode
  save.save(uid, pet);                                                              // write it
  return { ...snapshot(uid, pet, now), said };                                      // the page's new view
}

// ---------------------------------------------------------------------------------------------- reminders (Phase 7)

/** erinne episodes(pet, now): what Lumi would mention right now ({kind: episode}). Kept for Phase 7 Discord DMs. */
function episodes(pet, now) {
  const found = Object.fromEntries(Object.entries(pet.low || {}).filter(([, since]) => since > pet.seen).map(([m, since]) => [m, String(since)])); // new needs
  const done = pet.done;                                                            // a finished nap
  if (done && done.kind === 'nap' && done.at > pet.seen && now - done.at < HOUR) found.nap = String(done.at); // while away, lately
  return found;                                                                     // {kind: episode}
}

/** erinne _quiet(utc_offset, now): night on the player's clock (offset in minutes). */
function _quiet(utcOffset, now) {
  const hour = Math.floor((Math.floor(now / 1000) + utcOffset * 60) / 3600) % 24;  // their hour
  return hour >= QUIET[0] || hour < QUIET[1];                                       // 22:00-07:00
}

// ---------------------------------------------------------------------------------------------- fights, dungeon, garden

/** erinne fight_start(uid, tier, now, rng): begin a fight. INSIDE db.tx(). */
function fightStart(uid, tier, now = nowMs(), rng = null, opts = {}) {
  uid = String(uid);                                                                // Discord id
  const pet = load(uid, now);                                                       // caught up
  if (pet.task) throw new PetError(busyLine(pet));                                  // busy
  const battle = sibling('battle');                                                 // fights
  if (!battle) throw new PetError("Lumi Dungeons isn't open yet.");                 // not in yet
  const dungeon = sibling('dungeon');                                               // trips
  const party = sibling('party');                                                   // parties
  const run = dungeon ? dungeon.current(uid) : null;                                // her trip
  if ((run && !run.over) || (party && party.onTrip(uid))) throw new PetError('Lumi is out exploring. Her fights are in the dungeon until she comes home.'); // out
  let fight;                                                                        // the new fight
  try {
    fight = battle.start(uid, pet, tier, now, rng, opts);                           // lumibattle.start
  } catch (error) {
    throw asPetError(error, battle, 'BattleError');                                 // its refusal
  }
  pet.rest = 'awake'; pet.restUntil = now + AWAKE_MS;                               // a fight wakes her
  save.save(uid, pet);                                                              // saved
  return { ...snapshot(uid, pet, now), fight };                                     // the page's view
}

/** erinne fight_act(uid, battle_id, turn, action, now, rng): one button press in a fight. INSIDE db.tx(). */
function fightAct(uid, battleId, turn, action, now = nowMs(), rng = null, opts = {}) {
  uid = String(uid);                                                                // Discord id
  const pet = load(uid, now);                                                       // caught up
  const battle = sibling('battle');                                                 // fights
  if (!battle) throw new PetError("Lumi Dungeons isn't open yet.");                 // not in yet
  const dungeon = sibling('dungeon');                                               // trips
  const party = sibling('party');                                                   // parties
  const run = dungeon ? dungeon.current(uid) : null;                                // her trip
  const found = action === 'potion' && run && run.fight === battleId && run.satchel.potions > 0; // a found potion
  const lent = action === 'potion' && !found && party && party.satchelPotion(uid, battleId, false); // a party satchel potion
  if (lent) pet.potions += 1;                                                       // lend her one
  if (found) pet.potions += 1;                                                      // lend her one from the satchel
  let fight;                                                                        // the fight after the press
  try {
    fight = battle.act(uid, pet, battleId, turn, action, now, rng, opts.username || null); // lumibattle.act (username labels the SGC account)
  } catch (error) {
    throw asPetError(error, battle, 'BattleError');                                 // its refusal
  }
  if (found) { run.satchel.potions -= 1; dungeon._save(uid, run); }                 // the one she drank was the found one
  if (lent) party.satchelPotion(uid, battleId, true);                               // take it from the party satchel
  if (fight.party && fight.status !== 'active' && party) party.afterFight(uid, pet, fight, now, rng); // the party settles the room
  else if (run && run.fight === battleId && fight.status !== 'active' && dungeon) {
    dungeon.afterFight(uid, pet, run, fight, now);                                  // clear the room or end the trip
    _narrate(uid, rng);                                                             // its line
  }
  save.save(uid, pet);                                                              // saved
  return { ...snapshot(uid, pet, now), fight };                                     // the page's view
}

/** erinne _narrate(uid, rng): the run's latest moment gets its line from the tales library. */
function _narrate(uid, rng = null) {
  const dungeon = sibling('dungeon');                                               // trips
  const tales = sibling('tales');                                                   // words
  if (!dungeon || !tales) return;                                                   // either missing: no words
  const run = dungeon.current(uid);                                                 // her trip
  if (!run) return;                                                                 // none
  run.say = tales.line(run, rng);                                                   // the line
  run.scene = tales.scene(run);                                                     // the room she is in
  if (!Array.isArray(run.log)) run.log = [];                                        // the story so far
  run.log.push(run.say);                                                            // kept with the run
  run.said_for = null;                                                              // no live line yet
  dungeon._save(uid, run);                                                          // saved
}

/** erinne dungeon_start(uid, env, now, rng): set out for an environment. INSIDE db.tx(). */
function dungeonStart(uid, env, now = nowMs(), rng = null, opts = {}) {
  uid = String(uid);                                                                // Discord id
  const pet = load(uid, now);                                                       // caught up
  if (pet.task) throw new PetError(busyLine(pet));                                  // busy
  const dungeon = sibling('dungeon');                                               // trips
  if (!dungeon) throw new PetError("Lumi Dungeons isn't open yet.");                // not in yet
  const party = sibling('party');                                                   // parties
  if (party && party.codeOf(uid)) throw new PetError('Lumi is in a party. Leave it to explore on her own.'); // in a party
  try {
    dungeon.start(uid, pet, env, now, rng, opts);                                   // lumidungeon.start
  } catch (error) {
    throw asPetError(error, dungeon, 'DungeonError');                               // its refusal
  }
  _narrate(uid, rng);                                                               // the first line
  pet.rest = 'awake'; pet.restUntil = now + AWAKE_MS;                               // off she goes
  save.save(uid, pet);                                                              // saved
  return snapshot(uid, pet, now);                                                   // the page's view
}

/** erinne dungeon_act(uid, action, way=, moves=, picks=, now=, rng=): one choice in the dungeon. INSIDE db.tx(). */
function dungeonAct(uid, action, opts = {}) {
  uid = String(uid);                                                                // Discord id
  const { way = null, moves = '', picks = null, rng = null } = opts;                // the choice
  const now = opts.now === undefined || opts.now === null ? nowMs() : opts.now;     // one clock reading
  const pet = load(uid, now);                                                       // caught up
  const dungeon = sibling('dungeon');                                               // trips
  if (!dungeon) throw new PetError("Lumi Dungeons isn't open yet.");                // not in yet
  const battle = sibling('battle');                                                 // fights
  let fight;                                                                        // a fight she walked into
  try {
    fight = dungeon.act(uid, pet, action, now, rng, { way, moves, picks, username: opts.username }); // lumidungeon.act
  } catch (error) {
    let out = asPetError(error, dungeon, 'DungeonError');                           // a dungeon refusal?
    if (out === error) out = asPetError(error, battle, 'BattleError');              // or a battle one
    throw out;                                                                      // in Lumi's words (or a bug)
  }
  _narrate(uid, rng);                                                               // the line
  save.save(uid, pet);                                                              // saved
  const out = snapshot(uid, pet, now);                                              // the page's view
  return { ...out, fight: fight || out.fight };                                     // with the fight
}

/** erinne garden_act(uid, action, item=, plot=, count=, picks=, now=, rng=): one choice in the garden. INSIDE db.tx(). */
function gardenAct(uid, action, opts = {}) {
  uid = String(uid);                                                                // Discord id
  const { item = null, plot = null, count = 0, picks = null, rng = null } = opts;   // the choice
  const now = opts.now === undefined || opts.now === null ? nowMs() : opts.now;     // one clock reading
  const pet = load(uid, now);                                                       // caught up
  const garden = sibling('garden');                                                 // the garden
  if (!garden) throw new PetError("Lumi's Garden isn't open yet.");                 // not in yet
  const dungeon = sibling('dungeon');                                               // trips
  const party = sibling('party');                                                   // parties
  const run = dungeon ? dungeon.current(uid) : null;                                // her trip
  if ((run && !run.over) || (party && party.onTrip(uid))) throw new PetError('Lumi is out exploring. The garden grows without her until she is home.'); // out
  const state = _garden(uid, pet, now);                                             // caught up
  const pantry = CATALOG.snacks.filter((snack) => snack.price).map((snack) => snack.id); // what a snack gift may be
  let said;                                                                         // what happened
  try {
    said = garden.act(uid, pet, state, action, now, rng, { item, plot, count, picks, pantry, held: MAX_HELD, username: opts.username }); // lumigarden.act
  } catch (error) {
    throw asPetError(error, garden, 'GardenError');                                 // its refusal
  }
  garden.save(uid, state);                                                          // the garden
  save.save(uid, pet);                                                              // the pet
  return { ...snapshot(uid, pet, now), said };                                      // the page's view
}

module.exports = {
  // re-exported save model (erinne names, camelCase; private helpers keep their underscore)
  GAME, HOUR, START, KINDS, BOOSTS, RARITIES, PRIZE_GAMES, GLOWS, DOORS, HOMES, GUESTBOOK_MAX, BLOCKED_MAX, MOVE_IN, NAME_MAX,
  PetError, CATALOG, HOUSE, CLOSET, BOXES,
  _WEAR: WEAR, _DECOR: DECOR, _ITEMS: ITEMS, _PRIZES: PRIZES, _SPOTS: SPOTS, _NAME: NAME_RE, _COLOUR: COLOUR_RE, _COLOUR_PAINT: COLOUR_PAINT_RE,
  loadCatalog: save.loadCatalog, loadHouse: save.loadHouse, loadCloset: save.loadCloset,
  _shelf: save.shelf, _fresh: save.fresh, _freshEstate: save.freshEstate, estateOf: save.estateOf, _save: save.save, _peek: save.peek,
  look: save.look, townSeen: save.townSeen, door: save.door, _takes: save.takes, placed: save.placed, boxes: save.boxes,
  _guestbook: save.guestbook, exists: save.exists,
  // this module
  LAST_QUARTER_HOURS, DECAY, COOLDOWN, NAP_MINUTES, NAP_ENERGY, AWAKE_MS, CUDDLE_JOY, MAX_MOMENTS, MAX_HELD, LOW, REMIND_EVERY,
  QUIET, REMIND_ORDER, ACTIONS,
  nowMs: nowMsFn, _tau, decayed, _clamp, advance, _markLow, load, _moveIn: moveInRefund, hasPlot, houseView, sign,
  snapshot, state, _garden, _health, _eat, _cool, _moment, _roll, act, episodes, _quiet,
  fightStart, fightAct, _narrate, dungeonStart, dungeonAct, gardenAct,
  _nameOf, _person, sibling,
};
