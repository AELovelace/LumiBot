const { config } = require('./config');
const { logger } = require('./logger');
const { evaluateIncomingMessage, evaluateOutgoingMessage } = require('./moderation');
const {
  appendUserMemoryEntry,
  closeChatbotStateStore,
  loadChatbotState,
  resetMemory,
  scheduleStateSave,
  searchUserMemory,
  flushStateSave,
} = require('./chatbotStateStore');
const { requestGifSuggestion, requestLlmCompletion } = require('./llmClient');
const { fetchGiphyGifUrl, hasGiphyConfig } = require('./giphyClient');
const { retrieveMemoryContext } = require('./ragClient');
const {
  checkSearchAllowed,
  executeBraveSearch,
  formatSearchResultsForPrompt,
  incrementSearchCount,
} = require('./braveSearch');
const { getCurrentNowPlayingTrack } = require('./nowPlaying');

const DISCORD_MAX_CHARS = 2000;

/**
 * Split a long string into Discord-safe chunks (≤2000 chars),
 * preferring to break at sentence or word boundaries.
 */
function splitMessage(text, maxLen = DISCORD_MAX_CHARS) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    let splitPoint = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
    );
    if (splitPoint < maxLen / 2) {
      splitPoint = window.lastIndexOf(' ');
    }
    if (splitPoint <= 0) {
      splitPoint = maxLen - 1;
    }
    chunks.push(remaining.slice(0, splitPoint + 1).trim());
    remaining = remaining.slice(splitPoint + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

const channelState = new Map();
let initialized = false;
const runtimeSettings = {
  enabled: config.chatbotEnabled,
  channelIds: [...config.chatbotChannelIds],
  replyChance: config.chatbotReplyChance,
  interestThreshold: config.chatbotInterestThreshold,
  contextMessages: config.chatbotContextMessages,
  cooldownMs: config.chatbotCooldownMs,
  conversationWindowMs: config.chatbotConversationWindowMs,
  followupCooldownMs: config.chatbotFollowupCooldownMs,
  momentumWindowMs: config.chatbotMomentumWindowMs,
  momentumChanceBoost: config.chatbotMomentumChanceBoost,
  momentumMaxReplyChance: config.chatbotMomentumMaxReplyChance,
  maxResponseChars: config.chatbotMaxResponseChars,
};

const RECALL_INTENT_PATTERN = /\b(remember|recall|remind|memory|forgot|forget|earlier|previous|before|last time|have we talked|what did i say|did i ever)\b/iu;

const SEARCH_INTENT_PATTERN = /\blumi[,:]?\s+(?:search|look\s*up|google|find(?:\s+me)?|search\s+(?:the\s+)?(?:web|internet|online)\s+(?:for)?|what\s+does\s+the\s+(?:internet|web)\s+say\s+about)\s+(.+)/iu;

const SONG_RECOMMENDATION_INTENT_PATTERN = /(?:\b(?:song|track|music)\b.*\b(?:recommend(?:ation)?s?|recs?)\b)|(?:\b(?:recommend(?:ation)?s?|recs?)\b.*\b(?:song|track|music|listen(?:ing)?)\b)|(?:\bwhat\s+should\s+i\s+listen\s+to\b)|(?:\bany\s+(?:song|music)\s+recs?\b)/iu;

function shouldUseDeepRecall(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  return RECALL_INTENT_PATTERN.test(text.toLowerCase());
}

/**
 * Detect whether the user is explicitly asking Lumi to search the web.
 * Returns { isSearch: boolean, query: string | null }.
 */
function detectSearchIntent(text) {
  if (!text || typeof text !== 'string') {
    return { isSearch: false, query: null };
  }

  const match = SEARCH_INTENT_PATTERN.exec(text);
  if (match && match[1]) {
    return { isSearch: true, query: match[1].trim() };
  }

  return { isSearch: false, query: null };
}

function detectSongRecommendationIntent(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  return SONG_RECOMMENDATION_INTENT_PATTERN.test(text.toLowerCase());
}

function buildNowPlayingRecommendationReply(nowPlayingSnapshot) {
  if (!nowPlayingSnapshot?.song) {
    return null;
  }

  if (nowPlayingSnapshot.track?.url) {
    return `for a song rec, i'd start with what's playing right now: **${nowPlayingSnapshot.track.title}** — ${nowPlayingSnapshot.track.artist}\n${nowPlayingSnapshot.track.url}`;
  }

  return `for a song rec, i'd start with what's playing right now: **${nowPlayingSnapshot.song}**`;
}

function persistUserMemoryEntry(entry) {
  void appendUserMemoryEntry(entry).catch((error) => {
    logger.warn('Failed to persist per-user memory entry.', error.message);
  });
}

async function fetchMemoryContextWithRAG({ userId, query, deepRecall }) {
  if (!userId) {
    return '';
  }

  const limit = deepRecall ? config.chatbotMemoryRecallLimit : config.chatbotMemorySearchLimit;

  try {
    // Use RAG to retrieve formatted context from memories
    const ragContext = await retrieveMemoryContext(userId, query, limit);
    return ragContext;
  } catch (error) {
    logger.warn('Failed to retrieve memory context with RAG.', error.message);
    return '';
  }
}

async function fetchMemoryCluesForPrompt({ userId, query, deepRecall }) {
  if (!userId) {
    return [];
  }

  const limit = deepRecall ? config.chatbotMemoryRecallLimit : config.chatbotMemorySearchLimit;

  try {
    const payload = await searchUserMemory({
      userId,
      query,
      deep: deepRecall,
      limit,
    });
    return Array.isArray(payload?.matches) ? payload.matches : [];
  } catch (error) {
    logger.warn('Failed to query per-user memory clues.', error.message);
    return [];
  }
}

async function maybeAppendGifToReply({ latestContent, assistantReply, history }) {
  if (!config.chatbotGifEnabled || !hasGiphyConfig()) {
    return assistantReply;
  }

  if (Math.random() > config.chatbotGifChance) {
    return assistantReply;
  }

  const gifQuery = await requestGifSuggestion({
    latestContent,
    assistantResponse: assistantReply,
    history,
  });
  if (!gifQuery) {
    return assistantReply;
  }

  const gifUrl = await fetchGiphyGifUrl(gifQuery);
  if (!gifUrl) {
    return assistantReply;
  }

  const candidateReply = `${assistantReply}\n${gifUrl}`;
  const candidateModeration = evaluateOutgoingMessage(candidateReply);
  if (!candidateModeration.allowed) {
    logger.debug(`Skipped GIF attachment because moderation blocked it (${candidateModeration.reason}).`);
    return assistantReply;
  }

  return candidateModeration.text;
}

function sanitizeReplyChance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return runtimeSettings.replyChance;
  }

  return Math.max(0, Math.min(1, numeric));
}

