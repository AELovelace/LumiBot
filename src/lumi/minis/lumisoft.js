'use strict';

/**
 * Lumi-Soft on the server, ported from erinne mnemerynne/lumisoft.py (commit 0ddc466): run tickets, entry and continue
 * fees, the replay check, the prize, best scores, the Daily Range board and the Lumi-Soft prizes for Lumi's house
 * and closet.
 *
 * The page plays the run with public/lumi/lumi-soft/rules.js and sends its log (every shot, every reload, how many
 * continues). Nothing it claims about points is believed: this module `require`s the SAME rules.js (UMD) and plays the
 * run again; that score is what pays (erinne's lumisoft_rules.py mirror is not ported).
 *
 * Coins (CONTRACT.md section 5), native amounts:
 *   entry     sgc.spend(..., 'soft', 'entry', { key: 'entry' })        25   (erinne lumisoft.py:164; free for practice)
 *   continue  sgc.spend(..., 'soft', 'continue', { key: 'continue' })  50/100/200/400 (erinne lumisoft.py:192)
 *   prize     sgc.pay(..., 'soft', 'win', 'lumi-soft:<run>')           score / 250    (erinne lumisoft.py:223)
 * erinne's 'lumisoft_daily_cap' is replaced by tuning.cap('soft'), which sgc.pay applies.
 * Prizes go into the pet's save through src/lumi/pet/save.js (load + save; DECOR = erinne _DECOR, WEAR = _WEAR).
 * Every function here runs inside the caller's db.tx(). Times (`now`) are seconds, like erinne's time.time().
 */

const { getDb, nowMs, dayKey, parseJson } = require('../db');                    // DB, clock, LA day
const sgc = require('../sgc');                                                   // the only door to coins
const tuning = require('../tuning');                                             // prices in SGC for words
const users = require('../users');                                               // board names
const { LumiError } = require('../errors');                                      // refusals
const save = require('../pet/save');                                             // Lumi's save (prizes)
const rules = require('../../../public/lumi/lumi-soft/rules.js');                // THE rules the page plays (UMD)
const { person, payWords } = require('./who');                                   // who -> {id, name}

const GAME = 'soft';                                                             // tuning / ledger id (erinne "lumi-soft")
const ENTRY = 25;                                                                // a run (native)
const CONTINUES = [50, 100, 200, 400];                                           // each continue costs more; then 400 (native)
const POINTS_PER_COIN = 250;                                                     // native coins per point
const MODES = ['training', 'story', 'stage', 'daily'];                           // run kinds
const SLACK_TICKS = 600;                                                         // 10 s more play than the wall clock allows
const DATA = save.readJson('stages.json');                                       // src/lumi/data/stages.json (erinne lumisoft_data)
const STAGES = DATA.stages.filter((s) => !s.training).map((s) => s.id);          // the story stages, in order

// The Lumi-Soft prizes (house.json / closet.json pieces marked "prize": "lumi-soft") and what wins each.
const PRIZES = [
  ['soft-rug', 'training'], ['soft-wallpaper', 'clear:garden'], ['soft-curtains', 'clear:tower'],
  ['soft-lamp', 'clear:lounge'], ['soft-ceiling', 'clear:dungeon'], ['soft-bed', 'clear:fair'],
  ['soft-trophy', 'story'], ['acc-soft-goggles', 'story'], ['soft-wallart', 'rank-s'], ['soft-frame', 'badges-25'],
  ['soft-shelf', 'pops-500'], ['soft-toychest', 'boss-clean'], ['soft-door', 'dailies-10'], ['soft-sidetable', 'combo'],
  ['soft-plant', 'no-friends'], ['soft-view', 'perfect'], ['soft-floor', 'hearts'],
];

/** erinne Refused: a safe, actionable explanation; nothing was changed. */
class Refused extends LumiError {
  constructor(message, status = 409) {
    super(status, status === 402 ? 'not_enough_sgc' : 'refused', message);       // same status as erinne
    this.name = 'Refused';                                                       // for logs
  }
}

const nowSeconds = () => nowMs() / 1000;                                         // erinne time.time() (fakeable clock)

/** The most one player may earn from Lumi-Soft a day, in SGC (0: no limit). */
function dailyCap() {
  return tuning.cap(GAME);                                                       // admin knob
}

/** erinne day_number(): today (LA) as a proleptic Gregorian ordinal, like Python's date.toordinal(). */
function dayNumber() {
  const [y, m, d] = dayKey().split('-').map(Number);                             // 'YYYY-MM-DD'
  return Date.UTC(y, m - 1, d) / 86_400_000 + 719_163;                           // 1970-01-01 is ordinal 719163
}

