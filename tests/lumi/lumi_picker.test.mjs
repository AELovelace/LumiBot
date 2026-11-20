// The Home and Closet lists (picker-ui.js): one row per spot or slot, with ◀ ▶ flipping its choices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
createRequire(import.meta.url)("../../public/lumi/lumi-tuning.js"); // LumiBot: LumiPrice on globalThis (default tuning: x0.2), as on a page
const Pk = createRequire(import.meta.url)("../../public/lumi/lumi-pet/picker-ui.js");
const data = name => JSON.parse(readFileSync(new URL("../../src/lumi/data/" + name, import.meta.url), "utf8"));
const house = data("house.json"), closet = data("closet.json");
// A Lumi who has bought the tier-1 piece (the old free starter) for every spot, and put it out.
const firsts = Object.fromEntries(house.spots.filter(spot => !spot.same_as).map(spot => [spot.id, spot.items.find(item => !item.worn).id])); // (shared walls have no pieces of their own)
const starters = Object.values(firsts).filter(id => house.spots.some(spot => spot.items.some(item => item.id === id && item.price)));

function lists(pet = {}, open = null, flip = {}, boxes = { left: 0 }) {
  const went = [];
  const snap = { pet: { house: firsts, decor: starters, outfit: {}, closet: [], ...pet }, house, closet, boxes };
  const ctx = { snap, open, flip, go: change => went.push(change) };
  const find = rows => key => rows.find(r => r.key === key);
  const home = Pk.homeRows(ctx), wear = Pk.closetRows(ctx);
  return { home, wear, went, spot: find(home), slot: find(wear) };
}

test("turning steps through the choices and wraps at both ends", () => {
  assert.deepEqual([Pk.turn(["a", "b", "c"], "a", 1), Pk.turn(["a", "b", "c"], "c", 1), Pk.turn(["a", "b", "c"], "a", -1), Pk.turn(["a", "b"], "gone", 1)], ["b", "a", "c", "b"]);
  assert.equal(Pk.turn([null, "x"], null, -1), "x");
});

test("the house is one row a spot, showing what is placed; Enter there opens the full list", () => {
  const view = lists();
  assert.deepEqual(view.home.map(r => r.key), house.spots.map(spot => spot.id));
  const rug = view.spot("rug");
  assert.deepEqual([rug.shown, rug.hint, rug.send, rug.preview], ["rug-oval", "Plum oval · in the room · Enter for more", undefined, ["rug", "rug-oval"]]);
  assert.deepEqual(rug.options, ["rug-oval"], "◀ ▶ step only through rugs she owns: the shop's are in the rug's whole list");
  rug.local();
  assert.deepEqual(view.went, [{ open: "rug" }]);
});

test("a flipped row previews one of her own things and Enter puts it out; nothing she'd have to buy is in the row", () => {
  const priced = lists({}, null, { rug: "rug-moon" }).spot("rug");
  assert.deepEqual([priced.shown, priced.send, priced.preview], ["rug-oval", undefined, ["rug", "rug-oval"]], "A rug she doesn't own can't be flipped to: the row stays on hers");
  const owned = lists({ decor: [...starters, "rug-moon"] }, null, { rug: "rug-moon" }).spot("rug");
  assert.deepEqual(owned.options, ["rug-oval", "rug-moon"]);
  assert.deepEqual([owned.hint, owned.send, owned.preview, owned.label], ["◀ Moon rug ▶ · yours · Enter puts it out", { action: "decorate", item: "rug-moon" }, ["rug", "rug-moon"], "Moon rug"]);
  assert.equal(lists({ decor: [...starters, "rug-moon"] }).spot("rug").hint, "◀ Plum oval ▶ · in the room · Enter for more", "With two of hers, the arrows show");
  const placed = lists({ decor: [...starters, "rug-moon"], house: { ...firsts, rug: "rug-moon" } }, null, { rug: "rug-oval" }).spot("rug");
  assert.deepEqual([placed.hint, placed.send], ["◀ Plum oval ▶ · yours · Enter puts it out", { action: "decorate", item: "rug-oval" }]);
  assert.equal(lists({}, null, { rug: "rug-retired" }).spot("rug").shown, "rug-oval", "A choice that no longer exists falls back to what is placed");
});

