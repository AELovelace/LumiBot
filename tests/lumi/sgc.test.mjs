// src/lumi/sgc.js + tuning.js: the only door to SadGirlCoin for the Lumi games. Scaling (server and the browser's
// lumi-tuning.js agree), spend, insufficient funds, rollback, pay-once refs, the daily cap, the payout pause, refunds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);
const { eco, db, sgc, tuning, errors } = boot();                      // one in-memory DB for this file
const ME = "111111111111111111";                                      // a Discord-shaped player id
const balance = (id) => eco.getBalance(id);                           // shorthand
const ledger = (type) => eco.getEconomyDb().prepare("SELECT * FROM transactions WHERE type = ? ORDER BY id").all(type); // rows of one type

test("play prices and prizes scale by 0.2, items by 1; 1 SGC minimum; free stays free; payouts floor", () => {
  resetLumi(eco);
  assert.equal(tuning.scale(), 0.2);                                  // the default play scale
  assert.equal(tuning.itemScale(), 1);                                // the default item scale (erinne's own prices)
  assert.equal(tuning.scalePrice("breakout", "entry", 25), 5);        // arcade entry 25 -> 5 (play)
  assert.equal(tuning.scalePrice("soft", "continue", 50), 10);        // continues 50 -> 10 (play)
  assert.equal(tuning.scalePrice("snake", "bet", 10), 2);             // a showdown bet chip 10 -> 2 (play)
  assert.equal(tuning.scalePrice("pet", "capsule", 150), 150);        // capsule 150 -> 150 (item)
  assert.equal(tuning.scalePrice("pet", "moon", 300), 300);           // moon capsule 300 -> 300 (item)
  assert.equal(tuning.scalePrice("pet", "snacks", 2), 2);             // an item at its native price
  assert.equal(tuning.scalePrice("pet", "snacks", 0), 0);             // a free snack stays free
  assert.equal(tuning.scalePayout("prism", "win", 9), 1);             // 1.8 floors to 1 (prize: play)
  assert.equal(tuning.scalePayout("prism", "win", 4), 0);             // 0.8 floors to 0 (allowed)
  assert.equal(tuning.scalePayout("pet", "visit", 25), 5);            // daily visit 25 -> 5 (prize: play)
  assert.equal(tuning.scalePayout("pet", "buyback", 75), 75);         // a capsule repeat gives back its value (item)
  assert.equal(tuning.scalePayout("pet", "movein", 40), 40);          // the move-in refund is an item value (item)
  assert.equal(tuning.priceBucket("entry"), "play");                  // the key decides the bucket
  assert.equal(tuning.priceBucket("cookie"), "item");                 // any shop item id
  assert.equal(tuning.payoutBucket("betwin"), "play");                // a prize
  assert.equal(tuning.payoutBucket("movein"), "item");                // an item value
});

test("the two scales move independently and the 1 SGC minimum holds in both buckets", () => {
  resetLumi(eco);
  tuning.set("lumi.itemScale", "0.5", "test");                        // halve item prices
  assert.equal(tuning.scalePrice("pet", "capsule", 150), 75);         // 150 x 0.5
  assert.equal(tuning.scalePrice("pet", "snacks", 1), 1);             // 0.5 rounds... never below 1
  assert.equal(tuning.scalePrice("breakout", "entry", 25), 5);        // play prices untouched
  assert.equal(tuning.scalePayout("pet", "buyback", 75), 37);         // 37.5 floors to 37
  assert.equal(tuning.scalePayout("pet", "visit", 25), 5);            // prizes untouched
  tuning.set("lumi.scale", "0.4", "test");                            // double play
  assert.equal(tuning.scalePrice("breakout", "entry", 25), 10);       // 25 x 0.4
  assert.equal(tuning.scalePrice("pet", "capsule", 150), 75);         // items untouched
  assert.equal(tuning.clientTuning().itemScale, 0.5);                 // the page gets both scales
  assert.equal(tuning.clientTuning().scale, 0.4);
});

