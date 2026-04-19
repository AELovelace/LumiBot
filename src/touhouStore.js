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
const BASE_ADOPT_PRICE = 25;
const DEFAULT_RARITY_SEED_FILE = path.resolve(process.cwd(), 'data', 'touhou-rarity-seed.json');

let db = null;
let touhouList = []; // cached list of all Touhou filenames
let shortNameMap = {}; // short name -> full name (filename without ext)
let raritySeedByName = {}; // canonical touhou name -> rarity seed metadata

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
  logger.info(`Touhou market DB: ${resolvedDb}`);
  db = new Database(resolvedDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema();
  buildNameMap(resolvedDir);
  seedMarket();
  ensureMomijiReserved();
}

function closeTouhouStore() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
    logger.info('Touhou market DB closed.');
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS touhous (
      name          TEXT PRIMARY KEY,
      filename      TEXT NOT NULL,
      owner_id      TEXT DEFAULT NULL,
      trade_count   INTEGER NOT NULL DEFAULT 0,
      base_rarity_score REAL NOT NULL DEFAULT 0,
      popularity_score REAL NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      is_main_character INTEGER NOT NULL DEFAULT 0,
      adopted_at    TEXT DEFAULT NULL,
      last_traded   TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS touhou_trades (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      touhou_name   TEXT NOT NULL,
      from_user_id  TEXT NOT NULL,
      to_user_id    TEXT NOT NULL,
      price         INTEGER NOT NULL DEFAULT 0,
      trade_type    TEXT NOT NULL DEFAULT 'trade',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS touhou_listings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      touhou_name   TEXT NOT NULL UNIQUE,
      seller_id     TEXT NOT NULL,
      price         INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_touhous_owner ON touhous(owner_id);
    CREATE INDEX IF NOT EXISTS idx_trades_touhou ON touhou_trades(touhou_name);
    CREATE INDEX IF NOT EXISTS idx_trades_from   ON touhou_trades(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_trades_to     ON touhou_trades(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_listings_seller ON touhou_listings(seller_id);
  `);

  ensureColumn('touhous', 'base_rarity_score', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('touhous', 'popularity_score', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('touhous', 'comment_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('touhous', 'is_main_character', 'INTEGER NOT NULL DEFAULT 0');
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

function seedMarket() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO touhous (
      name,
      filename,
      base_rarity_score,
      popularity_score,
      comment_count,
      is_main_character
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const updateSeed = db.prepare(`
    UPDATE touhous
    SET base_rarity_score = ?, popularity_score = ?, comment_count = ?, is_main_character = ?
    WHERE name = ?
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
      insert.run(name, file, seed.baseRarityScore, seed.popularityScore, seed.commentCount, seed.isMainCharacter);
      updateSeed.run(seed.baseRarityScore, seed.popularityScore, seed.commentCount, seed.isMainCharacter, name);
    }
  });
  tx();
}

/**
 * Ensure Momiji Inubashiri always belongs to .doll/.
 */
function ensureMomijiReserved() {
  const momijiName = path.parse(MOMIJI_FILE).name;
  const row = db.prepare('SELECT owner_id FROM touhous WHERE name = ?').get(momijiName);
  if (row && row.owner_id !== DOLL_USER_ID) {
    db.prepare(`
      UPDATE touhous SET owner_id = ?, adopted_at = COALESCE(adopted_at, datetime('now'))
      WHERE name = ?
    `).run(DOLL_USER_ID, momijiName);
    logger.info('Touhou market: Momiji Inubashiri reserved for .doll/.');
  } else if (row && !row.owner_id) {
    db.prepare(`
      UPDATE touhous SET owner_id = ?, adopted_at = datetime('now')
      WHERE name = ?
    `).run(DOLL_USER_ID, momijiName);
    logger.info('Touhou market: Momiji Inubashiri assigned to .doll/.');
  }
}

// ---------------------------------------------------------------------------
// Price / rarity helpers
// ---------------------------------------------------------------------------

/**
 * Rarity tiers based on trade count.
 * Momiji Inubashiri has a fixed ultra-rare tier.
 */
