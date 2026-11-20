// Lumi Dungeons runs (src/lumi/dungeon/lumidungeon.js), ported at spec level from erinne tests/test_lumidungeon.py:
// floors, movement, the satchel and its stakes (paid in SGC once, at the exit), locks (Sokoban REPLAYED on the server),
// games, fights in the dungeon, and the page never being told what it hasn't seen.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  env, B, D, T, P, save, T0, ENVS, BANK, player, coins, Dice, Seeded, makePet, setPet, petOf, tx, refused, solveSokoban,
} from "./dungeon_helpers.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));                                    // a deep copy
const payout = (native) => env.tuning.scalePayout("dungeon", "win", native);           // what a satchel banks as
const runOf = (uid) => D.current(uid);                                                 // the stored run (everything)
const put = (uid, run) => tx(() => D._save(uid, run));                                 // store a changed run
const start = (uid, envId = "moonlit-shrine", seed = 1) => tx(() => P.dungeonStart(uid, envId, T0, Seeded(seed))).dungeon.run; // set out
const act = (uid, action, { rng = null, ...rest } = {}) => tx(() => P.dungeonAct(uid, action, { now: T0, rng: rng || Seeded(5), ...rest })); // one choice

// erinne _path: the ways from where she is to the nearest room of a kind, avoiding enemies and the vault.
function pathTo(run, goal) {
  const seen = new Map([[run.at, []]]);                                                // room -> ways there
  const queue = [run.at];                                                              // breadth-first
  for (let q = 0; q < queue.length; q += 1) {
    const at = queue[q];                                                               // this room
    if (run.rooms[at].kind === goal && at !== run.at) return seen.get(at);             // found
    for (const way of run.rooms[at].exits) {
      const to = D._step(at, way);                                                     // next door
      if (!seen.has(to) && (!["enemy", "vault"].includes(run.rooms[to].kind) || run.rooms[to].kind === goal)) { seen.set(to, [...seen.get(at), way]); queue.push(to); } // walkable
    }
  }
  return null;                                                                         // none
}

// erinne _clear: empty every enemy, treasure and key room except kinds to keep.
function clearRun(run, keep = []) {
  for (const room of Object.values(run.rooms)) {
    if (["enemy", "treasure", "key"].includes(room.kind) && !keep.includes(room.kind)) Object.assign(room, { kind: "empty", done: true }); // emptied
  }
  return run;                                                                          // the run
}

// erinne _only_one_enemy: keep the nearest creature, empty the others and any pickups on the way.
function onlyOneEnemy(uid, hp = null) {
  const run = runOf(uid);                                                              // the run
  let first = true;                                                                    // the nearest one stays
  const seen = new Set([run.at]);                                                      // visited
  const queue = [run.at];                                                              // breadth-first
  for (let q = 0; q < queue.length; q += 1) {
    const room = run.rooms[queue[q]];                                                  // this room
    if (room.kind === "enemy") { if (!first) Object.assign(room, { kind: "empty", done: true }); first = false; } // one creature
    else if (["treasure", "key"].includes(room.kind)) Object.assign(room, { kind: "empty", done: true }); // nothing to pick up
    for (const way of room.exits) {
      const to = D._step(queue[q], way);                                               // next door
      if (!seen.has(to) && run.rooms[to].kind !== "vault") { seen.add(to); queue.push(to); } // walk on
    }
  }
  if (hp !== null) run.hp = hp;                                                        // her health
  put(uid, run);                                                                       // stored
}

// erinne _walk_into_enemy: walk to the nearest creature; returns the answer of the step that met it.
function walkIntoEnemy(uid) {
  const run = runOf(uid);                                                              // the run
  const seen = new Map([[run.at, []]]);                                                // room -> ways
  const queue = [run.at];                                                              // breadth-first
  for (let q = 0; q < queue.length; q += 1) {
    const at = queue[q];                                                               // this room
    if (run.rooms[at].kind === "enemy") {                                              // found it
      let out = null;                                                                  // the last answer
      for (const way of seen.get(at)) out = act(uid, "move", { way, rng: Dice([], { pick: 1 }) }); // walk there
      return out;                                                                      // it
    }
    for (const way of run.rooms[at].exits) {
      const to = D._step(at, way);                                                     // next door
      if (!seen.has(to) && run.rooms[to].kind !== "vault") { seen.set(to, [...seen.get(at), way]); queue.push(to); } // walk on
    }
  }
  throw new Error("no enemy to walk into");                                            // shouldn't happen
}

const fightOn = (uid, fight, action, chance) => tx(() => P.fightAct(uid, fight.id, fight.turn, action, T0, Dice([], { chance }))); // one dungeon fight turn

// ------------------------------------------------------------------ catalogs
test("twelve environments from mystical to cyberpunk, each with trophies", () => {
  const families = D.CATALOG.environments.map((e) => e.family);                        // their families
  assert.equal(ENVS.length, 12);                                                       // twelve
  assert.deepEqual(["mystical", "fantasy", "cyberpunk"].map((f) => families.filter((x) => x === f).length), [4, 4, 4]); // four each
  const opens = D.CATALOG.environments.map((e) => e.opens);                            // their levels
  assert.deepEqual(opens, [...opens].sort((a, b) => a - b));                           // in order
  assert.deepEqual(Object.keys(D.TROPHIES).sort(), [...ENVS].sort());                  // trophies everywhere
  assert.ok(Object.values(D.TROPHIES).every((t) => t.length === 2));                   // two each
  assert.equal(D._FOUND_MODS.length, 4);                                               // four dungeon mods
  assert.deepEqual(new Set(D._FOUND_MODS.map((m) => m.tek)), new Set(["magitek", "cybertek"])); // both kinds
});

