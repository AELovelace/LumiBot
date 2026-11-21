'use strict';

/**
 * Lumi games: THE ONLY DOOR TO SADGIRLCOIN for game code (docs/plans/lumi-games-port.md section 3.7).
 *
 * Rules every caller follows (see CONTRACT.md):
 *  - Call these INSIDE db.tx(() => { ... }) together with the game change they belong to, so the game row and the
 *    coins commit together or not at all. Each function throws if no transaction is open.
 *  - Pass erinne's NATIVE amount (the number erinne's Python used); tuning.js scales it to SGC.
 *  - spend() THROWS (LumiError 402 'not_enough_sgc') so your transaction rolls back; pay() NEVER throws for money
 *    reasons: when Lumi-Town can't pay, the prize is written to lumi_owed and paid by a later sweep.
 * Ledger rows: type `lumi_${game}_${kind}` (e.g. lumi_pet_snacks, lumi_prism_win), refunds `lumi_${game}_refund`.
 */

const {
  getBalance,                // a player's balance
  ensureAccount,             // make the player's account if missing
  moveCoins,                 // strict move, throws CoinMoveError
  CoinMoveError,             // its error class
  LUMI_TOWN_BANK_USER_ID,    // every prize comes from here
} = require('../sadgirlEconomyStore');
const { getDb, inTransaction, nowMs, dayKey, tx } = require('./db');
const tuning = require('./tuning');
const treasury = require('./treasury');
const { LumiError, notEnoughSGC } = require('./errors');
const events = require('./events');                                                 // Lumi-Town news (big prizes)

const NAME = /^[a-z0-9-]{1,32}$/u;   // game and kind ids: lowercase words and dashes (they end up in ledger types)
const REF = /^[\x21-\x7e]{1,200}$/u; // refs: 1-200 printable ASCII characters, no spaces

// Every money function needs an open transaction (so the coins and the game change commit together).
function mustBeInTx(fn) {
  if (!inTransaction()) throw new Error(`sgc.${fn}() must be called inside db.tx(() => ...).`); // a programming bug
}

// game/kind/uid sanity checks shared by every function.
function checkIds(fn, uid, game, kind) {
  if (typeof uid !== 'string' || !/^\d{1,25}$/u.test(uid)) throw new Error(`sgc.${fn}: user id must be a Discord id string (got ${uid}).`); // never a number
  if (!NAME.test(String(game))) throw new Error(`sgc.${fn}: bad game id "${game}".`);   // ledger-safe
  if (kind !== undefined && !NAME.test(String(kind))) throw new Error(`sgc.${fn}: bad kind "${kind}".`); // ledger-safe
}

/**
 * Charge a player for something a game sells.
 * @param {string} uid       Discord id
 * @param {string} username  display name (kept on their SGC account)
 * @param {number} native    erinne's price (e.g. 25 for an arcade entry); 0 = free
 * @param {string} game      tuning game id ('pet', 'prism', 'breakout', 'city' ...)
 * @param {string} kind      what it is ('snacks', 'boutique', 'capsule', 'entry', 'continue', 'shop' ...)
 * @param {{key?: string, note?: string}} [opts] key: tuning override key (default: kind); note: ledger note
 * @returns {number} the SGC actually charged (0 for a free item)
 * @throws LumiError 402 'not_enough_sgc' {need, have} | 403 'game_off'
 */
function spend(uid, username, native, game, kind, { key, note } = {}) {
  mustBeInTx('spend');                                                              // must commit with the game change
  checkIds('spend', uid, game, kind);                                               // sane ids
  if (!tuning.enabled(game)) throw new LumiError(403, 'game_off', 'This game is closed for now. Please try again later.'); // switched off by an admin
  const amount = tuning.scalePrice(game, key === undefined ? kind : key, native);   // erinne coins -> SGC
  if (amount === 0) return 0;                                                       // free: nothing moves
  ensureAccount(uid, username || '');                                               // first-time players get an account
  const target = treasury.categoryAccount(game, kind).accountId;                    // which themed shop gets it
  try {
    moveCoins(uid, target, amount, `lumi_${game}_${kind}`, note || '');             // player -> shop
  } catch (error) {
    if (error instanceof CoinMoveError && error.code === 'insufficient_funds') throw notEnoughSGC(amount, error.have); // 402 for the page
    throw error;                                                                    // anything else is a bug
  }
  return amount;                                                                    // SGC charged
}

/**
 * Pay a prize from Lumi-Town Bank, once per `ref`.
 * Order: duplicate ref? -> scale -> daily cap -> record -> paused? owed : emergency draw -> pay or owe.
 * @param {string} uid, username   the player
 * @param {number} native          erinne's prize amount (e.g. score / 10 for Prism Drop)
 * @param {string} game, kind      tuning game id and what it is ('win', 'visit', 'buyback' ...)
 * @param {string} ref             pay-once reference, e.g. 'lumi-prism:<run id>' (see CONTRACT.md)
 * @param {{key?: string, note?: string, cap?: boolean, exact?: boolean}} [opts] key: tuning override key (default kind); cap:false skips the daily cap;
 *        exact:true means `native` is ALREADY whole SGC (e.g. a stored SGC price): no scaling, no override (the cap still applies unless cap:false)
 * @returns {{paid:number, owed:number, capped:boolean, duplicate?:true}}
 */
