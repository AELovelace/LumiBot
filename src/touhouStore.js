/**
 * Touhou Market Store — separate SQLite database for the Touhou collection system.
 *
 * Characters can be adopted from the market for 25 SGC (base price).
 * Rarity and suggested price increase with trade count.
 * No duplicates on the market — each Touhou exists exactly once.
 * Momiji Inubashiri is permanently reserved for .doll/ (319254336402358272).
 */

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { logger } = require('./logger');

const DOLL_USER_ID = '319254336402358272';
const MOMIJI_FILE = 'Momiji Inubashiri.png';
const DEFAULT_TOUHOU_MIGRATION_GUILD_ID = '895446230967148544';
const BASE_ADOPT_PRICE = 25;
const PARTY_LIMIT = 6;
const MAX_LEVEL = 50;
const FAINT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const BUYBACK_PRICE_RATIO = 2 / 3;
const POTION_PRICE = 20;
const POTION_CAP = 10;
const POTION_HEAL_RATIO = 0.5;
const DEFAULT_RARITY_SEED_FILE = path.resolve(process.cwd(), 'data', 'touhou-rarity-seed.json');
const DEFAULT_ATTACKS_SEED_FILE = path.resolve(process.cwd(), 'data', 'touhou-attacks-seed.json');

let db = null;
let touhouList = []; // cached list of all Touhou filenames
let shortNameMap = {}; // short name -> full name (filename without ext)
let raritySeedByName = {}; // canonical touhou name -> rarity seed metadata
let attacksSeedByName = {}; // canonical touhou name -> [{name, type, basePower, accuracy, description}, ...]
const initializedGuildMarkets = new Set();

// ---------------------------------------------------------------------------
// Name mapping
// ---------------------------------------------------------------------------

/**
 * Build the short-name lookup map from the touhous/ directory.
 * Uses first name only when unambiguous; falls back to full name for conflicts.
 */
function buildNameMap(touhouDir) {
  const files = fs.readdirSync(touhouDir).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
  });

  touhouList = files;

  // Count first-name occurrences to detect conflicts
  const firstNameCounts = {};
  for (const file of files) {
    const fullName = path.parse(file).name;
    const firstName = fullName.split(/[\s_]/)[0].toLowerCase();
    firstNameCounts[firstName] = (firstNameCounts[firstName] || 0) + 1;
  }

  shortNameMap = {};
  for (const file of files) {
    const fullName = path.parse(file).name;
    const firstName = fullName.split(/[\s_]/)[0].toLowerCase();

    // Always map full name (lowercased) -> full name
    shortNameMap[fullName.toLowerCase()] = fullName;

    // Map first name only if unambiguous
    if (firstNameCounts[firstName] === 1) {
      shortNameMap[firstName] = fullName;
    }
  }

  logger.info(`Touhou market: loaded ${files.length} characters, ${Object.keys(shortNameMap).length} name mappings.`);
}

/**
 * Resolve user input to a canonical Touhou name.
 * Tries exact match, then first-name shortcut.
 */
function resolveName(input) {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  return shortNameMap[key] || null;
}

/**
 * Get the image filename for a Touhou by canonical name.
 */
