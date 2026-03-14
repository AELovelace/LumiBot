const { spawn } = require('node:child_process');
const { once } = require('node:events');

const ffmpegStatic = require('ffmpeg-static');

const { config, redactUrl } = require('./config');
const { logger } = require('./logger');

function resolveFfmpegPath() {
  return config.ffmpegPath || ffmpegStatic;
}

function buildFfmpegArgs(streamUrl) {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    config.ffmpegLogLevel,
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_on_network_error',
    '1',
    '-reconnect_on_http_error',
    '4xx,5xx',
    '-reconnect_delay_max',
    '5',
    '-rw_timeout',
    '15000000',
    '-user_agent',
    config.ffmpegUserAgent,
    '-i',
    streamUrl,
    '-vn',
    '-map',
    '0:a:0?',
    '-acodec',
    'libopus',
    '-application',
    'audio',
    '-frame_duration',
    '20',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    `${config.opusBitrateKbps}k`,
    '-f',
    'ogg',
    'pipe:1',
  ];
}

async function spawnHlsTranscoder(streamUrl) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error('FFmpeg was not found. Install dependencies or set FFMPEG_PATH.');
  }

  const ffmpegArgs = buildFfmpegArgs(streamUrl);
  logger.info(`Starting FFmpeg for ${redactUrl(streamUrl)}`);

  const child = spawn(ffmpegPath, ffmpegArgs, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let recentDiagnostics = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    recentDiagnostics = `${recentDiagnostics}${chunk}`.slice(-8_000);
  });

  try {
    await Promise.race([
      once(child, 'spawn'),
      once(child, 'error').then(([error]) => {
        throw error;
      }),
    ]);
  } catch (error) {
    throw new Error(`FFmpeg could not start: ${error.message}`);
  }

  return {
    child,
    output: child.stdout,
    getDiagnostics() {
      return recentDiagnostics.trim();
    },
    stop(reason = 'manual stop') {
      if (child.exitCode !== null) {
        return;
      }

      logger.info(`Stopping FFmpeg (${reason})`);
      child.kill('SIGTERM');

      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 5_000);

      killTimer.unref?.();
    },
  };
}

module.exports = {
  buildFfmpegArgs,
  resolveFfmpegPath,
  spawnHlsTranscoder,
};
