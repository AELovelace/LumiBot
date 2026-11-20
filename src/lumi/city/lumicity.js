'use strict';

/**
 * Lumi City, ported from erinne mnemerynne/lumicity.py (commit 0ddc466): Lumi Town grown into one long city. LefTown on
 * the left, Downtown in the middle, Right-City on the right. Everyone has a free flat in Lumi Heights (apartment()),
 * and may buy one plot of land for a house: from the real-estate office, or from another player who listed theirs.
 * A town that fills up grows a new block at its gate, so nothing already built ever moves.
 *
 * Data: src/lumi/data/city.json (the map, shared with the page's city-map.js) and estate.json (30 house styles, five
 * yard slots with 15 pieces each, the Keepsake Capsule, rarity values), both validated at load (a bad edit stops the
 * server at start). Ownership: lumi_city_towns (blocks per town) and lumi_plots (one row per owned plot). What she owns
 * to put on a plot (styles, yard pieces) and her home town live in her pet save (estate, home_town).
 *
 * Coins (CONTRACT section 5, game 'city' = Lumi City Realty):
 *   plot from the office    sgc.spend(..., 'city', 'plot')                       lumi_plots.paid = SGC charged
 *   house style / yard      sgc.spend(..., 'city', 'style' | 'yard', { key: item id })
 *   Keepsake Capsule        sgc.spend(..., 'city', 'capsule', { key: 'capsule' })
 *   capsule repeat          sgc.pay(..., 'city', 'buyback', 'lumi-city-buyback:<uid>:<roll>', { cap: false })
 *   listing bought          sgc.transfer(buyer, seller, list price SGC, 'city', 'trade', 'lumi-plot:<plot>:<bought_at>:<version>')
 *   sold to the office      sgc.pay(..., SGC exact, 'city', 'sale', 'lumi-city:<town>:<block>:<lot>:<bought_at>', { exact, cap: false })
 * Listing prices are SGC (a player's own price); the office's price is erinne's native `suggested`, scaled by tuning.
 * Every function that writes runs inside db.tx(). Refusals are PetError (400), in Lumi's own voice.
 * Flats: erinne numbered flats by integer account id; LumiBot ids are Discord snowflakes, so flats are numbered by the
 * order players first got a Lumi, in the new table lumi_flats(n, user_id) (never renumbered).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDb, nowMs } = require('../db');
const sgc = require('../sgc');
const tuning = require('../tuning');
const users = require('../users');
const { LumiError, notEnoughSGC } = require('../errors');
const lumipet = require('../pet/lumipet');

const { PetError, RARITIES } = lumipet;                                             // refusals; rarity order

const GAME = 'city';                                                                // tuning/ledger id (erinne "lumi-city")
const TOWNS = ['left', 'right'];                                                    // LefTown and Right-City
const LOT_KEYS = 'abcdefgh';                                                        // the template's eight lots
const MAX_BLOCKS = 999;                                                             // a plot id has at most three digits of block
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/u;                                            // an estate.json id
const PLACE_RE = /^[a-z][a-z0-9-]{0,23}$/u;                                         // a Downtown place's id
const PLOT_RE = /^([lr])-(\d{1,3})-([1-8])$/u;                                      // "l-3-5": LefTown, block 3, lot 5
const PRICE_KEYS = ['base', 'decay', 'floor', 'avenue', 'round', 'sell_office', 'list_min', 'list_max']; // city.json "price"
const SLOTS = ['fence', 'mailbox', 'path', 'lamp', 'ornament'];                     // yard slots, in order
const STYLES_COUNT = 30;                                                            // house styles
const YARD_SHOP = 5;                                                                // per slot, pieces sold
const YARD_CAPSULE = 10;                                                            // per slot, pieces from the capsule
const DATA = path.join(__dirname, '..', 'data');                                    // src/lumi/data

const isInt = (v) => Number.isInteger(v);                                           // Python isinstance(v, int)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);                   // int or float, never bool
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);      // a dict
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); // one data file

// ---------------------------------------------------------------------------------------------- the map (city.json)

// One section's rows, checked: `rows` of them, all one width, only known symbols.
function _grid(data, section, name, known) {
  const rows = isObj(section) ? section.rows : null;                                // the section's rows
  if (!Array.isArray(rows) || rows.length !== data.rows || !rows.every((r) => typeof r === 'string' && r)) throw new Error(`Lumi City's ${name} needs ${data.rows} rows of tiles.`);
  if (new Set(rows.map((r) => r.length)).size !== 1) throw new Error(`Lumi City's ${name} has rows of different widths.`); // not ragged
  const strange = [...new Set(rows.join(''))].filter((ch) => !known.has(ch)).sort(); // unknown symbols
  if (strange.length) throw new Error(`Lumi City's ${name} uses unknown symbols: ${strange.join('')}.`);
  return rows;                                                                      // the rows
}

// Where a letter sits in rows, as [top, left, bottom, right]; it must be one solid rectangle.
function _rectangle(rows, key, name) {
  const cells = [];                                                                 // every tile with this letter
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === key) cells.push([y, x]); })); // find them
  if (!cells.length) throw new Error(`Lumi City's ${name} has no '${key}' on the map.`);
  const top = Math.min(...cells.map((c) => c[0])), bottom = Math.max(...cells.map((c) => c[0])); // rows spanned
  const left = Math.min(...cells.map((c) => c[1])), right = Math.max(...cells.map((c) => c[1])); // columns spanned
  if (cells.length !== (bottom - top + 1) * (right - left + 1)) throw new Error(`Lumi City's ${name}: '${key}' must be one solid rectangle.`);
  return [top, left, bottom, right];                                                // the box
}

// A footprint's front door: the tile below its bottom row, under its middle; it must be walkable. Returns [x, y].
function _door(rows, box, walk, name, key) {
  const [, left, bottom, right] = box;                                              // the box
  const x = left + Math.floor((right - left + 1) / 2);                              // under the middle
  const y = bottom + 1;                                                             // one row down
  if (y >= rows.length || !walk.includes(rows[y][x])) throw new Error(`Lumi City's ${name}: the door of '${key}' must open onto a street or pavement.`);
  return [x, y];                                                                    // the door tile
}

// Whether every walkable tile can reach every other one (breadth-first).
function _connected(rows, walk) {
  const tiles = new Set();                                                          // "x,y" of every walkable tile
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (walk.includes(ch)) tiles.add(`${x},${y}`); })); // collect
  if (!tiles.size) return false;                                                    // nowhere to stand
  const start = tiles.values().next().value;                                        // any tile
  const seen = new Set([start]);                                                    // reached so far
  const queue = [start];                                                            // to explore
  while (queue.length) {
    const [x, y] = queue.shift().split(',').map(Number);                            // the next tile
    for (const [sx, sy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {      // up, down, left, right
      const k = `${sx},${sy}`;                                                      // its key
      if (tiles.has(k) && !seen.has(k)) { seen.add(k); queue.push(k); }             // a new reachable tile
    }
  }
  return seen.size === tiles.size;                                                  // nothing left unreached
}

/** erinne load_city(): the city's layout, validated. Throws naming what's wrong. */
function loadCity(data = readJson('city.json')) {
  if (!isInt(data.rows) || data.rows < 3 || data.rows > 200) throw new Error('Lumi City needs a number of rows.');
  const tile = data.tile;                                                           // [width, height]
  if (!Array.isArray(tile) || tile.length !== 2 || !tile.every((n) => isInt(n) && n > 0)) throw new Error('Lumi City needs a tile size: [width, height].');
  const walk = data.walk, blocking = data.block;                                    // walkable and blocking symbols
  if (typeof walk !== 'string' || !walk || typeof blocking !== 'string' || [...walk].some((ch) => blocking.includes(ch))) throw new Error('Lumi City needs its walkable and blocking symbols, and none can be both.');
  if (!isObj(data.symbols)) throw new Error('Lumi City needs its symbols named.');
  const known = new Set([...Object.keys(data.symbols), ...walk, ...blocking]);      // every symbol a section may use
  const down = data.downtown, template = data.template, gate = data.gate;           // the three sections
  const downRows = _grid(data, down, 'Downtown', known);                            // checked rows
  const blockRows = _grid(data, template, 'block template', known);                 // checked rows
  const gateRows = _grid(data, gate, 'gate', known);                                // checked rows
  if (!isInt(down.x0) || !down.name || !down.street) throw new Error("Lumi City's Downtown needs its first column (x0), a name and a street.");

  const avenue = data.avenue;                                                       // the avenue's rows
  if (!Array.isArray(avenue) || !avenue.length || !avenue.every((y) => isInt(y) && y >= 0 && y < data.rows)) throw new Error("Lumi City needs its avenue's rows.");
  for (const [name, rows] of [['block template', blockRows], ['Downtown', downRows], ['gate', gateRows]]) {
    if (avenue.some((y) => [...rows[y]].some((ch) => !walk.includes(ch)))) throw new Error(`Lumi City's avenue must be walkable all the way across the ${name}.`);
  }

  const lots = template.lots;                                                       // the eight lots
  if (!Array.isArray(lots) || JSON.stringify(lots.filter(isObj).map((l) => l.lot).sort((a, b) => a - b)) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])) throw new Error("Lumi City's block template needs lots 1 to 8.");
  if (lots.map((l) => l.key || '').sort().join('') !== LOT_KEYS) throw new Error("Lumi City's lots must be the letters a to h, one each.");
  for (const lot of lots) {
    if (!['avenue', 'lane'].includes(lot.frontage)) throw new Error(`Lumi City's lot ${lot.lot} faces the avenue or a lane.`);
    _door(blockRows, _rectangle(blockRows, lot.key, 'block template'), walk, 'block template', lot.key); // its door on a street
  }
  if ([...downRows, ...gateRows].some((row) => [...row].some((ch) => LOT_KEYS.includes(ch)))) throw new Error("Lumi City's lots belong in the block template, not Downtown or the gate.");

  const places = down.places;                                                       // Downtown's buildings
  if (!isObj(places) || !Object.keys(places).length) throw new Error("Lumi City's Downtown needs its places.");
  const ids = new Set();                                                            // place ids so far
  for (const [key, p] of Object.entries(places)) {
    if (!isObj(p) || !PLACE_RE.test(String(p.id || '')) || ids.has(p.id)) throw new Error(`Lumi City's Downtown place '${key}' needs its own id.`);
    if (!(p.town === undefined || p.town === null || TOWNS.includes(p.town))) throw new Error(`Lumi City's ${p.id} belongs to LefTown (left), Right-City (right) or nobody.`);
    ids.add(p.id);                                                                  // remember it
    _door(downRows, _rectangle(downRows, key, 'Downtown'), walk, 'Downtown', key);  // a solid building with a door
  }

  const arrive = gate.arrive;                                                       // where newcomers are put down
  if (!Array.isArray(arrive) || arrive.length !== 2 || !arrive.every(isInt) || arrive[1] < 0 || arrive[1] >= data.rows
    || arrive[0] < 0 || arrive[0] >= gateRows[0].length || !walk.includes(gateRows[arrive[1]][arrive[0]])) throw new Error("Lumi City's gate needs an arrival tile [column, row] on a street.");

  const city = gateRows.map((g, i) => g + blockRows[i] + downRows[i] + blockRows[i] + g); // the smallest city
  if (!_connected(city, walk)) throw new Error("Lumi City has streets that can't be reached from the rest of the city.");
  if (!_connected(blockRows.map((b) => b + b), walk)) throw new Error("Lumi City's blocks don't join up when a town grows.");

  const towns = data.towns;                                                         // names and street names
  for (const [town, district] of [['left', 'l'], ['right', 'r']]) {
    const about = isObj(towns) ? towns[town] : null;                                // this town
    if (!isObj(about) || !about.name || !about.avenue || about.district !== district) throw new Error(`Lumi City's ${town} town needs a name, an avenue and district '${district}'.`);
    if (!Array.isArray(about.lanes) || !about.lanes.length || !about.lanes.every((n) => typeof n === 'string' && n)) throw new Error(`Lumi City's ${about.name} needs at least one lane name.`);
  }
  if (!isInt(data.start_blocks) || data.start_blocks < 1 || data.start_blocks > MAX_BLOCKS) throw new Error('Lumi City needs a number of start_blocks (1 or more).');
  const price = data.price;                                                         // the price curve
  if (!isObj(price) || PRICE_KEYS.some((k) => !isNum(price[k]))) throw new Error(`Lumi City's price needs ${PRICE_KEYS.join(', ')}.`);
  if (price.base <= 0 || !(price.decay > 0 && price.decay <= 1) || price.floor < 0 || price.avenue <= 0 || price.round < 1
    || !(price.sell_office > 0 && price.sell_office <= 1) || !(price.list_min > 0 && price.list_min <= 1 && price.list_max >= 1)) {
    throw new Error("Lumi City's prices are out of range (base > 0, 0 < decay <= 1, round >= 1, sell_office up to 1, list_min <= 1 <= list_max).");
  }
  return data;                                                                      // validated
}

