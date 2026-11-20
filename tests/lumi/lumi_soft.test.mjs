// Lumi-Soft's rules (static/games/lumi-soft/rules.js) and art (art.js): the recorded runs replay to the same result
// (tests/test_lumisoft.py checks the server's copy against the same file), scoring, the Popper's timing, the wind,
// and that every look and prop the stages use has a drawing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { play, CASES, DATA } from "./lumi_soft_bot.mjs";
const require = createRequire(import.meta.url);
const R = require("../../public/lumi/lumi-soft/rules.js");
const A = require("../../public/lumi/lumi-soft/art.js");
const RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_soft_runs.json", import.meta.url), "utf8"));

test("the recorded runs replay to exactly what was recorded", () => {
  for (const r of RUNS) {
    const s = R.replay(DATA, R.plan(DATA, r.mode, r.stage, r.day), r.log);
    assert.deepEqual(R.summary(s), r.summary, r.mode + " " + (r.stage || ""));
    assert.equal(s.refused, 0);
  }
});

test("the robot still plays the recorded runs (re-run lumi_soft_bot.mjs after a rules change)", () => {
  CASES.forEach(([mode, opts], i) => assert.deepEqual(play(mode, opts), RUNS[i], mode + " " + (opts.stage || "")));
});

function lone(def) { // A one-target training scene: just this target, standing in a field.
  const data = { stages: [{ id: "training", name: "T", training: true, scenes: [{ id: "t", props: [], waves: [{ targets: [def] }] }], boss: null },
    { id: "x", name: "X", wind: 0, scenes: [{ id: "x1", props: [], waves: [{ targets: [def] }] }], boss: null }] };
  return data;
}

test("a star badge is the top quarter; far, quick and moving pops are worth more; the combo grows", () => {
  const card = { kind: "creature", look: "can", x: 500, y: 1000, s: 1, at: 0, move: { type: "stand" } };
  const s = R.create(lone(card), [{ stage: 1, scene: 0 }]);
  R.step(s); s.targets[0].age = 200;                                                   // not quick any more
  const badge = R.fire(s, 500, 1000 - 131 + 10);
  assert.equal(badge.what, "badge"); assert.equal(badge.points, 100);
  const far = R.create(lone({ ...card, s: 0.6 }), [{ stage: 1, scene: 0 }]); R.step(far); far.targets[0].age = 200;
  assert.equal(R.fire(far, 500, 990).points, 75);                                     // body 50, ×1.5 far
  const quick = R.create(lone(card), [{ stage: 1, scene: 0 }]); R.step(quick);
  assert.equal(R.fire(quick, 500, 990).points, 100);                                  // body 50 + quick 50
  const s2 = R.create(lone(card), [{ stage: 1, scene: 0 }]); R.step(s2); s2.streak = 20; s2.targets[0].age = 200;
  assert.equal(R.fire(s2, 500, 990).points, 150);                                     // ×3.0 at most
});

test("a pop-up can only be hit once it has risen, and only the part above its cover", () => {
  const def = { kind: "creature", look: "dust-bunny", x: 800, y: 900, s: 1, at: 0, move: { type: "pop", up: 12, stay: 60, gap: 60 } };
  const p0 = R.pose(def, 2), p1 = R.pose(def, 20), p2 = R.pose(def, 140);
  assert.equal(p0.ok, false); assert.equal(p1.ok, true); assert.equal(p1.v, 1); assert.equal(p2.ok, false);
  const half = R.pose(def, 6); assert.equal(half.top, 900 - 131 * 0.5);              // half risen: half showing
});

test("the Popper: six BBs, half a second between pops, an empty tube reloads by itself", () => {
  const s = R.create(DATA, R.plan(DATA, "training")), shots = [];
  for (let i = 0; i < 400; i++) { if (R.canFire(s)) shots.push(s.t), R.fire(s, 10, 10); R.step(s); }
  assert.deepEqual(shots.slice(0, 7).map((t, i) => (i ? t - shots[i - 1] : 0)), [0, 30, 30, 30, 30, 30, 72]);   // the 7th waits for the reload
  assert.equal(R.reload(s), !s.reloading && s.ammo < 6);
  const ready = R.create(DATA, R.plan(DATA, "training"));
  assert.equal(R.reload(ready), false);                                               // a full tube needn't reload
});

