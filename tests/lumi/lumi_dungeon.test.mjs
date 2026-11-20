// The Dungeon tab's lists and puzzles (dungeon-ui.js) and the dungeon's art (dungeon-art.js), against the server's
// catalogs (dungeon.json, sokoban.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../../public/lumi/lumi-tuning.js"); // LumiBot: window.LumiPrice / LumiPayout at the default scales (satchel prizes: play 0.2), as every page has them
const UI = require("../../public/lumi/lumi-pet/dungeon-ui.js");
const Art = require("../../public/lumi/lumi-pet/dungeon-art.js");
const data = name => JSON.parse(readFileSync(new URL("../../src/lumi/data/" + name, import.meta.url), "utf8"));
const catalog = data("dungeon.json"), levels = data("sokoban.json").levels;
const bag = { coins: 24, potions: 1, keys: 0, trophies: [], mods: [] };

function run(extra = {}) { // A trip as the server would describe it: Lumi in a room with ways north and east.
  return { id: 9, env: { ...catalog.environments[1], id: "crystal-cavern" }, depth: 2, at: "1,1", over: null, ended: null, facing: null, game: null,
    rooms: { "1,1": { kind: "empty", done: true, exits: ["e", "n"] }, "1,0": { kind: "unknown" }, "2,1": { kind: "vault", done: false, exits: ["w"] } },
    room: { kind: "empty", done: true, exits: ["e", "n"] }, satchel: bag, hp: 30, hpMax: 58, mp: 10, mpMax: 22, say: "", event: { scenario: "empty" }, ...extra };
}
function open(dungeonRun, play = {}, dismissed = null, pet = { potions: 2 }) {
  const went = [];
  const snap = { pet, dungeon: { run: dungeonRun, environments: catalog.environments.map((env, i) => ({ ...env, open: i < 2 })) } };
  const rows = UI.rows({ snap, play, dismissed, go: change => went.push(change) });
  return { rows, went, row: key => rows.find(r => r.key === key) };
}

test("every environment has a backdrop with its own motif, in its own colours", () => {
  assert.deepEqual(Object.keys(Art.MOTIF).sort(), catalog.environments.map(env => env.id).sort());
  for (const env of catalog.environments) {
    const drawn = Art.backdrop(env);
    assert.ok(drawn.includes(env.palette.wall) && drawn.includes(env.palette.floor) && drawn.length > 1500, env.id);
    assert.equal(/NaN|undefined|Infinity/.test(drawn), false, env.id + " drew a broken number");
  }
});

test("an unknown environment or a colour that isn't one still draws a plain room", () => {
  const odd = Art.backdrop({ id: "constructor", palette: { wall: '"/><script>', floor: "#123456", accent: "red", glow: "#abcdef" } });
  assert.ok(!odd.includes("script") && odd.includes("#888888") && odd.includes("#123456"));
});

test("with no trip the list is the places to go, and locked ones say when they open", () => {
  const list = open(null);
  assert.equal(list.rows.length, 12);
  assert.deepEqual([list.rows[0].url, list.rows[0].send], ["dungeon", { env: "moonlit-shrine" }]);
  assert.equal(list.rows[2].send, undefined);
  assert.match(list.rows[2].note, /opens at level 3/);
});

test("a finished trip shows how it ended once, then the places again", () => {
  const home = run({ over: "home", ended: { coins: 80, potions: 1, trophies: ["trophy-geode-egg"], mods: [], depth: 3 } });
  const first = open(home);
  assert.deepEqual(first.rows.map(r => [r.key, r.name, r.hint]), [["continue", "Home again!", "Home from floor 3 with 80 SGC, 1 potion, something for the house"]]);
  first.rows[0].local();
  assert.deepEqual(first.went, [{ dismiss: 9 }]);
  assert.equal(open(home, {}, 9).rows.length, 12);
  const lost = run({ over: "defeat", ended: { lost: bag, depth: 2 } });
  assert.equal(open(lost).rows[0].hint, "Carried home from floor 2 · left behind: 4 SGC · 1 potion");
});

