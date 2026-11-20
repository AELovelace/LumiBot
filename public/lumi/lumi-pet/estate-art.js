/* Lumi City's houses and yards (2026-11-19): the town grows into a city seen from above at a tilt, cut into plots of
   land. A player buys a plot, picks one of 30 house styles for it, and dresses its 5 yard slots (a fence, a mailbox, a
   path, a lamp and an ornament). The shop list, prices and capsule odds live in lumipet_data/estate.json; this file
   only draws them, and STYLE_IDS / YARD_IDS below must match that file exactly (tests/js/lumi_estate.test.mjs checks).

   The look matches town-art.js: a neon cyberpunk town in permanent night, everything front-facing with its roof above,
   neon tubes along the edges, warm lit windows. "Day" is a brighter dusk and "night" the same colours about a quarter
   deeper, with a soft halo round every lit window. Drawn in world units:

     plot(box, opts)        one whole lot: the garden patch, its house, its five yard things, a FOR SALE board or the
                            owner's nameplate, and a soft ring at the doorstep when you're in reach of it.
     house(id, cx, base, n) just one house, centred on cx, standing on the line `base` (up to ~130 tall, ~170 wide).
     yardItem(slot, id, x, base, n)  just one yard thing (a fence is drawn as a 120-wide run centred on x; a path runs
                            from `base`, the doorstep, 42 units down towards the viewer).

   Plain SVG strings, no DOM, no filters (the TV boxes are slow), no ids, nothing pressable (the page adds its own hit
   boxes). The only words a person typed (the owner's name, the sale price) are escaped. The breathing lights reuse
   town-art's classes (lp-tw-glow, lp-tw-pet, lp-tw-steam) so game.css animates them the same way. */
