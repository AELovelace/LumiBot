// Lumi Party's co-op fight (src/lumi/party/lumiparty.js on top of src/lumi/dungeon/lumibattle.js team_*), ported from
// erinne tests/test_lumiparty.py: one fight for the whole party, taken in turns, items for friends, ghosts, defeat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { P, B, db, save, T0, S, TRIO, act, state, put, party, walk, Dice } from "./party_harness.mjs";

const [doll, jane, mina] = TRIO;                                        // the three players
const KO = { name: "Crush", power: 250, accuracy: 1000, magic: false, element: "none", effect: null, hits: 1, mp: 0 }; // a knock-out
const TAP = { name: "Tap", power: 1, accuracy: 1000, magic: false, element: "none", effect: null, hits: 1, mp: 0 };    // a tickle

function intoCreature(code) {                                           // erinne _into_creature
  walk(code, "e");                                                      // hall
  walk(code, "s");                                                      // game room
  act(code, doll, "move", { way: "e" });                                // one vote...
  const seen = act(code, jane, "move", { way: "e" });                   // ...into the creature's room (jane looking)
  assert.equal(seen.run.at, "2,1");                                     // there
  assert.ok(seen.run.party.fighting);                                   // fighting
  const fight = seen.run.party.fight;                                   // the co-op fight
  assert.deepEqual(fight.lumis.map((l) => l.user), TRIO);               // every Lumi, seat order
  assert.ok(fight.foes.length >= 1 && fight.foes.length <= 3);          // one to three creatures
  assert.deepEqual([fight.round, fight.at, fight.turn], [1, 0, 0]);     // round one, doll first
  assert.equal(fight.you, 1);                                           // jane is seat 1
  assert.ok(!state(code).members.some((m) => m.fight));                 // no old-style fights
  assert.ok(TRIO.every((uid) => B.current(uid) === null));              // no fight rows
  return seen;                                                          // the view
}

function rig(code, { foes = 1, foeHp = 500, move = TAP, lumis = {} } = {}) { // erinne _rig: a predictable fight
  const st = state(code);                                               // saved
  const fight = st.run.fight;                                           // the fight
  const first = fight.foes[0];                                          // a template creature
  fight.foes = Array.from({ length: foes }, (_, i) => ({ ...first, name: first.name + (foes > 1 ? " " + "ABC"[i] : ""), hp: foeHp, hpMax: foeHp, moves: [{ ...move }], dodge: 0, thorns: 0 })); // rigged creatures
  for (const [seat, numbers] of Object.entries(lumis)) Object.assign(fight.lumis[Number(seat)], numbers); // rigged Lumis
  put(st);                                                              // save
}

function turn(code, uid, target, opts = {}) {                           // erinne _turn
  const t = "turn" in opts ? opts.turn : state(code).run.fight.turn;    // the turn the page shows
  return act(code, uid, "fight", { rng: Dice([], { chance: 0.0 }), target, ...opts, turn: t }); // her turn
}

test("a party fight is one fight taken in turns, round robin", () => {
  const code = party();                                                 // three, set out
  intoCreature(code);                                                   // the fight starts
  rig(code, { foes: 2 });                                               // two creatures
  assert.throws(() => act(code, doll, "move", { way: "e" }), /still fighting/); // no voting now
  assert.throws(() => turn(code, jane, "move0"), /doll's Lumi|It's/);   // seat order
  assert.throws(() => turn(code, doll, "move0", { turn: 7 }), /already happened/); // a stale page
  let seen = turn(code, doll, "move0", { foe: 1 });                     // doll aims at the second
  let fight = seen.run.party.fight;                                     // after
  assert.ok(fight.foes[1].hp < 500);                                    // hit
  assert.equal(fight.foes[0].hp, 500);                                  // untouched
  assert.deepEqual([fight.at, fight.turn], [1, 1]);                     // jane's turn
  const hp = fight.lumis.map((l) => l.hp);                              // health now
  turn(code, jane, "defend");                                           // jane braces
  seen = turn(code, mina, "move0");                                     // the last Lumi: then the creatures
  fight = seen.run.party.fight;                                         // after
  assert.equal(fight.round, 2);                                         // round two
  assert.equal(fight.at, 0);                                            // doll again
  assert.ok(fight.lumis.reduce((s, l) => s + l.hp, 0) < hp.reduce((s, h) => s + h, 0)); // they were hit
  assert.ok(fight.log.some((line) => line.includes("Tap")));            // the log says so
  assert.equal(fight.ends, T0 + P.TURN_SECONDS * S);                    // the turn clock
  const st = state(code);                                               // a creature goes down
  st.run.fight.foes[0].hp = 0;                                          // ...
  put(st);                                                              // ...
  assert.throws(() => turn(code, doll, "move0", { foe: 0 }), /already down/); // can't aim at it
});

