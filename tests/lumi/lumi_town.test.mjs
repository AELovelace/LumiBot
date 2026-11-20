// Lumi Town (town-ui.js, town-art.js; Doll's design, 2026-11-12): the map behind her room's door, the places on it and
// the games inside them, and the drawings of each, day and night, with nothing broken in them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Tw = require("../../public/lumi/lumi-pet/town-ui.js");
const TwA = require("../../public/lumi/lumi-pet/town-art.js");
const TF = require("../../public/lumi/lumi-pet/town-folk.js");
const HIGH = ["arcade", "tavern", "casino", "home", "garden", "field"];

function ctx(extra) { // What game.js hands the rows, recording what they asked for.
  const asked = [];
  return Object.assign({ at: null, street: "high", desk: true, away: false, retro: true, seen: true, asked: asked,
    go: change => asked.push(["go", change]), open: (slug, back, words) => asked.push(["open", slug, back, words]) }, extra);
}

test("the High Street has Doll's six places, in two rows of three, each pressable on the drawing", () => {
  assert.deepEqual(Tw.street("high").map(p => p.id), HIGH);
  const c = ctx(), rows = Tw.rows(c);
  assert.deepEqual(rows.map(r => r.key), HIGH.map(id => "place-" + id).concat(["street-market", "seen"]), "Then the way to Market Street, and Show me in town");
  rows.slice(0, 6).forEach(r => r.local());
  assert.deepEqual(c.asked.map(a => a[1].enter), HIGH, "Each row walks to its own place");
  assert.deepEqual(Object.keys(TwA.MAP).sort(), [...HIGH].sort(), "Every place has a spot on the map");
  const map = TwA.scene({ cursor: "arcade", label: "Arcade" });
  for (const id of HIGH) assert.ok(map.includes('data-click="place:' + id + '"'), id + " can be pressed");
  assert.ok(map.includes('data-click="street:market"'), "The signpost to Market Street can be pressed");
  for (const id of HIGH) { const at = TwA.MAP[id]; assert.ok(at[0] - 66 >= 285 && at[0] + 66 <= 715, id + " sits in the middle every screen shows"); }
});

test("Market Street: the Retro café and the Market, round the corner and back", () => {
  assert.deepEqual(Tw.street("market").map(p => p.id), ["cafe", "market"]);
  const c = ctx({ street: "market" }), rows = Tw.rows(c);
  assert.deepEqual(rows.map(r => r.key), ["place-cafe", "place-market", "street-high", "seen"]);
  rows[2].local();
  assert.deepEqual(c.asked[0], ["go", { street: "high" }]);
  Tw.rows(ctx()).find(r => r.key === "street-market").local.call();
  const street = TwA.scene({ street: "market", cursor: "cafe", label: "Retro café" });
  assert.match(street, /data-town="market-street"/);
  for (const click of ["place:cafe", "place:market", "street:high"]) assert.ok(street.includes('data-click="' + click + '"'), click + " can be pressed");
  for (const id of ["cafe", "market"]) { const at = TwA.MARKET[id]; assert.ok(at[0] - 66 >= 285 && at[0] + 66 <= 715, id + " sits in the middle every screen shows"); }
  for (const to of ["high", "market"]) { const s = TwA.spot(null, "street:" + to); assert.ok(s.x >= 300 && s.x <= 700 && s.y <= 480, "By the signpost: " + JSON.stringify(s)); }
  assert.deepEqual(Tw.arrive("cafe"), { street: "market", inside: null, cursor: 0 });
  assert.deepEqual(Tw.arrive("market"), { street: "market", inside: "market", cursor: 1 });
});

test("the Retro café opens Retro, and says it's closed while Retro is off", () => {
  const cafe = Tw.place("cafe");
  assert.equal(cafe.retro, true);
  const open = Tw.rows(ctx({ street: "market" }))[0], shut = Tw.rows(ctx({ street: "market", retro: false }))[0];
  assert.equal(typeof open.local, "function");
  assert.equal(shut.local, undefined);
  assert.match(shut.note, /Retro on/);
});

