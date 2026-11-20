// Lumi Launch's test bot: plays scripted goes with the page's own rules (static/games/lumi-launch/rules.js) and records
// each launch's presses, exactly as the page would send them to /finish. tests/js/lumi_launch.test.mjs and
// tests/test_lumilaunch.py both replay tests/fixtures/lumi_launch_runs.json and must land Lumi on the very same spot.
//
// Re-record after ANY rules change (in both rules files):   node tests/js/lumi_launch_bot.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const R = require("../../public/lumi/lumi-launch/rules.js");

// One launch from a plan: { angle (15..75), power (0..100), nudge: whole degrees to push the needle first,
// puffs: frames after firing to spend a sparkle puff, idle: true never presses (the cannon chooses after 30 s) }.
export function shoot(seed, plan) {
  const s = R.newShot(seed), log = [];
  const push = (button) => { log.push([s.t, button]); R.press(s, button); };   // a press lands before the next frame, as on the page
  let nudged = 0, flying = 0, puffAt = 0;
  while (s.phase !== "done") {
    if (!plan.idle) {
      if (s.phase === "aim") {
        if (plan.nudge && nudged < Math.abs(plan.nudge)) { push(plan.nudge > 0 ? "up" : "down"); nudged++; }
        else if (R.C.AIM_LOW + s.aim === plan.angle || (plan.nudge && nudged >= Math.abs(plan.nudge))) push("ok");
      } else if (s.phase === "power" && s.power >= Math.min(plan.power, 99) && s.powerDir > 0) push("ok");   // the bar turns at 100
      else if (s.phase === "fly") {
        flying++;
        const puffs = plan.puffs || [];
        if (puffAt < puffs.length && flying === puffs[puffAt]) { push("ok"); puffAt++; }
      }
    }
    R.step(s);
  }
  return { log, s };
}

export const CASES = [
  { seed: 12345, plans: [{ angle: 45, power: 100 }, { angle: 30, power: 70, puffs: [40, 80, 120] }, { angle: 60, power: 50 }] },
  { seed: 777, plans: [{ angle: 40, power: 90, puffs: [30] }, { nudge: 5, power: 100 }, { nudge: -9, power: 85, puffs: [20, 60] }] },
  { seed: 2147483646, plans: [{ angle: 75, power: 100 }, { angle: 15, power: 100 }, { angle: 50, power: 0 }] },
  { seed: 1, plans: [{ idle: true }, { angle: 45, power: 60, puffs: [10, 11, 12, 13] }, { angle: 35, power: 95 }] },
  { seed: 424242, plans: [{ angle: 42, power: 98, puffs: [50, 100, 150, 200, 250] }, { angle: 48, power: 99 }, { angle: 44, power: 100, puffs: [90] }] },
  { seed: 9001, plans: [{ angle: 33, power: 88 }, { angle: 66, power: 77, puffs: [70] }, { angle: 45, power: 100, puffs: [60, 120] }] },
];

export function play(c) {                                   // one go: its logs, and where the page says each launch ended
  const shots = c.plans.map((plan) => shoot(c.seed, plan));
  return {
    seed: c.seed,
    shots: shots.map((x) => x.log),
    ends: shots.map((x) => ({ x: x.s.x, y: x.s.y, vx: x.s.vx, t: x.s.t, end: x.s.end, m: R.metres(x.s), dust: x.s.dust })),
    result: R.replay(c.seed, shots.map((x) => x.log)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runs = CASES.map(play);
  const out = fileURLToPath(new URL("./fixtures/lumi_launch_runs.json", import.meta.url));
  writeFileSync(out, JSON.stringify(runs, null, 1) + "\n");
  runs.forEach((r) => console.log("seed", r.seed, "→", r.result.shots.map((s) => s.m + " m (" + s.end + ")").join(", "), "= total", r.result.total));
}
