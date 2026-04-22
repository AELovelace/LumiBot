'use strict';

/**
 * Worker-backed Discord adapter for Horseracing.
 *
 * Drop-in replacement for src/horseracing.js when both
 * gameWorkersEnabled and gameWorkersHorseracing are true.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require('discord.js');

const { logger } = require('./logger');
const { manager } = require('./workers/workerManager');
const { getSetting } = require('./panelSettings');

const ENGINE = 'horseracing';
const COLLECTOR_IDLE_MS = 5 * 60 * 1000;

/** @type {Map<string, { channel: object, bettingMessage: object|null, bettingCollector: object|null, raceMessage: object|null }>} */
const sessions = new Map();
let listenerInstalled = false;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function buildBettingButtons(disabled = false) {
  const horseRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hr_horse_A').setLabel('Horse A').setEmoji('1️⃣').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('hr_horse_B').setLabel('Horse B').setEmoji('2️⃣').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('hr_horse_C').setLabel('Horse C').setEmoji('3️⃣').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('hr_horse_D').setLabel('Horse D').setEmoji('4️⃣').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('hr_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  const betRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hr_bet_5').setLabel('5 SGC').setEmoji('5️⃣').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('hr_bet_10').setLabel('10 SGC').setEmoji('🔟').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('hr_bet_20').setLabel('20 SGC').setEmoji('💰').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
  return [horseRow, betRow];
}

// ---------------------------------------------------------------------------
// Slash command schema
// ---------------------------------------------------------------------------

function buildHorseRaceCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-horserace')
    .setDescription('Bet on horse races at the Momiji Casino!')
    .addSubcommand((sub) => sub
      .setName('start')
      .setDescription('Start or join a horse race lobby in this channel.'))
    .addSubcommand((sub) => sub
      .setName('leave')
      .setDescription('Leave the horse race lobby.'))
    .toJSON();
}