function sanitizePositive(value, fallback) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return numeric;
}

function snapshotState() {
  const channels = {};
  channelState.forEach((value, key) => {
    channels[key] = {
      history: value.history,
      lastReplyAt: value.lastReplyAt,
    };
  });

  return {
    channels,
    settings: {
      enabled: runtimeSettings.enabled,
      channelIds: runtimeSettings.channelIds,
      replyChance: runtimeSettings.replyChance,
      interestThreshold: runtimeSettings.interestThreshold,
      contextMessages: runtimeSettings.contextMessages,
      cooldownMs: runtimeSettings.cooldownMs,
      conversationWindowMs: runtimeSettings.conversationWindowMs,
      followupCooldownMs: runtimeSettings.followupCooldownMs,
      momentumWindowMs: runtimeSettings.momentumWindowMs,
      momentumChanceBoost: runtimeSettings.momentumChanceBoost,
      momentumMaxReplyChance: runtimeSettings.momentumMaxReplyChance,
      maxResponseChars: runtimeSettings.maxResponseChars,
    },
  };
}

async function initializeChatbot() {
  if (initialized) {
    return;
  }

  const loaded = await loadChatbotState();
  Object.entries(loaded.channels).forEach(([channelId, value]) => {
    channelState.set(channelId, value);
  });

  if (loaded.settings && typeof loaded.settings === 'object') {
    runtimeSettings.enabled = typeof loaded.settings.enabled === 'boolean'
      ? loaded.settings.enabled
      : runtimeSettings.enabled;
    runtimeSettings.channelIds = Array.isArray(loaded.settings.channelIds)
      ? loaded.settings.channelIds.filter(Boolean)
      : runtimeSettings.channelIds;
    runtimeSettings.replyChance = sanitizeReplyChance(loaded.settings.replyChance);
    runtimeSettings.interestThreshold = sanitizePositive(
      loaded.settings.interestThreshold,
      runtimeSettings.interestThreshold,
    );
    runtimeSettings.contextMessages = sanitizePositive(loaded.settings.contextMessages, runtimeSettings.contextMessages);
    runtimeSettings.cooldownMs = sanitizePositive(loaded.settings.cooldownMs, runtimeSettings.cooldownMs);
    runtimeSettings.conversationWindowMs = sanitizePositive(
      loaded.settings.conversationWindowMs,
      runtimeSettings.conversationWindowMs,
    );
    runtimeSettings.followupCooldownMs = sanitizePositive(
      loaded.settings.followupCooldownMs,
      runtimeSettings.followupCooldownMs,
    );
    runtimeSettings.momentumWindowMs = sanitizePositive(
      loaded.settings.momentumWindowMs,
      runtimeSettings.momentumWindowMs,
    );
    runtimeSettings.momentumChanceBoost = sanitizeReplyChance(
      loaded.settings.momentumChanceBoost,
    );
    runtimeSettings.momentumMaxReplyChance = sanitizeReplyChance(
      loaded.settings.momentumMaxReplyChance,
    );
    runtimeSettings.maxResponseChars = sanitizePositive(
      loaded.settings.maxResponseChars,
      runtimeSettings.maxResponseChars,
    );
  }

  initialized = true;
  logger.info(
    `Loaded chatbot memory: channels=${channelState.size}, enabled=${runtimeSettings.enabled}, replyChance=${runtimeSettings.replyChance}`,
  );
}

