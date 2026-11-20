/* Snake's rules, ported from Doll's GameMaker arcade (Roulette: objSnakeController): a 20 x 15 grid, one move every 8
   frames, three kinds of food. On the Games shelf it is Lumi Conga (2026-11-11): the snake is a conga line of Lumis
   and the food is Lumis waiting to join, so the body also remembers each dancer's kind (`kinds`, head first: 0 is the
   player's own Lumi leading, 2-4 the colours they joined in). Only for drawing: the score and the server's replay
   (mnemerynne/arcade.py) never look at it. No drawing here, so Node can test it (tests/js/snake.test.mjs), and
   mnemerynne/arcade.py plays every run again with the same arithmetic before it pays: the page sends only the moves it
   turned on (game.turns), never its score.

   Food comes from the run's seed (the GameMaker showdown formula), so the server knows where each one appeared.
   One fix over the original: the tail moves on before the head takes its cell, so a snake chasing its own tail never
   leaves an empty gap under its head (food could appear there before). */
(function (root) {
  "use strict";

  const M = 2147483647;
  const W = 20, H = 15;
  const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1]];       // directions 0-3: right, down, left, up
  const POINTS = { 2: 1, 3: 5, 4: 10 };                     // red, yellow, aqua
  const FRAMES_PER_MOVE = 10;                               // 6 moves a second at 60 frames a second (8 until 2026-11-11:
                                                            // the bigger solo board made 7.5 feel too quick)

  function mix(seed, index, salt) {                         // snakeSeedValue from the GameMaker game
    const v = (Math.max(1, Math.abs(Math.trunc(seed))) * 1664525 + (Math.max(0, Math.trunc(index)) + 1) * 1013904223 +
               Math.max(1, Math.abs(Math.trunc(salt))) * 69069) % M;
    return v > 0 ? v : v + M - 1;
  }

  function scramble(v) {                                    // xorshift32: mix's numbers climb in even steps, so neighbouring
    let u = v >>> 0;                                         // foods rolled almost alike (a whole game of +1 Lumis); this
    u = (u ^ (u << 13)) >>> 0;                               // shuffles the bits so every roll is its own (arcade.scramble)
    u = (u ^ (u >>> 17)) >>> 0;
    return (u ^ (u << 5)) >>> 0;
  }

  function food(seed, index, board) {                       // where the index-th food goes, and its kind; null on a full board
    const empty = [];
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (board[x][y] === 0) empty.push([x, y]);
    if (!empty.length) return null;
    const at = empty[mix(seed, index, 17) % empty.length], roll = scramble(mix(seed, index, 53)) % 100;   // scrambled since 2026-11-11
    return [at[0], at[1], roll < 70 ? 2 : roll < 92 ? 3 : 4];
  }

  function newGame(seed) {                                  // head at (10, 7) heading right, three long, first food placed
    const g = { seed: seed, board: Array.from({ length: W }, function () { return new Array(H).fill(0); }),
                body: [[10, 7], [9, 7], [8, 7]], kinds: [0, 2, 2], heading: 0, score: 0, alive: true, moves: 0, turns: [], foodIndex: 0, food: null };
    g.body.forEach(function (c) { g.board[c[0]][c[1]] = 1; });
    place(g);
    return g;
  }

  function place(g) {                                       // the next food; false when there's no room left
    const f = food(g.seed, g.foodIndex++, g.board);
    g.food = f;
    if (f) g.board[f[0]][f[1]] = f[2];
    return !!f;
  }

  function step(g, dir, events) {                           // one move, turning to `dir` first unless that's straight back
    if (!g.alive) return;
    const move = g.moves + 1;
    if (dir !== g.heading && dir !== (g.heading + 2) % 4 && dir >= 0 && dir <= 3) {
      g.heading = dir;
      g.turns.push([move, dir]);                            // what the server replays
    }
    g.moves = move;
    const head = g.body[0], x = head[0] + STEPS[g.heading][0], y = head[1] + STEPS[g.heading][1];
    if (x < 0 || x >= W || y < 0 || y >= H) { g.alive = false; if (events) events.push({ type: "die" }); return; }
    const cell = g.board[x][y], ate = !!POINTS[cell], tail = g.body[g.body.length - 1];
    if (cell === 1 && !(x === tail[0] && y === tail[1] && !ate)) { g.alive = false; if (events) events.push({ type: "die" }); return; }
    if (!ate) { g.board[tail[0]][tail[1]] = 0; g.body.pop(); }
    g.body.unshift([x, y]);
    g.board[x][y] = 1;
    if (ate) {
      g.kinds.push(cell);                                   // she joins the end of the line, in her own colour
      g.score += POINTS[cell];
      if (events) events.push({ type: "eat", kind: cell, x: x, y: y });
      if (!place(g)) { g.alive = false; if (events) events.push({ type: "die" }); }
    }
  }

  function board(g) {                                       // the live board other players see (web/games.py Board)
    const points = [];
    g.body.slice(0, 300).forEach(function (c) { points.push((c[0] + 0.5) / W, (c[1] + 0.5) / H); });
    return { score: g.score, length: g.body.length, alive: g.alive, points: points, food: g.food ? g.food.slice() : [],
             kinds: g.kinds.slice(0, 300).map(function (k) { return k || 1; }).join("") };   // 1 is the leader (web/games.py Board)
  }

  function distance(g) { return g.score + Math.max(0, g.body.length - 3) * 5; }   // how a showdown ranks a run

  const API = { M: M, W: W, H: H, STEPS: STEPS, POINTS: POINTS, FRAMES_PER_MOVE: FRAMES_PER_MOVE, mix: mix, scramble: scramble, food: food,
                newGame: newGame, step: step, board: board, distance: distance };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.SnakeRules = API;
})(this);