function getImageFile(canonicalName) {
  return touhouList.find((f) => path.parse(f).name === canonicalName) || null;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function initTouhouStore(dbPath, touhouDir) {
  const resolvedDb = path.resolve(dbPath);
  const resolvedDir = path.resolve(touhouDir);
  raritySeedByName = loadRaritySeed();
  attacksSeedByName = loadAttacksSeed();
  logger.info(`Touhou market DB: ${resolvedDb}`);
  db = new Database(resolvedDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema();
  buildNameMap(resolvedDir);
  seedMarket(DEFAULT_TOUHOU_MIGRATION_GUILD_ID);
  seedAttacks();
  ensureMomijiReserved(DEFAULT_TOUHOU_MIGRATION_GUILD_ID);
}

function closeTouhouStore() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
    initializedGuildMarkets.clear();
    logger.info('Touhou market DB closed.');
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS touhous (
      guild_id      TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}',
      name          TEXT NOT NULL,
      filename      TEXT NOT NULL,
      owner_id      TEXT DEFAULT NULL,
      trade_count   INTEGER NOT NULL DEFAULT 0,
      base_rarity_score REAL NOT NULL DEFAULT 0,
      popularity_score REAL NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      is_main_character INTEGER NOT NULL DEFAULT 0,
      adopted_at    TEXT DEFAULT NULL,
      last_traded   TEXT DEFAULT NULL,
      PRIMARY KEY (guild_id, name)
    );

    CREATE TABLE IF NOT EXISTS touhou_trades (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}',
      touhou_name   TEXT NOT NULL,
      from_user_id  TEXT NOT NULL,
      to_user_id    TEXT NOT NULL,
      price         INTEGER NOT NULL DEFAULT 0,
      trade_type    TEXT NOT NULL DEFAULT 'trade',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS touhou_listings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}',
      touhou_name   TEXT NOT NULL,
      seller_id     TEXT NOT NULL,
      price         INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, touhou_name)
    );

    CREATE TABLE IF NOT EXISTS touhou_attacks (
      touhou_name   TEXT NOT NULL,
      slot          INTEGER NOT NULL,
      attack_name   TEXT NOT NULL,
      attack_type   TEXT NOT NULL DEFAULT 'danmaku',
      base_power    INTEGER NOT NULL DEFAULT 50,
      accuracy      INTEGER NOT NULL DEFAULT 95,
      description   TEXT DEFAULT NULL,
      PRIMARY KEY (touhou_name, slot)
    );

    CREATE TABLE IF NOT EXISTS touhou_battle_stats (
      guild_id       TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}',
      touhou_name    TEXT NOT NULL,
      owner_id       TEXT NOT NULL,
      level          INTEGER NOT NULL DEFAULT 1,
      exp            INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      losses         INTEGER NOT NULL DEFAULT 0,
      fainted_until  INTEGER DEFAULT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, touhou_name, owner_id)
    );

    CREATE TABLE IF NOT EXISTS touhou_user_inventory (
      guild_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      potion_count  INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  ensureColumn('touhous', 'guild_id', `TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}'`);
  ensureColumn('touhous', 'base_rarity_score', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('touhous', 'popularity_score', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('touhous', 'comment_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('touhous', 'is_main_character', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('touhou_trades', 'guild_id', `TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}'`);
  ensureColumn('touhou_listings', 'guild_id', `TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}'`);
  ensureColumn('touhou_battle_stats', 'guild_id', `TEXT NOT NULL DEFAULT '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}'`);

  // Backfill legacy rows.
  db.prepare(`UPDATE touhous SET guild_id = ? WHERE guild_id IS NULL OR guild_id = ''`).run(DEFAULT_TOUHOU_MIGRATION_GUILD_ID);
  db.prepare(`UPDATE touhou_trades SET guild_id = ? WHERE guild_id IS NULL OR guild_id = ''`).run(DEFAULT_TOUHOU_MIGRATION_GUILD_ID);
  db.prepare(`UPDATE touhou_listings SET guild_id = ? WHERE guild_id IS NULL OR guild_id = ''`).run(DEFAULT_TOUHOU_MIGRATION_GUILD_ID);
  db.prepare(`UPDATE touhou_battle_stats SET guild_id = ? WHERE guild_id IS NULL OR guild_id = ''`).run(DEFAULT_TOUHOU_MIGRATION_GUILD_ID);

  migrateLegacyTouhousTable();
  migrateLegacyBattleStatsTable();
  migrateLegacyListingsTable();

  // Recreate indexes after potential table rebuilds.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_touhous_guild_owner ON touhous(guild_id, owner_id);
    CREATE INDEX IF NOT EXISTS idx_touhous_guild_name ON touhous(guild_id, name);
    CREATE INDEX IF NOT EXISTS idx_trades_guild_touhou ON touhou_trades(guild_id, touhou_name);
    CREATE INDEX IF NOT EXISTS idx_trades_guild_from   ON touhou_trades(guild_id, from_user_id);
    CREATE INDEX IF NOT EXISTS idx_trades_guild_to     ON touhou_trades(guild_id, to_user_id);
    CREATE INDEX IF NOT EXISTS idx_listings_guild_seller ON touhou_listings(guild_id, seller_id);
    CREATE INDEX IF NOT EXISTS idx_battle_stats_guild_owner ON touhou_battle_stats(guild_id, owner_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_guild_user ON touhou_user_inventory(guild_id, user_id);
  `);
}

function getPrimaryKeyColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all()
    .filter((col) => Number(col.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((col) => col.name);
}

function hasUniqueIndexWithColumns(tableName, targetColumns) {
  const indexes = db.prepare(`PRAGMA index_list(${tableName})`).all();
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all().map((c) => c.name);
    if (cols.length === targetColumns.length && cols.every((c, i) => c === targetColumns[i])) {
      return true;
    }
  }
  return false;
}

function migrateLegacyTouhousTable() {
  const pk = getPrimaryKeyColumns('touhous');
  if (pk.length === 2 && pk[0] === 'guild_id' && pk[1] === 'name') return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS touhous_new (
      guild_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      filename      TEXT NOT NULL,
      owner_id      TEXT DEFAULT NULL,
      trade_count   INTEGER NOT NULL DEFAULT 0,
      base_rarity_score REAL NOT NULL DEFAULT 0,
      popularity_score REAL NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      is_main_character INTEGER NOT NULL DEFAULT 0,
      adopted_at    TEXT DEFAULT NULL,
      last_traded   TEXT DEFAULT NULL,
      PRIMARY KEY (guild_id, name)
    );
  `);

  db.exec(`
    INSERT OR REPLACE INTO touhous_new (
      guild_id, name, filename, owner_id, trade_count,
      base_rarity_score, popularity_score, comment_count, is_main_character,
      adopted_at, last_traded
    )
    SELECT
      COALESCE(NULLIF(guild_id, ''), '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}'),
      name, filename, owner_id, trade_count,
      base_rarity_score, popularity_score, comment_count, is_main_character,
      adopted_at, last_traded
    FROM touhous;

    DROP TABLE touhous;
    ALTER TABLE touhous_new RENAME TO touhous;
  `);
}

function migrateLegacyBattleStatsTable() {
  const pk = getPrimaryKeyColumns('touhou_battle_stats');
  if (pk.length === 3 && pk[0] === 'guild_id' && pk[1] === 'touhou_name' && pk[2] === 'owner_id') return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS touhou_battle_stats_new (
      guild_id       TEXT NOT NULL,
      touhou_name    TEXT NOT NULL,
      owner_id       TEXT NOT NULL,
      level          INTEGER NOT NULL DEFAULT 1,
      exp            INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      losses         INTEGER NOT NULL DEFAULT 0,
      fainted_until  INTEGER DEFAULT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, touhou_name, owner_id)
    );
  `);

  db.exec(`
    INSERT OR REPLACE INTO touhou_battle_stats_new (
      guild_id, touhou_name, owner_id, level, exp, wins, losses,
      fainted_until, created_at, updated_at
    )
    SELECT
      COALESCE(NULLIF(guild_id, ''), '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}'),
      touhou_name, owner_id, level, exp, wins, losses,
      fainted_until, created_at, updated_at
    FROM touhou_battle_stats;

    DROP TABLE touhou_battle_stats;
    ALTER TABLE touhou_battle_stats_new RENAME TO touhou_battle_stats;
  `);
}

function migrateLegacyListingsTable() {
  if (!hasUniqueIndexWithColumns('touhou_listings', ['touhou_name'])) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS touhou_listings_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      touhou_name   TEXT NOT NULL,
      seller_id     TEXT NOT NULL,
      price         INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, touhou_name)
    );
  `);

  db.exec(`
    INSERT OR REPLACE INTO touhou_listings_new (id, guild_id, touhou_name, seller_id, price, created_at)
    SELECT
      id,
      COALESCE(NULLIF(guild_id, ''), '${DEFAULT_TOUHOU_MIGRATION_GUILD_ID}'),
      touhou_name,
      seller_id,
      price,
      created_at
    FROM touhou_listings;

    DROP TABLE touhou_listings;
    ALTER TABLE touhou_listings_new RENAME TO touhou_listings;
  `);
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function normalizeSeedName(name) {
  return (name || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadAttacksSeed() {
  if (!fs.existsSync(DEFAULT_ATTACKS_SEED_FILE)) {
    logger.info(`Touhou attacks seed file not found: ${DEFAULT_ATTACKS_SEED_FILE}`);
    return {};
  }

  try {
    const raw = fs.readFileSync(DEFAULT_ATTACKS_SEED_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = parsed?.characters && typeof parsed.characters === 'object'
      ? Object.entries(parsed.characters)
      : [];

    const result = {};
    for (const [name, value] of entries) {
      const key = normalizeSeedName(name);
      const attacks = Array.isArray(value?.attacks) ? value.attacks : [];
      result[key] = attacks.slice(0, 3).map((a, i) => ({
        name: String(a?.name || `Attack ${i + 1}`).slice(0, 64),
        type: String(a?.type || 'danmaku').toLowerCase(),
        basePower: Math.max(1, Math.min(150, Number(a?.basePower) || 50)),
        accuracy: Math.max(40, Math.min(100, Number(a?.accuracy) || 95)),
        description: a?.description ? String(a.description).slice(0, 200) : null,
      }));
    }

    logger.info(`Touhou attacks seed loaded: ${Object.keys(result).length} characters.`);
    return result;
  } catch (error) {
    logger.warn(`Failed to load Touhou attacks seed: ${error.message}`);
    return {};
  }
}

function loadRaritySeed() {
  if (!fs.existsSync(DEFAULT_RARITY_SEED_FILE)) {
    logger.info(`Touhou rarity seed file not found: ${DEFAULT_RARITY_SEED_FILE}`);
    return {};
  }

  try {
    const raw = fs.readFileSync(DEFAULT_RARITY_SEED_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = parsed?.characters && typeof parsed.characters === 'object'
      ? Object.entries(parsed.characters)
      : [];

    const result = {};
    for (const [name, value] of entries) {
      const key = normalizeSeedName(name);
      result[key] = {
        baseRarityScore: Number(value?.baseRarityScore) || 0,
        popularityScore: Number(value?.popularityScore) || 0,
        commentCount: Number(value?.commentCount) || 0,
        isMainCharacter: value?.isMainCharacter ? 1 : 0,
      };
    }

    logger.info(`Touhou rarity seed loaded: ${Object.keys(result).length} characters.`);
    return result;
  } catch (error) {
    logger.warn(`Failed to load Touhou rarity seed: ${error.message}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Seed the market with all available Touhous
// ---------------------------------------------------------------------------

function seedMarket(guildId) {
  if (!guildId) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO touhous (
      guild_id,
      name,
      filename,
      base_rarity_score,
      popularity_score,
      comment_count,
      is_main_character
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const updateSeed = db.prepare(`
    UPDATE touhous
    SET base_rarity_score = ?, popularity_score = ?, comment_count = ?, is_main_character = ?
    WHERE guild_id = ? AND name = ?
  `);

  const tx = db.transaction(() => {
    for (const file of touhouList) {
      const name = path.parse(file).name;
      const seed = raritySeedByName[name] || {
        baseRarityScore: 0,
        popularityScore: 0,
        commentCount: 0,
        isMainCharacter: 0,
      };
      insert.run(guildId, name, file, seed.baseRarityScore, seed.popularityScore, seed.commentCount, seed.isMainCharacter);
      updateSeed.run(seed.baseRarityScore, seed.popularityScore, seed.commentCount, seed.isMainCharacter, guildId, name);
    }
  });
  tx();
}

/**
 * Seed/refresh the touhou_attacks table from data/touhou-attacks-seed.json.
 * Re-applies on every startup so updates to the seed file propagate.
 */
function seedAttacks() {
  if (!attacksSeedByName || Object.keys(attacksSeedByName).length === 0) {
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO touhou_attacks (touhou_name, slot, attack_name, attack_type, base_power, accuracy, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(touhou_name, slot) DO UPDATE SET
      attack_name = excluded.attack_name,
      attack_type = excluded.attack_type,
      base_power = excluded.base_power,
      accuracy = excluded.accuracy,
      description = excluded.description
  `);

  let count = 0;
  const tx = db.transaction(() => {
    for (const file of touhouList) {
      const name = path.parse(file).name;
      const attacks = attacksSeedByName[name];
      if (!attacks || attacks.length === 0) continue;
      for (let i = 0; i < attacks.length && i < 3; i++) {
        const a = attacks[i];
        upsert.run(name, i + 1, a.name, a.type, a.basePower, a.accuracy, a.description);
        count += 1;
      }
    }
  });
  tx();
  logger.info(`Touhou attacks seeded: ${count} attack rows.`);
}

/**
 * Ensure Momiji Inubashiri always belongs to .doll/.
 */
function ensureMomijiReserved(guildId) {
  if (!guildId) return;
  const momijiName = path.parse(MOMIJI_FILE).name;
  const row = db.prepare('SELECT owner_id FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, momijiName);
  if (row && row.owner_id !== DOLL_USER_ID) {
    db.prepare(`
      UPDATE touhous SET owner_id = ?, adopted_at = COALESCE(adopted_at, datetime('now'))
      WHERE guild_id = ? AND name = ?
    `).run(DOLL_USER_ID, guildId, momijiName);
    logger.info('Touhou market: Momiji Inubashiri reserved for .doll/.');
  } else if (row && !row.owner_id) {
    db.prepare(`
      UPDATE touhous SET owner_id = ?, adopted_at = datetime('now')
      WHERE guild_id = ? AND name = ?
    `).run(DOLL_USER_ID, guildId, momijiName);
    logger.info('Touhou market: Momiji Inubashiri assigned to .doll/.');
  }
}

function ensureGuildMarket(guildId) {
  if (!guildId) return;
  if (initializedGuildMarkets.has(guildId)) return;
  seedMarket(guildId);
  ensureMomijiReserved(guildId);
  initializedGuildMarkets.add(guildId);
}

// ---------------------------------------------------------------------------
// Price / rarity helpers
// ---------------------------------------------------------------------------

/**
 * Rarity tiers based on trade count.
 * Momiji Inubashiri has a fixed ultra-rare tier.
 */
function getRarity(tradeCount, name, baseRarityScore = 0, level = 0) {
  if (name === 'Momiji Inubashiri') return { tier: 'Ultra-Plus Infinity Rare', emoji: '✦' };
  const levelBonus = Math.floor(Number(level || 0) / 5);
  const combinedScore = Number(tradeCount || 0) + Number(baseRarityScore || 0) + levelBonus;
  if (combinedScore >= 24) return { tier: 'Legendary', emoji: '🌟' };
  if (combinedScore >= 14) return { tier: 'Epic', emoji: '💜' };
  if (combinedScore >= 8) return { tier: 'Rare', emoji: '🔷' };
  if (combinedScore >= 4) return { tier: 'Uncommon', emoji: '🟢' };
  return { tier: 'Common', emoji: '⚪' };
}

/**
 * Suggested price based on trade count, base rarity, and current level.
 * Base 25, increases with each trade. Level adds +8 per 5 levels.
 */
function getSuggestedPrice(tradeCount, baseRarityScore = 0, level = 0) {
  const tradeComponent = Number(tradeCount || 0) * 0.45;
  const baseComponent = Number(baseRarityScore || 0) * 0.35;
  const levelBonus = Math.floor(Number(level || 0) / 5) * 8;
  return Math.floor(BASE_ADOPT_PRICE * (1 + tradeComponent + baseComponent)) + levelBonus;
}

// ---------------------------------------------------------------------------
// Market operations
// ---------------------------------------------------------------------------

/**
 * Get all Touhous that are available for adoption (no owner).
 */
function getAvailableTouhous(guildId, limit = 20, offset = 0) {
  ensureGuildMarket(guildId);
  return db.prepare(`
    SELECT name, filename, trade_count, base_rarity_score, popularity_score, comment_count, is_main_character
    FROM touhous
    WHERE guild_id = ? AND owner_id IS NULL
    ORDER BY name
    LIMIT ? OFFSET ?
  `).all(guildId, limit, offset);
}

/**
 * Count available Touhous.
 */
function getAvailableCount(guildId) {
  ensureGuildMarket(guildId);
  const row = db.prepare('SELECT COUNT(*) as cnt FROM touhous WHERE guild_id = ? AND owner_id IS NULL').get(guildId);
  return row.cnt;
}

/**
 * Adopt a random Touhou from the market.
 * The user does not choose — one is assigned at random.
 * Enforces a 6-touhou party cap on NEW draws (existing oversize collections grandfathered).
 * Returns { success, touhou, error, code }.
 */
function adoptTouhou(guildId, userId) {
  ensureGuildMarket(guildId);
  const ownedCount = db.prepare('SELECT COUNT(*) as cnt FROM touhous WHERE guild_id = ? AND owner_id = ?').get(guildId, userId).cnt;
  if (ownedCount >= PARTY_LIMIT) {
    return {
      success: false,
      code: 'PARTY_FULL',
      error: `Your party is full (${ownedCount}/${PARTY_LIMIT}). Use \`/lumi-touhou buyback\` to free a slot.`,
    };
  }

  const touhou = db.prepare(`
    SELECT * FROM touhous WHERE guild_id = ? AND owner_id IS NULL ORDER BY RANDOM() LIMIT 1
  `).get(guildId);
  if (!touhou) return { success: false, error: 'There are no Touhous available for adoption right now!' };

  const price = BASE_ADOPT_PRICE;

  db.prepare(`
    UPDATE touhous SET owner_id = ?, adopted_at = datetime('now') WHERE guild_id = ? AND name = ?
  `).run(userId, guildId, touhou.name);

  // Record as a trade from market
  db.prepare(`
    INSERT INTO touhou_trades (guild_id, touhou_name, from_user_id, to_user_id, price, trade_type)
    VALUES (?, ?, '__MARKET__', ?, ?, 'adopt')
  `).run(guildId, touhou.name, userId, price);

  return { success: true, touhou: { ...touhou, owner_id: userId }, price };
}

/**
 * Get all Touhous owned by a user.
 */
function getUserTouhous(guildId, userId) {
  ensureGuildMarket(guildId);
  return db.prepare(`
    SELECT name, filename, trade_count, base_rarity_score, popularity_score, comment_count, is_main_character, adopted_at, last_traded
    FROM touhous
    WHERE guild_id = ? AND owner_id = ?
    ORDER BY name
  `).all(guildId, userId);
}

/**
 * Get a specific Touhou by name.
 */
function getTouhou(guildId, touhouName) {
  ensureGuildMarket(guildId);
  return db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName) || null;
}

/**
 * Send a Touhou to another user (free transfer / gift).
 * Momiji cannot be transferred away from .doll/.
 */
function sendTouhou(guildId, fromUserId, toUserId, touhouName) {
  ensureGuildMarket(guildId);
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName && fromUserId === DOLL_USER_ID) {
    return { success: false, error: 'Momiji Inubashiri can never leave .doll/\'s collection.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (touhou.owner_id !== fromUserId) return { success: false, error: 'You don\'t own that Touhou.' };
  if (fromUserId === toUserId) return { success: false, error: 'You can\'t send a Touhou to yourself.' };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE guild_id = ? AND name = ?
    `).run(toUserId, guildId, touhouName);

    db.prepare(`
      INSERT INTO touhou_trades (guild_id, touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, ?, 0, 'gift')
    `).run(guildId, touhouName, fromUserId, toUserId);

    transferBattleStatsTx(guildId, touhouName, fromUserId, toUserId);
  });
  tx();

  const updated = getTouhou(guildId, touhouName);
  return { success: true, touhou: updated };
}

/**
 * Trade a Touhou for SGC (sell).
 * The buyer pays the seller the agreed price.
 * Momiji cannot be sold by .doll/.
 */
function sellTouhou(guildId, sellerId, buyerId, touhouName, price) {
  ensureGuildMarket(guildId);
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName && sellerId === DOLL_USER_ID) {
    return { success: false, error: 'Momiji Inubashiri can never leave .doll/\'s collection.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (touhou.owner_id !== sellerId) return { success: false, error: 'Seller doesn\'t own that Touhou.' };
  if (sellerId === buyerId) return { success: false, error: 'You can\'t sell a Touhou to yourself.' };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE guild_id = ? AND name = ?
    `).run(buyerId, guildId, touhouName);

    db.prepare(`
      INSERT INTO touhou_trades (guild_id, touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, ?, ?, 'sale')
    `).run(guildId, touhouName, sellerId, buyerId, price);

    transferBattleStatsTx(guildId, touhouName, sellerId, buyerId);
  });
  tx();

  const updated = getTouhou(guildId, touhouName);
  return { success: true, touhou: updated };
}

/**
 * Swap two Touhous between two users.
 * Neither can be Momiji if owned by .doll/.
 */
function swapTouhous(guildId, userAId, touhouAName, userBId, touhouBName) {
  ensureGuildMarket(guildId);
  const momijiName = path.parse(MOMIJI_FILE).name;
  if ((touhouAName === momijiName && userAId === DOLL_USER_ID) ||
      (touhouBName === momijiName && userBId === DOLL_USER_ID)) {
    return { success: false, error: 'Momiji Inubashiri can never leave .doll/\'s collection.' };
  }

  const touhouA = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouAName);
  const touhouB = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouBName);
  if (!touhouA || !touhouB) return { success: false, error: 'One or both Touhous don\'t exist.' };
  if (touhouA.owner_id !== userAId) return { success: false, error: `You don't own **${touhouAName}**.` };
  if (touhouB.owner_id !== userBId) return { success: false, error: `They don't own **${touhouBName}**.` };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE guild_id = ? AND name = ?
    `).run(userBId, guildId, touhouAName);

    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE guild_id = ? AND name = ?
    `).run(userAId, guildId, touhouBName);

    db.prepare(`
      INSERT INTO touhou_trades (guild_id, touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, ?, 0, 'swap')
    `).run(guildId, touhouAName, userAId, userBId);

    db.prepare(`
      INSERT INTO touhou_trades (guild_id, touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, ?, 0, 'swap')
    `).run(guildId, touhouBName, userBId, userAId);

    transferBattleStatsTx(guildId, touhouAName, userAId, userBId);
    transferBattleStatsTx(guildId, touhouBName, userBId, userAId);
  });
  tx();

  return { success: true };
}