test("trophies appear among a spot's choices only once they are found", () => {
  assert.deepEqual(lists().spot("trophy").options, ["trophy-none"]);
  assert.deepEqual(lists({ decor: ["trophy-geode-egg"] }).spot("trophy").options, ["trophy-none", "trophy-geode-egg"]);
  const full = lists({ decor: ["trophy-geode-egg"] }, "trophy");
  assert.equal(full.home.length, 27);
  assert.match(full.spot("trophy-moon-bell").note, /waiting somewhere in the dungeon/);
  assert.deepEqual(full.spot("trophy-geode-egg").send, { action: "decorate", item: "trophy-geode-egg" });
  full.spot("back").local();
  assert.deepEqual(full.went, [{ open: null, pick: house.spots.findIndex(spot => spot.id === "trophy") }]);
});

test("a dungeon set piece stays out of the row until found, and its full list names the place it waits in", () => {
  const piece = house.spots.find(spot => spot.id === "bed").items.find(item => item.found === "toy-attic");
  const dungeon = { environments: data("dungeon.json").environments.map(env => ({ id: env.id, name: env.name })) };
  const snap = { pet: { house: firsts, decor: [], outfit: {}, closet: [] }, house, closet, dungeon };
  const go = () => {};
  assert.ok(!Pk.homeRows({ snap, open: null, flip: {}, go }).find(r => r.key === "bed").options.includes(piece.id), "Not in the row before it is found");
  const row = Pk.homeRows({ snap, open: "bed", flip: {}, go }).find(r => r.key === piece.id);
  assert.deepEqual([row.icon, row.hint, row.send], ["🔒", "Found in the Haunted Toy Attic · a rare find", undefined]);
  assert.equal(row.note, piece.name + " can't be bought. It's waiting somewhere in the Haunted Toy Attic.");
  const trophy = Pk.homeRows({ snap, open: "trophy", flip: {}, go }).find(r => r.key === "trophy-moon-bell");
  assert.equal(trophy.hint, "Found in the Moonlit Shrine's vault");
  const found = { ...snap, pet: { ...snap.pet, decor: [piece.id] } };
  assert.ok(Pk.homeRows({ snap: found, open: null, flip: {}, go }).find(r => r.key === "bed").options.includes(piece.id), "Once found it swaps in like any of hers");
});

test("Star Capsule decor stays out of a spot's row until she has it, and its full list says where it comes from", () => {
  const prize = "rug-braid";
  assert.ok(!lists().spot("rug").options.includes(prize), "A prize she hasn't won can't be flipped to, or bought from the row");
  const full = lists({}, "rug").spot(prize);
  assert.deepEqual([full.icon, full.hint, full.send], ["🔒", "Common · only from a capsule", undefined]);
  assert.match(full.note, /only comes from a capsule/);
  assert.ok(lists({ decor: [prize] }).spot("rug").options.includes(prize));
  assert.deepEqual(lists({ decor: [prize] }, "rug").spot(prize).send, { action: "decorate", item: prize });
});

test("a Lumi-Soft prize stays out of a spot's row until it is won, and says how to win it", () => {
  const piece = house.spots.find(spot => spot.id === "lamp").items.find(item => item.prize);
  assert.ok(!lists().spot("lamp").options.includes(piece.id), "Not in the row before it is won");
  const full = lists({}, "lamp").spot(piece.id);
  assert.deepEqual([full.icon, full.hint, full.send, full.ask], ["🔒", "Lumi-Soft prize · Clear Lumi's Lounge in Lumi-Soft", undefined, undefined]);
  assert.equal(full.note, "Neon bullseye lamp is a Lumi-Soft prize. Clear Lumi's Lounge in Lumi-Soft.");
  assert.ok(lists({ decor: [piece.id] }).spot("lamp").options.includes(piece.id), "Once won it swaps in like any of hers");
  assert.deepEqual(lists({ decor: [piece.id] }, "lamp").spot(piece.id).send, { action: "decorate", item: piece.id });
});

