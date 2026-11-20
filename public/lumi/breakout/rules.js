/* Breakout's rules, ported from Doll's GameMaker arcade (Roulette: scripts/Breakout, objBall, objBat, objBrick,
   objPowerUp): the level builder and one frame of play. No drawing and no page here, so Node can test it
   (tests/js/breakout.test.mjs) and the server's copy of the level builder (mnemerynne/arcade.py) can be checked
   against it number for number.

   The arena is 640 x 480 (the GameMaker room's play area); everything moves in pixels per frame at 60 frames a second.
   Levels come from the run's seed, which the server hands out, so it can check a claimed score against them.
   Fixes over the original: the ball only bounces off the bat on its way down (it could stick inside it), it leaves
   the top wall instead of jittering there, and power-ups that fall past the bat are cleared. */
(function (root) {
  "use strict";

  const M = 2147483647;                                    // 2**31 - 1; every product below stays exact in a double
  const COLS = 18, ROWS = 6, CELL = 32, BRICK_H = 16, ORIGIN = 32;   // the brick grid inside the arena
  const W = 640, H = 480;                                  // the arena
  const BAT_W = 64, BAT_H = 16, BAT_SPEED = 7, BAT_Y = H - 16;
  const RADIUS = 7.5, SPAWN_Y = H - 64, MAX_SPEED = 12, POWER_FRAMES = 600;
  const SHAPES = [                                         // [roll from, roll to, width, height, cells], as Breakout.gml
    [0, 4, 8, 3, cells(8, 3, function () { return true; })],                                   // rectangle
    [5, 8, 6, 5, cells(6, 5, function (c, r) { return r === 0 || r === 4 || c === 0 || c === 5; })],   // hollow box
    [9, 11, 7, 5, [[1, 0], [2, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
                   [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [2, 3], [3, 3], [4, 3], [3, 4]]],           // heart
    [12, 15, 7, 6, [[3, 0], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
                    [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [4, 4], [2, 5], [4, 5]]],          // star
  ];

  function cells(width, height, keep) {                    // every [column, row] of a width x height block that `keep` keeps
    const out = [];
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) if (keep(c, r)) out.push([c, r]);
    return out;
  }

  function levelSeed(seed, level) {                        // breakoutLevelSeed from the GameMaker game
    const v = (Math.max(1, Math.abs(Math.trunc(seed))) * 1664525 + Math.max(1, Math.trunc(level)) * 1013904223) % M;
    return v > 0 ? v : v + M - 1;
  }

  function minstd(seed) {                                  // Park and Miller's generator, as arcade.Minstd
    let state = (seed % M) || 1;
    return { between: function (low, high) { state = state * 48271 % M; return low + state % (high - low + 1); } };
  }

  function field(seed, level) {                            // a level: 108 cells, 0 empty, else colour 1-6 (arcade.breakout_field)
    const rng = minstd(levelSeed(seed, level)), grid = new Array(COLS * ROWS).fill(0);
    const mark = function (c, r) { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r * COLS + c] = 1; };
    const count = function () { return grid.reduce(function (a, b) { return a + b; }, 0); };
    const shapes = rng.between(2, 3);
    for (let s = 0; s < shapes; s++) {
      const roll = rng.between(0, 15), shape = SHAPES.find(function (x) { return x[0] <= roll && roll <= x[1]; });
      const col = rng.between(0, Math.max(0, COLS - shape[2])), row = rng.between(0, Math.max(0, ROWS - shape[3]));
      shape[4].forEach(function (cell) { mark(col + cell[0], row + cell[1]); });
    }
    while (count() < 30) {                                 // topped up with small blocks
      const w = rng.between(3, 6), h = rng.between(1, 2), col = rng.between(0, COLS - w), row = rng.between(0, ROWS - h);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) mark(col + c, row + r);
    }
    return grid.map(function (cell) { return cell ? rng.between(1, 6) : 0; });
  }

  function brickRect(index) {                              // a brick's place in the arena
    return { x: ORIGIN + (index % COLS) * CELL, y: ORIGIN + Math.floor(index / COLS) * CELL, w: CELL, h: BRICK_H };
  }

  function speedOf(b) { return Math.hypot(b.vx, b.vy); }
  function setSpeed(b, s) { const now = speedOf(b) || 1; b.vx *= s / now; b.vy *= s / now; }
  function aim(b, degrees, s) { const a = degrees * Math.PI / 180; b.vx = Math.cos(a) * s; b.vy = -Math.sin(a) * s; }   // GameMaker: 90 is up
  function radius(b) { return b.big > 0 ? RADIUS * 2 : RADIUS; }

  function newBall(x, main) {
    return { x: x, y: SPAWN_Y, vx: 0, vy: 0, go: false, main: main, big: 0, launch: 45 + Math.random() * 90 };
  }

  function newGame(seed, options) {                        // a run from its seed; options.autoLaunch: frames before the ball goes by itself
    const g = { seed: seed, level: 1, score: 0, lives: 3, bricks: field(seed, 1), bat: W / 2, wide: 0,
                balls: [], powerUps: [], over: false, frames: 0, waiting: 0, autoLaunch: (options && options.autoLaunch) || 0 };
    g.balls.push(newBall(g.bat, true));
    return g;
  }

  function batHalf(g) { return BAT_W * (g.wide > 0 ? 1.5 : 1) / 2; }

  function overlaps(b, r) {                                // circle against rectangle
    const nx = Math.max(r.x, Math.min(b.x, r.x + r.w)), ny = Math.max(r.y, Math.min(b.y, r.y + r.h));
    return (b.x - nx) * (b.x - nx) + (b.y - ny) * (b.y - ny) < radius(b) * radius(b);
  }

  function nearestBrick(g, b) {
    let best = -1, bestD = Infinity;
    g.bricks.forEach(function (colour, i) {
      if (!colour) return;
      const r = brickRect(i), d = Math.hypot(r.x + r.w / 2 - b.x, r.y + r.h / 2 - b.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function steer(g, b) {                                   // head for the nearest brick at speed 5 (bo_endTargeting, power-up 3)
    const i = nearestBrick(g, b);
    if (i < 0) return;
    const r = brickRect(i), dx = r.x + r.w / 2 - b.x, dy = r.y + r.h / 2 - b.y, d = Math.hypot(dx, dy) || 1;
    b.vx = dx / d * 5; b.vy = dy / d * 5;
  }

  function resetBalls(g) {                                 // a lost life or a new level: one ball back on the bat
    g.balls = [newBall(g.bat, true)];
    g.powerUps = [];
    g.waiting = 0;
  }

  function bricksLeft(g) { return g.bricks.reduce(function (n, c) { return n + (c ? 1 : 0); }, 0); }

  function powerUp(g, kind, events) {                      // what each falling icon does once the bat catches it
    events.push({ type: "power", kind: kind });
    if (kind === 0) g.wide = POWER_FRAMES;                 // a wider bat for ten seconds
    else if (kind === 1) {                                 // multiball: another ball beside each main one
      const sources = g.balls.filter(function (b) { return b.main && b.go; });
      (sources.length ? sources : g.balls.filter(function (b) { return b.go; }).slice(0, 1)).forEach(function (src) {
        if (g.balls.length >= 8) return;
        const extra = { x: src.x, y: src.y, vx: 0, vy: 0, go: true, main: false, big: src.big, launch: src.launch };
        aim(extra, src.launch, 3);
        g.balls.push(extra);
      });
    } else if (kind === 2) g.balls.forEach(function (b) { b.big = POWER_FRAMES; });   // bigger balls for ten seconds
    else if (kind === 3) g.balls.forEach(function (b) { if (b.go) steer(g, b); });   // every ball aims at a brick
    else g.balls.forEach(function (b) { if (b.go) setSpeed(b, 3); });                // everything slows right down
  }

  function launch(b) { b.go = true; aim(b, b.launch, 3); }

  function step(g, input, events) {                        // one frame. input: {left, right, target (arena x), launch}
    if (g.over) return;
    g.frames++;
    if (g.wide > 0) g.wide--;
    const half = batHalf(g);
    if (input.left) g.bat -= BAT_SPEED;
    if (input.right) g.bat += BAT_SPEED;
    if (!input.left && !input.right && typeof input.target === "number") {
      const gap = input.target - g.bat;
      g.bat += Math.max(-BAT_SPEED, Math.min(BAT_SPEED, gap));   // a pointer or remote: glide there at bat speed
    }
    g.bat = Math.max(half, Math.min(W - half, g.bat));
    const bat = { x: g.bat - half, y: BAT_Y - BAT_H / 2, w: half * 2, h: BAT_H };
    let resting = false;
    g.balls.forEach(function (b) {
      if (b.big > 0) b.big--;
      if (!b.go) {
        b.x = g.bat; b.y = SPAWN_Y; resting = true;
        if (input.launch || (g.autoLaunch && g.waiting >= g.autoLaunch)) { launch(b); events.push({ type: "launch" }); }
      }
    });
    g.waiting = resting ? g.waiting + 1 : 0;
    const lost = [];
    g.balls.forEach(function (b) { if (b.go && move(g, b, bat, events)) lost.push(b); });
    lost.forEach(function (b) {
      g.balls.splice(g.balls.indexOf(b), 1);
      if (b.main) events.push({ type: "lost" });
    });
    if (!g.balls.length) {                                 // the last ball is gone
      g.lives--;
      events.push({ type: "life" });
      if (g.lives <= 0) { g.over = true; events.push({ type: "over" }); return; }
      resetBalls(g);
    }
    g.powerUps = g.powerUps.filter(function (p) {          // falling icons: caught by the bat, or gone off the bottom
      p.y += 5;
      if (p.y + 16 >= bat.y && p.y <= bat.y + bat.h && p.x + 32 >= bat.x && p.x <= bat.x + bat.w) { powerUp(g, p.kind, events); return false; }
      return p.y < H;
    });
    if (!bricksLeft(g)) {                                  // cleared: the next level, from the same seed
      g.level++;
      g.bricks = field(g.seed, g.level);
      resetBalls(g);
      events.push({ type: "level", level: g.level });
    }
  }

  function move(g, b, bat, events) {                       // move one ball through walls, bat and bricks; true when it's lost
    const s = speedOf(b), parts = Math.max(1, Math.ceil(s / 6));   // small steps, so a fast ball can't skip a brick
    let bounced = false;
    for (let i = 0; i < parts; i++) {
      const px = b.x, py = b.y, r = radius(b);
      b.x += b.vx / parts; b.y += b.vy / parts;
      if (b.x - r < 0) { b.x = r; b.vx = Math.abs(b.vx); bounced = true; }
      if (b.x + r > W) { b.x = W - r; b.vx = -Math.abs(b.vx); bounced = true; }
      if (b.y - r < 0) { b.y = r; b.vy = Math.abs(b.vy); bounced = true; }
      if (b.y + r > H) return true;                        // off the bottom
      if (b.vy > 0 && overlaps(b, bat)) {                  // the bat: the angle depends on where it hit, from a point under the bat
        const keep = speedOf(b), px0 = g.bat, py0 = BAT_Y + 32;
        const dir = Math.atan2(-(b.y - py0), b.x - px0), dist = Math.hypot(b.x - px0, b.y - py0);
        b.vy = -b.vy;
        b.vx += Math.cos(dir) * dist / 5; b.vy += -Math.sin(dir) * dist / 5;
        if (b.vy >= -0.5) b.vy = -Math.max(0.5, Math.abs(b.vy));   // always away from the bat
        setSpeed(b, keep);
        b.y = bat.y - r;
        if (bricksLeft(g) <= 5) steer(g, b);
        events.push({ type: "bounce" });
        continue;
      }
      const hit = g.bricks.findIndex(function (colour, k) { return colour && overlaps(b, brickRect(k)); });
      if (hit >= 0) {                                      // a brick: back out, bounce off the side it was hit on, break it
        const rect = brickRect(hit);
        b.x = px; b.y = py;
        if (py + r <= rect.y || py - r >= rect.y + rect.h) b.vy = -b.vy; else b.vx = -b.vx;
        if (speedOf(b) < MAX_SPEED) setSpeed(b, Math.min(MAX_SPEED, speedOf(b) + 0.1));
        events.push({ type: "brick", x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, colour: g.bricks[hit] });
        g.bricks[hit] = 0;
        g.score++;
        if (Math.random() < 1 / 3) g.powerUps.push({ x: rect.x, y: rect.y, kind: Math.floor(Math.random() * 5) });
        events.push({ type: "bounce" });
        break;
      }
    }
    if (bounced) {                                         // walls speed the ball up a little and nudge its angle
      const now = speedOf(b);
      setSpeed(b, now < MAX_SPEED ? Math.min(MAX_SPEED, now + 0.1) : now);
      const turn = (2 - Math.random() * 4) * Math.PI / 180, c = Math.cos(turn), sn = Math.sin(turn);
      const vx = b.vx * c - b.vy * sn; b.vy = b.vx * sn + b.vy * c; b.vx = vx;
      events.push({ type: "bounce" });
    }
    return false;
  }

  function board(g) {                                      // the live board other players see (web/games.py Board)
    return { score: g.score, level: g.level, lives: Math.max(0, g.lives), bat: g.bat / W, wide: g.wide > 0,
             balls: g.balls.slice(0, 8).map(function (b) { return [Math.max(0, Math.min(1, b.x / W)), Math.max(0, Math.min(1, b.y / H))]; }),
             bricks: g.bricks.join("") };
  }

  function distance(g) { return (g.level - 1) * 100 + g.score; }   // how a showdown ranks a run

  const API = { M: M, COLS: COLS, ROWS: ROWS, CELL: CELL, BRICK_H: BRICK_H, ORIGIN: ORIGIN, W: W, H: H, BAT_W: BAT_W,
                BAT_H: BAT_H, BAT_Y: BAT_Y, RADIUS: RADIUS, MAX_SPEED: MAX_SPEED, levelSeed: levelSeed, field: field, brickRect: brickRect,
                newGame: newGame, step: step, board: board, distance: distance, batHalf: batHalf, radius: radius,
                bricksLeft: bricksLeft };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.BreakoutRules = API;
})(this);
