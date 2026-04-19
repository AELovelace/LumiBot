/**
 * Texas Hold'em -- simplified multiplayer Hold'em at the Momiji Casino.
 *
 * /lumi-holdem play <bet>    Join (or start) a table and set your ante.
 * /lumi-holdem leave         Leave the table. Leaving mid-hand forfeits your ante.
 * /lumi-holdem bet <amount>  Change your ante for the next hand.
 * /lumi-holdem raise <amount> Raise during a hand (custom amount).
 *
 * Design notes:
 * - Up to 6 players per table (per channel)
 * - Each hand uses ante + optional raises during betting rounds
 * - Players take turns to Check/Call, Raise, or Fold on each street
 * - Community cards reveal across pre-flop, flop, turn, river
 * - Best 5-card poker hand wins the pot at showdown
 * - Winners split the pot evenly; any remainder is given to the earliest winners
 *
 * This keeps the same "join / leave / bet" structure as blackjack while
 * still feeling like Texas Hold'em in Discord.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const {
  ensureAccount,
  getBalance,
  placeCasinoBet,
  payCasinoPayout,
} = require('./sadgirlEconomyStore');
const { getSetting } = require('./panelSettings');

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const VALUE_NAME = {
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
};

const VALUE_PLURAL = {
  2: 'Twos',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
};

const CPU_USER_ID = '__LUMI_HOLDEM_CPU__';
const CPU_USERNAME = 'Lumi CPU';
let MAX_PLAYERS = 6;
let ACTION_TIMEOUT_MS = 45_000;
let CPU_ACTION_DELAY_MS = 1_500;
let BETWEEN_HANDS_MS = 8_000;
const HAND_PHASES = new Set(['preflop', 'flop', 'turn', 'river']);

/** @type {Map<string, object>} */
const tables = new Map();

function createDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ rank, suit });
    }
  }

  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

function drawCard(table) {
  if (!table.deck || table.deck.length === 0) {
    table.deck = createDeck();
  }
  return table.deck.pop();
}

function formatCard(card) {
  return `[${card.rank}${card.suit}]`;
}

function formatCards(cards) {
  if (!cards || cards.length === 0) return '(none)';
  return cards.map(formatCard).join(' ');
}

function renderCommunityCards(cards) {
  const shown = [...cards];
  while (shown.length < 5) {
    shown.push(null);
  }
  return shown.map((card) => (card ? formatCard(card) : '[??]')).join(' ');
}

function isHandActive(table) {
  return HAND_PHASES.has(table.phase);
}

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

function isCpuPlayer(player) {
  return Boolean(player?.isCpu);
}

function getSeatedPlayers(table) {
  return [...table.players.values()];
}

function getHumanPlayers(table) {
  return getSeatedPlayers(table).filter((player) => !isCpuPlayer(player));
}

function getCpuPlayer(table) {
  return table.players.get(CPU_USER_ID) || null;
}

function getPlayersInHand(table) {
  return getSeatedPlayers(table).filter((player) => player.inHand);
}

function getActivePlayers(table) {
  return getPlayersInHand(table).filter((player) => player.status === 'active');
}

function findPendingActionPlayer(table) {
  if (!table.turnOrder || table.turnOrder.length === 0) return null;

  for (let offset = 0; offset < table.turnOrder.length; offset += 1) {
    const idx = (table.turnCursor + offset) % table.turnOrder.length;
    const candidate = table.players.get(table.turnOrder[idx]);
    if (candidate && candidate.inHand && candidate.status === 'active' && candidate.needsAction) {
      table.turnCursor = idx;
      return candidate;
    }
  }

  return null;
}

function clearTurnTimer(table) {
  if (table.turnTimer) {
    clearTimeout(table.turnTimer);
    table.turnTimer = null;
  }
}

function clearNextHandTimer(table) {
  if (table.nextHandTimer) {
    clearTimeout(table.nextHandTimer);
    table.nextHandTimer = null;
  }
}

function getCpuAnte(table) {
  const humans = getHumanPlayers(table);
  const anchor = humans[0];
  return Math.max(1, anchor ? (anchor.nextBet ?? anchor.bet) : 5);
}

function ensureCpuSeat(table) {
  if (getHumanPlayers(table).length !== 1) return;

  const ante = getCpuAnte(table);
  const cpu = getCpuPlayer(table);
  if (cpu) {
    cpu.bet = ante;
    cpu.nextBet = ante;
    return;
  }

  table.players.set(CPU_USER_ID, createPlayerState(CPU_USER_ID, CPU_USERNAME, ante, { isCpu: true }));
}

function removeCpuSeat(table) {
  const cpu = getCpuPlayer(table);
  if (cpu && !cpu.inHand) {
    table.players.delete(CPU_USER_ID);
  }
}

function syncCpuSeat(table) {
  const humanCount = getHumanPlayers(table).length;
  if (humanCount <= 0) {
    table.players.delete(CPU_USER_ID);
    return;
  }

  if (humanCount === 1) {
    ensureCpuSeat(table);
    return;
  }

  removeCpuSeat(table);
}

function formatPlayerRef(player) {
  if (!player) return 'Unknown';
  return isCpuPlayer(player) ? player.username : `<@${player.userId}>`;
}

