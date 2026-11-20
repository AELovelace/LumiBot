// Test helper (not a test file itself): dice and pets for the Lumi Dungeons tests (dungeon_*.test.mjs), ported from
// erinne tests/test_lumibattle.py, test_lumidungeon.py and test_lumitales.py. Boots Lumi-Town once per test file.
import { createRequire } from "node:module";
import { boot, setBalance } from "./lumi_env.mjs";
const require = createRequire(import.meta.url);

export const env = boot();                                                     // fresh in-memory economy + Lumi-Town
export const B = require("../../src/lumi/dungeon/lumibattle.js");              // battles
export const D = require("../../src/lumi/dungeon/lumidungeon.js");             // dungeon runs
export const T = require("../../src/lumi/dungeon/lumitales.js");               // the words
export const P = require("../../src/lumi/pet/lumipet.js");                    // erinne lumipet fight_*/dungeon_*/snapshot (play.js is gone)
export const save = require("../../src/lumi/pet/save.js");                     // the pet save
export const T0 = 1_800_000_000_000;                                           // erinne's test clock
export const TREES = Object.fromEntries(B.CATALOG.trees.map((tree) => [tree.id, tree.nodes.map((node) => node.id)])); // tree -> skill ids
export const ENVS = D.CATALOG.environments.map((e) => e.id);                   // environment ids
export const BANK = env.eco.LUMI_TOWN_BANK_USER_ID;                            // pays every prize
export const OUTFITTERS = "__LUMI_OUTFITTERS__";                               // the battle shop's account

let next = 100000000000000000n;                                                // Discord-shaped ids
/** A new player with 1000 SGC (erinne's starting purse in its tests) and a well-funded bank. */
export function player(balance = 1000) {
  next += 1n;                                                                  // a new id
  const uid = String(next);                                                    // as a string
  setBalance(env.eco, uid, balance);                                           // their purse
  setBalance(env.eco, BANK, 1_000_000);                                        // the bank can pay
  return uid;                                                                  // the id
}

/** SGC balance. */
export const coins = (uid) => env.sgc.balance(uid);                            // the coin chip

/** erinne's Script dice: random() gives the listed rolls then `rest`; randrange(n) always gives `pick`. */
export function Script(rolls = [], rest = 0.5, pick = 0) {
  const queue = [...rolls];                                                    // rolls to hand out
  return { random: () => (queue.length ? queue.shift() : rest), randrange: (n) => Math.min(pick, n - 1) }; // the dice
}

/** erinne's Dice (test_lumidungeon): random() gives `chance`; randrange(n) gives the listed numbers, then `pick`. */
export function Dice(rolls = [], { pick = 0, chance = 0.5 } = {}) {
  const queue = [...rolls];                                                    // numbers to hand out
  return { random: () => chance, randrange: (n) => Math.min(queue.length ? queue.shift() : pick, n - 1) }; // the dice
}

/** A seeded dice (mulberry32) standing in for Python's random.Random(seed). */
export function Seeded(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;                                      // the state
  const random = () => {                                                       // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;                                                // step the state
    let t = a;                                                                 // mix it...
    t = Math.imul(t ^ (t >>> 15), t | 1);                                      // ...once
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);                                 // ...twice
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;                              // a fraction in [0, 1)
  };
  return { random, randrange: (n) => Math.floor(random() * n), choice: (list) => list[Math.floor(random() * list.length)] }; // the dice
}

/** erinne _pet: a battle-ready pet (points spread evenly, so her numbers are as before points existed). */
export function makePet({ level = 1, skills = [], mods = [], glow = "rose", moves = null, ...rest } = {}) {
  const pet = { glow, boost: null, decor: [], name: "Lumi", ...B.freshFields() }; // the basics
  Object.assign(pet, { level, skills: [...skills], mods: [...mods, null, null, null, null, null].slice(0, 5) }); // level, skills, mods
  pet.stat_points = Object.fromEntries(B.STAT_KEYS.map((key) => [key, level - 1])); // spread evenly
  if (moves) pet.moves = moves;                                                // her moves
  return Object.assign(pet, rest);                                             // anything else
}

