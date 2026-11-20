/**
 * Private Stock Store — SQLite-backed exchange for Big Business shares.
 *
 * Key rules:
 *  - Market cap = current Big Business treasury only. (Buyers' coins already land
 *    in the treasury, so adding "invested capital" on top counted them twice.)
 *  - Every SGC amount that moves is a whole number (fee rounds up, sale proceeds
 *    round down). Shares themselves may stay fractional.
 *  - Right after you buy, your sells for the next 24h are capped at the lowest
 *    price you paid in that window, so you can't profit from your own buy pushing
 *    the price up (instant buy-then-sell round trips always lose the 5% fee).
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
  ensureGuildBigBusiness, // creates the per-guild __BIG_BUSINESS_<gid>__ account if it is missing
  DOLL_STREET_USER_ID,
  LUMI_HOLDINGS_USER_ID,  // Lumi Holdings Inc.'s account: the LUMI stock's real treasury
  ensureLumiAccounts,     // makes the nine Lumi-Town accounts if missing
  moveCoins,              // strict fee-free coin move that throws when refused
  getSystemState,         // reads the lumi.treasury.* settings without loading src/lumi
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
const DOLL_STREET_FEE_PERCENT = 5; // Doll Street takes 5% of every buy (rounded UP to a whole SGC)
const SELL_PRICE_LOCK_MS = 24 * 60 * 60 * 1000; // for 24h after a buy, that holder can't sell above the price they paid
const FRIENDLY_TRADE_ERROR = 'The trade could not be completed, so no coins or shares were moved. Please try again in a moment.'; // shown when a transaction rolls back

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

// ---------------------------------------------------------------------------
// Lumi Holdings Inc. (ticker LUMI): a permanent stock whose treasury is the real __LUMI_HOLDINGS__ account,
// the reserve behind Lumi-Town Bank (docs/plans/lumi-games-port.md section 3.5).
// ---------------------------------------------------------------------------

const LUMI_STOCK_GUILD_ID = '__LUMI_HOLDINGS__';   // bb_stocks.guild_id of the LUMI row (same text as its account id)
const LUMI_TICKER = 'LUMI';                        // reserved: no other stock may take this ticker
const LUMI_BUSINESS_NAME = 'Lumi Holdings Inc.';   // display name when the row is first made
const LUMI_DEFAULT_RESERVE_FLOOR = 50000;          // default for setting lumi.treasury.reserveFloor
const LUMI_DEFAULT_DIVIDEND_RATE = 0.02;           // default for setting lumi.treasury.lumiDividendRate (2% of the excess, weekly)

// True for the LUMI row (entity_type 'lumi', or its fixed guild id).
function isLumiStock(stock) {
  return stock?.entity_type === 'lumi' || stock?.guild_id === LUMI_STOCK_GUILD_ID; // either marker is enough
}

// One numeric 'setting.' value from system_state (the same keys src/lumi/tuning.js and the web panel use).
function readLumiNumberSetting(key, fallback) {
  try {
    const raw = getSystemState(`setting.${key}`);                 // e.g. setting.lumi.treasury.reserveFloor
    if (raw === null || raw === undefined || raw === '') return fallback; // no override: the default
    const n = Number(raw);                                        // stored as text
    return Number.isFinite(n) && n >= 0 ? n : fallback;           // junk or negative: the default
  } catch {
    return fallback;                                              // DB not ready: the default
  }
}

// LUMI's money rules: the reserve floor its treasury never goes under, and its weekly dividend rate.
function getLumiPolicy() {
  return {
    reserveFloor: Math.floor(readLumiNumberSetting('lumi.treasury.reserveFloor', LUMI_DEFAULT_RESERVE_FLOOR)), // whole SGC
    dividendRate: Math.min(1, readLumiNumberSetting('lumi.treasury.lumiDividendRate', LUMI_DEFAULT_DIVIDEND_RATE)), // 0..1
  };
}

// How many Lumi prizes are still owed (lumi_owed rows); 0 when the Lumi tables don't exist (Lumi games off).
function countLumiOwed() {
  try {
    return Number(db.prepare('SELECT COUNT(*) AS n FROM lumi_owed').get()?.n) || 0; // rows waiting to be paid
  } catch {
    return 0;                                                                         // no table yet: nothing owed
  }
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
  ensureColumn('bb_shareholders', 'sell_lock_price', 'REAL DEFAULT NULL'); // lowest price this holder paid during their current 24h sell lock
  ensureColumn('bb_shareholders', 'sell_lock_until', 'INTEGER NOT NULL DEFAULT 0'); // epoch ms when that sell lock ends (0 = no lock)

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

function createTicker(baseName, takenIn = new Set()) {
  const taken = new Set(takenIn); // copy, so the caller's set is not changed
  taken.add(LUMI_TICKER);         // "LUMI" is reserved for Lumi Holdings Inc.: no guild or synthetic stock may take it
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
  if (isLumiStock(stock)) {
    return getBalance(LUMI_HOLDINGS_USER_ID); // LUMI: the real Lumi Holdings balance, never synthetic_treasury (never mints)
  }
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
  // Audit #13: only the treasury is real backing. 95% of every buy is already IN the treasury,
  // so adding invested capital on top counted each buy ~1.95x and let buy-then-sell drain it.
  return getCorporateTreasuryBalance(stock); // market cap = coins actually held by the company
}

function getRealGuildStocksRaw() {
  // LUMI is left out: its large reserve would skew the guild averages every guild stock is priced against.
  return getAllStocksRaw(true).filter((stock) => stock.entity_type !== 'synthetic' && !isLumiStock(stock)); // real guild stocks only
}

function getRealMarketSnapshot() {
  const realStocks = getRealGuildStocksRaw().filter((stock) => stock.status !== 'inactive');
  if (realStocks.length === 0) {
    return {
      count: 0,
      averageTreasury: 1_000,
      averageInvested: 250,
      treasuryStdDev: 0.15,
      minSharePrice: 25,
      maxSharePrice: 25,
    };
  }

  const treasuries = realStocks.map((stock) => Math.max(1, getCorporateTreasuryBalance(stock)));
  const invested = realStocks.map((stock) => Math.max(0, getCurrentInvestmentCapital(stock.id)));
  const sharePrices = realStocks
    .map((stock) => Number(stock.share_price) || 0)
    .filter((price) => price >= MIN_SHARE_PRICE);
  const averageTreasury = treasuries.reduce((sum, value) => sum + value, 0) / treasuries.length;
  const averageInvested = invested.reduce((sum, value) => sum + value, 0) / invested.length;
  const variance = treasuries.reduce((sum, value) => sum + ((value - averageTreasury) ** 2), 0) / treasuries.length;
  const minSharePrice = sharePrices.length > 0 ? Math.min(...sharePrices) : 25;
  const maxSharePrice = sharePrices.length > 0 ? Math.max(...sharePrices) : minSharePrice;

  return {
    count: realStocks.length,
    averageTreasury,
    averageInvested,
    treasuryStdDev: Math.sqrt(variance) / Math.max(1, averageTreasury),
    minSharePrice,
    maxSharePrice,
  };
}

function getPerformanceMultiplier(score) {
  return clamp(0.85 + ((Number(score) || 1) - 1) * 0.7, 0.65, 1.55);
}

function getDemandMultiplier(pressure) {
  return clamp(1 + (Number(pressure) || 0), 0.5, 1.8);
}

function getSyntheticPriceBand(stock, snapshot) {
  if (!isSyntheticStock(stock) || !snapshot || snapshot.count <= 0) return null;

  const minRealPrice = Math.max(MIN_SHARE_PRICE, Number(snapshot.minSharePrice) || MIN_SHARE_PRICE);
  const maxRealPrice = Math.max(minRealPrice, Number(snapshot.maxSharePrice) || minRealPrice);
  const priceSpread = maxRealPrice - minRealPrice;
  const performanceRatio = clamp(
    ((Number(stock.performance_score) || 1) - MIN_PERFORMANCE_SCORE) / (MAX_PERFORMANCE_SCORE - MIN_PERFORMANCE_SCORE),
    0,
    1,
  );
  const anchorPrice = minRealPrice + (priceSpread * performanceRatio);
  const marketBuffer = Math.max(2, maxRealPrice * 0.05, priceSpread * 0.12);
  const anchorFlex = Math.max(3, priceSpread * 0.18);
  const floor = Math.max(MIN_SHARE_PRICE, Math.max(minRealPrice - marketBuffer, anchorPrice - anchorFlex));
  const ceiling = Math.max(floor, Math.min(maxRealPrice + marketBuffer, anchorPrice + anchorFlex));

  return {
    floor,
    ceiling,
    anchorPrice,
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
  if (isLumiStock(stock)) return 1; // LUMI is priced on its reserve alone (a neutral score), not against the guilds
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
  const performanceMultiplier = getPerformanceMultiplier(Number(stock.performance_score) || 1);
  const syntheticBand = getSyntheticPriceBand(stock, snapshot);
  const targetSharePrice = syntheticBand
    ? syntheticBand.anchorPrice
    : Math.max(MIN_SHARE_PRICE, 25 * (Number(stock.performance_score) || 1));
  const targetBalance = Math.max(200, (targetSharePrice * BASE_REFERENCE_FLOAT) / Math.max(0.65, performanceMultiplier));
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
  const outstandingShares = Math.max(getOutstandingShares(stock.id), Number(stock.total_outstanding) || 0, 0);
  const referenceFloat = Math.max(outstandingShares, BASE_REFERENCE_FLOAT);
  const marketCap = getMarketCapValue(stock); // treasury only (audit #13: no more double-counted invested capital)
  const intrinsicPerShare = marketCap > 0
    ? marketCap / referenceFloat
    : Math.max(MIN_SHARE_PRICE, snapshotPriceFallback(stock));
  const performanceMultiplier = isLumiStock(stock) ? 1 : getPerformanceMultiplier(Number(stock.performance_score) || 1); // LUMI: reserve per share, no performance boost
  const demandMultiplier = getDemandMultiplier(Number(stock.demand_pressure) || 0);
  const rawPrice = clamp(intrinsicPerShare * performanceMultiplier * demandMultiplier, MIN_SHARE_PRICE, MAX_SHARE_PRICE);

  if (!isSyntheticStock(stock)) {
    return roundCurrency(rawPrice);
  }

  const syntheticBand = getSyntheticPriceBand(stock, getRealMarketSnapshot());
  if (!syntheticBand) {
    return roundCurrency(rawPrice);
  }

  return roundCurrency(clamp(rawPrice, syntheticBand.floor, syntheticBand.ceiling));
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
  // Audit #11: make sure the guild's Big Business account exists, so share purchases
  // for a guild enabled after boot have somewhere real to land (otherwise coins vanished).
  ensureGuildBigBusiness(getBigBusinessUserId(guildId), businessName); // creates __BIG_BUSINESS_<gid>__ if missing

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
    // LUMI is permanent: always listed, on top of (never instead of) the guild and synthetic listings.
    const lumiIds = refreshedStocks.filter((stock) => isLumiStock(stock)).map((stock) => stock.id); // 0 or 1 row
    listedIds = [...listedIds, ...lumiIds]; // it never takes a synthetic slot

    const listedSet = new Set(listedIds);
    const listingRank = (stock) => (stock.entity_type === 'guild' ? 0 : isLumiStock(stock) ? 1 : 2); // guilds, then LUMI, then synthetics
    const orderedListed = getAllStocksRaw(true)
      .filter((stock) => listedSet.has(stock.id))
      .sort((a, b) => {
        if (listingRank(a) !== listingRank(b)) return listingRank(a) - listingRank(b); // group order first
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

/**
 * Make sure Lumi Holdings Inc. (ticker LUMI) is on the exchange: creates the __LUMI_HOLDINGS__ account and the
 * bb_stocks row if missing, keeps it entity_type 'lumi', active and listed, and frees the LUMI ticker if an older
 * stock happened to take it. Called once by src/lumi/index.js initLumiGames(). Returns the LUMI row.
 */