function formatPlayerRefById(table, userId) {
  const player = table.players.get(userId);
  return formatPlayerRef(player);
}

function buildButtons(table, { closed = false } = {}) {
  const handOpen = isHandActive(table);
  const peekDisabled = closed || getPlayersInHand(table).length === 0;
  const actionDisabled = closed || !handOpen;
  const leaveDisabled = closed;
  const hasOutstandingBet = (table.currentRoundBet || 0) > 0;
  const checkLabel = hasOutstandingBet ? 'Call' : 'Check';

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('th_peek')
        .setLabel('Peek')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(peekDisabled),
      new ButtonBuilder()
        .setCustomId('th_check')
        .setLabel(checkLabel)
        .setStyle(ButtonStyle.Success)
        .setDisabled(actionDisabled),
      new ButtonBuilder()
        .setCustomId('th_fold')
        .setLabel('Fold')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(actionDisabled),
      new ButtonBuilder()
        .setCustomId('th_leave')
        .setLabel('Leave')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(leaveDisabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('th_raise_1')
        .setLabel('Raise 1')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(actionDisabled),
      new ButtonBuilder()
        .setCustomId('th_raise_2')
        .setLabel('Raise 2')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(actionDisabled),
      new ButtonBuilder()
        .setCustomId('th_raise_5')
        .setLabel('Raise 5')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(actionDisabled),
      new ButtonBuilder()
        .setCustomId('th_raise_10')
        .setLabel('Raise 10')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(actionDisabled),
    ),
  ];
}

function playerStatusText(player, table, revealAll = false) {
  if (!player.inHand) return 'Waiting for next hand';
  if (player.status === 'folded') return 'Folded';
  if (revealAll && player.bestHand?.label) return player.bestHand.label;
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

function buildTableContent(table, {
  header = null,
  revealAll = false,
  footer = null,
} = {}) {
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

  if (table.notice) {
    lines.push(table.notice);
  }

  lines.push('');
  lines.push('**Players:**');

  const players = getSeatedPlayers(table);
  if (players.length === 0) {
    lines.push('_No players at the table._');
  } else {
    for (const player of players) {
      lines.push(`- ${player.username} [ante ${player.bet} SGC] ${playerCardsText(player, revealAll)} - ${playerStatusText(player, table, revealAll)}`);
    }
  }

  if (footer) {
    lines.push('');
    lines.push(footer);
  }

  return lines.join('\n');
}

async function updateTableMessage(table, options = {}) {
  if (!table.gameMessage) return;
  try {
    await table.gameMessage.edit({
      content: buildTableContent(table, options),
      components: buildButtons(table),
    });
  } catch (error) {
    logger.error('Holdem: failed to update table message', error.message);
  }
}

async function closeTable(table, reason = 'Table closed.') {
  clearTurnTimer(table);
  clearNextHandTimer(table);

  if (table.collector) {
    table.collector.stop('closed');
  }

  tables.delete(table.channelId);

  if (!table.gameMessage) return;

  try {
    await table.gameMessage.edit({
      content: `**Texas Hold'em Table - Closed** ${reason}`,
      components: buildButtons(table, { closed: true }),
    });
  } catch { /* ignore */ }
}

function rankValues(cards) {
  return cards.map((card) => RANK_VALUE[card.rank]);
}

function straightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) {
    unique.push(1);
  }

  for (let i = 0; i <= unique.length - 5; i += 1) {
    let run = true;
    for (let j = 1; j < 5; j += 1) {
      if (unique[i + j] !== unique[i] - j) {
        run = false;
        break;
      }
    }
    if (run) {
      return unique[i] === 1 ? 5 : unique[i];
    }
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

function describeEvaluation(category, tiebreak) {
  switch (category) {
    case 8: return `${VALUE_NAME[tiebreak[0]]}-high Straight Flush`;
    case 7: return `Four of a Kind, ${VALUE_PLURAL[tiebreak[0]]}`;
    case 6: return `Full House, ${VALUE_PLURAL[tiebreak[0]]} over ${VALUE_PLURAL[tiebreak[1]]}`;
    case 5: return `${VALUE_NAME[tiebreak[0]]}-high Flush`;
    case 4: return `${VALUE_NAME[tiebreak[0]]}-high Straight`;
    case 3: return `Three of a Kind, ${VALUE_PLURAL[tiebreak[0]]}`;
    case 2: return `Two Pair, ${VALUE_PLURAL[tiebreak[0]]} and ${VALUE_PLURAL[tiebreak[1]]}`;
    case 1: return `Pair of ${VALUE_PLURAL[tiebreak[0]]}`;
    default: return `${VALUE_NAME[tiebreak[0]]}-high`;
  }
}

function evaluateFive(cards) {
  const values = rankValues(cards).sort((a, b) => b - a);
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const groups = [...counts.entries()]
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.value - a.value;
    });

  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(values);

  if (flush && straight) {
    return {
      category: 8,
      tiebreak: [straight],
      label: describeEvaluation(8, [straight]),
    };
  }

  if (groups[0].count === 4) {
    const kicker = groups.find((group) => group.count === 1).value;
    const tiebreak = [groups[0].value, kicker];
    return { category: 7, tiebreak, label: describeEvaluation(7, tiebreak) };
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    const tiebreak = [groups[0].value, groups[1].value];
    return { category: 6, tiebreak, label: describeEvaluation(6, tiebreak) };
  }

  if (flush) {
    const tiebreak = [...values];
    return { category: 5, tiebreak, label: describeEvaluation(5, tiebreak) };
  }

  if (straight) {
    const tiebreak = [straight];
    return { category: 4, tiebreak, label: describeEvaluation(4, tiebreak) };
  }

  if (groups[0].count === 3) {
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value).sort((a, b) => b - a);
    const tiebreak = [groups[0].value, ...kickers];
    return { category: 3, tiebreak, label: describeEvaluation(3, tiebreak) };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairValues = groups.filter((group) => group.count === 2).map((group) => group.value).sort((a, b) => b - a);
    const kicker = groups.find((group) => group.count === 1).value;
    const tiebreak = [pairValues[0], pairValues[1], kicker];
    return { category: 2, tiebreak, label: describeEvaluation(2, tiebreak) };
  }

  if (groups[0].count === 2) {
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value).sort((a, b) => b - a);
    const tiebreak = [groups[0].value, ...kickers];
    return { category: 1, tiebreak, label: describeEvaluation(1, tiebreak) };
  }

  const tiebreak = [...values];
  return { category: 0, tiebreak, label: describeEvaluation(0, tiebreak) };
}

