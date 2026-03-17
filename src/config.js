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
