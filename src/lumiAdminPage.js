'use strict';

/**
 * Lumi-Town admin page for the web control panel (port 7777): GET /lumi and the POST /lumi/<action> forms.
 * Spec: docs/plans/lumi-games-port.md sections 3 and 4. APIs used: src/lumi/CONTRACT.md sections 6-7.
 *
 * Sections on the page:
 *   1. Treasury dashboard (treasury.status(), LUMI price + shareholders)
 *   2. Game knobs + live 24 h / 7 d stats from the SGC ledger (type lumi_<game>_<kind>)
 *   3. Per-item price / payout overrides (JSON per game)
 *   4. Global economy scale with a preview table
 *   5. Treasury policy form
 *   6. Actions: sweep, seed, move SGC, categories, pay owed, pause payouts
 *   7. Recent admin log (lumi_admin_log)
 *
 * Security: every request needs a panel-admin session (requireAuth); every POST is checked same-origin against the
 * panel's own trusted list (WEB_PANEL_TRUSTED_ORIGINS); every value printed is HTML-escaped; every POST answers with
 * a 303 redirect back to /lumi carrying a one-time flash token (the message itself never travels in the URL).
 * Every change goes through tuning.set / tuning.setGame / treasury.* (they write lumi_admin_log as the admin's name).
 */

const crypto = require('node:crypto');                                             // random flash tokens
const { logger } = require('./logger');                                             // panel log lines
const { requireAuth, validateSameOrigin, getTrustedHosts } = require('./webPanelAuth'); // admin session + CSRF check
const eco = require('./sadgirlEconomyStore');                                       // balances + Lumi account ids
const stockStore = require('./privateStockStore');                                  // LUMI price + shareholders
const tuning = require('./lumi/tuning');                                            // knobs (set / setGame / reload)
const treasury = require('./lumi/treasury');                                        // status, sweep, seed, moves
const { getDb } = require('./lumi/db');                                             // economy DB

const ROUTE = '/lumi';                                                              // the page's path on the panel
const MAX_BODY_BYTES = 64 * 1024;                                                   // form bodies bigger than this are refused
const FLASH_TTL_MS = 5 * 60 * 1000;                                                 // a flash message lives 5 minutes
const FLASH_MAX = 200;                                                              // never keep more than this many
const GAME_ID = /^[a-z0-9-]{1,32}$/u;                                               // same shape tuning.js accepts
const OVERRIDE_KEY = /^[A-Za-z0-9_.:-]{1,64}$/u;                                    // same shape tuning.js keeps
const CATEGORY_ENTRY = /^[a-z0-9-]{1,32}(:[a-z0-9-]{1,32})?$/u;                    // "game" or "game:kind"
const LEDGER_TYPE = /^lumi_([a-z0-9-]{1,32})_([a-z0-9-]{1,32})$/u;                 // lumi_<game>_<kind>
const NOT_GAMES = new Set(['share', 'owed', 'emergency', 'admin']);                 // lumi_* types that are not games
const PREVIEW_NATIVES = [                                                           // representative erinne numbers (plan section 4)
  { label: 'Capsule', game: 'pet', key: 'capsule', native: 150, kind: 'price' },               // item: 150 -> 150 at item scale 1
  { label: 'Moon capsule', game: 'pet', key: 'moon', native: 300, kind: 'price' },             // item: 300 -> 300 at item scale 1
  { label: 'Arcade entry', game: 'soft', key: 'entry', native: 25, kind: 'price' },            // play: 25 -> 5 at play scale 0.2
  { label: 'Lumi-Soft continue', game: 'soft', key: 'continue', native: 50, kind: 'price' },    // play: 50 -> 10 at play scale 0.2
];                                                                                  // more rows come from the define() registry
const POLICY_FIELDS = [                                                             // the treasury policy form, in order
  { field: 'bankTarget', key: 'lumi.treasury.bankTarget', label: 'Bank target (SGC = 100% health)' },           // whole SGC
  { field: 'bankCeiling', key: 'lumi.treasury.bankCeiling', label: 'Bank ceiling (overflow above; 0 = off)' },   // whole SGC
  { field: 'sweepIntervalMs', key: 'lumi.treasury.sweepIntervalMs', label: 'Sweep interval (ms, min 60000)' },  // ms
  { field: 'refillBufferPct', key: 'lumi.treasury.refillBufferPct', label: 'Refill buffer (share of target, 0-1)' }, // 0..1
  { field: 'reserveFloor', key: 'lumi.treasury.reserveFloor', label: 'Holdings reserve floor (SGC)' },          // whole SGC
  { field: 'lumiDividendRate', key: 'lumi.treasury.lumiDividendRate', label: 'LUMI weekly dividend rate (0-1)' }, // 0..1
];                                                                                  // bands are their own JSON field

const flashes = new Map();                                                          // token -> { type, message, at }

/** A bad form value: shown to the admin as-is (it never contains anything but our own words + their input). */
class InputError extends Error {}                                                   // marks "your input was wrong"

// ---------------------------------------------------------------------------------------------- small helpers

