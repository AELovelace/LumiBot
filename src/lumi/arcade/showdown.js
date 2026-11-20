'use strict';

/**
 * Yarn Pop, Lumi Conga and Teacup Tower showdowns (erinne mnemerynne/showdown.py): two racers play the same seeded
 * game side by side, and up to five watchers see both boards live and can bet on who wins.
 *
 * A table (lumi_arcade_rooms, one JSON document) goes waiting -> racing -> result -> waiting:
 *  - waiting: P1 and P2 each press Ready; the race starts when both have, and only then are both charged the entry
 *    (both or neither). Watchers may bet on P1 or P2 meanwhile. A watcher can take an empty racer seat; a racer can
 *    stand down to watch. Any change of racer refunds the bets, since they were on someone else.
 *  - racing: each racer's page plays the game from the race's seed and finishes through arcade.finish, which checks
 *    the run; live boards go through HUB, in memory, never the database. The race settles when both racers have
 *    finished, or RACE_SECONDS (+ grace) after it began, or when nobody is left.
 *  - result: for RESULT_SECONDS everyone sees who won, then the table waits again with the winner as P1.
 *
 * Coins (CONTRACT section 5; native amounts, sgc scales them):
 *  - racer entry:  sgc.spend(uid, name, 25, slug, 'entry', {key:'entry'})               (erinne showdown.py:135)
 *  - racer prize:  sgc.pay(uid, name, score, slug, 'win', '<slug>:<run>')                (showdown.py:97, same as solo)
 *  - watcher bet:  sgc.spend(uid, name, chip, slug, 'bet', {key:'bet'})                  (showdown.py:419)
 *  - bet refund:   sgc.refund(uid, name, <SGC charged>, slug, '<slug>:<code>:<bet>:back', {kind:'bet'}) (showdown.py:83/108)
 *  - bet win:      "double back" = the stake back (sgc.refund ':stake', exact SGC) + sgc.pay(uid, name, chip total,
 *                  slug, 'betwin', '<slug>:<code>:<bet>:win') (showdown.py:110). The win is capped like any prize,
 *                  the stake never is, so a capped winner still gets their own SGC back.
 * Each bet remembers the SGC it actually charged (bet.paid), so refunds are exact whatever the tuning is later.
 *
 * Leaving and disconnecting (lobby.PRESENCE): a seat is there while its page holds the table's stream open. A seat
 * whose stream has been closed for DROP_SECONDS is let go: a watcher's open bets come back; a racer between races
 * stands up (bets refunded); a racer mid-race forfeits that race. A table with nobody left closes, settling first.
 * There is no host: nobody can start a race for someone else or spend their coins.
 *
 * Times are unix SECONDS (erinne time.time()), from db.nowMs() so tests can fake them.
 */

const crypto = require('node:crypto');                    // seat and bet ids
const { getDb, tx, nowMs, parseJson } = require('../db'); // DB, transactions, clock
const sgc = require('../sgc');                            // the only door to coins
const tuning = require('../tuning');                      // SGC prices for messages and the page
const { LumiError, notEnoughSGC } = require('../errors'); // player-facing "no"s
const arcade = require('./arcade');                       // runs, seeds, refused()
const lobby = require('./lobby');                         // PRESENCE + table codes (read lobby.PRESENCE each time)

const { ENTRY, refused } = arcade;                        // 25 native per racer; erinne Refused
const GAMES = arcade.GAMES;                               // breakout, snake, teacup-tower
const WATCHERS = 5;                                       // with the two racers, seven at a table
const DROP_SECONDS = 30;                                  // a page gone this long gives up its seat (a reload is quicker)
const AWAY_SECONDS = 5;                                   // shown as "away" after this long without a stream
const RESULT_SECONDS = 12;                                // how long the result shows
const RACE_SECONDS = 600;                                 // a race's longest; the pages end their games at this time
const FINISH_GRACE = 30;                                  // after that, how long the server waits for a finish
const BET_CHIPS = Object.freeze([1, 5, 10, 25, 100]);     // native chip sizes
const BET_LIMIT = 500;                                    // the most (native) one watcher may have riding on one race
const MAX_TABLES = 50;                                    // per game
const IDLE_SECONDS = 7200;                                // a table nobody has changed in this long closes
const NAMES = Object.freeze({ breakout: 'Yarn Pop', snake: 'Lumi Conga', 'teacup-tower': 'Teacup Tower' }); // shelf names
const PLAIN_LOOK = Object.freeze({ glow: 'rose', outfit: {} }); // a fresh Lumi's look

