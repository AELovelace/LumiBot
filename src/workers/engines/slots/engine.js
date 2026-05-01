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
const REEL_WEIGHTS = Object.freeze([
  Object.freeze([
    // Tuned to land a payout on roughly 2% of spins while keeping
    // occasional cross-reel overlap for rare hits.
    ['🍋', 88],
    ['🍒', 5],
    ['⭐', 2],
    ['💎', 1],
    ['7️⃣', 1],
    ['🔔', 3],
  ]),
  Object.freeze([
    ['🍋', 2],
    ['🍒', 5],
    ['⭐', 86],
    ['💎', 3],
    ['7️⃣', 1],
    ['🔔', 3],
  ]),
  Object.freeze([
    ['🍋', 1],
    ['🍒', 2],
    ['⭐', 5],
    ['💎', 48],
    ['7️⃣', 41],
    ['🔔', 3],
  ]),
]);

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
      row.push(pickWeightedSymbol(c));
    }
    grid.push(row);
  }
  return grid;
}

function pickWeightedSymbol(columnIndex) {
  const reel = REEL_WEIGHTS[columnIndex] || REEL_WEIGHTS[REEL_WEIGHTS.length - 1];
  const totalWeight = reel.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * totalWeight;

  for (const [symbol, weight] of reel) {
    roll -= weight;
    if (roll < 0) return symbol;
  }

  return reel[reel.length - 1][0];
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

  const bellIndex = cells.indexOf(BELL);
  const bellIsOnEdge = bellIndex === 0 || bellIndex === cells.length - 1;
  const matchingPairIsAdjacent = cells[0] === cells[1] || cells[1] === cells[2];

  if (nonBellSymbols.length === 2
    && uniqueNonBellSymbols.length === 1
    && bellIsOnEdge
    && matchingPairIsAdjacent) {
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
    '🔔 is a wild only on an outside reel with 2 matching non-bell symbols beside it.',
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
  REEL_WEIGHTS,
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
