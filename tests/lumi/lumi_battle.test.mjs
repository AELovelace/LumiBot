// The Battle tab's lists (battle-ui.js) and the enemy art (enemies.js), against the server's catalog (battle.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../../public/lumi/lumi-tuning.js"); // LumiBot: window.LumiPrice / LumiPayout at the default scales (play 0.2, items 1), as every page has them
const UI = require("../../public/lumi/lumi-pet/battle-ui.js");
const Art = require("../../public/lumi/lumi-pet/enemies.js");
const catalog = JSON.parse(readFileSync(new URL("../../src/lumi/data/battle.json", import.meta.url), "utf8"));
const STATS = ["hp", "attack", "defense", "magic", "ward", "speed", "mp"];
const rules = { costs: [1, 1, 2, 2, 3, 3, 5, 5], respec: 100, potion: 20, potion_cap: 10, heal: 50, moves: 4, max_level: 50,
  tiers: ["common", "uncommon", "rare", "epic", "legendary"], glows: { rose: "fire" }, kit_cap: 9, stat_reset: 100, points_per_level: 7,
  stat_keys: STATS, stat_names: { hp: "Health", attack: "Attack", defense: "Defense", magic: "Magic", ward: "Ward", speed: "Speed", mp: "MP" },
  kit: { ether: { name: "Mana potion", icon: "💧", price: 25, about: "Gives back half her MP" }, "x-attack": { name: "X-Attack", icon: "⚔", price: 30, about: "Attack and magic up a stage" },
    "x-defend": { name: "X-Defend", icon: "⛨", price: 30, about: "Defense and ward up a stage" }, "x-speed": { name: "X-Speed", icon: "➶", price: 30, about: "Speed up a stage" } } };
const itemSgc = native => Math.max(1, Math.round(native * 1));       // the Outfitters sell items: erinne's price x the default item scale 1
const slots = [["cybertek", 10], ["magitek", 15], ["cybertek", 25], ["magitek", 35], ["cybertek", 45]];

function snapshot(pet = {}, fight = null, extra = {}) { // What the server would send, for a pet in a given state.
  const full = { level: 1, exp: 0, skills: [], moves: ["pounce", "glow-spark"], mods: [null, null, null, null, null], mods_owned: [], potions: 0, faint_until: 0, wins: 0, losses: 0, ...pet };
  const placed = Object.fromEntries(STATS.map(key => [key, 0]));
  return { pet: full, fight, battle: { basics: catalog.basics, trees: catalog.trees, mods: catalog.mods, rules },
    progress: { points: full.level - 1, slots: slots.map(([tek, opens], i) => ({ tek, opens, open: full.level >= opens, mod: full.mods[i] })),
      stats: { hp: 58, attack: 12, defense: 9, magic: 12, ward: 9, speed: 11, mp: 22 }, kit: { ether: 0, "x-attack": 0, "x-defend": 0, "x-speed": 0, ...(extra.kit || {}) },
      stat_points: { left: 7 * (full.level - 1), placed, cap: 3 * (full.level - 1), auto: false, free_reset: false, per_point: { hp: 4, attack: 1, defense: 0.75, magic: 1, ward: 0.75, speed: 0.5, mp: 1 },
        leans: ["attack", "hp", "speed"], ...(extra.points || {}) } } };
}
function open(snap, view = null, finished = null) { // The rows for one list, and where its local rows would lead.
  const went = [];
  const rows = UI.rows({ snap, view, finished, now: 1000, countdown: ms => Math.ceil(ms / 1000) + "s", go: (...to) => went.push(to) });
  return { rows, went, row: key => rows.find(r => r.key === key) };
}

test("every enemy has a body the art can draw, and every body is used", () => {
  const used = new Set(catalog.enemies.map(enemy => enemy.body));
  assert.deepEqual([...used].sort(), Object.keys(Art.BODIES).sort());
  for (const enemy of catalog.enemies) {
    const art = Art.draw(enemy.body, enemy.colour);
    assert.ok(art.includes(enemy.colour) && art.length > 200 && !/NaN|undefined/.test(art), enemy.id);
  }
});

