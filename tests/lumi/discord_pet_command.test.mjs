// Lumi-Town on Discord, phase D1 (docs/plans/lumi-town-discord.md §4): the /lumi-pet card and its buttons.
//   src/lumi/discord/card.js     the pure card builder (bars, mood, buttons, menus, the buy question)
//   src/lumi/discord/command.js  /lumi-pet status|show|feed, care buttons, feed/play menus, buy-and-feed
// Interactions are fakes shaped like discord.js ones; the pet, the coins and the lock are the real thing.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
process.env.LUMI_PUBLIC_URL = "https://lumi.example/lumipet";          // absolute links for the card
const { eco, db } = boot();                                            // one in-memory DB for this file
const discord = require("../../src/lumi/discord/index.js");            // the router (registers /lumi-pet)
const card = require("../../src/lumi/discord/card.js");                // the pure card
const command = require("../../src/lumi/discord/command.js");          // /lumi-pet
const member = require("../../src/lumi/discord/member.js");            // club check
const locks = require("../../src/lumi/locks.js");                      // the shared lock
const lumipet = require("../../src/lumi/pet/lumipet.js");              // the pet
const save = require("../../src/lumi/pet/save.js");                    // her save
const tuning = require("../../src/lumi/tuning.js");                    // prices
const { MessageFlags } = require("discord.js");

let now = 1_800_000_000_000;                                           // the fake clock (ms)
db.setClock(() => now);                                                // lumipet + offers use it
const later = (ms) => { now += ms; };                                  // move time on

let next = 900;                                                        // fresh player ids
const newPlayer = (coins = 1000) => { const id = String(123456789012345000n + BigInt(next++)); setBalance(eco, id, coins); return id; }; // a Discord-shaped id
const adopt = (uid) => db.tx(() => lumipet.state(uid));                // they met Lumi on the website
const pet = (uid) => save.peek(uid);                                   // her save, read-only
const setPet = (uid, fields) => db.tx(() => { const p = save.peek(uid); Object.assign(p, fields); save.save(uid, p); }); // put her in a known state
const COOKIE = tuning.scalePrice("pet", "cookie", save.ITEMS.cookie.price); // what a cookie costs
const strangerId = "999999999999999999";                               // not in the club

// ------------------------------------------------------------------------------------------------ fakes

const members = new Set();                                             // who is in the club guild
const fakeClient = {
  guilds: {
    cache: new Map([[member.clubGuildId(), {
      members: { fetch: async ({ user }) => { if (members.has(user)) return { id: user }; throw Object.assign(new Error("Unknown Member"), { code: 10007 }); } },
    }]]),
    fetch: async () => { throw new Error("not used"); },
  },
};

let seq = 0n;                                                          // keeps snowflakes unique
/** A Discord id made "now" on the fake clock (the top bits are the time, like Discord's). */
const snowflake = () => String(((BigInt(now) - 1_420_070_400_000n) << 22n) + (seq++ % 4096n));

/** A fake interaction. kind: 'command' | 'autocomplete' | 'button' | 'select'. */
function fake(kind, uid, { sub, item, focused, focusedName = "item", customId, values, id } = {}) {
  const out = { replies: [], updates: [], responded: null };
  const i = {
    id: id || snowflake(), kind, client: fakeClient, commandName: kind === "command" || kind === "autocomplete" ? "lumi-pet" : undefined,
    customId, values, replied: false, deferred: false,
    user: { id: uid, username: `player${uid.slice(-3)}`, avatar: "" },
    isChatInputCommand: () => kind === "command",
    isAutocomplete: () => kind === "autocomplete",
    options: { getSubcommand: () => sub, getString: () => item, getFocused: (full) => (full ? { name: focusedName, value: focused || "" } : focused || "") }, // discord.js: getFocused(true) -> { name, value }
    reply: async (p) => { out.replies.push(p); i.replied = true; },
    update: async (p) => { out.updates.push(p); },
    followUp: async (p) => { out.replies.push(p); },
    respond: async (list) => { out.responded = list; },
  };
  return { i, out };
}

