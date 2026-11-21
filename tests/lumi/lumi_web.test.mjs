// src/lumi over real HTTP (a throwaway server on a random port, no Discord): the login redirect, static files and
// their path checks, the coin chip with a faked lumi_sess session, page rendering (script order, CSP-friendly boot),
// aliases, 404s, the same-origin guard, the per-player money lock, an SSE stream in erinne's wire format, and Sign out.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { boot, setBalance } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
process.env.WEB_PANEL_SESSION_SECRET = "test-secret-test-secret-test-secret-123"; // sessions need a signing secret
const { eco, lumi } = boot();                                         // in-memory economy + Lumi
const auth = require("../../src/webPanelAuth.js");                    // to fake a Discord login
const events = require("../../src/lumi/events.js");                   // pub/sub + SSE
const ME = "777777777777777777";                                      // a Discord-shaped player id
setBalance(eco, ME, 1234);                                            // their SGC
const COOKIE = `lumi_sess=${encodeURIComponent(auth.createSession(ME, "Doll", "", []))}`; // a logged-in browser

let release = null;                                                   // lets the slow test route finish
lumi.getRouter().route("POST", "/api/test/slow", () => new Promise((r) => { release = () => r({ ok: true }); }), { money: true }); // holds the money lock
lumi.getRouter().route("GET", "/api/test/stream", (ctx) => { events.sse(ctx, "test", { onOpen: (s) => s.send("hello-state", { n: 1 }) }); }); // an SSE route

const server = http.createServer((req, res) => {                      // the hook gameWebServer uses
  const url = new URL(req.url, `http://${req.headers.host}`);         // like gameWebServer's parseUrl
  lumi.handleLumiRequest(req, res, url).then((handled) => { if (!handled) { res.writeHead(404); res.end("not lumi"); } });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));           // random free port
const PORT = server.address().port;
after(() => { lumi.stopLumiGames(); server.close(); });               // tidy up

// One request; resolves { status, headers, body }.
function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

test("the front door goes to her house, and her house asks for login when there is no session", async () => {
  const r = await request("/lumipet/");                               // no hub: the front door
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, "/lumipet/lumi-pet");              // straight to Lumi Pet
  const house = await request("/lumipet/lumi-pet");                   // logged out
  assert.equal(house.status, 302);
  assert.equal(house.headers.location, "/lumipet/login?next=%2Flumipet%2Flumi-pet"); // login, then back to her house
  const bare = await request("/lumipet");
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.location, "/lumipet/");
  const login = await request("/lumipet/login?next=/lumipet/breakout");
  assert.equal(login.status, 200);
  assert.match(login.body, /auth\/discord\/login\?mode=member&amp;next=%2Flumipet%2Fbreakout/);
  const evil = await request("/lumipet/login?next=//evil.example/x");
  assert.match(evil.body, /next=%2Flumipet%2F"/);                      // off-site next is replaced by the hub
});

test("static files: served with the right type, traversal and odd paths are 404", async () => {
  const js = await request("/lumipet/static/common.js");
  assert.equal(js.status, 200);
  assert.match(js.headers["content-type"], /^text\/javascript/);
  assert.match(js.body, /LUMI_API/);
  assert.equal(js.headers["x-content-type-options"], "nosniff");
  assert.match(js.headers["cache-control"], /max-age=3600/);
  const versioned = await request("/lumipet/static/common.js?v=1");
  assert.match(versioned.headers["cache-control"], /immutable/);
  assert.equal((await request("/lumipet/static/../x")).status, 404);                 // normalised to /lumipet/x: no such page
  assert.equal((await request("/lumipet/static/%2e%2e/package.json")).status, 404);  // encoded dots
  assert.equal((await request("/lumipet/static/lumi-pet/..%2f..%2f..%2fpackage.json")).status, 404); // encoded slashes
  assert.equal((await request("/lumipet/static/lumi-pet/%5c..%5cgame.js")).status, 404); // backslashes
  assert.equal((await request("/lumipet/static/nope.exe")).status, 404);             // not on the allowlist
  assert.equal((await request("/lumipet/static/arcade")).status, 404);               // a folder
  const png = await request("/lumipet/static/icons/lumi-192.png");
  assert.equal(png.headers["content-type"], "image/png");
});

