const { config, getChatbotPersona } = require('./config');
const { logger } = require('./logger');
const { relayThoughtSegments } = require('./thoughtRelay');

let endpointIndex = 0;
const BANNED_REPLY_PATTERNS = [
  /\byou know who you are\b[.!?]*/giu,
];
const MAX_RECENT_ASSISTANT_MESSAGES = 4;
const DUPLICATE_SENTENCE_THRESHOLD = 0.8;
const DUPLICATE_MESSAGE_THRESHOLD = 0.88;
const MAX_FINAL_SENTENCES = 10;

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

function renderUserContextProfile(userContextProfile) {
  if (!userContextProfile || typeof userContextProfile !== 'object') {
    return '';
  }

  const sections = [];

  if (typeof userContextProfile.summary === 'string' && userContextProfile.summary.trim()) {
    sections.push(userContextProfile.summary.trim());
  } else {
    const knownFacts = Array.isArray(userContextProfile.knownFacts) ? userContextProfile.knownFacts : [];
    const preferences = Array.isArray(userContextProfile.preferences) ? userContextProfile.preferences : [];
    const ongoingTopics = Array.isArray(userContextProfile.ongoingTopics) ? userContextProfile.ongoingTopics : [];
    const responseStyleHints = Array.isArray(userContextProfile.responseStyleHints)
      ? userContextProfile.responseStyleHints
      : [];
    const recentHighlights = Array.isArray(userContextProfile.recentHighlights)
      ? userContextProfile.recentHighlights
      : [];

    if (knownFacts.length > 0) {
      sections.push(`Known facts: ${knownFacts.join('; ')}`);
    }
    if (preferences.length > 0) {
      sections.push(`Preferences: ${preferences.join('; ')}`);
    }
    if (ongoingTopics.length > 0) {
      sections.push(`Recurring topics: ${ongoingTopics.join(', ')}`);
    }
    if (recentHighlights.length > 0) {
      sections.push(`Recent user context: ${recentHighlights.join(' | ')}`);
    }
    if (responseStyleHints.length > 0) {
      sections.push(`Response style hints: ${responseStyleHints.join(' ')}`);
    }
  }

  if (sections.length === 0) {
    return '';
  }

  return `User context profile:\n${sections.join('\n')}`;
}

function extractThoughtSegments(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }

  const leakSignalPattern = /(\bi\s+(?:need|should|can|could|must|will|want|have\s+to)\b|\bthe\s+user\s+is\s+probably\b|\bmaybe\s+something\s+like\b|\bkeep\s+it\s+short\b|\bin\s+line\s+with\s+(?:my|the)\s+vibe\b)/giu;
  const quotePattern = /"([^"\n]{8,700})"|“([^”\n]{8,700})”/gu;

  function extractQuotedCandidates(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return [];
    }

    return [...value.matchAll(quotePattern)]
      .map((match) => {
        const candidate = typeof match[1] === 'string' && match[1]
          ? match[1]
          : match[2];
        return typeof candidate === 'string' ? candidate.trim() : '';
      })
      .filter((candidate) => candidate.length >= 8);
  }

  function isReasoningLeak(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return false;
    }

    const matches = value.match(leakSignalPattern) || [];
    return matches.length >= 2;
  }

  const segments = [];
  const closedPattern = /<think>([\s\S]*?)<\/think>/giu;

  for (const match of text.matchAll(closedPattern)) {
    const segment = typeof match[1] === 'string' ? match[1].trim() : '';
    if (segment) {
      segments.push(segment);
    }
  }

  const withoutClosed = text.replace(closedPattern, '');
  const unclosedMatch = withoutClosed.match(/<think>([\s\S]*)/iu);
  if (unclosedMatch && typeof unclosedMatch[1] === 'string') {
    const segment = unclosedMatch[1].replace(/<\/think>/giu, '').trim();
    if (segment) {
      segments.push(segment);
    }
  }

  if (segments.length === 0 && isReasoningLeak(text)) {
    const candidates = extractQuotedCandidates(text);
    const selectedCandidate = candidates.length > 0 ? candidates[candidates.length - 1] : '';
    const thoughtText = selectedCandidate
      ? text.replace(`"${selectedCandidate}"`, '').trim()
      : text.trim();

    if (thoughtText) {
      segments.push(thoughtText.slice(0, 1600));
    }
  }

  return segments;
}

