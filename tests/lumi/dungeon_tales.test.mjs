// Lumi Dungeons words (src/lumi/dungeon/lumitales.js), ported at spec level from erinne tests/test_lumitales.py:
// the line check, the library, filling in names (coins told in SGC), and no live storyteller (erinne with none set up).
// erinne's generator and live-mode tests are not ported: that code is not part of LumiBot (plan section 1).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env, D, T, Seeded } from "./dungeon_helpers.mjs";

const moment = (scenario = "treasure", envId = "toy-attic", event = {}) => ({ id: 5, env: envId, depth: 2, at: "1,2", event: { scenario, n: 1, ...event } }); // erinne _moment
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-tales-"));                    // a throwaway folder
after(() => fs.rmSync(tmp, { recursive: true, force: true }));                         // tidy up
const sgc = (native) => `${env.tuning.scalePayout("dungeon", "win", native)} SGC`;     // coins as told

test("a line is plain, short, and uses only its scenario's placeholders", () => {
  const cases = [                                                                      // [text, scenario, ok]
    ["Lumi finds {item} under a cushion.", "treasure", true], ["  Lumi   pads into\n{place}.  ", "enter", true], // tidied to one line
    ["A wild {enemy} appears!", "enemy", true], ["A wild {enemy} appears!", "empty", false], // no enemy in an empty room
    ["Lumi finds {item}.", "key", false], ["Lumi finds {coins} coins.", "treasure", false], // not a placeholder here
    ["Lumi finds {item.", "treasure", false], ["Lumi finds item}.", "treasure", false],  // stray braces
    ["<b>Lumi</b> wins.", "victory", false], ["See https://example.test for more.", "empty", false], // markup, links
    ["`rm -rf` says the door.", "empty", false], ["x".repeat(201), "empty", false], ["Hi", "empty", false], // code, size
    [null, "empty", false], [["a line"], "empty", false], [7, "empty", false],          // not text
  ];
  for (const [text, scenario, ok] of cases) {
    const out = T.clean(text, scenario);                                               // checked
    assert.equal(out !== null, ok, String(text));                                      // as expected
    if (ok) assert.ok(!out.includes("\n") && !out.includes("  ") && out === out.trim()); // one tidy line
  }
  assert.equal(T.clean("Lumi finds 12 coins.", null, { filled: true }), "Lumi finds 12 coins."); // a filled line
  assert.equal(T.clean("Lumi finds {item}.", null, { filled: true }), null);           // no placeholders left
  assert.equal(T.clean("Welcome to {place}.", null, { filled: true }), null);          // not even place
});

test("the shipped library covers every scenario and every environment has its own voice", () => {
  assert.deepEqual(Object.keys(T.LIBRARY.default).sort(), Object.keys(T.SCENARIOS).sort()); // every scenario
  assert.ok(Object.values(T.LIBRARY.default).every((lines) => lines.length >= 3));     // three lines each
  assert.deepEqual(Object.keys(T.LIBRARY).filter((k) => k !== "default").sort(), Object.keys(D._ENVS).sort()); // every place
  assert.ok(Object.keys(D._ENVS).every((e) => T.LIBRARY[e].enter.length && T.LIBRARY[e].empty.length)); // its own arrivals
});

test("bad libraries are refused", () => {
  const good = JSON.stringify(T.LIBRARY.default);                                      // a good default
  const broken = (name, text, alsoDefault = true) => {                                 // write one bad file
    for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));             // empty the folder
    if (alsoDefault) fs.writeFileSync(path.join(tmp, "default.json"), good);           // the default
    fs.writeFileSync(path.join(tmp, name), text);                                      // the bad one
    assert.throws(() => T.loadLibrary(tmp), /Lumi's tales/);                           // refused
  };
  broken("the-moon.json", '{"empty": ["A fine empty room."]}');                        // not a place
  broken("toy-attic.json", '{"dancing": ["Lumi dances."]}');                           // not a scenario
  broken("toy-attic.json", '{"empty": ["A {enemy} is here."]}');                       // a wrong placeholder
  broken("toy-attic.json", '{"empty": ["<i>spooky</i>"]}');                            // markup
  broken("toy-attic.json", '{"empty": "one line, not a list"}');                       // not a list
  broken("toy-attic.json", '["a list, not scenarios"]');                               // not scenarios
  broken("default.json", JSON.stringify({ ...T.LIBRARY.default, potion: [] }), false); // nothing to say
  fs.writeFileSync(path.join(tmp, "default.json"), good);                              // a good default
  fs.writeFileSync(path.join(tmp, "toy-attic.json"), '{"empty": ["Dust and quiet."]}'); // a good place file
  assert.deepEqual(T.loadLibrary(tmp)["toy-attic"], { empty: ["Dust and quiet."] });   // loads
});

