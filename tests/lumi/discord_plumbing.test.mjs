// Lumi-Town on Discord, phase D0 (docs/plans/lumi-town-discord.md): the plumbing every Discord piece stands on.
//   src/lumi/locks.js          the per-player money lock, now shared by the website router and Discord
//   src/lumi/pet/actions.js    runPetAction: the one care/purchase entry (website route + Discord), with run-once refs
//   src/lumi/discord/member.js the cached "is this person in the club guild?" check
//   src/lumi/discord/index.js  the interaction router (only answers what is Lumi's) and the on/off switch
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance } from "./lumi_env.mjs";
import { serve, client } from "./pet_http.mjs";

const require = createRequire(import.meta.url);
const { eco, lumi, errors } = boot();                                  // one in-memory DB for this file
const locks = require("../../src/lumi/locks.js");                      // the shared lock
const actions = require("../../src/lumi/pet/actions.js");             // runPetAction
const member = require("../../src/lumi/discord/member.js");           // club check
const discord = require("../../src/lumi/discord/index.js");           // interaction router
const lumipet = require("../../src/lumi/pet/lumipet.js");             // for prices
const db = require("../../src/lumi/db.js");                           // tx

let next = 500;                                                        // fresh player ids
const newPlayer = (coins = 1000) => { const id = String(123456789012345000n + BigInt(next++)); setBalance(eco, id, coins); return id; }; // a Discord-shaped id with SGC
const COOKIE = lumipet._ITEMS.cookie.price;                            // 8 SGC (items keep erinne's prices)
const isLumiErr = (code) => (e) => e instanceof errors.LumiError && e.code === code; // a LumiError with this code

const server = await serve(lumi);                                      // the real website routes
after(() => server.close());                                           // tidy up

// ------------------------------------------------------------------------------------------------ locks.js

test("the lock is taken once, refused while held, and always released by withUserLock", async () => {
  const uid = newPlayer();
  assert.equal(locks.take(uid), true);                                 // first: ours
  assert.equal(locks.take(uid), false);                                // second: busy
  assert.equal(locks.isBusy(uid), true);
  locks.release(uid);
  assert.equal(locks.isBusy(uid), false);
  await assert.rejects(locks.withUserLock(uid, async () => { throw new Error("boom"); }), /boom/); // fn's error passes through
  assert.equal(locks.isBusy(uid), false);                              // ...and the lock is free again
  locks.take(uid);
  await assert.rejects(locks.withUserLock(uid, () => 1), isLumiErr("busy")); // held: 409 busy
  locks.release(uid);
  assert.equal(await locks.withUserLock(uid, () => 7), 7);             // free: runs and returns
});

test("a lock held by Discord makes the website's money route answer 409 busy (one lock for both)", async () => {
  const uid = newPlayer();
  const web = client(server.port, uid, "Tester");                      // logged in on the website
  locks.take(uid);                                                     // Discord is mid-purchase
  const blocked = await web.post("lumi-pet/act", { action: "buy", item: "cookie" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, "busy");
  assert.equal(blocked.json.error, locks.BUSY_MESSAGE);                // the same words as always
  locks.release(uid);                                                  // Discord finished
  const ok = await web.post("lumi-pet/act", { action: "buy", item: "cookie" });
  assert.equal(ok.status, 200);                                        // now it goes through
  assert.equal(eco.getBalance(uid), 1000 - COOKIE);
  assert.equal(locks.isBusy(uid), false);                              // the router let go
});

// ------------------------------------------------------------------------------------------------ pet/actions.js

test("runPetAction buys like the website does and returns the same shape (pet, coins, blocked names)", () => {
  const uid = newPlayer();
  const out = actions.runPetAction(uid, "Tester", { action: "buy", item: "cookie", count: 2 });
  assert.equal(out.coins, 1000 - 2 * COOKIE);                          // two charges
  assert.ok(out.pet && Array.isArray(out.blocked));                    // the website's JSON shape
  assert.equal(eco.getBalance(uid), 1000 - 2 * COOKIE);
});

test("runPetAction checks input like the website: unknown fields and actions are a 422", () => {
  const uid = newPlayer();
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "steal" }), isLumiErr("invalid"));            // not an action
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "cuddle", coins: 999 }), isLumiErr("invalid")); // extra field
});

test("Lumi refusing becomes a 400 with her words, and nothing is charged", () => {
  const uid = newPlayer();
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "feed", item: "cookie" }), (e) => e instanceof errors.LumiError && e.status === 400 && e.code === "refused"); // nothing in the pantry
  assert.equal(eco.getBalance(uid), 1000);
});

