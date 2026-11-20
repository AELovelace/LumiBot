// Lumi City (Doll's design, 2026-11-19; docs/plans/lumi-city.md): the shared walker (walker.js), the city's map
// (city-map.js), its pictures (city-art.js) and the insides of its places (town-inside.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Wk = require("../../public/lumi/lumi-pet/walker.js");
const C = require("../../public/lumi/lumi-pet/city-map.js");
const CA = require("../../public/lumi/lumi-pet/city-art.js");
const TI = require("../../public/lumi/lumi-pet/town-inside.js");
const LAYOUT = require("../../src/lumi/data/city.json");

// ---- walker.js ---------------------------------------------------------------------------------------------------
test("the walker slides along a wall instead of stopping dead", () => {
  const free = (x, y) => y >= 0 && x < 100;                     // a wall at x 100, the floor's edge at y 0
  assert.deepEqual(Wk.slide(free, { x: 95, y: 50 }, 10, 10), { x: 95, y: 60 }); // blocked across: still walks down
  assert.deepEqual(Wk.slide(free, { x: 50, y: 2 }, 5, -5), { x: 55, y: 2 });    // blocked going up: still walks across
  assert.deepEqual(Wk.slide(free, { x: 99, y: 0 }, 5, -5), { x: 99, y: 0 });    // blocked both ways: stays
});

test("walking toward a spot arrives exactly, and a route is followed point by point", () => {
  const free = () => true;
  let at = { x: 0, y: 0 }, went;
  for (let i = 0; i < 20; i++) { went = Wk.toward(free, at, { x: 30, y: 40 }, 10); at = went; if (went.done) break; }
  assert.equal(went.done, true); assert.deepEqual([at.x, at.y], [30, 40]);
  let step = Wk.follow(free, { x: 0, y: 0 }, [{ x: 10, y: 0 }, { x: 10, y: 10 }], 15); // one long step carries round the corner
  assert.deepEqual([step.x, step.y], [10, 5]); assert.equal(step.route.length, 1); assert.equal(step.done, false);
  step = Wk.follow(free, step, step.route, 15);
  assert.equal(step.done, true); assert.deepEqual([step.x, step.y], [10, 10]);
});

test("held directions add up, never faster than one stick", () => {
  const way = Wk.heldWay({ keys: { x: 1, y: 0 }, pad: { x: 0, y: 1 } });
  assert.ok(Math.abs(Math.hypot(way.x, way.y) - 1) < 1e-9);
  assert.deepEqual(Wk.heldWay({}), { x: 0, y: 0 });
});

test("a floor keeps her off the things and finds what's in reach", () => {
  const f = Wk.floor({ things: [{ id: "box", x: 300, box: [260, 200, 80, 220] }, { id: "mat", x: 500, box: [450, 470, 100, 20], wall: true, depth: 474, reachY: 14 }],
                       edge: [150, 850], back: 400, front: 478 });
  assert.equal(f.free(300, 401), false);                        // in front of the box but inside its patch of floor
  assert.equal(f.free(300, 470), true);
  assert.equal(f.reach({ x: 300, y: 450 }), 0);                 // the box
  assert.equal(f.reach({ x: 500, y: 474 }), 1);                 // on the mat
  assert.equal(f.reach({ x: 500, y: 420 }), -1);                // near the mat across, but not on it
  assert.equal(f.reach(f.stand(0)), 0); assert.equal(f.reach(f.stand(1)), 1);
});

// ---- city-map.js -------------------------------------------------------------------------------------------------
const MAP = C.build(LAYOUT, { left: 2, right: 2 });

test("every doorstep, sign and gate is on the street and reachable from either gate", () => {
  const things = C.things(MAP);
  assert.ok(things.length >= 32 + 10 + 2);                       // 32 lots, 10 places, the gates (and the signs)
  ["left", "right"].forEach(side => {
    const from = MAP.gates[side].arrive;
    assert.ok(C.free(MAP, from.x, from.y), side + " gate's arrival tile is walkable");
    things.forEach(t => {
      assert.ok(C.free(MAP, t.x, t.y), t.id + " stands on the street");
      const route = C.path(MAP, from, t);
      assert.ok(route.length, "a way from the " + side + " gate to " + t.id);
      assert.deepEqual(route[route.length - 1], { x: t.x, y: t.y });
    });
  });
});

test("ids and addresses: short enough for ?at=, and named after their lane and town", () => {
  MAP.lots.forEach(l => assert.ok(("plot-" + l.id).length <= 24 && /^[a-z][a-z0-9-]{0,23}$/.test("plot-" + l.id)));
  MAP.places.forEach(p => assert.ok(/^[a-z][a-z0-9-]{0,23}$/.test(p.id)));
  const lot = MAP.lots.find(l => l.id === "l-1-3");
  assert.equal(lot.address, "3 Daisy Lane, LefTown");
  assert.equal(MAP.lots.find(l => l.id === "r-2-1").address, "1 Nova Street, Right-City");
  assert.equal(C.laneName(LAYOUT, "left", 21), "Daisy Lane II");   // the names come round again
  assert.equal(new Set(MAP.lots.map(l => l.id)).size, MAP.lots.length);
});