function combinations(cards, pick, start = 0, prefix = [], out = []) {
  if (prefix.length === pick) {
    out.push(prefix);
    return out;
  }

  for (let i = start; i <= cards.length - (pick - prefix.length); i += 1) {
    combinations(cards, pick, i + 1, [...prefix, cards[i]], out);
  }

  return out;
}

function evaluateSeven(cards) {
  const combos = combinations(cards, 5);
  let best = null;

  for (const combo of combos) {
    const evaluation = evaluateFive(combo);
    if (!best || compareEvaluations(evaluation, best) > 0) {
      best = evaluation;
    }
  }

  return best;
}

function buildPeekLines(table, player) {
  const lines = [
    `Your cards: ${formatCards(player.holeCards)}`,
    `Board: ${renderCommunityCards(table.community)}`,
    `Pot: ${table.pot.toLocaleString()} SGC`,
  ];
  if ((table.currentRoundBet || 0) > 0) {
    const toCall = table.currentRoundBet - (player.roundBet || 0);
    if (toCall > 0) {
      lines.push(`To call: **${toCall.toLocaleString()} SGC**`);
    }
  }
  return lines;
}

function resetRoundState(table) {
  table.turnOrder = getActivePlayers(table).map((player) => player.userId);
  table.turnCursor = 0;
  table.currentPlayerId = null;
  table.currentRoundBet = 0;

  for (const player of getPlayersInHand(table)) {
    player.needsAction = player.status === 'active';
    player.roundBet = 0;
  }
}

async function scheduleTurn(table) {
  clearTurnTimer(table);

  const activePlayers = getActivePlayers(table);
  if (activePlayers.length <= 1) {
    if (activePlayers.length === 1) {
      await resolveLoneWinner(table, activePlayers[0], 'everyone else folded');
    }
    return;
  }

  const nextPlayer = findPendingActionPlayer(table);
  if (!nextPlayer) {
    await advancePhase(table);
    return;
  }

  table.currentPlayerId = nextPlayer.userId;
  await updateTableMessage(table);

  if (isCpuPlayer(nextPlayer)) {
    table.turnTimer = setTimeout(async () => {
      const cpu = table.players.get(CPU_USER_ID);
      if (!cpu || !cpu.inHand || cpu.status !== 'active' || !cpu.needsAction) {
        return;
      }

      const cpuCallAmount = Math.max(0, (table.currentRoundBet || 0) - (cpu.roundBet || 0));
      if (cpuCallAmount > 0) {
        cpu.roundBet += cpuCallAmount;
        table.pot += cpuCallAmount;
        table.notice = `*${cpu.username} called ${cpuCallAmount.toLocaleString()} SGC.*`;
        logger.info(`Holdem: CPU called ${cpuCallAmount} in channel ${table.channelId}`);
      } else {
        table.notice = `*${cpu.username} checked.*`;
        logger.info(`Holdem: CPU checked in channel ${table.channelId}`);
      }

      cpu.needsAction = false;
      table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
      await scheduleTurn(table);
    }, CPU_ACTION_DELAY_MS);
    table.turnTimer.unref?.();
    return;
  }

  table.turnTimer = setTimeout(async () => {
    const player = table.players.get(table.currentPlayerId);
    if (!player || !player.inHand || player.status !== 'active' || !player.needsAction) {
      return;
    }

    const timeoutCallAmount = Math.max(0, (table.currentRoundBet || 0) - (player.roundBet || 0));
    if (timeoutCallAmount > 0) {
      // Auto-fold if there's an outstanding bet (don't spend their money without consent)
      player.status = 'folded';
      player.needsAction = false;
      table.notice = `*${player.username} timed out and was auto-folded (outstanding bet of ${timeoutCallAmount.toLocaleString()} SGC).*`;
      logger.info(`Holdem: auto-fold for ${player.username} in channel ${table.channelId} (owed ${timeoutCallAmount})`);
    } else {
      player.needsAction = false;
      table.notice = `*${player.username} timed out and was auto-checked.*`;
      logger.info(`Holdem: auto-check for ${player.username} in channel ${table.channelId}`);
    }
    table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
    await scheduleTurn(table);
  }, ACTION_TIMEOUT_MS);
  table.turnTimer.unref?.();
}

