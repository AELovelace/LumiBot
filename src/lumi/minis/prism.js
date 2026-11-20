'use strict';

/**
 * Prism Drop's rules and the game in progress, ported from erinne mnemerynne/prism.py (commit 0ddc466). They live on
 * the server so a finished game can pay: a browser could claim any score, so this rolls every drop and the page only
 * animates what comes back (public/lumi/prism-drop/game.js).
 *
 * Pick one of ten pockets, drop through twenty rows of pins, ten drops a game. draw(n) returns a whole number from 0
 * to n-1: play uses a secure one, the tests a scripted one.
 *
 * Coins (CONTRACT.md section 5): the tenth drop pays score / PRISM_POINTS_PER_COIN (erinne coins.py:28, native) via
 * sgc.pay(..., 'prism', 'win', 'lumi-prism:<uid>:<ms>'), capped by tuning.cap('prism') (erinne media prism_daily_cap).
 * erinne had no ref here; lumi_prism_runs keeps one row per player (no run id), so the run is named by player + time.
 */

const crypto = require('node:crypto');                                           // secure draws
const { getDb, tx, nowMs } = require('../db');                                   // DB, transactions, clock
const sgc = require('../sgc');                                                   // the only door to coins
const { person, payWords } = require('./who');                                   // who -> {id, name}; pay words

const GAME = 'prism';                                                            // tuning / ledger id
const WIDTH = 10;                                                                // ten pins across
const HEIGHT = 20;                                                               // twenty rows
const DROPS = 10;                                                                // ten drops a game
const OBSTACLE_COUNTS = { block: 11, bomb: 9, coin: 8 };                         // special pegs on each drop's field
const COIN_MIN = 1;                                                              // a coin peg's smallest bonus
const COIN_MAX = 5;                                                              // and its biggest
const POINTS = [20, 15, 10];                                                     // landing 0, 1, 2 pockets from the pick
const BLAST_DIRECTIONS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]; // column, row
const PLATFORM_ROWS = [[5, 9], [12, 16]];                                        // each platform gets one row from its band
const PLATFORM_SPAN = 3;                                                         // columns wide
const PLATFORM_RISE = 4;                                                         // rows a bounce throws the ball back up
const PLATFORM_BOUNCES = 2;                                                      // bounces each platform gives per drop
const PRISM_POINTS_PER_COIN = 10;                                                // erinne coins.PRISM_POINTS_PER_COIN (native)

const secureDraw = (n) => crypto.randomInt(0, n);                                // erinne secrets.randbelow

/** Two platforms for one drop: row, leftmost column, direction. */
function randomPlatforms(draw) {
  return PLATFORM_ROWS.map(([low, high]) => ({ row: low + draw(high - low + 1), left: 1 + draw(WIDTH - PLATFORM_SPAN + 1), dir: draw(2) === 0 ? -1 : 1 })); // one per band
}

/** A platform's leftmost column after `tick` steps: one column a step, turning at the walls (game.js platformLeft). */
function platformLeft(platform, tick) {
  return _reflect(platform.left + platform.dir * tick, 1, WIDTH - PLATFORM_SPAN + 1); // bounce inside the field
}

/** Where a platform throws the ball: the edge struck sends it that way, its motion pushes it along. -> [column, row] */
function _bounce(point, platform, tick) {
  const left = platformLeft(platform, tick);                                     // where it is now
  const offset = point.column - (left + 1);                                      // -1 left edge, 0 middle, 1 right edge
  const motion = platformLeft(platform, tick + 1) - left;                        // -1 sliding left, 1 sliding right
  return [_reflect(point.column + offset * 2 + motion, 1, WIDTH), Math.max(0, point.row - PLATFORM_RISE)]; // the throw
}

/** 28 special pegs in unique cells across rows 1-19; row 0 and any skipRows stay clear. */
function randomObstacles(draw, skipRows = []) {
  const cells = [];                                                              // every free cell
  for (let i = 0; i < (HEIGHT - 1) * WIDTH; i++) {
    const row = 1 + Math.floor(i / WIDTH);                                       // its row
    if (!skipRows.includes(row)) cells.push({ row, column: 1 + (i % WIDTH) });   // keep it unless skipped
  }
  const layout = [];                                                             // the pegs
  for (const [kind, count] of Object.entries(OBSTACLE_COUNTS)) {
    for (let n = 0; n < count; n++) {
      const pick = draw(cells.length);                                           // a cell
      layout.push({ ...cells[pick], type: kind });                               // a peg there
      cells[pick] = cells[cells.length - 1];                                     // without replacement
      cells.pop();                                                               // (erinne's swap-pop)
    }
  }
  return layout;                                                                 // 28 pegs
}

/** Bounce a position back inside low..high, like a ball off the walls. */
function _reflect(value, low, high) {
  while (value < low || value > high) value = value < low ? low * 2 - value : high * 2 - value; // mirror until inside
  return value;                                                                  // inside
}

