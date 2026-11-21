// Lumi-Town on Discord, phases D3, D4 and D6 (docs/plans/lumi-town-discord.md §6-7):
//   src/lumi/discord/news.js       big wins / owed prizes / showdowns, checked against the DB, batched, names hidden on
//                                  request, and the daily Lumi-Town Bank summary
//   src/commandSync.js             the global command overwrite keeps the Activity's Entry Point ("Launch") command
//   src/lumi/routes/activity.js    the Activity page and its sign-in (code -> token -> member check -> iframe cookie)
//   src/lumi/router.js             rate limits per logged-in player (Activity players share Discord's proxy IPs)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";
import { serve } from "./pet_http.mjs";

const require = createRequire(import.meta.url);
process.env.DISCORD_OAUTH_CLIENT_ID = "111111111111111111";            // the bot's OAuth app (fake)
process.env.DISCORD_OAUTH_CLIENT_SECRET = "test-secret";
const { eco, db, lumi, sgc, tuning, treasury } = boot();               // one in-memory DB for this file
const news = require("../../src/lumi/discord/news.js");
const prefs = require("../../src/lumi/discord/prefs.js");
const events = require("../../src/lumi/events.js");
const users = require("../../src/lumi/users.js");
const discord = require("../../src/lumi/discord/index.js");
const member = require("../../src/lumi/discord/member.js");
const activity = require("../../src/lumi/routes/activity.js");
const auth = require("../../src/lumi/auth.js");
const { setSetting } = require("../../src/panelSettings.js");
const { keepEntryPoints, setGlobalCommands } = require("../../src/commandSync.js");

const BANK = "__LUMI_TOWN_BANK__", HOLD = "__LUMI_HOLDINGS__";
news.listenForTests();                                                 // hear lumi:news without a bot
setSetting("lumi.discord.newsBigWin", 500);                            // a 500 SGC prize is news here
const posted = [];
const post = async (embed) => { posted.push(embed.toJSON()); };       // the fake channel
const win = (uid, name, native, ref) => { users.remember(uid, name); return db.tx(() => sgc.pay(uid, name, native, "prism", "win", ref)); }; // a Prism Drop prize (play scale 0.2)
function fresh() { resetLumi(eco); setSetting("lumi.discord.newsBigWin", 500); setBalance(eco, BANK, 100000); setBalance(eco, HOLD, 100000); tuning.setGame("prism", "dailyCap", 0, "test"); posted.length = 0; } // resetLumi wipes setting.lumi.*, so the news threshold goes back on after it

// ------------------------------------------------------------------------------------------------ news (D3)

test("a big prize is news; a small one, a non-prize kind, or news switched off is not", async () => {
  fresh();
  win("200000000000000001", "Mika", 5000, "lumi-prism:n1");           // 1,000 SGC
  win("200000000000000002", "Ren", 500, "lumi-prism:n2");             // 100 SGC: too small
  users.remember("200000000000000003", "Sol");
  db.tx(() => sgc.pay("200000000000000003", "Sol", 5000, "pet", "visit", "lumi-pet:x:day")); // a visit reward is never news
  setSetting("lumi.discord.newsEnabled", "false");
  win("200000000000000004", "Off", 5000, "lumi-prism:n4");            // switched off: ignored
  setSetting("lumi.discord.newsEnabled", null);
  assert.equal(news.pendingCount(), 1);
  const embed = await news.flush({ post });
  assert.equal(posted.length, 1);
  assert.match(embed.toJSON().description, /🏆 \*\*Mika\*\* won \*\*1,000 SGC\*\* in Prism Drop!/u);
});

test("a prize whose transaction rolled back never becomes news", async () => {
  fresh();
  assert.throws(() => db.tx(() => { sgc.pay("200000000000000005", "Ghost", 5000, "prism", "win", "lumi-prism:rb"); throw new Error("boom"); }), /boom/);
  assert.equal(news.pendingCount(), 1);                                // heard inside the transaction...
  const embed = await news.flush({ post });
  assert.equal(embed, null);                                           // ...but the ref isn't there: nothing posted
  assert.equal(posted.length, 0);
});

test("players who hid their name are 'a Lumi-Town neighbour'; long batches are cut at 15 lines", async () => {
  fresh();
  prefs.setNewsHidden("200000000000000006", true);
  win("200000000000000006", "Secret", 5000, "lumi-prism:h1");
  for (let i = 0; i < 19; i += 1) win(`2000000000000001${String(i).padStart(2, "0")}`, `P${i}`, 5000, `lumi-prism:b${i}`);
  const text = (await news.flush({ post })).toJSON().description;
  assert.match(text, /a Lumi-Town neighbour/u);
  assert.doesNotMatch(text, /Secret/u);
  assert.equal(text.split("\n").length, 16);                           // 15 lines + "…and 5 more!"
  assert.match(text, /and 5 more/u);
});

