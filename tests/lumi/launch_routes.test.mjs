// Lumi Launch's routes over HTTP (src/lumi/routes/launch.js), ported from erinne test_lumilaunch.py's route test:
// presses only, never a distance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serve } from "./minis_http.mjs";

const ME = "888888888888888888";                                                     // a Discord-shaped id
const { post, get, env } = await serve(ME, "Doll");                                  // logged-in harness
const RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_launch_runs.json", import.meta.url), "utf8")); // recorded goes

test("the routes take presses only", async () => {
  const state = (await get("/api/lumi-launch/state")).body;
  assert.ok(state.entry === 25 && state.metres_per_coin === 20 && state.shots === 3); // native numbers
  assert.equal((await post("/api/lumi-launch/start", {})).status, 200);
  const t = (await post("/api/lumi-launch/start", {})).body;
  assert.equal(t.charged, 5);                                                        // 25 native -> 5 SGC
  assert.equal(env.eco.getBalance("__LUMI_ARCADE__"), 10);                           // two entries in Lumi Arcade
  const recorded = RUNS[0];
  assert.equal((await post("/api/lumi-launch/finish", { run: t.run, shots: recorded.shots, metres: 9999 })).status, 422);
  assert.equal((await post("/api/lumi-launch/finish", { run: t.run, shots: [[[0, "zoom"]]] })).status, 422);
  assert.equal((await post("/api/lumi-launch/finish", { run: t.run, shots: [[], [], [], []] })).status, 422);
  const out = (await post("/api/lumi-launch/finish", { run: t.run, shots: recorded.shots })).body;
  assert.match(out.refused, /add up/);                                               // a whole go, finished at once
  assert.equal((await post("/api/lumi-launch/finish", { run: t.run, shots: [] })).status, 404);
});
