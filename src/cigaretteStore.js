const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { logger } = require('./logger');

const DISPENSE_PRICE = 1;
const CASE_LIMIT = 40;

let db = null;
let maxRank = 1;

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current.trim());
  return out;
}

function buildDisplayName(row) {
  return `${row.brand} ${row.variant} (${row.flavorType}, ${row.size})`;
}

function parseCatalog(csvPath) {
  const resolved = path.resolve(csvPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('Cigarette CSV appears empty.');
  }

  const header = parseCsvLine(lines[0]);
  const expected = ['Rank', 'Brand', 'Variant', 'Flavor Type', 'Size'];
  const isExpectedHeader = expected.every((name, index) => header[index] === name);
  if (!isExpectedHeader) {
    throw new Error('Cigarette CSV header format is invalid.');
  }

  const catalog = [];
  for (let i = 1; i < lines.length; i++) {
    const [rankRaw, brand, variant, flavorType, size] = parseCsvLine(lines[i]);
    const rank = Number.parseInt(rankRaw, 10);
    if (!Number.isFinite(rank) || !brand || !variant || !flavorType || !size) {
      continue;
    }

    const row = {
      rank,
      brand,
      variant,
      flavorType,
      size,
    };

    const displayName = buildDisplayName(row);
    catalog.push({
      ...row,
      displayName,
      nameKey: normalizeKey(displayName),
      weight: Math.max(1, rank),
    });
  }

  return catalog.sort((a, b) => a.rank - b.rank);
}

