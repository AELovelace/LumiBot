// Lumi Launch's rules (static/games/lumi-launch/rules.js): the recorded goes replay to exactly what was recorded
// (tests/test_lumilaunch.py checks the server's copy against the same file), the needle, the power bar, puffs, every
// course piece doing its job, and only + - * / arithmetic (no Math.sin, sqrt or random) so the server can follow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { play, CASES } from "./lumi_launch_bot.mjs";

const require = createRequire(import.meta.url);
const R = require("../../public/lumi/lumi-launch/rules.js");
const SOURCE = readFileSync(new URL("../../public/lumi/lumi-launch/rules.js", import.meta.url), "utf8");
const RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_launch_runs.json", import.meta.url), "utf8"));
const C = R.C;

function flying(seed, over) { // a launch already in the air, placed by hand (`over` sets x, y, vx, vy...)
  const s = R.newShot(seed);
  R.press(s, "ok"); R.press(s, "ok");
  return Object.assign(s, over || {});
}
function find(kind, seed) { // the first slot with this kind of piece
  for (let i = 0; i < 400; i++) { const p = R.piece(seed || 5, i); if (p && p.kind === kind) return p; }
  throw new Error("no " + kind);
}

test("the recorded goes replay to exactly what was recorded", () => {
  for (const r of RUNS) assert.deepEqual(R.replay(r.seed, r.shots), r.result, "seed " + r.seed);
});

test("the robot still plays the recorded goes (re-run lumi_launch_bot.mjs after a rules change)", () => {
  CASES.forEach((c, i) => assert.deepEqual(JSON.parse(JSON.stringify(play(c))), RUNS[i], "seed " + c.seed));
});

test("the rules use nothing the server can't repeat exactly", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const banned of ["Math.sin", "Math.cos", "Math.sqrt", "Math.random", "Math.pow", "Math.hypot", "Math.atan", "**"])
    assert.ok(!code.includes(banned), banned + " would round differently in Python");
  assert.equal(R.ANGLES.length, C.AIM_STEPS + 1);
});

test("the needle swings 15° to 75° until OK, and a nudge stops it where you put it", () => {
  const s = R.newShot(1), seen = new Set();
  for (let i = 0; i < 400; i++) { R.step(s); seen.add(s.aim); }
  assert.equal(Math.min(...seen), 0); assert.equal(Math.max(...seen), C.AIM_STEPS);
  R.press(s, "up"); const at = s.aim;
  for (let i = 0; i < 50; i++) R.step(s);
  assert.equal(s.aim, at);
  for (let i = 0; i < 200; i++) R.press(s, "up");
  assert.equal(s.aim, C.AIM_STEPS);                                       // never past 75°
  R.press(s, "ok"); assert.equal(s.phase, "power");
});

test("the power bar fills and empties, and fires harder the fuller it is", () => {
  const speeds = [0, 50, 99].map((p) => {
    const s = R.newShot(1); R.press(s, "ok");
    while (s.power < p) R.step(s);
    R.press(s, "ok");
    return s.vx;
  });
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2]);
  const s = R.newShot(1); R.press(s, "ok");
  for (let i = 0; i < 150; i++) R.step(s);
  assert.equal(s.power, 50); assert.equal(s.powerDir, -1);                // up to 100, back down to 50
});

test("three sparkle puffs, each a hop up and forward; stardust gives one back", () => {
  const s = flying(3, { x: 500, y: 200, vx: 10, vy: -5 });
  R.press(s, "ok");
  assert.equal(s.vy, C.PUFF_UP); assert.equal(s.vx, 10 + C.PUFF_FWD); assert.equal(s.puffs, 2);
  R.press(s, "ok"); R.press(s, "ok"); R.press(s, "ok");
  assert.equal(s.puffs, 0);
  const dust = find("stardust");
  const t = flying(5, { x: dust.x + 5, y: dust.y + 10, vx: 1, vy: 0, puffs: 1 });
  R.step(t);
  assert.equal(t.puffs, 2); assert.equal(t.dust, 1); assert.ok(t.used[dust.i]);
});

test("every course piece does its job", () => {
  const pillow = find("pillow"), s1 = flying(5, { x: pillow.x + 10, y: pillow.h + 2, vx: 5, vy: -8 });
  R.step(s1); assert.ok(s1.vy >= C.PILLOW_MIN, "a pillow bounces her up");
  const cup = find("teacup"), s2 = flying(5, { x: cup.x + 10, y: cup.h + 1, vx: 3, vy: -4 });
  R.step(s2); assert.ok(s2.vx > 8 && s2.vy > 14 && s2.used[cup.i], "a teacup flings her out at 55°");
  const yarn = find("yarn"), s3 = flying(5, { x: yarn.x + 10, y: 5, vx: 4, vy: -1 });
  R.step(s3); assert.ok(s3.vx > 9 && s3.used[yarn.i], "a yarn roll speeds her along");
  const wind = find("wind"), s4 = flying(5, { x: wind.x + 10, y: 100, vx: 0.5, vy: 0 });
  R.step(s4); assert.ok(s4.vy > 0, "the wish wind lifts her");
  const comet = find("comet"), s5 = flying(5, { x: comet.x + 10, y: comet.y + 10, vx: 2, vy: 0 });
  R.step(s5); assert.ok(s5.vx > 15 && s5.vy === C.COMET_UP, "a comet rockets her on");
  for (const kind of ["honey", "nap"]) {
    const h = find(kind), s = flying(5, { x: h.x + 10, y: 1, vx: 3, vy: -1 });
    R.step(s); assert.equal(s.phase, "done"); assert.equal(s.end, kind);
    const over = flying(5, { x: h.x + 10, y: 300, vx: 3, vy: 0 });
    R.step(over); assert.equal(over.phase, "fly", "she sails over a " + kind + " in the air");
  }
});

test("she bounces, rolls and stops; a launch can't go on for ever", () => {
  const s = flying(99999, { x: 100, y: 1, vx: 6, vy: -9, seed: 99999 });
  R.step(s); assert.ok(s.vy > 0, "a hard landing bounces");
  const quiet = R.playShot(2, [[0, "ok"], [0, "ok"]]);                    // straight away: 45°-ish at power 0
  assert.equal(quiet.phase, "done"); assert.ok(R.metres(quiet) > 0);
  for (const r of RUNS) for (const e of r.ends) assert.ok(e.t <= C.AIM_MAX + C.POWER_MAX + C.FLY_MAX + 2);
});