async function startDecisionRound(table, phase) {
  table.phase = phase;
  table.notice = null;
  resetRoundState(table);
  await scheduleTurn(table);
}

async function prepareWaitingState(table, notice = null) {
  clearTurnTimer(table);
  clearNextHandTimer(table);
  table.phase = 'waiting';
  table.currentPlayerId = null;
  table.community = [];
  table.deck = [];
  table.pot = 0;
  table.currentRoundBet = 0;
  table.turnOrder = [];
  table.turnCursor = 0;
  table.notice = notice;

  for (const player of getSeatedPlayers(table)) {
    player.inHand = false;
    player.status = 'waiting';
    player.needsAction = false;
    player.holeCards = [];
    player.bestHand = null;
  }

  syncCpuSeat(table);
  if (getHumanPlayers(table).length === 0) {
    await closeTable(table, '(no human players)');
    return;
  }

  await updateTableMessage(table);
}

async function scheduleNextHand(table, notice = null, { keepCurrentMessage = false } = {}) {
  clearTurnTimer(table);
  clearNextHandTimer(table);

  if (getHumanPlayers(table).length === 0) {
    await closeTable(table, '(everyone left)');
    return;
  }

  syncCpuSeat(table);

  if (getSeatedPlayers(table).length < 2) {
    await prepareWaitingState(table, notice || '*Waiting for one more player...*');
    return;
  }

  table.phase = 'between';
  table.currentPlayerId = null;
  table.notice = notice || null;

  if (!keepCurrentMessage) {
    table.notice = notice || `*Next hand in ${BETWEEN_HANDS_MS / 1000}s...*`;
    await updateTableMessage(table);
  }

  table.nextHandTimer = setTimeout(() => {
    void startHand(table);
  }, BETWEEN_HANDS_MS);
  table.nextHandTimer.unref?.();
}

async function startHand(table) {
  clearTurnTimer(table);
  clearNextHandTimer(table);

  for (const player of getSeatedPlayers(table)) {
    player.inHand = false;
    player.status = 'waiting';
    player.needsAction = false;
    player.holeCards = [];
    player.bestHand = null;
  }

  syncCpuSeat(table);
  const seated = getSeatedPlayers(table);
  if (seated.length < 2) {
    await prepareWaitingState(table, '*Waiting for one more player...*');
    return;
  }

  const kickedNames = [];
  const kickedIds = [];
  const eligible = [];

  for (const player of seated) {
    const ante = player.nextBet ?? player.bet;
    if (isCpuPlayer(player)) {
      eligible.push({ player, ante });
      continue;
    }

    ensureAccount(player.userId, player.username);
    const balance = getBalance(player.userId);

    if (balance < ante) {
      kickedNames.push(player.username);
      kickedIds.push(player.userId);
      continue;
    }

    eligible.push({ player, ante });
  }

  if (kickedIds.length > 0) {
    for (const userId of kickedIds) {
      table.players.delete(userId);
    }
  }

  if (eligible.length < 2) {
    const notice = kickedNames.length
      ? `*${kickedNames.join(', ')} removed (insufficient balance). Waiting for more players...*`
      : '*Waiting for one more player...*';
    await prepareWaitingState(table, notice);
    return;
  }

  table.deck = createDeck();
  table.community = [];
  table.pot = 0;
  table.currentRoundBet = 0;
  table.notice = kickedNames.length ? `*${kickedNames.join(', ')} removed (insufficient balance).*` : null;

  for (const { player, ante } of eligible) {
    if (!isCpuPlayer(player)) {
      const result = placeCasinoBet(player.userId, player.username, ante, 'holdem');
      if (!result.success) {
        table.players.delete(player.userId);
        kickedNames.push(player.username);
        continue;
      }
    }

    player.bet = ante;
    player.nextBet = ante;
    player.inHand = true;
    player.status = 'active';
    player.needsAction = true;
    player.holeCards = [drawCard(table), drawCard(table)];
    player.bestHand = null;
    table.pot += ante;
  }

  if (getPlayersInHand(table).length < 2) {
    await prepareWaitingState(table, '*Not enough funded players to start a hand.*');
    return;
  }

  logger.info(`Holdem: new hand in channel ${table.channelId} with ${getPlayersInHand(table).length} player(s), pot ${table.pot}`);
  await startDecisionRound(table, 'preflop');
}

async function advancePhase(table) {
  clearTurnTimer(table);
  table.currentPlayerId = null;

  if (table.phase === 'preflop') {
    table.community.push(drawCard(table), drawCard(table), drawCard(table));
    table.notice = '*Flop dealt.*';
    await startDecisionRound(table, 'flop');
    return;
  }

  if (table.phase === 'flop') {
    table.community.push(drawCard(table));
    table.notice = '*Turn card dealt.*';
    await startDecisionRound(table, 'turn');
    return;
  }

  if (table.phase === 'turn') {
    table.community.push(drawCard(table));
    table.notice = '*River card dealt.*';
    await startDecisionRound(table, 'river');
    return;
  }

  if (table.phase === 'river') {
    await resolveShowdown(table);
  }
}

