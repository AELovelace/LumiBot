// src/lumi/town/lumitown.js, src/lumi/pet/lumihouse.js and routes/town.js + routes/pet.js: erinne tests/test_lumitown.py
// and test_lumihouse.py at spec level. Presence, places and blocks, chat and its cleaning and limits, emotes, the live
// stream, knocking, passes, the guestbook, sending guests home, the house-warming gift and the daily visit (SGC).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";
import { serve, client, wait } from "./pet_http.mjs";

const require = createRequire(import.meta.url);
const { eco, lumi, db } = boot();                                      // in-memory economy + Lumi
const lumitown = require("../../src/lumi/town/lumitown.js");          // presence + chat
const lumihouse = require("../../src/lumi/pet/lumihouse.js");         // homes
const users = require("../../src/lumi/users.js");                     // names
const srv = await serve(lumi);                                          // a throwaway server
after(() => { lumi.stopLumiGames(); srv.close(); });                    // tidy up
let next = 0;                                                           // fresh players
async function player(name, coins = 1000) {                             // a logged-in player with a Lumi
  const id = String(222222222222222000n + BigInt(next++));              // Discord-shaped id
  setBalance(eco, id, coins);                                           // SGC account (known person)
  users.remember(id, name);                                             // their name
  const c = client(srv.port, id, name);                                 // HTTP as them
  assert.equal((await c.get("lumi-pet/state")).status, 200);            // a Lumi exists
  return c;
}

test("places, districts and blocks: a block either side is in view; chat stays in the same place", () => {
  assert.equal(lumitown.place("arcade", null, true), "in:arcade");
  assert.equal(lumitown.place("home", null, false), "city:down");
  assert.equal(lumitown.place("x", "l3", false), "city:l3");
  assert.deepEqual(["down", "l1", "l3", "r2", null].map(lumitown.block), [0, -1, -3, 2, 0]);
  assert.ok(lumitown.near("city:down", "city:l1") && lumitown.near("city:r1", "city:r2"));
  assert.ok(!lumitown.near("city:l1", "city:r1") && !lumitown.near("in:arcade", "city:down") && !lumitown.near(null, "city:down"));
});

test("typed words are cleaned and kept short; a line is a phrase or words", () => {
  assert.equal(lumitown.clean("  hi\n\tthere​  you\u0007 "), "hi there you");
  assert.throws(() => lumitown.clean(" \n "), /Say something/);
  assert.throws(() => lumitown.clean("x".repeat(141)), /140/);
  assert.equal(lumitown.clean("✨".repeat(140)).length > 0, true);       // 140 characters (not UTF-16 units)
  const line = lumitown.line("1", "Doll", "Lumi", "city:down", { phrase: "gg" });
  assert.equal(line.text, "Good game!");
  assert.throws(() => lumitown.line("1", "D", "L", "city:down", { phrase: "nope" }), /phrases/);
  assert.throws(() => lumitown.line("1", "D", "L", "city:down", {}), /Say something/);
});

test("the town remembers and forgets: moves, steps, lines, and those who stop asking", () => {
  let now = 0;                                                          // a fake clock (seconds)
  const town = new lumitown.Town(() => now);
  assert.equal(town.visit("1", "home", "down"), "moved");
  assert.equal(town.visit("1", "home", "down"), null);
  assert.equal(town.visit("1", "home", "down", false, 5, 6, 1), "walk");
  assert.equal(town.visit("1", "arcade", null, true), "moved");
  town.visit("2", "x", "l1", false, 1, 2, -1);
  assert.deepEqual(town.here("1").map((p) => p.id), ["2"]);
  assert.deepEqual(town.here("2", "city:down").map((p) => p.id), []);   // 1 is inside the arcade
  town.said({ place: "in:arcade", text: "a" });
  assert.equal(town.recent("in:arcade").length, 1);
  now = 601;
  assert.equal(town.recent("in:arcade").length, 0);                     // ten minutes: gone
  assert.equal(town.where("1"), null);                                  // 20 s silent: gone
});

test("houses: knocks, answers, passes, and sending guests home", () => {
  let now = 0;
  const h = new lumihouse.Houses(() => now);
  const k = h.knock("g", "h");
  assert.equal(h.knock("g", "h").id, k.id);                             // a second knock is the same one
  assert.deepEqual(h.waiting("h").map((x) => x.id), [k.id]);
  assert.equal(lumihouse.access("knock", [], "h", "g", h), "knock");
  h.answer(k.id, "h", true);
  assert.equal(lumihouse.access("knock", [], "h", "g", h), "in");        // a pass
  assert.equal(lumihouse.access("knock", ["g"], "h", "g", h), "closed"); // blocked looks closed
  assert.equal(lumihouse.access("open", [], "h", "x", h), "in");
  assert.equal(lumihouse.access("closed", [], "h", "x", h), "closed");
  assert.equal(lumihouse.access("closed", [], "h", "h", h), "own");
  assert.throws(() => h.answer("nope", "h", true), /knock has gone/);
  h.visit("g", "h", "kitchen", 1, 1, 1);
  h.visit("h", "h", "den", 1, 1, 1);
  assert.equal(h.where("g"), "house:h:kitchen");
  assert.ok(h.home("h"));
  assert.deepEqual(h.sendHome("h"), ["g"]);                             // door shut: guests go
  assert.equal(lumihouse.access("knock", [], "h", "g", h), "knock");    // and the pass went too
  now = lumihouse.PASS_SECONDS + 100;
  assert.equal(h.home("h"), false);                                     // gone quiet
  assert.equal(lumihouse.place("5", "den", "house"), "home:5:den");
});

