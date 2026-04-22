/**
 * Patreon Rewards — monthly SadGirlCoin stipends for users who hold Patreon
 * supporter roles, plus a one-time signup bonus when a user is first detected
 * in one of those roles.
 *
 * Tiers (highest tier wins if a user has multiple patreon roles):
 *   1495822971225505946 → 100 SGC
 *   1495823279108264127 → 500 SGC
 *   1495823757422628934 → 1000 SGC
 *   1495838479555231886 → 2000 SGC
 *
 * Behaviour:
 *  - On the 1st of every month (UTC) every tier-holder gets their tier amount.
 *  - Whenever a member is first detected wearing a tier role they get an
 *    immediate signup stipend equal to their tier amount.
 *  - If a payout for a (user, period) was missed (bot offline, etc.) it is
 *    paid retroactively on the next startup / hourly sweep.
 *
 * State is stored in two tables in the existing economy DB:
 *   patreon_members  — current/last-known tier per user, signup tracking,
 *                      total months paid.
 *   patreon_payouts  — append-only log of every payout (signup + monthly).
 */

const { logger } = require('./logger');
const { adjustBalance, ensureAccount, getEconomyDb } = require('./sadgirlEconomyStore');

// ---------------------------------------------------------------------------
// Tier table
// ---------------------------------------------------------------------------

const TIERS = [
  { roleId: '1495838479555231886', amount: 2000, label: 'Tier 4 (2000 SGC)' },
  { roleId: '1495823757422628934', amount: 1000, label: 'Tier 3 (1000 SGC)' },
  { roleId: '1495823279108264127', amount: 500,  label: 'Tier 2 (500 SGC)'  },
  { roleId: '1495822971225505946', amount: 300,  label: 'Tier 1 (300 SGC)'  },
];
// Highest tier first, so detection picks the most generous role.

const TIER_ROLE_IDS = new Set(TIERS.map((t) => t.roleId));

function pickHighestTier(roleIds) {
  for (const tier of TIERS) {
    if (roleIds.has(tier.roleId)) return tier;
  }
  return null;
}

function currentPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let schemaReady = false;
let discordClient = null;
let sweepTimer = null;
let stopped = false;

