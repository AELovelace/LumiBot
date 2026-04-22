'use strict';

/**
 * Worker-backed Discord adapter for Pachinko.
 *
 * Drop-in replacement for src/pachinko.js when both gameWorkersEnabled
 * and gameWorkersPachinko are true. The adapter:
 *   - Handles the slash command, sends the initial reply
 *   - Captures the message returned by fetchReply()
 *   - Listens for 'frame' / 'finalresult' worker events and edits the
 *     captured message accordingly
 */

const { SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const { manager } = require('./workers/workerManager');
const { getSetting } = require('./panelSettings');

const ENGINE = 'pachinko';

/** @type {Map<string, { message: object, header: string }>} */
const pendingDrops = new Map();

let listenerInstalled = false;

function installListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  manager.onEngineEvent(ENGINE, (evt) => {
    if (!evt || typeof evt.channelId !== 'string') return;
    if (evt.name === 'frame') {
      const ctx = pendingDrops.get(evt.channelId);
      if (!ctx) return;
      ctx.message.edit(evt.content).catch((err) => logger.warn('pachinko adapter: edit failed', err.message));
      return;
    }
    if (evt.name === 'finalresult') {
      const ctx = pendingDrops.get(evt.channelId);
      if (!ctx) return;
      pendingDrops.delete(evt.channelId);
      ctx.message.channel.send(evt.resultText).catch((err) => logger.warn('pachinko adapter: followup send failed', err.message));
      logger.info(`Pachinko: peg=${evt.peg} landed=${evt.landedPeg} mult=${evt.multiplier}× payout=${evt.payout}`);
      return;
    }
    if (evt.name === 'payoutFailed') {
      logger.error(`pachinko adapter: payout failed for ${evt.userId}: ${evt.error}`);
    }
  });
}

function buildPachinkoCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-pachinko')
    .setDescription('Drop a pachinko ball and bet on the landing peg!')
    .addIntegerOption((opt) => opt
      .setName('peg')
      .setDescription('Peg number you think the ball will land on (1–10)')
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(true))
    .addIntegerOption((opt) => opt
      .setName('bet')
      .setDescription('Amount of SGC to wager')
      .setMinValue(1)
      .setRequired(true))
    .toJSON();
}

async function handlePachinkoCommand(interaction) {
  installListener();
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const peg = interaction.options.getInteger('peg', true);
  const bet = interaction.options.getInteger('bet', true);
  const channelId = interaction.channelId;

  let result;
  try {
    result = await manager.sendCommand(ENGINE, 'drop', { channelId, userId, username, peg, bet }, { channelId });
  } catch (err) {
    logger.error('pachinko adapter: drop failed', err.message);
    await interaction.reply({ content: 'Pachinko is unavailable right now.', ephemeral: true });
    return;
  }

  if (!result.ok) {
    const text = dropFailureMessage(result, bet);
    await interaction.reply({ content: text, ephemeral: true });
    return;
  }

  await interaction.reply(`${result.initial.header}\n${result.initial.firstRow}`);
  let message;
  try { message = await interaction.fetchReply(); }
  catch (err) {
    logger.warn('pachinko adapter: fetchReply failed', err.message);
    return;
  }
  pendingDrops.set(channelId, { message, header: result.initial.header });
}

function dropFailureMessage(result, bet) {
  switch (result.reason) {
    case 'busy':
      return '🎰 A pachinko game is already running in this channel! Wait for it to finish.';
    case 'insufficient':
      return `❌ You only have **${(result.balance ?? 0).toLocaleString()} SGC** but tried to bet **${(result.bet ?? bet).toLocaleString()}**.`;
    case 'bet_failed':
      return `❌ ${result.error || 'Bet failed.'}`;
    case 'bad_peg':
      return '❌ Invalid peg.';
    case 'bad_bet':
      return '❌ Invalid bet amount.';
    default:
      return 'Could not start the pachinko drop.';
  }
}

async function reloadSettings() {
  try {
    const next = {
      gridWidth: getSetting('pachinko.gridWidth'),
      gridRows: getSetting('pachinko.gridRows'),
      rowDelayMs: getSetting('pachinko.rowDelay'),
    };
    try {
      await manager.sendCommand(ENGINE, 'setSettings', next);
    } catch { /* workers not started yet */ }
  } catch { /* DB not ready */ }
}

module.exports = { buildPachinkoCommand, handlePachinkoCommand, reloadSettings };
