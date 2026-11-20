// src/lumiAdminPage.js over real HTTP (a throwaway server on a random port, in-memory economy, no Discord): the page
// renders every section from a seeded economy, knob/override/policy/scale/category/seed/move/pause/sweep posts go
// through tuning/treasury and land in lumi_admin_log, non-admins and cross-origin posts are refused, and a hostile
// account name is HTML-escaped.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
process.env.WEB_PANEL_SESSION_SECRET = "test-secret-test-secret-test-secret-123"; // sessions need a signing secret
delete process.env.WEB_PANEL_TRUSTED_ORIGINS;                                     // only the server's own host is trusted
delete process.env.WEB_PANEL_BASE_PATH;                                           // pages live at /lumi
const { eco, lumi, db, sgc, tuning, treasury } = boot();                          // in-memory economy + Lumi-Town
const auth = require("../../src/webPanelAuth.js");                                // to fake Discord logins
const admin = require("../../src/lumiAdminPage.js");                              // the module under test
const PLAYER = "333333333333333333";                                              // a Discord-shaped player id
const CB = eco.CENTRAL_BANK_USER_ID;                                              // Central Bank's account id
const ADMIN_COOKIE = `sgc_panel_sess=${encodeURIComponent(auth.createSession("444444444444444444", "AdminDoll", "", [], { isPanelAdmin: true }))}`; // a panel admin
const MEMBER_COOKIE = `sgc_panel_sess=${encodeURIComponent(auth.createSession("555555555555555555", "JustAMember", "", []))}`; // logged in, not an admin

const server = http.createServer((req, res) => {                                  // what webPanel.js does for /lumi paths
  const url = new URL(req.url, `http://${req.headers.host}`);                     // parsed URL
  admin.handleLumiAdminRequest(req, res, { url, pathname: url.pathname }).then((handled) => { if (!handled) { res.writeHead(404); res.end("not lumi"); } }); // hand it over
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));                       // random free port
const PORT = server.address().port;                                               // which one
const ORIGIN = `http://127.0.0.1:${PORT}`;                                        // our own origin
after(() => { lumi.stopLumiGames(); server.close(); });                          // tidy up

// One request; resolves { status, headers, body }.
function request(path, { method = "GET", headers = {}, form } = {}) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : undefined;         // x-www-form-urlencoded
    const h = { host: `127.0.0.1:${PORT}`, ...headers };                          // default host header
    if (body !== undefined) { h["content-type"] = "application/x-www-form-urlencoded"; h["content-length"] = Buffer.byteLength(body); } // form headers
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers: h }, (res) => {
      let data = "";                                                              // collected body
      res.setEncoding("utf8");                                                    // text
      res.on("data", (c) => { data += c; });                                      // collect
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data })); // done
    });
    req.on("error", reject);                                                      // network trouble
    if (body !== undefined) req.write(body);                                      // send the form
    req.end();                                                                    // go
  });
}

// An admin form post from our own origin; returns the response.
const post = (path, form, headers = {}) => request(path, { method: "POST", form, headers: { cookie: ADMIN_COOKIE, origin: ORIGIN, ...headers } }); // same-origin admin POST