function ensureSchema() {
  if (schemaReady) return;
  const db = getEconomyDb();
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS patreon_members (
      user_id              TEXT PRIMARY KEY,
      username             TEXT NOT NULL DEFAULT '',
      tier_role_id         TEXT,
      tier_amount          INTEGER NOT NULL DEFAULT 0,
      signup_bonus_paid    INTEGER NOT NULL DEFAULT 0,
      signup_bonus_at      TEXT,
      first_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
      total_months_paid    INTEGER NOT NULL DEFAULT 0,
      last_payout_period   TEXT,
      last_payout_at       TEXT
    );

    CREATE TABLE IF NOT EXISTS patreon_payouts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      tier_role_id  TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      period        TEXT NOT NULL,
      paid_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_patreon_payouts_user_period
      ON patreon_payouts(user_id, period);
    CREATE INDEX IF NOT EXISTS idx_patreon_members_tier
      ON patreon_members(tier_role_id);
  `);
  schemaReady = true;
}

// ---------------------------------------------------------------------------
// Internal data helpers
// ---------------------------------------------------------------------------

function getMemberRow(userId) {
  const db = getEconomyDb();
  return db.prepare('SELECT * FROM patreon_members WHERE user_id = ?').get(userId) || null;
}

function hasPayout(userId, period) {
  const db = getEconomyDb();
  const row = db.prepare('SELECT 1 FROM patreon_payouts WHERE user_id = ? AND period = ?')
    .get(userId, period);
  return Boolean(row);
}

function recordPayout(userId, tierRoleId, amount, period) {
  const db = getEconomyDb();
  try {
    db.prepare(`
      INSERT INTO patreon_payouts (user_id, tier_role_id, amount, period)
      VALUES (?, ?, ?, ?)
    `).run(userId, tierRoleId, amount, period);
    return true;
  } catch (err) {
    // UNIQUE violation → already paid, treat as no-op
    if (String(err.message || '').includes('UNIQUE')) return false;
    throw err;
  }
}

function upsertMember({ userId, username, tier }) {
  const db = getEconomyDb();
  db.prepare(`
    INSERT INTO patreon_members (user_id, username, tier_role_id, tier_amount, last_seen_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      username      = CASE WHEN excluded.username != '' THEN excluded.username ELSE patreon_members.username END,
      tier_role_id  = excluded.tier_role_id,
      tier_amount   = excluded.tier_amount,
      last_seen_at  = datetime('now')
  `).run(userId, username || '', tier ? tier.roleId : null, tier ? tier.amount : 0);
}

function markSignupPaid(userId) {
  const db = getEconomyDb();
  db.prepare(`
    UPDATE patreon_members
       SET signup_bonus_paid = 1,
           signup_bonus_at   = datetime('now')
     WHERE user_id = ?
  `).run(userId);
}

function markMonthlyPaid(userId, period) {
  const db = getEconomyDb();
  db.prepare(`
    UPDATE patreon_members
       SET total_months_paid  = total_months_paid + 1,
           last_payout_period = ?,
           last_payout_at     = datetime('now')
     WHERE user_id = ?
  `).run(period, userId);
}

// ---------------------------------------------------------------------------
// Core sync / payout logic
// ---------------------------------------------------------------------------

/**
 * Apply signup bonus + this-month payout (if missing) for a single member.
 * Safe to call repeatedly — each payout is guarded by the unique index on
 * (user_id, period).
 *
 * Returns { signupPaid, monthlyPaid, tier } describing what was awarded.
 */
function syncMember(member) {
  ensureSchema();
  if (!member || !member.user || member.user.bot) return { signupPaid: false, monthlyPaid: false, tier: null };

  const roleIds = new Set(member.roles?.cache?.keys?.() || []);
  const tier = pickHighestTier(roleIds);

  if (!tier) {
    // Member is not a patron right now; record the absence but don't pay.
    const existing = getMemberRow(member.id);
    if (existing) {
      upsertMember({ userId: member.id, username: member.user.username, tier: null });
    }
    return { signupPaid: false, monthlyPaid: false, tier: null };
  }

  const username = member.user.username || '';
  ensureAccount(member.id, username);
  upsertMember({ userId: member.id, username, tier });

  const row = getMemberRow(member.id);
  let signupPaid = false;
  if (row && !row.signup_bonus_paid) {
    const ok = adjustBalance(member.id, tier.amount, `Patreon signup stipend (${tier.label})`);
    if (ok && ok.success) {
      markSignupPaid(member.id);
      recordPayout(member.id, tier.roleId, tier.amount, `signup-${tier.roleId}`);
      signupPaid = true;
      logger.info(`Patreon: paid signup stipend ${tier.amount} SGC to ${username} (${member.id}) for ${tier.label}.`);
    } else {
      logger.warn(`Patreon: failed to pay signup stipend to ${member.id}: ${ok && ok.error}`);
    }
  }

  const period = currentPeriod();
  let monthlyPaid = false;
  if (!hasPayout(member.id, period)) {
    const ok = adjustBalance(member.id, tier.amount, `Patreon monthly stipend ${period} (${tier.label})`);
    if (ok && ok.success) {
      recordPayout(member.id, tier.roleId, tier.amount, period);
      markMonthlyPaid(member.id, period);
      monthlyPaid = true;
      logger.info(`Patreon: paid monthly stipend ${tier.amount} SGC (${period}) to ${username} (${member.id}).`);
    } else {
      logger.warn(`Patreon: failed to pay monthly stipend to ${member.id}: ${ok && ok.error}`);
    }
  }

  return { signupPaid, monthlyPaid, tier };
}

/**
 * Iterate every guild the bot is in, fetch all members, and run syncMember
 * on anyone who currently holds a patreon role. This is the workhorse used by
 * both startup retroactive payout and the daily/monthly tick.
 */
async function processAllGuilds(client) {
  if (!client) return { membersChecked: 0, signupPaid: 0, monthlyPaid: 0 };
  ensureSchema();

  let membersChecked = 0;
  let signupPaid = 0;
  let monthlyPaid = 0;

  for (const [, guild] of client.guilds.cache) {
    let members;
    try {
      members = await guild.members.fetch();
    } catch (err) {
      logger.warn(`Patreon: failed to fetch members for guild ${guild.name}: ${err.message}`);
      continue;
    }

    for (const [, member] of members) {
      if (member.user?.bot) continue;
      const roleIds = member.roles?.cache;
      if (!roleIds) continue;
      let isPatron = false;
      for (const id of TIER_ROLE_IDS) {
        if (roleIds.has(id)) { isPatron = true; break; }
      }
      if (!isPatron) continue;

      membersChecked += 1;
      try {
        const result = syncMember(member);
        if (result.signupPaid) signupPaid += 1;
        if (result.monthlyPaid) monthlyPaid += 1;
      } catch (err) {
        logger.error(`Patreon: syncMember failed for ${member.id}: ${err.message}`);
      }
    }
  }

  return { membersChecked, signupPaid, monthlyPaid };
}

// ---------------------------------------------------------------------------
// Discord event handlers
// ---------------------------------------------------------------------------

function handleGuildMemberAdd(member) {
  try {
    syncMember(member);
  } catch (err) {
    logger.error(`Patreon: handleGuildMemberAdd failed: ${err.message}`);
  }
}

function handleGuildMemberUpdate(oldMember, newMember) {
  try {
    const oldRoles = new Set(oldMember?.roles?.cache?.keys?.() || []);
    const newRoles = new Set(newMember?.roles?.cache?.keys?.() || []);

    let gainedTierRole = false;
    for (const id of TIER_ROLE_IDS) {
      if (newRoles.has(id) && !oldRoles.has(id)) { gainedTierRole = true; break; }
    }

    // Only act if a patreon-relevant role changed; otherwise this fires on
    // every nickname / boost / role tweak in the guild.
    let anyTierTouched = gainedTierRole;
    if (!anyTierTouched) {
      for (const id of TIER_ROLE_IDS) {
        if (oldRoles.has(id) !== newRoles.has(id)) { anyTierTouched = true; break; }
      }
    }
    if (!anyTierTouched) return;

    syncMember(newMember);
  } catch (err) {
    logger.error(`Patreon: handleGuildMemberUpdate failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;

async function tick() {
  if (stopped || !discordClient) return;
  try {
    const result = await processAllGuilds(discordClient);
    if (result.signupPaid > 0 || result.monthlyPaid > 0) {
      logger.info(
        `Patreon sweep: checked ${result.membersChecked} patron(s), ` +
        `paid ${result.signupPaid} signup bonus(es) and ${result.monthlyPaid} monthly stipend(s).`
      );
    }
  } catch (err) {
    logger.error(`Patreon sweep failed: ${err.message}`);
  }
}

function scheduleNextTick() {
  if (stopped) return;
  sweepTimer = setTimeout(async () => {
    await tick();
    scheduleNextTick();
  }, ONE_HOUR_MS);
  sweepTimer.unref?.();
}

async function startPatreonRewards(client) {
  discordClient = client;
  stopped = false;
  ensureSchema();

  // Initial sweep (handles retroactive payouts for the current month and any
  // signup bonuses we've never recorded).
  try {
    const result = await processAllGuilds(client);
    logger.info(
      `Patreon rewards started — initial sweep checked ${result.membersChecked} patron(s), ` +
      `paid ${result.signupPaid} signup bonus(es) and ${result.monthlyPaid} monthly stipend(s).`
    );
  } catch (err) {
    logger.error(`Patreon: initial sweep failed: ${err.message}`);
  }

  scheduleNextTick();
}

function stopPatreonRewards() {
  stopped = true;
  if (sweepTimer) { clearTimeout(sweepTimer); sweepTimer = null; }
  discordClient = null;
}

// ---------------------------------------------------------------------------
// Web panel helpers
// ---------------------------------------------------------------------------

function getAllPatrons() {
  ensureSchema();
  const db = getEconomyDb();
  if (!db) return [];
  return db.prepare(`
    SELECT user_id, username, tier_role_id, tier_amount, signup_bonus_paid,
           signup_bonus_at, first_seen_at, last_seen_at, total_months_paid,
           last_payout_period, last_payout_at
      FROM patreon_members
     ORDER BY tier_amount DESC, total_months_paid DESC, username ASC
  `).all();
}

function getPatreonStats() {
  ensureSchema();
  const db = getEconomyDb();
  if (!db) return { totalPatrons: 0, activePatrons: 0, totalPaid: 0, perTier: [] };
  const totalPatrons = db.prepare('SELECT COUNT(*) AS n FROM patreon_members').get().n || 0;
  const activePatrons = db.prepare("SELECT COUNT(*) AS n FROM patreon_members WHERE tier_role_id IS NOT NULL AND tier_role_id != ''").get().n || 0;
  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM patreon_payouts').get().s || 0;
  const perTier = TIERS.map((t) => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM patreon_members WHERE tier_role_id = ?').get(t.roleId).n || 0;
    return { ...t, count };
  });
  return { totalPatrons, activePatrons, totalPaid, perTier };
}

function getTierInfo(roleId) {
  return TIERS.find((t) => t.roleId === roleId) || null;
}

module.exports = {
  TIERS,
  TIER_ROLE_IDS,
  startPatreonRewards,
  stopPatreonRewards,
  handleGuildMemberAdd,
  handleGuildMemberUpdate,
  syncMember,
  processAllGuilds,
  getAllPatrons,
  getPatreonStats,
  getTierInfo,
};
