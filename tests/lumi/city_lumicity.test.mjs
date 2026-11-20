// src/lumi/city/lumicity.js + routes/city.js: erinne tests/test_lumicity.py at spec level, in SGC. The map and estate
// data checks, flats, prices and streets, buying from the office (spend city/plot), one plot each, growing towns,
// listings bought player-to-player (sgc.transfer), selling to the office (sgc.pay exact), styles, yards, the Keepsake
// Capsule, her house's own rooms, Lumi Heights and the HTTP routes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";
import { serve, client, wait } from "./pet_http.mjs";

const require = createRequire(import.meta.url);
const { eco, lumi, db, errors } = boot();                              // in-memory economy + Lumi
const lc = require("../../src/lumi/city/lumicity.js");                // the module under test
const lp = require("../../src/lumi/pet/lumipet.js");                  // the pet
const save = require("../../src/lumi/pet/save.js");                   // the save model
const users = require("../../src/lumi/users.js");                     // names
const srv = await serve(lumi);                                          // a throwaway server
after(() => { lumi.stopLumiGames(); srv.close(); });
let next = 0;                                                           // fresh players
const newPlayer = (coins = 100_000, name = "P") => { const id = String(333333333333333000n + BigInt(next++)); setBalance(eco, id, coins); users.remember(id, `${name}${next}`); return id; };
const act = (uid, action, opts = {}) => db.tx(() => lc.act(uid, action, opts)); // one city action
const balance = (id) => eco.getBalance(id);                             // SGC
const refused = (fn, re) => assert.throws(fn, (e) => e instanceof lp.PetError && re.test(e.message)); // her words
const clone = (o) => JSON.parse(JSON.stringify(o));                     // a copy to break
const plots = () => eco.getEconomyDb().prepare("SELECT * FROM lumi_plots").all(); // every owned plot
const ITEM_SCALE = 1;                                                   // the default lumi.itemScale: city plots, styles, yard and the capsule are items
const itemSgc = (native) => Math.max(1, Math.round(native * ITEM_SCALE)); // an item price by the rule (min 1)

test("the shipped city and estate are valid, and broken ones are refused", () => {
  assert.equal(lc.ESTATE.styles.length, 30);
  assert.equal(lc._KEEPSAKES.length, 50);                               // 10 per slot
  const city = lc.CITY;
  for (const [what, change] of [
    ["rows", (c) => { c.rows = 2; }],
    ["ragged", (c) => { c.downtown.rows[0] += "."; }],
    ["lots", (c) => { c.template.lots.pop(); }],
    ["price", (c) => { c.price.decay = 2; }],
    ["towns", (c) => { delete c.towns.left; }],
  ]) assert.throws(() => lc.loadCity((() => { const c = clone(city); change(c); return c; })()), Error, what);
  const est = clone(lc.ESTATE); est.styles[1].price = 0;
  assert.throws(() => lc.loadEstate(est), /only free one/);
  const est2 = clone(lc.ESTATE); est2.capsule.odds.common += 1;
  assert.throws(() => lc.loadEstate(est2), /add up to 100/);
  for (const p of lc._KEEPSAKES) assert.ok(!lp._PRIZES.some((x) => x.id === p.id)); // never in Lumi Pet's capsules
});

test("flats are numbered in the order Lumis arrive and never move; 8 doors a floor", () => {
  assert.deepEqual(lc.aptOfNumber(1), { floor: 1, door: 1, label: "1A" });
  assert.deepEqual(lc.aptOfNumber(9), { floor: 2, door: 1, label: "2A" });
  assert.deepEqual(lc.aptOfNumber(12), { floor: 2, door: 4, label: "2D" });
  const a = newPlayer(), b = newPlayer();
  db.tx(() => lp.state(a)); db.tx(() => lp.state(b));
  const na = lc.flatNumber(a), nb = lc.flatNumber(b);
  assert.equal(nb, na + 1);
  assert.equal(lc.flatOwner(na), a);
  assert.equal(lc.flatNumber(a), na);                                   // never moves
});