test("a trip's ending offers the way back to town first, which reads the ending on the way out", () => {
  const home = run({ over: "home", ended: { coins: 80, potions: 1, trophies: [], mods: [], depth: 3 } }), went = [], opened = [];
  const snap = { pet: { potions: 2 }, dungeon: { run: home, environments: [] } };
  const rows = UI.rows({ snap, play: {}, dismissed: null, go: change => went.push(change), home: () => opened.push("lumi-town") });
  assert.deepEqual(rows.map(r => r.key), ["go-home", "continue"]);
  assert.equal(rows[0].name, "Back to town"); // Out of the tavern into Lumi Town (2026-11-12), where her house is.
  rows[0].local();
  assert.deepEqual([went, opened], [[{ dismiss: 9 }], ["lumi-town"]], "Read, then out into town");
  assert.deepEqual(UI.rows({ snap, play: {}, dismissed: null, go() {} }).map(r => r.key), ["continue"], "No way home offered (a party): just the ending");
  assert.deepEqual(UI.homeRow(() => {}).key, "go-home");
});

test("Lumi Pet's welcome home: once per fresh trip, in her words, never for an old or undated one", () => {
  const at = 1_000_000_000, hour = 3600000;
  const home = run({ over: "home", ended: { coins: 80, potions: 2, trophies: ["trophy-geode-egg"], mods: [], depth: 3, at } });
  assert.equal(UI.welcome(home, at + hour), "Home! " + catalog.environments[1].name + ", floor 3: she brought back 80 SGC, 2 potions and something for the house.");
  assert.match(UI.welcome(run({ over: "defeat", ended: { lost: bag, depth: 2, at } }), at), /^Carried home from .*A cuddle and a nap would help\.$/);
  assert.match(UI.welcome(run({ over: "abandoned", ended: { lost: bag, depth: 1, at } }), at), /^Home early from /);
  assert.equal(UI.welcome(home, at + UI.WELCOME_HOURS * hour + 1), "", "Too old to be news");
  assert.equal(UI.welcome(run({ over: "home", ended: { coins: 5, potions: 0, trophies: [], mods: [], depth: 1 } }), at), "", "Ended before endings were dated");
  assert.equal(UI.welcome(run(), at), "", "Still out exploring");
  assert.equal(UI.welcome(null, at), "");
});

test("exploring offers each way out, saying what is known there, and only choices are sent", () => {
  const list = open(run());
  assert.deepEqual(list.rows.map(r => r.key), ["go-e", "go-n", "look", "potion", "care", "abandon"]);
  assert.deepEqual(list.row("look").send, { action: "look" });
  list.row("care").local();
  assert.deepEqual(list.went, [{ care: true }], "Looking after her is one row away");
  assert.deepEqual(list.row("go-n").send, { action: "move", way: "n" });
  assert.equal(list.row("go-n").hint, "somewhere new");
  assert.equal(list.row("go-e").hint, "a locked door");
  assert.equal(list.row("potion").name, "Drink a potion (2)");
  assert.equal(list.row("abandon").confirm, "abandon");
  assert.match(list.row("abandon").hint, /Leaves the satchel behind: 4 SGC · 1 potion/);
  assert.ok(list.rows.every(r => !r.send || Object.keys(r.send).every(k => ["action", "way", "picks", "moves"].includes(k))));
  assert.match(open(run(), {}, null, { potions: 0 }).row("potion").note, /no potions/);
  assert.equal(open(run({ hp: 58 })).row("potion"), undefined);
  const found = UI.rows({ snap: { pet: { potions: 0 }, potions_ready: 1, dungeon: { run: run(), environments: [] } }, play: {}, dismissed: null, go() {} }).find(r => r.key === "potion");
  assert.deepEqual([found.name, found.send], ["Drink a potion (1)", { action: "potion" }], "A potion found on this trip counts and can be drunk");
});

