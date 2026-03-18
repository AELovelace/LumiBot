const { existsSync } = require('node:fs');
const path = require('node:path');

const dotenv = require('dotenv');

dotenv.config();

function parsePositiveInt(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseNonNegativeInt(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parseProbability(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, parsed));
}

function parseCsvList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHttpBaseUrl(value) {
  const parsed = parseHttpUrl(value);
  return parsed ? parsed.replace(/\/+$/u, '') : null;
}

function parseEndpointList(value) {
  return parseCsvList(value)
    .map((item) => parseHttpBaseUrl(item))
    .filter(Boolean);
}

function parseHttpUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com']);
const SOUNDCLOUD_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com']);

/**
 * Parse a raw user input string into a typed play input object.
 *
 * Returns one of:
 *   { type: 'youtube',    url:   string }
 *   { type: 'soundcloud', url:   string }
 *   { type: 'http',       url:   string }
 *   { type: 'search',     query: string }
 *   null  — if the input is empty
 */
function parsePlayInput(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (YOUTUBE_HOSTS.has(parsed.hostname)) {
        return { type: 'youtube', url: parsed.toString() };
      }

      if (SOUNDCLOUD_HOSTS.has(parsed.hostname)) {
        return { type: 'soundcloud', url: parsed.toString() };
      }

      return { type: 'http', url: parsed.toString() };
    }
  } catch {
    // Not a URL — fall through to search
  }

  return { type: 'search', query: trimmed };
}