test("the Lumi-Soft goggles can be tried on but not bought, and say how to win them", () => {
  const flipped = lists({}, null, { "slot:head": "acc-soft-goggles" }).slot("slot-head");
  assert.deepEqual([flipped.hint, flipped.send, flipped.wear], ["◀ Lumi-Soft goggles ▶ · Lumi-Soft prize · Clear Lumi-Soft's Story mode", undefined, ["head", "acc-soft-goggles"]]);
  assert.equal(flipped.note, "Lumi-Soft goggles is a Lumi-Soft prize. Clear Lumi-Soft's Story mode.");
  const full = lists({}, "head").slot("acc-soft-goggles");
  assert.deepEqual([full.icon, full.hint, full.send, full.ask], ["🔒", "Lumi-Soft prize · Clear Lumi-Soft's Story mode", undefined, undefined]);
  const won = lists({ closet: ["acc-soft-goggles"] }, "head").slot("acc-soft-goggles");
  assert.deepEqual([won.hint, won.send], ["Lumi-Soft prize · hers · Enter puts it on", { action: "wear", item: "acc-soft-goggles" }]);
});

test("backing out of a place on Lumi lands on its row, below both capsules", () => {
  const view = lists({}, "tail");
  view.slot("back").local();
  assert.deepEqual(view.went, [{ open: null, pick: 7 }]);
});

test("the closet is the capsule and one row a place on Lumi, with nothing as a choice", () => {
  const view = lists();
  assert.deepEqual(view.wear.map(r => r.key), ["capsule", "capsule-moon", "slot-head", "slot-neck", "slot-wings", "slot-back", "slot-paws", "slot-tail"]);
  assert.deepEqual(view.slot("capsule").send, { action: "capsule" });
  assert.deepEqual(view.slot("capsule-moon").send, { action: "capsule", item: "moon" });
  assert.match(view.slot("capsule-moon").hint, /^60 SGC · rare, epic or legendary only · a repeat pays back half its value$/);
  const head = view.slot("slot-head");
  assert.deepEqual([head.shown, head.hint, head.wear, head.options.length], [null, "◀ Nothing ▶ · nothing on", ["head", null], 22]);   // nothing, then twenty hats and the Lumi-Soft goggles
  head.local();
  assert.deepEqual(view.went, [{ open: "head" }]);
});

test("flipping a place on Lumi tries it on, and Enter buys, wears, takes off or explains", () => {
  const key = { "slot:head": "acc-bow" };
  assert.deepEqual([lists({}, null, key).slot("slot-head").hint, lists({}, null, key).slot("slot-head").send], ["◀ Ribbon bow ▶ · Common · 12 SGC · Enter buys it", { action: "wear", item: "acc-bow" }]);
  assert.equal(lists({ closet: ["acc-bow"] }, null, key).slot("slot-head").hint, "◀ Ribbon bow ▶ · Common · hers · Enter puts it on");
  const worn = lists({ closet: ["acc-bow"], outfit: { head: "acc-bow" } });
  assert.deepEqual([worn.slot("slot-head").hint, worn.slot("slot-head").icon, worn.slot("slot-head").send], ["◀ Ribbon bow ▶ · Common · wearing it", "✓", undefined]);
  const off = lists({ closet: ["acc-bow"], outfit: { head: "acc-bow" } }, null, { "slot:head": null }).slot("slot-head");
  assert.deepEqual([off.hint, off.send, off.wear], ["◀ Nothing ▶ · Enter takes it off", { action: "wear", item: "acc-bow" }, ["head", null]]);
  const crown = lists({}, null, { "slot:head": "acc-crown" }).slot("slot-head");
  assert.equal(crown.send, undefined);
  assert.match(crown.note, /only comes from a capsule/);
  assert.deepEqual(lists({ closet: ["acc-crown"] }, null, { "slot:head": "acc-crown" }).slot("slot-head").send, { action: "wear", item: "acc-crown" });
});