// Escape text for HTML (body text AND attribute values, single quotes too).
function esc(value) {
  return String(value === undefined || value === null ? '' : value)                 // null/undefined print as nothing
    .replace(/&/gu, '&amp;')                                                        // & first so we don't double-escape
    .replace(/</gu, '&lt;')                                                         // no tags
    .replace(/>/gu, '&gt;')                                                         // no tags
    .replace(/"/gu, '&quot;')                                                       // safe in "attributes"
    .replace(/'/gu, '&#39;');                                                       // safe in 'attributes'
}

// A whole number with thousands separators ("—" for anything not a number).
function fmt(n) {
  const v = Number(n);                                                              // accept strings too
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '—';                      // 12,345
}

// A share (0.5) as a percent with one decimal ("∞" for Infinity, "—" for NaN).
function pct(x) {
  if (x === Infinity) return '∞';                                                   // e.g. health with a 0 target
  return Number.isFinite(x) ? `${Math.round(x * 1000) / 10}%` : '—';                // 0.5 -> 50%
}

// A millisecond timestamp as "YYYY-MM-DD HH:MM:SS UTC".
function when(ms) {
  const n = Number(ms);                                                             // stored as INTEGER ms
  return Number.isFinite(n) && n > 0 ? `${new Date(n).toISOString().replace('T', ' ').slice(0, 19)} UTC` : '—'; // readable
}

// The admin's Discord name for lumi_admin_log (falls back to their id).
function whoOf(session) {
  return String(session?.username || session?.discordId || 'admin').slice(0, 64);  // short and never empty
}

// The panel's base-path prefixer when webPanel doesn't hand us its own.
function defaultP(path) {
  const base = (process.env.WEB_PANEL_BASE_PATH || '').replace(/\/+$/u, '');        // same rule as webPanel.js
  return `${base}${path}`;                                                          // e.g. /dollpanel/admin/lumi
}

// A bare page shell, used only when webPanel doesn't pass its buildPageHtml (tests).
function defaultShell(body, title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}</body></html>`; // minimal page
}

// True when this path belongs to the Lumi-Town admin page.
function isLumiAdminPath(pathname) {
  return pathname === ROUTE || String(pathname || '').startsWith(`${ROUTE}/`);     // /lumi or /lumi/<action>
}

// Is Lumi-Town running in this process (its tables exist)?
function lumiReady() {
  try {
    return Boolean(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lumi_accounts'").get()); // schema made by initLumiGames
  } catch {
    return false;                                                                   // economy DB not open
  }
}

// ---------------------------------------------------------------------------------------------- flash messages

// Store a flash message and return its one-time token.
function putFlash(type, message) {
  const cutoff = Date.now() - FLASH_TTL_MS;                                         // anything older is stale
  for (const [token, f] of flashes) if (f.at < cutoff || flashes.size >= FLASH_MAX) flashes.delete(token); // prune old ones (oldest first)
  const token = crypto.randomBytes(12).toString('hex');                             // unguessable id
  flashes.set(token, { type, message: String(message).slice(0, 2000), at: Date.now() }); // remember it
  return token;                                                                     // goes in the redirect URL
}

// Read (and forget) a flash message by token.
function takeFlash(token) {
  if (!token || !flashes.has(token)) return null;                                   // unknown or used
  const f = flashes.get(token);                                                     // the message
  flashes.delete(token);                                                            // one-time
  return Date.now() - f.at <= FLASH_TTL_MS ? f : null;                              // expired ones are dropped
}

// The flash box HTML (panel classes).
function renderFlash(flash) {
  if (!flash) return '';                                                            // nothing to show
  const cls = flash.type === 'error' ? 'flash-error' : flash.type === 'success' ? 'flash-success' : 'flash-info'; // colour
  return `<div class="flash ${cls}">${esc(flash.message)}</div>`;                   // escaped text
}

// ---------------------------------------------------------------------------------------------- request plumbing

// Read an x-www-form-urlencoded body (64 KB cap) into a plain object.
function readForm(req) {
  return new Promise((resolve, reject) => {
    let size = 0;                                                                   // bytes so far
    const chunks = [];                                                              // raw pieces
    req.on('data', (chunk) => {
      size += chunk.length;                                                         // count
      if (size > MAX_BODY_BYTES) { reject(new InputError('That form was too big.')); req.destroy(); return; } // refuse huge bodies
      chunks.push(chunk);                                                           // keep it
    });
    req.on('end', () => {
      const out = Object.create(null);                                              // no prototype keys
      for (const [k, v] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) out[k] = v; // last value wins
      resolve(out);                                                                 // the fields
    });
    req.on('error', reject);                                                        // connection trouble
  });
}

// Send an HTML response.
function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); // never cache admin pages
  res.end(html);                                                                    // the page
}

// 303 back to the page (with a flash token and a section anchor).
function redirectBack(res, p, flashToken, anchor) {
  const location = `${p(ROUTE)}${flashToken ? `?flash=${flashToken}` : ''}${anchor ? `#${anchor}` : ''}`; // /lumi?flash=..#knobs
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });          // POST -> GET
  res.end();                                                                        // no body
}

// ---------------------------------------------------------------------------------------------- input parsing

// A whole number within [min, max].
function parseWhole(raw, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(raw === undefined ? '' : raw).trim().replace(/[,_\s]/gu, ''); // allow 250,000 / 250_000
  if (!/^-?\d+$/u.test(text)) throw new InputError(`${label} must be a whole number.`); // digits only
  const n = Number(text);                                                           // to a number
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new InputError(`${label} must be between ${fmt(min)} and ${fmt(max)}.`); // range
  return n;                                                                         // clean value
}

// A decimal number within [min, max] (minExclusive: must be above min).
function parseDecimal(raw, label, { min = 0, max = Number.MAX_SAFE_INTEGER, minExclusive = false } = {}) {
  const text = String(raw === undefined ? '' : raw).trim();                         // tidy
  const n = text === '' ? NaN : Number(text);                                       // empty is not 0
  const tooLow = minExclusive ? !(n > min) : !(n >= min);                           // lower bound
  if (!Number.isFinite(n) || tooLow || n > max) throw new InputError(`${label} must be a number ${minExclusive ? 'above' : 'from'} ${min}${minExclusive ? ' and up to' : ' to'} ${max}.`); // range
  return n;                                                                         // clean value
}

// An overrides JSON map {key: whole SGC >= 0}; '' means "no overrides". Refuses (not drops) anything bad.
function parseOverridesInput(raw, label) {
  const text = String(raw === undefined ? '' : raw).trim();                         // tidy
  if (text === '') return {};                                                       // cleared
  let obj;                                                                          // parsed JSON
  try { obj = JSON.parse(text); } catch { throw new InputError(`${label}: that isn't valid JSON (example: {"entry": 3}).`); } // syntax
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new InputError(`${label}: use a JSON object like {"entry": 3}.`); // shape
  const out = {};                                                                   // cleaned map
  for (const [k, v] of Object.entries(obj)) {
    if (!OVERRIDE_KEY.test(k)) throw new InputError(`${label}: "${k}" is not a valid key (letters, digits, _ . : - only).`); // key shape
    if (!Number.isSafeInteger(v) || v < 0) throw new InputError(`${label}: "${k}" must be a whole number of SGC, 0 or more.`); // value shape
    out[k] = v;                                                                     // keep it
  }
  return out;                                                                       // e.g. { entry: 3 }
}

// The sweep bands JSON [[healthBelow|null, rate], ...]: strictly rising limits > 0, rates 0..1. Returns clean JSON text.
function parseBandsInput(raw) {
  let arr;                                                                          // parsed JSON
  try { arr = JSON.parse(String(raw || '')); } catch { throw new InputError('Sweep bands must be JSON like [[0.25,1],[0.5,0.75],[null,0.1]].'); } // syntax
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 20) throw new InputError('Sweep bands must be a list of 1 to 20 [health below, rate] pairs.'); // shape
  const clean = arr.map((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new InputError(`Band ${i + 1} must be a [health below, rate] pair.`); // pair shape
    const open = pair[0] === null || pair[0] === 'Infinity';                        // "and above"
    if (open && i !== arr.length - 1) throw new InputError('Only the last band may be open-ended (null).'); // open only at the top
    const limit = open ? null : Number(pair[0]);                                    // the health limit
    if (!open && !(Number.isFinite(limit) && limit > 0)) throw new InputError(`Band ${i + 1}: the health limit must be a number above 0.`); // limit > 0
    const rate = Number(pair[1]);                                                   // the tax share
    if (typeof pair[1] !== 'number' || !(rate >= 0 && rate <= 1)) throw new InputError(`Band ${i + 1}: the rate must be from 0 to 1.`); // 0..1
    return [limit, rate];                                                           // cleaned
  });
  for (let i = 1; i < clean.length; i++) {
    if (clean[i][0] !== null && !(clean[i][0] > clean[i - 1][0])) throw new InputError('Band limits must rise from band to band.'); // ascending
  }
  return JSON.stringify(clean);                                                     // e.g. [[0.25,1],...,[null,0.1]]
}

// The current bands as JSON text for the form (Infinity -> null).
function bandsToJson(bands) {
  return JSON.stringify(bands.map(([below, rate]) => [below === Infinity ? null : below, rate])); // JSON has no Infinity
}

// ---------------------------------------------------------------------------------------------- data gathering

// Every game id the page lists: the define() registry first, then any game with stored knobs.
function gameIds() {
  const ids = tuning.definedGames().map((g) => g.game);                             // registry order
  for (const g of Object.keys(tuning.clientTuning().games)) if (!ids.includes(g)) ids.push(g); // stored-only games
  return ids;                                                                       // ['pet', 'battle', ...]
}

// A game's label from the registry (its id when undefined).
function gameLabel(game) {
  return tuning.definedGames().find((g) => g.game === game)?.label || game;         // e.g. 'Prism Drop'
}

// Empty stats bucket for one window.
function emptyWindow() {
  return { spends: 0, in: 0, refunds: 0, prizes: 0, out: 0 };                       // counts + SGC
}

/**
 * Per-game ledger stats for 24 h and 7 d, in TWO indexed queries (to_user_id / from_user_id IN the Lumi accounts):
 *   SGC in  = player -> Lumi account rows typed lumi_<game>_<kind> (spends), minus refunds back to players
 *   SGC out = Lumi account -> player rows typed lumi_<game>_<kind> (prizes) + lumi_owed_paid (game from its note)
 * Returns { game: { d1: {...}, d7: {...} } }.
 */
