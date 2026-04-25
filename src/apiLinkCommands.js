'use strict';

/**
 * SadGirlCoin External API — user-facing slash commands.
 *
 * /lumi-link app:<choice>     -> issue a one-time code to redeem in an external app
 * /lumi-link list             -> show your active app links + recent api transactions
 * /lumi-link revoke app:<id>  -> revoke an app's access to your account
 */

const { SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const { config } = require('./config');
const {
  listApiApps,
  createLinkCode,
  listLinksForDiscordUser,
  revokeLinkByDiscord,
  apiUserTransactions,
  getLinkByDiscord,
  getApiApp,
} = require('./apiKeyStore');

function resolveAppFromInput(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) {
    return null;
  }

  // Fast path when an app id is provided.
  const byId = getApiApp(input);
  if (byId) {
    return byId;
  }

  // Fall back to case-insensitive name match for user-friendly command input.
  const apps = listApiApps({ includeDisabled: true });
  logger.debug(`resolveAppFromInput: found ${apps.length} total apps, searching for "${input}"`);
  if (apps.length === 0) {
    logger.warn(`resolveAppFromInput: no apps registered in the system`);
  }
  const normalized = input.toLowerCase();
  const match = apps.find((app) => String(app.name || '').trim().toLowerCase() === normalized);
  if (!match) {
    logger.debug(`resolveAppFromInput: no match for "${input}". Available apps: ${apps.map(a => `${a.name}(${a.id})`).join(', ')}`);
  }
  return match || null;
}

function buildApiLinkCommand() {
  const cmd = new SlashCommandBuilder()
    .setName('lumi-link')
    .setDescription('Link your SadGirlCoin account to external apps (Minecraft, sister bots, etc.).')
    .addSubcommand((sub) => {
      const o = sub
        .setName('app')
        .setDescription('Generate a one-time code to link your account to an external app.')
        .addStringOption((opt) => opt
          .setName('app')
          .setDescription('External app id or name (example: app_abc123 or SadBot)')
          .setRequired(true));
      return o;
    })
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('Show the apps you have linked your SadGirlCoin account to.'))
    .addSubcommand((sub) => {
      const o = sub
        .setName('revoke')
        .setDescription('Revoke an app\'s access to charge or read your SadGirlCoin balance.')
        .addStringOption((opt) => opt
          .setName('app')
          .setDescription('External app id or name (example: app_abc123 or SadBot)')
          .setRequired(true));
      return o;
    });

  return [cmd.toJSON()];
}

async function handleApiLinkCommand(interaction) {
  try {
    const sub = interaction.options.getSubcommand();
    logger.debug(`Handling lumi-link subcommand: ${sub} by user ${interaction.user.id}`);
    switch (sub) {
      case 'app':    return handleLinkApp(interaction);
      case 'list':   return handleLinkList(interaction);
      case 'revoke': return handleLinkRevoke(interaction);
      default:
        await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    }
  } catch (err) {
    logger.error(`lumi-link command error for user ${interaction.user.id}: ${err.message}`);
    throw err;
  }
}

