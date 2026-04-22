'use strict';

/**
 * Worker-backed Discord adapter for Texas Hold'em.
 *
 * Drop-in replacement for src/texasholdem.js when both
 * gameWorkersEnabled and gameWorkersHoldem are true.
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

const ENGINE = 'holdem';

/** @type {Map<string, { channel: object, gameMessage: object|null, collector: object|null }>} */
const sessions = new Map();
let listenerInstalled = false;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function buildButtons(bs) {
  const closed = !!bs.closed;
  const peekDisabled = !!bs.peekDisabled || closed;
  const actionDisabled = !!bs.actionDisabled || closed;
  const leaveDisabled = !!bs.leaveDisabled || closed;
  const checkLabel = bs.checkLabel || 'Check';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('th_peek').setLabel('Peek').setStyle(ButtonStyle.Secondary).setDisabled(peekDisabled),
      new ButtonBuilder().setCustomId('th_check').setLabel(checkLabel).setStyle(ButtonStyle.Success).setDisabled(actionDisabled),
      new ButtonBuilder().setCustomId('th_fold').setLabel('Fold').setStyle(ButtonStyle.Danger).setDisabled(actionDisabled),
      new ButtonBuilder().setCustomId('th_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(leaveDisabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('th_raise_1').setLabel('Raise 1').setStyle(ButtonStyle.Primary).setDisabled(actionDisabled),
      new ButtonBuilder().setCustomId('th_raise_2').setLabel('Raise 2').setStyle(ButtonStyle.Primary).setDisabled(actionDisabled),
      new ButtonBuilder().setCustomId('th_raise_5').setLabel('Raise 5').setStyle(ButtonStyle.Primary).setDisabled(actionDisabled),
      new ButtonBuilder().setCustomId('th_raise_10').setLabel('Raise 10').setStyle(ButtonStyle.Primary).setDisabled(actionDisabled),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Slash command
// ---------------------------------------------------------------------------

function buildHoldemCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-holdem')
    .setDescription("Play simplified Texas Hold'em at the Momiji Casino!")
    .addSubcommand((s) => s.setName('play').setDescription("Join the Hold'em table and set your ante.")
      .addIntegerOption((o) => o.setName('bet').setDescription('Ante amount in SGC').setMinValue(1).setRequired(true)))
    .addSubcommand((s) => s.setName('leave').setDescription("Leave the Hold'em table."))
    .addSubcommand((s) => s.setName('bet').setDescription('Change your ante for the next hand.')
      .addIntegerOption((o) => o.setName('amount').setDescription('New ante amount in SGC').setMinValue(1).setRequired(true)))
    .addSubcommand((s) => s.setName('raise').setDescription('Raise the current bet during a hand.')
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount to raise in SGC').setMinValue(1).setRequired(true)))
    .toJSON();
}

async function handleHoldemCommand(interaction) {
  installListener();
  const sub = interaction.options.getSubcommand();
  if (sub === 'play') return handlePlay(interaction);
  if (sub === 'leave') return handleLeave(interaction);
  if (sub === 'bet') return handleBetCommand(interaction);
  if (sub === 'raise') return handleRaiseCommand(interaction);
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

async function handlePlay(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const bet = interaction.options.getInteger('bet', true);
  const channel = interaction.channel ?? await interaction.client.channels.fetch(channelId).catch(() => null);

  let res;
  try {
    res = await manager.sendCommand(ENGINE, 'play', { channelId, userId, username, bet }, { channelId });
  } catch (err) {
    logger.error('holdem adapter: play failed', err.message);
    await interaction.reply({ content: "Hold'em is unavailable right now.", ephemeral: true });
    return;
  }

  if (!res.ok) {
    if (res.reason === 'insufficient') {
      await interaction.reply({ content: `You only have **${(res.balance ?? 0).toLocaleString()} SGC** but tried to sit with **${(res.bet ?? bet).toLocaleString()} SGC**.`, ephemeral: true });
      return;
    }
    if (res.reason === 'already_seated') {
      await interaction.reply({ content: "You are already seated at this Hold'em table.", ephemeral: true });
      return;
    }
    if (res.reason === 'table_full') {
      await interaction.reply({ content: `The Hold'em table is full (${res.maxPlayers} players max).`, ephemeral: true });
      return;
    }
    await interaction.reply({ content: "Could not join the Hold'em table.", ephemeral: true });
    return;
  }

  if (res.isNew) {
    await interaction.reply({ content: res.content, components: buildButtons(res.buttonState) });
    let gameMessage;
    try { gameMessage = await interaction.fetchReply(); }
    catch (err) { logger.warn('holdem adapter: fetchReply failed', err.message); return; }
    sessions.set(channelId, { channel, gameMessage, collector: null });
    setupCollector(channelId);
    try { await manager.sendCommand(ENGINE, 'tableReady', { channelId }, { channelId }); }
    catch (err) { logger.error('holdem adapter: tableReady failed', err.message); }
    return;
  }

  const replyText = res.handOpen
    ? `You joined the Hold'em table with an ante of **${(res.ante ?? bet).toLocaleString()} SGC**. You'll be dealt in next hand.`
    : `You joined the Hold'em table with an ante of **${(res.ante ?? bet).toLocaleString()} SGC**.`;
  await interaction.reply({ content: replyText, ephemeral: true });
}

async function handleLeave(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  let res;
  try {
    res = await manager.sendCommand(ENGINE, 'leave', { channelId, userId }, { channelId });
  } catch (err) {
    logger.error('holdem adapter: leave failed', err.message);
    await interaction.reply({ content: "Hold'em is unavailable right now.", ephemeral: true });
    return;
  }
  if (!res.ok) {
    await interaction.reply({ content: "You're not seated at a Hold'em table in this channel.", ephemeral: true });
    return;
  }
  await interaction.reply({
    content: res.duringHand
      ? `You left the Hold'em table. Your ante of **${(res.ante ?? 0).toLocaleString()} SGC** stays in the pot.`
      : "You left the Hold'em table.",
    ephemeral: true,
  });
}

async function handleBetCommand(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const amount = interaction.options.getInteger('amount', true);
  let res;
  try {
    res = await manager.sendCommand(ENGINE, 'bet', { channelId, userId, amount }, { channelId });
  } catch (err) {
    logger.error('holdem adapter: bet failed', err.message);
    await interaction.reply({ content: "Hold'em is unavailable right now.", ephemeral: true });
    return;
  }
  if (!res.ok) {
    if (res.reason === 'not_seated') {
      await interaction.reply({ content: "You're not seated at a Hold'em table in this channel. Use `/lumi-holdem play` to join first.", ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Could not change ante.', ephemeral: true });
    return;
  }
  await interaction.reply({ content: `Your ante for the next hand has been set to **${(res.amount ?? amount).toLocaleString()} SGC**.`, ephemeral: true });
}

async function handleRaiseCommand(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const amount = interaction.options.getInteger('amount', true);
  let res;
  try {
    res = await manager.sendCommand(ENGINE, 'raise', { channelId, userId, username, amount }, { channelId });
  } catch (err) {
    logger.error('holdem adapter: raise failed', err.message);
    await interaction.reply({ content: "Hold'em is unavailable right now.", ephemeral: true });
    return;
  }
  if (!res.ok) {
    await interaction.reply({ content: raiseFailureMessage(res, amount), ephemeral: true });
    return;
  }
  await interaction.reply({
    content: `You raised **${(res.amount ?? amount).toLocaleString()} SGC**${res.callGap > 0 ? ` (+ ${res.callGap.toLocaleString()} to call)` : ''}. Bet is now **${(res.currentBet ?? 0).toLocaleString()} SGC**.`,
    ephemeral: true,
  });
}

function raiseFailureMessage(res, fallbackAmount) {
  switch (res.reason) {
    case 'no_table':
    case 'not_seated':
      return "You're not seated at a Hold'em table in this channel.";
    case 'not_active':
      return "You're not active in a hand right now.";
    case 'not_your_turn':
      return `It's ${res.currentRef || 'someone else'}'s turn right now.`;
    case 'bad_amount':
      return 'Raise amount must be at least **1 SGC**.';
    case 'insufficient':
      return `You need **${(res.need ?? 0).toLocaleString()} SGC** to raise (${res.callGap > 0 ? `${res.callGap.toLocaleString()} to call + ` : ''}${(res.raise ?? fallbackAmount).toLocaleString()} raise) but only have **${(res.balance ?? 0).toLocaleString()} SGC**.`;
    case 'raise_failed':
      return 'Raise failed (insufficient funds).';
    default:
      return 'Could not raise.';
  }
}

// ---------------------------------------------------------------------------
// Button collector
// ---------------------------------------------------------------------------

function setupCollector(channelId) {
  const session = sessions.get(channelId);
  if (!session || !session.gameMessage) return;
  if (session.collector) {
    try { session.collector.stop('replaced'); } catch { /* ignore */ }
  }
  const collector = session.gameMessage.createMessageComponentCollector({
    filter: (b) => b.customId === 'th_peek' || b.customId === 'th_check' || b.customId === 'th_fold' || b.customId === 'th_leave' || b.customId.startsWith('th_raise_'),
  });
  session.collector = collector;
  collector.on('collect', (btn) => { void onCollect(channelId, btn); });
  collector.on('end', () => { /* worker manages real lifetime */ });
}

async function onCollect(channelId, btn) {
  try {
    const userId = btn.user.id;
    const username = btn.user.username;

    if (btn.customId === 'th_peek') {
      let res;
      try { res = await manager.sendCommand(ENGINE, 'peek', { channelId, userId }, { channelId }); }
      catch (err) { logger.error('holdem adapter: peek failed', err.message); await btn.deferUpdate().catch(() => {}); return; }
      if (!res.ok) {
        const msg = res.reason === 'not_seated' ? "You're not seated at this table."
          : res.reason === 'not_in_hand' ? 'You are seated, but not in the current hand. You will be dealt in next hand.'
          : 'Could not peek.';
        await btn.reply({ content: msg, ephemeral: true }).catch(() => {});
        return;
      }
      await btn.reply({ content: res.content, ephemeral: true }).catch(() => {});
      return;
    }

    if (btn.customId === 'th_check') {
      let res;
      try { res = await manager.sendCommand(ENGINE, 'check', { channelId, userId }, { channelId }); }
      catch (err) { logger.error('holdem adapter: check failed', err.message); await btn.deferUpdate().catch(() => {}); return; }
      if (!res.ok) {
        await btn.reply({ content: actionFailureMessage(res, 'check'), ephemeral: true }).catch(() => {});
        return;
      }
      await btn.deferUpdate().catch(() => {});
      return;
    }

    if (btn.customId === 'th_fold') {
      let res;
      try { res = await manager.sendCommand(ENGINE, 'fold', { channelId, userId }, { channelId }); }
      catch (err) { logger.error('holdem adapter: fold failed', err.message); await btn.deferUpdate().catch(() => {}); return; }
      if (!res.ok) {
        await btn.reply({ content: actionFailureMessage(res, 'fold'), ephemeral: true }).catch(() => {});
        return;
      }
      await btn.deferUpdate().catch(() => {});
      return;
    }

    if (btn.customId.startsWith('th_raise_')) {
      const amount = parseInt(btn.customId.replace('th_raise_', ''), 10);
      let res;
      try { res = await manager.sendCommand(ENGINE, 'raise', { channelId, userId, username, amount }, { channelId }); }
      catch (err) { logger.error('holdem adapter: raise failed', err.message); await btn.deferUpdate().catch(() => {}); return; }
      if (!res.ok) {
        await btn.reply({ content: raiseFailureMessage(res, amount), ephemeral: true }).catch(() => {});
        return;
      }
      await btn.deferUpdate().catch(() => {});
      return;
    }

    if (btn.customId === 'th_leave') {
      let res;
      try { res = await manager.sendCommand(ENGINE, 'leave', { channelId, userId }, { channelId }); }
      catch (err) { logger.error('holdem adapter: leave (button) failed', err.message); await btn.deferUpdate().catch(() => {}); return; }
      if (!res.ok) {
        await btn.reply({ content: "You're not seated at this table.", ephemeral: true }).catch(() => {});
        return;
      }
      await btn.reply({
        content: res.duringHand
          ? `You left the table. Your ante of **${(res.ante ?? 0).toLocaleString()} SGC** stays in the pot.`
          : "You left the Texas Hold'em table.",
        ephemeral: true,
      }).catch(() => {});
    }
  } catch (err) {
    logger.error('Holdem adapter button error:', err.message);
    await btn.deferUpdate().catch(() => {});
  }
}

function actionFailureMessage(res, kind) {
  switch (res.reason) {
    case 'no_table':
    case 'not_seated':
      return "You're not seated at this table.";
    case 'not_active':
      return "You're not active in this hand right now.";
    case 'not_your_turn':
      return `It's ${res.currentRef || 'someone else'}'s turn right now.`;
    case 'cannot_call':
      return `You need **${(res.need ?? 0).toLocaleString()} SGC** to call but only have **${(res.balance ?? 0).toLocaleString()} SGC**. Consider folding.`;
    case 'call_failed':
      return 'Call failed (insufficient funds). Consider folding.';
    default:
      return `Could not ${kind}.`;
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
      case 'render': void onRender(evt); return;
      case 'tableClosed': void onTableClosed(evt); return;
      case 'payoutFailed':
        logger.warn(`holdem adapter: payout failed user=${evt.userId} amount=${evt.amount}: ${evt.error}`);
        return;
      default: return;
    }
  });
}

async function onRender(evt) {
  const session = sessions.get(evt.channelId);
  if (!session || !session.gameMessage) return;
  try {
    await session.gameMessage.edit({ content: evt.content, components: buildButtons(evt.buttonState || {}) });
  } catch (err) {
    logger.warn('holdem adapter: render edit failed', err.message);
  }
}

async function onTableClosed(evt) {
  const session = sessions.get(evt.channelId);
  if (!session) return;
  sessions.delete(evt.channelId);
  if (session.collector) {
    try { session.collector.stop('closed'); } catch { /* ignore */ }
  }
  if (session.gameMessage) {
    try {
      await session.gameMessage.edit({ content: evt.content, components: buildButtons({ closed: true }) });
    } catch (err) {
      logger.warn('holdem adapter: tableClosed edit failed', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Settings reload
// ---------------------------------------------------------------------------

async function reloadSettings() {
  try {
    const next = {
      maxPlayers: getSetting('holdem.maxPlayers'),
      actionTimeoutMs: getSetting('holdem.actionTimeoutMs'),
      cpuActionDelayMs: getSetting('holdem.cpuActionDelayMs'),
      betweenHandsMs: getSetting('holdem.betweenHandsMs'),
    };
    try { await manager.sendCommand(ENGINE, 'setSettings', next); }
    catch { /* workers not started yet */ }
  } catch { /* DB not ready */ }
}

module.exports = { buildHoldemCommand, handleHoldemCommand, reloadSettings };
