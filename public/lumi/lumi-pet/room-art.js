/* Room mode's drawings (Doll's design, 2026-11-19): what stands in Lumi's kitchen, bedroom and den, and where. The
   rooms' walls, floors and windows are her own from house.js (render with `only`): each room can have its own
   wallpaper and floor, or a plain painted colour (the kitchen's and den's follow the bedroom's until changed). The
   things themselves (fridge, bowl, counter, potion shelf, wardrobe, terminal, capsule machine, paint pots) are drawn
   by room-styles.js in whichever of their 15 styles she has put out. Her bedroom's furniture is house.js's own,
   spread out for room mode (BEDROOM_SHIFT), with humble stand-ins where she hasn't unpacked a piece yet.

   Plain SVG in the room's own 1000 x 500 coordinates, at the places room-ui.js gives each thing's press box.
   All authored here or in room-styles.js: nothing a person typed goes into it. */
(function (root, make) {
  const node = typeof module === "object" && module.exports;
  const art = make(node ? require("./room-styles.js") : root.LumiPetRoomStyles);
  if (node) module.exports = art; else root.LumiPetRoomArt = art;
})(typeof self !== "undefined" ? self : this, function (Styles) {
  "use strict";

  const GLOW = "var(--pet-glow)";                 // Her glow: accents follow it.
  const LINE = "#5a3a6e";                         // Outlines, as in house.js.
  // The layers of her bedroom that make the other rooms hers too (house.js render's `only`): no door, furniture or boxes.
  const SHELL = ["wallpaper", "floor", "view", "frame", "curtains", "ceiling"];
  // Each room's own wall and floor spots in the house catalog (the bedroom's are the originals).
  const WALLS = { bedroom: ["wallpaper", "floor"], kitchen: ["kitchen-wall", "kitchen-floor"], den: ["den-wall", "den-floor"] };

  // ---- Small drawing helpers (the same shapes house.js uses).
  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function path(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function group(inner, more) { return "<g " + (more || "") + ">" + inner + "</g>"; }
  function shadow(x, y, rx) { return oval(x, y, rx, 9, "#000", 'opacity=".22"'); } // The soft shadow under anything standing on the floor.
  const OUT = 'stroke="' + LINE + '" stroke-width="3"';                              // The outline every piece has.

  // ---- Stand-ins: a Lumi who has just moved in has no bed, toy chest or trophy shelf of her own yet (house.js draws
  // nothing for an empty spot), but in room mode those are how you nap, play and see her collection. So until she owns
  // one, something humble stands in its place: a mattress on the floor, a cardboard box of toys, a plank shelf.
  function mattress() {
    return shadow(638, 470, 62) + rect(582, 438, 112, 30, "#e8dff2", 'rx="10" ' + OUT) + rect(590, 426, 34, 16, "#fff", 'rx="7" ' + OUT) + // the mattress and a pillow
      path("M626 438 Q660 428 690 440 L690 452 Q660 446 626 452 Z", GLOW, 'opacity=".6"');                                                   // a little blanket in her glow
  }
  function toybox() {
    return shadow(390, 474, 42) + rect(356, 424, 70, 48, "#c8955f", 'rx="3" ' + OUT) + path("M356 424 L346 410 L382 414 Z M426 424 L436 410 L400 414 Z", "#b07d4a", OUT) + // a box, flaps open
      circle(380, 418, 10, "#ff8ecb", OUT) + rect(394, 404, 10, 20, "#70ebea", 'rx="3" ' + OUT) + path("M372 444 H410", "none", 'stroke="#8a5a3b" stroke-width="3"'); // a ball, a block, "TOYS"
  }
  function plank() {
    return rect(372, 138, 72, 8, "#8a5a3b", 'rx="2" ' + OUT) + path("M380 146 L384 156 M436 146 L432 156", "none", 'stroke="' + LINE + '" stroke-width="3"') + // a plank on two brackets
      path("M408 108 L413 122 L427 124 L416 132 L420 138 L408 132 L396 138 L400 132 L389 124 L403 122 Z", "none", 'stroke="' + GLOW + '" stroke-width="2.5" stroke-dasharray="4 3"'); // a dotted star: room for a first trophy
  }
  const STAND_INS = { bed: mattress, toychest: toybox, trophy: plank }; // house.js spot → what stands in while it's empty

  // ---- Where everything stands in room mode (Doll's layout pass, 2026-11-19). Each thing is drawn where it was first
  // sketched (room-styles.js), then moved by [dx, dy] here: spread across the room (about x 200-820, all of which a
  // computer screen shows) and stood back from the front edge, so nothing's foot comes below y 430. The lower bar
  // covers the drawing from about y 440 down (tests/js/lumi_room.test.mjs keeps it so). Back to front, per room.
  const FLOOR = 430;                                   // The front-most foot of anything in the room: the lower bar starts below it.
  const PLACE = {
    kitchen: { counter: [100, 0], potions: [60, 0], fridge: [-40, -55], bowl: [-30, -40], paints: [230, -40] },
    bedroom: { paints: [-50, -40] },                   // on the rug, leaving the moving boxes room by the bed
    den: { wardrobe: [-60, -45], terminal: [0, -45], paints: [50, -40], capsules: [60, -45] },
  };
  const BEDROOM_SHIFT = { // Her own furniture (house.js spots), and the moving boxes while there are any.
    door: [-40, 0], lamp: [-40, 0], toychest: [-4, -45], sidetable: [-10, 0], bed: [90, -35], plant: [400, 0], boxes: [0, -62],
    rug: [0, -40], // under her feet on the raised floor line, not under the lower bar
  };

  function moved(at, markup) { // Markup moved by [dx, dy].
    return at && (at[0] || at[1]) ? group(markup, 'transform="translate(' + at[0] + " " + at[1] + ')"') : markup;
  }

  function view(id, house, extra) { // The house as one room sees it: its own wall and floor (else the bedroom's), and any piece being tried.
    // extra: [spot, piece or "#rrggbb"] being tried on or painted (the Home menu's preview), in this room's terms.
    const out = Object.assign({}, house || {}), own = WALLS[id] || WALLS.bedroom;
    if (extra) out[extra[0]] = extra[1];
    out.wallpaper = out[own[0]] || out.wallpaper; out.floor = out[own[1]] || out.floor; // the bedroom's, until this room has its own
    return out;
  }

  function scene(id, house) { // A room's things as SVG markup, drawn over its walls and floor. An unknown room has none.
    // `house` ({spot: piece}): which style of each thing she has out, and (the bedroom) stand-ins for spots still empty.
    const things = PLACE[id] || {};
    let out = Object.keys(things).map(function (thing) { return moved(things[thing], Styles.draw(thing, (house || {})[thing])); }).join("");
    if (id === "bedroom") Object.keys(STAND_INS).forEach(function (spot) { if (!house || !house[spot]) out = moved(BEDROOM_SHIFT[spot], STAND_INS[spot]()) + out; }); // behind the paint pots
    return out;
  }

  return { SHELL: SHELL, WALLS: WALLS, STAND_INS: STAND_INS, PLACE: PLACE, BEDROOM_SHIFT: BEDROOM_SHIFT, FLOOR: FLOOR, view: view, scene: scene };
});
