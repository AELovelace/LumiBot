// Lumi-Town on Discord, phase D2 (docs/plans/lumi-town-discord.md §5): opt-in DM reminders.
//   src/lumi/discord/prefs.js      each player's choices (reminders, timezone, news name)
//   src/lumi/discord/reminders.js  the sweep (erinne's push sweep, as Discord DMs), hello DM, Stop button
//   /lumi-pet reminders | timezone | news, and POST /api/lumi-pet/discord from Lumi Pet's settings
// erinne tests/test_push.py at spec level: once per episode, stale drops, the 3 h gap, quiet hours, closed DMs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance } from "./lumi_env.mjs";
import { serve, client } from "./pet_http.mjs";

const require = createRequire(import.meta.url);
const { eco, db, lumi } = boot();                                      // one in-memory DB for this file
const discord = require("../../src/lumi/discord/index.js");            // the router
const prefs = require("../../src/lumi/discord/prefs.js");              // choices
const reminders = require("../../src/lumi/discord/reminders.js");      // the sweep
const member = require("../../src/lumi/discord/member.js");            // club check
const lumipet = require("../../src/lumi/pet/lumipet.js");              // the pet
const save = require("../../src/lumi/pet/save.js");                    // her save
const { setSetting } = require("../../src/panelSettings.js");          // admin knobs

const HOUR = 3_600_000;
const NOON_LA = Date.UTC(2026, 10, 20, 20, 0, 0);                      // 12:00 in Los Angeles (PST, UTC-8)
let now = NOON_LA;
db.setClock(() => now);                                                // lumipet + the sweep use it
let next = 1200;
const newPlayer = () => { const id = String(123456789012345000n + BigInt(next++)); setBalance(eco, id, 1000); return id; };
const adopt = (uid) => db.tx(() => lumipet.state(uid));                // met Lumi on the website
const setPet = (uid, fields) => db.tx(() => { const p = save.peek(uid); Object.assign(p, fields); save.save(uid, p); });
const events = (uid) => eco.getEconomyDb().prepare("SELECT kind, sent_at FROM lumi_remind_events WHERE user_id = ? ORDER BY created_at").all(uid);

/** A fake DM sender: records every DM, answers with `result` (or a function of uid). */
function sender(result = "sent") {
  const got = [];
  const send = async (uid, message) => { got.push({ uid, message }); return typeof result === "function" ? result(uid) : result; };
  return { got, send };
}
const sweep = (s) => reminders.sweepOnce({ now, send: s.send });       // one sweep at the fake time
const hungryPlayer = () => { const uid = newPlayer(); adopt(uid); prefs.setRemind(uid, true); later(HOUR); setPet(uid, { hunger: 10 }); return uid; }; // opted in, then got hungry
function later(ms) { now += ms; }

// ------------------------------------------------------------------------------------------------ prefs

test("prefs start off, store their choices, and refuse unknown timezones", () => {
  const uid = newPlayer();
  assert.deepEqual(prefs.get(uid), { remind: false, tz: null, newsHidden: false, dmFailedAt: null });
  prefs.setRemind(uid, true);
  prefs.setTz(uid, "Europe/London");
  prefs.setNewsHidden(uid, true);
  assert.deepEqual(prefs.get(uid), { remind: true, tz: "Europe/London", newsHidden: true, dmFailedAt: null });
  assert.throws(() => prefs.setTz(uid, "Mars/Olympus"), /Unknown timezone/);
  prefs.markDmFailed(uid);
  assert.equal(prefs.get(uid).remind, false);                          // closed DMs switch it off
  assert.equal(prefs.get(uid).dmFailedAt, now);
  prefs.setRemind(uid, true);
  assert.equal(prefs.get(uid).dmFailedAt, null);                       // turning on again forgets it
  assert.ok(prefs.hiddenSet([uid, "1"]).has(uid));
});

test("quiet hours follow the player's own clock (Los Angeles by default)", () => {
  assert.equal(reminders.isQuiet(null, NOON_LA), false);              // noon in LA
  assert.equal(reminders.isQuiet(null, NOON_LA + 11 * HOUR), true);   // 23:00 in LA
  assert.equal(reminders.isQuiet("Europe/London", NOON_LA), false);   // 20:00 in London: still evening
  assert.equal(reminders.isQuiet("Europe/London", NOON_LA + 3 * HOUR), true); // 23:00 in London
  assert.equal(reminders.isQuiet("Asia/Tokyo", NOON_LA), true);       // 05:00 the next morning in Tokyo
  assert.equal(reminders.localTime("Europe/London", NOON_LA), "20:00");
});

// ------------------------------------------------------------------------------------------------ the sweep

