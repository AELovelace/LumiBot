'use strict';

/**
 * Lumi Dungeons: DUNGEON RUNS, ported from erinne mnemerynne/lumidungeon.py (commit 0ddc466).
 *
 * A run picks one environment (data/dungeon.json) and makes a floor of about a dozen rooms on a small grid: empty
 * rooms, creatures, treasure, a locked vault (a key found on the floor, or a puzzle), a little game, and stairs to a
 * harder floor. What she finds goes in her satchel and only counts once she walks out with it; a lost fight empties
 * it. The server makes and keeps the whole floor; the page is only told about rooms she has entered, and it sends
 * choices (a direction, a cup, puzzle moves), never results: a Sokoban answer is REPLAYED here before a door opens.
 *
 * Coins: the satchel is paid once when she walks home: sgc.pay(uid, name, native, 'dungeon', 'win', `lumi-run:${uid}:${run}`).
 * Like lumibattle, this module never loads or saves a pet: the caller hands it the pet and saves it afterwards.
 * Sokoban positions are "x,y" strings (sokobanParse returns [walls Set, goals Set, boxes Set, [x, y]]).
 */

const fs = require('node:fs');                                                     // reading data files
const path = require('node:path');                                                 // where they live
const { getDb } = require('../db');                                                // the economy DB (lumi_runs)
const sgc = require('../sgc');                                                     // THE door to coins
const users = require('../users');                                                 // a name when the caller has none
const save = require('../pet/save');                                               // the validated house catalog
const { LumiError } = require('../errors');                                        // "no" answers
const lumibattle = require('./lumibattle');                                        // fights, stats, health

const DATA = path.join(__dirname, '..', 'data');                                   // src/lumi/data
const dict = (obj) => Object.assign(Object.create(null), obj);                     // a lookup table with no prototype keys
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);     // Python isinstance(v, dict)

const GAME = 'dungeon';                                                            // tuning/ledger id for a satchel brought home
const GRID_W = 5;                                                                  // the floor's grid width
const GRID_H = 4;                                                                  // ...and height
const ROOMS = [11, 13];                                                            // fewest and most rooms on a floor
const DIRS = dict({ n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] });               // the four ways
const BACK = dict({ n: 's', s: 'n', e: 'w', w: 'e' });                             // the way back
const WAYS = ['n', 'e', 's', 'w'];                                                 // list(DIRS), in order
const LOCKS = ['key', 'sokoban', 'lights', 'runes'];                               // vault lock kinds
const RUNES = ['sun', 'moon', 'star', 'leaf', 'wave'];                             // the rune lock's symbols
const RUNE_SLOTS = 4;                                                              // runes in a code
const RUNE_TRIES = 8;                                                              // guesses before the code changes
const CUPS = 3;                                                                    // cups in the cup game
const PAIRS = 4;                                                                   // Constellation Match: pairs to find
const FLIPS = 14;                                                                  // ...and card turns allowed
const MAX_MOVES = 600;                                                             // the longest Sokoban answer replayed
const LOG = 12;                                                                    // story lines a run keeps
const TIERS_BY_DEPTH = [                                                           // depth -> {tier: weight}; deeper uses the last
  { common: 70, uncommon: 30 }, { common: 30, uncommon: 50, rare: 20 },            // floors 1-2
  { uncommon: 35, rare: 45, epic: 20 }, { rare: 40, epic: 50, legendary: 10 },     // floors 3-4
  { rare: 20, epic: 55, legendary: 25 },                                           // floor 5 and deeper
];
const ENV_BIAS = 70;                                                               // percent of enemies from the place's own elements
const MOD_CHANCE = [8, 4];                                                         // vault mod chance: base, more per floor
const SET_CHANCE = dict({ treasure: [8, 3], enemy: [4, 2] });                      // decor-set piece chance: base, more per floor
const ID_RE = /^[a-z0-9-]{1,40}$/u;                                                // catalog ids
const COLOUR_RE = /^#[0-9a-f]{6}$/u;                                               // '#rrggbb'

/** Refused; the message is safe to show. A LumiError, so a route answers it as HTTP 400. */
class DungeonError extends LumiError {
  constructor(message) { super(400, 'dungeon_refused', message); this.name = 'DungeonError'; } // 400 + the words
}

// ------------------------------------------------------------------------------------------------ catalogs

/** erinne load_catalog: the environments, checked at start. source: a path, a parsed object, or nothing. */
function loadCatalog(source) {
  const data = isObj(source) ? source : JSON.parse(fs.readFileSync(source || path.join(DATA, 'dungeon.json'), 'utf8')); // the data
  const seen = new Set();                                                          // ids so far
  if (!Array.isArray(data.environments) || !data.environments.length) throw new Error("Lumi's dungeon needs some environments."); // none
  for (const env of data.environments) {
    if (!isObj(env) || !ID_RE.test(String(env.id === undefined ? '' : env.id)) || seen.has(env.id) || !env.name || !env.about) { // id, name, about
      throw new Error("Lumi's dungeon has a bad or repeated environment.");        // refuse
    }
    seen.add(env.id);                                                              // remember it
    const palette = env.palette;                                                   // its colours
    const keys = isObj(palette) ? Object.keys(palette).sort().join(',') : '';      // which colours
    if (!['mystical', 'fantasy', 'cyberpunk'].includes(env.family) || !Number.isInteger(env.opens) // family, opening level
      || env.opens < 1 || env.opens > lumibattle.MAX_LEVEL || !Array.isArray(env.elements) || !env.elements.length // 1..50, some elements
      || env.elements.some((e) => ![...lumibattle.ELEMENTS, 'none'].includes(e))   // known elements
      || keys !== 'accent,floor,glow,wall' || Object.values(palette).some((c) => !COLOUR_RE.test(String(c)))) { // four colours
      throw new Error(`The ${env.id} environment has a bad family, level, element or colour.`); // refuse
    }
  }
  if (Math.min(...data.environments.map((env) => env.opens)) !== 1) throw new Error('One environment must be open from level 1.'); // somewhere to start
  return data;                                                                     // checked
}

