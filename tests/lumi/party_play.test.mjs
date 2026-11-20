// Lumi Party (src/lumi/party/lumiparty.js), ported from erinne tests/test_lumiparty.py: the lobby, votes, the puzzle
// circle, finds and going home together (paid in SGC), and what the page is told. Fights: party_fight.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { P, D, db, sgc, tuning, eco, save, T0, S, TRIO, NAMES, act, state, put, floor, party, walk, clear, Dice, setBalance } from "./party_harness.mjs";

const [doll, jane, mina] = TRIO;                                        // the three players
const FOURTH = "444444444444444444";                                    // zoe
db.tx(() => save.load(FOURTH, { now: T0 }));                            // zoe has a Lumi too

// ------------------------------------------------------------------ the lobby
test("a party is three at most and sets out when everyone is ready", () => {
  clear();                                                              // fresh
  const code = db.tx(() => P.create(doll, "doll", T0)).code;            // doll makes one
  assert.match(code, /^[0-9A-F]{8}$/);                                  // the page's code box only takes hex
  act(code, jane, "join", { name: "jane" });                            // jane joins
  act(code, mina, "join", { name: "mina" });                            // mina joins
  assert.throws(() => act(code, FOURTH, "join", { name: "zoe" }), /full/); // three at most
  assert.throws(() => db.tx(() => P.create(jane, "jane", T0)), /already in a party/); // one party each
  act(code, doll, "ready");                                             // doll ready
  assert.throws(() => act(code, jane, "start"), /host/);                // only the host sets out
  assert.throws(() => act(code, doll, "start"), /Not everyone/);        // everyone must be ready
  act(code, jane, "ready");                                             // jane ready
  act(code, mina, "ready");                                             // mina ready
  const seen = act(code, doll, "start");                                // go
  assert.equal(seen.phase, "trip");                                     // out
  assert.equal(seen.run.depth, 1);                                      // the first floor
  assert.deepEqual(seen.members.map((m) => m.name), NAMES);             // seat order
  assert.equal(seen.you, doll);                                         // ids are strings
  assert.throws(() => act(code, FOURTH, "join", { name: "zoe" }), /already set out/); // too late
});

test("a Lumi out exploring on her own can't join a party", () => {
  clear();                                                              // fresh
  db.getDb().prepare("INSERT INTO lumi_runs (user_id, state) VALUES (?, ?)").run(mina, JSON.stringify({ over: null })); // mina is out alone
  const code = db.tx(() => P.create(doll, "doll", T0)).code;            // a party
  assert.throws(() => act(code, mina, "join", { name: "mina" }), /on her own/); // refused
  act(code, jane, "join", { name: "jane" });                            // jane is free
  assert.equal(P.codeOf(jane), code);                                   // and in it
});

test("refusals are LumiErrors with erinne's status", () => {
  clear();                                                              // fresh
  assert.throws(() => P.look("NOPE0000", doll, T0), (e) => e instanceof P.PartyError && e.status === 404 && e.code === "not_found"); // gone
  const code = db.tx(() => P.create(doll, "doll", T0)).code;            // a party
  assert.throws(() => act(code, jane, "ready"), (e) => e.status === 403); // not a member
});

// ------------------------------------------------------------------ votes
test("a majority settles a vote at once and one vote waits", () => {
  const code = party();                                                 // three, set out
  let seen = act(code, doll, "move", { way: "e" });                     // one vote
  assert.equal(seen.run.at, "0,0");                                     // still here
  assert.deepEqual(seen.run.party.votes, { [doll]: "e" });              // doll's vote shows
  assert.equal(seen.run.party.ends, T0 + P.VOTE_SECONDS * S);           // the vote clock
  seen = act(code, jane, "move", { way: "e" });                         // a majority
  assert.equal(seen.run.at, "1,0");                                     // moved
  assert.deepEqual(seen.run.party.votes, {});                           // votes cleared
  assert.match(seen.run.say, /The party chooses east\./);               // said
});