test("an unknown body or a colour that isn't one falls back safely", () => {
  assert.equal(Art.draw("dragon-from-the-future", "#123456"), Art.draw("blob", "#123456"));
  assert.equal(Art.draw("constructor", "#123456"), Art.draw("blob", "#123456"));
  const odd = Art.draw("blob", '"/><script>alert(1)</script>');
  assert.ok(!odd.includes("script") && odd.includes("#999999"));
});

test("the front page offers a fight, skills, moves, mods and potions, and a wake-up only while she naps", () => {
  const front = open(snapshot({ level: 4, wins: 1 }));
  assert.deepEqual(front.rows.map(r => r.key), ["fight", "stats", "skills", "moves", "mods", "potions", "kit"]);
  assert.match(front.row("stats").hint, /^21 points to place$/);
  assert.match(front.row("fight").hint, /Level 4 · 1 win$/);
  assert.deepEqual(front.row("potions").send, { action: "potions", count: 1 });
  const napping = open(snapshot({ faint_until: 61000, skills: ["heavy-paw"] }));
  assert.deepEqual(napping.rows.map(r => r.key), ["heal", "stats", "skills", "moves", "mods", "potions", "kit", "respec"]);
  assert.deepEqual(napping.row("heal").send, { action: "heal" });
  assert.match(napping.row("heal").hint, new RegExp(`^${itemSgc(rules.heal)} SGC · or free in 60s`)); // heal 50 native -> 50 SGC
});

test("choosing an opponent sends only a tier", () => {
  const list = open(snapshot(), "fight");
  assert.deepEqual(list.rows.slice(1).map(r => [r.url, r.send]), ["common", "uncommon", "rare", "epic", "legendary", "gamble"].map(tier => ["battle", { tier }]));
});

test("a tree offers only its next skill, and says why the others can't be chosen", () => {
  const tree = open(snapshot({ level: 9, skills: ["heavy-paw", "tough-fur"] }), "tree:fighter");
  assert.equal(tree.row("heavy-paw").send, undefined);
  assert.match(tree.row("heavy-paw").note, /already knows/);
  assert.deepEqual(tree.row("armor-break").send, { action: "learn", item: "armor-break" });
  assert.match(tree.row("armor-break").hint, /Power 60 · physical · cuts through armour · 2 points/);
  assert.match(tree.row("brawn").note, /Brawn needs Armor Break first/);
  assert.deepEqual(tree.row("parry").send, { action: "learn", item: "parry" }, "A skill on the other arm is open too: Parry only needs Tough Fur");
  assert.match(tree.row("brawn").hint, /\+10% attack · 2 points/);
  assert.equal(tree.rows.length, 9);
});