function persistState() {
  scheduleStateSave(snapshotState);
}

async function flushChatbotState() {
  await flushStateSave(snapshotState);
}

async function shutdownChatbotPersistence() {
  await closeChatbotStateStore();
}

async function resetChatbotMemory() {
  const result = await resetMemory();
  channelState.clear();
  logger.info(`Chatbot memory reset. Backup saved to ${result.backupFile}.`);
  return result;
}

function getRuntimeSettings() {
  return {
    enabled: runtimeSettings.enabled,
    channelIds: [...runtimeSettings.channelIds],
    replyChance: runtimeSettings.replyChance,
    interestThreshold: runtimeSettings.interestThreshold,
    contextMessages: runtimeSettings.contextMessages,
    cooldownMs: runtimeSettings.cooldownMs,
    conversationWindowMs: runtimeSettings.conversationWindowMs,
    followupCooldownMs: runtimeSettings.followupCooldownMs,
    momentumWindowMs: runtimeSettings.momentumWindowMs,
    momentumChanceBoost: runtimeSettings.momentumChanceBoost,
    momentumMaxReplyChance: runtimeSettings.momentumMaxReplyChance,
    maxResponseChars: runtimeSettings.maxResponseChars,
  };
}

function updateRuntimeSettings(patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    runtimeSettings.enabled = Boolean(patch.enabled);
  }

  if (Array.isArray(patch.channelIds)) {
    runtimeSettings.channelIds = patch.channelIds.map((id) => String(id).trim()).filter(Boolean);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'replyChance')) {
    runtimeSettings.replyChance = sanitizeReplyChance(patch.replyChance);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'interestThreshold')) {
    runtimeSettings.interestThreshold = sanitizePositive(
      patch.interestThreshold,
      runtimeSettings.interestThreshold,
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'contextMessages')) {
    runtimeSettings.contextMessages = sanitizePositive(patch.contextMessages, runtimeSettings.contextMessages);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'cooldownMs')) {
    runtimeSettings.cooldownMs = sanitizePositive(patch.cooldownMs, runtimeSettings.cooldownMs);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'conversationWindowMs')) {
    runtimeSettings.conversationWindowMs = sanitizePositive(
      patch.conversationWindowMs,
      runtimeSettings.conversationWindowMs,
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'followupCooldownMs')) {
    runtimeSettings.followupCooldownMs = sanitizePositive(
      patch.followupCooldownMs,
      runtimeSettings.followupCooldownMs,
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'momentumWindowMs')) {
    runtimeSettings.momentumWindowMs = sanitizePositive(
      patch.momentumWindowMs,
      runtimeSettings.momentumWindowMs,
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'momentumChanceBoost')) {
    runtimeSettings.momentumChanceBoost = sanitizeReplyChance(patch.momentumChanceBoost);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'momentumMaxReplyChance')) {
    runtimeSettings.momentumMaxReplyChance = sanitizeReplyChance(patch.momentumMaxReplyChance);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'maxResponseChars')) {
    runtimeSettings.maxResponseChars = sanitizePositive(patch.maxResponseChars, runtimeSettings.maxResponseChars);
  }

  persistState();
  return getRuntimeSettings();
}

