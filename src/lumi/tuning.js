'use strict';

/**
 * Lumi games: every price, prize, cap and treasury knob, in one cached place (docs/plans/lumi-games-port.md section 4).
 *
 * THE NATIVE-AMOUNT RULE: game code always passes erinne's own ("native") numbers to sgc.js; this file turns them
 * into SadGirlCoin:
 *   scaledPrice  = max(1, round(native * globalScale * game.priceMult))   (native 0 stays 0: free stays free)
 *   scaledPayout = floor(native * globalScale * game.payoutMult)          (0 is allowed)
 *   a per-item override for that key (an exact SGC amount) wins over the formula.
 * public/lumi/lumi-tuning.js has the SAME formula, fed by clientTuning(), so prices shown == prices charged.
 *
 * Storage: system_state rows 'setting.lumi.*' (the web panel's settings store):
 *   setting.lumi.scale, setting.lumi.treasury.*, setting.lumi.seed.*     -> listed in panelSettings.js SCHEMA ('Lumi Games')
 *   setting.lumi.game.<game>.enabled|priceMult|payoutMult|dailyCap        -> per game, made by setGame()
 *   setting.lumi.game.<game>.priceOverrides|payoutOverrides               -> JSON {key: exact SGC}
 * Values are cached and re-read every CACHE_MS (so web-panel edits apply within seconds) or at once with reload().
 */

const { getSystemState, setSystemState, deleteSystemState } = require('../sadgirlEconomyStore'); // the settings rows
const { SCHEMA } = require('../panelSettings');  // defaults + labels of the global lumi.* keys
const { getDb, nowMs } = require('./db');        // admin log writes + clock

const CACHE_MS = 5000;                           // how stale the cache may get before a re-read
const PREFIX = 'setting.';                       // system_state key prefix shared with panelSettings
const GAME_ID = /^[a-z0-9-]{1,32}$/u;            // game ids: lowercase words with dashes (pet, teacup-tower ...)
const KNOB_KEY = /^[A-Za-z0-9_.:-]{1,64}$/u;     // item keys used in overrides (entry, continue-2, snack:cookie ...)
const GAME_KNOBS = ['enabled', 'priceMult', 'payoutMult', 'dailyCap', 'priceOverrides', 'payoutOverrides']; // what setGame accepts
const GAME_DEFAULTS = Object.freeze({ enabled: true, priceMult: 1, payoutMult: 1, dailyCap: 0 }); // per-game defaults (dailyCap 0 = uncapped; admins can set one per game)
const DEFAULT_BANDS = Object.freeze([[0.25, 1], [0.5, 0.75], [1, 0.5], [1.5, 0.25], [Infinity, 0.1]]); // health below -> tax rate

const registry = new Map();                      // game id -> { label, priceKeys, payoutKeys, defaults } from define()
let cache = null;                                // the last read snapshot
let cacheAt = 0;                                 // when it was read (ms)

// ---------------------------------------------------------------------------------------------- registry

/**
 * Tell the admin page (and clientTuning) that a game exists. Call once at module load, e.g.
 *   tuning.define('prism', { label: 'Prism Drop', payoutKeys: { win: 1 } });
 *   tuning.define('breakout', { label: 'Yarn Pop', priceKeys: { entry: 25 }, payoutKeys: { win: 1 }, defaults: { dailyCap: 0 } });
 * priceKeys / payoutKeys: { key: native amount } (or just an array of keys) - used for the admin preview only.
 * defaults: this game's own defaults for enabled / priceMult / payoutMult / dailyCap.
 */
function define(game, { label, priceKeys = {}, payoutKeys = {}, defaults = {} } = {}) {
  if (!GAME_ID.test(String(game))) throw new Error(`tuning.define: bad game id "${game}"`); // ids go into ledger types
  const asMap = (keys) => (Array.isArray(keys) ? Object.fromEntries(keys.map((k) => [k, null])) : { ...keys }); // array -> {key: null}
  registry.set(game, {
    game,                                            // the id
    label: String(label || game),                    // admin page name
    priceKeys: asMap(priceKeys),                     // { key: native } for previews
    payoutKeys: asMap(payoutKeys),                   // { key: native } for previews
    defaults: { ...GAME_DEFAULTS, ...pickDefaults(defaults) }, // per-game defaults
  });
  cache = null;                                      // re-read so the new game appears
  return registry.get(game);                         // the stored definition
}

// Keep only the known default fields, with sane types.
function pickDefaults(d) {
  const out = {};                                                                   // filled below
  if (typeof d.enabled === 'boolean') out.enabled = d.enabled;                      // on/off
  for (const k of ['priceMult', 'payoutMult', 'dailyCap']) {                        // numbers
    if (Number.isFinite(d[k]) && d[k] >= 0) out[k] = d[k];                          // finite and not negative
  }
  return out;                                                                       // e.g. { dailyCap: 0 }
}

