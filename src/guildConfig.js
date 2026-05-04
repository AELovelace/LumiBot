/**
 * Per-guild configuration system for the SadGirlCoin economy.
 *
 * Stores guild-specific settings in a JSON file so they survive restarts
 * and can be edited via the web control panel.
 *
 * Each guild config contains:
 *   - guildId               — Discord guild snowflake
 *   - guildName             — human-readable name (display only)
 *   - starboardChannelId    — channel for starboard posts
 *   - bigBusinessName       — name of the guild's Big Business account
 *   - bigBusinessChannelId  — channel for Big Business announcements
 *   - bigBusinessRoleId     — role pinged for Big Business/LumiStocks updates
 *   - lumiBetsChannelId     — channel where live LumiBets announcements are posted
 *   - lumiBetsArchiveChannelId — channel where resolved LumiBets are archived
 *   - promotionalChannelId  — channel where promotional song links are tracked
 *   - promotionalSongValue  — SGC value minted into company treasury per qualifying link
 *   - promotionalSongDomains — host allowlist for qualifying links (e.g. soundcloud.com)
 *   - reactionRoleMessageId — message ID Lumi watches for reaction roles
 *   - reactionRoleAssignments — emoji↔role bindings for reaction roles
 *   - starboardMinStars     — minimum stars to post (default 4)
 *   - starboardEmojiName    — emoji name to watch (default 'star')
 *   - enabled               — whether economy features are active for this guild
 */

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');

const CONFIG_FILE = path.resolve(process.cwd(), 'data', 'guild-config.json');

/** @type {Map<string, GuildConfig>} */
const guilds = new Map();
const MAX_REACTION_ROLE_ASSIGNMENTS = 20;

/**
 * @typedef {Object} GuildConfig
 * @property {string} guildId
 * @property {string} guildName
 * @property {string} starboardChannelId
 * @property {string} bigBusinessName
 * @property {string} bigBusinessChannelId
 * @property {string} bigBusinessRoleId
 * @property {string} lumiBetsChannelId
 * @property {string} lumiBetsArchiveChannelId
 * @property {string} promotionalChannelId
 * @property {number} promotionalSongValue
 * @property {string[]} promotionalSongDomains
 * @property {string} reactionRoleMessageId
 * @property {{ emojiKey: string, emojiLabel: string, roleId: string }[]} reactionRoleAssignments
 * @property {number} starboardMinStars
 * @property {string} starboardEmojiName
 * @property {boolean} enabled
 */

// ---------------------------------------------------------------------------
// Defaults — seeded on first run so both guilds work immediately
// ---------------------------------------------------------------------------

const DEFAULT_GUILDS = [
  {
    guildId: process.env.ALLOWED_GUILD_ID?.trim() || '464275965693755402',
    guildName: 'SadGirlsClub',
    starboardChannelId: '1136106008587030548',
    bigBusinessName: 'Big Business Inc',
    bigBusinessChannelId: '1495157594468388924',
    bigBusinessRoleId: '',
    lumiBetsChannelId: '1494917724323971122',
    lumiBetsArchiveChannelId: '1494931183455436870',
    promotionalChannelId: '',
    promotionalSongValue: 0,
    promotionalSongDomains: ['soundcloud.com', 'bandcamp.com'],
    reactionRoleMessageId: '',
    reactionRoleAssignments: [],
    starboardMinStars: 4,
    starboardEmojiName: 'star',
    enabled: true,
  },
  {
    guildId: '1170208430460514354',
    guildName: 'Dogpunk',
    starboardChannelId: '1495166219194732725',
    bigBusinessName: 'Dogpunk Records Inc',
    bigBusinessChannelId: '1495167244068454512',
    bigBusinessRoleId: '',
    lumiBetsChannelId: '',
    lumiBetsArchiveChannelId: '',
    promotionalChannelId: '',
    promotionalSongValue: 0,
    promotionalSongDomains: ['soundcloud.com', 'bandcamp.com'],
    reactionRoleMessageId: '',
    reactionRoleAssignments: [],
    starboardMinStars: 4,
    starboardEmojiName: 'star',
    enabled: true,
  },
];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadConfig() {
  guilds.clear();

  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, 'utf-8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (entry && entry.guildId) {
            guilds.set(entry.guildId, normalizeEntry(entry));
          }
        }
        logger.info(`Guild config: loaded ${guilds.size} guild(s) from ${CONFIG_FILE}.`);
        return;
      }
    } catch (error) {
      logger.warn('Guild config: failed to parse config file, seeding defaults.', error.message);
    }
  }

  // Seed defaults on first run
  for (const def of DEFAULT_GUILDS) {
    guilds.set(def.guildId, normalizeEntry(def));
  }
  saveConfig();
  logger.info(`Guild config: seeded ${guilds.size} default guild(s).`);
}

