'use strict';

/**
 * Worker-backed Discord adapter for the Slots lobby.
 *
 * Drop-in replacement for src/slots.js when both gameWorkersEnabled and
 * gameWorkersSlots are true.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const { logger } = require('./logger');
const { manager } = require('./workers/workerManager');
const { getSetting } = require('./panelSettings');

const ENGINE = 'slots';

/** @type {Map<string, { lobbyMessage: object, collector: object|null }>} */
const sessions = new Map();
let listenerInstalled = false;

// ---------------------------------------------------------------------------
// Buttons & embed rebuild
// ---------------------------------------------------------------------------

function buildButtons(disabled = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sl_spin').setLabel('Spin').setEmoji('🎰').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('sl_bet_1').setLabel('1 SGC').setEmoji('1️⃣').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('sl_bet_5').setLabel('5 SGC').setEmoji('5️⃣').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('sl_bet_10').setLabel('10 SGC').setEmoji('🔟').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('sl_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  return [row];
}

function buildEmbedFromPayload(embed) {
  const e = new EmbedBuilder()
    .setColor(embed.color ?? 0xC0392B)
    .setTitle(embed.title || '🎰 Slot Machine')
    .setDescription(embed.description || '')
    .addFields(embed.fields || [])
    .setFooter({ text: embed.footer || ' ' });
  return e;
}

function buildLobbyPayload(payload) {
  return {
    content: null,
    embeds: [buildEmbedFromPayload(payload.embed)],
    components: buildButtons(false),
  };
}

// ---------------------------------------------------------------------------
// Slash command schema (mirrors src/slots.js)
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
// Slash handlers
// ---------------------------------------------------------------------------

