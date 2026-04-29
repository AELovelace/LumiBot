'use strict';

const { getEconomyDb } = require('./sadgirlEconomyStore');

function getDbOrThrow() {
  const db = getEconomyDb();
  if (!db) {
    throw new Error('Economy DB is not initialized');
  }
  return db;
}

function initWebAppStore() {
  const db = getDbOrThrow();
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      kind        TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      link        TEXT NOT NULL DEFAULT '',
      is_read     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_web_notifications_user
      ON web_notifications(user_id, is_read, id DESC);

    CREATE TABLE IF NOT EXISTS web_action_receipts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          TEXT NOT NULL,
      action_type      TEXT NOT NULL,
      idempotency_key  TEXT DEFAULT NULL,
      status           TEXT NOT NULL DEFAULT 'completed',
      summary          TEXT NOT NULL,
      payload_json     TEXT NOT NULL DEFAULT '{}',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_web_receipts_user
      ON web_action_receipts(user_id, id DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_receipts_idem
      ON web_action_receipts(user_id, action_type, idempotency_key)
      WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
  `);
}

function createNotification(userId, {
  kind = 'info',
  title = '',
  body = '',
  link = '',
} = {}) {
  const db = getDbOrThrow();
  const result = db.prepare(`
    INSERT INTO web_notifications (user_id, kind, title, body, link)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    String(userId),
    String(kind || 'info').slice(0, 40),
    String(title || '').slice(0, 160),
    String(body || '').slice(0, 600),
    String(link || '').slice(0, 200),
  );
  return Number(result.lastInsertRowid);
}

function getNotificationsForUser(userId, limit = 20) {
  const db = getDbOrThrow();
  return db.prepare(`
    SELECT id, kind, title, body, link, is_read, created_at
    FROM web_notifications
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(String(userId), Math.max(1, Math.min(100, Number(limit) || 20)));
}

function markNotificationRead(userId, notificationId) {
  const db = getDbOrThrow();
  db.prepare(`
    UPDATE web_notifications
    SET is_read = 1
    WHERE id = ? AND user_id = ?
  `).run(Number(notificationId), String(userId));
}

function getUnreadNotificationCount(userId) {
  const db = getDbOrThrow();
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM web_notifications
    WHERE user_id = ? AND is_read = 0
  `).get(String(userId));
  return row ? row.cnt : 0;
}

function createActionReceipt(userId, {
  actionType,
  idempotencyKey = '',
  status = 'completed',
  summary = '',
  payload = {},
} = {}) {
  const db = getDbOrThrow();
  const normalizedActionType = String(actionType || '').slice(0, 80);
  const normalizedKey = String(idempotencyKey || '').slice(0, 160);
  const normalizedSummary = String(summary || '').slice(0, 240);
  const payloadJson = JSON.stringify(payload || {});

  if (!normalizedActionType || !normalizedSummary) {
    throw new Error('actionType and summary are required');
  }

  if (normalizedKey) {
    const existing = db.prepare(`
      SELECT id, user_id, action_type, idempotency_key, status, summary, payload_json, created_at
      FROM web_action_receipts
      WHERE user_id = ? AND action_type = ? AND idempotency_key = ?
    `).get(String(userId), normalizedActionType, normalizedKey);
    if (existing) return existing;
  }

  const result = db.prepare(`
    INSERT INTO web_action_receipts (user_id, action_type, idempotency_key, status, summary, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    String(userId),
    normalizedActionType,
    normalizedKey,
    String(status || 'completed').slice(0, 40),
    normalizedSummary,
    payloadJson,
  );

  return db.prepare(`
    SELECT id, user_id, action_type, idempotency_key, status, summary, payload_json, created_at
    FROM web_action_receipts
    WHERE id = ?
  `).get(Number(result.lastInsertRowid));
}

function getActionReceiptByKey(userId, actionType, idempotencyKey) {
  const db = getDbOrThrow();
  const normalizedKey = String(idempotencyKey || '').slice(0, 160);
  if (!normalizedKey) return null;
  return db.prepare(`
    SELECT id, action_type, idempotency_key, status, summary, payload_json, created_at
    FROM web_action_receipts
    WHERE user_id = ? AND action_type = ? AND idempotency_key = ?
  `).get(String(userId), String(actionType || ''), normalizedKey) || null;
}

function getReceiptsForUser(userId, limit = 20) {
  const db = getDbOrThrow();
  return db.prepare(`
    SELECT id, action_type, idempotency_key, status, summary, payload_json, created_at
    FROM web_action_receipts
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(String(userId), Math.max(1, Math.min(100, Number(limit) || 20)));
}

module.exports = {
  initWebAppStore,
  createNotification,
  getNotificationsForUser,
  markNotificationRead,
  getUnreadNotificationCount,
  createActionReceipt,
  getActionReceiptByKey,
  getReceiptsForUser,
};