test("the Market: a row per stall, a stall's own wares, and back", () => {
  const stalls = Tw.inside("market").games.map(g => g.stall);
  assert.deepEqual(stalls, ["store", "capsules", "seeds", "garden"]);
  const c = ctx({ at: "market" }), rows = Tw.rows(c);
  assert.deepEqual(rows.map(r => r.key), stalls.map(s => "stall-" + s).concat(["leave"]));
  assert.match(rows[4].name, /Market Street/, "Out of the Market is back on Market Street");
  rows[1].local();
  assert.deepEqual(c.asked[0], ["go", { stall: "capsules" }]);
  const at = Tw.rows(ctx({ at: "market", stall: "store", stallRows: id => [{ key: "cookie", name: "Cookie " + id, send: { action: "buy", item: "cookie" } }] }));
  assert.deepEqual(at.map(r => r.key), ["cookie", "stall-back"], "The stall's wares, then back to the stalls");
  assert.equal(at[0].name, "Cookie store");
  const market = TwA.scene({ at: "market", cursor: 0, games: stalls });
  for (const s of stalls) assert.ok(market.includes('data-click="stall:' + s + '"'), s + " can be pressed");
});

test("Show me in town: on, or off with a word on what it means", () => {
  const on = Tw.rows(ctx()).find(r => r.key === "seen"), off = Tw.rows(ctx({ seen: false })).find(r => r.key === "seen");
  assert.match(on.name, /on$/);
  assert.match(off.name, /off$/);
  assert.deepEqual(on.send, { action: "town_seen" });
});

test("the townsfolk stay on the streets every screen shows, and some go home at night", () => {
  for (const street of ["high", "market"]) {
    const day = TF.folkOn(street, false), night = TF.folkOn(street, true);
    assert.ok(day.length >= 2 && night.length >= 1 && night.length < day.length, street + ": fewer out after dark");
    day.forEach((f, i) => {
      let x = TF.start(f, i);
      assert.ok(x >= TF.WALK_MIN && x <= TF.WALK_MAX);
      for (let n = 0; n < 200; n++) { x = TF.next(x, [((n * 37) % 100) / 100, ((n * 53) % 100) / 100]); assert.ok(x >= TF.WALK_MIN && x <= TF.WALK_MAX, f.id + " stays on the street: " + x); }
      assert.ok([TF.STREET_Y, TF.LANE_Y].includes(TF.y(f)));
      for (const slot of Object.keys(f.look.outfit)) assert.match(f.look.outfit[slot], /^acc-/, f.id + " wears Lumi's own clothes");
    });
    assert.ok(TF.line(street, false, 0.5).length > 3 && TF.line(street, true, 0.99).length > 3);
  }
  assert.ok(TF.pause(0) >= 2000 && TF.pause(1) <= 8000);
});

test("Lumi's own apps open straight away; the Arcade, Casino and field have games inside", () => {
  assert.equal(Tw.place("tavern").app, "lumi-dungeons");
  assert.equal(Tw.place("garden").app, "lumi-garden");
  assert.equal(Tw.place("home").app, "lumi-pet");
  assert.ok(Tw.place("home").home, "Leaving her house doesn't come back to the town");
  assert.deepEqual(Tw.inside("arcade").games.map(g => g.slug), ["breakout", "snake", "teacup-tower", "prism-drop", "lumi-launch"], "Doll picked the Lumi games: no StickBob Runner");
  assert.deepEqual(Tw.inside("casino").games.map(g => g.slug), ["blackjack", "roulette", "horse-racing", "slots"]);
  assert.deepEqual(Tw.inside("field").games.map(g => g.slug), ["lumi-soft"]);
  assert.equal(Tw.inside("tavern"), null);
  assert.equal(Tw.inside("nowhere"), null);
});

test("inside a place: a row per game that opens it and comes back to this place, then the way out", () => {
  const c = ctx({ at: "casino" }), rows = Tw.rows(c);
  assert.deepEqual(rows.map(r => r.key), ["game-blackjack", "game-roulette", "game-horse-racing", "game-slots", "leave"]);
  rows[1].local();
  assert.deepEqual(c.asked[0].slice(0, 3), ["open", "roulette", "casino"]);
  assert.match(c.asked[0][3], /Roulette/);
  rows[4].local();
  assert.deepEqual(c.asked[1], ["go", { leave: true }]);
});

test("Lumi-Soft needs a mouse and keyboard: on a TV or a phone its row only says so", () => {
  const desk = Tw.rows(ctx({ at: "field" }))[0], tv = Tw.rows(ctx({ at: "field", desk: false }))[0];
  assert.equal(typeof desk.local, "function");
  assert.equal(tv.local, undefined);
  assert.match(tv.note, /mouse and keyboard/);
});