// ---------------------------------------------------------------------------
// Listings (player-to-player marketplace)
// ---------------------------------------------------------------------------

/**
 * List a Touhou for sale at a price.
 */
function listForSale(guildId, sellerId, touhouName, price) {
  ensureGuildMarket(guildId);
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName && sellerId === DOLL_USER_ID) {
    return { success: false, error: 'Momiji Inubashiri can never be listed for sale.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (touhou.owner_id !== sellerId) return { success: false, error: 'You don\'t own that Touhou.' };

  // Check if already listed
  const existing = db.prepare('SELECT id FROM touhou_listings WHERE guild_id = ? AND touhou_name = ?').get(guildId, touhouName);
  if (existing) {
    db.prepare('UPDATE touhou_listings SET price = ?, seller_id = ?, created_at = datetime(\'now\') WHERE guild_id = ? AND touhou_name = ?')
      .run(price, sellerId, guildId, touhouName);
  } else {
    db.prepare('INSERT INTO touhou_listings (guild_id, touhou_name, seller_id, price) VALUES (?, ?, ?, ?)')
      .run(guildId, touhouName, sellerId, price);
  }

  return { success: true };
}

/**
 * Remove a Touhou listing.
 */
function delistTouhou(guildId, sellerId, touhouName) {
  const listing = db.prepare('SELECT * FROM touhou_listings WHERE guild_id = ? AND touhou_name = ? AND seller_id = ?').get(guildId, touhouName, sellerId);
  if (!listing) return { success: false, error: 'You don\'t have that Touhou listed for sale.' };

  db.prepare('DELETE FROM touhou_listings WHERE guild_id = ? AND touhou_name = ? AND seller_id = ?').run(guildId, touhouName, sellerId);
  return { success: true };
}

