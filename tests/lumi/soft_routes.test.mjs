// Lumi-Soft's routes over HTTP (src/lumi/routes/soft.js), ported from erinne test_lumisoft.py's route test: intentions
// and logs only, never a score; a continue is paid in SGC; a long story log fits through the bigger body limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serve } from "./minis_http.mjs";

const ME = "666666666666666666";                                                     // a Discord-shaped id
const { post, get } = await serve(ME, "Doll");                                       // logged-in harness
const RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_soft_runs.json", import.meta.url), "utf8")); // recorded runs
const run = (mode, stage = null) => RUNS.find((r) => r.mode === mode && r.stage === stage);

test("the routes take intentions and logs only", async () => {
  const state = (await get("/api/lumi-soft/state")).body;
  assert.ok(state.entry === 25 && state.stages.stages[0].id === "training" && state.continues[0] === 50); // native numbers
  assert.equal((await post("/api/lumi-soft/start", { mode: "story", score: 5 })).status, 422);
  assert.equal((await post("/api/lumi-soft/start", { mode: "cheat" })).status, 422);
  const t = (await post("/api/lumi-soft/start", { mode: "training" })).body;
  const recorded = run("training");
  assert.equal((await post("/api/lumi-soft/finish", { ...recorded.log, run: t.run, score: 99999 })).status, 422);
  const out = (await post("/api/lumi-soft/finish", { ...recorded.log, run: t.run })).body;
  assert.match(out.refused, /add up/);                                               // 11 s of play, finished at once
  const s = (await post("/api/lumi-soft/start", { mode: "stage", stage: "garden" })).body;
  assert.equal(s.charged, 5);                                                        // 25 native -> 5 SGC
  const cont = await post("/api/lumi-soft/continue", { run: s.run });
  assert.equal(cont.body.paid, 10);                                                  // 50 native -> 10 SGC
  assert.equal(cont.body.next_continue, 100);                                        // native, for LumiPrice
});

test("a long story log fits (bigger than the router's 16 KB), and a huge one is 413", async () => {
  const t = (await post("/api/lumi-soft/start", { mode: "story" })).body;
  const log = run("story").log;
  const padded = { ...log, run: t.run, shots: [...log.shots, ...Array(1500).fill([0, 1.5, 2.5])] }; // > 16 KB of JSON
  assert.ok(JSON.stringify(padded).length > 16 * 1024);
  const out = await post("/api/lumi-soft/finish", padded);
  assert.equal(out.status, 200, JSON.stringify(out.body).slice(0, 200));             // read, replayed (and refused: too fast)
  const t2 = (await post("/api/lumi-soft/start", { mode: "training" })).body;
  const huge = await post("/api/lumi-soft/finish", { run: t2.run, end: 0, shots: Array(60_000).fill([0, 1.5, 2.5]) });
  assert.equal(huge.status, 413);
});