function redactUrl(value) {
  if (!value) {
    return 'unknown-url';
  }

  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

function resolveYtDlpPath() {
  const configuredPath = process.env.YTDLP_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const localCandidates = [
    path.resolve(__dirname, '..', 'yt-dlp.exe'),
    path.resolve(__dirname, '..', 'yt-dlp'),
  ];

  return localCandidates.find((candidate) => existsSync(candidate)) || 'yt-dlp';
}

const chatbotMemoryLegacyFile = process.env.CHATBOT_MEMORY_LEGACY_FILE?.trim()
  || process.env.CHATBOT_MEMORY_FILE?.trim()
  || 'data/chatbot-memory.json';

const llmUseLocalGpu = parseBoolean(process.env.LLM_USE_LOCAL_GPU, false);
const llmLocalEndpoint = parseHttpBaseUrl(
  process.env.LLM_LOCAL_ENDPOINT?.trim() || 'http://127.0.0.1:11434',
);
const defaultLlmEndpoints = [
  parseHttpBaseUrl('http://172.27.23.252:11434'),
  parseHttpBaseUrl('http://172.27.23.252:11435'),
].filter(Boolean);

function buildLlmEndpoints() {
  const configured = parseEndpointList(process.env.LLM_ENDPOINTS);
  const baseEndpoints = configured.length > 0 ? configured : defaultLlmEndpoints;

  if (!llmUseLocalGpu || !llmLocalEndpoint) {
    return baseEndpoints;
  }

  return Array.from(new Set([llmLocalEndpoint, ...baseEndpoints]));
}

const config = Object.freeze({
  discordToken: process.env.DISCORD_TOKEN?.trim() || '',
  commandPrefix: process.env.COMMAND_PREFIX?.trim() || 'sb!',
  defaultStreamUrl: parseHttpUrl(process.env.DEFAULT_STREAM_URL?.trim() || ''),
  allowedGuildId: process.env.ALLOWED_GUILD_ID?.trim() || null,
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || null,
  ytdlpPath: resolveYtDlpPath(),
  voiceReadyTimeoutMs: parsePositiveInt(process.env.VOICE_READY_TIMEOUT_MS, 30_000),
  streamReconnectLimit: parsePositiveInt(process.env.STREAM_RECONNECT_LIMIT, 5),
  voiceReconnectLimit: parsePositiveInt(process.env.VOICE_RECONNECT_LIMIT, 5),
  reconnectBaseDelayMs: parsePositiveInt(process.env.RECONNECT_BASE_DELAY_MS, 2_500),
  ffmpegUserAgent: process.env.FFMPEG_USER_AGENT?.trim() || 'SadGirlPlayer/0.1',
  ffmpegLogLevel: process.env.FFMPEG_LOG_LEVEL?.trim() || 'warning',
  opusBitrateKbps: parsePositiveInt(process.env.OPUS_BITRATE_KBPS, 128),
  logLevel: process.env.LOG_LEVEL?.trim().toLowerCase() || 'info',
  songPollUrl: process.env.SONG_POLL_URL?.trim() || 'https://sadgirlsclub.wtf/blog/posts/current_song.txt',
  songPollIntervalMs: parsePositiveInt(process.env.SONG_POLL_INTERVAL_MS, 15_000),
  chatbotEnabled: process.env.CHATBOT_ENABLED?.trim().toLowerCase() !== 'false',
  chatbotChannelIds: parseCsvList(process.env.CHATBOT_CHANNEL_IDS),
  chatbotReplyChance: parseProbability(process.env.CHATBOT_REPLY_CHANCE, 0.2),
  chatbotInterestThreshold: parsePositiveInt(process.env.CHATBOT_INTEREST_THRESHOLD, 2),
  chatbotContextMessages: parsePositiveInt(process.env.CHATBOT_CONTEXT_MESSAGES, 20),
  chatbotCooldownMs: parsePositiveInt(process.env.CHATBOT_COOLDOWN_MS, 15_000),
  chatbotConversationWindowMs: parsePositiveInt(process.env.CHATBOT_CONVERSATION_WINDOW_MS, 300_000),
  chatbotFollowupCooldownMs: parsePositiveInt(process.env.CHATBOT_FOLLOWUP_COOLDOWN_MS, 5_000),
  chatbotMomentumWindowMs: parsePositiveInt(process.env.CHATBOT_MOMENTUM_WINDOW_MS, 180_000),
  chatbotMomentumChanceBoost: parseProbability(process.env.CHATBOT_MOMENTUM_CHANCE_BOOST, 0.35),
  chatbotMomentumMaxReplyChance: parseProbability(process.env.CHATBOT_MOMENTUM_MAX_REPLY_CHANCE, 0.8),
  chatbotMaxResponseChars: parsePositiveInt(process.env.CHATBOT_MAX_RESPONSE_CHARS, 450),
  chatbotPersona:
    process.env.CHATBOT_PERSONA?.trim()
    || 'You are Lumi, a quirky upbeat egirl-style assistant. Use she/it pronouns for yourself.',
  chatbotModel: process.env.CHATBOT_MODEL?.trim()
    || (llmUseLocalGpu ? 'HammerAI/llama-3-lexi-uncensored' : 'qwen2.5:7b'),
  llmUseLocalGpu,
  llmLocalEndpoint,
  llmEndpoints: buildLlmEndpoints(),
  llmTimeoutMs: parsePositiveInt(process.env.LLM_TIMEOUT_MS, 25_000),
  llmRetryLimit: parsePositiveInt(process.env.LLM_RETRY_LIMIT, 2),
  llmRetryBaseDelayMs: parsePositiveInt(process.env.LLM_RETRY_BASE_DELAY_MS, 1_000),
  chatbotMemoryFile: chatbotMemoryLegacyFile,
  chatbotMemoryLegacyFile,
  chatbotMemoryDbFile: process.env.CHATBOT_MEMORY_DB_FILE?.trim() || 'data/chatbot-memory.sqlite3',
  chatbotMemoryPythonPath: process.env.CHATBOT_MEMORY_PYTHON?.trim() || null,
  chatbotMemoryServiceHost: process.env.CHATBOT_MEMORY_SERVICE_HOST?.trim() || '127.0.0.1',
  chatbotMemoryServicePort: parsePositiveInt(process.env.CHATBOT_MEMORY_SERVICE_PORT, 8765),
  chatbotMemoryFlushMs: parsePositiveInt(process.env.CHATBOT_MEMORY_FLUSH_MS, 5_000),
  moderationEnabled: parseBoolean(process.env.MODERATION_ENABLED, true),
  moderationBlocklist: parseCsvList(process.env.MODERATION_BLOCKLIST),
  moderationMaxInputChars: parsePositiveInt(process.env.MODERATION_MAX_INPUT_CHARS, 750),
  moderationMaxOutputChars: parsePositiveInt(process.env.MODERATION_MAX_OUTPUT_CHARS, 450),
  moderationMaxMentions: parseNonNegativeInt(process.env.MODERATION_MAX_MENTIONS, 3),
  moderationBlockInviteLinks: parseBoolean(process.env.MODERATION_BLOCK_INVITE_LINKS, true),
  adminUserIds: parseCsvList(process.env.ADMIN_USER_IDS),
  controlPlaneEnabled: parseBoolean(process.env.CONTROL_PLANE_ENABLED, true),
  slashGuildId: process.env.SLASH_GUILD_ID?.trim() || null,
});

function getMissingConfigValues() {
  const missing = [];

  if (!config.discordToken) {
    missing.push('DISCORD_TOKEN');
  }

  return missing;
}

module.exports = {
  config,
  getMissingConfigValues,
  parseHttpUrl,
  parsePlayInput,
  redactUrl,
};
