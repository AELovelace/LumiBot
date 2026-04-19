/**
 * SadGirlCoin Stock Activation — reaction-based market activation.
 *
 * When a pending stock market message gets ⭐ reacts:
 *   - Each unique star-reactor is charged 3 SGC (added to market pool)
 *   - At 3+ stars the market goes live
 *   - An in-character Lumi announcement is generated via Ollama and posted
 */

const { logger } = require('./logger');
const { config } = require('./config');
const {
  getMarketByMessageId,
  chargeStarReact,
  getMarket,
  getMarketOptions,
  isYesNoMarket,
  ensureAccount,
} = require('./sadgirlEconomyStore');
const { requestLlmCompletion } = require('./llmClient');
const { getAllGuildConfigs } = require('./guildConfig');

const FALLBACK_ANNOUNCEMENT_CHANNEL_ID = '1494917724323971122';
const STAR_ACTIVATION_THRESHOLD = 3;

// Track which user+market combos have already been charged to prevent double-charging
const chargedReacts = new Set();

function buildChargeKey(userId, marketId) {
  return `${userId}:${marketId}`;
}

/**
 * Handle a star reaction on a potential stock market message.
 * Called from the main MessageReactionAdd event.
 */
async function handleStockStarReaction(reaction, user, client) {
  if (!config.economyEnabled) return;

  // Only process star emoji
  if (!isStarEmoji(reaction.emoji)) return;

  // Ignore bot reactions
  if (user.bot) return;

  // Fetch partials
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  const { message } = reaction;
  if (!message) return;

  if (message.partial) {
    try { await message.fetch(); } catch { return; }
  }

  // Look up whether this message is a pending stock market post
  const market = getMarketByMessageId(message.id);
  if (!market) return;
  if (market.status !== 'pending') return;

  const chargeKey = buildChargeKey(user.id, market.id);
  if (chargedReacts.has(chargeKey)) return;

  // Charge the user 3 SGC
  ensureAccount(user.id, user.username);
  const result = chargeStarReact(user.id, user.username, market.id);

  if (!result.success) {
    // Try to DM the user about insufficient funds
    try {
      await user.send(`⭐ Could not activate your star vote on LumiStock #${market.id}: ${result.error}`);
    } catch { /* DMs may be closed */ }
    // Remove their reaction since it didn't count
    try { await reaction.users.remove(user.id); } catch { /* ignore */ }
    return;
  }

  chargedReacts.add(chargeKey);
  logger.info(`Stock activation: ${user.username} star-voted on market #${market.id} (${result.newStarCount}/${STAR_ACTIVATION_THRESHOLD})`);

  // Update the original message with current star count
  try {
    const updatedMarket = getMarket(market.id);
    if (updatedMarket && message.editable) {
      const statusLine = result.activated
        ? '✅ **This market is now LIVE! Place your bets with `/lumi-bets buy`!**'
        : `⭐ **${result.newStarCount}/${STAR_ACTIVATION_THRESHOLD} stars** — ${STAR_ACTIVATION_THRESHOLD - result.newStarCount} more needed to go live! (costs 3 SGC each)`;

      const opts = getMarketOptions(updatedMarket);
      const isYN = isYesNoMarket(updatedMarket);
      const optionsLine = isYN
        ? null
        : `📋 **Options:** ${opts.map((o, i) => `**${i + 1}.** ${o}`).join(' | ')}`;

      const embed = [
        `📈 **LumiStock ${result.activated ? 'LIVE' : 'Proposed'}: #${market.id}**`,
        `> **${updatedMarket.title}**`,
        updatedMarket.description ? `> ${updatedMarket.description}` : null,
        '',
        optionsLine,
        `_Proposed by <@${updatedMarket.created_by}>_`,
        `💰 Pool: **${updatedMarket.pool} SGC**`,
        '',
        statusLine,
      ].filter((line) => line != null).join('\n');

      await message.edit(embed);
    }
  } catch (error) {
    logger.warn('Stock activation: failed to update market message.', error.message);
  }

  // If market just went live, generate and post an announcement
  if (result.activated) {
    await announceMarketLive(market.id, client);
  }
}

