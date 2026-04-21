const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const {
  DISPENSE_PRICE,
  CASE_LIMIT,
  dispenseCigarette,
  getRarityByRank,
  getUserCase,
  smokeCigarette,
  getTopSmokers,
  tradeCigarettes,
  tradeCigaretteForMoney,
} = require('./cigaretteStore');

const {
  ensureAccount,
  getBalance,
  adjustBalance,
  TAYS_TOBACCO_USER_ID,
} = require('./sadgirlEconomyStore');
const { activateSmokeBoost, getSmokeBoost } = require('./smokeBoost');

function buildCigaretteCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-cigarette')
    .setDescription('Cigarette gachapon — pull, smoke, trade, and collect.')
    .addSubcommand((sub) => sub
      .setName('gacha')
      .setDescription(`Dispense one random cigarette for ${DISPENSE_PRICE} SGC.`))
    .addSubcommand((sub) => sub
      .setName('case')
      .setDescription('View your cigarette case (or another user\'s).')
      .addUserOption((opt) => opt.setName('user').setDescription('User to inspect').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('leaderboard')
      .setDescription('Show who has smoked the most cigarettes.'))
    .addSubcommand((sub) => sub
      .setName('smoke')
      .setDescription('Smoke one cigarette from your case (rarity-based message/image/video value boost for 5 minutes).')
      .addIntegerOption((opt) => opt.setName('slot').setDescription('Slot number from your case (use /lumi-cigarette case to see numbers)').setMinValue(1).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('buff')
      .setDescription('Show your current cigarette smoke boost status.'))
    .addSubcommand((sub) => sub
      .setName('trade')
      .setDescription('Trade a cigarette for another cigarette, or sell it for SGC.')
      .addStringOption((opt) => opt.setName('yours').setDescription('Your cigarette to give').setRequired(true))
      .addUserOption((opt) => opt.setName('user').setDescription('The other person').setRequired(true))
      .addStringOption((opt) => opt.setName('theirs').setDescription('Their cigarette you want (use this OR money)').setRequired(false))
      .addIntegerOption((opt) => opt.setName('money').setDescription('SGC amount they pay you (use this OR theirs)').setMinValue(1).setRequired(false)))
    .toJSON();
}

async function handleCigaretteCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'gacha':
      return handleGacha(interaction);
    case 'case':
      return handleCase(interaction);
    case 'leaderboard':
      return handleLeaderboard(interaction);
    case 'smoke':
      return handleSmoke(interaction);
    case 'buff':
      return handleBuff(interaction);
    case 'trade':
      return handleTrade(interaction);
    default:
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

async function handleGacha(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < DISPENSE_PRICE) {
    await interaction.reply({
      content: `❌ You need **${DISPENSE_PRICE} SGC** for a pull, but you only have **${balance} SGC**.`,
      ephemeral: true,
    });
    return;
  }

  const result = dispenseCigarette(userId);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  adjustBalance(userId, -DISPENSE_PRICE, `Cigarette gacha: ${result.cigarette.display_name}`);
  adjustBalance(TAYS_TOBACCO_USER_ID, DISPENSE_PRICE, `Cigarette sale: ${result.cigarette.display_name}`);

  const rarityText = `${result.rarity.emoji} ${result.rarity.tier} (Rank #${result.cigarette.rank})`;
  if (result.action === 'replaced' && result.replacedCigarette) {
    const replacedRarity = getRarityByRank(result.replacedCigarette.rank);
    await interaction.reply(
      `🎰 You pulled **${result.cigarette.display_name}**! ${rarityText}\n` +
      `🧰 Your case is full (${CASE_LIMIT}). Replaced **${result.replacedCigarette.display_name}** ` +
      `${replacedRarity.emoji} (${replacedRarity.tier}, #${result.replacedCigarette.rank}) with this rarer cigarette.\n` +
      `Cost: **${DISPENSE_PRICE} SGC**`
    );
    return;
  }

  if (result.action === 'rejected_full') {
    await interaction.reply(
      `🎰 You pulled **${result.cigarette.display_name}**! ${rarityText}\n` +
      `🧰 Your case is full (${CASE_LIMIT}), and this pull was not rarer than your least-rare cigarette, so it was discarded.\n` +
      `Cost: **${DISPENSE_PRICE} SGC**`
    );
    return;
  }

  await interaction.reply(
    `🎰 You got **${result.cigarette.display_name}**! ` +
    `${result.rarity.emoji} ${result.rarity.tier} (Rank #${result.cigarette.rank})\n` +
    `Cost: **${DISPENSE_PRICE} SGC**`
  );
}