test("per-game multipliers and per-item overrides; the browser formula matches the server", () => {
  resetLumi(eco);
  tuning.setGame("breakout", "priceMult", 2, "test");                 // double Yarn Pop prices
  tuning.setGame("breakout", "payoutOverrides", { win: 7 }, "test");  // an exact prize override
  tuning.setGame("pet", "priceOverrides", { capsule: 3 }, "test");    // an exact price override
  assert.equal(tuning.scalePrice("breakout", "entry", 25), 10);       // 25 x 0.2 x 2
  assert.equal(tuning.scalePayout("breakout", "win", 1000), 7);       // override wins over the formula
  assert.equal(tuning.scalePrice("pet", "capsule", 150), 3);          // override wins
  const client = require("../../public/lumi/lumi-tuning.js");        // the browser copy
  const keys = ["entry", "continue", "bet", "capsule", "moon", "cookie", "plot", "potion", "win", "betwin", "visit", "press", "buyback", "movein"]; // both buckets, prices and prizes
  for (const [play, item] of [[null, null], ["0.35", "0.7"], ["1.3", "0.15"]]) {   // defaults, then two uneven pairs
    tuning.set("lumi.scale", play, "test");                           // play scale (null = default 0.2)
    tuning.set("lumi.itemScale", item, "test");                       // item scale (null = default 1)
    globalThis.LUMI_TUNING = tuning.clientTuning();                   // what the page shell injects
    for (const game of ["breakout", "pet", "prism", "snake", "unknown-game"]) {
      for (const native of [0, 1, 2, 3, 7, 13, 25, 49, 50, 99, 150, 300, 1234, 99999]) {
        for (const key of keys) {
          assert.equal(client.LumiPrice(game, key, native), tuning.scalePrice(game, key, native), `price ${game}/${key}/${native} @${play}/${item}`);   // same charge
          assert.equal(client.LumiPayout(game, key, native), tuning.scalePayout(game, key, native), `payout ${game}/${key}/${native} @${play}/${item}`); // same prize
        }
      }
    }
  }
  delete globalThis.LUMI_TUNING;                                      // the client falls back to the defaults
  assert.equal(client.LumiPrice("pet", "capsule", 150), 150);         // default item scale 1
  assert.equal(client.LumiPrice("breakout", "entry", 25), 5);         // default play scale 0.2
  const settings = eco.getEconomyDb().prepare("SELECT COUNT(*) AS n FROM lumi_admin_log").get().n; // every change was logged
  assert.ok(settings >= 3);
});

test("spend moves the scaled price from the player to the category account with the right ledger type", () => {
  resetLumi(eco);
  setBalance(eco, ME, 200);                                           // the player has 200 SGC
  const charged = db.tx(() => sgc.spend(ME, "Doll", 25, "breakout", "entry")); // an arcade entry
  assert.equal(charged, 5);                                           // 25 x 0.2
  assert.equal(balance(ME), 195);                                     // taken from the player
  assert.equal(balance("__LUMI_ARCADE__"), 5);                        // landed in Lumi Arcade
  const row = ledger("lumi_breakout_entry").at(-1);                   // the ledger row
  assert.equal(row.from_user_id, ME);
  assert.equal(row.to_user_id, "__LUMI_ARCADE__");
  assert.equal(row.amount, 5);
  db.tx(() => sgc.spend(ME, "Doll", 100, "pet", "snacks"));           // pet snacks -> Snack Stand
  assert.equal(balance("__LUMI_SNACKS__"), 100);                     // an item: 100 x item scale 1
  db.tx(() => sgc.spend(ME, "Doll", 50, "city", "plot"));             // Lumi City -> Realty
  assert.equal(balance("__LUMI_REALTY__"), 50);                       // an item: 50 x item scale 1
  assert.equal(balance(ME), 45);                                      // 200 - 5 - 100 - 50
});

test("not enough SGC throws a 402 with need/have, and the whole transaction rolls back", () => {
  resetLumi(eco);
  setBalance(eco, ME, 2);                                             // too poor for a 5 SGC entry
  eco.getEconomyDb().exec("CREATE TABLE IF NOT EXISTS lumi_test_game (n INTEGER)"); // a pretend game table
  assert.throws(() => db.tx(() => {
    eco.getEconomyDb().prepare("INSERT INTO lumi_test_game (n) VALUES (1)").run(); // the game change...
    sgc.spend(ME, "Doll", 25, "breakout", "entry");                   // ...and its price
  }), (err) => err instanceof errors.LumiError && err.status === 402 && err.code === "not_enough_sgc" && err.extra.need === 5 && err.extra.have === 2);
  assert.equal(balance(ME), 2);                                       // nothing taken
  assert.equal(eco.getEconomyDb().prepare("SELECT COUNT(*) AS n FROM lumi_test_game").get().n, 0); // the game change rolled back too
});

