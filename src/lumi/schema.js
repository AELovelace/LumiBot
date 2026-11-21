'use strict';

/**
 * Lumi games: every lumi_* table, created with CREATE TABLE IF NOT EXISTS in the ECONOMY database.
 *
 * Translated from erinne migrations/games/0001_games.sql, 0002_lumi_launch.sql and 0003_lumi_city.sql:
 *  - every table is prefixed lumi_ (prism_runs -> lumi_prism_runs, lumisoft_* -> lumi_soft_*, arcade_* -> lumi_arcade_*);
 *  - user ids are TEXT (Discord snowflakes are bigger than 2^53, so never INTEGER);
 *  - dropped: coin_accounts / coin_transactions (SadGirlCoin's accounts + transactions replace them),
 *    lumi_push_events, push_subscriptions, casino_rooms, runner_runs (StickBob is not ported).
 * Plus LumiBot's own money tables: lumi_coin_refs, lumi_daily, lumi_owed, lumi_accounts, lumi_admin_log, lumi_users.
 * The full list (and who owns which) is in src/lumi/CONTRACT.md.
 */

const {
  LUMI_SNACKS_USER_ID,      // Lumi's Snack Stand
  LUMI_BOUTIQUE_USER_ID,    // Lumi's Boutique
  LUMI_CAPSULES_USER_ID,    // Moon Capsule Co.
  LUMI_OUTFITTERS_USER_ID,  // Dungeon Outfitters
  LUMI_NURSERY_USER_ID,     // Starpowder Nursery
  LUMI_ARCADE_USER_ID,      // Lumi Arcade
  LUMI_REALTY_USER_ID,      // Lumi City Realty
} = require('../sadgirlEconomyStore');