test("a hungry Lumi sends ONE DM naming the most urgent need, then nothing again within 3 hours", async () => {
  const uid = hungryPlayer();
  const s = sender();
  await sweep(s);
  assert.equal(s.got.length, 1);
  assert.equal(s.got[0].uid, uid);
  assert.match(s.got[0].message.content, /tummy/u);                    // hunger's line
  assert.ok(s.got[0].message.embeds.length === 1);                     // her card
  const ids = s.got[0].message.components.flatMap((row) => row.toJSON().components.map((c) => c.custom_id || c.url));
  assert.ok(ids.includes(`lumipet:remind:${uid}:off`));                // Stop reminders
  assert.ok(ids.includes(`lumipet:feed:${uid}`));                      // she can be fed from the DM
  assert.ok(events(uid).every((e) => e.sent_at === now));
  later(HOUR);
  setPet(uid, { energy: 5 });                                          // a new need, but too soon
  await sweep(s);
  assert.equal(s.got.length, 1);
  later(3 * HOUR);
  await sweep(s);                                                      // 3 h after the first: the new need goes out
  assert.equal(s.got.length, 2);
  assert.match(s.got[1].message.content, /sleepy/u);
});

test("checking on her doesn't count as a visit, and a need she was fed for (or that they saw) is never sent", async () => {
  const fed = hungryPlayer();
  const s = sender();
  db.tx(() => lumipet.load(fed, now, { seen: false }));                // the episode starts (as the sweep would see it)
  const seenBefore = save.peek(fed).seen;
  setPet(fed, { hunger: 90 });                                         // fed on the website before the DM
  await sweep(s);
  assert.equal(s.got.length, 0);
  assert.equal(save.peek(fed).seen, seenBefore);                       // the sweep didn't mark a visit
  const looked = hungryPlayer();
  later(1000);
  db.tx(() => lumipet.state(looked));                                  // they opened the page: seen = now
  await sweep(s);
  assert.equal(s.got.filter((g) => g.uid === looked).length, 0);
});

test("no DMs at night on their clock; it waits for the morning", async () => {
  const uid = hungryPlayer();
  prefs.setTz(uid, "America/Los_Angeles");
  const s = sender();
  const saved = now;
  now = NOON_LA + 11 * HOUR + 30 * 60_000;                             // 23:30 LA
  setPet(uid, { hunger: 10 });
  await sweep(s);
  assert.equal(s.got.filter((g) => g.uid === uid).length, 0);
  assert.equal(events(uid).filter((e) => e.sent_at === null).length >= 1, true); // queued
  now += 8 * HOUR + 30 * 60_000;                                       // 08:00 LA
  await sweep(s);
  assert.equal(s.got.filter((g) => g.uid === uid).length, 1);
  now = Math.max(now, saved);
});

test("closed DMs switch reminders off; a Discord hiccup keeps it queued for next time", async () => {
  const blocked = hungryPlayer();
  const flaky = hungryPlayer();
  const s1 = sender((uid) => (uid === blocked ? "blocked" : "failed"));
  await sweep(s1);
  assert.equal(prefs.get(blocked).remind, false);
  assert.ok(prefs.get(blocked).dmFailedAt);
  assert.equal(prefs.get(flaky).remind, true);
  assert.ok(events(flaky).some((e) => e.sent_at === null));            // still waiting
  const s2 = sender();
  await sweep(s2);
  assert.deepEqual(s2.got.map((g) => g.uid).filter((u) => u === blocked || u === flaky), [flaky]); // only the flaky one, now
});

test("nobody is DM'd without opting in, nobody without a Lumi gets one made, and the admin pause stops everything", async () => {
  const quiet = newPlayer(); adopt(quiet); setPet(quiet, { hunger: 5 });  // hungry but never opted in
  const ghost = newPlayer(); prefs.setRemind(ghost, true);             // opted in, never met Lumi
  const paused = hungryPlayer();
  const s = sender();
  setSetting("lumi.discord.remindPaused", "true");
  await sweep(s);
  assert.equal(s.got.length, 0);                                       // paused
  setSetting("lumi.discord.remindPaused", null);
  await sweep(s);
  assert.ok(!s.got.some((g) => g.uid === quiet || g.uid === ghost));
  assert.equal(save.exists(ghost), false);
  assert.ok(s.got.some((g) => g.uid === paused));                      // unpaused: it goes out
});

// ------------------------------------------------------------------------------------------------ hello DM, buttons, commands

/** A fake bot whose users.fetch(uid).send() records DMs; `refuse` ids answer 50007. */
function fakeBot(refuse = new Set()) {
  const dms = [];
  const members = new Set();
  return {
    dms, members,
    users: { fetch: async (uid) => ({ send: async (m) => { if (refuse.has(uid)) throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 }); dms.push({ uid, m }); } }) },
    guilds: { cache: new Map([[member.clubGuildId(), { members: { fetch: async ({ user }) => { if (members.has(user)) return {}; throw Object.assign(new Error("Unknown Member"), { code: 10007 }); } } }]]), fetch: async () => { throw new Error("no"); } },
    channels: { fetch: async () => null },
  };
}