test("suggested prices fall away from Downtown, the avenue costs more; lot ids and street names", () => {
  assert.equal(lc.suggested("left", 1, 1), lc.suggested("right", 1, 1));
  assert.ok(lc.suggested("left", 1, 1) > lc.suggested("left", 3, 1));
  assert.ok(lc.suggested("left", 99, 1) >= lc.CITY.price.floor);
  const avenue = Object.values(lc._LOTS).find((l) => l.frontage === "avenue").lot, lane = Object.values(lc._LOTS).find((l) => l.frontage === "lane").lot;
  assert.ok(lc.suggested("left", 1, avenue) > lc.suggested("left", 1, lane));
  assert.equal(lc.suggestedSgc("left", 1, 1), itemSgc(lc.suggested("left", 1, 1))); // a plot is an item: erinne's own price
  assert.deepEqual(lc.parse("l-3-5"), ["left", 3, 5]);
  refused(() => lc.parse("x-1-1"), /isn't a plot/);
  refused(() => lc.parse("l-0-1"), /isn't a plot/);
  const lanes = lc.CITY.towns.left.lanes;
  assert.equal(lc.street("left", 1), lanes[0]);
  assert.equal(lc.street("left", lanes.length + 1), `${lanes[0]} II`);
  assert.equal(lc.lots({ left: 1, right: 1 }).length, 16);
});

test("buying from the office charges the scaled price to Lumi City Realty; one plot each; a taken lot is refused", () => {
  resetLumi(eco);
  const a = newPlayer(), b = newPlayer();
  const cost = lc.suggestedSgc("left", 1, 2);                           // SGC
  const out = act(a, "buy", { plot: "l-1-2" });
  assert.deepEqual([out.said.bought, out.said.paid, out.me.plot, out.me.home_town], ["l-1-2", cost, "l-1-2", "left"]);
  assert.equal(balance(a), 100_000 - cost);
  assert.equal(balance("__LUMI_REALTY__"), cost);
  assert.equal(plots().find((p) => p.user_id === a).paid, cost);       // the SGC actually charged
  assert.ok(out.me.styles.includes(lc.STARTER));
  refused(() => act(a, "buy", { plot: "l-1-2" }), /already mine/);
  refused(() => act(b, "buy", { plot: "l-1-2" }), /Someone already lives there/);
  refused(() => act(a, "buy", { plot: "l-1-3" }), /already got a home/);
  refused(() => act(b, "buy", { plot: "l-99-1" }), /isn't built yet/);
  refused(() => act(a, "home_town", { item: "right" }), /My house is in LefTown/);
});

test("someone who can't afford a plot changes nothing (402)", () => {
  const poor = newPlayer(5);
  assert.throws(() => act(poor, "buy", { plot: "r-1-1" }), (e) => e instanceof errors.LumiError && e.status === 402 && /can't afford/.test(e.message));
  assert.equal(balance(poor), 5);
  assert.ok(!plots().some((p) => p.user_id === poor));
  assert.equal((save.peek(poor) || {}).home_town ?? null, null);
});

test("a full town grows a block at its gate and every lot keeps its id", () => {
  const blocks = db.tx(() => lc.towns()).right;                         // start size
  const fill = eco.getEconomyDb().prepare("INSERT INTO lumi_plots (town, block, lot, user_id, style, yard, paid, bought_at) VALUES ('right', ?, ?, ?, 'x', '{}', 1, 1)");
  let left = null;                                                      // the one lot we leave for a real buyer
  for (let b = 1; b <= blocks; b += 1) for (let l = 1; l <= 8; l += 1) {
    if (eco.getEconomyDb().prepare("SELECT 1 FROM lumi_plots WHERE town='right' AND block=? AND lot=?").get(b, l)) continue;
    if (left === null) { left = `r-${b}-${l}`; continue; }
    fill.run(b, l, newPlayer());
  }
  const buyer = newPlayer();
  assert.equal(act(buyer, "buy", { plot: left }).said.expanded, true);
  assert.equal(lc._blocks().right, blocks + 1);
  assert.equal(lc.view(buyer).lots.filter((l) => l.town === "right").length, (blocks + 1) * 8);
});

test("listing stays in range (SGC); a listing is bought player to player at its exact price; a stale look is refused", () => {
  resetLumi(eco);
  const seller = newPlayer(100_000, "Seller"), buyer = newPlayer(100_000, "Buyer");
  act(seller, "buy", { plot: "l-2-3" });
  const worth = lc.suggestedSgc("left", 2, 3);
  const low = Math.ceil(worth * lc.CITY.price.list_min), high = Math.floor(worth * lc.CITY.price.list_max);
  refused(() => act(seller, "list", { price: low - 1 }), new RegExp(`${low} to ${high} SGC`));
  refused(() => act(seller, "list", { price: high + 1 }), /list it for/);
  act(seller, "style_buy", { item: lc.ESTATE.styles[1].id });           // something she keeps
  const listed = act(seller, "list", { price: low + 7 });
  const row = listed.lots.find((l) => l.id === "l-2-3");
  assert.equal(row.list_price, low + 7);
  refused(() => act(buyer, "buy_listing", { plot: "l-2-3", price: low + 8, version: row.version }), /changed the price/);
  refused(() => act(buyer, "buy_listing", { plot: "l-2-3", price: low + 7, version: row.version - 1 }), /changed the price/);
  refused(() => act(seller, "buy_listing", { plot: "l-2-3", price: low + 7, version: row.version }), /my own plot/);
  const before = [balance(seller), balance(buyer)];
  const bought = act(buyer, "buy_listing", { plot: "l-2-3", price: low + 7, version: row.version });
  assert.equal(bought.said.paid, low + 7);
  assert.equal(balance(seller), before[0] + low + 7);                   // exact, no fee
  assert.equal(balance(buyer), before[1] - low - 7);
  assert.equal(plots().find((p) => p.town === "left" && p.block === 2 && p.lot === 3).user_id, buyer);
  assert.ok(lc.view(seller).me.styles.includes(lc.ESTATE.styles[1].id)); // the seller keeps her styles
  const ledger = eco.getEconomyDb().prepare("SELECT * FROM transactions WHERE type = 'lumi_city_trade'").all();
  assert.equal(ledger.at(-1).fee, 0);
  const poor = newPlayer(1);
  act(buyer, "list", { price: low });
  const again = lc.view(buyer).lots.find((l) => l.id === "l-2-3");
  assert.throws(() => act(poor, "buy_listing", { plot: "l-2-3", price: low, version: again.version }), (e) => e.status === 402);
  refused(() => act(buyer, "unlist", {}) && act(buyer, "unlist", {}), /isn't on the market/);
});

test("selling to the office pays half the office price in exact SGC, once, and keeps her things", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  const a = newPlayer(100_000);
  act(a, "buy", { plot: "l-1-4" });
  act(a, "yard_buy", { item: lc.ESTATE.yard.fence.find((i) => i.price).id });
  const worth = lc.suggestedSgc("left", 1, 4);
  const before = balance(a);
  const sold = act(a, "sell", {});
  assert.equal(sold.said.paid, Math.floor(worth * 0.5 + 0.5));
  assert.equal(balance(a), before + sold.said.paid);
  assert.equal(sold.me.plot, null);
  assert.equal(sold.me.yard.length, 1);                                 // her yard piece is still hers
  refused(() => act(a, "sell", {}), /haven't got a plot/);
});

test("house styles are bought once and put up on her own plot; yard pieces are sold or rolled and go in their own slot", () => {
  const a = newPlayer(100_000);
  const style = lc.ESTATE.styles[2];
  refused(() => act(a, "style_set", { item: style.id }), /haven't got that house style/);
  assert.equal(act(a, "style_buy", { item: style.id }).said.paid, itemSgc(style.price)); // a house style is an item
  refused(() => act(a, "style_buy", { item: style.id }), /already got that one/);
  refused(() => act(a, "style_set", { item: style.id }), /need a plot first/);
  act(a, "buy", { plot: "l-1-5" });
  assert.equal(act(a, "style_set", { item: style.id }).lots.find((l) => l.id === "l-1-5").style, style.id);
  const fence = lc.ESTATE.yard.fence.find((i) => i.price), rare = lc.ESTATE.yard.fence.find((i) => !i.price);
  refused(() => act(a, "yard_buy", { item: rare.id }), /only comes from the Keepsake Capsule/);
  act(a, "yard_buy", { item: fence.id });
  refused(() => act(a, "yard_set", { slot: "mailbox", item: fence.id }), /doesn't go there/);
  assert.equal(act(a, "yard_set", { slot: "fence", item: fence.id }).lots.find((l) => l.id === "l-1-5").yard.fence, fence.id);
  assert.equal(act(a, "yard_set", { slot: "fence", item: "" }).lots.find((l) => l.id === "l-1-5").yard.fence, "");
  refused(() => act(a, "yard_set", { slot: "pool", item: "" }), /isn't a spot/);
});

test("the Keepsake Capsule rolls a rarity then a piece; a repeat pays back half; it stops before charging when all is hers", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 100_000);
  const a = newPlayer(100_000);
  const rng = () => 0;                                                  // always the first common
  const first = act(a, "capsule", { rng });
  assert.deepEqual([first.said.rarity, first.said.duplicate, first.said.paid], ["common", false, itemSgc(200)]); // 200 native -> 200 SGC (item)
  const again = act(a, "capsule", { rng });
  assert.equal(again.said.duplicate, true);
  assert.equal(again.said.buyback, Math.floor(Math.floor(lc.ESTATE.values.common / 2) * ITEM_SCALE)); // half its value back, at the item scale
  const b = newPlayer(100_000);
  db.tx(() => { const pet = lp.load(b); lp.estateOf(pet).yard = lc._KEEPSAKES.map((p) => p.id); lp._save(b, pet); });
  const held = balance(b);
  refused(() => act(b, "capsule", {}), /everything the Keepsake Capsule holds/);
  assert.equal(balance(b), held);
});

test("her house has its own rooms, furnished from the same furniture", () => {
  const a = newPlayer(100_000);
  const spot = lp.HOUSE.spots.find((s) => !s.same_as && s.items[0].price === 0 && !s.items[0].worn && s.items.some((i) => i.price)); // a spot with a free first piece
  const piece = spot.items.find((i) => i.price);                         // and one for sale
  db.tx(() => lp.act(a, "decorate", { item: piece.id }));               // bought for the flat
  act(a, "buy", { plot: "l-1-6" });
  const other = spot.items[0];                                           // the free first piece
  const out = db.tx(() => lp.act(a, "decorate", { item: other.id, home: "house" }));
  assert.equal(out.said, null);                                         // free first piece
  assert.equal(out.pet.estate.rooms[spot.id], other.id);
  assert.equal(out.pet.house[spot.id], piece.id);                            // the flat keeps its own
  assert.equal(lp.houseView(a, "house").house[spot.id], other.id);
  assert.equal(lp.houseView(a, "house").boxes, 0);
});

test("the city and the estate over HTTP; Lumi Heights lists floors and hides closed doors", async () => {
  resetLumi(eco);
  const aId = newPlayer(100_000, "Ada"), bId = newPlayer(100_000, "Bea");
  const a = client(srv.port, aId, "Ada"), b = client(srv.port, bId, "Bea");
  await a.get("lumi-pet/state"); await b.get("lumi-pet/state");          // both have a Lumi
  const city = (await a.get("lumi-pet/city")).json;
  assert.deepEqual(Object.keys(city).sort(), ["catalog", "layout", "lots", "me", "towns"]);
  assert.equal(city.me.id, aId);
  const bs = await b.stream("lumi-pet/town/stream");
  await wait(30);
  const bought = await a.post("lumi-pet/estate", { action: "buy", plot: "l-2-7" });
  assert.equal(bought.status, 200);
  assert.equal(bought.json.said.paid, lc.suggestedSgc("left", 2, 7));
  await wait(30);
  assert.match(bs.text, /event: city/);                                  // everyone fetches the city again
  assert.equal((await a.post("lumi-pet/estate", { action: "buy", plot: "l-2-8" })).status, 400); // one each
  assert.equal((await a.post("lumi-pet/estate", { action: "buy", plot: "q-1-1" })).status, 422);
  assert.equal((await a.post("lumi-pet/estate", { action: "list", price: "5" })).status, 422);
  const heights = (await b.get("lumi-pet/heights/left")).json;
  assert.ok(heights.floors.includes(lc.apartment(aId).floor));           // Ada's home town is LefTown (her plot)
  const apt = lc.apartment(aId);
  const hall = (await b.get(`lumi-pet/heights/left/${apt.floor}`)).json;
  assert.equal(hall.doors.length, 8);
  assert.equal(hall.doors[apt.door - 1].id, aId);
  await a.post("lumi-pet/act", { action: "door", item: "closed" });
  const shut = (await b.get(`lumi-pet/heights/left/${apt.floor}`)).json;
  assert.equal(shut.doors[apt.door - 1].name, null);                     // a closed door keeps its name to itself
  assert.equal((await b.get("lumi-pet/heights/middle")).status, 422);
  assert.equal((await b.get("lumi-pet/heights/left/0")).status, 404);
  const house = await b.get(`lumi-pet/houses/${aId}?home=house`);
  assert.equal(house.status, 403);                                       // a closed door for her house too
  await a.post("lumi-pet/act", { action: "door", item: "open" });
  const visit = (await b.get(`lumi-pet/houses/${aId}?home=house`)).json;
  assert.deepEqual([visit.access, visit.plot], ["in", "l-2-7"]);
  assert.equal((await b.get(`lumi-pet/houses/${bId}?home=house`)).status, 404); // no land, no house
  bs.close();
});
