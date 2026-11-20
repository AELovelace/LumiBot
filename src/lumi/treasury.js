'use strict';

/**
 * Lumi games: Lumi-Town's money plumbing (docs/plans/lumi-games-port.md sections 3.2-3.6).
 *
 *   player --spend--> themed category account --sweep (sliding-scale tax)--> Lumi-Town Bank --pay--> player
 *   bank above its ceiling --overflow--> Lumi Holdings Inc.      bank short --emergency draw--> categories, then Holdings
 *
 * Nothing here ever mints: every move is moveCoins() between real accounts, so the total never changes.
 * Ledger types written here: lumi_sweep, lumi_overflow, lumi_owed_paid, lumi_emergency_draw, lumi_seed, lumi_admin_move.
 */

const { logger } = require('../logger');
const {
  getBalance,                // an account's balance
  ensureAccount,             // make a player account if missing
  moveCoins,                 // strict fee-free move (throws when refused)
  getSystemState,            // one-time seed marker
  setSystemState,            // one-time seed marker
  CENTRAL_BANK_USER_ID,      // where the seed comes from
  LUMI_TOWN_BANK_USER_ID,    // the bank every prize is paid from
  LUMI_HOLDINGS_USER_ID,     // the reserve
  LUMI_ACCOUNTS,             // [{id, name}] of all nine Lumi accounts
  LUMI_ACCOUNT_IDS,          // just their ids
} = require('../sadgirlEconomyStore');
const { getDb, tx, inTransaction, nowMs, parseJson } = require('./db');
const tuning = require('./tuning');
const { LumiError } = require('./errors');

const BANK = LUMI_TOWN_BANK_USER_ID;          // short names used below
const HOLDINGS = LUMI_HOLDINGS_USER_ID;       // the reserve
const SEEDED_KEY = 'lumi.seeded_at';          // system_state key holding when the one-time seed ran

let warnedUnmapped = new Set();               // game:kind pairs we already warned about (log once each)

// ---------------------------------------------------------------------------------------------- categories

/** Every category row: [{ category, accountId, displayName, games: [...] }]. */
function categories() {
  return getDb().prepare('SELECT category, account_id, display_name, games_json FROM lumi_accounts ORDER BY rowid').all()
    .map((r) => ({ category: r.category, accountId: r.account_id, displayName: r.display_name, games: parseJson(r.games_json, []) })); // decoded rows
}

/**
 * Which themed account a spend lands in: the category whose games_json lists "game:kind" (checked first) or "game".
 * Returns { category, accountId, displayName }. An unmapped game falls back to Lumi-Town Bank (and logs once).
 */
function categoryAccount(game, kind) {
  const rows = categories();                                                        // small table, read fresh
  const exact = `${game}:${kind}`;                                                  // e.g. 'pet:snacks'
  const hit = rows.find((r) => Array.isArray(r.games) && r.games.includes(exact))   // the most specific match first
    || rows.find((r) => Array.isArray(r.games) && r.games.includes(game));          // then the whole game
  if (hit) return { category: hit.category, accountId: hit.accountId, displayName: hit.displayName }; // found
  if (!warnedUnmapped.has(exact)) {                                                 // say so once per pair
    warnedUnmapped.add(exact);                                                      // remember
    logger.warn(`Lumi treasury: no category lists "${exact}" or "${game}"; its spends go straight to Lumi-Town Bank.`); // admin hint
  }
  return { category: null, accountId: BANK, displayName: 'Lumi-Town Bank' };        // safe fallback: still in the pool
}

