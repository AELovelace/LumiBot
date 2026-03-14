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
const { spawnHlsTranscoder } = require('./stream');

const activeSessions = new Map();

function isCurrentSession(session) {
  return activeSessions.get(session.guildId)?.sessionId === session.sessionId;
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

async function startStream(session) {
  stopStreamController(session, 'refreshing stream pipeline');

  const streamController = await spawnHlsTranscoder(session.streamUrl);
  if (!isCurrentSession(session) || session.manualStop) {
    streamController.stop('session changed before playback started');
    return;
  }

  session.streamController = streamController;

  streamController.child.once('error', (error) => {
    if (!isCurrentSession(session) || session.manualStop) {
      return;
    }

    logger.error('FFmpeg process error.', error.message);
    scheduleStreamReconnect(session, `FFmpeg process error: ${error.message}`);
  });

  streamController.child.once('close', (code, signal) => {
    if (!isCurrentSession(session) || session.manualStop) {
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

async function playForMember({ member, textChannel, streamUrl }) {
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
    manualStop: false,
  };

  bindPlayerEvents(session);
  activeSessions.set(guildId, session);

  try {
    await connectSession(session);
    await startStream(session);

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
};