async function handleCase(interaction) {
  const targetUser = interaction.options.getUser('user', false) || interaction.user;
  const items = getUserCase(targetUser.id);

  if (items.length === 0) {
    const label = targetUser.id === interaction.user.id ? 'You have' : `**${targetUser.username}** has`;
    await interaction.reply({
      content: `${label} no cigarettes right now. Use \`/lumi-cigarette gacha\` to pull one.`,
      ephemeral: true,
    });
    return;
  }

  const lines = items.map((item, i) => {
    const rarity = getRarityByRank(item.rank);
    return `**[${i + 1}]** ${rarity.emoji} **${item.display_name}** ×${item.quantity} (${rarity.tier}, #${item.rank})`;
  });

  const totalCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const capacityFooter = `\n\n_Capacity: ${totalCount}/${CASE_LIMIT}_`;

  const owner = targetUser.id === interaction.user.id ? 'Your' : `${targetUser.username}'s`;
  const maxLen = 1900;
  const firstHeader = `🧰 **${owner} Cigarette Case** (${items.length} unique):\n\n`;
  const firstBudget = maxLen - firstHeader.length - capacityFooter.length;

  const chunks = [];
  let current = [];
  let isFirstChunk = true;

  for (const line of lines) {
    const budget = isFirstChunk ? firstBudget : maxLen;
    const lineWithSepLen = (current.length === 0 ? 0 : 1) + line.length;
    const currentLen = current.join('\n').length;

    if (currentLen + lineWithSepLen > budget) {
      if (current.length === 0) {
        chunks.push([line.slice(0, Math.max(20, budget - 3)) + '...']);
      } else {
        chunks.push(current);
        current = [];
        isFirstChunk = false;
        const nextBudget = maxLen;
        if (line.length > nextBudget) {
          chunks.push([line.slice(0, Math.max(20, nextBudget - 3)) + '...']);
        } else {
          current.push(line);
        }
      }
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  if (chunks.length === 0) {
    await interaction.reply(`${firstHeader}_No entries to display._`);
    return;
  }

  await interaction.reply(`${firstHeader}${chunks[0].join('\n')}${capacityFooter}`);

  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i].join('\n'));
  }
}

async function handleLeaderboard(interaction) {
  const rows = getTopSmokers(10);
  if (rows.length === 0) {
    await interaction.reply('🚬 No cigarettes have been smoked yet.');
    return;
  }

  const lines = rows.map((row, index) => `${index + 1}. <@${row.user_id}> — **${row.smoked_total}** smoked`);
  await interaction.reply(`🏆 **Cigarette Smoker Leaderboard**\n\n${lines.join('\n')}`);
}

async function handleSmoke(interaction) {
  const slot = interaction.options.getInteger('slot', true);
  const userId = interaction.user.id;

  const items = getUserCase(userId);
  if (slot < 1 || slot > items.length) {
    await interaction.reply({ content: `❌ Slot **${slot}** doesn't exist — you have ${items.length} cigarette${items.length === 1 ? '' : 's'} in your case.`, ephemeral: true });
    return;
  }

  const target = items[slot - 1];
  const result = smokeCigarette(userId, target.display_name);

  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const boost = activateSmokeBoost(userId, result.rarity.tier);
  const minutes = Math.max(1, Math.floor(boost.durationMs / 60000));

  await interaction.reply(
    `🚬 You smoked **${result.cigarette.display_name}**. ` +
    `${result.rarity.emoji} ${result.rarity.tier} (Rank #${result.cigarette.rank})
💸 **Smoke Boost Active:** ${boost.multiplier}x message/image/video character value for ${minutes} minutes.`
  );
}

