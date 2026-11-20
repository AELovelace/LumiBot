// What Lumi wears (static/games/lumi-pet/closet.js) against the server's catalog (lumipet_data/closet.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const W = createRequire(import.meta.url)("../../public/lumi/lumi-pet/closet.js");
const catalog = JSON.parse(readFileSync(new URL("../../src/lumi/data/closet.json", import.meta.url), "utf8"));
const all = catalog.slots.flatMap(slot => slot.items.map(item => ({ ...item, slot: slot.id })));

test("every accessory has a drawing on a known layer, with no broken numbers, and nothing extra is drawn", () => {
  assert.deepEqual(Object.keys(W.ART).sort(), all.map(item => item.id).sort());
  for (const item of all) {
    const art = W.ART[item.id];
    assert.ok(["back", "front"].includes(art.layer), item.id);
    assert.ok(art.svg.length > 40 && !/NaN|undefined|Infinity/.test(art.svg), item.id);
  }
});

test("only what belongs behind her is drawn behind her", () => {
  for (const item of all) assert.equal(W.ART[item.id].layer === "back", item.slot === "back", item.id);
});

test("an outfit draws one group per slot on the right layer, and skips what it doesn't know", () => {
  const outfit = { head: "acc-crown", back: "acc-cape", tail: "acc-from-the-future", neck: "constructor" };
  const front = W.render(outfit, "front"), back = W.render(outfit, "back");
  assert.ok(front.startsWith('<g data-acc="head">') && !front.includes('data-acc="back"') && !front.includes("tail") && !front.includes("neck"));
  assert.ok(back.startsWith('<g data-acc="back">') && !back.includes("head"));
  assert.equal(W.render({}, "front"), "");
});

test("the capsule's odds are the five rarities and add up to a hundred, and every rarity has something in it", () => {
  assert.deepEqual(Object.keys(catalog.capsule.odds), ["common", "uncommon", "rare", "epic", "legendary"]);
  assert.equal(Object.values(catalog.capsule.odds).reduce((a, b) => a + b), 100);
  for (const rarity of Object.keys(catalog.capsule.odds)) assert.ok(all.some(item => item.rarity === rarity), rarity);
});