test("a win gives every Lumi the whole EXP and her own coins", () => {
  const code = party();                                                 // three, set out
  intoCreature(code);                                                   // the fight
  rig(code, { foes: 2, foeHp: 1 });                                     // two weak creatures
  const fight = state(code).run.fight;                                  // saved
  const whole = B.teamReward(fight)[0];                                 // the whole EXP
  assert.equal(whole, fight.foes.reduce((s, f) => s + 15 + f.level * 3 + B.TIERS[f.tier][3], 0)); // erinne's formula
  const exp = Object.fromEntries(TRIO.map((u) => [u, save.peek(u).exp])); // EXP before
  turn(code, doll, "move0", { foe: 0 });                                // one down
  const seen = turn(code, jane, "move0", { foe: 1 });                   // both down: won
  const st = state(code);                                               // saved
  assert.equal(st.run.fight, null);                                     // over
  assert.ok(st.run.rooms["2,1"].done);                                  // cleared
  assert.equal(seen.run.party.fighting, false);                         // voting again
  assert.equal(seen.run.party.last_fight.outcome, "victory");           // won
  assert.equal(seen.run.party.last_fight.exp, whole);                   // the whole EXP
  for (const uid of TRIO) {
    const pet = save.peek(uid);                                         // after
    let total = pet.exp;                                                // EXP now...
    for (let lv = 1; lv < pet.level; lv++) total += B.levelThreshold(lv); // ...plus levels gained
    assert.equal(total, exp[uid] + whole);                              // every Lumi, even mina, got it all
  }
  assert.deepEqual(st.members.map((m) => m.satchel.coins), [Math.floor(whole * 0.6), Math.floor(whole * 0.6), Math.floor(whole * 0.6)]); // native coins each
});

test("a friend heals another with her own potion, or lifts her with an X item", () => {
  const code = party();                                                 // three, set out
  db.tx(() => { const pet = save.load(doll, { now: T0 }); pet.potions = 2; pet.kit = { "x-attack": 1, ether: 1 }; save.save(doll, pet); }); // doll's pocket
  intoCreature(code);                                                   // the fight
  rig(code, { lumis: { 1: { hp: 5, mp: 0 } } });                        // jane is hurt
  assert.throws(() => turn(code, doll, "potion", { ally: 2 }), /already at full health/); // mina is fine
  let seen = turn(code, doll, "potion", { ally: 1 });                   // doll's potion for jane
  const fight = seen.run.party.fight;                                   // after
  assert.ok(fight.lumis[1].hp > 5);                                     // mended
  assert.equal(fight.at, 1);                                            // jane's turn
  assert.match(fight.log.join(" "), /doll's Lumi gives jane's Lumi a potion/); // the log names both (two Lumis called Lumi)
  assert.equal(save.peek(doll).potions, 1);                             // from doll's own pocket
  assert.equal(save.peek(jane).potions, 0);                             // not jane's
  turn(code, jane, "defend");                                           // round...
  turn(code, mina, "defend");                                           // ...two
  seen = turn(code, doll, "x-attack", { ally: 2 });                     // mina's attack goes up
  assert.deepEqual(seen.run.party.fight.lumis[2].stages, { attack: 1 }); // a stage
  assert.throws(() => turn(code, jane, "x-attack", { ally: 1 }), /No X-Attack left|X-Attack/); // jane has none
  assert.equal(save.peek(doll).kit["x-attack"], 0);                     // doll's is used
});

