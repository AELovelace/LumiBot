/**
 * Touhou Market Commands — slash + prefix command handlers for the Touhou collection system.
 *
 * /lumi-touhou adopt <name>        Adopt an available Touhou (25 SGC)
 * /lumi-touhou collection [user]   View your (or someone's) collection
 * /lumi-touhou send <name> <user>  Gift a Touhou to another user
 * /lumi-touhou trade <yours> <user> <theirs>  Swap Touhous with another user
 * /lumi-touhou sell <name> <price> List a Touhou for sale
 * /lumi-touhou delist <name>       Remove a listing
 * /lumi-touhou buy <name>          Buy a listed Touhou
 * /lumi-touhou market              Browse available Touhous + listings
 * /lumi-touhou info <name>         View details and trade history for a Touhou
 * /lumi-touhou search <query>      Search Touhous by name
 * /lumi-touhou stats               Global market statistics
 *
 * Admin subcommands:
 * /lumi-touhou assign <name> <user>   Force-assign a Touhou
 * /lumi-touhou release <name>         Return a Touhou to the market
 * /lumi-touhou reset-trades <name>    Reset a Touhou's trade count
 */

const path = require('node:path');
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { logger } = require('./logger');

const ECONOMY_ADMIN_ROLE_ID = '901304988083572756';
const BANK_OWNER_ID = '319254336402358272';

const {
  DOLL_USER_ID,
  BASE_ADOPT_PRICE,
  PARTY_LIMIT,
  FAINT_DURATION_MS,
  POTION_PRICE,
  POTION_CAP,
  resolveName,
  getImageFile,
  getRarity,
  getSuggestedPrice,
  getAvailableTouhous,
  getAvailableCount,
  adoptTouhou,
  getUserTouhous,
  getTouhou,
  sendTouhou,
  swapTouhous,
  listForSale,
  delistTouhou,
  getListings,
  getListingsPage,
  getListingsCount,
  buyListing,
  getListingPrice,
  getTradeHistory,
  adminAssign,
  adminRelease,
  adminResetTrades,
  getMarketStats,
  searchTouhous,
  sellbackToMarket,
  getAttacks,
  getOrCreateBattleStats,
  expToNextLevel,
  healTouhou,
  getPotionCount,
  addPotions,
  consumePotion,
} = require('./touhouStore');

const {
  CENTRAL_BANK_USER_ID,
  TOUHOU_MGMT_USER_ID,
  getBalance,
  ensureAccount,
  adjustBalance,
} = require('./sadgirlEconomyStore');

const { startBattle, cancelFaintReminder } = require('./touhouBattle');

const TOUHOU_TRADER_LIQUIDITY_FLOOR = 1000;
const HEAL_COST = 50;
const LISTINGS_PER_PAGE = 15;

let touhouDir = '';

function setTouhouDir(dir) {
  touhouDir = dir;
}

function isTouhouAdmin(interaction) {
  if (interaction.user.id === BANK_OWNER_ID) return true;
  return interaction.member?.roles?.cache?.has(ECONOMY_ADMIN_ROLE_ID) ?? false;
}

// ---------------------------------------------------------------------------
// Slash command definition
// ---------------------------------------------------------------------------

function buildTouhouCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-touhou')
    .setDescription('Touhou collection — adopt, trade, and collect Touhou characters!')
    .addSubcommand((sub) => sub
      .setName('adopt')
      .setDescription(`Adopt a random Touhou from the market (${BASE_ADOPT_PRICE} SGC).`))
    .addSubcommand((sub) => sub
      .setName('collection')
      .setDescription('View your Touhou collection (or another user\'s).')
      .addUserOption((opt) => opt.setName('user').setDescription('User to view (leave empty for your own)').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('send')
      .setDescription('Gift a Touhou to another user for free.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true))
      .addUserOption((opt) => opt.setName('user').setDescription('Recipient').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('trade')
      .setDescription('Swap one of your Touhous for one of theirs.')
      .addStringOption((opt) => opt.setName('yours').setDescription('Your Touhou to give').setRequired(true))
      .addUserOption((opt) => opt.setName('user').setDescription('The other person').setRequired(true))
      .addStringOption((opt) => opt.setName('theirs').setDescription('Their Touhou you want').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('sell')
      .setDescription('List one of your Touhous for sale.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true))
      .addIntegerOption((opt) => opt.setName('price').setDescription('Asking price in SGC').setMinValue(1).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('delist')
      .setDescription('Remove your Touhou from the marketplace.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('buy')
      .setDescription('Buy a listed Touhou, or buy potion items.')
      .addStringOption((opt) => opt
        .setName('name')
        .setDescription('Touhou name (for character purchases)')
        .setRequired(false))
      .addStringOption((opt) => opt
        .setName('item')
        .setDescription('Consumable item to buy')
        .setRequired(false)
        .addChoices({ name: 'Health Potion', value: 'potion' }))
      .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription(`Amount to buy (1-${POTION_CAP})`)
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(POTION_CAP)))
    .addSubcommand((sub) => sub
      .setName('market')
      .setDescription('Browse available Touhous and active listings.'))
    .addSubcommand((sub) => sub
      .setName('listings')
      .setDescription('List Touhous currently for sale in this server.')
      .addIntegerOption((opt) => opt
        .setName('page')
        .setDescription('Page number')
        .setRequired(false)
        .setMinValue(1)))
    .addSubcommand((sub) => sub
      .setName('info')
      .setDescription('View details and trade history for a Touhou.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('search')
      .setDescription('Search Touhous by name.')
      .addStringOption((opt) => opt.setName('query').setDescription('Search term').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('stats')
      .setDescription('View global Touhou market statistics.'))
    .addSubcommand((sub) => sub
      .setName('buyback')
      .setDescription(`Sell a Touhou back to the market for ~2/3 of its suggested price.`)
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('battle')
      .setDescription('Battle an evil Touhou (PvE).')
      .addStringOption((opt) => opt.setName('name').setDescription('Your Touhou').setRequired(true))
      .addStringOption((opt) => opt
        .setName('rarity')
        .setDescription('Choose a rarity to fight, or "gamble" for a random opponent (+20% rewards).')
        .setRequired(true)
        .addChoices(
          { name: 'Common', value: 'Common' },
          { name: 'Uncommon', value: 'Uncommon' },
          { name: 'Rare', value: 'Rare' },
          { name: 'Epic', value: 'Epic' },
          { name: 'Legendary', value: 'Legendary' },
          { name: 'Gamble (random rarity, +20% rewards)', value: 'gamble' },
        )))
    .addSubcommand((sub) => sub
      .setName('heal')
      .setDescription('Heal a fainted Touhou. Free after the 10-min cooldown, or 50 SGC instant with pay:true.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true))
      .addBooleanOption((opt) => opt.setName('pay').setDescription('Pay 50 SGC for instant heal').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('party')
      .setDescription('Show your battle party with levels, EXP, and faint timers.'))
    .addSubcommand((sub) => sub
      .setName('assign')
      .setDescription('(Admin) Force-assign a Touhou to a user.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true))
      .addUserOption((opt) => opt.setName('user').setDescription('User to assign to').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('release')
      .setDescription('(Admin) Return a Touhou to the market.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('reset-trades')
      .setDescription('(Admin) Reset trade count for a Touhou.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true)))
    .toJSON();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAttachment(touhouName) {
  const imgFile = getImageFile(touhouName);
  if (!imgFile) return null;
  const imgPath = path.resolve(touhouDir, imgFile);
  try {
    return new AttachmentBuilder(imgPath, { name: imgFile.replace(/ /g, '_') });
  } catch {
    return null;
  }
}

/**
 * Get a touhou's level for a specific owner. Returns 0 if no battle row yet.
 * Does NOT create a row — safe for read-only display paths.
 */
function getOwnedLevel(guildId, touhouName, ownerId) {
  if (!ownerId) return 0;
  const row = getOrCreateBattleStats(guildId, touhouName, ownerId);
  return row?.level || 0;
}

/**
 * Solvency-aware payout from Touhou Trader to a player.
 * Always credits the player. Only debits TOUHOU_MGMT if its balance is at or above
 * the liquidity floor; otherwise the amount is "minted" so the trader can never
 * go illiquid.
 */
function payTouhouTraderPayout(userId, amount, note) {
  if (amount <= 0) return;
  const traderBalance = getBalance(TOUHOU_MGMT_USER_ID);
  adjustBalance(userId, amount, note);
  if (traderBalance >= TOUHOU_TRADER_LIQUIDITY_FLOOR + amount) {
    adjustBalance(TOUHOU_MGMT_USER_ID, -amount, note);
  } else {
    logger.info(`Touhou Trader below liquidity floor (balance=${traderBalance}, payout=${amount}); minting payout.`);
  }
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function requireGuild(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    return null;
  }
  return guildId;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handleTouhouCommand(interaction) {
  const guildId = requireGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: '❌ Touhou commands can only be used inside a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'adopt': return handleAdopt(interaction);
    case 'collection': return handleCollection(interaction);
    case 'send': return handleSend(interaction);
    case 'trade': return handleTrade(interaction);
    case 'sell': return handleSell(interaction);
    case 'delist': return handleDelist(interaction);
    case 'buy': return handleBuy(interaction);
    case 'market': return handleMarket(interaction);
    case 'listings': return handleListings(interaction);
    case 'info': return handleInfo(interaction);
    case 'search': return handleSearch(interaction);
    case 'stats': return handleStats(interaction);
    case 'buyback': return handleBuyback(interaction);
    case 'battle': return handleBattle(interaction);
    case 'heal': return handleHeal(interaction);
    case 'party': return handleParty(interaction);
    case 'assign': return handleAssign(interaction);
    case 'release': return handleRelease(interaction);
    case 'reset-trades': return handleResetTrades(interaction);
    default:
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleAdopt(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const username = interaction.user.username;

  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < BASE_ADOPT_PRICE) {
    await interaction.reply({ content: `❌ You need **${BASE_ADOPT_PRICE} SGC** to adopt a Touhou but you only have **${balance} SGC**.`, ephemeral: true });
    return;
  }

  const result = adoptTouhou(guildId, userId);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const touhouName = result.touhou.name;

  // Deduct the cost from the user's economy balance
  adjustBalance(userId, -BASE_ADOPT_PRICE, `Adopted Touhou: ${touhouName}`);
  adjustBalance(TOUHOU_MGMT_USER_ID, BASE_ADOPT_PRICE, `Touhou adoption fee: ${touhouName}`);

  const rarity = getRarity(result.touhou.trade_count || 0, touhouName, result.touhou.base_rarity_score || 0);
  const attachment = makeAttachment(touhouName);
  const content = `🎉 You adopted **${touhouName}**! ${rarity.emoji} ${rarity.tier}\nCost: **${BASE_ADOPT_PRICE} SGC**`;

  if (attachment) {
    await interaction.reply({ content, files: [attachment] });
  } else {
    await interaction.reply(content);
  }
}

async function handleCollection(interaction) {
  const guildId = interaction.guildId;
  const targetUser = interaction.options.getUser('user', false) || interaction.user;
  const touhous = getUserTouhous(guildId, targetUser.id);

  if (touhous.length === 0) {
    const label = targetUser.id === interaction.user.id ? 'You don\'t' : `**${targetUser.username}** doesn't`;
    await interaction.reply({ content: `${label} have any Touhous yet. Use \`/lumi-touhou adopt\` to get one!`, ephemeral: true });
    return;
  }

  const lines = touhous.map((t) => {
    const stats = getOrCreateBattleStats(guildId, t.name, targetUser.id);
    const level = stats?.level || 1;
    const rarity = getRarity(t.trade_count, t.name, t.base_rarity_score || 0, level);
    const price = getSuggestedPrice(t.trade_count, t.base_rarity_score || 0, level);
    let status = '';
    if (stats?.fainted_until && stats.fainted_until > Date.now()) {
      status = ` 💤 fainted (${formatRemaining(stats.fainted_until - Date.now())})`;
    }
    return `${rarity.emoji} **${t.name}** — ${rarity.tier} • Lv ${level}${status} (${t.trade_count} trades, ~${price} SGC)`;
  });

  // Build per-touhou file list (may be null for missing images)
  const perTouhouFiles = touhous.map((t) => makeAttachment(t.name));

  const label = targetUser.id === interaction.user.id ? 'Your' : `${targetUser.username}'s`;
  const header = `🗂️ **${label} Touhou Collection** (${touhous.length}):\n\n`;

  // Discord allows max 10 attachments per message, so batch them
  const MAX_FILES = 10;
  let msg = header;
  const batches = []; // each batch: { text, files[] }
  let currentFiles = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const file = perTouhouFiles[i];

    // Check if we need to split for text length or file count
    if ((msg + line + '\n').length > 1900 || currentFiles.length >= MAX_FILES) {
      batches.push({ text: msg, files: currentFiles });
      msg = '';
      currentFiles = [];
    }
    msg += line + '\n';
    if (file) currentFiles.push(file);
  }
  if (msg) batches.push({ text: msg, files: currentFiles });

  // First message is a reply, the rest are follow-ups — all public
  await interaction.reply({ content: batches[0].text, files: batches[0].files });
  for (let i = 1; i < batches.length; i++) {
    await interaction.followUp({ content: batches[i].text, files: batches[i].files });
  }
}

async function handleSend(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const nameInput = interaction.options.getString('name', true);
  const recipient = interaction.options.getUser('user', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  if (recipient.bot) {
    await interaction.reply({ content: '❌ You can\'t send a Touhou to a bot.', ephemeral: true });
    return;
  }

  const result = sendTouhou(guildId, userId, recipient.id, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const lvl = getOwnedLevel(guildId, touhouName, recipient.id);
  const rarity = getRarity(result.touhou.trade_count, touhouName, result.touhou.base_rarity_score || 0, lvl);
  await interaction.reply(`🎁 <@${userId}> gifted **${touhouName}** to <@${recipient.id}>! ${rarity.emoji} ${rarity.tier} • Lv ${lvl} (${result.touhou.trade_count} trades)`);
}

async function handleTrade(interaction) {
  const guildId = interaction.guildId;
  const userA = interaction.user;
  const nameAInput = interaction.options.getString('yours', true);
  const userB = interaction.options.getUser('user', true);
  const nameBInput = interaction.options.getString('theirs', true);

  const touhouAName = resolveName(nameAInput);
  const touhouBName = resolveName(nameBInput);

  if (!touhouAName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameAInput}**.`, ephemeral: true });
    return;
  }
  if (!touhouBName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameBInput}**.`, ephemeral: true });
    return;
  }

  if (userB.bot) {
    await interaction.reply({ content: '❌ You can\'t trade with a bot.', ephemeral: true });
    return;
  }

  if (userB.id === userA.id) {
    await interaction.reply({ content: '❌ You can\'t trade with yourself.', ephemeral: true });
    return;
  }

  const token = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const yesId = `th_trade_yes_${token}`;
  const noId = `th_trade_no_${token}`;
  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(yesId).setLabel('Yes').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(noId).setLabel('No').setStyle(ButtonStyle.Danger),
    ),
  ];

  await interaction.reply({
    content:
      `🤝 **Trade request**\n` +
      `<@${userA.id}> offers **${touhouAName}** for **${touhouBName}** from <@${userB.id}>.\n` +
      `<@${userB.id}> — approve this trade?`,
    components,
  });

  const tradeMessage = await interaction.fetchReply();
  const collector = tradeMessage.createMessageComponentCollector({
    filter: (btn) => btn.customId === yesId || btn.customId === noId,
    time: 60_000,
  });

  let resolved = false;

  collector.on('collect', async (btn) => {
    if (btn.user.id !== userB.id) {
      await btn.reply({ content: 'Only the trade recipient can approve or deny this trade.', ephemeral: true });
      return;
    }

    if (resolved) {
      await btn.reply({ content: 'This trade request is already resolved.', ephemeral: true }).catch(() => {});
      return;
    }
    resolved = true;

    if (btn.customId === noId) {
      await btn.update({ content: `❌ Trade denied by <@${userB.id}>.`, components: [] });
      collector.stop('denied');
      return;
    }

    const result = swapTouhous(guildId, userA.id, touhouAName, userB.id, touhouBName);
    if (!result.success) {
      await btn.update({ content: `❌ Trade failed: ${result.error}`, components: [] });
      collector.stop('failed');
      return;
    }

    const touhouA = getTouhou(guildId, touhouAName);
    const touhouB = getTouhou(guildId, touhouBName);
    const lvlA = getOwnedLevel(guildId, touhouAName, userB.id);
    const lvlB = getOwnedLevel(guildId, touhouBName, userA.id);
    const rarityA = getRarity(touhouA.trade_count, touhouAName, touhouA.base_rarity_score || 0, lvlA);
    const rarityB = getRarity(touhouB.trade_count, touhouBName, touhouB.base_rarity_score || 0, lvlB);
    await btn.update({
      content:
        `🔄 **Trade complete!**\n` +
        `<@${userA.id}> gave **${touhouAName}** ${rarityA.emoji} (Lv ${lvlA}) ↔ <@${userB.id}> gave **${touhouBName}** ${rarityB.emoji} (Lv ${lvlB})`,
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

async function handleSell(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const nameInput = interaction.options.getString('name', true);
  const price = interaction.options.getInteger('price', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const result = listForSale(guildId, userId, touhouName, price);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const touhou = getTouhou(guildId, touhouName);
  const level = getOwnedLevel(guildId, touhouName, userId);
  const rarity = getRarity(touhou.trade_count, touhouName, touhou.base_rarity_score || 0, level);
  const suggested = getSuggestedPrice(touhou.trade_count, touhou.base_rarity_score || 0, level);
  await interaction.reply(
    `🏷️ **${touhouName}** listed for sale at **${price} SGC**! ${rarity.emoji} ${rarity.tier} • Lv ${level}\n` +
    `_Suggested price: ~${suggested} SGC_`
  );
}

async function handleDelist(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const result = delistTouhou(guildId, userId, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `✅ **${touhouName}** has been removed from the marketplace.`, ephemeral: true });
}

async function handleBuy(interaction) {
  const guildId = interaction.guildId;
  const buyerId = interaction.user.id;
  const buyerName = interaction.user.username;
  const item = interaction.options.getString('item', false);
  const amount = interaction.options.getInteger('amount', false) || 1;
  const nameInput = interaction.options.getString('name', false);

  ensureAccount(buyerId, buyerName);

  if (item === 'potion') {
    if (amount < 1 || amount > POTION_CAP) {
      await interaction.reply({ content: `❌ Amount must be between 1 and ${POTION_CAP}.`, ephemeral: true });
      return;
    }

    const inventoryBefore = getPotionCount(guildId, buyerId);
    if (inventoryBefore >= POTION_CAP) {
      await interaction.reply({ content: `❌ You already have the potion cap (${POTION_CAP}/${POTION_CAP}).`, ephemeral: true });
      return;
    }

    const addable = Math.min(amount, POTION_CAP - inventoryBefore);
    const totalCost = addable * POTION_PRICE;
    const balanceNow = getBalance(buyerId);
    if (balanceNow < totalCost) {
      await interaction.reply({ content: `❌ You need **${totalCost} SGC** to buy ${addable} potion(s), but only have **${balanceNow} SGC**.`, ephemeral: true });
      return;
    }

    const addResult = addPotions(guildId, buyerId, addable);
    if (!addResult.success || addResult.added <= 0) {
      await interaction.reply({ content: `❌ Potion purchase failed: inventory cap reached (${POTION_CAP}).`, ephemeral: true });
      return;
    }

    const finalCost = addResult.added * POTION_PRICE;
    adjustBalance(buyerId, -finalCost, `Bought ${addResult.added} Health Potion(s)`);
    adjustBalance(TOUHOU_MGMT_USER_ID, finalCost, `Touhou potion sale (${addResult.added})`);

    await interaction.reply({
      content: `🧪 Purchased **${addResult.added}** Health Potion(s) for **${finalCost} SGC**.
Inventory: **${addResult.newCount}/${POTION_CAP}** (price: ${POTION_PRICE} each).`,
      ephemeral: true,
    });
    return;
  }

  if (!nameInput) {
    await interaction.reply({ content: '❌ Provide a Touhou name, or set item to Health Potion.', ephemeral: true });
    return;
  }

  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const balance = getBalance(buyerId);

  // Peek at listing price before consuming it
  const touhou = getTouhou(guildId, touhouName);
  if (!touhou) {
    await interaction.reply({ content: `❌ That Touhou doesn't exist.`, ephemeral: true });
    return;
  }

  // Pre-check balance against listing price
  const listingPrice = getListingPrice(guildId, touhouName);
  if (listingPrice === null) {
    await interaction.reply({ content: `❌ **${touhouName}** is not listed for sale.`, ephemeral: true });
    return;
  }

  if (balance < listingPrice) {
    await interaction.reply({ content: `❌ You need **${listingPrice} SGC** but only have **${balance} SGC**.`, ephemeral: true });
    return;
  }

  const result = buyListing(guildId, buyerId, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  // Transfer SGC: buyer pays full price, seller receives 90%, 10% tax to Central Bank
  const tax = Math.max(1, Math.floor(result.price * 0.10));
  const sellerReceives = result.price - tax;
  adjustBalance(buyerId, -result.price, `Bought Touhou: ${touhouName}`);
  adjustBalance(result.sellerId, sellerReceives, `Sold Touhou: ${touhouName} (after 10% tax)`);
  adjustBalance(TOUHOU_MGMT_USER_ID, tax, `Touhou trade tax: ${touhouName}`);

  const buyerLevel = getOwnedLevel(guildId, touhouName, buyerId);
  const rarity = getRarity(result.touhou.trade_count, touhouName, result.touhou.base_rarity_score || 0, buyerLevel);
  const attachment = makeAttachment(touhouName);
  const content = `💰 <@${buyerId}> bought **${touhouName}** from <@${result.sellerId}> for **${result.price} SGC**! (${tax} SGC tax → Touhou Management Inc) ${rarity.emoji} ${rarity.tier} • Lv ${buyerLevel}`;

  if (attachment) {
    await interaction.reply({ content, files: [attachment] });
  } else {
    await interaction.reply(content);
  }
}

async function handleMarket(interaction) {
  const guildId = interaction.guildId;
  const availCount = getAvailableCount(guildId);
  const available = getAvailableTouhous(guildId, 15);
  const listings = getListings(guildId);

  const lines = ['🏪 **Touhou Market**\n'];

  // Available for adoption
  lines.push(`**Available for adoption** (${availCount} total, showing ${available.length}):`);
  if (available.length === 0) {
    lines.push('_All Touhous are owned!_');
  } else {
    for (const t of available) {
      const rarity = getRarity(t.trade_count, t.name, t.base_rarity_score || 0);
      lines.push(`${rarity.emoji} **${t.name}** — ${BASE_ADOPT_PRICE} SGC`);
    }
    if (availCount > 15) {
      lines.push(`_...and ${availCount - 15} more. Use \`/lumi-touhou search\` to find specific ones._`);
    }
  }

  lines.push('');

  // Player listings
  lines.push(`**Player listings** (${listings.length}):`);
  if (listings.length === 0) {
    lines.push('_No Touhous listed for sale right now._');
  } else {
    for (const l of listings) {
      const sellerLevel = getOwnedLevel(guildId, l.touhou_name, l.seller_id);
      const rarity = getRarity(l.trade_count, l.touhou_name, l.base_rarity_score || 0, sellerLevel);
      const suggested = getSuggestedPrice(l.trade_count, l.base_rarity_score || 0, sellerLevel);
      lines.push(`${rarity.emoji} **${l.touhou_name}** — **${l.price} SGC** by <@${l.seller_id}> (Lv ${sellerLevel}, suggested: ~${suggested} SGC)`);
    }
  }

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleListings(interaction) {
  const guildId = interaction.guildId;
  const page = Math.max(1, interaction.options.getInteger('page', false) || 1);
  const total = getListingsCount(guildId);
  const totalPages = Math.max(1, Math.ceil(total / LISTINGS_PER_PAGE));
  if (page > totalPages) {
    await interaction.reply({ content: `❌ Page ${page} is out of range. There are ${totalPages} page(s).`, ephemeral: true });
    return;
  }

  const offset = (page - 1) * LISTINGS_PER_PAGE;
  const listings = getListingsPage(guildId, LISTINGS_PER_PAGE, offset);
  if (listings.length === 0) {
    await interaction.reply({ content: '🛒 No Touhous are currently listed for sale in this server.', ephemeral: true });
    return;
  }

  const lines = [`🛒 **Touhou Listings** (page ${page}/${totalPages}, ${total} total):`, ''];
  for (const l of listings) {
    const sellerLevel = getOwnedLevel(guildId, l.touhou_name, l.seller_id);
    const rarity = getRarity(l.trade_count, l.touhou_name, l.base_rarity_score || 0, sellerLevel);
    lines.push(`${rarity.emoji} **${l.touhou_name}** — **${l.price} SGC** by <@${l.seller_id}> (Lv ${sellerLevel})`);
  }
  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleInfo(interaction) {
  const guildId = interaction.guildId;
  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const touhou = getTouhou(guildId, touhouName);
  if (!touhou) {
    await interaction.reply({ content: `❌ That Touhou doesn't exist.`, ephemeral: true });
    return;
  }

  const ownerLevel = getOwnedLevel(guildId, touhouName, touhou.owner_id);
  const rarity = getRarity(touhou.trade_count, touhouName, touhou.base_rarity_score || 0, ownerLevel);
  const suggested = getSuggestedPrice(touhou.trade_count, touhou.base_rarity_score || 0, ownerLevel);
  const history = getTradeHistory(guildId, touhouName, 5);
  const attacks = getAttacks(touhouName);

  const stats = touhou.owner_id ? getOrCreateBattleStats(guildId, touhouName, touhou.owner_id) : null;
  const fainted = stats?.fainted_until && stats.fainted_until > Date.now();

  const lines = [
    `**${touhouName}** ${rarity.emoji} ${rarity.tier}${ownerLevel ? ` • Lv ${ownerLevel}` : ''}`,
    `Owner: ${touhou.owner_id ? `<@${touhou.owner_id}>` : '_Available for adoption_'}`,
    `Trades: **${touhou.trade_count}** | Base rarity score: **${touhou.base_rarity_score || 0}** | Suggested price: **~${suggested} SGC**`,
    `Popularity score: **${touhou.popularity_score || 0}** | Fandom comments: **${touhou.comment_count || 0}**${touhou.is_main_character ? ' | Main character boost: **Yes**' : ''}`,
    stats ? `Battle: **${stats.wins}W / ${stats.losses}L** | EXP: **${stats.exp}/${expToNextLevel(stats.level)}**${fainted ? ` | 💤 fainted (${formatRemaining(stats.fainted_until - Date.now())})` : ''}` : null,
    touhou.adopted_at ? `Adopted: ${touhou.adopted_at}` : null,
    touhou.last_traded ? `Last traded: ${touhou.last_traded}` : null,
  ].filter(Boolean);

  if (attacks.length > 0) {
    lines.push('', '**Attacks:**');
    for (const a of attacks) {
      lines.push(`• **${a.name}** — ${a.type} • ${a.basePower} pwr / ${a.accuracy}% acc`);
    }
  }

  if (history.length > 0) {
    lines.push('', '**Recent trade history:**');
    for (const h of history) {
      const fromLabel = h.from_user_id === '__MARKET__' ? 'Market' : `<@${h.from_user_id}>`;
      const toLabel = `<@${h.to_user_id}>`;
      const priceLabel = h.price > 0 ? ` for ${h.price} SGC` : '';
      lines.push(`• ${h.trade_type}: ${fromLabel} → ${toLabel}${priceLabel} (${h.created_at})`);
    }
  }

  const attachment = makeAttachment(touhouName);
  if (attachment) {
    await interaction.reply({ content: lines.join('\n'), files: [attachment], ephemeral: true });
  } else {
    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }
}

async function handleSearch(interaction) {
  const guildId = interaction.guildId;
  const query = interaction.options.getString('query', true);
  const results = searchTouhous(guildId, query);

  if (results.length === 0) {
    await interaction.reply({ content: `❌ No Touhous found matching **${query}**.`, ephemeral: true });
    return;
  }

  const lines = results.map((t) => {
    const rarity = getRarity(t.trade_count, t.name, t.base_rarity_score || 0);
    const owner = t.owner_id ? `<@${t.owner_id}>` : '_Available_';
    return `${rarity.emoji} **${t.name}** — ${owner} (${t.trade_count} trades, base ${t.base_rarity_score || 0})`;
  });

  await interaction.reply({ content: `🔍 **Search results for "${query}":**\n\n${lines.join('\n')}`, ephemeral: true });
}

async function handleStats(interaction) {
  const guildId = interaction.guildId;
  const stats = getMarketStats(guildId);

  const topTraded = stats.topTraded.map((t) => {
    const rarity = getRarity(t.trade_count, t.name);
    return `${rarity.emoji} **${t.name}** — ${t.trade_count} trades`;
  }).join('\n') || '_None yet_';

  const topCollectors = stats.topCollectors.map((c, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
    return `${prefix} <@${c.owner_id}> — ${c.cnt} Touhous`;
  }).join('\n') || '_None yet_';

  const lines = [
    '📊 **Touhou Market Stats**\n',
    `Total Touhous: **${stats.total}**`,
    `Owned: **${stats.owned}** | Available: **${stats.available}**`,
    `Total trades: **${stats.totalTrades}**`,
    `Active listings: **${stats.listings}**`,
    '',
    '**Most Traded:**',
    topTraded,
    '',
    '**Top Collectors:**',
    topCollectors,
  ];

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

// ---------------------------------------------------------------------------
// Buyback / Battle / Heal / Party handlers
// ---------------------------------------------------------------------------

async function handleBuyback(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  ensureAccount(userId, username);

  const result = sellbackToMarket(guildId, userId, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  payTouhouTraderPayout(userId, result.payout, `Touhou buyback: ${touhouName}`);

  await interaction.reply(
    `💸 You sold **${touhouName}** back to the market for **${result.payout} SGC**.\n` +
    `_Rarity preserved; level reset. The Touhou is back in the adoption pool._`
  );
}

async function handleBattle(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const nameInput = interaction.options.getString('name', true);
  const rarityChoice = interaction.options.getString('rarity', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  ensureAccount(userId, username);

  const touhou = getTouhou(guildId, touhouName);
  if (!touhou) {
    await interaction.reply({ content: `❌ That Touhou doesn't exist.`, ephemeral: true });
    return;
  }
  if (touhou.owner_id !== userId) {
    await interaction.reply({ content: `❌ You don't own **${touhouName}**.`, ephemeral: true });
    return;
  }

  const stats = getOrCreateBattleStats(guildId, touhouName, userId);
  if (stats.fainted_until && stats.fainted_until > Date.now()) {
    const remaining = formatRemaining(stats.fainted_until - Date.now());
    await interaction.reply({
      content: `💤 **${touhouName}** is fainted. Auto-heals in ${remaining}, or use \`/lumi-touhou heal name:${touhouName} pay:true\` to instantly heal for ${HEAL_COST} SGC.`,
      ephemeral: true,
    });
    return;
  }

  const attacks = getAttacks(touhouName);
  if (attacks.length === 0) {
    await interaction.reply({
      content: `❌ **${touhouName}** has no attacks seeded yet. Run \`npm run build:touhou-attacks\` and restart the bot.`,
      ephemeral: true,
    });
    return;
  }

  await startBattle({
    interaction,
    guildId,
    playerTouhou: touhou,
    playerStats: stats,
    playerAttacks: attacks,
    rarityChoice,
    touhouDir,
    payTouhouTraderPayout,
    getPotionCount,
    consumePotion,
  });
}

async function handleHeal(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const nameInput = interaction.options.getString('name', true);
  const pay = interaction.options.getBoolean ? interaction.options.getBoolean('pay') : null;
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  ensureAccount(userId, username);

  const touhou = getTouhou(guildId, touhouName);
  if (!touhou || touhou.owner_id !== userId) {
    await interaction.reply({ content: `❌ You don't own **${touhouName}**.`, ephemeral: true });
    return;
  }

  const stats = getOrCreateBattleStats(guildId, touhouName, userId);
  if (!stats.fainted_until) {
    await interaction.reply({ content: `✅ **${touhouName}** is already healthy and ready to battle!`, ephemeral: true });
    return;
  }

  // Cooldown already expired → free auto-heal
  if (stats.fainted_until <= Date.now()) {
    healTouhou(guildId, touhouName, userId);
    cancelFaintReminder(guildId, userId, touhouName);
    await interaction.reply({ content: `✨ **${touhouName}** has recovered and is ready to battle again!`, ephemeral: true });
    return;
  }

  // Still on cooldown
  if (!pay) {
    const remaining = formatRemaining(stats.fainted_until - Date.now());
    await interaction.reply({
      content: `💤 **${touhouName}** is still recovering. Auto-heals in **${remaining}**, or pay **${HEAL_COST} SGC** for instant heal:\n\`/lumi-touhou heal name:${touhouName} pay:true\``,
      ephemeral: true,
    });
    return;
  }

  // Pay-to-heal
  const balance = getBalance(userId);
  if (balance < HEAL_COST) {
    await interaction.reply({ content: `❌ You need **${HEAL_COST} SGC** to instant-heal but only have **${balance} SGC**.`, ephemeral: true });
    return;
  }

  adjustBalance(userId, -HEAL_COST, `Touhou instant-heal: ${touhouName}`);
  adjustBalance(TOUHOU_MGMT_USER_ID, HEAL_COST, `Touhou instant-heal fee: ${touhouName}`);
  healTouhou(guildId, touhouName, userId);
  cancelFaintReminder(guildId, userId, touhouName);

  await interaction.reply(`✨ Instant-healed **${touhouName}** for **${HEAL_COST} SGC**! Ready to battle.`);
}

async function handleParty(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const username = interaction.user.username;

  ensureAccount(userId, username);

  const touhous = getUserTouhous(guildId, userId);
  if (touhous.length === 0) {
    await interaction.reply({ content: `You don't have any Touhous yet. Use \`/lumi-touhou adopt\` to get one!`, ephemeral: true });
    return;
  }

  const potionCount = getPotionCount(guildId, userId);
  const lines = [`🛡️ **Your Battle Party** (${touhous.length}/${PARTY_LIMIT}) • Potions: **${potionCount}/${POTION_CAP}**`, ''];

  for (const t of touhous) {
    const stats = getOrCreateBattleStats(guildId, t.name, userId);
    const level = stats?.level || 1;
    const rarity = getRarity(t.trade_count, t.name, t.base_rarity_score || 0, level);
    const expNext = expToNextLevel(level);
    const fainted = stats.fainted_until && stats.fainted_until > Date.now();
    const status = fainted ? ` 💤 fainted (${formatRemaining(stats.fainted_until - Date.now())})` : '';
    const attacks = getAttacks(t.name);
    const attackList = attacks.length > 0
      ? attacks.map((a) => `${a.name}`).join(' / ')
      : '_no attacks yet_';

    lines.push(
      `${rarity.emoji} **${t.name}** — ${rarity.tier} • Lv **${level}** (EXP ${stats.exp}/${expNext}) • ${stats.wins}W/${stats.losses}L${status}`,
      `   ⚔️ ${attackList}`,
    );
  }

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

// ---------------------------------------------------------------------------
// Admin handlers
// ---------------------------------------------------------------------------

async function handleAssign(interaction) {
  const guildId = interaction.guildId;
  if (!isTouhouAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const nameInput = interaction.options.getString('name', true);
  const user = interaction.options.getUser('user', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const result = adminAssign(guildId, touhouName, user.id);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `✅ **${touhouName}** assigned to <@${user.id}>.`, ephemeral: true });
}

async function handleRelease(interaction) {
  const guildId = interaction.guildId;
  if (!isTouhouAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const result = adminRelease(guildId, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `✅ **${touhouName}** released back to the market.`, ephemeral: true });
}

async function handleResetTrades(interaction) {
  const guildId = interaction.guildId;
  if (!isTouhouAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const result = adminResetTrades(guildId, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `✅ Trade count reset for **${touhouName}**.`, ephemeral: true });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildTouhouCommand,
  handleTouhouCommand,
  setTouhouDir,
};
