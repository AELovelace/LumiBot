'use strict';

/**
 * Lumi Launch on the server, ported from erinne mnemerynne/lumilaunch.py (commit 0ddc466): a go's ticket and entry
 * fee, the replay check, the prize and the best launches.
 *
 * A go is three launches on one seeded course. The page plays it with public/lumi/lumi-launch/rules.js and sends only
 * each launch's presses ([frame, button], ...). Nothing it says about distance is believed: this module `require`s the
 * SAME rules.js (UMD) and flies Lumi again from the presses; that distance is what pays (erinne's Python mirror,
 * lumilaunch_rules.py, is not ported). Couch turns are free play and never come here.
 *
 * Coins (CONTRACT.md section 5):
 *   entry  sgc.spend(..., 'launch', 'entry', { key: 'entry' })                   (erinne lumilaunch.py:62, ENTRY 25 native)
 *   prize  sgc.pay(..., 'launch', 'win', 'lumi-launch:<run>')                    (erinne lumilaunch.py:109, metres / 20)
 * erinne's 'launch_daily_cap' is replaced by tuning.cap('launch'), which sgc.pay applies.
 * Every function here runs inside the caller's db.tx(). Times (`now`) are seconds, like erinne's time.time().
 */

const crypto = require('node:crypto');                                           // new seeds
const { getDb, nowMs } = require('../db');                                       // DB + clock
const sgc = require('../sgc');                                                   // the only door to coins
const tuning = require('../tuning');                                             // for the page's cap
const users = require('../users');                                               // board names
const { LumiError } = require('../errors');                                      // refusals
const rules = require('../../../public/lumi/lumi-launch/rules.js');              // THE rules the page plays (UMD)
const { person, payWords } = require('./who');                                   // who -> {id, name}

const GAME = 'launch';                                                           // tuning / ledger id (erinne "lumi-launch")
const ENTRY = 25;                                                                // a go (native; LumiPrice('launch','entry',25))
const METRES_PER_COIN = 20;                                                      // native coins per metre
const SLACK_FRAMES = 600;                                                        // 10 s more play than the wall clock allows
const BUTTONS = ['ok', 'up', 'down'];                                            // what a launch's log may hold
const MODULUS = 2147483647;                                                      // erinne arcade.MODULUS: every seed lives below it

/** erinne Refused: a safe, actionable explanation; nothing was changed. */
class Refused extends LumiError {
  constructor(message, status = 409) {
    super(status, status === 402 ? 'not_enough_sgc' : 'refused', message);       // same status as erinne
    this.name = 'Refused';                                                       // for logs
  }
}

const nowSeconds = () => nowMs() / 1000;                                         // erinne time.time() (fakeable clock)
const newSeed = () => crypto.randomInt(0, MODULUS - 2) + 1;                      // erinne arcade.new_seed()

// ---------------------------------------------------------------------------------------------- what the page shows

/** erinne board(): the longest goes, longest first, with names and each player's longest single launch. */
function board(limit = 10) {
  return getDb().prepare('SELECT user_id, best_go, best_shot FROM lumi_launch_bests WHERE best_go > 0 ORDER BY best_go DESC, at LIMIT ?')
    .all(limit).map((r) => ({ name: users.displayName(r.user_id), go: r.best_go, shot: r.best_shot })); // names from lumi_users
}

/** The most one player may earn from Lumi Launch a day, in SGC (0: no limit). */
function dailyCap() {
  return tuning.cap(GAME);                                                       // admin knob
}

/** erinne _best(): this player's own bests (zeros before the first go). */
function _best(uid) {
  const row = getDb().prepare('SELECT best_go, best_shot FROM lumi_launch_bests WHERE user_id = ?').get(String(uid)); // their row
  return row ? { go: row.best_go, shot: row.best_shot } : { go: 0, shot: 0 };     // or zeros
}

/** erinne state(): the title screen (entry and metres_per_coin are native: the page shows them with LumiPrice/LumiPayout). */
function state(who) {
  const p = person(who);                                                         // the player
  return { entry: ENTRY, metres_per_coin: METRES_PER_COIN, cap: dailyCap(), shots: rules.C.SHOTS,
    coins: sgc.balance(p.id), best: _best(p.id), board: board() };              // title screen data
}

// ---------------------------------------------------------------------------------------------- a go

