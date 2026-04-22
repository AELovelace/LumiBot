/**
 * Slots — multiplayer slot machine at the Momiji Casino.
 *
 * /lumi-slots start   Open (or join) a slot machine lobby in this channel.
 * /lumi-slots leave   Leave the lobby.
 *
 * Players use button controls:
 *   🎰 Spin   — Pull the lever (costs your current bet)
 *   1️⃣ 5️⃣ 🔟 — Set bet to 1 / 5 / 10 SGC
 *   ❌ Leave   — Walk away
 *
 * The machine has a 3×3 grid of symbols. After spinning:
 *   • Horizontal 3-of-a-kind on any row  → 4× bet per matching row
 *   • Diagonal 3-of-a-kind               → 3× bet per matching diagonal
 *   • Winning hand combo on any row       → 2× bet (💎💎⭐ · 7️⃣7️⃣💎 · 🍒🍒🔔)
 *   • Multiple wins stack!
 *
 * Payouts come from the Momiji Casino bank account.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { logger } = require('./logger');
const {
  ensureAccount,
  getBalance,
  placeCasinoBet,
  payCasinoPayout,
} = require('./sadgirlEconomyStore');
const { getSetting } = require('./panelSettings');

// ---------------------------------------------------------------------------
// Constants (configurable via panel settings)
// ---------------------------------------------------------------------------

const SYMBOLS = ['🍒', '🍋', '🔔', '💎', '7️⃣', '⭐'];
const GRID_ROWS = 3;
const GRID_COLS = 3;
let SPIN_FRAMES = 6;             // number of animation frames
let SPIN_FRAME_MS = 400;         // ms between frames
let DEFAULT_BET = 1;
let MAX_PLAYERS = 3;
let HORIZONTAL_MULTIPLIER = 4;   // 4× for a row 3-of-a-kind
let DIAGONAL_MULTIPLIER = 3;     // 3× for a diagonal 3-of-a-kind
let HAND_MULTIPLIER = 2;         // 2× for a winning hand combo

/** Winning hand combos — order doesn't matter, checked per row. */
const WINNING_HANDS = [
  { symbols: ['💎', '💎', '⭐'], name: 'Diamond Star' },
  { symbols: ['7️⃣', '7️⃣', '💎'], name: 'Lucky Sevens' },
  { symbols: ['🍒', '🍒', '🔔'], name: 'Cherry Bells' },
];

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

/** Generate a random 3×3 grid of symbols. */
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

function renderCompactGrid(grid) {
  return grid.map((row) => row.join(' ')).join('\n');
}

function createSlotPlayer(userId, username) {
  return {
    userId,
    username,
    bet: DEFAULT_BET,
    grid: randomGrid(),
    statusText: 'Ready',
    spinning: false,
  };
}

// ---------------------------------------------------------------------------
// Win detection
// ---------------------------------------------------------------------------

/**
 * Check if three cells match a hand combo (order-independent).
 */
function matchesHand(cells, hand) {
  const sorted = [...cells].sort();
  const handSorted = [...hand.symbols].sort();
  return sorted[0] === handSorted[0] && sorted[1] === handSorted[1] && sorted[2] === handSorted[2];
}

/**
 * Returns { totalMultiplier, wins[] } where each win describes what matched.
 *
 * Priority per line: 3-of-a-kind (4× row / 3× diag) beats hand combo (2×).
 * Multiple wins across different rows / diagonals stack.
 */
