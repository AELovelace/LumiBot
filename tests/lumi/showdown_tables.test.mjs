// Solo arcade runs and showdown tables at spec level (src/lumi/arcade/{arcade,showdown,lobby}.js; erinne
// tests/test_arcade.py "solo runs" + "showdowns" and tests/test_lobby.py's Presence rules): entries and prizes in SGC,
// pay-once refs, seats, getting ready, bets (spend / exact refunds / stake + betwin), settling a race, seats let go
// when a page goes away, one table per game, and every seat carrying its racer's Lumi.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { eco, db, tuning } = boot();                                       // fresh in-memory economy + Lumi
const arcade = require("../../src/lumi/arcade/arcade.js");               // runs
const showdown = require("../../src/lumi/arcade/showdown.js");           // tables
const lobby = require("../../src/lumi/arcade/lobby.js");                 // PRESENCE
const ALICE = "100000000000000001";                                       // Discord-shaped ids
const BOB = "100000000000000002";                                         // racer two
const CAROL = "100000000000000003";                                       // a watcher
const ENTRY = 5;                                                          // 25 native x 0.2
let now = 1_800_000_000_000;                                              // the fake clock (ms)
const sql = () => eco.getEconomyDb();                                     // raw DB
const bal = (id) => eco.getBalance(id);                                   // SGC balance
const actor = (uid) => `user:${uid}`;                                     // erinne's actor for a signed-in browser
const tick = (seconds) => { now += seconds * 1000; };                     // move time on

beforeEach(() => {
  resetLumi(eco);                                                         // empty pool, no refs/caps/settings
  sql().exec("DELETE FROM lumi_arcade_rooms; DELETE FROM lumi_arcade_runs; DELETE FROM lumi_pets;"); // no tables or runs
  setBalance(eco, eco.LUMI_TOWN_BANK_USER_ID, 1_000_000);                 // the bank can pay
  for (const id of [ALICE, BOB, CAROL]) setBalance(eco, id, 1000);        // everyone starts with 1000 SGC
  db.setClock(() => now);                                                 // fake time (moves PRESENCE too)
  lobby.PRESENCE = new lobby.Presence();                                  // nobody heard from yet
});
after(() => db.setClock(null));                                           // the real clock back

// Finish a run the way the API does: check it, then hand a race's result to its table.
function claim(uid, game, run, c) {
  return db.tx(() => {                                                    // one transaction
    const result = arcade.finish(uid, `P${uid.slice(-1)}`, game, run, { turns: [], moves: 0, died: false, score: 0, level: 1, ...c }); // checked
    if (result.room) showdown.record(game, result.room, run, result);     // a race's result to its table
    return result;                                                        // what the server made of it
  });
}

// One thing at a Breakout table.
function act(code, uid, action, extra) {
  return showdown.act("breakout", code, actor(uid), `P${uid.slice(-1)}`, uid, action, extra); // erinne _act
}

// assert.throws for a LumiError with a given HTTP status.
function refusedWith(fn, status) {
  assert.throws(fn, (e) => e.name === "LumiError" && e.status === status); // erinne Refused(…, status)
}

// ------------------------------------------------------------------------------------------------ solo runs

test("a solo run costs its entry and pays its score once (in SGC)", () => {
  const run = db.tx(() => arcade.start(ALICE, "Alice", "breakout"));     // pay the entry
  assert.equal(run.charged, ENTRY);                                       // 5 SGC
  assert.equal(bal(ALICE), 1000 - ENTRY);                                 // charged
  const result = claim(ALICE, "breakout", run.run, { score: 10, level: 1 }); // 10 bricks
  assert.equal(result.paid, 2);                                           // 10 native x 0.2
  assert.equal(result.coins, 1000 - ENTRY + 2);                           // new balance returned
  assert.equal(bal(ALICE), 1000 - ENTRY + 2);                             // paid
  refusedWith(() => claim(ALICE, "breakout", run.run, { score: 10, level: 1 }), 404); // paid once
  const ref = sql().prepare("SELECT amount FROM lumi_coin_refs WHERE ref = ?").get(`breakout:${run.run}`); // the pay-once ref
  assert.equal(ref.amount, 2);                                            // recorded
});

