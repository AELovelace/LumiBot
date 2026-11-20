/**
 * SadGirlCoin Economy Store — persistent SQLite-backed economy system.
 *
 * Separate database file so the economy can be reset independently.
 * All balances are global per Discord user (not per guild).
 */

const path = require('node:path');
const Database = require('better-sqlite3');
const { logger } = require('./logger');

const CENTRAL_BANK_USER_ID = '__CENTRAL_BANK__';
const DOLL_STREET_USER_ID = '__DOLL_STREET__';
const MOMIJI_CASINO_USER_ID = '__MOMIJI_CASINO__';
const BIG_BUSINESS_USER_ID = '__BIG_BUSINESS__'; // legacy — kept for migration
const TAYS_TOBACCO_USER_ID = '__TAYS_TOBACCO__';
const TOUHOU_MGMT_USER_ID = '__TOUHOU_MGMT__';
// Lumi-Town (src/lumi/, docs/plans/lumi-games-port.md section 3): the system accounts behind the Lumi games.
const LUMI_TOWN_BANK_USER_ID = '__LUMI_TOWN_BANK__';     // pays every Lumi prize, reward and refund
const LUMI_HOLDINGS_USER_ID = '__LUMI_HOLDINGS__';       // reserve capital, and the LUMI stock's real treasury
const LUMI_SNACKS_USER_ID = '__LUMI_SNACKS__';           // pet snacks and toys are sold here
const LUMI_BOUTIQUE_USER_ID = '__LUMI_BOUTIQUE__';       // decor, wear and house things
const LUMI_CAPSULES_USER_ID = '__LUMI_CAPSULES__';       // capsules and moon capsules
const LUMI_OUTFITTERS_USER_ID = '__LUMI_OUTFITTERS__';   // dungeon/battle shop: respec, mods, potions, heals, kit
const LUMI_NURSERY_USER_ID = '__LUMI_NURSERY__';         // garden plots and seeds
const LUMI_ARCADE_USER_ID = '__LUMI_ARCADE__';           // minigame entries, continues, showdown entries and bets
const LUMI_REALTY_USER_ID = '__LUMI_REALTY__';           // Lumi City real estate: plots, house styles, yard pieces, estate capsules
/** Every Lumi system account, in display order: { id, name } (the name is only used when the account is first made). */
const LUMI_ACCOUNTS = Object.freeze([
  { id: LUMI_TOWN_BANK_USER_ID, name: 'Lumi-Town Bank' },          // the main pool
  { id: LUMI_HOLDINGS_USER_ID, name: 'Lumi Holdings Inc.' },        // the reserve / LUMI treasury
  { id: LUMI_SNACKS_USER_ID, name: "Lumi's Snack Stand" },          // category: snacks
  { id: LUMI_BOUTIQUE_USER_ID, name: "Lumi's Boutique" },           // category: boutique
  { id: LUMI_CAPSULES_USER_ID, name: 'Moon Capsule Co.' },          // category: capsules
  { id: LUMI_OUTFITTERS_USER_ID, name: 'Dungeon Outfitters' },      // category: outfitters
  { id: LUMI_NURSERY_USER_ID, name: 'Starpowder Nursery' },         // category: nursery
  { id: LUMI_ARCADE_USER_ID, name: 'Lumi Arcade' },                 // category: arcade
  { id: LUMI_REALTY_USER_ID, name: 'Lumi City Realty' },            // category: realty
]);
const LUMI_ACCOUNT_IDS = Object.freeze(LUMI_ACCOUNTS.map((acct) => acct.id)); // just the ids, for exclusion lists
const BANK_OWNER_ID = '319254336402358272';
let COINS_PER_CHARS = 50; // 1 coin per this many characters
let ADMIN_AUTO_STARS = 3; // stars credited when admin auto-activates a market

let db = null;

/**
 * True only for a whole, positive SGC amount that SQLite can store exactly.
 * Rejects fractions (1.5), NaN, Infinity, strings ('5'), negatives, zero and
 * numbers too big to be exact (2**60). Every coin-moving export checks this.
 */
function isPositiveCoinAmount(amount) {
  return Number.isSafeInteger(amount) && amount > 0; // whole number, exact in a double, and above zero
}

// ---------------------------------------------------------------------------
// Internal settings helper — reads overrides from system_state without
// importing panelSettings (avoids circular dependency).
// ---------------------------------------------------------------------------

const SETTING_PREFIX = 'setting.';

function _loadSetting(key, defaultValue) {
  if (!db) return defaultValue;
  try {
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get(SETTING_PREFIX + key);
    if (row && row.value !== '') {
      const num = Number(row.value);
      return Number.isFinite(num) ? num : defaultValue;
    }
  } catch { /* table may not exist yet */ }
  return defaultValue;
}

function _loadStringSetting(key, defaultValue) {
  if (!db) return defaultValue;
  try {
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get(SETTING_PREFIX + key);
    if (row && row.value !== '') return row.value;
  } catch { /* */ }
  return defaultValue;
}

/**
 * Reload configurable constants from system_state overrides.
 * Called after DB init and can be called from the web panel.
 */
function reloadSettings() {
  if (!db) return;
  COINS_PER_CHARS = _loadSetting('economy.coinsPerChars', 50);
  ADMIN_AUTO_STARS = _loadSetting('economy.adminAutoStars', 3);
}
// Lifecycle
// ---------------------------------------------------------------------------

function initEconomyStore(dbPath) {
  const resolvedPath = dbPath === ':memory:' ? dbPath : path.resolve(dbPath); // ':memory:' = a throwaway in-memory DB (tests)
  logger.info(`SadGirlCoin economy DB: ${resolvedPath}`);
  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema();
  ensureCentralBank();
  ensureDollStreet();
  ensureMomijiCasino();
  ensureBigBusiness();
  ensureTaysTobacco();
  ensureTouhouMgmt();
  reloadSettings(); // Load configurable constants from DB overrides
}

