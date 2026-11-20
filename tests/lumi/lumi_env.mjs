// Test helper (not a test file itself): boots the economy store, the private stock exchange and Lumi-Town on a
// throwaway in-memory SQLite database, the way src/index.js does at start-up. Each test file runs in its own
// process under `node --test`, so each file gets its own fresh database.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error"; // keep test output quiet (only real errors print)

/** Boot everything once and hand back the modules tests poke at. */
export function boot() {
  const eco = require("../../src/sadgirlEconomyStore.js");      // SadGirlCoin accounts + transactions
  eco.initEconomyStore(":memory:");                              // fresh in-memory economy DB
  const stock = require("../../src/privateStockStore.js");      // Doll Street
  stock.initPrivateStockStore(eco.getEconomyDb());               // exchange on the same DB
  const lumi = require("../../src/lumi/index.js");              // Lumi-Town
  lumi.initLumiGames({ scheduler: false });                      // tables, accounts, LUMI, tuning, routes (no timer)
  return {
    eco, stock, lumi,                                            // the stores
    db: require("../../src/lumi/db.js"),                         // tx, dayKey, setClock
    sgc: require("../../src/lumi/sgc.js"),                       // spend / pay / refund
    tuning: require("../../src/lumi/tuning.js"),                 // knobs
    treasury: require("../../src/lumi/treasury.js"),             // sweep / draws
    errors: require("../../src/lumi/errors.js"),                 // LumiError
  };
}

/** Set an account's balance directly (creating it if needed). Test setup only. */
export function setBalance(eco, id, amount) {
  eco.ensureAccount(id, id);                                     // make sure it exists
  eco.getEconomyDb().prepare("UPDATE accounts SET balance = ? WHERE user_id = ?").run(amount, id); // force the balance
}

/** Zero every Lumi account (and Central Bank) so a test starts from a known pool. */
export function resetLumi(eco) {
  for (const id of eco.LUMI_ACCOUNT_IDS) setBalance(eco, id, 0); // empty the pool
  const db = eco.getEconomyDb();                                 // raw DB
  db.exec("DELETE FROM lumi_owed; DELETE FROM lumi_coin_refs; DELETE FROM lumi_daily; DELETE FROM system_state WHERE key LIKE 'setting.lumi.%';"); // clean slate
  require("../../src/lumi/tuning.js").reload();                  // forget cached settings
}