// ---------------------------------------------------------------------------------------------- estate.json

/** erinne load_estate(): house styles, yard slots and pieces, the Keepsake Capsule, validated. */
function loadEstate(data = readJson('estate.json')) {
  const seen = new Set();                                                           // every id
  const piece = (item, where) => {                                                  // one style or yard piece
    if (!isObj(item) || !ID_RE.test(String(item.id || '')) || seen.has(item.id)) throw new Error(`Lumi City's ${where} has a bad or repeated id.`);
    seen.add(item.id);                                                              // remember it
    if (typeof item.name !== 'string' || !item.name || typeof item.icon !== 'string' || !item.icon || typeof item.hint !== 'string') throw new Error(`Lumi City's ${item.id} needs a name, an icon and a hint.`);
    if (!isInt(item.price) || item.price < 0 || item.price > 100_000) throw new Error(`Lumi City's ${item.id} needs a price from 0 to 100000.`);
  };
  const styles = data.styles;                                                       // house styles
  if (!Array.isArray(styles) || styles.length !== STYLES_COUNT) throw new Error(`Lumi City needs exactly ${STYLES_COUNT} house styles.`);
  for (const style of styles) piece(style, 'house styles');                         // each style
  if (styles[0].price !== 0 || styles.filter((s) => s.price === 0).length !== 1) throw new Error("Lumi City's first house style is the free starter, and the only free one.");
  const slots = data.slots;                                                         // yard slots
  if (!Array.isArray(slots) || JSON.stringify(slots.map((s) => (isObj(s) ? s.id : null))) !== JSON.stringify(SLOTS) || !slots.every((s) => s.name && s.icon)) {
    throw new Error(`Lumi City's yard slots must be ${SLOTS.join(', ')}, in that order, each with a name and an icon.`);
  }
  const yard = data.yard;                                                           // yard pieces per slot
  if (!isObj(yard) || JSON.stringify(Object.keys(yard).sort()) !== JSON.stringify([...SLOTS].sort())) throw new Error("Lumi City's yard needs pieces for every slot.");
  for (const slot of SLOTS) {
    const items = yard[slot];                                                       // this slot's pieces
    if (!Array.isArray(items) || items.length !== YARD_SHOP + YARD_CAPSULE) throw new Error(`Lumi City's ${slot} needs ${YARD_SHOP + YARD_CAPSULE} pieces.`);
    for (const item of items) {
      piece(item, `${slot} pieces`);                                                // basics
      if (item.price && 'rarity' in item) throw new Error(`Lumi City's ${item.id} can't be sold and a capsule piece too.`);
      if (!item.price && !RARITIES.includes(item.rarity)) throw new Error(`Lumi City's ${item.id} is free, so it must be a capsule piece with a rarity.`);
    }
    if (items.filter((i) => i.price).length !== YARD_SHOP) throw new Error(`Lumi City's ${slot} needs ${YARD_SHOP} pieces for sale and ${YARD_CAPSULE} from the capsule.`);
  }
  const capsule = data.capsule;                                                     // the Keepsake Capsule
  if (!isObj(capsule) || !capsule.name || !isInt(capsule.price) || capsule.price < 1 || capsule.price > 100_000 || !isObj(capsule.odds)
    || JSON.stringify(Object.keys(capsule.odds)) !== JSON.stringify(RARITIES) || Object.values(capsule.odds).some((v) => !isInt(v) || v < 0)
    || Object.values(capsule.odds).reduce((a, b) => a + b, 0) !== 100) {
    throw new Error('The Keepsake Capsule needs a name, a price and odds for every rarity that add up to 100.');
  }
  for (const [rarity, chance] of Object.entries(capsule.odds)) {                    // a rollable rarity needs a piece
    if (chance && !SLOTS.some((slot) => yard[slot].some((i) => i.rarity === rarity))) throw new Error(`The Keepsake Capsule can roll ${rarity}, but has no ${rarity} pieces.`);
  }
  const values = data.values;                                                       // what a capsule piece is worth
  if (!isObj(values) || JSON.stringify(Object.keys(values)) !== JSON.stringify(RARITIES) || Object.values(values).some((v) => !isInt(v) || v < 0 || v > 100_000)) {
    throw new Error('Lumi City needs a value for every rarity, so a repeat can pay back half of it.');
  }
  return data;                                                                      // validated
}

