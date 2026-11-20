'use strict';

/**
 * Lumi Dungeons: BATTLES, ported from erinne mnemerynne/lumibattle.py (commit 0ddc466).
 *
 * Turn-based fights against the creatures of data/battle.json, with levels, six skill trees, stat points, fight
 * items (KIT) and magitek/cybertek mods. Two ways to fight: a solo fight (resolve: Lumi and one creature) and a
 * party's co-op fight (team_*: up to three Lumis against one to three creatures; lumiparty.js keeps it).
 *
 * The server rolls everything; the page only says which button was pressed. `rng` is anything with random() and
 * randrange(n) (systemRandom() in play, a scripted one in tests). This module never loads or saves a pet: callers
 * hand it the pet they loaded (pet/save.js) and save it. Coins go through sgc.js only (CONTRACT section 5):
 *   battle win   -> sgc.pay(uid, name, native, 'battle', 'win', `lumi-battle:${id}`)
 *   the shop     -> sgc.spend(uid, name, native, 'battle', 'shop', { key: <item id | respec | heal | potion | reset> })
 * Names follow erinne's (snake_case -> camelCase; a leading underscore kept for helpers other modules use).
 */

const fs = require('node:fs');                                                     // reading a catalog file
const path = require('node:path');                                                 // where the data lives
const crypto = require('node:crypto');                                             // the secure dice
const { getDb } = require('../db');                                                // the economy DB (lumi_battles)
const sgc = require('../sgc');                                                     // THE door to coins
const tuning = require('../tuning');                                               // prices as the page shows them
const users = require('../users');                                                 // a name when the caller has none
const save = require('../pet/save');                                               // the pet save's hooks
const { LumiError, notEnoughSGC } = require('../errors');                          // "no" answers

const DATA = path.join(__dirname, '..', 'data');                                   // src/lumi/data
const has = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key); // own key only (never a prototype's)
const dict = (obj) => Object.assign(Object.create(null), obj);                     // a lookup table with no prototype keys
const isInt = (v) => Number.isInteger(v);                                          // Python isinstance(v, int)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);     // Python isinstance(v, dict)

const GAME = 'battle';                                                             // tuning/ledger id for fights + the Outfitters
const MAX_LEVEL = 50;                                                              // the level cap
const PACE = 1.7;                                                                  // all damage is scaled by this (5-10 turn fights)
const NODE_COSTS = [1, 1, 2, 2, 3, 3, 5, 5];                                       // skill points for a tree's eight nodes (22 a tree)
const RESPEC_PRICE = 100;                                                          // native price to hand every skill point back
const POTION_PRICE = 20;                                                           // native price of one potion
const POTION_CAP = 10;                                                             // potions she can carry
const HEAL_PRICE = 50;                                                             // native price to wake her at once after a defeat
const FAINT_MS = 10 * 60_000;                                                      // otherwise she naps this long, for free
const MEND_MS = FAINT_MS;                                                          // waiting mends a whole health bar in this long
const NAP_MEND = 2;                                                                // a nap mends this many times faster
const POTION_MEND = 0.5;                                                           // a potion gives back this share of her health
const MOVE_SLOTS = 4;                                                              // moves she carries
const DEFEND_MP = 6;                                                               // MP that Defend gives back
const STATUS_TURNS = 3;                                                            // poison and burn last this many turns
const STATUS_HURT = 6;                                                             // ...and bite this percent of full health each
const STUN_CHANCE = 30;                                                            // percent chance a stun move stuns
const ELEMENTS = ['fire', 'ice', 'wind', 'spirit', 'holy', 'dark'];                // the six elements
const WHEEL = dict({                                                               // attacker -> defender multipliers
  fire: dict({ ice: 1.5, dark: 0.75 }), ice: dict({ wind: 1.5, fire: 0.75 }), wind: dict({ spirit: 1.5, ice: 0.75 }), // strong/weak pairs
  spirit: dict({ holy: 1.5, wind: 0.75 }), holy: dict({ dark: 1.5, spirit: 0.75 }), dark: dict({ fire: 1.5, holy: 0.75 }), // ...round the wheel
});
const GLOW_ELEMENT = dict({ rose: 'fire', lagoon: 'ice', starlight: 'holy', zephyr: 'wind', wisp: 'spirit', umbra: 'dark' }); // her glow is her element
const GLOW_MATCH = 1.1;                                                            // a spell of her own glow's element
const TIERS = dict({                                                               // tier: [health, attack, defense multipliers, bonus EXP]
  common: [0.60, 0.80, 0.85, 0], uncommon: [0.75, 0.90, 0.92, 5], rare: [0.90, 0.98, 1.00, 12], // tuned by simulation
  epic: [1.10, 1.06, 1.08, 25], legendary: [1.40, 1.15, 1.15, 50],                // a legendary needs the right element
});
const ENEMY_HP_GROWTH = 1.0;                                                       // enemy health grows up to this much more by level 50
const MOD_SLOTS = [['cybertek', 10], ['magitek', 15], ['cybertek', 25], ['magitek', 35], ['cybertek', 45]]; // [kind, level that opens it]
const BONUS_KEYS = ['attack', 'defense', 'magic', 'ward', 'speed', 'hp', 'mp', 'crit', 'dodge', 'coins']; // what a passive/mod may lift
const EFFECTS = [null, 'pierce', 'crit', 'first', 'poison', 'burn', 'stun', 'ward', 'drain']; // move effects (null: none)
const BODIES = ['blob', 'spark', 'bug', 'wing', 'sprout', 'imp', 'crab', 'cat', 'golem', 'ghost', 'bird', 'hound', 'jelly', 'crystal', 'drake']; // enemy shapes
const ID_RE = /^[a-z0-9-]{1,40}$/u;                                                // catalog ids

const STAT_KEYS = ['hp', 'attack', 'defense', 'magic', 'ward', 'speed', 'mp'];     // stats that take points
const STAT_NAMES = dict({ hp: 'Health', attack: 'Attack', defense: 'Defense', magic: 'Magic', ward: 'Ward', speed: 'Speed', mp: 'MP' }); // shown names
const GROWTH = dict({ hp: 8, attack: 2, defense: 1.5, magic: 2, ward: 1.5, speed: 1, mp: 2 }); // per-level growth (half fixed, half points)
const POINTS_PER_LEVEL = STAT_KEYS.length;                                         // one per stat, if spread evenly
const POINT_CAP = 3;                                                               // at most this many points a level in one stat
const STAT_RESET_PRICE = 100;                                                      // native price to take every placed point back
const TREE_STATS = dict({                                                          // what each tree leans on, for Auto
  fighter: dict({ attack: 3, hp: 2, defense: 1 }), thief: dict({ speed: 3, attack: 2 }), // physical trees
  monk: dict({ hp: 2, defense: 2, speed: 1, attack: 1 }), mage: dict({ magic: 3, mp: 2 }), // ...and spellcasters
  cleric: dict({ ward: 2, mp: 2, hp: 1, magic: 1 }), paladin: dict({ defense: 2, ward: 2, hp: 2 }), // ...and guardians
});
const USE_STATS = dict({                                                           // what each kind of action leans on, for Auto
  physical: dict({ attack: 2, speed: 1 }), magic: dict({ magic: 2, mp: 1 }), defend: dict({ defense: 1.5, ward: 1.5 }), item: dict({ hp: 1 }), // per kind
});
const KIT = dict({                                                                 // fight items, bought between fights
  ether: { name: 'Mana potion', icon: '💧', price: 25, about: 'Gives back half her MP' }, // MP back
  'x-attack': { name: 'X-Attack', icon: '⚔', price: 30, about: 'Attack and magic up a stage for the rest of the fight', stage: 'attack' }, // +attack stage
  'x-defend': { name: 'X-Defend', icon: '⛨', price: 30, about: 'Defense and ward up a stage for the rest of the fight', stage: 'defend' }, // +defend stage
  'x-speed': { name: 'X-Speed', icon: '➶', price: 30, about: 'Speed up a stage: she goes first more, and dodges more', stage: 'speed' }, // +speed stage
});
const KIT_CAP = 9;                                                                 // of each fight item she carries
const STAGE = 0.5;                                                                 // each stage adds half again
const MAX_STAGE = 2;                                                               // two stages at most (double)
const STAGED = dict({ attack: 'attack', magic: 'attack', defense: 'defend', ward: 'defend', speed: 'speed' }); // which stage lifts each stat
const SPEED_DODGE = 8;                                                             // extra dodge percent per speed stage
const TEAM_FOES = 3;                                                               // co-op fights: up to three creatures

/** Refused; the message is safe to show. A LumiError, so a route answers it as HTTP 400. */
class BattleError extends LumiError {
  constructor(message) { super(400, 'battle_refused', message); this.name = 'BattleError'; } // 400 + the words
}

/** A secure dice (erinne random.SystemRandom()): random() in [0, 1), randrange(n) in [0, n). */
function systemRandom() {
  return {
    random: () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48,                // 48 random bits as a fraction in [0, 1)
    randrange: (n) => crypto.randomInt(0, Math.max(1, n)),                         // a whole number below n
  };
}

// ------------------------------------------------------------------------------------------------ the catalog

