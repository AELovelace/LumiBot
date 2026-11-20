// src/lumi/pet/lumipet.js: erinne tests/test_lumipet.py at spec level, on an in-memory DB, paid in SGC.
// The decay curve, catch-up, care, the pantry and shop (scaled SGC), decor/wear, capsules + the repeat buyback,
// moving boxes, the move-in refund, names/colours, the door and block list, the visitor's view and the guestbook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { eco, db, errors } = boot();                                   // one in-memory DB for this file
const lp = require("../../src/lumi/pet/lumipet.js");                 // the module under test
const save = require("../../src/lumi/pet/save.js");                  // the save model
const HOUR = lp.HOUR;                                                  // ms in an hour
const T0 = 1_800_000_000_000;                                          // a fixed "now" (ms)
let next = 100;                                                        // fresh player ids
const newPlayer = (coins = 1000) => { const id = String(123456789012345000n + BigInt(next++)); setBalance(eco, id, coins); return id; }; // a Discord-shaped id with SGC
const act = (uid, action, now, opts = {}) => db.tx(() => lp.act(uid, action, { ...opts, now })); // one action in a transaction
const state = (uid, now) => db.tx(() => lp.state(uid, now));          // read + catch up
const setPet = (uid, fields) => db.tx(() => { const pet = save.peek(uid); Object.assign(pet, fields); save.save(uid, pet); }); // put a pet in a known condition
const balance = (id) => eco.getBalance(id);                            // SGC
const refused = (fn, re) => assert.throws(fn, (e) => e instanceof lp.PetError && re.test(e.message)); // a PetError with these words
const ITEM_SCALE = 1;                                                  // the default lumi.itemScale: snacks, toys, decor, wear and capsules are items
const itemSgc = (native) => Math.max(1, Math.round(native * ITEM_SCALE)); // an item price in SGC by the rule (min 1)
const itemBack = (native) => Math.floor(native * ITEM_SCALE);          // an item-value payout (buyback / move-in) by the rule

test("the last quarter of every meter takes exactly one day; fast at the top, slow at the bottom", () => {
  for (const b of Object.values(lp.DECAY)) {
    assert.ok(Math.abs(lp.decayed(25, 24, b)) < 1e-9);                  // a quarter to empty: one day
    assert.ok(lp.decayed(25, 23.5, b) > 0);                             // not before
  }
  assert.ok(Math.abs(lp.decayed(100, 16.9, lp.DECAY.hunger) - 25) < 0.2); // hunger: full to a quarter in ~17 h
  assert.ok(Math.abs(lp.decayed(100, 23.4, lp.DECAY.energy) - 25) < 0.2); // energy and joy: ~23 h
  assert.ok(100 - lp.decayed(100, 1, 30) > 10 * lp.decayed(25, 23, 30)); // first hour >> last hour
  const b = lp.DECAY.joy;                                               // two steps = one step
  assert.ok(Math.abs(lp.decayed(lp.decayed(90, 3, b), 5, b) - lp.decayed(90, 8, b)) < 1e-9);
  assert.equal(lp.decayed(50, 0, b), 50);
  assert.equal(lp.decayed(0, 100, b), 0);
});

test("a new pet starts content, runs down while away, loses nothing, and a backwards clock changes nothing", () => {
  const a = newPlayer();
  const first = state(a, T0).pet;
  assert.deepEqual([first.hunger, first.energy, first.joy, first.moments], [85, 85, 85, 0]);
  const later = state(a, T0 + 12 * HOUR).pet;
  assert.ok(later.hunger < later.energy && later.energy < 85);          // hunger goes fastest
  const gone = state(a, T0 + 30 * 24 * HOUR).pet;
  assert.deepEqual([gone.hunger, gone.energy, gone.joy, gone.moments, gone.toys.length], [0, 0, 0, 0, 0]);
  const b = newPlayer();
  state(b, T0);
  assert.equal(state(b, T0 - 5 * HOUR).pet.hunger, 85);                 // the clock ran backwards
});