const CITY = loadCity();                                                            // throws at start if broken
const ESTATE = loadEstate();                                                        // throws at start if broken
const STARTER = ESTATE.styles[0].id;                                                // the free starter house
const _STYLES = Object.fromEntries(ESTATE.styles.map((s) => [s.id, s]));            // style id -> style
const _YARD = Object.fromEntries(SLOTS.flatMap((slot) => ESTATE.yard[slot].map((i) => [i.id, { ...i, slot }]))); // yard id -> piece + slot
const _KEEPSAKES = Object.values(_YARD).filter((i) => 'rarity' in i);               // the Keepsake Capsule's pool
const _LOTS = Object.fromEntries(CITY.template.lots.map((l) => [l.lot, l]));         // lot number -> letter + frontage
const _TOWN_OF = { l: 'left', r: 'right' };                                         // plot letter -> town

// ---------------------------------------------------------------------------------------------- flats (lumi_flats)

let flatsReadyFor = null;                                                           // the DB handle the table was made on

/** CREATE TABLE IF NOT EXISTS lumi_flats (call from routes/city.js register(); safe to call again). */
function init() {
  const db = getDb();                                                               // the economy DB
  if (flatsReadyFor === db) return;                                                 // done for this handle
  db.exec(`
    CREATE TABLE IF NOT EXISTS lumi_flats (
      n       INTEGER PRIMARY KEY AUTOINCREMENT,         -- flat number in Lumi Heights order (1 = 1A, 9 = 2A)
      user_id TEXT NOT NULL UNIQUE                       -- Discord id
    );
  `);                                                                               // one row per player with a Lumi
  flatsReadyFor = db;                                                               // remember
}

