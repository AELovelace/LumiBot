'use strict';

/**
 * SGCServer — webhook event dispatcher.
 *
 * Polls api_webhook_events every 60s, POSTs pending events to registered
 * app webhook URLs with HMAC-SHA256 signatures, retries with exponential
 * backoff (5s/10s/20s), and purges delivered/failed events after 7 days.
 *
 * IMPORTANT: only ONE process should run the dispatcher to avoid duplicate
 * deliveries. After the split, SGCServer is the canonical owner; LumiBot's
 * dispatcher is started only when running in legacy in-process mode.
 */

const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const { logger } = require('./logger');
const { getEconomyDb } = require('./economyStore');
const { getApiApp } = require('./apiKeyStore');

let dispatchTimer = null;
const DISPATCH_INTERVAL_MS = 60_000;

function db() { return getEconomyDb(); }

function getRetryDelayMs(attemptCount) {
  const delays = [5_000, 10_000, 20_000];
  return delays[attemptCount] || 60_000;
}

async function postWebhookEvent(event, webhookUrl, webhookSecret) {
  const payload = event.payload_json;
  const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(payload, 'utf8').digest('hex');
  return new Promise((resolve) => {
    let urlObj;
    try { urlObj = new URL(webhookUrl); }
    catch (err) { return resolve({ ok: false, error: `Invalid URL: ${err.message}`, status: 0 }); }

    const protocol = urlObj.protocol === 'https:' ? https : http;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-SGC-Signature': signature,
        'X-SGC-Event': event.event_type,
        'User-Agent': 'SadGirlCoin-Webhook/1.0',
      },
      timeout: 5_000,
    };

    const req = protocol.request(urlObj, options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'Timeout' }); });
    req.on('error', (err) => { resolve({ ok: false, status: 0, error: err.message }); });
    req.write(payload);
    req.end();
  });
}

async function dispatchPendingWebhookEvents() {
  if (!db()) return;
  try {
    const pending = db().prepare(`
      SELECT * FROM api_webhook_events
      WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
      ORDER BY created_at ASC
      LIMIT 50
    `).all();

    if (pending.length > 0) {
      logger.debug(`Webhook dispatcher: ${pending.length} pending event(s).`);
    }

    for (const event of pending) {
      const app = getApiApp(event.app_id);
      if (!app || !app.webhookUrl) {
        db().prepare(`UPDATE api_webhook_events SET status = 'failed', last_attempt_at = datetime('now') WHERE id = ?`).run(event.id);
        logger.debug(`Webhook event ${event.id} skipped (app=${event.app_id} missing or no webhook URL).`);
        continue;
      }
      const result = await postWebhookEvent(event, app.webhookUrl, app.webhookSecret);
      if (result.ok) {
        db().prepare(`UPDATE api_webhook_events SET status = 'success', last_attempt_at = datetime('now') WHERE id = ?`).run(event.id);
        logger.info(`Webhook event ${event.id} (app=${event.app_id}, type=${event.event_type}) delivered.`);
      } else {
        const nextAttempt = event.attempt_count + 1;
        if (nextAttempt >= 3) {
          db().prepare(`UPDATE api_webhook_events SET status = 'failed', attempt_count = ?, last_attempt_at = datetime('now') WHERE id = ?`).run(nextAttempt, event.id);
          logger.warn(`Webhook event ${event.id} (app=${event.app_id}, type=${event.event_type}) failed after 3 attempts. Last error: ${result.error || `HTTP ${result.status}`}`);
        } else {
          const delayMs = getRetryDelayMs(nextAttempt);
          const nextRetry = new Date(Date.now() + delayMs).toISOString().replace('T', ' ').slice(0, 19);
          db().prepare(`UPDATE api_webhook_events SET status = 'pending', attempt_count = ?, last_attempt_at = datetime('now'), next_retry_at = ? WHERE id = ?`).run(nextAttempt, nextRetry, event.id);
          logger.debug(`Webhook event ${event.id} retry scheduled in ${delayMs}ms. Attempts: ${nextAttempt}/3. Error: ${result.error || `HTTP ${result.status}`}`);
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const r = db().prepare(`DELETE FROM api_webhook_events WHERE status IN ('success', 'failed') AND created_at < ?`).run(sevenDaysAgo);
    if (r.changes > 0) logger.debug(`Webhook event purge: deleted ${r.changes} old entries.`);
  } catch (err) {
    logger.error(`Webhook dispatcher error: ${err.message}`);
  }
}

function startWebhookDispatcher() {
  if (dispatchTimer) return;
  dispatchTimer = setInterval(dispatchPendingWebhookEvents, DISPATCH_INTERVAL_MS);
  dispatchTimer.unref?.();
  logger.info('Webhook dispatcher started.');
}

function stopWebhookDispatcher() {
  if (dispatchTimer) {
    clearInterval(dispatchTimer);
    dispatchTimer = null;
    logger.info('Webhook dispatcher stopped.');
  }
}

module.exports = {
  startWebhookDispatcher,
  stopWebhookDispatcher,
  fireWebhookEvent: (appId, eventType, payloadObj) => {
    if (!db()) return;
    try {
      db().prepare(`INSERT INTO api_webhook_events (app_id, event_type, payload_json) VALUES (?, ?, ?)`)
        .run(appId, eventType, JSON.stringify(payloadObj));
      logger.debug(`Webhook event queued: app=${appId} type=${eventType}`);
    } catch (err) {
      logger.warn(`Failed to fire webhook event: ${err.message}`);
    }
  },
};
