/* Lumi Town's drawings (Doll's design, 2026-11-12): the town map, and the insides of the three places you walk into
   (the Arcade, the Casino and the Lumi-Soft field), and Market Street (2026-11-14: the Retro café, the Market and its
   inside of four stalls), with a signpost at each street's end to the other. Each is one 1000 x 500 picture, drawn in the room behind the lists
   like her apartment (house.js) and the tavern (tavern-art.js).

   The look (2026-11-19, to match the rest of the NAS): a cyberpunk town in permanent night. A smoggy magenta-to-indigo
   sky over layered towers with lit windows, holo billboards and overhead wires, neon on every place, wet asphalt that
   mirrors the signs, steam from the road grates and a light rain (game.css; the rain stops for reduced motion). Its
   "day" is a brighter neon dusk and its "night" a deeper indigo, so the clock still shows. A few lights take Lumi's own
   glow (the lp-tw-pet classes: var(--pet-glow) in game.css), so the town follows her colour.

   Every screen shows the middle of the picture (about x 290-710: game.css crops the sides to fit), so everything you
   can pick sits there: the map's six places in two rows of three, and the stations of a place's inside (stations(): four, or the Arcade's five). The rest
   (towers, vending machines, a claw machine) is what a wide screen adds at the sides. Lumi is the page's own Lumi, moved to spot()
   by game.js. Plain SVG, all authored here: nothing a person typed goes into it, and the one label it is given (the
   picked place's name, from town-ui.js) is escaped anyway. game.css makes the lights breathe (.lp-tw-glow). */