/** erinne start(): charge the entry and pick the course. Starting again drops an unfinished go (unpaid). */
function start(who, now = null) {
  const p = person(who);                                                         // the player
  let charged;                                                                   // SGC taken
  try {
    charged = sgc.spend(p.id, p.name, ENTRY, GAME, 'entry', { key: 'entry' });   // -> Lumi Arcade (throws 402)
  } catch (error) {
    if (error instanceof LumiError && error.status === 402) {
      throw new Refused(`A go costs ${tuning.scalePrice(GAME, 'entry', ENTRY)} SGC.`, 402); // erinne's words, in SGC
    }
    throw error;                                                                 // game off etc.
  }
  const stamp = now === null ? nowSeconds() : now;                               // when it started
  const db = getDb();                                                            // economy DB
  db.prepare('DELETE FROM lumi_launch_runs WHERE user_id = ? AND finished = 0').run(p.id); // one go at a time
  db.prepare('DELETE FROM lumi_launch_runs WHERE finished = 1 AND started_at < ?').run(stamp - 86400); // a day's history is plenty
  const seed = newSeed();                                                        // the course
  const run = Number(db.prepare('INSERT INTO lumi_launch_runs (user_id, seed, started_at) VALUES (?, ?, ?)').run(p.id, seed, stamp).lastInsertRowid); // the ticket
  return { run, seed, entry: ENTRY, charged, shots: rules.C.SHOTS, coins: sgc.balance(p.id) }; // entry native, charged SGC
}

/** erinne _tidy(): the logs as replay wants them, or Refused (422) if they can't be a real go. */
function _tidy(shots) {
  if (!Array.isArray(shots) || shots.length > rules.C.SHOTS) throw new Refused(`A go has ${rules.C.SHOTS} launches.`, 422); // too many
  const out = [];                                                                // clean logs
  for (const log of shots) {
    if (!Array.isArray(log)) throw new Refused("That go doesn't add up.", 422);  // not a list
    let last = 0;                                                                // frames must not go back
    const clean = [];                                                            // this launch
    for (const press of log) {
      if (!Array.isArray(press) || press.length !== 2) throw new Refused("That go doesn't add up.", 422); // [frame, button]
      const [frame, button] = press;                                             // unpack
      if (!Number.isInteger(frame) || !BUTTONS.includes(button) || frame < last) throw new Refused("That go doesn't add up.", 422); // bad press
      last = frame;                                                              // moves on
      clean.push([frame, button]);                                               // keep it
    }
    out.push(clean);                                                             // one launch
  }
  return out;                                                                    // all launches
}

/**
 * erinne finish(): the go is over. Replay it with rules.js, pay it once, keep the bests. Returns what the server made
 * of it: { run, summary, earned (native), paid (SGC), owed, capped, refused, new_best, best, coins, board, said }.
 */
function finish(who, run, shots, now = null) {
  const p = person(who);                                                         // the player
  const db = getDb();                                                            // economy DB
  const row = db.prepare('SELECT * FROM lumi_launch_runs WHERE id = ? AND user_id = ? AND finished = 0').get(run, p.id); // the open ticket
  if (!row) throw new Refused('That go has already finished, or a newer one started.', 404);
  const logs = _tidy(shots);                                                     // refuse impossible logs
  const stamp = now === null ? nowSeconds() : now;                               // when it ended
  db.prepare('UPDATE lumi_launch_runs SET finished = 1 WHERE id = ?').run(run);   // the ticket is used up
  const summary = rules.replay(row.seed, logs);                                  // fly her again, exactly as the page did
  const allowed = Math.trunc((stamp - row.started_at) * 60) + SLACK_FRAMES;      // frames the clock allows
  const result = { run, summary, earned: 0, paid: 0, owed: 0, capped: false, refused: null, new_best: { go: false, shot: false }, said: '' };
  if (summary.frames > allowed) {                                                // more flying than there was time for
    result.refused = "That go doesn't add up, so it can't pay.";                 // nothing paid
    Object.assign(result, { best: _best(p.id), coins: sgc.balance(p.id) });      // what the page shows
    return result;
  }
  result.earned = Math.floor(summary.total / METRES_PER_COIN);                   // native coins (erinne lumilaunch.py:108)
  const money = sgc.pay(p.id, p.name, result.earned, GAME, 'win', `lumi-launch:${run}`); // bank -> player, capped, once
  Object.assign(result, { paid: money.paid, owed: money.owed, capped: money.capped, said: payWords(money, 'Lumi Launch') }); // what sgc did
  db.prepare('UPDATE lumi_launch_runs SET score = ?, paid = ? WHERE id = ?').run(summary.total, money.paid, run); // keep the record
  const old = _best(p.id);                                                       // bests before
  const longest = Math.max(0, ...summary.shots.map((s) => s.m));                 // longest single launch
  result.new_best = { go: summary.total > old.go, shot: longest > old.shot };    // anything new?
  if (result.new_best.go || result.new_best.shot) {
    db.prepare(`
      INSERT INTO lumi_launch_bests (user_id, best_go, best_shot, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET best_go = MAX(best_go, excluded.best_go), best_shot = MAX(best_shot, excluded.best_shot), at = excluded.at
    `).run(p.id, summary.total, longest, stamp);                                 // keep the bests
  }
  Object.assign(result, { best: _best(p.id), coins: sgc.balance(p.id), board: board() }); // what the page shows
  return result;
}

module.exports = {
  GAME, ENTRY, METRES_PER_COIN, SLACK_FRAMES, BUTTONS, MODULUS, // constants
  Refused, rules,                                                // refusal class; the shared rules.js
  board, dailyCap, _best, state, start, _tidy, finish, newSeed,  // the game
};
