const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const { config } = require('./config');
const { logger } = require('./logger');

const SERVICE_NAME = 'chatbot-memory-sql';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVICE_SCRIPT_PATH = path.resolve(PROJECT_ROOT, 'python', 'chatbot_memory_service.py');
const HEALTHCHECK_TIMEOUT_MS = 1_500;
const REQUEST_TIMEOUT_MS = 10_000;
const SERVICE_STARTUP_TIMEOUT_MS = 12_000;

let pendingTimer = null;
let pendingWrite = Promise.resolve();
let serviceReadyPromise = null;
let managedServiceProcess = null;
let managedServiceOwned = false;
let activeServicePort = config.chatbotMemoryServicePort;

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      author: typeof item.author === 'string' ? item.author : 'unknown',
      content: typeof item.content === 'string' ? item.content : '',
      timestamp: Number.isFinite(item.timestamp) ? Number(item.timestamp) : 0,
    }))
    .filter((item) => item.content.trim().length > 0)
    .slice(-Math.max(1, config.chatbotContextMessages));
}

function normalizeState(raw) {
  const channels = {};
  if (raw && typeof raw === 'object' && raw.channels && typeof raw.channels === 'object') {
    Object.entries(raw.channels).forEach(([channelId, value]) => {
      if (!value || typeof value !== 'object') {
        return;
      }

      channels[channelId] = {
        history: normalizeHistory(value.history),
        lastReplyAt: Number.isFinite(value.lastReplyAt) ? Number(value.lastReplyAt) : 0,
      };
    });
  }

  return {
    channels,
    settings: raw && typeof raw === 'object' && raw.settings && typeof raw.settings === 'object'
      ? raw.settings
      : {},
  };
}

function getServiceBaseUrl() {
  return `http://${config.chatbotMemoryServiceHost}:${activeServicePort}`;
}

function resolveProjectPath(targetPath) {
  if (!targetPath) {
    return null;
  }

  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(PROJECT_ROOT, targetPath);
}

function resolvePythonCandidates() {
  const candidates = [];
  const pushCandidate = (command, argsPrefix, label) => {
    if (!command) {
      return;
    }

    const signature = `${command}::${argsPrefix.join(' ')}`;
    if (candidates.some((candidate) => candidate.signature === signature)) {
      return;
    }

    candidates.push({
      command,
      argsPrefix,
      label,
      signature,
    });
  };

  if (config.chatbotMemoryPythonPath) {
    pushCandidate(config.chatbotMemoryPythonPath, [], 'configured python');
  }

  const workspaceVenvPython = process.platform === 'win32'
    ? path.resolve(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
    : path.resolve(PROJECT_ROOT, '.venv', 'bin', 'python');
  if (existsSync(workspaceVenvPython)) {
    pushCandidate(workspaceVenvPython, [], 'workspace virtual environment');
  }

  pushCandidate('python', [], 'python on PATH');

  if (process.platform === 'win32') {
    pushCandidate('py', ['-3'], 'Windows py launcher');
  } else {
    pushCandidate('python3', [], 'python3 on PATH');
  }

  return candidates;
}

function buildServiceEnvironment(servicePort) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    CHATBOT_MEMORY_SERVICE_HOST: config.chatbotMemoryServiceHost,
    CHATBOT_MEMORY_SERVICE_PORT: String(servicePort),
    CHATBOT_MEMORY_DB_FILE: resolveProjectPath(config.chatbotMemoryDbFile) || '',
    CHATBOT_MEMORY_LEGACY_FILE: resolveProjectPath(config.chatbotMemoryLegacyFile) || '',
  };
}

function probeLocalPort(port) {
  return new Promise((resolve) => {
    const probeServer = net.createServer();
    const finalize = (value) => {
      probeServer.removeAllListeners();
      resolve(value);
    };

    probeServer.once('error', () => {
      finalize(null);
    });

    probeServer.listen({
      host: config.chatbotMemoryServiceHost,
      port,
      exclusive: true,
    }, () => {
      const address = probeServer.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      probeServer.close(() => {
        finalize(resolvedPort);
      });
    });
  });
}