function extractQuotedReplyFromReasoningLeak(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  const leakSignalPattern = /(\bi\s+(?:need|should|can|could|must|will|want|have\s+to)\b|\bthe\s+user\s+is\s+probably\b|\bmaybe\s+something\s+like\b|\bkeep\s+it\s+short\b|\bin\s+line\s+with\s+(?:my|the)\s+vibe\b)/giu;
  const matches = text.match(leakSignalPattern) || [];
  if (matches.length < 2) {
    return '';
  }

  const quoted = [...text.matchAll(/"([^"\n]{8,700})"|“([^”\n]{8,700})”/gu)]
    .map((match) => {
      const candidate = typeof match[1] === 'string' && match[1]
        ? match[1]
        : match[2];
      return typeof candidate === 'string' ? candidate.trim() : '';
    })
    .filter(Boolean);

  if (quoted.length === 0) {
    return '';
  }

  return quoted[quoted.length - 1];
}

function stripThinkingTags(text) {
  if (typeof text !== 'string') {
    return text;
  }

  let result = text.replace(/<think>[\s\S]*?<\/think>/giu, '');
  let guard = 0;

  while (/<think>/iu.test(result) && guard < 6) {
    const openIndex = result.search(/<think>/iu);
    const beforeThink = result.slice(0, openIndex).trim();
    const thinkBody = result.slice(openIndex).replace(/^<think>/iu, '');
    let recovered = '';

    const finalMarkers = [
      /(?:^|\n)\s*(?:final answer|answer|response)\s*[:\-]\s*/iu,
      /(?:^|\n)\s*(?:assistant|lumi)\s*[:\-]\s*/iu,
    ];

    for (const marker of finalMarkers) {
      const match = marker.exec(thinkBody);
      if (match && Number.isFinite(match.index)) {
        const candidate = thinkBody.slice(match.index + match[0].length).trim();
        if (candidate) {
          recovered = candidate;
          break;
        }
      }
    }

    if (!recovered) {
      const paragraphs = thinkBody
        .split(/\n\s*\n/u)
        .map((segment) => segment.trim())
        .filter(Boolean);

      for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
        const candidate = paragraphs[index];
        if (
          candidate.length <= 600
          && !/^\d+[.)]/u.test(candidate)
          && !/^(thinking process|analysis|step\s*\d+)/iu.test(candidate)
        ) {
          recovered = candidate;
          break;
        }
      }
    }

    result = [beforeThink, recovered].filter(Boolean).join('\n').trim();
    guard += 1;
  }

  return result
    .replace(/<\/think>/giu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
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

function stripReasoningArtifactPrefixes(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/^(?:final\s*polish|polish|final\s*draft|draft)\s*[:\-]\s*/iu, '')
    .replace(/^(?:thinking\s*process|analysis|internal\s*note|chain\s*of\s*thought|cot)\s*[:\-]\s*/iu, '')
    .trim();
}

function stripStageDirections(text) {
  if (typeof text !== 'string') {
    return text;
  }

  // Remove stage directions in *asterisks* or lowercase parentheses patterns
  return text
    .replace(/\*\w+(?:\s+\w+)*\*/gu, '')
    .replace(/\(\s*(?:pauses?|whispers?|laughs?|sighs?|nods?|smiles?|gasps?|snaps|blinks?|winks?|grins?|frowns?|shrugs?|waves?|points?|looks?|stares?|glances?)\s*\)/giu, '')
    .replace(/\.\.\.\s*(?:pauses?|whispers?|laughs?|sighs?|nods?|smiles?|gasps?|snaps|blinks?|winks?|grins?|frowns?|shrugs?|waves?|points?)\s*/giu, '')
    .replace(/(?:^|\n)\s*(?:pauses?|whispers?|laughs?|sighs?|nods?|smiles?|gasps?|snaps|blinks?|winks?|grins?|frowns?|shrugs?|waves?|points?|leans|sits|stands|walks|runs|jumps|falls|climbs)\s*(?:\.|:|-|$)/giu, '\n')
    .trim();
}