/** Admin: rename a category's account and/or change which games feed it. Logged. */
function setCategory(category, { displayName, games } = {}, who = '') {
  const db = getDb();                                                               // economy DB
  const row = db.prepare('SELECT * FROM lumi_accounts WHERE category = ?').get(category); // must exist
  if (!row) throw new LumiError(404, 'no_category', `No Lumi category "${category}".`); // unknown category
  const name = displayName === undefined ? row.display_name : String(displayName).trim().slice(0, 60); // keep or replace
  const list = games === undefined ? parseJson(row.games_json, []) : games;         // keep or replace
  if (!name || !Array.isArray(list) || !list.every((g) => /^[a-z0-9-]{1,32}(:[a-z0-9-]{1,32})?$/u.test(g))) {
    throw new LumiError(400, 'bad_category', 'A category needs a name and a list of "game" or "game:kind" entries.'); // refuse junk
  }
  db.prepare('UPDATE lumi_accounts SET display_name = ?, games_json = ? WHERE category = ?').run(name, JSON.stringify(list), category); // save
  db.prepare('INSERT INTO lumi_admin_log (who, key, old, new, at) VALUES (?, ?, ?, ?, ?)')
    .run(String(who || ''), `category.${category}`, JSON.stringify({ name: row.display_name, games: parseJson(row.games_json, []) }), JSON.stringify({ name, games: list }), nowMs()); // audit
  warnedUnmapped = new Set();                                                       // mappings changed: warn afresh
  return { category, accountId: row.account_id, displayName: name, games: list };  // the new row
}

// ---------------------------------------------------------------------------------------------- policy helpers

/** Bank health = bank balance / bank target (Infinity when the target is 0). */
function health(bankBalance = getBalance(BANK)) {
  const { bankTarget } = tuning.treasuryPolicy();                                   // e.g. 100,000
  return bankTarget > 0 ? bankBalance / bankTarget : Infinity;                      // 1 = exactly on target
}

/** The sweep tax rate for a health value: the first band whose limit is above it. */
function rateFor(h) {
  const { bands } = tuning.treasuryPolicy();                                        // [[below, rate], ...] ascending
  const band = bands.find(([below]) => h < below);                                  // first band it is under
  return band ? band[1] : bands[bands.length - 1][1];                               // top band otherwise
}

// Category accounts (the themed shops), with balances, largest first.
function categoryBalances() {
  const ids = [...new Set(categories().map((c) => c.accountId))].filter((id) => id !== BANK && id !== HOLDINGS); // never sweep the bank/reserve
  return ids.map((id) => ({ id, balance: getBalance(id) })).sort((a, b) => b.balance - a.balance); // richest first
}

// Write one lumi_admin_log row (every treasury action logs itself, so callers never double-log).
function logAdmin(who, key, oldValue, newValue) {
  getDb().prepare('INSERT INTO lumi_admin_log (who, key, old, new, at) VALUES (?, ?, ?, ?, ?)')
    .run(String(who || 'system'), key, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), nowMs()); // audit row (blank who -> 'system')
}

// ---------------------------------------------------------------------------------------------- owed prizes

/** Pay owed prizes oldest-first while the bank can cover the next one (stops at the first it can't). Call inside tx(). */
function payOwed() {
  const db = getDb();                                                               // economy DB
  let count = 0;                                                                    // prizes paid
  let total = 0;                                                                    // SGC paid
  if (tuning.treasuryPolicy().payoutsPaused) return { count, total };               // paused: everything stays owed
  const rows = db.prepare('SELECT * FROM lumi_owed ORDER BY id ASC').all();          // oldest first
  for (const row of rows) {
    if (getBalance(BANK) < row.amount) break;                                       // can't cover this one: stop (keeps the order fair)
    ensureAccount(row.user_id, row.username || '');                                 // the player's account must exist
    moveCoins(BANK, row.user_id, row.amount, 'lumi_owed_paid', `${row.game}:${row.kind} ${row.ref || ''}`.trim()); // pay it
    db.prepare('DELETE FROM lumi_owed WHERE id = ?').run(row.id);                   // no longer owed
    if (row.ref) db.prepare('UPDATE lumi_coin_refs SET amount = amount + ? WHERE ref = ?').run(row.amount, row.ref); // the ref now shows it paid
    count += 1;                                                                     // tally
    total += row.amount;                                                            // tally
  }
  return { count, total };                                                          // what was paid
}