/** erinne sokoban_parse: [walls, goals, boxes (Sets of "x,y"), [x, y] of Lumi]. # wall . goal $ box * box on goal @ Lumi + Lumi on goal */
function sokobanParse(rows) {
  const walls = new Set();                                                         // "x,y" walls
  const goals = new Set();                                                         // "x,y" goals
  const boxes = new Set();                                                         // "x,y" boxes
  let lumi = null;                                                                 // where she stands
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const at = `${x},${y}`;                                                      // this square
      if (cell === '#') walls.add(at);                                             // a wall
      if ('.*+'.includes(cell)) goals.add(at);                                     // a goal
      if ('$*'.includes(cell)) boxes.add(at);                                      // a box
      if ('@+'.includes(cell)) {                                                   // Lumi
        if (lumi !== null) throw new Error('A Sokoban level has two Lumis.');      // only one
        lumi = [x, y];                                                             // here
      }
      if (!'# .$*@+'.includes(cell)) throw new Error("A Sokoban level has a character it shouldn't."); // junk
    });
  });
  if (lumi === null || !boxes.size || boxes.size !== goals.size) throw new Error('A Sokoban level needs Lumi, and as many boxes as goals.'); // playable
  return [walls, goals, boxes, lumi];                                              // the level
}

/** erinne sokoban_solved: replay a u/d/l/r answer; true only if every move is legal and every box ends on a goal. */
function sokobanSolved(rows, moves) {
  const [walls, goals, boxes, start] = sokobanParse(rows);                         // the level
  const held = new Set(boxes);                                                     // boxes as they move
  let [x, y] = start;                                                              // where she is
  const step = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };                   // each move
  for (const move of String(moves)) {
    if (!Object.prototype.hasOwnProperty.call(step, move)) return false;           // junk
    const [dx, dy] = step[move];                                                   // the step
    const to = `${x + dx},${y + dy}`;                                              // where she'd go
    if (walls.has(to)) return false;                                               // into a wall
    if (held.has(to)) {                                                            // pushing a box
      const beyond = `${x + 2 * dx},${y + 2 * dy}`;                                // where the box would go
      if (walls.has(beyond) || held.has(beyond)) return false;                     // a box can't go into a wall or a box
      held.delete(to);                                                             // move the box
      held.add(beyond);                                                            // ...here
    }
    x += dx;                                                                       // step
    y += dy;                                                                       // step
  }
  return held.size === goals.size && [...held].every((at) => goals.has(at));       // every box on a goal
}

/** erinne load_sokoban: the Sokoban levels, easiest first (each must parse). source: a path, an object, or nothing. */
function loadSokoban(source) {
  const data = isObj(source) ? source : JSON.parse(fs.readFileSync(source || path.join(DATA, 'sokoban.json'), 'utf8')); // the data
  const levels = data.levels;                                                      // the list
  if (!Array.isArray(levels) || !levels.length) throw new Error("Lumi's dungeon needs some Sokoban levels."); // none
  for (const level of levels) {
    const rows = isObj(level) ? level.rows : null;                                 // its rows
    if (!isObj(level) || !ID_RE.test(String(level.id === undefined ? '' : level.id)) || !Array.isArray(rows) || rows.length < 4 || rows.length > 9 // id, 4-9 rows
      || rows.some((row) => typeof row !== 'string' || row.length !== rows[0].length || row.length < 4 || row.length > 9)) { // equal 4-9 wide rows
      throw new Error("Lumi's dungeon has a badly shaped Sokoban level.");         // refuse
    }
    sokobanParse(rows);                                                            // must parse
  }
  return levels;                                                                   // checked
}

/** erinne _found: house pieces found in the dungeon, by environment (sets=false: trophies; true: decor sets). */
function _found(sets, source) {
  const data = isObj(source) ? source : source ? JSON.parse(fs.readFileSync(source, 'utf8')) : save.HOUSE; // house.json
  const found = Object.create(null);                                               // env -> pieces
  for (const spot of data.spots) {
    if ((spot.id !== 'trophy') === sets) {                                         // trophies live on the trophy bracket
      for (const item of spot.items || []) {
        if (item.found) (found[item.found] = found[item.found] || []).push({ ...item, spot: spot.id }); // by environment
      }
    }
  }
  return found;                                                                    // env -> [piece + spot]
}

/** Trophies by environment: one waits in each vault until she has them all. */
function loadTrophies(source) { return _found(false, source); }                    // the trophy bracket's pieces

/** Each environment's decor set: dropped now and then by a chest or a beaten creature there. */
function loadSets(source) { return _found(true, source); }                         // every other spot's found pieces

const CATALOG = loadCatalog();                                                     // dungeon.json (throws at start if broken)
const SOKOBAN = loadSokoban();                                                     // sokoban.json
const TROPHIES = loadTrophies();                                                   // env -> trophies
const SETS = loadSets();                                                           // env -> decor set pieces
const _ENVS = dict(Object.fromEntries(CATALOG.environments.map((env) => [env.id, env]))); // env id -> env
for (const env of [...Object.keys(TROPHIES), ...Object.keys(SETS)]) {
  if (!(env in _ENVS)) throw new Error(`Something for the house is found in ${env}, which isn't an environment.`); // stray piece
}
const FOUND_NAMES = dict(Object.fromEntries([TROPHIES, SETS].flatMap((found) => Object.values(found).flat().map((item) => [item.id, item.name])))); // piece id -> name
const _FOUND_MODS = lumibattle.CATALOG.mods.filter((mod) => !mod.price);           // mods only the dungeon gives