async function handleSlotsCommand(interaction) {
  installListener();
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return handleStart(interaction);
  if (sub === 'leave') return handleLeave(interaction);
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

async function handleStart(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const username = interaction.user.username;

  let result;
  try {
    result = await manager.sendCommand(ENGINE, 'join', { channelId, userId, username }, { channelId });
  } catch (err) {
    logger.error('slots adapter: join failed', err.message);
    await interaction.reply({ content: 'Slots is unavailable right now.', ephemeral: true });
    return;
  }

  if (!result.ok) {
    if (result.reason === 'already_joined') {
      await interaction.reply({ content: "You're already at this slot machine!", ephemeral: true });
      return;
    }
    if (result.reason === 'full') {
      await interaction.reply({ content: `This slot bank is full (${result.max}/${result.max}).`, ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Could not join the slot machine.', ephemeral: true });
    return;
  }

  if (result.isNew) {
    await interaction.reply(buildLobbyPayload(result));
    let lobbyMessage;
    try { lobbyMessage = await interaction.fetchReply(); }
    catch (err) { logger.warn('slots adapter: fetchReply failed', err.message); return; }
    sessions.set(channelId, { lobbyMessage, collector: null });
    setupCollector(channelId);
  } else {
    await interaction.reply({ content: 'You joined the slot machine! Set your bet and hit Spin.', ephemeral: true });
    await editLobbyMessage(channelId, result);
  }
}

async function handleLeave(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  let result;
  try {
    result = await manager.sendCommand(ENGINE, 'leave', { channelId, userId }, { channelId });
  } catch (err) {
    logger.error('slots adapter: leave failed', err.message);
    await interaction.reply({ content: 'Slots is unavailable right now.', ephemeral: true });
    return;
  }
  if (!result.ok) {
    if (result.reason === 'spinning') {
      await interaction.reply({ content: 'You cannot leave while your reels are spinning.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: "You're not at a slot machine in this channel.", ephemeral: true });
    return;
  }
  await interaction.reply({ content: 'You left the slot machine.', ephemeral: true });
  if (!result.closed) {
    await editLobbyMessage(channelId, result);
  }
  // closed → lobbyClosed event handles the message edit
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

function setupCollector(channelId) {
  const session = sessions.get(channelId);
  if (!session || !session.lobbyMessage) return;
  if (session.collector) {
    try { session.collector.stop('replaced'); } catch { /* ignore */ }
    session.collector = null;
  }

  const collector = session.lobbyMessage.createMessageComponentCollector({
    filter: (i) => i.customId.startsWith('sl_'),
    idle: 5 * 60 * 1000,
  });
  session.collector = collector;
  collector.on('collect', (btn) => { void onCollect(channelId, btn); });
  collector.on('end', () => { /* worker manages real lifetime */ });
}

async function onCollect(channelId, btn) {
  const userId = btn.user.id;
  const username = btn.user.username;

  if (btn.customId === 'sl_leave') {
    let result;
    try {
      result = await manager.sendCommand(ENGINE, 'leave', { channelId, userId }, { channelId });
    } catch (err) {
      logger.error('slots adapter: leave (button) failed', err.message);
      await btn.deferUpdate().catch(() => {});
      return;
    }
    if (!result.ok) {
      const text = result.reason === 'spinning'
        ? 'You cannot leave while your reels are spinning.'
        : "You're not at this machine.";
      await btn.reply({ content: text, ephemeral: true }).catch(() => {});
      return;
    }
    await btn.reply({ content: 'You left the slot machine.', ephemeral: true }).catch(() => {});
    if (!result.closed) {
      await editLobbyMessage(channelId, result);
    }
    return;
  }

  if (btn.customId === 'sl_spin') {
    let result;
    try {
      result = await manager.sendCommand(ENGINE, 'spin', { channelId, userId, username }, { channelId });
    } catch (err) {
      logger.error('slots adapter: spin failed', err.message);
      await btn.deferUpdate().catch(() => {});
      return;
    }
    if (!result.ok) {
      await btn.reply({ content: spinFailureMessage(result), ephemeral: true }).catch(() => {});
      return;
    }
    await btn.deferUpdate().catch(() => {});
    await editLobbyMessage(channelId, result);
    return;
  }

  if (btn.customId.startsWith('sl_bet_')) {
    const amount = parseInt(btn.customId.replace('sl_bet_', ''), 10);
    let result;
    try {
      result = await manager.sendCommand(ENGINE, 'setBet', { channelId, userId, username, amount }, { channelId });
    } catch (err) {
      logger.error('slots adapter: setBet failed', err.message);
      await btn.deferUpdate().catch(() => {});
      return;
    }
    if (!result.ok) {
      await btn.reply({ content: betFailureMessage(result, amount), ephemeral: true }).catch(() => {});
      return;
    }
    await btn.reply({ content: `Bet set to **${amount} SGC**.`, ephemeral: true }).catch(() => {});
    await editLobbyMessage(channelId, result);
  }
}

function spinFailureMessage(result) {
  switch (result.reason) {
    case 'no_lobby': return 'No active slot machine here.';
    case 'spinning': return 'Your reels are already spinning — wait for them to stop!';
    case 'insufficient': return `❌ You only have **${(result.balance ?? 0).toLocaleString()} SGC** but your bet is **${(result.bet ?? 0).toLocaleString()}**.`;
    case 'bet_failed': return `❌ ${result.error || 'Bet failed.'}`;
    case 'full': return `This slot bank is full (${result.max}/${result.max}).`;
    default: return 'Spin failed.';
  }
}

function betFailureMessage(result, amount) {
  switch (result.reason) {
    case 'spinning': return 'You cannot change your bet while your reels are spinning.';
    case 'insufficient': return `❌ You only have **${(result.balance ?? 0).toLocaleString()} SGC**.`;
    case 'full': return `This slot bank is full (${result.max}/${result.max}).`;
    case 'bad_amount': return '❌ Invalid bet amount.';
    default: return `Could not set bet to ${amount}.`;
  }
}

// ---------------------------------------------------------------------------
// Worker -> main events
// ---------------------------------------------------------------------------

function installListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  manager.onEngineEvent(ENGINE, (evt) => {
    if (!evt || typeof evt.channelId !== 'string') return;
    if (evt.name === 'render') {
      void editLobbyMessage(evt.channelId, evt);
      return;
    }
    if (evt.name === 'lobbyClosed') {
      void onLobbyClosed(evt);
      return;
    }
    if (evt.name === 'spinComplete') {
      logger.info(`Slots: user=${evt.userId} bet=${evt.bet} payout=${evt.payout} mult=${evt.multiplier} wins=${evt.winCount}`);
      return;
    }
    if (evt.name === 'payoutFailed') {
      logger.warn(`slots adapter: payout failed user=${evt.userId} amount=${evt.amount}: ${evt.error}`);
    }
  });
}

async function editLobbyMessage(channelId, payload) {
  const session = sessions.get(channelId);
  if (!session || !session.lobbyMessage || !payload || !payload.embed) return;
  try {
    await session.lobbyMessage.edit(buildLobbyPayload(payload));
  } catch (err) {
    logger.warn('slots adapter: edit failed', err.message);
  }
}

async function onLobbyClosed(evt) {
  const session = sessions.get(evt.channelId);
  if (!session) return;
  sessions.delete(evt.channelId);
  if (session.collector) {
    try { session.collector.stop('lobbyClosed'); } catch { /* ignore */ }
  }
  try {
    await session.lobbyMessage.edit({
      content: evt.content,
      embeds: [],
      components: buildButtons(true),
    });
  } catch (err) {
    logger.warn('slots adapter: close edit failed', err.message);
  }
}

// ---------------------------------------------------------------------------
// Settings reload
// ---------------------------------------------------------------------------

async function reloadSettings() {
  try {
    const next = {
      spinFrames: getSetting('slots.spinFrames'),
      spinFrameMs: getSetting('slots.spinFrameMs'),
      defaultBet: getSetting('slots.defaultBet'),
      maxPlayers: getSetting('slots.maxPlayers'),
      horizontalMultiplier: getSetting('slots.horizontalMultiplier'),
      diagonalMultiplier: getSetting('slots.diagonalMultiplier'),
      handMultiplier: getSetting('slots.handMultiplier'),
    };
    try { await manager.sendCommand(ENGINE, 'setSettings', next); }
    catch { /* workers not started yet */ }
  } catch { /* DB not ready */ }
}

module.exports = { buildSlotsCommand, handleSlotsCommand, reloadSettings };