/** erinne _fight: a solo fight state between a pet and an enemy. */
export function fightOf(pet, enemyId, level = null, boost = null) {
  const lumi = B._lumi(pet);                                                   // her
  return { player: lumi, enemy: B._enemy(B._ENEMIES[enemyId], level || pet.level, pet.level, lumi.element), choice: "common", boost, outcome: null, reward: null, log: [] };
}

/** erinne _set: change stored pet fields (a level comes with its points spread evenly). */
export function setPet(uid, fields) {
  env.db.tx(() => {                                                            // one transaction
    const pet = save.load(uid, { now: T0 });                                   // load (creates her)
    const extra = "level" in fields && !("stat_points" in fields) ? { stat_points: Object.fromEntries(B.STAT_KEYS.map((k) => [k, fields.level - 1])) } : {}; // spread
    Object.assign(pet, fields, extra);                                         // change
    save.save(uid, pet);                                                       // store
  });                                                                          // committed
}

/** The stored pet (read-only). */
export const petOf = (uid) => save.peek(uid);                                  // as saved

/** Run fn inside one transaction. */
export const tx = (fn) => env.db.tx(fn);                                       // db.tx

/** erinne _start (battle): start a fight through the pet glue. */
export function startFight(uid, tier = "common", rng = null, now = T0) {
  return tx(() => P.fightStart(uid, tier, now, rng || Script())).fight;        // the fight
}

/** erinne _turn: press one button. */
export function turn(uid, fight, action, rng = null, now = T0) {
  return tx(() => P.fightAct(uid, fight.id, fight.turn, action, now, rng || Script())).fight; // the fight after
}

/** erinne _do for the battle shop (lumipet.act's battle actions call lumibattle.progress). */
export function shop(uid, action, { item = null, slot = null, count = 0, now = T0 } = {}) {
  return tx(() => {
    const pet = save.load(uid, { now });                                       // her
    const said = B.progress(uid, pet, action, item, slot, count, now);         // the action
    save.save(uid, pet);                                                       // keep her
    return { said, pet, progress: B.summary(pet), coins: env.sgc.balance(uid) }; // what erinne's snapshot carried
  });
}

/** Expect a LumiError whose message matches. */
export function refused(fn, pattern) {
  try { fn(); } catch (error) {                                                // run it
    if (!pattern.test(error.message)) throw new Error(`Wrong refusal: ${error.message} (wanted ${pattern})`); // the wrong words
    return error;                                                              // refused as expected
  }                                                                            // (no throw)
  throw new Error(`Not refused (wanted ${pattern})`);                          // it went through
}

/** A Sokoban solver (BFS over moves, optimal), standing in for python/make_lumi_sokoban.solve. */
export function solveSokoban(rows) {
  const [walls, goals, boxes, start] = D.sokobanParse(rows);                   // the level
  const steps = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };              // moves
  const keyOf = (x, y, held) => `${x},${y}|${[...held].sort().join(";")}`;     // a state
  const first = { x: start[0], y: start[1], held: new Set(boxes), path: "" };  // the start
  const seen = new Set([keyOf(first.x, first.y, first.held)]);                 // visited
  const queue = [first];                                                       // breadth-first
  for (let q = 0; q < queue.length; q += 1) {
    const s = queue[q];                                                        // this state
    if ([...s.held].every((b) => goals.has(b))) return s.path;                 // solved
    for (const [m, [dx, dy]] of Object.entries(steps)) {
      const to = `${s.x + dx},${s.y + dy}`;                                    // next square
      if (walls.has(to)) continue;                                             // a wall
      let held = s.held;                                                       // boxes
      if (held.has(to)) {                                                      // a push
        const beyond = `${s.x + 2 * dx},${s.y + 2 * dy}`;                      // beyond it
        if (walls.has(beyond) || held.has(beyond)) continue;                   // blocked
        held = new Set(held); held.delete(to); held.add(beyond);               // pushed
      }
      const k = keyOf(s.x + dx, s.y + dy, held);                               // the new state
      if (seen.has(k)) continue;                                               // been here
      seen.add(k);                                                             // now we have
      queue.push({ x: s.x + dx, y: s.y + dy, held, path: s.path + m });        // explore it
    }
  }
  return null;                                                                 // unsolvable
}