test("bad dungeon catalogs are refused", () => {
  const broken = (change) => { const data = clone(D.CATALOG); change(data); assert.throws(() => D.loadCatalog(data)); }; // break a copy
  broken((d) => { d.environments[0].family = "steampunk"; });                          // unknown family
  broken((d) => { d.environments[0].elements = ["plasma"]; });                         // unknown element
  broken((d) => { d.environments[0].palette.wall = "purple"; });                       // not a colour
  broken((d) => { d.environments.push({ ...d.environments[0] }); });                   // repeated
  broken((d) => { d.environments.forEach((e) => { e.opens = 5; }); });                 // nowhere at level 1
  broken((d) => { d.environments = []; });                                             // none
  assert.ok(D.loadCatalog(clone(D.CATALOG)));                                          // the real one loads
});

test("every shipped Sokoban level can be solved, and they get harder", () => {
  const best = [];                                                                     // optimal lengths
  for (const level of D.SOKOBAN) {
    const answer = solveSokoban(level.rows);                                           // solve it
    assert.ok(answer !== null, level.id);                                              // solvable
    assert.ok(D.sokobanSolved(level.rows, answer));                                    // the replay agrees
    assert.equal(answer.length, level.best);                                           // as short as promised
    best.push(answer.length);                                                          // keep it
  }
  assert.equal(D.SOKOBAN.length, 16);                                                  // sixteen levels
  assert.deepEqual(best, [...best].sort((a, b) => a - b));                             // easiest first
  assert.ok(best[0] >= 8);                                                             // none trivial
});

test("Sokoban answers are replayed strictly", () => {
  const rows = ["#####", "#@$.#", "#####"];                                            // one push
  assert.ok(D.sokobanSolved(rows, "r"));                                               // solved
  for (const wrong of ["", "l", "rr", "u", "rx", "rrr"]) assert.ok(!D.sokobanSolved(rows, wrong), wrong); // unfinished, walls, junk
  assert.ok(!D.sokobanSolved(["#######", "#@$$..#", "#######"], "r"));                 // a box can't push a box
  for (const bad of [["#@#"], ["#@@$.#"], ["#@$#"], ["#@$.x#"]]) assert.throws(() => D.sokobanParse(bad)); // bad levels
});

test("Lights Out presses flip neighbours and only all-dark opens", () => {
  const board = new Array(9).fill(false);                                              // all off
  D.lightsPress(board, 3, 4);                                                          // the middle
  assert.deepEqual(board, [false, true, false, true, true, true, false, true, false]); // a plus
  assert.ok(D.lightsSolved(board, 3, [4]));                                            // undone
  assert.ok(!D.lightsSolved(board, 3, [0]));                                           // not this
  assert.ok(!D.lightsSolved(board, 3, [9]));                                           // off the board
  assert.ok(!D.lightsSolved(board, 3, ["4"]));                                         // junk
});

// ------------------------------------------------------------------ floors
test("every floor is whole, has what it promises, and never locks anything but the vault", () => {
  for (let seed = 0; seed < 400; seed += 1) {
    const floor = D.generate(ENVS[seed % 12], 1 + (seed % 6), Seeded(seed), makePet()); // a floor
    const { rooms, start: first } = floor;                                             // its rooms
    const kinds = Object.values(rooms).map((r) => r.kind);                             // their kinds
    const count = (k) => kinds.filter((x) => x === k).length;                          // how many of a kind
    assert.ok(Object.keys(rooms).length >= D.ROOMS[0] && Object.keys(rooms).length <= D.ROOMS[1]); // a dozen or so
    assert.deepEqual(["start", "stairs", "vault", "game"].map(count), [1, 1, 1, 1], String(seed)); // one of each
    assert.ok(count("enemy") >= 3 && count("enemy") <= 4 && count("treasure") === 2);  // creatures and chests
    const vault = Object.keys(rooms).find((k) => rooms[k].kind === "vault");           // the vault
    assert.equal(rooms[vault].exits.length, 1);                                        // a dead end
    assert.equal(count("key"), rooms[vault].lock.kind === "key" ? 1 : 0);              // a key only for a key door
    for (const [k, room] of Object.entries(rooms)) for (const way of room.exits) assert.ok(rooms[D._step(k, way)].exits.includes(D.BACK[way])); // doors lead back
    const reached = new Set([first]);                                                  // walk without the vault
    const queue = [first];                                                             // breadth-first
    for (let q = 0; q < queue.length; q += 1) for (const way of rooms[queue[q]].exits) { const to = D._step(queue[q], way); if (!reached.has(to) && to !== vault) { reached.add(to); queue.push(to); } } // walk
    assert.equal(reached.size, Object.keys(rooms).length - 1);                         // everything but the vault
    assert.ok(rooms[first].seen);                                                      // only the entrance is seen
    assert.equal(Object.values(rooms).filter((r) => r.seen).length, 1);                // ...and nothing else
  }
});

test("lights locks are always solvable and rune codes use the runes", () => {
  const seen = new Set();                                                              // lock kinds met
  for (let seed = 0; seed < 300; seed += 1) {
    const lock = D._lock(1 + (seed % 5), Seeded(seed));                                // a lock
    seen.add(lock.kind);                                                               // met
    if (lock.kind === "lights") {
      assert.ok(lock.board.some(Boolean) && lock.board.length === lock.size ** 2);     // some lamps lit
      if (lock.size === 3) assert.ok(Array.from({ length: 512 }, (_, m) => m).some((mask) => D.lightsSolved(lock.board, 3, [...Array(9).keys()].filter((c) => (mask >> c) & 1)))); // solvable
    } else if (lock.kind === "runes") {
      assert.ok(lock.code.length === D.RUNE_SLOTS && lock.code.every((r) => D.RUNES.includes(r))); // a real code
    } else if (lock.kind === "sokoban") {
      assert.ok(D.SOKOBAN.some((l) => l.id === lock.level));                           // a real level
    }
  }
  assert.deepEqual(seen, new Set(D.LOCKS));                                            // every kind turns up
});

