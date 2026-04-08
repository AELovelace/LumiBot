const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const { config } = require('./config');
const { logger } = require('./logger');

const SERVICE_NAME = 'chatbot-rag';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVICE_SCRIPT_PATH = path.resolve(PROJECT_ROOT, 'python', 'chatbot_rag_service.py');
const HEALTHCHECK_TIMEOUT_MS = 1_500;
const REQUEST_TIMEOUT_MS = 10_000;
const SERVICE_STARTUP_TIMEOUT_MS = 10_000;

let pendingInitialize = null;
let managedServiceProcess = null;
let managedServiceOwned = false;
let activeServicePort = 8764; // RAG service port

function getServiceBaseUrl() {
  return `http://${config.chatbotMemoryServiceHost}:${activeServicePort}`;
}

async function isServiceHealthy() {
  try {
    const response = await fetch(`${getServiceBaseUrl()}/health`, {
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServiceHealthy(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServiceHealthy()) {
      return true;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }
  return false;
}

async function waitForProcessExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for process exit'));
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function spawnManagedService() {
  const candidate = {
    command: process.env.PYTHON_PATH || 'python',
    label: 'system python',
  };

  try {
    const child = spawn(candidate.command, [SERVICE_SCRIPT_PATH], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      env: {
        ...process.env,
        RAG_SERVICE_HOST: config.chatbotMemoryServiceHost,
        RAG_SERVICE_PORT: '8764',
      },
    });

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        child.removeAllListeners();
      };

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      child.once('error', (error) => {
        finishReject(error);
      });

      child.once('exit', (code, signal) => {
        finishReject(new Error(`Service exited (${code ?? 'null'}${signal ? `, ${signal}` : ''}).`));
      });

      waitForServiceHealthy(SERVICE_STARTUP_TIMEOUT_MS)
        .then((healthy) => {
          if (healthy) {
            finishResolve();
          } else {
            finishReject(new Error('Service did not become ready in time.'));
          }
        })
        .catch(finishReject);
    });
  } catch (error) {
    throw new Error(`Could not start RAG service: ${error.message}`);
  }
}

async function ensureServiceReady() {
  if (await isServiceHealthy()) {
    return;
  }

  if (!pendingInitialize) {
    pendingInitialize = spawnManagedService()
      .then(() => {
        managedServiceProcess = true; // Mark as ready
        managedServiceOwned = true;
        logger.info(`RAG service ready at ${getServiceBaseUrl()}`);
      })
      .catch((error) => {
        logger.warn(`Failed to start RAG service: ${error.message}`);
      })
      .finally(() => {
        pendingInitialize = null;
      });
  }

  await pendingInitialize;

  if (!(await isServiceHealthy())) {
    throw new Error('RAG service failed to start.');
  }
}

async function readJsonResponse(response) {
  const rawBody = await response.text();
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error(`Invalid JSON response from RAG service: ${rawBody.slice(0, 200)}`);
  }
}

async function serviceRequestJson(routePath, { method = 'GET', body = null } = {}) {
  await ensureServiceReady();

  const response = await fetch(`${getServiceBaseUrl()}${routePath}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || `RAG service returned ${response.status}.`);
  }

  return payload;
}

async function retrieveMemoryContext(userId, query, limit = 5) {
  try {
    const result = await serviceRequestJson('/rag/retrieve', {
      method: 'POST',
      body: {
        userId,
        query,
        limit,
      },
    });

    return result.context || '';
  } catch (error) {
    logger.warn(`Failed to retrieve RAG context: ${error.message}`);
    return '';
  }
}

module.exports = {
  retrieveMemoryContext,
};
