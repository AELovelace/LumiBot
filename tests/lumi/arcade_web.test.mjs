// The arcade API over real HTTP (src/lumi/routes/arcade.js; erinne tests/test_arcade.py "API"): a solo Lumi Conga run
// with its strict claim checks, the three slugs only, logged-out 401s, showdown tables kept to their players, live
// board shapes, a big snake finish body past the router's 16 KB cap, and the table stream in erinne's SSE format.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { boot, setBalance } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
process.env.WEB_PANEL_SESSION_SECRET = "test-secret-test-secret-test-secret-123"; // sessions need a signing secret
const { eco, lumi } = boot();                                             // in-memory economy + Lumi
const auth = require("../../src/webPanelAuth.js");                        // to fake a Discord login
const events = require("../../src/lumi/events.js");                       // open-stream count
const ME = "222222222222222222";                                          // a Discord-shaped player
const YOU = "333333333333333333";                                         // a second player
setBalance(eco, ME, 1000);                                                // their SGC
setBalance(eco, YOU, 1000);                                               // their SGC
setBalance(eco, eco.LUMI_TOWN_BANK_USER_ID, 100000);                      // the bank can pay
const cookie = (id, name) => `lumi_sess=${encodeURIComponent(auth.createSession(id, name, "", []))}`; // a logged-in browser
const MINE = cookie(ME, "Doll");                                          // me
const YOURS = cookie(YOU, "Pal");                                         // the other player

const server = http.createServer((req, res) => {                          // the hook gameWebServer uses
  const url = new URL(req.url, `http://${req.headers.host}`);             // parsed URL
  lumi.handleLumiRequest(req, res, url).then((handled) => { if (!handled) { res.writeHead(404); res.end("not lumi"); } }); // Lumi or 404
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));               // random free port
const PORT = server.address().port;                                       // which one
const ORIGIN = `http://127.0.0.1:${PORT}`;                                // same-origin header for writes
after(() => { lumi.stopLumiGames(); server.close(); });                   // tidy up

// One request; resolves { status, body (parsed JSON when possible) }.
function request(path, { method = "GET", who = MINE, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "content-type": "application/json" }; // a same-origin page
    if (who) headers.cookie = who;                                        // logged in (or not)
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => {
      let data = "";                                                      // the answer
      res.setEncoding("utf8");                                            // text
      res.on("data", (c) => { data += c; });                              // collect
      res.on("end", () => { let parsed = data; try { parsed = JSON.parse(data); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: parsed }); }); // done
    });
    req.on("error", reject);                                              // network trouble
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body)); // the JSON body
    req.end();                                                            // send
  });
}
const post = (path, body, who) => request(path, { method: "POST", body: body === undefined ? {} : body, who }); // shorthand

test("the page plays a solo run: entry in SGC, strict claims, replayed score", async () => {
  const run = await post("/lumipet/api/snake/run");                       // start
  assert.equal(run.status, 200);                                          // ok
  assert.ok(run.body.seed);                                               // a seed
  assert.equal(run.body.coins, 1000 - 5);                                 // 25 native -> 5 SGC
  const finish = "/lumipet/api/snake/run/finish";                         // where runs end
  assert.equal((await post(finish, { run: run.body.run, moves: 10, died: true, coins: 999 })).status, 422); // extra field
  assert.equal((await post(finish, { run: run.body.run, moves: "10", died: true })).status, 422); // a string number
  assert.equal((await post(finish, { run: run.body.run, moves: 9, died: true })).status, 422);   // it didn't die there
  const out = await post(finish, { run: run.body.run, moves: 10, died: true });                  // into the wall at move 10
  assert.equal(out.status, 200);                                          // counted
  assert.equal(out.body.score, 0);                                        // the replay's score
  assert.equal(out.body.paid, 0);                                         // nothing to pay
  assert.equal(eco.getBalance(ME), 1000 - 5);                             // only the entry moved
  assert.equal((await post("/lumipet/api/stickbob-runner/run")).status, 404); // not an arcade game
  assert.equal((await post("/lumipet/api/snake/run", {}, null)).status, 401); // logged out
});