/** Every defined game: [{ game, label, priceKeys, payoutKeys, defaults }]. */
function definedGames() {
  return [...registry.values()];                                                    // insertion order
}

// ---------------------------------------------------------------------------------------------- reading

// Read one global key's value (panelSettings SCHEMA default when unset or broken).
function readGlobal(rows, key) {
  const def = SCHEMA[key];                                                          // its schema entry
  const fallback = def ? def.default : undefined;                                   // its default
  const raw = rows.get(PREFIX + key);                                               // stored text, if any
  if (raw === undefined || raw === null || raw === '') return fallback;             // nothing stored
  if (def && def.type === 'number') {                                               // numeric setting
    const n = Number(raw);                                                          // parse
    return Number.isFinite(n) && n >= 0 ? n : fallback;                             // junk/negative -> default
  }
  return raw;                                                                       // string setting
}

// "true"/"1"/"yes"/"on" -> true; everything else false.
function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());  // forgiving boolean
}

/**
 * Parse the sweep bands JSON: [[healthBelow, rate], ...] ascending; null, "Infinity" or a missing limit on the
 * last band means "and above". Anything malformed falls back to the default bands (and never throws).
 */
function parseBands(text) {
  try {
    const raw = typeof text === 'string' ? JSON.parse(text) : text;                 // stored as JSON text
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_BANDS.map((b) => [...b]); // empty: default
    const bands = raw.map((pair) => {
      const limit = pair[0] === null || pair[0] === 'Infinity' || pair[0] === undefined ? Infinity : Number(pair[0]); // open top
      const rate = Number(pair[1]);                                                 // tax share 0..1
      if (!(limit > 0) || !(rate >= 0 && rate <= 1)) throw new Error('bad band');   // limit must be > 0, rate 0..1
      return [limit, rate];                                                         // cleaned pair
    });
    for (let i = 1; i < bands.length; i++) if (!(bands[i][0] > bands[i - 1][0])) throw new Error('bands not ascending'); // strictly rising
    if (bands[bands.length - 1][0] !== Infinity) bands.push([Infinity, bands[bands.length - 1][1]]); // always cover "and above"
    return bands;                                                                   // ready to use
  } catch {
    return DEFAULT_BANDS.map((b) => [...b]);                                        // any error: the defaults
  }
}

// Parse an overrides JSON map {key: exact SGC}; drops anything that isn't a whole, non-negative number.
function parseOverrides(text) {
  let raw;                                                                          // parsed JSON
  try { raw = JSON.parse(text || '{}'); } catch { return {}; }                      // broken: none
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};             // not a map: none
  const out = {};                                                                   // cleaned map
  for (const [k, v] of Object.entries(raw)) {
    if (KNOB_KEY.test(k) && Number.isSafeInteger(v) && v >= 0) out[k] = v;          // keep whole SGC >= 0
  }
  return out;                                                                       // e.g. { entry: 3 }
}

// One game's knobs from the stored rows (and its defaults).
function readGame(rows, game) {
  const defaults = registry.get(game)?.defaults || GAME_DEFAULTS;                   // define()'d defaults or the global ones
  const key = (knob) => `${PREFIX}lumi.game.${game}.${knob}`;                       // e.g. setting.lumi.game.prism.payoutMult
  const num = (knob) => {
    const raw = rows.get(key(knob));                                                // stored text
    const n = Number(raw);                                                          // parse it
    return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : defaults[knob]; // default when unset/junk
  };
  const enabledRaw = rows.get(key('enabled'));                                      // 'true' / 'false' / unset
  return {
    enabled: enabledRaw === undefined || enabledRaw === '' ? defaults.enabled : truthy(enabledRaw), // on/off
    priceMult: num('priceMult'),                                                    // price multiplier
    payoutMult: num('payoutMult'),                                                  // payout multiplier
    dailyCap: Math.floor(num('dailyCap')),                                          // whole SGC per player per LA day (0 = none)
    priceOverrides: parseOverrides(rows.get(key('priceOverrides'))),                // {key: exact SGC}
    payoutOverrides: parseOverrides(rows.get(key('payoutOverrides'))),              // {key: exact SGC}
  };
}

