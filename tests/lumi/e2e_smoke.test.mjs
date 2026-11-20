// END-TO-END SMOKE for Lumi-Town (the integration pass): boots the REAL src/gameWebServer.js on an in-memory economy
// DB, seeds the treasury from a funded Central Bank, logs three fake Discord players in, and plays every game through
// its HTTP API the way the pages do. Each step checks the HTTP status, that the JSON is sane, and that SGC moved the
// right way: a spend lands in its themed shop account, a prize comes out of Lumi-Town Bank. It also renders every
// page and fetches every <script src> / <link href> on it (a missing file or a wrong path is a 404 here).
// This file catches the glue between modules (pet <-> battle <-> dungeon <-> garden <-> party, town <-> city <-> pet,
// arcade -> lumi-look) that each module's own unit tests can't see.
import { test, after } from "node:test"; // the test runner
import assert from "node:assert/strict"; // strict asserts
import http from "node:http"; // HTTP client + the admin page server
import net from "node:net"; // to find a free port
import { readFileSync } from "node:fs"; // the recorded fixtures
import { createRequire } from "node:module"; // require() from an ES module
import { boot, setBalance } from "./lumi_env.mjs"; // boot Lumi on an in-memory DB

const require = createRequire(import.meta.url); // CommonJS modules from here
process.env.WEB_PANEL_SESSION_SECRET = "test-secret-test-secret-test-secret-123"; // sessions need a signing secret
process.env.LUMI_API_RATE_BURST = process.env.LUMI_API_RATE_BURST || "100000";  // the smoke makes many calls from one IP
delete process.env.WEB_PANEL_TRUSTED_ORIGINS;                                     // only the server's own host is trusted
delete process.env.WEB_PANEL_BASE_PATH;                                           // admin pages at /lumi

const env = boot();                                                               // in-memory economy + exchange + Lumi-Town
const { eco, db, sgc, tuning, treasury, lumi } = env;                             // the stores
const auth = require("../../src/webPanelAuth.js");                                // to fake Discord logins
const save = require("../../src/lumi/pet/save.js");                               // pet saves (test setup only)
const lumidungeon = require("../../src/lumi/dungeon/lumidungeon.js");             // trips (test setup only)
const lumibattle = require("../../src/lumi/dungeon/lumibattle.js");               // fights (test setup only)
const lumicity = require("../../src/lumi/city/lumicity.js");                      // Lumi City's catalog + prices
const gws = require("../../src/gameWebServer.js");                                // the REAL games web server

// ------------------------------------------------------------------------------------------------ players + money

const A = "710000000000000001";                                                   // player A (Discord-shaped ids)
const B = "710000000000000002";                                                   // player B
const C = "710000000000000003";                                                   // player C (a watcher / move-in)
const NAMES = { [A]: "Ada", [B]: "Bea", [C]: "Cy" };                              // their Discord names
const BANK = eco.LUMI_TOWN_BANK_USER_ID;                                          // pays every prize
const CB = eco.CENTRAL_BANK_USER_ID;                                              // seeds the treasury
const SHOP = {                                                                    // the themed category accounts
  snacks: "__LUMI_SNACKS__", boutique: "__LUMI_BOUTIQUE__", capsules: "__LUMI_CAPSULES__", outfitters: "__LUMI_OUTFITTERS__", // pet shops
  nursery: "__LUMI_NURSERY__", arcade: "__LUMI_ARCADE__", realty: "__LUMI_REALTY__", // the other shops
}; // end of the shop list
const WATCHED = [A, B, C, ...eco.LUMI_ACCOUNT_IDS];                               // balances the deltas cover
const bal = (id) => eco.getBalance(id);                                           // one balance
const sql = () => eco.getEconomyDb();                                             // raw DB (test setup + checks only)

let now = Date.now();                                                             // the fake game clock (ms)
db.setClock(() => now);                                                           // every Lumi module reads db.nowMs()
const tick = (ms) => { now += ms; };                                              // move game time on

/** Run fn (async) and return { out, d } where d[id] = how much that balance changed. */
async function moved(fn) {
  const before = Object.fromEntries(WATCHED.map((id) => [id, bal(id)]));         // balances before
  const out = await fn();                                                         // the action
  const d = Object.fromEntries(WATCHED.map((id) => [id, bal(id) - before[id]]));  // the change per account
  return { out, d };                                                              // both
}

/** Only these accounts moved, by exactly these amounts (everything else 0). */
function onlyMoved(d, expected, label) {
  const want = Object.fromEntries(WATCHED.map((id) => [id, expected[id] || 0]));  // zeros for the rest
  assert.deepEqual(d, want, `${label}: SGC moved wrongly`);                        // exact
}

// ------------------------------------------------------------------------------------------------ the server

// A free TCP port (startGameWebServer can't take 0).
async function freePort() {
  const probe = net.createServer();                                               // throwaway listener
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));                      // the OS picks one
  const { port } = probe.address();                                               // which
  await new Promise((r) => probe.close(r));                                       // let it go
  return port;                                                                    // ours now
}
const PORT = await freePort();                                                    // where the games web server listens
gws.startGameWebServer({ port: PORT, host: "127.0.0.1" });                        // the real server (Lumi hook inside)
await new Promise((r) => setTimeout(r, 150));                                     // let it bind
const ORIGIN = `http://127.0.0.1:${PORT}`;                                        // same-origin header for writes
after(() => { db.setClock(null); lumi.stopLumiGames(); gws.stopGameWebServer(); }); // tidy up

const COOKIE = Object.fromEntries([A, B, C].map((id) => [id, `lumi_sess=${encodeURIComponent(auth.createSession(id, NAMES[id], "", []))}`])); // logged-in browsers

