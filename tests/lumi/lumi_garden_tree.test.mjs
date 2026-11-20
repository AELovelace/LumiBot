// Lumi's Garden's pages (garden-tree.js and garden-tree-art.js): the Flower tree, the Helpers and the Moonrise, against
// the server's catalog (garden.json) and a garden shaped the way mnemerynne/lumigarden.py view() describes one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../../public/lumi/lumi-tuning.js");                     // LumiBot: LumiPrice/LumiPayout on globalThis (default scales: play 0.2, items 1)
const T = require("../../public/lumi/lumi-pet/garden-tree.js");
const Art = require("../../public/lumi/lumi-pet/garden-tree-art.js");
const catalog = JSON.parse(readFileSync(new URL("../../src/lumi/data/garden.json", import.meta.url), "utf8"));

function garden(unlocked = ["moondaisy"], extra = {}) { // A garden with these flowers; "next" worked out the way lumigarden.opens() does.
  return { at: 0, gardens: 1, plot_price: 25, given: 12, powder: 120,
    flowers: catalog.flowers.map(flower => ({ ...flower, unlocked: unlocked.includes(flower.id), powder_now: flower.powder, minutes_now: flower.minutes,
      next: !unlocked.includes(flower.id) && flower.after.some(id => unlocked.includes(id)) })),
    helpers: catalog.helpers.map((helper, i) => ({ id: helper.id, name: helper.name, about: helper.about, level: i, cost: helper.cost * (i + 1) })),
    upgrades: catalog.upgrades.map(thing => ({ ...thing, count: 0 })), moonrise: { needs: 100000, ready: false, count: 0 }, ...extra };
}
function page(name, view, cursor, more = {}) {
  const went = [], ctx = { garden: view, cursor, seed: "moondaisy", level: 1, go: change => went.push(change), ...more };
  return { went, rows: T.rows(name, ctx), choice: T.choice(name, ctx, cursor), lines: T.lines(name, ctx, cursor), ctx };
}
const itemSgc = native => Math.max(1, Math.round(native * 1));       // a seed's SGC price: erinne's price x the default item scale 1
const clicks = svg => [...svg.matchAll(/data-click="([^"]+)"/g)].map(m => m[1]);

test("the flower tree: Moondaisy at the top, three branches under it, the crown below the cut branches", () => {
  const spots = T.spots("seeds", garden()), at = id => spots.find(spot => spot.id === id);
  assert.equal(spots.length, catalog.flowers.length);
  assert.ok(at("moondaisy").y < at("glowbell").y && at("glowbell").y === at("pixie-puff").y && at("pixie-puff").y === at("moon-fern").y, "the first of each branch side by side under the root");
  assert.ok(at("glowbell").x < at("pixie-puff").x && at("pixie-puff").x < at("moon-fern").x, "quick, slow, perennial, left to right");
  assert.ok(at("midnight-rose").y > at("glass-lily").y && at("midnight-rose").x > at("glass-lily").x && at("midnight-rose").x < at("phoenix-daisy").x, "the crown sits between the two branch tops");
  assert.ok(spots.every(spot => spot.x >= 350 && spot.x <= 654 && spot.y >= 50 && spot.y <= 470), "everything inside the middle of the room's drawing");
  assert.equal(new Set(spots.map(spot => spot.x + "," + spot.y)).size, spots.length, "no two flowers on the same spot");
  assert.equal(T.move("seeds", garden(), "moondaisy", "down"), "pixie-puff", "down from the root is the middle branch");
  assert.equal(T.move("seeds", garden(), "pixie-puff", "left"), "glowbell");
  assert.equal(T.move("seeds", garden(), "glowbell", "down"), "dewdrop-star");
  assert.equal(T.move("seeds", garden(), "moondaisy", "up"), "moondaisy", "nothing above the root: the cursor stays");
});

