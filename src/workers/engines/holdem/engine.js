'use strict';

/**
 * Pure Texas Hold'em logic — deck, hand evaluation, table rendering.
 * No Discord, no DB, no timers.
 */

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = {
  2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 11, Q: 12, K: 13, A: 14,
};
const VALUE_NAME = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const VALUE_PLURAL = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights',
  9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces',
};

const CPU_USER_ID = '__LUMI_HOLDEM_CPU__';
const CPU_USERNAME = 'Lumi CPU';
const HAND_PHASES = new Set(['preflop', 'flop', 'turn', 'river']);

const DEFAULTS = {
  maxPlayers: 6,
  actionTimeoutMs: 45_000,
  cpuActionDelayMs: 1_500,
  betweenHandsMs: 8_000,
};

function createDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) cards.push({ rank, suit });
  }
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function drawCard(table) {
  if (!table.deck || table.deck.length === 0) table.deck = createDeck();
  return table.deck.pop();
}

function formatCard(card) { return `[${card.rank}${card.suit}]`; }
function formatCards(cards) { return !cards || cards.length === 0 ? '(none)' : cards.map(formatCard).join(' '); }

function renderCommunityCards(cards) {
  const shown = [...cards];
  while (shown.length < 5) shown.push(null);
  return shown.map((c) => (c ? formatCard(c) : '[??]')).join(' ');
}

function isHandActive(table) { return HAND_PHASES.has(table.phase); }
function isCpuPlayer(p) { return Boolean(p && p.isCpu); }

function phaseLabel(phase) {
  switch (phase) {
    case 'preflop': return 'Pre-Flop';
    case 'flop': return 'Flop';
    case 'turn': return 'Turn';
    case 'river': return 'River';
    case 'showdown': return 'Showdown';
    case 'between': return 'Between Hands';
    default: return 'Waiting';
  }
}

function getSeatedPlayers(t) { return [...t.players.values()]; }
function getHumanPlayers(t) { return getSeatedPlayers(t).filter((p) => !isCpuPlayer(p)); }
function getPlayersInHand(t) { return getSeatedPlayers(t).filter((p) => p.inHand); }
function getActivePlayers(t) { return getPlayersInHand(t).filter((p) => p.status === 'active'); }
function getCpuPlayer(t) { return t.players.get(CPU_USER_ID) || null; }

function findPendingActionPlayer(table) {
  if (!table.turnOrder || table.turnOrder.length === 0) return null;
  for (let off = 0; off < table.turnOrder.length; off += 1) {
    const idx = (table.turnCursor + off) % table.turnOrder.length;
    const c = table.players.get(table.turnOrder[idx]);
    if (c && c.inHand && c.status === 'active' && c.needsAction) {
      table.turnCursor = idx;
      return c;
    }
  }
  return null;
}

function rankValues(cards) { return cards.map((c) => RANK_VALUE[c.rank]); }

function straightHigh(values) {
  const u = [...new Set(values)].sort((a, b) => b - a);
  if (u.includes(14)) u.push(1);
  for (let i = 0; i <= u.length - 5; i += 1) {
    let run = true;
    for (let j = 1; j < 5; j += 1) {
      if (u[i + j] !== u[i] - j) { run = false; break; }
    }
    if (run) return u[i] === 1 ? 5 : u[i];
  }
  return null;
}

function compareEvaluations(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function describeEvaluation(category, tb) {
  switch (category) {
    case 8: return `${VALUE_NAME[tb[0]]}-high Straight Flush`;
    case 7: return `Four of a Kind, ${VALUE_PLURAL[tb[0]]}`;
    case 6: return `Full House, ${VALUE_PLURAL[tb[0]]} over ${VALUE_PLURAL[tb[1]]}`;
    case 5: return `${VALUE_NAME[tb[0]]}-high Flush`;
    case 4: return `${VALUE_NAME[tb[0]]}-high Straight`;
    case 3: return `Three of a Kind, ${VALUE_PLURAL[tb[0]]}`;
    case 2: return `Two Pair, ${VALUE_PLURAL[tb[0]]} and ${VALUE_PLURAL[tb[1]]}`;
    case 1: return `Pair of ${VALUE_PLURAL[tb[0]]}`;
    default: return `${VALUE_NAME[tb[0]]}-high`;
  }
}

function evaluateFive(cards) {
  const values = rankValues(cards).sort((a, b) => b - a);
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()]
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : b.value - a.value));
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straight = straightHigh(values);
  if (flush && straight) return { category: 8, tiebreak: [straight], label: describeEvaluation(8, [straight]) };
  if (groups[0].count === 4) {
    const k = groups.find((g) => g.count === 1).value;
    const tb = [groups[0].value, k];
    return { category: 7, tiebreak: tb, label: describeEvaluation(7, tb) };
  }
  if (groups[0].count === 3 && groups[1].count === 2) {
    const tb = [groups[0].value, groups[1].value];
    return { category: 6, tiebreak: tb, label: describeEvaluation(6, tb) };
  }
  if (flush) {
    const tb = [...values];
    return { category: 5, tiebreak: tb, label: describeEvaluation(5, tb) };
  }
  if (straight) {
    const tb = [straight];
    return { category: 4, tiebreak: tb, label: describeEvaluation(4, tb) };
  }
  if (groups[0].count === 3) {
    const ks = groups.filter((g) => g.count === 1).map((g) => g.value).sort((a, b) => b - a);
    const tb = [groups[0].value, ...ks];
    return { category: 3, tiebreak: tb, label: describeEvaluation(3, tb) };
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pv = groups.filter((g) => g.count === 2).map((g) => g.value).sort((a, b) => b - a);
    const k = groups.find((g) => g.count === 1).value;
    const tb = [pv[0], pv[1], k];
    return { category: 2, tiebreak: tb, label: describeEvaluation(2, tb) };
  }
  if (groups[0].count === 2) {
    const ks = groups.filter((g) => g.count === 1).map((g) => g.value).sort((a, b) => b - a);
    const tb = [groups[0].value, ...ks];
    return { category: 1, tiebreak: tb, label: describeEvaluation(1, tb) };
  }
  const tb = [...values];
  return { category: 0, tiebreak: tb, label: describeEvaluation(0, tb) };
}