function initCigaretteStore(dbPath, csvPath) {
  const resolvedDb = path.resolve(dbPath);
  const resolvedCsv = path.resolve(csvPath);
  logger.info(`Cigarette market DB: ${resolvedDb}`);
  logger.info(`Cigarette market CSV: ${resolvedCsv}`);

  db = new Database(resolvedDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createSchema();
  seedCatalog(resolvedCsv);
  const row = db.prepare('SELECT COALESCE(MAX(rank), 1) AS max_rank FROM cigarettes').get();
  maxRank = Number(row?.max_rank || 1);
}

function closeCigaretteStore() {
  if (db) {
    try { db.close(); } catch { }
    db = null;
    logger.info('Cigarette market DB closed.');
  }
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cigarettes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      rank            INTEGER NOT NULL UNIQUE,
      brand           TEXT NOT NULL,
      variant         TEXT NOT NULL,
      flavor_type     TEXT NOT NULL,
      size            TEXT NOT NULL,
      display_name    TEXT NOT NULL,
      name_key        TEXT NOT NULL UNIQUE,
      weight          REAL NOT NULL,
      total_dispensed INTEGER NOT NULL DEFAULT 0,
      total_smoked    INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_cigarettes (
      user_id       TEXT NOT NULL,
      cigarette_id  INTEGER NOT NULL REFERENCES cigarettes(id),
      quantity      INTEGER NOT NULL DEFAULT 0,
      acquired_count INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, cigarette_id)
    );

    CREATE TABLE IF NOT EXISTS cigarette_trades (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id      TEXT NOT NULL,
      to_user_id        TEXT NOT NULL,
      from_cigarette_id INTEGER NOT NULL REFERENCES cigarettes(id),
      to_cigarette_id   INTEGER NOT NULL REFERENCES cigarettes(id),
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cigarette_sales (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id    TEXT NOT NULL,
      buyer_id     TEXT NOT NULL,
      cigarette_id INTEGER NOT NULL REFERENCES cigarettes(id),
      price        INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cigarette_user_stats (
      user_id        TEXT PRIMARY KEY,
      smoked_total   INTEGER NOT NULL DEFAULT 0,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_cigs_user ON user_cigarettes(user_id);
    CREATE INDEX IF NOT EXISTS idx_cig_trades_from ON cigarette_trades(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_cig_trades_to ON cigarette_trades(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_cig_sales_seller ON cigarette_sales(seller_id);
    CREATE INDEX IF NOT EXISTS idx_cig_sales_buyer ON cigarette_sales(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_cig_user_stats_smoked ON cigarette_user_stats(smoked_total DESC);
  `);
}

function seedCatalog(csvPath) {
  const catalog = parseCatalog(csvPath);

  const upsert = db.prepare(`
    INSERT INTO cigarettes (rank, brand, variant, flavor_type, size, display_name, name_key, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rank) DO UPDATE SET
      brand = excluded.brand,
      variant = excluded.variant,
      flavor_type = excluded.flavor_type,
      size = excluded.size,
      display_name = excluded.display_name,
      name_key = excluded.name_key,
      weight = excluded.weight
  `);

  const tx = db.transaction(() => {
    for (const item of catalog) {
      upsert.run(
        item.rank,
        item.brand,
        item.variant,
        item.flavorType,
        item.size,
        item.displayName,
        item.nameKey,
        item.weight,
      );
    }
  });

  tx();
  logger.info(`Cigarette market: seeded ${catalog.length} entries.`);
}

function getRarityByRank(rank) {
  const percentile = rank / Math.max(maxRank, 1);
  if (percentile <= 0.05) return { tier: 'Legendary', emoji: '🌟' };
  if (percentile <= 0.15) return { tier: 'Epic', emoji: '💜' };
  if (percentile <= 0.35) return { tier: 'Rare', emoji: '🔷' };
  if (percentile <= 0.65) return { tier: 'Uncommon', emoji: '🟢' };
  return { tier: 'Common', emoji: '⚪' };
}

function resolveCigarette(input) {
  const raw = String(input || '').trim();
  if (!raw) return { success: false, error: 'Please provide a cigarette name.' };

  if (/^\d+$/u.test(raw)) {
    const byRank = db.prepare('SELECT * FROM cigarettes WHERE rank = ?').get(Number.parseInt(raw, 10));
    if (byRank) return { success: true, cigarette: byRank };
  }

  const key = normalizeKey(raw);
  const exact = db.prepare('SELECT * FROM cigarettes WHERE name_key = ?').get(key);
  if (exact) return { success: true, cigarette: exact };

  const matches = db.prepare(`
    SELECT *
    FROM cigarettes
    WHERE display_name LIKE ? COLLATE NOCASE
    ORDER BY rank ASC
    LIMIT 6
  `).all(`%${raw}%`);

  if (matches.length === 1) {
    return { success: true, cigarette: matches[0] };
  }

  if (matches.length > 1) {
    const preview = matches.slice(0, 4).map((m) => m.display_name).join(', ');
    return { success: false, error: `That matches multiple cigarettes. Try a more specific name. Examples: ${preview}` };
  }

  return { success: false, error: 'That cigarette was not found in the catalog.' };
}

function chooseWeightedRandom() {
  const rows = db.prepare('SELECT * FROM cigarettes ORDER BY rank ASC').all();
  if (rows.length === 0) return null;

  const totalWeight = rows.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  if (totalWeight <= 0) return rows[Math.floor(Math.random() * rows.length)];

  let roll = Math.random() * totalWeight;
  for (const row of rows) {
    roll -= Number(row.weight || 0);
    if (roll <= 0) {
      return row;
    }
  }

  return rows[rows.length - 1];
}

function upsertUserQuantity(userId, cigaretteId, delta, incrementAcquired = false) {
  if (delta > 0) {
    db.prepare(`
      INSERT INTO user_cigarettes (user_id, cigarette_id, quantity, acquired_count, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, cigarette_id) DO UPDATE SET
        quantity = user_cigarettes.quantity + excluded.quantity,
        acquired_count = user_cigarettes.acquired_count + excluded.acquired_count,
        updated_at = datetime('now')
    `).run(userId, cigaretteId, delta, incrementAcquired ? delta : 0);
    return;
  }

  db.prepare(`
    UPDATE user_cigarettes
    SET quantity = quantity + ?, updated_at = datetime('now')
    WHERE user_id = ? AND cigarette_id = ?
  `).run(delta, userId, cigaretteId);

  db.prepare(`
    DELETE FROM user_cigarettes
    WHERE user_id = ? AND cigarette_id = ? AND quantity <= 0
  `).run(userId, cigaretteId);
}

function dispenseCigarette(userId) {
  const drawn = chooseWeightedRandom();
  if (!drawn) {
    return { success: false, error: 'No cigarettes are loaded in the machine.' };
  }

  const totalRow = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS total
    FROM user_cigarettes
    WHERE user_id = ?
  `).get(userId);
  const totalCount = Number(totalRow?.total || 0);

  const leastRareHeld = db.prepare(`
    SELECT c.id, c.rank, c.display_name, uc.quantity
    FROM user_cigarettes uc
    JOIN cigarettes c ON c.id = uc.cigarette_id
    WHERE uc.user_id = ? AND uc.quantity > 0
    ORDER BY c.rank DESC, uc.quantity DESC, c.id DESC
    LIMIT 1
  `).get(userId);

  let action = 'added';
  let replaced = null;

  const tx = db.transaction(() => {
    if (totalCount < CASE_LIMIT) {
      upsertUserQuantity(userId, drawn.id, 1, true);
      action = 'added';
    } else if (leastRareHeld && drawn.rank < leastRareHeld.rank) {
      upsertUserQuantity(userId, leastRareHeld.id, -1, false);
      upsertUserQuantity(userId, drawn.id, 1, true);
      action = 'replaced';
      replaced = leastRareHeld;
    } else {
      action = 'rejected_full';
    }

    db.prepare('UPDATE cigarettes SET total_dispensed = total_dispensed + 1 WHERE id = ?').run(drawn.id);
  });
  tx();

  return {
    success: true,
    action,
    caseLimit: CASE_LIMIT,
    replacedCigarette: replaced,
    cigarette: drawn,
    rarity: getRarityByRank(drawn.rank),
  };
}

function getUserCase(userId) {
  return db.prepare(`
    SELECT c.id, c.rank, c.brand, c.variant, c.flavor_type, c.size, c.display_name, uc.quantity
    FROM user_cigarettes uc
    JOIN cigarettes c ON c.id = uc.cigarette_id
    WHERE uc.user_id = ? AND uc.quantity > 0
    ORDER BY c.rank ASC, uc.quantity DESC, c.display_name ASC
  `).all(userId);
}

function smokeCigarette(userId, input) {
  const resolved = resolveCigarette(input);
  if (!resolved.success) return resolved;

  const holding = db.prepare(`
    SELECT quantity
    FROM user_cigarettes
    WHERE user_id = ? AND cigarette_id = ?
  `).get(userId, resolved.cigarette.id);

  if (!holding || holding.quantity < 1) {
    return { success: false, error: `You don't have **${resolved.cigarette.display_name}** in your case.` };
  }

  const tx = db.transaction(() => {
    upsertUserQuantity(userId, resolved.cigarette.id, -1, false);
    db.prepare('UPDATE cigarettes SET total_smoked = total_smoked + 1 WHERE id = ?').run(resolved.cigarette.id);
    db.prepare(`
      INSERT INTO cigarette_user_stats (user_id, smoked_total, updated_at)
      VALUES (?, 1, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        smoked_total = cigarette_user_stats.smoked_total + 1,
        updated_at = datetime('now')
    `).run(userId);
  });
  tx();

  return {
    success: true,
    cigarette: resolved.cigarette,
    rarity: getRarityByRank(resolved.cigarette.rank),
  };
}

function tradeCigarettes(userAId, userAInput, userBId, userBInput) {
  const cigA = resolveCigarette(userAInput);
  if (!cigA.success) return cigA;

  const cigB = resolveCigarette(userBInput);
  if (!cigB.success) return cigB;

  const ownA = db.prepare('SELECT quantity FROM user_cigarettes WHERE user_id = ? AND cigarette_id = ?').get(userAId, cigA.cigarette.id);
  if (!ownA || ownA.quantity < 1) {
    return { success: false, error: `You don't own **${cigA.cigarette.display_name}**.` };
  }

  const ownB = db.prepare('SELECT quantity FROM user_cigarettes WHERE user_id = ? AND cigarette_id = ?').get(userBId, cigB.cigarette.id);
  if (!ownB || ownB.quantity < 1) {
    return { success: false, error: `They don't own **${cigB.cigarette.display_name}**.` };
  }

  const tx = db.transaction(() => {
    upsertUserQuantity(userAId, cigA.cigarette.id, -1, false);
    upsertUserQuantity(userBId, cigA.cigarette.id, 1, false);

    upsertUserQuantity(userBId, cigB.cigarette.id, -1, false);
    upsertUserQuantity(userAId, cigB.cigarette.id, 1, false);

    db.prepare(`
      INSERT INTO cigarette_trades (from_user_id, to_user_id, from_cigarette_id, to_cigarette_id)
      VALUES (?, ?, ?, ?)
    `).run(userAId, userBId, cigA.cigarette.id, cigB.cigarette.id);
  });
  tx();

  return {
    success: true,
    cigaretteA: cigA.cigarette,
    cigaretteB: cigB.cigarette,
    rarityA: getRarityByRank(cigA.cigarette.rank),
    rarityB: getRarityByRank(cigB.cigarette.rank),
  };
}

function tradeCigaretteForMoney(sellerId, sellerInput, buyerId, price) {
  const amount = Number.parseInt(price, 10);
  if (!Number.isFinite(amount) || amount < 1) {
    return { success: false, error: 'Price must be at least 1 SGC.' };
  }

  const cig = resolveCigarette(sellerInput);
  if (!cig.success) return cig;

  const own = db.prepare('SELECT quantity FROM user_cigarettes WHERE user_id = ? AND cigarette_id = ?').get(sellerId, cig.cigarette.id);
  if (!own || own.quantity < 1) {
    return { success: false, error: `You don't own **${cig.cigarette.display_name}**.` };
  }

  const tx = db.transaction(() => {
    upsertUserQuantity(sellerId, cig.cigarette.id, -1, false);
    upsertUserQuantity(buyerId, cig.cigarette.id, 1, false);

    db.prepare(`
      INSERT INTO cigarette_sales (seller_id, buyer_id, cigarette_id, price)
      VALUES (?, ?, ?, ?)
    `).run(sellerId, buyerId, cig.cigarette.id, amount);
  });
  tx();

  return {
    success: true,
    cigarette: cig.cigarette,
    rarity: getRarityByRank(cig.cigarette.rank),
    price: amount,
  };
}

function getTopSmokers(limit = 10) {
  const maxRows = Math.max(1, Math.min(25, Number.parseInt(limit, 10) || 10));
  return db.prepare(`
    SELECT user_id, smoked_total
    FROM cigarette_user_stats
    WHERE smoked_total > 0
    ORDER BY smoked_total DESC, user_id ASC
    LIMIT ?
  `).all(maxRows);
}

module.exports = {
  DISPENSE_PRICE,
  CASE_LIMIT,
  initCigaretteStore,
  closeCigaretteStore,
  getRarityByRank,
  resolveCigarette,
  dispenseCigarette,
  getUserCase,
  smokeCigarette,
  getTopSmokers,
  tradeCigarettes,
  tradeCigaretteForMoney,
};