test("the coin chip needs a session, then shows the SGC balance", async () => {
  const anon = await request("/lumipet/api/coins");
  assert.equal(anon.status, 401);
  assert.equal(JSON.parse(anon.body).code, "login_required");
  const r = await request("/lumipet/api/coins", { headers: { cookie: COOKIE } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { coins: 1234 });
  const other = await request("/lumipet/api/coins", { headers: { cookie: COOKIE.replace("lumi_sess", "sgc_panel_sess") } });
  assert.equal(other.status, 401);                                    // the panel's cookie name doesn't log into Lumi
});

test("pages render with the boot data and erinne's script order; aliases redirect; unknown pages 404", async () => {
  const front = await request("/lumipet/", { headers: { cookie: COOKIE } });
  assert.equal(front.status, 302);                                    // logged in: still no hub
  assert.equal(front.headers.location, "/lumipet/lumi-pet");          // her house
  const page = await request("/lumipet/lumi-pet", { headers: { cookie: COOKIE } });
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /script-src 'self'/);
  const scripts = [...page.body.matchAll(/<script src="\/lumipet\/static\/([^"?]+)\?v=/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(0, 2), ["lumi-boot.js", "lumi-tuning.js"]);          // globals first
  assert.equal(scripts[2], "common.js");
  assert.equal(scripts[3], "lumi-pet/rules.js");
  assert.equal(scripts.at(-1), "lumi-pet/game.js");
  assert.ok(scripts.indexOf("lumi-pet/estate-art.js") < scripts.indexOf("lumi-pet/city-map.js")); // kit order kept
  assert.ok(scripts.includes("lumi-pet/town-inside.js") && scripts.includes("lumi-pet/walker.js") && scripts.includes("gamepad.js"));
  assert.doesNotMatch(page.body, /<script>(?!<)/);                    // no inline JavaScript at all
  assert.match(page.body, /<figure class="lp-estate-card" id="lp-estate-card" hidden>/); // Lumi Realty's preview card, tucked away until a row is highlighted
  const bootJson = /<script type="application\/json" id="lumi-boot">([^<]*)<\/script>/.exec(page.body)[1];
  const bootData = JSON.parse(bootJson);
  assert.equal(bootData.api, "/lumipet/api/");
  assert.equal(bootData.user.id, ME);
  assert.equal(bootData.tuning.scale, 0.2);                           // play scale: entries, continues, bets and prizes
  assert.equal(bootData.tuning.itemScale, 1);                         // item scale: shop items keep erinne's prices
  assert.deepEqual(bootData.flags, { tvPlay: false, whoPlays: false, retro: false });
  const arcade = await request("/lumipet/breakout", { headers: { cookie: COOKIE } });
  assert.match(arcade.body, /Play solo \(5 SGC\)/);                   // the tuned entry price
  const alias = await request("/lumipet/yarn-pop?x=1", { headers: { cookie: COOKIE } });
  assert.equal(alias.status, 302);
  assert.equal(alias.headers.location, "/lumipet/breakout?x=1");
  assert.equal((await request("/lumipet/no-such-game", { headers: { cookie: COOKIE } })).status, 404);
  assert.equal((await request("/lumipet/lumi-soft")).status, 302);   // a real page while logged out -> login
});

test("writes are same-origin only, bodies must be JSON objects, and money routes take one action at a time", async () => {
  const cross = await request("/lumipet/api/test/slow", { method: "POST", headers: { cookie: COOKIE, origin: "https://evil.example", "content-type": "application/json" }, body: {} });
  assert.equal(cross.status, 403);
  const origin = `http://127.0.0.1:${PORT}`;
  const bad = await request("/lumipet/api/test/slow", { method: "POST", headers: { cookie: COOKIE, origin }, body: "[1,2" });
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.body).code, "bad_json");
  const first = request("/lumipet/api/test/slow", { method: "POST", headers: { cookie: COOKIE, origin }, body: {} }); // holds the lock
  await new Promise((r) => setTimeout(r, 50));
  const second = await request("/lumipet/api/test/slow", { method: "POST", headers: { cookie: COOKIE, origin }, body: {} });
  assert.equal(second.status, 409);
  assert.equal(JSON.parse(second.body).code, "busy");
  release();
  assert.equal((await first).status, 200);
  const wrongMethod = await request("/lumipet/api/coins", { method: "POST", headers: { cookie: COOKIE, origin }, body: {} });
  assert.equal(wrongMethod.status, 405);
});

