'use strict';

/**
 * Yarn Pop (slug breakout), Lumi Conga (slug snake) and Teacup Tower: what the server needs to check a run before it
 * pays (erinne mnemerynne/arcade.py, ported from Doll's GameMaker arcade).
 *
 * All three run in the browser (public/lumi/breakout, snake, teacup-tower). The server hands each run a seed, and the
 * page builds its levels or places its food from that seed with the same arithmetic, so the server can check:
 *  - Snake exactly: the page sends the moves it turned on, and snakeReplay plays the whole game again here. The score
 *    paid is the one this file worked out, never the page's.
 *  - Breakout by what's possible: breakoutField rebuilds every level from the seed, so a claimed score must lie
 *    between the bricks of the levels cleared and those plus the level reached, and come no faster than time allows.
 *  - Teacup Tower by time only: no more floors than the seconds allow. (Client-trusted: the daily cap guards it.)
 * The level builder and the food maths are the SAME files the page runs (public/lumi/<game>/rules.js), required here,
 * so the server and the page can never disagree.
 *
 * Coins (CONTRACT section 5, erinne natives): a solo run costs ENTRY (25 native -> sgc.spend(..., slug, 'entry'))
 * and pays its score, one native coin a point (sgc.pay(..., slug, 'win', '<slug>:<run>')). Showdown races are charged
 * and paid by showdown.js; their runs come through here too (start with a room, finish without paying).
 */

const crypto = require('node:crypto');                                  // fresh seeds
const { getDb, nowMs } = require('../db');                              // DB + clock
const sgc = require('../sgc');                                          // the only door to coins
const tuning = require('../tuning');                                    // entry price in SGC
const save = require('../pet/save');                                    // her look (read-only)
const { LumiError, notEnoughSGC } = require('../errors');               // player-facing "no"s
const BreakoutRules = require('../../../public/lumi/breakout/rules.js'); // the page's level builder
const SnakeRules = require('../../../public/lumi/snake/rules.js');       // the page's food maths

const GAMES = Object.freeze(['breakout', 'snake', 'teacup-tower']);    // the three arcade-shell games (slug = tuning id)
const ENTRY = 25;                                                       // native coins a solo run or a showdown race costs
const MODULUS = 2147483647;                                             // 2**31 - 1: every seed and random number is below it
const GLOWS = Object.freeze(['rose', 'lagoon', 'starlight', 'zephyr', 'wisp', 'umbra']); // her glow colours (lumipet.GLOWS)
const RUN_KEEP_SECONDS = 86400;                                         // finished runs are kept a day, then tidied

const STATUS_CODES = { 402: 'not_enough_sgc', 403: 'forbidden', 404: 'not_found', 409: 'refused', 422: 'invalid', 429: 'slow_down' }; // codes for erinne's statuses

/**
 * erinne Refused(message, status=409): a safe, actionable explanation for the player; nothing was changed.
 * Returns a LumiError (throw it). The code follows the status (402 not_enough_sgc, 404 not_found, 422 invalid ...).
 */
function refused(message, status = 409) {
  return new LumiError(status, STATUS_CODES[status] || 'refused', message); // same status + words as erinne
}

/**
 * How this person's Lumi looks (glow, what she wears, colour, name), so the arcade games draw their own Lumi.
 * Read-only (pet/save.look): no catching up, nothing written; someone without a Lumi gets a fresh one's look.
 */
function lumiLook(uid) {
  if (!uid) return { glow: 'rose', outfit: {} };                        // nobody: a fresh Lumi's look
  return save.look(String(uid));                                        // { glow, outfit, colour, name }
}

// ---------------------------------------------------------------------------------------------- numbers

/** One number from a seed and a position, the GameMaker game's own formula (snakeSeedValue). = rules.js mix. */
const mix = SnakeRules.mix;                                             // shared with the page

/** xorshift32 over one of mix's numbers (32-bit maths, identical in rules.js). */
const scramble = SnakeRules.scramble;                                   // shared with the page

/** The seed for one Breakout level, the GameMaker game's own formula (breakoutLevelSeed). = rules.js levelSeed. */
const levelSeed = BreakoutRules.levelSeed;                              // shared with the page

/** Park and Miller's generator: state * 48271 mod 2**31-1 (exact in a double: products stay below 2**53). */
class Minstd {
  constructor(seed) {
    this.state = (Math.trunc(Number(seed)) % MODULUS) || 1;             // never 0
  }