function getChannelState(channelId) {
  const existing = channelState.get(channelId);
  if (existing) {
    return existing;
  }

  const created = {
    history: [],
    lastReplyAt: 0,
  };
  channelState.set(channelId, created);
  return created;
}

function pushHistoryEntry(state, entry) {
  state.history.push({
    ...entry,
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
  });
  const maxHistory = Math.max(1, runtimeSettings.contextMessages);
  if (state.history.length > maxHistory) {
    state.history.splice(0, state.history.length - maxHistory);
  }

  persistState();
}

function isDirectlyAddressed(message) {
  const botUserId = message.client.user?.id;
  if (!botUserId) {
    return false;
  }

  if (message.mentions?.users?.has(botUserId)) {
    return true;
  }

  return message.mentions?.repliedUser?.id === botUserId;
}

function computeInterestScore(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  let score = 0;
  if (normalized.includes('?')) {
    score += 2;
  }
  if (/\b(how|why|what|when|where|who)\b/iu.test(normalized)) {
    score += 2;
  }
  if (/\b(lumi|thoughts|opinion|help|explain|idea|advice|anyone|somebody|someone)\b/iu.test(normalized)) {
    score += 2;
  }
  if (/\b(can you|could you|would you|do you|should i|is it|are we|am i|wtf|omg|lol|lmao|real|mood|same|crazy|wild)\b/iu.test(normalized)) {
    score += 1;
  }
  if (/\b(i think|i feel|i want|i need|i'm|im|ive|i've)\b/iu.test(normalized)) {
    score += 1;
  }
  if (/[!]{1,}/u.test(normalized)) {
    score += 1;
  }
  if (normalized.length >= 12) {
    score += 1;
  }

  return score;
}

function shouldHandleInChannel(message) {
  if (!runtimeSettings.enabled) {
    return false;
  }

  if (runtimeSettings.channelIds.length === 0) {
    return false;
  }

  return runtimeSettings.channelIds.includes(message.channelId);
}

function computeConversationScore(state, author, now) {
  const recent = state.history
    .filter((entry) => Number.isFinite(entry.timestamp) && now - entry.timestamp <= runtimeSettings.conversationWindowMs)
    .slice(-6);

  if (recent.length === 0) {
    return {
      score: 0,
      hasRecentAssistant: false,
      lastEntryWasAssistant: false,
    };
  }

  let score = 0;
  const userEntries = recent.filter((entry) => entry.role === 'user');
  const hasRecentAssistant = recent.some((entry) => entry.role === 'assistant');
  const lastEntryWasAssistant = recent.length > 1 && recent[recent.length - 2]?.role === 'assistant';

  if (hasRecentAssistant) {
    score += 1;
  }

  if (lastEntryWasAssistant) {
    score += 2;
  }

  if (userEntries.length >= 2) {
    score += 1;
  }

  if (userEntries.some((entry) => entry.author === author && entry !== userEntries[userEntries.length - 1])) {
    score += 1;
  }

  if (new Set(userEntries.map((entry) => entry.author)).size >= 2) {
    score += 1;
  }

  return {
    score,
    hasRecentAssistant,
    lastEntryWasAssistant,
  };
}

function computeMomentum(state, author, now) {
  const recent = state.history
    .filter((entry) => Number.isFinite(entry.timestamp) && now - entry.timestamp <= runtimeSettings.momentumWindowMs)
    .slice(-8);

  if (recent.length === 0) {
    return {
      active: false,
      boost: 0,
      thresholdRelief: 0,
    };
  }

  const recentAssistantReplies = recent.filter((entry) => entry.role === 'assistant').length;
  const lastTwo = recent.slice(-2);
  const followsAssistant = lastTwo.length === 2
    && lastTwo[0].role === 'assistant'
    && lastTwo[1].role === 'user'
    && lastTwo[1].author === author;
  const sameUserFollowups = recent.filter((entry) => entry.role === 'user' && entry.author === author).length;

  let boost = 0;
  let thresholdRelief = 0;

  if (recentAssistantReplies > 0) {
    boost += Math.min(runtimeSettings.momentumChanceBoost, recentAssistantReplies * 0.15);
    thresholdRelief += 1;
  }

  if (followsAssistant) {
    boost += 0.15;
    thresholdRelief += 1;
  }

  if (sameUserFollowups >= 2) {
    boost += 0.1;
  }

  boost = Math.min(boost, runtimeSettings.momentumMaxReplyChance);

  return {
    active: boost > 0 || thresholdRelief > 0,
    boost,
    thresholdRelief,
  };
}