/** Lights Out: pressing a lamp flips it and the ones beside it. */
function lightsPress(board, size, cell) {
  const x = cell % size;                                                           // column
  const y = Math.floor(cell / size);                                               // row
  for (const [cx, cy] of [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    if (cx >= 0 && cx < size && cy >= 0 && cy < size) board[cy * size + cx] = !board[cy * size + cx]; // flip it
  }
}

/** Replay a list of presses; true if every lamp ends up off. */
function lightsSolved(board, size, presses) {
  const lamps = [...board];                                                        // a copy
  for (const cell of presses) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= size * size) return false;  // off the board (or junk)
    lightsPress(lamps, size, cell);                                                // press it
  }
  return !lamps.some(Boolean);                                                     // all dark?
}

// ------------------------------------------------------------------------------------------------ making a floor

// A weighted pick from {key: weight}.
function _weighted(weights, rng) {
  let roll = rng.randrange(Object.values(weights).reduce((a, b) => a + b, 0));     // where the roll lands
  let key = null;                                                                  // the last key seen
  for (const [k, weight] of Object.entries(weights)) {
    key = k;                                                                       // this one
    if (roll < weight) return k;                                                   // landed here
    roll -= weight;                                                                // next
  }
  return key;                                                                      // (never reached)
}

// A shuffled copy (Fisher-Yates with the given dice).
function _shuffle(things, rng) {
  const out = [...things];                                                         // a copy
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.randrange(i + 1);                                                // swap partner
    [out[i], out[j]] = [out[j], out[i]];                                           // swap
  }
  return out;                                                                      // shuffled
}

// Native coins found at this depth (scale: more in a vault, less for losing a game).
function _coins(depth, rng, scale = 1.0) {
  return Math.trunc((10 + rng.randrange(16)) * (1 + 0.5 * (depth - 1)) * scale);  // 10-25, more deeper
}

// A vault's lock; the puzzle kinds carry their own puzzle, deeper floors draw harder ones.
function _lock(depth, rng) {
  const kind = LOCKS[rng.randrange(LOCKS.length)];                                 // which kind
  if (kind === 'sokoban') {
    const reach = Math.min(SOKOBAN.length, 4 + depth * 3);                         // deeper floors reach further along
    return { kind, level: SOKOBAN[rng.randrange(reach)].id };                      // a level
  }
  if (kind === 'lights') {
    const size = depth < 3 ? 3 : 4;                                                // a bigger board deeper
    const board = new Array(size * size).fill(false);                              // all off
    while (!board.some(Boolean)) {                                                 // scrambled by real presses, so it can be undone
      for (let i = 0; i < 3 + depth; i += 1) lightsPress(board, size, rng.randrange(size * size)); // press some
    }
    return { kind, size, board };                                                  // the lamps
  }
  if (kind === 'runes') return { kind, code: Array.from({ length: RUNE_SLOTS }, () => RUNES[rng.randrange(RUNES.length)]), tries: [] }; // a code
  return { kind: 'key' };                                                          // a key somewhere on the floor
}

// A creature for a room: a tier by depth, mostly from the place's own elements.
function _enemy(env, depth, rng) {
  const tier = _weighted(TIERS_BY_DEPTH[Math.min(depth, TIERS_BY_DEPTH.length) - 1], rng); // how tough
  const pool = lumibattle.CATALOG.enemies.filter((enemy) => enemy.tier === tier);  // that tier
  const local = pool.filter((enemy) => env.elements.includes(enemy.element));      // the place's own
  const chosen = local.length && rng.randrange(100) < ENV_BIAS ? local : pool;    // mostly local
  return { id: chosen[rng.randrange(chosen.length)].id };                          // which one
}

const key2 = (x, y) => `${x},${y}`;                                                // "x,y"

/**
 * erinne generate: one floor { rooms: {"x,y": room}, start: "x,y" }. Grown from the entrance so it is in one piece,
 * with a loop or two; the vault is a dead end so its lock never stands between Lumi and anything else.
 * `held` = { trophies, mods } she already carries (never hidden twice). pet needs decor and mods_owned.
 */
