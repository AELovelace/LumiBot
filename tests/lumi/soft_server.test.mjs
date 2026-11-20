// Lumi-Soft on the server (src/lumi/minis/lumisoft.js), ported from erinne tests/test_lumisoft.py. PARITY: the server
// replays every recorded run (tests/lumi/fixtures/lumi_soft_runs.json, made by lumi_soft_bot.mjs) with the page's own
// rules.js and must get exactly the recorded summary. Plus SGC: entry, continues, the prize, the cap, prizes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { eco, db, tuning, errors } = boot();                                          // fresh in-memory DB
const soft = require("../../src/lumi/minis/lumisoft.js");                           // the server side
const save = require("../../src/lumi/pet/save.js");                                 // Lumi's save (prizes)
const users = require("../../src/lumi/users.js");                                    // board names
const RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_soft_runs.json", import.meta.url), "utf8")); // recorded runs
const ALICE = "222222222222222222";                                                  // Discord-shaped ids
const BOB = "333333333333333333";
const raw = () => eco.getEconomyDb();                                                // the DB
const R = soft.rules;                                                                // the shared rules.js

const run = (mode, stage = null) => RUNS.find((r) => r.mode === mode && r.stage === stage); // a recorded run

function fresh(purse = 1000) { // A clean pool with a funded bank and two players.
  resetLumi(eco);
  raw().exec("DELETE FROM lumi_soft_runs; DELETE FROM lumi_soft_bests; DELETE FROM lumi_soft_progress; DELETE FROM lumi_pets;");
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  setBalance(eco, ALICE, purse);
  setBalance(eco, BOB, purse);
  users.remember(ALICE, "alice");
  users.remember(BOB, "bob");
}

function play(uid, recorded, { payContinues = true, start = 1000.0 } = {}) { // erinne _play
  return db.tx(() => {
    const ticket = soft.start(uid, recorded.mode, recorded.stage, start);           // ticket
    if (payContinues) for (let i = 0; i < recorded.log.continues; i++) soft.carryOn(uid, ticket.run); // continues
    return [ticket, soft.finish(uid, ticket.run, recorded.log, start + recorded.log.end / 60 + 5)]; // in time
  });
}

for (const recorded of RUNS) {
  test(`PARITY: the server replays ${recorded.mode}-${recorded.stage || recorded.day} exactly as the page did`, () => {
    const segs = R.plan(soft.DATA, recorded.mode, recorded.stage, recorded.day);    // the same plan
    const state = R.replay(soft.DATA, segs, recorded.log);                          // the shared rules
    assert.deepEqual(R.summary(state), recorded.summary);
    assert.equal(state.refused, 0);
  });
}

test("PARITY through finish(): the server's own replay equals the recorded summary (every stage-select run)", () => {
  fresh(100_000);
  raw().prepare("INSERT INTO lumi_soft_progress (user_id, data) VALUES (?, ?)").run(ALICE, JSON.stringify({ cleared: soft.STAGES })); // every stage open
  for (const recorded of RUNS.filter((r) => r.mode !== "daily")) {
    const [, out] = play(ALICE, recorded);
    assert.deepEqual(out.summary, recorded.summary, `${recorded.mode}-${recorded.stage}`);
    assert.equal(out.refused, null);
  }
});

test("the recorded runs cover what matters", () => {
  assert.ok(run("story").summary.done && run("story").summary.cleared.length === 5);
  assert.equal(run("stage", "lounge").summary.continues, 2);
  assert.ok(run("stage", "fair").summary.over && !run("stage", "fair").summary.continues);
  assert.ok(!run("stage", "dungeon").summary.done && !run("stage", "dungeon").summary.over);
});

test("plans: story, daily and stages", () => {
  const story = R.plan(soft.DATA, "story");
  assert.deepEqual(story.filter((s) => s.scene < 0).map((s) => soft.DATA.stages[s.stage].id), soft.STAGES);
  assert.equal(story.length, soft.STAGES.length * 4);
  const daily = Array.from({ length: 10 }, (_, day) => R.plan(soft.DATA, "daily", null, day));
  assert.ok(daily.every((d) => d.length === 2 && d[1].scene === -1));
  assert.equal(new Set(daily.map((d) => JSON.stringify(d))).size, 10);
  assert.equal(R.plan(soft.DATA, "stage", "training"), null);
  assert.equal(R.plan(soft.DATA, "stage", "nope"), null);
  assert.deepEqual(R.plan(soft.DATA, "training"), [{ stage: 0, scene: 0 }]);
});