function combinations(cards, pick, start = 0, prefix = [], out = []) {
  if (prefix.length === pick) { out.push(prefix); return out; }
  for (let i = start; i <= cards.length - (pick - prefix.length); i += 1) {
    combinations(cards, pick, i + 1, [...prefix, cards[i]], out);
  }
  return out;
}

function evaluateSeven(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const e = evaluateFive(combo);
    if (!best || compareEvaluations(e, best) > 0) best = e;
  }
  return best;
}

function formatPlayerRef(player) {
  if (!player) return 'Unknown';
  return isCpuPlayer(player) ? player.username : `<@${player.userId}>`;
}

function formatPlayerRefById(table, userId) {
  return formatPlayerRef(table.players.get(userId));
}

function playerStatusText(player, table, revealAll = false) {
  if (!player.inHand) return 'Waiting for next hand';
  if (player.status === 'folded') return 'Folded';
  if (revealAll && player.bestHand && player.bestHand.label) return player.bestHand.label;
  if (table.currentPlayerId === player.userId && isHandActive(table)) return 'Up now';
  if (player.needsAction && isHandActive(table)) return 'Thinking';
  return 'In hand';
}

function playerCardsText(player, revealAll = false) {
  if (!player.inHand) return '--';
  if (player.status === 'folded' && !revealAll) return '[folded hidden]';
  if (!revealAll) return '[hidden]';
  return formatCards(player.holeCards);
}

function buildTableContent(table, { header = null, revealAll = false, footer = null } = {}) {
  const lines = [
    header || `**Texas Hold'em Table** - ${phaseLabel(table.phase)}`,
    `Pot: **${table.pot.toLocaleString()} SGC**`,
    `Community: ${renderCommunityCards(table.community)}`,
  ];
  if (isHandActive(table) && (table.currentRoundBet || 0) > 0) {
    lines.push(`Current bet: **${table.currentRoundBet.toLocaleString()} SGC**`);
  }
  if (getPlayersInHand(table).length > 0 && !revealAll) {
    lines.push('Use `Peek` to view your cards privately.');
  }
  if (isHandActive(table) && table.currentPlayerId) {
    lines.push(`Turn: ${formatPlayerRefById(table, table.currentPlayerId)}`);
  } else if (table.phase === 'waiting') {
    lines.push('Need at least **1 human player** to start. Lumi CPU will jump in if needed.');
  }
  if (table.notice) lines.push(table.notice);
  lines.push('');
  lines.push('**Players:**');
  const players = getSeatedPlayers(table);
  if (players.length === 0) {
    lines.push('_No players at the table._');
  } else {
    for (const p of players) {
      lines.push(`- ${p.username} [ante ${p.bet} SGC] ${playerCardsText(p, revealAll)} - ${playerStatusText(p, table, revealAll)}`);
    }
  }
  if (footer) { lines.push(''); lines.push(footer); }
  return lines.join('\n');
}

function buttonState(table, { closed = false } = {}) {
  const handOpen = isHandActive(table);
  const peekDisabled = closed || getPlayersInHand(table).length === 0;
  const actionDisabled = closed || !handOpen;
  const hasOutstandingBet = (table.currentRoundBet || 0) > 0;
  return {
    closed,
    peekDisabled,
    actionDisabled,
    leaveDisabled: closed,
    checkLabel: hasOutstandingBet ? 'Call' : 'Check',
  };
}

function createPlayerState(userId, username, bet, { isCpu = false } = {}) {
  return {
    userId, username, isCpu, bet, nextBet: bet,
    inHand: false, status: 'waiting', needsAction: false,
    holeCards: [], bestHand: null, roundBet: 0,
  };
}

function makeTable(channelId) {
  return {
    channelId,
    players: new Map(),
    deck: [],
    community: [],
    pot: 0,
    phase: 'waiting',
    currentPlayerId: null,
    turnOrder: [],
    turnCursor: 0,
    currentRoundBet: 0,
    notice: '*Waiting for one human player. Lumi CPU will jump in if needed.*',
  };
}

module.exports = {
  SUITS, RANKS, RANK_VALUE, VALUE_NAME, VALUE_PLURAL,
  CPU_USER_ID, CPU_USERNAME, HAND_PHASES, DEFAULTS,
  createDeck, drawCard, formatCard, formatCards, renderCommunityCards,
  isHandActive, isCpuPlayer, phaseLabel,
  getSeatedPlayers, getHumanPlayers, getPlayersInHand, getActivePlayers, getCpuPlayer,
  findPendingActionPlayer,
  evaluateFive, evaluateSeven, compareEvaluations, describeEvaluation,
  formatPlayerRef, formatPlayerRefById, playerStatusText, playerCardsText,
  buildTableContent, buttonState, createPlayerState, makeTable,
};