function generate(envId, depth, rng, pet, held = null) {
  const env = _ENVS[envId];                                                        // the place
  const carried = held || { trophies: [], mods: [] };                              // what she carries
  const count = ROOMS[0] + rng.randrange(ROOMS[1] - ROOMS[0] + 1);                 // how many rooms
  const start = [rng.randrange(GRID_W), rng.randrange(GRID_H)];                    // the entrance
  const cells = [start];                                                           // rooms in order made
  const exits = new Map([[key2(...start), {}]]);                                   // "x,y" -> {way: true}
  while (cells.length < count) {                                                   // grow
    const [x, y] = cells[rng.randrange(cells.length)];                             // from a room
    const way = WAYS[rng.randrange(4)];                                            // a way
    const to = [x + DIRS[way][0], y + DIRS[way][1]];                               // the next square
    if (to[0] >= 0 && to[0] < GRID_W && to[1] >= 0 && to[1] < GRID_H && !exits.has(key2(...to))) { // on the grid and new
      cells.push(to);                                                              // a room
      exits.set(key2(...to), { [BACK[way]]: true });                               // a door back
      exits.get(key2(x, y))[way] = true;                                           // a door there
    }
  }
  const startKey = key2(...start);                                                 // "x,y" of the entrance
  const leaves = cells.filter((c) => Object.keys(exits.get(key2(...c))).length === 1 && key2(...c) !== startKey); // dead ends
  const vault = leaves[rng.randrange(leaves.length)];                              // the vault
  const vaultKey = key2(...vault);                                                 // its key
  const loops = 1 + rng.randrange(2);                                              // a loop or two
  for (let i = 0; i < loops; i += 1) {
    const [x, y] = cells[rng.randrange(cells.length)];                             // from a room
    const way = WAYS[rng.randrange(4)];                                            // a way
    const to = key2(x + DIRS[way][0], y + DIRS[way][1]);                           // a neighbour
    if (exits.has(to) && vaultKey !== key2(x, y) && vaultKey !== to) {             // a room, not the vault
      exits.get(key2(x, y))[way] = true;                                           // a door
      exits.get(to)[BACK[way]] = true;                                             // and back
    }
  }
  const far = new Map([[startKey, 0]]);                                            // steps from the entrance
  const queue = [start];                                                           // breadth-first
  for (let q = 0; q < queue.length; q += 1) {
    const cell = queue[q];                                                         // this room
    for (const way of Object.keys(exits.get(key2(...cell)))) {                     // its doors (in the order made)
      const to = [cell[0] + DIRS[way][0], cell[1] + DIRS[way][1]];                 // next door
      if (!far.has(key2(...to))) { far.set(key2(...to), far.get(key2(...cell)) + 1); queue.push(to); } // one step further
    }
  }
  let stairs = null;                                                               // the stairs: as far away as can be
  for (const cell of cells) {
    const k = key2(...cell);                                                       // its key
    if (k === startKey || k === vaultKey) continue;                                // not the entrance or the vault
    if (stairs === null) { stairs = cell; continue; }                              // the first candidate
    const a = far.get(k);                                                          // its distance
    const b = far.get(key2(...stairs));                                            // the best so far
    if (a > b || (a === b && (cell[0] > stairs[0] || (cell[0] === stairs[0] && cell[1] > stairs[1])))) stairs = cell; // Python max by (far, cell)
  }
  const stairsKey = key2(...stairs);                                               // its key
  const lock = _lock(depth, rng);                                                  // the vault's lock
  const owned = new Set([...(pet.decor || []), ...carried.trophies]);              // set pieces she has or carries
  const spare = _shuffle(cells.filter((c) => ![startKey, vaultKey, stairsKey].includes(key2(...c))), rng).map((c) => key2(...c)); // the other rooms
  const enemies = 3 + rng.randrange(2);                                            // three or four creatures
  const kinds = [...new Array(enemies).fill('enemy'), 'game', 'treasure', 'treasure', ...(lock.kind === 'key' ? ['key'] : [])]; // what goes where
  const rooms = {};                                                                // "x,y" -> room
  for (const cell of cells) {
    const k = key2(...cell);                                                       // its key
    const spot = spare.indexOf(k);                                                 // its place in the shuffle
    const kind = k === startKey ? 'start' : k === vaultKey ? 'vault' : k === stairsKey ? 'stairs' : (spot < kinds.length ? kinds[spot] : 'empty'); // its kind
    const room = { kind, exits: Object.keys(exits.get(k)).sort(), seen: k === startKey, done: ['start', 'empty', 'stairs'].includes(kind) }; // the room
    if (kind === 'enemy') {
      room.enemy = _enemy(env, depth, rng);                                        // who lives here
      const piece = _setPiece(env, 'enemy', depth, rng, owned);                    // maybe carrying a set piece
      if (piece) room.loot = { trophy: piece };                                    // dropped when beaten
    } else if (kind === 'treasure') {
      room.loot = { coins: _coins(depth, rng), potions: rng.randrange(100) < 30 ? 1 : 0 }; // a chest
      const piece = _setPiece(env, 'treasure', depth, rng, owned);                 // maybe a set piece
      if (piece) room.loot.trophy = piece;                                         // banks like a trophy
    } else if (kind === 'key') {
      room.loot = { keys: 1 };                                                     // the vault's key
    } else if (kind === 'game') {
      room.game = _game(rng);                                                      // a little game
    } else if (kind === 'vault') {
      room.lock = lock;                                                            // its lock
      room.loot = _vaultLoot(env, depth, rng, pet, carried);                       // its prize
    }
    rooms[k] = room;                                                               // keep it
  }
  return { rooms, start: startKey };                                               // the floor
}

/** Now and then, a piece of this place's decor set she neither has nor found on this trip (added to `owned`). */
function _setPiece(env, where, depth, rng, owned) {
  const [base, more] = SET_CHANCE[where];                                          // its chance
  if (rng.randrange(100) >= base + more * (depth - 1)) return null;                // most of the time: nothing
  const fresh = (SETS[env.id] || []).map((item) => item.id).filter((id) => !owned.has(id)); // pieces still to find
  if (!fresh.length) return null;                                                  // she has them all
  const piece = fresh[rng.randrange(fresh.length)];                                // one of them
  owned.add(piece);                                                                // never twice on a floor
  return piece;                                                                    // the piece
}

/** What a vault holds: plenty of coins, a trophy she doesn't have yet, and sometimes a mod that can't be bought. */
function _vaultLoot(env, depth, rng, pet, held) {
  const loot = { coins: _coins(depth, rng, 3.0), potions: 1 };                     // coins and a potion
  const fresh = (TROPHIES[env.id] || []).map((t) => t.id).filter((id) => !(pet.decor || []).includes(id) && !held.trophies.includes(id)); // trophies still to find
  if (fresh.length) loot.trophy = fresh[rng.randrange(fresh.length)];              // one of them
  const mods = _FOUND_MODS.map((m) => m.id).filter((id) => !(pet.mods_owned || []).includes(id) && !held.mods.includes(id)); // dungeon mods still to find
  if (mods.length && rng.randrange(100) < MOD_CHANCE[0] + MOD_CHANCE[1] * depth) loot.mod = mods[rng.randrange(mods.length)]; // sometimes one
  return loot;                                                                     // the prize
}