/**
 * Get all active listings.
 */
function getListings(guildId) {
  ensureGuildMarket(guildId);
  return db.prepare(`
    SELECT l.touhou_name, l.seller_id, l.price, l.created_at,
        t.trade_count, t.filename, t.base_rarity_score, t.popularity_score, t.comment_count, t.is_main_character
    FROM touhou_listings l
    JOIN touhous t ON t.guild_id = l.guild_id AND t.name = l.touhou_name
    WHERE l.guild_id = ? AND t.owner_id = l.seller_id
    ORDER BY l.created_at DESC
  `).all(guildId);
}

function getListingsPage(guildId, limit = 15, offset = 0) {
  ensureGuildMarket(guildId);
  return db.prepare(`
    SELECT l.touhou_name, l.seller_id, l.price, l.created_at,
        t.trade_count, t.filename, t.base_rarity_score, t.popularity_score, t.comment_count, t.is_main_character
    FROM touhou_listings l
    JOIN touhous t ON t.guild_id = l.guild_id AND t.name = l.touhou_name
    WHERE l.guild_id = ? AND t.owner_id = l.seller_id
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).all(guildId, limit, offset);
}

function getListingsCount(guildId) {
  ensureGuildMarket(guildId);
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM touhou_listings l
    JOIN touhous t ON t.guild_id = l.guild_id AND t.name = l.touhou_name
    WHERE l.guild_id = ? AND t.owner_id = l.seller_id
  `).get(guildId);
  return row?.cnt || 0;
}