test("each sees the other in town; Show me in town off hides her at once", async () => {
  const a = await player("Alice"), b = await player("Bob");
  await a.post("lumi-pet/town", { at: "home", district: "down" });
  const seen = (await b.post("lumi-pet/town", { at: "home", district: "l1", x: 10.04, y: 5 })).json;
  assert.equal(seen.seen, true);
  assert.equal(seen.you, b.id);
  assert.ok(seen.here.some((p) => p.id === a.id && p.name === "Alice" && p.look.name === "Lumi"));
  assert.equal(seen.phrases.length, Object.keys(lumitown.PHRASES).length);
  await a.post("lumi-pet/act", { action: "town_seen" });                // hide
  const hidden = (await a.post("lumi-pet/town", { at: "home" })).json;
  assert.equal(hidden.seen, false);
  assert.ok(!(await b.post("lumi-pet/town", { at: "home", district: "l1" })).json.here.some((p) => p.id === a.id));
  assert.equal((await a.post("lumi-pet/town/say", { phrase: "hi" })).status, 409); // can't speak while hidden
  assert.equal((await b.post("lumi-pet/town", { at: "Bad!" })).status, 422);       // only a place, district and point
  assert.equal((await b.post("lumi-pet/town", { at: "home", district: "x9" })).status, 422);
  assert.equal((await b.post("lumi-pet/town", { at: "home", extra: 1 })).status, 422);
});

test("a line is heard on the stream in the same place, not elsewhere; not too fast; emotes too", async () => {
  const a = await player("Ann"), b = await player("Ben"), c = await player("Cat");
  await a.post("lumi-pet/town", { at: "arcade", inside: true });
  await b.post("lumi-pet/town", { at: "arcade", inside: true });
  await c.post("lumi-pet/town", { at: "home", district: "down" });
  const bs = await b.stream("lumi-pet/town/stream"), cs = await c.stream("lumi-pet/town/stream");
  assert.equal(bs.status, 200);
  await wait(30);
  const said = await a.post("lumi-pet/town/say", { text: "hello  arcade" });
  assert.equal(said.status, 200);
  assert.equal(said.json.line.text, "hello arcade");
  assert.equal((await a.post("lumi-pet/town/emote", { emote: "wave" })).status, 200);
  await wait(60);
  assert.match(bs.text, /^: hello\n\n/);
  assert.match(bs.text, /event: said\ndata: .*hello arcade/);           // same place
  assert.match(bs.text, /event: emote\ndata: \{"uid":"\d+","emote":"wave"\}/);
  assert.doesNotMatch(cs.text, /hello arcade/);                          // elsewhere
  assert.equal((await a.post("lumi-pet/town/say", { phrase: "gg" })).status, 429); // one line per 1.5 s
  assert.equal((await a.post("lumi-pet/town/emote", { emote: "wave" })).status, 429);
  assert.equal((await a.post("lumi-pet/town/emote", { emote: "moonwalk" })).status, 422);
  const recent = (await b.post("lumi-pet/town", { at: "arcade", inside: true })).json.lines;
  assert.ok(recent.some((l) => l.text === "hello arcade"));
  bs.close(); cs.close();
});

test("a knock needs the host home and their answer; then the guest sees the flat and can sign the guestbook", async () => {
  const host = await player("Host"), guest = await player("Guest");
  const doorstep = (await guest.get(`lumi-pet/houses/${host.id}`)).json;
  assert.equal(doorstep.access, "knock");
  assert.ok(!("house" in doorstep) && doorstep.look);                    // only the doorstep
  assert.equal((await guest.post(`lumi-pet/houses/${host.id}/knock`)).status, 409); // nobody's in
  assert.equal((await host.post("lumi-pet/houses/here", { room: "den", x: 100, y: 100 })).status, 200); // the host is home
  const hs = await host.stream("lumi-pet/town/stream");
  await wait(30);
  const knock = (await guest.post(`lumi-pet/houses/${host.id}/knock`)).json;
  assert.equal(knock.in, false);
  await wait(30);
  assert.match(hs.text, /event: knock/);
  const waiting = (await host.post("lumi-pet/houses/here", { room: "den", x: 100, y: 100 })).json.knocks;
  assert.deepEqual(waiting.map((k) => [k.id, k.guest, k.name]), [[knock.knock, guest.id, "Guest"]]);
  assert.deepEqual((await guest.get(`lumi-pet/knocks/${knock.knock}`)).json, { answer: null, gone: false });
  assert.equal((await guest.post(`lumi-pet/knocks/${knock.knock}/answer`, { yes: true })).status, 404); // only the host answers
  assert.deepEqual((await host.post(`lumi-pet/knocks/${knock.knock}/answer`, { yes: true })).json, { answer: true });
  const inside = (await guest.get(`lumi-pet/houses/${host.id}`)).json;
  assert.equal(inside.access, "in");
  assert.ok(inside.house && "guestbook" in inside && !("coins" in inside) && !("pet" in inside)); // never her coins or save
  const signed = await guest.post(`lumi-pet/houses/${host.id}/guestbook`, { text: "Cosy!" });
  assert.equal(signed.status, 200);
  assert.deepEqual(Object.keys(signed.json.guestbook[0]).sort(), ["at", "id", "lumi", "name", "text"]);
  assert.equal((await guest.post(`lumi-pet/houses/${host.id}/guestbook`, { text: "Again" })).status, 429); // once in a while
  assert.equal((await host.post(`lumi-pet/houses/${host.id}/guestbook`, { text: "me" })).status, 409);    // her own
  const list = (await guest.get("lumi-pet/houses")).json;
  assert.ok(list.flats.some((f) => f.id === host.id && f.home === true && f.apt && f.apt.label));
  hs.close();
});

