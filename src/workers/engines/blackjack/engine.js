'use strict';

/**
 * Pure Blackjack engine — extracted from src/blackjack.js.
 *
 * No Discord, no SQLite. All functions are deterministic given their
 * arguments (except where they intentionally call Math.random for shoe
 * shuffling and the dealer anti-sweep). State is kept in plain objects
 * so it round-trips across the worker channel safely.
 *
 * The associated worker entry (worker.js) wires these primitives to the
 * runtime helpers (commands, DB broker, events).
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const DEFAULTS = Object.freeze({
  numDecks: 6,
  handsBeforeShuffle: 12,
  minCardsBeforeShuffle: 30,
  maxPlayers: 3,
  idleTimeoutMs: 60_000,
  betweenHandsMs: 6_000,
  antiSweepBaseChance: 0.10,
  antiSweepStreakBonus: 0.10,
  antiSweepMaxChance: 0.55,
});

function createShoe(numDecks) {
  const cards = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit });
      }
    }
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function cardValue(card) {
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank, 10);
}

function handValue(hand) {
  let total = hand.reduce((sum, c) => sum + cardValue(c), 0);
  let aces = hand.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isNaturalBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function renderHand(cards, hideSecond = false) {
  const top = cards.map(() => '*----*').join(' ');
  const mid = cards.map((c, i) => {
    if (hideSecond && i === 1) return '| ?? |';
    const label = `${c.rank}${c.suit}`.padEnd(3);
    return `| ${label}|`;
  }).join(' ');
  const bot = cards.map(() => '*----*').join(' ');
  return `${top}\n${mid}\n${bot}`;
}

function playerStatusText(player) {
  if (player.result) return player.result;
  switch (player.status) {
    case 'playing':     return 'Hit or Stay?';
    case 'standing':    return 'Standing';
    case 'bust':        return 'BUST';
    case 'blackjack':   return 'Blackjack!';
    case 'surrendered': return 'Surrendered';
    default:            return '';
  }
}

function renderTableContent(table, hideDealer) {
  const dVal = hideDealer ? '?' : handValue(table.dealerHand);
  const lines = [
    `Dealer (${dVal})`,
    renderHand(table.dealerHand, hideDealer),
  ];
  for (const player of table.players.values()) {
    const val = handValue(player.hand);
    lines.push('');
    lines.push(`${player.username} (${val}) [${player.bet} SGC] ${playerStatusText(player)}`);
    lines.push(renderHand(player.hand));
  }
  return lines.join('\n');
}

function makeTable(channelId) {
  return {
    channelId,
    shoe: { cards: [], handsPlayed: 0 },
    dealerHand: [],
    players: new Map(),
    resolving: false,
    dealerSweepStreak: 0,
  };
}

function ensureShoe(table, settings) {
  if (
    table.shoe.cards.length === 0
    || table.shoe.handsPlayed >= settings.handsBeforeShuffle
    || table.shoe.cards.length < settings.minCardsBeforeShuffle
  ) {
    table.shoe.cards = createShoe(settings.numDecks);
    table.shoe.handsPlayed = 0;
  }
}

function drawCard(table, settings) {
  ensureShoe(table, settings);
  if (table.shoe.cards.length === 0) {
    table.shoe.cards = createShoe(settings.numDecks);
    table.shoe.handsPlayed = 0;
  }
  return table.shoe.cards.pop();
}

function canPlayerSurrender(player) {
  return player.status === 'playing' && player.hand.length === 2;
}

function hasActivePlayers(table) {
  for (const p of table.players.values()) {
    if (p.status === 'playing') return true;
  }
  return false;
}

function allPlayersDone(table) {
  if (table.players.size === 0) return false;
  for (const p of table.players.values()) {
    if (!['standing', 'bust', 'blackjack', 'surrendered'].includes(p.status)) {
      return false;
    }
  }
  return true;
}

function doesDealerBeatPlayer(player, dealerValue, dealerBlackjack) {
  if (player.status === 'surrendered' || player.status === 'bust') return true;
  const playerValue = handValue(player.hand);
  if (player.status === 'blackjack') return dealerBlackjack;
  if (dealerValue > 21) return false;
  if (playerValue > dealerValue) return false;
  if (playerValue === dealerValue) return false;
  return true;
}

function maybeApplyDealerAntiSweep(table, dealerValue, dealerBJ, settings, drawCardFn) {
  if (dealerValue > 21 || dealerBJ) {
    return { dealerValue, dealerBJ, nerf: false };
  }
  const players = [...table.players.values()];
  if (players.length === 0) {
    return { dealerValue, dealerBJ, nerf: false };
  }
  const sweeping = players.every((p) => doesDealerBeatPlayer(p, dealerValue, dealerBJ));
  if (!sweeping) {
    return { dealerValue, dealerBJ, nerf: false };
  }
  const streak = table.dealerSweepStreak ?? 0;
  const chance = Math.min(
    settings.antiSweepMaxChance,
    settings.antiSweepBaseChance + (streak * settings.antiSweepStreakBonus),
  );
  if (Math.random() >= chance) {
    return { dealerValue, dealerBJ, nerf: false };
  }
  table.dealerHand.push(drawCardFn());
  return {
    dealerValue: handValue(table.dealerHand),
    dealerBJ: isNaturalBlackjack(table.dealerHand),
    nerf: true,
  };
}

function dealerPlay(table, drawCardFn) {
  while (handValue(table.dealerHand) < 17) {
    table.dealerHand.push(drawCardFn());
  }
}

/**
 * Resolve the current hand: dealer plays, anti-sweep may apply, then
 * each player's result + payout intent is computed. Mutates `table` to
 * record per-player `result` strings and updated dealer-sweep streak.
 *
 * Returns:
 *   { payouts: [{ userId, amount }], dealerValue, dealerBlackjack }
 *
 * Payouts are intents only — the worker is responsible for issuing the
 * brokered DB calls to actually credit the user.
 */
