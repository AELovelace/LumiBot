// Lumi City's houses and yards (estate-art.js, lumipet_data/estate.json; 2026-11-19): the 30 house styles and the 75
// yard things are all drawn, match the shop list exactly, and nothing a person typed gets into the picture unescaped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
const require = createRequire(import.meta.url);
const ART_PATH = "../../public/lumi/lumi-pet/estate-art.js";
const Es = require(ART_PATH);
const E = JSON.parse(readFileSync(new URL("../../src/lumi/data/estate.json", import.meta.url), "utf8"));
const SLOTS = ["fence", "mailbox", "path", "lamp", "ornament"];
const BOX = { x: 100, y: 200, w: 256, h: 80 }; // One lot, the size the city uses.

function clean(svg, what) { // Drawn, and nothing broken or dangerous in it.
  assert.ok(svg.length > 40, what + " draws something");
  assert.ok(!/NaN|undefined|<script|\son[a-z]+=|href=|filter=/i.test(svg), what + " has no NaN, undefined, scripts, handlers, links or filters");
}

test("the drawings know exactly the styles and yard things the shop sells, in its order", () => {
  assert.deepEqual(Es.STYLE_IDS, E.styles.map(s => s.id));
  assert.deepEqual(E.slots.map(s => s.id), SLOTS, "The five slots, in order");
  assert.deepEqual(Object.keys(Es.YARD_IDS), SLOTS);
  for (const slot of SLOTS) assert.deepEqual(Es.YARD_IDS[slot], E.yard[slot].map(i => i.id), slot + " matches");
});

test("estate.json: 30 styles with the free starter first, 15 things a slot (5 to buy, 10 from capsules), tidy unique ids", () => {
  assert.equal(E.styles.length, 30);
  assert.equal(E.styles[0].id, "starter-cottage");
  assert.equal(E.styles[0].price, 0, "The starter is free");
  assert.equal(E.styles.filter(s => s.price === 0).length, 1, "Only the starter is free");
  for (const s of E.styles.slice(1)) assert.ok(s.price >= 800 && s.price <= 12000, s.id + " is priced 800-12000");
  const ids = E.styles.map(s => s.id);
  for (const slot of SLOTS) {
    const items = E.yard[slot];
    assert.equal(items.length, 15, slot + " has 15");
    for (const it of items.slice(0, 5)) { assert.ok(it.price >= 60 && it.price <= 1500, it.id + " is in the shop"); assert.equal(it.rarity, undefined); }
    const rare = items.slice(5);
    for (const it of rare) assert.equal(it.price, 0, it.id + " only comes from capsules");
    assert.deepEqual(rare.map(i => i.rarity), ["common", "common", "common", "uncommon", "uncommon", "uncommon", "rare", "rare", "epic", "legendary"], slot + " capsule mix");
    for (const it of items) { assert.ok(it.id.startsWith(slot + "-"), it.id + " is named for its slot"); ids.push(it.id); }
  }
  assert.equal(new Set(ids).size, ids.length, "Every id is unique");
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]{1,31}$/);
  assert.deepEqual(Object.keys(E.capsule.odds), ["common", "uncommon", "rare", "epic", "legendary"]);
  assert.equal(Object.values(E.capsule.odds).reduce((a, b) => a + b, 0), 100, "The odds add up to 100");
});

test("every house style draws cleanly by day and night, and an unknown one draws the starter", () => {
  for (const id of Es.STYLE_IDS) for (const night of [false, true]) clean(Es.house(id, 200, 300, night), id + (night ? " at night" : ""));
  assert.equal(Es.house("no-such-house", 200, 300, false), Es.house("starter-cottage", 200, 300, false));
  const looks = new Set(Es.STYLE_IDS.map(id => Es.house(id, 200, 300, false)));
  assert.equal(looks.size, 30, "No two styles look the same");
  assert.notEqual(Es.house("glass-cube", 200, 300, false), Es.house("glass-cube", 200, 300, true), "Night looks different");
});

test("every yard thing draws cleanly, each different, and an unknown one draws nothing", () => {
  for (const slot of SLOTS) {
    const seen = new Set();
    for (const id of Es.YARD_IDS[slot]) for (const night of [false, true]) { const svg = Es.yardItem(slot, id, 200, 300, night); clean(svg, id); if (!night) seen.add(svg); }
    assert.equal(seen.size, 15, slot + " things all look different");
  }
  assert.equal(Es.yardItem("fence", "fence-nope", 200, 300, false), "");
  assert.equal(Es.yardItem("hat", "fence-picket", 200, 300, false), "");
  assert.equal(Es.yardItem("lamp", "toString", 200, 300, false), "", "Not fooled by inherited names");
});