/** Admin "pay owed prizes now": payOwed() in its own transaction, logged as `who` (default 'system'). */
function payOwedNow(who = 'system') {
  return tx(() => {                                                                 // one transaction: payments + audit row
    const r = payOwed();                                                            // pay what the bank can
    logAdmin(who, 'treasury.payOwed', null, JSON.stringify(r));                     // one audit row per action
    return r;                                                                       // { count, total }
  });
}

// ---------------------------------------------------------------------------------------------- sweep

/**
 * The 15-minute sweep, in ONE transaction:
 *  1. health = bank / target, rate = the sliding-scale band for it;
 *  2. floor(balance x rate) moves from every category account to the bank ('lumi_sweep');
 *  3. anything above the bank ceiling moves to Lumi Holdings ('lumi_overflow');
 *  4. owed prizes are paid oldest-first while the bank has money ('lumi_owed_paid').
 * Returns { health, rate, swept, perAccount, overflow, owedPaid, owedPaidAmount }.
 * Logged to lumi_admin_log as `who` (default 'scheduler'); the scheduler's own sweeps are only logged when
 * something moved, so the 15-minute timer doesn't bury the admins' rows.
 */
function sweep(who = 'scheduler') {
  return tx(() => {
    const h = health();                                                             // before the sweep
    const rate = rateFor(h);                                                        // the band's tax
    const perAccount = {};                                                          // id -> swept
    let swept = 0;                                                                  // total swept
    for (const { id, balance } of categoryBalances()) {
      const amount = Math.floor(balance * rate);                                    // whole SGC
      if (amount <= 0) continue;                                                    // nothing to take
      moveCoins(id, BANK, amount, 'lumi_sweep', `Sweep ${Math.round(rate * 100)}% at bank health ${Number.isFinite(h) ? Math.round(h * 100) : 'inf'}%`); // shop -> bank
      perAccount[id] = amount;                                                      // remember
      swept += amount;                                                              // tally
    }
    const { bankCeiling } = tuning.treasuryPolicy();                                // overflow line
    let overflow = 0;                                                               // moved to Holdings
    const bank = getBalance(BANK);                                                  // after the sweep
    if (bankCeiling > 0 && bank > bankCeiling) {
      overflow = bank - bankCeiling;                                                // the excess
      moveCoins(BANK, HOLDINGS, overflow, 'lumi_overflow', `Bank above its ${bankCeiling} SGC ceiling`); // bank -> reserve
    }
    const owed = payOwed();                                                         // owed prizes, oldest first
    const report = { health: h, rate, swept, perAccount, overflow, owedPaid: owed.count, owedPaidAmount: owed.total }; // the result
    if (who !== 'scheduler' || swept || overflow || owed.count) {                   // admin sweeps always log; timer sweeps only when money moved
      logAdmin(who, 'treasury.sweep', null, JSON.stringify({ rate, swept, overflow, owedPaid: owed.count, owedPaidAmount: owed.total })); // audit
    }
    return report;                                                                  // report
  });
}

// ---------------------------------------------------------------------------------------------- emergency draws

/**
 * Make sure Lumi-Town Bank holds at least `amount`, drawing INSIDE THE CALLER'S TRANSACTION when it doesn't:
 *  1. category accounts, largest balance first, until shortfall + refill buffer (refillBufferPct x bankTarget) is in;
 *  2. then Lumi Holdings, but never below its reserve floor.
 * Each draw is a 'lumi_emergency_draw' ledger row. Returns true when the bank can now pay `amount`, false if not
 * (the draws that did happen stay, they only moved money inside the pool).
 */
