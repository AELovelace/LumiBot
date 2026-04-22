'use strict';

/**
 * Pure horseracing logic — track render, win-stats math, betting content.
 * No Discord, no DB.
 */

const HORSES = ['A', 'B', 'C', 'D'];
const HORSE_EMOJI = '🐎';

const DEFAULTS = {
  trackWidth: 50,
  raceTickMs: 600,
  bettingWindowMs: 30_000,
  defaultBet: 5,
};

const WIN_STATS_KEY = 'horse_race_wins';

function emptyWinStats() {
  return { A: 0, B: 0, C: 0, D: 0 };
}

function statsLine(winStats) {
  return HORSES.map((h) => `${h}: ${winStats[h]}W`).join('  |  ');
}

function getUnderdog(winStats) {
  let min = Infinity;
  let dog = null;
  for (const h of HORSES) {
    if (winStats[h] < min) { min = winStats[h]; dog = h; }
  }
  const allSame = HORSES.every((h) => winStats[h] === min);
  return allSame ? null : dog;
}

function renderTrack(positions, trackWidth) {
  const border = `*${'-'.repeat(trackWidth + 4)}*`;
  const lines = [border];
  for (let i = 0; i < HORSES.length; i++) {
    const pos = Math.min(positions[i], trackWidth);
    const before = ' '.repeat(pos);
    const after = ' '.repeat(trackWidth - pos);
    lines.push(`|${HORSES[i]}${before}${HORSE_EMOJI}${after}  |`);
    if (i < HORSES.length - 1) {
      lines.push(`|${'-'.repeat(trackWidth + 4)}|`);
    }
  }
  lines.push(border);
  return lines.join('\n');
}

function tickPositions(positions, trackWidth) {
  let finished = false;
  let winner = null;
  for (let i = 0; i < HORSES.length; i++) {
    positions[i] += Math.floor(Math.random() * 5);
    if (positions[i] >= trackWidth) {
      positions[i] = trackWidth;
      if (!winner) winner = HORSES[i];
      finished = true;
    }
  }
  return { finished, winner };
}

function createPlayer(userId, username, defaultBet) {
  return { userId, username, horse: null, bet: defaultBet };
}

function makeLobby(channelId) {
  return {
    channelId,
    players: new Map(),
    phase: 'betting',
    raceNumber: 1,
  };
}

module.exports = {
  HORSES,
  HORSE_EMOJI,
  DEFAULTS,
  WIN_STATS_KEY,
  emptyWinStats,
  statsLine,
  getUnderdog,
  renderTrack,
  tickPositions,
  createPlayer,
  makeLobby,
};