test("a town growing at its gate never moves anything already built", () => {
  const bigger = C.build(LAYOUT, { left: 5, right: 3 });
  MAP.lots.forEach(l => {
    const same = bigger.lots.find(b => b.id === l.id);
    assert.deepEqual(same.door, l.door, l.id + " keeps its doorstep");
  });
  MAP.places.forEach(p => assert.deepEqual(bigger.places.find(b => b.id === p.id).door, p.door));
  assert.ok(bigger.gates.left.arrive.x < MAP.gates.left.arrive.x);           // the gate moved out with the town
  assert.equal(bigger.lots.length, (5 + 3) * 8);
  // and arriving through the gate always lands on the same tile relative to it
  assert.equal(bigger.gates.left.arrive.x - bigger.x0 * 64, MAP.gates.left.arrive.x - MAP.x0 * 64);
});

test("old addresses still arrive somewhere, and a fresh visit comes in through her own town's gate", () => {
  ["home", "arcade", "tavern", "casino", "garden", "field", "cafe", "market", "office", "lobby-l", "lobby-r", "gate-left", "gate-right", "plot-r-1-8", "nonsense", ""].forEach(at => {
    const spot = C.arrive(MAP, at, "left");
    assert.ok(C.free(MAP, spot.x, spot.y), at + " arrives on the street");
  });
  assert.deepEqual(C.arrive(MAP, "", "right"), MAP.gates.right.arrive);
  assert.deepEqual(C.arrive(MAP, "home", "right"), C.door(MAP, "lobby-r"));
});

test("a TV remote hops to the next stop that way, and districts follow the blocks", () => {
  const start = MAP.gates.left.arrive, next = C.step(MAP, start, "right");
  assert.ok(next && next.x > start.x);
  const out = C.step(MAP, start, "left");                       // one hop left: the gate itself (the way out)...
  assert.equal(out.id, "gate-left");
  assert.equal(C.step(MAP, out, "left"), null);                 // ...and nothing past it
  const hop = C.hop(MAP, start, 1);
  assert.ok(C.free(MAP, hop.x, hop.y) && hop.x > start.x);
  assert.equal(C.district(MAP, start.x), "l3");                 // LefTown's gate counts as the block after its last
  assert.equal(C.district(MAP, C.door(MAP, "arcade").x), "down");
  assert.equal(C.blockIndex("l2"), -2); assert.equal(C.blockIndex("r1"), 1); assert.equal(C.blockIndex("down"), 0);
  assert.match(C.streetAt(MAP, C.door(MAP, "l-1-3").x, C.door(MAP, "l-1-3").y), /Daisy Lane, LefTown/);
  assert.match(C.streetAt(MAP, C.door(MAP, "arcade").x, C.door(MAP, "arcade").y), /Lumi Way, Downtown/);
});

// ---- city-art.js -------------------------------------------------------------------------------------------------
test("every part of the city draws, with owners' names escaped, and a ring and a press box for each doorstep", () => {
  const lots = { "l-1-1": { owner: { id: 2, name: "<b>jane&" }, style: "starter-cottage", yard: {}, suggested: 6000, list_price: 9000 } };
  MAP.chunks.forEach(ch => {
    const part = CA.chunk(MAP, ch, lots, ch.id === "l1");
    const markup = part.ground + part.rows.join("");
    assert.equal(part.rows.length, MAP.rows);
    assert.doesNotMatch(markup, /NaN|undefined|<script/, ch.id);
    assert.doesNotMatch(markup, /<b>jane/);
    MAP.lots.filter(l => l.chunk === ch.id).forEach(l => assert.ok(markup.includes('data-click="thing:lot:' + l.id + '"')));
  });
  const scene = CA.scene(MAP, [CA.chunk(MAP, MAP.chunks[3], {}, false)], { x: -500, w: 2000 }, false);
  for (let r = 0; r < MAP.rows; r++) assert.ok(scene.includes('<g class="lp-cw-folk" data-row="' + r + '">'), "a slot for the Lumis on row " + r);
});

// ---- town-inside.js ----------------------------------------------------------------------------------------------
test("every inside: its things stand where a phone shows them, each can be walked up to and used, and the pictures draw", () => {
  const doors = Array.from({ length: 8 }, (_, i) => ({ door: i + 1, label: "3" + "ABCDEFGH"[i], id: i % 3 ? 17 + i : null, name: i % 3 ? "pal<" + i : null, home: i === 1, open: i === 2 }));
  ["lobby-l", "lobby-r", "hall-l-3", "hall-r-12", "office", "arcade", "casino", "market", "field"].forEach(id => {
    const sp = TI.space(id, { doors: doors, mine: 4 });
    assert.ok(sp, id);
    sp.things.forEach((t, i) => {
      if (sp.kind !== "hall") assert.ok(t.x >= 290 && t.x <= 720, id + ": " + t.id + " is where every screen shows it");
      assert.equal(sp.walk.reach(sp.walk.stand(i)), i, id + ": " + t.id + " can be walked up to");
    });
    const art = TI.art(sp, { on: sp.things[0].id, night: id === "office" });
    assert.doesNotMatch(art, /NaN|undefined|<script|pal</, id);
    sp.things.forEach(t => assert.ok(art.includes('data-click="thing:' + t.id + '"'), id + ": " + t.id + " can be pressed"));
  });
  const hall = TI.space("hall-l-3", { doors: doors, mine: 4 });
  assert.equal(hall.things.filter(t => t.act.indexOf("door:") === 0).length, 8);
  assert.match(hall.things.find(t => t.id === "door-4").name, /My front door \(3D\)/);
  assert.equal(TI.parse("hall-r-12").town, "right"); assert.equal(TI.parse("hall-r-12").floor, 12);
  assert.equal(TI.parse("tavern"), null);                          // the tavern opens Lumi Dungeons: no inside of its own here
});
