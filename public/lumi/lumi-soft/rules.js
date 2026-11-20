/* Lumi-Soft's rules: the whole run as a step-by-step simulation, 60 steps a second. The page runs it to play; the
   server (mnemerynne/lumisoft.py) runs a line-for-line copy to replay the shots before it pays, so the two must agree
   exactly. Keep it to + - * / on numbers and whole-step timings: no Math.sin, no random, no clock. Change a rule here and
   the same rule there; tests/js/lumi_soft.test.mjs and tests/test_lumisoft.py replay the same recorded runs to check.

   The stages are data (mnemerynne/lumisoft_data/stages.json, sent by the server). A run is a plan: a list of segments,
   each a scene (waves of targets) or a stage's boss. Works in a browser (window.LumiSoftRules) and in Node. */
(function (root, make) {
  const rules = make();                                                              // build the module once
  if (typeof module === "object" && module.exports) module.exports = rules; else root.LumiSoftRules = rules;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const C = Object.freeze({
    W: 2732, H: 1536,                       // a scene, in its own units (twice the GameMaker room)
    CLOCK: 3600, POP_TIME: 120, BADGE_TIME: 180, SCENE_TIME: 900, FRIEND_TIME: 300, CLOCK_PICKUP: 300, BOSS_TIME: 120,
    CONTINUE_CLOCK: 1800,                   // a continue tops the clock up to at least 30 s
    HEARTS: 3, AMMO: 6, PUMP: 30, RELOAD: 72, MOVE: 120,   // the Sparkle Popper: six BBs, half a second between pops, 1.2 s reload; 2 s between scenes
    BODY: 50, BADGE: 100, MOVING: 25, QUICK: 50, QUICK_AGE: 90, FRIEND: 250, STAR: 500, SPOT: 150, BOSS: 2000,
    FAR: 0.75, COMBO_MAX: 20,               // smaller than this is far (×1.5); the combo tops out at ×3.0 after 20 pops in a row
    CARD_W: 100, CARD_H: 131,               // a standee at scale 1: the GameMaker prototype's target sprite
  });

  function plan(data, mode, stageId, day) { // The run's segments: [{stage: index, scene: index or -1 for the boss}].
    const out = [], stages = data.stages, find = function (id) { return stages.findIndex(function (s) { return s.id === id; }); };
    const add = function (i, scenes) { scenes.forEach(function (n) { out.push({ stage: i, scene: n }); }); if (stages[i].boss) out.push({ stage: i, scene: -1 }); };
    if (mode === "training") { const i = find("training"); out.push({ stage: i, scene: 0 }); return out; }
    if (mode === "story") { stages.forEach(function (s, i) { if (!s.training) add(i, s.scenes.map(function (_, n) { return n; })); }); return out; }
    if (mode === "daily") { const story = stages.map(function (s, i) { return i; }).filter(function (i) { return !stages[i].training; }); // one scene and its stage's boss, by date
      const i = story[day % story.length]; add(i, [Math.floor(day / story.length) % stages[i].scenes.length]); return out; }
    const i = find(stageId);
    if (i < 0 || stages[i].training) return null;
    add(i, stages[i].scenes.map(function (_, n) { return n; }));
    return out;
  }

  function create(data, segments) { // A fresh run.
    const s = { data: data, segs: segments, seg: 0, segT: 0, wave: 0, waveT: 0, pause: 0, t: 0, nextId: 1,
      clock: C.CLOCK, hearts: C.HEARTS, ammo: C.AMMO, lastShot: -9999, reloadUntil: 0, reloading: false,
      score: 0, streak: 0, best: 0, shots: 0, hits: 0, pops: 0, badges: 0, friends: 0, lost: 0, continues: 0,
      targets: [], boss: null, over: false, done: false, cleared: [], stage: null, events: [] };
    begin(s);
    return s;
  }

  function current(s) { return s.segs[Math.min(s.seg, s.segs.length - 1)]; }   // the segment being played; once the run is done, the last one (the page still draws it)
  function stageOf(s) { return s.data.stages[current(s).stage]; }
  function training(s) { return !!stageOf(s).training; }

  function begin(s) { // Start the current segment: its first wave, or its boss.
    const seg = s.segs[s.seg], stage = s.data.stages[seg.stage];
    s.segT = 0; s.wave = 0; s.waveT = 0; s.targets = []; s.boss = null;
    if (!s.stage || s.stage.index !== seg.stage) s.stage = { index: seg.stage, id: stage.id, shots: 0, hits: 0, friends: 0, lost: 0, score: 0, bossLost: 0 };
    if (seg.scene < 0) { const b = stage.boss; s.boss = { def: b, age: 0, hp: b.hp, wind: 0 }; s.stage.bossLost = 0; }
    s.events.push({ kind: "segment", stage: stage.id, scene: seg.scene });
  }

  function scene(s) { const seg = current(s); return seg.scene < 0 ? null : s.data.stages[seg.stage].scenes[seg.scene]; }

  function tri(age, period) { // A triangle wave, 0 → 1 → 0 over one period: smooth enough, and exact in both languages.
    const half = period / 2, p = age % period;
    return p < half ? p / half : 2 - p / half;
  }

  function along(pts, dist, loop) { // A point `dist` along a path of [x, y] points (looping or stopping at the end), and whether it has run out.
    let total = 0;
    const lens = [];
    for (let i = 0; i + 1 < pts.length; i++) { const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.sqrt(dx * dx + dy * dy); lens.push(l); total += l; }
    if (total <= 0) return { x: pts[0][0], y: pts[0][1], end: false };
    let d = dist;
    if (loop) d = d % total; else if (d >= total) { const last = pts[pts.length - 1]; return { x: last[0], y: last[1], end: true }; }
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) { const f = lens[i] > 0 ? d / lens[i] : 0; return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, end: false }; }
      d -= lens[i];
    }
    return { x: pts[0][0], y: pts[0][1], end: false };
  }

  function pose(def, age) { // Where a target (or boss) is at this age: bottom-centre x, y, size, how far up (v) and whether it can be hit.
    const m = def.move || { type: "stand" }, sc = def.s || 1;
    let x = def.x, y = def.y, v = 1, ok = true, gone = false;
    const w = (def.w || C.CARD_W) * sc, h = (def.h || C.CARD_H) * sc;
    if (m.type === "pop" || m.type === "peek") {               // rise from (or slide out of) cover, stay, go back, wait
      const period = m.up + m.stay + m.up + m.gap, p = age % period;
      v = p < m.up ? p / m.up : p < m.up + m.stay ? 1 : p < m.up + m.stay + m.up ? 1 - (p - m.up - m.stay) / m.up : 0;
      if (m.type === "peek") { x = def.x + m.dx * v; ok = v >= 0.5; } else ok = v > 0.25;
    } else if (m.type === "path") {
      const at = along(m.pts, age * m.speed, !!m.loop); x = at.x; y = at.y; gone = at.end;
    } else if (m.type === "bob") {
      const f = tri(age, m.period) * 2 - 1; x = def.x + (m.dx || 0) * f; y = def.y + (m.dy || 0) * f;
    } else if (m.type === "rise") {
      y = def.y - age * m.speed; gone = y + h < 0;              // a balloon floats up and away
    }
    const shown = m.type === "pop" ? h * v : h;               // a pop-up shows only what has risen above its cover
    return { x: x, y: y, w: w, h: h, v: v, ok: ok && !gone, gone: gone, left: x - w / 2, top: y - shown, badgeTo: y - shown + h * 0.25 };
  }

  function moving(def) { const t = (def.move || {}).type; return t === "path" || t === "bob" || t === "rise"; }

  function wavesOf(s) { const sc = scene(s); return sc ? sc.waves : []; }

  function step(s) { // One sixtieth of a second.
    s.events = [];
    if (s.over || s.done) return s;
    s.t += 1;
    if (s.reloading && s.t >= s.reloadUntil) { s.reloading = false; s.ammo = C.AMMO; s.events.push({ kind: "loaded" }); }
    if (s.pause > 0) { s.pause -= 1; if (s.pause === 0) begin(s); return s; }   // between scenes: the clock waits too
    if (!training(s)) { s.clock -= 1; if (s.clock <= 0) { s.clock = 0; gameOver(s); return s; } }
    s.segT += 1;
    if (s.boss) return stepBoss(s);
    const waves = wavesOf(s), wave = waves[s.wave];
    if (wave) {
      wave.targets.forEach(function (d, i) { if (d.at === s.waveT) s.targets.push({ id: s.nextId++, def: d, index: i, age: 0, wind: 0 }); });
      s.waveT += 1;
    }
    s.targets = s.targets.filter(function (tg) {
      tg.age += 1;
      const p = pose(tg.def, tg.age);
      if (p.gone || (tg.def.life && tg.age >= tg.def.life)) { tg.done = true; return false; }   // wandered off: no harm done
      if (tg.def.wind && p.ok && p.v >= 1) {                   // a water balloon, wound up while it's fully out
        tg.wind += 1;
        if (tg.wind >= tg.def.wind) { tg.wind = 0; splash(s, tg.id); if (s.over) return true; }
      }
      return true;
    });
    if (s.over) return s;
    if (wave && s.waveT > lastAt(wave) && !s.targets.some(function (tg) { return tg.def.kind === "creature"; })) { // every creature popped or gone
      s.targets = []; s.wave += 1; s.waveT = 0;               // friends and pickups leave with their wave
      if (s.wave >= waves.length) endSegment(s);
    }
    return s;
  }

  function lastAt(wave) { return wave.targets.reduce(function (m, d) { return Math.max(m, d.at); }, 0); }

  function stepBoss(s) {
    const b = s.boss, d = b.def;
    b.age += 1;
    if (d.wind) { b.wind += 1; if (b.wind >= d.wind) { b.wind = 0; splash(s, 0); } }
    return s;
  }

  function splash(s, id) { // A water balloon lands: a heart gone, the combo with it.
    s.hearts -= 1; s.lost += 1; s.stage.lost += 1; if (s.boss) s.stage.bossLost += 1; s.streak = 0;
    s.events.push({ kind: "splash", id: id });
    if (s.hearts <= 0) { s.hearts = 0; gameOver(s); }
  }

  function gameOver(s) { s.over = true; s.events.push({ kind: "over" }); }

  function endSegment(s) { // A scene cleared (time bonus) or a boss beaten (the stage's bonus and rank).
    const seg = s.segs[s.seg], stage = s.data.stages[seg.stage];
    if (seg.scene >= 0 && !stage.training) { s.clock += C.SCENE_TIME; s.events.push({ kind: "scene", stage: stage.id }); }
    const lastOfStage = s.seg + 1 >= s.segs.length || s.segs[s.seg + 1].stage !== seg.stage;
    if (lastOfStage) clearStage(s, stage);
    s.seg += 1; s.targets = []; s.boss = null;
    if (s.seg >= s.segs.length) { s.done = true; s.events.push({ kind: "done" }); } else s.pause = C.MOVE;
  }

  function rank(st) { // S needs 90% accuracy with no hearts lost and no friends popped; then by accuracy alone.
    const a = st.hits * 100, n = Math.max(1, st.shots);
    if (a >= n * 90 && st.lost === 0 && st.friends === 0) return "S";
    return a >= n * 75 ? "A" : a >= n * 60 ? "B" : a >= n * 40 ? "C" : "D";
  }

  function clearStage(s, stage) {
    const st = s.stage, bonus = stage.training ? 0 : Math.floor(st.hits * 2000 / Math.max(1, st.shots)) + s.hearts * 500 + Math.floor(s.clock / 60) * 50;
    s.score += bonus; st.score += bonus;
    const row = { stage: stage.id, score: st.score, bonus: bonus, rank: stage.training ? "" : rank(st), shots: st.shots, hits: st.hits,
      friends: st.friends, lost: st.lost, bossLost: st.bossLost, perfect: st.shots > 0 && st.hits === st.shots };
    s.cleared.push(row);
    s.events.push(Object.assign({ kind: "stage" }, row));
  }

  function award(s, pts, combo) { // Points, with the combo's multiplier when it counts.
    const got = combo ? Math.floor(pts * (10 + Math.min(s.streak, C.COMBO_MAX)) / 10) : pts;
    s.score += got; s.stage.score += got;
    return got;
  }

  function impact(s, x, y) { // Where a BB lands: the wind pushes it more the farther (higher in the scene) it flies.
    const wind = stageOf(s).wind || 0;
    return { x: x + wind * (1 - y / C.H), y: y };
  }

  function canFire(s) { return !s.over && !s.done && s.pause === 0 && !s.reloading && s.ammo > 0 && s.t - s.lastShot >= C.PUMP; }

  function fire(s, ax, ay) { // One pop at the aim point. Returns what happened, or null when the Popper isn't ready (nothing is counted).
    if (!canFire(s)) return null;
    s.lastShot = s.t; s.ammo -= 1; s.shots += 1; s.stage.shots += 1;
    if (s.ammo === 0) { s.reloading = true; s.reloadUntil = s.t + C.RELOAD; }  // an empty tube reloads by itself
    const at = impact(s, ax, ay);
    const out = s.boss ? hitBoss(s, at) : hitTarget(s, at);
    out.x = at.x; out.y = at.y;
    s.events.push(Object.assign({ kind: "shot" }, out));
    return out;
  }

  function hitTarget(s, at) {
    let best = null, bp = null;
    s.targets.forEach(function (tg) {
      const p = pose(tg.def, tg.age);
      if (!p.ok || at.x < p.left || at.x > p.left + p.w || at.y < p.top || at.y > p.y) return;
      if (!best || (tg.def.s || 1) > (best.def.s || 1) || ((tg.def.s || 1) === (best.def.s || 1) && tg.id > best.id)) { best = tg; bp = p; }  // the nearest, then the newest
    });
    if (!best) { s.streak = 0; return { what: "miss" }; }
    s.targets = s.targets.filter(function (tg) { return tg !== best; });
    const d = best.def;
    s.hits += 1; s.stage.hits += 1;
    if (d.kind === "friend") {
      s.friends += 1; s.stage.friends += 1; s.streak = 0;
      const lose = Math.min(s.score, C.FRIEND); s.score -= lose; s.stage.score -= lose;
      s.clock = Math.max(1, s.clock - C.FRIEND_TIME);
      return { what: "friend", id: best.id, points: -lose };
    }
    if (d.kind === "pickup") {
      if (d.look === "pickup-star") award(s, C.STAR, false);
      else if (d.look === "pickup-clock") s.clock += C.CLOCK_PICKUP;
      else if (d.look === "pickup-heart") s.hearts = Math.min(C.HEARTS, s.hearts + 1);
      else if (d.look === "pickup-crate") { s.ammo = C.AMMO; s.reloading = false; }
      return { what: "pickup", id: best.id, look: d.look, points: d.look === "pickup-star" ? C.STAR : 0 };
    }
    const badge = at.y < bp.badgeTo;
    let pts = badge ? C.BADGE : C.BODY;
    if (moving(d)) pts += C.MOVING;
    if (best.age <= C.QUICK_AGE + ((d.move || {}).up || 0)) pts += C.QUICK;
    if ((d.s || 1) < C.FAR) pts = Math.floor(pts * 3 / 2);
    const got = award(s, pts, true);
    s.streak += 1; s.best = Math.max(s.best, s.streak); s.pops += 1;
    if (badge) s.badges += 1;
    if (!training(s)) s.clock += badge ? C.BADGE_TIME : C.POP_TIME;
    return { what: badge ? "badge" : "pop", id: best.id, points: got };
  }

  function hitBoss(s, at) {
    const b = s.boss, d = b.def, p = pose(d, b.age);
    const spot = (d.spots || []).findIndex(function (sp) {
      const period = sp.on + sp.off;
      if ((b.age + (sp.phase || 0)) % period >= sp.on) return false;       // closed
      const dx = at.x - (p.x + sp.dx * (d.s || 1)), dy = at.y - (p.y + sp.dy * (d.s || 1)), r = sp.r * (d.s || 1);
      return dx * dx + dy * dy <= r * r;
    });
    if (spot >= 0) {
      s.hits += 1; s.stage.hits += 1;
      const got = award(s, C.SPOT, true);
      s.streak += 1; s.best = Math.max(s.best, s.streak);
      b.hp -= 1; b.wind = 0; s.clock += C.BOSS_TIME;
      if (b.hp <= 0) { s.score += C.BOSS; s.stage.score += C.BOSS; s.pops += 1; s.events.push({ kind: "boss" }); endSegment(s); return { what: "beaten", spot: spot, points: got + C.BOSS }; }
      return { what: "spot", spot: spot, points: got };
    }
    if (at.x >= p.left && at.x <= p.left + p.w && at.y >= p.top && at.y <= p.y) { s.hits += 1; s.stage.hits += 1; return { what: "boing" }; } // cardboard: no harm, no foul
    s.streak = 0;
    return { what: "miss" };
  }

  function reload(s) { // R: refill the tube now. False when it's full or already reloading.
    if (s.over || s.done || s.reloading || s.ammo >= C.AMMO) return false;
    s.reloading = true; s.reloadUntil = s.t + C.RELOAD;
    return true;
  }

  function carryOn(s) { // A continue (paid on the server): hearts back, the clock topped up; the score stays.
    if (!s.over) return false;
    s.over = false; s.hearts = C.HEARTS; s.clock = Math.max(s.clock, C.CONTINUE_CLOCK); s.continues += 1; s.streak = 0;
    s.events = [{ kind: "continue" }];
    return true;
  }

  /* Replay a recorded run: the page's log is {shots: [[t, x, y]], reloads: [t], continues: n, end: t}. Events at step t
     happen before step t + 1, exactly as the page did them. Returns the finished state. */
  function replay(data, segments, log, limit) {
    const s = create(data, segments), shots = (log.shots || []).slice(), reloads = (log.reloads || []).slice();
    const end = Math.min(Number(log.end) || 0, limit || Infinity);
    let si = 0, ri = 0, refused = 0;
    for (;;) {
      while (ri < reloads.length && reloads[ri] <= s.t) { if (reloads[ri] === s.t) reload(s); ri++; }
      while (si < shots.length && shots[si][0] <= s.t) { if (shots[si][0] !== s.t || !fire(s, shots[si][1], shots[si][2])) refused++; si++; }
      if (s.done || s.t >= end) break;
      if (s.over) { if (s.continues < (log.continues || 0)) { carryOn(s); continue; } break; }
      step(s);
    }
    s.refused = refused + (shots.length - si);
    return s;
  }

  function summary(s) { // What a finished run comes to.
    return { score: s.score, shots: s.shots, hits: s.hits, pops: s.pops, badges: s.badges, friends: s.friends, lost: s.lost,
      best: s.best, continues: s.continues, done: s.done, over: s.over, t: s.t, cleared: s.cleared };
  }

  return { C: C, plan: plan, create: create, step: step, fire: fire, reload: reload, carryOn: carryOn, canFire: canFire,
    pose: pose, replay: replay, summary: summary, rank: rank, impact: impact, tri: tri, scene: scene, stageOf: stageOf };
});