/**
 * Get the listing price for a Touhou (or null if not listed).
 */
function getListingPrice(guildId, touhouName) {
  const listing = db.prepare(`
    SELECT l.price
    FROM touhou_listings l
    JOIN touhous t ON t.guild_id = l.guild_id AND t.name = l.touhou_name
    WHERE l.guild_id = ? AND l.touhou_name = ? AND t.owner_id = l.seller_id
  `).get(guildId, touhouName);
  return listing ? listing.price : null;
}

/**
 * Buy a listed Touhou.
 */
function buyListing(guildId, buyerId, touhouName) {
  ensureGuildMarket(guildId);
  const listing = db.prepare(`
    SELECT l.*, t.owner_id
    FROM touhou_listings l
    JOIN touhous t ON t.guild_id = l.guild_id AND t.name = l.touhou_name
    WHERE l.guild_id = ? AND l.touhou_name = ? AND t.owner_id = l.seller_id
  `).get(guildId, touhouName);

  if (!listing) return { success: false, error: 'That listing doesn\'t exist or is invalid.', price: 0 };
  if (listing.seller_id === buyerId) return { success: false, error: 'You can\'t buy your own listing.', price: 0 };

  const result = sellTouhou(guildId, listing.seller_id, buyerId, touhouName, listing.price);
  if (!result.success) return { ...result, price: listing.price };

  // Remove the listing
  db.prepare('DELETE FROM touhou_listings WHERE guild_id = ? AND touhou_name = ?').run(guildId, touhouName);

  return { success: true, touhou: result.touhou, price: listing.price, sellerId: listing.seller_id };
}

