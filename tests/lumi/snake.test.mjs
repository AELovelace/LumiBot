// Snake's rules (static/games/snake/rules.js): food from the seed, moving, eating, turning, dying, and the turn log the
// server replays (mnemerynne/arcade.py snake_replay; test_arcade.py checks the two agree).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const S = createRequire(import.meta.url)("../../public/lumi/snake/rules.js");

test("a new game: three long at the middle, heading right, one food placed by the seed", () => {
  const g = S.newGame(2024);
  assert.deepEqual(g.body, [[10, 7], [9, 7], [8, 7]]);
  assert.equal(g.heading, 0);
  assert.ok(g.food && g.board[g.food[0]][g.food[1]] === g.food[2]);
  assert.deepEqual(S.newGame(2024).food, g.food);         // the same seed, the same food
});

test("straight ahead reaches the right wall on the tenth move", () => {
  const g = S.newGame(5);
  for (let i = 0; i < 9; i++) S.step(g, 0);
  assert.equal(g.alive, true);
  S.step(g, 0);
  assert.equal(g.alive, false);
  assert.equal(g.moves, 10);
});

test("turning straight back is ignored, and only real turns are logged", () => {
  const g = S.newGame(5);
  S.step(g, 2);                                            // left, while heading right: ignored
  assert.equal(g.heading, 0);
  S.step(g, 1);                                            // down: a real turn on move 2
  S.step(g, 1);
  assert.deepEqual(g.turns, [[2, 1]]);
});

test("eating scores the food's points, grows the snake and places the next food", () => {
  const g = S.newGame(9);
  const kind = 3;                                          // a yellow: five points
  g.board[g.food[0]][g.food[1]] = 0;                       // move the food right in front of the head
  g.food = [11, 7, kind]; g.board[11][7] = kind;
  S.step(g, 0);
  assert.equal(g.score, S.POINTS[kind]);
  assert.equal(g.body.length, 4);
  assert.ok(g.food && !(g.food[0] === 11 && g.food[1] === 7));
});

test("chasing your own tail is allowed; biting your body is not", () => {
  const g = S.newGame(1);
  g.body = [[5, 5], [5, 6], [4, 6], [4, 5]]; g.heading = 3;
  g.board.forEach((col) => col.fill(0));
  g.body.forEach(([x, y]) => (g.board[x][y] = 1));
  g.food = [15, 1, 2]; g.board[15][1] = 2;
  S.step(g, 2);                                            // into (4,5), where the tail is leaving
  assert.equal(g.alive, true);
  assert.equal(g.board[4][5], 1);                          // the head's cell stays filled
  const h = S.newGame(1);
  h.body = [[5, 5], [5, 6], [4, 6], [4, 5], [4, 4]]; h.heading = 3;
  h.board.forEach((col) => col.fill(0));
  h.body.forEach(([x, y]) => (h.board[x][y] = 1));
  h.food = [15, 1, 2]; h.board[15][1] = 2;
  S.step(h, 2);                                            // (4,5) is body, not the tail this time
  assert.equal(h.alive, false);
});

test("the live board others see: the body as fractions, head first", () => {
  const b = S.board(S.newGame(3));
  assert.equal(b.points.length, 6);
  assert.deepEqual(b.points.slice(0, 2), [10.5 / 20, 7.5 / 15]);
  assert.equal(b.length, 3);
});
