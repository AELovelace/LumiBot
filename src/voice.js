const { randomUUID } = require('node:crypto');

const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require('@discordjs/voice');

const { config, redactUrl } = require('./config');
const { logger } = require('./logger');
const { createSongWatcher } = require('./songwatcher');
const { spawnHlsTranscoder, spawnYtDlpStream } = require('./stream');
const { clearQueue, dequeue } = require('./queue');

const activeSessions = new Map();

function isCurrentSession(session) {
  return activeSessions.get(session.guildId)?.sessionId === session.sessionId;
}

function isActiveStreamController(session, controller) {
  return isCurrentSession(session) && session.streamController === controller;
}

function clearTimer(timer) {
  if (timer) {
    clearTimeout(timer);
  }
}

async function notifyTextChannel(session, content) {
  if (!session?.textChannel?.send) {
    return;
  }

  try {
    await session.textChannel.send(content);
  } catch (error) {
    logger.warn('Failed to send session status message.', error.message);
  }
}

function destroyConnection(connection) {
  if (!connection) {
    return;
  }

  connection.removeAllListeners();
  try {
    connection.destroy();
  } catch {
    // Ignore cleanup failures.
  }
}

function stopStreamController(session, reason) {
  if (!session.streamController) {
    return;
  }

  const controller = session.streamController;
  session.streamController = null;
  controller.stop(reason);
}

function buildDelay(attempt) {
  return Math.min(config.reconnectBaseDelayMs * attempt, 15_000);
}

function bindPlayerEvents(session) {
  session.player.on(AudioPlayerStatus.Playing, () => {
    if (!isCurrentSession(session)) {
      return;
    }

    session.streamReconnectAttempts = 0;
    logger.info(`Audio player is streaming ${redactUrl(session.streamUrl)}`);
  });

  session.player.on(AudioPlayerStatus.Idle, () => {
    if (!isCurrentSession(session) || session.manualStop) {
      return;
    }

      // For on-demand tracks (YouTube/SoundCloud/search), idling means the track
      // finished (or skip was requested) — advance the queue instead of reconnecting.
      if ((session.track && session.track.type !== 'http') || session.skipRequested) {
        session.skipRequested = false;
        void advanceQueue(session, 'track ended or skipped');
        return;
      }

      // HTTP radio stream dropped — use the existing reconnect path.
      scheduleStreamReconnect(session, 'The audio player went idle.');
  });

  session.player.on('error', (error) => {
    if (!isCurrentSession(session) || session.manualStop) {
      return;
    }

    logger.error('Audio player error.', error.message);
    scheduleStreamReconnect(session, `Audio player error: ${error.message}`);
  });
}

/**
 * Convert a typed track object to the string yt-dlp expects as input.
 */
function trackToYtDlpInput(track) {
  if (track.type === 'search') {
    return `ytsearch1:${track.query}`;
  }

  return track.url;
}

function isDefaultStreamTrack(track) {
  return Boolean(
    config.defaultStreamUrl
      && track
      && track.type === 'http'
      && track.url === config.defaultStreamUrl,
  );
}

function buildDefaultStreamTrack() {
  if (!config.defaultStreamUrl) {
    return null;
  }

  return {
    type: 'http',
    url: config.defaultStreamUrl,
    query: null,
    title: 'default stream',
    requestedBy: 'system',
  };
}

/**
 * Dequeue the next track and start it in the existing session.
 * If the queue is empty, destroys the session instead.
 */
async function advanceQueue(session, reason) {
  if (!isCurrentSession(session)) {
    return;
  }

  const previousTrack = session.track;
  const nextTrack = dequeue(session.guildId);
  if (!nextTrack) {
    if (session.resumeDefaultStreamAfterQueue && !isDefaultStreamTrack(previousTrack)) {
      const defaultTrack = buildDefaultStreamTrack();
      if (defaultTrack) {
        logger.info(`Queue empty after ${reason}. Resuming the default stream.`);

        try {
          await startStream(session, defaultTrack);
          await notifyTextChannel(session, 'Queue finished. Resuming the default stream.');
          return;
        } catch (error) {
          logger.error('Failed to resume the default stream.', error.message);
        }
      }
    }

    logger.info(`Queue empty after ${reason}. Stopping session.`);
    await stopActiveSession(session.guildId, `queue empty after ${reason}`);
    return;
  }

  logger.info(`Queue advance: starting "${nextTrack.title}" after ${reason}.`);
  await notifyTextChannel(session, `Now playing: **${nextTrack.title}**`);

  try {
    await startStream(session, nextTrack);
  } catch (error) {
    logger.error('Failed to start next queued track.', error.message);
    await advanceQueue(session, `failed to start "${nextTrack.title}": ${error.message}`);
  }
}