  next() {
    this.state = (this.state * 48271) % MODULUS;                        // the next number
    return this.state;                                                  // 1 .. MODULUS-1
  }

  /** A whole number from low to high, both included (GameMaker's irandom_range). */
  between(low, high) {
    return low + (this.next() % (high - low + 1));                      // inclusive range
  }
}

/** A fresh seed for a run or a race: 1 .. MODULUS-2. */
function newSeed() {
  return crypto.randomInt(1, MODULUS - 1);                              // like secrets.randbelow(MODULUS - 2) + 1
}

// ---------------------------------------------------------------------------------------------- Breakout

const BRICK_COLS = BreakoutRules.COLS;                                  // 18 columns ...
const BRICK_ROWS = BreakoutRules.ROWS;                                  // ... by 6 rows of bricks
const BRICKS_PER_SECOND = 6;                                            // the fastest a run may break bricks, multiball and all
const MAX_LEVEL = 500;                                                  // the highest level a claim may name

/** One level's bricks, row by row (108 cells): 0 for none, else its colour 1-6. The page's own builder. */
function breakoutField(seed, level) {
  return BreakoutRules.field(seed, level);                              // public/lumi/breakout/rules.js field()
}

/** How many bricks a level has. */
function breakoutBricks(seed, level) {
  return breakoutField(seed, level).filter(Boolean).length;             // non-empty cells
}

/**
 * A claimed Breakout run, if it's possible: every brick of the levels before `level` broken, part of this one, and
 * no faster than BRICKS_PER_SECOND. Returns { score, level, distance }.
 */
function checkBreakout(seed, score, level, seconds) {
  if (!(level >= 1 && level <= MAX_LEVEL)) throw refused("That level isn't possible.", 422); // 1..500 only
  let cleared = 0;                                                       // bricks in the levels before this one
  for (let n = 1; n < level; n++) cleared += breakoutBricks(seed, n);   // every earlier level, all of it
  if (!(cleared <= score && score <= cleared + breakoutBricks(seed, level))) throw refused("That score doesn't match the levels played.", 422); // outside the possible range
  if (score > seconds * BRICKS_PER_SECOND + 12) throw refused('That run was faster than the game allows.', 422); // too quick
  return { score, level, distance: (level - 1) * 100 + score };         // how a showdown ranks it
}

// ---------------------------------------------------------------------------------------------- Snake

const SNAKE_W = SnakeRules.W;                                           // 20 columns ...
const SNAKE_H = SnakeRules.H;                                           // ... by 15 rows
const SNAKE_START = Object.freeze([[10, 7], [9, 7], [8, 7]]);           // head first, heading right
const STEPS = SnakeRules.STEPS;                                         // directions 0-3: right, down, left, up
const FOOD_POINTS = SnakeRules.POINTS;                                  // { 2: 1, 3: 5, 4: 10 } red, yellow, aqua
const MOVES_PER_SECOND = 7.5;                                           // the fastest a page has ever played (pages do 6 now)

/** Where the index-th food goes and its kind ([x, y, kind 2-4]), or null when the board is full. The page's maths. */
function snakeFood(seed, index, board) {
  return SnakeRules.food(seed, index, board);                           // public/lumi/snake/rules.js food()
}

/**
 * Play a Snake run again from its seed and the moves it turned on ([move number, direction], in order). Returns the
 * score and length after `moves` moves and the move it died on, if it did (alive: false).
 */