/**
 * Generate an in-character Lumi announcement for a newly activated market
 * and post it to the announcement channel.
 */
async function announceMarketLive(marketId, client) {
  const market = getMarket(marketId);
  if (!market) return;

  try {
    // Generate in-character announcement via Ollama (once, shared across all guilds)
    let announcement;
    const opts = getMarketOptions(market);
    const isYN = isYesNoMarket(market);
    const optionsHint = isYN ? 'yes or no' : opts.map((o, i) => `${i + 1}. ${o}`).join(', ');
    try {
      announcement = await requestLlmCompletion({
        latestContent: `A new LumiStock prediction market just went live: "${market.title}" — ${market.description || 'no extra details'}. ${isYN ? 'It\'s a yes/no bet.' : `Options to bet on: ${optionsHint}.`} The pool currently has ${market.pool} SadGirlCoin in it. Announce this to all servers and encourage people to place bets using /lumi-bets buy. Keep it short, 2-3 sentences max.`,
        history: [],
        memoryClues: [],
        deepRecall: false,
        maxResponseChars: 300,
        searchResults: null,
        systemOverride: 'System: You are announcing a new LumiStock prediction market going live across all servers. Be hyped but keep your usual chill vibe. Mention the market title, the pool size, and how to bet. Keep it short and punchy.',
      });
    } catch (error) {
      logger.warn('Stock activation: LLM announcement generation failed, using fallback.', error.message);
      announcement = null;
    }

    const buyHint = isYN
      ? `/lumi-bets buy ${market.id} <yes|no> <amount>`
      : `/lumi-bets buy ${market.id} <option> <amount>`;
    const fallback = `📈 **LumiStock #${market.id} is now LIVE!**\n\n> ${market.title}\n\n💰 Pool: **${market.pool} SGC**\nPlace your bets: \`${buyHint}\``;
    const text = announcement
      ? `📈 **LumiStock #${market.id} is LIVE!**\n\n${announcement}\n\n💰 Pool: **${market.pool} SGC** | Use \`${buyHint}\``
      : fallback;

    // Collect all destination channels — every guild with a lumiBetsChannelId configured
    const allConfigs = getAllGuildConfigs().filter((cfg) => cfg.enabled && cfg.lumiBetsChannelId);

    // Ensure the originating guild's channel is always included via fallback
    const channelIds = new Set(allConfigs.map((cfg) => cfg.lumiBetsChannelId));
    if (channelIds.size === 0) channelIds.add(FALLBACK_ANNOUNCEMENT_CHANNEL_ID);

    // Build a map of channelId → roleMention for each guild
    const roleMentionByChannel = new Map();
    for (const cfg of allConfigs) {
      roleMentionByChannel.set(cfg.lumiBetsChannelId, cfg.bigBusinessRoleId ? `<@&${cfg.bigBusinessRoleId}>\n` : '');
    }

    let sentCount = 0;
    for (const channelId of channelIds) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        logger.warn(`Stock activation: announcement channel ${channelId} not found, skipping.`);
        continue;
      }
      const roleMention = roleMentionByChannel.get(channelId) ?? '';
      try {
        await channel.send(`${roleMention}${text}`);
        sentCount++;
      } catch (err) {
        logger.warn(`Stock activation: failed to send to channel ${channelId}.`, err.message);
      }
    }

    logger.info(`Stock activation: announced market #${market.id} to ${sentCount} channel(s).`);
  } catch (error) {
    logger.error('Stock activation: failed to post announcement.', error.message);
  }
}

function isStarEmoji(emoji) {
  if (!emoji?.name) return false;
  if (emoji.id) return false; // custom emoji
  return emoji.name === '⭐';
}

module.exports = {
  handleStockStarReaction,
  announceMarketLive,
};
