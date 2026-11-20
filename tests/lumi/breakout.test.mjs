// Breakout's rules (static/games/breakout/rules.js): levels from the seed, the ball against walls, bat and bricks,
// power-ups, lives and levels. The server's copy of the level builder is checked against this one in test_arcade.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const R = createRequire(import.meta.url)("../../public/lumi/breakout/rules.js");
const idle = { left: false, right: false, target: null, launch: false };
function frames(g, n, input) { const events = []; for (let i = 0; i < n && !g.over; i++) R.step(g, input || idle, events); return events; }

test("a level is the same every time for the same seed, and never thin", () => {
  for (const seed of [1, 42, 99999, R.M - 2]) {
    for (const level of [1, 2, 3, 40]) {
      const field = R.field(seed, level);
      assert.deepEqual(field, R.field(seed, level));
      assert.equal(field.length, R.COLS * R.ROWS);
      assert.ok(field.filter(Boolean).length >= 30);
      assert.ok(field.every((c) => c >= 0 && c <= 6));
    }
  }
  assert.notDeepEqual(R.field(42, 1), R.field(42, 2));
});

test("the ball waits on the bat until it's launched, then leaves upward", () => {
  const g = R.newGame(7);
  frames(g, 30);
  assert.equal(g.balls[0].go, false);
  assert.equal(g.balls[0].x, g.bat);
  frames(g, 1, { ...idle, launch: true });
  assert.equal(g.balls[0].go, true);
  assert.ok(g.balls[0].vy < 0);
});

test("in a race the ball launches by itself", () => {
  const g = R.newGame(7, { autoLaunch: 90 });
  frames(g, 95);
  assert.equal(g.balls[0].go, true);
});

test("held keys move the bat seven pixels a frame, and it stops at the walls", () => {
  const g = R.newGame(7);
  frames(g, 10, { ...idle, left: true });
  assert.equal(g.bat, R.W / 2 - 70);
  frames(g, 200, { ...idle, left: true });
  assert.equal(g.bat, R.batHalf(g));
});

test("a ball that falls past the bat costs a life, and the third ends the game", () => {
  const g = R.newGame(3);
  for (let life = 3; life >= 1; life--) {
    const ball = g.balls[0];
    Object.assign(ball, { go: true, x: 10, y: R.H - 20, vx: 0, vy: 6 });
    g.bat = R.W - 40;                                    // far from the ball
    const events = frames(g, 10, { ...idle, target: R.W - 40 });
    assert.ok(events.some((e) => e.type === "life"));
  }
  assert.equal(g.over, true);
  assert.equal(g.lives, 0);
});

test("a ball dropping onto the bat bounces back up", () => {
  const g = R.newGame(3);
  Object.assign(g.balls[0], { go: true, x: g.bat, y: R.BAT_Y - 40, vx: 0, vy: 4 });
  const events = frames(g, 15);
  assert.ok(events.some((e) => e.type === "bounce"));
  assert.ok(g.balls[0].vy < 0);
  assert.equal(g.lives, 3);
});

test("breaking a brick scores a point; clearing the level builds the next", () => {
  const g = R.newGame(11);
  const index = g.bricks.findIndex(Boolean), rect = R.brickRect(index);
  g.bricks = g.bricks.map((c, i) => (i === index ? c : 0));   // one brick left
  Object.assign(g.balls[0], { go: true, x: rect.x + rect.w / 2, y: rect.y + rect.h + 12, vx: 0, vy: -4 });
  const events = frames(g, 10);
  assert.equal(g.score, 1);
  assert.ok(events.some((e) => e.type === "brick"));
  assert.ok(events.some((e) => e.type === "level"));
  assert.equal(g.level, 2);
  assert.deepEqual(g.bricks, R.field(11, 2));
});

test("the live board others see stays in bounds", () => {
  const g = R.newGame(5);
  const board = R.board(g);
  assert.equal(board.bricks.length, 108);
  assert.match(board.bricks, /^[0-6]+$/);
  assert.ok(board.balls.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
});