function ensureCovers(amount) {
  if (!inTransaction()) throw new Error('treasury.ensureCovers must run inside the caller\'s tx().'); // the draw must commit with the payout
  const bank = getBalance(BANK);                                                    // what the bank has now
  if (bank >= amount) return true;                                                  // no draw needed
  const policy = tuning.treasuryPolicy();                                           // buffer + floor
  const buffer = Math.floor(policy.bankTarget * policy.refillBufferPct);            // extra so the next prize doesn't draw again
  const need = (amount - bank) + buffer;                                            // shortfall + buffer
  let drawn = 0;                                                                    // pulled in so far
  for (const { id, balance } of categoryBalances()) {                               // richest shop first
    if (drawn >= need) break;                                                       // enough
    const take = Math.min(balance, need - drawn);                                   // at most what it has
    if (take <= 0) continue;                                                        // empty shop
    moveCoins(id, BANK, take, 'lumi_emergency_draw', `Emergency draw from ${accountName(id)}`); // shop -> bank
    drawn += take;                                                                  // tally
  }
  if (drawn < need) {                                                               // shops weren't enough: the reserve
    const spare = Math.max(0, getBalance(HOLDINGS) - policy.reserveFloor);          // only above the floor
    const take = Math.min(spare, need - drawn);                                     // at most the spare
    if (take > 0) {
      moveCoins(HOLDINGS, BANK, take, 'lumi_emergency_draw', 'Emergency draw from Lumi Holdings Inc.'); // reserve -> bank
      drawn += take;                                                                // tally
    }
  }
  if (drawn > 0) logger.warn(`Lumi treasury: emergency draw of ${drawn} SGC to cover a ${amount} SGC prize.`); // admins should notice
  return getBalance(BANK) >= amount;                                                // covered now?
}

// The display name of a Lumi account id (category name if it has one).
function accountName(id) {
  const cat = categories().find((c) => c.accountId === id);                         // themed name first
  if (cat) return cat.displayName;                                                  // e.g. "Lumi's Snack Stand"
  return LUMI_ACCOUNTS.find((a) => a.id === id)?.name || id;                        // else the built-in name
}

// ---------------------------------------------------------------------------------------------- seed + admin moves

/**
 * One-time seed from Central Bank (plan 3.6): `total` must equal toBank + toHoldings (a double check from the admin
 * form). Checks Central Bank's balance first. Refuses a second seed unless opts.force. Ledger type 'lumi_seed'.
 */
function seed(total, toBank, toHoldings, { who = 'system', force = false } = {}) {
  for (const [label, n] of [['toBank', toBank], ['toHoldings', toHoldings]]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new LumiError(400, 'bad_amount', `${label} must be a whole number of SGC.`); // whole SGC
  }
  if (!Number.isSafeInteger(total) || total !== toBank + toHoldings || total <= 0) {
    throw new LumiError(400, 'bad_amount', 'The seed total must equal the bank part plus the holdings part.'); // the double check
  }
  return tx(() => {
    const already = getSystemState(SEEDED_KEY);                                     // has it run before?
    if (already && !force) throw new LumiError(409, 'already_seeded', `Lumi-Town was already seeded (${new Date(Number(already)).toISOString()}).`); // once only
    const cb = getBalance(CENTRAL_BANK_USER_ID);                                    // fix-list #21: check first
    if (cb < total) throw new LumiError(402, 'not_enough_sgc', `Central Bank only has ${cb} SGC; the seed needs ${total}.`, { need: total, have: cb }); // refuse
    if (toBank > 0) moveCoins(CENTRAL_BANK_USER_ID, BANK, toBank, 'lumi_seed', `Seed by ${who || 'admin'}`); // CB -> bank
    if (toHoldings > 0) moveCoins(CENTRAL_BANK_USER_ID, HOLDINGS, toHoldings, 'lumi_seed', `Seed by ${who || 'admin'}`); // CB -> reserve
    setSystemState(SEEDED_KEY, String(nowMs()));                                    // remember it ran
    logAdmin(who, 'treasury.seed', already || null, JSON.stringify({ toBank, toHoldings })); // audit
    return { toBank, toHoldings, centralBankLeft: cb - total };                     // report
  });
}

