// Prism Drop's routes over HTTP (src/lumi/routes/prism.js): the player only says which pocket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "./minis_http.mjs";

const ME = "999999999999999999";                                                     // a Discord-shaped id
const { post, get, anon } = await serve(ME, "Doll");                                 // logged-in harness

test("ten drops over HTTP; only a pocket is accepted", async () => {
  assert.deepEqual((await get("/api/prism-drop/run")).body, { drops: 0, score: 0 });
  for (const body of [{ pick: 0 }, { pick: 11 }, { pick: "5" }, { pick: 5, score: 999 }, {}]) {
    assert.equal((await post("/api/prism-drop/drop", body)).status, 422, JSON.stringify(body));
  }
  let last;
  for (let n = 1; n <= 10; n++) {
    last = await post("/api/prism-drop/drop", { pick: 5 });
    assert.equal(last.status, 200);
    assert.equal(last.body.drops, n);
  }
  assert.equal(last.body.over, true);
  assert.ok(Array.isArray(last.body.round.trajectory));
  assert.equal(last.body.coins, 1000 + last.body.paid);                              // paid in SGC
  assert.deepEqual((await get("/api/prism-drop/run")).body, { drops: 0, score: 0 });
  assert.equal((await anon("/api/prism-drop/run")).status, 401);
});