function snakeReplay(seed, turns, moves) {
  const board = Array.from({ length: SNAKE_W }, () => new Array(SNAKE_H).fill(0)); // board[x][y]: 0 empty, 1 body, 2-4 food
  const body = SNAKE_START.map((c) => [c[0], c[1]]);                    // a fresh copy of the start
  for (const [x, y] of body) board[x][y] = 1;                           // the body on the board
  let foodIndex = 0;                                                    // which food comes next
  let score = 0;                                                        // points so far
  let heading = 0;                                                      // heading right
  let food = snakeFood(seed, foodIndex, board);                         // the first food
  board[food[0]][food[1]] = food[2];                                    // put it down
  foodIndex += 1;                                                       // the next one is #1
  const plan = new Map();                                               // move number -> new direction (dict(turns))
  for (const t of turns) plan.set(t[0], t[1]);                          // last one wins, like dict()
  for (let move = 1; move <= moves; move++) {
    if (plan.has(move)) {
      if (plan.get(move) === (heading + 2) % 4) throw refused('That run turned back on itself.', 422); // a U-turn into itself
      heading = plan.get(move);                                         // turn
    }
    const x = body[0][0] + STEPS[heading][0];                           // the head's next column
    const y = body[0][1] + STEPS[heading][1];                           // ... and row
    if (!(x >= 0 && x < SNAKE_W && y >= 0 && y < SNAKE_H)) return { score, length: body.length, alive: false, died: move }; // into the wall
    const cell = board[x][y];                                           // what's there
    const ate = Object.prototype.hasOwnProperty.call(FOOD_POINTS, cell); // food?
    const tail = body[body.length - 1];                                 // the last dancer
    if (cell === 1 && !(x === tail[0] && y === tail[1] && !ate)) return { score, length: body.length, alive: false, died: move }; // into itself
    if (!ate) {                                                         // the tail moves on first, so the head may take its cell
      board[tail[0]][tail[1]] = 0;                                      // tail cell empties
      body.pop();                                                       // tail gone
    }
    body.unshift([x, y]);                                               // the new head
    board[x][y] = 1;                                                    // on the board
    if (ate) {
      score += FOOD_POINTS[cell];                                       // points for that food
      food = snakeFood(seed, foodIndex, board);                         // the next food
      foodIndex += 1;                                                   // count it
      if (food === null) return { score, length: body.length, alive: false, died: move }; // the board is full: the end
      board[food[0]][food[1]] = food[2];                                // put it down
    }
  }
  return { score, length: body.length, alive: true, died: null };       // still dancing
}

/**
 * A Snake run as this server plays it: the claim must end the way the replay does, in no fewer seconds than the moves
 * take. Returns { score, length, distance } (the replay's numbers, never the page's).
 */
function checkSnake(seed, turns, moves, died, seconds) {
  for (let i = 1; i < turns.length; i++) {
    if (turns[i][0] <= turns[i - 1][0]) throw refused('Those moves are out of order.', 422); // must climb
  }
  if (turns.some((t) => !(t[0] >= 1 && t[0] <= moves))) throw refused('Those moves are out of order.', 422); // inside the run
  if (moves > seconds * MOVES_PER_SECOND * 1.1 + 10) throw refused('That run was faster than the game allows.', 422); // too quick
  const played = snakeReplay(seed, turns, moves);                       // play it again here
  if ((played.died === moves) !== Boolean(died) || (played.died !== null && played.died !== moves)) {
    throw refused("That run doesn't play out the way it says.", 422);   // the claim and the replay disagree
  }
  return { score: played.score, length: played.length, distance: played.score + Math.max(0, played.length - 3) * 5 }; // ranked
}

// ---------------------------------------------------------------------------------------------- Teacup Tower

const FLOORS_PER_SECOND = 6;                                            // well above the fastest climb (about 4.6 a second)

/** A claimed Teacup Tower climb, if the time allows it. Returns { score, distance } (both the floor). */
function checkTower(floors, seconds) {
  if (floors > seconds * FLOORS_PER_SECOND + 5) throw refused('That climb was faster than the game allows.', 422); // too quick
  return { score: floors, distance: floors };                           // the highest floor she landed on
}

// ---------------------------------------------------------------------------------------------- runs

/** What a solo run costs in SGC right now (the same number sgc.spend charges and the page shows). */
function entryPrice(game) {
  return tuning.scalePrice(game, 'entry', ENTRY);                       // 25 native -> SGC
}

/**
 * A ticket for one run. INSIDE db.tx(). A solo run pays ENTRY here (and forgets this person's unfinished solo runs:
 * closing the game forfeits them); a showdown has charged its racers already and passes the race's room + shared seed.
 * @returns {{run: number, seed: number, entry: number, charged: number}} entry/charged = SGC this run cost (0 for a race)
 */