test("an onceRef runs once: a retried Discord interaction never buys twice", () => {
  const uid = newPlayer();
  const ref = `lumi-discord:${uid}-1`;                                 // like 'lumi-discord:<interaction id>'
  actions.runPetAction(uid, "Tester", { action: "buy", item: "cookie" }, { onceRef: ref });
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "buy", item: "cookie" }, { onceRef: ref }), isLumiErr("already_done"));
  assert.equal(eco.getBalance(uid), 1000 - COOKIE);                    // charged once only
});

test("a refused action does not use up its onceRef (the claim rolls back with it)", () => {
  const uid = newPlayer(3);                                            // too poor for a cookie
  const ref = `lumi-discord:${uid}-2`;
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "buy", item: "cookie" }, { onceRef: ref }), (e) => e instanceof errors.LumiError && e.status === 402);
  setBalance(eco, uid, 1000);                                          // they top up
  actions.runPetAction(uid, "Tester", { action: "buy", item: "cookie" }, { onceRef: ref }); // the same ref now works
  assert.equal(eco.getBalance(uid), 1000 - COOKIE);
});

test("runPetAction({ lock: true }) takes the shared lock, refuses while it's held, and frees it", () => {
  const uid = newPlayer();
  locks.take(uid);                                                     // the website is mid-purchase
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "buy", item: "cookie" }, { lock: true }), isLumiErr("busy"));
  assert.equal(eco.getBalance(uid), 1000);                             // nothing happened
  locks.release(uid);
  actions.runPetAction(uid, "Tester", { action: "buy", item: "cookie" }, { lock: true });
  assert.equal(locks.isBusy(uid), false);                              // released after
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "steal" }, { lock: true })); // a failure...
  assert.equal(locks.isBusy(uid), false);                              // ...releases too
});

test("bad onceRefs are a programming error, not a player's 409", () => {
  const uid = newPlayer();
  assert.throws(() => actions.runPetAction(uid, "Tester", { action: "cuddle" }, { onceRef: "has space" }), /bad onceRef/);
  assert.ok(db.tx(() => true));                                        // and the DB is fine afterwards
});

// ------------------------------------------------------------------------------------------------ discord/member.js

/** A fake discord.js client: members in `members`, `calls` counts member fetches, `fail` makes Discord error. */
function fakeClient({ members = [], guildCached = true, fail = null } = {}) {
  const state = { calls: 0, fail };
  const guild = {
    members: {
      fetch: async ({ user }) => {
        state.calls += 1;                                              // one API call
        if (state.fail) throw state.fail;                              // Discord trouble
        if (members.includes(user)) return { id: user };               // a member
        throw Object.assign(new Error("Unknown Member"), { code: 10007 }); // not in the guild
      },
    },
  };
  const guildId = member.clubGuildId();
  return {
    state,
    guilds: {
      cache: new Map(guildCached ? [[guildId, guild]] : []),           // cached guilds
      fetch: async (id) => { if (id === guildId) return guild; throw Object.assign(new Error("Unknown Guild"), { code: 10004 }); },
    },
  };
}

test("members pass, non-members don't, and both answers are cached for their own time", async () => {
  let now = 1_000_000;
  member.setClock(() => now);
  member.forget();
  const c = fakeClient({ members: ["111"] });
  assert.equal(await member.isClubMember(c, "111"), true);
  assert.equal(await member.isClubMember(c, "222"), false);
  assert.equal(c.state.calls, 2);
  assert.equal(await member.isClubMember(c, "111"), true);             // cached
  assert.equal(await member.isClubMember(c, "222"), false);            // cached
  assert.equal(c.state.calls, 2);
  now += member.NO_TTL_MS + 1;                                         // the "no" expires first
  await member.isClubMember(c, "222");
  await member.isClubMember(c, "111");
  assert.equal(c.state.calls, 3);                                      // only 222 was asked again
  now += member.YES_TTL_MS;                                            // now the "yes" expires too
  await member.isClubMember(c, "111");
  assert.equal(c.state.calls, 4);                                      // 111 asked again, once
  member.setClock(null);
});

test("two lookups at once share one request; Discord errors are thrown and not cached", async () => {
  member.forget();
  const c = fakeClient({ members: ["333"] });
  const [a, b] = await Promise.all([member.isClubMember(c, "333"), member.isClubMember(c, "333")]);
  assert.deepEqual([a, b, c.state.calls], [true, true, 1]);            // one fetch for both
  const flaky = fakeClient({ members: ["444"], fail: Object.assign(new Error("Discord is down"), { code: 0 }) });
  await assert.rejects(member.isClubMember(flaky, "444"), /Discord is down/);
  flaky.state.fail = null;                                             // Discord is back
  assert.equal(await member.isClubMember(flaky, "444"), true);         // asked again: nothing wrong was cached
});