async function resolveLoneWinner(table, winner, reason = '') {
  clearTurnTimer(table);
  table.phase = 'showdown';
  table.currentPlayerId = null;

  const payout = table.pot;
  if (!isCpuPlayer(winner) && payout > 0) {
    payCasinoPayout(winner.userId, payout, 'holdem');
  }

  for (const player of getPlayersInHand(table)) {
    if (player.userId === winner.userId) {
      player.bestHand = { label: `Winner by default (+${payout.toLocaleString()} SGC)` };
    }
  }

  const footer = isCpuPlayer(winner)
    ? `**Winner:** ${winner.username} by ${reason || 'default'}\nHouse keeps the pot: **${payout.toLocaleString()} SGC**`
    : `**Winner:** ${formatPlayerRef(winner)} by ${reason || 'default'}\nPayout: **${payout.toLocaleString()} SGC**`;
  try {
    await table.gameMessage.edit({
      content: buildTableContent(table, {
        header: '**Texas Hold\'em - Hand Over**',
        revealAll: false,
        footer,
      }),
      components: buildButtons(table),
    });
  } catch (error) {
    logger.error('Holdem: failed to post lone-winner result', error.message);
  }

  logger.info(`Holdem: ${winner.username} won ${payout} SGC in channel ${table.channelId} (${reason || 'default'})`);
  await scheduleNextHand(table, null, { keepCurrentMessage: true });
}

async function resolveShowdown(table) {
  clearTurnTimer(table);
  table.phase = 'showdown';
  table.currentPlayerId = null;

  const contenders = getActivePlayers(table);
  if (contenders.length === 0) {
    await scheduleNextHand(table, '*No live hands remained. Starting over...*');
    return;
  }

  let bestEvaluation = null;
  let winners = [];

  for (const player of contenders) {
    player.bestHand = evaluateSeven([...player.holeCards, ...table.community]);
    if (!bestEvaluation || compareEvaluations(player.bestHand, bestEvaluation) > 0) {
      bestEvaluation = player.bestHand;
      winners = [player];
    } else if (compareEvaluations(player.bestHand, bestEvaluation) === 0) {
      winners.push(player);
    }
  }

  const baseShare = Math.floor(table.pot / winners.length);
  let remainder = table.pot % winners.length;
  const payoutLines = [];

  for (const winner of winners) {
    const payout = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    if (!isCpuPlayer(winner) && payout > 0) {
      payCasinoPayout(winner.userId, payout, 'holdem');
    }
    payoutLines.push(isCpuPlayer(winner)
      ? `${winner.username} keeps **${payout.toLocaleString()} SGC**`
      : `${formatPlayerRef(winner)} +**${payout.toLocaleString()} SGC**`);
  }

  for (const player of getPlayersInHand(table)) {
    if (!player.bestHand && player.status === 'folded') {
      player.bestHand = { label: 'Folded' };
    }
  }

  const footer = [
    `**Winning hand:** ${bestEvaluation?.label ?? 'Unknown'}`,
    `**Winner${winners.length === 1 ? '' : 's'}:** ${winners.map((winner) => formatPlayerRef(winner)).join(', ')}`,
    `**Payouts:** ${payoutLines.join(' | ')}`,
  ].join('\n');

  try {
    await table.gameMessage.edit({
      content: buildTableContent(table, {
        header: `**Texas Hold'em - Showdown** *(next hand in ${BETWEEN_HANDS_MS / 1000}s...)*`,
        revealAll: true,
        footer,
      }),
      components: buildButtons(table),
    });
  } catch (error) {
    logger.error('Holdem: failed to post showdown', error.message);
  }

  logger.info(`Holdem: showdown in channel ${table.channelId}, winners=${winners.map((winner) => winner.username).join(', ')}, pot=${table.pot}`);
  await scheduleNextHand(table, null, { keepCurrentMessage: true });
}

async function handlePeek(btn, table) {
  const player = table.players.get(btn.user.id);
  if (!player) {
    await btn.reply({ content: "You're not seated at this table.", ephemeral: true }).catch(() => {});
    return;
  }

  if (!player.inHand || player.holeCards.length !== 2) {
    await btn.reply({ content: 'You are seated, but not in the current hand. You will be dealt in next hand.', ephemeral: true }).catch(() => {});
    return;
  }

  await btn.reply({ content: buildPeekLines(table, player).join('\n'), ephemeral: true }).catch(() => {});
}