function nowS() { return nowMs() / 1000; }                // unix seconds (test-swappable)
function token() { return crypto.randomBytes(6).toString('hex'); } // 12 hex characters, like secrets.token_hex(6)

/** This table's key in lobby.PRESENCE: ['arcade', code] (erinne ("arcade", code)). */
function _key(code) { return ['arcade', code]; }

// Seconds since this seat's player was last heard from at the table.
function _quiet(state, seat) {
  return lobby.PRESENCE.quietFor(_key(state.code), seat.actor); // read the CURRENT PRESENCE (tests may swap it)
}

// The seat playing `role` ('p1' / 'p2'), or null.
function _racer(state, role) {
  return state.seats.find((s) => s.role === role) || null;      // first match
}

// The seat this actor sits in, or null.
function _seatOf(state, actor) {
  return state.seats.find((s) => s.actor === actor) || null;    // first match
}

// A table's state, or 404 when it has closed.
function _read(game, code) {
  const row = getDb().prepare('SELECT state FROM lumi_arcade_rooms WHERE code = ? AND game = ?').get(String(code), game); // the row
  const state = row ? parseJson(row.state, null) : null;        // its JSON
  if (!state) throw refused('This table has closed. Choose another or start one.', 404); // gone
  return state;                                                 // the live document
}

// Write a table's state back.
function _save(state, now) {
  getDb().prepare('UPDATE lumi_arcade_rooms SET state = ?, updated_at = ? WHERE code = ?').run(JSON.stringify(state), now, state.code); // store
}

// SGC for a native price at this game (what sgc.spend would charge).
function price(game, key, native) {
  return tuning.scalePrice(game, key, native);                  // tuning formula
}

// ---------------------------------------------------------------------------------------------- money

// Give one bet's charged SGC back (once per bet). `why` names the ref: 'back' (refund) or 'stake' (a winning bet).
function _giveBack(state, bet, why) {
  if (!(bet.paid > 0)) return { refunded: 0, owed: 0 };         // nothing was charged
  return sgc.refund(bet.account, bet.name, bet.paid, state.game, `${state.game}:${state.code}:${bet.id}:${why}`, { kind: 'bet' }); // exact SGC back
}

/** Hand back open bets: one watcher's (bettor: their seat id), or everyone's. INSIDE tx. */
function _refundBets(state, bettor = null) {
  const keep = [];                                              // bets that stay
  for (const bet of state.bets) {
    if (bettor === null || bet.bettor === bettor) _giveBack(state, bet, 'back'); // theirs: refunded
    else keep.push(bet);                                        // someone else's: stays riding
  }
  state.bets = keep;                                            // what's left
}

/** End the race: pay each racer's verified score, decide the winner, pay the bets, show the result. INSIDE tx. */
function _settle(state, now) {
  const race = state.race;                                      // the race ending
  const game = state.game;                                      // its game
  const lines = [];                                             // one line per racer
  const finished = [];                                          // racers who finished
  for (const racer of race.racers) {
    const result = race.results[racer.seat];                    // their checked run (or forfeit)
    let prize = { paid: 0, owed: 0, capped: false };            // nothing yet
    if (result && !result.forfeit) {
      prize = sgc.pay(racer.account, racer.name, result.score, game, 'win', `${game}:${racer.run}`, { key: 'win' }); // their own score
    }
    const line = { seat: racer.seat, name: racer.name, role: racer.role, paid: prize.paid, owed: prize.owed || 0, capped: Boolean(prize.capped), // money
      forfeit: !result || Boolean(result.forfeit) };            // finished or not
    if (result) for (const k of ['score', 'distance', 'level', 'length']) if (k in result) line[k] = result[k]; // the run's numbers
    lines.push(line);                                           // keep it
    if (!line.forfeit) finished.push(line);                     // in the running for the win
  }
  let winner = null;                                            // highest distance, then score, then P1
  for (const line of finished) {
    if (!winner) { winner = line; continue; }                   // first one
    const a = [line.distance, line.score, line.role === 'p1' ? 1 : 0]; // this one's rank
    const b = [winner.distance, winner.score, winner.role === 'p1' ? 1 : 0]; // the best so far
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) winner = line; // better
  }
  const betLines = [];                                          // what each bettor got (shown only to them)
  for (const bet of state.bets) {
    if (winner === null) {
      const back = _giveBack(state, bet, 'back');               // no winner: every bet comes back
      betLines.push({ bettor: bet.bettor, stake: bet.paid, back: back.refunded, won: 0, owed: back.owed || 0, capped: false, result: 'refunded' }); // note
    } else if (bet.target === winner.seat) {
      const back = _giveBack(state, bet, 'stake');              // the stake comes back ...
      const win = sgc.pay(bet.account, bet.name, bet.amount, game, 'betwin', `${game}:${state.code}:${bet.id}:win`, { key: 'betwin' }); // ... plus as much again
      betLines.push({ bettor: bet.bettor, stake: bet.paid, back: back.refunded, won: win.paid, owed: (back.owed || 0) + (win.owed || 0), capped: Boolean(win.capped), result: 'won' }); // note
    } else {
      betLines.push({ bettor: bet.bettor, stake: bet.paid, back: 0, won: 0, owed: 0, capped: false, result: 'lost' }); // the house keeps it
    }
  }
  state.last = { winner: winner ? winner.name : null, winner_seat: winner ? winner.seat : null, racers: lines, bets: state.bets.length, payouts: betLines }; // the result board
  state.phase = 'result';                                       // show it
  state.race = null;                                            // the race is over
  state.bets = [];                                              // every bet settled
  state.result_until = now + RESULT_SECONDS;                    // for this long
  state.seats = state.seats.filter((s) => !s.left_race);        // racers who'd gone, gone now
  for (const seat of state.seats) seat.ready = false;           // everyone readies again
  const seat = winner ? state.seats.find((s) => s.id === winner.seat) : null; // the winner's seat, if still here
  if (seat && seat.role === 'p2') {
    const other = _racer(state, 'p1');                          // the loser in P1
    seat.role = 'p1';                                           // the winner sits as P1
    if (other) other.role = 'p2';                               // and they swap
  }
}