const run = async (f) => { const handled = await discord.handleLumiInteraction(f.i); assert.equal(handled, true); return f.out; }; // send it through the real router
const slash = (uid, sub, item) => run(fake("command", uid, { sub, item }));
const press = (uid, customId, extra = {}) => run(fake("button", uid, { customId, ...extra }));
const pick = (uid, customId, value) => run(fake("select", uid, { customId, values: [value] }));
const embedOf = (msg) => msg.embeds[0].toJSON();                       // the card's embed as plain JSON
const idsOf = (msg) => msg.components.flatMap((row) => row.toJSON().components.map((c) => c.custom_id || c.url)); // every button/menu
const notice = (msg) => embedOf(msg).description;                      // mood + what happened

before(() => { discord.initLumiDiscord(fakeClient); });                // started, like the bot does

// ------------------------------------------------------------------------------------------------ card.js (pure)

test("meters are 10-segment bars with the value, and a ⚠️ under LOW", () => {
  assert.equal(card.meterLine("🍓", "Hunger", 62), "🍓 Hunger ▰▰▰▰▰▰▱▱▱▱ **62**");
  assert.equal(card.meterLine("⚡", "Energy", 100), "⚡ Energy ▰▰▰▰▰▰▰▰▰▰ **100**");
  assert.match(card.meterLine("💖", "Joy", lumipet.LOW - 1), /⚠️$/u);
  assert.doesNotMatch(card.meterLine("💖", "Joy", lumipet.LOW), /⚠️/u);
  assert.equal(card.meterLine("💖", "Joy", -5), "💖 Joy ▱▱▱▱▱▱▱▱▱▱ **0** ⚠️"); // clamped to 0 (and 0 is low)
});

test("her mood names the most urgent low need, or says she's napping, playing or happy", () => {
  const base = { name: "Mochi", hunger: 80, energy: 80, joy: 80, task: null };
  assert.match(card.moodLine(base, now), /Mochi is glowing/u);
  assert.match(card.moodLine({ ...base, hunger: 10, joy: 20 }, now), /tummy/u);  // hunger is lowest
  assert.match(card.moodLine({ ...base, energy: 5, hunger: 20 }, now), /eyes open/u);
  assert.match(card.moodLine({ ...base, task: { kind: "nap" } }, now), /napping/u);
  assert.match(card.moodLine({ ...base, joy: 50 }, now), /doing okay/u);
  assert.match(card.moodLine({ ...base, name: "*bold*" }, now), /\\\*bold\\\*/u); // markdown escaped
});

test("the feed menu lists pantry food, then free food, then food to buy at the tuned price", () => {
  const snap = { pet: { inventory: { cookie: 2 } }, catalog: lumipet.CATALOG };
  const price = (id, native) => tuning.scalePrice("pet", id, native);
  const choices = card.feedChoices(snap, price);
  assert.equal(choices[0].id, "cookie");                               // held first
  assert.equal(choices[0].buy, false);
  assert.match(choices[0].description, /2 in the pantry/u);
  assert.ok(choices.some((c) => c.id === "apple" && !c.buy && /Free/u.test(c.description))); // free food
  const banana = choices.find((c) => c.id === "banana");
  assert.equal(banana.buy, true);
  assert.match(banana.description, new RegExp(`${price("banana", save.ITEMS.banana.price)} SGC`, "u"));
  assert.ok(choices.length <= card.MENU_MAX);
  assert.equal(new Set(choices.map((c) => c.id)).size, choices.length); // no food listed twice
});