async function handleCheck(btn, table) {
  const player = table.players.get(btn.user.id);
  if (!player) {
    await btn.reply({ content: "You're not seated at this table.", ephemeral: true }).catch(() => {});
    return;
  }

  if (!isHandActive(table) || !player.inHand || player.status !== 'active') {
    await btn.reply({ content: "You're not active in this hand right now.", ephemeral: true }).catch(() => {});
    return;
  }

  if (table.currentPlayerId !== player.userId) {
    await btn.reply({ content: `It's ${formatPlayerRefById(table, table.currentPlayerId)}'s turn right now.`, ephemeral: true }).catch(() => {});
    return;
  }

  const callAmount = (table.currentRoundBet || 0) - (player.roundBet || 0);

  if (callAmount > 0) {
    ensureAccount(player.userId, player.username);
    const balance = getBalance(player.userId);
    if (balance < callAmount) {
      await btn.reply({ content: `You need **${callAmount.toLocaleString()} SGC** to call but only have **${balance.toLocaleString()} SGC**. Consider folding.`, ephemeral: true }).catch(() => {});
      return;
    }
    const result = placeCasinoBet(player.userId, player.username, callAmount, 'holdem');
    if (!result.success) {
      await btn.reply({ content: 'Call failed (insufficient funds). Consider folding.', ephemeral: true }).catch(() => {});
      return;
    }
    player.roundBet += callAmount;
    table.pot += callAmount;
    table.notice = `*${player.username} called ${callAmount.toLocaleString()} SGC.*`;
  } else {
    table.notice = `*${player.username} checked.*`;
  }

  player.needsAction = false;
  table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
  await btn.deferUpdate().catch(() => {});
  await scheduleTurn(table);
}

async function handleFold(btn, table) {
  const player = table.players.get(btn.user.id);
  if (!player) {
    await btn.reply({ content: "You're not seated at this table.", ephemeral: true }).catch(() => {});
    return;
  }

  if (!isHandActive(table) || !player.inHand || player.status !== 'active') {
    await btn.reply({ content: "You're not active in this hand right now.", ephemeral: true }).catch(() => {});
    return;
  }

  if (table.currentPlayerId !== player.userId) {
    await btn.reply({ content: `It's ${formatPlayerRefById(table, table.currentPlayerId)}'s turn right now.`, ephemeral: true }).catch(() => {});
    return;
  }

  player.status = 'folded';
  player.needsAction = false;
  table.notice = `*${player.username} folded.*`;
  table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
  await btn.deferUpdate().catch(() => {});
  await scheduleTurn(table);
}

async function handleRaise(btn, table, amount) {
  const player = table.players.get(btn.user.id);
  if (!player) {
    await btn.reply({ content: "You're not seated at this table.", ephemeral: true }).catch(() => {});
    return;
  }

  if (!isHandActive(table) || !player.inHand || player.status !== 'active') {
    await btn.reply({ content: "You're not active in this hand right now.", ephemeral: true }).catch(() => {});
    return;
  }

  if (table.currentPlayerId !== player.userId) {
    await btn.reply({ content: `It's ${formatPlayerRefById(table, table.currentPlayerId)}'s turn right now.`, ephemeral: true }).catch(() => {});
    return;
  }

  if (amount < 1) {
    await btn.reply({ content: 'Raise amount must be at least **1 SGC**.', ephemeral: true }).catch(() => {});
    return;
  }

  // Total the player must pay: call the current bet + the raise on top
  const callGap = Math.max(0, (table.currentRoundBet || 0) - (player.roundBet || 0));
  const totalCost = callGap + amount;

  ensureAccount(player.userId, player.username);
  const balance = getBalance(player.userId);
  if (balance < totalCost) {
    await btn.reply({ content: `You need **${totalCost.toLocaleString()} SGC** to raise (${callGap > 0 ? `${callGap.toLocaleString()} to call + ` : ''}${amount.toLocaleString()} raise) but only have **${balance.toLocaleString()} SGC**.`, ephemeral: true }).catch(() => {});
    return;
  }

  const result = placeCasinoBet(player.userId, player.username, totalCost, 'holdem');
  if (!result.success) {
    await btn.reply({ content: 'Raise failed (insufficient funds).', ephemeral: true }).catch(() => {});
    return;
  }

  player.roundBet += totalCost;
  table.pot += totalCost;
  table.currentRoundBet = player.roundBet;

  // All other active players who haven't matched the new bet need to act again
  for (const p of getActivePlayers(table)) {
    if (p.userId !== player.userId && p.roundBet < table.currentRoundBet) {
      p.needsAction = true;
    }
  }

  player.needsAction = false;
  table.notice = `*${player.username} raised ${amount.toLocaleString()} SGC${callGap > 0 ? ` (called ${callGap.toLocaleString()} + raised ${amount.toLocaleString()})` : ''} — bet is now ${table.currentRoundBet.toLocaleString()} SGC.*`;
  table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
  logger.info(`Holdem: ${player.username} raised ${amount} (total cost ${totalCost}) in channel ${table.channelId}, round bet now ${table.currentRoundBet}`);
  await btn.deferUpdate().catch(() => {});
  await scheduleTurn(table);
}

async function handleButtonLeave(btn, table) {
  const player = table.players.get(btn.user.id);
  if (!player) {
    await btn.reply({ content: "You're not seated at this table.", ephemeral: true }).catch(() => {});
    return;
  }

  const message = player.inHand && isHandActive(table)
    ? `You left the table. Your ante of **${player.bet.toLocaleString()} SGC** stays in the pot.`
    : 'You left the Texas Hold\'em table.';

  await removePlayerFromTable(table, player.userId, { publicReason: `${player.username} left the table.` });
  await btn.reply({ content: message, ephemeral: true }).catch(() => {});
}

