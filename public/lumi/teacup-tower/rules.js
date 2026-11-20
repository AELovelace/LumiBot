/* Teacup Tower's rules: Lumi bounces up an endless tower of teacups. Our own game in the tower-climber genre (Doll's
   idea, 2026-11-10): no drawing and no page here, so Node can test it (tests/js/teacup_tower.test.mjs).

   - Lumi bounces by herself off any teacup she lands on; you only steer. The faster she's moving sideways, the
     higher she bounces, so a run-up carries her past several floors at once.
   - A hop that lands two or more floors higher starts or adds to a combo; a short hop (or three seconds) ends it.
   - The side walls kick her back a little faster than she hit them.
   - From floor 5 the tower starts rising on its own, faster every 30 seconds. Fall below the bottom and it's over.
   - Every 25th floor is a wide landing saucer. Higher up, some cups slide and some are cracked (one bounce each).

   World units are pixels, with height growing upward; the view is 640 x 480, like the other arcade games' arenas.
   The tower comes from the run's seed (integer arithmetic, so every racer's tower is the same). */
(function (root) {
  "use strict";

  const M = 2147483647;
  const W = 640, H = 480, GAP = 80;                         // the view, and the height between floors
  const GRAVITY = 0.4, BOUNCE = 10, SPEED_BOUNCE = 0.6;     // a standing bounce clears about one and a half floors
  const ACCEL = 0.55, MAX_VX = 8.5, FRICTION = 0.92, WALL_KICK = 1.12, WALL = 20;
  const RISE_FROM = 5, RISE_START = 0.6, RISE_STEP = 0.25, RISE_MAX = 3.5, RISE_EVERY = 1800;   // 1800 frames: 30 s
  const COMBO_FRAMES = 180, FEET = 18;                      // three seconds to keep a combo going; half Lumi's footprint
  const CAMERA_EASE = 0.125;                                // how much of the way the view catches up each frame

  function mix(seed, index, salt) {                         // the arcade's per-index number (arcade.mix)
    const v = (Math.max(1, Math.abs(Math.trunc(seed))) * 1664525 + (Math.max(0, Math.trunc(index)) + 1) * 1013904223 +
               Math.max(1, Math.abs(Math.trunc(salt))) * 69069) % M;
    return v > 0 ? v : v + M - 1;
  }

  function minstd(seed) {
    let state = (seed % M) || 1;
    return function (n) { state = state * 48271 % M; return state % n; };   // a whole number below n
  }

  function floorAt(seed, n) {                               // floor n: where its cup sits, how wide, and what kind
    if (n === 0) return { n: 0, x: 0, w: W, kind: "ground", amp: 0, speed: 0, phase: 0 };
    const roll = minstd(mix(seed, n, 29));
    if (n % 25 === 0) return { n: n, x: 80, w: W - 160, kind: "saucer", amp: 0, speed: 0, phase: 0 };   // a landing every 25 floors
    const w = Math.max(80, 240 - Math.floor(n * 1.1)) - 20 + roll(41);   // wide near the ground, narrower the higher you go
    const x = WALL + roll(W - 2 * WALL - w + 1);
    const pick = roll(100);
    const kind = n >= 30 && pick < 15 ? "cracked" : n >= 15 && pick < 35 ? "slide" : "cup";
    return { n: n, x: x, w: w, kind: kind, amp: kind === "slide" ? 60 + roll(80) : 0, speed: 1 + roll(3), phase: roll(400) };
  }

  function platformX(f, frame) {                            // a sliding cup goes to and fro (a triangle wave, no trig)
    if (!f.amp) return f.x;
    const span = f.amp * 2, t = (frame * f.speed / 2 + f.phase) % (span * 2), along = t < span ? t : span * 2 - t;
    return Math.max(WALL, Math.min(W - WALL - f.w, f.x - f.amp + along));
  }

  function newGame(seed) {
    return { seed: seed, x: W / 2, y: 0, vx: 0, vy: BOUNCE, camera: 0, best: 0, landed: 0, frames: 0, riseFrames: 0,
             rise: 0, broken: {}, combo: 0, comboFloors: 0, comboTimer: 0, bestCombo: 0, over: false, started: false };
  }

  function endCombo(g, events) {
    if (g.combo >= 2) events.push({ type: "combo-end", combo: g.combo, floors: g.comboFloors });
    g.combo = 0; g.comboFloors = 0; g.comboTimer = 0;
  }

  function step(g, input, events) {                         // one frame. input: {left, right} held
    if (g.over || !g.started) return;
    g.frames++;
    // Steering speeds her up to MAX_VX and no further; only a wall kick goes past it, and holding on keeps that speed.
    if (input.left && !input.right) g.vx = Math.max(g.vx - ACCEL, Math.min(g.vx, -MAX_VX));
    else if (input.right && !input.left) g.vx = Math.min(g.vx + ACCEL, Math.max(g.vx, MAX_VX));
    else g.vx *= FRICTION;
    g.vx = Math.max(-MAX_VX * 1.3, Math.min(MAX_VX * 1.3, g.vx));
    g.x += g.vx;
    if (g.x < WALL || g.x > W - WALL) {                     // a wall kicks her back, a little faster
      g.x = g.x < WALL ? WALL : W - WALL;
      g.vx = -g.vx * WALL_KICK;
      events.push({ type: "wall" });
    }
    const was = g.y;
    g.vy -= GRAVITY;
    g.y += g.vy;
    if (g.vy < 0) {                                         // falling: any cup she passes down through catches her
      for (let n = Math.floor(was / GAP); n >= Math.max(0, Math.ceil(g.y / GAP)); n--) {
        const top = n * GAP, f = floorAt(g.seed, n), left = platformX(f, g.frames);
        if (was >= top && g.y <= top && !g.broken[n] && g.x >= left - FEET && g.x <= left + f.w + FEET) {
          land(g, n, f, events);
          break;
        }
      }
    }
    if (g.comboTimer > 0 && --g.comboTimer === 0) endCombo(g, events);
    // Until floor RISE_FROM the view stays on the ground floor (a warm-up: a miss only drops her back down). After
    // that it follows where she last landed, with a floor and a half of room below so a missed hop can still land on
    // a cup, and never lets her go off the top of the screen.
    // The view glides toward where it should be (an eighth of the way each frame) rather than jumping there when she
    // lands a few floors up; only near the very top of the screen does it keep up with her at once.
    const target = Math.max(g.best >= RISE_FROM ? g.landed * GAP - GAP * 1.5 : 0, g.y - (H - 60));
    if (target > g.camera) g.camera += (target - g.camera) * CAMERA_EASE;
    g.camera = Math.max(g.camera, g.y - (H - 24));
    if (g.best >= RISE_FROM) {                              // and the tower rises by itself, faster every 30 s
      const rise = Math.min(RISE_MAX, RISE_START + RISE_STEP * Math.floor(g.riseFrames / RISE_EVERY));
      if (rise > g.rise && g.rise > 0) events.push({ type: "hurry" });
      g.rise = rise;
      g.riseFrames++;
      g.camera += rise;
    }
    if (g.y < g.camera - 30) {                              // below the bottom of the view
      g.over = true;
      endCombo(g, events);
      events.push({ type: "over" });
    }
  }

  function land(g, n, f, events) {
    g.y = n * GAP;
    g.vy = BOUNCE + Math.abs(g.vx) * SPEED_BOUNCE;
    const hop = n - g.landed;
    if (hop >= 2) {                                         // a big hop: a combo starts or grows
      g.combo++; g.comboFloors += hop; g.comboTimer = COMBO_FRAMES;
      g.bestCombo = Math.max(g.bestCombo, g.combo);
      if (g.combo >= 2) events.push({ type: "combo", combo: g.combo });
    } else if (hop !== 0 || g.comboTimer === 0) endCombo(g, events);
    g.landed = n;
    if (n > g.best) { g.best = n; if (n % 25 === 0) events.push({ type: "milestone", floor: n }); }
    if (f.kind === "cracked") { g.broken[n] = true; events.push({ type: "crack", floor: n }); }
    events.push({ type: "bounce", floor: n });
  }

  function board(g) {                                       // the live board others see (web/games.py Board)
    return { score: g.best, alive: !g.over, height: Math.max(0, g.camera), frame: g.frames,
             points: [Math.max(0, Math.min(1, g.x / W)), Math.max(0, Math.min(1, (g.y - g.camera) / H))] };
  }

  function distance(g) { return g.best; }                   // how a showdown ranks a run: the highest floor reached

  const API = { M: M, W: W, H: H, GAP: GAP, WALL: WALL, BOUNCE: BOUNCE, GRAVITY: GRAVITY, MAX_VX: MAX_VX,
                RISE_FROM: RISE_FROM, mix: mix, floorAt: floorAt, platformX: platformX, newGame: newGame, step: step,
                board: board, distance: distance };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.TeacupRules = API;
})(this);