test("an owed prize is news when the bank finally pays it", async () => {
  fresh();
  setBalance(eco, BANK, 0); setBalance(eco, HOLD, 50000);              // dry bank, reserve at its floor: the prize is owed
  const r = win("200000000000000007", "Patient", 5000, "lumi-prism:o1");
  assert.equal(r.owed, 1000);
  await news.flush({ post });
  assert.equal(posted.length, 0);                                      // owed, not paid: no news yet
  setBalance(eco, BANK, 5000);
  treasury.payOwedNow("test");
  const text = (await news.flush({ post })).toJSON().description;
  assert.match(text, /paid \*\*Patient\*\* a \*\*1,000 SGC\*\* Prism Drop prize it owed/u);
});

test("showdown results are news when the race settled (2+ racers), and junk events are ignored", async () => {
  fresh();
  eco.getEconomyDb().prepare("INSERT INTO lumi_coin_refs (ref, user_id, amount, at) VALUES (?, ?, 0, 0)").run("breakout:run9", "200000000000000008");
  users.remember("200000000000000008", "Racer");
  events.publish(events.NEWS_CHANNEL, "showdown", { game: "breakout", uid: "200000000000000008", name: "Racer", racers: 3, ref: "breakout:run9" });
  events.publish(events.NEWS_CHANNEL, "showdown", { game: "breakout", uid: "200000000000000009", racers: 2, ref: "breakout:never" }); // not committed
  events.publish(events.NEWS_CHANNEL, "showdown", { game: "breakout", uid: "1", racers: 1, ref: "x" }); // a solo "race"
  events.publish(events.NEWS_CHANNEL, "mystery", { uid: "1" });
  const text = (await news.flush({ post })).toJSON().description;
  assert.equal(text.split("\n").length, 1);
  assert.match(text, /🏁 \*\*Racer\*\* won a .* showdown against 2 other racers!/u);
});

test("the daily summary shows the bank and yesterday's top winners, once per day at the chosen LA hour", async () => {
  fresh();
  const morning = Date.UTC(2026, 10, 21, 17, 5, 0);                    // 09:05 in Los Angeles
  db.setClock(() => morning - 20 * 3_600_000);                         // yesterday afternoon: some wins
  win("200000000000000010", "Top", 10000, "lumi-prism:d1");            // 2,000
  win("200000000000000011", "Second", 5000, "lumi-prism:d2");          // 1,000
  db.setClock(() => morning);
  setSetting("lumi.discord.newsDailyHour", 9);
  assert.equal(await news.maybeDaily({ now: morning, post }), true);
  assert.equal(await news.maybeDaily({ now: morning + 60_000, post }), false); // not twice
  const text = posted.at(-1).description;
  assert.match(text, /Lumi-Town Bank:\*\* [\d,]+ SGC/u);
  assert.match(text, /🥇 Top: 2,000 SGC/u);
  assert.match(text, /🥈 Second: 1,000 SGC/u);
  setSetting("lumi.discord.newsDailyHour", 24);                        // off
  assert.equal(await news.maybeDaily({ now: morning + 86_400_000, post }), false);
  setSetting("lumi.discord.newsDailyHour", null);
  db.setClock(null);
});

// ------------------------------------------------------------------------------------------------ command sync (D4)

test("the global command overwrite keeps the Activity's Entry Point command exactly", async () => {
  const launch = { name: "launch", description: "Launch Lumi Pet", type: 4, handler: 2, integrationTypes: [0], contexts: [0, 1] };
  const ours = [{ name: "lumi-pet" }];
  assert.deepEqual(keepEntryPoints([{ name: "lumi-quote", type: 1 }, launch], ours), [
    { name: "lumi-pet" },
    { name: "launch", description: "Launch Lumi Pet", type: 4, handler: 2, integration_types: [0], contexts: [0, 1] },
  ]);
  let sent = null;
  const ok = { application: { commands: { fetch: async () => new Map([["1", launch]]), set: async (list) => { sent = list; } } } };
  await setGlobalCommands(ok, ours);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 4);
  sent = null;
  const down = { application: { commands: { fetch: async () => { throw new Error("Discord is down"); }, set: async (list) => { sent = list; } } } };
  assert.equal(await setGlobalCommands(down, ours), null);
  assert.equal(sent, null);                                            // never overwrote blind
});

// ------------------------------------------------------------------------------------------------ the Activity (D6)