test("a run needs its entry (402, nothing charged)", () => {
  setBalance(eco, BOB, 2);                                                // less than 5 SGC
  refusedWith(() => db.tx(() => arcade.start(BOB, "Bob", "snake")), 402); // can't afford it
  assert.equal(bal(BOB), 2);                                              // nothing moved
  refusedWith(() => db.tx(() => arcade.start(BOB, "Bob", "prism-drop")), 404); // not an arcade game
});

test("a client-reported Teacup Tower climb is capped by the daily limit and says so", () => {
  tuning.setGame("teacup-tower", "dailyCap", 3, "test");                  // a tiny cap
  const run = db.tx(() => arcade.start(ALICE, "Alice", "teacup-tower"));  // a climb
  tick(60);                                                               // a minute of climbing
  const result = claim(ALICE, "teacup-tower", run.run, { score: 100 });   // 100 floors -> 20 SGC uncapped
  assert.equal(result.paid, 3);                                           // trimmed to the cap
  assert.equal(result.capped, true);                                      // and flagged
  assert.match(result.note, /limit/);                                     // the player is told
});

test("a prize the bank can't pay is saved and the player is told", () => {
  tuning.set("lumi.treasury.payoutsPaused", "true", "test");              // payouts paused
  const run = db.tx(() => arcade.start(ALICE, "Alice", "breakout"));     // a run
  const result = claim(ALICE, "breakout", run.run, { score: 10, level: 1 }); // a prize
  assert.equal(result.paid, 0);                                           // nothing now
  assert.equal(result.owed, 2);                                           // saved
  assert.match(result.note, /saved/);                                     // the player is told
});

test("each player's Lumi look is read without changing her", () => {
  assert.deepEqual(arcade.lumiLook(ALICE).glow, "rose");                  // no Lumi yet: a fresh one's look
  const pet = { glow: "lagoon", outfit: { head: "acc-bow", neck: "acc-not-a-thing", paws: "acc-bow" } }; // one good, two bad
  sql().prepare("INSERT INTO lumi_pets (user_id, data) VALUES (?, ?)").run(ALICE, JSON.stringify(pet)); // her save
  const before = sql().prepare("SELECT data, updated_at FROM lumi_pets").get(); // as stored
  const look = arcade.lumiLook(ALICE);                                    // read it
  assert.equal(look.glow, "lagoon");                                      // her glow
  assert.deepEqual(look.outfit, { head: "acc-bow" });                     // only what still fits
  assert.deepEqual(sql().prepare("SELECT data, updated_at FROM lumi_pets").get(), before); // nothing written
});

// ------------------------------------------------------------------------------------------------ showdowns

// Alice and Bob at a Breakout table, Carol watching with chip 10 (2 SGC) on Bob; the race started.
function race() {
  const table = showdown.create("breakout", actor(ALICE), "Alice", ALICE); // Alice opens it
  assert.equal(table.role, "p1");                                         // she sits as P1
  assert.equal(table.name, "Alice's Yarn Pop table");                     // named for her
  assert.equal(act(table.code, BOB, "join").role, "p2");                  // Bob races
  assert.equal(act(table.code, CAROL, "join").role, "watch");             // Carol watches
  const after = act(table.code, CAROL, "bet", { target: "p2", amount: 10 }); // 10 native on Bob
  assert.equal(after.bets.p2, 2);                                         // 2 SGC riding
  assert.equal(bal(CAROL), 998);                                          // charged
  act(table.code, ALICE, "ready");                                        // Alice ready
  const racing = act(table.code, BOB, "ready");                           // Bob ready: off they go
  assert.equal(racing.phase, "racing");                                   // racing
  assert.ok(racing.race.run);                                             // Bob has a ticket
  assert.equal(bal(ALICE), 1000 - ENTRY);                                 // both paid the entry
  assert.equal(bal(BOB), 1000 - ENTRY);                                   // both paid the entry
  refusedWith(() => act(table.code, CAROL, "bet", { target: "p1", amount: 5 }), 409); // bets closed
  const runs = { p1: showdown.look("breakout", table.code, actor(ALICE)).race.run, p2: showdown.look("breakout", table.code, actor(BOB)).race.run }; // tickets
  assert.equal(showdown.look("breakout", table.code, actor(CAROL)).race.run, null); // watchers get none
  return { code: table.code, runs };                                      // for the test
}