async function handleHorseRaceCommand(interaction) {
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
  const channel = interaction.channel ?? await interaction.client.channels.fetch(channelId).catch(() => null);

  let result;
  try {
    result = await manager.sendCommand(ENGINE, 'join', { channelId, userId, username }, { channelId });
  } catch (err) {
    logger.error('horseracing adapter: join failed', err.message);
    await interaction.reply({ content: 'Horse racing is unavailable right now.', ephemeral: true });
    return;
  }

  if (!result.ok) {
    if (result.reason === 'already_joined') {
      await interaction.reply({ content: "You're already in the horse race lobby!", ephemeral: true });
      return;
    }
    if (result.reason === 'insufficient_to_join') {
      await interaction.reply({
        content: `You need at least **${result.minBet} SGC** to join horse racing. You only have **${(result.balance ?? 0).toLocaleString()} SGC**.`,
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({ content: 'Could not join the horse race lobby.', ephemeral: true });
    return;
  }

  if (result.isNew) {
    await interaction.reply({ content: result.content, components: buildBettingButtons(false) });
    let bettingMessage;
    try { bettingMessage = await interaction.fetchReply(); }
    catch (err) { logger.warn('horseracing adapter: fetchReply failed', err.message); return; }
    sessions.set(channelId, { channel, bettingMessage, bettingCollector: null, raceMessage: null });
    setupBettingCollector(channelId);
  } else {
    await interaction.reply({ content: 'You joined the horse race lobby! Pick a horse and bet using the buttons.', ephemeral: true });
    // bettingUpdate event will refresh the message
  }
}

async function handleLeave(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  let result;
  try {
    result = await manager.sendCommand(ENGINE, 'leave', { channelId, userId }, { channelId });
  } catch (err) {
    logger.error('horseracing adapter: leave failed', err.message);
    await interaction.reply({ content: 'Horse racing is unavailable right now.', ephemeral: true });
    return;
  }
  if (!result.ok) {
    await interaction.reply({ content: "You're not in a horse race lobby in this channel.", ephemeral: true });
    return;
  }
  await interaction.reply({ content: 'You left the horse race lobby.', ephemeral: true });
}

// ---------------------------------------------------------------------------
// Collector for current betting message
// ---------------------------------------------------------------------------

function setupBettingCollector(channelId) {
  const session = sessions.get(channelId);
  if (!session || !session.bettingMessage) return;
  if (session.bettingCollector) {
    try { session.bettingCollector.stop('replaced'); } catch { /* ignore */ }
  }
  const collector = session.bettingMessage.createMessageComponentCollector({
    filter: (i) => i.customId.startsWith('hr_'),
    idle: COLLECTOR_IDLE_MS,
  });
  session.bettingCollector = collector;
  collector.on('collect', (btn) => { void onCollect(channelId, btn); });
  collector.on('end', () => { /* worker manages real lifetime */ });
}

async function onCollect(channelId, btn) {
  const userId = btn.user.id;
  const username = btn.user.username;

  if (btn.customId === 'hr_leave') {
    let result;
    try {
      result = await manager.sendCommand(ENGINE, 'leave', { channelId, userId }, { channelId });
    } catch (err) {
      logger.error('horseracing adapter: leave (button) failed', err.message);
      await btn.deferUpdate().catch(() => {});
      return;
    }
    if (!result.ok) {
      await btn.reply({ content: "You're not in this lobby.", ephemeral: true }).catch(() => {});
      return;
    }
    await btn.reply({ content: 'You left the horse race lobby.', ephemeral: true }).catch(() => {});
    return;
  }

  if (btn.customId.startsWith('hr_horse_')) {
    const horse = btn.customId.replace('hr_horse_', '');
    let result;
    try {
      result = await manager.sendCommand(ENGINE, 'pickHorse', { channelId, userId, username, horse }, { channelId });
    } catch (err) {
      logger.error('horseracing adapter: pickHorse failed', err.message);
      await btn.deferUpdate().catch(() => {});
      return;
    }
    if (!result.ok) {
      await btn.reply({ content: pickFailureMessage(result), ephemeral: true }).catch(() => {});
      return;
    }
    await btn.reply({ content: `You picked **Horse ${horse}**!`, ephemeral: true }).catch(() => {});
    return;
  }

  if (btn.customId.startsWith('hr_bet_')) {
    const amount = parseInt(btn.customId.replace('hr_bet_', ''), 10);
    let result;
    try {
      result = await manager.sendCommand(ENGINE, 'setBet', { channelId, userId, username, amount }, { channelId });
    } catch (err) {
      logger.error('horseracing adapter: setBet failed', err.message);
      await btn.deferUpdate().catch(() => {});
      return;
    }
    if (!result.ok) {
      await btn.reply({ content: betFailureMessage(result), ephemeral: true }).catch(() => {});
      return;
    }
    await btn.reply({ content: `Bet set to **${amount} SGC**.`, ephemeral: true }).catch(() => {});
  }
}

function pickFailureMessage(result) {
  switch (result.reason) {
    case 'no_lobby': return 'No active horse race lobby in this channel.';
    case 'not_betting': return 'Betting is closed for this race.';
    case 'cannot_afford_bet': return `❌ You need **${(result.bet ?? 0).toLocaleString()} SGC** to back a horse, but you only have **${(result.balance ?? 0).toLocaleString()} SGC**. Lower your bet first.`;
    case 'insufficient_to_join': return `❌ You need at least **${result.minBet} SGC** to join horse racing.`;
    case 'bad_horse': return '❌ Invalid horse.';
    default: return 'Could not pick that horse.';
  }
}

function betFailureMessage(result) {
  switch (result.reason) {
    case 'no_lobby': return 'No active horse race lobby in this channel.';
    case 'not_betting': return 'Betting is closed for this race.';
    case 'insufficient': return `❌ You only have **${(result.balance ?? 0).toLocaleString()} SGC**.`;
    case 'bad_amount': return '❌ Invalid bet amount.';
    default: return 'Could not set bet.';
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
    switch (evt.name) {
      case 'bettingOpen': void onBettingOpen(evt); return;
      case 'bettingUpdate': void onBettingUpdate(evt); return;
      case 'bettingClosed': void onBettingClosed(evt); return;
      case 'raceStart': void onRaceStart(evt); return;
      case 'raceFrame': void onRaceFrame(evt); return;
      case 'raceFinished': void onRaceFinished(evt); return;
      case 'lobbyClosed': void onLobbyClosed(evt); return;
      case 'payoutFailed':
        logger.warn(`horseracing adapter: payout failed user=${evt.userId} amount=${evt.amount}: ${evt.error}`);
        return;
      default: return;
    }
  });
}

async function onBettingOpen(evt) {
  const session = sessions.get(evt.channelId);
  if (!session || !session.channel) {
    logger.warn(`horseracing adapter: bettingOpen for unknown channel ${evt.channelId}`);
    return;
  }
  // Stop the previous collector before replacing the message.
  if (session.bettingCollector) {
    try { session.bettingCollector.stop('newRound'); } catch { /* ignore */ }
    session.bettingCollector = null;
  }
  try {
    const msg = await session.channel.send({ content: evt.content, components: buildBettingButtons(false) });
    session.bettingMessage = msg;
    session.raceMessage = null;
    setupBettingCollector(evt.channelId);
  } catch (err) {
    logger.error('horseracing adapter: failed to send new betting message', err.message);
  }
}

async function onBettingUpdate(evt) {
  const session = sessions.get(evt.channelId);
  if (!session || !session.bettingMessage) return;
  try {
    await session.bettingMessage.edit({ content: evt.content, components: buildBettingButtons(false) });
  } catch (err) {
    logger.warn('horseracing adapter: bettingUpdate edit failed', err.message);
  }
}

async function onBettingClosed(evt) {
  const session = sessions.get(evt.channelId);
  if (!session || !session.bettingMessage) return;
  if (session.bettingCollector) {
    try { session.bettingCollector.stop('bettingClosed'); } catch { /* ignore */ }
    session.bettingCollector = null;
  }
  try {
    if (evt.content) {
      await session.bettingMessage.edit({ content: evt.content, components: buildBettingButtons(true) });
    } else {
      await session.bettingMessage.edit({ components: buildBettingButtons(true) });
    }
  } catch (err) {
    logger.warn('horseracing adapter: bettingClosed edit failed', err.message);
  }
}

async function onRaceStart(evt) {
  const session = sessions.get(evt.channelId);
  if (!session || !session.channel) return;
  try {
    session.raceMessage = await session.channel.send(evt.content);
  } catch (err) {
    logger.error('horseracing adapter: raceStart send failed', err.message);
  }
}

async function onRaceFrame(evt) {
  const session = sessions.get(evt.channelId);
  if (!session || !session.raceMessage) return;
  try { await session.raceMessage.edit(evt.content); }
  catch (err) { logger.warn('horseracing adapter: raceFrame edit failed', err.message); }
}

async function onRaceFinished(evt) {
  const session = sessions.get(evt.channelId);
  if (!session || !session.raceMessage) return;
  try { await session.raceMessage.edit(evt.content); }
  catch (err) { logger.warn('horseracing adapter: raceFinished edit failed', err.message); }
}

async function onLobbyClosed(evt) {
  const session = sessions.get(evt.channelId);
  if (!session) return;
  sessions.delete(evt.channelId);
  if (session.bettingCollector) {
    try { session.bettingCollector.stop('lobbyClosed'); } catch { /* ignore */ }
  }
  if (session.bettingMessage) {
    try {
      await session.bettingMessage.edit({ content: evt.content, components: buildBettingButtons(true) });
    } catch (err) {
      logger.warn('horseracing adapter: lobbyClosed edit failed', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Settings reload
// ---------------------------------------------------------------------------

async function reloadSettings() {
  try {
    const next = {
      trackWidth: getSetting('horseracing.trackWidth'),
      raceTickMs: getSetting('horseracing.raceTickMs'),
      bettingWindowMs: getSetting('horseracing.bettingWindowMs'),
      defaultBet: getSetting('horseracing.defaultBet'),
    };
    try { await manager.sendCommand(ENGINE, 'setSettings', next); }
    catch { /* workers not started yet */ }
  } catch { /* DB not ready */ }
}

module.exports = { buildHorseRaceCommand, handleHorseRaceCommand, reloadSettings };