test("a later failure rolls back an earlier spend", () => {
  resetLumi(eco);
  setBalance(eco, ME, 100);
  assert.throws(() => db.tx(() => { sgc.spend(ME, "Doll", 25, "breakout", "entry"); throw new Error("game blew up"); }), /game blew up/);
  assert.equal(balance(ME), 100);                                     // the charge was undone
  assert.equal(balance("__LUMI_ARCADE__"), 0);
});

test("guards: outside a transaction, bad amounts, bad ids, a closed game", () => {
  resetLumi(eco);
  setBalance(eco, ME, 100);
  assert.throws(() => sgc.spend(ME, "Doll", 25, "breakout", "entry"), /inside db\.tx/); // must be in tx()
  assert.throws(() => db.tx(() => sgc.spend(ME, "Doll", -5, "breakout", "entry")), TypeError); // negative native
  assert.throws(() => db.tx(() => sgc.spend(ME, "Doll", Number.NaN, "breakout", "entry")), TypeError); // NaN
  assert.throws(() => db.tx(() => sgc.spend(123, "Doll", 25, "breakout", "entry")), /Discord id string/); // numeric id
  assert.throws(() => db.tx(() => sgc.spend(ME, "Doll", 25, "Bad Game", "entry")), /bad game id/); // ledger-unsafe id
  assert.throws(() => db.tx(() => sgc.pay(ME, "Doll", 25, "prism", "win", "has space")), /bad ref/); // refs have no spaces
  tuning.setGame("snake", "enabled", false, "test");                  // an admin closes Lumi Conga
  assert.throws(() => db.tx(() => sgc.spend(ME, "Doll", 25, "snake", "entry")), (e) => e.status === 403 && e.code === "game_off");
  assert.equal(balance(ME), 100);                                     // nothing moved
});

test("pay scales, pays from Lumi-Town Bank once per ref, and reports duplicates", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 1000);                        // money in the bank
  setBalance(eco, ME, 0);
  const first = db.tx(() => sgc.pay(ME, "Doll", 250, "prism", "win", "lumi-prism:1")); // score 2500 / 10 = 250 native
  assert.deepEqual(first, { paid: 50, owed: 0, capped: false });      // 250 x 0.2
  assert.equal(balance(ME), 50);
  assert.equal(balance("__LUMI_TOWN_BANK__"), 950);
  const again = db.tx(() => sgc.pay(ME, "Doll", 250, "prism", "win", "lumi-prism:1")); // same run again
  assert.deepEqual(again, { paid: 0, owed: 0, capped: false, duplicate: true });
  assert.equal(balance(ME), 50);                                      // not paid twice
  assert.equal(ledger("lumi_prism_win").length, 1);
  const zero = db.tx(() => sgc.pay(ME, "Doll", 3, "prism", "win", "lumi-prism:2")); // 0.6 floors to 0
  assert.equal(zero.paid, 0);
  assert.equal(db.tx(() => sgc.pay(ME, "Doll", 500, "prism", "win", "lumi-prism:2")).duplicate, true); // a 0 payout still uses up its ref
});

test("the daily cap trims and then stops prizes, per game, per LA day", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 100000);
  setBalance(eco, ME, 0);
  tuning.setGame("teacup-tower", "dailyCap", 100, "test");            // games are uncapped by default: an admin sets a cap
  tuning.setGame("snake", "dailyCap", 100, "test");                   // and another game's own cap
  let now = Date.UTC(2026, 10, 19, 20, 0, 0);                         // 12:00 in Los Angeles
  db.setClock(() => now);                                             // fake clock
  try {
    assert.deepEqual(db.tx(() => sgc.pay(ME, "D", 400, "teacup-tower", "win", "tt:1")), { paid: 80, owed: 0, capped: false });  // 80 of 100
    assert.deepEqual(db.tx(() => sgc.pay(ME, "D", 400, "teacup-tower", "win", "tt:2")), { paid: 20, owed: 0, capped: true });   // trimmed to the cap
    assert.deepEqual(db.tx(() => sgc.pay(ME, "D", 400, "teacup-tower", "win", "tt:3")), { paid: 0, owed: 0, capped: true });    // nothing left today
    assert.equal(db.tx(() => sgc.pay(ME, "D", 400, "snake", "win", "sn:1")).paid, 80); // another game has its own cap
    now += 9 * 3600 * 1000;                                           // 21:00 LA: still the same LA day
    assert.equal(db.tx(() => sgc.pay(ME, "D", 400, "teacup-tower", "win", "tt:4")).paid, 0);
    now += 4 * 3600 * 1000;                                           // 01:00 LA next day
    assert.equal(db.tx(() => sgc.pay(ME, "D", 400, "teacup-tower", "win", "tt:5")).paid, 80); // a fresh day
    tuning.setGame("teacup-tower", "dailyCap", 0, "test");            // 0 = no cap
    assert.equal(db.tx(() => sgc.pay(ME, "D", 5000, "teacup-tower", "win", "tt:6")).paid, 1000);
    assert.equal(db.tx(() => sgc.pay(ME, "D", 5000, "teacup-tower", "win", "tt:7", { cap: false })).paid, 1000); // cap:false skips it too
  } finally {
    db.setClock(null);                                                // the real clock again
  }
});

