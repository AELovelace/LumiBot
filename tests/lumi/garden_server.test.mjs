// Lumi's Stardust Garden on the server (src/lumi/garden/lumigarden.js), ported from erinne tests/test_lumigarden.py:
// flowers and their tree, the press and its daily bands, helpers and Lumi's build, abilities, the two minigames,
// gifts, decorations, moonrise and reminders. erinne drove these through lumipet.garden_act; here the garden module is
// driven directly (current -> advance -> act -> save, as lumipet.gardenAct does) with a pet object, so the tests
// don't depend on the pet module. Coins are SGC: native prices are scaled by tuning (nursery items x1, prizes x0.2 by default).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { eco, db, tuning, errors } = boot();                                          // fresh in-memory DB
const G = require("../../src/lumi/garden/lumigarden.js");                           // the garden
const save = require("../../src/lumi/pet/save.js");                                 // pet catalogs (snacks)

const ME = "444444444444444444";                                                     // a Discord-shaped id
const WHO = { id: ME, name: "alice" };                                               // ctx.user-like
const T0 = 1_800_000_000_000;                                                        // a fixed moment (ms)
const MIN = 60_000;
const HOUR = 3_600_000;
const LADDER = G.CATALOG.flowers.map((f) => f.id);                                   // every flower, in order
const PANTRY = save.CATALOG.snacks.filter((s) => s.price).map((s) => s.id);          // what a snack gift may be
const near = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));           // pytest.approx

class Dice { // erinne's scripted dice: random() gives `chance`; randrange(n) gives the rolls in turn, then `pick`.
  constructor(rolls = [], { pick = 0, chance = 0.5 } = {}) { this.rolls = [...rolls]; this.pick = pick; this.chance = chance; }
  random() { return this.chance; }
  randrange(n) { return Math.min(this.rolls.length ? this.rolls.shift() : this.pick, n - 1); }
}
const quiet = () => new Dice([], { chance: 0.99 });                                  // no lucky presses, no gifts

const petOf = (fields = {}) => ({ level: 1, skills: [], moves: ["pounce", "glow-spark"], mods: [null, null, null, null, null], potions: 0, inventory: {}, ...fields }); // erinne _pet
let pet = petOf();                                                                   // the pet these tests garden with

function reset() { // A fresh player: no garden, 1000 SGC, a funded bank.
  resetLumi(eco);
  eco.getEconomyDb().exec("DELETE FROM lumi_gardens");
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  setBalance(eco, ME, 1000);
  pet = petOf();
}

// One choice, like lumipet.gardenAct: load, catch the press up, act, save. -> { said, garden, coins, pet }
function g(action, now = T0, rng = quiet(), opts = {}) {
  return db.tx(() => {
    const state = G.current(ME, now);                                                // saved garden
    G.advance(WHO, state, pet, now);                                                 // catch up
    const said = G.act(WHO, pet, state, action, now, rng, { pantry: PANTRY, held: 99, ...opts }); // the choice
    G.save(ME, state);                                                               // keep it
    return { said, garden: G.view(state, pet, now), coins: eco.getBalance(ME), pet }; // what the page gets
  });
}
function look(now = T0) { // Looking catches the press up and saves (lumipet._garden).
  return db.tx(() => { const state = G.current(ME, now); G.advance(WHO, state, pet, now); G.save(ME, state); return G.view(state, pet, now); });
}
const saved = () => JSON.parse(eco.getEconomyDb().prepare("SELECT state FROM lumi_gardens WHERE user_id = ?").get(ME).state); // raw save
function set(fields = {}, garden = {}) { // erinne _set: put the saved garden in a known condition.
  const state = { ...saved(), ...fields };
  Object.assign(state.gardens[state.at], garden);
  eco.getEconomyDb().prepare("UPDATE lumi_gardens SET state = ? WHERE user_id = ?").run(JSON.stringify(state), ME);
}
const refused = (fn, re) => assert.throws(fn, (e) => e instanceof G.GardenError && re.test(e.message)); // a GardenError with words
const sgcPrice = (key, native) => tuning.scalePrice("garden", key, native);          // what the nursery charges
const itemSgc = (native) => Math.max(1, Math.round(native * 1));                     // the rule for an item at the default item scale 1

// --------------------------------------------------------------------------- the catalog
test("the flowers start free, open in order and end in perennials", () => {
  const flowers = G.CATALOG.flowers;
  assert.equal(flowers.length, 42);
  assert.ok(flowers[0].coins === 0 && flowers[0].stardust === 0);
  assert.deepEqual([Math.min(...flowers.map((f) => f.minutes)), Math.max(...flowers.map((f) => f.minutes))], [2, 24 * 60]);
  const sorts = flowers.map((f) => f.sort);
  assert.deepEqual(sorts, [...sorts].sort());
  assert.equal(sorts.filter((s) => s === "cut").length, 30);
  assert.equal(flowers.filter((f) => f.stardust).length, 10);
  assert.ok(flowers.every((f) => f.level === 1));
  const bestCut = Math.max(...flowers.filter((f) => f.sort === "cut").map((f) => f.powder / f.minutes));
  assert.ok(flowers.filter((f) => f.sort === "perennial").every((f) => f.powder / f.minutes < bestCut));
  assert.equal(G._FLOWERS["moon-fern"].minutes, 60);
  assert.equal(new Set(flowers.map((f) => `${f.shape}|${f.petals}|${f.colour}`)).size, 42);
  assert.deepEqual(new Set(flowers.map((f) => f.shape)), new Set(G.SHAPES));
  assert.ok(flowers.slice(1).every((f, i) => f.shape !== flowers[i].shape));
});