test("a page opened at ?at= starts inside that place, or in front of it on its street's map", () => {
  assert.deepEqual(Tw.arrive("arcade"), { street: "high", inside: "arcade", cursor: 0 });
  assert.deepEqual(Tw.arrive("garden"), { street: "high", inside: null, cursor: 4 });
  assert.deepEqual(Tw.arrive("home"), { street: "high", inside: null, cursor: 3 });
  assert.deepEqual(Tw.arrive(null), { street: "high", inside: null, cursor: 1 }, "No place given: in front of the tavern");
  assert.deepEqual(Tw.arrive("<script>"), { street: "high", inside: null, cursor: 1 });
});

test("the tavern's row says where she is while she's out on a trip", () => {
  assert.match(Tw.rows(ctx({ away: true }))[1].hint, /out exploring/);
});

test("every picture draws, day and night, with nothing broken in it", () => {
  const pictures = [["map", null, "tavern"], ["arcade", "arcade", 2], ["casino", "casino", 0], ["field", "field", 0], ["market-street", null, "market", "market"],
    ["market", "market", 1]];
  for (const [name, at, cursor, street] of pictures) for (const night of [false, true]) {
    const games = at ? Tw.inside(at).games.map(g => g.slug || g.stall) : [];
    const drawn = TwA.scene({ at: at, cursor: cursor, games: games, label: "Tavern", night: night, street: street });
    assert.ok(drawn.length > 4000, name + ": a whole picture, not a stub");
    assert.equal(/NaN|undefined|Infinity/.test(drawn), false, name + ": no broken numbers");
    assert.equal(/<script|\son[a-z]+=/i.test(drawn), false, name + ": only shapes");
    assert.equal((drawn.match(/<g[ >]/g) || []).length, (drawn.match(/<\/g>/g) || []).length, name + ": every group is closed");
    assert.match(drawn, new RegExp('data-town="' + name + '"'));
    assert.equal(/<(circle|ellipse|path|rect|text)[^>]*class="lp-tw-glow"/.test(drawn), false, name + ": a breathing light's group holds the animation, not the shape");
    assert.ok(drawn.includes('class="lp-tw-on"'), name + ": what the cursor is on is lit");
    if (at) {
      for (const slug of games) assert.ok(drawn.includes('data-click="' + (at === "market" ? "stall:" : "game:") + slug + '"'), name + ": " + slug + " can be pressed");
      assert.ok(drawn.includes('data-click="leave"'), name + ": the way out can be pressed");
    }
  }
  assert.notEqual(TwA.scene({ cursor: "home" }), TwA.scene({ cursor: "home", night: true }), "Night looks different");
  assert.equal(TwA.scene({ cursor: "home" }), TwA.scene({ cursor: "home" }), "The same town every time (seeded stones and stars)");
});

test("the picked place's label is escaped: nothing becomes markup", () => {
  const drawn = TwA.scene({ cursor: "home", label: "Lumi's <b>house</b> & \"more\"" });
  assert.ok(drawn.includes("Lumi's &lt;b&gt;house&lt;/b&gt; &amp; &quot;more&quot;"));
  assert.equal(drawn.includes("<b>"), false);
});

test("Lumi stands at the door on the map, at a station inside, and on the exit mat for the way out", () => {
  assert.deepEqual(TwA.spot(null, "tavern"), { x: 500, y: 268 });
  assert.deepEqual(TwA.spot(null, "field"), { x: 645, y: 474 });
  assert.deepEqual(TwA.spot("arcade", 0, 4), { x: TwA.STATIONS[0], y: 452 });
  assert.deepEqual(TwA.spot("arcade", 4, 4), { x: 500, y: 474 }, "One past the games: the exit");
  assert.deepEqual(TwA.stations(4), TwA.STATIONS, "Four stations stand where they always did (the Casino's tables)");
  assert.deepEqual(TwA.stations(5), [356, 428, 500, 572, 644], "The Arcade's five, snug in the middle every screen keeps clear");
  assert.deepEqual(TwA.spot("arcade", 4, 5), { x: 644, y: 452 }, "Lumi Launch's cabinet, the fifth");
  const five = TwA.scene({ at: "arcade", cursor: 0, games: ["breakout", "snake", "teacup-tower", "prism-drop", "lumi-launch"] });
  assert.equal((five.match(/scale\(0\.8\)/g) || []).length, 5, "five cabinets stand a little smaller");
  for (const x of TwA.stations(5)) assert.ok(x - 42 * TwA.SNUG >= 302 && x + 42 * TwA.SNUG <= 680, "each cabinet clear of the panels at 1440x1000: " + x);
  assert.deepEqual(TwA.spot("field", 0, 1), { x: 440, y: 452 });
  for (const at of [null, "arcade", "casino", "field", "market"]) for (let i = 0; i < 6; i++) {
    const s = TwA.spot(at, at ? i : Tw.PLACES[i].id, at ? Tw.inside(at).games.length : 0);
    assert.ok(s.x >= 300 && s.x <= 700 && s.y <= 480, "Always where every screen can see her: " + JSON.stringify([at, i, s]));
  }
});

