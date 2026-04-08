const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const { buildPlayerCommands } = require('./commands');
const { config } = require('./config');
const { getRuntimeSettings, resetChatbotMemory, updateRuntimeSettings } = require('./chatbot');
const { logger } = require('./logger');

function isAdminUser(interaction) {
  if (!interaction.inGuild()) {
    return false;
  }

  if (config.adminUserIds.includes(interaction.user.id)) {
    return true;
  }

  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false;
}

function buildCommands() {
  const lumiCommands = [
    new SlashCommandBuilder()
      .setName('lumi-status')
      .setDescription('Show Lumi chatbot runtime settings.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('lumi-toggle')
      .setDescription('Enable or disable Lumi chatbot replies.')
      .addBooleanOption((option) => option
        .setName('enabled')
        .setDescription('Whether autonomous chat is enabled')
        .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('lumi-set')
      .setDescription('Update Lumi runtime controls.')
      .addNumberOption((option) => option
        .setName('reply_chance')
        .setDescription('Reply chance from 0 to 1')
        .setMinValue(0)
        .setMaxValue(1)
        .setRequired(false))
      .addIntegerOption((option) => option
        .setName('interest_threshold')
        .setDescription('Minimum heuristic score needed for an interest-triggered reply')
        .setMinValue(1)
        .setRequired(false))
      .addIntegerOption((option) => option
        .setName('cooldown_ms')
        .setDescription('Minimum milliseconds between autonomous replies per channel')
        .setMinValue(1)
        .setRequired(false))
      .addIntegerOption((option) => option
        .setName('conversation_window_ms')
        .setDescription('How long recent chat counts as the same conversation')
        .setMinValue(1000)
        .setRequired(false))
      .addIntegerOption((option) => option
        .setName('followup_cooldown_ms')
        .setDescription('Shorter cooldown used while Lumi is actively in the conversation')
        .setMinValue(1000)
        .setRequired(false))
      .addIntegerOption((option) => option
        .setName('momentum_window_ms')
        .setDescription('How long Lumi keeps momentum after joining a conversation')
        .setMinValue(1000)
        .setRequired(false))
      .addNumberOption((option) => option
        .setName('momentum_chance_boost')
        .setDescription('Extra reply chance added while momentum is active')
        .setMinValue(0)
        .setMaxValue(1)
        .setRequired(false))
      .addNumberOption((option) => option
        .setName('momentum_max_reply_chance')
        .setDescription('Ceiling for reply chance while momentum is active')
        .setMinValue(0)
        .setMaxValue(1)
        .setRequired(false))
      .addIntegerOption((option) => option
        .setName('context_messages')
        .setDescription('Sliding memory window length')
        .setMinValue(1)
        .setRequired(false))
      .addIntegerOption((option) => option
        .setName('max_response_chars')
        .setDescription('Maximum response length')
        .setMinValue(1)
        .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('lumi-channel')
      .setDescription('Manage Lumi channel whitelist.')
      .addStringOption((option) => option
        .setName('action')
        .setDescription('Add, remove, or list channel whitelist entries')
        .addChoices(
          { name: 'add', value: 'add' },
          { name: 'remove', value: 'remove' },
          { name: 'list', value: 'list' },
        )
        .setRequired(true))
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Channel to add/remove')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('lumi-reset')
      .setDescription('Reset Lumi memory. Backs up the database and starts fresh.')
      .addBooleanOption((option) => option
        .setName('confirm')
        .setDescription('Confirm you want to reset all memory')
        .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((command) => command.toJSON());

  return [...lumiCommands, ...buildPlayerCommands()];
}

function formatSettings(settings) {
  return [
    `enabled=${settings.enabled}`,
    `replyChance=${settings.replyChance}`,
    `interestThreshold=${settings.interestThreshold}`,
    `cooldownMs=${settings.cooldownMs}`,
    `conversationWindowMs=${settings.conversationWindowMs}`,
    `followupCooldownMs=${settings.followupCooldownMs}`,
    `momentumWindowMs=${settings.momentumWindowMs}`,
    `momentumChanceBoost=${settings.momentumChanceBoost}`,
    `momentumMaxReplyChance=${settings.momentumMaxReplyChance}`,
    `contextMessages=${settings.contextMessages}`,
    `maxResponseChars=${settings.maxResponseChars}`,
    `channels=${settings.channelIds.length > 0 ? settings.channelIds.join(', ') : 'none'}`,
  ].join('\n');
}

async function registerControlPlane(client) {
  if (!config.controlPlaneEnabled) {
    logger.info('Slash control plane disabled via config.');
    return;
  }

  try {
    const commands = buildCommands();
    if (config.slashGuildId) {
      const guild = await client.guilds.fetch(config.slashGuildId);
      await guild.commands.set(commands);
      logger.info(`Registered ${commands.length} slash commands for guild ${config.slashGuildId}.`);
      return;
    }

    await client.application.commands.set(commands);
    logger.info(`Registered ${commands.length} global slash commands.`);
  } catch (error) {
    logger.error('Failed to register slash control plane commands.', error.message);
  }
}

async function handleControlPlaneInteraction(interaction) {
  if (!config.controlPlaneEnabled) {
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const adminCommands = new Set(['lumi-status', 'lumi-toggle', 'lumi-set', 'lumi-channel', 'lumi-reset']);
  if (!adminCommands.has(interaction.commandName)) {
    return;
  }

  if (!isAdminUser(interaction)) {
    await interaction.reply({
      content: 'You need Manage Server permission (or ADMIN_USER_IDS override) to use Lumi control commands.',
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'lumi-status') {
    await interaction.reply({
      content: `Lumi runtime settings:\n${formatSettings(getRuntimeSettings())}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'lumi-toggle') {
    const enabled = interaction.options.getBoolean('enabled', true);
    const settings = updateRuntimeSettings({ enabled });
    await interaction.reply({
      content: `Lumi is now ${settings.enabled ? 'enabled' : 'disabled'}.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'lumi-set') {
    const patch = {};
    const replyChance = interaction.options.getNumber('reply_chance', false);
    const interestThreshold = interaction.options.getInteger('interest_threshold', false);
    const cooldownMs = interaction.options.getInteger('cooldown_ms', false);
    const conversationWindowMs = interaction.options.getInteger('conversation_window_ms', false);
    const followupCooldownMs = interaction.options.getInteger('followup_cooldown_ms', false);
    const momentumWindowMs = interaction.options.getInteger('momentum_window_ms', false);
    const momentumChanceBoost = interaction.options.getNumber('momentum_chance_boost', false);
    const momentumMaxReplyChance = interaction.options.getNumber('momentum_max_reply_chance', false);
    const contextMessages = interaction.options.getInteger('context_messages', false);
    const maxResponseChars = interaction.options.getInteger('max_response_chars', false);

    if (replyChance !== null) {
      patch.replyChance = replyChance;
    }
    if (interestThreshold !== null) {
      patch.interestThreshold = interestThreshold;
    }
    if (cooldownMs !== null) {
      patch.cooldownMs = cooldownMs;
    }
    if (conversationWindowMs !== null) {
      patch.conversationWindowMs = conversationWindowMs;
    }
    if (followupCooldownMs !== null) {
      patch.followupCooldownMs = followupCooldownMs;
    }
    if (momentumWindowMs !== null) {
      patch.momentumWindowMs = momentumWindowMs;
    }
    if (momentumChanceBoost !== null) {
      patch.momentumChanceBoost = momentumChanceBoost;
    }
    if (momentumMaxReplyChance !== null) {
      patch.momentumMaxReplyChance = momentumMaxReplyChance;
    }
    if (contextMessages !== null) {
      patch.contextMessages = contextMessages;
    }
    if (maxResponseChars !== null) {
      patch.maxResponseChars = maxResponseChars;
    }

    const settings = updateRuntimeSettings(patch);
    await interaction.reply({
      content: `Updated Lumi settings:\n${formatSettings(settings)}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'lumi-channel') {
    const action = interaction.options.getString('action', true);
    const channel = interaction.options.getChannel('channel', false);
    const current = getRuntimeSettings();

    if (action === 'list') {
      await interaction.reply({
        content: `Whitelisted channels: ${current.channelIds.length > 0 ? current.channelIds.join(', ') : 'none'}`,
        ephemeral: true,
      });
      return;
    }

    if (!channel) {
      await interaction.reply({
        content: 'You must provide a channel for add/remove actions.',
        ephemeral: true,
      });
      return;
    }

    const next = new Set(current.channelIds);
    if (action === 'add') {
      next.add(channel.id);
    } else if (action === 'remove') {
      next.delete(channel.id);
    }

    const settings = updateRuntimeSettings({ channelIds: Array.from(next) });
    await interaction.reply({
      content: `Updated channel whitelist: ${settings.channelIds.length > 0 ? settings.channelIds.join(', ') : 'none'}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'lumi-reset') {
    const confirmed = interaction.options.getBoolean('confirm', true);
    if (!confirmed) {
      await interaction.reply({
        content: 'Memory reset cancelled. Set `confirm` to True to proceed.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await resetChatbotMemory();
      await interaction.editReply({
        content: `Lumi memory has been reset. A backup was saved to \`${result.backupFile}\`.`,
      });
    } catch (error) {
      logger.error('Memory reset failed.', error.message);
      await interaction.editReply({
        content: `Memory reset failed: ${error.message}`,
      });
    }
  }
}

module.exports = {
  handleControlPlaneInteraction,
  registerControlPlane,
};