/** Admin: move SGC between two Lumi accounts (logged, ledger 'lumi_admin_move'). */
function adminMove(fromId, toId, amount, who = 'system') {
  if (!LUMI_ACCOUNT_IDS.includes(fromId) || !LUMI_ACCOUNT_IDS.includes(toId)) {
    throw new LumiError(400, 'not_lumi_account', 'Both accounts must be Lumi-Town accounts.'); // only inside the pool
  }
  return tx(() => {
    moveCoins(fromId, toId, amount, 'lumi_admin_move', `Moved by ${who || 'admin'}`); // throws when short
    logAdmin(who, 'treasury.move', fromId, JSON.stringify({ to: toId, amount })); // audit
    return { from: fromId, to: toId, amount };                                      // report
  });
}

// ---------------------------------------------------------------------------------------------- scheduler

let timer = null;        // the pending setTimeout
let running = false;     // scheduler on?
let inFlight = false;    // a sweep is running right now

// One scheduled sweep: never two at once, and ALWAYS reschedules (fix-list #24 lesson).
function tick() {
  timer = null;                                                                     // this timer has fired
  if (inFlight) { schedule(); return; }                                             // previous still running: try later
  inFlight = true;                                                                  // guard
  try {
    const r = sweep('scheduler');                                                   // the sweep itself (logs only when money moved)
    if (r.swept || r.overflow || r.owedPaid) logger.info(`Lumi treasury sweep: swept ${r.swept} at ${Math.round(r.rate * 100)}%, overflow ${r.overflow}, owed paid ${r.owedPaid}.`); // only log when something moved
  } catch (error) {
    logger.error(`Lumi treasury sweep failed: ${error.message}`);                   // log and carry on
  } finally {
    inFlight = false;                                                               // free the guard
    schedule();                                                                     // always come back
  }
}

// Arm the next sweep (interval read fresh each time, so admin changes apply).
function schedule() {
  if (!running || timer) return;                                                    // stopped, or already armed
  const ms = tuning.treasuryPolicy().sweepIntervalMs;                               // e.g. 900,000 (15 min)
  timer = setTimeout(tick, ms);                                                     // next run
  if (typeof timer.unref === 'function') timer.unref();                             // never keeps the process alive
}

/** Start the sweep scheduler (idempotent). */
function start() {
  running = true;                                                                   // on
  schedule();                                                                       // arm the first sweep
}

/** Stop the sweep scheduler (idempotent). */
function stop() {
  running = false;                                                                  // off
  if (timer) clearTimeout(timer);                                                   // disarm
  timer = null;                                                                     // forget it
}

// ---------------------------------------------------------------------------------------------- status

// In/out totals per Lumi account from transactions whose type starts with lumi_, since a SQLite datetime modifier.
function flows(since) {
  const db = getDb();                                                               // economy DB
  const ids = LUMI_ACCOUNT_IDS;                                                     // the nine accounts
  const marks = ids.map(() => '?').join(',');                                       // (?,?,...)
  const inRows = db.prepare(`SELECT to_user_id AS id, COALESCE(SUM(amount),0) AS n FROM transactions WHERE type LIKE 'lumi\\_%' ESCAPE '\\' AND created_at >= datetime('now', ?) AND to_user_id IN (${marks}) GROUP BY to_user_id`).all(since, ...ids); // money in
  const outRows = db.prepare(`SELECT from_user_id AS id, COALESCE(SUM(amount),0) AS n FROM transactions WHERE type LIKE 'lumi\\_%' ESCAPE '\\' AND created_at >= datetime('now', ?) AND from_user_id IN (${marks}) GROUP BY from_user_id`).all(since, ...ids); // money out
  const out = Object.fromEntries(ids.map((id) => [id, { in: 0, out: 0 }]));         // zeroes for every account
  for (const r of inRows) out[r.id].in = r.n;                                       // fill ins
  for (const r of outRows) out[r.id].out = r.n;                                     // fill outs
  return out;                                                                       // { id: { in, out } }
}