function getRarity(tradeCount, name, baseRarityScore = 0) {
  if (name === 'Momiji Inubashiri') return { tier: 'Ultra-Plus Infinity Rare', emoji: '✦' };
  const combinedScore = Number(tradeCount || 0) + Number(baseRarityScore || 0);
  if (combinedScore >= 24) return { tier: 'Legendary', emoji: '🌟' };
  if (combinedScore >= 14) return { tier: 'Epic', emoji: '💜' };
  if (combinedScore >= 8) return { tier: 'Rare', emoji: '🔷' };
  if (combinedScore >= 4) return { tier: 'Uncommon', emoji: '🟢' };
  return { tier: 'Common', emoji: '⚪' };
}

/**
 * Suggested price based on trade count.
 * Base 25, increases with each trade.
 */
function getSuggestedPrice(tradeCount, baseRarityScore = 0) {
  const tradeComponent = Number(tradeCount || 0) * 0.45;
  const baseComponent = Number(baseRarityScore || 0) * 0.35;
  return Math.floor(BASE_ADOPT_PRICE * (1 + tradeComponent + baseComponent));
}

// ---------------------------------------------------------------------------
// Market operations
// ---------------------------------------------------------------------------

/**
 * Get all Touhous that are available for adoption (no owner).
 */
function getAvailableTouhous(limit = 20, offset = 0) {
  return db.prepare(`
    SELECT name, filename, trade_count, base_rarity_score, popularity_score, comment_count, is_main_character
    FROM touhous
    WHERE owner_id IS NULL
    ORDER BY name
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * Count available Touhous.
 */
function getAvailableCount() {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM touhous WHERE owner_id IS NULL').get();
  return row.cnt;
}

/**
 * Adopt a random Touhou from the market.
 * The user does not choose — one is assigned at random.
 * Returns { success, touhou, error }.
 */
function adoptTouhou(userId) {
  const touhou = db.prepare(`
    SELECT * FROM touhous WHERE owner_id IS NULL ORDER BY RANDOM() LIMIT 1
  `).get();
  if (!touhou) return { success: false, error: 'There are no Touhous available for adoption right now!' };

  const price = BASE_ADOPT_PRICE;

  db.prepare(`
    UPDATE touhous SET owner_id = ?, adopted_at = datetime('now') WHERE name = ?
  `).run(userId, touhou.name);

  // Record as a trade from market
  db.prepare(`
    INSERT INTO touhou_trades (touhou_name, from_user_id, to_user_id, price, trade_type)
    VALUES (?, '__MARKET__', ?, ?, 'adopt')
  `).run(touhou.name, userId, price);

  return { success: true, touhou: { ...touhou, owner_id: userId }, price };
}

/**
 * Get all Touhous owned by a user.
 */
function getUserTouhous(userId) {
  return db.prepare(`
    SELECT name, filename, trade_count, base_rarity_score, popularity_score, comment_count, is_main_character, adopted_at, last_traded
    FROM touhous
    WHERE owner_id = ?
    ORDER BY name
  `).all(userId);
}

/**
 * Get a specific Touhou by name.
 */
function getTouhou(touhouName) {
  return db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouName) || null;
}

/**
 * Send a Touhou to another user (free transfer / gift).
 * Momiji cannot be transferred away from .doll/.
 */
function sendTouhou(fromUserId, toUserId, touhouName) {
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName && fromUserId === DOLL_USER_ID) {
    return { success: false, error: 'Momiji Inubashiri can never leave .doll/\'s collection.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (touhou.owner_id !== fromUserId) return { success: false, error: 'You don\'t own that Touhou.' };
  if (fromUserId === toUserId) return { success: false, error: 'You can\'t send a Touhou to yourself.' };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE name = ?
    `).run(toUserId, touhouName);

    db.prepare(`
      INSERT INTO touhou_trades (touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, 0, 'gift')
    `).run(touhouName, fromUserId, toUserId);
  });
  tx();

  const updated = getTouhou(touhouName);
  return { success: true, touhou: updated };
}

/**
 * Trade a Touhou for SGC (sell).
 * The buyer pays the seller the agreed price.
 * Momiji cannot be sold by .doll/.
 */
