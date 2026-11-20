'use strict';

/**
 * Lumi Dungeons with friends (port of erinne mnemerynne/lumiparty.py @ 0ddc466): a party of up to three people, each
 * with their own Lumi, on one shared floor. Online only here (erinne's couch/TV mode is not ported: LUMI_FLAGS.tvPlay
 * is false), so every member plays from their own page.
 *
 * - Direction and other party choices are VOTES (a majority settles it at once; otherwise VOTE_SECONDS after the first
 *   vote the most votes win, a tie goes to the dice; everyone voting with no majority is settled at once too).
 * - A PUZZLE is taken one member at a time, in a circle the party votes the start of.
 * - A FIGHT is one co-op fight for the whole party (lumibattle.team_*), kept in the party (run.fight).
 * - Each member's finds go in their own satchel, and only count once the party walks out together. Coins are paid once
 *   per member with sgc.pay(..., 'party', 'win', 'lumi-party:<code>:<trip>:<user>').
 *
 * The party is one JSON document in lumi_parties; members are indexed in lumi_party_members. Who is still there lives
 * in memory (lobby.PRESENCE). Streams listen on events channel `party:<code>` (erinne's showdown.Hub wake). Times are
 * milliseconds (db.nowMs). User ids are Discord id strings. Every function that writes must run inside db.tx().
 * The Python `conn` argument is dropped everywhere: the economy DB comes from db.getDb().
 */

const crypto = require('node:crypto');                      // the system dice + party codes
const db = require('../db');                                // getDb, tx, nowMs
const { LumiError } = require('../errors');                 // the refusal type the router understands
const sgc = require('../sgc');                              // the only door to coins
const save = require('../pet/save');                        // Lumi Pet's save (load/save)
const events = require('../events');                       // live updates for the party's streams

// Dependencies ported in parallel by other agents. Required lazily (erinne imported lumipet/lumitales late too): it
// avoids require cycles (lumipet -> lumiparty -> lumibattle -> ...) and lets this file load before they exist.
const D = () => require('../dungeon/lumidungeon');          // floors, puzzles, loot (erinne lumidungeon)
const B = () => require('../dungeon/lumibattle');           // stats, the co-op fight (erinne lumibattle)
const T = () => require('../dungeon/lumitales');            // the story library (erinne lumitales)
const L = () => require('../arcade/lobby');                 // lobby.PRESENCE: who is still there (erinne lobby)

const MAX_MEMBERS = 3;                                      // a party is at most three
const VOTE_SECONDS = 20;                                    // after the first vote, the most votes win
const LIMITS = { sokoban: ['seconds', 180], lights: ['seconds', 120], runes: ['guesses', 3], match: ['flips', 6] }; // one attempt's limit per puzzle
const HOLDER_QUIET = 30;                                    // seconds a puzzle holder may go unheard before their attempt fails
const FIGHT_QUIET = 60;                                     // seconds an (old-style) fighter may go unheard before it counts as run from
const TURN_SECONDS = 45;                                    // a co-op fight turn left this long is braced through
const AWAY_SECONDS = 8;                                     // unheard this long: shown as away
const IDLE_MS = 2 * 3600 * 1000;                            // a party nobody has changed in this long breaks up
const LOG = 12;                                             // story lines a trip keeps
const WAYS = ['n', 'e', 's', 'w'];                          // the four ways out of a room
const WORDS = { n: 'north', e: 'east', s: 'south', w: 'west', descend: 'the stairs down', home: 'home', back: 'a step back from the door' }; // votes in words
const PUZZLE_NAMES = { sokoban: 'crates', lights: 'lamps', runes: 'runes', match: 'cards', cups: 'cups' }; // puzzles in words
const BROKEN_UP = 'This party has broken up. Start a new one, or join another.'; // the 404 words
const CODES = { 400: 'party_refused', 403: 'forbidden', 404: 'not_found' };      // LumiError code per status

/** erinne PartyError: refused; the message is safe to show. A LumiError, so the router answers it as JSON. */
class PartyError extends LumiError {
  constructor(message, status = 400) {
    super(status, CODES[status] || 'party_refused', message); // status + code + words
    this.name = 'PartyError';                                 // shows in logs
  }
}

// ------------------------------------------------------------------------------------------------ small helpers
/** The system dice (erinne random.SystemRandom): a callable rng() -> [0,1) that also has randrange/random/choice. */
function _systemRandom() {
  const rng = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;                   // a float in [0, 1) (48 random bits; randomInt's range tops out at 2**48 - 1)
  rng.random = rng;                                                                        // Python's rng.random()
  rng.randrange = (a, b) => (b === undefined ? crypto.randomInt(0, a) : crypto.randomInt(a, b)); // Python's randrange(n) / (a, b)
  rng.randint = (a, b) => crypto.randomInt(a, b + 1);                                      // Python's randint (inclusive)
  rng.choice = (seq) => seq[rng.randrange(seq.length)];                                   // Python's choice
  return rng;                                                                              // the dice
}

/** JSON with sorted keys (Python json.dumps(sort_keys=True)), to tell whether an action changed anything. */
function _canon(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) // a plain object...
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))                    // ...with its keys sorted
    : v));                                                                                 // anything else as is
}

/** Python round(): halves go to the even neighbour (round(2.5) == 2). */
function _pyRound(x) {
  const r = Math.round(x);                                                                 // JS rounds halves up
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;                               // a half on an odd result: step down to even
}

/** A dict-like lookup that works whether a dependency ported a dict as an object or a Map. */
function _get(table, key) {
  if (!table) return undefined;                                                            // no table
  return table instanceof Map ? table.get(key) : table[key];                               // Map or object
}

/** The keys of a dict-like (object or Map). */
function _keys(table) {
  if (!table) return [];                                                                   // no table
  return table instanceof Map ? [...table.keys()] : Object.keys(table);                    // Map or object keys
}

const _same = (a, b) => a !== null && a !== undefined && String(a) === String(b);         // ids compare as strings

// ------------------------------------------------------------------------------------------------ saved
/** The key lobby.PRESENCE files this party's members under (erinne used the tuple ("lumi-party", code)). */
function _table(code) {
  return `lumi-party:${code}`;                                                             // one string key per party
}

/** Who to ask lobby.PRESENCE about: the member's own page (couch members are not ported). */
function _actor(member) {
  return `user:${member.user}`;                                                            // erinne's online actor
}

/** Seconds since this member was last heard from at this party (0 while a stream is open). */
function _quiet(state, member) {
  return Number(L().PRESENCE.quietFor(_table(state.code), _actor(member))) || 0;           // lobby.PRESENCE.quiet_for
}

/** The saved party (404 PartyError if it has broken up). */
function _read(code) {
  const key = String(code || '').toUpperCase().slice(0, 16);                               // codes are upper case, short
  const row = db.getDb().prepare('SELECT state FROM lumi_parties WHERE code = ?').get(key); // the row
  if (!row) throw new PartyError(BROKEN_UP, 404);                                          // gone
  return JSON.parse(row.state);                                                            // the party document
}

/** Write the party back (its story trimmed to LOG lines). */
function _write(state, now) {
  if (state.run) state.run.log = state.run.log.slice(-LOG);                                // keep the last lines only
  db.getDb().prepare('UPDATE lumi_parties SET state = ?, updated_at = ? WHERE code = ?')
    .run(JSON.stringify(state), now / 1000, state.code);                                   // unix seconds, like erinne
}

/** The party this person is in, if any (its code, or null). */
function codeOf(userId) {
  const row = db.getDb().prepare('SELECT code FROM lumi_party_members WHERE user_id = ?').get(String(userId)); // their row
  return row ? row.code : null;                                                            // code or nothing
}

/** The party this person is in, as saved (null if they aren't in one). A stale member row is tidied away. */
function mine(userId) {
  const code = codeOf(userId);                                                             // which party
  if (code === null) return null;                                                          // none
  try {
    return _read(code);                                                                    // the party
  } catch (error) {
    if (!(error instanceof PartyError)) throw error;                                       // a real bug: let it out
    db.getDb().prepare('DELETE FROM lumi_party_members WHERE user_id = ?').run(String(userId)); // the party is gone: forget the row
    return null;                                                                           // not in one
  }
}

/** The party, if this person is out on a party trip right now (their Lumi is in the party's dungeon). */
function onTrip(userId) {
  const state = mine(userId);                                                              // their party
  return state && state.phase === 'trip' ? state : null;                                   // only while out
}

/** A member of the party by account id (or null). */
function memberOf(state, userId) {
  return state.members.find((m) => _same(m.user, userId)) || null;                         // compare as strings
}

/** An empty satchel. */
function _bag() {
  return { coins: 0, potions: 0, trophies: [], mods: [] };                                 // native coins, potions, finds
}

/** Now, in ms (tests fake it with db.setClock). */
function _ms() {
  return db.nowMs();                                                                       // erinne lumipet.now_ms
}

// ------------------------------------------------------------------------------------------------ joining
/** A member's Lumi, caught up (inside tx). */
function _pet(userId, now) {
  return save.load(String(userId), { now });                                               // erinne lumipet.load
}

/** Save a member's Lumi. */
function _savePet(userId, pet) {
  save.save(String(userId), pet);                                                          // erinne lumipet._save
}

/** Refuse if this person's Lumi can't join a party: in another party, on her own trip, in a fight, or napping. */
function _canGo(userId, pet, now, code = null) {
  const other = codeOf(userId);                                                            // their party, if any
  if (other !== null && other !== code) throw new PartyError("You're already in a party. Leave it first."); // in another
  const run = D().current(String(userId));                                                 // a solo dungeon run?
  if (run && !run.over) throw new PartyError('Your Lumi is out exploring on her own. Bring her home first.'); // out alone
  if (B().current(String(userId))) throw new PartyError('Your Lumi is in the middle of a fight. Finish it first.'); // fighting
  if ((pet.faint_until || 0) > now) throw new PartyError('Your Lumi is still napping off her last fight.'); // fainted
}

/** How a member's Lumi looks to the others: her name, her own colour and what she wears. */
function _looks(pet) {
  return { pet: pet.name || 'Lumi', colour: pet.colour === undefined ? null : pet.colour, outfit: { ...(pet.outfit || {}) } }; // name, colour, outfit
}