test("wind pushes far BBs more than near ones", () => {
  const s = R.create(DATA, R.plan(DATA, "stage", "tower"));
  const far = R.impact(s, 1000, 300), near = R.impact(s, 1000, 1400);
  assert.ok(far.x - 1000 > near.x - 1000 && near.x > 1000);
});

test("a friend costs points, time and the combo; misses break the combo too", () => {
  const friend = { kind: "friend", look: "friend-lumi", x: 500, y: 1000, s: 1, at: 0, move: { type: "stand" } };
  const data = lone(friend); data.stages[1].scenes[0].waves[0].targets.push({ ...friend, kind: "creature", look: "can", x: 2000 });   // a wave waits for its creatures, not its friends
  const s = R.create(data, [{ stage: 1, scene: 0 }]); R.step(s); s.score = 1000; s.streak = 5;
  const clock = s.clock, out = R.fire(s, 500, 950);
  assert.equal(out.what, "friend"); assert.equal(s.score, 750); assert.equal(s.streak, 0); assert.equal(s.clock, clock - 300);
});

test("a finished run can still be asked which stage and scene it's on (the page draws one more frame)", () => {
  const r = RUNS.find(x => x.mode === "training"), s = R.replay(DATA, R.plan(DATA, "training"), r.log);
  assert.equal(s.done, true);
  assert.equal(R.stageOf(s).id, "training");                                          // the last segment, not a crash
  assert.ok(R.scene(s)); assert.equal(R.impact(s, 10, 10).x, 10); assert.equal(R.canFire(s), false);
  const story = RUNS.find(x => x.mode === "story"), t = R.replay(DATA, R.plan(DATA, "story"), story.log);
  assert.equal(t.done, true); assert.equal(R.stageOf(t).id, "fair"); assert.equal(R.scene(t), null);   // ended on the Comet Drake
});

test("ranks", () => {
  assert.equal(R.rank({ hits: 9, shots: 10, lost: 0, friends: 0 }), "S");
  assert.equal(R.rank({ hits: 9, shots: 10, lost: 1, friends: 0 }), "A");
  assert.equal(R.rank({ hits: 6, shots: 10, lost: 0, friends: 0 }), "B");
  assert.equal(R.rank({ hits: 1, shots: 10, lost: 0, friends: 0 }), "D");
});

test("every look, prop and boss the stages use has a drawing", () => {
  const looks = new Set(), props = new Set(), skies = new Set(), bosses = new Set();
  DATA.stages.forEach(st => { skies.add(st.sky); if (st.boss) bosses.add(st.boss.look); st.scenes.forEach(sc => { sc.props.forEach(p => props.add(p.look)); sc.waves.forEach(w => w.targets.forEach(t => looks.add(t.kind + ":" + t.look))); }); });
  skies.forEach(k => assert.ok(A.BACKDROPS[k], "backdrop " + k));
  props.forEach(k => assert.ok(A.PROPS[k], "prop " + k));
  bosses.forEach(k => assert.ok(A.BOSSES[k], "boss " + k));
  looks.forEach(k => { const [kind, look] = k.split(":"); assert.ok(kind === "pickup" ? look.startsWith("pickup-") : kind === "friend" ? A.FRIENDS[look] : A.BODIES[look], k); });
});

test("the art draws without throwing on a stand-in canvas", () => {
  const noop = () => {}, grad = { addColorStop: noop };
  const ctx = new Proxy({}, { get: (_, k) => k === "createLinearGradient" || k === "createRadialGradient" ? () => grad : noop, set: () => true });
  Object.keys(A.BACKDROPS).forEach(k => A.backdrop(ctx, k));
  Object.keys(A.PROPS).forEach(k => A.prop(ctx, { look: k, x: 100, y: 100, w: 200, h: 60 }));
  Object.keys(A.BODIES).forEach(k => A.standee(ctx, k, "creature", 0, 0, 1, 0.5, { wind: 0.5 }));
  Object.keys(A.FRIENDS).forEach(k => A.standee(ctx, k, "friend", 0, 0, 1, 1));
  ["pickup-star", "pickup-clock", "pickup-heart", "pickup-crate"].forEach(k => A.pickup(ctx, k, 0, 0, 1, 3));
  Object.keys(A.BOSSES).forEach(k => A.boss(ctx, k, 0, 0, 400, 400, 1, 0.5));
  A.popper(ctx, 0, 0, 100, { glow: "#fff", body: "#fff", shadow: "#000" }, 1); A.reticle(ctx, 0, 0, 30, "paw", "#fff"); A.fireworks(ctx, 100);
});
