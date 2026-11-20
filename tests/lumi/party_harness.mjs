// Test helper for the Lumi Party tests (not a test file itself): boots Lumi-Town on an in-memory DB, and while the
// dungeon agent's src/lumi/dungeon/lumidungeon.js or lumitales.js are missing, points lumiparty.js at the small
// stand-ins in tests/lumi/party_stubs/ (src is never touched). Helpers mirror erinne tests/test_lumiparty.py.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const Module = require("node:module");                                   // to redirect missing dependencies
const HERE = path.dirname(fileURLToPath(import.meta.url));               // tests/lumi
const SRC = path.resolve(HERE, "../../src/lumi");                        // src/lumi
const STUBS = { "../dungeon/lumidungeon": "lumidungeon.cjs", "../dungeon/lumitales": "lumitales.cjs" }; // dependency -> stand-in
export const stubbed = {};                                               // which stand-ins are in use
for (const [request, file] of Object.entries(STUBS)) {
  const real = path.join(SRC, request.replace("../", "") + ".js");      // where the real port will live
  stubbed[path.basename(request)] = !fs.existsSync(real);               // missing -> stand-in
}
const resolve = Module._resolveFilename;                                 // the original resolver
Module._resolveFilename = function (request, parent, ...rest) {          // only for lumiparty's own requires
  if (STUBS[request] && parent && parent.filename && parent.filename.startsWith(SRC) && stubbed[path.basename(request)]) {
    return path.join(HERE, "party_stubs", STUBS[request]);               // the stand-in
  }
  return resolve.call(this, request, parent, ...rest);                   // everything else as usual
};

export const env = boot();                                               // in-memory economy + Lumi
export const { eco, db, sgc, tuning } = env;                             // shortcuts
export const P = require("../../src/lumi/party/lumiparty.js");           // the module under test
export const B = require("../../src/lumi/dungeon/lumibattle.js");        // the battle rules
export const D = require(stubbed.lumidungeon ? "./party_stubs/lumidungeon.cjs" : "../../src/lumi/dungeon/lumidungeon.js"); // the dungeon rules
export const save = require("../../src/lumi/pet/save.js");              // pet saves
export const lobby = require("../../src/lumi/arcade/lobby.js");          // presence
export { setBalance, resetLumi };                                        // re-exported

export const T0 = 1_800_000_000_000;                                     // erinne's T0
export const S = 1000;                                                   // one second in ms
export const TRIO = ["111111111111111111", "222222222222222222", "333333333333333333"]; // doll, jane, mina
export const NAMES = ["doll", "jane", "mina"];                           // their names
db.setClock(() => T0);                                                   // a fixed clock (presence too: nobody goes quiet)
setBalance(eco, "__LUMI_TOWN_BANK__", 1_000_000);                         // the bank can pay prizes
for (const uid of TRIO) db.tx(() => save.load(uid, { now: T0 }));        // a Lumi each

/** A seeded dice (erinne random.Random(seed)): rng() / random() in [0, 1) and randrange(n). */
export function seeded(seed = 3) {
  let a = seed >>> 0;                                                    // mulberry32 state
  const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; // next float
  rng.random = rng;                                                      // Python random()
  rng.randrange = (n) => Math.floor(rng() * n);                          // Python randrange(n)
  return rng;                                                            // the dice
}

/** erinne test_lumidungeon.Dice: random() gives `chance`; randrange(n) gives the listed rolls in turn, then `pick`. */
export function Dice(rolls = [], { pick = 0, chance = 0.5 } = {}) {
  const left = [...rolls];                                               // rolls to come
  const rng = () => chance;                                              // callable
  rng.random = () => chance;                                             // always this
  rng.randrange = (n) => Math.min(left.length ? left.shift() : pick, n - 1); // scripted
  return rng;                                                            // the dice
}

/** One party action in a transaction (erinne _act). */
export function act(code, uid, action, { now = T0, rng = null, ...opts } = {}) {
  return db.tx(() => P.act(code, uid, action, now, rng || seeded(3), opts)); // like the route
}

/** The party as saved (erinne _state). */
export function state(code) {
  return JSON.parse(db.getDb().prepare("SELECT state FROM lumi_parties WHERE code = ?").get(code).state); // parsed
}

/** Save a hand-edited party (erinne _put). */
export function put(st) {
  db.getDb().prepare("UPDATE lumi_parties SET state = ? WHERE code = ?").run(JSON.stringify(st), st.code); // written
}

/** Free everyone from earlier parties (each test file shares one DB). */
export function clear() {
  db.getDb().exec("DELETE FROM lumi_party_members; DELETE FROM lumi_parties; DELETE FROM lumi_battles; DELETE FROM lumi_runs;"); // clean slate
  for (const uid of TRIO) db.tx(() => { const pet = save.load(uid, { now: T0 }); Object.assign(pet, { faint_until: 0, task: null, potions: 0, kit: {}, wound: 0 }); save.save(uid, pet); }); // rested
}

/** A small known floor (erinne _floor): start(0,0) - hall(1,0) - vault(2,0); game(1,1) - creature(2,1) - stairs(3,1); key(1,2). */
export function floor(code, { lock = null, game = null } = {}) {
  const st = state(code);                                                // the party
  st.run.rooms = {                                                       // seven rooms
    "0,0": { kind: "start", exits: ["e"], seen: true, done: true }, // the entrance
    "1,0": { kind: "treasure", exits: ["e", "s", "w"], seen: false, done: false, loot: { coins: 20, potions: 1 } }, // a hall with a chest
    "2,0": { kind: "vault", exits: ["w"], seen: false, done: false, lock: lock || { kind: "runes", code: ["sun", "moon", "star", "leaf"], tries: [] }, loot: { coins: 90, potions: 1 } }, // the vault behind a door
    "1,1": { kind: "game", exits: ["e", "n", "s"], seen: false, done: false, game: game || { kind: "cups", prize: 1 } }, // a little game
    "1,2": { kind: "key", exits: ["n"], seen: false, done: false, loot: { keys: 1 } }, // the key room
    "2,1": { kind: "enemy", exits: ["e", "w"], seen: false, done: false, enemy: { id: B.CATALOG.enemies[0].id } }, // a creature
    "3,1": { kind: "stairs", exits: ["w"], seen: false, done: true }, // the stairs down
  };                                                                     // end of the floor
  Object.assign(st.run, { at: "0,0", prev: null, facing: null, puzzle: null, fighting: false, vote_since: null }); // at the start
  put(st);                                                               // saved
}

/** A party of `size`, everyone ready, set out on the known floor (erinne _party). */
export function party(size = 3) {
  clear();                                                               // nobody in a party yet
  const code = db.tx(() => P.create(TRIO[0], "doll", T0)).code;          // doll makes it
  for (let i = 1; i < size; i++) act(code, TRIO[i], "join", { name: NAMES[i] }); // the others join
  for (let i = 0; i < size; i++) act(code, TRIO[i], "ready");            // everyone ready
  act(code, TRIO[0], "start");                                           // set out
  floor(code);                                                           // the known floor
  return code;                                                           // its code
}

/** Two of three vote the same way: a majority (erinne _walk). */
export function walk(code, way, now = T0) {
  act(code, TRIO[0], "move", { now, way });                              // one vote
  return act(code, TRIO[1], "move", { now, way });                       // the second settles it
}