/** One drop: the path, which pegs and platforms it hit, and the coin-peg bonus. */
function drop(draw, obstacles, platforms = []) {
  const cells = new Map(obstacles.map((o) => [`${o.row},${o.column}`, o.type])); // (row, column) -> type
  const onRow = new Map(platforms.map((p, i) => [p.row, i]));                    // row -> platform index
  const bounces = platforms.map(() => 0);                                        // bounces used
  const spent = new Set();                                                       // used coin pegs and bombs
  const trajectory = [{ row: 0, column: 4 + draw(4) }];                          // enters at pin 4, 5, 6 or 7
  let bonus = 0;                                                                 // coin-peg points
  while (trajectory[trajectory.length - 1].row < HEIGHT) {
    const point = trajectory[trajectory.length - 1];                             // where the ball is
    const key = `${point.row},${point.column}`;                                  // its cell
    const kind = cells.get(key);                                                 // a peg there?
    const tick = trajectory.length - 1;                                          // platforms' clock
    const index = onRow.get(point.row);                                          // a platform on this row?
    const falling = tick > 0 && trajectory[trajectory.length - 2].row < point.row; // only a falling ball is caught
    const struck = index !== undefined && falling && bounces[index] < PLATFORM_BOUNCES
      && platformLeft(platforms[index], tick) <= point.column && point.column < platformLeft(platforms[index], tick) + PLATFORM_SPAN; // on it?
    let column;                                                                  // next column
    let row;                                                                     // next row
    if (struck) {
      bounces[index] += 1;                                                       // one bounce used
      point.hit = 'platform';                                                    // for the page
      point.platform = index;                                                    // which one
      [column, row] = _bounce(point, platforms[index], tick);                    // thrown up
    } else if (kind === 'bomb' && !spent.has(key)) {
      spent.add(key);                                                            // each bomb fires once
      point.hit = 'bomb';                                                        // for the page
      const direction = BLAST_DIRECTIONS[draw(BLAST_DIRECTIONS.length)];         // which way
      const distance = 2 + draw(2);                                              // 2 or 3
      column = _reflect(point.column + direction[0] * distance, 1, WIDTH);       // off the walls
      row = Math.min(HEIGHT, Math.abs(point.row + direction[1] * distance));     // off the ceiling
    } else {
      if (kind === 'block') point.hit = 'block';                                 // a block
      if (kind === 'coin' && !spent.has(key)) {
        spent.add(key);                                                          // once per peg per drop
        point.hit = 'coin';                                                      // for the page
        point.coins = COIN_MIN + draw(COIN_MAX - COIN_MIN + 1);                  // 1..5
        bonus += point.coins;                                                    // add it
      }
      const shove = kind === 'block' ? 2 : 1;                                    // a block shoves two
      column = _reflect(point.column + (draw(2) === 0 ? -1 : 1) * shove, 1, WIDTH); // left or right
      row = point.row + 1;                                                       // down a row
    }
    trajectory.push({ row, column });                                            // next point
  }
  return { obstacles, platforms: [...platforms], trajectory, landing: trajectory[trajectory.length - 1].column, bonus }; // the drop
}

/** 20 for the right pocket, 15 one away, 10 two away, nothing further. */
function landingPoints(pick, landing) {
  const distance = Math.abs(pick - landing);                                     // pockets away
  return distance < POINTS.length ? POINTS[distance] : 0;                        // points
}

/** A whole drop for this pick: a fresh field, the path and its score, shaped for the page. */
function roll(pick, draw = secureDraw) {
  const platforms = randomPlatforms(draw);                                       // two platforms
  const result = drop(draw, randomObstacles(draw, platforms.map((p) => p.row)), platforms); // platform rows keep clear of pegs
  result.pick = pick;                                                            // the pocket chosen
  result.landingPoints = landingPoints(pick, result.landing);                    // landing points
  result.points = result.landingPoints + result.bonus;                           // plus coin pegs
  return result;                                                                 // the drop
}

/** erinne current(): the game this player has in progress. Read-only. */
function current(uid) {
  const row = getDb().prepare('SELECT drops, score FROM lumi_prism_runs WHERE user_id = ?').get(String(uid)); // the row
  return row ? { drops: row.drops, score: row.score } : { drops: 0, score: 0 };   // or a new game
}

/**
 * erinne play(): roll this player's next drop. The tenth ends the game and pays (capped per LA day by tuning).
 * Opens its own transaction (nested in a caller's tx it becomes a savepoint).
 * Returns { round, drops, score, over, earned (native coins), paid (SGC), owed, capped, said, coins (SGC balance) }.
 */
function play(who, pick, draw = secureDraw) {
  const p = person(who);                                                         // the player
  return tx(() => {                                                              // one drop at a time
    const run = current(p.id);                                                   // so far
    const result = roll(pick, draw);                                             // this drop
    const drops = run.drops + 1;                                                 // one more drop
    const score = run.score + result.points;                                     // new score
    const over = drops >= DROPS;                                                 // the tenth?
    let earned = 0;                                                              // native coins won
    let money = { paid: 0, owed: 0, capped: false };                             // what sgc did
    if (over) {
      earned = Math.floor(score / PRISM_POINTS_PER_COIN);                        // erinne prism.py:147
      money = sgc.pay(p.id, p.name, earned, GAME, 'win', `lumi-prism:${p.id}:${nowMs()}`); // bank -> player (capped)
      getDb().prepare('DELETE FROM lumi_prism_runs WHERE user_id = ?').run(p.id); // game over
    } else {
      getDb().prepare(`
        INSERT INTO lumi_prism_runs (user_id, drops, score) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET drops = excluded.drops, score = excluded.score, updated_at = datetime('now')
      `).run(p.id, drops, score);                                                // keep the game going
    }
    return {
      round: result, drops, score, over, earned, paid: money.paid, owed: money.owed, capped: money.capped, // what happened
      said: payWords(money, 'Prism Drop'),                                       // owed / capped words ('' otherwise)
      coins: sgc.balance(p.id),                                                  // SGC balance
    };
  });
}

module.exports = {
  GAME, WIDTH, HEIGHT, DROPS, OBSTACLE_COUNTS, COIN_MIN, COIN_MAX, POINTS, BLAST_DIRECTIONS, PLATFORM_ROWS, // constants
  PLATFORM_SPAN, PLATFORM_RISE, PLATFORM_BOUNCES, PRISM_POINTS_PER_COIN,
  randomPlatforms, platformLeft, _bounce, randomObstacles, _reflect, drop, landingPoints, roll, // the rules
  current, play,                                                                 // the game in progress
};
