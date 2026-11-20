/* Lumi City's pictures (Doll's design, 2026-11-19; docs/plans/lumi-city.md): the streets, the Downtown buildings, the
   plots and their houses, seen from above at a tilt, in the town's neon (town-art.js's drawing kit).

   The city is drawn a part at a time (a chunk: a block, Downtown or a gate; city-map.js), and only the parts near the
   camera, so a big city costs no more to draw than a small one. Each part is a flat ground layer and one layer per
   row of tiles. game.js stacks them: all the ground first, then row by row from the back of the picture to the front,
   each row's buildings and then every Lumi standing on that row (the empty <g class="lp-cw-folk" data-row="r"> it
   fills), so whoever is further forward is always drawn in front. Every thing she can use is a <g data-thing="...">
   with a dashed ring at its doorstep that game.css shows when it's in reach (.lp-cw-near).

   Pure string-building. Owners' names go through esc() (here and in estate-art.js); nothing else typed by a person
   reaches the picture. */
(function (root, make) {
  const node = typeof module === "object" && module.exports;
  const art = node ? make(require("./town-art.js"), (function () { try { return require("./estate-art.js"); } catch (e) { return null; } })())
    : make(root.LumiPetTownArt, root.LumiPetEstateArt || null);              // the town's kit, and the houses (estate-art.js)
  if (node) module.exports = art; else root.LumiCityArt = art;
})(typeof self !== "undefined" ? self : this, function (TwA, Es) {
  "use strict";
  const K = TwA.KIT, rect = K.rect, circle = K.circle, oval = K.oval, path = K.path, line = K.line, text = K.text, group = K.group, glow = K.glow,
    esc = K.esc, tube = K.tube, box = K.box, neon = K.neon, reflect = K.reflect, NEON = K.NEON, HOT = K.HOT, INK = K.INK, STEEL = K.STEEL, r1 = K.r1;

  const GROUND = { "=": "#17122b", ".": "#2b2346", "|": "#241d3c", "_": "#241d3c", ":": "#2e2650", "~": "#0f2420", "T": "#0b1a16", "U": "#2e2650" }; // each ground's colour
  const SCALE = { north: 1.75, south: 1.45 }; // Downtown's old buildings (town-art.js, ~120 wide) grown to fill their plots: big at the back, a little smaller at the front

  function ground(map, ch, night) { // One chunk's ground, row by row in runs of the same kind: road, pavement, lanes, plaza, grass, and under the trees.
    const tw = map.tile[0], th = map.tile[1], L = map.layout, roll = K.dice(Math.abs(ch.c0 * 31) + 7);
    let out = "";
    for (let r = 0; r < map.rows; r++) {
      const line0 = map.grid[r];
      let c = ch.c0;
      while (c < ch.c1) {
        const s = line0[c - map.x0];
        let end = c + 1;
        while (end < ch.c1 && GROUND[line0[end - map.x0]] === GROUND[s]) end++;     // a run of the same ground
        const x = c * tw, y = r * th, w = (end - c) * tw, fill = GROUND[s] || "#120a24"; // (a lot or a building's floor: dark, it's covered)
        out += rect(x, y, w, th + 0.5, fill);
        if (s === "." || s === ":") for (let k = c; k < end; k++) out += rect(k * tw, y, 1, th, "#3a3058", 'opacity=".6"'); // paving seams
        if (s === "~") for (let k = 0; k < (end - c) * 2; k++) out += circle(r1(x + roll(4, w - 4)), r1(y + roll(6, th - 6)), 1.6, NEON[k % 6], 'opacity=".55"'); // little glowing flowers
        if (s === "|" || s === "_") for (let k = 0; k < (end - c) * 3; k++) out += rect(r1(x + roll(2, w - 6)), r1(y + roll(3, th - 6)), 4, 3, "#352c55", 'rx="1"'); // cobbles
        c = end;
      }
    }
    const roadTop = L.avenue[0] * th, mid = (L.avenue[0] + 1) * th, roadBottom = (L.avenue[1] + 1) * th, x0 = ch.c0 * tw, x1 = ch.c1 * tw;
    out += line(x0, mid, x1, mid, "#ffdc83", 2, 'stroke-dasharray="18 22" opacity=".55"');                     // the avenue's middle line
    out += glow(rect(x0, roadTop - 1, x1 - x0, 2, "#70ebea", 'opacity=".5"') + rect(x0, roadBottom - 1, x1 - x0, 2, "#ff8ecb", 'opacity=".5"')); // the kerbs' lights
    for (let x = x0 + 40; x < x1; x += 260) out += reflect(x, mid + 6, 90, NEON[Math.abs(Math.round(x / 260)) % 6], 30); // neon smears in the wet road
    return out;
  }

  function tree(x, base, kind) { // A tree on a tile: tall at the city's back edge, a low hedge along its front edge.
    if (kind === "hedge") return oval(x, base - 10, 30, 13, "#0f2e24") + oval(x - 10, base - 14, 14, 9, "#16402f") + circle(x + 9, base - 15, 1.6, "#8be9a8");
    return rect(x - 3, base - 20, 6, 20, "#2a1f3a") + circle(x, base - 34, 22, "#0f2e24") + circle(x - 9, base - 40, 12, "#16402f") + circle(x + 8, base - 44, 10, "#1b4a37") +
      circle(x - 12, base - 30, 1.8, "#ffdc83") + circle(x + 10, base - 36, 1.8, "#ff8ecb");               // a dark crown with a couple of fairy lights
  }

  function heights(cx, base, town, night) { // Lumi Heights: a tall apartment block, rows of lit windows, a neon name, a lit entrance.
    const glowC = town === "right" ? "#70ebea" : "#ff8ecb", roll = K.dice(town === "right" ? 91 : 47);
    let windows = "";
    for (let y = base - 300; y < base - 70; y += 26) for (let x = cx - 92; x < cx + 84; x += 24) {
      const lit = roll(0, 1) > (night ? 0.35 : 0.55);                       // more windows lit at night
      windows += rect(x, y, 14, 16, lit ? (roll(0, 1) > 0.5 ? "#ffdc83" : "#ffb86a") : "#0d0820", lit ? 'opacity=".85"' : "");
    }
    return rect(cx - 104, base - 318, 208, 318, "#1a1036") + rect(cx - 104, base - 318, 208, 8, "#0b0618") + windows +
      tube("M" + (cx - 108) + " " + (base - 320) + " H" + (cx + 108), glowC, 2.5) +                                      // the roof's neon edge
      rect(cx - 84, base - 64, 168, 26, INK, 'rx="4"') + tube(box(cx - 84, base - 64, 168, 26), glowC, 1.4) +
      neon(cx, base - 45, town === "right" ? "LUMI HEIGHTS E" : "LUMI HEIGHTS W", 15, glowC, 'font-family="monospace" font-weight="bold" letter-spacing="2"') +
      rect(cx - 24, base - 36, 48, 36, glowC, 'opacity=".35"') + glow(rect(cx - 20, base - 33, 40, 33, "#ffe9f5", 'opacity=".25"')) + tube(box(cx - 24, base - 36, 48, 36), glowC, 1.5); // the glass doors
  }

  function office(cx, base, night) { // Lumi Realty: a warm brick front, a big house-shaped neon sign, a window of little house cards.
    const gold = "#ffdc83", lit = night ? "#ffb86a" : "#ffcf7a";
    let cards = "";
    for (let i = 0; i < 4; i++) cards += rect(cx - 70 + i * 22, base - 74, 16, 20, "#f6efe0", 'rx="2"') + path("M" + (cx - 70 + i * 22) + " " + (base - 64) + " l8 -7 l8 7 Z", NEON[i]);
    return rect(cx - 96, base - 128, 192, 128, "#3a1a26") + rect(cx - 96, base - 128, 192, 6, "#24101a") +
      path("M" + (cx - 64) + " " + (base - 140) + " L" + cx + " " + (base - 196) + " L" + (cx + 64) + " " + (base - 140) + " Z", "#07031a") +
      tube("M" + (cx - 64) + " " + (base - 140) + " L" + cx + " " + (base - 196) + " L" + (cx + 64) + " " + (base - 140) + " Z", gold, 2.2) +             // the house-shaped sign
      neon(cx, base - 152, "LUMI REALTY", 13, gold, 'font-family="monospace" font-weight="bold" letter-spacing="1.5"') +
      rect(cx - 78, base - 84, 92, 34, "#0b0618", 'rx="3"') + glow(rect(cx - 78, base - 84, 92, 34, lit, 'opacity=".25"')) + cards + tube(box(cx - 78, base - 84, 92, 34), gold, 1) +
      rect(cx + 28, base - 56, 40, 56, "#2a0a1c") + glow(rect(cx + 32, base - 52, 32, 52, lit, 'opacity=".35"')) + tube(box(cx + 28, base - 56, 40, 56), "#ff8ecb", 1.4) + circle(cx + 58, base - 26, 2.4, gold); // the door
  }

  function fountain(cx, base) { // The plaza's holo fountain: a stone bowl, a column of light and rings.
    return oval(cx, base - 8, 70, 18, "#3a3058") + oval(cx, base - 12, 60, 13, "#16102e") + glow(oval(cx, base - 12, 52, 10, "#70ebea", 'opacity=".35"')) +
      glow(rect(cx - 5, base - 96, 10, 84, "#70ebea", 'opacity=".45"') + oval(cx, base - 96, 22, 6, "none", 'stroke="#ff8ecb" stroke-width="2"') + oval(cx, base - 70, 30, 7, "none", 'stroke="#c9a8ff" stroke-width="1.5" opacity=".7"'));
  }

  function lamp(x, base, night) { // A street lamp leaning over the road, its light a pool on the pavement.
    return rect(x - 2, base - 92, 4, 92, STEEL) + path("M" + x + " " + (base - 92) + " q0 -10 16 -10 h6", "none", 'stroke="' + STEEL + '" stroke-width="4"') +
      glow(rect(x + 14, base - 100, 14, 4, "#ffdc83") + oval(x + 21, base + 22, 34, 9, "#ffdc83", 'opacity="' + (night ? ".22" : ".12") + '"'));
  }

  function signpost(x, base, words, colour) { // A street sign at a corner: a post and a neon board with the street's name (authored names, escaped anyway).
    const w = Math.max(70, String(words).length * 7.4 + 18);
    return rect(x - 2, base - 66, 4, 66, STEEL) + rect(x - w / 2, base - 84, w, 22, INK, 'rx="4"') + tube(box(x - w / 2, base - 84, w, 22), colour, 1.3) +
      neon(x, base - 68, esc(words).toUpperCase(), 10, colour, 'font-family="monospace" font-weight="bold" letter-spacing="1"');
  }

  function gatePost(x, base, words, colour, side) { // A town's gate: two neon pylons with the town's name, and an arrow out.
    const d = side === "left" ? -1 : 1;
    return rect(x - 10, base - 150, 20, 150, "#1a1036") + tube(box(x - 10, base - 150, 20, 150), colour, 1.6) + glow(circle(x, base - 160, 9, colour)) +
      rect(x - 66, base - 132, 132, 30, INK, 'rx="5"') + tube(box(x - 66, base - 132, 132, 30), colour, 1.6) + neon(x, base - 112, esc(words).toUpperCase(), 12, colour, 'font-family="monospace" font-weight="bold" letter-spacing="2"') +
      path("M" + (x + 22 * d) + " " + (base - 90) + " h" + (26 * d) + " l" + (-8 * d) + " -8 M" + (x + 48 * d) + " " + (base - 90) + " l" + (-8 * d) + " 8", "none", 'stroke="' + colour + '" stroke-width="2.5"');
  }

  function ring(x, y) { return oval(x, y, 34, 9, "none", 'class="lp-cw-ring lp-tw-mark" stroke="#ff8ecb" stroke-width="2.5" stroke-dasharray="6 4"'); } // in reach (game.css shows it)

  function thing(id, inner, hitBox, door) { // Something she can use: its drawing, its doorstep ring, and a press box over it (game.js: data-click="thing:<id>").
    return '<g class="lp-cw-thing" data-thing="' + id + '">' + ring(door.x, door.y + 8) + inner +
      rect(hitBox[0], hitBox[1], hitBox[2], hitBox[3], "transparent", 'data-click="thing:' + id + '"') + "</g>";
  }

  function money(n) { return Number(n).toLocaleString("en-GB"); } // 4,400

  /* One chunk's pictures: {ground, rows: [one string per tile row]}. lots: {lotId: {owner: {id, name} | null, style, yard,
     list_price, suggested}} from GET city (missing: office land at its suggested price). */
  function chunk(map, ch, lots, night) {
    const tw = map.tile[0], th = map.tile[1], rows = [];
    for (let r = 0; r < map.rows; r++) rows.push("");
    const put = function (r, markup) { rows[Math.max(0, Math.min(map.rows - 1, r))] += markup; }; // into a row's layer
    for (let r = 0; r < map.rows; r++) for (let c = ch.c0; c < ch.c1; c++) { // the trees, tile by tile
      if (map.grid[r][c - map.x0] !== "T") continue;
      if ((c + r) % 2 && r > 0 && r < map.rows - 1) continue;                // thinner in the gates' woods
      put(r, tree((c + 0.5) * tw, (r + 1) * th - 2, r === map.rows - 1 ? "hedge" : "tree"));
    }
    if (ch.kind === "block" || ch.kind === "gate") { // lamps on the grass by the avenue, both sides
      for (let c = ch.c0; c < ch.c1; c++) {
        if (map.grid[map.layout.avenue[0] - 2][c - map.x0] === "~") put(map.layout.avenue[0] - 2, lamp((c + 0.5) * tw, (map.layout.avenue[0] - 1) * th, night));
      }
    }
    map.lots.filter(function (l) { return l.chunk === ch.id; }).forEach(function (l) { // the plots, each with its house and yard (estate-art.js)
      const data = lots[l.id] || {}, owned = Boolean(data.owner), base = l.rect[1] + l.rect[3] - 1;
      const sale = !owned ? money(typeof LumiPrice === "function" ? LumiPrice("city", "plot", data.suggested || 0) : data.suggested || 0) : null; // LumiBot: the board shows SGC (sgc.spend city/plot); a FOR SALE board on office land (a neighbour's listed house stays standing: its price is on the office's board)
      const inner = Es ? Es.plot(l.box, { style: owned ? data.style || "" : "", yard: owned ? data.yard || {} : {}, night: night, sale: sale, name: owned ? data.owner.name : null })
        : rect(l.box.x + 8, l.box.y + 8, l.box.w - 16, l.box.h - 16, owned ? "#3a1a4e" : "#14301f", 'rx="6"');  // (no house drawings loaded: a plain patch)
      put(base, thing("lot:" + l.id, inner, [l.box.x, l.box.y - 120, l.box.w, l.box.h + 120], l.door));
    });
    map.places.filter(function (p) { return p.chunk === ch.id; }).forEach(function (p) { // Downtown's buildings
      const base = p.rect[1] + p.rect[3] - 1, cx = p.box.x + p.box.w / 2, by = p.box.y + p.box.h, north = p.rect[1] < map.layout.avenue[0];
      let inner;
      if (p.build === "heights") inner = heights(cx, by, p.town, night);
      else if (p.build === "office") inner = group(office(0, 0, night), 'transform="translate(' + cx + " " + by + ') scale(1.3)"');
      else if (TwA.BUILD[p.build === "home" ? "home" : p.build]) inner = group(TwA.BUILD[p.build](0, 0, night), 'transform="translate(' + cx + " " + by + ") scale(" + (north ? SCALE.north : SCALE.south) + ')"');
      else inner = rect(p.box.x, p.box.y, p.box.w, p.box.h, "#1a1036");
      put(base, thing("place:" + p.id, rect(p.box.x + 4, p.box.y + 4, p.box.w - 8, p.box.h - 4, "#120a24", 'rx="6"') + inner, [p.box.x, p.box.y - (north ? 80 : 40), p.box.w, p.box.h + (north ? 80 : 40)], p.door));
    });
    if (ch.kind === "downtown") { // the plaza's fountain, and vending machines by the paths
      const fx = (ch.c0 + 15.5) * tw, fy = 13 * th;
      put(12, fountain(fx, fy));
      put(9, K.vending((ch.c0 + 0.5) * tw, 10 * th - 4, "#70ebea") + K.vending((ch.c1 - 0.5) * tw, 10 * th - 4, "#ffdc83"));
    }
    map.signs.filter(function (s) { return s.chunk === ch.id; }).forEach(function (s) { // street signs at the corners
      const colour = s.town === "right" ? "#70ebea" : s.town === "left" ? "#ff8ecb" : "#ffdc83";
      put(Math.floor(s.y / th) - 1, thing("sign:" + s.id, signpost(s.x + (s.town ? -16 : 0), Math.floor(s.y / th) * th, s.words, colour), [s.x - 60, s.y - 110, 120, 110], { x: s.x, y: s.y - 6 }));
    });
    if (ch.kind === "gate") { // the gate's pylons and the way out
      const g = map.gates[ch.town], town = map.layout.towns[ch.town], colour = ch.town === "right" ? "#70ebea" : "#ff8ecb";
      const gx = ch.town === "left" ? (ch.c0 + 1) * tw : (ch.c1 - 1) * tw;
      put(map.layout.avenue[0] - 2, thing("gate:gate-" + ch.town, gatePost(gx, (map.layout.avenue[0] - 1) * th + 6, town.name, colour, ch.town), [gx - 70, (map.layout.avenue[0] - 1) * th - 170, 140, 180],
        { x: g.arrive.x + (ch.town === "left" ? -tw : tw), y: g.arrive.y - 6 }));
      put(map.layout.avenue[1] + 1, gatePost(gx, (map.layout.avenue[1] + 2) * th + 4, ch.town === "left" ? "← LEAVE" : "LEAVE →", colour, ch.town)); // the front pylon (in front of whoever walks past)
    }
    return { ground: ground(map, ch, night), rows: rows };
  }

  /* The whole picture from the chunks near the camera: parts = [chunk(...)], view = {x, y, w, h} (what's shown, with
     a margin). A dark backdrop, every chunk's ground, then each row's layer and its (empty) Lumi slot. */
  function scene(map, parts, view, night) {
    let out = rect(view.x - 400, -200, view.w + 800, map.height + 400, "#0b0618");                        // the dark beyond the city's edges
    out += parts.map(function (p) { return p.ground; }).join("");
    for (let r = 0; r < map.rows; r++) {
      out += '<g class="lp-cw-row" data-row="' + r + '">' + parts.map(function (p) { return p.rows[r]; }).join("") + '<g class="lp-cw-folk" data-row="' + r + '"></g></g>';
    }
    if (night) out += rect(view.x - 400, -200, view.w + 800, map.height + 400, "#0a0620", 'opacity=".14" pointer-events="none"');
    return '<g data-town="city" data-time="' + (night ? "night" : "day") + '">' + out + "</g>";
  }

  return { chunk: chunk, scene: scene, heights: heights, office: office, money: money };
});
