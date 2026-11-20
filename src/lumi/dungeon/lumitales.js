'use strict';

/**
 * Lumi Dungeons: the WORDS of the dungeon, ported from erinne mnemerynne/lumitales.py (commit 0ddc466).
 *
 * The library only: data/tales/default.json has lines for every scenario, and each environment may have its own
 * file (tales/<environment>.json) that is used first. erinne's Claude generator (a command-line tool) and its
 * live storyteller (claude_chat / BFGguf) are NOT ported: liveLine() always answers null, exactly as erinne does
 * when nobody is set up to tell the story, so the library line simply stays. (Phase 7 may add LumiBot's llmClient.)
 *
 * Every line is plain text that passes clean(): one short line, no markup, only its scenario's placeholders.
 * Coin amounts in a line are shown in SGC (the native satchel coins through tuning.scalePayout), never "coins".
 */

const fs = require('node:fs');                                                     // reading the library
const path = require('node:path');                                                 // where it lives
const zlib = require('node:zlib');                                                 // crc32 (Node 22.2+)
const tuning = require('../tuning');                                               // native coins -> SGC for the words
const { LumiError } = require('../errors');                                        // "no" answers
const lumibattle = require('./lumibattle');                                        // mod names
const lumidungeon = require('./lumidungeon');                                      // environments, found names, _save

const TALES = path.join(__dirname, '..', 'data', 'tales');                         // src/lumi/data/tales
const dict = (obj) => Object.assign(Object.create(null), obj);                     // a lookup table with no prototype keys
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);     // Python isinstance(v, dict)

const MAX_LINE = 200;                                                              // characters; it must fit on a screen in large text
const PLACEHOLDERS = ['enemy', 'item', 'place'];                                   // names a line may use
const SCENARIOS = dict({                                                           // every scenario a line can be written for
  enter: 'Lumi has just arrived at {place} at the start of a trip.',
  start: 'Lumi is back at the room she came in by; the way home is here.',
  empty: 'Lumi steps into a room with nothing in it but atmosphere.',
  again: 'Lumi walks back through a room she has already seen.',
  treasure: 'Lumi finds {item} lying in the room.',
  key: 'Lumi finds a key.',
  vault: 'The locked vault is open and Lumi finds {item} inside.',
  locked_key: 'Lumi reaches a locked door that needs a key.',
  locked_puzzle: "Lumi reaches a door sealed by a puzzle. It could be any kind of puzzle, so the line mustn't say which.",
  game_cups: 'Three cups are set out; something is hidden under one.',
  game_match: 'Cards lie face down, waiting to be matched in pairs.',
  game_win: 'Lumi wins the little game and gets {item}.',
  game_lose: "Lumi doesn't win the little game, and gets {item} for trying.",
  enemy: 'A wild {enemy} blocks the way and a fight begins.',
  victory: 'Lumi has beaten the {enemy}, who scampers off.',
  fled: 'Lumi ran from the {enemy} back to the room before.',
  defeat: 'The {enemy} was too much; Lumi is carried home, and what she found is left behind.',
  stairs: 'Lumi finds stairs leading further down.',
  descend: 'Lumi goes down the stairs to a deeper floor.',
  home: 'Lumi walks out of {place} and home with everything she found.',
  abandon: 'Lumi gives up the trip and goes home, leaving what she found.',
  potion: 'Lumi drinks a potion and feels better.',
  look: "Lumi stops and looks closely at one small, charming detail of the room she is in. Any room: don't mention treasure, doors, enemies or puzzles.",
});
const FACTS = dict({                                                               // plain reports (facts, never a model's)
  runes_try: '{exact} in the right place (lit green), {near} right but in the wrong place (ringed gold).',
  runes_reset: 'The runes spin and settle on a new code. Try again from the start.',
  match_flip: 'One card turned. Now find its pair.',
  match_pair: 'A pair!',
  match_miss: 'Not a pair. They turn back over.',
  see_treasure: 'There is a chest here, shut tight and waiting.',
  see_key: 'Something small glints on the floor: a key.',
  see_vault: 'Inside the vault stands a great chest, bound in gold.',
});
const BRACES = /\{([\p{L}\p{N}_]*)\}/gu;                                           // the names inside {braces} (Python \w)

/** Refused; the message is safe to show. */
class TaleError extends LumiError {
  constructor(message) { super(400, 'tale_refused', message); this.name = 'TaleError'; } // 400 + the words
}

