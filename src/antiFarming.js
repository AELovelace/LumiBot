/**
 * Anti-Farming Guardrails for SadGirlCoin message rewards.
 *
 * Evaluates incoming messages for low-effort / repetitive / burst patterns
 * and decides whether a coin reward should be granted. This module is
 * scoped to economy rewards only — it does NOT block messages, mute users,
 * or affect the chatbot. If a message is ineligible, coins are simply not
 * minted for it.
 *
 * Conservative defaults are tuned to avoid false positives on normal chat.
 */

const { logger } = require('./logger');

// ---------------------------------------------------------------------------
// Tunables (safe defaults; can be overridden via setThresholds())
// ---------------------------------------------------------------------------

const DEFAULTS = {
  recentWindow: 8,              // # of recent messages tracked per user/channel
  duplicateSimilarity: 0.88,    // Jaccard similarity (trigrams) cutoff
  shortMessageBypassLetters: 24, // Skip farming detection below this text size
  minMeaningfulLetters: 12,     // Legacy threshold for non-bypass paths
  maxPunctuationRatio: 0.55,    // Reject if non-alnum/non-space exceeds this
  maxRepeatedCharRatio: 0.65,   // Reject if a single char dominates the message
  minRepeatedCharRun: 11,       // Ignore repeated-char runs below this (expression)
  minUniqueTokenRatio: 0.35,    // Below this, message is too repetitive
  rewardCooldownMs: 25_000,     // Min spacing between reward-eligible msgs / user
  burstWindowMs: 120_000,       // Window for counting failed-quality attempts
  burstStrikeLimit: 6,          // Failed attempts in window that trigger lockout
  burstLockoutMs: 8 * 60_000,   // Reward-only lockout after burst trigger
  notifyCooldownMs: 5 * 60_000, // Min spacing between debug warnings to a user
};

let thresholds = { ...DEFAULTS };

function setThresholds(overrides = {}) {
  thresholds = { ...thresholds, ...overrides };
}

function getThresholds() {
  return { ...thresholds };
}

// ---------------------------------------------------------------------------
// Per-user state (in-memory; short-horizon, bounded)
// ---------------------------------------------------------------------------

/**
 * userId -> {
 *   recent: Array<{ channelId, normalized, trigrams: Set<string>, ts }>,
 *   lastRewardAt: number,
 *   strikes: Array<number>,         // timestamps of recent failed attempts
 *   lockoutUntil: number,
 *   lastNotifyAt: number,
 * }
 */
const userState = new Map();

