/**
 * Private Stock Commands — slash commands for the Big Business stock market.
 *
 * /lumi-stocks buy <ticker> <amount>     Buy shares by investing SGC
 * /lumi-stocks sell <ticker> <shares>    Sell shares back
 * /lumi-stocks portfolio                 View your holdings
 * /lumi-stocks info <ticker>             View stock info + shareholders
 * /lumi-stocks list                      List all available stocks
 * /lumi-stocks offer <ticker>            Spawn a reaction-based buy offer
 * /lumi-stocks dividend <ticker>         Trigger dividend payout (admin)
 * /lumi-stocks price <ticker> <price>    Set share price (admin)
 * /lumi-stocks rate <ticker> <rate>      Set dividend rate (admin)
 * /lumi-stocks event-debug               Roll a random market event dry run (admin)
 * /lumi-stocks backfill-fees             Retroactive 5% Doll Street fee (admin)
 *
 * Shortened prefix command aliases:
 * !invest / !shares / !portfolio / !dividend
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { logger } = require('./logger');
const { getSetting } = require('./panelSettings');
const { BANK_OWNER_ID, ensureAccount } = require('./sadgirlEconomyStore');

const {
  getAllStocks,
  getStockByGuild,
  getStockById,
  getStockByTicker,
  buyShares,
  sellShares,
  getUserPortfolio,
  getUserHolding,
  getStockShareholders,
  getShareholderValue,
  getStockSummary,
  distributeDividend,
  setSharePrice,
  setDividendRate,
  getDividendHistory,
  syncStockUniverse,
  backfillDollStreetFees,
} = require('./privateStockStore');
const { rollMarketEvent } = require('./stockEvents');

let ECONOMY_ADMIN_ROLE_ID = '901304988083572756';
const DISCORD_MAX_CONTENT = 2000;

// Maps to track active buy-offer messages
const activeBuyOffers = new Map();

/**
 * Check if user is economy admin.
 */
function isEconomyAdmin(interaction) {
  if (interaction.user.id === BANK_OWNER_ID) return true;
  return interaction.member?.roles?.cache?.has(ECONOMY_ADMIN_ROLE_ID) ?? false;
}

/**
 * Find a stock by ticker or guild context.
 */
function resolveStock(tickerOrId, guildId) {
  syncStockUniverse();

  const byTicker = getStockByTicker(String(tickerOrId));
  if (byTicker) return byTicker;

  // Try by stock ID
  const byId = getStockById(Number(tickerOrId));
  if (byId) return byId;

  // Try by guild context
  if (guildId) {
    const byGuild = getStockByGuild(guildId);
    if (byGuild) return byGuild;
  }

  return null;
}

function splitDiscordMessage(text, maxLen = DISCORD_MAX_CONTENT) {
  const source = String(text ?? '');
  if (source.length <= maxLen) return [source];

  const chunks = [];
  let remaining = source;

  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    let splitPoint = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf(' | '),
      window.lastIndexOf(' '),
    );

    if (splitPoint < Math.floor(maxLen * 0.4)) {
      splitPoint = maxLen;
    }

    chunks.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

async function replyChunked(interaction, text, { ephemeral = false } = {}) {
  const chunks = splitDiscordMessage(text);
  await interaction.reply({ content: chunks[0], ephemeral });

  for (let index = 1; index < chunks.length; index += 1) {
    await interaction.followUp({ content: chunks[index], ephemeral });
  }
}

async function editReplyChunked(interaction, text, { ephemeral = false } = {}) {
  const chunks = splitDiscordMessage(text);
  await interaction.editReply({ content: chunks[0] });

  for (let index = 1; index < chunks.length; index += 1) {
    await interaction.followUp({ content: chunks[index], ephemeral });
  }
}

// ---------------------------------------------------------------------------
// Slash command builder
// ---------------------------------------------------------------------------

function buildPrivateStockCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-stocks')
    .setDescription('Big Business Stock Market — buy and sell shares of Big Businesses.')
    .addSubcommand((sub) => sub
      .setName('buy')
      .setDescription('Buy shares of a Big Business stock.')
      .addStringOption((opt) => opt.setName('ticker').setDescription('Stock ticker (e.g., BBI)').setRequired(true))
      .addIntegerOption((opt) => opt.setName('amount').setDescription('SGC to invest').setMinValue(1).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('sell')
      .setDescription('Sell shares of a Big Business stock.')
      .addStringOption((opt) => opt.setName('ticker').setDescription('Stock ticker (e.g., BBI)').setRequired(true))
      .addNumberOption((opt) => opt.setName('shares').setDescription('Number of shares to sell').setMinValue(0.01).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('portfolio')
      .setDescription('View your stock portfolio.'))
    .addSubcommand((sub) => sub
      .setName('info')
      .setDescription('View detailed stock information.')
      .addStringOption((opt) => opt.setName('ticker').setDescription('Stock ticker (e.g., BBI)').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List all available Big Business stocks.'))
    .addSubcommand((sub) => sub
      .setName('offer')
      .setDescription('Post a buy-offer message with reaction buttons.')
      .addStringOption((opt) => opt.setName('ticker').setDescription('Stock ticker (e.g., BBI)').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('dividend')
      .setDescription('Trigger a dividend payout (admin only).')
      .addStringOption((opt) => opt.setName('ticker').setDescription('Stock ticker').setRequired(true))
      .addIntegerOption((opt) => opt.setName('amount').setDescription('Override pool amount (optional)').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('price')
      .setDescription('Set share price (admin only).')
      .addStringOption((opt) => opt.setName('ticker').setDescription('Stock ticker').setRequired(true))
      .addNumberOption((opt) => opt.setName('value').setDescription('New price per share in SGC').setMinValue(0.01).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('rate')
      .setDescription('Set dividend rate (admin only).')
      .addStringOption((opt) => opt.setName('ticker').setDescription('Stock ticker').setRequired(true))
      .addNumberOption((opt) => opt.setName('percent').setDescription('Dividend rate as percentage (e.g., 5 for 5%)').setMinValue(0).setMaxValue(100).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('event-debug')
      .setDescription('Roll a random market event (dry run, no price impact). Admin only.'))
    .addSubcommand((sub) => sub
      .setName('backfill-fees')
      .setDescription('Retroactively apply 5% Doll Street fee to all past buys. Admin only.')
      .addBooleanOption((opt) => opt.setName('confirm').setDescription('Set true to actually run (false = dry run)').setRequired(false)))
    .toJSON();
}

// ---------------------------------------------------------------------------
// Main handler router
// ---------------------------------------------------------------------------

async function handlePrivateStockCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'buy':      return handleStockBuy(interaction);
    case 'sell':     return handleStockSell(interaction);
    case 'portfolio': return handleStockPortfolio(interaction);
    case 'info':     return handleStockInfo(interaction);
    case 'list':     return handleStockList(interaction);
    case 'offer':    return handleStockOffer(interaction);
    case 'dividend': return handleStockDividend(interaction);
    case 'price':    return handleStockPriceSet(interaction);
    case 'rate':     return handleStockRateSet(interaction);
    case 'event-debug': return handleEventDebug(interaction);
    case 'backfill-fees': return handleBackfillFees(interaction);
    default:
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleStockBuy(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const ticker = interaction.options.getString('ticker', true);
  const amount = interaction.options.getInteger('amount', true);

  const stock = resolveStock(ticker, interaction.guildId);
  if (!stock) {
    await interaction.reply({ content: `❌ Stock \`${ticker}\` not found. Use \`/lumi-stocks list\` to see available stocks.`, ephemeral: true });
    return;
  }

  const result = buyShares(userId, username, stock.id, amount);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const lines = [
    `📈 **Share Purchase Confirmed**`,
    `> **${stock.business_name}** (${stock.ticker})${stock.entity_type === 'synthetic' ? ' • Synthetic' : ''}`,
    `> Invested: **${amount.toLocaleString()} SGC**`,
    `> Shares acquired: **${result.shares.toFixed(4)}**`,
    `> Price per share: **${result.pricePerShare.toFixed(2)} SGC**`,
    `> Your total holdings: **${result.totalShares.toFixed(4)} shares**`,
    result.newPrice ? `> New market price: **${result.newPrice.toFixed(2)} SGC**` : '',
  ];

  await interaction.reply(lines.join('\n'));
}

async function handleStockSell(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const ticker = interaction.options.getString('ticker', true);
  const shares = interaction.options.getNumber('shares', true);

  const stock = resolveStock(ticker, interaction.guildId);
  if (!stock) {
    await interaction.reply({ content: `❌ Stock \`${ticker}\` not found.`, ephemeral: true });
    return;
  }

  const result = sellShares(userId, username, stock.id, shares);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  const lines = [
    `📉 **Shares Sold**`,
    `> **${stock.business_name}** (${stock.ticker})${stock.entity_type === 'synthetic' ? ' • Synthetic' : ''}`,
    `> Shares sold: **${shares.toFixed(4)}**`,
    `> Proceeds: **${result.proceeds.toLocaleString()} SGC**`,
    `> Remaining shares: **${result.remainingShares.toFixed(4)}**`,
    result.newPrice ? `> New market price: **${result.newPrice.toFixed(2)} SGC**` : '',
  ];

  await interaction.reply(lines.join('\n'));
}

async function handleStockPortfolio(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  ensureAccount(userId, username);

  const holdings = getUserPortfolio(userId);
  if (holdings.length === 0) {
    await interaction.reply({ content: '📊 You don\'t own any Big Business shares yet. Use `/lumi-stocks buy` to invest!', ephemeral: true });
    return;
  }

  let totalPortfolioValue = 0;
  let totalInvested = 0;
  let totalDividends = 0;

  const lines = holdings.map((h) => {
    const val = getShareholderValue(h, h.share_price);
    totalPortfolioValue += val.totalValue;
    totalInvested += val.totalInvested;
    totalDividends += val.totalDividends;

    const plSign = val.profitLoss >= 0 ? '+' : '';
    const plEmoji = val.profitLoss >= 0 ? '🟢' : '🔴';

    return [
      `**${h.ticker}** — ${h.business_name}${h.entity_type === 'synthetic' ? ' • Synth' : h.status !== 'active' ? ' • Delisted' : ''}`,
      `Shares: ${val.shares.toFixed(4)} @ $${val.currentPrice.toFixed(2)} | MV: ${val.marketValue.toFixed(0)} | Div: ${val.totalDividends.toFixed(0)} | Total: ${val.totalValue.toFixed(0)} | ${plEmoji} P/L: ${plSign}${val.profitLoss.toFixed(0)} (${plSign}${val.profitPct.toFixed(1)}%)`,
    ].join('\n');
  });

  const totalPL = totalPortfolioValue - totalInvested;
  const totalPLPct = totalInvested > 0 ? ((totalPL / totalInvested) * 100) : 0;
  const plSign = totalPL >= 0 ? '+' : '';

  const header = [
    `📊 **${username}'s Stock Portfolio**`,
    '',
    `💰 Total Invested: **${totalInvested.toFixed(0)} SGC**`,
    `📈 Portfolio Value: **${totalPortfolioValue.toFixed(0)} SGC**`,
    `🎁 Total Dividends: **${totalDividends.toFixed(0)} SGC**`,
    `${totalPL >= 0 ? '🟢' : '🔴'} Overall P/L: ${plSign}${totalPL.toFixed(0)} SGC (${plSign}${totalPLPct.toFixed(1)}%)`,
    '',
  ];

  await replyChunked(interaction, [...header, ...lines].join('\n'), { ephemeral: true });
}

async function handleStockInfo(interaction) {
  const ticker = interaction.options.getString('ticker', true);

  const stock = resolveStock(ticker, interaction.guildId);
  if (!stock) {
    await interaction.reply({ content: `❌ Stock \`${ticker}\` not found.`, ephemeral: true });
    return;
  }

  const summary = getStockSummary(stock.id);
  if (!summary) {
    await interaction.reply({ content: '❌ Could not load stock data.', ephemeral: true });
    return;
  }

  const shareholders = getStockShareholders(stock.id);
  const top10 = shareholders.slice(0, 10);
  const holderLines = top10.length > 0
    ? top10.map((h, i) => {
      const val = getShareholderValue(h, summary.share_price);
      return `**${i + 1}.** ${h.username || h.user_id} — **${h.shares.toFixed(4)} shares** (${val.marketValue.toFixed(0)} SGC)`;
    }).join('\n')
    : '_No shareholders yet._';

  const priceChange = ((summary.share_price - summary.initial_price) / summary.initial_price * 100);
  const priceEmoji = priceChange >= 0 ? '🟢' : '🔴';
  const priceSign = priceChange >= 0 ? '+' : '';

  const dividendHistory = getDividendHistory(stock.id, 3);
  const divLines = dividendHistory.length > 0
    ? dividendHistory.map((d) =>
      `> ${d.created_at} — **${d.total_distributed.toFixed(0)} SGC** to ${d.shareholders_paid} holders (${d.dividend_per_share.toFixed(4)} SGC/share)`
    ).join('\n')
    : '> _No dividends paid yet._';

  const lines = [
    `🏢 **${summary.business_name}** (${summary.ticker})${summary.isSynthetic ? ' • Synthetic Listing' : ' • Guild Listing'}`,
    '',
    `📊 **Share Price:** ${summary.share_price.toFixed(2)} SGC ${priceEmoji} ${priceSign}${priceChange.toFixed(1)}% from IPO (${summary.initial_price.toFixed(2)} SGC)`,
    `📈 **Market Cap:** ${summary.marketCap.toFixed(0)} SGC`,
    `🏦 **Business Value:** ${summary.treasuryBalance.toLocaleString()} SGC`,
    `💼 **User Investment Capital:** ${summary.investedCapital.toLocaleString()} SGC`,
    `📋 **Total Shares Outstanding:** ${summary.totalSharesOutstanding.toFixed(4)}`,
    `👥 **Shareholders:** ${summary.shareholderCount}`,
    `💸 **Dividend Rate:** ${(summary.dividend_rate * 100).toFixed(1)}%`,
    `📉 **Revenue Growth:** ${summary.metrics.revenueGrowthPct >= 0 ? '+' : ''}${summary.metrics.revenueGrowthPct.toFixed(1)}%`,
    `🧾 **Operating Margin:** ${summary.metrics.operatingMarginPct.toFixed(1)}%`,
    `💵 **Cash Flow vs Avg:** ${summary.metrics.cashFlowPct >= 0 ? '+' : ''}${summary.metrics.cashFlowPct.toFixed(1)}%`,
    `🗣️ **Guidance / Sentiment:** ${summary.metrics.guidancePct >= 0 ? '+' : ''}${summary.metrics.guidancePct.toFixed(1)}% • ${summary.metrics.sentiment}`,
    `🎁 **Total Dividends Paid:** ${summary.total_dividends_paid.toFixed(0)} SGC`,
    summary.last_dividend ? `📅 **Last Dividend:** ${summary.last_dividend}` : '',
    `📅 **IPO Date:** ${summary.ipo_date}`,
    '',
    '**Top 10 Shareholders:**',
    holderLines,
    '',
    '**Recent Dividends:**',
    divLines,
  ].filter(Boolean);

  await replyChunked(interaction, lines.join('\n'), { ephemeral: true });
}

async function handleStockList(interaction) {
  syncStockUniverse();
  const stocks = getAllStocks();
  if (stocks.length === 0) {
    await interaction.reply({ content: '📊 No Big Business stocks available yet.', ephemeral: true });
    return;
  }

  const lines = stocks.map((s) => {
    const summary = getStockSummary(s.id);
    const priceChange = ((s.share_price - s.initial_price) / s.initial_price * 100);
    const emoji = priceChange >= 0 ? '🟢' : '🔴';
    const sign = priceChange >= 0 ? '+' : '';

    return [
      `**${s.ticker}** — ${s.business_name}${summary?.isSynthetic ? ' • Synthetic' : ''}`,
      `Price: $${s.share_price.toFixed(2)}  ${emoji} ${sign}${priceChange.toFixed(1)}% | MC: ${(summary?.marketCap || 0).toFixed(0)} | Holders: ${summary?.shareholderCount || 0}`,
      `BV: ${(summary?.treasuryBalance || 0).toFixed(0)} | IC: ${(summary?.investedCapital || 0).toFixed(0)} | Rev: ${summary?.metrics?.revenueGrowthPct >= 0 ? '+' : ''}${summary?.metrics?.revenueGrowthPct?.toFixed(1) || '0.0'}% | Margin: ${summary?.metrics?.operatingMarginPct?.toFixed(1) || '0.0'}% | Sentiment: ${summary?.metrics?.sentiment || 'Stable'}`,
    ].join('\n');
  });

  await replyChunked(interaction, `📊 **Big Business Stock Market**\n\n${lines.join('\n\n')}`, { ephemeral: true });
}

// ---------------------------------------------------------------------------
// Reaction-based buy offer (button UI)
// ---------------------------------------------------------------------------

async function handleStockOffer(interaction) {
  const ticker = interaction.options.getString('ticker', true);

  const stock = resolveStock(ticker, interaction.guildId);
  if (!stock) {
    await interaction.reply({ content: `❌ Stock \`${ticker}\` not found.`, ephemeral: true });
    return;
  }

  const amounts = [5, 10, 20, 50, 100];
  const row = new ActionRowBuilder().addComponents(
    amounts.map((amt) =>
      new ButtonBuilder()
        .setCustomId(`stock_buy_${stock.id}_${amt}`)
        .setLabel(`${amt} SGC`)
        .setStyle(amt <= 10 ? ButtonStyle.Secondary : amt <= 50 ? ButtonStyle.Primary : ButtonStyle.Success)
        .setEmoji('💰')
    )
  );

  const offerText = [
    `🏢 **${stock.business_name}** (${stock.ticker})${stock.entity_type === 'synthetic' ? ' • Synthetic Listing' : ''} — Investment Offer`,
    '',
    `📊 Current Share Price: **${stock.share_price.toFixed(2)} SGC**`,
    `📈 Dividend Rate: **${(stock.dividend_rate * 100).toFixed(1)}%**`,
    '',
    '**Click a button below to invest:**',
    amounts.map((amt) => {
      const shares = (amt / stock.share_price).toFixed(4);
      return `> 💰 **${amt} SGC** → ${shares} shares`;
    }).join('\n'),
    '',
    '_Fractional shares are tracked. All investments go to the corporate treasury._',
  ].join('\n');

  const reply = await interaction.reply({ content: offerText, components: [row], fetchReply: true });

  // Track this offer message
  if (reply) {
    activeBuyOffers.set(reply.id, {
      stockId: stock.id,
      ticker: stock.ticker,
      businessName: stock.business_name,
      channelId: interaction.channelId,
      createdBy: interaction.user.id,
      createdAt: Date.now(),
    });

    // Auto-expire after 24 hours
    setTimeout(() => {
      activeBuyOffers.delete(reply.id);
    }, 24 * 60 * 60 * 1000);
  }
}

/**
 * Handle button interactions for stock buy offers.
 * Called from the main InteractionCreate event.
 */
async function handleStockButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('stock_buy_')) return false;

  const parts = interaction.customId.split('_');
  // stock_buy_<stockId>_<amount>
  const stockId = parseInt(parts[2], 10);
  const amount = parseInt(parts[3], 10);

  if (!stockId || !amount) {
    await interaction.reply({ content: '❌ Invalid buy offer.', ephemeral: true });
    return true;
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;

  const result = buyShares(userId, username, stockId, amount);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return true;
  }

  const stock = getStockById(stockId);
  const tickerName = stock ? `${stock.business_name} (${stock.ticker})` : `Stock #${stockId}`;

  await interaction.reply({
    content: [
      `📈 **Investment Confirmed!**`,
      `> ${tickerName}`,
      `> Invested: **${amount} SGC** → **${result.shares.toFixed(4)} shares**`,
      `> Total holdings: **${result.totalShares.toFixed(4)} shares**`,
    ].join('\n'),
    ephemeral: true,
  });

  return true;
}

// ---------------------------------------------------------------------------
// Admin commands
// ---------------------------------------------------------------------------

async function handleStockDividend(interaction) {
  if (!isEconomyAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only economy admins can trigger dividends.', ephemeral: true });
    return;
  }

  const ticker = interaction.options.getString('ticker', true);
  const overrideAmount = interaction.options.getInteger('amount', false) || null;

  const stock = resolveStock(ticker, interaction.guildId);
  if (!stock) {
    await interaction.reply({ content: `❌ Stock \`${ticker}\` not found.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const result = distributeDividend(stock.id, overrideAmount);
  if (!result.success) {
    await interaction.editReply(`❌ ${result.error}`);
    return;
  }

  const payoutLines = result.details.map((d) =>
    `<@${d.userId}>: ${d.shares.toFixed(4)} shares → ${d.payout.toLocaleString()} SGC`
  );

  const summaryText = [
    `💸 **Dividend Distribution — ${stock.business_name} (${stock.ticker})**`,
    '',
    `Pool: ${result.pool.toLocaleString()} SGC | Rate: ${result.perShare.toFixed(4)} SGC/share | Holders: ${result.shareholders} | Total: ${result.distributed.toLocaleString()} SGC`,
    '',
    '**Payouts:**',
    ...payoutLines,
  ].join('\n');

  await editReplyChunked(interaction, summaryText);

  // Also generate an LLM announcement for the BigBusiness channel
  try {
    await announceDividend(interaction.client, stock, result);
  } catch (error) {
    logger.warn('Failed to post dividend announcement.', error.message);
  }
}

async function handleStockPriceSet(interaction) {
  if (!isEconomyAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only economy admins can set prices.', ephemeral: true });
    return;
  }

  const ticker = interaction.options.getString('ticker', true);
  const newPrice = interaction.options.getNumber('value', true);

  const stock = resolveStock(ticker, interaction.guildId);
  if (!stock) {
    await interaction.reply({ content: `❌ Stock \`${ticker}\` not found.`, ephemeral: true });
    return;
  }

  const result = setSharePrice(stock.id, newPrice);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply(
    `📊 **${stock.ticker}** share price updated: **${result.oldPrice.toFixed(2)}** → **${result.newPrice.toFixed(2)} SGC**`
  );
}

async function handleStockRateSet(interaction) {
  if (!isEconomyAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only economy admins can set dividend rates.', ephemeral: true });
    return;
  }

  const ticker = interaction.options.getString('ticker', true);
  const percent = interaction.options.getNumber('percent', true);

  const stock = resolveStock(ticker, interaction.guildId);
  if (!stock) {
    await interaction.reply({ content: `❌ Stock \`${ticker}\` not found.`, ephemeral: true });
    return;
  }

  const rate = percent / 100;
  const result = setDividendRate(stock.id, rate);
  if (!result.success) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    return;
  }

  await interaction.reply(
    `💸 **${stock.ticker}** dividend rate updated to **${percent.toFixed(1)}%**`
  );
}

// ---------------------------------------------------------------------------
// Event debug (dry run — no price impact)
// ---------------------------------------------------------------------------

async function handleEventDebug(interaction) {
  if (!isEconomyAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await rollMarketEvent({ dryRun: true });
    const preview = [
      `🔍 **Event Debug (Dry Run)**`,
      '',
      `**Event:** ${result.event.id}`,
      `**Headline:** ${result.event.headline}`,
      `**Keywords:** ${result.event.keywords.join(', ')}`,
      `**Severity range:** ${result.event.minSeverity} to ${result.event.maxSeverity}`,
      `**Affected stocks:** ${result.affected.length > 0 ? result.affected.map((s) => `${s.ticker} (${s.business_name})`).join(', ') : '_none_'}`,
      '',
      '--- **Generated Story** ---',
      result.story,
      '',
      '--- **Full Message Preview** ---',
      result.message,
    ].join('\n');

    // Chunk if needed (ephemeral replies have the same 2000 char limit)
    await replyChunked(interaction, preview);
  } catch (error) {
    logger.error('Event debug failed.', error.message);
    await interaction.editReply({ content: `❌ Event debug failed: ${error.message}` });
  }
}

// ---------------------------------------------------------------------------
// Backfill Doll Street fees
// ---------------------------------------------------------------------------

async function handleBackfillFees(interaction) {
  if (!isEconomyAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    return;
  }

  const confirm = interaction.options.getBoolean('confirm') === true;
  const dryRun = !confirm;

  try {
    const result = backfillDollStreetFees({ dryRun });

    if (result.alreadyRan) {
      await interaction.reply({ content: '⚠️ Backfill has already been applied. No changes made.', ephemeral: true });
      return;
    }

    const lines = [
      dryRun ? '🔍 **Backfill Dry Run** (no balances changed)' : '✅ **Backfill Applied**',
      '',
      `**Historical buy transactions:** ${result.txnCount}`,
      `**Total 5% fee:** ${result.totalFee.toLocaleString()} SGC`,
      '',
      dryRun
        ? '_Run with `confirm: True` to deposit into Doll Street._'
        : `_${result.totalFee.toLocaleString()} SGC deposited into Doll Street._`,
    ];

    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
  } catch (error) {
    logger.error('Backfill fees failed.', error.message);
    await interaction.reply({ content: `❌ Backfill failed: ${error.message}`, ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Dividend announcement (LLM-generated, posted to BigBusiness channel)
// ---------------------------------------------------------------------------

const BIG_BUSINESS_LLM_ENDPOINT = 'http://100.83.3.32:11434';
const BIG_BUSINESS_LLM_MODEL = 'server-2';
const BIG_BUSINESS_LLM_TIMEOUT_MS = 20_000;

function stripThinkingTags(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .replace(/<\/?think>/giu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

async function generateDividendAnnouncement(stock, dividendResult) {
  const prompt = [
    `System: You are a corporate communications officer for "${stock.business_name}", a satirical mega-corporation in the SadGirlCoin economy.`,
    'System: Write a short, funny quarterly dividend announcement. Be absurdly corporate, use buzzwords. 2-3 sentences max. No emojis.',
    'System: Do not use think tags or reasoning.',
    `${stock.business_name} (ticker: ${stock.ticker}) just paid out a dividend of ${dividendResult.distributed} SadGirlCoin to ${dividendResult.shareholders} shareholders.`,
    `Each share received ${dividendResult.perShare.toFixed(4)} SGC. The total dividend pool was ${dividendResult.pool} SGC.`,
    `The current share price is ${stock.share_price.toFixed(2)} SGC.`,
    'Write the dividend announcement:',
  ].join('\n\n');

  try {
    const response = await fetch(`${BIG_BUSINESS_LLM_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: BIG_BUSINESS_LLM_MODEL,
        stream: false,
        prompt,
      }),
      signal: AbortSignal.timeout(BIG_BUSINESS_LLM_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const completion = typeof payload.response === 'string' ? payload.response : '';
    const cleaned = stripThinkingTags(completion);
    if (cleaned) return cleaned;
  } catch (error) {
    logger.warn('Dividend LLM announcement failed, using fallback.', error.message);
  }

  return `${stock.business_name} is proud to announce a distribution of ${dividendResult.distributed} SGC to our valued shareholders. Synergy achieved.`;
}

async function announceDividend(client, stock, dividendResult) {
  if (!client) return;
  if (stock.entity_type === 'synthetic') return;

  const { getGuildConfig } = require('./guildConfig');
  const guildCfg = getGuildConfig(stock.guild_id);
  const channelId = guildCfg?.bigBusinessChannelId;
  const roleMention = guildCfg?.bigBusinessRoleId ? `<@&${guildCfg.bigBusinessRoleId}>\n` : '';
  if (!channelId) {
    logger.warn(`Private Stock: no channel configured for guild ${stock.guild_id} dividend announcement.`);
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    logger.warn(`Private Stock: channel ${channelId} not found.`);
    return;
  }

  const announcement = await generateDividendAnnouncement(stock, dividendResult);

  // Build the formatted message
  const topEarners = dividendResult.details
    .sort((a, b) => b.payout - a.payout)
    .slice(0, 5)
    .map((d, i) => `**${i + 1}.** ${d.username || d.userId} — **${d.payout.toLocaleString()} SGC** (${d.shares.toFixed(2)} shares)`)
    .join('\n');

  const text = [
    `💸 **${stock.business_name} (${stock.ticker}) — Dividend Distribution**`,
    '',
    announcement,
    '',
    `📊 **Dividend Summary:**`,
    `> Total Pool: **${dividendResult.pool.toLocaleString()} SGC**`,
    `> Per Share: **${dividendResult.perShare.toFixed(4)} SGC**`,
    `> Shareholders Paid: **${dividendResult.shareholders}**`,
    `> Total Distributed: **${dividendResult.distributed.toLocaleString()} SGC**`,
    '',
    '**Top Earners:**',
    topEarners || '_None_',
    '',
    `_Share Price: ${stock.share_price.toFixed(2)} SGC | Invest with \`/lumi-stocks buy ${stock.ticker} <amount>\`_`,
  ].join('\n');

  await channel.send(`${roleMention}${text}`);
  logger.info(`Private Stock: dividend announcement posted for ${stock.ticker}.`);
}

// ---------------------------------------------------------------------------
// Settings reload
// ---------------------------------------------------------------------------

function reloadSettings() {
  try {
    ECONOMY_ADMIN_ROLE_ID = getSetting('economy.adminRoleId');
  } catch { /* DB not ready */ }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildPrivateStockCommand,
  handlePrivateStockCommand,
  handleStockButtonInteraction,
  announceDividend,
  reloadSettings,
};