// erinne zlib.crc32 (unsigned), with a small fallback for an older Node.
function crc32(text) {
  const bytes = Buffer.from(text, 'utf8');                                         // UTF-8 like Python's .encode()
  if (typeof zlib.crc32 === 'function') return zlib.crc32(bytes) >>> 0;            // Node's own
  let crc = 0xffffffff;                                                            // the slow way
  for (const byte of bytes) {
    crc ^= byte;                                                                   // mix in a byte
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));  // eight shifts
  }
  return (crc ^ 0xffffffff) >>> 0;                                                 // finished, unsigned
}

// Python str.format(**names) for {name} placeholders (the library's lines only ever use known names).
function fill(template, names) {
  return template.replace(/\{([\p{L}\p{N}_]*)\}/gu, (whole, name) => (Object.prototype.hasOwnProperty.call(names, name) ? String(names[name]) : whole)); // swap each name
}

/** One line fit to show, or null: plain text, one line, 3-200 characters, only its scenario's placeholders (none if filled). */
function clean(text, scenario = null, { filled = false } = {}) {
  if (typeof text !== 'string') return null;                                       // not text
  const line = text.split(/\s+/u).filter(Boolean).join(' ').trim().replace(/^"+|"+$/gu, ''); // one tidy line, no outer quotes
  const length = [...line].length;                                                 // characters, as Python counts
  if (length < 3 || length > MAX_LINE || /[<>`\\]/u.test(line) || line.toLowerCase().includes('http')) return null; // markup, links, size
  const used = [...line.matchAll(BRACES)].map((m) => m[1]);                        // placeholders used
  const about = scenario && scenario in SCENARIOS ? SCENARIOS[scenario] : '';      // what the scenario may name
  const allowed = filled ? [] : PLACEHOLDERS.filter((p) => about.includes(`{${p}}`) || p === 'place'); // its names (place always)
  const count = (ch) => line.split(ch).length - 1;                                 // how many of a character
  if (used.some((name) => !allowed.includes(name)) || count('{') !== used.length || count('}') !== used.length) return null; // stray braces
  return line;                                                                     // fit to show
}

/** erinne load_library: {environment or 'default': {scenario: [lines]}}; a bad line stops the server at start. */
function loadLibrary(folder = TALES) {
  const library = Object.create(null);                                             // name -> lines
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.json')).sort();  // sorted *.json
  for (const file of files) {
    const name = file.slice(0, -5);                                                // its stem
    if (name !== 'default' && !(name in lumidungeon._ENVS)) throw new Error(`Lumi's tales: ${file} isn't named after an environment.`); // stray file
    const data = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));     // its lines
    if (!isObj(data)) throw new Error(`Lumi's tales: ${file} should be scenarios with lists of lines.`); // wrong shape
    for (const [scenario, lines] of Object.entries(data)) {
      if (!(scenario in SCENARIOS) || !Array.isArray(lines) || lines.some((line) => clean(line, scenario) !== line)) { // known scenario, clean lines
        throw new Error(`Lumi's tales: ${file} has a bad scenario or line under '${scenario}'.`); // refuse
      }
    }
    library[name] = data;                                                          // keep it
  }
  const def = library.default || {};                                              // the default library
  const keys = Object.keys(def).sort().join(',');                                  // its scenarios
  if (keys !== Object.keys(SCENARIOS).sort().join(',') || Object.values(def).some((lines) => !lines.length)) { // every scenario, a line each
    throw new Error("Lumi's tales: default.json needs at least one line for every scenario.");
  }
  return library;                                                                  // checked
}

const LIBRARY = loadLibrary();                                                     // tales/*.json (throws at start if broken)

// Native satchel coins as SGC words (party runs are paid under 'party', solo under 'dungeon').
function sgcWords(run, coins) {
  const party = Boolean(run && (run.party || Object.prototype.hasOwnProperty.call(run, 'vote_since'))); // a party trip (lumiparty.js runs have vote_since)
  return `${tuning.scalePayout(party ? 'party' : 'dungeon', 'win', coins)} SGC`;  // what it banks as
}

/** What was found, in words: "5 SGC, a potion and the Moon bell". */
function _item(loot, coins, run = null) {
  const found = { ...(loot || {}) };                                               // a copy
  if (coins !== undefined && coins !== null) found.coins = coins;                  // a game's or fight's coins
  const parts = [];                                                                // the words
  if (found.coins) parts.push(sgcWords(run, found.coins));                         // coins, as SGC
  if (found.potions) parts.push('a potion');                                       // a potion
  if (found.keys) parts.push('a key');                                             // a key
  if (found.trophy) parts.push('the ' + (lumidungeon.FOUND_NAMES[found.trophy] || 'trophy')); // something for the house
  if (found.mod) parts.push('a ' + (lumibattle._MODS[found.mod] ? lumibattle._MODS[found.mod].name : 'mystery') + ' mod'); // a dungeon mod
  if (parts.length > 1) return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]; // "a, b and c"
  return parts.length ? parts[0] : 'nothing much';                                 // one thing, or nothing
}

