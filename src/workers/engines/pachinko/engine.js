'use strict';

/**
 * Pure pachinko logic — drop simulation, rendering, payout calc.
 * No Discord, no DB.
 */

const DEFAULTS = {
  gridWidth: 10,
  gridRows: 9,
  rowDelayMs: 500,
};

const START_POSITIONS = [3, 4, 5, 6];

function simulateDrop(settings) {
  const path = [];
  let pos = START_POSITIONS[Math.floor(Math.random() * START_POSITIONS.length)];
  for (let row = 0; row < settings.gridRows; row++) {
    path.push(pos);
    const drift = Math.random() < 0.5 ? -1 : 1;
    pos = Math.max(0, Math.min(settings.gridWidth - 1, pos + drift));
  }
  return path;
}

function renderRow(ballPos, gridWidth) {
  const cells = Array(gridWidth).fill('.');
  cells[ballPos] = 'o';
  return `\`|${cells.join('')}|\``;
}

function renderPegNumbers(gridWidth) {
  const nums = Array.from({ length: gridWidth }, (_, i) => ((i + 1) % 10).toString());
  return `\`|${nums.join('')}|\``;
}

function getMultiplier(guessedPeg, landedPeg) {
  const dist = Math.abs(guessedPeg - landedPeg);
  if (dist === 0) return 2;
  if (dist === 1) return 1.5;
  if (dist === 2) return 1;
  return 0;
}

module.exports = {
  DEFAULTS,
  simulateDrop,
  renderRow,
  renderPegNumbers,
  getMultiplier,
};
