/**
 * Voice-channel reward system — pays users 15 SGC for every hour in VC.
 *
 * Tracks join timestamps per user. Every 60 minutes a sweep awards coins
 * for each full hour accrued since the user joined (or since the last payout).
 * Partial hours roll over into the next sweep.
 *
 * Sessions persist across reboots via the vc_sessions table.
 * Cumulative VC time is tracked in the vc_time table.
 */

const { logger } = require('./logger');
const {
  awardVoiceCoins,
  ensureAccount,
  saveVcSession,
  removeVcSession,
  getAllVcSessions,
  clearAllVcSessions,
  addVcTime,
  getVcTimeLeaderboard,
  getVcTimeForUser,
} = require('./sadgirlEconomyStore');
const { matchPayout } = require('./bigBusiness');
const { isGuildEnabled } = require('./guildConfig');
const { getSetting } = require('./panelSettings');

let VC_COINS_PER_HOUR = 15;
let SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const SECONDS_PER_HOUR = 60 * 60;

/** Map<userId, { joinedAt: number, username: string, guildId: string, pendingSeconds: number }> */
const activeVoiceUsers = new Map();

let sweepTimer = null;
let cleanupTimer = null;
let stopped = false;
let discordClient = null;

// ---------------------------------------------------------------------------
// Voice-state tracking
// ---------------------------------------------------------------------------

/**
 * Call from the `voiceStateUpdate` event.
 * Detects joins, leaves, and channel switches.
 */
function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState.member?.id ?? newState.id;
  const username = newState.member?.user?.username ?? '';
  const guildId = newState.guild?.id ?? '';

  // Ignore bots
  if (newState.member?.user?.bot) return;

  // Only track guilds that are configured
  if (guildId && !isGuildEnabled(guildId)) return;

  const wasInVC = !!oldState.channelId;
  const isInVC = !!newState.channelId;

  if (!wasInVC && isInVC) {
    // User joined a voice channel
    onVoiceJoin(userId, username, guildId);
  } else if (wasInVC && !isInVC) {
    // User left all voice channels
    onVoiceLeave(userId, username);
  }
  // Channel switch within VC — no action needed, they stay tracked.
}

function onVoiceJoin(userId, username, guildId) {
  if (activeVoiceUsers.has(userId)) return; // already tracked
  const joinedAt = Date.now();
  activeVoiceUsers.set(userId, { joinedAt, username, guildId, pendingSeconds: 0 });

  // Persist to DB so sessions survive reboots
  try { saveVcSession(userId, username, guildId, joinedAt, 0); } catch (e) {
    logger.warn('VC rewards: failed to persist session for', userId, e.message);
  }

  logger.debug(`VC rewards: ${username} (${userId}) joined voice in guild ${guildId} — tracking started.`);

  // Recompute next sweep so payout timing follows this user's own cadence
  rescheduleSweep();
}

function onVoiceLeave(userId, username) {
  const entry = activeVoiceUsers.get(userId);
  if (!entry) return;

  const progress = getVcRewardProgress(entry, Date.now());

  // Record cumulative VC time
  if (progress.liveSeconds > 0) {
    try { addVcTime(userId, entry.username || username, progress.liveSeconds); } catch (e) {
      logger.warn('VC rewards: failed to record VC time for', userId, e.message);
    }
  }

  // Award any full hours accumulated before they left
  if (progress.fullHours > 0) {
    const coins = progress.pendingCoins;
    awardVoiceCoins(userId, entry.username, coins);
    logger.info(`VC rewards: paid ${coins} SGC to ${entry.username} (${userId}) for ${progress.fullHours}h in VC on leave.`);
    void matchPayout(entry.username, coins, 'vc', entry.guildId);
  }

  activeVoiceUsers.delete(userId);

  // Remove persisted session
  try { removeVcSession(userId); } catch (e) {
    logger.warn('VC rewards: failed to remove persisted session for', userId, e.message);
  }

  logger.debug(`VC rewards: ${username} (${userId}) left voice — tracking stopped.`);

  // Recompute next sweep after removing a tracked user
  rescheduleSweep();
}