test("deeper floors bring tougher enemies and more coins", () => {
  const tiers = (depth) => {                                                           // tiers met at a depth
    const found = Array.from({ length: 300 }, (_, s) => B._ENEMIES[D._enemy(D._ENVS["crystal-cavern"], depth, Seeded(s)).id].tier); // 300 rolls
    return Object.fromEntries(Object.keys(B.TIERS).map((t) => [t, found.filter((x) => x === t).length])); // counted
  };
  const shallow = tiers(1);                                                            // floor 1
  const deep = tiers(5);                                                               // floor 5
  assert.ok(shallow.epic === 0 && shallow.legendary === 0 && shallow.common > shallow.uncommon && shallow.uncommon > 0); // gentle
  assert.ok(deep.common === 0 && deep.uncommon === 0 && deep.legendary > 0);           // tough
  const sum = (depth) => Array.from({ length: 50 }, (_, s) => D._coins(depth, Seeded(s))).reduce((a, b) => a + b, 0); // coins found
  assert.ok(sum(5) > 2.5 * sum(1));                                                    // more deeper
  const local = Array.from({ length: 300 }, (_, s) => B._ENEMIES[D._enemy(D._ENVS["crystal-cavern"], 1, Seeded(s)).id].element); // elements met
  assert.ok(local.filter((e) => ["ice", "none"].includes(e)).length > 200);            // mostly the place's own
});

test("a vault offers a trophy she doesn't have yet", () => {
  const both = D.TROPHIES["toy-attic"].map((t) => t.id);                               // the attic's two
  const loot = D._vaultLoot(D._ENVS["toy-attic"], 1, Seeded(1), makePet({ decor: [both[0]] }), { trophies: [], mods: [] }); // one owned
  assert.equal(loot.trophy, both[1]);                                                  // the other
  assert.ok(loot.coins > 0);                                                           // and coins
  assert.ok(!("trophy" in D._vaultLoot(D._ENVS["toy-attic"], 1, Seeded(1), makePet({ decor: both }), { trophies: [], mods: [] }))); // has both
  assert.ok(!("trophy" in D._vaultLoot(D._ENVS["toy-attic"], 1, Seeded(1), makePet({ decor: [both[0]] }), { trophies: [both[1]], mods: [] }))); // carrying the other
});

test("every place has a decor set with a piece for every spot", () => {
  const spots = save.HOUSE.spots.filter((s) => s.id !== "trophy" && !s.room && !("same_as" in s)).map((s) => s.id).sort(); // her bedroom's spots
  assert.deepEqual(Object.keys(D.SETS).sort(), [...ENVS].sort());                      // a set everywhere
  for (const [envId, pieces] of Object.entries(D.SETS)) {
    assert.deepEqual(pieces.map((p) => p.spot).sort(), spots, envId);                  // a piece per spot
    assert.ok(pieces.every((p) => p.price === 0 && p.found === envId && !("rarity" in p))); // found, never sold
  }
  assert.equal(Object.keys(D.FOUND_NAMES).length, 12 * (spots.length + 2));            // every piece has a name
});

test("set pieces are rare, likelier deeper, and never found twice", () => {
  const where = D._ENVS["moonlit-shrine"];                                             // the shrine
  const rate = (kind, depth) => Array.from({ length: 3000 }, (_, s) => D._setPiece(where, kind, depth, Seeded(s), new Set()) !== null).filter(Boolean).length / 3000; // how often
  assert.ok(rate("treasure", 1) > 0.05 && rate("treasure", 1) < 0.11);                 // chests: rare
  assert.ok(rate("enemy", 1) > 0.02 && rate("enemy", 1) < 0.06);                       // creatures: rarer
  assert.ok(rate("treasure", 4) > rate("treasure", 1) + 0.05 && rate("enemy", 4) > rate("enemy", 1) + 0.03); // likelier deeper
  const ids = new Set(D.SETS["moonlit-shrine"].map((p) => p.id));                      // the set
  const owned = new Set();                                                             // found so far
  const found = Array.from({ length: ids.size + 1 }, () => D._setPiece(where, "treasure", 1, Dice(), owned)); // a dice that always hits
  assert.deepEqual(new Set(found.slice(0, -1)), ids);                                  // each piece once
  assert.deepEqual(owned, ids);                                                        // all owned
  assert.equal(found.at(-1), null);                                                    // then none left
});