async function handleBuff(interaction) {
  const boost = getSmokeBoost(interaction.user.id);
  if (!boost.active) {
    await interaction.reply({
      content: '🚬 You have no active smoke boost. Use `/lumi-cigarette smoke <slot>` to activate one.',
      ephemeral: true,
    });
    return;
  }

  const totalSeconds = Math.max(0, Math.ceil(boost.remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const timeLeft = `${minutes}m ${String(seconds).padStart(2, '0')}s`;

  await interaction.reply({
    content:
      `🚬 **Smoke Boost Active** — **${boost.multiplier}x** character value` +
      `${boost.rarityTier ? ` (${boost.rarityTier})` : ''}\n` +
      `⏳ Time remaining: **${timeLeft}**`,
    ephemeral: true,
  });
}

async function handleTrade(interaction) {
  const userId = interaction.user.id;
  const yours = interaction.options.getString('yours', true);
  const other = interaction.options.getUser('user', true);
  const theirs = interaction.options.getString('theirs', false);
  const money = interaction.options.getInteger('money', false);

  if (other.bot) {
    await interaction.reply({ content: '❌ You cannot trade with a bot.', ephemeral: true });
    return;
  }
  if (other.id === userId) {
    await interaction.reply({ content: '❌ You cannot trade with yourself.', ephemeral: true });
    return;
  }

  const hasTheirs = Boolean(String(theirs || '').trim());
  const hasMoney = Number.isInteger(money) && money > 0;
  if ((hasTheirs && hasMoney) || (!hasTheirs && !hasMoney)) {
    await interaction.reply({ content: '❌ Choose exactly one trade mode: either provide `theirs` for a swap, or `money` for an SGC sale.', ephemeral: true });
    return;
  }

  ensureAccount(userId, interaction.user.username);
  ensureAccount(other.id, other.username);

  const token = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const yesId = `cig_trade_yes_${token}`;
  const noId = `cig_trade_no_${token}`;
  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(yesId).setLabel('Yes').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(noId).setLabel('No').setStyle(ButtonStyle.Danger),
    ),
  ];

  if (hasMoney) {
    const buyerBalance = getBalance(other.id);
    if (buyerBalance < money) {
      await interaction.reply({ content: `❌ <@${other.id}> needs **${money} SGC** but only has **${buyerBalance} SGC**.`, ephemeral: true });
      return;
    }

    await interaction.reply({
      content:
        `🤝 **Trade request**\n` +
        `<@${userId}> wants to sell **${yours}** to <@${other.id}> for **${money} SGC**.\n` +
        `<@${other.id}> — approve this trade?`,
      components,
    });

    const tradeMessage = await interaction.fetchReply();
    const collector = tradeMessage.createMessageComponentCollector({
      filter: (btn) => btn.customId === yesId || btn.customId === noId,
      time: 60_000,
    });

    let resolved = false;

    collector.on('collect', async (btn) => {
      if (btn.user.id !== other.id) {
        await btn.reply({ content: 'Only the trade recipient can approve or deny this trade.', ephemeral: true });
        return;
      }

      if (resolved) {
        await btn.reply({ content: 'This trade request is already resolved.', ephemeral: true }).catch(() => {});
        return;
      }
      resolved = true;

      if (btn.customId === noId) {
        await btn.update({
          content: `❌ Trade denied by <@${other.id}>.`,
          components: [],
        });
        collector.stop('denied');
        return;
      }

      const latestBuyerBalance = getBalance(other.id);
      if (latestBuyerBalance < money) {
        await btn.update({
          content: `❌ Trade failed: <@${other.id}> now has only **${latestBuyerBalance} SGC** (needs **${money} SGC**).`,
          components: [],
        });
        collector.stop('failed');
        return;
      }

      const sale = tradeCigaretteForMoney(userId, yours, other.id, money);
      if (!sale.success) {
        await btn.update({ content: `❌ Trade failed: ${sale.error}`, components: [] });
        collector.stop('failed');
        return;
      }

      adjustBalance(other.id, -sale.price, `Bought cigarette: ${sale.cigarette.display_name}`);
      adjustBalance(userId, sale.price, `Sold cigarette: ${sale.cigarette.display_name}`);

      await btn.update({
        content:
          `💸 **Sale complete!**\n` +
          `<@${userId}> sold **${sale.cigarette.display_name}** ${sale.rarity.emoji} (${sale.rarity.tier}) to <@${other.id}> for **${sale.price} SGC**`,
        components: [],
      });
      collector.stop('approved');
    });

    collector.on('end', async (_collected, reason) => {
      if (!resolved && reason === 'time') {
        await tradeMessage.edit({
          content: `⌛ Trade request timed out. No trade occurred.`,
          components: [],
        }).catch(() => {});
      }
    });
    return;
  }

  await interaction.reply({
    content:
      `🤝 **Trade request**\n` +
      `<@${userId}> offers **${yours}** for **${theirs}** from <@${other.id}>.\n` +
      `<@${other.id}> — approve this trade?`,
    components,
  });

  const tradeMessage = await interaction.fetchReply();
  const collector = tradeMessage.createMessageComponentCollector({
    filter: (btn) => btn.customId === yesId || btn.customId === noId,
    time: 60_000,
  });

  let resolved = false;

  collector.on('collect', async (btn) => {
    if (btn.user.id !== other.id) {
      await btn.reply({ content: 'Only the trade recipient can approve or deny this trade.', ephemeral: true });
      return;
    }

    if (resolved) {
      await btn.reply({ content: 'This trade request is already resolved.', ephemeral: true }).catch(() => {});
      return;
    }
    resolved = true;

    if (btn.customId === noId) {
      await btn.update({ content: `❌ Trade denied by <@${other.id}>.`, components: [] });
      collector.stop('denied');
      return;
    }

    const result = tradeCigarettes(userId, yours, other.id, theirs);
    if (!result.success) {
      await btn.update({ content: `❌ Trade failed: ${result.error}`, components: [] });
      collector.stop('failed');
      return;
    }

    await btn.update({
      content:
        `🔄 **Trade complete!**\n` +
        `<@${userId}> gave **${result.cigaretteA.display_name}** ${result.rarityA.emoji} (${result.rarityA.tier})\n` +
        `<@${other.id}> gave **${result.cigaretteB.display_name}** ${result.rarityB.emoji} (${result.rarityB.tier})`,
      components: [],
    });
    collector.stop('approved');
  });

  collector.on('end', async (_collected, reason) => {
    if (!resolved && reason === 'time') {
      await tradeMessage.edit({ content: `⌛ Trade request timed out. No trade occurred.`, components: [] }).catch(() => {});
    }
  });
}

module.exports = {
  buildCigaretteCommand,
  handleCigaretteCommand,
};
