// src/lumi/treasury.js: the sliding-scale sweep (every band), overflow to Lumi Holdings, the emergency-draw order,
// the reserve floor, owed prizes paid by a later sweep, the one-time seed, and that nothing is ever minted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const { eco, db, sgc, tuning, treasury } = boot();                    // one in-memory DB for this file
const ME = "222222222222222222";                                      // a Discord-shaped player id
const BANK = "__LUMI_TOWN_BANK__", HOLD = "__LUMI_HOLDINGS__";         // short names
const bal = (id) => eco.getBalance(id);                               // shorthand
const total = () => eco.getEconomyDb().prepare("SELECT SUM(balance) AS s FROM accounts").get().s; // all SGC in existence

test("every sweep band takes its share of each shop", () => {
  const bands = [                                                     // [bank health, expected rate]
    [0.10, 1], [0.24, 1],                                             // below 25%: 100%
    [0.25, 0.75], [0.49, 0.75],                                       // 25-50%: 75%
    [0.50, 0.5], [0.99, 0.5],                                         // 50-100%: 50%
    [1.00, 0.25], [1.49, 0.25],                                       // 100-150%: 25%
    [1.50, 0.1], [1.90, 0.1],                                         // 150%+: 10%
  ];
  for (const [health, rate] of bands) {
    resetLumi(eco);
    setBalance(eco, BANK, Math.round(100000 * health));               // target is 100,000
    setBalance(eco, "__LUMI_SNACKS__", 1000);                         // two shops with money
    setBalance(eco, "__LUMI_ARCADE__", 333);
    const before = total();                                           // nothing may be minted
    const r = treasury.sweep();
    assert.equal(r.rate, rate, `rate at health ${health}`);
    assert.equal(bal("__LUMI_SNACKS__"), 1000 - Math.floor(1000 * rate), `snacks at health ${health}`);
    assert.equal(bal("__LUMI_ARCADE__"), 333 - Math.floor(333 * rate), `arcade at health ${health}`);
    assert.equal(r.swept, Math.floor(1000 * rate) + Math.floor(333 * rate));
    assert.equal(bal(BANK), Math.round(100000 * health) + r.swept);   // all of it went to the bank
    assert.equal(total(), before);                                    // conserved
  }
});

test("custom bands from the settings, with Infinity written as null", () => {
  resetLumi(eco);
  tuning.set("lumi.treasury.bands", JSON.stringify([[0.5, 0.9], [null, 0.05]]), "test"); // two bands
  setBalance(eco, BANK, 10000);                                       // health 0.1
  setBalance(eco, "__LUMI_NURSERY__", 100);
  assert.equal(treasury.sweep().rate, 0.9);
  setBalance(eco, BANK, 90000);                                       // health 0.9
  assert.equal(treasury.sweep().rate, 0.05);
  assert.throws(() => tuning.set("lumi.treasury.bands", "not json at all {", "test"), SyntaxError); // junk is refused when saved
});

test("broken band settings fall back to the defaults", () => {
  assert.deepEqual(tuning.parseBands("[[2,0.5],[1,0.1]]"), tuning.DEFAULT_BANDS.map((b) => [...b])); // not ascending
  assert.deepEqual(tuning.parseBands("[[0.5, 7]]"), tuning.DEFAULT_BANDS.map((b) => [...b]));        // rate above 1
  assert.deepEqual(tuning.parseBands("[[0.5, 0.2]]"), [[0.5, 0.2], [Infinity, 0.2]]);                 // an open top is added
});

test("the bank overflows into Lumi Holdings above its ceiling", () => {
  resetLumi(eco);
  setBalance(eco, BANK, 250000);                                      // ceiling is 200,000
  setBalance(eco, HOLD, 1000);
  const before = total();
  const r = treasury.sweep();
  assert.equal(r.overflow, 50000);
  assert.equal(bal(BANK), 200000);
  assert.equal(bal(HOLD), 51000);
  assert.equal(total(), before);
  const row = eco.getEconomyDb().prepare("SELECT * FROM transactions WHERE type = 'lumi_overflow' ORDER BY id DESC").get();
  assert.equal(row.from_user_id, BANK);
  assert.equal(row.to_user_id, HOLD);
});