// ---------------------------------------------------------------------------
// Buyback (sell back to the market)
// ---------------------------------------------------------------------------

/**
 * Sell a Touhou back to the market for 2/3 of its current suggested price.
 * Preserves rarity (does NOT increment trade_count) and wipes battle stats.
 * Momiji cannot be sold back from .doll/.
 * Returns { success, payout, touhou, error }.
 */
function sellbackToMarket(guildId, userId, touhouName) {
  ensureGuildMarket(guildId);
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName && userId === DOLL_USER_ID) {
    return { success: false, error: 'Momiji Inubashiri can never leave .doll/\'s collection.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (touhou.owner_id !== userId) return { success: false, error: 'You don\'t own that Touhou.' };

  const stats = db.prepare('SELECT level FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?').get(guildId, touhouName, userId);
  const level = stats?.level || 0;
  const suggested = getSuggestedPrice(touhou.trade_count, touhou.base_rarity_score || 0, level);
  const payout = Math.max(1, Math.floor(suggested * BUYBACK_PRICE_RATIO));

  const tx = db.transaction(() => {
    db.prepare('UPDATE touhous SET owner_id = NULL, last_traded = datetime(\'now\') WHERE guild_id = ? AND name = ?').run(guildId, touhouName);
    db.prepare('DELETE FROM touhou_listings WHERE guild_id = ? AND touhou_name = ?').run(guildId, touhouName);
    db.prepare('DELETE FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ?').run(guildId, touhouName);
    db.prepare(`
      INSERT INTO touhou_trades (guild_id, touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, '__MARKET__', ?, 'buyback')
    `).run(guildId, touhouName, userId, payout);
  });
  tx();

  return { success: true, payout, touhou: getTouhou(guildId, touhouName) };
}

// ---------------------------------------------------------------------------
// Battle stats & attacks
// ---------------------------------------------------------------------------

/**
 * Get the 3 attacks for a Touhou (slot order). Returns [] if not seeded.
 */
function getAttacks(touhouName) {
  return db.prepare(`
    SELECT slot, attack_name AS name, attack_type AS type, base_power AS basePower, accuracy, description
    FROM touhou_attacks
    WHERE touhou_name = ?
    ORDER BY slot ASC
  `).all(touhouName);
}

/**
 * Get-or-create battle stats for (touhou, owner).
 * Lazily clears `fainted_until` if the cooldown has passed.
 * Returns the row.
 */
function getOrCreateBattleStats(guildId, touhouName, ownerId) {
  ensureGuildMarket(guildId);
  let row = db.prepare('SELECT * FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?').get(guildId, touhouName, ownerId);
  if (!row) {
    db.prepare(`
      INSERT INTO touhou_battle_stats (guild_id, touhou_name, owner_id, level, exp)
      VALUES (?, ?, ?, 1, 0)
    `).run(guildId, touhouName, ownerId);
    row = db.prepare('SELECT * FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?').get(guildId, touhouName, ownerId);
  }

  // Lazy clear of expired faint cooldown
  if (row.fainted_until && row.fainted_until <= Date.now()) {
    db.prepare('UPDATE touhou_battle_stats SET fainted_until = NULL, updated_at = datetime(\'now\') WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?')
      .run(guildId, touhouName, ownerId);
    row.fainted_until = null;
  }

  return row;
}