function ledgerStats() {
  const db = getDb();                                                               // economy DB
  const ids = eco.LUMI_ACCOUNT_IDS;                                                 // the nine Lumi accounts
  const marks = ids.map(() => '?').join(',');                                       // (?,?,...)
  const sums = "COUNT(*) AS n7, COALESCE(SUM(amount),0) AS s7, COALESCE(SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END),0) AS n1, COALESCE(SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN amount ELSE 0 END),0) AS s1"; // both windows in one pass
  const window = "created_at >= datetime('now','-7 days') AND type LIKE 'lumi\\_%' ESCAPE '\\'"; // last 7 days, Lumi rows only
  const inRows = db.prepare(`SELECT type, ${sums} FROM transactions WHERE to_user_id IN (${marks}) AND from_user_id NOT IN (${marks}) AND ${window} GROUP BY type`).all(...ids, ...ids); // players -> Lumi
  const outRows = db.prepare(`SELECT type, CASE WHEN type = 'lumi_owed_paid' THEN substr(note, 1, instr(note, ':') - 1) ELSE '' END AS owed_game, ${sums} FROM transactions WHERE from_user_id IN (${marks}) AND to_user_id NOT IN (${marks}) AND ${window} GROUP BY type, owed_game`).all(...ids, ...ids); // Lumi -> players
  const stats = {};                                                                 // game -> windows
  const bucket = (game) => (stats[game] ||= { d1: emptyWindow(), d7: emptyWindow() }); // make on first use
  for (const r of inRows) {
    const m = LEDGER_TYPE.exec(r.type);                                             // lumi_<game>_<kind>
    if (!m || NOT_GAMES.has(m[1])) continue;                                        // seeds, share buys ...
    const b = bucket(m[1]);                                                         // this game's stats
    b.d1.spends += r.n1; b.d1.in += r.s1; b.d7.spends += r.n7; b.d7.in += r.s7;     // spends
  }
  for (const r of outRows) {
    let game = null;                                                                // whose prize it was
    let refund = false;                                                             // refunds lower "in" instead
    if (r.type === 'lumi_owed_paid') game = GAME_ID.test(r.owed_game || '') ? r.owed_game : null; // owed prize paid later
    else {
      const m = LEDGER_TYPE.exec(r.type);                                           // lumi_<game>_<kind>
      if (m && !NOT_GAMES.has(m[1])) { game = m[1]; refund = m[2] === 'refund'; }   // a game's prize or refund
    }
    if (!game) continue;                                                            // dividends, share sells ...
    const b = bucket(game);                                                         // this game's stats
    if (refund) { b.d1.refunds += r.s1; b.d7.refunds += r.s7; continue; }           // money given back
    b.d1.prizes += r.n1; b.d1.out += r.s1; b.d7.prizes += r.n7; b.d7.out += r.s7;   // prizes
  }
  return stats;                                                                     // { launch: { d1, d7 }, ... }
}

// LUMI's price and shareholder count ({} when the exchange isn't running).
function lumiStockInfo() {
  try {
    const sdb = stockStore.getDb();                                                 // exchange DB handle
    if (!sdb) return null;                                                          // exchange off
    const row = sdb.prepare('SELECT id FROM bb_stocks WHERE guild_id = ?').get(stockStore.LUMI_STOCK_GUILD_ID); // the LUMI row
    if (!row) return null;                                                          // not listed yet
    const s = stockStore.getStockSummary(row.id);                                   // price, holders, treasury
    return { ticker: s.ticker, price: s.share_price, shareholders: s.shareholderCount, shares: s.totalSharesOutstanding, treasury: s.treasuryBalance, listed: Boolean(s.is_listed) }; // what we show
  } catch (error) {
    logger.warn(`Lumi admin: LUMI stock info failed (${error.message}).`);          // never break the page
    return null;                                                                    // show "not listed"
  }
}

// Which scale bucket ('play' | 'item') a preview row uses (the same key rule as tuning.js).
function rowBucket(kind, key) {
  return kind === 'price' ? tuning.priceBucket(key) : tuning.payoutBucket(key);    // price keys and payout keys have their own sets
}

// What a native amount becomes at the given scales { play, item } (same formula as tuning.js; overrides win).
function previewAmount(game, key, native, kind, scales) {
  const g = tuning.gameSettings(game);                                              // this game's knobs
  const overrides = kind === 'price' ? g.priceOverrides : g.payoutOverrides;        // exact SGC overrides
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return { value: overrides[key], override: true }; // override wins
  const scaleValue = scales[rowBucket(kind, key)];                                  // play or item scale, by key
  if (kind === 'price') return { value: native === 0 ? 0 : Math.max(1, Math.round(native * scaleValue * g.priceMult)), override: false }; // price formula
  return { value: Math.max(0, Math.floor(native * scaleValue * g.payoutMult)), override: false }; // payout formula
}

// The preview rows: the representative natives, then every numeric native in the define() registry.
function previewRows() {
  const rows = PREVIEW_NATIVES.map((r) => ({ ...r }));                              // fixed examples first
  const seen = new Set(rows.map((r) => `${r.game}|${r.kind}|${r.key}`));            // no duplicates
  for (const def of tuning.definedGames()) {
    for (const [kind, keys] of [['price', def.priceKeys], ['payout', def.payoutKeys]]) {
      for (const [key, native] of Object.entries(keys || {})) {
        if (typeof native !== 'number' || seen.has(`${def.game}|${kind}|${key}`)) continue; // only real numbers, once
        seen.add(`${def.game}|${kind}|${key}`);                                     // remember
        const perPoint = kind === 'payout' && native <= 1;                          // "1 per point" payouts
        rows.push({ label: `${def.label}: ${key}${perPoint ? ' (per 100 points)' : ''}`, game: def.game, key, native: perPoint ? native * 100 : native, kind }); // a row
      }
    }
  }
  return rows;                                                                      // [{ label, game, key, native, kind }]
}

// ---------------------------------------------------------------------------------------------- page sections

// Page CSS on top of the panel's own styles.
const PAGE_CSS = [
  '<style>',                                                                        // page-only tweaks
  '.lumi-toc{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}',              // section links
  '.lumi-toc a{color:#9b59b6;border:1px solid #2a2a3e;padding:2px 8px;text-decoration:none;font-size:12px}', // link chips
  '.lumi-sec{margin-bottom:30px}',                                                  // space between sections
  '.lumi-wrap{overflow-x:auto}',                                                    // wide tables scroll sideways
  '.lumi-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}', // number columns
  '.lumi-small{color:#888;font-size:11px}',                                         // hints
  '.lumi-table input[type=text],.lumi-table input[type=number]{margin-bottom:0;min-width:80px;max-width:120px}', // compact inputs
  '.lumi-table td{vertical-align:top}',                                             // align rows
  '.lumi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}', // card grid
  'textarea.lumi-json{min-height:60px;font-size:12px}',                             // short JSON boxes
  '.lumi-inline{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}',    // a row of controls
  '.lumi-inline input,.lumi-inline select{width:auto;margin-bottom:0}',             // inline inputs
  'details.lumi-det{border:1px solid #2a2a3e;padding:8px 12px;margin-bottom:8px}',  // collapsible boxes
  'details.lumi-det summary{cursor:pointer;color:#ff69b4}',                         // their headers
  '</style>',                                                                       // end
].join('\n');                                                                       // one block

