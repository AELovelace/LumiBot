/**
 * Big Business — a satirical corporate matching fund, per-guild.
 *
 * Every time a user earns SGC from voice-channel presence or starboard stars,
 * the same amount is matched into the guild's Big Business bank account.
 * Each match is announced in the guild's designated channel with an
 * LLM-generated corporate-flavoured message from Lumi.
 *
 * Each guild has its own Big Business account (e.g. "Big Business Inc",
 * "Dogpunk Records Inc") configured via the guild config system.
 */

const { logger } = require('./logger');
const { depositBigBusiness, getBigBusinessBalance, ensureGuildBigBusiness } = require('./sadgirlEconomyStore');
const { config, getChatbotPersona, parseHttpUrl } = require('./config');
const { getGuildConfig, getAllGuildConfigs, getBigBusinessUserId } = require('./guildConfig');
const { getSetting } = require('./panelSettings');

const DEFAULT_BIG_BUSINESS_LLM_ENDPOINT = 'http://100.83.3.32:11434';
const BIG_BUSINESS_LLM_ENDPOINT = resolveBigBusinessLlmEndpoint();
const BIG_BUSINESS_LLM_MODEL = process.env.BIG_BUSINESS_LLM_MODEL?.trim() || 'server-2';
let BIG_BUSINESS_LLM_TIMEOUT_MS = 40_000;

let discordClient = null;

// ---------------------------------------------------------------------------
// LLM announcement generator
// ---------------------------------------------------------------------------

