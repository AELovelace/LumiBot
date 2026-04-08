const { EmbedBuilder } = require('discord.js');

const { config } = require('./config');
const { logger } = require('./logger');
const { createSongWatcher } = require('./songwatcher');
const { searchSoundCloud } = require('./soundcloudSearch');

const SOUNDCLOUD_ORANGE = 0xff5500;
const SONG_POLL_FETCH_TIMEOUT_MS = 10_000;
const MIN_NOW_PLAYING_CACHE_TTL_MS = 5_000;
const MAX_NOW_PLAYING_CACHE_TTL_MS = 60_000;

const nowPlayingState = {
  song: null,
  track: null,
  updatedAt: 0,
  inFlightRefresh: null,
};

function cloneNowPlayingState() {
  if (!nowPlayingState.song) {
    return null;
  }

  return {
    song: nowPlayingState.song,
    track: nowPlayingState.track
      ? { ...nowPlayingState.track }
      : null,
    updatedAt: nowPlayingState.updatedAt,
  };
}

function getNowPlayingCacheTtlMs() {
  return Math.max(
    MIN_NOW_PLAYING_CACHE_TTL_MS,
    Math.min(config.songPollIntervalMs, MAX_NOW_PLAYING_CACHE_TTL_MS),
  );
}

function setNowPlayingState(song, track) {
  nowPlayingState.song = song;
  nowPlayingState.track = track;
  nowPlayingState.updatedAt = Date.now();
}

async function fetchCurrentSongFromPollUrl() {
  try {
    const response = await fetch(config.songPollUrl, {
      signal: AbortSignal.timeout(SONG_POLL_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(`Now-playing fetch: HTTP ${response.status} from ${config.songPollUrl}`);
      return null;
    }

    const text = (await response.text()).trim();
    return text || null;
  } catch (error) {
    logger.warn(`Now-playing fetch failed. ${error.message}`);
    return null;
  }
}

async function updateNowPlayingSnapshotForSong(song) {
  const normalizedSong = String(song || '').trim();
  if (!normalizedSong) {
    return cloneNowPlayingState();
  }

  const track = await searchSoundCloud(normalizedSong);
  setNowPlayingState(normalizedSong, track);
  return cloneNowPlayingState();
}

async function refreshNowPlayingSnapshot() {
  if (nowPlayingState.inFlightRefresh) {
    return nowPlayingState.inFlightRefresh;
  }

  nowPlayingState.inFlightRefresh = (async () => {
    const polledSong = await fetchCurrentSongFromPollUrl();
    if (!polledSong) {
      return cloneNowPlayingState();
    }

    if (polledSong === nowPlayingState.song && nowPlayingState.track) {
      nowPlayingState.updatedAt = Date.now();
      return cloneNowPlayingState();
    }

    return updateNowPlayingSnapshotForSong(polledSong);
  })().finally(() => {
    nowPlayingState.inFlightRefresh = null;
  });

  return nowPlayingState.inFlightRefresh;
}

async function getCurrentNowPlayingTrack() {
  const snapshot = cloneNowPlayingState();
  if (snapshot) {
    const cacheAgeMs = Date.now() - snapshot.updatedAt;
    if (cacheAgeMs <= getNowPlayingCacheTtlMs()) {
      return snapshot;
    }
  }

  return refreshNowPlayingSnapshot();
}

/**
 * Build a Discord embed for a SoundCloud track.
 *
 * @param {object} track
 * @param {string} track.title
 * @param {string} track.artist
 * @param {string} track.url
 * @param {string | null} track.artworkUrl
 * @returns {EmbedBuilder}
 */
function buildTrackEmbed(track) {
  const embed = new EmbedBuilder()
    .setColor(SOUNDCLOUD_ORANGE)
    .setTitle(track.title)
    .setURL(track.url)
    .setAuthor({ name: track.artist });

  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  }

  return embed;
}

/**
 * Start a persistent, session-independent song watcher that posts now-playing
 * updates to the configured channel on every song change.
 *
 * Should be called once inside the `ClientReady` handler.
 *
 * @param {import('discord.js').Client} client
 * @returns {{ stop: () => void }}
 */
function initNowPlaying(client) {
  if (!config.nowPlayingChannelId) {
    logger.warn('Now-playing watcher: NOW_PLAYING_CHANNEL_ID is not set — watcher will not start.');
    return { stop: () => {} };
  }

  logger.info(`Now-playing watcher: starting (channel=${config.nowPlayingChannelId}, poll=${config.songPollIntervalMs}ms)`);

  const watcher = createSongWatcher({
    url: config.songPollUrl,
    intervalMs: config.songPollIntervalMs,
    onSongChange: async (newSong) => {
      try {
        const channel = await client.channels.fetch(config.nowPlayingChannelId);
        if (!channel?.isTextBased()) {
          logger.warn(`Now-playing watcher: channel ${config.nowPlayingChannelId} is not a text channel.`);
          return;
        }

        const nowPlayingSnapshot = await updateNowPlayingSnapshotForSong(newSong);
        const track = nowPlayingSnapshot?.track ?? null;

        if (track) {
          logger.debug(`Now-playing watcher: found SC track "${track.title}" by ${track.artist}`);
          await channel.send({ embeds: [buildTrackEmbed(track)] });
        } else {
          logger.debug(`Now-playing watcher: no SC result — posting plain text for "${newSong}"`);
          await channel.send(`Now playing: **${newSong}**`);
        }
      } catch (error) {
        logger.warn(`Now-playing watcher: failed to post update. ${error.message}`);
      }
    },
  });

  return watcher;
}

module.exports = {
  getCurrentNowPlayingTrack,
  initNowPlaying,
};