function closeEconomyStore() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
    logger.info('SadGirlCoin economy DB closed.');
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      user_id       TEXT PRIMARY KEY,
      username      TEXT NOT NULL DEFAULT '',
      balance       INTEGER NOT NULL DEFAULT 0,
      total_earned  INTEGER NOT NULL DEFAULT 0,
      total_spent   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id  TEXT,
      to_user_id    TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      fee           INTEGER NOT NULL DEFAULT 0,
      type          TEXT NOT NULL,
      note          TEXT DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lottery_yearly_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      year          INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_markets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      outcome       TEXT DEFAULT NULL,
      payout_mult   REAL DEFAULT NULL,
      created_by    TEXT NOT NULL,
      message_id    TEXT DEFAULT NULL,
      channel_id    TEXT DEFAULT NULL,
      star_count    INTEGER NOT NULL DEFAULT 0,
      pool          INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_positions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id     INTEGER NOT NULL REFERENCES stock_markets(id),
      user_id       TEXT NOT NULL,
      side          TEXT NOT NULL DEFAULT 'yes',
      amount        INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      settled       INTEGER NOT NULL DEFAULT 0,
      payout        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS system_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vc_sessions (
      user_id    TEXT PRIMARY KEY,
      username   TEXT NOT NULL DEFAULT '',
      guild_id   TEXT NOT NULL DEFAULT '',
      joined_at  INTEGER NOT NULL,
      pending_seconds INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS vc_time (
      user_id       TEXT PRIMARY KEY,
      username      TEXT NOT NULL DEFAULT '',
      total_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_to   ON transactions(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_balance  ON accounts(balance DESC);
    CREATE INDEX IF NOT EXISTS idx_stock_positions_market ON stock_positions(market_id);
    CREATE INDEX IF NOT EXISTS idx_yearly_entries_year ON lottery_yearly_entries(year, user_id);
    CREATE INDEX IF NOT EXISTS idx_vc_time_total ON vc_time(total_seconds DESC);

    -- External API: registered third-party apps + their issued keys + per-user link grants.
    CREATE TABLE IF NOT EXISTS api_apps (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      owner_discord_id    TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      scopes              TEXT NOT NULL DEFAULT '[]',
      rate_limit_per_min  INTEGER NOT NULL DEFAULT 60,
      can_mint            INTEGER NOT NULL DEFAULT 0,
      oauth_include_discord_name INTEGER NOT NULL DEFAULT 0,
      webhook_url         TEXT DEFAULT NULL,
      webhook_secret      TEXT DEFAULT NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      disabled_at         TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id            TEXT PRIMARY KEY,
      app_id        TEXT NOT NULL REFERENCES api_apps(id),
      key_hash      TEXT NOT NULL UNIQUE,
      key_prefix    TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at  TEXT DEFAULT NULL,
      revoked_at    TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_app  ON api_keys(app_id);

    CREATE TABLE IF NOT EXISTS external_account_links (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id        TEXT NOT NULL REFERENCES api_apps(id),
      discord_id    TEXT NOT NULL,
      external_id   TEXT NOT NULL,
      external_name TEXT DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at    TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_links_discord  ON external_account_links(discord_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_links_active_app_discord
      ON external_account_links(app_id, discord_id)
      WHERE revoked_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_links_active_app_external
      ON external_account_links(app_id, external_id)
      WHERE revoked_at IS NULL;

    CREATE TABLE IF NOT EXISTS api_link_codes (
      code         TEXT PRIMARY KEY,
      app_id       TEXT NOT NULL REFERENCES api_apps(id),
      discord_id   TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT NOT NULL,
      consumed_at  TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS api_idempotency (
      key           TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      status_code   INTEGER NOT NULL DEFAULT 200,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_webhook_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id        TEXT NOT NULL REFERENCES api_apps(id),
      event_type    TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT DEFAULT NULL,
      next_retry_at TEXT DEFAULT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_events_pending ON api_webhook_events(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_app ON api_webhook_events(app_id);

    CREATE TABLE IF NOT EXISTS api_rate_limit_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id    TEXT NOT NULL REFERENCES api_apps(id),
      method    TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limit_log_app_time ON api_rate_limit_log(app_id, timestamp);
  `);

  // Migrations for existing databases (must run before creating indexes on new columns)
  migrateExternalAccountLinks();
  migrateStockMarkets();
  migrateVcSessions();
}

function migrateExternalAccountLinks() {
  try {
    const table = db.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'external_account_links'
    `).get();
    if (!table?.sql) return;

    const hasLegacyGlobalUniqueConstraints =
      table.sql.includes('UNIQUE(app_id, discord_id)') ||
      table.sql.includes('UNIQUE(app_id, external_id)');

    if (!hasLegacyGlobalUniqueConstraints) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_links_active_app_discord
        ON external_account_links(app_id, discord_id)
        WHERE revoked_at IS NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_links_active_app_external
        ON external_account_links(app_id, external_id)
        WHERE revoked_at IS NULL;
      `);
      return;
    }

    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS external_account_links__migrating;

        CREATE TABLE external_account_links__migrating (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id        TEXT NOT NULL REFERENCES api_apps(id),
          discord_id    TEXT NOT NULL,
          external_id   TEXT NOT NULL,
          external_name TEXT DEFAULT '',
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          revoked_at    TEXT DEFAULT NULL
        );

        INSERT INTO external_account_links__migrating (
          id, app_id, discord_id, external_id, external_name, created_at, revoked_at
        )
        SELECT
          id, app_id, discord_id, external_id, external_name, created_at, revoked_at
        FROM external_account_links;

        DROP TABLE external_account_links;

        ALTER TABLE external_account_links__migrating RENAME TO external_account_links;

        CREATE INDEX IF NOT EXISTS idx_links_discord
        ON external_account_links(discord_id);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_links_active_app_discord
        ON external_account_links(app_id, discord_id)
        WHERE revoked_at IS NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_links_active_app_external
        ON external_account_links(app_id, external_id)
        WHERE revoked_at IS NULL;
      `);
    })();
  } catch (err) {
    logger.error(`Failed to migrate external_account_links uniqueness: ${err.message}`);
    throw err;
  }
}

function migrateStockMarkets() {
  try {
    const cols = db.pragma('table_info(stock_markets)').map((c) => c.name);
    if (!cols.includes('message_id')) {
      db.exec("ALTER TABLE stock_markets ADD COLUMN message_id TEXT DEFAULT NULL");
    }
    if (!cols.includes('channel_id')) {
      db.exec("ALTER TABLE stock_markets ADD COLUMN channel_id TEXT DEFAULT NULL");
    }
    if (!cols.includes('star_count')) {
      db.exec("ALTER TABLE stock_markets ADD COLUMN star_count INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.includes('pool')) {
      db.exec("ALTER TABLE stock_markets ADD COLUMN pool INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.includes('market_options')) {
      db.exec('ALTER TABLE stock_markets ADD COLUMN market_options TEXT NOT NULL DEFAULT \'["yes","no"]\''  );
    }
    if (!cols.includes('guild_id')) {
      db.exec("ALTER TABLE stock_markets ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''");
    }
    // Ensure the index exists
    db.exec("CREATE INDEX IF NOT EXISTS idx_stock_markets_message ON stock_markets(message_id)");
  } catch { /* columns already exist */ }
}

function migrateVcSessions() {
  try {
    const cols = db.pragma('table_info(vc_sessions)').map((c) => c.name);
    if (!cols.includes('pending_seconds')) {
      db.exec('ALTER TABLE vc_sessions ADD COLUMN pending_seconds INTEGER NOT NULL DEFAULT 0');
    }
  } catch { /* column already exists / table created fresh */ }
}

function ensureCentralBank() {
  const existing = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(CENTRAL_BANK_USER_ID);
  if (!existing) {
    db.prepare('INSERT INTO accounts (user_id, username) VALUES (?, ?)').run(CENTRAL_BANK_USER_ID, 'Central Bank');
  }
}

function ensureDollStreet() {
  const existing = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(DOLL_STREET_USER_ID);
  if (!existing) {
    db.prepare('INSERT INTO accounts (user_id, username) VALUES (?, ?)').run(DOLL_STREET_USER_ID, 'Doll Street');
  }
}

function getDollStreetBalance() {
  return getBalance(DOLL_STREET_USER_ID);
}

function ensureMomijiCasino() {
  const existing = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(MOMIJI_CASINO_USER_ID);
  if (!existing) {
    db.prepare('INSERT INTO accounts (user_id, username, balance, total_earned) VALUES (?, ?, ?, ?)').run(MOMIJI_CASINO_USER_ID, 'Momiji Casino', 1000000, 1000000);
  }
}

function getMomijiCasinoBalance() {
  return getBalance(MOMIJI_CASINO_USER_ID);
}

function ensureBigBusiness() {
  // Legacy single-account compat — kept so old data is accessible
  const existing = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(BIG_BUSINESS_USER_ID);
  if (!existing) {
    db.prepare('INSERT INTO accounts (user_id, username) VALUES (?, ?)').run(BIG_BUSINESS_USER_ID, 'Big Business Inc');
  }
}

function ensureTaysTobacco() {
  const existing = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(TAYS_TOBACCO_USER_ID);
  if (!existing) {
    db.prepare('INSERT INTO accounts (user_id, username) VALUES (?, ?)').run(TAYS_TOBACCO_USER_ID, "Tay's Tobacco");
  }
}

function ensureTouhouMgmt() {
  const existing = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(TOUHOU_MGMT_USER_ID);
  if (!existing) {
    db.prepare('INSERT INTO accounts (user_id, username) VALUES (?, ?)').run(TOUHOU_MGMT_USER_ID, 'Touhou Management Inc');
  }
}

/**
 * Ensure a per-guild Big Business account exists.
 * @param {string} bigBusinessUserId - e.g. '__BIG_BUSINESS_1234__'
 * @param {string} displayName - e.g. 'Dogpunk Records Inc'
 */
function ensureGuildBigBusiness(bigBusinessUserId, displayName) {
  const existing = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(bigBusinessUserId);
  if (!existing) {
    // If legacy __BIG_BUSINESS__ exists and this is the first per-guild run,
    // we don't migrate automatically — the old account stays for audit purposes
    db.prepare('INSERT INTO accounts (user_id, username) VALUES (?, ?)').run(bigBusinessUserId, displayName);
    logger.info(`Created Big Business account: ${displayName} (${bigBusinessUserId})`);
  } else {
    // Update display name if changed
    db.prepare('UPDATE accounts SET username = ? WHERE user_id = ?').run(displayName, bigBusinessUserId);
  }
}

function getBigBusinessBalance(bigBusinessUserId) {
  const uid = bigBusinessUserId || BIG_BUSINESS_USER_ID;
  return getBalance(uid);
}

/**
 * Deposit matched coins into a Big Business account.
 * Records a transaction for auditing.
 * @param {number} amount
 * @param {string} note
 * @param {string} [bigBusinessUserId] - per-guild ID, falls back to legacy
 */
function depositBigBusiness(amount, note = 'matched payout', bigBusinessUserId) {
  if (amount === 0) return 0; // nothing to deposit, quietly do nothing
  if (!isPositiveCoinAmount(amount)) { // fractions / NaN / negatives would corrupt the INTEGER balance
    throw new Error(`depositBigBusiness: amount must be a positive whole number of SGC (got ${amount}).`); // throw so any enclosing transaction rolls back
  }

  const uid = bigBusinessUserId || BIG_BUSINESS_USER_ID;

  const txn = db.transaction(() => {
    const info = db.prepare(`
      UPDATE accounts
      SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, amount, uid); // credit the Big Business account and keep the result so we can see how many rows changed
    if (info.changes === 0) { // no row was updated, so the account does not exist and the coins would vanish
      throw new Error(`depositBigBusiness: account ${uid} does not exist; deposit of ${amount} SGC refused.`); // throw so the buyer's debit (outer transaction) rolls back too
    }

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (NULL, ?, ?, 'big_business_match', ?)
    `).run(uid, amount, note);
  });
  txn();

  return amount;
}

// ---------------------------------------------------------------------------
// Account helpers
// ---------------------------------------------------------------------------

function ensureAccount(userId, username = '') {
  const stmt = db.prepare(`
    INSERT INTO accounts (user_id, username)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = CASE WHEN excluded.username != '' THEN excluded.username ELSE accounts.username END,
      updated_at = datetime('now')
  `);
  stmt.run(userId, username);
}

function getBalance(userId) {
  const row = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(userId);
  return row ? row.balance : 0;
}

function getCentralBankBalance() {
  return getBalance(CENTRAL_BANK_USER_ID);
}

function getAccountInfo(userId) {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ?').get(userId) || null;
}

// ---------------------------------------------------------------------------
// Coin earning (message rewards)
// ---------------------------------------------------------------------------

function awardMessageCoins(userId, username, charCount) {
  const coins = Math.floor(charCount / COINS_PER_CHARS);
  if (!isPositiveCoinAmount(coins)) return 0; // skip zero, NaN or Infinity (e.g. a bad coinsPerChars setting of 0)

  ensureAccount(userId, username);

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE accounts
      SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(coins, coins, userId);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (NULL, ?, ?, 'reward', 'message reward')
    `).run(userId, coins);
  });
  txn();

  return coins;
}

// ---------------------------------------------------------------------------
// Coin earning (voice channel rewards)
// ---------------------------------------------------------------------------

function awardVoiceCoins(userId, username, coins) {
  if (!isPositiveCoinAmount(coins)) return 0; // only whole, positive SGC can be awarded

  ensureAccount(userId, username);

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE accounts
      SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(coins, coins, userId);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (NULL, ?, ?, 'reward', 'voice channel reward')
    `).run(userId, coins);
  });
  txn();

  return coins;
}

// ---------------------------------------------------------------------------
// Coin earning (starboard rewards)
// ---------------------------------------------------------------------------

function awardStarboardCoins(userId, username, coins) {
  if (!isPositiveCoinAmount(coins)) return 0; // only whole, positive SGC can be awarded

  ensureAccount(userId, username);

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE accounts
      SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(coins, coins, userId);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (NULL, ?, ?, 'reward', 'starboard reward')
    `).run(userId, coins);
  });
  txn();

  return coins;
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

function isLottoDay() {
  const val = db.prepare("SELECT value FROM system_state WHERE key = 'lotto_day'").get();
  if (!val) return false;
  const today = new Date().toISOString().slice(0, 10);
  return val.value === today;
}

function setLottoDay(dateStr) {
  db.prepare(`
    INSERT INTO system_state (key, value) VALUES ('lotto_day', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(dateStr);
}

function getTransferFeeRate() {
  const normalRate = _loadSetting('economy.transferFeeRate', 0.01);
  const lottoRate = _loadSetting('economy.lottoFeeRate', 0.50);
  return isLottoDay() ? lottoRate : normalRate;
}

/**
 * Transfer coins from one user to another.
 * Fee goes to central bank. Returns { success, fee, error? }.
 */
function transferCoins(fromUserId, toUserId, amount, note = '') {
  if (!isPositiveCoinAmount(amount)) return { success: false, error: 'Amount must be a positive whole number of SGC.' }; // blocks 1.5, NaN, '5', 2**60 etc.
  if (fromUserId === toUserId) return { success: false, error: 'Cannot send coins to yourself.' };

  const feeRate = getTransferFeeRate();
  const fee = Math.max(1, Math.ceil(amount * feeRate));
  const totalCost = amount + fee;

  const result = db.transaction(() => {
    const sender = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(fromUserId);
    if (!sender || sender.balance < totalCost) {
      return { success: false, error: `Insufficient balance. You need ${totalCost} SGC (${amount} + ${fee} fee) but have ${sender?.balance ?? 0}.` };
    }

    // Deduct from sender
    db.prepare(`
      UPDATE accounts SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(totalCost, totalCost, fromUserId);

    // Credit recipient
    ensureAccount(toUserId);
    db.prepare(`
      UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, amount, toUserId);

    // Fee to central bank
    db.prepare(`
      UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(fee, fee, CENTRAL_BANK_USER_ID);

    // Record transaction
    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, fee, type, note)
      VALUES (?, ?, ?, ?, 'transfer', ?)
    `).run(fromUserId, toUserId, amount, fee, note);

    return { success: true, fee };
  })();

  return result;
}

/**
 * Central bank withdrawal — only for BANK_OWNER_ID.
 */
function withdrawCentralBank(requesterId, toUserId, amount, note = '') {
  if (requesterId !== BANK_OWNER_ID) {
    return { success: false, error: 'Only the bank owner can withdraw from the central bank.' };
  }
  if (!isPositiveCoinAmount(amount)) return { success: false, error: 'Amount must be a positive whole number of SGC.' }; // whole SGC only

  const result = db.transaction(() => {
    const bank = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(CENTRAL_BANK_USER_ID);
    if (!bank || bank.balance < amount) {
      return { success: false, error: `Central bank only has ${bank?.balance ?? 0} SGC.` };
    }

    db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, CENTRAL_BANK_USER_ID);

    ensureAccount(toUserId);
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, amount, toUserId);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, fee, type, note)
      VALUES (?, ?, ?, 0, 'bank_withdrawal', ?)
    `).run(CENTRAL_BANK_USER_ID, toUserId, amount, note);

    return { success: true };
  })();

  return result;
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

function getTopHolders(limit = 10) {
  return db.prepare(`
    SELECT user_id, username, balance, total_earned
    FROM accounts
    WHERE user_id NOT GLOB '__*__'
    ORDER BY balance DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get all accounts with pagination. Includes system accounts.
 */
function getAllAccounts(limit = 100, offset = 0) {
  const rows = db.prepare(`
    SELECT user_id, username, balance, total_earned, total_spent, created_at, updated_at
    FROM accounts
    ORDER BY balance DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  const countRow = db.prepare('SELECT COUNT(*) as total FROM accounts').get();
  return { accounts: rows, total: countRow.total };
}

/**
 * Search accounts by username or user_id (partial match).
 */
function searchAccounts(query, limit = 50) {
  const pattern = `%${query}%`;
  return db.prepare(`
    SELECT user_id, username, balance, total_earned, total_spent, created_at, updated_at
    FROM accounts
    WHERE user_id LIKE ? OR username LIKE ?
    ORDER BY balance DESC
    LIMIT ?
  `).all(pattern, pattern, limit);
}

/**
 * Get recent transactions for a user (as sender or recipient).
 */
function getUserTransactions(userId, limit = 50) {
  return db.prepare(`
    SELECT id, from_user_id, to_user_id, amount, fee, type, note, created_at
    FROM transactions
    WHERE from_user_id = ? OR to_user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, userId, limit);
}

// ---------------------------------------------------------------------------
// Weekly Lottery (free entry, random holder gets 50 SGC from mint)
// ---------------------------------------------------------------------------

function runWeeklyLottery() {
  // Fix-list #31: only real people can win. Every system account (__CENTRAL_BANK__, __DOLL_STREET__, the
  // __LUMI_*__ accounts, per-guild __BIG_BUSINESS_*__ ...) is named __LIKE_THIS__, so GLOB '__*__' skips them all.
  const winners = db.prepare(`
    SELECT user_id, username FROM accounts
    WHERE user_id NOT GLOB '__*__' AND balance > 0
    ORDER BY RANDOM() LIMIT 1
  `).all(); // one random real holder with a positive balance

  if (winners.length === 0) return null;

  const winner = winners[0];
  const prize = Math.floor(_loadSetting('economy.weeklyLotteryPrize', 50)); // panel setting may be fractional, balances are whole SGC
  if (!isPositiveCoinAmount(prize)) return null; // a zero/broken prize setting means no draw

  db.transaction(() => {
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(prize, prize, winner.user_id);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (NULL, ?, ?, 'weekly_lottery', 'Weekly lottery winner')
    `).run(winner.user_id, prize);
  })();

  return { userId: winner.user_id, username: winner.username, prize };
}

// ---------------------------------------------------------------------------
// Yearly Raffle (paid entry: 50 SGC, winner gets 25% of central reserve)
// ---------------------------------------------------------------------------

function buyYearlyRaffleTicket(userId, username) {
  const cost = Math.floor(_loadSetting('economy.yearlyRaffleCost', 50)); // whole SGC ticket price even if the panel value is fractional
  if (!isPositiveCoinAmount(cost)) return { success: false, error: 'Raffle tickets are not on sale right now.' }; // bad setting, refuse instead of writing junk
  const currentYear = new Date().getFullYear();

  ensureAccount(userId, username);

  const result = db.transaction(() => {
    const acct = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(userId);
    if (!acct || acct.balance < cost) {
      return { success: false, error: `You need ${cost} SGC to buy a raffle ticket. You have ${acct?.balance ?? 0}.` };
    }

    // Deduct from user, add to central bank
    db.prepare('UPDATE accounts SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(cost, cost, userId);
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(cost, cost, CENTRAL_BANK_USER_ID);

    db.prepare('INSERT INTO lottery_yearly_entries (user_id, year) VALUES (?, ?)').run(userId, currentYear);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, 'yearly_raffle_ticket', ?)
    `).run(userId, CENTRAL_BANK_USER_ID, cost, `Yearly raffle ticket ${currentYear}`);

    const ticketCount = db.prepare('SELECT COUNT(*) as cnt FROM lottery_yearly_entries WHERE user_id = ? AND year = ?').get(userId, currentYear).cnt;
    return { success: true, ticketCount };
  })();

  return result;
}

function runYearlyRaffle() {
  const currentYear = new Date().getFullYear();

  const entries = db.prepare('SELECT DISTINCT user_id FROM lottery_yearly_entries WHERE year = ?').all(currentYear);
  if (entries.length === 0) return null;

  // Pick weighted by number of tickets
  const allTickets = db.prepare('SELECT user_id FROM lottery_yearly_entries WHERE year = ?').all(currentYear);
  const winnerTicket = allTickets[Math.floor(Math.random() * allTickets.length)];

  const bank = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(CENTRAL_BANK_USER_ID);
  const rafflePercent = _loadSetting('economy.yearlyRafflePercent', 0.25);
  const prize = Math.floor((bank?.balance ?? 0) * rafflePercent);
  if (prize <= 0) return null;

  db.transaction(() => {
    db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(prize, CENTRAL_BANK_USER_ID);
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(prize, prize, winnerTicket.user_id);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, 'yearly_raffle_win', ?)
    `).run(CENTRAL_BANK_USER_ID, winnerTicket.user_id, prize, `Yearly raffle winner ${currentYear}`);
  })();

  const winner = db.prepare('SELECT username FROM accounts WHERE user_id = ?').get(winnerTicket.user_id);
  return { userId: winnerTicket.user_id, username: winner?.username ?? '', prize, totalEntries: allTickets.length };
}

// ---------------------------------------------------------------------------
// LumiStocks
// ---------------------------------------------------------------------------

/**
 * Parse and validate market options from a comma-separated string or array.
 * Returns a normalized array of 2-5 trimmed option labels.
 * Falls back to ['yes','no'] if input is invalid.
 */
function parseMarketOptions(raw) {
  if (!raw) return ['yes', 'no'];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  const cleaned = arr.map((o) => o.trim()).filter(Boolean);
  if (cleaned.length < 2 || cleaned.length > 5) return null; // signals bad input
  // Check for duplicates (case-insensitive)
  const seen = new Set();
  for (const o of cleaned) {
    const key = o.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return cleaned;
}

/**
 * Get the options array for a market. Falls back to ['yes','no'] for legacy markets.
 */
function getMarketOptions(market) {
  if (!market) return ['yes', 'no'];
  try {
    const opts = JSON.parse(market.market_options);
    if (Array.isArray(opts) && opts.length >= 2) return opts;
  } catch { /* fallback */ }
  return ['yes', 'no'];
}

/** Returns true if the market is a standard yes/no market. */
function isYesNoMarket(market) {
  const opts = getMarketOptions(market);
  return opts.length === 2 && opts[0].toLowerCase() === 'yes' && opts[1].toLowerCase() === 'no';
}

/**
 * Match user input (name or 1-indexed number) to one of the market options.
 * Returns the matched option string or null.
 */
function matchMarketOption(market, input) {
  const options = getMarketOptions(market);
  const norm = input.trim().toLowerCase();
  // Try exact name match (case-insensitive)
  const byName = options.find((o) => o.toLowerCase() === norm);
  if (byName) return byName;
  // Try numeric index (1-based)
  const idx = parseInt(norm, 10);
  if (idx >= 1 && idx <= options.length) return options[idx - 1];
  return null;
}

function createMarket(creatorId, title, description, optionsRaw = null, { adminAutoLive = false, guildId = '' } = {}) {
  const options = optionsRaw ? parseMarketOptions(optionsRaw) : ['yes', 'no'];
  if (!options) {
    return { success: false, error: 'Options must be 2-5 unique choices, comma-separated.' };
  }

  const initialStatus = adminAutoLive ? 'open' : 'pending';
  const initialPool = adminAutoLive ? 6 : 0;
  const initialStars = adminAutoLive ? ADMIN_AUTO_STARS : 0;

  const result = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO stock_markets (title, description, created_by, status, market_options, star_count, pool, guild_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description || '', creatorId, initialStatus, JSON.stringify(options), initialStars, initialPool, guildId);

    if (adminAutoLive && initialPool > 0) {
      // Seed pool from Central Bank
      db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(initialPool, CENTRAL_BANK_USER_ID);
      db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(initialPool, initialPool, DOLL_STREET_USER_ID);
      db.prepare(`
        INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
        VALUES (?, ?, ?, 'admin_market_seed', ?)
      `).run(CENTRAL_BANK_USER_ID, DOLL_STREET_USER_ID, initialPool, `Admin auto-seed for market #${info.lastInsertRowid}`);
    }

    return { success: true, marketId: info.lastInsertRowid, options, adminAutoLive };
  })();

  return result;
}