function evaluateGrid(grid) {
  const wins = [];
  let totalMultiplier = 0;
  const matchedRows = new Set();

  // ── Horizontal 3-of-a-kind (4×) ──
  for (let r = 0; r < GRID_ROWS; r++) {
    if (grid[r][0] === grid[r][1] && grid[r][1] === grid[r][2]) {
      wins.push(`Row ${r + 1} — ${grid[r][0]}${grid[r][1]}${grid[r][2]} (${HORIZONTAL_MULTIPLIER}×)`);
      totalMultiplier += HORIZONTAL_MULTIPLIER;
      matchedRows.add(r);
    }
  }

  // ── Diagonal 3-of-a-kind (3×) ──
  if (grid[0][0] === grid[1][1] && grid[1][1] === grid[2][2]) {
    wins.push(`Diagonal ↘ — ${grid[0][0]}${grid[1][1]}${grid[2][2]} (${DIAGONAL_MULTIPLIER}×)`);
    totalMultiplier += DIAGONAL_MULTIPLIER;
  }
  if (grid[0][2] === grid[1][1] && grid[1][1] === grid[2][0]) {
    wins.push(`Diagonal ↙ — ${grid[0][2]}${grid[1][1]}${grid[2][0]} (${DIAGONAL_MULTIPLIER}×)`);
    totalMultiplier += DIAGONAL_MULTIPLIER;
  }

  // ── Hand combos (2×) — rows not already matched as 3-of-a-kind ──
  for (let r = 0; r < GRID_ROWS; r++) {
    if (matchedRows.has(r)) continue;
    const cells = [grid[r][0], grid[r][1], grid[r][2]];
    for (const hand of WINNING_HANDS) {
      if (matchesHand(cells, hand)) {
        wins.push(`Row ${r + 1} — ${cells.join('')} ${hand.name} (${HAND_MULTIPLIER}×)`);
        totalMultiplier += HAND_MULTIPLIER;
        break; // one hand per row max
      }
    }
  }

  return { totalMultiplier, wins };
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function buildSlotButtons() {
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sl_spin').setLabel('Spin').setEmoji('🎰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sl_bet_1').setLabel('1 SGC').setEmoji('1️⃣').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sl_bet_5').setLabel('5 SGC').setEmoji('5️⃣').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sl_bet_10').setLabel('10 SGC').setEmoji('🔟').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sl_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
  return [controlRow];
}

function disabledButtons() {
  return buildSlotButtons().map((row) => {
    row.components.forEach((b) => b.setDisabled(true));
    return row;
  });
}

// ---------------------------------------------------------------------------
// Lobby state — one per channel
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, {
 *   channelId: string,
 *   channel: object,
 *   players: Map<string, {
 *     userId: string,
 *     username: string,
 *     bet: number,
 *     grid: string[][],
 *     statusText: string,
 *     spinning: boolean,
 *   }>,
 *   lobbyMessage: object|null,
 *   collector: object|null,
 *   lastEvent: string,
 * }>}
 */
const lobbies = new Map();

// ---------------------------------------------------------------------------
// Lobby message
// ---------------------------------------------------------------------------

function buildPlayerField(player) {
  return {
    name: player.username,
    value: [
      `Bet: **${player.bet}** SGC`,
      player.statusText,
      renderCompactGrid(player.grid),
    ].join('\n'),
    inline: true,
  };
}

function buildOpenSeatField(seatNumber) {
  return {
    name: `Open Seat ${seatNumber}`,
    value: [
      'Available',
      renderCompactGrid(Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill('🎰'))),
      '`/lumi-slots start` to join',
    ].join('\n'),
    inline: true,
  };
}

function buildLobbyEmbed(lobby) {
  const players = [...lobby.players.values()];
  const fields = players.map((player) => buildPlayerField(player));

  for (let seat = players.length + 1; seat <= MAX_PLAYERS; seat++) {
    fields.push(buildOpenSeatField(seat));
  }

  return new EmbedBuilder()
    .setColor(0xC0392B)
    .setTitle(`🎰 Slot Machine — Momiji Casino (${players.length}/${MAX_PLAYERS} seats)`)
    .setDescription([
      'Set your bet and hit **Spin**.',
      `3-of-a-kind: row **${HORIZONTAL_MULTIPLIER}×** · diagonal **${DIAGONAL_MULTIPLIER}×** | Hands **${HAND_MULTIPLIER}×**: 💎💎⭐ · 7️⃣7️⃣💎 · 🍒🍒🔔`,
      'Up to 3 players can share this play area at once.',
    ].join('\n'))
    .addFields(fields)
    .setFooter({
      text: lobby.lastEvent || 'Pick a bet, then pull the lever.',
    });
}