test("emergency draws: shops richest first, then Holdings down to its floor, inside the payout's transaction", () => {
  resetLumi(eco);
  tuning.setGame("prism", "dailyCap", 0, "test");                     // no cap for this test
  setBalance(eco, BANK, 10);                                          // nearly empty bank
  setBalance(eco, "__LUMI_SNACKS__", 500);
  setBalance(eco, "__LUMI_ARCADE__", 2000);
  setBalance(eco, HOLD, 60000);                                       // 10,000 above the 50,000 floor
  setBalance(eco, ME, 0);
  const before = total();
  const r = db.tx(() => sgc.pay(ME, "Doll", 5000, "prism", "win", "lumi-prism:e1")); // 5000 x 0.2 = 1000 SGC
  assert.deepEqual(r, { paid: 1000, owed: 0, capped: false });
  // need = shortfall 990 + buffer 10% of 100,000 = 10,990: arcade 2000, snacks 500, then Holdings 8490.
  const draws = eco.getEconomyDb().prepare("SELECT from_user_id, amount FROM transactions WHERE type = 'lumi_emergency_draw' ORDER BY id").all();
  assert.deepEqual(draws, [
    { from_user_id: "__LUMI_ARCADE__", amount: 2000 },
    { from_user_id: "__LUMI_SNACKS__", amount: 500 },
    { from_user_id: HOLD, amount: 8490 },
  ]);
  assert.equal(bal(HOLD), 51510);                                     // never under the floor
  assert.equal(bal(BANK), 10000);                                     // 10 + 10,990 - 1,000
  assert.equal(bal(ME), 1000);
  assert.equal(total(), before);
  assert.throws(() => treasury.ensureCovers(1), /inside the caller's tx/); // draws only ever happen inside a payout's transaction
});

test("at the reserve floor nothing is drawn from Holdings and the prize is owed", () => {
  resetLumi(eco);
  tuning.setGame("prism", "dailyCap", 0, "test");
  setBalance(eco, HOLD, 50000);                                       // exactly the floor
  setBalance(eco, ME, 0);
  const r = db.tx(() => sgc.pay(ME, "Doll", 500, "prism", "win", "lumi-prism:f1")); // 100 SGC
  assert.deepEqual(r, { paid: 0, owed: 100, capped: false });
  assert.equal(bal(HOLD), 50000);                                     // untouched
  assert.equal(bal(ME), 0);
  assert.equal(treasury.status().owed.count, 1);
});

test("a later sweep pays owed prizes oldest first while the bank has money", () => {
  resetLumi(eco);
  tuning.setGame("prism", "dailyCap", 0, "test");
  const A = "333333333333333333", B = "444444444444444444";
  setBalance(eco, HOLD, 50000);
  db.tx(() => sgc.pay(A, "A", 500, "prism", "win", "lumi-prism:o1")); // 100 owed to A
  db.tx(() => sgc.pay(B, "B", 1000, "prism", "win", "lumi-prism:o2")); // 200 owed to B
  assert.equal(treasury.status().owed.total, 300);
  setBalance(eco, BANK, 250);                                         // enough for A, not B
  let r = treasury.sweep();                                           // health 0.25% -> takes 100% of shops (none)
  assert.equal(r.owedPaid, 1);
  assert.equal(bal(A), 100);
  assert.equal(bal(B), 0);                                            // B waits (oldest-first, no skipping)
  setBalance(eco, BANK, 1000);
  r = treasury.sweep();
  assert.equal(r.owedPaid, 1);
  assert.equal(bal(B), 200);
  assert.equal(treasury.status().owed.count, 0);
  const ref = eco.getEconomyDb().prepare("SELECT amount FROM lumi_coin_refs WHERE ref = 'lumi-prism:o2'").get();
  assert.equal(ref.amount, 200);                                      // the ref now shows it paid
  assert.equal(eco.getEconomyDb().prepare("SELECT COUNT(*) AS n FROM transactions WHERE type = 'lumi_owed_paid'").get().n, 2);
});

test("owed prizes stay owed while payouts are paused", () => {
  resetLumi(eco);
  const C = "555555555555555555";
  tuning.set("lumi.treasury.payoutsPaused", "true", "test");
  setBalance(eco, BANK, 10000);
  db.tx(() => sgc.pay(C, "C", 100, "pet", "visit", "lumi-pet:x:2026-11-19"));
  assert.equal(treasury.sweep().owedPaid, 0);                         // paused: nothing paid
  tuning.set("lumi.treasury.payoutsPaused", "false", "test");
  assert.equal(treasury.sweep().owedPaid, 1);                         // unpaused: paid
  assert.equal(bal(C), 20);
});

test("spends land in the right themed account, and an unmapped game falls back to the bank", () => {
  resetLumi(eco);
  const cases = [["pet", "snacks", "__LUMI_SNACKS__"], ["pet", "boutique", "__LUMI_BOUTIQUE__"], ["pet", "capsule", "__LUMI_CAPSULES__"],
    ["battle", "shop", "__LUMI_OUTFITTERS__"], ["garden", "shop", "__LUMI_NURSERY__"], ["soft", "continue", "__LUMI_ARCADE__"],
    ["teacup-tower", "entry", "__LUMI_ARCADE__"], ["city", "style", "__LUMI_REALTY__"], ["mystery", "thing", BANK]];
  for (const [game, kind, account] of cases) assert.equal(treasury.categoryAccount(game, kind).accountId, account, `${game}:${kind}`);
  treasury.setCategory("arcade", { games: ["prism", "launch", "soft", "breakout", "snake", "teacup-tower", "mystery"] }, "test"); // admins can remap
  assert.equal(treasury.categoryAccount("mystery", "thing").accountId, "__LUMI_ARCADE__");
});

test("the one-time seed checks Central Bank first and only runs once", () => {
  resetLumi(eco);
  setBalance(eco, "__CENTRAL_BANK__", 100);
  assert.throws(() => treasury.seed(250000, 100000, 150000, { who: "test" }), (e) => e.status === 402); // Central Bank is short
  assert.throws(() => treasury.seed(1, 100000, 150000), (e) => e.code === "bad_amount");                 // the double check
  setBalance(eco, "__CENTRAL_BANK__", 1000000);
  const r = treasury.seed(250000, 100000, 150000, { who: "test" });
  assert.equal(r.centralBankLeft, 750000);
  assert.equal(bal(BANK), 100000);
  assert.equal(bal(HOLD), 150000);
  assert.throws(() => treasury.seed(250000, 100000, 150000), (e) => e.code === "already_seeded"); // once only
  const s = treasury.status();
  assert.ok(s.seededAt > 0);
  assert.equal(s.bank.health, 1);
  assert.equal(s.holdings.excess, 100000);
  assert.equal(s.accounts.length, 9);
  assert.ok(s.accounts.find((a) => a.id === BANK).in24h >= 100000);   // the seed shows in the 24 h flows
});

test("the scheduler starts, stops and never keeps the process alive", () => {
  treasury.start();
  assert.equal(treasury.status().scheduler.running, true);
  treasury.stop();
  assert.equal(treasury.status().scheduler.running, false);
});