test("a chest or a key is offered until it is taken, and never after", () => {
  const chest = open(run({ room: { kind: "treasure", done: false, exits: ["n"] } }));
  assert.deepEqual([chest.rows[0].key, chest.rows[0].name, chest.rows[0].send], ["take", "Open the chest", { action: "take" }]);
  assert.equal(open(run({ room: { kind: "vault", done: false, exits: ["w"] } })).row("take").hint, "The vault's treasure, at last");
  assert.equal(open(run({ room: { kind: "key", done: false, exits: ["n"] } })).row("take").name, "Pick up the key");
  for (const kind of ["treasure", "vault", "key"]) assert.equal(open(run({ room: { kind, done: true, exits: ["n"] } })).row("take"), undefined, kind);
  assert.equal(open(run()).row("take"), undefined);
  const lying = Art.scene(run({ room: { kind: "key", done: false, exits: ["n"] } }), {}, "list"), gone = Art.scene(run({ room: { kind: "key", done: true, exits: ["n"] } }), {}, "list");
  assert.ok(lying.length > gone.length, "The key is drawn while it lies there, and not once it is taken");
});

test("the entrance offers home and the stairs offer down", () => {
  const start = open(run({ room: { kind: "start", done: true, exits: ["n"] } }));
  assert.deepEqual(start.row("leave").send, { action: "leave" });
  assert.match(start.row("leave").hint, /Keep everything in the satchel: 4 SGC/);
  const stairs = open(run({ room: { kind: "stairs", done: true, exits: ["n"] } }));
  assert.deepEqual(stairs.row("descend").send, { action: "descend" });
  assert.match(stairs.row("descend").hint, /Floor 3/);
});

test("a key door needs a key; a rune door builds a code four runes long", () => {
  const facing = lock => run({ facing: { at: "2,1", lock } });
  assert.match(open(facing({ kind: "key" })).row("unlock").note, /needs a key/);
  assert.deepEqual(open(run({ facing: { at: "2,1", lock: { kind: "key" } }, satchel: { ...bag, keys: 1 } })).row("unlock").send, { action: "unlock" });
  const lock = { kind: "runes", runes: ["sun", "moon", "star", "leaf", "wave"], slots: 4, tries: [], left: 8 };
  const empty = open(facing(lock), { guess: [] });
  assert.deepEqual(empty.rows.map(r => r.key), ["try", "rune-sun", "rune-moon", "rune-star", "rune-leaf", "rune-wave", "erase", "back", "care"]);
  assert.match(empty.row("try").note, /Choose 4 runes first/);
  empty.row("rune-moon").local();
  assert.deepEqual(empty.went, [{ rune: "moon" }]);
  const full = open(facing(lock), { guess: ["sun", "moon", "sun", "wave"] });
  assert.deepEqual(full.row("try").send, { action: "rune", picks: ["sun", "moon", "sun", "wave"] });
  assert.match(full.row("rune-sun").note, /Try the code/);
  assert.deepEqual(full.row("back").send, { action: "back" });
});