function start(uid, name, game, { room = null, seed = null } = {}) {
  if (!GAMES.includes(game)) throw refused('No such game.', 404);      // only the three
  const db = getDb();                                                   // economy DB
  const now = nowMs() / 1000;                                           // unix seconds (erinne time.time())
  const user = String(uid);                                             // Discord id string
  let charged = 0;                                                      // SGC this run cost
  if (room === null) {
    const price = entryPrice(game);                                     // what it costs now
    const have = sgc.balance(user);                                     // what they hold
    if (price > have) throw notEnoughSGC(price, have, `A run costs ${price} SGC.`); // erinne's 402, in SGC
    charged = sgc.spend(user, name, ENTRY, game, 'entry', { key: 'entry' }); // pay the entry (native 25)
    db.prepare('DELETE FROM lumi_arcade_runs WHERE user_id = ? AND game = ? AND room IS NULL AND finished = 0').run(user, game); // older solo tickets forfeit
  }
  db.prepare('DELETE FROM lumi_arcade_runs WHERE finished = 1 AND started_at < ?').run(now - RUN_KEEP_SECONDS); // tidy old runs
  const useSeed = seed || newSeed();                                    // the race's seed, or a fresh one
  const info = db.prepare('INSERT INTO lumi_arcade_runs (user_id, game, seed, room, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(user, game, useSeed, room, now);                               // the ticket
  return { run: Number(info.lastInsertRowid), seed: useSeed, entry: charged, charged }; // what the page needs
}

/** The words a player sees about a prize that was owed or capped (CONTRACT section 5), or ''. */
function prizeNote(result) {
  if (result.owed > 0) return 'Lumi-Town Bank is closed for a moment, your prize is saved.'; // paid by a later sweep
  if (result.capped) return "You've hit today's prize limit for this game. Come back tomorrow!"; // daily cap
  return '';                                                            // nothing to say
}

/**
 * Check a finished run and close its ticket. INSIDE db.tx(). A solo run is paid here, once (ref '<game>:<run>'); a
 * race's result goes back to its showdown table (the route calls showdown.record), which pays when the race settles.
 * @param {object} claim { moves, turns, died } (snake) | { score, level } (breakout) | { score } (teacup-tower)
 * @returns {object} what the server made of the run: score, distance, ..., run, room (+ paid/owed/capped/coins/note solo)
 */
function finish(uid, name, game, runId, claim) {
  const db = getDb();                                                   // economy DB
  const user = String(uid);                                             // Discord id string
  const row = db.prepare('SELECT * FROM lumi_arcade_runs WHERE id = ? AND user_id = ? AND game = ? AND finished = 0').get(runId, user, game); // their open ticket
  if (!row) throw refused("That run has already finished, or isn't yours.", 404); // gone or someone else's
  const seconds = nowMs() / 1000 - row.started_at;                      // how long it took
  let result;                                                           // what the checks made of it
  if (game === 'snake') {
    result = checkSnake(row.seed, (claim.turns || []).map((t) => [t[0], t[1]]), claim.moves || 0, Boolean(claim.died), seconds); // replayed
  } else if (game === 'teacup-tower') {
    result = checkTower(claim.score || 0, seconds);                     // time-bounded
  } else {
    result = checkBreakout(row.seed, claim.score || 0, claim.level || 1, seconds); // level-bounded
  }
  db.prepare('UPDATE lumi_arcade_runs SET finished = 1 WHERE id = ?').run(runId); // close the ticket
  result.run = runId;                                                   // which run
  result.room = row.room;                                               // the table it raced at (null: solo)
  if (row.room === null) {
    const prize = sgc.pay(user, name, result.score, game, 'win', `${game}:${runId}`, { key: 'win' }); // one native coin a point
    result.paid = prize.paid;                                           // SGC paid now
    result.owed = prize.owed;                                           // SGC saved for later
    result.capped = prize.capped;                                       // daily cap hit?
    result.note = prizeNote(prize);                                     // what to tell them
    result.coins = sgc.balance(user);                                   // the new balance
  }
  return result;                                                        // the checked run
}

module.exports = {
  GAMES, ENTRY, MODULUS, GLOWS,                                         // constants
  BRICK_COLS, BRICK_ROWS, BRICKS_PER_SECOND, MAX_LEVEL,                 // Breakout constants
  SNAKE_W, SNAKE_H, SNAKE_START, STEPS, FOOD_POINTS, MOVES_PER_SECOND,  // Snake constants
  FLOORS_PER_SECOND,                                                    // Teacup Tower constant
  refused,                                                              // erinne Refused -> LumiError
  lumiLook,                                                             // her look
  mix, scramble, levelSeed, Minstd, newSeed,                            // numbers
  breakoutField, breakoutBricks, checkBreakout,                         // Breakout
  snakeFood, snakeReplay, checkSnake,                                   // Snake
  checkTower,                                                           // Teacup Tower
  entryPrice, prizeNote,                                                // SGC helpers
  start, finish,                                                        // runs
};