test("after the vote time the most votes win, and a tie goes to the dice", () => {
  const code = party();                                                 // three, set out
  walk(code, "e");                                                      // into the hall: w, e or s
  act(code, doll, "move", { way: "w" });                                // one vote
  assert.equal(db.tx(() => P.look(code, doll, T0 + 5 * S)).run.at, "1,0"); // still time
  let seen = db.tx(() => P.look(code, doll, T0 + P.VOTE_SECONDS * S));  // time's up
  assert.equal(seen.run.at, "0,0");                                     // went west
  assert.match(seen.run.say, /The party chooses west\./);               // said
  walk(code, "e");                                                      // back to the hall
  act(code, doll, "move", { way: "e" });                                // one each...
  act(code, jane, "move", { way: "s" });                                // ...
  seen = act(code, mina, "move", { way: "w", rng: Dice([1]) });         // ...settled at once by the dice
  assert.equal(seen.run.at, "1,1");                                     // south (sorted e, s, w: roll 1)
  assert.match(seen.run.say, /The dice choose south\./);                // said
});

test("voting again takes a vote back", () => {
  const code = party();                                                 // three, set out
  act(code, doll, "move", { way: "e" });                                // vote
  const seen = act(code, doll, "move", { way: "e" });                   // again: taken back
  assert.deepEqual(seen.run.party.votes, {});                           // no votes
  assert.equal(seen.run.party.ends, null);                              // no clock
  assert.throws(() => act(code, doll, "move", { way: "n" }), /choices/); // not a way out
});

// ------------------------------------------------------------------ the puzzle circle
function atVault(code, lock) {                                          // erinne _at_vault
  floor(code, { lock });                                                // the floor with this lock
  walk(code, "e");                                                      // the hall
  const seen = walk(code, "e");                                         // the vault door
  assert.equal(seen.run.facing.at, "2,0");                              // facing it
  assert.equal(seen.run.party.puzzle.phase, "pick");                    // pick who goes first
  return seen;                                                          // the view
}

function tries(code, counts) {                                          // erinne _tries
  const st = state(code);                                               // saved
  st.members.forEach((m, i) => { m.puzzles = counts[i]; });             // set each one's count
  put(st);                                                              // save
}

const RUNES4 = () => ({ kind: "runes", code: ["sun", "moon", "star", "leaf"], tries: [] }); // a known rune lock