// erinne _check_move: a move's numbers and kind are sane (enemy moves need less).
function _checkMove(move, where, enemy = false) {
  const hits = has(move, 'hits') ? move.hits : 1;                                  // default one hit
  const effect = has(move, 'effect') ? move.effect : null;                         // default no effect
  if (!isObj(move) || !move.name || !isInt(move.power) || move.power < 0 || move.power > 200 // power 0..200
    || !isInt(move.accuracy) || move.accuracy < 30 || move.accuracy > 100          // accuracy 30..100
    || !EFFECTS.includes(effect) || typeof hits !== 'number' || hits < 1 || hits > 5) { // a known effect, 1-5 hits
    throw new Error(`Lumi Pet's battles: ${where} has a bad move.`);              // refuse the catalog
  }
  if (enemy) return;                                                               // enemy moves stop here
  const mp = has(move, 'mp') ? move.mp : 0;                                        // MP cost
  const heal = has(move, 'heal') ? move.heal : 0;                                  // heal percent
  if (![...ELEMENTS, 'none', 'glow'].includes(move.element) || typeof move.magic !== 'boolean' // element + kind
    || typeof mp !== 'number' || mp < 0 || mp > 50 || typeof heal !== 'number' || heal < 0 || heal > 100 // MP and heal ranges
    || (move.power === 0 && !heal && effect !== 'ward')) {                         // a 0-power move must help somehow
    throw new Error(`Lumi Pet's battles: ${where} has a bad move.`);              // refuse the catalog
  }
}

// erinne _check_bonus: a passive's or mod's bonus is {known key: 1..50}.
function _checkBonus(bonus, where) {
  if (!isObj(bonus) || !Object.keys(bonus).length                                  // a non-empty object
    || Object.entries(bonus).some(([k, v]) => !BONUS_KEYS.includes(k) || !isInt(v) || v < 1 || v > 50)) { // known keys, 1..50
    throw new Error(`Lumi Pet's battles: ${where} has a bad bonus.`);             // refuse the catalog
  }
}

/**
 * erinne load_catalog: trees, mods and enemies, checked at start so a bad edit never surfaces mid-fight.
 * @param {string|object} [source] a path to a battle.json, an already-parsed object, or nothing (the shipped file)
 */
function loadCatalog(source) {
  const data = isObj(source) ? source : JSON.parse(fs.readFileSync(source || path.join(DATA, 'battle.json'), 'utf8')); // the data
  const seen = new Set();                                                          // ids used so far
  const fresh = (thing, where) => {                                                // a new, well-formed id and a name
    if (!isObj(thing) || !ID_RE.test(String(thing.id === undefined ? '' : thing.id)) || seen.has(thing.id) || !thing.name) {
      throw new Error(`Lumi Pet's battles: a bad or repeated id among the ${where}.`); // refuse
    }
    seen.add(thing.id);                                                            // remember it
  };
  const listOf = (v) => (Array.isArray(v) && v.length ? v : [null]);              // Python `x or [None]`
  for (const move of listOf(data.basics)) { fresh(move, 'basic moves'); _checkMove(move, move.id); } // the two basics
  for (const tree of listOf(data.trees)) {
    fresh(tree, 'trees');                                                          // the tree itself
    if (!Array.isArray(tree.nodes) || tree.nodes.length !== NODE_COSTS.length) throw new Error(`Lumi Pet's battles: the ${tree.id} tree needs ${NODE_COSTS.length} skills.`); // eight nodes
    const places = new Set();                                                      // [column,row] spots taken
    const earlier = new Map();                                                     // earlier skill id -> its row
    for (const node of tree.nodes) {
      fresh(node, `${tree.id} skills`);                                            // the node's id
      const { needs, at } = node;                                                  // what leads to it, where it sits
      if (!Array.isArray(needs) || needs.some((need) => !earlier.has(need)) || (!needs.length && earlier.size)) { // only earlier skills; one root
        throw new Error(`Lumi Pet's battles: ${node.id} must need skills listed before it in its tree (only the first needs none).`);
      }
      if (!Array.isArray(at) || at.length !== 2 || !at.every(isInt) || !(at[0] >= 0 && at[0] <= 2 && at[1] >= 0 && at[1] <= 5) || places.has(`${at[0]},${at[1]}`)) { // its own place
        throw new Error(`Lumi Pet's battles: ${node.id} needs its own place in the tree: [column 0-2, row 0-5].`);
      }
      if (needs.some((need) => earlier.get(need) >= at[1])) {                     // below what it needs
        throw new Error(`Lumi Pet's battles: ${node.id} must sit on a lower row than the skills it needs, so the tree reads downwards.`);
      }
      places.add(`${at[0]},${at[1]}`);                                             // take the place
      earlier.set(node.id, at[1]);                                                 // remember its row
      if (node.kind === 'move') _checkMove(node, node.id);                         // a move skill
      else if (node.kind === 'passive') _checkBonus(node.bonus, node.id);          // a passive skill
      else throw new Error(`Lumi Pet's battles: ${node.id} is neither a move nor a passive.`); // anything else
    }
  }
  for (const mod of listOf(data.mods)) {
    fresh(mod, 'mods');                                                            // the mod's id
    _checkBonus(mod.bonus, mod.id);                                                // its bonus
    if (!['magitek', 'cybertek'].includes(mod.tek) || !isInt(mod.price) || mod.price < 0 || mod.price > 100_000) { // 0: only found in the dungeon
      throw new Error(`Lumi Pet's battles: ${mod.id} needs a kind and a price.`);  // refuse
    }
  }
  for (const enemy of listOf(data.enemies)) {
    fresh(enemy, 'enemies');                                                       // the enemy's id
    const lists = ['weak', 'resist', 'immune'].map((key) => enemy[key]);           // its element lists
    const flat = lists.every(Array.isArray) ? lists.flat() : null;                 // all of them together
    if (!(enemy.tier in TIERS) || !BODIES.includes(enemy.body) || ![...ELEMENTS, 'none', 'mirror'].includes(enemy.element) // tier, body, element
      || !flat || flat.some((e) => !ELEMENTS.includes(e)) || new Set(flat).size !== flat.length // known elements, none repeated
      || !/^#[0-9a-f]{6}$/u.test(String(enemy.colour))) {                          // a colour
      throw new Error(`Lumi Pet's battles: ${enemy.id} has a bad tier, body, colour or element.`); // refuse
    }
    const shape = enemy.shape;                                                     // its stat shape
    const keys = isObj(shape) ? Object.keys(shape).sort().join(',') : '';          // which keys it has
    if (keys !== 'atk,def,hp,res,spd' || Object.values(shape).some((v) => typeof v !== 'number' || v < 0.3 || v > 2.5)) { // exactly five, 0.3..2.5
      throw new Error(`Lumi Pet's battles: ${enemy.id} has a bad shape.`);         // refuse
    }
    const moves = Array.isArray(enemy.moves) ? enemy.moves : [];                   // its moves
    for (const move of moves) _checkMove(move, enemy.id, true);                    // each sane
    if (!moves.some((m) => m.level === 1) || moves.some((m) => !(typeof m.level === 'number' && m.level >= 1 && m.level <= MAX_LEVEL))) { // one at level 1
      throw new Error(`Lumi Pet's battles: ${enemy.id} needs a move it knows at level 1.`); // refuse
    }
  }
  for (const tier of Object.keys(TIERS)) {                                         // every tier can always be fought
    if (!data.enemies.some((enemy) => enemy.tier === tier)) throw new Error(`Lumi Pet's battles: no ${tier} enemy.`); // refuse
  }
  return data;                                                                     // checked
}

const CATALOG = loadCatalog();                                                     // battle.json (throws at start if broken)
const _NODES = dict(Object.fromEntries(CATALOG.trees.flatMap((tree) => tree.nodes.map((node, i) => [node.id, { ...node, tree: tree.id, index: i }])))); // skill id -> node + tree + index
const _BASICS = dict(Object.fromEntries(CATALOG.basics.map((move) => [move.id, move]))); // basic move id -> move
const _MODS = dict(Object.fromEntries(CATALOG.mods.map((mod) => [mod.id, mod])));  // mod id -> mod
const _ENEMIES = dict(Object.fromEntries(CATALOG.enemies.map((enemy) => [enemy.id, enemy]))); // enemy id -> enemy

/** erinne fresh_fields(): what a pet needs for battles (pet/save.js already merges these under every save). */
function freshFields() {
  return {
    level: 1, exp: 0, skills: [], moves: Object.keys(_BASICS), mods: new Array(MOD_SLOTS.length).fill(null), mods_owned: [], // progress
    potions: 0, faint_until: 0, wins: 0, losses: 0, wound: 0.0,                    // fight state
    stat_points: Object.fromEntries(STAT_KEYS.map((key) => [key, 0])), auto_stats: false, stat_reset_free: 0, // placed points, Auto, a free reset
    used: {}, kit: {},                                                             // how often each action was used; fight items held
  };
}

// ------------------------------------------------------------------------------------------------ her health between trips

/** erinne health: her health right now outside the dungeon (never below 1, never shown full while any is missing). */
function health(pet) {
  const full = stats(pet).hp;                                                      // her whole bar
  return pet.wound <= 0 ? full : Math.max(1, Math.min(full - 1, Math.floor(full * (1 - pet.wound)))); // what's left
}

/** erinne hurt: remember the health she came home with, as the share that is missing. */
function hurt(pet, hp) {
  pet.wound = Math.min(1.0, Math.max(0.0, 1 - hp / stats(pet).hp));                // 0 = whole, 1 = none left
}