test("dayNumber is Python's date.toordinal() of the LA day", () => {
  db.setClock(() => Date.UTC(2026, 10, 19, 20, 0, 0));                              // 2026-11-19 noon in LA
  assert.equal(soft.dayNumber(), 739939);                                           // date(2026, 11, 19).toordinal()
  db.setClock(() => Date.UTC(2000, 0, 1, 20, 0, 0));                                // 2000-01-01 in LA
  assert.equal(soft.dayNumber(), 730120);                                           // date(2000, 1, 1).toordinal()
  db.setClock(null);
});

test("a run costs its entry and pays its score once", () => {
  fresh();
  const recorded = run("stage", "garden");
  const [ticket, out] = play(ALICE, recorded);
  assert.equal(ticket.entry, soft.ENTRY);                                            // native, for LumiPrice
  assert.equal(ticket.charged, tuning.scalePrice("soft", "entry", soft.ENTRY));      // 5 SGC
  assert.equal(ticket.practice, false);
  assert.equal(out.summary.score, recorded.summary.score);
  assert.equal(out.earned, Math.floor(recorded.summary.score / soft.POINTS_PER_COIN)); // native
  assert.equal(out.paid, tuning.scalePayout("soft", "win", out.earned));             // scaled
  assert.equal(out.coins, 1000 - ticket.charged + out.paid);
  assert.ok(raw().prepare("SELECT 1 FROM lumi_coin_refs WHERE ref = ?").get(`lumi-soft:${ticket.run}`));
  assert.throws(() => db.tx(() => soft.finish(ALICE, ticket.run, recorded.log, 99999.0)), soft.Refused);
});