function saveConfig() {
  const dir = path.dirname(CONFIG_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const arr = Array.from(guilds.values());
  writeFileSync(CONFIG_FILE, JSON.stringify(arr, null, 2), 'utf-8');
}

function normalizeEntry(entry) {
  const normalizedPromoValue = Number(entry.promotionalSongValue);

  return {
    guildId: String(entry.guildId || ''),
    guildName: String(entry.guildName || ''),
    starboardChannelId: String(entry.starboardChannelId || ''),
    bigBusinessName: String(entry.bigBusinessName || 'Big Business Inc'),
    bigBusinessChannelId: String(entry.bigBusinessChannelId || ''),
    bigBusinessRoleId: String(entry.bigBusinessRoleId || ''),
    lumiBetsChannelId: String(entry.lumiBetsChannelId || ''),
    lumiBetsArchiveChannelId: String(entry.lumiBetsArchiveChannelId || ''),
    promotionalChannelId: String(entry.promotionalChannelId || ''),
    promotionalSongValue: Number.isFinite(normalizedPromoValue) && normalizedPromoValue > 0
      ? normalizedPromoValue
      : 0,
    promotionalSongDomains: normalizePromotionalSongDomains(entry.promotionalSongDomains),
    reactionRoleMessageId: String(entry.reactionRoleMessageId || ''),
    reactionRoleAssignments: normalizeReactionRoleAssignments(entry.reactionRoleAssignments),
    starboardMinStars: Number(entry.starboardMinStars) || 4,
    starboardEmojiName: String(entry.starboardEmojiName || 'star').toLowerCase(),
    enabled: entry.enabled !== false,
  };
}

function normalizePromotionalSongDomains(domains) {
  if (!Array.isArray(domains)) {
    return ['soundcloud.com', 'bandcamp.com'];
  }

  const cleaned = Array.from(
    new Set(
      domains
        .map((domain) => String(domain || '').trim().toLowerCase())
        .map((domain) => domain.replace(/^www\./u, ''))
        .filter(Boolean),
    ),
  );

  return cleaned.length > 0 ? cleaned : ['soundcloud.com', 'bandcamp.com'];
}

function parseReactionRoleEmojiInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const shortcodeMatch = raw.match(/^:([a-z0-9_+-]+):$/iu);
  if (shortcodeMatch) {
    const shortcode = shortcodeMatch[1].toLowerCase();
    const unicode = SHORTCODE_TO_UNICODE.get(shortcode);
    if (!unicode) return null;
    return {
      emojiKey: `unicode:${unicode}`,
      emojiLabel: unicode,
    };
  }

  const mentionMatch = raw.match(/^<(a?):([\w~]+):(\d+)>$/u);
  if (mentionMatch) {
    const [, animatedFlag, name, id] = mentionMatch;
    const prefix = animatedFlag ? '<a' : '<';
    return {
      emojiKey: `id:${id}`,
      emojiLabel: `${prefix}:${name}:${id}>`,
    };
  }

  const nameIdMatch = raw.match(/^([\w~]+):(\d+)$/u);
  if (nameIdMatch) {
    const [, name, id] = nameIdMatch;
    return {
      emojiKey: `id:${id}`,
      emojiLabel: `<:${name}:${id}>`,
    };
  }

  if (/^id:\d+$/u.test(raw)) {
    const id = raw.slice(3);
    return {
      emojiKey: `id:${id}`,
      emojiLabel: `id:${id}`,
    };
  }

  if (/^unicode:/u.test(raw)) {
    const unicode = raw.slice('unicode:'.length);
    if (!unicode) return null;
    return {
      emojiKey: `unicode:${unicode}`,
      emojiLabel: unicode,
    };
  }

  return {
    emojiKey: `unicode:${raw}`,
    emojiLabel: raw,
  };
}