async function resolveLaunchPort() {
  const preferredPort = config.chatbotMemoryServicePort;
  const preferredResult = await probeLocalPort(preferredPort);
  if (preferredResult === preferredPort) {
    return preferredPort;
  }

  const fallbackPort = await probeLocalPort(0);
  if (!fallbackPort) {
    throw new Error(`Could not reserve a local port for the chatbot memory SQL service on ${config.chatbotMemoryServiceHost}.`);
  }

  logger.warn(`Chatbot memory service port ${preferredPort} is unavailable. Using fallback port ${fallbackPort}.`);
  return fallbackPort;
}

function pipeProcessLogs(stream, writeLog) {
  if (!stream) {
    return;
  }

  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/u);
    buffer = parts.pop() ?? '';
    parts
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        writeLog(line);
      });
  });
  stream.on('end', () => {
    const trailing = buffer.trim();
    if (trailing) {
      writeLog(trailing);
    }
  });
}

async function isServiceHealthy() {
  try {
    const response = await fetch(`${getServiceBaseUrl()}/health`, {
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return payload?.ok === true && payload?.service === SERVICE_NAME;
  } catch {
    return false;
  }
}

async function waitForServiceHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isServiceHealthy()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for ${SERVICE_NAME} to become ready.`);
}

function waitForProcessExit(processHandle, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!processHandle || processHandle.exitCode !== null) {
      resolve();
      return;
    }

    let timeoutId = null;
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      processHandle.off('exit', handleExit);
      processHandle.off('error', handleError);
    };
    const handleExit = () => {
      cleanup();
      resolve();
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for chatbot memory service to exit.'));
      }, timeoutMs);
    }

    processHandle.once('exit', handleExit);
    processHandle.once('error', handleError);
  });
}

async function spawnManagedService() {
  if (!existsSync(SERVICE_SCRIPT_PATH)) {
    throw new Error(`Chatbot memory service script was not found at ${SERVICE_SCRIPT_PATH}.`);
  }

  const candidates = resolvePythonCandidates();
  if (candidates.length === 0) {
    throw new Error('No Python interpreter candidates were available for the chatbot memory service.');
  }

  const launchPort = await resolveLaunchPort();
  activeServicePort = launchPort;

  let lastError = new Error('Unknown chatbot memory service startup failure.');

  for (const candidate of candidates) {
    let child = null;

    try {
      child = spawn(candidate.command, [...candidate.argsPrefix, SERVICE_SCRIPT_PATH], {
        cwd: PROJECT_ROOT,
        env: buildServiceEnvironment(launchPort),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      pipeProcessLogs(child.stdout, (message) => logger.info(message));
      pipeProcessLogs(child.stderr, (message) => logger.warn(message));

      await new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          child.off('error', handleError);
          child.off('exit', handleExit);
        };

        const finishResolve = () => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve();
        };

        const finishReject = (error) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          reject(error);
        };

        const handleError = (error) => {
          finishReject(error);
        };

        const handleExit = (code, signal) => {
          finishReject(new Error(`Service exited before becoming ready (${code ?? 'null'}${signal ? `, ${signal}` : ''}).`));
        };

        child.once('error', handleError);
        child.once('exit', handleExit);

        waitForServiceHealthy(SERVICE_STARTUP_TIMEOUT_MS)
          .then(finishResolve)
          .catch(finishReject);
      });

      managedServiceProcess = child;
      managedServiceOwned = true;

      child.on('exit', (code, signal) => {
        const stopRequested = child.__stopRequested === true;
        if (managedServiceProcess === child) {
          managedServiceProcess = null;
          managedServiceOwned = false;
          activeServicePort = config.chatbotMemoryServicePort;
        }

        if (stopRequested) {
          logger.info('Chatbot memory SQL service stopped.');
          return;
        }

        logger.warn(`Chatbot memory SQL service stopped unexpectedly (${code ?? 'null'}${signal ? `, ${signal}` : ''}).`);
      });

      child.on('error', (error) => {
        if (managedServiceProcess === child) {
          managedServiceProcess = null;
          managedServiceOwned = false;
          activeServicePort = config.chatbotMemoryServicePort;
        }

        logger.warn('Chatbot memory SQL service process error.', error.message);
      });

      logger.info(`Chatbot memory SQL service ready at ${getServiceBaseUrl()} using ${candidate.label}.`);
      return;
    } catch (error) {
      lastError = error;

      if (child && child.exitCode === null) {
        child.__stopRequested = true;
        child.kill();
        try {
          await waitForProcessExit(child, 2_000);
        } catch {
          // Ignore cleanup failures while trying the next Python candidate.
        }
      }
    }
  }

  activeServicePort = config.chatbotMemoryServicePort;
  throw new Error(`Could not start chatbot memory SQL service. ${lastError.message}`);
}

async function ensureServiceReady() {
  if (await isServiceHealthy()) {
    return;
  }

  if (!serviceReadyPromise) {
    serviceReadyPromise = spawnManagedService().finally(() => {
      serviceReadyPromise = null;
    });
  }

  await serviceReadyPromise;
}

async function readJsonResponse(response) {
  const rawBody = await response.text();
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error(`Invalid JSON response from chatbot memory service: ${rawBody.slice(0, 200)}`);
  }
}

async function loadChatbotState() {
  try {
    await ensureServiceReady();
    const response = await fetch(`${getServiceBaseUrl()}/state`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload?.error || `Memory service returned ${response.status}.`);
    }

    return normalizeState(payload);
  } catch (error) {
    logger.warn('Could not load chatbot memory from SQL service. Starting fresh.', error.message);
    return { channels: {}, settings: {} };
  }
}

async function writeSnapshot(snapshot) {
  await ensureServiceReady();
  const response = await fetch(`${getServiceBaseUrl()}/state`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Memory service returned ${response.status}.`);
  }
}