/** A new member, with their Lumi's numbers as she is now (refreshed again when the party sets out). */
function _member(userId, name, pet) {
  const numbers = B().stats(pet);                                                          // her stats
  return {
    user: String(userId), name, remote: null, ready: false, level: pet.level, glow: pet.glow, // who + lobby state
    ..._looks(pet),                                                                         // her look
    hp: B().health(pet), hpMax: numbers.hp, mp: numbers.mp, mpMax: numbers.mp,              // her bars
    owned: [...(pet.decor || [])], mods: [...(pet.mods_owned || [])],                       // what loot rolls must not give twice
    satchel: _bag(), fight: null, fought: null, fainted: false, puzzles: 0, vote: null, ended: null, // trip state
  };
}

/** A new party with this person as its first member and host. Call inside a transaction. */
function create(userId, name, now = _ms()) {
  const code = L().newCode('lumi_parties');                                                // its code (lobby.new_code)
  let state = { code, mode: 'online', display: null, screen: '', host: null, phase: 'lobby', // erinne's shape
    env: null, members: [], run: null, last: null, revision: 1, inputs: [], changed: now }; // (display/screen/inputs: couch, unused)
  db.getDb().prepare('INSERT INTO lumi_parties (code, state, updated_at) VALUES (?, ?, ?)')
    .run(code, JSON.stringify(state), now / 1000);                                         // the row
  state = _join(state, userId, name, now);                                                 // the creator joins
  _write(state, now);                                                                      // save with them in it
  return state;                                                                            // the new party
}

/** Join (in the lobby only, while there's room). */
function _join(state, userId, name, now) {
  if (memberOf(state, userId)) return state;                                               // already here (another device)
  if (state.phase !== 'lobby') throw new PartyError('This party has already set out. Catch them next time!'); // too late
  if (state.members.length >= MAX_MEMBERS) throw new PartyError(`A party is at most ${MAX_MEMBERS}. This one is full.`); // full
  const pet = _pet(userId, now);                                                           // their Lumi
  _canGo(userId, pet, now, state.code);                                                    // free to come?
  state.members.push(_member(userId, name, pet));                                          // seat them
  db.getDb().prepare('INSERT OR REPLACE INTO lumi_party_members (user_id, code) VALUES (?, ?)').run(String(userId), state.code); // index row
  if (state.host === null) state.host = String(userId);                                    // first one hosts
  _note(state, `${name} joins the party.`);                                                // tell the party
  return state;                                                                            // changed in place
}

/** A member goes. On a trip that's giving up: their satchel stays behind, their bruises go home with them. */
function _leave(state, member, now) {
  const run = state.phase === 'trip' ? state.run : null;                                   // out on a trip?
  let handedOn = false;                                                                    // did a puzzle pass on?
  if (run) {
    const pet = _pet(member.user, now);                                                    // their Lumi
    if (member.fight) _endFightRow(member.user, member.fight);                             // an old-style fight: run from
    const seat = _seat(run, member.user);                                                  // in the co-op fight?
    if (seat !== null) {                                                                   // out of it: her Lumi leaves with her
      member.hp = Math.max(0, run.fight.lumis[seat].hp) || member.hp;                      // her health as it is now
      B().teamDrop(run.fight, seat, _systemRandom());                                      // lumibattle.team_drop
    }
    B().hurt(pet, member.fainted ? 0 : member.hp);                                         // bruises go home
    _savePet(member.user, pet);                                                            // save her
    const puzzle = run.puzzle;                                                             // a puzzle going on?
    if (puzzle && puzzle.order.includes(member.user)) {
      const at = puzzle.order.indexOf(member.user);                                        // their place in the circle
      const wasHolder = _same(holder(state), member.user);                                 // were they holding it?
      puzzle.order.splice(at, 1);                                                          // out of the circle
      if (puzzle.order.length && puzzle.phase === 'attempt') {
        if (at < puzzle.turn) {
          puzzle.turn -= 1;                                                                // the circle closes up behind them
        } else if (wasHolder) {
          puzzle.turn = at % puzzle.order.length;                                          // the next one carries on
          handedOn = true;                                                                 // remember to start their attempt
        }
      }
    }
  }
  state.members.splice(state.members.indexOf(member), 1);                                  // gone from the party
  db.getDb().prepare('DELETE FROM lumi_party_members WHERE user_id = ?').run(String(member.user)); // free to join another
  if (handedOn) {
    _beginAttempt(state, now);                                                             // the next holder's attempt
    _note(state, `${member.name} has gone home. ` + _turnWords(state));                    // say whose turn
  }
  _afterLeave(state, member, now);                                                         // host, empty trip, fights
}

/** After a member left: a new host if needed, and the trip/fight catch up. */
function _afterLeave(state, member, now) {
  _note(state, `${member.name} heads home.`);                                              // tell the others
  if (_same(state.host, member.user)) state.host = state.members.length ? state.members[0].user : null; // next host
  if (state.phase === 'trip' && state.run) {
    if (!state.members.length) {
      state.phase = 'lobby';                                                               // nobody left on the trip
      state.run = null;                                                                    // it's over
    } else if (state.run.fight && state.run.fight.outcome) {
      _teamEnd(state, now, _systemRandom());                                               // their leaving ended the fight
    } else {
      _settleFights(state, now, _systemRandom());                                          // may finish an old-style fight room
    }
  }
}

/** Close a member's (old-style) fight row as run from. */
function _endFightRow(userId, battleId) {
  db.getDb().prepare("UPDATE lumi_battles SET status = 'ran' WHERE id = ? AND user_id = ? AND status = 'active'")
    .run(battleId, String(userId));                                                        // only an active one of theirs
}

// ------------------------------------------------------------------------------------------------ the lobby
/** Where this party may go: what its lowest-levelled Lumi has opened. */
function _openEnvs(state) {
  const level = state.members.length ? Math.min(...state.members.map((m) => m.level)) : 1; // the lowest level
  return D().CATALOG.environments.map((env) => ({                                           // every place...
    id: env.id, name: env.name, family: env.family, about: env.about, opens: env.opens, palette: env.palette, // ...its card
    open: level >= env.opens,                                                              // ...open to everyone here?
  }));
}

/** Everyone is ready: make the floor and go. Each Lumi sets out as hurt as she is. */
function _setOut(state, now, rng) {
  if (state.members.length < 2) throw new PartyError('A party needs at least two. Share the code: ' + state.code + '.'); // too few
  if (!state.members.every((m) => m.ready)) throw new PartyError('Not everyone is ready yet.'); // someone isn't ready
  const envs = _openEnvs(state).filter((e) => e.open);                                     // places everyone has opened
  const env = envs.some((e) => e.id === state.env) ? state.env : envs[0].id;               // the host's pick, or the first
  for (const m of state.members) {
    const pet = _pet(m.user, now);                                                         // her save
    if (pet.task) throw new PartyError(`${m.name}'s Lumi is busy ${pet.task.kind === 'nap' ? 'napping' : 'playing'}.`); // busy
    _canGo(m.user, pet, now, state.code);                                                  // free to go?
    const fresh = _member(m.user, m.name, pet);                                            // her numbers now
    for (const k of ['level', 'glow', 'pet', 'colour', 'outfit', 'hp', 'hpMax', 'mp', 'mpMax', 'owned', 'mods']) m[k] = fresh[k]; // refresh them
    Object.assign(m, { satchel: _bag(), fight: null, fought: null, fainted: false, puzzles: 0, vote: null, ended: null }); // a clean trip
    pet.rest = 'awake';                                                                    // a trip wakes her
    pet.restUntil = now + 15 * 60_000;                                                     // (lumipet.AWAKE_MS)
    _savePet(m.user, pet);                                                                 // save her
  }
  const floor = D().generate(env, 1, rng, { decor: [], mods_owned: [] });                  // the first floor
  state.env = env;                                                                         // where
  state.phase = 'trip';                                                                    // out exploring
  state.last = null;                                                                       // forget the last trip
  state.run = { id: now, env, depth: 1, rooms: floor.rooms, at: floor.start, prev: null,  // the trip
    facing: null, keys: 0, tales: {}, log: [], event: { scenario: 'enter' }, say: '',
    scene: '', over: null, ended: null, vote_since: null, puzzle: null, fighting: false };
  _narrate(state, rng);                                                                    // the first line
}

// ------------------------------------------------------------------------------------------------ votes
/** What the party may vote for right now. */
function options(state) {
  const run = state.run;                                                                   // the trip
  if (state.phase !== 'trip' || !run || run.fighting) return [];                           // nothing to vote on
  const room = run.rooms[run.at];                                                          // where they stand
  const puzzle = run.puzzle;                                                               // a puzzle here?
  const out = [];                                                                          // the choices
  if (run.facing) {
    out.push('back');                                                                      // at a door: step back
  } else {
    out.push(...room.exits);                                                               // the ways out
    if (room.kind === 'stairs') out.push('descend');                                       // down
    if (room.kind === 'start') out.push('home');                                           // home
  }
  if (puzzle && puzzle.phase === 'pick') out.push(...state.members.map((m) => `m${m.user}`)); // who goes first
  return out;                                                                              // all of them
}

/** A member votes (voting the same again takes it back). */
function _vote(state, member, choice, now) {
  if (!options(state).includes(choice)) throw new PartyError("That isn't one of the choices right now."); // not on offer
  member.vote = member.vote === choice ? null : choice;                                    // set or take back
  const run = state.run;                                                                   // the trip
  if (run.vote_since === null && member.vote !== null) run.vote_since = now;               // the clock starts
  if (!state.members.some((m) => m.vote)) run.vote_since = null;                           // nobody voting: no clock
}

