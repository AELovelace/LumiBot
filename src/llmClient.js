const { config } = require('./config');
const { logger } = require('./logger');

let endpointIndex = 0;

function buildDelay(attempt) {
  return Math.min(config.llmRetryBaseDelayMs * attempt, 8_000);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextEndpoint() {
  if (config.llmEndpoints.length === 0) {
    return null;
  }

  const selected = config.llmEndpoints[endpointIndex % config.llmEndpoints.length];
  endpointIndex += 1;
  return selected;
}

function getLocalFirstEndpoints() {
  const configured = config.llmEndpoints.filter(Boolean);
  if (configured.length === 0) {
    return [];
  }

  if (!config.llmUseLocalGpu || !config.llmLocalEndpoint) {
    return configured;
  }

  return [
    config.llmLocalEndpoint,
    ...configured.filter((endpoint) => endpoint !== config.llmLocalEndpoint),
  ];
}

function selectEndpointForAttempt(attempt, localFirstEndpoints) {
  if (localFirstEndpoints) {
    if (localFirstEndpoints.length === 0) {
      return null;
    }

    return localFirstEndpoints[(attempt - 1) % localFirstEndpoints.length];
  }

  return nextEndpoint();
}

function buildPrompt({ persona, history, latestContent }) {
  const renderedHistory = history
    .map((entry) => `${entry.role === 'assistant' ? 'Lumi' : entry.author}: ${entry.content}`)
    .join('\n');

  return [
    `System: ${persona}`,
    'System: Keep responses concise, natural, and chat-friendly for Discord.',
    'System: Avoid roleplay-heavy formatting and avoid walls of text.',
    renderedHistory ? `Recent chat context:\n${renderedHistory}` : 'Recent chat context: none',
    `User message: ${latestContent}`,
    'Reply as Lumi:',
  ].join('\n\n');
}

function normalizeResponse(text, maxChars) {
  const compact = text.replace(/\s+/gu, ' ').trim();
  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, Math.max(1, maxChars - 3)).trim()}...`;
}

async function requestLlmCompletion({ latestContent, history, maxResponseChars }) {
  const maxAttempts = Math.max(1, config.llmRetryLimit + 1);
  const failures = [];
  const localFirstEndpoints = config.llmUseLocalGpu ? getLocalFirstEndpoints() : null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const endpoint = selectEndpointForAttempt(attempt, localFirstEndpoints);
    if (!endpoint) {
      throw new Error('No LLM endpoints configured.');
    }

    const startedAt = Date.now();

    try {
      const response = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.chatbotModel,
          stream: false,
          prompt: buildPrompt({
            persona: config.chatbotPersona,
            history,
            latestContent,
          }),
        }),
        signal: AbortSignal.timeout(config.llmTimeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const completion = typeof payload.response === 'string' ? payload.response : '';
      if (!completion.trim()) {
        throw new Error('Empty response from model.');
      }

      logger.debug(
        `LLM request succeeded in ${Date.now() - startedAt}ms via ${endpoint} (attempt ${attempt}/${maxAttempts}).`,
      );
      const maxChars = Number.isFinite(maxResponseChars)
        ? Number(maxResponseChars)
        : config.chatbotMaxResponseChars;
      return normalizeResponse(completion, maxChars);
    } catch (error) {
      failures.push(`${endpoint}: ${error.message}`);
      logger.warn(
        `LLM request failed on ${endpoint} in ${Date.now() - startedAt}ms (attempt ${attempt}/${maxAttempts}).`,
        error.message,
      );

      if (attempt < maxAttempts) {
        await sleep(buildDelay(attempt));
      }
    }
  }

  throw new Error(`All LLM endpoints failed. ${failures.join(' | ')}`);
}

module.exports = {
  requestLlmCompletion,
};
