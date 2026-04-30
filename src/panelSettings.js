/**
 * Panel Settings — runtime-configurable settings backed by system_state.
 *
 * Every tunable constant across the economy and casino systems is registered
 * here with a default value. Overrides are stored in the SQLite system_state
 * table (key prefix: `setting.`). If no override exists the hardcoded default
 * is returned.
 *
 * Game modules call `getSetting('slots.maxPlayers')` instead of using a
 * hardcoded constant. The web panel reads the full schema to render forms
 * and writes overrides back through `setSetting()`.
 */

// Lazy-loaded reference to avoid circular dependency with sadgirlEconomyStore
let _store = null;
function _getStore() {
  if (!_store) _store = require('./sadgirlEconomyStore');
  return _store;
}

function _deleteOverride(key) {
  try { _getStore().deleteSystemState(SETTING_PREFIX + key); } catch { /* ignore */ }
}

const SETTING_PREFIX = 'setting.';

// ---------------------------------------------------------------------------
// Schema — every configurable value in the project
// ---------------------------------------------------------------------------

/** @type {Record<string, { default: any, type: string, label: string, desc: string, category: string }>} */
const SCHEMA = {
  // ── Economy ──────────────────────────────────────────────────────────────
  'economy.coinsPerChars':       { default: 50,    type: 'number', label: 'Characters Per Coin',     desc: '1 SGC per this many characters typed',            category: 'Economy' },
  'economy.transferFeeRate':     { default: 0.01,  type: 'number', label: 'Transfer Fee Rate',       desc: 'Normal transfer fee (0.01 = 1%)',                 category: 'Economy' },
  'economy.lottoFeeRate':        { default: 0.50,  type: 'number', label: 'Lotto Day Fee Rate',      desc: 'Transfer fee on lotto day (0.50 = 50%)',          category: 'Economy' },
  'economy.weeklyLotteryPrize':  { default: 50,    type: 'number', label: 'Weekly Lottery Prize',    desc: 'SGC awarded to random weekly lottery winner',     category: 'Economy' },
  'economy.yearlyRaffleCost':    { default: 50,    type: 'number', label: 'Raffle Ticket Cost',      desc: 'SGC cost per yearly raffle ticket',               category: 'Economy' },
  'economy.yearlyRafflePercent': { default: 0.25,  type: 'number', label: 'Raffle Prize %',          desc: 'Fraction of Central Bank given to raffle winner', category: 'Economy' },
  'economy.adminAutoStars':      { default: 3,     type: 'number', label: 'Admin Auto-Stars',        desc: 'Stars credited when admin auto-activates market', category: 'Economy' },
  'economy.bankOwnerId':        { default: '319254336402358272', type: 'string', label: 'Bank Owner User ID', desc: 'Discord user ID that can withdraw from Central Bank', category: 'Economy' },
  'economy.adminRoleId':         { default: '901304988083572756', type: 'string', label: 'Economy Admin Role ID', desc: 'Discord role ID for economy admins', category: 'Economy' },

  // ── Tax ──────────────────────────────────────────────────────────────────
  'tax.tier1Threshold':  { default: 100,     type: 'number', label: 'Tier 1 Threshold', desc: 'Balance above which 1% monthly tax applies',  category: 'Tax' },
  'tax.tier1Rate':       { default: 0.01,    type: 'number', label: 'Tier 1 Rate',      desc: 'Tax rate for balances over tier 1 threshold',  category: 'Tax' },
  'tax.tier2Threshold':  { default: 10000,   type: 'number', label: 'Tier 2 Threshold', desc: 'Balance above which 5% monthly tax applies',  category: 'Tax' },
  'tax.tier2Rate':       { default: 0.05,    type: 'number', label: 'Tier 2 Rate',      desc: 'Tax rate for balances over tier 2 threshold',  category: 'Tax' },
  'tax.tier3Threshold':  { default: 1000000, type: 'number', label: 'Tier 3 Threshold', desc: 'Balance above which 10% monthly tax applies', category: 'Tax' },
  'tax.tier3Rate':       { default: 0.10,    type: 'number', label: 'Tier 3 Rate',      desc: 'Tax rate for balances over tier 3 threshold',  category: 'Tax' },

  // ── Casino Reserve ───────────────────────────────────────────────────────
  'casino.reserveThreshold': { default: 1000000, type: 'number', label: 'Reserve Threshold', desc: 'Momiji Casino deposits excess over this into Central Bank', category: 'Casino Reserve' },
  'casino.reserveRate':      { default: 0.10,    type: 'number', label: 'Reserve Deposit Rate', desc: 'Fraction of excess deposited daily (0.10 = 10%)',        category: 'Casino Reserve' },

  // ── Scheduler ────────────────────────────────────────────────────────────
  'scheduler.leaderboardChannelId': { default: '1494913175886233600', type: 'string', label: 'Leaderboard Channel ID', desc: 'Discord channel for leaderboard posts',   category: 'Scheduler' },
  'scheduler.leaderboardSize':     { default: 50,    type: 'number', label: 'Leaderboard Size',      desc: 'Number of top holders shown on leaderboard',     category: 'Scheduler' },
  'scheduler.archiveChannelId':    { default: '1494931183455436870', type: 'string', label: 'Archive Channel ID',     desc: 'Discord channel for resolved market archives', category: 'Scheduler' },

  // ── Big Business ─────────────────────────────────────────────────────────
  'bigbusiness.llmTimeoutMs': { default: 40000, type: 'number', label: 'LLM Timeout (ms)', desc: 'Timeout for Big Business announcement LLM requests', category: 'Big Business' },

  // ── VC Rewards ───────────────────────────────────────────────────────────
  'vc.coinsPerHour':      { default: 15,      type: 'number', label: 'Coins Per Hour',      desc: 'SGC awarded per hour in voice chat',           category: 'VC Rewards' },
  'vc.sweepIntervalMs':   { default: 3600000, type: 'number', label: 'Sweep Interval (ms)', desc: 'How often to check and pay VC rewards',        category: 'VC Rewards' },
  'vc.cleanupIntervalMs': { default: 300000,  type: 'number', label: 'Cleanup Sweep (ms)',  desc: 'How often to reconcile stale VC tracker users', category: 'VC Rewards' },

  // ── Runtime Channels ─────────────────────────────────────────────────────
  'runtime.welcomeChannelId':       { default: '', type: 'string', label: 'Welcome Channel ID',       desc: 'Channel for AI welcome messages',             category: 'Runtime Channels' },
  'runtime.introductionsChannelId': { default: '', type: 'string', label: 'Introductions Channel ID', desc: 'Channel mention used in welcome prompt text', category: 'Runtime Channels' },

  // ── Chatbot ──────────────────────────────────────────────────────────────
  'chatbot.enabled':             { default: 'true', type: 'string', label: 'Enabled',                desc: 'Enable chatbot autonomous responses (true/false)', category: 'Chatbot' },
  'chatbot.channelIds':          { default: '',     type: 'string', label: 'Channel IDs (CSV)',      desc: 'Allowed chatbot channels as comma-separated IDs',  category: 'Chatbot' },
  'chatbot.replyChance':         { default: 0.2,    type: 'number', label: 'Reply Chance',           desc: 'Base autonomous reply chance (0-1)',               category: 'Chatbot' },
  'chatbot.interestThreshold':   { default: 2,      type: 'number', label: 'Interest Threshold',     desc: 'Minimum interest score to trigger reply',         category: 'Chatbot' },
  'chatbot.contextMessages':     { default: 20,     type: 'number', label: 'Context Messages',       desc: 'Recent context window size',                      category: 'Chatbot' },
  'chatbot.cooldownMs':          { default: 15000,  type: 'number', label: 'Cooldown (ms)',          desc: 'Minimum delay between autonomous replies',        category: 'Chatbot' },
  'chatbot.followupCooldownMs':  { default: 5000,   type: 'number', label: 'Followup Cooldown (ms)', desc: 'Short cooldown while conversation is active',     category: 'Chatbot' },
  'chatbot.maxResponseChars':    { default: 450,    type: 'number', label: 'Max Response Chars',     desc: 'Maximum chatbot response length',                 category: 'Chatbot' },
  'chatbot.persona': { default: '', type: 'string', label: 'Runtime Persona Override', desc: 'If set, overrides CHATBOT_PERSONA immediately at runtime', category: 'Chatbot' },

  // ── Search ───────────────────────────────────────────────────────────────
  'search.enabled':          { default: 'false', type: 'string', label: 'Brave Search Enabled',   desc: 'Enable Brave web search integration (true/false)', category: 'Search' },
  'search.dailyLimit':       { default: 60,      type: 'number', label: 'Daily Global Limit',     desc: 'Maximum total searches per day',                  category: 'Search' },
  'search.userDailyLimit':   { default: 3,       type: 'number', label: 'Daily Per-User Limit',   desc: 'Maximum searches per user per day',               category: 'Search' },
  'search.cooldownMs':       { default: 120000,  type: 'number', label: 'Per-User Cooldown (ms)', desc: 'Cooldown between searches for non-exempt users',  category: 'Search' },
  'search.exemptUserIds':    { default: '',      type: 'string', label: 'Exempt User IDs (CSV)',  desc: 'Comma-separated user IDs exempt from limits',     category: 'Search' },

  // ── Slots ────────────────────────────────────────────────────────────────
  'slots.maxPlayers':           { default: 3,   type: 'number', label: 'Max Players',              desc: 'Maximum players per slot machine lobby',        category: 'Slots' },
  'slots.spinFrames':           { default: 6,   type: 'number', label: 'Spin Animation Frames',    desc: 'Number of animation frames during a spin',      category: 'Slots' },
  'slots.spinFrameMs':          { default: 400, type: 'number', label: 'Frame Duration (ms)',       desc: 'Milliseconds between animation frames',         category: 'Slots' },
  'slots.defaultBet':           { default: 1,   type: 'number', label: 'Default Bet',              desc: 'Starting bet amount (SGC)',                      category: 'Slots' },

  // ── Pachinko ─────────────────────────────────────────────────────────────
  'pachinko.gridWidth': { default: 10,  type: 'number', label: 'Grid Width',      desc: 'Number of peg positions',             category: 'Pachinko' },
  'pachinko.gridRows':  { default: 9,   type: 'number', label: 'Grid Rows',       desc: 'Number of rows the ball falls through', category: 'Pachinko' },
  'pachinko.rowDelay':  { default: 500, type: 'number', label: 'Row Delay (ms)',   desc: 'Milliseconds between animated rows',   category: 'Pachinko' },

  // ── Blackjack ────────────────────────────────────────────────────────────
  'blackjack.numDecks':           { default: 6,     type: 'number', label: 'Number of Decks',      desc: 'Decks in the shoe',                          category: 'Blackjack' },
  'blackjack.handsBeforeShuffle': { default: 12,    type: 'number', label: 'Hands Before Shuffle',  desc: 'Hands played before reshuffling the shoe',   category: 'Blackjack' },
  'blackjack.maxPlayers':         { default: 3,     type: 'number', label: 'Max Players',           desc: 'Maximum players per blackjack table',        category: 'Blackjack' },
  'blackjack.idleTimeoutMs':      { default: 60000, type: 'number', label: 'Idle Timeout (ms)',     desc: 'Auto-stand after this much inactivity',      category: 'Blackjack' },
  'blackjack.betweenHandsMs':     { default: 6000,  type: 'number', label: 'Between Hands (ms)',    desc: 'Pause between hands (ms)',                   category: 'Blackjack' },

  // ── Texas Hold'em ────────────────────────────────────────────────────────
  'holdem.maxPlayers':       { default: 6,    type: 'number', label: 'Max Players',          desc: 'Maximum players per Hold\'em table',       category: "Texas Hold'em" },
  'holdem.actionTimeoutMs':  { default: 45000, type: 'number', label: 'Action Timeout (ms)',  desc: 'Time allowed for each player action',      category: "Texas Hold'em" },
  'holdem.cpuActionDelayMs': { default: 1500, type: 'number', label: 'CPU Action Delay (ms)', desc: 'Delay before Lumi CPU player acts',        category: "Texas Hold'em" },
  'holdem.betweenHandsMs':   { default: 8000, type: 'number', label: 'Between Hands (ms)',    desc: 'Pause between hands',                      category: "Texas Hold'em" },

  // ── Horse Racing ─────────────────────────────────────────────────────────
  'horseracing.trackWidth':      { default: 50,    type: 'number', label: 'Track Width',          desc: 'Characters of running room on the track',  category: 'Horse Racing' },
  'horseracing.raceTickMs':      { default: 600,   type: 'number', label: 'Race Tick (ms)',        desc: 'Animation frame interval',                 category: 'Horse Racing' },
  'horseracing.bettingWindowMs': { default: 30000, type: 'number', label: 'Betting Window (ms)',   desc: 'Time between races for betting',            category: 'Horse Racing' },
  'horseracing.defaultBet':      { default: 5,     type: 'number', label: 'Default Bet',           desc: 'Starting bet amount (SGC)',                 category: 'Horse Racing' },

  // ── Touhou ───────────────────────────────────────────────────────────────
  'touhou.battleIdleTimeoutMs':  { default: 90000, type: 'number', label: 'Battle Idle Timeout (ms)', desc: 'Inactivity timeout for Touhou PvE battles', category: 'Touhou' },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a setting value. Checks system_state for an override first, then
 * falls back to the schema default.
 */
function getSetting(key) {
  const schema = SCHEMA[key];
  if (!schema) throw new Error(`Unknown setting key: ${key}`);

  const stored = _getStore().getSystemState(SETTING_PREFIX + key);
  if (stored === null || stored === undefined || stored === '') return schema.default;

  if (schema.type === 'number') {
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : schema.default;
  }
  return stored;
}

/**
 * Set a setting override. Passing `null` or `undefined` removes the override
 * (reverts to the schema default).
 */
function setSetting(key, value) {
  const schema = SCHEMA[key];
  if (!schema) throw new Error(`Unknown setting key: ${key}`);

  if (value === null || value === undefined || value === '') {
    // Remove the override — revert to default by deleting the row
    _deleteOverride(key);
    return;
  }

  _getStore().setSystemState(SETTING_PREFIX + key, String(value));
}

/**
 * Get all settings grouped by category, with current values.
 * Returns Map<category, Array<{ key, label, desc, type, value, default }>>
 */
function getAllSettings() {
  const categories = new Map();

  for (const [key, schema] of Object.entries(SCHEMA)) {
    const current = getSetting(key);
    const entry = {
      key,
      label: schema.label,
      desc: schema.desc,
      type: schema.type,
      value: current,
      default: schema.default,
      isOverridden: current !== schema.default,
    };

    if (!categories.has(schema.category)) {
      categories.set(schema.category, []);
    }
    categories.get(schema.category).push(entry);
  }

  return categories;
}

/**
 * Get setting entries for specific categories.
 */
function getSettingsByCategories(categoryNames) {
  const all = getAllSettings();
  const result = new Map();
  for (const name of categoryNames) {
    if (all.has(name)) {
      result.set(name, all.get(name));
    }
  }
  return result;
}

/**
 * Reset a setting to its default (removes system_state override).
 */
function resetSetting(key) {
  setSetting(key, null);
}

/**
 * Reset ALL settings to defaults.
 */
function resetAllSettings() {
  for (const key of Object.keys(SCHEMA)) {
    setSetting(key, null);
  }
}

module.exports = {
  SCHEMA,
  getSetting,
  setSetting,
  getAllSettings,
  getSettingsByCategories,
  resetSetting,
  resetAllSettings,
};