test("bad garden catalogs are refused", () => {
  const good = JSON.parse(JSON.stringify(G.CATALOG));
  const broken = (change) => { const data = JSON.parse(JSON.stringify(good)); change(data); assert.throws(() => G.loadCatalog(data), /Lumi's garden/); };
  assert.ok(G.loadCatalog(JSON.parse(JSON.stringify(good))));                        // the real one passes
  broken((d) => { d.flowers[0].coins = 5; });
  broken((d) => { d.flowers[3].coins = 5; d.flowers[3].stardust = 5; });
  broken((d) => { d.flowers[3].needs = 0; });
  broken((d) => { d.flowers[3].after = [d.flowers[5].id]; });
  broken((d) => { d.flowers[3].after = []; });
  broken((d) => { delete d.flowers[3].branch; });
  broken((d) => { d.flowers[2].colour = "red"; });
  broken((d) => { d.flowers[2].shape = "triangle"; });
  broken((d) => { Object.assign(d.flowers[3], { shape: d.flowers[2].shape, petals: d.flowers[2].petals, colour: d.flowers[2].colour }); });
  broken((d) => { d.decor.capsule.odds.common = 50; });
  broken((d) => { d.decor.slots[0].items[0].stardust = 0; });
  broken((d) => { d.decor.slots[0].items[9].stardust = 5; });
  broken((d) => { d.helpers.pop(); });
  broken((d) => { d.water.rounds = 12; d.water.share = 20; });
  broken((d) => { d.press.band = 0; });
});

// --------------------------------------------------------------------------- flowers
test("a cut flower is ready on time, waits, then overgrows to half", () => {
  reset();
  assert.deepEqual(g("plant", T0, quiet(), { plot: 0, item: "moondaisy" }).said, { planted: "moondaisy" });
  const shown = look(T0 + MIN).plots[0];
  assert.deepEqual([shown.flower, shown.stage, shown.ready_in], ["moondaisy", "growing", MIN]);
  refused(() => g("trim", T0 + 2 * MIN - 1, quiet(), { plot: 0 }), /ready to trim/);
  assert.deepEqual(g("trim", T0 + 2 * MIN, quiet(), { plot: 0 }).said, { trimmed: 1, powder: 6, gift: null });
  const after = look(T0 + 2 * MIN);
  assert.deepEqual(after.plots[0], { flower: null, last: "moondaisy", stage: "empty", ready_in: 0, grow: 0 });
  assert.ok(after.powder === 6 && after.given === 6);
  g("plant", T0 + 2 * MIN, quiet(), { plot: 0, item: "moondaisy" });
  assert.equal(look(T0 + 8 * MIN).plots[0].stage, "ready");
  assert.equal(look(T0 + 8 * MIN + 1).plots[0].stage, "overgrown");
  assert.equal(g("trim", T0 + 9 * MIN, quiet(), { plot: 0 }).said.powder, 3);
  for (const body of [{ plot: 9, item: "moondaisy" }, { plot: 0, item: "glowbell" }, { plot: 0, item: "rose" }]) {
    assert.throws(() => g("plant", T0 + 9 * MIN, quiet(), body), G.GardenError);
  }
});

test("a flower can be dug up so a perennial can be replaced", () => {
  reset();
  look();
  set({}, { unlocked: LADDER });
  const fern = G._FLOWERS["moon-fern"].powder;
  refused(() => g("dig", T0, quiet(), { plot: 0 }), /already empty/);
  g("plant", T0, quiet(), { plot: 0, item: "moon-fern" });
  g("plant", T0, quiet(), { plot: 1, item: "moon-fern" });
  assert.deepEqual(g("dig", T0 + 10 * MIN, quiet(), { plot: 0 }).said, { dug: "Moon Fern" });
  const said = g("dig", T0 + HOUR, quiet(), { plot: 1 }).said;
  assert.deepEqual([said.dug, said.trimmed, said.powder], ["Moon Fern", 1, fern]);
  assert.deepEqual(look(T0 + HOUR).plots.slice(0, 2).map((p) => [p.flower, p.stage]), [[null, "empty"], [null, "empty"]]);
  g("plant", T0 + HOUR, quiet(), { plot: 0, item: "moon-mushroom" });
  assert.equal(look(T0 + HOUR).plots[0].flower, "moon-mushroom");
});

test("a perennial grows back and trim-all replants cut flowers", () => {
  reset();
  look();
  set({}, { unlocked: LADDER });
  const tulip = G._FLOWERS["moon-mushroom"].powder;
  const fern = G._FLOWERS["moon-fern"].powder;
  g("plant", T0, quiet(), { plot: 0, item: "moon-fern" });
  g("plant", T0, quiet(), { plot: 1, item: "moon-mushroom" });
  g("plant", T0, quiet(), { plot: 2, item: "moondaisy" });
  refused(() => g("plant", T0, quiet(), { plot: 0, item: "moondaisy" }), /already growing/);
  const said = g("trim_all", T0 + HOUR).said;
  assert.ok(said.trimmed === 3 && said.powder === fern + tulip + 3);
  assert.deepEqual(look(T0 + HOUR).plots.slice(0, 3).map((p) => [p.flower, p.stage, p.ready_in]),
    [["moon-fern", "growing", HOUR], ["moon-mushroom", "growing", 50 * MIN], ["moondaisy", "growing", 2 * MIN]]);
  refused(() => g("trim_all", T0 + HOUR), /Nothing is ready/);
  assert.equal(g("trim", T0 + HOUR + 2 * MIN, quiet(), { plot: 2 }).said.powder, 6);
  assert.equal(look(T0 + HOUR + 2 * MIN).plots[2].flower, null);
});

test("the flower tree branches three ways with bridges and a crown", () => {
  const flowers = G.CATALOG.flowers;
  const count = (b) => flowers.filter((f) => f.branch === b).length;
  assert.deepEqual(["root", "quick", "slow", "perennial", "crown"].map(count), [1, 14, 14, 12, 1]);
  assert.deepEqual(flowers.filter((f) => JSON.stringify(f.after) === '["moondaisy"]').map((f) => f.id), ["glowbell", "pixie-puff", "moon-fern"]);
  assert.deepEqual(G._FLOWERS["midnight-rose"].after, ["glass-lily", "phoenix-daisy"]);
  const bridges = Object.fromEntries(flowers.filter((f) => f.after.length > 1 && f.branch !== "crown").map((f) => [f.id, f.after[1]]));
  assert.deepEqual(bridges, { "little-sun": "sugar-trumpet", "lantern-lily": "snowball-bloom", "star-wisteria": "little-sun" });
});

test("a flower opens from any one of the flowers it grows from", () => {
  reset();
  look();
  set({}, { given: 10 ** 6, unlocked: ["moondaisy", "glowbell", "dewdrop-star", "candy-spike", "sugar-trumpet"] });
  assert.deepEqual(look().flowers.filter((f) => f.next).map((f) => f.id), ["pixie-puff", "dusk-tulip", "little-sun", "moon-fern"]);
  assert.ok(g("unlock", T0, quiet(), { item: "little-sun" }).garden.flowers[10].unlocked);
  refused(() => g("unlock", T0, quiet(), { item: "midnight-rose" }), /grows from Glass Lily or Phoenix Daisy: unlock one of them first/);
});

test("each garden grows its own tree with SGC or starpowder", () => {
  reset();
  const shown = look();
  assert.deepEqual(shown.flowers.filter((f) => f.unlocked).map((f) => f.id), ["moondaisy"]);
  const bell = G._FLOWERS.glowbell;
  const rose = G._FLOWERS["nebula-rose"];
  refused(() => g("unlock", T0, quiet(), { item: "glowbell" }), /given 40 starpowder/);
  set({}, { given: 40 });
  refused(() => g("unlock", T0, quiet(), { item: "starpoppy" }), /Starpoppy grows from Pixie Puff: unlock it first/);
  assert.equal(sgcPrice("glowbell", bell.coins), itemSgc(bell.coins));                // a seed is an item: erinne's price
  assert.equal(g("unlock", T0, quiet(), { item: "glowbell" }).coins, 1000 - sgcPrice("glowbell", bell.coins)); // 25 native -> 25 SGC
  assert.equal(eco.getBalance("__LUMI_NURSERY__"), sgcPrice("glowbell", bell.coins));                        // to the Nursery
  refused(() => g("unlock", T0, quiet(), { item: "glowbell" }), /can unlock/);
  set({ powder: rose.stardust - 1 }, { given: rose.needs, unlocked: LADDER.slice(0, rose.rung) });
  refused(() => g("unlock", T0, quiet(), { item: "nebula-rose" }), /Not enough starpowder/);
  set({ powder: rose.stardust });
  const out = g("unlock", T0, quiet(), { item: "nebula-rose" });
  assert.ok(out.coins === 1000 - sgcPrice("glowbell", bell.coins) && out.garden.powder === 0 && out.garden.flowers[rose.rung].unlocked);
  set({}, { given: 10 ** 6, unlocked: ["moondaisy", "glowbell", "starpoppy", "comet-clover"] });
  assert.deepEqual(look().flowers.filter((f) => f.next).map((f) => f.id), ["pixie-puff", "dewdrop-star", "moon-mushroom", "moon-fern"]);
});

test("a per-flower price override wins (key = the flower id)", () => {
  reset();
  look();
  set({}, { given: 40 });
  tuning.setGame("garden", "priceOverrides", { glowbell: 2 }, "test");
  assert.equal(g("unlock", T0, quiet(), { item: "glowbell" }).coins, 998);
  tuning.setGame("garden", "priceOverrides", {}, "test");
});

test("plots cost more each time and a garden holds sixteen", () => {
  reset();
  assert.equal(look().plot_price, 25);                                              // native
  assert.equal(look().plots.length, 4);
  const out = g("plot");
  assert.deepEqual(out.said, { bought: "plot", paid: itemSgc(25) });                 // 25 SGC (an item)
  assert.ok(out.coins === 1000 - itemSgc(25) && out.garden.plots.length === 5 && out.garden.plot_price === 31);
  set({}, { plots: Array.from({ length: 16 }, G._empty) });
  assert.equal(look().plot_price, null);
  refused(() => g("plot"), /every plot/);
  setBalance(eco, ME, 3);
  set({}, { plots: Array.from({ length: 4 }, G._empty) });
  assert.throws(() => g("plot"), (e) => e instanceof errors.LumiError && e.status === 402 && /Not enough SGC for another plot/.test(e.message));
  assert.equal(look().plots.length, 4);                                             // rolled back
});

// --------------------------------------------------------------------------- the press
test("presses are counted at a human rate; press coins become whole SGC, the rest waits", () => {
  reset();
  look();
  set({ powder: 1000 });
  const out = g("press", T0 + 1000, quiet(), { count: 1000 });                       // a second's worth
  assert.deepEqual(out.said, { pressed: 15, lucky: 0, powder: 45, coins: 0, made: 1 }); // 1 press coin: not a whole SGC yet
  assert.ok(out.garden.powder === 955 && out.garden.squeezed === 5 && out.garden.coins_today === 1 && out.coins === 1000);
  const lucky = g("press", T0 + 2000, new Dice([], { chance: 0 }), { count: 15 }).said;
  assert.deepEqual(lucky, { pressed: 15, lucky: 15, powder: 45, coins: 1, made: 5 }); // 1 + 5 = 6 waiting: 5 make 1 SGC
  assert.equal(saved().unpaid, 1);                                                   // one press coin still waiting
  assert.equal(eco.getBalance(ME), 1001);
  assert.ok(eco.getEconomyDb().prepare("SELECT 1 FROM lumi_coin_refs WHERE ref = ?").get(`lumi-garden:${ME}:6`)); // erinne's ref
  assert.equal(g("press", T0 + 2000, quiet(), { count: 50 }).said.pressed, 3);       // only the slack
  assert.equal(g("press", T0 + 10 * HOUR, quiet(), { count: 5000 }).said.pressed, 123); // ten seconds, not ten hours
  set({ powder: 0, squeezed: 0 });
  assert.deepEqual(g("press", T0 + 11 * HOUR, quiet(), { count: 10 }).said, { pressed: 10, lucky: 0, powder: 0, coins: 0, made: 0 });
});

test("each further hundred press coins in a day costs twice the powder", () => {
  reset();
  look();
  set({ powder: 10_000, coins_today: 99, day: db.dayKey() });
  const out = g("press", T0 + 1000, quiet(), { count: 15 });
  assert.ok(out.said.made === 1 && out.garden.coins_today === 100 && out.garden.squeezed === 5);
  assert.equal(out.garden.price, 80);
  set({ coins_today: 250 });
  assert.equal(look(T0 + 1000).price, 160);
  set({ day: "2000-01-01", coins_today: 250, squeezed: 0 });
  const again = g("press", T0 + 2000, quiet(), { count: 15 });
  assert.ok(again.garden.coins_today === 1 && again.garden.price === 40);
});

test("the monk squeezes alone the same in one look or many, and time away is capped", () => {
  reset();
  look();
  const monk = Object.fromEntries(G.TREES.map((t) => [t, t === "monk" ? 5 : 0]));
  set({ powder: 10 ** 6, helpers: monk });                                           // one powder a second
  let stepped;
  for (let step = 1; step <= 6; step++) stepped = look(T0 + step * 10_000);
  assert.ok(stepped.powder === 10 ** 6 - 60 && stepped.coins_today === 1 && stepped.squeezed === 20 && stepped.away === null);
  set({ powder: 10 ** 6, squeezed: 0, coins_today: 0, tick: T0 });
  const once = look(T0 + 60_000);
  assert.deepEqual([once.powder, once.squeezed, once.coins_today], [10 ** 6 - 60, 20, 1]);
  set({ powder: 10 ** 6, squeezed: 0, coins_today: 0, tick: T0 });
  const away = look(T0 + 10 * HOUR);                                                 // five minutes in full, eight hours at half
  assert.equal(away.powder, 10 ** 6 - (300 + 8 * 3600 * 0.5));
  assert.ok(away.away.ms === 10 * HOUR && away.away.powder === 14_700);
  assert.ok(away.away.made === away.coins_today && away.coins_today > 100);
  assert.ok(away.away.coins > 0);                                                    // SGC paid while away
});

test("Lumi's skills, mods and level lift her helpers, and a respec takes it back", () => {
  const state = G.fresh(T0);
  const plain = G.rates(state, petOf(), T0);
  assert.ok(plain.tap === 3 && plain.idle === 0 && plain.lucky === 0.03 && plain.growth === 1 && plain.fresh === 2 && plain.kept === 0.5);
  assert.ok(near(G.rates(state, petOf({ skills: ["heavy-paw", "tough-fur"] }), T0).tap, 3 * 1.25 ** 2));
  assert.ok(near(G.rates(state, petOf({ level: 11 }), T0).tap, 3 * 1.2));
  assert.ok(near(G.rates(state, petOf({ level: 10, mods: ["servo-claws", null, null, null, null] }), T0).tap, 3 * 1.18 * 1.06));
  assert.ok(near(G.rates(state, petOf({ level: 9, mods: ["servo-claws", null, null, null, null] }), T0).tap, 3 * 1.16));
  Object.assign(state.helpers, { fighter: 2, thief: 4, monk: 5, mage: 10, cleric: 5, paladin: 4 });
  state.upgrades = { "strong-press": 2, "rich-soil": 1, "long-bloom": 1, "night-shift": 2 };
  const built = G.rates(state, petOf(), T0);
  assert.ok(near(built.tap, 3 * 2 * 1.2 * 1.5) && near(built.idle, 0.2 * 5 * 1.2 * 1.5) && near(built.lucky, 0.07));
  assert.ok(near(built.growth, 1 / 1.3 * 0.95) && near(built.fresh, 2 * 1.5 * 1.25) && near(built.kept, 0.65));
  assert.ok(built.away_ms === 10 * HOUR && near(built.yield, 1.2));
  assert.ok(near(G.rates(state, petOf({ skills: ["twin-paws"] }), T0).idle, built.idle * 1.25));
  assert.ok(near(G.rates(state, petOf({ skills: [] }), T0).idle, built.idle));
});

test("helpers are levelled with starpowder and cost more each time", () => {
  reset();
  assert.deepEqual(look().helpers.map((h) => h.cost), [30, 60, 50, 120, 100, 250]);
  refused(() => g("helper", T0, quiet(), { item: "fighter" }), /Not enough starpowder/);
  set({ powder: 100 });
  const out = g("helper", T0, quiet(), { item: "fighter" });
  assert.deepEqual(out.said, { helper: "fighter", level: 1 });
  assert.ok(out.garden.powder === 70 && out.garden.helpers[0].cost === 40 && out.garden.rates.tap === 4.5 && out.coins === 1000);
  refused(() => g("helper", T0, quiet(), { item: "wizard" }), /helpers/);
});

// --------------------------------------------------------------------------- abilities
test("her equipped moves are abilities with cooldowns", () => {
  reset();
  assert.deepEqual(look().moves.map((m) => [m.id, m.tree, m.name, m.strength]), [["pounce", "fighter", "Frenzy", 0.5], ["glow-spark", "mage", "Sunburst", 0.5]]);
  refused(() => g("ability", T0, quiet(), { item: "starfall" }), /move ready/);
  refused(() => g("ability", T0, quiet(), { item: "glow-spark" }), /Nothing is growing/);
  g("plant", T0, quiet(), { plot: 0, item: "moondaisy" });
  assert.deepEqual(g("ability", T0, quiet(), { item: "glow-spark" }).said, { ability: "mage", moved: 1 });
  assert.equal(look().plots[0].ready_in, 2 * MIN - Math.trunc(0.04 * 0.5 * 2 * MIN));
  refused(() => g("ability", T0, quiet(), { item: "glow-spark" }), /ready again in 600 seconds/);
  const frenzy = g("ability", T0, quiet(), { item: "pounce" }).garden;
  assert.deepEqual(frenzy.effects, { frenzy: 30_000 });
  assert.ok(frenzy.rates.tap === 6 && frenzy.moves[0].ready_in === 180_000);
  assert.equal(look(T0 + 30_000).rates.tap, 3);
});

test("deeper moves are stronger and each tree does its own thing", () => {
  reset();
  pet = petOf({ skills: ["heavy-paw", "quick-swipe", "twin-paws", "mend", "holy-paw"], moves: ["quick-swipe", "twin-paws", "mend", "holy-paw"] });
  look();
  set({ powder: 5000, helpers: Object.fromEntries(G.TREES.map((t) => [t, t === "monk" ? 5 : 0])) });
  assert.equal(g("ability", T0, quiet(), { item: "quick-swipe" }).garden.rates.lucky, 1.0);
  const lump = g("ability", T0, quiet(), { item: "twin-paws" }).said;
  assert.ok(lump.ability === "monk" && near(lump.powder, 0.2 * 5 * 1.25 * 300 + 3 * 1.25 * 20));
  refused(() => g("ability", T0, quiet(), { item: "mend" }), /Nothing is overgrown/);
  g("plant", T0, quiet(), { plot: 0, item: "moondaisy" });
  assert.deepEqual(g("ability", T0 + HOUR, quiet(), { item: "mend" }).said, { ability: "cleric", moved: 1 });
  assert.equal(look(T0 + HOUR).plots[0].stage, "ready");
  const blessed = g("ability", T0 + HOUR, quiet(), { item: "holy-paw" }).garden;
  assert.ok(blessed.rates.double === 2 && blessed.effects.double === 30_000);
  assert.equal(g("trim", T0 + HOUR, quiet(), { plot: 0 }).said.powder, 12);
  assert.deepEqual(G._ability(petOf(), "starfall"), ["mage", 1 + 0.25 * 7]);
});

// --------------------------------------------------------------------------- the minigames
test("watering is a growing sequence the server keeps", () => {
  reset();
  g("plant", T0, quiet(), { plot: 0, item: "moondaisy" });
  refused(() => g("water_answer", T0, quiet(), { picks: [0] }), /Start a round/);
  const seq = [2, 0, 3, 1, 2, 2, 0, 1];
  const shown = g("water_start", T0, new Dice(seq)).garden.water;
  assert.ok(JSON.stringify(shown.show) === "[2]" && shown.rounds === 8);
  for (let round = 1; round < 8; round++) {
    const out = g("water_answer", T0, quiet(), { picks: seq.slice(0, round) });
    assert.deepEqual(out.said, { water: "more", round: round + 1 });
    assert.deepEqual(out.garden.water.show, seq.slice(0, round + 1));
  }
  const done = g("water_answer", T0, quiet(), { picks: seq });
  assert.deepEqual(done.said, { water: "done", rounds: 8, moved: 1, right: true });
  assert.equal(done.garden.water.show, null);
  assert.equal(done.garden.plots[0].ready_in, 2 * MIN - Math.trunc(0.4 * 2 * MIN));
  refused(() => g("water_start"), /ready again in 1800 seconds/);
  const later = T0 + 31 * MIN;
  g("trim", later, quiet(), { plot: 0 });
  g("plant", later, quiet(), { plot: 0, item: "moondaisy" });
  g("water_start", later, new Dice([1, 1, 1, 1, 1, 1, 1, 1]));
  g("water_answer", later, quiet(), { picks: [1] });
  g("water_answer", later, quiet(), { picks: [1, 1] });
  const wrong = g("water_answer", later, quiet(), { picks: [1, 1, 0] });
  assert.deepEqual(wrong.said, { water: "done", rounds: 2, moved: 1, right: false });
  assert.equal(wrong.garden.plots[0].ready_in, 2 * MIN - Math.trunc(0.1 * 2 * MIN));
});

test("fertilizing counts ten seconds of presses and no more", () => {
  reset();
  look();
  set({}, { unlocked: LADDER });
  g("plant", T0, quiet(), { plot: 0, item: "moon-fern" });
  refused(() => g("feed_end", T0, quiet(), { count: 50 }), /Start a round/);
  assert.equal(g("feed_start").garden.feed.until_in, 10_000);
  const out = g("feed_end", T0 + 10_000, quiet(), { count: 1000 });
  assert.deepEqual(out.said, { feed: "done", presses: 123, minutes: 10, moved: 1 });
  assert.ok(out.garden.plots[0].ready_in === HOUR - 10_000 - 10 * MIN && out.garden.feed.until_in === null);
  refused(() => g("feed_start", T0 + 20_000), /ready again/);
  const later = T0 + 31 * MIN;
  g("feed_start", later);
  assert.equal(g("feed_end", later + 5000, quiet(), { count: 34 }).said.minutes, 3);
  g("feed_start", later + 31 * MIN);
  assert.equal(g("feed_end", later + 32 * MIN, quiet(), { count: 100 }).said.presses, 0);
});

// --------------------------------------------------------------------------- gifts
test("a harvest sometimes turns up a gift (the token pays SGC)", () => {
  reset();
  const harvest = (now, ...rolls) => { g("plant", now, quiet(), { plot: 0, item: "moondaisy" }); return g("trim", now + 2 * MIN, new Dice(rolls, { chance: 0 }), { plot: 0 }); };
  const tokenSgc = tuning.scalePayout("garden", "token", 150);                       // 150 native -> 30 SGC
  const token = harvest(T0, 0);
  assert.deepEqual(token.said.gift, { kind: "token", coins: tokenSgc });
  assert.equal(token.coins, 1000 + tokenSgc);
  assert.ok(eco.getEconomyDb().prepare("SELECT 1 FROM lumi_coin_refs WHERE ref = ?").get(`lumi-garden-token:${ME}:${T0 + 2 * MIN}`)); // erinne ref
  const again = harvest(T0 + HOUR, 0);                                               // not twice in a week
  assert.deepEqual(again.said.gift, { kind: "burst", powder: 30 });
  assert.equal(again.coins, 1000 + tokenSgc);
  const potion = harvest(T0 + 2 * HOUR, 3);
  assert.ok(potion.said.gift.kind === "potion" && potion.pet.potions === 1);
  pet.potions = G.POTION_CAP;
  assert.equal(harvest(T0 + 3 * HOUR, 3).said.gift.kind, "burst");
  const snack = harvest(T0 + 4 * HOUR, 15, 0);
  assert.deepEqual(snack.said.gift, { kind: "snack", item: "banana" });
  assert.equal(snack.pet.inventory.banana, 1);
  assert.equal(harvest(T0 + 5 * HOUR, 99).said.gift.kind, "burst");
  assert.equal(harvest(T0 + 8 * 24 * HOUR, 0).said.gift.kind, "token");
  g("plant", T0 + 9 * 24 * HOUR, quiet(), { plot: 0, item: "moondaisy" });
  assert.equal(g("trim", T0 + 9 * 24 * HOUR + 2 * MIN, quiet(), { plot: 0 }).said.gift, null);
});

test("a closed bank owes the token and says so", () => {
  reset();
  tuning.set("lumi.treasury.payoutsPaused", "true", "test");               // the admin pause
  g("plant", T0, quiet(), { plot: 0, item: "moondaisy" });
  const out = g("trim", T0 + 2 * MIN, new Dice([0], { chance: 0 }), { plot: 0 });
  assert.equal(out.said.gift.kind, "token");
  assert.equal(out.said.gift.coins, 0);
  assert.equal(out.said.gift.owed, tuning.scalePayout("garden", "token", 150));
  tuning.set("lumi.treasury.payoutsPaused", null, "test");                 // back to normal
});

// --------------------------------------------------------------------------- cosmetics and moonrise
test("fifteen slots hold five things to buy and ten from the capsule", () => {
  const slots = G.CATALOG.decor.slots;
  assert.ok(slots.length === 15 && slots.every((s) => s.items.length === 15));
  for (const slot of slots) {
    const sold = slot.items.filter((i) => i.rarity === "shop");
    const prizes = slot.items.filter((i) => i.rarity !== "shop").map((i) => i.rarity);
    assert.ok(sold.length === 5 && sold.every((i) => i.stardust > 0) && prizes.length === 10);
    assert.deepEqual(G.RARITIES.map((r) => prizes.filter((p) => p === r).length), [4, 3, 2, 1]);
    assert.equal(new Set(slot.items.map((i) => `${i.thing}|${i.a}|${i.b}`)).size, 15);
  }
  assert.ok(Object.values(G.LEGACY_DECOR).every((id) => id in G._DECOR));
});

test("decorations are bought with starpowder, put out, put away and sold", () => {
  reset();
  assert.deepEqual(look().decor, { placed: {}, owned: {}, spare: {} });
  assert.equal(G.CATALOG.decor.capsule.name, "Seedling Capsule");
  const fence = G._DECOR["fence-0-snowy"];
  const gold = G._DECOR["fence-0-golden"];
  refused(() => g("decor_buy", T0, quiet(), { item: "fence-0-snowy" }), /Not enough starpowder/);
  set({ powder: fence.stardust * 2 + gold.stardust });
  let out = g("decor_buy", T0, quiet(), { item: "fence-0-snowy" });
  assert.equal(out.coins, 1000);
  assert.deepEqual(out.garden.decor, { placed: { fence: "fence-0-snowy" }, owned: { "fence-0-snowy": 1 }, spare: { "fence-0-snowy": 0 } });
  out = g("decor_buy", T0, quiet(), { item: "fence-0-golden" });
  assert.deepEqual(out.garden.decor.placed, { fence: "fence-0-golden" });
  assert.deepEqual(out.garden.decor.spare, { "fence-0-snowy": 1, "fence-0-golden": 0 });
  refused(() => g("decor_sell", T0, quiet(), { item: "fence-0-golden" }), /spare one of those to sell/);
  assert.deepEqual(g("decor_place", T0, quiet(), { item: "fence-0-golden" }).said, { stored: "fence-0-golden" });
  assert.deepEqual(g("decor_place", T0, quiet(), { item: "fence-0-snowy" }).garden.decor.placed, { fence: "fence-0-snowy" });
  const sold = g("decor_sell", T0, quiet(), { item: "fence-0-golden" });
  assert.deepEqual(sold.said, { sold: "fence-0-golden", powder: Math.floor(gold.stardust / 2) });
  assert.ok(!("fence-0-golden" in sold.garden.decor.owned));
  assert.equal(sold.garden.powder, fence.stardust + Math.floor(gold.stardust / 2));
  refused(() => g("decor_place", T0, quiet(), { item: "fence-0-golden" }), /doesn't have that one yet/);
  refused(() => g("decor_buy", T0, quiet(), { item: "fence-1-starry" }), /only comes from the Seedling Capsule/);
  refused(() => g("decor_place", T0, quiet(), { item: "moondaisy" }), /isn't a decoration/);
});

test("the Seedling Capsule gives prizes by rarity and repeats go to the store", () => {
  reset();
  const rules = G.CATALOG.decor.capsule;
  look();
  refused(() => g("capsule"), /Not enough starpowder for a capsule/);
  set({ powder: rules.price * 4 });
  const first = g("capsule", T0, new Dice([0, 0]));
  const prize = G._PRIZES.common[0];
  assert.deepEqual(first.said, { capsule: prize.id, rarity: "common", copies: 1, paid: rules.price });
  assert.equal(first.coins, 1000);
  assert.deepEqual(first.garden.decor.placed, { [prize.slot]: prize.id });
  const again = g("capsule", T0, new Dice([0, 0]));
  assert.ok(again.said.copies === 2 && JSON.stringify(again.garden.decor.spare) === JSON.stringify({ [prize.id]: 1 }));
  assert.equal(g("decor_sell", T0, quiet(), { item: prize.id }).said.powder, rules.sell.common);
  const legend = g("capsule", T0, new Dice([99, 3]));
  assert.ok(legend.said.rarity === "legendary" && legend.said.capsule === G._PRIZES.legendary[3].id);
  assert.equal(g("capsule", T0, new Dice([60, 0])).said.rarity, "rare");
});

test("the first seven cosmetics become decorations", () => {
  reset();
  look();
  set({ cosmetics: ["garden-gnome", "golden-press", "long-gone-thing"] });
  const shown = look().decor;
  assert.deepEqual(shown.owned, { "statue-0-rosy": 1, "press-0-golden": 1 });
  assert.deepEqual(shown.placed, { statue: "statue-0-rosy", press: "press-0-golden" });
  assert.ok(!("cosmetics" in saved()));
});

test("moonrise replants one garden for an upgrade or another garden", () => {
  reset();
  look();
  refused(() => g("moonrise", T0, quiet(), { item: "strong-press" }), /isn't ready for a moonrise/);
  const full = { plots: Array.from({ length: 16 }, G._empty), unlocked: LADDER, given: 100_000, decor: { statue: "statue-0-rosy" } };
  set({ powder: 500, decor: { "statue-0-rosy": 1 }, helpers: Object.fromEntries(G.TREES.map((t) => [t, t === "monk" ? 3 : 0])) }, full);
  assert.deepEqual(look().moonrise, { needs: 100_000, ready: true, count: 0 });
  refused(() => g("moonrise", T0, quiet(), { item: "moondaisy" }), /Choose a permanent upgrade/);
  const out = g("moonrise", T0, quiet(), { item: "strong-press" }).garden;
  assert.ok(out.plots.length === 4 && out.given === 0);
  assert.deepEqual(out.flowers.filter((f) => f.unlocked).map((f) => f.id), ["moondaisy"]);
  assert.ok(out.upgrades[0].count === 1 && out.helpers[2].level === 3);
  assert.deepEqual(out.decor, { placed: {}, owned: { "statue-0-rosy": 1 }, spare: { "statue-0-rosy": 1 } });
  assert.deepEqual(out.moonrise, { needs: 200_000, ready: false, count: 1 });
  set({}, { ...full, given: 200_000 });
  const two = g("moonrise", T0, quiet(), { item: "garden" }).garden;
  assert.ok(two.gardens === 2 && two.at === 0 && two.plots.length === 4);
  set({ decor: { "statue-0-rosy": 2 } }, { unlocked: LADDER.slice(0, 3) });
  g("decor_place", T0, quiet(), { item: "statue-0-rosy" });
  const other = g("garden", T0, quiet(), { count: 1 }).garden;
  assert.ok(other.at === 1);
  assert.deepEqual(other.flowers.filter((f) => f.unlocked).map((f) => f.id), ["moondaisy"]);
  assert.deepEqual(other.decor.placed, {});
  assert.deepEqual(other.decor.spare, { "statue-0-rosy": 1 });
  assert.deepEqual(g("decor_place", T0, quiet(), { item: "statue-0-rosy" }).garden.decor.spare, { "statue-0-rosy": 0 });
  refused(() => g("plant", T0, quiet(), { plot: 0, item: "glowbell" }), /hasn't unlocked/);
  refused(() => g("garden", T0, quiet(), { count: 2 }), /doesn't have that garden/);
  set({ upgrades: { "rich-soil": 6 } }, { ...full, decor: {}, given: 10 ** 9 });
  refused(() => g("moonrise", T0, quiet(), { item: "rich-soil" }), /Choose a permanent upgrade/);
});

// --------------------------------------------------------------------------- reminders (for Phase 7 DMs)
test("readySince names a batch of slow flowers only, and only unseen ones", () => {
  reset();
  look();
  set({}, { unlocked: LADDER });
  g("plant", T0, quiet(), { plot: 0, item: "comet-clover" });                       // half an hour
  g("plant", T0, quiet(), { plot: 1, item: "moondaisy" });
  const state = () => G.current(ME, T0);
  assert.equal(G.readySince(state(), T0 + 10 * MIN), null);                          // a quick flower is never news
  assert.equal(G.readySince(state(), T0 + 31 * MIN), String(T0 + 30 * MIN));         // the clover
  g("look", T0 + 31 * MIN);                                                          // she saw it
  assert.equal(G.readySince(state(), T0 + 32 * MIN), null);
});

// --------------------------------------------------------------------------- pace
test("the numbers keep a gentle pace", () => {
  const rules = G.CATALOG.plots;
  const flowers = G.CATALOG.flowers;
  let plots = 0;
  for (let n = 0; n < rules.max - rules.start; n++) plots += G.pyRound(rules.price * rules.growth ** n);
  assert.ok(plots + flowers.reduce((s, f) => s + f.coins, 0) < 6000);
  const state = { coins_today: 0 };
  let powder = 8 * G._FLOWERS["little-sun"].powder * 3;
  let made = 0;
  while (powder >= G.price(state)) { powder -= G.price(state); state.coins_today += 1; made += 1; }
  assert.ok(made >= 100 && made <= 250);
  assert.ok(4 * flowers[0].powder * 5 >= flowers[1].needs);
  const best = 16 * Math.max(...flowers.map((f) => f.powder / f.minutes)) * 60 * 24;
  assert.ok(G.CATALOG.moonrise.needs < best * 3);
  assert.ok(flowers.slice(1).every((later, i) => later.needs < flowers[i].powder * 16 * 40));
});

test("Python round() is kept for plot prices (halves to even)", () => {
  assert.deepEqual([0.5, 1.5, 2.5, 2.4, 2.6, 31.25].map(G.pyRound), [0, 2, 2, 2, 3, 31]);
});
