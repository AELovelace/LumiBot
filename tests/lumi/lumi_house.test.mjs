// Lumi's house art (static/games/lumi-pet/house.js) against the server's catalog (lumipet_data/house.json):
// every object that can be bought has a drawing, every spot has a layer, and the markup is well formed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const H = createRequire(import.meta.url)("../../public/lumi/lumi-pet/house.js");
createRequire(import.meta.url)("../../public/lumi/lumi-pet/room-styles.js"); // room mode's things add their 15 styles each to H.ART
const catalog = JSON.parse(readFileSync(new URL("../../src/lumi/data/house.json", import.meta.url), "utf8"));
const owned = catalog.spots.filter(spot => !spot.same_as);                              // (the kitchen's and den's walls share the bedroom's pieces)
const bedroom = owned.filter(spot => !spot.room);                                         // her furniture: house.js's layers (room mode's things are room-styles.js's)
const firsts = Object.fromEntries(bedroom.map(spot => [spot.id, spot.items[0].id]));

test("every spot has a layer and every object a drawing with no broken numbers", () => {
  assert.deepEqual([...H.LAYERS].sort(), bedroom.map(spot => spot.id).sort());
  for (const spot of owned) for (const item of spot.items) {
    assert.equal(typeof H.ART[item.id], "function", item.id + " needs art");
    const art = H.ART[item.id]();
    assert.equal(/NaN|undefined|Infinity/.test(art), false, item.id + " drew a broken number");
    if (item.id !== "curtain-none") assert.ok(art.length > 40, item.id + " drew nothing");
  }
});

test("every window frame has an opening for the view to show through", () => {
  for (const item of catalog.spots.find(spot => spot.id === "frame").items) assert.match(H.CLIPS[item.id], /^M[\d .A-Za-z-]+Z$/);
});

test("the room draws back to front in a wide canvas, repeating the wall, floor and windows across it", () => {
  const room = H.render({ ...firsts, frame: "frame-hex", view: "view-sea" }, false);
  const order = H.LAYERS.map(spot => room.indexOf('data-spot="' + spot + '"'));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every(at => at >= 0));
  const layer = spot => room.slice(room.indexOf('data-spot="' + spot + '"'), room.indexOf("data-spot=", room.indexOf('data-spot="' + spot + '"') + 10) >>> 0 || undefined);
  for (const spot of ["wallpaper", "floor"]) assert.deepEqual(layer(spot).match(/<g transform="translate\((-?\d+) 0\)">/g).length, 3, spot);
  assert.ok(layer("wallpaper").includes('translate(-100 0)') && layer("wallpaper").includes('translate(700 0)'), "The wall covers the whole 1000-wide room");
  for (const x of H.WINDOWS) for (const spot of ["view", "frame"]) assert.ok(layer(spot).includes('<g transform="translate(' + x + ' 0)">'), spot + " at " + x);
  assert.equal(layer("rug").match(/<g transform="translate\(300 0\)">/g).length, 1, "Furniture stands once, in the middle");
  assert.ok(layer("plant").includes('<g transform="translate(382 0)">'), "The plant stands clear of the lamp");
  assert.equal(room.match(/<g[ >]/g).length, room.match(/<\/g>/g).length);
  assert.equal(room.match(/<defs>/g).length, room.match(/<\/defs>/g).length);
});

test("the windows are holes in the wall, shaped like the frame", () => {
  const room = H.render({ ...firsts, frame: "frame-hex" }, true);
  const mask = room.slice(room.indexOf('<mask id="lp-wall-mask"'), room.indexOf("</mask>"));
  assert.equal(mask.split(H.CLIPS["frame-hex"]).length - 1, 3, "One hole per window");
  assert.ok(H.WINDOWS.every(x => mask.includes('transform="translate(' + x + ' 0)" fill="#000"')));
  assert.ok(room.includes('data-spot="wallpaper" mask="url(#lp-wall-mask)"'));
  assert.ok(!room.includes('data-spot="floor" mask'), "Only the wall is cut");
});

test("with scenery behind the page the free view leaves the windows open; otherwise a view is painted in", () => {
  const open = H.render(firsts, true), painted = H.render(firsts, false), bought = H.render({ ...firsts, view: "view-snow" }, true);
  assert.ok(open.includes('<g data-spot="view" data-open="true"></g>'), "Nothing is drawn in the holes: the backdrop shows through");
  assert.ok(!open.includes("lp-px"));
  for (const room of [painted, bought]) {
    assert.ok(!room.includes("data-open") && room.includes('clip-path="url(#lp-view-clip)"'));
    assert.equal(room.match(/class="lp-px lp-px-1"/g).length, 3, "The view shows in all three windows");
  }
  assert.ok(bought.includes("lp-fall-snow"));
});

test("an object the art doesn't know is left out rather than breaking the room", () => {
  const room = H.render({ ...firsts, rug: "rug-from-the-future", bed: "__proto__", frame: "constructor" }, false);
  assert.ok(room.includes('<g data-spot="rug"></g>') && room.includes('<g data-spot="bed"></g>'));
  assert.ok(room.includes(H.CLIPS["frame-arch"]));
});

test("every view scrolls three strips whose tiles repeat, so the loop has no seam", () => {
  for (const item of catalog.spots.find(spot => spot.id === "view").items) {
    const art = H.ART[item.id]();
    for (const depth of [1, 2, 3]) assert.ok(art.includes('class="lp-px lp-px-' + depth + '"'), item.id + " strip " + depth);
    assert.equal(art.match(/transform="translate\(240 0\)"/g).length, 3);
    assert.ok(art.includes("lp-sky-day") && art.includes("lp-night-veil"));
  }
});
