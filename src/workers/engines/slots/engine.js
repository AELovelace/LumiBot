'use strict';

/**
 * Pure slots logic — grid generation, win evaluation, render helpers.
 * No Discord, no DB.
 */

const SYMBOLS = ['🍒', '🍋', '🔔', '💎', '7️⃣', '⭐'];
const GRID_ROWS = 3;
const GRID_COLS = 3;

const WINNING_HANDS = [
  { symbols: ['💎', '💎', '⭐'], name: 'Diamond Star' },
  { symbols: ['7️⃣', '7️⃣', '💎'], name: 'Lucky Sevens' },
  { symbols: ['🍒', '🍒', '🔔'], name: 'Cherry Bells' },
];

const DEFAULTS = {
  spinFrames: 6,
  spinFrameMs: 400,
  defaultBet: 1,
  maxPlayers: 3,
  horizontalMultiplier: 4,
  diagonalMultiplier: 3,
  handMultiplier: 2,
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

function matchesHand(cells, hand) {
  const sorted = [...cells].sort();
  const handSorted = [...hand.symbols].sort();
  return sorted[0] === handSorted[0] && sorted[1] === handSorted[1] && sorted[2] === handSorted[2];
}

function evaluateGrid(grid, settings) {
  const wins = [];
  let totalMultiplier = 0;
  const matchedRows = new Set();

  for (let r = 0; r < GRID_ROWS; r++) {
    if (grid[r][0] === grid[r][1] && grid[r][1] === grid[r][2]) {
      wins.push(`Row ${r + 1} — ${grid[r][0]}${grid[r][1]}${grid[r][2]} (${settings.horizontalMultiplier}×)`);
      totalMultiplier += settings.horizontalMultiplier;
      matchedRows.add(r);
    }
  }

  if (grid[0][0] === grid[1][1] && grid[1][1] === grid[2][2]) {
    wins.push(`Diagonal ↘ — ${grid[0][0]}${grid[1][1]}${grid[2][2]} (${settings.diagonalMultiplier}×)`);
    totalMultiplier += settings.diagonalMultiplier;
  }
  if (grid[0][2] === grid[1][1] && grid[1][1] === grid[2][0]) {
    wins.push(`Diagonal ↙ — ${grid[0][2]}${grid[1][1]}${grid[2][0]} (${settings.diagonalMultiplier}×)`);
    totalMultiplier += settings.diagonalMultiplier;
  }

  for (let r = 0; r < GRID_ROWS; r++) {
    if (matchedRows.has(r)) continue;
    const cells = [grid[r][0], grid[r][1], grid[r][2]];
    for (const hand of WINNING_HANDS) {
      if (matchesHand(cells, hand)) {
        wins.push(`Row ${r + 1} — ${cells.join('')} ${hand.name} (${settings.handMultiplier}×)`);
        totalMultiplier += settings.handMultiplier;
        break;
      }
    }
  }

  return { totalMultiplier, wins };
}

function createPlayer(userId, username, settings) {
  return {
    userId,
    username,
    bet: settings.defaultBet,
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
  SYMBOLS,
  GRID_ROWS,
  GRID_COLS,
  WINNING_HANDS,
  DEFAULTS,
  randomGrid,
  placeholderGrid,
  renderCompactGrid,
  evaluateGrid,
  createPlayer,
  makeLobby,
};
