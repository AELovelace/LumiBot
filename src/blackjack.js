/**
 * Blackjack — multiplayer blackjack at the Momiji Casino.
 *
 * /lumi-blackjack play <bet>   Join (or start) a table and place a bet.
 * /lumi-blackjack leave        Leave the table (forfeits active bet).
 * /lumi-blackjack bet <amount> Change your bet for the next hand.
 *
 * Up to 3 players per table (per channel). All draw from the same shoe
 * of 2 standard decks, reshuffled every 5 hands — card counting is viable.
 *
 * The table stays open between hands and auto-deals. Use the ❌ Leave
 * button or /lumi-blackjack leave to step away.
 *
 * Payouts:
 *   Blackjack (natural 21) → 2.5× return
 *   Win                    → 2× return
 *   Push                   → 1× return (bet returned)
 *   Lose / Bust            → 0×
 *
 * Dealer stands on 17+.
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

// ---------------------------------------------------------------------------
// Card constants (configurable via panel settings)
// ---------------------------------------------------------------------------

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
let NUM_DECKS = 2;
let HANDS_BEFORE_SHUFFLE = 5;
const MIN_CARDS_BEFORE_SHUFFLE = 15;
let MAX_PLAYERS = 3;
let IDLE_TIMEOUT_MS = 60_000;       // 60s no clicks → auto-stand
let BETWEEN_HANDS_MS = 6_000;       // pause between hands

// ---------------------------------------------------------------------------
// Shoe management — per-channel, persists across hands for counting
// ---------------------------------------------------------------------------

/** @type {Map<string, { cards: object[], handsPlayed: number }>} */
const shoes = new Map();

function createShoe() {
  const cards = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit });
      }
    }
  }
  // Fisher-Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function getShoe(channelId) {
  let shoe = shoes.get(channelId);
  if (!shoe || shoe.handsPlayed >= HANDS_BEFORE_SHUFFLE || shoe.cards.length < MIN_CARDS_BEFORE_SHUFFLE) {
    shoe = { cards: createShoe(), handsPlayed: 0 };
    shoes.set(channelId, shoe);
  }
  return shoe;
}

function drawCard(channelId) {
  const shoe = getShoe(channelId);
  if (shoe.cards.length === 0) {
    shoe.cards = createShoe();
    shoe.handsPlayed = 0;
    logger.warn(`Blackjack: emergency reshuffle in channel ${channelId}`);
  }
  return shoe.cards.pop();
}

// ---------------------------------------------------------------------------
// Hand utilities
// ---------------------------------------------------------------------------

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

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
    case 'playing':   return 'Hit or Stay?';
    case 'standing':  return 'Standing';
    case 'bust':      return 'BUST';
    case 'blackjack': return 'Blackjack!';
    default:          return '';
  }
}

function renderTable(table, hideDealer = true) {
  const dVal = hideDealer ? '?' : handValue(table.dealerHand);
  const lines = [
    `Dealer (${dVal})`,
    renderHand(table.dealerHand, hideDealer),
  ];

  for (const player of table.players.values()) {
    const val = handValue(player.hand);
    const status = playerStatusText(player);
    lines.push('');
    lines.push(`${player.username} (${val}) [${player.bet} SGC] ${status}`);
    lines.push(renderHand(player.hand));
  }

  return lines.join('\n');
}

function buildButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bj_hit')
      .setLabel('Hit')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('bj_stay')
      .setLabel('Stay')
      .setEmoji('🛑')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('bj_leave')
      .setLabel('Leave')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ---------------------------------------------------------------------------
// Table state — one table per channel
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, {
 *   channelId: string,
 *   dealerHand: object[],
 *   players: Map<string, object>,
 *   gameMessage: object,
 *   collector: object,
 *   resolving: boolean,
 *   nextHandTimer: object,
 * }>}
 */
const tables = new Map();

function hasActivePlayers(table) {
  return [...table.players.values()].some((p) => p.status === 'playing');
}

function allPlayersDone(table) {
  if (table.players.size === 0) return false;
  return [...table.players.values()]
    .every((p) => ['standing', 'bust', 'blackjack'].includes(p.status));
}

// ---------------------------------------------------------------------------
// Deal a new hand to all remaining players (called after between-hands pause)
// ---------------------------------------------------------------------------