function bindConnectionEvents(session, connection) {
  connection.on(VoiceConnectionStatus.Ready, () => {
    if (!isCurrentSession(session)) {
      return;
    }

    session.voiceReconnectAttempts = 0;
    logger.info(`Voice connection ready in guild ${session.guildId}`);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (!isCurrentSession(session) || session.manualStop) {
      return;
    }

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      scheduleVoiceReconnect(session, 'Voice connection disconnected.');
    }
  });

  connection.on('error', (error) => {
    if (!isCurrentSession(session) || session.manualStop) {
      return;
    }

    logger.error('Voice connection error.', error.message);
    scheduleVoiceReconnect(session, `Voice connection error: ${error.message}`);
  });
}

async function connectSession(session) {
  destroyConnection(session.connection);

  const connection = joinVoiceChannel({
    channelId: session.channelId,
    guildId: session.guildId,
    adapterCreator: session.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  session.connection = connection;
  bindConnectionEvents(session, connection);

  await entersState(connection, VoiceConnectionStatus.Ready, config.voiceReadyTimeoutMs);
  connection.subscribe(session.player);
}

async function startStream(session, track) {
  const currentTrack = track ?? session.track;
  stopStreamController(session, 'refreshing stream pipeline');

  // Store the track being started so event handlers can inspect its type
  if (currentTrack) {
    session.track = currentTrack;
    // Keep streamUrl in sync for logging / getActiveSessionSummary
    session.streamUrl = currentTrack.url ?? currentTrack.query ?? session.streamUrl;
  }

  let streamController;
  if (!currentTrack || currentTrack.type === 'http') {
    streamController = await spawnHlsTranscoder(session.streamUrl);
  } else {
    streamController = await spawnYtDlpStream(trackToYtDlpInput(currentTrack));
  }

  if (!isCurrentSession(session) || session.manualStop) {
    streamController.stop('session changed before playback started');
    return;
  }

  session.streamController = streamController;

  streamController.child.once('error', (error) => {
    if (!isActiveStreamController(session, streamController) || session.manualStop) {
      return;
    }

    logger.error('FFmpeg process error.', error.message);
    scheduleStreamReconnect(session, `FFmpeg process error: ${error.message}`);
  });

  streamController.child.once('close', (code, signal) => {
    if (!isActiveStreamController(session, streamController) || session.manualStop) {
      return;
    }

      // For on-demand tracks, exit code 0 means the track finished normally.
      // The player's Idle event will handle queue advancement — don't reconnect.
      if (code === 0 && session.track && session.track.type !== 'http') {
        return;
      }

    const detail = code !== null ? `exit code ${code}` : `signal ${signal || 'unknown'}`;
    const diagnostics = streamController.getDiagnostics();
    logger.warn(`FFmpeg closed with ${detail}. ${diagnostics || 'No diagnostic output.'}`);
    scheduleStreamReconnect(session, `FFmpeg stopped with ${detail}`);
  });

  const resource = createAudioResource(streamController.output, {
    inputType: StreamType.OggOpus,
    metadata: {
      sessionId: session.sessionId,
      streamUrl: session.streamUrl,
    },
  });

  session.player.play(resource);
}

function scheduleStreamReconnect(session, reason) {
  if (!isCurrentSession(session) || session.manualStop || session.streamReconnectTimer) {
    return;
  }

  if (session.streamReconnectAttempts >= config.streamReconnectLimit) {
    logger.error(`Stream reconnect limit reached. ${reason}`);
    void notifyTextChannel(
      session,
      `The stream dropped too many times and the reconnect limit was reached. Use ${config.commandPrefix}play to try again.`,
    );
    void stopActiveSession(session.guildId, 'stream reconnect limit reached');
    return;
  }

  session.streamReconnectAttempts += 1;
  const attempt = session.streamReconnectAttempts;
  const delay = buildDelay(attempt);
  logger.warn(`Scheduling stream reconnect ${attempt}/${config.streamReconnectLimit} in ${delay}ms. ${reason}`);

  session.streamReconnectTimer = setTimeout(async () => {
    session.streamReconnectTimer = null;

    if (!isCurrentSession(session) || session.manualStop) {
      return;
    }

    try {
      await startStream(session);
    } catch (error) {
      logger.error('Stream reconnect attempt failed.', error.message);
      scheduleStreamReconnect(session, error.message);
    }
  }, delay);

  session.streamReconnectTimer.unref?.();
}

function scheduleVoiceReconnect(session, reason) {
  if (!isCurrentSession(session) || session.manualStop || session.voiceReconnectTimer) {
    return;
  }

  if (session.voiceReconnectAttempts >= config.voiceReconnectLimit) {
    logger.error(`Voice reconnect limit reached. ${reason}`);
    void notifyTextChannel(
      session,
      `The voice connection could not recover. Use ${config.commandPrefix}play to try again.`,
    );
    void stopActiveSession(session.guildId, 'voice reconnect limit reached');
    return;
  }

  session.voiceReconnectAttempts += 1;
  const attempt = session.voiceReconnectAttempts;
  const delay = buildDelay(attempt);
  logger.warn(`Scheduling voice reconnect ${attempt}/${config.voiceReconnectLimit} in ${delay}ms. ${reason}`);

  session.voiceReconnectTimer = setTimeout(async () => {
    session.voiceReconnectTimer = null;

    if (!isCurrentSession(session) || session.manualStop) {
      return;
    }

    try {
      await connectSession(session);
    } catch (error) {
      logger.error('Voice reconnect attempt failed.', error.message);
      scheduleVoiceReconnect(session, error.message);
    }
  }, delay);

  session.voiceReconnectTimer.unref?.();
}

async function stopActiveSession(guildId, reason = 'manual stop') {
  const session = activeSessions.get(guildId);
  if (!session) {
    return false;
  }

  activeSessions.delete(guildId);
  session.manualStop = true;

  clearTimer(session.streamReconnectTimer);
  clearTimer(session.voiceReconnectTimer);

  if (session.songWatcher) {
    session.songWatcher.stop();
    session.songWatcher = null;
  }

  stopStreamController(session, reason);
  session.player.removeAllListeners();

  try {
    session.player.stop(true);
  } catch {
    // Ignore cleanup failures.
  }

  destroyConnection(session.connection);
  clearQueue(guildId);
  logger.info(`Guild ${guildId}: playback session stopped (${reason}).`);
  return true;
}

async function stopAllSessions(reason = 'shutdown') {
  const guildIds = [...activeSessions.keys()];
  if (guildIds.length === 0) {
    return;
  }

  logger.info(`Stopping all ${guildIds.length} active session(s): ${reason}`);
  await Promise.all(guildIds.map((guildId) => stopActiveSession(guildId, reason)));
}

/**
 * Stop the current track and advance to the next item in the queue.
 * If the queue is empty, the session is torn down.
 * Returns true if a session existed, false otherwise.
 */
async function skipCurrentTrack(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) {
    return false;
  }

  session.skipRequested = true;
  stopStreamController(session, 'skip requested');

  // Force the player to idle immediately; the idle handler will call advanceQueue.
  try {
    session.player.stop(true);
  } catch {
    // Ignore — advanceQueue will fire when the stream controller closes anyway.
  }

  return true;
}

async function playForMember({ member, textChannel, track }) {
  const voiceChannel = member.voice?.channel;
  if (!voiceChannel) {
    throw new Error('Join a voice channel first.');
  }

  if (config.allowedGuildId && member.guild.id !== config.allowedGuildId) {
    throw new Error('This bot is restricted to another server.');
  }

  const guildId = member.guild.id;

  // Stop any existing session in this guild before starting a new one.
  await stopActiveSession(guildId, `new play request from ${member.user.tag}`);

  const streamUrl = track.url ?? track.query ?? '';

  const session = {
    sessionId: randomUUID(),
    guildId,
    channelId: voiceChannel.id,
    guild: member.guild,
    textChannel,
    player: createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    }),
    connection: null,
    streamController: null,
    streamReconnectAttempts: 0,
    voiceReconnectAttempts: 0,
    streamReconnectTimer: null,
    voiceReconnectTimer: null,
    songWatcher: null,
    streamUrl,
    track,
    resumeDefaultStreamAfterQueue: isDefaultStreamTrack(track),
    skipRequested: false,
    manualStop: false,
  };

  bindPlayerEvents(session);
  activeSessions.set(guildId, session);

  try {
    await connectSession(session);
    await startStream(session, track);

    session.songWatcher = createSongWatcher({
      url: config.songPollUrl,
      intervalMs: config.songPollIntervalMs,
      onSongChange: async (newSong) => {
        if (!isCurrentSession(session)) {
          return;
        }
        await notifyTextChannel(session, newSong);
      },
    });

    return {
      channelName: voiceChannel.name,
      streamUrl,
    };
  } catch (error) {
    logger.error('Failed to start playback session.', error.message);
    await stopActiveSession(guildId, `startup failure: ${error.message}`);
    throw error;
  }
}

function getActiveSessionSummary(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) {
    return null;
  }

  return {
    guildId: session.guildId,
    channelId: session.channelId,
    streamUrl: session.streamUrl,
    track: session.track,
    resumeDefaultStreamAfterQueue: session.resumeDefaultStreamAfterQueue,
  };
}

function getActiveSessionCount() {
  return activeSessions.size;
}

module.exports = {
  getActiveSessionCount,
  getActiveSessionSummary,
  playForMember,
  stopActiveSession,
  stopAllSessions,
  skipCurrentTrack,
};
