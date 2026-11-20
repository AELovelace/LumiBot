// Lumi Holdings Inc. (LUMI) on Doll Street (src/privateStockStore.js): permanent listing that survives
// syncStockUniverse, a real treasury (__LUMI_HOLDINGS__), buys add to the reserve, sells and dividends respect the
// reserve floor, dividends pause while prizes are owed, and the 24 h sell lock still applies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, setBalance, resetLumi } from "./lumi_env.mjs";

const { eco, stock, db, sgc, tuning } = boot();                       // one in-memory DB for this file
const HOLD = "__LUMI_HOLDINGS__";                                     // the reserve / LUMI treasury
const INVESTOR = "666666666666666666";                                // a Discord-shaped player id
const bal = (id) => eco.getBalance(id);                               // shorthand
const lumiStock = () => stock.getStockByTicker("LUMI");               // the LUMI row

test("LUMI is listed once, as a permanent 'lumi' stock that doesn't take a synthetic slot", () => {
  const s = lumiStock();
  assert.equal(s.ticker, "LUMI");
  assert.equal(s.entity_type, "lumi");
  assert.equal(s.guild_id, HOLD);
  assert.equal(s.business_name, "Lumi Holdings Inc.");
  assert.equal(s.status, "active");
  assert.equal(s.is_listed, 1);
  const listed = stock.getAllStocks();                                // active + listed only
  assert.equal(listed.filter((x) => x.entity_type === "synthetic").length, 10); // all ten synthetic slots still filled
  assert.equal(listed.filter((x) => x.ticker === "LUMI").length, 1);
  assert.equal(listed[0].ticker, "LUMI");                             // first after guild stocks (there are none here)
});

test("LUMI survives syncStockUniverse, even after someone delists it by hand", () => {
  for (let i = 0; i < 3; i++) stock.syncStockUniverse();              // repeated syncs
  assert.equal(lumiStock().status, "active");
  eco.getEconomyDb().prepare("UPDATE bb_stocks SET status = 'delisted', is_listed = 0 WHERE ticker = 'LUMI'").run(); // knocked off
  stock.syncStockUniverse();                                          // the next sync puts it back
  assert.equal(lumiStock().status, "active");
  assert.equal(lumiStock().is_listed, 1);
  stock.ensureLumiHoldingsStock();                                    // idempotent
  assert.equal(eco.getEconomyDb().prepare("SELECT COUNT(*) AS n FROM bb_stocks WHERE ticker = 'LUMI'").get().n, 1);
});

test("the treasury is the real __LUMI_HOLDINGS__ balance, never synthetic_treasury", () => {
  resetLumi(eco);
  setBalance(eco, HOLD, 150000);
  eco.getEconomyDb().prepare("UPDATE bb_stocks SET synthetic_treasury = 999999 WHERE ticker = 'LUMI'").run(); // a decoy
  assert.equal(stock.getCorporateTreasuryBalance(lumiStock()), 150000);
  assert.equal(stock.getStockSummary(lumiStock().id).isLumi, true);
});

test("buying LUMI: 5% to Doll Street, the rest into the Lumi Holdings reserve", () => {
  resetLumi(eco);
  setBalance(eco, HOLD, 150000);
  setBalance(eco, INVESTOR, 10000);
  const doll = bal("__DOLL_STREET__");
  const r = stock.buyShares(INVESTOR, "Investor", lumiStock().id, 1000);
  assert.equal(r.success, true, r.error);
  assert.equal(r.fee, 50);
  assert.equal(bal(INVESTOR), 9000);
  assert.equal(bal("__DOLL_STREET__"), doll + 50);
  assert.equal(bal(HOLD), 150950);                                    // net 950 is reserve capital now
  const row = eco.getEconomyDb().prepare("SELECT * FROM transactions WHERE type = 'lumi_share_buy' ORDER BY id DESC").get();
  assert.equal(row.amount, 950);
  assert.equal(row.to_user_id, HOLD);
});