// ---------------------------------------------------------------------------
// Periodic sweep — awards coins and resets timers for users still in VC
// ---------------------------------------------------------------------------

function sweep() {
  if (stopped) return;

  const now = Date.now();
  let totalPaid = 0;
  let usersPaid = 0;

  for (const [userId, entry] of activeVoiceUsers) {
    const progress = getVcRewardProgress(entry, now);
    if (progress.fullHours <= 0) continue;

    const coins = progress.pendingCoins;
    awardVoiceCoins(userId, entry.username, coins);

    // Record cumulative VC time accrued since the last checkpoint
    try { addVcTime(userId, entry.username, progress.liveSeconds); } catch (e) {
      logger.warn('VC rewards: failed to record sweep VC time for', userId, e.message);
    }

    // Checkpoint progress so pending partial time survives reboot cleanly
    entry.pendingSeconds = progress.remainderSeconds;
    entry.joinedAt = now;

    // Update persisted session with new checkpoint + carried remainder
    try { saveVcSession(userId, entry.username, entry.guildId, entry.joinedAt, entry.pendingSeconds); } catch { /* ok */ }

    totalPaid += coins;
    usersPaid++;
    void matchPayout(entry.username, coins, 'vc', entry.guildId);
  }

  if (usersPaid > 0) {
    logger.info(`VC rewards sweep: paid ${totalPaid} SGC to ${usersPaid} user(s).`);
  }

  scheduleSweep();
}

function scheduleSweep() {
  if (stopped) return;

  const delayMs = computeNextSweepDelayMs();
  sweepTimer = setTimeout(sweep, delayMs);
  sweepTimer.unref?.();
}

function runCleanupSweep() {
  if (stopped || !discordClient) return;

  const staleUserIds = [];

  for (const [userId, entry] of activeVoiceUsers) {
    const guild = entry.guildId ? discordClient.guilds.cache.get(entry.guildId) : null;
    if (!guild) {
      staleUserIds.push(userId);
      continue;
    }

    const voiceState = guild.voiceStates.cache.get(userId);
    const inVoice = Boolean(voiceState?.channelId);
    if (!inVoice) {
      staleUserIds.push(userId);
    }
  }

  if (staleUserIds.length > 0) {
    for (const userId of staleUserIds) {
      const entry = activeVoiceUsers.get(userId);
      if (!entry) continue;
      onVoiceLeave(userId, entry.username || userId);
    }
    logger.warn(`VC rewards cleanup: removed ${staleUserIds.length} stale tracked user(s) not currently in voice.`);
  }
}