(function (root, make) {
  const art = make();
  if (typeof module === "object" && module.exports) module.exports = art; else root.LumiPetTownArt = art;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Each place on the map: its middle and the line its front door stands on. Top row on the high street, bottom row on the lane.
  const MAP = { arcade: [355, 232], tavern: [500, 232], casino: [645, 232], home: [355, 436], garden: [500, 436], field: [645, 436] };
  // Market Street (2026-11-14): the Retro café and the Market on its top row; its lane has the fountain, and room for more.
  const MARKET = { cafe: [430, 232], market: [575, 232] };
  // The signpost to the other street, keyed by where it leads: on the High Street's right-hand end to Market Street, and
  // on Market Street's left-hand end back. Both inside the middle every screen shows.
  const SIGNS = { market: [688, 282], high: [312, 282] };   // standing on the wet road at the street's end
  const ALL = Object.assign({}, MAP, MARKET);
  const STATIONS = [365, 455, 545, 635]; // Inside a place: where its cabinets or tables stand, close enough that a squarer screen's panels don't cover the end ones (four of them).
  // The same row for any count, centred on the room: four 90 apart is STATIONS exactly. Five (the Arcade since Lumi Launch,
  // 2026-11-14) stand 72 apart and a fifth smaller (SNUG), so all five sit in the middle a 1440x1000 screen leaves clear of
  // Lumi Pet's panels (about x 302-670 there); 90 apart, the fifth went under the right panel.
  const SNUG = 0.8;
  function stations(count) {
    const n = Math.max(1, count), gap = n > 4 ? 72 : 90;
    return Array.from({ length: n }, function (_, i) { return 500 + (i - (n - 1) / 2) * gap; });
  }
  const NEON = ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff", "#8be9a8", "#ff9d6b"]; // Lumi's own glow colours.
  const HOT = "#ff2e97", INK = "#0b0618", STEEL = "#2a2440"; // The hot pink of the signs, the near-black of the shadows, and the dark metal of poles and grates.
  // The colour each place's sign throws onto the wet road in front of it (townMap's reflections).
  const SHINE = { arcade: "#70ebea", tavern: "#ff9d6b", casino: "#ffdc83", home: "#ff8ecb", garden: "#8be9a8", field: "#c9a8ff", cafe: "#70ebea", market: "#ff8ecb" };

  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function path(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function line(x1, y1, x2, y2, stroke, width, more) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + width + '" ' + (more || "") + "/>"; }
  function text(x, y, words, size, fill, more) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + words + "</text>"; }
  function group(inner, more) { return "<g " + (more || "") + ">" + inner + "</g>"; }
  function glow(inner) { return group(inner, 'class="lp-tw-glow"'); } // A light that breathes (game.css): the group's opacity moves, the shape keeps its own.
  function esc(words) { return String(words).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); } // Safe as SVG text.
  function dice(seed) { // A steady seeded roll, so the windows, puddles and raindrops are the same on every draw (and every device).
    let value = seed;
    return function (low, high) { value = (value * 16807) % 2147483647; return Math.round((low + (value / 2147483647) * (high - low)) * 10) / 10; };
  }
  function r1(n) { return Math.round(n * 10) / 10; } // One decimal place: short markup, and no 0.30000000000000004 in it.
  function hit(x, y, w, h, click) { return rect(x, y, w, h, "transparent", 'data-click="' + click + '"'); } // A press anywhere on it counts (game.js townPress).
  function marker(x, y) { return oval(x, y, 34, 8, "none", 'class="lp-tw-mark" stroke="#ff8ecb" stroke-width="2.5" stroke-dasharray="6 4"'); } // The dashed ring where she's about to go.

  // ---- Neon, wet and weather: the pieces every picture shares ----------------------------------------------
  function pet(more) { return 'class="lp-tw-pet" ' + (more || ""); } // A fill that takes Lumi's own glow (game.css: var(--pet-glow)); the fill given is the fallback.
  function petLine(more) { return 'class="lp-tw-pet-line" ' + (more || ""); } // The same for a stroke.
  function tube(d, colour, width, lumi) { // A neon tube along a path: a wide faint halo under a thin bright core. lumi: take Lumi's glow instead.
    const cls = lumi ? petLine() : "", round = 'stroke-linecap="round" stroke-linejoin="round"';
    return path(d, "none", cls + 'stroke="' + colour + '" stroke-width="' + r1(width * 3.5) + '" opacity=".22" ' + round) +
      path(d, "none", cls + 'stroke="' + colour + '" stroke-width="' + width + '" ' + round);
  }
  function box(x, y, w, h) { return "M" + x + " " + y + " h" + w + " v" + h + " h" + (-w) + " Z"; } // A rectangle as a path, for tube() outlines.
  function neon(x, y, words, size, colour, more) { // Sign letters lit up: a fat soft copy under the crisp ones, breathing together.
    return glow(text(x, y, words, size, colour, 'opacity=".3" stroke="' + colour + '" stroke-width="' + r1(size / 3.5) + '" stroke-linejoin="round" ' + (more || "")) +
      text(x, y, words, size, colour, more));
  }
  function reflect(x, y, w, colour, len) { // A light's smear in the wet ground below it: three bands fading down, each a little narrower.
    return [0, 1, 2].map(function (i) { return rect(r1(x - w / 2 + i * w / 8), r1(y + i * len / 3), r1(w - i * w / 4), r1(len / 3), colour, 'opacity="' + [.22, .12, .05][i] + '"'); }).join("");
  }
  function wire(x1, y1, x2, y2, sag, bulbs, seed) { // A cable slung between two points, sagging by `sag`, with `bulbs` little lights hung along it.
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + sag * 2; // The curve's control point: twice the sag gives a dip of `sag` in the middle.
    let lights = "";
    const roll = dice(seed || 3);
    for (let i = 1; i <= bulbs; i++) { // Each bulb sits on the curve itself (the quadratic at t).
      const t = i / (bulbs + 1), u = 1 - t, bx = r1(u * u * x1 + 2 * u * t * cx + t * t * x2), by = r1(u * u * y1 + 2 * u * t * cy + t * t * y2);
      lights += line(bx, by, bx, r1(by + 5), INK, 1) + circle(bx, r1(by + 7), 2.4, NEON[Math.floor(roll(0, 5.9))]);
    }
    return path("M" + x1 + " " + y1 + " Q" + r1(cx) + " " + r1(cy) + " " + x2 + " " + y2, "none", 'stroke="' + INK + '" stroke-width="1.6"') + (bulbs ? glow(lights) : "");
  }
  function holo(x, y, w, h, colour, words, size, beam) { // A hologram billboard: see-through, scanlined, its words glowing; beam: the projector's cone below it.
    let scan = "";
    for (let sy = y + 3; sy < y + h; sy += 4) scan += rect(x, sy, w, 1, colour, 'opacity=".16"'); // The scanlines.
    const cone = beam ? path("M" + (x + w / 2 - 4) + " " + (y + h + beam) + " L" + x + " " + (y + h) + " H" + (x + w) + " Z", colour, 'opacity=".07"') + circle(x + w / 2, y + h + beam, 2.5, colour) : "";
    return cone + rect(x, y, w, h, colour, 'opacity=".1"') + scan + rect(x, y, w, h, "none", 'stroke="' + colour + '" stroke-width="1.5" opacity=".75"') +
      rect(x + 4, y + 4, 10, 2, colour, 'opacity=".8"') + rect(x + w - 14, y + h - 6, 10, 2, colour, 'opacity=".8"') + // Two little corner ticks, like a screen's frame.
      neon(r1(x + w / 2), r1(y + h / 2 + size * .36), words, size, colour, 'font-family="monospace" font-weight="bold" letter-spacing="2"');
  }
  function skyline(seed, base, low, high, fill, lit, odds) { // A row of towers across the whole picture, some with antennas, some windows lit.
    let x = -20, out = "", windows = "";
    const roll = dice(seed);
    while (x < 1040) {
      const w = Math.round(roll(24, 56)), h = Math.round(roll(low, high));
      out += rect(x, base - h, w + 1, h, fill);
      if (roll(0, 1) > .72) { const ax = x + Math.round(w / 2), ah = Math.round(roll(8, 22)); out += line(ax, base - h, ax, base - h - ah, fill, 2); windows += circle(ax, base - h - ah, 1.6, "#ff3d6e"); } // An antenna with its red light.
      if (lit) for (let wy = base - h + 6; wy < base - 6; wy += 10) for (let wx = x + 4; wx < x + w - 5; wx += 8) if (roll(0, 1) > odds) windows += rect(wx, wy, 3, 4, lit[Math.floor(roll(0, lit.length - .1))]);
      x += w;
    }
    return out + glow(windows); // The lit windows breathe together, like a city humming.
  }
  function city(night, seed, base) { // The skyline: three layers of towers down to `base`, far and faint to near and dark, with smog at their feet.
    return skyline(seed, base, 60, 128, night ? "#24104a" : "#3a1a5e", ["#ff8ecb", "#c9a8ff"], .9) +
      rect(-20, base - 70, 1040, 70, "#ff5fb0", 'opacity=".07"') + // Smog between the layers.
      skyline(seed + 7, base, 34, 92, night ? "#170b33" : "#26124a", ["#ffdc83", "#70ebea", "#ff8ecb"], .86) +
      skyline(seed + 13, base, 16, 52, night ? "#0e0724" : "#180c34", ["#ffdc83", "#ff9d6b"], .8) +
      rect(-20, base - 22, 1040, 22, "#ff5fb0", 'opacity=".09"'); // The glow of the streets coming up off the towers' feet.
  }
  function vent(x, y) { // A grate in the road breathing steam (game.css lifts it; it holds still for reduced motion).
    let bars = "";
    for (let i = 0; i < 5; i++) bars += rect(x - 13 + i * 6, y - 2, 2.5, 4, INK);
    return oval(x, y, 18, 5, STEEL) + bars + group(oval(x, y - 14, 13, 8, "#eadcff", 'opacity=".18"') + oval(x + 6, y - 30, 18, 11, "#eadcff", 'opacity=".11"') +
      oval(x - 4, y - 50, 24, 13, "#eadcff", 'opacity=".06"'), 'class="lp-tw-steam"');
  }
  function rain(seed) { // Light rain over the whole picture: a tile of drops drawn twice, one above the other, that game.css slides down (and hides for reduced motion).
    const roll = dice(seed);
    let drops = "";
    for (let i = 0; i < 90; i++) { const x = roll(-20, 1040), y = roll(-20, 540); drops += line(x, y, r1(x - 3), r1(y + 14), "#cfd8ff", 1, 'opacity="' + roll(.12, .38) + '"'); }
    return group(group(drops, 'transform="translate(0 -560)"') + drops, 'class="lp-tw-rain" pointer-events="none"');
  }

  // ---- The map ---------------------------------------------------------------------------------------------
  function sky(night, top) { // The smoggy sky down to `top`: magenta at the horizon, indigo above, a few stars through the haze and a hazy moon.
    const roll = dice(5), id = "lptw-sky-" + (night ? "n" : "d");
    const stops = night ? ["#090420", "#2a0f4e", "#7a1f6c"] : ["#1c0b40", "#55186a", "#c63a8c"]; // Neon dusk, or deep night.
    let stars = "", smog = "";
    for (let i = 0; i < 20; i++) stars += circle(roll(-10, 1010), roll(6, top * .45), roll(.5, 1.3), "#ffd6f0", 'opacity="' + roll(.2, .6) + '"');
    for (let i = 0; i < 5; i++) smog += oval(roll(-60, 1060), roll(top * .3, top * .85), roll(160, 320), roll(8, 20), "#ff6fb8", 'opacity="' + roll(.05, .12) + '"'); // Bands of lit smog.
    const moon = glow(circle(880, 46, 40, "#ffb8e0", 'opacity=".12"')) + circle(880, 46, 18, "#ffd8ef", 'opacity=".7"') + circle(887, 41, 15, stops[0], 'opacity=".55"');
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' + stops.map(function (c, i) { return '<stop offset="' + i / 2 + '" stop-color="' + c + '"/>'; }).join("") + "</linearGradient></defs>" +
      rect(-20, -20, 1040, top + 20, "url(#" + id + ")") + stars + moon + smog;
  }

  function ground(night) { // Wet pavement everywhere, the high street's asphalt with its lane lines and kerb lights, and the lane in front of the bottom row.
    const roll = dice(9), road = night ? "#0c0819" : "#110b22";
    let slabs = "", puddles = "", dashes = "";
    for (let y = 164; y < 446; y += 26) slabs += rect(-20, y, 1040, 1, "#2a1e48", 'opacity=".5"'); // The pavement's seams.
    for (let i = 0; i < 16; i++) { const x = roll(-10, 1010), y = roll(150, 440); if (y > 232 && y < 304) continue; puddles += oval(x, y, roll(14, 34), roll(2, 4), "#3a2468", 'opacity=".55"') + oval(x - 4, y - 1, roll(4, 10), 1, "#ff8ecb", 'opacity=".25"'); }
    for (let x = -10; x < 1030; x += 44) dashes += rect(x, 268, 24, 2, "#ffdc83", 'opacity=".4"') + rect(x, 271, 24, 3, "#ffdc83", 'opacity=".07"'); // The lane line, and its shimmer in the wet.
    let sheen = "";
    for (let i = 0; i < 12; i++) sheen += rect(roll(-20, 980), roll(246, 292), roll(40, 120), 1.2, "#c9a8ff", 'opacity="' + roll(.06, .16) + '"'); // Streaks of wet shine on the asphalt.
    return rect(-20, 140, 1040, 380, night ? "#150e2a" : "#1a1232") + slabs + puddles +
      rect(-20, 240, 1040, 58, road) + sheen + dashes +
      rect(-20, 240, 1040, 2, HOT, 'opacity=".55"') + rect(-20, 242, 1040, 4, HOT, 'opacity=".1"') + rect(-20, 296, 1040, 2, "#70ebea", 'opacity=".45"') + // Kerb lights along both sides.
      path("M-20 446 Q500 432 1020 446 V488 Q500 474 -20 488 Z", road) + path("M-20 446 Q500 432 1020 446", "none", 'stroke="#70ebea" stroke-width="1.5" opacity=".4"') + // The lane: more wet asphalt.
      path("M486 298 Q480 372 492 440 H510 Q520 372 514 298 Z", road) + path("M500 304 V436", "none", 'stroke="#ffdc83" stroke-width="1.5" stroke-dasharray="6 8" opacity=".35"'); // A walk up from the lane to the high street.
  }

  function tree(x, y, size, night) { // A street tree under the neon: a dark crown edged in light, strung with a few fairy lights.
    const roll = dice(Math.round(x + size)), edge = NEON[Math.round(x) % 3 === 0 ? 4 : 3];
    let lights = "";
    for (let i = 0; i < 5; i++) lights += circle(r1(x + roll(-size * .5, size * .5)), r1(y - size * 1.2 + roll(-size * .3, size * .3)), 1.6, NEON[i]);
    return oval(x, y + 2, size * .5, 3, edge, 'opacity=".18"') + rect(x - 3, y - size * .9, 6, size * .9, "#1c1430") +
      circle(x, y - size * 1.2, size * .62, night ? "#0e1a24" : "#132230", 'stroke="' + edge + '" stroke-width="1.5" stroke-opacity=".6"') + circle(x - size * .3, y - size, size * .42, night ? "#0e1a24" : "#132230") + circle(x + size * .32, y - size * 1.02, size * .44, night ? "#0e1a24" : "#132230") +
      glow(lights);
  }

  function lamp(x, y, night) { // A street light: a dark pole bending over the road, a neon tube under its head in Lumi's glow, and its pool on the wet ground.
    const d = x < 500 ? 1 : -1; // Which way it leans: towards the middle.
    return oval(x + 16 * d, y + 3, 30, 5, "#ff8ecb", pet('opacity=".2"')) + rect(x - 2.5, y - 70, 5, 70, STEEL) + rect(x - 7, y - 4, 14, 4, STEEL) +
      path("M" + x + " " + (y - 70) + " Q" + x + " " + (y - 80) + " " + (x + 12 * d) + " " + (y - 80) + " H" + (x + 28 * d), "none", 'stroke="' + STEEL + '" stroke-width="4"') +
      rect(Math.min(x + 6 * d, x + 30 * d), y - 82, 24, 5, STEEL, 'rx="2"') +
      glow(rect(Math.min(x + 8 * d, x + 28 * d), y - 77, 20, 2.5, "#ff8ecb", pet()) + rect(Math.min(x + 4 * d, x + 32 * d), y - 80, 28, 10, "#ff8ecb", pet('opacity=".22"')));
  }

  function vending(x, y, colour) { // A vending machine glowing at the kerb, its front a little screen of cans.
    let cans = "";
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cans += rect(x - 10 + c * 7, y - 46 + r * 9, 4, 6, NEON[(r + c * 2) % 6]);
    return rect(x - 16, y - 58, 32, 58, "#1a1232", 'rx="2"') + rect(x - 13, y - 50, 26, 30, "#06030f") + glow(rect(x - 13, y - 50, 26, 30, colour, 'opacity=".22"') + cans) +
      tube(box(x - 16, y - 58, 32, 58), colour, 1.2) + rect(x - 10, y - 14, 20, 4, INK) + rect(x - 18, y - 62, 36, 6, colour, 'opacity=".9"') +
      reflect(x, y + 2, 26, colour, 18);
  }

  function shopfront(x, base, w, h, colour, words) { // A side building at the street's end: a dark block, a lit window or two, and its own neon name.
    const roll = dice(Math.round(x * 3 + h));
    let windows = "";
    for (let wy = base - h + 10; wy < base - 34; wy += 12) for (let wx = x - w / 2 + 6; wx < x + w / 2 - 8; wx += 10) if (roll(0, 1) > .55) windows += rect(r1(wx), wy, 5, 6, roll(0, 1) > .5 ? "#ffdc83" : "#c9a8ff", 'opacity=".75"');
    return rect(x - w / 2, base - h, w, h, "#140c28") + rect(x - w / 2, base - h, w, 3, "#24184a") + windows +
      rect(x - w / 2 + 6, base - 26, w - 12, 26, colour, 'opacity=".12"') + rect(x - w / 2 + 6, base - 26, w - 12, 26, "none", 'stroke="' + colour + '" stroke-width="1" opacity=".5"') +
      rect(x - w * .36, base - 44, w * .72, 14, INK, 'rx="3"') + neon(x, base - 33, words, 10, colour, 'font-family="monospace" font-weight="bold" letter-spacing="2"') +
      reflect(x, base + 4, w * .6, colour, 22);
  }

  function label(x, y, words) { // The picked place's name in a little bubble over it, its rim in Lumi's glow.
    const w = Math.max(60, String(words).length * 8.4 + 22);
    return group(rect(x - w / 2, y - 18, w, 24, "#0d0720", petLine('rx="12" opacity=".94" stroke="#ff8ecb" stroke-width="1.5"')) + path("M" + (x - 6) + " " + (y + 6) + " l6 7 l6 -7 Z", "#0d0720") +
      text(x, y - 1, esc(words), 13, "#ffe9f5", 'font-family="monospace" letter-spacing="1"'), 'class="lp-tw-label"');
  }

  function arcade(cx, base, night) { // A violet arcade outlined in neon, a big cyan sign, two game screens in its windows and a glowing glass door.
    const screen = function (x, colours) { // A window showing a little game, glowing.
      return rect(x, base - 72, 32, 28, "#07031a", 'rx="3"') + glow(rect(x, base - 72, 32, 28, "#70ebea", 'rx="3" opacity=".12"') + colours.map(function (c, i) { return rect(x + 4 + i * 8, base - 66 + (i % 2) * 6, 6, 6, c); }).join("")) +
        rect(x + 10, base - 52, 12, 3, "#ffffff", 'opacity=".7"') + tube(box(x, base - 72, 32, 28), "#c9a8ff", 1);
    };
    return rect(cx - 60, base - 112, 120, 112, "#1e1042") + rect(cx - 60, base - 112, 120, 6, "#120a2c") +
      [cx - 40, cx + 40].map(function (x) { return rect(x - 1, base - 112, 2, 112, "#2e1a5c"); }).join("") + // Panel seams.
      line(cx + 34, base - 112, cx + 34, base - 128, STEEL, 2) + oval(cx + 34, base - 130, 6, 3, STEEL) + glow(circle(cx + 34, base - 134, 1.8, "#ff3d6e")) + // A little dish on the roof.
      tube("M" + (cx - 64) + " " + (base - 115) + " H" + (cx + 64), HOT, 2.5) + // The roof's neon trim.
      rect(cx - 50, base - 104, 100, 24, "#07031a", 'rx="4"') + tube(box(cx - 50, base - 104, 100, 24), "#70ebea", 1.4) + neon(cx, base - 87, "ARCADE", 15, "#70ebea", 'font-family="monospace" font-weight="bold" letter-spacing="3"') +
      screen(cx - 52, ["#ff8ecb", "#ffdc83", "#70ebea"]) + screen(cx + 20, ["#c9a8ff", "#8be9a8", "#ff9d6b"]) +
      rect(cx - 15, base - 48, 30, 48, HOT, 'rx="2" opacity="' + (night ? ".45" : ".35") + '"') + glow(rect(cx - 12, base - 45, 24, 42, "#ff8ecb", 'opacity=".3"')) + tube(box(cx - 15, base - 48, 30, 48), "#ff8ecb", 1.5) + line(cx, base - 48, cx, base, "#ffe9f5", 1.2, 'opacity=".7"') +
      glow(circle(cx - 46, base - 30, 3, "#ffdc83")) + glow(circle(cx + 46, base - 22, 3, "#70ebea")) + neon(cx + 44, base - 10, "★", 11, "#ffdc83");
  }

  function tavern(cx, base, night) { // The Lantern & Paw: a dark timbered inn, neon along its roof, a steaming flue, red paper lanterns and a glowing paw sign.
    const lit = night ? "#ffb86a" : "#ffcf7a";
    return rect(cx + 26, base - 150, 14, 34, STEEL) + rect(cx + 24, base - 152, 18, 4, "#3a3352") + group(oval(cx + 34, base - 162, 10, 7, "#eadcff", 'opacity=".22"') + oval(cx + 42, base - 178, 13, 8, "#eadcff", 'opacity=".12"'), 'class="lp-tw-steam"') + // The flue and its steam.
      path("M" + (cx - 70) + " " + (base - 92) + " L" + cx + " " + (base - 148) + " L" + (cx + 70) + " " + (base - 92) + " Z", "#1c1030") +
      tube("M" + (cx - 70) + " " + (base - 92) + " L" + cx + " " + (base - 148) + " L" + (cx + 70) + " " + (base - 92), "#ff9d6b", 2) + // The roof's edge, lit.
      rect(cx - 58, base - 94, 116, 94, "#2a1a36") + [-58, -20, 18, 54].map(function (dx) { return rect(cx + dx, base - 94, 4, 94, "#170d22"); }).join("") + rect(cx - 58, base - 50, 116, 4, "#170d22") +
      [cx - 44, cx + 28].map(function (x) { return rect(x, base - 84, 18, 22, lit) + line(x + 9, base - 84, x + 9, base - 62, "#170d22", 2) + glow(rect(x - 3, base - 87, 24, 28, "#ffb86a", 'opacity=".22"')); }).join("") +
      path("M" + (cx - 13) + " " + base + " V" + (base - 32) + " Q" + cx + " " + (base - 46) + " " + (cx + 13) + " " + (base - 32) + " V" + base + " Z", "#120a1c") + glow(path("M" + (cx - 9) + " " + base + " V" + (base - 30) + " Q" + cx + " " + (base - 40) + " " + (cx + 9) + " " + (base - 30) + " V" + base + " Z", "#ff9d6b", 'opacity=".25"')) + circle(cx + 7, base - 16, 2, "#ffdc83") +
      [cx - 66, cx + 66].map(function (x) { return line(x, base - 94, x, base - 86, INK, 1) + glow(oval(x, base - 78, 6, 8, "#ff3d5a") + oval(x, base - 78, 11, 13, "#ff3d5a", 'opacity=".2"')) + rect(x - 4, base - 86, 8, 2, "#170d22"); }).join("") + // Red paper lanterns at the eaves.
      line(cx - 50, base - 40, cx - 50, base - 30, STEEL, 1.5) + line(cx - 30, base - 40, cx - 30, base - 30, STEEL, 1.5) + rect(cx - 56, base - 30, 32, 18, INK, 'rx="3"') + tube(box(cx - 56, base - 30, 32, 18), "#ff8ecb", 1) +
      glow(circle(cx - 40, base - 19, 4, "#ff8ecb") + circle(cx - 45, base - 25, 1.8, "#ff8ecb") + circle(cx - 40, base - 27, 1.8, "#ff8ecb") + circle(cx - 35, base - 25, 1.8, "#ff8ecb")); // The sign: Lumi's paw, in neon.
  }

  function casino(cx, base, night) { // Lumi's Lounge: a wine-dark front framed in gold neon, a marquee of bulbs, card suits glowing in the windows and a lit carpet.
    let bulbs = "";
    for (let x = cx - 58; x <= cx + 58; x += 9.6) bulbs += circle(r1(x), base - 128, 2.4, "#ffdc83") + circle(r1(x), base - 100, 2.4, "#ffdc83");
    return rect(cx - 60, base - 104, 120, 104, "#2a0a24") + tube(box(cx - 60, base - 104, 120, 104), "#ff8ecb", 1.5) +
      [cx - 52, cx + 44].map(function (x) { return rect(x, base - 96, 8, 96, "#3a0f30") + tube("M" + (x + 4) + " " + (base - 96) + " V" + base, "#ffdc83", 1); }).join("") + // Two lit pillars.
      rect(cx - 62, base - 132, 124, 34, "#12040e", 'rx="4"') + glow(bulbs) + neon(cx, base - 109, "LUMI’S LOUNGE", 11.5, "#ffdc83", 'font-family="serif" font-weight="bold" letter-spacing="1.5"') +
      [["♠", cx - 30, "#70ebea"], ["♥", cx + 30, "#ff8ecb"]].map(function (s) { return rect(s[1] - 13, base - 84, 26, 28, "#0b0618", 'rx="3"') + tube(box(s[1] - 13, base - 84, 26, 28), "#ffdc83", 1) + neon(s[1], base - 63, s[0], 18, s[2]); }).join("") +
      rect(cx - 16, base - 44, 32, 44, "#ffdc83", 'opacity=".85"') + rect(cx - 13, base - 41, 12, 41, "#3a0a24") + rect(cx + 1, base - 41, 12, 41, "#3a0a24") + glow(rect(cx - 13, base - 41, 26, 41, HOT, 'opacity=".18"')) +
      path("M" + (cx - 14) + " " + base + " L" + (cx + 14) + " " + base + " L" + (cx + 18) + " " + (base + 10) + " L" + (cx - 18) + " " + (base + 10) + " Z", HOT, 'opacity=".75"'); // The carpet, glowing out to the street.
  }

  function house(cx, base, night) { // Lumi's own house: a little plum home, its roofline lit in Lumi's own glow, a round star window, a neon heart on the door and a lit fence.
    const lit = night ? "#ffb86a" : "#ffcf7a";
    return rect(cx + 20, base - 124, 12, 26, STEEL) + group(oval(cx + 26, base - 132, 8, 5, "#eadcff", 'opacity=".16"'), 'class="lp-tw-steam"') +
      path("M" + (cx - 60) + " " + (base - 76) + " L" + cx + " " + (base - 128) + " L" + (cx + 60) + " " + (base - 76) + " Z", "#1c1036") +
      tube("M" + (cx - 60) + " " + (base - 76) + " L" + cx + " " + (base - 128) + " L" + (cx + 60) + " " + (base - 76), "#ff8ecb", 2.5, true) + // Her roofline, in her own glow.
      circle(cx, base - 96, 10, lit) + tube("M" + (cx - 10) + " " + (base - 96) + " a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0", "#ffe9f5", 1.4) + text(cx, base - 92, "★", 11, "#ff2e97") +
      rect(cx - 50, base - 78, 100, 78, "#2c1840") + rect(cx - 50, base - 78, 100, 5, "#3a2052") +
      rect(cx - 40, base - 62, 22, 20, lit) + rect(cx + 18, base - 62, 22, 20, lit) + tube(box(cx - 40, base - 62, 22, 20), "#ffe9f5", 1) + tube(box(cx + 18, base - 62, 22, 20), "#ffe9f5", 1) +
      glow(rect(cx - 42, base - 64, 84, 24, "#ffb86a", 'opacity=".14"')) +
      rect(cx - 12, base - 40, 24, 40, "#160c26", 'rx="10"') + neon(cx, base - 14, "♥", 14, "#ff8ecb") +
      [-56, -48, 48, 56].map(function (dx) { return rect(cx + dx - 2, base - 14, 4, 14, STEEL); }).join("") +
      tube("M" + (cx - 58) + " " + (base - 9) + " H" + (cx - 46) + " M" + (cx + 46) + " " + (base - 9) + " H" + (cx + 58), "#ff8ecb", 1.5, true); // (Her house's name shows in the picked label: "Lumi's house".)
  }

  function garden(cx, base, night) { // The Stardust Garden's gate: dark hedges full of glowing blooms, and a neon arch strung with more (the LUMI TOWN sign stands just above it).
    const roll = dice(41);
    let blooms = "";
    for (let i = 0; i < 18; i++) { const a = Math.PI * (i / 17), x = cx + Math.cos(a) * 30, y = base - 62 - Math.sin(a) * 34; blooms += circle(r1(x + roll(-3, 3)), r1(y + roll(-3, 3)), roll(2.5, 4), NEON[i % NEON.length]); }
    let beds = "";
    for (let i = 0; i < 10; i++) { const side = i < 5 ? -1 : 1, x = cx + side * (40 + (i % 5) * 4), y = base - 10 - (i % 5) * 6; beds += line(x, y + 8, x, y, "#1f5a3a", 1.5) + circle(x, y, 3, NEON[(i + 2) % NEON.length]); }
    return rect(cx - 62, base - 40, 46, 40, "#0c2620", 'rx="14"') + rect(cx + 16, base - 40, 46, 40, "#0c2620", 'rx="14"') +
      tube("M" + (cx - 30) + " " + base + " V" + (base - 62) + " A30 34 0 0 1 " + (cx + 30) + " " + (base - 62) + " V" + base, "#8be9a8", 3) + glow(blooms) +
      rect(cx - 20, base - 34, 18, 34, "none", 'stroke="' + STEEL + '" stroke-width="2"') + rect(cx + 2, base - 34, 18, 34, "none", 'stroke="' + STEEL + '" stroke-width="2"') + glow(beds) +
      glow(text(cx - 52, base - 54, "✦", 10, "#ffdc83") + text(cx + 54, base - 60, "✧", 12, "#c9a8ff"));
  }

  function field(cx, base, night) { // The Lumi-Soft field: a fenced square of holo-turf ruled in neon, cardboard creatures on stakes, and the banner over the gate.
    const critter = function (x, y, s, c) { // A cardboard creature: round head, two ears, a stake.
      return line(x, y, x, y + s * 1.3, "#5a4a3a", 2) + circle(x, y - s * .2, s, c, 'stroke="#5a4a3a" stroke-width="1.2"') + path("M" + (x - s * .8) + " " + (y - s * .7) + " l" + s * .2 + " " + (-s * .7) + " l" + s * .4 + " " + s * .5 + " Z M" + (x + s * .8) + " " + (y - s * .7) + " l" + (-s * .2) + " " + (-s * .7) + " l" + (-s * .4) + " " + s * .5 + " Z", c) +
        circle(x - s * .3, y - s * .3, s * .12, "#3a2a2a") + circle(x + s * .3, y - s * .3, s * .12, "#3a2a2a") + circle(x, y - s * .2, s * .55, "none", 'stroke="' + HOT + '" stroke-width="1" opacity=".8"');
    };
    let grid = "", fence = "";
    for (let x = cx - 50; x < cx + 62; x += 16) grid += line(x, base - 88, x, base - 4, "#8be9a8", .8, 'opacity=".22"');
    for (let y = base - 80; y < base; y += 14) grid += line(cx - 60, y, cx + 60, y, "#8be9a8", .8, 'opacity=".22"');
    for (let x = cx - 60; x <= cx + 60; x += 15) fence += rect(x - 1.5, base - 22, 3, 22, STEEL);
    return rect(cx - 62, base - 92, 124, 92, night ? "#0a1c1a" : "#0e2420", 'rx="6"') + grid +
      critter(cx - 34, base - 66, 9, "#c8a880") + critter(cx + 8, base - 74, 7, "#d8b890") + critter(cx + 40, base - 58, 10, "#c8a880") + critter(cx - 4, base - 46, 8, "#d0b088") +
      fence + tube("M" + (cx - 62) + " " + (base - 16) + " H" + (cx + 62), "#70ebea", 1.5) + rect(cx - 62, base - 9, 124, 3, STEEL) +
      line(cx - 44, base - 22, cx - 44, base - 104, STEEL, 3) + line(cx + 44, base - 22, cx + 44, base - 104, STEEL, 3) +
      path("M" + (cx - 46) + " " + (base - 106) + " H" + (cx + 46) + " V" + (base - 88) + " L" + cx + " " + (base - 82) + " L" + (cx - 46) + " " + (base - 88) + " Z", "#14081e") +
      tube("M" + (cx - 46) + " " + (base - 106) + " H" + (cx + 46) + " V" + (base - 88) + " L" + cx + " " + (base - 82) + " L" + (cx - 46) + " " + (base - 88) + " Z", "#ff8ecb", 1.5, true) +
      neon(cx, base - 92, "LUMI-SOFT", 10.5, "#ff8ecb", 'font-family="monospace" font-weight="bold" letter-spacing="2"') + glow(text(cx + 56, base - 98, "🎯", 12, "#ffffff"));
  }

  function cafe(cx, base, night) { // The Retro café: a dark teal shopfront in cyan neon, a giant glowing cartridge on the roof, a pixel picture and a cocoa in the windows.
    const lit = night ? "#ffb86a" : "#ffcf7a";
    let pixels = "";
    [[0, 0, 0], [1, 0, 1], [2, 0, 0], [0, 1, 1], [1, 1, 1], [2, 1, 1], [0, 2, 1], [2, 2, 1]].forEach(function (p, i) { if (p[2]) pixels += rect(cx - 46 + p[0] * 7, base - 66 + p[1] * 7, 6, 6, NEON[i % NEON.length]); });
    return rect(cx - 30, base - 150, 60, 34, "#1e1240", 'rx="4"') + tube("M" + (cx - 26) + " " + (base - 150) + " h52 a4 4 0 0 1 4 4 v26 a4 4 0 0 1 -4 4 h-52 a4 4 0 0 1 -4 -4 v-26 a4 4 0 0 1 4 -4 Z", "#c9a8ff", 1.8) + // The cartridge on the roof.
      rect(cx - 22, base - 146, 44, 18, "#c9a8ff", 'rx="2" opacity=".18"') + neon(cx, base - 133, "RETRO", 9, "#c9a8ff", 'font-family="monospace" font-weight="bold" letter-spacing="2"') + [-14, -6, 2, 10].map(function (dx) { return rect(cx + dx, base - 118, 4, 4, "#ffdc83"); }).join("") +
      rect(cx - 60, base - 114, 120, 114, "#0e2430") + rect(cx - 60, base - 114, 120, 6, "#081820") +
      rect(cx - 64, base - 108, 128, 20, "#05121a", 'rx="4"') + tube(box(cx - 64, base - 108, 128, 20), "#70ebea", 1.4) + neon(cx, base - 93, "RETRO CAFÉ", 12, "#70ebea", 'font-family="monospace" font-weight="bold" letter-spacing="2"') +
      rect(cx - 52, base - 74, 36, 30, "#04060f", 'rx="3"') + glow(pixels) + tube(box(cx - 52, base - 74, 36, 30), "#ff8ecb", 1) + // A little pixel picture in the window.
      rect(cx + 16, base - 74, 36, 30, lit, 'rx="3"') + tube(box(cx + 16, base - 74, 36, 30), "#ff8ecb", 1) + path("M" + (cx + 26) + " " + (base - 62) + " h14 v8 a7 7 0 0 1 -14 0 Z", "#5a3420") + path("M" + (cx + 40) + " " + (base - 60) + " a4 4 0 0 1 0 6", "none", 'stroke="#5a3420" stroke-width="2"') + // A cocoa in the other.
      glow(rect(cx + 13, base - 77, 42, 36, "#ffb86a", 'opacity=".2"')) +
      rect(cx - 13, base - 44, 26, 44, "#05121a", 'rx="2"') + rect(cx - 9, base - 40, 18, 18, lit, 'opacity=".8"') + tube(box(cx - 13, base - 44, 26, 44), "#70ebea", 1) + circle(cx + 8, base - 20, 2, "#ffdc83") +
      glow(text(cx - 44, base - 14, "🎮", 11, "#ffffff")) + text(cx + 46, base - 12, "☕", 11, "#ffffff");
  }

  function market(cx, base, night) { // The Market: a long dark shopfront under a neon-striped awning, a string of glowing bulbs, and crates of goods out front.
    let stripes = "", crates = "", flags = "";
    for (let i = 0; i < 8; i++) stripes += path("M" + r1(cx - 66 + i * 16.5) + " " + (base - 92) + " h16.5 l2 18 a9 9 0 0 1 -18 0 Z", i % 2 ? "#1a0f2e" : HOT, i % 2 ? "" : 'opacity=".85"');
    [[-50, "#ff9d6b"], [-26, "#8be9a8"], [26, "#ffdc83"], [50, "#c9a8ff"]].forEach(function (c) {
      crates += rect(cx + c[0] - 11, base - 18, 22, 18, "#1c1430", 'rx="2"') + tube(box(cx + c[0] - 11, base - 18, 22, 18), c[1], .8) + [-6, 0, 6].map(function (dx) { return circle(cx + c[0] + dx, base - 20, 4, c[1]); }).join("");
    });
    for (let i = 0; i < 7; i++) flags += circle(cx - 50 + i * 18, base - 123 + Math.abs(3 - i), 3, NEON[i % NEON.length]); // Bulbs on the string.
    return rect(cx - 62, base - 118, 124, 118, "#24142c") + rect(cx - 62, base - 118, 124, 6, "#170c20") +
      path("M" + (cx - 66) + " " + (base - 126) + " Q" + cx + " " + (base - 118) + " " + (cx + 66) + " " + (base - 126), "none", 'stroke="' + INK + '" stroke-width="1.5"') + glow(flags) +
      rect(cx - 50, base - 112, 100, 18, "#0b0618", 'rx="4"') + tube(box(cx - 50, base - 112, 100, 18), "#ff9d6b", 1.2) + neon(cx, base - 99, "MARKET", 12, "#ff9d6b", 'font-family="monospace" font-weight="bold" letter-spacing="3"') + stripes +
      tube("M" + (cx - 66) + " " + (base - 74) + " H" + (cx + 66), "#ff8ecb", 1.2) + // The awning's lit hem.
      rect(cx - 52, base - 70, 104, 40, night ? "#ffb86a" : "#ffcf7a", 'opacity=".85"') + rect(cx - 14, base - 66, 28, 66, "#120a1c", 'rx="2"') + tube(box(cx - 14, base - 66, 28, 66), "#ff9d6b", 1) + circle(cx + 9, base - 32, 2, "#ffdc83") +
      text(cx - 34, base - 44, "🍪", 12, "#ffffff") + text(cx + 34, base - 44, "🔮", 12, "#ffffff") + glow(crates) + glow(rect(cx - 52, base - 70, 104, 40, "#ffb86a", 'opacity=".18"'));
  }

  const BUILD = { arcade: arcade, tavern: tavern, casino: casino, home: house, garden: garden, field: field, cafe: cafe, market: market };

  function signpost(to, words, on) { // The way to the other street: a metal post with a neon arrow board, pressable.
    const at = SIGNS[to], x = at[0], y = at[1], right = x > 500, d = right ? 1 : -1;   // d: which way the arrow points
    const arrow = "M" + (x - 32 * d) + " " + (y - 26) + " H" + (x + 32 * d) + " L" + (x + 42 * d) + " " + (y - 15) + " L" + (x + 32 * d) + " " + (y - 4) + " H" + (x - 32 * d) + " Z";
    return group((on ? marker(x - 26 * d, y + 14) : "") + rect(x - 3, y - 6, 6, 18, STEEL) + reflect(x, y + 12, 50, "#70ebea", 16) +
      path(arrow, "#07031a") + tube(arrow, "#70ebea", 1.5) +
      neon(x + (right ? -4 : 4), y - 11, words, 8.5, "#70ebea", 'font-family="monospace" font-weight="bold" letter-spacing="1"') + hit(x - 40, y - 34, 80, 50, "street:" + to), on ? 'class="lp-tw-on"' : "");
  }

  function shine(places) { // Every place's sign mirrored in the wet road at its door: a wide faint smear and a narrow bright one.
    return Object.keys(places).map(function (id) { const at = places[id]; return reflect(at[0], at[1] + 8, 96, SHINE[id], 54) + reflect(at[0], at[1] + 8, 30, SHINE[id], 40); }).join("");
  }

  function townMap(opts) { // The whole map: sky, skyline, wires and billboards, the wet streets, the side shops and lamps, the six places, rain, and who's picked.
    const night = opts.night, picked = MAP[opts.cursor] ? opts.cursor : null;
    let places = "";
    Object.keys(MAP).forEach(function (id) { // Each place, pressable anywhere on it.
      const at = MAP[id], on = id === picked;
      places += group(BUILD[id](at[0], at[1], night) + hit(at[0] - 66, at[1] - 150, 132, 158, "place:" + id), 'data-place="' + id + '"' + (on ? ' class="lp-tw-on"' : ""));
    });
    const overhead = wire(-20, 22, 1040, 30, 26, 14, 21) + wire(-20, 58, 300, 70, 16, 4, 22) + wire(700, 66, 1040, 52, 14, 4, 23) + // Wires across the sky, strung with lights.
      holo(26, 28, 170, 46, "#70ebea", "STAR CANDY", 14, 30) + holo(804, 84, 150, 40, "#ff8ecb", "GLOW ON ✦", 13, 0) + holo(232, 4, 52, 70, "#c9a8ff", "ルミ", 16, 0); // Billboards at the sides and over the towers.
    const sides = vending(40, 232, "#70ebea") + shopfront(150, 232, 116, 92, "#ff8ecb", "NOODLES") + tree(250, 236, 22, night) + tree(780, 230, 26, night) + shopfront(880, 232, 112, 84, "#70ebea", "24/7") + vending(966, 226, "#ffdc83") +
      lamp(282, 244, night) + lamp(718, 244, night) + shopfront(130, 440, 130, 104, "#c9a8ff", "KARAOKE") + tree(226, 446, 26, night) + tree(790, 440, 28, night) + shopfront(900, 444, 120, 98, "#8be9a8", "PIXELS") +
      lamp(282, 448, night) + lamp(718, 448, night) + vent(236, 272) + vent(770, 470) + vent(560, 382);
    const sign = rect(497, 300, 6, 36, STEEL) + rect(468, 304, 64, 16, "#07031a", 'rx="3"') + tube("M471 304 h58 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-58 a3 3 0 0 1 -3 -3 v-10 a3 3 0 0 1 3 -3 Z", "#ff8ecb", 1.2, true) +
      neon(500, 316, "LUMI TOWN", 9, "#ffe9f5", 'font-family="monospace" font-weight="bold" letter-spacing="1"');
    const mark = picked ? marker(MAP[picked][0], MAP[picked][1] + (MAP[picked][1] > 300 ? 38 : 36)) : "";
    const toMarket = opts.cursor === "street:market";
    const tag = picked && opts.label ? label(MAP[picked][0], MAP[picked][1] - (picked === "tavern" ? 160 : 140), opts.label)
      : toMarket && opts.label ? label(SIGNS.market[0] - 40, SIGNS.market[1] - 40, opts.label) : "";
    return group(sky(night, 140) + city(night, 31, 140) + overhead + ground(night) + shine(MAP) + sides + sign + signpost("market", "MARKET ST", toMarket) + mark + places + rain(17) +
      (night ? rect(-20, -20, 1040, 540, "#0a0620", 'opacity=".14" pointer-events="none"') : "") + tag, 'data-town="map" data-time="' + (night ? "night" : "day") + '"');
  }

  // ---- Inside ----------------------------------------------------------------------------------------------
  function exitMat(on) { // The way back out: a dark mat by the front, rimmed in Lumi's glow, with its own little sign.
    return group(rect(452, 470, 96, 22, "#0d0720", petLine('rx="5" stroke="#ff8ecb" stroke-width="1.5"')) + neon(500, 485, "EXIT ▸ TOWN", 10, "#ffe9f5", 'font-family="monospace" letter-spacing="1"') + hit(440, 462, 120, 36, "leave"), on ? 'class="lp-tw-on"' : "");
  }

  function cabinet(x, slug, on) { // One arcade cabinet: its colour, its marquee, a little picture of its game on the screen, and its glow on the shiny floor.
    const colour = { breakout: "#ff8ecb", snake: "#ffdc83", "teacup-tower": "#70ebea", "prism-drop": "#c9a8ff", "lumi-launch": "#8be9a8" }[slug] || "#ff9d6b";
    const name = { breakout: "YARN POP", snake: "CONGA", "teacup-tower": "TEACUPS", "prism-drop": "PRISM", "lumi-launch": "LAUNCH" }[slug] || "GAME";
    let screen = "";
    if (slug === "breakout") { for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) screen += rect(x - 28 + c * 9.5, 212 + r * 7, 8, 5, NEON[(r + c) % 6]); screen += circle(x + 4, 246, 3.5, "#ff8ecb") + rect(x - 10, 256, 22, 3, "#ffe9f5"); }
    else if (slug === "snake") { [[-20, 240], [-12, 240], [-4, 240], [4, 240], [4, 232], [4, 224], [12, 224]].forEach(function (p, i) { screen += circle(x + p[0], p[1], 3.6, NEON[i % 6]); }); screen += circle(x + 20, 248, 3, "#ffdc83"); }
    else if (slug === "teacup-tower") { [[-14, 252], [10, 236], [-8, 220]].forEach(function (p) { screen += path("M" + (x + p[0] - 9) + " " + p[1] + " h18 l-3 7 h-12 Z", "#ffe9f5") + rect(x + p[0] - 12, p[1] + 7, 24, 2, "#70ebea"); }); screen += circle(x + 10, 228, 3.5, "#ff8ecb"); }
    else if (slug === "lumi-launch") { screen += path("M" + (x - 26) + " 254 Q" + (x - 4) + " 196 " + (x + 22) + " 236", "none", 'stroke="#ffdc83" stroke-width="1.5" stroke-dasharray="3 3"') + // her arc out of the cannon
      path("M" + (x - 30) + " 256 l10 -12 l6 5 l-10 12 Z", "#c9a8ff") + circle(x - 24, 256, 4, "#ff8ecb") + glow(circle(x + 22, 236, 4.5, "#ff8ecb")) + rect(x - 30, 258, 60, 3, "#8be9a8", 'opacity=".7"'); }
    else { for (let r = 0; r < 3; r++) for (let c = 0; c < 5 - (r % 2); c++) screen += circle(x - 22 + c * 11 + (r % 2) * 5.5, 222 + r * 11, 2, "#c9a8ff"); screen += glow(circle(x + 2, 214, 4.5, "#ffdc83")) + rect(x - 28, 256, 56, 4, "#70ebea", 'opacity=".7"'); }
    const shell = "M" + (x - 42) + " 390 V184 L" + (x - 36) + " 168 H" + (x + 36) + " L" + (x + 42) + " 184 V390 Z";
    return group((on ? marker(x, 452) : "") + reflect(x, 392, 80, colour, 54) +
      path(shell, "#140a2c") + path(shell, colour, 'opacity=".22"') + tube(shell, colour, 1.6) + // A dark cabinet outlined in its own neon.
      rect(x - 36, 174, 72, 22, "#07031a", 'rx="3"') + neon(x, 189, name, 10, colour, 'font-family="monospace" font-weight="bold" letter-spacing="1"') +
      rect(x - 34, 204, 68, 60, "#05020f", 'rx="4" stroke="#07031a" stroke-width="3"') + group(screen, on ? "" : 'opacity=".8"') + rect(x - 34, 204, 68, 60, colour, 'rx="4" opacity=".06"') +
      path("M" + (x - 40) + " 286 L" + (x - 46) + " 312 H" + (x + 46) + " L" + (x + 40) + " 286 Z", "#1c1040") + circle(x - 18, 298, 5, HOT) + rect(x - 19.5, 290, 3, 8, INK) + circle(x + 10, 299, 4, "#70ebea") + circle(x + 22, 297, 4, "#ffdc83") +
      rect(x - 8, 334, 16, 24, "#07031a", 'rx="2"') + glow(rect(x - 2, 340, 4, 10, "#ffdc83")) + // The coin slot, lit.
      (on ? glow(rect(x - 34, 204, 68, 60, colour, 'rx="4" opacity=".2"')) : "") + hit(x - 44, 166, 88, 290, "game:" + slug), on ? 'class="lp-tw-on"' : "");
  }

  function arcadeInside(opts) { // The Arcade: a dark room of neon panels and cables, a starry carpet, the cabinets in a row, a claw machine and the prize shelf at the sides.
    const roll = dice(13);
    let stars = "";
    for (let i = 0; i < 60; i++) stars += text(roll(-10, 1010), roll(362, 498), i % 3 ? "✦" : "·", roll(7, 12), NEON[i % 6], 'opacity=".4"');
    let waves = "";
    [70, 120].forEach(function (y, i) { waves += path("M-20 " + y + " Q60 " + (y - 14) + " 140 " + y + " T300 " + y + " T460 " + y + " T620 " + y + " T780 " + y + " T940 " + y + " T1100 " + y, "none", 'stroke="' + NEON[i * 2] + '" stroke-width="3" opacity=".35"'); });
    let panels = "";
    for (let x = 20; x < 1040; x += 80) panels += rect(x, 150, 1, 200, "#c9a8ff", 'opacity=".12"'); // The wall's panel seams.
    const ceiling = wire(-20, 0, 1040, 0, 14, 0) + wire(-20, 6, 520, 4, 22, 6, 31) + wire(480, 4, 1040, 8, 20, 6, 32); // Cables slung under the ceiling.
    const claw = rect(132, 190, 96, 200, "#1a0c34", 'rx="6"') + tube("M138 190 h84 a6 6 0 0 1 6 6 v188 a6 6 0 0 1 -6 6 h-84 a6 6 0 0 1 -6 -6 v-188 a6 6 0 0 1 6 -6 Z", "#ff8ecb", 1.6) + rect(140, 200, 80, 110, "#06030f", 'rx="4"') + glow(rect(140, 200, 80, 110, "#70ebea", 'rx="4" opacity=".1"')) +
      line(180, 200, 180, 238, "#d8d8e8", 2) + path("M172 238 h16 l4 10 M172 238 l-4 10", "none", 'stroke="#d8d8e8" stroke-width="2.5"') +
      [[156, 296, 0], [176, 300, 2], [198, 294, 3], [206, 302, 4]].map(function (p) { return circle(p[0], p[1], 8, NEON[p[2]]); }).join("") + neon(180, 352, "CLAW", 12, "#ff8ecb", 'font-family="monospace" font-weight="bold"') + reflect(180, 392, 90, "#ff8ecb", 50);
    const prizes = rect(772, 160, 150, 4, "#c9a8ff", 'opacity=".7"') + rect(772, 228, 150, 4, "#c9a8ff", 'opacity=".7"') + rect(772, 296, 150, 4, "#c9a8ff", 'opacity=".7"') +
      glow([[790, 150, 0], [826, 146, 2], [866, 152, 3], [902, 148, 1], [796, 218, 4], [840, 214, 5], [884, 216, 0], [808, 286, 3], [858, 282, 1], [900, 288, 2]].map(function (p) { return circle(p[0], p[1], 10, NEON[p[2]], 'opacity=".9"'); }).join("")) +
      rect(764, 320, 166, 70, "#12082a", 'rx="4"') + tube(box(764, 320, 166, 70), "#ffdc83", 1.4) + neon(847, 362, "PRIZES", 14, "#ffdc83", 'font-family="monospace" font-weight="bold" letter-spacing="2"') + reflect(847, 392, 140, "#ffdc83", 44);
    let cabinets = "";
    const row = stations(opts.games.length), snug = opts.games.length > 4;
    opts.games.forEach(function (slug, i) { // five in a row stand a little smaller, scaled about the spot Lumi stands on
      const one = cabinet(row[i], slug, opts.cursor === i);
      cabinets += snug ? group(one, 'transform="translate(' + row[i] + ' 452) scale(' + SNUG + ') translate(' + (-row[i]) + ' -452)"') : one;
    });
    return group(rect(-20, -20, 1040, 372, "#110726") + panels + waves + ceiling + neon(500, 120, "✦ A R C A D E ✦", 30, "#70ebea", 'font-family="monospace" font-weight="bold"') +
      holo(14, 150, 96, 34, "#8be9a8", "HI-SCORE", 10, 0) + holo(894, 64, 96, 34, "#ff8ecb", "1UP ✦", 12, 0) +
      rect(-20, 350, 1040, 170, "#0a0420") + stars + rect(-20, 348, 1040, 2, HOT, 'opacity=".8"') + rect(-20, 350, 1040, 6, HOT, 'opacity=".12"') + claw + prizes + cabinets + exitMat(opts.cursor === opts.games.length) +
      (opts.night ? "" : rect(-20, -20, 1040, 540, "#ff8ecb", 'opacity=".03" pointer-events="none"')), 'data-town="arcade"');
  }

  function station(x, slug, on) { // One of the Casino's tables: blackjack, roulette, the horse-racing screen, or a slot machine, each with its glow on the glossy floor.
    let art = "";
    const edge = { blackjack: "#8be9a8", roulette: "#ff8ecb", "horse-racing": "#70ebea", slots: "#ffdc83" }[slug] || "#ffdc83";
    if (slug === "blackjack") art = path("M" + (x - 42) + " 336 A42 30 0 0 0 " + (x + 42) + " 336 Z", "#0f4a34") + tube("M" + (x - 42) + " 336 A42 30 0 0 0 " + (x + 42) + " 336 Z", "#8be9a8", 1.6) + rect(x - 42, 330, 84, 8, "#1c0a1c") +
      rect(x - 16, 342, 12, 16, "#ffffff", 'rx="2" transform="rotate(-8 ' + (x - 10) + ' 350)"') + rect(x - 2, 342, 12, 16, "#ffffff", 'rx="2" transform="rotate(8 ' + (x + 4) + ' 350)"') + text(x - 9, 354, "A", 8, "#c8304a") + text(x + 5, 354, "K", 8, "#1a0f2e") +
      [0, 1, 2].map(function (k) { return oval(x + 30, 352 - k * 3, 7, 3, k % 2 ? "#ff8ecb" : "#ffffff"); }).join("") + line(x - 34, 368, x - 38, 392, STEEL, 5) + line(x + 34, 368, x + 38, 392, STEEL, 5);
    else if (slug === "roulette") {
      let wedges = "";
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, b = a + Math.PI / 6; wedges += path("M" + x + " 300 L" + (x + Math.cos(a) * 30).toFixed(1) + " " + (300 + Math.sin(a) * 30).toFixed(1) + " A30 30 0 0 1 " + (x + Math.cos(b) * 30).toFixed(1) + " " + (300 + Math.sin(b) * 30).toFixed(1) + " Z", i % 2 ? "#0b0618" : "#c8304a"); }
      art = rect(x - 44, 334, 88, 10, "#1c0a1c") + rect(x - 40, 344, 80, 46, "#0f4a34") + tube(box(x - 40, 344, 80, 46), "#8be9a8", 1) + circle(x, 300, 36, "#1c0a1c") + wedges + tube("M" + (x - 36) + " 300 a36 36 0 1 0 72 0 a36 36 0 1 0 -72 0", "#ff8ecb", 1.6) +
        circle(x, 300, 12, "#ffdc83") + circle(x + 22, 290, 3, "#ffffff") + line(x, 290, x, 310, "#1c0a1c", 2) + line(x - 10, 300, x + 10, 300, "#1c0a1c", 2);
    }
    else if (slug === "horse-racing") art = rect(x - 46, 176, 92, 66, "#07031a", 'rx="4"') + tube(box(x - 46, 176, 92, 66), "#70ebea", 1.6) + rect(x - 40, 182, 80, 54, "#123a2a") + rect(x - 40, 196, 80, 2, "#8be9a8", 'opacity=".6"') + rect(x - 40, 214, 80, 2, "#8be9a8", 'opacity=".6"') +
      glow([[-26, 190, 0], [-8, 207, 2], [14, 225, 3], [26, 190, 1]].map(function (p) { return oval(x + p[0], p[1], 6, 3.5, NEON[p[2]]) + circle(x + p[0] + 6, p[1] - 3, 2.4, NEON[p[2]]); }).join("")) + line(x + 34, 182, x + 34, 236, "#ffffff", 2, 'stroke-dasharray="3 3"') +
      rect(x - 40, 318, 80, 72, "#1c0a1c", 'rx="4"') + rect(x - 34, 326, 68, 22, "#07031a", 'rx="3"') + neon(x, 342, "BETS", 12, "#ffdc83", 'font-family="monospace" font-weight="bold" letter-spacing="2"') + text(x, 374, "🏇", 16, "#ffffff");
    else art = path("M" + (x - 36) + " 390 V214 Q" + x + " 186 " + (x + 36) + " 214 V390 Z", "#3a0a2a") + tube("M" + (x - 36) + " 390 V214 Q" + x + " 186 " + (x + 36) + " 214 V390 Z", "#ffdc83", 1.6) + rect(x - 28, 236, 56, 34, "#fff5fb", 'rx="3"') +
      [["7", -18, "#c8304a"], ["★", 0, "#d8b24a"], ["♥", 18, "#ff2e97"]].map(function (r) { return text(x + r[1], 260, r[0], 15, r[2], 'font-weight="bold"'); }).join("") + line(x - 28, 253, x + 28, 253, "#d8b24a", 1, 'opacity=".6"') +
      line(x + 40, 260, x + 40, 228, "#d8d8e8", 3) + glow(circle(x + 40, 224, 6, HOT)) + rect(x - 20, 300, 40, 10, "#07031a", 'rx="2"') + glow(text(x, 206, "♦ ♦ ♦", 9, "#ffdc83"));
    const title = { blackjack: "BLACKJACK", roulette: "ROULETTE", "horse-racing": "RACES", slots: "SLOTS" }[slug] || "";
    return group((on ? marker(x, 452) : "") + reflect(x, 394, 78, edge, 48) + neon(x, slug === "horse-racing" ? 166 : 160, title, 10, on ? "#ffdc83" : edge, 'font-family="monospace" font-weight="bold" letter-spacing="1.5"') + art + hit(x - 44, 150, 88, 306, "game:" + slug), on ? 'class="lp-tw-on"' : "");
  }

  function casinoInside(opts) { // The Casino, Lumi's Lounge: dark velvet walls ruled with neon diamonds, a ring of light for a chandelier, a glossy floor and the four tables.
    let diamonds = "";
    for (let y = 40; y < 340; y += 40) for (let x = -20 + (y % 80 ? 20 : 0); x < 1040; x += 40) diamonds += path("M" + x + " " + (y - 8) + " l6 8 l-6 8 l-6 -8 Z", "none", 'stroke="#ff8ecb" stroke-width="1" opacity=".22"');
    let carpet = "";
    for (let x = -20; x < 1040; x += 60) carpet += path("M" + x + " 420 l30 -20 l30 20 l-30 20 Z", "none", 'stroke="' + HOT + '" stroke-width="1.2" opacity=".35"');
    const chandelier = line(500, 0, 500, 34, STEEL, 2) + tube("M440 46 a60 12 0 1 0 120 0 a60 12 0 1 0 -120 0", "#ffdc83", 2) + // A ring of light for a chandelier, with drops of light under it.
      glow([440, 470, 500, 530, 560].map(function (x) { return line(x, x === 500 ? 58 : 50, x, x === 500 ? 70 : 60, "#ffdc83", 1) + circle(x, x === 500 ? 72 : 62, 3.5, "#ffe6a8") + circle(x, x === 500 ? 72 : 62, 12, "#ffcf7a", 'opacity=".22"'); }).join(""));
    const arch = function (x, words) { return rect(x - 60, 120, 120, 160, "#12040e", 'rx="60"') + tube("M" + (x - 60) + " 280 V180 a60 60 0 0 1 120 0 V280 Z", "#ffdc83", 1.6) + neon(x, 214, words, 30, "#ff8ecb"); }; // A velvet alcove with neon suits.
    const sides = arch(140, "♠ ♥") + arch(860, "♦ ♣") + rect(60, 300, 40, 90, "#ffdc83", 'opacity=".25"') + tube(box(60, 300, 40, 90), "#ffdc83", 1) + rect(900, 300, 40, 90, "#ffdc83", 'opacity=".25"') + tube(box(900, 300, 40, 90), "#ffdc83", 1);
    let tables = "";
    const row = stations(opts.games.length);
    opts.games.forEach(function (slug, i) { tables += station(row[i], slug, opts.cursor === i); });
    return group(rect(-20, -20, 1040, 372, "#1a0418") + diamonds + tube("M-20 346 H1040", "#ffdc83", 2) + neon(500, 112, "LUMI’S LOUNGE", 26, "#ffdc83", 'font-family="serif" font-weight="bold" letter-spacing="4"') +
      chandelier + sides + rect(-20, 352, 1040, 168, "#1e0618") + carpet + tables + exitMat(opts.cursor === opts.games.length), 'data-town="casino"');
  }

  function fieldInside(opts) { // The Lumi-Soft field, up on a rooftop: smog sky and towers behind, holo-turf ruled in neon, cardboard creatures on stakes, rain, and the cushion with the Star Scope in front.
    const night = opts.night, on = opts.cursor === 0;
    const critter = function (x, y, s) { return line(x, y, x, y + s * 1.6, "#5a4a3a", s / 5) + circle(x, y, s, "#d0b088", 'stroke="#5a4a3a" stroke-width="' + s / 8 + '"') +
      path("M" + (x - s * .8) + " " + (y - s * .5) + " l" + s * .2 + " " + (-s * .8) + " l" + s * .45 + " " + s * .55 + " Z M" + (x + s * .8) + " " + (y - s * .5) + " l" + (-s * .2) + " " + (-s * .8) + " l" + (-s * .45) + " " + s * .55 + " Z", "#d0b088") +
      circle(x - s * .32, y - s * .1, s * .12, "#3a2a2a") + circle(x + s * .32, y - s * .1, s * .12, "#3a2a2a") + circle(x, y, s * .6, "none", 'stroke="' + HOT + '" stroke-width="' + s / 10 + '" opacity=".8"'); };
    let turf = "", fence = "";
    for (let i = -10; i <= 10; i++) turf += line(500 + i * 30, 244, 500 + i * 110, 520, "#8be9a8", 1, 'opacity=".16"'); // Neon lines running away to the towers.
    for (let y = 262, step = 14; y < 520; y += step, step += 6) turf += line(-20, y, 1040, y, "#8be9a8", 1, 'opacity=".14"'); // ...and across, wider apart as they come closer.
    for (let x = -20; x < 1040; x += 34) fence += rect(x, 288, 4, 30, STEEL);
    const cushion = oval(500, 440, 90, 22, "#ff8ecb") + oval(500, 434, 84, 16, "#ffb3dc") + rect(520, 412, 70, 14, STEEL, 'rx="7"') + circle(590, 419, 9, "#0b0618", 'stroke="#ffdc83" stroke-width="3"') + text(554, 423, "★", 10, "#ffdc83") + // The Star Scope, resting on the cushion.
      rect(380, 446, 40, 26, "#07031a", 'rx="3"') + tube(box(380, 446, 40, 26), "#70ebea", 1) + neon(400, 464, "25¢", 10, "#70ebea", 'font-family="monospace"');
    return group(sky(night, 250) + city(night, 47, 250) + wire(-20, 40, 1040, 70, 30, 12, 41) +
      holo(40, 120, 140, 44, "#c9a8ff", "PLAY BALL", 13, 40) + holo(830, 100, 140, 44, "#70ebea", "✦ LUMI ✦", 13, 50) +
      rect(-20, 240, 1040, 280, night ? "#071614" : "#0a1c1a") + turf + rect(-20, 240, 1040, 3, "#8be9a8", 'opacity=".5"') +
      critter(220, 262, 10) + critter(360, 270, 12) + critter(640, 266, 11) + critter(790, 258, 9) + critter(470, 300, 18) + critter(580, 318, 20) + fence + tube("M-20 298 H1040", "#70ebea", 1.5) +
      line(380, 330, 380, 140, STEEL, 5) + line(620, 330, 620, 140, STEEL, 5) + path("M376 140 H624 V182 L500 194 L376 182 Z", "#14081e") + tube("M376 140 H624 V182 L500 194 L376 182 Z", "#ff8ecb", 2, true) +
      neon(500, 172, "LUMI-SOFT", 22, "#ff8ecb", 'font-family="monospace" font-weight="bold" letter-spacing="4"') +
      vent(150, 430) + vent(850, 452) + reflect(500, 464, 160, "#ff8ecb", 40) +
      group((on ? marker(440, 456) : "") + cushion + hit(360, 380, 260, 100, "game:" + opts.games[0]), on ? 'class="lp-tw-on"' : "") + exitMat(opts.cursor === opts.games.length) +
      glow(circle(380, 140, 6, "#ffe6a8") + circle(620, 140, 6, "#ffe6a8") + circle(380, 140, 16, "#ffcf7a", 'opacity=".2"') + circle(620, 140, 16, "#ffcf7a", 'opacity=".2"')) + rain(29), 'data-town="field"');
  }

  function marketStreet(opts) { // Market Street: the same smoggy sky and wet road, the café and the Market, a holo fountain on the lane, bulbs strung overhead.
    const night = opts.night, picked = MARKET[opts.cursor] ? opts.cursor : null, back = opts.cursor === "street:high";
    let places = "";
    Object.keys(MARKET).forEach(function (id) {
      const at = MARKET[id], on = id === picked;
      places += group(BUILD[id](at[0], at[1], night) + hit(at[0] - 66, at[1] - 156, 132, 164, "place:" + id), 'data-place="' + id + '"' + (on ? ' class="lp-tw-on"' : ""));
    });
    let bunting = "";
    for (let i = 0; i < 14; i++) bunting += circle(302 + i * 30, 62 + Math.abs(7 - i) * 2, 3, NEON[i % NEON.length]); // Glowing bulbs along the string.
    const string = path("M290 58 Q500 82 710 58", "none", 'stroke="' + INK + '" stroke-width="1.4"');
    const fountain = oval(500, 456, 64, 16, "#0a1630") + tube("M436 456 a64 16 0 1 0 128 0 a64 16 0 1 0 -128 0", "#70ebea", 2) + rect(494, 414, 12, 40, STEEL) + oval(500, 414, 24, 7, STEEL) +
      glow(path("M500 414 Q486 392 474 412 M500 414 Q514 392 526 412 M500 412 V388", "none", 'stroke="' + (night ? "#c9a8ff" : "#70ebea") + '" stroke-width="2.5" opacity=".9"') + oval(500, 456, 50, 10, "#70ebea", 'opacity=".18"'));
    const cart = rect(330, 448, 60, 22, "#1c1430", 'rx="3"') + tube(box(330, 448, 60, 22), "#ff9d6b", 1) + circle(342, 474, 7, STEEL) + circle(378, 474, 7, STEEL) +
      glow([0, 1, 2, 3, 4].map(function (i) { return circle(338 + i * 11, 444, 5, NEON[(i + 1) % NEON.length]); }).join("")) + line(330, 448, 318, 432, STEEL, 3);
    const bench = rect(612, 452, 70, 6, STEEL, 'rx="2"') + rect(612, 440, 70, 5, STEEL, 'rx="2"') + tube("M612 458 H682", "#c9a8ff", 1) + rect(618, 460, 5, 14, "#1c1430") + rect(670, 460, 5, 14, "#1c1430");
    const overhead = wire(-20, 18, 1040, 26, 24, 14, 51) + wire(700, 60, 1040, 76, 16, 4, 52) +
      holo(30, 40, 170, 46, "#ff8ecb", "CAPSULE TOYS", 12, 24) + holo(806, 92, 160, 40, "#ffdc83", "FRESH ✦ HOT", 12, 0); // Wires and billboards above.
    const sides = vending(40, 232, "#ff8ecb") + shopfront(160, 228, 120, 96, "#ffdc83", "RAMEN") + tree(250, 236, 22, night) + tree(790, 230, 28, night) + shopfront(890, 236, 112, 90, "#c9a8ff", "TATTOO") + vending(966, 226, "#70ebea") +
      lamp(282, 244, night) + lamp(718, 244, night) + shopfront(120, 440, 124, 100, "#70ebea", "REPAIRS") + tree(226, 446, 26, night) + tree(790, 440, 30, night) + shopfront(900, 444, 120, 96, "#ff9d6b", "BAR") + lamp(718, 448, night) +
      vent(250, 274) + vent(760, 470) + vent(440, 382);
    const mark = picked ? marker(MARKET[picked][0], MARKET[picked][1] + 36) : "";
    const tag = picked && opts.label ? label(MARKET[picked][0], MARKET[picked][1] - 168, opts.label)
      : back && opts.label ? label(SIGNS.high[0] + 40, SIGNS.high[1] - 40, opts.label) : "";
    return group(sky(night, 140) + city(night, 61, 140) + overhead + ground(night) + shine(MARKET) + sides + string + glow(bunting) + fountain + cart + bench + signpost("high", "HIGH ST", back) + mark + places + rain(37) +
      (night ? rect(-20, -20, 1040, 540, "#0a0620", 'opacity=".14" pointer-events="none"') : "") + tag, 'data-town="market-street" data-time="' + (night ? "night" : "day") + '"');
  }

  function stall(x, id, on) { // One of the Market's stalls: a neon-striped awning, its counter rimmed in light, and what it sells on show.
    const colour = { store: "#ff8ecb", capsules: "#c9a8ff", seeds: "#8be9a8", garden: "#ffdc83" }[id] || "#ff9d6b";
    const name = { store: "STORE", capsules: "CAPSULES", seeds: "SEEDS", garden: "GARDEN" }[id] || "STALL";
    let stripes = "", goods = "";
    for (let i = 0; i < 6; i++) stripes += path("M" + (x - 42 + i * 14) + " 230 h14 l1 14 a7.5 7.5 0 0 1 -15 0 Z", i % 2 ? "#1a0f2e" : colour);
    if (id === "store") goods = [["🍪", -22, 300], ["🍌", 0, 300], ["🥛", 22, 300], ["🎾", -12, 332], ["🧸", 12, 332]].map(function (g) { return text(x + g[1], g[2], g[0], 16, "#ffffff"); }).join("");
    else if (id === "capsules") goods = [[-18, "#ff8ecb", "★"], [18, "#70ebea", "☾"]].map(function (m) { // Two capsule machines: a glass globe of capsules on a coin stand.
      return rect(x + m[0] - 14, 316, 28, 34, m[1], 'rx="4"') + circle(x + m[0], 300, 16, "#ffffff", 'opacity=".35" stroke="' + m[1] + '" stroke-width="2"') +
        circle(x + m[0] - 6, 302, 4, "#ffdc83") + circle(x + m[0] + 5, 296, 4, "#8be9a8") + circle(x + m[0] + 2, 306, 4, "#ff9d6b") + text(x + m[0], 338, m[2], 11, "#ffffff"); }).join("");
    else if (id === "seeds") goods = [-24, -8, 8, 24].map(function (dx, i) { return rect(x + dx - 6, 290, 12, 16, NEON[i], 'rx="1"') + circle(x + dx, 296, 3, "#ffffff", 'opacity=".8"'); }).join("") +
      [-16, 0, 16].map(function (dx, i) { return path("M" + (x + dx - 8) + " 326 h16 l-3 14 h-10 Z", "#5a3a4a") + line(x + dx, 326, x + dx, 316, "#3f8a4a", 2) + glow(circle(x + dx, 314, 4, NEON[(i + 3) % NEON.length])); }).join("");
    else goods = path("M" + (x - 30) + " 340 h22 l-4 -18 h-14 Z", "#3a2a4a") + circle(x - 19, 316, 9, "#2f8a5a") + // A planter, a little lantern and a birdbath.
      rect(x + 2, 300, 10, 16, STEEL, 'rx="2"') + glow(rect(x + 4, 304, 6, 8, "#ffdc83")) + rect(x + 6, 316, 2, 24, STEEL) +
      oval(x + 28, 320, 12, 4, "#70ebea", 'opacity=".7" stroke="' + STEEL + '" stroke-width="2"') + rect(x + 26, 322, 4, 18, STEEL);
    return group((on ? marker(x, 452) : "") + reflect(x, 382, 84, colour, 52) + rect(x - 40, 244, 4, 120, STEEL) + rect(x + 36, 244, 4, 120, STEEL) + stripes + tube("M" + (x - 42) + " 244 H" + (x + 42), colour, 1.2) +
      rect(x - 34, 210, 68, 18, "#07031a", 'rx="3"') + tube(box(x - 34, 210, 68, 18), colour, 1) + neon(x, 223, name, 9.5, colour, 'font-family="monospace" font-weight="bold" letter-spacing="1"') + goods +
      rect(x - 44, 350, 88, 30, "#1c1430", 'rx="3"') + tube("M" + (x - 44) + " 350 H" + (x + 44), colour, 1.4) + (on ? glow(rect(x - 44, 244, 88, 136, colour, 'opacity=".12"')) : "") +
      hit(x - 46, 206, 92, 250, "stall:" + id), on ? 'class="lp-tw-on"' : "");
  }

  function marketInside(opts) { // The Market under its roof: a night market of steel girders, cables and paper lanterns, a wet tiled floor and the stalls in a row.
    const night = opts.night;
    let beams = "", tiles = "", lanterns = "";
    for (let x = -20; x < 1040; x += 120) beams += rect(x, 0, 12, 360, "#1e1636") + rect(x + 5, 0, 2, 360, "#c9a8ff", 'opacity=".12"');
    for (let x = -20; x < 1040; x += 40) for (let y = 380; y < 520; y += 40) tiles += rect(x, y, 38, 38, (x + y) % 80 ? "#150e26" : "#1c1430");
    [180, 340, 500, 660, 820].forEach(function (x, i) { lanterns += line(x, 0, x, 70, INK, 1.5) + glow(oval(x, 84, 12, 16, NEON[i % NEON.length], 'opacity=".9"') + oval(x, 84, 22, 26, NEON[i % NEON.length], 'opacity=".15"')) + reflect(x, 400, 26, NEON[i % NEON.length], 60); });
    let stalls = "";
    const row = stations(opts.games.length);
    opts.games.forEach(function (id, i) { stalls += stall(row[i], id, opts.cursor === i); });
    return group(rect(-20, -20, 1040, 400, night ? "#0e0820" : "#160c2a") + beams + wire(-20, 30, 1040, 30, 16, 0) + lanterns + neon(500, 150, "✦ THE MARKET ✦", 24, "#ff8ecb", 'font-family="monospace" font-weight="bold" letter-spacing="7"') +
      holo(20, 170, 110, 36, "#ffdc83", "OPEN LATE", 10, 0) + holo(870, 170, 110, 36, "#70ebea", "NEW STOCK", 10, 0) +
      rect(-20, 376, 1040, 150, "#120b22") + tiles + rect(-20, 374, 1040, 2, "#ff8ecb", 'opacity=".6"') + rect(-20, 376, 1040, 5, "#ff8ecb", 'opacity=".1"') + stalls + exitMat(opts.cursor === opts.games.length) +
      (night ? rect(-20, -20, 1040, 540, "#0a0620", 'opacity=".18" pointer-events="none"') : ""), 'data-town="market"');
  }

  // ---- What game.js asks for ------------------------------------------------------------------------------
  function scene(opts) { // The picture for where she is. opts: at (a place she's inside, or null for the map), cursor (the map: a
    // place id; inside: the row number, one past the games for the exit), games (the slugs inside, in town-ui.js order), label, night.
    // street: which map ("high" or "market"); the map's cursor may also be "street:<where>", its signpost to the other street.
    const o = { at: opts.at || null, cursor: opts.cursor, games: opts.games || [], label: opts.label || "", night: Boolean(opts.night), street: opts.street || "high" };
    if (o.at === "market") return marketInside(o);
    if (!o.at && o.street === "market") return marketStreet(o);
    if (o.at === "arcade") return arcadeInside(o);
    if (o.at === "casino") return casinoInside(o);
    if (o.at === "field") return fieldInside(o);
    return townMap(o);
  }

  function spot(at, cursor, count) { // Where Lumi stands (the middle of her feet) for this cursor: by a place's door on the map, or in front of a station inside.
    if (!at && typeof cursor === "string" && cursor.indexOf("street:") === 0 && SIGNS[cursor.slice(7)]) { // Beside a street's signpost.
      const s = SIGNS[cursor.slice(7)];
      return { x: s[0] + (s[0] > 500 ? -26 : 26), y: s[1] + 14 };
    }
    if (!at) { const p = ALL[cursor] || MAP.tavern; return { x: p[0], y: p[1] + (p[1] > 300 ? 38 : 36) }; }
    if (cursor >= count) return { x: 500, y: 474 }; // On the exit mat.
    if (at === "field") return { x: 440, y: 452 }; // Beside the cushion.
    const row = stations(count);
    return { x: row[Math.min(cursor, row.length - 1)], y: 452 };
  }

  // The drawing kit, shared with Lumi City's pictures (city-art.js, town-inside.js: Doll's design, 2026-11-19), so the
  // city's streets, the apartment lobby and the real-estate office are drawn in the very same neon as the old town.
  const KIT = { rect: rect, circle: circle, oval: oval, path: path, line: line, text: text, group: group, glow: glow, esc: esc, dice: dice, r1: r1, hit: hit,
                marker: marker, pet: pet, petLine: petLine, tube: tube, box: box, neon: neon, reflect: reflect, wire: wire, holo: holo, vent: vent, sky: sky, city: city,
                tree: tree, lamp: lamp, vending: vending, shopfront: shopfront, label: label, exitMat: exitMat, NEON: NEON, HOT: HOT, INK: INK, STEEL: STEEL, SHINE: SHINE };

  return { MAP: MAP, MARKET: MARKET, SIGNS: SIGNS, STATIONS: STATIONS, SNUG: SNUG, stations: stations, scene: scene, spot: spot, BUILD: BUILD, KIT: KIT };
});