test("a line fills in names, prefers the place's own, and always says what was found (in SGC)", () => {
  const rng = Seeded(2);                                                               // seeded dice
  assert.ok(T.LIBRARY["toy-attic"].empty.includes(T.line(moment("empty"), rng)));      // the attic's own lines first
  const fight = T.line(moment("enemy", "toy-attic", { enemy: "Gloom Bat" }), rng);     // a creature
  assert.ok(fight.includes("Gloom Bat") && !fight.includes("{"));                      // named
  const found = T.line(moment("vault", "toy-attic", { loot: { coins: 90, potions: 1, trophy: "trophy-ghost-teddy", mod: "glitch-fang" } }), rng); // a vault
  assert.ok(found.includes(`${sgc(90)}, a potion, the Ghost teddy and a Glitch Fang mod`), found); // everything, coins in SGC
  assert.ok(!/\bcoins\b/u.test(found));                                                // never "coins"
  const home = T.line(moment("home"), Seeded(0));                                      // home
  assert.ok(T.LIBRARY["toy-attic"].home.some((l) => l.replace("{place}", "Haunted Toy Attic") === home)); // the attic's own, place filled in
  assert.equal(T.line(moment("runes_try", "toy-attic", { exact: 2, near: 1 })), "2 in the right place (lit green), 1 right but in the wrong place (ringed gold)."); // a fact
  for (const scenario of Object.keys(T.SCENARIOS)) {                                   // every scenario reads cleanly everywhere
    for (const envId of Object.keys(D._ENVS)) {
      const told = T.line(moment(scenario, envId, { enemy: "Dust Bunny", loot: { coins: 5 } }), rng); // a line
      assert.ok(told && !told.includes("{") && !told.includes("}"), `${scenario} ${envId}`); // filled
    }
  }
});

test("a bank note and a dropped piece are added after the moment's line", () => {
  const told = T.line(moment("home", "toy-attic", { note: "Lumi-Town Bank is closed for a moment, your prize is saved." }), Seeded(1)); // owed
  assert.ok(told.endsWith(" Lumi-Town Bank is closed for a moment, your prize is saved."));              // said last
  const piece = D.SETS["toy-attic"][0];                                                // a set piece
  const dropped = T.line(moment("victory", "toy-attic", { enemy: "Dust Bunny", dropped: piece.id }), Seeded(1)); // it dropped one
  assert.ok(dropped.endsWith(` It leaves something behind: the ${piece.name}!`));      // told
});

test("a party trip's coins are told at the party's rate", () => {
  env.tuning.setGame("party", "payoutOverrides", { win: 42 }, "test");                 // an exact party prize
  try {
    const run = { ...moment("treasure", "toy-attic", { loot: { coins: 90 } }), vote_since: null }; // a lumiparty.js run
    assert.ok(T.line(run, Seeded(1)).includes("42 SGC"));                              // the party's table
    assert.ok(T.line(moment("treasure", "toy-attic", { loot: { coins: 90 } }), Seeded(1)).includes(sgc(90))); // solo: the dungeon's
  } finally {
    env.tuning.setGame("party", "payoutOverrides", null, "test");                      // back to normal
  }
});

test("a room keeps its own detail and each look notices another", () => {
  const run = moment("look", "toy-attic");                                             // a room
  const looks = T.LIBRARY["toy-attic"].look;                                           // its details
  const here = T.scene(run);                                                           // what it's like
  assert.ok(looks.includes(here));                                                     // from the library
  assert.equal(T.scene({ ...run }), here);                                             // the same room, the same detail
  const first = T.line({ ...run, event: { scenario: "look", n: 1 } });                 // a look
  const second = T.line({ ...run, event: { scenario: "look", n: 2 } });                // another
  assert.equal(new Set([here, first, second]).size, 3);                                // each a new one
  assert.equal(T.crc32("1800000000000:1:2,3"), T.crc32("1800000000000:1:2,3"));        // steady
  assert.equal(T.crc32("hello"), 907060870);                                           // zlib's crc32 (Python agrees)
});

test("there is no live storyteller: every ask gets the library's line", async () => {
  assert.equal(await T.liveLine(moment("empty")), null);                               // erinne with nobody set up
});