/** Give every Lumi without a flat number one, in the order their Lumi was first saved (lumi_pets rowid). */
function ensureFlats() {
  init();                                                                           // the table exists
  getDb().prepare(`
    INSERT OR IGNORE INTO lumi_flats (user_id)
    SELECT p.user_id FROM lumi_pets p WHERE NOT EXISTS (SELECT 1 FROM lumi_flats f WHERE f.user_id = p.user_id) ORDER BY p.rowid
  `).run();                                                                         // number the newcomers
}

/** This player's flat number (assigned on first use). */
function flatNumber(uid) {
  init();                                                                           // the table exists
  const db = getDb();                                                               // the economy DB
  let row = db.prepare('SELECT n FROM lumi_flats WHERE user_id = ?').get(String(uid)); // already numbered?
  if (!row) { ensureFlats(); row = db.prepare('SELECT n FROM lumi_flats WHERE user_id = ?').get(String(uid)); } // number everyone with a Lumi
  if (!row) { db.prepare('INSERT OR IGNORE INTO lumi_flats (user_id) VALUES (?)').run(String(uid)); row = db.prepare('SELECT n FROM lumi_flats WHERE user_id = ?').get(String(uid)); } // no Lumi yet: still a door
  return row.n;                                                                     // 1, 2, 3 ...
}

/** Whose flat number n is (null when nobody's). */
function flatOwner(n) {
  init();                                                                           // the table exists
  const row = getDb().prepare('SELECT user_id FROM lumi_flats WHERE n = ?').get(n); // the owner
  return row ? row.user_id : null;                                                  // Discord id or null
}