/** One HTTP request; resolves { status, headers, text, json }. */
function request(path, { method = "GET", who = A, body, raw } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${PORT}` };                                // our host
    if (who) headers.cookie = COOKIE[who];                                        // logged in as who
    if (method !== "GET") Object.assign(headers, { origin: ORIGIN, "content-type": "application/json" }); // a same-origin write
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => {
      let text = "";                                                              // the body
      res.setEncoding("utf8");                                                    // as text
      res.on("data", (c) => { text += c; });                                      // collect
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); }); // parse the body when it is JSON
    });
    req.on("error", reject);                                                      // network trouble
    if (raw !== undefined) req.write(raw);                                        // a raw body
    else if (body !== undefined) req.write(JSON.stringify(body));                 // a JSON body
    req.end();                                                                    // send
  });
}
const api = (path, who = A) => request(`/lumipet/api/${path}`, { who });          // GET an API path
const post = (path, body = {}, who = A) => request(`/lumipet/api/${path}`, { method: "POST", body, who }); // POST an API path

/** POST/GET that must be 200 with a JSON object; returns the JSON. */
async function ok(promise, label) {
  const r = await promise;                                                        // the answer
  assert.equal(r.status, 200, `${label}: HTTP ${r.status} ${r.text.slice(0, 300)}`); // 200
  assert.ok(r.json && typeof r.json === "object", `${label}: not JSON`);          // sane JSON
  return r.json;                                                                  // the body
}

/** Open an SSE stream: { ready, got: [[event, data]], next(name), close() }. */
function stream(path, who) {
  const got = [];                                                                 // frames so far
  const waiters = [];                                                             // next() calls waiting
  let buf = "";                                                                   // partial frame
  let req = null;                                                                 // the request
  const ready = new Promise((resolve, reject) => {
    req = http.request({ host: "127.0.0.1", port: PORT, path: `/lumipet/api/${path}`, headers: { host: `127.0.0.1:${PORT}`, cookie: COOKIE[who] } }, (res) => {
      resolve(res);                                                               // headers are in
      res.setEncoding("utf8");                                                    // text
      res.on("data", (c) => {
        buf += c;                                                                 // add
        let at;                                                                   // frame end
        while ((at = buf.indexOf("\n\n")) >= 0) { // one complete SSE frame at a time
          const frame = buf.slice(0, at);                                         // one frame
          buf = buf.slice(at + 2);                                                // the rest
          const ev = /^event: (.+)$/mu.exec(frame);                               // its name
          const data = /^data: (.+)$/mu.exec(frame);                              // its JSON
          got.push(ev ? [ev[1], JSON.parse(data[1])] : ["comment", frame]);       // remember
          for (const w of waiters.splice(0)) w();                                 // wake waiters
        }
      });
      res.on("error", () => {});                                                  // a destroyed stream
    });
    req.on("error", (e) => { if (e.code !== "ECONNRESET") reject(e); });          // trouble
    req.end();                                                                    // send
  });
  let seen = 0;                                                                   // frames consumed by next()
  async function next(name, ms = 3000) {                                          // the next frame with this name
    const until = Date.now() + ms;                                                // give up after
    for (;;) {
      while (seen < got.length) { const e = got[seen++]; if (e[0] === name) return e[1]; } // found
      if (Date.now() > until) throw new Error(`no "${name}" frame (got ${got.map((e) => e[0]).join(",")})`); // timed out
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });          // wait a little
    }
  }
  return { ready, got, next, close: () => req.destroy() };                        // the handle
}

/** Change a stored pet (test setup, like erinne's tests do). */
function setPet(uid, fn) {
  db.tx(() => { const pet = save.load(uid, { now }); fn(pet); save.save(uid, pet); }); // load, change, store
}

// ------------------------------------------------------------------------------------------------ the economy

test("setup: Central Bank seeds Lumi-Town, players get SGC", () => {
  setBalance(eco, CB, 5_000_000);                                                 // a funded Central Bank
  const r = treasury.seed(2_000_000, 1_000_000, 1_000_000, { who: "smoke" });     // half to the bank, half to Holdings
  assert.equal(r.centralBankLeft, 3_000_000);                                     // CB paid it
  assert.equal(bal(BANK), 1_000_000);                                             // the bank can pay prizes
  assert.equal(bal(eco.LUMI_HOLDINGS_USER_ID), 1_000_000);                        // the reserve
  for (const id of [A, B, C]) setBalance(eco, id, 100_000);                       // every player has SGC
  const log = sql().prepare("SELECT who, key FROM lumi_admin_log WHERE key = 'treasury.seed'").all(); // seed logs itself
  assert.deepEqual(log, [{ who: "smoke", key: "treasury.seed" }]);                // once, as the caller
});

// ------------------------------------------------------------------------------------------------ pages + files

const PAGES = ["lumi-pet", "lumi-dungeons", "lumi-garden", "lumi-town", "prism-drop", "lumi-launch", "lumi-soft", "breakout", "snake", "teacup-tower"]; // every page

test("every page renders and every script/stylesheet it loads is a real file", async () => {
  const hub = await request("/lumipet/");                                        // the hub
  assert.equal(hub.status, 200, hub.text.slice(0, 200));                          // renders
  const urls = new Set();                                                         // every asset URL seen
  const collect = (html) => {                                                     // <script src> + <link href>
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gu)) urls.add(m[1]); // scripts
    for (const m of html.matchAll(/<link[^>]*\shref="([^"]+)"/gu)) urls.add(m[1]);  // stylesheets, icons, manifests
  };
  collect(hub.text);                                                              // the hub's own
  for (const slug of PAGES) {
    const page = await request(`/lumipet/${slug}`);                               // the page
    assert.equal(page.status, 200, `${slug}: ${page.status} ${page.text.slice(0, 200)}`); // renders
    assert.match(page.text, new RegExp(`data-game="${slug}"`, "u"));             // the shell
    assert.doesNotMatch(page.text, /<script>(?!<\/script>)/u, `${slug}: inline script`); // CSP: no inline scripts
    collect(page.text);                                                           // its files
  }
  assert.ok(urls.size > 40, `only ${urls.size} assets found`);                    // the kits load many files
  const missing = [];                                                             // 404s
  for (const raw of urls) {
    if (/^(https?:)?\/\//u.test(raw) || raw.startsWith("data:")) continue;        // external (none expected)
    const url = raw.replace(/&amp;/gu, "&");                                      // HTML-escaped query
    const r = await request(url, { who: null });                                  // static files need no login
    if (r.status !== 200) missing.push(`${r.status} ${url}`);                     // broken
  }
  for (const sound of ["breakout/assets/bounce-2.wav", "breakout/assets/ball-lost.wav", "snake/assets/eat.wav"]) { // arcade sounds (new URL(file, game.js))
    const r = await request(`/lumipet/static/${sound}`, { who: null });            // as the page asks for it
    if (r.status !== 200) missing.push(`${r.status} ${sound}`);                    // broken
  }
  assert.deepEqual(missing, [], "assets that don't load");                       // every one loads
});

test("core: coins, me, lumi-look, tuning", async () => {
  assert.equal((await ok(api("coins"), "coins")).coins, 100_000);                 // the coin chip
  const me = await ok(api("me"), "me");                                           // who am I
  assert.deepEqual([me.id, me.name], [A, "Ada"]);                                 // the session
  const look = await ok(api("lumi-look"), "lumi-look");                           // her look (for arcade/lumi-sprite.js)
  assert.ok("glow" in look && "outfit" in look);                                  // drawable
  const t = await ok(api("tuning"), "tuning");                                    // window.LUMI_TUNING
  assert.ok(t.games && t.games.pet, "tuning lists the games");                   // per-game knobs
  assert.equal(t.games.pet.dailyCap, 0);                                          // uncapped by default (Doll's call)
});

// ------------------------------------------------------------------------------------------------ Lumi Pet

const price = (game, key, native) => tuning.scalePrice(game, key, native);        // what a spend charges
const prize = (game, key, native) => tuning.scalePayout(game, key, native);       // what a prize pays

test("pet: adopt, daily visit prize (once), snacks, feed, decor, wear, play", async () => {
  const first = await ok(api("lumi-pet/state"), "state");                         // her first look: adopted
  assert.ok(first.pet && first.pet.name, "a pet");                                // she exists
  for (const who of [B]) await ok(api("lumi-pet/state", who), "B adopts");       // B has a Lumi too (town needs her)
  const visit = await moved(() => ok(post("lumi-pet/visit"), "visit"));           // the daily visit prize
  assert.equal(visit.out.paid, prize("pet", "visit", 25));                        // 25 native -> 5 SGC
  onlyMoved(visit.d, { [A]: visit.out.paid, [BANK]: -visit.out.paid }, "visit");  // bank -> player
  const again = await moved(() => ok(post("lumi-pet/visit"), "visit again"));     // same LA day
  assert.equal(again.out.paid, 0);                                                // once a day
  onlyMoved(again.d, {}, "visit again");                                          // nothing moved
  const buy = await moved(() => ok(post("lumi-pet/act", { action: "buy", item: "banana", count: 2 }), "buy snacks")); // 2 bananas
  assert.equal(buy.out.said.paid, 2 * price("pet", "banana", 5));                 // per-unit charge
  onlyMoved(buy.d, { [A]: -buy.out.said.paid, [SHOP.snacks]: buy.out.said.paid }, "snacks"); // player -> Snack Stand
  const fed = await ok(post("lumi-pet/act", { action: "feed", item: "banana" }), "feed"); // eat one
  assert.equal(fed.pet.inventory.banana, 1);                                      // one left
  const decor = await moved(() => ok(post("lumi-pet/act", { action: "decorate", item: "wall-dusk" }), "decor")); // buy + place
  onlyMoved(decor.d, { [A]: -price("pet", "wall-dusk", 60), [SHOP.boutique]: price("pet", "wall-dusk", 60) }, "decor"); // -> Boutique
  assert.equal(decor.out.pet.house.wallpaper, "wall-dusk");                       // on the wall
  const wear = await moved(() => ok(post("lumi-pet/act", { action: "wear", item: "acc-bow" }), "wear")); // buy + wear
  onlyMoved(wear.d, { [A]: -price("pet", "acc-bow", 60), [SHOP.boutique]: price("pet", "acc-bow", 60) }, "wear"); // -> Boutique
  assert.equal(wear.out.pet.outfit.head, "acc-bow");                              // worn
  const look = await ok(api("lumi-look"), "look after wear");                     // arcade/lumi-sprite.js sees it
  assert.equal(look.outfit.head, "acc-bow");                                      // the new bow
  const played = await ok(post("lumi-pet/act", { action: "play", item: "star-ribbon" }), "play"); // a free toy
  assert.equal(played.pet.task.kind, "play");                                     // timed play
  tick(2 * 3600_000);                                                             // two hours later: play is over
  const later = await ok(api("lumi-pet/state"), "state later");                   // caught up
  assert.equal(later.pet.task, null);                                             // done playing
});

test("pet: capsule pulls go to Moon Capsule Co.; a repeat is bought back from the bank", async () => {
  const pull = await moved(() => ok(post("lumi-pet/act", { action: "capsule" }), "capsule")); // a Star Capsule
  const cost = price("pet", "capsule", 150);                                      // 30 SGC
  assert.equal(pull.out.said.paid, cost);                                         // charged
  const back = pull.out.said.buyback || 0;                                        // (a first pull is never a repeat)
  onlyMoved(pull.d, { [A]: -cost + back, [SHOP.capsules]: cost, [BANK]: -back }, "capsule"); // -> Moon Capsule Co.
  const pool = save.PRIZES.filter((p) => p.rarity in save.CLOSET.capsule.odds);   // what a Star Capsule holds
  const keep = pool.find((p) => p.rarity === "legendary") || pool[0];             // leave one unowned (1% odds)
  setPet(A, (pet) => { for (const p of pool) if (p !== keep && !pet[save.shelf(p)].includes(p.id)) pet[save.shelf(p)].push(p.id); }); // owns the rest
  let repeat = null;                                                              // a duplicate pull
  for (let i = 0; i < 6 && !repeat; i++) {
    const r = await moved(() => ok(post("lumi-pet/act", { action: "capsule" }), "capsule repeat")); // pull again
    if (r.out.said.duplicate) repeat = r;                                         // bought back
  }
  assert.ok(repeat, "a repeat came out");                                         // (99% per pull)
  const half = repeat.out.said.buyback;                                           // SGC back
  assert.ok(half > 0, "buyback pays");                                            // something
  onlyMoved(repeat.d, { [A]: -cost + half, [SHOP.capsules]: cost, [BANK]: -half }, "buyback"); // bank pays the buyback
  const ref = sql().prepare("SELECT COUNT(*) AS n FROM lumi_coin_refs WHERE ref LIKE ?").get(`lumi-buyback:${A}:%`).n; // pay-once refs
  assert.ok(ref >= 1);                                                            // recorded
});

test("pet: house + room actions (paint, room mode, unpack, own-home here)", async () => {
  const painted = await ok(post("lumi-pet/act", { action: "paint", spot: "wallpaper", colour: "#ff8ecb" }), "paint"); // free paint
  assert.equal(painted.pet.house.wallpaper, "#ff8ecb");                           // painted
  await ok(post("lumi-pet/act", { action: "room_mode" }), "room mode");          // the room view toggle
  const unpacked = await ok(post("lumi-pet/act", { action: "unpack" }), "unpack"); // one moving box a day
  assert.ok(unpacked.said && unpacked.said.unpacked, "a box unpacked");          // what came out
  assert.equal((await post("lumi-pet/act", { action: "unpack" })).status, 400);   // one a day
  const here = await ok(post("lumi-pet/houses/here", { room: "bedroom", x: 500, y: 300 }), "own home"); // standing at home
  assert.equal(here.paid, 0);                                                     // no gift at your own home
  assert.ok(Array.isArray(here.here));                                            // who's here
});

test("pet: an old save moves in and is refunded once from the bank (no cap)", async () => {
  const old = { name: "Old", decor: ["wall-dusk", "wall-stars"], house: { wallpaper: "wall-stars" }, moved_in: 0 }; // a pre-move-in save
  sql().prepare("INSERT INTO lumi_pets (user_id, data, updated_at) VALUES (?, ?, datetime('now'))").run(C, JSON.stringify(old)); // as erinne stored it
  const worth = 60 + 120;                                                         // native prices of her pieces
  const r = await moved(() => ok(api("lumi-pet/state", C), "move-in"));          // first load migrates
  const paid = prize("pet", "movein", worth);                                     // 36 SGC
  onlyMoved(r.d, { [C]: paid, [BANK]: -paid }, "move-in");                        // bank -> player
  assert.deepEqual(r.out.pet.decor, []);                                          // the house starts again
  const twice = await moved(() => ok(api("lumi-pet/state", C), "again"));        // a second load
  onlyMoved(twice.d, {}, "move-in once");                                         // paid once
});

// ------------------------------------------------------------------------------------------------ Lumi Dungeons

// A strong Lumi: level 40, every point spread, the first tree learned (as erinne's own fight tests do).
function trainA(uid = A) {
  setPet(uid, (pet) => {
    pet.level = 40;                                                               // strong
    pet.stat_points = Object.fromEntries(lumibattle.STAT_KEYS.map((k) => [k, 39])); // points spread evenly
    pet.skills = lumibattle.CATALOG.trees[0].nodes.map((n) => n.id);              // a whole tree
    pet.task = null; pet.rest = "awake";                                          // free to fight
  });
}

// Press move0 until the fight is over; returns the last answer.
async function fightOut(battleId, turn, who = A) {
  let out = null;                                                                 // the last answer
  for (let i = 0; i < 80; i++) {
    out = await ok(post("lumi-pet/battle/act", { battle: battleId, turn, action: "move0" }, who), `fight turn ${i}`); // one press
    if (out.fight.status !== "active") return out;                                // won, lost or fled
    turn = out.fight.turn;                                                        // the next turn
  }
  throw new Error("the fight never ended");                                       // a stuck fight
}

test("dungeons: a battle from start to a win pays from the bank", async () => {
  trainA();                                                                       // ready to win
  const started = await ok(post("lumi-pet/battle", { tier: "common" }), "battle start"); // a fight
  assert.equal(started.fight.status, "active");                                   // under way
  sql().prepare("UPDATE lumi_battles SET state = json_set(state, '$.enemy.hp', 1) WHERE id = ?").run(started.fight.id); // a weak creature (setup: the win path)
  const r = await moved(() => fightOut(started.fight.id, started.fight.turn));    // fight it out
  assert.equal(r.out.fight.status, "victory", JSON.stringify(r.out.fight).slice(0, 300)); // a win (erinne "victory")
  const win = r.d[A];                                                             // what she got
  assert.ok(win > 0, "a win pays");                                               // something
  onlyMoved(r.d, { [A]: win, [BANK]: -win }, "battle win");                       // bank -> player
  assert.ok(sql().prepare("SELECT 1 FROM lumi_coin_refs WHERE ref = ?").get(`lumi-battle:${started.fight.id}`), "ref lumi-battle:<id>"); // pay-once ref
});

test("dungeons: the battle shop charges Dungeon Outfitters", async () => {
  const r = await moved(() => ok(post("lumi-pet/act", { action: "potions", count: 1 }), "buy potion")); // a potion
  const cost = -r.d[A];                                                           // SGC charged
  assert.ok(cost > 0, "a potion costs SGC");                                      // something
  onlyMoved(r.d, { [A]: -cost, [SHOP.outfitters]: cost }, "battle shop");         // -> Dungeon Outfitters
});

test("dungeons: a trip (start, look, move, back, leave) banks the satchel from the bank; tales answer", async () => {
  const start = await ok(post("lumi-pet/dungeon", { env: "crystal-cavern" }), "dungeon start"); // set out
  const run = start.dungeon.run;                                                  // the trip
  assert.equal(run.room.kind, "start");                                           // at the entrance
  assert.ok(run.say, "the tale library narrates");                                // _narrate ran
  await ok(post("lumi-pet/dungeon/act", { action: "look" }), "look");            // look around
  const way = run.room.exits[0];                                                  // a door
  const back = { n: "s", s: "n", e: "w", w: "e" }[way];                           // the way back
  db.tx(() => {                                                                   // setup: a creature behind that door
    const t = lumidungeon.current(A);                                             // the stored trip
    const next = lumidungeon._step(t.at, way);                                    // the room beyond
    Object.assign(t.rooms[next], { kind: "enemy", enemy: { id: Object.keys(lumibattle._ENEMIES)[0] }, done: false, lock: null }); // a fight there
    lumidungeon._save(A, t);                                                      // stored
  });
  const stepped = await ok(post("lumi-pet/dungeon/act", { action: "move", way }), "move"); // through it
  assert.equal(stepped.fight && stepped.fight.status, "active", "walked into a dungeon fight"); // a fight, through lumipet.dungeonAct
  sql().prepare("UPDATE lumi_battles SET state = json_set(state, '$.enemy.hp', 1) WHERE id = ?").run(stepped.fight.id); // weak (setup: the win path)
  const won = await fightOut(stepped.fight.id, stepped.fight.turn);              // the dungeon fight, through lumipet.fightAct
  assert.equal(won.fight.status, "victory");                                      // won
  const cleared = lumidungeon.current(A);                                         // lumidungeon.afterFight ran via the pet glue
  assert.equal(cleared.fight, null);                                              // no fight left on the trip
  assert.equal(cleared.rooms[cleared.at].kind, "enemy");                          // she stands in the creature's room
  assert.equal(cleared.rooms[cleared.at].done, true);                             // cleared by the win
  assert.ok(cleared.log.length >= 2, "the fight got its tale line (_narrate)");   // narrated again
  const live = lumidungeon.current(A);                                            // the stored trip
  if (live.facing) await ok(post("lumi-pet/dungeon/act", { action: "back" }), "step back from a door"); // a locked door: step back
  else if (live.rooms[live.at].kind !== "start") await ok(post("lumi-pet/dungeon/act", { action: "move", way: back }), "move back"); // back to the entrance
  db.tx(() => { const t = lumidungeon.current(A); t.satchel.coins += 120; lumidungeon._save(A, t); }); // something in the satchel
  const home = await moved(() => ok(post("lumi-pet/dungeon/act", { action: "leave" }), "leave")); // walk home
  assert.equal(home.out.dungeon.run.over, "home");                                // home
  const paid = home.d[A];                                                         // the satchel in SGC
  assert.ok(paid >= prize("dungeon", "win", 120), `satchel paid ${paid}`);       // at least the 120 we put in
  onlyMoved(home.d, { [A]: paid, [BANK]: -paid }, "satchel");                     // bank -> player
  assert.equal(home.out.coins, bal(A));                                           // the coin chip
  assert.deepEqual(await ok(api("lumi-pet/dungeon/tale"), "tale get"), { live: null }); // no live storyteller
  assert.deepEqual(await ok(post("lumi-pet/dungeon/tale", {}), "tale post"), { line: null }); // the library's line stays
});

// ------------------------------------------------------------------------------------------------ Lumi's Garden

test("garden: look, buy a plot (Nursery), plant, press with a carry (bank)", async () => {
  const look = await ok(post("lumi-pet/garden", { action: "look" }), "garden look"); // her garden
  assert.ok(look.garden, "the snapshot carries the garden");                      // the pet snapshot has it
  const plot = await moved(() => ok(post("lumi-pet/garden", { action: "plot" }), "buy plot")); // another plot
  const cost = plot.out.said.paid;                                                // SGC charged
  assert.ok(cost > 0, "a plot costs SGC");                                        // something
  onlyMoved(plot.d, { [A]: -cost, [SHOP.nursery]: cost }, "plot");                // -> Starpowder Nursery
  const planted = await ok(post("lumi-pet/garden", { action: "plant", item: "moondaisy", plot: 0 }), "plant"); // a free flower
  assert.equal(planted.said.planted, "moondaisy");                                // in the ground
  sql().prepare("UPDATE lumi_gardens SET state = json_set(state, '$.powder', 1000.0, '$.press_at', 0, '$.squeezed', 0.0, '$.unpaid', 0) WHERE user_id = ?").run(A); // a full hopper (setup)
  const pressed = await moved(() => ok(post("lumi-pet/garden", { action: "press", count: 120 }), "press")); // 120 presses
  const note = pressed.out.said;                                                  // what the press did
  assert.ok(note.made > 0, `press made coins: ${JSON.stringify(note)}`);         // press coins squeezed
  const paidSgc = pressed.d[A];                                                   // whole SGC paid now
  assert.equal(note.coins, paidSgc);                                              // the note says what was paid
  onlyMoved(pressed.d, { [A]: paidSgc, [BANK]: -paidSgc }, "press");             // bank -> player
  const state = JSON.parse(sql().prepare("SELECT state FROM lumi_gardens WHERE user_id = ?").get(A).state); // the stored garden
  const native = note.made - state.unpaid;                                        // press coins turned into SGC
  assert.equal(prize("garden", "press", native), paidSgc);                        // the carry: only whole SGC go out
  assert.equal(prize("garden", "press", state.unpaid), 0, "the rest (less than one SGC) waits for the next press"); // the carry
});

// ------------------------------------------------------------------------------------------------ Lumi Party

// Read / write a party's stored state (test setup only: to put a creature next door and coins in a satchel).
const partyState = (code) => JSON.parse(sql().prepare("SELECT state FROM lumi_parties WHERE code = ?").get(code).state); // parsed
const putParty = (code, state) => sql().prepare("UPDATE lumi_parties SET state = ? WHERE code = ?").run(JSON.stringify(state), code); // stored

test("party: A makes, B joins, the stream says hello + party, a co-op fight round, home pays both from the bank", async () => {
  trainA(A); trainA(B);                                                           // two strong Lumis, free to go
  await ok(post("lumi-pet/dungeon/act", { action: "abandon" }), "no solo trip").catch(() => {}); // (A's solo trip is over already)
  const made = await ok(post("lumi-pet/parties", { mode: "online" }), "party create"); // A makes one
  const code = made.code;                                                         // its code
  const listed = await ok(api("lumi-pet/parties", B), "party list");              // B sees it
  assert.ok(listed.parties.some((p) => p.code === code), "listed");               // there
  const joined = await ok(post(`lumi-pet/parties/${code}`, { action: "join" }, B), "join"); // B joins
  assert.equal(joined.you, B);                                                    // B is in
  const live = stream(`lumi-pet/parties/${code}/stream`, A);                      // A watches
  const res = await live.ready;                                                   // headers in
  assert.equal(res.statusCode, 200);                                              // a stream
  const first = await live.next("party");                                         // the party first
  assert.equal(live.got[0][1], ": hello");                                        // erinne's hello
  assert.equal(first.members.length, 2);                                          // both
  for (const who of [A, B]) await ok(post(`lumi-pet/parties/${code}`, { action: "ready" }, who), "ready"); // both ready
  const trip = await ok(post(`lumi-pet/parties/${code}`, { action: "start" }), "start"); // A sets out
  assert.equal(trip.phase, "trip");                                               // out exploring
  const changed = await live.next("party");                                       // the stream relays it
  assert.ok(changed.revision > first.revision);                                   // newer
  // Put a creature behind the first door (test setup), then both vote to walk in.
  const st = partyState(code);                                                    // the stored party
  const start = st.run.rooms[st.run.at];                                          // the entrance
  const way = start.exits[0];                                                     // a door
  const to = lumidungeon._step(st.run.at, way);                                   // the room beyond
  const enemyRoom = Object.values(st.run.rooms).find((r) => r.kind === "enemy" && r.enemy); // any creature on this floor
  const enemy = enemyRoom ? enemyRoom.enemy : { id: Object.keys(lumibattle._ENEMIES)[0] }; // its creature (or any)
  Object.assign(st.run.rooms[to], { kind: "enemy", enemy, done: false, lock: null }); // a fight next door
  putParty(code, st);                                                             // stored
  await ok(post(`lumi-pet/parties/${code}`, { action: "move", way }, A), "vote A"); // A votes
  const voted = await ok(post(`lumi-pet/parties/${code}`, { action: "move", way }, B), "vote B"); // B votes: settled
  assert.ok(voted.run.party.fight, `a co-op fight started: ${JSON.stringify(voted.run.event)}`); // in a fight (run.party.fight)
  const sf = partyState(code);                                                    // the stored fight (setup: weak creatures, so it ends in a win)
  for (const f of sf.run.fight.foes) f.hp = 1;                                    // one hit each
  putParty(code, sf);                                                             // stored
  let fight = (await ok(api(`lumi-pet/parties/${code}`, B), "fight look")).run.party.fight; // the fight as B sees it
  for (let i = 0; i < 120 && !fight.outcome; i++) {                               // turns until it's over
    const seatUser = fight.at === null || fight.at === undefined ? null : fight.lumis[fight.at].user; // whose turn
    if (!seatUser) { tick(1000); fight = (await ok(api(`lumi-pet/parties/${code}`, A), "look")).run.party.fight; continue; } // the creatures' turn: time passes
    const foe = fight.foes.findIndex((f) => f.hp > 0);                            // the first creature standing
    const r = await ok(post(`lumi-pet/parties/${code}`, { action: "fight", target: "move0", foe, turn: fight.turn }, String(seatUser)), `fight turn ${i}`); // her move
    if (!r.run || !r.run.party.fight) break;                                      // over and cleared away
    fight = r.run.party.fight;                                                    // the fight now
  }
  const after1 = (await ok(api(`lumi-pet/parties/${code}`, A), "after fight")).run; // the trip after
  assert.ok(!after1.fighting, "the fight is over");                               // done
  // Back to the entrance (if the room moved on), coins in both satchels, and vote to go home.
  const st2 = partyState(code);                                                   // stored again
  for (const m of st2.members) m.satchel.coins = (m.satchel.coins || 0) + 100;    // something to bank
  st2.run.at = st2.run.rooms[st2.run.at].kind === "start" ? st2.run.at : Object.keys(st2.run.rooms).find((k) => st2.run.rooms[k].kind === "start"); // at the entrance
  st2.run.facing = null; st2.run.puzzle = null; st2.run.fighting = false;         // nothing in the way
  const coins = Object.fromEntries(st2.members.map((m) => [m.user, m.satchel.coins])); // what each carries
  putParty(code, st2);                                                            // stored
  const home = await moved(async () => {
    await ok(post(`lumi-pet/parties/${code}`, { action: "leave" }, A), "home vote A"); // A votes home
    return ok(post(`lumi-pet/parties/${code}`, { action: "leave" }, B), "home vote B"); // B too: home
  });
  const payA = prize("party", "win", coins[A]), payB = prize("party", "win", coins[B]); // each satchel in SGC
  onlyMoved(home.d, { [A]: payA, [B]: payB, [BANK]: -(payA + payB) }, "party home"); // bank -> both
  assert.ok(sql().prepare("SELECT 1 FROM lumi_coin_refs WHERE ref LIKE ?").get(`lumi-party:${code}:%:${A}`), "ref lumi-party:<code>:<run>:<uid>"); // pay-once ref
  assert.equal(home.out.phase, "lobby");                                          // back in the lobby
  for (const who of [B, A]) await ok(post(`lumi-pet/parties/${code}`, { action: "leave" }, who), "leave party"); // everyone leaves
  await live.next("end");                                                         // the stream says goodbye
  live.close();                                                                   // done
});

// ------------------------------------------------------------------------------------------------ Lumi Town (presence + homes)

test("town: join, say, emote, the stream; houses, visit B (knock + answer), guestbook, housewarming from the bank", async () => {
  for (const who of [A, B]) setPet(who, (pet) => { pet.town_seen = true; });      // "Show me in town" on
  const townB = stream("lumi-pet/town/stream", B);                                // B listens to the town
  assert.equal((await townB.ready).statusCode, 200);                              // a stream
  await townB.next("comment");                                                    // ": hello"
  assert.equal(townB.got[0][1], ": hello");                                       // erinne's hello
  const here = await ok(post("lumi-pet/town", { at: "square", x: 100, y: 400 }), "town join"); // A steps out
  assert.equal(here.seen, true);                                                  // visible
  await ok(post("lumi-pet/town", { at: "square", x: 120, y: 400 }, B), "town join B"); // B too
  const seenA = await ok(post("lumi-pet/town", { at: "square", x: 101, y: 400 }), "town look"); // A looks again
  assert.ok(seenA.here.some((p) => p.id === B && p.name === "Bea" && p.look), "A sees B (name + look)"); // B is drawn
  const said = await ok(post("lumi-pet/town/say", { text: "hello town!" }), "say"); // a line
  assert.equal(said.line.text, "hello town!");                                    // cleaned
  const heard = await townB.next("said");                                         // B hears it
  assert.equal(heard.text, "hello town!");                                        // same line
  tick(2000);                                                                     // (emote gap)
  const emo = await ok(post("lumi-pet/town/emote", { emote: "wave" }), "emote"); // a wave
  assert.equal(emo.emote, "wave");                                                // done
  assert.equal((await townB.next("emote")).emote, "wave");                        // B sees it
  // B goes home; A finds B's flat, knocks, B answers, A walks in (house-warming gift), signs the guestbook.
  await ok(post("lumi-pet/houses/here", { room: "bedroom", x: 400, y: 300 }, B), "B at home"); // B is home
  const list = await ok(api("lumi-pet/houses"), "houses");                       // flats A may visit
  assert.ok(list.flats.some((f) => f.id === B && f.home), "B listed, at home");   // B's flat
  const door = await ok(api(`lumi-pet/houses/${B}`), "B's doorstep");            // B's door
  assert.equal(door.access, "knock");                                             // knock first (default)
  const knocked = await ok(post(`lumi-pet/houses/${B}/knock`), "knock");         // knock knock
  assert.equal(knocked.in, false);                                                // waiting
  await townB.next("knock");                                                      // B's page hears it
  const waiting = await ok(post("lumi-pet/houses/here", { room: "bedroom", x: 400, y: 300 }, B), "B sees the knock"); // B's page looks
  assert.ok(waiting.knocks.some((k) => k.id === knocked.knock && k.guest === A), "the knock is listed"); // at B's door
  await ok(post(`lumi-pet/knocks/${knocked.knock}/answer`, { yes: true }, B), "answer"); // let A in
  assert.equal((await ok(api(`lumi-pet/knocks/${knocked.knock}`), "knock state")).answer, true); // A hears yes
  const inside = await ok(api(`lumi-pet/houses/${B}`), "inside B's flat");       // A may look in now
  assert.equal(inside.access, "in");                                              // in
  const warm = await moved(() => ok(post("lumi-pet/houses/here", { host: B, room: "bedroom", x: 300, y: 300 }), "visit B")); // A walks in
  const gift = prize("pet", "housewarm", 10);                                     // 10 native -> 2 SGC
  assert.equal(warm.out.paid, gift);                                              // the house-warming gift
  onlyMoved(warm.d, { [A]: gift, [BANK]: -gift }, "housewarming");                // bank -> guest
  assert.ok(warm.out.here.some((p) => p.id === B && p.host), "B is there, as host"); // the host
  const signed = await ok(post(`lumi-pet/houses/${B}/guestbook`, { text: "lovely flat!" }), "guestbook"); // sign it
  assert.equal(signed.guestbook.at(-1).text, "lovely flat!");                     // in B's book
  assert.ok(!("uid" in signed.guestbook.at(-1)), "never the uid");                // privacy
  await townB.next("guestbook");                                                  // B's page hears it
  await ok(post("lumi-pet/houses/here", { room: "bedroom", x: 300, y: 300 }), "A home"); // A goes to her own flat
  const again = await moved(() => ok(post("lumi-pet/houses/here", { host: B, room: "bedroom", x: 300, y: 300 }), "visit B again")); // again today
  onlyMoved(again.d, {}, "housewarming once a day");                              // once per home per day
  townB.close();                                                                  // done
});

// ------------------------------------------------------------------------------------------------ Lumi City (real estate)

const estate = (body, who = A) => post("lumi-pet/estate", body, who);            // one thing done in Lumi City

test("city: view, buy a plot, style, yard, capsule (Realty); list it, B buys it (transfer), B sells to the office (exact, bank)", async () => {
  const city = await ok(api("lumi-pet/city"), "city view");                       // the whole city
  const lot = city.lots.find((l) => !l.owner && l.town === "left");               // a free lot in LefTown
  assert.ok(lot, "a free lot");                                                   // there is one
  const realty = SHOP.realty;                                                     // Lumi City Realty
  const bought = await moved(() => ok(estate({ action: "buy", plot: lot.id }), "buy plot")); // A buys it
  const cost = price("city", "plot", lot.suggested);                              // the office's price in SGC
  assert.equal(bought.out.said.paid, cost);                                       // charged that
  onlyMoved(bought.d, { [A]: -cost, [realty]: cost }, "plot");                    // -> Realty
  assert.equal(sql().prepare("SELECT paid FROM lumi_plots WHERE user_id = ?").get(A).paid, cost); // stored SGC actually charged
  const style = city.catalog.styles.find((s) => s.price > 0);                     // a house style for sale
  const st = await moved(() => ok(estate({ action: "style_buy", item: style.id }), "style buy")); // buy it
  onlyMoved(st.d, { [A]: -price("city", style.id, style.price), [realty]: price("city", style.id, style.price) }, "style"); // -> Realty
  await ok(estate({ action: "style_set", item: style.id }), "style set");         // put it up
  const piece = lumicity.ESTATE.yard.fence.find((p) => p.price);                 // a fence for sale
  const yd = await moved(() => ok(estate({ action: "yard_buy", item: piece.id }), "yard buy")); // buy it
  onlyMoved(yd.d, { [A]: -price("city", piece.id, piece.price), [realty]: price("city", piece.id, piece.price) }, "yard"); // -> Realty
  await ok(estate({ action: "yard_set", slot: "fence", item: piece.id }), "yard set"); // put it out
  const cap = await moved(() => ok(estate({ action: "capsule" }), "keepsake capsule")); // a Keepsake Capsule
  const capCost = price("city", "capsule", 200);                                  // 40 SGC
  const back = cap.out.said.buyback || 0;                                         // a repeat's buyback
  onlyMoved(cap.d, { [A]: -capCost + back, [realty]: capCost, [BANK]: -back }, "capsule"); // -> Realty (repeat from the bank)
  const mine = await ok(api("lumi-pet/city"), "city again");                      // the city now
  const myLot = mine.lots.find((l) => l.id === lot.id);                           // her lot
  assert.ok(myLot.owner, "her lot shows an owner");                               // owned
  assert.equal(myLot.style, style.id);                                            // the new style
  assert.equal(myLot.yard.fence, piece.id);                                       // the new fence
  const house = await ok(api(`lumi-pet/houses/${A}?home=house`, B), "B looks at A's house"); // a house on a plot
  assert.equal(house.plot === undefined ? null : typeof house.plot, "string");   // the plot is shown
  // List it, and B buys it from A: SGC goes straight from B to A (sgc.transfer), nothing through the treasury.
  const worth = cost;                                                             // the office's price now (same block)
  const listed = await ok(estate({ action: "list", price: worth }), "list");      // on the market at its worth
  assert.equal(listed.said.price, worth);                                         // listed
  const onMarket = listed.lots.find((l) => l.id === lot.id);                      // the listing
  const sale = await moved(() => ok(estate({ action: "buy_listing", plot: lot.id, price: onMarket.list_price, version: onMarket.version }, B), "buy listing")); // B buys
  onlyMoved(sale.d, { [B]: -worth, [A]: worth }, "transfer");                     // buyer -> seller, exact, no fee
  assert.equal(sql().prepare("SELECT user_id FROM lumi_plots WHERE town = ? AND block = ? AND lot = ?").get(lot.town, lot.block, lot.lot).user_id, B); // B's now
  const ledger = sql().prepare("SELECT from_user_id, to_user_id, amount FROM transactions WHERE type = 'lumi_city_trade' ORDER BY id DESC LIMIT 1").get(); // the ledger row
  assert.deepEqual([ledger.from_user_id, ledger.to_user_id, ledger.amount], [B, A, worth]); // one clean row
  // B sells it to the office: half its worth, exact SGC, from the bank, once.
  const sold = await moved(() => ok(estate({ action: "sell" }, B), "sell to office")); // the office buys it back
  const back2 = Math.floor(worth * lumicity.CITY.price.sell_office + 0.5);        // the office pays half (city.json sell_office)
  assert.equal(sold.out.said.paid, back2, JSON.stringify(sold.out.said));         // exact, unscaled
  onlyMoved(sold.d, { [B]: back2, [BANK]: -back2 }, "office sale");               // bank -> player
  assert.equal(sql().prepare("SELECT COUNT(*) AS n FROM lumi_plots WHERE user_id = ?").get(B).n, 0); // office land again
});

// ------------------------------------------------------------------------------------------------ minigames

test("prism drop: ten drops finish the game and pay score/10 from the bank", async () => {
  await ok(api("prism-drop/run"), "prism run");                                   // the game in progress (or a fresh one)
  let last = null;                                                                // the last drop
  const r = await moved(async () => {
    for (let i = 0; i < 10; i++) last = await ok(post("prism-drop/drop", { pick: 1 + (i % 10) }), `drop ${i}`); // ten drops
    return last;                                                                  // the tenth finishes it
  });
  assert.equal((await post("prism-drop/drop", { pick: 11 })).status, 422);        // no such pocket
  const paid = r.d[A];                                                            // what it paid
  assert.ok(paid >= 0, "never charges");                                          // free to play
  onlyMoved(r.d, { [A]: paid, [BANK]: -paid }, "prism");                          // bank -> player (maybe 0)
  assert.ok(sql().prepare("SELECT 1 FROM lumi_coin_refs WHERE ref LIKE 'lumi-prism:%'").get(), "ref lumi-prism:<run>"); // pay-once ref
});

const LAUNCH_RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_launch_runs.json", import.meta.url), "utf8")); // recorded goes
const SOFT_RUNS = JSON.parse(readFileSync(new URL("./fixtures/lumi_soft_runs.json", import.meta.url), "utf8"));     // recorded runs

test("lumi launch: start (Arcade), finish a recorded go, pays metres/20 from the bank once", async () => {
  const state = await ok(api("lumi-launch/state"), "launch state");               // the title screen
  assert.equal(state.entry, 25);                                                  // native
  const recorded = [...LAUNCH_RUNS].sort((a, b) => a.result.total - b.result.total).at(-1); // the farthest go
  const start = await moved(() => ok(post("lumi-launch/start"), "launch start")); // a ticket
  const fee = price("launch", "entry", 25);                                       // 5 SGC
  onlyMoved(start.d, { [A]: -fee, [SHOP.arcade]: fee }, "launch entry");          // -> Lumi Arcade
  sql().prepare("UPDATE lumi_launch_runs SET seed = ? WHERE id = ?").run(recorded.seed, start.out.run); // the recorded course (setup)
  tick((recorded.result.frames / 60 + 5) * 1000);                                 // as long as the go took
  const done = await moved(() => ok(post("lumi-launch/finish", { run: start.out.run, shots: recorded.shots }), "launch finish")); // the presses
  assert.equal(done.out.refused, null, done.out.refused);                         // accepted
  assert.deepEqual(done.out.summary, recorded.result);                            // the server's replay
  const pay = prize("launch", "win", Math.floor(recorded.result.total / 20));     // metres / 20
  onlyMoved(done.d, { [A]: pay, [BANK]: -pay }, "launch prize");                  // bank -> player
  assert.equal((await post("lumi-launch/finish", { run: start.out.run, shots: recorded.shots })).status, 404); // once
});

test("lumi-soft: start a stage (Arcade), two continues (Arcade), finish the recorded run, pays score/250 from the bank", async () => {
  const recorded = SOFT_RUNS.find((r) => r.mode === "stage" && r.stage === "lounge"); // a run with two continues
  assert.equal(recorded.log.continues, 2);                                        // as recorded
  const soft = require("../../src/lumi/minis/lumisoft.js");                       // its stage list (setup)
  sql().prepare("INSERT OR REPLACE INTO lumi_soft_progress (user_id, data) VALUES (?, ?)").run(A, JSON.stringify({ cleared: soft.STAGES })); // every stage open
  await ok(api("lumi-soft/state"), "soft state");                                 // the title screen
  const start = await moved(() => ok(post("lumi-soft/start", { mode: "stage", stage: "lounge" }), "soft start")); // a ticket
  const fee = price("soft", "entry", 25);                                         // 5 SGC
  onlyMoved(start.d, { [A]: -fee, [SHOP.arcade]: fee }, "soft entry");            // -> Lumi Arcade
  let carried = 0;                                                                // continues paid
  for (let i = 0; i < 2; i++) {
    const c = await moved(() => ok(post("lumi-soft/continue", { run: start.out.run }), `continue ${i}`)); // pay to go on
    onlyMoved(c.d, { [A]: -c.out.paid, [SHOP.arcade]: c.out.paid }, "continue");  // -> Lumi Arcade
    carried += c.out.paid;                                                        // tally
  }
  assert.equal(carried, price("soft", "continue", 50) + price("soft", "continue", 100)); // 50 then 100 native
  tick((recorded.log.end / 60 + 5) * 1000);                                       // as long as the run took
  const done = await moved(() => ok(post("lumi-soft/finish", { ...recorded.log, run: start.out.run }), "soft finish")); // the log
  assert.equal(done.out.refused, null, done.out.refused);                         // accepted
  assert.deepEqual(done.out.summary, recorded.summary);                           // the server's replay
  const pay = done.out.paid;                                                      // SGC paid
  assert.equal(pay, prize("soft", "win", done.out.earned));                       // score/250 native, scaled (uncapped)
  onlyMoved(done.d, { [A]: pay, [BANK]: -pay }, "soft prize");                    // bank -> player
  // Story mode: clearing everything wins Lumi-Soft prizes, including goggles that go into Lumi Pet's CLOSET.
  const story = SOFT_RUNS.find((r) => r.mode === "story");                        // the recorded story run (no continues)
  const t = await ok(post("lumi-soft/start", { mode: "story" }), "story start");  // a ticket
  tick((story.log.end / 60 + 5) * 1000);                                          // as long as it took
  const out = await ok(post("lumi-soft/finish", { ...story.log, run: t.run }), "story finish"); // the log
  assert.equal(out.refused, null, out.refused);                                   // accepted
  const won = out.won.map((w) => w.id);                                           // prizes handed out
  assert.ok(won.includes("acc-soft-goggles"), `story prizes: ${won.join(",")}`);  // the wearable prize
  const pet = (await ok(api("lumi-pet/state"), "pet after soft")).pet;            // her save, through the pet API
  for (const item of won) assert.ok((save.WEAR[item] ? pet.closet : pet.decor).includes(item), `${item} reached Lumi Pet`); // closet or house
  assert.ok(pet.closet.includes("acc-soft-goggles"), "goggles in the closet");    // soft -> pet closet
});

// A greedy Lumi Conga walk that eats some food (as arcade_rules.test.mjs does); returns { turns, moves, score }.
function congaWalk(seed) {
  const arcade = require("../../src/lumi/arcade/arcade.js");                      // the server's rules
  const turns = [];                                                               // turns made
  let moves = 0, score = 0, heading = 0, index = 0;                               // walk state
  const body = arcade.SNAKE_START.map((cell) => [...cell]);                       // head first
  const board = Array.from({ length: arcade.SNAKE_W }, () => new Array(arcade.SNAKE_H).fill(0)); // empty board
  for (const [x, y] of body) board[x][y] = 1;                                     // the body on it
  let food = arcade.snakeFood(seed, index++, board);                              // the first food
  board[food[0]][food[1]] = food[2];                                              // placed
  while (moves < 300 && score < 12) {                                             // walk towards food
    const [hx, hy] = body[0];                                                     // the head
    let want = food[0] > hx ? 0 : food[0] < hx ? 2 : food[1] > hy ? 1 : 3;        // towards the food
    if (want === (heading + 2) % 4) want = hy < arcade.SNAKE_H - 1 ? 1 : 3;       // never straight back
    const nx = hx + arcade.STEPS[want][0], ny = hy + arcade.STEPS[want][1];       // the next cell
    const tail = body[body.length - 1];                                           // the last dancer
    if (!(nx >= 0 && nx < arcade.SNAKE_W && ny >= 0 && ny < arcade.SNAKE_H) || (board[nx][ny] === 1 && !(nx === tail[0] && ny === tail[1]))) break; // would die
    moves += 1;                                                                   // one move
    if (want !== heading) { turns.push([moves, want]); heading = want; }          // a turn
    const ate = board[nx][ny] in arcade.FOOD_POINTS;                              // food?
    if (!ate) { const t = body.pop(); board[t[0]][t[1]] = 0; } else score += arcade.FOOD_POINTS[board[nx][ny]]; // tail or score
    body.unshift([nx, ny]);                                                       // the new head
    board[nx][ny] = 1;                                                            // on the board
    if (ate) { food = arcade.snakeFood(seed, index++, board); board[food[0]][food[1]] = food[2]; } // next food
  }
  return { turns, moves, score };                                                 // the claim
}

test("arcade solo: Lumi Conga (replayed), Teacup Tower, Yarn Pop: entry to Arcade, prize from the bank", async () => {
  const fee = price("snake", "entry", 25);                                        // 5 SGC each
  const conga = await moved(() => ok(post("snake/run"), "snake run"));           // a ticket + seed
  onlyMoved(conga.d, { [A]: -fee, [SHOP.arcade]: fee }, "snake entry");           // -> Lumi Arcade
  const walk = congaWalk(conga.out.seed);                                         // a real game on that seed
  assert.ok(walk.score > 0, "the walk scored");                                   // something to pay
  tick(120_000);                                                                  // two minutes of dancing
  const cdone = await moved(() => ok(post("snake/run/finish", { run: conga.out.run, moves: walk.moves, turns: walk.turns, died: false }), "snake finish")); // the claim
  assert.equal(cdone.out.score, walk.score);                                      // the replay's score
  const cpay = prize("snake", "win", walk.score);                                 // 1 per point
  onlyMoved(cdone.d, { [A]: cpay, [BANK]: -cpay }, "snake prize");                // bank -> player
  const tower = await ok(post("teacup-tower/run"), "tower run");                  // a Teacup Tower ticket
  tick(60_000);                                                                   // a minute up the tower
  const tdone = await moved(() => ok(post("teacup-tower/run/finish", { run: tower.run, score: 30 }), "tower finish")); // floor 30
  onlyMoved(tdone.d, { [A]: prize("teacup-tower", "win", 30), [BANK]: -prize("teacup-tower", "win", 30) }, "tower prize"); // bank -> player
  const yarn = await ok(post("breakout/run"), "breakout run");                    // a Yarn Pop ticket
  tick(60_000);                                                                   // a minute of bouncing
  const ydone = await moved(() => ok(post("breakout/run/finish", { run: yarn.run, score: 10, level: 1 }), "breakout finish")); // 10 bricks
  onlyMoved(ydone.d, { [A]: prize("breakout", "win", 10), [BANK]: -prize("breakout", "win", 10) }, "breakout prize"); // bank -> player
  assert.equal((await post("breakout/run/finish", { run: yarn.run, score: 10, level: 1 })).status, 404); // paid once
});

test("showdown: A opens a Yarn Pop table, B races, C bets on B; both race, the result pays scores + C's bet", async () => {
  const table = await ok(post("breakout/tables"), "create table");                // A opens a table
  const code = table.code;                                                        // its code
  assert.equal(table.role, "p1");                                                 // A is P1
  const seatA = table.seats.find((s) => s.you);                                   // A's seat
  assert.deepEqual(seatA.look.outfit, save.look(A).outfit);                       // arcade -> lumi-look: her real outfit
  assert.equal(seatA.look.glow, save.look(A).glow);                               // and her glow
  assert.equal((await ok(post(`breakout/tables/${code}`, { action: "join" }, B), "B joins")).role, "p2"); // B races
  assert.equal((await ok(post(`breakout/tables/${code}`, { action: "join" }, C), "C joins")).role, "watch"); // C watches
  const live = stream(`breakout/tables/${code}/stream`, C);                       // C watches live
  assert.equal((await live.ready).statusCode, 200);                               // a stream
  await live.next("table");                                                       // the table first
  const bet = await moved(() => ok(post(`breakout/tables/${code}`, { action: "bet", target: "p2", amount: 10 }, C), "bet")); // 10 native on B
  const stake = price("breakout", "bet", 10);                                     // 2 SGC
  onlyMoved(bet.d, { [C]: -stake, [SHOP.arcade]: stake }, "bet");                 // -> Lumi Arcade
  const go = await moved(async () => {
    await ok(post(`breakout/tables/${code}`, { action: "ready" }), "A ready");    // A ready
    return ok(post(`breakout/tables/${code}`, { action: "ready" }, B), "B ready"); // B ready: off they go
  });
  assert.equal(go.out.phase, "racing");                                           // racing
  const fee = price("breakout", "entry", 25);                                     // 5 SGC each
  onlyMoved(go.d, { [A]: -fee, [B]: -fee, [SHOP.arcade]: 2 * fee }, "race entries"); // both entries -> Arcade
  const runA = (await ok(api(`breakout/tables/${code}`), "A's ticket")).race.run; // A's run
  const runB = (await ok(api(`breakout/tables/${code}`, B), "B's ticket")).race.run; // B's run
  await ok(post(`breakout/tables/${code}/board`, { score: 3, level: 1, lives: 3 }), "a live board"); // a racer's board
  // (no fake-clock jump here: racers who go quiet for DROP_SECONDS forfeit, and 9 bricks need no minimum time)
  const fin = await moved(async () => {
    await ok(post("breakout/run/finish", { run: runA, score: 4, level: 1 }), "A finishes"); // A: 4 bricks
    await ok(post("breakout/run/finish", { run: runB, score: 9, level: 1 }, B), "B finishes"); // B: 9 bricks, the winner
    return ok(api(`breakout/tables/${code}`, C), "result");                       // C's look settles the race (erinne: caught up on a look)
  });
  const done = fin.out;                                                           // C's view
  assert.equal(done.phase, "result");                                             // settled
  const payA = prize("breakout", "win", 4), payB = prize("breakout", "win", 9);   // each score
  const won = prize("breakout", "betwin", 10);                                    // C's winnings (the stake comes back exact)
  onlyMoved(fin.d, { [A]: payA, [B]: payB, [C]: stake + won, [SHOP.arcade]: -stake, [BANK]: -(payA + payB + won) }, "race result"); // stake back from Arcade, prizes from the bank
  assert.ok(sql().prepare("SELECT COUNT(*) AS n FROM lumi_coin_refs WHERE ref LIKE ?").get(`breakout:${code}:%`).n >= 1, "bet refs '{slug}:{code}:{betId}:...'"); // the bet ref convention
  live.close();                                                                   // done
});

// ------------------------------------------------------------------------------------------------ admin

test("admin: the treasury after all that play: status, a scheduler sweep, an admin sweep (one log row), the /lumi page", async () => {
  const shops = Object.values(SHOP).reduce((sum, id) => sum + bal(id), 0);        // what the shops took in
  assert.ok(shops > 0, "the shops took SGC");                                     // play happened
  const st = treasury.status();                                                   // the admin numbers
  assert.ok(st && st.bank && typeof st.poolTotal === "number", "status has the bank and the pool"); // sane
  const logRows = (key) => sql().prepare("SELECT who FROM lumi_admin_log WHERE key = ? ORDER BY id").all(key).map((r) => r.who); // audit rows
  const before = logRows("treasury.sweep").length;                                // sweeps logged so far
  const swept = treasury.sweep();                                                 // the scheduler's own sweep (who = 'scheduler')
  assert.ok(swept.swept > 0, "the shops were taxed into the bank");               // money moved
  assert.deepEqual(logRows("treasury.sweep").slice(before), ["scheduler"]);       // logged once, by the scheduler
  const quiet = treasury.sweep();                                                 // nothing left to move? (the bank may still tax)
  if (!quiet.swept && !quiet.overflow && !quiet.owedPaid) assert.equal(logRows("treasury.sweep").length, before + 1); // a no-op timer sweep isn't logged
  // The web panel's /lumi page (what webPanel.js hands to lumiAdminPage) renders from this economy, and its sweep
  // button leaves exactly ONE lumi_admin_log row (the treasury logs it as the admin; the page no longer adds its own).
  const admin = require("../../src/lumiAdminPage.js");                            // the admin page module
  const server = http.createServer((req, res) => {                                // as webPanel.js does for /lumi
    const url = new URL(req.url, `http://${req.headers.host}`);                   // parsed
    admin.handleLumiAdminRequest(req, res, { url, pathname: url.pathname }).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }); // hand it over
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));                     // a free port
  const port = server.address().port;                                             // which
  const cookie = `sgc_panel_sess=${encodeURIComponent(auth.createSession("720000000000000009", "AdminDoll", "", [], { isPanelAdmin: true }))}`; // a panel admin
  const call = (path, method = "GET", form = null) => new Promise((resolve, reject) => { // one request
    const body = form ? new URLSearchParams(form).toString() : undefined;         // a form post
    const headers = { host: `127.0.0.1:${port}`, cookie };                        // logged in
    if (body !== undefined) Object.assign(headers, { origin: `http://127.0.0.1:${port}`, "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) }); // same-origin form
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";                                                              // the body
      res.setEncoding("utf8");                                                    // text
      res.on("data", (c) => { text += c; });                                      // collect
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text })); // done
    });
    req.on("error", reject);                                                      // trouble
    if (body !== undefined) req.write(body);                                      // the form
    req.end();                                                                    // send
  });
  try {
    const page = await call("/lumi");                                             // the admin page
    assert.equal(page.status, 200, page.text.slice(0, 200));                      // renders
    assert.match(page.text, /Lumi-Town Bank/);                                    // the bank card
    assert.match(page.text, /Lumi Arcade/);                                       // a themed shop
    setBalance(eco, SHOP.snacks, bal(SHOP.snacks) + 500);                         // something to sweep
    const n = logRows("treasury.sweep").length;                                   // rows before
    const posted = await call("/lumi/sweep", "POST", {});                         // Sweep now
    assert.equal(posted.status, 303);                                             // back to the page
    assert.deepEqual(logRows("treasury.sweep").slice(n), ["AdminDoll"]);          // ONE row, as the admin
    const m = logRows("treasury.payOwed").length;                                 // rows before
    assert.equal((await call("/lumi/pay-owed", "POST", {})).status, 303);         // Pay owed now
    assert.deepEqual(logRows("treasury.payOwed").slice(m), ["AdminDoll"]);        // ONE row, as the admin
  } finally {
    server.close();                                                               // tidy up
  }
  assert.equal(sql().prepare("SELECT COUNT(*) AS n FROM lumi_owed").get().n, 0);  // nothing owed: the bank paid everything
});