/** Everything the admin page shows about Lumi-Town's money. */
function status() {
  const db = getDb();                                                               // economy DB
  const policy = tuning.treasuryPolicy();                                           // knobs
  const bank = getBalance(BANK);                                                    // bank balance
  const holdings = getBalance(HOLDINGS);                                            // reserve balance
  const h = health(bank);                                                           // health
  const day = flows('-1 day');                                                      // 24 h
  const week = flows('-7 days');                                                    // 7 d
  const cats = categories();                                                        // themed accounts
  const accounts = LUMI_ACCOUNTS.map((a) => {
    const cat = cats.find((c) => c.accountId === a.id);                             // its category, if any
    return {
      id: a.id,                                                                     // account id
      name: cat ? cat.displayName : a.name,                                         // display name
      category: cat ? cat.category : a.id === BANK ? 'bank' : a.id === HOLDINGS ? 'holdings' : null, // role
      games: cat ? cat.games : [],                                                  // what feeds it
      balance: getBalance(a.id),                                                    // balance now
      in24h: day[a.id].in, out24h: day[a.id].out, in7d: week[a.id].in, out7d: week[a.id].out, // flows
    };
  });
  const draws = db.prepare(`SELECT from_user_id, amount, note, created_at FROM transactions WHERE type = 'lumi_emergency_draw' ORDER BY id DESC LIMIT 50`).all(); // recent draws
  const drawCount = (since) => db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'lumi_emergency_draw' AND created_at >= datetime('now', ?)`).get(since).n; // counter
  const owedRows = db.prepare('SELECT id, user_id, username, amount, game, kind, ref, at FROM lumi_owed ORDER BY id ASC LIMIT 200').all(); // oldest first
  const owedTotals = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM lumi_owed').get(); // totals
  return {
    bank: { balance: bank, target: policy.bankTarget, ceiling: policy.bankCeiling, health: h, rate: rateFor(h) }, // bank card
    holdings: { balance: holdings, reserveFloor: policy.reserveFloor, excess: Math.max(0, holdings - policy.reserveFloor), dividendRate: policy.lumiDividendRate }, // reserve card
    accounts,                                                                       // every account row
    poolTotal: accounts.reduce((sum, a) => sum + a.balance, 0),                     // all Lumi money
    emergencyDraws: { count24h: drawCount('-1 day'), count7d: drawCount('-7 days'), recent: draws }, // draws
    owed: { count: owedTotals.n, total: owedTotals.total, rows: owedRows },         // owed prizes
    policy,                                                                         // all knobs
    payoutsPaused: policy.payoutsPaused,                                            // the pause switch
    seededAt: Number(getSystemState(SEEDED_KEY)) || null,                           // when seeded (ms) or null
    scheduler: { running, inFlight, intervalMs: policy.sweepIntervalMs },           // sweep timer state
  };
}

module.exports = {
  categories,        // all category rows
  categoryAccount,   // (game, kind) -> { category, accountId, displayName }
  setCategory,       // admin: rename / remap a category
  health,            // bank / target
  rateFor,           // sweep rate for a health
  sweep,             // run one sweep now (own transaction)
  payOwed,           // pay owed prizes (inside tx)
  payOwedNow,        // pay owed prizes (own transaction)
  ensureCovers,      // emergency draw inside the caller's tx
  seed,              // one-time Central Bank seed
  adminMove,         // admin move between Lumi accounts
  start,             // start the sweep scheduler
  stop,              // stop it
  status,            // admin page data
  BANK,              // '__LUMI_TOWN_BANK__'
  HOLDINGS,          // '__LUMI_HOLDINGS__'
};
