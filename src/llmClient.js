const { config, getChatbotPersona } = require('./config');
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

function renderMemoryClues(memoryClues) {
  if (!Array.isArray(memoryClues) || memoryClues.length === 0) {
    return 'Long-term memory clues: none';
  }

  const rendered = memoryClues
    .map((entry, index) => {
      const role = entry.role === 'assistant' ? 'assistant' : 'user';
      const author = typeof entry.author === 'string' && entry.author.trim()
        ? entry.author.trim()
        : role === 'assistant'
          ? 'Lumi'
          : 'unknown';
      const userId = typeof entry.userId === 'string' ? entry.userId : 'unknown';
      const channelId = typeof entry.channelId === 'string' ? entry.channelId : 'unknown';
      const content = typeof entry.content === 'string' ? entry.content.trim() : '';
      return `${index + 1}. [user=${userId}] [channel=${channelId}] [${role}] ${author}: ${content}`;
    })
    .join('\n');

  return `Long-term memory clues:\n${rendered}`;
}

function buildPrompt({ persona, history, latestContent, memoryClues, deepRecall }) {
  const renderedHistory = history
    .map((entry) => `${entry.role === 'assistant' ? 'Lumi' : entry.author}: ${entry.content}`)
    .join('\n');

  return [
    `System: ${persona}`,
    'System: Keep responses concise, natural, and chat-friendly for Discord.',
    'System: Avoid roleplay-heavy formatting and avoid walls of text.',
    'System: Use long-term memory clues only when relevant and do not claim certainty if memory is weak.',
    deepRecall
      ? 'System: The user asked for recall. Prioritize memory clues when they appear relevant.'
      : 'System: Use recent context first. Use memory clues only if they clearly help.',
    renderedHistory ? `Recent chat context:\n${renderedHistory}` : 'Recent chat context: none',
    renderMemoryClues(memoryClues),
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

async function requestLlmCompletion({
  latestContent,
  history,
  memoryClues,
  deepRecall,
  maxResponseChars,
}) {
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
            persona: getChatbotPersona(),
            history,
            latestContent,
            memoryClues,
            deepRecall,
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