test("a shared card has no buttons; a private one has care, feed and play; napping swaps Nap for Wake", () => {
  const uid = newPlayer(); adopt(uid);
  const snap = db.tx(() => lumipet.state(uid));
  const view = { snap, owner: { id: uid, name: "Tester" }, flat: "Lumi Heights 1A", visitWaiting: true, share: false, notice: null,
    links: { page: "https://lumi.example/lumipet/lumi-pet", thumb: "https://lumi.example/lumipet/static/icons/lumi-192.png" },
    priceOf: (id, n) => tuning.scalePrice("pet", id, n) };
  assert.deepEqual(card.buildPetCard({ ...view, share: true }).components, []);
  const ids = idsOf(card.buildPetCard(view));
  assert.ok(ids.includes(`lumipet:care:${uid}:cuddle`) && ids.includes(`lumipet:care:${uid}:nap`));
  assert.ok(ids.includes(`lumipet:feed:${uid}`) && ids.includes(`lumipet:play:${uid}`) && ids.includes(`lumipet:refresh:${uid}`));
  assert.ok(ids.includes("https://lumi.example/lumipet/lumi-pet"));    // Visit Lumi link
  const embed = embedOf(card.buildPetCard(view));
  assert.match(embed.footer.text, /Lumi Heights 1A/u);
  assert.match(embed.footer.text, /daily visit waiting/u);
  assert.equal(embed.thumbnail.url, view.links.thumb);
  const napping = { ...view, snap: { ...snap, pet: { ...snap.pet, task: { kind: "nap", finishesAt: now + 60_000 } } } };
  const napIds = idsOf(card.buildPetCard(napping));
  assert.ok(napIds.includes(`lumipet:care:${uid}:wake`) && !napIds.includes(`lumipet:care:${uid}:nap`));
  assert.ok(!napIds.includes(`lumipet:play:${uid}`));                  // no play menu while she's busy
  assert.match(embedOf(card.buildPetCard(napping)).fields[1].value, /Napping, wakes <t:\d+:R>/u);
});

test("the longest ids still fit Discord's 100-character customId limit", () => {
  const longest = Object.keys(save.ITEMS).sort((a, b) => b.length - a.length)[0]; // the longest item id
  const id = "1".repeat(20);                                           // the longest snowflake
  const view = { snap: db.tx(() => lumipet.state((() => { const u = newPlayer(); adopt(u); return u; })())), owner: { id, name: "x" }, links: {}, priceOf: () => 1 };
  const msg = card.buildConfirm(view, { itemId: longest, price: 5, offerId: id });
  assert.ok(idsOf(msg).every((x) => x.length <= 100));
});

// ------------------------------------------------------------------------------------------------ who may use it

test("someone outside the club is turned away, and no Lumi is made for them", async () => {
  const out = await slash(strangerId, "status");
  assert.match(out.replies[0].content, /members of the club/u);
  assert.equal(out.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(save.exists(strangerId), false);
});

test("a member who hasn't met Lumi is sent to the website, and no Lumi is made for them", async () => {
  const uid = newPlayer(); members.add(uid);
  const out = await slash(uid, "status");
  assert.match(out.replies[0].content, /haven't met Lumi yet/u);
  assert.match(out.replies[0].content, /https:\/\/lumi\.example\/lumipet\/lumi-pet/u);
  assert.equal(save.exists(uid), false);
});

test("pressing someone else's button gets 'not your Lumi' and changes nothing", async () => {
  const owner = newPlayer(); members.add(owner); adopt(owner);
  const other = newPlayer(); members.add(other); adopt(other);
  const joy = pet(owner).joy;
  const out = await press(other, `lumipet:care:${owner}:cuddle`);
  assert.match(out.replies[0].content, /not your Lumi/u);
  assert.equal(out.updates.length, 0);
  assert.equal(pet(owner).joy, joy);
});

// ------------------------------------------------------------------------------------------------ status / show

test("status is a private card with buttons; it counts as a visit but never claims the website's reward", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  later(60_000);
  const out = await slash(uid, "status");
  const msg = out.replies[0];
  assert.equal(msg.flags, MessageFlags.Ephemeral);
  assert.ok(msg.components.length >= 2);
  assert.match(embedOf(msg).author.name, /player\d{3}'s Lumi/u);
  assert.equal(pet(uid).seen, now);                                    // a visit for reminders
  assert.equal(eco.getBalance(uid), 1000);                             // no visit reward paid
  assert.match(embedOf(msg).footer.text, /daily visit waiting/u);
});

test("show posts her card for everyone, with no buttons", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  const out = await slash(uid, "show");
  assert.equal(out.replies[0].flags, undefined);                       // public
  assert.deepEqual(out.replies[0].components, []);
});

// ------------------------------------------------------------------------------------------------ care

test("cuddle works, a retried interaction runs once, and a second cuddle too soon gets her words", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  setPet(uid, { joy: 50 });
  const first = fake("button", uid, { customId: `lumipet:care:${uid}:cuddle` });
  await run(first);
  assert.equal(pet(uid).joy, 50 + lumipet.CUDDLE_JOY);
  assert.match(notice(first.out.updates[0]), /✅ You cuddled/u);
  const retry = fake("button", uid, { customId: `lumipet:care:${uid}:cuddle`, id: first.i.id }); // Discord re-sent it
  await run(retry);
  assert.match(notice(retry.out.updates[0]), /already done/u);
  assert.equal(pet(uid).joy, 50 + lumipet.CUDDLE_JOY);                 // still once
  const again = await press(uid, `lumipet:care:${uid}:cuddle`);         // a new press, inside the cooldown
  assert.match(notice(again.updates[0]), /⚠️ Lumi is still enjoying that/u);
});