test("the daily cap", () => {
  fresh();
  tuning.setGame("soft", "dailyCap", 100, "test");                                   // uncapped by default: an admin sets 100
  const [, story] = play(ALICE, run("story"));                                      // 275,630 points: 1102 native -> 220 SGC
  assert.equal(story.paid, 100);                                                     // trimmed to the admin's cap of 100
  assert.equal(story.capped, true);
  const [, out] = play(ALICE, run("stage", "garden"));                               // today's 100 are used up
  assert.equal(out.paid, 0);
  assert.equal(out.capped, true);
  assert.match(out.said, /today's Lumi-Soft limit/);
  tuning.setGame("soft", "dailyCap", 0, "test");                                     // back to the default (0 = uncapped)
});

test("no SGC, no run; training is free", () => {
  fresh(0);
  assert.throws(() => db.tx(() => soft.start(ALICE, "story")), (e) => e instanceof errors.LumiError && e.status === 402 && /A run costs 5 SGC/.test(e.message));
  const ticket = db.tx(() => soft.start(ALICE, "training"));
  assert.ok(ticket.practice && ticket.entry === 0 && ticket.charged === 0);
  assert.throws(() => db.tx(() => soft.carryOn(ALICE, ticket.run)), soft.Refused);   // no game over to continue from
});

test("continues cost more each time and keep the score", () => {
  fresh(5000);
  const ticket = db.tx(() => soft.start(ALICE, "stage", "garden"));
  const prices = [0, 1, 2, 3, 4].map(() => db.tx(() => soft.carryOn(ALICE, ticket.run)).paid);
  assert.deepEqual(prices, [50, 100, 200, 400, 400].map((n) => tuning.scalePrice("soft", "continue", n))); // 10/20/40/80/80
  db.tx(() => soft._saveProgress(ALICE, { ...soft._progress(ALICE), cleared: ["garden", "tower"] }));      // the lounge is open
  const recorded = run("stage", "lounge");                                           // went over twice
  const [, unpaid] = play(ALICE, recorded, { payContinues: false });
  assert.ok(unpaid.summary.continues === 0 && unpaid.summary.over);
  assert.ok(unpaid.summary.score < recorded.summary.score);
  const before = eco.getBalance(ALICE);
  const [t2, paid] = play(ALICE, recorded);
  assert.deepEqual(paid.summary, recorded.summary);
  assert.equal(eco.getBalance(ALICE), before - t2.charged - tuning.scalePrice("soft", "continue", 50) - tuning.scalePrice("soft", "continue", 100) + paid.paid);
});

test("a run longer than the clock allows pays nothing", () => {
  fresh();
  const out = db.tx(() => { const t = soft.start(ALICE, "stage", "garden", 0.0); return soft.finish(ALICE, t.run, run("stage", "garden").log, 5.0); });
  assert.ok(out.paid === 0 && /add up/.test(out.refused) && out.summary.score === 0);
});

test("someone else's ticket, and one run at a time", () => {
  fresh();
  const first = db.tx(() => soft.start(ALICE, "training")).run;
  assert.throws(() => db.tx(() => soft.finish(BOB, first, { end: 0 })), soft.Refused);
  db.tx(() => soft.start(ALICE, "training"));
  assert.throws(() => db.tx(() => soft.finish(ALICE, first, { end: 0 })), soft.Refused);
});

test("the Daily Range has one scored try", () => {
  fresh();
  const day = soft.dayNumber();
  const first = db.tx(() => soft.start(ALICE, "daily"));
  assert.equal(first.practice, false);
  assert.deepEqual(first.plan, R.plan(soft.DATA, "daily", null, day));
  const out = db.tx(() => soft.finish(ALICE, first.run, run("daily").log, 10_000_000_000.0));
  const again = db.tx(() => soft.start(ALICE, "daily"));
  assert.ok(again.practice && again.entry === 0);
  assert.equal(db.tx(() => soft.finish(ALICE, again.run, { end: 0 })).paid, 0);      // practice pays nothing
  const board = soft.state(BOB).daily;
  assert.equal(board.tried, false);
  assert.equal(board.board[0].name, "alice");
  assert.equal(board.board[0].score, out.summary.score);
  assert.equal(soft.state(ALICE).daily.tried, true);
});

test("stage select opens in order", () => {
  fresh();
  assert.throws(() => db.tx(() => soft.start(ALICE, "stage", "tower")), (e) => e instanceof soft.Refused && e.status === 403);
  play(ALICE, run("stage", "garden"));
  assert.ok(db.tx(() => soft.start(ALICE, "stage", "tower")).plan);
  assert.throws(() => db.tx(() => soft.start(ALICE, "stage", "training")), soft.Refused);
});

test("bests keep the highest", () => {
  fresh();
  const [, out] = play(ALICE, run("stage", "garden"));
  assert.ok(out.bests.includes("stage:garden"));
  const best = soft.state(ALICE).bests["stage:garden"];
  assert.equal(best.score, out.summary.cleared[0].score);
  assert.equal(best.rank, out.summary.cleared[0].rank);
  db.tx(() => soft.finish(ALICE, soft.start(ALICE, "stage", "garden").run, { end: 0 })); // a worse run
  assert.deepEqual(soft.state(ALICE).bests["stage:garden"], best);
});

test("prizes land in Lumi's house and closet, once each", () => {
  fresh();
  const [, trained] = play(ALICE, run("training"));
  assert.deepEqual(trained.won.map((p) => p.id), ["soft-rug"]);
  assert.ok(save.peek(ALICE).decor.includes("soft-rug"));
  const [, story] = play(ALICE, run("story"));
  const won = new Set(story.won.map((p) => p.id));
  for (const id of ["soft-trophy", "acc-soft-goggles", "soft-wallpaper", "soft-curtains", "soft-lamp", "soft-ceiling", "soft-bed"]) assert.ok(won.has(id), id);
  const pet = save.peek(ALICE);
  assert.ok(pet.closet.includes("acc-soft-goggles") && pet.decor.includes("soft-trophy"));
  const again = play(ALICE, run("story"))[1];
  assert.ok(!again.won.some((p) => ["soft-trophy", "acc-soft-goggles"].includes(p.id)));
  const state = soft.state(ALICE);
  assert.equal(state.prizes.length, soft.PRIZES.length);
  assert.ok(state.prizes.every((p) => p.how));
  for (const id of won) assert.ok(state.prizes.find((p) => p.id === id).won);
});

test("every prize is in Lumi's catalogs and can't be bought", () => {
  for (const [item] of soft.PRIZES) {
    const info = soft._prizeInfo(item);
    assert.ok(info && info.how, item);
    const piece = save.DECOR[item] || save.WEAR[item];
    assert.ok(piece.price === 0 && piece.prize === "lumi-soft", item);
  }
});