/** Settle the vote if it is settled: a majority, everyone voted, or the time is up. True if it was. */
function _tally(state, now, rng, force = false) {
  const run = state.run;                                                                   // the trip
  const allowed = options(state);                                                          // what counts
  const votes = state.members.filter((m) => allowed.includes(m.vote)).map((m) => m.vote);  // live votes
  if (!votes.length) {
    run.vote_since = null;                                                                 // no clock
    return false;                                                                          // nothing to settle
  }
  const counts = new Map();                                                                // choice -> votes
  for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);                          // count
  const top = Math.max(...counts.values());                                                // the most votes
  const leaders = [...counts.keys()].filter((c) => counts.get(c) === top).sort();          // tied leaders, sorted
  const everyone = votes.length === state.members.length;                                  // all voted?
  const late = run.vote_since !== null && now - run.vote_since >= VOTE_SECONDS * 1000;     // time's up?
  if (!(top * 2 > state.members.length || everyone || late || force)) return false;        // not settled yet
  let dice = false;                                                                        // did the dice decide?
  let choice;                                                                              // the winner
  if (leaders.length === 1) {
    choice = leaders[0];                                                                   // a clear winner
  } else if (leaders.every((c) => c.startsWith('m'))) {                                    // a tie between members
    const seats = new Map(state.members.map((m, i) => [m.user, i]));                       // seat order
    const rank = (c) => { const m = memberOf(state, c.slice(1)); return [m.puzzles, seats.get(m.user)]; }; // fewest tried, then seat
    choice = leaders.reduce((best, c) => {                                                 // min by (puzzles, seat)
      const a = rank(c), b = rank(best);                                                   // compare tuples
      return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? c : best;                     // keep the smaller
    });
  } else {
    choice = leaders[rng.randrange(leaders.length)];                                       // the dice
    dice = true;                                                                           // say so
  }
  for (const m of state.members) m.vote = null;                                            // votes cleared
  run.vote_since = null;                                                                   // clock cleared
  const said = _choiceWords(state, choice);                                                // in words
  _resolve(state, choice, now, rng, (dice ? 'The dice choose ' : 'The party chooses ') + said + '.'); // do it
  return true;                                                                             // settled
}

/** A choice in words: "east", "jane to go first". */
function _choiceWords(state, choice) {
  if (choice.startsWith('m')) {
    const found = memberOf(state, choice.slice(1));                                        // the member chosen
    return (found ? found.name : 'someone') + ' to go first';                              // their name
  }
  return WORDS[choice] || choice;                                                          // a way or a word
}

/** Do what the vote chose. */
function _resolve(state, choice, now, rng, said) {
  const run = state.run;                                                                   // the trip
  if (WAYS.includes(choice)) {
    _move(state, choice, now, rng);                                                        // walk that way
  } else if (choice === 'back') {
    run.facing = null;                                                                     // step back from the door
    run.puzzle = null;                                                                     // leave its puzzle
    run.event = { scenario: 'again' };                                                     // the room again
  } else if (choice === 'descend') {
    const floor = D().generate(run.env, run.depth + 1, rng, { decor: [], mods_owned: [] }); // the next floor
    Object.assign(run, { depth: run.depth + 1, rooms: floor.rooms, at: floor.start, prev: null, facing: null, tales: {},
      keys: 0, puzzle: null, event: { scenario: 'descend' } });                            // a key only fits the floor it was found on
  } else if (choice === 'home') {
    const bank = _bank(state, now);                                                        // everyone goes home (words about owed/capped prizes)
    _note(state, [said, ...bank].join(' '));                                               // say who chose it (and the bank's news)
    return;                                                                                // done
  } else if (choice.startsWith('m')) {
    _pick(state, choice.slice(1), now);                                                    // the puzzle circle
    run.event = { scenario: 'party_turn' };                                                // whose turn
    _narrate(state, rng, said + ' ' + _turnWords(state));                                  // say it
    return;                                                                                // done
  }
  _narrate(state, rng, said);                                                              // the story goes on
}

// ------------------------------------------------------------------------------------------------ walking
/** The party walks one way: into a room, or up to a locked door. */
function _move(state, way, now, rng) {
  const run = state.run;                                                                   // the trip
  const room = run.rooms[run.at];                                                          // where they are
  if (!room.exits.includes(way)) throw new PartyError("There's no way through there.");    // a wall
  const to = D()._step(run.at, way);                                                       // the next cell
  const target = run.rooms[to];                                                            // its room
  run.puzzle = null;                                                                       // walking away leaves a game for later
  if (target.lock && !target.done) {
    run.facing = to;                                                                       // at the door
    const kind = target.lock.kind;                                                         // what kind of lock
    run.event = { scenario: kind === 'key' ? 'locked_key' : 'locked_puzzle', lock: kind };  // tell it
    if (kind !== 'key') run.puzzle = _newPuzzle(to, kind, true);                           // a door puzzle to pick for
  } else {
    _enter(state, to, now, rng);                                                           // walk in
  }
}

/** A puzzle waiting for the party to choose who goes first. */
function _newPuzzle(at, kind, door) {
  return { at, kind, door, phase: 'pick', order: [], turn: 0, started: null, used: 0, moves: '', presses: [] }; // erinne's shape
}

/** The whole party steps into a room and it happens: a creature, something to pick up, a game. */
function _enter(state, to, now, rng) {
  const run = state.run;                                                                   // the trip
  run.prev = run.at;                                                                       // where they came from
  run.at = to;                                                                             // where they are
  run.facing = null;                                                                       // no door now
  run.puzzle = null;                                                                       // no puzzle yet
  const room = run.rooms[to];                                                              // the room
  const first = !room.seen;                                                                // first time here?
  room.seen = true;                                                                        // seen now
  if (room.kind === 'enemy' && !room.done) {
    _startFights(state, room, now, rng);                                                   // a fight
  } else if (['treasure', 'key', 'vault'].includes(room.kind) && !room.done) {
    run.event = { scenario: 'see_' + room.kind };                                          // something to take
  } else if (room.kind === 'game' && !room.done) {
    run.event = { scenario: 'game_' + room.game.kind };                                    // a little game
    run.puzzle = _newPuzzle(to, room.game.kind, false);                                    // pick who plays
  } else {
    run.event = { scenario: { stairs: 'stairs', start: 'start' }[room.kind] || (first ? 'empty' : 'again') }; // nothing much
  }
}

// ------------------------------------------------------------------------------------------------ the co-op fight
/** This member's place among the Lumis of the co-op fight going on, or null. */
function _seat(run, userId) {
  const fight = run ? run.fight : null;                                                    // the fight
  if (!fight || fight.outcome) return null;                                                // none, or over
  const i = fight.lumis.findIndex((lumi) => _same(lumi.user, userId));                     // her seat
  return i < 0 ? null : i;                                                                 // or not in it
}

/** A Lumi's name in the fight log: her own, or "<owner>'s <name>" when two in the party share it. */
function _fighterName(state, member) {
  const name = member.pet || 'Lumi';                                                       // her name
  const clash = state.members.filter((m) => (m.pet || 'Lumi').toLowerCase() === name.toLowerCase()).length > 1; // a twin?
  return clash ? `${member.name}'s ${name}` : name;                                        // told apart
}

/** Every standing Lumi meets the room's creature and maybe one or two more (never more than there are Lumis). */
function _startFights(state, room, now, rng) {
  const run = state.run;                                                                   // the trip
  const battle = B();                                                                      // lumibattle
  const entry = _get(battle._ENEMIES, room.enemy.id);                                      // the room's creature
  const standing = state.members.filter((m) => !m.fainted);                                // who can fight
  let level = _pyRound(standing.reduce((s, m) => s + m.level, 0) / Math.max(1, standing.length)); // their average level
  level = Math.max(1, Math.min(battle.MAX_LEVEL, level + rng.randrange(3) - 1 + (run.depth - 1))); // +-1, deeper is harder
  const lumis = [];                                                                        // the party's side
  for (const m of standing) {
    const pet = _pet(m.user, now);                                                         // her save
    const lumi = battle.teamFighter(pet, m.user, { hp: m.hp, mp: m.mp });                  // lumibattle.team_fighter
    lumi.name = _fighterName(state, m);                                                    // "jane's Lumi" when two share a name
    lumi.pocket = { potion: (pet.potions || 0) + m.satchel.potions };                      // what she can give: potions...
    for (const item of _keys(battle.KIT)) lumi.pocket[item] = (pet.kit || {})[item] || 0;  // ...and her fight items
    lumis.push(lumi);                                                                      // into the fight
    pet.boost = null;                                                                      // a waiting treat is eaten for this fight
    pet.rest = 'awake';                                                                    // awake for it
    pet.restUntil = now + 15 * 60_000;                                                     // (lumipet.AWAKE_MS)
    _savePet(m.user, pet);                                                                 // save her
    m.fought = null;                                                                       // fresh result
  }
  if (!lumis.length) return;                                                               // nobody to fight
  const count = 1 + rng.randrange(Math.min(battle.TEAM_FOES, lumis.length));               // one to three creatures
  const env = _get(D()._ENVS, run.env);                                                    // the place
  const kinds = [entry.id];                                                                // the room's own creature...
  for (let i = 0; i < count - 1; i++) kinds.push(D()._enemy(env, run.depth, rng).id);      // ...and the place's others
  const foes = kinds.map((kind) => battle.teamFoe(kind, level, level, lumis[0].element));  // lumibattle.team_foe
  const many = new Map();                                                                  // name -> how many
  for (const foe of foes) many.set(foe.name, (many.get(foe.name) || 0) + 1);               // count names
  for (const [name, n] of many) {                                                          // two of a kind are told apart
    if (n > 1) foes.filter((foe) => foe.name === name).slice(0, 3).forEach((foe, i) => { foe.name += ' ' + 'ABC'[i]; }); // "A", "B"
  }
  const fight = battle.teamStart(lumis, foes);                                             // lumibattle.team_start
  fight.since = now;                                                                       // the turn clock
  run.fight = fight;                                                                       // kept in the party
  run.fighting = true;                                                                     // no voting meanwhile
  run.event = { scenario: 'enemy', enemy: entry.name };                                    // tell it
}

