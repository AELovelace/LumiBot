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
  buyListing,
  getTradeHistory,
  adminAssign,
  adminRelease,
  adminResetTrades,
  getMarketStats,
  searchTouhous,
} = require('./touhouStore');

const {
  CENTRAL_BANK_USER_ID,
  TOUHOU_MGMT_USER_ID,
  getBalance,
  ensureAccount,
  adjustBalance,
} = require('./sadgirlEconomyStore');

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
      .setDescription('Buy a listed Touhou from another user.')
      .addStringOption((opt) => opt.setName('name').setDescription('Touhou name').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('market')
      .setDescription('Browse available Touhous and active listings.'))
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

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handleTouhouCommand(interaction) {
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
    case 'info': return handleInfo(interaction);
    case 'search': return handleSearch(interaction);
    case 'stats': return handleStats(interaction);
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
  const userId = interaction.user.id;
  const username = interaction.user.username;

  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < BASE_ADOPT_PRICE) {
    await interaction.reply({ content: `❌ You need **${BASE_ADOPT_PRICE} SGC** to adopt a Touhou but you only have **${balance} SGC**.`, ephemeral: true });
    return;
  }

  const result = adoptTouhou(userId);
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
  const targetUser = interaction.options.getUser('user', false) || interaction.user;
  const touhous = getUserTouhous(targetUser.id);

  if (touhous.length === 0) {
    const label = targetUser.id === interaction.user.id ? 'You don\'t' : `**${targetUser.username}** doesn't`;
    await interaction.reply({ content: `${label} have any Touhous yet. Use \`/lumi-touhou adopt\` to get one!`, ephemeral: true });
    return;
  }

  const lines = touhous.map((t) => {
    const rarity = getRarity(t.trade_count, t.name, t.base_rarity_score || 0);
    const price = getSuggestedPrice(t.trade_count, t.base_rarity_score || 0);
    return `${rarity.emoji} **${t.name}** — ${rarity.tier} (${t.trade_count} trades, base ${t.base_rarity_score || 0}, ~${price} SGC)`;
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

  const result = sendTouhou(userId, recipient.id, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const rarity = getRarity(result.touhou.trade_count, touhouName, result.touhou.base_rarity_score || 0);
  await interaction.reply(`🎁 <@${userId}> gifted **${touhouName}** to <@${recipient.id}>! ${rarity.emoji} ${rarity.tier} (${result.touhou.trade_count} trades)`);
}

async function handleTrade(interaction) {
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

    const result = swapTouhous(userA.id, touhouAName, userB.id, touhouBName);
    if (!result.success) {
      await btn.update({ content: `❌ Trade failed: ${result.error}`, components: [] });
      collector.stop('failed');
      return;
    }

    const touhouA = getTouhou(touhouAName);
    const touhouB = getTouhou(touhouBName);
    const rarityA = getRarity(touhouA.trade_count, touhouAName, touhouA.base_rarity_score || 0);
    const rarityB = getRarity(touhouB.trade_count, touhouBName, touhouB.base_rarity_score || 0);
    await btn.update({
      content:
        `🔄 **Trade complete!**\n` +
        `<@${userA.id}> gave **${touhouAName}** ${rarityA.emoji} ↔ <@${userB.id}> gave **${touhouBName}** ${rarityB.emoji}`,
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
  const userId = interaction.user.id;
  const nameInput = interaction.options.getString('name', true);
  const price = interaction.options.getInteger('price', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const result = listForSale(userId, touhouName, price);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const touhou = getTouhou(touhouName);
  const rarity = getRarity(touhou.trade_count, touhouName, touhou.base_rarity_score || 0);
  const suggested = getSuggestedPrice(touhou.trade_count, touhou.base_rarity_score || 0);
  await interaction.reply(
    `🏷️ **${touhouName}** listed for sale at **${price} SGC**! ${rarity.emoji} ${rarity.tier}\n` +
    `_Suggested price based on rarity: ~${suggested} SGC_`
  );
}

async function handleDelist(interaction) {
  const userId = interaction.user.id;
  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const result = delistTouhou(userId, touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `✅ **${touhouName}** has been removed from the marketplace.`, ephemeral: true });
}

async function handleBuy(interaction) {
  const buyerId = interaction.user.id;
  const buyerName = interaction.user.username;
  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  ensureAccount(buyerId, buyerName);
  const balance = getBalance(buyerId);

  // Peek at listing price before consuming it
  const touhou = getTouhou(touhouName);
  if (!touhou) {
    await interaction.reply({ content: `❌ That Touhou doesn't exist.`, ephemeral: true });
    return;
  }

  // Pre-check balance against listing price
  const { getListingPrice } = require('./touhouStore');
  const listingPrice = getListingPrice(touhouName);
  if (listingPrice === null) {
    await interaction.reply({ content: `❌ **${touhouName}** is not listed for sale.`, ephemeral: true });
    return;
  }

  if (balance < listingPrice) {
    await interaction.reply({ content: `❌ You need **${listingPrice} SGC** but only have **${balance} SGC**.`, ephemeral: true });
    return;
  }

  const result = buyListing(buyerId, touhouName);
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

  const rarity = getRarity(result.touhou.trade_count, touhouName, result.touhou.base_rarity_score || 0);
  const attachment = makeAttachment(touhouName);
  const content = `💰 <@${buyerId}> bought **${touhouName}** from <@${result.sellerId}> for **${result.price} SGC**! (${tax} SGC tax → Touhou Management Inc) ${rarity.emoji} ${rarity.tier}`;

  if (attachment) {
    await interaction.reply({ content, files: [attachment] });
  } else {
    await interaction.reply(content);
  }
}

async function handleMarket(interaction) {
  const availCount = getAvailableCount();
  const available = getAvailableTouhous(15);
  const listings = getListings();

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
      const rarity = getRarity(l.trade_count, l.touhou_name, l.base_rarity_score || 0);
      const suggested = getSuggestedPrice(l.trade_count, l.base_rarity_score || 0);
      lines.push(`${rarity.emoji} **${l.touhou_name}** — **${l.price} SGC** by <@${l.seller_id}> (suggested: ~${suggested} SGC)`);
    }
  }

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleInfo(interaction) {
  const nameInput = interaction.options.getString('name', true);
  const touhouName = resolveName(nameInput);

  if (!touhouName) {
    await interaction.reply({ content: `❌ Couldn't find a Touhou named **${nameInput}**.`, ephemeral: true });
    return;
  }

  const touhou = getTouhou(touhouName);
  if (!touhou) {
    await interaction.reply({ content: `❌ That Touhou doesn't exist.`, ephemeral: true });
    return;
  }

  const rarity = getRarity(touhou.trade_count, touhouName, touhou.base_rarity_score || 0);
  const suggested = getSuggestedPrice(touhou.trade_count, touhou.base_rarity_score || 0);
  const history = getTradeHistory(touhouName, 5);

  const lines = [
    `**${touhouName}** ${rarity.emoji} ${rarity.tier}`,
    `Owner: ${touhou.owner_id ? `<@${touhou.owner_id}>` : '_Available for adoption_'}`,
    `Trades: **${touhou.trade_count}** | Base rarity score: **${touhou.base_rarity_score || 0}** | Suggested price: **~${suggested} SGC**`,
    `Popularity score: **${touhou.popularity_score || 0}** | Fandom comments: **${touhou.comment_count || 0}**${touhou.is_main_character ? ' | Main character boost: **Yes**' : ''}`,
    touhou.adopted_at ? `Adopted: ${touhou.adopted_at}` : null,
    touhou.last_traded ? `Last traded: ${touhou.last_traded}` : null,
  ].filter(Boolean);

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
  const query = interaction.options.getString('query', true);
  const results = searchTouhous(query);

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
  const stats = getMarketStats();

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
// Admin handlers
// ---------------------------------------------------------------------------

async function handleAssign(interaction) {
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

  const result = adminAssign(touhouName, user.id);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `✅ **${touhouName}** assigned to <@${user.id}>.`, ephemeral: true });
}

async function handleRelease(interaction) {
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

  const result = adminRelease(touhouName);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `✅ **${touhouName}** released back to the market.`, ephemeral: true });
}

async function handleResetTrades(interaction) {
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

  const result = adminResetTrades(touhouName);
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