test("payoutsPaused owes every prize instead of paying it", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 1000);
  setBalance(eco, ME, 0);
  tuning.set("lumi.treasury.payoutsPaused", "true", "test");          // the admin pause
  const r = db.tx(() => sgc.pay(ME, "Doll", 100, "prism", "win", "lumi-prism:p1"));
  assert.deepEqual(r, { paid: 0, owed: 20, capped: false });          // owed, not paid
  assert.equal(balance(ME), 0);
  const owed = eco.getEconomyDb().prepare("SELECT * FROM lumi_owed WHERE ref = ?").get("lumi-prism:p1");
  assert.equal(owed.amount, 20);
  assert.equal(owed.user_id, ME);
  assert.equal(db.tx(() => sgc.pay(ME, "Doll", 100, "prism", "win", "lumi-prism:p1")).duplicate, true); // an owed ref is still pay-once
  tuning.set("lumi.treasury.payoutsPaused", null, "test");            // back to normal
});

test("refund gives back an exact charge from the category account, once", () => {
  resetLumi(eco);
  setBalance(eco, ME, 100);
  const charged = db.tx(() => sgc.spend(ME, "Doll", 25, "launch", "entry")); // 5 SGC to the arcade
  const r = db.tx(() => sgc.refund(ME, "Doll", charged, "launch", "lumi-launch:refund:1", { kind: "entry" }));
  assert.deepEqual(r, { refunded: 5, owed: 0 });
  assert.equal(balance(ME), 100);                                     // whole again
  assert.equal(balance("__LUMI_ARCADE__"), 0);                        // taken back from the arcade
  assert.equal(db.tx(() => sgc.refund(ME, "Doll", charged, "launch", "lumi-launch:refund:1", { kind: "entry" })).duplicate, true);
  assert.equal(ledger("lumi_launch_refund").length, 1);
});

test("a refund after the shop was swept comes from the bank instead", () => {
  resetLumi(eco);
  setBalance(eco, ME, 100);
  setBalance(eco, "__LUMI_TOWN_BANK__", 50);
  const charged = db.tx(() => sgc.spend(ME, "Doll", 25, "launch", "entry")); // 5 SGC to the arcade
  setBalance(eco, "__LUMI_ARCADE__", 2);                              // most of it was swept away since
  const r = db.tx(() => sgc.refund(ME, "Doll", charged, "launch", "lumi-launch:refund:2", { kind: "entry" }));
  assert.deepEqual(r, { refunded: 5, owed: 0 });                      // 2 from the arcade + 3 from the bank
  assert.equal(balance("__LUMI_ARCADE__"), 0);
  assert.equal(balance("__LUMI_TOWN_BANK__"), 47);
});

test("balance reads a player's SGC, and moveCoins refuses junk and overdrafts", () => {
  resetLumi(eco);
  setBalance(eco, ME, 42);
  assert.equal(sgc.balance(ME), 42);
  assert.equal(sgc.balance("999"), 0);                                // no account yet
  assert.throws(() => eco.moveCoins(ME, "__LUMI_ARCADE__", 1.5, "lumi_test"), (e) => e.code === "bad_amount");
  assert.throws(() => eco.moveCoins(ME, "__LUMI_ARCADE__", 0, "lumi_test"), (e) => e.code === "bad_amount");
  assert.throws(() => eco.moveCoins(ME, "__LUMI_ARCADE__", 43, "lumi_test"), (e) => e.code === "insufficient_funds" && e.have === 42 && e.need === 43);
  assert.throws(() => eco.moveCoins("__LUMI_HOLDINGS__", ME, 1, "lumi_test"), (e) => e.code === "insufficient_funds"); // system accounts are checked too
  assert.throws(() => eco.moveCoins(ME, "nobody", 1, "lumi_test"), (e) => e.code === "no_receiver");
  assert.equal(balance(ME), 42);
});