/** erinne apartment(): a flat number as 8 doors a floor ({floor, door, label}: n 1 is 1A, 9 is 2A, 12 is 2D). */
function aptOfNumber(n) {
  const floor = 1 + Math.floor((n - 1) / 8);                                        // which floor
  const door = ((n - 1) % 8) + 1;                                                   // which door on it (1..8)
  return { floor, door, label: `${floor}${'ABCDEFGH'[door - 1]}` };                 // e.g. 2D
}

/** erinne apartment(uid): her flat in Lumi Heights; the number never changes. */
function apartment(uid) {
  return aptOfNumber(flatNumber(uid));                                              // by flat number
}

// ---------------------------------------------------------------------------------------------- numbers

/** How many blocks each town has, seeding both at start_blocks the first time. Writes: INSIDE db.tx(). */
function towns() {
  const ins = getDb().prepare('INSERT OR IGNORE INTO lumi_city_towns (town, blocks) VALUES (?, ?)'); // seed on demand
  for (const town of TOWNS) ins.run(town, CITY.start_blocks);                       // an existing town keeps its size
  return _blocks();                                                                 // the sizes
}

/** How many blocks each town has, without writing. */
function _blocks() {
  const found = Object.fromEntries(getDb().prepare('SELECT town, blocks FROM lumi_city_towns').all().map((r) => [r.town, r.blocks])); // stored sizes
  return Object.fromEntries(TOWNS.map((t) => [t, found[t] || CITY.start_blocks]));  // unseeded = start size
}

/** A plot's id: "l-3-5". */
function plotId(town, block, lot) {
  return `${town[0]}-${block}-${lot}`;                                              // town letter, block, lot
}

/** Every lot id in the city now: LefTown's from block 1 outward, lots 1-8, then Right-City's. */
function lots(blocks) {
  const out = [];                                                                   // every lot
  for (const town of TOWNS) for (let b = 1; b <= blocks[town]; b += 1) for (let l = 1; l <= 8; l += 1) out.push(plotId(town, b, l)); // in order
  return out;                                                                       // ids
}

/** A plot id as [town, block, lot]. Throws PetError when it isn't one. */
function parse(plot) {
  const m = PLOT_RE.exec(plot || '');                                               // "l-3-5"
  if (!m || parseInt(m[2], 10) < 1) throw new PetError("That isn't a plot in Lumi City.");
  return [_TOWN_OF[m[1]], parseInt(m[2], 10), parseInt(m[3], 10)];                  // town, block, lot
}

/** `value` to the nearest `step` (halves up). */
function _roundTo(step, value) {
  return Math.floor(value / step + 0.5) * step;                                     // whole coins
}

/** The office's price for a lot in erinne's NATIVE coins (scale with tuning.scalePrice('city','plot', ...) for SGC). */
function suggested(town, block, lot) {
  const price = CITY.price;                                                         // the curve
  const frontage = _LOTS[lot].frontage === 'avenue' ? price.avenue : 1;             // the avenue side costs more
  return Math.max(Math.trunc(price.floor), _roundTo(Math.trunc(price.round), price.base * price.decay ** (block - 1) * frontage)); // never below the floor
}

/** The office's price for a lot in SGC (what spend() will charge). */
function suggestedSgc(town, block, lot) {
  return tuning.scalePrice(GAME, 'plot', suggested(town, block, lot));              // scaled
}

/** A small number in Roman numerals. */
function _roman(n) {
  let out = '';                                                                     // the numeral
  for (const [value, letters] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
    while (n >= value) { out += letters; n -= value; }                              // as many as fit
  }
  return out;                                                                       // e.g. "II"
}

/** The cross street of a town's block: its lanes in order, then round again with II, III ... */
function street(town, block) {
  const lanes = CITY.towns[town].lanes;                                             // the lane names
  const name = lanes[(block - 1) % lanes.length];                                   // which name
  const lap = Math.floor((block - 1) / lanes.length) + 1;                           // how many times round
  return lap === 1 ? name : `${name} ${_roman(lap)}`;                               // e.g. "Rose Lane II"
}

// ---------------------------------------------------------------------------------------------- the page's view

/** What stands in a plot's yard: {slot: piece id or ""} for every slot. */
function _yardOf(row) {
  let saved = {};                                                                   // stored yard
  try { saved = row ? JSON.parse(row.yard || '{}') : {}; } catch { saved = {}; }    // unreadable = empty
  if (!isObj(saved)) saved = {};                                                    // must be an object
  return Object.fromEntries(SLOTS.map((slot) => [slot, _YARD[saved[slot]] && _YARD[saved[slot]].slot === slot ? saved[slot] : ''])); // valid only
}

/** A plot's owner for the page: {id, name} ("a neighbour" for someone unknown). */
function _owner(uid, names) {
  if (!(uid in names)) {                                                            // look each owner up once per view
    const name = users.displayName(uid);                                            // their Discord name
    names[uid] = name && name !== 'Someone' ? name : 'a neighbour';                 // unknown: a neighbour
  }
  return { id: String(uid), name: names[uid] };                                     // id string + name
}