function scheduleCleanupSweep() {
  if (stopped) return;

  cleanupTimer = setTimeout(() => {
    runCleanupSweep();
    scheduleCleanupSweep();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

function rescheduleSweep() {
  if (stopped) return;
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
  scheduleSweep();
}

function computeNextSweepDelayMs(now = Date.now()) {
  if (activeVoiceUsers.size === 0) return SWEEP_INTERVAL_MS;

  let minSecondsUntilPayout = Number.POSITIVE_INFINITY;
  for (const [, entry] of activeVoiceUsers) {
    const progress = getVcRewardProgress(entry, now);
    const remainder = progress.rewardSeconds % SECONDS_PER_HOUR;
    const secondsUntilPayout = remainder === 0 && progress.rewardSeconds > 0
      ? 1
      : (SECONDS_PER_HOUR - remainder);
    if (secondsUntilPayout < minSecondsUntilPayout) {
      minSecondsUntilPayout = secondsUntilPayout;
    }
  }

  const adaptiveDelayMs = Math.max(1_000, Math.floor(minSecondsUntilPayout * 1000));
  return Math.min(SWEEP_INTERVAL_MS, adaptiveDelayMs);
}

function cleanupInvalidPersistedSessions() {
  let removed = 0;
  let scanned = 0;

  try {
    const sessions = getAllVcSessions();
    scanned = sessions.length;
    for (const s of sessions) {
      if (!s.guild_id || !isGuildEnabled(s.guild_id)) {
        try {
          removeVcSession(s.user_id);
          removed++;
        } catch { /* ok */ }
      }
    }
  } catch (e) {
    logger.warn('VC rewards: failed to clean invalid persisted sessions.', e.message);
  }

  return { scanned, removed };
}

function getVcRewardProgress(entry, now = Date.now()) {
  const liveSeconds = Math.max(0, Math.floor((now - entry.joinedAt) / 1000));
  const carriedSeconds = Math.max(0, Math.floor(Number(entry.pendingSeconds) || 0));
  const rewardSeconds = carriedSeconds + liveSeconds;
  const fullHours = Math.floor(rewardSeconds / SECONDS_PER_HOUR);
  const remainderSeconds = rewardSeconds % SECONDS_PER_HOUR;

  return {
    liveSeconds,
    carriedSeconds,
    rewardSeconds,
    fullHours,
    remainderSeconds,
    pendingCoins: fullHours * VC_COINS_PER_HOUR,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap — restore persisted sessions then seed from current VC members
// ---------------------------------------------------------------------------

function restorePersistedSessions() {
  try {
    const cleanup = cleanupInvalidPersistedSessions();
    const sessions = getAllVcSessions();
    if (cleanup.removed > 0) {
      logger.warn(`VC rewards: removed ${cleanup.removed} invalid persisted session(s) before restore.`);
    }
    for (const s of sessions) {
      if (!activeVoiceUsers.has(s.user_id)) {
        activeVoiceUsers.set(s.user_id, {
          joinedAt: s.joined_at,
          username: s.username,
          guildId: s.guild_id,
          pendingSeconds: Number(s.pending_seconds) || 0,
        });
      }
    }
    if (sessions.length > 0) {
      logger.info(`VC rewards: restored ${sessions.length} persisted session(s) from DB.`);
    }

    // Ensure timer aligns with restored carried progress
    rescheduleSweep();
  } catch (e) {
    logger.warn('VC rewards: failed to restore persisted sessions.', e.message);
  }
}

async function seedFromGuilds() {
  if (!discordClient) return;

  for (const [, guild] of discordClient.guilds.cache) {
    try {
      const members = guild.voiceStates.cache;
      for (const [, vs] of members) {
        if (!vs.channelId) continue;
        if (vs.member?.user?.bot) continue;
        const userId = vs.member?.id ?? vs.id;
        const username = vs.member?.user?.username ?? '';
        if (!activeVoiceUsers.has(userId)) {
          const joinedAt = Date.now();
          activeVoiceUsers.set(userId, { joinedAt, username, guildId: guild.id, pendingSeconds: 0 });
          try { saveVcSession(userId, username, guild.id, joinedAt, 0); } catch { /* ok */ }
          logger.debug(`VC rewards: seeded ${username} (${userId}) from guild ${guild.name}.`);
        }
      }
    } catch (err) {
      logger.warn(`VC rewards: failed to seed from guild ${guild.name}.`, err.message);
    }
  }

  // Clean up any persisted sessions for users no longer in VC
  try {
    const persisted = getAllVcSessions();
    for (const s of persisted) {
      if (!activeVoiceUsers.has(s.user_id)) {
        // User was in a session but is no longer in VC — credit time and remove
        const progress = getVcRewardProgress({
          joinedAt: s.joined_at,
          pendingSeconds: Number(s.pending_seconds) || 0,
        }, Date.now());
        if (progress.liveSeconds > 0) {
          addVcTime(s.user_id, s.username, progress.liveSeconds);
        }
        // Award coins for full hours
        if (progress.fullHours > 0) {
          const coins = progress.pendingCoins;
          try {
            awardVoiceCoins(s.user_id, s.username, coins);
            logger.info(`VC rewards: paid ${coins} SGC to ${s.username} (${s.user_id}) for ${progress.fullHours}h from persisted session.`);
          } catch { /* ok */ }
        }
        removeVcSession(s.user_id);
      }
    }
  } catch (e) {
    logger.warn('VC rewards: failed to clean stale persisted sessions.', e.message);
  }

  logger.info(`VC rewards: seeded ${activeVoiceUsers.size} user(s) already in voice.`);

  // Re-align timer after reconciling persisted vs currently connected users
  rescheduleSweep();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function startVcRewards(client) {
  discordClient = client;
  stopped = false;
  restorePersistedSessions();
  seedFromGuilds();
  scheduleSweep();
  scheduleCleanupSweep();
  logger.info('VC rewards system started (15 SGC / hour).');
}

function stopVcRewards() {
  stopped = true;
  if (sweepTimer) { clearTimeout(sweepTimer); sweepTimer = null; }
  if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }

  // Pay out any remaining full hours for users still tracked + record time
  for (const [userId, entry] of activeVoiceUsers) {
    const now = Date.now();
    const progress = getVcRewardProgress(entry, now);

    // Record cumulative time
    if (progress.liveSeconds > 0) {
      try { addVcTime(userId, entry.username, progress.liveSeconds); } catch { /* DB may already be closed */ }
    }

    if (progress.fullHours > 0) {
      const coins = progress.pendingCoins;
      try {
        awardVoiceCoins(userId, entry.username, coins);
        logger.info(`VC rewards: paid ${coins} SGC to ${entry.username} on shutdown.`);
      } catch { /* DB may already be closed */ }
    }

    // Checkpoint session so remaining partial time survives the reboot
    entry.pendingSeconds = progress.remainderSeconds;
    entry.joinedAt = now;
    try { saveVcSession(userId, entry.username, entry.guildId, entry.joinedAt, entry.pendingSeconds); } catch { /* ok */ }
  }
  activeVoiceUsers.clear();
  discordClient = null;
  logger.info('VC rewards system stopped.');
}

function reloadSettings() {
  try {
    VC_COINS_PER_HOUR = getSetting('vc.coinsPerHour');
    SWEEP_INTERVAL_MS = getSetting('vc.sweepIntervalMs');
    CLEANUP_INTERVAL_MS = getSetting('vc.cleanupIntervalMs');

    // Apply updated intervals immediately while running
    rescheduleSweep();
    if (!stopped) {
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
      }
      scheduleCleanupSweep();
    }
  } catch { /* DB not ready */ }
}

// ---------------------------------------------------------------------------
// VC time query helpers (exposed for commands)
// ---------------------------------------------------------------------------

/**
 * Format seconds into a human-readable string like "12h 34m" or "2d 5h 12m".
 */
function formatVcTime(totalSeconds) {
  if (totalSeconds <= 0) return '0m';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

/**
 * Get VC time leaderboard with current session time included.
 * Returns array of { user_id, username, total_seconds }.
 */
function getVcLeaderboard(limit = 20) {
  const lb = getVcTimeLeaderboard(limit + activeVoiceUsers.size);
  const lbMap = new Map(lb.map((r) => [r.user_id, { ...r }]));

  // Add live session time for active users
  const now = Date.now();
  for (const [userId, entry] of activeVoiceUsers) {
    const liveSeconds = getVcRewardProgress(entry, now).liveSeconds;
    if (lbMap.has(userId)) {
      lbMap.get(userId).total_seconds += liveSeconds;
    } else {
      lbMap.set(userId, { user_id: userId, username: entry.username, total_seconds: liveSeconds });
    }
  }

  // Sort by total and take top N
  return [...lbMap.values()]
    .sort((a, b) => b.total_seconds - a.total_seconds)
    .slice(0, limit);
}

/**
 * Get a user's total VC time including any current live session.
 */
function getUserVcTime(userId) {
  let total = getVcTimeForUser(userId);
  const entry = activeVoiceUsers.get(userId);
  if (entry) {
    total += getVcRewardProgress(entry, Date.now()).liveSeconds;
  }
  return total;
}

module.exports = {
  handleVoiceStateUpdate,
  startVcRewards,
  stopVcRewards,
  activeVoiceUsers,
  VC_COINS_PER_HOUR,
  reloadSettings,
  cleanupInvalidPersistedSessions,
  getVcRewardProgress,
  formatVcTime,
  getVcLeaderboard,
  getUserVcTime,
};