test("selling LUMI is refused when it would take Holdings under the reserve floor", () => {
  resetLumi(eco);
  setBalance(eco, HOLD, 150000);
  setBalance(eco, INVESTOR, 10000);
  stock.buyShares(INVESTOR, "Investor", lumiStock().id, 2000);       // buy some shares
  const shares = stock.getUserHolding(INVESTOR, lumiStock().id).shares;
  setBalance(eco, HOLD, 50000);                                       // the reserve sits on its floor
  const refused = stock.sellShares(INVESTOR, "Investor", lumiStock().id, shares);
  assert.equal(refused.success, false);
  assert.match(refused.error, /LUMI is illiquid/);
  assert.equal(bal(HOLD), 50000);                                     // nothing left the reserve
  setBalance(eco, HOLD, 60000);                                       // room above the floor again
  const before = bal(INVESTOR);
  const sold = stock.sellShares(INVESTOR, "Investor", lumiStock().id, shares);
  assert.equal(sold.success, true, sold.error);
  assert.equal(bal(INVESTOR), before + sold.proceeds);
  assert.equal(bal(HOLD), 60000 - sold.proceeds);
  assert.ok(bal(HOLD) >= 50000);
  const row = eco.getEconomyDb().prepare("SELECT * FROM transactions WHERE type = 'lumi_share_sell' ORDER BY id DESC").get();
  assert.equal(row.from_user_id, HOLD);
});

test("the 24 h sell lock still caps a LUMI sale at the price paid", () => {
  resetLumi(eco);
  setBalance(eco, HOLD, 150000);
  setBalance(eco, INVESTOR, 10000);
  const buy = stock.buyShares(INVESTOR, "Investor", lumiStock().id, 1000);
  stock.setSharePrice(lumiStock().id, buy.pricePerShare * 3);         // the price jumps
  const sold = stock.sellShares(INVESTOR, "Investor", lumiStock().id, buy.shares / 2);
  assert.equal(sold.success, true, sold.error);
  assert.equal(sold.priceLocked, true);
  assert.equal(sold.pricePerShare, buy.sellLockPrice);                // never above what was paid
});

test("dividends: only from the excess above the floor, at the LUMI rate, never while prizes are owed", () => {
  resetLumi(eco);
  eco.getEconomyDb().exec("DELETE FROM bb_shareholders");             // a clean register
  setBalance(eco, HOLD, 150000);
  setBalance(eco, INVESTOR, 100000);
  stock.buyShares(INVESTOR, "Investor", lumiStock().id, 50000);       // a real stake
  setBalance(eco, HOLD, 50000);                                       // on the floor: no excess
  let d = stock.distributeDividend(lumiStock().id);
  assert.equal(d.success, false);
  assert.match(d.error, /reserve floor/);
  setBalance(eco, HOLD, 150000);                                      // 100,000 above the floor
  const holder = stock.getUserHolding(INVESTOR, lumiStock().id);
  const before = bal(INVESTOR);
  d = stock.distributeDividend(lumiStock().id);
  assert.equal(d.success, true, d.error);
  assert.equal(d.pool, 2000);                                         // 2% of the 100,000 excess
  const perShare = 2000 / Math.max(holder.shares, 100);               // divided by at least the 100-share reference float
  assert.equal(d.distributed, Math.floor(holder.shares * perShare));
  assert.equal(bal(INVESTOR), before + d.distributed);
  assert.equal(bal(HOLD), 150000 - d.distributed);
  assert.ok(bal(HOLD) >= 50000);
  const big = stock.distributeDividend(lumiStock().id, 10 ** 9);      // an admin override can't break the floor either
  assert.ok(big.pool <= bal(HOLD) + big.distributed - 50000 + 1);
  tuning.setGame("prism", "dailyCap", 0, "test");
  setBalance(eco, HOLD, 50000);                                       // force an owed prize (bank empty, reserve on its floor)
  db.tx(() => sgc.pay(INVESTOR, "Investor", 500, "prism", "win", "lumi-prism:div"));
  setBalance(eco, HOLD, 150000);
  d = stock.distributeDividend(lumiStock().id);
  assert.equal(d.success, false);
  assert.match(d.error, /owes players prizes/);                       // prizes first
});

test("LUMI never takes promotional (minted) credits and its ticker is reserved", () => {
  const promo = stock.creditPromotionalValueForGuild(HOLD, 100);
  assert.equal(promo.success, false);
  const other = stock.renameTicker(stock.getAllStocks().find((s) => s.entity_type === "synthetic").id, "LUMI");
  assert.equal(other.success, false);                                 // someone else can't take LUMI
});