function stripThinkingTags(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .replace(/<\/?think>/giu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function normalizeEndpoint(value) {
  if (!value) {
    return null;
  }

  const parsed = parseHttpUrl(value);
  if (!parsed) {
    return null;
  }

  return parsed.replace(/\/+$/u, '');
}

function resolveBigBusinessLlmEndpoint() {
  const envOverride = normalizeEndpoint(process.env.BIG_BUSINESS_LLM_ENDPOINT?.trim());
  if (envOverride) {
    return envOverride;
  }

  if (Array.isArray(config.llmEndpoints) && config.llmEndpoints.length > 1) {
    const configuredSecondary = normalizeEndpoint(config.llmEndpoints[1]);
    if (configuredSecondary) {
      return configuredSecondary;
    }
  }

  if (Array.isArray(config.llmEndpoints) && config.llmEndpoints.length > 0) {
    const configuredPrimary = normalizeEndpoint(config.llmEndpoints[0]);
    if (configuredPrimary) {
      return configuredPrimary;
    }
  }

  return DEFAULT_BIG_BUSINESS_LLM_ENDPOINT;
}

async function generateAnnouncement(username, matchedCoins, reason, bigBusinessBalance, businessName, source) {
  const actionWord = source === 'vc' ? 'earned' : 'matched';
  const prompt = [
    `System: ${getChatbotPersona()}`,
    `System: You are writing a short, funny corporate announcement for "${businessName}", a satirical mega-corporation in the SadGirlCoin economy.`,
    'System: Keep it to 1-2 sentences max. Be absurdly corporate, use buzzwords and jargon. Never use emojis.',
    'System: Do not use think tags or reasoning.',
    `${businessName} just ${actionWord} ${matchedCoins} SGC because ${username} ${reason}.`,
    `${businessName} current balance: ${bigBusinessBalance.toLocaleString()} SGC.`,
    'Write the corporate announcement:',
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const completion = typeof payload.response === 'string' ? payload.response : '';
    const cleaned = stripThinkingTags(completion);
    if (cleaned) {
      logger.debug(`${businessName}: Big Business LLM announcement generated via ${BIG_BUSINESS_LLM_ENDPOINT} (${BIG_BUSINESS_LLM_MODEL}).`);
      return cleaned;
    }
  } catch (error) {
    logger.warn(
      `Big Business LLM announcement failed on ${BIG_BUSINESS_LLM_ENDPOINT} (${BIG_BUSINESS_LLM_MODEL}), using fallback.`,
      error.message,
    );
  }

  // Fallback if LLM is unavailable
  return `${businessName} has ${actionWord} ${matchedCoins} SGC on behalf of ${username} (${reason}). Synergy achieved.`;
}

// ---------------------------------------------------------------------------
// Core matching logic
// ---------------------------------------------------------------------------

/**
 * Match a payout into the guild's Big Business account and announce it.
 * @param {string} username - Display name of the user who triggered the payout.
 * @param {number} coins - Amount of SGC matched.
 * @param {'vc'|'starboard'} source - What triggered the match.
 * @param {string} [guildId] - The guild this payout is for.
 */
async function matchPayout(username, coins, source, guildId) {
  if (coins <= 0) return;

  if (!guildId) {
    logger.warn(`Big Business: skipped match payout for ${username} (${source}) because guildId is missing.`);
    return;
  }

  // Resolve guild config
  const guildCfg = getGuildConfig(guildId);
  if (!guildCfg || guildCfg.enabled === false) {
    logger.warn(`Big Business: skipped match payout for ${username} (${source}) because guild ${guildId} is not configured/enabled.`);
    return;
  }
  const businessName = guildCfg?.bigBusinessName || 'Big Business Inc';
  const channelId = guildCfg?.bigBusinessChannelId || null;
  const roleMention = guildCfg?.bigBusinessRoleId ? `<@&${guildCfg.bigBusinessRoleId}>\n` : '';
  const bigBusinessUserId = guildId ? getBigBusinessUserId(guildId) : undefined;

  const reason = source === 'vc'
    ? 'earned voice-channel wages'
    : 'received starboard star recognition';
  const note = source === 'vc'
    ? `VC earned for ${username}`
    : `Starboard match for ${username}`;

  try {
    depositBigBusiness(coins, note, bigBusinessUserId);
  } catch (error) {
    logger.error(`${businessName} deposit failed.`, error.message);
    return;
  }

  const balance = getBigBusinessBalance(bigBusinessUserId);

  // Generate and post the announcement
  try {
    const announcement = await generateAnnouncement(username, coins, reason, balance, businessName, source);
    const payoutLabel = source === 'vc' ? 'Earned' : 'Matched';
    const formatted = `${roleMention}🏢 **${businessName}**\n${announcement}\n\n` +
      `📊 ${payoutLabel}: **${coins.toLocaleString()} SGC** (${source === 'vc' ? 'voice channel' : 'starboard'})\n` +
      `🏦 ${businessName} Balance: **${balance.toLocaleString()} SGC**`;

    // Split into at most 2 messages if over Discord's 2000-char limit
    const LIMIT = 1990;
    let parts;
    if (formatted.length <= LIMIT) {
      parts = [formatted];
    } else {
      // Try to split at a newline before the limit
      const splitAt = formatted.lastIndexOf('\n', LIMIT);
      const idx = splitAt > 0 ? splitAt : LIMIT;
      parts = [formatted.slice(0, idx).trimEnd(), formatted.slice(idx).trimStart()];
    }

    if (!discordClient) {
      logger.warn(`${businessName}: discordClient is null, cannot post announcement.`);
    } else if (!channelId) {
      logger.warn(`${businessName}: no bigBusinessChannelId configured for guild ${guildId}.`);
    } else {
      const channel = await discordClient.channels.fetch(channelId).catch((err) => {
        logger.warn(`${businessName}: failed to fetch channel ${channelId} — ${err.message}`);
        return null;
      });
      if (channel) {
        for (const part of parts) {
          if (part) await channel.send(part);
        }
      } else {
        logger.warn(`${businessName}: channel ${channelId} not found or inaccessible.`);
      }
    }
  } catch (error) {
    logger.warn(`${businessName}: failed to post announcement.`, error.message);
  }

  logger.info(`${businessName}: matched ${coins} SGC for ${username} (${source}). Balance: ${balance}.`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function initBigBusiness(client) {
  discordClient = client;

  // Ensure per-guild Big Business accounts exist in the economy store
  for (const cfg of getAllGuildConfigs()) {
    if (cfg.enabled) {
      const uid = getBigBusinessUserId(cfg.guildId);
      ensureGuildBigBusiness(uid, cfg.bigBusinessName);
    }
  }

  logger.info(`Big Business LLM route: endpoint=${BIG_BUSINESS_LLM_ENDPOINT}, model=${BIG_BUSINESS_LLM_MODEL}, timeoutMs=${BIG_BUSINESS_LLM_TIMEOUT_MS}.`);
  logger.info('Big Business system initialized (per-guild).');
}

function stopBigBusiness() {
  discordClient = null;
}

function reloadSettings() {
  try {
    BIG_BUSINESS_LLM_TIMEOUT_MS = getSetting('bigbusiness.llmTimeoutMs');
  } catch { /* DB not ready */ }
}

module.exports = {
  matchPayout,
  initBigBusiness,
  stopBigBusiness,
  reloadSettings,
};