// A small "label: value" stat in a card.
function stat(label, value, color) {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div></div>`; // value is pre-escaped by callers
}

// Section 1: the treasury dashboard.
function renderTreasury(status, lumi) {
  const bank = status.bank;                                                         // bank card data
  const healthColor = bank.health < 0.5 ? '#ff4444' : bank.health < 1 ? '#ffaa44' : '#44ff88'; // red / amber / green
  const accountRows = status.accounts.map((a) => [
    '<tr>',                                                                         // one account
    `<td>${esc(a.name)}<div class="lumi-small">${esc(a.id)}</div></td>`,            // name + id
    `<td>${esc(a.category || '')}</td>`,                                            // role
    `<td class="lumi-small">${esc((a.games || []).join(', '))}</td>`,              // what feeds it
    `<td class="lumi-num">${fmt(a.balance)}</td>`,                                  // balance
    `<td class="lumi-num">${fmt(a.in24h)}</td><td class="lumi-num">${fmt(a.out24h)}</td>`, // 24 h flows
    `<td class="lumi-num">${fmt(a.in7d)}</td><td class="lumi-num">${fmt(a.out7d)}</td>`, // 7 d flows
    '</tr>',                                                                        // end row
  ].join('')).join('\n');                                                           // all accounts
  const nameOf = (id) => status.accounts.find((a) => a.id === id)?.name || id;     // account id -> display name
  const drawRows = status.emergencyDraws.recent.slice(0, 15).map((d) => `<tr><td>${esc(d.created_at)}</td><td>${esc(nameOf(d.from_user_id))}</td><td class="lumi-num">${fmt(d.amount)}</td><td class="lumi-small">${esc(d.note)}</td></tr>`).join('\n'); // recent draws
  const owedRows = status.owed.rows.slice(0, 25).map((o) => `<tr><td>${esc(o.username || '')}<div class="lumi-small">${esc(o.user_id)}</div></td><td class="lumi-num">${fmt(o.amount)}</td><td>${esc(`${o.game}:${o.kind}`)}</td><td class="lumi-small">${esc(o.ref || '')}</td><td class="lumi-small">${esc(when(o.at))}</td></tr>`).join('\n'); // oldest owed first
  return [
    '<section class="lumi-sec" id="treasury">',                                     // anchor
    '<h2>&gt; Lumi-Town Treasury</h2>',                                             // heading
    status.payoutsPaused ? '<div class="flash flash-error">Payouts are PAUSED: games keep running, every prize is being owed.</div>' : '', // pause warning
    status.owed.count > 0 ? `<div class="flash flash-error">${fmt(status.owed.count)} prize(s) owed to players (${fmt(status.owed.total)} SGC). They are paid by the next sweep that has the money, or with "Pay owed prizes now".</div>` : '', // owed warning
    '<div class="lumi-grid">',                                                      // cards
    `<div class="card"><h3>Lumi-Town Bank</h3>${stat('Balance', `${fmt(bank.balance)} SGC`)}${stat('Health', esc(pct(bank.health)), healthColor)}${stat('Sweep rate now', esc(pct(bank.rate)))}<div class="lumi-small">Target ${fmt(bank.target)} · ceiling ${fmt(bank.ceiling)}</div></div>`, // bank card
    `<div class="card"><h3>Lumi Holdings Inc.</h3>${stat('Balance', `${fmt(status.holdings.balance)} SGC`)}${stat('Above floor', `${fmt(status.holdings.excess)} SGC`)}<div class="lumi-small">Reserve floor ${fmt(status.holdings.reserveFloor)} · dividend ${esc(pct(status.holdings.dividendRate))}/week</div></div>`, // reserve card
    `<div class="card"><h3>LUMI on Doll Street</h3>${lumi ? `${stat('Price', `${esc(Number(lumi.price).toFixed(2))} SGC`)}${stat('Shareholders', fmt(lumi.shareholders))}<div class="lumi-small">${esc(lumi.ticker)} · ${esc(Number(lumi.shares || 0).toFixed(2))} shares out · ${lumi.listed ? 'listed' : 'NOT listed'}</div>` : '<div class="lumi-small">LUMI is not listed (exchange off?).</div>'}</div>`, // stock card
    `<div class="card"><h3>Pool</h3>${stat('All Lumi SGC', `${fmt(status.poolTotal)} SGC`)}${stat('Emergency draws', `${fmt(status.emergencyDraws.count24h)} / ${fmt(status.emergencyDraws.count7d)}`)}<div class="lumi-small">draws 24 h / 7 d · seeded ${esc(status.seededAt ? when(status.seededAt) : 'never')} · sweep timer ${status.scheduler.running ? 'on' : 'off'} every ${fmt(Math.round(status.scheduler.intervalMs / 60000))} min</div></div>`, // pool card
    '</div>',                                                                       // end cards
    '<h3>Accounts</h3>',                                                            // balances table
    '<div class="lumi-wrap"><table class="lumi-table">',                            // scrolls on phones
    '<tr><th>Account</th><th>Role</th><th>Fed by</th><th>Balance</th><th>In 24h</th><th>Out 24h</th><th>In 7d</th><th>Out 7d</th></tr>', // header
    accountRows,                                                                    // rows
    '</table></div>',                                                               // end table
    '<details class="lumi-det"><summary>Emergency draw log</summary>',              // collapsed by default
    drawRows ? `<table class="lumi-table"><tr><th>When (UTC)</th><th>From</th><th>SGC</th><th>Note</th></tr>${drawRows}</table>` : '<p class="lumi-small">No emergency draws yet.</p>', // the log
    '</details>',                                                                   // end
    `<details class="lumi-det"${status.owed.count ? ' open' : ''}><summary>Owed prizes (${fmt(status.owed.count)})</summary>`, // open when any
    owedRows ? `<table class="lumi-table"><tr><th>Player</th><th>SGC</th><th>Game</th><th>Ref</th><th>Since</th></tr>${owedRows}</table>` : '<p class="lumi-small">Nothing owed.</p>', // owed list
    '</details>',                                                                   // end
    '</section>',                                                                   // end section
  ].join('\n');                                                                     // section HTML
}

// One stats row's cells for a window (spends, in, out, return %, house net, badge).
function statCells(w) {
  const netIn = w.in - w.refunds;                                                   // what players really paid in
  const ret = netIn > 0 ? w.out / netIn : null;                                     // player return
  let badge = '<span class="lumi-small">no spends</span>';                         // prize-only game or idle
  if (ret !== null && ret < 1) badge = '<span class="badge badge-disabled">not profitable to play</span>'; // under 100%
  else if (ret !== null && ret > 2) badge = '<span class="badge badge-override">printing</span>'; // over 200%
  else if (ret !== null) badge = '<span class="badge badge-enabled">ok</span>';    // 100% - 200%
  const net = netIn - w.out;                                                        // house net (+ = Lumi-Town earns)
  return [
    `<td class="lumi-num">${fmt(w.spends)}</td>`,                                   // spends count
    `<td class="lumi-num">${fmt(netIn)}</td>`,                                      // SGC in
    `<td class="lumi-num">${fmt(w.out)}<div class="lumi-small">${fmt(w.prizes)} prizes</div></td>`, // SGC out
    `<td class="lumi-num">${ret === null ? '—' : esc(pct(ret))}</td>`,              // return %
    `<td class="lumi-num" style="color:${net < 0 ? '#ff4444' : '#44ff88'}">${fmt(net)}</td>`, // house net
    `<td>${badge}</td>`,                                                            // warning badge
  ].join('');                                                                       // cells
}

// Section 2: the game knobs table with live stats.
function renderGames(p, stats) {
  const rows = gameIds().map((game) => {
    const g = tuning.gameSettings(game);                                            // current knobs
    const def = tuning.definedGames().find((d) => d.game === game);                 // registry entry
    const fid = `knob-${game}`;                                                     // the row's form id
    const keyHints = [];                                                            // "entry 25 -> 5" hints
    for (const [key, native] of Object.entries(def?.priceKeys || {})) keyHints.push(`${key}${typeof native === 'number' ? ` ${native}→${tuning.scalePrice(game, key, native)}` : ''} (${tuning.priceBucket(key)})`); // prices, scaled by their own bucket (play / item)
    for (const [key, native] of Object.entries(def?.payoutKeys || {})) keyHints.push(`${key}${typeof native === 'number' ? ` ${native}→${tuning.scalePayout(game, key, native)}` : ''} (${tuning.payoutBucket(key) === 'item' ? 'item value' : 'prize'})`); // payouts: prize (play scale) or item value (item scale)
    const s = stats[game] || { d1: emptyWindow(), d7: emptyWindow() };              // stats or zeroes
    return [
      '<tr>',                                                                       // 24 h row
      `<td rowspan="2"><strong>${esc(gameLabel(game))}</strong><div class="lumi-small">${esc(game)}</div><div class="lumi-small">${esc(keyHints.join(' · '))}</div></td>`, // name + keys
      `<td rowspan="2"><input type="checkbox" name="enabled" form="${esc(fid)}"${g.enabled ? ' checked' : ''} aria-label="enabled"></td>`, // on/off
      `<td rowspan="2"><input type="number" step="0.01" min="0" max="100" name="priceMult" form="${esc(fid)}" value="${esc(g.priceMult)}"></td>`, // price ×
      `<td rowspan="2"><input type="number" step="0.01" min="0" max="100" name="payoutMult" form="${esc(fid)}" value="${esc(g.payoutMult)}"></td>`, // payout ×
      `<td rowspan="2"><input type="number" step="1" min="0" name="dailyCap" form="${esc(fid)}" value="${esc(g.dailyCap)}"></td>`, // cap
      `<td rowspan="2"><form id="${esc(fid)}" method="POST" action="${esc(p(`${ROUTE}/game`))}" style="margin:0"><input type="hidden" name="game" value="${esc(game)}"><button type="submit" class="btn btn-sm btn-success">Save</button></form></td>`, // the row's form
      '<td>24 h</td>',                                                              // window label
      statCells(s.d1),                                                              // 24 h stats
      '</tr>',                                                                      // end
      `<tr><td>7 d</td>${statCells(s.d7)}</tr>`,                                    // 7 d row
    ].join('');                                                                     // two rows
  }).join('\n');                                                                    // every game
  return [
    '<section class="lumi-sec" id="knobs">',                                        // anchor
    '<h2>&gt; Game Knobs &amp; Live Stats</h2>',                                    // heading
    `<p class="lumi-small">Prices = erinne's number × bucket scale × price×, min 1: entry / continue / bet use the play scale (${esc(tuning.scale())}), every shop item the item scale (${esc(tuning.itemScale())}). Prizes = native × play scale × payout× (rounded down); buyback / move-in give back an item's value at the item scale. Daily cap = SGC of prizes per player per LA day (0 = none). Return = SGC out ÷ SGC in: under 100% is not worth playing, over 200% is printing money.</p>`, // help
    '<div class="lumi-wrap"><table class="lumi-table">',                            // scrolls on phones
    '<tr><th>Game</th><th>On</th><th>Price×</th><th>Payout×</th><th>Daily cap</th><th></th><th>Window</th><th>Spends</th><th>SGC in</th><th>SGC out</th><th>Return</th><th>House net</th><th></th></tr>', // header
    rows,                                                                           // the games
    '</table></div>',                                                               // end table
    '</section>',                                                                   // end section
  ].join('\n');                                                                     // section HTML
}

// Section 3: per-item override editors (one collapsible form per game).
function renderOverrides(p) {
  const blocks = gameIds().map((game) => {
    const g = tuning.gameSettings(game);                                            // current overrides
    const def = tuning.definedGames().find((d) => d.game === game);                 // known keys
    const count = Object.keys(g.priceOverrides).length + Object.keys(g.payoutOverrides).length; // how many set
    const known = [...Object.keys(def?.priceKeys || {}).map((k) => `${k} (price)`), ...Object.keys(def?.payoutKeys || {}).map((k) => `${k} (prize)`)]; // hints
    return [
      `<details class="lumi-det"${count ? ' open' : ''}><summary>${esc(gameLabel(game))} <span class="lumi-small">${count ? `${count} override(s)` : 'no overrides'}</span></summary>`, // header
      `<form method="POST" action="${esc(p(`${ROUTE}/overrides`))}">`,              // the form
      `<input type="hidden" name="game" value="${esc(game)}">`,                     // which game
      `<p class="lumi-small">Known keys: ${esc(known.join(', ') || 'none defined')}. Shop items use their item id as the key. Values are exact SGC (whole, 0 or more); they replace the formula. Empty = none.</p>`, // help
      '<div class="form-row">',                                                     // two boxes side by side
      `<div><label>Price overrides (JSON)</label><textarea class="lumi-json" name="priceOverrides">${esc(Object.keys(g.priceOverrides).length ? JSON.stringify(g.priceOverrides) : '')}</textarea></div>`, // prices
      `<div><label>Payout overrides (JSON)</label><textarea class="lumi-json" name="payoutOverrides">${esc(Object.keys(g.payoutOverrides).length ? JSON.stringify(g.payoutOverrides) : '')}</textarea></div>`, // prizes
      '</div>',                                                                     // end boxes
      '<button type="submit" class="btn btn-sm btn-success">Save overrides</button>', // submit
      '</form></details>',                                                          // end
    ].join('\n');                                                                   // one game's block
  }).join('\n');                                                                    // every game
  return `<section class="lumi-sec" id="overrides"><h2>&gt; Per-item Overrides</h2>${blocks}</section>`; // section HTML
}

// Section 4: the two economy scales (play + item) with their preview table.
function renderScale(p, preview, previewError) {
  const current = { play: tuning.scale(), item: tuning.itemScale() };               // saved scales
  const target = { play: preview.play ?? current.play, item: preview.item ?? current.item }; // what the preview shows
  const row = (r) => {
    const now = r.kind === 'price' ? tuning.scalePrice(r.game, r.key, r.native) : tuning.scalePayout(r.game, r.key, r.native); // what it is today
    const next = previewAmount(r.game, r.key, r.native, r.kind, target);            // what it would become
    const kindText = r.kind === 'price' ? 'price' : rowBucket(r.kind, r.key) === 'item' ? 'item value' : 'prize'; // what sort of number it is
    return `<tr><td>${esc(r.label)}<div class="lumi-small">${esc(`${r.game} · ${r.key}`)}</div></td><td>${kindText}</td><td class="lumi-num">${fmt(r.native)}</td><td class="lumi-num">${fmt(now)}</td><td class="lumi-num"${next.value !== now ? ' style="color:#ffaa44"' : ''}>${fmt(next.value)}${next.override ? ' <span class="lumi-small">(override)</span>' : ''}</td></tr>`; // one row
  };
  const all = previewRows();                                                        // every preview row
  const group = (bucket, title) => [
    `<tr><th colspan="5">${esc(title)}: now ${esc(current[bucket])}, preview ${esc(target[bucket])}</th></tr>`, // the bucket's sub-heading
    ...all.filter((r) => rowBucket(r.kind, r.key) === bucket).map(row),            // its rows
  ].join('\n');                                                                     // one group
  const changed = target.play !== current.play || target.item !== current.item;     // anything to save?
  return [
    '<section class="lumi-sec" id="scale">',                                        // anchor
    '<h2>&gt; Economy Scales</h2>',                                                 // heading
    `<p>Saved play scale: <strong>${esc(current.play)}</strong> · saved item scale: <strong>${esc(current.item)}</strong>. The play scale prices a go at a game (entry, continue, bet) and every prize; the item scale prices every shop item, capsule, plot, potion and seed, and the buybacks / move-in refunds that give an item's value back. Preview new values first, then save them.</p>`, // help
    '<p class="lumi-small">Why two (Doll, 2026-11-19): players already earn 15 SGC an hour in voice chat, so items keep erinne\'s prices; play costs and prizes stay scaled together so minigames stay worth playing.</p>', // the reason
    previewError ? `<div class="flash flash-error">${esc(previewError)}</div>` : '', // bad preview value
    `<form method="GET" action="${esc(p(ROUTE))}" class="lumi-inline">`,           // preview = GET, changes nothing
    `<label for="previewScale" style="margin:0">Play scale</label><input id="previewScale" type="number" step="0.01" min="0.01" max="10" name="previewScale" value="${esc(target.play)}">`, // play value
    `<label for="previewItemScale" style="margin:0">Item scale</label><input id="previewItemScale" type="number" step="0.01" min="0.01" max="10" name="previewItemScale" value="${esc(target.item)}">`, // item value
    '<button type="submit" class="btn btn-sm">Preview</button>',                    // show the table
    '</form>',                                                                      // end preview form
    '<div class="lumi-wrap"><table class="lumi-table">',                            // preview table
    `<tr><th>Item</th><th>Kind</th><th>erinne native</th><th>Now</th><th>At play ${esc(target.play)} · item ${esc(target.item)}</th></tr>`, // header
    group('item', 'Item scale'),                                                    // items first: capsule, moon capsule ...
    group('play', 'Play scale'),                                                    // then entries, continues and prizes
    '</table></div>',                                                               // end table
    `<form method="POST" action="${esc(p(`${ROUTE}/scale`))}" class="lumi-inline">`, // the save form
    `<input type="hidden" name="scale" value="${esc(target.play)}">`,               // the previewed play scale
    `<input type="hidden" name="itemScale" value="${esc(target.item)}">`,           // the previewed item scale
    `<button type="submit" class="btn btn-warn"${changed ? '' : ' disabled'}>Save play ${esc(target.play)} · item ${esc(target.item)}</button>`, // only when one changes
    '</form>',                                                                      // end save form
    '</section>',                                                                   // end section
  ].join('\n');                                                                     // section HTML
}