function getUserState(userId) {
  let s = userState.get(userId);
  if (!s) {
    s = {
      recent: [],
      lastRewardAt: 0,
      strikes: [],
      lockoutUntil: 0,
      lastNotifyAt: 0,
    };
    userState.set(userId, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Lorem-ipsum / placeholder pattern detection
// ---------------------------------------------------------------------------

const LOREM_TOKENS = new Set([
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
  'elit', 'sed', 'eiusmod', 'tempor', 'incididunt', 'labore', 'magna',
  'aliqua', 'enim', 'minim', 'veniam', 'nostrud', 'exercitation',
]);

function loremScore(tokens) {
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) if (LOREM_TOKENS.has(t)) hits += 1;
  return hits / tokens.length;
}

// ---------------------------------------------------------------------------
// Text normalization & similarity (lightweight char trigrams + Jaccard)
// ---------------------------------------------------------------------------

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')      // strip custom emoji
    .replace(/<@!?\d+>|<#\d+>|<@&\d+>/g, ' ') // strip mentions
    .replace(/https?:\/\/\S+/g, ' ')    // strip urls
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(s) {
  const set = new Set();
  if (s.length < 3) {
    if (s.length > 0) set.add(s);
    return set;
  }
  for (let i = 0; i <= s.length - 3; i += 1) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Low-effort signal computation
// ---------------------------------------------------------------------------

function analyzeLowEffort(normalized) {
  const reasons = [];

  if (normalized.length === 0) {
    return { lowEffort: false, reasons }; // empty text — handled elsewhere (attachments)
  }

  const nonAlnumNonSpace = normalized.replace(/[a-z0-9\s]/g, '').length;
  const punctRatio = nonAlnumNonSpace / normalized.length;
  if (punctRatio > thresholds.maxPunctuationRatio) {
    reasons.push('PUNCTUATION_SPAM');
  }

  // Repeated single character (e.g. "..........." or "aaaaaaa")
  const charCounts = new Map();
  let currentRun = 0;
  let longestRun = 0;
  let prevChar = '';
  for (const ch of normalized.replace(/\s/g, '')) {
    charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
    if (ch === prevChar) {
      currentRun += 1;
    } else {
      currentRun = 1;
      prevChar = ch;
    }
    if (currentRun > longestRun) longestRun = currentRun;
  }
  const totalChars = normalized.replace(/\s/g, '').length;
  let topRatio = 0;
  for (const c of charCounts.values()) {
    const r = c / totalChars;
    if (r > topRatio) topRatio = r;
  }
  if (
    totalChars >= thresholds.minRepeatedCharRun
    && longestRun >= thresholds.minRepeatedCharRun
    && topRatio > thresholds.maxRepeatedCharRatio
  ) {
    reasons.push('REPEATED_CHAR');
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const uniqueRatio = tokens.length > 0
    ? new Set(tokens).size / tokens.length
    : 1;
  if (tokens.length >= 4 && uniqueRatio < thresholds.minUniqueTokenRatio) {
    reasons.push('REPEATED_TOKENS');
  }

  if (loremScore(tokens) >= 0.4 && tokens.length >= 3) {
    reasons.push('PLACEHOLDER_TEXT');
  }

  return { lowEffort: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a message for reward eligibility.
 *
 * @param {object} ctx
 * @param {string} ctx.userId
 * @param {string} ctx.channelId
 * @param {string} ctx.content
 * @param {boolean} [ctx.hasAttachment]
 * @param {number} [ctx.now]
 * @returns {{
 *   eligible: boolean,
 *   reasons: string[],
 *   action: 'allow'|'suppress'|'lockout',
 *   cooldownRemainingMs: number,
 *   shouldNotify: boolean,
 *   debug: object
 * }}
 */
function evaluateRewardEligibility(ctx) {
  const now = ctx.now ?? Date.now();
  const state = getUserState(ctx.userId);
  const reasons = [];

  // 1. Active lockout from prior burst
  if (state.lockoutUntil > now) {
    const remaining = state.lockoutUntil - now;
    const shouldNotify = now - state.lastNotifyAt > thresholds.notifyCooldownMs;
    if (shouldNotify) state.lastNotifyAt = now;
    return {
      eligible: false,
      reasons: ['BURST_LOCKOUT'],
      action: 'lockout',
      cooldownRemainingMs: remaining,
      shouldNotify,
      debug: { lockoutUntil: state.lockoutUntil },
    };
  }

  const normalized = normalize(ctx.content);
  const letters = normalized.replace(/[^a-z0-9]/g, '');

  // Short text bypass: avoid chiming in on normal quick conversational posts.
  // These usually don't farm meaningful coins and are commonly expressive.
  if (letters.length > 0 && letters.length < thresholds.shortMessageBypassLetters) {
    recordMessage(state, ctx.channelId, normalized, now);
    return {
      eligible: true,
      reasons: [],
      action: 'allow',
      cooldownRemainingMs: 0,
      shouldNotify: false,
      debug: { bypass: 'SHORT_MESSAGE' },
    };
  }

  // 2. Low-effort text checks (only if there's text — attachment-only msgs
  //    are handled by callers requiring text quality before bonuses count)
  const effort = analyzeLowEffort(normalized);
  if (effort.lowEffort) reasons.push(...effort.reasons);

  // 3. Near-duplicate vs recent messages (same channel preferred)
  let topSim = 0;
  if (normalized.length >= 3) {
    const grams = trigrams(normalized);
    for (const r of state.recent) {
      if (r.channelId !== ctx.channelId) continue;
      const sim = jaccard(grams, r.trigrams);
      if (sim > topSim) topSim = sim;
    }
    if (topSim >= thresholds.duplicateSimilarity) {
      reasons.push('DUPLICATE');
    }
  }

  // 4. Per-user reward cooldown
  const sinceLast = now - state.lastRewardAt;
  const hasRepeatedChar = reasons.includes('REPEATED_CHAR');
  const hasAdditionalSpamSignal = reasons.some((reason) => [
    'PUNCTUATION_SPAM',
    'REPEATED_TOKENS',
    'PLACEHOLDER_TEXT',
    'DUPLICATE',
  ].includes(reason));
  const shouldApplyRapidCooldown = hasRepeatedChar && hasAdditionalSpamSignal;
  if (state.lastRewardAt > 0 && sinceLast < thresholds.rewardCooldownMs && shouldApplyRapidCooldown) {
    reasons.push('REWARD_COOLDOWN');
  }

  // If text is missing entirely AND no attachment, nothing to reward
  if (normalized.length === 0 && !ctx.hasAttachment) {
    reasons.push('EMPTY');
  }

  if (reasons.length === 0) {
    // Eligible — record this message and update last-reward timestamp
    recordMessage(state, ctx.channelId, normalized, now);
    state.lastRewardAt = now;
    return {
      eligible: true,
      reasons: [],
      action: 'allow',
      cooldownRemainingMs: 0,
      shouldNotify: false,
      debug: { topSimilarity: topSim },
    };
  }

  // Ineligible — record strike and check for burst lockout
  state.strikes.push(now);
  state.strikes = state.strikes.filter((t) => now - t <= thresholds.burstWindowMs);

  let action = 'suppress';
  if (state.strikes.length >= thresholds.burstStrikeLimit) {
    state.lockoutUntil = now + thresholds.burstLockoutMs;
    state.strikes = [];
    action = 'lockout';
    reasons.push('BURST_TRIGGERED');
  }

  // Still record the (normalized) message so duplicate detection sees it
  if (normalized.length > 0) {
    recordMessage(state, ctx.channelId, normalized, now);
  }

  const cooldownRemainingMs = action === 'lockout'
    ? thresholds.burstLockoutMs
    : (reasons.includes('REWARD_COOLDOWN')
      ? Math.max(0, thresholds.rewardCooldownMs - sinceLast)
      : 0);

  // Throttle notifications so we don't spam the user with warnings either
  const shouldNotify = (action === 'lockout' || reasons.includes('DUPLICATE')
      || reasons.includes('PLACEHOLDER_TEXT') || reasons.includes('REPEATED_CHAR')
      || reasons.includes('PUNCTUATION_SPAM') || reasons.includes('REPEATED_TOKENS'))
    && (now - state.lastNotifyAt > thresholds.notifyCooldownMs);
  if (shouldNotify) state.lastNotifyAt = now;

  logger.debug?.(`[anti-farming] suppress reward user=${ctx.userId} reasons=${reasons.join(',')} sim=${topSim.toFixed(2)} strikes=${state.strikes.length}`);

  return {
    eligible: false,
    reasons,
    action,
    cooldownRemainingMs,
    shouldNotify,
    debug: { topSimilarity: topSim, strikes: state.strikes.length },
  };
}

function recordMessage(state, channelId, normalized, now) {
  if (normalized.length === 0) return;
  state.recent.push({
    channelId,
    normalized,
    trigrams: trigrams(normalized),
    ts: now,
  });
  if (state.recent.length > thresholds.recentWindow) {
    state.recent.splice(0, state.recent.length - thresholds.recentWindow);
  }
}

/**
 * Build the ethereal debug warning message for a suppressed/locked reward.
 */
function buildDebugWarning(result) {
  const seconds = Math.max(1, Math.ceil(result.cooldownRemainingMs / 1000));
  const reasonList = result.reasons.length > 0 ? result.reasons.join(', ') : 'unknown';
  return [
    '*Moonlight folds around your words, and the channel grows thin.*',
    '`You are being rate limited for spam-like activity.`',
    '*Breathe, wait a moment, then speak again with intention.*',
    '',
    '```',
    'debug:',
    `  action     : ${result.action}`,
    `  reasons    : ${reasonList}`,
    `  cooldown_s : ${seconds}`,
    `  similarity : ${(result.debug?.topSimilarity ?? 0).toFixed(2)}`,
    `  strikes    : ${result.debug?.strikes ?? 0}`,
    '```',
  ].join('\n');
}

module.exports = {
  evaluateRewardEligibility,
  buildDebugWarning,
  setThresholds,
  getThresholds,
  // exported for tests
  _internal: { normalize, trigrams, jaccard, analyzeLowEffort },
};