function shouldAttemptReply(message, state) {
  const direct = isDirectlyAddressed(message);
  const interestScore = computeInterestScore(message.content);
  const now = Date.now();
  const conversation = computeConversationScore(state, message.author.username, now);
  const momentum = computeMomentum(state, message.author.username, now);
  const effectiveInterestScore = interestScore + conversation.score;
  const effectiveInterestThreshold = Math.max(1, runtimeSettings.interestThreshold - momentum.thresholdRelief);
  const interest = effectiveInterestScore >= effectiveInterestThreshold;
  const effectiveReplyChance = Math.min(
    runtimeSettings.momentumMaxReplyChance,
    runtimeSettings.replyChance + momentum.boost,
  );
  const probabilistic = Math.random() < effectiveReplyChance;
  const effectiveCooldownMs = conversation.hasRecentAssistant
    ? Math.min(runtimeSettings.cooldownMs, runtimeSettings.followupCooldownMs)
    : runtimeSettings.cooldownMs;
  const inCooldown = now - state.lastReplyAt < effectiveCooldownMs;

  if (inCooldown) {
    return {
      shouldReply: false,
      reason: `cooldown:${effectiveCooldownMs}`,
    };
  }

  if (direct || interest || probabilistic) {
    return {
      shouldReply: true,
      reason: direct
        ? 'direct'
        : interest
          ? `interest:${interestScore}+ctx:${conversation.score}+momentum:${momentum.thresholdRelief}`
          : `random:${effectiveReplyChance.toFixed(2)}`,
    };
  }

  return {
    shouldReply: false,
    reason: 'no-trigger',
  };
}

