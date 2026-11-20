'use strict';
// TEST-ONLY stand-in for src/lumi/dungeon/lumidungeon.js, used by tests/lumi/party_harness.mjs only while the dungeon
// agent's real port is missing. Just the pieces lumiparty.js calls, shaped like erinne's lumidungeon.py.
const { getDb } = require('../../../src/lumi/db');                      // the economy DB (lumi_runs)
const B = require('../../../src/lumi/dungeon/lumibattle');              // the enemy catalog
const CATALOG = require('../../../src/lumi/data/dungeon.json');         // the real places
const SOKOBAN = require('../../../src/lumi/data/sokoban.json').levels;  // the real crate levels
const _ENVS = Object.fromEntries(CATALOG.environments.map((e) => [e.id, e])); // id -> place
const DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };            // the four ways
const RUNES = ['sun', 'moon', 'star', 'leaf', 'wave'];                   // rune symbols
const RUNE_SLOTS = 4, RUNE_TRIES = 8, CUPS = 3, PAIRS = 4, FLIPS = 14, MAX_MOVES = 600; // erinne's numbers
const FOUND_NAMES = {};                                                  // no decor sets in the stub

function current(uid) {                                                  // a solo run, if any
  const row = getDb().prepare('SELECT state FROM lumi_runs WHERE user_id = ?').get(String(uid)); // her row
  return row ? JSON.parse(row.state) : null;                             // parsed
}
function generate(envId, depth) {                                        // a two-room floor (tests replace it)
  return { rooms: { '0,0': { kind: 'start', exits: ['e'], seen: true, done: true }, '1,0': { kind: 'stairs', exits: ['w'], seen: false, done: true, depth } }, start: '0,0' };
}
function _step(at, way) { const [x, y] = at.split(',').map(Number); return `${x + DIRS[way][0]},${y + DIRS[way][1]}`; } // the next cell
function _enemy() { return { id: B.CATALOG.enemies[0].id }; }            // always the first creature
function _setPiece() { return null; }                                    // never a decor piece
function _coins(depth, rng, scale = 1) { return Math.trunc((10 + rng.randrange(16)) * (1 + 0.5 * (depth - 1)) * scale); } // erinne _coins
function _vaultLoot(env, depth, rng) { return { coins: _coins(depth, rng, 3), potions: 1 }; } // coins + a potion
function lightsPress(board, size, cell) {                                // Lights Out
  const x = cell % size, y = Math.floor(cell / size);                    // where
  for (const [cx, cy] of [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (cx >= 0 && cx < size && cy >= 0 && cy < size) board[cy * size + cx] = !board[cy * size + cx]; // flip
}
function lightsSolved(board, size, presses) {                            // all off after these presses?
  const lamps = [...board];                                              // a copy
  for (const cell of presses) { if (!(cell >= 0 && cell < size * size)) return false; lightsPress(lamps, size, cell); } // replay
  return !lamps.some(Boolean);                                           // every lamp off
}
function runeMarks(guess, code) {                                        // erinne rune_marks
  const spare = code.filter((answer, i) => guess[i] !== answer);         // unmatched code runes
  return guess.map((rune, i) => {                                        // each guessed rune
    if (rune === code[i]) return 'right';                                // right place
    const at = spare.indexOf(rune);                                      // elsewhere?
    if (at >= 0) { spare.splice(at, 1); return 'near'; }                 // near
    return 'miss';                                                       // not in it
  });
}
function _publicLock(lock) {                                             // a lock without its answer
  if (lock.kind === 'sokoban' && 'level' in lock) return { kind: 'sokoban', rows: SOKOBAN.find((l) => l.id === lock.level).rows }; // crates
  if (lock.kind === 'lights' && 'board' in lock) return { kind: 'lights', size: lock.size, board: lock.board }; // lamps
  if (lock.kind === 'runes' && 'code' in lock) return { kind: 'runes', runes: [...RUNES], slots: RUNE_SLOTS, tries: lock.tries, left: RUNE_TRIES - lock.tries.length }; // runes
  return { kind: lock.kind };                                            // a key door
}
function _publicGame(game, done) {                                       // a game without its secret
  if (game.kind === 'cups') return { kind: 'cups', cups: CUPS };         // cups
  const shown = new Set([...game.found, ...(game.open !== null ? [game.open] : []), ...(game.last || [])]); // face up
  return { kind: 'match', cards: game.deck.map((c, i) => (shown.has(i) || done ? c : null)), found: game.found, open: game.open, last: game.last, left: FLIPS - game.flips }; // cards
}
module.exports = { CATALOG, SOKOBAN, _ENVS, RUNES, RUNE_SLOTS, RUNE_TRIES, CUPS, PAIRS, FLIPS, MAX_MOVES, FOUND_NAMES, current, generate, _step, _enemy, _setPiece, _coins, _vaultLoot, lightsSolved, runeMarks, _publicLock, _publicGame, STUB: true };