function pay(uid, username, native, game, kind, ref, { key, note, cap = true, exact = false } = {}) {
  mustBeInTx('pay');                                                                // must commit with the game change
  checkIds('pay', uid, game, kind);                                                 // sane ids
  if (typeof ref !== 'string' || !REF.test(ref)) throw new Error(`sgc.pay: bad ref "${ref}".`); // every prize needs a ref
  if (exact && (!Number.isSafeInteger(native) || native < 0)) throw new Error(`sgc.pay: an exact amount must be a whole SGC >= 0 (got ${native}).`); // exact = already SGC
  const db = getDb();                                                               // economy DB
  const seen = db.prepare('SELECT 1 FROM lumi_coin_refs WHERE ref = ?').get(ref)     // paid (or settled) before?
    || db.prepare('SELECT 1 FROM lumi_owed WHERE ref = ?').get(ref);                // or already owed?
  if (seen) return { paid: 0, owed: 0, capped: false, duplicate: true };            // pay-once: nothing more
  let amount = exact ? native : tuning.scalePayout(game, key === undefined ? kind : key, native); // exact: already SGC (no scaling); else erinne coins -> SGC
  let capped = false;                                                               // did the daily cap bite?
  const limit = cap ? tuning.cap(game) : 0;                                         // 0 = no cap
  const day = dayKey();                                                             // LA day
  if (amount > 0 && limit > 0) {
    const row = db.prepare('SELECT earned FROM lumi_daily WHERE user_id = ? AND game = ? AND day = ?').get(uid, game, day); // won today so far
    const room = Math.max(0, limit - (row ? row.earned : 0));                       // what's left under the cap
    if (amount > room) { amount = room; capped = true; }                            // trim to the cap
  }
  const now = nowMs();                                                              // one clock reading
  db.prepare('INSERT INTO lumi_coin_refs (ref, user_id, amount, at) VALUES (?, ?, 0, ?)').run(ref, uid, now); // claim the ref (even for 0)
  if (amount <= 0) return { paid: 0, owed: 0, capped };                             // nothing to pay (capped or tiny score)
  db.prepare(`
    INSERT INTO lumi_daily (user_id, game, day, earned) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, game, day) DO UPDATE SET earned = earned + excluded.earned
  `).run(uid, game, day, amount);                                                   // count it toward today's cap
  ensureAccount(uid, username || '');                                               // the player's account must exist
  const owe = () => {
    db.prepare('INSERT INTO lumi_owed (user_id, username, amount, game, kind, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, username || '', amount, game, kind, ref, now);                      // saved for a later sweep
    return { paid: 0, owed: amount, capped };                                       // tell the game
  };
  if (tuning.treasuryPolicy().payoutsPaused) return owe();                          // admin pause: owe everything
  if (!treasury.ensureCovers(amount)) return owe();                                 // pool can't cover it: owe it
  moveCoins(LUMI_TOWN_BANK_USER_ID, uid, amount, `lumi_${game}_${kind}`, note || ref); // bank -> player
  db.prepare('UPDATE lumi_coin_refs SET amount = ? WHERE ref = ?').run(amount, ref); // the ref shows it paid
  events.publish(events.NEWS_CHANNEL, 'win', { uid, game, kind, amount, ref });     // news.js keeps the big ones (after checking the ref committed)
  return { paid: amount, owed: 0, capped };                                         // done
}

/**
 * Give back an exact earlier charge (already in SGC: the number spend() returned), once per `ref`.
 * Taken from the category account the charge went to (opts.kind: the original spend's kind, for the lookup);
 * if that shop has since been swept, the rest comes from Lumi-Town Bank (with an emergency draw if needed);
 * if even that can't cover it, the remainder is owed like a prize. No scaling, no daily cap.
 * @returns {{refunded:number, owed:number, duplicate?:true}}
 */
function refund(uid, username, scaledAmount, game, ref, { kind = 'refund', note } = {}) {
  mustBeInTx('refund');                                                             // must commit with the game change
  checkIds('refund', uid, game, kind);                                              // sane ids
  if (!Number.isSafeInteger(scaledAmount) || scaledAmount <= 0) throw new Error(`sgc.refund: amount must be a whole SGC > 0 (got ${scaledAmount}).`); // exact charge only
  if (typeof ref !== 'string' || !REF.test(ref)) throw new Error(`sgc.refund: bad ref "${ref}".`); // refunds are pay-once too
  const db = getDb();                                                               // economy DB
  if (db.prepare('SELECT 1 FROM lumi_coin_refs WHERE ref = ?').get(ref) || db.prepare('SELECT 1 FROM lumi_owed WHERE ref = ?').get(ref)) {
    return { refunded: 0, owed: 0, duplicate: true };                               // already refunded
  }
  const now = nowMs();                                                              // one clock reading
  db.prepare('INSERT INTO lumi_coin_refs (ref, user_id, amount, at) VALUES (?, ?, 0, ?)').run(ref, uid, now); // claim the ref
  ensureAccount(uid, username || '');                                               // the player's account must exist
  const type = `lumi_${game}_refund`;                                               // ledger type
  const shop = treasury.categoryAccount(game, kind).accountId;                      // where the charge went
  let left = scaledAmount;                                                          // still to give back
  const fromShop = Math.min(left, getBalance(shop));                                // what the shop still holds
  if (fromShop > 0 && shop !== LUMI_TOWN_BANK_USER_ID) {
    moveCoins(shop, uid, fromShop, type, note || ref);                              // shop -> player
    left -= fromShop;                                                               // less to find
  }
  if (left > 0 && treasury.ensureCovers(left)) {
    moveCoins(LUMI_TOWN_BANK_USER_ID, uid, left, type, note || ref);                // bank -> player for the rest
    left = 0;                                                                       // all given back
  }
  const refunded = scaledAmount - left;                                             // paid right now
  db.prepare('UPDATE lumi_coin_refs SET amount = ? WHERE ref = ?').run(refunded, ref); // record it
  if (left > 0) {
    db.prepare('INSERT INTO lumi_owed (user_id, username, amount, game, kind, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, username || '', left, game, 'refund', `${ref}:rest`, now);          // the rest is owed
  }
  return { refunded, owed: left };                                                  // report
}

/**
 * One player pays another an EXACT amount of SGC (erinne coins.transfer, e.g. buying a plot someone listed in Lumi City).
 * The amount is the player-chosen list price: no scaling, no cap, no fee. Strict: the buyer must hold it all.
 * Pay-once by `ref` (a second call with the same ref moves nothing and says duplicate).
 * @param {string} fromUid, fromName   the buyer (pays)
 * @param {string} toUid, toName       the seller (receives)
 * @param {number} amount              whole SGC > 0
 * @param {string} game, kind          ledger type `lumi_${game}_${kind}` (e.g. lumi_city_trade)
 * @param {string} ref                 pay-once reference, e.g. 'lumi-plot:l-1-3:<bought_at>:<version>'
 * @returns {{moved:number, duplicate?:true}}
 * @throws LumiError 402 'not_enough_sgc' {need, have} | 400 'self_trade' | 403 'game_off'
 */
function transfer(fromUid, fromName, toUid, toName, amount, game, kind, ref) {
  mustBeInTx('transfer');                                                           // must commit with the game change
  checkIds('transfer', fromUid, game, kind);                                        // sane buyer id + ledger names
  checkIds('transfer', toUid, game, kind);                                          // sane seller id
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`sgc.transfer: amount must be a whole SGC > 0 (got ${amount}).`); // exact SGC only
  if (typeof ref !== 'string' || !REF.test(ref)) throw new Error(`sgc.transfer: bad ref "${ref}".`); // every trade needs a ref
  if (fromUid === toUid) throw new LumiError(400, 'self_trade', "You can't trade with yourself."); // erinne refused paying herself
  if (!tuning.enabled(game)) throw new LumiError(403, 'game_off', 'This game is closed for now. Please try again later.'); // switched off by an admin
  const db = getDb();                                                               // economy DB
  if (db.prepare('SELECT 1 FROM lumi_coin_refs WHERE ref = ?').get(ref)) return { moved: 0, duplicate: true }; // that very trade already went through
  ensureAccount(fromUid, fromName || '');                                           // the buyer's account must exist
  ensureAccount(toUid, toName || '');                                               // the seller's too, so the coins land somewhere
  try {
    moveCoins(fromUid, toUid, amount, `lumi_${game}_${kind}`, ref);                 // buyer -> seller, fee-free, strict
  } catch (error) {
    if (error instanceof CoinMoveError && error.code === 'insufficient_funds') throw notEnoughSGC(amount, error.have); // 402 for the page
    throw error;                                                                    // anything else is a bug
  }
  db.prepare('INSERT INTO lumi_coin_refs (ref, user_id, amount, at) VALUES (?, ?, ?, ?)').run(ref, fromUid, amount, nowMs()); // claim the ref
  return { moved: amount };                                                         // done
}

/** The player's SGC balance (0 when they have no account yet). Safe outside a transaction. */
function balance(uid) {
  return getBalance(String(uid));                                                   // accounts.balance
}

/** Sugar for db.tx: run game changes + coin moves together. inGame(() => { ...; sgc.spend(...); ... }) */
function inGame(fn) {
  return tx(fn);                                                                    // one transaction
}

module.exports = {
  spend,    // player -> category account (throws 402)
  pay,      // bank -> player, pay-once, capped, never throws for money
  refund,   // give back an exact earlier charge
  transfer, // player -> player, exact SGC, pay-once (Lumi City listings)
  balance,  // the coin chip
  inGame,   // = db.tx
};
