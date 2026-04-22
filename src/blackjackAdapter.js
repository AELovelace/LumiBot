'use strict';

/**
 * Worker-backed Discord adapter for Blackjack.
 *
 * Drop-in replacement for src/blackjack.js that delegates all game logic
 * and DB calls to the blackjack worker. The adapter is responsible for:
 *   - Translating slash commands into worker commands.
 *   - Managing the persistent button-collector on the game message.
 *   - Reflecting worker-emitted events (render / tableClosed) back into
 *     Discord message edits.
 *   - Pushing panel-side settings into the worker on reload.
 *
 * Activated when both `gameWorkersEnabled` and `gameWorkersBlackjack` are
 * true. Otherwise src/blackjack.js exports its own in-process logic.
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

const ENGINE = 'blackjack';

// Long enough to outlast many normal idle cycles in the worker; the
// collector is recreated on every 'newhand' event so under steady play
// it never reaches this cap.
const COLLECTOR_IDLE_MS = 5 * 60 * 1000;

/** @type {Map<string, { gameMessage: object, collector: object|null }>} */
const sessions = new Map();

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function buildButtons(controls) {
  const mode = controls && controls.mode ? controls.mode : 'closed';

  if (mode === 'closed') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('bj_stay').setLabel('Stay').setEmoji('🛑').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId('bj_surrender').setLabel('Surrender').setEmoji('🏳️').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('bj_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
  }

  if (mode === 'pause') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('bj_stay').setLabel('Stay').setEmoji('🛑').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId('bj_surrender').setLabel('Surrender').setEmoji('🏳️').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('bj_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Secondary).setDisabled(false),
    );
  }

  // mode === 'play'
  const inactive = !controls.anyPlaying;
  const surrender = !inactive && Boolean(controls.anySurrenderable);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(inactive),
    new ButtonBuilder().setCustomId('bj_stay').setLabel('Stay').setEmoji('🛑').setStyle(ButtonStyle.Danger).setDisabled(inactive),
    new ButtonBuilder().setCustomId('bj_surrender').setLabel('Surrender').setEmoji('🏳️').setStyle(ButtonStyle.Secondary).setDisabled(inactive || !surrender),
    new ButtonBuilder().setCustomId('bj_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Secondary).setDisabled(false),
  );
}

// ---------------------------------------------------------------------------
// Slash command schema (must mirror src/blackjack.js so registration is
// stable whether the worker path or the in-process path is active).
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
// Slash handlers
// ---------------------------------------------------------------------------

async function handleBlackjackCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'play') return handlePlay(interaction);
  if (sub === 'leave') return handleLeave(interaction);
  if (sub === 'bet') return handleBet(interaction);
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