// ------------------------------------------------------------------ a trip
test("setting out needs the level, and one trip at a time", () => {
  const uid = player();                                                                // a player
  refused(() => tx(() => P.dungeonStart(uid, "rooftop-garden", T0)), /opens at level 35/); // too soon
  refused(() => tx(() => P.dungeonStart(uid, "the-moon", T0)), /isn't somewhere/);     // nowhere
  const run = start(uid);                                                              // off she goes
  assert.equal(run.depth, 1);                                                          // floor 1
  assert.equal(run.room.kind, "start");                                                // at the entrance
  assert.equal(run.hp, run.hpMax);                                                     // whole
  assert.ok(run.say);                                                                  // a line
  assert.deepEqual(run.satchel, { coins: 0, potions: 0, keys: 0, trophies: [], mods: [] }); // empty satchel
  refused(() => tx(() => P.dungeonStart(uid, "crystal-cavern", T0)), /already out exploring/); // one at a time
  refused(() => tx(() => P.fightStart(uid, "common", T0)), /out exploring/);           // no side fights
  const later = tx(() => P.snapshot(uid, save.load(uid, { now: T0 + 40 * 24 * 3_600_000 }), T0)); // weeks later
  assert.equal(later.dungeon.run.id, run.id);                                          // still waiting
});

test("the page only ever learns rooms she has stood in", () => {
  const uid = player();                                                                // a player
  const shown = start(uid);                                                            // set out
  const full = runOf(uid);                                                             // the whole floor
  assert.ok(Object.keys(full.rooms).length >= 11);                                     // a dozen rooms
  const known = Object.keys(shown.rooms).filter((k) => shown.rooms[k].kind !== "unknown"); // rooms shown
  assert.deepEqual(known, [full.at]);                                                  // only here
  assert.deepEqual(new Set(Object.keys(shown.rooms).filter((k) => shown.rooms[k].kind === "unknown")), new Set(full.rooms[full.at].exits.map((w) => D._step(full.at, w)))); // blanks next door
  const text = JSON.stringify(shown).replace('"scenario":"enemy"', "");                // what the page got
  for (const secret of ["enemy", "loot", "code", "prize", "deck", "level"]) assert.ok(!text.includes(`"${secret}"`), secret); // nothing hidden leaks
  put(uid, clearRun(full));                                                            // nothing in the way
  const way = full.rooms[full.at].exits[0];                                            // a door
  const after = act(uid, "move", { way }).dungeon.run;                                 // through it
  assert.equal(Object.values(after.rooms).filter((r) => r.kind !== "unknown").length, 2); // two rooms known
  assert.equal(after.at, D._step(full.at, way));                                       // moved
});

test("walls are solid and treasure goes in the satchel once", () => {
  const uid = player();                                                                // a player
  start(uid, "moonlit-shrine", 3);                                                     // set out
  const run = clearRun(runOf(uid), ["treasure"]);                                      // keep chests
  const keepKey = Object.keys(run.rooms).find((k) => run.rooms[k].kind === "treasure"); // keep one
  for (const [k, room] of Object.entries(run.rooms)) if (room.kind === "treasure" && k !== keepKey) Object.assign(room, { kind: "empty", done: true }); // the other gone
  put(uid, run);                                                                       // stored
  const closed = ["n", "e", "s", "w"].find((w) => !run.rooms[run.at].exits.includes(w)); // a wall
  if (closed) refused(() => act(uid, "move", { way: closed }), /no way through/);      // solid
  const path = pathTo(run, "treasure");                                                // the way to it
  let seen = null;                                                                     // the last answer
  for (const way of path) seen = act(uid, "move", { way }).dungeon.run;                // walk there
  const loot = run.rooms[seen.at].loot;                                                // what's inside
  assert.equal(seen.satchel.coins, 0);                                                 // not taken yet
  assert.equal(seen.event.scenario, "see_treasure");                                   // it waits
  assert.equal(seen.say, "There is a chest here, shut tight and waiting.");            // the fact
  assert.ok(!JSON.stringify(seen).includes('"loot"'));                                 // never shown
  const out = act(uid, "take").dungeon.run;                                            // open it
  assert.equal(out.satchel.coins, loot.coins);                                         // native coins in the satchel
  assert.equal(out.event.scenario, "treasure");                                        // the moment
  assert.ok(out.say.includes(`${payout(loot.coins)} SGC`));                            // told in SGC
  assert.ok(out.room.done);                                                            // emptied
  refused(() => act(uid, "take"), /nothing here to pick up/);                          // only once
  act(uid, "move", { way: D.BACK[path.at(-1)] });                                      // out
  const again = act(uid, "move", { way: path.at(-1) }).dungeon.run;                    // back in
  assert.equal(again.satchel.coins, loot.coins);                                       // not twice
  assert.equal(again.event.scenario, "again");                                         // been here
  assert.equal(coins(uid), 1000);                                                      // nothing hers until home
});

test("walking home banks the satchel once, in SGC, by the run's id", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const run = clearRun(runOf(uid));                                                    // nothing in the way
  const trophy = D.TROPHIES[run.env][0].id;                                            // a trophy
  const mod = D._FOUND_MODS[0].id;                                                     // a dungeon mod
  run.satchel = { coins: 120, potions: 3, keys: 1, trophies: [trophy], mods: [mod] };  // a full satchel
  put(uid, run);                                                                       // stored
  setPet(uid, { potions: 9 });                                                         // room for one
  const way = run.rooms[run.at].exits[0];                                              // a door
  act(uid, "move", { way });                                                           // away from the entrance
  refused(() => act(uid, "leave"), /back where Lumi came in/);                         // not here
  act(uid, "move", { way: D.BACK[way] });                                              // back
  const out = act(uid, "leave");                                                       // home
  const ended = out.dungeon.run;                                                       // the run
  assert.equal(ended.over, "home");                                                    // home
  assert.deepEqual(ended.ended, { coins: payout(120), potions: 1, trophies: [trophy], mods: [mod], depth: 1, at: T0 }); // SGC paid, dated
  assert.equal(out.coins, 1000 + payout(120));                                         // paid
  assert.equal(out.pet.potions, 10);                                                   // one fitted
  assert.ok(out.pet.decor.includes(trophy) && out.pet.mods_owned.includes(mod));       // hers now
  const ref = env.eco.getEconomyDb().prepare("SELECT amount FROM lumi_coin_refs WHERE ref = ?").get(`lumi-run:${uid}:${ended.id}`); // pay-once ref
  assert.equal(ref.amount, payout(120));                                               // by the run's id
  const ledger = env.eco.getEconomyDb().prepare("SELECT from_user_id FROM transactions WHERE type = 'lumi_dungeon_win' AND to_user_id = ?").get(uid); // the ledger
  assert.equal(ledger.from_user_id, BANK);                                             // from Lumi-Town Bank
  refused(() => act(uid, "leave"), /isn't out exploring/);                             // over
  assert.equal(start(uid, "crystal-cavern").depth, 1);                                 // a finished trip makes way
});

test("a closed bank owes the satchel and the story says so", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const run = runOf(uid);                                                              // the run
  run.satchel.coins = 100;                                                             // something to bank
  put(uid, run);                                                                       // stored
  env.tuning.set("lumi.treasury.payoutsPaused", "true", "test");                       // admin pause
  try {
    const ended = act(uid, "leave").dungeon.run;                                       // home
    assert.equal(ended.ended.coins, 0);                                                // nothing yet
    assert.equal(ended.ended.owed, payout(100));                                       // owed
    assert.match(ended.say, /Lumi-Town Bank is closed for a moment, your prize is saved\./); // told
    assert.equal(coins(uid), 1000);                                                    // unchanged
  } finally {
    env.tuning.set("lumi.treasury.payoutsPaused", "false", "test");                    // reopen
  }
});