/** erinne view(uid): the whole city for the page. Read-only (safe outside a transaction). */
function view(uid) {
  uid = String(uid);                                                                // Discord id
  const blocks = _blocks();                                                         // town sizes
  const rows = new Map(getDb().prepare('SELECT * FROM lumi_plots').all().map((r) => [`${r.town}|${r.block}|${r.lot}`, r])); // every owned plot
  const names = {};                                                                 // owner name cache
  const out = [];                                                                   // every lot
  let mine = null;                                                                  // her plot
  for (const plot of lots(blocks)) {
    const [town, block, lot] = parse(plot);                                         // its parts
    const row = rows.get(`${town}|${block}|${lot}`) || null;                        // null: office land
    if (row && row.user_id === uid) mine = plot;                                    // hers
    out.push({
      id: plot, town, block, lot, frontage: _LOTS[lot].frontage,                    // where
      suggested: suggested(town, block, lot),                                       // native office price (page shows LumiPrice('city','plot',...))
      owner: row ? _owner(row.user_id, names) : null,                               // who
      style: row ? (row.style in _STYLES ? row.style : STARTER) : '',               // the house
      yard: _yardOf(row), list_price: row ? row.list_price : null,                  // yard + listing (SGC)
      version: row ? row.version : null,                                            // for buy_listing
    });
  }
  const pet = lumipet._peek(uid) || {};                                             // her save (no catching up)
  const estate = lumipet.estateOf(pet);                                             // her estate
  const me = {
    id: uid, plot: mine, home_town: pet.home_town === undefined ? null : pet.home_town, apt: apartment(uid), // who and where
    coins: sgc.balance(uid), styles: estate.styles.filter((s) => s in _STYLES), yard: estate.yard.filter((y) => y in _YARD), // SGC + what she owns
  };
  return { towns: blocks, lots: out, me, catalog: ESTATE, layout: CITY };           // erinne's shape
}

// ---------------------------------------------------------------------------------------------- what she can do

/** Her plot's row, or null. */
function _plotOf(uid) {
  return getDb().prepare('SELECT * FROM lumi_plots WHERE user_id = ?').get(String(uid)) || null; // one each
}

/** A lot's row (null: office land). */
function _row(town, block, lot) {
  return getDb().prepare('SELECT * FROM lumi_plots WHERE town = ? AND block = ? AND lot = ?').get(town, block, lot) || null; // the owner's row
}

/** A row's plot id. */
function _idOf(row) {
  return plotId(row.town, row.block, row.lot);                                      // "l-3-5"
}

/** Lumi refusing a second plot. */
function _homeLine(row) {
  return `I've already got a home on ${street(row.town, row.block)}!`;              // naming her street
}

/** Add something to what she owns, once. */
function _own(estate, key, item) {
  if (!estate[key].includes(item)) estate[key].push(item);                          // once
}

// Spend with Lumi's own words for a 402 ("I can't afford that yet! It's N SGC.").
function _spend(uid, username, native, kind, key) {
  try {
    return sgc.spend(uid, username, native, GAME, kind, { key });                   // -> SGC charged
  } catch (error) {
    if (error instanceof LumiError && error.code === 'not_enough_sgc') throw notEnoughSGC(error.extra.need, error.extra.have, `I can't afford that yet! It's ${error.extra.need} SGC.`); // in her voice
    throw error;                                                                    // game_off etc.
  }
}

/** A new block at the town's gate once every lot it has is owned. True when it grew. */
function _grow(town, blocks) {
  const owned = getDb().prepare('SELECT count(*) AS n FROM lumi_plots WHERE town = ? AND block <= ?').get(town, blocks).n; // owned lots
  if (owned < blocks * 8 || blocks >= MAX_BLOCKS) return false;                     // office land left (or too big)
  getDb().prepare('UPDATE lumi_city_towns SET blocks = blocks + 1 WHERE town = ?').run(town); // grow
  return true;                                                                      // grew
}

/**
 * erinne act(uid, action, plot=, price=, version=, item=, slot=, rng=): one thing she chose to do in Lumi City.
 * INSIDE db.tx(): the plot, any coins and her save are written together. Returns {said, ...view(uid)}.
 * opts.username: the player's display name (for the SGC account).
 */
