// A robot that plays Lumi-Soft through rules.js, for the tests: it aims at what it can see, misses on purpose now and
// then, reloads early sometimes, pops a friend if told to, and records its log exactly as game.js does. Not a test
// itself (no .test. in the name). `node tests/js/lumi_soft_bot.mjs` rewrites tests/fixtures/lumi_soft_runs.json, the
// recorded runs both test suites replay (tests/js/lumi_soft.test.mjs and tests/test_lumisoft.py).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const R = createRequire(import.meta.url)("../../public/lumi/lumi-soft/rules.js");
export const DATA = JSON.parse(readFileSync(new URL("../../src/lumi/data/stages.json", import.meta.url), "utf8"));

function lcg(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 48271) % 2147483647) / 2147483647; } // the robot's own dice

function aim(s, rand, skill) { // Where to point: a visible creature's star badge (or body), an open boss spot, or somewhere silly.
  if (s.boss) {
    const b = s.boss, d = b.def, p = R.pose(d, b.age), sc = d.s || 1;
    const open = (d.spots || []).filter(sp => (b.age + (sp.phase || 0)) % (sp.on + sp.off) < sp.on);
    if (!open.length) return null;
    const sp = open[0]; return [p.x + sp.dx * sc, p.y + sp.dy * sc];
  }
  const wind = (R.stageOf(s).wind || 0);
  const seen = s.targets.map(t => ({ t, p: R.pose(t.def, t.age) })).filter(o => o.p.ok && o.t.def.kind !== "friend");
  if (!seen.length) return null;
  seen.sort((a, b) => (b.t.def.wind ? b.t.wind : 0) - (a.t.def.wind ? a.t.wind : 0) || a.t.id - b.t.id);   // the one about to throw first
  const { p } = seen[0], badge = rand() < skill;
  const y = badge ? p.top + p.h * 0.1 : p.y - p.h * 0.4 * Math.max(0.3, p.v);
  return [p.x - wind * (1 - y / R.C.H), y];                                       // hold over for the wind
}

export function play(mode, opts = {}) { // One run: returns {mode, stage, day, log, summary}.
  const segs = R.plan(DATA, mode, opts.stage, opts.day || 0), s = R.create(DATA, segs), rand = lcg(opts.seed || 7);
  const log = { shots: [], reloads: [], continues: 0, end: 0 }, round = v => Math.round(v * 10) / 10;
  const limit = opts.limit || 60 * 60 * 30;
  while (!s.done && s.t < limit) {
    if (s.over) { if (log.continues < (opts.continues || 0)) { R.carryOn(s); log.continues++; continue; } break; }
    if (opts.quitAt && s.t >= opts.quitAt) break;
    if (R.canFire(s) && rand() < (opts.eager || 0.6)) {
      let at = aim(s, rand, opts.skill ?? 0.6);
      if (opts.friendly && rand() < 0.02) { const f = s.targets.find(t => t.def.kind === "friend" && R.pose(t.def, t.age).ok); if (f) { const p = R.pose(f.def, f.age); at = [p.x, p.y - 20]; } }
      if (at && rand() < (opts.miss || 0.1)) at = [at[0] + 400, at[1]];            // a deliberate miss
      if (at) { const x = round(at[0]), y = round(at[1]); if (R.fire(s, x, y)) log.shots.push([s.t, x, y]); }
    } else if (!s.reloading && s.ammo < 3 && rand() < 0.02 && R.reload(s)) log.reloads.push(s.t);
    R.step(s);
  }
  log.end = s.t;
  return { mode, stage: opts.stage || null, day: opts.day || 0, log, summary: R.summary(s) };
}

export const CASES = [ // The recorded runs: each a different way of playing.
  ["training", {}],
  ["stage", { stage: "garden", skill: 0.8, seed: 3 }],
  ["stage", { stage: "tower", skill: 0.5, miss: 0.2, seed: 5, friendly: true }],
  ["stage", { stage: "lounge", eager: 0.012, skill: 0.4, seed: 9, continues: 2 }],   // lazy: splashed, game over, continues
  ["stage", { stage: "dungeon", seed: 13, quitAt: 2000 }],                            // quits partway
  ["daily", { day: 20404, seed: 17 }],
  ["story", { skill: 0.7, seed: 21, continues: 3 }],
  ["stage", { stage: "fair", eager: 0.01, seed: 23 }],                               // lazy with no continues: game over
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runs = CASES.map(([mode, opts]) => play(mode, opts));
  mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./fixtures/lumi_soft_runs.json", import.meta.url), JSON.stringify(runs) + "\n");
  runs.forEach(r => console.log(r.mode, r.stage || "", "score", r.summary.score, "t", r.summary.t, "done", r.summary.done, "over", r.summary.over,
    "shots", r.summary.shots, "cleared", r.summary.cleared.map(c => c.stage + ":" + c.rank).join(","), "cont", r.summary.continues));
}