async function dealNewHand(table) {
  const kicked = [];

  for (const [userId, player] of table.players) {
    const bet = player.nextBet ?? player.bet;

    ensureAccount(userId, player.username);
    const balance = getBalance(userId);
    if (balance < bet) {
      kicked.push(player.username);
      table.players.delete(userId);
      continue;
    }

    const result = placeCasinoBet(userId, player.username, bet, 'blackjack');
    if (!result.success) {
      kicked.push(player.username);
      table.players.delete(userId);
      continue;
    }

    // Reset hand state for the new round
    player.hand = [drawCard(table.channelId), drawCard(table.channelId)];
    player.bet = bet;
    player.status = isNaturalBlackjack(player.hand) ? 'blackjack' : 'playing';
    player.result = null;
  }

  // No players left → tear down
  if (table.players.size === 0) {
    tables.delete(table.channelId);
    const reason = kicked.length
      ? `(${kicked.join(', ')} couldn't cover bet)`
      : '(no players)';
    try {
      await table.gameMessage.edit({
        content: `🃏 **Blackjack Table — Closed** ${reason}`,
        components: [buildButtons(true)],
      });
    } catch { /* ignore */ }
    return;
  }

  // New dealer hand
  table.dealerHand = [drawCard(table.channelId), drawCard(table.channelId)];
  table.resolving = false;

  let header = '🃏 **Blackjack Table** — New hand dealt!';
  if (kicked.length) {
    header += `\n*${kicked.join(', ')} removed (insufficient balance)*`;
  }

  const content = `${header}\n\`\`\`\n${renderTable(table, true)}\n\`\`\``;
  try {
    await table.gameMessage.edit({
      content,
      components: [buildButtons(!hasActivePlayers(table))],
    });
  } catch (err) {
    logger.error('Blackjack: failed to update for new hand', err.message);
  }

  setupCollector(table);

  // If every player immediately has blackjack, resolve right away
  if (allPlayersDone(table)) {
    await resolveTable(table);
  }
}

// ---------------------------------------------------------------------------
// Table resolution — dealer plays, payouts, then schedule next hand
// ---------------------------------------------------------------------------

async function resolveTable(table) {
  if (table.resolving) return;
  table.resolving = true;

  // Dealer plays
  while (handValue(table.dealerHand) < 17) {
    table.dealerHand.push(drawCard(table.channelId));
  }

  const dVal = handValue(table.dealerHand);
  const dealerBJ = isNaturalBlackjack(table.dealerHand);

  // Calculate payouts per player
  for (const player of table.players.values()) {
    const pVal = handValue(player.hand);
    let payout = 0;

    if (player.status === 'bust') {
      player.result = `BUST — lost ${player.bet} SGC`;
    } else if (player.status === 'blackjack') {
      if (dealerBJ) {
        payout = player.bet;
        player.result = 'BJ Push — bet returned';
      } else {
        payout = Math.floor(player.bet * 2.5);
        player.result = `BLACKJACK! +${payout.toLocaleString()} SGC`;
      }
    } else if (dVal > 21) {
      payout = player.bet * 2;
      player.result = `WIN (dealer bust) +${payout.toLocaleString()} SGC`;
    } else if (pVal > dVal) {
      payout = player.bet * 2;
      player.result = `WIN +${payout.toLocaleString()} SGC`;
    } else if (pVal === dVal) {
      payout = player.bet;
      player.result = 'Push — bet returned';
    } else {
      player.result = `LOSE — lost ${player.bet} SGC`;
    }

    if (payout > 0) payCasinoPayout(player.userId, payout, 'blackjack');
    logger.info(`Blackjack: ${player.username} bet=${player.bet} hand=${pVal} dealer=${dVal} payout=${payout}`);
  }

  getShoe(table.channelId).handsPlayed += 1;

  // Show results, then auto-deal after a pause
  const content = `🃏 **Blackjack — Results** *(next hand in ${BETWEEN_HANDS_MS / 1000}s…)*\n\`\`\`\n${renderTable(table, false)}\n\`\`\``;
  try {
    if (table.collector) table.collector.stop('resolved');
    await table.gameMessage.edit({ content, components: [buildButtons(true)] });
  } catch (err) {
    logger.error('Blackjack: failed to update final message', err.message);
  }

  // Schedule next hand
  table.nextHandTimer = setTimeout(() => dealNewHand(table), BETWEEN_HANDS_MS);
}

/** Update the live game message (called after join, hit, stay, leave). */
async function updateTableMessage(table) {
  const anyPlaying = hasActivePlayers(table);
  const content = `🃏 **Blackjack Table**\n\`\`\`\n${renderTable(table, true)}\n\`\`\``;
  try {
    await table.gameMessage.edit({ content, components: [buildButtons(!anyPlaying)] });
  } catch (err) {
    logger.error('Blackjack: failed to update message', err.message);
  }
}