/** erinne mend: give back this share of her whole health (food, a potion, time passing). */
function mend(pet, share) {
  pet.wound = Math.max(0.0, (Number(pet.wound) || 0) - share);                     // never below whole
}

/** erinne mends_in: milliseconds of plain waiting until she is whole again. */
function mendsIn(pet) {
  return Math.ceil(pet.wound * MEND_MS);                                           // share missing x a whole bar's time
}

// ------------------------------------------------------------------------------------------------ Lumi's numbers

/** EXP needed to leave this level (Touhou Trader's curve). */
function levelThreshold(level) {
  return 20 + level * 15;                                                          // 35 at level 1
}

/** Skill points spent on learned skills. */
function spent(pet) {
  return pet.skills.filter((skill) => skill in _NODES).reduce((sum, skill) => sum + NODE_COSTS[_NODES[skill].index], 0); // cost of each learned node
}

/** Skill points waiting to be spent: one per level after the first. */
function points(pet) {
  return pet.level - 1 - spent(pet);                                               // earned minus spent
}

/** Every percentage her passives and fitted (open) mods add up to. */
function bonuses(pet) {
  const total = Object.fromEntries(BONUS_KEYS.map((key) => [key, 0]));            // every key at 0
  const sources = pet.skills.filter((s) => s in _NODES).map((s) => _NODES[s].bonus); // passives (moves have none)
  (pet.mods || []).forEach((m, i) => {                                             // fitted mods
    if (i < MOD_SLOTS.length && typeof m === 'string' && m in _MODS && pet.level >= MOD_SLOTS[i][1]) sources.push(_MODS[m].bonus); // only in an open slot
  });
  for (const bonus of sources.filter(Boolean)) {                                   // each real bonus
    for (const [key, amount] of Object.entries(bonus)) total[key] += amount;      // add it up
  }
  return total;                                                                    // percent per key
}

/** Touhou Trader's stat lines at a level, with a magic pair beside the physical one. */
function baseStats(level) {
  return { hp: 50 + 8 * level, attack: 10 + 2 * level, defense: 8 + 1.5 * level, magic: 10 + 2 * level, // physical + magic
    ward: 8 + 1.5 * level, speed: 10 + level, mp: 20 + 2 * level };               // ward, speed, MP
}

/** Her numbers before passives and mods: level 1's, half of each level's growth, and her placed points. */
function lumiBase(pet) {
  const one = baseStats(1);                                                        // level 1's numbers
  const gained = pet.level - 1;                                                    // levels since
  const placed = pet.stat_points || {};                                            // points placed by hand or Auto
  const out = {};                                                                  // stat -> number
  for (const key of STAT_KEYS) {
    const held = Math.trunc(Number(has(placed, key) ? placed[key] : 0)) || 0;      // points in this stat
    out[key] = one[key] + GROWTH[key] * gained / 2 + GROWTH[key] / 2 * Math.min(held, POINT_CAP * gained); // fixed half + points
  }
  return out;                                                                      // spread evenly: baseStats(level)
}

/** Her fighting numbers right now: level and points, lifted by passives and mods. */
function stats(pet) {
  const extra = bonuses(pet);                                                      // percentages
  const base = lumiBase(pet);                                                      // raw numbers
  const out = {};                                                                  // the result
  for (const [key, value] of Object.entries(base)) out[key] = Math.floor(value * (1 + extra[key] / 100)); // lifted, rounded down
  return { ...out, crit: extra.crit, dodge: extra.dodge, coins: extra.coins };     // plus the pure percentages
}

// ------------------------------------------------------------------------------------------------ stat points

/** Points her levels have earned. */
function statPointsEarned(pet) {
  return POINTS_PER_LEVEL * (pet.level - 1);                                       // seven a level
}

/** Points waiting to be placed. */
function statPointsLeft(pet) {
  return statPointsEarned(pet) - STAT_KEYS.reduce((sum, key) => sum + (Number(pet.stat_points[key]) || 0), 0); // earned minus placed
}

/** The most points any one stat may hold at her level. */
function statCap(pet) {
  return POINT_CAP * (pet.level - 1);                                              // three a level
}

// What a remembered action leans on: 'physical', 'magic', 'defend' or 'item' (null: running doesn't count).
function _useKind(action) {
  if (action === 'defend') return 'defend';                                        // bracing
  if (action in KIT || action === 'potion') return 'item';                         // an item
  const move = (typeof action === 'string' && (_BASICS[action] || _NODES[action])) || null; // a move by id
  if (!move) return null;                                                          // not counted
  return move.magic ? 'magic' : 'physical';                                        // spell or punch
}

/** Count one use of a move (by id), 'defend' or an item, for Auto. */
function remember(pet, action) {
  if (_useKind(action)) pet.used[action] = (Number(pet.used[action]) || 0) + 1;    // one more use
}

/** How much Auto favours each stat: 1 each, plus her trees and the actions she uses most. */
function autoWeights(pet) {
  const weight = Object.fromEntries(STAT_KEYS.map((key) => [key, 1.0]));           // never nothing
  for (const skill of pet.skills) {
    const node = _NODES[skill];                                                    // the learned node
    const leans = node && TREE_STATS[node.tree] ? TREE_STATS[node.tree] : {};      // its tree's leanings
    for (const [key, amount] of Object.entries(leans)) weight[key] += amount / 2;  // each skill counts
  }
  const counted = Object.entries(pet.used || {}).filter(([action, n]) => _useKind(action) && n > 0); // real uses only
  const total = counted.reduce((sum, [, n]) => sum + n, 0);                        // all uses
  for (const [action, n] of counted) {
    for (const [key, amount] of Object.entries(USE_STATS[_useKind(action)])) weight[key] += amount * 3 * n / total; // share of use
  }
  return weight;                                                                   // stat -> weight
}

/** Place `count` points (all waiting by default) the way autoWeights leans (D'Hondt), never past the cap. */
function placeAuto(pet, count = null) {
  const n = count === null || count === undefined ? statPointsLeft(pet) : Math.min(count, statPointsLeft(pet)); // how many
  const weight = autoWeights(pet);                                                 // leanings
  const cap = statCap(pet);                                                        // per-stat limit
  const placed = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));             // what this call placed
  for (let i = 0; i < Math.max(0, n); i += 1) {
    const room = STAT_KEYS.filter((key) => (Number(pet.stat_points[key]) || 0) < cap); // stats with space
    if (!room.length) break;                                                       // all full
    let best = null;                                                               // the stat furthest below its share
    let bestScore = -Infinity;                                                     // its score
    for (const key of room) {                                                      // in STAT_KEYS order: ties go to the first
      const score = weight[key] / (1 + (Number(pet.stat_points[key]) || 0));       // D'Hondt quotient
      if (score > bestScore) { best = key; bestScore = score; }                    // strictly better only
    }
    pet.stat_points[best] = (Number(pet.stat_points[best]) || 0) + 1;              // place one
    placed[best] += 1;                                                             // count it
  }
  return Object.fromEntries(Object.entries(placed).filter(([, v]) => v));          // only stats that got some
}

/** Add EXP; levels follow, and with Auto on their points place themselves. Returns levels gained. */
function levelUp(pet, gained) {
  const before = pet.level;                                                        // to count levels
  pet.exp += gained;                                                               // add the EXP
  while (pet.level < MAX_LEVEL && pet.exp >= levelThreshold(pet.level)) {          // as many levels as it covers
    pet.exp -= levelThreshold(pet.level);                                          // spend it
    pet.level += 1;                                                                // up one
  }
  if (pet.level === MAX_LEVEL) pet.exp = 0;                                        // nothing to gain at the cap
  if (pet.level > before && pet.auto_stats) placeAuto(pet);                        // Auto places the new points
  return pet.level - before;                                                       // levels gained
}

/** erinne settle_points: a pre-stat-point save gets every earned point, placed by Auto, plus one free reset. */
function settlePoints(pet) {
  pet.stat_points = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));          // start empty
  placeAuto(pet);                                                                  // place them all
  pet.stat_reset_free = 1;                                                         // one free reset
}

/** Every move she could equip: the basics and each learned move skill. */
function knownMoves(pet) {
  return [...Object.values(_BASICS), ...pet.skills.filter((s) => s in _NODES && _NODES[s].kind === 'move').map((s) => _NODES[s])]; // basics + learned
}

// What a creature of this element is weak to and resists, from the wheel: [weak, resist].
function _defences(element) {
  return [ELEMENTS.filter((a) => WHEEL[a][element] === 1.5), ELEMENTS.filter((a) => WHEEL[a][element] === 0.75)]; // by the wheel
}