function setMarketMessage(marketId, messageId, channelId) {
  db.prepare('UPDATE stock_markets SET message_id = ?, channel_id = ? WHERE id = ?')
    .run(messageId, channelId, marketId);
}

function getMarketByMessageId(messageId) {
  return db.prepare('SELECT * FROM stock_markets WHERE message_id = ?').get(messageId) || null;
}

function getPendingMarkets() {
  return db.prepare("SELECT * FROM stock_markets WHERE status = 'pending' ORDER BY created_at DESC").all();
}

/**
 * Charge a user 3 SGC for star-reacting a pending market.
 * Coins go into the market pool. Returns { success, newStarCount, activated, error? }.
 */
function chargeStarReact(userId, username, marketId) {
  const cost = 3;
  ensureAccount(userId, username);

  const result = db.transaction(() => {
    const market = db.prepare('SELECT * FROM stock_markets WHERE id = ?').get(marketId);
    if (!market || market.status !== 'pending') {
      return { success: false, error: 'Market is not pending activation.' };
    }

    const acct = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(userId);
    if (!acct || acct.balance < cost) {
      return { success: false, error: `You need ${cost} SGC to vote on a stock. You have ${acct?.balance ?? 0}.` };
    }

    // Deduct from user
    db.prepare('UPDATE accounts SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(cost, cost, userId);

    // Split: 2/3 to market pool (held by Doll Street), 1/3 stays with Doll Street
    const poolShare = Math.floor(cost * 2 / 3) || 1; // at least 1 to pool
    const dollStreetShare = cost - poolShare;
    const newStarCount = market.star_count + 1;
    const newPool = market.pool + poolShare;
    db.prepare('UPDATE stock_markets SET star_count = ?, pool = ? WHERE id = ?')
      .run(newStarCount, newPool, marketId);

    // Full cost goes to Doll Street account (pool portion is tracked separately on the market)
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(cost, cost, DOLL_STREET_USER_ID);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, 'stock_activation', ?)
    `).run(userId, DOLL_STREET_USER_ID, cost, `Star vote for market #${marketId} (pool: ${poolShare}, house: ${dollStreetShare})`);

    const activated = newStarCount >= 3;
    if (activated) {
      db.prepare("UPDATE stock_markets SET status = 'open' WHERE id = ?")
        .run(marketId);
    }

    return { success: true, newStarCount, activated };
  })();

  return result;
}

