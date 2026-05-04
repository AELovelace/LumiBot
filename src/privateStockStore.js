/**
 * Private Stock Store — SQLite-backed exchange for Big Business shares.
 *
 * Key rules:
 *  - Market cap = current Big Business value + current user investment capital.
 *  - Price is supply/demand driven with a performance-weighted intrinsic floor.
 *  - Synthetic companies fill the exchange up to 10 listings when fewer than
 *    10 real guild businesses exist.
 *  - If real guild businesses exceed 10, every real guild stock is listed and
 *    the exchange expands beyond 10 tickers.
 */

const { logger } = require('./logger');
const {
  getBalance,
  adjustBalance,
  ensureAccount,
  getBigBusinessBalance,
  depositBigBusiness,
  DOLL_STREET_USER_ID,
} = require('./sadgirlEconomyStore');
const { getBigBusinessUserId, getAllGuildConfigs } = require('./guildConfig');

let db = null;
let syncInProgress = false;

const TARGET_EXCHANGE_SIZE = 10;
const SYNTHETIC_POOL_SIZE = 18;
const MIN_SHARE_PRICE = 1;
const MAX_SHARE_PRICE = 250_000;
const BASE_REFERENCE_FLOAT = 100;
const MIN_PERFORMANCE_SCORE = 0.55;
const MAX_PERFORMANCE_SCORE = 1.85;
const SYNTHETIC_DEVIATIONS = [-0.36, -0.28, -0.21, -0.15, -0.1, -0.05, 0.02, 0.08, 0.14, 0.2, 0.27, 0.34, 0.44, 0.56, 0.68, 0.82, 0.96, 1.1];
const COMPANY_STOP_WORDS = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'group', 'holdings']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundMetric(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

function isSyntheticStock(stock) {
  return stock?.entity_type === 'synthetic' || String(stock?.guild_id || '').startsWith('__SYNTH_');
}

function parseStockMetadata(stock) {
  if (!stock || typeof stock.metadata_json !== 'string' || !stock.metadata_json.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(stock.metadata_json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStockMetadata(stockId, metadata) {
  db.prepare(`
    UPDATE bb_stocks
    SET metadata_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(metadata || {}), stockId);
}

function getAllStocksRaw(includeInactive = true) {
  if (!db) return [];
  const where = includeInactive ? '' : "WHERE status = 'active' AND is_listed = 1";
  return db.prepare(`SELECT * FROM bb_stocks ${where} ORDER BY display_order ASC, business_name ASC`).all();
}

function getTableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function ensureColumn(tableName, columnName, definition) {
  const columns = getTableColumns(tableName);
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function createPrivateStockSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bb_stocks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id          TEXT NOT NULL UNIQUE,
      ticker            TEXT NOT NULL,
      business_name     TEXT NOT NULL,
      share_price       REAL NOT NULL DEFAULT 25.00,
      initial_price     REAL NOT NULL DEFAULT 25.00,
      total_issued      REAL NOT NULL DEFAULT 0,
      total_outstanding REAL NOT NULL DEFAULT 0,
      dividend_rate     REAL NOT NULL DEFAULT 0.05,
      total_dividends_paid REAL NOT NULL DEFAULT 0,
      ipo_date          TEXT NOT NULL DEFAULT (datetime('now')),
      last_dividend     TEXT DEFAULT NULL,
      status            TEXT NOT NULL DEFAULT 'active',
      entity_type       TEXT NOT NULL DEFAULT 'guild',
      is_listed         INTEGER NOT NULL DEFAULT 1,
      synthetic_treasury REAL NOT NULL DEFAULT 0,
      performance_score REAL NOT NULL DEFAULT 1,
      demand_pressure   REAL NOT NULL DEFAULT 0,
      base_performance  REAL NOT NULL DEFAULT 1,
      display_order     INTEGER NOT NULL DEFAULT 0,
      metadata_json     TEXT NOT NULL DEFAULT '{}',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bb_shareholders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id        INTEGER NOT NULL REFERENCES bb_stocks(id),
      user_id         TEXT NOT NULL,
      username        TEXT NOT NULL DEFAULT '',
      shares          REAL NOT NULL DEFAULT 0,
      avg_cost_basis  REAL NOT NULL DEFAULT 0,
      total_invested  REAL NOT NULL DEFAULT 0,
      total_dividends REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(stock_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bb_transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id        INTEGER NOT NULL REFERENCES bb_stocks(id),
      user_id         TEXT NOT NULL,
      type            TEXT NOT NULL,
      shares          REAL NOT NULL DEFAULT 0,
      price_per_share REAL NOT NULL DEFAULT 0,
      total_amount    REAL NOT NULL DEFAULT 0,
      note            TEXT DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bb_dividend_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id          INTEGER NOT NULL REFERENCES bb_stocks(id),
      total_pool        REAL NOT NULL DEFAULT 0,
      dividend_per_share REAL NOT NULL DEFAULT 0,
      shareholders_paid INTEGER NOT NULL DEFAULT 0,
      total_distributed REAL NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bb_shareholders_stock ON bb_shareholders(stock_id);
    CREATE INDEX IF NOT EXISTS idx_bb_shareholders_user ON bb_shareholders(user_id);
    CREATE INDEX IF NOT EXISTS idx_bb_transactions_stock ON bb_transactions(stock_id);
    CREATE INDEX IF NOT EXISTS idx_bb_transactions_user ON bb_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_bb_dividend_log_stock ON bb_dividend_log(stock_id);
  `);

  ensureColumn('bb_stocks', 'entity_type', "TEXT NOT NULL DEFAULT 'guild'");
  ensureColumn('bb_stocks', 'is_listed', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('bb_stocks', 'synthetic_treasury', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('bb_stocks', 'performance_score', 'REAL NOT NULL DEFAULT 1');
  ensureColumn('bb_stocks', 'demand_pressure', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('bb_stocks', 'base_performance', 'REAL NOT NULL DEFAULT 1');
  ensureColumn('bb_stocks', 'display_order', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('bb_stocks', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");

  db.exec(`
    UPDATE bb_stocks
    SET entity_type = CASE
      WHEN guild_id LIKE '__SYNTH_%' THEN 'synthetic'
      ELSE 'guild'
    END
    WHERE entity_type IS NULL OR entity_type = '';
  `);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initPrivateStockStore(economyDb) {
  db = economyDb;
  createPrivateStockSchema();
  syncStockUniverse();
  logger.info('Private Stock Store initialized.');
}

function getDb() {
  return db;
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/**
 * Fixed pool of distinctive fictional company names for synthetic stocks.
 * These are intentionally quirky / thematic so they can never be confused
 * with a guild's real Big Business.
 */
const SYNTHETIC_COMPANY_NAMES = [
  'Midnight Ramen LLC',
  'Crescent Moon Logistics',
  'Phantom Vinyl Co',
  'Starfall Apothecary',
  'Neon Tanuki Labs',
  'Velvet Abyss Capital',
  'Sunken Garden Brewing',
  'Ghost Frequency Media',
  'Paper Lantern Ventures',
  'Iron Blossom Works',
  'Sleepy Moth Transit',
  'Deep Fog Analytics',
  'Rooftop Shrine Partners',
  'Lost Signal Devices',
  'Coral Dusk Exports',
  'Silver Rumor Press',
  'Hollow Star Textiles',
  'Driftwood & Ember Co',
];

function generateSyntheticCompanyNames(realNames, count = SYNTHETIC_POOL_SIZE) {
  const seen = new Set(realNames.map((name) => String(name).toLowerCase()));
  return SYNTHETIC_COMPANY_NAMES
    .filter((name) => !seen.has(name.toLowerCase()))
    .slice(0, count);
}

function createTicker(baseName, taken = new Set()) {
  const words = String(baseName || '')
    .split(/[^a-z0-9]+/iu)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !COMPANY_STOP_WORDS.has(part.toLowerCase()));

  const candidates = [];

  if (words.length >= 2) {
    candidates.push(words.map((word) => word[0]).join('').toUpperCase().slice(0, 5));
    candidates.push(`${words[0].slice(0, 2)}${words[1].slice(0, 2)}`.toUpperCase().slice(0, 5));
  }
  if (words.length >= 1) {
    candidates.push(words[0].replace(/[^a-z0-9]/giu, '').slice(0, 5).toUpperCase());
  }

  candidates.push('LUMI');

  for (const candidate of candidates) {
    if (candidate && !taken.has(candidate)) return candidate;
  }

  const stem = (candidates.find(Boolean) || 'LUMI').slice(0, 4);
  let suffix = 1;
  while (taken.has(`${stem}${suffix}`.slice(0, 5))) {
    suffix += 1;
  }
  return `${stem}${suffix}`.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Treasury / valuation helpers
// ---------------------------------------------------------------------------

function getCorporateTreasuryBalance(stock) {
  if (!stock) return 0;
  if (isSyntheticStock(stock)) {
    return Number(stock.synthetic_treasury) || 0;
  }

  return getBigBusinessBalance(getBigBusinessUserId(stock.guild_id));
}

function getCurrentInvestmentCapital(stockId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(total_invested), 0) AS invested
    FROM bb_shareholders
    WHERE stock_id = ? AND shares > 0.0001
  `).get(stockId);

  return Number(row?.invested) || 0;
}

function getOutstandingShares(stockId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(shares), 0) AS shares
    FROM bb_shareholders
    WHERE stock_id = ? AND shares > 0.0001
  `).get(stockId);

  return Number(row?.shares) || 0;
}

function getMarketCapValue(stock) {
  if (!stock) return 0;
  const treasuryBalance = getCorporateTreasuryBalance(stock);
  const investedCapital = getCurrentInvestmentCapital(stock.id);
  return treasuryBalance + investedCapital;
}

function getRealGuildStocksRaw() {
  return getAllStocksRaw(true).filter((stock) => stock.entity_type !== 'synthetic');
}

function getRealMarketSnapshot() {
  const realStocks = getRealGuildStocksRaw().filter((stock) => stock.status !== 'inactive');
  if (realStocks.length === 0) {
    return {
      count: 0,
      averageTreasury: 1_000,
      averageInvested: 250,
      treasuryStdDev: 0.15,
    };
  }

  const treasuries = realStocks.map((stock) => Math.max(1, getCorporateTreasuryBalance(stock)));
  const invested = realStocks.map((stock) => Math.max(0, getCurrentInvestmentCapital(stock.id)));
  const averageTreasury = treasuries.reduce((sum, value) => sum + value, 0) / treasuries.length;
  const averageInvested = invested.reduce((sum, value) => sum + value, 0) / invested.length;
  const variance = treasuries.reduce((sum, value) => sum + ((value - averageTreasury) ** 2), 0) / treasuries.length;

  return {
    count: realStocks.length,
    averageTreasury,
    averageInvested,
    treasuryStdDev: Math.sqrt(variance) / Math.max(1, averageTreasury),
  };
}

function buildPerformanceMetrics(stock, treasuryBalance, investedCapital, snapshot) {
  const relativeTreasury = (treasuryBalance - snapshot.averageTreasury) / Math.max(1, snapshot.averageTreasury);
  const relativeInvested = (investedCapital - snapshot.averageInvested) / Math.max(1, snapshot.averageInvested || 1);
  const demandPressure = Number(stock.demand_pressure) || 0;
  const performanceScore = Number(stock.performance_score) || 1;

  const revenueGrowth = roundMetric((relativeTreasury * 28) + (demandPressure * 35));
  const operatingMargin = roundMetric(12 + ((performanceScore - 1) * 22));
  const cashFlow = roundMetric((relativeInvested * 18) + (relativeTreasury * 24));
  const guidance = roundMetric((performanceScore - 1) * 100);
  const sentiment = performanceScore >= 1.25
    ? 'Bullish'
    : performanceScore <= 0.85
      ? 'Bearish'
      : 'Stable';

  return {
    revenueGrowthPct: revenueGrowth,
    operatingMarginPct: operatingMargin,
    cashFlowPct: cashFlow,
    guidancePct: guidance,
    sentiment,
  };
}

function computeTargetPerformanceScore(stock, snapshot) {
  const investedCapital = getCurrentInvestmentCapital(stock.id);

  if (isSyntheticStock(stock)) {
    const basePerformance = Number(stock.base_performance) || 1;
    const syntheticScore = 1 + ((basePerformance - 1) * (0.9 + snapshot.treasuryStdDev));
    return clamp(syntheticScore, MIN_PERFORMANCE_SCORE, MAX_PERFORMANCE_SCORE);
  }

  const treasuryBalance = getCorporateTreasuryBalance(stock);
  const treasuryDelta = (treasuryBalance - snapshot.averageTreasury) / Math.max(1, snapshot.averageTreasury);
  const investmentDelta = (investedCapital - snapshot.averageInvested) / Math.max(1, snapshot.averageInvested || 1);
  const demandPressure = Number(stock.demand_pressure) || 0;

  const score = 1 + (treasuryDelta * 0.5) + (investmentDelta * 0.18) + (demandPressure * 0.22);
  return clamp(score, MIN_PERFORMANCE_SCORE, MAX_PERFORMANCE_SCORE);
}

function refreshSyntheticTreasury(stock, snapshot) {
  const targetBalance = Math.max(200, snapshot.averageTreasury * (Number(stock.performance_score) || 1));
  const currentBalance = Number(stock.synthetic_treasury) || 0;
  const nextBalance = currentBalance > 0
    ? ((currentBalance * 0.7) + (targetBalance * 0.3))
    : targetBalance;

  return roundCurrency(nextBalance);
}

function persistPerformanceSnapshot(stock) {
  const snapshot = getRealMarketSnapshot();
  const nextPerformance = computeTargetPerformanceScore(stock, snapshot);
  const decayedPressure = clamp((Number(stock.demand_pressure) || 0) * 0.97, -0.45, 0.65);
  let syntheticTreasury = Number(stock.synthetic_treasury) || 0;

  if (isSyntheticStock(stock)) {
    syntheticTreasury = refreshSyntheticTreasury({ ...stock, performance_score: nextPerformance }, snapshot);
  }

  db.prepare(`
    UPDATE bb_stocks
    SET performance_score = ?,
        demand_pressure = ?,
        synthetic_treasury = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(nextPerformance, decayedPressure, syntheticTreasury, stock.id);
}

function snapshotPriceFallback(stock) {
  const treasuryBalance = getCorporateTreasuryBalance(stock);
  if (treasuryBalance > 0) {
    return treasuryBalance / BASE_REFERENCE_FLOAT;
  }

  return Number(stock.initial_price) || 25;
}

function calculateDynamicPrice(stock) {
  const treasuryBalance = getCorporateTreasuryBalance(stock);
  const investedCapital = getCurrentInvestmentCapital(stock.id);
  const outstandingShares = Math.max(getOutstandingShares(stock.id), Number(stock.total_outstanding) || 0, 0);
  const referenceFloat = Math.max(outstandingShares, BASE_REFERENCE_FLOAT);
  const marketCap = treasuryBalance + investedCapital;
  const intrinsicPerShare = marketCap > 0
    ? marketCap / referenceFloat
    : Math.max(MIN_SHARE_PRICE, snapshotPriceFallback(stock));
  const performanceMultiplier = clamp(0.85 + ((Number(stock.performance_score) || 1) - 1) * 0.7, 0.65, 1.55);
  const demandMultiplier = clamp(1 + (Number(stock.demand_pressure) || 0), 0.5, 1.8);

  return roundCurrency(clamp(intrinsicPerShare * performanceMultiplier * demandMultiplier, MIN_SHARE_PRICE, MAX_SHARE_PRICE));
}

function recordPriceChangeIfNeeded(stockId, oldPrice, newPrice, note) {
  if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice)) return;
  if (Math.abs(oldPrice - newPrice) < 0.01) return;

  db.prepare(`
    INSERT INTO bb_transactions (stock_id, user_id, type, price_per_share, total_amount, note)
    VALUES (?, '__SYSTEM__', 'price_change', ?, ?, ?)
  `).run(stockId, newPrice, newPrice - oldPrice, note);
}

function recalculatePrice(stockId, reason = 'automatic repricing') {
  const stock = getStockById(stockId);
  if (!stock) return null;

  persistPerformanceSnapshot(stock);
  const refreshed = getStockById(stockId);
  const oldPrice = Number(refreshed.share_price) || 0;
  const newPrice = calculateDynamicPrice(refreshed);

  db.prepare(`
    UPDATE bb_stocks
    SET share_price = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newPrice, stockId);

  recordPriceChangeIfNeeded(stockId, oldPrice, newPrice, reason);
  return newPrice;
}

function applyTradeImpact(stockId, direction, notionalAmount) {
  const stock = getStockById(stockId);
  if (!stock) return null;

  const liquidityBase = Math.max(250, getMarketCapValue(stock));
  const delta = clamp((notionalAmount / liquidityBase) * 0.4, 0.005, 0.22);
  const nextPressure = clamp(
    ((Number(stock.demand_pressure) || 0) * 0.9) + (direction === 'buy' ? delta : -delta),
    -0.45,
    0.65,
  );

  db.prepare(`
    UPDATE bb_stocks
    SET demand_pressure = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nextPressure, stockId);

  return recalculatePrice(stockId, `${direction} pressure repricing`);
}

// ---------------------------------------------------------------------------
// Exchange synchronization
// ---------------------------------------------------------------------------

function ensureStockForGuild(guildId, businessName) {
  const existing = db.prepare('SELECT * FROM bb_stocks WHERE guild_id = ?').get(guildId);

  if (existing) {
    db.prepare(`
      UPDATE bb_stocks
      SET business_name = ?, entity_type = 'guild', status = 'active', is_listed = 1, updated_at = datetime('now')
      WHERE guild_id = ?
    `).run(businessName, guildId);
    return existing.id;
  }

  const takenTickers = new Set(getAllStocksRaw(true).map((stock) => stock.ticker));
  const ticker = createTicker(businessName, takenTickers);
  const result = db.prepare(`
    INSERT INTO bb_stocks (guild_id, ticker, business_name, share_price, initial_price, entity_type, status, is_listed, base_performance)
    VALUES (?, ?, ?, 25.00, 25.00, 'guild', 'active', 1, 1.0)
  `).run(guildId, ticker, businessName);

  logger.info(`Private Stock: created stock ${ticker} for ${businessName} (guild ${guildId}).`);
  return result.lastInsertRowid;
}

function ensureSyntheticStockPool(realNames) {
  const currentStocks = getAllStocksRaw(true);
  const currentTickers = new Set(currentStocks.map((stock) => stock.ticker));
  const names = generateSyntheticCompanyNames(realNames, SYNTHETIC_POOL_SIZE);

  names.forEach((businessName, index) => {
    const syntheticGuildId = `__SYNTH_${index + 1}__`;
    const existing = db.prepare('SELECT * FROM bb_stocks WHERE guild_id = ?').get(syntheticGuildId);
    const basePerformance = clamp(1 + (SYNTHETIC_DEVIATIONS[index % SYNTHETIC_DEVIATIONS.length] * 0.75), MIN_PERFORMANCE_SCORE, MAX_PERFORMANCE_SCORE);

    if (existing) {
      const metadata = parseStockMetadata(existing);
      const preserveCustomName = metadata.customName === true && String(existing.business_name || '').trim().length > 0;
      const effectiveName = preserveCustomName ? existing.business_name : businessName;

      // Always regenerate ticker from current name unless manually set
      const preserveCustomTicker = metadata.customTicker === true;
      let effectiveTicker = existing.ticker;
      if (!preserveCustomTicker) {
        currentTickers.delete(existing.ticker);
        const candidate = createTicker(effectiveName, currentTickers);
        if (candidate !== existing.ticker) {
          effectiveTicker = candidate;
        }
        currentTickers.add(effectiveTicker);
      }

      db.prepare(`
        UPDATE bb_stocks
        SET business_name = ?,
            ticker = ?,
            entity_type = 'synthetic',
            base_performance = ?,
            updated_at = datetime('now')
        WHERE guild_id = ?
      `).run(effectiveName, effectiveTicker, basePerformance, syntheticGuildId);
      return;
    }

    const ticker = createTicker(businessName, currentTickers);
    currentTickers.add(ticker);

    db.prepare(`
      INSERT INTO bb_stocks (
        guild_id, ticker, business_name, share_price, initial_price, status,
        entity_type, is_listed, synthetic_treasury, performance_score, base_performance, display_order
      ) VALUES (?, ?, ?, 25.00, 25.00, 'delisted', 'synthetic', 0, 500.00, ?, ?, ?)
    `).run(syntheticGuildId, ticker, businessName, basePerformance, basePerformance, 100 + index);
  });
}

function syncStockUniverse() {
  if (!db || syncInProgress) return;
  syncInProgress = true;

  try {
    const activeGuilds = getAllGuildConfigs().filter((cfg) => cfg.enabled);
    const activeGuildIds = new Set(activeGuilds.map((cfg) => cfg.guildId));

    for (const cfg of activeGuilds) {
      ensureStockForGuild(cfg.guildId, cfg.bigBusinessName);
    }

    if (activeGuilds.length > 0) {
      db.prepare(`
        UPDATE bb_stocks
        SET status = 'inactive', is_listed = 0, updated_at = datetime('now')
        WHERE entity_type = 'guild' AND guild_id NOT IN (${activeGuilds.map(() => '?').join(',')})
      `).run(...activeGuilds.map((cfg) => cfg.guildId));
    } else {
      db.prepare(`
        UPDATE bb_stocks
        SET status = 'inactive', is_listed = 0, updated_at = datetime('now')
        WHERE entity_type = 'guild'
      `).run();
    }

    ensureSyntheticStockPool(activeGuilds.map((cfg) => cfg.bigBusinessName));

    const allStocks = getAllStocksRaw(true);
    for (const stock of allStocks) {
      persistPerformanceSnapshot(stock);
    }

    const refreshedStocks = getAllStocksRaw(true);
    const realStocks = refreshedStocks.filter((stock) => stock.entity_type !== 'synthetic' && activeGuildIds.has(stock.guild_id));
    const syntheticStocks = refreshedStocks.filter((stock) => stock.entity_type === 'synthetic');

    let listedIds = [];
    if (realStocks.length > TARGET_EXCHANGE_SIZE) {
      listedIds = realStocks.map((stock) => stock.id);
    } else {
      const syntheticSlots = Math.max(0, TARGET_EXCHANGE_SIZE - realStocks.length);
      const bestSynthetic = syntheticStocks
        .sort((a, b) => {
          const perfDiff = (Number(b.performance_score) || 0) - (Number(a.performance_score) || 0);
          if (Math.abs(perfDiff) > 0.0001) return perfDiff;
          return (Number(b.synthetic_treasury) || 0) - (Number(a.synthetic_treasury) || 0);
        })
        .slice(0, syntheticSlots);

      listedIds = [...realStocks.map((stock) => stock.id), ...bestSynthetic.map((stock) => stock.id)];
    }

    const listedSet = new Set(listedIds);
    const orderedListed = getAllStocksRaw(true)
      .filter((stock) => listedSet.has(stock.id))
      .sort((a, b) => {
        if (a.entity_type !== b.entity_type) return a.entity_type === 'guild' ? -1 : 1;
        return (Number(b.performance_score) || 0) - (Number(a.performance_score) || 0);
      });

    for (const stock of getAllStocksRaw(true)) {
      const listed = listedSet.has(stock.id);
      const status = stock.entity_type === 'guild'
        ? (activeGuildIds.has(stock.guild_id) ? 'active' : 'inactive')
        : (listed ? 'active' : 'delisted');
      const displayOrder = listed ? orderedListed.findIndex((candidate) => candidate.id === stock.id) : 999;

      db.prepare(`
        UPDATE bb_stocks
        SET status = ?, is_listed = ?, display_order = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(status, listed ? 1 : 0, displayOrder >= 0 ? displayOrder : 999, stock.id);

      if (listed) {
        recalculatePrice(stock.id, 'listing sync repricing');
      }
    }
  } finally {
    syncInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Stock queries
// ---------------------------------------------------------------------------

function getStockByGuild(guildId) {
  if (!db) return null;
  syncStockUniverse();
  return db.prepare('SELECT * FROM bb_stocks WHERE guild_id = ?').get(guildId) || null;
}

function getStockById(stockId) {
  if (!db) return null;
  return db.prepare('SELECT * FROM bb_stocks WHERE id = ?').get(stockId) || null;
}

function getStockByTicker(ticker) {
  if (!db) return null;
  syncStockUniverse();
  return db.prepare(`
    SELECT * FROM bb_stocks
    WHERE lower(ticker) = lower(?)
    ORDER BY is_listed DESC, status = 'active' DESC, entity_type = 'guild' DESC
    LIMIT 1
  `).get(String(ticker || '')) || null;
}

function getAllStocks(options = {}) {
  syncStockUniverse();
  return getAllStocksRaw(Boolean(options.includeInactive));
}

function setSharePrice(stockId, newPrice) {
  if (newPrice <= 0) return { success: false, error: 'Price must be positive.' };

  const stock = getStockById(stockId);
  if (!stock) return { success: false, error: 'Stock not found.' };

  const roundedPrice = roundCurrency(newPrice);
  const oldPrice = Number(stock.share_price) || 0;
  db.prepare(`
    UPDATE bb_stocks
    SET share_price = ?, demand_pressure = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(roundedPrice, stockId);

  recordPriceChangeIfNeeded(stockId, oldPrice, roundedPrice, `Admin override from ${oldPrice.toFixed(2)} to ${roundedPrice.toFixed(2)}`);
  return { success: true, oldPrice, newPrice: roundedPrice };
}

function setDividendRate(stockId, rate) {
  if (rate < 0 || rate > 1) {
    return { success: false, error: 'Rate must be between 0 and 1 (0% to 100%).' };
  }

  db.prepare(`
    UPDATE bb_stocks
    SET dividend_rate = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(rate, stockId);

  return { success: true };
}

function renameStock(stockId, newName, options = {}) {
  const stock = getStockById(stockId);
  if (!stock) {
    return { success: false, error: 'Stock not found.' };
  }

  const normalized = String(newName || '').trim();
  if (!normalized) {
    return { success: false, error: 'Stock name cannot be empty.' };
  }

  if (normalized.length > 80) {
    return { success: false, error: 'Stock name is too long (max 80 characters).' };
  }

  const metadata = parseStockMetadata(stock);
  if (isSyntheticStock(stock)) {
    metadata.customName = options.lockSyntheticName !== false;
  }

  db.prepare(`
    UPDATE bb_stocks
    SET business_name = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(normalized, stockId);

  writeStockMetadata(stockId, metadata);
  return { success: true, oldName: stock.business_name, newName: normalized };
}

function renameTicker(stockId, newTicker, options = {}) {
  const stock = getStockById(stockId);
  if (!stock) {
    return { success: false, error: 'Stock not found.' };
  }

  const normalized = String(newTicker || '').trim().toUpperCase();
  if (!normalized) {
    return { success: false, error: 'Ticker cannot be empty.' };
  }

  if (normalized.length > 6) {
    return { success: false, error: 'Ticker is too long (max 6 characters).' };
  }

  if (!/^[A-Z0-9]{1,6}$/u.test(normalized)) {
    return { success: false, error: 'Ticker must be alphanumeric (A-Z, 0-9).' };
  }

  const existing = getStockByTicker(normalized);
  if (existing && existing.id !== stockId) {
    return { success: false, error: `Ticker "${normalized}" is already taken by another stock.` };
  }

  const metadata = parseStockMetadata(stock);
  if (isSyntheticStock(stock)) {
    metadata.customTicker = options.lockSyntheticTicker !== false;
  }

  db.prepare(`
    UPDATE bb_stocks
    SET ticker = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(normalized, stockId);

  writeStockMetadata(stockId, metadata);
  return { success: true, oldTicker: stock.ticker, newTicker: normalized };
}

// ---------------------------------------------------------------------------
// Investment logic
// ---------------------------------------------------------------------------

function buyShares(userId, username, stockId, investmentAmount) {
  if (investmentAmount <= 0) {
    return { success: false, error: 'Investment amount must be positive.' };
  }

  syncStockUniverse();
  const stock = getStockById(stockId);
  if (!stock) return { success: false, error: 'Stock not found.' };
  const listedForPurchase = isSyntheticStock(stock)
    || (stock.status === 'active' && Number(stock.is_listed) === 1);
  if (!listedForPurchase) {
    return { success: false, error: 'This guild stock is not currently listed for new purchases.' };
  }

  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < investmentAmount) {
    return { success: false, error: `Insufficient funds. You have ${balance} SGC but need ${investmentAmount} SGC.` };
  }

  const pricePerShare = Number(stock.share_price) || 0;
  if (pricePerShare <= 0) {
    return { success: false, error: 'This stock has an invalid price right now. Try again in a moment.' };
  }

  const dollStreetCut = roundCurrency(investmentAmount * 0.05);
  const netInvestment  = roundCurrency(investmentAmount - dollStreetCut);
  const sharesBought   = netInvestment / pricePerShare;

  const result = db.transaction(() => {
    adjustBalance(userId, -investmentAmount, `Bought ${sharesBought.toFixed(4)} shares of ${stock.ticker}`);

    // 5% Doll Street exchange fee
    if (dollStreetCut > 0) {
      db.prepare(`
        UPDATE accounts
        SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(dollStreetCut, dollStreetCut, DOLL_STREET_USER_ID);
    }

    if (isSyntheticStock(stock)) {
      db.prepare(`
        UPDATE bb_stocks
        SET synthetic_treasury = synthetic_treasury + ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(netInvestment, stockId);
    } else {
      const bbUserId = getBigBusinessUserId(stock.guild_id);
      depositBigBusiness(netInvestment, `Share purchase by ${username}`, bbUserId);
    }

    const existing = db.prepare(
      'SELECT * FROM bb_shareholders WHERE stock_id = ? AND user_id = ?'
    ).get(stockId, userId);

    if (existing) {
      const newTotalInvested = existing.total_invested + investmentAmount;
      const newShares = existing.shares + sharesBought;
      const newAvgCost = newShares > 0 ? newTotalInvested / newShares : 0;

      db.prepare(`
        UPDATE bb_shareholders
        SET shares = ?, avg_cost_basis = ?, total_invested = ?, username = ?, updated_at = datetime('now')
        WHERE stock_id = ? AND user_id = ?
      `).run(newShares, newAvgCost, newTotalInvested, username, stockId, userId);
    } else {
      db.prepare(`
        INSERT INTO bb_shareholders (stock_id, user_id, username, shares, avg_cost_basis, total_invested)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(stockId, userId, username, sharesBought, pricePerShare, investmentAmount);
    }

    db.prepare(`
      UPDATE bb_stocks
      SET total_issued = total_issued + ?,
          total_outstanding = total_outstanding + ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(sharesBought, sharesBought, stockId);

    db.prepare(`
      INSERT INTO bb_transactions (stock_id, user_id, type, shares, price_per_share, total_amount, note)
      VALUES (?, ?, 'buy', ?, ?, ?, ?)
    `).run(
      stockId,
      userId,
      sharesBought,
      pricePerShare,
      investmentAmount,
      `Bought ${sharesBought.toFixed(4)} shares @ ${pricePerShare.toFixed(2)} SGC (${dollStreetCut.toFixed(2)} fee)`,
    );

    const repriced = applyTradeImpact(stockId, 'buy', netInvestment);
    const updatedHolder = db.prepare(
      'SELECT * FROM bb_shareholders WHERE stock_id = ? AND user_id = ?'
    ).get(stockId, userId);

    return {
      success: true,
      shares: sharesBought,
      pricePerShare,
      totalShares: updatedHolder.shares,
      totalInvested: updatedHolder.total_invested,
      newPrice: repriced ?? pricePerShare,
    };
  })();

  return result;
}

function sellShares(userId, username, stockId, sharesToSell) {
  if (sharesToSell <= 0) {
    return { success: false, error: 'Must sell a positive number of shares.' };
  }

  const stock = getStockById(stockId);
  if (!stock) return { success: false, error: 'Stock not found.' };

  const holding = db.prepare(
    'SELECT * FROM bb_shareholders WHERE stock_id = ? AND user_id = ?'
  ).get(stockId, userId);

  if (!holding || holding.shares < sharesToSell) {
    const owned = holding ? holding.shares.toFixed(4) : '0';
    return { success: false, error: `You only own ${owned} shares.` };
  }

  const pricePerShare = Number(stock.share_price) || 0;
  const proceeds = roundCurrency(sharesToSell * pricePerShare);

  const treasuryBalance = getCorporateTreasuryBalance(stock);
  if (treasuryBalance < proceeds) {
    return {
      success: false,
      error: `${stock.business_name} treasury is too illiquid right now (${treasuryBalance.toFixed(0)} SGC).`,
    };
  }

  const result = db.transaction(() => {
    if (isSyntheticStock(stock)) {
      db.prepare(`
        UPDATE bb_stocks
        SET synthetic_treasury = synthetic_treasury - ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(proceeds, stockId);
    } else {
      const bbUserId = getBigBusinessUserId(stock.guild_id);
      adjustBalance(bbUserId, -proceeds, `Share sale by ${username}`);
    }

    adjustBalance(userId, proceeds, `Sold ${sharesToSell.toFixed(4)} shares of ${stock.ticker}`);

    const costBasisRemoved = holding.avg_cost_basis * sharesToSell;
    const newShares = holding.shares - sharesToSell;
    const newTotalInvested = Math.max(0, holding.total_invested - costBasisRemoved);

    if (newShares < 0.0001) {
      db.prepare('DELETE FROM bb_shareholders WHERE stock_id = ? AND user_id = ?').run(stockId, userId);
    } else {
      db.prepare(`
        UPDATE bb_shareholders
        SET shares = ?, avg_cost_basis = ?, total_invested = ?, updated_at = datetime('now')
        WHERE stock_id = ? AND user_id = ?
      `).run(newShares, newTotalInvested / newShares, newTotalInvested, stockId, userId);
    }

    db.prepare(`
      UPDATE bb_stocks
      SET total_outstanding = MAX(0, total_outstanding - ?), updated_at = datetime('now')
      WHERE id = ?
    `).run(sharesToSell, stockId);

    db.prepare(`
      INSERT INTO bb_transactions (stock_id, user_id, type, shares, price_per_share, total_amount, note)
      VALUES (?, ?, 'sell', ?, ?, ?, ?)
    `).run(
      stockId,
      userId,
      sharesToSell,
      pricePerShare,
      proceeds,
      `Sold ${sharesToSell.toFixed(4)} shares @ ${pricePerShare.toFixed(2)} SGC`,
    );

    const repriced = applyTradeImpact(stockId, 'sell', proceeds);

    return {
      success: true,
      proceeds,
      remainingShares: newShares < 0.0001 ? 0 : newShares,
      newPrice: repriced ?? pricePerShare,
    };
  })();

  return result;
}

// ---------------------------------------------------------------------------
// Portfolio / shareholder queries
// ---------------------------------------------------------------------------

function getUserPortfolio(userId) {
  syncStockUniverse();
  return db.prepare(`
    SELECT sh.*, s.ticker, s.business_name, s.share_price, s.guild_id, s.entity_type, s.status, s.performance_score
    FROM bb_shareholders sh
    JOIN bb_stocks s ON sh.stock_id = s.id
    WHERE sh.user_id = ? AND sh.shares > 0.0001
    ORDER BY s.is_listed DESC, s.business_name ASC
  `).all(userId);
}

function getUserHolding(userId, stockId) {
  return db.prepare(
    'SELECT * FROM bb_shareholders WHERE stock_id = ? AND user_id = ? AND shares > 0.0001'
  ).get(stockId, userId) || null;
}

function getStockShareholders(stockId) {
  return db.prepare(`
    SELECT * FROM bb_shareholders
    WHERE stock_id = ? AND shares > 0.0001
    ORDER BY shares DESC
  `).all(stockId);
}

function getStockTransactions(stockId, limit = 20) {
  return db.prepare(`
    SELECT * FROM bb_transactions
    WHERE stock_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(stockId, limit);
}

function getUserStockTransactions(userId, stockId, limit = 20) {
  return db.prepare(`
    SELECT * FROM bb_transactions
    WHERE stock_id = ? AND user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(stockId, userId, limit);
}

// ---------------------------------------------------------------------------
// Dividend system
// ---------------------------------------------------------------------------

function distributeDividend(stockId, overridePool = null) {
  const stock = getStockById(stockId);
  if (!stock) return { success: false, error: 'Stock not found.' };

  const treasuryBalance = getCorporateTreasuryBalance(stock);
  if (treasuryBalance <= 0) {
    return { success: false, error: `${stock.business_name} treasury is empty.` };
  }

  const dividendPool = overridePool != null
    ? Math.min(overridePool, treasuryBalance)
    : Math.floor(treasuryBalance * stock.dividend_rate);

  if (dividendPool <= 0) {
    return { success: false, error: 'Dividend pool is zero. Nothing to distribute.' };
  }

  const shareholders = getStockShareholders(stockId);
  if (shareholders.length === 0) {
    return { success: false, error: 'No shareholders to distribute to.' };
  }

  const totalShares = shareholders.reduce((sum, holder) => sum + holder.shares, 0);
  if (totalShares <= 0) {
    return { success: false, error: 'Total shares outstanding is zero.' };
  }

  const dividendPerShare = dividendPool / totalShares;

  const result = db.transaction(() => {
    const details = [];
    let totalDistributed = 0;

    for (const holder of shareholders) {
      const payout = Math.floor(holder.shares * dividendPerShare);
      if (payout <= 0) continue;

      ensureAccount(holder.user_id, holder.username);
      adjustBalance(holder.user_id, payout, `Dividend from ${stock.ticker}: ${payout} SGC`);

      if (isSyntheticStock(stock)) {
        db.prepare(`
          UPDATE bb_stocks
          SET synthetic_treasury = synthetic_treasury - ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(payout, stockId);
      } else {
        adjustBalance(getBigBusinessUserId(stock.guild_id), -payout, `Dividend payout to ${holder.username}`);
      }

      db.prepare(`
        UPDATE bb_shareholders
        SET total_dividends = total_dividends + ?, updated_at = datetime('now')
        WHERE stock_id = ? AND user_id = ?
      `).run(payout, stockId, holder.user_id);

      db.prepare(`
        INSERT INTO bb_transactions (stock_id, user_id, type, shares, price_per_share, total_amount, note)
        VALUES (?, ?, 'dividend', ?, ?, ?, ?)
      `).run(
        stockId,
        holder.user_id,
        holder.shares,
        dividendPerShare,
        payout,
        `Dividend: ${payout} SGC (${holder.shares.toFixed(4)} shares × ${dividendPerShare.toFixed(4)} SGC/share)`,
      );

      details.push({
        userId: holder.user_id,
        username: holder.username,
        shares: holder.shares,
        payout,
      });
      totalDistributed += payout;
    }

    db.prepare(`
      UPDATE bb_stocks
      SET total_dividends_paid = total_dividends_paid + ?,
          last_dividend = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(totalDistributed, stockId);

    db.prepare(`
      INSERT INTO bb_dividend_log (stock_id, total_pool, dividend_per_share, shareholders_paid, total_distributed)
      VALUES (?, ?, ?, ?, ?)
    `).run(stockId, dividendPool, dividendPerShare, details.length, totalDistributed);

    recalculatePrice(stockId, 'post-dividend repricing');

    return {
      success: true,
      distributed: totalDistributed,
      shareholders: details.length,
      perShare: dividendPerShare,
      pool: dividendPool,
      details,
    };
  })();

  return result;
}

function getDividendHistory(stockId, limit = 10) {
  return db.prepare(`
    SELECT * FROM bb_dividend_log
    WHERE stock_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(stockId, limit);
}

// ---------------------------------------------------------------------------
// Valuation helpers
// ---------------------------------------------------------------------------

function getShareholderValue(holding, currentPrice) {
  const marketValue = holding.shares * currentPrice;
  const totalValue = marketValue + holding.total_dividends;
  const profitLoss = totalValue - holding.total_invested;
  const profitPct = holding.total_invested > 0
    ? ((profitLoss / holding.total_invested) * 100)
    : 0;

  return {
    shares: holding.shares,
    avgCost: holding.avg_cost_basis,
    currentPrice,
    marketValue,
    totalDividends: holding.total_dividends,
    totalValue,
    totalInvested: holding.total_invested,
    profitLoss,
    profitPct,
  };
}

function getStockSummary(stockId) {
  const stock = getStockById(stockId);
  if (!stock) return null;

  const shareholders = getStockShareholders(stockId);
  const totalShares = shareholders.reduce((sum, holder) => sum + holder.shares, 0);
  const treasuryBalance = getCorporateTreasuryBalance(stock);
  const investedCapital = shareholders.reduce((sum, holder) => sum + holder.total_invested, 0);
  const marketCap = treasuryBalance + investedCapital;
  const snapshot = getRealMarketSnapshot();
  const metrics = buildPerformanceMetrics(stock, treasuryBalance, investedCapital, snapshot);

  return {
    ...stock,
    shareholderCount: shareholders.length,
    totalSharesOutstanding: totalShares,
    treasuryBalance,
    investedCapital,
    marketCap,
    isSynthetic: isSyntheticStock(stock),
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Backfill: retroactive 5% Doll Street fee on historical buys
// ---------------------------------------------------------------------------

/**
 * Scan all historical 'buy' transactions and compute the 5% Doll Street fee
 * that *would* have been charged.  Deposits the total into Doll Street in a
 * single lump sum.  Idempotent — checks system_state so it only runs once.
 *
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] – If true, calculates but does not
 *                                          modify any balances.
 * @returns {{ totalFee: number, txnCount: number, alreadyRan: boolean }}
 */
function backfillDollStreetFees({ dryRun = false } = {}) {
  const { getSystemState, setSystemState } = require('./sadgirlEconomyStore');

  const flag = getSystemState('backfill_doll_street_5pct');
  if (flag === 'done' && !dryRun) {
    return { totalFee: 0, txnCount: 0, alreadyRan: true };
  }

  const rows = db.prepare(
    "SELECT id, total_amount FROM bb_transactions WHERE type = 'buy'"
  ).all();

  let totalFee = 0;
  for (const row of rows) {
    totalFee += roundCurrency(Number(row.total_amount) * 0.05);
  }
  totalFee = roundCurrency(totalFee);

  if (!dryRun && totalFee > 0) {
    db.prepare(`
      UPDATE accounts
      SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(totalFee, totalFee, DOLL_STREET_USER_ID);

    setSystemState('backfill_doll_street_5pct', 'done');
    logger.info(`Backfill: deposited ${totalFee} SGC into Doll Street from ${rows.length} historical buy transactions.`);
  }

  return { totalFee, txnCount: rows.length, alreadyRan: false };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  initPrivateStockStore,
  getDb,
  syncStockUniverse,
  ensureStockForGuild,
  getStockByGuild,
  getStockById,
  getStockByTicker,
  getAllStocks,
  setSharePrice,
  setDividendRate,
  renameStock,
  renameTicker,
  buyShares,
  sellShares,
  getUserPortfolio,
  getUserHolding,
  getStockShareholders,
  getStockTransactions,
  getUserStockTransactions,
  distributeDividend,
  getDividendHistory,
  recalculatePrice,
  getShareholderValue,
  getStockSummary,
  backfillDollStreetFees,
};