// Section 5: the treasury policy form.
function renderPolicy(p, policy) {
  const inputs = POLICY_FIELDS.map((f) => `<div><label for="pol-${esc(f.field)}">${esc(f.label)}</label><input id="pol-${esc(f.field)}" type="text" inputmode="decimal" name="${esc(f.field)}" value="${esc(policy[f.field])}"></div>`).join('\n'); // one input per knob
  const bandRows = policy.bands.map(([below, rate], i) => `<tr><td>${i === 0 ? 'below' : 'from'} ${i === 0 ? esc(pct(below)) : `${esc(pct(policy.bands[i - 1][0]))} to ${below === Infinity ? 'and above' : esc(pct(below))}`}</td><td class="lumi-num">${esc(pct(rate))}</td></tr>`).join(''); // readable bands
  return [
    '<section class="lumi-sec" id="policy">',                                       // anchor
    '<h2>&gt; Treasury Policy</h2>',                                                // heading
    `<form method="POST" action="${esc(p(`${ROUTE}/policy`))}">`,                   // the form
    `<div class="form-row">${inputs}</div>`,                                        // the number knobs
    `<label for="pol-bands">Sweep bands (JSON: [[health below, tax rate], ...], last limit null = "and above")</label>`, // bands label
    `<textarea id="pol-bands" class="lumi-json" name="bands">${esc(bandsToJson(policy.bands))}</textarea>`, // bands JSON
    `<table class="lumi-table" style="max-width:420px"><tr><th>Bank health</th><th>Tax per sweep</th></tr>${bandRows}</table>`, // what they mean
    '<p class="lumi-small">Emergency draw order is fixed: shop accounts richest first, then Lumi Holdings down to its reserve floor.</p>', // draw order note
    '<button type="submit" class="btn btn-success">Save treasury policy</button>',  // submit
    '</form>',                                                                      // end form
    '</section>',                                                                   // end section
  ].join('\n');                                                                     // section HTML
}