function getOpenMarkets() {
  return db.prepare("SELECT * FROM stock_markets WHERE status = 'open' ORDER BY created_at DESC").all();
}

function getMarket(marketId) {
  return db.prepare('SELECT * FROM stock_markets WHERE id = ?').get(marketId) || null;
}

function buyStockPosition(userId, username, marketId, side, amount) {
  if (!isPositiveCoinAmount(amount)) return { success: false, error: 'Amount must be a positive whole number of SGC.' }; // whole SGC only

  ensureAccount(userId, username);

  const result = db.transaction(() => {
    const market = db.prepare('SELECT * FROM stock_markets WHERE id = ?').get(marketId);
    if (!market || market.status !== 'open') {
      return { success: false, error: 'Market is not open.' };
    }

    // Validate side against market options
    const matched = matchMarketOption(market, side);
    if (!matched) {
      const options = getMarketOptions(market);
      return { success: false, error: `Invalid option "${side}". Choose from: ${options.map((o, i) => `${i + 1}. ${o}`).join(', ')}` };
    }

    const acct = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(userId);
    if (!acct || acct.balance < amount) {
      return { success: false, error: `Insufficient balance. You have ${acct?.balance ?? 0} SGC.` };
    }

    // Deduct from user, add to Doll Street (holds the prediction market pot)
    db.prepare('UPDATE accounts SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, amount, userId);
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, amount, DOLL_STREET_USER_ID);

    // Also track in market pool
    db.prepare('UPDATE stock_markets SET pool = pool + ? WHERE id = ?')
      .run(amount, marketId);

    db.prepare('INSERT INTO stock_positions (market_id, user_id, side, amount) VALUES (?, ?, ?, ?)')
      .run(marketId, userId, matched, amount);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, 'stock_buy', ?)
    `).run(userId, DOLL_STREET_USER_ID, amount, `Buy ${matched} on market #${marketId}`);

    return { success: true, matchedSide: matched };
  })();

  return result;
}