const SCHEMA_SQL = `
  -- ---------------------------------------------------------------- game state (from erinne 0001_games.sql)
  CREATE TABLE IF NOT EXISTS lumi_pets (
    user_id    TEXT PRIMARY KEY,                       -- Discord id
    data       TEXT NOT NULL,                          -- the pet document (JSON); src/lumi/pet/save.js owns its shape
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lumi_gardens (
    user_id    TEXT PRIMARY KEY,
    state      TEXT NOT NULL,                          -- JSON, owned by the garden module
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lumi_runs (
    user_id    TEXT PRIMARY KEY,                       -- one dungeon run per player
    state      TEXT NOT NULL,                          -- JSON, owned by the dungeon module
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lumi_battles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,      -- also names the win's coin ref (lumi-battle:<id>), so it pays once
    user_id    TEXT NOT NULL,
    state      TEXT NOT NULL,
    turn       INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'active',         -- active, victory, defeat, ran
    created_at INTEGER NOT NULL                        -- milliseconds
  );
  CREATE UNIQUE INDEX IF NOT EXISTS lumi_battles_one_active ON lumi_battles(user_id) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS lumi_parties (
    code       TEXT PRIMARY KEY,
    state      TEXT NOT NULL,
    updated_at REAL NOT NULL                           -- unix seconds of the last real change
  );

  CREATE TABLE IF NOT EXISTS lumi_party_members (
    user_id TEXT PRIMARY KEY,
    code    TEXT NOT NULL REFERENCES lumi_parties(code) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS lumi_party_members_code ON lumi_party_members(code);

  CREATE TABLE IF NOT EXISTS lumi_arcade_rooms (
    code       TEXT PRIMARY KEY,
    game       TEXT NOT NULL,                          -- breakout, snake or teacup-tower
    state      TEXT NOT NULL,
    updated_at REAL NOT NULL                           -- unix seconds
  );
  CREATE INDEX IF NOT EXISTS lumi_arcade_rooms_game ON lumi_arcade_rooms(game, updated_at);

  CREATE TABLE IF NOT EXISTS lumi_arcade_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    game       TEXT NOT NULL,
    seed       INTEGER NOT NULL,
    room       TEXT,                                   -- the showdown table it races at; NULL for a solo run
    started_at REAL NOT NULL,
    finished   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS lumi_arcade_runs_user ON lumi_arcade_runs(user_id, game, finished);

  CREATE TABLE IF NOT EXISTS lumi_prism_runs (
    user_id    TEXT PRIMARY KEY,
    drops      INTEGER NOT NULL DEFAULT 0,
    score      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lumi_soft_progress (
    user_id TEXT PRIMARY KEY,
    data    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lumi_soft_bests (
    user_id TEXT NOT NULL,
    board   TEXT NOT NULL,
    score   INTEGER NOT NULL,
    rank    TEXT NOT NULL DEFAULT '',
    at      REAL NOT NULL,
    PRIMARY KEY (user_id, board)
  );
  CREATE INDEX IF NOT EXISTS lumi_soft_bests_board ON lumi_soft_bests(board, score DESC);

  CREATE TABLE IF NOT EXISTS lumi_soft_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    mode       TEXT NOT NULL,                          -- training, story, stage or daily
    stage      TEXT,
    day        INTEGER NOT NULL DEFAULT 0,
    practice   INTEGER NOT NULL DEFAULT 0,             -- 1: free retry / training, pays nothing
    started_at REAL NOT NULL,
    continues  INTEGER NOT NULL DEFAULT 0,
    finished   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS lumi_soft_runs_user ON lumi_soft_runs(user_id, finished);

  -- ---------------------------------------------------------------- Lumi Launch (from erinne 0002_lumi_launch.sql)
  CREATE TABLE IF NOT EXISTS lumi_launch_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,      -- also names the payout's coin ref, so a go pays once
    user_id    TEXT NOT NULL,
    seed       INTEGER NOT NULL,
    started_at REAL NOT NULL,
    finished   INTEGER NOT NULL DEFAULT 0,
    score      INTEGER NOT NULL DEFAULT 0,
    paid       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS lumi_launch_runs_user ON lumi_launch_runs(user_id, finished);

  CREATE TABLE IF NOT EXISTS lumi_launch_bests (
    user_id   TEXT PRIMARY KEY,
    best_go   INTEGER NOT NULL DEFAULT 0,
    best_shot INTEGER NOT NULL DEFAULT 0,
    at        REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lumi_launch_bests_go ON lumi_launch_bests(best_go DESC);

  -- ---------------------------------------------------------------- Lumi City (from erinne 0003_lumi_city.sql)
  CREATE TABLE IF NOT EXISTS lumi_city_towns (
    town   TEXT PRIMARY KEY CHECK (town IN ('left', 'right')),
    blocks INTEGER NOT NULL CHECK (blocks >= 1)
  );

  CREATE TABLE IF NOT EXISTS lumi_plots (
    town       TEXT NOT NULL CHECK (town IN ('left', 'right')),
    block      INTEGER NOT NULL CHECK (block >= 1),
    lot        INTEGER NOT NULL CHECK (lot BETWEEN 1 AND 8),
    user_id    TEXT NOT NULL,                          -- the owner; a lot with no row is office land, for sale
    style      TEXT NOT NULL DEFAULT '',
    yard       TEXT NOT NULL DEFAULT '{}',
    paid       INTEGER NOT NULL DEFAULT 0,             -- what the owner paid, in SGC actually charged
    bought_at  INTEGER NOT NULL,                       -- milliseconds
    list_price INTEGER CHECK (list_price IS NULL OR list_price > 0),
    listed_at  INTEGER,
    version    INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (town, block, lot)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS lumi_plots_one_each ON lumi_plots(user_id);
  CREATE INDEX IF NOT EXISTS lumi_plots_listed ON lumi_plots(list_price) WHERE list_price IS NOT NULL;

  -- ---------------------------------------------------------------- LumiBot's money tables (src/lumi/sgc.js, treasury.js)
  CREATE TABLE IF NOT EXISTS lumi_coin_refs (
    ref     TEXT PRIMARY KEY,                          -- e.g. 'lumi-prism:<run>': this payout can only ever happen once
    user_id TEXT NOT NULL,
    amount  INTEGER NOT NULL DEFAULT 0,                -- SGC actually paid for it so far (owed prizes add theirs when paid)
    at      INTEGER NOT NULL                           -- milliseconds
  );

  CREATE TABLE IF NOT EXISTS lumi_daily (
    user_id TEXT NOT NULL,
    game    TEXT NOT NULL,
    day     TEXT NOT NULL,                             -- 'YYYY-MM-DD', Los Angeles
    earned  INTEGER NOT NULL DEFAULT 0,                -- scaled SGC of prizes won today (paid or owed), for the daily cap
    PRIMARY KEY (user_id, game, day)
  );

  CREATE TABLE IF NOT EXISTS lumi_owed (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,        -- oldest first
    user_id  TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    amount   INTEGER NOT NULL CHECK (amount > 0),
    game     TEXT NOT NULL,
    kind     TEXT NOT NULL,
    ref      TEXT UNIQUE,                              -- the payout's ref
    at       INTEGER NOT NULL                          -- milliseconds
  );

  CREATE TABLE IF NOT EXISTS lumi_accounts (
    category     TEXT PRIMARY KEY,                     -- snacks, boutique, capsules, outfitters, nursery, arcade, realty
    account_id   TEXT NOT NULL,                        -- the __LUMI_*__ account spends in this category land in
    display_name TEXT NOT NULL,
    games_json   TEXT NOT NULL DEFAULT '[]'            -- ["game", "game:kind", ...] that feed it
  );

  CREATE TABLE IF NOT EXISTS lumi_admin_log (
    id  INTEGER PRIMARY KEY AUTOINCREMENT,
    who TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    old TEXT,
    new TEXT,
    at  INTEGER NOT NULL                               -- milliseconds
  );

  CREATE TABLE IF NOT EXISTS lumi_users (
    user_id    TEXT PRIMARY KEY,                       -- Discord id
    name       TEXT NOT NULL DEFAULT '',               -- display name from the last login (users.js)
    avatar     TEXT NOT NULL DEFAULT '',               -- Discord avatar hash
    updated_at INTEGER NOT NULL DEFAULT 0              -- milliseconds
  );

  -- Lumi-Town on Discord (src/lumi/discord, docs/plans/lumi-town-discord.md): one row per player who changed a setting.
  CREATE TABLE IF NOT EXISTS lumi_discord_prefs (
    user_id      TEXT PRIMARY KEY,                     -- Discord id
    remind       INTEGER NOT NULL DEFAULT 0,           -- 1 = DM reminders on (opt-in: off until they turn it on)
    tz           TEXT,                                 -- IANA zone for quiet hours; NULL = America/Los_Angeles
    news_hidden  INTEGER NOT NULL DEFAULT 0,           -- 1 = Lumi-Town news never names them
    dm_failed_at INTEGER,                              -- ms of the last "can't DM this user" (reminders switched off then)
    updated_at   INTEGER NOT NULL DEFAULT 0            -- milliseconds
  );
  CREATE INDEX IF NOT EXISTS lumi_discord_prefs_remind ON lumi_discord_prefs (remind, user_id);

  -- Reminder episodes waiting for (or sent in) a DM (erinne lumi_push_events). One row per need episode, so each
  -- need is mentioned once even across restarts.
  CREATE TABLE IF NOT EXISTS lumi_remind_events (
    user_id    TEXT NOT NULL,                          -- Discord id
    kind       TEXT NOT NULL,                          -- hunger | energy | joy | nap | garden
    episode    TEXT NOT NULL,                          -- when that need began (ms, as text)
    created_at INTEGER NOT NULL,                       -- ms
    sent_at    INTEGER,                                -- ms; NULL = still waiting
    PRIMARY KEY (user_id, kind, episode)
  );
`;

