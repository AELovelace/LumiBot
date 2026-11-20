// Teacup Tower's rules (static/games/teacup-tower/rules.js): the tower from its seed, bouncing, steering, wall kicks,
// combos, cracked cups, the rising tower and falling out of the view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const T = createRequire(import.meta.url)("../../public/lumi/teacup-tower/rules.js");
const still = { left: false, right: false };
function frames(g, n, input) { const events = []; for (let i = 0; i < n && !g.over; i++) T.step(g, input || still, events); return events; }
function started(seed) { const g = T.newGame(seed); g.started = true; return g; }

test("the tower is the same for the same seed, with a landing saucer every 25 floors", () => {
  for (let n = 0; n < 200; n++) assert.deepEqual(T.floorAt(77, n), T.floorAt(77, n));
  assert.equal(T.floorAt(77, 0).kind, "ground");
  assert.equal(T.floorAt(77, 25).kind, "saucer");
  assert.equal(T.floorAt(77, 50).kind, "saucer");
  for (let n = 1; n < 400; n++) {
    const f = T.floorAt(77, n);
    assert.ok(f.x >= T.WALL && f.x + f.w <= T.W - T.WALL, "floor " + n + " stays inside the walls");
    if (n < 15) assert.equal(f.kind === "cup" || f.kind === "saucer", true);
  }
  assert.notDeepEqual(T.floorAt(77, 3), T.floorAt(78, 3));
});

test("nothing moves until the game starts", () => {
  const g = T.newGame(5);
  frames(g, 60);
  assert.equal(g.frames, 0);
  assert.equal(g.y, 0);
});

test("standing still, Lumi bounces on the ground forever", () => {
  const g = started(5);
  const events = frames(g, 600);
  assert.equal(g.over, false);
  assert.ok(events.filter((e) => e.type === "bounce").length >= 10);
  assert.ok(g.y >= 0);
});

test("a wall kicks her back faster than she hit it", () => {
  const g = started(5);
  g.vx = -6; g.x = T.WALL + 2;
  const events = frames(g, 1);
  assert.ok(events.some((e) => e.type === "wall"));
  assert.ok(g.vx > 6);
});

test("landing two or more floors up builds a combo; a short hop ends it", () => {
  const g = started(9), events = [];
  g.landed = 3;
  const f = T.floorAt(9, 5);
  g.x = T.platformX(f, 0) + f.w / 2; g.y = 5 * T.GAP + 1; g.vy = -2;
  T.step(g, still, events);
  assert.equal(g.landed, 5);
  assert.equal(g.combo, 1);
  const f2 = T.floorAt(9, 7);
  g.x = T.platformX(f2, g.frames) + f2.w / 2; g.y = 7 * T.GAP + 1; g.vy = -2;
  T.step(g, still, events);
  assert.equal(g.combo, 2);
  assert.ok(events.some((e) => e.type === "combo" && e.combo === 2));
  const f3 = T.floorAt(9, 8);
  g.x = T.platformX(f3, g.frames) + f3.w / 2; g.y = 8 * T.GAP + 1; g.vy = -2;
  T.step(g, still, events);
  assert.equal(g.combo, 0);
  assert.ok(events.some((e) => e.type === "combo-end" && e.combo === 2));
});

test("a cracked cup takes one bounce and is gone", () => {
  let seed = 1, n = 0;
  outer: for (seed = 1; seed < 500; seed++) for (n = 30; n < 120; n++) if (T.floorAt(seed, n).kind === "cracked") break outer;
  const g = started(seed), f = T.floorAt(seed, n);
  g.landed = n - 1; g.best = n - 1;
  g.x = T.platformX(f, 0) + f.w / 2; g.y = n * T.GAP + 1; g.vy = -2;
  const events = frames(g, 1);
  assert.ok(events.some((e) => e.type === "crack"));
  assert.equal(g.broken[n], true);
});

test("from floor 5 the tower rises, and falling below the view ends the run", () => {
  const g = started(5);
  g.best = 5; g.landed = 5; g.y = 5 * T.GAP; g.camera = 5 * T.GAP - 200;
  const before = g.camera;
  frames(g, 10);
  assert.ok(g.camera > before + 5);
  g.y = g.camera - 100; g.vy = -5;                         // well below the bottom of the view
  const events = frames(g, 1);
  assert.equal(g.over, true);
  assert.ok(events.some((e) => e.type === "over"));
});

test("the view glides up after a big hop instead of jumping", () => {
  const g = started(1);
  g.best = 20; g.landed = 20; g.camera = 20 * T.GAP - 120;
  const f = T.floorAt(1, 24);                                // land four floors up in one go
  g.x = T.platformX(f, g.frames) + f.w / 2; g.y = 24 * T.GAP + 1; g.vy = -2;
  let biggest = 0;
  for (let i = 0; i < 90 && !g.over; i++) {
    const before = g.camera;
    T.step(g, still, []);
    biggest = Math.max(biggest, g.camera - before);
  }
  assert.equal(g.landed >= 24, true);
  assert.ok(biggest < 50, "the view moved " + biggest + " px in one frame");
  assert.ok(g.camera > 22 * T.GAP);                          // and it still got there
});

test("the live board others see stays in bounds", () => {
  const b = T.board(started(3));
  assert.equal(b.points.length, 2);
  assert.ok(b.points.every((v) => v >= 0 && v <= 1));
  assert.equal(b.alive, true);
});