/** One member's turn in the co-op fight: a move, Defend, Run, or an item from her own pocket. */
function _teamTurn(state, member, what, now, rng, { foe = null, ally = null, turn = null } = {}) {
  const battle = B();                                                                      // lumibattle
  const run = state.run;                                                                   // the trip
  const fight = run.fight;                                                                 // the fight
  if (!fight || fight.outcome) throw new PartyError("There's no fight going on.");         // nothing to do
  if (turn !== null && turn !== undefined && turn !== fight.turn) throw new PartyError('That turn already happened.'); // a stale page
  const seat = _seat(run, member.user);                                                    // her seat
  if (seat === null) throw new PartyError(member.fainted ? 'A little ghost can only cheer from the back.' : "Your Lumi isn't in this fight."); // not fighting
  let why = battle.teamRefusal(fight, seat, what, { target: what.startsWith('move') ? foe : null }); // lumibattle.team_refusal
  if (why) throw new PartyError(why);                                                      // refused
  let target = what.startsWith('move') ? foe : null;                                       // a move's creature
  if (what === 'potion' || _keys(battle.KIT).includes(what)) {                             // an item
    target = ally === null || ally === undefined ? seat : ally;                            // for herself by default
    if (!(target >= 0 && target < fight.lumis.length)) throw new PartyError('Choose a Lumi in this fight.'); // a real seat
    why = battle.itemRefusal(fight.lumis[target], what);                                   // lumibattle.item_refusal
    if (why) throw new PartyError(why);                                                    // refused
    if (what === 'potion' && member.satchel.potions > 0) {
      member.satchel.potions -= 1;                                                         // one found on this trip goes first
    } else {
      const pet = _pet(member.user, now);                                                  // her save
      try {
        battle.takeItem(pet, what);                                                        // lumibattle.take_item
      } catch (refused) {
        if ((battle.BattleError && refused instanceof battle.BattleError) || refused instanceof LumiError || (refused && refused.name === 'BattleError')) {
          throw new PartyError(refused.message);                                           // her pocket says no
        }
        throw refused;                                                                     // a bug
      }
      _savePet(member.user, pet);                                                          // one fewer
    }
    const pocket = fight.lumis[seat].pocket || (fight.lumis[seat].pocket = {});            // her pocket as shown
    pocket[what] = Math.max(0, (pocket[what] || 0) - 1);                                   // one fewer shown
  }
  battle.teamAct(fight, seat, what, rng, { target });                                      // lumibattle.team_act
  fight.since = now;                                                                       // the turn clock restarts
  if (fight.outcome) _teamEnd(state, now, rng);                                            // over: settle it
}

/** The co-op fight is over: EXP for all, coins + decor for the standing, ghosts for the fallen. */
function _teamEnd(state, now, rng) {
  const battle = B();                                                                      // lumibattle
  const run = state.run;                                                                   // the trip
  const fight = run.fight;                                                                 // the fight
  const enemy = run.event.enemy || 'creature';                                             // its name, for the story
  const outcome = fight.outcome;                                                           // victory / fled / defeat
  const gained = battle.teamReward(fight)[0];                                              // lumibattle.team_reward -> [exp, coins]
  const got = {};                                                                          // user -> team_finish result
  fight.lumis.forEach((lumi, seat) => {
    const member = memberOf(state, lumi.user);                                             // her owner
    if (!member || lumi.gone) return;                                                      // gone home mid-fight
    const pet = _pet(member.user, now);                                                    // her save
    for (const action of (fight.used || {})[String(member.user)] || []) battle.remember(pet, action); // for her Auto stats
    member.hp = Math.max(0, lumi.hp);                                                      // health carries on
    member.mp = lumi.mp;                                                                   // MP carries on
    if (outcome === 'victory') {
      got[member.user] = battle.teamFinish(pet, fight, seat);                              // lumibattle.team_finish: EXP + coins
      const numbers = battle.stats(pet);                                                   // a level gained mid-trip...
      Object.assign(member, { level: pet.level, hpMax: numbers.hp, mpMax: numbers.mp });   // ...her bars grow
      if (lumi.hp > 0) {
        member.satchel.coins += got[member.user].coins;                                    // her coins (native) in her satchel
        const piece = D()._setPiece(_get(D()._ENVS, run.env), 'enemy', run.depth, rng, _owned(member)); // maybe a decor piece
        if (piece) {
          member.satchel.trophies.push(piece);                                             // found
          _note(state, `${member.name} finds the ${_get(D().FOUND_NAMES, piece) || 'treasure'}!`); // say so
        }
      }
    }
    if (lumi.hp <= 0) {
      pet.losses = (pet.losses || 0) + 1;                                                  // a loss
      _faint(pet, member, state);                                                          // a ghost now
    }
    _savePet(member.user, pet);                                                            // save her
  });
  const levels = {};                                                                       // who levelled up
  for (const [user, g] of Object.entries(got)) if (g.levels) levels[String(user)] = g.levels; // only those who did
  run.last_fight = { outcome, exp: outcome === 'victory' ? gained : 0, log: fight.log.slice(-4), // what happened
    foes: fight.foes.map((foe) => foe.name), levels, at: now };
  run.fight = null;                                                                        // over
  run.fighting = false;                                                                    // voting again
  for (const m of state.members) m.fought = null;                                          // reset
  if (state.members.every((m) => m.fainted)) {
    Object.assign(run, { over: 'defeat', event: { scenario: 'defeat', enemy } });          // everyone fainted
    _narrate(state, rng);                                                                  // the story
    _finish(state, now, 'defeat');                                                         // the trip is over
    return;                                                                                // done
  }
  if (outcome === 'victory') {
    run.rooms[run.at].done = true;                                                         // cleared
    delete run.rooms[run.at].loot;                                                         // drops were rolled per winner instead
    run.event = { scenario: 'victory', enemy };                                            // tell it
    _narrate(state, rng, `Victory! Every Lumi gains ${gained} EXP.`);                      // the story
  } else {
    const back = run.prev || run.at;                                                       // a step back
    run.prev = run.at;                                                                     // came from here
    run.at = back;                                                                         // fled
    run.event = { scenario: 'fled', enemy };                                               // tell it
    _narrate(state, rng);                                                                  // the story
  }
}

/** A member's old-style party fight just ended (the pet module's fight_act calls this). Saves the party. */
function afterFight(userId, pet, fight, now = null, rng = null) {
  rng = rng || _systemRandom();                                                            // dice
  now = now === null || now === undefined ? _ms() : now;                                   // the time
  let state;                                                                               // the party
  try {
    state = _read(fight.party || '');                                                      // the fight's party
  } catch (error) {
    if (error instanceof PartyError) return;                                               // gone: nothing to do
    throw error;                                                                           // a bug
  }
  const member = memberOf(state, userId);                                                  // the fighter
  if (!member || member.fight !== fight.id || !state.run) return;                          // not this fight
  const run = state.run;                                                                   // the trip
  const lumi = fight.player;                                                               // her side of it
  member.fight = null;                                                                     // done
  member.hp = Math.max(1, lumi.hp);                                                        // health carries on
  member.mp = lumi.mp;                                                                     // MP carries on
  if (fight.status === 'victory') {
    member.satchel.coins += fight.reward.coins;                                            // her coins (native)
    member.fought = 'victory';                                                             // won
    const piece = D()._setPiece(_get(D()._ENVS, run.env), 'enemy', run.depth, rng, _owned(member)); // maybe decor
    if (piece) {
      member.satchel.trophies.push(piece);                                                 // found
      _note(state, `${member.name} finds the ${_get(D().FOUND_NAMES, piece) || 'treasure'}!`); // say so
    }
  } else if (fight.status === 'ran') {
    member.fought = 'ran';                                                                 // ran
  } else {
    _faint(pet, member, state);                                                            // lost
  }
  _settleFights(state, now, rng);                                                          // the room may be settled now
  _changed(state, now);                                                                    // save + wake
}

/** Beaten: she drops her satchel and follows the party as a ghost. */
function _faint(pet, member, state) {
  if (pet) B().hurt(pet, 0);                                                               // home hurt
  Object.assign(member, { fought: 'defeat', fainted: true, hp: 0, satchel: _bag() });      // a ghost with nothing
  _note(state, `${member.name}'s Lumi faints, and drops everything she found. She follows along as a little ghost.`); // say so
}

/** Old-style fights: once nobody is still fighting, settle the room. */
function _settleFights(state, now, rng) {
  const run = state.run;                                                                   // the trip
  if (!run || (!run.fighting && run.event.scenario !== 'enemy')) return;                   // no fight room
  if (state.members.some((m) => m.fight)) return;                                          // someone's still at it
  run.fighting = false;                                                                    // all done
  const enemy = run.event.enemy || 'creature';                                             // its name
  const won = state.members.filter((m) => m.fought === 'victory');                         // who won
  for (const m of state.members) m.fought = null;                                          // reset
  if (state.members.every((m) => m.fainted)) {
    Object.assign(run, { over: 'defeat', event: { scenario: 'defeat', enemy } });          // everyone fainted
    _narrate(state, rng);                                                                  // the story
    _finish(state, now, 'defeat');                                                         // over
    return;                                                                                // done
  }
  if (won.length) {
    run.rooms[run.at].done = true;                                                         // cleared
    delete run.rooms[run.at].loot;                                                         // drops were rolled per winner
    run.event = { scenario: 'victory', enemy };                                            // tell it
    _narrate(state, rng, won.map((m) => m.name).join(' and ') + (won.length === 1 ? ' wins!' : ' win!')); // who won
  } else {
    const back = run.prev || run.at;                                                       // a step back
    run.prev = run.at;                                                                     // came from here
    run.at = back;                                                                         // fled
    run.event = { scenario: 'fled', enemy };                                               // tell it
    _narrate(state, rng);                                                                  // the story
  }
}

// ------------------------------------------------------------------------------------------------ puzzles
/** The party chose who goes first: then whoever has tried fewest puzzles (ties by seat), then the last. */
function _pick(state, chosen, now) {
  const seats = new Map(state.members.map((m, i) => [m.user, i]));                         // seat order
  const rest = state.members.filter((m) => !_same(m.user, chosen))                         // everyone else...
    .sort((a, b) => a.puzzles - b.puzzles || seats.get(a.user) - seats.get(b.user));       // ...fewest tried, then seat
  const puzzle = state.run.puzzle;                                                         // the puzzle
  puzzle.order = [String(chosen), ...rest.map((m) => m.user)];                             // the circle
  puzzle.turn = 0;                                                                         // the chosen one first
  _beginAttempt(state, now);                                                               // their attempt starts
}