// Follow a 303 and return the page it lands on.
async function follow(r) {
  assert.equal(r.status, 303);                                                    // POST -> redirect
  assert.match(r.headers.location, /^\/lumi\?flash=[0-9a-f]{24}(#[a-z-]+)?$/);  // one-time flash token, no message in the URL
  return request(r.headers.location.split("#")[0], { headers: { cookie: ADMIN_COOKIE } }); // the page with the flash
}

// The newest lumi_admin_log row for a key.
const lastLog = (key) => eco.getEconomyDb().prepare("SELECT * FROM lumi_admin_log WHERE key = ? ORDER BY id DESC LIMIT 1").get(key); // audit lookup

// A seeded economy: money in the bank, a player who spent and won in two games.
function seedEconomy() {
  resetLumi(eco);                                                                 // clean Lumi pool + settings
  eco.getEconomyDb().exec("DELETE FROM transactions; DELETE FROM lumi_admin_log;"); // fresh ledger + audit log per test
  setBalance(eco, CB, 1_000_000);                                                // Central Bank can afford a seed
  setBalance(eco, treasury.BANK, 50_000);                                         // the bank can pay prizes
  setBalance(eco, treasury.HOLDINGS, 120_000);                                    // the reserve
  setBalance(eco, PLAYER, 10_000);                                                // the player's wallet
  db.tx(() => {
    sgc.spend(PLAYER, "Player", 25, "launch", "entry");                           // 5 SGC in
    sgc.pay(PLAYER, "Player", 100, "launch", "win", "lumi-launch:t1");            // 20 SGC out -> 400%: printing
    sgc.spend(PLAYER, "Player", 25, "breakout", "entry");                         // 5 SGC in
    sgc.pay(PLAYER, "Player", 10, "breakout", "win", "breakout:t1");              // 2 SGC out -> 40%: not profitable
  });
}

test("the page renders every section from the seeded economy", async () => {
  seedEconomy();                                                                  // known state
  const r = await request("/lumi", { headers: { cookie: ADMIN_COOKIE } });        // admin GET
  assert.equal(r.status, 200);
  assert.match(r.headers["cache-control"], /no-store/);                           // never cached
  for (const id of ["treasury", "knobs", "overrides", "scale", "policy", "actions", "log"]) assert.match(r.body, new RegExp(`id="${id}"`)); // all seven sections
  assert.match(r.body, /Lumi-Town Bank/);                                         // account names
  assert.match(r.body, /Moon Capsule Co\./);
  assert.match(r.body, /49,978 SGC/);                                             // bank balance: 50,000 minus the 20 + 2 SGC prizes
  assert.match(r.body, /LUMI on Doll Street/);                                    // stock card
  assert.match(r.body, /Shareholders/);
  assert.match(r.body, /Central Bank has <strong>1,000,000 SGC<\/strong>/);       // seed card shows CB
  assert.match(r.body, /Lumi Launch/);                                            // a knob row per defined game
  assert.match(r.body, /Teacup Tower/);
  assert.match(r.body, /printing/);                                               // launch returns 400%
  assert.match(r.body, /not profitable to play/);                                 // breakout returns 40%
  assert.match(r.body, /400%/);
  assert.match(r.body, /Arcade entry/);                                           // scale preview rows
  assert.match(r.body, /Moon capsule/);
});

test("ledger stats: SGC in, out, plays and return per game for 24 h and 7 d", () => {
  seedEconomy();                                                                  // known state
  const s = admin.ledgerStats();                                                  // two indexed queries
  assert.deepEqual(s.launch.d1, { spends: 1, in: 5, refunds: 0, prizes: 1, out: 20 }); // 25*0.2 in, 100*0.2 out
  assert.deepEqual(s.launch.d7, s.launch.d1);                                     // same rows in the week
  assert.equal(s.breakout.d1.in, 5);
  assert.equal(s.breakout.d1.out, 2);
  assert.equal(s.share, undefined);                                               // not a game
});

test("posting a knob change updates tuning and writes lumi_admin_log as the admin", async () => {
  seedEconomy();                                                                  // known state
  const r = await post("/lumi/game", { game: "launch", enabled: "on", priceMult: "2", payoutMult: "1", dailyCap: "50" }); // two knobs change
  const page = await follow(r);                                                   // land back on the page
  assert.match(r.headers.location, /#knobs$/);                                    // anchored to the table
  assert.match(page.body, /flash-success">Lumi Launch: saved priceMult, dailyCap\./); // the flash message
  tuning.reload();                                                                // read what was stored
  assert.equal(tuning.gameSettings("launch").priceMult, 2);
  assert.equal(tuning.gameSettings("launch").dailyCap, 50);
  assert.equal(tuning.scalePrice("launch", "entry", 25), 10);                     // 25 * 0.2 * 2
  const log = lastLog("lumi.game.launch.priceMult");                              // audit row
  assert.equal(log.who, "AdminDoll");
  assert.equal(log.new, "2");
  assert.equal(lastLog("lumi.game.launch.payoutMult"), undefined);                // unchanged knobs aren't logged
  const off = await follow(await post("/lumi/game", { game: "launch", priceMult: "2", payoutMult: "1", dailyCap: "50" })); // box unticked
  assert.match(off.body, /saved enabled/);
  assert.equal(tuning.enabled("launch"), false);
  const bad = await follow(await post("/lumi/game", { game: "launch", enabled: "on", priceMult: "-1", payoutMult: "1", dailyCap: "50" })); // junk
  assert.match(bad.body, /flash-error">Price multiplier must be/);
  assert.equal(tuning.enabled("launch"), false);                                  // nothing written
  const unknown = await follow(await post("/lumi/game", { game: "nope", priceMult: "1", payoutMult: "1", dailyCap: "1" })); // unknown game
  assert.match(unknown.body, /Unknown game/);
});

test("non-admins and logged-out visitors are refused, and nothing changes", async () => {
  seedEconomy();                                                                  // known state
  assert.equal((await request("/lumi")).status, 403);                             // no session
  assert.equal((await request("/lumi", { headers: { cookie: MEMBER_COOKIE } })).status, 403); // member, not admin
  const r = await request("/lumi/scale", { method: "POST", form: { scale: "0.5" }, headers: { cookie: MEMBER_COOKIE, origin: ORIGIN } }); // member POST
  assert.equal(r.status, 403);
  tuning.reload();
  assert.equal(tuning.scale(), 0.2);                                              // untouched
});

test("cross-origin and origin-less POSTs are refused even with an admin session", async () => {
  seedEconomy();                                                                  // known state
  const cross = await post("/lumi/scale", { scale: "0.5" }, { origin: "https://evil.example" }); // another site
  assert.equal(cross.status, 403);
  assert.match(cross.body, /cross-origin/);
  const bare = await request("/lumi/scale", { method: "POST", form: { scale: "0.5" }, headers: { cookie: ADMIN_COOKIE } }); // no Origin/Referer
  assert.equal(bare.status, 403);
  const refererEvil = await request("/lumi/scale", { method: "POST", form: { scale: "0.5" }, headers: { cookie: ADMIN_COOKIE, referer: "https://evil.example/x" } }); // bad referer
  assert.equal(refererEvil.status, 403);
  tuning.reload();
  assert.equal(tuning.scale(), 0.2);                                              // untouched
  assert.equal((await request("/lumi/game", { headers: { cookie: ADMIN_COOKIE } })).status, 405); // GET on an action
  assert.equal((await post("/lumi/nope", {})).status, 404);                       // unknown action
});

test("a hostile themed-account name is HTML-escaped everywhere it shows", async () => {
  seedEconomy();                                                                  // known state
  const hostile = `<script>alert("x")</script>'`;                                 // tags, quotes, apostrophe
  const r = await post("/lumi/category", { category: "arcade", displayName: hostile, games: "prism, launch, soft, breakout, snake, teacup-tower" }); // rename through the form
  const page = await follow(r);                                                   // the page after
  assert.equal(treasury.categories().find((c) => c.category === "arcade").displayName, hostile); // stored as typed
  assert.doesNotMatch(page.body, /<script>alert/);                                // never raw
  assert.match(page.body, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&#39;/); // escaped text
  assert.equal(lastLog("category.arcade").who, "AdminDoll");                      // treasury logged it
  const badGames = await follow(await post("/lumi/category", { category: "arcade", displayName: "Lumi Arcade", games: "prism, b@d;entry" })); // junk entry
  assert.match(badGames.body, /is not a &quot;game&quot; or &quot;game:kind&quot; entry/);
});

test("overrides: validated whole SGC >= 0, saved through setGame", async () => {
  seedEconomy();                                                                  // known state
  const bad = await follow(await post("/lumi/overrides", { game: "soft", priceOverrides: '{"entry": -3}', payoutOverrides: "" })); // negative
  assert.match(bad.body, /must be a whole number of SGC/);
  const badJson = await follow(await post("/lumi/overrides", { game: "soft", priceOverrides: "{entry: 3", payoutOverrides: "" })); // broken JSON
  assert.match(badJson.body, /valid JSON/);
  const ok = await follow(await post("/lumi/overrides", { game: "soft", priceOverrides: '{"entry": 3, "continue": 7}', payoutOverrides: "" })); // good
  assert.match(ok.body, /saved price overrides/);
  assert.equal(tuning.scalePrice("soft", "entry", 25), 3);                        // override wins
  assert.equal(lastLog("lumi.game.soft.priceOverrides").who, "AdminDoll");
  await post("/lumi/overrides", { game: "soft", priceOverrides: "", payoutOverrides: "" }); // clear them
  assert.equal(tuning.scalePrice("soft", "entry", 25), 5);                        // back to the formula
});

test("economy scale: preview changes nothing, saving does", async () => {
  seedEconomy();                                                                  // known state
  const preview = await request("/lumi?previewScale=0.4", { headers: { cookie: ADMIN_COOKIE } }); // GET preview
  assert.match(preview.body, /At play 0\.4 · item 1</);                           // play previewed, item kept
  assert.match(preview.body, /Save play 0\.4 · item 1</);
  tuning.reload();
  assert.equal(tuning.scale(), 0.2);                                              // preview didn't save
  const junk = await request("/lumi?previewScale=-1", { headers: { cookie: ADMIN_COOKIE } }); // bad preview
  assert.match(junk.body, /Preview scale must be/);
  const saved = await follow(await post("/lumi/scale", { scale: "0.4" }));        // save it
  assert.match(saved.body, /Play scale changed from 0\.2 to 0\.4/);
  assert.equal(tuning.scale(), 0.4);
  assert.equal(tuning.scalePrice("soft", "entry", 25), 10);                       // a play price: 25 * 0.4
  assert.equal(tuning.scalePrice("pet", "capsule", 150), 150);                    // an item: still 150 * item scale 1
  assert.equal(lastLog("lumi.scale").new, "0.4");
  assert.equal(lastLog("lumi.itemScale"), undefined);                             // item scale untouched, not logged
  const zero = await follow(await post("/lumi/scale", { scale: "0" }));           // 0 is refused
  assert.match(zero.body, /flash-error/);
});

test("item scale: the preview groups items and play, saving logs it, play is untouched", async () => {
  seedEconomy();                                                                  // known state
  const page = await request("/lumi", { headers: { cookie: ADMIN_COOKIE } });     // the page as saved
  const section = page.body.slice(page.body.indexOf('id="scale"'), page.body.indexOf('id="policy"')); // the scales section only
  const itemAt = section.indexOf("Item scale: now 1");                            // the item group heading
  const playAt = section.indexOf("Play scale: now 0.2");                          // the play group heading
  assert.ok(itemAt > 0 && playAt > itemAt);                                       // items first, then play
  const items = section.slice(itemAt, playAt);                                    // the item rows
  const plays = section.slice(playAt);                                            // the play rows
  assert.match(items, /Capsule<div class="lumi-small">pet · capsule<\/div><\/td><td>price<\/td><td class="lumi-num">150<\/td><td class="lumi-num">150</); // 150 -> 150
  assert.match(items, /Moon capsule<div class="lumi-small">pet · moon<\/div><\/td><td>price<\/td><td class="lumi-num">300<\/td><td class="lumi-num">300</); // 300 -> 300
  assert.match(plays, /Arcade entry<div class="lumi-small">soft · entry<\/div><\/td><td>price<\/td><td class="lumi-num">25<\/td><td class="lumi-num">5</); // 25 -> 5
  assert.match(plays, /Lumi-Soft continue<div class="lumi-small">soft · continue<\/div><\/td><td>price<\/td><td class="lumi-num">50<\/td><td class="lumi-num">10</); // 50 -> 10
  assert.doesNotMatch(plays, /pet · capsule/);                                    // no item under play
  assert.doesNotMatch(items, /soft · entry/);                                     // no play row under items
  const preview = await request("/lumi?previewItemScale=0.5", { headers: { cookie: ADMIN_COOKIE } }); // preview the item scale
  assert.match(preview.body, /At play 0\.2 · item 0\.5</);
  assert.match(preview.body, /<td class="lumi-num">150<\/td><td class="lumi-num">150<\/td><td class="lumi-num" style="color:#ffaa44">75</); // capsule would be 75
  const junk = await request("/lumi?previewItemScale=abc", { headers: { cookie: ADMIN_COOKIE } }); // bad preview
  assert.match(junk.body, /Preview item scale must be/);
  const saved = await follow(await post("/lumi/scale", { scale: "0.2", itemScale: "0.5" })); // the save form sends both
  assert.match(saved.body, /Item scale changed from 1 to 0\.5/);
  assert.doesNotMatch(saved.body, /Play scale changed/);                          // play was the same
  assert.equal(tuning.itemScale(), 0.5);
  assert.equal(tuning.scale(), 0.2);
  assert.equal(tuning.scalePrice("pet", "capsule", 150), 75);                     // item: 150 * 0.5
  assert.equal(tuning.scalePrice("soft", "entry", 25), 5);                        // play: unchanged
  const log = lastLog("lumi.itemScale");                                          // audit row
  assert.equal(log.who, "AdminDoll");
  assert.equal(log.new, "0.5");
  assert.equal(lastLog("lumi.scale"), undefined);                                 // play not rewritten
  const same = await follow(await post("/lumi/scale", { scale: "0.2", itemScale: "0.5" })); // nothing differs
  assert.match(same.body, /Scales unchanged/);
  const zero = await follow(await post("/lumi/scale", { scale: "0.3", itemScale: "0" })); // 0 is refused...
  assert.match(zero.body, /Item scale must be/);
  assert.equal(tuning.scale(), 0.2);                                              // ...and nothing was written
  const knobs = page.body.slice(page.body.indexOf('id="knobs"'), page.body.indexOf('id="overrides"')); // the game rows
  assert.match(knobs, /entry 25→5 \(play\)/);                                     // a play key shows its play price
  assert.match(knobs, /capsule 150→150 \(item\)/);                                // an item key shows its item price (as saved when the page loaded)
  assert.match(knobs, /visit 25→5 \(prize\)/);                                    // a prize uses the play scale
});

test("treasury policy: validated, only changed keys written", async () => {
  seedEconomy();                                                                  // known state
  const form = { bankTarget: "100000", bankCeiling: "200000", sweepIntervalMs: "900000", refillBufferPct: "0.1", reserveFloor: "50000", lumiDividendRate: "0.02", bands: "[[0.25,1],[0.5,0.75],[1,0.5],[1.5,0.25],[null,0.1]]" }; // the defaults
  const same = await follow(await post("/lumi/policy", form));                    // nothing differs
  assert.match(same.body, /Treasury policy unchanged/);
  const lowCeiling = await follow(await post("/lumi/policy", { ...form, bankCeiling: "5" })); // under the target
  assert.match(lowCeiling.body, /ceiling must be 0/);
  const badBands = await follow(await post("/lumi/policy", { ...form, bands: "[[0.5,1],[0.25,0.5]]" })); // not rising
  assert.match(badBands.body, /must rise/);
  const ok = await follow(await post("/lumi/policy", { ...form, bankTarget: "80000", bands: "[[0.5,0.9],[null,0.05]]" })); // two changes
  assert.match(ok.body, /saved: bankTarget, bands/);
  assert.equal(tuning.treasuryPolicy().bankTarget, 80000);
  assert.deepEqual(tuning.treasuryPolicy().bands, [[0.5, 0.9], [Infinity, 0.05]]);
  assert.equal(lastLog("lumi.treasury.bankTarget").who, "AdminDoll");
});

test("actions: seed (confirm + once), move, pause, pay owed, sweep", async () => {
  seedEconomy();                                                                  // known state
  eco.getEconomyDb().prepare("DELETE FROM system_state WHERE key = 'lumi.seeded_at'").run(); // never seeded
  const noConfirm = await follow(await post("/lumi/seed", { total: "250000", toBank: "100000", toHoldings: "150000" })); // box unticked
  assert.match(noConfirm.body, /Tick the confirm box/);
  const mismatch = await follow(await post("/lumi/seed", { total: "250000", toBank: "100000", toHoldings: "1", confirm: "on" })); // parts don't add up
  assert.match(mismatch.body, /must equal the total/);
  const bankBefore = eco.getBalance(treasury.BANK);                               // 50,000
  const seeded = await follow(await post("/lumi/seed", { total: "250,000", toBank: "100000", toHoldings: "150000", confirm: "on" })); // real seed
  assert.match(seeded.body, /Seeded 100,000 SGC/);
  assert.equal(eco.getBalance(treasury.BANK), bankBefore + 100000);
  assert.equal(eco.getBalance(CB), 750000);
  const again = await follow(await post("/lumi/seed", { total: "2", toBank: "1", toHoldings: "1", confirm: "on" })); // second time
  assert.match(again.body, /already seeded/);
  const forced = await follow(await post("/lumi/seed", { total: "2", toBank: "1", toHoldings: "1", confirm: "on", force: "on" })); // forced
  assert.match(forced.body, /flash-success/);

  const holdBefore = eco.getBalance(treasury.HOLDINGS);                           // reserve before the move
  const moved = await follow(await post("/lumi/move", { from: treasury.HOLDINGS, to: treasury.BANK, amount: "1000" })); // reserve -> bank
  assert.match(moved.body, /Moved 1,000 SGC/);
  assert.equal(eco.getBalance(treasury.HOLDINGS), holdBefore - 1000);
  const outside = await follow(await post("/lumi/move", { from: treasury.BANK, to: PLAYER, amount: "5" })); // out of the pool
  assert.match(outside.body, /Pick two Lumi-Town accounts/);
  assert.equal(lastLog("treasury.move").who, "AdminDoll");

  const paused = await follow(await post("/lumi/pause", { paused: "true" }));    // pause
  assert.match(paused.body, /Payouts are PAUSED/);
  assert.equal(tuning.treasuryPolicy().payoutsPaused, true);
  db.tx(() => sgc.pay(PLAYER, "Player", 50, "prism", "win", "lumi-prism:p1"));    // a prize while paused -> owed
  assert.equal(eco.getEconomyDb().prepare("SELECT COUNT(*) AS n FROM lumi_owed").get().n, 1);
  await post("/lumi/pause", { paused: "false" });                                 // resume
  assert.equal(tuning.treasuryPolicy().payoutsPaused, false);
  const paid = await follow(await post("/lumi/pay-owed", {}));                   // pay it
  assert.match(paid.body, /Paid 1 owed prize/);
  assert.equal(eco.getEconomyDb().prepare("SELECT COUNT(*) AS n FROM lumi_owed").get().n, 0);
  assert.equal(lastLog("treasury.payOwed").who, "AdminDoll");

  setBalance(eco, "__LUMI_SNACKS__", 1000);                                       // a shop with money
  const swept = await follow(await post("/lumi/sweep", {}));                     // sweep now
  assert.match(swept.body, /Swept \d/);
  assert.ok(eco.getBalance("__LUMI_SNACKS__") < 1000);                            // taxed
  assert.equal(lastLog("treasury.sweep").who, "AdminDoll");
  const log = await request("/lumi", { headers: { cookie: ADMIN_COOKIE } });      // the admin log section
  assert.match(log.body, /treasury\.sweep/);
});

test("strict validators", () => {
  assert.throws(() => admin.parseBandsInput("[[null,0.5],[1,0.1]]"), /last band/); // open band must be last
  assert.throws(() => admin.parseBandsInput("[[0.5,2]]"), /rate must be/);        // rate over 1
  assert.equal(admin.parseBandsInput("[[0.5,1],[null,0.1]]"), "[[0.5,1],[null,0.1]]"); // clean JSON back
  assert.throws(() => admin.parseOverridesInput('{"a b": 1}', "X"), /not a valid key/); // bad key
  assert.throws(() => admin.parseOverridesInput('{"a": 1.5}', "X"), /whole number/); // fraction
  assert.deepEqual(admin.parseOverridesInput("", "X"), {});                       // empty clears
});