function stripPromptEchoAndTranscriptArtifacts(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  let sanitized = text;

  const hardCutMarkers = [
    /\bUser message:\b/iu,
    /\bReply as Lumi:\b/iu,
    /\bRecent chat context:\b/iu,
    /\bLong-term memory clues:\b/iu,
    /\bWeb search results for the user's query:\b/iu,
  ];

  for (const marker of hardCutMarkers) {
    const match = marker.exec(sanitized);
    if (match && Number.isFinite(match.index)) {
      sanitized = sanitized.slice(0, match.index).trim();
      break;
    }
  }

  const lines = sanitized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const filteredLines = lines.filter((line) => {
    if (/^(?:lumi|assistant)\s*[:\-]/iu.test(line)) {
      return true;
    }

    if (/^[a-z0-9_.-]{2,32}\s*[:\-]/iu.test(line)) {
      return false;
    }

    return true;
  });

  return filteredLines.join('\n').trim();
}

function applySpeakerDelineators(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/\s*lumi:\s*/giu, '\n')
    .trim();
}

function censorLeadingSelfName(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text.replace(/^\s*lumi(?=\b|[\s,.;:!?…-])/iu, 'l***');
}

function compactWhitespacePreserveNewlines(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/[ \t\f\v\r]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function collapseRepeatedPhraseLoops(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  let result = text;
  const repeatedPhrasePattern = /\b([\p{L}\p{N}'-]{2,}(?:\s+[\p{L}\p{N}'-]{1,}){0,2})(?:\s+\1){4,}\b/giu;

  for (let pass = 0; pass < 3; pass += 1) {
    const next = result.replace(repeatedPhrasePattern, '$1');
    if (next === result) {
      break;
    }
    result = next;
  }

  return compactWhitespacePreserveNewlines(result);
}

function isDegenerateRepetitiveOutput(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return true;
  }

  const normalized = normalizeForComparison(text);
  if (!normalized) {
    return true;
  }

  const tokens = normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length < 12) {
    return false;
  }

  const uniqueRatio = new Set(tokens).size / tokens.length;
  if (tokens.length >= 20 && uniqueRatio < 0.22) {
    return true;
  }

  for (let phraseLength = 1; phraseLength <= 3; phraseLength += 1) {
    for (let start = 0; start <= tokens.length - phraseLength; start += 1) {
      const phrase = tokens.slice(start, start + phraseLength).join(' ');
      let repeats = 1;
      let cursor = start + phraseLength;

      while (cursor <= tokens.length - phraseLength) {
        const candidate = tokens.slice(cursor, cursor + phraseLength).join(' ');
        if (candidate !== phrase) {
          break;
        }
        repeats += 1;
        cursor += phraseLength;
      }

      if (repeats >= 6) {
        return true;
      }
    }
  }

  return false;
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

function clampToSentenceLimit(text, maxSentences = MAX_FINAL_SENTENCES) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0 || sentences.length <= maxSentences) {
    return text.trim();
  }

  return `${sentences.slice(0, maxSentences).join(' ').trim()}...`;
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