test("closing the door or blocking sends guests home; a blocked person only sees a closed door", async () => {
  const host = await player("H2"), guest = await player("G2");
  await host.post("lumi-pet/act", { action: "door", item: "open" });
  assert.equal((await guest.post("lumi-pet/houses/here", { host: host.id, room: "kitchen", x: 10, y: 10 })).status, 200);
  const gs = await guest.stream("lumi-pet/town/stream");
  await wait(30);
  await host.post("lumi-pet/act", { action: "block", item: guest.id });
  await wait(30);
  assert.match(gs.text, /event: home\ndata: \{"host":"\d+"\}/);
  assert.equal((await guest.post("lumi-pet/houses/here", { host: host.id, room: "kitchen", x: 10, y: 10 })).status, 403);
  assert.equal((await guest.get(`lumi-pet/houses/${host.id}`)).status, 403);
  assert.ok(!(await guest.get("lumi-pet/houses")).json.flats.some((f) => f.id === host.id)); // not even listed
  const state = (await host.get("lumi-pet/state")).json;
  assert.deepEqual(state.blocked, [{ id: guest.id, name: "G2" }]);      // named for Settings
  assert.equal((await guest.get("lumi-pet/houses/12345")).status, 404); // nobody
  assert.equal((await guest.get("lumi-pet/houses/notanid")).status, 404);
  gs.close();
});

test("house-warming SGC: once a day per home, three homes a day, never your own", async () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  const me = await player("Visitor", 0);
  const hosts = [];
  for (let i = 0; i < 4; i += 1) { const h = await player(`Host${i}`); await h.post("lumi-pet/act", { action: "door", item: "open" }); hosts.push(h); }
  const first = (await me.post("lumi-pet/houses/here", { host: hosts[0].id, room: "den", x: 1, y: 1 })).json;
  assert.equal(first.paid, 2);                                          // 10 native -> 2 SGC
  assert.equal(first.coins, 2);
  assert.equal((await me.post("lumi-pet/houses/here", { host: hosts[0].id, room: "kitchen", x: 1, y: 1 })).json.paid, 0); // another room
  lumihouse.HOUSES.leave(me.id);
  assert.equal((await me.post("lumi-pet/houses/here", { host: hosts[0].id, room: "den", x: 1, y: 1 })).json.paid, 0); // back again today
  assert.equal((await me.post("lumi-pet/houses/here", { host: hosts[1].id, room: "den", x: 1, y: 1 })).json.paid, 2);
  assert.equal((await me.post("lumi-pet/houses/here", { host: hosts[2].id, room: "den", x: 1, y: 1 })).json.paid, 2);
  assert.equal((await me.post("lumi-pet/houses/here", { host: hosts[3].id, room: "den", x: 1, y: 1 })).json.paid, 0); // a fourth home: no more today
  assert.equal((await me.post("lumi-pet/houses/here", { room: "den", x: 1, y: 1 })).json.paid, 0); // her own flat
  assert.equal(eco.getBalance(me.id), 6);
});

test("the daily visit pays once per LA day; act refusals are 400 and bad bodies 422", async () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  const a = await player("Daily", 0);
  const first = (await a.post("lumi-pet/visit")).json;
  assert.deepEqual([first.paid, first.coins], [5, 5]);                  // 25 native -> 5 SGC
  assert.equal((await a.post("lumi-pet/visit")).json.paid, 0);          // once today
  const refused = await a.post("lumi-pet/act", { action: "feed", item: "nothing" });
  assert.equal(refused.status, 400);
  assert.match(refused.json.detail, /pantry/);
  assert.equal((await a.post("lumi-pet/act", { action: "fly" })).status, 422);
  assert.equal((await a.post("lumi-pet/act", { action: "buy", item: "cookie", count: "2" })).status, 422); // strict ints
  assert.equal((await a.post("lumi-pet/act", { action: "buy", item: "bouncy-moon" })).status, 402);         // 30 SGC, she has 5
});