/** erinne _lumi: Lumi as she walks into a fight (full health unless `carry` says what she has left). */
function _lumi(pet, carry = null) {
  const numbers = stats(pet);                                                      // her numbers
  const element = GLOW_ELEMENT[pet.glow] || 'fire';                                // her glow's element
  const known = Object.fromEntries(knownMoves(pet).map((move) => [move.id, move])); // id -> move
  const strip = (move) => Object.fromEntries(Object.entries(move).filter(([k]) => !['tree', 'index', 'kind', 'needs', 'at'].includes(k))); // just the move
  let moves = (pet.moves || []).filter((m) => has(known, m)).map((m) => strip(known[m])); // her equipped moves
  if (!moves.length) moves = [{ ..._BASICS.pounce }];                              // never empty-pawed
  for (const move of moves) if (move.element === 'glow') move.element = element;  // glow moves take her colour
  const [weak, resist] = _defences(element);                                       // her weaknesses
  const hp = carry ? Math.max(1, Math.min(numbers.hp, carry.hp)) : numbers.hp;     // carried bruises or full
  const mp = carry ? Math.max(0, Math.min(numbers.mp, carry.mp)) : numbers.mp;     // carried MP or full
  return { name: pet.name || 'Lumi', side: 'lumi', level: pet.level, element, hp, hpMax: numbers.hp, // who and how healthy
    mp, mpMax: numbers.mp, stats: numbers, crit: numbers.crit, dodge: numbers.dodge, // numbers
    moves, weak, resist, immune: [], status: {}, stages: {} };                     // moves and conditions
}

/** erinne _enemy: an enemy scaled to this fight (its level follows hers; health grows with her skill points). */
function _enemy(entry, level, lumiLevel, lumiElement) {
  const [healthMul, attack, defense] = TIERS[entry.tier];                          // tier multipliers
  const base = baseStats(level);                                                   // its level's lines
  const shape = entry.shape;                                                       // its own shape
  const growth = 1 + ENEMY_HP_GROWTH * (lumiLevel - 1) / (MAX_LEVEL - 1);          // keeps pace with her points
  const hp = Math.max(1, Math.floor(base.hp * healthMul * shape.hp * growth));     // its health
  const element = entry.element === 'mirror' ? lumiElement : entry.element;       // the Prism Shard copies her glow
  let weak = [...entry.weak];                                                      // what hurts it
  let resist = [...entry.resist];                                                  // what it shrugs off
  if (entry.element === 'mirror') { weak = _defences(lumiElement)[0]; resist = [lumiElement]; } // breaks to what beats her
  const moves = entry.moves.filter((m) => m.level <= level).map((m) => ({          // the moves it knows at this level
    name: m.name, power: m.power, accuracy: m.accuracy, magic: Boolean(entry.magic), element, // what it is
    effect: has(m, 'effect') ? m.effect : null, hits: has(m, 'hits') ? m.hits : 1, mp: 0, // effect, hits, free
  }));
  const numbers = {                                                                // its fighting numbers
    attack: Math.floor(base.attack * attack * shape.atk), magic: Math.floor(base.attack * attack * shape.atk), // claws and spells alike
    defense: Math.floor(base.defense * defense * shape.def), ward: Math.floor(base.defense * defense * shape.res), // armour and ward
    speed: Math.floor(base.speed * shape.spd),                                     // speed
  };
  return { id: entry.id, name: entry.name, side: 'enemy', tier: entry.tier, body: entry.body, colour: entry.colour, // who
    level, element, hp, hpMax: hp, stats: numbers, crit: 0, dodge: entry.dodge || 0, // numbers
    thorns: entry.thorns || 0, moves, weak, resist, immune: [...entry.immune], status: {}, stages: {} }; // the rest
}

// ------------------------------------------------------------------------------------------------ one turn

/** A fighter's stat with its X-item stages. */
function statOf(fighter, key) {
  const stages = fighter.stages || {};                                             // stages so far
  return fighter.stats[key] * (1 + STAGE * (stages[STAGED[key]] || 0));            // half again per stage
}

// erinne _multiplier: element against the defender (and her glow match on her own spells).
function _multiplier(attacker, defender, move) {
  const element = move.element;                                                    // the move's element
  if (element === 'none') return 1.0;                                              // plain
  if (defender.immune.includes(element)) return 0.0;                               // no effect
  const mult = defender.weak.includes(element) ? 1.5 : defender.resist.includes(element) ? 0.75 : 1.0; // weak / resisted / plain
  return mult * (attacker.side === 'lumi' && move.magic && element === attacker.element ? GLOW_MATCH : 1.0); // her own glow's spell
}

/** erinne _strike: one use of a move (accuracy, element, attack vs defense or magic vs ward, then its effect). */
function _strike(state, attacker, defender, move, rng, guarding = false) {
  const log = state.log;                                                           // the fight's story
  if (move.heal || (move.power === 0 && move.effect === 'ward')) {                 // a move that helps its user
    if (move.heal) {
      const before = attacker.hp;                                                  // to report the gain
      attacker.hp = Math.min(attacker.hpMax, attacker.hp + Math.max(1, Math.floor(attacker.hpMax * move.heal / 100))); // heal, never overfill
      log.push(`${attacker.name} used ${move.name}: +${attacker.hp - before} HP.`); // say so
    }
    if (move.effect === 'ward') {
      attacker.status.ward = (move.turns || 2) + 1;                                // +1: this turn's end takes one off
      log.push(!move.heal ? `${attacker.name} used ${move.name}: damage is halved for ${move.turns || 2} turns.` : `A ward shimmers around ${attacker.name}.`); // say so
    }
    return;                                                                        // nothing hits the other side
  }
  let dealt = 0;                                                                   // damage done in all
  const mult = _multiplier(attacker, defender, move);                              // element multiplier
  if (mult === 0) { log.push(`${attacker.name} used ${move.name}. It has no effect on ${defender.name}!`); return; } // immune
  const powerUp = attacker.side === 'lumi' && (has(attacker, 'boost') ? attacker.boost : state.boost) === 'power'; // a treat's power boost
  const guardUp = defender.side === 'lumi' && (has(defender, 'boost') ? defender.boost : state.boost) === 'guard'; // a treat's guard boost
  const guarded = guarding || Boolean(defender.guarding);                          // a co-op Lumi who chose Defend
  const dodge = defender.dodge + SPEED_DODGE * ((defender.stages || {}).speed || 0); // dodge with speed stages
  const hits = move.hits || 1;                                                     // how many blows
  for (let i = 0; i < hits; i += 1) {
    if (defender.hp <= 0) break;                                                   // already down
    if (rng.random() * 100 >= move.accuracy - (guarded ? 5 : 0) - dodge) { log.push(`${attacker.name}'s ${move.name} missed!`); continue; } // a miss
    const power = statOf(attacker, move.magic ? 'magic' : 'attack');               // attack or magic
    const guard = statOf(defender, move.magic ? 'ward' : 'defense') * (move.effect === 'pierce' ? 0.7 : 1); // defense or ward
    let damage = Math.floor((((2 * attacker.level / 5 + 2) * move.power * power / Math.max(1, guard)) / 50 + 2) * PACE); // the formula
    damage = Math.floor(damage * (0.85 + rng.random() * 0.15) * mult);           // roll and element
    const crit = rng.random() * 100 < attacker.crit + (move.effect === 'crit' ? 25 : 0); // a critical hit?
    if (crit) damage = Math.floor(damage * 1.5);                                   // half again
    if (powerUp) damage = Math.floor(damage * 1.1);                                // a power treat
    if (guardUp) damage = Math.floor(damage * 0.9);                                // a guard treat
    if (guarded) damage = Math.floor(damage * 0.5);                                // braced
    if (defender.status.ward) damage = Math.floor(damage * 0.5);                   // warded
    damage = Math.max(1, damage);                                                  // at least one
    defender.hp = Math.max(0, defender.hp - damage);                               // take it
    dealt += damage;                                                               // count it
    log.push(`${attacker.name} used ${move.name}: ${damage} damage` + (guarded ? ' (guarded)' : '') // the line
      + (crit ? ', a critical hit!' : mult > 1.2 ? ' — super effective!' : mult < 1 ? ' — resisted.' : '.')); // and how it went
    if (defender.thorns && !move.magic && attacker.hp > 0) {                       // thorns prick claws, not spells
      const pricked = Math.max(1, Math.floor(damage * defender.thorns / 100));     // a share back
      attacker.hp = Math.max(0, attacker.hp - pricked);                            // ouch
      log.push(`${defender.name}'s thorns prick ${attacker.name} for ${pricked}.`); // say so
    }
  }
  if (!dealt) return;                                                              // nothing landed: no effect
  const effect = move.effect;                                                      // its effect
  if (effect === 'drain') {
    attacker.hp = Math.min(attacker.hpMax, attacker.hp + Math.floor(dealt / 2));   // drain half
    log.push(`${attacker.name} drains ${Math.floor(dealt / 2)} HP.`);              // say so
  } else if ((effect === 'poison' || effect === 'burn') && defender.hp > 0) {
    defender.status[effect] = STATUS_TURNS;                                        // poisoned or burning
    log.push(`${defender.name} is ${effect === 'poison' ? 'poisoned' : 'burning'}!`); // say so
  } else if (effect === 'stun' && defender.hp > 0 && rng.random() * 100 < STUN_CHANCE) {
    defender.status.stun = 1;                                                      // stunned
    log.push(`${defender.name} is stunned!`);                                      // say so
  }
}

// erinne _stunned: whether a stun costs this fighter its action (used up either way).
function _stunned(state, who) {
  const stun = who.status.stun;                                                    // a stun waiting?
  delete who.status.stun;                                                          // used up
  if (!stun) return false;                                                         // none
  state.log.push(`${who.name} is stunned and can't move!`);                        // say so
  return true;                                                                     // turn lost
}