/** Both racers are ready: charge them both (or neither) and give the race its seed and run tickets. INSIDE tx. */
function _startRace(state, now) {
  const p1 = _racer(state, 'p1');                               // racer one
  const p2 = _racer(state, 'p2');                               // racer two
  const need = price(state.game, 'entry', ENTRY);               // SGC each pays
  for (const seat of [p1, p2]) {
    const have = sgc.balance(seat.account);                     // their SGC
    if (have < need) {
      seat.ready = false;                                       // (rolled back with the tx, as in erinne)
      throw notEnoughSGC(need, have, `${seat.name} needs ${need} SGC to race.`); // nobody pays
    }
  }
  const seed = arcade.newSeed();                                // one seed for both
  const racers = [];                                            // the race's racers
  for (const seat of [p1, p2]) {
    sgc.spend(seat.account, seat.name, ENTRY, state.game, 'entry', { key: 'entry' }); // checked above: can't fail
    const run = arcade.start(seat.account, seat.name, state.game, { room: state.code, seed }); // their ticket
    racers.push({ seat: seat.id, role: seat.role, name: seat.name, account: seat.account, run: run.run }); // remembered
    seat.ready = false;                                         // ready again next time
  }
  state.phase = 'racing';                                       // off they go
  state.race = { seed, started: now, ends: now + RACE_SECONDS, racers, results: {} }; // the race
  HUB.clear(state.code);                                        // fresh boards
}

/**
 * The one way a seat leaves (Leave, standing on a full table, or nobody there). Between races: their own bets come
 * back, and if they were racing, everyone's (the race they bet on can't happen). Mid-race: a racer forfeits. INSIDE tx.
 */
function _remove(state, seat) {
  const racing = state.phase === 'racing';                      // mid-race?
  const racer = racing && state.race.racers.some((r) => r.seat === seat.id); // one of the racers?
  if (racer) {
    if (!(seat.id in state.race.results)) state.race.results[seat.id] = { forfeit: true }; // forfeits
    seat.left_race = true;                                      // gone after the settle
    seat.role = 'gone';                                         // hidden now
    return;                                                     // stays until the settle
  }
  if (!racing) _refundBets(state, seat.role === 'p1' || seat.role === 'p2' ? null : seat.id); // their (or all) bets back
  state.seats.splice(state.seats.indexOf(seat), 1);             // gone
}

/** What time and absence have done since anyone looked: seats let go, the race settled, the result cleared. */
function _advance(state, now) {
  for (const seat of [...state.seats]) {
    if (seat.role !== 'gone' && _quiet(state, seat) >= DROP_SECONDS) _remove(state, seat); // let go
  }
  if (state.phase === 'racing') {
    const race = state.race;                                    // the race
    if (now >= race.ends + FINISH_GRACE) {
      for (const r of race.racers) if (!(r.seat in race.results)) race.results[r.seat] = { forfeit: true }; // never finished: forfeits
    }
    if (race.racers.every((r) => r.seat in race.results)) _settle(state, now); // everyone's in: settle
  } else if (state.phase === 'result' && now >= state.result_until) {
    state.phase = 'waiting';                                    // back to waiting
  }
}