// A room's little game; its secret (which cup, where the pairs are) stays on the server.
function _game(rng) {
  if (rng.randrange(2)) return { kind: 'cups', prize: rng.randrange(CUPS) };       // three cups
  const deck = _shuffle(RUNES.slice(0, PAIRS).flatMap((symbol) => [symbol, symbol]), rng); // four pairs
  return { kind: 'match', deck, found: [], open: null, flips: 0, last: null };     // Constellation Match
}

// ------------------------------------------------------------------------------------------------ a run, saved

/** This player's run as it stands (finished or not); null if they never started one. */
function current(userId) {
  const row = getDb().prepare('SELECT state FROM lumi_runs WHERE user_id = ?').get(String(userId)); // her row
  if (!row) return null;                                                           // never
  try { return JSON.parse(row.state); } catch { return null; }                     // parsed (broken: as if none)
}

/** erinne _save: keep the last LOG story lines and upsert the run. Call inside db.tx(). */
function _save(userId, run) {
  run.log = (run.log || []).slice(-LOG);                                           // the story so far, trimmed
  getDb().prepare(`
    INSERT INTO lumi_runs (user_id, state) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = datetime('now')
  `).run(String(userId), JSON.stringify(run));                                     // one JSON document
}

/** How many potions Lumi can drink right now: her own, plus any found on a trip still under way. */
function potionsReady(run, pet) {
  return pet.potions + (run && !run.over ? run.satchel.potions : 0);               // hers + found
}

/** Every environment, each marked with whether her level has opened it. */
function openEnvironments(pet) {
  return CATALOG.environments.map((env) => ({ id: env.id, name: env.name, family: env.family, about: env.about, opens: env.opens, palette: env.palette, open: pet.level >= env.opens })); // for the page
}

/** Set out. One run at a time; a finished one is replaced. Call inside db.tx(). */
function start(userId, pet, envId, now, rng = null) {
  const dice = rng || lumibattle.systemRandom();                                   // secure by default
  const env = typeof envId === 'string' ? _ENVS[envId] : undefined;                // the place
  if (!env) throw new DungeonError("That isn't somewhere Lumi can go.");           // unknown
  if (pet.level < env.opens) throw new DungeonError(`${env.name} opens at level ${env.opens}.`); // too soon
  const old = current(userId);                                                     // a run already?
  if (old && !old.over) throw new DungeonError('Lumi is already out exploring. Finish that trip first, or head home.'); // one at a time
  if (pet.faint_until > now) throw new DungeonError('Lumi is still napping off her last fight.'); // fainted
  if (lumibattle.current(userId)) throw new DungeonError('Lumi is in the middle of a fight.'); // fighting
  const floor = generate(envId, 1, dice, pet);                                     // the first floor
  const numbers = lumibattle.stats(pet);                                           // her numbers
  const run = { id: now, env: envId, depth: 1, rooms: floor.rooms, at: floor.start, prev: null, facing: null, // where she is
    satchel: { coins: 0, potions: 0, keys: 0, trophies: [], mods: [] }, hp: lumibattle.health(pet), mp: numbers.mp, // she sets out as hurt as she is
    fight: null, over: null, ended: null, tales: {}, log: [], event: { scenario: 'enter' } }; // the rest
  _save(userId, run);                                                              // keep it
  return run;                                                                      // the run
}

/** How each rune of a guess did: 'right', 'near' (in the code elsewhere, only as often as it is spare) or 'miss'. */
function runeMarks(guess, code) {
  const spare = guess.map((rune, i) => (rune !== code[i] ? code[i] : null)).filter((r) => r !== null); // the code's unmatched runes
  return guess.map((rune, i) => {
    if (rune === code[i]) return 'right';                                          // right place
    const at = spare.indexOf(rune);                                                // spare somewhere?
    if (at >= 0) { spare.splice(at, 1); return 'near'; }                           // use it up
    return 'miss';                                                                 // not in the code
  });
}

// The room she stands in.
function _room(run) {
  return run.rooms[run.at];                                                        // by "x,y"
}

/** The room next door: "2,1" going east is "3,1". */
function _step(at, way) {
  const [x, y] = at.split(',').map(Number);                                        // where
  return `${x + DIRS[way][0]},${y + DIRS[way][1]}`;                                // next door
}

// Move a room's loot into the satchel; returns what was taken (for the page to announce).
function _take(run, loot) {
  const bag = run.satchel;                                                         // the satchel
  for (const key of ['coins', 'potions', 'keys']) bag[key] += loot[key] || 0;      // the counts
  if (loot.trophy) bag.trophies.push(loot.trophy);                                 // something for the house
  if (loot.mod) bag.mods.push(loot.mod);                                           // a dungeon mod
  return loot;                                                                     // what was taken
}

// Arrive in a room and let it happen; returns a fight if one began.
function _enter(userId, pet, run, to, now, rng) {
  run.prev = run.at;                                                               // where she came from
  run.at = to;                                                                     // where she is
  run.facing = null;                                                               // no door in front of her
  const room = _room(run);                                                         // the room
  const first = !room.seen;                                                        // her first time here?
  room.seen = true;                                                                // seen now
  if (room.kind === 'enemy' && !room.done) {                                       // a creature waits
    const entry = lumibattle._ENEMIES[room.enemy.id];                              // who
    const level = Math.max(1, Math.min(lumibattle.MAX_LEVEL, pet.level + rng.randrange(3) - 1 + (run.depth - 1))); // its level
    const fight = lumibattle.start(userId, pet, entry.tier, now, rng, { enemy: entry.id, level, carry: { hp: run.hp, mp: run.mp }, dungeon: true }); // the fight
    run.fight = fight.id;                                                          // she's fighting
    run.event = { scenario: 'enemy', enemy: entry.name };                          // the moment
    return fight;                                                                  // for the page
  }
  if (['treasure', 'key', 'vault'].includes(room.kind) && !room.done) run.event = { scenario: 'see_' + room.kind }; // it waits to be taken
  else if (room.kind === 'game' && !room.done) run.event = { scenario: 'game_' + room.game.kind }; // a game waits
  else run.event = { scenario: room.kind === 'stairs' ? 'stairs' : room.kind === 'start' ? 'start' : first ? 'empty' : 'again' }; // nothing to do
  return null;                                                                     // no fight
}