test("the vote picks who goes first, then the fewest tried, then the last", () => {
  const code = party();                                                 // three, set out
  atVault(code, RUNES4());                                              // at the rune door
  tries(code, [0, 4, 1]);                                               // jane most, mina once, doll never
  act(code, doll, "vote", { target: `m${jane}` });                      // doll votes jane
  let seen = act(code, mina, "vote", { target: `m${jane}` });           // two of three: jane
  const puzzle = seen.run.party.puzzle;                                 // the circle
  assert.equal(puzzle.phase, "attempt");                                // started
  assert.deepEqual(puzzle.order, [jane, doll, mina]);                   // jane, then fewest tried
  assert.equal(puzzle.holder, jane);                                    // jane holds it
  assert.match(seen.run.say, /jane's turn at the runes \(3 guesses\)\./); // said
  assert.throws(() => act(code, doll, "rune", { picks: ["sun", "sun", "sun", "sun"] }), /jane's turn/); // only jane
  const wrong = ["wave", "wave", "wave", "wave"];                       // never right
  const holders = [];                                                   // who held it each turn
  for (let t = 0; t < 4; t++) {
    const before = state(code).run.puzzle;                              // the circle now
    const who = before.order[before.turn];                              // the holder
    holders.push(who);                                                  // remember
    for (let g = 0; g < 3; g++) seen = act(code, who, "rune", { picks: wrong }); // three guesses
  }
  assert.deepEqual(holders, [jane, doll, mina, jane]);                  // round and round
  assert.deepEqual(seen.run.party.puzzle.order, [jane, doll, mina]);    // unchanged
  assert.deepEqual(seen.members.map((m) => m.puzzles), [0 + 2, 4 + 2, 1 + 1]); // each turn begun counts
  const who = seen.run.party.puzzle.holder;                             // the holder now
  const answer = state(code).run.rooms["2,0"].lock.code;                // a new code after 8 guesses
  seen = act(code, who, "rune", { picks: answer });                     // solved
  assert.equal(seen.run.at, "2,0");                                     // everyone walks in
  assert.equal(seen.run.party.puzzle, null);                            // no puzzle
  assert.match(seen.run.say, /opens the door/);                         // said
});

test("a tie for who goes first goes to whoever has tried fewest", () => {
  const code = party();                                                 // three, set out
  atVault(code, RUNES4());                                              // at the rune door
  tries(code, [3, 1, 1]);                                               // jane and mina tied on 1
  act(code, doll, "vote", { target: `m${doll}` });                      // one each
  act(code, jane, "vote", { target: `m${mina}` });                      // ...
  const seen = act(code, mina, "vote", { target: `m${jane}` });         // ...
  assert.deepEqual(seen.run.party.puzzle.order, [jane, mina, doll]);    // jane sits first
});

test("crates are watched move by move and time ends a turn", () => {
  const level = D.SOKOBAN[0];                                           // the first crate level
  const code = party();                                                 // three, set out
  atVault(code, { kind: "sokoban", level: level.id });                  // at the crate door
  act(code, doll, "vote", { target: `m${doll}` });                      // doll first
  let seen = act(code, jane, "vote", { target: `m${doll}` });           // settled
  assert.deepEqual(seen.run.facing.lock.rows, level.rows);              // the page gets the board
  assert.ok(!("level" in seen.run.facing.lock));                        // not the level id
  const step = [..."udlr"].find((m) => P._sokobanProgress(level.rows, m)[0]); // a legal first step
  seen = act(code, doll, "sokoban", { moves: step });                   // one move
  assert.equal(seen.run.party.puzzle.moves, step);                      // the others replay this
  assert.equal(seen.run.party.puzzle.ends, T0 + 180 * S);               // three minutes
  assert.throws(() => act(code, doll, "sokoban", { moves: step + "x" }), /won't move/); // not a move
  seen = db.tx(() => P.look(code, jane, T0 + 181 * S));                 // time's up
  const puzzle = seen.run.party.puzzle;                                 // the circle
  assert.equal(puzzle.holder, jane);                                    // jane's turn now
  assert.equal(puzzle.moves, "");                                       // a fresh board
  assert.match(seen.run.say, /Time's up for doll\./);                   // said
});

test("pass it on, and a holder who leaves hands the puzzle on", () => {
  const code = party();                                                 // three, set out
  atVault(code, { kind: "lights", size: 3, board: [true, false, false, false, false, false, false, false, false] }); // one lamp on
  act(code, doll, "vote", { target: `m${mina}` });                      // mina first
  act(code, jane, "vote", { target: `m${mina}` });                      // settled
  let seen = act(code, mina, "pass");                                   // she passes
  assert.equal(seen.run.party.puzzle.holder, doll);                     // doll next (fewest tried, seat first)
  assert.match(seen.run.say, /mina passes it on\./);                    // said
  seen = act(code, doll, "abandon");                                    // doll goes home mid-turn
  assert.equal(seen.you, null);                                         // not a member now
  const st = state(code);                                               // saved
  assert.deepEqual(st.run.puzzle.order, [mina, jane]);                  // the circle closes
  assert.equal(P.holder(st), jane);                                     // jane carries on
  assert.equal(P.codeOf(doll), null);                                   // doll is free
  assert.equal(st.host, jane);                                          // a new host
});

test("cards take six flips a turn, and cups are one pick that pays everyone standing", () => {
  const deck = ["sun", "moon", "star", "leaf", "sun", "moon", "star", "leaf"]; // pairs four apart
  const code = party();                                                 // three, set out
  floor(code, { game: { kind: "match", deck, found: [], open: null, flips: 0, last: null } }); // a card game
  walk(code, "e");                                                      // the hall
  let seen = walk(code, "s");                                           // the game room
  assert.equal(seen.run.game.kind, "match");                            // cards
  assert.ok(["e", "n", "s", `m${doll}`].every((o) => seen.run.party.options.includes(o))); // ways + who plays
  act(code, doll, "vote", { target: `m${doll}` });                      // doll plays
  act(code, jane, "vote", { target: `m${doll}` });                      // settled
  for (const pick of [0, 1, 2, 3, 4, 5]) seen = act(code, doll, "flip", { picks: [pick] }); // three misses
  assert.notEqual(seen.run.party.puzzle.holder, doll);                  // her turn is over
  floor(code, { game: { kind: "cups", prize: 2 } });                    // a cup game now
  walk(code, "e");                                                      // the hall
  walk(code, "s");                                                      // the game room
  act(code, doll, "vote", { target: `m${jane}` });                      // jane picks
  act(code, jane, "vote", { target: `m${jane}` });                      // settled
  seen = act(code, jane, "cup", { rng: Dice([10]), picks: [2] });       // the right cup
  assert.ok(seen.run.room.done);                                        // played
  assert.equal(seen.run.party.puzzle, null);                            // over
  assert.ok(seen.members.every((m) => m.satchel.coins > 0));            // everyone standing gets coins
  assert.equal(seen.run.event.scenario, "game_win");                    // a win
});

// ------------------------------------------------------------------ finds and going home
test("each member gets their own share, and SGC is paid once each at home", () => {
  const code = party();                                                 // three, set out
  let seen = walk(code, "e");                                           // the hall
  assert.equal(seen.run.event.scenario, "see_treasure");                // a chest
  seen = act(code, mina, "take");                                       // anyone may open it
  assert.deepEqual(seen.members.map((m) => m.satchel.coins), [20, 20, 20]); // a share each (native)
  assert.deepEqual(seen.members.map((m) => m.satchel.potions), [1, 1, 1]); // a potion each
  walk(code, "w");                                                      // back to the start
  const before = TRIO.map((u) => sgc.balance(u));                       // SGC before
  act(code, doll, "vote", { target: "home" });                          // home...
  seen = act(code, jane, "vote", { target: "home" });                   // ...settled
  assert.equal(seen.phase, "lobby");                                    // back in the lobby
  assert.equal(seen.last.how, "home");                                  // home together
  const sgcWin = tuning.scalePayout("party", "win", 20);                // what 20 native coins are in SGC
  assert.ok(sgcWin > 0);                                                // something
  assert.deepEqual(seen.last.members.map((m) => m.ended.coins), [sgcWin, sgcWin, sgcWin]); // SGC actually paid
  TRIO.forEach((u, i) => assert.equal(sgc.balance(u), before[i] + sgcWin)); // in their accounts
  for (const uid of TRIO) assert.ok(save.peek(uid).potions >= 1);       // potions came home
  const refs = db.getDb().prepare("SELECT count(*) AS n FROM lumi_coin_refs WHERE ref LIKE ?").get(`lumi-party:${code}:%`).n; // pay-once refs
  assert.equal(refs, 3);                                                // one per member
});

test("an empty bank keeps the prize owed, and the party is told", () => {
  const code = party(2);                                                // two, set out
  walk(code, "e");                                                      // the hall
  act(code, doll, "take");                                              // 20 each
  walk(code, "w");                                                      // the start
  setBalance(eco, "__LUMI_TOWN_BANK__", 0);                              // the bank is empty
  for (const id of eco.LUMI_ACCOUNT_IDS) setBalance(eco, id, 0);        // and nothing to draw on
  act(code, doll, "vote", { target: "home" });                          // home...
  const seen = act(code, jane, "vote", { target: "home" });             // ...settled
  assert.ok(seen.last.members.every((m) => m.ended.coins === 0 && m.ended.owed > 0)); // owed, not paid
  assert.match(seen.notes.at(-1), /Lumi-Town Bank is closed for a moment, your prize is saved\./); // told
  setBalance(eco, "__LUMI_TOWN_BANK__", 1_000_000);                      // refill for the other tests
});

test("the vault rolls for each member and keys are shared", () => {
  const code = party();                                                 // three, set out
  floor(code, { lock: { kind: "key" } });                               // a key door
  walk(code, "e");                                                      // hall
  walk(code, "s");                                                      // game room
  walk(code, "s");                                                      // key room
  act(code, jane, "take");                                              // the key
  assert.equal(state(code).run.keys, 1);                                // one shared key
  walk(code, "n");                                                      // game room
  walk(code, "n");                                                      // hall
  let seen = walk(code, "e");                                           // at the key door
  assert.deepEqual(seen.run.facing.lock, { kind: "key" });              // a keyhole
  assert.equal(seen.run.party.puzzle, null);                            // no puzzle
  seen = act(code, mina, "unlock");                                     // use it
  assert.equal(seen.run.at, "2,0");                                     // in
  assert.equal(seen.run.satchel.keys, 0);                               // used
  seen = act(code, doll, "take", { rng: Dice([5]) });                   // the vault
  assert.ok(seen.members.every((m) => m.satchel.coins > 0));            // each their own
});

test("the page never sees unvisited rooms or answers", () => {
  const code = party();                                                 // three, set out
  let seen = act(code, doll, "look");                                   // look around
  assert.deepEqual(Object.keys(seen.run.rooms).sort(), ["0,0", "1,0"]); // the start and one blank
  assert.deepEqual(seen.run.rooms["1,0"], { kind: "unknown" });          // a blank
  atVault(code, RUNES4());                                              // at the rune door
  seen = act(code, doll, "look");                                       // look
  assert.ok(!("code" in seen.run.facing.lock));                         // no answer
  assert.equal(seen.run.facing.lock.kind, "runes");                     // just the kind
  assert.ok(!("2,1" in seen.run.rooms));                                // unvisited
  assert.ok(!JSON.stringify(seen).includes("prize"));                   // the cup's secret
});

test("a look with nothing due doesn't write; a long-idle party breaks up", () => {
  const code = party();                                                 // three, set out
  assert.equal(P.due(code, T0 + S), false);                             // nothing due a second later
  const rev = state(code).revision;                                     // the revision
  P.look(code, doll, T0 + S);                                           // read-only look (outside any tx)
  assert.equal(state(code).revision, rev);                              // unchanged
  const later = T0 + P.IDLE_MS + S;                                     // long idle
  assert.equal(P.due(code, later), true);                               // due
  assert.throws(() => db.tx(() => P.look(code, doll, later)), (e) => e.status === 404); // broken up
});

test("sweep breaks up idle parties and frees their members", () => {
  const code = party();                                                 // three, set out
  db.tx(() => P.sweep(T0 + P.IDLE_MS + 2 * S));                         // long after
  assert.equal(P.codeOf(doll), null);                                   // free
  assert.equal(db.getDb().prepare("SELECT 1 FROM lumi_parties WHERE code = ?").get(code), undefined); // gone
});

test("the open-party list shows lobbies with room, and my own", () => {
  clear();                                                              // fresh
  const code = db.tx(() => P.create(doll, "doll", T0)).code;            // doll's party
  const list = P.parties(jane);                                         // as jane sees it
  assert.equal(list[0].code, code);                                     // listed
  assert.equal(list[0].mine, false);                                    // not hers
  assert.equal(list[0].host, "doll");                                   // host name
  assert.equal(list[0].lumis[0].pet, "Lumi");                           // her Lumi's name
  assert.equal(P.parties(doll)[0].mine, true);                          // doll's own
});

test("Python's round and the canonical JSON compare match erinne", () => {
  assert.equal(P._pyRound(2.5), 2);                                     // halves to even
  assert.equal(P._pyRound(3.5), 4);                                     // halves to even
  assert.equal(P._pyRound(2.4), 2);                                     // ordinary
  assert.equal(P._canon({ b: 1, a: { d: 2, c: 3 } }), P._canon({ a: { c: 3, d: 2 }, b: 1 })); // key order doesn't matter
});