/** Re-read every lumi setting now (call after changing settings outside this file). Returns the snapshot. */
function reload() {
  const rows = new Map();                                                           // key -> stored text
  try {
    const list = getDb().prepare("SELECT key, value FROM system_state WHERE key LIKE 'setting.lumi.%'").all(); // one query
    for (const r of list) rows.set(r.key, r.value);                                 // index them
  } catch { /* DB not ready yet: every value is its default */ }
  const games = new Set(registry.keys());                                           // defined games...
  for (const k of rows.keys()) {
    const m = /^setting\.lumi\.game\.([a-z0-9-]{1,32})\./u.exec(k);                 // ...plus any game with stored knobs
    if (m) games.add(m[1]);                                                         // remember its id
  }
  const treasury = {
    bankTarget: Math.floor(readGlobal(rows, 'lumi.treasury.bankTarget')),           // 100% health balance
    bankCeiling: Math.floor(readGlobal(rows, 'lumi.treasury.bankCeiling')),         // overflow above this
    bands: parseBands(readGlobal(rows, 'lumi.treasury.bands')),                     // [[healthBelow, rate], ...]
    sweepIntervalMs: Math.max(60_000, Math.floor(readGlobal(rows, 'lumi.treasury.sweepIntervalMs'))), // never faster than 1/min
    refillBufferPct: Math.min(1, readGlobal(rows, 'lumi.treasury.refillBufferPct')), // emergency top-up buffer (share of target)
    reserveFloor: Math.floor(readGlobal(rows, 'lumi.treasury.reserveFloor')),       // Holdings never below this
    lumiDividendRate: Math.min(1, readGlobal(rows, 'lumi.treasury.lumiDividendRate')), // weekly share of the excess
    payoutsPaused: truthy(readGlobal(rows, 'lumi.treasury.payoutsPaused')),         // true: every prize is owed
  };
  cache = {
    scale: readGlobal(rows, 'lumi.scale'),                                          // global economy scale (0.2)
    treasury,                                                                       // policy above
    seed: { toBank: Math.floor(readGlobal(rows, 'lumi.seed.toBank')), toHoldings: Math.floor(readGlobal(rows, 'lumi.seed.toHoldings')) }, // seed split
    games: Object.fromEntries([...games].map((g) => [g, readGame(rows, g)])),       // per-game knobs
  };
  cacheAt = nowMs();                                                                // remember when
  return cache;                                                                     // the fresh snapshot
}

// The current snapshot (re-read when older than CACHE_MS).
function snap() {
  if (!cache || nowMs() - cacheAt > CACHE_MS || nowMs() < cacheAt) reload();       // stale (or clock went back): re-read
  return cache;                                                                     // cached values
}

/** One game's knobs: { enabled, priceMult, payoutMult, dailyCap, priceOverrides, payoutOverrides }. */
function gameSettings(game) {
  const s = snap();                                                                 // current values
  if (!s.games[game]) s.games[game] = readGame(new Map(), game);                    // unknown game: its defaults
  return s.games[game];                                                             // the knobs
}

/** The global scale (default 0.2). */
function scale() {
  return snap().scale;                                                              // e.g. 0.2
}

/** Treasury policy: { bankTarget, bankCeiling, bands, sweepIntervalMs, refillBufferPct, reserveFloor, lumiDividendRate, payoutsPaused }. */
function treasuryPolicy() {
  return snap().treasury;                                                           // see reload()
}

/** The one-time seed split from the settings: { toBank, toHoldings }. */
function seedSplit() {
  return snap().seed;                                                               // see reload()
}

// ---------------------------------------------------------------------------------------------- the formulas

// A native amount must be a finite number >= 0.
function checkNative(native, fn) {
  if (typeof native !== 'number' || !Number.isFinite(native) || native < 0) {       // NaN, strings, negatives
    throw new TypeError(`tuning.${fn}: native amount must be a number >= 0 (got ${native})`); // a programming bug
  }
}

/** The SGC to CHARGE for something that costs `native` erinne coins. key: the override key (default: none). */
function scalePrice(game, key, native) {
  checkNative(native, 'scalePrice');                                                // guard the input
  const g = gameSettings(game);                                                     // this game's knobs
  if (key !== undefined && key !== null && Object.prototype.hasOwnProperty.call(g.priceOverrides, key)) return g.priceOverrides[key]; // exact override wins
  if (native === 0) return 0;                                                       // free stays free
  return Math.max(1, Math.round(native * scale() * g.priceMult));                   // never below 1 SGC
}

/** The SGC to PAY for a prize worth `native` erinne coins (may be 0). key: the override key (default: none). */
function scalePayout(game, key, native) {
  checkNative(native, 'scalePayout');                                               // guard the input
  const g = gameSettings(game);                                                     // this game's knobs
  if (key !== undefined && key !== null && Object.prototype.hasOwnProperty.call(g.payoutOverrides, key)) return g.payoutOverrides[key]; // exact override wins
  return Math.max(0, Math.floor(native * scale() * g.payoutMult));                  // rounded down
}

/** This game's daily prize cap in SGC per player per LA day (0 = no cap). */
function cap(game) {
  return gameSettings(game).dailyCap;                                               // whole SGC
}