/** Whether _advance would change anything (so a look can skip the write when it wouldn't). */
function _due(state, now) {
  if (state.seats.some((s) => s.role !== 'gone' && _quiet(state, s) >= DROP_SECONDS)) return true; // a seat to let go
  if (state.phase === 'racing') {
    const race = state.race;                                    // the race
    return now >= race.ends + FINISH_GRACE || race.racers.every((r) => r.seat in race.results); // time's up or all in
  }
  return state.phase === 'result' && now >= state.result_until; // the result is done showing
}

/** Close a table: a race still running settles first (finished racers are paid, bets decided), open bets come back. */
function _close(state, now) {
  if (state.phase === 'racing') {
    for (const r of state.race.racers) if (!(r.seat in state.race.results)) state.race.results[r.seat] = { forfeit: true }; // unfinished: forfeit
    _settle(state, now);                                        // settle what there is
  }
  _refundBets(state);                                           // open bets back
  getDb().prepare('DELETE FROM lumi_arcade_rooms WHERE code = ?').run(state.code); // the table goes
  lobby.PRESENCE.forget(_key(state.code));                      // nobody is "at" it any more
  HUB.clear(state.code);                                        // boards go; streams look again (and end)
}

// Is nobody (but gone racers) at the table?
function _empty(state) {
  return !state.seats.some((s) => s.role !== 'gone');           // no live seat
}

// ---------------------------------------------------------------------------------------------- public

/** What a page may see: no actors or accounts; the seed only once the race has started. */
function _public(state, actor) {
  const me = _seatOf(state, actor);                             // the viewer's seat
  const seats = state.seats.filter((s) => s.role !== 'gone').map((s) => ({
    id: s.id, name: s.name, role: s.role, ready: s.ready,       // who sits where
    away: _quiet(state, s) >= AWAY_SECONDS,                     // no stream for a while
    you: s === me,                                              // the viewer
    look: s.look || PLAIN_LOOK,                                 // their Lumi
  }));
  let race = null;                                              // the race, if any
  if (state.race) {
    const r = state.race;                                       // shorthand
    const mine = me ? r.racers.find((x) => x.seat === me.id) : null; // my racer entry
    race = {
      seed: r.seed, started: r.started, ends: r.ends,           // shared facts
      racers: r.racers.map((x) => ({ seat: x.seat, role: x.role, name: x.name, done: x.seat in r.results })), // who's done
      run: mine && !(mine.seat in r.results) ? mine.run : null, // my run ticket while I'm still racing
    };
  }
  const totals = { p1: 0, p2: 0 };                              // SGC riding on each racer
  for (const bet of state.bets) {
    const target = state.seats.find((s) => s.id === bet.target); // who it's on
    if (target && target.role in totals) totals[target.role] += bet.paid || 0; // add its SGC
  }
  const mineBets = me ? state.bets.filter((b) => b.bettor === me.id).map((b) => ({ // my own bets
    role: (state.seats.find((s) => s.id === b.target) || {}).role || '?', amount: b.paid || 0, native: b.amount })) : []; // in SGC
  let last = null;                                              // the last result
  if (state.last) {
    const { payouts, ...shown } = state.last;                   // bet payouts are private
    last = { ...shown, yours: me && Array.isArray(payouts) ? payouts.filter((p) => p.bettor === me.id).map(({ bettor, ...p }) => p) : [] }; // only mine
  }
  return {
    code: state.code, game: state.game, name: state.name, phase: state.phase, // the table
    revision: state.revision, seats, you: me ? me.id : null, role: me ? me.role : null, race, // seats + race
    bets: { ...totals, mine: mineBets }, last, result_until: state.result_until, server_time: nowS(), // bets + result
    entry: price(state.game, 'entry', ENTRY), entry_native: ENTRY, // SGC per racer (and erinne's 25)
    chips: [...BET_CHIPS], chip_prices: BET_CHIPS.map((n) => price(state.game, 'bet', n)), // chip sizes + their SGC
    bet_limit: BET_LIMIT, race_seconds: RACE_SECONDS,           // limits
  };
}

/** One line in the lobby. */
function _summary(state, actor) {
  const live = state.seats.filter((s) => s.role !== 'gone');    // seats that count
  return {
    code: state.code, name: state.name, phase: state.phase,     // the table
    racers: live.filter((s) => s.role === 'p1' || s.role === 'p2').length, // 0-2
    watchers: live.filter((s) => s.role === 'watch').length,    // 0-5
    mine: live.some((s) => s.actor === actor),                  // am I there?
  };
}