test("cuddles add joy and a moment with a cooldown; free food never runs out, bought food is used up", () => {
  const a = newPlayer();
  state(a, T0);
  setPet(a, { joy: 50, hunger: 10 });
  const out = act(a, "cuddle", T0).pet;
  assert.deepEqual([out.joy, out.moments, out.memory], [55, 1, "cuddle"]);
  refused(() => act(a, "cuddle", T0 + 1000), /still enjoying/);
  assert.equal(act(a, "cuddle", T0 + lp.COOLDOWN).pet.moments, 2);
  const fed = act(a, "feed", T0, { item: "apple" }).pet;                // free apple
  assert.equal(fed.hunger, 40);
  refused(() => act(a, "feed", T0 + lp.COOLDOWN, { item: "cookie" }), /no cookie left/);
  const bought = act(a, "buy", T0, { item: "cookie", count: 2 });       // 2 x 8 native = 2 x 8 SGC (items keep erinne's price)
  const cookie = itemSgc(lp._ITEMS.cookie.price);                       // one cookie in SGC
  assert.deepEqual(bought.said, { bought: "cookie", count: 2, paid: 2 * cookie });
  assert.equal(bought.coins, 1000 - 2 * cookie);
  assert.equal(balance("__LUMI_SNACKS__") >= 2 * cookie, true);         // the Snack Stand got it
  assert.deepEqual(act(a, "feed", T0 + lp.COOLDOWN, { item: "cookie" }).pet.inventory, { cookie: 1 });
  assert.deepEqual(act(a, "feed", T0 + 2 * lp.COOLDOWN, { item: "cookie" }).pet.inventory, {});
  for (const wrong of ["star-ribbon", "nothing", null]) refused(() => act(a, "feed", T0 + HOUR, { item: wrong }), /pantry/);
});

test("treats leave a boost; meters never pass 100", () => {
  const a = newPlayer();
  act(a, "buy", T0, { item: "comet-candy" });
  assert.equal(act(a, "feed", T0, { item: "comet-candy" }).pet.boost, "power");
  const b = newPlayer();
  assert.equal(act(b, "feed", T0, { item: "apple" }).pet.hunger, 100);
});

test("play is timed and pays once when it finishes; a nap cut short earns nothing", () => {
  const a = newPlayer();
  state(a, T0);
  setPet(a, { hunger: 60, energy: 60, joy: 40 });
  const started = act(a, "play", T0, { item: "star-ribbon" }).pet;
  assert.deepEqual([started.task.kind, started.task.finishesAt, started.moments], ["play", T0 + 120_000, 0]);
  refused(() => act(a, "nap", T0 + 1000), /busy playing/);
  assert.notEqual(state(a, T0 + 119_000).pet.task, null);
  const done = state(a, T0 + 120_000).pet;
  assert.equal(done.task, null);
  assert.equal(done.moments, 1);
  assert.deepEqual(done.done, { kind: "play", item: "star-ribbon", at: T0 + 120_000 });
  assert.ok(Math.abs(done.joy - 65) < 0.5);
  assert.equal(state(a, T0 + 121_000).pet.moments, 1);                  // looking again never pays twice
  const b = newPlayer();
  state(b, T0);
  setPet(b, { energy: 40 });
  const napping = act(b, "nap", T0).pet;
  assert.deepEqual([napping.rest, napping.restUntil], ["nap", T0 + lp.NAP_MINUTES * 60_000]);
  const woken = act(b, "wake", T0 + 60_000).pet;
  assert.deepEqual([woken.task, woken.rest, woken.restUntil], [null, "awake", T0 + 60_000 + lp.AWAKE_MS]);
  assert.ok(state(b, T0 + 10 * 60_000).pet.energy < 40);
});

