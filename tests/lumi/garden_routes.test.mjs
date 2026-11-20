// POST /lumipet/api/lumi-pet/garden over HTTP (src/lumi/routes/garden.js -> lumipet.gardenAct -> lumigarden.act),
// ported from erinne test_lumigarden.py's API test: the page sends choices, never amounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "./minis_http.mjs";

const ME = "555555555555555555";                                                     // a Discord-shaped id
const { env, post, anon } = await serve(ME, "Doll");                                 // logged-in harness
const URL_ = "/api/lumi-pet/garden";                                                 // the route

test("the garden takes choices and never amounts", async () => {
  const first = await post(URL_, { action: "look" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const garden = first.body.garden;
  assert.ok(garden.plots.length === 4 && garden.powder === 0 && garden.water.show === null);
  const planted = await post(URL_, { action: "plant", plot: 0, item: "moondaisy" });
  assert.deepEqual(planted.body.said, { planted: "moondaisy" });
  assert.equal(planted.body.garden.plots[0].stage, "growing");
  const early = await post(URL_, { action: "trim", plot: 0 });
  assert.equal(early.status, 400);                                                   // not ready: refused with words
  assert.match(early.body.detail, /ready to trim/);
  assert.equal((await post(URL_, { action: "press", count: 5 })).body.said.coins, 0);
  for (const body of [{ action: "press", count: 5, powder: 999 }, { action: "harvest" }, { action: "press", count: 99999 }, { action: "plant", plot: 16, item: "moondaisy" },
    { action: "water_answer", picks: [4] }, { action: "water_answer", picks: Array(13).fill(0) }, { action: "trim", plot: "0" }, { action: "press", coins: 5 }]) {
    assert.equal((await post(URL_, body)).status, 422, JSON.stringify(body));        // only choices
  }
  assert.equal((await anon(URL_, { method: "POST", body: { action: "look" } })).status, 401);
});

test("a plot is paid in SGC to the Starpowder Nursery; not enough SGC is a 402", async () => {
  const bought = await post(URL_, { action: "plot" });
  assert.equal(bought.status, 200, JSON.stringify(bought.body));
  assert.deepEqual(bought.body.said, { bought: "plot", paid: 5 });                   // 25 native x 0.2
  assert.equal(env.eco.getBalance("__LUMI_NURSERY__"), 5);
  env.eco.getEconomyDb().prepare("UPDATE accounts SET balance = 1 WHERE user_id = ?").run(ME);
  const poor = await post(URL_, { action: "plot" });
  assert.equal(poor.status, 402);
  assert.equal(poor.body.code, "not_enough_sgc");
  assert.match(poor.body.detail, /Not enough SGC for another plot/);
});