// ---------------------------------------------------------------------------------------------- lobby

// Is a table stale (nobody changed it for hours, or everyone has been gone DROP_SECONDS)?
function _stale(row, now) {
  const state = parseJson(row.state, null);                     // its JSON
  if (!state) return true;                                      // broken: tidy it away
  return row.updated_at <= now - IDLE_SECONDS || state.seats.every((s) => _quiet(state, s) >= DROP_SECONDS); // idle or empty
}

/** Close tables nobody is at any more (or that nobody has changed in hours). Looks without writing first. */
function sweep() {
  const now = nowS();                                           // one clock reading
  const select = getDb().prepare('SELECT code, state, updated_at FROM lumi_arcade_rooms'); // every table
  if (!select.all().some((row) => _stale(row, now))) return;    // nothing to do: no write
  tx(() => {
    for (const row of select.all()) {
      if (!_stale(row, now)) continue;                          // still lively
      const state = parseJson(row.state, null);                 // its JSON
      if (state) _close(state, now);                            // settle + refund + delete
      else getDb().prepare('DELETE FROM lumi_arcade_rooms WHERE code = ?').run(row.code); // broken row: just drop it
    }
  });
}

/** This game's tables, newest change first, leaving out any nobody is at. */
function tables(game, actor) {
  sweep();                                                      // tidy first
  const rows = getDb().prepare('SELECT state FROM lumi_arcade_rooms WHERE game = ? ORDER BY updated_at DESC LIMIT ?').all(game, MAX_TABLES); // the list
  return rows.map((r) => parseJson(r.state, null)).filter(Boolean).map((s) => _summary(s, actor)); // one line each
}

/** A seat, with its player's Lumi's look as she sat down (drawn on their board). */
function _newSeat(actor, name, account, role, look) {
  return { id: token(), actor, name: String(name || 'Someone').slice(0, 40), account: String(account), role, ready: false, look: look || PLAIN_LOOK }; // the seat
}

/** One table per game at a time: sitting down somewhere leaves the others, unless you're racing at one. INSIDE tx. */
function _leaveOthers(game, actor, keep, now) {
  const rows = getDb().prepare('SELECT state FROM lumi_arcade_rooms WHERE game = ? AND code != ?').all(game, keep || ''); // the other tables
  for (const row of rows) {
    const state = parseJson(row.state, null);                   // its JSON
    if (!state) continue;                                       // broken: skip
    const seat = _seatOf(state, actor);                         // am I there?
    if (!seat || seat.role === 'gone') continue;                // no
    if (state.phase === 'racing' && state.race.racers.some((r) => r.seat === seat.id)) {
      throw refused("You're racing at another table. Finish or leave that race first."); // can't walk out mid-race
    }
    _remove(state, seat);                                       // leave it
    if (_empty(state)) {
      _close(state, now);                                       // nobody left: close
    } else {
      state.revision += 1;                                      // a change
      _save(state, now);                                        // store
      HUB.wake(state.code);                                     // its streams look again
    }
  }
}

/** A new table, named for whoever opened it, with them in the P1 seat. */
function create(game, actor, name, account) {
  if (!GAMES.includes(game)) throw refused('No such game.', 404); // only the three
  const now = nowS();                                           // one clock reading
  sweep();                                                      // tidy first
  const state = tx(() => {
    const count = getDb().prepare('SELECT count(*) AS n FROM lumi_arcade_rooms WHERE game = ?').get(game).n; // tables now
    if (count >= MAX_TABLES) throw refused('There are as many tables as there can be. Join one of them.', 429); // full
    _leaveOthers(game, actor, null, now);                       // one table at a time
    const code = lobby.newCode('lumi_arcade_rooms');            // a free code
    lobby.PRESENCE.seen(_key(code), actor);                     // here now
    const fresh = {
      code, game, name: `${String(name || 'Someone').slice(0, 40)}'s ${NAMES[game]} table`, revision: 1, // the table
      phase: 'waiting', seats: [_newSeat(actor, name, account, 'p1', arcade.lumiLook(account))], race: null, bets: [], // P1 = opener
      last: null, result_until: 0,                              // no result yet
    };
    getDb().prepare('INSERT INTO lumi_arcade_rooms (code, game, state, updated_at) VALUES (?, ?, ?, ?)').run(code, game, JSON.stringify(fresh), now); // store
    return fresh;                                               // the new table
  });
  return _public(state, actor);                                 // what the page sees
}