function setupCollector(table) {
  const collector = table.gameMessage.createMessageComponentCollector({
    filter: (btn) => btn.customId === 'th_peek' || btn.customId === 'th_check' || btn.customId === 'th_fold' || btn.customId === 'th_leave' || btn.customId.startsWith('th_raise_'),
  });

  table.collector = collector;

  collector.on('collect', async (btn) => {
    try {
      if (btn.customId === 'th_peek') {
        await handlePeek(btn, table);
        return;
      }

      if (btn.customId === 'th_check') {
        await handleCheck(btn, table);
        return;
      }

      if (btn.customId === 'th_fold') {
        await handleFold(btn, table);
        return;
      }

      if (btn.customId.startsWith('th_raise_')) {
        const amount = parseInt(btn.customId.replace('th_raise_', ''), 10);
        if (amount > 0) {
          await handleRaise(btn, table, amount);
        }
        return;
      }

      if (btn.customId === 'th_leave') {
        await handleButtonLeave(btn, table);
      }
    } catch (error) {
      logger.error('Holdem button error:', error.message);
      await btn.deferUpdate().catch(() => {});
    }
  });

  collector.on('end', () => {
    clearTurnTimer(table);
    if (tables.has(table.channelId)) {
      tables.delete(table.channelId);
    }
  });
}

async function removePlayerFromTable(table, userId, { publicReason = null } = {}) {
  const player = table.players.get(userId);
  if (!player) return;

  const wasInHand = player.inHand;
  const wasCurrent = table.currentPlayerId === userId;
  table.players.delete(userId);

  if (getHumanPlayers(table).length === 0) {
    await closeTable(table, '(everyone left)');
    return;
  }

  if (!wasInHand) {
    syncCpuSeat(table);
    table.notice = publicReason ? `*${publicReason}*` : null;
    if (table.phase === 'waiting' && getSeatedPlayers(table).length >= 2) {
      await startHand(table);
      return;
    }
    await updateTableMessage(table);
    return;
  }

  if (getActivePlayers(table).length === 1) {
    await resolveLoneWinner(table, getActivePlayers(table)[0], 'everyone else folded');
    return;
  }

  if (wasCurrent && isHandActive(table)) {
    table.notice = publicReason ? `*${publicReason}*` : null;
    await scheduleTurn(table);
    return;
  }

  if (isHandActive(table)) {
    table.notice = publicReason ? `*${publicReason}*` : null;
    await scheduleTurn(table);
    return;
  }

  syncCpuSeat(table);
  table.notice = publicReason ? `*${publicReason}*` : null;
  await updateTableMessage(table);
}

function createPlayerState(userId, username, bet, { isCpu = false } = {}) {
  return {
    userId,
    username,
    isCpu,
    bet,
    nextBet: bet,
    inHand: false,
    status: 'waiting',
    needsAction: false,
    holeCards: [],
    bestHand: null,
    roundBet: 0,
  };
}

function buildHoldemCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-holdem')
    .setDescription('Play simplified Texas Hold\'em at the Momiji Casino!')
    .addSubcommand((sub) => sub
      .setName('play')
      .setDescription('Join the Hold\'em table and set your ante.')
      .addIntegerOption((opt) => opt
        .setName('bet')
        .setDescription('Ante amount in SGC')
        .setMinValue(1)
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('leave')
      .setDescription('Leave the Hold\'em table.'))
    .addSubcommand((sub) => sub
      .setName('bet')
      .setDescription('Change your ante for the next hand.')
      .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('New ante amount in SGC')
        .setMinValue(1)
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('raise')
      .setDescription('Raise the current bet during a hand.')
      .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('Amount to raise in SGC')
        .setMinValue(1)
        .setRequired(true)))
    .toJSON();
}

async function handleHoldemCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'play') return handlePlay(interaction);
  if (sub === 'leave') return handleLeave(interaction);
  if (sub === 'bet') return handleBet(interaction);
  if (sub === 'raise') return handleRaiseCommand(interaction);
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

async function handleRaiseCommand(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const amount = interaction.options.getInteger('amount', true);
  const table = tables.get(channelId);

  if (!table || !table.players.has(userId)) {
    await interaction.reply({ content: "You're not seated at a Hold'em table in this channel.", ephemeral: true });
    return;
  }

  const player = table.players.get(userId);

  if (!isHandActive(table) || !player.inHand || player.status !== 'active') {
    await interaction.reply({ content: "You're not active in a hand right now.", ephemeral: true });
    return;
  }

  if (table.currentPlayerId !== player.userId) {
    await interaction.reply({ content: `It's ${formatPlayerRefById(table, table.currentPlayerId)}'s turn right now.`, ephemeral: true });
    return;
  }

  if (amount < 1) {
    await interaction.reply({ content: 'Raise amount must be at least **1 SGC**.', ephemeral: true });
    return;
  }

  const callGap = Math.max(0, (table.currentRoundBet || 0) - (player.roundBet || 0));
  const totalCost = callGap + amount;

  ensureAccount(player.userId, player.username);
  const balance = getBalance(player.userId);
  if (balance < totalCost) {
    await interaction.reply({ content: `You need **${totalCost.toLocaleString()} SGC** to raise (${callGap > 0 ? `${callGap.toLocaleString()} to call + ` : ''}${amount.toLocaleString()} raise) but only have **${balance.toLocaleString()} SGC**.`, ephemeral: true });
    return;
  }

  const result = placeCasinoBet(player.userId, player.username, totalCost, 'holdem');
  if (!result.success) {
    await interaction.reply({ content: 'Raise failed (insufficient funds).', ephemeral: true });
    return;
  }

  player.roundBet += totalCost;
  table.pot += totalCost;
  table.currentRoundBet = player.roundBet;

  for (const p of getActivePlayers(table)) {
    if (p.userId !== player.userId && p.roundBet < table.currentRoundBet) {
      p.needsAction = true;
    }
  }

  player.needsAction = false;
  table.notice = `*${player.username} raised ${amount.toLocaleString()} SGC${callGap > 0 ? ` (called ${callGap.toLocaleString()} + raised ${amount.toLocaleString()})` : ''} — bet is now ${table.currentRoundBet.toLocaleString()} SGC.*`;
  table.turnCursor = (table.turnCursor + 1) % Math.max(table.turnOrder.length, 1);
  logger.info(`Holdem: ${player.username} raised ${amount} (total cost ${totalCost}) via command in channel ${table.channelId}, round bet now ${table.currentRoundBet}`);

  await interaction.reply({ content: `You raised **${amount.toLocaleString()} SGC**${callGap > 0 ? ` (+ ${callGap.toLocaleString()} to call)` : ''}. Bet is now **${table.currentRoundBet.toLocaleString()} SGC**.`, ephemeral: true });
  await scheduleTurn(table);
}

