const {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} = require('discord.js');

const { buildGlobalCommands: buildUserCommands } = require('./commands');
const { buildEconomyCommands } = require('./sadgirlEconomyCommands');
const { buildApiLinkCommand } = require('./apiLinkCommands');
const { config } = require('./config');
const { getRuntimeSettings, resetChatbotMemory, updateRuntimeSettings } = require('./chatbot');
const { logger } = require('./logger');
const { activeVoiceUsers, cleanupInvalidPersistedSessions, getVcRewardProgress } = require('./vcRewards');
const { getBigBusinessBalance } = require('./sadgirlEconomyStore');
const { matchPayout } = require('./bigBusiness');
const { getGuildConfig, getBigBusinessUserId } = require('./guildConfig');

function isAdminUser(interaction) {
  if (!interaction.inGuild()) {
    return false;
  }

  if (config.adminUserIds.includes(interaction.user.id)) {
    return true;
  }

  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false;
}

function buildAdminCommands() {
  const adminCommands = [
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
    new SlashCommandBuilder()
      .setName('lumi-bigbusinessdebug')
      .setDescription('Debug: show VC participants and test Big Business matching.')
      .addBooleanOption((option) => option
        .setName('simulate')
        .setDescription('Simulate a 15 SGC VC match for yourself')
        .setRequired(false))
      .addBooleanOption((option) => option
        .setName('cleanup_invalid_sessions')
        .setDescription('Purge persisted VC sessions from unconfigured/disabled guilds')
        .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('lumi-reactionroles-debug')
      .setDescription('Debug reaction-role config, permissions, and role hierarchy for this guild.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((command) => command.toJSON());

  return adminCommands;
}

function buildRegisteredGlobalCommands() {
  return [...buildUserCommands(), ...buildEconomyCommands(), ...buildApiLinkCommand()];
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

function parseSlashGuildIds(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function registerControlPlane(client) {
  if (!config.controlPlaneEnabled) {
    logger.info('Slash control plane disabled via config.');
    return;
  }

  try {
    // Player & economy commands are always registered globally so games
    // and bank work in every server the bot is in.
    const globalCommands = buildRegisteredGlobalCommands();
    const adminCommands = buildAdminCommands();
    const allGlobalCommands = [...globalCommands, ...adminCommands];

    const guildIds = parseSlashGuildIds(config.slashGuildId);
    for (const guildId of guildIds) {
      try {
        // Admin commands stay guild-scoped for fast updates
        const guild = await client.guilds.fetch(guildId);
        await guild.commands.set([...adminCommands, ...globalCommands]);
        logger.info(`Registered ${adminCommands.length} admin commands for guild ${guildId}.`);
      } catch (error) {
        logger.warn(`Failed to register guild-scoped admin commands for guild ${guildId}.`, error.message);
      }
    }

    // Register all commands globally so admin/debug commands are available
    // even outside SLASH_GUILD_ID.
    await client.application.commands.set(allGlobalCommands);
    logger.info(`Registered ${allGlobalCommands.length} global slash commands (including admin).`);
  } catch (error) {
    logger.error('Failed to register slash commands.', error.message);
  }
}

async function handleControlPlaneInteraction(interaction) {
  if (!config.controlPlaneEnabled) {
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const adminCommands = new Set(['lumi-status', 'lumi-toggle', 'lumi-set', 'lumi-channel', 'lumi-reset', 'lumi-bigbusinessdebug', 'lumi-reactionroles-debug']);
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

  if (interaction.commandName === 'lumi-bigbusinessdebug') {
    await interaction.deferReply({ ephemeral: true });

    try {
      const now = Date.now();
      const guildId = interaction.guildId;
      const guildCfg = getGuildConfig(guildId);
      const businessName = guildCfg?.bigBusinessName || 'Big Business Inc';
      const bigBusinessUserId = getBigBusinessUserId(guildId);
      const balance = getBigBusinessBalance(bigBusinessUserId);

      // Build VC participants report (filter to this guild)
      const entries = [];
      let totalPendingCoins = 0;

      for (const [userId, entry] of activeVoiceUsers) {
        if (entry.guildId && entry.guildId !== guildId) continue;
        const progress = getVcRewardProgress(entry, now);
        const hours = Math.floor(progress.rewardSeconds / 3600);
        const minutes = Math.floor((progress.rewardSeconds % 3600) / 60);
        const pendingCoins = progress.pendingCoins;
        totalPendingCoins += pendingCoins;
        entries.push(
          `• **${entry.username || userId}** — ${hours}h ${minutes}m toward payout → **${pendingCoins} SGC** pending`
        );
      }

      const vcReport = entries.length > 0
        ? entries.join('\n')
        : '_No users currently in voice channels._';

      let simulateResult = '';
      const simulate = interaction.options.getBoolean('simulate', false);
      if (simulate) {
        await matchPayout(interaction.user.username, 15, 'vc', guildId);
        simulateResult = `\n\n✅ **Simulation complete** — triggered a 15 SGC VC match for you via ${businessName}. Check the announcement channel.`;
      }

      let cleanupResult = '';
      const cleanupInvalid = interaction.options.getBoolean('cleanup_invalid_sessions', false);
      if (cleanupInvalid) {
        const result = cleanupInvalidPersistedSessions();
        cleanupResult = `\n\n🧹 **Cleanup complete** — removed **${result.removed}** invalid persisted VC session(s) out of **${result.scanned}** scanned.`;
      }

      await interaction.editReply({
        content: [
          `🏢 **${businessName} — Debug Report**`,
          '',
          `🏦 **Balance:** ${balance.toLocaleString()} SGC`,
          `👥 **VC Participants (${entries.length}):**`,
          vcReport,
          '',
          `💰 **Total pending VC payout:** ${totalPendingCoins} SGC (matched 1:1 by ${businessName})`,
          simulateResult,
          cleanupResult,
        ].join('\n'),
      });
    } catch (error) {
      logger.error('Big Business debug command failed.', error.message);
      await interaction.editReply({ content: `Debug failed: ${error.message}` });
    }
  }

  if (interaction.commandName === 'lumi-reactionroles-debug') {
    await interaction.deferReply({ ephemeral: true });

    try {
      if (!interaction.inGuild() || !interaction.guildId) {
        await interaction.editReply('This command must be run inside a guild.');
        return;
      }

      const guild = interaction.guild;
      const guildCfg = getGuildConfig(interaction.guildId);
      if (!guildCfg) {
        await interaction.editReply('❌ No guild config found. Add/configure this guild in the web panel first.');
        return;
      }

      const lines = [];
      lines.push(`🧪 **Reaction Roles Debug — ${guild.name}**`);
      lines.push('');
      lines.push(`Guild config: ${guildCfg.enabled ? 'enabled' : 'disabled'}`);
      lines.push(`Configured message ID: ${guildCfg.reactionRoleMessageId || 'none'}`);
      lines.push(`Configured assignments: ${Array.isArray(guildCfg.reactionRoleAssignments) ? guildCfg.reactionRoleAssignments.length : 0}`);

      const me = guild.members.me || await guild.members.fetchMe();
      const guildPerms = me.permissions;
      const neededGuildPerms = [
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ViewChannel,
      ];
      const missingGuildPerms = neededGuildPerms.filter((perm) => !guildPerms.has(perm));

      lines.push('');
      if (missingGuildPerms.length > 0) {
        const names = missingGuildPerms.map((perm) => new PermissionsBitField(perm).toArray().join(', ')).join(', ');
        lines.push(`❌ Missing guild permissions: ${names}`);
      } else {
        lines.push('✅ Core guild permissions look good (Manage Roles, Add Reactions, Read Message History, View Channel).');
      }

      let targetChannel = null;
      let targetMessage = null;
      const configuredMessageId = String(guildCfg.reactionRoleMessageId || '').trim();

      if (!configuredMessageId) {
        lines.push('❌ No reaction role message ID configured.');
      } else {
        const channels = await guild.channels.fetch();
        for (const channel of channels.values()) {
          if (!channel || !channel.isTextBased() || typeof channel.messages?.fetch !== 'function') continue;
          try {
            const msg = await channel.messages.fetch(configuredMessageId);
            if (msg) {
              targetChannel = channel;
              targetMessage = msg;
              break;
            }
          } catch {
            // keep searching
          }
        }

        if (!targetMessage) {
          lines.push('❌ Could not find the configured reaction-role message in any readable text channel.');
          lines.push('   Ensure the message ID is correct and Lumi can View Channel + Read Message History there.');
        } else {
          lines.push(`✅ Found message in #${targetChannel.name} (${targetChannel.id}).`);
          const channelPerms = targetChannel.permissionsFor(me);
          const missingChannelPerms = neededGuildPerms.filter((perm) => !channelPerms?.has(perm));
          if (missingChannelPerms.length > 0) {
            const names = missingChannelPerms.map((perm) => new PermissionsBitField(perm).toArray().join(', ')).join(', ');
            lines.push(`❌ Missing channel permissions in #${targetChannel.name}: ${names}`);
          } else {
            lines.push(`✅ Channel permissions in #${targetChannel.name} look good.`);
          }
        }
      }

      const assignments = Array.isArray(guildCfg.reactionRoleAssignments) ? guildCfg.reactionRoleAssignments : [];
      if (assignments.length === 0) {
        lines.push('❌ No emoji→role assignments configured.');
      } else {
        let okCount = 0;
        let badCount = 0;
        lines.push('');
        lines.push('Assignment checks:');
        for (const assignment of assignments) {
          const roleId = String(assignment.roleId || '');
          const emojiLabel = assignment.emojiLabel || assignment.emojiKey || 'unknown emoji';
          const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
          if (!role) {
            badCount += 1;
            lines.push(`- ❌ ${emojiLabel} → role ${roleId} not found in this guild.`);
            continue;
          }

          if (!role.editable) {
            badCount += 1;
            lines.push(`- ❌ ${emojiLabel} → @${role.name} is not editable by Lumi (move Lumi role above it).`);
            continue;
          }

          okCount += 1;
          lines.push(`- ✅ ${emojiLabel} → @${role.name}`);
        }
        lines.push(`Summary: ${okCount} OK, ${badCount} failing assignment(s).`);
      }

      if (targetMessage && assignments.length > 0) {
        lines.push('');
        lines.push('Tip: React to that exact message from a non-bot account after saving web panel config.');
      }

      await interaction.editReply(lines.join('\n').slice(0, 3900));
    } catch (error) {
      logger.error('Reaction role debug command failed.', error.message);
      await interaction.editReply(`Reaction role debug failed: ${error.message}`);
    }
  }
}

module.exports = {
  handleControlPlaneInteraction,
  registerControlPlane,
};