function buildPrompt({
  persona,
  history,
  latestContent,
  memoryClues,
  ragContext,
  deepRecall,
  searchResults,
  userContextProfile,
}) {
  const renderedHistory = history
    .map((entry) => `${entry.role === 'assistant' ? 'Lumi' : entry.author}: ${entry.content}`)
    .join('\n');

  const sections = [
    `System: ${persona}`,
    'System: Keep responses concise, natural, and chat-friendly for Discord.',
    'System: Prefer brief responses (1-3 sentences) when the message allows. Reserve longer responses (4-10 sentences) for complex questions or when depth is genuinely needed.',
    'System: Never repeat words, short phrases, or sentence fragments in loops.',
    'System: Avoid roleplay-heavy formatting and avoid walls of text.',
    'System: Never simulate both sides of a conversation. Reply as Lumi only.',
    'System: Do not output transcript/log format or speaker labels like "username:".',
    'System: Never invent or fabricate links. Only include URLs provided in trusted context (e.g., search results or tool output).',
    'System: Do not reuse the same opener, signature line, or catchphrase from your recent assistant messages.',
    'System: Never use the exact phrase "you know who you are".',
  ];

  const renderedUserContextProfile = renderUserContextProfile(userContextProfile);
  if (renderedUserContextProfile) {
    sections.push(
      'System: The following is a soft profile distilled from the user\'s past conversations. Use it only when relevant, and do not present uncertain memory as certain fact.',
      renderedUserContextProfile,
    );
  }

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
  const quotedFallback = extractQuotedReplyFromReasoningLeak(text);
  const responseSource = quotedFallback || text;
  const stripped = stripPromptEchoAndTranscriptArtifacts(
    stripStageDirections(
      stripReasoningArtifactPrefixes(
        stripBannedReplyPhrases(stripThinkingTags(responseSource)),
      ),
    ),
  );
  const diversified = diversifyAgainstRecentAssistantHistory(stripped, history);
  const delineated = applySpeakerDelineators(diversified);
  const censoredLeadingName = censorLeadingSelfName(delineated);
  const compact = compactWhitespacePreserveNewlines(censoredLeadingName);
  const deLooped = collapseRepeatedPhraseLoops(compact);
  if (!deLooped || isDegenerateRepetitiveOutput(deLooped)) {
    return '';
  }

  const sentenceClamped = clampToSentenceLimit(deLooped);
  if (isDegenerateRepetitiveOutput(sentenceClamped)) {
    return '';
  }
  if (!sentenceClamped) {
    return '';
  }

  if (sentenceClamped.length <= maxChars) {
    return sentenceClamped;
  }

  return `${sentenceClamped.slice(0, Math.max(1, maxChars - 3)).trim()}...`;
}

function recoverFallbackResponse(text, maxChars) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  const withoutOpenThinkTag = text
    .replace(/<think>/giu, '')
    .replace(/<\/think>/giu, '');
  const paragraphs = withoutOpenThinkTag
    .split(/\n\s*\n/u)
    .map((segment) => segment.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return '';
  }

  const candidateSource = collapseRepeatedPhraseLoops(
    compactWhitespacePreserveNewlines(
      applySpeakerDelineators(
        stripPromptEchoAndTranscriptArtifacts(
          stripReasoningArtifactPrefixes(paragraphs[paragraphs.length - 1]),
        ),
      ),
    ),
  );
  const candidate = clampToSentenceLimit(candidateSource);
  if (!candidate || /^(thinking process|analysis|step\s*\d+|final\s*polish)/iu.test(candidate)) {
    return '';
  }

  if (isDegenerateRepetitiveOutput(candidate)) {
    return '';
  }

  if (candidate.length <= maxChars) {
    return candidate;
  }

  return `${candidate.slice(0, Math.max(1, maxChars - 3)).trim()}...`;
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
  userContextProfile,
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
          'System: Never simulate both sides of a conversation. Reply as Lumi only.',
          'System: Do not output transcript/log format or speaker labels like "username:".',
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
          userContextProfile,
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

      void relayThoughtSegments(extractThoughtSegments(completion), {
        kind: 'chat',
        model: config.chatbotModel,
        endpoint,
      });

      logger.debug(
        `LLM request succeeded in ${Date.now() - startedAt}ms via ${endpoint} (attempt ${attempt}/${maxAttempts}).`,
      );
      const maxChars = Number.isFinite(maxResponseChars)
        ? Number(maxResponseChars)
        : config.chatbotMaxResponseChars;
      const normalized = normalizeResponse(completion, maxChars, history);
      if (!normalized) {
        const fallback = recoverFallbackResponse(completion, maxChars);
        if (fallback) {
          logger.warn('Recovered response using fallback parser after normalization stripped model output.');
          return fallback;
        }

        throw new Error('Empty response after normalization.');
      }

      return normalized;
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
      const completion = stripThinkingTags(typeof payload.response === 'string' ? payload.response : '');
      void relayThoughtSegments(extractThoughtSegments(typeof payload.response === 'string' ? payload.response : ''), {
        kind: 'gif-decision',
        model: config.chatbotModel,
        endpoint,
      });
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