function act(uid, action, opts = {}) {
  uid = String(uid);                                                                // Discord id
  const { plot = null, price = null, version = null, item = null, slot = null, rng = null } = opts; // the choices
  const username = opts.username === undefined ? lumipet._nameOf(uid) : opts.username; // her SGC account name
  const now = nowMs();                                                              // one clock reading
  const blocks = towns();                                                           // both towns exist from here on
  const pet = lumipet.load(uid, now);                                               // her save, caught up
  const estate = lumipet.estateOf(pet);                                             // her estate
  const have = _plotOf(uid);                                                        // her plot, if any
  let said = {};                                                                    // what happened

  if (action === 'home_town') {
    if (!TOWNS.includes(item)) throw new PetError('Which town? LefTown or Right-City!');
    if (have && have.town !== item) throw new PetError(`My house is in ${CITY.towns[have.town].name}, so that's my home town!`); // her house decides
    pet.home_town = item;                                                           // picked
    said = { home_town: item, text: `${CITY.towns[item].name} it is! That's my home town now.` };
  } else if (action === 'buy') {
    const [town, block, lot] = parse(plot);                                         // which lot
    if (block > blocks[town]) throw new PetError("That plot isn't built yet!");     // beyond the gate
    const taken = _row(town, block, lot);                                           // owned already?
    if (taken) throw new PetError(taken.user_id === uid ? "That one's already mine!" : 'Someone already lives there!');
    if (have) throw new PetError(_homeLine(have));                                  // one plot each
    const paid = _spend(uid, username, suggested(town, block, lot), 'plot', 'plot'); // Lumi City Realty (SGC charged)
    getDb().prepare("INSERT INTO lumi_plots (town, block, lot, user_id, style, yard, paid, bought_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)")
      .run(town, block, lot, uid, STARTER, paid, now);                              // hers, at what she paid
    pet.home_town = town;                                                           // her house's town is her home town
    _own(estate, 'styles', STARTER);                                                // the starter house comes with it
    const grew = _grow(town, blocks[town]);                                         // a new block if full
    said = { bought: plot, paid, expanded: grew, text: `A home of my own on ${street(town, block)}! The starter cottage is ready.` };
  } else if (action === 'buy_listing') {
    const [town, block, lot] = parse(plot);                                         // which lot
    const row = _row(town, block, lot);                                             // its row
    if (!row || row.list_price === null || row.list_price !== price || row.version !== version) throw new PetError('Someone changed the price — have another look!'); // stale look
    if (row.user_id === uid) throw new PetError("That's my own plot! I can take it off the market instead.");
    if (have) throw new PetError(_homeLine(have));                                  // one plot each
    const held = sgc.balance(uid);                                                  // said kindly before the ledger is touched
    if (held < price) throw notEnoughSGC(price, held, `I can't afford that yet! It's ${price} SGC.`); // 402
    const moved = sgc.transfer(uid, username, row.user_id, lumipet._nameOf(row.user_id), price, GAME, 'trade', `lumi-plot:${plot}:${row.bought_at}:${version}`); // buyer -> seller
    if (moved.duplicate) throw new PetError('Someone changed the price — have another look!'); // that very sale already went through
    getDb().prepare("UPDATE lumi_plots SET user_id = ?, list_price = NULL, listed_at = NULL, version = version + 1, style = ?, yard = '{}', paid = ?, bought_at = ? WHERE town = ? AND block = ? AND lot = ?")
      .run(uid, STARTER, price, now, town, block, lot);                             // hers now (the seller keeps her styles and yard pieces)
    pet.home_town = town;                                                           // her home town
    _own(estate, 'styles', STARTER);                                                // the starter
    said = { bought: plot, paid: price, text: `A home of my own on ${street(town, block)}! I'll make it cosy.` };
  } else if (action === 'list' || action === 'unlist' || action === 'sell') {
    if (!have) throw new PetError("I haven't got a plot to sell!");
    const mine = _idOf(have);                                                       // her plot id
    const worth = suggestedSgc(have.town, have.block, have.lot);                    // the office's price now, in SGC
    const where = [have.town, have.block, have.lot];                                // its key
    if (action === 'list') {
      const low = Math.ceil(worth * CITY.price.list_min);                           // lowest asking price (SGC)
      const high = Math.floor(worth * CITY.price.list_max);                         // highest (SGC)
      if (!Number.isInteger(price) || price < low || price > high) throw new PetError(`I can list it for ${low} to ${high} SGC.`);
      getDb().prepare('UPDATE lumi_plots SET list_price = ?, listed_at = ?, version = version + 1 WHERE town = ? AND block = ? AND lot = ?').run(price, now, ...where); // on the market
      said = { listed: mine, price, text: `My plot is on the market for ${price} SGC!` };
    } else if (action === 'unlist') {
      if (have.list_price === null) throw new PetError("It isn't on the market.");
      getDb().prepare('UPDATE lumi_plots SET list_price = NULL, listed_at = NULL, version = version + 1 WHERE town = ? AND block = ? AND lot = ?').run(...where); // off the market
      said = { unlisted: mine, text: "I'm keeping it! It's off the market." };
    } else {
      const back = Math.floor(worth * CITY.price.sell_office + 0.5);                // the office pays half (SGC, exact)
      const done = sgc.pay(uid, username, back, GAME, 'sale', `lumi-city:${have.town}:${have.block}:${have.lot}:${have.bought_at}`, { exact: true, cap: false }); // bank -> player
      if (done.duplicate) throw new PetError('That sale has already gone through!'); // pay-once
      getDb().prepare('DELETE FROM lumi_plots WHERE town = ? AND block = ? AND lot = ?').run(...where); // office land again
      said = {
        sold: mine, paid: done.paid, owed: done.owed,                               // SGC now / later
        text: done.owed ? `The office owes me ${done.owed} SGC for it: Lumi-Town Bank is closed for a moment, so it's saved for me. My house styles and yard pieces are still mine!`
          : `The office gave me ${done.paid} SGC for it. My house styles and yard pieces are still mine!`,
      };
    }
  } else if (action === 'style_buy') {
    const style = _STYLES[item || ''];                                              // the style
    if (!style) throw new PetError("That isn't a house style.");
    if (estate.styles.includes(item)) throw new PetError("I've already got that one!");
    const paid = style.price ? _spend(uid, username, style.price, 'style', item) : 0; // Lumi City Realty
    _own(estate, 'styles', item);                                                   // hers
    said = { bought: item, paid, text: `The ${style.name} is mine!` };
  } else if (action === 'style_set') {
    const style = _STYLES[item || ''];                                              // the style
    if (!style) throw new PetError("That isn't a house style.");
    if (item !== STARTER && !estate.styles.includes(item)) throw new PetError("I haven't got that house style yet.");
    if (!have) throw new PetError('I need a plot first! The office in Downtown sells them.');
    getDb().prepare('UPDATE lumi_plots SET style = ? WHERE user_id = ?').run(item, uid); // up it goes
    _own(estate, 'styles', item);                                                   // (the starter is everyone's)
    said = { style: item, text: `Now my house is a ${style.name}!` };
  } else if (action === 'yard_buy') {
    const piece = _YARD[item || ''];                                                // the piece
    if (!piece) throw new PetError("That isn't something for a yard.");
    if (!piece.price) throw new PetError(`That one only comes from the ${ESTATE.capsule.name}!`);
    if (estate.yard.includes(item)) throw new PetError("I've already got that one!");
    const paid = _spend(uid, username, piece.price, 'yard', item);                  // Lumi City Realty
    _own(estate, 'yard', item);                                                     // hers
    said = { bought: item, paid, text: `A ${piece.name} for my yard!` };
  } else if (action === 'yard_set') {
    if (!SLOTS.includes(slot)) throw new PetError("That isn't a spot in a yard.");
    if (!have) throw new PetError('I need a plot first! The office in Downtown sells them.');
    const piece = item ? _YARD[item] || null : null;                                // the piece ('' clears)
    if (item && (!piece || piece.slot !== slot)) throw new PetError("That doesn't go there.");
    if (item && !estate.yard.includes(item)) throw new PetError("I haven't got that one yet.");
    const yard = Object.fromEntries(Object.entries(_yardOf(have)).filter(([, v]) => v)); // what's there now
    if (item) yard[slot] = item; else delete yard[slot];                            // put out, or cleared
    getDb().prepare('UPDATE lumi_plots SET yard = ? WHERE user_id = ?').run(JSON.stringify(yard), uid); // saved
    said = { yard: slot, item: item || '', text: piece ? `There, the ${piece.name} looks lovely!` : "I've cleared that spot." };
  } else if (action === 'capsule') {
    const capsule = ESTATE.capsule;                                                 // the Keepsake Capsule
    if (_KEEPSAKES.every((p) => estate.yard.includes(p.id))) throw new PetError(`I've already got everything the ${capsule.name} holds!`); // before charging
    const paid = _spend(uid, username, capsule.price, 'capsule', 'capsule');        // Lumi City Realty
    const [won, rolled] = lumipet._roll(_KEEPSAKES, capsule.odds, rng);             // rolled like Lumi Pet's capsules
    const repeat = estate.yard.includes(won.id);                                    // a repeat?
    let back = { paid: 0, owed: 0 };                                                // the buyback
    if (repeat) back = sgc.pay(uid, username, Math.floor(ESTATE.values[rolled] / 2), GAME, 'buyback', `lumi-city-buyback:${uid}:${crypto.randomBytes(8).toString('hex')}`, { cap: false }); // half its value
    _own(estate, 'yard', won.id);                                                   // hers
    said = {
      won: won.id, name: won.name, slot: won.slot, rarity: rolled, paid, duplicate: repeat, buyback: back.paid, buyback_owed: back.owed, // what came out
      text: repeat ? `Another ${won.name}! The office gave me ${back.paid} SGC for it.` : `A ${won.name}! Ooh, it's ${rolled}!`,
    };
  } else {
    throw new PetError("Lumi doesn't know that one.");
  }

  lumipet._save(uid, pet);                                                          // her home town, styles and yard pieces
  return { said, ...view(uid) };                                                    // the new city
}