/** The holder's attempt starts now. */
function _beginAttempt(state, now) {
  const puzzle = state.run.puzzle;                                                         // the puzzle
  const who = memberOf(state, puzzle.order[puzzle.turn]);                                  // the holder
  who.puzzles += 1;                                                                        // "tried a puzzle", for the next order
  Object.assign(puzzle, { phase: 'attempt', started: now, used: 0, moves: '', presses: [] }); // a fresh attempt
}

/** "jane's turn at the runes (3 guesses)." */
function _turnWords(state) {
  const puzzle = state.run.puzzle;                                                         // the puzzle
  const who = memberOf(state, puzzle.order[puzzle.turn]);                                  // the holder
  const kind = puzzle.kind;                                                                // what puzzle
  const limit = LIMITS[kind];                                                              // its limit
  const how = limit && limit[0] === 'seconds' ? ` (${Math.floor(limit[1] / 60)} minutes)` : limit ? ` (${limit[1]} ${limit[0]})` : ''; // in words
  return `${who.name}'s turn at the ${PUZZLE_NAMES[kind]}${how}.`;                         // the line
}

/** The holder's attempt is over: the next one in the circle tries (after the last, the first again). */
function _fail(state, now, why) {
  const puzzle = state.run.puzzle;                                                         // the puzzle
  if (!puzzle || !puzzle.order.length) return;                                             // nobody to pass to
  puzzle.turn = (puzzle.turn + 1) % puzzle.order.length;                                   // next in the circle
  _beginAttempt(state, now);                                                               // their attempt
  _note(state, why + ' ' + _turnWords(state));                                             // say so
}

/** Who is working the puzzle right now (user id string, or null). */
function holder(state) {
  const puzzle = state.run ? state.run.puzzle : null;                                      // the puzzle
  if (!puzzle || puzzle.phase !== 'attempt' || !puzzle.order.length) return null;         // nobody
  return puzzle.order[puzzle.turn];                                                        // the holder
}

/** Read a Sokoban level (erinne lumidungeon.sokoban_parse): walls/goals/boxes as "x,y" sets, and where Lumi stands. */
function _sokobanParse(rows) {
  const walls = new Set(), goals = new Set(), boxes = new Set();                           // cells
  let lumi = null;                                                                         // her cell
  rows.forEach((row, y) => [...row].forEach((cell, x) => {
    const at = `${x},${y}`;                                                                // the cell key
    if (cell === '#') walls.add(at);                                                       // a wall
    if ('.*+'.includes(cell)) goals.add(at);                                               // a goal
    if ('$*'.includes(cell)) boxes.add(at);                                                // a crate
    if ('@+'.includes(cell)) lumi = [x, y];                                                // Lumi
  }));
  return { walls, goals, boxes, lumi };                                                    // the level
}

/** [every move legal, every crate home], replaying the attempt so far. */
function _sokobanProgress(rows, moves) {
  const { walls, goals, boxes, lumi } = _sokobanParse(rows);                               // the level
  if (!lumi) return [false, false];                                                        // a broken level
  const held = new Set(boxes);                                                             // crates as they move
  const step = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };                           // the four moves
  let [x, y] = lumi;                                                                       // where she is
  for (const move of moves) {
    if (!step[move]) return [false, false];                                                // not a move
    const [dx, dy] = step[move];                                                           // its direction
    const to = `${x + dx},${y + dy}`;                                                      // the next cell
    if (walls.has(to)) return [false, false];                                              // into a wall
    if (held.has(to)) {
      const beyond = `${x + 2 * dx},${y + 2 * dy}`;                                        // where the crate would go
      if (walls.has(beyond) || held.has(beyond)) return [false, false];                    // it can't
      held.delete(to);                                                                     // the crate moves
      held.add(beyond);                                                                    // to here
    }
    x += dx;                                                                               // she moves
    y += dy;                                                                               // she moves
  }
  const home = held.size === goals.size && [...held].every((c) => goals.has(c));           // every crate on a goal
  return [true, home];                                                                     // legal, solved
}

/** The holder's move at the puzzle: crates and lamps as they go, a rune guess, a cup, a card, or passing it on. */
function _puzzleAct(state, member, action, now, rng, moves, picks) {
  const dungeon = D();                                                                     // lumidungeon
  const run = state.run;                                                                   // the trip
  const puzzle = run.puzzle;                                                               // the puzzle
  if (!puzzle || puzzle.phase !== 'attempt') throw new PartyError('Nobody is at a puzzle right now. Vote who goes first.'); // not started
  if (!_same(holder(state), member.user)) throw new PartyError(`It's ${memberOf(state, holder(state)).name}'s turn.`); // not theirs
  if (action === 'pass') {
    _fail(state, now, `${member.name} passes it on.`);                                     // next one
    return;                                                                                // done
  }
  const room = run.rooms[puzzle.at];                                                       // the puzzle's room
  if (puzzle.door) {
    const lock = room.lock;                                                                // the door's lock
    if (action === 'sokoban' && lock.kind === 'sokoban') {
      const level = dungeon.SOKOBAN.find((l) => l.id === lock.level);                      // its level
      const [legal, solved] = _sokobanProgress(level.rows, moves.slice(0, dungeon.MAX_MOVES)); // replay
      if (!legal) throw new PartyError("That crate won't move that way.");                 // a bad move
      puzzle.moves = moves;                                                                // the others watch this
      if (solved) _openDoor(state, member, now, rng);                                      // open!
    } else if (action === 'lights' && lock.kind === 'lights') {
      if (picks.length > 200 || picks.some((c) => !Number.isInteger(c) || c < 0 || c >= lock.size ** 2)) throw new PartyError("That lamp isn't on the board."); // off the board
      puzzle.presses = [...picks];                                                         // the others watch this
      if (dungeon.lightsSolved(lock.board, lock.size, picks)) _openDoor(state, member, now, rng); // lumidungeon.lights_solved
    } else if (action === 'rune' && lock.kind === 'runes') {
      if (picks.length !== dungeon.RUNE_SLOTS || picks.some((r) => !dungeon.RUNES.includes(r))) throw new PartyError(`Choose ${dungeon.RUNE_SLOTS} runes.`); // a whole guess
      const marks = dungeon.runeMarks(picks, lock.code);                                   // lumidungeon.rune_marks
      const exact = marks.filter((m) => m === 'right').length;                             // right place
      const near = marks.filter((m) => m === 'near').length;                               // wrong place
      lock.tries.push({ guess: [...picks], exact, near, marks, by: member.name });          // shown to everyone
      puzzle.used += 1;                                                                    // one guess used
      if (exact === dungeon.RUNE_SLOTS) {
        _openDoor(state, member, now, rng);                                                // solved
        return;                                                                            // done
      }
      if (lock.tries.length >= dungeon.RUNE_TRIES) {                                       // the door thinks of a new code
        lock.code = Array.from({ length: dungeon.RUNE_SLOTS }, () => dungeon.RUNES[rng.randrange(dungeon.RUNES.length)]); // new code
        lock.tries = [];                                                                   // fresh tries
        run.event = { scenario: 'runes_reset' };                                           // tell it
      } else {
        run.event = { scenario: 'runes_try', exact, near };                                // how close
      }
      _narrate(state, rng);                                                                // the story
      if (puzzle.used >= LIMITS.runes[1]) _fail(state, now, `That was ${member.name}'s last guess.`); // their turn is over
    } else {
      throw new PartyError("That isn't how this door opens.");                             // wrong kind
    }
    return;                                                                                // done with the door
  }
  const game = room.game;                                                                  // a room's little game
  const pick = picks.length === 1 && Number.isInteger(picks[0]) ? picks[0] : -1;           // one card or cup
  if (action === 'cup' && game.kind === 'cups') {
    if (!(pick >= 0 && pick < dungeon.CUPS)) throw new PartyError('Choose a cup.');        // a real cup
    const won = pick === game.prize;                                                       // the right one?
    room.done = true;                                                                      // played
    run.puzzle = null;                                                                     // over
    const paid = _sharePrize(state, run, rng, won ? 2.5 : 0.3);                            // everyone's share (native)
    run.event = { scenario: won ? 'game_win' : 'game_lose', coins: paid, prize: game.prize }; // tell it
    _narrate(state, rng, `${member.name} lifts cup ${pick + 1}.`);                         // the story
  } else if (action === 'flip' && game.kind === 'match') {
    if (!(pick >= 0 && pick < game.deck.length) || game.found.includes(pick) || pick === game.open) throw new PartyError("Choose a card that's face down."); // a hidden card
    game.flips += 1;                                                                       // one flip
    puzzle.used += 1;                                                                      // of their turn
    if (game.open === null) {
      game.open = pick;                                                                    // the first of a pair
      game.last = null;                                                                    // nothing to show
      run.event = { scenario: 'match_flip' };                                              // tell it
    } else {
      const first = game.open;                                                             // the first card
      game.open = null;                                                                    // pair done
      game.last = [first, pick];                                                           // show the pair
      const pair = game.deck[first] === game.deck[pick];                                   // a match?
      if (pair) game.found.push(first, pick);                                              // keep them up
      run.event = { scenario: pair ? 'match_pair' : 'match_miss' };                        // tell it
    }
    if (game.found.length === game.deck.length || game.flips >= dungeon.FLIPS) {
      room.done = true;                                                                    // the game is over
      run.puzzle = null;                                                                   // no puzzle now
      const pairs = Math.floor(game.found.length / 2);                                     // how many found
      const paid = _sharePrize(state, run, rng, 0.3 + 0.7 * pairs);                        // everyone's share (native)
      run.event = { scenario: pairs === dungeon.PAIRS ? 'game_win' : 'game_lose', coins: paid, pairs }; // tell it
      _narrate(state, rng);                                                                // the story
      return;                                                                              // done
    }
    _narrate(state, rng);                                                                  // the story
    if (game.open === null && puzzle.used >= LIMITS.match[1]) _fail(state, now, `${member.name} has used their flips.`); // a turn ends after a whole pair
  } else {
    throw new PartyError("There's no game like that here.");                               // wrong game
  }
}