test("a race pays both scores and the winner's bets (stake back + betwin)", () => {
  const { code, runs } = race();                                          // set up
  claim(ALICE, "breakout", runs.p1, { score: 4, level: 1 });              // Alice: 4
  assert.equal(showdown.look("breakout", code, actor(ALICE)).phase, "racing"); // waits for Bob
  claim(BOB, "breakout", runs.p2, { score: 9, level: 1 });                // Bob: 9
  const done = showdown.look("breakout", code, actor(BOB));               // Bob's view
  assert.equal(done.phase, "result");                                     // settled
  assert.equal(done.last.winner, "P2");                                   // Bob won
  assert.equal(done.role, "p1");                                          // the winner sits as P1
  assert.equal(bal(ALICE), 1000 - ENTRY + 0);                             // 4 native -> 0 SGC
  assert.equal(bal(BOB), 1000 - ENTRY + 1);                               // 9 native -> 1 SGC
  assert.equal(bal(CAROL), 1000 - 2 + 2 + 2);                             // stake back + 10 native x 0.2
  const carol = showdown.look("breakout", code, actor(CAROL));            // Carol's view
  assert.deepEqual(carol.last.yours.map((b) => [b.result, b.back, b.won]), [["won", 2, 2]]); // her own bet line
  assert.equal(done.last.yours.length, 0);                                // Bob sees nobody else's bets
});

test("a racer who goes away forfeits and bets on them lose", () => {
  const { code, runs } = race();                                          // set up
  claim(ALICE, "breakout", runs.p1, { score: 2, level: 1 });              // Alice finished
  tick(showdown.DROP_SECONDS + 1);                                        // time passes
  for (const uid of [ALICE, CAROL]) lobby.PRESENCE.seen(showdown._key(code), actor(uid)); // Bob's page closed
  const done = showdown.look("breakout", code, actor(ALICE));             // catch up
  assert.equal(done.phase, "result");                                     // settled
  assert.equal(done.last.winner, "Alice");                                // Alice won
  assert.deepEqual(done.seats.filter((s) => s.role === "p1" || s.role === "p2").map((s) => s.name), ["Alice"]); // Bob gone
  assert.equal(bal(BOB), 1000 - ENTRY);                                   // no prize
  assert.equal(bal(CAROL), 998);                                          // her bet lost
});

test("a table everyone leaves mid-race settles and refunds bets", () => {
  const { code, runs } = race();                                          // set up
  tick(showdown.DROP_SECONDS + 1);                                        // everyone gone
  showdown.sweep();                                                       // tidy
  assert.equal(sql().prepare("SELECT count(*) AS n FROM lumi_arcade_rooms").get().n, 0); // closed
  assert.equal(bal(CAROL), 1000);                                         // no winner: the bet came back
  const late = claim(ALICE, "breakout", runs.p1, { score: 2, level: 1 }); // a late finish
  assert.equal(late.room, code);                                          // it was a race run
  assert.ok(!("paid" in late));                                           // no table left to pay it
  assert.equal(bal(ALICE), 1000 - ENTRY);                                 // nothing paid
});