/**
 * EXP curve. Cap at MAX_LEVEL.
 */
function expToNextLevel(level) {
  return 20 + level * 15;
}

/**
 * Add EXP to a touhou's battle stats. Cascades level-ups.
 * Returns { newLevel, newExp, leveledUp, levelsGained }.
 */
function addExp(guildId, touhouName, ownerId, amount) {
  const row = getOrCreateBattleStats(guildId, touhouName, ownerId);
  let level = row.level;
  let exp = row.exp + Math.max(0, Math.floor(amount));
  let levelsGained = 0;

  while (level < MAX_LEVEL && exp >= expToNextLevel(level)) {
    exp -= expToNextLevel(level);
    level += 1;
    levelsGained += 1;
  }
  if (level >= MAX_LEVEL) {
    level = MAX_LEVEL;
    exp = 0;
  }

  db.prepare(`
    UPDATE touhou_battle_stats
    SET level = ?, exp = ?, updated_at = datetime('now')
    WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?
  `).run(level, exp, guildId, touhouName, ownerId);

  return { newLevel: level, newExp: exp, leveledUp: levelsGained > 0, levelsGained };
}

/**
 * Mark a touhou as fainted until `untilTimestamp` (ms epoch).
 */
function setFainted(guildId, touhouName, ownerId, untilTimestamp) {
  getOrCreateBattleStats(guildId, touhouName, ownerId);
  db.prepare(`
    UPDATE touhou_battle_stats
    SET fainted_until = ?, losses = losses + 1, updated_at = datetime('now')
    WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?
  `).run(untilTimestamp, guildId, touhouName, ownerId);
}

/**
 * Record a battle win.
 */
function recordWin(guildId, touhouName, ownerId) {
  getOrCreateBattleStats(guildId, touhouName, ownerId);
  db.prepare(`
    UPDATE touhou_battle_stats
    SET wins = wins + 1, updated_at = datetime('now')
    WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?
  `).run(guildId, touhouName, ownerId);
}

/**
 * Clear the faint cooldown immediately (used by /lumi-touhou heal pay:true).
 */
function healTouhou(guildId, touhouName, ownerId) {
  const row = db.prepare('SELECT fainted_until FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?').get(guildId, touhouName, ownerId);
  if (!row) return { success: false, error: 'That Touhou has no battle history.' };
  db.prepare('UPDATE touhou_battle_stats SET fainted_until = NULL, updated_at = datetime(\'now\') WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?')
    .run(guildId, touhouName, ownerId);
  return { success: true, wasFainted: !!row.fainted_until };
}

/**
 * Re-key a battle stats row from one owner to another.
 * Internal — call from inside an existing transaction.
 */
function transferBattleStatsTx(guildId, touhouName, fromUserId, toUserId) {
  // If the destination owner already has a row (shouldn't happen since they didn't own
  // the touhou), drop the old one to make room.
  db.prepare('DELETE FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?')
    .run(guildId, touhouName, toUserId);
  db.prepare('UPDATE touhou_battle_stats SET owner_id = ?, updated_at = datetime(\'now\') WHERE guild_id = ? AND touhou_name = ? AND owner_id = ?')
    .run(toUserId, guildId, touhouName, fromUserId);
}

// ---------------------------------------------------------------------------
// Trade history
// ---------------------------------------------------------------------------

function getTradeHistory(guildId, touhouName, limit = 10) {
  return db.prepare(`
    SELECT * FROM touhou_trades
    WHERE guild_id = ? AND touhou_name = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(guildId, touhouName, limit);
}

function getUserTradeHistory(guildId, userId, limit = 10) {
  return db.prepare(`
    SELECT * FROM touhou_trades
    WHERE guild_id = ? AND (from_user_id = ? OR to_user_id = ?)
    ORDER BY created_at DESC
    LIMIT ?
  `).all(guildId, userId, userId, limit);
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

/**
 * Force-assign a Touhou to a user (admin).
 * Wipes any existing battle stats so the new owner gets a fresh slate.
 */
function adminAssign(guildId, touhouName, userId) {
  ensureGuildMarket(guildId);
  const touhou = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE touhous SET owner_id = ?, adopted_at = COALESCE(adopted_at, datetime('now'))
      WHERE guild_id = ? AND name = ?
    `).run(userId, guildId, touhouName);

    db.prepare('DELETE FROM touhou_listings WHERE guild_id = ? AND touhou_name = ?').run(guildId, touhouName);
    db.prepare('DELETE FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ?').run(guildId, touhouName);
  });
  tx();

  return { success: true };
}

/**
 * Force-release a Touhou back to the market (admin).
 * Cannot release Momiji from .doll/.
 * Wipes battle stats so it returns fresh to the pool.
 */