test("a key lies where it is until she picks it up", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const run = clearRun(runOf(uid));                                                    // nothing in the way
  const spot = Object.keys(run.rooms).find((k) => run.rooms[k].kind === "empty" && k !== run.at); // an empty room
  Object.assign(run.rooms[spot], { kind: "key", done: false, loot: { keys: 1 } });     // a key there
  put(uid, run);                                                                       // stored
  const path = pathTo(run, "key");                                                     // the way
  let seen = null;                                                                     // the last answer
  for (const way of path) seen = act(uid, "move", { way }).dungeon.run;                // walk there
  assert.equal(seen.event.scenario, "see_key");                                        // it glints
  assert.equal(seen.satchel.keys, 0);                                                  // not taken
  act(uid, "move", { way: D.BACK[path.at(-1)] });                                      // walk off
  const back = act(uid, "move", { way: path.at(-1) }).dungeon.run;                     // come back
  assert.equal(back.event.scenario, "see_key");                                        // still lying there
  const taken = act(uid, "take").dungeon.run;                                          // pick it up
  assert.equal(taken.satchel.keys, 1);                                                 // in the satchel
  refused(() => act(uid, "take"), /nothing here to pick up/);                          // once
});

test("giving up leaves everything behind", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  refused(() => act(uid, "take"), /nothing here to pick up/);                          // an empty entrance
  const run = runOf(uid);                                                              // the run
  run.satchel.coins = 80;                                                              // something found
  put(uid, run);                                                                       // stored
  const ended = act(uid, "abandon").dungeon.run;                                       // give up
  assert.equal(ended.over, "abandoned");                                               // over
  assert.equal(ended.ended.lost.coins, 80);                                            // left behind
  assert.equal(ended.satchel.coins, 0);                                                // empty
  assert.equal(ended.ended.at, T0);                                                    // dated
  assert.equal(coins(uid), 1000);                                                      // nothing paid
});

test("stairs go down, keep the satchel and drop the keys", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const run = clearRun(runOf(uid));                                                    // nothing in the way
  Object.assign(run.satchel, { coins: 55, keys: 1 });                                  // a satchel
  put(uid, run);                                                                       // stored
  refused(() => act(uid, "descend"), /no stairs here/);                                // not here
  let out = null;                                                                      // the last answer
  for (const way of pathTo(run, "stairs")) out = act(uid, "move", { way }).dungeon.run; // walk there
  assert.equal(out.room.kind, "stairs");                                               // the stairs
  assert.equal(out.event.scenario, "stairs");                                          // the moment
  const down = act(uid, "descend").dungeon.run;                                        // down
  assert.equal(down.depth, 2);                                                         // floor 2
  assert.equal(down.room.kind, "start");                                               // its entrance
  assert.equal(down.satchel.coins, 55);                                                // kept
  assert.equal(down.satchel.keys, 0);                                                  // keys fit one floor
  assert.equal(Object.values(down.rooms).filter((r) => r.kind !== "unknown").length, 1); // a new floor
});

// ------------------------------------------------------------------ fights in the dungeon
test("a dungeon fight carries her health in and out and fills the satchel (native coins)", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  setPet(uid, { level: 40, skills: B.CATALOG.trees[0].nodes.map((n) => n.id), moves: ["comet-cleave"] }); // a trained fighter
  onlyOneEnemy(uid, 300);                                                              // one creature, 300 HP
  const out = walkIntoEnemy(uid);                                                      // meet it
  let fight = out.fight;                                                               // the fight
  const run = out.dungeon.run;                                                         // the run
  assert.equal(fight.status, "active");                                                // under way
  assert.equal(fight.player.hp, 300);                                                  // her bruises came in
  assert.ok(fight.player.hp < fight.player.hpMax);                                     // not whole
  assert.equal(fight.dungeon, true);                                                   // a dungeon fight
  assert.ok(run.fighting);                                                             // the run knows
  assert.equal(run.event.scenario, "enemy");                                           // the moment
  assert.ok(run.say.includes(fight.enemy.name));                                       // told
  refused(() => act(uid, "abandon"), /middle of a fight/);                             // not mid-fight
  while (fight.status === "active") fight = fightOn(uid, fight, "move0", 0.01).fight;  // win it
  assert.equal(fight.status, "victory");                                               // won
  assert.equal(fight.reward.sgc, payout(fight.reward.coins));                          // shown as what it banks as
  const state = tx(() => P.snapshot(uid, save.load(uid, { now: T0 }), T0));            // the page
  const after = state.dungeon.run;                                                     // the run
  assert.equal(after.satchel.coins, fight.reward.coins);                               // in the satchel
  assert.ok(after.satchel.coins > 0);                                                  // something
  assert.equal(state.coins, 1000);                                                     // not the purse
  assert.ok(after.hp === fight.player.hp && after.hp <= 300);                          // her health carries out
  assert.ok(!after.fighting && after.room.done && after.event.scenario === "victory"); // cleared
  assert.ok(state.pet.exp > 0 || state.pet.level > 40);                                // EXP is hers at once
});

test("a beaten creature can drop a piece of the place's set", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  setPet(uid, { level: 40, skills: B.CATALOG.trees[0].nodes.map((n) => n.id), moves: ["comet-cleave"] }); // strong
  onlyOneEnemy(uid, 300);                                                              // one creature
  const piece = D.SETS["moonlit-shrine"][0];                                           // a set piece
  const run = runOf(uid);                                                              // the run
  for (const room of Object.values(run.rooms)) if (room.kind === "enemy") room.loot = { trophy: piece.id }; // it carries one
  put(uid, run);                                                                       // stored
  let fight = walkIntoEnemy(uid).fight;                                                // meet it
  while (fight.status === "active") fight = fightOn(uid, fight, "move0", 0.01).fight;  // win
  const after = runOf(uid);                                                            // the run
  assert.deepEqual(after.satchel.trophies, [piece.id]);                                // in the satchel
  assert.equal(after.event.dropped, piece.id);                                         // the moment
  assert.ok(after.say.includes(piece.name));                                           // told
  assert.ok(!("loot" in after.rooms[after.at]));                                       // gone from the room
});