/** Is this game open? (Spends are refused while it is off; pays still go through.) */
function enabled(game) {
  return gameSettings(game).enabled;                                                // true/false
}

/** What the page shell injects as window.LUMI_TUNING (public/lumi/lumi-tuning.js reads it). */
function clientTuning() {
  const s = snap();                                                                 // current values
  const games = {};                                                                 // per game, only what the formula needs
  for (const [g, v] of Object.entries(s.games)) {
    games[g] = { enabled: v.enabled, priceMult: v.priceMult, payoutMult: v.payoutMult, dailyCap: v.dailyCap, priceOverrides: v.priceOverrides, payoutOverrides: v.payoutOverrides };
  }
  return { scale: s.scale, games };                                                 // { scale, games: {...} }
}

// ---------------------------------------------------------------------------------------------- writing

// One row in lumi_admin_log.
function logChange(who, key, oldValue, newValue) {
  try {
    getDb().prepare('INSERT INTO lumi_admin_log (who, key, old, new, at) VALUES (?, ?, ?, ?, ?)')
      .run(String(who || ''), key, oldValue === undefined || oldValue === null ? null : String(oldValue), newValue === undefined || newValue === null ? null : String(newValue), nowMs()); // audit row
  } catch { /* the log table is missing only before initLumiGames(): never block a setting change on it */ }
}

/**
 * Set a GLOBAL lumi setting (a key from panelSettings SCHEMA, e.g. 'lumi.scale' or 'lumi.treasury.bankTarget').
 * value null/'' resets it to its default. Logged to lumi_admin_log as `who`. Returns the fresh snapshot.
 */
function set(key, value, who = '') {
  const def = SCHEMA[key];                                                          // must be a known key
  if (!def || !key.startsWith('lumi.')) throw new Error(`tuning.set: unknown lumi setting "${key}"`); // only lumi keys here
  const old = getSystemState(PREFIX + key);                                         // for the log
  if (value === null || value === undefined || value === '') {
    deleteSystemState(PREFIX + key);                                                // back to the default
  } else {
    if (def.type === 'number' && !(Number.isFinite(Number(value)) && Number(value) >= 0)) throw new Error(`tuning.set: ${key} must be a number >= 0`); // refuse junk
    if (key === 'lumi.treasury.bands') JSON.parse(String(value));                   // must at least be JSON
    setSystemState(PREFIX + key, String(value));                                    // store as text
  }
  logChange(who, key, old, value);                                                  // audit
  return reload();                                                                  // apply now
}

/**
 * Set one knob of one game: knob is enabled | priceMult | payoutMult | dailyCap | priceOverrides | payoutOverrides.
 * Overrides take an object {key: exact SGC}. value null resets to the default. Logged. Returns the game's knobs.
 */
function setGame(game, knob, value, who = '') {
  if (!GAME_ID.test(String(game))) throw new Error(`tuning.setGame: bad game id "${game}"`); // guard the id
  if (!GAME_KNOBS.includes(knob)) throw new Error(`tuning.setGame: unknown knob "${knob}"`); // guard the knob
  const key = `${PREFIX}lumi.game.${game}.${knob}`;                                // the system_state key
  const old = getSystemState(key);                                                  // for the log
  let text = null;                                                                  // what will be stored
  if (value !== null && value !== undefined && value !== '') {
    if (knob === 'enabled') text = truthy(value) || value === true ? 'true' : 'false'; // normalise booleans
    else if (knob.endsWith('Overrides')) text = JSON.stringify(parseOverrides(JSON.stringify(value))); // keep only valid entries
    else if (Number.isFinite(Number(value)) && Number(value) >= 0) text = String(Number(value)); // a number >= 0
    else throw new Error(`tuning.setGame: ${knob} must be a number >= 0`);           // refuse junk
  }
  if (text === null) deleteSystemState(key); else setSystemState(key, text);        // store or reset
  logChange(who, `lumi.game.${game}.${knob}`, old, text);                           // audit
  reload();                                                                         // apply now
  return gameSettings(game);                                                        // the fresh knobs
}

module.exports = {
  define,          // register a game for the admin page
  definedGames,    // list registered games
  reload,          // re-read every setting now
  gameSettings,    // one game's knobs
  scale,           // global scale
  treasuryPolicy,  // treasury knobs
  seedSplit,       // seed split
  scalePrice,      // native price -> SGC charged
  scalePayout,     // native prize -> SGC paid
  cap,             // daily cap
  enabled,         // game on/off
  clientTuning,    // window.LUMI_TUNING
  set,             // change a global lumi setting (logged)
  setGame,         // change one game's knob (logged)
  parseBands,      // exported for tests and the admin page
  DEFAULT_BANDS,   // default sweep bands
  GAME_DEFAULTS,   // default per-game knobs
};
