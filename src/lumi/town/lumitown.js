'use strict';

/**
 * Who is in Lumi Town / Lumi City right now, and what they say there. Ported from erinne mnemerynne/lumitown.py.
 *
 * The town page tells the server where its Lumi stands every few seconds (POST /api/lumi-pet/town); the answer is
 * everyone else seen within SEEN_SECONDS, and the last few lines said where she is. All in memory: a restart just means
 * a few seconds until everyone has said where they are again. Someone with "Show me in town" off is never recorded.
 * Chat is ephemeral: the last LINES_KEPT lines of each place for LINE_SECONDS, never written to a database.
 * A line is typed text (cleaned) or one of the PHRASES. Rate limits use count() (erinne events.count).
 *
 * Lumi City: out in the city a Lumi is in a district ("down", "l3", "r2") at a point (x, y, facing); inside a building
 * she's in that place. Chat and emotes are heard in the same place only; people are SEEN within one block (near()).
 * User ids are Discord id STRINGS. Pages hear news on events channel CHANNEL ('town').
 */

const crypto = require('node:crypto');
const { nowMs } = require('../db');
const { monotonic } = require('../pet/lumihouse');

const SEEN_SECONDS = 20;              // a page that stopped asking drops out after this
const MAX_PEOPLE = 200;               // guard: never more than this many remembered at once
const CHANNEL = 'town';               // the events channel (CONTRACT section 9)
const TEXT_MAX = 140;                 // a typed line, at most (after cleaning)
const LINES_KEPT = 30;                // lines remembered per place
const LINE_SECONDS = 600;             // ...for ten minutes
const LINES_SHOWN = 8;                // how many a POST hands back
const SAY_GAP = 1.5;                  // one line per 1.5 s
const SAY_BURST = 10;                 // at most 10 lines...
const SAY_WINDOW = 30.0;              // ...in 30 s
const EMOTE_GAP = 1.0;                // one emote a second

// Quick phrases (id -> [icon, words]): chat without a keyboard; the words are only ever these.
const PHRASES = {
  hi: ['👋', 'Hi!'],
  hello: ['🏘', 'Hello, neighbour!'],
  play: ['🎮', 'Want to play together?'],
  follow: ['✨', 'Follow me!'],
  outfit: ['👗', 'I love your outfit!'],
  gg: ['🏆', 'Good game!'],
  brb: ['⏳', 'Back in a minute!'],
  bye: ['🌙', 'See you later!'],
  heart: ['💖', '💖'],
  laugh: ['😂', '😂'],
};

// Emotes (id -> [icon, words for the list]): a little animation everyone in the same place sees. Never stored.
const EMOTES = {
  wave: ['👋', 'Wave'],
  dance: ['💃', 'Dance'],
  hug: ['🤗', 'Hug'],
  jump: ['✨', 'Jump for joy'],
  heart: ['💖', 'Send a heart'],
  yawn: ['💤', 'Yawn'],
};

/** Where a line is heard: inside one place ("in:arcade"), or out in one district ("city:down", "city:l3"). */
function place(at, district, inside) {
  return inside ? `in:${at}` : `city:${district || 'down'}`;                        // erinne place()
}

/** A district's place along the city in blocks from Downtown: 0, -n for LefTown's block n, +n for Right-City's. */
function block(district) {
  if (!district || district === 'down') return 0;                                   // Downtown
  const n = parseInt(String(district).slice(1), 10);                                // "l3" -> 3
  if (!Number.isFinite(n)) return 0;                                                // (the route checks the pattern)
  return district[0] === 'l' ? -n : n;                                              // left is negative
}

/** Whether someone in place a sees someone in place b: the same place, or both out in the city at most a block apart. */
function near(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false; // nowhere
  if (a === b) return true;                                                         // the same place
  if (a.startsWith('city:') && b.startsWith('city:')) return Math.abs(block(a.slice(5)) - block(b.slice(5))) <= 1; // a block either side
  return false;                                                                     // inside somewhere else
}