test("a Lumi down at the end faints into a ghost but still gets her EXP", () => {
  const code = party();                                                 // three, set out
  intoCreature(code);                                                   // the fight
  rig(code, { foeHp: 1, lumis: { 1: { hp: 0 } } });                     // jane fell earlier
  const st = state(code);                                               // everyone has 5 coins
  for (const m of st.members) m.satchel.coins = 5;                      // ...
  put(st);                                                              // ...
  const before = save.peek(jane);                                       // jane before
  turn(code, doll, "move0");                                            // won
  const after = state(code);                                            // saved
  const [d, j, m] = after.members;                                      // the three
  assert.ok(j.fainted);                                                 // a ghost
  assert.equal(j.satchel.coins, 0);                                     // dropped everything
  assert.equal(j.hp, 0);                                                // no health
  assert.ok(!d.fainted && d.satchel.coins > 5);                         // doll got coins
  assert.equal(m.satchel.coins, d.satchel.coins);                       // mina the same
  const pet = save.peek(jane);                                          // jane after
  assert.notDeepEqual([pet.level, pet.exp], [before.level, before.exp]); // EXP all the same
  assert.equal(pet.wound, 1.0);                                         // home hurt
  const seen = act(code, jane, "move", { way: "e" });                   // a ghost still votes
  assert.deepEqual(seen.run.party.votes, { [jane]: "e" });              // her vote
  assert.throws(() => act(code, jane, "potion"), /ghost/);              // no potions for ghosts
});

test("if everyone faints, the trip is over", () => {
  const code = party();                                                 // three, set out
  intoCreature(code);                                                   // the fight
  rig(code, { foes: 3, move: KO, lumis: { 0: { hp: 1 }, 1: { hp: 1 }, 2: { hp: 1 } } }); // one creature each, one hit to go
  for (const uid of TRIO) turn(code, uid, "defend");                    // brace...
  const st = state(code);                                               // ...but they all fall
  assert.equal(st.phase, "lobby");                                      // back in the lobby
  assert.equal(st.last.how, "defeat");                                  // a defeat
  assert.equal(st.run, null);                                           // no trip
  assert.ok(st.members.every((m) => !m.ready));                         // not ready
});

test("a turn left too long is braced through, and running takes everyone back", () => {
  const code = party();                                                 // three, set out
  intoCreature(code);                                                   // the fight
  rig(code);                                                            // predictable
  const seen = db.tx(() => P.look(code, jane, T0 + P.TURN_SECONDS * S)); // doll's turn ran out
  const fight = seen.run.party.fight;                                   // after
  assert.equal(fight.at, 1);                                            // jane's turn
  assert.equal(fight.log.at(-1), "Time's up! doll's Lumi braces.");     // braced (two Lumis named Lumi: owner's name)
  act(code, jane, "fight", { now: T0 + P.TURN_SECONDS * S, rng: Dice([], { chance: 0.0 }), target: "run", turn: fight.turn }); // run!
  const st = state(code);                                               // saved
  assert.equal(st.run.fight, null);                                     // over
  assert.equal(st.run.at, "1,1");                                       // a step back
  assert.equal(st.run.event.scenario, "fled");                          // fled
});

test("leaving mid-fight takes her Lumi out and passes her turn on", () => {
  const code = party();                                                 // three, set out
  intoCreature(code);                                                   // the fight
  rig(code);                                                            // predictable
  act(code, doll, "abandon");                                           // doll goes home
  const fight = state(code).run.fight;                                  // saved
  assert.ok(fight.lumis[0].gone);                                       // her Lumi left
  assert.equal(fight.at, 1);                                            // jane's turn
  const seen = turn(code, jane, "defend");                              // jane goes
  assert.equal(seen.run.party.fight.at, 2);                             // mina's turn
});