test("leaving between races hands bets back; a watcher takes the empty seat", () => {
  const table = showdown.create("breakout", actor(ALICE), "Alice", ALICE); // a table
  act(table.code, BOB, "join");                                           // Bob races
  act(table.code, CAROL, "join");                                         // Carol watches
  act(table.code, CAROL, "bet", { target: "p1", amount: 25 });            // 5 SGC on Alice
  assert.equal(bal(CAROL), 995);                                          // charged
  assert.deepEqual(act(table.code, BOB, "leave"), { left: true });        // the race Carol bet on can't happen now
  assert.equal(bal(CAROL), 1000);                                         // exact refund
  assert.equal(act(table.code, CAROL, "seat").role, "p2");                // she takes the empty racer seat
});

test("chips stack, the bet limit holds, and only listed chips are taken", () => {
  const table = showdown.create("breakout", actor(ALICE), "Alice", ALICE); // a table
  act(table.code, BOB, "join");                                           // two racers
  refusedWith(() => act(table.code, BOB, "bet", { target: "p1", amount: 5 }), 409); // racers don't bet
  act(table.code, CAROL, "join");                                         // a watcher
  refusedWith(() => act(table.code, CAROL, "bet", { target: "p1", amount: 7 }), 422); // not a chip
  for (let i = 0; i < 5; i++) act(table.code, CAROL, "bet", { target: "p1", amount: 100 }); // 500 native
  refusedWith(() => act(table.code, CAROL, "bet", { target: "p1", amount: 1 }), 409); // over the limit
  const view = showdown.look("breakout", table.code, actor(CAROL));       // her view
  assert.deepEqual(view.bets.mine, [{ role: "p1", amount: 100, native: 500 }]); // one stacked bet, 100 SGC
  assert.equal(bal(CAROL), 900);                                          // 5 x 20 SGC
});

test("ready needs both entries or nobody pays", () => {
  setBalance(eco, BOB, 3);                                                // Bob can't afford 5
  const table = showdown.create("breakout", actor(ALICE), "Alice", ALICE); // a table
  act(table.code, BOB, "join");                                           // Bob sits
  act(table.code, ALICE, "ready");                                        // Alice ready
  refusedWith(() => act(table.code, BOB, "ready"), 402);                  // Bob can't pay
  assert.equal(bal(ALICE), 1000);                                         // nobody paid
  assert.equal(bal(BOB), 3);                                              // nobody paid
});

test("one table per game, and never racing yourself", () => {
  const first = showdown.create("breakout", actor(ALICE), "Alice", ALICE); // a table
  showdown.create("breakout", actor(ALICE), "Alice", ALICE);              // opening another leaves the first...
  assert.equal(sql().prepare("SELECT count(*) AS n FROM lumi_arcade_rooms WHERE code = ?").get(first.code).n, 0); // closed
  const second = showdown.tables("breakout", actor(ALICE))[0];            // the new one
  assert.ok(second.mine);                                                 // hers
  const tv = showdown.act("breakout", second.code, "screen:1", "TV", ALICE, "join"); // same account, another actor
  assert.equal(tv.role, "watch");                                         // ...and can't race her
});

test("seats are let go when a page goes away (a stream keeps them)", () => {
  const table = showdown.create("snake", actor(ALICE), "Alice", ALICE);  // a Lumi Conga table
  showdown.act("snake", table.code, actor(BOB), "Bob", BOB, "join");      // Bob sits
  tick(showdown.DROP_SECONDS + 1);                                        // time passes
  lobby.PRESENCE.opened(showdown._key(table.code), actor(ALICE));         // Alice's stream is open; Bob's isn't
  const seats = showdown.look("snake", table.code, actor(ALICE)).seats;   // catch up
  assert.deepEqual(seats.map((s) => s.name), ["Alice"]);                  // Bob let go
});

