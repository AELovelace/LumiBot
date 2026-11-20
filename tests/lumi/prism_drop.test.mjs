// Prism Drop on the server (src/lumi/minis/prism.js), ported from erinne tests/test_prism.py, plus LumiBot's SGC:
// the tenth drop pays score / 10 (native) through sgc.pay with the 'prism' tuning, once, capped per day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { eco, db, tuning } = boot();                                                  // fresh in-memory DB
const prism = require("../../src/lumi/minis/prism.js");                             // the game
const ME = "111111111111111111";                                                     // a Discord-shaped id

function seeded(seed) { // A repeatable draw(n): the same LCG as erinne's test (mod 2^32).
  let state = seed >>> 0;                                                            // 32-bit state
  return (n) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; }; // next number
}

const platform = (row = 3, left = 4, dir = 1) => ({ row, left, dir });              // erinne _platform
function falling(column) { // Enters at `column` (4-7) and then always steps the same way.
  const answers = [column - 4];                                                      // the entry
  return (n) => (answers.length ? answers.shift() : (n === 2 ? 1 : 0));              // then always "right"
}

test("a field has 28 special pegs in unique cells, none on the entry row", () => {
  const field = prism.randomObstacles(seeded(1));
  assert.equal(field.length, 28);
  const count = (k) => field.filter((p) => p.type === k).length;
  assert.deepEqual([count("block"), count("bomb"), count("coin")], [11, 9, 8]);
  assert.equal(new Set(field.map((p) => `${p.row},${p.column}`)).size, 28);
  assert.ok(field.every((p) => p.row >= 1 && p.row < prism.HEIGHT && p.column >= 1 && p.column <= prism.WIDTH));
});

test("every drop enters at pin 4 to 7, stays inside and lands", () => {
  for (let seed = 0; seed < 500; seed++) {
    const result = prism.roll(5, seeded(seed));
    const path = result.trajectory;
    assert.ok(path[0].row === 0 && path[0].column >= 4 && path[0].column <= 7);
    assert.ok(path.every((p) => p.column >= 1 && p.column <= prism.WIDTH && p.row >= 0 && p.row <= prism.HEIGHT));
    assert.ok(path[path.length - 1].row === prism.HEIGHT && result.landing >= 1 && result.landing <= prism.WIDTH);
    assert.ok(path.length < 200);                                                    // single-use bombs: gravity wins
  }
});

test("landing points", () => {
  assert.deepEqual([5, 4, 7].map((n) => prism.landingPoints(5, n)), [20, 15, 10]);
  assert.equal(prism.landingPoints(1, 4), 0);
  assert.equal(prism.landingPoints(10, 1), 0);
});

test("a drop's points are its landing plus each coin peg once", () => {
  for (let seed = 0; seed < 300; seed++) {
    const result = prism.roll(3, seeded(seed));
    const coins = result.trajectory.filter((p) => p.hit === "coin");
    assert.equal(new Set(coins.map((p) => `${p.row},${p.column}`)).size, coins.length);
    assert.ok(coins.every((p) => p.coins >= 1 && p.coins <= 5));
    assert.equal(result.bonus, coins.reduce((s, p) => s + p.coins, 0));
    assert.equal(result.points, prism.landingPoints(3, result.landing) + result.bonus);
    assert.ok(result.landingPoints + result.bonus === result.points && result.pick === 3);
  }
});

test("a bomb fires once per drop and a block shoves two", () => {
  const path = prism.drop(seeded(7), [{ row: 1, column: 5, type: "block" }]).trajectory;
  path.forEach((point, i) => { if (point.hit === "block") assert.ok([0, 2].includes(Math.abs(path[i + 1].column - point.column))); });
  for (let seed = 0; seed < 300; seed++) {
    const bombs = prism.roll(5, seeded(seed)).trajectory.filter((p) => p.hit === "bomb").map((p) => `${p.row},${p.column}`);
    assert.equal(new Set(bombs).size, bombs.length);
  }
});

test("every drop has two platforms on rows with no pegs", () => {
  for (let seed = 0; seed < 200; seed++) {
    const result = prism.roll(5, seeded(seed));
    const rows = result.platforms.map((p) => p.row);
    assert.ok(rows.length === 2 && rows[0] >= 5 && rows[0] <= 9 && rows[1] >= 12 && rows[1] <= 16);
    assert.ok(!result.obstacles.some((o) => rows.includes(o.row)) && result.obstacles.length === 28);
    assert.ok(result.platforms.every((p) => p.left >= 1 && p.left <= prism.WIDTH - prism.PLATFORM_SPAN + 1 && [-1, 1].includes(p.dir)));
  }
});

test("a platform slides one column a step and turns at the walls", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => prism.platformLeft(platform(3, 7, 1), t)), [7, 8, 7, 6, 5]);
  assert.deepEqual([0, 1, 2, 3].map((t) => prism.platformLeft(platform(3, 2, -1), t)), [2, 1, 2, 3]);
  const far = platform(3, 1, 1);
  for (let t = 0; t < 500; t++) {
    assert.ok(prism.platformLeft(far, t) >= 1 && prism.platformLeft(far, t) <= 8);
    assert.equal(Math.abs(prism.platformLeft(far, t + 1) - prism.platformLeft(far, t)), 1);
  }
});