// The end of a turn/round for one fighter: poison and burn bite (if `bite`), wards fade, spent statuses go.
function endOfTurn(state, who, bite) {
  for (const hurtBy of ['poison', 'burn']) {
    if (who.status[hurtBy] && who.hp > 0 && bite()) {                              // still suffering
      const loss = Math.max(1, Math.floor(who.hpMax * STATUS_HURT / 100));         // its bite
      who.hp = Math.max(0, who.hp - loss);                                         // take it
      state.log.push(`${who.name} takes ${loss} from the ${hurtBy}.`);             // say so
      who.status[hurtBy] -= 1;                                                     // one turn less
    }
  }
  if (who.status.ward) who.status.ward -= 1;                                       // a ward fades
  who.status = Object.fromEntries(Object.entries(who.status).filter(([, left]) => left > 0)); // drop spent ones
}

/** erinne resolve: one solo turn in place: Lumi's action and the enemy's reply. Sets state.outcome when over. */
function resolve(state, action, rng) {
  const lumi = state.player;                                                       // her
  const enemy = state.enemy;                                                       // it
  const reply = enemy.moves[rng.randrange(enemy.moves.length)];                    // its reply, chosen first
  const enemyActs = (guarding = false) => {                                        // the enemy's turn
    if (enemy.hp > 0 && lumi.hp > 0 && !_stunned(state, enemy)) _strike(state, enemy, lumi, reply, rng, guarding); // if it can
  };
  if (_stunned(state, lumi)) enemyActs();                                          // she loses her action
  else if (action === 'run') {
    if (rng.random() < 0.75) {                                                     // three times in four
      state.outcome = 'ran';                                                       // away
      state.log.push(`${lumi.name} darts away safely.`);                           // say so
      state.log = state.log.slice(-8);                                             // keep the last few lines
      return;                                                                      // nothing else happens
    }
    state.log.push(`${lumi.name} couldn't get away!`);                             // stuck
    enemyActs();                                                                   // and it hits
  } else if (action === 'potion' || action in KIT) {
    useItem(state, lumi, lumi, action);                                            // the item's effect
    enemyActs();                                                                   // then the reply
  } else if (action === 'defend') {
    lumi.mp = Math.min(lumi.mpMax, lumi.mp + DEFEND_MP);                           // gather MP
    state.log.push(`${lumi.name} braces and gathers her glow.`);                   // say so
    enemyActs(true);                                                               // its hit is halved
  } else {
    const move = lumi.moves[Number(action.slice(4))];                              // "moveN"
    lumi.mp -= move.mp || 0;                                                       // pay its MP
    const mine = statOf(lumi, 'speed');                                            // her speed
    const theirs = statOf(enemy, 'speed');                                         // its speed
    const first = move.effect === 'first' || mine > theirs || (mine === theirs && rng.random() < 0.5); // who goes first
    if (first) { _strike(state, lumi, enemy, move, rng); enemyActs(); }            // her, then it
    else { enemyActs(); if (lumi.hp > 0) _strike(state, lumi, enemy, move, rng); } // it, then her if she's standing
  }
  for (const who of [lumi, enemy]) endOfTurn(state, who, () => lumi.hp > 0 && enemy.hp > 0); // statuses bite while both stand
  if (lumi.hp <= 0) state.outcome = 'defeat';                                      // she's down
  else if (enemy.hp <= 0) state.outcome = 'victory';                               // it's down
  state.log = state.log.slice(-8);                                                 // keep the last few lines
}

// ------------------------------------------------------------------------------------------------ fight items

/** Why this item would do nothing for this fighter (words to show), or null if it helps. */
function itemRefusal(target, item, giver = '') {
  const who = target.name;                                                         // whose
  if (target.hp <= 0) return `${who} has fainted. Only a rest at home helps now.`; // too late
  if (item === 'potion' && target.hp >= target.hpMax) return `${who} is already at full health.`; // no need
  if (item === 'ether' && target.mp >= target.mpMax) return `${who}'s MP is already full.`; // no need
  const stage = item in KIT ? KIT[item].stage : undefined;                         // an X item's stage
  if (stage && ((target.stages || {})[stage] || 0) >= MAX_STAGE) return `${who}'s ${KIT[item].name.replace(/^X-/u, '').toLowerCase()} can't go any higher this fight.`; // maxed
  return null;                                                                     // it helps
}

/** Does she have one of this item in her pocket? */
function hasItem(pet, item) {
  return item === 'potion' ? pet.potions > 0 : (Number((pet.kit || {})[item]) || 0) > 0; // potions or kit
}

/** Use one up from her pocket (refuses if there isn't one). */
function takeItem(pet, item) {
  if (!hasItem(pet, item)) {                                                       // none left
    throw new BattleError(item === 'potion' ? "No potions left. Lumi Dungeons' Battle tab sells them between fights."
      : `No ${KIT[item].name} left. Lumi Dungeons' Battle tab sells them.`);       // say where to buy
  }
  if (item === 'potion') pet.potions -= 1;                                         // one potion
  else pet.kit[item] -= 1;                                                         // one kit item
}

/** An item's effect on a fighter (the caller checked it helps and took it from a pocket). */
function useItem(state, giver, target, item) {
  const log = state.log;                                                           // the story
  const by = giver === target ? '' : `${giver.name} gives ${target.name} `;        // a friend's gift?
  if (item === 'potion') {
    const before = target.hp;                                                      // to report
    target.hp = Math.min(target.hpMax, target.hp + Math.max(1, Math.floor(target.hpMax / 2))); // half her health back
    log.push((by ? by + 'a potion: ' : 'The potion restores ') + `${target.hp - before} HP` + (by ? ' back.' : '.')); // say so
  } else if (item === 'ether') {
    const before = target.mp;                                                      // to report
    target.mp = Math.min(target.mpMax, target.mp + Math.max(1, Math.floor(target.mpMax / 2))); // half her MP back
    log.push((by ? by + 'a mana potion: ' : 'The mana potion restores ') + `${target.mp - before} MP` + (by ? ' back.' : '.')); // say so
  } else {
    const stage = KIT[item].stage;                                                 // which stage
    target.stages = target.stages || {};                                           // make room
    target.stages[stage] = Math.min(MAX_STAGE, (target.stages[stage] || 0) + 1);   // up one, capped
    const words = { attack: 'attack and magic', defend: 'defense and ward', speed: 'speed' }[stage]; // what went up
    log.push((by ? by + `an ${KIT[item].name}: ` : `${KIT[item].name}! `) + `${target.name}'s ${words} go up.`); // say so
  }
}

// ------------------------------------------------------------------------------------------------ a co-op fight (lumiparty.js)

/** One Lumi for a co-op fight: her numbers, moves, glow, treat boost, and whose she is (Discord id string). */
function teamFighter(pet, userId, carry) {
  return { ..._lumi(pet, carry), user: String(userId), boost: has(pet, 'boost') ? pet.boost : null, guarding: false }; // plus owner, boost
}

/** One creature for a co-op fight, by catalog id. */
function teamFoe(entryId, level, lumiLevel, lumiElement) {
  return _enemy(_ENEMIES[entryId], level, lumiLevel, lumiElement);                 // scaled like a solo one
}

/** A co-op fight: rounds of every standing Lumi in seat order, then every standing creature. */
function teamStart(lumis, foes) {
  const names = foes.map((f) => f.name);                                           // who appears
  const fight = { lumis, foes, round: 1, side: 'lumis', acted: [], at: 0, turn: 0, outcome: null, // the fight
    log: [names.length === 1 ? `A wild ${names[0]} appears!` : `A pack appears: ${names.join(', ')}!`], // its first line
    reward: null, used: {} };                                                      // nothing yet
  fight.at = _teamNextLumi(fight);                                                 // the first to act
  return fight;                                                                    // ready
}

// Seats (indexes) of fighters still standing.
function _standing(fighters) {
  return fighters.map((f, i) => (f.hp > 0 ? i : -1)).filter((i) => i >= 0);       // hp > 0
}

// The next standing Lumi this round who hasn't acted; null once they all have.
function _teamNextLumi(fight) {
  const next = _standing(fight.lumis).find((i) => !fight.acted.includes(i));       // first who hasn't
  return next === undefined ? null : next;                                         // or null
}

// Sets fight.outcome when a side is down; true when it's over.
function _teamOver(fight) {
  if (!_standing(fight.foes).length) fight.outcome = 'victory';                    // every creature down
  else if (!_standing(fight.lumis).length) fight.outcome = 'defeat';               // every Lumi down
  return fight.outcome !== null && fight.outcome !== undefined;                    // over?
}

// Accepts erinne's keyword `target=` as either { target } or a bare number/null.
function targetOf(opts) {
  if (opts && typeof opts === 'object') return opts.target === undefined ? null : opts.target; // { target }
  return opts === undefined ? null : opts;                                         // a bare value
}

/** Why this Lumi (seat) can't do this now, or null. Items are checked by the caller. opts: { target } */
function teamRefusal(fight, seat, action, opts) {
  const target = targetOf(opts);                                                   // the creature aimed at
  if (fight.outcome) return 'That fight is over.';                                 // too late
  if (fight.at !== seat) {                                                         // not her turn
    const who = fight.at !== null && fight.at !== undefined ? fight.lumis[fight.at].name : 'the creatures'; // whose it is
    return `It's ${who}'s turn.`;                                                  // say so
  }
  const lumi = fight.lumis[seat];                                                  // her
  if (typeof action === 'string' && action.startsWith('move')) {
    const index = action.slice(4);                                                 // "N"
    if (!/^\d+$/u.test(index) || Number(index) >= lumi.moves.length) return `${lumi.name} doesn't have that move ready.`; // no such move
    if ((lumi.moves[Number(index)].mp || 0) > lumi.mp) return 'Not enough MP for that. Defend to gather some, or a friend can give a mana potion.'; // short of MP
    if (target !== null && !(isInt(target) && target >= 0 && target < fight.foes.length && fight.foes[target].hp > 0)) return 'That creature is already down. Choose another.'; // bad aim
  } else if (!['defend', 'run', 'potion'].includes(action) && !(action in KIT)) {
    return `${lumi.name} doesn't know that one.`;                                  // unknown action
  }
  return null;                                                                     // allowed
}