/** A little game's prize: the same (native) coins in everyone's satchel who is still standing. */
function _sharePrize(state, run, rng, scale) {
  const won = D()._coins(run.depth, rng, scale);                                           // lumidungeon._coins
  for (const m of state.members) if (!m.fainted) m.satchel.coins += won;                   // ghosts find nothing
  return won;                                                                              // the share
}

/** Solved: the door opens and everyone walks through. */
function _openDoor(state, member, now, rng) {
  const run = state.run;                                                                   // the trip
  const door = run.rooms[run.facing];                                                      // the door's room
  door.lock = { kind: door.lock.kind };                                                    // the puzzle is spent; forget its answer
  _enter(state, run.facing, now, rng);                                                     // walk in
  _narrate(state, rng, `${member.name} opens the door!`);                                  // the story
}

// ------------------------------------------------------------------------------------------------ finds + home
/** What this member has or has found on this trip (so loot never gives it twice). A Set (lumidungeon adds to it). */
function _owned(member) {
  return new Set([...member.owned, ...member.satchel.trophies]);                           // owned + found
}

/** Open the chest, take the key or the vault: everyone still standing gets their own share. */
function _take(state, now, rng) {
  const dungeon = D();                                                                     // lumidungeon
  const run = state.run;                                                                   // the trip
  const room = run.rooms[run.at];                                                          // here
  if (!['treasure', 'key', 'vault'].includes(room.kind) || room.done) throw new PartyError("There's nothing here to pick up."); // nothing
  room.done = true;                                                                        // taken
  const env = _get(dungeon._ENVS, run.env);                                                // the place
  const loot = room.loot || {};                                                            // what's here
  if (room.kind === 'key') {
    run.keys += 1;                                                                         // one shared key
    run.event = { scenario: 'key', loot: { keys: 1 } };                                    // tell it
    return;                                                                                // done
  }
  const shared = { coins: loot.coins || 0, potions: loot.potions || 0 };                   // a chest's share
  let told = null;                                                                         // the share the story tells
  for (const m of state.members) {
    if (m.fainted) continue;                                                               // a ghost finds nothing
    const bag = m.satchel;                                                                 // their satchel
    let share;                                                                             // what they get
    if (room.kind === 'vault') {                                                           // each their own vault
      share = dungeon._vaultLoot(env, run.depth, rng, { decor: [..._owned(m)], mods_owned: m.mods }, { trophies: [], mods: bag.mods }); // lumidungeon._vault_loot
    } else {
      share = { ...shared };                                                               // the chest's coins + potions
      const piece = dungeon._setPiece(env, 'treasure', run.depth, rng, _owned(m));         // maybe decor
      if (piece) share.trophy = piece;                                                     // found
    }
    told = told || share;                                                                  // the first share is told
    bag.coins += share.coins || 0;                                                         // coins (native)
    bag.potions += share.potions || 0;                                                     // potions
    if (share.trophy) {
      bag.trophies.push(share.trophy);                                                     // a trophy
      _note(state, `${m.name} finds the ${_get(dungeon.FOUND_NAMES, share.trophy) || 'treasure'}!`); // say so
    }
    if (share.mod) {
      bag.mods.push(share.mod);                                                            // a mod
      const mod = _get(B()._MODS, share.mod);                                              // its card
      _note(state, `${m.name} finds a ${mod ? mod.name : share.mod} mod!`);                // say so
    }
  }
  run.event = { scenario: room.kind, loot: told || shared };                               // tell it
}

/** Out of the entrance together: each satchel goes home to its own Lumi. Coins are paid once per member (SGC).
 *  Returns lines about prizes the bank owes or the daily cap trimmed, for the caller to say. */
function _bank(state, now) {
  const run = state.run;                                                                   // the trip
  const bank = [];                                                                         // words about the bank, said after
  for (const m of state.members) {
    const pet = _pet(m.user, now);                                                         // her save
    if (!m.fainted) B().hurt(pet, m.hp);                                                   // her bruises come home with her
    const bag = m.satchel;                                                                 // her satchel
    const ref = `lumi-party:${state.code}:${run.id}:${m.user}`;                            // pay-once ref
    const prize = bag.coins ? sgc.pay(m.user, m.name, bag.coins, 'party', 'win', ref)      // erinne coins.prize -> sgc.pay
      : { paid: 0, owed: 0, capped: false };                                               // nothing to pay
    if (prize.owed > 0) bank.push(`${m.name}: Lumi-Town Bank is closed for a moment, your prize is saved.`); // owed
    else if (prize.capped) bank.push(`${m.name} hit today's Lumi Party prize limit.`);     // capped
    const kept = Math.min(bag.potions, Math.max(0, B().POTION_CAP - (pet.potions || 0)));  // potions she can carry
    pet.potions = (pet.potions || 0) + kept;                                               // into her pocket
    pet.decor = [...(pet.decor || []), ...bag.trophies.filter((t) => !(pet.decor || []).includes(t))]; // trophies home
    pet.mods_owned = [...(pet.mods_owned || []), ...bag.mods.filter((x) => !(pet.mods_owned || []).includes(x))]; // mods home
    _savePet(m.user, pet);                                                                 // save her
    m.ended = { coins: prize.paid, owed: prize.owed || 0, capped: Boolean(prize.capped),   // SGC paid (and owed / capped)
      potions: kept, trophies: bag.trophies, mods: bag.mods, fainted: m.fainted };         // what came home
  }
  Object.assign(run, { over: 'home', event: { scenario: 'home' } });                       // home
  _narrate(state, _systemRandom());                                                        // the story
  _finish(state, now, 'home');                                                             // back to the lobby
  return bank;                                                                             // the caller says these after its own line
}

/** The trip is over: back to the lobby together, with how it went kept to read. */
function _finish(state, now, how) {
  const run = state.run;                                                                   // the trip
  state.last = { how, depth: run.depth, env: run.env, say: run.say || '',                  // how it went
    members: state.members.map((m) => ({ user: m.user, name: m.name, ended: m.ended || { coins: 0, lost: true } })) }; // each one's haul
  state.phase = 'lobby';                                                                   // the lobby again
  state.run = null;                                                                        // no trip
  for (const m of state.members) Object.assign(m, { ready: false, vote: null, fight: null, fought: null, ended: null }); // reset
}

/** The whole party gives up (nobody came back): satchels stay behind, bruises go home. */
function _abandon(state, now) {
  if (state.phase === 'trip' && state.run) {
    for (const m of [...state.members]) {
      const pet = _pet(m.user, now);                                                       // her save
      if (m.fight) _endFightRow(m.user, m.fight);                                          // an old-style fight: run from
      B().hurt(pet, m.fainted ? 0 : m.hp);                                                 // bruises home
      _savePet(m.user, pet);                                                               // save her
    }
    state.run.event = { scenario: 'abandon' };                                             // tell it
    _finish(state, now, 'abandoned');                                                      // over
  }
}

/** Drink a potion between fights (a satchel one first, then her own). */
function _potion(state, member, now) {
  if (member.fainted) throw new PartyError("A little ghost can't drink a potion. She'll mend at home."); // a ghost
  if (member.fight || _seat(state.run, member.user) !== null) throw new PartyError('Drink it in the fight, on your turn.'); // fighting
  if (member.hp >= member.hpMax) throw new PartyError('Your Lumi is already at full health.'); // full
  if (member.satchel.potions > 0) {
    member.satchel.potions -= 1;                                                           // one found on the trip
  } else {
    const pet = _pet(member.user, now);                                                    // her save
    if ((pet.potions || 0) < 1) throw new PartyError('Your Lumi has no potions with her.'); // none
    pet.potions -= 1;                                                                      // one of her own
    _savePet(member.user, pet);                                                            // save her
  }
  member.hp = Math.min(member.hpMax, member.hp + Math.max(1, Math.trunc(member.hpMax * B().POTION_MEND))); // mend
  _note(state, `${member.name}'s Lumi drinks a potion.`);                                  // say so
}

/** Bought food eaten on a party trip (the pet module's _eat): mends this member's trip health. False if not on one. */
function heal(userId, share) {
  const state = onTrip(userId);                                                            // out on a trip?
  const member = state ? memberOf(state, userId) : null;                                   // as a member
  if (!member) return false;                                                               // no
  if (!member.fainted && !member.fight) {
    member.hp = Math.min(member.hpMax, member.hp + Math.trunc(member.hpMax * share));       // mend
    _changed(state, _ms());                                                                // save + wake
  }
  return true;                                                                             // it was a party trip
}

/** A potion found on this trip, drunk in an old-style fight: is one there, and with take, use it up. */
function satchelPotion(userId, battleId, take) {
  const state = onTrip(userId);                                                            // out on a trip?
  const member = state ? memberOf(state, userId) : null;                                   // as a member
  if (!member || member.fight !== battleId || member.satchel.potions < 1) return false;    // none for this fight
  if (take) {
    member.satchel.potions -= 1;                                                           // used
    _changed(state, _ms());                                                                // save + wake
  }
  return true;                                                                             // there is one
}

// ------------------------------------------------------------------------------------------------ the story
/** A party line (who joined, who fainted, whose turn): kept with the story, never handed to a model. */
function _note(state, words) {
  const run = state.run;                                                                   // the trip
  if (run) {
    run.log.push(words);                                                                   // the story so far
    run.say = run.noted ? (run.say + ' ' + words).trim() : words;                          // within one action, lines add up
    run.noted = true;                                                                      // this action has said something
  } else {
    state.notes = [...(state.notes || []), words].slice(-6);                               // lobby notes (last six)
  }
}

/** The moment's line from the library (lumitales), after a party line if there is one. */
function _narrate(state, rng, before = '') {
  const run = state.run;                                                                   // the trip
  const told = run.event.scenario === 'party_turn' ? before                                // whose turn: no library line
    : (before ? before + ' ' : '') + T().line(run, rng);                                   // lumitales.line
  run.say = run.noted ? (run.say + ' ' + told).trim() : told;                              // after any party line
  run.noted = true;                                                                        // said something
  run.scene = T().scene(run);                                                              // lumitales.scene
  run.log.push(told);                                                                      // the story so far
}

