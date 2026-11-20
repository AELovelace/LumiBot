// The Stardust Garden's lists and words (garden-ui.js) and its art (garden-art.js), against the server's catalog
// (garden.json) and a garden shaped the way mnemerynne/lumigarden.py view() describes one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../../public/lumi/lumi-tuning.js");                     // LumiBot: LumiPrice/LumiPayout on globalThis (default scales: play 0.2, items 1)
const UI = require("../../public/lumi/lumi-pet/garden-ui.js");
const Art = require("../../public/lumi/lumi-pet/garden-art.js");
const catalog = JSON.parse(readFileSync(new URL("../../src/lumi/data/garden.json", import.meta.url), "utf8"));
const MIN = 60000;
const itemSgc = native => Math.max(1, Math.round(native * 1));    // a nursery price by the rule: erinne's price x the default item scale 1

function garden(extra = {}) { // A young garden: a daisy growing, a daisy ready, two empty plots; glowbell is next on the tree.
  const plot = (flower, stage, ready_in, grow) => ({ flower, last: flower, stage, ready_in, grow });
  return { at: 0, gardens: 1, plot_price: 25, given: 12, powder: 120, squeezed: 10, price: 40, coins_today: 3, band: 100, away: null, max_rate: 12,
    plots: [plot("moondaisy", "growing", MIN, 2 * MIN), plot("moondaisy", "ready", -5000, 2 * MIN), plot(null, "empty", 0, 0), plot(null, "empty", 0, 0)],
    flowers: catalog.flowers.map((flower, i) => ({ ...flower, unlocked: i === 0, next: i === 1, powder_now: flower.powder, minutes_now: flower.minutes })),
    rates: { tap: 3, lucky: 0.03, lucky_by: 5, idle: 0, double: 1, growth: 1, fresh: 2, kept: 0.5, yield: 1, gift: 0.03, away_hours: 8 },
    helpers: catalog.helpers.map(helper => ({ id: helper.id, name: helper.name, about: helper.about, level: 0, cost: helper.cost })),
    moves: [{ id: "pounce", move: "Pounce", tree: "fighter", name: "Frenzy", about: "presses count for much more", strength: 0.5, ready_in: 0 }],
    effects: {}, water: { ready_in: 0, rounds: 8, share: 5, show: null }, feed: { ready_in: 0, seconds: 10, per: 10, max: 10, until_in: null },
    decor: { placed: {}, owned: {}, spare: {} }, upgrades: catalog.upgrades.map(thing => ({ ...thing, count: 0 })),
    moonrise: { needs: 100000, ready: false, count: 0 }, ...extra };
}
function open(view, ctx = {}) {
  const went = [];
  const rows = UI.rows({ garden: view, decor: catalog.decor, drawer: null, seed: null, cursor: 0, mini: null, passed: 0, pending: 0, level: 1, go: change => went.push(change), ...ctx });
  return { rows, went, row: key => rows.find(r => r.key === key) };
}
const names = svg => [...svg.matchAll(/data-click="([^"]+)"/g)].map(m => m[1]);

test("numbers stay short however big they get", () => {
  assert.deepEqual([0, 7, 7.25, 12.9, 950, 1000, 1234, 99949, 123456, 999960, 3.4e6, 5.6e9, 7.8e12, 1.2e15, 3e18, 1e93].map(UI.format),
    ["0", "7", "7.3", "12", "950", "1.0K", "1.2K", "99.9K", "123K", "1.0M", "3.4M", "5.6B", "7.8T", "1.2aa", "3.0ab", "1.0ba"]);
  assert.deepEqual([0, 999, 65000, 7380000, -5].map(UI.clock), ["0:00", "0:01", "1:05", "2:03:00", "0:00"]);
  assert.deepEqual([2, 60, 90, 720].map(UI.span), ["2 min", "1 h", "1 h 30", "12 h"]);
});

