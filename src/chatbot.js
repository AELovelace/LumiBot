const { config } = require('./config');
const { logger } = require('./logger');
const { evaluateIncomingMessage, evaluateOutgoingMessage } = require('./moderation');
const {
  closeChatbotStateStore,
  loadChatbotState,
  scheduleStateSave,
  flushStateSave,
} = require('./chatbotStateStore');
const { requestLlmCompletion } = require('./llmClient');

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
    channelState.set(channelId, {
      history: Array.isArray(value.history) ? value.history : [],
      lastReplyAt: Number.isFinite(value.lastReplyAt) ? value.lastReplyAt : 0,
    });
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

  if (message.content.startsWith(config.commandPrefix)) {
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
  pushHistoryEntry(state, {
    role: 'user',
    author: message.author.username,
    content: text,
  });

  const decision = shouldAttemptReply(message, state);
  if (!decision.shouldReply) {
    logger.debug(`Chatbot skipped message (${decision.reason}) in channel ${message.channelId}.`);
    return;
  }

  try {
    await message.channel.sendTyping();
    const response = await requestLlmCompletion({
      latestContent: text,
      history: state.history,
      maxResponseChars: runtimeSettings.maxResponseChars,
    });

    if (!response) {
      return;
    }

    const outboundModeration = evaluateOutgoingMessage(response);
    if (!outboundModeration.allowed) {
      logger.warn(`Chatbot response blocked by moderation (${outboundModeration.reason}).`);
      return;
    }

    await message.reply(outboundModeration.text);
    state.lastReplyAt = Date.now();
    persistState();
    pushHistoryEntry(state, {
      role: 'assistant',
      author: 'Lumi',
      content: outboundModeration.text,
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
  shutdownChatbotPersistence,
  updateRuntimeSettings,
};