test("a bounce sends the ball up toward the edge it struck, with the platform's motion", () => {
  const right = platform(6, 3, 1);                                                   // at tick 2 it covers 5, 6, 7
  assert.deepEqual(prism._bounce({ row: 6, column: 5 }, right, 2), [4, 2]);
  assert.deepEqual(prism._bounce({ row: 6, column: 6 }, right, 2), [7, 2]);
  assert.deepEqual(prism._bounce({ row: 6, column: 7 }, right, 2), [10, 2]);
  assert.deepEqual(prism._bounce({ row: 6, column: 6 }, platform(6, 7, -1), 2), [5, 2]);
  assert.equal(prism._bounce({ row: 2, column: 5 }, platform(2, 4), 0)[1], 0);       // never above the top
  assert.equal(prism._bounce({ row: 6, column: 1 }, platform(6, 1, -1), 0)[0], 2);   // off the wall to 2
});

test("a falling ball bounces only where the platform is at that moment", () => {
  const path = prism.drop(falling(4), []).trajectory;
  assert.deepEqual(path[3], { row: 3, column: 7 });
  const caught = prism.drop(falling(4), [], [platform(3, 3, 1)]).trajectory;
  assert.ok(caught[3].hit === "platform" && caught[3].platform === 0 && caught[4].row === 0);
  assert.deepEqual(prism.drop(falling(4), [], [platform(3, 1, 1)]).trajectory, path);
});

test("a ball rising past a platform isn't caught", () => {
  for (let seed = 0; seed < 400; seed++) {
    const t = prism.drop(seeded(seed), [{ row: 8, column: 6, type: "bomb" }], [platform(6, 4)]).trajectory;
    t.forEach((point, i) => { if (point.hit === "platform") assert.ok(t[i - 1].row < point.row); });
  }
});

test("each platform gives two bounces and every ball still lands; a fair share bounce", () => {
  let bounced = 0;                                                                   // drops with a bounce
  for (let seed = 0; seed < 1000; seed++) {
    const result = prism.roll(5, seeded(seed));
    const hits = result.trajectory.filter((p) => p.hit === "platform").map((p) => p.platform);
    assert.ok(hits.filter((h) => h === 0).length <= prism.PLATFORM_BOUNCES && hits.filter((h) => h === 1).length <= prism.PLATFORM_BOUNCES);
    assert.ok(result.trajectory[result.trajectory.length - 1].row === prism.HEIGHT && result.trajectory.length < 200);
    if (hits.length) bounced += 1;
  }
  assert.ok(bounced > 200 && bounced < 900);
});

// ------------------------------------------------------------------ SGC (LumiBot)
test("ten drops make a game; the tenth pays score / 10 native, scaled, once, from Lumi-Town Bank", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 10_000);                                    // the bank can pay
  setBalance(eco, ME, 0);
  let clock = 1_800_000_000_000;                                                     // fake clock
  db.setClock(() => clock);
  const me = { id: ME, name: "Doll" };
  let last;
  for (let n = 1; n <= 10; n++) {
    clock += 1000;
    last = prism.play(me, 5, seeded(n));
    assert.equal(last.drops, n);
    assert.equal(last.over, n === 10);
    if (n < 10) assert.deepEqual(prism.current(ME), { drops: n, score: last.score });
  }
  assert.equal(last.earned, Math.floor(last.score / 10));                            // native coins
  assert.equal(last.paid, tuning.scalePayout("prism", "win", last.earned));          // x 0.2, floored
  assert.equal(last.coins, last.paid);                                               // landed on her account
  assert.deepEqual(prism.current(ME), { drops: 0, score: 0 });                       // a new game next
  const ref = eco.getEconomyDb().prepare("SELECT ref FROM lumi_coin_refs WHERE user_id = ? AND ref LIKE 'lumi-prism:%'").get(ME);
  assert.ok(ref && ref.ref.startsWith(`lumi-prism:${ME}:`));                         // pay-once ref
  db.setClock(null);
});

test("the daily cap bites and the player is told", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 10_000);
  tuning.setGame("prism", "dailyCap", 1, "test");                                    // 1 SGC a day
  tuning.setGame("prism", "payoutMult", 50, "test");                                 // so any score is worth more than 1
  let clock = 1_800_000_100_000;
  db.setClock(() => clock);
  let last;
  for (let n = 1; n <= 10; n++) { clock += 1000; last = prism.play({ id: ME, name: "Doll" }, 5, seeded(99 + n)); } // ten drops
  assert.ok(last.earned > 0);                                                        // it scored
  assert.equal(last.paid, 1);                                                        // trimmed to the cap
  assert.equal(last.capped, true);
  assert.match(last.said, /today's Prism Drop limit/);
  tuning.setGame("prism", "payoutMult", 1, "test");                                  // put it back
  db.setClock(null);
});