// ---------------------------------------------------------------------------------------------- Lumi Heights

/** Which town's Lumi Heights her flat is in: her home_town, or LefTown while unpicked. Read-only. */
function homeTown(uid) {
  const picked = (lumipet._peek(uid) || {}).home_town;                              // her pick
  return TOWNS.includes(picked) ? picked : 'left';                                  // default LefTown
}

/** Her plot id, or null. */
function plotOf(uid) {
  const row = _plotOf(uid);                                                         // her row
  return row ? _idOf(row) : null;                                                   // "l-3-5" or null
}

/** Everyone whose Lumi lives in this town's Lumi Heights (unpicked counts as LefTown). */
function residents(town) {
  return getDb().prepare("SELECT user_id, CASE WHEN json_valid(data) THEN json_extract(data, '$.home_town') END AS town FROM lumi_pets ORDER BY user_id").all() // every Lumi
    .filter((r) => (r.town || 'left') === town).map((r) => String(r.user_id));      // in this town
}

module.exports = {
  GAME, TOWNS, LOT_KEYS, MAX_BLOCKS, PRICE_KEYS, SLOTS, STYLES_COUNT, YARD_SHOP, YARD_CAPSULE,     // constants
  loadCity, loadEstate, CITY, ESTATE, STARTER, _STYLES, _YARD, _KEEPSAKES, _LOTS,                 // data
  init, ensureFlats, flatNumber, flatOwner, aptOfNumber, apartment,                               // flats
  towns, _blocks, plotId, lots, parse, _roundTo, suggested, suggestedSgc, _roman, street,         // numbers
  _yardOf, view, act, _grow, homeTown, plotOf, residents, _plotOf,                                // the city
};