test("nap and wake swap her state, and play starts a timed game with a toy she can use", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  const nap = await press(uid, `lumipet:care:${uid}:nap`);
  assert.equal(pet(uid).task.kind, "nap");
  assert.ok(idsOf(nap.updates[0]).includes(`lumipet:care:${uid}:wake`));
  await press(uid, `lumipet:care:${uid}:wake`);
  assert.equal(pet(uid).task, null);
  const play = await pick(uid, `lumipet:play:${uid}`, "star-ribbon");  // the free toy
  assert.equal(pet(uid).task.kind, "play");
  assert.match(notice(play.updates[0]), /playing with the/u);
  assert.ok(!idsOf(play.updates[0]).includes(`lumipet:play:${uid}`));   // busy: no play menu
  const notMine = await pick(uid, `lumipet:play:${uid}`, "bouncy-moon"); // a toy she doesn't own
  assert.match(notice(notMine.updates[0]), /⚠️/u);
});

test("a made-up care verb is refused politely", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  const out = await press(uid, `lumipet:care:${uid}:steal`);
  assert.match(out.replies[0].content, /doesn’t know/u);
});

// ------------------------------------------------------------------------------------------------ feeding

test("free food and food from the pantry are fed straight away, with no charge", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  setPet(uid, { hunger: 20, inventory: { cookie: 1 } });
  const apple = await pick(uid, `lumipet:feed:${uid}`, "apple");
  assert.match(notice(apple.updates[0]), /ate the 🍎 Apple/u);
  assert.ok(pet(uid).hunger > 20);
  later(lumipet.COOLDOWN + 1);
  await pick(uid, `lumipet:feed:${uid}`, "cookie");                     // the one in the pantry
  assert.equal(pet(uid).inventory.cookie, undefined);                   // eaten
  assert.equal(eco.getBalance(uid), 1000);                             // nothing bought
});

