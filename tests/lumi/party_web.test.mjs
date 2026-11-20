// Lumi Party over real HTTP (src/lumi/routes/party.js): make, list, join, ready, set out, the move checks (erinne's
// pydantic 422s), no TV parties, leaving, and the live stream (": hello", "party" first, "party" on change, "end").
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { env, P, db, TRIO, clear } from "./party_harness.mjs";

const require = createRequire(import.meta.url);
process.env.WEB_PANEL_SESSION_SECRET = "test-secret-test-secret-test-secret-123"; // sessions need a signing secret
const { lumi } = env;                                                    // the booted Lumi-Town
const authStore = require("../../src/webPanelAuth.js");                 // to fake a Discord login
const [doll, jane] = TRIO;                                               // two players
const cookie = (id, name) => `lumi_sess=${encodeURIComponent(authStore.createSession(id, name, "", []))}`; // a logged-in browser
const DOLL = cookie(doll, "doll");                                       // doll's browser
const JANE = cookie(jane, "jane");                                       // jane's browser

const server = http.createServer((req, res) => {                         // like gameWebServer
  const url = new URL(req.url, `http://${req.headers.host}`);            // parsed
  lumi.handleLumiRequest(req, res, url).then((handled) => { if (!handled) { res.writeHead(404); res.end("not lumi"); } }); // Lumi or 404
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));              // a free port
const PORT = server.address().port;                                      // which
const ORIGIN = `http://127.0.0.1:${PORT}`;                                // same-origin header for POSTs
after(() => { lumi.stopLumiGames(); server.close(); });                  // tidy up

