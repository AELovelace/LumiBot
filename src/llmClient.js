const { config, getChatbotPersona } = require('./config');
const { logger } = require('./logger');

let endpointIndex = 0;
const BANNED_REPLY_PATTERNS = [
  /\byou know who you are\b[.!?]*/giu,
];
const MAX_RECENT_ASSISTANT_MESSAGES = 4;
const DUPLICATE_SENTENCE_THRESHOLD = 0.8;
const DUPLICATE_MESSAGE_THRESHOLD = 0.88;

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

function stripBannedReplyPhrases(text) {
  let cleaned = text;

  BANNED_REPLY_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '');
  });

  return cleaned
    .replace(/\s+([,.!?;:])/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function normalizeForComparison(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenizeForComparison(text) {
  const normalized = normalizeForComparison(text);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function splitIntoSentences(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }

  return text
    .split(/(?<=[.!?])\s+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getOverlapRatio(sourceTokens, targetTokens) {
  if (sourceTokens.length === 0 || targetTokens.length === 0) {
    return 0;
  }

  const sourceSet = new Set(sourceTokens);
  const targetSet = new Set(targetTokens);
  let shared = 0;

  targetSet.forEach((token) => {
    if (sourceSet.has(token)) {
      shared += 1;
    }
  });

  return shared / Math.max(1, Math.min(sourceSet.size, targetSet.size));
}

function isNearDuplicateText(left, right, threshold) {
  const normalizedLeft = normalizeForComparison(left);
  const normalizedRight = normalizeForComparison(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
    && Math.min(normalizedLeft.length, normalizedRight.length) >= 24
  ) {
    return true;
  }

  const overlap = getOverlapRatio(
    tokenizeForComparison(normalizedLeft),
    tokenizeForComparison(normalizedRight),
  );
  return overlap >= threshold;
}

function getRecentAssistantMessages(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((entry) => entry?.role === 'assistant' && typeof entry.content === 'string' && entry.content.trim())
    .slice(-MAX_RECENT_ASSISTANT_MESSAGES)
    .map((entry) => entry.content.trim());
}

function pruneRepeatedEdgeSentences(text, recentAssistantMessages) {
  if (typeof text !== 'string' || !text.trim() || recentAssistantMessages.length === 0) {
    return text;
  }

  const candidateSentences = splitIntoSentences(text);
  if (candidateSentences.length === 0) {
    return text;
  }

  const recentFirstSentences = recentAssistantMessages
    .map((message) => splitIntoSentences(message)[0])
    .filter(Boolean);
  const recentLastSentences = recentAssistantMessages
    .map((message) => {
      const sentences = splitIntoSentences(message);
      return sentences[sentences.length - 1];
    })
    .filter(Boolean);

  while (
    candidateSentences.length > 1
    && recentFirstSentences.some((prior) => isNearDuplicateText(
      candidateSentences[0],
      prior,
      DUPLICATE_SENTENCE_THRESHOLD,
    ))
  ) {
    candidateSentences.shift();
  }

  while (
    candidateSentences.length > 1
    && recentLastSentences.some((prior) => isNearDuplicateText(
      candidateSentences[candidateSentences.length - 1],
      prior,
      DUPLICATE_SENTENCE_THRESHOLD,
    ))
  ) {
    candidateSentences.pop();
  }

  return candidateSentences.join(' ').trim();
}

function diversifyAgainstRecentAssistantHistory(text, history) {
  if (typeof text !== 'string' || !text.trim()) {
    return text;
  }

  const recentAssistantMessages = getRecentAssistantMessages(history);
  if (recentAssistantMessages.length === 0) {
    return text;
  }

  let diversified = pruneRepeatedEdgeSentences(text, recentAssistantMessages);
  const latestAssistantMessage = recentAssistantMessages[recentAssistantMessages.length - 1];

  if (
    diversified
    && isNearDuplicateText(diversified, latestAssistantMessage, DUPLICATE_MESSAGE_THRESHOLD)
  ) {
    const diversifiedSentences = splitIntoSentences(diversified);
    if (diversifiedSentences.length > 1) {
      diversified = diversifiedSentences.slice(1).join(' ').trim();
    }
  }

  return diversified || text;
}

function buildPrompt({ persona, history, latestContent, memoryClues, ragContext, deepRecall, searchResults }) {
  const renderedHistory = history
    .map((entry) => `${entry.role === 'assistant' ? 'Lumi' : entry.author}: ${entry.content}`)
    .join('\n');

  const sections = [
    `System: ${persona}`,
    'System: Keep responses concise, natural, and chat-friendly for Discord.',
    'System: Avoid roleplay-heavy formatting and avoid walls of text.',
    'System: Do not reuse the same opener, signature line, or catchphrase from your recent assistant messages.',
    'System: Never use the exact phrase "you know who you are".',
  ];

  // Add RAG context if available
  if (ragContext && ragContext.trim()) {
    sections.push(
      'System: Use the memory context below if relevant to the user\'s message:',
      ragContext,
    );
  } else if (memoryClues && memoryClues.length > 0) {
    sections.push(
      'System: Use long-term memory clues only when relevant and do not claim certainty if memory is weak.',
    );
  }

  sections.push(
    deepRecall
      ? 'System: The user asked for recall. Prioritize memory clues when they appear relevant.'
      : 'System: Use recent context first. Use memory clues only if they clearly help.',
    renderedHistory ? `Recent chat context:\n${renderedHistory}` : 'Recent chat context: none',
  );

  if (!ragContext || !ragContext.trim()) {
    sections.push(renderMemoryClues(memoryClues));
  }

  if (searchResults) {
    sections.push(
      `Web search results for the user's query:\n${searchResults}`,
      'System: Use these web search results to inform your answer. Cite sources when relevant but stay in character.',
    );
  }

  sections.push(`User message: ${latestContent}`, 'Reply as Lumi:');
  return sections.join('\n\n');
}

function normalizeResponse(text, maxChars, history) {
  const stripped = stripBannedReplyPhrases(text);
  const diversified = diversifyAgainstRecentAssistantHistory(stripped, history);
  const compact = diversified.replace(/\s+/gu, ' ').trim();
  if (!compact) {
    return '';
  }

  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, Math.max(1, maxChars - 3)).trim()}...`;
}

function sanitizeGifQuery(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized || normalized.length < 2) {
    return null;
  }

  return normalized.slice(0, 64);
}

function parseGifSuggestion(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return null;
  }

  const raw = content.trim();
  const fencedMatch = raw.match(/\{[\s\S]*\}/u);
  const candidate = fencedMatch ? fencedMatch[0] : raw;

  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const useGif = Boolean(parsed.useGif);
    if (!useGif) {
      return null;
    }

    return sanitizeGifQuery(parsed.query);
  } catch {
    return null;
  }
}

async function requestLlmCompletion({
  latestContent,
  history,
  memoryClues,
  ragContext,
  deepRecall,
  maxResponseChars,
  searchResults,
  systemOverride,
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
      const promptSections = systemOverride
        ? [
          `System: ${getChatbotPersona()}`,
          systemOverride,
          'System: Do not reuse the same opener, signature line, or catchphrase from your recent assistant messages.',
          'System: Never use the exact phrase "you know who you are".',
          `User message: ${latestContent}`,
          'Reply as Lumi:',
        ].join('\n\n')
        : buildPrompt({
          persona: getChatbotPersona(),
          history,
          latestContent,
          memoryClues,
          ragContext,
          deepRecall,
          searchResults,
        });

      const response = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.chatbotModel,
          stream: false,
          prompt: promptSections,
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
      return normalizeResponse(completion, maxChars, history);
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

async function requestGifSuggestion({ latestContent, assistantResponse, history = [] }) {
  if (!config.chatbotGifEnabled) {
    return null;
  }

  const maxAttempts = Math.max(1, config.llmRetryLimit + 1);
  const failures = [];
  const localFirstEndpoints = config.llmUseLocalGpu ? getLocalFirstEndpoints() : null;
  const renderedHistory = history
    .slice(-6)
    .map((entry) => `${entry.role === 'assistant' ? 'Lumi' : entry.author}: ${entry.content}`)
    .join('\n');

  const prompt = [
    `System: ${getChatbotPersona()}`,
    'System: Decide whether Lumi should add one Giphy reaction GIF URL after this reply.',
    'System: Return strict JSON only with keys useGif (boolean) and query (string).',
    'System: Use useGif=true only when a GIF adds clear emotional tone, humor, or emphasis.',
    'System: Keep query short (2 to 5 words), lowercase, no punctuation, no hashtags.',
    'System: If GIF is not needed or context is serious/sensitive, use useGif=false and query="".',
    renderedHistory ? `Recent chat context:\n${renderedHistory}` : 'Recent chat context: none',
    `Latest user message: ${latestContent}`,
    `Lumi draft reply: ${assistantResponse}`,
    'JSON:',
  ].join('\n\n');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const endpoint = selectEndpointForAttempt(attempt, localFirstEndpoints);
    if (!endpoint) {
      throw new Error('No LLM endpoints configured.');
    }

    try {
      const response = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.chatbotModel,
          stream: false,
          prompt,
        }),
        signal: AbortSignal.timeout(config.llmTimeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const completion = typeof payload.response === 'string' ? payload.response : '';
      const parsedQuery = parseGifSuggestion(completion);
      if (!parsedQuery) {
        return null;
      }

      return parsedQuery;
    } catch (error) {
      failures.push(`${endpoint}: ${error.message}`);
      logger.warn(
        `GIF suggestion request failed on ${endpoint} (attempt ${attempt}/${maxAttempts}).`,
        error.message,
      );

      if (attempt < maxAttempts) {
        await sleep(buildDelay(attempt));
      }
    }
  }

  logger.warn(`All GIF suggestion attempts failed. ${failures.join(' | ')}`);
  return null;
}

module.exports = {
  requestGifSuggestion,
  requestLlmCompletion,
};