function buildLobbyMessagePayload(lobby) {
  return {
    embeds: [buildLobbyEmbed(lobby)],
    components: buildSlotButtons(),
  };
}

function tryAddPlayerToLobby(lobby, userId, username) {
  if (lobby.players.has(userId)) {
    return { ok: true, added: false, player: lobby.players.get(userId) };
  }

  if (lobby.players.size >= MAX_PLAYERS) {
    return {
      ok: false,
      error: `This slot bank is full (${MAX_PLAYERS}/${MAX_PLAYERS}). Wait for an open machine.`,
    };
  }

  const player = createSlotPlayer(userId, username);
  lobby.players.set(userId, player);
  lobby.lastEvent = `${username} joined the slot bank.`;
  return { ok: true, added: true, player };
}

async function updateLobbyMessage(lobby) {
  if (!lobby.lobbyMessage) return;
  try {
    await lobby.lobbyMessage.edit({
      content: null,
      ...buildLobbyMessagePayload(lobby),
    });
  } catch (err) {
    logger.error('Slots: failed to update lobby message', err.message);
  }
}

// ---------------------------------------------------------------------------
// Spin animation + resolution
// ---------------------------------------------------------------------------

async function handleSpin(lobby, btn) {
  const userId = btn.user.id;
  const player = lobby.players.get(userId);

  if (!player) {
    await btn.reply({ content: "You're not at this machine. Use `/lumi-slots start` to join!", ephemeral: true }).catch(() => {});
    return;
  }

  if (player.spinning) {
    await btn.reply({ content: 'Your reels are already spinning — wait for them to stop!', ephemeral: true }).catch(() => {});
    return;
  }

  // Validate & deduct bet
  ensureAccount(userId, player.username);
  const bal = getBalance(userId);
  if (bal < player.bet) {
    await btn.reply({ content: `❌ You only have **${bal.toLocaleString()} SGC** but your bet is **${player.bet}**.`, ephemeral: true }).catch(() => {});
    return;
  }

  const betResult = placeCasinoBet(userId, player.username, player.bet, 'slots');
  if (!betResult.success) {
    await btn.reply({ content: `❌ ${betResult.error}`, ephemeral: true }).catch(() => {});
    return;
  }

  player.spinning = true;
  player.statusText = 'Spinning...';
  lobby.lastEvent = `${player.username} spins for ${player.bet} SGC.`;

  // Acknowledge the button press
  await btn.deferUpdate().catch(() => {});

  // Animate spinning frames by editing the lobby message
  const finalGrid = randomGrid();

  // Update this player's machine immediately so other players can spin too
  try {
    player.grid = randomGrid();
    await lobby.lobbyMessage.edit({
      content: null,
      ...buildLobbyMessagePayload(lobby),
    });
  } catch (err) {
    logger.error('Slots: failed to update lobby for spin', err.message);
    player.statusText = 'Ready';
    player.spinning = false;
    return;
  }

  // Intermediate spin frames
  for (let f = 1; f < SPIN_FRAMES; f++) {
    await sleep(SPIN_FRAME_MS);
    const frameGrid = f === SPIN_FRAMES - 1 ? finalGrid : randomGrid();
    player.grid = frameGrid;
    player.statusText = f < SPIN_FRAMES - 1 ? 'Spinning...' : 'Stopping...';
    try {
      await lobby.lobbyMessage.edit({
        content: null,
        ...buildLobbyMessagePayload(lobby),
      });
    } catch { /* ignore */ }
  }

  // Evaluate result
  const { totalMultiplier, wins } = evaluateGrid(finalGrid);
  const payout = Math.floor(player.bet * totalMultiplier);

  if (wins.length > 0) {
    if (payout > 0) payCasinoPayout(userId, payout, 'slots');
    const newBal = getBalance(userId);
    player.statusText = `Won ${payout.toLocaleString()} • Bal ${newBal.toLocaleString()}`;
    lobby.lastEvent = `${player.username}: +${payout.toLocaleString()} SGC, bal ${newBal.toLocaleString()}.`;
  } else {
    const newBal = getBalance(userId);
    player.statusText = `Lost ${player.bet.toLocaleString()} • Bal ${newBal.toLocaleString()}`;
    lobby.lastEvent = `${player.username}: -${player.bet.toLocaleString()} SGC, bal ${newBal.toLocaleString()}.`;
  }
  player.spinning = false;

  // Show result + re-enable buttons on the same message
  try {
    await lobby.lobbyMessage.edit({
      content: null,
      ...buildLobbyMessagePayload(lobby),
    });
  } catch (err) {
    logger.error('Slots: failed to edit spin result', err.message);
  }

  logger.info(`Slots: ${player.username} bet=${player.bet} mult=${totalMultiplier} payout=${payout} wins=${wins.length}`);
}