// ---- Local chat (docs/plans/lumi-pet-social.md phase 2, 2026-11-19): a "Say something" row on every map and inside every
// place; chatting lists the quick phrases (a remote or a pad can say them), typing, muting whoever's here, and back.
test("Say something is on the map and inside a place, and opens the chat list", () => {
  const said = [];
  const chat = { on: false, phrases: [{ id: "hi", icon: "👋", text: "Hi!" }, { id: "gg", icon: "🏆", text: "Good game!" }],
                 people: [{ id: 7, name: "bob", muted: false }, { id: 9, name: "cat", muted: true }],
                 open: () => said.push("open"), close: () => said.push("close"), say: id => said.push("say:" + id), type: () => said.push("type"), mute: id => said.push("mute:" + id) };
  const base = { street: "high", go() {}, open() {}, chat };
  const map = Tw.rows({ ...base, at: null });
  assert.equal(map[map.length - 1].key, "say", "on the map, last");
  const inside = Tw.rows({ ...base, at: "arcade" });
  assert.deepEqual(inside.slice(-2).map(r => r.key), ["say", "leave"], "inside: just before the way out");
  inside.find(r => r.key === "say").local();
  const open = Tw.rows({ ...base, at: "arcade", chat: { ...chat, on: true } });
  assert.deepEqual(open.map(r => r.key), ["say-hi", "say-gg", "say-type", "mute-7", "mute-9", "say-back"]);
  assert.equal(open[0].name, "“Hi!”");
  assert.deepEqual([open[3].name, open[4].name], ["Mute bob", "Unmute cat"]);
  open.forEach(r => r.local());
  assert.deepEqual(said, ["open", "say:hi", "say:gg", "type", "mute:7", "mute:9", "close"]);
  assert.ok(!Tw.rows({ ...base, at: null, chat: undefined }).some(r => r.key === "say"), "no chat given (older callers): no row");
});

test("each street's map has a way to friends' flats; at home the chat list can show a guest out", () => {
  let opened = 0;
  const map = Tw.rows({ at: null, street: "market", go() {}, open() {}, visit: () => opened++ });
  const row = map.find(r => r.key === "flats");
  assert.ok(row, "the Visit a friend's flat row");
  row.local(); assert.equal(opened, 1);
  assert.ok(!Tw.rows({ at: "arcade", street: "high", go() {}, open() {}, visit() {} }).some(r => r.key === "flats"), "only on the maps");
  const shown = [];
  const chat = { on: true, phrases: [], people: [{ id: 4, name: "jane", muted: false, block: true }, { id: 5, name: "kim", muted: false }],
                 say() {}, type() {}, close() {}, mute() {}, block: id => shown.push(id) };
  const list = Tw.chatRows(chat).map(r => r.key);
  assert.deepEqual(list, ["say-type", "mute-4", "block-4", "mute-5", "say-back"], "Show out only for a guest in her own flat");
  Tw.chatRows(chat).find(r => r.key === "block-4").local(); assert.deepEqual(shown, [4]);
});

test("emotes sit after the phrases in the chat list, and each says which one", () => {
  const done = [];
  const chat = { on: true, phrases: [{ id: "hi", icon: "👋", text: "Hi!" }], emotes: [{ id: "wave", icon: "👋", text: "Wave" }, { id: "dance", icon: "💃", text: "Dance" }],
                 people: [], say() {}, emote: id => done.push(id), type() {}, close() {}, mute() {} };
  const rows = Tw.chatRows(chat);
  assert.deepEqual(rows.map(r => r.key), ["say-hi", "emote-wave", "emote-dance", "say-type", "say-back"]);
  rows.filter(r => r.key.startsWith("emote-")).forEach(r => r.local());
  assert.deepEqual(done, ["wave", "dance"]);
});