test("plot(): a lot for sale, a bare one, an owned one with a full yard, and the owner's name always escaped", () => {
  const sale = Es.plot(BOX, { style: "", yard: {}, night: true, sale: "4,400", name: null, on: false });
  clean(sale, "for sale");
  assert.ok(sale.includes("FOR SALE") && sale.includes("4,400"), "The board shows the price");
  const bare = Es.plot(BOX, { style: "", yard: {}, night: false, sale: null, name: null });
  clean(bare, "bare");
  assert.ok(!bare.includes("lp-es-house") && !bare.includes("FOR SALE"), "A bare lot: no house, no board");
  assert.ok(!Es.plot(BOX, { sale: "<i>9</i>" }).includes("<i>"), "The price is escaped too");

  for (const night of [false, true]) {
    const full = {}; for (const slot of SLOTS) full[slot] = E.yard[slot][14].id;
    const owned = Es.plot(BOX, { style: "fairy-palace", yard: full, night, sale: null, name: "Doll <b>&", on: true });
    clean(owned, "owned");
    assert.ok(owned.includes("lp-es-house"), "The house is drawn");
    assert.ok(owned.includes("Doll &lt;b&gt;&amp;") && !owned.includes("<b>"), "The name is escaped");
    for (const slot of SLOTS) { // Each slot shows: take it away and the lot is drawn smaller.
      const less = Object.assign({}, full, { [slot]: "" });
      assert.ok(Es.plot(BOX, { style: "fairy-palace", yard: less, night, name: "Doll <b>&", on: true }).length < owned.length, slot + " is drawn on the lot");
    }
    assert.ok(owned.length > Es.plot(BOX, { style: "fairy-palace", night, name: "Doll" }).length, "The yard things add to the drawing");
    assert.notEqual(owned, bare);
  }
  const starter = Es.plot(BOX, { style: "", name: "Someone", yard: {} });
  assert.ok(starter.includes("lp-es-house"), "An owned lot with no style yet draws the starter");
  assert.ok(Es.plot(BOX, { style: "treehouse", on: true }).length > Es.plot(BOX, { style: "treehouse" }).length, "In reach: the doorstep ring shows");
});

test("the drawing file stays small enough for the TV boxes", () => {
  const size = statSync(new URL(ART_PATH, import.meta.url)).size;
  assert.ok(size < 140 * 1024, "estate-art.js is " + size + " bytes");
});

test("Lumi Realty's preview card frame (viewBox -8 -82 272 206) holds every house and every yard thing", () => { // (2026-11-20: the card in views/lumi-pet.js draws one lot at 0,0 256x80)
  const view = readFileSync(new URL("../../src/lumi/views/lumi-pet.js", import.meta.url), "utf8"); // the page's markup
  assert.match(view, /id="lp-estate-card"[\s\S]*viewBox="-8 -82 272 206"/, "The page has the preview card with this frame");
  const [x0, y0, w, h] = [-8, -82, 272, 206];                         // the frame
  const LOT = { x: 0, y: 0, w: 256, h: 80 };                          // the lot, where game.js drawEstatePreview puts it
  const spots = (svg) => [...svg.matchAll(/ (x|cx|x1|x2|y|cy|y1|y2)="(-?[\d.]+)"/g)].map((m) => [m[1][m[1].length - 1] === "x" || m[1].startsWith("x") ? "x" : "y", Number(m[2])]); // every placed x and y
  const inside = (svg, what) => { for (const [axis, v] of spots(svg)) assert.ok(axis === "x" ? v >= x0 && v <= x0 + w : v >= y0 && v <= y0 + h, what + " has " + axis + " " + v + " outside the card"); };
  for (const s of E.styles) inside(Es.plot(LOT, { style: s.id, yard: {}, name: "Lumi" }), s.id); // every house
  for (const slot of SLOTS) for (const it of E.yard[slot]) inside(Es.plot(LOT, { style: "starter-cottage", yard: { [slot]: it.id }, name: "Lumi" }), it.id); // every yard thing
});