/** Where each person was last seen, and what's been said where (erinne class Town). */
class Town {
  constructor(clock = monotonic) {
    this.clock = clock;                                                             // seconds; tests pass their own
    this.people = new Map();                                                        // uid -> {at, inside, district, x, y, face, seen}
    this.lines = new Map();                                                         // place -> [[t, line], ...] (oldest first)
  }

  // Forget people who stopped asking.
  _sweep(now) {
    for (const [uid, p] of this.people) if (now - p.seen >= SEEN_SECONDS) this.people.delete(uid); // gone quiet
  }

  /**
   * This person's Lumi is near `at` in `district` (or inside `at`), standing at x, y, facing. Returns "moved" for a new
   * place, "walk" for a step in the same place, null when nothing changed (or the town is full).
   */
  visit(userId, at, district = null, inside = false, x = null, y = null, face = 1) {
    const now = this.clock();                                                       // one clock reading
    this._sweep(now);                                                               // tidy
    userId = String(userId);                                                        // id string
    const was = this.people.get(userId);                                            // where she was
    if (!was && this.people.size >= MAX_PEOPLE) return null;                        // full: not recorded
    this.people.set(userId, { at, inside: Boolean(inside), district: district || null, x, y, face, seen: now }); // remember
    if (!was || place(was.at, was.district, was.inside) !== place(at, district, inside)) return 'moved'; // somewhere new
    if (was.x !== x || was.y !== y || was.face !== face || was.at !== at) return 'walk'; // a step
    return null;                                                                    // nothing new
  }

  /** Forget this person (Show me in town off). True when they were here. */
  leave(userId) {
    return this.people.delete(String(userId));                                      // true if removed
  }

  /** Everyone seen lately except `but`, most recent first; `around` (a place) limits to who someone there can see. */
  here(but = null, around = null) {
    this._sweep(this.clock());                                                      // tidy
    const skip = but === null || but === undefined ? null : String(but);            // who to leave out
    return [...this.people.entries()]
      .filter(([uid, p]) => uid !== skip && (around === null || around === undefined || near(around, place(p.at, p.district, p.inside)))) // in view
      .sort((a, b) => b[1].seen - a[1].seen)                                        // most recently seen first
      .map(([uid, p]) => ({ id: uid, at: p.at, inside: p.inside, district: p.district, x: p.x, y: p.y, face: p.face })); // public fields
  }

  /** The place this person is in now, or null. */
  where(userId) {
    this._sweep(this.clock());                                                      // tidy
    const p = this.people.get(String(userId));                                      // their spot
    return p ? place(p.at, p.district, p.inside) : null;                            // the place id
  }

  /** When this person last said where they are in town (this clock), or null. */
  seenAt(userId) {
    this._sweep(this.clock());                                                      // tidy
    const p = this.people.get(String(userId));                                      // their spot
    return p ? p.seen : null;                                                       // seconds
  }

  /** Remember a line in its place (line.place). */
  said(line) {
    let kept = this.lines.get(line.place);                                          // that place's lines
    if (!kept) { kept = []; this.lines.set(line.place, kept); }                     // a new place
    kept.push([this.clock(), line]);                                                // with the time
    while (kept.length > LINES_KEPT) kept.shift();                                  // deque(maxlen=30)
    if (this.lines.size > 2000) this.lines.delete(this.lines.keys().next().value);  // guard: forget the oldest place
  }

  /** The last `count` lines said in a place within LINE_SECONDS, oldest first. */
  recent(where, count = LINES_SHOWN) {
    const now = this.clock();                                                       // one clock reading
    const kept = this.lines.get(where);                                             // that place's lines
    if (!kept || !kept.length) return [];                                           // nothing said
    while (kept.length && now - kept[0][0] >= LINE_SECONDS) kept.shift();           // the old ones fall away
    return kept.slice(-count).map(([, line]) => line);                              // the last few
  }
}

/**
 * Typed words made safe to show: control and format characters gone, runs of spaces made one, trimmed.
 * Empty or too long (over TEXT_MAX characters) throws an Error with words for the person.
 */