test("SSE streams speak erinne's format: hello, named events, and published events", async () => {
  const chunks = [];
  await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/lumipet/api/test/stream", headers: { host: `127.0.0.1:${PORT}`, cookie: COOKIE } }, (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
      assert.equal(res.headers["x-accel-buffering"], "no");
      res.setEncoding("utf8");
      res.on("data", (c) => {
        chunks.push(c);
        const text = chunks.join("");
        if (text.includes("event: hello-state") && !text.includes("event: said")) events.publish("test", "said", { id: "x1", text: "hi <3" }); // publish once the stream is open
        if (text.includes("event: said")) { req.destroy(); resolve(); }
      });
    });
    req.on("error", (e) => (e.code === "ECONNRESET" ? resolve() : reject(e)));
    req.end();
  });
  const text = chunks.join("");
  assert.ok(text.startsWith(": hello\n\n"));
  assert.match(text, /event: hello-state\ndata: \{"n":1\}\n\n/);
  assert.match(text, /event: said\ndata: \{"id":"x1","text":"hi <3"\}\n\n/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(events.openCount(), 0);                                // the stream cleaned up after the browser left
});

test("Sign out: POST auth/logout ends the session, and her house asks for login again", async () => {
  const mine = `lumi_sess=${encodeURIComponent(auth.createSession(ME, "Doll", "", []))}`; // its own session, so the other tests keep theirs
  const origin = `http://127.0.0.1:${PORT}`;                          // the page's own origin, as the browser's fetch sends it
  assert.equal((await request("/lumipet/lumi-pet", { headers: { cookie: mine } })).status, 200); // signed in: her house
  const cross = await request("/lumipet/auth/logout", { method: "POST", headers: { cookie: mine, origin: "https://evil.example" } }); // another site
  assert.equal(cross.status, 403);                                    // the router's cross-site guard
  assert.equal((await request("/lumipet/lumi-pet", { headers: { cookie: mine } })).status, 200); // ...and nothing was ended
  const out = await request("/lumipet/auth/logout", { method: "POST", headers: { cookie: mine, origin } }); // the Sign out row's fetch
  assert.equal(out.status, 302);                                      // a redirect...
  assert.equal(out.headers.location, "/lumipet/login");               // ...to the login page
  const cleared = [].concat(out.headers["set-cookie"] || []).join("\n"); // the cookie it clears
  assert.match(cleared, /lumi_sess=;/);                               // Lumi's own cookie, emptied
  assert.match(cleared, /Max-Age=0/);                                 // and expired now
  assert.match(cleared, /Path=\/lumipet/);                            // on the path it was set with
  const later = await request("/lumipet/lumi-pet", { headers: { cookie: mine } }); // even an old copy of the cookie...
  assert.equal(later.status, 302);                                    // ...is no longer a session
  assert.equal(later.headers.location, "/lumipet/login?next=%2Flumipet%2Flumi-pet"); // login, then back to her house
  assert.equal((await request("/lumipet/api/coins", { headers: { cookie: mine } })).status, 401); // the API agrees
});

test("Lumi Pet's settings list ends with a Sign out row that posts to auth/logout, with no inline handlers", async () => {
  const js = (await request("/lumipet/static/lumi-pet/game.js")).body; // the page's script, as served
  assert.match(js, /settings\.push\(\{ key: "sign-out", icon: "↪", name: "Sign out", hint: "Log out of Lumi-Town on this device", local: signOut \}\);/); // the row
  assert.match(js, /\n {4}settings\.push\(\{ key: "sign-out"[^\n]*\n {4}return settings;/); // last in the list
  assert.match(js, /fetch\(window\.LUMI_PAGES \+ "auth\/logout", \{ method: "POST", credentials: "same-origin", redirect: "manual"/); // a same-origin POST
  assert.match(js, /location\.href = window\.LUMI_PAGES \+ "login";/); // then the login page
  const page = await request("/lumipet/lumi-pet", { headers: { cookie: COOKIE } }); // her house
  assert.doesNotMatch(page.body, /\son[a-z]+=/i);                     // no inline event handlers (CSP script-src 'self')
});
