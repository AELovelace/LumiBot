// The Skills tab (skills-ui.js, skills-art.js) and the Collection tab (collection-ui.js), against the server's
// catalogs (battle.json, house.json, closet.json, items.json, garden.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const UI = require("../../public/lumi/lumi-pet/skills-ui.js");
const Art = require("../../public/lumi/lumi-pet/skills-art.js");
const Album = require("../../public/lumi/lumi-pet/collection-ui.js");
const GardenArt = require("../../public/lumi/lumi-pet/garden-art.js");
const data = name => JSON.parse(readFileSync(new URL("../../src/lumi/data/" + name, import.meta.url), "utf8"));
const battle = data("battle.json"), house = data("house.json"), closet = data("closet.json"), items = data("items.json"), garden = data("garden.json");
const rules = { costs: [1, 1, 2, 2, 3, 3, 5, 5], respec: 100, moves: 4 };

function snap(pet = {}, points = 3) {
  return { pet: { level: 5, skills: [], moves: ["pounce", "glow-spark"], decor: [], closet: [], toys: [], mods_owned: [], ...pet }, progress: { points },
    battle: { trees: battle.trees, basics: battle.basics, mods: battle.mods, rules } };
}
const names = svg => [...svg.matchAll(/data-click="([^"]+)"/g)].map(m => m[1]);
const states = svg => Object.fromEntries([...svg.matchAll(/data-skill="([^"]+)" data-state="(\w+)"/g)].map(m => [m[1], m[2]]));

test("all six trees fit on one page, each in its own place and shape", () => {
  const spots = UI.layout(battle);
  assert.equal(spots.length, 48);
  assert.equal(new Set(spots.map(spot => spot.x + "," + spot.y)).size, 48, "No two skills share a place");
  assert.ok(spots.every(spot => spot.x >= 345 && spot.x <= 655 && spot.y >= 60 && spot.y <= 480), "Everything is in the middle of the room, clear of the side panels");
  for (const tree of battle.trees) { // A skill always sits below every skill it needs, so the wires run downwards.
    const here = spots.filter(spot => spot.tree === tree.id);
    for (const spot of here) for (const need of spot.node.needs) assert.ok(here.find(other => other.id === need).y < spot.y, spot.id + " is below " + need);
  }
  assert.equal(new Set(Object.values(UI.COLOURS)).size, 6);
});

test("a skill is learned, ready, short of points, or locked behind what leads to it", () => {
  const fresh = snap();
  const at = id => UI.state(UI.find(battle, id), fresh.pet, fresh.progress, rules);
  assert.deepEqual(["heavy-paw", "tough-fur", "comet-cleave"].map(at), ["ready", "locked", "locked"]);
  const some = snap({ skills: ["heavy-paw", "armor-break"] }, 1);
  const then = id => UI.state(UI.find(battle, id), some.pet, some.progress, rules);
  assert.deepEqual(["heavy-paw", "tough-fur", "brawn", "parry", "ember"].map(then), ["learned", "ready", "short", "locked", "ready"], "Brawn is open but costs 2; Parry waits on the other arm");
  assert.deepEqual(UI.choice(some, "tough-fur"), { send: { action: "learn", item: "tough-fur" }, name: "Tough Fur" });
  assert.match(UI.choice(some, "brawn").say, /costs 2 skill points, and Lumi has 1/);
  assert.match(UI.choice(some, "parry").say, /Parry needs Tough Fur first/);
  assert.match(UI.choice(snap(), "comet-cleave").say, /needs Iron Hide and Whirl Claw first/);
});

test("Enter on a learned move carries it or puts it away, within her four", () => {
  const knows = snap({ skills: ["heavy-paw", "tough-fur", "armor-break"], moves: ["pounce", "glow-spark", "heavy-paw"] });
  assert.deepEqual(UI.choice(knows, "heavy-paw").send, { action: "equip", item: "heavy-paw" });
  assert.deepEqual(UI.choice(knows, "armor-break").send, { action: "equip", item: "armor-break" });
  assert.match(UI.choice(knows, "tough-fur").say, /always at work/);
  const full = snap({ skills: ["heavy-paw", "armor-break", "ember"], moves: ["pounce", "glow-spark", "heavy-paw", "ember"] });
  assert.match(UI.choice(full, "armor-break").say, /carries 4 moves/);
  assert.match(UI.choice(snap({ skills: ["heavy-paw"], moves: ["heavy-paw"] }), "heavy-paw").say, /at least one move/);
});

test("the arrows walk the web, within a tree and across to the next", () => {
  assert.equal(UI.move(battle, "heavy-paw", "down"), "tough-fur", "Down from the root takes an arm");
  assert.equal(UI.move(battle, "tough-fur", "right"), "armor-break");
  assert.equal(UI.move(battle, "armor-break", "down"), "brawn");
  assert.equal(UI.move(battle, "heavy-paw", "up"), "heavy-paw", "Nothing above the top row");
  assert.equal(UI.find(battle, UI.move(battle, "armor-break", "right")).tree, "thief", "Right off the edge of one tree lands in the next");
  assert.equal(UI.find(battle, UI.move(battle, "comet-cleave", "down")).tree, "mage", "And down from the top row of trees reaches the bottom row");
  const reached = new Set(["heavy-paw"]);
  for (let pass = 0; pass < 12; pass++) for (const id of [...reached]) for (const way of ["up", "down", "left", "right"]) reached.add(UI.move(battle, id, way));
  assert.equal(reached.size, 48, "Every skill can be reached with the arrows");
});

test("the list beside the page offers the one thing Enter would do, and the words say what a skill is", () => {
  const went = [];
  const list = UI.rows({ snap: snap({ skills: ["heavy-paw"] }), cursor: "armor-break", go: change => went.push(change) });
  assert.deepEqual(list.map(r => r.key), ["act", "respec", "leave"]);
  assert.deepEqual([list[0].name, list[0].send], ["Learn Armor Break (2 points)", { action: "learn", item: "armor-break" }]);
  assert.ok(list[1].confirm, "Handing every point back asks twice");
  list[2].local();
  assert.deepEqual(went, [{ leave: true }]);
  assert.deepEqual(UI.rows({ snap: snap(), cursor: "comet-cleave", go() {} }).map(r => r.key), ["act", "leave"], "Nothing to hand back yet");
  assert.match(UI.rows({ snap: snap(), cursor: "comet-cleave", go() {} })[0].note, /needs Iron Hide and Whirl Claw/);
  const lines = UI.lines(snap({ skills: ["heavy-paw"] }), "comet-cleave");
  assert.match(lines[0], /3 skill points to spend · level 5 · 1 of 48 skills learned/);
  assert.equal(lines[1], "Fighter: Comet Cleave");
  assert.match(lines[2], /^Move · power \d+ · physical · cuts through armour/);
  assert.match(lines[3], /Costs 5 points · needs Iron Hide and Whirl Claw/);
  assert.match(lines[4], /Carried moves \(2 of 4\): Pounce, Glow Spark/);
  assert.match(UI.describe(battle.trees[0].nodes[1]), /^Passive · \+10% defense$/);
  assert.match(UI.lines(snap({ skills: ["heavy-paw"] }), "tough-fur")[3], /needs ✓ Heavy Paw/);
});

test("the page draws every skill, lights the wires she has walked, and can be pressed", () => {
  const svg = Art.scene(snap({ skills: ["heavy-paw", "armor-break"] }, 1), { cursor: "brawn", focused: true });
  assert.equal(names(svg).length, 48);
  assert.ok(names(svg).includes("skill:starfall"));
  const shown = states(svg);
  assert.deepEqual([shown["heavy-paw"], shown["armor-break"], shown["tough-fur"], shown.brawn, shown.parry], ["learned", "learned", "ready", "short", "locked"]);
  assert.equal((svg.match(/data-wire="lit"/g) || []).length, 1, "One wire is lit: Heavy Paw to Armor Break");
  assert.ok(svg.includes('data-cursor="brawn"') && svg.includes("FIGHTER") && svg.includes("PALADIN") && svg.includes('data-points="1"'));
  assert.ok(!Art.scene(snap(), { cursor: "brawn", focused: false }).includes("data-cursor"));
  assert.equal((svg.match(/<circle [^>]*data-skill/g) || []).length, battle.trees.flatMap(tree => tree.nodes).filter(node => node.kind === "move").length, "Moves are circles; passives are diamonds");
  assert.ok(!/NaN|undefined/.test(svg));
});

// ---- The Collection tab
const AlbumArt = require("../../public/lumi/lumi-pet/collection-art.js");
require("../../public/lumi/lumi-pet/room-styles.js"); // room mode's things draw in the gallery too
function album(pet = {}, mine = {}) {
  const flowers = garden.flowers.map((flower, i) => ({ ...flower, unlocked: i < 2 }));
  return { ...snap(pet), house, closet, catalog: items, garden: { flowers, decor: { owned: mine, placed: {}, spare: {} } }, garden_decor: garden.decor,
    dungeon: { environments: [{ id: "moonlit-shrine", name: "Moonlit Shrine" }] } };
}

test("the collection counts everything there is, by shelf, and what she has of it", () => {
  const shelves = Album.shelves(album());
  assert.deepEqual(shelves.map(shelf => shelf.id), ["home", "finds", "closet", "toys", "mods", "flowers", "garden"]);
  const count = id => shelves.find(shelf => shelf.id === id).items.length;
  const all = house.spots.flatMap(spot => spot.items);
  assert.equal(count("home") + count("finds"), all.length - all.filter(piece => /-none$/.test(piece.id)).length, "Every house object, but for the empty spots");
  assert.equal(count("finds"), all.filter(piece => piece.found).length);
  assert.equal(count("closet"), closet.slots.flatMap(slot => slot.items).length);
  assert.equal(count("toys"), items.toys.length);
  assert.equal(count("mods"), battle.mods.length);
  assert.deepEqual([count("flowers"), count("garden")], [42, 225]);
  const owned = id => shelves.find(shelf => shelf.id === id).items.filter(item => item.owned).length;
  assert.equal(owned("home"), house.spots.filter(spot => spot.items.length && !/-none$/.test(spot.items[0].id) && !spot.items[0].worn).length, "A new Lumi has only what came with the house: the view outside (she has just moved in)");
  assert.deepEqual([owned("finds"), owned("closet"), owned("mods"), owned("flowers"), owned("garden")], [0, 0, 0, 2, 0]);
  assert.equal(owned("toys"), items.toys.filter(toy => !toy.price && !toy.rarity).length);
  const totals = Album.totals(shelves);
  assert.equal(totals.total, shelves.reduce((sum, shelf) => sum + shelf.items.length, 0));
  assert.ok(shelves.every(shelf => shelf.items.every(item => item.art && item.from && item.name)), "Every thing has a picture, a name and where it comes from");
});

test("the gallery shows a page of a shelf, and the arrows move over it and turn the page", () => {
  const view = album();
  const seen = Album.view(view, { shelf: "garden", page: 0, cursor: 0 });
  assert.deepEqual([seen.shelf.id, seen.pages, seen.cells.length, seen.item.id], ["garden", 7, 36, "fence-0-snowy"]);
  assert.deepEqual(Album.view(view, { shelf: "no-such", page: 99, cursor: 99 }).shelf.id, "home", "Anything out of range is brought back in");
  const last = Album.view(view, { shelf: "garden", page: 6, cursor: 99 });
  assert.deepEqual([last.cells.length, last.cursor], [225 - 6 * 36, 225 - 6 * 36 - 1]);
  assert.deepEqual(Album.move(seen, "right"), { page: 0, cursor: 1 });
  assert.deepEqual(Album.move(seen, "down"), { page: 0, cursor: 6 });
  assert.deepEqual(Album.move(seen, "left"), { page: 0, cursor: 0 }, "Nothing before the first page");
  assert.deepEqual(Album.move(seen, "up"), { page: 0, cursor: 0 });
  assert.deepEqual(Album.move(Album.view(view, { shelf: "garden", page: 0, cursor: 11 }), "right"), { page: 1, cursor: 6 }, "Off the right edge is the next page, on the same row");
  assert.deepEqual(Album.move(Album.view(view, { shelf: "garden", page: 1, cursor: 12 }), "left"), { page: 0, cursor: 17 }, "And off the left edge is the page before");
  assert.deepEqual(Album.move(last, "right"), { page: 6, cursor: last.cursor }, "Nothing after the last picture");
  assert.deepEqual(Album.move(Album.view(view, { shelf: "garden", page: 6, cursor: 3 }), "down"), { page: 6, cursor: 8 }, "Down into a short last row lands on its last picture");
});

test("the list and the words beside the gallery", () => {
  const went = [], first = house.spots[0].items.find(piece => piece.rarity);
  const view = album({ decor: [first.id] }, { "fence-1-starry": 2 });
  const list = Album.rows({ snap: view, at: { shelf: "garden", page: 0, cursor: 0 }, zoom: false, go: change => went.push(change) });
  assert.deepEqual(list.map(r => r.key), ["look", "shelf-home", "shelf-finds", "shelf-closet", "shelf-toys", "shelf-mods", "shelf-flowers", "shelf-garden", "page-next", "page-prev", "leave"]);
  assert.ok(list.every(r => !r.send), "An album: nothing in it can be bought or changed");
  assert.match(list[0].name, /Look at Snowy picket fence/);
  assert.match(list.find(r => r.key === "shelf-flowers").hint, /^2 of 42/);
  assert.equal(list.find(r => r.key === "shelf-garden").icon, "▸", "The open shelf is marked");
  list[0].local(); list.find(r => r.key === "shelf-toys").local(); list.find(r => r.key === "page-next").local(); list.find(r => r.key === "page-prev").local(); list.at(-1).local();
  assert.deepEqual(went, [{ zoom: true }, { shelf: "toys" }, { page: 1 }, { page: 6 }, { leave: true }]);
  assert.ok(!Album.rows({ snap: view, at: { shelf: "mods" }, zoom: false, go() {} }).some(r => r.key === "page-next"), "A shelf of one page has no page rows");
  assert.equal(Album.rows({ snap: view, at: { shelf: "mods" }, zoom: true, go() {} })[0].name, "Back to the shelf");
  const words = Album.lines(Album.view(view, { shelf: "garden", page: 0, cursor: 5 + 36 * 0 }));
  assert.match(words[0], /^Collected \d+ of \d+ · \d+% of everything/);
  assert.match(words[1], /Garden decorations: 1 of 225 · page 1 of 7/);
  const starry = Album.view(view, { shelf: "garden", page: 0, cursor: 9 });
  assert.deepEqual([starry.item.id, Album.lines(starry).slice(2, 4)], ["fence-1-starry", ["Starry bamboo fence ×2", "✓ In Lumi's collection"]]);
  const finds = Album.view(view, { shelf: "finds", page: 0, cursor: 0 });
  assert.ok(finds.shelf.items.some(item => item.from.includes("Moonlit Shrine")), "A find names its place");
  assert.equal(Album.lines(finds)[3], "Not hers yet");
});

test("the gallery draws a picture for every thing, in colour if it is hers", () => {
  const first = house.spots[0].items.find(piece => piece.rarity);
  const view = album({ decor: [first.id] }, { "fence-1-starry": 2 });
  const names = svg => [...svg.matchAll(/data-click="([^"]+)"/g)].map(m => m[1]);
  const page = AlbumArt.scene(view, { shelf: "garden", page: 0, cursor: 9, zoom: false, focused: true });
  assert.deepEqual(names(page).filter(n => n.startsWith("shelf:")), ["home", "finds", "closet", "toys", "mods", "flowers", "garden"].map(id => "shelf:" + id));
  assert.equal(names(page).filter(n => n.startsWith("cell:")).length, 36);
  assert.deepEqual(names(page).filter(n => n.startsWith("page:")), ["page:-1", "page:1"]);
  assert.deepEqual([(page.match(/data-cell="have"/g) || []).length, (page.match(/data-cell="missing"/g) || []).length], [1, 35]);
  assert.ok(page.includes('data-cursor="9"') && page.includes("×2") && page.includes("page 1 of 7") && page.includes('data-shelf="garden"'));
  assert.equal((page.match(/class="lp-unowned"/g) || []).length, 35, "What she doesn't have is drawn without its colours");
  assert.ok(!AlbumArt.scene(view, { shelf: "mods", page: 0, cursor: 0 }).includes("page:1"), "One page: no page arrows");
  const big = AlbumArt.scene(view, { shelf: "garden", page: 0, cursor: 9, zoom: true, focused: true });
  assert.ok(big.includes('data-zoom="fence-1-starry"') && big.includes("STARRY BAMBOO FENCE") && names(big).includes("zoom") && !big.includes("data-cursor"));
  for (const shelf of Album.shelves(view)) { // Every thing on every shelf has a drawing of its own, from the file that draws it in the game.
    for (const item of shelf.items) {
      const one = AlbumArt.picture(item, view, 0, 0, 40);
      assert.ok(one.length > 30 && !/NaN|undefined/.test(one), shelf.id + ": " + item.id);
      if (item.art.kind !== "glyph") assert.ok(one.includes('data-thumb="' + item.id + '"'), shelf.id + ": " + item.id + " has no drawing");
    }
  }
  const frames = [...AlbumArt.scene(view, { shelf: "flowers", page: 0, cursor: 0 }).matchAll(/data-thumb="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(frames.slice(0, 2), ["moondaisy", "glowbell"]);
  assert.ok(GardenArt.piece("edging", "edging-0-snowy", garden.decor).includes("data-plot") && GardenArt.piece("press", "press-0-golden", garden.decor).includes("data-press"));
  assert.equal(GardenArt.piece("fence", "no-such", garden.decor), "");
});