/** A table as this player sees it now. Catches the table up on its timers, writing only when one is due. */
function look(game, code, actor) {
  const now = nowS();                                           // one clock reading
  const state = _read(game, code);                              // 404 when closed
  if (!_due(state, now)) return _public(state, actor);          // nothing to catch up: no write
  return act(game, code, actor, '', null, null);                // catch up (no action)
}

/**
 * One thing a player does at a table (action null: just bring it up to date).
 * @param {string} actor   'user:<discord id>' (erinne _table_identity)
 * @param {string} name    display name
 * @param {string|null} account  Discord id string that pays and is paid
 * @param {string|null} action   join | leave | ready | seat | stand | bet | null
 * @param {{target?: string, amount?: number}} [opts] for bets: 'p1'/'p2' and a native chip
 */
function act(game, code, actor, name, account, action, { target = '', amount = 0 } = {}) {
  const now = nowS();                                           // one clock reading
  if (action !== null && action !== undefined) lobby.PRESENCE.seen(_key(code), actor); // doing something = here
  return tx(() => {
    const state = _read(game, code);                            // 404 when closed
    const before = JSON.stringify(state);                       // to see if anything changed
    if (action === 'join') _leaveOthers(game, actor, code, now); // one table per game
    _advance(state, now);                                       // timers and absences
    let seat = _seatOf(state, actor);                           // my seat
    if (seat && seat.role === 'gone') seat = null;              // a forfeited racer has no seat
    if (action === 'join') {
      if (!seat) seat = _join(state, actor, name, account, arcade.lumiLook(account)); // sit down
    } else if (action !== null && action !== undefined && !seat) {
      throw refused("You're not at this table any more. Join it again from the lobby.", 403); // not seated
    } else if (action === 'leave') {
      _remove(state, seat);                                     // get up
    } else if (action === 'ready') {
      _ready(state, seat, now);                                 // toggle ready (may start the race)
    } else if (action === 'seat') {
      _takeSeat(state, seat);                                   // watcher -> racer
    } else if (action === 'stand') {
      _stand(state, seat);                                      // racer -> watcher
    } else if (action === 'bet') {
      _bet(state, seat, target, amount);                        // a chip on a racer
    } else if (action !== null && action !== undefined) {
      throw refused("That isn't something you can do here.", 422); // unknown action
    }
    if (_empty(state)) {
      _close(state, now);                                       // nobody left: close
      return { left: true };                                    // tell the page
    }
    if (before !== JSON.stringify(state)) {
      state.revision += 1;                                      // a change
      _save(state, now);                                        // store
      HUB.wake(code);                                           // streams look again
    }
    return action === 'leave' ? { left: true } : _public(state, actor); // the page's view
  });
}

/** Sit down: in an empty racer seat between races (unless the other racer is the same account), else to watch. */
function _join(state, actor, name, account, look) {
  for (const role of ['p1', 'p2']) {
    const other = _racer(state, role === 'p1' ? 'p2' : 'p1');   // the other racer
    if (state.phase !== 'racing' && !_racer(state, role) && (!other || other.account !== String(account))) {
      const seat = _newSeat(actor, name, account, role, look);  // bets need both racers, so none can be riding yet
      state.seats.push(seat);                                   // seated
      return seat;                                              // as a racer
    }
  }
  if (state.seats.filter((s) => s.role === 'watch').length >= WATCHERS) throw refused('This table is full. Choose another or start one.'); // full
  const seat = _newSeat(actor, name, account, 'watch', look);   // a watcher
  state.seats.push(seat);                                       // seated
  return seat;                                                  // as a watcher
}

// Ready (or not) between races; both ready starts the race.
function _ready(state, seat, now) {
  if (!(seat.role === 'p1' || seat.role === 'p2') || state.phase === 'racing') throw refused('Only the two racers get ready, between races.'); // not now
  if (state.phase === 'result') state.phase = 'waiting';        // the result can go
  seat.ready = !seat.ready;                                     // toggle
  const p1 = _racer(state, 'p1');                               // racer one
  const p2 = _racer(state, 'p2');                               // racer two
  if (p1 && p2 && p1.ready && p2.ready) _startRace(state, now); // both ready: go
}