function sellTouhou(sellerId, buyerId, touhouName, price) {
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName && sellerId === DOLL_USER_ID) {
    return { success: false, error: 'Momiji Inubashiri can never leave .doll/\'s collection.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (touhou.owner_id !== sellerId) return { success: false, error: 'Seller doesn\'t own that Touhou.' };
  if (sellerId === buyerId) return { success: false, error: 'You can\'t sell a Touhou to yourself.' };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE name = ?
    `).run(buyerId, touhouName);

    db.prepare(`
      INSERT INTO touhou_trades (touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, ?, 'sale')
    `).run(touhouName, sellerId, buyerId, price);
  });
  tx();

  const updated = getTouhou(touhouName);
  return { success: true, touhou: updated };
}

/**
 * Swap two Touhous between two users.
 * Neither can be Momiji if owned by .doll/.
 */
function swapTouhous(userAId, touhouAName, userBId, touhouBName) {
  const momijiName = path.parse(MOMIJI_FILE).name;
  if ((touhouAName === momijiName && userAId === DOLL_USER_ID) ||
      (touhouBName === momijiName && userBId === DOLL_USER_ID)) {
    return { success: false, error: 'Momiji Inubashiri can never leave .doll/\'s collection.' };
  }

  const touhouA = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouAName);
  const touhouB = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouBName);
  if (!touhouA || !touhouB) return { success: false, error: 'One or both Touhous don\'t exist.' };
  if (touhouA.owner_id !== userAId) return { success: false, error: `You don't own **${touhouAName}**.` };
  if (touhouB.owner_id !== userBId) return { success: false, error: `They don't own **${touhouBName}**.` };

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE name = ?
    `).run(userBId, touhouAName);

    db.prepare(`
      UPDATE touhous
      SET owner_id = ?, trade_count = trade_count + 1, last_traded = datetime('now')
      WHERE name = ?
    `).run(userAId, touhouBName);

    db.prepare(`
      INSERT INTO touhou_trades (touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, 0, 'swap')
    `).run(touhouAName, userAId, userBId);

    db.prepare(`
      INSERT INTO touhou_trades (touhou_name, from_user_id, to_user_id, price, trade_type)
      VALUES (?, ?, ?, 0, 'swap')
    `).run(touhouBName, userBId, userAId);
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
function listForSale(sellerId, touhouName, price) {
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName && sellerId === DOLL_USER_ID) {
    return { success: false, error: 'Momiji Inubashiri can never be listed for sale.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (touhou.owner_id !== sellerId) return { success: false, error: 'You don\'t own that Touhou.' };

  // Check if already listed
  const existing = db.prepare('SELECT id FROM touhou_listings WHERE touhou_name = ?').get(touhouName);
  if (existing) {
    db.prepare('UPDATE touhou_listings SET price = ?, seller_id = ?, created_at = datetime(\'now\') WHERE touhou_name = ?')
      .run(price, sellerId, touhouName);
  } else {
    db.prepare('INSERT INTO touhou_listings (touhou_name, seller_id, price) VALUES (?, ?, ?)')
      .run(touhouName, sellerId, price);
  }

  return { success: true };
}

/**
 * Remove a Touhou listing.
 */
function delistTouhou(sellerId, touhouName) {
  const listing = db.prepare('SELECT * FROM touhou_listings WHERE touhou_name = ? AND seller_id = ?').get(touhouName, sellerId);
  if (!listing) return { success: false, error: 'You don\'t have that Touhou listed for sale.' };

  db.prepare('DELETE FROM touhou_listings WHERE touhou_name = ? AND seller_id = ?').run(touhouName, sellerId);
  return { success: true };
}

/**
 * Get all active listings.
 */
function getListings() {
  return db.prepare(`
    SELECT l.touhou_name, l.seller_id, l.price, l.created_at,
        t.trade_count, t.filename, t.base_rarity_score, t.popularity_score, t.comment_count, t.is_main_character
    FROM touhou_listings l
    JOIN touhous t ON t.name = l.touhou_name
    WHERE t.owner_id = l.seller_id
    ORDER BY l.created_at DESC
  `).all();
}

/**
 * Get the listing price for a Touhou (or null if not listed).
 */
function getListingPrice(touhouName) {
  const listing = db.prepare(`
    SELECT l.price
    FROM touhou_listings l
    JOIN touhous t ON t.name = l.touhou_name
    WHERE l.touhou_name = ? AND t.owner_id = l.seller_id
  `).get(touhouName);
  return listing ? listing.price : null;
}

/**
 * Buy a listed Touhou.
 */
function buyListing(buyerId, touhouName) {
  const listing = db.prepare(`
    SELECT l.*, t.owner_id
    FROM touhou_listings l
    JOIN touhous t ON t.name = l.touhou_name
    WHERE l.touhou_name = ? AND t.owner_id = l.seller_id
  `).get(touhouName);

  if (!listing) return { success: false, error: 'That listing doesn\'t exist or is invalid.', price: 0 };
  if (listing.seller_id === buyerId) return { success: false, error: 'You can\'t buy your own listing.', price: 0 };

  const result = sellTouhou(listing.seller_id, buyerId, touhouName, listing.price);
  if (!result.success) return { ...result, price: listing.price };

  // Remove the listing
  db.prepare('DELETE FROM touhou_listings WHERE touhou_name = ?').run(touhouName);

  return { success: true, touhou: result.touhou, price: listing.price, sellerId: listing.seller_id };
}

// ---------------------------------------------------------------------------
// Trade history
// ---------------------------------------------------------------------------

function getTradeHistory(touhouName, limit = 10) {
  return db.prepare(`
    SELECT * FROM touhou_trades
    WHERE touhou_name = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(touhouName, limit);
}