function resolveMarket(requesterId, marketId, outcome, { isAuthorized = false } = {}) {
  if (!isAuthorized && requesterId !== BANK_OWNER_ID) {
    return { success: false, error: 'Only economy admins can resolve markets.' };
  }

  const settledUsers = [];
  let totalPool = 0;
  let winnerCount = 0;
  let matchedOutcome = null;

  db.transaction(() => {
    const market = db.prepare('SELECT * FROM stock_markets WHERE id = ?').get(marketId);
    if (!market || market.status !== 'open') {
      throw new Error('Market is not open.');
    }

    // Validate outcome against market options
    matchedOutcome = matchMarketOption(market, outcome);
    if (!matchedOutcome) {
      const options = getMarketOptions(market);
      throw new Error(`Invalid outcome "${outcome}". Choose from: ${options.map((o, i) => `${i + 1}. ${o}`).join(', ')}`);
    }

    // market.pool already includes activation pool shares + all bet amounts
    totalPool = market.pool || 0;

    db.prepare(`
      UPDATE stock_markets
      SET status = 'resolved', outcome = ?, payout_mult = NULL, resolved_at = datetime('now')
      WHERE id = ?
    `).run(matchedOutcome, marketId);

    // Find winners
    const winners = db.prepare('SELECT * FROM stock_positions WHERE market_id = ? AND side = ? AND settled = 0')
      .all(marketId, matchedOutcome);

    winnerCount = winners.length;

    if (winnerCount > 0 && totalPool > 0) {
      const totalWinningStake = winners.reduce((sum, pos) => sum + pos.amount, 0);

      if (totalWinningStake > 0) {
        const allocations = winners.map((pos) => {
          const rawPayout = (totalPool * pos.amount) / totalWinningStake;
          const basePayout = Math.floor(rawPayout);
          return {
            id: pos.id,
            userId: pos.user_id,
            invested: pos.amount,
            payout: basePayout,
            fractional: rawPayout - basePayout,
          };
        });

        const distributedBase = allocations.reduce((sum, item) => sum + item.payout, 0);
        let remainder = totalPool - distributedBase;

        if (remainder > 0) {
          allocations.sort((a, b) => {
            if (b.fractional !== a.fractional) return b.fractional - a.fractional;
            if (b.invested !== a.invested) return b.invested - a.invested;
            return a.id - b.id;
          });

          for (let i = 0; i < allocations.length && remainder > 0; i += 1) {
            allocations[i].payout += 1;
            remainder -= 1;
          }
        }

        for (const allocation of allocations) {
          if (allocation.payout > 0) {
            // Pay from Doll Street (which holds prediction market funds)
            db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
              .run(allocation.payout, DOLL_STREET_USER_ID);
            db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
              .run(allocation.payout, allocation.payout, allocation.userId);

            db.prepare(`
              INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
              VALUES (?, ?, ?, 'stock_payout', ?)
            `).run(DOLL_STREET_USER_ID, allocation.userId, allocation.payout, `Payout for market #${marketId}`);
          }

          db.prepare('UPDATE stock_positions SET settled = 1, payout = ? WHERE id = ?').run(allocation.payout, allocation.id);
          settledUsers.push({ userId: allocation.userId, invested: allocation.invested, payout: allocation.payout });
        }
      }
    }

    // Mark losers as settled with 0 payout
    db.prepare("UPDATE stock_positions SET settled = 1, payout = 0 WHERE market_id = ? AND side != ? AND settled = 0")
      .run(marketId, matchedOutcome);
  })();

  return { success: true, settledUsers, pool: totalPool, winnerCount, matchedOutcome };
}