function request(path, { method = "GET", who = DOLL, body } = {}) {      // one request -> { status, json }
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${PORT}`, cookie: who };          // logged in
    if (method !== "GET") Object.assign(headers, { origin: ORIGIN, "content-type": "application/json" }); // a write
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/lumipet/api" + path, method, headers }, (res) => {
      let data = "";                                                     // the body
      res.setEncoding("utf8");                                           // text
      res.on("data", (c) => { data += c; });                             // collect
      res.on("end", () => { let json = null; try { json = JSON.parse(data); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, body: data }); }); // done
    });
    req.on("error", reject);                                             // network trouble
    if (body !== undefined) req.write(JSON.stringify(body));             // the JSON body
    req.end();                                                           // send
  });
}

function stream(path, who) {                                             // open an SSE stream -> { events, next(name), close() }
  const got = [];                                                        // [event, data] received
  const waiters = [];                                                    // pending next() calls
  let buf = "";                                                          // partial frames
  let req = null;                                                        // the request
  const ready = new Promise((resolve, reject) => {
    req = http.request({ host: "127.0.0.1", port: PORT, path: "/lumipet/api" + path, headers: { host: `127.0.0.1:${PORT}`, cookie: who } }, (res) => {
      resolve(res);                                                      // headers are in
      res.setEncoding("utf8");                                           // text
      res.on("data", (c) => {
        buf += c;                                                        // add
        let at;                                                          // frame end
        while ((at = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, at);                                // one frame
          buf = buf.slice(at + 2);                                       // the rest
          const ev = /^event: (.+)$/m.exec(frame);                       // its name
          const data = /^data: (.+)$/m.exec(frame);                      // its JSON
          got.push(ev ? [ev[1], JSON.parse(data[1])] : ["comment", frame]); // remember
          for (const w of waiters.splice(0)) w();                        // wake waiters
        }
      });
      res.on("end", () => { got.push(["closed", null]); for (const w of waiters.splice(0)) w(); }); // the server ended it
    });
    req.on("error", reject);                                             // trouble
    req.end();                                                           // send
  });
  let seen = 0;                                                          // events consumed by next()
  async function next(name, ms = 3000) {                                 // the next event with this name
    const until = Date.now() + ms;                                       // give up after
    for (;;) {
      while (seen < got.length) { const e = got[seen++]; if (e[0] === name) return e[1]; } // found
      if (Date.now() > until) throw new Error(`no "${name}" event (got ${got.map((e) => e[0]).join(",")})`); // timed out
      await new Promise((r) => { waiters.push(r); setTimeout(r, 100); }); // wait a bit
    }
  }
  return { ready, got, next, close: () => req.destroy() };               // the handle
}

test("a party through the page: make, list, join, ready, set out, check moves, leave", async () => {
  clear();                                                               // nobody in a party
  const made = await request("/lumi-pet/parties", { method: "POST", body: { mode: "online" } }); // doll makes one
  assert.equal(made.status, 200, made.body);                             // ok
  const code = made.json.code;                                           // its code
  assert.equal(made.json.you, doll);                                     // doll is in it
  const couch = await request("/lumi-pet/parties", { method: "POST", body: { mode: "couch" } }); // a TV party
  assert.equal(couch.status, 400);                                       // not here
  const listed = await request("/lumi-pet/parties", { who: JANE });      // jane looks
  assert.equal(listed.json.parties[0].code, code);                       // listed
  assert.equal(listed.json.mine, null);                                  // not hers yet
  const base = `/lumi-pet/parties/${code}`;                              // the party's URL
  assert.equal((await request(base, { method: "POST", who: JANE, body: { action: "join" } })).json.you, jane); // jane joins
  for (const who of [DOLL, JANE]) assert.equal((await request(base, { method: "POST", who, body: { action: "ready" } })).status, 200); // both ready
  const started = await request(base, { method: "POST", body: { action: "start" } }); // set out
  assert.equal(started.json.phase, "trip");                              // out
  assert.equal((await request(base, { method: "POST", body: { action: "vote", target: "<script>" } })).status, 422); // erinne's pattern check
  assert.equal((await request(base, { method: "POST", body: { action: "vote", extra: 1 } })).status, 422); // extra fields refused
  assert.equal((await request(base, { method: "POST", body: { action: "vote", target: `m${jane}` } })).status, 400); // a valid shape, but not a choice now
  assert.equal((await request(base, { method: "POST", body: { action: "fight", target: "run", foe: 7 } })).status, 422); // foe out of range
  assert.equal((await request(base, { method: "POST", who: JANE, body: { action: "abandon" } })).status, 200); // jane gives up
  const look = await request(base, { who: JANE });                       // jane looks again
  assert.equal(look.status, 200);                                        // still answers
  assert.equal(look.json.you, null);                                     // not a member
  assert.equal((await request(base + "/stream", { who: JANE })).status, 403); // no stream for non-members
  assert.equal((await request("/lumi-pet/parties/ZZZZ0000")).status, 404); // no such party
});

test("the live stream: hello, the party first, a change from a friend, then end when I leave", async () => {
  clear();                                                               // nobody in a party
  const code = (await request("/lumi-pet/parties", { method: "POST", body: {} })).json.code; // doll's party (mode defaults online)
  const base = `/lumi-pet/parties/${code}`;                              // its URL
  await request(base, { method: "POST", who: JANE, body: { action: "join" } }); // jane joins
  const live = stream(base + "/stream", DOLL);                           // doll watches
  const res = await live.ready;                                          // headers
  assert.equal(res.statusCode, 200);                                     // a stream
  assert.match(res.headers["content-type"], /^text\/event-stream/);      // SSE
  const first = await live.next("party");                               // the first state
  assert.equal(live.got[0][1], ": hello");                               // erinne's hello comes first
  assert.equal(first.code, code);                                        // this party
  assert.equal(first.members.length, 2);                                 // both
  await request(base, { method: "POST", who: JANE, body: { action: "ready" } }); // jane changes something
  const changed = await live.next("party");                              // relayed to doll
  assert.ok(changed.revision > first.revision);                          // a newer revision
  assert.equal(changed.members[1].ready, true);                          // jane is ready
  assert.equal(changed.you, doll);                                       // as doll sees it
  await request(base, { method: "POST", body: { action: "leave" } });    // doll leaves the lobby
  const end = await live.next("end");                                    // the stream says goodbye
  assert.match(end.reason, /left the party|broken up/);                  // erinne's words
  await live.next("closed");                                             // and closes
  assert.equal(P.codeOf(doll), null);                                    // doll is free
  assert.equal(db.getDb().prepare("SELECT 1 FROM lumi_parties WHERE code = ?").get(code) !== undefined, true); // jane's party lives on
});