/** erinne continue_price(): the next continue's native price after `paid` of them. */
function continuePrice(paid) {
  return CONTINUES[Math.min(paid, CONTINUES.length - 1)];                        // grows, then stays
}

// ---------------------------------------------------------------------------------------------- progress

/** erinne _progress(): this player's Lumi-Soft progress. */
function _progress(uid) {
  const row = getDb().prepare('SELECT data FROM lumi_soft_progress WHERE user_id = ?').get(String(uid)); // the row
  const data = row ? parseJson(row.data, {}) : {};                               // unreadable: start again
  return { pops: 0, dailies: 0, daily_day: 0, cleared: [], won: [], flags: [], ...(data && typeof data === 'object' ? data : {}) }; // defaults under it
}

/** erinne _save_progress(). */
function _saveProgress(uid, data) {
  getDb().prepare('INSERT INTO lumi_soft_progress (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data')
    .run(String(uid), JSON.stringify(data));                                     // upsert
}

/** erinne _flags(): what this run achieved, as the names PRIZES use. */
function _flags(mode, summary, practice) {
  const got = new Set();                                                         // flags
  if (mode === 'training' && summary.done) got.add('training');                  // finished training
  if (mode === 'story' && summary.done && !practice) got.add('story');           // finished the story
  for (const row of summary.cleared) {
    if (row.stage === 'training') continue;                                      // training clears count for nothing here
    got.add(`clear:${row.stage}`);                                               // cleared a stage
    if (row.rank === 'S') got.add('rank-s');                                     // an S rank
    if (row.bossLost === 0) got.add('boss-clean');                               // boss without a lost heart
    if (row.friends === 0) got.add('no-friends');                                // no friend popped
    if (row.perfect) got.add('perfect');                                         // 100% accuracy
    if (row.lost === 0) got.add('hearts');                                       // all hearts kept
  }
  if (summary.badges >= 25) got.add('badges-25');                                // 25 badges
  if (summary.best >= rules.C.COMBO_MAX) got.add('combo');                       // a x3.0 combo
  return got;                                                                    // the set
}

/** erinne _prize_info(): a prize's name and how it's won, from Lumi Pet's catalogs (null if unknown). */
function _prizeInfo(item) {
  const piece = save.DECOR[item] || save.WEAR[item];                             // house piece or accessory
  return piece ? { id: item, name: piece.name, how: piece.how || '', closet: item in save.WEAR } : null; // the info
}

/** erinne _give(): put won prizes in Lumi's house or closet (one she already has is left alone). */
function _give(uid, items) {
  const known = items.filter((i) => _prizeInfo(i));                              // real prizes only
  if (!known.length) return;                                                     // nothing to give
  const pet = save.load(String(uid), { seen: false });                           // caught up and saved; not a visit
  for (const item of known) {
    const key = item in save.WEAR ? 'closet' : 'decor';                          // which shelf
    if (!Array.isArray(pet[key])) pet[key] = [];                                 // always a list
    if (!pet[key].includes(item)) pet[key].push(item);                           // add it once
  }
  save.save(String(uid), pet);                                                   // write it
}

// ---------------------------------------------------------------------------------------------- what the page needs

/** erinne board(): a board's best scores, best first, with names. */
function board(name, limit = 10) {
  return getDb().prepare('SELECT user_id, score, rank FROM lumi_soft_bests WHERE board = ? ORDER BY score DESC, at LIMIT ?')
    .all(name, limit).map((r) => ({ name: users.displayName(r.user_id), score: r.score, rank: r.rank })); // names from lumi_users
}

/**
 * erinne state(): everything the title screen shows. entry / continues / points_per_coin are native numbers: the page
 * shows them with LumiPrice('soft', 'entry' | 'continue', n) and LumiPayout('soft', 'win', n).
 */
function state(who) {
  const p = person(who);                                                         // the player
  const progress = _progress(p.id);                                              // their progress
  const day = dayNumber();                                                       // today's Daily Range
  const segs = rules.plan(DATA, 'daily', null, day);                             // its plan
  const bests = {};                                                              // board -> best
  for (const r of getDb().prepare("SELECT board, score, rank FROM lumi_soft_bests WHERE user_id = ? AND board NOT LIKE 'daily:%'").all(p.id)) {
    bests[r.board] = { score: r.score, rank: r.rank };                           // one board
  }
  const prizes = PRIZES.map(([item]) => _prizeInfo(item)).filter(Boolean).map((info) => ({ ...info, won: progress.won.includes(info.id) })); // prize list
  return {
    stages: DATA, entry: ENTRY, continues: [...CONTINUES], points_per_coin: POINTS_PER_COIN, cap: dailyCap(),
    coins: sgc.balance(p.id), bests, cleared: progress.cleared, pops: progress.pops, dailies: progress.dailies, prizes,
    daily: { day, stage: DATA.stages[segs[0].stage].id, scene: segs[0].scene, tried: progress.daily_day === day, board: board(`daily:${day}`) },
  };
}