async function handlePlay(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const bet = interaction.options.getInteger('bet', true);

  let result;
  try {
    result = await manager.sendCommand(
      ENGINE,
      'play',
      { channelId, userId, username, bet },
      { channelId },
    );
  } catch (err) {
    logger.error('blackjack adapter: play failed', err.message);
    await interaction.reply({ content: 'Blackjack is unavailable right now.', ephemeral: true });
    return;
  }

  if (!result.ok) {
    const message = playFailureMessage(result, bet);
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const components = [buildButtons(result.controls)];

  if (result.isNew) {
    await interaction.reply({ content: result.content, components });
    let gameMessage;
    try {
      gameMessage = await interaction.fetchReply();
    } catch (err) {
      logger.warn('blackjack adapter: fetchReply failed', err.message);
      return;
    }
    sessions.set(channelId, { gameMessage, collector: null });
    setupCollector(channelId);
    return;
  }

  await interaction.reply({
    content: `You joined the table! Bet: **${bet.toLocaleString()} SGC**`,
    ephemeral: true,
  });
  await editGameMessage(channelId, result.content, components);
}

function playFailureMessage(result, bet) {
  switch (result.reason) {
    case 'between_hands':
      return '🃏 The hand just ended — a new one is being dealt shortly!';
    case 'already_playing':
      return "You're already playing at this table!";
    case 'full':
      return `The table is full (${result.max} players max).`;
    case 'insufficient':
      return `❌ You only have **${(result.balance ?? 0).toLocaleString()} SGC** but tried to bet **${(result.bet ?? bet).toLocaleString()}**.`;
    case 'bet_failed':
      return `❌ ${result.error || 'Bet failed.'}`;
    default:
      return 'Could not join the blackjack table.';
  }
}

async function handleLeave(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  let result;
  try {
    result = await manager.sendCommand(ENGINE, 'leave', { channelId, userId }, { channelId });
  } catch (err) {
    logger.error('blackjack adapter: leave failed', err.message);
    await interaction.reply({ content: 'Blackjack is unavailable right now.', ephemeral: true });
    return;
  }

  if (!result.ok) {
    await interaction.reply({
      content: "You're not at a blackjack table in this channel.",
      ephemeral: true,
    });
    return;
  }

  const text = result.duringHand
    ? `You left the blackjack table. Your bet of **${(result.lostBet ?? 0).toLocaleString()} SGC** is forfeited.`
    : 'You left the blackjack table.';
  await interaction.reply({ content: text, ephemeral: true });

  if (result.closed) {
    // tableClosed event will edit the message; just drop the local session.
    return;
  }
  if (result.willResolve) return;

  if (result.content) {
    await editGameMessage(channelId, result.content, [buildButtons(result.controls)]);
  }
}

async function handleBet(interaction) {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const amount = interaction.options.getInteger('amount', true);

  let result;
  try {
    result = await manager.sendCommand(
      ENGINE,
      'setBet',
      { channelId, userId, amount },
      { channelId },
    );
  } catch (err) {
    logger.error('blackjack adapter: setBet failed', err.message);
    await interaction.reply({ content: 'Blackjack is unavailable right now.', ephemeral: true });
    return;
  }

  if (!result.ok) {
    await interaction.reply({
      content: "You're not at a blackjack table in this channel. Use `/lumi-blackjack play` to join first.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `Your bet for the next hand has been set to **${amount.toLocaleString()} SGC**.`,
    ephemeral: true,
  });
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

function setupCollector(channelId) {
  const session = sessions.get(channelId);
  if (!session || !session.gameMessage) return;

  if (session.collector) {
    try { session.collector.stop('replaced'); } catch { /* ignore */ }
    session.collector = null;
  }

  const collector = session.gameMessage.createMessageComponentCollector({
    filter: (i) => ['bj_hit', 'bj_stay', 'bj_surrender', 'bj_leave'].includes(i.customId),
    idle: COLLECTOR_IDLE_MS,
  });
  session.collector = collector;

  collector.on('collect', (btn) => { void onCollect(channelId, btn); });
  collector.on('end', () => { /* worker manages real lifetime */ });
}

async function onCollect(channelId, btn) {
  const userId = btn.user.id;
  let cmd = null;
  if (btn.customId === 'bj_hit') cmd = 'hit';
  else if (btn.customId === 'bj_stay') cmd = 'stay';
  else if (btn.customId === 'bj_surrender') cmd = 'surrender';
  else if (btn.customId === 'bj_leave') cmd = 'leave';
  if (!cmd) {
    await btn.deferUpdate().catch(() => {});
    return;
  }

  let result;
  try {
    result = await manager.sendCommand(ENGINE, cmd, { channelId, userId }, { channelId });
  } catch (err) {
    logger.error('blackjack adapter: worker command failed', err.message);
    await btn.deferUpdate().catch(() => {});
    return;
  }

  if (!result.ok) {
    const text = collectFailureMessage(cmd, result.reason);
    if (text) {
      await btn.reply({ content: text, ephemeral: true }).catch(() => {});
    } else {
      await btn.deferUpdate().catch(() => {});
    }
    return;
  }

  if (cmd === 'leave') {
    const text = result.duringHand
      ? `You left the table. Your bet of **${(result.lostBet ?? 0).toLocaleString()} SGC** is forfeited.`
      : 'You left the blackjack table.';
    await btn.reply({ content: text, ephemeral: true }).catch(() => {});
    if (result.closed) return;            // tableClosed event handles the edit
    if (result.willResolve) return;       // worker will emit final render
    if (result.content) {
      await editGameMessage(channelId, result.content, [buildButtons(result.controls)]);
    }
    return;
  }

  if (result.willResolve) {
    // Worker is about to emit a finalresults render; ack the button.
    await btn.deferUpdate().catch(() => {});
    return;
  }

  if (result.content) {
    try {
      await btn.update({
        content: result.content,
        components: [buildButtons(result.controls)],
      });
    } catch (err) {
      logger.warn('blackjack adapter: btn.update failed', err.message);
      await btn.deferUpdate().catch(() => {});
    }
    return;
  }

  await btn.deferUpdate().catch(() => {});
}

function collectFailureMessage(cmd, reason) {
  if (reason === 'no_table') return 'There is no active table here.';
  if (reason === 'cannot_surrender') return 'You can only surrender on your first two cards.';
  if (reason === 'not_playing') {
    return cmd === 'leave'
      ? "You're not at this table."
      : "You're not playing at this table or your hand is already done.";
  }
  return null;        // resolving / unknown: silently defer
}

async function editGameMessage(channelId, content, components) {
  const session = sessions.get(channelId);
  if (!session || !session.gameMessage) return;
  try {
    await session.gameMessage.edit({ content, components });
  } catch (err) {
    logger.warn('blackjack adapter: edit failed', err.message);
  }
}

// ---------------------------------------------------------------------------
// Worker -> main events
// ---------------------------------------------------------------------------

manager.onEngineEvent(ENGINE, (evt) => {
  if (!evt || typeof evt.channelId !== 'string') return;
  if (evt.name === 'render') {
    void onRenderEvent(evt);
    return;
  }
  if (evt.name === 'tableClosed') {
    void onTableClosed(evt);
    return;
  }
  if (evt.name === 'payoutFailed') {
    logger.warn(`blackjack adapter: payout failed for ${evt.userId} (+${evt.amount} SGC) — ${evt.error}`);
    return;
  }
});

async function onRenderEvent(evt) {
  await editGameMessage(evt.channelId, evt.content, [buildButtons(evt.controls)]);
  if (evt.action === 'newhand') {
    setupCollector(evt.channelId);
  }
}

async function onTableClosed(evt) {
  await editGameMessage(evt.channelId, evt.content, [buildButtons(evt.controls)]);
  const session = sessions.get(evt.channelId);
  if (session && session.collector) {
    try { session.collector.stop('tableClosed'); } catch { /* ignore */ }
  }
  sessions.delete(evt.channelId);
}

// ---------------------------------------------------------------------------
// Settings sync
// ---------------------------------------------------------------------------

function reloadSettings() {
  let next;
  try {
    next = {
      numDecks: getSetting('blackjack.numDecks'),
      handsBeforeShuffle: getSetting('blackjack.handsBeforeShuffle'),
      maxPlayers: getSetting('blackjack.maxPlayers'),
      idleTimeoutMs: getSetting('blackjack.idleTimeoutMs'),
      betweenHandsMs: getSetting('blackjack.betweenHandsMs'),
    };
  } catch {
    return;
  }
  manager.sendCommand(ENGINE, 'setSettings', next).catch((err) => {
    // Workers may not be started yet during early boot reloads; index.js
    // calls reloadSettings again after manager.start().
    logger.debug?.('blackjack adapter: setSettings deferred', err.message);
  });
}

module.exports = {
  buildBlackjackCommand,
  handleBlackjackCommand,
  reloadSettings,
};
