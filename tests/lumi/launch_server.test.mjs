// Lumi Launch on the server (src/lumi/minis/lumilaunch.js), ported from erinne tests/test_lumilaunch.py. PARITY: the
// server replays every recorded go (tests/lumi/fixtures/lumi_launch_runs.json, made by lumi_launch_bot.mjs) with the
// page's own rules.js and must land exactly on the recorded result. Plus SGC: the entry, the prize, the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { eco, db, tuning, errors } = boot();                                          // fresh in-memory DB
const launch = require("../../src/lumi/minis/lumilaunch.js");                       // the server side
const users = require("../../src/lumi/users.js");                                    // names for the board
const RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_launch_runs.json", import.meta.url), "utf8")); // recorded goes
const ALICE = "222222222222222222";                                                  // Discord-shaped ids
const BOB = "333333333333333333";
const raw = () => eco.getEconomyDb();                                                // the DB

function fresh() { // A clean pool with a funded bank and two players with 1000 SGC each.
  resetLumi(eco);
  raw().exec("DELETE FROM lumi_launch_runs; DELETE FROM lumi_launch_bests;");
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  setBalance(eco, ALICE, 1000);
  setBalance(eco, BOB, 1000);
  users.remember(ALICE, "alice");
  users.remember(BOB, "bob");
}

function go(uid, recorded, start = 1000.0, late = 5.0) { // erinne _go: start, swap in the recorded course, finish.
  return db.tx(() => {
    const ticket = launch.start(uid, start);                                         // pay + ticket
    raw().prepare("UPDATE lumi_launch_runs SET seed = ? WHERE id = ?").run(recorded.seed, ticket.run); // the recorded course
    const out = launch.finish(uid, ticket.run, recorded.shots, start + recorded.result.frames / 60 + late); // in time
    return [ticket, out];
  });
}

const longest = () => [...RUNS].sort((a, b) => a.result.total - b.result.total).at(-1); // the farthest go

for (const recorded of RUNS) {
  test(`PARITY: the server replays go ${recorded.seed} exactly as the page flew it`, () => {
    for (let n = 0; n < recorded.shots.length; n++) {                              // each launch, to the last bit
      const s = launch.rules.playShot(recorded.seed, recorded.shots[n]);
      const end = recorded.ends[n];
      assert.deepEqual([s.x, s.y, s.vx, s.t, s.end, launch.rules.metres(s), s.dust], [end.x, end.y, end.vx, end.t, end.end, end.m, end.dust]);
    }
    fresh();
    const [, out] = go(ALICE, recorded);                                             // through the real finish()
    assert.deepEqual(out.summary, recorded.result);                                  // server replay == recorded result
    assert.equal(out.refused, null);
  });
}

test("a go costs its entry and pays its distance once", () => {
  fresh();
  const recorded = longest();
  const [ticket, out] = go(ALICE, recorded);
  assert.equal(ticket.entry, launch.ENTRY);                                          // native, for LumiPrice
  assert.equal(ticket.charged, tuning.scalePrice("launch", "entry", launch.ENTRY));  // 25 x 0.2 = 5 SGC
  assert.equal(ticket.shots, 3);
  assert.equal(out.earned, Math.floor(recorded.result.total / launch.METRES_PER_COIN)); // native
  assert.equal(out.paid, tuning.scalePayout("launch", "win", out.earned));           // scaled
  assert.equal(out.coins, 1000 - ticket.charged + out.paid);
  assert.equal(eco.getBalance("__LUMI_ARCADE__"), ticket.charged);                   // the entry went to Lumi Arcade
  assert.ok(raw().prepare("SELECT 1 FROM lumi_coin_refs WHERE ref = ?").get(`lumi-launch:${ticket.run}`)); // ref
  assert.throws(() => db.tx(() => launch.finish(ALICE, ticket.run, recorded.shots, 99999.0)), (e) => e instanceof launch.Refused && e.status === 404); // used up
});

