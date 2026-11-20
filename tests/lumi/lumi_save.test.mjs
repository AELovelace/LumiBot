// src/lumi/pet/save.js: the Lumi Pet save model every game reads (fresh save, load + migrations, look, placed,
// the validated catalogs and their lookup tables).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { db } = boot();                                                 // in-memory DB with the lumi tables
const save = require("../../src/lumi/pet/save.js");                   // the module under test
const ME = "888888888888888888";                                      // a Discord-shaped player id

test("the catalogs load, validate, and build erinne's lookup tables", () => {
  assert.ok(Object.keys(save.WEAR).length > 10);                      // closet accessories
  assert.ok(Object.keys(save.DECOR).length > 50);                     // house pieces
  assert.ok(Object.keys(save.ITEMS).length > 5);                      // snacks, treats, toys
  assert.ok(save.PRIZES.length > 0);                                  // capsule prizes
  assert.deepEqual(save.BOXES.map((b) => b.box), save.BOXES.map((_, i) => i + 1)); // boxes 1..n
  const broken = structuredClone(save.CATALOG);                       // a bad edit...
  broken.snacks[0].price = -1;
  assert.throws(() => save.loadCatalog(broken), /needs a name, an icon and a price/); // ...is refused at start
});

test("a fresh Lumi has erinne's fields plus the battle fields", () => {
  const pet = save.fresh(1000);
  assert.equal(pet.version, 2);
  assert.equal(pet.hunger, 85);
  assert.equal(pet.glow, "rose");
  assert.equal(pet.moved_in, save.MOVE_IN);
  assert.deepEqual(pet.estate, { styles: [], yard: [], rooms: {} });
  assert.deepEqual(pet.moves, ["pounce", "glow-spark"]);
  assert.equal(pet.mods.length, 5);
  assert.deepEqual(Object.keys(pet.stat_points), ["hp", "attack", "defense", "magic", "ward", "speed", "mp"]);
});

test("load saves a new Lumi, older saves gain new fields, and hooks run", () => {
  assert.equal(save.exists(ME), false);
  const pet = db.tx(() => save.load(ME, { now: 5000 }));
  assert.equal(save.exists(ME), true);
  assert.equal(pet.seen, 5000);
  db.getDb().prepare("UPDATE lumi_pets SET data = ? WHERE user_id = ?").run(JSON.stringify({ hunger: 10, updated: 1, moved_in: 1, stat_points: {}, blocked: [123], estate: "junk" }), ME); // an old, odd save
  let advanced = null;
  save.setAdvance((p, now) => { advanced = now; p.updated = now; });  // the pet module's decay hook
  const old = db.tx(() => save.load(ME, { now: 9000 }));
  save.setAdvance(null);
  assert.equal(advanced, 9000);
  assert.equal(old.hunger, 10);                                       // kept
  assert.equal(old.joy, 85);                                          // gained
  assert.deepEqual(old.blocked, ["123"]);                             // ids become strings
  assert.deepEqual(old.estate, { styles: [], yard: [], rooms: {} });  // a broken estate is made whole
});

test("look reads a save without changing it, and drops what isn't valid", () => {
  const before = db.getDb().prepare("SELECT data FROM lumi_pets WHERE user_id = ?").get(ME).data;
  const wear = Object.values(save.WEAR)[0];                           // a real accessory
  db.getDb().prepare("UPDATE lumi_pets SET data = ? WHERE user_id = ?").run(JSON.stringify({ glow: "lagoon", name: "Pip", colour: "#ff00aa", outfit: { [wear.slot]: wear.id, hat: "gone-forever" } }), ME);
  assert.deepEqual(save.look(ME), { glow: "lagoon", outfit: { [wear.slot]: wear.id }, colour: "#ff00aa", name: "Pip" });
  assert.deepEqual(save.look("999"), { glow: "rose", outfit: {}, colour: null, name: "Lumi" }); // no Lumi yet: a fresh look
  db.getDb().prepare("UPDATE lumi_pets SET data = ? WHERE user_id = ?").run(before, ME); // put it back
});

test("placed fills every non-shared spot with her choice or the free default", () => {
  const out = save.placed(save.fresh(0));
  for (const spot of save.HOUSE.spots) {
    if ("same_as" in spot) assert.equal(out[spot.id], undefined, spot.id);                         // follows the bedroom
    else if (spot.items[0].worn) assert.equal(out[spot.id], undefined, spot.id);                   // still in its box
    else assert.equal(out[spot.id], spot.items[0].id, spot.id);                                    // the free default
  }
  const spot = save.HOUSE.spots.find((s) => !("same_as" in s) && s.items.length > 1);
  assert.equal(save.placed({ house: { [spot.id]: spot.items[1].id } })[spot.id], spot.items[1].id); // her choice wins
  assert.equal(save.placed({ house: { [spot.id]: "not-a-piece" } })[spot.id], spot.items[0].worn ? undefined : spot.items[0].id); // junk ignored
});
