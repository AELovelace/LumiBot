/**
 * SadGirlCoin Economy Commands — slash command definitions and handlers.
 *
 * /lumi-bank              Show your balance + top 10
 * /lumi-bank send         Transfer SGC to another user (1% fee; 50% on lotto day)
 * /lumi-bank withdraw     Central bank withdrawal (owner only)
 * /lumi-bank give          Give SGC to a user (admin only)
 * /lumi-bank take          Remove SGC from a user (admin only)
 * /lumi-bank raffle       Buy a yearly raffle ticket (50 SGC)
 * /lumi-bets list         Show open LumiBet markets
 * /lumi-bets buy          Buy a position on a market
 * /lumi-bets create       Create a new prediction market (anyone — needs 3 star reacts to go live)
 * /lumi-bets resolve      Resolve a market (economy admins + owner)
 */

const { SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const { getSetting } = require('./panelSettings');
const { getGuildConfig } = require('./guildConfig');

let ECONOMY_ADMIN_ROLE_ID = '901304988083572756';
let FALLBACK_ARCHIVE_CHANNEL_ID = '1494931183455436870';

const {
  BANK_OWNER_ID,
  DOLL_STREET_USER_ID,
  TAYS_TOBACCO_USER_ID,
  TOUHOU_MGMT_USER_ID,
  getBalance,
  getCentralBankBalance,
  getDollStreetBalance,
  getMomijiCasinoBalance,
  getTopHolders,
  transferCoins,
  withdrawCentralBank,
  ensureAccount,
  buyYearlyRaffleTicket,
  isLottoDay,
  getTransferFeeRate,
  createMarket,
  setMarketMessage,
  getOpenMarkets,
  getMarket,
  getMarketOptions,
  isYesNoMarket,
  getPendingMarkets,
  buyStockPosition,
  resolveMarket,
  adjustBalance,
} = require('./sadgirlEconomyStore');

/**
 * Check whether a guild member is the bank owner or has the economy admin role.
 * Does NOT grant Central Bank withdraw access.
 */
function isEconomyAdmin(interaction) {
  if (interaction.user.id === BANK_OWNER_ID) return true;
  return interaction.member?.roles?.cache?.has(ECONOMY_ADMIN_ROLE_ID) ?? false;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

function buildEconomyCommands() {
  return [
    new SlashCommandBuilder()
      .setName('lumi-bank')
      .setDescription('SadGirlCoin banking — check balance, send coins, buy raffle tickets.')
      .addSubcommand((sub) => sub
        .setName('balance')
        .setDescription('Check your SadGirlCoin balance and see the top 10 holders.'))
      .addSubcommand((sub) => sub
        .setName('send')
        .setDescription('Send SadGirlCoin to another member.')
        .addUserOption((opt) => opt.setName('user').setDescription('Recipient').setRequired(true))
        .addIntegerOption((opt) => opt.setName('amount').setDescription('Amount of SGC to send').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('Optional note').setRequired(false)))
      .addSubcommand((sub) => sub
        .setName('withdraw')
        .setDescription('Withdraw from the Central Bank (owner only).')
        .addUserOption((opt) => opt.setName('user').setDescription('Recipient').setRequired(true))
        .addIntegerOption((opt) => opt.setName('amount').setDescription('Amount to withdraw').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('Optional note').setRequired(false)))
      .addSubcommand((sub) => sub
        .setName('raffle')
        .setDescription('Buy a yearly raffle ticket for 50 SGC.'))
      .addSubcommand((sub) => sub
        .setName('give')
        .setDescription('Give SGC to a user (admin only).')
        .addUserOption((opt) => opt.setName('user').setDescription('User to give coins to').setRequired(true))
        .addIntegerOption((opt) => opt.setName('amount').setDescription('Amount of SGC to give').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('Optional note').setRequired(false)))
      .addSubcommand((sub) => sub
        .setName('take')
        .setDescription('Remove SGC from a user (admin only).')
        .addUserOption((opt) => opt.setName('user').setDescription('User to take coins from').setRequired(true))
        .addIntegerOption((opt) => opt.setName('amount').setDescription('Amount of SGC to remove').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('Optional note').setRequired(false))),

    new SlashCommandBuilder()
      .setName('lumi-bets')
      .setDescription('LumiBets — invest SadGirlCoin on prediction markets.')
      .addSubcommand((sub) => sub
        .setName('list')
        .setDescription('Show all open LumiStock markets.'))
      .addSubcommand((sub) => sub
        .setName('buy')
        .setDescription('Buy a position on a market.')
        .addIntegerOption((opt) => opt.setName('market').setDescription('Market ID').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt
          .setName('side')
          .setDescription('Your prediction (option name or number)')
          .setRequired(true))
        .addIntegerOption((opt) => opt.setName('amount').setDescription('SGC to invest').setMinValue(1).setRequired(true)))
      .addSubcommand((sub) => sub
        .setName('create')
        .setDescription('Propose a new prediction market (needs 3 ⭐ reacts to go live).')
        .addStringOption((opt) => opt.setName('title').setDescription('Market question/title').setRequired(true))
        .addStringOption((opt) => opt.setName('description').setDescription('Extra details about the market').setRequired(false))
        .addStringOption((opt) => opt.setName('options').setDescription('Comma-separated options (2-5). Omit for Yes/No market.').setRequired(false)))
      .addSubcommand((sub) => sub
        .setName('pending')
        .setDescription('Show markets waiting for star-react activation.'))
      .addSubcommand((sub) => sub
        .setName('resolve')
        .setDescription('Resolve a market and split the pool among winners (admin only).')
        .addIntegerOption((opt) => opt.setName('market').setDescription('Market ID').setMinValue(1).setRequired(true))
        .addStringOption((opt) => opt
          .setName('outcome')
          .setDescription('Winning option (name or number)')
          .setRequired(true))),
  ].map((cmd) => cmd.toJSON());
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleBankCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'balance':
      return handleBankBalance(interaction);
    case 'send':
      return handleBankSend(interaction);
    case 'withdraw':
      return handleBankWithdraw(interaction);
    case 'raffle':
      return handleBankRaffle(interaction);
    case 'give':
      return handleBankGive(interaction);
    case 'take':
      return handleBankTake(interaction);
    default:
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

async function handleBankBalance(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  ensureAccount(userId, username);

  const balance = getBalance(userId);
  const bankBalance = getCentralBankBalance();
  const dollStreetBalance = getDollStreetBalance();
  const casinoBalance = getMomijiCasinoBalance();
  const taysBalance = getBalance(TAYS_TOBACCO_USER_ID);
  const touhouMgmtBalance = getBalance(TOUHOU_MGMT_USER_ID);
  const SYSTEM_IDS = new Set([DOLL_STREET_USER_ID, TAYS_TOBACCO_USER_ID, TOUHOU_MGMT_USER_ID]);
  const top10Raw = getTopHolders(15);
  const top10 = top10Raw.filter(h => !SYSTEM_IDS.has(h.user_id)).slice(0, 10);
  const lottoFlag = isLottoDay();

  const medals = ['🥇', '🥈', '🥉'];
  const leaderboard = top10.length > 0
    ? top10.map((h, i) => {
      const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
      const name = h.username || `<@${h.user_id}>`;
      return `${prefix} ${name} — **${h.balance.toLocaleString()}** SGC`;
    }).join('\n')
    : '_No other holders yet._';

  const lines = [
    `💰 **Your Balance:** ${balance.toLocaleString()} SadGirlCoin`,
    `🏦 **Central Bank Reserve:** ${bankBalance.toLocaleString()} SGC`,
    `📈 **Doll Street (LumiStocks):** ${dollStreetBalance.toLocaleString()} SGC`,
    `🎰 **Momiji Casino:** ${casinoBalance.toLocaleString()} SGC`,
    `🎴 **Touhou Management Inc:** ${touhouMgmtBalance.toLocaleString()} SGC`,
    `🚬 **Tay's Tobacco:** ${taysBalance.toLocaleString()} SGC`,
    lottoFlag ? '⚠️ _Lotto Day is active — transfers have a 50% fee!_' : '',
    '',
    '**Top 10 Holders:**',
    leaderboard,
  ].filter(Boolean);

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleBankSend(interaction) {
  const sender = interaction.user;
  const recipient = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const note = interaction.options.getString('note', false) || '';

  if (recipient.bot) {
    await interaction.reply({ content: 'You cannot send coins to a bot.', ephemeral: true });
    return;
  }

  ensureAccount(sender.id, sender.username);
  ensureAccount(recipient.id, recipient.username);

  const result = transferCoins(sender.id, recipient.id, amount, note);

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const feePercent = Math.round(getTransferFeeRate() * 100);
  await interaction.reply(
    `✅ Sent **${amount.toLocaleString()} SGC** to <@${recipient.id}>. Fee: ${result.fee.toLocaleString()} SGC (${feePercent}%).`
  );
}

async function handleBankWithdraw(interaction) {
  const requesterId = interaction.user.id;

  if (requesterId !== BANK_OWNER_ID) {
    await interaction.reply({ content: '❌ Only the bank owner can withdraw from the Central Bank.', ephemeral: true });
    return;
  }

  const recipient = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const note = interaction.options.getString('note', false) || '';

  ensureAccount(recipient.id, recipient.username);
  const result = withdrawCentralBank(requesterId, recipient.id, amount, note);

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply(`🏦 Withdrew **${amount.toLocaleString()} SGC** from Central Bank to <@${recipient.id}>.`);
}

async function handleBankRaffle(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  const result = buyYearlyRaffleTicket(userId, username);

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply(
    `🎟️ You bought a yearly raffle ticket! You now have **${result.ticketCount}** ticket(s) for this year's draw.`
  );
}

async function handleBankGive(interaction) {
  if (!isEconomyAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only economy admins can give coins.', ephemeral: true });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const note = interaction.options.getString('note', false) || 'Admin give';

  ensureAccount(target.id, target.username);
  const result = adjustBalance(target.id, amount, note);

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply(`✅ Gave **${amount.toLocaleString()} SGC** to <@${target.id}>. Their new balance: **${result.newBalance.toLocaleString()} SGC**.`);
}

async function handleBankTake(interaction) {
  if (!isEconomyAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only economy admins can take coins.', ephemeral: true });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const note = interaction.options.getString('note', false) || 'Admin take';

  ensureAccount(target.id, target.username);
  const result = adjustBalance(target.id, -amount, note);

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply(`✅ Removed **${amount.toLocaleString()} SGC** from <@${target.id}>. Their new balance: **${result.newBalance.toLocaleString()} SGC**.`);
}

// ---------------------------------------------------------------------------
// LumiStocks handlers
// ---------------------------------------------------------------------------

async function handleStocksCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'list':
      return handleStocksList(interaction);
    case 'buy':
      return handleStocksBuy(interaction);
    case 'create':
      return handleStocksCreate(interaction);
    case 'pending':
      return handleStocksPending(interaction);
    case 'resolve':
      return handleStocksResolve(interaction);
    default:
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

async function handleStocksList(interaction) {
  const markets = getOpenMarkets();
  if (markets.length === 0) {
    await interaction.reply({ content: '📈 No open markets right now.', ephemeral: true });
    return;
  }

  const lines = markets.map((m) => {
    const opts = getMarketOptions(m);
    const yesNo = isYesNoMarket(m);
    const optLine = yesNo ? '' : `\n> 📋 ${opts.map((o, i) => `**${i + 1}.** ${o}`).join(' | ')}`;
    return `**#${m.id}** — ${m.title}${yesNo ? ' [Yes/No]' : ` [${opts.length} options]`}\n> ${m.description || '_No description._'}${optLine}`;
  });

  await interaction.reply({ content: `📈 **Open LumiStock Markets:**\n\n${lines.join('\n\n')}`, ephemeral: true });
}

async function handleStocksBuy(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const marketId = interaction.options.getInteger('market', true);
  const side = interaction.options.getString('side', true);
  const amount = interaction.options.getInteger('amount', true);

  const result = buyStockPosition(userId, username, marketId, side, amount);

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const market = getMarket(marketId);
  const displaySide = result.matchedSide || side;
  await interaction.reply(
    `📊 You invested **${amount.toLocaleString()} SGC** on **${displaySide.toUpperCase()}** for: ${market?.title ?? `Market #${marketId}`}`
  );
}

async function handleStocksCreate(interaction) {
  const requesterId = interaction.user.id;
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description', false) || '';
  const optionsRaw = interaction.options.getString('options', false) || null;
  const guildCfg = interaction.guildId ? getGuildConfig(interaction.guildId) : null;
  const roleMention = guildCfg?.bigBusinessRoleId ? `<@&${guildCfg.bigBusinessRoleId}>\n` : '';

  const adminAutoLive = isEconomyAdmin(interaction);
  const guildId = interaction.guildId || '';
  const result = createMarket(requesterId, title, description, optionsRaw, { adminAutoLive, guildId });

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const isYN = result.options.length === 2 && result.options[0].toLowerCase() === 'yes' && result.options[1].toLowerCase() === 'no';
  const optionsLine = isYN
    ? ''
    : `📋 **Options:** ${result.options.map((o, i) => `**${i + 1}.** ${o}`).join(' | ')}\n`;

  if (result.adminAutoLive) {
    // Admin market — already live, post an active market message
    const embed = [
      `📈 **LumiStock LIVE: #${result.marketId}**`,
      `> **${title}**`,
      description ? `> ${description}` : null,
      '',
      optionsLine || null,
      `_Created by <@${requesterId}> (admin)_`,
      `💰 Pool: **6 SGC** (seeded)`,
      '',
      '✅ **This market is LIVE! Place your bets with `/lumi-bets buy`!**',
    ].filter((line) => line != null).join('\n');

    let reply;
    try {
      const response = await interaction.reply({ content: `${roleMention}${embed}`, withResponse: true });
      reply = response.resource.message;
    } catch {
      await interaction.reply(`${roleMention}${embed}`);
      try { reply = await interaction.fetchReply(); } catch { /* ignore */ }
    }

    if (reply) {
      setMarketMessage(result.marketId, reply.id, reply.channelId);
    }

    // Also generate an announcement
    try {
      const { announceMarketLive } = require('./sadgirlStockActivation');
      if (announceMarketLive) {
        await announceMarketLive(result.marketId, interaction.client);
      }
    } catch { /* ignore if not available */ }
  } else {
    // Non-admin: normal pending flow requiring star reacts
    const embed = [
      `📈 **New LumiStock Proposed: #${result.marketId}**`,
      `> **${title}**`,
      description ? `> ${description}` : null,
      '',
      optionsLine || null,
      `_Proposed by <@${requesterId}>_`,
      '',
      '⭐ **React with a star to vote this market live!** (3 stars needed, costs 3 SGC each)',
    ].filter((line) => line != null).join('\n');

    let reply;
    try {
      const response = await interaction.reply({ content: `${roleMention}${embed}`, withResponse: true });
      reply = response.resource.message;
    } catch {
      await interaction.reply(`${roleMention}${embed}`);
      try { reply = await interaction.fetchReply(); } catch { /* ignore */ }
    }

    if (reply) {
      setMarketMessage(result.marketId, reply.id, reply.channelId);
      try { await reply.react('⭐'); } catch { /* ignore */ }
    }
  }
}

async function handleStocksPending(interaction) {
  const markets = getPendingMarkets();
  if (markets.length === 0) {
    await interaction.reply({ content: '📈 No pending markets right now.', ephemeral: true });
    return;
  }

  const lines = markets.map((m) => {
    const opts = getMarketOptions(m);
    const yesNo = isYesNoMarket(m);
    const optLine = yesNo ? '' : `\n> 📋 ${opts.map((o, i) => `**${i + 1}.** ${o}`).join(' | ')}`;
    return `**#${m.id}** — ${m.title} (⭐ ${m.star_count}/3)${yesNo ? ' [Yes/No]' : ` [${opts.length} options]`}\n> ${m.description || '_No description._'}${optLine}`;
  });

  await interaction.reply({ content: `📈 **Pending LumiBet Markets:**\n\n${lines.join('\n\n')}`, ephemeral: true });
}

async function handleStocksResolve(interaction) {
  const requesterId = interaction.user.id;
  const marketId = interaction.options.getInteger('market', true);
  const outcome = interaction.options.getString('outcome', true);
  const authorized = isEconomyAdmin(interaction);

  if (!authorized) {
    await interaction.reply({ content: '❌ Only economy admins can resolve markets.', ephemeral: true });
    return;
  }

  try {
    const result = resolveMarket(requesterId, marketId, outcome, { isAuthorized: true });

    if (!result.success) {
      await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      return;
    }

    const market = getMarket(marketId);
    const resolvedGuildCfg = getGuildConfig(market?.guild_id || interaction.guildId || '');
    const roleMention = resolvedGuildCfg?.bigBusinessRoleId ? `<@&${resolvedGuildCfg.bigBusinessRoleId}>\n` : '';
    const displayOutcome = result.matchedOutcome || outcome;
    const payoutLines = result.settledUsers.map((u) =>
      `<@${u.userId}>: invested ${u.invested} → payout **${u.payout}** SGC`
    );
    const payoutText = payoutLines.length > 0
      ? `\n\n**Payouts (pool: ${result.pool} SGC split among ${result.winnerCount} winner${result.winnerCount === 1 ? '' : 's'}):**\n${payoutLines.join('\n')}`
      : '\n_No winning positions — pool stays in Doll Street._';

    const resolveMsg = `${roleMention}✅ Market **#${marketId}** resolved: **${displayOutcome.toUpperCase()}**\n${market?.title ?? ''}${payoutText}`;

    await interaction.reply(resolveMsg);

    // Archive: move the original market message to the archive channel
    await archiveResolvedMarket(interaction.client, market, resolveMsg);
  } catch (error) {
    await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
  }
}

/**
 * Resolve the archive channel for a given guild.
 * Uses per-guild config if available, otherwise falls back to the global setting.
 */
function getArchiveChannelId(guildId) {
  if (guildId) {
    const cfg = getGuildConfig(guildId);
    if (cfg?.lumiBetsArchiveChannelId) return cfg.lumiBetsArchiveChannelId;
  }
  return FALLBACK_ARCHIVE_CHANNEL_ID;
}

/**
 * Move a resolved market's original message to the archive channel and delete
 * the original from the bets channel so only active bets remain visible.
 */
async function archiveResolvedMarket(client, market, resolveSummary) {
  if (!market?.message_id || !market?.channel_id) return;

  try {
    const archiveId = getArchiveChannelId(market.guild_id);
    const archiveChannel = await client.channels.fetch(archiveId).catch(() => null);
    if (!archiveChannel) {
      logger.warn(`Economy: archive channel ${archiveId} not found.`);
      return;
    }

    // Build an archive post with the original market info + resolution
    const archiveText = [
      market.guild_id && getGuildConfig(market.guild_id)?.bigBusinessRoleId
        ? `<@&${getGuildConfig(market.guild_id).bigBusinessRoleId}>`
        : null,
      `📦 **Archived LumiBet #${market.id}**`,
      `> **${market.title}**`,
      market.description ? `> ${market.description}` : null,
      '',
      `_Proposed by <@${market.created_by}> — Resolved: **${(market.outcome || '').toUpperCase()}**_`,
      `💰 Final pool: **${market.pool} SGC**`,
      '',
      resolveSummary,
    ].filter((line) => line != null).join('\n');

    await archiveChannel.send(archiveText);

    // Delete the original message from the stocks channel
    const srcChannel = await client.channels.fetch(market.channel_id).catch(() => null);
    if (srcChannel) {
      const msg = await srcChannel.messages.fetch(market.message_id).catch(() => null);
      if (msg?.deletable) {
        await msg.delete();
      }
    }
  } catch (error) {
    logger.warn('Economy: failed to archive resolved market.', error.message);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function reloadSettings() {
  try {
    ECONOMY_ADMIN_ROLE_ID = getSetting('economy.adminRoleId');
    FALLBACK_ARCHIVE_CHANNEL_ID = getSetting('scheduler.archiveChannelId');
  } catch { /* DB not ready */ }
}

module.exports = {
  buildEconomyCommands,
  handleBankCommand,
  handleStocksCommand,
  handleBetsCommand: handleStocksCommand,
  reloadSettings,
};