// ---------------------------------------------------------------------------
// Button collector
// ---------------------------------------------------------------------------

function setupCollector(table) {
  const collector = table.gameMessage.createMessageComponentCollector({
    filter: (i) => ['bj_hit', 'bj_stay', 'bj_leave'].includes(i.customId),
    idle: IDLE_TIMEOUT_MS,
  });
  table.collector = collector;

  collector.on('collect', async (btn) => {
    // ── Leave button ──
    if (btn.customId === 'bj_leave') {
      const player = table.players.get(btn.user.id);
      if (!player) {
        await btn.reply({ content: "You're not at this table.", ephemeral: true }).catch(() => {});
        return;
      }

      const lostBet = player.bet;
      table.players.delete(btn.user.id);

      await btn.reply({
        content: `You left the table. Your bet of **${lostBet.toLocaleString()} SGC** is forfeited.`,
        ephemeral: true,
      }).catch(() => {});

      if (table.players.size === 0) {
        collector.stop('allLeft');
        if (table.nextHandTimer) clearTimeout(table.nextHandTimer);
        tables.delete(table.channelId);
        try {
          await table.gameMessage.edit({
            content: '🃏 **Blackjack Table — Everyone left.**',
            components: [buildButtons(true)],
          });
        } catch { /* ignore */ }
        return;
      }

      if (allPlayersDone(table)) {
        await resolveTable(table);
      } else {
        await updateTableMessage(table);
      }
      return;
    }

    // ── Hit / Stay ──
    const player = table.players.get(btn.user.id);
    if (!player || player.status !== 'playing') {
      await btn.reply({ content: "You're not playing at this table or your hand is already done.", ephemeral: true }).catch(() => {});
      return;
    }

    if (table.resolving) {
      await btn.deferUpdate().catch(() => {});
      return;
    }

    try {
      if (btn.customId === 'bj_hit') {
        player.hand.push(drawCard(table.channelId));
        const val = handValue(player.hand);
        if (val > 21) {
          player.status = 'bust';
        } else if (val === 21) {
          player.status = 'standing'; // auto-stand on 21
        }
      } else {
        player.status = 'standing';
      }

      if (allPlayersDone(table)) {
        await btn.deferUpdate().catch(() => {});
        await resolveTable(table);
      } else {
        const anyPlaying = hasActivePlayers(table);
        const content = `🃏 **Blackjack Table**\n\`\`\`\n${renderTable(table, true)}\n\`\`\``;
        await btn.update({ content, components: [buildButtons(!anyPlaying)] });
      }
    } catch (err) {
      logger.error('Blackjack button error:', err.message);
      await btn.deferUpdate().catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'resolved') return;

    // Idle timeout — auto-stand all remaining players and resolve
    if (tables.has(table.channelId) && !table.resolving) {
      for (const player of table.players.values()) {
        if (player.status === 'playing') player.status = 'standing';
      }
      await resolveTable(table);
    }
  });
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

function buildBlackjackCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-blackjack')
    .setDescription('Play multiplayer blackjack at the Momiji Casino!')
    .addSubcommand((sub) => sub
      .setName('play')
      .setDescription('Join the blackjack table and place a bet.')
      .addIntegerOption((opt) => opt
        .setName('bet')
        .setDescription('Amount of SGC to wager')
        .setMinValue(1)
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('leave')
      .setDescription('Leave the blackjack table (forfeits active bet).'))
    .addSubcommand((sub) => sub
      .setName('bet')
      .setDescription('Change your bet for the next hand.')
      .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('New bet amount in SGC')
        .setMinValue(1)
        .setRequired(true)))
    .toJSON();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleBlackjackCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'play') return handlePlay(interaction);
  if (sub === 'leave') return handleLeave(interaction);
  if (sub === 'bet') return handleBet(interaction);
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