// ------------------------------------------------------------------------------------------------ front-end <-> routes

// Every API path the copied pages call (found by scanning public/lumi/**/*.js for LUMI_API / API / BASE + "..."),
// with sample ids. Each must be a registered route, so a page never calls into a 404 by a naming slip.
const PAGE_CALLS = [
  ["GET", "coins"], ["GET", "lumi-look"], ["GET", "lumi-pet/state"], ["POST", "lumi-pet/visit"], ["POST", "lumi-pet/act"], // common.js, lumi-sprite.js, the pet
  ["POST", "lumi-pet/battle"], ["POST", "lumi-pet/battle/act"], ["POST", "lumi-pet/dungeon"], ["POST", "lumi-pet/dungeon/act"], // battle-ui.js, dungeon-ui.js
  ["GET", "lumi-pet/dungeon/tale"], ["POST", "lumi-pet/dungeon/tale"], ["POST", "lumi-pet/garden"],                      // tales, the garden
  ["GET", "lumi-pet/parties"], ["POST", "lumi-pet/parties"], ["GET", "lumi-pet/parties/ABCD1234"], ["POST", "lumi-pet/parties/ABCD1234"], ["GET", "lumi-pet/parties/ABCD1234/stream"], // parties
  ["POST", "lumi-pet/town"], ["GET", "lumi-pet/town/stream"], ["POST", "lumi-pet/town/say"], ["POST", "lumi-pet/town/emote"], // the town
  ["GET", "lumi-pet/houses"], ["POST", "lumi-pet/houses/here"], ["GET", "lumi-pet/houses/123"], ["POST", "lumi-pet/houses/123/knock"], ["POST", "lumi-pet/houses/123/guestbook"], // homes
  ["GET", "lumi-pet/knocks/k1"], ["POST", "lumi-pet/knocks/k1/answer"],                                                  // knocks
  ["GET", "lumi-pet/city"], ["POST", "lumi-pet/estate"], ["GET", "lumi-pet/heights/left"], ["GET", "lumi-pet/heights/left/3"], // Lumi City
  ["GET", "prism-drop/run"], ["POST", "prism-drop/drop"],                                                                // Prism Drop
  ["GET", "lumi-launch/state"], ["POST", "lumi-launch/start"], ["POST", "lumi-launch/finish"],                           // Lumi Launch
  ["GET", "lumi-soft/state"], ["POST", "lumi-soft/start"], ["POST", "lumi-soft/continue"], ["POST", "lumi-soft/finish"], // Lumi-Soft
  ...["breakout", "snake", "teacup-tower"].flatMap((slug) => [["POST", `${slug}/run`], ["POST", `${slug}/run/finish`], ["GET", `${slug}/tables`], ["POST", `${slug}/tables`],
    ["GET", `${slug}/tables/T1`], ["POST", `${slug}/tables/T1`], ["POST", `${slug}/tables/T1/board`], ["GET", `${slug}/tables/T1/stream`]]), // arcade/arcade.js
];
// erinne paths the pages still mention but Lumi-Town dropped on purpose (TV play, web push): they stay unrouted.
const DROPPED = [["POST", "lumi-pet/push"], ["POST", "lumi-pet/push/off"], ["POST", "lumi-pet/tv/player"], ["POST", "lumi-pet/parties/ABCD1234/tv/input"], ["POST", "lumi-pet/parties/ABCD1234/tv/close"], ["POST", "lumi-launch/tv/player"]];