test("toys are bought once (whatever count was asked) and only owned toys can be played with", () => {
  const a = newPlayer();
  refused(() => act(a, "play", T0, { item: "bouncy-moon" }), /toy box/);
  assert.equal(act(a, "buy", T0, { item: "bouncy-moon", count: 5 }).coins, 1000 - itemSgc(lp._ITEMS["bouncy-moon"].price)); // 150 native -> 150 SGC, once
  refused(() => act(a, "buy", T0, { item: "bouncy-moon" }), /already has/);
  assert.equal(act(a, "play", T0, { item: "bouncy-moon" }).pet.task.item, "bouncy-moon");
});

test("the shop refuses what can't be afforded with a 402 and takes nothing; free things aren't for sale; the pantry has a limit", () => {
  const a = newPlayer(itemSgc(lp._ITEMS.lunch.price));                  // lunch is 12 native -> 12 SGC: exactly that much
  act(a, "buy", T0, { item: "lunch" });                                 // exactly affordable
  assert.equal(balance(a), 0);
  assert.throws(() => act(a, "buy", T0, { item: "lunch" }), (e) => e instanceof errors.LumiError && e.status === 402 && /Not enough SGC/.test(e.message));
  assert.deepEqual(state(a, T0).pet.inventory, { lunch: 1 });           // the refused one rolled back
  for (const wrong of ["apple", "star-ribbon", "nothing"]) refused(() => act(a, "buy", T0, { item: wrong }), /doesn't sell/);
  const b = newPlayer(5000);
  act(b, "buy", T0, { item: "banana", count: 99 });
  refused(() => act(b, "buy", T0, { item: "banana" }), /holds up to 99/);
});

test("room mode, glow and the browser import", () => {
  const a = newPlayer();
  assert.equal(state(a, T0).pet.room_mode, true);
  const off = act(a, "room_mode", T0).pet;
  assert.deepEqual([off.room_mode, off.moments], [false, 0]);
  assert.equal(act(a, "glow", T0, { glow: "lagoon" }).pet.glow, "lagoon");
  refused(() => act(a, "glow", T0, { glow: "plaid" }), /glow/);
  const first = act(a, "import", T0, { moments: 42, glow: "starlight" }).pet;
  assert.deepEqual([first.moments, first.glow, first.imported], [42, "starlight", true]);
  assert.equal(act(a, "import", T0, { moments: 5000 }).pet.moments, 42); // once only
});

test("decorating buys once at the Boutique, then swaps for free; capsule-only, found and boxed pieces can't be bought", () => {
  const a = newPlayer();
  const priced = Object.values(lp._DECOR).find((p) => p.price && !p.same_as && p.spot === "rug"); // a rug for sale
  const out = act(a, "decorate", T0, { item: priced.id });
  assert.equal(out.said.paid, itemSgc(priced.price));                    // an item: erinne's price x item scale
  assert.equal(out.pet.house.rug, priced.id);
  assert.equal(act(a, "decorate", T0, { item: priced.id }).said, null);  // owned: free swap
  const capsuleOnly = Object.values(lp._DECOR).find((p) => "rarity" in p);
  refused(() => act(a, "decorate", T0, { item: capsuleOnly.id }), /only comes from a capsule/);
  const found = Object.values(lp._DECOR).find((p) => p.found);
  refused(() => act(a, "decorate", T0, { item: found.id }), /dungeon/);
  refused(() => act(a, "decorate", T0, { item: lp.BOXES[0].id }), /moving box/);
  refused(() => act(a, "decorate", T0, { item: "nothing" }), /isn't something/);
  refused(() => act(a, "decorate", T0, { item: priced.id, home: "house" }), /haven't got a house/); // no plot yet
  const poor = newPlayer(0);
  assert.throws(() => act(poor, "decorate", T0, { item: priced.id }), (e) => e.status === 402);
});

test("walls and floors can be painted any colour, per room", () => {
  const a = newPlayer();
  const wall = Object.values(save.SPOTS).find((s) => s.paintable && !s.same_as);
  assert.equal(act(a, "paint", T0, { spot: wall.id, colour: "#FF8ECB" }).pet.house[wall.id], "#ff8ecb");
  refused(() => act(a, "paint", T0, { spot: wall.id, colour: "pink" }), /six hex digits/);
  refused(() => act(a, "paint", T0, { spot: "rug", colour: "#ffffff" }), /Only walls and floors/);
});

test("accessories are bought once then worn and taken off freely; capsule-only ones can't be bought", () => {
  const a = newPlayer();
  const bought = act(a, "wear", T0, { item: "acc-bow" });               // 60 native -> 60 SGC
  assert.equal(bought.said.paid, itemSgc(lp._WEAR["acc-bow"].price));
  assert.equal(bought.pet.outfit[lp._WEAR["acc-bow"].slot], "acc-bow");
  assert.equal(act(a, "wear", T0, { item: "acc-bow" }).pet.outfit[lp._WEAR["acc-bow"].slot], undefined); // off
  const capsuleOnly = Object.values(lp._WEAR).find((w) => w.rarity && !w.price);
  refused(() => act(a, "wear", T0, { item: capsuleOnly.id }), /only comes from a capsule/);
  refused(() => act(a, "wear", T0, { item: "apple" }), /can wear/);
});

test("the capsule rolls a rarity then a prize; a repeat pays back half its value (uncapped) and changes nothing", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);                       // the bank can pay buybacks
  const a = newPlayer(10_000);
  const rng = () => 0;                                                  // roll 0: the first rarity (common), its first prize
  const first = act(a, "capsule", T0, { rng });
  assert.equal(first.said.rarity, "common");
  assert.equal(first.said.paid, itemSgc(lp.CLOSET.capsule.price));      // 150 native -> 150 SGC (Moon Capsule Co.)
  assert.ok(balance("__LUMI_CAPSULES__") >= itemSgc(lp.CLOSET.capsule.price));
  const won = first.said.capsule;
  const again = act(a, "capsule", T0, { rng });                         // the same prize again
  assert.equal(again.said.capsule, won);
  assert.equal(again.said.duplicate, true);
  const prize = lp._PRIZES.find((p) => p.id === won);
  const native = Math.floor((prize.price || lp.CLOSET.values.common) / 2);
  assert.equal(again.said.buyback, itemBack(native));                    // half its value, at the item scale
  const moon = act(a, "capsule", T0, { item: "moon", rng });            // the dearer one
  assert.equal(moon.said.paid, itemSgc(lp.CLOSET.moon.price));          // 300 native -> 300 SGC
  assert.ok(["rare", "epic", "legendary"].includes(moon.said.rarity));
  refused(() => act(a, "capsule", T0, { item: "sun" }), /doesn't know that capsule/);
});

test("a capsule stops before charging when everything it could give is hers", () => {
  const a = newPlayer(10_000);
  const pool = lp._PRIZES.filter((p) => p.rarity in lp.CLOSET.moon.odds);
  const own = { decor: [], toys: [], closet: [] };
  for (const p of pool) own[lp._shelf(p)].push(p.id);
  state(a, T0);
  setPet(a, own);
  refused(() => act(a, "capsule", T0, { item: "moon" }), /already has everything/);
  assert.equal(balance(a), 10_000);                                     // nothing charged
});

test("one moving box a day; an older house moves in afresh with its SGC given back once", () => {
  const a = newPlayer();
  db.setClock(() => T0);                                                // the LA day follows the test clock
  try {
    const one = act(a, "unpack", T0);
    assert.equal(one.said.unpacked, lp.BOXES[0].id);
    refused(() => act(a, "unpack", T0 + 1000), /enough for one day/);
    db.setClock(() => T0 + 24 * HOUR);
    assert.equal(act(a, "unpack", T0 + 24 * HOUR).said.unpacked, lp.BOXES[1].id);
  } finally { db.setClock(null); }
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  const b = newPlayer(0);
  const priced = Object.values(lp._DECOR).find((p) => p.price >= 100);  // a dear piece she owned before the move-in
  state(b, T0);
  setPet(b, { moved_in: 0, decor: [priced.id], house: { [priced.spot]: priced.id } });
  const moved = state(b, T0 + 1000).pet;
  assert.deepEqual([moved.decor, moved.moved_in, moved.unpacked], [[], 1, 0]);
  assert.equal(balance(b), itemBack(priced.price));                     // the move-in refund at the item scale, no cap
  setPet(b, { moved_in: 0 });
  state(b, T0 + 2000);
  assert.equal(balance(b), itemBack(priced.price));                     // paid once (lumi-move-in:<uid>)
});

test("her name and colour are hers to choose", () => {
  const a = newPlayer();
  assert.equal(act(a, "name", T0, { name: "  Star   Bean " }).pet.name, "Star Bean");
  refused(() => act(a, "name", T0, { name: "!!!" }), /letters or numbers/);
  refused(() => act(a, "name", T0, { name: "x".repeat(17) }), /letters or numbers/);
  assert.equal(act(a, "colour", T0, { colour: "#AABBCC" }).pet.colour, "#aabbcc");
  assert.equal(act(a, "colour", T0, { colour: "" }).pet.colour, null);
  refused(() => act(a, "colour", T0, { colour: "red" }), /hex/);
  assert.equal(save.look(a).name, "Star Bean");
});

test("the door turns knock -> open -> closed; blocking keeps ids as strings", () => {
  const a = newPlayer(), b = newPlayer();
  assert.equal(act(a, "door", T0).said.door, "open");
  assert.equal(act(a, "door", T0).said.door, "closed");
  assert.equal(act(a, "door", T0, { item: "knock" }).said.door, "knock");
  refused(() => act(a, "door", T0, { item: "ajar" }), /knock, open or closed/);
  assert.deepEqual(act(a, "block", T0, { item: b }).said, { block: b });
  assert.deepEqual(save.door(a).blocked, [b]);
  refused(() => act(a, "block", T0, { item: a }), /Choose someone/);
  act(a, "unblock", T0, { item: b });
  assert.deepEqual(save.door(a).blocked, []);
});

test("a visitor sees the house, boxes, look and guestbook, never who signed by account; the host can take a line out", () => {
  const host = newPlayer(), guest = newPlayer();
  state(host, T0);
  const book = db.tx(() => lp.sign(host, guest, "Jane", "Pip", "Lovely flat!", T0));
  assert.equal(book.length, 1);
  assert.equal(book[0].uid, guest);                                     // kept (as a string) in the host's save
  const seen = lp.houseView(host);
  assert.deepEqual(Object.keys(seen).sort(), ["boxes", "guestbook", "house", "look"]);
  assert.deepEqual(Object.keys(seen.guestbook[0]).sort(), ["at", "id", "lumi", "name", "text"]); // never the uid
  assert.equal(seen.boxes, lp.BOXES.length);
  act(host, "guestbook_remove", T0, { item: book[0].id });
  assert.equal(lp.houseView(host).guestbook.length, 0);
  assert.throws(() => db.tx(() => lp.sign(newPlayer(), guest, "Jane", "Pip", "hi", T0)), /no guestbook/);
  for (let i = 0; i < 35; i += 1) db.tx(() => lp.sign(host, guest, "Jane", "Pip", `line ${i}`, T0 + i));
  assert.equal(lp.houseView(host).guestbook.length, lp.GUESTBOOK_MAX);  // only the last 30
});

test("the snapshot has erinne's shape and SGC; an unknown action is refused", () => {
  const a = newPlayer(777);
  const s = state(a, T0);
  for (const key of ["pet", "now", "coins", "catalog", "house", "closet", "battle", "progress", "fight", "potions_ready", "health", "party", "boxes", "garden", "garden_decor", "dungeon"]) assert.ok(key in s, key);
  assert.equal(s.coins, 777);
  assert.equal(s.now, T0);
  refused(() => act(a, "dance", T0), /doesn't know that one/);
  refused(() => act(a, "decorate", T0, { item: "rug-moon", home: "garage" }), /flat and a house/);
});