async function handleAutonomousMessage(message) {
  if (!initialized) {
    await initializeChatbot();
  }

  if (!shouldHandleInChannel(message)) {
    return;
  }

  const text = message.content?.trim();
  if (!text) {
    return;
  }

  const inboundModeration = evaluateIncomingMessage(text);
  if (!inboundModeration.allowed) {
    logger.debug(`Chatbot skipped message due to moderation (${inboundModeration.reason}).`);
    return;
  }

  const state = getChannelState(message.channelId);
  const incomingTimestamp = Number.isFinite(message.createdTimestamp)
    ? Number(message.createdTimestamp)
    : Date.now();

  pushHistoryEntry(state, {
    role: 'user',
    author: message.author.username,
    content: text,
    timestamp: incomingTimestamp,
  });

  persistUserMemoryEntry({
    userId: message.author.id,
    channelId: message.channelId,
    role: 'user',
    authorId: message.author.id,
    author: message.author.username,
    content: text,
    timestamp: incomingTimestamp,
  });

  const decision = shouldAttemptReply(message, state);
  if (!decision.shouldReply) {
    logger.debug(`Chatbot skipped message (${decision.reason}) in channel ${message.channelId}.`);
    return;
  }

  try {
    await message.channel.sendTyping();

    const recommendationIntent = detectSongRecommendationIntent(text);
    if (recommendationIntent) {
      try {
        const nowPlayingSnapshot = await getCurrentNowPlayingTrack();
        const recommendationReply = buildNowPlayingRecommendationReply(nowPlayingSnapshot);

        if (recommendationReply) {
          const recommendationModeration = evaluateOutgoingMessage(recommendationReply);
          if (recommendationModeration.allowed) {
            const recommendationChunks = splitMessage(recommendationModeration.text);
            await message.reply(recommendationChunks[0]);
            for (let i = 1; i < recommendationChunks.length; i += 1) {
              // eslint-disable-next-line no-await-in-loop
              await message.channel.send(recommendationChunks[i]);
            }

            const recommendationTimestamp = Date.now();
            state.lastReplyAt = recommendationTimestamp;
            persistState();
            pushHistoryEntry(state, {
              role: 'assistant',
              author: 'Lumi',
              content: recommendationModeration.text,
              timestamp: recommendationTimestamp,
            });

            persistUserMemoryEntry({
              userId: message.author.id,
              channelId: message.channelId,
              role: 'assistant',
              authorId: message.client.user?.id || 'lumi',
              author: 'Lumi',
              content: recommendationModeration.text,
              timestamp: recommendationTimestamp,
            });

            logger.info(`Chatbot replied with now-playing recommendation in channel ${message.channelId} (${decision.reason}).`);
            return;
          }

          logger.warn(`Now-playing recommendation blocked by moderation (${recommendationModeration.reason}).`);
        }
      } catch (error) {
        logger.warn('Failed to build now-playing recommendation reply.', error.message);
      }
    }

    // --- Brave Search integration ---
    const searchIntent = detectSearchIntent(text);
    let searchResults = null;

    if (searchIntent.isSearch) {
      const searchCheck = checkSearchAllowed(message.author.id);
      if (!searchCheck.allowed) {
        // Generate an in-character rate-limit response via the LLM
        try {
          const rateLimitResponse = await requestLlmCompletion({
            latestContent: text,
            history: state.history.slice(-Math.max(1, runtimeSettings.contextMessages)),
            memoryClues: [],
            deepRecall: false,
            maxResponseChars: runtimeSettings.maxResponseChars,
            searchResults: null,
            systemOverride: searchCheck.reason === 'cooldown'
              ? `System: The user asked you to search the web but they need to wait before searching again. Let them know gently and in-character. Be sweet but firm.`
              : `System: The user asked you to search the web, but they've used up their searches for today. Remind them gently and in-character that doll pays for each web search out of pocket, so you can only do a limited number per day. Be sweet but firm about it.`,
          });

          if (rateLimitResponse) {
            const moderated = evaluateOutgoingMessage(rateLimitResponse);
            if (moderated.allowed) {
              const rateLimitChunks = splitMessage(moderated.text);
              await message.reply(rateLimitChunks[0]);
              for (let i = 1; i < rateLimitChunks.length; i += 1) {
                // eslint-disable-next-line no-await-in-loop
                await message.channel.send(rateLimitChunks[i]);
              }
              state.lastReplyAt = Date.now();
              persistState();
              pushHistoryEntry(state, { role: 'assistant', author: 'Lumi', content: moderated.text, timestamp: Date.now() });
            }
          }
        } catch (error) {
          logger.warn('Failed to generate search rate-limit response.', error.message);
        }

        return;
      }

      // Execute the web search
      try {
        const results = await executeBraveSearch(searchIntent.query);
        if (results.length > 0) {
          searchResults = formatSearchResultsForPrompt(results);
          incrementSearchCount(message.author.id);
          logger.info(`Brave Search executed for user ${message.author.id}: "${searchIntent.query}"`);
        }
      } catch (error) {
        logger.warn('Brave Search request failed.', error.message);
      }
    }

    const deepRecall = shouldUseDeepRecall(text);
    const memoryClues = await fetchMemoryCluesForPrompt({
      userId: message.author.id,
      query: text,
      deepRecall,
    });

    // Retrieve RAG context for memory-augmented generation
    const ragContext = await fetchMemoryContextWithRAG({
      userId: message.author.id,
      query: text,
      deepRecall,
    });

    const response = await requestLlmCompletion({
      latestContent: text,
      history: state.history.slice(-Math.max(1, runtimeSettings.contextMessages)),
      memoryClues,
      ragContext,
      deepRecall,
      maxResponseChars: runtimeSettings.maxResponseChars,
      searchResults,
    });

    if (!response) {
      return;
    }

    const outboundModeration = evaluateOutgoingMessage(response);
    if (!outboundModeration.allowed) {
      logger.warn(`Chatbot response blocked by moderation (${outboundModeration.reason}).`);
      return;
    }

    const finalReply = await maybeAppendGifToReply({
      latestContent: text,
      assistantReply: outboundModeration.text,
      history: state.history,
    });

    const chunks = splitMessage(finalReply);
    await message.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await message.channel.send(chunks[i]);
    }
    const replyTimestamp = Date.now();
    state.lastReplyAt = replyTimestamp;
    persistState();
    pushHistoryEntry(state, {
      role: 'assistant',
      author: 'Lumi',
      content: finalReply,
      timestamp: replyTimestamp,
    });

    persistUserMemoryEntry({
      userId: message.author.id,
      channelId: message.channelId,
      role: 'assistant',
      authorId: message.client.user?.id || 'lumi',
      author: 'Lumi',
      content: finalReply,
      timestamp: replyTimestamp,
    });

    logger.info(`Chatbot replied in channel ${message.channelId} (${decision.reason}).`);
  } catch (error) {
    logger.warn(`Chatbot response failed in channel ${message.channelId}.`, error.message);
  }
}

module.exports = {
  flushChatbotState,
  getRuntimeSettings,
  handleAutonomousMessage,
  initializeChatbot,
  resetChatbotMemory,
  shutdownChatbotPersistence,
  updateRuntimeSettings,
};