test("every API path the pages call is a registered route (and the dropped TV/push ones are not)", () => {
  const routes = lumi.getRouter().list();                                         // the route table
  const fits = (pattern, path) => {                                               // router.js's matching, in short
    const p = pattern.split("/").filter(Boolean), s = path.split("/").filter(Boolean); // segments
    return p.length === s.length && p.every((seg, i) => seg.startsWith(":") || seg === s[i]); // same shape
  };
  const has = (method, path) => routes.some((r) => r.method === method && fits(r.pattern, `/api/${path}`)); // registered?
  assert.deepEqual(PAGE_CALLS.filter(([m, p]) => !has(m, p)).map(([m, p]) => `${m} ${p}`), [], "page calls without a route"); // none missing
  assert.deepEqual(DROPPED.filter(([m, p]) => has(m, p)).map(([m, p]) => `${m} ${p}`), [], "dropped paths that came back"); // none routed
  const big = routes.filter((r) => r.maxBody > 16 * 1024).map((r) => r.pattern).sort(); // routes with a bigger body cap
  assert.deepEqual(big, ["/api/breakout/run/finish", "/api/lumi-launch/finish", "/api/lumi-soft/finish", "/api/snake/run/finish", "/api/teacup-tower/run/finish"]); // only the run logs
});

test("a body over a route's maxBody gets a real 413 answer (the socket is drained, not reset)", async () => {
  const huge = JSON.stringify({ run: 1, shots: [], pad: "x".repeat(200 * 1024) }); // 200 KB: over Lumi Launch's 128 KB
  const r = await request("/lumipet/api/lumi-launch/finish", { method: "POST", raw: huge }); // as the page would send it
  assert.equal(r.status, 413);                                                    // the client hears 413
  assert.equal(r.json.code, "too_large");                                         // with the JSON error
  const small = await request("/lumipet/api/lumi-pet/act", { method: "POST", raw: JSON.stringify({ action: "cuddle", pad: "x".repeat(20 * 1024) }) }); // over the default 16 KB
  assert.equal(small.status, 413);                                                // also a real answer
});
