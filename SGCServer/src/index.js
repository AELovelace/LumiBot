'use strict';

/**
 * SGCServer — entry point.
 *
 * Boots the standalone SadGirlCoin service. Loads .env, opens the shared
 * SQLite database in WAL mode, starts the public API + OAuth listener, the
 * internal/privileged listener, and the webhook dispatcher.
 *
 * Run with:
 *   node SGCServer/src/index.js
 *
 * Or from the SGCServer/ folder:
 *   npm start
 */

const path = require('node:path');

// Load SGCServer/.env first, then fall back to the LumiBot root .env so
// shared values (DB path, etc.) work either way.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { logger } = require('./logger');
const { initEconomyStore, closeEconomyStore, getEconomyDb } = require('./economyStore');
const { startApiServer, stopApiServer } = require('./server');
const { startWebhookDispatcher, stopWebhookDispatcher } = require('./webhookDispatcher');
const { ensureMigrations } = require('./apiKeyStore');
const { ensureOAuthSchema } = require('./oauthServer');

const dbFile = process.env.SGC_DB_FILE
  || path.resolve(__dirname, '..', '..', 'data', 'sadgirlcoin.sqlite3');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down SGCServer.`);
  try { stopWebhookDispatcher(); } catch (err) { logger.warn(`stopWebhookDispatcher failed: ${err.message}`); }
  try { stopApiServer(); } catch (err) { logger.warn(`stopApiServer failed: ${err.message}`); }
  try { closeEconomyStore(); } catch (err) { logger.warn(`closeEconomyStore failed: ${err.message}`); }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error(`uncaughtException: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});

(function main() {
  logger.info(`SGCServer starting (node ${process.version}).`);
  logger.info(`SGC_DB_FILE = ${dbFile}`);

  try {
    initEconomyStore(dbFile);
  } catch (err) {
    logger.error(`Failed to open SadGirlCoin DB: ${err.message}`);
    process.exit(1);
  }

  // Enable WAL on the shared DB so LumiBot + SGCServer can concurrently
  // read/write safely. Idempotent — a no-op if already in WAL mode.
  try {
    const db = getEconomyDb();
    const mode = db.pragma('journal_mode = WAL', { simple: true });
    db.pragma('synchronous = NORMAL');
    logger.info(`SQLite journal_mode = ${mode}`);
  } catch (err) {
    logger.warn(`Could not enable WAL mode: ${err.message}`);
  }

  // Lazy-create OAuth tables and run is_internal migration up front so the
  // first request does not pay the schema cost.
  try { ensureMigrations(); } catch (err) { logger.warn(`api_apps migration failed: ${err.message}`); }
  try { ensureOAuthSchema(); } catch (err) { logger.warn(`OAuth schema init failed: ${err.message}`); }

  // Diagnostic: dump every api_app and the oauth-identity flag SGCServer sees
  // RIGHT NOW, after migrations. If this disagrees with the raw sqlite3 query
  // run by an operator, the problem is a separate db file or stale cache.
  try {
    const { listApiApps } = require('./apiKeyStore');
    const apps = listApiApps();
    logger.info(`[startup] api_apps visible to SGCServer (${apps.length}):`);
    for (const a of apps) {
      logger.info(`[startup]   ${a.id} name="${a.name}" oauthExposeDiscordName=${a.oauthExposeDiscordName} disabled=${Boolean(a.disabledAt)} scopes=[${a.scopes.join(',')}]`);
    }
  } catch (err) { logger.warn(`api_apps startup dump failed: ${err.message}`); }

  try { startApiServer(); }
  catch (err) {
    logger.error(`Failed to start API server: ${err.message}`);
    process.exit(1);
  }

  try { startWebhookDispatcher(); }
  catch (err) { logger.warn(`Failed to start webhook dispatcher: ${err.message}`); }

  logger.info('SGCServer ready.');
})();