// Section 6: the action forms.
function renderActions(p, status) {
  const seed = tuning.seedSplit();                                                  // default split from settings
  const cb = eco.getCentralBankBalance();                                           // Central Bank balance now
  const accountOptions = (selected) => status.accounts.map((a) => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.name)} (${fmt(a.balance)})</option>`).join(''); // Lumi account picker
  const categoryForms = treasury.categories().map((c) => [
    `<form method="POST" action="${esc(p(`${ROUTE}/category`))}" class="lumi-inline" style="margin-bottom:8px">`, // one category
    `<input type="hidden" name="category" value="${esc(c.category)}">`,             // which one
    `<span class="lumi-small" style="min-width:90px">${esc(c.category)}</span>`,    // its id
    `<input type="text" name="displayName" maxlength="60" value="${esc(c.displayName)}" aria-label="display name">`, // name
    `<input type="text" name="games" maxlength="500" value="${esc((c.games || []).join(', '))}" aria-label="games" style="min-width:260px">`, // feeders
    '<button type="submit" class="btn btn-sm">Save</button>',                       // submit
    '</form>',                                                                      // end
  ].join('')).join('\n');                                                           // every category
  return [
    '<section class="lumi-sec" id="actions">',                                      // anchor
    '<h2>&gt; Actions</h2>',                                                        // heading
    '<div class="lumi-grid">',                                                      // action cards
    `<div class="card"><h3>Sweep now</h3><p class="lumi-small">Tax every shop into the bank at the current rate (${esc(pct(status.bank.rate))}), move overflow to Holdings, pay owed prizes.</p><form method="POST" action="${esc(p(`${ROUTE}/sweep`))}"><button type="submit" class="btn btn-sm btn-warn">Sweep now</button></form></div>`, // sweep
    `<div class="card"><h3>Pay owed prizes</h3><p class="lumi-small">${fmt(status.owed.count)} owed (${fmt(status.owed.total)} SGC). Pays oldest first while the bank can cover them.</p><form method="POST" action="${esc(p(`${ROUTE}/pay-owed`))}"><button type="submit" class="btn btn-sm btn-success">Pay owed prizes now</button></form></div>`, // pay owed
    `<div class="card"><h3>Payouts: ${status.payoutsPaused ? '<span class="badge badge-disabled">PAUSED</span>' : '<span class="badge badge-enabled">ON</span>'}</h3><p class="lumi-small">Paused = games keep running, every prize is owed until you resume.</p><form method="POST" action="${esc(p(`${ROUTE}/pause`))}"><input type="hidden" name="paused" value="${status.payoutsPaused ? 'false' : 'true'}"><button type="submit" class="btn btn-sm ${status.payoutsPaused ? 'btn-success' : 'btn-danger'}">${status.payoutsPaused ? 'Resume payouts' : 'Pause all payouts'}</button></form></div>`, // pause switch
    '</div>',                                                                       // end cards
    '<div class="card" id="seed">',                                                 // seed card
    '<h3>Seed from Central Bank</h3>',                                              // heading
    `<p class="lumi-small">Central Bank has <strong>${fmt(cb)} SGC</strong>. ${status.seededAt ? `Already seeded ${esc(when(status.seededAt))}: tick "seed again" to force a second seed.` : 'Not seeded yet.'}</p>`, // balance + state
    `<form method="POST" action="${esc(p(`${ROUTE}/seed`))}">`,                     // the form
    `<div class="form-row-3"><div><label>Total</label><input type="text" inputmode="numeric" name="total" value="${esc(seed.toBank + seed.toHoldings)}"></div><div><label>To Lumi-Town Bank</label><input type="text" inputmode="numeric" name="toBank" value="${esc(seed.toBank)}"></div><div><label>To Lumi Holdings</label><input type="text" inputmode="numeric" name="toHoldings" value="${esc(seed.toHoldings)}"></div></div>`, // amounts
    '<div class="lumi-inline"><label style="margin:0"><input type="checkbox" name="confirm"> I confirm this moves real SGC out of Central Bank</label>', // confirm box
    `<label style="margin:0"><input type="checkbox" name="force"> Seed again (already seeded)</label>`, // force box
    '<button type="submit" class="btn btn-sm btn-danger">Seed</button></div>',      // submit
    '</form></div>',                                                                // end seed card
    '<div class="card" id="move">',                                                 // move card
    '<h3>Move SGC between Lumi accounts</h3>',                                      // heading
    `<form method="POST" action="${esc(p(`${ROUTE}/move`))}" class="lumi-inline">`, // the form
    `<label style="margin:0">From</label><select name="from">${accountOptions(treasury.HOLDINGS)}</select>`, // source
    `<label style="margin:0">To</label><select name="to">${accountOptions(treasury.BANK)}</select>`, // destination
    '<label style="margin:0">SGC</label><input type="text" inputmode="numeric" name="amount" placeholder="1000">', // amount
    '<button type="submit" class="btn btn-sm btn-warn">Move</button>',              // submit
    '</form></div>',                                                                // end move card
    '<div class="card" id="categories">',                                           // categories card
    '<h3>Themed accounts</h3>',                                                     // heading
    '<p class="lumi-small">Rename a shop, or set which games feed it: comma-separated "game" or "game:kind" entries (e.g. pet:snacks, garden). "game:kind" wins over "game"; unmapped spends go straight to the bank.</p>', // help
    categoryForms,                                                                  // one row per category
    '</div>',                                                                       // end categories card
    '</section>',                                                                   // end section
  ].join('\n');                                                                     // section HTML
}

// Section 7: the recent admin log.
function renderLog() {
  const rows = getDb().prepare('SELECT id, who, key, old, new, at FROM lumi_admin_log ORDER BY id DESC LIMIT 60').all(); // newest first
  const cut = (v) => (v === null || v === undefined ? '' : String(v).length > 160 ? `${String(v).slice(0, 160)}…` : String(v)); // keep cells short
  const body = rows.map((r) => `<tr><td class="lumi-small">${esc(when(r.at))}</td><td>${esc(r.who)}</td><td>${esc(r.key)}</td><td class="lumi-small">${esc(cut(r.old))}</td><td class="lumi-small">${esc(cut(r.new))}</td></tr>`).join('\n'); // rows
  return [
    '<section class="lumi-sec" id="log">',                                          // anchor
    '<h2>&gt; Admin Log</h2>',                                                      // heading
    body ? `<div class="lumi-wrap"><table class="lumi-table"><tr><th>When</th><th>Who</th><th>What</th><th>Old</th><th>New</th></tr>${body}</table></div>` : '<p class="lumi-small">No changes logged yet.</p>', // table or note
    '</section>',                                                                   // end section
  ].join('\n');                                                                     // section HTML
}

// The whole page body.
function renderPage(p, url, flash) {
  if (!lumiReady()) {                                                               // Lumi-Town isn't running here
    return `${renderFlash(flash)}<h2>&gt; Lumi-Town</h2><div class="flash flash-info">Lumi-Town is not running in this process (it starts with the Lumi Games server; LUMI_WEB_ENABLED=false turns it off), so there is nothing to manage yet.</div>`; // friendly note
  }
  tuning.reload();                                                                  // show the freshest knobs
  const preview = { play: null, item: null };                                       // ?previewScale=...&previewItemScale=...
  let previewError = '';                                                            // a bad value message
  for (const [bucket, param, label] of [['play', 'previewScale', 'Preview scale'], ['item', 'previewItemScale', 'Preview item scale']]) {
    const rawPreview = url?.searchParams?.get(param);                               // from the preview form
    if (rawPreview === null || rawPreview === undefined || rawPreview === '') continue; // not previewed: keep the saved one
    try { preview[bucket] = parseDecimal(rawPreview, label, { min: 0, max: 10, minExclusive: true }); } // validate
    catch (error) { previewError = error.message; }                                 // show why, keep the saved scale
  }
  const status = treasury.status();                                                 // balances, health, flows, owed
  const stats = ledgerStats();                                                      // per-game 24 h / 7 d
  return [
    PAGE_CSS,                                                                       // page styles
    renderFlash(flash),                                                             // last action's result
    '<nav class="lumi-toc"><a href="#treasury">Treasury</a><a href="#knobs">Game knobs</a><a href="#overrides">Overrides</a><a href="#scale">Scales</a><a href="#policy">Policy</a><a href="#actions">Actions</a><a href="#log">Admin log</a></nav>', // in-page links
    renderTreasury(status, lumiStockInfo()),                                        // 1
    renderGames(p, stats),                                                          // 2
    renderOverrides(p),                                                             // 3
    renderScale(p, preview, previewError),                                          // 4
    renderPolicy(p, status.policy),                                                 // 5
    renderActions(p, status),                                                       // 6
    renderLog(),                                                                    // 7
  ].join('\n');                                                                     // page body
}

// ---------------------------------------------------------------------------------------------- POST actions

// The game ids an admin may change (listed on the page).
function requireGame(raw) {
  const game = String(raw || '');                                                   // from the hidden field
  if (!GAME_ID.test(game) || !gameIds().includes(game)) throw new InputError(`Unknown game "${game}".`); // only listed games
  return game;                                                                      // clean id
}

const ACTIONS = {
  // Save one game's knobs (only the ones that changed are written + logged).
  game(body, who) {
    const game = requireGame(body.game);                                            // which game
    const cur = tuning.gameSettings(game);                                          // current values
    const next = {
      enabled: body.enabled === 'on' || body.enabled === 'true',                    // unchecked box sends nothing
      priceMult: parseDecimal(body.priceMult, 'Price multiplier', { max: 100 }),    // 0..100
      payoutMult: parseDecimal(body.payoutMult, 'Payout multiplier', { max: 100 }), // 0..100
      dailyCap: parseWhole(body.dailyCap, 'Daily cap', { max: 1_000_000_000 }),     // whole SGC
    };
    const changed = Object.keys(next).filter((k) => next[k] !== cur[k]);           // what differs
    for (const k of changed) tuning.setGame(game, k, k === 'enabled' ? (next[k] ? 'true' : 'false') : next[k], who); // write + log each
    if (!changed.length) return { type: 'info', message: `${gameLabel(game)}: nothing changed.`, anchor: 'knobs' }; // no-op
    return { type: 'success', message: `${gameLabel(game)}: saved ${changed.join(', ')}.`, anchor: 'knobs' }; // done
  },

  // Save one game's per-item overrides (validated: whole SGC >= 0, sane keys).
  overrides(body, who) {
    const game = requireGame(body.game);                                            // which game
    const cur = tuning.gameSettings(game);                                          // current values
    const price = parseOverridesInput(body.priceOverrides, 'Price overrides');      // validated map
    const payout = parseOverridesInput(body.payoutOverrides, 'Payout overrides');   // validated map
    const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort()); // order-free compare
    const changed = [];                                                             // what we wrote
    if (!same(price, cur.priceOverrides)) { tuning.setGame(game, 'priceOverrides', Object.keys(price).length ? price : null, who); changed.push('price overrides'); } // write + log
    if (!same(payout, cur.payoutOverrides)) { tuning.setGame(game, 'payoutOverrides', Object.keys(payout).length ? payout : null, who); changed.push('payout overrides'); } // write + log
    if (!changed.length) return { type: 'info', message: `${gameLabel(game)}: overrides unchanged.`, anchor: 'overrides' }; // no-op
    return { type: 'success', message: `${gameLabel(game)}: saved ${changed.join(' and ')}.`, anchor: 'overrides' }; // done
  },

  // Save the play scale (field `scale`) and/or the item scale (field `itemScale`); a missing field is left alone.
  scale(body, who) {
    const fields = [['scale', 'lumi.scale', 'Play scale', tuning.scale()], ['itemScale', 'lumi.itemScale', 'Item scale', tuning.itemScale()]]; // [form field, setting, label, saved value]
    const next = [];                                                                // validated changes, written only when all are good
    for (const [field, key, label, old] of fields) {
      if (body[field] === undefined) continue;                                      // not sent: unchanged
      const value = parseDecimal(body[field], label, { min: 0, max: 10, minExclusive: true }); // above 0, at most 10
      if (value !== old) next.push({ key, label, old, value });                     // a real change
    }
    if (!next.length) return { type: 'info', message: `Scales unchanged (play ${tuning.scale()}, item ${tuning.itemScale()}).`, anchor: 'scale' }; // no-op
    for (const c of next) tuning.set(c.key, String(c.value), who);                  // write + log each (lumi_admin_log)
    return { type: 'success', message: next.map((c) => `${c.label} changed from ${c.old} to ${c.value}.`).join(' '), anchor: 'scale' }; // done
  },

  // Save the treasury policy (every field validated before anything is written).
  policy(body, who) {
    const cur = tuning.treasuryPolicy();                                            // current values
    const next = {
      bankTarget: parseWhole(body.bankTarget, 'Bank target', { min: 1 }),           // at least 1 SGC
      bankCeiling: parseWhole(body.bankCeiling, 'Bank ceiling'),                    // 0 = no overflow
      sweepIntervalMs: parseWhole(body.sweepIntervalMs, 'Sweep interval', { min: 60_000, max: 7 * 24 * 3600 * 1000 }), // 1 min .. 1 week
      refillBufferPct: parseDecimal(body.refillBufferPct, 'Refill buffer', { max: 1 }), // 0..1
      reserveFloor: parseWhole(body.reserveFloor, 'Reserve floor'),                 // whole SGC
      lumiDividendRate: parseDecimal(body.lumiDividendRate, 'LUMI dividend rate', { max: 1 }), // 0..1
    };
    if (next.bankCeiling > 0 && next.bankCeiling < next.bankTarget) throw new InputError('The bank ceiling must be 0 (off) or at least the bank target.'); // sanity
    const bands = parseBandsInput(body.bands);                                      // strict bands JSON
    const changed = [];                                                             // what we wrote
    for (const f of POLICY_FIELDS) {
      if (next[f.field] !== cur[f.field]) { tuning.set(f.key, String(next[f.field]), who); changed.push(f.field); } // write + log
    }
    if (bands !== bandsToJson(cur.bands)) { tuning.set('lumi.treasury.bands', bands, who); changed.push('bands'); } // write + log
    if (!changed.length) return { type: 'info', message: 'Treasury policy unchanged.', anchor: 'policy' }; // no-op
    return { type: 'success', message: `Treasury policy saved: ${changed.join(', ')}.`, anchor: 'policy' }; // done
  },

  // Run a sweep now.
  sweep(body, who) {
    const r = treasury.sweep(who);                                                  // one transaction (logs itself as the admin)
    return { type: 'success', message: `Swept ${fmt(r.swept)} SGC at ${pct(r.rate)} into the bank; overflow ${fmt(r.overflow)} SGC to Holdings; ${fmt(r.owedPaid)} owed prize(s) paid (${fmt(r.owedPaidAmount)} SGC).`, anchor: 'treasury' }; // done
  },

  // Seed Lumi-Town from Central Bank (confirm box required; force for a second seed).
  seed(body, who) {
    if (body.confirm !== 'on') throw new InputError('Tick the confirm box to seed from Central Bank.'); // a deliberate act
    const total = parseWhole(body.total, 'Seed total', { min: 1 });                 // whole SGC
    const toBank = parseWhole(body.toBank, 'Seed to bank');                         // whole SGC
    const toHoldings = parseWhole(body.toHoldings, 'Seed to holdings');             // whole SGC
    if (toBank + toHoldings !== total) throw new InputError(`The bank part (${fmt(toBank)}) plus the holdings part (${fmt(toHoldings)}) must equal the total (${fmt(total)}).`); // the double check
    const r = treasury.seed(total, toBank, toHoldings, { who, force: body.force === 'on' }); // moves + logs (refuses a repeat without force)
    return { type: 'success', message: `Seeded ${fmt(r.toBank)} SGC to Lumi-Town Bank and ${fmt(r.toHoldings)} SGC to Lumi Holdings. Central Bank has ${fmt(r.centralBankLeft)} SGC left.`, anchor: 'seed' }; // done
  },

  // Move SGC between two Lumi accounts.
  move(body, who) {
    const from = String(body.from || '');                                           // source id
    const to = String(body.to || '');                                               // destination id
    if (!eco.LUMI_ACCOUNT_IDS.includes(from) || !eco.LUMI_ACCOUNT_IDS.includes(to)) throw new InputError('Pick two Lumi-Town accounts.'); // only inside the pool
    if (from === to) throw new InputError('Pick two different accounts.');           // no self-moves
    const amount = parseWhole(body.amount, 'Amount', { min: 1 });                   // whole SGC > 0
    treasury.adminMove(from, to, amount, who);                                      // moves + logs (throws when short)
    return { type: 'success', message: `Moved ${fmt(amount)} SGC from ${from} to ${to}.`, anchor: 'move' }; // done
  },

  // Rename a themed account and/or change which games feed it.
  category(body, who) {
    const category = String(body.category || '');                                   // which category
    if (!treasury.categories().some((c) => c.category === category)) throw new InputError(`Unknown category "${category}".`); // must exist
    const displayName = String(body.displayName || '').trim();                      // new name
    if (!displayName || displayName.length > 60) throw new InputError('A display name needs 1 to 60 characters.'); // length
    const games = String(body.games || '').split(/[\s,]+/u).map((s) => s.trim().toLowerCase()).filter(Boolean); // "pet:snacks, garden"
    const bad = games.find((g) => !CATEGORY_ENTRY.test(g));                         // first bad entry
    if (bad) throw new InputError(`"${bad}" is not a "game" or "game:kind" entry.`); // refuse
    treasury.setCategory(category, { displayName, games: [...new Set(games)] }, who); // save + log
    return { type: 'success', message: `Saved ${category}: "${displayName}" fed by ${games.length ? games.join(', ') : 'nothing'}.`, anchor: 'categories' }; // done
  },

  // Pay owed prizes now.
  'pay-owed'(body, who) {
    const r = treasury.payOwedNow(who);                                             // own transaction (logs itself as the admin)
    const left = getDb().prepare('SELECT COUNT(*) AS n FROM lumi_owed').get().n;    // still owed
    return { type: r.count || !left ? 'success' : 'error', message: `Paid ${fmt(r.count)} owed prize(s) (${fmt(r.total)} SGC). ${fmt(left)} still owed${left && tuning.treasuryPolicy().payoutsPaused ? ' (payouts are paused)' : ''}.`, anchor: 'treasury' }; // done
  },

  // Pause or resume every payout.
  pause(body, who) {
    const paused = body.paused === 'true';                                          // the requested state
    tuning.set('lumi.treasury.payoutsPaused', paused ? 'true' : 'false', who);      // write + log
    return { type: paused ? 'info' : 'success', message: paused ? 'All payouts paused: prizes are now owed until you resume.' : 'Payouts resumed. Owed prizes are paid by the next sweep (or "Pay owed prizes now").', anchor: 'actions' }; // done
  },
};

// ---------------------------------------------------------------------------------------------- entry point

/**
 * Handle a /lumi request on the web panel. Returns true when it answered (always, for /lumi paths), false otherwise.
 * opts: { pathname, url (a URL), renderShell(body, title) = webPanel's buildPageHtml, p(path) = base-path prefixer }.
 */
async function handleLumiAdminRequest(req, res, opts = {}) {
  const url = opts.url || new URL(req.url, 'http://panel.local');                   // parsed URL
  const pathname = opts.pathname || url.pathname;                                   // path without the base path
  if (!isLumiAdminPath(pathname)) return false;                                     // not ours
  const renderShell = typeof opts.renderShell === 'function' ? opts.renderShell : defaultShell; // the panel's look
  const p = typeof opts.p === 'function' ? opts.p : defaultP;                       // base-path prefixer
  const method = String(req.method || 'GET').toUpperCase();                         // GET / POST ...
  const session = requireAuth(req);                                                 // panel ADMIN session only
  if (!session) {                                                                   // logged out or not an admin
    sendHtml(res, 403, renderShell('<h2>&gt; 403</h2><p style="color:#ff4444;">The Lumi-Town admin page is for panel admins only.</p>', 'Forbidden')); // refuse
    return true;                                                                    // answered
  }
  try {
    if ((method === 'GET' || method === 'HEAD') && pathname === ROUTE) {           // the page
      const flash = takeFlash(url.searchParams.get('flash'));                       // last action's result
      sendHtml(res, 200, renderShell(renderPage(p, url, flash), 'Lumi-Town — SGC Control Panel')); // render
      return true;                                                                  // answered
    }
    if (method !== 'POST') {                                                        // nothing else is allowed
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: pathname === ROUTE ? 'GET' : 'POST' }); // wrong method
      res.end('Method not allowed.');                                               // body
      return true;                                                                  // answered
    }
    const origin = validateSameOrigin(req, getTrustedHosts('WEB_PANEL_TRUSTED_ORIGINS')); // CSRF: own host + the panel's list only
    if (!origin.ok) {
      logger.warn(`[csrf] Lumi admin rejected POST ${pathname}: ${origin.reason}`); // breadcrumb
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });          // refuse
      res.end('Forbidden: cross-origin request rejected.');                         // body
      return true;                                                                  // answered
    }
    const name = pathname.slice(ROUTE.length + 1);                                  // e.g. 'game'
    const action = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null; // known actions only
    if (!action) {
      sendHtml(res, 404, renderShell('<h2>&gt; 404</h2><p style="color:#ff4444;">No such Lumi-Town action.</p>', 'Not found')); // unknown action
      return true;                                                                  // answered
    }
    let result;                                                                     // { type, message, anchor }
    try {
      const body = await readForm(req);                                             // the form fields
      if (!lumiReady()) throw new InputError('Lumi-Town is not running in this process.'); // tables missing
      const who = whoOf(session);                                                   // admin's Discord name for the log
      result = action(body, who);                                                   // do it (tuning/treasury log it)
      tuning.reload();                                                              // apply everywhere now
      logger.info(`Lumi admin: ${who} ran ${name}: ${result.message}`);             // breadcrumb
    } catch (error) {
      const expected = error instanceof InputError || Number.isInteger(error?.status) || error?.name === 'CoinMoveError' || error instanceof SyntaxError; // admin-facing refusals
      if (!expected) logger.error(`Lumi admin ${name} failed: ${error.stack || error.message}`); // a real bug: log it
      result = { type: 'error', message: error.message || 'Something went wrong.', anchor: ({ seed: 'seed', move: 'move', category: 'categories', game: 'knobs', overrides: 'overrides', scale: 'scale', policy: 'policy' })[name] || 'actions' }; // show why
    }
    redirectBack(res, p, putFlash(result.type, result.message), result.anchor);    // back to the page
    return true;                                                                    // answered
  } catch (error) {
    logger.error(`Lumi admin page error: ${error.stack || error.message}`);         // render crash
    if (!res.headersSent) sendHtml(res, 500, renderShell(`<h2>&gt; 500</h2><p style="color:#ff4444;">Lumi-Town admin error: ${esc(error.message)}</p>`, 'Error')); // escaped
    return true;                                                                    // answered
  }
}

module.exports = {
  isLumiAdminPath,          // does this path belong to /lumi?
  handleLumiAdminRequest,   // GET /lumi + POST /lumi/<action>
  ledgerStats,              // per-game 24 h / 7 d stats (tests)
  parseBandsInput,          // strict bands validation (tests)
  parseOverridesInput,      // strict overrides validation (tests)
};