function adminRelease(guildId, touhouName) {
  ensureGuildMarket(guildId);
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName) {
    return { success: false, error: 'Momiji Inubashiri can never be released.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (!touhou.owner_id) return { success: false, error: 'That Touhou is already unclaimed.' };

  const tx = db.transaction(() => {
    db.prepare('UPDATE touhous SET owner_id = NULL WHERE guild_id = ? AND name = ?').run(guildId, touhouName);
    db.prepare('DELETE FROM touhou_listings WHERE guild_id = ? AND touhou_name = ?').run(guildId, touhouName);
    db.prepare('DELETE FROM touhou_battle_stats WHERE guild_id = ? AND touhou_name = ?').run(guildId, touhouName);
  });
  tx();

  return { success: true };
}

/**
 * Reset trade count for a Touhou (admin).
 */
function adminResetTrades(guildId, touhouName) {
  const touhou = db.prepare('SELECT * FROM touhous WHERE guild_id = ? AND name = ?').get(guildId, touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };

  db.prepare('UPDATE touhous SET trade_count = 0 WHERE guild_id = ? AND name = ?').run(guildId, touhouName);
  return { success: true };
}

/**
 * Get global stats.
 */
function getMarketStats(guildId) {
  ensureGuildMarket(guildId);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM touhous WHERE guild_id = ?').get(guildId).cnt;
  const owned = db.prepare('SELECT COUNT(*) as cnt FROM touhous WHERE guild_id = ? AND owner_id IS NOT NULL').get(guildId).cnt;
  const available = total - owned;
  const totalTrades = db.prepare('SELECT COUNT(*) as cnt FROM touhou_trades WHERE guild_id = ?').get(guildId).cnt;
  const listings = db.prepare('SELECT COUNT(*) as cnt FROM touhou_listings WHERE guild_id = ?').get(guildId).cnt;
  const topTraded = db.prepare('SELECT name, trade_count FROM touhous WHERE guild_id = ? ORDER BY trade_count DESC LIMIT 5').all(guildId);
  const topCollectors = db.prepare(`
    SELECT owner_id, COUNT(*) as cnt
    FROM touhous
    WHERE guild_id = ? AND owner_id IS NOT NULL AND owner_id != '__MARKET__'
    ORDER BY cnt DESC
    LIMIT 5
  `).all(guildId);

  return { total, owned, available, totalTrades, listings, topTraded, topCollectors };
}

/**
 * Compute the total SGC amounts Touhou Management Inc should have received
 * historically (based on the trade log):
 *   - adoptTotal: one BASE_ADOPT_PRICE per adopt trade
 *   - taxTotal:   floor(price * 0.10), min 1, per marketplace sale trade
 * Used once for the retroactive migration on first startup.
 */
function computeHistoricalOwings(baseAdoptPrice = 25) {
  const adopts = db.prepare(
    "SELECT COUNT(*) as cnt FROM touhou_trades WHERE trade_type = 'adopt' AND from_user_id = '__MARKET__'"
  ).get();

  const sales = db.prepare(
    "SELECT price FROM touhou_trades WHERE trade_type = 'sale'"
  ).all();

  const adoptTotal = (adopts?.cnt || 0) * baseAdoptPrice;
  const taxTotal = sales.reduce(
    (sum, row) => sum + Math.max(1, Math.floor((row.price || 0) * 0.10)),
    0,
  );

  return { adoptTotal, taxTotal };
}

/**
 * Search Touhous by name pattern.
 */
function searchTouhous(guildId, pattern) {
  ensureGuildMarket(guildId);
  return db.prepare(`
    SELECT name, filename, owner_id, trade_count, base_rarity_score, popularity_score, comment_count, is_main_character
    FROM touhous
    WHERE guild_id = ? AND name LIKE ?
    ORDER BY name
    LIMIT 20
  `).all(guildId, `%${pattern}%`);
}

function getPotionCount(guildId, userId) {
  const row = db.prepare('SELECT potion_count FROM touhou_user_inventory WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return Number(row?.potion_count || 0);
}

function addPotions(guildId, userId, amount = 1) {
  const qty = Math.max(1, Math.floor(Number(amount) || 1));
  const current = getPotionCount(guildId, userId);
  if (current >= POTION_CAP) {
    return { success: false, code: 'CAP_REACHED', currentCount: current, newCount: current, added: 0 };
  }
  const addable = Math.min(qty, POTION_CAP - current);
  if (addable <= 0) {
    return { success: false, code: 'CAP_REACHED', currentCount: current, newCount: current, added: 0 };
  }
  db.prepare(`
    INSERT INTO touhou_user_inventory (guild_id, user_id, potion_count)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      potion_count = MIN(?, touhou_user_inventory.potion_count + ?),
      updated_at = datetime('now')
  `).run(guildId, userId, addable, POTION_CAP, addable);

  const newCount = getPotionCount(guildId, userId);
  return { success: true, code: 'OK', currentCount: current, newCount, added: newCount - current };
}

function consumePotion(guildId, userId) {
  const before = getPotionCount(guildId, userId);
  if (before <= 0) {
    return { success: false, code: 'NO_STOCK', beforeCount: before, newCount: before };
  }

  const result = db.prepare(`
    UPDATE touhou_user_inventory
    SET potion_count = potion_count - 1,
        updated_at = datetime('now')
    WHERE guild_id = ? AND user_id = ? AND potion_count > 0
  `).run(guildId, userId);

  if (result.changes === 0) {
    return { success: false, code: 'NO_STOCK', beforeCount: before, newCount: getPotionCount(guildId, userId) };
  }

  const newCount = getPotionCount(guildId, userId);
  return { success: true, code: 'OK', beforeCount: before, newCount };
}

module.exports = {
  DOLL_USER_ID,
  DEFAULT_TOUHOU_MIGRATION_GUILD_ID,
  BASE_ADOPT_PRICE,
  PARTY_LIMIT,
  MAX_LEVEL,
  FAINT_DURATION_MS,
  POTION_PRICE,
  POTION_CAP,
  POTION_HEAL_RATIO,
  initTouhouStore,
  closeTouhouStore,
  resolveName,
  getImageFile,
  getRarity,
  getSuggestedPrice,
  getAvailableTouhous,
  getAvailableCount,
  adoptTouhou,
  getUserTouhous,
  getTouhou,
  sendTouhou,
  sellTouhou,
  swapTouhous,
  listForSale,
  delistTouhou,
  getListings,
  getListingsPage,
  getListingsCount,
  getListingPrice,
  buyListing,
  getTradeHistory,
  getUserTradeHistory,
  adminAssign,
  adminRelease,
  adminResetTrades,
  getMarketStats,
  searchTouhous,
  computeHistoricalOwings,
  // Buyback + battle
  sellbackToMarket,
  getAttacks,
  getOrCreateBattleStats,
  expToNextLevel,
  addExp,
  setFainted,
  recordWin,
  healTouhou,
  getPotionCount,
  addPotions,
  consumePotion,
};
