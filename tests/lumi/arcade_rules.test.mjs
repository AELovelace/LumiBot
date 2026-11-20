// The arcade's server-side rules (src/lumi/arcade/arcade.js, erinne tests/test_arcade.py "the rules"): Breakout levels
// from the seed and claims bounded by them, Snake replayed exactly, food kinds not streaky, Teacup Tower bounded by time,
// and the page's rules.js and the server agreeing (they share code, so the replay must match a played page game).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
boot();                                                                   // modules need the economy DB open
const arcade = require("../../src/lumi/arcade/arcade.js");               // the server's checks
const B = require("../../public/lumi/breakout/rules.js");                 // the page's Breakout rules
const S = require("../../public/lumi/snake/rules.js");                    // the page's Snake rules

// assert.throws for a LumiError with a given HTTP status.
function refusedWith(fn, status) {
  assert.throws(fn, (e) => e.name === "LumiError" && e.status === status); // erinne Refused(…, status)
}

test("breakout levels come from the seed", () => {
  const first = arcade.breakoutField(424242, 1);
  assert.deepEqual(first, arcade.breakoutField(424242, 1));               // same seed, same level
  assert.notDeepEqual(first, arcade.breakoutField(424242, 2));            // next level differs
  for (const seed of [1, 7, 99999, arcade.MODULUS - 2]) {
    for (const level of [1, 2, 3, 50]) {
      const field = arcade.breakoutField(seed, level);
      assert.equal(field.length, 108);                                    // 18 x 6
      assert.ok(field.filter(Boolean).length >= 30);                      // never thin
      assert.ok(field.every((c) => c >= 0 && c <= 6));                    // colours 0-6
    }
  }
});

test("Minstd and levelSeed match erinne's integer maths", () => {
  const rng = new arcade.Minstd(arcade.levelSeed(31337, 1));
  const a = rng.between(2, 3);
  assert.ok(a === 2 || a === 3);                                          // inclusive range
  assert.equal(new arcade.Minstd(0).state, 1);                            // a zero seed becomes 1
  assert.equal(arcade.levelSeed(5, 1), (5 * 1664525 + 1013904223) % arcade.MODULUS); // GameMaker formula
});

test("breakout claims must fit the levels and the time", () => {
  const seed = 31337;
  const one = arcade.breakoutBricks(seed, 1);
  const two = arcade.breakoutBricks(seed, 2);
  assert.equal(arcade.checkBreakout(seed, one + 3, 2, 600).distance, 100 + one + 3);
  refusedWith(() => arcade.checkBreakout(seed, one - 1, 2, 600), 422);    // level 2 without clearing level 1
  refusedWith(() => arcade.checkBreakout(seed, one + two + 1, 2, 600), 422); // more bricks than level 2 holds
  refusedWith(() => arcade.checkBreakout(seed, 40, 1, 2), 422);           // forty bricks in two seconds
  refusedWith(() => arcade.checkBreakout(seed, 0, 501, 600), 422);        // no such level
});

test("snake plays again exactly", () => {
  const straight = arcade.snakeReplay(5, [], 9);
  assert.ok(straight.alive);
  assert.equal(straight.length, 3);
  const walled = arcade.snakeReplay(5, [], 10);                           // head at column 10, heading right: the wall at move 10
  assert.deepEqual(walled, { score: straight.score, length: walled.length, alive: false, died: 10 });
  refusedWith(() => arcade.snakeReplay(5, [[1, 2]], 3), 422);             // straight back into itself
});