/** One Lumi's action in a co-op fight (teamRefusal said yes; an item was taken from its giver). opts: { target } */
function teamAct(fight, seat, action, rng, opts) {
  const target = targetOf(opts);                                                   // aim (move) or friend (item)
  const lumi = fight.lumis[seat];                                                  // her
  const log = fight.log;                                                           // the story
  const used = (who) => { const key = String(who); if (!fight.used[key]) fight.used[key] = []; return fight.used[key]; }; // her used list
  lumi.guarding = false;                                                           // a Defend lasts until her next turn
  if (action.startsWith('move')) {
    const move = lumi.moves[Number(action.slice(4))];                              // the move
    lumi.mp -= move.mp || 0;                                                       // its MP
    const foes = _standing(fight.foes);                                            // who's left
    const aim = foes.includes(target) ? target : foes[0];                          // her aim, or the first standing
    _strike(fight, lumi, fight.foes[aim], move, rng);                              // strike (a self-help move helps her)
    used(lumi.user).push(move.id || '');                                           // remember it for Auto
  } else if (action === 'defend') {
    lumi.mp = Math.min(lumi.mpMax, lumi.mp + DEFEND_MP);                           // gather MP
    lumi.guarding = true;                                                          // braced
    log.push(`${lumi.name} braces and gathers her glow.`);                         // say so
    used(lumi.user).push('defend');                                                // remember
  } else if (action === 'run') {
    if (rng.random() < 0.75) {                                                     // three times in four
      fight.outcome = 'ran';                                                       // away
      log.push(`${lumi.name} calls everyone back, and the party slips away!`);     // say so
      fight.log = log.slice(-12);                                                  // keep the last lines
      fight.turn += 1;                                                             // a turn happened
      return;                                                                      // over
    }
    log.push(`${lumi.name} tries to lead everyone away, but the way is blocked!`); // stuck
  } else {                                                                         // an item, on herself or a friend
    useItem(fight, lumi, fight.lumis[target === null ? seat : target], action);    // its effect
    used(lumi.user).push(action);                                                  // remember
  }
  fight.acted.push(seat);                                                          // she's acted
  fight.turn += 1;                                                                 // a turn happened
  if (!_teamOver(fight)) _teamAdvance(fight, rng);                                 // next Lumi, or the creatures
  fight.log = fight.log.slice(-12);                                                // keep the last lines
}

/** The Lumi whose turn it is doesn't act (her player stepped away): she braces, and the round goes on. */
function teamSkip(fight, rng, why) {
  const seat = fight.at;                                                           // whose turn
  if (seat === null || seat === undefined || fight.outcome) return;                // nothing to skip
  const lumi = fight.lumis[seat];                                                  // her
  lumi.guarding = true;                                                            // braces
  fight.log.push(`${why} ${lumi.name} braces.`);                                   // say so
  fight.acted.push(seat);                                                          // counts as acted
  fight.turn += 1;                                                                 // a turn happened
  _teamAdvance(fight, rng);                                                        // move on
  fight.log = fight.log.slice(-12);                                                // keep the last lines
}

/** This Lumi's player went home mid-fight: she leaves too; her turn, if it was hers, passes on. */
function teamDrop(fight, seat, rng) {
  const lumi = fight.lumis[seat];                                                  // her
  Object.assign(lumi, { gone: true, hp: 0 });                                      // gone
  fight.log.push(`${lumi.name} heads home.`);                                      // say so
  if (fight.outcome || _teamOver(fight)) return;                                   // over now
  if (fight.at === seat) {                                                         // it was her turn
    fight.acted.push(seat);                                                        // counts as acted
    fight.turn += 1;                                                               // a turn happened
    _teamAdvance(fight, rng);                                                      // move on
  }
}

// erinne _team_advance: next Lumi; once all acted, every creature strikes, statuses bite, a new round begins.
function _teamAdvance(fight, rng) {
  fight.at = _teamNextLumi(fight);                                                 // next Lumi this round
  if (fight.at !== null) return;                                                   // someone still to act
  for (const foe of _standing(fight.foes).map((i) => fight.foes[i])) {             // each standing creature
    const targets = _standing(fight.lumis);                                        // standing Lumis
    if (!targets.length || _stunned(fight, foe)) continue;                         // nobody to hit, or stunned
    const move = foe.moves[rng.randrange(foe.moves.length)];                       // its move
    _strike(fight, foe, fight.lumis[targets[rng.randrange(targets.length)]], move, rng); // at a random Lumi
  }
  for (const who of [...fight.lumis, ...fight.foes]) endOfTurn(fight, who, () => true); // the round's end
  if (_teamOver(fight)) return;                                                    // someone won
  fight.round += 1;                                                                // a new round
  fight.acted = [];                                                                // nobody has acted
  fight.at = _teamNextLumi(fight);                                                 // the first Lumi
  while (fight.at !== null && _stunned(fight, fight.lumis[fight.at])) {            // stunned: her turn is lost
    fight.acted.push(fight.at);                                                    // counts as acted
    fight.at = _teamNextLumi(fight);                                               // the next one
  }
  if (fight.at === null) _teamAdvance(fight, rng);                                 // all stunned: the creatures go again
}

/** [EXP, native coins] each Lumi in a won co-op fight gets: the whole of every creature's worth. */
function teamReward(fight) {
  const gained = fight.foes.reduce((sum, foe) => sum + 15 + foe.level * 3 + TIERS[foe.tier][3], 0); // every creature's worth
  return [gained, Math.floor(gained * 0.6)];                                       // EXP, coins
}

/** A won co-op fight, for one member's pet: EXP, her luck and coin bonus, levels. Caller saves the pet. */
function teamFinish(pet, fight, seat) {
  let [gained, prize] = teamReward(fight);                                         // the base share
  const lumi = fight.lumis[seat];                                                  // her fighter
  if (lumi.boost === 'luck') { gained = Math.floor(gained * 1.25); prize = Math.floor(prize * 1.25); } // a lucky treat
  prize = Math.floor(prize * (1 + lumi.stats.coins / 100));                        // her coin bonus
  const levels = levelUp(pet, gained);                                             // EXP and levels
  pet.wins += 1;                                                                   // one more win
  return { exp: gained, coins: prize, level: pet.level, levels };                  // what she got (native coins)
}

// ------------------------------------------------------------------------------------------------ fights, saved

// A lumi_battles row as the page sees it: the state plus id, turn and status.
function _view(row) {
  return { ...JSON.parse(row.state), id: Number(row.id), turn: row.turn, status: row.status }; // merged
}

/** The fight in progress (it waits as long as it takes), or null. */
function current(userId) {
  const row = getDb().prepare("SELECT * FROM lumi_battles WHERE user_id = ? AND status = 'active'").get(String(userId)); // her active fight
  return row ? _view(row) : null;                                                  // shaped, or none
}

/**
 * Begin a fight against a random enemy of this tier (or 'gamble'). Changes the pet (her treat boost is used);
 * the caller saves it. Call inside db.tx(). opts: { enemy, level, carry, dungeon, party } (the dungeon names them).
 */
function start(userId, pet, tier, now, rng = null, { enemy = null, level = null, carry = null, dungeon = false, party = null } = {}) {
  const dice = rng || systemRandom();                                              // secure by default
  if (!(tier in TIERS) && tier !== 'gamble') throw new BattleError('Choose a kind of opponent, or Gamble.'); // unknown tier
  if (current(userId)) throw new BattleError('Lumi is already in a fight. Finish it, or run.'); // one at a time
  if (pet.faint_until > now) throw new BattleError('Lumi is still napping off her last fight. Let her rest, or wake her for SGC.'); // fainted
  const pool = CATALOG.enemies.filter((e) => tier === 'gamble' || e.tier === tier); // who she might meet
  const entry = enemy ? _ENEMIES[enemy] : pool[dice.randrange(pool.length)];      // named, or random
  const lvl = level !== null && level !== undefined ? level : Math.max(1, Math.min(MAX_LEVEL, pet.level + dice.randrange(5) - 2)); // her level, give or take two
  const lumi = _lumi(pet, carry);                                                  // her, as she walks in
  const state = { player: lumi, enemy: _enemy(entry, lvl, pet.level, lumi.element), choice: tier, boost: has(pet, 'boost') ? pet.boost : null, // the fight
    dungeon: Boolean(dungeon), outcome: null, reward: null, log: [`A wild ${entry.name} appears!`] }; // its first line
  if (party) state.party = party;                                                  // a party's dungeon fight
  pet.boost = null;                                                                // the treat boost is used
  const made = getDb().prepare('INSERT INTO lumi_battles (user_id, state, created_at) VALUES (?, ?, ?)').run(String(userId), JSON.stringify(state), now); // save it
  return { ...state, id: Number(made.lastInsertRowid), turn: 0, status: 'active' }; // the page's view
}