// ---------------------------------------------------------------------------------------------- a run

/**
 * erinne start(): a ticket for a new run. Charges the entry unless it's training or a Daily Range retry (practice).
 * A Daily Range's first try of the day is the scored one, even if quit: it's marked tried as it starts.
 */
function start(who, mode, stage = null, now = null) {
  const p = person(who);                                                         // the player
  if (!MODES.includes(mode)) throw new Refused('Choose Story, a stage, the Daily Range or the Training Range.', 422);
  if (mode === 'stage') {
    const progress = _progress(p.id);                                            // what's cleared
    if (!STAGES.includes(stage)) throw new Refused("There's no such stage.", 404);
    const at = STAGES.indexOf(stage);                                            // its place
    if (at > 0 && !progress.cleared.includes(STAGES[at - 1])) throw new Refused('Clear the stage before it first (in Story or Stage select).', 403);
  } else {
    stage = null;                                                                // only stage select names one
  }
  const day = mode === 'daily' ? dayNumber() : 0;                                // the Daily Range's day
  const progress = _progress(p.id);                                              // progress
  const practice = mode === 'training' || (mode === 'daily' && progress.daily_day === day); // free?
  let charged = 0;                                                               // SGC taken
  if (!practice) {
    try {
      charged = sgc.spend(p.id, p.name, ENTRY, GAME, 'entry', { key: 'entry' }); // -> Lumi Arcade (throws 402)
    } catch (error) {
      if (error instanceof LumiError && error.status === 402) throw new Refused(`A run costs ${tuning.scalePrice(GAME, 'entry', ENTRY)} SGC.`, 402);
      throw error;                                                               // game off etc.
    }
  }
  if (mode === 'daily' && !practice) {
    progress.daily_day = day;                                                    // today's try is used
    progress.dailies += 1;                                                       // one more daily
    _saveProgress(p.id, progress);                                               // keep it
  }
  const stamp = now === null ? nowSeconds() : now;                               // when it started
  const db = getDb();                                                            // economy DB
  db.prepare('DELETE FROM lumi_soft_runs WHERE user_id = ? AND finished = 0').run(p.id); // one run at a time
  db.prepare('DELETE FROM lumi_soft_runs WHERE finished = 1 AND started_at < ?').run(stamp - 86400); // a day's history
  const run = Number(db.prepare('INSERT INTO lumi_soft_runs (user_id, mode, stage, day, practice, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(p.id, mode, stage, day, practice ? 1 : 0, stamp).lastInsertRowid);      // the ticket
  return {
    run, mode, stage, day, practice, plan: rules.plan(DATA, mode, stage, day),  // the run
    entry: practice ? 0 : ENTRY, charged, coins: sgc.balance(p.id),              // entry native, charged SGC
    next_continue: practice ? 0 : continuePrice(0),                              // native
  };
}

/** erinne _run(): this player's open ticket, or Refused 404. */
function _run(uid, run) {
  const row = getDb().prepare('SELECT * FROM lumi_soft_runs WHERE id = ? AND user_id = ? AND finished = 0').get(run, String(uid)); // the ticket
  if (!row) throw new Refused('That run has already finished, or a newer one started.', 404);
  return row;                                                                    // it
}

/** erinne carry_on(): pay for a continue (free on a practice run). paid = SGC charged; next_continue is native. */
function carryOn(who, run) {
  const p = person(who);                                                         // the player
  const row = _run(p.id, run);                                                   // the ticket
  if (row.mode === 'training') throw new Refused('The Training Range has no game over.', 409);
  const native = row.practice ? 0 : continuePrice(row.continues);                // erinne's price
  let paid = 0;                                                                  // SGC taken
  if (native) {
    try {
      paid = sgc.spend(p.id, p.name, native, GAME, 'continue', { key: 'continue' }); // -> Lumi Arcade
    } catch (error) {
      if (error instanceof LumiError && error.status === 402) throw new Refused(`A continue costs ${tuning.scalePrice(GAME, 'continue', native)} SGC.`, 402);
      throw error;                                                               // game off etc.
    }
  }
  getDb().prepare('UPDATE lumi_soft_runs SET continues = continues + 1 WHERE id = ?').run(run); // one more allowed in the replay
  return { continues: row.continues + 1, paid, coins: sgc.balance(p.id), next_continue: row.practice ? 0 : continuePrice(row.continues + 1) };
}

/**
 * erinne finish(): the run is over. Replay it, pay it once, keep its bests and hand out prizes. Returns what the server
 * made of it: { run, summary, earned (native), paid (SGC), owed, capped, refused, practice, won, bests, coins, said }.
 */
function finish(who, run, log, now = null) {
  const p = person(who);                                                         // the player
  const row = _run(p.id, run);                                                   // the ticket
  const db = getDb();                                                            // economy DB
  db.prepare('UPDATE lumi_soft_runs SET finished = 1 WHERE id = ?').run(run);     // used up
  const segs = rules.plan(DATA, row.mode, row.stage, row.day);                   // the same plan
  const stamp = now === null ? nowSeconds() : now;                               // when it ended
  const allowed = Math.trunc((stamp - row.started_at) * 60) + SLACK_TICKS;       // steps the clock allows
  const claimed = {
    shots: (log && log.shots) || [], reloads: (log && log.reloads) || [], end: Math.trunc(Number(log && log.end) || 0), // the log
    continues: Math.min(Math.trunc(Number(log && log.continues) || 0), row.continues), // no more continues than were paid for
  };
  const result = { run, earned: 0, paid: 0, owed: 0, capped: false, refused: null, practice: Boolean(row.practice), won: [], bests: [], said: '' };
  let played;                                                                    // the replayed state
  if (claimed.end > allowed) {
    result.refused = "That run doesn't add up, so it can't pay.";                // more play than time
    played = rules.replay(DATA, segs, { ...claimed, shots: [], reloads: [], end: 0 }); // an empty run
  } else {
    played = rules.replay(DATA, segs, claimed);                                  // the page's run, again
  }
  const summary = rules.summary(played);                                         // what it came to
  result.summary = summary;                                                      // for the page
  if (result.refused) {
    result.coins = sgc.balance(p.id);                                            // balance only
    return result;
  }
  if (!row.practice) {
    result.earned = Math.floor(summary.score / POINTS_PER_COIN);                 // native coins (erinne lumisoft.py:221)
    const money = sgc.pay(p.id, p.name, result.earned, GAME, 'win', `lumi-soft:${run}`); // bank -> player, capped, once
    Object.assign(result, { paid: money.paid, owed: money.owed, capped: money.capped, said: payWords(money, 'Lumi-Soft') }); // what sgc did
    const boards = summary.cleared.filter((c) => c.stage !== 'training').map((c) => [`stage:${c.stage}`, c.score, c.rank]); // stage boards
    if (row.mode === 'story') boards.push(['story', summary.score, '']);         // the story board
    if (row.mode === 'daily') boards.push([`daily:${row.day}`, summary.score, summary.cleared.length ? summary.cleared[0].rank : '']); // today's board
    for (const [name, score, grade] of boards) {
      const old = db.prepare('SELECT score FROM lumi_soft_bests WHERE user_id = ? AND board = ?').get(p.id, name); // best so far
      if (!old || score > old.score) {
        db.prepare(`
          INSERT INTO lumi_soft_bests (user_id, board, score, rank, at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, board) DO UPDATE SET score = excluded.score, rank = excluded.rank, at = excluded.at
        `).run(p.id, name, score, grade, stamp);                                 // a new best
        result.bests.push(name);                                                 // tell the page
      }
    }
  }
  const progress = _progress(p.id);                                              // progress
  progress.pops += summary.pops;                                                 // lifetime pops
  for (const c of summary.cleared) {
    if (c.stage !== 'training' && !progress.cleared.includes(c.stage)) progress.cleared.push(c.stage); // opens the next stage
  }
  const flags = new Set([...progress.flags, ..._flags(row.mode, summary, Boolean(row.practice) && row.mode !== 'training')]); // all flags
  if (progress.pops >= 500) flags.add('pops-500');                               // lifetime pops
  if (progress.dailies >= 10) flags.add('dailies-10');                           // ten dailies
  progress.flags = [...flags].sort();                                            // sorted, like erinne
  const fresh = PRIZES.filter(([item, need]) => flags.has(need) && !progress.won.includes(item)).map(([item]) => item); // newly won
  progress.won = [...progress.won, ...fresh];                                    // remember them
  _saveProgress(p.id, progress);                                                 // keep it
  _give(p.id, fresh);                                                            // into her house / closet
  result.won = fresh.map(_prizeInfo).filter(Boolean);                            // for the page
  result.coins = sgc.balance(p.id);                                              // SGC balance
  return result;
}

module.exports = {
  GAME, ENTRY, CONTINUES, POINTS_PER_COIN, MODES, SLACK_TICKS, DATA, STAGES, PRIZES, // constants
  Refused, rules,                                                                // refusal class; the shared rules.js
  dailyCap, dayNumber, continuePrice, _progress, _saveProgress, _flags, _prizeInfo, _give, // helpers
  board, state, start, _run, carryOn, finish,                                    // the game
};