test("being beaten ends the trip, empties the satchel, keeps her EXP", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  onlyOneEnemy(uid, 1);                                                                // one creature; 1 HP
  const run = runOf(uid);                                                              // the run
  Object.assign(run.satchel, { coins: 200, trophies: ["trophy-moon-bell"] });          // a full satchel
  put(uid, run);                                                                       // stored
  setPet(uid, { exp: 7 });                                                             // some EXP
  let fight = walkIntoEnemy(uid).fight;                                                // meet it
  let out = null;                                                                      // the last answer
  while (fight.status === "active") { out = fightOn(uid, fight, "defend", 0.01); fight = out.fight; } // lose
  const after = out.dungeon.run;                                                       // the run
  assert.equal(fight.status, "defeat");                                                // beaten
  assert.equal(after.over, "defeat");                                                  // over
  assert.equal(after.ended.lost.coins, 200);                                           // left behind
  assert.equal(after.ended.at, T0);                                                    // dated
  assert.deepEqual(after.satchel, { coins: 0, potions: 0, keys: 0, trophies: [], mods: [] }); // emptied
  assert.equal(out.coins, 1000);                                                       // nothing paid
  assert.ok(!out.pet.decor.includes("trophy-moon-bell"));                              // not hers
  assert.equal(out.pet.exp, 7);                                                        // EXP kept
  assert.equal(out.pet.faint_until, T0 + B.FAINT_MS);                                  // a nap
  assert.equal(out.pet.wound, 1);                                                      // no health at all
  refused(() => tx(() => P.dungeonStart(uid, "moonlit-shrine", T0 + 1000)), /still napping/); // asleep
});

test("running from a fight steps back and the enemy stays", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  onlyOneEnemy(uid);                                                                   // one creature
  const out = walkIntoEnemy(uid);                                                      // meet it
  const lair = out.dungeon.run.at;                                                     // its room
  const fight = fightOn(uid, out.fight, "run", 0.1).fight;                             // run
  const run = runOf(uid);                                                              // the run
  assert.equal(fight.status, "ran");                                                   // away
  assert.ok(run.at !== lair && run.prev === lair);                                     // stepped back
  assert.ok(!run.rooms[lair].done);                                                    // it's still there
  assert.equal(run.event.scenario, "fled");                                            // the moment
  assert.equal(run.over, null);                                                        // still exploring
});

test("a potion between fights uses a found one first, then hers, only when it helps", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  refused(() => act(uid, "potion"), /full health/);                                    // no need
  let run = runOf(uid);                                                                // the run
  run.hp = 5;                                                                          // hurt
  put(uid, run);                                                                       // stored
  refused(() => act(uid, "potion"), /no potions/);                                     // none
  setPet(uid, { potions: 1 });                                                         // one of hers
  run = runOf(uid);                                                                    // the run
  run.satchel.potions = 1;                                                             // one found
  put(uid, run);                                                                       // stored
  assert.equal(tx(() => P.snapshot(uid, save.load(uid, { now: T0 }), T0)).potions_ready, 2); // both count
  const first = act(uid, "potion");                                                    // drink
  assert.equal(first.dungeon.run.satchel.potions, 0);                                  // the found one went first
  assert.equal(first.pet.potions, 1);                                                  // hers kept
  assert.equal(first.dungeon.run.hp, 5 + Math.floor(first.dungeon.run.hpMax / 2));     // half back
  run = runOf(uid);                                                                    // the run
  run.hp = 5;                                                                          // hurt again
  put(uid, run);                                                                       // stored
  const second = act(uid, "potion");                                                   // drink hers
  assert.equal(second.pet.potions, 0);                                                 // gone
  assert.equal(second.potions_ready, 0);                                               // none left
});

test("a found potion can be drunk in a dungeon fight, and a refusal changes nothing", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  onlyOneEnemy(uid, 20);                                                               // one creature; 20 HP
  const run = runOf(uid);                                                              // the run
  run.satchel.potions = 1;                                                             // one found
  put(uid, run);                                                                       // stored
  const fight = walkIntoEnemy(uid).fight;                                              // meet it
  const out = fightOn(uid, fight, "potion", 0.999);                                    // drink (the reply misses)
  assert.equal(out.fight.player.hp, 20 + Math.floor(out.fight.player.hpMax / 2));      // half back
  assert.equal(out.pet.potions, 0);                                                    // hers untouched (she had none)
  assert.equal(out.dungeon.run.satchel.potions, 0);                                    // the found one used
  refused(() => fightOn(uid, out.fight, "potion", 0.999), /No potions left/);          // none left
  assert.equal(runOf(uid).satchel.potions, 0);                                         // unchanged
  assert.equal(runOf(uid).fight, fight.id);                                            // still fighting
});

// ------------------------------------------------------------------ locks
function faceVault(uid, lock) {                                                        // erinne _face_vault
  const run = clearRun(runOf(uid));                                                    // nothing in the way
  const vault = Object.keys(run.rooms).find((k) => run.rooms[k].kind === "vault");     // the vault
  run.rooms[vault].lock = lock;                                                        // this lock
  run.rooms[vault].loot = { coins: 90, potions: 1, trophy: D.TROPHIES[run.env][0].id }; // this prize
  put(uid, run);                                                                       // stored
  let out = null;                                                                      // the last answer
  for (const way of pathTo(run, "vault")) out = act(uid, "move", { way }).dungeon.run; // walk up to it
  assert.ok(out.at !== vault && out.facing.at === vault);                              // she stops at the door
  return [out, vault];                                                                 // the view + where
}

