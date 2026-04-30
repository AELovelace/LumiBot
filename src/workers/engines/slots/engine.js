'use strict';

/**
 * Pure slots logic — grid generation, payline evaluation, render helpers.
 * No Discord, no DB.
 */

const SYMBOLS = ['🍋', '🍒', '⭐', '💎', '7️⃣', '🔔'];
const SYMBOL_VALUES = Object.freeze({
  '🍋': 1,
  '🍒': 3,
  '⭐': 5,
  '💎': 10,
  '7️⃣': 15,
  '🔔': 0,
});
const BELL = '🔔';
const BET_OPTIONS = Object.freeze([1, 5, 10, 25]);
const GRID_ROWS = 3;
const GRID_COLS = 3;

const PAYLINES = Object.freeze([
  { name: 'Row 1', positions: [[0, 0], [0, 1], [0, 2]] },
  { name: 'Row 2', positions: [[1, 0], [1, 1], [1, 2]] },
  { name: 'Row 3', positions: [[2, 0], [2, 1], [2, 2]] },
  { name: 'Diagonal ↘', positions: [[0, 0], [1, 1], [2, 2]] },
  { name: 'Diagonal ↙', positions: [[0, 2], [1, 1], [2, 0]] },
]);

const DEFAULTS = {
  spinFrames: 6,
  spinFrameMs: 400,
  defaultBet: BET_OPTIONS[0],
  maxPlayers: 3,
  idleTimeoutMs: 300_000,
};

function randomGrid() {
  const grid = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < GRID_COLS; c++) {
      row.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    }
    grid.push(row);
  }
  return grid;
}

function placeholderGrid() {
  return Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill('🎰'));
}

function renderCompactGrid(grid) {
  return grid.map((row) => row.join(' ')).join('\n');
}

function isAllowedBet(amount) {
  return BET_OPTIONS.includes(amount);
}

function normalizeBet(amount) {
  return isAllowedBet(amount) ? amount : BET_OPTIONS[0];
}

function evaluatePayline(cells) {
  const nonBellSymbols = cells.filter((symbol) => symbol !== BELL);
  const uniqueNonBellSymbols = [...new Set(nonBellSymbols)];

  if (nonBellSymbols.length === 3 && uniqueNonBellSymbols.length === 1) {
    const matchedSymbol = uniqueNonBellSymbols[0];
    return {
      matchedSymbol,
      usedBell: false,
      points: SYMBOL_VALUES[matchedSymbol] * 3,
    };
  }

  if (nonBellSymbols.length === 2 && uniqueNonBellSymbols.length === 1 && cells.includes(BELL)) {
    const matchedSymbol = uniqueNonBellSymbols[0];
    return {
      matchedSymbol,
      usedBell: true,
      points: SYMBOL_VALUES[matchedSymbol] * 3,
    };
  }

  return null;
}

function evaluateGrid(grid) {
  const wins = [];
  let totalPoints = 0;

  for (const payline of PAYLINES) {
    const cells = payline.positions.map(([row, col]) => grid[row][col]);
    const result = evaluatePayline(cells);
    if (!result) continue;
    totalPoints += result.points;
    wins.push(
      `${payline.name} — ${cells.join('')} = ${result.points} pts${result.usedBell ? ` (🔔 wild → ${result.matchedSymbol})` : ''}`,
    );
  }

  return { totalPoints, wins };
}

function buildPayoutSummary() {
  return [
    'Hands: 3 rows + 2 diagonals.',
    'Payout = total winning hand points × bet.',
    `Values: 🍋 ${SYMBOL_VALUES['🍋']} • 🍒 ${SYMBOL_VALUES['🍒']} • ⭐ ${SYMBOL_VALUES['⭐']} • 💎 ${SYMBOL_VALUES['💎']} • 7️⃣ ${SYMBOL_VALUES['7️⃣']}`,
    '🔔 is a wild only with exactly 2 matching non-bell symbols.',
  ].join('\n');
}

function createPlayer(userId, username, settings) {
  return {
    userId,
    username,
    bet: normalizeBet(settings.defaultBet),
    grid: randomGrid(),
    statusText: 'Ready',
    spinning: false,
  };
}

function makeLobby(channelId) {
  return {
    channelId,
    players: new Map(),
    lastEvent: '',
  };
}

module.exports = {
  BELL,
  BET_OPTIONS,
  SYMBOLS,
  SYMBOL_VALUES,
  GRID_ROWS,
  GRID_COLS,
  PAYLINES,
  DEFAULTS,
  randomGrid,
  placeholderGrid,
  renderCompactGrid,
  isAllowedBet,
  normalizeBet,
  evaluateGrid,
  buildPayoutSummary,
  createPlayer,
  makeLobby,
};