// ---------------------------------------------------------------------------
// Casino games (generic bet / payout for Momiji Casino)
// ---------------------------------------------------------------------------

/**
 * Deduct a casino bet from the user and move it to Momiji Casino.
 * @param {string} gameType - e.g. 'pachinko', 'blackjack'
 * Returns { success, error? }.
 */
function placeCasinoBet(userId, username, amount, gameType = 'casino') {
  if (!isPositiveCoinAmount(amount)) return { success: false, error: 'Bet must be a positive whole number of SGC.' }; // whole SGC bets only

  ensureAccount(userId, username);

  const result = db.transaction(() => {
    const acct = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(userId);
    if (!acct || acct.balance < amount) {
      return { success: false, error: `Insufficient balance. You have ${acct?.balance ?? 0} SGC but need ${amount}.` };
    }

    db.prepare('UPDATE accounts SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, amount, userId);
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, amount, MOMIJI_CASINO_USER_ID);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, MOMIJI_CASINO_USER_ID, amount, `${gameType}_bet`, `${gameType} bet`);

    return { success: true };
  })();

  return result;
}

/**
 * Pay out casino winnings from Momiji Casino to the user.
 * @param {string} gameType - e.g. 'pachinko', 'blackjack'
 */
function payCasinoPayout(userId, amount, gameType = 'casino') {
  if (amount === 0) return; // a losing hand pays nothing, nothing to do
  if (!isPositiveCoinAmount(amount)) { // fractional / NaN / negative payouts would corrupt balances
    logger.warn(`payCasinoPayout: refused non-integer or invalid ${gameType} payout of ${amount} SGC to ${userId}.`); // log it so a buggy game is noticed
    return; // keep the old "returns nothing" contract so game code doesn't crash
  }

  db.transaction(() => {
    db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, MOMIJI_CASINO_USER_ID);
    // Audit #21: payouts are allowed to push the casino into debt (we never fail a win mid-game), but say so loudly
    const casino = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(MOMIJI_CASINO_USER_ID); // read the casino balance after paying
    if (casino && casino.balance < 0) { // the house is now in the red, so this payout created SGC out of nothing
      logger.warn(`Momiji Casino balance is negative (${casino.balance} SGC) after a ${amount} SGC ${gameType} payout to ${userId}.`); // warn the admins
    }
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(amount, amount, userId);

    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(MOMIJI_CASINO_USER_ID, userId, amount, `${gameType}_win`, `${gameType} payout`);
  })();
}

/** Backwards-compatible wrapper — calls placeCasinoBet with gameType='pachinko'. */
function placePachinkoBet(userId, username, amount) {
  return placeCasinoBet(userId, username, amount, 'pachinko');
}

/** Backwards-compatible wrapper — calls payCasinoPayout with gameType='pachinko'. */
function payPachinkoPayout(userId, amount) {
  return payCasinoPayout(userId, amount, 'pachinko');
}

// ---------------------------------------------------------------------------
// Admin balance adjustment
// ---------------------------------------------------------------------------

/**
 * Directly adjust a user's balance by a signed amount.
 * Positive = give coins, negative = take coins.
 * Returns { success, newBalance, error? }.
 */