test("snake finds and eats its food; check_snake pays the replay's score", () => {
  const seed = 2024;                                                      // a fixed game
  const turns = [];                                                       // the turns we make
  let moves = 0, score = 0, heading = 0, index = 0;                       // walk state
  const body = arcade.SNAKE_START.map((c) => [...c]);                     // head first
  const board = Array.from({ length: arcade.SNAKE_W }, () => new Array(arcade.SNAKE_H).fill(0)); // empty board
  for (const [x, y] of body) board[x][y] = 1;                             // the body on it
  let food = arcade.snakeFood(seed, index++, board);                      // the first food
  board[food[0]][food[1]] = food[2];                                      // placed
  while (moves < 300 && score < 12) {                                     // a simple greedy walk
    const [hx, hy] = body[0];                                             // the head
    let want = food[0] > hx ? 0 : food[0] < hx ? 2 : food[1] > hy ? 1 : 3; // towards the food
    if (want === (heading + 2) % 4) want = hy < arcade.SNAKE_H - 1 ? 1 : 3; // never straight back
    const nx = hx + arcade.STEPS[want][0], ny = hy + arcade.STEPS[want][1]; // the next cell
    const tail = body[body.length - 1];                                   // the last dancer
    if (!(nx >= 0 && nx < arcade.SNAKE_W && ny >= 0 && ny < arcade.SNAKE_H) || (board[nx][ny] === 1 && !(nx === tail[0] && ny === tail[1]))) break; // would die: stop
    moves += 1;                                                           // one move
    if (want !== heading) { turns.push([moves, want]); heading = want; }  // record a turn
    const ate = board[nx][ny] in arcade.FOOD_POINTS;                      // food there?
    if (!ate) { const t = body.pop(); board[t[0]][t[1]] = 0; } else score += arcade.FOOD_POINTS[board[nx][ny]]; // move the tail or score
    body.unshift([nx, ny]);                                               // the new head
    board[nx][ny] = 1;                                                    // on the board
    if (ate) { food = arcade.snakeFood(seed, index++, board); board[food[0]][food[1]] = food[2]; } // the next food
  }
  const played = arcade.snakeReplay(seed, turns, moves);                  // the server's replay
  assert.ok(score > 0);                                                   // the walk ate something
  assert.equal(played.score, score);                                      // same score
  assert.ok(played.alive);                                                // still dancing
  assert.equal(arcade.checkSnake(seed, turns, moves, false, 600).score, score); // the check pays the replay's score
  refusedWith(() => arcade.checkSnake(seed, turns, moves, true, 600), 422); // it says it died; it didn't
  refusedWith(() => arcade.checkSnake(seed, turns, moves, false, 1), 422);  // all those moves in one second
  refusedWith(() => arcade.checkSnake(seed, [[3, 1], [2, 0]], 5, false, 600), 422); // out of order
});

test("the page and the server play the same games", () => {
  const game = S.newGame(2024);                                           // a page game
  for (let i = 0; i < 40; i++) { S.step(game, i % 7 === 0 ? (game.heading + 1) % 4 : game.heading); if (!game.alive) break; }
  const played = arcade.snakeReplay(2024, game.turns, game.moves);        // the server's replay
  assert.deepEqual([played.score, played.length, played.alive], [game.score, game.body.length, game.alive]);
  for (const seed of [1, 7, 31337, 2147483645]) for (const level of [1, 2, 9]) assert.deepEqual(arcade.breakoutField(seed, level), B.field(seed, level));
});

test("snake food kinds are not streaky (70 / 22 / 8)", () => {
  const empty = Array.from({ length: arcade.SNAKE_W }, () => new Array(arcade.SNAKE_H).fill(0));
  const kinds = [];
  for (let seed = 1; seed < 2147483647; seed += Math.floor(2147483647 / 2000)) {
    kinds.push(Array.from({ length: 10 }, (_, i) => arcade.snakeFood(seed, i, empty)[2]));
  }
  assert.ok(kinds.filter((g) => g.some((k) => k !== 2)).length / kinds.length > 0.94);
  const flat = kinds.flat();
  const share = (k) => flat.filter((x) => x === k).length / flat.length;
  assert.ok(share(2) > 0.66 && share(2) < 0.74);
  assert.ok(share(4) > 0.05 && share(4) < 0.11);
});

test("teacup tower climbs must fit the time", () => {
  assert.deepEqual(arcade.checkTower(30, 60), { score: 30, distance: 30 });
  assert.deepEqual(arcade.checkTower(5, 0), { score: 5, distance: 5 });   // the first few floors take no time to check
  refusedWith(() => arcade.checkTower(200, 10), 422);                     // twenty floors a second
});
