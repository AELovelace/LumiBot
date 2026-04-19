/**
 * Private Stock Scheduler — weekly (or triggered) dividend distributions.
 *
 * Runs every Sunday at 18:00 UTC (or on manual trigger) and distributes
 * dividends for all active Big Business stocks.
 *
 * Also announces results in each business's channel with an LLM-generated message.
 */

const { logger } = require('./logger');
const {
  getAllStocks,
  distributeDividend,
  getStockById,
  syncStockUniverse,
} = require('./privateStockStore');
const { getSystemState, setSystemState } = require('./sadgirlEconomyStore');
const { getSetting } = require('./panelSettings');

const ONE_HOUR_MS = 60 * 60 * 1000;

let dividendTimer = null;
let stopped = false;
let discordClient = null;

// ---------------------------------------------------------------------------
// Weekly dividend check
// ---------------------------------------------------------------------------

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

async function checkWeeklyDividends() {
  syncStockUniverse();

  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sunday
  const hour = now.getUTCHours();

  // Run on Sundays at or after 18:00 UTC
  if (dayOfWeek !== 0 || hour < 18) return;

  const thisWeek = `${now.getUTCFullYear()}-W${getISOWeek(now)}`;
  const lastRun = getSystemState('last_stock_dividend');

  if (lastRun === thisWeek) return; // Already ran this week

  logger.info('Private Stock Scheduler: running weekly dividend distribution...');

  const stocks = getAllStocks();
  let totalDistributed = 0;
  let stocksProcessed = 0;

  for (const stock of stocks) {
    try {
      const result = distributeDividend(stock.id);
      if (result.success && result.distributed > 0) {
        totalDistributed += result.distributed;
        stocksProcessed += 1;

        // Post announcement in the business channel
        if (discordClient) {
          try {
            const { announceDividend } = require('./privateStockCommands');
            const freshStock = getStockById(stock.id);
            await announceDividend(discordClient, freshStock, result);
          } catch (error) {
            logger.warn(`Private Stock Scheduler: failed to announce dividend for ${stock.ticker}.`, error.message);
          }
        }
      }
    } catch (error) {
      logger.error(`Private Stock Scheduler: dividend failed for ${stock.ticker}.`, error.message);
    }
  }

  setSystemState('last_stock_dividend', thisWeek);
  logger.info(`Private Stock Scheduler: weekly dividends complete. ${stocksProcessed} stocks, ${totalDistributed} SGC distributed.`);
}

// ---------------------------------------------------------------------------
// Timer loop
// ---------------------------------------------------------------------------

function scheduleDividendCheck() {
  if (stopped) return;

  dividendTimer = setTimeout(async () => {
    try {
      await checkWeeklyDividends();
    } catch (error) {
      logger.error('Private Stock Scheduler: unhandled error in dividend check.', error.message);
    }
    scheduleDividendCheck();
  }, ONE_HOUR_MS);
  dividendTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function startPrivateStockScheduler(client) {
  discordClient = client;
  stopped = false;
  scheduleDividendCheck();
  logger.info('Private Stock Scheduler started (weekly dividends on Sundays 18:00 UTC).');
}

function stopPrivateStockScheduler() {
  stopped = true;
  if (dividendTimer) { clearTimeout(dividendTimer); dividendTimer = null; }
  discordClient = null;
  logger.info('Private Stock Scheduler stopped.');
}

module.exports = {
  startPrivateStockScheduler,
  stopPrivateStockScheduler,
  checkWeeklyDividends,
};