function clean(text) {
  const kept = [...String(text)].map((ch) => (/\s/u.test(ch) ? ' ' : ch)).filter((ch) => ch === ' ' || !/\p{C}/u.test(ch)).join(''); // whitespace -> space; no control/format chars
  const words = kept.replace(/\s+/gu, ' ').trim();                                  // one space between words
  if (!words) throw new Error('Say something first!');                              // nothing left
  if ([...words].length > TEXT_MAX) throw new Error(`That's a lot to say at once! Keep it to ${TEXT_MAX} characters.`); // too long
  return words;                                                                     // clean words
}

/** A line to say: typed `text` (cleaned) or a `phrase` id. Throws an Error when it can't be said. */
function line(userId, name, lumi, where, { text = null, phrase = null } = {}) {
  let words;                                                                        // what is said
  if (phrase !== null && phrase !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(PHRASES, phrase)) throw new Error("That isn't one of the phrases."); // known phrases only
    words = PHRASES[phrase][1];                                                     // its words
  } else if (text !== null && text !== undefined) {
    words = clean(text);                                                            // typed words, cleaned
  } else {
    throw new Error('Say something first!');                                        // neither
  }
  return { id: crypto.randomBytes(6).toString('hex'), uid: String(userId), name, lumi, place: where, text: words, phrase: phrase === undefined ? null : phrase, at: nowMs() }; // erinne's line shape
}

/** The emotes for the page's list: [{id, icon, text}]. */
function emotes() {
  return Object.entries(EMOTES).map(([id, [icon, text]]) => ({ id, icon, text }));  // list form
}

/** The quick phrases for the page's list: [{id, icon, text}]. */
function phrases() {
  return Object.entries(PHRASES).map(([id, [icon, text]]) => ({ id, icon, text })); // list form
}

// erinne events.count(key, window): add one to a fixed-window counter and return it (the window starts at its first one).
const counters = new Map();                                                         // key -> {n, ends}
function count(key, windowSeconds, clock = monotonic) {
  const now = clock();                                                              // seconds
  let c = counters.get(key);                                                        // this key's counter
  if (!c || c.ends <= now) c = { n: 0, ends: now + windowSeconds };                 // a fresh window
  c.n += 1;                                                                         // one more
  counters.set(key, c);                                                             // remember
  if (counters.size > 20_000) {                                                     // guard: drop finished windows
    for (const [k, v] of counters) if (v.ends <= now) counters.delete(k);           // expired ones
  }
  return c.n;                                                                       // how many in this window
}

/** Tests: forget every rate-limit counter. */
function resetCounters() {
  counters.clear();                                                                 // a clean slate
}

// erinne web/games.py _look / _forget_look: a Lumi's look kept LOOK_SECONDS, so the walkers' frequent POSTs don't read
// every save every time. Her own act forgets hers at once, so a new outfit shows straight away.
const LOOK_SECONDS = 10.0;                                                          // reuse a look this long
const looks = new Map();                                                            // uid -> [when, look]

/** save.look(uid), cached for LOOK_SECONDS. */
function lookOf(uid, clock = monotonic) {
  const id = String(uid);                                                           // id string
  const kept = looks.get(id);                                                       // cached?
  if (kept && clock() - kept[0] < LOOK_SECONDS) return kept[1];                     // still fresh
  if (looks.size > 1000) looks.clear();                                             // guard: never more than a town's worth
  const look = require('../pet/save').look(id);                                     // read her save
  looks.set(id, [clock(), look]);                                                   // keep it
  return look;                                                                      // her look
}

/** Her look changed (or may have): read it afresh next time. */
function forgetLook(uid) {
  looks.delete(String(uid));                                                        // gone from the cache
}

const TOWN = new Town();                                                            // the one in this process

module.exports = {
  SEEN_SECONDS, MAX_PEOPLE, CHANNEL, TEXT_MAX, LINES_KEPT, LINE_SECONDS, LINES_SHOWN, SAY_GAP, SAY_BURST, SAY_WINDOW,
  EMOTE_GAP, PHRASES, EMOTES,                                                       // constants
  Town, TOWN, place, block, near, clean, line, emotes, phrases, count, resetCounters, // the API
  LOOK_SECONDS, lookOf, forgetLook,                                                 // the look cache
};