test("a teacup tower showdown goes to the higher floor", () => {
  const table = showdown.create("teacup-tower", actor(ALICE), "Alice", ALICE); // a table
  assert.equal(table.name, "Alice's Teacup Tower table");                 // named
  showdown.act("teacup-tower", table.code, actor(BOB), "Bob", BOB, "join"); // Bob
  showdown.act("teacup-tower", table.code, actor(ALICE), "Alice", ALICE, "ready"); // ready
  showdown.act("teacup-tower", table.code, actor(BOB), "Bob", BOB, "ready"); // go
  const runs = Object.fromEntries([ALICE, BOB].map((u) => [u, showdown.look("teacup-tower", table.code, actor(u)).race.run])); // tickets
  claim(ALICE, "teacup-tower", runs[ALICE], { score: 3 });                // 3 floors
  claim(BOB, "teacup-tower", runs[BOB], { score: 5 });                    // 5 floors
  const done = showdown.look("teacup-tower", table.code, actor(BOB));     // result
  assert.equal(done.last.winner, "Bob");                                  // Bob won
  assert.equal(bal(BOB), 1000 - ENTRY + 1);                               // 5 native -> 1 SGC
});

test("every showdown seat carries its racer's Lumi", () => {
  sql().prepare("INSERT INTO lumi_pets (user_id, data) VALUES (?, ?)").run(BOB, JSON.stringify({ glow: "umbra", outfit: {} })); // Bob's Lumi
  const table = showdown.create("breakout", actor(ALICE), "alice", ALICE); // a table
  assert.equal(table.name, "alice's Yarn Pop table");                     // named
  const seen = act(table.code, BOB, "join");                              // Bob joins
  const looks = Object.fromEntries(seen.seats.map((s) => [s.name, s.look.glow])); // glows by name
  assert.deepEqual(looks, { alice: "rose", P2: "umbra" });                // each their own
});

test("Hub: listeners hear wakes and boards on the next tick; counters reset when nobody listens", async () => {
  const hub = new showdown.Hub();                                         // a private hub
  let heard = 0;                                                          // calls
  const stop = hub.listen("X", () => { heard += 1; });                    // listen
  hub.wake("X");                                                          // a table change
  hub.push("X", "seat1", { score: 1 });                                   // a board
  assert.equal(heard, 0);                                                 // not synchronous
  await new Promise((r) => setImmediate(r));                              // next tick
  assert.equal(heard, 2);                                                 // both heard
  assert.deepEqual(hub.version("X"), [1, 1]);                             // counted
  assert.deepEqual(hub.snapshot("X"), { seat1: { score: 1 } });           // the board
  hub.clear("X");                                                         // new race
  assert.deepEqual(hub.snapshot("X"), {});                                // boards gone
  stop();                                                                 // stop listening
  assert.deepEqual(hub.version("X"), [0, 0]);                             // forgotten
});

test("Presence: seen, streams, grace and forget (erinne lobby.Presence)", () => {
  let t = 1000;                                                           // a hand-moved clock (seconds)
  const p = new lobby.Presence(() => t);                                  // its own record
  assert.equal(p.quietFor(["arcade", "T"], "a"), 0);                      // never heard of: here now
  t += 10;                                                                // time passes
  assert.equal(p.quietFor(["arcade", "T"], "a"), 10);                     // quiet for 10 s
  p.opened(["arcade", "T"], "a");                                         // a stream opens
  t += 100;                                                               // a long time
  assert.equal(p.quietFor("arcade\u001fT", "a"), 0);                      // array and string keys agree; streaming = here
  assert.ok(p.streaming(["arcade", "T"], "a"));                           // streaming
  p.closed(["arcade", "T"], "a");                                         // it closes
  t += 5;                                                                 // grace counts from the close
  assert.equal(p.quietFor(["arcade", "T"], "a"), 5);                      // 5 s
  p.forget(["arcade", "T"]);                                              // the table goes
  assert.equal(p.size(), 0);                                              // nothing kept
});