// A little game's coins into the satchel (native).
function _prize(run, rng, scale) {
  const won = _coins(run.depth, rng, scale);                                       // how many
  run.satchel.coins += won;                                                        // into the satchel
  return won;                                                                      // for the moment
}

/**
 * One choice in the dungeon. Changes the run (saved here) and perhaps the pet (the caller saves it). Returns a
 * fight if a step walked into one. Call inside db.tx().
 * opts: { way, moves (u/d/l/r string), picks (list), username (for the SGC account when she walks home) }
 */
function act(userId, pet, action, now, rng = null, { way = null, moves = '', picks = null, username = null } = {}) {
  const dice = rng || lumibattle.systemRandom();                                   // secure by default
  const run = current(userId);                                                     // her run
  const chosen = Array.isArray(picks) ? picks : [];                                // picks
  if (!run || run.over) throw new DungeonError("Lumi isn't out exploring.");       // no trip
  if (run.fight) throw new DungeonError('Lumi is in the middle of a fight.');      // fighting
  const room = _room(run);                                                         // where she is
  let fight = null;                                                                // a fight she walked into

  if (action === 'move') {
    if (!room.exits.includes(way)) throw new DungeonError("There's no way through there."); // a wall
    const to = _step(run.at, way);                                                 // next door
    const target = run.rooms[to];                                                  // that room
    if (target.lock && !target.done) {                                             // a locked door
      run.facing = to;                                                             // stop at it; the page shows its lock
      run.event = { scenario: target.lock.kind === 'key' ? 'locked_key' : 'locked_puzzle', lock: target.lock.kind }; // the moment
    } else {
      fight = _enter(userId, pet, run, to, now, dice);                             // walk in
    }
  } else if (['unlock', 'sokoban', 'lights', 'rune'].includes(action)) {
    const door = run.facing ? run.rooms[run.facing] : undefined;                   // the door in front of her
    if (!door || door.done) throw new DungeonError("There's no locked door in front of Lumi."); // none
    const lock = door.lock;                                                        // its lock
    let opened = false;                                                            // did it open?
    if (action === 'unlock' && lock.kind === 'key') {
      if (run.satchel.keys < 1) throw new DungeonError("Lumi needs a key for this door. There's one somewhere on this floor."); // no key
      run.satchel.keys -= 1;                                                       // use it
      opened = true;                                                               // open
    } else if (action === 'sokoban' && lock.kind === 'sokoban') {
      const level = SOKOBAN.find((l) => l.id === lock.level);                      // its level
      if (typeof moves !== 'string' || moves.length > MAX_MOVES || !sokobanSolved(level.rows, moves)) throw new DungeonError("The crates aren't all in place yet."); // replayed here
      opened = true;                                                               // solved
    } else if (action === 'lights' && lock.kind === 'lights') {
      if (chosen.length > 200 || !lightsSolved(lock.board, lock.size, chosen)) throw new DungeonError('Some lamps are still lit.'); // replayed here
      opened = true;                                                               // all dark
    } else if (action === 'rune' && lock.kind === 'runes') {
      if (chosen.length !== RUNE_SLOTS || chosen.some((rune) => !RUNES.includes(rune))) throw new DungeonError(`Choose ${RUNE_SLOTS} runes.`); // a full guess
      const marks = runeMarks(chosen, lock.code);                                  // right, near, miss
      const exact = marks.filter((m) => m === 'right').length;                     // right place
      const near = marks.filter((m) => m === 'near').length;                       // wrong place
      lock.tries.push({ guess: [...chosen], exact, near, marks });                 // remember the guess
      opened = exact === RUNE_SLOTS;                                               // all right?
      if (!opened && lock.tries.length >= RUNE_TRIES) {                            // out of tries: a new code
        lock.code = Array.from({ length: RUNE_SLOTS }, () => RUNES[dice.randrange(RUNES.length)]); // new code
        lock.tries = [];                                                           // start again
        run.event = { scenario: 'runes_reset' };                                   // the moment
      } else if (!opened) {
        run.event = { scenario: 'runes_try', exact, near };                        // how it went
      }
    } else {
      throw new DungeonError("That isn't how this door opens.");                   // the wrong kind
    }
    if (opened) {
      door.lock = { kind: lock.kind };                                             // spent: forget its answer
      _enter(userId, pet, run, run.facing, now, dice);                             // walk in
    }
  } else if (action === 'take') {
    if (!['treasure', 'key', 'vault'].includes(room.kind) || room.done) throw new DungeonError("There's nothing here to pick up."); // nothing
    room.done = true;                                                              // taken
    run.event = { scenario: room.kind, loot: _take(run, room.loot) };              // the moment
  } else if (action === 'look') {                                                  // a detail of the room, a new one each time
    room.looks = (room.looks || 0) + 1;                                            // one more look
    run.event = { scenario: 'look', n: room.looks };                               // the moment
  } else if (action === 'back') {
    run.facing = null;                                                             // step back from the door
    run.event = { scenario: 'again' };                                             // the moment
  } else if (action === 'cup' || action === 'flip') {
    const game = room.game;                                                        // the room's game
    if (room.kind !== 'game' || room.done || !game || game.kind !== { cup: 'cups', flip: 'match' }[action]) throw new DungeonError("There's no game like that here."); // wrong room
    const pick = chosen.length === 1 && Number.isInteger(chosen[0]) ? chosen[0] : -1; // one whole number
    if (action === 'cup') {
      if (pick < 0 || pick >= CUPS) throw new DungeonError('Choose a cup.');      // no such cup
      room.done = true;                                                            // played
      const won = pick === game.prize;                                             // the server already decided
      run.event = { scenario: won ? 'game_win' : 'game_lose', coins: _prize(run, dice, won ? 2.5 : 0.3), prize: game.prize }; // the moment
    } else {
      if (pick < 0 || pick >= game.deck.length || game.found.includes(pick) || pick === game.open) throw new DungeonError("Choose a card that's face down."); // already up
      game.flips += 1;                                                             // one more turn
      if (game.open === null) {
        game.open = pick;                                                          // the first of a pair
        game.last = null;                                                          // forget the last pair
        run.event = { scenario: 'match_flip' };                                    // the moment
      } else {
        const first = game.open;                                                   // the first card
        game.open = null;                                                          // both turned
        game.last = [first, pick];                                                 // shown once
        const pair = game.deck[first] === game.deck[pick];                         // a match?
        if (pair) game.found.push(first, pick);                                    // found
        run.event = { scenario: pair ? 'match_pair' : 'match_miss' };              // the moment
      }
      if (game.found.length === game.deck.length || game.flips >= FLIPS) {         // all found, or out of turns
        room.done = true;                                                          // played
        const pairs = Math.floor(game.found.length / 2);                           // how well
        run.event = { scenario: pairs === PAIRS ? 'game_win' : 'game_lose', coins: _prize(run, dice, 0.3 + 0.7 * pairs), pairs }; // the moment
      }
    }
  } else if (action === 'potion') {
    const numbers = lumibattle.stats(pet);                                         // her numbers
    if (run.hp >= numbers.hp) throw new DungeonError('Lumi is already at full health.'); // no need
    if (run.satchel.potions > 0) run.satchel.potions -= 1;                         // a found one first (not hers yet anyway)
    else if (pet.potions > 0) pet.potions -= 1;                                    // then her own
    else throw new DungeonError('Lumi has no potions with her.');                  // none
    run.hp = Math.min(numbers.hp, run.hp + Math.max(1, Math.trunc(numbers.hp * lumibattle.POTION_MEND))); // half back
    run.event = { scenario: 'potion' };                                            // the moment
  } else if (action === 'descend') {
    if (room.kind !== 'stairs') throw new DungeonError('There are no stairs here.'); // no stairs
    const floor = generate(run.env, run.depth + 1, dice, pet, run.satchel);        // the next floor
    Object.assign(run, { depth: run.depth + 1, rooms: floor.rooms, at: floor.start, prev: null, facing: null, tales: {} }); // go down
    run.satchel.keys = 0;                                                          // a key fits only its own floor
    run.event = { scenario: 'descend' };                                           // the moment
  } else if (action === 'leave') {
    if (room.kind !== 'start') throw new DungeonError('The way home is back where Lumi came in.'); // not here
    _bank(userId, pet, run, now, username);                                        // home with the satchel
  } else if (action === 'abandon') {
    lumibattle.hurt(pet, run.hp);                                                  // her bruises come home with her
    Object.assign(run, { over: 'abandoned', ended: { lost: run.satchel, depth: run.depth, at: now }, event: { scenario: 'abandon' } }); // dated for the welcome home
    run.satchel = { coins: 0, potions: 0, keys: 0, trophies: [], mods: [] };       // left behind
  } else {
    throw new DungeonError("Lumi doesn't know that one.");                         // unknown
  }
  _save(userId, run);                                                              // keep it
  return fight;                                                                    // a fight, or null
}