function adjustBalance(userId, amount, note = '') {
  if (!Number.isSafeInteger(amount)) return { success: false, error: 'Amount must be a whole number of SGC.' }; // blocks 1.5, NaN, Infinity, '5', 2**60
  if (amount === 0) return { success: false, error: 'Amount cannot be zero.' };

  const result = db.transaction(() => {
    const acct = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(userId);
    if (!acct) return { success: false, error: 'Account not found.' };

    if (amount < 0 && acct.balance < Math.abs(amount)) {
      return { success: false, error: `User only has ${acct.balance} SGC, cannot remove ${Math.abs(amount)}.` };
    }

    if (amount > 0) {
      db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(amount, amount, userId);
    } else {
      db.prepare('UPDATE accounts SET balance = balance + ?, total_spent = total_spent + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(amount, Math.abs(amount), userId);
    }

    const type = amount > 0 ? 'admin_give' : 'admin_take';
    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, ?, ?)
    `).run('__ADMIN__', userId, Math.abs(amount), type, note);

    const updated = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(userId);
    return { success: true, newBalance: updated.balance };
  })();

  return result;
}

/**
 * Apply several signed balance changes as ONE all-or-nothing transaction.
 * Use this for "debit the buyer, credit the seller and the house" so a failed
 * debit can never leave the credits behind (audit #12, which minted coins).
 * @param {{ userId: string, amount: number, note?: string }[]} moves
 * @returns {{ success: boolean, results?: object[], error?: string }}
 */
function adjustBalancesAtomic(moves) {
  if (!Array.isArray(moves) || moves.length === 0) { // nothing to do is treated as a caller bug
    return { success: false, error: 'No balance changes were given.' };
  }
  try { // any failed step throws, which rolls back every earlier step
    const results = db.transaction(() => moves.map((move) => { // run each move inside the same transaction
      const r = adjustBalance(move.userId, move.amount, move.note || ''); // signed change for one account
      if (!r.success) throw new Error(r.error); // e.g. "User only has 3 SGC" -> undo everything
      return r; // keep the new balance for the caller
    }))();
    return { success: true, results }; // all moves committed together
  } catch (error) {
    return { success: false, error: error.message }; // nothing was committed
  }
}

/**
 * Take payment first (atomically), then run a SYNCHRONOUS action that lives in
 * another database (Touhou / cigarette DB files). If the action fails or
 * throws, the payment is reversed. Because there is no `await` in between, no
 * other bot code can run between the payment, the action and the refund.
 * @param {{ userId: string, amount: number, note?: string }[]} moves - signed balance changes
 * @param {() => { success: boolean, error?: string }} action - the item move to perform
 * @returns {object} the action's result, or { success:false, error, refunded }
 */
function payThenRun(moves, action) {
  const payment = adjustBalancesAtomic(moves); // debit + credits all-or-nothing
  if (!payment.success) return { success: false, error: payment.error, paid: false }; // couldn't pay: nothing happened

  let outcome; // whatever the action returns
  try {
    outcome = action(); // move the item in the other DB
  } catch (error) {
    logger.error('payThenRun: action threw after payment; refunding.', error.message); // keep the real reason for admins
    outcome = { success: false, error: 'Something went wrong, please try again.' }; // friendly message for players
  }

  if (!outcome || !outcome.success) { // the item didn't move, so undo the payment
    const reversal = moves.slice().reverse().map((move) => ({ // undo in reverse order (take back credits first)
      userId: move.userId, // same account
      amount: -move.amount, // opposite sign
      note: `Refund: ${move.note || ''}`, // mark it as a refund in the ledger
    }));
    const refund = adjustBalancesAtomic(reversal); // all-or-nothing refund
    if (!refund.success) logger.error(`payThenRun: REFUND FAILED (${refund.error}); moves=${JSON.stringify(moves)}`); // needs an admin to fix by hand
    return { ...(outcome || {}), success: false, refunded: refund.success }; // report failure + whether we refunded
  }

  return outcome; // success: payment kept and item moved
}

// ---------------------------------------------------------------------------
// Tax collection
// ---------------------------------------------------------------------------

/**
 * Collect monthly taxes and deposit into Central Bank.
 * - 1% of all user wallet balances over 100 SGC
 * - 5% of all bank account balances over 10,000 SGC
 * - 10% of all bank account balances over 1,000,000 SGC
 * The highest applicable tier is used (not stacked).
 * System accounts (Central Bank, Doll Street, Momiji Casino) are excluded.
 * Returns { totalTaxed, userCount, details[] }.
 */
function collectMonthlyTaxes() {
  // Big Business accounts (legacy + per-guild) are deliberately NOT excluded — they get taxed like normal citizens
  // Lumi-Town's accounts are excluded too: taxing them would drain the Lumi Holdings reserve below its floor.
  const systemAccounts = [CENTRAL_BANK_USER_ID, DOLL_STREET_USER_ID, MOMIJI_CASINO_USER_ID, ...LUMI_ACCOUNT_IDS]; // never taxed

  // Load tax settings (configurable via web panel)
  const tier1Threshold = _loadSetting('tax.tier1Threshold', 100);
  const tier1Rate = _loadSetting('tax.tier1Rate', 0.01);
  const tier2Threshold = _loadSetting('tax.tier2Threshold', 10000);
  const tier2Rate = _loadSetting('tax.tier2Rate', 0.05);
  const tier3Threshold = _loadSetting('tax.tier3Threshold', 1000000);
  const tier3Rate = _loadSetting('tax.tier3Rate', 0.10);

  const result = db.transaction(() => {
    const accounts = db.prepare(`
      SELECT user_id, username, balance FROM accounts
      WHERE user_id NOT IN (${systemAccounts.map(() => '?').join(',')})
        AND balance > ?
    `).all(...systemAccounts, tier1Threshold);

    let totalTaxed = 0;
    const details = [];

    for (const acct of accounts) {
      let rate = 0;
      let tierLabel = '';
      if (acct.balance > tier3Threshold) {
        rate = tier3Rate;
        tierLabel = `${(tier3Rate * 100).toFixed(0)}% (over ${(tier3Threshold / 1000).toFixed(0)}K)`;
      } else if (acct.balance > tier2Threshold) {
        rate = tier2Rate;
        tierLabel = `${(tier2Rate * 100).toFixed(0)}% (over ${(tier2Threshold / 1000).toFixed(0)}K)`;
      } else {
        rate = tier1Rate;
        tierLabel = `${(tier1Rate * 100).toFixed(0)}% (over ${tier1Threshold})`;
      }

      const tax = Math.max(1, Math.floor(acct.balance * rate));

      db.prepare('UPDATE accounts SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(tax, tax, acct.user_id);
      db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(tax, tax, CENTRAL_BANK_USER_ID);
      db.prepare(`
        INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
        VALUES (?, ?, ?, 'monthly_tax', ?)
      `).run(acct.user_id, CENTRAL_BANK_USER_ID, tax, `Monthly tax: ${tierLabel}`);

      totalTaxed += tax;
      details.push({ userId: acct.user_id, username: acct.username, balance: acct.balance, tax, tierLabel });
    }

    return { totalTaxed, userCount: details.length, details };
  })();

  return result;
}

/**
 * Daily casino reserve deposit: Momiji Casino deposits 10% of all coins
 * over 1,000,000 into the Central Bank.
 * Returns { deposited } or null if casino has <= 1M.
 */
function casinoDailyReserveDeposit() {
  const reserveThreshold = _loadSetting('casino.reserveThreshold', 1000000);
  const reserveRate = _loadSetting('casino.reserveRate', 0.10);

  const result = db.transaction(() => {
    const casino = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(MOMIJI_CASINO_USER_ID);
    if (!casino || casino.balance <= reserveThreshold) return null;

    const excess = casino.balance - reserveThreshold;
    const deposit = Math.max(1, Math.floor(excess * reserveRate));

    db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(deposit, MOMIJI_CASINO_USER_ID);
    db.prepare('UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(deposit, deposit, CENTRAL_BANK_USER_ID);
    db.prepare(`
      INSERT INTO transactions (from_user_id, to_user_id, amount, type, note)
      VALUES (?, ?, ?, 'casino_reserve_deposit', ?)
    `).run(MOMIJI_CASINO_USER_ID, CENTRAL_BANK_USER_ID, deposit, `Daily casino reserve deposit (${(reserveRate * 100).toFixed(0)}% over ${(reserveThreshold / 1000).toFixed(0)}K)`);

    return { deposited: deposit };
  })();

  return result;
}

// ---------------------------------------------------------------------------
// System state helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// VC session persistence
// ---------------------------------------------------------------------------

function saveVcSession(userId, username, guildId, joinedAt, pendingSeconds = 0) {
  db.prepare(`
    INSERT INTO vc_sessions (user_id, username, guild_id, joined_at, pending_seconds)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username  = excluded.username,
      guild_id  = excluded.guild_id,
      joined_at = excluded.joined_at,
      pending_seconds = excluded.pending_seconds
  `).run(userId, username, guildId, joinedAt, Math.max(0, Math.floor(Number(pendingSeconds) || 0)));
}

function removeVcSession(userId) {
  db.prepare('DELETE FROM vc_sessions WHERE user_id = ?').run(userId);
}

function getAllVcSessions() {
  return db.prepare('SELECT * FROM vc_sessions').all();
}

function clearAllVcSessions() {
  db.prepare('DELETE FROM vc_sessions').run();
}

// ---------------------------------------------------------------------------
// VC cumulative time tracking
// ---------------------------------------------------------------------------

function addVcTime(userId, username, seconds) {
  if (seconds <= 0) return;
  db.prepare(`
    INSERT INTO vc_time (user_id, username, total_seconds, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      username      = excluded.username,
      total_seconds = vc_time.total_seconds + excluded.total_seconds,
      updated_at    = datetime('now')
  `).run(userId, username, seconds);
}

function getVcTimeLeaderboard(limit = 20) {
  return db.prepare(
    'SELECT user_id, username, total_seconds FROM vc_time ORDER BY total_seconds DESC LIMIT ?'
  ).all(limit);
}

function getVcTimeForUser(userId) {
  const row = db.prepare('SELECT total_seconds FROM vc_time WHERE user_id = ?').get(userId);
  return row ? row.total_seconds : 0;
}

// ---------------------------------------------------------------------------
// Strict coin moves (used by the Lumi games: src/lumi/sgc.js and treasury.js)
// ---------------------------------------------------------------------------

/** Thrown by moveCoins when a move is refused; nothing has been written when it is thrown. */
class CoinMoveError extends Error {
  constructor(message, code, extra = {}) {
    super(message);                 // human-readable reason
    this.name = 'CoinMoveError';    // shows up in logs
    this.code = code;               // 'bad_amount' | 'bad_type' | 'same_account' | 'no_sender' | 'no_receiver' | 'insufficient_funds'
    Object.assign(this, extra);     // e.g. { need, have } for insufficient_funds
  }
}

/** True for a system account id (anything shaped like __NAME__), e.g. __CENTRAL_BANK__ or __LUMI_TOWN_BANK__. */
function isSystemAccountId(userId) {
  return /^__.+__$/u.test(String(userId || '')); // same rule as the leaderboard's GLOB '__*__'
}

/**
 * Move `amount` whole SGC from one existing account to another, with no fee, as ONE all-or-nothing step.
 * Unlike adjustBalance it never logs as admin, and unlike transferCoins it takes no 1% fee.
 * The sender's balance is checked inside the transaction for EVERY account, system accounts included.
 * Throws CoinMoveError when refused (so an enclosing db.transaction rolls back), otherwise writes one
 * `transactions` row with the given `type` and returns { fromBalance, toBalance }.
 * Safe to call inside an outer db.transaction (better-sqlite3 turns the inner one into a savepoint).
 */
function moveCoins(fromUserId, toUserId, amount, type, note = '') {
  if (!isPositiveCoinAmount(amount)) { // whole, exact, above zero
    throw new CoinMoveError(`Amount must be a positive whole number of SGC (got ${amount}).`, 'bad_amount'); // refuse junk amounts
  }
  if (!type || typeof type !== 'string') throw new CoinMoveError('A ledger type is required.', 'bad_type'); // every move is labelled
  if (fromUserId === toUserId) throw new CoinMoveError('Cannot move coins to the same account.', 'same_account'); // a no-op would still log
  return db.transaction(() => {
    const sender = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(fromUserId); // read INSIDE the transaction
    if (!sender) throw new CoinMoveError(`Account ${fromUserId} does not exist.`, 'no_sender'); // nothing to take from
    const receiver = db.prepare('SELECT balance FROM accounts WHERE user_id = ?').get(toUserId); // must exist so coins can't vanish
    if (!receiver) throw new CoinMoveError(`Account ${toUserId} does not exist.`, 'no_receiver'); // refuse instead of losing coins
    if (sender.balance < amount) { // not enough: refuse, nothing written
      throw new CoinMoveError(`Not enough SGC: need ${amount}, have ${sender.balance}.`, 'insufficient_funds', { need: amount, have: sender.balance });
    }
    db.prepare(`UPDATE accounts SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime('now') WHERE user_id = ?`)
      .run(amount, amount, fromUserId); // take from the sender
    db.prepare(`UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now') WHERE user_id = ?`)
      .run(amount, amount, toUserId); // give to the receiver
    db.prepare('INSERT INTO transactions (from_user_id, to_user_id, amount, fee, type, note) VALUES (?, ?, ?, 0, ?, ?)')
      .run(fromUserId, toUserId, amount, type, String(note || '')); // one ledger row with the caller's type
    return { fromBalance: sender.balance - amount, toBalance: receiver.balance + amount }; // new balances for the caller
  })();
}

/** Create any missing Lumi-Town system account (balance 0). Existing accounts keep their name and balance. */
function ensureLumiAccounts() {
  const insert = db.prepare('INSERT OR IGNORE INTO accounts (user_id, username) VALUES (?, ?)'); // no-op when it exists
  for (const acct of LUMI_ACCOUNTS) insert.run(acct.id, acct.name); // all nine accounts
}

// ---------------------------------------------------------------------------
// System state helpers
// ---------------------------------------------------------------------------

function getSystemState(key) {
  const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSystemState(key, value) {
  db.prepare(`
    INSERT INTO system_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function deleteSystemState(key) {
  db.prepare('DELETE FROM system_state WHERE key = ?').run(key);
}

function getEconomyDb() {
  return db;
}

module.exports = {
  CENTRAL_BANK_USER_ID,
  DOLL_STREET_USER_ID,
  MOMIJI_CASINO_USER_ID,
  BIG_BUSINESS_USER_ID,
  TAYS_TOBACCO_USER_ID,
  TOUHOU_MGMT_USER_ID,
  LUMI_TOWN_BANK_USER_ID,   // Lumi-Town Bank (pays every Lumi prize)
  LUMI_HOLDINGS_USER_ID,    // Lumi Holdings Inc. (reserve, LUMI treasury)
  LUMI_SNACKS_USER_ID,      // Lumi's Snack Stand
  LUMI_BOUTIQUE_USER_ID,    // Lumi's Boutique
  LUMI_CAPSULES_USER_ID,    // Moon Capsule Co.
  LUMI_OUTFITTERS_USER_ID,  // Dungeon Outfitters
  LUMI_NURSERY_USER_ID,     // Starpowder Nursery
  LUMI_ARCADE_USER_ID,      // Lumi Arcade
  LUMI_REALTY_USER_ID,      // Lumi City Realty
  LUMI_ACCOUNTS,            // [{ id, name }] of all nine
  LUMI_ACCOUNT_IDS,         // just their ids
  ensureLumiAccounts,       // create any missing Lumi account
  moveCoins,                // strict fee-free move that throws CoinMoveError
  CoinMoveError,            // the error moveCoins throws
  isSystemAccountId,        // true for __NAME__ ids
  BANK_OWNER_ID,
  COINS_PER_CHARS,
  initEconomyStore,
  closeEconomyStore,
  ensureAccount,
  ensureGuildBigBusiness,
  getBalance,
  getCentralBankBalance,
  getDollStreetBalance,
  getMomijiCasinoBalance,
  getBigBusinessBalance,
  depositBigBusiness,
  getAccountInfo,
  awardMessageCoins,
  awardVoiceCoins,
  awardStarboardCoins,
  isLottoDay,
  setLottoDay,
  getTransferFeeRate,
  transferCoins,
  withdrawCentralBank,
  getTopHolders,
  getAllAccounts,
  searchAccounts,
  getUserTransactions,
  runWeeklyLottery,
  buyYearlyRaffleTicket,
  runYearlyRaffle,
  createMarket,
  setMarketMessage,
  getMarketByMessageId,
  getOpenMarkets,
  getPendingMarkets,
  getMarket,
  getMarketOptions,
  isYesNoMarket,
  matchMarketOption,
  chargeStarReact,
  buyStockPosition,
  resolveMarket,
  getSystemState,
  setSystemState,
  deleteSystemState,
  getEconomyDb,
  saveVcSession,
  removeVcSession,
  getAllVcSessions,
  clearAllVcSessions,
  addVcTime,
  getVcTimeLeaderboard,
  getVcTimeForUser,
  placePachinkoBet,
  payPachinkoPayout,
  placeCasinoBet,
  payCasinoPayout,
  adjustBalance,
  adjustBalancesAtomic, // all-or-nothing group of adjustBalance calls
  payThenRun, // pay atomically, run an item move in another DB, refund if it fails
  collectMonthlyTaxes,
  casinoDailyReserveDeposit,
  reloadSettings,
};
