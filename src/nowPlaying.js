const { EmbedBuilder } = require('discord.js');

const { config } = require('./config');
const { logger } = require('./logger');
const { createSongWatcher } = require('./songwatcher');
const { searchSoundCloud } = require('./soundcloudSearch');
const { getSetting } = require('./panelSettings');

const SOUNDCLOUD_ORANGE = 0xff5500;
const SONG_POLL_FETCH_TIMEOUT_MS = 10_000;
const MIN_NOW_PLAYING_CACHE_TTL_MS = 5_000;
const MAX_NOW_PLAYING_CACHE_TTL_MS = 60_000;

let NOW_PLAYING_CHANNEL_ID = config.nowPlayingChannelId || '';
let SONG_POLL_URL = config.songPollUrl;
let SONG_POLL_INTERVAL_MS = config.songPollIntervalMs;

let activeClient = null;
let activeWatcher = null;

function reloadSettings() {
  try {
    NOW_PLAYING_CHANNEL_ID = String(getSetting('runtime.nowPlayingChannelId') || '').trim() || config.nowPlayingChannelId || '';
    SONG_POLL_URL = String(getSetting('runtime.songPollUrl') || '').trim() || config.songPollUrl;
    SONG_POLL_INTERVAL_MS = Number(getSetting('runtime.songPollIntervalMs')) || config.songPollIntervalMs;
  } catch {
    NOW_PLAYING_CHANNEL_ID = config.nowPlayingChannelId || '';
    SONG_POLL_URL = config.songPollUrl;
    SONG_POLL_INTERVAL_MS = config.songPollIntervalMs;
  }

  if (activeClient) {
    restartWatcher();
  }
}

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
    track: nowPlayingState.track ? { ...nowPlayingState.track } : null,
    updatedAt: nowPlayingState.updatedAt,
  };
}

function getNowPlayingCacheTtlMs() {
  return Math.max(
    MIN_NOW_PLAYING_CACHE_TTL_MS,
    Math.min(SONG_POLL_INTERVAL_MS, MAX_NOW_PLAYING_CACHE_TTL_MS),
  );
}

function setNowPlayingState(song, track) {
  nowPlayingState.song = song;
  nowPlayingState.track = track;
  nowPlayingState.updatedAt = Date.now();
}

async function fetchCurrentSongFromPollUrl() {
  try {
    const response = await fetch(SONG_POLL_URL, {
      signal: AbortSignal.timeout(SONG_POLL_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(`Now-playing fetch: HTTP ${response.status} from ${SONG_POLL_URL}`);
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

function startWatcher(client) {
  if (!NOW_PLAYING_CHANNEL_ID) {
    logger.warn('Now-playing watcher: NOW_PLAYING_CHANNEL_ID is not set — watcher will not start.');
    return { stop: () => {} };
  }

  logger.info(`Now-playing watcher: starting (channel=${NOW_PLAYING_CHANNEL_ID}, poll=${SONG_POLL_INTERVAL_MS}ms)`);

  return createSongWatcher({
    url: SONG_POLL_URL,
    intervalMs: SONG_POLL_INTERVAL_MS,
    onSongChange: async (newSong) => {
      try {
        const targetChannelId = NOW_PLAYING_CHANNEL_ID;
        if (!targetChannelId) {
          logger.warn('Now-playing watcher: now-playing channel not configured at runtime.');
          return;
        }

        const channel = await client.channels.fetch(targetChannelId);
        if (!channel?.isTextBased()) {
          logger.warn(`Now-playing watcher: channel ${targetChannelId} is not a text channel.`);
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
}

function restartWatcher() {
  if (!activeClient) return;
  if (activeWatcher) {
    try { activeWatcher.stop(); } catch { /* */ }
    activeWatcher = null;
  }
  activeWatcher = startWatcher(activeClient);
}

function initNowPlaying(client) {
  activeClient = client;
  reloadSettings();

  return {
    stop() {
      if (activeWatcher) {
        try { activeWatcher.stop(); } catch { /* */ }
        activeWatcher = null;
      }
      activeClient = null;
    },
  };
}

reloadSettings();

module.exports = {
  getCurrentNowPlayingTrack,
  initNowPlaying,
  reloadSettings,
};