test("turning reminders on sends a hello DM; closed DMs leave it off and say how to fix it", async () => {
  const bot = fakeBot(new Set(["555555555555555555"]));
  const ok = newPlayer();
  const r1 = await reminders.enable(bot, ok);
  assert.equal(r1.ok, true);
  assert.equal(prefs.get(ok).remind, true);
  assert.match(bot.dms[0].m.content, /once every 3 hours/u);
  const r2 = await reminders.enable(bot, "555555555555555555");
  assert.equal(r2.ok, false);
  assert.match(r2.text, /Privacy Settings/u);
  assert.equal(prefs.get("555555555555555555").remind, false);
});

/** A fake interaction through the real router. */
function fake(uid, bot, { kind = "command", sub, strings = {}, customId, focused, focusedName } = {}) {
  const out = { replies: [], updates: [], edits: [], responded: null, deferred: false };
  const i = {
    id: String(BigInt(now - 1_420_070_400_000) << 22n), client: bot, user: { id: uid, username: "tester", avatar: "" },
    commandName: kind === "command" || kind === "autocomplete" ? "lumi-pet" : undefined, customId, replied: false, deferred: false,
    isChatInputCommand: () => kind === "command", isAutocomplete: () => kind === "autocomplete",
    options: { getSubcommand: () => sub, getString: (name) => strings[name], getFocused: (full) => (full ? { name: focusedName, value: focused || "" } : focused || "") },
    reply: async (p) => { out.replies.push(p); i.replied = true; },
    deferReply: async () => { out.deferred = true; i.deferred = true; },
    editReply: async (p) => { out.edits.push(p); },
    update: async (p) => { out.updates.push(p); },
    followUp: async (p) => { out.replies.push(p); },
    respond: async (list) => { out.responded = list; },
  };
  return { i, out };
}

test("/lumi-pet reminders, timezone (with suggestions) and news, and the 🔕 Stop button", async () => {
  const bot = fakeBot();
  discord.initLumiDiscord({});                                         // started (a stand-in: no timers)
  const uid = newPlayer(); bot.members.add(uid);
  const on = fake(uid, bot, { sub: "reminders", strings: { turn: "on" } });
  await discord.handleLumiInteraction(on.i);
  assert.equal(on.out.deferred, true);
  assert.match(on.out.edits[0].content, /Reminders are on/u);
  assert.equal(prefs.get(uid).remind, true);

  const tz = fake(uid, bot, { sub: "timezone", strings: { zone: "Europe/London" } });
  await discord.handleLumiInteraction(tz.i);
  assert.match(tz.out.replies[0].content, /Europe\/London/u);
  assert.equal(prefs.get(uid).tz, "Europe/London");
  const badTz = fake(uid, bot, { sub: "timezone", strings: { zone: "Narnia" } });
  await discord.handleLumiInteraction(badTz.i);
  assert.match(badTz.out.replies[0].content, /don't know the timezone/u);
  const suggest = fake(uid, bot, { kind: "autocomplete", focused: "lond", focusedName: "zone" });
  await discord.handleLumiInteraction(suggest.i);
  assert.ok(suggest.out.responded.some((c) => c.value === "Europe/London"));

  const hide = fake(uid, bot, { sub: "news", strings: { name: "hide" } });
  await discord.handleLumiInteraction(hide.i);
  assert.equal(prefs.get(uid).newsHidden, true);

  const notMine = fake("777777777777777777", bot, { kind: "button", customId: `lumipet:remind:${uid}:off` });
  await discord.handleLumiInteraction(notMine.i);
  assert.match(notMine.out.replies[0].content, /not your Lumi/u);
  assert.equal(prefs.get(uid).remind, true);
  const stop = fake(uid, bot, { kind: "button", customId: `lumipet:remind:${uid}:off` });
  await discord.handleLumiInteraction(stop.i);
  assert.match(stop.out.updates[0].content, /no more reminder DMs/u);
  assert.equal(prefs.get(uid).remind, false);
  discord.stopLumiDiscord();
});

// ------------------------------------------------------------------------------------------------ the website switch

test("Lumi Pet's settings: state shows the Discord switch, and turning it on sends the hello DM with the browser's timezone", async () => {
  const bot = fakeBot();
  discord.initLumiDiscord(bot);                                        // a "real" bot: the website can reach Discord
  const server = await serve(lumi);
  try {
    const uid = newPlayer(); adopt(uid);
    const web = client(server.port, uid, "Tester");
    const state = await web.get("lumi-pet/state");
    assert.deepEqual(state.json.discord, { on: true, remind: false, tz: null });
    const on = await web.post("lumi-pet/discord", { remind: true, tz: "Asia/Tokyo" });
    assert.equal(on.status, 200);
    assert.equal(on.json.discord.remind, true);
    assert.equal(on.json.discord.tz, "Asia/Tokyo");
    assert.match(on.json.said, /hello DM/u);
    assert.equal(bot.dms.filter((d) => d.uid === uid).length, 1);
    const off = await web.post("lumi-pet/discord", { remind: false });
    assert.equal(off.json.discord.remind, false);
    const junk = await web.post("lumi-pet/discord", { remind: true, extra: 1 });
    assert.equal(junk.status, 422);
  } finally {
    server.close();
    discord.stopLumiDiscord();
  }
});