function getUserTradeHistory(userId, limit = 10) {
  return db.prepare(`
    SELECT * FROM touhou_trades
    WHERE from_user_id = ? OR to_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, userId, limit);
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

/**
 * Force-assign a Touhou to a user (admin).
 */
function adminAssign(touhouName, userId) {
  const touhou = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };

  db.prepare(`
    UPDATE touhous SET owner_id = ?, adopted_at = COALESCE(adopted_at, datetime('now'))
    WHERE name = ?
  `).run(userId, touhouName);

  // Remove any listing
  db.prepare('DELETE FROM touhou_listings WHERE touhou_name = ?').run(touhouName);

  return { success: true };
}

/**
 * Force-release a Touhou back to the market (admin).
 * Cannot release Momiji from .doll/.
 */
function adminRelease(touhouName) {
  const momijiName = path.parse(MOMIJI_FILE).name;
  if (touhouName === momijiName) {
    return { success: false, error: 'Momiji Inubashiri can never be released.' };
  }

  const touhou = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };
  if (!touhou.owner_id) return { success: false, error: 'That Touhou is already unclaimed.' };

  db.prepare('UPDATE touhous SET owner_id = NULL WHERE name = ?').run(touhouName);
  db.prepare('DELETE FROM touhou_listings WHERE touhou_name = ?').run(touhouName);

  return { success: true };
}

/**
 * Reset trade count for a Touhou (admin).
 */
function adminResetTrades(touhouName) {
  const touhou = db.prepare('SELECT * FROM touhous WHERE name = ?').get(touhouName);
  if (!touhou) return { success: false, error: 'That Touhou doesn\'t exist.' };

  db.prepare('UPDATE touhous SET trade_count = 0 WHERE name = ?').run(touhouName);
  return { success: true };
}

/**
 * Get global stats.
 */
function getMarketStats() {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM touhous').get().cnt;
  const owned = db.prepare('SELECT COUNT(*) as cnt FROM touhous WHERE owner_id IS NOT NULL').get().cnt;
  const available = total - owned;
  const totalTrades = db.prepare('SELECT COUNT(*) as cnt FROM touhou_trades').get().cnt;
  const listings = db.prepare('SELECT COUNT(*) as cnt FROM touhou_listings').get().cnt;
  const topTraded = db.prepare('SELECT name, trade_count FROM touhous ORDER BY trade_count DESC LIMIT 5').all();
  const topCollectors = db.prepare(`
    SELECT owner_id, COUNT(*) as cnt
    FROM touhous
    WHERE owner_id IS NOT NULL AND owner_id != '__MARKET__'
    ORDER BY cnt DESC
    LIMIT 5
  `).all();

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
function searchTouhous(pattern) {
  return db.prepare(`
    SELECT name, filename, owner_id, trade_count, base_rarity_score, popularity_score, comment_count, is_main_character
    FROM touhous
    WHERE name LIKE ?
    ORDER BY name
    LIMIT 20
  `).all(`%${pattern}%`);
}

module.exports = {
  DOLL_USER_ID,
  BASE_ADOPT_PRICE,
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
};