test("an uncached club guild is fetched; a bot that isn't in it lets nobody in", async () => {
  member.forget();
  const c = fakeClient({ members: ["555"], guildCached: false });
  assert.equal(await member.isClubMember(c, "555"), true);             // fetched the guild, then the member
  const lost = { guilds: { cache: new Map(), fetch: async () => { throw Object.assign(new Error("Unknown Guild"), { code: 10004 }); } } };
  member.forget();
  assert.equal(await member.isClubMember(lost, "555"), false);
});

// ------------------------------------------------------------------------------------------------ discord/index.js

/** A fake interaction: a slash command (name) or a component (customId). */
function fakeInteraction({ commandName, customId, autocomplete = false } = {}) {
  const said = [];
  return {
    said, commandName, customId, replied: false, deferred: false,
    isChatInputCommand: () => Boolean(commandName) && !autocomplete,
    isAutocomplete: () => Boolean(commandName) && autocomplete,
    reply: async (p) => { said.push(p); },
    followUp: async (p) => { said.push(p); },
  };
}

test("customIds round-trip, and anything without the lumipet: prefix is not ours", () => {
  const id = discord.customId("feed", "123", "cookie");
  assert.equal(id, "lumipet:feed:123:cookie");
  assert.deepEqual(discord.parseCustomId(id), { verb: "feed", args: ["123", "cookie"] });
  assert.equal(discord.parseCustomId("stock:buy:1"), null);
  assert.equal(discord.parseCustomId("lumipet:"), null);
  assert.throws(() => discord.customId("x", "y".repeat(100)), /too long/);  // Discord's 100-char limit
});

test("the router answers only registered commands and verbs, sends each to its piece, and stays polite on a crash", async () => {
  const seen = [];
  discord.registerHandler({
    command: { name: "lumi-test", data: { name: "lumi-test", description: "test" } },
    verbs: ["poke", "boom"],
    onCommand: async (i) => { seen.push(["command", i.commandName]); },
    onAutocomplete: async (i) => { seen.push(["auto", i.commandName]); },
    onComponent: async (i, args) => { if (i.customId.includes("boom")) throw new Error("kaboom"); seen.push(["component", args]); },
  });
  assert.throws(() => discord.registerHandler({ verbs: ["poke"] }), /twice/);  // two pieces can't claim one verb

  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ commandName: "lumi-test" })), false); // not started yet: ignored
  discord.initLumiDiscord({});                                         // start with a stand-in client
  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ commandName: "lumi-test" })), true);
  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ commandName: "lumi-test", autocomplete: true })), true);
  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ customId: "lumipet:poke:1:2" })), true);
  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ commandName: "lumi-quote" })), false);    // someone else's command
  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ customId: "lumipet:unknown:1" })), false); // unregistered verb
  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ customId: "stock:buy" })), false);        // not ours at all
  assert.deepEqual(seen, [["command", "lumi-test"], ["auto", "lumi-test"], ["component", ["1", "2"]]]);

  const crash = fakeInteraction({ customId: "lumipet:boom:1" });
  assert.equal(await discord.handleLumiInteraction(crash), true);     // handled...
  assert.equal(crash.said.length, 1);                                  // ...with one polite reply
  assert.equal(crash.said[0].flags, require("discord.js").MessageFlags.Ephemeral); // only they see it
  assert.match(crash.said[0].content, /went wrong/);

  assert.deepEqual(discord.commandDefinitions().map((d) => d.name).sort(), ["lumi-pet", "lumi-test"]); // both go into the global list
  discord.stopLumiDiscord();
  assert.equal(await discord.handleLumiInteraction(fakeInteraction({ commandName: "lumi-test" })), false); // stopped: ignored
});

test("LUMI_DISCORD_ENABLED=false switches the Discord side off: no commands, no start", () => {
  const before = process.env.LUMI_DISCORD_ENABLED;
  process.env.LUMI_DISCORD_ENABLED = "false";
  assert.equal(discord.isEnabled(), false);
  assert.deepEqual(discord.commandDefinitions(), []);
  assert.equal(discord.initLumiDiscord({}), false);
  process.env.LUMI_DISCORD_ENABLED = "off";
  assert.equal(discord.isEnabled(), false);
  if (before === undefined) delete process.env.LUMI_DISCORD_ENABLED; else process.env.LUMI_DISCORD_ENABLED = before;
  assert.equal(discord.isEnabled(), true);                             // default: on
});