/** A raw HTTP call that returns headers too. */
function call(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "content-type": "application/json", ...headers } }, (res) => {
      let data = ""; res.setEncoding("utf8"); res.on("data", (c) => { data += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(data); } catch { json = null; } resolve({ status: res.statusCode, headers: res.headers, body: data, json }); });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const server = await serve(lumi);
after(() => { server.close(); discord.stopLumiDiscord(); });
const clubbers = new Set(["300000000000000001"]);
const bot = {
  users: { fetch: async () => ({ send: async () => {} }) },
  channels: { fetch: async () => null },
  guilds: { cache: new Map([[member.clubGuildId(), { members: { fetch: async ({ user }) => { if (clubbers.has(user)) return {}; throw Object.assign(new Error("Unknown Member"), { code: 10007 }); } } }]]), fetch: async () => { throw new Error("no"); } },
};
/** Fake Discord: the code 'good-code-123' belongs to `who`. */
function fakeDiscord(who) {
  activity._setFetch(async (url, opts) => {
    if (String(url).endsWith("/oauth2/token")) {
      const form = new URLSearchParams(opts.body);
      assert.equal(form.get("redirect_uri"), null);                    // Activities omit it
      assert.equal(form.get("client_id"), "111111111111111111");
      return { ok: form.get("code") === "good-code-123", json: async () => (form.get("code") === "good-code-123" ? { access_token: "tok" } : { error: "invalid_grant" }) };
    }
    return { ok: true, json: async () => ({ id: who, username: "activityfan", avatar: null }) };
  });
}

test("the Activity doesn't exist until LUMI_ACTIVITY_ENABLED=true", async () => {
  delete process.env.LUMI_ACTIVITY_ENABLED;
  assert.equal((await call(server.port, "GET", "/lumipet/activity")).status, 404);
  assert.equal((await call(server.port, "POST", "/lumipet/api/activity/session", { code: "good-code-123" })).status, 404);
});

test("the Activity page loads the vendored SDK and boot script with no inline script", async () => {
  process.env.LUMI_ACTIVITY_ENABLED = "true";
  const page = await call(server.port, "GET", "/lumipet/activity/");
  assert.equal(page.status, 200);
  assert.match(page.body, /\/lumipet\/static\/vendor\/discord-embedded-app-sdk\.js\?v=/u);
  assert.match(page.body, /\/lumipet\/static\/activity\/boot\.js\?v=/u);
  assert.match(page.body, /"clientId":"111111111111111111"/u);
  assert.doesNotMatch(page.body, /<script>(?!\s*<)/u);                 // only src= and JSON scripts
  const sdk = await call(server.port, "GET", "/lumipet/static/vendor/discord-embedded-app-sdk.js");
  assert.equal(sdk.status, 200);                                       // the bundle is served
});

test("Activity sign-in: a club member gets an iframe-safe cookie; others, bad codes and a stopped bot are refused", async () => {
  process.env.LUMI_ACTIVITY_ENABLED = "true";
  fakeDiscord("300000000000000001");
  const off = await call(server.port, "POST", "/lumipet/api/activity/session", { code: "good-code-123" });
  assert.equal(off.status, 503);                                       // the bot isn't running: no member check possible
  discord.initLumiDiscord(bot);
  const ok = await call(server.port, "POST", "/lumipet/api/activity/session", { code: "good-code-123" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.next, "/lumipet/lumi-pet");
  assert.equal(ok.json.access_token, "tok");
  const cookie = ok.headers["set-cookie"][0];
  assert.match(cookie, /^lumi_sess=/u);
  for (const part of ["Path=/lumipet", "SameSite=None", "Secure", "HttpOnly", "Partitioned"]) assert.ok(cookie.includes(part), part);
  const session = cookie.split(";")[0];                                // the cookie works like a website login
  const me = await call(server.port, "GET", "/lumipet/api/coins", undefined, { cookie: session });
  assert.equal(me.status, 200);
  assert.equal(auth.sessionUserId({ headers: { cookie: session } }), "300000000000000001");

  fakeDiscord("300000000000000099");                                   // not in the club
  const stranger = await call(server.port, "POST", "/lumipet/api/activity/session", { code: "good-code-123" });
  assert.equal(stranger.status, 403);
  fakeDiscord("300000000000000001");
  const used = await call(server.port, "POST", "/lumipet/api/activity/session", { code: "stale-code-456" });
  assert.equal(used.status, 401);
  const weird = await call(server.port, "POST", "/lumipet/api/activity/session", { code: "<script>" });
  assert.equal(weird.status, 400);
  delete process.env.LUMI_ACTIVITY_ENABLED;
});