test("transfer moves an exact SGC amount player to player: no scaling, no fee, pay-once, strict", () => {
  resetLumi(eco);
  const YOU = "222222222222222222";                                   // the seller
  setBalance(eco, ME, 500);                                           // the buyer has 500 SGC
  setBalance(eco, YOU, 10);                                           // the seller has 10
  tuning.setGame("city", "priceMult", 3, "test");                     // a price knob must NOT touch a player's own price
  const r = db.tx(() => sgc.transfer(ME, "Doll", YOU, "Jane", 321, "city", "trade", "lumi-plot:l-1-1:1:1")); // buy a listing
  assert.deepEqual(r, { moved: 321 });                                // exactly the list price
  assert.equal(balance(ME), 179);                                     // all of it from the buyer
  assert.equal(balance(YOU), 331);                                    // all of it to the seller (no 1% fee)
  const row = ledger("lumi_city_trade").at(-1);                       // one ledger row
  assert.equal(row.from_user_id, ME);
  assert.equal(row.to_user_id, YOU);
  assert.equal(row.amount, 321);
  assert.equal(row.fee, 0);
  assert.deepEqual(db.tx(() => sgc.transfer(ME, "Doll", YOU, "Jane", 321, "city", "trade", "lumi-plot:l-1-1:1:1")), { moved: 0, duplicate: true }); // pay-once
  assert.equal(balance(ME), 179);                                     // nothing moved the second time
  assert.throws(() => db.tx(() => sgc.transfer(ME, "Doll", YOU, "Jane", 180, "city", "trade", "lumi-plot:l-1-1:1:2")),
    (e) => e instanceof errors.LumiError && e.status === 402 && e.extra.need === 180 && e.extra.have === 179); // strict balance check
  assert.throws(() => db.tx(() => sgc.transfer(ME, "Doll", ME, "Doll", 5, "city", "trade", "lumi-plot:self")),
    (e) => e instanceof errors.LumiError && e.code === "self_trade"); // never to herself
  assert.throws(() => db.tx(() => sgc.transfer(ME, "Doll", YOU, "Jane", 1.5, "city", "trade", "x:1")), /whole SGC/); // junk amounts
  assert.throws(() => sgc.transfer(ME, "Doll", YOU, "Jane", 5, "city", "trade", "x:2"), /inside db\.tx/); // must be in a transaction
  assert.equal(balance(ME), 179);
  tuning.setGame("city", "priceMult", 1, "test");                     // back to normal
});

test("pay {exact:true} pays a stored SGC amount without scaling or overrides", () => {
  resetLumi(eco);
  setBalance(eco, "__LUMI_TOWN_BANK__", 10_000);
  setBalance(eco, ME, 0);
  tuning.setGame("city", "payoutOverrides", { sale: 1 }, "test");     // an override must not apply to an exact amount
  const r = db.tx(() => sgc.pay(ME, "Doll", 437, "city", "sale", "lumi-city:left:1:1:5", { exact: true, cap: false }));
  assert.deepEqual(r, { paid: 437, owed: 0, capped: false });         // exactly 437 SGC
  assert.equal(balance(ME), 437);
  assert.equal(db.tx(() => sgc.pay(ME, "Doll", 437, "city", "sale", "lumi-city:left:1:1:5", { exact: true, cap: false })).duplicate, true); // pay-once
  const scaled = db.tx(() => sgc.pay(ME, "Doll", 437, "city", "sale", "lumi-city:left:1:1:6", { cap: false })); // without exact: the override
  assert.equal(scaled.paid, 1);
  assert.throws(() => db.tx(() => sgc.pay(ME, "Doll", 2.5, "city", "sale", "lumi-city:x", { exact: true })), /whole SGC/); // exact needs whole SGC
  tuning.setGame("city", "payoutOverrides", {}, "test");              // back to normal
});
