// Lumi Dungeons over real HTTP (src/lumi/routes/dungeon.js), ported from erinne test_lumibattle.py / test_lumidungeon.py
// "through the page" tests: a fight and a trip, and the page can never name an enemy, a room, a result or a number.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { env, BANK } from "./dungeon_helpers.mjs";
import { setBalance } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
process.env.WEB_PANEL_SESSION_SECRET = process.env.WEB_PANEL_SESSION_SECRET || "test-secret-test-secret-test-secret-123"; // sessions need a secret
const auth = require("../../src/webPanelAuth.js");                                    // to fake a Discord login
const ME = "777777777777777001";                                                       // a Discord-shaped player id
setBalance(env.eco, ME, 1000);                                                         // their SGC
setBalance(env.eco, BANK, 1_000_000);                                                  // the bank can pay
const COOKIE = `lumi_sess=${encodeURIComponent(auth.createSession(ME, "Doll", "", []))}`; // a logged-in browser

const server = http.createServer((req, res) => {                                       // the hook gameWebServer uses
  const url = new URL(req.url, `http://${req.headers.host}`);                          // the URL
  env.lumi.handleLumiRequest(req, res, url).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }); // Lumi or 404
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));                            // a free port
const PORT = server.address().port;                                                    // which
const ORIGIN = `http://127.0.0.1:${PORT}`;                                             // same-origin
after(() => { env.lumi.stopLumiGames(); server.close(); });                            // tidy up

// One JSON request; resolves { status, body }.
function call(path, body, { cookie = COOKIE, method = body === undefined ? "GET" : "POST" } = {}) {
  return new Promise((resolve, reject) => {                                            // a promise
    const headers = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) }; // headers
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/lumipet/api/" + path, method, headers }, (res) => { // the request
      let data = "";                                                                   // the body
      res.setEncoding("utf8");                                                         // text
      res.on("data", (c) => { data += c; });                                           // gather
      res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null })); // done
    });
    req.on("error", reject);                                                           // network trouble
    if (body !== undefined) req.write(JSON.stringify(body));                           // the body
    req.end();                                                                         // send
  });
}

test("a fight through the page", async () => {
  const fight = (await call("lumi-pet/battle", { tier: "common" })).body.fight;        // start
  assert.equal(fight.status, "active");                                                // under way
  assert.equal((await call("lumi-pet/battle", { tier: "common" })).status, 400);       // one at a time
  const turn = await call("lumi-pet/battle/act", { battle: fight.id, turn: 0, action: "defend" }); // a turn
  assert.equal(turn.status, 200);                                                      // fine
  assert.equal(turn.body.fight.turn, 1);                                               // counted
  assert.ok(!("enemies" in turn.body.battle));                                         // what she might meet stays a surprise
  assert.equal((await call("lumi-pet/battle/act", { battle: fight.id, turn: 0, action: "defend" })).status, 400); // stale
  for (const [url, body] of [["lumi-pet/battle/act", { battle: fight.id, turn: 1, action: "move0", damage: 9999 }], // a number
    ["lumi-pet/battle/act", { battle: fight.id, turn: 1, action: "win" }], ["lumi-pet/battle", { tier: "common", enemy: "dust-bunny" }], // a result, an enemy
    ["lumi-pet/battle/act", { battle: String(fight.id), turn: 1, action: "defend" }], ["lumi-pet/battle", { tier: "mythic" }]]) { // a string id, a tier
    assert.equal((await call(url, body)).status, 422, JSON.stringify(body));           // refused like erinne's models
  }
  assert.equal((await call("lumi-pet/battle", { tier: "common" }, { cookie: null })).status, 401); // logged out
  await call("lumi-pet/battle/act", { battle: fight.id, turn: 1, action: "run" });     // try to leave
});

test("a trip through the page", async () => {
  env.eco.getEconomyDb().prepare("DELETE FROM lumi_battles WHERE user_id = ?").run(ME); // no fight in the way
  assert.equal((await call("lumi-pet/dungeon", { env: "rooftop-garden" })).status, 400); // too soon
  const out = await call("lumi-pet/dungeon", { env: "crystal-cavern" });               // set out
  assert.equal(out.status, 200);                                                       // fine
  const run = out.body.dungeon.run;                                                    // the run
  assert.equal(run.env.name, "Crystal Cavern");                                        // the place
  assert.equal(run.room.kind, "start");                                                // the entrance
  const closed = ["n", "e", "s", "w"].find((w) => !run.room.exits.includes(w));        // a wall
  if (closed) assert.equal((await call("lumi-pet/dungeon/act", { action: "move", way: closed })).status, 400); // solid
  for (const body of [{ action: "move", way: "up" }, { action: "teleport" }, { action: "sokoban", moves: "rrx" }, { action: "leave", coins: 9999 }, // junk
    { action: "move", way: "n", to: "3,3" }, { action: "cup", picks: Array.from({ length: 300 }, (_, i) => i) }]) { // a room, too many picks
    assert.equal((await call("lumi-pet/dungeon/act", body)).status, 422, JSON.stringify(body)); // only choices
  }
  const home = await call("lumi-pet/dungeon/act", { action: "leave" });                // home at once
  assert.equal(home.body.dungeon.run.over, "home");                                    // home
  assert.equal(home.body.coins, env.sgc.balance(ME));                                  // the coin chip
  assert.equal((await call("lumi-pet/dungeon", { env: "crystal-cavern" }, { cookie: null })).status, 401); // logged out
});

test("no live storyteller: the tale routes always leave the library's line", async () => {
  assert.deepEqual((await call("lumi-pet/dungeon/tale")).body, { live: null });       // nobody to tell it
  assert.deepEqual((await call("lumi-pet/dungeon/tale", {})).body, { line: null });   // so no fresh line
});