test("a crate door and a lamp door list their choices with the puzzle as the page holds it", () => {
  // The shapes here are the ones game.js keeps (syncPlay): { board } from sokobanStart or lightsStart. Listing these
  // rows once crashed the whole Dungeon tab, because it read the step count from the wrong place.
  const facing = lock => run({ facing: { at: "2,1", lock } });
  const level = levels[0], crates = UI.sokobanMove(UI.sokobanMove(UI.sokobanStart(level.rows), "u"), "l");
  const atCrates = open(facing({ kind: "sokoban", rows: level.rows }), { id: "x", board: crates });
  assert.deepEqual(atCrates.rows.map(r => r.key), ["play", "undo", "reset", "back", "care"]);
  assert.match(atCrates.row("play").hint, new RegExp("^" + crates.moves.length + " steps so far"));
  atCrates.row("undo").local(); atCrates.row("reset").local(); atCrates.row("play").local();
  assert.deepEqual(atCrates.went, [{ undo: true }, { reset: true }, { focus: "board" }]);
  const lock = { kind: "lights", size: 3, board: Array(9).fill(true) }, lamps = UI.lightsPress(UI.lightsStart(lock), 4);
  const atLamps = open(facing(lock), { id: "y", board: lamps });
  assert.deepEqual(atLamps.rows.map(r => r.key), ["play", "reset", "back", "care"]);
  assert.match(atLamps.row("play").hint, /^1 presses so far/);
  for (const kind of ["sokoban", "lights"]) { // Before the page has started the puzzle, the list still draws.
    const early = open(facing(kind === "lights" ? lock : { kind, rows: level.rows }), {});
    assert.match(early.row("play").hint, /^0 (steps|presses) so far/);
  }
});

test("the cup game is three rows, and the cards hand the remote to the board", () => {
  const cups = open(run({ room: { kind: "game", done: false, exits: ["n"] }, game: { kind: "cups", cups: 3 } }));
  assert.deepEqual(cups.rows.slice(0, 3).map(r => r.send), [0, 1, 2].map(cup => ({ action: "cup", picks: [cup] })));
  const cards = open(run({ room: { kind: "game", done: false, exits: ["n"] }, game: { kind: "match", cards: Array(8).fill(null), found: [], open: null, last: null, left: 14 } }));
  cards.row("play").local();
  assert.deepEqual(cards.went, [{ focus: "board" }]);
});

test("Sokoban on the page plays by the server's rules: walls stop, a crate moves if there is room, undo replays", () => {
  let board = UI.sokobanStart(["######", "#@$ .#", "######"]);
  assert.equal(UI.sokobanSolved(board), false);
  assert.equal(UI.sokobanMove(board, "l"), board, "a wall: nothing happens, and no move is recorded");
  assert.equal(UI.sokobanMove(board, "u"), board);
  board = UI.sokobanMove(board, "r");
  assert.deepEqual([board.at, Object.keys(board.crates), board.moves], [[2, 1], ["3,1"], "r"]);
  board = UI.sokobanMove(board, "r");
  assert.ok(UI.sokobanSolved(board) && board.moves === "rr");
  assert.equal(UI.sokobanMove(board, "r"), board, "a crate against the wall can't be pushed");
  const back = UI.sokobanUndo(board);
  assert.deepEqual([back.at, back.moves, UI.sokobanSolved(back)], [[2, 1], "r", false]);
  const two = UI.sokobanStart(["#######", "#@$$..#", "#######"]);
  assert.equal(UI.sokobanMove(two, "r"), two, "one crate can't push another");
});

test("every shipped Sokoban level loads on the page with as many crates as goals", () => {
  for (const level of levels) {
    const board = UI.sokobanStart(level.rows);
    assert.ok(board.at && Object.keys(board.crates).length === Object.keys(board.goals).length && Object.keys(board.crates).length > 0, level.id);
    assert.equal(UI.sokobanSolved(board), false, level.id);
  }
});