// ---------------------------------------------------------------------------
// Button collector
// ---------------------------------------------------------------------------

function setupCollector(lobby) {
  const collector = lobby.lobbyMessage.createMessageComponentCollector({
    filter: (i) => i.customId.startsWith('sl_'),
    idle: 300_000, // 5 min idle → close
  });
  lobby.collector = collector;

  collector.on('collect', async (btn) => {
    const userId = btn.user.id;
    const username = btn.user.username;

    // ── Leave ──
    if (btn.customId === 'sl_leave') {
      if (!lobby.players.has(userId)) {
        await btn.reply({ content: "You're not at this machine.", ephemeral: true }).catch(() => {});
        return;
      }
      if (lobby.players.get(userId)?.spinning) {
        await btn.reply({ content: 'You cannot leave while your reels are spinning.', ephemeral: true }).catch(() => {});
        return;
      }
      lobby.players.delete(userId);
      lobby.lastEvent = `${username} left the slot bank.`;
      await btn.reply({ content: 'You left the slot machine.', ephemeral: true }).catch(() => {});

      if (lobby.players.size === 0) {
        collector.stop('allLeft');
        lobbies.delete(lobby.channelId);
        try {
          await lobby.lobbyMessage.edit({
            content: '🎰 **Slot Machine — Closed** (everyone left)',
            embeds: [],
            components: disabledButtons(),
          });
        } catch { /* ignore */ }
        return;
      }
      await updateLobbyMessage(lobby);
      return;
    }

    // ── Spin ──
    if (btn.customId === 'sl_spin') {
      // Auto-join if clicking spin while not in lobby
      if (!lobby.players.has(userId)) {
        ensureAccount(userId, username);
        const addResult = tryAddPlayerToLobby(lobby, userId, username);
        if (!addResult.ok) {
          await btn.reply({ content: addResult.error, ephemeral: true }).catch(() => {});
          return;
        }
        await updateLobbyMessage(lobby);
      }
      await handleSpin(lobby, btn);
      return;
    }

    // ── Bet amount ──
    if (btn.customId.startsWith('sl_bet_')) {
      const amount = parseInt(btn.customId.replace('sl_bet_', ''), 10);
      ensureAccount(userId, username);

      if (!lobby.players.has(userId)) {
        const addResult = tryAddPlayerToLobby(lobby, userId, username);
        if (!addResult.ok) {
          await btn.reply({ content: addResult.error, ephemeral: true }).catch(() => {});
          return;
        }
      }

      const player = lobby.players.get(userId);
      if (player.spinning) {
        await btn.reply({ content: 'You cannot change your bet while your reels are spinning.', ephemeral: true }).catch(() => {});
        return;
      }
      const bal = getBalance(userId);
      if (bal < amount) {
        await btn.reply({ content: `❌ You only have **${bal.toLocaleString()} SGC**.`, ephemeral: true }).catch(() => {});
        return;
      }

      player.bet = amount;
      player.statusText = 'Ready';
      lobby.lastEvent = `${username} set their bet to ${amount} SGC.`;
      await btn.reply({ content: `Bet set to **${amount} SGC**.`, ephemeral: true }).catch(() => {});
      await updateLobbyMessage(lobby);
      return;
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'allLeft') return;
    // Idle timeout
    lobbies.delete(lobby.channelId);
    try {
      await lobby.lobbyMessage.edit({
        content: '🎰 **Slot Machine — Closed** (idle timeout)',
        embeds: [],
        components: disabledButtons(),
      });
    } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

function buildSlotsCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-slots')
    .setDescription('Play the slot machine at the Momiji Casino!')
    .addSubcommand((sub) => sub
      .setName('start')
      .setDescription('Open or join a slot machine in this channel.'))
    .addSubcommand((sub) => sub
      .setName('leave')
      .setDescription('Leave the slot machine.'))
    .toJSON();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleSlotsCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return handleStart(interaction);
  if (sub === 'leave') return handleLeave(interaction);
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

async function handleStart(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const channelId = interaction.channelId;

  ensureAccount(userId, username);
  const channel = interaction.channel ?? await interaction.client.channels.fetch(channelId);

  let lobby = lobbies.get(channelId);

  if (lobby) {
    lobby.channel = channel;
    if (lobby.players.has(userId)) {
      await interaction.reply({ content: "You're already at this slot machine!", ephemeral: true });
      return;
    }
    const addResult = tryAddPlayerToLobby(lobby, userId, username);
    if (!addResult.ok) {
      await interaction.reply({ content: addResult.error, ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'You joined the slot machine! Set your bet and hit Spin.', ephemeral: true });
    await updateLobbyMessage(lobby);
    return;
  }

  // Create new lobby — use interaction reply as the lobby message
  lobby = {
    channelId,
    channel,
    players: new Map(),
    lobbyMessage: null,
    collector: null,
    lastEvent: '',
  };
  tryAddPlayerToLobby(lobby, userId, username);
  lobbies.set(channelId, lobby);

  await interaction.reply(buildLobbyMessagePayload(lobby));
  lobby.lobbyMessage = await interaction.fetchReply();
  setupCollector(lobby);
}

async function handleLeave(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const lobby = lobbies.get(channelId);

  if (!lobby || !lobby.players.has(userId)) {
    await interaction.reply({ content: "You're not at a slot machine in this channel.", ephemeral: true });
    return;
  }

  if (lobby.players.get(userId)?.spinning) {
    await interaction.reply({ content: 'You cannot leave while your reels are spinning.', ephemeral: true });
    return;
  }

  lobby.players.delete(userId);
  lobby.lastEvent = `${interaction.user.username} left the slot bank.`;
  await interaction.reply({ content: 'You left the slot machine.', ephemeral: true });

  if (lobby.players.size === 0) {
    if (lobby.collector) lobby.collector.stop('allLeft');
    lobbies.delete(channelId);
    if (lobby.lobbyMessage) {
      try {
        await lobby.lobbyMessage.edit({
          content: '🎰 **Slot Machine — Closed** (everyone left)',
          embeds: [],
          components: disabledButtons(),
        });
      } catch { /* ignore */ }
    }
    return;
  }

  await updateLobbyMessage(lobby);
}

// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reloadSettings() {
  try {
    SPIN_FRAMES = getSetting('slots.spinFrames');
    SPIN_FRAME_MS = getSetting('slots.spinFrameMs');
    DEFAULT_BET = getSetting('slots.defaultBet');
    MAX_PLAYERS = getSetting('slots.maxPlayers');
    HORIZONTAL_MULTIPLIER = getSetting('slots.horizontalMultiplier');
    DIAGONAL_MULTIPLIER = getSetting('slots.diagonalMultiplier');
    HAND_MULTIPLIER = getSetting('slots.handMultiplier');
  } catch { /* DB not ready */ }
}

const { config } = require('./config');
if (config.gameWorkersEnabled && config.gameWorkersSlots) {
  module.exports = require('./slotsAdapter');
} else {
  module.exports = { buildSlotsCommand, handleSlotsCommand, reloadSettings };
}