/**
 * One button press in a fight. The turn must be the one the page was shown (a stale press changes nothing).
 * A win pays once, by the fight's id. Changes the pet; the caller saves it. Call inside db.tx().
 * @param {string} [username] for the SGC account (default: the remembered display name)
 */
function act(userId, pet, battleId, turn, action, now, rng = null, username = null) {
  const dice = rng || systemRandom();                                              // secure by default
  const row = getDb().prepare('SELECT * FROM lumi_battles WHERE id = ? AND user_id = ?').get(battleId, String(userId)); // her fight?
  if (!row) throw new BattleError("That fight isn't Lumi's.");                     // someone else's (or none)
  if (row.status !== 'active') throw new BattleError('That fight is over.');      // finished
  if (row.turn !== turn) throw new BattleError('That turn already happened.');    // a stale button
  const state = JSON.parse(row.state);                                             // the fight
  const lumi = state.player;                                                       // her
  if (typeof action !== 'string') throw new BattleError("Lumi doesn't know that one."); // junk
  if (action.startsWith('move')) {
    const index = action.slice(4);                                                 // "N"
    if (!/^\d+$/u.test(index) || Number(index) >= lumi.moves.length) throw new BattleError("Lumi doesn't have that move ready."); // no such move
    if ((lumi.moves[Number(index)].mp || 0) > lumi.mp) throw new BattleError('Not enough MP for that. Defend to gather some.'); // short of MP
  } else if (action === 'potion' || action in KIT) {
    const why = itemRefusal(lumi, action);                                         // would it help?
    if (why) throw new BattleError(why);                                           // no
    takeItem(pet, action);                                                         // out of her pocket
  } else if (action !== 'defend' && action !== 'run') {
    throw new BattleError("Lumi doesn't know that one.");                          // unknown
  }
  remember(pet, action.startsWith('move') ? (lumi.moves[Number(action.slice(4))].id || '') : action); // for Auto
  resolve(state, action, dice);                                                    // play the turn
  if (state.outcome === 'victory') _reward(userId, pet, state, battleId, username); // EXP + coins
  else if (state.outcome === 'defeat') {
    pet.losses += 1;                                                               // one more loss
    pet.faint_until = now + FAINT_MS;                                              // a nap
    state.log.push(`${lumi.name} curls up, worn out. She'll nap for ten minutes, or wake now for ${tuning.scalePrice(GAME, 'heal', HEAL_PRICE)} SGC.`); // say so
  }
  const db = getDb();                                                              // the DB
  db.prepare('UPDATE lumi_battles SET state = ?, status = ?, turn = turn + 1 WHERE id = ?').run(JSON.stringify(state), state.outcome || 'active', battleId); // save the turn
  db.prepare("DELETE FROM lumi_battles WHERE user_id = ? AND status != 'active' AND id != ?").run(String(userId), battleId); // keep only the latest finished fight
  return { ...state, id: battleId, turn: turn + 1, status: state.outcome || 'active' }; // the page's view
}

/**
 * erinne _reward: EXP and coins for a win (by the enemy's level and tier); levels may follow.
 * Solo: paid now via sgc.pay(..., 'battle', 'win', `lumi-battle:${id}`). In the dungeon the NATIVE coins go into
 * her satchel instead (lumidungeon.afterFight), hers only if she gets home with it.
 * reward = { exp, coins (solo: SGC paid; dungeon: native, for the satchel), sgc (what to show), level, levels, owed?, capped? }
 */
function _reward(userId, pet, state, battleId, username = null) {
  const enemy = state.enemy;                                                       // who she beat
  let gained = 15 + enemy.level * 3 + TIERS[enemy.tier][3];                        // EXP
  let prize = Math.floor(gained * 0.6);                                            // native coins
  if (state.choice === 'gamble') { gained = Math.floor(gained * 1.2); prize = Math.floor(prize * 1.2); } // a gamble: a fifth more
  if (state.boost === 'luck') { gained = Math.floor(gained * 1.25); prize = Math.floor(prize * 1.25); } // a lucky treat
  prize = Math.floor(prize * (1 + state.player.stats.coins / 100));                // her coin bonus
  const before = pet.level;                                                        // to count levels
  levelUp(pet, gained);                                                            // EXP and levels
  pet.wins += 1;                                                                   // one more win
  let coins = prize;                                                               // what goes in the reward
  let shown = 0;                                                                   // SGC to show
  let note = '';                                                                   // a word about the bank
  const reward = { exp: gained, coins: 0, sgc: 0, level: pet.level, levels: pet.level - before }; // the reward
  if (state.dungeon) {                                                             // into the satchel (native)
    shown = tuning.scalePayout('dungeon', 'win', prize);                           // about what it'll bank as
  } else {                                                                         // solo: paid now
    const name = username || users.displayName(String(userId));                    // her SGC account's name
    const paid = sgc.pay(String(userId), name, prize, GAME, 'win', `lumi-battle:${battleId}`); // pay once by the fight's id
    coins = paid.paid;                                                             // SGC actually paid
    shown = paid.paid;                                                             // show what landed
    if (paid.owed > 0) { reward.owed = paid.owed; note = ' Lumi-Town Bank is closed for a moment, your prize is saved.'; } // owed later
    if (paid.capped) { reward.capped = true; note += " You've reached today's Lumi Dungeons prize limit."; } // daily cap
  }
  reward.coins = coins;                                                            // native (dungeon) or SGC paid (solo)
  reward.sgc = shown;                                                              // what the page shows
  state.reward = reward;                                                           // keep it
  state.log.push(`Victory! +${gained} EXP, +${shown} SGC` + (state.dungeon ? ' in her satchel.' : '.') // the line
    + (pet.level > before ? ` ${state.player.name || 'Lumi'} is now level ${pet.level}!` : '') + note); // levels and bank notes
}

// ------------------------------------------------------------------------------------------------ between fights (the Outfitters)

// Charge `count` x `native` for one shop key; one spend per unit, so an admin override per unit is exact.
function _buy(userId, username, native, key, count, words) {
  const uid = String(userId);                                                      // Discord id
  const name = username || users.displayName(uid);                                 // her account name
  const unit = tuning.scalePrice(GAME, key, native);                               // SGC per unit (what the page shows)
  const need = unit * count;                                                       // SGC in all
  const have = sgc.balance(uid);                                                   // her purse
  if (need > have) throw notEnoughSGC(need, have, `${words || 'Not enough SGC for that.'} (It costs ${need} SGC; you have ${have}.)`); // 402, nothing moves
  let paid = 0;                                                                    // SGC charged
  for (let i = 0; i < count; i += 1) paid += sgc.spend(uid, name, native, GAME, 'shop', { key }); // one unit at a time
  return paid;                                                                     // SGC charged
}

/**
 * erinne progress: skills, moves, mods, potions, stat points, kit and the wake-up. Returns a note about a
 * purchase ({ bought, count, paid: SGC charged }) or null. Changes the pet; caller saves it. Call inside db.tx().
 * @param {string} [username] for the SGC account (default: the remembered display name)
 */