/**
 * erinne _bank: walk out with the satchel; only now is it hers. Coins are paid once, by the run's id:
 * sgc.pay(uid, name, native satchel coins, 'dungeon', 'win', `lumi-run:${uid}:${run.id}`).
 * ended.coins = SGC paid now (+ owed / capped when the bank was closed or today's cap bit).
 */
function _bank(userId, pet, run, now, username = null) {
  const bag = run.satchel;                                                         // what she carries
  const uid = String(userId);                                                      // Discord id
  lumibattle.hurt(pet, run.hp);                                                    // her bruises come home, to mend there
  const paid = bag.coins ? sgc.pay(uid, username || users.displayName(uid), bag.coins, GAME, 'win', `lumi-run:${uid}:${run.id}`) : { paid: 0, owed: 0, capped: false }; // pay once
  const kept = Math.min(bag.potions, lumibattle.POTION_CAP - pet.potions);        // potions that fit her pocket
  pet.potions += kept;                                                             // into it
  pet.decor = [...pet.decor, ...bag.trophies.filter((t) => !pet.decor.includes(t))]; // trophies and set pieces are hers
  pet.mods_owned = [...pet.mods_owned, ...bag.mods.filter((m) => !pet.mods_owned.includes(m))]; // dungeon mods are hers
  const ended = { coins: paid.paid, potions: kept, trophies: bag.trophies, mods: bag.mods, depth: run.depth, at: now }; // what she brought
  const event = { scenario: 'home' };                                              // the moment
  const notes = [];                                                                // words about the bank
  if (paid.owed > 0) { ended.owed = paid.owed; notes.push('Lumi-Town Bank is closed for a moment, your prize is saved.'); } // owed later
  if (paid.capped) { ended.capped = true; notes.push("You've reached today's Lumi Dungeons prize limit."); } // daily cap
  if (notes.length) event.note = notes.join(' ');                                  // lumitales.line adds it to the story
  Object.assign(run, { over: 'home', ended, event });                              // home
}

/**
 * A dungeon fight just ended. A win clears the room and puts its (native) coins in the satchel; running steps back;
 * a defeat ends the run, empties the satchel and leaves her with no health. Saves the run; caller saves the pet.
 */
