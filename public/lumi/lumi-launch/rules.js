/* Lumi Launch's rules (Doll's break game, 2026-11-14): Lumi sits in a pastel star cannon; the needle swings, OK locks
   the angle; the power bar swings, OK fires her; in the air OK spends a sparkle puff. She flies, bounces and rolls
   along a seeded course of Lumi things until she stops. A go is three launches on the same course; the score is the
   total distance in metres.

   mnemerynne/lumilaunch_rules.py is a LINE-FOR-LINE copy: the server replays every launch from its log of presses
   before it pays. So: only + - * / and Math.floor on numbers (no sin, no sqrt, no random), the same order of operations,
   whole-frame timings. The angles are a table of literal numbers (python/make_lumi_launch_tables.py writes it into both
   files). Change a rule here and the same rule there; tests/js/lumi_launch.test.mjs and tests/test_lumilaunch.py replay
   the same recorded goes (tests/fixtures/lumi_launch_runs.json, re-recorded by tests/js/lumi_launch_bot.mjs).

   No drawing here, so Node can test it. Units: x to the right from the cannon, y up from the ground, UNIT per metre. */
(function (root) {
  "use strict";

  const M = 2147483647;                                     // the arcade's seed modulus (arcade.MODULUS)
  const C = {
    UNIT: 20,                                               // course units in one metre
    SHOTS: 3,                                               // launches in a go
    AIM_LOW: 15, AIM_STEPS: 60, AIM_EVERY: 2,               // the needle: 15°..75°, one degree every 2 frames
    AIM_MAX: 1800, POWER_MAX: 1800,                         // 30 s to choose, then the cannon chooses for you
    POWER_STEP: 1,                                          // the power bar: 0..100, one a frame (1.7 s end to end)
    SPEED_MIN: 10, SPEED_MAX: 30,                           // the launch speed at power 0 and 100 (units a frame)
    MUZZLE_X: 60, MUZZLE_Y: 60,                             // where she leaves the cannon
    GRAVITY: 0.25, AIR: 0.999, VMAX: 42,                    // a frame's pull, drag, and the fastest she may go sideways
    BOUNCE: 0.5, SKID: 0.82, BOUNCE_MIN: 2,                 // a ground bounce keeps half her fall; a soft landing rolls
    ROLL: 0.97, STOP: 0.15,                                 // rolling slows her; this slow, she has stopped
    FLY_MAX: 3600,                                          // a minute in the air and on the ground, at most
    PUFFS: 3, PUFF_UP: 6, PUFF_FWD: 2,                      // sparkle puffs: a hop up and forward each
    START: 1600, SLOT: 600, GAP: 200,                       // the course: one slot every 30 m from 80 m out
    EMPTY: 120, HAZARD_BASE: 40, HAZARD_STEP: 8, HAZARD_MAX: 320,   // per mille: empty slots, hazards (more further out)
    PILLOW_KICK: 1.05, PILLOW_MIN: 9, PILLOW_FWD: 1,        // Cloud Pillow: a big bounce
    CUP_SPEED: 16, CUP_COS: 0.573576, CUP_SIN: 0.819152, CUP_UP: 3,   // Teacup Flinger: out at 55°
    YARN_FWD: 6, YARN_UP: 3,                                // Yarn Roll: a burst along the ground
    WIND: 0.55, WIND_H: 420,                                // Wish Wind: an updraft column
    COMET_FWD: 14, COMET_UP: 7,                             // Comet Ride: a rocket burst
  };
  // Each kind's size: w across; h tall (ground pieces) or the box's height (floating pieces).
  const SIZE = { pillow: [120, 40], teacup: [80, 60], yarn: [100, 30], wind: [160, 420], stardust: [60, 60],
                 comet: [70, 70], honey: [140, 8], nap: [110, 12] };
  const HAZARDS = ["honey", "nap"];

  // ANGLES BEGIN (python/make_lumi_launch_tables.py writes this block: [cos, sin] for 15°..75°)
  const ANGLES = [
    [0.965926, 0.258819], [0.961262, 0.275637], [0.956305, 0.292372], [0.951057, 0.309017], [0.945519, 0.325568], [0.939693, 0.342020],
    [0.933580, 0.358368], [0.927184, 0.374607], [0.920505, 0.390731], [0.913545, 0.406737], [0.906308, 0.422618], [0.898794, 0.438371],
    [0.891007, 0.453990], [0.882948, 0.469472], [0.874620, 0.484810], [0.866025, 0.500000], [0.857167, 0.515038], [0.848048, 0.529919],
    [0.838671, 0.544639], [0.829038, 0.559193], [0.819152, 0.573576], [0.809017, 0.587785], [0.798636, 0.601815], [0.788011, 0.615661],
    [0.777146, 0.629320], [0.766044, 0.642788], [0.754710, 0.656059], [0.743145, 0.669131], [0.731354, 0.681998], [0.719340, 0.694658],
    [0.707107, 0.707107], [0.694658, 0.719340], [0.681998, 0.731354], [0.669131, 0.743145], [0.656059, 0.754710], [0.642788, 0.766044],
    [0.629320, 0.777146], [0.615661, 0.788011], [0.601815, 0.798636], [0.587785, 0.809017], [0.573576, 0.819152], [0.559193, 0.829038],
    [0.544639, 0.838671], [0.529919, 0.848048], [0.515038, 0.857167], [0.500000, 0.866025], [0.484810, 0.874620], [0.469472, 0.882948],
    [0.453990, 0.891007], [0.438371, 0.898794], [0.422618, 0.906308], [0.406737, 0.913545], [0.390731, 0.920505], [0.374607, 0.927184],
    [0.358368, 0.933580], [0.342020, 0.939693], [0.325568, 0.945519], [0.309017, 0.951057], [0.292372, 0.956305], [0.275637, 0.961262],
    [0.258819, 0.965926],
  ];
  // ANGLES END

  function mix(seed, index, salt) {                         // arcade.mix (snakeSeedValue from the GameMaker game)
    const v = (Math.max(1, Math.abs(Math.trunc(seed))) * 1664525 + (Math.max(0, Math.trunc(index)) + 1) * 1013904223 +
               Math.max(1, Math.abs(Math.trunc(salt))) * 69069) % M;
    return v > 0 ? v : v + M - 1;
  }

  function scramble(v) {                                    // arcade.scramble: xorshift32, so neighbours roll apart
    let u = v >>> 0;
    u = (u ^ (u << 13)) >>> 0;
    u = (u ^ (u >>> 17)) >>> 0;
    return (u ^ (u << 5)) >>> 0;
  }

  function roll(seed, i, salt) {                            // one number 0..999 for slot i
    return scramble(mix(seed, i, salt)) % 1000;
  }

  function piece(seed, i) {                                 // what sits in course slot i (null: nothing), always the same for a seed
    if (i < 0 || roll(seed, i, 1) < C.EMPTY) return null;
    const hazard = Math.min(C.HAZARD_MAX, C.HAZARD_BASE + i * C.HAZARD_STEP);
    const x = C.START + i * C.SLOT + roll(seed, i, 3) % (C.SLOT - C.GAP);
    let kind;
    if (roll(seed, i, 2) < hazard) kind = HAZARDS[roll(seed, i, 4) % 2];
    else {
      const g = roll(seed, i, 4) % 100;
      kind = g < 26 ? "pillow" : g < 44 ? "teacup" : g < 62 ? "yarn" : g < 76 ? "wind" : g < 96 ? "stardust" : "comet";
    }
    let y = 0;
    if (kind === "stardust") y = 120 + roll(seed, i, 5) % 240;
    if (kind === "comet") y = 100 + roll(seed, i, 5) % 160;
    return { i: i, kind: kind, x: x, y: y, w: SIZE[kind][0], h: SIZE[kind][1] };
  }

  function newShot(seed) {                                  // one launch, waiting in the cannon
    return { seed: seed, phase: "aim", t: 0, phaseT: 0, aim: 30, aimDir: 1, manual: false, power: 0, powerDir: 1,
             x: C.MUZZLE_X, y: C.MUZZLE_Y, vx: 0, vy: 0, puffs: C.PUFFS, dust: 0, used: {}, end: "", events: [] };
  }

  function fire(s) {                                        // out of the cannon at the locked angle and power
    const speed = C.SPEED_MIN + (C.SPEED_MAX - C.SPEED_MIN) * s.power / 100;
    s.vx = speed * ANGLES[s.aim][0];
    s.vy = speed * ANGLES[s.aim][1];
    s.phase = "fly"; s.phaseT = 0;
    s.events.push({ type: "fire", power: s.power, angle: C.AIM_LOW + s.aim });
  }

  function press(s, button) {                               // a press: "ok", "up" or "down" (anything else does nothing)
    if (s.phase === "aim") {
      if (button === "up" || button === "down") {           // a nudge stops the swing: the needle stays where you put it
        s.manual = true;
        s.aim = Math.max(0, Math.min(C.AIM_STEPS, s.aim + (button === "up" ? 1 : -1)));
        s.events.push({ type: "nudge" });
      } else if (button === "ok") {
        s.phase = "power"; s.phaseT = 0; s.power = 0; s.powerDir = 1;
        s.events.push({ type: "lock", angle: C.AIM_LOW + s.aim });
      }
    } else if (s.phase === "power") {
      if (button === "ok") fire(s);
    } else if (s.phase === "fly") {
      if (button === "ok" && s.puffs > 0) {                 // a sparkle puff
        s.puffs = s.puffs - 1;
        s.vy = (s.vy > 0 ? s.vy : 0) + C.PUFF_UP;
        s.vx = s.vx + C.PUFF_FWD;
        s.events.push({ type: "puff", left: s.puffs });
      }
    }
  }

  function finish(s, why) {
    s.phase = "done"; s.end = why;
    s.events.push({ type: "stop", why: why, m: metres(s) });
  }

  function touch(s) {                                       // the course pieces around her
    const here = Math.floor((s.x - C.START) / C.SLOT);
    for (let k = here - 1; k <= here + 1; k++) {
      const p = piece(s.seed, k);
      if (!p || s.used[k] || s.phase !== "fly") continue;
      if (s.x < p.x || s.x > p.x + p.w) continue;
      if (p.kind === "stardust" || p.kind === "comet") {    // floating: inside the box
        if (s.y < p.y || s.y > p.y + p.h) continue;
        s.used[k] = 1;
        if (p.kind === "stardust") {
          s.dust = s.dust + 1;
          s.puffs = Math.min(C.PUFFS, s.puffs + 1);
        } else {
          s.vx = s.vx + C.COMET_FWD;
          s.vy = C.COMET_UP;
        }
        s.events.push({ type: p.kind, i: k });
        continue;
      }
      if (s.y > p.h) continue;                              // ground pieces: only when she's down at their height
      if (p.kind === "wind") {
        s.vy = s.vy + C.WIND;
        if (s.phaseT % 12 === 0) s.events.push({ type: "wind", i: k });
      } else if (p.kind === "pillow") {
        if (s.vy >= 0) continue;
        s.y = p.h;
        s.vy = Math.max(-s.vy * C.PILLOW_KICK, C.PILLOW_MIN);
        s.vx = s.vx + C.PILLOW_FWD;
        s.events.push({ type: "pillow", i: k });
      } else if (p.kind === "teacup") {
        s.used[k] = 1;
        const speed = s.vx > C.CUP_SPEED ? s.vx : C.CUP_SPEED;
        s.y = p.h;
        s.vx = speed * C.CUP_COS;
        s.vy = speed * C.CUP_SIN + C.CUP_UP;
        s.events.push({ type: "teacup", i: k });
      } else if (p.kind === "yarn") {
        s.used[k] = 1;
        s.vx = s.vx + C.YARN_FWD;
        s.vy = Math.max(s.vy, C.YARN_UP);
        s.events.push({ type: "yarn", i: k });
      } else {                                              // honey or nap: she stops right there
        s.vx = 0; s.vy = 0;
        finish(s, p.kind);
        return;
      }
    }
  }

  function step(s) {                                        // one frame (1/60 s); s.events says what happened
    s.events = [];
    if (s.phase === "done") return s;
    s.t = s.t + 1;
    s.phaseT = s.phaseT + 1;
    if (s.phase === "aim") {
      if (!s.manual && s.phaseT % C.AIM_EVERY === 0) {
        s.aim = s.aim + s.aimDir;
        if (s.aim >= C.AIM_STEPS) { s.aim = C.AIM_STEPS; s.aimDir = -1; }
        if (s.aim <= 0) { s.aim = 0; s.aimDir = 1; }
      }
      if (s.phaseT >= C.AIM_MAX) press(s, "ok");
      return s;
    }
    if (s.phase === "power") {
      s.power = s.power + s.powerDir * C.POWER_STEP;
      if (s.power >= 100) { s.power = 100; s.powerDir = -1; }
      if (s.power <= 0) { s.power = 0; s.powerDir = 1; }
      if (s.phaseT >= C.POWER_MAX) fire(s);
      return s;
    }
    s.vy = s.vy - C.GRAVITY;
    s.vx = s.vx * C.AIR;
    if (s.vx > C.VMAX) s.vx = C.VMAX;
    s.x = s.x + s.vx;
    s.y = s.y + s.vy;
    touch(s);
    if (s.phase !== "fly") return s;
    if (s.y <= 0) {
      s.y = 0;
      if (s.vy < -C.BOUNCE_MIN) {
        s.vy = -s.vy * C.BOUNCE;
        s.vx = s.vx * C.SKID;
        s.events.push({ type: "bounce" });
      } else {
        s.vy = 0;
        s.vx = s.vx * C.ROLL;
        if (s.vx < C.STOP) { finish(s, "rest"); return s; }
      }
    }
    if (s.phaseT >= C.FLY_MAX) finish(s, "time");
    return s;
  }

  function metres(s) {                                      // how far she is from the cannon, in whole metres
    return Math.max(0, Math.floor(s.x / C.UNIT));
  }

  function playShot(seed, log) {                            // one launch from its presses: [[frame, button], ...] in order
    const s = newShot(seed);
    let at = 0;
    while (s.phase !== "done") {
      while (at < log.length && log[at][0] <= s.t) { press(s, log[at][1]); at = at + 1; }
      step(s);
    }
    return s;
  }

  function replay(seed, shots) {                            // a whole go: what the server pays from
    const out = { shots: [], total: 0, frames: 0, dust: 0 };
    for (let n = 0; n < shots.length && n < C.SHOTS; n++) {
      const s = playShot(seed, shots[n]);
      out.shots.push({ m: metres(s), dust: s.dust, end: s.end, frames: s.t });
      out.total = out.total + metres(s);
      out.frames = out.frames + s.t;
      out.dust = out.dust + s.dust;
    }
    return out;
  }

  const API = { M: M, C: C, SIZE: SIZE, ANGLES: ANGLES, mix: mix, scramble: scramble, roll: roll, piece: piece,
                newShot: newShot, press: press, step: step, metres: metres, playShot: playShot, replay: replay };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.LumiLaunchRules = API;
})(this);