test("a key door wants a key from this floor", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const [shown, vault] = faceVault(uid, { kind: "key" });                              // a key door
  assert.deepEqual(shown.facing.lock, { kind: "key" });                                // shown
  assert.equal(shown.event.scenario, "locked_key");                                    // the moment
  refused(() => act(uid, "unlock"), /needs a key/);                                    // no key
  assert.equal(act(uid, "back").dungeon.run.facing, null);                             // step back
  const run = runOf(uid);                                                              // the run
  run.satchel.keys = 1;                                                                // a key
  run.facing = vault;                                                                  // at the door
  put(uid, run);                                                                       // stored
  const inside = act(uid, "unlock").dungeon.run;                                       // open
  assert.equal(inside.at, vault);                                                      // inside
  assert.equal(inside.satchel.keys, 0);                                                // used
  assert.equal(inside.event.scenario, "see_vault");                                    // the chest waits
  const opened = act(uid, "take").dungeon.run;                                         // open the chest
  assert.equal(opened.satchel.coins, 90);                                              // native coins
  assert.deepEqual(opened.satchel.trophies, [D.TROPHIES[opened.env.id][0].id]);        // the trophy
  assert.equal(opened.event.scenario, "vault");                                        // the moment
  assert.ok(opened.say.includes(D.TROPHIES[opened.env.id][0].name));                   // told
  refused(() => act(uid, "unlock"), /no locked door/);                                 // done
});

test("a Sokoban door shows its level and opens only to a real answer, replayed on the server", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const level = D.SOKOBAN[3];                                                          // a level
  const [shown, vault] = faceVault(uid, { kind: "sokoban", level: level.id });         // a crate door
  assert.deepEqual(shown.facing.lock, { kind: "sokoban", rows: level.rows });          // the puzzle, not the answer
  const answer = solveSokoban(level.rows);                                             // a real answer
  for (const wrong of ["", answer.slice(0, -1), answer + "u".repeat(700)]) refused(() => act(uid, "sokoban", { moves: wrong }), /crates aren't all in place/); // refused
  refused(() => act(uid, "lights", { picks: [0] }), /isn't how this door opens/);      // the wrong puzzle
  assert.equal(act(uid, "sokoban", { moves: answer }).dungeon.run.at, vault);          // open
});

test("a lights door opens when every lamp is out", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const board = new Array(9).fill(false);                                              // dark
  for (const cell of [0, 4]) D.lightsPress(board, 3, cell);                            // two presses
  const [shown, vault] = faceVault(uid, { kind: "lights", size: 3, board });           // a lamp door
  assert.deepEqual(shown.facing.lock, { kind: "lights", size: 3, board });             // shown
  refused(() => act(uid, "lights", { picks: [0] }), /still lit/);                      // not yet
  assert.equal(act(uid, "lights", { picks: [4, 0] }).dungeon.run.at, vault);           // open
});

test("a rune door answers each guess, never shows its code, and resets when tries run out", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const code = ["sun", "moon", "star", "sun"];                                         // the code
  const [shown, vault] = faceVault(uid, { kind: "runes", code, tries: [] });           // a rune door
  assert.deepEqual(shown.facing.lock, { kind: "runes", runes: [...D.RUNES], slots: 4, tries: [], left: 8 }); // no code
  assert.ok(!JSON.stringify(shown).includes('"code"'));                                // never sent
  const first = act(uid, "rune", { picks: ["sun", "sun", "moon", "leaf"] }).dungeon.run; // a guess
  assert.deepEqual(first.facing.lock.tries, [{ guess: ["sun", "sun", "moon", "leaf"], exact: 1, near: 2, marks: ["right", "near", "near", "miss"] }]); // marked
  assert.equal(first.facing.lock.left, 7);                                             // one try used
  assert.equal(first.say, "1 in the right place (lit green), 2 right but in the wrong place (ringed gold)."); // the fact
  assert.deepEqual(D.runeMarks(["sun", "sun", "sun", "moon"], ["moon", "sun", "leaf", "leaf"]), ["miss", "right", "miss", "near"]); // one sun, one light
  for (const bad of [["sun"], ["sun", "moon", "star", "gear"], [0, 1, 2, 3]]) refused(() => act(uid, "rune", { picks: bad }), /Choose 4 runes/); // bad guesses
  let last = null;                                                                     // the last answer
  for (let i = 0; i < 7; i += 1) last = act(uid, "rune", { picks: ["leaf", "leaf", "leaf", "leaf"], rng: Dice([], { pick: 4 }) }).dungeon.run; // out of tries
  assert.deepEqual(last.facing.lock.tries, []);                                        // a new code
  assert.equal(last.event.scenario, "runes_reset");                                    // the moment (all "wave" now)
  assert.equal(act(uid, "rune", { picks: ["wave", "wave", "wave", "wave"] }).dungeon.run.at, vault); // open
});

// ------------------------------------------------------------------ games
function intoGame(uid, game) {                                                         // erinne _into_game
  const run = clearRun(runOf(uid));                                                    // nothing in the way
  Object.values(run.rooms).find((r) => r.kind === "game").game = game;                 // this game
  put(uid, run);                                                                       // stored
  let out = null;                                                                      // the last answer
  for (const way of pathTo(run, "game")) out = act(uid, "move", { way }).dungeon.run;  // walk there
  return out;                                                                          // the view
}