// A watcher takes an empty racer seat between races.
function _takeSeat(state, seat) {
  if (seat.role !== 'watch' || state.phase === 'racing') throw refused('Watchers take an empty racer seat between races.'); // not now
  for (const role of ['p1', 'p2']) {
    const other = _racer(state, role === 'p1' ? 'p2' : 'p1');   // the other racer
    if (!_racer(state, role) && (!other || other.account !== seat.account)) {
      _refundBets(state, seat.id);                              // a racer can't have bets riding
      seat.role = role;                                         // seated as a racer
      seat.ready = false;                                       // not ready yet
      return;                                                   // done
    }
  }
  throw refused('Both racer seats are taken.');                 // no room
}

// A racer stands down to watch between races.
function _stand(state, seat) {
  if (!(seat.role === 'p1' || seat.role === 'p2') || state.phase === 'racing') throw refused('Racers can stand down between races.'); // not now
  if (state.seats.filter((s) => s.role === 'watch').length >= WATCHERS) throw refused("There's no room to watch. Leave the table instead."); // full
  _refundBets(state);                                           // the pair changed: every bet comes back
  for (const other of state.seats) other.ready = false;         // nobody ready
  seat.role = 'watch';                                          // watching now
  seat.ready = false;                                           // not ready
}

// A watcher puts a chip on a racer.
function _bet(state, seat, target, amount) {
  if (seat.role !== 'watch') throw refused('Only watchers bet.'); // racers don't
  if (state.phase === 'racing') throw refused('Bets close when the race starts.'); // too late
  const racer = target === 'p1' || target === 'p2' ? _racer(state, target) : null; // who it's on
  if (!racer || !_racer(state, target === 'p2' ? 'p1' : 'p2')) throw refused('Bet once both racers are seated.'); // need two
  if (!BET_CHIPS.includes(amount)) throw refused(`Bets come in chips of ${BET_CHIPS.join(', ')}.`, 422); // native chips only
  const riding = state.bets.filter((b) => b.bettor === seat.id).reduce((sum, b) => sum + b.amount, 0); // my native total
  if (riding + amount > BET_LIMIT) throw refused(`You can have up to ${price(state.game, 'bet', BET_LIMIT)} SGC riding on one race.`); // limit
  let paid;                                                     // SGC charged for this chip
  try {
    paid = sgc.spend(seat.account, seat.name, amount, state.game, 'bet', { key: 'bet' }); // charge the chip
  } catch (error) {
    if (error instanceof LumiError && error.code === 'not_enough_sgc') {
      throw notEnoughSGC(error.extra.need, error.extra.have, "You don't have enough SGC for that bet."); // erinne's words
    }
    throw error;                                                // anything else as it is
  }
  if (state.phase === 'result') state.phase = 'waiting';        // the result can go
  const same = state.bets.find((b) => b.bettor === seat.id && b.target === racer.id); // a bet on the same racer?
  if (same) {
    same.amount += amount;                                      // chips stack on one bet (native)
    same.paid += paid;                                          // and their SGC
  } else {
    state.bets.push({ id: token(), bettor: seat.id, account: seat.account, name: seat.name, target: racer.id, amount, paid }); // a new bet
  }
}

/**
 * A racer's checked run (arcade.finish) comes back to the table; the race settles once both are in. INSIDE the
 * caller's tx. A table that has closed already, or a race that has moved on, simply ignores it.
 */
function record(game, code, runId, result) {
  const row = getDb().prepare('SELECT state FROM lumi_arcade_rooms WHERE code = ? AND game = ?').get(String(code), game); // the table
  if (!row) return;                                             // closed already
  const state = parseJson(row.state, null);                     // its JSON
  if (!state) return;                                           // broken: ignore
  const now = nowS();                                           // one clock reading
  const race = state.race;                                      // the race
  const racer = race ? race.racers.find((r) => r.run === runId) : null; // whose run
  if (!racer || racer.seat in race.results) return;             // not this race, or already in
  const kept = {};                                              // the numbers that rank it
  for (const k of ['score', 'distance', 'level', 'length']) if (k in result) kept[k] = result[k]; // copy
  race.results[racer.seat] = kept;                              // in
  if (race.racers.every((r) => r.seat in race.results)) _settle(state, now); // both in: settle
  state.revision += 1;                                          // a change
  _save(state, now);                                            // store
  HUB.wake(code);                                               // streams look again
}

// ---------------------------------------------------------------------------------------------- live boards

/**
 * The racers' live boards (score, bricks or snake, ball and bat), in memory: they change several times a second and
 * matter only while the race lasts. Streams wait here for a board or a table change (wake). Also used by the Lumi
 * party module (erinne lumiparty.HUB = showdown.Hub()).
 *
 *   const hub = new Hub();
 *   const stop = hub.listen(code, () => { ...look again... });   // called (on the next tick) after wake/push/clear
 *   const [tableV, boardsV] = hub.version(code);                   // change counters to compare against
 *   hub.wake(code); hub.push(code, seatId, board); hub.snapshot(code); hub.clear(code); stop();
 */
