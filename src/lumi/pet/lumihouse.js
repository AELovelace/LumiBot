'use strict';

/**
 * Visiting each other's flats, ported from erinne mnemerynne/lumihouse.py (commit 0ddc466).
 *
 * Someone's flat is their Lumi Pet room mode (kitchen, bedroom, den), drawn from their own save (lumipet.houseView)
 * for a visitor whose own Lumi walks around in it. Nothing a visitor does touches the host's save.
 * Who may come in is the host's front door (save.door): "open" (anyone walks in), "knock" (the default: the host, who
 * must be home, lets them in or not) or "closed"; and nobody on the host's block list, ever. Letting someone in gives
 * them a PASS for PASS_SECONDS. Closing the door, or blocking someone, sends guests home at once (sendHome).
 *
 * All in memory (like lumitown.js): who's in which flat and where (`visit`, refreshed every few seconds by each page),
 * knocks waiting (KNOCK_SECONDS), and passes. A restart means a moment until everyone says where they are again.
 * A house on a Lumi City plot is a second home with the same rooms: place() is "home:<host>:<room>" for it and
 * "house:<host>:<room>" for the flat, so the two homes' folk never mix. User ids are Discord id STRINGS.
 */

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const SEEN_SECONDS = 20;              // a page that stopped saying where it is has left
const KNOCK_SECONDS = 60;             // a knock nobody answers is forgotten after this
const PASS_SECONDS = 3 * 3600;        // someone let in may stay, or come back, for three hours
const MAX_PEOPLE = 200;               // guard: never more than this many remembered at once
const MAX_KNOCKS = 200;               // guard: knocks at once
const ROOMS = ['kitchen', 'bedroom', 'den']; // room-ui.js ROOMS
const HOMES = ['flat', 'house'];      // her flat in Lumi Heights, and her house on a Lumi City plot

/** A monotonic clock in seconds (erinne time.monotonic). */
function monotonic() {
  return performance.now() / 1000;                                                  // seconds since the process started
}

/** Where a line said in someone's home is heard: one room of their flat, or of their house on a plot. */
function place(host, room, home = 'flat') {
  return home === 'flat' ? `house:${host}:${room}` : `home:${host}:${room}`;        // erinne's two prefixes
}

/** Who is in which flat, knocks, and passes (erinne class Houses). */
class Houses {
  constructor(clock = monotonic) {
    this.clock = clock;                                                             // seconds; tests pass their own
    this.people = new Map();                                                        // uid -> {host, room, home, x, y, face, seen}
    this.knocks = new Map();                                                        // id -> {id, guest, host, at, answer}
    this.passes = new Map();                                                        // "host|guest" -> until
  }

  // Forget people who stopped asking, knocks too old, and passes run out.
  _sweep(now) {
    for (const [uid, p] of this.people) if (now - p.seen >= SEEN_SECONDS) this.people.delete(uid); // gone quiet
    for (const [id, k] of this.knocks) if (now - k.at >= KNOCK_SECONDS) this.knocks.delete(id);    // unanswered too long
    for (const [key, until] of this.passes) if (until <= now) this.passes.delete(key);              // pass expired
  }

  /** This person's Lumi stands at x, y in a room of host's home now. True when that's somewhere new. */
  visit(userId, host, room, x, y, face, home = 'flat') {
    const now = this.clock();                                                       // one clock reading
    this._sweep(now);                                                               // tidy first
    userId = String(userId); host = String(host);                                   // ids as strings
    const was = this.people.get(userId);                                            // where she was
    if (!was && this.people.size >= MAX_PEOPLE) return false;                       // full: not recorded
    this.people.set(userId, { host, room, home, x, y, face, seen: now });           // remember
    return !was || was.host !== host || was.room !== room || was.home !== home;     // somewhere new?
  }

  /** Forget this person. True when they were here. */
  leave(userId) {
    return this.people.delete(String(userId));                                      // true if removed
  }

  /** The place (one room of one home) this person is in now, or null. */
  where(userId) {
    this._sweep(this.clock());                                                      // tidy
    const p = this.people.get(String(userId));                                      // their spot
    return p ? place(p.host, p.room, p.home) : null;                                // the place id
  }

  /** When this person last said where they are in a flat (this clock), or null. */
  seenAt(userId) {
    this._sweep(this.clock());                                                      // tidy
    const p = this.people.get(String(userId));                                      // their spot
    return p ? p.seen : null;                                                       // seconds
  }

  /** Everyone in host's homes now (except `but`): [{id, room, home, x, y, face}]; `home` limits to one home. */
  inside(host, but = null, home = null) {
    this._sweep(this.clock());                                                      // tidy
    host = String(host);                                                            // id string
    const out = [];                                                                 // who's in
    for (const [uid, p] of this.people) {
      if (p.host === host && uid !== (but === null ? null : String(but)) && (home === null || p.home === home)) {
        out.push({ id: uid, room: p.room, home: p.home, x: p.x, y: p.y, face: p.face }); // one person
      }
    }
    return out;                                                                     // the list
  }