async function handleLinkApp(interaction) {
  try {
    const appInput = interaction.options.getString('app', true);
    logger.debug(`lumi-link app: user=${interaction.user.id}, appInput=${appInput}`);
    const app = resolveAppFromInput(appInput);
    
    // Check if there are ANY apps registered
    const allApps = listApiApps({ includeDisabled: true });
    if (allApps.length === 0) {
      logger.warn(`lumi-link app: No apps registered in the system`);
      await interaction.reply({ 
        content: '❌ No external apps have been registered yet. Bot admin needs to add apps via the control panel.', 
        ephemeral: true 
      });
      return;
    }
    
    if (!app) {
      logger.warn(`lumi-link app: app not found for input "${appInput}"`);
      const appList = allApps.filter(a => !a.disabledAt).map(a => `\`${a.name}\``).join(', ');
      await interaction.reply({ 
        content: `That app is not found. Available apps: ${appList || '(none enabled)'}`, 
        ephemeral: true 
      });
      return;
    }
    if (app.disabledAt) {
      logger.warn(`lumi-link app: app "${app.id}" is disabled`);
      await interaction.reply({ content: 'That app has been disabled.', ephemeral: true });
      return;
    }

    // If already linked, tell the user.
    const existing = getLinkByDiscord(app.id, interaction.user.id);
    if (existing) {
      logger.debug(`lumi-link app: user already linked to "${app.id}"`);
      await interaction.reply({
        content: `You're already linked to **${app.name}** (external id \`${existing.external_id}\`). Use \`/lumi-link revoke\` to unlink first.`,
        ephemeral: true,
      });
      return;
    }

    let code;
    try {
      logger.debug(`lumi-link app: creating link code for user ${interaction.user.id} app ${app.id}`);
      code = createLinkCode(app.id, interaction.user.id, config.sgcApiLinkCodeTtlMs);
      logger.info(`lumi-link app: link code created for user ${interaction.user.id} app ${app.id}`);
    } catch (err) {
      logger.error(`createLinkCode failed for user ${interaction.user.id} app ${app.id}: ${err.message}`, err.stack);
      await interaction.reply({ content: `Could not create link code: ${err.message}`, ephemeral: true });
      return;
    }

    const minutes = Math.max(1, Math.round((config.sgcApiLinkCodeTtlMs || 600_000) / 60_000));
    const lines = [
      `**Link code for ${app.name}:** \`${code.code}\``,
      `Expires in ~${minutes} minutes.`,
      '',
      `Paste this code into **${app.name}** (e.g. \`/sgc link ${code.code}\` in-game, or wherever the app prompts).`,
      '',
      `⚠️ Once linked, **${app.name}** can debit your SadGirlCoin balance freely until you revoke. Only redeem this in the actual app you trust.`,
    ];

    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
  } catch (err) {
    logger.error(`handleLinkApp error for user ${interaction.user.id}: ${err.message}`, err.stack);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }).catch(() => {});
    }
    throw err;
  }
}

async function handleLinkList(interaction) {
  const links = listLinksForDiscordUser(interaction.user.id);
  if (!links.length) {
    await interaction.reply({ content: 'You have no active app links.', ephemeral: true });
    return;
  }

  const blocks = [];
  blocks.push(`**Linked apps (${links.length}):**`);
  for (const l of links) {
    const recent = apiUserTransactions({
      app: { id: l.app_id, treasuryUserId: '' },
      externalId: l.external_id,
      limit: 5,
    });
    const txnSummary = recent && recent.transactions.length
      ? recent.transactions.map((t) => {
        const sign = t.from_user_id === interaction.user.id ? '-' : '+';
        return `  • ${sign}${t.amount} SGC \`${t.type}\` ${t.created_at}`;
      }).join('\n')
      : '  • (no recent api activity)';
    blocks.push(
      `• **${l.app_name}** \`${l.app_id}\` — external id: \`${l.external_id}\`${l.external_name ? ` (${l.external_name})` : ''}\n${txnSummary}`,
    );
  }
  blocks.push('');
  blocks.push('Revoke with `/lumi-link revoke app:<name>`.');

  await interaction.reply({ content: blocks.join('\n').slice(0, 1900), ephemeral: true });
}

async function handleLinkRevoke(interaction) {
  const appInput = interaction.options.getString('app', true);
  const app = resolveAppFromInput(appInput);
  if (!app) {
    await interaction.reply({ content: 'Unknown app.', ephemeral: true });
    return;
  }
  const ok = revokeLinkByDiscord(app.id, interaction.user.id);
  if (!ok) {
    await interaction.reply({ content: `You weren't linked to **${app.name}**.`, ephemeral: true });
    return;
  }
  await interaction.reply({
    content: `Revoked **${app.name}**. It can no longer charge or read your SadGirlCoin balance.`,
    ephemeral: true,
  });
}

module.exports = {
  buildApiLinkCommand,
  handleApiLinkCommand,
};