test("the garden's list offers the press, the harvest, both minigames, her moves, and the drawers", () => {
  const list = open(garden());
  assert.deepEqual(list.rows.map(r => r.key), ["press", "trim-all", "seeds", "dig", "water", "feed", "move-pounce", "helpers", "decor", "moon", "leave"]);
  // The plot under the cursor can be dug up (the only way to replace a perennial): asked twice, and it says what becomes of the powder.
  assert.deepEqual([list.row("dig").send, list.row("dig").confirm, list.row("dig").url], [{ action: "dig", plot: 0 }, true, "garden"]);
  assert.match(list.row("dig").name + list.row("dig").hint, /Dig up plot 1: Moondaisy.*Still growing: its powder is lost/);
  assert.match(open(garden(), { cursor: 1 }).row("dig").hint, /gives its powder first/);
  assert.equal(open(garden(), { cursor: 2 }).row("dig"), undefined, "Nothing to dig in an empty plot");
  assert.equal(open(garden(), { cursor: 4 }).row("dig"), undefined, "Nor on the patch for a new plot");
  assert.match(UI.said({ action: "dig", plot: 1 }, { dug: "Moondaisy", trimmed: 1, powder: 6, gift: null }, garden()), /Dug up: Moondaisy\. It was ready, so it gave its 6 starpowder first\..*plot is empty/);
  assert.equal(UI.said({ action: "dig", plot: 0 }, { dug: "Moondaisy" }, garden()), "Dug up: Moondaisy. The plot is empty: Enter plants the chosen seed.");
  list.row("press").local();
  list.row("seeds").local();
  list.row("leave").local();
  assert.deepEqual(list.went, [{ press: 1 }, { drawer: "seeds" }, { leave: true }]);
  assert.deepEqual(list.row("trim-all").send, { action: "trim_all" });
  assert.match(list.row("trim-all").name, /\(1\)/);
  assert.deepEqual(list.row("water").send, { action: "water_start" });
  assert.deepEqual(list.row("feed").send, { action: "feed_start" });
  assert.deepEqual(list.row("move-pounce").send, { action: "ability", item: "pounce" });
  assert.ok(list.rows.filter(r => r.send).every(r => r.url === "garden"), "Every choice goes to the garden's own address");
  assert.match(list.row("moon").hint, /100K/, "Moonrise says what it is waiting for");
  list.row("moon").local();                                          // and its page opens anyway, to see what a moonrise can bring
  assert.deepEqual(list.went.at(-1), { drawer: "moon" });
  const cooling = open(garden({ water: { ready_in: 90000, rounds: 8, share: 5, show: null }, moves: [{ ...garden().moves[0], ready_in: 30000 }] }), { passed: 10000 });
  assert.equal(cooling.row("water").send, undefined);
  assert.equal(cooling.row("water").hint, "ready in 1:20");
  assert.equal(cooling.row("move-pounce").hint, "ready in 0:20");
  assert.equal(open(garden(), { passed: 61000 }).row("trim-all").name, "Harvest everything ready (2)", "A flower that finished since the server spoke counts as ready");
  const two = open(garden({ gardens: 2, moonrise: { needs: 1, ready: true, count: 1 } }));
  assert.deepEqual(two.row("other").send, { action: "garden", count: 1 });
  two.row("moon").local();
  assert.deepEqual(two.went, [{ drawer: "moon" }]);
});