function ensureLumiHoldingsStock() {
  if (!db) return null;                                                        // exchange not initialised
  ensureLumiAccounts();                                                        // the treasury account must exist first
  const squatter = db.prepare('SELECT * FROM bb_stocks WHERE ticker = ? AND guild_id != ?').get(LUMI_TICKER, LUMI_STOCK_GUILD_ID); // another stock holding "LUMI"?
  if (squatter) {
    const taken = new Set(getAllStocksRaw(true).map((stock) => stock.ticker)); // every ticker in use
    const fresh = createTicker(squatter.business_name, taken);                 // a new one (createTicker never returns LUMI)
    db.prepare("UPDATE bb_stocks SET ticker = ?, updated_at = datetime('now') WHERE id = ?").run(fresh, squatter.id); // move it off LUMI
    logger.info(`Private Stock: ${squatter.business_name} re-ticked ${LUMI_TICKER} -> ${fresh} (LUMI is reserved).`); // admin breadcrumb
  }
  const existing = db.prepare('SELECT * FROM bb_stocks WHERE guild_id = ?').get(LUMI_STOCK_GUILD_ID); // the LUMI row, if made before
  if (existing) {
    db.prepare(`
      UPDATE bb_stocks
      SET ticker = ?, entity_type = 'lumi', status = 'active', is_listed = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(LUMI_TICKER, existing.id); // permanent: always active, listed and called LUMI
  } else {
    const treasury = getBalance(LUMI_HOLDINGS_USER_ID);                        // whatever the reserve holds now
    const openingPrice = roundCurrency(Math.max(MIN_SHARE_PRICE, treasury > 0 ? treasury / BASE_REFERENCE_FLOAT : 25)); // reserve per reference share
    db.prepare(`
      INSERT INTO bb_stocks (guild_id, ticker, business_name, share_price, initial_price, entity_type, status, is_listed,
                             dividend_rate, performance_score, base_performance, display_order)
      VALUES (?, ?, ?, ?, ?, 'lumi', 'active', 1, ?, 1, 1, 0)
    `).run(LUMI_STOCK_GUILD_ID, LUMI_TICKER, LUMI_BUSINESS_NAME, openingPrice, openingPrice, getLumiPolicy().dividendRate); // new permanent listing
    logger.info(`Private Stock: listed ${LUMI_TICKER} (${LUMI_BUSINESS_NAME}) at ${openingPrice} SGC.`); // admin breadcrumb
  }
  syncStockUniverse();                                                         // re-rank the board with LUMI in it
  return db.prepare('SELECT * FROM bb_stocks WHERE guild_id = ?').get(LUMI_STOCK_GUILD_ID) || null; // the fresh row
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
  if (!Number.isSafeInteger(investmentAmount) || investmentAmount <= 0) { // whole SGC only (no 1.5, NaN, '5')
    return { success: false, error: 'Investment amount must be a positive whole number of SGC.' };
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

  const pricePerShare = Number(stock.share_price) || 0;
  if (pricePerShare <= 0) {
    return { success: false, error: 'This stock has an invalid price right now. Try again in a moment.' };
  }

  const dollStreetCut = Math.ceil((investmentAmount * DOLL_STREET_FEE_PERCENT) / 100); // 5% fee rounded UP to whole SGC (integer maths avoids 300*0.05=15.0000001)
  const netInvestment  = investmentAmount - dollStreetCut; // whole SGC that actually reaches the company treasury
  if (netInvestment < 1) { // e.g. 1 SGC: the 1 SGC fee eats everything
    return { success: false, error: 'Minimum investment is 2 SGC (the 5% Doll Street fee rounds up).' };
  }
  const sharesBought   = netInvestment / pricePerShare; // shares can stay fractional

  let result; // filled in by the transaction below
  try { // any throw inside the transaction rolls back every coin and share movement
  result = db.transaction(() => {
    const balance = getBalance(userId); // re-read the balance INSIDE the transaction so nothing can change it between check and debit
    if (balance < investmentAmount) { // not enough coins: nothing has been written yet, so just return
      return { success: false, error: `Insufficient funds. You have ${balance} SGC but need ${investmentAmount} SGC.` };
    }

    const debit = adjustBalance(userId, -investmentAmount, `Bought ${sharesBought.toFixed(4)} shares of ${stock.ticker}`); // take the buyer's coins
    if (!debit.success) throw new Error(debit.error); // debit failed, so throw and roll back (never credit without a debit)

    // 5% Doll Street exchange fee
    if (dollStreetCut > 0) {
      const feeInfo = db.prepare(`
        UPDATE accounts
        SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(dollStreetCut, dollStreetCut, DOLL_STREET_USER_ID); // pay the whole-SGC fee to Doll Street
      if (feeInfo.changes === 0) throw new Error('Doll Street account is missing.'); // fee would vanish, so roll back
    }

    if (isLumiStock(stock)) {
      const credit = db.prepare(`
        UPDATE accounts SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(netInvestment, netInvestment, LUMI_HOLDINGS_USER_ID); // the net buy becomes Lumi-Town reserve capital
      if (credit.changes === 0) throw new Error('Lumi Holdings account is missing.'); // coins would vanish: roll back
      db.prepare(`
        INSERT INTO transactions (from_user_id, to_user_id, amount, fee, type, note)
        VALUES (?, ?, ?, ?, 'lumi_share_buy', ?)
      `).run(userId, LUMI_HOLDINGS_USER_ID, netInvestment, dollStreetCut, `LUMI share purchase by ${username}`); // ledger row the treasury page counts
    } else if (isSyntheticStock(stock)) {
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

    // Sell lock (audit #13): for 24h this holder can't sell above the LOWEST price they paid in
    // that window, so pumping the price with your own buy and selling straight back can't profit.
    const now = Date.now(); // current time in ms
    const lockStillActive = Boolean(existing) && Number(existing.sell_lock_until) > now && Number(existing.sell_lock_price) > 0; // already inside a lock window?
    const sellLockPrice = lockStillActive ? Math.min(Number(existing.sell_lock_price), pricePerShare) : pricePerShare; // keep the lowest buy price (stops "buy big, then buy 1 SGC at the pumped price")
    const sellLockUntil = now + SELL_PRICE_LOCK_MS; // every buy restarts the 24h window

    if (existing) {
      const newTotalInvested = existing.total_invested + investmentAmount;
      const newShares = existing.shares + sharesBought;
      const newAvgCost = newShares > 0 ? newTotalInvested / newShares : 0;

      db.prepare(`
        UPDATE bb_shareholders
        SET shares = ?, avg_cost_basis = ?, total_invested = ?, username = ?,
            sell_lock_price = ?, sell_lock_until = ?, updated_at = datetime('now')
        WHERE stock_id = ? AND user_id = ?
      `).run(newShares, newAvgCost, newTotalInvested, username, sellLockPrice, sellLockUntil, stockId, userId); // add the shares and refresh the sell lock
    } else {
      db.prepare(`
        INSERT INTO bb_shareholders (stock_id, user_id, username, shares, avg_cost_basis, total_invested, sell_lock_price, sell_lock_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(stockId, userId, username, sharesBought, pricePerShare, investmentAmount, sellLockPrice, sellLockUntil); // new holder starts with a sell lock at the price they paid
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
      `Bought ${sharesBought.toFixed(4)} shares @ ${pricePerShare.toFixed(2)} SGC (${dollStreetCut} SGC fee)`, // fee is now a whole number
    );

    const repriced = applyTradeImpact(stockId, 'buy', netInvestment);
    const updatedHolder = db.prepare(
      'SELECT * FROM bb_shareholders WHERE stock_id = ? AND user_id = ?'
    ).get(stockId, userId);

    return {
      success: true,
      shares: sharesBought,
      pricePerShare,
      fee: dollStreetCut, // whole-SGC Doll Street fee that was charged
      totalShares: updatedHolder.shares,
      totalInvested: updatedHolder.total_invested,
      newPrice: repriced ?? pricePerShare,
      sellLockPrice, // the most this holder can sell for per share until the lock ends
      sellLockUntil, // epoch ms when the sell lock ends
    };
  })();
  } catch (error) { // the transaction threw and rolled back: nothing moved
    logger.error(`Private Stock: buy of ${investmentAmount} SGC of stock ${stockId} by ${userId} rolled back.`, error.message); // log the real reason for admins
    return { success: false, error: FRIENDLY_TRADE_ERROR }; // friendly message for the player
  }

  return result;
}