const SHORTCODE_TO_UNICODE = new Map([
  ['white_check_mark', '✅'],
  ['check_mark', '✅'],
  ['heavy_check_mark', '✔️'],
  ['x', '❌'],
  ['cross_mark', '❌'],
  ['warning', '⚠️'],
  ['star', '⭐'],
  ['sparkles', '✨'],
  ['thumbsup', '👍'],
  ['thumbs_up', '👍'],
  ['thumbsdown', '👎'],
  ['thumbs_down', '👎'],
  ['fire', '🔥'],
  ['heart', '❤️'],
  ['blue_heart', '💙'],
  ['green_heart', '💚'],
  ['purple_heart', '💜'],
  ['black_heart', '🖤'],
  ['100', '💯'],
  ['eyes', '👀'],
]);

function normalizeReactionRoleAssignments(assignments) {
  if (!Array.isArray(assignments)) return [];

  const deduped = new Map();
  for (const rawEntry of assignments) {
    if (!rawEntry) continue;
    const roleId = String(rawEntry.roleId || '').trim();
    if (!roleId) continue;

    let parsed = null;
    if (rawEntry.emojiKey) {
      const emojiKey = String(rawEntry.emojiKey || '').trim();
      const emojiLabel = String(rawEntry.emojiLabel || '').trim();
      if (emojiKey) {
        parsed = {
          emojiKey,
          emojiLabel: emojiLabel || emojiKey,
        };
      }
    }
    if (!parsed) {
      parsed = parseReactionRoleEmojiInput(rawEntry.emojiLabel || rawEntry.emoji || '');
    }
    if (!parsed) continue;

    deduped.set(parsed.emojiKey, {
      emojiKey: parsed.emojiKey,
      emojiLabel: parsed.emojiLabel,
      roleId,
    });
  }

  return Array.from(deduped.values()).slice(0, MAX_REACTION_ROLE_ASSIGNMENTS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function initGuildConfig() {
  loadConfig();
}

/**
 * Get config for a specific guild. Returns null if guild is not configured.
 * @param {string} guildId
 * @returns {GuildConfig|null}
 */
function getGuildConfig(guildId) {
  return guilds.get(guildId) || null;
}

/**
 * Get all configured guilds.
 * @returns {GuildConfig[]}
 */
function getAllGuildConfigs() {
  return Array.from(guilds.values());
}

/**
 * Check if a guild is configured and enabled.
 * @param {string} guildId
 * @returns {boolean}
 */
function isGuildEnabled(guildId) {
  const cfg = guilds.get(guildId);
  return cfg ? cfg.enabled : false;
}

/**
 * Add or update a guild configuration.
 * @param {Partial<GuildConfig> & { guildId: string }} entry
 * @returns {GuildConfig}
 */
function upsertGuildConfig(entry) {
  if (!entry || !entry.guildId) throw new Error('guildId is required');

  const existing = guilds.get(entry.guildId);
  const merged = normalizeEntry({ ...(existing || {}), ...entry });
  guilds.set(merged.guildId, merged);
  saveConfig();
  logger.info(`Guild config: upserted guild ${merged.guildId} (${merged.guildName}).`);
  return merged;
}

/**
 * Remove a guild configuration.
 * @param {string} guildId
 * @returns {boolean} true if removed
 */
function removeGuildConfig(guildId) {
  const removed = guilds.delete(guildId);
  if (removed) {
    saveConfig();
    logger.info(`Guild config: removed guild ${guildId}.`);
  }
  return removed;
}

/**
 * Build the Big Business user ID for a guild.
 * Each guild has its own Big Business account in the economy store.
 * @param {string} guildId
 * @returns {string}
 */
function getBigBusinessUserId(guildId) {
  return `__BIG_BUSINESS_${guildId}__`;
}

module.exports = {
  MAX_REACTION_ROLE_ASSIGNMENTS,
  parseReactionRoleEmojiInput,
  normalizeReactionRoleAssignments,
  initGuildConfig,
  getGuildConfig,
  getAllGuildConfigs,
  isGuildEnabled,
  upsertGuildConfig,
  removeGuildConfig,
  getBigBusinessUserId,
};
