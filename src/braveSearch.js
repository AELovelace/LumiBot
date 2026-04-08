const { config } = require('./config');
const { logger } = require('./logger');

const DAY_MS = 86_400_000;

/**
 * Global daily search counter — resets when the current window expires.
 */
const globalCounter = { count: 0, windowStart: Date.now() };

/**
 * Per-user daily search counters — Map<userId, { count, windowStart }>.
 */
const userCounters = new Map();

/**
 * Per-user cooldown timestamps — Map<userId, lastSearchAt>.
 */
const userCooldowns = new Map();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resetIfExpired(counter) {
  if (Date.now() - counter.windowStart >= DAY_MS) {
    counter.count = 0;
    counter.windowStart = Date.now();
  }
}

function getUserCounter(userId) {
  let counter = userCounters.get(userId);
  if (!counter) {
    counter = { count: 0, windowStart: Date.now() };
    userCounters.set(userId, counter);
  }

  resetIfExpired(counter);
  return counter;
}

function isExemptUser(userId) {
  return config.braveSearchExemptUserIds.includes(userId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a search is allowed for a given user.
 * Returns { allowed: boolean, reason: string }.
 */
function checkSearchAllowed(userId) {
  if (!config.braveSearchEnabled) {
    return { allowed: false, reason: 'search-disabled' };
  }

  if (!config.braveSearchApiKey) {
    return { allowed: false, reason: 'no-api-key' };
  }

  // Global daily cap
  resetIfExpired(globalCounter);
  if (globalCounter.count >= config.braveSearchDailyLimit) {
    return { allowed: false, reason: 'global-daily-limit' };
  }

  // Per-user cooldown (skip for exempt users)
  if (!isExemptUser(userId)) {
    const lastSearch = userCooldowns.get(userId);
    if (lastSearch && Date.now() - lastSearch < config.braveSearchCooldownMs) {
      const remainingSec = Math.ceil((config.braveSearchCooldownMs - (Date.now() - lastSearch)) / 1_000);
      return { allowed: false, reason: `cooldown:${remainingSec}s` };
    }
  }

  // Per-user daily limit (skip for exempt users)
  if (!isExemptUser(userId)) {
    const userCounter = getUserCounter(userId);
    if (userCounter.count >= config.braveSearchUserDailyLimit) {
      return { allowed: false, reason: 'user-daily-limit' };
    }
  }

  return { allowed: true, reason: 'ok' };
}

/**
 * Call the Brave Search API and return the top results.
 * Returns an array of { title, url, description }.
 */
async function executeBraveSearch(query, resultCount = 5) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${resultCount}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': config.braveSearchApiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Brave Search API returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const webResults = payload?.web?.results;

  if (!Array.isArray(webResults) || webResults.length === 0) {
    return [];
  }

  return webResults.slice(0, resultCount).map((result) => ({
    title: result.title || 'Untitled',
    url: result.url || '',
    description: result.description || '',
  }));
}

/**
 * Format search results into a text block suitable for LLM prompt injection.
 */
function formatSearchResultsForPrompt(results) {
  if (!results || results.length === 0) {
    return 'No relevant web results found.';
  }

  return results
    .map((result, index) => `${index + 1}. ${result.title} — ${result.url}\n   ${result.description}`)
    .join('\n');
}

/**
 * Increment both global and per-user search counters after a successful search.
 */
function incrementSearchCount(userId) {
  resetIfExpired(globalCounter);
  globalCounter.count += 1;

  if (!isExemptUser(userId)) {
    const userCounter = getUserCounter(userId);
    userCounter.count += 1;
  }

  userCooldowns.set(userId, Date.now());

  logger.debug(
    `Search counter incremented: global=${globalCounter.count}/${config.braveSearchDailyLimit}, ` +
    `user=${userId} count=${getUserCounter(userId).count}/${config.braveSearchUserDailyLimit}`,
  );
}

/**
 * Return current search usage stats (useful for admin visibility).
 */
function getSearchStats() {
  resetIfExpired(globalCounter);

  const perUser = {};
  userCounters.forEach((counter, userId) => {
    resetIfExpired(counter);
    perUser[userId] = { count: counter.count, windowStart: counter.windowStart };
  });

  return {
    global: { count: globalCounter.count, limit: config.braveSearchDailyLimit, windowStart: globalCounter.windowStart },
    perUser,
  };
}

module.exports = {
  checkSearchAllowed,
  executeBraveSearch,
  formatSearchResultsForPrompt,
  getSearchStats,
  incrementSearchCount,
};
