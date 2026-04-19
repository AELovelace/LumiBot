const { SlashCommandBuilder } = require('discord.js');

const {
  DISPENSE_PRICE,
  dispenseCigarette,
  getRarityByRank,
  getUserCase,
  smokeCigarette,
  tradeCigarettes,
} = require('./cigaretteStore');

const {
  ensureAccount,
  getBalance,
  adjustBalance,
  TAYS_TOBACCO_USER_ID,
} = require('./sadgirlEconomyStore');

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
      .setName('smoke')
      .setDescription('Smoke one cigarette from your case.')
      .addIntegerOption((opt) => opt.setName('slot').setDescription('Slot number from your case (use /lumi-cigarette case to see numbers)').setMinValue(1).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('trade')
      .setDescription('Trade one cigarette with another user.')
      .addStringOption((opt) => opt.setName('yours').setDescription('Your cigarette to give').setRequired(true))
      .addUserOption((opt) => opt.setName('user').setDescription('The other person').setRequired(true))
      .addStringOption((opt) => opt.setName('theirs').setDescription('Their cigarette you want').setRequired(true)))
    .toJSON();
}

async function handleCigaretteCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'gacha':
      return handleGacha(interaction);
    case 'case':
      return handleCase(interaction);
    case 'smoke':
      return handleSmoke(interaction);
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

  const owner = targetUser.id === interaction.user.id ? 'Your' : `${targetUser.username}'s`;
  const text = `🧰 **${owner} Cigarette Case** (${items.length} unique):\n\n${lines.join('\n')}`;

  if (text.length <= 1900) {
    await interaction.reply(text);
    return;
  }

  const head = `🧰 **${owner} Cigarette Case** (${items.length} unique):`;
  await interaction.reply(`${head}\n${lines.slice(0, 35).join('\n')}\n\n_...and ${items.length - 35} more._`);
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

  await interaction.reply(
    `🚬 You smoked **${result.cigarette.display_name}**. ` +
    `${result.rarity.emoji} ${result.rarity.tier} (Rank #${result.cigarette.rank})`
  );
}

async function handleTrade(interaction) {
  const userId = interaction.user.id;
  const yours = interaction.options.getString('yours', true);
  const other = interaction.options.getUser('user', true);
  const theirs = interaction.options.getString('theirs', true);

  if (other.bot) {
    await interaction.reply({ content: '❌ You cannot trade with a bot.', ephemeral: true });
    return;
  }
  if (other.id === userId) {
    await interaction.reply({ content: '❌ You cannot trade with yourself.', ephemeral: true });
    return;
  }

  const result = tradeCigarettes(userId, yours, other.id, theirs);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply(
    `🔄 **Trade complete!**\n` +
    `<@${userId}> gave **${result.cigaretteA.display_name}** ${result.rarityA.emoji} (${result.rarityA.tier})\n` +
    `<@${other.id}> gave **${result.cigaretteB.display_name}** ${result.rarityB.emoji} (${result.rarityB.tier})`
  );
}

module.exports = {
  buildCigaretteCommand,
  handleCigaretteCommand,
};