test("a place's full list offers every accessory, as before", () => {
  const head = lists({ closet: ["acc-bow"], outfit: { head: "acc-bow" } }, "head");
  const hats = closet.slots.find(slot => slot.id === "head").items.map(item => item.id);
  assert.deepEqual(head.wear.map(r => r.key), ["back"].concat(hats));
  assert.deepEqual(hats.slice(0, 10), ["acc-bow", "acc-star-clip", "acc-flower-crown", "acc-witch-hat", "acc-crown", "acc-sprout", "acc-party-hat", "acc-ear-cosies", "acc-toadstool-cap", "acc-planet-topper"]);
  assert.equal(hats.length, 21);
  assert.match(head.slot("acc-bow").hint, /wearing it · Enter takes it off/);
  assert.match(head.slot("acc-crown").note, /capsule/);
  assert.deepEqual(head.slot("acc-star-clip").send, { action: "wear", item: "acc-star-clip" });
});

test("the capsules are also sold at the top of the Shop", () => {
  const snap = { closet: { capsule: { name: "Star Capsule", price: 150 }, moon: { name: "Moon Capsule", price: 300 } } };
  const rows = Pk.capsuleRows(snap);
  assert.deepEqual(rows.map(r => [r.key, r.name, r.send]), [["capsule", "Star Capsule", { action: "capsule" }], ["capsule-moon", "Moon Capsule", { action: "capsule", item: "moon" }]]);
  assert.match(rows[0].hint, /^30 SGC/);
  assert.match(rows[1].hint, /^60 SGC · rare, epic or legendary only/);
});

test("a bare spot says so, the boxes come first, and a worn piece waits in its box until it is unpacked", () => {
  const bare = lists({ house: {}, decor: [] }, null, {}, { left: 14, total: 14, next: "Mattress on the floor", ready: true });
  assert.deepEqual(bare.home[0].send, { action: "unpack" });
  assert.equal(bare.home[0].hint, "Box 1 of 14: Mattress on the floor");
  const bed = bare.spot("bed");
  assert.deepEqual([bed.shown, bed.preview, bed.hint], [null, null, "Bare for now · Enter to see what you could buy"]);
  assert.ok(!bed.options.includes("bed-worn"), "Her own mattress isn't among the choices until it is unpacked");
  const waiting = lists({ house: {}, decor: [] }, null, {}, { left: 13, total: 14, next: "Bare bulb on a stand", ready: false });
  assert.match(waiting.home[0].note, /Another box tomorrow/);
  const full = lists({ house: {}, decor: [] }, "lamp");
  assert.match(full.spot("lamp-worn").note, /moving box 2/);
  assert.equal(full.spot("lamp-worn").send, undefined);
  const unpacked = lists({ house: { bed: "bed-worn" }, decor: ["bed-worn"] }).spot("bed");
  assert.deepEqual([unpacked.shown, unpacked.hint], ["bed-worn", "Mattress on the floor · in the room · Enter for more"]);
});

test("buying is try before you buy: the first choice shows it, the second buys it", () => {
  const full = lists({}, "rug");
  const moon = full.spot("rug-moon");
  assert.deepEqual([moon.preview, moon.send], [["rug", "rug-moon"], { action: "decorate", item: "rug-moon" }]);
  assert.equal(moon.ask, "Here's the Moon rug in the room. Choose it again to buy it for 20 SGC.");
  assert.equal(full.spot("rug-oval").ask, undefined, "Already hers: no need to ask");
  const hat = lists({}, null, {}).wear.find(r => r.key === "slot-head");
  hat.local && hat.local();
  const slot = lists({}, "head").wear.find(r => r.send && r.send.action === "wear" && !r.note);
  assert.match(slot.ask, /tries on the .*Choose it again to buy it for \d+ SGC/);
});

test("back from a spot's whole list lands on that spot's row, below the moving boxes while any are left", () => {
  const index = house.spots.findIndex(spot => spot.id === "rug");
  const withBoxes = lists({}, "rug", {}, { left: 3, total: 14, next: "x", ready: false });
  withBoxes.spot("back").local();
  assert.deepEqual(withBoxes.went, [{ open: null, pick: index + 1 }]);
  assert.equal(lists({}, null, {}, { left: 3, total: 14, next: "x", ready: false }).home[index + 1].key, "rug");
  const unpacked = lists({}, "rug");
  unpacked.spot("back").local();
  assert.deepEqual(unpacked.went, [{ open: null, pick: index }]);
});