// ------------------------------------------------------------------------------------------------ time
/** Whether _advance would change anything (so a look can skip the transaction when it wouldn't). */
function _due(state, now) {
  if (now - state.changed >= IDLE_MS) return true;                                         // idle: breaks up
  const run = state.run;                                                                   // the trip
  if (state.phase !== 'trip' || !run) return false;                                        // nothing ticking
  if (run.vote_since !== null && now - run.vote_since >= VOTE_SECONDS * 1000) return true; // vote time up
  const puzzle = run.puzzle;                                                               // a puzzle?
  if (puzzle && puzzle.phase === 'attempt') {
    const limit = LIMITS[puzzle.kind];                                                     // its limit
    if (limit && limit[0] === 'seconds' && now - puzzle.started >= limit[1] * 1000) return true; // time up
    const who = memberOf(state, holder(state));                                            // the holder
    if (who && _quiet(state, who) >= HOLDER_QUIET) return true;                            // gone quiet
  }
  const fight = run.fight;                                                                 // the co-op fight
  if (fight && !fight.outcome && now - fight.since >= TURN_SECONDS * 1000) return true;    // a turn left too long
  return state.members.some((m) => m.fight && _quiet(state, m) >= FIGHT_QUIET);            // an old-style fighter gone quiet
}

/** Catch the party up on its clocks: a vote's time, a puzzle attempt's, a holder or fighter gone quiet. */
function _advance(state, now, rng) {
  let run = state.run;                                                                     // the trip
  if (state.phase !== 'trip' || !run) return;                                              // nothing ticking
  if (run.vote_since !== null && now - run.vote_since >= VOTE_SECONDS * 1000) _tally(state, now, rng, true); // the vote settles
  run = state.run;                                                                         // (it may have ended the trip)
  const puzzle = run ? run.puzzle : null;                                                  // a puzzle?
  if (puzzle && puzzle.phase === 'attempt') {
    const limit = LIMITS[puzzle.kind];                                                     // its limit
    const who = memberOf(state, holder(state));                                            // the holder
    if (limit && limit[0] === 'seconds' && now - puzzle.started >= limit[1] * 1000) {
      _fail(state, now, `Time's up for ${who ? who.name : 'them'}.`);                      // time up
    } else if (who && _quiet(state, who) >= HOLDER_QUIET) {
      _fail(state, now, `${who.name} seems to have stepped away.`);                        // gone quiet
    }
  }
  const fight = run ? run.fight : null;                                                    // the co-op fight
  if (fight && !fight.outcome && now - fight.since >= TURN_SECONDS * 1000) {
    B().teamSkip(fight, rng, "Time's up!");                                                // lumibattle.team_skip: she braces
    fight.since = now;                                                                     // the clock restarts
    if (fight.outcome) _teamEnd(state, now, rng);                                          // that ended it
  }
  for (const m of state.members) {
    if (run && m.fight && _quiet(state, m) >= FIGHT_QUIET) {
      _endFightRow(m.user, m.fight);                                                       // run from
      m.fight = null;                                                                      // out of it
      m.fought = 'ran';                                                                    // ran
      _note(state, `${m.name} hangs back from the fight.`);                                // say so
      _settleFights(state, now, rng);                                                      // the room may settle
    }
  }
}

/** Tell every open stream of this party to look again, once the current transaction is over. */
function _wake(code) {
  setImmediate(() => events.publish(`party:${code}`, 'changed', { code }));                // after commit (erinne HUB.wake)
}

/** The party changed: a new revision, saved, and every stream wakes. */
function _changed(state, now) {
  state.revision += 1;                                                                     // a new revision
  state.changed = now;                                                                     // last real change
  _write(state, now);                                                                      // save
  _wake(state.code);                                                                       // streams look again
}

/** Break up parties nobody has changed in IDLE_MS: a trip still out is given up. Call inside a transaction. */
function sweep(now = null) {
  now = now === null || now === undefined ? _ms() : now;                                   // the time
  const rows = db.getDb().prepare('SELECT code, state FROM lumi_parties WHERE updated_at < ?').all((now - IDLE_MS) / 1000); // idle parties
  for (const row of rows) _close(JSON.parse(row.state), now);                              // close each
}

/** Close a party for good: a trip is given up, the rows go, presence forgotten, streams told. */
function _close(state, now) {
  _abandon(state, now);                                                                    // satchels stay behind
  db.getDb().prepare('DELETE FROM lumi_party_members WHERE code = ?').run(state.code);     // members free
  db.getDb().prepare('DELETE FROM lumi_parties WHERE code = ?').run(state.code);           // the party gone
  L().PRESENCE.forget(_table(state.code));                                                 // lobby.PRESENCE.forget
  _wake(state.code);                                                                       // streams find it gone
}

// ------------------------------------------------------------------------------------------------ one thing a member does
const FREE = ['take', 'look', 'unlock', 'potion'];                                         // anyone may, at once
const FIGHT = () => ['move0', 'move1', 'move2', 'move3', 'defend', 'run', 'potion', ..._keys(B().KIT)]; // a co-op fight turn's target
const VOTED = { move: null, back: 'back', descend: 'descend', leave: 'home' };             // the solo page's buttons, as votes
const PUZZLE = ['sokoban', 'lights', 'rune', 'cup', 'flip', 'pass'];                       // the holder's moves

/**
 * One thing a member (or someone joining) does. Call inside db.tx(). Answers the party as they see it.
 * opts: { name, way, target, item, moves, picks, foe, ally, turn } (erinne's keyword arguments).
 */
function act(code, userId, action, now = null, rng = null, opts = {}) {
  const { name = '', way = null, target = '', item = '', moves = '', picks = null, foe = null, ally = null, turn = null } = opts; // the keyword args
  rng = rng || _systemRandom();                                                            // dice
  now = now === null || now === undefined ? _ms() : now;                                   // the time
  const state = _read(code);                                                               // the party
  if (state.run) state.run.noted = false;                                                  // this action's lines replace the last action's
  const before = _canon(state);                                                            // to see if anything changed
  _advance(state, now, rng);                                                               // catch up on the clocks
  if (action === 'join') {
    _join(state, userId, name || 'Someone', now);                                          // join
  } else {
    const member = memberOf(state, userId);                                                // who
    if (!member) throw new PartyError("You aren't in this party. Join it first.", 403);    // not a member
    L().PRESENCE.seen(_table(state.code), _actor(member));                                 // lobby.PRESENCE.seen
    if (action === 'fight') {
      if (!FIGHT().includes(target)) throw new PartyError("Your Lumi doesn't know that one."); // not a fight move
      _teamTurn(state, member, target, now, rng, { foe, ally, turn });                     // her turn
    } else {
      _memberAct(state, member, action, now, rng, { way, target, item, moves, picks: picks || [] }); // anything else
    }
  }
  if (!state.members.length) {
    _close(state, now);                                                                    // everyone left: it breaks up
    return { code: state.code, closed: true };                                             // say so
  }
  if (_canon(state) !== before) _changed(state, now);                                      // save + wake when it changed
  return view(state, userId, { now });                                                     // as they see it
}

/** Everything but a fight turn. */
function _memberAct(state, member, action, now, rng, { way, target, item, moves, picks }) {
  const phase = state.phase;                                                               // lobby or trip
  const run = state.run;                                                                   // the trip
  if (action === 'leave' && phase !== 'trip') { _leave(state, member, now); return; }      // leave the lobby
  if (action === 'abandon' && phase === 'trip') { _leave(state, member, now); return; }    // give up the trip
  if (phase === 'lobby') {
    if (action === 'ready') {
      member.ready = !member.ready;                                                        // toggle ready
    } else if (action === 'env') {
      if (!_same(state.host, member.user)) throw new PartyError('The host chooses where to go.'); // host only
      if (!_openEnvs(state).some((e) => e.id === item && e.open)) throw new PartyError("Everyone's Lumi needs to have opened that place first."); // not open
      state.env = item;                                                                    // the place
    } else if (action === 'start') {
      if (!_same(state.host, member.user)) throw new PartyError('The host sets out, once everyone is ready.'); // host only
      _setOut(state, now, rng);                                                            // go!
    } else {
      throw new PartyError("The party hasn't set out yet.");                               // not on a trip
    }
    return;                                                                                // lobby done
  }
  if (phase !== 'trip' || !run) throw new PartyError("The party isn't out exploring.");    // no trip
  if (action in VOTED || action === 'vote') {
    if (run.fighting) throw new PartyError("Everyone's still fighting.");                   // not now
    const choice = action === 'vote' ? target : action === 'move' ? way : VOTED[action];   // what they vote
    _vote(state, member, choice || '', now);                                               // vote
    _tally(state, now, rng);                                                               // settled?
  } else if (FREE.includes(action)) {
    if (run.fighting) throw new PartyError("Everyone's still fighting.");                   // not now
    if (action === 'take') {
      if (run.facing) throw new PartyError("There's a door in the way.");                  // at a door
      _take(state, now, rng);                                                              // open it up
      _narrate(state, rng, `${member.name} opens it up.`);                                 // the story
    } else if (action === 'look') {
      const room = run.rooms[run.at];                                                      // here
      room.looks = (room.looks || 0) + 1;                                                  // looked again
      run.event = { scenario: 'look', n: room.looks };                                     // tell it
      _narrate(state, rng);                                                                // the story
    } else if (action === 'unlock') {
      const door = run.rooms[run.facing || ''];                                            // the door ahead
      if (!door || door.done || !door.lock || door.lock.kind !== 'key') throw new PartyError("There's no keyhole in front of the party."); // no keyhole
      if (run.keys < 1) throw new PartyError("The party needs a key for this door. There's one somewhere on this floor."); // no key
      run.keys -= 1;                                                                       // use it
      _openDoor(state, member, now, rng);                                                  // open
    } else {
      _potion(state, member, now);                                                         // drink
    }
  } else if (PUZZLE.includes(action)) {
    if (run.fighting) throw new PartyError("Everyone's still fighting.");                   // not now
    _puzzleAct(state, member, action, now, rng, moves, picks);                             // the holder's move
  } else {
    throw new PartyError("Your Lumi doesn't know that one.");                              // unknown
  }
}