test("a flower is unlocked, open, waiting or locked, and Enter says or does the right thing", () => {
  const view = garden(["moondaisy"], { given: 45 });
  const of = id => view.flowers.find(flower => flower.id === id);
  assert.deepEqual(["moondaisy", "glowbell", "pixie-puff", "moon-fern", "dewdrop-star"].map(id => T.state(view, of(id), 1)), ["unlocked", "open", "waiting", "waiting", "locked"]);
  assert.deepEqual(page("seeds", view, "glowbell").choice, { send: { action: "unlock", item: "glowbell" }, name: "Unlock Glowbell" });
  const glow = page("seeds", view, "glowbell");
  assert.deepEqual([glow.rows[0].send, glow.rows[0].url, glow.rows[0].icon], [{ action: "unlock", item: "glowbell" }, "garden", "✧"]);
  assert.match(glow.rows[0].name, new RegExp(`Unlock Glowbell \\(${itemSgc(of("glowbell").coins)} SGC\\)`)); // a seed is an item: 25 native -> 25 SGC
  assert.match(page("seeds", view, "pixie-puff").choice.say, /given 50 starpowder \(45 so far\)/);
  assert.match(page("seeds", view, "dewdrop-star").choice.say, /^Dewdrop Star grows from Glowbell: unlock it first\.$/);
  assert.match(page("seeds", garden(), "midnight-rose").choice.say, /grows from Glass Lily or Phoenix Daisy: unlock one of them first/);
  const daisy = page("seeds", view, "moondaisy");                      // an unlocked flower: Enter makes it the seed and goes back to the plots
  assert.deepEqual(daisy.choice, { change: { seed: "moondaisy", drawer: null } });
  daisy.rows[0].local();
  assert.deepEqual(daisy.went, [{ seed: "moondaisy", drawer: null }]);
  assert.match(page("seeds", garden(LADDER(13), { given: 10 ** 6 }), "nebula-rose").rows[0].name, /starpowder\)$/, "a boutique flower is priced in starpowder");
});

test("the flower page's words: the tree at a glance, the flower, how it grows, and what it grows from", () => {
  const view = garden(["moondaisy", "glowbell", "dewdrop-star", "candy-spike", "sugar-trumpet"], { given: 10 ** 6 });
  const sun = page("seeds", view, "little-sun").lines;
  assert.match(sun[0], /^Flower tree · 5 of 42 unlocked/);
  assert.equal(sun[1], "Slow giants: Little Sun");
  assert.match(sun[2], /1 h 15 · 349 powder · plant again/);
  assert.equal(sun[3], `Ready to unlock: ${itemSgc(70)} SGC`);  // LumiBot: 70 native -> 70 SGC (an item)
  assert.equal(sun[4], "Grows from Moon Mushroom or ✓ Sugar Trumpet", "the bridge it can be had through is ticked");
  assert.match(page("seeds", view, "moon-fern").lines[2], /grows back/);
  assert.equal(page("seeds", view, "moondaisy").lines[3], "Unlocked, and the seed Enter plants");
  assert.equal(T.first("seeds", view, "glowbell"), "glowbell", "the page opens on the chosen seed");
  assert.equal(T.first("seeds", garden(), "moondaisy"), "moondaisy");
  assert.equal(T.first("seeds", garden(), "comet-orchid"), "glowbell", "a seed it doesn't have: the first flower it could unlock");
});

test("every page lists its action, hops to the other two pages, and goes back to the garden", () => {
  const seeds = page("seeds", garden(), "glowbell");
  assert.deepEqual(seeds.rows.map(row => row.key), ["act", "page-helpers", "page-moon", "back"]);
  seeds.rows[1].local(); seeds.rows[3].local();
  assert.deepEqual(seeds.went, [{ drawer: "helpers" }, { drawer: null }]);
  assert.deepEqual(page("helpers", garden(), "monk").rows.map(row => row.key), ["act", "page-seeds", "page-moon", "back"]);
  assert.ok(T.isPage("seeds") && T.isPage("helpers") && T.isPage("moon") && !T.isPage("decor") && !T.isPage(null));
});