function resolveHand(table, settings, drawCardFn) {
  dealerPlay(table, drawCardFn);
  let dVal = handValue(table.dealerHand);
  let dBJ = isNaturalBlackjack(table.dealerHand);

  const fairness = maybeApplyDealerAntiSweep(table, dVal, dBJ, settings, drawCardFn);
  dVal = fairness.dealerValue;
  dBJ = fairness.dealerBJ;

  const payouts = [];
  let dealerSwept = table.players.size > 0;
  let competitive = false;

  for (const player of table.players.values()) {
    const pVal = handValue(player.hand);
    let payout = 0;

    if (player.status === 'surrendered') {
      payout = Math.floor(player.bet / 2);
      player.result = `SURRENDER — recovered ${payout.toLocaleString()} SGC (half back)`;
    } else if (player.status === 'bust') {
      player.result = `BUST — lost ${player.bet} SGC`;
    } else if (player.status === 'blackjack') {
      competitive = true;
      if (dBJ) {
        payout = player.bet;
        player.result = 'BJ Push — bet returned';
      } else {
        payout = Math.floor(player.bet * 2.5);
        player.result = `BLACKJACK! +${payout.toLocaleString()} SGC`;
      }
    } else if (dVal > 21) {
      competitive = true;
      payout = player.bet * 2;
      player.result = `WIN (dealer bust) +${payout.toLocaleString()} SGC`;
    } else if (pVal > dVal) {
      competitive = true;
      payout = player.bet * 2;
      player.result = `WIN +${payout.toLocaleString()} SGC`;
    } else if (pVal === dVal) {
      competitive = true;
      payout = player.bet;
      player.result = 'Push — bet returned';
      dealerSwept = false;
    } else {
      competitive = true;
      player.result = `LOSE — lost ${player.bet} SGC`;
    }

    if (player.status === 'blackjack' && !dBJ) {
      dealerSwept = false;
    } else if (player.status !== 'bust' && player.status !== 'surrendered' && dVal > 21) {
      dealerSwept = false;
    } else if (player.status !== 'bust' && player.status !== 'surrendered' && pVal > dVal) {
      dealerSwept = false;
    }

    if (payout > 0) payouts.push({ userId: player.userId, amount: payout });
  }

  table.dealerSweepStreak = (dealerSwept && competitive) ? (table.dealerSweepStreak ?? 0) + 1 : 0;
  table.shoe.handsPlayed += 1;

  return { payouts, dealerValue: dVal, dealerBlackjack: dBJ };
}

module.exports = {
  SUITS,
  RANKS,
  DEFAULTS,
  createShoe,
  cardValue,
  handValue,
  isNaturalBlackjack,
  renderHand,
  playerStatusText,
  renderTableContent,
  makeTable,
  ensureShoe,
  drawCard,
  canPlayerSurrender,
  hasActivePlayers,
  allPlayersDone,
  doesDealerBeatPlayer,
  maybeApplyDealerAntiSweep,
  dealerPlay,
  resolveHand,
};