(function (root, make) {
  const art = make();
  if (typeof module === "object" && module.exports) module.exports = art; else root.LumiPetEstateArt = art;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NEON = ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff", "#8be9a8", "#ff9d6b"]; // Lumi's own glow colours (the same as the town's).
  const HOT = "#ff2e97", INK = "#0b0618", STEEL = "#2a2440"; // Sign pink, shadow black, and the dark metal of poles.
  const GOLD = "#ffdc83", WOOD = "#7a4c2a"; // Gold trim, and plain brown wood for posts.
  const PATH_LEN = 42, PATH_W0 = 10, PATH_W1 = 15; // A path: 42 long from the doorstep, 10 half-wide at the door and 15 at the pavement (it widens as it comes nearer).

  // ---- Little drawing helpers (the same ones town-art.js uses, copied so this file stands alone) ------------
  function r1(n) { return Math.round(n * 10) / 10; } // One decimal place: short markup, no 0.30000000000000004.
  function num(v) { return typeof v === "number" ? r1(v) : v; } // Rounds numbers, leaves words alone.
  function d() { return Array.prototype.map.call(arguments, num).join(" "); } // Path data from pieces: d("M", x, y, "L", x2, y2) -> "M 10 20 L 30 40".
  function rect(x, y, w, h, fill, more) { return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + fill + '" ' + (more || "") + "/>"; } // A box.
  function circle(x, y, r, fill, more) { return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(r) + '" fill="' + fill + '" ' + (more || "") + "/>"; } // A dot or ball.
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + r1(x) + '" cy="' + r1(y) + '" rx="' + r1(rx) + '" ry="' + r1(ry) + '" fill="' + fill + '" ' + (more || "") + "/>"; } // A squashed circle.
  function path(dd, fill, more) { return '<path d="' + dd + '" fill="' + fill + '" ' + (more || "") + "/>"; } // Any shape.
  function line(x1, y1, x2, y2, stroke, width, more) { return '<line x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '" stroke="' + stroke + '" stroke-width="' + width + '" ' + (more || "") + "/>"; } // A straight stroke.
  function text(x, y, words, size, fill, more) { return '<text x="' + r1(x) + '" y="' + r1(y) + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + words + "</text>"; } // Centred words.
  function group(inner, more) { return "<g " + (more || "") + ">" + inner + "</g>"; } // Wraps pieces together.
  function glow(inner) { return group(inner, 'class="lp-tw-glow"'); } // A light that breathes (game.css), like the town's.
  function esc(words) { return String(words).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); } // Safe as SVG text.
  function dice(seed) { // A steady seeded roll, so the gravel and the stars land in the same places on every draw.
    let value = seed;
    return function (low, high) { value = (value * 16807) % 2147483647; return Math.round((low + (value / 2147483647) * (high - low)) * 10) / 10; };
  }
  function pet(more) { return 'class="lp-tw-pet" ' + (more || ""); } // A fill that takes Lumi's own glow colour (game.css), with the given fill as fallback.
  function petLine(more) { return 'class="lp-tw-pet-line" ' + (more || ""); } // The same for a stroke.
  function tube(dd, colour, width, lumi) { // A neon tube along a path: a wide faint halo under a thin bright core. lumi: take Lumi's glow.
    const cls = lumi ? petLine() : "", round = 'stroke-linecap="round" stroke-linejoin="round"';
    return path(dd, "none", cls + 'stroke="' + colour + '" stroke-width="' + r1(width * 3.5) + '" opacity=".22" ' + round) +
      path(dd, "none", cls + 'stroke="' + colour + '" stroke-width="' + width + '" ' + round);
  }
  function box(x, y, w, h) { return d("M", x, y, "h", w, "v", h, "h", -w, "Z"); } // A rectangle as a path, for tube() outlines.
  function neon(x, y, words, size, colour, more) { // Sign letters lit up: a fat soft copy under the crisp ones, breathing together.
    return glow(text(x, y, words, size, colour, 'opacity=".3" stroke="' + colour + '" stroke-width="' + r1(size / 3.5) + '" stroke-linejoin="round" ' + (more || "")) + text(x, y, words, size, colour, more));
  }
  function dk(hex, night) { // A colour as it looks after dark: the same hue, about a quarter deeper (by day it stays as given).
    if (!night) return hex;
    const v = parseInt(hex.slice(1), 16), ch = function (s) { return Math.round(((v >> s) & 255) * .72); }; // Each of red, green and blue, dimmed.
    return "#" + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1); // Back to #rrggbb.
  }
  function kit(cx, base, night) { // Everything a drawing needs: where it stands, whether it's night, its colour dimmer and its window light.
    return { x: cx, b: base, n: !!night, c: function (hex) { return dk(hex, night); }, lit: night ? "#ffb86a" : "#ffd98a" };
  }

  // ---- Shared house parts ---------------------------------------------------------------------------------
  function win(x, y, w, h, k, bars) { // A lit window: warm glass, a soft halo after dark, and its cross of glazing bars (bars false: plain).
    return (k.n ? glow(rect(x - 3, y - 3, w + 6, h + 6, "#ffb86a", 'rx="2" opacity=".22"')) : "") + rect(x, y, w, h, k.lit, 'rx="1"') +
      (bars === false ? "" : line(x + w / 2, y, x + w / 2, y + h, "#3a2a3a", 1.1) + line(x, y + h / 2, x + w, y + h / 2, "#3a2a3a", 1.1));
  }
  function roundWin(x, y, r, k, frame) { // A round porthole window, lit, with a frame ring and a cross.
    return (k.n ? glow(circle(x, y, r + 3, "#ffb86a", 'opacity=".22"')) : "") + circle(x, y, r, k.lit, 'stroke="' + (frame || "#3a2a3a") + '" stroke-width="1.6"') +
      line(x - r, y, x + r, y, frame || "#3a2a3a", 1) + line(x, y - r, x, y + r, frame || "#3a2a3a", 1);
  }
  function archWin(x, y, w, h, k) { // A tall window with a round top, lit, and one glazing bar down the middle.
    const dd = d("M", x, y + h, "V", y + w / 2, "A", w / 2, w / 2, 0, 0, 1, x + w, y + w / 2, "V", y + h, "Z");
    return (k.n ? glow(rect(x - 3, y - 2, w + 6, h + 5, "#ffb86a", 'rx="' + r1(w / 2) + '" opacity=".2"')) : "") + path(dd, k.lit, 'stroke="#3a2a3a" stroke-width="1.2"') + line(x + w / 2, y, x + w / 2, y + h, "#3a2a3a", 1);
  }
  function door(x, b, w, h, fill, arch) { // A front door standing on b: a plain slab or a round-topped one, a gold knob, and a dark step.
    const top = b - h, shape = arch ? path(d("M", x - w / 2, b, "V", top + w / 2, "A", w / 2, w / 2, 0, 0, 1, x + w / 2, top + w / 2, "V", b, "Z"), fill) : rect(x - w / 2, top, w, h, fill, 'rx="1.5"');
    return shape + circle(x + w / 2 - 3, b - h * .45, 1.4, GOLD) + rect(x - w / 2 - 3, b - 2, w + 6, 2.5, "#1a1424");
  }
  function smoke(x, y) { return group(oval(x, y, 6, 4, "#eadcff", 'opacity=".18"') + oval(x + 5, y - 9, 8, 5, "#eadcff", 'opacity=".1"'), 'class="lp-tw-steam"'); } // A chimney's puff, drifting (game.css).
  function flowerBox(x, y, w) { // A window box: a wooden trough with a row of little blooms.
    let blooms = "";
    for (let i = 0; i * 4 + 2 < w; i++) blooms += circle(x + 2 + i * 4, y - 1, 1.8, NEON[i % 6]);
    return rect(x, y, w, 4, "#5a3a2a") + blooms;
  }
  function star(x, y, r, fill, more) { // A five-pointed star centred on x, y.
    let dd = "";
    for (let i = 0; i < 10; i++) { const a = (-90 + i * 36) * Math.PI / 180, rr = i % 2 ? r * .45 : r; dd += (i ? " L " : "M ") + r1(x + rr * Math.cos(a)) + " " + r1(y + rr * Math.sin(a)); }
    return path(dd + " Z", fill, more);
  }
  function sparkle(x, y, r, fill) { return path(d("M", x, y - r, "Q", x, y, x + r, y, "Q", x, y, x, y + r, "Q", x, y, x - r, y, "Q", x, y, x, y - r, "Z"), fill); } // A four-pointed twinkle.
  function heartPath(x, y, s) { return d("M", x, y + s * .9, "C", x - s * 1.6, y - s * .1, x - s * .6, y - s * 1.2, x, y - s * .35, "C", x + s * .6, y - s * 1.2, x + s * 1.6, y - s * .1, x, y + s * .9, "Z"); } // A heart's outline, centred on x, y, about 2s across.
  function shard(x, b, w, h) { return d("M", x - w / 2, b, "L", x - w / 2, b - h + w * .7, "L", x, b - h, "L", x + w / 2, b - h + w * .7, "L", x + w / 2, b, "Z"); } // A crystal: straight sides up to a pointed top.
  function onion(x, y, hw, h) { return d("M", x - hw, y, "Q", x - hw * 1.35, y - h * .45, x, y - h, "Q", x + hw * 1.35, y - h * .45, x + hw, y, "Z"); } // An onion dome sitting on y, swelling out then drawn up to a point.
  function crescent(x, y, r) { return d("M", x, y - r, "A", r, r, 0, 1, 0, x, y + r, "A", r * .55, r, 0, 0, 1, x, y - r, "Z"); } // A crescent moon, open to the right.
  function spiral(x, y, rMax, turns) { // A spiral line from the middle outward, as a path.
    let dd = "M" + r1(x) + " " + r1(y);
    const steps = Math.round(turns * 24);
    for (let i = 1; i <= steps; i++) { const t = i / steps, a = t * turns * 2 * Math.PI, rr = rMax * t; dd += " L" + r1(x + rr * Math.cos(a)) + " " + r1(y + rr * Math.sin(a)); }
    return dd;
  }
  function shadow(x, b, w) { return oval(x, b, w, 5, INK, 'opacity=".38"'); } // The soft dark pool a thing stands in.

  // ---- The 30 houses: each draws itself centred on k.x, standing on k.b ---------------------------------------
  const HOUSES = {
    "starter-cottage": function (k) { // Starter Cottage: a small lilac cottage, its roofline lit in Lumi's glow, two warm windows with flower boxes and a chimney.
      const x = k.x, b = k.b, c = k.c;
      return rect(x + 18, b - 86, 9, 24, c("#5a4a6a")) + smoke(x + 22, b - 94) + // The chimney and its puff.
        path(d("M", x - 50, b - 50, "L", x, b - 90, "L", x + 50, b - 50, "Z"), c("#3b2a5a")) + tube(d("M", x - 50, b - 50, "L", x, b - 90, "L", x + 50, b - 50), "#ff8ecb", 2, true) + // The roof, its edge in Lumi's glow.
        roundWin(x, b - 66, 6, k) + rect(x - 42, b - 52, 84, 52, c("#7b6aa8")) + rect(x - 42, b - 52, 84, 4, c("#5d4d88")) + // A round attic light, the walls and their shadowed top.
        win(x - 34, b - 40, 16, 14, k) + win(x + 18, b - 40, 16, 14, k) + flowerBox(x - 35, b - 25, 18) + flowerBox(x + 17, b - 25, 18) + // Two windows over flower boxes.
        door(x, b, 16, 28, c("#3a2450")) + neon(x, b - 32, "♥", 7, "#ff8ecb"); // The door with a little neon heart over it.
    },
    "toadstool-hut": function (k) { // Toadstool Hut: a fat cream stalk with a round door, under a big spotty red cap with a glowing rim.
      const x = k.x, b = k.b, c = k.c;
      const spots = [[-36, -72, 9], [-6, -98, 11], [28, -80, 10], [48, -56, 6], [-50, -54, 6], [8, -66, 6]].map(function (s) { return oval(x + s[0], b + s[1], s[2], s[2] * .8, c("#fff4f0")); }).join(""); // White spots on the cap.
      return path(d("M", x - 26, b - 46, "Q", x - 34, b - 18, x - 32, b, "H", x + 32, "Q", x + 34, b - 18, x + 26, b - 46, "Z"), c("#efe2c8")) + // The stalk, wider at the foot.
        path(d("M", x - 64, b - 42, "Q", x - 62, b - 114, x, b - 116, "Q", x + 62, b - 114, x + 64, b - 42, "Q", x, b - 30, x - 64, b - 42, "Z"), c("#e0405a")) + spots + // The red cap.
        tube(d("M", x - 64, b - 42, "Q", x, b - 30, x + 64, b - 42), "#ff8ecb", 1.5) + // A pink glow along the cap's rim.
        roundWin(x - 18, b - 26, 5, k) + roundWin(x + 18, b - 26, 5, k) + door(x, b, 16, 24, c("#7a4a2a"), true) + // Two round windows and a round-topped door.
        rect(x - 22, b - 3, 44, 3, c("#8a7a5a"), 'rx="1.5"'); // A stepping stone.
    },
    "glow-igloo": function (k) { // Glow Igloo: an ice-block dome rimmed in cyan neon, a little tunnel porch, and warm light glowing out of the doorway.
      const x = k.x, b = k.b, c = k.c, R = 58;
      let blocks = "";
      [14, 28, 42].forEach(function (h, i) { // Each course of ice blocks: a seam across the dome, and joints staggered course by course.
        const hw = Math.sqrt(R * R - h * h);
        blocks += line(x - hw, b - h, x + hw, b - h, c("#8fbfd2"), 1.2);
        for (let j = -3; j <= 3; j++) { const jx = x + j * 18 + (i % 2) * 9; if (Math.abs(jx - x) < hw - 6) blocks += line(jx, b - h, jx, b - h + 14, c("#8fbfd2"), 1.2); }
      });
      return path(d("M", x - R, b, "A", R, R, 0, 0, 1, x + R, b, "Z"), c("#c4e8f4")) + blocks + // The dome and its blocks.
        tube(d("M", x - R, b, "A", R, R, 0, 0, 1, x + R, b), "#70ebea", 1.6) + // Its cyan neon rim.
        rect(x + 26, b - 40, 12, 10, k.lit, 'rx="2"') + (k.n ? glow(rect(x + 23, b - 43, 18, 16, "#ffb86a", 'rx="4" opacity=".2"')) : "") + // A small ice window, lit.
        path(d("M", x - 22, b, "V", b - 16, "A", 22, 22, 0, 0, 1, x + 22, b - 16, "V", b, "Z"), c("#dcf4fa")) + // The tunnel porch.
        glow(path(d("M", x - 12, b, "V", b - 12, "A", 12, 12, 0, 0, 1, x + 12, b - 12, "V", b, "Z"), k.lit)) + oval(x, b - 1, 18, 3, "#ffb86a", 'opacity=".25"'); // The glowing doorway and its light on the snow.
    },
    "log-cabin": function (k) { // Log Cabin: walls of stacked round logs with their ends showing, a mossy roof and a stone chimney puffing smoke.
      const x = k.x, b = k.b, c = k.c;
      let logs = "";
      for (let i = 0; i < 6; i++) { const y = b - 54 + i * 9; logs += rect(x - 54, y, 108, 9, c(i % 2 ? "#8a5a34" : "#7a4c2a"), 'rx="4.5"') + [x - 54, x + 54].map(function (ex) { return circle(ex, y + 4.5, 4.5, c("#c08a5a"), 'stroke="' + c("#6a3a1a") + '" stroke-width="1"'); }).join(""); } // Each log, its cut ends at the corners.
      return rect(x + 28, b - 96, 14, 40, c("#6b6470")) + [b - 90, b - 80, b - 70].map(function (y) { return line(x + 28, y, x + 42, y, c("#4a4450"), 1); }).join("") + smoke(x + 35, b - 102) + // The stone chimney.
        path(d("M", x - 66, b - 52, "L", x, b - 96, "L", x + 66, b - 52, "Z"), c("#3c4a32")) + [-30, -15, 0, 15, 30].map(function (dx) { return line(x + dx * 1.6, b - 52, x + dx * .3, b - 88, c("#2c3824"), 1); }).join("") + // The mossy roof and its shingle lines.
        tube(d("M", x - 66, b - 52, "L", x, b - 96, "L", x + 66, b - 52), "#ff9d6b", 1.4) + logs + // A warm orange trim, then the log walls.
        win(x - 42, b - 44, 18, 16, k) + win(x + 24, b - 44, 18, 16, k) + door(x, b, 18, 32, c("#4a2c18")) + // Two windows and a plank door.
        glow(circle(x + 14, b - 30, 2.5, "#ffb86a") + circle(x + 14, b - 30, 6, "#ffb86a", 'opacity=".2"')); // A porch lantern.
    },
    "pastel-bungalow": function (k) { // Pastel Bungalow: low and wide, mint walls under a candy-pink hip roof, three windows with lemon shutters and a white porch.
      const x = k.x, b = k.b, c = k.c;
      const shutterWin = function (wx) { return rect(wx - 5, b - 38, 4, 18, c("#ffe08a")) + rect(wx + 21, b - 38, 4, 18, c("#ffe08a")) + win(wx, b - 38, 20, 18, k); }; // A window with a shutter each side.
      return path(d("M", x - 80, b - 44, "L", x - 60, b - 72, "H", x + 60, "L", x + 80, b - 44, "Z"), c("#ff9ec4")) + tube(d("M", x - 60, b - 72, "H", x + 60), "#8be9a8", 1.6) + // The pink roof, its ridge lit mint.
        [-60, -40, -20, 0, 20, 40].map(function (dx) { return line(x + dx, b - 70, x + dx * 1.3, b - 46, c("#e07ea4"), 1); }).join("") + // Roof seams.
        rect(x - 70, b - 46, 140, 46, c("#a8e6cf")) + rect(x - 70, b - 46, 140, 3, c("#86c8ae")) + // The mint walls.
        shutterWin(x - 58) + shutterWin(x + 38) + win(x - 26, b - 36, 12, 14, k) + // Windows: two big with shutters, and a small one by the door.
        rect(x - 20, b - 44, 40, 4, c("#fff4fa")) + rect(x - 18, b - 40, 3, 40, c("#fff4fa")) + rect(x + 15, b - 40, 3, 40, c("#fff4fa")) + // The white porch: its little roof and two posts.
        door(x, b, 18, 30, c("#ffb38a")) + rect(x - 24, b - 4, 48, 4, c("#e8d8e8")); // The peach door and a porch step.
    },
    "a-frame-nook": function (k) { // A-Frame Nook: one steep shingled roof right down to the ground, its triangle front all glass and glowing, on a little deck.
      const x = k.x, b = k.b, c = k.c;
      let shingles = "";
      for (let y = b - 100; y < b; y += 10) { const hw = (b - y) / 118 * 60; shingles += line(x - hw, y, x + hw, y, c("#3a2418"), 1); } // Rows of shingles across the roof.
      return path(d("M", x - 62, b, "L", x, b - 120, "L", x + 62, b, "Z"), c("#5a3a2a")) + shingles + // The roof that's also the walls.
        (k.n ? glow(path(d("M", x - 40, b, "L", x, b - 86, "L", x + 40, b, "Z"), "#ffb86a", 'opacity=".25"')) : "") + path(d("M", x - 34, b, "L", x, b - 76, "L", x + 34, b, "Z"), k.lit) + // The glass front, glowing.
        line(x, b - 76, x, b - 30, "#3a2418", 1.4) + line(x - 20, b - 32, x + 20, b - 32, "#3a2418", 1.4) + line(x - 10, b - 54, x + 10, b - 54, "#3a2418", 1.4) + // Its window frames.
        rect(x - 8, b - 28, 16, 28, c("#2a1a14")) + circle(x + 5, b - 13, 1.3, GOLD) + // The door in the glass.
        tube(d("M", x - 62, b, "L", x, b - 120, "L", x + 62, b), "#ff9d6b", 1.8) + rect(x - 50, b - 4, 100, 4, c("#8a5a34")) + // Neon along the roof edges, and the deck.
        rect(x + 34, b - 16, 3, 12, c("#8a5a34")) + rect(x + 46, b - 16, 3, 12, c("#8a5a34")) + line(x + 34, b - 14, x + 50, b - 14, c("#8a5a34"), 2); // A bit of deck railing.
    },
    "gingerbread-house": function (k) { // Gingerbread House: a biscuit-brown house with white icing dripping off the roof, gumdrops, candy-cane door posts and peppermint windows.
      const x = k.x, b = k.b, c = k.c;
      let drips = "", drops = "";
      for (let i = 0; i <= 8; i++) { const t = i / 8; drips += circle(x - 58 + t * 58, b - 50 - t * 46 + 2, 2.6, "#fffaf4") + circle(x + 58 - t * 58, b - 50 - t * 46 + 2, 2.6, "#fffaf4"); } // Icing blobs along both roof edges.
      [[-30, -66], [-14, -78], [14, -78], [30, -66], [-40, -40], [40, -40]].forEach(function (g, i) { drops += circle(x + g[0], b + g[1], 3.4, NEON[i % 6]) + circle(x + g[0] - 1, b + g[1] - 1, 1, "#ffffff", 'opacity=".6"'); }); // Gumdrops stuck on.
      const mint = function (mx) { return circle(mx, b - 34, 8, "#fffaf4") + circle(mx, b - 34, 6, "none", 'stroke="#e0405a" stroke-width="4" stroke-dasharray="3.1 3.1"') + circle(mx, b - 34, 3, k.lit); }; // A peppermint window with a lit middle.
      const cane = function (cx) { return line(cx, b, cx, b - 30, "#fffaf4", 3) + line(cx, b, cx, b - 30, "#e0405a", 3, 'stroke-dasharray="3 3"'); }; // A candy-cane post.
      return rect(x - 46, b - 54, 92, 54, c("#b5713a")) + path(d("M", x - 46, b - 54, "Q", x - 40, b - 48, x - 34, b - 54, "Q", x - 28, b - 48, x - 22, b - 54, "Q", x - 16, b - 48, x - 10, b - 54, "Q", x - 4, b - 48, x + 2, b - 54, "Q", x + 8, b - 48, x + 14, b - 54, "Q", x + 20, b - 48, x + 26, b - 54, "Q", x + 32, b - 48, x + 38, b - 54, "Q", x + 42, b - 48, x + 46, b - 54, "Z"), "#fffaf4") + // The biscuit walls and their wavy icing.
        path(d("M", x - 60, b - 50, "L", x, b - 98, "L", x + 60, b - 50, "Z"), c("#8a4a22")) + drips + drops + // The roof, iced and studded.
        mint(x - 26) + mint(x + 26) + door(x, b, 16, 28, c("#e0405a"), true) + cane(x - 12) + cane(x + 12) + // Peppermint windows, a red door and its cane posts.
        tube(d("M", x - 60, b - 50, "L", x, b - 98, "L", x + 60, b - 50), "#ff8ecb", 1); // A thin pink glow round the roof.
    },
    "seashell-house": function (k) { // Seashell House: a big pink spiral shell with a glowing swirl, a pearl on top, porthole windows and an arched door.
      const x = k.x, b = k.b, c = k.c;
      let scallops = "";
      for (let i = 0; i < 9; i++) scallops += circle(x - 48 + i * 12, b - 2, 6, c("#e8a0b4")); // A scalloped foot of little shells.
      return circle(x, b - 52, 52, c("#f4b6c2"), 'stroke="' + c("#d88aa0") + '" stroke-width="2"') + // The shell.
        path(spiral(x + 4, b - 58, 44, 2.6), "none", 'stroke="' + c("#c96a82") + '" stroke-width="3" stroke-linecap="round"') + tube(spiral(x + 4, b - 58, 44, 2.6), "#ff8ecb", .8) + // Its swirl, glowing faintly.
        circle(x + 4, b - 108, 5, "#fff6fa") + circle(x + 2, b - 110, 1.6, "#ffffff") + scallops + // A pearl on top.
        roundWin(x - 28, b - 44, 6, k) + roundWin(x + 30, b - 62, 5, k) + door(x, b, 20, 30, c("#7a3a52"), true); // Portholes and the door.
    },
    "treehouse": function (k) { // Treehouse: a fat trunk, a leafy crown strung with fairy lights, and a little red-roofed hut on a platform with a ladder.
      const x = k.x, b = k.b, c = k.c;
      const leaf = function (cx, cy, r) { return circle(x + cx, b + cy, r, c("#2f6a3e")) + circle(x + cx - r * .3, b + cy - r * .3, r * .5, c("#3f8a4e"), 'opacity=".6"'); }; // A leaf cluster with a lighter top.
      let lights = "";
      for (let i = 0; i < 7; i++) lights += circle(x - 36 + i * 12, b - 58 + (i % 2) * 2, 1.8, NEON[i % 6]); // Fairy lights along the platform's edge.
      return leaf(-46, -88, 26) + leaf(46, -90, 26) + leaf(-20, -106, 26) + leaf(22, -108, 24) + // The crown behind.
        path(d("M", x - 14, b, "L", x - 8, b - 64, "H", x + 8, "L", x + 16, b, "Z"), c("#5a3a22")) + path(d("M", x - 14, b, "Q", x - 22, b - 2, x - 26, b, "M", x + 16, b, "Q", x + 24, b - 2, x + 28, b), "none", 'stroke="' + c("#5a3a22") + '" stroke-width="3"') + // The trunk and its roots.
        rect(x - 40, b - 64, 80, 6, c("#8a5a34")) + rect(x - 28, b - 96, 56, 32, c("#a0683a")) + // The platform and the hut's plank walls.
        [-18, -8, 2, 12].map(function (dx) { return line(x + dx, b - 96, x + dx, b - 64, c("#7a4c2a"), 1); }).join("") +
        path(d("M", x - 34, b - 94, "L", x, b - 122, "L", x + 34, b - 94, "Z"), c("#c84a3a")) + win(x + 6, b - 88, 12, 12, k) + door(x - 12, b - 64, 12, 20, c("#4a2c18")) + // Its red roof, window and door.
        glow(lights) + leaf(-50, -60, 12) + leaf(52, -62, 12) + // Lights, and a few leaves in front.
        [x + 26, x + 34].map(function (lx, i) { return line(lx, b - 60, lx + 4, b, c("#c8a070"), 2); }).join("") + [0, 1, 2, 3, 4].map(function (i) { return line(x + 26.6 + i * .66, b - 50 + i * 11, x + 34.6 + i * .66, b - 50 + i * 11, c("#c8a070"), 1.5); }).join(""); // The ladder.
    },
    "tea-house": function (k) { // Tea House: paper shoji screens glowing in a dark wood frame, raised on posts, under a curving roof with a red lantern.
      const x = k.x, b = k.b, c = k.c, paper = k.n ? "#ffd6a0" : "#fbefd0";
      let screens = "";
      [-50, -26, 4, 28].forEach(function (dx) { // Four sliding screens, the middle pair parted a little for the door.
        screens += rect(x + dx, b - 58, 22, 42, paper) + line(x + dx + 11, b - 58, x + dx + 11, b - 16, "#5a3a26", 1) + [b - 48, b - 37, b - 26].map(function (y) { return line(x + dx, y, x + dx + 22, y, "#5a3a26", 1); }).join("");
      });
      return rect(x - 62, b - 14, 124, 6, c("#5a3a26")) + [-56, -20, 20, 56].map(function (dx) { return rect(x + dx - 2, b - 8, 4, 8, c("#3a2418")); }).join("") + // The raised floor on posts.
        rect(x - 54, b - 62, 108, 48, c("#3a2418")) + (k.n ? glow(rect(x - 52, b - 60, 104, 46, "#ffb86a", 'opacity=".18"')) : "") + screens + rect(x - 4, b - 58, 8, 42, c("#1a0e08")) + // The frame, the glowing screens and the gap between the door pair.
        path(d("M", x - 80, b - 58, "Q", x - 62, b - 62, x - 50, b - 82, "H", x + 50, "Q", x + 62, b - 62, x + 80, b - 58, "Q", x, b - 68, x - 80, b - 58, "Z"), c("#2c3440")) + // The roof, its eaves curling up.
        path(d("M", x - 32, b - 82, "L", x, b - 100, "L", x + 32, b - 82, "Z"), c("#3a4450")) + rect(x - 46, b - 86, 92, 5, c("#1c222c")) + tube(d("M", x - 80, b - 58, "Q", x, b - 68, x + 80, b - 58), "#ff9d6b", 1.2) + // Its little gable, ridge beam and a warm glow along the eaves.
        rect(x - 14, b - 8, 28, 4, c("#6a6a70")) + line(x + 68, b - 62, x + 68, b - 54, INK, 1) + glow(oval(x + 68, b - 46, 6, 8, "#ff3d5a") + oval(x + 68, b - 46, 11, 13, "#ff3d5a", 'opacity=".2"')); // A stone step and a red lantern at the eave.
    },
    "neon-townhouse": function (k) { // Neon Townhouse: tall and thin, three storeys trimmed in pink and cyan tubes, a stoop with railings and a vertical HOME sign.
      const x = k.x, b = k.b, c = k.c;
      return rect(x - 36, b - 120, 72, 120, c("#4a3470")) + rect(x - 40, b - 126, 80, 7, c("#2a1e44")) + // The narrow brick-dark body and its cornice.
        win(x - 26, b - 112, 16, 24, k) + win(x + 10, b - 112, 16, 24, k) + win(x - 26, b - 74, 16, 24, k) + win(x + 10, b - 74, 16, 24, k) + // Two upper floors of windows.
        tube(d("M", x - 36, b - 120, "H", x + 36), HOT, 2) + tube(d("M", x - 36, b - 82, "H", x + 36), "#70ebea", 1.4) + tube(d("M", x - 36, b - 44, "H", x + 36), HOT, 1.4) + // A neon band at every floor.
        win(x + 6, b - 34, 22, 18, k) + door(x - 14, b - 8, 16, 30, c("#1e1432")) + rect(x - 26, b - 8, 26, 4, c("#6a6278")) + rect(x - 28, b - 4, 30, 4, c("#7a7288")) + // Ground floor: a window, the raised door and its stoop steps.
        line(x - 26, b - 8, x - 26, b - 22, c("#2a2440"), 1.4) + line(x - 2, b - 8, x - 2, b - 22, c("#2a2440"), 1.4) + // Stoop railings.
        rect(x + 36, b - 112, 12, 46, INK, 'rx="2"') + tube(box(x + 36, b - 112, 12, 46), "#70ebea", .8) + ["H", "O", "M", "E"].map(function (ch, i) { return neon(x + 42, b - 101 + i * 10.5, ch, 8, "#ff8ecb", 'font-family="monospace" font-weight="bold"'); }).join(""); // The hanging HOME sign.
    },
    "greenhouse-home": function (k) { // Greenhouse Home: a glass house on a brick footing, leafy plants and flowers inside, a glass roof and green neon edges.
      const x = k.x, b = k.b, c = k.c;
      const plants = [[-44, -22, 10], [-30, -32, 12], [30, -30, 13], [44, -20, 9], [-14, -18, 8], [16, -16, 7]].map(function (p, i) { return circle(x + p[0], b + p[1], p[2], c(i % 2 ? "#3f8a4e" : "#2f6a3e")) + circle(x + p[0] + 3, b + p[1] - 4, 2.4, NEON[i % 6]); }).join(""); // Plants, each with a bloom.
      let bars = "";
      for (let dx = -56; dx <= 56; dx += 16) bars += line(x + dx, b - 58, x + dx, b - 8, c("#dfe8ea"), 1.4); // The glass panes' mullions.
      for (let dx = -48; dx <= 48; dx += 16) bars += line(x + dx * 1.15, b - 56, x, b - 94, c("#dfe8ea"), 1); // The roof's rafters.
      return rect(x - 56, b - 58, 112, 50, c("#16302a")) + (k.n ? glow(rect(x - 56, b - 58, 112, 50, "#ffb86a", 'opacity=".16"')) : "") + plants + // Warm inside, full of plants.
        rect(x - 56, b - 58, 112, 50, "#8be9a8", 'opacity=".16"') + path(d("M", x - 64, b - 56, "L", x, b - 94, "L", x + 64, b - 56, "Z"), "#a8f0c8", 'opacity=".3"') + bars + // The glass walls and roof, faintly green.
        rect(x - 58, b - 58, 116, 3, c("#dfe8ea")) + tube(d("M", x - 64, b - 56, "L", x, b - 94, "L", x + 64, b - 56), "#8be9a8", 1.6) + // The eaves beam and green neon along the roof.
        rect(x - 60, b - 8, 120, 8, c("#8a4a3a")) + line(x - 60, b - 4, x + 60, b - 4, c("#6a3428"), 1) + rect(x - 10, b - 40, 20, 40, "#cff8e0", 'opacity=".35" stroke="#dfe8ea" stroke-width="1.6"') + circle(x + 6, b - 20, 1.3, GOLD); // The brick footing and a glass door.
    },
    "neon-diner": function (k) { // Neon Diner Home: a rounded chrome diner with a red stripe, a long lit window strip, and a big pink OPEN sign on the roof.
      const x = k.x, b = k.b, c = k.c;
      let mullions = "";
      for (let dx = -48; dx <= 48; dx += 16) mullions += line(x + dx, b - 50, x + dx, b - 32, "#5a5a6a", 1.4); // The window strip's frames.
      return line(x - 24, b - 58, x - 24, b - 70, STEEL, 2) + line(x + 24, b - 58, x + 24, b - 70, STEEL, 2) + rect(x - 36, b - 92, 72, 24, INK, 'rx="4"') + tube(box(x - 36, b - 92, 72, 24), HOT, 1.4) + // The roof sign's legs and board.
        neon(x - 6, b - 74, "OPEN", 14, HOT, 'font-family="monospace" font-weight="bold" letter-spacing="2"') + oval(x + 26, b - 84, 6, 3, "#ff9d6b") + rect(x + 20, b - 82, 12, 2, "#8be9a8") + oval(x + 26, b - 78, 6, 2.5, "#c88a4a") + // OPEN in neon, and a little neon burger.
        rect(x - 74, b - 58, 148, 52, c("#c8ccd8"), 'rx="16"') + rect(x - 74, b - 58, 148, 4, c("#eef0f8"), 'rx="2"') + // The chrome body.
        (k.n ? glow(rect(x - 67, b - 53, 134, 24, "#ffb86a", 'rx="8" opacity=".22"')) : "") + rect(x - 64, b - 50, 128, 18, k.lit, 'rx="7"') + mullions + // The lit window strip.
        rect(x - 74, b - 26, 148, 6, c("#e04a5a")) + line(x - 72, b - 18, x + 72, b - 18, c("#eef0f8"), 1.2) + tube(d("M", x - 66, b - 23, "H", x + 66), "#ff8ecb", .8) + // The red stripe, a chrome line and a pink glow.
        rect(x - 68, b - 6, 136, 6, c("#3a3a4a")) + door(x + 40, b, 16, 30, c("#2a3a5a")) + rect(x + 34, b - 26, 12, 6, k.lit); // The skirt and a door with a lit pane.
    },
    "stilt-houseboat": function (k) { // Stilt Houseboat: a blue boat hull perched high on wooden stilts, a cabin with portholes, a mast with a pink flag and a ladder down.
      const x = k.x, b = k.b, c = k.c;
      return [-50, -20, 20, 50].map(function (dx) { return rect(x + dx - 3, b - 42, 6, 42, c("#5a3a26")); }).join("") + line(x - 50, b - 4, x - 20, b - 34, c("#4a2e1e"), 2) + line(x + 20, b - 34, x + 50, b - 4, c("#4a2e1e"), 2) + // The stilts and cross braces.
        line(x + 34, b - 100, x + 34, b - 128, c("#d8d0c0"), 2) + path(d("M", x + 35, b - 128, "L", x + 52, b - 122, "L", x + 35, b - 116, "Z"), "#ff8ecb") + // The mast and its flag.
        rect(x - 40, b - 96, 80, 34, c("#f0e6d0")) + rect(x - 46, b - 102, 92, 7, c("#c84a3a"), 'rx="2"') + // The cabin and its red roof.
        roundWin(x - 26, b - 80, 5, k) + roundWin(x - 6, b - 80, 5, k) + door(x + 22, b - 62, 14, 26, c("#2e5a8a")) + // Portholes and the cabin door.
        path(d("M", x - 74, b - 64, "H", x + 74, "Q", x + 66, b - 42, x + 50, b - 40, "H", x - 50, "Q", x - 66, b - 42, x - 74, b - 64, "Z"), c("#2e6a9a")) + // The hull.
        line(x - 72, b - 58, x + 72, b - 58, c("#f0f4f8"), 2) + path(d("M", x - 62, b - 46, "H", x + 62), "none", 'stroke="' + c("#e04a5a") + '" stroke-width="2"') + tube(d("M", x - 74, b - 64, "H", x + 74), "#70ebea", 1.2) + // Its white and red lines and a cyan rail glow.
        circle(x - 48, b - 52, 5, "none", 'stroke="#f0f4f8" stroke-width="2.4"') + circle(x - 48, b - 52, 5, "none", 'stroke="#e04a5a" stroke-width="2.4" stroke-dasharray="3.9 3.9"') + // A lifebuoy.
        line(x + 58, b - 42, x + 64, b, c("#c8a070"), 2) + line(x + 66, b - 42, x + 72, b, c("#c8a070"), 2) + [0, 1, 2, 3].map(function (i) { return line(x + 59 + i * 1.4, b - 34 + i * 10, x + 67 + i * 1.4, b - 34 + i * 10, c("#c8a070"), 1.5); }).join(""); // The ladder.
    },
    "windmill": function (k) { // Windmill: a tapered cream tower with a dark cap, four lattice sails with a glowing hub, a round-topped door and a little window.
      const x = k.x, b = k.b, c = k.c, hy = b - 92;
      const sail = function (deg) { // One sail: a spar from the hub and a lattice panel along it, turned to its angle.
        return group(line(x, hy, x, hy - 40, c("#5a3a2a"), 2) + rect(x + 1, hy - 40, 11, 30, c("#e8dcc4"), 'opacity=".9" stroke="' + c("#5a3a2a") + '" stroke-width="1"') + line(x + 6.5, hy - 40, x + 6.5, hy - 10, c("#5a3a2a"), .8) + [hy - 32, hy - 24, hy - 16].map(function (y) { return line(x + 1, y, x + 12, y, c("#5a3a2a"), .8); }).join(""), 'transform="rotate(' + deg + " " + x + " " + r1(hy) + ')"');
      };
      return path(d("M", x - 34, b, "L", x - 22, b - 88, "H", x + 22, "L", x + 34, b, "Z"), c("#e8dcc4")) + [b - 20, b - 44, b - 68].map(function (y) { const hw = 34 - (b - y) / 88 * 12; return line(x - hw, y, x + hw, y, c("#c8b8a0"), 1); }).join("") + // The tower and its board lines.
        path(d("M", x - 28, b - 86, "Q", x, b - 120, x + 28, b - 86, "Z"), c("#6a3a4a")) + // The cap.
        win(x - 6, b - 50, 12, 14, k) + door(x, b, 18, 28, c("#5a3a2a"), true) + // A window (below the sails) and the door.
        sail(20) + sail(110) + sail(200) + sail(290) + circle(x, hy, 5, c("#3a2a2a")) + glow(circle(x, hy, 2.4, GOLD) + circle(x, hy, 6, GOLD, 'opacity=".25"')); // The four sails and the glowing hub.
    },
    "bubble-dome": function (k) { // Bubble Dome: a see-through geodesic dome over a cosy lit room, a round door and a shine on the glass.
      const x = k.x, b = k.b, c = k.c, R = 62;
      let net = "";
      const at = function (deg, r) { const a = deg * Math.PI / 180; return [x + r * Math.cos(a), b - r * Math.sin(a)]; }; // A point on the dome at that angle and distance from its centre.
      for (let i = 0; i < 6; i++) { // The geodesic frame: outer points joined to a middle ring, and the middle ring to the top.
        const p = at(i * 30, R), q = at(i * 30 + 30, R), m = at(i * 30 + 15, R * .62), m2 = at(i * 30 + 45, R * .62);
        net += line(p[0], p[1], m[0], m[1], "#70ebea", .8, 'opacity=".55"') + line(m[0], m[1], q[0], q[1], "#70ebea", .8, 'opacity=".55"') + (i < 5 ? line(m[0], m[1], m2[0], m2[1], "#70ebea", .8, 'opacity=".55"') : "") + line(m[0], m[1], x, b - R, "#70ebea", .6, 'opacity=".4"');
      }
      return rect(x - 52, b - 6, 104, 6, c("#2a2a3a")) + (k.n ? glow(oval(x, b - 22, 44, 22, "#ffb86a", 'opacity=".22"')) : "") + // The floor, and the room's warm glow.
        rect(x - 44, b - 20, 28, 12, c("#c96a9a"), 'rx="4"') + rect(x - 46, b - 26, 6, 18, c("#c96a9a"), 'rx="2"') + rect(x + 22, b - 40, 3, 32, STEEL) + circle(x + 23.5, b - 42, 6, k.lit) + circle(x + 38, b - 16, 8, c("#3f8a4e")) + rect(x + 34, b - 10, 8, 4, c("#8a4a3a")) + // A sofa, a standing lamp and a pot plant inside.
        path(d("M", x - R, b, "A", R, R, 0, 0, 1, x + R, b, "Z"), "#70ebea", 'opacity=".16"') + net + tube(d("M", x - R, b, "A", R, R, 0, 0, 1, x + R, b), "#70ebea", 1.4) + // The glass dome and its frame.
        path(d("M", x - 40, b - 36, "A", 46, 46, 0, 0, 1, x - 8, b - 58), "none", 'stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".45"') + // A shine on the glass.
        path(d("M", x - 14, b, "V", b - 14, "A", 14, 14, 0, 0, 1, x + 14, b - 14, "V", b, "Z"), c("#2a4a5a")) + tube(d("M", x - 14, b, "V", b - 14, "A", 14, 14, 0, 0, 1, x + 14, b - 14, "V", b), "#c9a8ff", 1.2) + circle(x + 9, b - 12, 1.3, GOLD); // The round door.
    },
    "cloud-house": function (k) { // Cloud House: a fluffy white cloud sitting on the grass, a sky-blue round-topped door, round windows and a little star above.
      const x = k.x, b = k.b, c = k.c;
      const puffs = [[-56, -16, 17], [58, -16, 17], [-42, -34, 28], [44, -34, 28], [-18, -60, 30], [22, -62, 28], [0, -84, 22]]; // The cloud's round puffs.
      return puffs.map(function (p) { return circle(x + p[0], b + p[1] + 2, p[2], c("#c8c4ec")); }).join("") + puffs.map(function (p) { return circle(x + p[0], b + p[1], p[2], c("#f2f2ff")); }).join("") + // A lavender shade under white puffs.
        rect(x - 60, b - 22, 120, 22, c("#e4e2fa"), 'rx="10"') + tube(d("M", x - 30, b - 88, "Q", x - 18, b - 102, x, b - 106, "Q", x + 22, b - 104, x + 34, b - 86), "#c9a8ff", 1) + // The flat bottom, and a soft violet glow over the top.
        roundWin(x - 30, b - 46, 7, k, "#8ab4ff") + roundWin(x + 32, b - 50, 7, k, "#8ab4ff") + door(x, b, 20, 32, c("#8ab4ff"), true) + // Windows and the door.
        glow(star(x + 40, b - 104, 7, GOLD) + circle(x + 40, b - 104, 11, GOLD, 'opacity=".2"')) + sparkle(x - 44, b - 82, 4, "#ffffff"); // A star and a twinkle.
    },
    "pagoda": function (k) { // Pagoda: three red tiers getting smaller, each under a dark curling roof with gold trim, and a gold spire on top.
      const x = k.x, b = k.b, c = k.c;
      const roof = function (y, half, rise) { // A tier's roof: tips curling up, a dipped underside, gold neon along its edge.
        const dd = d("M", x - half, y - 6, "Q", x - half * .75, y, x - half * .58, y - rise, "H", x + half * .58, "Q", x + half * .75, y, x + half, y - 6, "Q", x, y + 3, x - half, y - 6, "Z");
        return path(dd, c("#2a2a3a")) + tube(d("M", x - half, y - 6, "Q", x, y + 3, x + half, y - 6), GOLD, 1.1);
      };
      return rect(x - 44, b - 34, 88, 34, c("#a8302e")) + win(x - 36, b - 26, 14, 14, k) + win(x + 22, b - 26, 14, 14, k) + door(x, b, 18, 26, c("#3a1414")) + roof(b - 32, 72, 16) + // The ground tier.
        rect(x - 32, b - 66, 64, 22, c("#a8302e")) + win(x - 20, b - 62, 12, 12, k) + win(x + 8, b - 62, 12, 12, k) + roof(b - 62, 56, 14) + // The middle tier.
        rect(x - 22, b - 92, 44, 18, c("#a8302e")) + win(x - 6, b - 88, 12, 10, k) + roof(b - 88, 42, 14) + // The top tier.
        line(x, b - 102, x, b - 130, GOLD, 2) + [b - 108, b - 114, b - 120].map(function (y) { return circle(x, y, 2.6, GOLD); }).join("") + // The spire and its rings.
        [x - 66, x + 66].map(function (lx) { return glow(oval(lx, b - 30, 4, 5, "#ff3d5a") + oval(lx, b - 30, 8, 9, "#ff3d5a", 'opacity=".2"')); }).join(""); // Red lanterns at the lowest eaves.
    },
    "lighthouse": function (k) { // Lighthouse: a red-and-white striped tower, a lantern room throwing two pale beams, and a keeper's cottage at its foot.
      const x = k.x, b = k.b, c = k.c;
      const hw = function (y) { return 22 - (b - y) / 90 * 8; }; // The tower's half-width at height y (it narrows upward).
      const band = function (y1, y2) { return path(d("M", x - hw(y1), y1, "L", x - hw(y2), y2, "H", x + hw(y2), "L", x + hw(y1), y1, "Z"), c("#d8404a")); }; // A red stripe between two heights.
      return glow(path(d("M", x, b - 102, "L", x - 82, b - 120, "V", b - 88, "Z"), "#fff3b0", 'opacity=".2"') + path(d("M", x, b - 102, "L", x + 82, b - 118, "V", b - 90, "Z"), "#fff3b0", 'opacity=".2"')) + // The two beams.
        rect(x + 16, b - 32, 46, 32, c("#e8e0d0")) + path(d("M", x + 12, b - 30, "L", x + 39, b - 50, "L", x + 66, b - 30, "Z"), c("#3a4a6a")) + win(x + 40, b - 24, 12, 12, k) + // The keeper's cottage.
        path(d("M", x - 22, b, "L", x - 14, b - 90, "H", x + 14, "L", x + 22, b, "Z"), c("#f2f0ec")) + band(b - 22, b - 38) + band(b - 54, b - 70) + band(b - 84, b - 90) + // The striped tower.
        win(x - 4, b - 50, 8, 10, k, false) + door(x, b, 12, 20, c("#3a2a2a"), true) + // A window and the door.
        rect(x - 20, b - 94, 40, 4, STEEL) + [-16, -8, 0, 8, 16].map(function (dx) { return line(x + dx, b - 94, x + dx, b - 100, STEEL, 1); }).join("") + line(x - 18, b - 100, x + 18, b - 100, STEEL, 1) + // The gallery and its rail.
        glow(rect(x - 14, b - 113, 28, 20, "#fff3b0", 'opacity=".3"')) + rect(x - 11, b - 110, 22, 16, "#fff3b0") + line(x, b - 110, x, b - 94, STEEL, 1) + // The lantern room, blazing.
        path(d("M", x - 14, b - 110, "Q", x, b - 126, x + 14, b - 110, "Z"), c("#d8404a")) + circle(x, b - 124, 2.4, c("#d8404a")); // Its red cap.
    },
    "glass-cube": function (k) { // Glass Cube: a sleek cube seen from a corner, all tinted glass with a lit two-storey inside and cyan neon edges.
      const x = k.x, b = k.b, c = k.c;
      return rect(x - 52, b - 82, 90, 82, c("#10202c")) + (k.n ? glow(rect(x - 48, b - 78, 82, 74, "#ffb86a", 'opacity=".18"')) : "") + // The dark inside and its warm glow.
        rect(x - 46, b - 76, 36, 30, k.lit, 'opacity=".75"') + rect(x - 2, b - 76, 34, 30, k.lit, 'opacity=".55"') + rect(x - 46, b - 38, 30, 30, k.lit, 'opacity=".65"') + // Lit rooms behind the glass.
        rect(x - 40, b - 56, 14, 6, c("#5a4a8a"), 'rx="2"') + circle(x + 20, b - 52, 6, c("#3f8a4e")) + rect(x - 34, b - 60, 2, 10, STEEL) + // A sofa, a plant and a floor lamp upstairs.
        rect(x - 52, b - 42, 90, 3, c("#3a5a6a")) + rect(x - 52, b - 82, 90, 82, "#70ebea", 'opacity=".14"') + // The middle floor slab and the cyan glass front.
        path(d("M", x - 52, b - 82, "L", x - 32, b - 98, "H", x + 58, "L", x + 38, b - 82, "Z"), "#a8f4f4", 'opacity=".3"') + path(d("M", x + 38, b - 82, "L", x + 58, b - 98, "V", b - 16, "L", x + 38, b, "Z"), "#4ac4d4", 'opacity=".28"') + // The top and the side, at a tilt.
        rect(x - 4, b - 34, 22, 34, "#cff8f8", 'opacity=".3" stroke="#a8f4f4" stroke-width="1.2"') + // A glass door.
        tube(box(x - 52, b - 82, 90, 82), "#70ebea", 1.3) + tube(d("M", x - 52, b - 82, "L", x - 32, b - 98, "H", x + 58, "L", x + 38, b - 82, "M", x + 58, b - 98, "V", b - 16, "L", x + 38, b), "#70ebea", 1); // Cyan neon along every edge.
    },
    "sunset-villa": function (k) { // Sunset Villa: peach walls under a terracotta tile roof, arched windows, an arched door between potted plants, and a balcony.
      const x = k.x, b = k.b, c = k.c;
      let tiles = "";
      for (let dx = -72; dx <= 72; dx += 6) tiles += line(x + dx, b - 80, x + dx * .82, b - 98, c("#a8442a"), 1); // The roof's tile rows.
      const pot = function (px) { return path(d("M", px - 6, b - 12, "H", px + 6, "L", px + 4, b, "H", px - 4, "Z"), c("#c8603a")) + circle(px, b - 18, 8, c("#3f8a4e")) + circle(px - 3, b - 22, 2, "#ff8ecb"); }; // A potted plant with a bloom.
      return path(d("M", x - 82, b - 78, "L", x - 62, b - 98, "H", x + 62, "L", x + 82, b - 78, "Z"), c("#d0603a")) + tiles + tube(d("M", x - 82, b - 78, "H", x + 82), "#ff9d6b", 1.4) + // The terracotta roof and a sunset glow under it.
        rect(x - 70, b - 80, 140, 80, c("#f2c9a0")) + rect(x - 70, b - 80, 140, 4, c("#d8a880")) + // The peach walls.
        archWin(x - 58, b - 72, 16, 22, k) + archWin(x - 9, b - 74, 18, 28, k) + archWin(x + 42, b - 72, 16, 22, k) + // Upstairs: two windows and the balcony door.
        rect(x - 30, b - 46, 60, 4, c("#c8a080")) + [-26, -18, -10, -2, 6, 14, 22].map(function (dx) { return line(x + dx, b - 46, x + dx, b - 56, c("#5a3a2a"), 1.2); }).join("") + line(x - 30, b - 56, x + 30, b - 56, c("#5a3a2a"), 1.6) + // The balcony and its railing.
        archWin(x - 58, b - 36, 18, 26, k) + archWin(x + 40, b - 36, 18, 26, k) + door(x, b, 22, 34, c("#7a4a2a"), true) + pot(x - 22) + pot(x + 22); // Downstairs: windows, the door and two pots.
    },
    "arcade-loft": function (k) { // Arcade Loft: two game screens glowing on the ground floor, a big lit loft window above, and a green 1UP sign on the roof.
      const x = k.x, b = k.b, c = k.c;
      const screen = function (sx, colours) { // A window showing a little game, glowing.
        return rect(sx, b - 46, 32, 26, "#07031a", 'rx="3"') + glow(rect(sx, b - 46, 32, 26, "#70ebea", 'rx="3" opacity=".14"') + colours.map(function (col, i) { return rect(sx + 4 + i * 8, b - 40 + (i % 2) * 6, 6, 6, col); }).join("")) + tube(box(sx, b - 46, 32, 26), "#c9a8ff", 1);
      };
      return rect(x - 18, b - 112, 2, 8, STEEL) + rect(x + 16, b - 112, 2, 8, STEEL) + rect(x - 28, b - 128, 56, 18, INK, 'rx="3"') + tube(box(x - 28, b - 128, 56, 18), "#8be9a8", 1) + neon(x, b - 114, "1UP", 13, "#8be9a8", 'font-family="monospace" font-weight="bold" letter-spacing="2"') + // The roof sign.
        rect(x - 60, b - 104, 120, 104, c("#2a1a52")) + tube(d("M", x - 62, b - 104, "H", x + 62), "#70ebea", 2) + rect(x - 60, b - 56, 120, 5, c("#1a0e38")) + // The violet block, its roof trim and the floor between.
        (k.n ? glow(rect(x - 53, b - 99, 106, 38, "#ffb86a", 'opacity=".2"')) : "") + rect(x - 50, b - 96, 100, 32, k.lit) + [-25, 0, 25].map(function (dx) { return line(x + dx, b - 96, x + dx, b - 64, "#3a2a3a", 1.2); }).join("") + // The loft window.
        rect(x - 44, b - 76, 18, 12, c("#5a4a8a"), 'rx="3"') + circle(x + 36, b - 74, 7, c("#3f8a4e")) + // A sofa and a plant in the loft.
        screen(x - 54, ["#ff8ecb", "#ffdc83", "#70ebea"]) + screen(x + 22, ["#c9a8ff", "#8be9a8", "#ff9d6b"]) + // The two game screens.
        rect(x - 12, b - 44, 24, 44, HOT, 'rx="2" opacity="' + (k.n ? ".45" : ".35") + '"') + tube(box(x - 12, b - 44, 24, 44), "#ff8ecb", 1.2) + line(x, b - 44, x, b, "#ffe9f5", 1, 'opacity=".7"'); // A glowing glass door.
    },
    "observatory": function (k) { // Observatory: a pale stone drum under a big ribbed dome with its slit open and a telescope poking out at the stars.
      const x = k.x, b = k.b, c = k.c;
      let ribs = "";
      for (let a = 30; a <= 150; a += 30) { const r = a * Math.PI / 180; ribs += line(x + 54 * Math.cos(r) * .2, b - 56 - 54 * Math.sin(r) * .98, x + 54 * Math.cos(r), b - 56, c("#6a7490"), 1); } // The dome's ribs.
      return path(d("M", x - 56, b - 56, "A", 56, 56, 0, 0, 1, x + 56, b - 56, "Z"), c("#8a94b0")) + ribs + // The dome.
        path(d("M", x - 4, b - 112, "L", x + 10, b - 110, "L", x + 14, b - 58, "H", x, "Z"), INK) + // The open slit.
        group(rect(x + 4, b - 104, 46, 10, c("#e0e4f0"), 'rx="2"') + rect(x + 46, b - 106, 7, 14, c("#b0b8cc"), 'rx="1"'), 'transform="rotate(-36 ' + r1(x + 6) + " " + r1(b - 92) + ')"') + // The telescope poking out of it, tilted to the sky.
        tube(d("M", x - 56, b - 56, "A", 56, 56, 0, 0, 1, x + 56, b - 56), "#c9a8ff", 1.2) + // A violet glow round the dome.
        rect(x - 52, b - 58, 104, 58, c("#cfd4e0")) + [b - 44, b - 28, b - 12].map(function (y, i) { return line(x - 52, y, x + 52, y, c("#aab0c0"), 1) + line(x - 30 + i * 12, y, x - 30 + i * 12, y + 16, c("#aab0c0"), 1) + line(x + 20 + i * 8, y, x + 20 + i * 8, y + 16, c("#aab0c0"), 1); }).join("") + // The stone drum.
        roundWin(x - 34, b - 36, 7, k) + roundWin(x + 34, b - 36, 7, k) + door(x, b, 18, 30, c("#3a3a5a"), true) + // Windows and the door.
        glow(star(x - 46, b - 104, 4, GOLD) + star(x + 54, b - 126, 3.5, "#70ebea") + sparkle(x - 28, b - 124, 3, "#ffffff")); // Stars about.
    },
    "wizard-tower": function (k) { // Wizard Tower: a crooked stone tower in a starry pointy hat that bends at the tip, a crescent moon charm, glowing runes and round windows.
      const x = k.x, b = k.b, c = k.c;
      let stones = "";
      [[-18, -16], [6, -24], [-10, -48], [12, -58], [-16, -70], [4, -78]].forEach(function (s) { stones += rect(x + s[0], b + s[1], 12, 6, c("#5a5a7a"), 'rx="1"'); }); // A few stone blocks showing.
      return path(d("M", x - 28, b, "Q", x - 34, b - 40, x - 24, b - 84, "H", x + 22, "Q", x + 32, b - 40, x + 28, b, "Z"), c("#76769a")) + stones + // The crooked tower.
        oval(x, b - 84, 36, 6, c("#22226a")) + path(d("M", x - 28, b - 86, "H", x + 28, "Q", x + 10, b - 108, x + 26, b - 130, "Q", x - 8, b - 114, x - 28, b - 86, "Z"), c("#2e2e8a")) + // The hat's brim and its bent cone.
        path(d("M", x - 26, b - 88, "H", x + 26), "none", 'stroke="' + GOLD + '" stroke-width="3"') + glow(star(x - 6, b - 100, 3.4, GOLD) + star(x + 8, b - 110, 2.6, GOLD)) + // A gold band and stars on the hat.
        line(x + 26, b - 130, x + 26, b - 120, "#c9a8ff", 1) + glow(path(crescent(x + 26, b - 114, 5), GOLD)) + // A crescent moon dangling from the tip.
        roundWin(x + 2, b - 62, 7, k, "#3a3a5a") + archWin(x - 12, b - 44, 10, 16, k) + door(x, b, 18, 26, c("#3a2a4a"), true) + // Windows and the door.
        glow([[-16, -14], [16, -18], [-18, -30], [18, -32]].map(function (r) { return text(x + r[0], b + r[1], "✦", 6, "#c9a8ff"); }).join("")); // Glowing runes round the door.
    },
    "castle-turret": function (k) { // Castle Turret: a grey stone keep with battlements and banners, an arched portcullis door, and a round turret with a pointed roof and flag.
      const x = k.x, b = k.b, c = k.c;
      let teeth = "", blocks = "";
      for (let i = 0; i < 6; i++) teeth += rect(x - 52 + i * 15, b - 82, 9, 12, c("#8a8a9a")); // The battlements.
      [[-46, -60], [-20, -50], [8, -62], [-36, -30], [14, -36], [-4, -20]].forEach(function (s) { blocks += rect(x + s[0], b + s[1], 14, 7, "none", 'stroke="' + c("#6a6a7a") + '" stroke-width="1"'); }); // Stone block outlines.
      const banner = function (bx) { return path(d("M", bx - 6, b - 66, "H", bx + 6, "V", b - 46, "L", bx, b - 50, "L", bx - 6, b - 46, "Z"), "#c84a8a") + tube(d("M", bx - 6, b - 66, "H", bx + 6), "#ff8ecb", .8) + star(bx, b - 58, 3, GOLD); }; // A hanging banner with a star.
      return rect(x - 52, b - 72, 90, 72, c("#8a8a9a")) + teeth + blocks + banner(x - 34) + banner(x + 20) + // The keep.
        door(x - 7, b, 24, 36, c("#4a3020"), true) + [-14, -9, -4, 1].map(function (dx) { return line(x + dx, b - 30, x + dx, b - 2, c("#2a2a34"), 1.2); }).join("") + line(x - 18, b - 18, x + 4, b - 18, c("#2a2a34"), 1.2) + // The arched door and its portcullis.
        rect(x + 30, b - 98, 34, 98, c("#9a9aaa")) + path(d("M", x + 26, b - 98, "L", x + 47, b - 124, "L", x + 68, b - 98, "Z"), c("#4a3a8a")) + tube(d("M", x + 26, b - 98, "L", x + 47, b - 124, "L", x + 68, b - 98), "#c9a8ff", 1.2) + // The turret and its pointed roof.
        line(x + 47, b - 124, x + 47, b - 136, c("#d8d0c0"), 1.5) + path(d("M", x + 47.5, b - 136, "L", x + 60, b - 132, "L", x + 47.5, b - 128, "Z"), "#ff8ecb") + // The flag.
        win(x - 40, b - 56, 6, 16, k, false) + win(x + 44, b - 78, 6, 16, k, false) + win(x + 44, b - 46, 6, 16, k, false); // Arrow-slit windows, lit.
    },
    "rocket-home": function (k) { // Rocket Home: a white rocket parked upright on its red fins, a red nose cone, lit portholes and a door with steps down.
      const x = k.x, b = k.b, c = k.c;
      return oval(x, b - 2, 32, 4, "#ff9d6b", 'opacity=".25"') + // A faint warm glow underneath, from the parked engines.
        path(d("M", x - 22, b - 44, "L", x - 46, b, "L", x - 22, b - 8, "Z"), c("#e04a5a")) + path(d("M", x + 22, b - 44, "L", x + 46, b, "L", x + 22, b - 8, "Z"), c("#e04a5a")) + // Two side fins.
        path(d("M", x - 22, b - 8, "V", b - 82, "Q", x - 22, b - 112, x, b - 128, "Q", x + 22, b - 112, x + 22, b - 82, "V", b - 8, "Z"), c("#ececf4")) + // The body.
        path(d("M", x - 18, b - 102, "Q", x - 12, b - 118, x, b - 128, "Q", x + 12, b - 118, x + 18, b - 102, "Z"), c("#e04a5a")) + rect(x - 22, b - 34, 44, 5, c("#e04a5a")) + // The nose cone and a red band.
        tube(d("M", x - 22, b - 82, "V", b - 8, "M", x + 22, b - 82, "V", b - 8), "#70ebea", .8) + // Cyan glow down its sides.
        roundWin(x, b - 84, 8, k, "#8a94b0") + roundWin(x, b - 60, 5.5, k, "#8a94b0") + // Portholes.
        door(x, b - 10, 14, 22, c("#5a6a8a"), true) + rect(x - 8, b - 10, 16, 3, c("#8a8a9a")) + rect(x - 9, b - 6, 18, 3, c("#8a8a9a")) + rect(x - 10, b - 3, 20, 3, c("#8a8a9a")); // The door and its steps.
    },
    "crystal-spire": function (k) { // Crystal Spire: a cluster of glowing violet, pink and blue crystals, the tallest in the middle with a door in its foot and diamond windows.
      const x = k.x, b = k.b, c = k.c;
      const piece = function (dx, w, h, fill, edge) { // One crystal: its body, a lighter facet down one side, and a neon edge.
        return path(shard(x + dx, b, w, h), c(fill), 'opacity=".95"') + path(d("M", x + dx, b - h, "L", x + dx + w / 2, b - h + w * .7, "V", b, "H", x + dx, "Z"), "#ffffff", 'opacity=".14"') + tube(shard(x + dx, b, w, h), edge, .9);
      };
      return glow(oval(x, b - 4, 70, 9, "#c9a8ff", 'opacity=".22"')) + // The glow they cast on the ground.
        piece(-48, 22, 58, "#6a3ab8", "#c9a8ff") + piece(48, 22, 64, "#2a6ab8", "#70ebea") + piece(-26, 30, 92, "#9a3aa8", "#ff8ecb") + piece(26, 30, 100, "#3a4ac8", "#70ebea") + piece(0, 42, 128, "#7a4ac8", "#c9a8ff") + // Back to front, smallest to tallest.
        [[-26, -62], [26, -70], [0, -84]].map(function (p) { return path(d("M", x + p[0], b + p[1] - 6, "L", x + p[0] + 5, b + p[1], "L", x + p[0], b + p[1] + 6, "L", x + p[0] - 5, b + p[1], "Z"), k.lit) + (k.n ? glow(circle(x + p[0], b + p[1], 9, "#ffb86a", 'opacity=".2"')) : ""); }).join("") + // Diamond windows.
        door(x, b, 16, 28, c("#2a1050"), true) + glow(path(d("M", x - 5, b, "V", b - 18, "A", 5, 5, 0, 0, 1, x + 5, b - 18, "V", b, "Z"), "#c9a8ff", 'opacity=".4"')); // The door, glowing from inside.
    },
    "fairy-palace": function (k) { // Fairy Palace: a pink palace with two side towers under golden onion domes, a big central dome, fairy-wing windows and sparkles.
      const x = k.x, b = k.b, c = k.c;
      const wings = function (wx) { // A pair of fairy-wing windows: two tilted lit ovals meeting in the middle.
        return (k.n ? glow(oval(wx, b - 40, 16, 12, "#ffb86a", 'opacity=".2"')) : "") + oval(wx - 6, b - 42, 7, 11, k.lit, 'transform="rotate(-30 ' + r1(wx - 6) + " " + r1(b - 42) + ')" stroke="#c070a0" stroke-width="1.2"') + oval(wx + 6, b - 42, 7, 11, k.lit, 'transform="rotate(30 ' + r1(wx + 6) + " " + r1(b - 42) + ')" stroke="#c070a0" stroke-width="1.2"') + circle(wx, b - 40, 2, "#c070a0");
      };
      const tower = function (tx) { // A side tower with an onion dome, a spire and a little window.
        return rect(tx - 14, b - 84, 28, 84, c("#e4b0e0")) + path(onion(tx, b - 84, 16, 30), c("#ffd27a")) + tube(onion(tx, b - 84, 16, 30), GOLD, .8) + line(tx, b - 114, tx, b - 122, GOLD, 1.5) + glow(star(tx, b - 124, 3.2, GOLD)) + archWin(tx - 5, b - 70, 10, 16, k);
      };
      return tower(x - 66) + tower(x + 66) + rect(x - 54, b - 66, 108, 66, c("#f4c8e8")) + rect(x - 54, b - 66, 108, 4, c("#e0a8d4")) + // The towers and the main hall.
        path(onion(x, b - 66, 26, 48), c("#e8b4f4")) + tube(onion(x, b - 66, 26, 48), "#ff8ecb", 1.2) + line(x, b - 114, x, b - 120, GOLD, 1.5) + glow(star(x, b - 124, 5, GOLD)) + // The central dome, crowned with a star.
        wings(x - 34) + wings(x + 34) + door(x, b, 22, 38, c("#a070c0"), true) + tube(d("M", x - 11, b, "V", b - 27, "A", 11, 11, 0, 0, 1, x + 11, b - 27, "V", b), "#ffe9f5", 1) + // Wing windows and the arched door.
        glow(sparkle(x - 44, b - 92, 3.5, "#ffffff") + sparkle(x + 40, b - 98, 3, "#ffe9f5") + sparkle(x + 22, b - 20, 2.5, "#ffffff") + sparkle(x - 22, b - 16, 2.5, "#ffffff")); // Sparkles.
    },
    "starlight-manor": function (k) { // Starlight Manor: a grand navy manor with two wings, a white-columned porch, a mansard roof with dormers, and a big gold star on top.
      const x = k.x, b = k.b, c = k.c;
      const rowWins = function (xs, y, w, h) { return xs.map(function (wx) { return win(wx, y, w, h, k); }).join(""); }; // A row of windows.
      return rect(x - 84, b - 54, 40, 54, c("#3a3a6a")) + rect(x + 44, b - 54, 40, 54, c("#3a3a6a")) + rect(x - 86, b - 58, 44, 4, c("#e8e4f0")) + rect(x + 42, b - 58, 44, 4, c("#e8e4f0")) + // The two wings and their white cornices.
        rowWins([x - 78, x - 60], b - 46, 12, 16, k) + rowWins([x + 48, x + 66], b - 46, 12, 16) + rowWins([x - 78, x - 60, x + 48, x + 66], b - 24, 12, 16) + // Wing windows.
        path(d("M", x - 50, b - 86, "L", x - 40, b - 106, "H", x + 40, "L", x + 50, b - 86, "Z"), c("#22224a")) + win(x - 24, b - 102, 10, 10, k) + win(x + 14, b - 102, 10, 10, k) + // The mansard roof and its dormers.
        tube(d("M", x - 50, b - 86, "L", x - 40, b - 106, "H", x + 40, "L", x + 50, b - 86), GOLD, 1.2) + rect(x - 46, b - 88, 92, 88, c("#46467a")) + // A gold edge, then the main block.
        rowWins([x - 38, x - 18, x + 6, x + 26], b - 80, 12, 18) + rowWins([x - 38, x + 26], b - 46, 12, 18) + // Its windows.
        path(d("M", x - 26, b - 50, "L", x, b - 64, "L", x + 26, b - 50, "Z"), c("#f0eef8")) + [-20, -9, 7, 18].map(function (dx) { return rect(x + dx, b - 50, 3, 50, c("#f0eef8")); }).join("") + // The porch pediment and its columns.
        door(x, b, 14, 30, c("#2a1a3a"), true) + glow(star(x, b - 122, 14, GOLD) + star(x, b - 122, 20, GOLD, 'opacity=".2"')) + line(x, b - 106, x, b - 110, GOLD, 2) + // The door and the great star.
        glow(sparkle(x - 30, b - 120, 3, "#ffffff") + sparkle(x + 32, b - 116, 2.6, "#ffffff")); // Twinkles round the star.
    },
    "neon-penthouse": function (k) { // Neon Sky Penthouse: a dark tower with every floor lit a different neon colour, a glass penthouse on top, an antenna and a holo SKY sign.
      const x = k.x, b = k.b, c = k.c;
      let floors = "";
      for (let i = 0; i < 5; i++) { // Five floors, each banded and lit in its own neon colour.
        const y = b - 104 + i * 20, col = NEON[i];
        floors += [-28, -14, 0, 14].map(function (dx) { return rect(x + dx + 2, y + 4, 10, 10, col, 'opacity="' + (k.n ? ".85" : ".7") + '"'); }).join("") + tube(d("M", x - 36, y + 18, "H", x + 36), col, 1.2);
      }
      return line(x + 16, b - 124, x + 16, b - 136, STEEL, 1.5) + glow(circle(x + 16, b - 137, 2, "#ff3d6e")) + // The antenna and its blinking light.
        rect(x - 26, b - 124, 52, 18, c("#2a2050")) + rect(x - 22, b - 121, 44, 12, k.lit, 'opacity=".8"') + tube(box(x - 26, b - 124, 52, 18), HOT, 1.2) + // The glass penthouse.
        rect(x - 36, b - 106, 72, 106, c("#1a1430")) + floors + tube(d("M", x - 36, b - 106, "V", b, "M", x + 36, b - 106, "V", b), "#c9a8ff", 1) + // The tower and its floors.
        rect(x + 40, b - 92, 18, 46, "#70ebea", 'opacity=".12"') + glow(["S", "K", "Y"].map(function (ch, i) { return text(x + 49, b - 76 + i * 13, ch, 11, "#70ebea", 'font-family="monospace" font-weight="bold"'); }).join("")) + path(d("M", x + 37, b - 40, "L", x + 40, b - 46, "H", x + 58, "L", x + 61, b - 40, "Z"), "#70ebea", 'opacity=".25"') + // The holo sign and its projector beam.
        rect(x - 10, b - 22, 20, 22, "#ffe9f5", 'opacity=".3"') + tube(box(x - 10, b - 22, 20, 22), HOT, 1) + rect(x - 16, b - 26, 32, 4, HOT, 'opacity=".8"'); // A glass door under a pink awning.
    }
  };

  // ---- Fences: each draws a run from a to z along the ground line y ---------------------------------------
  function spots(a, z, step) { // Evenly spaced x positions from a to z (both ends), about `step` apart.
    const n = Math.max(1, Math.round((z - a) / step)), out = [];
    for (let i = 0; i <= n; i++) out.push(a + i * (z - a) / n);
    return out;
  }
  function wave(a, z, y, amp, len, phase) { // A wavy line from a to z about y: a sine of height amp and wavelength len, as path data.
    let dd = "M" + r1(a) + " " + r1(y + amp * Math.sin(phase));
    for (let px = a + 3; px <= z; px += 3) dd += " L" + r1(px) + " " + r1(y + amp * Math.sin(phase + (px - a) / len * 2 * Math.PI));
    return dd;
  }
  const FENCES = {
    "fence-picket": function (a, z, y, k) { // White Pickets: pointed white slats on two rails.
      const white = k.c("#f4f0f6");
      return rect(a, y - 12, z - a, 2.5, white) + rect(a, y - 6, z - a, 2.5, white) + spots(a, z, 6).map(function (px) { return path(d("M", px - 2, y, "V", y - 14, "L", px, y - 17, "L", px + 2, y - 14, "V", y, "Z"), white); }).join("");
    },
    "fence-rope": function (a, z, y, k) { // Rope and Posts: stout wooden posts with two sagging ropes.
      const xs = spots(a, z, 26), rope = k.c("#d8c08a");
      let ropes = "";
      for (let i = 0; i < xs.length - 1; i++) { const m = (xs[i] + xs[i + 1]) / 2; ropes += path(d("M", xs[i], y - 13, "Q", m, y - 5, xs[i + 1], y - 13, "M", xs[i], y - 7, "Q", m, y - 1, xs[i + 1], y - 7), "none", 'stroke="' + rope + '" stroke-width="1.5"'); } // Each pair of ropes between two posts.
      return ropes + xs.map(function (px) { return rect(px - 2, y - 16, 4, 16, k.c("#8a5a34")) + circle(px, y - 16, 2.4, k.c("#a87a4a")); }).join("");
    },
    "fence-bamboo": function (a, z, y, k) { // Bamboo Fence: tall green canes close together, with nodes, tied by a band.
      let canes = "";
      spots(a, z, 4).forEach(function (px, i) { const top = y - 20 + (i % 3); canes += rect(px - 1.6, top, 3.2, y - top, k.c(i % 2 ? "#7ab85a" : "#8ac86a"), 'rx="1"') + line(px - 1.6, y - 9, px + 1.6, y - 9, k.c("#4a8a3a"), .8); }); // Each cane and its node.
      return canes + rect(a, y - 14, z - a, 2, k.c("#c8a060"));
    },
    "fence-hedge": function (a, z, y, k) { // Hedge Row: a trimmed green wall with a bumpy top and lighter leaves.
      const roll = dice(Math.round(a) + 7);
      let leaves = "";
      for (let px = a + 4; px < z - 2; px += 7) leaves += circle(px, y - 15, 5, k.c("#2f6a3e")) + circle(px + roll(-2, 2), y - 8 + roll(-3, 3), 1.4, k.c("#5aa05a")); // The bumps and a light leaf on each.
      return rect(a, y - 15, z - a, 15, k.c("#2a5e38"), 'rx="3"') + leaves;
    },
    "fence-iron": function (a, z, y, k) { // Iron Railings: thin black bars with gold spear tips, two rails, and stout posts with gold balls.
      const xs = spots(a, z, 6);
      return line(a, y - 4, z, y - 4, "#4e4866", 1.6) + line(a, y - 14, z, y - 14, "#4e4866", 1.6) + xs.map(function (px) { return line(px, y, px, y - 17, "#4e4866", 1.4) + path(d("M", px - 1.6, y - 17, "L", px, y - 21, "L", px + 1.6, y - 17, "Z"), "#d8b04a"); }).join("") +
        [a, z].map(function (px) { return rect(px - 2.5, y - 20, 5, 20, "#4e4866") + circle(px, y - 21, 2.4, GOLD); }).join("");
    },
    "fence-pastel": function (a, z, y, k) { // Pastel Pickets: round-topped slats, each a different sweet colour.
      return rect(a, y - 11, z - a, 2, k.c("#fff0f6")) + rect(a, y - 5, z - a, 2, k.c("#fff0f6")) + spots(a, z, 6).map(function (px, i) { return rect(px - 2, y - 16, 4, 16, k.c(NEON[i % 6]), 'rx="2"'); }).join("");
    },
    "fence-candy-cane": function (a, z, y, k) { // Candy Cane Fence: red-and-white striped canes hooked at the top, on a green ribbon.
      return line(a, y - 8, z, y - 8, k.c("#3a9a5a"), 2) + spots(a, z, 10).map(function (px) { const dd = d("M", px, y, "V", y - 14, "Q", px, y - 19, px + 3.5, y - 19, "Q", px + 7, y - 19, px + 7, y - 15); return path(dd, "none", 'stroke="#fff6f8" stroke-width="2.6" stroke-linecap="round"') + path(dd, "none", 'stroke="#e0304a" stroke-width="2.6" stroke-dasharray="2.4 2.4"'); }).join("");
    },
    "fence-twig": function (a, z, y, k) { // Twiggy Fence: thin stakes with twigs woven in and out between them.
      const brown = k.c("#8a6a3a");
      return spots(a, z, 14).map(function (px) { return line(px, y, px, y - 16, k.c("#6a4a2a"), 2); }).join("") +
        [4, 9, 14].map(function (h, i) { return path(wave(a, z, y - h, 1.6, 14, i * Math.PI), "none", 'stroke="' + brown + '" stroke-width="1.6"'); }).join("");
    },
    "fence-heart": function (a, z, y, k) { // Heart Railings: two pink rails with little hearts set between the posts.
      const xs = spots(a, z, 20);
      let hearts = "";
      for (let i = 0; i < xs.length - 1; i++) hearts += path(heartPath((xs[i] + xs[i + 1]) / 2, y - 10, 3.6), "#ff8ecb"); // A heart in every gap.
      return line(a, y - 3, z, y - 3, k.c("#d86aa0"), 1.6) + line(a, y - 16, z, y - 16, k.c("#d86aa0"), 1.6) + hearts + xs.map(function (px) { return rect(px - 1.5, y - 18, 3, 18, k.c("#d86aa0")) + circle(px, y - 18.5, 2, "#ffb8dc"); }).join("");
    },
    "fence-cloud": function (a, z, y, k) { // Cloud Puffs: posts made of little white clouds, joined by a soft lavender band.
      return line(a, y - 8, z, y - 8, "#c9a8ff", 3, 'opacity=".55" stroke-linecap="round"') + spots(a, z, 18).map(function (px) { return circle(px - 4, y - 6, 5, k.c("#f2f2ff")) + circle(px + 4, y - 6, 5, k.c("#f2f2ff")) + circle(px, y - 12, 6, k.c("#ffffff")); }).join("");
    },
    "fence-flower": function (a, z, y, k) { // Flower Trellis: a green criss-cross lattice with blooms climbing over it.
      let lattice = "", blooms = "";
      for (let px = a; px + 12 <= z; px += 8) lattice += line(px, y, px + 12, y - 16, k.c("#5aa05a"), 1.2) + line(px + 12, y, px, y - 16, k.c("#5aa05a"), 1.2); // The diagonal slats.
      for (let px = a + 6, i = 0; px < z; px += 11, i++) blooms += circle(px, y - 8 - (i % 2) * 6, 2.6, NEON[(i * 2) % 6]) + circle(px, y - 8 - (i % 2) * 6, 1, "#ffdc83"); // Blooms with sunny middles.
      return lattice + line(a, y - 16, z, y - 16, k.c("#5aa05a"), 1.6) + blooms;
    },
    "fence-neon": function (a, z, y, k) { // Neon Tube Fence: posts of hot-pink tube and two buzzing cyan rails.
      return glow(tube(d("M", a, y - 5, "H", z, "M", a, y - 13, "H", z), "#70ebea", 1.4) + tube(spots(a, z, 16).map(function (px) { return d("M", px, y, "V", y - 17); }).join(" "), HOT, 1.8));
    },
    "fence-crystal": function (a, z, y, k) { // Crystal Shards: a row of glowing cyan and violet crystal points.
      return glow(rect(a, y - 3, z - a, 4, "#70ebea", 'opacity=".15"')) + spots(a, z, 9).map(function (px, i) { const h = 12 + (i * 7) % 9; return path(shard(px, y, 6, h), i % 2 ? "#c9a8ff" : "#8ae6f0", 'opacity=".9" stroke="#ffffff" stroke-width=".6"') + path(d("M", px, y - h, "L", px + 3, y - h + 4.2, "V", y, "H", px, "Z"), "#ffffff", 'opacity=".25"'); }).join("");
    },
    "fence-starry": function (a, z, y, k) { // Starry Night Fence: night-sky panels full of stars, framed in gold, with gold posts.
      const xs = spots(a, z, 22), roll = dice(Math.round(a) + 11);
      let panels = "";
      for (let i = 0; i < xs.length - 1; i++) { // Each panel and its stars.
        const w = xs[i + 1] - xs[i] - 2;
        panels += rect(xs[i] + 1, y - 17, w, 15, "#140c34") + glow(star(xs[i] + 1 + w * .5, y - 10, 3.4, GOLD) + circle(xs[i] + 1 + roll(2, w * .3), y - 14 + roll(0, 3), .8, "#ffffff") + circle(xs[i] + 1 + roll(w * .7, w - 2), y - 6 - roll(0, 4), .8, "#ffffff"));
      }
      return panels + tube(d("M", a, y - 17, "H", z, "M", a, y - 2, "H", z), GOLD, .9) + xs.map(function (px) { return rect(px - 1.5, y - 19, 3, 19, GOLD) + glow(star(px, y - 21, 2.4, GOLD)); }).join("");
    },
    "fence-aurora": function (a, z, y, k) { // Aurora Ribbon: three ribbons of northern lights waving between glowing pearl posts, with twinkles.
      const roll = dice(Math.round(a) + 5);
      let twinkles = "";
      for (let i = 0; i < 5; i++) twinkles += sparkle(roll(a + 4, z - 4), y - roll(16, 24), 2.4, "#ffffff"); // Twinkles above the ribbons.
      return glow(tube(wave(a, z, y - 8, 3, 34, 0), "#8be9a8", 1.6) + tube(wave(a, z, y - 11, 3, 34, 1.2), "#70ebea", 1.4) + tube(wave(a, z, y - 14, 3, 34, 2.4), "#c9a8ff", 1.4) + twinkles) +
        spots(a, z, 30).map(function (px) { return rect(px - 1.5, y - 20, 3, 20, "#f4f0ff") + glow(circle(px, y - 21, 3, "#ffffff") + circle(px, y - 21, 6, "#c9a8ff", 'opacity=".3"')); }).join("");
    }
  };

  // ---- Mailboxes: each stands on the ground at x, base b ---------------------------------------------------
  function post(x, b, h, fill) { return rect(x - 1.6, b - h, 3.2, h, fill || WOOD); } // A plain post.
  const MAILBOXES = {
    "mailbox-classic": function (x, b, k) { // Post Box: a grey round-topped box on a wooden post, its red flag up.
      return post(x, b, 20, k.c(WOOD)) + path(d("M", x - 8, b - 20, "V", b - 28, "A", 8, 6, 0, 0, 1, x + 8, b - 28, "V", b - 20, "Z"), k.c("#9aa4b4")) + line(x - 5, b - 24, x + 5, b - 24, k.c("#5a6474"), 1) + rect(x + 8, b - 32, 2, 10, "#e0304a") + rect(x + 8, b - 32, 6, 4, "#e0304a");
    },
    "mailbox-pillar": function (x, b, k) { // Red Pillar Box: a round red pillar with a domed top, a gold band and a dark slot.
      return rect(x - 8, b - 3, 16, 3, k.c("#4a1a1a")) + rect(x - 7, b - 30, 14, 28, k.c("#d02a30"), 'rx="2"') + oval(x, b - 30, 8, 4, k.c("#e0383e")) + rect(x - 8, b - 26, 16, 2, GOLD) + rect(x - 4, b - 22, 8, 2, INK) + rect(x - 4, b - 15, 8, 6, "#fff4e0", 'opacity=".8"');
    },
    "mailbox-birdhouse": function (x, b, k) { // Birdhouse Box: a little wooden house on a post with a round hole, and a bluebird on its roof.
      return post(x, b, 20, k.c(WOOD)) + rect(x - 8, b - 34, 16, 14, k.c("#c08a5a")) + path(d("M", x - 10, b - 33, "L", x, b - 41, "L", x + 10, b - 33, "Z"), k.c("#8a3a2a")) + circle(x, b - 28, 2.6, INK) + line(x - 2, b - 24, x + 2, b - 24, k.c("#6a3a1a"), 1.2) +
        oval(x + 4, b - 41, 3.4, 2.4, "#6ab0ff") + circle(x + 6.5, b - 43, 1.8, "#6ab0ff") + path(d("M", x + 8, b - 43, "l", 2, .6, "l", -2, .6, "Z"), GOLD);
    },
    "mailbox-brass": function (x, b, k) { // Brass Letterbox: a polished gold box with a shine, on a curly black iron post.
      return rect(x - 1.5, b - 22, 3, 22, "#4e4866") + path(d("M", x, b - 10, "q", -6, -2, -5, -7, "M", x, b - 10, "q", 6, -2, 5, -7), "none", 'stroke="#4e4866" stroke-width="1.3"') + rect(x - 9, b - 34, 18, 12, k.c("#d8a840"), 'rx="2"') + rect(x - 6, b - 31, 12, 2, "#5a4010") + rect(x - 7, b - 33, 3, 9, "#ffffff", 'opacity=".45"') + line(x - 7, b - 26, x + 7, b - 26, "#a87a20", .8);
    },
    "mailbox-robot": function (x, b, k) { // Robo Mailbox: a steel box with a robot face, glowing eyes, a smile, little arms and an antenna.
      return post(x, b, 18, STEEL) + rect(x - 9, b - 34, 18, 16, k.c("#8a94a8"), 'rx="3"') + glow(circle(x - 4, b - 28, 2, "#70ebea") + circle(x + 4, b - 28, 2, "#70ebea")) + path(d("M", x - 4, b - 23, "Q", x, b - 20, x + 4, b - 23), "none", 'stroke="#4e4866" stroke-width="1"') +
        line(x, b - 34, x, b - 39, STEEL, 1) + glow(circle(x, b - 40, 1.8, "#ff3d6e")) + line(x - 9, b - 24, x - 13, b - 20, k.c("#8a94a8"), 1.6) + line(x + 9, b - 24, x + 13, b - 28, k.c("#8a94a8"), 1.6);
    },
    "mailbox-frog": function (x, b, k) { // Froggy Mailbox: a green frog's head on a post, big eyes on top and the post slot in its wide mouth.
      return post(x, b, 20, k.c(WOOD)) + oval(x, b - 27, 10, 8, k.c("#5ab84a")) + circle(x - 5, b - 34, 3.4, k.c("#5ab84a")) + circle(x + 5, b - 34, 3.4, k.c("#5ab84a")) + circle(x - 5, b - 34.5, 2, "#ffffff") + circle(x + 5, b - 34.5, 2, "#ffffff") + circle(x - 5, b - 34.5, 1, INK) + circle(x + 5, b - 34.5, 1, INK) +
        path(d("M", x - 7, b - 26, "Q", x, b - 22, x + 7, b - 26), "none", 'stroke="#1a3a1a" stroke-width="1.6"') + circle(x - 7, b - 29, 1.4, "#ff8ecb", 'opacity=".7"') + circle(x + 7, b - 29, 1.4, "#ff8ecb", 'opacity=".7"');
    },
    "mailbox-cat": function (x, b, k) { // Kitty Mailbox: an orange box with cat ears, a face, whiskers and a slot for a mouth.
      return post(x, b, 20, k.c(WOOD)) + path(d("M", x - 9, b - 30, "L", x - 8, b - 38, "L", x - 3, b - 33, "Z", "M", x + 9, b - 30, "L", x + 8, b - 38, "L", x + 3, b - 33, "Z"), k.c("#f0a050")) + rect(x - 9, b - 34, 18, 14, k.c("#f0a050"), 'rx="4"') +
        circle(x - 4, b - 29, 1.4, INK) + circle(x + 4, b - 29, 1.4, INK) + path(d("M", x - 1, b - 26.5, "L", x + 1, b - 26.5, "L", x, b - 25.3, "Z"), "#ff8ecb") + line(x - 4, b - 23, x + 4, b - 23, INK, 1.2) + line(x - 6, b - 26, x - 12, b - 27, "#ffffff", .6) + line(x + 6, b - 26, x + 12, b - 27, "#ffffff", .6) + line(x - 6, b - 25, x - 12, b - 24, "#ffffff", .6) + line(x + 6, b - 25, x + 12, b - 24, "#ffffff", .6);
    },
    "mailbox-toadstool": function (x, b, k) { // Toadstool Box: a cream stalk with the slot in it, under a red cap with white spots.
      return rect(x - 5, b - 22, 10, 22, k.c("#efe2c8"), 'rx="3"') + rect(x - 3, b - 16, 6, 1.6, INK) + path(d("M", x - 12, b - 21, "Q", x - 12, b - 36, x, b - 36, "Q", x + 12, b - 36, x + 12, b - 21, "Z"), k.c("#e0405a")) + circle(x - 5, b - 28, 2, "#fff4f0") + circle(x + 4, b - 31, 2.4, "#fff4f0") + circle(x + 8, b - 24, 1.4, "#fff4f0");
    },
    "mailbox-cupcake": function (x, b, k) { // Cupcake Box: a ridged pink cup, a swirl of frosting on top and a cherry.
      return post(x, b, 16, k.c(WOOD)) + path(d("M", x - 9, b - 28, "H", x + 9, "L", x + 7, b - 16, "H", x - 7, "Z"), k.c("#ff8ecb")) + [-5, -1.6, 1.6, 5].map(function (dx) { return line(x + dx, b - 28, x + dx * .8, b - 16, k.c("#d86aa0"), .8); }).join("") +
        oval(x, b - 29, 10, 4, k.c("#fff4fa")) + oval(x, b - 32, 7, 3.4, k.c("#fff4fa")) + oval(x, b - 35, 4, 2.6, k.c("#fff4fa")) + circle(x, b - 39, 2.2, "#e0304a") + rect(x - 3, b - 25, 6, 1.4, INK);
    },
    "mailbox-whale": function (x, b, k) { // Little Whale: a blue whale on a post with a tail, a happy eye, a spout of water and the slot in its mouth.
      return post(x, b, 18, k.c(WOOD)) + path(d("M", x + 8, b - 26, "L", x + 15, b - 32, "L", x + 14, b - 24, "L", x + 16, b - 18, "Z"), k.c("#4a8ad8")) + oval(x, b - 25, 11, 7, k.c("#5a9ae8")) + oval(x - 1, b - 22, 8, 3, k.c("#bfe0ff")) + circle(x - 5, b - 27, 1.2, INK) + line(x - 10, b - 23, x - 4, b - 23, INK, 1) +
        glow(path(d("M", x - 2, b - 32, "Q", x - 4, b - 38, x - 8, b - 38, "M", x - 2, b - 32, "Q", x, b - 39, x + 4, b - 39), "none", 'stroke="#a8e8ff" stroke-width="1.4" stroke-linecap="round"'));
    },
    "mailbox-teapot": function (x, b, k) { // Teapot Post: a mint teapot on a post, its spout and handle, and the slot in its lid.
      return post(x, b, 18, k.c(WOOD)) + path(d("M", x - 9, b - 26, "Q", x - 15, b - 28, x - 16, b - 34), "none", 'stroke="' + k.c("#8ad0c8") + '" stroke-width="2.6" stroke-linecap="round"') + path(d("M", x + 8, b - 30, "Q", x + 15, b - 28, x + 8, b - 21), "none", 'stroke="' + k.c("#8ad0c8") + '" stroke-width="2"') +
        oval(x, b - 25, 10, 8, k.c("#8ad0c8")) + rect(x - 5, b - 34, 10, 3, k.c("#6ab0a8"), 'rx="1.5"') + circle(x, b - 35.5, 1.6, k.c("#6ab0a8")) + rect(x - 3, b - 32.6, 6, 1, INK) + circle(x - 4, b - 24, 1.4, "#ff8ecb") + circle(x + 3, b - 26, 1.4, "#ff8ecb");
    },
    "mailbox-neon": function (x, b, k) { // Neon Drop Box: a dark box outlined in buzzing pink tube, a glowing cyan slot and a little neon envelope.
      return post(x, b, 18, STEEL) + rect(x - 9, b - 34, 18, 16, "#120a22", 'rx="2"') + tube(box(x - 9, b - 34, 18, 16), HOT, 1) + glow(rect(x - 5, b - 30, 10, 1.8, "#70ebea") + path(d("M", x - 4, b - 26, "h", 8, "v", 5, "h", -8, "Z", "M", x - 4, b - 26, "l", 4, 3, "l", 4, -3), "none", 'stroke="#ffdc83" stroke-width=".8"'));
    },
    "mailbox-owl": function (x, b, k) { // Owl Courier: a brown owl perched on a post, ear tufts, big golden eyes and a letter slot in its belly.
      return post(x, b, 16, k.c(WOOD)) + line(x - 8, b - 16, x + 8, b - 16, k.c("#5a3a22"), 2) + oval(x, b - 26, 8, 11, k.c("#8a5a3a")) + oval(x, b - 23, 5, 6, k.c("#d8b890")) + path(d("M", x - 7, b - 34, "L", x - 6, b - 39, "L", x - 3, b - 35, "Z", "M", x + 7, b - 34, "L", x + 6, b - 39, "L", x + 3, b - 35, "Z"), k.c("#8a5a3a")) +
        circle(x - 3.2, b - 31, 3, GOLD) + circle(x + 3.2, b - 31, 3, GOLD) + circle(x - 3.2, b - 31, 1.4, INK) + circle(x + 3.2, b - 31, 1.4, INK) + path(d("M", x - 1, b - 28.5, "L", x + 1, b - 28.5, "L", x, b - 26.5, "Z"), "#ff9d6b") + rect(x - 2.5, b - 22, 5, 1.2, INK);
    },
    "mailbox-rocket": function (x, b, k) { // Rocket Post: a little white rocket lying on a post, red nose and fins, a lit porthole and a flame glowing out the back.
      return post(x, b, 18, STEEL) + glow(path(d("M", x - 11, b - 27, "L", x - 19, b - 25, "L", x - 11, b - 22, "Z"), "#ff9d6b") + oval(x - 15, b - 24.5, 6, 3, "#ffdc83", 'opacity=".4"')) + path(d("M", x - 10, b - 30, "L", x - 14, b - 34, "L", x - 6, b - 30, "Z", "M", x - 10, b - 19, "L", x - 14, b - 15, "L", x - 6, b - 19, "Z"), "#e0304a") +
        path(d("M", x - 11, b - 30, "H", x + 6, "Q", x + 14, b - 28, x + 15, b - 24.5, "Q", x + 14, b - 21, x + 6, b - 19, "H", x - 11, "Z"), k.c("#ececf4")) + path(d("M", x + 8, b - 29.5, "Q", x + 14, b - 28, x + 15, b - 24.5, "Q", x + 14, b - 21, x + 8, b - 19.5, "Z"), "#e0304a") + circle(x, b - 24.5, 2.6, k.lit, 'stroke="#8a94b0" stroke-width="1"') + rect(x - 8, b - 21, 6, 1, INK);
    },
    "mailbox-star-portal": function (x, b, k) { // Star Portal Post: a gold post holding a ring of stars round a swirl of night sky, a glowing letter floating through it.
      let ring = "";
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ring += star(x + 12 * Math.cos(a), b - 32 + 12 * Math.sin(a), 2.4, NEON[i % 6]); } // Eight little stars round the ring.
      return rect(x - 1.6, b - 20, 3.2, 20, GOLD) + rect(x - 5, b - 2, 10, 2, GOLD) + circle(x, b - 32, 11, "#160a3a") + glow(circle(x, b - 32, 11, "none", 'stroke="#c9a8ff" stroke-width="4" opacity=".3"') + path(spiral(x, b - 32, 9, 1.6), "none", 'stroke="#c9a8ff" stroke-width=".8" opacity=".7"') + ring) +
        glow(rect(x - 4.5, b - 35, 9, 6, "#fff8e0") + path(d("M", x - 4.5, b - 35, "L", x, b - 31.5, "L", x + 4.5, b - 35), "none", 'stroke="#c9a8ff" stroke-width=".8"') + circle(x, b - 32, 7, "#fff8e0", 'opacity=".18"')) + sparkle(x + 15, b - 45, 2.6, "#ffffff") + sparkle(x - 14, b - 44, 2, "#ffffff");
    }
  };

  // ---- Paths: each runs from the doorstep (x, top) PATH_LEN units down towards the viewer --------------------
  function trap(x, t) { return d("M", x - PATH_W0, t, "H", x + PATH_W0, "L", x + PATH_W1, t + PATH_LEN, "H", x - PATH_W1, "Z"); } // The path's outline: narrow at the door, wider at the pavement.
  function hwAt(t, y) { return PATH_W0 + (y - t) / PATH_LEN * (PATH_W1 - PATH_W0); } // The path's half-width at height y.
  function along(x, t, n, fn) { // Walks the path in n steps from the door down, calling fn(y, halfWidth, i) at the middle of each.
    let out = "";
    for (let i = 0; i < n; i++) { const y = t + (i + .5) / n * PATH_LEN; out += fn(y, hwAt(t, y), i); }
    return out;
  }
  function scatter(x, t, seed, count, fn) { // Sprinkles count things over the path at steady random places: fn(px, py, i, roll).
    const roll = dice(seed);
    let out = "";
    for (let i = 0; i < count; i++) { const py = t + roll(1, PATH_LEN - 1), hw = hwAt(t, py) - 1.5; out += fn(x + roll(-hw, hw), py, i, roll); }
    return out;
  }
  const PATHS = {
    "path-gravel": function (x, t, k) { // Gravel Path: grey crunchy gravel, speckled light and dark.
      return path(trap(x, t), k.c("#8a8a94")) + scatter(x, t, 31, 44, function (px, py, i, roll) { return circle(px, py, roll(.6, 1.3), k.c(i % 2 ? "#b8b8c2" : "#62626e")); });
    },
    "path-stepping": function (x, t, k) { // Stepping Stones: four flat grey stones on the grass, zig-zagging to the door.
      return along(x, t, 4, function (y, hw, i) { const sx = x + (i % 2 ? 3 : -3); return oval(sx, y + 1.4, hw * .82, 3.6, k.c("#4a4a56")) + oval(sx, y, hw * .82, 3.6, k.c("#a8a8b8")); });
    },
    "path-brick": function (x, t, k) { // Brick Path: warm red bricks in rows, their joints staggered.
      let joints = "";
      for (let i = 1; i < 7; i++) { const y = t + i * 6, hw = hwAt(t, y); joints += line(x - hw, y, x + hw, y, k.c("#6a2e22"), 1); for (let j = -2; j <= 2; j++) { const jx = x + j * 8 + (i % 2) * 4; if (Math.abs(jx - x) < hw - 1) joints += line(jx, y, jx, y + 6, k.c("#6a2e22"), 1); } }
      return path(trap(x, t), k.c("#b0583e")) + joints;
    },
    "path-boardwalk": function (x, t, k) { // Boardwalk: wooden planks across two dark side beams, a nail at each end.
      let planks = "";
      for (let y = t + 4.5; y < t + PATH_LEN; y += 4.5) { const hw = hwAt(t, y); planks += line(x - hw, y, x + hw, y, k.c("#5a3a1e"), .9) + circle(x - hw + 2, y - 2.2, .5, "#2a1a10") + circle(x + hw - 2, y - 2.2, .5, "#2a1a10"); } // Each plank's seam and nails.
      return path(trap(x, t), k.c("#a8743e")) + planks + path(d("M", x - PATH_W0, t, "L", x - PATH_W1, t + PATH_LEN, "M", x + PATH_W0, t, "L", x + PATH_W1, t + PATH_LEN), "none", 'stroke="' + k.c("#5a3a1e") + '" stroke-width="2"');
    },
    "path-cobble": function (x, t, k) { // Cobblestones: rounded grey stones packed close in staggered rows.
      let stones = "";
      for (let i = 0; i < 8; i++) { const y = t + 3 + i * 5.2, hw = hwAt(t, y); for (let px = -hw + 2.4 + (i % 2) * 2.4; px <= hw - 2; px += 4.8) stones += oval(x + px, y, 2.2, 2, k.c(i % 2 ? "#8a8a9a" : "#9a96a8")); }
      return path(trap(x, t), k.c("#3a3a46")) + stones;
    },
    "path-pebble": function (x, t, k) { // Pebble Swirl: sandy ground with pebbles set in two spirals.
      const swirl = function (cx, cy, size) { let out = "", i = 0; for (let a = .6; a < 3.4 * Math.PI; a += .7, i++) { const r = (1 + a * .55) * size; out += circle(cx + r * Math.cos(a), cy + r * Math.sin(a) * .62, 1.15, k.c(i % 2 ? "#5a5a66" : "#f4f2f8")); } return out; }; // One spiral of pebbles from the middle out, squashed for the tilt.
      return path(trap(x, t), k.c("#d8c8a8")) + swirl(x, t + 11, 1) + swirl(x, t + 31, 1.2) + circle(x, t + 11, 1.4, k.c("#8a6a9a")) + circle(x, t + 31, 1.6, k.c("#8a6a9a")); // Two swirls, each round a purple middle pebble.
    },
    "path-moss": function (x, t, k) { // Mossy Path: dark flagstones with soft green moss growing between them.
      return path(trap(x, t), k.c("#2a3a30")) + along(x, t, 5, function (y, hw) { return oval(x - hw * .45, y, hw * .4, 3, k.c("#8a8a94")) + oval(x + hw * .45, y + 1, hw * .4, 3, k.c("#7a7a86")); }) +
        scatter(x, t, 17, 16, function (px, py, i, roll) { return circle(px, py, roll(1, 2), k.c("#5aa04a"), 'opacity=".85"'); });
    },
    "path-shell": function (x, t, k) { // Shell Path: crushed cream shells with little pink scallop shells scattered on it.
      return path(trap(x, t), k.c("#efe2cc")) + scatter(x, t, 23, 10, function (px, py) { return path(d("M", px, py + 1.4, "L", px - 2.6, py - .6, "A", 2.6, 2.4, 0, 0, 1, px + 2.6, py - .6, "Z"), k.c("#f4a8b8")) + line(px, py + 1.4, px, py - 2.4, k.c("#d07890"), .5); });
    },
    "path-petal": function (x, t, k) { // Petal Path: soft stone strewn with pink petals.
      return path(trap(x, t), k.c("#9a8a98")) + scatter(x, t, 41, 16, function (px, py, i) { return oval(px, py, 2, 1, i % 3 ? "#ff8ecb" : "#ffc0de", 'transform="rotate(' + (i * 47 % 180) + " " + r1(px) + " " + r1(py) + ')"'); });
    },
    "path-hopscotch": function (x, t, k) { // Hopscotch: dark paving with chalk squares numbered 1 to 5 (the pair is 3 and 4).
      const chalk = 'stroke="#f4f0ff" stroke-width=".9" opacity=".85"';
      const sq = function (sx, sy, n) { return rect(sx, sy, 8.5, 8, "none", chalk) + text(sx + 4.25, sy + 6, n, 5.5, "#f4f0ff", 'font-family="monospace" opacity=".85"'); }; // One chalk square with its number.
      return path(trap(x, t), k.c("#3a3646")) + sq(x - 4.25, t + 2, "5") + sq(x - 9, t + 11, "3") + sq(x + .5, t + 11, "4") + sq(x - 4.25, t + 20.5, "2") + sq(x - 4.25, t + 30, "1");
    },
    "path-candy": function (x, t, k) { // Candy Tiles: rows of pink and white striped tiles with a mint stripe down the middle.
      let bands = "";
      for (let i = 0; i < 7; i++) { const y1 = t + i * 6, y2 = y1 + 6; bands += path(d("M", x - hwAt(t, y1), y1, "H", x + hwAt(t, y1), "L", x + hwAt(t, y2), y2, "H", x - hwAt(t, y2), "Z"), i % 2 ? k.c("#fff0f6") : k.c("#ff8ecb")); } // Each row of tile.
      return bands + path(d("M", x - 2, t, "H", x + 2, "L", x + 3, t + PATH_LEN, "H", x - 3, "Z"), k.c("#8be9c8"), 'opacity=".85"');
    },
    "path-neon": function (x, t, k) { // Neon Tiles: dark tiles, two by four, each outlined in a different glowing colour.
      let tiles = "";
      for (let i = 0; i < 4; i++) { const y = t + 1.5 + i * 10.2, hw = hwAt(t, y + 5); tiles += tube(box(x - hw + 1, y, hw - 2, 8.6), NEON[(i * 2) % 6], .8) + tube(box(x + 1, y, hw - 2, 8.6), NEON[(i * 2 + 1) % 6], .8); }
      return path(trap(x, t), "#120a22") + glow(tiles);
    },
    "path-glowstone": function (x, t, k) { // Glowstones: round stones on the grass that glow cyan and green.
      return along(x, t, 4, function (y, hw, i) { const sx = x + (i % 2 ? 3 : -3), col = i % 2 ? "#8be9a8" : "#70ebea"; return glow(oval(sx, y, hw + 2, 6, col, 'opacity=".22"')) + oval(sx, y, hw * .8, 3.6, k.c("#2a4a50")) + glow(oval(sx, y - .6, hw * .5, 2, col, 'opacity=".85"')); });
    },
    "path-starwalk": function (x, t, k) { // Star Walk: a navy path edged in gold, with gold stars set into it.
      return path(trap(x, t), "#14123a") + tube(d("M", x - PATH_W0, t, "L", x - PATH_W1, t + PATH_LEN, "M", x + PATH_W0, t, "L", x + PATH_W1, t + PATH_LEN), GOLD, .8) +
        glow(along(x, t, 5, function (y, hw, i) { return star(x + (i % 2 ? 4 : -4), y, 3.2, GOLD) + circle(x + (i % 2 ? -5 : 5), y - 2, .7, "#ffffff"); }));
    },
    "path-galaxy": function (x, t, k) { // Galaxy Carpet: a strip of deep night sky, pink and blue nebulae, stars, and glowing violet edges.
      return path(trap(x, t), "#1a0a3a") + oval(x - 3, t + 14, 8, 5, "#ff8ecb", 'opacity=".25"') + oval(x + 4, t + 30, 10, 5, "#70ebea", 'opacity=".2"') + // The sky and its clouds of colour.
        scatter(x, t, 53, 22, function (px, py, i, roll) { return circle(px, py, roll(.3, .9), "#ffffff"); }) + glow(sparkle(x + 4, t + 10, 2.6, "#ffffff") + sparkle(x - 6, t + 34, 3, "#ffe9f5")) + // Stars.
        tube(d("M", x - PATH_W0, t, "L", x - PATH_W1, t + PATH_LEN, "M", x + PATH_W0, t, "L", x + PATH_W1, t + PATH_LEN), "#c9a8ff", 1);
    }
  };

  // ---- Lamps: each stands on the ground at x, base b --------------------------------------------------------
  function pool(x, b, col, w) { return oval(x, b, w || 16, 4, col, 'opacity=".22"'); } // A lamp's light on the ground.
  const LAMPS = {
    "lamp-post": function (x, b, k) { // Street Lamp: a dark pole with a capped glass head, glowing warm.
      return pool(x, b, "#ffdc83") + rect(x - 1.6, b - 50, 3.2, 50, STEEL) + rect(x - 4, b - 3, 8, 3, STEEL) + glow(rect(x - 6, b - 60, 12, 12, "#ffdc83", 'opacity=".25"') + rect(x - 4, b - 58, 8, 8, "#ffe9a8")) + path(d("M", x - 6, b - 58, "L", x, b - 64, "L", x + 6, b - 58, "Z"), STEEL);
    },
    "lamp-paper-lantern": function (x, b, k) { // Paper Lantern: a wooden hook post with a red paper lantern hanging from it, glowing.
      return pool(x + 8, b, "#ff3d5a") + rect(x - 1.8, b - 52, 3.6, 52, k.c(WOOD)) + line(x, b - 50, x + 12, b - 50, k.c(WOOD), 2.4) + line(x + 10, b - 50, x + 10, b - 44, INK, 1) +
        glow(oval(x + 10, b - 36, 13, 14, "#ff3d5a", 'opacity=".2"') + oval(x + 10, b - 36, 7, 9, "#ff3d5a")) + [-3, 0, 3].map(function (dy) { return line(x + 3.4, b - 36 + dy, x + 16.6, b - 36 + dy, "#a01a2a", .5); }).join("") + rect(x + 7, b - 45.5, 6, 2, GOLD) + rect(x + 7, b - 28.5, 6, 2, GOLD) + line(x + 10, b - 26.5, x + 10, b - 22, GOLD, .8);
    },
    "lamp-gas": function (x, b, k) { // Gas Lamp: an old black iron lamp, a flared foot, a glass lantern box with a flickery flame and a pointed top.
      return pool(x, b, "#ff9d6b") + path(d("M", x - 5, b, "L", x - 1.5, b - 10, "V", b - 46, "H", x + 1.5, "V", b - 10, "L", x + 5, b, "Z"), "#4e4866") + line(x - 7, b - 44, x + 7, b - 44, "#4e4866", 1.4) +
        glow(path(d("M", x - 6, b - 48, "H", x + 6, "L", x + 7.5, b - 60, "H", x - 7.5, "Z"), "#ffb86a", 'opacity=".55"') + path(d("M", x, b - 50, "Q", x - 2.4, b - 54, x, b - 58, "Q", x + 2.4, b - 54, x, b - 50, "Z"), "#fff0b0")) +
        path(d("M", x - 6, b - 48, "H", x + 6, "L", x + 7.5, b - 60, "H", x - 7.5, "Z"), "none", 'stroke="#4e4866" stroke-width="1.2"') + path(d("M", x - 8.5, b - 60, "L", x, b - 66, "L", x + 8.5, b - 60, "Z"), "#4e4866") + circle(x, b - 67, 1.4, "#4e4866");
    },
    "lamp-string": function (x, b, k) { // String Lights: two thin poles with a sagging wire of colourful bulbs between them.
      let bulbs = "";
      for (let i = 1; i < 8; i++) { const t = i / 8, px = x - 16 + 32 * t, py = b - 44 + 4 * 6 * t * (1 - t) * 1.5; bulbs += circle(px, py + 2, 1.9, NEON[i % 6]) + circle(px, py + 2, 3.6, NEON[i % 6], 'opacity=".25"'); } // Bulbs hung along the sag.
      return pool(x, b, "#ffdc83", 22) + rect(x - 17.5, b - 46, 3, 46, k.c(WOOD)) + rect(x + 14.5, b - 46, 3, 46, k.c(WOOD)) + path(d("M", x - 16, b - 44, "Q", x, b - 26, x + 16, b - 44), "none", 'stroke="' + INK + '" stroke-width=".8"') + glow(bulbs);
    },
    "lamp-twin-globe": function (x, b, k) { // Twin Globe Lamp: a grand post with a curly crossarm and two round glowing globes.
      return pool(x, b, "#fff3d0", 22) + rect(x - 2, b - 50, 4, 50, "#4e4866") + rect(x - 5, b - 6, 10, 6, "#4e4866", 'rx="1"') + path(d("M", x - 14, b - 48, "Q", x - 14, b - 54, x, b - 52, "Q", x + 14, b - 54, x + 14, b - 48), "none", 'stroke="#4e4866" stroke-width="2"') +
        glow([x - 14, x + 14].map(function (gx) { return circle(gx, b - 42, 9, "#fff3d0", 'opacity=".22"') + circle(gx, b - 42, 5.6, "#fff6e0"); }).join("")) + circle(x, b - 56, 3, "#fff6e0") + circle(x, b - 60, 1.4, GOLD);
    },
    "lamp-candle-jar": function (x, b, k) { // Candle Jar: a glass jar with a lit candle inside, on a little stone.
      return pool(x, b, "#ffb86a", 12) + rect(x - 7, b - 6, 14, 6, k.c("#6a6a74"), 'rx="2"') + glow(oval(x, b - 15, 11, 12, "#ffb86a", 'opacity=".22"')) + rect(x - 5.5, b - 22, 11, 16, "#d8f4ff", 'rx="2" opacity=".35" stroke="#e8f8ff" stroke-width=".8"') + rect(x - 6, b - 23.5, 12, 2.4, k.c("#c08a5a")) +
        rect(x - 2.4, b - 15, 4.8, 9, "#fff4e8") + glow(path(d("M", x, b - 15.5, "Q", x - 1.8, b - 18, x, b - 21, "Q", x + 1.8, b - 18, x, b - 15.5, "Z"), "#ffdc83"));
    },
    "lamp-glowshroom": function (x, b, k) { // Glowshroom: a tall curving mushroom whose cyan cap glows, with a baby one beside it.
      return pool(x, b, "#70ebea", 16) + path(d("M", x - 3, b, "Q", x - 6, b - 18, x - 1, b - 32, "H", x + 3, "Q", x - 1, b - 18, x + 3, b, "Z"), k.c("#efe2c8")) +
        glow(oval(x, b - 34, 18, 12, "#70ebea", 'opacity=".22"') + path(d("M", x - 13, b - 31, "Q", x - 12, b - 44, x + 1, b - 44, "Q", x + 14, b - 44, x + 14, b - 31, "Z"), "#70ebea") + circle(x - 5, b - 37, 1.8, "#e0ffff") + circle(x + 5, b - 39, 1.4, "#e0ffff") + circle(x + 9, b - 34, 1.2, "#e0ffff")) +
        rect(x + 9, b - 7, 2.4, 7, k.c("#efe2c8")) + glow(path(d("M", x + 6, b - 6, "Q", x + 10, b - 12, x + 14, b - 6, "Z"), "#8be9a8"));
    },
    "lamp-firefly-jar": function (x, b, k) { // Firefly Jar: a jar on a tree stump, full of little yellow-green fireflies, a few escaping.
      const flies = [[-3, -20], [2, -16], [-1, -13], [3, -22], [-4, -15], [8, -30], [-9, -34], [5, -37]].map(function (f) { return circle(x + f[0], b + f[1], 1.1, "#e8ff8a") + circle(x + f[0], b + f[1], 2.6, "#e8ff8a", 'opacity=".3"'); }).join(""); // The fireflies, glowing.
      return pool(x, b, "#e8ff8a", 14) + rect(x - 8, b - 9, 16, 9, k.c("#6a4a2a"), 'rx="2"') + oval(x, b - 9, 8, 2, k.c("#a87a4a")) + rect(x - 5.5, b - 25, 11, 15, "#d8f4ff", 'rx="2" opacity=".3" stroke="#e8f8ff" stroke-width=".8"') + rect(x - 6, b - 27, 12, 2.4, k.c("#8a8a94")) + glow(flies);
    },
    "lamp-tulip-glow": function (x, b, k) { // Tulip Lamp: a curving green stem with two leaves and a pink tulip cup glowing at the top.
      return pool(x + 4, b, "#ff8ecb") + path(d("M", x, b, "Q", x - 6, b - 26, x + 4, b - 44), "none", 'stroke="' + k.c("#3f8a4e") + '" stroke-width="2.6"') + path(d("M", x - 1, b - 8, "Q", x - 12, b - 14, x - 10, b - 24, "Q", x - 4, b - 16, x - 1, b - 8, "Z", "M", x - 2, b - 16, "Q", x + 8, b - 20, x + 10, b - 28, "Q", x + 2, b - 26, x - 2, b - 16, "Z"), k.c("#4aa05a")) +
        glow(oval(x + 4, b - 50, 13, 12, "#ff8ecb", 'opacity=".22"') + path(d("M", x - 3, b - 54, "L", x, b - 50, "L", x + 4, b - 56, "L", x + 8, b - 50, "L", x + 11, b - 54, "Q", x + 11, b - 43, x + 4, b - 43, "Q", x - 3, b - 43, x - 3, b - 54, "Z"), "#ff8ecb") + oval(x + 4, b - 47, 3, 2, "#fff0f6"));
    },
    "lamp-moonbeam": function (x, b, k) { // Moon Lamp: a slim pole topped with a glowing golden crescent moon.
      return pool(x, b, GOLD) + rect(x - 1.5, b - 42, 3, 42, STEEL) + rect(x - 4, b - 3, 8, 3, STEEL) + glow(circle(x + 2, b - 54, 14, GOLD, 'opacity=".18"') + path(crescent(x, b - 54, 11), GOLD)) + circle(x + 7, b - 57, 1, "#ffffff") + sparkle(x + 12, b - 66, 2.4, "#ffffff");
    },
    "lamp-jellyfish": function (x, b, k) { // Jellyfish Lamp: a hooked pole with a glowing pink-violet jellyfish hanging from it, its wavy tendrils trailing.
      return pool(x + 10, b, "#c9a8ff") + path(d("M", x, b, "V", b - 54, "Q", x, b - 62, x + 10, b - 60), "none", 'stroke="' + STEEL + '" stroke-width="3"') + rect(x - 4, b - 3, 8, 3, STEEL) +
        glow(oval(x + 10, b - 44, 15, 14, "#c9a8ff", 'opacity=".2"') + path(d("M", x + 1, b - 46, "Q", x + 1, b - 58, x + 10, b - 58, "Q", x + 19, b - 58, x + 19, b - 46, "Q", x + 10, b - 43, x + 1, b - 46, "Z"), "#e0a8ff", 'opacity=".9"') +
          [3, 7, 11, 15, 18].map(function (dx, i) { return path(d("M", x + dx + 1, b - 45, "Q", x + dx - 1, b - 38, x + dx + 2, b - 32 + (i % 2) * 3, "Q", x + dx - 1, b - 27, x + dx + 1, b - 22 + i % 3), "none", 'stroke="#ff8ecb" stroke-width=".9" opacity=".8"'); }).join("")) + circle(x + 7, b - 52, 1.6, "#ffffff", 'opacity=".6"');
    },
    "lamp-neon-arch": function (x, b, k) { // Neon Arch Lamp: a single bent neon tube rising from a base plate and curling over, buzzing pink with a cyan tip.
      return pool(x + 8, b, HOT) + rect(x - 5, b - 3, 10, 3, STEEL) + glow(tube(d("M", x, b - 3, "V", b - 40, "Q", x, b - 56, x + 14, b - 56, "Q", x + 22, b - 56, x + 22, b - 48), HOT, 2) + circle(x + 22, b - 46, 3, "#70ebea") + circle(x + 22, b - 46, 7, "#70ebea", 'opacity=".25"'));
    },
    "lamp-crystal": function (x, b, k) { // Crystal Lamp: a silver pole holding a big violet crystal that hums with light, small shards at its foot.
      return pool(x, b, "#c9a8ff") + rect(x - 1.5, b - 40, 3, 40, "#b0b8cc") + path(d("M", x - 5, b - 40, "H", x + 5, "L", x + 3, b - 44, "H", x - 3, "Z"), "#b0b8cc") +
        glow(circle(x, b - 54, 14, "#c9a8ff", 'opacity=".2"') + path(d("M", x, b - 68, "L", x + 7, b - 54, "L", x, b - 43, "L", x - 7, b - 54, "Z"), "#b48aff") + path(d("M", x, b - 68, "L", x + 7, b - 54, "L", x, b - 43, "Z"), "#e0d0ff", 'opacity=".5"')) +
        path(shard(x - 6, b, 4, 8), "#8ae6f0", 'opacity=".9"') + path(shard(x + 6, b, 4, 6), "#c9a8ff", 'opacity=".9"');
    },
    "lamp-wishing-star": function (x, b, k) { // Wishing Star Lamp: a tall gold pole with a real star on top, blazing, a ribbon tied on, sparkles all round.
      return pool(x, b, GOLD, 20) + rect(x - 1.5, b - 50, 3, 50, GOLD) + rect(x - 5, b - 3, 10, 3, GOLD) + path(d("M", x, b - 34, "q", 6, 2, 8, 8, "M", x, b - 34, "q", -5, 3, -6, 9), "none", 'stroke="#ff8ecb" stroke-width="1.6"') +
        glow(circle(x, b - 60, 18, GOLD, 'opacity=".2"') + star(x, b - 60, 12, GOLD) + star(x, b - 60, 5, "#fff8e0")) + glow(sparkle(x - 16, b - 70, 3, "#ffffff") + sparkle(x + 16, b - 74, 2.6, "#ffffff") + sparkle(x + 14, b - 46, 2, "#ffe9f5") + sparkle(x - 12, b - 44, 2, "#ffe9f5"));
    },
    "lamp-lumi-wisp": function (x, b, k) { // Lumi Wisp Lantern: a little Lumi made of light floating over a silver stand, wings out, smiling, a trail of sparkles behind.
      const wy = b - 50; // Where she floats.
      return oval(x, b, 20, 4, "#ff8ecb", pet('opacity=".25"')) + rect(x - 1.5, b - 28, 3, 28, "#d8dce8") + path(d("M", x - 7, b - 28, "Q", x, b - 34, x + 7, b - 28, "Z"), "#d8dce8") + rect(x - 4, b - 3, 8, 3, "#d8dce8") + // The stand, with a little cup on top.
        glow(circle(x, wy, 18, "#ff8ecb", pet('opacity=".18"')) + oval(x - 9, wy - 4, 7, 4, "#ffffff", 'opacity=".75" transform="rotate(-25 ' + r1(x - 9) + " " + r1(wy - 4) + ')"') + oval(x + 9, wy - 4, 7, 4, "#ffffff", 'opacity=".75" transform="rotate(25 ' + r1(x + 9) + " " + r1(wy - 4) + ')"') + circle(x, wy, 8, "#ff8ecb", pet())) + // Her glow, her wings and her round little body (in Lumi's own colour).
        circle(x - 2.6, wy - 1, 1.1, INK) + circle(x + 2.6, wy - 1, 1.1, INK) + path(d("M", x - 1.6, wy + 2, "Q", x, wy + 3.6, x + 1.6, wy + 2), "none", 'stroke="' + INK + '" stroke-width=".8"') + circle(x - 4.4, wy + 1.6, 1.2, "#ff5aa8", 'opacity=".6"') + circle(x + 4.4, wy + 1.6, 1.2, "#ff5aa8", 'opacity=".6"') + // Her face.
        glow(sparkle(x + 2, wy - 13, 2.4, GOLD) + circle(x - 14, wy + 8, 1.4, "#ffffff", 'opacity=".8"') + circle(x - 19, wy + 12, 1, "#ffffff", 'opacity=".55"') + circle(x - 23, wy + 15, .7, "#ffffff", 'opacity=".35"')); // A star over her head and a fading trail.
    }
  };

  // ---- Ornaments: each stands on the ground at x, base b ----------------------------------------------------
  const ORNAMENTS = {
    "ornament-gnome": function (x, b, k) { // Garden Gnome: a little gnome in a tall red hat, a white beard and a blue coat.
      return shadow(x, b, 9) + rect(x - 5, b - 3, 4, 3, k.c("#4a2a1a"), 'rx="1"') + rect(x + 1, b - 3, 4, 3, k.c("#4a2a1a"), 'rx="1"') + path(d("M", x - 7, b - 3, "Q", x - 8, b - 14, x, b - 16, "Q", x + 8, b - 14, x + 7, b - 3, "Z"), k.c("#3a6ad8")) +
        path(d("M", x - 5, b - 15, "Q", x, b - 4, x + 5, b - 15, "Z"), "#f4f4f8") + circle(x, b - 18, 4, k.c("#f4c8a8")) + circle(x, b - 17, 1.4, k.c("#f08a7a")) + path(d("M", x - 5.5, b - 19, "Q", x - 2, b - 34, x + 4, b - 32, "Q", x + 2, b - 26, x + 5.5, b - 19, "Z"), k.c("#e0304a"));
    },
    "ornament-flamingo": function (x, b, k) { // Pink Flamingo: a pink plastic flamingo standing on one leg, the other tucked up.
      return line(x, b, x, b - 16, k.c("#e0709a"), 1) + path(d("M", x, b - 10, "L", x + 4, b - 13, "L", x + 1, b - 16), "none", 'stroke="' + k.c("#e0709a") + '" stroke-width="1"') + oval(x - 1, b - 20, 9, 5.5, k.c("#ff8ec0")) + path(d("M", x - 9, b - 19, "L", x - 13, b - 22, "L", x - 8, b - 22, "Z"), k.c("#ff8ec0")) +
        path(d("M", x + 6, b - 21, "Q", x + 10, b - 26, x + 6, b - 30, "Q", x + 2, b - 34, x + 6, b - 38), "none", 'stroke="' + k.c("#ff8ec0") + '" stroke-width="2.6" stroke-linecap="round"') + circle(x + 7, b - 38, 2.6, k.c("#ff8ec0")) + path(d("M", x + 9, b - 39, "L", x + 13, b - 36, "L", x + 9, b - 37, "Z"), INK) + circle(x + 7.4, b - 38.6, .7, INK);
    },
    "ornament-birdbath": function (x, b, k) { // Birdbath: a stone pedestal and bowl of water, a little bird perched on the rim.
      return shadow(x, b, 11) + path(d("M", x - 7, b, "L", x - 3, b - 6, "V", b - 18, "H", x + 3, "V", b - 6, "L", x + 7, b, "Z"), k.c("#a8a8b8")) + path(d("M", x - 14, b - 22, "Q", x, b - 12, x + 14, b - 22, "Z"), k.c("#b8b8c8")) + oval(x, b - 22, 14, 2.6, k.c("#c8c8d8")) + oval(x, b - 22, 11, 1.8, "#70c8ea", 'opacity=".85"') +
        oval(x + 11, b - 26, 3.4, 2.4, "#ff9d6b") + circle(x + 13, b - 28, 1.8, "#ff9d6b") + path(d("M", x + 14.6, b - 28.4, "l", 1.8, .5, "l", -1.8, .5, "Z"), GOLD);
    },
    "ornament-bench": function (x, b, k) { // Little Bench: a wooden slatted bench on curly iron legs.
      return shadow(x, b, 16) + [x - 13, x + 11].map(function (lx) { return path(d("M", lx, b, "V", b - 10, "Q", lx + 1, b - 14, lx + 2, b - 10, "V", b), "none", 'stroke="#4e4866" stroke-width="1.6"'); }).join("") +
        rect(x - 16, b - 12, 32, 3, k.c("#a8743e"), 'rx="1"') + rect(x - 16, b - 22, 32, 3, k.c("#a8743e"), 'rx="1"') + rect(x - 16, b - 18, 32, 3, k.c("#a8743e"), 'rx="1"') + line(x - 14, b - 12, x - 14, b - 22, "#4e4866", 1.4) + line(x + 14, b - 12, x + 14, b - 22, "#4e4866", 1.4);
    },
    "ornament-fountain": function (x, b, k) { // Fountain: a wide stone basin, a column with a smaller bowl, and arcs of water splashing down.
      return oval(x, b - 4, 18, 5, k.c("#9a9aaa")) + rect(x - 18, b - 10, 36, 6, k.c("#9a9aaa")) + oval(x, b - 10, 18, 4, k.c("#b8b8c8")) + oval(x, b - 10, 15, 2.8, "#70c8ea", 'opacity=".85"') + rect(x - 2.5, b - 24, 5, 14, k.c("#a8a8b8")) +
        path(d("M", x - 9, b - 24, "Q", x, b - 18, x + 9, b - 24, "Z"), k.c("#b8b8c8")) + glow(path(d("M", x, b - 26, "Q", x, b - 36, x - 4, b - 34, "M", x, b - 26, "Q", x, b - 36, x + 4, b - 34, "M", x - 8, b - 24, "Q", x - 14, b - 22, x - 14, b - 11, "M", x + 8, b - 24, "Q", x + 14, b - 22, x + 14, b - 11), "none", 'stroke="#a8e8ff" stroke-width="1.4" stroke-linecap="round" opacity=".9"'));
    },
    "ornament-bunny": function (x, b, k) { // Stone Bunny: a sitting grey stone bunny with tall ears and patches of moss.
      return shadow(x, b, 10) + oval(x, b - 7, 9, 7, k.c("#a8a8b4")) + circle(x + 5, b - 16, 5.4, k.c("#b4b4c0")) + oval(x + 3, b - 26, 2, 6, k.c("#a8a8b4"), 'transform="rotate(-10 ' + r1(x + 3) + " " + r1(b - 26) + ')"') + oval(x + 8, b - 26, 2, 6, k.c("#a8a8b4"), 'transform="rotate(12 ' + r1(x + 8) + " " + r1(b - 26) + ')"') +
        circle(x - 8, b - 6, 2.6, k.c("#c8c8d4")) + circle(x + 7, b - 17, .8, INK) + circle(x - 2, b - 10, 2.4, k.c("#5aa04a"), 'opacity=".8"') + circle(x + 3, b - 4, 1.8, k.c("#5aa04a"), 'opacity=".8"');
    },
    "ornament-sunflower": function (x, b, k) { // Sunflower Pot: a terracotta pot with a tall sunflower, two leaves and a big yellow face.
      let petals = "";
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; petals += oval(x + 6 * Math.cos(a), b - 34 + 6 * Math.sin(a), 3.4, 1.6, "#ffd23a", 'transform="rotate(' + i * 30 + " " + r1(x + 6 * Math.cos(a)) + " " + r1(b - 34 + 6 * Math.sin(a)) + ')"'); } // Twelve petals round the middle.
      return line(x, b - 10, x, b - 30, k.c("#3f8a4e"), 2) + path(d("M", x, b - 18, "Q", x - 9, b - 20, x - 10, b - 26, "Q", x - 3, b - 24, x, b - 18, "Z", "M", x, b - 22, "Q", x + 9, b - 24, x + 10, b - 30, "Q", x + 3, b - 28, x, b - 22, "Z"), k.c("#4aa05a")) +
        path(d("M", x - 7, b - 11, "H", x + 7, "L", x + 5, b, "H", x - 5, "Z"), k.c("#c8603a")) + rect(x - 8, b - 12, 16, 3, k.c("#d8704a")) + petals + circle(x, b - 34, 4, "#6a3a1a");
    },
    "ornament-frog": function (x, b, k) { // Lily Frog: a green frog sitting on a lily pad, a pink water lily beside it.
      return oval(x, b - 2, 15, 4.6, k.c("#3f8a4e")) + path(d("M", x + 15, b - 2, "L", x + 5, b - 2.6, "L", x + 11, b + 1.5, "Z"), k.c("#2a3a30")) + oval(x - 2, b - 7, 7, 5, k.c("#5ab84a")) + circle(x - 5, b - 12, 2.6, k.c("#5ab84a")) + circle(x + 1, b - 12, 2.6, k.c("#5ab84a")) +
        circle(x - 5, b - 12.4, 1.2, INK) + circle(x + 1, b - 12.4, 1.2, INK) + path(d("M", x - 6, b - 8, "Q", x - 2, b - 6, x + 2, b - 8), "none", 'stroke="#1a3a1a" stroke-width=".8"') + [-2, 0, 2].map(function (dx) { return oval(x + 10 + dx, b - 6, 1.6, 3.4, "#ffb8dc", 'transform="rotate(' + dx * 18 + " " + r1(x + 10 + dx) + " " + r1(b - 6) + ')"'); }).join("") + circle(x + 10, b - 5, 1, GOLD);
    },
    "ornament-sleepy-cat": function (x, b, k) { // Sleepy Cat: a grey-and-white cat curled up asleep, its tail round its nose, a few z's drifting up.
      return shadow(x, b, 13) + oval(x, b - 6, 13, 6.5, k.c("#9a9aaa")) + path(d("M", x + 12, b - 4, "Q", x + 6, b + 1, x - 6, b - 1), "none", 'stroke="' + k.c("#8a8a9a") + '" stroke-width="3" stroke-linecap="round"') + circle(x - 8, b - 9, 5, k.c("#a8a8b8")) +
        path(d("M", x - 12, b - 12, "L", x - 12, b - 17, "L", x - 9, b - 13.5, "Z", "M", x - 6, b - 13, "L", x - 4, b - 17, "L", x - 3.6, b - 12, "Z"), k.c("#a8a8b8")) + path(d("M", x - 11, b - 9, "q", 1.2, 1, 2.4, 0, "M", x - 7, b - 9, "q", 1.2, 1, 2.4, 0), "none", 'stroke="' + INK + '" stroke-width=".7"') + oval(x - 7, b - 6, 2.6, 1.6, "#ffffff", 'opacity=".75"') +
        text(x + 4, b - 16, "z", 5, "#e8e4ff", 'font-family="monospace"') + text(x + 8, b - 21, "z", 6.5, "#e8e4ff", 'font-family="monospace" opacity=".8"') + text(x + 13, b - 27, "Z", 8, "#e8e4ff", 'font-family="monospace" opacity=".6"');
    },
    "ornament-pinwheel": function (x, b, k) { // Pinwheel: a stick with four bright folded blades round a gold pin.
      const hy = b - 30, cols = ["#ff8ecb", "#70ebea", "#ffdc83", "#8be9a8"]; // The hub's height and the blade colours.
      return line(x, b, x, hy, k.c("#e8e4f0"), 1.6) + [0, 90, 180, 270].map(function (deg, i) { return path(d("M", x, hy, "L", x, hy - 11, "Q", x + 8, hy - 9, x + 6, hy - 3, "Z"), k.c(cols[i]), 'transform="rotate(' + (deg + 15) + " " + r1(x) + " " + r1(hy) + ')"'); }).join("") + circle(x, hy, 1.6, GOLD);
    },
    "ornament-shrine": function (x, b, k) { // Tiny Shrine: a little red torii gate in front of a tiny wooden shrine with a glowing offering lantern.
      return rect(x - 6, b - 16, 12, 12, k.c("#8a5a34")) + path(d("M", x - 9, b - 15, "L", x, b - 22, "L", x + 9, b - 15, "Z"), k.c("#3a2a2a")) + rect(x - 2.4, b - 11, 4.8, 7, INK) + rect(x - 8, b - 4, 16, 4, k.c("#8a8a94")) + // The shrine on its stone step.
        rect(x - 14, b - 26, 2.6, 26, k.c("#e0303a")) + rect(x + 11.4, b - 26, 2.6, 26, k.c("#e0303a")) + path(d("M", x - 18, b - 29, "Q", x, b - 26, x + 18, b - 29, "L", x + 17, b - 26, "Q", x, b - 23.5, x - 17, b - 26, "Z"), "#4e4866") + rect(x - 15, b - 23, 30, 2, k.c("#e0303a")) + // The torii gate.
        glow(circle(x + 17, b - 5, 2, "#ffb86a") + circle(x + 17, b - 5, 4.6, "#ffb86a", 'opacity=".25"')) + rect(x + 15.5, b - 3, 3, 3, k.c("#8a8a94"));
    },
    "ornament-neon-heart": function (x, b, k) { // Neon Heart Sign: two thin posts holding up a heart of buzzing pink neon tube.
      return pool(x, b, HOT, 18) + line(x - 8, b, x - 8, b - 16, STEEL, 1.6) + line(x + 8, b, x + 8, b - 16, STEEL, 1.6) + glow(tube(heartPath(x, b - 28, 9), HOT, 1.8) + path(heartPath(x, b - 28, 9), HOT, 'opacity=".12"'));
    },
    "ornament-crystal-cluster": function (x, b, k) { // Crystal Cluster: glowing violet and cyan gem points bursting up out of the ground.
      return glow(oval(x, b - 2, 18, 4, "#c9a8ff", 'opacity=".3"')) + [[-10, 8, 16, "#8ae6f0", -14], [10, 7, 14, "#c9a8ff", 16], [-4, 9, 24, "#b48aff", -6], [4, 9, 28, "#8ae6f0", 6]].map(function (s) {
        return group(path(shard(x + s[0], b, s[1], s[2]), s[3], 'opacity=".92"') + path(d("M", x + s[0], b - s[2], "L", x + s[0] + s[1] / 2, b - s[2] + s[1] * .7, "V", b, "H", x + s[0], "Z"), "#ffffff", 'opacity=".25"'), 'transform="rotate(' + s[4] + " " + r1(x + s[0]) + " " + r1(b) + ')"'); // A gem point, tilted out.
      }).join("") + glow(sparkle(x + 2, b - 34, 2.6, "#ffffff"));
    },
    "ornament-star-fountain": function (x, b, k) { // Starfall Fountain: a navy-and-gold fountain whose spray is falling stars, its basin full of starry water.
      return glow(oval(x, b - 6, 22, 6, GOLD, 'opacity=".2"')) + oval(x, b - 4, 18, 5, "#2a2a6a") + rect(x - 18, b - 10, 36, 6, "#2a2a6a") + tube(d("M", x - 18, b - 10, "H", x + 18), GOLD, .8) + oval(x, b - 10, 15, 3, "#140a3a") + circle(x - 6, b - 10, .6, "#ffffff") + circle(x + 5, b - 9.5, .6, "#ffffff") + circle(x + 1, b - 11, .5, "#ffffff") + // The basin of starry water.
        rect(x - 2.5, b - 24, 5, 14, "#3a3a7a") + path(d("M", x - 9, b - 24, "Q", x, b - 18, x + 9, b - 24, "Z"), "#3a3a7a") + tube(d("M", x - 9, b - 24, "H", x + 9), GOLD, .8) + // The column and its bowl.
        glow(path(d("M", x, b - 26, "Q", x - 8, b - 44, x - 15, b - 14, "M", x, b - 26, "Q", x + 8, b - 44, x + 15, b - 14), "none", 'stroke="' + GOLD + '" stroke-width=".7" stroke-dasharray="1.5 3" opacity=".8"') + star(x, b - 36, 3.4, GOLD) + star(x - 9, b - 30, 2.4, "#fff8e0") + star(x + 9, b - 30, 2.4, "#fff8e0") + star(x - 13, b - 20, 2, GOLD) + star(x + 13, b - 20, 2, GOLD));
    },
    "ornament-lumi-statue": function (x, b, k) { // Lumi Statue: a golden statue of Lumi on a marble plinth, wings out and a star on her head, glowing, with sparkles about.
      const sy = b - 26; // The middle of her golden body.
      return glow(circle(x, sy, 20, GOLD, 'opacity=".16"')) + rect(x - 12, b - 12, 24, 12, k.c("#e8e4f0")) + rect(x - 14, b - 14, 28, 3, k.c("#f4f0fa")) + rect(x - 14, b - 2, 28, 2, k.c("#c8c4d4")) + tube(d("M", x - 12, b - 7, "H", x + 12), GOLD, .7) + // The marble plinth, gold-banded.
        oval(x - 10, sy - 4, 7, 4, "#f0c050", 'transform="rotate(-25 ' + r1(x - 10) + " " + r1(sy - 4) + ')"') + oval(x + 10, sy - 4, 7, 4, "#f0c050", 'transform="rotate(25 ' + r1(x + 10) + " " + r1(sy - 4) + ')"') + // Her wings.
        circle(x, sy, 9, "#f4c84a") + circle(x - 3, sy - 3, 3, "#fff0b0", 'opacity=".7"') + circle(x - 3, sy, 1.1, "#8a5a10") + circle(x + 3, sy, 1.1, "#8a5a10") + path(d("M", x - 1.6, sy + 3, "Q", x, sy + 4.4, x + 1.6, sy + 3), "none", 'stroke="#8a5a10" stroke-width=".8"') + // Her round golden body, its shine and her face.
        line(x, sy - 9, x, sy - 13, "#f4c84a", 1) + glow(star(x, sy - 16, 3.6, GOLD)) + glow(sparkle(x - 17, sy - 10, 2.4, "#ffffff") + sparkle(x + 17, sy - 14, 2.6, "#ffffff") + sparkle(x + 14, sy + 8, 1.8, "#fff8e0")); // The star on her head, and sparkles.
    }
  };

  const STYLE_IDS = Object.keys(HOUSES); // Every house style, in the shop's order (must match estate.json's styles).
  const SLOTS = { fence: FENCES, mailbox: MAILBOXES, path: PATHS, lamp: LAMPS, ornament: ORNAMENTS }; // Each yard slot's drawings.
  const YARD_IDS = {}; // Every yard thing per slot, in the shop's order (must match estate.json's yard).
  Object.keys(SLOTS).forEach(function (slot) { YARD_IDS[slot] = Object.keys(SLOTS[slot]); });

  function house(styleId, cx, base, night) { // Just one house, centred on cx and standing on base (an unknown style draws the starter).
    const draw = HOUSES[styleId] || HOUSES["starter-cottage"];
    return group(shadow(cx, base, 70) + draw(kit(cx, base, night)), 'class="lp-es-house"');
  }

  function yardItem(slot, id, x, base, night) { // Just one yard thing at x on base ("" for an unknown one). A fence is a 120-wide run centred on x.
    const table = SLOTS[slot], draw = table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
    if (!draw) return "";
    const k = kit(x, base, night);
    return slot === "fence" ? draw(x - 60, x + 60, base, k) : draw(x, base, k);
  }

  function ground(bx, by, w, h, night, seed) { // The lot's garden patch: dark grass with a subtle edge, darker at the back for depth, tufts and a kerb at the front.
    const roll = dice(seed);
    let tufts = "";
    for (let i = 0; i < 18; i++) { const tx = bx + roll(6, w - 6), ty = by + roll(8, h - 6); tufts += path(d("M", tx - 2, ty, "L", tx - 1, ty - 3, "M", tx, ty, "V", ty - 4, "M", tx + 2, ty, "L", tx + 1, ty - 3), "none", 'stroke="' + (night ? "#2a5a44" : "#3a7a5a") + '" stroke-width=".8"'); } // Little grass tufts.
    return rect(bx, by, w, h, night ? "#0f2420" : "#173a30", 'rx="5" stroke="' + (night ? "#24483c" : "#2e5e4c") + '" stroke-width="1.5"') + rect(bx + 1, by + 1, w - 2, 12, INK, 'rx="4" opacity=".25"') + tufts + rect(bx, by + h - 2, w, 3, "#3a3450", 'rx="1"');
  }

  function flowers(bx, by, w, h, seed) { // A few wild flowers dotted over an empty lot.
    const roll = dice(seed);
    let out = "";
    for (let i = 0; i < 9; i++) { const fx = bx + roll(10, w - 10), fy = by + roll(14, h - 8); out += line(fx, fy, fx, fy - 4, "#3f8a4e", .8) + circle(fx, fy - 5, 1.8, NEON[i % 6]) + circle(fx, fy - 5, .7, "#ffffff"); }
    return out;
  }

  function saleBoard(x, b, price) { // The FOR SALE board on two legs: dark, pink-neon edged, the price in gold under it.
    return line(x - 18, b, x - 18, b - 22, STEEL, 2.4) + line(x + 18, b, x + 18, b - 22, STEEL, 2.4) + rect(x - 32, b - 46, 64, 28, INK, 'rx="3"') + tube(box(x - 32, b - 46, 64, 28), HOT, 1.2) +
      neon(x, b - 34, "FOR SALE", 9, HOT, 'font-family="monospace" font-weight="bold" letter-spacing="1"') + text(x, b - 23, "✦ " + esc(price), 8, GOLD, 'font-family="monospace" font-weight="bold"');
  }

  function nameplate(x, b, name) { // The owner's name on a low little sign on two stubby legs at x (its left edge), standing on b (cut to 16 letters, always escaped).
    const words = Array.from(String(name)).slice(0, 16).join(""), w = Math.max(28, Array.from(words).length * 4.6 + 10); // The name, and a board wide enough for it.
    return line(x + 4, b, x + 4, b - 6, "#4e4866", 1.6) + line(x + w - 4, b, x + w - 4, b - 6, "#4e4866", 1.6) + // Its legs.
      rect(x, b - 17, w, 11, "#1a1030", petLine('rx="2" stroke="#ff8ecb" stroke-width=".8"')) + text(x + w / 2, b - 9, esc(words), 7, "#ffe9f5", 'font-family="monospace"'); // The board, rimmed in Lumi's glow, and the name.
  }

  function plot(box0, opts) { // One whole lot: ground and the reach ring, path, house, lamp, ornament, fence, mailbox, then the sale board or nameplate.
    const o = opts || {}, bx = box0.x, by = box0.y, w = box0.w, h = box0.h, night = !!o.night, yard = o.yard || {}; // Where it is and what's on it.
    const front = by + h, cx = r1(bx + w * .42), base = front - 4, seed = Math.abs(Math.round(bx * 7 + by * 13)) + 1; // Its front edge, where the house stands, and its steady dice seed.
    const sale = o.sale !== null && o.sale !== undefined && o.sale !== ""; // Up for sale: a bare lot with a board.
    const owned = !sale && !!(o.style || o.name); // Someone lives here: a house style is picked, or it has an owner (no style yet then draws the starter).
    let out = ground(bx, by, w, h, night, seed);
    if (o.on) out += oval(cx, front + 3, 30, 7, "#ff8ecb", pet('opacity=".14"')) + oval(cx, front + 3, 30, 7, "none", petLine('stroke="#ff8ecb" stroke-width="2" opacity=".9"')); // In reach: a soft ring at the doorstep, on the ground under everything else.
    if (!owned) { // A bare lot: grass, flowers, and the board if it's for sale.
      out += flowers(bx, by, w, h, seed + 3);
      if (sale) out += saleBoard(cx, front - 6, o.sale);
    } else {
      out += yardItem("path", yard.path || "", cx, base, night) + house(o.style || "starter-cottage", cx, base, night) + // The path first (under everything), then the house.
        yardItem("lamp", yard.lamp || "", bx + w * .8, front - 22, night) + yardItem("ornament", yard.ornament || "", bx + w * .92, front - 6, night); // The lamp further back and the ornament in front, on the grass to the right.
      const fence = FENCES[yard.fence]; // The fence runs along the front edge, open where the path comes through.
      if (fence) { const k = kit(cx, front, night); out += fence(bx + 4, cx - 17, front, k) + fence(cx + 17, bx + w - 4, front, k); }
      out += yardItem("mailbox", yard.mailbox || "", cx - 29, front + 6, night); // The mailbox beside the path, at the pavement.
      if (o.name) out += nameplate(cx + 22, front + 14, o.name); // The owner's name on a low sign on the other side of the path, out in front of the fence.
    }
    return group(out, 'class="lp-es-plot"');
  }

  return { plot: plot, house: house, yardItem: yardItem, STYLE_IDS: STYLE_IDS, YARD_IDS: YARD_IDS, PATH_LEN: PATH_LEN };
});
