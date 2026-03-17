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

  function resolveYtDlpPath() {
  return config.ytdlpPath || 'yt-dlp';
}

/**
 * FFmpeg args that read audio from stdin (pipe:0) instead of a remote URL.
 * HTTP reconnect flags are omitted — yt-dlp owns the network connection.
 */
function buildFfmpegArgsFromStdin() {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    config.ffmpegLogLevel,
    '-i',
    'pipe:0',
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

function buildYtDlpArgs(ytInput) {
  return ['--no-playlist', '--quiet', '-f', 'bestaudio/best', '-o', '-', ytInput];
}

/**
 * Fetch the track title from yt-dlp without downloading audio.
 * Falls back to the raw input string on any error.
 * @param {string} ytInput  URL or ytsearch1:query
 */
async function resolveTitle(ytInput) {
  const ytdlpPath = resolveYtDlpPath();
  return new Promise((resolve) => {
    const child = spawn(
      ytdlpPath,
      ['--no-playlist', '--quiet', '--print', 'title', ytInput],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );

    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });

    child.once('close', () => {
      resolve(output.trim() || ytInput);
    });

    child.once('error', () => {
      resolve(ytInput);
    });
  });
}

/**
 * Spawn yt-dlp piped into FFmpeg, returning a stream controller with the same
 * shape as spawnHlsTranscoder so voice.js needs no special-casing.
 *
 * @param {string} ytInput  A URL or a ytsearch1:-prefixed search string.
 */
async function spawnYtDlpStream(ytInput) {
  const ytdlpPath = resolveYtDlpPath();
  const ffmpegPath = resolveFfmpegPath();

  if (!ffmpegPath) {
    throw new Error('FFmpeg was not found. Install dependencies or set FFMPEG_PATH.');
  }

  logger.info(`Starting yt-dlp stream for: ${ytInput}`);

  const ytdlp = spawn(ytdlpPath, buildYtDlpArgs(ytInput), {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ffmpeg = spawn(ffmpegPath, buildFfmpegArgsFromStdin(), {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let pipeDetached = false;
  function detachPipe() {
    if (pipeDetached) {
      return;
    }

    pipeDetached = true;
    try {
      ytdlp.stdout.unpipe(ffmpeg.stdin);
    } catch {
      // Ignore
    }
  }

  ytdlp.stdout.pipe(ffmpeg.stdin);

  ffmpeg.stdin.on('error', (error) => {
    if (error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED') {
      detachPipe();
      return;
    }

    logger.warn('FFmpeg stdin pipe error.', error.message);
  });

  ytdlp.once('close', () => {
    detachPipe();
    try {
      ffmpeg.stdin.end();
    } catch {
      // Ignore
    }
  });

  ffmpeg.once('close', () => {
    detachPipe();

    if (ytdlp.exitCode === null) {
      ytdlp.kill('SIGTERM');
    }
  });

  let recentDiagnostics = '';
  for (const proc of [ytdlp, ffmpeg]) {
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      recentDiagnostics = `${recentDiagnostics}${chunk}`.slice(-8_000);
    });
  }

  try {
    await Promise.all([
      Promise.race([
        once(ytdlp, 'spawn'),
        once(ytdlp, 'error').then(([error]) => {
          throw error;
        }),
      ]),
      Promise.race([
        once(ffmpeg, 'spawn'),
        once(ffmpeg, 'error').then(([error]) => {
          throw error;
        }),
      ]),
    ]);
  } catch (error) {
    throw new Error(`yt-dlp/FFmpeg could not start: ${error.message}`);
  }

  return {
    // Expose ffmpeg as the primary child so voice.js close/error hooks work
    child: ffmpeg,
    output: ffmpeg.stdout,
    getDiagnostics() {
      return recentDiagnostics.trim();
    },
    stop(reason = 'manual stop') {
      logger.info(`Stopping yt-dlp stream (${reason})`);

      detachPipe();
      try {
        ffmpeg.stdin.end();
      } catch {
        // Ignore
      }

      for (const proc of [ytdlp, ffmpeg]) {
        if (proc.exitCode !== null) {
          continue;
        }

        proc.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          if (proc.exitCode === null) {
            proc.kill('SIGKILL');
          }
        }, 5_000);
        killTimer.unref?.();
      }
    },
  };
}

module.exports = {
  buildFfmpegArgs,
  resolveFfmpegPath,
  resolveTitle,
  spawnHlsTranscoder,
  spawnYtDlpStream,
};