async function handlePlay(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const bet = interaction.options.getInteger('bet', true);
  const channelId = interaction.channelId;

  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < bet) {
    await interaction.reply({ content: `You only have **${balance.toLocaleString()} SGC** but tried to sit with **${bet.toLocaleString()} SGC**.`, ephemeral: true });
    return;
  }

  let table = tables.get(channelId);

  if (table && table.players.has(userId)) {
    await interaction.reply({ content: 'You are already seated at this Hold\'em table.', ephemeral: true });
    return;
  }

  if (table && getHumanPlayers(table).length >= MAX_PLAYERS) {
    await interaction.reply({ content: `The Hold'em table is full (${MAX_PLAYERS} players max).`, ephemeral: true });
    return;
  }

  if (!table) {
    table = {
      channelId,
      players: new Map(),
      gameMessage: null,
      collector: null,
      deck: [],
      community: [],
      pot: 0,
      phase: 'waiting',
      currentPlayerId: null,
      turnOrder: [],
      turnCursor: 0,
      turnTimer: null,
      nextHandTimer: null,
      currentRoundBet: 0,
      notice: '*Waiting for one human player. Lumi CPU will jump in if needed.*',
    };

    table.players.set(userId, createPlayerState(userId, username, bet));
    syncCpuSeat(table);
    tables.set(channelId, table);

    await interaction.reply({
      content: buildTableContent(table),
      components: buildButtons(table),
    });

    table.gameMessage = await interaction.fetchReply();
    setupCollector(table);
    await startHand(table);
    return;
  }

  table.players.set(userId, createPlayerState(userId, username, bet));
  syncCpuSeat(table);

  const replyText = isHandActive(table)
    ? `You joined the Hold'em table with an ante of **${bet.toLocaleString()} SGC**. You'll be dealt in next hand.`
    : `You joined the Hold'em table with an ante of **${bet.toLocaleString()} SGC**.`;

  await interaction.reply({ content: replyText, ephemeral: true });

  if (table.phase === 'waiting' && getSeatedPlayers(table).length >= 2) {
    await startHand(table);
    return;
  }

  await updateTableMessage(table);
}

async function handleLeave(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const table = tables.get(channelId);

  if (!table || !table.players.has(userId)) {
    await interaction.reply({ content: "You're not seated at a Hold'em table in this channel.", ephemeral: true });
    return;
  }

  const player = table.players.get(userId);
  const duringHand = player.inHand && isHandActive(table);

  await removePlayerFromTable(table, userId, { publicReason: `${player.username} left the table.` });

  await interaction.reply({
    content: duringHand
      ? `You left the Hold'em table. Your ante of **${player.bet.toLocaleString()} SGC** stays in the pot.`
      : 'You left the Hold\'em table.',
    ephemeral: true,
  });
}

async function handleBet(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const amount = interaction.options.getInteger('amount', true);
  const table = tables.get(channelId);

  if (!table || !table.players.has(userId)) {
    await interaction.reply({
      content: "You're not seated at a Hold'em table in this channel. Use `/lumi-holdem play` to join first.",
      ephemeral: true,
    });
    return;
  }

  const player = table.players.get(userId);
  player.nextBet = amount;
  if (!player.inHand) {
    player.bet = amount;
  }

  await interaction.reply({
    content: `Your ante for the next hand has been set to **${amount.toLocaleString()} SGC**.`,
    ephemeral: true,
  });

  if (!isHandActive(table)) {
    await updateTableMessage(table);
  }
}

function reloadSettings() {
  try {
    MAX_PLAYERS = getSetting('holdem.maxPlayers');
    ACTION_TIMEOUT_MS = getSetting('holdem.actionTimeoutMs');
    CPU_ACTION_DELAY_MS = getSetting('holdem.cpuActionDelayMs');
    BETWEEN_HANDS_MS = getSetting('holdem.betweenHandsMs');
  } catch { /* DB not ready */ }
}

module.exports = {
  buildHoldemCommand,
  handleHoldemCommand,
  reloadSettings,
};