test("moves list what she knows and toggles what is ready", () => {
  const moves = open(snapshot({ skills: ["ember", "frost-shard", "deep-mind"], moves: ["pounce", "ember"] }), "moves");
  assert.deepEqual(moves.rows.slice(1).map(r => [r.key, r.icon]), [["pounce", "✓"], ["glow-spark", "○"], ["ember", "✓"], ["frost-shard", "○"]]);
  assert.deepEqual(moves.row("frost-shard").send, { action: "equip", item: "frost-shard" });
  assert.match(moves.row("glow-spark").hint, /her glow's element/);
});

test("mod slots open by level and each offers only its own kind", () => {
  const mods = open(snapshot({ level: 16, mods: ["servo-claws", null, null, null, null], mods_owned: ["servo-claws"] }), "mods");
  assert.deepEqual(mods.rows.slice(1).map(r => Boolean(r.local)), [true, true, false, false, false]);
  assert.match(mods.rows[1].hint, /Servo Claws · \+6% attack, \+3% health/);
  assert.match(mods.rows[3].note, /opens at level 25/);
  const magi = open(snapshot({ level: 16 }), "slot:1");
  assert.deepEqual(magi.rows.slice(2).map(r => r.key), catalog.mods.filter(m => m.tek === "magitek").map(m => m.id));
  assert.deepEqual(magi.row("aether-coil").send, { action: "mod", item: "aether-coil", slot: 1 });
  assert.deepEqual(magi.row("empty").send, { action: "mod", slot: 1 });
  const cyber = open(snapshot({ level: 16, mods: ["servo-claws", null, null, null, null], mods_owned: ["servo-claws", "nano-plating"] }), "slot:0");
  assert.match(cyber.row("servo-claws").note, /already fitted/);
  assert.match(cyber.row("nano-plating").hint, /yours$/);
});

test("in a fight the rows are her moves and three standbys, each carrying the turn it was shown for", () => {
  const fight = { id: 7, turn: 3, status: "active", player: { level: 5, hp: 40, hpMax: 90, mp: 3, mpMax: 30, moves: [catalog.basics[0], { ...catalog.trees[3].nodes[0] }] },
    enemy: { name: "Dust Bunny", level: 4, tier: "common", hp: 10, hpMax: 40 } };
  const list = open(snapshot({ potions: 2 }, fight, { kit: { ether: 1, "x-speed": 3 } }), "skills");   // whatever list was open, a fight takes over
  assert.deepEqual(list.rows.map(r => r.key), ["move0", "move1", "defend", "potion", "ether", "x-speed", "run"]);   // fight items she has with her
  assert.deepEqual([list.row("x-speed").name, list.row("x-speed").send.action], ["X-Speed (3)", "x-speed"]);
  assert.ok(list.rows.every(r => r.url === "battle/act" && r.send.battle === 7 && r.send.turn === 3));
  assert.match(list.row("move1").hint, /4 MP · burns · not enough MP/);
  assert.equal(list.row("potion").name, "Potion (2)");
  assert.deepEqual(UI.bars(fight), { lumi: { hp: 44, mp: 10, label: "Lumi · Lv 5 · 40/90 HP · 3 MP" }, foe: { hp: 25, label: "Dust Bunny · Lv 4 · Common · 10/40 HP" } });
});

test("a finished fight shows one row with its reward until it is dismissed", () => {
  const won = open(snapshot(), null, { status: "victory", reward: { exp: 30, coins: 18, level: 2, levels: 1 } });
  assert.deepEqual(won.rows.map(r => [r.key, r.name, r.hint]), [["continue", "Hooray!", "+30 EXP · +18 SGC · level 2!"]]);
  won.rows[0].local();
  assert.deepEqual(won.went, [[null, 0, true]]);
  assert.equal(open(snapshot(), null, { status: "defeat", reward: null }).rows[0].hint, "She'll be up again soon");
});

test("the Stats page places a point at a time, lets Auto place the rest, and takes them back", () => {
  const page = open(snapshot({ level: 3 }, null, { points: { left: 5, placed: { hp: 0, attack: 6, defense: 0, magic: 3, ward: 0, speed: 0, mp: 0 } } }), "stats");
  assert.deepEqual(page.rows.map(r => r.key), ["back", "stat-hp", "stat-attack", "stat-defense", "stat-magic", "stat-ward", "stat-speed", "stat-mp", "stats-auto", "auto-stats", "stats-reset"]);
  assert.deepEqual(page.row("stat-hp").send, { action: "stat", item: "hp", count: 1 });
  assert.match(page.row("stat-attack").note, /as many points as her level allows/);         // 6 of 6 at level 3
  assert.match(page.row("stats-auto").hint, /Leaning on attack, health, speed/);
  assert.deepEqual([page.row("auto-stats").name, page.row("auto-stats").send], ["Auto on level-up: off", { action: "auto_stats" }]);
  assert.match(page.row("stats-reset").hint, new RegExp(`^${itemSgc(rules.stat_reset)} SGC `)); // reset 100 native -> 100 SGC
  const none = open(snapshot({ level: 1 }), "stats");
  assert.match(none.row("stat-hp").note, /No points waiting/);
  assert.equal(none.row("stats-reset"), undefined, "Nothing placed: nothing to take back");
});

test("fight items are bought one at a time, up to nine of each", () => {
  const shop = open(snapshot({}, null, { kit: { ether: 4 } }), "kit");
  assert.deepEqual(shop.rows.slice(1).map(r => r.send), ["ether", "x-attack", "x-defend", "x-speed"].map(item => ({ action: "kit", item, count: 1 })));
  assert.match(shop.row("buy-ether").hint, new RegExp(`^${itemSgc(rules.kit.ether.price)} SGC · .* carrying 4 of 9`)); // ether 25 native -> 25 SGC
});