test("food she doesn't have asks first; ✅ buys and feeds in one go, and only once per question", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  setPet(uid, { hunger: 20 });
  const ask = fake("select", uid, { customId: `lumipet:feed:${uid}`, values: ["cookie"] });
  await run(ask);
  assert.equal(eco.getBalance(uid), 1000);                             // asking costs nothing
  assert.match(embedOf(ask.out.updates[0]).description, new RegExp(`Buy 1 .*Cookie for \\*\\*${COOKIE} SGC`, "u"));
  const yes = idsOf(ask.out.updates[0]).find((x) => x.startsWith("lumipet:bf:"));
  assert.equal(yes, `lumipet:bf:${uid}:cookie:${ask.i.id}`);           // the offer is the question's own id
  const done = await press(uid, yes);
  assert.equal(eco.getBalance(uid), 1000 - COOKIE);                    // bought once
  assert.equal(pet(uid).inventory.cookie, undefined);                   // and eaten
  assert.ok(pet(uid).hunger > 20);
  assert.match(notice(done.updates[0]), new RegExp(`bought a 🍪 Cookie for ${COOKIE} SGC`, "u"));
  later(lumipet.COOLDOWN + 1);                                          // even after the cooldown...
  const twice = await press(uid, yes);                                  // ...a second click on the same question
  assert.match(notice(twice.updates[0]), /already done/u);
  assert.equal(eco.getBalance(uid), 1000 - COOKIE);                    // still charged once
});

test("✅ after the minute is up buys nothing", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  const ask = fake("select", uid, { customId: `lumipet:feed:${uid}`, values: ["cookie"] });
  await run(ask);
  later(command.OFFER_MS + 1);
  const late = await press(uid, `lumipet:bf:${uid}:cookie:${ask.i.id}`);
  assert.match(notice(late.updates[0]), /offer ran out/u);
  assert.equal(eco.getBalance(uid), 1000);
});

test("if she won't eat yet, buy-and-feed charges nothing (both steps share one transaction)", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  await pick(uid, `lumipet:feed:${uid}`, "apple");                      // she just ate: feed cooldown starts
  const ask = fake("select", uid, { customId: `lumipet:feed:${uid}`, values: ["cookie"] });
  await run(ask);
  const out = await press(uid, `lumipet:bf:${uid}:cookie:${ask.i.id}`);
  assert.match(notice(out.updates[0]), /still enjoying/u);
  assert.equal(eco.getBalance(uid), 1000);                             // not charged
  assert.equal((pet(uid).inventory || {}).cookie, undefined);           // and nothing landed in the pantry
});

test("not enough SGC is said up front, without a question", async () => {
  const uid = newPlayer(COOKIE - 1); members.add(uid); adopt(uid);
  const out = await pick(uid, `lumipet:feed:${uid}`, "cookie");
  assert.match(notice(out.updates[0]), new RegExp(`costs ${COOKIE} SGC, but you have ${COOKIE - 1}`, "u"));
  assert.ok(!idsOf(out.updates[0]).some((x) => x.startsWith("lumipet:bf:")));
});

test("while the website is mid-purchase, Discord care waits its turn (409 busy on the card)", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  locks.take(uid);                                                     // the website holds the lock
  const out = await press(uid, `lumipet:care:${uid}:cuddle`);
  locks.release(uid);
  assert.match(notice(out.updates[0]), /One thing at a time/u);
  assert.equal(locks.isBusy(uid), false);
});

test("/lumi-pet feed works like the menu, and its suggestions follow what you type", async () => {
  const uid = newPlayer(); members.add(uid); adopt(uid);
  const ac = fake("autocomplete", uid, { focused: "app" });
  await run(ac);
  assert.deepEqual(ac.out.responded.map((c) => c.value), ["apple"]);
  const all = fake("autocomplete", uid, { focused: "" });
  await run(all);
  assert.ok(all.out.responded.length > 5 && all.out.responded.every((c) => c.name.length <= 100));
  const nobody = fake("autocomplete", "888888888888888888", { focused: "" }); // no Lumi: no suggestions, nothing created
  await run(nobody);
  assert.deepEqual(nobody.out.responded, []);
  assert.equal(save.exists("888888888888888888"), false);
  setPet(uid, { hunger: 20 });
  const fed = await slash(uid, "feed", "apple");
  assert.equal(fed.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(notice(fed.replies[0]), /ate the 🍎 Apple/u);
});

test("the snowflake clock reads Discord's ids correctly", () => {
  assert.equal(command.snowflakeTime("175928847299117063"), 1462015105796); // Discord's own docs example
});