/** The names a line about this moment may use. */
function facts(run) {
  const event = run.event || {};                                                   // the moment
  return { place: lumidungeon._ENVS[run.env].name, enemy: event.enemy || 'creature', item: _item(event.loot, event.coins, run) }; // its names
}

// The environment's details to notice, and where this room starts among them (the same room, the same start).
function _details(run) {
  const own = LIBRARY[run.env] && LIBRARY[run.env].look;                           // the place's own details
  const lines = own && own.length ? own : LIBRARY.default.look;                    // or the default
  return [lines, crc32(`${run.id}:${run.depth}:${run.at}`)];                       // and a fixed start
}

/** What this room is like: its own detail, shown for as long as she stands in it. */
function scene(run) {
  const [lines, at] = _details(run);                                               // details + start
  return fill(lines[at % lines.length], facts(run));                               // this room's
}

// What a beaten creature left behind for the house, as words added after the moment's line ('' if nothing).
function _dropped(run) {
  const piece = run.event && run.event.dropped;                                    // a dropped piece?
  return piece ? ` It leaves something behind: the ${lumidungeon.FOUND_NAMES[piece] || 'treasure'}!` : ''; // say so
}

/** The library's line for what just happened in a run (the environment's own if it has one). */
function line(run, rng = null) {
  const dice = rng || lumibattle.systemRandom();                                   // secure by default
  const event = run.event || { scenario: 'empty' };                                // the moment
  const scenario = event.scenario;                                                 // which scenario
  const note = typeof event.note === 'string' && event.note ? ` ${event.note}` : ''; // a bank note (owed / capped), LumiBot's addition
  if (scenario in FACTS) {                                                         // a plain report
    const numbers = Object.fromEntries(Object.entries(event).filter(([, v]) => Number.isInteger(v))); // its numbers
    return fill(FACTS[scenario], numbers) + note;                                  // filled in
  }
  if (scenario === 'look') {                                                       // each look notices the next detail
    const [lines, at] = _details(run);                                             // details + start
    return fill(lines[(at + event.n) % lines.length], facts(run)) + note;          // the next one along
  }
  const own = LIBRARY[run.env] && LIBRARY[run.env][scenario];                      // the place's own lines
  const lines = own && own.length ? own : LIBRARY.default[scenario];               // or the default
  let told = fill(lines[dice.randrange(lines.length)], facts(run));                // one of them
  const won = _item(event.loot, event.coins, run);                                 // what was found
  const names = SCENARIOS[scenario].includes('{item}');                            // does the scenario name a find?
  if (names && !told.includes(won)) told = `${told} (${won}.)`;                    // always say what was found
  return told + _dropped(run) + note;                                              // plus a dropped piece and a bank note
}

/** erinne live_line: no live storyteller is set up in LumiBot, so there is never a fresh line (the library's stays). */
async function liveLine() {
  return null;                                                                     // erinne's answer with no storyteller
}

/** erinne remember: keep a told line with the run (the find is always told). Call inside db.tx(). */
function remember(userId, run, told) {
  const piece = run.event && run.event.dropped;                                    // a dropped piece?
  run.say = !piece || told.includes(lumidungeon.FOUND_NAMES[piece] || '') ? told : told + _dropped(run); // the line, with the find
  lumidungeon._save(userId, run);                                                  // keep it
}

module.exports = {
  MAX_LINE, PLACEHOLDERS, SCENARIOS, FACTS, TALES,  // constants
  TaleError,                                        // refusal
  clean, loadLibrary, LIBRARY,                      // the library
  _item, facts, _details, scene, _dropped, line,    // telling a moment
  liveLine, remember,                               // the (absent) live storyteller
  crc32,                                            // erinne's zlib.crc32
};