test("helpers: six frames, Enter levels one up when the starpowder is there", () => {
  const spots = T.spots("helpers", garden());
  assert.deepEqual(spots.map(spot => spot.id), ["fighter", "thief", "monk", "mage", "cleric", "paladin"]);
  assert.equal(T.move("helpers", garden(), "fighter", "right"), "thief");
  assert.equal(T.move("helpers", garden(), "fighter", "down"), "mage");
  const rich = page("helpers", garden(["moondaisy"], { powder: 10 ** 9 }), "monk");
  assert.deepEqual(rich.choice.send, { action: "helper", item: "monk" });
  assert.match(rich.lines[1], /level 2$/);
  assert.match(page("helpers", garden(["moondaisy"], { powder: 0 }), "monk").choice.say, /Trim flowers for more/);
});

test("moonrise: the new garden and each lasting upgrade round the moon, asked twice, and only when the garden is ready", () => {
  const spots = T.spots("moon", garden());
  assert.deepEqual(spots.map(spot => spot.id), ["garden", ...catalog.upgrades.map(thing => thing.id)]);
  assert.ok(spots.every(spot => spot.x >= 350 && spot.x <= 654 && spot.y >= 90 && spot.y <= 440), "the ring fits the page");
  assert.match(page("moon", garden(), "garden").choice.say, /every plot dug and 100K starpowder/);
  const ready = garden(["moondaisy"], { moonrise: { needs: 1, ready: true, count: 2 }, upgrades: catalog.upgrades.map((thing, i) => ({ ...thing, count: i === 1 ? thing.max : 0 })) });
  const go = page("moon", ready, "garden");
  assert.deepEqual(go.choice.send, { action: "moonrise", item: "garden" });
  assert.match(go.choice.confirm, /replants this garden.*Press Enter again/);
  assert.equal(go.rows[0].confirm, true, "the list row asks twice too");
  assert.deepEqual(page("moon", ready, "strong-press").choice.send, { action: "moonrise", item: "strong-press" });
  assert.match(page("moon", ready, catalog.upgrades[1].id).choice.say, /as high as it goes/);
  assert.match(page("moon", ready, "garden").lines[0], /2 so far · this garden is ready/);
});

test("each page draws everything there is to press, with its state, and the cursor where it is", () => {
  const view = garden(["moondaisy", "glowbell"], { given: 60 });
  const tree = Art.scene("seeds", view, { cursor: "dewdrop-star", focused: true, seed: "glowbell", level: 1 });
  assert.equal(clicks(tree).length, catalog.flowers.length);
  assert.ok(clicks(tree).every(name => /^tree:[a-z0-9-]+$/.test(name)));
  assert.match(tree, /data-flower="dewdrop-star" data-state="open"/);
  assert.match(tree, /data-flower="pixie-puff" data-state="open"/);
  assert.match(tree, /data-flower="starpoppy" data-state="locked"/);
  assert.match(tree, /data-seed="glowbell"/);
  assert.match(tree, /data-cursor="dewdrop-star"/);
  assert.equal((tree.match(/data-vine="lit"/g) || []).length, 1, "one vine lit: Moondaisy to Glowbell");
  assert.ok((tree.match(/stroke-dasharray="4 3"/g) || []).length >= 3, "the bridges are dashed");
  assert.doesNotMatch(Art.scene("seeds", view, { cursor: "glowbell", focused: false }), /data-cursor/, "no cursor while the list has the keys");
  const helpers = Art.scene("helpers", view, { cursor: "mage", focused: true });
  assert.deepEqual(clicks(helpers), ["tree:fighter", "tree:thief", "tree:monk", "tree:mage", "tree:cleric", "tree:paladin"]);
  assert.match(helpers, /data-helper="mage" data-level="3"/);
  const moon = Art.scene("moon", garden(["moondaisy"], { given: 25000 }), { cursor: "garden", focused: true });
  assert.equal(clicks(moon).length, 1 + catalog.upgrades.length);
  assert.match(moon, /data-moon="25"/, "a quarter of the way to a moonrise");
  assert.doesNotMatch(Art.scene("helpers", garden(["moondaisy"], { helpers: [{ ...garden().helpers[0], name: "<b>" }, ...garden().helpers.slice(1)] }), { cursor: "fighter" }), /<b>/, "names are escaped");
});

function LADDER(count) { return catalog.flowers.slice(0, count).map(flower => flower.id); } // The first flowers in catalog order (each one's parents come earlier).