test("decorations: fifteen slots, the capsule, and a store of spares to put out or sell", () => {
  const mine = { placed: { fence: "fence-0-snowy" }, owned: { "fence-0-snowy": 1, "fence-1-starry": 2, "statue-0-rosy": 1 }, spare: { "fence-0-snowy": 0, "fence-1-starry": 2, "statue-0-rosy": 0 } };
  const top = open(garden({ decor: mine, powder: 5000 }), { drawer: "decor" });
  assert.deepEqual(top.rows.map(r => r.key), ["back", "capsule", "store"].concat(catalog.decor.slots.map(slot => "slot-" + slot.id)));
  assert.deepEqual(top.row("capsule").send, { action: "capsule" });
  assert.equal(open(garden({ decor: mine, powder: 10 }), { drawer: "decor" }).row("capsule").send, undefined, "No capsule without the powder for it");
  assert.match(top.row("slot-fence").hint, /Snowy picket fence/);
  assert.match(top.row("slot-arch").hint, /Nothing out · 15 to collect/);
  top.row("slot-fence").local();
  top.row("store").local();
  assert.deepEqual(top.went, [{ drawer: "decor:fence" }, { drawer: "store" }]);

  const fence = open(garden({ decor: mine }), { drawer: "decor:fence" });
  assert.equal(fence.rows.length, 16);
  fence.row("back").local();
  assert.deepEqual(fence.went, [{ drawer: "decor" }], "Back from a slot returns to the slots, not all the way out");
  assert.deepEqual([fence.row("decor-fence-0-snowy").icon, fence.row("decor-fence-0-snowy").send], ["✓", { action: "decor_place", item: "fence-0-snowy" }]);      // out here: Enter puts it away
  assert.match(fence.row("decor-fence-1-starry").hint, /2 in the store · Enter puts one out here/);
  assert.deepEqual(fence.row("decor-fence-0-rosy").send, { action: "decor_buy", item: "fence-0-rosy" });
  assert.match(fence.row("decor-fence-0-rosy").hint, /^360 starpowder/);
  assert.equal(fence.row("decor-fence-2-royal").send, undefined);
  assert.match(fence.row("decor-fence-2-royal").hint, /Legendary · only from the Seedling Capsule/);
  const statue = open(garden({ decor: { ...mine, placed: {} } }), { drawer: "decor:statue" });       // hers stands in another garden
  assert.match(statue.row("decor-statue-0-rosy").hint, /yours is in another garden: Enter buys one for here/);

  const store = open(garden({ decor: mine }), { drawer: "store" });
  assert.deepEqual(store.rows.map(r => r.key), ["back", "sell-fence-1-starry"]);
  assert.deepEqual([store.row("sell-fence-1-starry").send, store.row("sell-fence-1-starry").confirm], [{ action: "decor_sell", item: "fence-1-starry" }, true]);
  assert.match(store.row("sell-fence-1-starry").name, /×2/);
  assert.match(store.row("sell-fence-1-starry").hint, /sells one for 1\.2K starpowder/);
  assert.deepEqual(open(garden(), { drawer: "store" }).rows.map(r => r.key), ["back", "empty"]);
  const view = garden();
  assert.match(UI.said({ action: "capsule" }, { capsule: "fence-1-starry", rarity: "epic", copies: 2, paid: 600 }, view, null, catalog.decor), /Starry bamboo fence! \(epic\) That makes 2: the spare is in the store/);
  assert.match(UI.said({ action: "decor_sell", item: "fence-1-starry" }, { sold: "fence-1-starry", powder: 1200 }, view, null, catalog.decor), /Sold: Starry bamboo fence, for 1\.2K starpowder/);
  assert.match(UI.said({ action: "decor_place", item: "fence-0-snowy" }, { stored: "fence-0-snowy" }, view, null, catalog.decor), /Snowy picket fence goes back in the store/);
});

test("Enter on a plot plants, trims, digs or says how long is left", () => {
  const view = garden();
  assert.deepEqual(UI.plotChoice(view, 2, null, 0), { send: { action: "plant", plot: 2, item: "moondaisy" } });
  assert.deepEqual(UI.plotChoice(view, 1, null, 0), { send: { action: "trim", plot: 1 } });
  assert.equal(UI.plotChoice(view, 0, null, 0).say, "Moondaisy: ready in 1:00.");
  assert.deepEqual(UI.plotChoice(view, 0, null, 60000), { send: { action: "trim", plot: 0 } }, "Ready by this page's own clock");
  assert.deepEqual(UI.plotChoice(view, 4, null, 0).send, { action: "plot" });
  assert.equal(UI.plotChoice(view, 4, null, 0).confirm, `Dig a new plot for ${itemSgc(view.plot_price)} SGC?`); // LumiBot: 25 native -> 25 SGC (an item)
  const more = garden();
  more.flowers[1].unlocked = true;
  assert.equal(UI.seedFor(more, more.plots[2], null), "glowbell", "With nothing chosen and nothing grown there, the best flower unlocked");
  assert.equal(UI.seedFor(more, more.plots[0], null), "moondaisy", "A plot remembers what grew in it");
  assert.equal(UI.seedFor(more, more.plots[0], "glowbell"), "glowbell");
  assert.equal(UI.seedFor(view, null, "comet-orchid"), "moondaisy", "A seed this garden hasn't unlocked is never planted");
  assert.equal(UI.cells(view), 5);
  assert.equal(UI.cells(garden({ plot_price: null })), 4);
  assert.deepEqual(["right", "down", "left", "up"].map(way => UI.moveCursor(0, way, 5)), [1, 4, 0, 0]);
  assert.equal(UI.moveCursor(3, "right", 5), 3, "The grid's edge is an edge");
});