test("the cup game is luck the server already decided", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const shown = intoGame(uid, { kind: "cups", prize: 2 });                             // the cups
  assert.deepEqual(shown.game, { kind: "cups", cups: 3 });                             // no prize shown
  assert.equal(shown.event.scenario, "game_cups");                                     // the moment
  refused(() => act(uid, "cup", { picks: [3] }), /Choose a cup/);                      // no fourth cup
  const won = act(uid, "cup", { picks: [2] }).dungeon.run;                             // the right one
  assert.equal(won.event.scenario, "game_win");                                        // won
  assert.ok(won.satchel.coins === won.event.coins && won.satchel.coins > 0);           // into the satchel
  assert.ok(won.room.done);                                                            // played
  assert.ok(won.say.includes(`${payout(won.event.coins)} SGC`));                       // told in SGC
  refused(() => act(uid, "cup", { picks: [2] }), /no game like that/);                 // once
  env.eco.getEconomyDb().prepare("DELETE FROM lumi_runs WHERE user_id = ?").run(uid);  // a new trip
  start(uid);                                                                          // set out
  intoGame(uid, { kind: "cups", prize: 2 });                                           // the cups again
  const lost = act(uid, "cup", { picks: [0] }).dungeon.run;                            // the wrong one
  assert.equal(lost.event.scenario, "game_lose");                                      // lost
  assert.ok(lost.satchel.coins > 0 && lost.satchel.coins < won.satchel.coins);         // a little for trying
  assert.equal(lost.event.prize, 2);                                                   // where it was
});

test("the matching game shows a card only once it is turned, and ends when turns run out", () => {
  const uid = player();                                                                // a player
  start(uid);                                                                          // set out
  const deck = ["sun", "moon", "sun", "star", "moon", "leaf", "star", "leaf"];         // the deck
  const shown = intoGame(uid, { kind: "match", deck, found: [], open: null, flips: 0, last: null }); // the cards
  assert.deepEqual(shown.game.cards, new Array(8).fill(null));                         // all face down
  assert.equal(shown.game.left, D.FLIPS);                                              // turns left
  const one = act(uid, "flip", { picks: [0] }).dungeon.run.game;                       // turn one
  assert.deepEqual(one.cards, ["sun", ...new Array(7).fill(null)]);                    // only it
  assert.equal(one.open, 0);                                                           // open
  refused(() => act(uid, "flip", { picks: [0] }), /face down/);                        // already up
  const miss = act(uid, "flip", { picks: [1] }).dungeon.run;                           // a miss
  assert.deepEqual(miss.game.cards.slice(0, 2), ["sun", "moon"]);                      // shown once
  assert.equal(miss.event.scenario, "match_miss");                                     // the moment
  assert.equal(act(uid, "flip", { picks: [0] }).dungeon.run.game.cards[1], null);      // turned back
  const pair = act(uid, "flip", { picks: [2] }).dungeon.run;                           // a pair
  assert.deepEqual(pair.game.found, [0, 2]);                                           // found
  let done = null;                                                                     // the end
  for (const [a, b] of [[1, 4], [3, 6], [5, 7]]) { act(uid, "flip", { picks: [a] }); done = act(uid, "flip", { picks: [b] }).dungeon.run; } // the rest
  assert.deepEqual(done.event, { scenario: "game_win", coins: done.satchel.coins, pairs: 4 }); // all four
  assert.ok(done.room.done);                                                           // played
  const other = player();                                                              // another player
  start(other);                                                                        // set out
  intoGame(other, { kind: "match", deck, found: [], open: null, flips: 0, last: null }); // the cards
  let out = null;                                                                      // the last answer
  for (let i = 0; i < D.FLIPS / 2; i += 1) { act(other, "flip", { picks: [0] }); out = act(other, "flip", { picks: [1] }).dungeon.run; } // never a pair
  assert.equal(out.event.scenario, "game_lose");                                       // out of turns
  assert.equal(out.event.pairs, 0);                                                    // none found
  assert.ok(out.room.done && out.satchel.coins > 0);                                   // a little for trying
});

test("looking around tells more of the room and the story is kept", () => {
  const uid = player();                                                                // a player
  const shown = start(uid);                                                            // set out
  const looks = T.LIBRARY["moonlit-shrine"].look;                                      // the shrine's details
  assert.ok(looks.includes(shown.scene));                                              // what the room is like
  assert.deepEqual(shown.story, [shown.say]);                                          // the tale so far
  const first = act(uid, "look").dungeon.run;                                          // look
  const second = act(uid, "look").dungeon.run;                                         // look again
  assert.deepEqual(first.event, { scenario: "look", n: 1 });                           // the moment
  assert.equal(first.scene, shown.scene);                                              // the room is still itself
  assert.equal(new Set([shown.scene, first.say, second.say]).size, 3);                 // each look a new detail
  assert.ok(looks.includes(first.say) && looks.includes(second.say));                  // from the library
  assert.deepEqual(second.story, [shown.say, first.say, second.say]);                  // the story grows
  let last = null;                                                                     // the last answer
  for (let i = 0; i < 20; i += 1) last = act(uid, "look").dungeon.run;                 // look a lot
  assert.equal(last.story.length, D.LOG);                                              // only the last few kept
  assert.equal(last.story.at(-1), last.say);                                           // newest last
});

test("health: bruises come home, a defeat leaves none, and a paid wake heals it all", () => {
  const uid = player();                                                                // a player
  const full = B.stats(makePet()).hp;                                                  // her whole bar
  start(uid);                                                                          // set out
  let run = runOf(uid);                                                                // the run
  run.hp = 10;                                                                         // hurt
  put(uid, run);                                                                       // stored
  assert.equal(act(uid, "abandon").health.hp, 10);                                     // came home hurt
  setPet(uid, { wound: 0 });                                                           // whole again
  start(uid);                                                                          // set out
  onlyOneEnemy(uid, 1);                                                                // one creature; 1 HP
  let fight = walkIntoEnemy(uid).fight;                                                // meet it
  let out = null;                                                                      // the last answer
  while (fight.status === "active") { out = fightOn(uid, fight, "defend", 0.01); fight = out.fight; } // lose
  assert.equal(out.pet.wound, 1);                                                      // no health
  assert.deepEqual(out.health, { hp: 1, max: full, mends_in: B.FAINT_MS, out: false }); // mends in a nap's time
  const woke = tx(() => { const pet = save.load(uid, { now: T0 }); B.progress(uid, pet, "heal", null, null, 0, T0); save.save(uid, pet); return B.health(pet); }); // the paid wake
  assert.equal(woke, full);                                                            // whole
});