function scheduleStateSave(snapshotBuilder) {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const snapshot = snapshotBuilder();
    pendingWrite = pendingWrite
      .then(() => writeSnapshot(snapshot))
      .catch((error) => {
        logger.warn('Failed to persist chatbot state.', error.message);
      });
  }, config.chatbotMemoryFlushMs);
}

async function flushStateSave(snapshotBuilder) {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  const snapshot = snapshotBuilder();
  pendingWrite = pendingWrite
    .then(() => writeSnapshot(snapshot))
    .catch((error) => {
      logger.warn('Failed to flush chatbot state.', error.message);
    });

  await pendingWrite;
}

async function closeChatbotStateStore() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  await pendingWrite.catch(() => {
    // Persistence failures are already logged where they occur.
  });

  if (!managedServiceOwned || !managedServiceProcess) {
    return;
  }

  const processToStop = managedServiceProcess;
  processToStop.__stopRequested = true;

  try {
    await fetch(`${getServiceBaseUrl()}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // If the HTTP shutdown misses, fall back to terminating the process below.
  }

  if (processToStop.exitCode === null) {
    try {
      await waitForProcessExit(processToStop, 1_500);
    } catch (error) {
      processToStop.kill();
      try {
        await waitForProcessExit(processToStop, 3_000);
      } catch {
        logger.warn('Failed to stop chatbot memory SQL service cleanly.', error.message);
      }
    }
  }

  if (managedServiceProcess === processToStop) {
    managedServiceProcess = null;
    managedServiceOwned = false;
  }

  activeServicePort = config.chatbotMemoryServicePort;
}

module.exports = {
  closeChatbotStateStore,
  loadChatbotState,
  scheduleStateSave,
  flushStateSave,
};