test("a long Lumi Conga claim may be bigger than the router's 16 KB body cap", async () => {
  const run = await post("/lumipet/api/snake/run");                       // start
  const turns = Array.from({ length: 3000 }, (_, i) => [3000 - i, i % 2 ? 1 : 3]); // ~30 KB, out of order on purpose
  const big = await post("/lumipet/api/snake/run/finish", { run: run.body.run, moves: 4000, turns, died: true }); // a big body
  assert.equal(big.status, 422);                                          // read and checked (not 413)
  assert.match(big.body.detail, /out of order/);                          // the replay's own refusal
});

test("the page keeps tables to their players", async () => {
  const table = await post("/lumipet/api/breakout/tables");               // start a table
  assert.equal(table.status, 200);                                        // ok
  const code = table.body.code;                                           // its code
  assert.equal(table.body.entry, 5);                                      // SGC per racer
  assert.ok((await request("/lumipet/api/breakout/tables")).body.tables[0].mine); // listed as mine
  const board = { score: 3, level: 1, bat: 0.5, balls: [[0.5, 0.9]], bricks: "0".repeat(108) }; // a live board
  assert.equal((await post(`/lumipet/api/breakout/tables/${code}/board`, board)).status, 409); // not racing
  assert.equal((await post(`/lumipet/api/breakout/tables/${code}/board`, { ...board, bricks: "x" })).status, 422); // bad shape
  assert.equal((await post(`/lumipet/api/breakout/tables/${code}`, { action: "bet", target: "p3" })).status, 422); // no P3
  assert.equal((await post(`/lumipet/api/breakout/tables/${code}`, { action: "dance" })).status, 422); // not an action
  assert.deepEqual((await post(`/lumipet/api/breakout/tables/${code}`, { action: "leave" })).body, { left: true }); // leave
  assert.equal((await request(`/lumipet/api/breakout/tables/${code}`)).status, 404); // closed
  assert.equal((await request(`/lumipet/api/breakout/tables/${code}/stream`)).status, 404); // no stream either
});

test("the conga's board shape: colours only", async () => {
  const code = (await post("/lumipet/api/snake/tables")).body.code;       // a Lumi Conga table
  const board = { score: 1, length: 4, alive: true, points: [0.5, 0.5], food: [1, 2, 3], kinds: "1223" }; // a good shape
  assert.equal((await post(`/lumipet/api/snake/tables/${code}/board`, board)).status, 409); // accepted shape; not racing yet
  assert.equal((await post(`/lumipet/api/snake/tables/${code}/board`, { ...board, kinds: "<b>" })).status, 422); // refused
  await post(`/lumipet/api/snake/tables/${code}`, { action: "leave" });   // tidy
});

test("the table stream: hello, the table first, then changes, per viewer", async () => {
  const code = (await post("/lumipet/api/teacup-tower/tables")).body.code; // my table
  assert.equal((await request(`/lumipet/api/teacup-tower/tables/${code}/stream`, { who: YOURS })).status, 403); // not seated: no stream
  const text = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: `/lumipet/api/teacup-tower/tables/${code}/stream`, headers: { host: `127.0.0.1:${PORT}`, cookie: MINE } }, (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8"); // SSE
      let got = "";                                                       // what arrived
      let joined = false;                                                 // the second player joined yet?
      res.setEncoding("utf8");                                            // text
      res.on("data", (c) => {
        got += c;                                                         // collect
        if (!joined && got.includes("event: table")) { joined = true; post(`/lumipet/api/teacup-tower/tables/${code}`, { action: "join" }, YOURS); } // someone joins
        if ((got.match(/event: table/g) || []).length >= 2) { req.destroy(); resolve(got); } // the change arrived
      });
    });
    req.on("error", (e) => { if (e.code !== "ECONNRESET") reject(e); });  // our own hang-up is fine
    req.end();                                                            // open it
  });
  assert.ok(text.startsWith(": hello\n\n"));                              // erinne's first line
  const tables = text.split("\n\n").filter((f) => f.startsWith("event: table")).map((f) => JSON.parse(f.split("data: ")[1])); // the table events
  assert.equal(tables[0].seats.length, 1);                                // just me at first
  assert.equal(tables[1].seats.length, 2);                                // then Pal
  assert.equal(tables[1].role, "p1");                                     // still MY view (per viewer)
  await new Promise((r) => setTimeout(r, 50));                            // let the close land
  assert.equal(events.openCount(), 0);                                    // the stream cleaned up
});