test("the status lines and the words for what happened", () => {
  const lines = UI.status(garden(), 1, null, 0, 2);
  assert.match(lines[0], /Garden 1 · 4 plots · 1 ready to trim/);
  assert.match(lines[1], /Plot 2: Moondaisy · ready! Enter trims/);
  assert.match(lines[2], /Starpowder waiting: 114/, "Presses not yet sent already count on the page");
  assert.match(lines[3], /10 of 40 squeezed · 3 press coins today \(each 100 costs double\) · 5 make 1 SGC/); // LumiBot wording
  assert.match(UI.status(garden({ effects: { frenzy: 30000 } }), 0, null, 10000, 0).pop(), /Frenzy 0:20/);
  const view = garden();
  assert.equal(UI.said({ action: "plant", plot: 0, item: "moondaisy" }, { planted: "moondaisy" }, view), "Planted: Moondaisy. Ready in 2 min.");
  assert.equal(UI.said({ action: "trim", plot: 0 }, { trimmed: 1, powder: 6, gift: null }, view), "Snip! One flower trimmed: +6 starpowder.");
  assert.match(UI.said({ action: "trim_all" }, { trimmed: 3, powder: 1500, gift: { kind: "snack", item: "banana" } }, view, id => "Banana"), /3 flowers trimmed: \+1\.5K starpowder\. And a snack for the pantry: Banana!/);
  assert.match(UI.said({ action: "trim" }, { trimmed: 1, powder: 6, gift: { kind: "token", coins: 150 } }, view), /150 SGC/);                     // LumiBot: the server says SGC paid
  assert.equal(UI.said({ action: "press" }, { pressed: 5, lucky: 0, powder: 15, coins: 0 }, view), "", "A press that made no coin says nothing");
  assert.equal(UI.said({ action: "press" }, { pressed: 5, lucky: 2, powder: 15, coins: 2 }, view), "Lucky squeeze! +2 SGC.");
  assert.match(UI.said({ action: "water_answer" }, { water: "done", rounds: 2, moved: 1, right: false }, view), /a slip\. 2 rounds of water/);
  assert.match(UI.said({ action: "feed_end" }, { feed: "done", presses: 34, minutes: 3, moved: 2 }, view), /34 presses: every growing flower is 3 minutes further on/);
  assert.match(UI.said({ action: "helper", item: "monk" }, { helper: "monk", level: 2 }, view), /Monk's patience is now level 2/);
  assert.match(UI.away({ away: { ms: 3600000, powder: 1800, coins: 45 } }), /squeezed 1\.8K starpowder and paid you 45 SGC/); // LumiBot wording
  assert.match(UI.said({ action: "press" }, { pressed: 5, lucky: 0, powder: 15, coins: 0, made: 3, capped: true }, view), /today's garden SGC limit/); // LumiBot: the cap is said
  assert.match(UI.said({ action: "press" }, { pressed: 5, lucky: 0, powder: 15, coins: 0, made: 9, owed: 1 }, view), /Lumi-Town Bank is closed/); // LumiBot: owed is said
  assert.equal(UI.away(garden()), "");
});

test("a minigame takes over the list", () => {
  const water = open(garden(), { mini: { kind: "water", show: [1, 2], phase: "answer", answer: [] } });
  assert.deepEqual(water.rows.map(r => r.key), ["watering"]);
  assert.match(water.rows[0].hint, /Round 2 of 8/);
  const feed = open(garden(), { mini: { kind: "feed", count: 7, left: 4000, whole: 10000 } });
  feed.rows[0].local();
  assert.deepEqual(feed.went, [{ feed: 1 }]);
  assert.match(feed.rows[0].name, /7 presses/);
});

test("every plot can be pressed, shows its stage, and has a timer under its flower", () => {
  const view = garden();
  const svg = Art.scene(view, { cursor: 1, focused: true, passed: 0, mini: null, decor: catalog.decor });
  assert.deepEqual(names(svg), ["press", "plot:0", "plot:1", "plot:2", "plot:3", "plot:4"]);
  assert.deepEqual([...svg.matchAll(/data-plot="(\w+)"/g)].map(m => m[1]), ["growing", "ready", "empty", "empty"]);
  assert.ok(svg.includes('data-cursor="1"') && svg.includes(`>${itemSgc(view.plot_price)} SGC</text>`) && svg.includes('data-near="25"')); // the plot's whole SGC price
  assert.ok(!Art.scene(view, { cursor: 1, focused: false, passed: 0 }).includes("data-cursor"));
  assert.deepEqual([...svg.matchAll(/data-timer="(\d+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]]), [["0", "1:00"], ["1", "ready ✦"]], "A countdown while it grows, and a word once it is ready");
  assert.deepEqual(Art.timers(view, 15000), [[0, "0:45"]], "Only growing flowers tick");
  assert.deepEqual(Art.timers(view, 61000), []);
  const later = Art.scene(view, { cursor: 0, focused: false, passed: 61000 });
  assert.deepEqual([...later.matchAll(/data-plot="(\w+)"/g)].map(m => m[1]).slice(0, 2), ["ready", "ready"]);
  const full = garden({ plot_price: null, plots: Array.from({ length: 16 }, (_, i) => ({ flower: catalog.flowers[i].id, last: null, stage: ["growing", "ready", "overgrown"][i % 3], ready_in: i % 3 ? -1 : 30000, grow: 60000 })) });
  assert.equal(names(Art.scene(full, { cursor: 15, focused: true })).length, 17);
  assert.ok(Art.spot(0).x < Art.spot(1).x && Art.spot(0).y < Art.spot(4).y && Art.PRESS.y < Art.spot(0).y, "Lumi has somewhere to stand beside every plot, and by the press");
});

test("all forty-two flowers are drawn, and no two look alike", () => {
  assert.equal(catalog.flowers.length, 42);
  assert.deepEqual([...new Set(catalog.flowers.map(flower => flower.shape))].sort(), [...Art.SHAPES].sort(), "garden-art.js draws exactly the shapes the catalog uses");
  const heads = catalog.flowers.map(flower => Art.head(flower, 100, 100, 1));
  assert.ok(heads.every(svg => svg.length > 40 && !/NaN|undefined/.test(svg)));
  assert.equal(new Set(heads).size, 42, "Every flower's head is its own drawing");
  for (const flower of catalog.flowers) { // And each is itself at every stage, in its own colour.
    const one = stage => Art.scene(garden({ plots: [{ flower: flower.id, last: null, stage, ready_in: stage === "growing" ? 20000 : -1, grow: 60000 }] }), { cursor: 0 });
    assert.ok(one("ready").includes(flower.colour) && one("growing").includes(flower.colour) && one("overgrown").includes(flower.colour), flower.id);
    assert.notEqual(one("ready"), one("overgrown"), flower.id + " droops when overgrown");
  }
  const sprout = Art.scene(garden({ plots: [{ flower: "moondaisy", last: null, stage: "growing", ready_in: 110000, grow: 120000 }] }), { cursor: 0 });
  assert.ok(!sprout.includes("rotate(36 "), "A new sprout is two leaves, not yet a flower");
});

test("every decoration is drawn, in two layers round the beds", () => {
  assert.deepEqual(catalog.decor.slots.map(slot => slot.id).sort(), [...Art.DECOR].sort(), "garden-art.js draws exactly the catalog's slots");
  const bare = Art.scene(garden(), { cursor: 0, decor: catalog.decor });
  const seen = new Set([bare]);
  for (const slot of catalog.decor.slots) {
    for (const item of slot.items) {
      const svg = Art.scene(garden({ decor: { placed: { [slot.id]: item.id }, owned: {}, spare: {} } }), { cursor: 0, decor: catalog.decor });
      assert.ok(!/NaN|undefined/.test(svg), item.id);
      assert.ok(!seen.has(svg), item.id + " looks different from everything before it");
      seen.add(svg);
    }
  }
  assert.equal(seen.size, 226, "All 225 decorations, and the bare garden");
  assert.equal(Art.scene(garden({ decor: { placed: { fence: "no-such-thing" }, owned: {}, spare: {} } }), { cursor: 0, decor: catalog.decor }), bare, "Something since retired is simply not drawn");
});

test("the sky is left open for the theme's scenery, or painted when there is none", () => {
  const open_ = Art.scene(garden(), { cursor: 0, sky: true }), painted = Art.scene(garden(), { cursor: 0, sky: false });
  assert.ok(open_.includes('data-sky="open"') && painted.includes('data-sky="painted"'));
  assert.ok(painted.includes("#15102e") && !open_.includes("#15102e"), "Only the painted sky covers what is behind the page");
});

test("the watering cans and the fertilizer button can be pressed only when it is time", () => {
  const view = garden();
  const showing = Art.scene(view, { cursor: 0, mini: { kind: "water", show: [2, 0], phase: "show", answer: [], lit: 2 } });
  assert.ok(showing.includes("WATCH THE CANS") && showing.includes('data-can="lit"'));
  assert.deepEqual(names(showing), [], "Nothing can be pressed while the cans are showing");
  const answering = Art.scene(view, { cursor: 0, mini: { kind: "water", show: [2, 0], phase: "answer", answer: [2], lit: -1 } });
  assert.deepEqual(names(answering), ["can:0", "can:1", "can:2", "can:3"]);
  assert.ok(answering.includes("YOUR TURN · 1 OF 2"));
  const feeding = Art.scene(view, { cursor: 0, mini: { kind: "feed", count: 12, left: 5000, whole: 10000 } });
  assert.deepEqual(names(feeding), ["feed"]);
  assert.ok(feeding.includes(">12<"));
});