function sellShares(userId, username, stockId, sharesToSell) {
  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) { // shares may be fractional, but never NaN/Infinity/negative
    return { success: false, error: 'Must sell a positive number of shares.' };
  }

  let result; // filled in by the transaction below
  try { // any throw inside the transaction rolls back every coin and share movement
  result = db.transaction(() => {
    const stock = getStockById(stockId); // read the stock INSIDE the transaction so the price can't shift under us
    if (!stock) return { success: false, error: 'Stock not found.' };

    const holding = db.prepare(
      'SELECT * FROM bb_shareholders WHERE stock_id = ? AND user_id = ?'
    ).get(stockId, userId); // the seller's current holding

    if (!holding || holding.shares < sharesToSell) {
      const owned = holding ? holding.shares.toFixed(4) : '0';
      return { success: false, error: `You only own ${owned} shares.` };
    }

    const marketPrice = Number(stock.share_price) || 0; // the listed price right now
    const lockActive = Number(holding.sell_lock_until) > Date.now() && Number(holding.sell_lock_price) > 0; // did this holder buy in the last 24h?
    const pricePerShare = lockActive ? Math.min(marketPrice, Number(holding.sell_lock_price)) : marketPrice; // inside the lock you can't sell above what you paid
    const proceeds = Math.floor(sharesToSell * pricePerShare); // round DOWN to whole SGC (the company never pays out a fraction)
    if (proceeds < 1) { // a tiny sale would pay 0 SGC
      return { success: false, error: 'That sale would be worth less than 1 SGC. Try selling more shares.' };
    }

    const treasuryBalance = getCorporateTreasuryBalance(stock); // checked inside the transaction so two sells can't both pass
    if (treasuryBalance < proceeds) {
      return {
        success: false,
        error: `${stock.business_name} treasury is too illiquid right now (${treasuryBalance.toFixed(0)} SGC).`,
      };
    }
    if (isLumiStock(stock)) { // LUMI: a sale may never take Lumi Holdings under its reserve floor
      const { reserveFloor } = getLumiPolicy(); // lumi.treasury.reserveFloor (default 50,000)
      if (treasuryBalance - proceeds < reserveFloor) {
        const room = Math.max(0, treasuryBalance - reserveFloor); // what could be paid out right now
        return {
          success: false,
          error: `LUMI is illiquid right now: Lumi Holdings must keep its ${reserveFloor.toLocaleString()} SGC reserve, so only ${room.toLocaleString()} SGC of sales can be paid. Try a smaller sale or wait for Lumi-Town to grow.`,
        };
      }
    }

    if (isLumiStock(stock)) {
      moveCoins(LUMI_HOLDINGS_USER_ID, userId, proceeds, 'lumi_share_sell', `Sold ${sharesToSell.toFixed(4)} LUMI`); // reserve -> seller, throws if short
    } else if (isSyntheticStock(stock)) {
      db.prepare(`
        UPDATE bb_stocks
        SET synthetic_treasury = synthetic_treasury - ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(proceeds, stockId);
    } else {
      const bbUserId = getBigBusinessUserId(stock.guild_id);
      const debit = adjustBalance(bbUserId, -proceeds, `Share sale by ${username}`); // take the payout from the company treasury
      if (!debit.success) throw new Error(debit.error); // treasury debit failed: throw so the seller is NOT paid from nothing
    }

    if (!isLumiStock(stock)) { // LUMI's moveCoins above already paid the seller (debit + credit in one step)
      const credit = adjustBalance(userId, proceeds, `Sold ${sharesToSell.toFixed(4)} shares of ${stock.ticker}`); // pay the seller
      if (!credit.success) throw new Error(credit.error); // credit failed: throw so the treasury debit is undone too
    }

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
      pricePerShare, // the per-share price actually paid
      priceLocked: lockActive && pricePerShare < marketPrice, // true when the 24h sell lock lowered the price
      sellLockUntil: lockActive ? Number(holding.sell_lock_until) : 0, // when the lock ends (0 = no lock)
      remainingShares: newShares < 0.0001 ? 0 : newShares,
      newPrice: repriced ?? pricePerShare,
    };
  })();
  } catch (error) { // the transaction threw and rolled back: nothing moved
    logger.error(`Private Stock: sell of ${sharesToSell} shares of stock ${stockId} by ${userId} rolled back.`, error.message); // log the real reason for admins
    return { success: false, error: FRIENDLY_TRADE_ERROR }; // friendly message for the player
  }

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

  const lumi = isLumiStock(stock); // LUMI pays only from the reserve's excess above its floor
  if (lumi && countLumiOwed() > 0) { // Lumi-Town still owes players prizes: those come first
    return { success: false, error: 'LUMI dividends are paused while Lumi-Town Bank still owes players prizes.' };
  }
  const lumiPolicy = lumi ? getLumiPolicy() : null; // reserve floor + weekly rate (tuning keys lumi.treasury.*)
  const payable = lumi ? Math.max(0, treasuryBalance - lumiPolicy.reserveFloor) : treasuryBalance; // what may leave the treasury
  if (lumi && payable <= 0) {
    return { success: false, error: `Lumi Holdings is at or under its ${lumiPolicy.reserveFloor.toLocaleString()} SGC reserve floor: no dividend this time.` };
  }

  const dividendPool = overridePool != null
    ? Math.floor(Math.min(Number(overridePool) || 0, payable)) // whole SGC, never more than may leave the treasury
    : Math.floor(payable * (lumi ? lumiPolicy.dividendRate : stock.dividend_rate)); // LUMI: rate x excess above the floor

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

  // LUMI divides by at least the 100-share reference float its price uses, so a tiny early holder can't collect the
  // whole pool earned on Central Bank's seed; whatever isn't paid out simply stays in the reserve.
  const dividendPerShare = dividendPool / (lumi ? Math.max(totalShares, BASE_REFERENCE_FLOAT) : totalShares); // SGC per share

  let result; // filled in by the transaction below
  try { // any throw inside the transaction rolls back the whole dividend run for this stock
  result = db.transaction(() => {
    const details = [];
    let totalDistributed = 0;

    for (const holder of shareholders) {
      const payout = Math.floor(holder.shares * dividendPerShare); // already whole SGC (rounded down)
      if (payout <= 0) continue;

      ensureAccount(holder.user_id, holder.username);

      // Take the coins from the company FIRST, then pay the holder, and stop everything if either step fails
      if (lumi) {
        moveCoins(LUMI_HOLDINGS_USER_ID, holder.user_id, payout, 'lumi_dividend', `LUMI dividend: ${payout} SGC`); // reserve -> holder in one step
      } else if (isSyntheticStock(stock)) {
        db.prepare(`
          UPDATE bb_stocks
          SET synthetic_treasury = synthetic_treasury - ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(payout, stockId);
      } else {
        const debit = adjustBalance(getBigBusinessUserId(stock.guild_id), -payout, `Dividend payout to ${holder.username}`); // debit the treasury
        if (!debit.success) throw new Error(debit.error); // treasury couldn't pay: roll back instead of minting the dividend
      }

      if (!lumi) { // LUMI's moveCoins above already paid the holder (debit + credit in one step)
        const credit = adjustBalance(holder.user_id, payout, `Dividend from ${stock.ticker}: ${payout} SGC`); // pay the shareholder
        if (!credit.success) throw new Error(credit.error); // credit failed: roll back the treasury debit too
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
  } catch (error) { // rolled back: no dividends were paid for this stock
    logger.error(`Private Stock: dividend for ${stock.ticker} rolled back.`, error.message); // log the real reason for admins
    return { success: false, error: 'The dividend could not be paid, so no coins were moved. Please try again later.' }; // friendly message
  }

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
  const marketCap = treasuryBalance; // audit #13: treasury already holds the invested coins, so don't add them twice
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
    isLumi: isLumiStock(stock), // true for Lumi Holdings Inc. (LUMI)
    lumiPolicy: isLumiStock(stock) ? getLumiPolicy() : null, // reserve floor + dividend rate, for LUMI only
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Promotional value credits
// ---------------------------------------------------------------------------

function creditPromotionalValueForGuild(guildId, amount, note = 'Promotional channel link value') {
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return { success: false, error: 'Amount must be positive.' };
  }

  syncStockUniverse();
  const stock = getStockByGuild(guildId);
  if (!stock) {
    return { success: false, error: `No stock found for guild ${guildId}.` };
  }
  if (isLumiStock(stock)) { // promo value is minted coin: never pour it into the Lumi-Town reserve
    return { success: false, error: 'Lumi Holdings Inc. does not take promotional credits.' };
  }

  const credited = Math.floor(normalizedAmount); // whole SGC only (promo values like 2.5 per link round down)
  if (credited < 1) { // less than 1 SGC after rounding down
    return { success: false, error: 'Promotional value rounds down to 0 SGC.' };
  }

  let result; // filled in by the transaction below
  try { // a throw (e.g. missing Big Business account) rolls the credit back
  result = db.transaction(() => {
    if (isSyntheticStock(stock)) {
      db.prepare(`
        UPDATE bb_stocks
        SET synthetic_treasury = synthetic_treasury + ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(credited, stock.id);
    } else {
      const bbUserId = getBigBusinessUserId(stock.guild_id);
      depositBigBusiness(credited, note, bbUserId);
    }

    db.prepare(`
      INSERT INTO bb_transactions (stock_id, user_id, type, total_amount, note)
      VALUES (?, '__SYSTEM__', 'promo_value', ?, ?)
    `).run(stock.id, credited, note);

    const newPrice = recalculatePrice(stock.id, 'promotional channel value');

    return {
      success: true,
      stockId: stock.id,
      ticker: stock.ticker,
      guildId: stock.guild_id,
      credited,
      newPrice,
    };
  })();
  } catch (error) { // rolled back, nothing credited
    return { success: false, error: `Promotional credit failed: ${error.message}` }; // caller (commands.js) just logs this
  }

  return result;
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
  totalFee = Math.floor(totalFee); // whole SGC only (balances are INTEGER)

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
  ensureLumiHoldingsStock,     // create/keep the permanent LUMI listing (src/lumi/index.js calls it at init)
  isLumiStock,                 // true for the LUMI row
  getLumiPolicy,               // { reserveFloor, dividendRate } from the lumi.treasury.* settings
  getCorporateTreasuryBalance, // a stock's real treasury balance (LUMI: the __LUMI_HOLDINGS__ account)
  LUMI_TICKER,                 // 'LUMI'
  LUMI_STOCK_GUILD_ID,         // '__LUMI_HOLDINGS__'
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
  creditPromotionalValueForGuild,
  backfillDollStreetFees,
};
