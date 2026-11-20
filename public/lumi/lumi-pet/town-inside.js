/* The insides of Lumi City's places (Doll's design, 2026-11-19; docs/plans/lumi-city.md): rooms seen from the front,
   like her flat, where she walks freely along the floor (walker.js floor()) and uses whatever she walks up to.

   - Lumi Heights West and East (lobby-l, lobby-r): the apartment buildings, one for each town. A lobby with the front
     desk (the residents' list: walk to a friend's door), the mailboxes, and the lift up to the floors.
   - A floor of Lumi Heights (hall-l-3: LefTown's building, floor 3): a hallway of eight front doors with nameplates.
     Her own door takes her home (Lumi Pet); a friend's goes to their doorstep (knock, or walk in where it's open).
   - The real-estate office: land for sale, the neighbours' listings board, house styles, the yard shop and the
     Keepsake Capsule machine.
   - The Arcade, the Casino, the Market and the Lumi-Soft field: their old pictures (town-art.js), now walked about in.

   This file is the rooms' things (where each stands, its press box, what it does: `act`) and the new pictures. Pure:
   game.js asks space(id, ctx) for a room and draws art(opts). Nothing a person typed goes into a picture unescaped. */
(function (root, make) {
  const node = typeof module === "object" && module.exports;
  const inside = node ? make(require("./walker.js"), require("./town-art.js"), require("./town-ui.js"))
    : make(root.LumiWalker, root.LumiPetTownArt, root.LumiPetTown);           // the walker, the town's drawing kit, and the town's lists
  if (node) module.exports = inside; else root.LumiTownInside = inside;
})(typeof self !== "undefined" ? self : this, function (Walker, TwA, Tw) {
  "use strict";
  const K = TwA.KIT, rect = K.rect, circle = K.circle, oval = K.oval, path = K.path, line = K.line, text = K.text, group = K.group, glow = K.glow,
    esc = K.esc, tube = K.tube, box = K.box, neon = K.neon, reflect = K.reflect, NEON = K.NEON, HOT = K.HOT, INK = K.INK, STEEL = K.STEEL;

  const FLOOR = { back: 410, front: 478, edge: [150, 850], half: 24, near: 26, shrink: 0.12 }; // Every inside's floor (drawing units): her feet between back and front.
  const DOORS = 8;                       // front doors on each floor of Lumi Heights
  const LETTERS = "ABCDEFGH";            // a door's letter: flat 3B is floor 3, the second door
  const TOWN_NAME = { left: "LefTown", right: "Right-City" };

  function parse(id) { // What kind of room an id is: {kind, town, floor} (null for an unknown id).
    if (/^lobby-[lr]$/.test(id || "")) return { kind: "lobby", town: id.slice(-1) === "l" ? "left" : "right", floor: 0 };
    const hall = /^hall-([lr])-(\d{1,4})$/.exec(id || "");
    if (hall) return { kind: "hall", town: hall[1] === "l" ? "left" : "right", floor: Number(hall[2]) };
    if (id === "office") return { kind: "office", town: null, floor: 0 };
    const place = Tw.inside(id);                                    // the Arcade, the Casino, the Market, the field
    return place ? { kind: "games", town: null, floor: 0, place: place } : null;
  }

  function hallId(town, floor) { return "hall-" + (town === "right" ? "r" : "l") + "-" + floor; } // a floor's room id
  function lobbyId(town) { return town === "right" ? "lobby-r" : "lobby-l"; }                       // a town's lobby

  const EXIT = { id: "exit", act: "leave", icon: "🚪", name: "Out to the street", hint: "Back out into Lumi City", say: "The way out, onto the street!",
                 x: 500, box: [440, 462, 120, 36], wall: true, depth: 474, reachY: 14 };   // the mat by the front: only in reach standing on it

  function gamesThings(place) { // The Arcade's cabinets, the Casino's tables, the Market's stalls, the field's cushion: where the old pictures draw them.
    const n = place.games.length, xs = TwA.stations(n);
    const things = place.games.map(function (g, i) {
      const x = xs[i];
      const boxes = { arcade: [x - 44, 166, 88, 290], casino: [x - 44, 150, 88, 306], market: [x - 46, 206, 92, 250] };
      const t = { id: g.slug || g.stall, act: g.stall ? "stall:" + g.stall : "game:" + g.slug, icon: g.icon, name: g.name, hint: g.hint, say: g.name + "! " + g.hint + ".",
                  x: place.id === "field" ? 440 : x, box: boxes[place.id] || [360, 380, 260, 100], game: g };
      if (place.id === "field") { t.wall = true; t.depth = 456; }   // the cushion lies on the floor: she walks up beside it
      return t;
    });
    return things.concat([EXIT]);
  }

  function lobbyThings(town) { // Lumi Heights' lobby: the front desk, the mailboxes, the lift, a big plant, and the way out.
    return [
      { id: "desk", act: "directory", icon: "🛎", name: "The front desk", hint: "Who lives here: walk to a friend's door", say: "The front desk! It knows everyone who lives here.",
        x: 330, box: [266, 318, 128, 112] },
      { id: "mail", act: "mail", icon: "📬", name: "The mailboxes", hint: "Her own little mailbox", say: "Our mailboxes! Is there anything for me?", x: 452, box: [408, 190, 88, 118], wall: true },
      { id: "lift", act: "elevator", icon: "⏫", name: "The lift", hint: "Up to the floors: home, or a friend's door", say: "The lift! Up to the flats.", x: 600, box: [548, 160, 104, 262], wall: true },
      { id: "plant", act: "look", icon: "🌿", name: "A big glowing plant", hint: "Just looking", say: "Somebody waters this every day. It glows!", x: 708, box: [680, 330, 56, 100] },
      EXIT,
    ];
  }

  function hallThings(floor, doors) { // A floor: eight front doors along the wall, and the lift at the far end. doors: the server's 8 (GET heights/<town>/<floor>).
    const out = [];
    for (let i = 0; i < DOORS; i++) {
      const d = (doors || [])[i] || {}, x = 168 + i * 84, label = floor + LETTERS[i];
      const name = d.name ? d.name + "'s flat" : d.id ? "Flat " + label : "Flat " + label + " (empty)";
      out.push({ id: "door-" + (i + 1), act: "door:" + (i + 1), icon: d.mine ? "🏠" : d.name ? (d.home ? "💡" : "🚪") : "🚪", name: d.mine ? "My front door (" + label + ")" : name,
                 hint: d.mine ? "Home: back into my flat" : d.name ? (d.home ? d.name + " is home" : "Nobody's home") + (d.open ? " · door open" : " · knock first") : d.id ? "Their door is closed" : "Nobody lives here yet",
                 say: d.mine ? "My front door! Home sweet home." : d.name ? d.name + "'s front door!" : "Flat " + label + ".", x: x, box: [x - 30, 196, 60, 214], wall: true, door: d });
    }
    out.push({ id: "lift", act: "elevator", icon: "⏫", name: "The lift", hint: "Down to the lobby, or another floor", say: "The lift! Where to?", x: 836, box: [790, 160, 92, 262], wall: true });
    return out;
  }

  function officeThings() { // The real-estate office: the land counter, the listings board, house styles, the yard shop, the capsule machine and the way out.
    return [
      { id: "land", act: "land", icon: "🏡", name: "Land for sale", hint: "Plots from the office, by town and street", say: "Land for sale! Shall we find a plot?", x: 330, box: [268, 300, 124, 130] },
      { id: "board", act: "listings", icon: "📌", name: "Neighbours' plots", hint: "Plots other people are selling", say: "The listings board! Neighbours selling up.", x: 432, box: [392, 170, 84, 124], wall: true },
      { id: "styles", act: "styles", icon: "🏠", name: "House styles", hint: "Thirty houses to choose from", say: "So many houses! Which one is me?", x: 528, box: [496, 316, 66, 114] },
      { id: "yard", act: "yard", icon: "🌷", name: "The yard shop", hint: "Fences, mailboxes, paths, lamps and ornaments", say: "Fences and lamps and little statues!", x: 622, box: [584, 186, 82, 136], wall: true },
      { id: "capsule", act: "capsule", icon: "🎁", name: "Keepsake Capsule", hint: "Yard treasures you can only win", say: "The Keepsake Capsule machine! What's inside?", x: 712, box: [676, 196, 76, 236] },
      EXIT,
    ];
  }

  /* A room by id. ctx: doors (a hall's 8, from the server), mine (her own flat's door number on this floor, or 0).
     Returns {id, kind, town, floor, name (the heading), hello (what she says walking in), things, floor (the walker),
     reach ([left, right]: how far a narrow screen pans), start ({x, y}: where she stands walking in)} or null. */
  function space(id, ctx) {
    ctx = ctx || {};
    const p = parse(id);
    if (!p) return null;
    let things, name, hello, reach = [150, 850];
    if (p.kind === "games") { things = gamesThings(p.place); name = p.place.room; hello = p.place.hello; }
    else if (p.kind === "lobby") { things = lobbyThings(p.town); name = (p.town === "right" ? "LUMI HEIGHTS EAST" : "LUMI HEIGHTS WEST"); hello = "Lumi Heights! Home sweet apartment building~"; }
    else if (p.kind === "hall") {
      const doors = (ctx.doors || []).map(function (d) { return Object.assign({}, d, { mine: ctx.mine && d.door === ctx.mine }); });
      things = hallThings(p.floor, doors); name = "FLOOR " + p.floor + " · " + (p.town === "right" ? "HEIGHTS EAST" : "HEIGHTS WEST"); hello = "Floor " + p.floor + "! Ding~";
      reach = [120, 900];                                                 // a long hallway: narrow screens pan along it
    }
    else { things = officeThings(); name = "LUMI REALTY"; hello = "Lumi Realty! Plots, houses and yards. Look around~"; }
    const plan = { things: things, edge: p.kind === "hall" ? [130, 880] : FLOOR.edge, back: FLOOR.back, front: FLOOR.front, half: FLOOR.half, near: FLOOR.near, shrink: FLOOR.shrink };
    const floor = Walker.floor(plan);
    const startAt = p.kind === "hall" ? { x: 836, y: 452 } : { x: 500, y: 448 }; // walking in: out of the lift, or a step in from the door (off the mat)
    return { id: id, kind: p.kind, town: p.town, floor: p.floor, name: name, hello: hello, things: things, walk: floor, reach: reach, start: floor.clean(startAt) };
  }

  // ---- The pictures --------------------------------------------------------------------------------------------
  function hitBox(t) { return rect(t.box[0], t.box[1], t.box[2], t.box[3], "transparent", 'rx="8" class="lp-in-hit" data-click="thing:' + t.id + '"'); } // a thing's press box
  function ring(x, y, on) { return on ? oval(x, y, 40, 9, "none", 'class="lp-tw-mark" stroke="#ff8ecb" stroke-width="2.5" stroke-dasharray="6 4"') : ""; } // in reach: the dashed ring at its foot
  function mat(on) { // The way out: a dark mat by the front, rimmed in Lumi's glow.
    return group(ring(500, 482, on) + rect(452, 466, 96, 22, "#0d0720", K.petLine('rx="5" stroke="#ff8ecb" stroke-width="1.5"')) + neon(500, 481, "EXIT ▸ STREET", 9.5, "#ffe9f5", 'font-family="monospace" letter-spacing="1"'));
  }

  function wall(top, colour, seed) { // A room's back wall down to y 392: dark panels with neon seams, and a skirting light.
    let out = rect(-20, top, 1040, 392 - top, "#160d2c") + rect(-20, top, 1040, 8, "#0b0618");
    for (let x = 30; x < 1040; x += 110) out += rect(x, top + 8, 2, 384 - top, colour, 'opacity=".14"');           // panel seams
    out += rect(-20, 386, 1040, 6, colour, 'opacity=".35"') + glow(rect(-20, 388, 1040, 2, colour, 'opacity=".8"'));   // the skirting's neon strip
    return out;
  }

  function floorTiles(colour) { // A glossy tiled floor from the wall to the front, catching the lights.
    let out = rect(-20, 392, 1040, 130, "#120b22");
    for (let x = -20; x < 1040; x += 64) out += line(x, 392, x + (x - 500) * 0.35, 520, colour, 1, 'opacity=".12"');  // tile lines, fanning out toward you
    [418, 452, 494].forEach(function (y) { out += rect(-20, y, 1040, 1, colour, 'opacity=".1"'); });
    return out;
  }

  function windowView(x, y, w, h, night) { // A big window onto the city at night: towers with lit windows under a magenta haze.
    const roll = K.dice(Math.round(x + y));
    let towers = "";
    for (let tx = x + 6; tx < x + w - 10; tx += roll(18, 34)) {
      const th = roll(h * 0.3, h * 0.85), tw = roll(14, 26);
      towers += rect(K.r1(tx), K.r1(y + h - th), tw, K.r1(th), night ? "#0d0820" : "#1a1240");
      for (let wy = y + h - th + 6; wy < y + h - 6; wy += 9) if (roll(0, 1) > 0.6) towers += rect(K.r1(tx + 4), K.r1(wy), 3, 4, roll(0, 1) > 0.5 ? "#ffdc83" : "#70ebea", 'opacity=".7"');
    }
    return rect(x, y, w, h, night ? "#2a0f3e" : "#4a1a5e") + rect(x, y + h * 0.55, w, h * 0.45, "#ff2e97", 'opacity=".12"') + towers +
      rect(x, y, w, h, "none", 'stroke="#2a2440" stroke-width="8"') + rect(x + w / 2 - 2, y, 4, h, "#2a2440") + tube(box(x - 4, y - 4, w + 8, h + 8), "#c9a8ff", 1.2);
  }

  function lobby(opts) { // Lumi Heights' lobby: a tall window, the front desk under the building's sign, the mailboxes, the lift, a glowing plant.
    const on = opts.on, night = opts.night, glowC = opts.town === "right" ? "#70ebea" : "#ff8ecb";
    const desk = group(ring(330, 452, on === "desk") + rect(266, 330, 128, 96, "#1e1036", 'rx="6"') + rect(262, 322, 136, 12, "#2c1a4e", 'rx="4"') +
      tube(box(266, 334, 128, 92), glowC, 1.4) + rect(300, 300, 22, 22, "#0b0618", 'rx="3"') + glow(rect(303, 303, 16, 12, "#70ebea", 'opacity=".5"')) +    // a little screen on the desk
      circle(370, 316, 6, "#ffdc83") + rect(366, 316, 8, 6, "#d9b45a") + neon(330, 384, "RESIDENTS", 11, glowC, 'font-family="monospace" font-weight="bold" letter-spacing="2"')); // the bell, and the desk's sign
    let boxes = "";
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) boxes += rect(414 + c * 20, 198 + r * 26, 16, 20, "#2a2440", 'rx="2"') + circle(426 + c * 20, 210 + r * 26, 1.5, "#ffdc83");
    const mail = group(ring(452, 452, on === "mail") + rect(408, 190, 88, 112, "#120a24", 'rx="4"') + boxes + tube(box(408, 190, 88, 112), "#ffdc83", 1) + neon(452, 324, "MAIL", 10, "#ffdc83", 'font-family="monospace" font-weight="bold"'));
    const lift = group(ring(600, 452, on === "lift") + rect(548, 160, 104, 232, "#0e0820") + rect(556, 196, 42, 196, "#2a2440") + rect(602, 196, 42, 196, "#2a2440") + rect(598, 196, 4, 196, "#0b0618") +
      tube(box(548, 160, 104, 232), "#c9a8ff", 1.6) + rect(574, 168, 52, 20, "#05020f", 'rx="3"') + neon(600, 183, "▲ ▼", 12, "#ffdc83") + glow(circle(664, 290, 5, "#8be9a8")));
    const plant = group(ring(708, 452, on === "plant") + path("M690 430 h36 l-6 -40 h-24 Z", "#2a2440") +
      [[-14, -78, 0], [10, -92, 2], [0, -60, 4], [-22, -50, 3], [18, -58, 1]].map(function (l) { return glow(oval(708 + l[0], 400 + l[1], 14, 26, NEON[l[2]], 'opacity=".55"')); }).join(""));
    const sign = rect(222, 112, 216, 44, "#07031a", 'rx="6"') + tube(box(222, 112, 216, 44), glowC, 1.6) + neon(330, 142, opts.town === "right" ? "LUMI HEIGHTS · EAST" : "LUMI HEIGHTS · WEST", 13, glowC, 'font-family="monospace" font-weight="bold" letter-spacing="1.5"');
    const things = (opts.things || []).map(hitBox).join("");
    return group(wall(0, glowC, 3) + windowView(-10, 40, 210, 300, night) + windowView(780, 40, 230, 300, night) + floorTiles(glowC) + sign + desk + mail + lift + plant + mat(on === "exit") + things +
      (night ? rect(-20, -20, 1040, 540, "#0a0620", 'opacity=".12" pointer-events="none"') : ""), 'data-inside="lobby"');
  }

  function hall(opts) { // A floor of Lumi Heights: a long hallway, eight doors with their nameplates (names escaped), a carpet runner, the lift at the end.
    const on = opts.on, glowC = opts.town === "right" ? "#70ebea" : "#ff8ecb";
    let doors = "";
    (opts.things || []).forEach(function (t) {
      if (t.act.indexOf("door:") !== 0) return;
      const d = t.door || {}, x = t.x, lit = d.mine ? "#ff8ecb" : d.home ? "#ffdc83" : "#3a3352";
      doors += group(ring(x, 452, on === t.id) + rect(x - 28, 214, 56, 178, "#24163e", 'rx="3"') + rect(x - 22, 222, 44, 164, d.mine ? "#3a1a4e" : "#2e1d4a") + // the frame and the door
        circle(x + 14, 306, 3, "#ffdc83") + rect(x - 18, 196, 36, 14, "#07031a", 'rx="2"') + text(x, 207, esc(String(opts.floor) + LETTERS[Number(t.id.slice(5)) - 1]), 10, glowC, 'font-family="monospace" font-weight="bold"') + // the knob and the flat number
        glow(rect(x - 22, 386, 44, 4, lit, 'opacity=".9"')) + (d.name ? rect(x - 34, 236, 68, 15, "#07031a", 'rx="3" opacity=".9"') + text(x, 247, esc(d.name.length > 11 ? d.name.slice(0, 10) + "…" : d.name), 9.5, "#ffe9f5") : "") + // light under the door when someone's home; their nameplate
        (d.mine ? neon(x, 280, "♥", 16, "#ff8ecb") : ""));
    });
    const lift = group(ring(836, 452, on === "lift") + rect(790, 160, 92, 232, "#0e0820") + rect(798, 196, 36, 196, "#2a2440") + rect(838, 196, 36, 196, "#2a2440") + tube(box(790, 160, 92, 232), "#c9a8ff", 1.6) +
      rect(810, 168, 52, 20, "#05020f", 'rx="3"') + neon(836, 183, String(opts.floor), 12, "#ffdc83", 'font-family="monospace"'));
    const runner = path("M-20 430 H1040 L1040 470 H-20 Z", glowC, 'opacity=".12"') + rect(-20, 428, 1040, 2, glowC, 'opacity=".5"') + rect(-20, 470, 1040, 2, glowC, 'opacity=".5"');
    let sconces = "";
    for (let x = 126; x < 800; x += 168) sconces += glow(path("M" + (x - 8) + " 150 h16 l-4 14 h-8 Z", "#ffdc83", 'opacity=".8"')) + reflect(x, 392, 50, "#ffdc83", 24);
    const things = (opts.things || []).map(hitBox).join("");
    return group(wall(0, glowC, 5) + floorTiles(glowC) + runner + sconces + doors + lift + things, 'data-inside="hall"');
  }

  function office(opts) { // Lumi Realty: the land counter with a city map behind it, the listings board, the style catalogue, the yard shop, the capsule machine.
    const on = opts.on, night = opts.night, gold = "#ffdc83";
    const sign = rect(320, 40, 360, 50, "#07031a", 'rx="8"') + tube(box(320, 40, 360, 50), gold, 1.8) + neon(500, 74, "🏡 LUMI REALTY", 20, gold, 'font-family="monospace" font-weight="bold" letter-spacing="2"');
    let blocks = "";                                                       // the city map on the wall: Downtown in the middle, little houses either side
    for (let i = 0; i < 9; i++) blocks += rect(208 + i * 20, 132 + (i % 2) * 10, 14, 12, i === 4 ? HOT : NEON[i % 6], 'opacity=".55" rx="2"');
    const map = rect(196, 112, 200, 64, "#0b0618", 'rx="4"') + tube(box(196, 112, 200, 64), "#70ebea", 1) + rect(196, 156, 200, 4, "#70ebea", 'opacity=".35"') + blocks;
    const counter = group(ring(330, 452, on === "land") + rect(268, 312, 124, 112, "#1e1036", 'rx="6"') + rect(262, 304, 136, 12, "#2c1a4e", 'rx="4"') + tube(box(268, 316, 124, 108), gold, 1.4) +
      neon(330, 372, "LAND", 13, gold, 'font-family="monospace" font-weight="bold" letter-spacing="3"') + rect(292, 284, 30, 20, "#f6efe0", 'rx="2"') + rect(330, 288, 26, 16, "#f6efe0", 'rx="2"'));
    let cards = "";
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cards += rect(400 + c * 25, 182 + r * 34, 20, 26, "#f6efe0", 'rx="2"') + path("M" + (402 + c * 25) + " " + (196 + r * 34) + " l8 -8 l8 8 Z", NEON[(r + c) % 6]);
    const board = group(ring(432, 452, on === "board") + rect(392, 170, 84, 112, "#5a3a2a", 'rx="3"') + rect(396, 174, 76, 104, "#7a5236") + cards + neon(434, 300, "FOR SALE", 9, "#ff8ecb", 'font-family="monospace" font-weight="bold"'));
    const styles = group(ring(528, 452, on === "styles") + rect(512, 330, 34, 100, STEEL) + rect(496, 316, 66, 46, "#07031a", 'rx="4"') + tube(box(496, 316, 66, 46), "#c9a8ff", 1.2) +
      path("M509 350 l20 -18 l20 18 Z", "#c9a8ff", 'opacity=".8"') + rect(515, 350, 28, 10, "#c9a8ff", 'opacity=".5"') + neon(529, 400, "STYLES", 9, "#c9a8ff", 'font-family="monospace" font-weight="bold"'));
    const shelf = [194, 238, 282].map(function (y, i) { return rect(584, y + 30, 82, 4, "#c9a8ff", 'opacity=".7"') + [0, 1, 2].map(function (k) { return glow(circle(598 + k * 26, y + 20, 8, NEON[(i * 3 + k) % 6], 'opacity=".85"')); }).join(""); }).join("");
    const yard = group(ring(622, 452, on === "yard") + rect(580, 186, 90, 136, "#120a24", 'rx="4"') + shelf + tube(box(580, 186, 90, 136), "#8be9a8", 1.2) + neon(625, 342, "YARD", 10, "#8be9a8", 'font-family="monospace" font-weight="bold"'));
    const capsule = group(ring(712, 452, on === "capsule") + rect(682, 300, 60, 130, "#3a0f30", 'rx="8"') + circle(712, 252, 38, "#07031a") + circle(712, 252, 38, "none", 'stroke="#ff8ecb" stroke-width="3"') +
      [[-14, -10, 0], [10, -14, 1], [-4, 8, 2], [16, 8, 3], [-18, 12, 4]].map(function (b) { return circle(712 + b[0], 252 + b[1], 9, NEON[b[2]]); }).join("") +
      glow(circle(712, 252, 38, "#ffffff", 'opacity=".08"')) + circle(712, 340, 12, gold) + rect(706, 336, 12, 8, "#3a0f30") + rect(696, 380, 32, 20, "#07031a", 'rx="3"') +
      neon(712, 420, "KEEPSAKE", 8.5, "#ff8ecb", 'font-family="monospace" font-weight="bold"'));
    const things = (opts.things || []).map(hitBox).join("");
    return group(wall(0, gold, 7) + windowView(-10, 60, 180, 260, night) + windowView(800, 60, 210, 260, night) + floorTiles(gold) + sign + map + counter + board + styles + yard + capsule + mat(on === "exit") + things +
      (night ? rect(-20, -20, 1040, 540, "#0a0620", 'opacity=".12" pointer-events="none"') : ""), 'data-inside="office"');
  }

  function art(sp, opts) { // The picture for a room: sp from space(), opts {on: the thing in reach's id, night}.
    const o = { on: opts.on || null, night: Boolean(opts.night), things: sp.things, town: sp.town, floor: sp.floor };
    if (sp.kind === "lobby") return lobby(o);
    if (sp.kind === "hall") return hall(o);
    if (sp.kind === "office") return office(o);
    const games = sp.things.filter(function (t) { return t.game; });   // the old pictures, with the one in reach lit (their cursor)
    const cursor = o.on === "exit" ? games.length : games.findIndex(function (t) { return t.id === o.on; });
    return TwA.scene({ at: sp.id, cursor: cursor, games: games.map(function (t) { return t.id; }), night: o.night }) +
      sp.things.map(hitBox).join("");                                     // (its own hit boxes still say game:/stall:/leave; ours say thing:)
  }

  return { FLOOR: FLOOR, DOORS: DOORS, LETTERS: LETTERS, TOWN_NAME: TOWN_NAME, parse: parse, space: space, art: art, hallId: hallId, lobbyId: lobbyId };
});