/** Whether a look now would write (the party's clocks are due). */
function due(code, now = null) {
  return _due(_read(code), now === null || now === undefined ? _ms() : now);              // read only
}

/** The party as this member sees it now, caught up on its clocks (writes only when due: call inside tx then). */
function look(code, userId, now = null) {
  now = now === null || now === undefined ? _ms() : now;                                   // the time
  const state = _read(code);                                                               // the party
  const me = userId === null || userId === undefined ? null : memberOf(state, userId);     // the viewer as a member
  if (me) L().PRESENCE.seen(_table(state.code), _actor(me));                               // lobby.PRESENCE.seen
  if (_due(state, now)) {
    const rng = _systemRandom();                                                           // dice
    if (now - state.changed >= IDLE_MS) {
      _close(state, now);                                                                  // idle: break it up
      throw new PartyError(BROKEN_UP, 404);                                                // and say so
    }
    if (state.run) state.run.noted = false;                                                // fresh lines
    const before = _canon(state);                                                          // to compare
    _advance(state, now, rng);                                                             // catch up
    if (_canon(state) !== before) _changed(state, now);                                    // save + wake
  }
  return view(state, userId, { now });                                                     // as they see it
}

/** Parties still in their lobby with room to join, and the caller's own, newest first. */
function parties(userId, now = null) {
  const out = [];                                                                          // the list
  const rows = db.getDb().prepare('SELECT state FROM lumi_parties ORDER BY updated_at DESC LIMIT 50').all(); // newest 50
  for (const row of rows) {
    const state = JSON.parse(row.state);                                                   // the party
    const mineToo = memberOf(state, userId) !== null;                                      // the caller's own?
    if (mineToo || (state.phase === 'lobby' && state.members.length < MAX_MEMBERS)) {
      const host = memberOf(state, state.host);                                            // its host
      const env = _get(D()._ENVS, state.env || '');                                        // where it goes
      out.push({ code: state.code, mode: state.mode, phase: state.phase, mine: mineToo,    // the card
        host: host ? host.name : state.screen || '', members: state.members.map((m) => m.name),
        lumis: state.members.map((m) => ({ name: m.name, pet: m.pet || 'Lumi', glow: m.glow, colour: m.colour === undefined ? null : m.colour,
          outfit: m.outfit || {}, level: m.level, ready: m.ready })),                      // each Lumi, to draw
        env: env ? env.name : '', screen: state.screen || '', max: MAX_MEMBERS });
    }
  }
  return out;                                                                              // the list
}

// ------------------------------------------------------------------------------------------------ what a page is told
/** The puzzle as the page may see it (never its answer). */
function _publicPuzzle(state) {
  const puzzle = state.run.puzzle;                                                         // the puzzle
  if (!puzzle) return null;                                                                // none
  const limit = puzzle.door || puzzle.kind === 'match' ? LIMITS[puzzle.kind] : null;       // its limit, if any
  const out = { kind: puzzle.kind, phase: puzzle.phase, order: puzzle.order, turn: puzzle.turn, // the circle
    holder: holder(state), door: puzzle.door, used: puzzle.used, moves: puzzle.moves,
    presses: puzzle.presses, limit: null, ends: null };
  if (limit) {
    out.limit = { kind: limit[0], count: limit[1] };                                       // what limits a turn
    if (limit[0] === 'seconds' && puzzle.started) out.ends = puzzle.started + limit[1] * 1000; // when it ends
  }
  return out;                                                                              // the puzzle
}

/** The trip as lumidungeon.view shapes a solo one, with the party's own parts under "party". */
function _runView(state, me, now) {
  const dungeon = D();                                                                     // lumidungeon
  const run = state.run;                                                                   // the trip
  const shown = me || state.members.find((m) => !m.fainted) || state.members[0];           // whose numbers
  const rooms = {};                                                                        // rooms the page may know
  for (const [key, room] of Object.entries(run.rooms)) {
    if (room.seen) {
      rooms[key] = { kind: room.kind, done: room.done, exits: room.exits };                // a visited room
      for (const way of room.exits) {
        const next = dungeon._step(key, way);                                              // a doorway seen
        if (!(next in rooms)) rooms[next] = { kind: 'unknown' };                           // a blank
      }
    }
  }
  const here = run.rooms[run.at];                                                          // where they are
  const env = _get(dungeon._ENVS, run.env);                                                // the place
  const shownRooms = {};                                                                   // erinne's filter
  for (const [k, r] of Object.entries(rooms)) if ((run.rooms[k] && run.rooms[k].seen) || r.kind === 'unknown') shownRooms[k] = r; // seen or blank
  const out = {
    id: run.id, env: { id: env.id, name: env.name, family: env.family, palette: env.palette }, depth: run.depth, // where
    at: run.at, rooms: shownRooms, room: { kind: here.kind, done: here.done, exits: here.exits }, // the map
    satchel: { ...shown.satchel, keys: run.keys }, hp: shown.hp, hpMax: shown.hpMax,       // this member's satchel + bars
    mp: shown.mp, mpMax: shown.mpMax, over: run.over, ended: null, event: run.event,
    say: run.say || '', scene: run.scene || '', story: run.log,                             // the story
    fighting: Boolean(shown.fight) || Boolean(run.fight), facing: null, game: null,
  };
  if (run.facing) out.facing = { at: run.facing, lock: dungeon._publicLock(run.rooms[run.facing].lock) }; // lumidungeon._public_lock
  if (here.kind === 'game') out.game = dungeon._publicGame(here.game, here.done);          // lumidungeon._public_game
  const opts = options(state);                                                             // the choices
  const votes = {};                                                                        // user -> vote
  for (const m of state.members) if (m.vote) votes[String(m.user)] = m.vote;               // live votes
  const words = {};                                                                        // choice -> words
  for (const k of opts) words[k] = _choiceWords(state, k);                                 // each in words
  out.party = { code: state.code, options: opts, puzzle: _publicPuzzle(state), votes,      // the party's parts
    ends: run.vote_since ? run.vote_since + VOTE_SECONDS * 1000 : null,
    fighting: run.fighting, words, fight: _publicFight(run.fight, me), last_fight: run.last_fight || null };
  return out;                                                                              // the trip
}

/** The co-op fight for a page: bars, stages, whose turn and until when, the log. */
function _publicFight(fight, me) {
  if (!fight) return null;                                                                 // none
  const fighter = (f, lumi) => {                                                           // one side's fighter
    const out = {};                                                                        // its card
    for (const k of ['name', 'level', 'element', 'hp', 'hpMax', 'status', 'stages']) out[k] = f[k] === undefined ? null : f[k]; // common fields
    if (lumi) {
      Object.assign(out, { user: f.user, mp: f.mp, mpMax: f.mpMax, guarding: f.guarding || false, gone: Boolean(f.gone), pocket: f.pocket || {}, // a Lumi
        moves: (f.moves || []).map((m) => ({ name: m.name, mp: m.mp || 0, element: m.element, magic: m.magic, power: m.power })) }); // her moves
    } else {
      for (const k of ['id', 'tier', 'body', 'colour', 'weak', 'resist']) out[k] = f[k] === undefined ? null : f[k]; // a creature
    }
    return out;                                                                            // the card
  };
  const you = me ? fight.lumis.findIndex((f) => _same(f.user, me.user)) : -1;             // the viewer's seat
  return { lumis: fight.lumis.map((f) => fighter(f, true)), foes: fight.foes.map((f) => fighter(f, false)), // both sides
    round: fight.round, at: fight.at, turn: fight.turn, log: fight.log.slice(-8), outcome: fight.outcome,
    ends: fight.since + TURN_SECONDS * 1000, you: you < 0 ? null : you };                  // the clock + your seat
}

/** The party for a page: members (no accounts beyond their ids), where it is, and the trip. */
function view(state, userId, { now = null } = {}) {
  now = now === null || now === undefined ? _ms() : now;                                   // the time
  const me = userId === null || userId === undefined ? null : memberOf(state, userId);     // the viewer
  const members = state.members.map((m, i) => ({                                          // each member
    user: m.user, name: m.name, seat: i, host: _same(state.host, m.user),
    ready: m.ready, level: m.level, glow: m.glow, pet: m.pet || 'Lumi', colour: m.colour === undefined ? null : m.colour,
    outfit: m.outfit || {}, hp: m.hp, hpMax: m.hpMax,
    mp: m.mp, mpMax: m.mpMax, fainted: m.fainted, satchel: m.satchel,
    puzzles: m.puzzles, vote: m.vote, fighting: Boolean(m.fight) || _seat(state.run, m.user) !== null,
    away: _quiet(state, m) >= AWAY_SECONDS, you: m === me, couch: false, remote: null, fight: null, // no couch here
  }));
  const limits = {};                                                                       // the rules' limits
  for (const [k, v] of Object.entries(LIMITS)) limits[k] = { kind: v[0], count: v[1] };   // as objects
  return { code: state.code, mode: state.mode, phase: state.phase, host: state.host,       // the party
    env: state.env, envs: state.members.length ? _openEnvs(state) : [], members,
    you: me ? me.user : null, display: false, screen: state.screen || '',
    run: state.phase === 'trip' && state.run ? _runView(state, me, now) : null,
    last: state.last, notes: state.notes || [], revision: state.revision, server_time: now,
    rules: { vote_seconds: VOTE_SECONDS, limits, max: MAX_MEMBERS, turn_seconds: TURN_SECONDS } };
}

module.exports = {
  // constants (erinne names)
  MAX_MEMBERS, VOTE_SECONDS, LIMITS, HOLDER_QUIET, FIGHT_QUIET, TURN_SECONDS, AWAY_SECONDS, IDLE_MS, LOG, WAYS, WORDS, PUZZLE_NAMES,
  PartyError,                       // refusal (a LumiError)
  // the party
  create, act, look, due, parties, view, sweep, codeOf, mine, onTrip, memberOf, holder, options,
  // hooks for the pet module (erinne lumipet calls these)
  afterFight, heal, satchelPotion,
  // helpers (exported for the routes and tests)
  _table, _ms, _read, _systemRandom, _sokobanProgress, _canon, _pyRound,
};