class Hub {
  constructor() {
    this.boards = new Map();                                    // code -> Map(seat id -> latest board)
    this.waiters = new Map();                                   // code -> Set(listener functions)
    this.versions = new Map();                                  // code -> [table changes, board changes]
  }

  /** [table changes, board changes] for a code (counters only move while someone listens). */
  version(code) {
    const v = this.versions.get(String(code));                  // the counters
    return v ? [v[0], v[1]] : [0, 0];                           // a copy
  }

  // Bump one counter and call every listener on the next tick (never inside the caller's transaction).
  _bump(code, which) {
    const key = String(code);                                   // map key
    const v = this.versions.get(key);                           // counters (only while someone listens)
    if (v) v[which] += 1;                                       // count the change
    const listeners = this.waiters.get(key);                    // who waits
    if (!listeners || listeners.size === 0) return;             // nobody
    for (const fn of [...listeners]) {
      setImmediate(() => {                                      // after the current work (and its tx) is done
        try { fn(); } catch { /* a listener bug must not break the table */ } // isolated
      });
    }
  }

  /** The table changed: every stream for it looks again. */
  wake(code) {
    this._bump(code, 0);                                        // table counter
  }

  /** A racer's latest board. */
  push(code, seat, board) {
    const key = String(code);                                   // map key
    if (!this.boards.has(key)) this.boards.set(key, new Map()); // first board at this table
    this.boards.get(key).set(String(seat), board);              // latest wins
    this._bump(code, 1);                                        // boards counter
  }

  /** Every racer's latest board: { seatId: board }. */
  snapshot(code) {
    const boards = this.boards.get(String(code));               // this table's boards
    return boards ? Object.fromEntries(boards) : {};            // a plain copy
  }

  /** A new race (or a closed table): the old boards go. */
  clear(code) {
    this.boards.delete(String(code));                           // gone
    this._bump(code, 1);                                        // streams send the empty set
  }

  /** Call fn() whenever this code changes. Returns a function that stops it (same as unlisten). */
  listen(code, fn) {
    const key = String(code);                                   // map key
    if (!this.waiters.has(key)) this.waiters.set(key, new Set()); // first listener
    this.waiters.get(key).add(fn);                              // add it
    if (!this.versions.has(key)) this.versions.set(key, [0, 0]); // start counting
    return () => this.unlisten(code, fn);                       // the stopper
  }

  /** Stop calling fn for this code; the last listener gone forgets the counters (memory stays bounded). */
  unlisten(code, fn) {
    const key = String(code);                                   // map key
    const set = this.waiters.get(key);                          // its listeners
    if (set) set.delete(fn);                                    // remove
    if (!set || set.size === 0) {
      this.waiters.delete(key);                                 // nobody listens
      this.versions.delete(key);                                // so no counters needed
      if (!this.boards.has(key) || this.boards.get(key).size === 0) this.boards.delete(key); // tidy empty boards
    }
  }
}

const HUB = new Hub();                                          // showdown boards and table wakes

/** The seat this player races in right now, if they're mid-race and not finished: who may send a live board. */
function racingSeat(game, code, actor) {
  const row = getDb().prepare('SELECT state FROM lumi_arcade_rooms WHERE code = ? AND game = ?').get(String(code), game); // the table
  if (!row) return null;                                        // closed
  const state = parseJson(row.state, null);                     // its JSON
  if (!state) return null;                                      // broken
  const seat = _seatOf(state, actor);                           // my seat
  const race = state.race;                                      // the race
  if (!seat || !race || state.phase !== 'racing') return null;  // not racing
  const racer = race.racers.find((r) => r.seat === seat.id);    // am I a racer?
  return racer && !(racer.seat in race.results) ? racer.seat : null; // still going
}

module.exports = {
  GAMES, WATCHERS, DROP_SECONDS, AWAY_SECONDS, RESULT_SECONDS, RACE_SECONDS, FINISH_GRACE, // timings
  BET_CHIPS, BET_LIMIT, MAX_TABLES, IDLE_SECONDS, NAMES,        // limits + names
  Hub, HUB,                                                     // live boards (Hub is reused by parties)
  sweep, tables, create, look, act, record, racingSeat,         // the public API
  _key, _public, _summary, _settle, _refundBets, _remove, _advance, _due, _close, // helpers (tests, parties)
};