function progress(userId, pet, action, item, slot, count, now, username = null) {
  const n = Number.isInteger(count) ? count : 0;                                   // how many
  if (action === 'learn') {
    const node = typeof item === 'string' ? _NODES[item] : undefined;              // the skill
    if (!node) throw new BattleError("That isn't a skill.");                       // unknown
    if (pet.skills.includes(item)) throw new BattleError('Lumi already knows that.'); // learned
    const missing = node.needs.filter((need) => !pet.skills.includes(need)).map((need) => _NODES[need].name); // what leads to it
    if (missing.length) throw new BattleError(`${node.name} needs ${missing.join(' and ')} first.`); // not yet
    if (NODE_COSTS[node.index] > points(pet)) throw new BattleError('Not enough skill points yet. Each level brings one more.'); // short of points
    pet.skills.push(item);                                                         // learned
    if (node.kind === 'move' && pet.moves.length < MOVE_SLOTS) pet.moves.push(item); // ready to use if there's room
  } else if (action === 'respec') {
    if (!pet.skills.length) throw new BattleError('There are no skill points to hand back.'); // nothing to give back
    const paid = _buy(userId, username, RESPEC_PRICE, 'respec', 1);                // 'battle', 'shop', key respec
    pet.skills = [];                                                               // trees afresh
    pet.moves = Object.keys(_BASICS);                                              // the basics
    return { bought: 'respec', count: 1, paid };                                   // what it cost
  } else if (action === 'equip') {
    if (!knownMoves(pet).some((move) => move.id === item)) throw new BattleError("Lumi hasn't learned that move."); // unknown move
    if (pet.moves.includes(item)) {                                                // put it away
      if (pet.moves.length === 1) throw new BattleError('Lumi needs at least one move.'); // never empty-pawed
      pet.moves.splice(pet.moves.indexOf(item), 1);                                // remove it
    } else if (pet.moves.length >= MOVE_SLOTS) {
      throw new BattleError(`Lumi carries ${MOVE_SLOTS} moves. Take one off first.`); // full
    } else {
      pet.moves.push(item);                                                        // carry it
    }
  } else if (action === 'mod') {
    if (!isInt(slot) || slot < 0 || slot >= MOD_SLOTS.length) throw new BattleError('Choose a mod slot.'); // no such slot
    const [tek, opens] = MOD_SLOTS[slot];                                          // its kind and level
    if (pet.level < opens) throw new BattleError(`That slot opens at level ${opens}.`); // not open
    if (item === null || item === undefined) { pet.mods[slot] = null; return null; } // take it out
    const mod = typeof item === 'string' ? _MODS[item] : undefined;                // the mod
    if (!mod || mod.tek !== tek) throw new BattleError(`That slot takes a ${tek} mod.`); // wrong kind
    let note = null;                                                               // a purchase note
    if (!pet.mods_owned.includes(item)) {                                          // not hers yet
      if (!mod.price) throw new BattleError("That mod can't be bought. It turns up in dungeon vaults."); // dungeon-only
      const paid = _buy(userId, username, mod.price, item, 1);                     // 'battle', 'shop', key = the mod's id
      pet.mods_owned.push(item);                                                   // hers now
      note = { bought: item, count: 1, paid };                                     // what it cost
    }
    pet.mods = pet.mods.map((fitted) => (fitted === item ? null : fitted));        // one mod, one slot
    pet.mods[slot] = item;                                                         // fit it
    return note;                                                                   // the note (null when moved)
  } else if (action === 'potions') {
    if (n < 1 || n > POTION_CAP || pet.potions + n > POTION_CAP) throw new BattleError(`Lumi carries up to ${POTION_CAP} potions.`); // too many
    const paid = _buy(userId, username, POTION_PRICE, 'potion', n);                // 'battle', 'shop', key potion (per potion)
    pet.potions += n;                                                              // in her pocket
    return { bought: 'potion', count: n, paid };                                   // what it cost
  } else if (action === 'heal') {
    if (pet.faint_until <= now) throw new BattleError('Lumi is already up and about.'); // awake
    const paid = _buy(userId, username, HEAL_PRICE, 'heal', 1, "Not enough SGC for that. She'll wake by herself soon."); // key heal
    pet.faint_until = 0;                                                           // woken
    pet.wound = 0.0;                                                               // and whole
    return { bought: 'heal', count: 1, paid };                                     // what it cost
  } else if (action === 'stat') {                                                  // place points in one stat by hand
    if (!STAT_KEYS.includes(item)) throw new BattleError('Choose one of her stats.'); // unknown stat
    const left = statPointsLeft(pet);                                              // waiting
    const held = Number(pet.stat_points[item]) || 0;                               // already there
    if (left < 1) throw new BattleError(`No stat points waiting. Each level brings ${POINTS_PER_LEVEL} more.`); // none
    if (held >= statCap(pet)) throw new BattleError(`${STAT_NAMES[item]} holds as many points as her level allows (${statCap(pet)}).`); // full
    pet.stat_points[item] = held + Math.max(1, Math.min(n, left, statCap(pet) - held)); // place them
  } else if (action === 'stats_auto') {                                            // place everything the way Auto would
    if (statPointsLeft(pet) < 1) throw new BattleError('No stat points waiting.'); // none
    return { placed: placeAuto(pet) };                                             // where they went
  } else if (action === 'auto_stats') {                                            // Auto on or off
    pet.auto_stats = !pet.auto_stats;                                              // flip
    if (pet.auto_stats && statPointsLeft(pet) > 0) return { placed: placeAuto(pet) }; // place what's waiting
  } else if (action === 'stats_reset') {                                           // take every point back
    if (!Object.values(pet.stat_points).some(Boolean)) throw new BattleError('No points are placed yet.'); // nothing placed
    if (pet.stat_reset_free) {                                                     // the free one
      pet.stat_reset_free = 0;                                                     // used
      pet.stat_points = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));      // all back
      return { bought: 'stats_reset', count: 1, paid: 0 };                         // free
    }
    const paid = _buy(userId, username, STAT_RESET_PRICE, 'reset', 1);            // 'battle', 'shop', key reset
    pet.stat_points = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));        // all back
    return { bought: 'stats_reset', count: 1, paid };                              // what it cost
  } else if (action === 'kit') {                                                   // fight items
    if (typeof item !== 'string' || !(item in KIT)) throw new BattleError("That isn't a fight item."); // unknown
    pet.kit = pet.kit || {};                                                       // her pocket
    if (n < 1 || n > KIT_CAP || (Number(pet.kit[item]) || 0) + n > KIT_CAP) throw new BattleError(`Lumi carries up to ${KIT_CAP} of each.`); // too many
    const paid = _buy(userId, username, KIT[item].price, item, n);                 // 'battle', 'shop', key = the item id (per item)
    pet.kit[item] = (Number(pet.kit[item]) || 0) + n;                              // in her pocket
    return { bought: item, count: n, paid };                                       // what it cost
  } else if (action === 'drink') {                                                 // a potion at home, between trips
    if (pet.wound <= 0) throw new BattleError('Lumi is already at full health.');  // no need
    if (pet.potions < 1) throw new BattleError("No potions left. Lumi Dungeons' Battle tab sells them."); // none
    pet.potions -= 1;                                                              // one used
    mend(pet, POTION_MEND);                                                        // half back
  } else {
    throw new BattleError("Lumi doesn't know that one.");                          // unknown action
  }
  return null;                                                                     // nothing bought
}

/** What the page needs about her progress (worked out here so the page never does the sums). */
function summary(pet) {
  const weights = autoWeights(pet);                                                // Auto's leanings
  return {
    points: points(pet), stats: stats(pet), next: pet.level < MAX_LEVEL ? levelThreshold(pet.level) : 0, // skill points, numbers, next level
    stat_points: {
      left: statPointsLeft(pet), placed: Object.fromEntries(STAT_KEYS.map((key) => [key, Number(pet.stat_points[key]) || 0])), // waiting, placed
      cap: statCap(pet), auto: Boolean(pet.auto_stats), free_reset: Boolean(pet.stat_reset_free), // cap, Auto, free reset
      per_point: Object.fromEntries(STAT_KEYS.map((key) => [key, GROWTH[key] / 2])), // what a point is worth
      leans: [...STAT_KEYS].sort((a, b) => weights[b] - weights[a]).slice(0, 3),   // what Auto favours most (stable sort)
    },
    kit: Object.fromEntries(Object.keys(KIT).map((key) => [key, Number((pet.kit || {})[key]) || 0])), // fight items held
    element: GLOW_ELEMENT[pet.glow] || 'fire',                                     // her element
    slots: MOD_SLOTS.map(([tek, opens], i) => ({ tek, opens, open: pet.level >= opens, mod: pet.mods[i] === undefined ? null : pet.mods[i] })), // mod slots
  };
}

/** The rules the page reads (NATIVE prices: the page shows them through window.LumiPrice('battle', key, native)). */
const RULES = {
  mend_ms: MEND_MS, nap_mend: NAP_MEND, costs: NODE_COSTS, respec: RESPEC_PRICE, potion: POTION_PRICE, potion_cap: POTION_CAP, heal: HEAL_PRICE, // timings + prices
  kit: KIT, kit_cap: KIT_CAP, stat_keys: STAT_KEYS, stat_names: STAT_NAMES, stat_reset: STAT_RESET_PRICE, points_per_level: POINTS_PER_LEVEL, // items + stats
  moves: MOVE_SLOTS, max_level: MAX_LEVEL, tiers: Object.keys(TIERS), glows: GLOW_ELEMENT, // the rest
};

save.setSettlePoints(settlePoints);                                                // pet/save.js runs it for pre-stat-point saves

module.exports = {
  // constants
  GAME, MAX_LEVEL, PACE, NODE_COSTS, RESPEC_PRICE, POTION_PRICE, POTION_CAP, HEAL_PRICE, FAINT_MS, MEND_MS, NAP_MEND,
  POTION_MEND, MOVE_SLOTS, DEFEND_MP, STATUS_TURNS, STATUS_HURT, STUN_CHANCE, ELEMENTS, WHEEL, GLOW_ELEMENT, GLOW_MATCH,
  TIERS, ENEMY_HP_GROWTH, MOD_SLOTS, BONUS_KEYS, EFFECTS, BODIES, STAT_KEYS, STAT_NAMES, GROWTH, POINTS_PER_LEVEL,
  POINT_CAP, STAT_RESET_PRICE, TREE_STATS, USE_STATS, KIT, KIT_CAP, STAGE, MAX_STAGE, STAGED, SPEED_DODGE, TEAM_FOES,
  RULES, CATALOG, _NODES, _BASICS, _MODS, _ENEMIES,
  BattleError, systemRandom,
  // catalog
  loadCatalog, _checkMove, _checkBonus, freshFields,
  // health
  health, hurt, mend, mendsIn,
  // numbers + stat points
  levelThreshold, spent, points, bonuses, baseStats, lumiBase, stats, statPointsEarned, statPointsLeft, statCap,
  _useKind, remember, autoWeights, placeAuto, levelUp, settlePoints, knownMoves, _defences, _lumi, _enemy,
  // a turn
  statOf, _multiplier, _strike, _stunned, resolve,
  // items
  itemRefusal, hasItem, takeItem, useItem,
  // co-op (lumiparty.js)
  teamFighter, teamFoe, teamStart, _standing, _teamNextLumi, _teamOver, teamRefusal, teamAct, teamSkip, teamDrop,
  _teamAdvance, teamReward, teamFinish,
  // saved fights
  _view, current, start, act, _reward,
  // between fights
  progress, summary,
};