test("the daily cap", () => {
  fresh();
  tuning.setGame("launch", "dailyCap", 30, "test");                                  // 30 SGC a day
  assert.equal(launch.state(ALICE).cap, 30);
  const paid = [];
  for (let n = 0; n < 8; n++) paid.push(go(ALICE, longest(), 1000.0 + n * 1000)[1]);
  assert.equal(paid.reduce((s, o) => s + o.paid, 0), 30);                            // 30 a day, however long she flies
  assert.equal(paid.at(-1).paid, 0);
  assert.equal(paid.at(-1).capped, true);
  assert.match(paid.at(-1).said, /today's Lumi Launch limit/);
  tuning.setGame("launch", "dailyCap", 0, "test");                                   // back to the default (0 = uncapped)
});

test("no SGC, no go (402)", () => {
  fresh();
  setBalance(eco, ALICE, 0);
  assert.throws(() => db.tx(() => launch.start(ALICE, 1000.0)), (e) => e instanceof errors.LumiError && e.status === 402 && /A go costs 5 SGC/.test(e.message));
});

test("a go longer than the clock allows pays nothing", () => {
  fresh();
  const recorded = [...RUNS].sort((a, b) => a.result.frames - b.result.frames).at(-1);
  const out = db.tx(() => { const t = launch.start(ALICE, 1000.0); return launch.finish(ALICE, t.run, recorded.shots, 1001.0); });
  assert.ok(out.refused && out.paid === 0);
  assert.equal(out.coins, 1000 - tuning.scalePrice("launch", "entry", launch.ENTRY));
});

for (const [name, shots] of [["unknown button", [[[0, "fly"]]]], ["frames out of order", [[[30, "ok"], [10, "ok"]]]], ["four launches", [[], [], [], []]]]) {
  test(`logs that can't be real are refused: ${name}`, () => {
    fresh();
    assert.throws(() => db.tx(() => { const t = launch.start(ALICE, 1000.0); return launch.finish(ALICE, t.run, shots, 5000.0); }), (e) => e instanceof launch.Refused && e.status === 422);
  });
}

test("quitting early still counts what she flew", () => {
  fresh();
  const recorded = RUNS[0];
  const out = db.tx(() => {
    const t = launch.start(ALICE, 1000.0);
    raw().prepare("UPDATE lumi_launch_runs SET seed = ? WHERE id = ?").run(recorded.seed, t.run);
    return launch.finish(ALICE, t.run, recorded.shots.slice(0, 1), 2000.0);
  });
  assert.equal(out.summary.total, recorded.ends[0].m);
  assert.equal(out.summary.shots.length, 1);
});

test("one go at a time, and only your own", () => {
  fresh();
  const first = db.tx(() => launch.start(ALICE, 1000.0));
  assert.throws(() => db.tx(() => launch.finish(BOB, first.run, [], 2000.0)), launch.Refused); // bob can't finish alice's go
  db.tx(() => launch.start(ALICE, 1100.0));                                           // a new go drops the old one
  assert.throws(() => db.tx(() => launch.finish(ALICE, first.run, [], 2000.0)), launch.Refused);
});

test("bests keep the longest and the board names them", () => {
  fresh();
  const sorted = [...RUNS].sort((a, b) => a.result.total - b.result.total);
  const [long, short] = [sorted.at(-1), sorted[0]];
  const first = go(ALICE, long)[1];
  assert.deepEqual(first.new_best, { go: true, shot: true });
  const second = go(ALICE, short, 5000.0)[1];
  assert.equal(second.new_best.go, false);
  assert.equal(second.best.go, long.result.total);
  go(BOB, short, 9000.0);
  const board = launch.board();
  assert.deepEqual(board.map((r) => r.name), ["alice", "bob"]);
  assert.equal(board[0].go, long.result.total);
  assert.equal(board[0].shot, Math.max(...long.ends.map((e) => e.m)));
  const state = launch.state(ALICE);
  assert.equal(state.best.go, long.result.total);
  assert.deepEqual(state.board, board);
  assert.equal(state.entry, launch.ENTRY);                                           // native, the page shows LumiPrice
});