  /** Whether the host is in their own home now (either one, or `home`). */
  home(host, home = null) {
    this._sweep(this.clock());                                                      // tidy
    const p = this.people.get(String(host));                                        // the host's spot
    return Boolean(p) && p.host === String(host) && (home === null || p.home === home); // at home?
  }

  /** A knock on host's door (one at a time per guest and door: a second knock is the same one). */
  knock(guest, host) {
    const now = this.clock();                                                       // one clock reading
    this._sweep(now);                                                               // tidy
    guest = String(guest); host = String(host);                                     // ids as strings
    for (const k of this.knocks.values()) {
      if (k.guest === guest && k.host === host && k.answer === null) return { ...k }; // already knocking
    }
    if (this.knocks.size >= MAX_KNOCKS) throw new Error('The town is very busy. Try knocking again in a moment.'); // guard
    const k = { id: crypto.randomBytes(6).toString('hex'), guest, host, at: now, answer: null }; // a new knock
    this.knocks.set(k.id, k);                                                       // remember it
    return { ...k };                                                                // a copy
  }

  /** A knock by id (a copy), or null. */
  knockOf(knockId) {
    this._sweep(this.clock());                                                      // tidy
    const k = this.knocks.get(String(knockId));                                     // the knock
    return k ? { ...k } : null;                                                     // copy or null
  }

  /** The knocks on host's door still waiting, oldest first. */
  waiting(host) {
    this._sweep(this.clock());                                                      // tidy
    return [...this.knocks.values()].filter((k) => k.host === String(host) && k.answer === null) // unanswered at this door
      .sort((a, b) => a.at - b.at).map((k) => ({ ...k }));                          // oldest first, copies
  }

  /** The host answers a knock on their own door; yes gives a pass. Throws (code 'gone') when there's no such knock. */
  answer(knockId, host, yes) {
    const now = this.clock();                                                       // one clock reading
    this._sweep(now);                                                               // tidy
    const k = this.knocks.get(String(knockId));                                     // the knock
    if (!k || k.host !== String(host)) {
      const error = new Error('That knock has gone: they may have wandered off.');  // erinne LookupError
      error.code = 'gone';                                                          // the route answers 404
      throw error;
    }
    k.answer = Boolean(yes);                                                        // the answer
    if (yes) this.passes.set(`${k.host}|${k.guest}`, now + PASS_SECONDS);           // a pass for three hours
    return { ...k };                                                                // a copy
  }

  /** Whether the host has let this guest in lately (an unexpired pass). */
  letIn(host, guest) {
    this._sweep(this.clock());                                                      // tidy
    return this.passes.has(`${host}|${guest}`);                                     // a live pass?
  }

  /** The door shut (guest null: everyone) or one guest blocked: passes and knocks go; those inside leave. Returns who must go. */
  sendHome(host, guest = null) {
    this._sweep(this.clock());                                                      // tidy
    host = String(host);                                                            // id string
    const g = guest === null || guest === undefined ? null : String(guest);         // one guest or everyone
    const gone = [];                                                                // who must leave
    for (const [uid, p] of this.people) {
      if (p.host === host && uid !== host && (g === null || g === uid)) { gone.push(uid); } // a guest in her home
    }
    for (const uid of gone) this.people.delete(uid);                                // out they go
    for (const key of [...this.passes.keys()]) {
      const [h, who] = key.split('|');                                              // host|guest
      if (h === host && (g === null || g === who)) this.passes.delete(key);         // their pass goes
    }
    for (const [id, k] of this.knocks) if (k.host === host && (g === null || g === k.guest)) this.knocks.delete(id); // and their knocks
    return gone;                                                                    // their pages hear "home"
  }
}

/** May guest come into host's flat? "own", "in" (open door, or let in), "knock", or "closed" (closed door or blocked). */
function access(door, blocked, host, guest, passes) {
  host = String(host); guest = String(guest);                                       // ids as strings
  if (guest === host) return 'own';                                                 // her own
  if ((blocked || []).map(String).includes(guest) || door === 'closed') return 'closed'; // a block looks like a closed door
  if (door === 'open' || passes.letIn(host, guest)) return 'in';                    // walk in
  return 'knock';                                                                   // knock first
}

const HOUSES = new Houses();                                                        // the one in this process

module.exports = {
  SEEN_SECONDS, KNOCK_SECONDS, PASS_SECONDS, MAX_PEOPLE, MAX_KNOCKS, ROOMS, HOMES, // constants
  place, Houses, access, HOUSES, monotonic,                                         // the API
};