/** Which games (and game:kind pairs) feed each themed account by default. Admins can change these rows later. */
const DEFAULT_CATEGORIES = Object.freeze([
  { category: 'snacks', accountId: LUMI_SNACKS_USER_ID, displayName: "Lumi's Snack Stand", games: ['pet:snacks'] },           // snacks + toys
  { category: 'boutique', accountId: LUMI_BOUTIQUE_USER_ID, displayName: "Lumi's Boutique", games: ['pet:boutique'] },        // decor, wear, house things
  { category: 'capsules', accountId: LUMI_CAPSULES_USER_ID, displayName: 'Moon Capsule Co.', games: ['pet:capsule'] },       // capsules + moon capsules
  { category: 'outfitters', accountId: LUMI_OUTFITTERS_USER_ID, displayName: 'Dungeon Outfitters', games: ['battle', 'dungeon', 'party'] }, // respec, mods, potions...
  { category: 'nursery', accountId: LUMI_NURSERY_USER_ID, displayName: 'Starpowder Nursery', games: ['garden'] },             // plots + seeds
  { category: 'arcade', accountId: LUMI_ARCADE_USER_ID, displayName: 'Lumi Arcade',                                          // entries, continues, bets
    games: ['prism', 'launch', 'soft', 'breakout', 'snake', 'teacup-tower'] },
  { category: 'realty', accountId: LUMI_REALTY_USER_ID, displayName: 'Lumi City Realty', games: ['city'] },                   // plots, styles, yards, estate capsules
]);

/** Create every lumi_* table (safe to run on every start) and seed the category rows that are missing. */
function createLumiSchema(db) {
  db.exec(SCHEMA_SQL);                                                          // all tables + indexes
  const seed = db.prepare(`
    INSERT OR IGNORE INTO lumi_accounts (category, account_id, display_name, games_json) VALUES (?, ?, ?, ?)
  `);                                                                           // never overwrites an admin's edits
  for (const c of DEFAULT_CATEGORIES) seed.run(c.category, c.accountId, c.displayName, JSON.stringify(c.games)); // one row each
}

/** Every table this file creates, for docs, tests and the admin page. */
const LUMI_TABLES = Object.freeze([
  'lumi_pets', 'lumi_gardens', 'lumi_runs', 'lumi_battles', 'lumi_parties', 'lumi_party_members',
  'lumi_arcade_rooms', 'lumi_arcade_runs', 'lumi_prism_runs', 'lumi_soft_progress', 'lumi_soft_bests', 'lumi_soft_runs',
  'lumi_launch_runs', 'lumi_launch_bests', 'lumi_city_towns', 'lumi_plots',
  'lumi_coin_refs', 'lumi_daily', 'lumi_owed', 'lumi_accounts', 'lumi_admin_log', 'lumi_users',
  'lumi_discord_prefs', 'lumi_remind_events',
]);

module.exports = {
  createLumiSchema,     // make every table + seed lumi_accounts
  DEFAULT_CATEGORIES,   // the category -> account -> games defaults
  LUMI_TABLES,          // the table names
};
