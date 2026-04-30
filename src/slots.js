/**
 * Slots — multiplayer slot machine at the Momiji Casino.
 *
 * /lumi-slots start   Open (or join) a slot machine lobby in this channel.
 * /lumi-slots leave   Leave the lobby.
 *
 * Players use button controls:
 *   🎰 Spin                  Pull the lever (costs your current bet)
 *   1️⃣ 5️⃣ 🔟 💰             Set bet to 1 / 5 / 10 / 25 SGC
 *   ❌ Leave                 Walk away
 *
 * The machine uses 5 hands (3 rows + 2 diagonals). A hand wins when:
 *   • all 3 symbols match, or
 *   • 2 matching symbols are completed by a 🔔 wildcard.
 *
 * Payout = sum of winning hand points × bet.
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
const Engine = require('./workers/engines/slots/engine');

let SPIN_FRAMES = Engine.DEFAULTS.spinFrames;
let SPIN_FRAME_MS = Engine.DEFAULTS.spinFrameMs;
let DEFAULT_BET = Engine.DEFAULTS.defaultBet;
let MAX_PLAYERS = Engine.DEFAULTS.maxPlayers;

const BET_OPTIONS = [...Engine.BET_OPTIONS];

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSlotPlayer(userId, username) {
  return Engine.createPlayer(userId, username, { defaultBet: DEFAULT_BET });
}

function buildSlotButtons() {
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sl_spin').setLabel('Spin').setEmoji('🎰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sl_bet_1').setLabel('1 SGC').setEmoji('1️⃣').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sl_bet_5').setLabel('5 SGC').setEmoji('5️⃣').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sl_bet_10').setLabel('10 SGC').setEmoji('🔟').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sl_bet_25').setLabel('25 SGC').setEmoji('💰').setStyle(ButtonStyle.Secondary),
  );
  const utilityRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sl_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
  return [controlRow, utilityRow];
}

function disabledButtons() {
  return buildSlotButtons().map((row) => {
    row.components.forEach((button) => button.setDisabled(true));
    return row;
  });
}

function buildPlayerField(player) {
  return {
    name: player.username,
    value: [
      `Bet: **${player.bet}** SGC`,
      player.statusText,
      Engine.renderCompactGrid(player.grid),
    ].join('\n'),
    inline: true,
  };
}

function buildOpenSeatField(seatNumber) {
  return {
    name: `Open Seat ${seatNumber}`,
    value: [
      'Available',
      Engine.renderCompactGrid(Engine.placeholderGrid()),
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
      Engine.buildPayoutSummary(),
      `Bet buttons: ${BET_OPTIONS.join(' / ')} SGC.`,
      'Up to 3 players can share this play area at once.',
    ].join('\n'))
    .addFields(fields)
    .setFooter({ text: lobby.lastEvent || 'Pick a bet, then pull the lever.' });
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

  ensureAccount(userId, player.username);
  const balance = getBalance(userId);
  if (balance < player.bet) {
    await btn.reply({ content: `❌ You only have **${balance.toLocaleString()} SGC** but your bet is **${player.bet}**.`, ephemeral: true }).catch(() => {});
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

  await btn.deferUpdate().catch(() => {});

  const finalGrid = Engine.randomGrid();

  try {
    player.grid = Engine.randomGrid();
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

  for (let frame = 1; frame < SPIN_FRAMES; frame++) {
    await sleep(SPIN_FRAME_MS);
    player.grid = frame === SPIN_FRAMES - 1 ? finalGrid : Engine.randomGrid();
    player.statusText = frame < SPIN_FRAMES - 1 ? 'Spinning...' : 'Stopping...';
    try {
      await lobby.lobbyMessage.edit({
        content: null,
        ...buildLobbyMessagePayload(lobby),
      });
    } catch {
      // ignore transient edit errors during animation
    }
  }

  const { totalPoints, wins } = Engine.evaluateGrid(finalGrid);
  const payout = player.bet * totalPoints;
  const newBalance = (() => {
    if (wins.length > 0 && payout > 0) payCasinoPayout(userId, payout, 'slots');
    return getBalance(userId);
  })();

  if (wins.length > 0) {
    player.statusText = `Won ${payout.toLocaleString()} • ${totalPoints} pts × ${player.bet} • Bal ${newBalance.toLocaleString()}`;
    lobby.lastEvent = `${player.username}: ${totalPoints} pts × ${player.bet} = +${payout.toLocaleString()} SGC, bal ${newBalance.toLocaleString()}.`;
  } else {
    player.statusText = `Lost ${player.bet.toLocaleString()} • Bal ${newBalance.toLocaleString()}`;
    lobby.lastEvent = `${player.username}: -${player.bet.toLocaleString()} SGC, bal ${newBalance.toLocaleString()}.`;
  }
  player.spinning = false;

  try {
    await lobby.lobbyMessage.edit({
      content: null,
      ...buildLobbyMessagePayload(lobby),
    });
  } catch (err) {
    logger.error('Slots: failed to edit spin result', err.message);
  }

  logger.info(`Slots: ${player.username} bet=${player.bet} points=${totalPoints} payout=${payout} wins=${wins.length}`);
}

function setupCollector(lobby) {
  const collector = lobby.lobbyMessage.createMessageComponentCollector({
    filter: (interaction) => interaction.customId.startsWith('sl_'),
    idle: 300_000,
  });
  lobby.collector = collector;

  collector.on('collect', async (btn) => {
    const userId = btn.user.id;
    const username = btn.user.username;

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
        } catch {
          // ignore
        }
        return;
      }

      await updateLobbyMessage(lobby);
      return;
    }

    if (btn.customId === 'sl_spin') {
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

    if (!btn.customId.startsWith('sl_bet_')) return;

    const amount = parseInt(btn.customId.replace('sl_bet_', ''), 10);
    ensureAccount(userId, username);

    if (!Engine.isAllowedBet(amount)) {
      await btn.reply({ content: `❌ Slots only allow bets of ${BET_OPTIONS.join(', ')} SGC.`, ephemeral: true }).catch(() => {});
      return;
    }

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

    const balance = getBalance(userId);
    if (balance < amount) {
      await btn.reply({ content: `❌ You only have **${balance.toLocaleString()} SGC**.`, ephemeral: true }).catch(() => {});
      return;
    }

    player.bet = amount;
    player.statusText = 'Ready';
    lobby.lastEvent = `${username} set their bet to ${amount} SGC.`;
    await btn.reply({ content: `Bet set to **${amount} SGC**.`, ephemeral: true }).catch(() => {});
    await updateLobbyMessage(lobby);
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'allLeft') return;
    lobbies.delete(lobby.channelId);
    try {
      await lobby.lobbyMessage.edit({
        content: '🎰 **Slot Machine — Closed** (idle timeout)',
        embeds: [],
        components: disabledButtons(),
      });
    } catch {
      // ignore
    }
  });
}

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
      } catch {
        // ignore
      }
    }
    return;
  }

  await updateLobbyMessage(lobby);
}

function reloadSettings() {
  try {
    SPIN_FRAMES = getSetting('slots.spinFrames');
    SPIN_FRAME_MS = getSetting('slots.spinFrameMs');
    DEFAULT_BET = getSetting('slots.defaultBet');
    MAX_PLAYERS = getSetting('slots.maxPlayers');
  } catch {
    // DB not ready
  }
}

const { config } = require('./config');
if (config.gameWorkersEnabled && config.gameWorkersSlots) {
  module.exports = require('./slotsAdapter');
} else {
  module.exports = { buildSlotsCommand, handleSlotsCommand, reloadSettings };
}