test("Lights Out flips a lamp and its neighbours, and the cursor leaves the board only off its edges", () => {
  let board = UI.lightsStart({ size: 3, board: [false, true, false, true, true, true, false, true, false] });
  board = UI.lightsPress(board, 4);
  assert.ok(UI.lightsSolved(board));
  assert.deepEqual(board.presses, [4]);
  assert.deepEqual(UI.lightsPress(UI.lightsStart({ size: 3, board: Array(9).fill(false) }), 0).lamps.map(Number), [1, 1, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual([UI.cursorMove(0, "e", 3, 9), UI.cursorMove(0, "s", 3, 9), UI.cursorMove(0, "w", 3, 9), UI.cursorMove(0, "n", 3, 9), UI.cursorMove(8, "s", 3, 9), UI.cursorMove(2, "e", 3, 9)], [1, 3, null, null, null, null]);
  assert.equal(UI.cursorMove(3, "s", 4, 8), 7);
});

test("the scene draws the room's doors, what is in it, a map, and the puzzle on the page", () => {
  const plain = Art.scene(run(), {}, "list");
  assert.ok(plain.includes(">N<") && plain.includes(">E<") && !plain.includes(">W<"), "a door for each way out, and no others");
  assert.equal(/NaN|undefined/.test(plain), false);
  const level = levels[0], board = UI.sokobanStart(level.rows);
  const crates = Art.scene(run({ facing: { at: "2,1", lock: { kind: "sokoban", rows: level.rows } } }), { board }, "board");
  assert.ok(crates.includes("PUSH THE CRATES") && !/NaN|undefined/.test(crates));
  assert.ok(Art.scene(run({ facing: { at: "2,1", lock: { kind: "sokoban", rows: level.rows } } }), { board }, "list").includes("PAUSED"));
  const lamps = Art.scene(run({ facing: { at: "2,1", lock: { kind: "lights", size: 3, board: Array(9).fill(true) } } }), { board: UI.lightsStart({ size: 3, board: Array(9).fill(true) }) }, "board");
  assert.ok(lamps.includes("PUT EVERY LAMP OUT"));
  const runes = Art.scene(run({ facing: { at: "2,1", lock: { kind: "runes", runes: [], slots: 4, tries: [{ guess: ["sun", "moon", "star", "leaf"], exact: 1, near: 2, marks: ["right", "near", "near", "miss"] }], left: 7 } } }), { guess: ["wave"] }, "list");
  assert.ok(runes.includes("FIND THE RUNE CODE") && runes.includes("☀") && runes.includes("≈"));
  assert.equal(runes.split('data-rune="right"').length - 1, 1, "The rune in the right place lights up");
  assert.equal(runes.split('data-rune="near"').length - 1, 2, "Runes in the wrong place are ringed");
  const old = Art.scene(run({ facing: { at: "2,1", lock: { kind: "runes", runes: [], slots: 4, tries: [{ guess: ["sun", "moon", "star", "leaf"], exact: 1, near: 2 }], left: 7 } } }), { guess: [] }, "list");
  assert.ok(!old.includes("data-rune"), "A try made before runes lit up still draws, with its counts only");
  assert.ok(Art.scene(run({ facing: { at: "2,1", lock: { kind: "key" } } }), {}, "list").includes("IT NEEDS A KEY"));
  const away = Art.scene(run({ facing: { at: "2,1", lock: { kind: "sokoban", rows: level.rows } } }), { board }, "board", false);
  assert.ok(!away.includes("PUSH THE CRATES") && !away.includes("NEEDS A KEY") && away.includes(">N<"), "On another tab the room shows without the puzzle over it");
  const cards = Art.scene(run({ room: { kind: "game", done: false, exits: ["n"] }, game: { kind: "match", cards: ["sun", null, null, null, null, null, null, null], found: [], open: 0, last: null, left: 13 } }), { cursor: 2 }, "board");
  assert.ok(cards.includes("FIND THE PAIRS · 13 TURNS LEFT") && cards.includes("☀"));
});

test("the top line reads the place, the floor, her health and her satchel", () => {
  assert.deepEqual(UI.hud(run()), { title: "Crystal Cavern · floor 2", hp: 52, mp: 45, label: "30/58 HP · 10 MP · satchel: 4 SGC · 1 potion" });
  assert.equal(UI.carrying({ coins: 5, potions: 2, keys: 1, trophies: ["a", "b"], mods: ["m"] }), "1 SGC · 2 potions · a key · 2 things for the house · 1 mod"); // LumiBot: 5 native coins bank as 1 SGC
  assert.equal(UI.carrying({ coins: 25, potions: 0, keys: 0, trophies: [], mods: [] }, "party"), "5 SGC"); // a party satchel pays under "party"
});

test("looking after Lumi on a trip offers only snacks and a potion", () => {
  const catalog = { snacks: [{ id: "apple", icon: "a", name: "Apple", price: 0, fullness: 30 }, { id: "lunch", icon: "l", name: "Lunch box", price: 12, fullness: 45 },
    { id: "banana", icon: "b", name: "Banana", price: 5, fullness: 35 }], treats: [{ id: "jelly", icon: "j", name: "Jelly", price: 40, fullness: 5 }] };
  const went = [], trip = run();
  const care = hp => UI.rows({ snap: { pet: { potions: 1, inventory: { lunch: 2, jelly: 1 } }, catalog, dungeon: { run: Object.assign({}, trip, { hp }), environments: [] } },
    play: {}, dismissed: null, care: true, go(change) { went.push(change); } });
  const list = care(trip.hpMax - 1);
  assert.deepEqual(list.map(r => r.key), ["explore", "apple", "lunch", "jelly", "potion"], "What she has to eat, a potion, and the way back: no cuddles, naps, shops or closets");
  assert.deepEqual(list[2].send, { action: "feed", item: "lunch" });
  assert.match(list[2].hint, /\+45% health · 2 left/);
  assert.doesNotMatch(list[1].hint, /health/, "The free bowl fills her tummy and mends nothing");
  assert.deepEqual(list[4].send, { action: "potion" });
  assert.equal(care(trip.hpMax)[4].note, "Lumi is already at full health.");
  list[0].local();
  assert.deepEqual(went, [{ care: false }]);
});

test("the room and every board can be pressed with a mouse", () => {
  const names = svg => [...svg.matchAll(/data-click="([^"]+)"/g)].map(m => m[1]);
  const walkable = names(Art.scene(run(), {}, "list"));
  assert.deepEqual(walkable, run().room.exits.map(way => "way:" + way), "Each way out is a door to press");
  const chest = names(Art.scene(run({ room: { kind: "treasure", done: false, exits: ["n"] } }), {}, "list"));
  assert.deepEqual(chest, ["way:n", "take"]);
  assert.deepEqual(names(Art.scene(run({ room: { kind: "treasure", done: true, exits: ["n"] } }), {}, "list")), ["way:n"], "An opened chest has nothing left to press");
  const cups = names(Art.scene(run({ room: { kind: "game", done: false, exits: [] }, game: { kind: "cups", cups: 3 } }), {}, "list"));
  assert.deepEqual(cups, ["cup:0", "cup:1", "cup:2"]);
  const cards = { kind: "match", cards: Array(8).fill(null), found: [], open: null, last: null, left: 10 };
  const match = names(Art.scene(run({ room: { kind: "game", done: false, exits: ["n"] }, game: cards }), { cursor: 0 }, "board"));
  assert.deepEqual(match, [0, 1, 2, 3, 4, 5, 6, 7].map(i => "card:" + i), "Every card, and no door behind the cards");
  const lamps = { kind: "lights", size: 3, board: Array(9).fill(true) };
  assert.equal(names(Art.scene(run({ facing: { at: "2,1", lock: lamps } }), { board: UI.lightsStart(lamps) }, "board")).filter(n => n.startsWith("lamp:")).length, 9);
  const level = { rows: ["#####", "#@$.#", "#####"] };
  const crates = names(Art.scene(run({ facing: { at: "2,1", lock: { kind: "sokoban", rows: level.rows } } }), { board: UI.sokobanStart(level.rows) }, "board"));
  assert.equal(crates.length, 15);
  assert.ok(crates.includes("cell:2,1"));
  assert.deepEqual(names(Art.scene(run({ facing: { at: "2,1", lock: lamps } }), { board: UI.lightsStart(lamps) }, "board", false)), [], "Nothing to press when the board isn't showing");
});