async function handlePlay(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const bet = interaction.options.getInteger('bet', true);
  const channelId = interaction.channelId;

  let table = tables.get(channelId);

  // Between-hands pause — can't join yet
  if (table && table.resolving) {
    await interaction.reply({ content: '🃏 The hand just ended — a new one is being dealt shortly!', ephemeral: true });
    return;
  }

  if (table && table.players.has(userId)) {
    await interaction.reply({ content: "You're already playing at this table!", ephemeral: true });
    return;
  }

  if (table && table.players.size >= MAX_PLAYERS) {
    await interaction.reply({ content: `The table is full (${MAX_PLAYERS} players max).`, ephemeral: true });
    return;
  }

  // Validate & deduct bet
  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < bet) {
    await interaction.reply({ content: `❌ You only have **${balance.toLocaleString()} SGC** but tried to bet **${bet.toLocaleString()}**.`, ephemeral: true });
    return;
  }

  const betResult = placeCasinoBet(userId, username, bet, 'blackjack');
  if (!betResult.success) {
    await interaction.reply({ content: `❌ ${betResult.error}`, ephemeral: true });
    return;
  }

  // Deal the player's cards
  const hand = [drawCard(channelId), drawCard(channelId)];
  const playerState = {
    userId,
    username,
    hand,
    bet,
    nextBet: bet,   // remembered for auto-deal next round
    status: isNaturalBlackjack(hand) ? 'blackjack' : 'playing',
    result: null,
  };

  if (!table) {
    // ── Create a new table ──
    const dealerHand = [drawCard(channelId), drawCard(channelId)];
    table = {
      channelId,
      dealerHand,
      players: new Map(),
      gameMessage: null,
      collector: null,
      resolving: false,
      nextHandTimer: null,
    };
    table.players.set(userId, playerState);
    tables.set(channelId, table);

    const anyPlaying = hasActivePlayers(table);
    const content = `🃏 **Blackjack Table**\n\`\`\`\n${renderTable(table, true)}\n\`\`\``;
    await interaction.reply({ content, components: [buildButtons(!anyPlaying)] });
    table.gameMessage = await interaction.fetchReply();

    setupCollector(table);
  } else {
    // ── Join an existing table ──
    table.players.set(userId, playerState);

    await interaction.reply({
      content: `You joined the table! Bet: **${bet.toLocaleString()} SGC**`,
      ephemeral: true,
    });

    await updateTableMessage(table);

    // Reset idle timer so new players get full time
    if (table.collector) {
      table.collector.resetTimer({ idle: IDLE_TIMEOUT_MS });
    }
  }

  // If all players done immediately (all natural BJs), resolve
  if (allPlayersDone(table)) {
    await resolveTable(table);
  }
}

async function handleLeave(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const table = tables.get(channelId);

  if (!table || !table.players.has(userId)) {
    await interaction.reply({ content: "You're not at a blackjack table in this channel.", ephemeral: true });
    return;
  }

  const player = table.players.get(userId);
  const duringHand = !table.resolving;   // resolving=true means between hands
  const lostBet = player.bet;

  table.players.delete(userId);

  if (duringHand) {
    await interaction.reply({
      content: `You left the blackjack table. Your bet of **${lostBet.toLocaleString()} SGC** is forfeited.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: 'You left the blackjack table.',
      ephemeral: true,
    });
  }

  // If no players left, tear down
  if (table.players.size === 0) {
    if (table.collector) table.collector.stop('allLeft');
    if (table.nextHandTimer) clearTimeout(table.nextHandTimer);
    tables.delete(channelId);
    try {
      await table.gameMessage.edit({
        content: '🃏 **Blackjack Table — Everyone left.**',
        components: [buildButtons(true)],
      });
    } catch { /* ignore */ }
    return;
  }

  // If all remaining players done, resolve
  if (!table.resolving && allPlayersDone(table)) {
    await resolveTable(table);
  } else if (!table.resolving) {
    await updateTableMessage(table);
  }
}

async function handleBet(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const newBet = interaction.options.getInteger('amount', true);
  const table = tables.get(channelId);

  if (!table || !table.players.has(userId)) {
    await interaction.reply({
      content: "You're not at a blackjack table in this channel. Use `/lumi-blackjack play` to join first.",
      ephemeral: true,
    });
    return;
  }

  const player = table.players.get(userId);
  player.nextBet = newBet;

  await interaction.reply({
    content: `Your bet for the next hand has been set to **${newBet.toLocaleString()} SGC**.`,
    ephemeral: true,
  });
}

function reloadSettings() {
  try {
    NUM_DECKS = getSetting('blackjack.numDecks');
    HANDS_BEFORE_SHUFFLE = getSetting('blackjack.handsBeforeShuffle');
    MAX_PLAYERS = getSetting('blackjack.maxPlayers');
    IDLE_TIMEOUT_MS = getSetting('blackjack.idleTimeoutMs');
    BETWEEN_HANDS_MS = getSetting('blackjack.betweenHandsMs');
  } catch { /* DB not ready */ }
}

module.exports = { buildBlackjackCommand, handleBlackjackCommand, reloadSettings };