function afterFight(userId, pet, run, fight, now = null) {
  run.fight = null;                                                                // not fighting
  const lumi = fight.player;                                                       // her, as the fight left her
  run.hp = Math.max(1, lumi.hp);                                                   // her health carries on
  run.mp = lumi.mp;                                                                // and her MP
  if (fight.status === 'victory') {
    const room = _room(run);                                                       // the den
    room.done = true;                                                              // cleared
    run.satchel.coins += fight.reward.coins;                                       // native coins into the satchel
    run.event = { scenario: 'victory', enemy: fight.enemy.name, coins: fight.reward.coins }; // the moment
    if (room.loot) {                                                               // it dropped a piece of the place's set
      const loot = room.loot;                                                      // the piece
      delete room.loot;                                                            // gone from the room
      run.event.dropped = _take(run, loot).trophy;                                 // into the satchel
    }
  } else if (fight.status === 'ran') {
    [run.at, run.prev] = [run.prev, run.at];                                       // back the way she came
    run.event = { scenario: 'fled', enemy: fight.enemy.name };                     // the moment
  } else {
    lumibattle.hurt(pet, 0);                                                       // no health at all
    Object.assign(run, { over: 'defeat', ended: { lost: run.satchel, depth: run.depth, at: now }, event: { scenario: 'defeat', enemy: fight.enemy.name } }); // the trip ends
    run.satchel = { coins: 0, potions: 0, keys: 0, trophies: [], mods: [] };       // emptied
  }
  _save(userId, run);                                                              // keep it
}

// ------------------------------------------------------------------------------------------------ what the page is told

/** A lock as the page may see it: the puzzle to play, never its answer. */
function _publicLock(lock) {
  if (lock.kind === 'sokoban' && 'level' in lock) return { kind: 'sokoban', rows: SOKOBAN.find((l) => l.id === lock.level).rows }; // the level
  if (lock.kind === 'lights' && 'board' in lock) return { kind: 'lights', size: lock.size, board: lock.board }; // the lamps
  if (lock.kind === 'runes' && 'code' in lock) return { kind: 'runes', runes: [...RUNES], slots: RUNE_SLOTS, tries: lock.tries, left: RUNE_TRIES - lock.tries.length }; // guesses so far
  return { kind: lock.kind };                                                      // a key door (or a spent puzzle)
}

/** A room's game as the page may see it (cards only once turned). */
function _publicGame(game, done) {
  if (game.kind === 'cups') return { kind: 'cups', cups: CUPS };                   // just the cups
  const shown = new Set([...game.found, ...(game.open !== null ? [game.open] : []), ...(game.last || [])]); // face up
  return { kind: 'match', cards: game.deck.map((card, i) => (shown.has(i) || done ? card : null)), // only those
    found: game.found, open: game.open, last: game.last, left: FLIPS - game.flips }; // and the counts
}

/** The run as the page may know it: only rooms she has stood in, a blank for each doorway seen. */
function view(run, pet) {
  if (!run) return null;                                                           // no run
  const env = _ENVS[run.env];                                                      // the place
  const numbers = lumibattle.stats(pet);                                           // her numbers
  const rooms = {};                                                                // "x,y" -> what the page sees
  for (const [k, room] of Object.entries(run.rooms)) {
    if (!room.seen) continue;                                                      // never stood in
    rooms[k] = { kind: room.kind, done: room.done, exits: room.exits };            // its shape
    for (const way of room.exits) {
      const next = _step(k, way);                                                  // a doorway
      if (!(next in rooms)) rooms[next] = { kind: 'unknown' };                     // a blank
    }
  }
  const here = run.rooms[run.at];                                                  // where she is
  const out = {
    id: run.id, env: { id: env.id, name: env.name, family: env.family, palette: env.palette }, depth: run.depth, at: run.at, // where
    rooms: Object.fromEntries(Object.entries(rooms).filter(([k, room]) => run.rooms[k].seen || room.kind === 'unknown')), // seen or a blank
    room: { kind: here.kind, done: here.done, exits: here.exits },                 // this room
    satchel: run.satchel, hp: run.hp, hpMax: numbers.hp, mp: run.mp, mpMax: numbers.mp, // her bag and bars
    over: run.over, ended: run.ended, event: run.event, say: run.say || '',        // how it stands
    scene: run.scene || '', story: run.log,                                        // what this room is like, the tale so far
    fighting: Boolean(run.fight), facing: null, game: null,                        // filled below
  };
  if (run.facing) out.facing = { at: run.facing, lock: _publicLock(run.rooms[run.facing].lock) }; // the door in front of her
  if (here.kind === 'game') out.game = _publicGame(here.game, here.done);          // the room's game
  return out;                                                                      // for the page
}

module.exports = {
  // constants
  GAME, GRID_W, GRID_H, ROOMS, DIRS, BACK, LOCKS, RUNES, RUNE_SLOTS, RUNE_TRIES, CUPS, PAIRS, FLIPS, MAX_MOVES, LOG,
  TIERS_BY_DEPTH, ENV_BIAS, MOD_CHANCE, SET_CHANCE,
  DungeonError,
  // catalogs
  loadCatalog, sokobanParse, sokobanSolved, loadSokoban, _found, loadTrophies, loadSets,
  CATALOG, SOKOBAN, TROPHIES, SETS, _ENVS, FOUND_NAMES, _FOUND_MODS,
  lightsPress, lightsSolved,
  // floors
  _weighted, _shuffle, _coins, _lock, _enemy, generate, _setPiece, _vaultLoot, _game,
  // runs
  current, _save, potionsReady, openEnvironments, start, runeMarks, _room, _step, _take, _enter, _prize, act, _bank,
  afterFight,
  // the page
  _publicLock, _publicGame, view,
};
