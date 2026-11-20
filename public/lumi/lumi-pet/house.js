/* The art for Lumi's house: every object that can stand in a spot, drawn as plain SVG in a 400 x 500 block that
   render() sets into a 1000 x 500 room (see the end of this file).
   The server's catalog (mnemerynne/lumipet_data/house.json) says which objects exist, what they cost and which spot
   they belong to; this file only knows how each one looks. Every catalog id needs an entry in ART here
   (tests/js/lumi_house.test.mjs checks). It is paperdoll furniture: nothing is placed freely, each spot shows one
   object, and LAYERS is the fixed back-to-front order, the way Littlepottchi layered an outfit.

   All of it is authored here and never contains anything a person typed, so building markup from it is safe. */
(function (root, make) {
  const house = make();
  if (typeof module === "object" && module.exports) module.exports = house; else root.LumiPetHouse = house;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LAYERS = ["wallpaper", "floor", "door", "wallart", "trophy", "shelf", "view", "frame", "curtains", "ceiling", "lamp", "sidetable", "plant", "rug", "toychest", "bed"];
  const GLOW = "var(--pet-glow)"; // Accents follow Lumi's own glow colour, so the room always suits her.

  // ---- Small drawing helpers: each returns a piece of SVG markup.
  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function path(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function line(x1, y1, x2, y2, stroke, width, more) { return '<path d="M' + x1 + " " + y1 + " L" + x2 + " " + y2 + '" fill="none" stroke="' + stroke + '" stroke-width="' + (width || 1) + '" ' + (more || "") + "/>"; }
  function group(inner, more) { return "<g " + (more || "") + ">" + inner + "</g>"; }
  function star(x, y, r) { // A four-pointed sparkle, like the one on Lumi's forehead.
    const s = r * 0.28;
    return "M" + x + " " + (y - r) + " L" + (x + s) + " " + (y - s) + " L" + (x + r) + " " + y + " L" + (x + s) + " " + (y + s) + " L" + x + " " + (y + r) +
      " L" + (x - s) + " " + (y + s) + " L" + (x - r) + " " + y + " L" + (x - s) + " " + (y - s) + "Z";
  }
  function dice(seed) { // The same "random" scatter every time, so a wallpaper doesn't reshuffle on each redraw.
    let value = seed;
    return function (low, high) { value = (value * 16807) % 2147483647; return low + (value / 2147483647) * (high - low); };
  }
  function scatter(seed, count, draw) { // Call draw(roll) `count` times with one shared seeded dice.
    const roll = dice(seed);
    let out = "";
    for (let i = 0; i < count; i++) out += draw(roll, i);
    return out;
  }
  function round(n) { return Math.round(n * 10) / 10; }

  // ---- The window. The view is clipped to the frame's opening; a view is a sky and three strips of scenery that
  // slide sideways at different speeds (the far one slowest), which is what makes it look deep.
  const WIN = { x: 140, y: 96, w: 120, h: 130 }, TILE = 240; // The opening's box, and the width a strip repeats over.
  const CLIPS = { // The opening of each window frame.
    "frame-arch": "M140 226 V150 A60 54 0 0 1 260 150 V226 Z",
    "frame-round": "M140 161 A60 60 0 1 0 260 161 A60 60 0 1 0 140 161 Z",
    "frame-panes": "M140 100 H260 V226 H140 Z",
    "frame-hex": "M200 96 L258 128 V194 L200 226 L142 194 V128 Z",
    "frame-ears": "M140 226 V140 L150 100 L178 124 Q200 116 222 124 L250 100 L260 140 V226 Z",
    "frame-lattice": "M200 96 L260 161 L200 226 L140 161 Z",
    "frame-heart": "M200 226 C160 196 140 168 140 134 C140 108 158 96 176 96 C188 96 197 103 200 114 C203 103 212 96 224 96 C242 96 260 108 260 134 C260 168 240 196 200 226 Z",
    "frame-cloud": "M156 214 C142 214 140 198 148 190 C138 180 140 162 154 158 C150 138 170 126 184 134 C188 112 222 108 230 132 C246 126 262 142 254 158 C264 168 260 190 248 192 C256 204 248 216 236 214 Z",
    "frame-cottage": "M148 106 H252 V226 H148 Z",
    "frame-star": "M200 96 L218 138 L260 146 L228 174 L238 220 L200 196 L162 220 L172 174 L140 146 L182 138 Z",
    "frame-keyhole": "M180 226 L186 170 A36 36 0 1 1 214 170 L220 226 Z",
    "frame-lancet": "M144 226 V144 Q144 120 160 108 Q176 120 176 144 V226 H184 V132 Q184 110 200 96 Q216 110 216 132 V226 H224 V144 Q224 120 240 108 Q256 120 256 144 V226 Z",
    "frame-rose": "M140 161 A60 65 0 1 0 260 161 A60 65 0 1 0 140 161 Z",
    "frame-geode": "M198 96 L226 104 L240 98 L256 124 L250 146 L260 172 L246 196 L250 216 L222 222 L204 226 L180 220 L156 224 L146 200 L150 178 L140 156 L150 134 L144 112 L170 108 Z",
    "frame-orrery": "M140 161 A60 60 0 1 0 260 161 A60 60 0 1 0 140 161 Z",
    "frame-worn": "M144 102 H256 V224 H144 Z",
    "frame-shrine-torii": "M148 226 V113 Q200 106 252 113 V226 Z",
    "frame-crystal-gem": "M166 98 H234 L262 138 L200 226 L138 138 Z",
    "frame-mushroom-cap": "M140 152 Q140 96 200 96 Q260 96 260 152 Q248 160 234 156 V226 H166 V156 Q152 160 140 152 Z",
    "frame-skylib-book": "M142 112 Q172 100 198 109 L200 113 L202 109 Q228 100 258 112 V224 Q228 214 202 222 L200 226 L198 222 Q172 214 142 224 Z",
    "frame-sunken-portico": "M150 226 V136 L200 106 L250 136 V226 Z",
    "frame-clockwork-cog": "M191.9 109.6 L194.6 99.2 L205.4 99.2 L208.1 109.6 A52 52 0 0 1 218.6 112.5 L226.2 104.8 L235.6 110.2 L232.7 120.6 A52 52 0 0 1 240.4 128.3 L250.8 125.4 L256.2 134.8 L248.5 142.4 A52 52 0 0 1 251.4 152.9 L261.8 155.6 L261.8 166.4 L251.4 169.1 A52 52 0 0 1 248.5 179.6 L256.2 187.2 L250.8 196.6 L240.4 193.7 A52 52 0 0 1 232.7 201.4 L235.6 211.8 L226.2 217.2 L218.6 209.5 A52 52 0 0 1 208.1 212.4 L205.4 222.8 L194.6 222.8 L191.9 212.4 A52 52 0 0 1 181.4 209.5 L173.8 217.2 L164.4 211.8 L167.3 201.4 A52 52 0 0 1 159.6 193.7 L149.2 196.6 L143.8 187.2 L151.5 179.6 A52 52 0 0 1 148.6 169.1 L138.2 166.4 L138.2 155.6 L148.6 152.9 A52 52 0 0 1 151.5 142.4 L143.8 134.8 L149.2 125.4 L159.6 128.3 A52 52 0 0 1 167.3 120.6 L164.4 110.2 L173.8 104.8 L181.4 112.5 A52 52 0 0 1 191.9 109.6 Z",
    "frame-candy-arch": "M144 226 V152 Q144 116 200 96 Q256 116 256 152 V226 Z",
    "frame-attic-dormer": "M142 226 V146 L200 100 L258 146 V226 Z",
    "frame-starship-hatch": "M155 102 L234 95 L254 111 L262 201 L245 220 L166 227 L146 211 L138 121 Z",
    "frame-arcade-cabinet": "M154 100 H246 Q260 100 260 114 V212 Q260 226 246 226 H154 Q140 226 140 212 V114 Q140 100 154 100 Z",
    "frame-datavault-port": "M158 96 H242 L260 114 V208 L242 226 H158 L140 208 V114 Z",
    "frame-rooftop-greenhouse": "M140 226 V138 L200 98 L260 138 V226 Z",
  };

  function strip(depth, tile) { // One sliding strip: its tile drawn twice side by side, so the loop has no seam.
    return group(tile + group(tile, 'transform="translate(' + TILE + ' 0)"'), 'class="lp-px lp-px-' + depth + '"');
  }
  function falling(kind, tile) { // Rain or snow: a tile drawn twice, one above the other, sliding down.
    return group(group(tile, 'transform="translate(0 -' + WIN.h + ')"') + tile, 'class="lp-fall lp-fall-' + kind + '"');
  }
  function view(day, night, sunY, far, mid, near, extra) { // A whole view, in the window's own coordinates.
    const id = "lp-sky-" + day[0].slice(1);
    return group(
      "<defs>" + [["d", day], ["n", night]].map(function (sky) {
        return '<linearGradient id="' + id + sky[0] + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sky[1][0] + '"/><stop offset="1" stop-color="' + sky[1][1] + '"/></linearGradient>';
      }).join("") + "</defs>" +
      rect(0, 0, WIN.w, WIN.h, "url(#" + id + "n)") + rect(0, 0, WIN.w, WIN.h, "url(#" + id + "d)", 'class="lp-sky-day"') +
      scatter(7, 14, function (roll) { return circle(round(roll(4, 116)), round(roll(4, 70)), round(roll(.4, 1)), "#fff", 'class="lp-sky-star"'); }) +
      circle(88, sunY, 9, "#ffe3a9", 'class="lp-sun"') +
      strip(1, far) + strip(2, mid) + strip(3, near) + (extra || "") +
      rect(0, 0, WIN.w, WIN.h, "#0a0a2a", 'class="lp-night-veil"'),
      'transform="translate(' + WIN.x + " " + WIN.y + ')"');
  }
  function skyline(seed, base, low, high, fill, lit) { // A row of buildings across one tile, some with lit windows.
    let x = 0, out = "";
    const roll = dice(seed);
    while (x < TILE) {
      const w = Math.round(roll(12, 26)), h = Math.round(roll(low, high));
      out += rect(x, base - h, w + 1, h + 40, fill);
      if (lit) for (let wy = base - h + 5; wy < base - 4; wy += 9) for (let wx = x + 3; wx < x + w - 4; wx += 7) if (roll(0, 1) > .55) out += rect(wx, wy, 3, 4, lit);
      x += w;
    }
    return out;
  }
  function hills(seed, base, height, fill) { // Soft rolling hills across one tile, ending where they began.
    const roll = dice(seed), step = TILE / 4;
    let d = "M0 " + base;
    for (let i = 0; i < 4; i++) d += " Q" + (i * step + step / 2) + " " + round(base - roll(height * .5, height)) * 1 + " " + ((i + 1) * step) + " " + base;
    return path(d + " V140 H0 Z", fill);
  }
  function pines(seed, base, size, fill, gap) { // A line of pine trees.
    return scatter(seed, Math.floor(TILE / gap), function (roll, i) {
      const x = i * gap + roll(0, gap * .4), h = roll(size * .7, size), w = h * .45;
      return path("M" + round(x) + " " + base + " L" + round(x + w / 2) + " " + round(base - h) + " L" + round(x + w) + " " + base + " Z", fill);
    }) + rect(0, base - 1, TILE, 60, fill);
  }
  function waves(base, fill, swell) { // A band of sea with a scalloped top that tiles exactly.
    let d = "M0 " + base;
    for (let x = 0; x < TILE; x += 20) d += " q5 -" + swell + " 10 0 t10 0";
    return path(d + " V140 H0 Z", fill);
  }

  // ---- Every object, by its catalog id.
  const ART = {
    // Wallpaper: the wall fills the room down to the floor line at y = 352.
    "wall-dusk": function () { return rect(0, 0, 400, 352, "#2a1a3e") + oval(200, 300, 270, 170, "#562452", 'opacity=".55"'); },
    "wall-stars": function () {
      return rect(0, 0, 400, 352, "#161a36") + scatter(11, 46, function (roll) {
        const x = round(roll(8, 392)), y = round(roll(8, 340)), r = roll(0, 1);
        return r > .8 ? path(star(x, y, 5), "#ffe9a8", 'opacity=".8"') : circle(x, y, round(.6 + r), "#e6d5ff", 'opacity="' + round(.3 + r * .6) + '"');
      });
    },
    "wall-stripes": function () {
      let out = rect(0, 0, 400, 352, "#3a2147");
      for (let x = 10; x < 400; x += 40) out += rect(x, 0, 20, 352, "#4b2a59");
      return out + rect(0, 300, 400, 52, "#2d1a38") + rect(0, 298, 400, 3, "#6d4580");
    },
    "wall-clouds": function () {
      return rect(0, 0, 400, 352, "#2b3157") + scatter(5, 7, function (roll) {
        const x = roll(20, 380), y = roll(30, 320), s = roll(.7, 1.3);
        return group(oval(0, 0, 26, 11, "#3d4675") + oval(-14, -7, 14, 10, "#3d4675") + oval(10, -9, 16, 12, "#3d4675"), 'transform="translate(' + round(x) + " " + round(y) + ") scale(" + round(s) + ')"');
      });
    },
    "wall-grid": function () {
      let out = rect(0, 0, 400, 352, "#120f2a");
      for (let x = 0; x <= 400; x += 40) out += line(x, 0, x, 352, GLOW, 1, 'opacity=".22"');
      for (let y = 32; y <= 352; y += 40) out += line(0, y, 400, y, GLOW, 1, 'opacity=".22"');
      return out + rect(0, 0, 400, 352, "#120f2a", 'opacity=".25"');
    },

    // Floor: from y = 350 down, with a skirting line where it meets the wall.
    "floor-boards": function () {
      let out = rect(0, 350, 400, 150, "#1c1326") + rect(0, 350, 400, 3, "#dc9bca", 'opacity=".25"');
      for (let y = 378; y < 500; y += 28) out += line(0, y, 400, y, "#2c1f3a", 1.5);
      return out;
    },
    "floor-checker": function () {
      let out = rect(0, 350, 400, 150, "#2a2238");
      for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) if ((row + col) % 2) out += rect(col * 50, 350 + row * 50, 50, 50, "#3b3152");
      return out + rect(0, 350, 400, 3, "#8a7aa8", 'opacity=".5"');
    },
    "floor-honey": function () {
      let out = rect(0, 350, 400, 150, "#6b4a2f") + rect(0, 350, 400, 3, "#d9b27c", 'opacity=".6"');
      for (let y = 380, i = 0; y < 500; y += 30, i++) { out += line(0, y, 400, y, "#54391f", 1.5); for (let x = (i % 2) * 60 + 40; x < 400; x += 120) out += line(x, y - 30, x, y, "#54391f", 1.5); }
      return out;
    },
    "floor-moss": function () {
      return rect(0, 350, 400, 150, "#23402f") + scatter(3, 90, function (roll) { return circle(round(roll(0, 400)), round(roll(356, 498)), round(roll(1, 3)), "#2f5a3f"); }) + rect(0, 350, 400, 3, "#7fc49a", 'opacity=".4"');
    },
    "floor-starglass": function () {
      return rect(0, 350, 400, 150, "#141a3a") + oval(200, 430, 230, 60, GLOW, 'opacity=".12"') + scatter(9, 26, function (roll) {
        return path(star(round(roll(10, 390)), round(roll(360, 494)), round(roll(2, 5))), "#cfe0ff", 'opacity="' + round(roll(.3, .8)) + '"');
      }) + rect(0, 350, 400, 3, GLOW, 'opacity=".5"');
    },

    // Wall art: on the left wall.
    "art-star": function () { return rect(38, 150, 60, 76, "#1a1430", 'stroke="#9c73b8" stroke-width="3" rx="3"') + path(star(68, 188, 22), "#ffe9a8"); },
    "art-moons": function () {
      let out = rect(26, 164, 86, 34, "#101630", 'stroke="#8fa2d8" stroke-width="2.5" rx="3"');
      [0, 1, 2, 3, 4].forEach(function (i) { out += circle(41 + i * 14, 181, 5, "#f0deff") + circle(41 + i * 14 + (i - 2) * 3.4, 181, i === 2 ? 0 : 5, "#101630"); });
      return out;
    },
    "art-portrait": function () {
      return rect(36, 146, 64, 82, "#d9b24a", 'rx="5"') + rect(42, 152, 52, 70, "#3a2147") + path("M52 190 L52 166 L62 176 Q68 173 74 176 L84 166 L84 190 Q84 208 68 208 Q52 208 52 190Z", "#fce1f2") +
        circle(61, 190, 2, "#462846") + circle(75, 190, 2, "#462846");
    },
    "art-heart": function () {
      return path("M68 212 C40 190 44 162 60 162 Q68 162 68 172 Q68 162 76 162 C92 162 96 190 68 212Z", "none", 'stroke="' + GLOW + '" stroke-width="4" stroke-linejoin="round" class="lp-neon"');
    },
    "art-constellation": function () {
      const dots = [[48, 162], [60, 176], [78, 170], [90, 186], [72, 198], [52, 210], [84, 214]];
      return rect(36, 148, 66, 80, "#0d1230", 'stroke="#6f7fc0" stroke-width="2.5" rx="3"') +
        path("M" + dots.map(function (p) { return p.join(" "); }).join(" L"), "none", 'stroke="#8fa2d8" stroke-width="1" opacity=".7"') +
        dots.map(function (p, i) { return i % 3 ? circle(p[0], p[1], 2, "#fff") : path(star(p[0], p[1], 5), "#ffe9a8"); }).join("");
    },

    // Shelf: a board on the right wall, with things on it.
    "shelf-books": function () {
      const spines = ["#c85a8e", "#70ebea", "#ffdc83", "#9c73b8", "#7fc49a", "#e98a5a"];
      let x = 302, out = "";
      spines.forEach(function (colour, i) { const w = 8 + (i * 3) % 5, h = 26 + (i * 7) % 12; out += rect(x, 200 - h, w, h, colour, 'rx="1"'); x += w + 1; });
      return out + path("M" + (x + 2) + " 200 l10 -24 l8 3 l-10 21 Z", "#8fa2d8") + ART.board();
    },
    "shelf-plants": function () {
      return [312, 337, 362].map(function (x, i) {
        const leaf = ["#7fc49a", "#5fae86", "#9bd6ae"][i];
        return oval(x - 5, 180 - i * 2, 4, 10, leaf, 'transform="rotate(-25 ' + (x - 5) + " 180)\"") + oval(x + 5, 180 - i * 2, 4, 10, leaf, 'transform="rotate(25 ' + (x + 5) + " 180)\"") +
          oval(x, 174 - i * 3, 4, 12, leaf) + path("M" + (x - 8) + " 186 h16 l-2 14 h-12 Z", "#c0764f");
      }).join("") + ART.board();
    },
    "shelf-trophies": function () {
      return [314, 338, 362].map(function (x, i) {
        const tall = [0, 8, 3][i];
        return path("M" + (x - 8) + " " + (172 - tall) + " h16 q0 14 -8 16 q-8 -2 -8 -16 Z", "#ffdc83") + rect(x - 1.5, 187 - tall, 3, 8 + tall, "#d9b24a") + rect(x - 6, 196, 12, 4, "#8a6a2a") +
          path(star(x, 178 - tall, 4), "#fff8dc");
      }).join("") + ART.board();
    },
    "shelf-crystals": function () {
      return [[310, "#70ebea", 26], [326, "#ff8ecb", 18], [344, "#b9a2ff", 32], [362, "#ffdc83", 20]].map(function (c) {
        return path("M" + (c[0] - 7) + " 200 L" + (c[0] - 4) + " " + (200 - c[2] * .7) + " L" + c[0] + " " + (200 - c[2]) + " L" + (c[0] + 5) + " " + (200 - c[2] * .6) + " L" + (c[0] + 7) + " 200 Z", c[1], 'opacity=".85" class="lp-neon"');
      }).join("") + ART.board();
    },
    "shelf-plushies": function () {
      return [[314, "#ffb3d1"], [338, "#b9e4ff"], [362, "#ffe9a8"]].map(function (p) {
        const x = p[0];
        return circle(x - 6, 177, 4, p[1]) + circle(x + 6, 177, 4, p[1]) + oval(x, 190, 10, 10, p[1]) + circle(x, 182, 8, p[1]) + circle(x - 3, 181, 1.2, "#462846") + circle(x + 3, 181, 1.2, "#462846");
      }).join("") + ART.board();
    },
    board: function () { return rect(296, 200, 82, 6, "#7a5a8c", 'rx="2"') + path("M304 206 l6 10 M370 206 l-6 10", "none", 'stroke="#7a5a8c" stroke-width="3" stroke-linecap="round"'); },

    // Window views.
    "view-city": function () {
      return view(["#7a4b9c", "#e88aa5"], ["#12132d", "#3b2a57"], 30, skyline(21, 96, 34, 62, "#4a3580"), skyline(33, 110, 30, 58, "#2e2160", "#ffd97a"), skyline(45, 128, 12, 30, "#17102f", "#70ebea"));
    },
    "view-sea": function () {
      return view(["#4a6cc0", "#f2b5a0"], ["#0b1030", "#1c2f66"], 26, hills(8, 84, 18, "#3d5a9c"), waves(92, "#2a5c94", 3),
        waves(108, "#1a3d6e", 4) + scatter(4, 9, function (roll) { return path(star(round(roll(6, 234)), round(roll(114, 128)), 2.4), "#cfe8ff", 'opacity=".8"'); }));
    },
    "view-forest": function () {
      return view(["#5a9ec0", "#f6dca0"], ["#0f1c2e", "#23405a"], 28, hills(14, 86, 30, "#3f7a66"), pines(15, 104, 34, "#27584a", 16), pines(16, 126, 46, "#143229", 22));
    },
    "view-snow": function () {
      return view(["#8fb4e0", "#f4e4ef"], ["#141a3a", "#3a4a7a"], 26, hills(31, 80, 46, "#b8cdea"), hills(32, 100, 24, "#dbe8f7"), hills(33, 120, 14, "#f4f9ff") + pines(34, 122, 16, "#6f8fb0", 60),
        falling("snow", scatter(6, 22, function (roll) { return circle(round(roll(0, 120)), round(roll(0, 130)), round(roll(.8, 1.8)), "#fff", 'opacity=".9"'); })));
    },
    "view-rain": function () {
      return view(["#6d7a96", "#a9a4b8"], ["#12151f", "#2b3040"], 24, skyline(51, 92, 26, 50, "#59627a"), skyline(52, 108, 18, 34, "#3d4458", "#ffd97a"),
        skyline(53, 126, 8, 18, "#232733") + scatter(54, 5, function (roll, i) { return rect(20 + i * 48, 100, 7, 16, "#232733"); }),
        falling("rain", scatter(2, 26, function (roll) { const x = round(roll(0, 124)), y = round(roll(0, 122)); return line(x, y, x - 2, y + 8, "#cfe0ff", .8, 'opacity=".6"'); })));
    },

    // Window frames: drawn over the view. Each has a sill.
    "frame-arch": function () { return path(CLIPS["frame-arch"], "none", 'stroke="#9c73b8" stroke-width="5" stroke-linejoin="round"') + line(200, 96, 200, 226, "#9c73b8", 3) + ART.sill("#9c73b8"); },
    "frame-round": function () { return path(CLIPS["frame-round"], "none", 'stroke="#c9a15a" stroke-width="7"') + line(200, 101, 200, 221, "#c9a15a", 3) + line(140, 161, 260, 161, "#c9a15a", 3) + [0, 1, 2, 3].map(function (i) { const a = Math.PI / 4 + i * Math.PI / 2; return circle(round(200 + 60 * Math.cos(a)), round(161 + 60 * Math.sin(a)), 3, "#8a6a2a"); }).join(""); },
    "frame-panes": function () { return path(CLIPS["frame-panes"], "none", 'stroke="#e8dff0" stroke-width="5" stroke-linejoin="round"') + line(200, 100, 200, 226, "#e8dff0", 3) + line(140, 163, 260, 163, "#e8dff0", 3) + ART.sill("#e8dff0"); },
    "frame-hex": function () { return path(CLIPS["frame-hex"], "none", 'stroke="#ffdc83" stroke-width="5" stroke-linejoin="round"') + path("M200 96 V226 M142 128 L258 194 M258 128 L142 194", "none", 'stroke="#ffdc83" stroke-width="2" opacity=".7"'); },
    "frame-ears": function () { return path(CLIPS["frame-ears"], "none", 'stroke="' + GLOW + '" stroke-width="5" stroke-linejoin="round"') + path("M153 112 L158 128 L168 122 Z M247 112 L242 128 L232 122 Z", GLOW, 'opacity=".7"') + ART.sill(GLOW); },
    sill: function (colour) { return rect(131, 224, 138, 8, colour, 'rx="3"'); },

    // Curtains: in front of the frame.
    "curtain-none": function () { return ""; },
    "curtain-rose": function () { return ART.rod() + path("M126 88 H168 Q150 150 162 236 H126 Z", "#c85a8e", 'opacity=".92"') + path("M274 88 H232 Q250 150 238 236 H274 Z", "#c85a8e", 'opacity=".92"') + path("M140 88 Q142 160 138 236 M260 88 Q258 160 262 236", "none", 'stroke="#8f3a66" stroke-width="2"'); },
    "curtain-sheer": function () { return ART.rod() + path("M126 88 H274 V236 Q250 244 226 236 Q200 228 174 236 Q150 244 126 236 Z", "#70ebea", 'opacity=".22"') + path("M150 88 V238 M175 88 V234 M200 88 V232 M225 88 V234 M250 88 V238", "none", 'stroke="#d2fcf6" stroke-width="1" opacity=".35"'); },
    "curtain-valance": function () { return ART.rod() + path("M124 86 H276 V104 q-9.5 14 -19 0 q-9.5 14 -19 0 q-9.5 14 -19 0 q-9.5 14 -19 0 q-9.5 14 -19 0 q-9.5 14 -19 0 q-9.5 14 -19 0 q-9.5 14 -19 0 Z", "#6d4bb0") + [143, 181, 219, 257].map(function (x) { return path(star(x, 97, 5), "#ffe9a8"); }).join(""); },
    "curtain-beads": function () { // Strings long at the sides and short in the middle, so the view stays clear.
      let out = ART.rod();
      for (let x = 132, i = 0; x <= 268; x += 12, i++) { const length = 16 + Math.pow(Math.abs(5.5 - i), 2) * 4.4; for (let y = 96; y < 88 + length; y += 9) out += circle(x, y, 2.4, ["#ff8ecb", "#70ebea", "#ffdc83"][(i + Math.round(y / 9)) % 3], 'opacity=".9"'); }
      return out;
    },
    rod: function () { return rect(120, 84, 160, 5, "#d9b24a", 'rx="2.5"') + circle(120, 86.5, 5, "#d9b24a") + circle(280, 86.5, 5, "#d9b24a"); },

    // Lamps: on the left.
    "lamp-floor": function () { return oval(52, 300, 60, 70, "#ffdc83", 'opacity=".1"') + rect(50, 268, 4, 132, "#8a7aa8") + oval(52, 400, 16, 5, "#8a7aa8") + path("M34 270 L42 240 H62 L70 270 Z", "#ffdc83", 'opacity=".9"'); },
    "lamp-lantern": function () { return line(56, 60, 56, 232, "#8a7aa8", 1.5) + oval(56, 256, 46, 46, "#ff9d6b", 'opacity=".12"') + oval(56, 256, 20, 26, "#ff9d6b", 'opacity=".92"') + path("M40 246 H72 M38 256 H74 M40 266 H72", "none", 'stroke="#c96a3e" stroke-width="1.2"') + rect(50, 229, 12, 4, "#5a3a2a") + rect(50, 280, 12, 4, "#5a3a2a"); },
    "lamp-mushroom": function () { return oval(56, 392, 44, 30, "#ff8e8e", 'opacity=".14"') + path("M48 404 Q46 382 52 378 H60 Q66 382 64 404 Z", "#fff1e0") + path("M30 380 Q56 338 82 380 Q56 388 30 380 Z", "#e8556a") + circle(46, 368, 4, "#fff") + circle(60, 360, 3, "#fff") + circle(68, 372, 3.5, "#fff") + oval(56, 405, 14, 3, "#00000055"); },
    "lamp-lava": function () { return oval(54, 372, 34, 50, GLOW, 'opacity=".12"') + path("M46 404 L50 340 H58 L62 404 Z", GLOW, 'opacity=".35"') + circle(54, 390, 5, GLOW) + circle(53, 372, 3.5, GLOW) + circle(55, 356, 2.5, GLOW) + path("M44 404 H64 L60 414 H48 Z", "#8a7aa8") + path("M49 340 H59 L57 330 H51 Z", "#8a7aa8"); },
    "lamp-fairy": function () {
      const lights = [28, 62, 96, 130, 164, 200, 236, 270, 304, 338, 372];
      return path("M10 62 Q105 92 200 70 Q295 92 390 62", "none", 'stroke="#5a4a70" stroke-width="1.2"') + lights.map(function (x, i) {
        const y = round(66 + 12 * Math.sin((x - 10) / 380 * Math.PI * 2 - Math.PI / 2) * -1 + 8), colour = ["#ffdc83", "#ff8ecb", "#70ebea"][i % 3];
        return circle(x, y, 7, colour, 'opacity=".18"') + circle(x, y, 2.8, colour, 'class="lp-twinkle" style="animation-delay:' + (i * .37 % 2).toFixed(2) + 's"');
      }).join("");
    },

    // Rugs: in the middle of the floor, under Lumi.
    "rug-oval": function () { return oval(200, 440, 152, 36, "#c18ab8", 'opacity=".08"') + oval(200, 440, 140, 30, "#2d1d3d", 'stroke="#e5b5d4" stroke-opacity=".3" stroke-width="2"'); },
    "rug-moon": function () { return oval(200, 440, 120, 30, "#f0e6c8") + oval(228, 434, 96, 24, "#d8cba0") + oval(160, 446, 8, 3, "#d8cba0") + oval(140, 434, 5, 2, "#d8cba0"); },
    "rug-star": function () { return group(path(star(0, 0, 150), "#ffdc83") + path(star(0, 0, 96), "#fff1cd"), 'transform="translate(200 440) scale(1 .27)"'); },
    "rug-rainbow": function () { return ["#e8556a", "#ff9d6b", "#ffdc83", "#7fc49a", "#70b8eb", "#9c73b8"].map(function (colour, i) { return rect(70, 414 + i * 9, 260, 9.5, colour, i === 0 || i === 5 ? 'rx="3"' : ""); }).join(""); },
    "rug-paw": function () { return oval(200, 446, 86, 22, "#ffb3d1") + [[-70, -8], [-26, -20], [26, -20], [70, -8]].map(function (p) { return oval(200 + p[0], 432 + p[1] * .6, 22, 8, "#ffb3d1"); }).join("") + oval(200, 448, 44, 11, "#ff8ecb", 'opacity=".5"'); },

    // Beds: on the right of the floor.
    "bed-cushion": function () { return oval(340, 438, 50, 15, "#6d3b7a") + oval(340, 434, 42, 11, "#8d4f9c") + oval(340, 433, 24, 5, "#a468b3"); },
    "bed-basket": function () { return path("M294 424 Q340 446 386 424 L378 446 Q340 462 302 446 Z", "#a8743f") + oval(340, 424, 46, 11, "#c79256") + oval(340, 425, 38, 8, "#f6dcc0") + path("M304 436 Q340 452 376 436 M300 430 Q340 448 380 430", "none", 'stroke="#8a5a2a" stroke-width="1.5"'); },
    "bed-cloud": function () { return oval(340, 440, 50, 12, "#cfd8f7") + circle(312, 432, 14, "#eef2ff") + circle(334, 424, 18, "#fff") + circle(358, 428, 16, "#eef2ff") + circle(374, 436, 10, "#fff") + oval(340, 440, 42, 9, "#fff"); },
    "bed-moon": function () { return oval(340, 448, 30, 5, "#00000055") + path("M300 400 Q300 448 344 448 Q380 448 384 414 Q372 436 346 434 Q314 432 300 400 Z", "#ffdc83") + path(star(372, 398, 7), "#fff1cd") + path("M322 448 L340 458 L358 448", "none", 'stroke="#d9b24a" stroke-width="3" stroke-linecap="round"'); },
    "bed-castle": function () { return path("M298 448 V398 h12 v8 h12 v-8 h12 v8 h12 v-8 h12 v8 h12 v-8 h12 V448 Z", "#c79256") + path("M328 448 V428 a12 12 0 0 1 24 0 V448 Z", "#3a2147") + rect(306, 414, 9, 10, "#3a2147") + rect(365, 414, 9, 10, "#3a2147") + path("M298 420 H382", "none", 'stroke="#a8743f" stroke-width="1.2" stroke-dasharray="6 5"') + path("M340 398 V380 l14 5 l-14 5", "#ff8ecb", 'stroke="#8a5a2a" stroke-width="1.5"'); },

    // Doors: on the wall to the left, between the side window and the wall art. They stand on the floor line (y = 352).
    "door-plum": function () { return rect(-62, 196, 74, 158, "#3d2450", 'rx="3"') + rect(-56, 202, 62, 152, "#5a3570") + rect(-48, 212, 46, 56, "#6d4585", 'rx="2"') + rect(-48, 280, 46, 62, "#6d4585", 'rx="2"') + circle(-2, 278, 4, "#ffdc83"); },
    "door-round": function () { return path("M-62 354 V232 A37 37 0 0 1 12 232 V354 Z", "#3a5a52") + path("M-56 354 V232 A31 31 0 0 1 6 232 V354 Z", "#4f7a70") + circle(-25, 236, 15, "#bfe8ff", 'stroke="#3a5a52" stroke-width="3"') + path("M-25 221 V251 M-40 236 H-10", "none", 'stroke="#3a5a52" stroke-width="2"') + circle(-4, 290, 4, "#ffdc83"); },
    "door-catflap": function () { return rect(-62, 196, 74, 158, "#7a4a2a", 'rx="3"') + rect(-56, 202, 62, 152, "#a8743f") + rect(-48, 212, 46, 70, "#b98550", 'rx="2"') + circle(-2, 284, 4, "#ffdc83") + rect(-42, 306, 34, 40, "#54391f", 'rx="5"') + rect(-39, 309, 28, 34, "#2a1a3e", 'rx="4"') + path("M-34 322 l5 -8 l4 6 l4 -6 l5 8 q0 10 -9 10 q-9 0 -9 -10Z", "#fce1f2", 'opacity=".9"'); },
    "door-beads": function () {
      let out = rect(-62, 196, 74, 158, "#3d2450", 'rx="3"') + rect(-56, 202, 62, 152, "#120f2a");
      for (let x = -52, i = 0; x <= 2; x += 9, i++) for (let y = 208; y < 344 - (i % 3) * 14; y += 9) out += circle(x, y, 2.6, ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff"][(i + Math.round(y / 9)) % 4], 'opacity=".9"');
      return out;
    },
    "door-portal": function () { return oval(-25, 276, 44, 84, GLOW, 'opacity=".12"') + oval(-25, 276, 36, 76, "#120f2a", 'stroke="' + GLOW + '" stroke-width="4" class="lp-neon"') + oval(-25, 276, 24, 56, "none", 'stroke="' + GLOW + '" stroke-width="2" opacity=".5"') + oval(-25, 276, 12, 32, "none", 'stroke="' + GLOW + '" stroke-width="1.5" opacity=".35"') +
      [[-36, 236, 5], [-12, 262, 4], [-32, 296, 6], [-16, 322, 4]].map(function (s, i) { return path(star(s[0], s[1], s[2]), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .5) + 's"'); }).join(""); },

    // Ceiling hangings: from the top of the wall, above the shelf.
    "hang-stars": function () { return path("M306 0 V46 M330 0 V70 M354 0 V52 M306 46 H354", "none", 'stroke="#8a7aa8" stroke-width="1.2"') + path(star(306, 56, 9), "#ffdc83") + path(star(330, 82, 12), "#fff1cd") + path(star(354, 62, 8), "#ff8ecb"); },
    "hang-cranes": function () { return [[304, 50, "#ff8ecb"], [330, 78, "#70ebea"], [356, 44, "#ffdc83"]].map(function (c) {
      return line(c[0], 0, c[0], c[1] - 8, "#8a7aa8", 1) + path("M" + (c[0] - 14) + " " + c[1] + " L" + c[0] + " " + (c[1] - 9) + " L" + (c[0] + 16) + " " + (c[1] - 4) + " L" + (c[0] + 2) + " " + (c[1] + 2) + " L" + (c[0] + 6) + " " + (c[1] + 10) + " L" + (c[0] - 4) + " " + (c[1] + 3) + " Z", c[2]) + path("M" + c[0] + " " + (c[1] - 9) + " L" + (c[0] + 2) + " " + (c[1] + 2), "none", 'stroke="#00000033" stroke-width="1"');
    }).join(""); },
    "hang-planets": function () { return line(304, 0, 304, 40, "#8a7aa8", 1) + line(332, 0, 332, 66, "#8a7aa8", 1) + line(358, 0, 358, 36, "#8a7aa8", 1) + circle(304, 50, 10, "#ff9d6b") + oval(304, 50, 17, 4, "none", 'stroke="#ffe0b0" stroke-width="2" transform="rotate(-18 304 50)"') + circle(332, 80, 14, "#70b8eb") + path("M322 76 q8 -6 14 0 q-4 6 -10 4 Z", "#7fc49a") + circle(358, 44, 8, "#c9a8ff") + circle(355, 41, 2, "#fff", 'opacity=".6"'); },
    "hang-basket": function () { return path("M316 0 L310 58 M344 0 L350 58 M330 0 V56", "none", 'stroke="#c79256" stroke-width="1.5"') + path("M306 58 H354 L346 84 H314 Z", "#a8743f") + oval(330, 58, 24, 6, "#5fae86") + path("M312 58 Q300 84 306 104 M322 60 Q318 90 326 110 M340 60 Q346 86 338 102 M350 58 Q362 78 356 96", "none", 'stroke="#7fc49a" stroke-width="3" stroke-linecap="round"') + [[306, 104], [326, 110], [338, 102], [356, 96]].map(function (l) { return oval(l[0], l[1], 4, 6, "#9bd6ae"); }).join(""); },
    "hang-disco": function () { return line(330, 0, 330, 44, "#8a7aa8", 1.5) + circle(330, 66, 34, "#fff", 'opacity=".07"') + circle(330, 66, 22, "#c8d2e8") + path("M308 66 H352 M311 56 H349 M311 76 H349 M318 48 H342 M318 84 H342 M330 44 V88 M320 46 V86 M340 46 V86", "none", 'stroke="#7a86a8" stroke-width="1"') + [[320, 58, "#ff8ecb"], [338, 62, "#70ebea"], [326, 74, "#ffdc83"], [340, 78, "#c9a8ff"]].map(function (t, i) { return rect(t[0] - 3, t[1] - 3, 6, 6, t[2], 'class="lp-twinkle" style="animation-delay:' + (i * .45) + 's"'); }).join(""); },

    // Side tables: against the wall under the shelf.
    "table-tea": function () { return ART.table("#7a5a8c") + path("M322 312 h18 q0 12 -9 12 q-9 0 -9 -12 Z", "#fff1e0") + path("M340 314 q7 0 6 5 q-1 4 -6 3", "none", 'stroke="#fff1e0" stroke-width="2"') + path("M327 308 q-3 -5 0 -9 M335 308 q3 -5 0 -9", "none", 'stroke="#fff" stroke-width="1.2" opacity=".5" stroke-linecap="round"') + oval(331, 324, 13, 3, "#e8dff0"); },
    "table-books": function () { return [["#c85a8e", 350, 40], ["#70ebea", 342, 36], ["#ffdc83", 334, 42], ["#9c73b8", 326, 34], ["#7fc49a", 318, 38]].map(function (b, i) { return rect(335 - b[2] / 2 + (i % 2 ? 3 : -2), b[1], b[2], 8, b[0], 'rx="1.5"'); }).join("") + rect(316, 358, 38, 4, "#54391f") + path(star(335, 308, 6), "#ffe9a8"); },
    "table-candle": function () { return ART.table("#5a4a70") + rect(328, 300, 8, 24, "#fff1e0", 'rx="2"') + oval(332, 286, 16, 18, "#ffb84a", 'opacity=".16"') + path("M332 282 q6 8 0 16 q-6 -8 0 -16 Z", "#ffb84a", 'class="lp-twinkle"') + oval(332, 324, 10, 3, "#d9b24a"); },
    "table-radio": function () { return ART.table("#7a5a8c") + rect(314, 300, 42, 24, "#e8556a", 'rx="5"') + circle(326, 312, 7, "#3a2147") + circle(326, 312, 3, "#8a7aa8") + rect(338, 306, 13, 3, "#fff1e0") + rect(338, 312, 13, 3, "#fff1e0") + rect(338, 318, 8, 3, "#fff1e0") + line(350, 300, 360, 280, "#8a7aa8", 1.5) + circle(360, 280, 2, "#ffdc83"); },
    "table-fishbowl": function () { return ART.table("#5a4a70") + circle(335, 304, 20, "#70b8eb", 'opacity=".35" stroke="#cfe8ff" stroke-width="2"') + path("M317 300 Q335 294 353 300 A20 20 0 0 1 317 300 Z", "#70b8eb", 'opacity=".55"') + path("M330 306 q8 -6 12 0 q-4 6 -12 0 Z M330 306 l-6 -4 v8 Z", "#ff9d6b") + circle(340, 305, 1, "#2a1a3e") + circle(345, 296, 1.6, "#fff", 'opacity=".7"') + circle(348, 290, 1, "#fff", 'opacity=".7"') + rect(323, 284, 24, 3, "#cfe8ff", 'rx="1.5"'); },
    table: function (colour) { return rect(308, 324, 56, 6, colour, 'rx="2"') + rect(314, 330, 4, 32, colour) + rect(354, 330, 4, 32, colour) + rect(316, 344, 40, 3, colour, 'opacity=".7"'); },

    // Plants: on the floor at the left. render() moves them right (NUDGE), to stand between the lamp and Lumi.
    "plant-fern": function () { return [-58, -36, -16, 0, 16, 36, 58].map(function (a) { return oval(18, 348, 5, 26, a % 32 ? "#5fae86" : "#7fc49a", 'transform="rotate(' + a + ' 18 372)"'); }).join("") + ART.pot("#c0764f"); },
    "plant-cactus": function () { return rect(11, 322, 14, 52, "#5fae86", 'rx="7"') + path("M11 350 h-8 q-5 0 -5 -6 v-8 M25 342 h8 q5 0 5 -6 v-6", "none", 'stroke="#5fae86" stroke-width="8" stroke-linecap="round"') + path("M18 328 v40 M14 334 v4 M22 344 v4 M14 356 v4", "none", 'stroke="#3f8a66" stroke-width="1.2"') + circle(18, 320, 4, "#ff8ecb") + ART.pot("#e8dff0"); },
    "plant-sunflower": function () { return path("M18 374 V316", "none", 'stroke="#5fae86" stroke-width="4"') + oval(8, 350, 9, 4, "#7fc49a", 'transform="rotate(-25 8 350)"') + oval(28, 340, 9, 4, "#7fc49a", 'transform="rotate(25 28 340)"') + [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) { return oval(18, 290, 5, 11, "#ffdc83", 'transform="rotate(' + a + ' 18 304)"'); }).join("") + circle(18, 304, 9, "#8a5a2a") + ART.pot("#70b8eb"); },
    "plant-bonsai": function () { return path("M18 376 Q10 356 22 346 Q32 338 26 326", "none", 'stroke="#8a5a2a" stroke-width="6" stroke-linecap="round"') + path("M22 346 Q4 344 -2 334", "none", 'stroke="#8a5a2a" stroke-width="4" stroke-linecap="round"') + oval(28, 320, 20, 10, "#3f8a66") + oval(-2, 330, 14, 8, "#5fae86") + oval(20, 312, 12, 7, "#7fc49a") + rect(0, 376, 36, 10, "#3a5a52", 'rx="2"') + rect(4, 386, 5, 4, "#3a5a52") + rect(27, 386, 5, 4, "#3a5a52"); },
    "plant-glowshroom": function () { return oval(18, 372, 34, 22, GLOW, 'opacity=".12"') + [[6, 366, 9, 20], [20, 352, 13, 34], [32, 370, 7, 14]].map(function (m, i) {
      return rect(m[0] - 2.5, m[1], 5, m[3], "#fff1e0", 'rx="2"') + path("M" + (m[0] - m[2]) + " " + m[1] + " Q" + m[0] + " " + (m[1] - m[2] * 1.5) + " " + (m[0] + m[2]) + " " + m[1] + " Z", GLOW, 'class="lp-neon lp-twinkle" style="animation-delay:' + (i * .6) + 's"');
    }).join("") + oval(18, 388, 22, 5, "#3a5a52"); },
    pot: function (colour) { return path("M4 372 H32 L28 392 H8 Z", colour) + rect(2, 368, 32, 6, colour, 'rx="2"'); },

    // Toy chests: at the front of the floor on the left.
    "chest-wood": function () { return rect(58, 440, 68, 34, "#a8743f", 'rx="3"') + path("M58 440 Q92 418 126 440 Z", "#c79256") + rect(58, 438, 68, 5, "#7a4a2a") + rect(87, 440, 10, 12, "#ffdc83", 'rx="2"') + path("M72 446 V472 M112 446 V472", "none", 'stroke="#7a4a2a" stroke-width="3"'); },
    "chest-pink": function () { return rect(58, 438, 68, 36, "#ff8ecb", 'rx="5"') + rect(58, 438, 68, 8, "#ffb3d1", 'rx="4"') + path(star(92, 460, 9), "#fff1cd") + circle(72, 432, 9, "#70ebea") + path("M100 438 l6 -16 l8 4 l-4 12 Z", "#ffdc83") + rect(82, 426, 10, 12, "#c9a8ff", 'rx="2"'); },
    "chest-yarn": function () { return path("M56 442 Q92 456 128 442 L120 474 H64 Z", "#c79256") + oval(92, 442, 36, 9, "#a8743f") + path("M62 452 Q92 464 122 452 M64 462 Q92 472 120 462", "none", 'stroke="#8a5a2a" stroke-width="1.5"') + [[76, 434, 11, "#ff8ecb"], [98, 430, 13, "#70ebea"], [114, 438, 9, "#ffdc83"]].map(function (y) { return circle(y[0], y[1], y[2], y[3]) + path("M" + (y[0] - y[2] * .7) + " " + (y[1] - 2) + " Q" + y[0] + " " + (y[1] - y[2] * .8) + " " + (y[0] + y[2] * .7) + " " + (y[1] + 2) + " M" + (y[0] - y[2] * .5) + " " + (y[1] + 4) + " Q" + y[0] + " " + (y[1] - 2) + " " + (y[0] + y[2] * .6) + " " + (y[1] + 5), "none", 'stroke="#00000030" stroke-width="1.2"'); }).join(""); },
    "chest-rocket": function () { return rect(58, 444, 68, 30, "#3d4675", 'rx="4"') + scatter(12, 7, function (roll) { return path(star(Math.round(roll(64, 120)), Math.round(roll(450, 468)), 3), "#ffe9a8"); }) + path("M92 400 Q104 414 102 444 H82 Q80 414 92 400 Z", "#e8dff0") + path("M92 400 Q98 407 100 416 H84 Q86 407 92 400 Z", "#e8556a") + circle(92, 426, 5, "#70b8eb") + path("M82 434 L72 446 H82 Z M102 434 L112 446 H102 Z", "#e8556a"); },
    "chest-treasure": function () { return rect(58, 444, 68, 30, "#7a4a2a", 'rx="3"') + path("M58 444 Q60 414 92 414 Q124 414 126 444 Z", "#8a5a2a") + path("M60 444 Q92 428 124 444 Z", "#ffdc83") + [[72, 440], [84, 436], [98, 437], [110, 440], [91, 442]].map(function (c) { return oval(c[0], c[1], 6, 3, "#ffe9a8", 'stroke="#d9b24a" stroke-width="1"'); }).join("") + path("M58 444 H126 M72 444 V474 M112 444 V474", "none", 'stroke="#ffdc83" stroke-width="3"') + rect(87, 448, 10, 12, "#ffdc83", 'rx="2"') + path(star(104, 428, 5), "#fff", 'class="lp-twinkle"'); },

    // Trophies: found in the dungeon (mnemerynne/lumidungeon.py), shown on a little bracket above the wall art.
    "trophy-none": function () { return ART.bracket(); },
    "trophy-moon-bell": function () { return ART.bracket() + path("M88 132 Q88 108 100 106 Q112 108 112 132 Z", "#f0deff") + circle(100, 133, 3, "#d9b24a") + path("M96 116 a6 6 0 1 0 8 6 a5 5 0 1 1 -8 -6", "#b9a2ff"); },
    "trophy-lantern-charm": function () { return ART.bracket() + line(100, 102, 100, 110, "#8a7aa8", 1.5) + oval(100, 121, 9, 11, "#e8556a") + path("M93 117 H107 M92 122 H108 M93 127 H107", "none", 'stroke="#b83a4e" stroke-width="1"') + rect(96, 108, 8, 3, "#5a3a2a") + rect(96, 131, 8, 3, "#5a3a2a"); },
    "trophy-singing-crystal": function () { return ART.bracket() + path("M92 134 L95 114 L100 104 L106 116 L108 134 Z", "#9be8ff", 'opacity=".9" class="lp-neon"') + path("M100 104 L101 134", "none", 'stroke="#fff" stroke-opacity=".6" stroke-width="1"'); },
    "trophy-geode-egg": function () { return ART.bracket() + oval(100, 121, 11, 13, "#6a648a") + path("M100 108 L104 116 L99 122 L104 128 L100 134 Q112 132 111 121 Q112 110 100 108 Z", "#c9a8ff") + path(star(106, 121, 3), "#fff"); },
    "trophy-golden-toadstool": function () { return ART.bracket() + rect(97, 120, 6, 14, "#fff1cd") + path("M86 121 Q100 100 114 121 Q100 126 86 121 Z", "#ffdc83") + circle(95, 115, 2, "#fff8dc") + circle(104, 112, 1.6, "#fff8dc"); },
    "trophy-spore-jar": function () { return ART.bracket() + rect(92, 112, 16, 22, "#bfe8ff", 'rx="4" opacity=".45" stroke="#cfe8ff" stroke-width="1.5"') + rect(94, 108, 12, 5, "#a8743f", 'rx="1"') + circle(97, 124, 2, "#8be9a8", 'class="lp-twinkle"') + circle(103, 119, 1.6, "#8be9a8") + circle(101, 129, 1.4, "#8be9a8"); },
    "trophy-whispering-book": function () { return ART.bracket() + path("M86 130 L100 126 L114 130 V112 L100 108 L86 112 Z", "#9c73b8") + path("M100 108 V126", "none", 'stroke="#3d2450" stroke-width="1.5"') + path("M90 116 L97 114 M90 121 L97 119 M103 114 L110 116 M103 119 L110 121", "none", 'stroke="#f0deff" stroke-width="1"') + rect(86, 130, 28, 4, "#6d4585"); },
    "trophy-bottled-cloud": function () { return ART.bracket() + path("M94 134 V116 Q94 112 97 110 V104 H103 V110 Q106 112 106 116 V134 Z", "#bfe8ff", 'opacity=".4" stroke="#cfe8ff" stroke-width="1.5"') + oval(100, 124, 5, 4, "#fff") + circle(97, 122, 3, "#fff") + circle(103, 122, 3.4, "#fff") + rect(97, 101, 6, 4, "#a8743f"); },
    "trophy-pearl-idol": function () { return ART.bracket() + path("M92 134 Q90 118 96 112 H104 Q110 118 108 134 Z", "#7fd6c8") + circle(100, 108, 6, "#7fd6c8") + circle(100, 122, 4, "#fff8f0", 'class="lp-neon"'); },
    "trophy-coral-crown": function () { return ART.bracket() + path("M88 134 V124 L92 112 L95 124 L100 108 L105 124 L108 112 L112 124 V134 Z", "#ff8e8e") + circle(92, 111, 2, "#ffb3d1") + circle(100, 107, 2, "#ffb3d1") + circle(108, 111, 2, "#ffb3d1"); },
    "trophy-brass-cog": function () { return ART.bracket() + circle(100, 120, 11, "none", 'stroke="#d9b24a" stroke-width="5" stroke-dasharray="5 3.6"') + circle(100, 120, 8, "#d9b24a") + circle(100, 120, 3, "#4a3524"); },
    "trophy-cuckoo-clock": function () { return ART.bracket() + path("M88 134 V116 L100 104 L112 116 V134 Z", "#a8743f") + circle(100, 121, 6, "#fff1cd") + path("M100 121 V117 M100 121 H103", "none", 'stroke="#4a3524" stroke-width="1.2"') + path("M86 117 L100 103 L114 117", "none", 'stroke="#7a4a2a" stroke-width="3" stroke-linejoin="round"'); },
    "trophy-lollipop": function () { return ART.bracket() + line(100, 120, 100, 134, "#fff1e0", 2.5) + circle(100, 114, 10, "#ffb3d1") + path("M100 114 m0 -7 a7 7 0 1 1 -7 7 a5 5 0 1 0 5 -5 a3 3 0 1 1 3 3", "none", 'stroke="#e8556a" stroke-width="2"'); },
    "trophy-gummy-skull": function () { return ART.bracket() + path("M89 120 Q89 106 100 106 Q111 106 111 120 Q111 127 106 128 V134 H94 V128 Q89 127 89 120 Z", "#9bd6ae", 'opacity=".9"') + circle(95, 119, 3, "#23402f") + circle(105, 119, 3, "#23402f") + path("M97 130 V134 M100 130 V134 M103 130 V134", "none", 'stroke="#23402f" stroke-width="1"'); },
    "trophy-windup-mouse": function () { return ART.bracket() + oval(100, 127, 12, 7, "#a8b4c4") + circle(91, 121, 4, "#a8b4c4") + circle(91, 121, 2, "#ffb3d1") + circle(89, 128, 1.2, "#2a1a3a") + path("M112 128 q8 0 6 -8", "none", 'stroke="#a8b4c4" stroke-width="1.5"') + path("M102 120 V112 M98 110 a4 3 0 1 0 8 0 a4 3 0 1 0 -8 0", "none", 'stroke="#d9b24a" stroke-width="1.8"'); },
    "trophy-ghost-teddy": function () { return ART.bracket() + circle(93, 109, 4, "#f0deff", 'opacity=".7"') + circle(107, 109, 4, "#f0deff", 'opacity=".7"') + circle(100, 114, 8, "#f0deff", 'opacity=".8"') + oval(100, 127, 9, 8, "#f0deff", 'opacity=".7"') + circle(97, 113, 1.2, "#3d2450") + circle(103, 113, 1.2, "#3d2450"); },
    "trophy-star-map": function () { return ART.bracket() + path("M88 134 L92 108 L110 112 L113 134 Z", "#0d1230", 'stroke="#6f7fc0" stroke-width="1.5"') + path("M95 116 L101 121 L107 117 L104 128", "none", 'stroke="#8fa2d8" stroke-width=".8"') + [[95, 116], [101, 121], [107, 117], [104, 128]].map(function (s) { return circle(s[0], s[1], 1.4, "#fff"); }).join(""); },
    "trophy-robot-head": function () { return ART.bracket() + rect(90, 114, 20, 20, "#a8b4c4", 'rx="4"') + circle(96, 123, 3, "#70ebea", 'class="lp-twinkle"') + circle(104, 123, 3, "#70ebea") + line(100, 114, 100, 106, "#a8b4c4", 2) + circle(100, 105, 2.4, "#ff7a8a") + rect(95, 129, 10, 2, "#6a7484"); },
    "trophy-score-token": function () { return ART.bracket() + circle(100, 120, 12, "#ffdc83", 'stroke="#d9b24a" stroke-width="2"') + path(star(100, 120, 7), "#fff8dc"); },
    "trophy-neon-scrap": function () { return ART.bracket() + path("M88 130 L94 112 L100 126 L106 108 L112 124", "none", 'stroke="#ff8ecb" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="lp-neon"'); },
    "trophy-data-cube": function () { return ART.bracket() + path("M100 106 L112 113 V127 L100 134 L88 127 V113 Z", "#70ebea", 'opacity=".35" class="lp-neon"') + path("M100 106 L112 113 L100 120 L88 113 Z M100 120 V134", "none", 'stroke="#70ebea" stroke-width="1.5"') + circle(100, 120, 2, "#fff", 'class="lp-twinkle"'); },
    "trophy-floppy": function () { return ART.bracket() + path("M89 110 H108 L112 114 V134 H89 Z", "#3d4675") + rect(93, 110, 11, 8, "#a8b4c4") + rect(100, 111, 3, 5, "#3d4675") + rect(93, 123, 15, 9, "#f0deff"); },
    "trophy-honey-jar": function () { return ART.bracket() + path("M91 134 Q88 122 92 114 H108 Q112 122 109 134 Z", "#ffb84a") + rect(91, 110, 18, 5, "#fff1cd", 'rx="1.5"') + path("M96 119 q4 5 8 0", "none", 'stroke="#fff1cd" stroke-width="1.5" opacity=".7"') + oval(100, 106, 4, 2.5, "#ffdc83"); },
    "trophy-snow-globe": function () { return ART.bracket() + circle(100, 117, 12, "#bfe8ff", 'opacity=".4" stroke="#cfe8ff" stroke-width="1.5"') + path("M92 124 V118 H95 V114 H99 V120 H103 V111 H107 V124 Z", "#3d4675") + circle(95, 110, 1, "#fff") + circle(104, 107, 1, "#fff") + circle(108, 116, 1, "#fff") + rect(90, 128, 20, 6, "#8a5a2a", 'rx="2"'); },
    bracket: function () { return rect(82, 134, 36, 4, "#7a5a8c", 'rx="2"') + path("M88 138 l4 7 M112 138 l-4 7", "none", 'stroke="#7a5a8c" stroke-width="2.5" stroke-linecap="round"'); },

    // ---- Star Capsule prizes: won from the capsules, never sold (the "rarity" entries in the catalog).
    // Star Capsule bed
    "bed-teacup": function () { // A giant teacup on its saucer, with a cushion where the tea would be.
      return oval(340, 456, 54, 8, "#e8dff0") + oval(340, 454, 44, 5, "#fff8f0") +
        path("M376 416 q22 -4 20 14 q-2 14 -26 14", "none", 'stroke="#fff8f0" stroke-width="6" stroke-linecap="round"') +
        path("M296 410 Q298 452 340 454 Q382 452 384 410 Z", "#fff8f0") + path("M297 422 Q340 436 383 422 L382 428 Q340 442 298 428 Z", "#ff8ecb") +
        [316, 340, 364].map(function (x, i) { return path(star(x, 445 - (i === 1 ? -2 : 0), 3.5), "#d9b24a"); }).join("") +
        oval(340, 410, 44, 10, "#d9b24a") + oval(340, 410, 40, 8, "#ffb3d1") + oval(340, 409, 26, 4.5, "#ffd9e6");
    },
    "bed-slipper": function () { // One huge fluffy slipper, toe to the left, with a pompom on top. Lumi naps in the heel.
      const fluff = [[352, 412], [358, 420], [361, 429], [362, 438], [346, 407], [339, 405]];
      return oval(340, 458, 54, 5, "#00000044") + path("M290 450 Q288 458 300 458 H378 Q394 458 392 444 Q390 434 376 436 H304 Q292 438 290 450 Z", "#7a4a2a") +
        path("M340 444 Q352 426 376 428 Q392 432 390 448 Z", "#f6dcc0") + oval(372, 440, 13, 7, "#ffb3d1") +
        path("M290 450 Q286 410 318 406 Q350 404 362 446 Z", "#b9a2ff") + path("M296 446 Q294 420 318 416", "none", 'stroke="#d8c9ff" stroke-width="4" stroke-linecap="round"') +
        fluff.map(function (p) { return circle(p[0], p[1], 7, "#e8dff0"); }).join("") +
        circle(312, 402, 11, "#fff") + circle(304, 408, 7, "#f0e6ff") + circle(321, 407, 7, "#f0e6ff") + circle(312, 400, 5, "#ffd9e6");
    },
    "bed-nest": function () { // A twiggy bird's nest with a soft lining and one speckled egg for a pillow.
      return oval(340, 448, 54, 14, "#4a3218") + oval(340, 436, 50, 18, "#6b4a2f") + oval(340, 430, 38, 10, "#f6dcc0") + oval(340, 432, 28, 6, "#ffe9c9") +
        scatter(17, 26, function (roll) {
          const a = roll(0, Math.PI * 2), x = round(340 + Math.cos(a) * roll(40, 52)), y = round(440 + Math.sin(a) * roll(6, 18)), t = roll(-16, 16);
          return line(x, y, round(x + t), round(y + t * .25 + roll(-3, 3)), ["#8a5a2a", "#a8743f", "#54391f"][Math.floor(roll(0, 3))], 2, 'stroke-linecap="round"');
        }) +
        oval(362, 424, 9, 12, "#bfe8ff", 'transform="rotate(14 362 424)"') + circle(359, 421, 1.3, "#6f7fc0") + circle(365, 427, 1, "#6f7fc0") + circle(363, 418, 1, "#6f7fc0") +
        path("M300 424 q10 -14 22 -12 q-4 12 -22 12 Z", "#ffb3d1") + path("M302 423 L320 413", "none", 'stroke="#e8556a" stroke-width="1"');
    },
    "bed-donut": function () { // A big iced donut: the hole is the dip Lumi curls up in.
      return oval(340, 450, 54, 8, "#00000044") + oval(340, 438, 54, 20, "#d9a25f") +
        path("M288 432 Q288 414 340 412 Q392 414 392 432 Q394 442 378 442 Q374 450 362 444 Q350 454 338 446 Q326 452 316 444 Q306 450 298 442 Q286 442 288 432 Z", "#ff8ecb") +
        oval(340, 430, 20, 7, "#a8743f") + oval(340, 431, 16, 5, "#ffd9e6") +
        scatter(23, 30, function (roll) {
          const a = roll(0, Math.PI * 2), x = round(340 + Math.cos(a) * roll(26, 46)), y = round(430 + Math.sin(a) * roll(9, 13)), t = roll(-4, 4);
          return line(x, y, round(x + t), round(y + 3 - Math.abs(t) * .5), ["#fff", "#ffdc83", "#70ebea", "#c9a8ff"][Math.floor(roll(0, 4))], 2, 'stroke-linecap="round"');
        });
    },
    "bed-hammock": function () { // A striped hammock between two star-topped posts.
      return oval(340, 460, 58, 6, "#00000044") + rect(292, 392, 6, 66, "#8a5a2a", 'rx="2"') + rect(382, 392, 6, 66, "#8a5a2a", 'rx="2"') +
        path("M284 460 L295 440 L306 460 M374 460 L385 440 L396 460", "none", 'stroke="#6b4a2f" stroke-width="4" stroke-linecap="round"') +
        path(star(295, 386, 9), "#ffdc83") + path(star(385, 386, 9), "#ffdc83") +
        path("M295 400 L306 412 M385 400 L374 412", "none", 'stroke="#fff1e0" stroke-width="2"') +
        path("M304 410 Q340 478 376 410 Q340 432 304 410 Z", "#70b8eb") + path("M304 410 Q340 462 376 410 Q340 446 304 410 Z", "#fff1e0") + path("M304 410 Q340 478 376 410 Q340 470 304 410 Z", "#ff8ecb") + // Three bands that all meet at the ropes.
        path("M304 410 Q340 432 376 410", "none", 'stroke="#3d4675" stroke-width="2"') +
        oval(340, 424, 18, 6, "#ffe9c9") + [[322, 433], [358, 433]].map(function (s) { return path(star(s[0], s[1], 3), "#3d4675"); }).join("");
    },
    "bed-shell": function () { // An open scallop shell with a pearl pillow.
      function at(r, deg) { return [round(340 + Math.sin(deg * Math.PI / 180) * r), round(452 - Math.cos(deg * Math.PI / 180) * r)]; } // A point at radius r and an angle from the hinge.
      let edge = "M340 452 L" + at(58, -66).join(" "), ribs = "";
      for (let a = -66; a < 66; a += 16.5) edge += " Q" + at(70, a + 8.25).join(" ") + " " + at(58, a + 16.5).join(" "); // Each scallop bulges past the rim.
      for (let a = -49.5; a < 60; a += 16.5) ribs += line(340, 452, at(60, a)[0], at(60, a)[1], "#d9775e", 1.6, 'opacity=".75"');
      const fan = path(edge + " Z", "#ffb99c") + path("M340 452 L" + at(40, -60).join(" ") + " Q" + at(50, 0).join(" ") + " " + at(40, 60).join(" ") + " Z", "#ffd0ba", 'opacity=".6"') + ribs;
      return oval(340, 462, 54, 5, "#00000044") + fan +
        path("M288 444 Q296 466 340 466 Q384 466 392 444 Q340 424 288 444 Z", "#ffdccb") +
        path("M300 450 Q340 436 380 450 M312 458 Q340 448 368 458", "none", 'stroke="#ffb09a" stroke-width="1.5"') +
        oval(340, 440, 34, 7, "#fff1e0") + circle(340, 430, 12, "#fff8f0", 'stroke="#e8dff0" stroke-width="1"') + circle(336, 426, 3.5, "#fff") + circle(344, 436, 4, "#ffd9e6", 'opacity=".5"');
    },
    "bed-quilt": function () { // A proper little bed under a patchwork quilt.
      const colours = ["#ff8ecb", "#70b8eb", "#ffdc83", "#7fc49a", "#c9a8ff", "#ff9d6b"];
      let patches = "";
      for (let row = 0; row < 2; row++) for (let col = 0; col < 7; col++) patches += rect(306 + col * 10, 422 + row * 11, 10, 11, colours[(row * 2 + col) % 6]);
      return oval(340, 460, 58, 5, "#00000044") + rect(376, 394, 12, 62, "#8a5a2a", 'rx="4"') + circle(382, 392, 6, "#d9b24a") + rect(292, 418, 10, 38, "#8a5a2a", 'rx="3"') + circle(297, 416, 5, "#d9b24a") +
        rect(300, 442, 78, 10, "#a8743f") + rect(306, 452, 5, 8, "#6b4a2f") + rect(366, 452, 5, 8, "#6b4a2f") +
        oval(362, 418, 15, 8, "#fff8f0") + patches +
        path("M306 422 H376 M306 433 H376 M316 422 V444 M326 422 V444 M336 422 V444 M346 422 V444 M356 422 V444 M366 422 V444", "none", 'stroke="#fff" stroke-width=".8" stroke-dasharray="2 2" opacity=".7"') +
        path("M306 444 H376", "none", 'stroke="#e8dff0" stroke-width="2"');
    },
    "bed-canopy": function () { // A four-poster with velvet curtains, tassels and a heap of pillows.
      return oval(340, 462, 60, 5, "#00000055") +
        [298, 382].map(function (x) { return rect(x - 3, 382, 6, 76, "#d9b24a", 'rx="2"') + circle(x, 378, 5, "#ffdc83"); }).join("") +
        path("M294 380 Q340 354 386 380 V392 Q374 404 362 392 Q351 404 340 392 Q329 404 318 392 Q306 404 294 392 Z", "#7a2f6e") + path("M294 381 Q340 356 386 381", "none", 'stroke="#ffdc83" stroke-width="2.5"') + path(star(340, 367, 6), "#fff1cd") +
        path("M295 392 Q306 412 314 408 Q306 432 298 440 Z", "#a13f8f") + path("M385 392 Q374 412 366 408 Q374 432 382 440 Z", "#a13f8f") + circle(314, 409, 2.6, "#ffdc83") + circle(366, 409, 2.6, "#ffdc83") + line(314, 411, 314, 420, "#ffdc83", 1.5) + line(366, 411, 366, 420, "#ffdc83", 1.5) +
        rect(298, 442, 84, 12, "#6b3f8a", 'rx="3"') + rect(302, 454, 76, 6, "#3d2450") +
        oval(324, 430, 14, 7, "#fff8f0") + oval(356, 430, 14, 7, "#ffd9e6") + oval(340, 427, 12, 6, "#c9a8ff") +
        path("M300 442 Q320 432 340 438 Q360 432 380 442 V450 H300 Z", "#d46fb8") + path("M304 448 H376", "none", 'stroke="#ffdc83" stroke-width="1.5" stroke-dasharray="3 3"') +
        [314, 332, 350, 368].map(function (x, i) { return path(star(x, 444, 2.6), "#fff1cd", 'class="lp-twinkle" style="animation-delay:' + (i * .5) + 's"'); }).join("");
    },
    "bed-lotus": function () { // A giant water lily on its pad, petals in three rings around a glowing heart.
      function petal(angle, length, width, fill) { return path("M0 0 Q" + (-width) + " " + (-length * .55) + " 0 " + (-length) + " Q" + width + " " + (-length * .55) + " 0 0 Z", fill, 'transform="rotate(' + angle + ')"'); }
      let back = "", mid = "", front = "";
      [-84, -60, -36, -12, 12, 36, 60, 84].forEach(function (a) { back += petal(a, 56, 18, "#d46fb8"); });
      [-70, -42, -14, 14, 42, 70].forEach(function (a) { mid += petal(a, 44, 15, "#ff8ecb"); });
      [-100, -75, -48, 48, 75, 100].forEach(function (a) { front += petal(a, 34, 13, "#ffc4e0"); });
      return oval(340, 460, 62, 7, "#70b8eb", 'opacity=".25"') + oval(340, 460, 48, 4, "none", 'stroke="#bfe8ff" stroke-width="1" opacity=".5"') +
        path("M286 452 Q286 438 340 438 Q394 438 394 452 Q394 462 340 462 Q330 462 340 452 L324 462 Q286 462 286 452 Z", "#3f8a66") + path("M300 452 H380 M340 442 V452", "none", 'stroke="#5fae86" stroke-width="1"') +
        group(back + mid, 'transform="translate(340 448) scale(1.05 .9)"') +
        oval(340, 428, 20, 9, "#ffdc83", 'class="lp-neon"') + oval(340, 427, 13, 5, "#fff1cd") +
        group(front, 'transform="translate(340 448) scale(1.05 .9)"') +
        [[316, 408, 3], [366, 400, 3.5], [388, 428, 2.5], [296, 428, 2.5]].map(function (s, i) { return circle(s[0], s[1], s[2], "#ffe9a8", 'class="lp-twinkle" style="animation-delay:' + (i * .6) + 's"'); }).join("");
    },
    "bed-planet": function () { // The prize of prizes: a hovering half-planet to sleep in, ringed in gold, with its own moons and starlit canopy.
      const cx = 340, cy = 410, r = 42;
      function width(dy) { return round(Math.sqrt(Math.max(0, r * r - dy * dy))); }
      function band(d1, d2, fill) { // A curved stripe across the bowl of the planet.
        const a = width(d1), b = width(d2);
        return path("M" + (cx - a) + " " + (cy + d1) + " Q" + cx + " " + (cy + d1 + 7) + " " + (cx + a) + " " + (cy + d1) + " L" + (cx + b) + " " + (cy + d2) + " Q" + cx + " " + (cy + d2 + 7) + " " + (cx - b) + " " + (cy + d2) + " Z", fill);
      }
      return oval(cx, 464, 40, 6, GLOW, 'opacity=".28"') + oval(cx, 464, 20, 3, GLOW, 'opacity=".5"') +
        path("M" + (cx - 28) + " 450 L" + (cx - 34) + " 462 M" + cx + " 454 V464 M" + (cx + 28) + " 450 L" + (cx + 34) + " 462", "none", 'stroke="' + GLOW + '" stroke-width="2" opacity=".5" stroke-dasharray="2 3"') +
        path("M" + (cx - 40) + " 396 Q" + cx + " 354 " + (cx + 40) + " 396", "none", 'stroke="#ffdc83" stroke-width="1.5" opacity=".7"') +
        [[-32, 383, 3], [-16, 372, 4], [0, 366, 6], [16, 372, 4], [32, 383, 3]].map(function (s, i) { return line(cx + s[0], s[1], cx + s[0], s[1] + 8, "#ffdc83", 1, 'opacity=".5"') + path(star(cx + s[0], s[1] + 12, s[2]), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .35) + 's"'); }).join("") +
        path("M" + (cx - 56) + " 412 A56 15 0 0 1 " + (cx + 56) + " 412", "none", 'stroke="#d9b24a" stroke-width="5"') +
        path("M" + (cx - r) + " " + cy + " A" + r + " " + r + " 0 0 0 " + (cx + r) + " " + cy + " Z", "#2a3a8a") +
        band(4, 12, "#4f6ad0") + band(16, 22, "#c85a8e") + band(26, 31, "#70b8eb") + band(34, 38, "#ffdc83") +
        circle(cx - 16, cy + 18, 3, "#fff", 'opacity=".5"') + circle(cx + 20, cy + 26, 2, "#fff", 'opacity=".5"') +
        oval(cx, cy, r, 11, "#120f2a") + oval(cx, cy - 1, r - 4, 9, "#c9a8ff") + oval(cx, cy - 3, r - 16, 6, "#f0deff") + oval(cx + 18, cy - 5, 11, 5, "#fff8f0") +
        path("M" + (cx - 56) + " 412 A56 15 0 0 0 " + (cx + 56) + " 412", "none", 'stroke="#ffdc83" stroke-width="5" class="lp-neon"') +
        circle(cx - 54, 396, 6, "#c8d2e8") + circle(cx - 56, 394, 2, "#fff", 'opacity=".7"') + circle(cx + 54, 432, 4.5, "#ff9d6b") +
        [[288, 430, 4], [392, 396, 5], [340, 470, 3.5]].map(function (s, i) { return path(star(s[0], s[1], s[2]), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .7 + .2) + 's"'); }).join("");
    },

    // Star Capsule ceiling hanging
    // Hung from the top of the wall above the shelf, roughly x 288..380 and y 0..125.

    "hang-bunting": function () { // Two swags of party flags. Each flag sits on the curve and tilts to follow it.
      const colours = ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff", "#ff9d6b", "#7fc49a"];
      const swag = function (x1, x2, sag, y0, count, shift) {
        let out = path("M" + x1 + " " + y0 + " Q" + (x1 + x2) / 2 + " " + (y0 + sag * 2) + " " + x2 + " " + y0, "none", 'stroke="#8a7aa8" stroke-width="1.2"');
        for (let i = 0; i < count; i++) {
          const t = (i + .5) / count, x = x1 + (x2 - x1) * t, y = y0 + 2 * sag * 2 * t * (1 - t), slope = Math.atan2(2 * sag * 2 * (1 - 2 * t), x2 - x1) * 57.3;  // A point on the curve, and its tilt.
          out += path("M-7 0 H7 L0 17 Z", colours[(i + shift) % 6], 'transform="translate(' + round(x) + " " + round(y) + ") rotate(" + round(slope) + ')"');
        }
        return out;
      };
      return swag(286, 378, 30, 6, 9, 0) + swag(300, 364, 22, 40, 6, 3);
    },

    "hang-raincloud": function () { // A felt rain cloud with a sleepy smile, raining beads of blue on strings.
      const drops = [[306, 94, "#70b8eb"], [320, 112, "#9bd6f5"], [334, 100, "#70b8eb"], [348, 116, "#9bd6f5"], [360, 92, "#70b8eb"]];
      return line(333, 0, 333, 30, "#8a7aa8", 1.2) + drops.map(function (d) { // Each drop on its own thread.
        return line(d[0], 50, d[0], d[1] - 8, "#8a7aa8", 1) + path("M" + d[0] + " " + (d[1] - 9) + " C" + (d[0] - 8) + " " + (d[1] + 2) + " " + (d[0] - 5) + " " + (d[1] + 9) + " " + d[0] + " " + (d[1] + 9) + " C" + (d[0] + 5) + " " + (d[1] + 9) + " " + (d[0] + 8) + " " + (d[1] + 2) + " " + d[0] + " " + (d[1] - 9) + " Z", d[2]);
      }).join("") + oval(333, 46, 44, 15, "#dfe6f7") + circle(310, 40, 15, "#eef2ff") + circle(332, 30, 20, "#ffffff") + circle(356, 38, 16, "#eef2ff") +
        path("M320 42 q4 4 8 0 M339 42 q4 4 8 0", "none", 'stroke="#46507a" stroke-width="2" stroke-linecap="round"') + path("M329 49 q4 4 8 0", "none", 'stroke="#46507a" stroke-width="1.8" stroke-linecap="round"') +
        circle(316, 49, 3, "#ffb3c8", 'opacity=".7"') + circle(350, 49, 3, "#ffb3c8", 'opacity=".7"');
    },

    "hang-windsock": function () { // A fish-shaped streamer swimming sideways on two threads: five colour bands from nose to tail, big eye, scale marks and a forked tail.
      const stripes = ["#ff9d6b", "#fff1e0", "#e8556a", "#fff1e0", "#ffdc83"];
      const half = function (x) { return round(19 * Math.sin((x - 298) / 80 * Math.PI * .86 + .25)); };                                    // How tall the body is at a point.
      let body = "";
      for (let i = 0; i < 5; i++) { // Each band follows the same fish outline.
        let top = "", under = "";
        for (let x = 298 + i * 13; x <= 311 + i * 13; x += 3.25) { top += (top ? " L" : "M") + x + " " + round(54 - half(x)); under = " L" + x + " " + round(54 + half(x)) + under; }
        body += path(top + under + " Z", stripes[i]);
      }
      return path("M312 0 V38 M350 0 V40", "none", 'stroke="#8a7aa8" stroke-width="1.2"') +
        path("M361 54 L386 40 Q378 54 386 68 Z", "#e8556a") + body +                                                                         // The forked tail, then the body.
        path("M323 44 a6 6 0 0 1 0 12 M336 42 a6 6 0 0 1 0 14 M349 45 a5 5 0 0 1 0 11", "none", 'stroke="#ffffff" stroke-width="1.4" opacity=".55"') +          // Scale marks.
        path("M321 68 Q324 76 332 74 Q327 70 330 66 Z", "#ffb86a") + oval(298, 54, 3, 8, "#3a2147") +                                                            // A belly fin and the round open mouth.
        circle(308, 48, 5, "#fff") + circle(307, 48, 2.6, "#1c1430") +
        path("M318 76 q-8 12 0 24 q8 12 0 22 M346 74 q8 12 0 22 q-8 10 -2 20", "none", 'stroke="#70b8eb" stroke-width="2.6" stroke-linecap="round"');                 // Two trailing ribbons.
    },

    "hang-pompoms": function () { // Woolly pom-pom strings: a dashed outer stroke gives each ball its fuzz.
      const strands = [[302, [34, 72]], [318, [20, 58, 96]], [334, [40, 80, 112]], [350, [24, 64]], [366, [38, 84]]], colours = ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff", "#ff9d6b", "#7fc49a"];
      let n = 0;
      return strands.map(function (s) {
        const bottom = s[1][s[1].length - 1];
        return line(s[0], 0, s[0], bottom, "#8a7aa8", 1) + s[1].map(function (y) { const c = colours[n++ % 6]; return circle(s[0], y, 8.5, c) + circle(s[0], y, 9.5, "none", 'stroke="' + c + '" stroke-width="3.2" stroke-dasharray="1.6 .9" opacity=".8"') + circle(s[0] - 3, y - 3, 2, "#ffffff", 'opacity=".5"'); }).join("");
      }).join("");
    },

    "hang-chimes": function () { // Bamboo wind chimes: a wooden top, five tubes on threads, and a paddle that catches the breeze.
      const tubes = [[304, 76], [318, 90], [333, 96], [348, 86], [362, 72]];
      return line(333, 0, 333, 24, "#8a7aa8", 1.2) + oval(333, 30, 38, 7, "#6b4426") + oval(333, 28, 38, 7, "#a8743f") +
        tubes.map(function (t) { // A thread, a tube and the bamboo's joints.
          return line(t[0], 32, t[0], 48, "#8a7aa8", 1) + rect(t[0] - 4, 48, 8, t[1] - 48, "#cdb06a", 'rx="3"') + rect(t[0] - 4, 62, 8, 2, "#8a6a2a") + rect(t[0] - 4, Math.round((62 + t[1]) / 2), 8, 2, "#8a6a2a") + rect(t[0] - 2.5, 50, 1.5, t[1] - 54, "#fff1cd", 'opacity=".5"');
        }).join("") + line(333, 32, 333, 108, "#8a7aa8", 1) + oval(333, 68, 7, 3, "#6b4426") + path("M326 108 H340 L337 122 H329 Z", "#a8743f");
    },

    "hang-moonswing": function () { // A crescent moon on two ropes, with a little cushion to sit on and stars dangling from its tip.
      return path("M300 0 L299 42 M378 0 L381 50", "none", 'stroke="#c79256" stroke-width="1.6"') +                                                          // The two ropes, running to the moon's tips.
        group(path("M298 58 Q306 108 350 104 Q376 100 382 66 Q368 92 344 90 Q316 88 298 58 Z", "#ffdc83", 'stroke="#d9b24a" stroke-width="1.4" stroke-linejoin="round"') + circle(318, 88, 1.8, "#d9b24a") + circle(338, 96, 2.2, "#d9b24a") + circle(358, 94, 1.6, "#d9b24a") + // The moon and its craters.
          path("M322 84 Q338 78 352 86 Q344 94 330 92 Z", "#c85a8e") + path("M326 85 Q338 81 348 87", "none", 'stroke="#ffb3d1" stroke-width="1.4"') +                             // The cushion.
          path("M352 102 V116 M326 100 V120 M340 104 V128", "none", 'stroke="#8a7aa8" stroke-width="1"') +
          path(star(352, 121, 6), "#fff8dc", 'class="lp-twinkle"') + path(star(326, 126, 7), "#fff1cd", 'class="lp-twinkle" style="animation-delay:.6s"') + path(star(340, 133, 5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:1.1s"'),
          'transform="translate(0 -16)"');
    },

    "hang-jellyfish": function () { // A big see-through jellyfish and its baby, drifting on threads, with trailing wavy tendrils and glowing spots.
      const jelly = function (x, y, s, delay) {
        const tendril = function (dx, turn) { return path("M" + dx + " 0 q" + turn + " 12 0 24 q" + (-turn) + " 12 0 24 q" + turn + " 10 0 20", "none", 'stroke="#ffd0ea" stroke-width="2" stroke-linecap="round" opacity=".7"'); };
        return group(oval(0, -6, 30, 22, GLOW, 'opacity=".09"') + tendril(-14, 6) + tendril(-5, -6) + tendril(5, 6) + tendril(14, -6) +
          path("M-24 0 C-24 -30 24 -30 24 0 Q18 -5 12 0 Q6 -5 0 0 Q-6 -5 -12 0 Q-18 -5 -24 0Z", "#ff9fd8", 'opacity=".78"') + path("M-14 -8 Q-6 -20 12 -14", "none", 'stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity=".55"') +
          circle(-8, -8, 2.6, "#fff0f8", 'class="lp-twinkle" style="animation-delay:' + delay + 's"') + circle(5, -14, 2, "#fff0f8", 'class="lp-twinkle" style="animation-delay:' + (delay + .5) + 's"') + circle(10, -6, 2.4, "#fff0f8"),
          'transform="translate(' + x + " " + y + ") scale(" + s + ')"');
      };
      return line(320, 0, 320, 14, "#8a7aa8", 1) + line(364, 0, 364, 56, "#8a7aa8", 1) + jelly(320, 38, 1.05, 0) + jelly(364, 76, .62, .8);
    },

    "hang-balloon": function () { // A hot-air balloon: narrower and narrower teardrops stacked up make the stripes.
      const bulb = function (w) { return "M333 14 C" + (333 - w * 1.45) + " 14 " + (333 - w * 1.4) + " 76 " + (333 - w * .42) + " 94 L" + (333 + w * .42) + " 94 C" + (333 + w * 1.4) + " 76 " + (333 + w * 1.45) + " 14 333 14Z"; };
      return line(333, 0, 333, 14, "#8a7aa8", 1.2) + path(bulb(42), "#e8556a") + path(bulb(32), "#ffdc83") + path(bulb(21), "#70b8eb") + path(bulb(10), "#fff1e0") +
        path("M309 80 H357 L352 90 H314 Z", "#7a4a2a") + [316, 324, 333, 342, 350].map(function (x) { return circle(x, 85, 1.8, "#ffdc83"); }).join("") +                                       // The band of little gold studs.
        path("M319 94 L325 112 M347 94 L341 112 M333 94 V112", "none", 'stroke="#c79256" stroke-width="1.2"') + rect(324, 112, 18, 13, "#a8743f", 'rx="2"') + path("M324 116 H342 M324 120 H342 M329 112 V125 M337 112 V125", "none", 'stroke="#7a4a2a" stroke-width="1"') + // Ropes and wicker basket.
        oval(321, 119, 3.4, 4.5, "#c9b58a") + oval(345, 119, 3.4, 4.5, "#c9b58a") +                                                                                                     // Sandbags.
        path("M312 40 q5 -8 12 -6 M316 30 q4 -5 9 -4", "none", 'stroke="#ffffff" stroke-width="2.2" opacity=".35" stroke-linecap="round"') +
        path("M333 14 V6 L342 9 L333 12", "#ff8ecb") + path(star(296, 52, 4), "#fff8dc", 'class="lp-twinkle"') + path(star(374, 70, 3.4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.8s"');
    },

    "hang-chandelier": function () { // A crystal chandelier: curling gold arms, flickering candles and rows of hanging drops.
      const crystal = function (x, y, s) { return path("M" + x + " " + y + " l" + 3.6 * s + " " + 6 * s + " l-" + 3.6 * s + " " + 8 * s + " l-" + 3.6 * s + " -" + 8 * s + " Z", "#bfe8ff", 'stroke="#ffffff" stroke-width=".7"'); };
      const arms = "M333 44 Q303 42 301 66 M333 44 Q363 42 365 66 M333 44 Q317 44 315 58 M333 44 Q349 44 351 58 M333 62 Q303 70 301 86 M333 62 Q363 70 365 86";                             // The six curling arms, drawn as one line.
      const candles = [[301, 60], [365, 60], [315, 52], [351, 52], [333, 50]];
      let drops = "";
      [[301, 88], [309, 96], [317, 100], [325, 104], [333, 106], [341, 104], [349, 100], [357, 96], [365, 88]].forEach(function (d, i) { drops += line(d[0], d[1] - 12, d[0], d[1], "#e8c877", .8) + crystal(d[0], d[1], i % 2 ? 1 : 1.3); }); // The lowest fringe of crystals.
      return line(333, 0, 333, 36, "#d9b24a", 2) + path("M319 36 H347 L342 44 H324 Z", "#d9b24a") + oval(333, 62, 8, 4, "#d9b24a") + circle(333, 16, 4, "#d9b24a") + rect(331, 44, 4, 60, "#d9b24a", 'rx="2"') + path(arms, "none", 'stroke="#e8c877" stroke-width="3" stroke-linecap="round"') +
        candles.map(function (c, i) { // A candle, a drip plate and a flickering flame.
          return rect(c[0] - 2.5, c[1] - 11, 5, 11, "#fff1e0", 'rx="1"') + oval(c[0], c[1], 6, 2, "#c9a15a") + oval(c[0], c[1] - 18, 8, 8, "#ffb84a", 'opacity=".2"') + path("M" + c[0] + " " + (c[1] - 22) + " q4 6 0 10 q-4 -4 0 -10 Z", "#ffc86a", 'class="lp-twinkle" style="animation-delay:' + (i * .4) + 's"');
        }).join("") + [[305, 76], [361, 76], [319, 70], [347, 70]].map(function (c) { return crystal(c[0], c[1], 1.1); }).join("") + drops + crystal(333, 108, 1.1);
    },

    "hang-orrery": function () { // A grand brass orrery: three tilted orbits around a blazing sun, with planets riding in front and behind. Each orbit is drawn in two halves so the sun can pass between them.
      const cx = 333, cy = 66, tilt = "rotate(-14 333 66)";
      const back = function (rx, ry, colour, w) { return path("M" + (cx - rx) + " " + cy + " A" + rx + " " + ry + " 0 0 1 " + (cx + rx) + " " + cy, "none", 'stroke="' + colour + '" stroke-width="' + w + '"'); };
      const front = function (rx, ry, colour, w) { return path("M" + (cx - rx) + " " + cy + " A" + rx + " " + ry + " 0 0 0 " + (cx + rx) + " " + cy, "none", 'stroke="' + colour + '" stroke-width="' + w + '"'); };
      const place = function (rx, ry, a) { return [round(cx + rx * Math.cos(a)), round(cy + ry * Math.sin(a))]; }; // A point on an orbit; sin(a) > 0 is the near side.
      const dot = function (spot, r, colour, extra) { return circle(spot[0], spot[1], r, colour, extra || "") + circle(round(spot[0] - r * .35), round(spot[1] - r * .35), round(r * .3), "#ffffff", 'opacity=".55"'); };
      const orbits = [[46, 20], [33, 14], [20, 8]];
      const p1 = place(46, 20, -2.6), p2 = place(33, 14, -.5), p3 = place(20, 8, 2.5), p4 = place(46, 20, .85), p5 = place(33, 14, 2.3);
      const behind = group(back(46, 20, "#c9a15a", 2.5) + back(33, 14, "#e8c877", 2.2) + back(20, 8, "#c9a15a", 2) + dot(p1, 7, "#70b8eb") + dot(p2, 5.5, "#ff9d6b"), 'transform="' + tilt + '"');
      const before = group(front(46, 20, "#e8c877", 2.5) + front(33, 14, "#ffdc83", 2.2) + front(20, 8, "#e8c877", 2) +
        dot(p3, 4, "#c9a8ff") + dot(p4, 8, "#7fc49a") + oval(p4[0], p4[1], 13, 3.4, "none", 'stroke="#ffe0b0" stroke-width="1.6"') + dot(p5, 5, "#ff8ecb") +
        orbits.map(function (o, i) { const n = place(o[0], o[1], 3.14 * i + .4); return circle(n[0], n[1], 2.2, "#fff4c0"); }).join(""), 'transform="' + tilt + '"');          // Brass rivets riding the rings.
      return line(cx, 0, cx, 18, "#d9b24a", 2.4) + circle(cx, 17, 10, "#d9b24a") + circle(cx, 17, 12, "none", 'stroke="#8a6a2a" stroke-width="3.5" stroke-dasharray="2.6 2.6"') + circle(cx, 17, 4, "#8a6a2a") + rect(cx - 1.8, 26, 3.6, 26, "#c9a15a") + // The brass gearbox it all hangs from.
        behind + circle(cx, cy, 10, "#ffb84a", 'class="lp-neon"') + circle(cx, cy, 7.5, "#ffdc83") + path(star(cx, cy, 15), "#fff8dc", 'class="lp-twinkle"') + circle(cx, cy, 3, "#ffffff") + before +
        path("M294 116 Q308 112 322 112", "none", 'stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity=".45"') + path(star(322, 112, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.5s"') +                                     // A tiny comet below.
        [[291, 40, 3.4], [376, 30, 4], [378, 106, 3], [290, 88, 3]].map(function (s, i) { return path(star(s[0], s[1], s[2]), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .4) + 's"'); }).join("");
    },

    // Star Capsule curtains
    "curtain-gingham": function () { // Country check panels, tied back to each side with a bow.
      function panel(x, flip) { // One tied-back panel: only the checks that fit the panel's width at that height are drawn, so none land on the glass.
        const edge = "M0 88 H44 Q32 150 8 170 Q24 200 32 236 H0 Z";
        function width(y) { return y < 170 ? 44 - (y - 88) / 82 * 38 : 8 + (y - 170) / 66 * 26; }
        let checks = "";
        for (let y = 92, row = 0; y < 232; y += 7, row++) for (let col = 0; col * 7 + 6 <= width(y + 6); col++) if ((col + row) % 2) checks += "M" + col * 7 + " " + y + " h6 v6 h-6Z ";
        return group(path(edge, "#fbe3ee") + path(checks, "#f58fb6", 'opacity=".55"') + path("M0 164 Q10 168 14 172 Q10 176 0 178", "#e8689a") + circle(13, 171, 3.4, "#fff"), 'transform="translate(' + x + ' 0) scale(' + flip + ' 1)"');
      }
      return ART.rod() + panel(126, 1) + panel(274, -1);
    },
    "curtain-bunting": function () { // A string of party pennants along the top and two more dropping down the sides; the view stays clear.
      const colours = ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff", "#7fc49a"];
      function flags(points) { // A flag hanging from each point on a string.
        return points.map(function (p, i) { return path("M" + (p[0] - 7) + " " + p[1] + " h14 l-7 15 Z", colours[i % 5]); }).join("");
      }
      const top = [130, 146, 162, 178, 194, 210, 226, 242, 258, 272].map(function (x) { return [x, 92 + Math.round(Math.sin((x - 130) / 142 * Math.PI) * 12)]; });
      return ART.rod() + path("M126 92 Q200 118 274 92", "none", 'stroke="#f2e6cf" stroke-width="1.5"') + flags(top) +
        path("M130 92 Q124 162 132 236 M270 92 Q276 162 268 236", "none", 'stroke="#f2e6cf" stroke-width="1.5"') + flags([[127, 128], [128, 158], [128, 188], [131, 218], [273, 124], [272, 156], [272, 186], [269, 216]]);
    },
    "curtain-cloud": function () { // A fluffy valance of cloud hanging off the rod, with little cloudlets drifting down each side.
      function cloudlet(x, y, s) { // Three overlapping puffs and a soft shadow underneath, as one small cloud.
        return group(oval(0, 3, 12, 5, "#c9d6f2") + circle(-6, 0, 6.5, "#fff") + circle(6, 0, 6, "#fff") + circle(0, -3, 8, "#fff"), 'transform="translate(' + x + " " + y + ") scale(" + s + ')"');
      }
      const top = [[140, 100, 14], [162, 98, 17], [188, 100, 17], [212, 98, 17], [238, 100, 16], [260, 101, 13]];
      return ART.rod() + top.map(function (c) { return oval(c[0], c[1] + 8, c[2], 5, "#c9d6f2"); }).join("") + rect(126, 86, 148, 13, "#eef2ff", 'rx="6"') + top.map(function (c) { return circle(c[0], c[1], c[2], "#eef2ff"); }).join("") +
        cloudlet(132, 136, 1) + cloudlet(138, 168, .85) + cloudlet(130, 200, .7) + cloudlet(268, 140, 1) + cloudlet(262, 176, .85) + cloudlet(271, 208, .7);
    },
    "curtain-roller": function () { // A striped roller blind pulled a third of the way down, with a pull-cord and a wooden bead.
      let stripes = "";
      for (let x = 136; x < 264; x += 16) stripes += "M" + x + " 94 h8 v34 h-8Z ";
      return rect(126, 86, 148, 8, "#a8743f", 'rx="4"') + rect(130, 94, 140, 36, "#f6dcc0") + path(stripes, "#f0a86e", 'opacity=".75"') + rect(130, 128, 140, 5, "#7a4a2a", 'rx="2"') +
        path("M200 133 V162", "none", 'stroke="#7a4a2a" stroke-width="1.5"') + circle(200, 166, 4.5, "#a8743f") + circle(198.5, 164.5, 1.3, "#fff", 'opacity=".5"');
    },
    "curtain-ivy": function () { // Ivy trailing from the rod in three strands each side, with leaves growing off each stem.
      function vine(x, length, lean, seed) { // One strand: a wavy stem through evenly spaced points, with a leaf at each point.
        let stem = "M" + x + " 88", leaves = "";
        leaves += scatter(seed, length, function (r, i) {
          const y = 96 + i * 14, px = round(x + lean * i), side = i % 2 ? 1 : -1, k = round(r(.8, 1.2));
          stem += " L" + px + " " + y;
          return "M" + px + " " + y + " q" + round(side * 6 * k) + " -8 " + round(side * 11 * k) + " -2 q" + round(-side * 1 * k) + " 8 " + round(-side * 11 * k) + " 2 Z ";
        });
        return path(stem, "none", 'stroke="#3f7a5a" stroke-width="1.6" stroke-linejoin="round"') + path(leaves, "#5fae86") + circle(round(x + lean * (length - 1)), 96 + (length - 1) * 14, 2, "#9bd6ae");
      }
      return ART.rod() + vine(130, 10, .6, 171) + vine(143, 7, -.4, 172) + vine(156, 4, .5, 173) + vine(270, 10, -.6, 174) + vine(257, 7, .4, 175) + vine(244, 4, -.5, 176);
    },
    "curtain-noren": function () { // Short split door-cloth panels across the top, each with a cat's paw on it.
      const panels = [[130, "#3a4a7a"], [166, "#46588a"], [202, "#3a4a7a"], [238, "#46588a"]];
      return ART.rod() + panels.map(function (p) {
        const x = p[0] + 16;
        return rect(p[0], 88, 32, 52, p[1]) + rect(p[0], 88, 32, 6, "#2a3660") + path("M" + (p[0] + 4) + " 140 V148 M" + (p[0] + 28) + " 140 V148", "none", 'stroke="' + p[1] + '" stroke-width="3" stroke-linecap="round"') +
          oval(x, 120, 7, 6, "#f2e6cf") + circle(x - 7, 112, 2.6, "#f2e6cf") + circle(x - 2.5, 108.5, 2.6, "#f2e6cf") + circle(x + 2.5, 108.5, 2.6, "#f2e6cf") + circle(x + 7, 112, 2.6, "#f2e6cf");
      }).join("");
    },
    "curtain-macrame": function () { // Knotted cream cord in tapering fringes down the sides, each strand finishing in a tassel.
      function fringe(x, dir) { // Rows of diamond knots, three strands wide at the top; the shorter strands stop first.
        let knots = "", cords = "", tassels = "";
        for (let col = 0; col < 3; col++) {
          const last = [5, 3, 1][col]; // Which row each strand ends on: outermost longest.
          for (let row = 0; row <= last; row++) {
            const y = 104 + row * 21, kx = x + dir * (col * 12 + (row % 2) * 6);
            knots += "M" + kx + " " + (y - 8) + " l5 8 l-5 8 l-5 -8Z ";
            cords += "M" + kx + " " + (y - 13) + " V" + (y + 13) + " ";
            if (row === last) tassels += path("M" + kx + " " + (y + 10) + " l-3.5 24 h7 Z", "#e8d8b8") + circle(kx, y + 10, 3, "#c9a15a");
          }
        }
        return path(cords, "none", 'stroke="#d8c8a8" stroke-width="1.4"') + path(knots, "#f2e6cf") + tassels;
      }
      return ART.rod() + fringe(130, 1) + fringe(270, -1);
    },
    "curtain-velvet": function () { // A little theatre: deep red drapes with gold fringe, a swagged pelmet and big tasselled tie-backs.
      function drape(flip) { // One side, drawn on the left and mirrored for the right.
        return group(path("M126 88 H164 Q150 130 152 160 Q140 170 136 236 H126 Z", "#a02c44") + path("M134 88 Q130 140 130 236 M144 88 Q138 130 137 162 M154 88 Q144 120 145 158", "none", 'stroke="#6e1c30" stroke-width="2.2"') +
          path("M126 232 H136 V238 H126 Z", "#ffdc83") + path("M126 150 Q142 166 156 158", "none", 'stroke="#ffdc83" stroke-width="4" stroke-linecap="round"') + circle(156, 158, 5, "#ffdc83") + path("M152 162 L150 182 M156 163 V184 M160 162 L162 182", "none", 'stroke="#ffc65a" stroke-width="2"') + rect(151, 184, 10, 3, "#b8862e", 'rx="1"'),
          flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      }
      return drape(false) + drape(true) + path("M122 84 H278 V100 Q258 122 239 102 Q220 124 200 104 Q180 124 161 102 Q142 122 122 100 Z", "#b83450") +
        path("M122 100 Q142 122 161 102 Q180 124 200 104 Q220 124 239 102 Q258 122 278 100", "none", 'stroke="#ffdc83" stroke-width="3.5"') +
        path("M161 90 Q164 100 161 102 M200 90 Q203 102 200 104 M239 90 Q236 100 239 102", "none", 'stroke="#7a1f34" stroke-width="2"') + [161, 200, 239].map(function (x) { return path(star(x, 92, 5), "#ffdc83"); }).join("") + rect(120, 82, 160, 5, "#ffdc83", 'rx="2.5"') + circle(120, 84.5, 5, "#ffdc83") + circle(280, 84.5, 5, "#ffdc83");
    },
    "curtain-butterflies": function () { // Gauzy side panels with a flutter of butterflies resting on them, a few twinkling.
      function fly(x, y, size, colour, tilt, cls) { // Two rounded wings and a thin body.
        return group(path("M0 0 C" + (-size * 1.2) + " " + (-size * 1.1) + " " + (-size * 1.4) + " " + size * .4 + " 0 " + size * .4 + " C" + (size * 1.4) + " " + size * .4 + " " + (size * 1.2) + " " + (-size * 1.1) + " 0 0 Z", colour) + line(0, -size * .5, 0, size * .7, "#3a2452", 1.2), 'transform="translate(' + x + " " + y + ") rotate(" + tilt + ')"' + (cls ? ' class="lp-twinkle" style="animation-delay:' + cls + 's"' : ""));
      }
      const sheer = "#d9c8ff";
      return ART.rod() + path("M126 88 H160 Q146 150 154 238 Q140 242 126 236 Z M274 88 H240 Q254 150 246 238 Q260 242 274 236 Z", sheer, 'opacity=".28"') +
        path("M134 88 Q130 160 134 238 M146 88 Q140 150 144 240 M266 88 Q270 160 266 238 M254 88 Q260 150 256 240", "none", 'stroke="#f0e6ff" stroke-width="1" opacity=".5"') +
        fly(140, 112, 7, "#ff8ecb", -18) + fly(146, 152, 5.5, "#70ebea", 14, ".4") + fly(136, 192, 6.5, "#ffdc83", 10) + fly(150, 220, 5, "#c9a8ff", -22, ".9") +
        fly(258, 118, 6, "#ffdc83", 16, "1.2") + fly(250, 156, 6.5, "#ff8ecb", -10) + fly(264, 190, 5.5, "#c9a8ff", 20) + fly(252, 226, 5, "#70ebea", -16, ".6") + fly(186, 112, 4.5, "#ff8ecb", 24, "1.5") + fly(214, 106, 4, "#70ebea", -26);
    },
    "curtain-starfall": function () { // A night-sky mantle: indigo drapes full of stars, gold constellations, comet tie-backs and glowing moon finials.
      function drape(flip) {
        return group(path("M126 86 H172 Q152 150 160 238 H126 Z", "#1c1f55") + path("M136 86 Q132 160 134 238 M148 86 Q140 150 146 238", "none", 'stroke="#0e1038" stroke-width="2.4"') +
          path("M126 86 H172 Q152 150 160 238", "none", 'stroke="' + GLOW + '" stroke-width="2.4" class="lp-neon"') +
          scatter(flip ? 181 : 182, 18, function (roll) { const x = round(roll(130, 156)), y = round(roll(96, 232)); return path(star(x, y, round(roll(1.6, 3.4))), "#fff4cf", Math.round(x) % 2 ? 'class="lp-twinkle" style="animation-delay:' + round(roll(0, 1.8)) + 's"' : ""); }) +
          path("M134 108 L146 124 L138 142 L152 160", "none", 'stroke="#ffdc83" stroke-width="1" opacity=".85"') + path(star(134, 108, 3.5), "#ffdc83") + path(star(152, 160, 3.5), "#ffdc83") +
          path("M126 196 Q144 206 162 190", "none", 'stroke="#ffdc83" stroke-width="3" stroke-linecap="round"') + path("M162 190 L176 180 L170 192 Z", "#fff4cf", 'class="lp-neon"') + circle(162, 190, 3.6, "#ffdc83"),
          flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      }
      return drape(false) + drape(true) + rect(120, 83, 160, 5, "#0e1038", 'rx="2.5"') + line(120, 85.5, 280, 85.5, GLOW, 1.2, 'opacity=".7"') +
        path("M124 78 A8 8 0 1 0 124 92 A9.5 9.5 0 0 1 124 78 Z M276 78 A8 8 0 1 1 276 92 A9.5 9.5 0 0 0 276 78 Z", "#fff4cf", 'class="lp-neon"') + // A crescent finial at each end of the rod.
        
        path(star(200, 100, 6), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.3s"') + path(star(176, 96, 3.5), "#fff4cf", 'class="lp-twinkle" style="animation-delay:1s"') + path(star(224, 96, 3.5), "#fff4cf", 'class="lp-twinkle" style="animation-delay:1.6s"');
    },

    // Star Capsule door
    "door-barn": function () { // A red barn door hanging from a sliding rail, with the classic white X brace.
      let planks = "";
      for (let x = -46; x < 6; x += 10) planks += line(x, 204, x, 354, "#7f2f22", 1.5);
      return rect(-70, 190, 90, 6, "#3a3a4a", 'rx="2"') + circle(-44, 198, 6, "#6a6a80") + circle(-6, 198, 6, "#6a6a80") + circle(-44, 198, 2, "#2a2a3a") + circle(-6, 198, 2, "#2a2a3a") +
        rect(-60, 202, 70, 152, "#a8432e", 'rx="2"') + planks +
        path("M-56 206 H6 V350 H-56 Z M-56 206 L6 278 M6 206 L-56 278 M-56 278 H6 M-56 278 L6 350 M6 278 L-56 350", "none", 'stroke="#fff1e0" stroke-width="4" stroke-linejoin="round"') +
        rect(-1, 266, 5, 26, "#3a3a4a", 'rx="2"');
    },
    "door-stable": function () { // A Dutch door: the top half stands open on the night, a flower box sits on the ledge.
      return rect(-62, 196, 74, 158, "#54391f", 'rx="3"') + rect(-56, 202, 62, 70, "#101630") + circle(-18, 228, 11, "#fff1cd") + circle(-13, 225, 10, "#101630") +
        scatter(41, 9, function (roll) { return circle(round(roll(-52, 2)), round(roll(208, 254)), round(roll(.7, 1.5)), "#fff", 'opacity=".85"'); }) +
        path("M-56 272 V258 Q-42 248 -26 258 Q-12 266 6 254 V272 Z", "#27584a") +
        rect(-56, 276, 62, 78, "#3f8a66") + rect(-49, 286, 48, 60, "#4f9c78", 'rx="2"') + circle(-1, 312, 4, "#ffdc83") +
        rect(-62, 270, 74, 7, "#7a5a3a", 'rx="2"') + path("M-48 270 l3 -8 h26 l3 8 Z", "#c0764f") +
        [[-44, "#ff8ecb"], [-36, "#ffdc83"], [-28, "#70ebea"], [-20, "#ff8ecb"]].map(function (f) { return line(f[0], 263, f[0], 256, "#5fae86", 1.5) + circle(f[0], 254, 3.6, f[1]) + circle(f[0], 254, 1.3, "#fff8dc"); }).join("");
    },
    "door-candy": function () { // Peppermint stripes, a gumdrop trim, a pinwheel window and a lollipop for a handle.
      let stripes = "";
      for (let i = 0; i < 7; i++) if (i % 2 === 0) stripes += rect(-56 + i * 62 / 7, 214, 62 / 7, 140, "#e8556a");
      const swirl = [0, 60, 120, 180, 240, 300].map(function (a) { return path("M-25 256 L-9 256 A16 16 0 0 1 -11.1 264 Z", "#e8556a",'transform="rotate(' + a + ' -25 256)"'); }).join("");
      return rect(-62, 196, 74, 158, "#fff1e0", 'rx="3"') + rect(-56, 214, 62, 140, "#fff8f0") + stripes +
        [-54, -39, -24, -9, 6].map(function (x, i) { return path("M" + (x - 8) + " 214 a8 8 0 0 1 16 0 Z", ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff", "#7fc49a"][i]); }).join("") +
        circle(-25, 256, 18, "#fff8f0", 'stroke="#d9c7b0" stroke-width="2.5"') + swirl +
        circle(-1, 300, 7, "#ffdc83") + path("M-1 300 m0 -4.5 a4.5 4.5 0 1 1 -4.5 4.5 a3 3 0 1 0 3 -3", "none", 'stroke="#e8556a" stroke-width="1.4"') + rect(-2.2, 307, 2.4, 12, "#fff1e0");
    },
    "door-letters": function () { // A cheerful blue door so loved it is overflowing with mail.
      function env(x, y, deg, fill) { return group(rect(-11, -7, 22, 14, fill, 'rx="1"') + path("M-11 -7 L0 2 L11 -7", "none", 'stroke="#c0a890" stroke-width="1.2"') + path("M0 -3 c-3 -3 -6 1 0 5 c6 -4 3 -8 0 -5 Z", "#e8556a"), 'transform="translate(' + x + " " + y + ") rotate(" + deg + ')"'); }
      return rect(-62, 196, 74, 158, "#2f4f80", 'rx="3"') + rect(-56, 202, 62, 152, "#5a8fcc") + rect(-49, 210, 48, 58, "#4a7ab0", 'rx="3"') + rect(-49, 318, 48, 30, "#4a7ab0", 'rx="3"') +
        path("M-25 256 C-46 240 -42 220 -32 220 Q-25 220 -25 228 Q-25 220 -18 220 C-8 220 -4 240 -25 256 Z", "#ff8ecb", 'stroke="#fff1e0" stroke-width="2.5"') + path(star(-25, 236, 6), "#fff8dc") +
        env(-36, 280, -12, "#fff8f0") + env(-22, 278, 8, "#ffe9c9") + env(-10, 283, -6, "#fff1e0") +
        rect(-48, 286, 46, 10, "#d9b24a", 'rx="2"') + rect(-44, 289, 38, 3, "#54391f") + circle(-2, 306, 4, "#ffdc83") +
        env(-40, 351, 24, "#ffe9c9");
    },
    "door-bookcase": function () { // Looks like a bookcase, but it has swung open a crack and light spills from behind.
      const spines = ["#c85a8e", "#70ebea", "#ffdc83", "#9c73b8", "#7fc49a", "#e98a5a", "#8fa2d8"];
      let books = "";
      [212, 244, 276, 308].forEach(function (y, row) {
        books += rect(-56, y + 26, 58, 4, "#54391f");
        books += scatter(61 + row * 7, 6, function (roll, i) {
          const h = round(roll(17, 25)), lean = roll(0, 1) > .8;
          return rect(-54 + i * 9.4, y + 26 - h, 8.2, h, spines[Math.floor(roll(0, spines.length))], 'rx="1"' + (lean ? ' opacity=".75"' : ""));
        });
      });
      return oval(10, 280, 20, 90, "#ffdc83", 'opacity=".22"') + path("M4 200 L14 196 V356 L4 354 Z", "#ffe9a8", 'opacity=".85"') +
        rect(-62, 196, 66, 158, "#6b4a2f", 'rx="3"') + rect(-57, 203, 58, 149, "#2d1d3d") + rect(-62, 196, 66, 7, "#8a5a2a", 'rx="2"') + books +
        path("M-7 278 l9 -19 l-5 -3 l-9 19 Z", "#e8556a") + circle(-1, 262, 1.6, "#ffdc83");
    },
    "door-hollow": function () { // A doorway grown from an old tree trunk, with a lantern and a ring of mushrooms.
      return path("M-74 354 Q-62 340 -64 300 L-62 214 Q-40 196 -24 204 Q-6 196 14 212 L14 300 Q14 342 24 354 Z", "#6b4a2f") +
        path("M-58 300 Q-54 260 -60 226 M-50 330 Q-48 310 -52 290 M8 290 Q4 256 10 226 M4 330 Q2 316 6 300 M-40 212 Q-34 206 -28 210 M-16 208 Q-8 206 -2 212", "none", 'stroke="#4a3218" stroke-width="2" stroke-linecap="round"') +
        oval(-60, 208, 16, 9, "#5fae86") + oval(-36, 197, 18, 9, "#7fc49a") + oval(-8, 199, 17, 8, "#5fae86") + oval(12, 208, 13, 8, "#7fc49a") +
        path("M-50 354 V268 A25 26 0 0 1 0 268 V354 Z", "#3a2147", 'stroke="#a8743f" stroke-width="4"') + path("M-34 248 V354 M-17 248 V354", "none", 'stroke="#2a1a3e" stroke-width="1.5"') +
        circle(-25, 272, 9, "#ffdc83", 'stroke="#a8743f" stroke-width="2.5"') + path("M-25 263 V281 M-34 272 H-16", "none", 'stroke="#a8743f" stroke-width="1.5"') + circle(-6, 314, 3.2, "#ffdc83") +
        line(-62, 248, -55, 248, "#54391f", 2) + oval(-62, 262, 14, 16, "#ffb84a", 'opacity=".22"') + line(-62, 248, -62, 254, "#54391f", 1.5) + rect(-67, 254, 10, 13, "#ffb84a", 'rx="3" class="lp-twinkle"') + rect(-68, 252, 12, 3, "#54391f") +
        [[-64, 348, 7, "#e8556a"], [-52, 351, 4, "#ff9d6b"], [8, 350, 5, "#e8556a"], [18, 349, 7, "#ff9d6b"]].map(function (m) { return rect(m[0] - 1.5, m[1] - 1, 3, 6, "#fff1e0") + path("M" + (m[0] - m[2]) + " " + m[1] + " Q" + m[0] + " " + (m[1] - m[2] * 1.5) + " " + (m[0] + m[2]) + " " + m[1] + " Z", m[3]); }).join("");
    },
    "door-hatch": function () { // A riveted ship's hatch with a porthole full of fish and a big wheel to turn.
      const rivets = [[-54, 208], [-40, 204], [-25, 203], [-10, 204], [4, 208], [-58, 230], [-58, 256], [-58, 282], [-58, 308], [-58, 334], [8, 230], [8, 256], [8, 282], [8, 308], [8, 334]];
      return rect(-62, 196, 74, 158, "#4a5470", 'rx="14"') + rect(-54, 206, 58, 142, "#6a7a98", 'rx="10"') + rivets.map(function (r) { return circle(r[0], r[1], 2, "#a8b4c4"); }).join("") +
        circle(-25, 246, 24, "#2a3a60") + circle(-25, 246, 20, "#1a4f8a") + path("M-44 252 Q-34 246 -25 252 T-6 252 V256 Q-20 266 -44 256 Z", "#2a6db0") +
        path("M-34 240 q8 -7 14 0 q-6 7 -14 0 Z M-34 240 l-6 -5 v10 Z", "#ff9d6b") + circle(-23, 239, 1.1, "#2a1a3e") + path("M-14 254 q5 -4 9 0 q-4 4 -9 0 Z M-14 254 l-4 -3 v6 Z", "#ffdc83") +
        circle(-11, 236, 1.8, "#cfe8ff", 'opacity=".8"') + circle(-9, 230, 1.2, "#cfe8ff", 'opacity=".8"') + path("M-39 232 A19 19 0 0 1 -28 227", "none", 'stroke="#fff" stroke-width="2" opacity=".5" stroke-linecap="round"') +
        circle(-25, 310, 18, "none", 'stroke="#e8556a" stroke-width="5"') + path("M-25 289 V331 M-46 310 H-4 M-40 295 L-10 325 M-10 295 L-40 325", "none", 'stroke="#e8556a" stroke-width="3.5" stroke-linecap="round"') + circle(-25, 310, 6, "#a8b4c4");
    },
    "door-stained": function () { // A pointed cathedral arch of stained glass, its panes fanning out around a moon.
      const hub = [-25, 276], rim = [[-54, 276], [-54, 256], [-48, 238], [-38, 220], [-25, 204], [-12, 220], [-2, 238], [4, 256], [4, 276]];
      const hues = ["#c85a8e", "#6d4bb0", "#70b8eb", "#ffb84a", "#ffb84a", "#70b8eb", "#6d4bb0", "#c85a8e"];
      let panes = "";
      hues.forEach(function (fill, i) { panes += path("M" + hub.join(" ") + " L" + rim[i].join(" ") + " L" + rim[i + 1].join(" ") + " Z", fill, 'stroke="#2a1a3e" stroke-width="2" stroke-linejoin="round"'); });
      const low = ["#70ebea", "#ff8ecb", "#ffdc83", "#c9a8ff", "#ffb84a", "#7fc49a", "#ffdc83", "#70b8eb", "#ff8ecb"];
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) panes += rect(-54 + col * 58 / 3, 278 + row * 23, 58 / 3, 23, low[row * 3 + col], 'stroke="#2a1a3e" stroke-width="2"');
      return oval(-25, 270, 44, 90, "#ffdc83", 'opacity=".1"') + path("M-64 354 V262 Q-62 222 -25 188 Q12 222 14 262 V354 Z", "#8a7aa8") + path("M-60 354 V262 Q-58 226 -25 194 Q8 226 10 262 V354 Z", "#3a3350") + panes +
        path("M-41 276 A16 16 0 0 1 -9 276 Z", "#fff8dc", 'stroke="#2a1a3e" stroke-width="2"') + path("M-25 276 m-9 0 a11 11 0 0 1 14 -9 a9 9 0 0 0 -7 9 Z", "#d9c79a") +
        path(star(-25, 242, 7), "#fff8dc", 'class="lp-twinkle"') + path(star(-40, 262, 3.5), "#fff8dc") + path(star(-10, 262, 3.5), "#fff8dc") + path(star(-25, 312, 7), "#fff8dc") +
        circle(1, 318, 3.6, "#ffdc83", 'stroke="#2a1a3e" stroke-width="1"') + rect(-64, 350, 78, 5, "#6a5c80", 'rx="1"');
    },
    "door-clockwork": function () { // A brass vault of meshing gears, with a dial and a little puff of steam.
      function gear(x, y, r, fill) { return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .32) + '" stroke-dasharray="' + round(r * .36) + " " + round(r * .3) + '"') + circle(x, y, r * .8, fill) + circle(x, y, r * .3, "#3a2c1c"); }
      return rect(-62, 196, 74, 158, "#7a5a2a", 'rx="4"') + rect(-56, 202, 62, 152, "#3a2c1c") +
        path("M-50 208 V226 H-34 M2 346 V322 H-14 M-50 346 V332 H-40", "none", 'stroke="#a8743f" stroke-width="4" stroke-linejoin="round"') +
        gear(-25, 282, 26, "#d9b24a") + gear(-46, 316, 13, "#c0764f") + gear(-3, 322, 15, "#e0c070") + gear(-44, 246, 11, "#e0c070") + gear(-6, 240, 17, "#c0764f") +
        path(star(-25, 282, 8), "#fff8dc") +
        circle(-25, 218, 12, "#fff1cd", 'stroke="#d9b24a" stroke-width="3"') + path("M-25 218 V210 M-25 218 L-19 221", "none", 'stroke="#3a2c1c" stroke-width="1.8" stroke-linecap="round"') +
        [[10, 203, 4], [17, 198, 5.5], [9, 192, 4.5]].map(function (p, i) { return circle(p[0], p[1], p[2], "#e8dff0", 'opacity="' + (.6 - i * .15) + '" class="lp-twinkle" style="animation-delay:' + (i * .4) + 's"'); }).join("") +
        [[-58, 200], [8, 200], [-58, 350], [8, 350]].map(function (r) { return circle(r[0], r[1], 2.4, "#ffdc83"); }).join("");
    },
    "door-skystair": function () { // The grand prize: golden doors thrown open on the night sky, and a stair of light climbing up to the moon.
      function stair(t) { // The stair at t (0 floor, 1 moon): its height, centre and half-width. It winds, narrows and bunches up with distance.
        const eased = 1 - Math.pow(1 - t, 1.7);
        return { y: round(354 - 112 * eased), c: round(-25 + Math.sin(t * Math.PI * 2.2) * 11 * (1 - t * .7)), w: round(22 * (1 - eased) + 2) };
      }
      let left = "", right = "", rungs = "";
      for (let i = 0; i <= 14; i++) {
        const s = stair(i / 14);
        left += (i ? " L" : "M") + round(s.c - s.w) + " " + s.y; // Up the left edge...
        right = " L" + round(s.c + s.w) + " " + s.y + right;     // ...and back down the right.
        if (i < 14) rungs += line(round(s.c - s.w), s.y, round(s.c + s.w), s.y, "#e8a23c", round(2.4 - i * .12));
      }
      const steps = path(left + right + " Z", "#fff8dc") + rungs;
      return oval(-25, 356, 54, 9, GLOW, 'opacity=".22"') + oval(-25, 276, 48, 90, GLOW, 'opacity=".09"') +
        path("M-66 354 V236 A41 41 0 0 1 16 236 V354 Z", "#d9b24a") + path("M-61 354 V236 A36 36 0 0 1 11 236 V354 Z", "#ffdc83") + path("M-58 354 V236 A33 33 0 0 1 8 236 V354 Z", "#0d1230") +
        oval(-34, 262, 24, 34, "#c85a8e", 'opacity=".22"') + oval(-10, 300, 24, 40, "#70b8eb", 'opacity=".18"') +
        scatter(77, 16, function (roll, i) { return circle(round(roll(-54, 4)), round(roll(214, 330)), round(roll(.6, 1.5)), "#fff", i % 3 ? 'opacity=".8"' : 'class="lp-twinkle" style="animation-delay:' + round(i * .23) + 's"'); }) +
        circle(-25, 228, 22, "#fff1cd", 'opacity=".18"') + circle(-25, 228, 14, "#fff1cd", 'class="lp-neon"') + circle(-30, 224, 3, "#e6d5a8") + circle(-20, 232, 2.2, "#e6d5a8") + steps +
        path("M-58 354 V236 Q-58 222 -50 212 L-44 224 V344 Z", "#3f7a9c") + path("M8 354 V236 Q8 222 0 212 L-6 224 V344 Z", "#3f7a9c") + path("M-55 348 V238 Q-55 228 -50 220 L-47 226 V342 Z M5 348 V238 Q5 228 0 220 L-3 226 V342 Z", "none", 'stroke="#ffdc83" stroke-width="1.4"') +
        path(star(-51, 284, 3.5), "#ffdc83") + path(star(1, 284, 3.5), "#ffdc83") +
        path(star(-25, 195, 9), "#fff8dc", 'class="lp-twinkle"') + path(star(-46, 204, 5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:.5s"') + path(star(-4, 204, 5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:1s"');
    },

    // Star Capsule floor
    // Floors run from y = 350 down to 500 and repeat side by side, so patterns repeat evenly across 400 or stay inside the tile.

    "floor-chevron": function () { // Warm parquet laid in stacked zigzag bands.
      const woods = ["#8a5a3f", "#9a6a48", "#7a4f36", "#a8744f"];
      let out = rect(0, 350, 400, 150, woods[3]);
      for (let band = 0; band < 11; band++) {
        const top = 370 + band * 15;
        const low = function (y) { return Math.min(y, 500); };                                                   // Nothing draws below the floor's edge.
        let d = "M0 " + low(top);
        for (let x = 0; x < 400; x += 50) d += " L" + (x + 25) + " " + low(top - 20) + " L" + (x + 50) + " " + low(top); // The zigzag's top edge.
        const edge = d;                                                                                          // The line between planks, drawn on its own so the band's closed ends don't draw a dark seam where tiles meet.
        d += " V" + low(top + 15);
        for (let x = 400; x > 0; x -= 50) d += " L" + (x - 25) + " " + low(top - 5) + " L" + (x - 50) + " " + low(top + 15); // And back along its bottom edge.
        out += path(d + " Z", woods[band % 4]) + path(edge, "none", 'stroke="#4f3020" stroke-width="1"');
      }
      return out + rect(0, 350, 400, 3, "#e5c090", 'opacity=".5"');
    },

    "floor-terrazzo": function () { // Polished stone flecked with candy-coloured chips.
      const chips = ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff", "#fff1e0", "#7fc49a"];
      return rect(0, 350, 400, 150, "#3f3650") + scatter(41, 90, function (roll, i) {
        const x = roll(8, 392), y = roll(358, 494), s = roll(3, 8), a = roll(0, 6.28);
        const corner = function (turn) { return round(x + Math.cos(a + turn) * s) + " " + round(y + Math.sin(a + turn) * s * .7); };     // Squashed a little, so the chips lie flat.
        return path("M" + corner(0) + " L" + corner(2.1) + " L" + corner(4.2) + " Z", chips[i % 6], 'opacity=".85" stroke="' + chips[i % 6] + '" stroke-width="2.5" stroke-linejoin="round"'); // Rounded off, like tumbled stone.
      }) + rect(0, 350, 400, 3, "#c9a8ff", 'opacity=".45"');
    },

    "floor-pebbles": function () { // Rounded river stones set in dark mortar; each stone has a soft top-light.
      const stones = ["#6a6e88", "#7c7f98", "#585c78", "#8a84a0", "#6f7a8c"], roll = dice(52);
      let out = rect(0, 350, 400, 150, "#232738");
      for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) {
        const x = 25 + col * 50 + roll(-3, 3) + (row % 2 ? 0 : 6) - 3, y = 366 + row * 30 + roll(-3, 3), rx = roll(17, 22), ry = roll(11, 14);
        out += oval(round(x), round(y), round(rx), round(ry), stones[(row * 3 + col) % 5]) + oval(round(x - 3), round(y - 4), round(rx * .55), round(ry * .4), "#ffffff", 'opacity=".12"');
      }
      return out + rect(0, 350, 400, 3, "#b6b0c8", 'opacity=".4"');
    },

    "floor-tatami": function () { // Woven straw mats bound with dark cloth, half a mat offset on the second row.
      let weave = "";
      for (let x = 3; x < 400; x += 6) weave += "M" + x + " 353 V500 ";                                                  // The fine straw lines, all one shape.
      return rect(0, 350, 400, 150, "#9a9457") + path(weave, "none", 'stroke="#7f7a45" stroke-width="1.2"') +
        rect(0, 350, 400, 5, "#27402f") + rect(0, 423, 400, 7, "#27402f") + rect(0, 495, 400, 5, "#27402f") +             // Cloth bindings along the rows.
        rect(197, 350, 6, 75, "#27402f") + rect(0, 350, 3, 75, "#27402f") + rect(397, 350, 3, 75, "#27402f") +            // Upright bindings between the mats of the first row (the edge ones meet at the join).
        rect(97, 427, 6, 70, "#27402f") + rect(297, 427, 6, 70, "#27402f");                                               // And the second row's, half a mat along.
    },

    "floor-cloudwalk": function () { // Soft banks of cloud to pad about on. Each bank's bumps add up to exactly 400, so banks meet at the join.
      const bank = function (y, a, b, colour) { // a and b are the widths of two alternating bumps.
        let d = "M0 " + y;
        for (let i = 0; i < 4; i++) d += " a" + a / 2 + " " + a * .46 + " 0 0 1 " + a + " 0 a" + b / 2 + " " + b * .46 + " 0 0 1 " + b + " 0";
        return path(d + " V500 H0 Z", colour);
      };
      return rect(0, 350, 400, 150, "#5a6fc0") +
        scatter(44, 14, function (roll) { return path(star(round(roll(10, 390)), round(roll(354, 376)), round(roll(2, 4))), "#fff1cd", 'opacity=".8"'); }) +
        bank(388, 62, 38, "#8c9fe0") + bank(420, 44, 56, "#b5c2ee") + bank(450, 66, 34, "#d6dff8") + bank(482, 40, 60, "#f0f4ff") +
        rect(0, 350, 400, 3, "#dfe6ff", 'opacity=".55"');
    },

    "floor-piano": function () { // One octave of giant keys: pad across and play. Seven white keys fit the tile exactly.
      const keyW = 400 / 7;
      let out = rect(0, 350, 400, 150, "#ddd3ec");
      for (let i = 1; i < 7; i++) out += rect(round(i * keyW - 1), 350, 2, 150, "#8d82a8");                                   // The gaps between white keys.
      out += rect(0, 350, 1, 150, "#8d82a8") + rect(399, 350, 1, 150, "#8d82a8");                                               // The gap on the join, half on each tile.
      out += rect(0, 488, 400, 12, "#beb1d4");                                                                                   // The keys' front lip.
      [1, 2, 4, 5, 6].forEach(function (i) { out += rect(round(i * keyW - 14), 350, 28, 92, "#241a36", 'rx="3"') + rect(round(i * keyW - 9), 354, 6, 72, "#4d4066", 'rx="3"'); }); // Black keys, with a shine.
      const note = "m0 0 v-20 q8 2 10 8 q-4 -3 -7 -3 v18 a6 4 0 1 1 -3 -3Z";
      [[28, 470, "#c85a8e"], [142, 456, "#6d4bb0"], [258, 474, "#2f8a9a"], [370, 460, "#c85a8e"]].forEach(function (n) { out += path("M" + n[0] + " " + n[1] + note, n[2], 'opacity=".75"'); }); // A few music notes drifting over the keys.
      return out + rect(0, 350, 400, 3, "#f6f0ff", 'opacity=".6"');
    },

    "floor-patchwork": function () { // A quilt-stitched carpet: 24 little patches, each with its own motif and dashed stitching.
      const cloths = ["#8a3f6a", "#3f6a8a", "#b9843f", "#5a4a95", "#3f8a70", "#a84f4f"], ink = "#fff1e0";
      let out = "";
      for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
        const x = col * 50, y = 350 + row * 50, mid = x + 25, midY = y + 25, kind = (row * 3 + col) % 5;
        out += rect(x, y, 50, 50, cloths[(row * 2 + col) % 6]) + rect(x + 3, y + 3, 44, 44, "none", 'stroke="#ffffff" stroke-opacity=".6" stroke-width="1.2" stroke-dasharray="3 3"');
        if (kind === 0) out += circle(mid - 9, midY - 8, 3.5, ink) + circle(mid + 9, midY - 6, 3.5, ink) + circle(mid, midY + 8, 3.5, ink);        // Dots.
        if (kind === 1) out += path("M" + mid + " " + (midY + 12) + " C" + (mid - 18) + " " + (midY - 2) + " " + (mid - 9) + " " + (midY - 13) + " " + mid + " " + (midY - 5) + " C" + (mid + 9) + " " + (midY - 13) + " " + (mid + 18) + " " + (midY - 2) + " " + mid + " " + (midY + 12) + "Z", ink); // A heart.
        if (kind === 2) out += path("M" + (x + 9) + " " + (y + 13) + " H" + (x + 41) + " M" + (x + 9) + " " + midY + " H" + (x + 41) + " M" + (x + 9) + " " + (y + 37) + " H" + (x + 41), "none", 'stroke="' + ink + '" stroke-width="3" stroke-linecap="round"'); // Stripes.
        if (kind === 3) out += path(star(mid, midY, 14), ink);                                                                                        // A star.
        if (kind === 4) out += circle(mid, midY, 4, "#ffdc83") + [0, 1, 2, 3, 4].map(function (p) { const a = p / 5 * 6.283; return circle(round(mid + Math.cos(a) * 9), round(midY + Math.sin(a) * 9), 4.5, ink); }).join(""); // A flower.
      }
      return out + rect(0, 350, 400, 3, "#fff1e0", 'opacity=".4"');
    },

    "floor-star-mosaic": function () { // A jewel-toned mosaic: twelve eight-pointed stars, each laid out in a 100-wide box then squashed a little to lie flat.
      const eight = function (outer, inner) { // An eight-pointed star as one polygon.
        let d = "";
        for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 - 1.5708, r = i % 2 ? inner : outer; d += (i ? " L" : "M") + round(Math.cos(a) * r) + " " + round(Math.sin(a) * r); }
        return d + "Z";
      };
      const corners = "M-50 -50 L-22 -50 L-50 -22Z M50 -50 L22 -50 L50 -22Z M-50 50 L-22 50 L-50 22Z M50 50 L22 50 L50 22Z";
      const cw = 400 / 6, ch = 75;
      let out = rect(0, 350, 400, 150, "#14304a");
      for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
        const even = (row + col) % 2;
        out += group(rect(-50, -50, 100, 100, even ? "#173f5e" : "#3a1f52") + path(corners, even ? "#a88a3e" : "#4f8ab0") + path(eight(47, 24), even ? "#d9b860" : "#c06a9c") +
          path(eight(27, 13), even ? "#6a2a50" : "#14304a") + path(star(0, 0, 11), "#fff0d0", (row + col) % 3 ? "" : 'class="lp-twinkle" style="animation-delay:' + (col * .3) + 's"'),
          'transform="translate(' + round(cw / 2 + col * cw) + " " + (350 + ch / 2 + row * ch) + ") scale(" + round(cw / 100) + " " + (ch / 100) + ')"');
      }
      return out + rect(0, 350, 400, 3, "#ffdc83", 'opacity=".7"');
    },

    "floor-frozen-lake": function () { // Clear blue ice with hairline cracks, snowflakes caught beneath it and the loops a skater left behind.
      const flake = function (x, y, s, o) { // A six-armed snowflake with little V tips.
        let d = "";
        for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283, c = Math.cos(a), n = Math.sin(a); d += "M0 0 L" + round(c * 12) + " " + round(n * 12) + " M" + round(c * 7 - n * 3.5) + " " + round(n * 7 + c * 3.5) + " L" + round(c * 11) + " " + round(n * 11) + " M" + round(c * 7 + n * 3.5) + " " + round(n * 7 - c * 3.5) + " L" + round(c * 11) + " " + round(n * 11) + " "; }
        return path(d, "none", 'stroke="#e4f4ff" stroke-width="1.4" stroke-linecap="round" opacity="' + o + '" transform="translate(' + x + " " + y + ") scale(" + s + ' .8)"');
      };
      return rect(0, 350, 400, 150, "#2f5e8c") +
        path("M0 392 Q100 374 200 392 T400 392 V350 H0 Z", "#4a82b0", 'opacity=".55"') + path("M0 448 Q100 430 200 448 T400 448 V500 H0 Z", "#25496f", 'opacity=".6"') +      // Paler and deeper patches in the ice.
        [[26, 44], [152, 34], [290, 46]].map(function (s) { return path("M" + s[0] + " 352 h" + s[1] + " l-30 148 h-" + s[1] + " Z", "#d6f0ff", 'opacity=".1"'); }).join("") +      // Long reflections of the window light.
        path("M40 372 L70 392 L58 412 L96 430 M70 392 L104 384 L132 398 M58 412 L34 440 M256 362 L240 388 L272 408 L256 438 L290 470 M272 408 L312 402 M240 388 L212 400 M340 410 L366 436 L352 462 M366 436 L388 430 M120 462 L150 478 L188 470 M150 478 L146 496", "none", 'stroke="#d6f0ff" stroke-width="1.1" stroke-linejoin="round" opacity=".7"') + // The cracks.
        path("M60 476 C80 454 118 458 120 476 C122 494 80 496 60 476 C40 456 8 458 10 476 C12 494 48 494 60 476 Z", "none", 'stroke="#ffffff" stroke-width="1.2" stroke-dasharray="6 4" opacity=".55"') +  // A skater's figure of eight.
        flake(112, 372, 1, .8) + flake(214, 444, 1.2, .9) + flake(330, 374, .9, .7) + flake(372, 482, 1.1, .85) + flake(36, 410, .7, .6) + flake(294, 448, .7, .6) + flake(186, 374, .6, .55) +
        scatter(46, 22, function (roll) { return circle(round(roll(8, 392)), round(roll(356, 496)), round(roll(.8, 2.2)), "#e4f4ff", 'opacity="' + round(roll(.25, .7)) + '"'); }) +
        rect(0, 350, 400, 3, "#cfeaff", 'opacity=".75"');
    },

    "floor-lantern-pool": function () { // A still, dark pool: the moon's reflection breaks into ripples under Lumi while paper lanterns float and flicker around her.
      const lantern = function (l, i) { // Glow, ripple ring, lantern and its wobbling reflection.
        const x = l[0], y = l[1], s = l[2];
        return oval(x, y + 2, 36 * s, 11 * s, "#ffb84a", 'opacity=".16"') +
          oval(x, y + 4, 26 * s, 7 * s, "none", 'stroke="#ffdc83" stroke-width="1" opacity=".45"') +
          path("M" + round(x - 11 * s) + " " + (y + 2) + " L" + round(x + 11 * s) + " " + (y + 2) + " L" + round(x + 8 * s) + " " + round(y - 14 * s) + " L" + round(x - 8 * s) + " " + round(y - 14 * s) + " Z", "#ffdc83", 'class="lp-twinkle" style="animation-delay:' + (i * .41 % 2).toFixed(2) + 's"') +
          path("M" + round(x - 11 * s) + " " + (y + 2) + " L" + round(x + 11 * s) + " " + (y + 2), "none", 'stroke="#d9722a" stroke-width="2"') + rect(round(x - 3 * s), round(y - 11 * s), round(6 * s), round(4 * s), "#ff8e4a") +
          oval(x, round(y + 12 * s), round(9 * s), round(2 * s), "#ffdc83", 'opacity=".4"');
      };
      const ripples = [[366, 26, 5], [379, 42, 4.5], [393, 60, 5], [408, 80, 5], [424, 102, 5.5], [442, 124, 6], [462, 148, 6.5], [484, 172, 7]];
      return rect(0, 350, 400, 150, "#0a1030") + path("M0 410 Q100 396 200 410 T400 410 V500 H0 Z", "#101a48", 'opacity=".7"') +
        scatter(48, 34, function (roll) { return circle(round(roll(6, 394)), round(roll(358, 496)), round(roll(.5, 1.5)), "#e6d5ff", 'opacity="' + round(roll(.3, .9)) + '"'); }) +
        ripples.map(function (r, i) { return oval(200, r[0], r[1], r[2], "#f4e8c8", 'opacity="' + round(.9 - i * .08) + '"'); }).join("") +                                                         // The moon's reflection, breaking into wider ripples nearer us.
        path("M0 440 Q50 432 100 440 T200 440 T300 440 T400 440 M0 470 Q66 462 133 470 T266 470 T400 470", "none", 'stroke="#2b3f8a" stroke-width="1.4" opacity=".7"') +
        [[30, 392, 1.5], [98, 374, 1.05], [150, 386, .85], [250, 374, .9], [312, 388, 1.2], [344, 408, 1.5], [158, 490, 1.1], [246, 492, .9], [344, 486, 1.15], [40, 484, 1.3]].map(lantern).join("") +
        [[150, 412, 3], [252, 408, 2.4], [376, 460, 2.6], [32, 440, 2.2]].map(function (s, i) { return path(star(s[0], s[1], s[2] * 2), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .6) + 's"'); }).join("") +
        rect(0, 350, 400, 3, GLOW, 'opacity=".6"');
    },

    // Star Capsule window frame
    "frame-lattice": function () { // A diamond window with leaded crossing bars and a little sill ledge under it.
      return path(CLIPS["frame-lattice"], "none", 'stroke="#d9b24a" stroke-width="6" stroke-linejoin="round"') +
        path("M170 128.5 L230 193.5 M185 112.5 L245 177.5 M155 144.5 L215 209.5 M230 128.5 L170 193.5 M215 112.5 L155 177.5 M245 144.5 L185 209.5", "none", 'stroke="#d9b24a" stroke-width="1.8" opacity=".8"') +
        circle(200, 96, 4, "#fff1cd") + circle(260, 161, 4, "#fff1cd") + circle(140, 161, 4, "#fff1cd") + ART.sill("#d9b24a");
    },
    "frame-heart": function () { // A heart-shaped opening in a pink frame with a small bow on top.
      return path(CLIPS["frame-heart"], "none", 'stroke="#ff8ecb" stroke-width="7" stroke-linejoin="round"') +
        path(CLIPS["frame-heart"], "none", 'stroke="#ffd2e8" stroke-width="2" stroke-linejoin="round"') +
        path("M200 110 L184 100 Q180 108 184 118 Z M200 110 L216 100 Q220 108 216 118 Z", "#ffdc83") + circle(200, 110, 3.6, "#d9b24a") + rect(158, 224, 84, 8, "#ff8ecb", 'rx="3"');
    },
    "frame-cloud": function () { // A puffy cloud-shaped hole, white and soft, with a few tiny raindrops on the sill.
      return path(CLIPS["frame-cloud"], "none", 'stroke="#f4f8ff" stroke-width="9" stroke-linejoin="round"') +
        path(CLIPS["frame-cloud"], "none", 'stroke="#c9d6f2" stroke-width="1.5" stroke-linejoin="round" transform="translate(200 165) scale(1.07) translate(-200 -165)"') +
        path("M166 224 q3 6 0 8 q-3 -2 0 -8 Z M200 226 q3 6 0 8 q-3 -2 0 -8 Z M234 224 q3 6 0 8 q-3 -2 0 -8 Z", "#8fc6f5");
    },
    "frame-cottage": function () { // A plain square window with both wooden shutters folded open against the wall, and a flower box.
      function shutter(x) { // One shutter: a board with slats.
        let slats = "";
        for (let y = 114; y < 220; y += 9) slats += "M" + (x + 3) + " " + y + " h22 ";
        return rect(x, 106, 28, 120, "#5f8a6e", 'rx="2"') + path(slats, "none", 'stroke="#3f6a50" stroke-width="2"');
      }
      return shutter(117) + shutter(255) + path(CLIPS["frame-cottage"], "none", 'stroke="#f2e6cf" stroke-width="5" stroke-linejoin="round"') + line(200, 106, 200, 226, "#f2e6cf", 3) + line(148, 164, 252, 164, "#f2e6cf", 3) +
        rect(136, 224, 128, 12, "#a8743f", 'rx="2"') + path("M144 224 q3 -9 6 0 M160 224 q3 -11 6 0 M176 224 q3 -9 6 0 M222 224 q3 -9 6 0 M238 224 q3 -11 6 0 M250 224 q3 -9 6 0", "none", 'stroke="#5fae86" stroke-width="2"') +
        circle(147, 216, 3.4, "#ff8ecb") + circle(163, 213, 3.4, "#ffdc83") + circle(179, 216, 3.4, "#ff8e8e") + circle(225, 216, 3.4, "#ffdc83") + circle(241, 213, 3.4, "#ff8ecb") + circle(253, 216, 3.4, "#c9a8ff");
    },
    "frame-star": function () { // A five-pointed window in gold, with a little sparkle at each tip.
      const tips = [[200, 96], [260, 146], [238, 220], [162, 220], [140, 146]];
      return path(CLIPS["frame-star"], "none", 'stroke="#ffdc83" stroke-width="7" stroke-linejoin="round"') + path(CLIPS["frame-star"], "none", 'stroke="#b8862e" stroke-width="1.5" stroke-linejoin="round"') +
        tips.map(function (t, i) { return path(star(t[0], t[1], 7), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + i * .3 + 's"'); }).join("") + rect(160, 224, 80, 8, "#ffdc83", 'rx="3"');
    },
    "frame-keyhole": function () { // The opening of an old lock, set in a big brass plate with screws.
      return path("M132 92 H268 V232 H132 Z " + CLIPS["frame-keyhole"], "#c99b3f", 'fill-rule="evenodd" stroke="#8a6220" stroke-width="2"') +
        path(CLIPS["frame-keyhole"], "none", 'stroke="#ffe9a8" stroke-width="2.5"') +
        [[140, 100], [260, 100], [140, 224], [260, 224]].map(function (s) { return circle(s[0], s[1], 4, "#8a6220") + line(s[0] - 3, s[1] - 2, s[0] + 3, s[1] + 2, "#ffe9a8", 1.2); }).join("") +
        path("M150 128 Q144 150 150 172 M250 128 Q256 150 250 172", "none", 'stroke="#ffe9a8" stroke-width="1.5" opacity=".5"');
    },
    "frame-lancet": function () { // Three tall pointed church-window arches side by side.
      const stone = "#d8cfe4";
      return path("M136 232 V144 Q136 116 160 98 Q176 110 180 124 Q184 106 200 90 Q216 106 220 124 Q224 110 240 98 Q264 116 264 144 V232 Z M144 226 V144 Q144 120 160 108 Q176 120 176 144 V226 Z M184 226 V132 Q184 110 200 96 Q216 110 216 132 V226 Z M224 226 V144 Q224 120 240 108 Q256 120 256 144 V226 Z", stone, 'fill-rule="evenodd" stroke="#9a8cb0" stroke-width="1.5"') +
        path("M144 170 H176 M184 160 H216 M224 170 H256", "none", 'stroke="#9a8cb0" stroke-width="2"') + circle(180, 122, 3, "#9a8cb0") + circle(220, 122, 3, "#9a8cb0") + rect(130, 228, 140, 7, stone, 'rx="2"');
    },
    "frame-rose": function () { // A cathedral rose window: coloured glass petals round the rim, a clear middle, stone tracery over the lot.
      const glass = ["#e8556a", "#ffb84a", "#70b8eb", "#9c73b8"];
      let petals = "", ribs = "", rivets = "";
      for (let i = 0; i < 16; i++) { // Sixteen wedges of rim, each its own colour of glass.
        const a = (i / 16) * Math.PI * 2, b = ((i + 1) / 16) * Math.PI * 2, rx = 60, ry = 65, ix = 42, iy = 46;
        petals += path("M" + round(200 + ix * Math.cos(a)) + " " + round(161 + iy * Math.sin(a)) + " L" + round(200 + rx * Math.cos(a)) + " " + round(161 + ry * Math.sin(a)) + " L" + round(200 + rx * Math.cos(b)) + " " + round(161 + ry * Math.sin(b)) + " L" + round(200 + ix * Math.cos(b)) + " " + round(161 + iy * Math.sin(b)) + " Z", glass[i % 4], 'opacity=".78"');
        rivets += star(round(200 + 51 * Math.cos(a + Math.PI / 16)), round(161 + 55.5 * Math.sin(a + Math.PI / 16)), 2.6) + " "; // A small gold sparkle in the middle of each pane.
        ribs += "M" + round(200 + ix * Math.cos(a)) + " " + round(161 + iy * Math.sin(a)) + " L" + round(200 + rx * Math.cos(a)) + " " + round(161 + ry * Math.sin(a)) + " ";
      }
      return petals + path(rivets, "#fff1cd", 'opacity=".9"') + path(ribs, "none", 'stroke="#5a4a70" stroke-width="2"') + oval(200, 161, 42, 46, "none", 'stroke="#5a4a70" stroke-width="3"') +
        path(CLIPS["frame-rose"], "none", 'stroke="#d8cfe4" stroke-width="8"') + path(CLIPS["frame-rose"], "none", 'stroke="#7a6a90" stroke-width="1.5"') +
        path("M200 115 V207 M158 161 H242", "none", 'stroke="#5a4a70" stroke-width="2"') + circle(200, 161, 5, "#ffdc83", 'stroke="#5a4a70" stroke-width="2"') + rect(150, 224, 100, 8, "#d8cfe4", 'rx="3"');
    },
    "frame-geode": function () { // A cracked-open amethyst: rough rock outside, a ring of crystal facets, and a jagged glowing hole.
      const hole = [[198, 96], [226, 104], [240, 98], [256, 124], [250, 146], [260, 172], [246, 196], [250, 216], [222, 222], [204, 226], [180, 220], [156, 224], [146, 200], [150, 178], [140, 156], [150, 134], [144, 112], [170, 108]];
      function out(p, kx, ky) { return round(200 + (p[0] - 200) * kx) + " " + round(161 + (p[1] - 161) * ky); } // A point pushed out from the middle of the hole.
      const shades = ["#7a4bb8", "#a06fff", "#5a3a9c"];
      let rock = "M", facets = "";
      hole.forEach(function (p, i) {
        const next = hole[(i + 1) % hole.length], k = i % 2 ? 1.26 : 1.14, kNext = i % 2 ? 1.14 : 1.26;
        rock += (i ? " L" : "") + out(p, i % 2 ? 1.34 : 1.27, i % 2 ? 1.26 : 1.2);
        facets += path("M" + p[0] + " " + p[1] + " L" + next[0] + " " + next[1] + " L" + out(next, kNext, kNext) + " L" + out(p, k, k) + " Z", shades[i % 3], i % 5 === 0 ? 'class="lp-twinkle" style="animation-delay:' + round(i * .2) + 's"' : "");
        if (i % 2) facets += line(p[0], p[1], out(p, k, k).split(" ")[0], out(p, k, k).split(" ")[1], "#e6d4ff", 1, 'opacity=".55"'); // A pale ridge down every other facet.
      });
      return path(rock + " Z " + CLIPS["frame-geode"], "#33204a", 'fill-rule="evenodd" stroke="#1f1430" stroke-width="2" stroke-linejoin="round"') + facets +
        path(CLIPS["frame-geode"], "none", 'stroke="#e6d4ff" stroke-width="2.5" stroke-linejoin="round" class="lp-neon"') +
        [[146, 100], [262, 118], [264, 214], [150, 226]].map(function (s, i) { return path(star(s[0], s[1], 5), "#fff", 'class="lp-twinkle" style="animation-delay:' + i * .5 + 's"'); }).join("");
    },
    "frame-orrery": function () { // A round brass orrery: the view fills the great disc, two tilted orbits ring it (clear of the glass) and carry little planets.
      function onRing(tilt, deg) { // A spot on one of the two tilted orbits, in room coordinates.
        const t = deg * Math.PI / 180, a = tilt * Math.PI / 180, x = 82 * Math.cos(t), y = 66 * Math.sin(t);
        return [round(200 + x * Math.cos(a) - y * Math.sin(a)), round(161 + x * Math.sin(a) + y * Math.cos(a))];
      }
      const planets = [[onRing(-28, 200), 5, "#ff9d6b"], [onRing(28, 20), 6, "#70ebea"], [onRing(-28, 70), 4, "#ffdc83"], [onRing(28, 250), 4.5, "#ff8ecb"]];
      return oval(200, 161, 82, 66, "none", 'stroke="#c9a15a" stroke-width="2.5" transform="rotate(-28 200 161)"') + oval(200, 161, 82, 66, "none", 'stroke="#c9a15a" stroke-width="2.5" transform="rotate(28 200 161)"') +
        path(CLIPS["frame-orrery"], "none", 'stroke="#ffdc83" stroke-width="8"') + path(CLIPS["frame-orrery"], "none", 'stroke="#fff4cf" stroke-width="2.5" class="lp-neon"') +
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(function (i) { const a = i / 12 * Math.PI * 2, x = round(200 + 56 * Math.cos(a)), y = round(161 + 56 * Math.sin(a)); return circle(x, y, 1.6, i % 3 ? "#b8862e" : "#fff8dc"); }).join("") + // Hour marks just inside the disc.
        planets.map(function (p, i) { return circle(p[0][0], p[0][1], p[1] + 5, p[2], 'opacity=".22"') + circle(p[0][0], p[0][1], p[1], p[2], 'class="lp-twinkle" style="animation-delay:' + i * .5 + 's"') + circle(round(p[0][0] - p[1] * .3), round(p[0][1] - p[1] * .3), round(p[1] * .3), "#fff", 'opacity=".7"'); }).join("") +
        path("M151.5 93.5 A11 11 0 1 0 151.5 112.5 A13 13 0 0 1 151.5 93.5 Z", "#fff1cd", 'class="lp-neon"') + path(star(252, 92, 5), "#fff8dc", 'class="lp-twinkle"') + path(star(172, 86, 3.5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.8s"') + // The moon charm and two sparkles.
        rect(160, 225, 80, 7, "#ffdc83", 'rx="3"') + path("M176 232 l8 10 h32 l8 -10", "none", 'stroke="#c9a15a" stroke-width="2.5"') + path(star(200, 238, 4), "#fff8dc");
    },

    // Star Capsule lamp
    "lamp-arc": function () { // A slim arched floor lamp with a coral dome, leaning out over the room.
      return oval(92, 268, 44, 40, "#ffdc83", 'opacity=".12"') + oval(26, 404, 20, 6, "#3a3048") + path("M26 402 Q22 290 56 248 Q72 230 92 238", "none", 'stroke="#c9a15a" stroke-width="4" stroke-linecap="round"') +
        path("M72 260 Q74 234 92 234 Q110 234 112 260 Z", "#e8556a") + oval(92, 260, 20, 4, "#fff1cd") + circle(92, 236, 2.6, "#c9a15a");
    },
    "lamp-firefly": function () { // A shepherd's crook with a jam jar of fireflies swinging from the hook.
      const bugs = [[46, 288], [58, 278], [66, 296], [52, 304], [62, 310]];
      return oval(50, 300, 48, 46, "#d8f27a", 'opacity=".1"') + oval(26, 404, 16, 5, "#3a3048") + path("M26 402 V252 q0 -16 16 -16 q16 0 16 14 v12", "none", 'stroke="#8a7aa8" stroke-width="3.5" stroke-linecap="round"') + rect(40, 262, 36, 58, "#bfe8ff", 'rx="7" opacity=".22" stroke="#d6f0ff" stroke-width="1.8"') + rect(44, 256, 28, 7, "#a8743f", 'rx="1.5"') +
        bugs.map(function (b, i) { return circle(b[0], b[1], 7, "#d8f27a", 'opacity=".2"') + circle(b[0], b[1], 2.4, "#efffa8", 'class="lp-twinkle" style="animation-delay:' + i * .4 + 's"'); }).join("") + line(48, 270, 48, 314, "#fff", 1.4, 'opacity=".5"');
    },
    "lamp-tulip": function () { // A big pink tulip growing straight from the floor, its bud lit from inside.
      return oval(56, 268, 42, 42, "#ff8ecb", 'opacity=".12"') + path("M56 404 Q50 340 56 268", "none", 'stroke="#5fae86" stroke-width="5" stroke-linecap="round"') +
        path("M54 404 Q24 372 26 322 Q44 356 56 384 Z", "#7fc49a") + path("M58 404 Q82 378 78 332 Q66 360 56 388 Z", "#5fae86") + path("M34 242 Q34 286 56 288 Q78 286 78 242 L66 254 L56 238 L46 254 Z", "#ff8ecb") + path("M46 254 L56 238 L66 254 Q60 280 56 282 Q52 280 46 254 Z", "#ffc2dd") + oval(56, 266, 7, 12, "#fff1cd", 'opacity=".55"') + oval(56, 405, 16, 4, "#3a2147");
    },
    "lamp-bunny": function () { // A round nightlight shaped like a sitting bunny, with long ears and a bow.
      return group(oval(56, 354, 54, 52, "#ffdcb0", 'opacity=".14"') + oval(44, 288, 7, 22, "#fff1e0", 'transform="rotate(-12 44 306)"') + oval(68, 288, 7, 22, "#fff1e0", 'transform="rotate(12 68 306)"') + oval(44, 288, 3.2, 15, "#ffc2c2", 'transform="rotate(-12 44 306)"') + oval(68, 288, 3.2, 15, "#ffc2c2", 'transform="rotate(12 68 306)"') +
        oval(56, 372, 30, 32, "#fff1e0") + oval(56, 382, 20, 20, "#ffe2b8", 'opacity=".8"') + circle(56, 332, 23, "#fff1e0") + circle(47, 330, 2.4, "#3a2a2a") + circle(65, 330, 2.4, "#3a2a2a") + path("M56 336 l-3 3 h6 Z", "#ff9aae") + oval(39, 339, 4.5, 2.4, "#ffc2c2", 'opacity=".8"') + oval(73, 339, 4.5, 2.4, "#ffc2c2", 'opacity=".8"') +
        path("M56 356 L46 350 v12 Z M56 356 L66 350 v12 Z", "#c9a8ff") + circle(56, 356, 3, "#a888e8") + oval(56, 405, 26, 4, "#3a3048"), 'transform="translate(-10 0)"');
    },
    "lamp-moon": function () { // A full-moon globe on a small turned stand, with craters and a ring of light.
      const craters = [[34, 342, 5.4], [54, 356, 3.8], [46, 332, 2.8], [60, 340, 3], [38, 362, 3]];
      return oval(46, 352, 46, 46, "#ffefc0", 'opacity=".12"') + circle(46, 352, 30, "#fff4d6", 'class="lp-neon"') + path(craters.map(function (c) { return "M" + (c[0] - c[2]) + " " + c[1] + " a" + c[2] + " " + c[2] + " 0 1 0 " + c[2] * 2 + " 0 a" + c[2] + " " + c[2] + " 0 1 0 -" + c[2] * 2 + " 0Z"; }).join(" "), "#e6d3a8") + path("M24 336 A30 30 0 0 1 46 322", "none", 'stroke="#fff" stroke-width="2.5" opacity=".6" stroke-linecap="round"') +
        rect(40, 382, 12, 12, "#8a5a2a") + path("M32 394 H60 L66 404 H26 Z", "#a8743f") + oval(46, 404, 22, 4, "#5a3a20");
    },
    "lamp-mosaic": function () { // A dome of coloured glass panes held by dark lead, on a bronze stem.
      const colours = ["#e8556a", "#ffb84a", "#70b8eb", "#7fc49a", "#c9a8ff"];
      function widthAt(y) { const t = Math.min(1, Math.max(0, (306 - y) / 44)); return 42 * Math.sqrt(1 - t * t); } // Half-width of the dome at height y.
      const panes = colours.map(function () { return ""; });
      let lead = "";
      for (let row = 0; row < 3; row++) {
        const y1 = 306 - row * 14.6, y2 = 306 - (row + 1) * 14.6, w1 = widthAt(y1), w2 = widthAt(y2), cols = 7 - row;
        for (let c = 0; c < cols; c++) {
          const a1 = 56 - w1 + (2 * w1 * c) / cols, b1 = 56 - w1 + (2 * w1 * (c + 1)) / cols, a2 = 56 - w2 + (2 * w2 * c) / cols, b2 = 56 - w2 + (2 * w2 * (c + 1)) / cols;
          const d = "M" + round(a1) + " " + round(y1) + " L" + round(b1) + " " + round(y1) + " L" + round(b2) + " " + round(y2) + " L" + round(a2) + " " + round(y2) + " Z ";
          panes[(c + row * 2) % 5] += d;
          lead += d;
        }
      }
      return group(oval(56, 318, 62, 44, "#ffcf8a", 'opacity=".13"') + panes.map(function (d, i) { return path(d, colours[i]); }).join("") + path(lead, "none", 'stroke="#3a2452" stroke-width="1.4" stroke-linejoin="round"') + rect(12, 305, 88, 4, "#8a6220", 'rx="2"') + path("M12 309 q6 7 12 0 q6 7 12 0 q6 7 12 0 q6 7 12 0 q6 7 12 0 q6 7 12 0 q6 7 16 0 Z", "#b8862e") +
        circle(56, 262, 4, "#8a6220") + rect(53, 314, 6, 72, "#8a6220") + oval(56, 350, 8, 12, "#b8862e") + path("M38 392 Q56 374 74 392 L78 404 H34 Z", "#8a6220") + oval(56, 404, 22, 4, "#5a4010"), 'transform="translate(-8 0)"');
    },
    "lamp-street": function () { // An old-town street lamp with a snowy cap, an iron arm and a robin who has found a warm spot.
      return oval(54, 272, 48, 40, "#ffcf7a", 'opacity=".14"') + rect(38, 398, 32, 6, "#2e2a3e", 'rx="1"') + rect(44, 386, 20, 12, "#3a3650") + rect(50, 300, 8, 88, "#3a3650") + rect(46, 312, 16, 3, "#6a6680") + rect(46, 372, 16, 3, "#6a6680") +
        path("M54 324 H84 M84 324 q6 -2 6 -8 M78 318 v-4", "none", 'stroke="#3a3650" stroke-width="2.8" stroke-linecap="round"') + oval(84, 310, 5, 4.4, "#b05838") + circle(80, 306, 3.4, "#7a4030") + path("M77 306 l-3 1 l3 1 Z", "#ffb84a") + circle(79.4, 305.2, .6, "#fff") +
        path("M34 256 L42 298 H66 L74 256 Z", "#ffe0a0", 'opacity=".9"') + oval(54, 278, 10, 16, "#fff4cf", 'class="lp-twinkle"') + path("M46 256 L48 298 M62 256 L60 298 M38 277 H70", "none", 'stroke="#3a3650" stroke-width="2"') + rect(40, 298, 28, 4, "#3a3650", 'rx="1"') +
        path("M30 256 L54 234 L78 256 Z", "#3a3650") + path("M36 256 Q40 244 54 238 Q68 244 72 256 Q60 250 54 254 Q48 250 36 256 Z", "#f4f8ff") + circle(54, 232, 3, "#ffdc83");
    },
    "lamp-jelly": function () { // A jellyfish floating on a cord: its bell breathes with light and it trails beaded tentacles.
      const tentacles = [[36, 8], [47, -7], [58, 8], [68, -7]];
      const beads = [];
      function sway(t, y) { // How far a tentacle has swung sideways at height y: two half-waves of 50, then straight on.
        const d = y - 286; if (d >= 100) return 0;
        const seg = d < 50 ? d / 50 : (d - 50) / 50;
        return (d < 50 ? t[1] : -t[1]) * 2 * seg * (1 - seg);
      }
      tentacles.forEach(function (t, i) { for (let y = 306 + i * 7; y < 382; y += 19) beads.push([t[0] + sway(t, y), y]); }); // Beads sit right on the tentacles.
      const dots = beads.map(function (p) { const r = 1.6; return "M" + round(p[0] - r) + " " + round(p[1]) + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z"; }).join(" ");
      return line(52, 40, 52, 238, "#8a7aa8", 1.2) + oval(52, 268, 54, 44, "#c9a8ff", 'opacity=".14"') +
        path(tentacles.map(function (t, i) { return "M" + t[0] + " 286 q" + t[1] + " 25 0 50 q" + -t[1] + " 25 0 50 q" + t[1] * .5 + " 8 0 " + [22, 10, 18, 6][i]; }).join(" "), "none", 'stroke="#e6d4ff" stroke-width="2.4" opacity=".7" stroke-linecap="round"') +
        path(dots, "#fff8dc", 'class="lp-twinkle"') +
        path("M20 278 Q20 236 52 236 Q84 236 84 278 Q74 270 68 280 Q60 272 52 282 Q44 272 36 280 Q30 270 20 278 Z", "#c9a8ff", 'opacity=".92" class="lp-twinkle" style="animation-delay:.5s"') + path("M30 266 Q32 248 52 246 Q72 248 74 266", "none", 'stroke="#fff" stroke-width="3" opacity=".45" stroke-linecap="round"') + circle(44, 260, 3, "#fff8dc", 'opacity=".85"') + circle(60, 256, 2.4, "#fff8dc", 'opacity=".85"') + circle(52, 268, 2, "#fff8dc", 'opacity=".85"');
    },
    "lamp-tree": function () { // A little bare tree with light-bulb blossoms in three colours, twinkling in turns.
      const orbs = [[28, 262, 0], [50, 244, 1], [72, 254, 2], [84, 276, 0], [20, 288, 1], [40, 276, 2], [60, 272, 0], [76, 298, 1], [32, 304, 2], [52, 296, 1], [16, 312, 0], [68, 318, 2]];
      const glow = ["#ff8ecb", "#70ebea", "#ffdc83"];
      return oval(50, 294, 60, 56, "#ffdc83", 'opacity=".08"') + path("M50 402 V340 M50 340 Q34 320 30 298 Q28 282 28 266 M50 340 Q68 322 76 296 Q80 280 72 258 M50 330 Q50 300 50 248 M40 320 Q24 318 20 292 M62 324 Q78 318 84 280 M50 300 Q58 288 60 276 M50 306 Q40 294 40 280", "none", 'stroke="#7a5a44" stroke-width="3.2" stroke-linecap="round"') +
        orbs.map(function (o, i) { return circle(o[0], o[1], 7, glow[o[2]], 'opacity=".22"') + circle(o[0], o[1], 3.4, glow[o[2]], 'class="lp-twinkle" style="animation-delay:' + round(i * .23) + 's"') + circle(o[0] - 1, o[1] - 1, 1, "#fff", 'opacity=".9"'); }).join("") +
        path("M30 404 Q40 392 50 396 Q60 392 70 404 Z", "#5a4436") + oval(50, 405, 26, 4, "#3a2a22");
    },
    "lamp-starcradle": function () { // A brass crescent cupping a real captured star, orbited by a ring and little charms; the glow follows Lumi's.
      const sparks = [[14, 250, 3.5, 0], [96, 246, 4.5, .4], [20, 300, 2.8, .9], [92, 300, 3.2, 1.3], [108, 274, 2.6, 1.7], [8, 278, 2.4, .6]];
      return oval(54, 268, 70, 70, GLOW, 'opacity=".1"') + oval(54, 268, 44, 44, GLOW, 'opacity=".12"') +
        path("M42 404 L54 366 L66 404", "none", 'stroke="#c9a15a" stroke-width="3" stroke-linejoin="round"') + oval(54, 404, 22, 4.5, "#8a6220") + rect(51, 308, 6, 62, "#c9a15a") + oval(54, 368, 7, 4, "#ffdc83") + oval(54, 340, 5, 3, "#ffdc83") + oval(54, 322, 5, 3, "#ffdc83") + // Tripod and pole, with brass collars.
        path("M26 254 A34 34 0 1 0 82 254 A30 30 0 0 1 26 254 Z", "#ffdc83", 'stroke="#b8862e" stroke-width="1.5"') + path("M34 270 Q54 290 74 270", "none", 'stroke="#fff4cf" stroke-width="2.5" stroke-linecap="round" opacity=".8"') + // The crescent, horns up.
        path("M54 300 l5 -6 l-5 -6 l-5 6 Z", "#ff8ecb") + // A little jewel at the crescent's heart.
        oval(54, 254, 42, 11, "none", 'stroke="#fff4cf" stroke-width="1.6" opacity=".75" transform="rotate(-18 54 254)"') + // The orbit ring, behind the star.
        path(star(54, 254, 20), "#fff8dc", 'class="lp-neon lp-twinkle"') + path(star(54, 254, 11), "#ffe08a") + circle(54, 254, 4, "#fff") +
        path("M14.06 266.98 A42 11 -18 0 0 93.94 241.02", "none", 'stroke="#fff4cf" stroke-width="1.8" stroke-linecap="round" opacity=".9"') + // The ring's near half, passing in front of the star.
        circle(90, 232, 3.2, "#70ebea", 'class="lp-twinkle" style="animation-delay:.3s"') + circle(16, 268, 2.4, "#ff8ecb", 'class="lp-twinkle" style="animation-delay:1s"') +
        sparks.map(function (s) { return path(star(s[0], s[1], s[2]), "#fff4cf", 'class="lp-twinkle" style="animation-delay:' + s[3] + 's"'); }).join("") +
        line(26, 254, 22, 280, "#c9a15a", 1) + path(star(22, 284, 4.5), "#ffe9a8") + line(82, 254, 86, 274, "#c9a15a", 1) + path(star(86, 278, 4), "#ffe9a8");
    },

    // Star Capsule plant
    "plant-tulips": function () { // Three tulips and their long leaves in a striped pot.
      const heads = [[4, 322, "#ff8ecb", "#e8669f"], [18, 304, "#ffdc83", "#f0b84a"], [32, 326, "#e8556a", "#c23a50"]];
      return path("M12 372 Q2 350 -6 332 Q8 346 16 372 Z M24 372 Q34 352 44 338 Q30 348 20 372 Z", "#5fae86") +
        path("M14 372 Q6 346 4 330 M18 372 V314 M22 372 Q30 350 32 334", "none", 'stroke="#3f8a66" stroke-width="3" stroke-linecap="round"') +
        heads.map(function (h) {
          const x = h[0], y = h[1];
          return path("M" + (x - 10) + " " + (y - 8) + " L" + (x - 5) + " " + (y - 3) + " L" + x + " " + (y - 10) + " L" + (x + 5) + " " + (y - 3) + " L" + (x + 10) + " " + (y - 8) + " Q" + (x + 12) + " " + (y + 10) + " " + x + " " + (y + 10) + " Q" + (x - 12) + " " + (y + 10) + " " + (x - 10) + " " + (y - 8) + " Z", h[2]) +
            path("M" + x + " " + (y - 10) + " Q" + (x + 7) + " " + y + " " + x + " " + (y + 10) + " Q" + (x - 7) + " " + y + " " + x + " " + (y - 10) + " Z", h[3]);
        }).join("") + ART.pot("#e8dff0") + path("M8 374 L11 392 M16 374 V392 M24 374 V392 M31 374 L28 392", "none", 'stroke="#9c73b8" stroke-width="3"');
    },
    "plant-heartvine": function () { // Heart-shaped leaves climbing a mossy post.
      function heart(x, y, s, deg, fill) { return path("M0 8 C-11 0 -8 -8 -3.5 -8 Q0 -8 0 -4 Q0 -8 3.5 -8 C8 -8 11 0 0 8 Z", fill, 'transform="translate(' + x + " " + y + ") rotate(" + deg + ") scale(" + s + ')"'); }
      const leaves = [[6, 360, 1, -60], [31, 352, 1, 60], [4, 340, .95, -55], [32, 332, .95, 58], [6, 320, .9, -50], [30, 312, .85, 55], [8, 301, .8, -40], [27, 294, .7, 40], [18, 284, .65, 0]];
      return rect(14, 288, 8, 86, "#6b4a2f", 'rx="4"') + scatter(19, 12, function (roll) { return circle(round(roll(14, 22)), round(roll(292, 370)), round(roll(1, 2.2)), "#5fae86"); }) +
        path("M18 372 Q32 356 18 346 Q4 336 18 326 Q30 316 18 306 Q10 298 18 290", "none", 'stroke="#3f8a66" stroke-width="2" stroke-linecap="round"') +
        leaves.map(function (l, i) { return heart(l[0], l[1], l[2], l[3], i % 2 ? "#7fc49a" : "#5fae86"); }).join("") + ART.pot("#9c73b8");
    },
    "plant-kittypot": function () { // Plump succulents growing out of a pot with a sleepy cat's face.
      let leaves = "";
      [-70, -46, -24, 0, 24, 46, 70].forEach(function (a, i) { leaves += oval(18, 340, 7.5, 20, i % 2 ? "#7fc49a" : "#9bd6ae", 'transform="rotate(' + a + ' 18 364)"'); });
      [-30, 0, 30].forEach(function (a) { leaves += oval(18, 348, 6, 14, "#c8ecd2", 'transform="rotate(' + a + ' 18 364)"'); });
      return leaves + circle(-2, 338, 3, "#ffb3d1") + circle(40, 340, 3, "#ffb3d1") +
        path("M0 368 L-2 354 L9 362 Z M36 368 L38 354 L27 362 Z", "#fff1e0") + path("M2 364 L1 358 L6 362 Z M34 364 L35 358 L30 362 Z", "#ffb3d1") +
        rect(-2, 362, 40, 30, "#fff1e0", 'rx="13"') +
        path("M6 376 q4 4 8 0 M22 376 q4 4 8 0", "none", 'stroke="#462846" stroke-width="1.8" stroke-linecap="round"') + path("M16 381 h4 l-2 2.4 Z", "#ff8ecb") + path("M18 383.4 q-2.5 3 -5 1 M18 383.4 q2.5 3 5 1", "none", 'stroke="#462846" stroke-width="1.2" stroke-linecap="round"') +
        path("M2 381 H-6 M2 385 L-5 388 M34 381 H42 M34 385 L41 388", "none", 'stroke="#c0a890" stroke-width="1"');
    },
    "plant-dandelion": function () { // A dandelion clock, a few of its seeds already drifting off.
      const cx = 18, cy = 310;
      let puff = circle(cx, cy, 26, "#fff", 'opacity=".1"');
      for (let i = 0; i < 22; i++) {
        const a = i / 22 * Math.PI * 2, r = i % 2 ? 22 : 25, x = round(cx + Math.cos(a) * r), y = round(cy + Math.sin(a) * r);
        puff += line(cx, cy, x, y, "#f4f0ff", .8, 'opacity=".8"') + circle(x, y, 1.7, "#fff");
      }
      return path("M18 372 Q15 345 18 316", "none", 'stroke="#7fc49a" stroke-width="3" stroke-linecap="round"') + path("M16 366 Q2 356 -4 344 Q10 348 17 360 Z M19 356 Q32 346 40 342 Q30 354 19 362 Z", "#5fae86") +
        puff + circle(cx, cy, 5, "#c0a038") +
        [[50, 296, 0], [58, 284, .6], [-14, 292, 1.2]].map(function (s) { return group(line(0, 0, 0, 9, "#f4f0ff", .8) + path("M-4 -1 Q0 -5 4 -1 M-3 -2 L0 0 L3 -2", "none", 'stroke="#fff" stroke-width=".9"') + circle(0, 9, 1.1, "#c0a038"), 'transform="translate(' + s[0] + " " + s[1] + ') rotate(18)" class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("") + ART.pot("#70b8eb");
    },
    "plant-lavender": function () { // Lavender sprigs filling an old tin watering can.
      let sprigs = "";
      [[-8, 300], [2, 288], [12, 296], [22, 284], [32, 294], [42, 304]].forEach(function (s, i) {
        const base = 2 + i * 6.4;
        sprigs += path("M" + base + " 364 Q" + ((base + s[0]) / 2) + " 340 " + s[0] + " " + (s[1] + 22), "none", 'stroke="#5fae86" stroke-width="1.8" stroke-linecap="round"');
        for (let b = 0; b < 7; b++) sprigs += oval(s[0] + (b % 2 ? 2.4 : -2.4), s[1] + b * 3.6, 3.2, 2.4, b % 3 ? "#9c73b8" : "#c9a8ff");
      });
      return sprigs + path("M-2 372 L-20 348", "none", 'stroke="#8fa2d8" stroke-width="7" stroke-linecap="round"') + path("M-26 343 L-15 339 L-18 354 Z", "#a8b4d8") +
        path("M38 366 Q54 368 50 384 Q46 390 38 386", "none", 'stroke="#6f7fc0" stroke-width="4" stroke-linecap="round"') +
        rect(-2, 362, 40, 30, "#8fa2d8", 'rx="4"') + rect(-3, 360, 42, 5, "#a8b4d8", 'rx="2"') + rect(-2, 384, 40, 3, "#6f7fc0") + path("M10 372 q8 5 16 0", "none", 'stroke="#c8d2e8" stroke-width="2" stroke-linecap="round"') + path(star(18, 378, 3.5), "#fff1cd");
    },
    "plant-kittytopiary": function () { // A hedge clipped into a sitting cat, with a pink ribbon on.
      const bush = "#3f8a66";
      return path("M34 356 Q56 352 54 332 Q52 320 44 324", "none", 'stroke="' + bush + '" stroke-width="9" stroke-linecap="round"') + path("M4 306 L4 286 L18 298 Z M32 306 L32 286 L18 298 Z", bush) +
        oval(18, 346, 20, 24, bush) + circle(18, 310, 17, bush) +
        scatter(29, 34, function (roll, i) {
          const onHead = i < 11, a = roll(0, Math.PI * 2), r = Math.sqrt(roll(0, 1));
          const x = onHead ? 18 + Math.cos(a) * r * 12 : 18 + Math.cos(a) * r * 18, y = onHead ? (i % 2 ? roll(296, 303) : roll(318, 323)) : 346 + Math.sin(a) * r * 22; // Head leaves stay above and below the eyes, so her face stays clear.
          return circle(round(x), round(y), round(roll(1.4, 3)), i % 3 ? "#5fae86" : "#7fc49a");
        }) +
        path("M8 310 q4 4 8 0 M20 310 q4 4 8 0", "none", 'stroke="#1f4a38" stroke-width="2" stroke-linecap="round"') + path("M16 316 h4 l-2 2.4 Z", "#ffb3d1") +
        path("M18 328 L6 322 V334 Z M18 328 L30 322 V334 Z", "#ff8ecb") + circle(18, 328, 3, "#ffb3d1") + ART.pot("#c0764f");
    },
    "plant-bamboo": function () { // Lucky bamboo in a glass vase of water and pebbles, tied with a red ribbon.
      const stalks = [[8, 310, 334], [18, 288, 306], [28, 318, 340]];
      return rect(4, 348, 28, 44, "#bfe8ff", 'rx="5" opacity=".25"') + rect(5, 364, 26, 27, "#70b8eb", 'rx="4" opacity=".4"') +
        stalks.map(function (s) {
          const x = s[0]; let joints = "";
          for (let y = s[1] + 14; y < 384; y += 16) joints += rect(x - 3.6, y, 7.2, 2.4, "#3f8a66", 'rx="1"');
          return rect(x - 3, s[1], 6, 386 - s[1], "#7fc49a", 'rx="2"') + rect(x - 1.8, s[1], 1.4, 386 - s[1], "#a9dcb8") + joints + path("M" + x + " " + s[1] + " Q" + (x - 14) + " " + (s[1] - 10) + " " + (x - 20) + " " + (s[1] + 2) + " Q" + (x - 8) + " " + (s[1] + 4) + " " + x + " " + s[1] + " Z M" + x + " " + s[1] + " Q" + (x + 14) + " " + (s[1] - 10) + " " + (x + 20) + " " + (s[1] + 2) + " Q" + (x + 8) + " " + (s[1] + 4) + " " + x + " " + s[1] + " Z", "#5fae86");
        }).join("") +
        [[9, 388, 4], [18, 389, 3.2], [26, 388, 4]].map(function (p, i) { return oval(p[0], p[1], p[2], 2.6, ["#e8dff0", "#c9a8ff", "#ffdc83"][i]); }).join("") +
        rect(4, 348, 28, 44, "none", 'rx="5" stroke="#cfe8ff" stroke-width="1.6" opacity=".9"') + rect(1, 343, 34, 3.5, "#cfe8ff", 'rx="1.5" opacity=".75"') + path("M9 354 V382", "none", 'stroke="#fff" stroke-width="1.5" opacity=".5" stroke-linecap="round"') +
        rect(3, 346, 30, 4, "#e8556a", 'rx="1"') + path("M18 348 L7 342 V354 Z M18 348 L29 342 V354 Z", "#e8556a") + circle(18, 348, 3, "#ffdc83"); // The ribbon and its bow go on last, around the neck of the vase.
    },
    "plant-blossom": function () { // A little cherry tree in full bloom, petals falling around its glazed pot.
      return path("M18 372 Q10 354 18 342 Q24 332 16 318", "none", 'stroke="#54391f" stroke-width="7" stroke-linecap="round"') + path("M18 342 Q4 334 -6 322 M20 336 Q34 326 44 314", "none", 'stroke="#54391f" stroke-width="4" stroke-linecap="round"') +
        oval(-3, 312, 20, 15, "#e88ab5") + oval(43, 308, 20, 15, "#e88ab5") + oval(20, 298, 28, 20, "#f3a3c8") + oval(3, 298, 15, 12, "#ffc4e0") + oval(37, 296, 15, 12, "#ffc4e0") +
        scatter(37, 30, function (roll) { const a = roll(0, Math.PI * 2), r = Math.sqrt(roll(0, 1)); return circle(round(20 + Math.cos(a) * r * 42),round(304 + Math.sin(a) * r * 22), round(roll(1.2, 2.6)), roll(0, 1) > .5 ? "#fff0f7" : "#ffd9e6"); }) +
        [[-22, 340], [-10, 362], [52, 346], [60, 370], [38, 362]].map(function (p, i) { return oval(p[0], p[1], 2.8, 1.6, "#ffc4e0", 'transform="rotate(' + (i * 50) + " " + p[0] + " " + p[1] + ')" class="lp-twinkle" style="animation-delay:' + (i * .4) + 's"'); }).join("") +
        ART.pot("#3f6fae") + path("M6 380 q6 -4 12 0 t12 0", "none", 'stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"') + rect(2, 368, 32, 2, "#fff", 'opacity=".4" rx="1"');
    },
    "plant-lanternvine": function () { // Arching vines hung with glowing seed-pod lanterns.
      function pod(x, y, s, delay) {
        return line(x, y - 10 * s, x, y - 18 * s, "#3f8a66", 1.5) + circle(x, y, 13 * s, "#ff9d6b", 'opacity=".2"') +
          path("M" + x + " " + (y - 11 * s) + " Q" + (x + 11 * s) + " " + (y - 5 * s) + " " + (x + 8 * s) + " " + (y + 5 * s) + " Q" + (x + 4 * s) + " " + (y + 11 * s) + " " + x + " " + (y + 12 * s) + " Q" + (x - 4 * s) + " " + (y + 11 * s) + " " + (x - 8 * s) + " " + (y + 5 * s) + " Q" + (x - 11 * s) + " " + (y - 5 * s) + " " + x + " " + (y - 11 * s) + " Z", "#ffa55c", 'class="lp-twinkle" style="animation-delay:' + delay + 's"') +
          path("M" + x + " " + (y - 11 * s) + " V" + (y + 12 * s) + " M" + x + " " + (y - 11 * s) + " Q" + (x + 6 * s) + " " + y + " " + x + " " + (y + 12 * s) + " M" + x + " " + (y - 11 * s) + " Q" + (x - 6 * s) + " " + y + " " + x + " " + (y + 12 * s), "none", 'stroke="#d9652e" stroke-width="1"') + circle(x, y + 2 * s, 2.4 * s, "#fff1cd", 'opacity=".9"');
      }
      return path("M14 372 Q6 318 -18 318 M22 372 Q26 300 54 308 M18 372 Q18 306 22 286", "none", 'stroke="#3f8a66" stroke-width="3" stroke-linecap="round"') +
        [[-12, 330, -30], [12, 330, -70], [36, 318, 30], [50, 322, 60], [24, 296, 20], [10, 304, -60], [30, 344, 30], [2, 350, -40]].map(function (l) { return oval(l[0], l[1], 4, 9, "#5fae86", 'transform="rotate(' + l[2] + " " + l[0] + " " + l[1] + ')"'); }).join("") +
        pod(-18, 340, 1, 0) + pod(54, 330, 1, .6) + pod(4, 322, .75, 1.1) + pod(36, 346, .85, .3) + pod(22, 306, .7, 1.5) + ART.pot("#2a3a70") + rect(2, 368, 32, 2, "#ffdc83", 'opacity=".7"');
    },
    "plant-wishtree": function () { // The showpiece: a midnight tree whose leaves hold a sky of stars, hung with moon charm and wish ribbons.
      const ribbons = [[-16, 324, "#ff8ecb", 20], [-1, 330, "#70ebea", 24], [34, 330, "#ffdc83", 22]];
      return oval(18, 308, 52, 36, GLOW, 'opacity=".12"') +
        path("M18 374 Q2 356 14 340 Q24 328 12 316", "none", 'stroke="#3a2a60" stroke-width="9" stroke-linecap="round"') + path("M18 374 Q2 356 14 340 Q24 328 12 316", "none", 'stroke="#ffdc83" stroke-width="1.5" stroke-dasharray="5 4" stroke-linecap="round"') +
        path("M14 340 Q0 332 -12 322 M16 336 Q32 330 44 318", "none", 'stroke="#3a2a60" stroke-width="5" stroke-linecap="round"') +
        oval(-5, 317, 21, 14, "#1f2a6a") + oval(41, 315, 21, 14, "#1f2a6a") + oval(18, 322, 16, 10, "#1f2a6a") + oval(-8, 303, 15, 12, "#26337c") + oval(44, 301, 15, 12, "#26337c") + oval(18, 298, 30, 18, "#2a3a8a") + oval(5, 306, 16, 11, "#3a2a80") + oval(32, 304, 15, 10, "#3a2a80") + // Overlapping lobes, so it reads as a leafy crown.
        ribbons.map(function (r) { return path("M" + r[0] + " " + r[1] + " q-3 " + r[3] * .5 + " 1 " + r[3] + " l3 -3 l3 3 q-4 " + -r[3] * .5 + " -1 " + -r[3] + " Z", r[2], 'opacity=".95"'); }).join("") +
        scatter(53, 17, function (roll, i) {
          const a = roll(0, Math.PI * 2), rad = Math.sqrt(roll(0, 1)), x = round(18 + Math.cos(a) * rad * 42), y = round(308 + Math.sin(a) * rad * 22), big = i % 3 === 0;
          return path(star(x, y, big ? 5 : 3), big ? "#fff8dc" : "#ffe9a8", 'class="lp-twinkle" style="animation-delay:' + round(i * .21) + 's"');
        }) +
        line(52, 324, 52, 340, "#ffdc83", 1) + path("M52 340 A7.5 7.5 0 1 0 59 351 A6.5 6.5 0 1 1 52 340 Z", "#fff1cd", 'class="lp-neon"') + // The crescent charm hangs clear of the trunk, from the right bough.
        path("M2 372 H34 L30 392 H6 Z", "#d9b24a") + rect(0, 367, 36, 7, "#ffdc83", 'rx="2"') + path(star(18, 382, 6), "#fff8dc") + path(star(8, 382, 2.5), "#7a5a2a") + path(star(28, 382, 2.5), "#7a5a2a") + rect(5, 390, 26, 2.5, "#8a6a2a");
    },

    // Star Capsule rug
    // Rugs lie on the floor under Lumi, around 200,440. Round ones are drawn from above in a group squashed to lie flat.

    "rug-braid": function () { // A braided rag rug: seven coiled rings of cloth, each with a dashed line to look plaited.
      const cloth = ["#c85a8e", "#ffdc83", "#70b8eb", "#9c73b8", "#7fc49a", "#e98a5a", "#fff1e0"];
      let rings = circle(0, 0, 148, "#5a3a5a");
      cloth.forEach(function (colour, i) {
        const r = 138 - i * 19;
        rings += circle(0, 0, r, "none", 'stroke="' + colour + '" stroke-width="19"') + circle(0, 0, r, "none", 'stroke="#000000" stroke-opacity=".28" stroke-width="5" stroke-dasharray="11 9"'); // A ring, then its braid marks.
      });
      return group(rings + circle(0, 0, 11, "#ffdc83"), 'transform="translate(200 440) scale(1 .27)"');
    },

    "rug-daisy": function () { // A big soft daisy: twelve petals around a speckled sunny middle.
      let flower = "";
      for (let i = 0; i < 12; i++) flower += group(oval(0, -92, 25, 52, "#fff4d0") + path("M0 -48 V-128", "none", 'stroke="#e8cf96" stroke-width="3" opacity=".7"'), 'transform="rotate(' + i * 30 + ')"'); // A petal and its crease.
      flower += circle(0, 0, 56, "#d9962e") + circle(0, 0, 50, "#ffc64a");
      flower += scatter(61, 18, function (roll) { const a = roll(0, 6.28), r = roll(4, 44); return circle(round(Math.cos(a) * r), round(Math.sin(a) * r), round(roll(2.5, 5)), "#a8691f", 'opacity=".75"'); }); // The freckles.
      return group(flower, 'transform="translate(200 440) scale(1 .3)"');
    },

    "rug-kilim": function () { // A flat-woven runner: a row of stepped diamonds between pale bands, with fringe at both ends.
      let fringe = "";
      for (let y = 414; y <= 468; y += 4) fringe += "M72 " + y + " H62 M328 " + y + " H338 ";                       // The tassels, as one shape.
      let out = path(fringe, "none", 'stroke="#e9d8b0" stroke-width="1.6"') + rect(72, 412, 256, 58, "#9c4a3c", 'rx="2"') + rect(72, 412, 256, 7, "#e9d8b0") + rect(72, 463, 256, 7, "#e9d8b0") +
        path("M72 423 H328 M72 459 H328", "none", 'stroke="#3d7a7a" stroke-width="3"');
      for (let x = 92, i = 0; x <= 308; x += 36, i++) {
        out += path("M" + x + " 425 L" + (x + 16) + " 441 L" + x + " 457 L" + (x - 16) + " 441 Z", i % 2 ? "#ffcf6e" : "#3d7a7a") +
          path("M" + x + " 432 L" + (x + 9) + " 441 L" + x + " 450 L" + (x - 9) + " 441 Z", i % 2 ? "#9c4a3c" : "#e9d8b0") + circle(x, 441, 2.6, i % 2 ? "#e9d8b0" : "#9c4a3c");
      }
      return out;
    },

    "rug-cookie": function () { // One enormous cookie with a bite out of the side. The outline is a wobbly circle with a scoop cut from it.
      const roll = dice(66);
      let edge = "";
      for (let i = 0; i < 44; i++) {
        const a = i / 44 * 6.283, nibble = Math.abs(Math.atan2(Math.sin(a - 4.3), Math.cos(a - 4.3))); // How close this point is to the bitten corner, top left where furniture won't hide it.
        const r = nibble < .36 ? 104 + 40 * Math.pow(nibble / .36, 2) : 144 + roll(-4, 4);
        edge += (i ? " L" : "M") + round(Math.cos(a) * r) + " " + round(Math.sin(a) * r);
      }
      const chips = [[-92, -40, 15], [-44, -92, 13], [34, -82, 12], [96, -30, 14], [-108, 36, 12], [-58, 64, 16], [18, 34, 13], [64, 92, 12], [-14, 106, 11], [-30, -24, 12], [58, -14, 9]];
      return group(path(edge + "Z", "#c78a4f", 'stroke="#99602e" stroke-width="10" stroke-linejoin="round"') +
        path(edge + "Z", "none", 'stroke="#e6ac72" stroke-width="3" opacity=".6" transform="scale(.9)"') +                                                              // The paler baked rim.
        chips.map(function (c) { return circle(c[0], c[1], c[2], "#46271a") + circle(c[0] - 3, c[1] - 3, round(c[2] * .35), "#7d4f33"); }).join(""),                        // Chocolate chips, each with a shine.
        'transform="translate(200 440) scale(1 .3)"');
    },

    "rug-lilypad": function () { // A great lily pad with a notch, fanned veins and one pink water lily at the rim.
      let edge = "M0 0";
      for (let a = 0.2; a < 6.1; a += .2) edge += " L" + round(Math.cos(a) * 144) + " " + round(Math.sin(a) * 144);
      let veins = "";
      for (let a = 0.35; a < 6; a += .42) veins += "M0 0 L" + round(Math.cos(a) * 130) + " " + round(Math.sin(a) * 130) + " ";
      const lily = group(oval(0, 3, 26, 9, "#0e2b1e", 'opacity=".35"') + [-60, -36, -12, 12, 36, 60].map(function (a) { return group(path("M0 3 Q-10 -9 0 -24 Q10 -9 0 3Z", "#ff9fce"), 'transform="rotate(' + a + ')"'); }).join("") +
        [-24, 0, 24].map(function (a) { return group(path("M0 3 Q-7 -6 0 -16 Q7 -6 0 3Z", "#ffd6e8"), 'transform="rotate(' + a + ')"'); }).join("") + circle(0, -2, 3.6, "#ffdc83"), 'transform="translate(146 420) scale(1.2)"');
      return group(path(edge + " Z", "#3f8a5a") + path(veins, "none", 'stroke="#6fbd7f" stroke-width="3.5" opacity=".75"') + path(edge + " Z", "none", 'stroke="#2c6b45" stroke-width="7" stroke-linejoin="round"') + circle(60, -76, 8, "#cfe8ff", 'opacity=".7"') + circle(-30, 92, 6, "#cfe8ff", 'opacity=".7"') + circle(92, 54, 5, "#cfe8ff", 'opacity=".6"'),
        'transform="translate(200 440) scale(1 .3)"') + lily;
    },

    "rug-sheep": function () { // A sheep-shaped rug fast asleep: woolly lobes all round, a pale face at one end, little hooves tucked under.
      let lobes = "";
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; lobes += oval(round(200 + Math.cos(a) * 128), round(442 + Math.sin(a) * 30), 26, 13, i % 2 ? "#f4efe6" : "#fffaf0"); }
      let curls = "";
      for (let i = 0; i < 9; i++) curls += "M" + (120 + i * 22) + " " + (436 + (i % 2) * 12) + " a7 5 0 1 1 7 5 ";                      // The stitched curls of wool.
      return oval(200, 470, 136, 7, "#000000", 'opacity=".2"') +
        oval(92, 468, 8, 5, "#4a3a4a") + oval(142, 472, 8, 5, "#4a3a4a") + oval(256, 472, 8, 5, "#4a3a4a") + oval(306, 468, 8, 5, "#4a3a4a") + lobes + oval(200, 442, 128, 30, "#fffaf0") +
        path(curls, "none", 'stroke="#e0d2c0" stroke-width="2" stroke-linecap="round"') +
        // The face rests at the right, between Lumi and the bed, where neither hides it.
        oval(288, 414, 12, 5, "#e8d6bf", 'transform="rotate(24 288 414)"') + oval(252, 414, 12, 5, "#e8d6bf", 'transform="rotate(-24 252 414)"') +                                                                     // Floppy ears.
        oval(270, 424, 22, 17, "#f5e4cd") + circle(270, 409, 10, "#fffaf0") + path("M258 422 q5 4 9 0 M273 422 q5 4 9 0", "none", 'stroke="#4a3a4a" stroke-width="2" stroke-linecap="round"') + // Face, topknot and sleeping eyes.
        path("M267 432 q3 3 6 0", "none", 'stroke="#c88a8a" stroke-width="2" stroke-linecap="round"') + circle(256, 428, 3, "#ffb3c8", 'opacity=".7"') + circle(284, 428, 3, "#ffb3c8", 'opacity=".7"');
    },

    "rug-vinyl": function () { // A vinyl record to curl up on: fine grooves, a shine across it and a bright centre label.
      const grooves = [132, 122, 112, 102, 92, 82, 72, 62].map(function (r) { return circle(0, 0, r, "none", 'stroke="#3a3350" stroke-width="2"'); }).join("");
      return group(circle(0, 0, 146, "#1a1624") + grooves +
        path("M0 0 L-62 -129 A143 143 0 0 1 62 -129 Z", "#ffffff", 'opacity=".12"') + path("M0 0 L62 129 A143 143 0 0 1 -62 129 Z", "#ffffff", 'opacity=".12"') + // The two wedges of shine.
        circle(0, 0, 52, "#ff8ecb") + circle(0, 0, 46, "none", 'stroke="#fff1cd" stroke-width="2" stroke-dasharray="4 5"') + path(star(0, 0, 30), "#fff1cd") + circle(0, 0, 5, "#1a1624"), 'transform="translate(200 440) scale(1 .3)"') +
        circle(330, 440, 2, "#fff", 'opacity=".5"');
    },

    "rug-medallion": function () { // A proper woven carpet: border of tiny diamonds, deep starry field, and a lobed medallion at its heart.
      const lobed = function (base, wiggle) { // A closed shape with eight soft lobes, in the medallion's own coordinates.
        let d = "";
        for (let i = 0; i < 80; i++) { const a = i / 80 * 6.283, r = base + wiggle * Math.cos(8 * a); d += (i ? " L" : "M") + round(Math.cos(a) * r) + " " + round(Math.sin(a) * r); }
        return d + "Z";
      };
      let fringe = "";
      for (let y = 410; y <= 474; y += 3.2) fringe += "M60 " + round(y) + " H52 M340 " + round(y) + " H348 ";
      let border = "";
      for (let x = 74; x <= 326; x += 18.2) border += path("M" + round(x) + " 411 l4.5 4.5 l-4.5 4.5 l-4.5 -4.5 Z M" + round(x) + " 466 l4.5 4.5 l-4.5 4.5 l-4.5 -4.5 Z", "#e8c877");       // Diamonds running along top and bottom.
      return path(fringe, "none", 'stroke="#efe0c0" stroke-width="1.4"') + rect(60, 408, 280, 70, "#6e2342", 'rx="2"') + rect(66, 413, 268, 60, "none", 'stroke="#e8c877" stroke-width="1.6"') + rect(74, 421, 252, 44, "#1a2a55", 'stroke="#c0a0d0" stroke-width="1"') + border +
        path("M66 424 l5 5 l-5 5 l-5 -5 Z M66 452 l5 5 l-5 5 l-5 -5 Z M334 424 l5 5 l-5 5 l-5 -5 Z M334 452 l5 5 l-5 5 l-5 -5 Z", "#e8c877") +
        [[86, 428], [86, 458], [314, 428], [314, 458]].map(function (p) { return path(star(p[0], p[1], 7), "#ffdc83"); }).join("") +                                                                 // A star in each corner of the field.
        path("M86 443 Q128 424 160 443 M86 443 Q128 462 160 443 M314 443 Q272 424 240 443 M314 443 Q272 462 240 443", "none", 'stroke="#70b8eb" stroke-width="1.6" opacity=".8"') +                  // Vines reaching for the medallion.
        scatter(62, 12, function (roll) { return circle(round(roll(92, 308)), round(roll(424, 462)), round(roll(.7, 1.4)), "#fff8dc", 'opacity=".8"'); }) +
        group(path(lobed(80, 12), "#c85a8e") + path(lobed(64, 9), "#1a2a55") + path(lobed(50, 6), "#e8c877") + path(lobed(36, 4), "#6e2342") + path(star(0, 0, 30), "#fff1cd") + [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { const a = i / 8 * 6.283; return circle(round(Math.cos(a) * 72), round(Math.sin(a) * 72), 3.4, "#ffdc83"); }).join(""), 'transform="translate(200 443) scale(1.25 .24)"');
    },

    "rug-koi": function () { // A round pond rug with two koi circling each other, ringed with pebbles and small lily leaves.
      const koi = function (x, y, angle, skin, patch) { // A fish pointing along its own x axis.
        return group(path("M-52 0 L-86 -20 Q-74 0 -86 20 Z", skin) + oval(14, -20, 20, 7, skin, 'transform="rotate(-24 14 -20)"') + oval(14, 20, 20, 7, skin, 'transform="rotate(24 14 20)"') +
          path("M56 0 Q22 -25 -30 -11 Q-52 -4 -58 0 Q-52 4 -30 11 Q22 25 56 0Z", skin) +
          circle(22, -6, 8, patch) + circle(-8, 4, 10, patch) + circle(-32, -2, 6, patch) + circle(40, -8, 3, "#1a2a3a") + circle(40, 8, 3, "#1a2a3a"),
          'transform="translate(' + x + " " + y + ") rotate(" + angle + ')"');
      };
      const pad = function (x, y, r) { return path("M" + x + " " + y + " L" + (x + r) + " " + (y - r * .2) + " A" + r + " " + r + " 0 1 1 " + (x + r * .8) + " " + (y + r * .6) + " Z", "#4f9a62", 'stroke="#2c6b45" stroke-width="2"'); };
      return group(circle(0, 0, 148, "#9c8a64") + circle(0, 0, 140, "none", 'stroke="#c9b58a" stroke-width="14" stroke-dasharray="14 7"') + circle(0, 0, 130, "#1d6a7c") + circle(0, 0, 112, "#2a8d96") +
        circle(0, 0, 90, "none", 'stroke="#7fd6c8" stroke-width="2.5" opacity=".6"') + circle(0, 0, 54, "none", 'stroke="#7fd6c8" stroke-width="2.5" opacity=".5"') +                                 // Water, deepening at the rim, with soft ripples.
        koi(0, -72, 0, "#ff9d4a", "#fff4e0") + koi(0, 72, 180, "#fff4e0", "#ff5a4a") +
        pad(-108, -48, 18) + pad(106, 46, 16) + pad(-84, 76, 12) +
        circle(-96, 14, 3, "#cfe8ff", 'opacity=".75"') + circle(92, -42, 3, "#cfe8ff", 'opacity=".75"') + circle(20, 92, 2.5, "#cfe8ff", 'opacity=".7"'),
        'transform="translate(200 440) scale(1 .3)"');
    },

    "rug-wishing-circle": function () { // A circle of light woven into the floor: rings that follow Lumi's glow, a big eight-pointed star, and twinkling points around the rim.
      let ticks = "", marks = "", lamps = "";
      for (let i = 0; i < 48; i++) { const a = i / 48 * 6.283, c = Math.cos(a), s = Math.sin(a), inner = i % 4 ? 124 : 116; ticks += "M" + round(c * inner) + " " + round(s * inner) + " L" + round(c * 134) + " " + round(s * 134) + " "; } // The measuring marks around the rim, as one shape.
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; marks += path(star(round(Math.cos(a) * 140), round(Math.sin(a) * 140), 13), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .17).toFixed(2) + 's"'); } // Twelve points of light on the rim.
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + .39; lamps += circle(round(Math.cos(a) * 88), round(Math.sin(a) * 88), 5, GLOW, 'class="lp-twinkle" style="animation-delay:' + (i * .25) + 's"'); } // Eight lamps inside it.
      return oval(200, 442, 158, 42, GLOW, 'opacity=".14"') + group(circle(0, 0, 146, "#0d1238") + circle(0, 0, 146, "none", 'stroke="' + GLOW + '" stroke-width="5" class="lp-neon"') + path(ticks, "none", 'stroke="' + GLOW + '" stroke-width="2.5" opacity=".75"') +
        circle(0, 0, 112, "none", 'stroke="#ffdc83" stroke-width="2.5"') + circle(0, 0, 62, "none", 'stroke="' + GLOW + '" stroke-width="2.5" opacity=".8"') +
        path("M0 -108 L76 -76 L108 0 L76 76 L0 108 L-76 76 L-108 0 L-76 -76Z", "none", 'stroke="#ffdc83" stroke-width="2.5"') +
        path("M0 -108 L0 108 M108 0 L-108 0 M76 -76 L-76 76 M76 76 L-76 -76", "none", 'stroke="#ffdc83" stroke-width="1.6" opacity=".7"') +
        path(star(0, 0, 56), "#ffe9a8", 'opacity=".9" class="lp-neon"') + path(star(0, 0, 26), "#fff") + marks + lamps, 'transform="translate(200 442) scale(1 .3)"') +
        scatter(63, 7, function (roll, i) { return path(star(round(roll(80, 320)), round(roll(404, 412)), round(roll(2.4, 4.4))), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .29 % 2).toFixed(2) + 's"'); }); // A few sparks rising off it.
    },

    // Star Capsule shelf
    "shelf-teacups": function () { // A round teapot and a little stack of teacups.
      const cup = function (x, y, colour) { return path("M" + (x - 9) + " " + y + " h18 q-1 9 -9 9 q-8 0 -9 -9 Z", colour) + path("M" + (x + 9) + " " + (y + 2) + " q6 1 3 6 q-2 2 -5 1", "none", 'stroke="' + colour + '" stroke-width="1.8"') + rect(x - 8, y + 9, 16, 2, "#fff1e0", 'rx="1"'); };
      return oval(322, 186, 16, 14, "#c9d6ff") + oval(322, 192, 15, 8, "#a9b8e8") + path("M306 182 q-10 -2 -10 -9 q0 -4 4 -4 M338 186 q8 1 9 -7 l4 -3 l-2 7 q-2 6 -10 8", "none", 'stroke="#c9d6ff" stroke-width="3" stroke-linecap="round"') + oval(322, 172, 8, 3, "#a9b8e8") + circle(322, 168, 2.5, "#ffdc83") + path(star(322, 187, 4), "#fff") +
        cup(352, 189, "#ff8ecb") + cup(352, 178, "#ffdc83") + cup(352, 167, "#70ebea") + ART.board();
    },
    "shelf-jars": function () { // Three screw-top sweet jars with different sweets inside.
      function jar(x, top, lid, sweets) { // Glass body drawn over its sweets, with a lid.
        return sweets + rect(x - 11, top, 22, 200 - top, "#bfe8ff", 'rx="4" opacity=".28" stroke="#d6f0ff" stroke-width="1.5"') + rect(x - 9, top - 5, 18, 6, lid, 'rx="1.5"') + line(x - 7, top + 5, x - 7, 192, "#fff", 1.2, 'opacity=".55"');
      }
      const round1 = [[-6, 194], [0, 194], [6, 194], [-3, 188], [4, 188], [0, 182]];
      return jar(312, 170, "#ff8ecb", round1.map(function (p, i) { return circle(312 + p[0], p[1], 3.2, ["#ff8ecb", "#ffdc83", "#70ebea"][i % 3]); }).join("")) +
        jar(338, 160, "#70ebea", [0, 1, 2, 3].map(function (i) { return rect(330, 192 - i * 9, 16, 7, ["#c9a8ff", "#ffb3d1", "#fff1cd", "#7fc49a"][i], 'rx="3.5"'); }).join("")) +
        jar(364, 174, "#ffdc83", [[-7, 196], [-1, 196], [5, 196], [-4, 190], [3, 190]].map(function (p) { return path(star(364 + p[0], p[1], 3.8), "#ffe9a8"); }).join("")) + ART.board();
    },
    "shelf-shells": function () { // A beachcomber's row: a scallop, a spiral whelk, a starfish and a pebble stack.
      const ribs = [-38, -19, 0, 19, 38].map(function (a) { return "M308 196 L" + round(308 + 13 * Math.sin(a * Math.PI / 180)) + " " + round(196 - 18 * Math.cos(a * Math.PI / 180)); }).join(" ");
      return path("M296 192 Q294 172 308 170 Q322 172 320 192 Q314 200 308 200 Q302 200 296 192 Z", "#ffc2b0") + path(ribs, "none", 'stroke="#d98a7a" stroke-width="1.2"') + rect(302, 196, 12, 4, "#f0a080", 'rx="1.5"') +
        path("M334 200 Q324 190 332 176 L342 164 L346 178 Q352 190 344 200 Z", "#ffe0b0") + path("M330 184 Q338 190 346 182 M331 192 Q338 196 346 190 M336 174 Q340 178 345 174", "none", 'stroke="#c99a60" stroke-width="1.4"') +
        path(star(358, 192, 8), "#ff8e8e") + circle(358, 192, 1.4, "#ffdc83") + oval(372, 197, 7, 3.5, "#a8b4c4") + oval(372, 192, 5.5, 3, "#c9d2de") + oval(372, 187.5, 3.5, 2.2, "#e6ecf2") + ART.board();
    },
    "shelf-ducks": function () { // A parade of rubber ducklings: mum in front, then three small ones with little hats.
      function duck(x, s, body, beak, extra) { // Facing left, in a local box that sits on the shelf.
        return group(oval(0, -7, 11, 7, body) + circle(-7, -14, 6, body) + path("M-13 -14 l-5 1 l5 2 Z", beak) + circle(-8.5, -15.5, 1, "#2a1a3a") + path("M9 -9 q5 -3 3 2 q-1 3 -5 3 Z", body) + (extra || ""), 'transform="translate(' + x + " 200) scale(" + s + ')"');
      }
      return duck(309, 1.15, "#ffdc83", "#ff9d6b") + duck(330, .78, "#ffe9a8", "#ff9d6b", path("M-13 -21 h12 l-6 -8 Z", "#70ebea")) + duck(347, .72, "#ffd0e8", "#ff9d6b", rect(-13, -20, 11, 2.4, "#c9a8ff", 'rx="1"') + rect(-11, -26, 7, 6, "#c9a8ff", 'rx="1"')) + duck(364, .68, "#c9f0ff", "#ffb84a", path(star(-7, -23, 5), "#ffdc83")) + ART.board();
    },
    "shelf-records": function () { // A little record player with a turning disc and a stack of sleeves leaning next to it.
      return rect(297, 182, 44, 18, "#7a4a2a", 'rx="2"') + rect(297, 182, 44, 3.5, "#a8743f", 'rx="1.5"') + oval(318, 181, 17, 4.5, "#1a1228") + oval(318, 181, 12, 3.2, "none", 'stroke="#3a3048" stroke-width="1"') + oval(318, 181, 4.5, 1.6, "#ff8ecb", 'class="lp-twinkle"') + path("M338 180 L330 176 L324 180", "none", 'stroke="#d8cfe4" stroke-width="1.6" stroke-linejoin="round"') + circle(338, 180, 2, "#a8b4c4") + circle(304, 191, 2.4, "#ffdc83") + circle(311, 191, 2.4, "#ffdc83") + rect(322, 188, 15, 2, "#3a2452") + rect(322, 193, 15, 2, "#3a2452") +
        rect(346, 165, 8, 35, "#70b8eb", 'rx="1"') + rect(355, 168, 8, 32, "#ff8ecb", 'rx="1"') + path("M365 200 L370 168 L377 170 L372 200 Z", "#ffdc83") + path("M358 178 v10 M350 174 v14 M371 178 l-1 8", "none", 'stroke="#fff" stroke-width="1" opacity=".55"') + ART.board();
    },
    "shelf-windups": function () { // Tin wind-up toys: a robot with a key in its back, a spinning top and a hopping chick.
      return rect(303, 176, 22, 18, "#a8b4c4", 'rx="3"') + rect(305, 194, 7, 6, "#6a7484") + rect(316, 194, 7, 6, "#6a7484") + rect(308, 165, 12, 11, "#c9d2de", 'rx="2"') + circle(311, 170, 1.8, "#70ebea", 'class="lp-twinkle"') + circle(317, 170, 1.8, "#70ebea") + rect(310, 182, 8, 3, "#ff8ecb") + rect(310, 187, 8, 3, "#ffdc83") + path("M326 182 h7 M333 178 v8", "none", 'stroke="#d9b24a" stroke-width="2"') + line(314, 165, 314, 160, "#6a7484", 1.5) + circle(314, 159, 1.8, "#ff7a8a") +
        path("M345 200 L335 186 Q345 176 355 186 Z", "#e8556a") + path("M337.5 189 Q345 183 352.5 189 M340 193 Q345 189 350 193", "none", 'stroke="#fff1cd" stroke-width="2"') + rect(343.5, 170, 3, 9, "#d9b24a", 'rx="1"') + circle(345, 169, 2.4, "#ff8ecb") +
        group(oval(364, 192, 10, 7, "#ffdc83") + circle(358, 184, 6, "#ffe9a8") + path("M352 184 l-5 1 l5 2 Z", "#ff9d6b") + circle(356.5, 183, 1, "#2a1a3a") + path("M369 190 q7 -4 5 2 M369 193 q6 -1 4 3", "none", 'stroke="#d9b24a" stroke-width="2"') + rect(358, 198, 3, 2, "#ff9d6b") + rect(366, 198, 3, 2, "#ff9d6b"), 'transform="translate(3 0)"') + ART.board();
    },
    "shelf-terrarium": function () { // A glass cloche over moss, ferns and a tiny red mushroom.
      return oval(337, 197, 30, 4.5, "#3a5a52") + path("M314 197 Q314 186 337 185 Q360 186 360 197 Z", "#5fae86") + path("M324 189 q-2 -10 -8 -12 M324 189 q0 -11 4 -14 M324 189 q3 -9 8 -10 M352 191 q-1 -9 -5 -11 M352 191 q2 -9 6 -10", "none", 'stroke="#3f8a66" stroke-width="2" stroke-linecap="round"') +
        rect(342, 184, 3, 8, "#fff1e0") + path("M336 186 Q343.5 174 351 186 Z", "#e8556a") + circle(341, 182, 1.2, "#fff") + circle(346, 183, 1, "#fff") + path("M308 200 V172 Q308 152 337 152 Q366 152 366 172 V200 Z", "#bfe8ff", 'opacity=".2" stroke="#d6f0ff" stroke-width="1.8"') + path("M316 172 Q316 160 330 158", "none", 'stroke="#fff" stroke-width="1.8" opacity=".6" stroke-linecap="round"') + circle(337, 150, 2.6, "#d9b24a") + circle(324, 170, 1.2, "#8be9a8", 'class="lp-twinkle"') + circle(352, 168, 1, "#8be9a8", 'class="lp-twinkle" style="animation-delay:.9s"') + ART.board();
    },
    "shelf-potions": function () { // An alchemist's corner: three corked flasks of glowing liquid, bubbles rising from the pink and green ones.
      function flask(x, h, r, colour, delay) { // A round-bellied bottle with a cork: the coloured liquid fills the bottom two-thirds, with a glint.
        const y = 200 - r, neck = 200 - r * 2 - h;
        return rect(x - 3, neck, 6, h + 4, "#d6f0ff", 'opacity=".55"') + rect(x - 3.5, neck - 5, 7, 5, "#a8743f", 'rx="1"') + circle(x, y, r, "#d6f0ff", 'opacity=".32" stroke="#e6f6ff" stroke-width="1.2"') + path("M" + (x - r + 1) + " " + (y + 1) + " A" + (r - 1) + " " + (r - 1) + " 0 0 0 " + (x + r - 1) + " " + (y + 1) + " Q" + x + " " + (y - 3) + " " + (x - r + 1) + " " + (y + 1) + " Z", colour, 'class="lp-twinkle" style="animation-delay:' + delay + 's"') + oval(x, 200, r * .7, 1.5, colour, 'opacity=".3"') + circle(x - r * .4, y - r * .4, r * .2, "#fff", 'opacity=".8"') + path(star(x, y + r * .35, r * .3), "#fff", 'opacity=".75"');
      }
      return flask(310, 10, 12, "#ff6fb0", 0) + flask(336, 18, 9, "#70ebea", .5) + flask(362, 8, 13, "#b9f05a", 1) +
        scatter(161, 5, function (roll, i) { const x = round(310 + roll(-6, 6)), y = round(174 - i * 5); return circle(x, y, round(roll(.8, 1.6)), "#ffb3d9", 'opacity=".8" class="lp-twinkle" style="animation-delay:' + i * .4 + 's"'); }) +
        scatter(162, 5, function (roll, i) { const x = round(362 + roll(-6, 6)), y = round(170 - i * 4); return circle(x, y, round(roll(.8, 1.4)), "#d2f58a", 'opacity=".8" class="lp-twinkle" style="animation-delay:' + i * .5 + 's"'); }) + ART.board();
    },
    "shelf-explorer": function () { // A traveller's keepsakes: a tilted globe on a brass stand, a ship in a bottle, and a spyglass.
      return path("M300 200 h24 l-3 -5 h-18 Z", "#8a5a2a") + rect(310, 188, 4, 8, "#d9b24a") + path("M312 196 A20 20 0 0 1 300 164", "none", 'stroke="#d9b24a" stroke-width="2"') + circle(312, 176, 14, "#5aa0d8") + path("M302 170 q4 -5 8 -2 q2 3 -2 5 q-3 2 -6 -3 Z M314 166 q5 -1 8 3 q1 5 -5 4 q-4 -2 -3 -7 Z M308 183 q4 -3 7 0 q1 3 -3 4 q-3 0 -4 -4 Z", "#7fc49a") + path("M298 176 Q312 184 326 176", "none", 'stroke="#fff" stroke-width=".8" opacity=".4"') +
        rect(330, 183, 42, 17, "#bfe8ff", 'rx="7" opacity=".32" stroke="#d6f0ff" stroke-width="1.5"') + rect(372, 188, 5, 7, "#a8743f", 'rx="1"') + path("M333 197 Q351 193 369 197 V198 H333 Z", "#1a5c8c") + path("M340 195 h20 l-4 3 h-12 Z", "#8a5a2a") + path("M349 195 V184 M350 186 l9 7 h-9 Z M348 186 l-7 7 h7 Z", "#fff") + line(349, 195, 349, 184, "#6a4a30", 1) +
        rect(334, 176, 19, 7, "#8a6220", 'rx="2"') + rect(353, 177.5, 14, 4, "#d9b24a", 'rx="1.5"') + rect(367, 176.5, 3, 6, "#8a6220", 'rx="1"') + oval(334, 179.5, 1.6, 3.5, "#bfe8ff") + path("M340 176 v7 M346 176 v7", "none", 'stroke="#d9b24a" stroke-width="1"') + ART.board();
    },
    "shelf-dragon": function () { // A very small dragon asleep on a heap of gold, one wing folded over and a curl of sleepy smoke.
      const coins = scatter(171, 22, function (roll) { const x = round(roll(302, 372)), y = round(roll(186, 197)); return "M" + round(x - 4) + " " + y + " a4 2 0 1 0 8 0 a4 2 0 1 0 -8 0Z "; });
      return path("M298 200 Q306 182 322 178 Q340 172 356 180 Q372 184 378 200 Z", "#d9a02e") + path(coins, "#ffdc83", 'stroke="#b8862e" stroke-width=".6"') +
        path("M322 196 Q320 172 340 170 Q362 170 362 188 Q362 196 354 196 H330 Q328 196 326 200 Z", "#7fd6a8") + path("M358 188 q14 6 12 -8 q8 12 -4 16 q-6 2 -12 -2 Z", "#7fd6a8") + // Body and curled tail.
        path("M344 172 q8 -12 18 -10 q-4 8 -10 12 Z M338 174 q-2 -14 6 -18 q6 8 2 16 Z", "#4fae88") + path("M341 171 L352 178 M347 169 L357 176", "none", 'stroke="#3a8a6a" stroke-width="1"') + // Folded wing.
        circle(326, 176, 11, "#8fe0b4") + path("M318 169 l-3 -8 l6 4 Z M330 167 l3 -8 l3 8 Z", "#4fae88") + path("M319 178 q3 3 7 1", "none", 'stroke="#2a4a3a" stroke-width="1.4" stroke-linecap="round"') + path("M332 174 q3 3 6 1", "none", 'stroke="#2a4a3a" stroke-width="1.4" stroke-linecap="round"') + oval(323, 183, 3, 2, "#ffb3d1") + circle(315, 176, 1, "#2a4a3a") + // Head, horns, closed eyes, a rosy cheek.
        path("M312 172 q-5 -4 -3 -8 q3 -3 1 -8", "none", 'stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".55" class="lp-twinkle"') + // Smoke from the nostril.
        path(star(366, 174, 4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.5s"') + path(star(304, 184, 3), "#fff8dc", 'class="lp-twinkle" style="animation-delay:1.1s"') + path("M319 166 l1.5 -7 l3 4.5 l3 -6 l3 6 l3 -4.5 l1.5 7 Z", "#ffdc83", 'class="lp-neon"') + circle(326.5, 163, 1, "#ff6fb0", 'class="lp-twinkle"') + ART.board(); // ...and a very small crown, because of course.
    },

    // Star Capsule sidetable
    "table-cake": function () { // A strawberry layer cake on a glass stand.
      return ART.table("#c0764f") + oval(335, 323, 14, 2.5, "#e8dff0") + rect(332, 313, 6, 10, "#e8dff0") + oval(335, 313, 26, 4, "#fff8f0") +
        rect(315, 291, 40, 21, "#ffd9e6", 'rx="3"') + rect(315, 300, 40, 3.5, "#e8556a") +
        path("M315 294 Q315 287 322 287 H348 Q355 287 355 294 V297 q-4 5 -7 0 q-4 7 -8 0 q-4 5 -8 0 q-4 7 -8 0 q-3 4 -9 0 Z", "#fff8f0") +
        [[325, 283], [335, 281], [345, 283]].map(function (b) { return path("M" + (b[0] - 5) + " " + (b[1] - 1) + " Q" + b[0] + " " + (b[1] - 5) + " " + (b[0] + 5) + " " + (b[1] - 1) + " Q" + (b[0] + 4) + " " + (b[1] + 6) + " " + b[0] + " " + (b[1] + 7) + " Q" + (b[0] - 4) + " " + (b[1] + 6) + " " + (b[0] - 5) + " " + (b[1] - 1) + " Z", "#e8556a") + path("M" + (b[0] - 3) + " " + (b[1] - 4) + " L" + b[0] + " " + (b[1] - 7) + " L" + (b[0] + 3) + " " + (b[1] - 4) + " Z", "#5fae86"); }).join("");
    },
    "table-toadstool": function () { // The table IS a big flat toadstool, with a snail asleep on top.
      return path("M326 362 Q330 346 330 332 H342 Q342 346 346 362 Z", "#fff1e0") + path("M300 330 Q300 312 320 308 H352 Q372 312 372 330 Q336 342 300 330 Z", "#e8556a") + path("M304 332 Q336 342 368 332 Q336 348 304 332 Z", "#f6dcc0") +
        circle(314, 322, 4.5, "#fff") + circle(334, 326, 3.5, "#fff") + circle(356, 322, 5, "#fff") + oval(345, 314, 3.5, 2, "#fff") + oval(322, 312, 3, 1.8, "#fff") +
        path("M322 309 Q324 302 334 302 H348 Q352 302 354 296", "none", 'stroke="#d9c79a" stroke-width="5" stroke-linecap="round"') + circle(354, 293, 3, "#d9c79a") + path("M355 289 L358 284 M352 289 L352 283", "none", 'stroke="#d9c79a" stroke-width="1.3" stroke-linecap="round"') +
        circle(336, 294, 11, "#c0764f") + path("M336 294 m0 -7 a7 7 0 1 1 -7 7 a5 5 0 1 0 5 -5 a3 3 0 1 1 3 3", "none", 'stroke="#7a4a2a" stroke-width="1.6"') + circle(355, 293, .9, "#2a1a3e");
    },
    "table-typewriter": function () { // A teal typewriter halfway through a love poem.
      let keys = "";
      for (let row = 0; row < 3; row++) for (let col = 0; col < 8 - row; col++) keys += circle(320 + row * 2 + col * 4.4, 310 + row * 4.4, 1.5, "#fff8f0");
      return ART.table("#7a5a8c") + rect(322, 280, 26, 20, "#fff8f0") + path("M326 286 H344 M326 291 H340", "none", 'stroke="#8a7aa8" stroke-width="1.2"') + path("M336 296 c-2 -2 -4 1 0 3 c4 -2 2 -5 0 -3 Z", "#e8556a") +
        rect(316, 297, 38, 6, "#2a4a48", 'rx="3"') + circle(314, 300, 3.5, "#d9b24a") + circle(356, 300, 3.5, "#d9b24a") +
        path("M314 302 H356 L364 324 H306 Z", "#3a8a84") + keys + rect(322, 322, 26, 2, "#2a4a48");
    },
    "table-clock": function () { // A twin-bell alarm clock that has clearly been dozing too.
      return ART.table("#5a4a70") + path("M318 322 l-4 3 M352 322 l4 3", "none", 'stroke="#d9b24a" stroke-width="3" stroke-linecap="round"') +
        circle(320, 284, 8.5, "#ffdc83") + circle(350, 284, 8.5, "#ffdc83") + rect(333, 274, 4, 10, "#d9b24a") + path("M328 274 H342", "none", 'stroke="#d9b24a" stroke-width="3" stroke-linecap="round"') +
        circle(335, 305, 20, "#e8556a") + circle(335, 305, 15, "#fff8f0") +
        [0, 90, 180, 270].map(function (a) { return rect(334, 292, 2, 3.5, "#8a7aa8", 'transform="rotate(' + a + ' 335 305)"'); }).join("") +
        path("M335 305 V295 M335 305 L342 309", "none", 'stroke="#2a1a3e" stroke-width="1.8" stroke-linecap="round"') + circle(335, 305, 1.8, "#e8556a") +
        path("M358 278 h5 l-5 6 h5 M365 268 h4 l-4 5 h4", "none", 'stroke="#c9a8ff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"');
    },
    "table-gramophone": function () { // A wind-up gramophone with a great golden horn, playing a tune.
      function note(x, y, fill, delay) { return circle(x, y, 2.4, fill, 'class="lp-twinkle" style="animation-delay:' + delay + 's"') + path("M" + (x + 2.3) + " " + y + " V" + (y - 10) + " l5 2", "none", 'stroke="' + fill + '" stroke-width="1.4"'); }
      return ART.table("#6b4a2f") + rect(318, 308, 40, 16, "#8a5a2a", 'rx="2"') + rect(318, 319, 40, 5, "#6b4a2f") + oval(338, 308, 19, 3.5, "#2a1a3e") + oval(338, 307.5, 6, 1.2, "#e8556a") +
        rect(362, 312, 7, 3, "#d9b24a") + circle(370, 313, 3, "#d9b24a") +
        path("M344 306 C336 302 326 298 312 296 L300 288 L322 268 L328 282 C332 292 340 298 346 302 Z", "#d9b24a") + oval(310, 279, 17, 7, "#8a6a2a", 'transform="rotate(-42 310 279)"') + oval(310, 279, 12, 4, "#4a3524", 'transform="rotate(-42 310 279)"') +
        path("M344 306 C336 302 326 298 312 296 M346 302 C340 298 332 292 328 282", "none", 'stroke="#ffe9a8" stroke-width="1.2"') +
        note(340, 282, "#ff8ecb", 0) + note(354, 292, "#70ebea", .5) + note(362, 278, "#ffdc83", 1);
    },
    "table-terrarium": function () { // A little world under a glass dome: moss, mushrooms and one firefly.
      return ART.table("#5a4a70") + rect(312, 318, 46, 6, "#8a5a2a", 'rx="2"') + path("M316 318 Q316 288 335 284 Q354 288 354 318 Z", "#23402f") + path("M316 318 Q326 300 338 308 Q348 302 354 318 Z", "#5fae86") +
        path("M322 318 Q330 310 340 316 Q348 312 352 318 Z", "#7fc49a") + rect(328, 300, 2.5, 10, "#fff1e0") + path("M323 302 Q329 293 336 302 Z", "#e8556a") + rect(344, 306, 2, 7, "#fff1e0") + path("M340 307 Q345 300 350 307 Z", "#ffb84a") +
        path("M320 316 q-1 -8 -4 -12 M320 316 q2 -7 1 -14", "none", 'stroke="#3f8a66" stroke-width="1.5" stroke-linecap="round"') +
        path("M314 318 V292 A21 21 0 0 1 356 292 V318 Z", "#bfe8ff", 'opacity=".22" stroke="#cfe8ff" stroke-width="2"') + path("M320 294 A15 15 0 0 1 332 278", "none", 'stroke="#fff" stroke-width="2.5" opacity=".55" stroke-linecap="round"') + circle(335, 269, 3.5, "#d9b24a") +
        circle(344, 292, 5, "#ffdc83", 'opacity=".25"') + circle(344, 292, 1.8, "#ffe9a8", 'class="lp-twinkle"');
    },
    "table-arcade": function () { // A tiny arcade cabinet with a pixel heart on its glowing screen.
      const pixels = ["01100110", "11111111", "11111111", "01111110", "00111100", "00011000"];
      let heart = "";
      pixels.forEach(function (row, y) { row.split("").forEach(function (bit, x) { if (bit === "1") heart += rect(325 + x * 2.5, 283 + y * 2.5, 2.6, 2.6, "#ff8ecb"); }); });
      return ART.table("#3a3350") + path("M316 324 V300 L320 272 Q322 266 330 266 H346 Q352 266 352 272 V324 Z", "#4b2a8a") + path("M316 324 V300 L320 272 Q320 268 322 267 L322 324 Z", "#3a2070") +
        rect(323, 266, 28, 9, "#70ebea", 'rx="2" class="lp-neon"') + path(star(337, 270.5, 3.5), "#fff8dc") +
        rect(323, 279, 26, 22, "#120f2a", 'rx="2"') + heart + rect(320, 303, 32, 10, "#6d4bb0") + line(329, 309, 329, 303, "#a8b4c4", 1.8) + circle(329, 303, 2.6, "#e8556a") + circle(340, 308, 2, "#ffdc83") + circle(347, 308, 2, "#7fc49a") + rect(330, 316, 12, 5, "#2a1a3e", 'rx="1"') + rect(333, 318, 6, 1.5, "#ffdc83");
    },
    "table-potions": function () { // An alchemy set: flask over a small flame, glass pipe dripping into a bubbling jar, a rack of tubes.
      return ART.table("#7a5a3a") +
        oval(322, 316, 9, 5, "#ffb84a", 'opacity=".25"') + path("M322 312 q5 6 0 11 q-5 -5 0 -11 Z", "#ffb84a", 'class="lp-twinkle"') + path("M313 310 L310 324 M331 310 L334 324", "none", 'stroke="#8a7aa8" stroke-width="2"') + rect(311, 308, 22, 2.5, "#8a7aa8") +
        rect(318, 279, 8, 11, "#bfe8ff", 'opacity=".4" stroke="#cfe8ff" stroke-width="1.5"') + circle(322, 297, 13, "#bfe8ff", 'opacity=".32" stroke="#cfe8ff" stroke-width="1.5"') + path("M310 300 Q322 294 334 300 A13 13 0 0 1 310 300 Z", "#ff5fa8", 'class="lp-neon"') +
        path("M322 279 Q322 269 332 269 H342 Q350 269 350 282", "none", 'stroke="#cfe8ff" stroke-width="2.5" opacity=".7"') + rect(319, 276, 6, 4, "#a8743f") + // The glass pipe from the flask's cork down into the jar.
        path("M350 280 V290 L363 318 Q364 324 358 324 H342 Q336 324 337 318 L350 290", "#bfe8ff", 'opacity=".3" stroke="#cfe8ff" stroke-width="1.5"') + path("M343 310 H357 L362 320 Q362 323 358 323 H342 Q338 323 338 320 Z", "#70ebea") + circle(350, 298, 1.6, "#ff8ecb", 'class="lp-twinkle" style="animation-delay:.5s"') +
        [[318, 294, 1.6], [326, 291, 1.2], [322, 288, 1], [346, 314, 1.5], [353, 306, 1.2], [349, 300, 1]].map(function (b, i) { return circle(b[0], b[1], b[2], "#fff", 'opacity=".85" class="lp-twinkle" style="animation-delay:' + (i * .3) + 's"'); }).join("");
    },
    "table-musicbox": function () { // An open music box lined in velvet, with a tiny dancer twirling before a mirror.
      return rect(314, 328, 4, 34, "#d9b24a") + rect(354, 328, 4, 34, "#d9b24a") + rect(316, 346, 40, 3, "#d9b24a", 'opacity=".7"') + rect(304, 324, 64, 6, "#d9b24a", 'rx="2"') + path("M304 328 q8 8 16 0 q8 8 16 0 q8 8 16 0 q8 8 16 0 V324 H304 Z", "#fff8f0") + // Legs first, so the lace cloth hangs over them.
        path("M312 300 V274 Q312 270 316 270 H354 Q358 270 358 274 V300 Z", "#6d2f6a", 'stroke="#d9b24a" stroke-width="2"') + oval(335, 285, 17, 12, "#cfe8ff", 'opacity=".55" stroke="#ffdc83" stroke-width="1.5"') + path("M324 280 Q330 276 336 277", "none", 'stroke="#fff" stroke-width="1.5" opacity=".7" stroke-linecap="round"') +
        rect(310, 302, 50, 22, "#8a3f88", 'rx="2"') + rect(310, 300, 50, 4, "#d9b24a", 'rx="1"') + rect(310, 320, 50, 4, "#d9b24a", 'rx="1"') + path(star(335, 313, 5), "#ffe9a8") + path(star(320, 313, 3), "#ffdc83") + path(star(350, 313, 3), "#ffdc83") +
        rect(361, 310, 5, 2.5, "#d9b24a") + path("M366 306 q5 2 0 5 q-5 -3 0 -5 M366 317 q5 -2 0 -5 q-5 3 0 5", "#d9b24a") +
        line(335, 300, 335, 292, "#d9b24a", 1.5) + path("M335 278 L344 294 Q335 298 326 294 Z", "#ff8ecb") + path("M327 293 Q335 289 343 293 Q335 297 327 293 Z", "#fff") + circle(335, 276, 3.6, "#fce1f2") + path("M335 278 Q326 276 325 270 M335 278 Q344 276 345 270", "none", 'stroke="#fce1f2" stroke-width="1.5" stroke-linecap="round"') + path("M332 274 L335 271 L338 274", "none", 'stroke="#ffdc83" stroke-width="1.4"') +
        path(star(319, 280, 3), "#fff8dc", 'class="lp-twinkle"') + path(star(351, 279, 3.5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.6s"');
    },
    "table-orrery": function () { // The showpiece: a brass clockwork solar system on a claw-footed pedestal, planets twinkling in their orbits.
      const planets = [[-26, 7, 4.5, "#70b8eb", 0], [23, -7, 3.5, "#ff9d6b", .5], [-12, -12, 3, "#c9a8ff", 1], [36, 6, 5, "#7fc49a", 1.5]];
      const cx = 336, cy = 290;
      return oval(cx, cy, 46, 26, "#ffdc83", 'opacity=".08"') +
        path("M326 362 Q330 358 330 348 V336 H342 V348 Q342 358 346 362 Z", "#8a6a2a") + path("M318 362 Q322 350 332 350 M354 362 Q350 350 340 350", "none", 'stroke="#d9b24a" stroke-width="4" stroke-linecap="round"') +
        circle(318, 362, 3, "#ffdc83") + circle(354, 362, 3, "#ffdc83") + rect(304, 328, 64, 7, "#6d4585", 'rx="3"') + path("M304 331.5 H368", "none", 'stroke="#ffdc83" stroke-width="1.5"') +
        path("M336 328 V296 M326 328 Q336 316 346 328", "none", 'stroke="#d9b24a" stroke-width="3" stroke-linecap="round"') + circle(336, 322, 7, "none", 'stroke="#d9b24a" stroke-width="2.5" stroke-dasharray="2.5 2"') +
        oval(cx, cy, 16, 6, "none", 'stroke="#d9b24a" stroke-width="1.5"') + oval(cx, cy, 27, 10, "none", 'stroke="#d9b24a" stroke-width="1.5" opacity=".85"') + oval(cx, cy, 37, 14, "none", 'stroke="#d9b24a" stroke-width="1.5" opacity=".7"') +
        circle(cx, cy, 15, "#ffdc83", 'opacity=".2"') + circle(cx, cy, 9, "#ffdc83", 'class="lp-neon"') + circle(cx, cy, 5, "#fff8dc") +
        planets.map(function (p) { return circle(cx + p[0], cy + p[1], p[2], p[3], 'class="lp-twinkle" style="animation-delay:' + p[4] + 's"') + circle(cx + p[0] - p[2] * .3, cy + p[1] - p[2] * .3, p[2] * .3, "#fff", 'opacity=".7"'); }).join("") +
        oval(cx + 36, cy + 6, 8.5, 2.2, "none", 'stroke="#ffe9a8" stroke-width="1.2" transform="rotate(-16 ' + (cx + 36) + " " + (cy + 6) + ')"') +
        [[302, 274, 3], [370, 276, 3.5], [316, 269, 2.5], [356, 269, 2.5]].map(function (s, i) { return path(star(s[0], s[1], s[2]), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .4) + 's"'); }).join("");
    },

    // Star Capsule toychest
    "chest-crate": function () { // A slatted crate of alphabet-style blocks (with pictures, not letters) and a ball.
      function block(x, y, s, fill, mark) { return rect(x, y, s, s, fill, 'rx="2"') + rect(x + 2, y + 2, s - 4, s - 4, "none", 'stroke="#fff" stroke-width="1" opacity=".6" rx="1"') + mark; }
      return circle(112, 428, 12, "#70b8eb") + path("M101 424 Q112 420 123 428 M104 436 Q114 430 122 436", "none", 'stroke="#fff" stroke-width="2.5"') +
        block(64, 418, 22, "#ff8ecb", path(star(75, 429, 7), "#fff8dc")) + block(88, 424, 20, "#ffdc83", path("M98 442 c-9 -6 -7 -13 -3 -13 q3 0 3 3 q0 -3 3 -3 c4 0 6 7 -3 13 Z", "#e8556a")) +
        block(70, 402, 18, "#7fc49a", circle(79, 411, 4.5, "#fff8dc")) +
        rect(56, 436, 72, 38, "#54391f", 'rx="2"') + [438, 451, 464].map(function (y) { return rect(54, y, 76, 9, "#c79256", 'rx="1"'); }).join("") + rect(58, 434, 8, 42, "#a8743f", 'rx="1"') + rect(118, 434, 8, 42, "#a8743f", 'rx="1"') +
        [[62, 442], [62, 455], [62, 468], [122, 442], [122, 455], [122, 468]].map(function (n) { return circle(n[0], n[1], 1.3, "#54391f"); }).join("");
    },
    "chest-kitty": function () { // A cat-shaped toy box whose lid has a little pair of ears.
      return oval(92, 476, 42, 4, "#00000044") + path("M60 442 L58 412 L82 430 Z M124 442 L126 412 L102 430 Z", "#c9a8ff") + path("M63 436 L62 420 L76 431 Z M121 436 L122 420 L108 431 Z", "#ffb3d1") +
        rect(56, 428, 72, 46, "#c9a8ff", 'rx="11"') + rect(56, 428, 72, 14, "#b08ce8", 'rx="9"') + path("M56 442 H128", "none", 'stroke="#8a64c0" stroke-width="2"') +
        circle(77, 456, 6, "#2a1a3e") + circle(107, 456, 6, "#2a1a3e") + circle(79, 454, 2, "#fff") + circle(109, 454, 2, "#fff") + path("M88 461 h8 l-4 4.5 Z", "#ff8ecb") +
        path("M92 465.5 q-5 6 -10 2 M92 465.5 q5 6 10 2", "none", 'stroke="#462846" stroke-width="1.8" stroke-linecap="round"') +
        path("M67 462 L52 459 M67 466 L52 468 M117 462 L132 459 M117 466 L132 468", "none", 'stroke="#fff8f0" stroke-width="1.4" stroke-linecap="round"') +
        oval(70, 475, 9, 4, "#b08ce8") + oval(114, 475, 9, 4, "#b08ce8");
    },
    "chest-pail": function () { // A seaside bucket with its spade, a starfish, a beach ball, and a little spilled sand.
      return oval(92, 472, 44, 7, "#e6c98e") + circle(112, 460, 3, "#d9b676") + circle(64, 468, 2.4, "#d9b676") +
        circle(116, 450, 14, "#fff8f0") + path("M116 436 Q124 450 116 464 Q130 458 130 450 Q130 440 116 436 Z", "#e8556a") + path("M116 436 Q108 450 116 464 Q102 458 102 450 Q102 440 116 436 Z", "#70b8eb") + circle(116, 450, 2.6, "#ffdc83") +
        path("M64 404 L72 442", "none", 'stroke="#ffdc83" stroke-width="4" stroke-linecap="round"') + path("M56 398 Q64 386 72 398 L68 412 H60 Z", "#ffb84a", 'transform="rotate(-11 64 404)"') +
        path("M58 430 Q80 408 106 430", "none", 'stroke="#c8d2e8" stroke-width="3"') + path("M60 430 H104 L98 470 H66 Z", "#ff8ecb") + oval(82, 430, 22, 5, "#d46fb8") + oval(82, 430, 18, 3, "#e6c98e") +
        path("M64 450 q6 -5 12 0 t12 0 t12 0", "none", 'stroke="#fff" stroke-width="3" stroke-linecap="round"') +
        group(path(star(0, 0, 11), "#ff9d6b") + circle(0, 0, 3, "#ffb98a") + circle(-2, -2, 1, "#d9652e") + circle(2, 1, 1, "#d9652e"), 'transform="translate(82 462) rotate(20)"');
    },
    "chest-present": function () { // A wrapped gift with a floppy bow, one ear of a plush peeking under the lid.
      return oval(92, 476, 44, 4, "#00000044") + scatter(83, 11, function (roll) { return rect(round(roll(52, 132)), round(roll(404, 430)), 3, 3, ["#ff8ecb", "#70ebea", "#ffdc83"][Math.floor(roll(0, 3))], 'transform="rotate(' + Math.round(roll(0, 90)) + " " + round(roll(52, 132)) + ' 410)"'); }) +
        rect(60, 442, 64, 32, "#70b8eb", 'rx="2"') + [[68, 450], [78, 460], [68, 468], [107, 450], [117, 460], [107, 468], [80, 448], [116, 470]].map(function (d) { return circle(d[0], d[1], 2.4, "#fff", 'opacity=".75"'); }).join("") + rect(86, 442, 12, 32, "#ff8ecb") +
        path("M72 434 Q68 422 76 420 Q82 422 78 434 Z", "#fce1f2") + rect(54, 430, 76, 14, "#5a9bda", 'rx="2"') + rect(86, 430, 12, 14, "#ff8ecb") +
        path("M92 430 Q70 406 62 418 Q60 430 92 430 Z M92 430 Q114 406 122 418 Q124 430 92 430 Z", "#ff8ecb") + path("M92 430 Q76 416 68 420 M92 430 Q108 416 116 420", "none", 'stroke="#e8669f" stroke-width="1.5"') + circle(92, 428, 5.5, "#e8669f");
    },
    "chest-wagon": function () { // A little red wagon loaded with a ball, a plush bunny and a flag.
      function wheel(x) { return circle(x, 467, 8, "#6a5a80") + circle(x, 467, 4, "#c8d2e8") + circle(x, 467, 1.3, "#2a1a3e"); }
      return oval(92, 475, 44, 3, "#00000044") + line(66, 448, 50, 432, "#c8d2e8", 3) + path("M42 434 q8 -7 16 -2", "none", 'stroke="#ffdc83" stroke-width="5" stroke-linecap="round"') +
        path("M112 420 V404 L126 410 L112 416", "#ffdc83", 'stroke="#8a7aa8" stroke-width="1.5"') + circle(108, 436, 14, "#7fc49a") + path("M96 432 Q108 428 120 436 M99 444 Q108 438 118 444", "none", 'stroke="#fff" stroke-width="2.5" opacity=".85"') +
        oval(73, 414, 3.5, 11, "#fff1e0", 'transform="rotate(-10 73 414)"') + oval(83, 413, 3.5, 11, "#fff1e0", 'transform="rotate(10 83 413)"') + circle(78, 430, 12, "#fff1e0") + circle(74, 428, 1.5, "#462846") + circle(82, 428, 1.5, "#462846") + path("M76.5 433 h3 l-1.5 2 Z", "#ff8ecb") +
        path("M60 442 H126 L122 464 H64 Z", "#e8556a") + rect(58, 440, 70, 5, "#fff1e0", 'rx="2"') + path("M72 445 V463 M92 445 V463 M112 445 V463", "none", 'stroke="#c23a50" stroke-width="2"') + wheel(74) + wheel(112);
    },
    "chest-trunk": function () { // A well-travelled steamer trunk, its sides pasted with stickers.
      return oval(92, 476, 44, 4, "#00000044") + rect(56, 432, 72, 42, "#2f7a78", 'rx="3"') + rect(56, 416, 72, 18, "#3a908c", 'rx="4"') + rect(54, 432, 76, 4, "#d9b24a", 'rx="1"') +
        [62, 112].map(function (x) { return rect(x, 416, 10, 58, "#7a4a2a") + rect(x + 2, 428, 6, 8, "#ffdc83", 'rx="1"'); }).join("") +
        circle(87, 452, 10, "#fff1e0") + path(star(87, 452, 7), "#e8556a") + rect(99, 442, 11, 15, "#ffdc83", 'rx="1" transform="rotate(10 104 450)"') + path("M100 445 l9 1 M99 450 l9 1 M99 454 l6 1", "none", 'stroke="#7a4a2a" stroke-width="1"') + oval(78, 467, 8, 5, "#ff8ecb") + path("M74 467 q4 -4 8 0", "none", 'stroke="#fff" stroke-width="1.4"') + rect(95, 462, 12, 9, "#c9a8ff", 'transform="rotate(-8 101 466)"') + path("M97 466 l8 -1", "none", 'stroke="#fff" stroke-width="1.4"') +
        rect(86, 422, 12, 15, "#ffdc83", 'rx="2"') + circle(92, 430, 2, "#2a1a3e") + path("M80 416 Q92 406 104 416", "none", 'stroke="#54391f" stroke-width="3.5" stroke-linecap="round"') +
        [[56, 416], [128, 416], [56, 474], [128, 474]].map(function (c) { return circle(c[0], c[1], 3.2, "#d9b24a"); }).join("");
    },
    "chest-dollhouse": function () { // A toy box built as a dollhouse with its front off: four tiny furnished rooms.
      return oval(92, 476, 44, 4, "#00000044") + path("M50 438 L92 402 L134 438 Z", "#c0495e") + path("M92 402 L122 428 M92 402 L62 428", "none", 'stroke="#8f2f44" stroke-width="1.4"') + circle(92, 424, 6, "#ffe9a8", 'stroke="#fff1e0" stroke-width="2"') + rect(112, 408, 8, 16, "#a8743f") +
        rect(58, 436, 68, 38, "#fff1e0") + rect(61, 439, 30, 15, "#70b8eb") + rect(93, 439, 30, 15, "#ffdc83") + rect(61, 456, 30, 15, "#ff8ecb") + rect(93, 456, 30, 15, "#c9a8ff") + // Four rooms, one wallpaper colour each.
        rect(64, 449, 14, 5, "#fff8f0", 'rx="1"') + rect(64, 446, 5, 3, "#ff8ecb", 'rx="1"') + circle(84, 444, 3.2, "#fff8dc") + // Bedroom: a bed and a moon lamp.
        rect(97, 448, 10, 6, "#a8743f") + rect(100, 444, 4, 4, "#e8556a", 'rx="1"') + rect(112, 443, 7, 11, "#3a5a52", 'rx="1"') + // Study: desk and bookcase.
        rect(65, 465, 12, 6, "#7a4a2a", 'rx="1"') + oval(84, 469, 4, 2, "#5fae86") + line(84, 462, 84, 468, "#3f8a66", 1.5) + // Parlour: sofa and pot plant.
        circle(102, 466, 5, "#e8556a") + rect(111, 460, 8, 11, "#fff8f0", 'rx="2"') + circle(115, 464, 1.3, "#2a1a3e"); // Nursery: a ball and a tiny cot.
    },
    "chest-dragon": function () { // A small sleepy dragon curled protectively around her toy chest, snoring.
      const body = "#5fc0a0";
      return oval(92, 477, 48, 4, "#00000044") + path("M108 432 L136 412 L132 438 L122 434 Z", "#3f8a78") + path("M116 430 L130 420 M118 434 L130 428", "none", 'stroke="#2f6a5c" stroke-width="1.3"') +
        path("M60 470 Q44 448 64 434 Q90 420 118 430 Q138 442 130 466", "none", 'stroke="' + body + '" stroke-width="15" stroke-linecap="round"') +
        [[78, 423], [92, 420], [106, 422], [120, 428]].map(function (t) { return path("M" + (t[0] - 5) + " " + (t[1] + 3) + " L" + t[0] + " " + (t[1] - 7) + " L" + (t[0] + 5) + " " + (t[1] + 3) + " Z", "#ffb84a"); }).join("") +
        oval(93, 450, 34, 22, "#469a82") + // Her tummy fills the space behind the chest.
        rect(70, 440, 46, 32, "#a8743f", 'rx="3"') + path("M70 448 H116", "none", 'stroke="#7a4a2a" stroke-width="3"') + path("M82 440 V472 M104 440 V472", "none", 'stroke="#ffdc83" stroke-width="2.5"') + rect(88, 445, 10, 12, "#ffdc83", 'rx="2"') + circle(93, 451, 1.8, "#7a4a2a") +
        path("M130 466 Q116 480 88 475 Q76 473 70 477", "none", 'stroke="' + body + '" stroke-width="7" stroke-linecap="round"') + path("M72 476 L60 470 L66 482 Z", "#ffb84a") +
        path("M56 428 L50 412 L62 422 Z M70 428 L74 412 L64 422 Z", "#ffdc83") + oval(62, 437, 15, 12, body) + oval(50, 443, 10, 7, "#7fd6bc") + path("M57 435 q5 4 10 0", "none", 'stroke="#23402f" stroke-width="2" stroke-linecap="round"') + circle(46, 441, 1.1, "#23402f") + circle(52, 442, 1.1, "#23402f") +
        circle(47, 431, 2.6, "#e8dff0", 'opacity=".55" class="lp-twinkle"') + circle(45, 422, 3.8, "#e8dff0", 'opacity=".4" class="lp-twinkle" style="animation-delay:.5s"') +
        [[118, 462], [100, 474]].map(function (c) { return oval(c[0], c[1], 5, 2.6, "#ffdc83", 'stroke="#d9b24a" stroke-width="1"'); }).join("");
    },
    "chest-carousel": function () { // A little merry-go-round toy box, its bulbs winking around a striped top.
      function horse(x, y, fill) { return line(x, 442, x, 468, "#ffdc83", 1.6) + oval(x, y, 7.5, 4, fill) + circle(x + 6, y - 5, 3, fill) + path("M" + (x - 6) + " " + (y + 2) + " l-2 7 M" + (x + 5) + " " + (y + 2) + " l2 7", "none", 'stroke="' + fill + '" stroke-width="2" stroke-linecap="round"') + path("M" + (x - 7) + " " + y + " q-5 1 -4 6", "none", 'stroke="#ff8ecb" stroke-width="1.6" stroke-linecap="round"') + rect(x - 3, y - 4, 5, 3, "#70ebea", 'rx="1"'); }
      const stripes = [["#e8556a", 56, 70], ["#fff1e0", 70, 84], ["#e8556a", 84, 100], ["#fff1e0", 100, 114], ["#e8556a", 114, 128]];
      return oval(92, 476, 46, 4, "#00000044") + oval(92, 442, 36, 5, "#2a1a3e") + rect(62, 442, 60, 28, "#3a2460") + rect(88, 438, 8, 32, "#d9b24a") + horse(72, 458, "#fff8f0") + horse(112, 456, "#ffdc83") +
        oval(92, 470, 44, 7, "#6d4bb0") + rect(48, 468, 88, 5, "#d9b24a", 'rx="2"') + oval(92, 466, 40, 4.5, "#8a64c0") +
        stripes.map(function (s) { return path("M92 405 L" + s[1] + " 437 Q" + ((s[1] + s[2]) / 2) + " 443 " + s[2] + " 437 Z", s[0]); }).join("") + rect(52, 435, 80, 5, "#ffdc83", 'rx="2"') + line(92, 405, 92, 396, "#ffdc83", 1.6) + path("M92 396 L104 400 L92 404 Z", "#70ebea") +
        [58, 72, 87, 102, 116, 128].map(function (x, i) { return circle(x, 437.5, 2, "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .3) + 's"'); }).join("");
    },
    "chest-stardust": function () { // The showpiece: a midnight chest flung open, starlight and toys spiralling up out of it.
      const toys = [[58, 410, "star", "#ffdc83"], [78, 400, "moon", "#fff1cd"], [108, 402, "ball", "#70ebea"], [126, 416, "star", "#ff8ecb"], [46, 428, "ball", "#ffb3d1"], [136, 436, "moon", "#c9a8ff"]];
      return oval(92, 478, 50, 5, GLOW, 'opacity=".3"') + oval(92, 430, 54, 40, GLOW, 'opacity=".1"') +
        path("M62 442 Q58 412 92 410 Q126 412 122 442 Z", "#20265a", 'stroke="#ffdc83" stroke-width="2"') + path("M68 438 Q68 418 92 417 Q116 418 116 438", "none", 'stroke="#ffdc83" stroke-width="1" opacity=".6"') + path(star(92, 426, 6), "#ffdc83") +
        path("M78 448 Q60 422 76 408 M92 448 Q92 420 96 398 M106 448 Q124 424 108 408", "none", 'stroke="' + GLOW + '" stroke-width="3" stroke-linecap="round" class="lp-neon" opacity=".85"') +
        oval(92, 448, 32, 6, "#fff1cd", 'opacity=".95"') + oval(92, 448, 22, 3.5, GLOW) +
        rect(58, 448, 68, 26, "#20265a", 'rx="3"') + rect(58, 448, 68, 4, "#ffdc83", 'rx="1"') + rect(58, 470, 68, 4, "#ffdc83", 'rx="1"') + path("M72 452 V470 M112 452 V470", "none", 'stroke="#ffdc83" stroke-width="2"') +
        path("M92 454 C84 454 80 462 92 468 C104 462 100 454 92 454 Z", "#ffdc83") + path(star(92, 461, 4), "#fff8dc") + oval(66, 476, 6, 3, "#d9b24a") + oval(118, 476, 6, 3, "#d9b24a") +
        scatter(91, 7, function (roll, i) { return circle(round(roll(62, 122)), round(roll(453, 468)), round(roll(.8, 1.4)), "#cfe0ff", 'opacity=".8" class="lp-twinkle" style="animation-delay:' + round(i * .3) + 's"'); }) +
        toys.map(function (t, i) {
          const glow = 'class="lp-twinkle" style="animation-delay:' + round(i * .35) + 's"';
          return t[2] === "star" ? path(star(t[0], t[1], 8), t[3], glow) : t[2] === "moon" ? path("M" + t[0] + " " + (t[1] - 7) + " A7 7 0 1 0 " + (t[0] + 6) + " " + (t[1] + 3) + " A6 6 0 1 1 " + t[0] + " " + (t[1] - 7) + " Z", t[3], glow) : circle(t[0], t[1], 4.5, t[3], glow);
        }).join("") +
        scatter(55, 12, function (roll, i) { return path(star(round(roll(60, 126)), round(roll(400, 442)), round(roll(1.5, 3.4))), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + round(i * .17) + 's"'); });
    },

    // Star Capsule view
    "view-clover": function () { // Green hills, a red barn, a fence along the near grass and clover flowers dotted through it.
      function dots(seed, count, top, bottom, r) { // Many small circles as one path, so they cost one shape.
        return scatter(seed, count, function (roll) { const x = round(roll(6, 234)), y = round(roll(top, bottom)); return "M" + round(x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; });
      }
      const clouds = [[40, 26, 1], [128, 18, .8], [196, 32, 1.1]].map(function (c) { return group(oval(0, 0, 18, 7, "#fff", 'opacity=".9"') + oval(-8, -5, 9, 7, "#fff", 'opacity=".9"') + oval(7, -6, 10, 8, "#fff", 'opacity=".9"'), 'transform="translate(' + c[0] + " " + c[1] + ") scale(" + c[2] + ')"'); }).join("");
      const barn = rect(146, 84, 26, 22, "#c8483e") + path("M142 86 L159 72 L176 86 Z", "#8a3030") + rect(155, 94, 8, 12, "#f5e2c8") + path("M155 94 L163 106 M163 94 L155 106", "none", 'stroke="#c8483e" stroke-width="1"');
      let posts = "M0 112 H240 M0 117 H240";
      for (let x = 10; x < 240; x += 20) posts += " M" + x + " 108 V124";
      return view(["#7fcbe8", "#eaf6d0"], ["#101d3a", "#2b4a5e"], 26,
        hills(61, 84, 26, "#9ad6a4") + clouds,
        hills(62, 102, 22, "#66b87a") + barn,
        hills(63, 120, 12, "#3f9a5a") + path(posts, "none", 'stroke="#f2e6cf" stroke-width="2"') + path(dots(64, 14, 118, 128, 1.6), "#ffb3d1") + path(dots(65, 10, 120, 129, 1.2), "#fff8dc"));
    },
    "view-dunes": function () { // Flat-topped red mesas, golden dunes and saguaro cacti under an apricot sky.
      const cacti = [30, 96, 170, 214].map(function (x) { return "M" + x + " 124 v-26 M" + x + " 110 h-8 q-2 0 -2 -2 v-8 M" + x + " 106 h7 q2 0 2 -2 v-6"; }).join(" ");
      return view(["#f0a070", "#fde3b8"], ["#1a1236", "#5a3050"], 22,
        path("M0 92 H18 L26 62 H62 L72 92 H128 L138 70 H176 L186 92 H240 V140 H0 Z", "#b56a6a") + path("M26 72 H63 M139 78 H178", "none", 'stroke="#8f4f58" stroke-width="2"'),
        hills(71, 98, 26, "#eab472"),
        hills(72, 118, 18, "#c9834a") + path(cacti, "none", 'stroke="#3f7a5a" stroke-width="4.5" stroke-linecap="round"') + oval(62, 124, 7, 3, "#8f5a34") + oval(140, 122, 9, 3.5, "#8f5a34") + oval(232, 126, 5, 2.5, "#8f5a34"));
    },
    "view-maple": function () { // An avenue of autumn trees in three colours, with two big maples on the lane in front.
      function crowns(list, r) { // Round tree-tops as one path.
        return list.map(function (c) { return "M" + (c[0] - r) + " " + c[1] + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z"; }).join(" ");
      }
      const row = [14, 40, 66, 92, 118, 144, 170, 196, 222].map(function (x, i) { return [x, 82 + (i * 5) % 8]; });
      const leaves = scatter(83, 16, function (roll) { const x = round(roll(6, 234)), y = round(roll(120, 129)); return "M" + x + " " + y + " q3 -3 6 0 q-3 3 -6 0Z "; });
      const big = [[20, 78], [140, 74]];
      return view(["#e8b45f", "#f9e8c4"], ["#161230", "#4a2c48"], 28,
        hills(81, 88, 26, "#d39563"),
        hills(82, 106, 10, "#a8763f") + path(row.map(function (c) { return "M" + c[0] + " " + c[1] + " V108"; }).join(" "), "none", 'stroke="#5a3a20" stroke-width="3"') + path(crowns(row.filter(function (c, i) { return i % 3 === 0; }), 13), "#d9482e") + path(crowns(row.filter(function (c, i) { return i % 3 === 1; }), 13), "#f08a2e") + path(crowns(row.filter(function (c, i) { return i % 3 === 2; }), 13), "#f6c23e"),
        hills(83, 122, 7, "#6a4020") + path(big.map(function (c) { return "M" + c[0] + " " + c[1] + " V124"; }).join(" "), "none", 'stroke="#3f2614" stroke-width="6"') + path(crowns([[8, 76], [32, 76], [20, 64], [128, 72], [152, 72], [140, 60]], 16), "#c9402a") + path(crowns([[20, 80], [140, 76]], 13), "#e8682e") + path(leaves, "#f0a030"));
    },
    "view-gumdrop": function () { // A sweet-shop countryside: gumdrop hills, lollipops and candy canes on a chocolate bank.
      function gum(list) { // Dome-shaped sweets as one path, sitting on y = 108.
        return list.map(function (g) { return "M" + (g[0] - g[1]) + " 108 C" + (g[0] - g[1]) + " " + (108 - g[2]) + " " + (g[0] + g[1]) + " " + (108 - g[2]) + " " + (g[0] + g[1]) + " 108 Z"; }).join(" ");
      }
      const sugar = scatter(95, 40, function (roll) { return "M" + round(roll(8, 232)) + " " + round(roll(82, 106)) + " h1.5 v1.5 h-1.5Z "; });
      const pops = [[36, 84, "#ff7aa8"], [120, 78, "#7ad6c0"], [205, 86, "#b58cf0"]];
      const canes = [[78, 96], [166, 92]];
      return view(["#ffb0d8", "#ffeccf"], ["#1c1238", "#5a3a70"], 24,
        hills(91, 90, 34, "#e6b3e0") + group(oval(52, 36, 20, 9, "#fff0f7") + oval(40, 30, 12, 9, "#fff0f7") + oval(64, 29, 13, 10, "#fff0f7") + oval(178, 22, 18, 8, "#ffe0ee") + oval(168, 17, 11, 8, "#ffe0ee") + oval(190, 16, 11, 8, "#ffe0ee")),
        rect(0, 106, 240, 40, "#ffd9ef") + path(gum([[24, 20, 40], [150, 22, 44]]), "#ff7aa8") + path(gum([[66, 18, 34], [196, 20, 38]]), "#7ad6c0") + path(gum([[108, 22, 46]]), "#ffd66b") + path(gum([[230, 9, 22]]), "#b58cf0") + path(sugar, "#fff", 'opacity=".75"'),
        waves(120, "#8a5236", 3) + pops.map(function (p) { return rect(p[0] - 1.5, p[1], 3, 124 - p[1], "#fff4e0") + circle(p[0], p[1], 12, p[2]) + path("M" + (p[0] - 7) + " " + p[1] + " a7 7 0 1 1 14 0 a4.5 4.5 0 1 1 -9 0", "none", 'stroke="#fff" stroke-width="2" opacity=".85" stroke-linecap="round"'); }).join("") +
        canes.map(function (c) { const d = "M" + c[0] + " 124 V" + c[1] + " a7 7 0 1 1 14 0"; return path(d, "none", 'stroke="#fff" stroke-width="5" stroke-linecap="round"') + path(d, "none", 'stroke="#e8455a" stroke-width="5" stroke-dasharray="4 5"'); }).join(""));
    },
    "view-balloons": function () { // Hot-air balloons at three distances over green hills; the nearest one sails past the fastest.
      function balloon(x, y, r, colour, stripe) { // Envelope, a narrower stripe panel down the middle, ropes and a basket.
        const a = round(r * .35), b = round(r * .12), c = round(r * .3), low = round(y + r * 1.3), mid = round(y + r * .85);
        return path("M" + round(x - r) + " " + y + " A" + r + " " + r + " 0 1 1 " + round(x + r) + " " + y + " Q" + round(x + r) + " " + mid + " " + round(x + c) + " " + low + " H" + round(x - c) + " Q" + round(x - r) + " " + mid + " " + round(x - r) + " " + y + " Z", colour) +
          path("M" + round(x - a) + " " + y + " A" + a + " " + r + " 0 1 1 " + round(x + a) + " " + y + " Q" + round(x + a) + " " + mid + " " + round(x + b) + " " + low + " H" + round(x - b) + " Q" + round(x - a) + " " + mid + " " + round(x - a) + " " + y + " Z", stripe) +
          path("M" + round(x - c) + " " + low + " L" + round(x - r * .2) + " " + round(low + r * .3) + " M" + round(x + c) + " " + low + " L" + round(x + r * .2) + " " + round(low + r * .3), "none", 'stroke="#6a4a2a" stroke-width=".8"') +
          rect(round(x - r * .22), round(low + r * .3), round(r * .44), round(r * .32), "#8a5a2a", 'rx="1"');
      }
      return view(["#9fd8f2", "#fff2d9"], ["#0f1a3a", "#34406a"], 30,
        hills(101, 104, 20, "#a4d3b0") + balloon(30, 40, 7, "#f2a65a", "#fff1cd") + balloon(116, 56, 6, "#6fb7e8", "#fff") + balloon(204, 32, 8, "#e87aa8", "#ffe0ee"),
        hills(102, 116, 14, "#66ad80") + balloon(60, 50, 13, "#e8556a", "#ffdc83") + balloon(176, 66, 12, "#7a6bd8", "#c9f0ff"),
        hills(103, 128, 8, "#3d8a5c") + balloon(128, 38, 19, "#3fb9a8", "#ffe9a8") + path("M18 124 a6 6 0 0 1 12 0 a5 5 0 0 1 10 0Z M84 126 a6 6 0 0 1 12 0 a5 5 0 0 1 10 0Z M196 125 a6 6 0 0 1 12 0 a5 5 0 0 1 10 0Z", "#2c6d48"));
    },
    "view-blossom": function () { // Blue mountains, cherry trees on the bank, a red bridge over the river, and petals drifting down.
      function puffs(list, r) { return list.map(function (c) { return "M" + (c[0] - r) + " " + c[1] + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z"; }).join(" "); }
      const trees = [[32, 70], [92, 76], [160, 68], [216, 74]];
      const crown = []; const light = [];
      trees.forEach(function (t) { crown.push([t[0] - 12, t[1] + 2], [t[0] + 12, t[1] + 2], [t[0], t[1] - 8], [t[0], t[1] + 6]); light.push([t[0] - 6, t[1] - 3], [t[0] + 7, t[1] - 1]); });
      const glints = scatter(115, 7, function (roll) { const x = round(roll(8, 210)), y = round(roll(118, 128)); return "M" + x + " " + y + " h" + round(roll(6, 16)); }).replace(/M/g, " M");
      return view(["#cde4f2", "#fdeaef"], ["#10182e", "#3a3a5e"], 26,
        path("M0 92 L40 62 L70 88 L120 50 L170 90 L208 68 L240 92 V140 H0 Z", "#a9bccf") + path("M107 60 L120 50 L133 60 L126 58 L120 63 L114 58 Z M30 70 L40 62 L50 70 L44 69 L40 72 L36 69 Z", "#fff"),
        hills(112, 110, 12, "#8fb59a") + path(trees.map(function (t) { return "M" + t[0] + " " + (t[1] + 8) + " V112"; }).join(" "), "none", 'stroke="#6a4a50" stroke-width="3"') + path(puffs(crown, 12), "#f3a8c4") + path(puffs(light, 7), "#fbd4e2"),
        rect(0, 114, 240, 30, "#6fa8d8") + path(glints, "none", 'stroke="#d6ecff" stroke-width="1.2" stroke-linecap="round"') +
          path("M90 124 Q130 92 170 124 L164 128 Q130 102 96 128 Z", "#d9483e") + path("M92 116 Q130 86 168 116", "none", 'stroke="#f0d9a0" stroke-width="2"') + path("M106 104 V116 M118 97 V110 M130 94 V106 M142 97 V110 M154 104 V116", "none", 'stroke="#a8342e" stroke-width="2"'),
        falling("snow", scatter(113, 14, function (roll) { const x = round(roll(0, 120)), y = round(roll(0, 130)); return oval(x, y, 2.2, 1.3, "#ffc2d8", 'opacity=".95" transform="rotate(' + Math.round(roll(0, 180)) + " " + x + " " + y + ')"'); })));
    },
    "view-reef": function () { // Under the sea: slanting light, rock, coral fans, swaying kelp, fish and a clam with a pearl.
      function fish(x, y, size, body, fin) { // Facing left, because the strips slide left, so they seem to swim.
        return oval(x, y, size * 1.4, size * .85, body) + path("M" + (x + size * 1.2) + " " + y + " l" + size + " -" + size * .8 + " v" + size * 1.6 + " Z", fin) + circle(x - size * .7, y - size * .15, size * .18 + .4, "#1a2a4a");
      }
      const coral = [[34, 112, 12], [150, 110, 14]].map(function (c) { return "M" + c[0] + " " + c[1] + " V" + (c[1] - c[2] * 2) + " M" + c[0] + " " + (c[1] - c[2]) + " L" + (c[0] - c[2]) + " " + (c[1] - c[2] * 1.9) + " M" + c[0] + " " + (c[1] - c[2]) + " L" + (c[0] + c[2]) + " " + (c[1] - c[2] * 1.9) + " M" + c[0] + " " + (c[1] - c[2] * 1.5) + " L" + (c[0] - c[2] * .55) + " " + (c[1] - c[2] * 2.3) + " M" + c[0] + " " + (c[1] - c[2] * 1.5) + " L" + (c[0] + c[2] * .55) + " " + (c[1] - c[2] * 2.3); }).join(" ");
      const kelp = [78, 94, 204, 222].map(function (x, i) { const top = 58 + (i * 11) % 22; return "M" + x + " 116 Q" + (x - 8) + " " + round((116 + top) * .62) + " " + x + " " + round((116 + top) * .5) + " T" + x + " " + top; }).join(" ");
      const bubbles = scatter(127, 12, function (roll) { const x = round(roll(8, 232)), y = round(roll(14, 104)), r = round(roll(1.2, 3)); return "M" + round(x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; });
      return view(["#2f9cc0", "#0d4f73"], ["#06162e", "#0a2a4a"], -30,
        hills(121, 98, 34, "#1f7a94") + path("M24 0 H58 L30 130 H0 Z M104 0 H128 L104 130 H78 Z M170 0 H206 L176 130 H146 Z", "#c9f0ff", 'opacity=".13"'),
        hills(122, 112, 12, "#d9c48a") + path(coral, "none", 'stroke="#ff7a8e" stroke-width="3.4" stroke-linecap="round"') + path(kelp, "none", 'stroke="#3fb88a" stroke-width="3.2" stroke-linecap="round"') + path("M112 112 V96 M120 112 V90 M128 112 V98", "none", 'stroke="#ffb84a" stroke-width="5" stroke-linecap="round"') + fish(58, 62, 6, "#ffdc83", "#f0a030") + fish(180, 48, 5, "#ff9ac0", "#e8689a"),
        waves(124, "#e6d29a", 3) + fish(112, 84, 9, "#ff8e4a", "#fff1cd") + fish(32, 72, 7, "#7ad6e8", "#3f8fc0") + path(bubbles, "none", 'stroke="#d6f2ff" stroke-width=".9" opacity=".8"') +
          path("M200 124 Q216 106 232 124 Z", "#c9a8ff") + path("M204 124 L214 112 M216 124 V110 M228 124 L218 112", "none", 'stroke="#8f6fc8" stroke-width="1"') + circle(216, 120, 3, "#fff8f0") + path(star(70, 126, 7), "#ff6f7f"));
    },
    "view-aurora": function () { // Green and pink ribbons of light over snowy peaks, dark pines and an igloo with a warm doorway.
      const streaks = scatter(133, 16, function (roll, i) { const x = 8 + i * 14.5, top = round(roll(8, 26)); return "M" + x + " " + top + " V" + round(top + roll(26, 46)) + " "; });
      return view(["#2a5f78", "#93cfc5"], ["#070d22", "#103048"], 18,
        path("M0 22 C40 -8 80 48 120 22 S200 -6 240 22 V62 C200 34 160 76 120 58 S40 40 0 62 Z", "#6fffc0", 'opacity=".42"') +
          path("M0 46 C50 22 90 70 130 46 S210 22 240 46 V76 C200 54 170 92 130 74 S50 62 0 76 Z", "#ff7ad0", 'opacity=".3"') +
          path(streaks, "none", 'stroke="#e0fff0" stroke-width="1.6" opacity=".28"') +
          path("M0 94 L34 62 L58 86 L104 52 L150 90 L190 66 L240 94 V140 H0 Z", "#7a9ab4") + path("M26 70 L34 62 L42 70 L37 69 L34 73 L30 69 Z M94 60 L104 52 L114 60 L108 59 L104 64 L100 59 Z M182 72 L190 66 L198 72 L193 71 L190 75 L186 71 Z", "#fff"),
        hills(132, 106, 10, "#c9dcea") + pines(131, 110, 30, "#1c3f4e", 26),
        hills(134, 124, 8, "#f0f6fc") + path("M60 124 a26 22 0 0 1 52 0 Z", "#dfeaf5") + path("M64 112 Q86 104 108 112 M60 120 H112 M76 104 L74 120 M96 104 L98 120", "none", 'stroke="#b9cbe0" stroke-width="1"') + oval(86, 122, 15, 10, "#ffb84a", 'opacity=".35"') + path("M78 124 a8 9 0 0 1 16 0 Z", "#ffcf7a") + rect(170, 100, 2.5, 26, "#6a4a30") + oval(171, 98, 7, 8, "#ffb84a", 'opacity=".55"') + circle(171, 97, 3, "#ffe9a8", 'class="lp-twinkle"'),
        falling("snow", scatter(136, 12, function (roll) { return circle(round(roll(0, 120)), round(roll(0, 130)), round(roll(.7, 1.4)), "#fff", 'opacity=".8"'); })));
    },
    "view-isles": function () { // Islands floating over a sea of cloud, with waterfalls pouring off their edges.
      function isle(x, y, w, grass) { // A rock underside and a flat grassy top; returns shapes in draw order.
        const h = round(w * .9);
        return path("M" + (x - w) + " " + y + " Q" + round(x - w * .6) + " " + round(y + h * .7) + " " + round(x - w * .15) + " " + round(y + h) + " Q" + (x + w * .1) + " " + round(y + h * 1.25) + " " + round(x + w * .3) + " " + round(y + h * .75) + " Q" + round(x + w * .8) + " " + round(y + h * .5) + " " + (x + w) + " " + y + " Z", "#8f6f8c") + oval(x, y, w + 2, round(w * .22 + 2), grass);
      }
      function fall(x, y, h) { return path("M" + (x - 1.5) + " " + y + " h3 v" + h + " h-3Z", "#d6f0ff", 'opacity=".9"') + oval(x, y + h, 6, 3, "#fff", 'opacity=".9"'); }
      const fluff = [14, 48, 88, 124, 168, 204, 226].map(function (x, i) { const r = 8 + (i * 5) % 7; return "M" + (x - r) + " 118 a" + r + " " + r + " 0 1 1 " + r * 2 + " 0Z"; }).join(" ");
      const birds = "M40 26 q5 -5 9 0 q5 -5 9 0 M170 16 q4 -4 8 0 q4 -4 8 0 M112 38 q3 -3 6 0 q3 -3 6 0";
      return view(["#8fc6f5", "#ffe7f1"], ["#0f1840", "#3a3a70"], 30,
        isle(30, 86, 14, "#a4d3a0") + isle(110, 74, 10, "#a4d3a0") + isle(196, 88, 16, "#a4d3a0") + oval(150, 50, 18, 6, "#fff", 'opacity=".75"') + oval(64, 42, 14, 5, "#fff", 'opacity=".7"'),
        isle(66, 62, 28, "#6fc27f") + fall(52, 66, 44) + path("M74 62 V46", "none", 'stroke="#6a4a30" stroke-width="3"') + circle(74, 40, 10, "#3f9a5a") + rect(50, 50, 12, 10, "#fff1e0") + path("M47 51 L56 42 L65 51 Z", "#e8556a") +
          isle(180, 46, 24, "#7fd08a") + fall(196, 50, 58) + oval(170, 36, 7, 9, "#f3a8c4") + path("M170 45 V38", "none", 'stroke="#6a4a30" stroke-width="2"'),
        waves(112, "#fff", 6) + path(fluff, "#f4f8ff") + path(birds, "none", 'stroke="#54608a" stroke-width="1.4" stroke-linecap="round"'));
    },
    "view-nebula": function () { // Open space: drifting nebula clouds, a ringed planet, a glass observatory dome and a comet going by.
      function stars(seed, count, top, bottom, delay) { // A patch of twinkling sparkles as one path, so they twinkle together.
        const d = scatter(seed, count, function (roll) { return star(round(roll(6, 234)), round(roll(top, bottom)), round(roll(1.5, 3.4))) + " "; });
        return path(d, "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + delay + 's"');
      }
      return view(["#27114f", "#43205f"], ["#0a0620", "#1f0f40"], 22,
        oval(46, 54, 60, 28, "#ff6fb0", 'opacity=".26"') + oval(70, 40, 40, 18, "#ffb3d9", 'opacity=".22"') + oval(176, 70, 62, 32, "#5a8cff", 'opacity=".28"') + oval(160, 54, 34, 16, "#70ebea", 'opacity=".2"') + oval(120, 96, 66, 22, "#a06fff", 'opacity=".22"') + oval(150, 30, 16, 5, "#d9c8ff", 'opacity=".35" transform="rotate(-20 150 30)"') + path("M150 30 a3 2 -20 1 1 5 -2 a6 4 -20 1 1 -12 4 a10 6 -20 1 1 20 -6", "none", 'stroke="#efe6ff" stroke-width="1" opacity=".75"') + stars(141, 7, 8, 104, 0) + stars(142, 7, 8, 104, .7) + stars(143, 6, 8, 104, 1.4),
        group(oval(74, 62, 34, 9, "none", 'stroke="#ffe3a9" stroke-width="2.5" opacity=".7" transform="rotate(-16 74 62)"') + circle(74, 62, 18, "#e88a6a") + path("M58 56 Q74 48 90 56 M56 66 Q74 74 92 66", "none", 'stroke="#c86a58" stroke-width="3" opacity=".6"') + path("M45.3 69.5 A34 9 -16 0 0 102.7 54.5", "none", 'stroke="#fff1cd" stroke-width="2.5" transform="rotate(-1 74 62)"')) +
          circle(128, 32, 6, "#c9d6ff") + circle(126, 30, 1.6, "#9aa8e0") +
          path("M212 13 L166 48 L218 23 Z", "#9fd8ff", 'opacity=".35"') + path("M213 15 L186 37 L217 21 Z", "#fff", 'opacity=".7"') + circle(215, 18, 4, "#fff", 'class="lp-neon"'),
        path("M0 122 Q30 108 60 122 T120 122 T180 122 T240 122 V140 H0 Z", "#2c1f4a") + path("M0 128 Q40 120 80 128 T160 128 T240 128 V140 H0 Z", "#1c1436") +
          oval(36, 124, 8, 3, "#1c1436") + oval(150, 125, 10, 3.5, "#1c1436") +
          path("M90 118 a22 22 0 0 1 44 0 Z", "#bfe8ff", 'opacity=".4" stroke="#e0f6ff" stroke-width="1.5"') + path("M98 118 V112 l3 -5 l3 4 l5 -4 l3 5 V118 Z", "#fce1f2") + circle(102, 110, 1, "#462846") + circle(108, 110, 1, "#462846") + rect(84, 118, 56, 4, "#a8b4c4", 'rx="2"') +
          path("M198 120 L204 100 L210 112 L216 96 L222 120 Z", "#70ebea", 'opacity=".9" class="lp-neon"') + path("M12 122 L16 110 L21 122 Z M28 122 L30 114 L34 122 Z", "#c9a8ff"),
        falling("snow", scatter(144, 9, function (roll) { return path(star(round(roll(4, 116)), round(roll(0, 130)), round(roll(1.2, 2.4))), "#ffe9a8", 'opacity=".85"'); })));
    },

    // Star Capsule wall art
    // On the left wall between the door and the window, roughly x 26..112 and y 146..234, below the trophy bracket.

    "art-goldfish": function () { // A little framed goldfish print on a cream mat.
      return rect(38, 150, 60, 76, "#caa272", 'rx="3"') + rect(43, 155, 50, 66, "#fdf6e3") + rect(47, 159, 42, 58, "#a9dcf0") +
        path("M54 217 q-4 -8 2 -14 q-3 -5 2 -10 M84 217 q4 -10 -2 -16", "none", 'stroke="#5fae86" stroke-width="2.4" stroke-linecap="round"') +               // Waterweed.
        path("M74 187 L87 179 Q83 187 87 196 Z", "#ffb86a") + oval(62, 187, 14, 10, "#ff9d4a") + path("M60 178 Q65 170 70 178 Z", "#ffb86a") + path("M62 196 Q65 203 70 195 Z", "#ffb86a") + // Tail, body and fins, all inside the water.
        circle(54, 185, 2.2, "#2a1a3a") + path("M64 180 q4 7 0 14 M70 181 q4 6 0 12", "none", 'stroke="#ffe0b0" stroke-width="1.4" opacity=".8"') +                  // Eye and scale lines.
        circle(50, 170, 2.6, "none", 'stroke="#fff" stroke-width="1"') + circle(56, 163, 1.8, "none", 'stroke="#fff" stroke-width="1"');
    },

    "art-pennant": function () { // A felt pennant on a little rod, pointing down, with a stitched edge and a hanging tassel.
      return path("M69 146 L38 156 M69 146 L100 156", "none", 'stroke="#8a7aa8" stroke-width="1"') + circle(69, 146, 2, "#d9b24a") +
        rect(34, 154, 70, 4, "#a8743f", 'rx="2"') + path("M38 158 H100 L69 222 Z", "#e8556a") +
        path("M43 161 H95 L69 215 Z", "none", 'stroke="#fff1cd" stroke-width="1.4" stroke-dasharray="3 3"') + path(star(69, 178, 15), "#fff1cd") +
        path("M69 222 V232 M66 222 L63 231 M72 222 L75 231", "none", 'stroke="#ffdc83" stroke-width="1.6" stroke-linecap="round"');                               // The tassel.
    },

    "art-toadstool-note": function () { // A doodled note held up with washi tape, a little crooked, as if it was stuck there by a small paw.
      return group(rect(42, 152, 56, 70, "#fff6df", 'rx="1"') +
        path("M46 200 H94 M46 208 H88 M46 216 H92", "none", 'stroke="#c4b8d8" stroke-width="1"') +                                                                  // Ruled lines.
        group(path("M60 192 Q62 180 62 170 H76 Q76 180 78 192 Z", "#fff1e0", 'stroke="#6a4a6a" stroke-width="1.6"') +
          path("M52 170 Q69 142 86 170 Q69 176 52 170Z", "#e8556a", 'stroke="#6a4a6a" stroke-width="1.6"') + circle(62, 160, 3, "#fff") + circle(75, 158, 3.6, "#fff") + circle(70, 166, 2, "#fff"), 'transform="translate(0 6)"') + // A hand-drawn toadstool, below the tape.
        path("M86 188 c-3 -4 -8 0 0 6 c8 -6 3 -10 0 -6Z", "#ff8ecb") +
        rect(58, 148, 24, 8, "#70ebea", 'opacity=".75" transform="rotate(5 70 152)"'),                                                                                 // The tape.
        'transform="rotate(-4 70 186)"');
    },

    "art-postcard": function () { // A sunset postcard with a striped sun and scalloped stamp edges.
      return rect(26, 160, 88, 58, "#fff1e0", 'rx="2" stroke="#d8c8b0" stroke-width="1" stroke-dasharray="3 2"') + rect(31, 165, 78, 28, "#f98a6a") + rect(31, 165, 78, 12, "#c85a8e") + circle(66, 192, 13, "#ffdc83") +
        rect(46, 186, 40, 2.2, "#f98a6a") + rect(46, 190, 40, 2.2, "#f98a6a") + rect(31, 193, 78, 20, "#2f5e8c") +
        path("M36 200 h20 M62 205 h26 M42 209 h14 M76 199 h22", "none", 'stroke="#ffcfa0" stroke-width="1.6" stroke-linecap="round"') +                             // The sun's path on the sea.
        path("M86 197 h14 l-3 5 h-8 Z M93 197 V186 l7 7 Z", "#1a2348") + rect(99, 167, 9, 11, "#ffffff", 'stroke="#c85a8e" stroke-width="1"') + path(star(103.5, 172.5, 3.4), "#c85a8e");  // A little sailing boat and a stamp.
    },

    "art-triptych": function () { // Three hanging panels sharing one moonlit mountain view: the ridge heights match across the gaps.
      const panel = function (x, ridge, snow) {
        return rect(x, 156, 26, 66, "#1c2452") + path(ridge, "#34447f") + path(snow, "#e6f0ff") + rect(x, 156, 26, 66, "none", 'stroke="#d9b24a" stroke-width="2"');
      };
      return path("M39 150 V156 M69 150 V156 M99 150 V156", "none", 'stroke="#8a7aa8" stroke-width="1"') +
        circle(30, 168, .9, "#fff") + circle(46, 162, 1, "#fff") + circle(92, 164, 1, "#fff") + circle(107, 174, .9, "#fff") + circle(38, 180, .8, "#fff") +
        panel(26, "M26 222 V198 L34 186 L44 200 L52 192 V222 Z", "M34 186 L30 192 L34 191 L38 195 L40 194 Z") +
        panel(56, "M56 222 V192 L64 200 L72 174 L82 196 V222 Z", "M72 174 L68 186 L72 184 L76 187 Z") +
        panel(86, "M86 222 V196 L94 182 L104 202 L112 192 V222 Z", "M94 182 L90 189 L94 188 L98 191 Z") +
        circle(72, 163, 6, "#fff8dc") + circle(75, 161, 5, "#1c2452") + path(star(100, 168, 4), "#ffe9a8", 'class="lp-twinkle"');                                   // The moon, and one bright star.
    },

    "art-sunmoon-clock": function () { // A clock with a sunny morning half and a starry night half.
      let ticks = "";
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; ticks += "M" + round(69 + Math.cos(a) * 28) + " " + round(189 + Math.sin(a) * 28) + " L" + round(69 + Math.cos(a) * 32) + " " + round(189 + Math.sin(a) * 32) + " "; }
      return circle(69, 189, 39, "#c9a15a") + circle(69, 189, 35, "#8a6a2a") + path("M69 155 A34 34 0 0 0 69 223 Z", "#ffcf6e") + path("M69 155 A34 34 0 0 1 69 223 Z", "#27346a") +
        circle(55, 189, 7, "#ffb84a") + path("M55 176 V180 M55 198 V202 M42 189 H46 M64 189 H68 M46 180 L49 183 M64 198 L61 195 M46 198 L49 195 M64 180 L61 183", "none", 'stroke="#ffb84a" stroke-width="2" stroke-linecap="round"') + // The sun and its rays.
        circle(84, 182, 8, "#f4e8c8") + circle(87, 180, 7, "#27346a") + path(star(92, 200, 3.4), "#fff8dc", 'class="lp-twinkle"') + path(star(80, 206, 2.6), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.7s"') + // The moon and stars.
        path(ticks, "none", 'stroke="#fff1e0" stroke-width="1.8"') + line(69, 189, 69, 169, "#3a2147", 2.6, 'stroke-linecap="round"') + line(69, 189, 82, 197, "#3a2147", 2.2, 'stroke-linecap="round"') + circle(69, 189, 3, "#3a2147") + path(star(69, 148, 5), "#ffdc83");
    },

    "art-hoop": function () { // Embroidery in a wooden hoop: dashed stitches for the petals, stem and leaves, French knots in the middle.
      const petal = function (a) { return group(path("M0 -6 C-8 -16 -8 -26 0 -30 C8 -26 8 -16 0 -6Z", "#ff8ecb", 'stroke="#c85a8e" stroke-width="1"'), 'transform="translate(69 184) rotate(' + a + ')"'); };
      return path("M69 146 L60 153 M69 146 L78 153", "none", 'stroke="#c9a15a" stroke-width="1.2"') + circle(69, 146, 2, "#d9b24a") +
        circle(69, 191, 37, "#a8743f") + circle(69, 191, 32, "#fff6df") + rect(61, 152, 16, 5, "#8a5a2a", 'rx="1.5"') +
        path("M69 192 Q68 208 66 220", "none", 'stroke="#5fae86" stroke-width="2.4" stroke-dasharray="3 1.5"') +                                                       // The stem.
        path("M67 207 C57 203 53 209 53 213 C61 215 66 213 67 207 Z", "#7fc49a", 'stroke="#3f8a66" stroke-width="1"') + path("M67 210 C77 205 81 211 81 215 C74 217 68 216 67 210 Z", "#7fc49a", 'stroke="#3f8a66" stroke-width="1"') + // Two leaves.
        [0, 72, 144, 216, 288].map(petal).join("") + circle(69, 184, 6.5, "#ffdc83") + circle(66, 182, 1.4, "#c9901f") + circle(72, 182, 1.4, "#c9901f") + circle(69, 187, 1.4, "#c9901f") +
        circle(50, 207, 1.6, "#ffb84a") + circle(89, 209, 1.6, "#ffb84a");                                                                                              // French-knot flecks.
    },

    "art-stained-cat": function () { // An arched stained-glass window of a winged fairy cat. Every pane has dark leading around it.
      const lead = 'stroke="#1a1430" stroke-width="1.8" stroke-linejoin="round"';
      const cx = 69, cy = 184, rim = 36;
      let wedges = "", panes = "";
      for (let i = 0; i < 6; i++) { // A sunburst of glass fanned around the top of the arch.
        const a1 = Math.PI + i * Math.PI / 6, a2 = a1 + Math.PI / 6;
        wedges += path("M" + cx + " " + cy + " L" + round(cx + Math.cos(a1) * rim) + " " + round(cy + Math.sin(a1) * rim) + " A" + rim + " " + rim + " 0 0 1 " + round(cx + Math.cos(a2) * rim) + " " + round(cy + Math.sin(a2) * rim) + " Z", i % 2 ? "#e8b84a" : "#d96aa3", lead);
      }
      [[33, 184, 22, 20, "#3f7ad0"], [33, 204, 22, 26, "#2f5aa8"], [83, 184, 22, 20, "#3f7ad0"], [83, 204, 22, 26, "#2f5aa8"], [55, 204, 28, 26, "#6d4bb0"]].forEach(function (p) { panes += rect(p[0], p[1], p[2], p[3], p[4], lead); });
      return path("M31 232 V184 A38 38 0 0 1 107 184 V232 Z", "#8a6a2a") + wedges + panes +
        path("M56 188 Q36 178 37 197 Q41 208 56 202 Z", "#a6f0e6", lead) + path("M82 188 Q102 178 101 197 Q97 208 82 202 Z", "#a6f0e6", lead) +                          // The wings.
        path("M53 206 Q69 226 85 206 Q85 216 69 222 Q53 216 53 206Z", "#fce1f2", lead) +                                                                                     // The cat's chest.
        path("M51 176 L55 162 L63 171 Q69 168 75 171 L83 162 L87 176 Q88 202 69 204 Q50 202 51 176 Z", "#fce1f2", lead) +                                                     // Head and ears.
        path("M55 166 L59 172 L54 174 Z M83 166 L79 172 L84 174 Z", "#ff9fc8") + circle(61, 188, 2.6, "#462846") + circle(77, 188, 2.6, "#462846") +
        path("M64 194 Q69 198 74 194", "none", 'stroke="#462846" stroke-width="1.5" stroke-linecap="round"') + path(star(69, 178, 6), "#ffe9a8", 'class="lp-twinkle"');
    },

    "art-butterflies": function () { // A shadow box of six pinned butterflies, every pair of wings a different pattern.
      const wings = function (top, low, kind) { // One side; the group mirrors it for the other.
        return path("M0 -2 C-4 -14 -16 -16 -16 -6 C-16 0 -6 1 0 1Z", top) + path("M0 1 C-6 2 -14 3 -12 9 C-9 14 -3 10 0 4Z", low) +
          (kind ? circle(-9, -7, 2, "#fff8dc") + circle(-7, 7, 1.4, "#fff8dc") : path("M-3 -10 L-13 -7 M-2 5 L-11 8", "none", 'stroke="#fff8dc" stroke-width="1"'));
      };
      const butterfly = function (b, i) {
        const x = 44 + (i % 3) * 25, y = 171 + Math.floor(i / 3) * 33;
        return group(wings(b[0], b[1], b[2]) + group(wings(b[0], b[1], b[2]), 'transform="scale(-1 1)"') + rect(-1.2, -7, 2.4, 16, "#3d2450", 'rx="1"') + circle(0, -8, 1.6, "#d9b24a"), 'transform="translate(' + x + " " + y + ') scale(.72)"') +
          rect(x - 6, y + 13, 12, 2.4, "#fff6df", 'opacity=".8"');                                                                                                     // Its tiny paper label.
      };
      return rect(25, 150, 90, 78, "#c9a15a", 'rx="3"') + rect(29, 154, 82, 70, "#3a1f3a") + rect(32, 157, 76, 64, "#1c2a44") +
        [["#ff8ecb", "#c85a8e", 1], ["#70ebea", "#2f8a9a", 0], ["#ffdc83", "#e98a2a", 1], ["#c9a8ff", "#7a4bb0", 0], ["#ff9d6b", "#d9502a", 1], ["#7fe0a8", "#2f9a66", 0]].map(butterfly).join("");
    },

    "art-moon-mirror": function () { // A gilded magic mirror: in its glass a night sky with a crescent moon, and the outline of a cat that follows Lumi's glow.
      let beads = "", stars = "";
      for (let i = 0; i < 20; i++) { const a = i / 20 * 6.283; beads += circle(round(69 + Math.cos(a) * 36), round(192 + Math.sin(a) * 42), 2.5, i % 2 ? "#ffdc83" : "#d9b24a", i % 5 ? "" : 'class="lp-twinkle" style="animation-delay:' + (i * .1) + 's"'); } // Beads around the frame.
      [[56, 170, 2.6], [84, 168, 2], [52, 196, 2], [90, 196, 2.8], [62, 216, 2], [78, 212, 2.2], [69, 182, 1.6]].forEach(function (s, i) { stars += path(star(s[0], s[1], s[2] * 1.7), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .31 % 2).toFixed(2) + 's"'); });
      return path("M58 150 Q69 136 80 150 L76 156 H62 Z", "#d9b24a") + path(star(69, 146, 5), "#fff8dc", 'class="lp-twinkle"') +                                                              // Its crest.
        oval(69, 192, 40, 46, "#a8782f") + oval(69, 192, 36, 42, "#e8c877") + oval(69, 192, 32, 38, "#6e4e1f") + oval(69, 192, 30, 36, "#0b1038") +
        oval(58, 180, 26, 18, "#3a2a7a", 'opacity=".55"') + oval(84, 208, 22, 16, "#1f4a7a", 'opacity=".6"') + oval(69, 192, 30, 36, "none", 'stroke="' + GLOW + '" stroke-width="1.6" class="lp-neon"') + // The misty glass and its glowing edge.
        circle(80, 176, 11, "#f4e8c8") + circle(84, 174, 10, "#0b1038") + stars +
        path("M57 214 Q57 225 69 225 Q81 225 81 214 V207 L77 199 L71 204 Q69 203 67 204 L61 199 L57 207 Z", GLOW, 'opacity=".9"') + circle(64, 212, 1.8, "#0b1038") + circle(74, 212, 1.8, "#0b1038") +                 // The cat looking out of the mirror.
        path("M50 170 Q54 158 66 156", "none", 'stroke="#ffffff" stroke-width="1.6" opacity=".35" stroke-linecap="round"') + beads;
    },

    // Star Capsule wallpaper
    // Each tile repeats side by side, so everything either stays inside 0..400 or is cut exactly at the tile's edges.

    "wall-bubble-dots": function () { // Staggered gumdrop dots: the rows sit a half-step apart and never touch the tile's edge.
      const colours = ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff"];
      let out = rect(0, 0, 400, 352, "#412150");
      for (let row = 0; row < 7; row++) for (let col = 0; col < 8; col++) {
        const x = (row % 2 ? 37.5 : 12.5) + col * 50, y = 26 + row * 50;
        out += circle(x, y, 11, colours[(row + col) % 4], 'opacity=".78"') + circle(x - 3.5, y - 3.5, 2.6, "#fff", 'opacity=".7"'); // A dot and its shine.
      }
      return out;
    },

    "wall-sprouts": function () { // Rows of two-leaf seedlings poking out of little mounds of soil.
      let out = rect(0, 0, 400, 352, "#173b3f");
      for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
        const x = (row % 2 ? 60 : 20) + col * 80, y = 40 + row * 68, leaf = (row + col) % 2 ? "#8fe0a8" : "#5fc08e";
        out += group(
          oval(0, 15, 9, 2.6, "#0e282b") +                                                                       // The soil.
          path("M0 15 Q-1 7 0 -2", "none", 'stroke="#c9f0c0" stroke-width="2" stroke-linecap="round"') +         // The stem.
          path("M0 -2 Q-12 -15 -17 -5 Q-10 4 0 -2Z", leaf) + path("M0 -2 Q10 -18 17 -9 Q12 2 0 -2Z", leaf),      // The two leaves.
          'transform="translate(' + x + " " + y + ')"');
      }
      return out;
    },

    "wall-gingham": function () { // Picnic-cloth check: see-through bands that cross, with a berry pair in every fourth square.
      let out = rect(0, 0, 400, 352, "#7a2f58");
      for (let x = 0; x < 400; x += 50) out += rect(x, 0, 25, 352, "#f3a6c9", 'opacity=".28"');
      for (let y = 0; y < 340; y += 50) out += rect(0, y, 400, 25, "#f3a6c9", 'opacity=".28"');
      for (let y = 87.5; y < 340; y += 100) for (let x = 87.5; x < 400; x += 100) {
        out += circle(x - 3, y + 2, 4, "#e8325a") + circle(x + 4, y + 3, 4, "#ff4f73") + path("M" + x + " " + (y - 2) + " q2 -6 8 -6 q-1 6 -8 6Z", "#7fc49a");
      }
      return out;
    },

    "wall-scallops": function () { // Overlapping shells. Every row is cut exactly at the tile's edges, so no row spills over a neighbour.
      const shades = ["#27516a", "#2e6075", "#356e7f", "#2e6075"];
      let out = rect(0, 0, 400, 352, shades[3]);
      for (let row = 0; row < 13; row++) {
        const y = 26 + row * 26, offset = row % 2;
        let edge = offset ? "M0 " + (y - 25) + " A25 25 0 0 1 25 " + y : "M0 " + y, ribs = "";               // Offset rows begin on a half-shell.
        for (let i = 0; i < (offset ? 7 : 8); i++) edge += " a25 25 0 0 1 50 0";                              // One shell's rim.
        if (offset) edge += " A25 25 0 0 1 400 " + (y - 25);                                                  // And end on the other half.
        for (let mid = offset ? 0 : 25; mid <= 400; mid += 50) {                                              // The ribs fanning up from each hinge.
          ribs += "M" + mid + " " + y + " V" + (y - 21) + " ";
          if (mid > 0) ribs += "M" + mid + " " + y + " L" + (mid - 14) + " " + (y - 17) + " ";
          if (mid < 400) ribs += "M" + mid + " " + y + " L" + (mid + 14) + " " + (y - 17) + " ";
        }
        out += path(edge + " V352 H0 Z", shades[row % 4]) + path(ribs, "none", 'stroke="#4f97a0" stroke-width="1"') + path(edge, "none", 'stroke="#7fd6c8" stroke-width="1.6"');
      }
      return out;
    },

    "wall-paper-planes": function () { // A dusk sky of folded planes, each trailing a dashed loop-the-loop. All kept well inside the tile.
      const plane = function (x, y, a, s, paper) {
        return group(
          path("M-22 2 Q-60 16 -80 0 Q-96 -18 -78 -22 Q-60 -22 -66 -4 Q-74 18 -118 12", "none", 'stroke="#cfd8f7" stroke-width="1.6" stroke-dasharray="4 6" stroke-linecap="round" opacity=".55"') + // The flight path behind it.
          path("M28 0 L-20 -15 L-7 0 Z", paper) + path("M28 0 L-7 0 L-16 14 Z", "#b6c1e6") + path("M28 0 L-7 0", "none", 'stroke="#8390bf" stroke-width="1"'), // Top wing, under wing, centre fold.
          'transform="translate(' + x + " " + y + ") rotate(" + a + ") scale(" + s + ')"');
      };
      const cloud = function (x, y, s) { return group(oval(0, 0, 26, 9, "#34407a") + oval(-11, -6, 12, 9, "#34407a") + oval(9, -7, 14, 10, "#34407a"), 'transform="translate(' + x + " " + y + ") scale(" + s + ')"'); };
      return rect(0, 0, 400, 352, "#25315e") +
        scatter(21, 26, function (roll) { return circle(round(roll(6, 394)), round(roll(6, 340)), round(roll(.6, 1.5)), "#e6d5ff", 'opacity="' + round(roll(.3, .8)) + '"'); }) +
        cloud(70, 120, 1.1) + cloud(330, 110, .9) + cloud(52, 268, .9) + cloud(250, 336, 1.1) + cloud(180, 26, .8) +
        plane(150, 62, -10, 1, "#fff") + plane(330, 48, 12, .85, "#ffe8f3") + plane(250, 158, -18, 1, "#fff5d9") + plane(128, 200, 8, .8, "#e6f6ff") +
        plane(366, 226, -14, 1.05, "#fff") + plane(206, 290, 10, .9, "#ffe8f3") + plane(340, 318, -8, .75, "#e6f6ff");
    },

    "wall-wisteria": function () { // Wisteria falling from a vine: each spray is a stack of wide blossoms narrowing to a tip.
      const purples = ["#d9bcff", "#b58cff", "#ef9cff", "#9468e0"];
      const sprays = [[33, 158], [100, 244], [167, 136], [233, 222], [300, 150], [367, 256]];
      let out = rect(0, 0, 400, 352, "#241c44") +
        path("M0 12 Q100 30 200 12 T400 12", "none", 'stroke="#5a7a4f" stroke-width="7"') + path("M0 12 Q100 30 200 12 T400 12", "none", 'stroke="#7ea366" stroke-width="2"');
      sprays.forEach(function (spray, s) {
        const x = spray[0], length = spray[1], steps = Math.floor(length / 12);
        out += oval(x - 10, 24, 9, 3.6, "#7ea366", 'transform="rotate(25 ' + (x - 10) + ' 24)"') + oval(x + 10, 24, 9, 3.6, "#7ea366", 'transform="rotate(-25 ' + (x + 10) + ' 24)"'); // Two leaves.
        for (let i = 0; i < steps; i++) {
          const t = i / steps, y = 30 + i * 12, rx = round(14 - t * 11);                                      // Each clump is narrower than the last, and overlaps it.
          out += oval(x + (i % 2 ? 4 : -4), y, rx, round(9 - t * 5), purples[(i + s) % 4], 'opacity="' + round(.96 - t * .3) + '"');
          if (i % 6 === 1) out += circle(round(x + (i % 2 ? -rx * .5 : rx * .5)), y - 2, 2, "#fff2ff", 'opacity=".8"');  // A pale highlight blossom now and then.
        }
      });
      return out;
    },

    "wall-toadstool": function () { // A dusk meadow: rolling hills whose ends match, tall shadow toadstools behind, glowing little ones in front.
      const toadstool = function (t, i) {
        const cap = t[3];
        return group(
          oval(0, -16, 22, 20, cap, 'opacity=".09"') +                                 // A faint glow.
          path("M-5 0 Q-3 -9 -3 -16 H3 Q3 -9 5 0 Z", "#fff1e0") +                       // The stem.
          path("M-16 -14 Q0 -38 16 -14 Q0 -8 -16 -14Z", cap, i % 2 ? "" : 'class="lp-twinkle" style="animation-delay:' + i * .3 + 's"') + // The cap.
          circle(-6, -20, 2.4, "#fff") + circle(5, -24, 3, "#fff") + circle(8, -15, 1.8, "#fff"),
          'transform="translate(' + t[0] + " " + t[1] + ") scale(" + t[2] + ')"');
      };
      const giant = function (x, top, s) { // A towering toadstool in shadow, on the far hill.
        return group(path("M-14 280 Q-10 200 -9 150 H9 Q10 200 14 280 Z", "#1a3050") + path("M-60 158 Q0 60 60 158 Q0 178 -60 158Z", "#273f6a") +
          circle(-22, 128, 8, "#3a5688") + circle(14, 112, 10, "#3a5688") + circle(32, 142, 6, "#3a5688"),
          'transform="translate(' + x + " " + top + ") scale(" + s + ')"');
      };
      return rect(0, 0, 400, 352, "#1c2048") + rect(0, 200, 400, 152, "#2a2a5e", 'opacity=".6"') +
        scatter(13, 30, function (roll) { return circle(round(roll(6, 394)), round(roll(6, 200)), round(roll(.5, 1.3)), "#e6d5ff", 'opacity="' + round(roll(.3, .9)) + '"'); }) +
        giant(76, -6, 1) + giant(320, 40, .75) + giant(214, 92, .55) +
        path("M0 262 Q100 214 200 262 T400 262 V352 H0 Z", "#23405a") +
        path("M0 294 Q50 268 100 294 T200 294 T300 294 T400 294 V352 H0 Z", "#2f5a4f") +
        path("M0 324 Q66 306 133 324 T266 324 T400 324 V352 H0 Z", "#2c6a4f") +
        [[44, 318, 1.5, "#e8556a"], [106, 298, 0.95, "#ffb84a"], [164, 332, 1.8, "#ff8ecb"], [232, 302, 1.1, "#70ebea"], [288, 334, 1.6, "#e8556a"], [346, 300, 1.2, "#c9a8ff"], [376, 336, 0.8, "#ffb84a"]].map(toadstool).join("") +
        scatter(14, 16, function (roll, i) { return circle(round(roll(16, 384)), round(roll(170, 300)), 2, "#fff4a8", 'class="lp-twinkle" style="animation-delay:' + (i * .31 % 2).toFixed(2) + 's"'); });
    },

    "wall-bookcase": function () { // Floor-to-ceiling bookshelves in muted colours, with a little curio tucked in here and there.
      const spines = ["#7a3f5c", "#3f6a7a", "#9a7a3f", "#5a4a85", "#4a7a5a", "#8a4a3f", "#6a5a78", "#a25a72"], roll = dice(77);
      let out = rect(0, 0, 400, 352, "#201410") + rect(0, 0, 5, 352, "#6b4426") + rect(395, 0, 5, 352, "#6b4426");  // Backing, and the upright that sits on the tile's join.
      for (let shelf = 0; shelf < 4; shelf++) {
        const base = 80 + shelf * 88;
        let x = 10;
        while (x < 372) {
          if (roll(0, 1) > .9 && x < 340) { // Instead of a book, a curio: a jar, a globe or a star on a block.
            const kind = Math.floor(roll(0, 3)), mid = x + 15;
            if (kind === 0) out += rect(mid - 9, base - 22, 18, 22, "#bfe8ff", 'rx="4" opacity=".45"') + rect(mid - 7, base - 26, 14, 5, "#a8743f", 'rx="1"') + circle(mid, base - 11, 4, "#ffdc83", 'class="lp-twinkle"');
            else if (kind === 1) out += circle(mid, base - 18, 13, "#4a7aa8") + path("M" + (mid - 7) + " " + (base - 26) + " q6 -3 10 2 q-2 5 -9 3 Z", "#7fc49a") + rect(mid - 7, base - 5, 14, 5, "#6b4426", 'rx="1"');
            else out += rect(mid - 10, base - 8, 20, 8, "#6b4426", 'rx="1"') + path(star(mid, base - 24, 13), "#ffdc83");
            x += 34;
            continue;
          }
          const w = Math.round(roll(13, 24)), h = Math.round(roll(46, 68)), colour = spines[Math.floor(roll(0, spines.length))];
          if (x + w > 391) break;
          out += rect(x, base - h, w, h, colour, 'rx="1.5"');                                                                 // The spine.
          if (roll(0, 1) > .62) out += rect(x + 2, base - h + 9, w - 4, 3, "#e8c877", 'opacity=".75"');                       // A gold title band on some of them.
          x += w + 1;
        }
        out += rect(0, base, 400, 8, "#6b4426");                                                                              // The shelf board, running edge to edge.
      }
      return out;
    },

    "wall-reef": function () { // Looking through the side of a coral reef: light shafts, swaying weed, fish and rising bubbles.
      const fish = function (f) {
        return group(oval(0, 0, 13, 7, f[4]) + path("M11 0 L22 -7 L20 0 L22 7 Z", f[4]) + path("M-3 -7 Q0 0 -3 7 M3 -7 Q6 0 3 7", "none", 'stroke="#ffffff" stroke-width="2" opacity=".55"') + circle(-8, -2, 1.7, "#1a2a3a"),
          'transform="translate(' + f[0] + " " + f[1] + ") scale(" + (f[3] ? -f[2] : f[2]) + " " + f[2] + ')"'); // f[3] flips it to swim right.
      };
      const coral = function (x, s, colour) { // A branching coral: one stroked path of forks.
        return path("M0 0 V-40 M0 -14 L-15 -34 M0 -24 L13 -46 M-15 -34 L-22 -50 M-15 -34 L-6 -52 M13 -46 L6 -60 M13 -46 L22 -58", "none", 'stroke="' + colour + '" stroke-width="5" stroke-linecap="round" transform="translate(' + x + " 328) scale(" + s + ')"');
      };
      const weed = function (x, h, colour) { return path("M" + x + " 330 q-14 -" + h / 4 + " 0 -" + h / 2 + " q14 -" + h / 4 + " 0 -" + h / 2, "none", 'stroke="' + colour + '" stroke-width="5" stroke-linecap="round"'); };
      return rect(0, 0, 400, 352, "#0f3a5c") + path("M0 26 Q100 10 200 26 T400 26 V0 H0 Z", "#3fa0b8", 'opacity=".55"') + path("M0 92 Q100 72 200 92 T400 92 V0 H0 Z", "#1c6a8a", 'opacity=".45"') +
        [[40, 58], [130, 42], [232, 62], [318, 46]].map(function (s) { return path("M" + s[0] + " 0 H" + (s[0] + s[1]) + " L" + (s[0] + s[1] + 18) + " 318 H" + (s[0] - 18) + " Z", "#d2fcf6", 'opacity=".07"'); }).join("") + // The light shafts.
        path("M0 322 Q100 306 200 322 T400 322 V352 H0 Z", "#b9a37a") + path("M0 336 Q66 326 133 336 T266 336 T400 336 V352 H0 Z", "#9a8660") +
        weed(30, 120, "#3f9a6e") + weed(46, 88, "#5fbf86") + weed(214, 110, "#3f9a6e") + weed(372, 136, "#5fbf86") + weed(356, 96, "#3f9a6e") +
        coral(86, 1.2, "#ff8e8e") + coral(150, .9, "#ffb84a") + coral(276, 1.3, "#ff8ecb") + coral(326, .8, "#c98cff") +
        path("M186 326 a26 22 0 0 1 52 0 Z", "#e8556a") + path("M192 322 q6 -14 16 -14 M208 304 q12 0 20 18 M200 320 q8 -8 16 -6", "none", 'stroke="#ff9db0" stroke-width="2.4" stroke-linecap="round"') + // A dome of brain coral.
        path(star(120, 330, 10), "#ffb84a") + path(star(250, 340, 8), "#ff8e8e") +
        [[70, 118, 1.2, 1, "#ffb84a"], [168, 76, .9, 0, "#70ebea"], [296, 130, 1.1, 0, "#ff8ecb"], [352, 58, .8, 1, "#ffe9a8"], [210, 196, 1.3, 1, "#c98cff"], [84, 236, .8, 0, "#70ebea"], [332, 232, 1, 1, "#ffb84a"]].map(fish).join("") +
        scatter(24, 18, function (roll, i) { return circle(round(roll(10, 390)), round(roll(10, 300)), round(roll(1.5, 4.5)), "none", 'stroke="#cfe8ff" stroke-width="1" opacity=".7"' + (i % 4 ? "" : ' class="lp-twinkle"')); });
    },

    "wall-aurora": function () { // Curtains of northern light over snowy peaks. Each curtain is one path of many thin upright rays.
      const wave = function (x, base, amp, lobes, flip) { // A curve that is level at both tile edges, so the curtains meet at the join.
        const t = x / 400 * Math.PI * 2 * lobes;
        return round(base + flip * (amp * Math.cos(t) + amp * .4 * Math.cos(t * 2)));
      };
      const curtain = function (base, amp, lobes, flip, length, colour) {
        let top = "", under = "", rays = "", hem = "";
        for (let x = 0; x <= 400; x += 10) {                                                                                 // The curtain's top and bottom edges.
          top += (x ? " L" : "M") + x + " " + wave(x, base, amp, lobes, flip);
          under = " L" + x + " " + wave(x, base + length, amp, lobes, flip) + under;
          hem += (x ? " L" : "M") + x + " " + wave(x, base + length, amp, lobes, flip);
        }
        for (let x = 3; x < 400; x += 5) {                                                                                   // Rays of uneven height, every 5 units.
          const y = wave(x, base, amp, lobes, flip), drop = round(length * (.72 + .28 * Math.sin(x / 400 * Math.PI * 2 * lobes * 3 + base)));
          rays += "M" + x + " " + y + " V" + round(y + drop) + " ";
        }
        return path(top + under + " Z", colour, 'opacity=".13"') +                                                           // The soft body of the curtain.
          path(rays, "none", 'stroke="' + colour + '" stroke-width="2.8" opacity=".36"') +                                   // The rays.
          path(hem, "none", 'stroke="#ffffff" stroke-width="1.4" opacity=".4"');                                             // The bright hem along the bottom.
      };
      const peaks = "M0 300 L40 238 L84 274 L140 204 L190 266 L240 222 L300 276 L352 232 L400 300 V352 H0 Z";
      return rect(0, 0, 400, 352, "#060a26") + rect(0, 170, 400, 182, "#0e1a44", 'opacity=".75"') +
        scatter(31, 44, function (roll) { return circle(round(roll(4, 396)), round(roll(4, 250)), round(roll(.5, 1.4)), "#fff", 'opacity="' + round(roll(.35, 1)) + '"'); }) +
        curtain(26, 22, 2, 1, 96, "#7fffd4") + curtain(80, 28, 1, -1, 86, "#70ebea") + curtain(124, 20, 3, 1, 70, "#c98cff") + curtain(166, 16, 2, -1, 52, "#ff8ecb") +
        [[58, 44, 7], [176, 28, 5], [312, 60, 8], [96, 150, 5], [352, 134, 6], [234, 72, 6], [24, 200, 4], [272, 188, 5]].map(function (s, i) { return path(star(s[0], s[1], s[2]), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .37 % 2).toFixed(2) + 's"'); }).join("") +
        path(peaks, "#232d66") +
        path("M40 238 L27 258 L37 254 L45 262 L54 250 Z M140 204 L121 230 L134 225 L146 236 L160 228 Z M240 222 L227 240 L238 236 L248 244 L258 236 Z M352 232 L338 248 L350 245 L359 252 L367 248 Z", "#e6f0ff") +
        path("M0 318 Q100 292 200 318 T400 318 V352 H0 Z", "#101a45") +
        scatter(32, 18, function (roll) { const x = round(roll(14, 386)), h = round(roll(12, 26)); return path("M" + round(x - h * .36) + " 350 L" + x + " " + round(350 - h) + " L" + round(x + h * .36) + " 350 Z", "#091233"); }) +
        rect(292, 330, 16, 12, "#1a2452") + path("M288 332 L300 322 L312 332 Z", "#27346a") + rect(298, 334, 4, 5, "#ffdc83", 'class="lp-twinkle"'); // A tiny cabin with one warm window.
    },

    // ---- Dungeon sets: a piece for every spot from each dungeon place, found down there as rare loot (the "found"
    // entries in the catalog that aren't on the trophy bracket).
    // Moonlit Shrine set
    // Rare dungeon finds from the Moonlit Shrine: paper lanterns, quiet lavender stone and a moon that never sets.
    // Palette: wall #2b2a52, floor #3b3766, pale moon #f0deff, lantern glow #ffe9a8, torii red #d9545a.
    "wall-shrine-shoji": function () { // Four shoji panels lit softly from behind, bamboo shadows on the paper, and dark wood below with moon crests.
      const wood = "#1b1936";
      let lattice = "", stalks = "", nodes = "", leaves = "";
      for (let x = 0; x < 400; x += 100) { // The thin lattice inside each panel, kept clear of the tile's edges.
        for (let gx = x + 25; gx < x + 100; gx += 25) lattice += "M" + gx + " 18 V284 ";
        for (let gy = 52; gy < 284; gy += 34) lattice += "M" + (x + 3) + " " + gy + " H" + (x + 97) + " ";
      }
      [[46, 40], [60, 92], [318, 30], [332, 120]].forEach(function (b) { // Bamboo stalks seen as shadows through the paper.
        stalks += "M" + b[0] + " " + b[1] + " V284 ";
        for (let y = b[1] + 40; y < 284; y += 46) nodes += "M" + (b[0] - 4) + " " + y + " H" + (b[0] + 4) + " ";
      });
      const leaf = function (x, y, dx, dy) { // One pointed leaf from (x, y) reaching out by (dx, dy).
        return "M" + x + " " + y + " Q" + round(x + dx / 2 - dy * .28) + " " + round(y + dy / 2 + dx * .28) + " " + (x + dx) + " " + (y + dy) + " Q" + round(x + dx / 2 + dy * .28) + " " + round(y + dy / 2 - dx * .28) + " " + x + " " + y + "Z ";
      };
      [[46, 60, -30, -10], [46, 64, -26, 10], [46, 100, 28, -12], [60, 130, 30, 6], [60, 120, 26, -16], [318, 52, -28, 8], [318, 48, 26, -14], [332, 150, 30, -4], [332, 160, -26, 12], [318, 90, -30, -6]].forEach(function (l) { leaves += leaf(l[0], l[1], l[2], l[3]); });
      let crests = "";
      [50, 150, 250, 350].forEach(function (x) { crests += circle(x, 322, 9, "#f0deff", 'opacity=".35"') + circle(x + 4, 319, 8, "#25223f"); }); // A crescent moon crest on each lower board.
      return rect(0, 0, 400, 352, "#2b2a52") + rect(0, 14, 400, 272, "#3d3b78") +                                   // The wall and the paper.
        oval(200, 150, 186, 128, "#ffe9a8", 'opacity=".07"') +                                                      // A lamp's warmth behind the paper.
        path(stalks, "none", 'stroke="#2c2a5e" stroke-width="7"') + path(nodes, "none", 'stroke="#3d3b78" stroke-width="1.5"') + path(leaves, "#2c2a5e") + // Bamboo shadows.
        path(lattice, "none", 'stroke="' + wood + '" stroke-width="2"') +
        rect(0, 8, 400, 10, wood) + rect(0, 284, 400, 8, wood) +                                                     // Top and bottom rails, edge to edge.
        rect(0, 14, 3, 272, wood) + rect(97, 14, 6, 272, wood) + rect(197, 14, 6, 272, wood) + rect(297, 14, 6, 272, wood) + rect(397, 14, 3, 272, wood) + // Uprights; the edge ones meet at the join.
        rect(0, 292, 400, 60, "#25223f") + path("M25 296 V352 M75 296 V352 M125 296 V352 M175 296 V352 M225 296 V352 M275 296 V352 M325 296 V352 M375 296 V352", "none", 'stroke="' + wood + '" stroke-width="1.5"') +
        rect(0, 292, 400, 3, "#f0deff", 'opacity=".25"') + crests;                                                   // The rail's moonlit edge and the crests.
    },

    "floor-shrine-flagstones": function () { // Lavender flagstones in two offset courses, moss in the cracks and fallen petals.
      const shades = ["#3b3766", "#45417a", "#36325f", "#4d4884"], roll = dice(311);
      let out = rect(0, 350, 400, 150, "#232042"), edges = "";
      const pick = function () { return shades[Math.floor(roll(0, 4))]; };
      [[353, 34], [390, 34], [427, 34], [464, 36]].forEach(function (row, i) {
        const y = row[0], h = row[1];
        if (i % 2) { // Offset course: the stone over the join is drawn as two halves, one at each edge, in the same colour.
          const c = pick();
          out += rect(0, y, 47, h, c) + rect(353, y, 47, h, c);
          edges += "M0 " + (y + 1.5) + " H45 M355 " + (y + 1.5) + " H400 ";
          for (let x = 53; x < 350; x += 100) { out += rect(x, y, 94, h, pick()); edges += "M" + (x + 2) + " " + (y + 1.5) + " H" + (x + 92) + " "; }
        } else for (let x = 3; x < 400; x += 100) { out += rect(x, y, 94, h, pick()); edges += "M" + (x + 2) + " " + (y + 1.5) + " H" + (x + 92) + " "; }
      });
      return out + path(edges, "none", 'stroke="#f0deff" stroke-width="1.5" opacity=".14"') +                     // Moonlight catching each stone's top edge.
        [[100, 388], [250, 425], [150, 462], [350, 388], [50, 425], [300, 462]].map(function (m) { return oval(m[0], m[1], 8, 3, "#4f7a6a") + oval(m[0] + 3, m[1] - 1, 4, 2, "#7fae8a"); }).join("") + // Moss in the cracks.
        scatter(312, 14, function (rollPetal) { const x = round(rollPetal(12, 388)), y = round(rollPetal(360, 494)); return oval(x, y, 3.4, 1.8, "#efc8ea", 'opacity=".8" transform="rotate(' + Math.round(rollPetal(0, 180)) + " " + x + " " + y + ')"'); }) + // Fallen petals.
        rect(0, 350, 400, 3, "#ffe9a8", 'opacity=".35"');
    },

    "art-shrine-rabbit-scroll": function () { // A hanging scroll: a night painting of the moon rabbit gazing up at a huge full moon.
      const ink = "#3a2430";
      return rect(42, 145, 56, 5, ink, 'rx="2"') + circle(40, 147.5, 3.5, "#d9b24a") + circle(100, 147.5, 3.5, "#d9b24a") +  // Top rod and its gold ends.
        rect(45, 150, 50, 78, "#8a7fc0") + rect(45, 154, 50, 3, "#5a4f8f") + rect(45, 221, 50, 3, "#5a4f8f") +               // Lavender silk mounting with darker bands.
        rect(50, 159, 40, 59, "#24214a") +                                                                                 // The painted night.
        circle(73, 178, 16, "#ffe9a8", 'opacity=".2"') + circle(73, 178, 12, "#fff4cf", 'class="lp-twinkle"') +           // The moon and its halo.
        path("M50 184 Q62 180 74 184 Q82 186 90 183", "none", 'stroke="#8a7fc0" stroke-width="2" opacity=".7"') +           // A wisp of cloud across it.
        path("M50 218 V208 Q60 201 68 206 Q78 199 90 205 V218 Z", "#3d3b78") +                                             // A soft hill.
        path("M84 207 Q82 194 86 186 M80 208 Q77 198 78 190 M87 208 Q89 199 90 194", "none", 'stroke="#c9b98a" stroke-width="1.2"') + // Pampas grass.
        oval(62, 205, 7, 5, "#fff8fc") + circle(66, 199, 4.4, "#fff8fc") + circle(55.5, 205, 2, "#fff8fc") +                 // The rabbit's body, head and tail.
        oval(65, 191, 1.7, 5, "#fff8fc", 'transform="rotate(-12 65 195)"') + oval(68.5, 191.5, 1.7, 5, "#fff8fc", 'transform="rotate(14 68.5 195.5)"') + // Ears up, listening.
        circle(67.6, 198.4, .9, "#24214a") + circle(66.8, 201.2, 1, "#ffb3d1", 'opacity=".8"') +
        rect(42, 228, 56, 5, ink, 'rx="2"') + circle(40, 230.5, 3.5, "#d9b24a") + circle(100, 230.5, 3.5, "#d9b24a") +        // Bottom rod.
        path("M58 233 V240 M82 233 V240", "none", 'stroke="#d9545a" stroke-width="2" stroke-linecap="round"');             // Two little tassels.
    },

    "shelf-shrine-offering": function () { // A moon-viewing offering: moon dumplings on a stand, pampas grass in a vase and a tiny torii.
      const dango = [[306, 186], [314, 186], [322, 186], [310, 179], [318, 179], [314, 172]];
      return path("M302 191 H326 L324 194 H304 Z", "#c9a15a") + path("M305 194 H323 L321 200 H307 Z", "#a8803a") + circle(314, 197, 1.6, "#6b4a20") + // The little stand.
        dango.map(function (d) { return circle(d[0], d[1], 4.2, "#fff8f0", 'stroke="#d8cce8" stroke-width=".8"'); }).join("") + // A pyramid of white dumplings.
        path("M340 177 Q336 162 331 150 M342 177 Q345 160 351 148 M341 177 V151", "none", 'stroke="#c9b98a" stroke-width="1.4"') + // Grass stems.
        oval(331, 151, 3, 8, "#efe3cf", 'transform="rotate(-22 331 151)"') + oval(351, 149, 3, 8, "#efe3cf", 'transform="rotate(24 351 149)"') + oval(341, 150, 3, 9, "#f6ecd8") + // Feathery plumes.
        path("M334 200 Q330 190 336 182 Q334 178 338 176 H346 Q350 178 348 182 Q354 190 350 200 Z", "#5a4f8f") + rect(336, 187, 12, 2, "#f0deff", 'opacity=".5"') + // The vase.
        rect(358.5, 176, 3, 24, "#d9545a") + rect(370.5, 176, 3, 24, "#d9545a") + rect(356, 181, 20, 2.4, "#d9545a") + rect(357, 175.5, 18, 2.4, "#d9545a") + // A tiny torii.
        path("M353 172 Q366 176 379 172 L378 176 Q366 179.5 354 176 Z", "#2b2340") +
        oval(314, 182, 18, 12, "#ffe9a8", 'opacity=".1"') + path(star(366, 162, 3.5), "#fff4cf", 'class="lp-twinkle"') +
        rect(296, 200, 82, 6, "#6b2f3a", 'rx="2"') + path("M304 206 l6 10 M370 206 l-6 10", "none", 'stroke="#6b2f3a" stroke-width="3" stroke-linecap="round"'); // A red lacquer board.
    },

    "view-shrine-lake": function () { // A torii standing in a still lavender lake below misty mountains, lanterns floating and petals drifting.
      const torii = function (x, base, flip, more) { // A small vermilion torii; flip draws its reflection upside down.
        return group(rect(-11, -30, 3, 30, "#e0605a") + rect(8, -30, 3, 30, "#e0605a") + rect(-14, -24, 28, 2.5, "#e0605a") + rect(-14, -29, 28, 2.5, "#e0605a") +
          path("M-18 -32 Q0 -29 18 -32 L17 -29 Q0 -26 -17 -29 Z", "#2b2340"), 'transform="translate(' + x + " " + base + ") scale(1 " + (flip ? -1 : 1) + ')"' + (more || ""));
      };
      const lantern = function (x, y) { // A paper lantern floating on the water, glowing.
        return oval(x, y + 1, 9, 3, "#ffe9a8", 'opacity=".25"') + path("M" + (x - 4) + " " + (y + 1) + " L" + (x - 3) + " " + (y - 6) + " H" + (x + 3) + " L" + (x + 4) + " " + (y + 1) + " Z", "#ffe9a8", 'class="lp-twinkle"');
      };
      return view(["#6a5aa8", "#f2c6dc"], ["#0c0a26", "#2a2456"], 30,
        path("M0 84 L28 64 L52 76 L92 44 L132 74 L170 54 L204 72 L240 84 V140 H0 Z", "#5a4f96") + path("M84 52 L92 44 L100 52 L96 51 L92 55 L88 51 Z M164 60 L170 54 L176 60 L172 59 L170 62 L167 59 Z", "#f0deff") + rect(0, 80, 240, 9, "#f0deff", 'opacity=".2"'), // Far mountains and mist.
        rect(0, 90, 240, 50, "#3d3680") + path("M14 96 h14 M60 112 h10 M120 100 h18 M186 108 h12 M210 96 h10", "none", 'stroke="#c9b8f0" stroke-width="1" opacity=".6"') + // The lake and its glints.
          torii(70, 104, false) + torii(70, 104, true, ' opacity=".28"') + oval(184, 100, 16, 3, "#2b2752") + rect(182, 92, 4, 8, "#8a85b0") + rect(180, 89, 8, 4, "#ffe9a8", 'class="lp-twinkle"') + path("M178 89 L184 85 L190 89 Z", "#8a85b0"), // Torii, its reflection, and a stone lantern on an islet.
        hills(313, 124, 10, "#1f1b40") + path("M20 124 Q18 112 14 106 M26 124 Q26 110 30 104 M150 124 Q148 114 144 108 M156 124 Q158 112 162 106 M218 124 Q216 114 212 110", "none", 'stroke="#2b2752" stroke-width="2" stroke-linecap="round"') + // The near bank and reeds.
          lantern(46, 116) + lantern(112, 114) + lantern(196, 117),
        falling("snow", scatter(314, 12, function (roll) { const x = round(roll(2, 118)), y = round(roll(0, 128)); return oval(x, y, 2, 1.2, "#f4cbe8", 'opacity=".9" transform="rotate(' + Math.round(roll(0, 180)) + " " + x + " " + y + ')"'); }))); // Drifting petals.
    },

    "frame-shrine-torii": function () { // The window is framed by a vermilion torii gate: two pillars, a curved black top beam and a moon plaque.
      const red = "#d9545a", ink = "#2b2340";
      return rect(132, 222, 22, 10, "#6f6a96", 'rx="2"') + rect(246, 222, 22, 10, "#6f6a96", 'rx="2"') +            // Stone footings.
        rect(138, 106, 12, 118, red) + rect(250, 106, 12, 118, red) + rect(140, 106, 3, 118, "#f08a80", 'opacity=".5"') + rect(252, 106, 3, 118, "#f08a80", 'opacity=".5"') + // Pillars, lit on one side.
        rect(124, 126, 152, 8, red) + rect(124, 132, 152, 2, "#a83a40") +                                              // The tie beam across.
        path("M120 100 Q200 108 280 100 V108 Q200 116 120 108 Z", red) +                                                // The red beam under the top.
        path("M108 85 Q200 100 292 85 L287 96 Q200 109 113 96 Z", ink) + path("M112 88 Q200 102 288 88", "none", 'stroke="#5a4f8f" stroke-width="1.5"') + // The black top beam, ends turned up.
        rect(190, 108, 20, 18, ink, 'rx="1"') + rect(193, 111, 14, 12, "#d9b24a", 'rx="1"') + circle(200, 117, 4.5, ink) + circle(202, 115.5, 4, "#d9b24a") + // A gold plaque with a crescent.
        rect(146, 225, 108, 6, "#8a85b0", 'rx="2"') +                                                                    // A stone step for a sill.
        path(star(116, 82, 4), "#fff4cf", 'class="lp-twinkle"') + path(star(284, 82, 4), "#fff4cf", 'class="lp-twinkle" style="animation-delay:.8s"');
    },

    "curtain-shrine-rope": function () { // A twisted straw rope swagged over the window with zigzag paper streamers, and a paper lantern at each side.
      const rope = "M122 90 Q200 124 278 90", red = "#d9545a", ink = "#2b2340";
      const shide = function (x, y) { // A folded paper streamer: four squares stepping left and right down a short tab.
        return path("M" + (x - 1) + " " + y + " h3 v4 h-3 Z M" + (x - 4) + " " + (y + 4) + " h7 v6 h-7 Z M" + (x - 1) + " " + (y + 10) + " h7 v6 h-7 Z M" + (x - 4) + " " + (y + 16) + " h7 v6 h-7 Z M" + (x - 1) + " " + (y + 22) + " h7 v6 h-7 Z", "#fff8f0", 'stroke="#d8cce8" stroke-width=".6"');
      };
      const lantern = function (x, y, delay) { // A round paper lantern on a cord.
        return line(x, 92, x, y - 16, "#8a7aa8", 1) + oval(x, y, 24, 26, "#ffe9a8", 'opacity=".13"') + rect(x - 6, y - 17, 12, 4, ink, 'rx="1"') +
          oval(x, y, 10, 14, "#f4e6d0", 'class="lp-twinkle" style="animation-delay:' + delay + 's"') +
          path("M" + (x - 9) + " " + (y - 7) + " Q" + x + " " + (y - 5) + " " + (x + 9) + " " + (y - 7) + " M" + (x - 10) + " " + y + " Q" + x + " " + (y + 2) + " " + (x + 10) + " " + y + " M" + (x - 9) + " " + (y + 7) + " Q" + x + " " + (y + 9) + " " + (x + 9) + " " + (y + 7), "none", 'stroke="#c9a080" stroke-width="1"') + // The ribs.
          circle(x, y, 4, red) + circle(x + 1.6, y - 1, 3.4, "#f4e6d0") +                                                  // A red crescent on its side.
          rect(x - 5, y + 13, 10, 4, ink, 'rx="1"') + line(x, y + 17, x, y + 27, red, 2.4, 'stroke-linecap="round"');
      };
      return lantern(130, 150, 0) + lantern(270, 150, .9) +
        shide(168, 104) + shide(200, 108) + shide(232, 104) +
        path(rope, "none", 'stroke="#d8c48a" stroke-width="9" stroke-linecap="round"') + path(rope, "none", 'stroke="#a8925a" stroke-width="9" stroke-dasharray="2.5 5"') + // The rope and its twist.
        circle(122, 90, 6, "#c9b070") + circle(278, 90, 6, "#c9b070");                                                  // Knots at the ends.
    },

    "lamp-shrine-toro": function () { // A mossy stone garden lantern with a warm light in its little window.
      return oval(56, 316, 52, 50, "#ffe9a8", 'opacity=".1"') + oval(56, 318, 28, 26, "#ffe9a8", 'opacity=".12"') + oval(56, 405, 26, 4, "#1c1838") + // Glow and shadow.
        path("M34 404 L38 394 H74 L78 404 Z", "#6f6a96") +                                                              // Base.
        rect(48, 352, 16, 42, "#7a75a3") + rect(50, 352, 4, 42, "#9a95c0", 'opacity=".5"') + rect(45, 368, 22, 5, "#6f6a96", 'rx="1"') + // Pillar with a ring.
        path("M32 352 L40 342 H72 L80 352 Z", "#6f6a96") +                                                              // Platform.
        rect(40, 304, 32, 38, "#5f5a8a") + rect(46, 310, 20, 24, "#ffe9a8", 'class="lp-twinkle"') + path("M56 310 V334 M46 322 H66", "none", 'stroke="#5f5a8a" stroke-width="2"') + // The fire box and its lit window.
        path("M22 304 Q40 300 46 286 H66 Q72 300 90 304 Q92 309 86 309 H26 Q20 309 22 304 Z", "#4f4a7a") + path("M30 303 Q44 299 50 290", "none", 'stroke="#8a85b0" stroke-width="1.5" opacity=".6"') + // Roof with turned-up corners.
        oval(40, 300, 6, 2.4, "#5f8a6e") + oval(71, 299, 5, 2, "#6f9a7a") + oval(36, 348, 5, 2, "#5f8a6e") +            // Moss.
        rect(52, 283, 8, 3, "#4f4a7a") + oval(56, 278, 6, 6.5, "#5f5a8a") + path("M56 266 Q61 274 56 278 Q51 274 56 266 Z", "#6f6a96") + // The jewel-shaped top.
        path(star(92, 270, 3.5), "#ffe9a8", 'class="lp-twinkle"') + path(star(20, 330, 3), "#ffe9a8", 'class="lp-twinkle" style="animation-delay:.9s"'); // Two fireflies.
    },

    "rug-shrine-moonripple": function () { // A round woven rug: a full moon in the middle, ripples spreading out and gold lantern-stars around the rim.
      let ring = "";
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + .39; ring += star(round(Math.cos(a) * 122), round(Math.sin(a) * 122), 10) + " "; }
      return group(circle(0, 0, 150, "none", 'stroke="#f0deff" stroke-width="10" stroke-dasharray="2 5" opacity=".55"') + // Fringe.
        circle(0, 0, 146, "#2e2a62") + circle(0, 0, 136, "none", 'stroke="#7a6fc0" stroke-width="5"') + circle(0, 0, 108, "#3b3577") +
        circle(0, 0, 108, "none", 'stroke="#ffe9a8" stroke-width="2.5" stroke-dasharray="6 6"') +
        circle(0, 0, 90, "none", 'stroke="#5a4f96" stroke-width="8"') + circle(0, 0, 72, "none", 'stroke="#5a4f96" stroke-width="4"') + // Ripples.
        circle(0, 0, 60, "#ffe9a8", 'opacity=".2"') + circle(0, 0, 46, "#f0deff") +                                    // The moon and its glow.
        circle(-14, -10, 9, "#d8c6f0") + circle(16, 12, 7, "#d8c6f0") + circle(10, -20, 5, "#d8c6f0") + path(ring, "#ffe9a8"), // Craters, and the stars round the rim.
        'transform="translate(200 440) scale(1 .27)"');
    },

    "bed-shrine-futon": function () { // A futon on a low wooden platform: a lavender quilt with crescent moons, a buckwheat pillow, and a moon-rabbit plush.
      return oval(340, 462, 58, 5, "#00000044") +
        rect(286, 440, 108, 14, "#5a3440", 'rx="2"') + rect(286, 440, 108, 3, "#8a5060") + rect(292, 454, 8, 6, "#3a2230") + rect(380, 454, 8, 6, "#3a2230") + // The low platform.
        rect(292, 428, 96, 14, "#f0deff", 'rx="5"') + rect(292, 438, 96, 4, "#c9b8e8", 'rx="2"') +                    // The mattress.
        oval(302, 425, 13, 7, "#d9c48a") + path("M292 425 H312", "none", 'stroke="#b8a060" stroke-width="1"') +          // The pillow.
        path("M314 440 Q308 418 324 414 H382 Q392 416 390 440 Z", "#4a4290") +                                             // The quilt.
        path("M318 436 Q314 420 326 418 H380 Q387 420 386 436", "none", 'stroke="#ffe9a8" stroke-width="1.2" stroke-dasharray="3 3" opacity=".8"') +
        [[332, 428], [354, 432], [376, 427]].map(function (c) { return circle(c[0], c[1], 5, "#ffe9a8") + circle(c[0] + 2, c[1] - 1.5, 4.4, "#4a4290"); }).join("") + // Crescent moons on it.
        oval(368, 410, 8, 5, "#fff8fc") + circle(361, 406, 4.6, "#fff8fc") +                                               // The rabbit plush, asleep on top.
        oval(359, 399, 1.6, 5, "#fff8fc", 'transform="rotate(-24 359 403)"') + oval(363, 399, 1.6, 5, "#fff8fc", 'transform="rotate(-6 363 403)"') +
        path("M358.4 406 q1.4 1 2.8 0", "none", 'stroke="#3b3766" stroke-width=".9"') + circle(376, 410, 2, "#fff8fc") +
        path(star(304, 404, 4), "#fff4cf", 'class="lp-twinkle"');
    },

    "door-shrine-shoji": function () { // A sliding shoji door glowing from a lamp inside, with a cat's shadow sitting behind the paper.
      let lattice = "";
      for (let x = -40.5; x < 6; x += 15.5) lattice += "M" + x + " 202 V324 ";
      for (let y = 222; y < 324; y += 20) lattice += "M-56 " + y + " H6 ";
      return oval(-25, 272, 54, 100, "#ffe9a8", 'opacity=".04"') + oval(-25, 272, 46, 90, "#ffe9a8", 'opacity=".05"') + // Light spilling softly onto the wall.
        rect(-64, 194, 78, 160, "#3a2a3a", 'rx="3"') + rect(-56, 202, 62, 122, "#f4e2b0") +                               // Frame and lit paper.
        oval(-25, 262, 26, 52, "#fff4d0", 'opacity=".7"') +                                                                // Brightest where the lamp is.
        path("M-42 322 Q-44 298 -32 292 Q-22 296 -20 322 Z M-38 282 L-37 271 L-32 279 Z M-24 282 L-25 271 L-30 279 Z", "#c4a472", 'opacity=".75"') + circle(-31, 286, 8, "#c4a472", 'opacity=".75"') + // A cat's shadow.
        path("M-21 320 Q-8 318 -10 302", "none", 'stroke="#c4a472" stroke-width="3.5" stroke-linecap="round" opacity=".75"') +
        path(lattice, "none", 'stroke="#3a2a3a" stroke-width="2.5"') +
        rect(-56, 324, 62, 24, "#4a3446") + rect(-52, 328, 54, 16, "#5a4050", 'rx="1"') +                                // Kickboard.
        oval(1, 284, 2.4, 7, "#241824") + rect(-62, 348, 74, 6, "#2a1e2a") +                                              // Finger pull and threshold.
        rect(-31, 196, 10, 15, "#fff8f0") + path("M-26 199 V208", "none", 'stroke="#d9545a" stroke-width="2"');          // A paper charm at the top.
    },

    "hang-shrine-lanterns": function () { // Three round paper lanterns hung from a swag of cord, two red and a big cream one with a crescent.
      const ink = "#2b2340", red = "#d9545a";
      const lantern = function (x, top, y, rx, ry, body, i) { // Cord, glow, caps, ribbed body, inner light and a tassel.
        return line(x, top, x, y - ry - 4, "#8a7aa8", 1) + oval(x, y, rx + 12, ry + 10, "#ffe9a8", 'opacity=".14"') + rect(round(x - rx * .6), y - ry - 4, round(rx * 1.2), 5, ink, 'rx="1"') +
          oval(x, y, rx, ry, body) + oval(x, y, round(rx * .5), round(ry * .6), "#fff4d0", 'opacity=".55" class="lp-twinkle" style="animation-delay:' + i * .6 + 's"') +
          path("M" + round(x - rx * .95) + " " + round(y - ry * .5) + " Q" + x + " " + round(y - ry * .3) + " " + round(x + rx * .95) + " " + round(y - ry * .5) + " M" + (x - rx) + " " + y + " Q" + x + " " + round(y + ry * .2) + " " + (x + rx) + " " + y + " M" + round(x - rx * .95) + " " + round(y + ry * .5) + " Q" + x + " " + round(y + ry * .7) + " " + round(x + rx * .95) + " " + round(y + ry * .5), "none", 'stroke="#00000030" stroke-width="1.2"') +
          rect(round(x - rx * .5), y + ry - 1, round(rx), 4, ink, 'rx="1"') + line(x, y + ry + 3, x, y + ry + 13, i === 1 ? red : "#ffe9a8", 2.4, 'stroke-linecap="round"');
      };
      return path("M288 6 Q334 34 380 6", "none", 'stroke="#8a7aa8" stroke-width="1.2"') + circle(288, 6, 2, "#8a7aa8") + circle(380, 6, 2, "#8a7aa8") +
        lantern(306, 15, 52, 12, 15, red, 0) + lantern(362, 15, 48, 11, 14, red, 2) + lantern(334, 20, 82, 16, 20, "#f4e6d0", 1) +
        circle(334, 82, 6, red) + circle(336.5, 80.5, 5, "#f4e6d0");                                                        // A red crescent on the big one.
    },

    "table-shrine-fox": function () { // A red-and-black lacquer table with a smoking incense burner and a little white shrine fox in a red bib.
      const white = "#fff8fc";
      return rect(310, 334, 5, 28, "#2b1e2e") + rect(357, 334, 5, 28, "#2b1e2e") + rect(310, 348, 52, 3, "#2b1e2e", 'opacity=".7"') + // Legs.
        rect(304, 326, 64, 6, "#2b1e2e", 'rx="2"') + rect(304, 331, 64, 3, "#b8403f") +                                 // Lacquer top with a red edge.
        path("M323 292 Q317 282 323 274 Q329 266 323 256 Q318 248 322 240 M317 296 Q312 288 316 282", "none", 'stroke="#f0deff" stroke-width="1.6" opacity=".45" stroke-linecap="round"') + // Curling smoke.
        path("M319 313 L317 297 M323 313 V295 M327 313 L329 298", "none", 'stroke="#a85040" stroke-width="1.4"') +    // Incense sticks.
        circle(317, 297, 1.5, "#ffb84a", 'class="lp-twinkle"') + circle(323, 295, 1.5, "#ffb84a") + circle(329, 298, 1.5, "#ffb84a", 'class="lp-twinkle" style="animation-delay:.7s"') +
        path("M310 326 Q310 314 322 314 Q334 314 334 326 Z", "#b08a4a") + rect(308, 312, 28, 3, "#8a6a30", 'rx="1.5"') + oval(322, 312, 12, 1.8, "#d8cfe4") + // The bronze burner.
        path("M356 324 Q372 320 369 303 Q366 290 357 293 Q364 302 360 312 Q356 318 351 320 Z", white, 'stroke="#c9bcd8" stroke-width=".8"') + // The fox's tail.
        path("M342 326 Q340 308 350 302 Q358 308 358 326 Z", white, 'stroke="#c9bcd8" stroke-width=".8"') +          // Body.
        circle(350, 296, 7, white, 'stroke="#c9bcd8" stroke-width=".8"') + path("M344 297 L337.5 299 L344 301.5 Z", white) + circle(338, 299, 1, "#3b3766") + // Head and snout.
        path("M344 292 L343 281 L349 289 Z M356 292 L357 281 L351 289 Z", white) + path("M345 290 L344.5 284 L347.5 288.5 Z M355 290 L355.5 284 L352.5 288.5 Z", "#ffb3d1") + // Ears.
        path("M346 294 q1.5 1.2 3 0 M352 294 q1.5 1.2 3 0", "none", 'stroke="#3b3766" stroke-width="1" stroke-linecap="round"') + // Closed, contented eyes.
        path("M344 303 Q350 312 356 303 L355 301 H345 Z", "#d9545a");                                                      // The red bib.
    },

    "plant-shrine-wishbamboo": function () { // Lucky bamboo in an indigo pot, hung with paper wish strips and a paper star on top.
      const leaf = function (x, y, dx, dy) { // One pointed leaf from (x, y) reaching out by (dx, dy).
        return "M" + x + " " + y + " Q" + round(x + dx / 2 - dy * .3) + " " + round(y + dy / 2 + dx * .3) + " " + (x + dx) + " " + (y + dy) + " Q" + round(x + dx / 2 + dy * .3) + " " + round(y + dy / 2 - dx * .3) + " " + x + " " + y + "Z ";
      };
      const light = [[21, 282, -17, -6], [21, 280, 15, -10], [12, 304, -16, -4], [30, 314, 16, -5], [21, 320, 16, 6]].map(function (l) { return leaf(l[0], l[1], l[2], l[3]); }).join("");
      const dark = [[21, 286, 18, 4], [21, 288, -15, 8], [12, 306, -12, 8], [30, 316, 14, 8], [12, 340, -14, -6]].map(function (l) { return leaf(l[0], l[1], l[2], l[3]); }).join("");
      const strips = [[-4, 296, "#ff8ecb"], [37, 290, "#ffdc83"], [-2, 318, "#c9a8ff"], [40, 312, "#70ebea"], [33, 330, "#ff8ecb"]];
      return rect(10, 302, 5, 68, "#6fae7a", 'rx="2"') + rect(19, 280, 5, 90, "#5f9e6e", 'rx="2"') + rect(28, 314, 4, 56, "#7fbe88", 'rx="2"') + // Three stalks.
        path("M10 330 h5 M10 352 h5 M19 304 h5 M19 328 h5 M19 352 h5 M28 338 h4 M28 356 h4", "none", 'stroke="#3f7a52" stroke-width="1.4"') + // Their joints.
        path(dark, "#4f9a68") + path(light, "#7fc49a") +
        path(strips.map(function (s) { return "M" + (s[0] + 2.5) + " " + (s[1] - 7) + " V" + s[1]; }).join(" "), "none", 'stroke="#f0deff" stroke-width=".8"') +
        strips.map(function (s) { return rect(s[0], s[1], 5, 13, s[2]); }).join("") +                                     // Paper wish strips.
        path(star(21, 270, 7), "#ffe9a8", 'class="lp-twinkle"') +
        path("M2 372 H34 L30 392 H6 Z", "#3b3766") + rect(0, 368, 36, 6, "#6f6a96", 'rx="2"') + path("M9 382 q4.5 -4 9 0 t9 0", "none", 'stroke="#f0deff" stroke-width="1.2" opacity=".6"'); // The indigo pot with a wave on it.
    },

    "chest-shrine-lacquer": function () { // A black lacquer box with a gold moon crest, lid propped open, a daruma, a paper fan and a pinwheel peeking out.
      const blades = ["#d9545a", "#f4e6d0", "#c9a8ff", "#ffdc83"].map(function (c, i) { // Four pinwheel blades.
        const a = i * 1.5708, b = a + .9;
        return path("M108 412 L" + round(108 + 12 * Math.cos(a)) + " " + round(412 + 12 * Math.sin(a)) + " L" + round(108 + 9 * Math.cos(b)) + " " + round(412 + 9 * Math.sin(b)) + " Z", c);
      }).join("");
      return oval(92, 476, 40, 4, "#00000044") + path("M60 440 L65 426 H123 L126 440 Z", "#3a2a48") +                  // Shadow, and the lid propped open behind.
        line(108, 412, 108, 444, "#c9a15a", 2) + blades + circle(108, 412, 2, "#d9b24a") +                                // The pinwheel.
        path("M93 442 L82 420 Q94 410 106 420 Z", "#f0deff") + path("M93 442 L88 418 M93 442 L94 414 M93 442 L100 416", "none", 'stroke="#8a7fc0" stroke-width="1"') + // A folded paper fan.
        circle(74, 432, 11, "#d9545a") + oval(74, 430, 7, 6, "#fff8f0") + circle(71.5, 429.5, 1.7, "#2b2340") + circle(76.5, 429.5, 1.7, "#2b2340") + path("M70 425.5 q1.5 -1.5 3 0 M75 425.5 q1.5 -1.5 3 0", "none", 'stroke="#2b2340" stroke-width="1"') + // A daruma.
        rect(58, 440, 68, 34, "#241a30", 'rx="3"') + rect(58, 440, 68, 4, "#b8403f") +                                 // The box.
        rect(58, 440, 7, 7, "#d9b24a", 'rx="1"') + rect(119, 440, 7, 7, "#d9b24a", 'rx="1"') + rect(58, 467, 7, 7, "#d9b24a", 'rx="1"') + rect(119, 467, 7, 7, "#d9b24a", 'rx="1"') + // Gold corners.
        circle(92, 458, 8, "#d9b24a") + circle(95, 456, 7, "#241a30") + path(star(84, 452, 2.5), "#fff4cf", 'class="lp-twinkle"'); // A crescent crest.
    },

    // Crystal Cavern set
    // Rare dungeon finds from the Crystal Cavern: humming cyan and violet crystals, blue stone, and echoes drawn as doubled rings.
    // Palette: wall #1d3350, floor #27466b, crystal #9be8ff, glow #c9a8ff, rock #2e4a6e.
    "wall-crystal-cave": function () { // Layered blue cave rock with stalactites along the top, glowing crystal clusters and echo rings humming round them.
      const crystal = function (x, y, h, w, lean, fill) { // A pointed crystal rising from (x, y): its body, then a pale lit facet on the left.
        const sy = round(y - h * .78), tip = round(x + lean), sl = round(x - w + lean * .75), sr = round(x + w + lean * .75);
        return path("M" + round(x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + round(y - h) + " L" + sr + " " + sy + " L" + round(x + w) + " " + y + " Z", fill) +
          path("M" + round(x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + round(y - h) + " L" + round(x + lean * .75) + " " + sy + " L" + round(x) + " " + y + " Z", "#ffffff", 'opacity=".35"');
      };
      const cluster = function (x, y, s, a, b) { // A glow, three crystals and the rock they grow from.
        return oval(x, round(y - 18 * s), round(34 * s), round(28 * s), a, 'opacity=".08"') + crystal(x - 11 * s, y, 30 * s, 6 * s, -9 * s, b) + crystal(x + 11 * s, y, 26 * s, 6 * s, 9 * s, b) +
          crystal(x, y, 46 * s, 8 * s, 0, a) + oval(x, y, round(22 * s), round(4.5 * s), "#132440");
      };
      const echo = function (x, y, r) { // Two arcs over a cluster: the hum, and its echo.
        return path("M" + (x - r) + " " + y + " A" + r + " " + round(r * .8) + " 0 0 1 " + (x + r) + " " + y, "none", 'stroke="#9be8ff" stroke-width="1.6" opacity=".35"') +
          path("M" + (x - r - 12) + " " + y + " A" + (r + 12) + " " + round((r + 12) * .8) + " 0 0 1 " + (x + r + 12) + " " + y, "none", 'stroke="#9be8ff" stroke-width="1.2" opacity=".18"');
      };
      let drips = "M0 0 H400 V10", tips = "";
      [[384, 8, 22], [350, 15, 58], [290, 12, 34], [232, 17, 48], [176, 12, 30], [118, 15, 56], [70, 10, 26], [24, 13, 40]].forEach(function (s) { // Stalactites, right to left along the ceiling's edge.
        drips += " L" + (s[0] + s[1]) + " 10 L" + s[0] + " " + (10 + s[2]) + " L" + (s[0] - s[1]) + " 10";
        tips += "M" + s[0] + " " + (4 + s[2]) + " l3 6 l-3 6 l-3 -6 Z ";
      });
      return rect(0, 0, 400, 352, "#1d3350") +
        path("M0 120 Q100 106 200 120 T400 120 V352 H0 Z", "#223c5e", 'opacity=".8"') + path("M0 210 Q100 224 200 210 T400 210 V352 H0 Z", "#1a3050") + // Rock strata; each band is level at both edges.
        path("M0 300 Q100 288 200 300 T400 300 V352 H0 Z", "#16294a") + rect(0, 338, 400, 14, "#132440") +
        path(drips + " L0 10 Z", "#142540") + path(tips, "#9be8ff", 'opacity=".8" class="lp-twinkle"') +                 // Stalactites with glowing crystal tips.
        echo(72, 226, 40) + echo(318, 254, 36) +
        cluster(72, 262, 1.1, "#9be8ff", "#c9a8ff") + cluster(200, 168, .8, "#c9a8ff", "#9be8ff") + cluster(318, 288, 1, "#9be8ff", "#c9a8ff") + cluster(150, 334, .6, "#c9a8ff", "#9be8ff") + cluster(346, 128, .6, "#9be8ff", "#c9a8ff") +
        scatter(401, 22, function (roll, i) { return circle(round(roll(10, 390)), round(roll(40, 330)), round(roll(.8, 2)), i % 2 ? "#9be8ff" : "#c9a8ff", i % 3 ? 'opacity=".7"' : 'class="lp-twinkle"'); }); // Floating motes.
    },

    "floor-crystal-facets": function () { // A floor of cut-crystal diamond tiles, each split into four facets so it catches the light; violet gems scattered among the blue.
      const shades = [["#3a6694", "#2f5a86", "#284f7a", "#21446c"], ["#7a68b8", "#6858a4", "#5a4a92", "#4c3e80"]]; // Top-left, top-right, bottom-left, bottom-right facets; kept close so the floor stays calm.
      const facets = [["", "", "", ""], ["", "", "", ""]], w = 23, h = 13.5;
      const tile = function (cx, cy, family, part) { // part: "both", "right" (the tile at x = 0) or "left" (the tile at x = 400).
        const f = facets[family];
        if (part !== "right") { f[0] += "M" + (cx - w) + " " + cy + " L" + cx + " " + (cy - h) + " L" + cx + " " + cy + " Z "; f[2] += "M" + (cx - w) + " " + cy + " L" + cx + " " + (cy + h) + " L" + cx + " " + cy + " Z "; }
        if (part !== "left") { f[1] += "M" + cx + " " + (cy - h) + " L" + (cx + w) + " " + cy + " L" + cx + " " + cy + " Z "; f[3] += "M" + (cx + w) + " " + cy + " L" + cx + " " + (cy + h) + " L" + cx + " " + cy + " Z "; }
      };
      for (let r = 0; r < 5; r++) {
        for (let k = 0; k < 8; k++) tile(25 + k * 50, 365 + r * 30, (k + r * 3) % 4 === 0 ? 1 : 0, "both");                // Whole rows; one gem in four is violet.
        for (let k = 0; k <= 8; k++) tile(k * 50, 380 + r * 30, ((k % 8) + r * 3 + 2) % 4 === 0 ? 1 : 0, k === 0 ? "right" : k === 8 ? "left" : "both"); // Offset rows; the end halves join into one tile.
      }
      let out = rect(0, 350, 400, 150, "#142640");
      facets.forEach(function (f, family) { f.forEach(function (d, i) { out += path(d, shades[family][i]); }); });
      return out + [[75, 395], [225, 425], [325, 365], [125, 455], [275, 485], [175, 380]].map(function (s, i) { return path(star(s[0], s[1], 4), "#e6faff", 'class="lp-twinkle" style="animation-delay:' + (i * .35).toFixed(2) + 's"'); }).join("") + // Glints.
        rect(0, 350, 400, 3, "#9be8ff", 'opacity=".5"');
    },

    "art-crystal-agate": function () { // A polished geode slice hung on a wire: banded blue and violet agate around a hollow lined with crystal teeth.
      let teeth = "";
      for (let i = 0; i < 14; i++) { // Crystal points round the hollow, pointing in.
        const a = i / 14 * 6.283, b = .22;
        teeth += "M" + round(69 + 11 * Math.cos(a - b)) + " " + round(195 + 15 * Math.sin(a - b)) + " L" + round(69 + 5 * Math.cos(a)) + " " + round(195 + 8 * Math.sin(a)) + " L" + round(69 + 11 * Math.cos(a + b)) + " " + round(195 + 15 * Math.sin(a + b)) + " Z ";
      }
      return path("M69 147 L50 162 M69 147 L88 162", "none", 'stroke="#8a9ab8" stroke-width="1.2"') + circle(69, 147, 2.4, "#c9d6e8") + // Wire and nail.
        oval(69, 192, 33, 41, "#c9a8ff", 'opacity=".12"') + oval(69, 192, 30, 38, "#4a5670") +                            // A soft glow and the rough rind.
        oval(69, 192, 26, 34, "#9be8ff") + oval(70, 193, 23, 30, "#3f6aa0") + oval(69, 193, 20, 27, "#c9a8ff") + oval(70, 194, 17, 23, "#6a4ab0") + oval(69, 194, 14, 19, "#e6f8ff") + // Agate bands.
        oval(69, 195, 11, 15, "#2a1a5a") + path(teeth, "#c9a8ff") + path(star(69, 195, 5), "#ffffff", 'class="lp-twinkle"') + // The crystal hollow.
        path("M45 176 Q50 160 64 156", "none", 'stroke="#ffffff" stroke-width="2" opacity=".35" stroke-linecap="round"');  // A polish highlight.
    },

    "shelf-crystal-tuning": function () { // A crystal cluster, a tuning fork with its hum drawn twice, and a crystal ball on a little gold stand.
      const crystal = function (x, y, h, w, lean, fill) { // A pointed crystal rising from (x, y), with a pale lit facet.
        const sy = round(y - h * .78), tip = round(x + lean), sl = round(x - w + lean * .75), sr = round(x + w + lean * .75);
        return path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + sr + " " + sy + " L" + (x + w) + " " + y + " Z", fill) +
          path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + round(x + lean * .75) + " " + sy + " L" + x + " " + y + " Z", "#ffffff", 'opacity=".35"');
      };
      return oval(312, 186, 20, 18, "#9be8ff", 'opacity=".12"') + crystal(304, 200, 20, 4, -4, "#c9a8ff") + crystal(321, 200, 18, 4, 5, "#c9a8ff") + crystal(312, 200, 32, 5, 0, "#9be8ff") + oval(312, 200, 13, 2.6, "#2e4a6e") + // The cluster.
        rect(332, 194, 14, 6, "#6b4a2f", 'rx="1"') + rect(338, 182, 2, 12, "#c8d2e8") + path("M334 158 V175 Q334 182 339 182 Q344 182 344 175 V158", "none", 'stroke="#c8d2e8" stroke-width="2.6"') + // The tuning fork on a block.
        path("M329 162 Q326 168 329 174 M348 162 Q351 168 348 174", "none", 'stroke="#9be8ff" stroke-width="1.5" opacity=".8"') + path("M325 158 Q320 168 325 178 M352 158 Q357 168 352 178", "none", 'stroke="#9be8ff" stroke-width="1.2" opacity=".4"') + // Its hum, and the echo.
        path("M357 200 L359 194 H369 L371 200 Z", "#c9a15a") + circle(364, 186, 9, "#1d3350") + circle(364, 186, 9, "#9be8ff", 'opacity=".35" stroke="#dff8ff" stroke-width="1"') + // The crystal ball.
        path("M359 189 Q362 181 367 184 Q370 188 365 190", "none", 'stroke="#c9a8ff" stroke-width="1.8" class="lp-twinkle"') + circle(361, 182, 1.6, "#ffffff", 'opacity=".8"') +
        rect(296, 200, 82, 6, "#3a5a80", 'rx="2"') + path("M304 206 l6 10 M370 206 l-6 10", "none", 'stroke="#3a5a80" stroke-width="3" stroke-linecap="round"'); // A blue stone board.
    },

    "view-crystal-cavern": function () { // Looking into a great cavern: stalactites overhead, crystal spires on a ridge and a still glowing pool, with motes drifting down.
      const spire = function (x, base, h, w, fill) { // One tall crystal spire with a lit left facet.
        return path("M" + (x - w) + " " + base + " L" + (x - w) + " " + (base - h * .8) + " L" + x + " " + (base - h) + " L" + (x + w) + " " + (base - h * .8) + " L" + (x + w) + " " + base + " Z", fill) +
          path("M" + (x - w) + " " + base + " L" + (x - w) + " " + (base - h * .8) + " L" + x + " " + (base - h) + " L" + x + " " + base + " Z", "#ffffff", 'opacity=".3"');
      };
      let ceiling = "M0 0 H240 V12";
      [[204, 9, 30], [150, 12, 46], [110, 6, 18], [64, 10, 40], [20, 8, 26]].forEach(function (s) { ceiling += " L" + (s[0] + s[1]) + " 12 L" + s[0] + " " + (12 + s[2]) + " L" + (s[0] - s[1]) + " 12"; }); // Stalactites, right to left.
      return view(["#2e5f8a", "#9fd8ec"], ["#08142a", "#1d3350"], -30,
        hills(401, 96, 34, "#244a74") + path("M40 80 l3 -8 l3 8 Z M96 72 l3 -10 l3 10 Z M170 78 l2.5 -7 l2.5 7 Z", "#c9a8ff", 'opacity=".7"') + path(ceiling + " L0 12 Z", "#16294a"), // Far ridge with tiny crystals, under the cave roof.
        hills(402, 114, 10, "#183456") + spire(30, 114, 46, 7, "#9be8ff") + spire(50, 114, 28, 5, "#c9a8ff") + spire(120, 114, 58, 8, "#c9a8ff") + spire(140, 114, 32, 6, "#9be8ff") + spire(196, 114, 40, 7, "#9be8ff") + spire(214, 114, 24, 5, "#c9a8ff"),
        rect(0, 118, 240, 30, "#1a4470") + path("M10 124 h16 M60 130 h10 M118 122 h20 M176 128 h14 M214 124 h12", "none", 'stroke="#9be8ff" stroke-width="1" opacity=".55"') + // The pool and its glints.
          hills(403, 136, 8, "#122a48") + path("M70 128 l3 -9 l3 9 Z M160 130 l3 -11 l3 11 Z", "#9be8ff", 'class="lp-neon"') + path("M78 128 l2 -6 l2 6 Z M168 130 l2 -7 l2 7 Z", "#c9a8ff"),
        falling("snow", scatter(404, 12, function (roll, i) { return circle(round(roll(2, 118)), round(roll(0, 128)), round(roll(.8, 1.6)), i % 2 ? "#9be8ff" : "#e0d0ff", 'opacity=".85"'); })));
    },

    "frame-crystal-gem": function () { // The window is a cut gem: a ring of cyan and violet facets round a diamond-shaped opening, its tip set in rock.
      const hole = [[166, 98], [234, 98], [262, 138], [200, 226], [138, 138]], shades = ["#5a9ec8", "#9be8ff", "#7a5ab8", "#c9a8ff"];
      const out = function (p) { return round(200 + (p[0] - 200) * 1.17) + " " + round(150 + (p[1] - 150) * 1.17); }; // A point pushed out from the gem's middle.
      let facets = "", rim = "M";
      hole.forEach(function (p, i) { // Two facets along each edge of the opening.
        const next = hole[(i + 1) % hole.length];
        facets += path("M" + p[0] + " " + p[1] + " L" + next[0] + " " + next[1] + " L" + out(next) + " Z", shades[(i * 2) % 4]) + path("M" + p[0] + " " + p[1] + " L" + out(next) + " L" + out(p) + " Z", shades[(i * 2 + 1) % 4]);
        rim += (i ? " L" : "") + out(p);
      });
      return facets + path(rim + " Z", "none", 'stroke="#dff8ff" stroke-width="1.5" stroke-linejoin="round"') +
        path(CLIPS["frame-crystal-gem"], "none", 'stroke="#e6faff" stroke-width="2.5" stroke-linejoin="round" class="lp-neon"') +
        path("M166 98 L180 138 L200 98 L220 138 L234 98 M138 138 H262 M180 138 L200 226 L220 138", "none", 'stroke="#ffffff" stroke-width="1" opacity=".3"') + // Cut lines across the glass.
        path("M168 238 Q172 226 186 228 L200 236 L214 228 Q228 226 232 238 Q200 248 168 238 Z", "#2e4a6e") + path("M176 230 l3 -10 l3 10 Z M218 230 l3 -12 l3 12 Z", "#c9a8ff") + // A rocky cradle for the tip.
        [[166, 92], [234, 92], [268, 138], [132, 138]].map(function (s, i) { return path(star(s[0], s[1], 5), "#ffffff", 'class="lp-twinkle" style="animation-delay:' + i * .45 + 's"'); }).join("");
    },

    "curtain-crystal-drops": function () { // Strands of tiny crystal beads, long at the sides and short in the middle, each ending in a prism drop.
      let strings = "", beadsA = "", beadsB = "", dropsA = "", dropsB = "";
      for (let x = 128, i = 0; x <= 272; x += 12, i++) {
        const end = 104 + Math.pow(Math.abs(6 - i), 2) * 3.5;                                                           // Where this strand ends.
        strings += "M" + x + " 90 V" + end + " ";
        for (let y = 100, n = 0; y < end - 8; y += 12, n++) { const bead = "M" + x + " " + (y - 3) + " l2.4 3 l-2.4 3 l-2.4 -3 Z "; if ((n + i) % 2) beadsA += bead; else beadsB += bead; }
        const drop = "M" + x + " " + (end - 4) + " l4.5 6 l-4.5 12 l-4.5 -12 Z ";
        if (i % 2) dropsA += drop; else dropsB += drop;
      }
      return path(strings, "none", 'stroke="#bfe8ff" stroke-width=".8" opacity=".55"') + path(beadsA, "#9be8ff") + path(beadsB, "#c9a8ff") +
        path(dropsA, "#9be8ff", 'class="lp-neon"') + path(dropsB, "#c9a8ff", 'class="lp-twinkle"') +
        rect(120, 84, 160, 6, "#2e4a6e", 'rx="3"') + rect(120, 84, 160, 2, "#9be8ff", 'opacity=".5"') +                  // A rough blue stone rod.
        path("M112 87 l6 -9 l6 9 l-6 9 Z M276 87 l6 -9 l6 9 l-6 9 Z", "#9be8ff", 'class="lp-neon"');                      // Crystal finials.
    },

    "lamp-crystal-pillar": function () { // A tall humming crystal growing from a rock, lit from within, with two echo rings floating round it.
      const crystal = function (x, y, h, w, lean, fill) { // A pointed crystal rising from (x, y), with a pale lit facet.
        const sy = round(y - h * .78), tip = round(x + lean), sl = round(x - w + lean * .75), sr = round(x + w + lean * .75);
        return path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + sr + " " + sy + " L" + (x + w) + " " + y + " Z", fill) +
          path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + round(x + lean * .75) + " " + sy + " L" + x + " " + y + " Z", "#ffffff", 'opacity=".35"');
      };
      return oval(56, 300, 58, 62, "#c9a8ff", 'opacity=".1"') + oval(56, 316, 32, 44, "#9be8ff", 'opacity=".12"') + oval(56, 405, 30, 5, "#0e1a30") + // Glow and shadow.
        oval(56, 282, 30, 9, "none", 'stroke="#9be8ff" stroke-width="1.6" opacity=".45"') + oval(56, 270, 44, 13, "none", 'stroke="#9be8ff" stroke-width="1.2" opacity=".22"') + // The hum and its echo.
        crystal(36, 392, 54, 7, -12, "#c9a8ff") + crystal(77, 394, 40, 6, 12, "#c9a8ff") +
        path("M44 392 L42 296 L56 256 L70 296 L68 392 Z", "#9be8ff", 'opacity=".92" class="lp-neon"') + path("M44 392 L42 296 L56 256 L56 392 Z", "#e6faff", 'opacity=".5"') + line(56, 262, 56, 390, "#ffffff", 1, 'opacity=".5"') + // The main crystal.
        oval(56, 330, 6, 34, "#ffffff", 'opacity=".55" class="lp-twinkle"') +                                              // Its light, pulsing.
        path("M24 404 Q22 390 36 386 Q56 380 76 386 Q90 390 88 404 Z", "#2e4a6e") + path("M34 390 Q50 384 62 386", "none", 'stroke="#4a6a90" stroke-width="2" stroke-linecap="round"') + // The rock.
        [[22, 270, 4], [94, 300, 3.5], [86, 246, 3]].map(function (s, i) { return path(star(s[0], s[1], s[2]), "#e6faff", 'class="lp-twinkle" style="animation-delay:' + i * .5 + 's"'); }).join("");
    },

    "rug-crystal-echo": function () { // A round rug of rings, each ring doubled by a fainter echo, round an eight-point crystal star, with gems in a circle.
      const eight = function (outer, inner) { // An eight-pointed star as one polygon.
        let d = "";
        for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283 - 1.5708, r = i % 2 ? inner : outer; d += (i ? " L" : "M") + round(Math.cos(a) * r) + " " + round(Math.sin(a) * r); }
        return d + "Z";
      };
      let gemsA = "", gemsB = "";
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283, x = round(Math.cos(a) * 118), y = round(Math.sin(a) * 118), d = "M" + x + " " + (y - 22) + " L" + (x + 9) + " " + y + " L" + x + " " + (y + 22) + " L" + (x - 9) + " " + y + " Z "; if (i % 2) gemsA += d; else gemsB += d; }
      return group(circle(0, 0, 150, "#1a2f50") + circle(0, 0, 143, "none", 'stroke="#9be8ff" stroke-width="5"') + circle(0, 0, 133, "none", 'stroke="#9be8ff" stroke-width="2.5" opacity=".45"') + // A ring and its echo.
        path(gemsA, "#9be8ff") + path(gemsB, "#c9a8ff") +
        circle(0, 0, 100, "#27466b") + circle(0, 0, 96, "none", 'stroke="#c9a8ff" stroke-width="5"') + circle(0, 0, 86, "none", 'stroke="#c9a8ff" stroke-width="2.5" opacity=".45"') +
        circle(0, 0, 66, "#1d3350") + path(eight(60, 24), "#9be8ff") + path(eight(32, 13), "#c9a8ff") + circle(0, 0, 9, "#ffffff"),
        'transform="translate(200 440) scale(1 .27)"');
    },

    "bed-crystal-geode": function () { // Half a giant geode: rough rock outside, amethyst teeth round the rim and a soft lilac cushion in the hollow.
      const crystal = function (x, y, h, w, lean, fill) { // A pointed crystal rising from (x, y), with a pale lit facet.
        const sy = round(y - h * .78), tip = round(x + lean), sl = round(x - w + lean * .75), sr = round(x + w + lean * .75);
        return path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + sr + " " + sy + " L" + (x + w) + " " + y + " Z", fill) +
          path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + round(x + lean * .75) + " " + sy + " L" + x + " " + y + " Z", "#ffffff", 'opacity=".35"');
      };
      let teeth = "";
      for (let i = 0; i < 16; i++) { // Crystal points round the rim, pointing into the hollow.
        const a = i / 16 * 6.283, b = .16;
        teeth += "M" + round(340 + 48 * Math.cos(a - b)) + " " + round(433 + 12 * Math.sin(a - b)) + " L" + round(340 + 38 * Math.cos(a)) + " " + round(433 + 8 * Math.sin(a)) + " L" + round(340 + 48 * Math.cos(a + b)) + " " + round(433 + 12 * Math.sin(a + b)) + " Z ";
      }
      return oval(340, 468, 52, 6, "#c9a8ff", 'opacity=".25"') +                                                          // A violet glow beneath.
        crystal(304, 430, 34, 7, -8, "#c9a8ff") + crystal(319, 426, 22, 5, -3, "#9be8ff") + crystal(376, 430, 38, 7, 9, "#9be8ff") + crystal(361, 426, 22, 5, 4, "#c9a8ff") + // Crystals jutting up behind.
        path("M286 432 Q288 468 340 468 Q392 468 394 432 Z", "#4a5670") + path("M296 448 Q306 456 318 452 M336 460 Q350 464 362 458 M374 446 Q382 450 388 444", "none", 'stroke="#3a4660" stroke-width="2.5" stroke-linecap="round"') + // The rough shell.
        oval(340, 432, 54, 15, "#6a7690") + oval(340, 433, 48, 12, "#7a58c8") + path(teeth, "#c9a8ff") +                  // Rim, lining and teeth.
        oval(340, 436, 34, 7, "#e8dcff") + oval(340, 434, 24, 4.5, "#f6f0ff") + oval(314, 431, 10, 5, "#9be8ff") +          // Cushion and a little pillow.
        [[296, 408, 4], [384, 400, 3.5], [340, 418, 3]].map(function (s, i) { return path(star(s[0], s[1], s[2]), "#ffffff", 'class="lp-twinkle" style="animation-delay:' + i * .5 + 's"'); }).join("");
    },

    "door-crystal-grotto": function () { // A blue door in a rocky arch, with a glowing crystal window and crystals growing round the stone.
      const crystal = function (x, y, h, w, lean, fill) { // A pointed crystal rising from (x, y), with a pale lit facet.
        const sy = round(y - h * .78), tip = round(x + lean), sl = round(x - w + lean * .75), sr = round(x + w + lean * .75);
        return path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + sr + " " + sy + " L" + (x + w) + " " + y + " Z", fill) +
          path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + round(x + lean * .75) + " " + sy + " L" + x + " " + y + " Z", "#ffffff", 'opacity=".35"');
      };
      return oval(-25, 280, 50, 86, "#c9a8ff", 'opacity=".07"') +
        path("M-72 354 V258 Q-72 198 -25 194 Q22 198 22 258 V354 Z", "#2e4566") + path("M-68 300 q6 -4 10 2 M14 280 q4 -6 6 0 M-66 240 q4 -6 8 -2 M10 232 q4 -4 6 2", "none", 'stroke="#4a6a90" stroke-width="2" stroke-linecap="round"') + // The rock arch.
        path("M-60 354 V260 Q-60 210 -25 206 Q10 210 10 260 V354 Z", "#1f3a60") + path("M-42 214 V354 M-25 206 V354 M-8 214 V354", "none", 'stroke="#173050" stroke-width="2"') + // The door's boards.
        rect(-60, 300, 70, 5, "#3a5a80") + rect(-60, 336, 70, 5, "#3a5a80") +                                             // Stone bands.
        oval(-25, 240, 18, 24, "#c9a8ff", 'opacity=".2"') + path("M-25 218 L-12 240 L-25 262 L-38 240 Z", "#c9a8ff", 'stroke="#9be8ff" stroke-width="2.5" class="lp-twinkle"') + path("M-25 218 V262 M-38 240 H-12", "none", 'stroke="#ffffff" stroke-width="1" opacity=".5"') + // The crystal window.
        path("M1 286 l4 6 l-4 6 l-4 -6 Z", "#9be8ff", 'class="lp-neon"') +                                                // A gem for a handle.
        crystal(-66, 354, 26, 6, -8, "#9be8ff") + crystal(-56, 354, 16, 4, 3, "#c9a8ff") + crystal(16, 354, 30, 6, 8, "#c9a8ff") + crystal(6, 354, 14, 4, -3, "#9be8ff") + // Crystals at its feet.
        crystal(-36, 200, 12, 3, -5, "#9be8ff") + crystal(-25, 198, 16, 4, 0, "#c9a8ff") + crystal(-14, 200, 12, 3, 5, "#9be8ff"); // And a crown on the arch.
    },

    "hang-crystal-stalactites": function () { // A rock ledge with four stalactites tipped in glowing crystal, a drip about to fall, and a tiny bat asleep upside down.
      const bat = "#4a3a70";
      return path("M284 0 H384 V8 Q376 16 366 10 Q356 16 346 11 Q334 18 322 11 Q310 16 300 10 Q290 14 284 8 Z", "#2e4a6e") + // The ledge.
        [[296, 10, 56, 9, "#9be8ff"], [318, 12, 86, 10, "#c9a8ff"], [362, 10, 48, 8, "#c9a8ff"], [378, 9, 70, 6, "#9be8ff"]].map(function (s, i) { // Each stalactite and its crystal tip.
          const x = s[0], top = s[1], end = s[1] + s[2], hw = s[3];
          return path("M" + (x - hw) + " " + top + " Q" + round(x - hw * .4) + " " + round(top + s[2] * .6) + " " + x + " " + end + " Q" + round(x + hw * .4) + " " + round(top + s[2] * .6) + " " + (x + hw) + " " + top + " Z", "#3a5a80") +
            path("M" + (x - hw) + " " + top + " Q" + round(x - hw * .4) + " " + round(top + s[2] * .6) + " " + x + " " + end + " L" + x + " " + top + " Z", "#4f74a0") +
            oval(x, end + 2, 10, 12, s[4], 'opacity=".15"') + path("M" + x + " " + (end - 10) + " L" + (x + 5) + " " + end + " L" + x + " " + (end + 12) + " L" + (x - 5) + " " + end + " Z", s[4], i % 2 ? 'class="lp-twinkle"' : 'class="lp-neon"');
        }).join("") +
        path("M318 112 Q322 119 318 123 Q314 119 318 112 Z", "#9be8ff", 'class="lp-twinkle" style="animation-delay:.6s"') + // A drip.
        path("M337 12 V17 M343 12 V17", "none", 'stroke="' + bat + '" stroke-width="1.5" stroke-linecap="round"') + // The bat's feet on the ledge.
        path("M340 16 Q328 20 330 34 Q334 42 340 42 Q346 42 350 34 Q352 20 340 16 Z", "#3a2c5c") + oval(340, 28, 6, 10, bat) + // Wings folded round its body.
        circle(340, 42, 6, bat) + path("M335 46 L333 53 L338 48 Z M345 46 L347 53 L342 48 Z", bat) +                      // Head, ears pointing down.
        path("M336.5 41 q1.5 -1.2 3 0 M340.5 41 q1.5 -1.2 3 0", "none", 'stroke="#e6d8ff" stroke-width=".9" stroke-linecap="round"') + circle(335, 44, 1.4, "#ffb3d1", 'opacity=".7"') + circle(345, 44, 1.4, "#ffb3d1", 'opacity=".7"');
    },

    "table-crystal-orb": function () { // A blue stone pedestal table holding a crystal ball with a violet swirl inside, ringed by its own echo.
      return oval(334, 300, 34, 30, "#c9a8ff", 'opacity=".12"') +
        circle(334, 300, 25, "none", 'stroke="#9be8ff" stroke-width="1.4" opacity=".35"') + circle(334, 300, 31, "none", 'stroke="#9be8ff" stroke-width="1.1" opacity=".18"') + // Hum and echo.
        path("M318 362 L322 352 H350 L354 362 Z", "#2e4a6e") + rect(328, 334, 16, 18, "#3a5a80") + rect(330, 334, 4, 18, "#4f74a0") + // Foot and column.
        rect(306, 326, 60, 8, "#3a5a80", 'rx="2"') + rect(306, 326, 60, 2, "#9be8ff", 'opacity=".5"') +                 // The slab.
        path("M322 326 L326 314 H342 L346 326 Z", "#c9a15a") + path("M326 316 Q322 312 324 308 M342 316 Q346 312 344 308", "none", 'stroke="#c9a15a" stroke-width="2" stroke-linecap="round"') + // Gold stand with claws.
        circle(334, 300, 17, "#1d3350") + circle(334, 300, 17, "#9be8ff", 'opacity=".3" stroke="#dff8ff" stroke-width="1.2"') + // The ball.
        path("M324 304 Q330 290 340 296 Q346 302 336 307 Q328 309 331 302", "none", 'stroke="#c9a8ff" stroke-width="2.5" stroke-linecap="round" class="lp-twinkle"') + path(star(338, 298, 3), "#ffffff") +
        path("M324 292 Q328 286 334 285", "none", 'stroke="#ffffff" stroke-width="2" opacity=".6" stroke-linecap="round"') +
        path("M355 326 L357 314 L360 308 L363 314 L365 326 Z", "#c9a8ff") + path("M355 326 L357 314 L360 308 V326 Z", "#ffffff", 'opacity=".35"'); // A little crystal on the slab.
    },

    "plant-crystal-bloom": function () { // Crystal flowers on teal stems in a faceted stone pot: gem petals that twinkle and crystal-shard leaves.
      const flower = function (cx, cy) { // Five pointed gem petals round a centre, as one path.
        let d = "";
        for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283 - 1.5708; d += "M" + cx + " " + cy + " L" + round(cx + 6 * Math.cos(a - .4)) + " " + round(cy + 6 * Math.sin(a - .4)) + " L" + round(cx + 12 * Math.cos(a)) + " " + round(cy + 12 * Math.sin(a)) + " L" + round(cx + 6 * Math.cos(a + .4)) + " " + round(cy + 6 * Math.sin(a + .4)) + " Z "; }
        return d;
      };
      const heads = [[4, 312, "#9be8ff"], [20, 294, "#c9a8ff"], [34, 318, "#9be8ff"]];
      return heads.map(function (h) { return oval(h[0], h[1], 16, 16, h[2], 'opacity=".14"'); }).join("") +           // Glows.
        path("M18 368 Q16 336 4 312 M18 368 Q20 330 20 294 M18 368 Q24 340 34 318", "none", 'stroke="#5fbfa8" stroke-width="2.5" stroke-linecap="round"') + // Stems.
        path("M12 348 L2 340 L-4 346 L6 352 Z M24 344 L34 334 L40 340 L30 350 Z M19 322 L28 314 L32 320 L22 326 Z", "#7fd6c8") + // Crystal-shard leaves.
        heads.map(function (h, i) { return path(flower(h[0], h[1]), h[2], 'class="lp-twinkle" style="animation-delay:' + i * .5 + 's"') + circle(h[0], h[1], 3, "#ffffff"); }).join("") +
        path("M2 370 H34 L30 392 H6 Z", "#2e4a6e") + path("M0 366 H36 L34 372 H2 Z", "#9be8ff", 'opacity=".8"') + path("M12 372 L10 392 M24 372 L26 392", "none", 'stroke="#4a6a90" stroke-width="1.5"'); // The faceted pot.
    },

    "chest-crystal-minecart": function () { // A little mine cart on rails, heaped with cyan and violet crystals, a bouncy ball and a star wand.
      const crystal = function (x, y, h, w, lean, fill) { // A pointed crystal rising from (x, y), with a pale lit facet.
        const sy = round(y - h * .78), tip = round(x + lean), sl = round(x - w + lean * .75), sr = round(x + w + lean * .75);
        return path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + sr + " " + sy + " L" + (x + w) + " " + y + " Z", fill) +
          path("M" + (x - w) + " " + y + " L" + sl + " " + sy + " L" + tip + " " + (y - h) + " L" + round(x + lean * .75) + " " + sy + " L" + x + " " + y + " Z", "#ffffff", 'opacity=".35"');
      };
      return path("M50 478 H134", "none", 'stroke="#6a7a90" stroke-width="2.5"') + path("M60 476 v5 M82 476 v5 M104 476 v5 M126 476 v5", "none", 'stroke="#4a3424" stroke-width="3"') + // Rails and sleepers.
        oval(92, 432, 38, 18, "#9be8ff", 'opacity=".14"') +
        line(60, 442, 64, 418, "#ffdc83", 2) + path(star(64, 416, 7), "#ffdc83", 'class="lp-twinkle"') +                // A star wand.
        crystal(72, 442, 26, 6, -6, "#c9a8ff") + crystal(90, 442, 34, 7, 2, "#9be8ff") + crystal(105, 442, 22, 5, 6, "#c9a8ff") + // The heap of crystals.
        circle(117, 436, 8, "#ff8ecb") + path("M110 433 Q117 438 124 433", "none", 'stroke="#ffffff" stroke-width="2" opacity=".8"') + // A bouncy ball.
        path("M56 440 H128 L122 468 H62 Z", "#4a5670") + rect(54, 437, 76, 5, "#6a7690", 'rx="2"') +                    // The cart.
        path("M76 443 L78 467 M108 443 L106 467", "none", 'stroke="#3a4660" stroke-width="3"') + [[70, 448], [114, 448], [72, 460], [112, 460]].map(function (r) { return circle(r[0], r[1], 1.4, "#8a9ab8"); }).join("") + // Bands and rivets.
        path("M92 446 L98 454 L92 462 L86 454 Z", "#9be8ff", 'class="lp-neon"') +                                         // A crystal badge.
        circle(74, 470, 7, "#2a3040") + circle(74, 470, 3, "#8a9ab8") + circle(110, 470, 7, "#2a3040") + circle(110, 470, 3, "#8a9ab8"); // Wheels.
    },

    // Mushroom Hollow set
    // Found in the dungeon's Mushroom Hollow: deep moss greens, coral toadstool caps with cream spots, and mint-glowing spores.

    "wall-mushroom-hollow": function () { // A mossy hollow at dusk: tall shadowy toadstools behind, small coral ones on the moss bank in front, and pale spores drifting like slow snow.
      function dot(x, y, r) { return "M" + round(x - r) + " " + round(y) + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; } // One round spot, as a piece of a path.
      function toadstool(x, base, h, cap, stalk, top, spot) { // A toadstool standing on y = base: stalk, the gills under its cap, the cap, then its spots as one shape.
        const y = base - h, w = round(cap * .24);
        const spots = dot(x - cap * .5, y - cap * .42, round(cap * .14)) + dot(x + cap * .12, y - cap * .66, round(cap * .12)) + dot(x + cap * .56, y - cap * .3, round(cap * .1));
        return path("M" + round(x - w) + " " + base + " Q" + round(x - w * .4) + " " + round(y + h * .5) + " " + round(x - w * .6) + " " + y + " H" + round(x + w * .6) + " Q" + round(x + w * .4) + " " + round(y + h * .5) + " " + round(x + w) + " " + base + " Z", stalk) +
          path("M" + (x - cap) + " " + y + " Q" + x + " " + round(y + cap * .3) + " " + (x + cap) + " " + y + " Z", stalk, 'opacity=".75"') +     // The gills, a pale lens under the cap.
          path("M" + (x - cap) + " " + y + " C" + (x - cap) + " " + round(y - cap * 1.1) + " " + (x + cap) + " " + round(y - cap * 1.1) + " " + (x + cap) + " " + y + " Q" + x + " " + round(y + cap * .12) + " " + (x - cap) + " " + y + " Z", top) +
          path(spots, spot);
      }
      const spores = scatter(61, 34, function (roll) { return dot(roll(6, 394), roll(6, 330), round(roll(.8, 1.8))); });
      const bright = scatter(62, 10, function (roll) { return dot(roll(10, 390), roll(20, 300), 2); });
      return rect(0, 0, 400, 352, "#243d33") +
        path("M0 0 H400 V26 Q350 46 300 26 T200 26 T100 26 T0 26 Z", "#1c3229") +                                   // Dark moss hanging over the top of the hollow; its ends meet at the join.
        rect(0, 180, 400, 172, "#2a473b", 'opacity=".6"') +                                                         // A soft mist lying low.
        toadstool(62, 330, 222, 46, "#2f4d40", "#5a3c46", "#6f5560") + toadstool(204, 330, 262, 54, "#2f4d40", "#5a3c46", "#6f5560") + toadstool(334, 330, 196, 44, "#2f4d40", "#5a3c46", "#6f5560") + // Giants in the shade.
        path(spores, "#8be9a8", 'opacity=".35"') +
        path("M0 318 Q50 302 100 318 T200 318 T300 318 T400 318 V352 H0 Z", "#2f5242") +                              // The mossy bank.
        path("M0 334 Q66 322 133 334 T266 334 T400 334 V352 H0 Z", "#3a6650") +
        toadstool(130, 336, 70, 22, "#8fa898", "#a8545c", "#d8c4b8") + toadstool(266, 338, 84, 26, "#8fa898", "#a8545c", "#d8c4b8") + // Smaller, softer ones in front, so furniture still stands out.
        toadstool(26, 340, 40, 13, "#8fa898", "#a04e56", "#d8c4b8") + toadstool(380, 342, 34, 11, "#8fa898", "#a04e56", "#d8c4b8") +
        toadstool(196, 344, 24, 9, "#a8d8b4", "#6cc48c", "#c8f0d4") +                                               // One small glowcap.
        path(scatter(63, 40, function (roll) { return dot(roll(4, 396), roll(322, 348), round(roll(1.4, 2.6))); }), "#4f8a68") + // Moss tufts along the bank.
        path(bright, "#c8f5d4", 'class="lp-twinkle"');                                                             // A few spores catching the light.
    },

    "floor-mushroom-moss": function () { // A soft floor of moss in rolling banks, scattered with pebbles, tiny toadstools and fallen spores that still glow.
      function dot(x, y, r) { return "M" + round(x - r) + " " + round(y) + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; }
      function bank(y, a, b, colour) { // A lumpy bank of moss; four pairs of bumps add up to 400, so each bank meets itself at the join.
        let d = "M0 " + y;
        for (let i = 0; i < 4; i++) d += " a" + a / 2 + " " + round(a * .28) + " 0 0 1 " + a + " 0 a" + b / 2 + " " + round(b * .28) + " 0 0 1 " + b + " 0";
        return path(d + " V500 H0 Z", colour);
      }
      const stools = [[60, 372, 5], [148, 404, 6], [254, 382, 4.5], [330, 432, 6], [96, 462, 5.5], [214, 476, 4]];
      return rect(0, 350, 400, 150, "#2f5242") +
        bank(380, 60, 40, "#335948") + bank(410, 46, 54, "#386150") + bank(442, 64, 36, "#3d6955") + bank(474, 42, 58, "#42705a") +
        path(scatter(71, 60, function (roll) { return dot(roll(4, 396), roll(356, 496), round(roll(.8, 1.6))); }), "#284636") + // Dark speckles in the moss.
        path(scatter(72, 40, function (roll) { return dot(roll(4, 396), roll(360, 496), round(roll(.8, 1.4))); }), "#6aa884", 'opacity=".7"') + // Light tips.
        [[34, 420, 8], [182, 444, 10], [302, 400, 7], [372, 470, 9]].map(function (p) { return oval(p[0], p[1], p[2], round(p[2] * .55), "#6a7c70") + oval(p[0] - 2, p[1] - 2, round(p[2] * .5), round(p[2] * .25), "#9aaca0"); }).join("") + // Pebbles, each with a top-light.
        stools.map(function (s) { const x = s[0], y = s[1], c = s[2]; return rect(round(x - c * .25), y - c, round(c * .5), c, "#f4e8d4") + path("M" + (x - c) + " " + (y - c) + " Q" + x + " " + round(y - c * 2.4) + " " + (x + c) + " " + (y - c) + " Z", "#ff8e8e"); }).join("") + // Tiny toadstools.
        path(scatter(73, 14, function (roll) { return dot(roll(10, 390), roll(362, 492), 1.6); }), "#8be9a8", 'class="lp-twinkle"') + // Fallen spores, still glowing.
        rect(0, 350, 400, 3, "#8be9a8", 'opacity=".4"');
    },

    "art-mushroom-spore": function () { // A spore print in a twiggy frame: a coral toadstool's gills left a sunburst on cream paper. Moss tops the frame and two tiny toadstools grow from its corner.
      let gills = "";
      for (let i = 0; i < 36; i++) { // Thirty-six gill lines fanning out from the stalk's mark, long and short in turn.
        const a = i * Math.PI / 18, r = i % 2 ? 21 : 25;
        gills += "M" + round(68 + 7 * Math.cos(a)) + " " + round(186 + 7 * Math.sin(a)) + " L" + round(68 + r * Math.cos(a)) + " " + round(186 + r * Math.sin(a)) + " ";
      }
      return rect(34, 150, 68, 80, "#5a3f2a", 'rx="4"') + path("M37 160 V222 M99 158 V224 M44 153 H92 M44 227 H90", "none", 'stroke="#3f2a1a" stroke-width="1.5" stroke-linecap="round"') + // The twig frame and its grain.
        rect(40, 156, 56, 68, "#f4ead6") + circle(68, 186, 27, "#ffcfc4", 'opacity=".45"') +
        path(gills, "none", 'stroke="#b4646a" stroke-width="1.6" stroke-linecap="round" opacity=".85"') + circle(68, 186, 5, "#d98a8a", 'opacity=".6"') +
        path("M48 216 H78 M50 220 H70", "none", 'stroke="#b8a888" stroke-width="1.2"') +                                          // A little pencilled label.
        path("M32 154 q4 -8 10 -4 q4 -7 11 -2 q5 -6 11 0 q5 -5 10 0 q6 -6 11 -1 q5 -5 11 1 q4 -3 6 4 V158 H32 Z", "#4f8a68") +           // Moss along the top.
        path("M40 152 q2 -4 6 -2 M58 151 q3 -4 7 -1 M78 151 q3 -4 6 -1", "none", 'stroke="#8be9a8" stroke-width="1.2" opacity=".7"') +
        rect(97, 220, 3, 9, "#fff1e0") + path("M93 221 Q98.5 211 104 221 Z", "#ff8e8e") + rect(104, 224, 2.4, 6, "#fff1e0") + path("M101 225 Q105 218 109 225 Z", "#8be9a8", 'class="lp-neon"') + // Two tiny toadstools on the corner.
        circle(99, 216, 1, "#fff") + [[30, 196, 0], [108, 176, .7], [86, 146, 1.4]].map(function (s) { return circle(s[0], s[1], 1.6, "#8be9a8", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "shelf-mushroom-bracket": function () { // A big bracket fungus grows out of the wall as the shelf, with three tiny toadstools, a puffball breathing glowing spores and a sleepy snail on top.
      return path("M292 201 Q292 224 338 226 Q384 224 384 201 Z", "#c9806a") + path("M296 208 Q338 220 380 208 M302 215 Q338 225 374 215", "none", 'stroke="#ff8e8e" stroke-width="2" opacity=".8"') + // The fungus underside and its growth bands.
        oval(338, 201, 46, 5, "#f4dcc0") + path("M300 203 Q338 208 376 203", "none", 'stroke="#e6c2a0" stroke-width="1.2"') +                               // Its flat top.
        rect(302, 186, 3, 14, "#fff1e0") + path("M296 188 Q303.5 174 311 188 Z", "#ff8e8e") + rect(312, 191, 3, 9, "#fff1e0") + path("M307 193 Q313.5 182 320 193 Z", "#ff8e8e") + // Toadstools, tall and small...
        rect(319, 193, 2.4, 7, "#fff1e0") + path("M315.5 195 Q320 187 324.5 195 Z", "#8be9a8", 'class="lp-neon"') + circle(301, 183, 1.4, "#fff") + circle(306, 185, 1, "#fff") + circle(311, 189, 1, "#fff") + // ...and one glowing.
        circle(340, 190, 10, "#efe6d2") + circle(337, 186, 3, "#fff", 'opacity=".6"') + path("M334 194 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0Z M342 191 a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0Z M345 196 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0Z", "#d8ccb0") + // The puffball.
        [[339, 174, 1.8, 0], [344, 166, 1.5, .5], [337, 158, 1.2, 1], [343, 151, 1, 1.5]].map(function (s) { return circle(s[0], s[1], s[2], "#8be9a8", 'class="lp-twinkle" style="animation-delay:' + s[3] + 's"'); }).join("") + // Spores puffing up.
        path("M354 200 Q354 192 362 192 H378 Q382 194 378 200 Z", "#c8dcb4") + path("M378 196 L380 186 M374 195 L375 187", "none", 'stroke="#c8dcb4" stroke-width="1.6" stroke-linecap="round"') + // The snail's body and eye stalks.
        circle(366, 188, 9, "#ff8e8e") + path("M366 188 m0 -5 a5 5 0 1 1 -5 5 a3.4 3.4 0 1 0 3.4 -3.4 a1.8 1.8 0 1 1 1.6 1.6", "none", 'stroke="#c85a64" stroke-width="1.5"') + // Its spiral shell.
        path("M376.5 192 q1.5 1 3 0", "none", 'stroke="#3a4a3a" stroke-width="1" stroke-linecap="round"') + path("M384 180 h4 l-4 4 h4", "none", 'stroke="#8be9a8" stroke-width="1.2" stroke-linejoin="round" opacity=".8"'); // A sleepy eye and a little "z".
    },

    "view-mushroom-grove": function () { // A misty toadstool grove: giant caps fading into the haze, coral toadstools on mossy hills, glowcaps in the near moss, and spores drifting down.
      function stools(list, stalk, cap, spot, more) { // Toadstools [x, base, height, cap half-width] as three shapes in all: stalks, caps and spots.
        let s = "", c = "", d = "";
        list.forEach(function (t) {
          const x = t[0], base = t[1], y = base - t[2], k = t[3], w = round(k * .22), r = round(k * .15);
          s += "M" + round(x - w) + " " + base + " L" + round(x - w * .7) + " " + y + " H" + round(x + w * .7) + " L" + round(x + w) + " " + base + " Z ";
          c += "M" + (x - k) + " " + y + " C" + (x - k) + " " + round(y - k * 1.1) + " " + (x + k) + " " + round(y - k * 1.1) + " " + (x + k) + " " + y + " Q" + x + " " + round(y + k * .15) + " " + (x - k) + " " + y + " Z ";
          d += "M" + round(x - k * .45 - r) + " " + round(y - k * .38) + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z ";
          d += "M" + round(x + k * .22 - r) + " " + round(y - k * .6) + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z ";
        });
        return path(s, stalk) + path(c, cap, more || "") + (spot ? path(d, spot) : "");
      }
      const ferns = [30, 104, 186].map(function (x) { return "M" + x + " 126 q-2 -10 -10 -14 M" + x + " 126 q1 -12 6 -16 M" + x + " 126 q4 -8 12 -9"; }).join(" ");
      return view(["#86c2a6", "#f2e9cc"], ["#0b1a17", "#1d3a32"], 28,
        hills(141, 96, 20, "#a9d2bc") + stools([[40, 98, 52, 20], [150, 96, 66, 26], [214, 98, 40, 15]], "#c4e0d0", "#d8aeb0", "#e8d4d4"), // Giants in the haze.
        hills(142, 110, 16, "#5f9a7a") + stools([[24, 112, 26, 12], [96, 110, 34, 15], [176, 112, 24, 11]], "#f0e6d4", "#e8767a", "#fff1e0"),
        waves(122, "#2f5242", 3) + path(ferns, "none", 'stroke="#4f8a68" stroke-width="2.4" stroke-linecap="round"') +
          stools([[52, 126, 10, 6], [64, 127, 6, 4], [150, 126, 12, 7], [216, 127, 8, 5]], "#e6f5e8", "#8be9a8", "", 'class="lp-neon"'),
        falling("snow", scatter(144, 18, function (roll) { return circle(round(roll(0, 120)), round(roll(0, 130)), round(roll(.8, 1.6)), "#c8f5d4", 'opacity=".9"'); })));
    },

    "frame-mushroom-cap": function () { // The window is a toadstool-shaped hole: a spotted coral cap arches over the top, a pale stalk frames the lower half, and moss with tiny glowcaps grows along the sill.
      const dome = "M140 152 Q140 96 200 96 Q260 96 260 152 Q248 160 234 156 H166 Q152 160 140 152 Z";                                   // The top part of the opening.
      const cap = "M124 160 C122 112 156 82 200 82 C244 82 278 112 276 160 Q262 168 248 162 L234 156 H166 L152 162 Q138 168 124 160 Z"; // The cap's outline.
      return path("M156 150 V232 H244 V150 Z M166 154 V226 H234 V154 Z", "#f4e8d4", 'fill-rule="evenodd"') + path("M160.5 162 V228 M239.5 162 V228", "none", 'stroke="#d8c8b0" stroke-width="2"') + // The stalk around the lower half.
        path(cap + " " + dome, "#ff8e8e", 'fill-rule="evenodd"') + path("M152 162 Q138 168 124 160 C122 112 156 82 200 82 C244 82 278 112 276 160 Q262 168 248 162", "none", 'stroke="#c85a64" stroke-width="2" stroke-linejoin="round"') +  // The cap, a ring around the dome.
        path("M127 162 Q140 168 151 163 M249 163 Q260 168 273 162", "none", 'stroke="#f4e8d4" stroke-width="2.5" stroke-linecap="round"') +          // Pale gills peeping out under the brim.
        path("M131 128 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0Z M155 100 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0Z M196 89 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0Z M236 100 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0Z M259 128 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0Z M127 152 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z M267 152 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z", "#fff1e0") + // Cream spots.
        path("M144 226 H256 V233 Q200 240 144 233 Z", "#3f7a5a") + path("M146 227 q4 -6 8 0 q4 -5 8 0 M238 227 q4 -6 8 0 q4 -5 8 0 M190 227 q5 -5 10 0 q5 -5 10 0", "#4f8a68") + // The mossy sill.
        rect(152, 218, 2.6, 9, "#e6f5e8") + path("M148 220 Q153.3 210 158.6 220 Z", "#8be9a8", 'class="lp-neon"') + rect(245, 220, 2.4, 7, "#e6f5e8") + path("M242 222 Q246.2 214 250.4 222 Z", "#8be9a8", 'class="lp-neon"') + // Two glowcaps.
        [[128, 98, 0], [272, 102, .8], [200, 74, 1.5]].map(function (s) { return circle(s[0], s[1], 1.8, "#8be9a8", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "curtain-mushroom-moss": function () { // Long beards of hanging moss draped from a knobbly branch, beaded with glowing spore drops, with little toadstools sprouting along the branch.
      function drape(flip) { // One side, drawn on the left and mirrored for the right.
        return group(
          path("M120 88 H166 Q156 120 160 148 Q150 154 154 170 L146 166 L148 188 L140 180 L139 206 L133 194 L129 226 L124 210 L120 232 Z", "#3f7a5a") +   // A ragged beard of moss.
          path("M127 92 Q125 160 126 222 M137 92 Q135 140 138 196 M148 92 Q146 130 148 182 M158 92 Q152 120 155 160", "none", 'stroke="#2f5a45" stroke-width="2"') + // Its strands.
          path("M131 96 Q129 140 132 180 M152 94 Q150 116 152 140", "none", 'stroke="#7fc49a" stroke-width="1.3" opacity=".7"') +
          [[146, 168], [141, 184], [134, 198], [125, 214], [121, 234]].map(function (p, i) { return circle(p[0], p[1] + 3, 2.4, "#8be9a8", 'class="lp-twinkle" style="animation-delay:' + i * .4 + 's"'); }).join(""), // Spore drops on the tips.
          flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      }
      return drape(false) + drape(true) +
        path("M172 88 q3 8 6 2 q3 9 6 1 q3 7 6 0 M216 88 q3 7 6 0 q3 9 6 -1 q3 8 6 -2", "none", 'stroke="#3f7a5a" stroke-width="3" stroke-linecap="round"') + // Short tufts across the middle, so the view stays clear.
        path("M114 87 Q156 81 200 86 T286 85", "none", 'stroke="#6b4a2f" stroke-width="6" stroke-linecap="round"') + path("M150 83 l-4 -7 M244 84 l5 -6", "none", 'stroke="#6b4a2f" stroke-width="3" stroke-linecap="round"') + // The branch and two twigs.
        rect(173, 76, 3, 8, "#fff1e0") + path("M168 78 Q174.5 66 181 78 Z", "#ff8e8e") + circle(172, 74, 1.2, "#fff") + circle(177, 72, 1, "#fff") +                // Toadstools on the branch.
        rect(204, 77, 2.6, 7, "#fff1e0") + path("M200 79 Q205.3 70 210.6 79 Z", "#8be9a8", 'class="lp-neon"') +
        rect(262, 75, 3, 8, "#fff1e0") + path("M257 77 Q263.5 65 270 77 Z", "#ff8e8e") + circle(261, 73, 1.2, "#fff") + circle(266, 71, 1, "#fff");
    },

    "lamp-mushroom-glowcap": function () { // A tall toadstool lamp: a spotted coral cap glowing mint from its gills, a slender stalk with a frilly ring, and baby mushrooms in the moss at its foot.
      return oval(56, 282, 62, 62, "#8be9a8", 'opacity=".1"') + path("M28 270 L14 380 H98 L84 270 Z", "#8be9a8", 'opacity=".06"') +          // The glow, and a soft fall of light.
        oval(56, 405, 34, 5, "#1a2e26") + path("M20 404 Q22 392 36 394 Q44 384 56 390 Q68 384 78 393 Q92 392 92 404 Z", "#3f7a5a") +        // The moss at its foot.
        path("M48 396 Q53 330 50 268 H62 Q59 330 66 396 Z", "#fff1e0") + path("M60 390 Q57 330 59 272", "none", 'stroke="#e6d4bc" stroke-width="2"') + // The stalk and its shade.
        path("M43 308 Q56 318 69 308 L67 300 Q56 309 45 300 Z", "#f0dcc4") +                                                                 // A frilly ring.
        oval(56, 266, 35, 7, "#8be9a8", 'class="lp-neon"') + path("M28 266 L40 270 M38 265 L46 271 M48 264 L52 272 M64 264 L60 272 M74 265 L66 271 M84 266 L72 270", "none", 'stroke="#4fc07a" stroke-width="1.2"') + // Glowing gills.
        path("M18 266 C16 218 96 218 94 266 Q56 274 18 266 Z", "#ff8e8e") + path("M28 250 Q32 234 48 230", "none", 'stroke="#ffc4c4" stroke-width="3" stroke-linecap="round" opacity=".7"') + // The cap and its shine.
        path("M30 254 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0Z M50 238 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0Z M70 250 a5.5 5.5 0 1 0 11 0 a5.5 5.5 0 1 0 -11 0Z M60 258 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0Z M80 238 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0Z", "#fff1e0") + // Cream spots.
        rect(30, 390, 3, 9, "#fff1e0") + path("M25 392 Q31.5 380 38 392 Z", "#ff8e8e") + rect(81, 392, 2.6, 8, "#fff1e0") + path("M77 394 Q82.3 384 87.6 394 Z", "#8be9a8", 'class="lp-neon"') + // Baby mushrooms.
        [[30, 300, 0], [88, 312, .6], [42, 340, 1.2], [78, 352, 1.8], [24, 228, .9]].map(function (s) { return circle(s[0], s[1], 1.8, "#c8f5d4", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join(""); // Spores drifting about.
    },

    "rug-mushroom-ring": function () { // A fairy ring: a round rug of soft moss with a paler middle, ringed by little coral and glowing toadstools.
      const tufts = scatter(81, 30, function (roll) { const a = roll(0, 6.28), r = roll(10, 128), s = round(roll(3, 6)); return "M" + round(Math.cos(a) * r - s) + " " + round(Math.sin(a) * r) + " a" + s + " " + s + " 0 1 0 " + s * 2 + " 0 a" + s + " " + s + " 0 1 0 -" + s * 2 + " 0Z "; });
      const flat = circle(0, 0, 152, "#2a4a3b") + circle(0, 0, 142, "#3d6955") + path(tufts, "#4f8a68") + circle(0, 0, 92, "#4a7d62", 'opacity=".8"') + circle(0, 0, 50, "#5a9474", 'opacity=".7"') +
        circle(0, 0, 118, "none", 'stroke="#8be9a8" stroke-width="3" opacity=".35" stroke-dasharray="3 12"');                                 // A faint ring of glow where the toadstools stand.
      let ring = "";
      for (let i = 0; i < 14; i++) { // Little toadstools standing up all round the ring: every third one glows.
        const a = (i + .5) / 14 * Math.PI * 2, x = round(200 + 122 * Math.cos(a)), y = round(440 + 122 * .27 * Math.sin(a)), s = y > 440 ? 1.2 : .9, glow = i % 3 === 1;
        ring += rect(round(x - 1.8 * s), round(y - 8 * s), round(3.6 * s), round(8 * s), "#f4e8d4") +
          path("M" + round(x - 7 * s) + " " + round(y - 7 * s) + " Q" + x + " " + round(y - 20 * s) + " " + round(x + 7 * s) + " " + round(y - 7 * s) + " Z", glow ? "#8be9a8" : "#ff8e8e", glow ? 'class="lp-neon"' : "") +
          (glow ? "" : circle(round(x - 2 * s), round(y - 11 * s), round(1.4 * s), "#fff"));
      }
      return group(flat, 'transform="translate(200 440) scale(1 .27)"') + ring +
        [[150, 432, 0], [246, 446, .7], [204, 426, 1.4]].map(function (s) { return circle(s[0], s[1], 1.8, "#c8f5d4", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "bed-mushroom-moss": function () { // A plump moss cushion under its own toadstool: the coral cap leans over like a canopy, its gills glowing softly, with a puffball for a pillow.
      return oval(340, 458, 56, 6, "#00000044") +
        path("M370 446 Q378 418 366 390 H382 Q392 418 386 446 Z", "#f4e8d4") + path("M380 440 Q384 418 376 394", "none", 'stroke="#d8c8b0" stroke-width="2"') + // The toadstool's stalk, at the back.
        path("M300 388 Q346 400 394 380 Q350 414 300 388 Z", "#8be9a8", 'opacity=".8" class="lp-neon"') +                                    // Glowing gills under the cap.
        path("M300 388 C302 356 390 350 394 380 Q346 398 300 388 Z", "#ff8e8e") + path("M314 374 Q322 362 340 360", "none", 'stroke="#ffc4c4" stroke-width="3" stroke-linecap="round" opacity=".7"') + // The cap and its shine.
        path("M318 378 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0Z M340 367 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0Z M362 374 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0Z M378 364 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0Z M302 382 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z", "#fff1e0") +
        path("M288 452 Q286 428 304 424 Q314 412 332 418 Q350 410 364 420 Q386 420 392 452 Z", "#4f8a68") + path("M288 446 Q340 458 392 446 V452 Q340 464 288 452 Z", "#3a6650") + // The moss cushion.
        oval(342, 432, 32, 7, "#3d6955") + path("M300 430 q4 -5 8 0 M354 420 q4 -5 8 0 M376 430 q4 -5 8 0 M322 442 q4 -5 8 0", "none", 'stroke="#7fc49a" stroke-width="1.6" stroke-linecap="round"') + // The dip Lumi curls up in, and moss tufts.
        circle(310, 424, 11, "#f4ead6") + circle(306, 420, 3.5, "#fff", 'opacity=".7"') + path("M309 429 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0Z M315 424 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0Z", "#d8ccb0") + // The puffball pillow.
        [[296, 404, 0], [392, 404, .7], [354, 396, 1.4], [288, 432, 1]].map(function (s) { return circle(s[0], s[1], 1.8, "#c8f5d4", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "door-mushroom-stalk": function () { // A front door set into the stalk of a giant toadstool: a spotted coral cap for a roof, a frilly ring, a glowing round window and moss at its foot.
      return path("M-60 354 Q-54 290 -50 222 H0 Q4 290 10 354 Z", "#f4e8d4") + path("M-53 350 Q-47 290 -44 228 M3 350 Q-1 290 -5 228", "none", 'stroke="#e0d0b8" stroke-width="3"') + // The stalk.
        path("M-56 238 Q-25 256 6 238 L4 229 Q-25 246 -54 229 Z", "#e6d6bc") + path("M-50 244 l2 6 M-38 249 l1 6 M-25 251 v6 M-12 249 l-1 6 M0 244 l-2 6", "none", 'stroke="#e6d6bc" stroke-width="2" stroke-linecap="round"') + // The frilly ring.
        circle(-25, 274, 10, "#8be9a8", 'class="lp-neon" stroke="#a8804f" stroke-width="3"') + path("M-25 264 V284 M-35 274 H-15", "none", 'stroke="#a8804f" stroke-width="2"') + // A round window, lit inside.
        path("M-43 354 V308 A18 18 0 0 1 -7 308 V354 Z", "#7a4a2a", 'stroke="#5a3a20" stroke-width="2.5"') + path("M-34 294 V354 M-25 290 V354 M-16 294 V354", "none", 'stroke="#5a3a20" stroke-width="1.5"') + circle(-12, 326, 3, "#ffdc83") + // The door.
        path("M-74 222 Q-25 236 24 222 Q-25 244 -74 222 Z", "#e8d0b4") + path("M-60 226 L-56 232 M-44 229 L-42 236 M-25 230 V238 M-6 229 L-8 236 M10 226 L6 232", "none", 'stroke="#c9a888" stroke-width="1.2"') + // Gills under the cap.
        path("M-74 222 C-74 172 24 172 24 222 Q-25 234 -74 222 Z", "#ff8e8e") + path("M-62 206 Q-56 190 -36 184", "none", 'stroke="#ffc4c4" stroke-width="4" stroke-linecap="round" opacity=".7"') + // The cap roof.
        path("M-58 210 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0Z M-32 194 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0Z M-6 206 a6.5 6.5 0 1 0 13 0 a6.5 6.5 0 1 0 -13 0Z M-36 216 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z M10 196 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0Z", "#fff1e0") +
        path("M-68 354 Q-66 344 -56 346 Q-50 338 -42 345 Q-34 340 -30 348 H-20 Q-14 340 -6 346 Q4 338 10 346 Q18 344 20 354 Z", "#3f7a5a") +                          // Moss at its foot.
        rect(-66, 342, 3, 8, "#f4e8d4") + path("M-71 344 Q-64.5 333 -58 344 Z", "#ff8e8e") + rect(15, 343, 2.6, 7, "#f4e8d4") + path("M11 345 Q16.3 336 21.6 345 Z", "#8be9a8", 'class="lp-neon"') + // Two little toadstools beside it.
        [[-66, 300, 0], [16, 276, .7], [-40, 262, 1.4]].map(function (s) { return circle(s[0], s[1], 1.8, "#8be9a8", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "hang-mushroom-lanterns": function () { // Three puffball lanterns hung at different heights, each glowing mint under a little coral cap, with spores drifting off them.
      function lantern(x, y, r, delay) { // A thread, a soft glow, the glowing puffball, its shine, a spotted cap and a tassel underneath.
        return line(x, 0, x, round(y - r * 1.3), "#6b8a74", 1.2) + circle(x, y, r + 9, "#8be9a8", 'opacity=".14"') +
          circle(x, y, r, "#c8f5d4", 'opacity=".9" class="lp-twinkle" style="animation-delay:' + delay + 's"') + circle(round(x - r * .35), round(y - r * .1), round(r * .3), "#fff", 'opacity=".7"') +
          path("M" + round(x - r * .95) + " " + round(y - r * .5) + " Q" + x + " " + round(y - r * 1.9) + " " + round(x + r * .95) + " " + round(y - r * .5) + " Q" + x + " " + round(y - r * .2) + " " + round(x - r * .95) + " " + round(y - r * .5) + " Z", "#ff8e8e") +
          circle(round(x - r * .3), round(y - r * .95), round(r * .14), "#fff1e0") + circle(round(x + r * .35), round(y - r * .8), round(r * .1), "#fff1e0") +
          path("M" + x + " " + (y + r) + " v6 M" + (x - 2) + " " + (y + r + 6) + " l2 5 l2 -5", "none", 'stroke="#ff8e8e" stroke-width="1.4" stroke-linecap="round"');
      }
      return path("M296 0 q6 7 12 0 q6 8 12 0 q6 6 12 0 q6 8 12 0 q6 7 12 0 q6 8 12 0 q6 6 12 0 V0 Z", "#3f7a5a") +                                           // A fringe of moss on the ceiling.
        lantern(308, 50, 11, 0) + lantern(336, 84, 15, .7) + lantern(366, 42, 10, 1.4) +
        [[322, 30, 0], [350, 60, .5], [300, 82, 1], [374, 76, 1.5], [342, 118, .8]].map(function (s) { return circle(s[0], s[1], 1.6, "#c8f5d4", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "table-mushroom-stump": function () { // An old mossy tree stump for a table, a coral bracket fungus on its side, and a toadstool teapot steaming gently on top.
      return path("M302 362 Q312 344 310 324 H360 Q358 344 370 362 Z", "#6b4a2f") + path("M318 330 Q316 346 312 360 M334 332 V360 M350 330 Q352 346 358 360", "none", 'stroke="#4a3218" stroke-width="2" stroke-linecap="round"') + // The stump and its bark.
        oval(335, 324, 25, 5, "#c9a27a") + oval(335, 324, 16, 3, "none", 'stroke="#a8804f" stroke-width="1"') + oval(335, 324, 7, 1.4, "none", 'stroke="#a8804f" stroke-width="1"') + // Its cut top and rings.
        path("M310 326 Q310 336 316 332 Q320 340 326 332 Q330 336 334 329 H310 Z M346 329 Q350 338 356 331 Q360 336 360 326 Z", "#4f8a68") +                           // Moss over the edge.
        path("M360 340 Q376 336 375 346 Q366 349 360 346 Z M362 350 Q372 348 371 355 Q366 357 362 355 Z", "#ff8e8e") + path("M362 343 Q368 342 372 344", "none", 'stroke="#ffc4c4" stroke-width="1"') + // Bracket fungi on the side.
        path("M296 362 Q302 356 308 362 M364 362 Q370 356 378 362", "#3f7a5a") +
        path("M352 309 Q362 307 364 296", "none", 'stroke="#fff1e0" stroke-width="3.5" stroke-linecap="round"') + path("M320 304 Q310 306 312 314 Q313 318 320 316", "none", 'stroke="#fff1e0" stroke-width="3" stroke-linecap="round"') + // Spout and handle.
        path("M320 321 Q316 300 335 298 Q354 300 350 321 Z", "#fff1e0") + path("M324 316 Q335 320 346 316", "none", 'stroke="#e6d4bc" stroke-width="2"') +                  // The teapot's stalk-shaped body.
        path("M318 302 Q335 278 352 302 Q335 307 318 302 Z", "#ff8e8e") + circle(326, 296, 2.2, "#fff1e0") + circle(337, 289, 2, "#fff1e0") + circle(345, 297, 1.8, "#fff1e0") + // Its toadstool lid.
        path("M364 290 q-4 -6 0 -10 q4 -5 0 -10", "none", 'stroke="#c8f5d4" stroke-width="1.8" stroke-linecap="round" opacity=".7" class="lp-twinkle"');                // Glowing steam.
    },

    "plant-mushroom-log": function () { // A hollow mossy log planter sprouting toadstools of every size, one glowing mint, with fern fronds behind.
      const fronds = [-62, -40, -18, 4, 26, 48].map(function (a, i) { return oval(18, 340, 4.5, 26, i % 2 ? "#4f8a68" : "#5fae86", 'transform="rotate(' + a + ' 18 366)"'); }).join("");
      return fronds +
        path("M-14 366 H48 Q56 379 48 392 H-14 Q-21 379 -14 366 Z", "#6b4a2f") + path("M-6 372 H30 M0 380 H40 M-8 387 H24", "none", 'stroke="#4a3218" stroke-width="1.6" stroke-linecap="round"') + // The log and its bark.
        oval(48, 379, 7, 13, "#c9a27a") + oval(48, 379, 4, 8, "none", 'stroke="#a8804f" stroke-width="1"') +                                                                // Its cut end.
        path("M-15 368 Q-12 360 -4 364 Q2 358 10 363 Q18 358 24 364 Q32 360 38 365 Q44 362 48 368 Z", "#4f8a68") +                                                          // Moss along its top.
        rect(-1.5, 340, 4, 26, "#f4e8d4") + path("M-12 342 C-12 322 16 322 16 342 Q2 346 -12 342 Z", "#ff8e8e") + circle(-5, 334, 2.4, "#fff1e0") + circle(6, 330, 2, "#fff1e0") + // The tall one...
        rect(15, 320, 5, 46, "#f4e8d4") + path("M2 322 C2 296 34 296 34 322 Q17.5 327 2 322 Z", "#ff8e8e") + circle(10, 312, 3, "#fff1e0") + circle(22, 306, 2.6, "#fff1e0") + circle(28, 316, 2, "#fff1e0") + // ...the tallest...
        rect(31, 350, 3.4, 16, "#e6f5e8") + path("M24 352 Q32.7 336 41.4 352 Z", "#8be9a8", 'class="lp-neon"') +                                                        // ...a glowcap...
        rect(41, 358, 2.6, 8, "#f4e8d4") + path("M37 360 Q42.3 351 47.6 360 Z", "#ff8e8e") +                                                                           // ...and a little one.
        [[-14, 320, 0], [46, 330, .7], [30, 298, 1.4]].map(function (s) { return circle(s[0], s[1], 1.6, "#c8f5d4", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "chest-mushroom-house": function () { // A toy box built like a toadstool cottage: a cream stalk with a tiny door and windows, and a spotted coral cap lid lifted a little to show the toys inside.
      return oval(92, 476, 44, 4, "#00000044") +
        rect(62, 426, 60, 10, "#2a1a20") + circle(110, 428, 8, "#bfe8ff") + path("M103 426 Q110 422 117 428", "none", 'stroke="#fff" stroke-width="2"') + path(star(98, 424, 6), "#ffdc83") + // Toys peeping out: a ball and a star.
        rect(60, 434, 64, 40, "#f4e8d4", 'rx="8"') + rect(60, 462, 64, 12, "#e0d0b8", 'rx="6"') +                                                                     // The stalk-cottage box.
        path("M84 474 V460 A8 8 0 0 1 100 460 V474 Z", "#7a4a2a") + circle(97, 467, 1.4, "#ffdc83") +                                                                  // A tiny door...
        circle(72, 450, 5, "#8be9a8", 'class="lp-neon" stroke="#a8804f" stroke-width="2"') + circle(112, 450, 5, "#8be9a8", 'class="lp-neon" stroke="#a8804f" stroke-width="2"') + // ...and two lit windows.
        group(path("M50 436 Q92 446 134 436 Q92 452 50 436 Z", "#e8d0b4") + path("M50 436 C50 398 134 398 134 436 Q92 446 50 436 Z", "#ff8e8e") +                   // The cap lid, tipped up at the right.
          path("M60 424 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0Z M84 412 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0Z M108 422 a5.5 5.5 0 1 0 11 0 a5.5 5.5 0 1 0 -11 0Z M96 430 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z", "#fff1e0") +
          path("M60 418 Q66 408 80 405", "none", 'stroke="#ffc4c4" stroke-width="3" stroke-linecap="round" opacity=".7"'), 'transform="rotate(-8 50 436)"') +
        path("M54 474 Q58 466 66 470 Q72 464 78 472 M106 472 Q112 464 118 470 Q126 466 130 474", "#3f7a5a");                                                           // Moss round its foot.
    },

    // Cloud Library set
    // Found in the dungeon's Cloud Library: twilight blues, parchment cream, pale sky glow, books that fly and stairs made of weather.

    "wall-skylib-shelves": function () { // A twilight-blue library wall where little bookshelves float on puffs of cloud, with whispering swirls and stars between them.
      const spines = ["#8fa2d8", "#c9a8ff", "#e8c877", "#7fc4c4", "#fff1cd", "#ff9fb8", "#6f80c0"];
      let bands = "";                                                                                       // Gold title bands on the spines, all one shape.
      function shelf(x, y, n, seed) { // A floating shelf: n books standing on a board at y, and a cloud underneath holding it up.
        const roll = dice(seed);
        let out = "", bx = x;
        for (let i = 0; i < n; i++) {
          const w = Math.round(roll(6, 10)), h = Math.round(roll(16, 26));
          out += rect(bx, y - h, w, h, spines[Math.floor(roll(0, spines.length))], 'rx="1"');
          bands += "M" + (bx + 1) + " " + (y - h + 4) + " h" + (w - 2) + " ";
          bx += w + 1;
        }
        const left = x - 4, right = bx + 3, seg = round((right - left) / 3);
        return path("M" + right + " " + (y + 4) + " a" + round(seg / 2) + " " + round(seg * .45) + " 0 0 1 -" + seg + " 0 a" + round(seg / 2) + " " + round(seg * .55) + " 0 0 1 -" + seg + " 0 a" + round(seg / 2) + " " + round(seg * .45) + " 0 0 1 -" + round(right - left - seg * 2) + " 0 Z", "#dfe6fb", 'opacity=".85"') + // The cloud, bulging down under the board.
          out + rect(left, y, right - left, 4, "#e8c877", 'rx="2"');
      }
      function cloud(x, y, s) { return group(oval(0, 0, 30, 10, "#44568a") + oval(-14, -7, 15, 11, "#44568a") + oval(11, -9, 17, 13, "#44568a"), 'transform="translate(' + x + " " + y + ") scale(" + s + ')"'); } // A soft cloud in the wallpaper itself.
      const shelves = shelf(28, 74, 5, 11) + shelf(226, 56, 6, 12) + shelf(118, 176, 5, 13) + shelf(300, 200, 4, 14) + shelf(36, 296, 5, 15) + shelf(246, 312, 5, 16);
      const swirls = [[50, 40], [258, 22], [140, 142], [318, 168], [62, 262], [272, 280]].map(function (p) { return "M" + p[0] + " " + p[1] + " q4 -6 8 0 t8 0 q3 -5 7 -2"; }).join(" ");
      const stars = [[170, 60, 5], [372, 110, 4], [20, 160, 4], [220, 236, 5], [150, 330, 4], [380, 260, 4], [100, 100, 3]].map(function (s) { return star(s[0], s[1], s[2]); }).join(" ");
      return rect(0, 0, 400, 352, "#3a4a7a") + cloud(170, 120, 1.2) + cloud(330, 70, .9) + cloud(80, 220, 1.1) + cloud(330, 290, 1) + cloud(200, 330, .8) +
        scatter(17, 24, function (roll) { return circle(round(roll(6, 394)), round(roll(6, 346)), round(roll(.5, 1.2)), "#dfe6fb", 'opacity="' + round(roll(.3, .7)) + '"'); }) + // Faint specks of starlight.
        shelves + path(bands, "none", 'stroke="#fff1cd" stroke-width="1.4" opacity=".7"') +
        path(swirls, "none", 'stroke="#bfe8ff" stroke-width="1.4" stroke-linecap="round" opacity=".45"') +                                            // Whispers drifting off the books.
        path(stars, "#fff1cd", 'opacity=".7" class="lp-twinkle"');
    },

    "floor-skylib-tiles": function () { // A library floor of blue diamond tiles, a cream star set where the corners meet, and wisps of cloud mist drifting low across it.
      let dark = "", stars = "";
      for (let k = 0; k < 5; k++) for (let c = 0; c < 8; c++) { // The darker diamonds; the paler ones are the floor showing between them.
        const x = 25 + c * 50, y = 365 + k * 30;
        dark += "M" + x + " " + (y - 15) + " L" + (x + 25) + " " + y + " L" + x + " " + (y + 15) + " L" + (x - 25) + " " + y + " Z ";
        if (c > 0 && (c + k) % 2 === 0) stars += star(c * 50, y, 4.5) + " ";                                              // A star where four tiles meet, never on the tile's edge.
      }
      return rect(0, 350, 400, 150, "#56679c") + path(dark, "#4a5a8e") + path(dark, "none", 'stroke="#6f80b8" stroke-width="1" opacity=".7"') +
        path(stars, "#fff1cd", 'opacity=".85"') +
        [[90, 400, 70, 9], [262, 428, 80, 11], [150, 474, 88, 10], [330, 468, 48, 7]].map(function (m) { return oval(m[0], m[1], m[2], m[3], "#eef2ff", 'opacity=".13"'); }).join("") + // Drifting mist.
        rect(0, 350, 400, 3, "#bfe8ff", 'opacity=".5"');
    },

    "art-skylib-scroll": function () { // A hanging weather-map scroll: a cloud with the sun peeking out, rain, a little lightning bolt and dashed wind swirls, between two wooden rollers.
      return path("M40 154 L70 140 L100 154", "none", 'stroke="#8a7aa8" stroke-width="1"') + circle(70, 140, 2, "#e8c877") +                             // The hanging cord.
        rect(37, 156, 66, 72, "#fff1cd") + path("M37 156 V228 M103 156 V228", "none", 'stroke="#e6d4a8" stroke-width="2"') +                              // The parchment.
        circle(82, 176, 10, "#ffdc83") + path("M82 160 V163 M96 176 H93 M92 166 L90 168 M92 186 L90 184", "none", 'stroke="#ffdc83" stroke-width="2" stroke-linecap="round"') + // The sun and its rays.
        path("M48 190 a7 7 0 0 1 8 -8 a9 9 0 0 1 16 -2 a7 7 0 0 1 10 6 a5 5 0 0 1 -2 10 H52 a5 5 0 0 1 -4 -6 Z", "#8fa2d8") +                          // A cloud...
        path("M54 200 l-3 7 M62 200 l-3 7 M70 200 l-3 7 M58 210 l-3 7 M66 210 l-3 7", "none", 'stroke="#6f80c0" stroke-width="1.8" stroke-linecap="round"') + // ...raining...
        path("M80 198 L74 210 H79 L75 220 L86 206 H81 L85 198 Z", "#e8c877") +                                                                         // ...with a little bolt.
        path("M42 168 q8 -6 16 0 q4 4 0 7 q-3 2 -5 -1 M44 220 h20 q6 0 6 -5 q0 -4 -4 -3", "none", 'stroke="#8fa2d8" stroke-width="1.5" stroke-dasharray="3 2" stroke-linecap="round"') + // Wind swirls.
        path(star(96, 214, 5), "#c9a8ff") +                                                                                                              // A compass point.
        rect(33, 151, 74, 7, "#7a5a8c", 'rx="3.5"') + rect(33, 226, 74, 7, "#7a5a8c", 'rx="3.5"') +                                                      // The rollers...
        [[32, 154.5], [108, 154.5], [32, 229.5], [108, 229.5]].map(function (k) { return circle(k[0], k[1], 4, "#e8c877"); }).join("");                    // ...and their knobs.
    },

    "shelf-skylib-floating": function () { // A shelf with no brackets at all, riding a little cloud: books leaning together, one flapping up on paper wings, and a quill in its ink pot.
      return path("M374 206 a8 7 0 0 1 -10 10 a10 8 0 0 1 -18 4 a10 8 0 0 1 -18 0 a10 8 0 0 1 -18 -4 a8 7 0 0 1 -10 -10 Z", "#eef2ff") + path("M312 214 Q338 222 364 214", "none", 'stroke="#c9d6f2" stroke-width="2"') + // The cloud carrying it.
        rect(300, 174, 9, 26, "#8fa2d8", 'rx="1"') + rect(310, 170, 8, 30, "#c9a8ff", 'rx="1"') + rect(319, 176, 10, 24, "#7fc4c4", 'rx="1"') + rect(330, 178, 8, 23, "#e8c877", 'rx="1" transform="rotate(16 330 200)"') + // Books, the last one leaning.
        path("M301 179 h7 M311 175 h6 M320 181 h8", "none", 'stroke="#fff1cd" stroke-width="1.5"') +
        path("M340 160 Q328 144 320 154 Q330 154 338 164 Z M364 160 Q376 144 384 154 Q374 154 366 164 Z", "#fff", 'opacity=".95"') + path("M332 152 L336 158 M372 152 L368 158", "none", 'stroke="#c9d6f2" stroke-width="1"') + // A flying book's wings...
        path("M352 160 L340 155 V166 L352 172 Z", "#fff1cd") + path("M352 160 L364 155 V166 L352 172 Z", "#f0e2b8") + path("M340 166 L352 172 L364 166", "none", 'stroke="#6f80c0" stroke-width="2" stroke-linejoin="round"') + // ...its pages and cover.
        path("M346 146 q3 -4 6 0 t6 0", "none", 'stroke="#bfe8ff" stroke-width="1.4" stroke-linecap="round" class="lp-twinkle"') +                       // A whisper.
        path("M364 200 V190 Q364 186 370 186 Q376 186 376 190 V200 Z", "#2a3660") + rect(366, 183, 8, 4, "#1a2240", 'rx="1"') +                           // The ink pot...
        path("M370 186 Q374 168 386 156 Q382 172 372 186 Z", "#fff1cd") + path("M371 186 L384 159", "none", 'stroke="#c9b48a" stroke-width="1"') +      // ...and its quill.
        rect(296, 200, 82, 6, "#e8c877", 'rx="3"') + path("M300 203 H374", "none", 'stroke="#fff1cd" stroke-width="1" opacity=".6"');                   // The board, floating.
    },

    "view-skylib-stacks": function () { // Up in the Cloud Library's sky: towers of books on far clouds, floating shelves with books flapping between them, a rainbow stair climbing out of the near clouds, and loose pages falling like snow.
      function domes(list) { return list.map(function (c) { return "M" + (c[0] - c[2]) + " " + c[1] + " a" + c[2] + " " + c[2] + " 0 0 1 " + c[2] * 2 + " 0Z"; }).join(" "); } // Cloud puffs [x, y, r] sitting on y, as one shape.
      function tower(x, base, n, odd) { // A tall stack of books, alternately wide and narrow, a little off true: only the odd or the even ones, so each set can take its own colour.
        let d = "";
        for (let i = odd ? 1 : 0; i < n; i += 2) { const w = i % 2 ? 13 : 17, off = i % 3 - 1; d += "M" + round(x - w / 2 + off) + " " + (base - (i + 1) * 6) + " h" + w + " v6 h-" + w + " Z "; }
        return d;
      }
      function towers(odd) { return tower(40, 92, 8, odd) + tower(122, 90, 11, odd) + tower(198, 94, 6, odd); } // All three towers' odd or even books.
      function island(x, y) { // A floating shelf on its own little cloud.
        return path(domes([[x - 10, y + 10, 9], [x + 6, y + 10, 11], [x + 20, y + 10, 6]]) + " M" + (x - 19) + " " + (y + 10) + " h45 a6 4 0 0 1 -6 5 h-34 a6 4 0 0 1 -5 -5Z", "#f4f6ff") +
          rect(x - 16, y, 38, 3, "#e8c877") + path("M" + (x - 14) + " " + y + " v-12 h5 v12 M" + (x - 2) + " " + y + " v-14 h4 v14 M" + (x + 10) + " " + y + " v-11 h6 v11", "#8fa2d8") +
          path("M" + (x - 8) + " " + y + " v-15 h5 v15 M" + (x + 3) + " " + y + " v-10 h6 v10", "#c9a8ff");
      }
      const flaps = "M18 30 q4 -5 8 0 q4 -5 8 0 M118 20 q3 -4 6 0 q3 -4 6 0 M206 36 q4 -5 8 0 q4 -5 8 0 M96 78 q3 -4 6 0 q3 -4 6 0";
      const rainbow = ["#ff9fb8", "#ffb88a", "#ffe08a", "#9fe0b0", "#9fd0ff", "#b9a8ff", "#e0c8ff"];
      return view(["#a3b3ee", "#ffeed6"], ["#0e1434", "#2c3668"], 28,
        hills(151, 96, 16, "#dfe6fb") + path(towers(false), "#8090cc") + path(towers(true), "#a898dc") + path(domes([[32, 94, 8], [48, 94, 7], [114, 92, 8], [130, 92, 9], [192, 96, 7], [206, 96, 8]]), "#eef2ff"), // Book towers on far clouds.
        hills(152, 112, 10, "#c9d3f2") + island(64, 62) + island(176, 48) + path(flaps, "none", 'stroke="#fff1cd" stroke-width="1.6" stroke-linecap="round"'), // Floating shelves and flapping books.
        waves(120, "#f4f6ff", 5) + path(domes([[140, 122, 12], [186, 124, 10], [222, 122, 12]]), "#ffffff") +
          rainbow.map(function (c, i) { return rect(14 + i * 13, 110 - i * 9, 15, 4, c, 'rx="2"'); }).join("") +                                    // A stair of rainbow...
          path(domes(rainbow.map(function (c, i) { return [21 + i * 13, 120 - i * 9, 4]; })).replace(/a4 4 0 0 1/g, "a4 4 0 0 0"), "#ffffff", 'opacity=".9"'), // ...each step on its own puff.
        falling("snow", scatter(158, 11, function (roll) { const x = round(roll(4, 114)), y = round(roll(0, 126)); return rect(x, y, 4, 5, "#fff1cd", 'opacity=".9" transform="rotate(' + Math.round(roll(-40, 40)) + " " + x + " " + y + ')"'); }))); // Loose pages drifting down.
    },

    "frame-skylib-book": function () { // The window is the two pages of a great open book: a deep blue cover with gold corners, page edges stacked around the opening, a gold spine down the middle and a ribbon bookmark hanging below.
      const hole = CLIPS["frame-skylib-book"];
      const cover = "M128 102 Q168 86 200 98 Q232 86 272 102 V238 Q232 226 200 238 Q168 226 128 238 Z";
      const pages = "M135 107 Q170 93 199 104 L200 107 L201 104 Q230 93 265 107 V231 Q230 220 201 229 L200 232 L199 229 Q170 220 135 231 Z";
      return path("M196 232 V258 L200 253 L204 258 V232 Z", "#d0606e") +                                                                        // The ribbon bookmark.
        path(cover + " " + hole, "#2a3660", 'fill-rule="evenodd" stroke="#e8c877" stroke-width="2.5" stroke-linejoin="round"') +                     // The cover.
        path(pages + " " + hole, "#fff1cd", 'fill-rule="evenodd"') + path("M138 120 V218 M262 120 V218 M146 106 Q172 98 196 106 M204 106 Q228 98 254 106", "none", 'stroke="#d8c8a0" stroke-width="1"') + // Pages, with their edges.
        path("M128 102 L144 96 L128 118 Z M272 102 L256 96 L272 118 Z M128 238 V220 L144 234 Z M272 238 V220 L256 234 Z", "#e8c877") +             // Gold corners.
        line(200, 113, 200, 226, "#e8c877", 2.5) +                                                                                                // The spine.
        [[150, 88, 0], [252, 88, .7], [276, 170, 1.4], [124, 176, 1]].map(function (s) { return path(star(s[0], s[1], 4), "#bfe8ff", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "curtain-skylib-scrolls": function () { // Two long parchment scrolls hang either side of the window from a great quill, written all over in faint whispering script, each rolled up at the foot.
      function scroll(x) { // One scroll, its left edge at x.
        let script = "";
        for (let y = 104, i = 0; y < 196; y += 8, i++) script += "M" + (x + 5) + " " + y + " q2.5 -3 5 0 t5 0" + (i % 3 ? " t5 0 t5 0" : " t5 0") + " ";
        return rect(x - 3, 88, 34, 6, "#7a5a8c", 'rx="3"') + rect(x, 93, 28, 112, "#fff1cd") + path("M" + (x + 27) + " 94 V204", "none", 'stroke="#e6d4a8" stroke-width="2"') + // Top roller and parchment.
          path(script, "none", 'stroke="#8fa2d8" stroke-width="1.2" opacity=".85"') + circle(x + 14, 190, 4, "#d0606e") +                                   // Faint script and a wax seal.
          rect(x - 4, 202, 36, 9, "#7a5a8c", 'rx="4.5"') + circle(x - 4, 206.5, 3.5, "#e8c877") + circle(x + 32, 206.5, 3.5, "#e8c877");                     // The rolled foot.
      }
      return path("M116 86 H284", "none", 'stroke="#c9b48a" stroke-width="3" stroke-linecap="round"') + path("M276 86 L292 84 L276 88 Z", "#2a3660") +     // The quill's shaft and inky nib.
        path("M116 86 Q122 70 170 74 Q158 78 150 84 Q160 82 176 84 Q150 92 116 86 Z", "#fff1cd") + path("M120 86 Q140 78 168 76 M134 84 l6 -6 M148 84 l6 -7", "none", 'stroke="#d8c8a0" stroke-width="1"') + // Its feather.
        scroll(124) + scroll(248) +
        [[176, 100], [200, 104], [224, 100]].map(function (c, i) { return line(c[0], 87, c[0], c[1] - 5, "#c9b48a", 1) + path("M" + (c[0] - 6) + " " + c[1] + " a3.5 3.5 0 0 1 4 -5 a4 4 0 0 1 7 1 a3 3 0 0 1 1 4 Z", "#eef2ff", 'class="lp-twinkle" style="animation-delay:' + i * .5 + 's"'); }).join(""); // Three little cloud charms.
    },

    "lamp-skylib-cloud": function () { // A reading lamp whose shade is a soft glowing cloud hung with tiny crystal raindrops, on a brass stem standing on a stack of books.
      const drops = [[52, 284, 0], [62, 292, .5], [74, 286, 1], [86, 294, 1.5], [96, 282, .8]];
      return oval(72, 262, 60, 52, "#bfe8ff", 'opacity=".13"') + path("M50 276 L30 370 H112 L96 276 Z", "#bfe8ff", 'opacity=".06"') +                       // The glow and a soft fall of light.
        oval(56, 405, 34, 4, "#1a2240") + rect(24, 392, 64, 12, "#3a4a7a", 'rx="2"') + rect(28, 381, 56, 11, "#c9a8ff", 'rx="2"') + rect(33, 372, 46, 9, "#e8c877", 'rx="2"') + // Three books for a base...
        path("M86 395 V401 M82 384 V389 M77 374 V379", "none", 'stroke="#fff1cd" stroke-width="2"') + path("M26 398 H86 M30 386 H82", "none", 'stroke="#fff1cd" stroke-width="1" opacity=".5"') + // ...with their page edges.
        path("M56 372 V300 Q56 276 70 272", "none", 'stroke="#e8c877" stroke-width="3.5" stroke-linecap="round"') + circle(56, 336, 3.5, "#e8c877") +      // The brass stem.
        drops.map(function (d) { return line(d[0], 271, d[0], d[1] - 6, "#dfe6fb", .8) + path("M" + d[0] + " " + (d[1] - 6) + " q4 5 0 8 q-4 -3 0 -8 Z", "#bfe8ff", 'class="lp-twinkle" style="animation-delay:' + d[2] + 's"'); }).join("") + // Crystal raindrops.
        path("M40 264 a12 11 0 0 1 14 -16 a16 15 0 0 1 28 -4 a13 12 0 0 1 20 10 a10 9 0 0 1 -4 18 H44 a8 8 0 0 1 -4 -8 Z", "#eef6ff", 'class="lp-neon"') +    // The cloud shade.
        path("M46 266 Q72 276 98 266", "none", 'stroke="#bfe8ff" stroke-width="3" stroke-linecap="round"') + path("M58 252 Q64 244 76 244", "none", 'stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"');
    },

    "rug-skylib-windrose": function () { // A round wind-rose rug: a cream-and-sky compass star on deep blue, a gold ring of the four winds, and a scalloped border of little clouds.
      let puffs = "";
      for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, x = round(Math.cos(a) * 140), y = round(Math.sin(a) * 140); puffs += "M" + round(x - 17) + " " + y + " a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0Z "; } // Cloud scallops round the edge.
      const flat = path(puffs, "#eef2ff") + circle(0, 0, 140, "#eef2ff") + circle(0, 0, 130, "#2a3660") + circle(0, 0, 112, "none", 'stroke="#e8c877" stroke-width="5"') + circle(0, 0, 100, "#3a4a7a") +
        [0, 90, 180, 270].map(function (a) { return circle(round(112 * Math.cos(a * Math.PI / 180)), round(112 * Math.sin(a * Math.PI / 180)), 8, "#e8c877"); }).join("") + // The four winds.
        path(star(0, 0, 92), "#bfe8ff", 'transform="rotate(45)"') + path(star(0, 0, 124), "#fff1cd") + path(star(0, 0, 50), "#8fa2d8") + circle(0, 0, 13, "#e8c877");
      return group(flat, 'transform="translate(200 440) scale(1 .27)"') +
        [[146, 426, 0], [262, 452, .7], [210, 418, 1.4]].map(function (s) { return path(star(s[0], s[1], 3.5), "#fff1cd", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "bed-skylib-book": function () { // A giant storybook lying open for a bed: its pages curl up into a cosy cradle, a little cloud makes the pillow and a ribbon bookmark trails over the edge.
      return oval(340, 460, 56, 5, "#00000044") +
        path("M286 450 Q288 438 298 436 H382 Q392 438 394 450 V454 Q340 462 286 454 Z", "#3a4a7a", 'stroke="#e8c877" stroke-width="2"') +              // The cover underneath.
        path("M292 446 Q316 438 340 448 Q364 438 388 446 V450 Q364 443 340 452 Q316 443 292 450 Z", "#e6d4a8") +                                         // The stacked page edges.
        path("M292 444 Q288 410 314 404 Q334 402 340 426 V446 Q318 434 292 444 Z", "#fff1cd") + path("M388 444 Q392 410 366 404 Q346 402 340 426 V446 Q362 434 388 444 Z", "#fff8e4") + // The two curling pages.
        path("M300 418 Q314 412 330 416 M298 426 Q314 420 332 424 M350 416 Q366 412 380 418 M348 424 Q366 420 382 426 M350 432 Q366 428 380 434", "none", 'stroke="#8fa2d8" stroke-width="1.2" opacity=".7"') + // Lines of story.
        path("M340 424 V446", "none", 'stroke="#d8c8a0" stroke-width="2"') +
        path("M298 426 a7 6 0 0 1 8 -9 a9 8 0 0 1 16 -1 a7 6 0 0 1 8 8 a4 4 0 0 1 -2 6 H302 a4 4 0 0 1 -4 -4 Z", "#eef2ff") + path("M304 428 H326", "none", 'stroke="#c9d6f2" stroke-width="2" stroke-linecap="round"') + // The cloud pillow.
        path("M360 440 Q370 450 364 466 L368 462 L372 467 Q376 450 366 438 Z", "#d0606e") +                                                                // The ribbon.
        [[296, 396, 0], [386, 398, .7], [352, 392, 1.4]].map(function (s) { return path(star(s[0], s[1], 4), "#bfe8ff", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "door-skylib-bookarch": function () { // A library door framed by an arch of stacked books: a blue door with a cloud-shaped window glowing pale sky, cream panels and a star for a handle.
      const colours = ["#8fa2d8", "#c9a8ff", "#e8c877", "#7fc4c4", "#ff9fb8", "#fff1cd", "#6f80c0"];
      let books = "", edges = "";
      for (let i = 0; i < 9; i++) { // Two columns of books lying flat, either side of the door.
        const y = 354 - (i + 1) * 12, shift = i % 2 ? 2 : 0;
        books += rect(-68 + shift, y, 18, 12, colours[i % 7], 'rx="1.5"') + rect(-shift, y, 18, 12, colours[(i + 3) % 7], 'rx="1.5"');
        edges += "M" + (-66 + shift) + " " + (y + 6) + " h14 M" + (2 - shift) + " " + (y + 6) + " h14 ";
      }
      for (let i = 0; i < 9; i++) books += rect(25, -6, 19, 12, colours[(i + 5) % 7], 'rx="1.5" transform="translate(-25 246) rotate(' + (190 + i * 20) + ')"'); // And the arch: books fanned round the top.
      return oval(-25, 356, 52, 5, "#1a2240") + books + path(edges, "none", 'stroke="#2a3660" stroke-width="1" opacity=".5"') +
        path("M-50 354 V246 A25 25 0 0 1 0 246 V354 Z", "#3a4a7a", 'stroke="#e8c877" stroke-width="2"') +                                               // The door.
        rect(-43, 290, 36, 24, "#46588a", 'rx="2"') + rect(-43, 320, 36, 28, "#46588a", 'rx="2"') +                                                     // Its panels.
        path("M-38 264 a6 6 0 0 1 6 -8 a8 8 0 0 1 14 -2 a6 6 0 0 1 6 8 a4 4 0 0 1 -2 6 H-34 a4 4 0 0 1 -4 -4 Z", "#bfe8ff", 'class="lp-neon"') +          // The cloud window.
        path(star(-9, 316, 5), "#e8c877") + path(star(-25, 222, 5), "#fff1cd", 'class="lp-twinkle"');
    },

    "hang-skylib-books": function () { // A mobile of little books flapping on paper wings from a brass bar, with a tiny cloud riding on top.
      function book(x, y, cover, delay) { // A thread, two feather wings, the open pages and the cover's edge.
        return line(x, 30, x, y - 6, "#c9b48a", 1) +
          path("M" + (x - 12) + " " + (y - 2) + " Q" + (x - 26) + " " + (y - 16) + " " + (x - 30) + " " + (y - 4) + " Q" + (x - 20) + " " + (y - 4) + " " + (x - 12) + " " + (y + 6) + " Z M" + (x + 12) + " " + (y - 2) + " Q" + (x + 26) + " " + (y - 16) + " " + (x + 30) + " " + (y - 4) + " Q" + (x + 20) + " " + (y - 4) + " " + (x + 12) + " " + (y + 6) + " Z", "#fff", 'opacity=".95" class="lp-twinkle" style="animation-delay:' + delay + 's"') +
          path("M" + x + " " + (y - 4) + " L" + (x - 13) + " " + (y - 9) + " V" + (y + 4) + " L" + x + " " + (y + 9) + " Z", "#fff1cd") + path("M" + x + " " + (y - 4) + " L" + (x + 13) + " " + (y - 9) + " V" + (y + 4) + " L" + x + " " + (y + 9) + " Z", "#f0e2b8") +
          path("M" + (x - 13) + " " + (y + 4) + " L" + x + " " + (y + 9) + " L" + (x + 13) + " " + (y + 4), "none", 'stroke="' + cover + '" stroke-width="2.4" stroke-linejoin="round"');
      }
      return line(331, 0, 331, 26, "#c9b48a", 1.2) + rect(298, 28, 66, 4, "#e8c877", 'rx="2"') + circle(298, 30, 3, "#e8c877") + circle(364, 30, 3, "#e8c877") + // The brass bar.
        path("M320 28 a5 5 0 0 1 6 -7 a7 7 0 0 1 12 -1 a5 5 0 0 1 4 8 Z", "#eef2ff") +                                                                          // A cloud riding on it.
        book(304, 62, "#8fa2d8", 0) + book(331, 92, "#c9a8ff", .6) + book(358, 56, "#7fc4c4", 1.2) +
        [[316, 116, 0], [372, 86, .5], [292, 92, 1]].map(function (s) { return path(star(s[0], s[1], 3.5), "#bfe8ff", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("");
    },

    "table-skylib-lectern": function () { // A reading lectern standing on a puff of cloud, with a big book open on its sloped top and whispers rising off the pages.
      return path("M306 362 a8 7 0 0 1 10 -9 a11 10 0 0 1 20 -3 a10 9 0 0 1 18 4 a7 6 0 0 1 8 8 Z", "#eef2ff") + path("M312 360 H358", "none", 'stroke="#c9d6f2" stroke-width="2" stroke-linecap="round"') + // The cloud it stands on.
        path("M322 354 L328 344 H342 L348 354 Z", "#2a3660") + rect(331, 314, 8, 32, "#3a4a7a") + rect(328, 326, 14, 3, "#e8c877", 'rx="1.5"') + rect(328, 340, 14, 3, "#e8c877", 'rx="1.5"') + // Foot, post and gold collars.
        path("M306 314 L362 300 L364 307 L308 321 Z", "#3a4a7a") + path("M308 321 L364 307", "none", 'stroke="#e8c877" stroke-width="1.6"') +              // The sloped top.
        group(path("M310 302 Q322 292 335 298 V305 Q322 300 310 309 Z", "#fff1cd") + path("M360 302 Q348 292 335 298 V305 Q348 300 360 309 Z", "#fff8e4") +
          path("M315 301 Q324 296 332 300 M315 305 Q324 300 332 303 M338 300 Q346 296 355 301 M338 303 Q346 300 355 305", "none", 'stroke="#8fa2d8" stroke-width="1" opacity=".8"') +
          path("M346 305 V318 l2 -2 l2 2 V306", "#d0606e"), 'transform="rotate(-14 335 306)"') +                                                           // The open book and its ribbon.
        path("M326 288 q-4 -5 0 -9 q4 -4 0 -9 M340 284 q4 -5 0 -9 q-4 -4 0 -9", "none", 'stroke="#bfe8ff" stroke-width="1.6" stroke-linecap="round" opacity=".8" class="lp-twinkle"') + // Whispers rising.
        path(star(352, 274, 4), "#fff1cd", 'class="lp-twinkle" style="animation-delay:.6s"') + path(star(316, 276, 3), "#fff1cd", 'class="lp-twinkle" style="animation-delay:1.2s"');
    },

    "plant-skylib-raincloud": function () { // A fern in a blue pot set on two old books, kept watered by its very own little raincloud.
      const fronds = [-60, -38, -16, 6, 28, 50].map(function (a, i) { return oval(18, 322, 4.5, 26, i % 2 ? "#5fae96" : "#7fc4b0", 'transform="rotate(' + a + ' 18 348)"'); }).join("");
      return fronds +
        rect(-6, 382, 48, 10, "#c9a8ff", 'rx="2"') + rect(-2, 372, 40, 10, "#8fa2d8", 'rx="2"') + path("M40 384 V390 M36 374 V380", "none", 'stroke="#fff1cd" stroke-width="2"') + // Two books for a stand.
        path("M4 348 H32 L28 372 H8 Z", "#3a4a7a") + rect(2, 345, 32, 6, "#56679c", 'rx="2"') + path(star(18, 360, 5), "#e8c877") +                       // The pot.
        path("M8 300 l-2 8 M16 302 l-2 8 M24 300 l-2 8 M30 304 l-2 8 M12 312 l-2 8 M26 314 l-2 8", "none", 'stroke="#bfe8ff" stroke-width="1.8" stroke-linecap="round" class="lp-twinkle"') + // Its rain.
        path("M0 294 a7 7 0 0 1 8 -9 a10 10 0 0 1 18 -2 a8 8 0 0 1 10 8 a4 4 0 0 1 -2 6 H4 a4 4 0 0 1 -4 -3 Z", "#eef2ff") + path("M6 296 H32", "none", 'stroke="#c9d6f2" stroke-width="2" stroke-linecap="round"') + // The little cloud.
        circle(12, 290, 1.2, "#3a4a7a") + circle(22, 290, 1.2, "#3a4a7a") + path("M15 293 q2 2 4 0", "none", 'stroke="#3a4a7a" stroke-width="1" stroke-linecap="round"'); // ...with a sleepy smile.
    },

    "chest-skylib-catalogue": function () { // A little card-catalogue cabinet for toys: rows of drawers with cream labels and brass pulls, one pulled out and spilling a paper plane, a star and a ball.
      let drawers = "";
      [61, 83, 105].forEach(function (x, c) { [437, 455].forEach(function (y, r) { // Every drawer but the open one: a front, a label and a pull.
        if (c === 1 && r === 0) return;
        drawers += rect(x, y, 19, 15, "#46588a", 'rx="1.5"') + rect(x + 5, y + 3, 9, 4, "#fff1cd", 'rx="1"') + circle(x + 9.5, y + 10.5, 1.8, "#e8c877");
      }); });
      return oval(92, 476, 42, 4, "#00000044") + rect(60, 470, 6, 6, "#1a2240") + rect(118, 470, 6, 6, "#1a2240") +                                       // Shadow and feet.
        rect(58, 432, 68, 40, "#2a3660", 'rx="3"') + rect(55, 428, 74, 6, "#3a4a7a", 'rx="2"') + drawers + rect(83, 437, 19, 15, "#121836") +             // The cabinet and its empty slot.
        circle(90, 434, 6.5, "#ff9fb8") + path("M85 431 Q90 428 95 432", "none", 'stroke="#fff" stroke-width="1.6"') + path(star(100, 428, 7), "#e8c877") + // A ball and a star popping out...
        path("M104 424 L124 412 L112 428 Z", "#fff") + path("M104 424 L124 412 L114 424 Z", "#dfe6fb") +                                                   // ...and a paper plane.
        path("M80 446 L83 441 H102 L105 446 Z", "#1a2240") + rect(80, 446, 25, 17, "#56679c", 'rx="2"') + rect(86, 450, 13, 4, "#fff1cd", 'rx="1"') + circle(92.5, 458, 2, "#e8c877"); // The drawer, pulled right out.
    },

    // Sunken Temple set
    // Old pillars under green water, with fish for a congregation. Stone #5d8f8a/#8fbcb4, water #173d44/#1f5560, sea-glass #7fd6c8, pearl-gold #ffdc83.
    "wall-sunken-pillars": function () { // Green temple water: two fluted pillars (one broken), light slanting down, a wave-scroll dado, fish and bubbles drifting by.
      function pillar(x, top, broken) { // One fluted pillar 34 wide, standing on the dado; a broken one has a jagged top and no capital.
        const shaft = broken ? path("M" + x + " 316 V" + (top + 10) + " L" + (x + 8) + " " + top + " L" + (x + 15) + " " + (top + 12) + " L" + (x + 24) + " " + (top + 3) + " L" + (x + 34) + " " + (top + 14) + " V316 Z", "#1f5560")
          : rect(x, top, 34, 316 - top, "#1f5560");
        return shaft + path("M" + (x + 8) + " " + (top + 16) + " V310 M" + (x + 17) + " " + (top + 16) + " V310 M" + (x + 26) + " " + (top + 16) + " V310", "none", 'stroke="#173d44" stroke-width="3"') + // The flutes.
          (broken ? "" : rect(x - 6, top - 8, 46, 9, "#286570", 'rx="2"') + circle(x - 2, top - 1, 5, "none", 'stroke="#286570" stroke-width="3"') + circle(x + 36, top - 1, 5, "none", 'stroke="#286570" stroke-width="3"')) + // Capital and scrolls.
          rect(x - 4, 306, 42, 10, "#286570", 'rx="1"');                                                   // The base.
      }
      function fish(x, y, s) { // A faint fish silhouette facing left, body and tail in one shape.
        return path("M" + x + " " + y + " q" + 10 * s + " -" + 8 * s + " " + 22 * s + " -1 l" + 8 * s + " -" + 6 * s + " v" + 14 * s + " l-" + 8 * s + " -" + 6 * s + " q-" + 12 * s + " " + 7 * s + " -" + 22 * s + " -1 Z", "#7fd6c8", 'opacity=".2"');
      }
      let waves = "", ripples = "";
      for (let x = 0; x < 400; x += 40) waves += (x ? " " : "M0 334") + " c10 -12 20 -12 20 0 s10 12 20 0"; // The dado's wave scroll, 10 waves to a tile so it joins.
      for (let x = 0; x < 400; x += 50) ripples += (x ? " " : "M0 16") + " q12.5 -5 25 0 t25 0";             // Light rippling on the surface far above.
      return rect(0, 0, 400, 352, "#173d44") + rect(0, 0, 400, 90, "#1f5560", 'opacity=".45"') + rect(0, 0, 400, 36, "#2a6e78", 'opacity=".35"') + // Water, paler up near the surface.
        path("M36 0 H70 L46 300 H18 Z M182 0 H210 L188 300 H160 Z M318 0 H352 L334 300 H302 Z", "#7fd6c8", 'opacity=".05"') + // Light rays slanting down.
        path(ripples, "none", 'stroke="#7fd6c8" stroke-width="1.5" opacity=".22"') + path(ripples.replace("M0 16", "M0 30"), "none", 'stroke="#7fd6c8" stroke-width="1" opacity=".12"') +
        pillar(83, 70, false) + pillar(283, 104, true) +
        scatter(17, 10, function (roll) { return oval(round(roll(86, 114)), round(roll(120, 300)), round(roll(2, 4)), round(roll(1, 2)), "#2f7a5a", 'opacity=".6"'); }) + // Algae on the whole pillar.
        rect(0, 316, 400, 36, "#12333a") + path("M0 320 H400 M0 348 H400", "none", 'stroke="#7fd6c8" stroke-width="1.5" opacity=".3"') + path(waves, "none", 'stroke="#7fd6c8" stroke-width="2" opacity=".35"') +
        fish(30, 60, 1) + fish(220, 42, .8) + fish(330, 236, 1.1) + fish(160, 268, .7) + fish(24, 250, .6) +
        scatter(23, 16, function (roll) { return circle(round(roll(10, 390)), round(roll(40, 300)), round(roll(1.2, 3.4)), "none", 'stroke="#7fd6c8" stroke-width="1" opacity=".35"'); }) + // Bubbles.
        scatter(29, 8, function (roll) { return circle(round(roll(10, 390)), round(roll(20, 300)), 1.2, "#ffdc83", 'opacity=".5"'); });                      // Glinting motes.
    },

    "floor-sunken-mosaic": function () { // Old temple tiles under the water: rows of teal stones, a few gilded, with sand drifted on them and light rippling across.
      const stones = ["#256470", "#2a6e78", "#21606b", "#2d7480"];
      const rows = [[353, 22], [377, 27], [406, 33], [441, 40], [483, 20]];              // [top, height]: the rows grow nearer the front.
      let out = rect(0, 350, 400, 150, "#173d44"), net = "";                            // The grout.
      rows.forEach(function (r, row) {
        for (let col = 0; col < 8; col++) {                                              // Each stone sits 2 in from its 50-wide cell, so the grout joins at the tile edge.
          const gold = (row * 3 + col * 5) % 11 === 4;                                   // Now and then a stone with a gold inlay.
          out += rect(col * 50 + 2, r[0], 46, r[1] - 3, stones[(row + col * 3) % 4], 'rx="2"');
          if (gold) out += path("M" + (col * 50 + 25) + " " + (r[0] + 3) + " l9 " + round((r[1] - 9) / 2) + " l-9 " + round((r[1] - 9) / 2) + " l-9 -" + round((r[1] - 9) / 2) + " Z", "#c9a15a", 'opacity=".75"'); // A gold diamond inlay.
        }
      });
      [370, 398, 430, 466].forEach(function (y) { net += "M0 " + y; for (let x = 0; x < 400; x += 50) net += " q12.5 -4 25 0 t25 0"; net += " "; }); // Rippled light.
      return out + path(net, "none", 'stroke="#7fd6c8" stroke-width="1.5" opacity=".16"') +
        oval(90, 470, 40, 8, "#c9b98a", 'opacity=".22"') + oval(300, 420, 34, 6, "#c9b98a", 'opacity=".2"') + oval(220, 492, 30, 5, "#c9b98a", 'opacity=".2"') + // Drifted sand.
        path("M58 402 Q58 391 66 390 Q74 391 74 402 Z M338 480 Q338 469 346 468 Q354 469 354 480 Z", "#ffc2b0", 'opacity=".8"') + path("M66 402 V392 M62 402 L60 394 M70 402 L72 394 M346 480 V470 M342 480 L340 472 M350 480 L352 472", "none", 'stroke="#d98a80" stroke-width="1"') + // Two little scallop shells.
        circle(150, 456, 2.6, "#fff8f0", 'opacity=".9"') + circle(268, 372, 2.2, "#fff8f0", 'opacity=".9"') +                   // Lost pearls.
        rect(0, 350, 400, 3, "#7fd6c8", 'opacity=".45"');
    },

    "art-sunken-fishmosaic": function () { // An arched stone tablet with a golden fish set in mosaic, swimming through tiled waves, with barnacles and a trail of weed.
      const tiles = 'stroke-dasharray="3.2 1.2"';                                                 // Dashed strokes read as rows of little mosaic stones.
      return path("M30 234 V178 Q30 146 69 146 Q108 146 108 178 V234 Z", "#5d8f8a") +           // The stone tablet.
        path("M37 228 V179 Q37 153 69 153 Q101 153 101 179 V228 Z", "#173d44") +                   // Its deep-water ground.
        path("M37 228 V179 Q37 153 69 153 Q101 153 101 179 V228 Z", "none", 'stroke="#ffdc83" stroke-width="1.4" opacity=".55"') +
        path("M42 172 q6.5 -5 13 0 t13 0 t13 0 t13 0 M40 212 q7 -5 14 0 t14 0 t14 0 t14 0 M40 222 q7 -5 14 0 t14 0 t14 0 t14 0", "none", 'stroke="#7fd6c8" stroke-width="3" opacity=".75" ' + tiles) + // Waves in tesserae.
        path("M48 190 Q60 176 78 182 L92 174 L90 190 L92 206 L78 198 Q60 204 48 190 Z", "#ffdc83", 'stroke="#c9a15a" stroke-width="2.4" ' + tiles) + // The fish.
        path("M62 182 Q66 171 76 181 Z M64 199 Q68 206 74 199 Z", "#ff9d6b") +                     // Its fins.
        path("M62 185 V195 M68 184 V197 M74 185 V195", "none", 'stroke="#ff9d6b" stroke-width="3" ' + tiles) +   // Scale rows.
        circle(55, 187, 2.6, "#173d44") + circle(54.2, 186.2, .8, "#fff") +
        circle(45, 179, 2.2, "none", 'stroke="#d9fff4" stroke-width="1"') + circle(41, 170, 1.6, "none", 'stroke="#d9fff4" stroke-width="1"') + // Bubbles from its mouth.
        path("M100 158 L94 168 L98 175", "none", 'stroke="#3f6f6a" stroke-width="1.4"') +             // A crack in the stone.
        path("M102 150 Q114 166 106 182 Q100 196 110 212", "none", 'stroke="#3fae7a" stroke-width="3" stroke-linecap="round"') + oval(110, 170, 3, 6, "#3fae7a", 'transform="rotate(30 110 170)"') + oval(103, 198, 3, 6, "#5fc08e", 'transform="rotate(-30 103 198)"') + // Weed trailing off the corner.
        circle(35, 230, 3, "#c9d8c8") + circle(42, 232, 2, "#c9d8c8") + circle(33, 222, 1.8, "#c9d8c8") + circle(104, 229, 2.4, "#c9d8c8");                         // Barnacles.
    },

    "shelf-sunken-relics": function () { // A carved stone ledge holding a patina amphora, an open clam with a glowing pearl and a pink conch, with weed hanging off the end.
      let ribs = "";
      for (let i = 1; i < 6; i++) { const a = Math.PI + i * Math.PI / 6; ribs += "M336 192 L" + round(336 + Math.cos(a) * 13) + " " + round(192 + Math.sin(a) * 18) + " "; } // Ribs on the clam's lid.
      return rect(292, 200, 90, 7, "#5d8f8a", 'rx="2"') + path("M300 207 h14 l-7 11 Z M360 207 h14 l-7 11 Z", "#4a7a76") +   // Ledge and carved corbels.
        rect(304, 164, 8, 10, "#3f8f86") + rect(302, 162, 12, 3, "#5fbfb2", 'rx="1"') + path("M300 200 Q292 186 302 174 H314 Q324 186 316 200 Z", "#3f8f86") + // The amphora's neck and body.
        path("M303 176 q-8 -2 -5 -11 M313 176 q8 -2 5 -11", "none", 'stroke="#3f8f86" stroke-width="2.4"') + path("M297 186 H319", "none", 'stroke="#ffdc83" stroke-width="2.4"') + // Handles and gold band.
        path("M300 193 q4 -3 8 0 t8 0", "none", 'stroke="#7fd6c8" stroke-width="1.3"') +
        path("M322 192 Q320 170 336 168 Q352 170 350 192 Z", "#a8e6dc") + path(ribs, "none", 'stroke="#5fbfb2" stroke-width="1.2"') + // The clam's open lid.
        circle(336, 191, 10, "#ffdc83", 'opacity=".3"') + circle(336, 191, 5, "#fff8f0", 'class="lp-neon"') +                         // Its pearl.
        path("M321 193 Q336 203 351 193 Q348 200 336 201 Q324 200 321 193 Z", "#7fd6c8") +                                             // And the lower shell.
        path("M354 200 Q351 186 362 178 L378 170 Q373 184 376 193 Q372 200 354 200 Z", "#ffc2b0") + path("M358 196 Q356 188 364 184 Q368 190 366 197 Z", "#ff8e8e") + // The conch and its pink mouth.
        path("M364 180 l2 -5 M370 176 l3 -4 M372 186 l4 -2", "none", 'stroke="#ffc2b0" stroke-width="2" stroke-linecap="round"') +
        path("M380 207 q5 9 -1 17 q-4 6 2 12", "none", 'stroke="#3fae7a" stroke-width="2.4" stroke-linecap="round"');                  // Weed hanging down.
    },

    "view-sunken-depths": function () { // Out through green water to a drowned temple: its far facade, fallen columns in the kelp, fish, and sand with a clam; marine snow drifts down.
      function fish(x, y, s, body, fin) { // Facing left, because the strips slide left, so they seem to swim.
        return path("M" + (x - s * 1.4) + " " + y + " Q" + x + " " + (y - s) + " " + (x + s) + " " + y + " L" + (x + s * 2) + " " + (y - s * .8) + " V" + (y + s * .8) + " L" + (x + s) + " " + y + " Q" + x + " " + (y + s) + " " + (x - s * 1.4) + " " + y + " Z", body) +
          path("M" + (x - s * .2) + " " + (y - s * .7) + " l" + s * .6 + " -" + s * .6 + " l" + s * .3 + " " + s * .6 + " Z", fin) + circle(round(x - s * .8), round(y - s * .15), round(s * .16 + .4), "#0b262c");
      }
      const c = "#2f7f78";                                                                                       // The far temple, hazy in the water.
      const temple = path("M48 72 L100 48 L152 72 Z", c) + path("M58 74 h8 v26 h-8Z M76 74 h8 v26 h-8Z M94 74 h8 v26 h-8Z M112 74 h8 v26 h-8Z M130 74 h8 v26 h-8Z", c) + rect(52, 71, 96, 4, c) + rect(48, 100, 104, 5, c) + rect(42, 105, 116, 6, c);
      const kelp = [62, 74, 206, 220].map(function (x, i) { const top = 52 + (i * 13) % 24; return "M" + x + " 118 Q" + (x - 8) + " " + round((118 + top) / 2 + 10) + " " + x + " " + round((118 + top) / 2) + " T" + x + " " + top; }).join(" ");
      const coral = [[40, 124, 10], [176, 124, 12]].map(function (k) { return "M" + k[0] + " " + k[1] + " V" + (k[1] - k[2] * 2) + " M" + k[0] + " " + (k[1] - k[2]) + " L" + (k[0] - k[2]) + " " + (k[1] - k[2] * 1.8) + " M" + k[0] + " " + (k[1] - k[2] * 1.2) + " L" + (k[0] + k[2] * .9) + " " + (k[1] - k[2] * 2); }).join(" ");
      const bubbles = scatter(157, 10, function (roll) { const x = round(roll(8, 232)), y = round(roll(14, 104)), r = round(roll(1.2, 2.8)); return "M" + round(x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; });
      return view(["#3f9e8f", "#0f4a50"], ["#04161a", "#0a2c30"], -30,
        hills(151, 106, 14, "#256a66") + temple + path("M20 0 H44 L28 130 H8 Z M120 0 H140 L126 130 H108 Z M196 0 H218 L206 130 H186 Z", "#d9fff4", 'opacity=".1"'), // Light rays.
        hills(152, 114, 10, "#1d5a58") + path("M14 116 V82 L18 76 L22 84 L26 78 V116 Z M170 116 V90 L175 84 L178 92 L182 88 V116 Z", "#4f9a90") + rect(92, 104, 34, 12, "#4f9a90", 'rx="4"') + // Standing stumps and a toppled drum.
          path("M18 84 V114 M22 84 V114 M174 92 V114 M178 92 V114 M100 105 V115 M109 105 V115 M118 105 V115", "none", 'stroke="#2f7470" stroke-width="1.4"') +
          path(kelp, "none", 'stroke="#3fae7a" stroke-width="3.2" stroke-linecap="round"') + fish(124, 62, 6, "#ffdc83", "#ff9d6b") + fish(196, 40, 5, "#a8e6dc", "#3f9e8f"),
        waves(122, "#c9b98a", 3) + path(coral, "none", 'stroke="#ff8e8e" stroke-width="3.4" stroke-linecap="round"') + fish(96, 84, 9, "#ff9d6b", "#ffdc83") + fish(20, 64, 6, "#7fd6c8", "#2f8f86") +
          path("M110 124 Q124 106 138 124 Z", "#7fd6c8") + path("M114 124 L122 112 M124 124 V110 M134 124 L126 112", "none", 'stroke="#3f9e8f" stroke-width="1"') + circle(124, 120, 3, "#fff8f0") + // A clam and its pearl.
          path("M214 127 l3 -6 l3 6 l-6 -4 h6 Z", "#ffb84a") + path(bubbles, "none", 'stroke="#d9fff4" stroke-width=".9" opacity=".75"'),
        falling("snow", scatter(158, 14, function (roll) { return circle(round(roll(0, 120)), round(roll(0, 130)), round(roll(.6, 1.2)), "#e0fff6", 'opacity=".55"'); }))); // Marine snow.
    },

    "frame-sunken-portico": function () { // A little temple front: two fluted columns, a pediment with a glowing pearl at its peak, stone steps for a sill, weed and a starfish.
      const stone = "#8fbcb4", dark = "#4f8a84";
      function column(x) { // A fluted column 20 wide, from its scrolled capital down to the steps.
        return rect(x, 140, 20, 86, stone) + path("M" + (x + 5) + " 145 V222 M" + (x + 10) + " 145 V222 M" + (x + 15) + " 145 V222", "none", 'stroke="' + dark + '" stroke-width="1.6"') +
          rect(x - 3, 134, 26, 7, stone, 'rx="2"') + circle(x - 1, 141, 3.4, "none", 'stroke="' + stone + '" stroke-width="2.4"') + circle(x + 21, 141, 3.4, "none", 'stroke="' + stone + '" stroke-width="2.4"');
      }
      let points = "M200 92";
      for (let i = 1; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2.4 : 5.6; points += " L" + round(268 + Math.cos(a) * r) + " " + round(222 + Math.sin(a) * r); } // Starfish points (drawn at 268,222).
      return path("M122 140 L200 92 L278 140 Z M150 140 V136 L200 106 L250 136 V140 Z", stone, 'fill-rule="evenodd" stroke="' + dark + '" stroke-width="1.5" stroke-linejoin="round"') + // The pediment, with the window's peak cut out.
        path("M140 134 L200 99 L260 134", "none", 'stroke="' + dark + '" stroke-width="1.2" opacity=".7"') +
        path(CLIPS["frame-sunken-portico"], "none", 'stroke="' + stone + '" stroke-width="5" stroke-linejoin="round"') +
        column(128) + column(252) +
        circle(200, 88, 11, "#ffdc83", 'opacity=".25"') + path("M192 94 Q200 80 208 94 Z", "#7fd6c8") + circle(200, 88, 5.5, "#fff8f0", 'class="lp-neon"') + // A shell cupping the pearl at the peak.
        rect(124, 226, 152, 6, stone, 'rx="2"') + rect(118, 232, 164, 6, dark, 'rx="2"') +                                                       // Two steps for a sill.
        path("M132 226 Q124 206 134 190 Q142 176 132 160", "none", 'stroke="#3fae7a" stroke-width="2.6" stroke-linecap="round"') + oval(127, 200, 2.6, 6, "#5fc08e", 'transform="rotate(-25 127 200)"') + oval(139, 176, 2.6, 6, "#3fae7a", 'transform="rotate(25 139 176)"') + // Weed up the left column.
        path(points.replace("M200 92", "M268 216.4") + " Z", "#ff9d6b", 'stroke="#ff9d6b" stroke-width="1.2" stroke-linejoin="round"') +                                     // A starfish on the right base.
        circle(258, 230, 1.8, "#c9d8c8") + circle(264, 231, 1.4, "#c9d8c8") + circle(136, 230, 1.6, "#c9d8c8");
    },

    "curtain-sunken-kelp": function () { // Kelp fronds hanging from a driftwood pole down both sides of the window, threaded with pearls, a little fish hiding in them.
      function frond(x, length, side, seed, colour) { // One strand: a wavy stem with long blades off alternate sides, and a pearl at its tip.
        let stem = "M" + x + " 90", end = [x, 90];
        const blades = scatter(seed, length, function (r, i) {
          const y = 98 + i * 13, px = x + (i % 2 ? 2 : -2) + side * i * .4, out = i % 2 ? 1 : -1, k = round(r(.85, 1.2));
          stem += " L" + round(px) + " " + y; end = [round(px), y];
          return "M" + round(px) + " " + y + " q" + round(out * 8 * k) + " 2 " + round(out * 14 * k) + " 12 q" + round(-out * 10 * k) + " -2 " + round(-out * 14 * k) + " -12 Z ";
        });
        return path(stem, "none", 'stroke="#2f8f6a" stroke-width="2" stroke-linejoin="round"') + path(blades, colour) + circle(end[0], end[1] + 6, 2.6, "#fff8f0");
      }
      return path("M116 86 Q160 81 200 87 T284 85 L284 91 Q240 93 200 92 T116 92 Z", "#8a7a5a") + oval(150, 88, 3, 1.6, "#6a5a40") + oval(236, 89, 3, 1.6, "#6a5a40") + // Driftwood pole and its knots.
        path("M110 82 Q116 74 122 82 Z M278 82 Q284 74 290 82 Z", "#ffdc83") + path("M116 82 V77 M284 82 V77", "none", 'stroke="#c9a15a" stroke-width="1"') + // Shell finials.
        frond(130, 11, 1, 161, "#3fae7a") + frond(143, 8, -1, 162, "#5fc08e") + frond(155, 4, 1, 163, "#2f8f6a") +
        frond(270, 11, -1, 164, "#3fae7a") + frond(257, 8, 1, 165, "#5fc08e") + frond(245, 4, -1, 166, "#2f8f6a") +
        path("M138 202 q6 -5 12 -1 l5 -4 v10 l-5 -4 q-6 4 -12 -1 Z", "#ffdc83") + circle(141, 201, 1, "#173d44") +                             // A little fish in the kelp.
        circle(150, 190, 1.8, "none", 'stroke="#d9fff4" stroke-width=".9"') + circle(154, 182, 1.3, "none", 'stroke="#d9fff4" stroke-width=".9"');
    },

    "lamp-sunken-pearl": function () { // A fluted temple pillar with an open clam on top, cupping a big glowing pearl; weed climbs the pillar and two tiny fish circle the light.
      let edge = "M24 284", ribs = "";
      for (let i = 1; i <= 7; i++) { // The lid's scalloped rim: seven little arcs round the top of an oval fan.
        const a = Math.PI + i * Math.PI / 7, x = round(54 + Math.cos(a) * 30), y = round(284 + Math.sin(a) * 44);
        edge += " A6 6 0 0 1 " + x + " " + y;
        if (i < 7) ribs += "M54 284 L" + x + " " + y + " ";
      }
      return oval(54, 266, 58, 56, "#ffdc83", 'opacity=".1"') + oval(54, 272, 30, 30, "#ffdc83", 'opacity=".15"') +                  // The pearl's glow.
        oval(54, 404, 26, 4, "#123036") + rect(30, 396, 48, 8, "#4f8a84", 'rx="2"') + rect(36, 388, 36, 9, "#5d8f8a") +           // Plinth.
        rect(42, 302, 24, 87, "#7fb0a8") + path("M48 306 V385 M54 306 V385 M60 306 V385", "none", 'stroke="#4f8a84" stroke-width="1.8"') + // Fluted shaft.
        rect(36, 294, 36, 9, "#8fbcb4", 'rx="2"') + circle(36, 302, 4, "none", 'stroke="#8fbcb4" stroke-width="2.4"') + circle(72, 302, 4, "none", 'stroke="#8fbcb4" stroke-width="2.4"') + // Capital.
        path(edge + " Z", "#a8e6dc") + path(ribs, "none", 'stroke="#5fbfb2" stroke-width="1.6"') +                                            // The clam's lid.
        circle(54, 276, 13, "#fff4d8", 'class="lp-neon"') + circle(50, 272, 4, "#fff", 'opacity=".85"') +                                    // The pearl.
        path("M22 284 Q54 302 86 284 Q82 296 54 298 Q26 296 22 284 Z", "#7fd6c8") + path("M34 292 L36 296 M44 294 V298 M54 295 V299 M64 294 V298 M74 292 L72 296", "none", 'stroke="#3f9e8f" stroke-width="1.2"') + // Lower shell.
        path("M46 386 Q34 370 46 356 Q58 344 44 330 Q36 318 46 306", "none", 'stroke="#3fae7a" stroke-width="3" stroke-linecap="round"') + oval(38, 364, 2.6, 6, "#5fc08e", 'transform="rotate(-40 38 364)"') + oval(52, 340, 2.6, 6, "#3fae7a", 'transform="rotate(40 52 340)"') + // Weed climbing.
        path("M12 246 q5 -4 10 -1 l4 -3 v8 l-4 -3 q-5 3 -10 -1 Z", "#ffdc83", 'class="lp-twinkle"') + path("M88 262 q5 -4 10 -1 l4 -3 v8 l-4 -3 q-5 3 -10 -1 Z", "#7fd6c8", 'class="lp-twinkle" style="animation-delay:1s"'); // Two tiny fish.
    },

    "rug-sunken-rosette": function () { // A round temple mosaic seen from above: a wave-tiled border, eight fish swimming in a ring, and a golden scallop in the middle.
      let fish = "", ribs = "";
      for (let i = 0; i < 8; i++) fish += group(path("M-22 0 Q-8 -13 11 -3 L22 -13 L20 0 L22 13 L11 3 Q-8 13 -22 0 Z", i % 2 ? "#ffdc83" : "#7fd6c8") + circle(-14, -2, 2.6, "#173d44"), 'transform="rotate(' + i * 45 + ') translate(0 -94)"'); // Each fish tangent to the ring.
      for (let i = 0; i <= 6; i++) { const a = Math.PI + (i + .5) * Math.PI / 7.5; ribs += "M0 22 L" + round(Math.cos(a) * 46) + " " + round(22 + Math.sin(a) * 52) + " "; }
      return oval(200, 440, 162, 46, "#7fd6c8", 'opacity=".07"') + group(
        circle(0, 0, 152, "#12333a") + circle(0, 0, 146, "none", 'stroke="#7fd6c8" stroke-width="4"') +
        circle(0, 0, 131, "none", 'stroke="#3f9e8f" stroke-width="20" stroke-dasharray="10 4"') +       // The border, in tesserae.
        circle(0, 0, 119, "#1f5560", 'stroke="#ffdc83" stroke-width="3"') + fish +
        circle(0, 0, 66, "#256470", 'stroke="#ffdc83" stroke-width="3"') +
        path("M-46 22 Q-50 -30 0 -34 Q50 -30 46 22 Z", "#ffdc83") + path(ribs, "none", 'stroke="#c9a15a" stroke-width="3"') + circle(0, 26, 10, "#fff8f0"), // The scallop and its pearl.
        'transform="translate(200 440) scale(1 .27)"');
    },

    "bed-sunken-clam": function () { // A giant clam opened wide: a fluted teal lid behind, a sandy cushion in the lower shell, a glowing pearl pillow and a starfish on the rim.
      let edge = "M290 430", ribs = "", points = "";
      for (let i = 1; i <= 9; i++) { // The lid's scalloped rim and its ribs.
        const a = Math.PI + i * Math.PI / 9, x = round(340 + Math.cos(a) * 50), y = round(430 + Math.sin(a) * 56);
        edge += " A9 9 0 0 1 " + x + " " + y;
        if (i < 9) ribs += "M340 430 L" + x + " " + y + " ";
      }
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3 : 7.5; points += (i ? " L" : "M") + round(298 + Math.cos(a) * r) + " " + round(440 + Math.sin(a) * r); } // Starfish at 298,440.
      return oval(340, 466, 52, 6, "#0b262c", 'opacity=".6"') +
        path(edge + " Z", "#7fd6c8") + path(ribs, "none", 'stroke="#4fa89c" stroke-width="2.2"') + path(edge, "none", 'stroke="#a8e6dc" stroke-width="2"') + // The lid.
        oval(340, 430, 47, 10, "#2f6f6a") + oval(340, 428, 42, 8, "#f2dfb4") + oval(334, 426, 30, 4.5, "#fff1d6") +                                 // The cushion.
        circle(370, 420, 13, "#ffdc83", 'opacity=".25"') + circle(370, 421, 8.5, "#fff8f0", 'class="lp-neon"') + circle(367, 418, 2.4, "#fff") +     // The pearl pillow.
        path("M288 430 Q292 464 340 466 Q388 464 392 430 Q366 442 340 442 Q314 442 288 430 Z", "#5fbfb2") +                                          // The lower shell.
        path("M302 444 Q306 456 312 460 M322 446 Q324 458 326 464 M340 447 V466 M358 446 Q356 458 354 464 M378 444 Q374 456 368 460", "none", 'stroke="#3f9e8f" stroke-width="1.6"') +
        path(points + " Z", "#ff9d6b", 'stroke="#ff9d6b" stroke-width="1.4" stroke-linejoin="round"') + circle(298, 440, 1.2, "#ffdc83") +
        circle(384, 408, 2, "none", 'stroke="#d9fff4" stroke-width="1"') + circle(390, 398, 1.4, "none", 'stroke="#d9fff4" stroke-width="1"');
    },

    "door-sunken-gate": function () { // A stone temple arch opening on dark water, its bronze gate raised, a gold shell keystone, steps going down into the deep and weed at the foot.
      let ribs = "";
      for (let i = 1; i < 6; i++) { const a = Math.PI + i * Math.PI / 6; ribs += "M-25 210 L" + round(-25 + Math.cos(a) * 11) + " " + round(210 + Math.sin(a) * 13) + " "; }
      return oval(-25, 282, 46, 84, "#7fd6c8", 'opacity=".09"') +
        path("M-70 354 V244 A45 45 0 0 1 20 244 V354 Z", "#5d8f8a") + path("M-66 352 V250 M-62 352 V250 M12 352 V250 M16 352 V250", "none", 'stroke="#4a7a76" stroke-width="1.4"') + // Stone surround, fluted at the sides.
        path("M-58 354 V246 A33 33 0 0 1 8 246 V354 Z", "#0b262c") +                                                                                   // The dark water beyond.
        path("M-40 216 H-31 L-44 354 H-54 Z M-14 216 L-6 222 L-15 354 H-25 Z", "#7fd6c8", 'opacity=".1"') +                                         // Light reaching down into it.
        rect(-40, 316, 30, 10, "#173d44") + rect(-46, 326, 42, 13, "#1f4a50") + rect(-54, 339, 58, 15, "#2a5a5e") +                                 // Steps going down.
        path("M-36 276 q5 -4 10 -1 l4 -3 v8 l-4 -3 q-5 3 -10 -1 Z", "#ffdc83", 'class="lp-twinkle"') + path("M-14 298 q4 -3 8 -1 l3 -2 v6 l-3 -2 q-4 2 -8 -1 Z", "#7fd6c8", 'class="lp-twinkle" style="animation-delay:.8s"') + // Fish inside.
        path("M-50 226 V258 M-40 218 V262 M-30 214 V264 M-20 214 V264 M-10 218 V262 M0 226 V258 M-52 240 H2", "none", 'stroke="#3f8f86" stroke-width="3" stroke-linecap="round"') + // The raised bronze gate.
        path("M-53 258 l3 6 l3 -6 M-43 262 l3 6 l3 -6 M-33 264 l3 6 l3 -6 M-23 264 l3 6 l3 -6 M-13 262 l3 6 l3 -6 M-3 258 l3 6 l3 -6", "#5fbfb2") +
        path("M-38 212 Q-38 196 -25 196 Q-12 196 -12 212 Z", "#ffdc83") + path(ribs, "none", 'stroke="#c9a15a" stroke-width="1.4"') +             // The shell keystone.
        path("M-66 354 Q-72 336 -64 324 Q-58 314 -66 302 M-60 354 Q-56 340 -60 330 M14 354 Q20 338 12 326", "none", 'stroke="#3fae7a" stroke-width="3" stroke-linecap="round"') + // Weed at the foot.
        circle(-68, 270, 2.4, "#c9d8c8") + circle(-64, 276, 1.6, "#c9d8c8") + circle(18, 290, 2.2, "#c9d8c8");
    },

    "hang-sunken-mobile": function () { // A driftwood mobile: three fish on threads strung with pearls, with a little gold shell in the middle and bubbles rising.
      function fish(x, y, s, body, fin) { // A hanging fish facing left.
        return path("M" + (x - 12 * s) + " " + y + " Q" + x + " " + (y - 10 * s) + " " + (x + 8 * s) + " " + y + " L" + (x + 15 * s) + " " + (y - 7 * s) + " V" + (y + 7 * s) + " L" + (x + 8 * s) + " " + y + " Q" + x + " " + (y + 10 * s) + " " + (x - 12 * s) + " " + y + " Z", body) +
          path("M" + (x - 2 * s) + " " + (y - 7 * s) + " l" + 5 * s + " -" + 5 * s + " l" + 3 * s + " " + 5 * s + " Z", fin) + circle(round(x - 7 * s), round(y - 1.5 * s), round(1.6 * s), "#173d44");
      }
      return path("M312 0 L318 39 M348 0 L342 39", "none", 'stroke="#7fb0a8" stroke-width="1"') + path("M296 41 Q330 34 364 41 L364 46 Q330 40 296 46 Z", "#8a7a5a") + // Hangers and the driftwood.
        path("M302 45 V70 M330 42 V90 M358 45 V64", "none", 'stroke="#7fb0a8" stroke-width=".9"') +
        circle(302, 56, 2.6, "#fff8f0") + circle(330, 56, 2.6, "#fff8f0") + circle(330, 70, 2.6, "#fff8f0") + circle(358, 54, 2.6, "#fff8f0") +     // Pearls strung on the threads.
        path("M323 40 Q330 28 337 40 Z", "#ffdc83") + path("M330 40 V31 M326 40 L324 33 M334 40 L336 33", "none", 'stroke="#c9a15a" stroke-width="1"') + // A gold shell on the bar.
        fish(302, 78, 1, "#ffdc83", "#ff9d6b") + fish(330, 100, 1.2, "#7fd6c8", "#3f9e8f") + fish(358, 72, .9, "#ff8e8e", "#ffc2b0") +
        circle(286, 70, 2, "none", 'stroke="#d9fff4" stroke-width="1" class="lp-twinkle"') + circle(312, 92, 1.6, "none", 'stroke="#d9fff4" stroke-width="1" class="lp-twinkle" style="animation-delay:.7s"') + circle(344, 64, 1.8, "none", 'stroke="#d9fff4" stroke-width="1" class="lp-twinkle" style="animation-delay:1.3s"');
    },

    "table-sunken-capital": function () { // A broken temple column used as a side table, its scrolled capital for a top, holding a pink conch and a dish of pearls.
      return rect(320, 334, 32, 24, "#7fb0a8") + path("M327 336 V356 M336 336 V356 M345 336 V356", "none", 'stroke="#4f8a84" stroke-width="1.8"') +   // The drum of the column.
        path("M352 340 L346 346 L350 352", "none", 'stroke="#3f6f6a" stroke-width="1.4"') + rect(314, 356, 44, 6, "#5d8f8a", 'rx="2"') +             // A crack, and the base.
        rect(306, 320, 60, 8, "#8fbcb4", 'rx="2"') + rect(316, 328, 40, 6, "#7fb0a8") +                                                               // The capital as a top.
        circle(312, 330, 6, "#8fbcb4") + circle(312, 330, 3, "none", 'stroke="#4f8a84" stroke-width="1.4"') + circle(360, 330, 6, "#8fbcb4") + circle(360, 330, 3, "none", 'stroke="#4f8a84" stroke-width="1.4"') + // Its scrolls.
        path("M316 320 Q314 306 326 300 L344 294 Q338 308 340 314 Q336 320 316 320 Z", "#ffc2b0") + path("M320 318 Q320 310 328 306 Q332 312 330 318 Z", "#ff8e8e") + // The conch.
        path("M328 300 l2 -5 M335 297 l3 -4 M338 306 l5 -2", "none", 'stroke="#ffc2b0" stroke-width="2" stroke-linecap="round"') +
        oval(353, 319, 10, 3, "#c9a15a") + circle(349, 315, 3, "#fff8f0") + circle(356, 315, 3, "#fff8f0") + circle(352.5, 310.5, 3, "#fff8f0", 'class="lp-neon"') + // A dish of pearls.
        path("M322 358 Q316 344 324 336", "none", 'stroke="#3fae7a" stroke-width="2.4" stroke-linecap="round"') + oval(318, 346, 2, 5, "#5fc08e", 'transform="rotate(-30 318 346)"');
    },

    "plant-sunken-coral": function () { // Pink branching coral and a teal sea fan growing out of a temple urn, with a little yellow fish nosing round it.
      let fan = "";
      for (let i = 0; i <= 6; i++) { const a = Math.PI + (i + .5) * Math.PI / 7.5; fan += "M18 352 L" + round(18 + Math.cos(a) * 26) + " " + round(352 + Math.sin(a) * 44) + " "; } // The sea fan's spines.
      return path("M18 352 L-10 330 Q-6 304 18 306 Q42 304 46 330 Z", "#7fd6c8", 'opacity=".3"') + path(fan + "M-4 334 Q18 322 40 334 M2 318 Q18 310 34 318", "none", 'stroke="#7fd6c8" stroke-width="1.4" opacity=".8"') + // Sea fan.
        path("M18 368 V334 M18 352 L6 336 L2 318 M6 336 L12 322 M18 344 L30 330 L34 312 M30 330 L24 316 M18 334 L14 314 L16 298 M18 334 L24 306", "none", 'stroke="#ff8e8e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"') + // The coral.
        circle(2, 318, 3, "#ffc2b0") + circle(12, 322, 2.6, "#ffc2b0") + circle(34, 312, 3, "#ffc2b0") + circle(24, 316, 2.6, "#ffc2b0") + circle(16, 298, 3, "#ffc2b0") + circle(24, 306, 2.6, "#ffc2b0") + // Pale tips.
        rect(0, 364, 36, 6, "#8fbcb4", 'rx="2"') + path("M3 370 H33 Q40 380 30 388 V392 H6 V388 Q-4 380 3 370 Z", "#5d8f8a") + path("M2 378 q4 -3 8 0 t8 0 t8 0 t8 0", "none", 'stroke="#ffdc83" stroke-width="1.6"') + // The urn and its gold wave.
        path("M40 336 q6 -5 12 -1 l5 -4 v10 l-5 -4 q-6 4 -12 -1 Z", "#ffdc83") + circle(43, 335, 1, "#173d44") +                                             // The little fish.
        circle(36, 324, 1.8, "none", 'stroke="#d9fff4" stroke-width="1" class="lp-twinkle"') + circle(33, 316, 1.3, "none", 'stroke="#d9fff4" stroke-width="1" class="lp-twinkle" style="animation-delay:.6s"');
    },

    "chest-sunken-coffer": function () { // A bronze temple coffer gone green with the sea, gold-banded, its lid lifted on a glow of pearls; a starfish clings to the top.
      let points = "";
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2.8 : 7; points += (i ? " L" : "M") + round(108 + Math.cos(a) * r) + " " + round(420 + Math.sin(a) * r); } // Starfish at 108,420.
      return oval(92, 476, 40, 4, "#0b262c", 'opacity=".5"') +
        rect(60, 436, 64, 8, "#ffdc83", 'opacity=".85"') + circle(70, 438, 3, "#fff8f0") + circle(80, 437, 3, "#fff8f0") + circle(104, 437, 3, "#fff8f0") + circle(114, 438, 3, "#fff8f0") + // The glowing gap and pearls inside.
        rect(58, 442, 68, 32, "#2f6f6a", 'rx="3"') + path("M56 436 Q58 412 92 410 Q126 412 128 436 Z", "#3f8f86") +                                         // Body and lifted lid.
        path("M56 436 H128 M72 412 V436 M112 412 V436 M72 442 V474 M112 442 V474", "none", 'stroke="#c9a15a" stroke-width="3"') +                             // Gold bands.
        path("M84 446 Q84 438 92 438 Q100 438 100 446 L96 458 H88 Z", "#ffdc83") + path("M92 440 V456 M88 442 L90 456 M96 442 L94 456", "none", 'stroke="#c9a15a" stroke-width="1"') + // Shell lock.
        path("M66 444 Q70 458 64 470", "none", 'stroke="#fff8f0" stroke-width="3" stroke-dasharray=".1 4.5" stroke-linecap="round"') + circle(66, 478, 2.6, "#fff8f0") + circle(122, 479, 2.2, "#fff8f0") + // A pearl string spilling out.
        path(points + " Z", "#ff9d6b", 'stroke="#ff9d6b" stroke-width="1.2" stroke-linejoin="round"') +
        circle(62, 470, 2.2, "#c9d8c8") + circle(67, 472, 1.5, "#c9d8c8") + circle(121, 450, 2, "#c9d8c8") + circle(76, 420, 1.6, "#c9d8c8");                   // Barnacles.
    },

    // Clockwork Tower set
    // Brass gears the size of rooms, all ticking slightly out of step. Wood #4a3524/#6b4a2f, brass #c9a15a/#ffdc83, copper #c87a4a, glow #ff9d6b.
    // Gears are drawn with gear(): a circle whose dashed thick stroke makes the teeth, a body inside it and a hub.
    "wall-clockwork-gears": function () { // Panelled dark wood behind huge faint gears that don't quite mesh, a steam pipe along the top, little dials and a riveted wainscot.
      function gear(x, y, r, fill, hub) { // Teeth from a dashed stroke: n teeth, each half a pitch long.
        const n = Math.max(6, Math.round(r / 2.4)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .34) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) +
          circle(x, y, round(r * .6), "none", 'stroke="' + hub + '" stroke-width="' + round(r * .08) + '"') + circle(x, y, round(r * .2), hub);
      }
      function dial(x, y, hour, minute) { // A small clock face; each one shows a slightly different time.
        const h = hour * Math.PI / 6 - Math.PI / 2, m = minute * Math.PI / 30 - Math.PI / 2;
        return circle(x, y, 12, "#5a4230", 'stroke="#8a6a3a" stroke-width="2"') + path("M" + x + " " + y + " L" + round(x + Math.cos(h) * 6) + " " + round(y + Math.sin(h) * 6) + " M" + x + " " + y + " L" + round(x + Math.cos(m) * 9) + " " + round(y + Math.sin(m) * 9), "none", 'stroke="#c9a15a" stroke-width="1.6" stroke-linecap="round"');
      }
      let out = rect(0, 0, 400, 352, "#4a3524");
      for (let x = 0; x < 400; x += 50) out += rect(x, 0, 25, 262, "#4f3927", 'opacity=".6"');                // Soft panel stripes, 50 apart so they join.
      out += gear(70, 96, 54, "#55402c", "#4a3524") + gear(172, 40, 26, "#55402c", "#4a3524") + gear(318, 124, 60, "#55402c", "#4a3524") + gear(222, 236, 22, "#55402c", "#4a3524") + gear(120, 190, 16, "#55402c", "#4a3524"); // Big faint gears.
      out += rect(0, 10, 400, 9, "#7a5a32") + rect(0, 11, 400, 2, "#c9a15a", 'opacity=".5"') + rect(96, 7, 12, 15, "#a8823f", 'rx="2"') + rect(296, 7, 12, 15, "#a8823f", 'rx="2"'); // The steam pipe and its couplings.
      out += dial(254, 52, 3, 50) + dial(378, 238, 3, 10) + dial(28, 58, 2, 55);                                 // Three dials, none agreeing, kept clear of the window and door.
      out += rect(0, 262, 400, 90, "#3d2b1d") + rect(10, 278, 180, 60, "none", 'stroke="#55402c" stroke-width="2" rx="3"') + rect(210, 278, 180, 60, "none", 'stroke="#55402c" stroke-width="2" rx="3"') + // The wainscot.
        rect(0, 258, 400, 6, "#c9a15a", 'opacity=".75"');
      let rivets = "";
      for (let x = 10; x < 400; x += 20) rivets += "M" + (x - 1.8) + " 270 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0Z ";              // A row of rivets under the rail, as one shape.
      return out + path(rivets, "#c9a15a", 'opacity=".7"') + scatter(37, 10, function (roll) { return circle(round(roll(10, 390)), round(roll(30, 250)), 1.2, "#ff9d6b", 'opacity=".45"'); }); // A few floating sparks.
    },

    "floor-clockwork-plates": function () { // A deck of riveted brass-and-wood plates, a tread pattern on some and little cogs set into others.
      const rows = [[352, 36], [388, 48], [436, 64]];                                                   // [top, height]: nearer plates are deeper.
      let out = rect(0, 350, 400, 150, "#3d2b1d"), rivets = "", tread = "";
      rows.forEach(function (r, row) {
        for (let col = 0; col < 4; col++) {                                                              // Four 100-wide plates a row, inset 2 so the seams join at the tile edge.
          const x = col * 100 + 2, y = r[0] + 2, w = 96, h = r[1] - 4;
          out += rect(x, y, w, h, (row + col) % 2 ? "#6b4a2f" : "#7a5636", 'rx="2"');
          [[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + h - 5], [x + w - 5, y + h - 5]].forEach(function (p) { rivets += "M" + (p[0] - 2) + " " + p[1] + " a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0Z "; });
          if ((row + col) % 2) for (let t = x + 14; t < x + w - 12; t += 12) tread += "M" + t + " " + (y + h * .35) + " l6 " + round(h * .3) + " "; // Raised tread on alternate plates.
        }
      });
      function cog(x, y, r) { return circle(x, y, r, "none", 'stroke="#c9a15a" stroke-width="' + round(r * .34) + '" stroke-dasharray="' + round(Math.PI * r / 8) + " " + round(Math.PI * r / 8) + '" opacity=".55"') + circle(x, y, round(r * .5), "#c9a15a", 'opacity=".55"'); } // An inlaid cog.
      return out + path(tread, "none", 'stroke="#54391f" stroke-width="2.2" stroke-linecap="round"') + path(rivets, "#c9a15a") + cog(150, 412, 11) + cog(52, 468, 14) + cog(350, 370, 8) +
        rect(0, 350, 400, 3, "#ffdc83", 'opacity=".5"');
    },

    "art-clockwork-skeleton": function () { // A round skeleton clock: a brass rim, cream chapter ring and see-through middle full of turning gears, with a little gear either side.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.8)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .34) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      let ticks = "";
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ticks += "M" + round(69 + Math.cos(a) * 26.5) + " " + round(190 + Math.sin(a) * 26.5) + " L" + round(69 + Math.cos(a) * (i % 3 ? 30 : 31.5)) + " " + round(190 + Math.sin(a) * (i % 3 ? 30 : 31.5)) + " "; }
      return circle(69, 190, 46, "#ff9d6b", 'opacity=".1"') + gear(34, 160, 8, "#c9a15a", "#4a3524") + gear(104, 160, 8, "#c9a15a", "#4a3524") +  // Glow and side gears.
        circle(69, 150, 4.5, "none", 'stroke="#c9a15a" stroke-width="2.4"') + circle(69, 190, 39, "#c9a15a") + circle(69, 190, 35, "#2a1c12") +   // Hanging ring, rim and dark middle.
        gear(58, 201, 13, "#b8862e", "#2a1c12") + gear(83, 183, 10, "#ffdc83", "#2a1c12") + gear(66, 175, 7, "#c87a4a", "#2a1c12") +              // The works.
        circle(69, 190, 29, "none", 'stroke="#fff1cd" stroke-width="6" opacity=".92"') + path(ticks, "none", 'stroke="#4a3524" stroke-width="1.8"') + // Chapter ring and hours.
        path("M69 190 L80 177", "none", 'stroke="#3a2412" stroke-width="3.4" stroke-linecap="round"') + path("M69 190 L67 164", "none", 'stroke="#3a2412" stroke-width="2.4" stroke-linecap="round"') + // Hands.
        circle(69, 190, 4, "#ff9d6b", 'class="lp-neon"') + circle(69, 190, 1.6, "#fff1cd");
    },

    "shelf-clockwork-gadgets": function () { // A brass shelf on gear brackets holding an hourglass, a big wind-up key and a copper oil can.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.6)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .36) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      return gear(305, 214, 8, "#a8823f", "#4a3524") + gear(369, 214, 8, "#a8823f", "#4a3524") + rect(292, 200, 90, 6, "#c9a15a", 'rx="2"') + // Gear brackets and the board.
        path("M297 203 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0Z M374 203 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0Z", "#6b4a2f") +
        path("M302 168 H314 L309 182 L314 196 H302 L307 182 Z", "#e8f0f0", 'opacity=".4"') + path("M304 171 H312 L308 179 Z M303 196 Q308 187 313 196 Z", "#ffdc83") + line(308, 179, 308, 193, "#ffdc83", 1) + // Hourglass glass and sand.
        path("M301 166 V198 M315 166 V198", "none", 'stroke="#a8743f" stroke-width="2"') + rect(298, 164, 20, 4, "#a8743f", 'rx="1"') + rect(298, 196, 20, 4, "#a8743f", 'rx="1"') +
        rect(336, 176, 4, 24, "#c9a15a") + rect(340, 190, 6, 3, "#c9a15a") + rect(340, 184, 4, 3, "#c9a15a") +                                     // The key's stem and bit.
        circle(331, 170, 6, "none", 'stroke="#ffdc83" stroke-width="3.4"') + circle(345, 170, 6, "none", 'stroke="#ffdc83" stroke-width="3.4"') + circle(338, 174, 3.6, "#ffdc83") + // Its bow.
        path("M370 186 L386 170", "none", 'stroke="#c9a15a" stroke-width="2.4" stroke-linecap="round"') + path("M354 200 L356 186 Q364 179 372 186 L374 200 Z", "#c87a4a") + // The oil can.
        rect(361, 177, 6, 4, "#c9a15a", 'rx="1"') + path("M358 196 V188", "none", 'stroke="#ffb88a" stroke-width="1.6" opacity=".7" stroke-linecap="round"');
    },

    "view-clockwork-spires": function () { // Out over the tower's rooftops at sunset: far spires with clock faces, half-buried giant gears and lit windows, a brass catwalk with steaming chimneys in front.
      function gear(x, y, r, fill) { const n = Math.max(6, Math.round(r / 2.4)), dash = round(Math.PI * r / n); return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .34) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill); }
      function spire(x, w, h, c) { // A tower with a pointed roof and a pale clock face.
        return rect(x, 100 - h, w, h + 40, c) + path("M" + (x - 3) + " " + (100 - h) + " L" + (x + w / 2) + " " + (100 - h - w * 1.1) + " L" + (x + w + 3) + " " + (100 - h) + " Z", c) + circle(x + w / 2, 100 - h + w * .55, round(w * .32), "#fff1cd", 'opacity=".55"');
      }
      let rail = "M0 108 H240 M0 115 H240";
      for (let x = 10; x < 240; x += 20) rail += " M" + x + " 108 V122";
      const steam = [[52, 92], [192, 96]].map(function (s) { return rect(s[0] - 4, s[1] + 8, 8, 16, "#2e1e14") + circle(s[0], s[1], 5, "#f4e8dc", 'opacity=".55"') + circle(s[0] + 5, s[1] - 8, 7, "#f4e8dc", 'opacity=".4"') + circle(s[0] + 12, s[1] - 18, 8, "#f4e8dc", 'opacity=".25"'); }).join("");
      return view(["#d9925a", "#ffe0b0"], ["#120c1c", "#3a2630"], 28,
        gear(196, 36, 18, "#e8a870") + spire(20, 16, 44, "#b07a52") + spire(98, 22, 62, "#b07a52") + spire(170, 18, 40, "#b07a52") + rect(0, 96, 240, 50, "#b07a52"), // Far spires, a gear hanging in the haze.
        gear(52, 106, 30, "#8a5a36") + gear(108, 90, 15, "#8a5a36") + gear(196, 104, 24, "#8a5a36") + skyline(211, 122, 6, 20, "#5a3a24", "#ffcf7a"),           // Giant gears behind lit rooftops.
        rect(0, 118, 240, 30, "#3a2618") + steam + path(rail, "none", 'stroke="#c9a15a" stroke-width="2.4"') + path("M20 126 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0Z M100 126 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0Z M180 126 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0Z", "#c9a15a")); // Catwalk, chimneys and rivets.
    },

    "frame-clockwork-cog": function () { // The window is the toothed hole in a great brass ring gear, riveted all round, with two small gears meshing at its edge and a puff of steam.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.8)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .36) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      const hole = CLIPS["frame-clockwork-cog"];
      let rivets = "";
      for (let i = 0; i < 12; i++) { const a = (-75 + i * 30) * Math.PI / 180, x = round(200 + Math.cos(a) * 68), y = round(161 + Math.sin(a) * 68); rivets += "M" + (x - 2.4) + " " + y + " a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z "; } // Between the inner teeth.
      return circle(200, 161, 76, "none", 'stroke="#c9a15a" stroke-width="9" stroke-dasharray="9.95 9.95"') +                                   // The ring's outer teeth (24 of them).
        path("M124 161 A76 76 0 1 0 276 161 A76 76 0 1 0 124 161 Z " + hole, "#c9a15a", 'fill-rule="evenodd"') +                              // The ring itself, with the window cut out.
        circle(200, 161, 72, "none", 'stroke="#a8823f" stroke-width="2"') + path(hole, "none", 'stroke="#ffe9a8" stroke-width="2.4" stroke-linejoin="round"') +
        path(rivets, "#8a6220") + path("M200 80 l5 7 h-10 Z", "#ffdc83") +                                                                          // Rivets, and a gold pointer at twelve.
        gear(268, 226, 14, "#c87a4a", "#4a3524") + gear(130, 98, 9, "#ffdc83", "#4a3524") +                                                         // Two small gears meshing at the rim.
        circle(282, 206, 4, "#f4e8dc", 'opacity=".6" class="lp-twinkle"') + circle(288, 196, 5.5, "#f4e8dc", 'opacity=".45" class="lp-twinkle" style="animation-delay:.6s"') + circle(292, 184, 6.5, "#f4e8dc", 'opacity=".3" class="lp-twinkle" style="animation-delay:1.2s"');
    },

    "curtain-clockwork-drapes": function () { // Rust velvet drapes with gold fringe, tied back with brass gears, under a scalloped pelmet on a brass rod with gear finials.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.6)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .36) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      function panel(x, flip) { // One tied-back drape with its folds, fringe and gear tie-back.
        return group(path("M0 88 H44 Q32 150 8 170 Q24 200 32 236 H0 Z", "#7a2e24") + path("M12 92 Q14 140 5 166 M26 92 Q24 140 9 170 M12 178 Q18 206 20 236", "none", 'stroke="#55201a" stroke-width="2.2"') +
          path("M0 237 H32", "none", 'stroke="#ffdc83" stroke-width="5" stroke-dasharray="1.6 2.2"') + path("M0 166 Q8 168 12 171", "none", 'stroke="#c9a15a" stroke-width="2" stroke-dasharray="2 1.5"') + gear(12, 171, 7, "#ffdc83", "#7a2e24"),
          'transform="translate(' + x + ' 0) scale(' + flip + ' 1)"');
      }
      let scallops = "M122 88 H278 V96";
      for (let i = 0; i < 12; i++) scallops += " q-6.5 9 -13 0";                                         // The pelmet's scalloped hem, 12 x 13 = 156 wide.
      return panel(126, 1) + panel(274, -1) + path(scallops + " Z", "#6a2620") + path(scallops.replace("M122 88 H278 V96", "M278 96"), "none", 'stroke="#ffdc83" stroke-width="1.6"') +
        rect(118, 83, 164, 6, "#c9a15a", 'rx="3"') + gear(116, 86, 8, "#ffdc83", "#4a3524") + gear(284, 86, 8, "#ffdc83", "#4a3524");
    },

    "lamp-clockwork-gaslight": function () { // A copper pipe lamp: a caged glass globe with a glowing filament, a valve wheel, a pressure gauge on a side branch and a brass foot.
      return oval(54, 262, 58, 54, "#ff9d6b", 'opacity=".12"') + oval(54, 262, 30, 30, "#ffdc83", 'opacity=".16"') +
        oval(54, 404, 24, 5, "#2a1c12") + path("M32 404 Q34 390 54 388 Q74 390 76 404 Z", "#a8823f") + rect(51, 288, 6, 102, "#c87a4a") +  // Foot and pipe.
        rect(48, 300, 12, 4, "#c9a15a", 'rx="1"') + rect(48, 344, 12, 4, "#c9a15a", 'rx="1"') +                                             // Brass collars.
        circle(54, 370, 9, "none", 'stroke="#ffdc83" stroke-width="2.6"') + path("M45 370 H63 M54 361 V379", "none", 'stroke="#ffdc83" stroke-width="1.8"') + circle(54, 370, 2.6, "#c9a15a") + // Valve wheel.
        path("M57 326 H68", "none", 'stroke="#c87a4a" stroke-width="4"') + circle(76, 326, 9, "#fff1cd", 'stroke="#c9a15a" stroke-width="2.6"') + path("M76 326 L80 320", "none", 'stroke="#c8483e" stroke-width="1.4" stroke-linecap="round"') + // Pressure gauge.
        rect(44, 280, 20, 9, "#a8823f", 'rx="2"') + circle(54, 262, 21, "#ffcf8a", 'opacity=".4"') + circle(54, 264, 10, "#ffdc83", 'opacity=".55"') +  // Collar and globe.
        path("M46 270 L49 256 L52 270 L55 256 L58 270 L61 256", "none", 'stroke="#ff9d6b" stroke-width="2" stroke-linejoin="round" class="lp-twinkle"') + // The filament.
        path("M54 241 V283 M54 241 Q36 262 54 283 M54 241 Q72 262 54 283", "none", 'stroke="#c9a15a" stroke-width="1.8"') + oval(54, 262, 21, 5, "none", 'stroke="#c9a15a" stroke-width="1.8"') + // Its cage.
        path("M38 246 Q54 228 70 246 Z", "#c9a15a") + circle(54, 232, 4, "none", 'stroke="#ffdc83" stroke-width="2.4" stroke-dasharray="1.6 1.6"') + circle(54, 232, 2.4, "#ffdc83") + // Cap and a tiny gear on top.
        circle(47, 254, 2.4, "#fff", 'opacity=".7"');
    },

    "rug-clockwork-dial": function () { // A round rug like a great clock face seen from above: a geared brass edge, minute ticks, bold hours, two hands and a seconds dial.
      let hours = "";
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; hours += "M" + round(Math.cos(a) * 96) + " " + round(Math.sin(a) * 96) + " L" + round(Math.cos(a) * 114) + " " + round(Math.sin(a) * 114) + " "; }
      return oval(200, 440, 166, 46, "#ff9d6b", 'opacity=".08"') + group(
        circle(0, 0, 150, "none", 'stroke="#c9a15a" stroke-width="14" stroke-dasharray="13.09 13.09"') + circle(0, 0, 144, "#a8823f") + circle(0, 0, 134, "#f2dfb4") + // Teeth, brass rim and face.
        circle(0, 0, 124, "none", 'stroke="#6b4a2f" stroke-width="9" stroke-dasharray="2 10.98"') + path(hours, "none", 'stroke="#4a3524" stroke-width="9"') +          // Minute ticks and hour bars.
        circle(0, 0, 86, "none", 'stroke="#c9a15a" stroke-width="3"') + circle(0, 52, 24, "#e8cf9a", 'stroke="#6b4a2f" stroke-width="3"') + path("M0 52 L14 40", "none", 'stroke="#c8483e" stroke-width="3"') + // Seconds dial.
        path("M-7 0 L0 -70 L7 0 Z", "#4a3524", 'transform="rotate(-62)"') + path("M-5 0 L0 -112 L5 0 Z", "#4a3524", 'transform="rotate(38)"') + circle(0, 0, 14, "#ffdc83") + circle(0, 0, 5, "#4a3524"), // Hands.
        'transform="translate(200 440) scale(1 .27)"');
    },

    "bed-clockwork-cog": function () { // A half-gear of brass for a cradle, a rust velvet cushion with gold buttons, a little clock-face pillow and a big wind-up key behind.
      const r = function (n) { return Math.round(n * 10) / 10; }, pt = function (R, deg) { const a = deg * Math.PI / 180; return r(340 + R * Math.cos(a)) + " " + r(420 + R * Math.sin(a)); };
      let bowl = "M" + pt(46, 0);
      for (let i = 0; i < 9; i++) { const c = 10 + i * 20; bowl += " L" + pt(46, c - 6) + " L" + pt(53, c - 4) + " L" + pt(53, c + 4) + " L" + pt(46, c + 6); } // Nine teeth round the bottom half.
      bowl += " L" + pt(46, 180) + " Z";
      return oval(340, 474, 50, 5, "#2a1c12", 'opacity=".5"') +
        rect(314, 386, 5, 30, "#c9a15a") + circle(308, 380, 7, "none", 'stroke="#ffdc83" stroke-width="3.6"') + circle(325, 380, 7, "none", 'stroke="#ffdc83" stroke-width="3.6"') + circle(316.5, 384, 4, "#ffdc83") + // The wind-up key behind.
        path(bowl, "#c9a15a") + path("M302 420 A38 38 0 0 0 378 420 Z", "#a8823f") + circle(318, 436, 5, "#7a5636") + circle(340, 446, 5, "#7a5636") + circle(362, 436, 5, "#7a5636") + // Gear cradle and its holes.
        oval(340, 420, 48, 11, "#7a2e24") + oval(340, 418, 42, 8, "#a8452e") + circle(322, 418, 1.6, "#ffdc83") + circle(340, 420, 1.6, "#ffdc83") + circle(358, 418, 1.6, "#ffdc83") + // Cushion and buttons.
        oval(368, 410, 13, 9, "#fff1cd", 'stroke="#c9a15a" stroke-width="2"') + path("M368 410 V404 M368 410 L373 412", "none", 'stroke="#4a3524" stroke-width="1.4" stroke-linecap="round"') + // Clock-face pillow.
        path("M368 402.5 v1.2 M368 416.3 v1.2 M356.8 410 h1.2 M378 410 h1.2", "none", 'stroke="#4a3524" stroke-width="1.2"');
    },

    "door-clockwork-cuckoo": function () { // A door built like a cuckoo clock: a carved peaked roof with the bird peeping from its hatch, a dial, a swinging pendulum and pinecone weights.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.6)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .36) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      let ticks = "";
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ticks += "M" + round(-25 + Math.cos(a) * 12) + " " + round(252 + Math.sin(a) * 12) + " L" + round(-25 + Math.cos(a) * 15) + " " + round(252 + Math.sin(a) * 15) + " "; }
      const cone = function (x, y) { return line(x, 268, x, y - 10, "#c9a15a", 1.2, 'stroke-dasharray="2 1.4"') + oval(x, y, 6, 11, "#6b3f22") + path("M" + (x - 5) + " " + (y - 4) + " l5 3 l5 -3 M" + (x - 5) + " " + (y + 2) + " l5 3 l5 -3", "none", 'stroke="#a8743f" stroke-width="1.2"'); }; // A pinecone weight on its chain.
      return rect(-64, 224, 78, 130, "#7a4a2a", 'rx="2"') + rect(-58, 230, 66, 124, "#a8743f") + rect(-52, 316, 54, 32, "none", 'stroke="#7a4a2a" stroke-width="2" rx="3"') + // Body and lower panel.
        oval(-35, 332, 8, 4, "#7a4a2a", 'transform="rotate(-30 -35 332)"') + oval(-15, 332, 8, 4, "#7a4a2a", 'transform="rotate(30 -15 332)"') + circle(-25, 334, 3, "#c9a15a") + // Carved leaves.
        path("M-76 228 L-25 180 L26 228 Z", "#6b3f22") + path("M-62 216 L-25 186 L12 216 M-50 222 L-25 200 L0 222", "none", 'stroke="#8a5a2a" stroke-width="2"') + path("M-76 228 L-25 180 L26 228", "none", 'stroke="#c9a15a" stroke-width="3" stroke-linejoin="round"') + // The roof.
        gear(-25, 178, 6, "#ffdc83", "#6b3f22") +
        rect(-38, 202, 6, 18, "#a8743f") + rect(-18, 202, 6, 18, "#a8743f") + path("M-32 220 V208 A7 7 0 0 1 -18 208 V220 Z", "#2a1c12") +                       // The hatch, doors open.
        circle(-25, 212, 5, "#ffdc83") + path("M-30 211 l-5 1.4 l5 1.4 Z", "#ff9d6b") + circle(-27, 210, 1, "#2a1c12") + path("M-24 207 l1 -4 l2 3", "none", 'stroke="#ff9d6b" stroke-width="1.2"') + // The cuckoo.
        circle(-25, 252, 17, "#fff1cd", 'stroke="#c9a15a" stroke-width="3"') + path(ticks, "none", 'stroke="#4a3524" stroke-width="1.4"') +
        path("M-25 252 L-25 241 M-25 252 L-17 256", "none", 'stroke="#4a3524" stroke-width="2" stroke-linecap="round"') + circle(-25, 252, 2, "#c8483e") +          // Dial and hands.
        path("M-25 269 L-22 300", "none", 'stroke="#c9a15a" stroke-width="2"') + circle(-22, 304, 7, "#ffdc83", 'stroke="#c9a15a" stroke-width="1.6"') + path(star(-24, 302, 3), "#fff8dc", 'class="lp-twinkle"') + // Pendulum, mid-swing.
        cone(-46, 296) + cone(-4, 292) + circle(4, 330, 4.5, "#ffdc83", 'stroke="#c9a15a" stroke-width="1.4"') + rect(-66, 350, 82, 5, "#5a3a20", 'rx="1"');      // Weights, knob and doorstep.
    },

    "hang-clockwork-pendulum": function () { // A brass gearbox on the ceiling swinging a big pendulum, with two loose cogs dangling on chains beside it.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.6)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .36) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      return path("M300 0 H360 L352 32 H308 Z", "#7a5a32") + gear(318, 20, 11, "#c9a15a", "#4a3524") + gear(342, 16, 8, "#c87a4a", "#4a3524") +                          // Gearbox.
        path("M308 104 Q330 116 352 104", "none", 'stroke="#ffdc83" stroke-width="1.4" stroke-dasharray="3 3" opacity=".5"') +                                          // The swing's path.
        group(line(330, 30, 330, 90, "#c9a15a", 2.6) + circle(330, 102, 14, "#ffdc83", 'stroke="#c9a15a" stroke-width="2.4"') + circle(330, 102, 8, "none", 'stroke="#c9a15a" stroke-width="1.5"') +
          path(star(326, 98, 4), "#fff8dc", 'class="lp-twinkle"'), 'transform="rotate(12 330 30)"') + circle(330, 30, 3, "#ffdc83") +                                  // The pendulum, caught mid-swing.
        line(292, 0, 292, 58, "#c9a15a", 1.2, 'stroke-dasharray="2.4 1.4"') + gear(292, 66, 8, "#c9a15a", "#4a3524") +
        line(368, 0, 368, 78, "#c9a15a", 1.2, 'stroke-dasharray="2.4 1.4"') + gear(368, 85, 6, "#c87a4a", "#4a3524") + circle(368, 85, 9, "#ff9d6b", 'opacity=".18" class="lp-twinkle"');
    },

    "table-clockwork-teapot": function () { // A brass side table with a gear in its stretcher, holding a copper wind-up teapot with a key in its lid, puffing steam.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.6)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .36) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      return rect(314, 330, 4, 32, "#8a6a3a") + rect(354, 330, 4, 32, "#8a6a3a") + line(318, 346, 354, 346, "#8a6a3a", 3) + gear(336, 346, 9, "#c9a15a", "#4a3524") + rect(308, 324, 56, 6, "#c9a15a", 'rx="2"') + // The table.
        oval(334, 323, 18, 2.5, "#4a3524", 'opacity=".5"') + path("M319 310 Q308 306 305 294 L309 292 Q313 302 321 304 Z", "#c87a4a") + path("M349 300 q12 0 10 12 q-2 8 -10 8", "none", 'stroke="#c9a15a" stroke-width="3"') + // Spout and handle.
        oval(334, 309, 18, 13, "#c87a4a") + path("M316 310 H352", "none", 'stroke="#ffdc83" stroke-width="2.2"') + path("M322 310 h.1 M330 310 h.1 M338 310 h.1 M346 310 h.1", "none", 'stroke="#8a4a2a" stroke-width="2.2" stroke-linecap="round"') + // Body, gold band, rivets.
        path("M323 298 Q334 288 345 298 Z", "#c9a15a") + rect(332, 282, 4, 10, "#c9a15a") + circle(328, 279, 4, "none", 'stroke="#ffdc83" stroke-width="2.6"') + circle(340, 279, 4, "none", 'stroke="#ffdc83" stroke-width="2.6"') + // Lid and its key.
        circle(326, 304, 2.4, "#fff", 'opacity=".45"') +
        circle(303, 286, 3.6, "#f4e8dc", 'opacity=".6" class="lp-twinkle"') + circle(299, 277, 4.6, "#f4e8dc", 'opacity=".45" class="lp-twinkle" style="animation-delay:.5s"') + circle(303, 267, 5.4, "#f4e8dc", 'opacity=".3" class="lp-twinkle" style="animation-delay:1s"'); // Steam.
    },

    "plant-clockwork-bloom": function () { // A mechanical flower: brass and copper petals round a tiny glowing clock, a copper stem with brass leaves, in a pot with a geared rim.
      let petals = "", inner = "";
      for (let i = 0; i < 8; i++) { petals += group(path("M0 -6 Q-7 -16 0 -25 Q7 -16 0 -6 Z", "#ffdc83", 'stroke="#c9a15a" stroke-width="1"'), 'transform="translate(18 296) rotate(' + i * 45 + ')"'); } // Outer petals.
      for (let i = 0; i < 8; i++) { inner += "M" + round(18 + Math.cos((i * 45 + 22.5) * Math.PI / 180) * 15) + " " + round(296 + Math.sin((i * 45 + 22.5) * Math.PI / 180) * 15) + " L18 296 "; }
      return circle(18, 296, 32, "#ff9d6b", 'opacity=".12"') + path("M18 372 Q12 348 18 330 Q24 314 18 304", "none", 'stroke="#c87a4a" stroke-width="3.2" stroke-linecap="round"') + // Glow and stem.
        path("M17 354 Q2 352 -7 338 Q8 338 17 350 Z M19 336 Q34 334 43 320 Q28 320 19 332 Z", "#c9a15a") + path("M15 351 Q4 346 -3 340 M21 333 Q32 328 39 323", "none", 'stroke="#8a6220" stroke-width="1"') + // Brass leaves.
        circle(18, 342, 4, "none", 'stroke="#ffdc83" stroke-width="2.2" stroke-dasharray="1.6 1.6"') + petals + path(inner, "none", 'stroke="#c87a4a" stroke-width="4" stroke-linecap="round"') + // A joint gear, petals and copper spokes.
        circle(18, 296, 7.5, "#fff1cd", 'stroke="#c9a15a" stroke-width="2" class="lp-neon"') + path("M18 296 V291 M18 296 L21.5 298", "none", 'stroke="#4a3524" stroke-width="1.3" stroke-linecap="round"') + // The little clock.
        path("M4 372 H32 L28 392 H8 Z", "#6b4a2f") + rect(2, 366, 32, 7, "#c9a15a", 'rx="2"') + path("M4 363 h4 v3 h-4Z M12 363 h4 v3 h-4Z M20 363 h4 v3 h-4Z M28 363 h4 v3 h-4Z", "#c9a15a") + // Pot and geared rim.
        path("M10 380 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0Z M23 380 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0Z", "#c9a15a");
    },

    "chest-clockwork-trunk": function () { // A brass-bound trunk with a gear for a lock and a wind-up key in its side, and a little tin bird perched on the lid.
      function gear(x, y, r, fill, hub) {
        const n = Math.max(6, Math.round(r / 1.6)), dash = round(Math.PI * r / n);
        return circle(x, y, r, "none", 'stroke="' + fill + '" stroke-width="' + round(r * .36) + '" stroke-dasharray="' + dash + " " + dash + '"') + circle(x, y, round(r * .84), fill) + circle(x, y, round(r * .3), hub);
      }
      return oval(92, 476, 40, 4, "#2a1c12", 'opacity=".5"') +
        rect(126, 452, 8, 4, "#c9a15a") + circle(138, 448, 5, "none", 'stroke="#ffdc83" stroke-width="3"') + circle(138, 460, 5, "none", 'stroke="#ffdc83" stroke-width="3"') + circle(134.5, 454, 2.6, "#ffdc83") + // The key in its side.
        rect(58, 442, 68, 32, "#7a5636", 'rx="3"') + path("M56 444 Q58 418 92 416 Q126 418 128 444 Z", "#8a6240") +                                   // Body and lid.
        path("M56 444 H128 M70 419 V474 M114 419 V474", "none", 'stroke="#c9a15a" stroke-width="3.4"') + path("M58 474 V464 H68 Z M126 474 V464 H116 Z", "#c9a15a") + // Bands and corners.
        gear(92, 457, 9, "#ffdc83", "#4a3524") + path("M91 455 h2 v5 h-2Z", "#4a3524") +                                                            // The gear lock.
        path("M100 410 l10 -3 l-3 5 Z", "#c87a4a") + oval(92, 411, 9, 6, "#ff9d6b") + circle(84, 405, 5, "#ff9d6b") + path("M79 404 l-5 1.4 l5 1.4 Z", "#ffdc83") + // The tin bird: tail, body, head, beak.
        circle(83, 403.5, 1, "#2a1c12") + path("M88 410 Q94 406 99 410 Q94 414 88 410 Z", "#ffdc83") + path("M92 405 V401 M90 400 h4", "none", 'stroke="#c9a15a" stroke-width="1.4" stroke-linecap="round"') + // Wing and back key.
        path("M89 417 v-3 M95 417 v-3", "none", 'stroke="#c9a15a" stroke-width="1.2"');
    },

    // Candy Catacombs set
    // Rare dungeon loot from the Candy Catacombs: gumdrop walls, liquorice arches, gummy skulls and spun-sugar cobwebs.
    // Palette: wall #5a2a4a, floor #7a3a62, pink #ffb3d1, sugar glow #fff1cd, liquorice #1c0b16 with a #5a3a50 twist.
    candySkull: function (x, y, s, fill, eye) { // A friendly gummy skull centred on its eyes, about 22 wide at scale 1.
      const ink = eye || "#3a1530";
      return group(
        path("M-11 1 Q-11 -14 0 -14 Q11 -14 11 1 Q11 7 6 8 V12 H-6 V8 Q-11 7 -11 1 Z", fill, 'opacity=".93"') +                                    // Head and jaw, one gummy piece.
        path("M-7.6 0 a3.3 3.6 0 1 0 6.6 0 a3.3 3.6 0 1 0 -6.6 0 Z M1 0 a3.3 3.6 0 1 0 6.6 0 a3.3 3.6 0 1 0 -6.6 0 Z", ink) +                      // Big round eyes.
        path("M-5.6 -1.4 a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0 Z M3 -1.4 a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0 Z", "#fff") +             // A shine in each eye keeps it friendly.
        path("M0 3.6 l-1.8 2.8 h3.6 Z", ink) + path("M-3 8.6 V12 M0 8.6 V12 M3 8.6 V12", "none", 'stroke="' + ink + '" stroke-width="1" opacity=".6"') + // Nose and teeth.
        path("M-7 -7 Q-5 -11 0 -11.6", "none", 'stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".55"'),                                // Gummy shine on the brow.
        'transform="translate(' + x + " " + y + ") scale(" + s + ')"');
    },
    candyLolly: function (x, y, r, fill, swirl) { // A swirl lollipop head: a disc with a spiral wound into it (two shapes).
      let d = "M" + x + " " + y;
      for (let a = .5; a <= 15.7; a += .5) d += " L" + round(x + Math.cos(a) * r * .9 * a / 15.7) + " " + round(y + Math.sin(a) * r * .9 * a / 15.7); // Two and a half turns out to the rim.
      return circle(x, y, r, fill) + path(d, "none", 'stroke="' + (swirl || "#fff1cd") + '" stroke-width="' + round(r * .16) + '" stroke-linecap="round" stroke-linejoin="round"');
    },
    candyGum: function (x, base, w, fill) { // A sugared gumdrop sitting on `base`, w wide each side, with a glint (two shapes).
      return path("M" + (x - w) + " " + base + " C" + (x - w) + " " + round(base - w * 1.7) + " " + (x + w) + " " + round(base - w * 1.7) + " " + (x + w) + " " + base + " Z", fill) +
        oval(round(x - w * .35), round(base - w * .8), round(w * .22), round(w * .32), "#fff", 'opacity=".5"');
    },

    "wall-candy-catacomb": function () { // Sugar-brick catacomb wall with icing dripping from the top, liquorice-twist arches holding gummy skulls and gumdrop candles, over a peppermint-trimmed wainscot.
      const roll = dice(311), arches = [50, 150, 250, 350];
      let mortar = "", light = "", drips = "M0 0 H400 V8";
      for (let row = 0; row < 12; row++) { // Twelve courses of sugar brick; each course's joints sit halfway along the last's.
        const top = row * 25, shift = row % 2 ? 50 : 25;
        mortar += "M0 " + (top + 25) + " H400 ";
        for (let x = shift; x < 400; x += 50) {
          mortar += "M" + x + " " + top + " V" + (top + 25) + " ";
          if (x + 50 < 400 && roll(0, 1) > .74) light += "M" + (x + 2) + " " + (top + 2) + " h46 v21 h-46 Z ";                       // Now and then a paler brick, never one over the join.
        }
      }
      for (let k = 9; k >= 0; k--) drips += " H" + (k * 40 + 30) + " v" + (6 + (k * 7) % 11) + " a4 4 0 0 1 -8 0 V8";                   // Icing drips, worked back from right to left; flat at both edges.
      const arch = function (x) { return "M" + (x - 30) + " 300 V204 Q" + (x - 30) + " 170 " + x + " 154 Q" + (x + 30) + " 170 " + (x + 30) + " 204 V300 "; }; // A pointed niche, open at the bottom.
      const outline = arches.map(arch).join("");
      const sprinkles = ["#ffb3d1", "#9be0b8", "#ffdc83"].map(function (colour, c) { // Sugar sprinkles on the brick, one shape per colour.
        return path(scatter(320 + c, 12, function (r) { const x = round(r(10, 388)), y = round(r(20, 146)), a = r(0, 6.28); return "M" + x + " " + y + " l" + round(Math.cos(a) * 5) + " " + round(Math.sin(a) * 5) + " "; }),
          "none", 'stroke="' + colour + '" stroke-width="2.6" stroke-linecap="round" opacity=".7"');
      }).join("");
      let inside = path(arches.map(function (x) { return "M" + (x - 24) + " 262 h48 v5 h-48 Z "; }).join(""), "#1c0b16") +              // A liquorice ledge in every niche.
        ART.candySkull(50, 247, 1.15, "#ffb3d1") + ART.candySkull(250, 247, 1.15, "#9be0b8", "#1f4a38");                                    // Gummy skulls in two of them...
      [150, 350].forEach(function (x, i) { // ...and a candle on a pile of gumdrops in the other two.
        inside += oval(x, 224, 24, 30, "#fff1cd", 'opacity=".13"') + ART.candyGum(x - 10, 262, 8, "#ff8ecb") + ART.candyGum(x + 10, 262, 8, "#ffdc83") + ART.candyGum(x, 255, 7, "#c9a8ff") +
          rect(x - 4, 226, 8, 20, "#fff1e0", 'rx="2"') + path("M" + (x - 4) + " 226 h8 v4 q-1 4 -2 0 q-1 5 -3 0 q-1 3 -3 0 Z", "#ffb3d1") +                       // Candle with pink icing run down it.
          path("M" + x + " 211 q5 7 0 13 q-5 -6 0 -13 Z", "#fff1cd", 'class="lp-twinkle" style="animation-delay:' + i * .7 + 's"');                                 // Flickering flame.
      });
      const studs = arches.map(function (x, i) { return ART.candyGum(x, 157, 6, ["#ff8ecb", "#9be0b8", "#ffdc83", "#c9a8ff"][i]); }).join("");     // A gumdrop on every arch's point.
      const panels = path([0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return "M" + (i * 50 + 7) + " 317 h36 v26 h-36 Z "; }).join(""), "#52264a", 'stroke="#2a1222" stroke-width="2"');
      return rect(0, 0, 400, 352, "#5a2a4a") + path(light, "#6a3458", 'opacity=".75"') + path(mortar, "none", 'stroke="#47203b" stroke-width="2"') + sprinkles +
        path(arches.map(function (x) { return arch(x) + "Z "; }).join(""), "#33142c") +                                                      // The dark niches.
        path(outline, "none", 'stroke="#1c0b16" stroke-width="9" stroke-linejoin="round"') + path(outline, "none", 'stroke="#5a3a50" stroke-width="9" stroke-dasharray="3 6" stroke-linejoin="round"') + // Liquorice twist round each.
        inside + studs +
        rect(0, 300, 400, 52, "#45203a") + panels + rect(0, 300, 400, 9, "#fff1e0") + line(0, 304.5, 400, 304.5, "#e8557a", 9, 'stroke-dasharray="10 10"') + // Wainscot with a peppermint rail; the stripes repeat every 20, so they meet at the join.
        rect(0, 346, 400, 6, "#2a1222") + path(drips + " H0 Z", "#ffb3d1");
    },

    "floor-candy-fudge": function () { // A harlequin floor of fudge diamonds in plum and rose, piped with liquorice grout, set with peppermint inlays and a dusting of twinkling sugar.
      let rose = "", gloss = "";
      for (let row = 0; row < 5; row++) for (let k = 0; k < 8; k++) { // The rose diamonds sit inside the tile (tips at multiples of 50); the plum ones between them are the ground.
        const x = 25 + k * 50, y = 365 + row * 30;
        rose += "M" + x + " " + (y - 15) + " L" + (x + 25) + " " + y + " L" + x + " " + (y + 15) + " L" + (x - 25) + " " + y + " Z ";
        gloss += "M" + (x - 12) + " " + (y - 3) + " L" + (x - 2) + " " + (y - 9) + " ";                                                       // A glossy glint on each.
      }
      const mint = function (x, y) { // A peppermint inlay, squashed to lie flat.
        return group(circle(0, 0, 9, "#fff1e0") + path("M0 0 L9 0 A9 9 0 0 1 -4.5 7.8 Z M0 0 L-4.5 -7.8 A9 9 0 0 1 4.5 -7.8 Z", "#e8557a"), 'transform="translate(' + x + " " + y + ') scale(1 .62)"');
      };
      return rect(0, 350, 400, 150, "#6a3156") + path(rose, "#8f4a76") + path(rose, "none", 'stroke="#2a1222" stroke-width="2.4" stroke-linejoin="round"') +
        path(gloss, "none", 'stroke="#ffd3e6" stroke-width="2" stroke-linecap="round" opacity=".35"') +
        mint(100, 380) + mint(300, 380) + mint(50, 440) + mint(350, 440) + mint(150, 470) + mint(250, 470) +                                  // Peppermints on plum diamonds, symmetric so none crosses the join.
        path(scatter(331, 18, function (r) { return star(round(r(8, 392)), round(r(362, 494)), round(r(1.8, 3.6))) + " "; }), "#fff1cd", 'class="lp-twinkle" opacity=".8"') +            // Sugar sparkles.
        rect(0, 350, 400, 6, "#2a1222") + rect(0, 350, 400, 3, "#ffb3d1", 'opacity=".6"');
    },

    "art-candy-calavera": function () { // A sugar-skull plaque in a liquorice-twist oval: heart eyes, a frosting flower on the brow, curly icing cheeks and gumdrop studs.
      const heart = function (x, y) { return "M" + x + " " + (y + 4) + " C" + (x - 7) + " " + (y - 1) + " " + (x - 4) + " " + (y - 6) + " " + x + " " + (y - 3) + " C" + (x + 4) + " " + (y - 6) + " " + (x + 7) + " " + (y - 1) + " " + x + " " + (y + 4) + " Z "; };
      const petals = [0, 1, 2, 3, 4].map(function (i) { const a = i / 5 * 6.283 - 1.57, x = round(69 + Math.cos(a) * 5), y = round(170 + Math.sin(a) * 5); return "M" + (x - 3) + " " + y + " a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 Z "; }).join("");
      return oval(69, 190, 37, 44, "#1c0b16") + oval(69, 190, 37, 44, "none", 'stroke="#5a3a50" stroke-width="6" stroke-dasharray="3 5"') + oval(69, 190, 31, 38, "#3a1530") + // Liquorice rim, its twist, dark backing.
        oval(69, 190, 31, 38, "none", 'stroke="#ffb3d1" stroke-width="1.5"') +
        path("M46 184 Q46 157 69 157 Q92 157 92 184 Q92 197 83 200 V211 Q69 218 55 211 V200 Q46 197 46 184 Z", "#fff1e8") +                      // The sugar skull.
        path("M51.5 185 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0 Z M71.5 185 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0 Z", "#3a1530") +            // Eye sockets...
        path(heart(59, 185) + heart(79, 185), "#ff8ecb") +                                                                                     // ...with pink hearts in them.
        path("M69 193 l-3 5 h6 Z", "#3a1530") + path("M58 204 H80 M61 201 V207 M65 201 V207 M69 201 V207 M73 201 V207 M77 201 V207", "none", 'stroke="#3a1530" stroke-width="1.2"') + // Nose and stitched teeth.
        path(petals, "#9be0b8") + circle(69, 170, 2.6, "#ffdc83") +                                                                            // A frosting flower on the brow.
        path("M52 196 q-4 -4 0 -7 q4 0 2 3 M86 196 q4 -4 0 -7 q-4 0 -2 3", "none", 'stroke="#c9a8ff" stroke-width="1.6" stroke-linecap="round"') + // Curly icing cheeks.
        path("M56 164 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M79 164 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M66 214 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 Z M70 214 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 Z", "#ffb3d1") +
        [[69, 146, "#ff8ecb"], [106, 190, "#9be0b8"], [69, 234, "#ffdc83"], [32, 190, "#c9a8ff"]].map(function (g) { return circle(g[0], g[1], 5, g[2]) + circle(g[0] - 1.6, g[1] - 1.6, 1.4, "#fff", 'opacity=".7"'); }).join(""); // Gumdrop studs.
    },

    "shelf-candy-skulls": function () { // A liquorice shelf on candy-cane hooks: a big raspberry gummy skull, a little apple one perched on a gumdrop, and a dripping birthday candle.
      const hooks = "M308 207 v6 a4 4 0 0 0 8 0 M368 207 v6 a4 4 0 0 1 -8 0";
      return oval(366, 176, 16, 22, "#fff1cd", 'opacity=".14"') +                                                                              // The candle's glow.
        ART.candySkull(313, 187, 1.08, "#ff8ecb") + ART.candyGum(341, 200, 8, "#c9a8ff") + ART.candySkull(341, 182, .62, "#9be0b8", "#1f4a38") +
        rect(361, 178, 10, 22, "#fff1e0", 'rx="2"') + path("M361 178 h10 v5 q-1.5 5 -3 0 q-1 6 -3 0 q-1.5 4 -4 0 Z", "#ffb3d1") + path("M366 163 q5 7 0 13 q-5 -6 0 -13 Z", "#fff1cd", 'class="lp-twinkle"') + // Candle, icing and flame.
        circle(329, 197, 3, "#ffdc83") + circle(354, 198, 2.4, "#ff8ecb") +                                                                     // Loose sweets.
        path(hooks, "none", 'stroke="#fff1e0" stroke-width="3" stroke-linecap="round"') + path(hooks, "none", 'stroke="#e8557a" stroke-width="3" stroke-dasharray="2.5 2.5"') + // Candy-cane brackets.
        rect(296, 200, 82, 7, "#1c0b16", 'rx="3"') + line(299, 203.5, 375, 203.5, "#5a3a50", 6, 'stroke-dasharray="3 5"');                    // The liquorice board and its twist.
    },

    "view-candy-graveyard": function () { // A sweet graveyard at dusk: liquorice spires and crypt domes on lilac hills, shortbread headstones with icing hearts, a candy-cane fence and lollipops, sprinkles drifting down.
      const spires = [18, 40, 100, 182, 220].map(function (x, i) { const top = [52, 62, 48, 58, 54][i]; return "M" + (x - 5) + " 96 V" + (top + 14) + " L" + x + " " + top + " L" + (x + 5) + " " + (top + 14) + " V96 Z "; }).join("") +
        "M58 96 V78 A12 12 0 0 1 82 78 V96 Z M130 96 V74 A16 16 0 0 1 162 74 V96 Z";                                                             // Spires and two crypt domes.
      const stones = [[14, 96], [52, 100], [92, 94], [134, 98], [174, 95], [212, 99]];
      const graves = stones.map(function (s) { return "M" + (s[0] - 7) + " 112 V" + (s[1] + 7) + " a7 7 0 0 1 14 0 V112 Z "; }).join("");
      const hearts = stones.map(function (s) { const x = s[0], y = s[1] + 9; return "M" + x + " " + (y + 3) + " c-5 -3 -3 -7 0 -5 c3 -2 5 2 0 5 Z "; }).join("");
      let posts = "M0 112 H240 M0 118 H240";
      for (let x = 8; x < 240; x += 16) posts += " M" + x + " 106 V126";                                                                        // The candy-cane fence.
      const sprinkles = function (seed, colour) { return path(scatter(seed, 9, function (r) { const x = round(r(2, 116)), y = round(r(0, 126)); return "M" + x + " " + y + " l2 3 "; }), "none", 'stroke="' + colour + '" stroke-width="2" stroke-linecap="round"'); };
      return view(["#c98ac0", "#ffd9c4"], ["#1a0c22", "#4a1f46"], 24,
        path(spires, "#4a2148") + hills(341, 92, 14, "#a8679a"),
        hills(342, 106, 14, "#d48ab2") + path(graves, "#f2d2a0") + path(graves, "none", 'stroke="#c99a6a" stroke-width="1.2"') + path(hearts, "#ff8ecb"),
        hills(343, 122, 6, "#7a3a62") + path(posts, "none", 'stroke="#fff1e0" stroke-width="3"') + path(posts, "none", 'stroke="#e8557a" stroke-width="3" stroke-dasharray="3 3"') +
          rect(37, 98, 3, 26, "#fff1e0") + ART.candyLolly(38.5, 96, 10, "#ff8ecb") + rect(150, 92, 3, 32, "#fff1e0") + ART.candyLolly(151.5, 90, 12, "#9be0b8", "#fff8f0") +
          ART.candyGum(100, 128, 7, "#ffdc83") + ART.candyGum(206, 128, 6, "#c9a8ff"),
        falling("snow", sprinkles(344, "#ffb3d1") + sprinkles(345, "#9be0b8") + sprinkles(346, "#fff1cd")));
    },

    "frame-candy-arch": function () { // A pointed liquorice-twist crypt arch studded with jelly beans, a gummy skull for its keystone and a peppermint sill dripping pink icing.
      const d = CLIPS["frame-candy-arch"];
      const on = function (t, left) { // A point on one side of the arch's curve (t = 0 at the spring, 1 at the peak).
        const u = 1 - t, x = u * u * 144 + 2 * u * t * 144 + t * t * 200, y = u * u * 152 + 2 * u * t * 116 + t * t * 96;
        return [round(left ? x : 400 - x), round(y)];
      };
      const beans = [[144, 212], [144, 186], [144, 162], on(.38, true), on(.72, true), [256, 212], [256, 186], [256, 162], on(.38, false), on(.72, false)];
      const colours = ["#ff8ecb", "#9be0b8", "#ffdc83", "#c9a8ff", "#ffa24a"];
      let stripes = "";
      for (let x = 138; x < 262; x += 12) stripes += "M" + x + " 224 l5 10 h5 l-5 -10 Z ";                                                       // Peppermint stripes along the sill.
      return path(d, "none", 'stroke="#1c0b16" stroke-width="10" stroke-linejoin="round"') + path(d, "none", 'stroke="#5a3a50" stroke-width="10" stroke-dasharray="3 6" stroke-linejoin="round"') +
        path(d, "none", 'stroke="#ffb3d1" stroke-width="1.6" stroke-linejoin="round" opacity=".8"') +                                          // Liquorice twist with a pink sugar edge.
        beans.map(function (b, i) { return oval(b[0], b[1], 4.2, 5.4, colours[i % 5]); }).join("") +
        path(beans.map(function (b) { return "M" + (b[0] - 2.4) + " " + (b[1] - 2) + " a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0 Z "; }).join(""), "#fff", 'opacity=".7"') + // A glint on every bean.
        ART.candySkull(200, 94, .78, "#ffb3d1") +
        rect(132, 224, 136, 10, "#fff1e0", 'rx="3"') + path(stripes, "#e8557a") +
        path("M150 234 v4 a3 3 0 0 0 6 0 v-4 Z M178 234 v7 a3 3 0 0 0 6 0 v-7 Z M214 234 v5 a3 3 0 0 0 6 0 v-5 Z M244 234 v8 a3 3 0 0 0 6 0 v-8 Z", "#ffb3d1") +         // Icing drips under the sill.
        path(star(236, 104, 4), "#fff1cd", 'class="lp-twinkle"') + path(star(164, 104, 3), "#fff1cd", 'class="lp-twinkle" style="animation-delay:.8s"');
    },

    "curtain-candy-floss": function () { // Candy-floss drapes on a liquorice rod with gumdrop ends: pink fluff, spun-sugar cobwebs in the top corners, gummy-skull tie-backs and one dangling gummy spider.
      const drape = function (flip, seed) {
        const fluff = function (sd, count, fill, opacity) { // Puffs of floss inside the panel, as one shape.
          return path(scatter(sd, count, function (r) {
            const y = r(94, 230), edge = y < 170 ? 160 - (y - 88) * .1 : 150 + (y - 170) * .1, x = r(129, edge), s = Math.round(r(4, 8));
            return "M" + round(x - s) + " " + round(y) + " a" + s + " " + s + " 0 1 0 " + 2 * s + " 0 a" + s + " " + s + " 0 1 0 " + -2 * s + " 0 Z ";
          }), fill, 'opacity="' + opacity + '"');
        };
        let web = "";
        const hub = [166, 89], spokes = [0, 22, 45, 68, 90].map(function (deg) { const a = deg * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; });
        spokes.forEach(function (s) { web += "M" + hub[0] + " " + hub[1] + " L" + round(hub[0] + s[0] * 34) + " " + round(hub[1] + s[1] * 34) + " "; });   // The web's threads...
        [11, 21, 31].forEach(function (r) { for (let i = 0; i < 4; i++) { const a = spokes[i], b = spokes[i + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];   // ...and its rings, sagging between threads.
          web += (i ? " Q" : "M" + round(hub[0] + a[0] * r) + " " + round(hub[1] + a[1] * r) + " Q") + round(hub[0] + m[0] * r * .78) + " " + round(hub[1] + m[1] * r * .78) + " " + round(hub[0] + b[0] * r) + " " + round(hub[1] + b[1] * r);
        } web += " "; });
        return group(
          path("M126 88 H166 Q152 130 156 170 Q146 202 158 236 H126 Z", "#ffb3d1", 'opacity=".94"') + fluff(seed, 14, "#ffd3e6", ".9") + fluff(seed + 1, 8, "#ff9cc4", ".55") +
          path("M136 92 Q132 140 138 168 Q132 204 140 234", "none", 'stroke="#e88ab0" stroke-width="1.6" opacity=".7"') +
          path(web, "none", 'stroke="#fff1cd" stroke-width=".9" opacity=".75"') +
          path("M126 166 Q142 178 156 168", "none", 'stroke="#1c0b16" stroke-width="3.5" stroke-linecap="round"') + ART.candySkull(156, 176, .5, flip ? "#9be0b8" : "#ffdc83", flip ? "#1f4a38" : "#5a3a10") + // Liquorice-lace tie-back and its charm.
          (flip ? "" : line(186, 117, 186, 140, "#fff1cd", .8, 'opacity=".8"') + path("M178 140 l4 3 M178 146 l4 -1 M194 140 l-4 3 M194 146 l-4 -1 M179 151 l4 -3 M193 151 l-4 -3", "none", 'stroke="#9be0b8" stroke-width="1.8" stroke-linecap="round"') +
            circle(186, 146, 5, "#9be0b8", 'opacity=".95"') + circle(184.2, 145, .9, "#1f4a38") + circle(187.8, 145, .9, "#1f4a38") + path("M184.5 148 q1.5 1.5 3 0", "none", 'stroke="#1f4a38" stroke-width=".8"')), // A gummy spider on its thread.
          flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      };
      return drape(false, 351) + drape(true, 353) + rect(120, 83, 160, 6, "#1c0b16", 'rx="3"') + line(123, 86, 277, 86, "#5a3a50", 6, 'stroke-dasharray="3 5"') +  // The liquorice rod...
        ART.candyGum(117, 92, 7, "#9be0b8") + ART.candyGum(283, 92, 7, "#ff8ecb");                                                                         // ...with a gumdrop at each end.
    },

    "lamp-candy-lollipop": function () { // A giant swirl lollipop glowing like spun sugar inside a cellophane wrap, tied with a bow, on a candy-stick pole and a mint gumdrop base.
      return oval(56, 258, 58, 54, "#fff1cd", 'opacity=".11"') + oval(56, 258, 42, 40, "#ffb3d1", 'opacity=".15" class="lp-twinkle"') +                        // Its glow.
        oval(56, 406, 26, 5, "#2a1222") + line(56, 290, 56, 386, "#fff1e0", 6) + line(56, 290, 56, 386, "#e8557a", 6, 'stroke-dasharray="6 6"') +                // Shadow and striped stick.
        ART.candyGum(56, 405, 22, "#9be0b8") + path("M44 392 h2 M58 386 h2 M66 396 h2 M50 399 h2", "none", 'stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"') + // Sugared base.
        ART.candyLolly(56, 256, 32, "#ff8ecb", "#fff1cd") + circle(56, 256, 32, "none", 'stroke="#e8557a" stroke-width="2"') + circle(56, 256, 14, "#fff1cd", 'opacity=".35"') +
        path("M50 300 Q16 292 18 256 Q20 216 56 214 Q92 216 94 256 Q96 292 62 300 Z", "#ffffff", 'opacity=".13" stroke="#ffffff" stroke-opacity=".45" stroke-width="1.2"') + // Cellophane.
        path("M28 246 Q30 230 40 224 M86 268 Q84 280 76 286", "none", 'stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity=".6"') +
        path("M56 300 L42 292 L44 307 Z M56 300 L70 292 L68 307 Z", "#ffb3d1") + circle(56, 300, 3.5, "#e8557a") +                                               // The bow.
        line(60, 303, 64, 315, "#1c0b16", 1) + ART.candySkull(64, 322, .48, "#9be0b8", "#1f4a38");                                                               // A little skull charm on a liquorice string.
    },

    "rug-candy-web": function () { // A round spun-sugar spiderweb rug in plum and pink with a sugar-pearl edge; a smiling gummy spider sits at one side and a wrapped bonbon at the other.
      let spokes = "", rings = "";
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283 + .26; spokes += "M0 0 L" + round(Math.cos(a) * 140) + " " + round(Math.sin(a) * 140) + " "; }
      [44, 80, 114, 140].forEach(function (r) { // Each ring sags a little toward the middle between threads.
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * 6.283 + .26, b = (i + 1) / 12 * 6.283 + .26, m = (a + b) / 2;
          rings += (i ? " Q" : "M" + round(Math.cos(a) * r) + " " + round(Math.sin(a) * r) + " Q") + round(Math.cos(m) * r * .88) + " " + round(Math.sin(m) * r * .88) + " " + round(Math.cos(b) * r) + " " + round(Math.sin(b) * r);
        }
        rings += " ";
      });
      return group(circle(0, 0, 154, "#3a1530") + circle(0, 0, 146, "#6e3358") + path(spokes, "none", 'stroke="#ffb3d1" stroke-width="6"') + path(rings, "none", 'stroke="#ffd3e6" stroke-width="5"') +
          circle(0, 0, 150, "none", 'stroke="#fff1cd" stroke-width="9" stroke-dasharray="0.1 16" stroke-linecap="round"'), 'transform="translate(200 440) scale(1 .27)"') + // Web and sugar pearls, squashed to lie flat.
        path("M306 442 l-10 -6 M306 446 l-12 0 M307 450 l-10 6 M330 442 l10 -6 M330 446 l12 0 M329 450 l10 6", "none", 'stroke="#7fd09a" stroke-width="2.6" stroke-linecap="round"') + // The spider's legs...
        oval(318, 448, 13, 9, "#9be0b8", 'opacity=".95"') + circle(318, 437, 7, "#9be0b8") + circle(315.4, 436, 1.5, "#1f4a38") + circle(320.6, 436, 1.5, "#1f4a38") +   // ...body and head...
        path("M315.5 440 q2.5 2 5 0", "none", 'stroke="#1f4a38" stroke-width="1"') + oval(312, 445, 3, 2, "#ffffff", 'opacity=".5"') +                                // ...and a smile.
        oval(86, 446, 10, 7, "#ff8ecb") + path("M76 446 L66 440 V452 Z M96 446 L106 440 V452 Z", "#ffb3d1") + path("M80 442 Q86 446 92 442", "none", 'stroke="#fff" stroke-width="1.6" opacity=".7"') + // A wrapped bonbon.
        ART.candyGum(132, 470, 5, "#ffdc83") + ART.candyGum(270, 472, 5, "#c9a8ff");
    },

    "bed-candy-coffin": function () { // A little chocolate coffin lined with pink satin, its lid propped open behind with a gummy skull and gumdrop studs; a pillow, a blanket and two bonbons.
      const bonbon = function (x, y, fill) { return oval(x, y, 7, 5, fill) + path("M" + (x - 6) + " " + y + " l-7 -4 v8 Z M" + (x + 6) + " " + y + " l7 -4 v8 Z", fill, 'opacity=".75"'); };
      return oval(340, 464, 58, 6, "#00000055") + circle(304, 460, 4, "#9be0b8") + circle(378, 456, 4, "#ff8ecb") +                                             // Shadow and gumdrop feet.
        path("M290 404 L304 384 H382 L392 402 L382 418 H304 Z", "#4a2238") + path("M296 404 L307 389 H379 L387 402 L379 413 H307 Z", "none", 'stroke="#ffb3d1" stroke-width="2" stroke-dasharray="4 3"') + // The lid, propped up behind.
        ART.candySkull(342, 400, .6, "#ffb3d1") + circle(300, 400, 3, "#ffdc83") + circle(384, 400, 3, "#9be0b8") + circle(316, 392, 2.4, "#c9a8ff") + circle(368, 392, 2.4, "#ff8ecb") +
        path("M290 428 L302 444 L382 440 L392 428 V442 L382 454 L302 458 L290 442 Z", "#3a1626") +                                                                  // The front wall.
        path("M302 444 L382 440 M302 444 V458 M382 440 V454", "none", 'stroke="#5a2a3a" stroke-width="1.4"') +
        path("M290 428 L302 414 L382 418 L392 428 L382 440 L302 444 Z", "#5a2a3a") + path("M297 428 L305 419 L379 422 L386 428 L379 436 L305 439 Z", "#ffb3d1") +       // Rim and satin lining.
        path("M320 420 V438 M336 420 V438 M352 421 V437", "none", 'stroke="#ff8ecb" stroke-width="1.2" stroke-dasharray="2 2"') + oval(314, 428, 10, 6, "#fff1e8") +   // Quilting and pillow.
        path("M348 421 L379 422 L386 428 L379 436 L348 438 Q343 430 348 421 Z", "#c9a8ff") + path("M356 421 V438 M366 421 V437 M376 422 V436", "none", 'stroke="#fff1e0" stroke-width="2" opacity=".6"') + // A striped blanket.
        path("M302 444 L382 440 V444 q-3 5 -6 0 q-3 6 -7 0 q-3 4 -6 0 L350 446 q-3 6 -6 0 L330 447 q-3 5 -6 0 L302 448 Z", "#ffb3d1") +                            // Icing piped over the front edge.
        bonbon(284, 460, "#ffdc83") + bonbon(392, 462, "#c9a8ff");
    },

    "door-candy-crypt": function () { // A pointed crypt door of chocolate squares inside a liquorice-twist arch, with a rose window of pink sugar glass and a gummy-skull knocker.
      const arch = "M-64 354 V252 Q-64 214 -25 192 Q14 214 14 252 V354";
      let squares = "", shine = "";
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) { // A bar of chocolate: fifteen squares, each lit along its top and left.
        const x = -55 + col * 20, y = 251 + row * 20;
        squares += "M" + (x + 1) + " " + (y + 1) + " h17 v17 h-17 Z ";
        shine += "M" + (x + 2) + " " + (y + 16) + " V" + (y + 2) + " H" + (x + 16) + " ";
      }
      const beans = [[-64, 336], [-64, 306], [-64, 276], [-58, 228], [-44, 206], [14, 336], [14, 306], [14, 276], [8, 228], [-6, 206], [-25, 192]];
      return oval(-25, 230, 30, 34, "#fff1cd", 'opacity=".08"') + path("M-58 354 V252 Q-58 219 -25 199 Q8 219 8 252 V354 Z", "#4a2228") + path(squares, "#5e3036") +
        path(shine, "none", 'stroke="#7a4a4a" stroke-width="1.5"') +
        circle(-25, 226, 14, "#2a1018") + circle(-25, 226, 12, "#ffb3d1", 'opacity=".85"') + path("M-25 214 V238 M-37 226 H-13 M-33.5 217.5 L-16.5 234.5 M-16.5 217.5 L-33.5 234.5", "none", 'stroke="#4a2228" stroke-width="1.8"') + // Rose window.
        circle(-25, 226, 4, "#fff1cd", 'class="lp-twinkle"') +
        path(arch, "none", 'stroke="#1c0b16" stroke-width="9" stroke-linejoin="round"') + path(arch, "none", 'stroke="#5a3a50" stroke-width="9" stroke-dasharray="3 6" stroke-linejoin="round"') +
        beans.map(function (b, i) { return oval(b[0], b[1], 3.6, 4.6, ["#ff8ecb", "#9be0b8", "#ffdc83", "#c9a8ff"][i % 4]); }).join("") +                           // Jelly beans studded round the arch.
        ART.candySkull(-25, 288, .72, "#9be0b8", "#1f4a38") + circle(-25, 305, 7, "none", 'stroke="#e8a94a" stroke-width="3"') +                                      // Knocker.
        ART.candyLolly(1, 320, 5, "#ff8ecb") + rect(-68, 350, 86, 6, "#2a1222", 'rx="1"') + path("M-66 350 h82 v2 q-3 4 -6 0 q-3 5 -7 0 q-3 3 -6 0 H-30 q-3 5 -6 0 H-66 Z", "#ffb3d1"); // Lollipop handle and an iced doorstep.
    },

    "hang-candy-bats": function () { // A mobile of smiling gummy bats in raspberry, apple and orange, hung from a liquorice twist, with sugar sparkles.
      const bat = function (x, y, s, fill, delay) {
        return line(x, 26, x, y - 8 * s, "#c9a8ff", 1) + group(
          path("M0 -2 C-5 -9 -13 -10 -21 -5 Q-17 -1 -18 5 Q-13 2 -10 7 Q-6 2 -2 5 Z M0 -2 C5 -9 13 -10 21 -5 Q17 -1 18 5 Q13 2 10 7 Q6 2 2 5 Z", fill, 'opacity=".9"') +     // Scalloped wings.
          path("M-7 0 Q-7 -8 -5 -13 L-2 -8 H2 L5 -13 Q7 -8 7 0 Q7 8 0 8 Q-7 8 -7 0 Z", fill) +                                                                         // Body and ears in one.
          path("M-4.6 -2 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z M.6 -2 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z", "#fff") + path("M-3.4 -1.6 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z M1.8 -1.6 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z", "#3a1530") +
          path("M-2.4 3 l1 2.6 l1 -2.6 Z M.4 3 l1 2.6 l1 -2.6 Z", "#fff") + path("M-5 -5 Q-4 -8 -1 -8.6", "none", 'stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".55"'), // Little fangs and a gummy shine.
          'transform="translate(' + x + " " + y + ") scale(" + s + ')"' + (delay ? ' class="lp-twinkle" style="animation-delay:' + delay + 's"' : ""));
      };
      return line(333, 0, 333, 21, "#c9a8ff", 1.2) + bat(302, 64, 1, "#ff6fa8", 0) + bat(334, 98, 1.15, "#8ee08a", 0) + bat(364, 58, .95, "#ffa24a", 0) +
        rect(294, 21, 78, 7, "#1c0b16", 'rx="3.5"') + line(297, 24.5, 369, 24.5, "#5a3a50", 6, 'stroke-dasharray="3 5"') +                                             // The liquorice bar.
        path(star(318, 84, 4) + " " + star(352, 116, 3.4) + " " + star(380, 88, 3), "#fff1cd", 'class="lp-twinkle"') + path(star(290, 104, 3.4), "#ffb3d1", 'class="lp-twinkle" style="animation-delay:.9s"');
    },

    "table-candy-gumballs": function () { // A raspberry gumball machine full of eyeball gumballs, all peeking toward Lumi, on a liquorice table with pink icing; one gumball has rolled loose.
      const balls = [[326, 293, 0], [337, 295, 1], [347, 290, 2], [322, 283, 1], [332, 284, 2], [343, 281, 0], [328, 273, 2], [340, 271, 1], [316, 320, 0]];
      const irisColours = ["#70b8eb", "#8ee08a", "#ff8ecb"];
      const dot = function (x, y, r) { return "M" + round(x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + 2 * r + " 0 a" + r + " " + r + " 0 1 0 " + -2 * r + " 0 Z "; };
      return ART.table("#2a1222") + path("M308 324 h56 v3 q-3 5 -6 0 q-3 7 -7 0 q-3 4 -6 0 q-3 6 -7 0 q-3 4 -6 0 H330 q-3 6 -7 0 q-3 4 -6 0 q-3 5 -6 0 H308 Z", "#ffb3d1") + // Table with icing.
        path("M321 324 L325 302 H345 L349 324 Z", "#c2406e") + rect(322, 299, 26, 5, "#8a2050", 'rx="2"') + rect(329, 306, 12, 7, "#e8c0d0", 'rx="1"') + circle(335, 318, 3.4, "#fff1e0") + // Base, chute and handle.
        path(balls.map(function (b) { return dot(b[0], b[1], 5.4); }).join(""), "#fff8f0") +                                                                      // Eyeball whites...
        irisColours.map(function (c, k) { return path(balls.filter(function (b) { return b[2] === k; }).map(function (b) { return dot(b[0] - 1.6, b[1] + .4, 2.8); }).join(""), c); }).join("") + // ...irises, all looking left...
        path(balls.map(function (b) { return dot(b[0] - 2, b[1] + .5, 1.2); }).join(""), "#2a1222") +                                                            // ...and pupils.
        circle(335, 283, 19, "#fff1e8", 'opacity=".16" stroke="#ffffff" stroke-width="1.6" stroke-opacity=".8"') + path("M322 274 Q326 267 334 265", "none", 'stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"') + // Glass globe.
        path("M324 267 Q335 257 346 267 Z", "#c2406e") + circle(335, 258, 3, "#ffb3d1");                                                                         // Cap.
    },

    "plant-candy-lolly": function () { // A little liquorice-twist tree with swirl lollipops for blossoms and gummy leaves, growing in a sugar-skull pot with heart eyes.
      const branches = "M18 368 Q14 346 20 328 Q24 312 17 297 M19 336 Q6 328 -3 313 M20 326 Q33 318 39 303";
      const leaves = [[6, 334, -40], [30, 326, 40], [12, 314, -20], [26, 344, 30], [-8, 322, -60]];
      return path(branches, "none", 'stroke="#1c0b16" stroke-width="5" stroke-linecap="round"') + path(branches, "none", 'stroke="#5a3a50" stroke-width="5" stroke-dasharray="2 4"') +
        leaves.map(function (l, i) { return oval(l[0], l[1], 4, 8, i % 2 ? "#8ee08a" : "#b5f0a8", 'opacity=".92" transform="rotate(' + l[2] + " " + l[0] + " " + l[1] + ')"'); }).join("") + // Gummy leaves.
        ART.candyLolly(17, 290, 11, "#ff8ecb") + ART.candyLolly(-5, 308, 9, "#c9a8ff") + ART.candyLolly(41, 297, 10, "#ffdc83", "#ff8ecb") +
        rect(0, 362, 36, 6, "#ffb3d1", 'rx="2"') + path("M2 368 H34 V378 Q34 392 18 392 Q2 392 2 378 Z", "#fff1e8") +                                              // The sugar-skull pot.
        path("M11 382 c-5 -3 -3 -7 0 -4.5 c3 -2.5 5 1.5 0 4.5 Z M25 382 c-5 -3 -3 -7 0 -4.5 c3 -2.5 5 1.5 0 4.5 Z", "#ff8ecb") + path("M18 383 l-1.6 2.6 h3.2 Z", "#3a1530") +
        path("M12 388 H24 M15 386.5 V389.5 M18 386.5 V389.5 M21 386.5 V389.5", "none", 'stroke="#3a1530" stroke-width="1"') + oval(10, 372, 3, 2, "#ffffff", 'opacity=".7"');
    },

    "chest-candy-crypt": function () { // A dark-chocolate treasure chest with liquorice straps and pink icing, flung open on gumdrops, candy corn, a lollipop and a peeking gummy skull.
      let squares = "";
      for (let col = 0; col < 6; col++) for (let row = 0; row < 2; row++) squares += "M" + (59 + col * 11.4) + " " + (447 + row * 13) + " h9.4 v11 h-9.4 Z ";   // Chocolate-bar squares on the front.
      return oval(92, 477, 48, 4, "#00000055") +
        path("M60 440 L63 413 Q92 399 121 413 L124 440 Z", "#4a2228") + path("M67 438 L69 418 Q92 407 115 418 L117 438 Z", "#5e3036") + path("M63 413 Q92 399 121 413", "none", 'stroke="#ffb3d1" stroke-width="2.5"') + // The open lid.
        line(73, 440, 71, 406, "#fff1e0", 2.5) + ART.candyLolly(71, 400, 9, "#9be0b8") +
        ART.candySkull(98, 431, .78, "#ffb3d1") + path("M116 424 L110 440 H122 Z", "#ffdc83") + path("M113 432 H119 L120 436 H112 Z", "#ffa24a") + path("M116 424 L114.6 428 H117.4 Z", "#fff1e0") + // Gummy skull and candy corn.
        ART.candyGum(80, 442, 7, "#ff8ecb") + ART.candyGum(110, 443, 6, "#c9a8ff") +
        rect(56, 440, 72, 34, "#4a2228", 'rx="3"') + path(squares, "#5e3036") + rect(66, 440, 8, 34, "#1c0b16") + rect(110, 440, 8, 34, "#1c0b16") +                      // Body and liquorice straps.
        path("M56 440 h72 v4 q-3 5 -6 0 q-3 7 -7 0 q-3 4 -6 0 q-3 6 -7 0 q-3 4 -6 0 q-3 5 -6 0 q-3 7 -7 0 q-3 4 -6 0 q-3 6 -7 0 q-3 4 -6 0 Z", "#ffb3d1") +          // Pink icing along the rim.
        path("M92 466 c-9 -6 -9 -14 -4 -15 q4 -1 4 3 q0 -4 4 -3 c5 1 5 9 -4 15 Z", "#ffdc83") + circle(92, 457, 1.6, "#4a2228") +                                    // Heart lock.
        path(star(128, 412, 4), "#fff1cd", 'class="lp-twinkle"') + path(star(54, 424, 3), "#fff1cd", 'class="lp-twinkle" style="animation-delay:.6s"');
    },

    // Toy Attic set
    // Rare dungeon loot from the Toy Attic: dusty boxes and timbers, old toys, a rocking horse that rocks alone, and friendly ghosts.
    // Palette: wall #33283d, floor #4a3a52, lavender #c9b0ff, lamp-gold #ffdc83, old wood #6a5068, sheet-white #f4eeff.
    atticGhost: function (x, y, s) { // A friendly little sheet ghost centred on its face, about 24 wide at scale 1 (five shapes).
      return group(
        oval(0, -3, 18, 20, "#c9b0ff", 'opacity=".14"') +                                                                                             // A soft glow around it.
        path("M-12 8 V-4 Q-12 -17 0 -17 Q12 -17 12 -4 V8 q-3 4 -6 0 q-3 4 -6 0 q-3 4 -6 0 q-3 4 -6 0 Z", "#f4eeff", 'opacity=".94"') +              // The sheet, with a wavy hem.
        path("M-6.6 -4 a2 2.6 0 1 0 4 0 a2 2.6 0 1 0 -4 0 Z M2.6 -4 a2 2.6 0 1 0 4 0 a2 2.6 0 1 0 -4 0 Z", "#3d2450") +                              // Eyes.
        path("M-10 1 a2.4 1.4 0 1 0 4.8 0 a2.4 1.4 0 1 0 -4.8 0 Z M5.2 1 a2.4 1.4 0 1 0 4.8 0 a2.4 1.4 0 1 0 -4.8 0 Z", "#ffb3d1", 'opacity=".75"') + // Rosy cheeks.
        path("M-2 1.5 q2 2.5 4 0", "none", 'stroke="#3d2450" stroke-width="1.2" stroke-linecap="round"'),                                              // A small smile.
        'transform="translate(' + x + " " + y + ") scale(" + s + ')"');
    },

    "wall-attic-rafters": function () { // Old plank walls framed by attic timbers, faintly stencilled with ghosts and stars, paper bunting along the beam, cobwebs in the corners and drifting gold dust.
      let planks = "", stencil = "", stars = "", webs = "", boards = "";
      for (let x = 20; x < 400; x += 40) planks += "M" + x + " 22 V288 ";                                                                       // Plank joints, never on the tile's edge.
      for (let x = 12.5; x < 400; x += 25) boards += "M" + x + " 294 V352 ";                                                                    // Wainscot boards.
      [[50, 84], [200, 84], [350, 84], [50, 204], [200, 204], [350, 204]].forEach(function (p) { // Faded stencilled ghosts...
        const x = p[0], y = p[1];
        stencil += "M" + (x - 7) + " " + (y + 6) + " V" + (y - 2) + " Q" + (x - 7) + " " + (y - 11) + " " + x + " " + (y - 11) + " Q" + (x + 7) + " " + (y - 11) + " " + (x + 7) + " " + (y - 2) + " V" + (y + 6) + " l-3.5 -2.5 l-3.5 2.5 l-3.5 -2.5 l-3.5 2.5 Z ";
      });
      [[150, 144], [250, 144], [150, 264], [250, 264], [125, 84], [275, 204]].forEach(function (p) { stars += star(p[0], p[1], 6) + " "; });   // ...and stars between them.
      [[108, 22, 1], [92, 22, -1], [308, 22, 1], [292, 22, -1]].forEach(function (w) { // A small cobweb in each corner between a post and the beam.
        const cx = w[0], cy = w[1], d = w[2];
        [0, 30, 60, 90].forEach(function (deg) { const a = deg * Math.PI / 180; webs += "M" + cx + " " + cy + " l" + round(d * Math.cos(a) * 20) + " " + round(Math.sin(a) * 20) + " "; });
        [8, 15].forEach(function (r) { webs += "M" + (cx + d * r) + " " + cy + " Q" + round(cx + d * r * .62) + " " + round(cy + r * .38) + " " + round(cx + d * r * .5) + " " + round(cy + r * .87) + " Q" + round(cx + d * r * .32) + " " + round(cy + r * .78) + " " + cx + " " + (cy + r) + " "; });
      });
      const flags = ["#ffdc83", "#c9b0ff", "#f4eeff"].map(function () { return ""; });
      [0, 200].forEach(function (x0) { for (let i = 0; i < 8; i++) { // Paper flags hanging along two swags of string; each flag tilts with the string.
        const t = (i + .5) / 8, x = x0 + 200 * t, y = 22 + 60 * t * (1 - t), a = Math.atan(.3 * (1 - 2 * t));                                  // A point on the swag, and the string's slope there.
        const pt = function (dx, dy) { return round(x + dx * Math.cos(a) - dy * Math.sin(a)) + " " + round(y + dx * Math.sin(a) + dy * Math.cos(a)); };
        flags[i % 3] += "M" + pt(-5, 0) + " L" + pt(5, 0) + " L" + pt(0, 11) + " Z ";
      } });
      return rect(0, 0, 400, 352, "#33283d") + path(planks, "none", 'stroke="#2a2033" stroke-width="2"') +
        path(stencil, "#c9b0ff", 'opacity=".12"') + path(stars, "#ffdc83", 'opacity=".14"') +
        path("M100 70 L58 22 M100 70 L142 22 M300 70 L258 22 M300 70 L342 22", "none", 'stroke="#4a3848" stroke-width="10"') +              // Knee braces from each post up to the beam.
        rect(92, 22, 16, 270, "#4a3848") + rect(292, 22, 16, 270, "#4a3848") + rect(104, 22, 4, 270, "#3b2c3c") + rect(304, 22, 4, 270, "#3b2c3c") + // Two posts per tile.
        path(webs, "none", 'stroke="#e6dcf5" stroke-width=".8" opacity=".45"') +
        rect(0, 0, 400, 22, "#4a3848") + rect(0, 18, 400, 4, "#2a2033") + path("M10 8 H120 M160 12 H300 M326 7 H390", "none", 'stroke="#56435a" stroke-width="2"') + // The roof beam and its grain.
        path("M0 22 Q100 52 200 22 Q300 52 400 22", "none", 'stroke="#c9b0ff" stroke-width="1" opacity=".6"') +
        flags.map(function (d, i) { return path(d, ["#ffdc83", "#c9b0ff", "#f4eeff"][i], 'opacity=".8"'); }).join("") +
        rect(0, 290, 400, 62, "#2a2133") + path(boards, "none", 'stroke="#231b2b" stroke-width="2"') + rect(0, 286, 400, 6, "#4a3a52") + rect(0, 286, 400, 1.5, "#c9b0ff", 'opacity=".3"') + // Wainscot and rail.
        path(scatter(411, 14, function (r) { const x = round(r(8, 392)), y = round(r(30, 280)), rr = round(r(.8, 1.8)); return "M" + round(x - rr) + " " + y + " a" + rr + " " + rr + " 0 1 0 " + round(2 * rr) + " 0 a" + rr + " " + rr + " 0 1 0 " + round(-2 * rr) + " 0 Z "; }), "#ffdc83", 'opacity=".5" class="lp-twinkle"') +
        path(scatter(412, 12, function (r) { const x = round(r(8, 392)), y = round(r(30, 280)); return "M" + (x - 1) + " " + y + " a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 Z "; }), "#ffdc83", 'opacity=".45" class="lp-twinkle" style="animation-delay:1s"'); // Drifting dust motes.
    },

    "floor-attic-planks": function () { // Wide dusty floorboards with nail heads and knots, a pale patch of lamplight, and a trail of little paw prints through the dust.
      let joints = "", nails = "", light = "", knots = "";
      const dot = function (x, y, r) { return "M" + round(x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + 2 * r + " 0 a" + r + " " + r + " 0 1 0 " + -2 * r + " 0 Z "; };
      for (let row = 0; row < 5; row++) {
        const y = 354 + row * 29, starts = [70, 150, 30, 110, 190][row];
        joints += "M0 " + (y + 29) + " H400 ";
        const ends = [];
        for (let x = starts; x < 400; x += 160) { joints += "M" + x + " " + y + " V" + (y + 29) + " "; nails += dot(x - 5, y + 6, 1.3) + dot(x - 5, y + 23, 1.3) + dot(x + 5, y + 6, 1.3) + dot(x + 5, y + 23, 1.3); ends.push(x); }
        for (let j = row % 2; j < ends.length - 1; j += 2) light += "M" + (ends[j] + 1) + " " + (y + 1) + " H" + (ends[j + 1] - 1) + " V" + (y + 28) + " H" + (ends[j] + 1) + " Z "; // Every other inner board a shade paler.
      }
      [[48, 370], [236, 400], [330, 430], [120, 458], [266, 486]].forEach(function (k) { knots += "M" + (k[0] - 6) + " " + k[1] + " a6 2.6 0 1 0 12 0 a6 2.6 0 1 0 -12 0 Z "; });
      let paws = "";
      for (let i = 0; i < 9; i++) { // A wandering trail of paw prints, one shape.
        const x = 30 + i * 42, y = round(486 - i * 11 + (i % 2 ? -7 : 7));
        paws += "M" + (x - 4) + " " + y + " a4 3.2 0 1 0 8 0 a4 3.2 0 1 0 -8 0 Z " + dot(x - 5, y - 5, 1.6) + dot(x - 1.8, y - 7.2, 1.6) + dot(x + 1.8, y - 7.2, 1.6) + dot(x + 5, y - 5, 1.6);
      }
      return rect(0, 350, 400, 150, "#4a3a52") + path(light, "#54445c") + path(knots, "#3e3046") + path(joints, "none", 'stroke="#2e2436" stroke-width="2"') + path(nails, "#2a2033") +
        path("M150 356 H250 L320 498 H210 Z", "#ffdc83", 'opacity=".06"') + oval(80, 430, 60, 16, "#c9b0ff", 'opacity=".05"') + oval(330, 470, 50, 12, "#c9b0ff", 'opacity=".05"') + // Lamplight and dust.
        path(paws, "#c9b0ff", 'opacity=".24"') + rect(0, 350, 400, 5, "#2a2033") + rect(0, 350, 400, 2, "#c9b0ff", 'opacity=".3"');
    },

    "art-attic-ghostgrandpa": function () { // A dusty gilt oval portrait of a very proper ghost grandpa in a top hat, monocle and moustache, hanging a little crooked, with a cobweb on the corner.
      return path("M69 142 L44 158 M69 142 L94 158", "none", 'stroke="#8a7aa8" stroke-width="1"') + circle(69, 142, 2, "#b89a5a") +                    // Picture wire and nail.
        group(
          oval(69, 190, 36, 43, "#b89a5a") + oval(69, 190, 36, 43, "none", 'stroke="#ffdc83" stroke-width="2.4" stroke-dasharray=".1 5" stroke-linecap="round"') + oval(69, 190, 30, 37, "#3a2c48") + // Gilt frame with beading, dark backdrop.
          oval(69, 214, 26, 12, "#4a3a5a") + ART.atticGhost(69, 202, 1.55) +
          rect(59, 158, 20, 15, "#1f1828", 'rx="2"') + rect(59, 167, 20, 3, "#c9b0ff") + rect(53, 172, 32, 3.5, "#1f1828", 'rx="1.5"') +            // Top hat.
          circle(76.2, 195.8, 5, "none", 'stroke="#ffdc83" stroke-width="1.4"') + path("M81 197 Q84 206 80 214", "none", 'stroke="#ffdc83" stroke-width=".8"') + // Monocle on a chain.
          path("M69 201 q-5 -3 -10 1 q4 3 10 0 q6 3 10 0 q-5 -4 -10 -1 Z", "#8a7aa8") + path("M69 215 l-6 -3.5 v7 Z M69 215 l6 -3.5 v7 Z", "#c9b0ff"), // Moustache and bow tie.
          'transform="rotate(-4 69 146)"') +
        path("M100 168 L88 158 M100 168 L94 154 M100 168 L100 152 M89 160 Q95 162 95 156 M93 163 Q99 164 98 158", "none", 'stroke="#e6dcf5" stroke-width=".8" opacity=".6"'); // Cobweb on the corner.
    },

    "shelf-attic-jackbox": function () { // A ghost-in-the-box popped up on its spring, a stack of wooden picture blocks and a glass marble, on a dusty old board.
      return rect(301, 180, 26, 20, "#8a6aa8", 'rx="1.5"') + path("M314 182 L322 190 L314 198 L306 190 Z", "#ffdc83", 'opacity=".8"') + path("M301 180 L292 165 L296 163 L305 180 Z", "#a888c8") + // Box, its diamond and the open lid.
        path("M327 190 h5 v-6", "none", 'stroke="#b89a5a" stroke-width="2"') + circle(332, 183, 2.2, "#ffdc83") +                                    // Crank.
        path("M314 180 l-5 -2.4 l10 -2.4 l-10 -2.4 l10 -2.4 l-5 -2.4", "none", 'stroke="#d9d0e8" stroke-width="1.6" stroke-linejoin="round"') + ART.atticGhost(314, 163, .6) +
        rect(338, 186, 13, 14, "#c9b0ff", 'rx="1"') + rect(352, 186, 13, 14, "#ffdc83", 'rx="1"') + rect(345, 172, 13, 14, "#d98aa8", 'rx="1"') +       // Picture blocks...
        path(star(344.5, 193, 4) + " M358.5 196 c-5 -3 -3 -7 0 -4.5 c3 -2.5 5 1.5 0 4.5 Z M352 175 a4 4 0 1 0 0 8 a3 3 0 1 1 0 -8 Z", "#4a3a52") + // ...with a star, a heart and a moon.
        circle(372, 196, 4, "#70b8eb", 'opacity=".8"') + path("M369 195 q3 -3 6 1", "none", 'stroke="#fff" stroke-width="1.2" opacity=".8"') +           // Marble.
        rect(296, 200, 82, 6, "#6a5068", 'rx="2"') + line(298, 200.6, 376, 200.6, "#c9b0ff", 1, 'opacity=".35"') +
        path("M304 206 l6 10 M370 206 l-6 10", "none", 'stroke="#6a5068" stroke-width="3" stroke-linecap="round"');
    },

    "view-attic-rooftops": function () { // Over the rooftops from the attic: a lavender town far off, gabled houses with warm windows and smoking chimneys, and our own shingles where a little ghost sits watching.
      const houses = [[8, 30, 24], [52, 34, 18], [100, 28, 28], [146, 36, 20], [196, 30, 26]];
      let walls = "", roofs = "", lit = "", stacks = "", smoke = "";
      houses.forEach(function (h, i) {
        const x = h[0], w = h[1], top = 114 - h[2];
        walls += "M" + x + " 118 V" + top + " H" + (x + w) + " V118 Z ";
        roofs += "M" + (x - 3) + " " + (top + 1) + " L" + (x + w / 2) + " " + (top - 14) + " L" + (x + w + 3) + " " + (top + 1) + " Z ";
        stacks += "M" + round(x + w * .68) + " " + (top - 4) + " V" + (top - 16) + " h5 V" + (top - 2) + " Z ";
        lit += "M" + (x + 5) + " " + (top + 6) + " h5 v6 h-5 Z " + (w > 29 ? "M" + (x + w - 10) + " " + (top + 6) + " h5 v6 h-5 Z " : "");
        if (i % 2 === 0) smoke += "M" + round(x + w * .68 + 2.5) + " " + (top - 18) + " q-4 -5 0 -9 q4 -4 0 -9 ";
      });
      return view(["#a796d6", "#ffd3a8"], ["#120e28", "#3a2c5a"], 26,
        skyline(431, 94, 12, 30, "#8a7ab8", "#ffe6a8"),
        path(stacks, "#3a2c4a") + path(roofs, "#4a3858") + path(walls, "#6a5a8a") + path(lit, "#ffdc83") + path(smoke, "none", 'stroke="#e6dcf5" stroke-width="2" stroke-linecap="round" opacity=".45"') + hills(432, 118, 3, "#3e3150"),
        waves(116, "#5a4466", 4) + waves(126, "#46355a", 4) + rect(68, 92, 12, 26, "#3a2c4a") + rect(66, 90, 16, 4, "#5a4466") + ART.atticGhost(150, 106, .55));
    },

    "frame-attic-dormer": function () { // A gabled dormer window in weathered lavender wood under a shingled cap, with cross bars, a cobweb in one pane and a candle stub on the sill.
      const d = CLIPS["frame-attic-dormer"];
      return path("M122 156 L200 84 L278 156 L268 160 L200 98 L132 160 Z", "#4a3a52") + path("M128 156 L200 90 L272 156", "none", 'stroke="#5e4a66" stroke-width="4" stroke-dasharray="5 3"') + // The shingled cap.
        path(d, "none", 'stroke="#6a5068" stroke-width="8" stroke-linejoin="round"') + path(d, "none", 'stroke="#c9b0ff" stroke-width="1.5" stroke-linejoin="round" opacity=".55"') +
        line(200, 102, 200, 226, "#6a5068", 3.5) + line(142, 172, 258, 172, "#6a5068", 3.5) +                                                     // Cross bars.
        path("M146 222 L146 200 M146 222 L162 206 M146 222 L168 222 M146 212 Q152 214 154 214 Q154 218 157 222 M146 204 Q156 206 158 210 Q162 216 162 222", "none", 'stroke="#e6dcf5" stroke-width=".8" opacity=".7"') + // Cobweb in the corner.
        circle(200, 82, 4, "#ffdc83") + rect(132, 224, 136, 9, "#6a5068", 'rx="3"') + rect(132, 224, 136, 2.5, "#8a7090", 'rx="1"') +
        oval(244, 210, 13, 15, "#ffdc83", 'opacity=".18"') + oval(244, 224, 7, 2, "#b89a5a") + rect(241, 212, 6, 12, "#f4eeff", 'rx="1.5"') + path("M244 202 q4 5 0 9 q-4 -4 0 -9 Z", "#ffdc83", 'class="lp-twinkle"'); // Candle stub.
    },

    "curtain-attic-sheets": function () { // Two old dust sheets hung from a broom-handle rod, which turn out to be friendly ghosts: open eyes on one, a wink on the other, rosy cheeks, a darned patch and wavy hems.
      const sheet = function (flip) {
        return group(
          path("M126 88 H168 Q158 128 164 168 Q170 204 162 236 q-4.5 -6 -9 0 q-4.5 -6 -9 0 q-4.5 -6 -9 0 q-4.5 -6 -9 0 V88 Z", "#ece4f7", 'opacity=".95"') +
          path("M136 92 Q132 160 137 230 M150 92 Q144 150 149 232", "none", 'stroke="#c9b0ff" stroke-width="1.5" opacity=".7"') +                   // Folds.
          (flip ? path("M139 139 q2.5 -3 5 0", "none", 'stroke="#3d2450" stroke-width="1.6" stroke-linecap="round"') : path("M139 139 a2.2 3 0 1 0 4.4 0 a2.2 3 0 1 0 -4.4 0 Z", "#3d2450")) + // A wink on one side.
          path("M151 139 a2.2 3 0 1 0 4.4 0 a2.2 3 0 1 0 -4.4 0 Z", "#3d2450") + path("M135 146 a3 1.7 0 1 0 6 0 a3 1.7 0 1 0 -6 0 Z M154 146 a3 1.7 0 1 0 6 0 a3 1.7 0 1 0 -6 0 Z", "#ffb3d1", 'opacity=".75"') +
          path("M144.5 148 q2.5 3 5 0", "none", 'stroke="#3d2450" stroke-width="1.3" stroke-linecap="round"') +
          (flip ? "" : rect(131, 196, 14, 12, "#c9b0ff", 'rx="1" stroke="#8a6aa8" stroke-width="1" stroke-dasharray="2 2"')),                       // A darned patch.
          flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      };
      return sheet(false) + sheet(true) + rect(118, 83, 154, 5, "#a8845a", 'rx="2.5"') + circle(118, 85.5, 4, "#8a6a4a") +                             // The broom handle...
        path("M270 81 L290 75 V96 L270 90 Z", "#d9b86a") + path("M274 81 V89 M279 80 V91 M284 78 V93", "none", 'stroke="#b8964a" stroke-width="1"') + rect(266, 80, 6, 11, "#c0495e", 'rx="1"') + // ...and its bristles.
        path(star(200, 104, 3) + " " + star(186, 214, 2.4) + " " + star(218, 190, 2.4), "#ffdc83", 'class="lp-twinkle" opacity=".8"');
    },

    "lamp-attic-fringe": function () { // A tall old standing lamp with a fringed lavender shade glowing gold; a shy little ghost dangles from the pull-chain.
      return oval(54, 276, 58, 54, "#ffdc83", 'opacity=".12"') + path("M30 292 L8 400 H100 L78 292 Z", "#ffdc83", 'opacity=".06"') +                     // Glow and a cone of light.
        oval(54, 405, 22, 5, "#2a2033") + path("M38 405 Q54 388 70 405 Z", "#b89a5a") + rect(51, 290, 5, 106, "#b89a5a") + rect(48.5, 334, 10, 4, "#ffdc83", 'rx="2"') + rect(48.5, 366, 10, 4, "#ffdc83", 'rx="2"') +
        oval(54, 291, 25, 4, "#fff4cf", 'opacity=".9"') +                                                                                          // The bright underside of the shade.
        path("M26 290 L36 250 H72 L82 290 Z", "#c9b0ff") + path("M36 250 H72 L74 258 H34 Z", "#b49ae8") + path("M44 252 L40 290 M54 252 V290 M64 252 L68 290", "none", 'stroke="#a88ad8" stroke-width="1.4"') +
        line(26, 295, 82, 295, "#ffdc83", 8, 'stroke-dasharray="1.6 1.8"') + path("M28 290 H80", "none", 'stroke="#b89a5a" stroke-width="2"') +        // Fringe.
        rect(52, 243, 3, 8, "#b89a5a") + circle(53.5, 242, 3, "#ffdc83") +
        line(73, 296, 73, 320, "#b89a5a", 1.2, 'stroke-dasharray="2 1.5"') + circle(73, 321, 1.8, "#ffdc83") + ART.atticGhost(74, 334, .55);         // Pull-chain and the ghost hanging on.
    },

    "rug-attic-hooked": function () { // A hand-hooked rug in faded lavender: a ghost at one end, a crescent moon at the other, stars between, a checked border and woolly fringe.
      let fringe = "";
      for (let y = 416; y <= 466; y += 4) fringe += "M74 " + y + " H64 M326 " + y + " H336 ";                                                       // Woolly fringe at both ends, one shape.
      const ghost = "M0 13 V-2 Q0 -12 11 -12 Q22 -12 22 -2 V13 l-3.7 -3 l-3.7 3 l-3.7 -3 l-3.7 3 l-3.6 -3 Z";
      return path(fringe, "none", 'stroke="#e6dcf5" stroke-width="1.6"') + rect(74, 412, 252, 58, "#8a72b0", 'rx="4"') +
        rect(79, 417, 242, 48, "none", 'stroke="#f4eeff" stroke-width="4" stroke-dasharray="6 6"') + rect(85, 423, 230, 36, "#6a5490", 'rx="2"') +       // Checked border and field.
        group(path(ghost, "#f4eeff") + path("M5.5 -1 a1.6 2.2 0 1 0 3.2 0 a1.6 2.2 0 1 0 -3.2 0 Z M13.3 -1 a1.6 2.2 0 1 0 3.2 0 a1.6 2.2 0 1 0 -3.2 0 Z", "#3d2450"), 'transform="translate(128 439)"') + // The ghost...
        path("M262 428 A13 13 0 1 0 272 450 A11 11 0 1 1 262 428 Z", "#ffdc83") +                                                                   // ...and the moon, both clear of the chest and bed.
        path(star(104, 432, 4) + " " + star(102, 452, 3) + " " + star(180, 450, 3) + " " + star(222, 432, 3.4) + " " + star(296, 449, 4) + " " + star(298, 430, 3), "#ffdc83", 'opacity=".9"') +
        path("M92 418 l4 4 M308 418 l-4 4", "none", 'stroke="#f4eeff" stroke-width="1"');
    },

    "bed-attic-cradle": function () { // An old wooden doll's cradle that rocks all by itself: a lavender hood with a frill, a patchwork quilt and a ghost teddy tucked in.
      let rose = "", gold = "", lilac = "";
      for (let col = 0; col < 6; col++) for (let row = 0; row < 3; row++) { // Patchwork, one shape per cloth.
        const d = "M" + (331 + col * 9.4) + " " + (414 + row * 9) + " h9.4 v9 h-9.4 Z ", k = (col + row) % 3;
        if (k === 0) rose += d; else if (k === 1) gold += d; else lilac += d;
      }
      return oval(340, 468, 54, 5, "#00000055") + path("M280 446 q-6 7 -3 15 M400 446 q4 7 1 15", "none", 'stroke="#c9b0ff" stroke-width="1.6" stroke-linecap="round" opacity=".55"') + // Rocking marks.
        group(
          path("M284 452 Q340 478 396 452", "none", 'stroke="#5e4660" stroke-width="6" stroke-linecap="round"') + path("M286 451 Q340 475 394 451", "none", 'stroke="#9a7a92" stroke-width="1.5"') + // The rocker.
          path("M306 446 L302 460 M374 446 L378 460", "none", 'stroke="#6a5068" stroke-width="4" stroke-linecap="round"') +
          path("M292 418 V398 Q292 380 314 378 Q332 380 334 398 V418 Z", "#c9b0ff") + path("M300 418 V400 M312 418 V384 M324 418 V392", "none", 'stroke="#a88ad8" stroke-width="1.4"') + // The hood...
          path("M292 400 Q292 382 314 380 Q332 382 334 398", "none", 'stroke="#f4eeff" stroke-width="5" stroke-dasharray=".1 6" stroke-linecap="round"') + // ...and its frill.
          oval(318, 412, 12, 6, "#fff4e8") + circle(352, 401, 4, "#f0deff", 'opacity=".75"') + circle(366, 401, 4, "#f0deff", 'opacity=".75"') + circle(359, 408, 8, "#f0deff", 'opacity=".85"') + // Pillow and the ghost teddy.
          circle(356, 407, 1.3, "#3d2450") + circle(362, 407, 1.3, "#3d2450") + path("M357.5 411 q1.5 1.5 3 0", "none", 'stroke="#3d2450" stroke-width="1"') +
          path("M296 450 L292 418 H388 L384 450 Z", "#7a5f78") + path("M304 420 V449 M316 420 V449 M328 420 V449", "none", 'stroke="#5e4660" stroke-width="2"') + // The cradle's side and slats.
          path(rose, "#d98aa8") + path(gold, "#ffdc83") + path(lilac, "#c9b0ff") + path("M331 413 H387 V441 Q378 446 370 441 Q360 446 350 441 Q340 446 331 441 Z", "none", 'stroke="#f4eeff" stroke-width="1" stroke-dasharray="2 2"') + // Quilt.
          rect(288, 414, 104, 6, "#9a7a92", 'rx="3"') + circle(290, 412, 4, "#ffdc83") + circle(390, 412, 4, "#ffdc83"),                         // Top rail and brass knobs.
          'transform="rotate(-3 340 462)"') +
        path(star(392, 386, 3.4), "#ffdc83", 'class="lp-twinkle"');
    },

    "door-attic-creaky": function () { // A creaky plank door left ajar on a warm-lit stair; a little ghost peeks round the edge, a child's ghost drawing is taped up, and a cobweb hangs in the corner.
      return path("M-4 354 H14 L44 362 H6 Z", "#ffdc83", 'opacity=".22"') +                                                                     // Light spilling on the floor.
        rect(-66, 192, 84, 164, "#5e4660", 'rx="2"') + rect(-60, 198, 72, 156, "#2a2033") + oval(4, 276, 8, 70, "#ffdc83", 'opacity=".3"') +         // Frame, dark doorway, warm light.
        ART.atticGhost(4, 266, .62) +
        path("M-60 198 L-4 202 V352 L-60 354 Z", "#7a5f78") + path("M-46 199 V353.5 M-32 200 V353 M-18 201 V352.5", "none", 'stroke="#5e4660" stroke-width="1.6"') + // The door leaf and its planks.
        path("M-56 222 H-10 M-56 330 H-10 M-54 226 L-12 326", "none", 'stroke="#8a6f88" stroke-width="6"') +                                     // Ledges and brace.
        rect(-63, 214, 18, 5, "#2a2033", 'rx="1"') + rect(-63, 334, 18, 5, "#2a2033", 'rx="1"') + path("M-58 216.5 h1 M-51 216.5 h1 M-58 336.5 h1 M-51 336.5 h1", "none", 'stroke="#8a7aa8" stroke-width="2"') + // Strap hinges.
        rect(-15, 270, 8, 14, "#b89a5a", 'rx="2"') + path("M-11 274 a1.6 1.6 0 1 1 0.1 0 l1.2 6 h-2.5 Z", "#2a2033") + circle(-11, 262, 4, "none", 'stroke="#b89a5a" stroke-width="1.6"') + // Keyhole plate and ring pull.
        group(rect(-52, 236, 24, 20, "#f4eeff") + path("M-46 251 V244 Q-46 239 -40 239 Q-34 239 -34 244 V251 l-2 -1.5 l-2 1.5 l-2 -1.5 l-2 1.5 l-2 -1.5 l-2 1.5 Z M-43 244 h1 M-38 244 h1", "none", 'stroke="#8a6aa8" stroke-width="1.2" stroke-linejoin="round"') +
          rect(-44, 233, 9, 5, "#ffdc83", 'opacity=".75"'), 'transform="rotate(-5 -40 246)"') +                                                   // A crayon ghost drawing, taped up.
        path("M-60 198 L-42 198 M-60 198 L-60 216 M-60 198 L-46 212 M-60 198 L-52 214 M-50 198 Q-52 205 -60 207 M-45 198 Q-48 210 -60 212", "none", 'stroke="#e6dcf5" stroke-width=".8" opacity=".6"'); // Cobweb.
    },

    "hang-attic-biplane": function () { // A tin toy biplane on a string, flown by a tiny ghost in goggles with a trailing scarf, its propeller a blur and a dotted loop behind it.
      return path("M384 70 Q396 100 364 108 Q330 112 318 96", "none", 'stroke="#c9b0ff" stroke-width="1.4" stroke-dasharray="2 4" opacity=".55"') +  // Its looping trail.
        line(336, 0, 336, 36, "#8a7aa8", 1.2) +
        path("M362 64 L378 50 L382 66 Z", "#7a5aa8") + rect(312, 74, 46, 6, "#ffdc83", 'rx="3"') +                                                  // Tail fin and lower wing.
        path("M318 80 L322 88 M348 80 L346 88", "none", 'stroke="#6a5068" stroke-width="1.6"') + circle(322, 89, 4, "#3d2450") + circle(346, 89, 4, "#3d2450") + // Wheels.
        path("M304 66 Q306 58 320 58 H360 L380 64 L360 72 H320 Q306 72 304 66 Z", "#9a7ac8") + path("M312 66 H366", "none", 'stroke="#ffdc83" stroke-width="2"') + // Fuselage and its stripe.
        path("M336 56 q12 -6 22 2 q-8 0 -12 3", "#d98aa8") + ART.atticGhost(330, 51, .38) + path("M325 49 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0 Z M331 49 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0 Z", "none", 'stroke="#b89a5a" stroke-width="1"') + // Scarf, pilot and goggles.
        path("M318 42 V58 M352 42 V58 M318 72 V74 M352 72 V74", "none", 'stroke="#6a5068" stroke-width="1.6"') + rect(310, 36, 52, 6, "#ffdc83", 'rx="3"') + // Struts and the upper wing.
        circle(302, 66, 3, "#b89a5a") + oval(300.5, 66, 3, 14, "#f4eeff", 'opacity=".45"') +                                                          // Propeller blur.
        path("M386 58 h8 M388 66 h6", "none", 'stroke="#c9b0ff" stroke-width="1.5" stroke-linecap="round" opacity=".55"') +
        path(star(296, 98, 3.4) + " " + star(374, 116, 3), "#ffdc83", 'class="lp-twinkle"');
    },

    "table-attic-boxes": function () { // Two dusty cardboard boxes stacked as a table under a lace doily, with a brass candlestick and a little wind-up mouse on top.
      let doily = "M310 300 H362 V304";
      for (let x = 362; x > 310; x -= 4) doily += " q-2 4 -4 0";                                                                                   // A scalloped lace edge.
      return oval(336, 363, 34, 3, "#00000044") + rect(306, 322, 60, 40, "#8a6e72", 'rx="1.5"') + rect(332, 322, 8, 40, "#a88a8a") + rect(312, 334, 15, 10, "#f4eeff", 'rx="1"') + // Bottom box, tape and label.
        path("M314 337 h10 M314 341 h7", "none", 'stroke="#8a7aa8" stroke-width="1"') + path("M306 322 H366", "none", 'stroke="#6e5658" stroke-width="2"') +
        rect(312, 300, 48, 23, "#7a6070", 'rx="1.5"') + rect(332, 300, 8, 23, "#9a7a88") + path("M348 314 v-5 q4 -5 8 0 v5 l-2 -1.4 l-2 1.4 l-2 -1.4 Z", "none", 'stroke="#c9b0ff" stroke-width="1"') + // Top box, with a ghost doodle.
        path(doily + " Z", "#f4eeff", 'opacity=".92"') + path("M314 302 H358", "none", 'stroke="#c9b0ff" stroke-width="1" stroke-dasharray="1 2"') +
        oval(324, 276, 12, 14, "#ffdc83", 'opacity=".2"') + oval(324, 299, 7, 2, "#b89a5a") + rect(322.5, 288, 3, 11, "#b89a5a") + oval(324, 288, 5, 1.6, "#b89a5a") + // Candlestick...
        rect(321, 276, 6, 12, "#f4eeff", 'rx="1"') + path("M324 268 q4 5 0 8 q-4 -3 0 -8 Z", "#ffdc83", 'class="lp-twinkle"') +                      // ...and its candle.
        oval(350, 294, 9, 5.5, "#a8b4c4") + circle(342, 290, 3.6, "#a8b4c4") + circle(341, 287, 2, "#ffb3d1") + circle(340, 291, 1, "#2a1a3a") +   // Wind-up mouse.
        path("M359 295 q6 0 5 -6", "none", 'stroke="#a8b4c4" stroke-width="1.3"') + path("M351 289 V284 M348 283 a3 2 0 1 0 6 0 a3 2 0 1 0 -6 0", "none", 'stroke="#d9b24a" stroke-width="1.5"');
    },

    "plant-attic-drum": function () { // A posy of dried roses, lavender and pampas fronds in an old toy drum with gold cords, two drumsticks leaning beside it and a friendly moth.
      const roses = [[6, 326], [30, 324], [18, 314]];
      let lav = "";
      [[-6, 334, -1], [42, 336, 1]].forEach(function (s) { for (let b = 0; b < 5; b++) lav += "M" + (s[0] + s[2] * b * 1.2 - 2) + " " + (s[1] - b * 5) + " a2 3 0 1 0 4 0 a2 3 0 1 0 -4 0 Z "; }); // Lavender heads.
      return path("M14 362 Q10 340 2 318 M18 362 V300 M22 362 Q28 340 36 318 M16 362 Q8 348 -6 336 M20 362 Q30 350 42 338 M17 362 Q10 340 6 326 M19 362 Q26 340 30 324", "none", 'stroke="#9a8a6a" stroke-width="1.6" stroke-linecap="round"') +
        oval(1, 306, 5, 15, "#efe2c4", 'opacity=".9" transform="rotate(-16 1 306)"') + oval(36, 306, 5, 15, "#efe2c4", 'opacity=".9" transform="rotate(16 36 306)"') + oval(18, 290, 5, 16, "#f6ecd4", 'opacity=".9"') + // Pampas fronds.
        path(lav, "#b49ae8") +
        roses.map(function (r) { return circle(r[0], r[1], 6, "#c98aa0"); }).join("") + path(roses.map(function (r) { return "M" + r[0] + " " + r[1] + " m-1 0 a1.5 1.5 0 1 1 2 1.5 a3.4 3.4 0 1 1 -4.4 -3 "; }).join(""), "none", 'stroke="#8a4a64" stroke-width="1.1"') + // Dried roses.
        path(scatter(441, 10, function (r) { const x = round(r(-4, 40)), y = round(r(296, 344)); return "M" + (x - 1.2) + " " + y + " a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0 Z "; }), "#f4eeff") +             // Baby's breath.
        path("M-12 392 L4 352 M48 392 L34 354", "none", 'stroke="#d9b86a" stroke-width="3" stroke-linecap="round"') + circle(4, 351, 3, "#c0495e") + circle(34, 353, 3, "#c0495e") + // Drumsticks.
        rect(0, 362, 36, 28, "#8a6aa8") + path("M2 366 L8 386 L14 366 L20 386 L26 366 L32 386", "none", 'stroke="#ffdc83" stroke-width="1.5" stroke-linejoin="round"') +
        rect(-1, 360, 38, 5, "#f4eeff", 'rx="2"') + rect(-1, 388, 38, 5, "#f4eeff", 'rx="2"') +                                                         // The toy drum and its rims.
        path("M46 290 q-6 -6 -9 0 q3 4 9 0 q6 -6 9 0 q-3 4 -9 0 Z", "#e6dcf5", 'class="lp-twinkle"') + line(46, 289, 46, 292, "#8a7aa8", 1.5);           // A friendly moth.
    },

    "chest-attic-horse": function () { // A dappled rocking horse caught mid-rock with nobody on it but a tiny ghost; its saddlebag is stuffed with toys.
      return oval(92, 479, 48, 4, "#00000055") + path("M36 452 q-6 6 -4 14 M150 446 q6 6 4 14", "none", 'stroke="#c9b0ff" stroke-width="1.6" stroke-linecap="round" opacity=".55"') + // Rocking marks.
        group(
          path("M42 468 Q92 490 142 468", "none", 'stroke="#7a5a4a" stroke-width="6" stroke-linecap="round"') + path("M44 467 Q92 487 140 467", "none", 'stroke="#b8946a" stroke-width="1.6"') + // The rocker.
          path("M118 432 Q138 432 136 456 Q128 446 118 444 Z", "#c9b0ff") +                                                                           // Yarn tail.
          path("M76 446 L66 474 M84 446 L80 478 M104 446 L106 478 M112 446 L120 474", "none", 'stroke="#ece4f7" stroke-width="5" stroke-linecap="round"') +
          path("M66 474 l-1 3 M80 478 v2 M106 478 v2 M120 474 l1 3", "none", 'stroke="#3d2450" stroke-width="5" stroke-linecap="round"') +           // Legs and hooves.
          oval(94, 438, 26, 12, "#ece4f7") + path("M84 434 a2.5 2 0 1 0 5 0 a2.5 2 0 1 0 -5 0 Z M100 442 a3 2 0 1 0 6 0 a3 2 0 1 0 -6 0 Z M108 432 a2 1.6 0 1 0 4 0 a2 1.6 0 1 0 -4 0 Z", "#c9b0ff", 'opacity=".7"') + // Dappled body.
          path("M74 440 Q66 422 62 408 Q60 400 54 400 L44 406 Q40 412 46 414 L56 412 Q62 428 70 446 Z", "#ece4f7") + path("M58 401 L60 392 L64 402 Z", "#ece4f7") + // Neck, head and ear.
          path("M62 402 Q70 402 74 414 Q78 426 80 434", "none", 'stroke="#c9b0ff" stroke-width="5" stroke-linecap="round" stroke-dasharray="3 2"') + // Mane.
          circle(55, 405, 1.5, "#3d2450") + path("M47 407 L57 402 L60 413", "none", 'stroke="#d98aa8" stroke-width="1.5"') +                           // Eye and bridle.
          path("M84 427 Q95 432 106 427 L104 436 H86 Z", "#8a6aa8") + path("M84 427 Q95 432 106 427", "none", 'stroke="#ffdc83" stroke-width="1.5"') + // Saddle.
          circle(108, 434, 4, "#ffdc83") + rect(105, 437, 7, 6, "#d98aa8") + rect(98, 440, 18, 14, "#6a5068", 'rx="3"') + path("M98 444 H116", "none", 'stroke="#4a3a52" stroke-width="2"') + circle(107, 447, 2, "#ffdc83") + // Saddlebag with a ball and a block peeking out.
          ART.atticGhost(95, 415, .5),
          'transform="translate(4 0) rotate(-6 92 472)"');
    },

    // Starship Wreck set
    // Rare loot from the Starship Wreck: steel-blue hull, cyan guide lights, amber hazard stripes and stars showing through every crack.
    "wall-starship-hull": function () { // Riveted hull panels with blinking status lights, a gauge, two cracks full of stars, and a pipe over a hazard-striped kick plate.
      const dot = function (x, y, r) { return "M" + round(x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; }; // A small circle as path text, so many cost one shape.
      let out = rect(0, 0, 400, 352, "#161c2b"), rivets = "", hazard = "";
      for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) { // Twelve panels, each inset from its 100-wide cell, so the gaps meet evenly at the tile join.
        const x = col * 100 + 4, y = 6 + row * 96;
        out += rect(x, y, 92, 90, (row + col) % 2 ? "#1c2333" : "#202840", 'rx="3"');
        [[7, 7], [85, 7], [7, 83], [85, 83]].forEach(function (p) { rivets += dot(x + p[0], y + p[1], 1.7); });
      }
      for (let x = 0; x < 400; x += 20) hazard += "M" + x + " 352 L" + (x + 10) + " 330 H" + (x + 20) + " L" + (x + 10) + " 352 Z "; // Stripes repeat every 20, so they run on across the join.
      const crack = function (hole, stars, sx, sy, hairs, delay) { // A torn hole in a panel: deep space inside, a bent bright rim, hairline cracks and a twinkling star.
        return path(hole, "#05070f") + path(stars, "#e6ecff") + path(star(sx, sy, 3.8), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + delay + 's"') +
          path(hole, "none", 'stroke="#a8b4c4" stroke-width="1.6" stroke-linejoin="round" opacity=".55"') + path(hairs, "none", 'stroke="#0d111c" stroke-width="1.3" stroke-linecap="round"');
      };
      return out + path(rivets, "#a8b4c4", 'opacity=".45"') +
        path("M226 40 H262 V32 L280 50 L262 68 V60 H226 Z", "#a8b4c4", 'opacity=".14"') +                                                           // A stencilled arrow pointing down the corridor.
        rect(18, 124, 64, 44, "#121725", 'rx="4"') + rect(24, 130, 32, 22, "#0b2a33", 'rx="2"') +                                                   // A control box with a little screen...
        path("M26 141 H32 L35 134 L39 148 L43 137 L46 141 H54", "none", 'stroke="#70ebea" stroke-width="1.4" stroke-linejoin="round"') +           // ...showing a heartbeat line...
        rect(62, 130, 13, 5, "#70ebea", 'rx="1" class="lp-twinkle"') + rect(62, 139, 13, 5, "#ffb84a", 'rx="1" class="lp-twinkle" style="animation-delay:.7s"') + rect(62, 148, 13, 5, "#ff7a8a", 'rx="1" class="lp-twinkle" style="animation-delay:1.3s"') + // ...and three blinking lamps.
        path(dot(30, 160, 2.2) + dot(40, 160, 2.2) + dot(50, 160, 2.2), "#a8b4c4", 'opacity=".7"') +
        circle(50, 243, 19, "#121725") + circle(50, 243, 16, "none", 'stroke="#a8b4c4" stroke-width="1.5" opacity=".6" stroke-dasharray="2 4"') + line(50, 243, 61, 236, "#ffb84a", 2, 'stroke-linecap="round"') + circle(50, 243, 2.6, "#70ebea") + // A round pressure gauge.
        path("M222 222 H278 M222 232 H278 M222 242 H278 M222 252 H278 M222 262 H278", "none", 'stroke="#0f1420" stroke-width="4" stroke-linecap="round"') + // Air vents.
        group(path("M-11 -3 L-9 -16 L-2 -10 Z M11 -3 L9 -16 L2 -10 Z", "#ff8ecb", 'stroke="#fff1e0" stroke-width="2.5" stroke-linejoin="round"') + circle(0, 0, 12, "#ff8ecb", 'stroke="#fff1e0" stroke-width="2.5"') +
          circle(-4.5, 1, 1.8, "#1c2333") + circle(4.5, 1, 1.8, "#1c2333") + path(star(0, -6, 3.4), "#fff8dc"), 'transform="translate(150 244) rotate(-10)"') + // A fairy-cat sticker some crew member left behind.
        crack("M128 30 L146 40 L158 24 L170 42 L164 58 L176 72 L152 66 L138 78 L140 58 Z", dot(146, 52, 1.2) + dot(160, 62, .9) + dot(143, 66, 1) + dot(151, 40, .8), 157, 50, "M128 30 L116 22 M176 72 L188 80 M138 78 L132 88 M158 24 L162 14", 0) +
        crack("M330 130 L344 124 L352 136 L368 132 L364 150 L374 166 L354 162 L342 172 L338 154 L326 148 Z", dot(345, 142, 1.1) + dot(360, 152, .9) + dot(341, 162, 1) + dot(334, 147, .8), 353, 148, "M330 130 L320 122 M374 166 L384 176 M342 172 L340 184", .9) +
        rect(0, 296, 400, 4, "#121725") + rect(0, 300, 400, 12, "#2e3a58") + rect(0, 302, 400, 3, "#a8b4c4", 'opacity=".35"') +                     // The pipe, and its shine...
        path("M45 297 h10 v18 h-10Z M145 297 h10 v18 h-10Z M245 297 h10 v18 h-10Z M345 297 h10 v18 h-10Z", "#3a4660") +                           // ...held by four brackets.
        rect(0, 316, 400, 36, "#121725") + rect(0, 314, 400, 2, "#70ebea", 'opacity=".35"') + path(hazard, "#ffb84a", 'opacity=".32"') + rect(0, 326, 400, 2, "#a8b4c4", 'opacity=".22"');
    },

    "floor-starship-deck": function () { // Two staggered rows of riveted deck plates with grilles, and a cyan guide-light strip blinking along the seam between them.
      const dot = function (x, y, r) { return "M" + round(x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; };
      const plates = [[3, 358, 94, 0], [103, 358, 94, 1], [203, 358, 94, 0], [303, 358, 94, 1], [0, 434, 47, 1], [53, 434, 94, 0], [153, 434, 94, 1], [253, 434, 94, 0], [353, 434, 47, 1]]; // [x, y, width, shade]; the two half plates on the second row meet at the join as one.
      let light = "", dark = "", rivets = "", lampsA = "", lampsB = "";
      plates.forEach(function (p) {
        const d = "M" + p[0] + " " + p[1] + " h" + p[2] + " v66 h-" + p[2] + "Z ";
        if (p[3]) dark += d; else light += d;
        if (p[0] !== 0) rivets += dot(p[0] + 5, p[1] + 5, 1.6) + dot(p[0] + 5, p[1] + 61, 1.6);                     // Rivets, but never on the tile's edge, where half plates join.
        if (p[0] + p[2] !== 400) rivets += dot(p[0] + p[2] - 5, p[1] + 5, 1.6) + dot(p[0] + p[2] - 5, p[1] + 61, 1.6);
      });
      for (let x = 25, i = 0; x < 400; x += 50, i++) { if (i % 2) lampsA += dot(x, 429, 2.4); else lampsB += dot(x, 429, 2.4); } // The guide lamps, in two sets that blink in turn.
      return rect(0, 350, 400, 150, "#141a2b") + path(light, "#2a3550") + path(dark, "#26304a") + path(rivets, "#a8b4c4", 'opacity=".5"') +
        path("M122 374 H178 M122 384 H178 M122 394 H178 M122 404 H178 M322 374 H378 M322 384 H378 M322 394 H378 M322 404 H378 M172 452 H228 M172 462 H228 M172 472 H228 M172 482 H228", "none", 'stroke="#141a2b" stroke-width="4" stroke-linecap="round"') + // Grilles in three plates.
        oval(260, 380, 26, 7, "#000000", 'opacity=".18"') + oval(80, 470, 22, 6, "#000000", 'opacity=".16"') +                                       // A couple of scuffs.
        oval(100, 400, 70, 14, "#70ebea", 'opacity=".05"') + oval(300, 462, 70, 14, "#70ebea", 'opacity=".05"') +                                  // Soft light on the plates.
        rect(0, 426, 400, 6, "#0f1420") + rect(0, 428, 400, 2, "#70ebea", 'opacity=".5"') +
        path(lampsA, "#70ebea", 'class="lp-twinkle"') + path(lampsB, "#bffcfb", 'class="lp-twinkle" style="animation-delay:1s"') +
        rect(0, 350, 400, 6, "#0f1420") + rect(0, 350, 400, 2, "#70ebea", 'opacity=".55"');
    },

    "art-starship-patch": function () { // A round embroidered mission patch: a fairy cat sitting on a ringed planet, a little rocket on a dotted orbit, and a ribbon underneath.
      return circle(69, 188, 40, "#a8b4c4") + circle(69, 188, 35, "#1c2333") + circle(69, 188, 37.5, "none", 'stroke="#e6ecf2" stroke-width="1.3" stroke-dasharray="3 2.4"') + // Silver rim and its stitching.
        oval(69, 182, 30, 22, "#2a3a70", 'opacity=".6"') +                                                                                          // A little nebula behind it all.
        path(star(46, 172, 3) + star(86, 200, 2.4) + star(62, 160, 2.2) + star(94, 182, 2), "#fff8dc") + circle(78, 160, 1, "#fff") + circle(42, 192, 1, "#fff") +
        path("M90 176 C76 160 44 160 38 182", "none", 'stroke="#70ebea" stroke-width="1.6" stroke-dasharray="3 3" stroke-linecap="round"') +        // The rocket's dotted orbit.
        path("M55 186 L56 175 L62 181 Z M69 181 L75 175 L76 186 Z", "#fce1f2") + circle(65.5, 188, 9, "#fce1f2") + circle(62, 188, 1.4, "#1c2333") + circle(69, 188, 1.4, "#1c2333") + path(star(65.5, 182.5, 2.6), "#70ebea") + // The cat, peeking over the planet.
        circle(66, 207, 15, "#ffb84a") + path("M52 202 Q66 208 80 202 L81 206 Q66 212 51 206 Z", "#ff8e5a") + oval(66, 207, 25, 5.5, "none", 'stroke="#ffdc83" stroke-width="2.4" transform="rotate(-12 66 207)"') + // The ringed planet.
        group(path("M0 -10 Q5 -4 5 6 H-5 Q-5 -4 0 -10 Z", "#e6ecf2") + circle(0, -1, 2, "#70ebea") + path("M-5 2 L-8 9 H-5 Z M5 2 L8 9 H5 Z", "#ff7a8a") + path("M-3 7 L0 13 L3 7 Z", "#ffb84a", 'class="lp-twinkle"'), 'transform="translate(92 172) rotate(-140)"') + // The rocket, flying round its orbit.
        path("M30 214 H108 L102 222 L108 230 H30 L36 222 Z", "#70ebea") + path("M40 222 H98", "none", 'stroke="#1c2333" stroke-width="1.2" stroke-dasharray="2.5 2.5"') + // The ribbon.
        circle(69, 148, 2.4, "#ff7a8a");                                                                                                             // The pin holding it up.
    },

    "shelf-starship-salvage": function () { // A riveted steel shelf of salvage: a glowing power cell, an old helmet with a sprout growing inside it, and a toy rocket.
      return rect(305, 170, 12, 30, "#bfe8ff", 'rx="3" opacity=".3" stroke="#d6f0ff" stroke-width="1.2"') + rect(307.5, 175, 7, 21, "#70ebea", 'rx="2" class="lp-neon lp-twinkle"') + // The power cell's glass and its glowing core...
        path("M312 178 l-3 7 h4 l-2 7", "none", 'stroke="#fff" stroke-width="1.2" opacity=".85"') + rect(303, 166, 16, 5, "#a8b4c4", 'rx="1.5"') + rect(303, 196, 16, 4, "#6a7484", 'rx="1"') + // ...a spark inside, and its two end caps.
        path("M327 200 V186 Q327 167 340 167 Q353 167 353 186 V200 Z", "#e6ecf2") + path("M331 191 Q331 175 340 175 Q349 175 349 191 Z", "#1c2a48") + // The helmet and its dark visor...
        path("M340 191 V183", "none", 'stroke="#3f8a6a" stroke-width="1.6"') + oval(336.5, 183, 3.4, 2, "#7fe0a8", 'transform="rotate(-30 336.5 183)"') + oval(343.5, 182, 3.4, 2, "#5fd0a8", 'transform="rotate(30 343.5 182)"') + // ...with a sprout inside...
        path("M334 182 Q335 178 339 177", "none", 'stroke="#70ebea" stroke-width="1.4" opacity=".8" stroke-linecap="round"') + rect(325, 193, 30, 7, "#a8b4c4", 'rx="2"') + // ...a glint on the glass and its collar ring.
        line(352, 178, 357, 170, "#a8b4c4", 1.5) + circle(357, 169, 1.8, "#ff7a8a", 'class="lp-twinkle"') +                                       // Its little antenna.
        path("M368 163 Q376 175 375 196 H361 Q360 175 368 163 Z", "#e6ecf2") + path("M368 163 Q372 168 373.5 173 H362.5 Q364 168 368 163 Z", "#ff7a8a") + // The toy rocket and its red nose...
        circle(368, 182, 3, "#70ebea", 'stroke="#a8b4c4" stroke-width="1"') + path("M361 186 L355 199 H361 Z M375 186 L381 199 H375 Z", "#ff7a8a") + rect(364, 196, 8, 4, "#6a7484") + // ...porthole, fins and nozzle.
        rect(294, 200, 88, 6, "#a8b4c4", 'rx="1.5"') + rect(294, 200, 88, 1.6, "#e6ecf2", 'opacity=".6"') + rect(298, 205.5, 80, 1.6, "#70ebea", 'opacity=".7" class="lp-neon"') + // The steel board and a strip of light under it.
        path("M304 206 h8 l-8 11 Z M372 206 h-8 l8 11 Z", "#6a7484") + circle(300, 203, 1.2, "#6a7484") + circle(376, 203, 1.2, "#6a7484");
    },

    "view-starship-drift": function () { // Deep space beside the wreck: soft nebulae, a ringed planet, drifting hull scraps and a tiny shuttle, with the torn edge of the ship sliding past in front.
      const twinkles = scatter(171, 9, function (roll) { return star(round(roll(8, 232)), round(roll(8, 96)), round(roll(1.4, 3))) + " "; });   // Bright stars, as one path.
      const scrap = function (x, y, deg, fill) { return path("M-8 -4 L6 -6 L9 3 L-2 6 L-9 2 Z", fill, 'transform="translate(' + x + " " + y + ") rotate(" + deg + ')"'); }; // A bent piece of hull.
      let truss = "M152 140 L180 74 M166 140 L194 74";
      for (let i = 0; i < 5; i++) { const t = i / 5, t2 = (i + 1) / 5; truss += " M" + round(152 + 28 * t) + " " + round(140 - 66 * t) + " L" + round(166 + 28 * t2) + " " + round(140 - 66 * t2); } // Zigzag bracing up a broken girder.
      return view(["#2c3a72", "#6a5aa8"], ["#04060f", "#141a3c"], 24,
        oval(50, 44, 48, 18, "#ff8ecb", 'opacity=".2"') + oval(176, 62, 56, 20, "#70ebea", 'opacity=".18"') + oval(112, 28, 30, 10, "#c9a8ff", 'opacity=".24"') +
          path(twinkles, "#fff8dc", 'class="lp-twinkle"') + circle(206, 28, 6, "#c9d2de") + circle(204, 26, 1.6, "#9aa4b8"),                        // Nebulae, stars and a far moon.
        circle(66, 66, 15, "#7a8ab8") + path("M52 62 Q66 68 80 62 L81 67 Q66 73 51 67 Z", "#5a6a9c") + oval(66, 66, 26, 6, "none", 'stroke="#ffdc83" stroke-width="2" opacity=".85" transform="rotate(-14 66 66)"') + // A ringed planet.
          scrap(150, 46, 20, "#8a96a8") + scrap(210, 88, -30, "#6a7484") + scrap(24, 100, 12, "#7a86a0") + circle(124, 40, 1.6, "#a8b4c4") +
          group(path("M-7 0 Q-7 -4 0 -4 H5 L9 0 L5 4 H0 Q-7 4 -7 0 Z", "#e6ecf2") + circle(2, 0, 1.6, "#70ebea") + path("M-7 -2 L-16 0 L-7 2 Z", "#70ebea", 'opacity=".6"'), 'transform="translate(118 96) rotate(-8)"'), // A tiny passing shuttle.
        path("M0 116 L16 112 L26 120 L44 106 L58 114 L76 110 L90 118 L112 104 L128 112 L146 108 L160 116 L180 102 L196 110 L214 106 L228 114 L240 116 V140 H0 Z", "#1c2333") + // The torn hull edge, level at both ends so it loops.
          path("M0 116 L16 112 L26 120 L44 106 L58 114 L76 110 L90 118 L112 104 L128 112 L146 108 L160 116 L180 102 L196 110 L214 106 L228 114 L240 116", "none", 'stroke="#a8b4c4" stroke-width="1.5" opacity=".6"') +
          path(truss, "none", 'stroke="#2e3a58" stroke-width="3" stroke-linecap="round"') + circle(187, 74, 2.6, "#ffb84a", 'class="lp-twinkle"') + circle(60, 124, 2.2, "#70ebea", 'class="lp-twinkle" style="animation-delay:.8s"') + circle(120, 126, 1.8, "#ff7a8a", 'class="lp-twinkle" style="animation-delay:1.4s"'));
    },

    "frame-starship-hatch": function () { // A heavy hatch knocked a little crooked: a thick bolted rim, a hazard-striped ledge, a cyan light strip and a loose cable sparking at one corner.
      const hole = CLIPS["frame-starship-hatch"], corners = [[155, 102], [234, 95], [254, 111], [262, 201], [245, 220], [166, 227], [146, 211], [138, 121]];
      let stripes = "";
      for (let x = 166; x < 240; x += 10) stripes += "M" + x + " 241 L" + (x + 5) + " 231 H" + (x + 10) + " L" + (x + 5) + " 241 Z ";
      return path(hole, "none", 'stroke="#2e3a58" stroke-width="20" stroke-linejoin="round"') + path(hole, "none", 'stroke="#a8b4c4" stroke-width="5" stroke-linejoin="round"') + path(hole, "none", 'stroke="#e6ecf2" stroke-width="1.2" stroke-linejoin="round" opacity=".6"') + // The rim: dark band, steel lip and a bright edge.
        corners.map(function (c) { return circle(c[0], c[1], 4.4, "#6a7484") + circle(c[0] - 1.2, c[1] - 1.2, 1.5, "#e6ecf2", 'opacity=".7"'); }).join("") + // A bolt at every corner.
        group(rect(160, 90, 70, 3.4, "#70ebea", 'rx="1.7" class="lp-neon"'), 'transform="rotate(-5.06 155 102)"') +                                  // The light strip, tilted with the hatch.
        group(rect(166, 231, 80, 10, "#ffb84a") + path(stripes, "#1c2333", 'opacity=".85"') + rect(160, 241, 92, 6, "#a8b4c4", 'rx="2"'), 'transform="rotate(-5.06 166 227)"') + // The hazard ledge, also tilted.
        path("M138 150 l-9 4 l6 3 l-8 6", "none", 'stroke="#0d111c" stroke-width="1.5" stroke-linejoin="round"') +                                    // A dent in the rim.
        path("M257 114 Q278 122 273 150 Q270 170 282 182", "none", 'stroke="#3a4660" stroke-width="3.5" stroke-linecap="round"') + rect(278, 180, 8, 6, "#a8b4c4", 'rx="1" transform="rotate(40 282 183)"') + // The loose cable and its plug...
        path(star(287, 190, 5), "#bffcfb", 'class="lp-twinkle"') + path(star(281, 194, 2.6), "#70ebea", 'class="lp-twinkle" style="animation-delay:.6s"') + // ...still sparking.
        path("M158 116 L170 114", "none", 'stroke="#ffffff" stroke-width="2" opacity=".3" stroke-linecap="round"');                                    // A glint on the glass.
    },

    "curtain-starship-shutter": function () { // A blast shutter jammed a quarter of the way down: steel slats with a hazard-striped edge, guide rails dotted with emergency lights, and two loose cables.
      let slats = "", shade = "", stripes = "";
      for (let y = 92; y < 122; y += 6) { slats += "M130 " + y + " h140 v4 h-140Z "; shade += "M130 " + (y + 4) + " h140 v2 h-140Z "; }     // Each slat, and the dark groove under it.
      for (let x = 130; x <= 258; x += 12) stripes += "M" + x + " 130 L" + (x + 6) + " 122 H" + (x + 12) + " L" + (x + 6) + " 130 Z ";
      const lights = [140, 162, 184, 206, 228].map(function (y, i) { // Little lamps down each rail, cyan and amber in turn.
        const colour = i % 2 ? "#ffb84a" : "#70ebea", wait = 'class="lp-twinkle" style="animation-delay:' + round(i * .4) + 's"';
        return circle(127, y, 2.4, colour, wait) + circle(273, y, 2.4, colour, wait);
      }).join("");
      return rect(122, 84, 10, 154, "#2a3550", 'rx="2"') + rect(268, 84, 10, 154, "#2a3550", 'rx="2"') + path("M124 92 V236 M276 92 V236", "none", 'stroke="#141a2b" stroke-width="1.5"') + lights + // The rails.
        path("M134 94 Q152 140 140 178 Q136 190 144 198", "none", 'stroke="#1c2333" stroke-width="3" stroke-linecap="round"') + rect(141, 196, 6, 8, "#a8b4c4", 'rx="1"') + path(star(144, 208, 3.6), "#bffcfb", 'class="lp-twinkle"') + // A cable hanging loose on the left...
        path("M266 94 Q252 124 260 150", "none", 'stroke="#1c2333" stroke-width="3" stroke-linecap="round"') + rect(257, 148, 6, 8, "#a8b4c4", 'rx="1"') + // ...and a shorter one on the right.
        path(slats, "#a8b4c4") + path(shade, "#6a7484") + rect(130, 122, 140, 8, "#ffb84a") + path(stripes, "#1c2333", 'opacity=".85"') + // The shutter and its hazard edge.
        path("M190 130 v6 h20 v-6", "none", 'stroke="#a8b4c4" stroke-width="2.5" stroke-linejoin="round"') +                                         // Its handle.
        rect(116, 78, 168, 12, "#3a4660", 'rx="3"') + rect(120, 88, 160, 2, "#70ebea", 'opacity=".75" class="lp-neon"') + circle(122, 84, 2, "#a8b4c4") + circle(278, 84, 2, "#a8b4c4"); // The housing it rolls into.
    },

    "lamp-starship-beacon": function () { // An emergency beacon on a steel pole: a caged cyan dome glowing softly, a red tip light, and a hazard-banded base.
      let stripes = "";
      for (let x = 34; x < 74; x += 8) stripes += "M" + x + " 397 L" + (x + 4) + " 391 H" + (x + 8) + " L" + (x + 4) + " 397 Z ";
      return oval(54, 262, 52, 50, "#70ebea", 'opacity=".1"') + oval(54, 262, 30, 30, "#70ebea", 'opacity=".12"') + oval(54, 405, 28, 4, "#000000", 'opacity=".3"') + // Its glow, and a shadow.
        path("M30 404 L37 384 H71 L78 404 Z", "#2a3550") + rect(34, 391, 40, 6, "#ffb84a") + path(stripes, "#1c2333", 'opacity=".85"') + rect(35, 380, 38, 6, "#a8b4c4", 'rx="2"') + // The base.
        rect(51, 292, 6, 90, "#a8b4c4") + rect(55, 292, 2, 90, "#6a7484") + rect(44, 286, 20, 8, "#3a4660", 'rx="2"') +                          // The pole and its collar.
        path("M36 288 V262 Q36 240 54 240 Q72 240 72 262 V288 Z", "#70ebea", 'opacity=".9" class="lp-neon"') + oval(54, 264, 8, 15, "#d6fffe", 'opacity=".85" class="lp-twinkle"') + // The glowing dome and its bright heart...
        path("M42 288 V258 Q42 246 54 246 Q66 246 66 258 V288 M54 240 V288 M36 268 H72", "none", 'stroke="#3a4660" stroke-width="2.5"') +           // ...inside its cage.
        rect(46, 234, 16, 7, "#a8b4c4", 'rx="2"') + line(54, 234, 54, 220, "#a8b4c4", 1.6) + circle(54, 219, 2.6, "#ff7a8a", 'class="lp-twinkle" style="animation-delay:.5s"') + // Top cap and its red tip light.
        path(star(26, 250, 3.4), "#bffcfb", 'class="lp-twinkle" style="animation-delay:1s"') + path(star(84, 272, 3), "#bffcfb", 'class="lp-twinkle" style="animation-delay:.3s"');
    },

    "rug-starship-iris": function () { // A round airlock door laid flat as a rug: a hazard-ticked rim, six iris blades spiralling in, and a glowing cyan heart.
      const at = function (r, a) { return round(Math.cos(a) * r) + " " + round(Math.sin(a) * r); };          // A point at radius r and angle a, in the rug's own flat coordinates.
      let blades = "", seams = "", bolts = "";
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * 6.283, b = a + 6.283 / 6;
        blades += path("M" + at(24, a + .5) + " L" + at(118, a) + " A118 118 0 0 1 " + at(118, b) + " L" + at(24, b + .5) + " Z", i % 2 ? "#2e3a58" : "#36446c"); // One blade.
        seams += "M" + at(24, a + .5) + " Q" + at(74, a + .1) + " " + at(118, a) + " ";                                  // Its curved edge.
      }
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283 + .26; bolts += "M" + at(142, a) + " m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z "; }
      return oval(200, 442, 160, 44, "#70ebea", 'opacity=".1"') + group(circle(0, 0, 150, "#141a2b") + circle(0, 0, 146, "#3a4660") +
        circle(0, 0, 134, "none", 'stroke="#ffb84a" stroke-width="12" stroke-dasharray="16 12" opacity=".85"') + path(bolts, "#a8b4c4") + circle(0, 0, 124, "#1c2333") + blades +
        path(seams, "none", 'stroke="#141a2b" stroke-width="4"') + circle(0, 0, 118, "none", 'stroke="#70ebea" stroke-width="3" class="lp-neon"') +
        circle(0, 0, 30, "#70ebea", 'opacity=".85" class="lp-neon"') + circle(0, 0, 20, "#d6fffe") + path(star(0, 0, 26), "#ffffff", 'class="lp-twinkle"'),
        'transform="translate(200 442) scale(1 .3)"');
    },

    "bed-starship-pod": function () { // An escape pod turned bed: its glass canopy swung open behind, a starry blanket and pillow inside, porthole lights along its side and little landing legs.
      return oval(340, 464, 56, 5, "#000000", 'opacity=".3"') + path("M304 448 L294 464 M376 448 L386 464", "none", 'stroke="#6a7484" stroke-width="4" stroke-linecap="round"') + oval(294, 464, 6, 2.4, "#a8b4c4") + oval(386, 464, 6, 2.4, "#a8b4c4") + // Shadow and landing legs.
        path("M298 420 Q296 368 340 364 Q384 368 382 420 Z", "#bfe8ff", 'opacity=".22" stroke="#d6f0ff" stroke-width="2"') + path("M308 410 Q308 382 330 375", "none", 'stroke="#ffffff" stroke-width="2.5" opacity=".45" stroke-linecap="round"') + // The open canopy and a glint on it.
        rect(296, 415, 88, 5, "#6a7484", 'rx="2"') +                                                                                                   // Its hinge bar.
        path("M288 428 Q288 418 300 418 H380 Q392 418 392 428 V438 Q392 456 366 456 H314 Q288 456 288 438 Z", "#a8b4c4") + path("M288 440 Q290 456 314 456 H366 Q390 456 392 440 Z", "#8a96a8") + // The pod's hull, shaded underneath.
        oval(340, 424, 44, 7, "#1c2333") + path("M300 424 Q306 414 340 414 Q376 414 382 424 Q340 432 300 424 Z", "#3a4f86") + path(star(334, 421, 2.6) + star(354, 418, 2) + star(368, 422, 2.2) + star(322, 418, 1.8), "#fff8dc") + // The tub, a starry blanket...
        oval(310, 417, 12, 6, "#fff1e0") + path("M302 416 Q310 412 318 416", "none", 'stroke="#e8dff0" stroke-width="1.2"') +                          // ...and a pillow.
        path("M290 436 H390", "none", 'stroke="#ffb84a" stroke-width="2"') +
        [306, 323, 340, 357, 374].map(function (x, i) { return circle(x, 446, 3, i % 2 ? "#ffb84a" : "#70ebea", 'class="lp-twinkle" style="animation-delay:' + round(i * .35) + 's"'); }).join("") + // Porthole lights.
        circle(294, 430, 1.4, "#6a7484") + circle(386, 430, 1.4, "#6a7484");
    },

    "door-starship-airlock": function () { // An airlock with chamfered corners, its two halves stuck a crack open with cyan light spilling through, starry portholes, hazard stripes and a blinking keypad.
      let stripes = "";
      for (let x = -56; x < 6; x += 10) stripes += "M" + x + " 346 L" + (x + 5) + " 334 H" + (x + 10) + " L" + (x + 5) + " 346 Z ";
      const port = function (x, seed) { return circle(x, 246, 9, "#a8b4c4") + circle(x, 246, 6.5, "#05070f") + scatter(seed, 4, function (roll) { return circle(round(roll(x - 4, x + 4)), round(roll(242, 250)), round(roll(.5, 1)), "#e6ecff"); }); }; // A round window full of stars.
      return oval(-25, 354, 34, 5, "#70ebea", 'opacity=".3"') + path("M-66 354 V214 L-48 196 H-2 L16 214 V354 Z", "#3a4660") + path("M-58 354 V218 L-45 204 H-5 L8 218 V354 Z", "#1c2333") + // Floor glow, frame and opening.
        path("M-56 354 V219 L-44 206 H-27 V354 Z", "#a8b4c4") + path("M-23 354 V206 H-6 L6 219 V354 Z", "#a8b4c4") +                               // The two door halves, a crack apart.
        path("M-56 290 H-27 M-23 290 H6 M-56 318 H-27 M-23 318 H6", "none", 'stroke="#8a96a8" stroke-width="1.5"') + rect(-34, 276, 3, 20, "#6a7484", 'rx="1"') + rect(-19, 276, 3, 20, "#6a7484", 'rx="1"') + // Panel seams and handles.
        port(-41, 181) + port(-9, 182) + path(star(-9, 245, 2.6), "#fff8dc", 'class="lp-twinkle"') +
        rect(-56, 334, 62, 12, "#ffb84a") + path(stripes, "#1c2333", 'opacity=".85"') +                                                              // Hazard stripes.
        rect(-31, 206, 12, 148, "#70ebea", 'opacity=".2"') + rect(-27, 206, 4, 148, "#bffcfb", 'class="lp-neon"') +                                 // Light through the crack.
        rect(8.5, 262, 7, 18, "#121725", 'rx="1"') + circle(12, 266, 1.4, "#70ebea", 'class="lp-twinkle"') + circle(12, 271, 1.4, "#ffb84a", 'class="lp-twinkle" style="animation-delay:.6s"') + circle(12, 276, 1.4, "#ff7a8a", 'class="lp-twinkle" style="animation-delay:1.2s"') + // The keypad.
        oval(-25, 194, 14, 8, "#ffb84a", 'opacity=".2"') + path("M-33 196 Q-25 186 -17 196 Z", "#ffb84a", 'class="lp-twinkle"');                     // The warning lamp above.
    },

    "hang-starship-satellite": function () { // A battered little satellite on a thread, solar wings out and its dish pointing down, with a tiny moon and a star dangling beside it.
      const grid = "M290 53 H314 M352 53 H376 M296 46 V60 M302 46 V60 M308 46 V60 M358 46 V60 M364 46 V60 M370 46 V60";
      return line(300, 0, 300, 82, "#8a7aa8", 1) + line(368, 0, 368, 90, "#8a7aa8", 1) + line(333, 0, 333, 36, "#8a7aa8", 1.2) +
        circle(300, 90, 8, "#c9d2de") + circle(297, 88, 2, "#9aa4b8") + circle(303, 93, 1.4, "#9aa4b8") + path(star(368, 98, 7), "#fff8dc", 'class="lp-twinkle"') + // The moon and the star.
        group(line(316, 53, 350, 53, "#a8b4c4", 2) + rect(286, 46, 32, 14, "#2a4a8a", 'rx="1.5"') + rect(348, 46, 32, 14, "#2a4a8a", 'rx="1.5"') + path(grid, "none", 'stroke="#70ebea" stroke-width=".8" opacity=".6"') + // Solar wings.
          rect(322, 38, 22, 28, "#ffdc83", 'rx="2"') + path("M322 47 H344 M322 56 H344 M330 38 V66", "none", 'stroke="#d9b24a" stroke-width="1"') + circle(333, 37, 2.6, "#ff7a8a", 'class="lp-twinkle"') + // Gold-foil body and its blinking light.
          rect(331, 66, 4, 6, "#a8b4c4") + path("M321 80 Q333 64 345 80 Z", "#e6ecf2") + line(333, 76, 333, 88, "#a8b4c4", 1.2) + circle(333, 89, 2.2, "#70ebea", 'class="lp-twinkle" style="animation-delay:.8s"') + // The dish and its antenna.
          path("M290 46 L296 52 L292 56", "none", 'stroke="#141a2b" stroke-width="1.4"'),                                                            // A crack in one wing.
          'transform="rotate(-8 333 52)"');
    },

    "table-starship-holo": function () { // A salvaged supply crate used as a table, with a little projector on top spinning a hologram planet.
      let stripes = "";
      for (let x = 306; x < 366; x += 10) stripes += "M" + x + " 346 L" + (x + 5) + " 340 H" + (x + 10) + " L" + (x + 5) + " 346 Z ";
      return rect(306, 320, 60, 42, "#3a4660", 'rx="2"') + rect(311, 324, 50, 34, "#2e3a58", 'rx="1.5"') + rect(306, 340, 60, 6, "#ffb84a") + path(stripes, "#1c2333", 'opacity=".85"') + // The crate and its hazard band.
        path("M306 323 V320 H314 V323 Z M366 323 V320 H358 V323 Z M306 359 V362 H314 V359 Z M366 359 V362 H358 V359 Z", "#a8b4c4") + path(star(336, 353, 4.5), "#a8b4c4", 'opacity=".7"') + rect(303, 316, 66, 6, "#a8b4c4", 'rx="2"') + // Corner caps, a stencilled star and the lid.
        oval(336, 284, 30, 28, "#70ebea", 'opacity=".08"') + path("M331 305 L314 266 H358 L341 305 Z", "#70ebea", 'opacity=".16"') +                    // The beam of light...
        circle(336, 282, 12, "#70ebea", 'opacity=".45" class="lp-twinkle"') + path("M325 278 H347 M324 283 H348 M326 288 H346", "none", 'stroke="#d6fffe" stroke-width="1" opacity=".6"') + // ...the hologram planet and its scan lines...
        oval(336, 282, 19, 4.5, "none", 'stroke="#d6fffe" stroke-width="1.4" opacity=".75" transform="rotate(-12 336 282)"') + circle(357, 271, 2.2, "#d6fffe", 'class="lp-twinkle" style="animation-delay:.7s"') + // ...its ring and a moonlet.
        path("M326 316 L330 306 H342 L346 316 Z", "#2a3550") + oval(336, 306, 6, 2, "#70ebea", 'class="lp-neon"');                                    // The projector.
    },

    "plant-starship-hydro": function () { // A hydroponic canister with a cyan band, sprouting round alien leaves and three glowing seed-bulbs under a little grow-light.
      return path("M34 376 H38 V300 Q38 292 30 292 H24", "none", 'stroke="#6a7484" stroke-width="3" stroke-linecap="round"') + path("M10 290 L26 287 L28 296 L12 299 Z", "#a8b4c4") + // The grow-light's arm and head...
        path("M12 299 L-6 352 H44 L28 296 Z", "#c9a8ff", 'opacity=".13"') + rect(12, 296, 16, 2, "#e6d4ff", 'transform="rotate(-11 20 297)"') +        // ...and its soft violet light.
        path("M18 368 Q14 346 6 332 M18 368 Q20 342 18 320 M18 368 Q24 350 32 338", "none", 'stroke="#3f8a6a" stroke-width="2.4" stroke-linecap="round"') + // Stems.
        oval(5, 346, 8, 4.5, "#5fd0a8", 'transform="rotate(-30 5 346)"') + oval(32, 350, 8, 4.5, "#5fd0a8", 'transform="rotate(30 32 350)"') + oval(11, 358, 7, 4, "#3fa88a", 'transform="rotate(-20 11 358)"') +
        oval(27, 360, 7, 4, "#3fa88a", 'transform="rotate(20 27 360)"') + oval(13, 334, 6.5, 4, "#7fe8b8", 'transform="rotate(-40 13 334)"') + oval(25, 330, 6.5, 4, "#7fe8b8", 'transform="rotate(40 25 330)"') + // Round alien leaves.
        circle(6, 330, 4.5, "#70ebea", 'class="lp-neon lp-twinkle"') + circle(18, 317, 5, "#ff8ecb", 'class="lp-neon lp-twinkle" style="animation-delay:.6s"') + circle(32, 336, 4, "#ffdc83", 'class="lp-neon lp-twinkle" style="animation-delay:1.2s"') + // Glowing seed-bulbs.
        rect(0, 364, 36, 4, "#6a7484", 'rx="1.5"') + rect(2, 367, 32, 25, "#a8b4c4", 'rx="3"') + rect(2, 374, 32, 5, "#70ebea", 'opacity=".85" class="lp-neon"') + rect(4, 388, 28, 4, "#6a7484", 'rx="1"') + // The canister.
        circle(7, 384, 1.2, "#6a7484") + circle(29, 384, 1.2, "#6a7484");
    },

    "chest-starship-cargo": function () { // A dented cargo crate with its lid flipped back, spilling space toys: a ray gun, a little alien plush and a star.
      let stripes = "";
      for (let x = 58; x < 126; x += 10) stripes += "M" + x + " 453 L" + (x + 5) + " 446 H" + (x + 10) + " L" + (x + 5) + " 453 Z ";
      return oval(92, 477, 44, 4, "#000000", 'opacity=".3"') + path("M58 436 L64 412 H120 L126 436 Z", "#2a3550") + path("M66 430 L70 416 H114 L118 430 Z", "#3a4660") + // The lid, flipped back.
        oval(92, 434, 32, 5, "#70ebea", 'opacity=".45"') +                                                                                           // A glow from inside.
        group(path("M-12 -4 H6 Q12 -4 12 0 Q12 4 6 4 H-12 Z", "#ff8ecb") + path("M-6 4 L-9 13 H-3 L0 4 Z", "#c85a9e") + circle(13, 0, 2.6, "#70ebea", 'class="lp-twinkle"') + path("M-4 -4 V4 M1 -4 V4", "none", 'stroke="#fff1e0" stroke-width="1.4"'), 'transform="translate(74 428) rotate(-30)"') + // The ray gun.
        path("M93 414 L90 404 M103 414 L106 404", "none", 'stroke="#5fd0a8" stroke-width="1.6"') + circle(90, 403, 2, "#ffdc83") + circle(106, 403, 2, "#ffdc83") + oval(98, 424, 11, 10, "#7fe0a8") + // The alien's antennae and head...
        oval(94, 422, 3, 4, "#1c2333") + oval(102, 422, 3, 4, "#1c2333") + circle(95, 420.5, 1, "#fff") + circle(103, 420.5, 1, "#fff") + path("M95 428 q3 2.5 6 0", "none", 'stroke="#1c2333" stroke-width="1.2" stroke-linecap="round"') + // ...big eyes and a smile.
        path(star(118, 420, 8), "#ffdc83", 'class="lp-twinkle"') +
        rect(58, 434, 68, 40, "#3a4660", 'rx="3"') + rect(58, 434, 68, 4, "#a8b4c4", 'rx="1"') + rect(58, 446, 68, 7, "#ffb84a") + path(stripes, "#1c2333", 'opacity=".85"') + // The crate and its hazard band.
        path("M58 470 V474 H66 V470 Z M126 470 V474 H118 V470 Z", "#a8b4c4") + path(star(92, 464, 6), "#a8b4c4", 'opacity=".75"') + path("M66 460 l6 6", "none", 'stroke="#141a2b" stroke-width="1.5" stroke-linecap="round"'); // Corner caps, a stencilled star and a dent.
    },

﻿    // Neon Arcade set
    // Rare loot from the Neon Arcade Alley: violet brick and carpet, hot-pink and cyan neon, rain on the pavement and cabinets still glowing.
    "wall-arcade-brick": function () { // Dark violet brick lit by neon signs (a pixel heart, a lightning bolt, a sparkle and a joystick), a drainpipe, and wet glints along the bottom.
      let mortar = "", light = "", dark = "";
      const roll = dice(311);
      for (let row = 0; row < 15; row++) { // Rows of bricks 24 tall; the upright joints sit half a brick apart and never on the tile's edge.
        const top = row * 24, bottom = Math.min(top + 24, 352), off = row % 2 ? 37.5 : 12.5;
        if (row) mortar += "M0 " + top + " H400 ";
        for (let x = off; x < 400; x += 50) {
          mortar += "M" + x + " " + top + " V" + bottom + " ";
          const pick = roll(0, 1);                                                                       // A few bricks a shade lighter or darker.
          if (x + 50 < 400 && pick > .8) light += "M" + (x + 1) + " " + (top + 1) + " h48 v" + (bottom - top - 2) + " h-48Z ";
          else if (x + 50 < 400 && pick < .14) dark += "M" + (x + 1) + " " + (top + 1) + " h48 v" + (bottom - top - 2) + " h-48Z ";
        }
      }
      const sign = function (d, colour, glowX, glowY, size) { // A neon tube: a soft halo on the wall, then the bright tube.
        return oval(glowX, glowY, size, size * .8, colour, 'opacity=".1"') + path(d, "none", 'stroke="' + colour + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="lp-neon"');
      };
      return rect(0, 0, 400, 352, "#1a1030") + path(light, "#22153e") + path(dark, "#140b26") + path(mortar, "none", 'stroke="#110920" stroke-width="2"') +
        rect(176, 0, 9, 352, "#2a1848") + rect(177, 0, 2, 352, "#4a3070") + path("M172 60 h17 v5 h-17Z M172 180 h17 v5 h-17Z M172 300 h17 v5 h-17Z", "#3a2460") + // A drainpipe and its clips.
        sign("M70 56 H86 V64 H94 V56 H110 V64 H118 V80 H110 V88 H102 V96 H94 V104 H86 V96 H78 V88 H70 V80 H62 V64 H70 Z", "#ff8ecb", 90, 80, 48) +      // A pixel heart...
        sign("M322 38 L302 74 H316 L306 106 L332 64 H318 L328 38 Z", "#ffdc83", 316, 72, 40) +                                                   // ...a lightning bolt...
        sign(star(250, 296, 18), "#70ebea", 250, 296, 30) +                                                                                     // ...a sparkle...
        sign("M64 276 H98 V288 H64 Z M81 276 V252", "#c9a8ff", 81, 266, 36) + circle(81, 248, 6, "#c9a8ff", 'class="lp-neon"') +                 // ...and a joystick.
        path("M96 108 v8 M84 108 v8 M250 270 v8 M318 108 v6", "none", 'stroke="#4a3070" stroke-width="1.5"') +                                 // The wires the signs hang from.
        rect(0, 326, 400, 26, "#110920", 'opacity=".55"') +
        path("M72 334 h28 M80 342 h14 M292 336 h24 M300 344 h10", "none", 'stroke="#ff8ecb" stroke-width="2" stroke-linecap="round" opacity=".35"') + // Neon light shining back off the wet ground.
        path("M224 334 h40 M236 342 h18 M150 340 h16", "none", 'stroke="#70ebea" stroke-width="2" stroke-linecap="round" opacity=".35"');
    },

    "floor-arcade-carpet": function () { // Classic arcade carpet: deep purple scattered with neon squiggles, rings, triangles and sparkles, with soft pools of cabinet light.
      const roll = dice(412);
      let pinkWave = "", cyanWave = "", rings = "", pinkRings = "", tris = "", sparks = "", dots = "";
      for (let i = 0; i < 40; i++) { // Each motif stays well inside the tile, so the carpet repeats without a seam.
        const x = round(roll(14, 358)), y = round(roll(366, 490)), kind = i % 7;
        if (kind === 0) pinkWave += "M" + x + " " + y + " q5 -5 10 0 t10 0 t10 0 ";
        if (kind === 1) cyanWave += "M" + x + " " + y + " q5 -5 10 0 t10 0 t10 0 ";
        if (kind === 2) rings += "M" + (x - 6) + " " + y + " a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0Z ";
        if (kind === 3) pinkRings += "M" + (x - 5) + " " + y + " a5 3.4 0 1 0 10 0 a5 3.4 0 1 0 -10 0Z ";
        if (kind === 4) tris += "M" + x + " " + (y + 4) + " l7 -9 l7 9 Z ";
        if (kind === 5) sparks += star(x, y, 5) + " ";
        if (kind === 6) dots += "M" + (x - 2) + " " + y + " a2 1.6 0 1 0 4 0 a2 1.6 0 1 0 -4 0Z ";
      }
      return rect(0, 350, 400, 150, "#2a1848") + oval(110, 410, 90, 26, "#70ebea", 'opacity=".07"') + oval(300, 468, 88, 24, "#ff8ecb", 'opacity=".07"') +
        path(pinkWave, "none", 'stroke="#ff8ecb" stroke-width="2.6" stroke-linecap="round" opacity=".8"') + path(cyanWave, "none", 'stroke="#70ebea" stroke-width="2.6" stroke-linecap="round" opacity=".8"') +
        path(rings, "none", 'stroke="#70ebea" stroke-width="2" opacity=".75"') + path(pinkRings, "none", 'stroke="#ffdc83" stroke-width="2" opacity=".7"') +
        path(tris, "#ffdc83", 'opacity=".7"') + path(sparks, "#c9a8ff", 'opacity=".85"') + path(dots, "#fff1e0", 'opacity=".5"') +
        rect(0, 353, 400, 4, "#110920", 'opacity=".5"') + rect(0, 350, 400, 3, "#ff8ecb", 'opacity=".55"');
    },

    "art-arcade-pixelcat": function () { // A light-box sign with chasing bulbs round its edge and a pixel-art fairy cat on its screen.
      const map = ["1.........1", "11.......11", "111.....111", "11111311111", "11111111111", "11211111211", "11211111211", "14111511141", "11111111111", ".111111111."]; // The cat, one character per pixel.
      const fills = { 1: "#ff8ecb", 2: "#1a1030", 3: "#70ebea", 4: "#ffc4e0", 5: "#c8457f" }, pixels = {};
      map.forEach(function (row, y) { row.split("").forEach(function (c, x) { if (fills[c]) pixels[c] = (pixels[c] || "") + "M" + (41.5 + x * 5) + " " + (165 + y * 5) + " h5 v5 h-5Z "; }); }); // One path per colour.
      let bulbsA = "", bulbsB = "", scan = "", n = 0;
      const bulb = function (x, y) { const d = "M" + (x - 2.2) + " " + y + " a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0Z "; if (n++ % 2) bulbsA += d; else bulbsB += d; };
      for (let x = 33; x <= 105; x += 12) { bulb(x, 154); bulb(x, 226); }                                                                     // Bulbs along the top and bottom...
      for (let y = 166; y <= 214; y += 12) { bulb(30, y); bulb(108, y); }                                                                     // ...and down the sides, in two sets that blink in turn.
      for (let y = 161; y < 221; y += 4) scan += "M36 " + y + " H102 ";
      return oval(69, 190, 54, 50, "#ff8ecb", 'opacity=".1"') + rect(26, 150, 86, 80, "#2a1848", 'rx="5" stroke="#ff8ecb" stroke-width="2"') + rect(34, 158, 70, 64, "#0d0820", 'rx="3"') +
        Object.keys(pixels).map(function (c) { return path(pixels[c], fills[c], c === "3" ? 'class="lp-twinkle"' : ""); }).join("") +
        path(scan, "none", 'stroke="#000000" stroke-width="1" opacity=".22"') + path(star(95, 167, 4), "#ffdc83", 'class="lp-twinkle" style="animation-delay:.5s"') + path(star(44, 214, 3), "#70ebea") +
        path(bulbsA, "#ffdc83", 'class="lp-twinkle"') + path(bulbsB, "#ffdc83", 'class="lp-twinkle" style="animation-delay:1s"');
    },

    "shelf-arcade-prizes": function () { // The prize counter: a capsule toy, a plush kitty with a prize rosette, a jar of tokens and a strip of tickets curling over the edge.
      const coins = "M354 197 a8 2.6 0 1 0 16 0 a8 2.6 0 1 0 -16 0Z M355 192 a7 2.4 0 1 0 14 0 a7 2.4 0 1 0 -14 0Z M354 187 a8 2.6 0 1 0 16 0 a8 2.6 0 1 0 -16 0Z M356 182 a6 2.2 0 1 0 12 0 a6 2.2 0 1 0 -12 0Z";
      return path("M299 189 A11 11 0 0 1 321 189 Z", "#ff8ecb") + path("M299 189 A11 11 0 0 0 321 189 Z", "#fff1e0") + line(299, 189, 321, 189, "#c8457f", 1.5) + circle(305, 184, 2.4, "#ffffff", 'opacity=".75"') + // The capsule toy.
        path("M327 175 L328 164 L334 170 Z M345 175 L344 164 L338 170 Z", "#c9a8ff") + path("M329 172 L329.5 167 L332 170 Z M343 172 L342.5 167 L340 170 Z", "#ffb3d1") + // The plush kitty's ears...
        oval(336, 192, 11, 8, "#c9a8ff") + circle(336, 179, 9, "#c9a8ff") + circle(332, 179, 1.4, "#2a1848") + circle(340, 179, 1.4, "#2a1848") + path("M334.5 183 h3 l-1.5 1.6 Z", "#ff8ecb") + // ...body, head and face...
        oval(330, 198, 4, 2.4, "#b39ae8") + oval(342, 198, 4, 2.4, "#b39ae8") + path("M344 196 l-2 8 l3 -2 l2 3 Z M346 196 l3 7 l1 -3 l3 1 Z", "#70ebea") + circle(345, 194, 3.6, "#ffdc83") + // ...paws, and a prize rosette.
        path(coins, "#ffdc83", 'stroke="#d9a02e" stroke-width=".8"') + rect(352, 172, 20, 28, "#bfe8ff", 'rx="4" opacity=".28" stroke="#d6f0ff" stroke-width="1.4"') + rect(354, 167, 16, 6, "#ff8ecb", 'rx="1.5"') + // The token jar.
        line(355, 176, 355, 196, "#ffffff", 1.2, 'opacity=".55"') +
        rect(294, 200, 86, 6, "#3a2460", 'rx="2"') + rect(294, 200, 86, 2, "#ff8ecb", 'class="lp-neon"') + path("M304 206 l6 10 M370 206 l-6 10", "none", 'stroke="#3a2460" stroke-width="3" stroke-linecap="round"') + // The board.
        path("M372 196 H382 L384 210 L379 220 L383 232 H373 L369 220 L374 210 Z", "#ffdc83") + path("M373 210 H384 M370 220 H380", "none", 'stroke="#c88a2a" stroke-width="1" stroke-dasharray="1.5 1.5"') + circle(377, 226, 1.4, "#c88a2a"); // Tickets curling over the edge.
    },

    "view-arcade-rain": function () { // A rainy neon street at dusk: violet towers lit pink and cyan, glowing shop signs, and wet pavement shining back.
      const reflect = [[60, "#ff8ecb"], [124, "#ffdc83"], [184, "#70ebea"]].map(function (r) { return rect(r[0] - 5, 128, 10, 12, r[1], 'opacity=".3"'); }).join(""); // Each sign's light on the wet ground.
      const windows = function (seed, top, bottom) { return scatter(seed, 26, function (roll) { return "M" + round(roll(4, 234)) + " " + round(roll(top, bottom)) + " h3 v4 h-3Z "; }); }; // Lit windows as one path, so the towers stay cheap to draw.
      const rain = scatter(215, 28, function (roll) { const x = round(roll(0, 124)), y = round(roll(0, 122)); return "M" + x + " " + y + " l-2 9 "; }); // Every raindrop in one path.
      return view(["#5a2a7e", "#d0609a"], ["#0b0618", "#2a1040"], 30,
        skyline(211, 88, 30, 64, "#3d2266") + path(windows(216, 60, 84), "#ff8ecb", 'opacity=".75"'),
        skyline(212, 108, 22, 46, "#28154c") + path(windows(217, 88, 104), "#70ebea", 'opacity=".85"') +rect(40, 70, 5, 26, "#ff8ecb", 'class="lp-neon"') + rect(150, 64, 5, 30, "#70ebea", 'class="lp-neon"') + rect(206, 80, 5, 22, "#ffdc83", 'class="lp-neon"'), // Towers with tall neon strips.
        skyline(213, 126, 8, 22, "#170c2c") + rect(0, 126, 240, 16, "#0e0820") + reflect +
          path("M60 112 C48 103 50 94 56 94 Q60 94 60 99 Q60 94 64 94 C70 94 72 103 60 112 Z", "none", 'stroke="#ff8ecb" stroke-width="2.4" stroke-linejoin="round" class="lp-neon"') + // A heart sign...
          path("M114 100 H130 V96 L138 102 L130 108 V104 H114 Z", "none", 'stroke="#ffdc83" stroke-width="2" stroke-linejoin="round" class="lp-neon"') + // ...an arrow...
          path("M178 108 V96 L182 100 Q184 99 186 100 L190 96 V108 Q184 112 178 108 Z", "none", 'stroke="#70ebea" stroke-width="2" stroke-linejoin="round" class="lp-neon"') + // ...and a cat face.
          path("M0 132 H240", "none", 'stroke="#ff8ecb" stroke-width=".8" opacity=".4" stroke-dasharray="10 14"'),
        falling("rain", path(rain, "none", 'stroke="#ffd0ea" stroke-width=".9" opacity=".55"')));
    },

    "frame-arcade-cabinet": function () { // The window is an arcade cabinet's screen: a violet cabinet with neon edges, a glowing marquee on top, and a control panel for a sill.
      const hole = CLIPS["frame-arcade-cabinet"];
      return path("M128 90 H272 V228 H128 Z " + hole, "#2a1848", 'fill-rule="evenodd"') + path("M132 92 V226 M268 92 V226", "none", 'stroke="#ff8ecb" stroke-width="2.5" class="lp-neon"') + // The cabinet face and its neon edges.
        path(hole, "none", 'stroke="#0d0820" stroke-width="6"') + path(hole, "none", 'stroke="#70ebea" stroke-width="2" class="lp-neon"') +               // The screen's bezel.
        path("M152 112 Q156 104 168 104", "none", 'stroke="#ffffff" stroke-width="2.5" opacity=".3" stroke-linecap="round"') +                          // Glare on the glass.
        rect(124, 60, 152, 26, "#1a1030", 'rx="4"') + rect(130, 64, 140, 18, "#ff8ecb", 'rx="2" opacity=".92" class="lp-neon"') +                        // The marquee...
        path(star(152, 73, 6) + star(248, 73, 6), "#fff8dc", 'class="lp-twinkle"') + path("M200 80 C190 73 191 66 195 66 Q200 66 200 70 Q200 66 205 66 C209 66 210 73 200 80 Z", "#3a1060") + // ...with sparkles and a heart.
        path("M124 228 H276 L284 246 H116 Z", "#3a2460") + rect(116, 246, 168, 5, "#1a1030", 'rx="1"') + line(124, 228, 276, 228, "#ff8ecb", 2) +    // The control panel.
        oval(164, 238, 7, 2.6, "#110920") + line(164, 238, 164, 228, "#c9c2d8", 2.5) + circle(164, 226, 4.6, "#ff8ecb") + circle(162.5, 224.5, 1.4, "#ffffff", 'opacity=".7"') + // The joystick.
        [[196, "#70ebea"], [212, "#ffdc83"], [228, "#ff8ecb"], [244, "#c9a8ff"]].map(function (b, i) { return oval(b[0], 238, 5.5, 2.8, b[1], i === 1 ? 'class="lp-twinkle"' : ""); }).join(""); // Four buttons.
    },

    "curtain-arcade-tinsel": function () { // A party-tinsel curtain hung from a neon tube: long glittering strands at the sides, a short fringe across the middle.
      const colours = ["#ff8ecb", "#70ebea", "#c9a8ff", "#ffdc83"], strands = ["", "", "", ""];
      let glints = "";
      for (let x = 127, i = 0; x <= 273; x += 4.8, i++) {
        const d = Math.abs(x - 200) / 74, length = round(10 + Math.pow(d, 2.6) * 148);                                                        // Short in the middle, long at the sides.
        strands[i % 4] += "M" + x + " 89 l1.2 " + round(length / 3) + " l-1.2 " + round(length / 3) + " l1.2 " + round(length / 3) + " ";      // A slightly kinked strand.
        if (i % 3 === 0) glints += star(x, round(89 + length * .62), 2.4) + " ";
      }
      return strands.map(function (d, i) { return path(d, "none", 'stroke="' + colours[i] + '" stroke-width="2.4" stroke-dasharray="5 1.2" opacity=".9"'); }).join("") +
        path(glints, "#fff8dc", 'class="lp-twinkle"') +
        rect(118, 83, 164, 7, "#3a2460", 'rx="3.5"') + rect(121, 85, 158, 3, "#70ebea", 'rx="1.5" class="lp-neon"') + circle(118, 86.5, 5, "#ff8ecb") + circle(282, 86.5, 5, "#ff8ecb"); // The neon rod.
    },

    "lamp-arcade-joystick": function () { // A giant joystick standing on the floor: its ball-top glows pink, and its base has three light-up buttons.
      return oval(56, 268, 52, 48, "#ff8ecb", 'opacity=".12"') + oval(56, 405, 36, 4, "#000000", 'opacity=".35"') +
        path("M22 404 L28 368 H84 L90 404 Z", "#2a1848") + path("M28 368 L34 360 H78 L84 368 Z", "#3a2460") + line(28, 368, 84, 368, "#ff8ecb", 2, 'class="lp-neon"') + // The base.
        circle(38, 386, 5, "#70ebea") + circle(56, 388, 5, "#ffdc83", 'class="lp-twinkle"') + circle(74, 386, 5, "#ff8ecb") + path("M35 384 a3 2 0 0 1 4 -1 M53 386 a3 2 0 0 1 4 -1 M71 384 a3 2 0 0 1 4 -1", "none", 'stroke="#ffffff" stroke-width="1.2" opacity=".6"') + // Its buttons.
        rect(52, 282, 8, 76, "#c9c2d8") + rect(56, 282, 4, 76, "#9a92b0") + path("M44 364 Q56 344 68 364 Z", "#110920") +                         // The stick and its rubber boot.
        circle(56, 268, 22, "#ff8ecb", 'class="lp-neon"') + circle(56, 270, 15, "#ffb3d9") + circle(48, 260, 5, "#ffffff", 'opacity=".7"') +      // The glowing ball.
        path(star(22, 246, 3.4), "#fff8dc", 'class="lp-twinkle"') + path(star(90, 286, 3), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.7s"');
    },

    "rug-arcade-dance": function () { // A dance-mat rug: nine squares with glowing arrow pads, a star in the middle, and a neon border.
      const arrow = "M0 -30 L28 -2 H12 V28 H-12 V-2 H-28 Z";
      let mat = rect(-146, -146, 292, 292, "#120a22", 'rx="16"') + rect(-146, -146, 292, 292, "none", 'rx="16" stroke="#ff8ecb" stroke-width="6" class="lp-neon"');
      for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) mat += rect(c * 92 - 42, r * 92 - 42, 84, 84, Math.abs(r + c) % 2 ? "#3a2460" : "#2a1848", 'rx="8"');
      [[0, -1, 0, "#ff8ecb"], [1, 0, 90, "#70ebea"], [0, 1, 180, "#ffdc83"], [-1, 0, 270, "#c9a8ff"]].forEach(function (p, i) { // The four arrows, each pointing out from the middle.
        mat += group(path(arrow, p[3], 'class="lp-twinkle" style="animation-delay:' + i * .5 + 's"'), 'transform="translate(' + p[0] * 92 + " " + p[1] * 92 + ") rotate(" + p[2] + ')"');
      });
      mat += path(star(0, 0, 32), "#fff8dc") + path("M-92 -92 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0Z M92 -92 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0Z M-92 92 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0Z M92 92 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0Z", "#5a3a8a"); // The middle star and corner studs.
      return oval(200, 442, 160, 44, "#ff8ecb", 'opacity=".1"') + group(mat, 'transform="translate(200 442) scale(.95 .27)"');
    },

    "bed-arcade-ballpit": function () { // A padded ball pit with a neon rim, heaped with bright balls and a soft cushion on top.
      const colours = ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff"];
      const balls = [[300, 424], [312, 426], [324, 427], [336, 428], [348, 428], [360, 427], [372, 425], [382, 422], [306, 416], [318, 418], [330, 419], [342, 419], [354, 419], [366, 418], [377, 414], [314, 409], [326, 410], [362, 410], [372, 405], [336, 406]];
      return oval(340, 462, 58, 6, "#000000", 'opacity=".3"') + oval(340, 418, 50, 12, "#a8407e") +                                                   // Shadow and the pit's far wall.
        balls.map(function (b, i) { return circle(b[0], b[1], 6.5, colours[i % 4]); }).join("") + path(balls.map(function (b) { return "M" + (b[0] - 3) + " " + (b[1] - 2.5) + " a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0Z"; }).join(" "), "#ffffff", 'opacity=".55"') + // The balls and their shine.
        oval(346, 404, 16, 6.5, "#fff1e0") + path(star(346, 404, 3.4), "#ff8ecb") +                                                                 // The cushion.
        path("M290 418 V444 Q290 458 340 458 Q390 458 390 444 V418 A50 12 0 0 1 290 418 Z", "#ff8ecb") +                                                 // The padded front wall...
        path("M300 440 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z M318 446 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z M338 448 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z M358 446 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z M376 440 a2.4 2.4 0 1 0 4.8 0 a2.4 2.4 0 1 0 -4.8 0Z", "#fff1e0", 'opacity=".8"') + // ...with polka dots...
        oval(340, 418, 50, 12, "none", 'stroke="#70ebea" stroke-width="3" class="lp-neon"') + path(star(296, 404, 3.4), "#fff8dc", 'class="lp-twinkle"') + path(star(388, 400, 3), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.8s"'); // ...and a neon rim.
    },

    "door-arcade-entrance": function () { // An arcade's glass entrance door in a neon frame: through the glass, cabinets glow; a push bar and a little heart sign on the door.
      const cabinet = function (x, screen) { return path("M" + x + " 284 V252 L" + (x + 3) + " 236 H" + (x + 17) + " V284 Z", "#2a1848") + rect(x + 4, 242, 11, 9, screen, 'class="lp-twinkle"') + rect(x + 3, 237, 14, 3, "#ff8ecb") + path("M" + (x - 1) + " 262 L" + (x + 2) + " 256 H" + (x + 19) + " V262 Z", "#5a3a8a"); }; // A cabinet seen inside, with its control ledge.
      return oval(-25, 276, 48, 90, "#ff8ecb", 'opacity=".08"') + rect(-64, 194, 78, 160, "#120a22", 'rx="3"') + rect(-62, 196, 74, 158, "none", 'rx="3" stroke="#ff8ecb" stroke-width="3" class="lp-neon"') + // Neon frame.
        rect(-56, 202, 62, 152, "#3a2460") + rect(-50, 210, 50, 76, "#170c2c") + oval(-25, 280, 26, 10, "#70ebea", 'opacity=".15"') +                 // The door and its window into the arcade.
        cabinet(-47, "#70ebea") + cabinet(-24, "#ffdc83") + path("M-2 284 V246 H-6 V284 Z", "#2a1848") +
        path("M-48 230 L-32 212 M-40 240 L-22 220", "none", 'stroke="#ffffff" stroke-width="2" opacity=".14" stroke-linecap="round"') + rect(-50, 210, 50, 76, "none", 'stroke="#5a3a8a" stroke-width="2"') + // Glass reflections and its edge.
        path("M-10 224 C-17 219 -16 213 -13 213 Q-10 213 -10 216 Q-10 213 -7 213 C-4 213 -3 219 -10 224 Z", "none", 'stroke="#ff8ecb" stroke-width="1.6" class="lp-neon lp-twinkle"') + // A little heart sign in the window.
        rect(-52, 296, 54, 7, "#c9c2d8", 'rx="3.5"') + rect(-52, 296, 54, 2, "#ffffff", 'opacity=".4" rx="1"') + rect(-56, 328, 62, 26, "#2a1848") +   // Push bar and kick plate.
        path(star(-40, 341, 4) + star(-25, 341, 4) + star(-10, 341, 4), "#ffdc83", 'opacity=".75"') + oval(-25, 356, 34, 4, "#ff8ecb", 'opacity=".3"');
    },

    "hang-arcade-gamepad": function () { // A neon sign shaped like a game controller, hung on two chains, with a gold score token dangling below.
      return path("M310 0 V49 M356 0 V49", "none", 'stroke="#8a7aa8" stroke-width="1.4" stroke-dasharray="3 2"') + oval(333, 68, 46, 30, "#70ebea", 'opacity=".1"') +
        path("M303 58 Q303 48 314 48 H352 Q363 48 363 58 L368 80 Q370 90 361 90 Q355 90 350 82 H316 Q311 90 305 90 Q296 90 298 80 Z", "#1a1030", 'opacity=".75" stroke="#70ebea" stroke-width="3.5" stroke-linejoin="round" class="lp-neon"') + // The controller.
        path("M318 60 V74 M311 67 H325", "none", 'stroke="#ff8ecb" stroke-width="3.5" stroke-linecap="round" class="lp-neon"') +                       // Its pad...
        circle(348, 60, 3, "#ffdc83") + circle(355, 67, 3, "#ff8ecb") + circle(341, 67, 3, "#70ebea") + circle(348, 74, 3, "#c9a8ff", 'class="lp-twinkle"') + // ...and four buttons.
        line(333, 82, 333, 100, "#8a7aa8", 1) + circle(333, 108, 8, "#ffdc83", 'stroke="#d9b24a" stroke-width="2"') + path(star(333, 108, 5), "#fff8dc", 'class="lp-twinkle"') + // The token.
        path(star(296, 104, 3.4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.5s"') + path(star(372, 40, 3), "#fff8dc", 'class="lp-twinkle" style="animation-delay:1.1s"');
    },

    "table-arcade-pinball": function () { // A little pinball machine on legs: bumpers, flippers and a silver ball on the playfield, and a lit-up backbox.
      return rect(311, 330, 4, 30, "#c9c2d8") + rect(357, 330, 4, 30, "#c9c2d8") + rect(308, 358, 10, 4, "#3a2460", 'rx="1"') + rect(354, 358, 10, 4, "#3a2460", 'rx="1"') + // Legs and feet.
        rect(314, 258, 44, 32, "#3a2460", 'rx="2"') + rect(318, 262, 36, 20, "#0d0820") + path(star(328, 272, 6), "#ffdc83", 'class="lp-twinkle"') + // The backbox, its screen, a star...
        path("M344 278 C337 273 338 267 341 267 Q344 267 344 270 Q344 267 347 267 C350 267 351 273 344 278 Z", "#ff8ecb") + rect(314, 258, 44, 3, "#ff8ecb", 'class="lp-neon"') + // ...and a heart.
        path("M320 285 h2 M326 285 h2 M332 285 h2 M338 285 h2 M344 285 h2 M350 285 h2", "none", 'stroke="#ffdc83" stroke-width="2"') +                // A row of bulbs.
        path("M304 316 H368 L364 334 H308 Z", "#3a2460") + line(306, 324, 366, 324, "#ff8ecb", 2, 'class="lp-neon"') +                               // The cabinet.
        path("M306 316 L314 288 H358 L366 316 Z", "#1a1030") + path("M310 314 L317 291 H355 L362 314 Z", "#2a1848") +                                // The sloping playfield...
        path("M318 300 L314 312 M354 300 L358 312", "none", 'stroke="#c9a8ff" stroke-width="1.5"') +
        circle(326, 297, 4.5, "#ff8ecb") + circle(346, 297, 4.5, "#70ebea") + circle(336, 304, 4.5, "#ffdc83", 'class="lp-twinkle"') + path("M324.5 296 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0Z M344.5 296 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0Z M334.5 303 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0Z", "#ffffff") + // ...its bumpers...
        path("M322 311 L332 314 M350 311 L340 314", "none", 'stroke="#fff1e0" stroke-width="2.5" stroke-linecap="round"') + circle(338, 309, 1.9, "#e6ecf2") + // ...flippers and ball...
        path("M318 293 L332 291", "none", 'stroke="#ffffff" stroke-width="1.6" opacity=".35" stroke-linecap="round"');                                // ...under glass.
    },

    "plant-arcade-cactus": function () { // A neon sign of a cactus, standing in a pink pot, with a glowing flower on top.
      const cactus = "M10 368 V352 H2 Q-4 352 -4 346 V332 Q-4 328 0 328 Q4 328 4 332 V344 H10 V318 Q10 304 18 304 Q26 304 26 318 V330 H32 V316 Q32 310 36 310 Q40 310 40 316 V334 Q40 340 34 340 H26 V368 Z"; // The whole cactus outline, arms and all.
      return oval(18, 334, 34, 40, "#7fffc0", 'opacity=".1"') + path(cactus, "#1f5a48", 'opacity=".85"') + path(cactus, "none", 'stroke="#7fffc0" stroke-width="3" stroke-linejoin="round" class="lp-neon"') +
        path("M14 320 l-3 -2 M22 330 l3 -2 M14 342 l-3 -2 M22 354 l3 -2 M0 336 l-3 -1 M36 322 l3 -1", "none", 'stroke="#bfffe0" stroke-width="1.2" stroke-linecap="round" opacity=".7"') + // Its spines.
        path(star(18, 300, 7), "#ff8ecb", 'class="lp-neon lp-twinkle"') + circle(18, 300, 2, "#fff1e0") +                                             // The flower.
        path("M4 372 H32 L28 392 H8 Z", "#3a2460") + rect(2, 368, 32, 6, "#ff8ecb", 'rx="2" class="lp-neon"') + path("M12 382 h3 v3 h-3Z M21 382 h3 v3 h-3Z M16.5 386 h3 v3 h-3Z", "#70ebea"); // The pot, with a few pixels on it.
    },

    "chest-arcade-gacha": function () { // A capsule machine for a toy chest: a glass dome full of two-tone capsules, a crank to turn, and one capsule waiting in the chute.
      const caps = [[80, 428, "#ff8ecb"], [92, 430, "#70ebea"], [104, 428, "#ffdc83"], [85, 419, "#c9a8ff"], [99, 418, "#ff8ecb"], [92, 408, "#70ebea"], [80, 410, "#ffdc83"], [105, 409, "#c9a8ff"]];
      return oval(92, 477, 40, 4, "#000000", 'opacity=".3"') +
        caps.map(function (c) { return circle(c[0], c[1], 5.5, c[2]) + path("M" + (c[0] - 5.5) + " " + c[1] + " A5.5 5.5 0 0 1 " + (c[0] + 5.5) + " " + c[1] + " Z", "#fff1e0"); }).join("") + // The capsules, each half white.
        circle(92, 418, 22, "#bfe8ff", 'opacity=".22" stroke="#e6f6ff" stroke-width="1.8"') + path("M76 410 A18 18 0 0 1 90 400", "none", 'stroke="#ffffff" stroke-width="2.4" opacity=".55" stroke-linecap="round"') + // The glass dome and its glint.
        rect(87, 394, 10, 4, "#c85a9e", 'rx="1.5"') + rect(70, 438, 44, 9, "#c85a9e", 'rx="2"') + line(70, 440, 114, 440, "#70ebea", 1.6, 'class="lp-neon"') + // Top knob and neck.
        rect(62, 446, 60, 30, "#ff8ecb", 'rx="4"') + rect(62, 446, 60, 5, "#ffb3d9", 'rx="3"') +                                                     // The body.
        circle(80, 460, 7.5, "#fff1e0") + line(80, 460, 90, 454, "#c9c2d8", 3, 'stroke-linecap="round"') + circle(90, 454, 2.6, "#ffdc83") + circle(80, 460, 2, "#c85a9e") + // The crank.
        rect(98, 462, 18, 11, "#120a22", 'rx="3"') + path("M101 473 A6 6 0 0 1 113 473 Z", "#70ebea", 'class="lp-twinkle"') + rect(100, 441, 10, 3, "#120a22", 'rx="1"') + // The chute with a capsule, and the coin slot on the neck.
        path(star(107, 455, 3.6), "#fff1e0");                                                                                                         // A little sparkle decal.
    },

    // Data Vault set
    "wall-datavault-racks": function () { // Four tall server racks per tile with rows of blinking LEDs, under a cable tray that runs edge to edge.
      const roll = dice(901), lights = ["#70ebea", "#8f9bff", "#ff8ecb", "#ffdc83"];
      let bodies = "", bays = "", slits = "", screens = "", cables = "";
      const leds = ["", "", "", ""], dim = [];
      for (let r = 0; r < 4; r++) {
        const x = 12 + r * 100;                                                                                    // Each rack sits 12 in from its 100-wide slot, so the gaps match across the join.
        bodies += "M" + x + " 44 h76 v308 h-76Z ";
        cables += "M" + (x + 22) + " 26 Q" + (x + 20) + " 36 " + (x + 30) + " 44 M" + (x + 54) + " 26 Q" + (x + 58) + " 38 " + (x + 48) + " 44 "; // Two cables drop from the tray into each rack.
        for (let u = 0; u < 13; u++) {
          const y = 54 + u * 22;
          bays += "M" + (x + 6) + " " + y + " h64 v16 h-64Z ";                                                     // One rack unit.
          if ((u + r * 3) % 5 === 2) screens += "M" + (x + 40) + " " + (y + 4) + " h24 v8 h-24Z ";                 // Now and then a little status screen...
          else slits += "M" + (x + 40) + " " + (y + 5) + " h24 M" + (x + 40) + " " + (y + 11) + " h24 ";           // ...otherwise vent slits.
          for (let k = 0; k < 3; k++) {
            const pick = Math.floor(roll(0, 10)), led = "M" + (x + 11 + k * 7) + " " + (y + 6) + " h4 v4 h-4Z ";
            if (pick < 4) leds[pick] += led; else dim.push(led);                                                    // Most LEDs are lit in one of four colours, the rest sleep.
          }
        }
      }
      return rect(0, 0, 400, 352, "#0f1c2a") + rect(0, 290, 400, 62, "#70ebea", 'opacity=".05"') +              // The wall, and a cold haze low down.
        path(bodies, "#142839", 'stroke="#223d58" stroke-width="2"') + path(bays, "#182f48") + path(slits, "none", 'stroke="#0d1a28" stroke-width="2"') +
        path(screens, "#70ebea", 'opacity=".22"') + path(dim.join(""), "#243a52") +
        leds.map(function (d, i) { return path(d, lights[i], i % 2 ? 'opacity=".8" class="lp-twinkle" style="animation-delay:' + (i * .6) + 's"' : 'opacity=".7"'); }).join("") + // Lit LEDs, half of them twinkling.
        rect(0, 16, 400, 10, "#1d3550") + rect(0, 16, 400, 2, "#3a5a78") +                                          // The cable tray along the top, whole width so it joins.
        path(cables, "none", 'stroke="#8f9bff" stroke-width="2.4" stroke-linecap="round" opacity=".75"');
    },

    "floor-datavault-tiles": function () { // A raised data-centre floor: square tiles with a gap all round, some of them perforated cooling vents.
      let tiles = "", holes = "", marks = "";
      for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
        const x = col * 50, y = 350 + row * 50;
        tiles += "M" + (x + 2) + " " + (y + 2) + " h46 v46 h-46Z ";                                                   // Each tile is inset 2, so the gap at the join matches the others.
        if ((row * 3 + col) % 4 === 1) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) holes += "M" + (x + 10 + i * 9) + " " + (y + 10 + j * 9) + " h4 v4 h-4Z "; // A vent tile.
        else if ((row + col) % 5 === 3) marks += "M" + (x + 16) + " " + (y + 18) + " l9 7 l-9 7 M" + (x + 26) + " " + (y + 18) + " l9 7 l-9 7 "; // An aisle chevron.
      }
      return rect(0, 350, 400, 150, "#0c1726") + path(tiles, "#16293d") + path(tiles, "none", 'stroke="#25425f" stroke-width="1.2"') +
        path(holes, "#0a1420") + path(marks, "none", 'stroke="#70ebea" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".45"') +
        rect(0, 350, 400, 150, "#8f9bff", 'opacity=".04"') + rect(0, 350, 400, 3, "#70ebea", 'opacity=".55"');         // A faint periwinkle wash, and the glowing skirting line.
    },

    "art-datavault-firewall": function () { // A little monitor on the wall showing a very polite firewall: a smiling brick wall with a bow tie and tiny flames.
      let scan = "";
      for (let y = 160; y < 210; y += 4) scan += "M38 " + y + " H100 ";                                              // Scanlines across the screen.
      return rect(29, 149, 80, 78, "#8f9bff", 'opacity=".12" rx="10"') + rect(30, 150, 78, 76, "#24384f", 'rx="8"') + rect(37, 156, 64, 54, "#091522", 'rx="4"') +
        rect(37, 156, 64, 54, "none", 'rx="4" stroke="#70ebea" stroke-width="1.5" class="lp-neon"') +
        path("M56 180 q-4 -7 0 -12 q1 5 4 5 q-1 -6 3 -10 q2 6 5 7 q1 -5 4 -6 q3 5 1 10 q3 -1 4 -4 q4 5 0 10 Z", "#ffb84a") + // The little flames along the top of the wall.
        path("M60 180 q-1 -4 2 -6 q1 4 3 4 q1 -4 4 -5 q1 4 2 7 Z", "#fff1cd", 'class="lp-twinkle"') +
        rect(48, 180, 42, 26, "#e8726a", 'rx="2"') +
        path("M48 188.5 H90 M48 197 H90 M58 180 V188.5 M80 180 V188.5 M69 188.5 V197 M58 197 V206 M80 197 V206", "none", 'stroke="#a8434e" stroke-width="1.3"') + // The mortar between the bricks.
        circle(62, 192, 2.4, "#2a1a3a") + circle(76, 192, 2.4, "#2a1a3a") + circle(62.8, 191.2, .8, "#fff") + circle(76.8, 191.2, .8, "#fff") +
        oval(57, 198, 3, 1.8, "#ff8ecb", 'opacity=".8"') + oval(81, 198, 3, 1.8, "#ff8ecb", 'opacity=".8"') + path("M66 197 q3 3 6 0", "none", 'stroke="#2a1a3a" stroke-width="1.4" stroke-linecap="round"') +
        path("M69 206 L62 202 V210 Z M69 206 L76 202 V210 Z", "#8f9bff") + circle(69, 206, 1.8, "#c9d2ff") +             // The bow tie: very polite.
        rect(82, 160, 15, 11, "#e6fbff", 'rx="3"') + path("M85 171 l-2 4 l5 -4 Z", "#e6fbff") +                         // A speech bubble...
        path("M89.5 168.5 c-4 -3 -3 -6 -1 -6 q1 0 1 1.4 q0 -1.4 1 -1.4 c2 0 3 3 -1 6 Z", "#ff6f9f") +                    // ...saying a heart.
        path(scan, "none", 'stroke="#70ebea" stroke-width="1" opacity=".07"') +
        rect(44, 215, 22, 3, "#0f1c2a", 'rx="1.5"') + circle(98, 218, 2.4, "#70ebea", 'class="lp-twinkle"') + circle(90, 218, 2, "#8f9bff");
    },

    "shelf-datavault-floppies": function () { // Two floppy disks leaning together, a glowing data cube on a stand, and a mug of something warm.
      function floppy(x, y, tilt, body, label) { // A 3.5-inch disk standing up, with its metal shutter and paper label.
        return group(rect(-11, -22, 22, 22, body, 'rx="1.5"') + rect(-6, -22, 11, 8, "#c8d2e8") + rect(0, -21, 3, 6, body) + rect(-8, -11, 16, 10, label, 'rx="1"') +
          path("M-6 -8 h12 M-6 -5 h9", "none", 'stroke="#8f9bff" stroke-width=".9"'), 'transform="translate(' + x + " " + y + ") rotate(" + tilt + ')"');
      }
      return floppy(310, 200, -4, "#3d4675", "#f0deff") + floppy(326, 200, 9, "#2f8a9a", "#e6fbff") +
        oval(352, 186, 18, 18, "#70ebea", 'opacity=".14"') + path("M342 200 h20 l-3 -5 h-14 Z", "#24384f") +                    // The cube's glow and its stand.
        path("M352 168 L363 174 V187 L352 193 L341 187 V174 Z", "#70ebea", 'opacity=".35" class="lp-neon"') +
        path("M352 168 L363 174 L352 180 L341 174 Z", "#c9fbff", 'opacity=".45"') + path("M352 180 V193 M341 174 L352 180 L363 174", "none", 'stroke="#c9fbff" stroke-width="1.2"') +
        circle(352, 182, 2.4, "#fff", 'class="lp-twinkle"') +
        path("M366 184 h12 v13 q0 3 -3 3 h-6 q-3 0 -3 -3 Z", "#8f9bff") + path("M378 187 q5 0 5 4 q0 4 -5 4", "none", 'stroke="#8f9bff" stroke-width="2"') + // The mug.
        path("M370 180 q-2 -4 0 -7 M374 180 q2 -4 0 -7", "none", 'stroke="#e6fbff" stroke-width="1.2" opacity=".55" stroke-linecap="round"') +
        rect(296, 200, 84, 6, "#3a5a78", 'rx="2"') + rect(296, 205, 84, 1.5, "#70ebea", 'opacity=".7"') +                       // A steel shelf with a cyan edge light.
        path("M304 206 l6 10 M372 206 l-6 10", "none", 'stroke="#3a5a78" stroke-width="3" stroke-linecap="round"');
    },

    "view-datavault-cloud": function () { // Server towers in a cold blue dusk, linked by streams of data to the clouds above; little bits of data drift down.
      function towers(seed, base, low, high, fill, lit, chance) { // Towers across one tile as two shapes: the bodies, then their lit LEDs.
        const roll = dice(seed);
        let x = 0, bodies = "", leds = "";
        while (x < TILE) {
          const w = Math.min(Math.round(roll(14, 26)), TILE - x), h = Math.round(roll(low, high));                 // The last tower stops exactly at the tile's edge.
          bodies += "M" + x + " " + (base - h) + " h" + w + " V140 H" + x + " Z ";
          for (let y = base - h + 5; y < base - 3; y += 6) for (let lx = x + 3; lx < x + w - 4; lx += 5) if (roll(0, 1) > chance) leds += "M" + lx + " " + y + " h2 v2 h-2Z ";
          x += w;
        }
        return path(bodies, fill) + path(leds, lit);
      }
      function cloud(x, y, s) { // A puffy cloud with a data stream dripping from it.
        return group(oval(0, 0, 22, 8, "#dfe6ff", 'opacity=".85"') + oval(-10, -6, 11, 8, "#dfe6ff", 'opacity=".85"') + oval(8, -7, 13, 10, "#eef2ff", 'opacity=".85"') +
          path("M-8 8 V40 M0 8 V52 M8 8 V34", "none", 'stroke="#70ebea" stroke-width="1.4" stroke-dasharray="2 4" opacity=".7"'), 'transform="translate(' + x + " " + y + ") scale(" + s + ')"');
      }
      return view(["#3d5c94", "#a6ecf2"], ["#060c1c", "#16304c"], 24,
        cloud(48, 24, 1) + cloud(168, 30, .8) + towers(911, 98, 26, 54, "#33507e", "#8f9bff", .62),
        towers(912, 112, 18, 40, "#1f3658", "#70ebea", .55),
        rect(0, 118, 240, 30, "#0b1626") + path("M0 113 H240 M0 118 H240", "none", 'stroke="#3a5a78" stroke-width="2"') +    // The near walkway and its rail.
          path("M10 113 V122 M50 113 V122 M90 113 V122 M130 113 V122 M170 113 V122 M210 113 V122", "none", 'stroke="#3a5a78" stroke-width="3"') +
          path("M30 124 h8 v2 h-8Z M110 124 h8 v2 h-8Z M190 124 h8 v2 h-8Z", "#70ebea", 'class="lp-twinkle"'),               // Aisle lights in the floor.
        falling("rain", scatter(913, 22, function (roll, i) { return rect(round(roll(2, 118)), round(roll(0, 126)), 2, 3, i % 3 ? "#70ebea" : "#c9d2ff", 'opacity=".75"'); })));
    },

    "frame-datavault-port": function () { // A chamfered steel hatch around the window, with a cyan neon lining, corner bolts, hinges and a row of status lights on the sill.
      const bolts = [[150, 100], [250, 100], [264, 120], [264, 202], [250, 222], [150, 222], [136, 202], [136, 120]];
      return path(CLIPS["frame-datavault-port"], "none", 'stroke="#3a5a78" stroke-width="10" stroke-linejoin="round"') +
        path(CLIPS["frame-datavault-port"], "none", 'stroke="#70ebea" stroke-width="2" stroke-linejoin="round" class="lp-neon"') +
        path(bolts.map(function (b) { return "M" + (b[0] - 2.6) + " " + b[1] + " a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0Z"; }).join(" "), "#a8b4c4") + // The bolts, as one shape.
        rect(130, 134, 7, 20, "#24384f", 'rx="2"') + rect(130, 168, 7, 20, "#24384f", 'rx="2"') +                                  // Hinges on the left.
        line(140, 161, 260, 161, "#3a5a78", 2.5, 'opacity=".8"') +
        rect(176, 86, 48, 7, "#24384f", 'rx="3"') + circle(200, 89.5, 2.4, "#8f9bff", 'class="lp-twinkle"') +                   // A sensor strip on top.
        rect(130, 224, 140, 9, "#24384f", 'rx="3"') + rect(130, 224, 140, 2, "#3a5a78") +
        path("M150 228 h5 v2 h-5Z M162 228 h5 v2 h-5Z M233 228 h5 v2 h-5Z", "#70ebea") + path("M174 228 h5 v2 h-5Z M245 228 h5 v2 h-5Z", "#ff8ecb", 'class="lp-twinkle"');
    },

    "curtain-datavault-cables": function () { // Bundles of bright patch cables hanging from a cable tray, tied back with pink straps, each ending in a little plug.
      const colours = ["#70ebea", "#8f9bff", "#ff8ecb", "#ffdc83", "#8be9a8", "#c9a8ff", "#70b8eb"];
      function side(flip) { // One bundle, drawn on the left and mirrored for the right.
        let out = "";
        colours.forEach(function (c, i) {
          const top = 126 + i * 5, end = [214, 232, 204, 238, 222, 196, 228][i], ex = 132 + i * 4 - (i % 2) * 6;          // Where it leaves the tray, and where its plug hangs.
          out += path("M" + top + " 90 Q" + (top + 6) + " 136 " + (140 + i) + " 160 Q" + (138 + i * 1.5) + " 180 " + ex + " " + end, "none", 'stroke="' + c + '" stroke-width="2.8" stroke-linecap="round"') +
            rect(ex - 2.5, end, 5, 7, "#c8d2e8", 'rx="1"') + rect(ex - 1.5, end + 7, 3, 2, "#ffdc83");
        });
        return group(out + rect(134, 156, 18, 7, "#ff6f9f", 'rx="2"') + rect(141, 155, 4, 9, "#d94f84"), flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      }
      return side(false) + side(true) + rect(120, 82, 160, 9, "#24384f", 'rx="2"') + rect(120, 82, 160, 2, "#3a5a78") +
        path("M140 86 h4 v2 h-4Z M170 86 h4 v2 h-4Z M226 86 h4 v2 h-4Z M256 86 h4 v2 h-4Z", "#70ebea") + path("M155 86 h4 v2 h-4Z M241 86 h4 v2 h-4Z", "#8f9bff", 'class="lp-twinkle"') + // Port lights along the tray.
        circle(120, 86.5, 4.5, "#3a5a78") + circle(280, 86.5, 4.5, "#3a5a78");
    },

    "lamp-datavault-cube": function () { // A steel floor lamp holding a glowing wireframe data cube, a periwinkle orbit ring and little bits of data around it.
      const bits = [[22, 226, 0], [92, 236, .5], [28, 284, 1], [86, 278, 1.4]];
      return oval(56, 250, 56, 52, "#70ebea", 'opacity=".1"') + oval(56, 250, 34, 32, "#8f9bff", 'opacity=".12"') +
        oval(56, 404, 22, 5, "#1d3550") + path("M40 404 Q44 394 56 392 Q68 394 72 404 Z", "#24384f") +                         // The base.
        rect(53, 274, 6, 120, "#3a5a78") + rect(55, 280, 1.6, 108, "#70ebea", 'opacity=".6"') + rect(50, 330, 12, 4, "#24384f", 'rx="1"') + // The pole, with a cyan light running up it.
        path("M46 274 h20 l-4 -6 h-12 Z", "#24384f") +
        path("M56 226 L76 238 V262 L56 274 L36 262 V238 Z", "#70ebea", 'opacity=".3" class="lp-neon"') +                        // The cube's glass...
        path("M56 226 L76 238 L56 250 L36 238 Z", "#c9fbff", 'opacity=".35"') +
        path("M56 226 L76 238 V262 L56 274 L36 262 V238 Z M36 238 L56 250 L76 238 M56 250 V274", "none", 'stroke="#c9fbff" stroke-width="1.6" stroke-linejoin="round"') + // ...and its bright edges.
        circle(56, 252, 7, "#e6fbff", 'class="lp-twinkle"') + circle(56, 252, 3, "#fff") +
        oval(56, 250, 36, 9, "none", 'stroke="#8f9bff" stroke-width="1.6" opacity=".8" transform="rotate(-14 56 250)"') +
        bits.map(function (b) { return rect(b[0] - 2.5, b[1] - 2.5, 5, 5, "#70ebea", 'class="lp-twinkle" style="animation-delay:' + b[2] + 's"'); }).join("");
    },

    "rug-datavault-chip": function () { // A microchip rug: a navy chip with silver pins all round, circuit traces and a glowing die with a sparkle in the middle.
      let pins = "", traces = "";
      for (let i = -96; i <= 88; i += 23) {
        pins += "M-132 " + i + " h20 v9 h-20Z M112 " + i + " h20 v9 h-20Z M" + i + " -132 h9 v20 h-9Z M" + i + " 112 h9 v20 h-9Z "; // Pins on all four sides.
        traces += "M-112 " + (i + 4.5) + " H-60 M112 " + (i + 4.5) + " H60 ";                                                    // A trace from each side pin towards the die.
      }
      return oval(200, 446, 150, 30, "#000000", 'opacity=".2"') + group(
        path(pins, "#a8c8d8") + rect(-114, -114, 228, 228, "#1c3450", 'rx="16"') + rect(-104, -104, 208, 208, "none", 'rx="10" stroke="#3a5a78" stroke-width="4"') +
        path(traces, "none", 'stroke="#70ebea" stroke-width="5" opacity=".45"') + circle(-86, -86, 9, "#70ebea") +                // Traces, and the pin-one dot.
        rect(-58, -58, 116, 116, "#0f1c2a", 'rx="6" stroke="#8f9bff" stroke-width="5" class="lp-neon"') + circle(0, 0, 40, "#8f9bff", 'opacity=".25"') +
        path(star(0, 0, 34), "#e6fbff", 'class="lp-twinkle"'), 'transform="translate(200 440) scale(1.15 .3)"');
    },

    "bed-datavault-drawer": function () { // A rack server with its drawer pulled out as a bed: a periwinkle mattress, a pillow and a pixel blanket.
      return oval(340, 462, 56, 5, "#00000055") + oval(340, 452, 50, 8, "#70ebea", 'opacity=".15"') +
        rect(298, 390, 84, 38, "#1f3550", 'rx="4"') + rect(298, 390, 84, 3, "#3a5a78", 'rx="1.5"') +                               // The server behind: the headboard.
        circle(316, 407, 10, "#0f1c2a") + path("M306 407 H326 M316 397 V417 M309 400 L323 414 M323 400 L309 414", "none", 'stroke="#3a5a78" stroke-width="1.6"') + circle(316, 407, 3, "#70ebea") + // Its cooling fan.
        path("M336 400 h3 v3 h-3Z M344 400 h3 v3 h-3Z M336 408 h3 v3 h-3Z", "#70ebea", 'class="lp-twinkle"') + path("M352 400 h3 v3 h-3Z M344 408 h3 v3 h-3Z", "#ff8ecb") +
        path("M362 400 H376 M362 405 H376 M362 410 H376", "none", 'stroke="#0f1c2a" stroke-width="2"') +
        path("M294 432 Q294 420 306 420 H374 Q386 420 386 432 Z", "#8f9bff") + oval(314, 422, 14, 7, "#eef2ff") +                // The mattress and the pillow.
        path("M330 425 Q358 414 388 424 V436 H328 Z", "#70ebea") + path("M336 424 h6 v5 h-6Z M348 422 h6 v5 h-6Z M360 420 h6 v5 h-6Z M372 421 h6 v5 h-6Z M342 429 h6 v5 h-6Z M354 428 h6 v5 h-6Z M366 427 h6 v5 h-6Z", "#2f8a9a", 'opacity=".6"') + // A pixel blanket.
        rect(288, 432, 104, 24, "#2a4466", 'rx="3"') + rect(288, 432, 104, 3, "#4a6a90", 'rx="1.5"') +                           // The drawer front.
        rect(326, 441, 28, 5, "#a8b4c4", 'rx="2.5"') + path("M296 440 V450 M301 440 V450 M372 440 V450 M377 440 V450 M382 440 V450", "none", 'stroke="#16293d" stroke-width="2"') +
        circle(363, 444, 2, "#70ebea", 'class="lp-twinkle"') + circle(311, 444, 2, "#8f9bff") + rect(294, 456, 8, 4, "#16293d") + rect(378, 456, 8, 4, "#16293d");
    },

    "door-datavault-vault": function () { // A heavy vault door with a spoked wheel, big hinges, a glowing keypad and a little heart sticker.
      return rect(-66, 194, 82, 160, "#24384f", 'rx="4"') + rect(-66, 194, 82, 4, "#3a5a78", 'rx="2"') +
        rect(-60, 202, 66, 152, "#33507a", 'rx="10"') + rect(-56, 206, 58, 144, "none", 'rx="8" stroke="#4a6a90" stroke-width="2"') + // The slab and its rim.
        rect(-68, 222, 10, 26, "#a8b4c4", 'rx="3"') + rect(-68, 300, 10, 26, "#a8b4c4", 'rx="3"') +                                  // Hinges.
        path([214, 238, 262, 286, 310, 334].map(function (y) { return "M-2 " + y + " a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0Z"; }).join(" "), "#a8b4c4") + // Rivets down the lock side, as one shape.
        circle(-27, 262, 24, "#24384f") + circle(-27, 262, 18, "none", 'stroke="#a8b4c4" stroke-width="3"') +
        path("M-27 240 V284 M-49 262 H-5 M-42.6 246.4 L-11.4 277.6 M-11.4 246.4 L-42.6 277.6", "none", 'stroke="#a8b4c4" stroke-width="3" stroke-linecap="round"') + // The wheel's spokes.
        circle(-27, 262, 6, "#70ebea", 'class="lp-neon"') + circle(-27, 262, 2.4, "#e6fbff") +
        rect(-44, 298, 30, 30, "#16293d", 'rx="3"') + rect(-40, 302, 22, 6, "#70ebea", 'opacity=".75" class="lp-twinkle"') +          // The keypad and its screen.
        path("M-38 313 h3 v3 h-3Z M-31 313 h3 v3 h-3Z M-24 313 h3 v3 h-3Z M-38 320 h3 v3 h-3Z M-31 320 h3 v3 h-3Z M-24 320 h3 v3 h-3Z", "#8f9bff") +
        path("M-6 316 c-6 -4 -5 -9 -2 -9 q2 0 2 2 q0 -2 2 -2 c3 0 4 5 -2 9 Z", "#ff8ecb") +                                          // A heart sticker.
        rect(-50, 338, 46, 6, "#16293d", 'rx="2"') + path("M-46 341 H-8", "none", 'stroke="#8f9bff" stroke-width="1.6" stroke-dasharray="4 3"');
    },

    "hang-datavault-cloud": function () { // A sleepy little cloud hung from the ceiling, sending wifi waves, with data charms dangling below: a cube, a floppy and a plug.
      return line(333, 0, 333, 24, "#8a7aa8", 1.2) +
        path("M308 52 V84 M333 56 V100 M358 52 V76", "none", 'stroke="#8a7aa8" stroke-width="1"') +
        oval(333, 46, 40, 13, "#a8b8ff") + circle(312, 40, 14, "#c9d2ff") + circle(332, 32, 18, "#e6ebff") + circle(354, 38, 14, "#c9d2ff") + // The cloud.
        path("M314 50 h10 v-6 h10 M346 50 h-8 v-8", "none", 'stroke="#70ebea" stroke-width="1.4" opacity=".7"') + circle(334, 44, 1.8, "#70ebea") + circle(338, 42, 1.8, "#70ebea") + // Circuit lines on its belly.
        path("M320 36 q4 4 8 0 M337 36 q4 4 8 0", "none", 'stroke="#46507a" stroke-width="2" stroke-linecap="round"') + circle(318, 44, 3, "#ffb3d1", 'opacity=".7"') + circle(348, 44, 3, "#ffb3d1", 'opacity=".7"') +
        path("M366 22 a10 10 0 0 1 10 10 M366 15 a17 17 0 0 1 17 17", "none", 'stroke="#8f9bff" stroke-width="2.2" stroke-linecap="round" class="lp-twinkle"') + circle(366, 32, 2, "#8f9bff") + // Wifi waves.
        path("M308 84 L318 90 V102 L308 108 L298 102 V90 Z", "#70ebea", 'opacity=".5" class="lp-neon"') + path("M298 90 L308 96 L318 90 M308 96 V108", "none", 'stroke="#e6fbff" stroke-width="1.2"') + // A data cube.
        group(rect(-9, -9, 18, 18, "#3d4675", 'rx="1.5"') + rect(-5, -9, 9, 6, "#c8d2e8") + rect(-6, 1, 12, 7, "#f0deff", 'rx="1"'), 'transform="translate(333 109) rotate(8)"') + // A floppy.
        rect(353, 76, 10, 12, "#c8d2e8", 'rx="1.5"') + rect(355, 88, 6, 5, "#ffdc83") + path("M356 80 h4 v4 h-4Z", "#8f9bff") + circle(358, 98, 2, "#ff8ecb", 'class="lp-twinkle" style="animation-delay:.7s"'); // A plug.
    },

    "table-datavault-terminal": function () { // A little rack cabinet for a table, with a chunky terminal on top smiling at Lumi and a keyboard.
      let keys = "";
      for (let col = 0; col < 7; col++) keys += "M" + (321 + col * 5) + " 320.5 h3 v1.6 h-3Z ";                                  // One row of keys.
      return oval(336, 300, 30, 26, "#70ebea", 'opacity=".1"') +
        rect(306, 324, 60, 38, "#1f3550", 'rx="3"') + rect(304, 322, 64, 5, "#3a5a78", 'rx="2"') +                                 // The cabinet and its top.
        path("M312 334 h48 v8 h-48Z M312 346 h48 v8 h-48Z", "#16293d") + path("M316 337 h3 v2 h-3Z M322 349 h3 v2 h-3Z", "#70ebea", 'class="lp-twinkle"') + path("M322 337 h3 v2 h-3Z M316 349 h3 v2 h-3Z", "#8f9bff") +
        rect(308, 362, 6, 3, "#16293d") + rect(358, 362, 6, 3, "#16293d") +
        rect(330, 310, 12, 8, "#24384f") + rect(318, 280, 36, 31, "#2a4466", 'rx="5"') + rect(322, 284, 28, 22, "#0a1626", 'rx="3"') + // The terminal.
        path("M329 293 l3 -3 l3 3 M337 293 l3 -3 l3 3", "none", 'stroke="#70ebea" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="lp-neon"') + // Happy ^ ^ eyes...
        path("M332 298 q4 4 8 0", "none", 'stroke="#70ebea" stroke-width="1.6" stroke-linecap="round"') + rect(344, 300, 3, 4, "#8f9bff", 'class="lp-twinkle"') + // ...a smile and a blinking cursor.
        circle(349, 308.5, 1.2, "#ff8ecb") + path("M316 324 L320 318 H354 L358 324 Z", "#3a5a78") + path(keys, "#c8d2e8");
    },

    "plant-datavault-bonsai": function () { // A bonsai grown from circuit traces: cyan branches with solder-dot buds and soft periwinkle leaf pads, in a chip-shaped pot.
      const pads = [[6, 318, 14, 8], [32, 312, 13, 7], [-6, 342, 11, 6], [40, 332, 10, 6], [18, 300, 10, 6]];
      const nodes = [[6, 318], [32, 312], [-4, 342], [40, 330], [18, 300]];
      return oval(18, 330, 38, 34, "#8f9bff", 'opacity=".08"') +
        pads.map(function (p) { return oval(p[0], p[1], p[2], p[3], "#8f9bff", 'opacity=".45"'); }).join("") +
        path("M18 368 V346 L8 336 V322 M18 346 L30 334 V316 M18 352 H2 L-4 346 M30 334 L40 330 M18 346 V306", "none", 'stroke="#70ebea" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"') + // The trunk and branches, as traces.
        path(nodes.map(function (n) { return "M" + (n[0] - 3) + " " + n[1] + " a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z"; }).join(" "), "#e6fbff", 'class="lp-twinkle"') +
        pads.map(function (p, i) { return circle(p[0] + (i % 2 ? 6 : -6), p[1] - 2, 1.6, "#c9d2ff"); }).join("") +
        path("M-4 372 h6 M-4 378 h6 M-4 384 h6 M34 372 h6 M34 378 h6 M34 384 h6", "none", 'stroke="#a8c8d8" stroke-width="2.4"') +         // The pot's pins.
        rect(0, 366, 36, 24, "#1c3450", 'rx="3"') + rect(0, 366, 36, 4, "#3a5a78", 'rx="2"') + rect(10, 374, 16, 11, "#0f1c2a", 'rx="2" stroke="#8f9bff" stroke-width="1.2"') + circle(5, 386, 1.6, "#70ebea");
    },

    "chest-datavault-cube": function () { // A toy box shaped like a big data cube with neon edges, its lid propped open on a floppy, a toy robot and a ball.
      return oval(92, 478, 44, 4, "#00000055") + oval(92, 448, 46, 34, "#70ebea", 'opacity=".08"') +
        path("M92 420 L124 432 L132 408 L100 396 Z", "#33507a", 'stroke="#70ebea" stroke-width="1.6" stroke-linejoin="round"') +  // The lid, propped open at the back.
        path("M60 432 L92 420 L124 432 L92 444 Z", "#0a1626") +                                                                   // The dark inside.
        group(rect(-7, -16, 14, 13, "#a8b4c4", 'rx="3"') + circle(-3, -10, 1.8, "#70ebea") + circle(3, -10, 1.8, "#70ebea") + line(0, -16, 0, -21, "#a8b4c4", 1.4) + circle(0, -22, 1.8, "#ff8ecb"), 'transform="translate(80 436) rotate(-10)"') + // A toy robot peeking out.
        group(rect(-8, -8, 16, 16, "#3d4675", 'rx="1.5"') + rect(-4, -8, 8, 5, "#c8d2e8") + rect(-5, 1, 10, 6, "#f0deff", 'rx="1"'), 'transform="translate(104 428) rotate(18)"') + // A floppy.
        circle(94, 428, 6, "#ffdc83") + path("M89 426 q5 3 10 0", "none", 'stroke="#ff9d6b" stroke-width="1.6"') +              // A ball.
        path("M60 432 L92 444 V476 L60 464 Z", "#1f3550") + path("M92 444 L124 432 V464 L92 476 Z", "#2a4466") +                 // The two front faces.
        path("M66 446 h10 v8 h8 M70 460 h12 M100 452 h8 l6 -3 M104 462 l10 -4", "none", 'stroke="#70ebea" stroke-width="1.4" opacity=".5"') + // Circuit traces on the faces.
        path("M108 464 c-6 -3 -6 -9 -2 -9 q2 0 2 2 q1 -3 3 -3 c4 0 3 6 -3 10 Z", "#ff8ecb") +
        path("M60 432 L92 444 L124 432 M92 444 V476 M60 432 V464 L92 476 L124 464 V432", "none", 'stroke="#70ebea" stroke-width="2" stroke-linejoin="round" class="lp-neon"');
    },

    // Rooftop Garden set
    rooftopBee: function (x, y, s, flip) { // A little honeybee facing left (flip faces it right): wings, a striped body and a dot of an eye. Five shapes.
      return group(oval(-1, -6, 4.5, 3.2, "#eef8ff", 'opacity=".85"') + oval(4, -6, 3.8, 2.8, "#eef8ff", 'opacity=".85"') + oval(0, 0, 7.5, 5, "#ffdc83") +
        path("M-1.5 -4.7 V4.7 M2.5 -4.2 V4.2 M7 0 l2.6 0", "none", 'stroke="#2a1a3a" stroke-width="1.8"') + circle(-4.6, -1, 1, "#2a1a3a"),
        'transform="translate(' + x + " " + y + ") scale(" + (flip ? -s : s) + " " + s + ')"');
    },

    "wall-rooftop-vines": function () { // Dusky brick with ivy hanging from the roof gutter, bees looping about and two little neon signs.
      let mortar = "", lit = "", edges = "";
      const roll = dice(931);
      for (let row = 0; row < 16; row++) {
        const y = 10 + row * 22, tall = Math.min(22, 352 - y);                                                       // The bottom row stops at the floor line.
        mortar += "M0 " + y + " H400 ";                                                                              // The bed joints run edge to edge.
        for (let x = row % 2 ? 50 : 25; x < 400; x += 50) mortar += "M" + x + " " + y + " v" + tall + " ";             // The upright joints, staggered row by row.
        if (row % 2) edges += "M0 " + y + " h1 v" + tall + " h-1Z M399 " + y + " h1 v" + tall + " h-1Z ";             // Half of a joint on each side of the join.
        for (let x = row % 2 ? 0 : 25; x < 375; x += 50) if (roll(0, 1) > .86 && tall === 22) lit += "M" + (x + 2) + " " + (y + 2) + " h46 v18 h-46Z "; // Now and then a paler brick.
      }
      let stems = "", leafA = "", leafB = "", buds = "";
      [[36, 9, 1], [128, 15, 2], [232, 10, 3], [352, 18, 4]].forEach(function (v) { // Each vine: where it hangs, how many leaves long, and a seed for its sway.
        stems += "M" + v[0] + " 8";
        for (let i = 1; i <= v[1]; i++) {
          const y = 8 + i * 14, px = round(v[0] + Math.sin(i * .9 + v[2]) * 6), side = i % 2 ? 1 : -1;
          stems += " L" + px + " " + y;
          const leaf = "M" + px + " " + y + " q" + side * 6 + " -9 " + side * 12 + " -3 q" + -side + " 9 " + -side * 12 + " 3 Z ";
          if (i % 3) leafA += leaf; else leafB += leaf;
          if (i % 4 === 2) buds += "M" + (px - side * 6 - 2.6) + " " + (y + 2) + " a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0Z ";  // A pink blossom on the other side.
        }
        stems += " ";
      });
      return rect(0, 0, 400, 352, "#1d2a3a") + rect(0, 240, 400, 112, "#ff8ecb", 'opacity=".05"') + path(lit, "#23334a") +            // The wall, a pink glow from the city below, paler bricks.
        path(mortar, "none", 'stroke="#141e2b" stroke-width="2"') + path(edges, "#141e2b") +
        path("M70 262 c-14 -10 -10 -22 -2 -22 q4 0 6 4 q2 -4 6 -4 c8 0 12 12 -10 22 Z", "none", 'stroke="#ff8ecb" stroke-width="2.6" stroke-linejoin="round" class="lp-neon"') + // A neon heart...
        path("M230 290 a6 6 0 1 1 6 -6 a6 6 0 1 1 6 6 a6 6 0 1 1 -6 6 a6 6 0 1 1 -6 -6 Z", "none", 'stroke="#8be9a8" stroke-width="2.4" class="lp-neon"') + circle(236, 290, 2.6, "#ffdc83") + // ...and a neon flower.
        rect(0, 0, 400, 8, "#2c3e52") + rect(0, 7, 400, 2, "#3f8a66") +                                                                   // The gutter along the top.
        path(stems, "none", 'stroke="#3f8a66" stroke-width="2.4" stroke-linejoin="round"') + path(leafA, "#5fae86") + path(leafB, "#8be9a8") + path(buds, "#ff8ecb") +
        path("M180 120 q14 -16 26 -2 q10 12 24 0 M262 300 q-12 -14 -24 -2 q-10 10 -22 0 M70 170 q12 10 22 0", "none", 'stroke="#fff" stroke-width="1.2" stroke-dasharray="3 4" opacity=".3"') + // Bee flight paths.
        ART.rooftopBee(172, 122, 1.1) + ART.rooftopBee(270, 300, 1, true) + ART.rooftopBee(98, 168, .9, true);
    },

    "floor-rooftop-pavers": function () { // Grey concrete pavers in staggered rows, with clover and grass tufts growing up between them.
      let stones = "", tops = "", tufts = "";
      [[358, 10], [402, 60], [446, 10]].forEach(function (r) { // Each row: its top, and where its first paver starts.
        for (let x = r[1] - 100; x < 400; x += 100) {
          const a = Math.max(0, x), b = Math.min(400, x + 80);                                                       // A paver over the join is cut exactly at the tile's edges.
          if (b > a) { stones += "M" + a + " " + r[0] + " H" + b + " v34 H" + a + "Z "; tops += "M" + a + " " + (r[0] + 1.5) + " H" + b + " "; }
        }
      });
      tufts = scatter(941, 34, function (roll, i) { const x = round(roll(6, 394)), y = [400, 444, 488][i % 3]; return "M" + x + " " + y + " l-3 -7 M" + x + " " + y + " l0 -9 M" + x + " " + y + " l3 -7 "; }); // Tufts in the gaps between rows.
      const clover = scatter(942, 14, function (roll, i) { const x = round(roll(8, 392)), y = [396, 440, 484][i % 3], r = 2.2; return "M" + (x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; });
      return rect(0, 350, 400, 150, "#2a4a3a") + path(stones, "#4b5b68") + path(tops, "none", 'stroke="#6a7c88" stroke-width="3"') +
        path("M30 366 l8 6 l4 -3 l6 7 M186 412 l10 4 l3 8 M300 454 l-8 8 l2 6", "none", 'stroke="#3a4752" stroke-width="1.4"') +     // A few cracks.
        path(tufts, "none", 'stroke="#8be9a8" stroke-width="1.8" stroke-linecap="round"') + path(clover, "#ffb3d6") +
        rect(0, 350, 400, 3, "#8be9a8", 'opacity=".5"');
    },

    "art-rooftop-billboard": function () { // A tiny rooftop billboard on stilts: a bee hugging a heart, ringed in pink neon, with marquee bulbs and ivy climbing a leg.
      return path("M44 204 V232 M96 204 V232", "none", 'stroke="#4a5a6a" stroke-width="4"') + path("M44 212 L96 228 M96 212 L44 228", "none", 'stroke="#4a5a6a" stroke-width="1.5"') + // Stilts and bracing.
        rect(36, 202, 68, 4, "#5a6a7a", 'rx="1"') + rect(28, 148, 84, 58, "#ff8ecb", 'opacity=".14" rx="6"') +
        rect(32, 152, 76, 50, "#26354a", 'rx="3"') + rect(36, 156, 68, 42, "#ffd9ec") + rect(36, 186, 68, 12, "#bdf2cc") +                  // The board: a pink sky over a mint hill.
        path("M36 156 H104 V160 q-3 6 -6 0 q-2 9 -6 0 q-4 5 -8 0 V160 H36 Z", "#ffb84a") +                                                  // Honey dripping off the top edge.
        circle(54, 186, 5, "#ff8ecb") + circle(54, 186, 1.8, "#ffdc83") + circle(92, 188, 4, "#fff") + circle(92, 188, 1.5, "#ffdc83") + // Flowers on the hill.
        path("M82 186 c-12 -8 -10 -18 -3 -18 q3 0 4 3 q1 -3 4 -3 c7 0 9 10 -5 18 Z", "#ff6f9f") + ART.rooftopBee(68, 176, 1.6) +            // The bee and its heart.
        rect(32, 152, 76, 50, "none", 'rx="3" stroke="#ff8ecb" stroke-width="2.4" class="lp-neon"') +
        path("M40 150 h0.1 M52 150 h0.1 M64 150 h0.1 M76 150 h0.1 M88 150 h0.1 M100 150 h0.1", "none", 'stroke="#fff1cd" stroke-width="4" stroke-linecap="round" class="lp-twinkle"') + // Marquee bulbs.
        path("M44 232 Q40 222 44 214 Q48 208 44 202", "none", 'stroke="#3f8a66" stroke-width="2"') + path("M44 226 q-7 -3 -8 -9 q6 1 8 9 Z M44 216 q7 -3 8 -9 q-6 1 -8 9 Z M44 206 q-6 -2 -7 -7 q5 1 7 7 Z", "#8be9a8");
    },

    "shelf-rooftop-honey": function () { // A wooden honeycomb frame, two jars of honey (one with a dipper) and a bee checking on them, on a plank shelf.
      let cells = "";
      for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
        const cx = 305 + col * 7.4 + (row % 2) * 3.7, cy = 175 + row * 6.4;                                             // A small hexagon grid inside the frame.
        cells += "M" + round(cx) + " " + round(cy - 3.6) + " l3.1 1.8 v3.6 l-3.1 1.8 l-3.1 -1.8 v-3.6 Z ";
      }
      function jar(x, w, h, tilt) { // A honey jar with a cloth lid, a string and a heart label.
        return path("M" + (x - w / 2) + " 200 V" + (200 - h + 4) + " q0 -3 3 -3 H" + (x + w / 2 - 3) + " q3 0 3 3 V200 Z", "#ffb84a") +
          rect(x - w / 2 + 2, 202 - h, 3, h - 6, "#fff1cd", 'opacity=".45" rx="1.5"') +
          path("M" + (x - w / 2 - 2) + " " + (201 - h) + " q" + (w / 2 + 2) + " -7 " + (w + 4) + " 0 l-2 4 H" + (x - w / 2) + " Z", "#ff8ecb") + rect(x - w / 2, 203 - h, w, 1.6, "#d94f84") +
          path("M" + x + " " + (194 - h * .35) + " c-5 -3 -4 -7 -1.6 -7 q1.6 0 1.6 1.6 q0 -1.6 1.6 -1.6 c2.4 0 3.4 4 -1.6 7 Z", "#fff1e0");
      }
      return rect(298, 168, 30, 32, "none", 'stroke="#a8743f" stroke-width="3"') + rect(300, 170, 26, 28, "#c98a2a") + path(cells, "#ffdc83", 'stroke="#d9a02e" stroke-width=".8"') + // The honeycomb frame.
        line(345, 170, 352, 150, "#a8743f", 2.4) + path("M350 154 l6 -10 l4 3 l-6 9 Z", "#d9a75a") +                                   // The dipper in the big jar.
        jar(342, 22, 30) + jar(366, 16, 22) + ART.rooftopBee(320, 158, 1, true) + path("M326 160 q8 -6 14 2", "none", 'stroke="#fff" stroke-width="1" stroke-dasharray="2 3" opacity=".5"') +
        rect(294, 200, 88, 6, "#7a5a44", 'rx="2"') + rect(294, 205, 88, 1.5, "#8be9a8", 'opacity=".6"') +                               // A plank shelf with a mint edge.
        path("M304 206 l6 10 M372 206 l-6 10", "none", 'stroke="#5a4434" stroke-width="3" stroke-linecap="round"');
    },

    "view-rooftop-city": function () { // Looking out over the rooftop garden's hedge: water towers and billboards, and the neon city glowing below a pink dusk.
      function towers(seed, base, low, high, fill, lit, chance) { // Buildings across one tile as two shapes: the bodies, then their lit windows.
        const roll = dice(seed);
        let x = 0, bodies = "", lights = "";
        while (x < TILE) {
          const w = Math.min(Math.round(roll(14, 28)), TILE - x), h = Math.round(roll(low, high));                       // The last one stops exactly at the tile's edge.
          bodies += "M" + x + " " + (base - h) + " h" + w + " V140 H" + x + " Z ";
          for (let y = base - h + 5; y < base - 3; y += 7) for (let lx = x + 3; lx < x + w - 4; lx += 6) if (roll(0, 1) > chance) lights += "M" + lx + " " + y + " h2.5 v3 h-2.5Z ";
          x += w;
        }
        return path(bodies, fill) + path(lights, lit);
      }
      let hedge = "M0 116";
      for (let x = 0; x < TILE; x += 20) hedge += " a10 9 0 0 1 20 0";                                                     // Bushy hedge-tops that tile exactly.
      return view(["#6c8ed6", "#ffc6dc"], ["#0b0f26", "#3d1f4c"], 26,
        towers(921, 94, 30, 64, "#8a8fc8", "#ffd0ea", .72) + path("M150 40 V72 M168 40 V72", "none", 'stroke="#6a6fa8" stroke-width="2"') + rect(142, 26, 34, 16, "#ff8ecb", 'opacity=".85" class="lp-neon"') + // A far billboard glowing pink.
          path(star(159, 34, 5), "#fff1f8"),
        towers(922, 110, 14, 32, "#46507e", "#8be9a8", .62) +
          path("M34 110 L38 84 M54 110 L50 84 M36 96 H52", "none", 'stroke="#2a2f4a" stroke-width="2"') + rect(30, 68, 28, 18, "#7a5a44", 'rx="2"') + path("M28 68 L44 56 L60 68 Z", "#5a4434") + // A water tower.
          path("M30 74 H58 M30 80 H58", "none", 'stroke="#5a4434" stroke-width="1.2"'),
        path(hedge + " V140 H0 Z", "#3f8a66") + rect(0, 118, 240, 30, "#2a4a3a") + rect(0, 116, 240, 3, "#5fae86") +                  // The garden's hedge and ledge.
          path(scatter(923, 14, function (roll) { const x = round(roll(6, 234)), y = round(roll(106, 116)), r = 1.8; return "M" + (x - r) + " " + y + " a" + r + " " + r + " 0 1 0 " + r * 2 + " 0 a" + r + " " + r + " 0 1 0 -" + r * 2 + " 0Z "; }), "#ff8ecb") +
          path("M20 126 h14 M100 126 h14 M180 126 h14", "none", 'stroke="#ffdc83" stroke-width="2" stroke-linecap="round" class="lp-twinkle"'),
        falling("snow", scatter(924, 12, function (roll) { const x = round(roll(0, 120)), y = round(roll(0, 130)); return oval(x, y, 2.2, 1.3, "#ffc2de", 'opacity=".9" transform="rotate(' + Math.round(roll(0, 180)) + " " + x + " " + y + ')"'); })));
    },

    "frame-rooftop-greenhouse": function () { // A pitched greenhouse window in pale mint metal, with ivy climbing up and over it and a planter of herbs on the sill.
      const leaves = [[134, 214, -1], [132, 196, 1], [135, 178, -1], [139, 160, 1], [147, 144, -1], [160, 129, 1], [175, 117, -1], [189, 106, 1], [266, 210, 1], [268, 192, -1], [264, 174, 1]];
      return path(CLIPS["frame-rooftop-greenhouse"], "none", 'stroke="#cfeee0" stroke-width="7" stroke-linejoin="round"') +
        path(CLIPS["frame-rooftop-greenhouse"], "none", 'stroke="#5fae86" stroke-width="1.6" stroke-linejoin="round"') +
        path("M170 118 V226 M200 98 V226 M230 118 V226 M140 170 H260", "none", 'stroke="#cfeee0" stroke-width="3"') +                     // The glazing bars.
        circle(200, 96, 5, "#8be9a8") +
        path("M136 230 Q128 196 138 162 Q144 140 160 128 Q178 112 196 102 M264 230 Q272 200 264 170", "none", 'stroke="#3f8a66" stroke-width="2.6" stroke-linecap="round"') + // The ivy's stems.
        path(leaves.map(function (l) { return "M" + l[0] + " " + l[1] + " q" + l[2] * 7 + " -9 " + l[2] * 13 + " -3 q" + -l[2] + " 9 " + -l[2] * 13 + " 3 Z"; }).join(" "), "#8be9a8") +
        path("M142 170 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z M154 134 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z M182 110 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z M258 184 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0Z", "#ff8ecb") +
        path("M146 224 q2 -10 6 -14 M154 224 q0 -10 -2 -14 M240 224 q-1 -9 3 -13 M248 224 q1 -10 -2 -13 M196 224 q1 -8 4 -10 M204 224 q-1 -8 -4 -10", "none", 'stroke="#5fae86" stroke-width="2.4" stroke-linecap="round"') + // Herbs in the planter.
        circle(152, 210, 2.6, "#ffdc83") + circle(243, 211, 2.6, "#ff8ecb") +
        rect(132, 224, 136, 12, "#8a5a3a", 'rx="2"') + rect(132, 224, 136, 3, "#a8743f", 'rx="1.5"') + path("M166 230 h68", "none", 'stroke="#6b4426" stroke-width="1.4"');
    },

    "curtain-rooftop-awning": function () { // A pink and cream striped cafe awning with a scalloped edge, and festoon lights and ivy trailing down each side.
      let pinks = "", creams = "";
      for (let i = 0; i < 8; i++) { const x = 124 + i * 19, d = "M" + x + " 88 H" + (x + 19) + " V106 q-9.5 12 -19 0 Z "; if (i % 2) creams += d; else pinks += d; } // Alternate stripes, each with its scallop.
      function side(flip) { // Ivy and a string of lights down one side, mirrored for the other.
        const bulbs = [[132, 120], [140, 152], [138, 186], [146, 218]];
        return group(path("M128 106 Q140 150 130 190 Q126 214 134 236", "none", 'stroke="#3f8a66" stroke-width="2"') +
          path([[129, 124, 1], [134, 144, -1], [133, 166, 1], [128, 188, -1], [130, 210, 1], [134, 230, -1]].map(function (l) { return "M" + l[0] + " " + l[1] + " q" + l[2] * 6 + " -8 " + l[2] * 11 + " -2 q" + -l[2] + " 8 " + -l[2] * 11 + " 2 Z"; }).join(" "), "#8be9a8") +
          path("M126 106 Q146 124 132 120 Q150 140 140 152 Q130 170 138 186 Q150 204 146 218", "none", 'stroke="#2a3a4c" stroke-width="1.2"') +              // The light string.
          bulbs.map(function (b, i) { return rect(b[0] - 1.5, b[1] - 5, 3, 3, "#2a3a4c") + circle(b[0], b[1], 3.4, i % 2 ? "#ff8ecb" : "#ffdc83", 'class="lp-twinkle" style="animation-delay:' + (i * .4 + (flip ? .2 : 0)) + 's"'); }).join(""),
          flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      }
      return side(false) + side(true) + path(pinks, "#ff8ecb") + path(creams, "#fff1e0") +
        path("M124 106 q9.5 12 19 0 q9.5 12 19 0 q9.5 12 19 0 q9.5 12 19 0 q9.5 12 19 0 q9.5 12 19 0 q9.5 12 19 0 q9.5 12 19 0", "none", 'stroke="#d94f84" stroke-width="1.6"') + // The scalloped hem.
        rect(120, 82, 160, 7, "#3f8a66", 'rx="3"') + rect(120, 82, 160, 2, "#8be9a8", 'rx="1"') + circle(120, 85.5, 4.5, "#3f8a66") + circle(280, 85.5, 4.5, "#3f8a66");
    },

    "lamp-rooftop-neonbee": function () { // A neon bee sign on a pole, trailing a dotted heart, with ivy curling up the pole.
      const leaves = [[52, 390, -1], [60, 372, 1], [52, 354, -1], [60, 336, 1], [52, 318, -1], [60, 300, 1]];
      return oval(58, 244, 60, 46, "#ff8ecb", 'opacity=".1"') + oval(58, 244, 36, 28, "#ffdc83", 'opacity=".1"') +
        oval(56, 404, 22, 5, "#2a3a4c") + path("M40 404 Q44 394 56 392 Q68 394 72 404 Z", "#4a5a6a") + rect(53, 282, 6, 112, "#4a5a6a") + // The base and pole.
        path("M56 396 Q48 386 56 376 Q64 366 56 356 Q48 346 56 336 Q64 326 56 316 Q48 306 56 296", "none", 'stroke="#3f8a66" stroke-width="2"') + // Ivy winding up it.
        path(leaves.map(function (l) { return "M" + l[0] + " " + l[1] + " q" + l[2] * 6 + " -8 " + l[2] * 11 + " -2 q" + -l[2] + " 8 " + -l[2] * 11 + " 2 Z"; }).join(" "), "#8be9a8") +
        rect(14, 210, 92, 70, "#1d2a3a", 'rx="8" opacity=".7" stroke="#4a5a6a" stroke-width="2"') +                                       // The sign's backboard.
        oval(50, 228, 8, 11, "none", 'stroke="#8be9a8" stroke-width="2.6" transform="rotate(-24 50 228)" class="lp-neon"') + oval(64, 226, 7, 10, "none", 'stroke="#8be9a8" stroke-width="2.6" transform="rotate(20 64 226)" class="lp-neon"') + // Wings.
        oval(58, 250, 20, 13, "none", 'stroke="#ffdc83" stroke-width="3" class="lp-neon"') + path("M54 237.6 V262.4 M64 238 V262", "none", 'stroke="#ffdc83" stroke-width="3"') + // The body and stripes.
        circle(33, 246, 7, "none", 'stroke="#ffdc83" stroke-width="3" class="lp-neon"') + circle(31, 245, 1.6, "#ffdc83") +
        path("M30 239 q-3 -8 -8 -9 M35 239 q1 -8 -2 -11", "none", 'stroke="#ff8ecb" stroke-width="2.2" stroke-linecap="round"') +
        path("M80 252 Q92 258 94 248 Q96 238 90 236", "none", 'stroke="#ff8ecb" stroke-width="2.2" stroke-dasharray="3 4" stroke-linecap="round"') + // Its dotted flight trail...
        path("M91 234 c-8 -5 -7 -12 -2 -12 q2 0 3 2 q1 -2 3 -2 c5 0 6 7 -4 12 Z", "none", 'stroke="#ff8ecb" stroke-width="2.4" stroke-linejoin="round" class="lp-neon lp-twinkle"'); // ...ending in a heart.
    },

    "rug-rooftop-honeycomb": function () { // A honeycomb rug of nineteen hexagon cells, gold and mint around a pink heart cell, with a bee visiting.
      const R = 27, fills = { gold: "", light: "", mint: "", heart: "" };
      let edges = "";
      for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
        const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
        if (ring > 2) continue;
        const cx = 1.5 * R * q, cy = Math.sqrt(3) * R * (r + q / 2);                                                       // The cell's middle, flat-topped hexagons.
        let d = "";
        for (let k = 0; k < 6; k++) d += (k ? " L" : "M") + round(cx + R * Math.cos(k * Math.PI / 3)) + " " + round(cy + R * Math.sin(k * Math.PI / 3));
        d += "Z ";
        edges += d;
        fills[ring === 0 ? "heart" : ring === 1 ? "light" : (q + 2 * r + 9) % 3 === 0 ? "mint" : "gold"] += d;              // A mint cell every so often round the outside.
      }
      return oval(200, 444, 140, 32, "#000000", 'opacity=".18"') + group(
        path(edges, "none", 'stroke="#ff8ecb" stroke-width="14" stroke-linejoin="round" opacity=".35"') +                         // A soft pink border glow.
        path(fills.gold, "#ffb84a") + path(fills.light, "#ffdc83") + path(fills.mint, "#8be9a8") + path(fills.heart, "#ffe9f4") +
        path(edges, "none", 'stroke="#b8782a" stroke-width="5" stroke-linejoin="round"') +
        path("M0 16 C-24 0 -18 -18 -8 -18 Q0 -18 0 -8 Q0 -18 8 -18 C18 -18 24 0 0 16 Z", "#ff8ecb"), 'transform="translate(200 440) scale(1.15 .3)"') +
        ART.rooftopBee(268, 420, 1.3, true);
    },

    "bed-rooftop-planter": function () { // A raised wooden garden bed: a mossy mattress, a petal pillow, a big leaf for a blanket and flowers along the back.
      const flowers = [[300, 396, "#ff8ecb"], [312, 404, "#8be9a8"], [368, 400, "#ffdc83"], [380, 392, "#ff8ecb"]];
      return oval(340, 462, 56, 5, "#00000055") +
        path("M300 428 V398 M312 428 V406 M368 428 V402 M380 428 V394", "none", 'stroke="#3f8a66" stroke-width="2.4"') +            // Stems behind the bed.
        flowers.map(function (f) { return path("M" + (f[0] - 7) + " " + f[1] + " a3.5 3.5 0 1 1 7 -5 a3.5 3.5 0 1 1 7 5 a3.5 3.5 0 1 1 -4 7 a3.5 3.5 0 1 1 -6 0 a3.5 3.5 0 1 1 -4 -7 Z", f[2]) + circle(f[0], f[1], 2.4, "#fff1cd"); }).join("") + // Five-petal flowers.
        path("M296 432 Q296 418 310 418 H370 Q384 418 384 432 Z", "#5fae86") + path("M302 424 Q306 420 314 420 H366 Q376 420 378 424", "none", 'stroke="#8be9a8" stroke-width="3" stroke-linecap="round" opacity=".7"') + // The moss mattress.
        oval(314, 421, 14, 7, "#ffb3d6") + path("M304 420 q10 -4 20 0", "none", 'stroke="#ff8ecb" stroke-width="1.4"') +              // A petal pillow.
        path("M328 428 Q352 408 388 422 Q364 438 328 428 Z", "#8be9a8") + path("M330 428 Q356 420 386 422", "none", 'stroke="#3f8a66" stroke-width="1.6"') + // A big leaf blanket.
        rect(290, 430, 100, 26, "#8a5a3a", 'rx="2"') + path("M290 438.5 H390 M290 447 H390", "none", 'stroke="#6b4426" stroke-width="1.6"') + // The planks.
        rect(288, 426, 104, 5, "#a8743f", 'rx="2"') + rect(288, 426, 8, 34, "#a8743f", 'rx="2"') + rect(384, 426, 8, 34, "#a8743f", 'rx="2"') +
        path("M340 438 c-6 -4 -5 -9 -2 -9 q2 0 2 2 q0 -2 2 -2 c3 0 4 5 -2 9 Z", "#ffdc83") + ART.rooftopBee(352, 396, 1, true);
    },

    "door-rooftop-stairwell": function () { // The roof stairwell door: mint-painted steel with a warm wired-glass window, a push bar, a pink cage lamp and ivy over the top.
      const leaves = [[10, 196, -1], [-4, 192, 1], [-20, 194, -1], [-36, 192, 1], [-52, 196, -1], [-62, 212, 1], [-64, 232, -1], [-62, 252, 1], [-66, 272, -1]];
      return oval(-25, 196, 30, 22, "#ff8ecb", 'opacity=".14"') +
        rect(-66, 192, 82, 162, "#3a4a5a", 'rx="3"') + rect(-58, 202, 66, 152, "#4f8a70") + rect(-58, 202, 66, 3, "#6fae8f") +
        rect(-46, 214, 42, 32, "#ffdca0") + path("M-46 222 H-4 M-46 230 H-4 M-46 238 H-4 M-36 214 V246 M-25 214 V246 M-14 214 V246", "none", 'stroke="#c9a86a" stroke-width="1"') + // Warm wired glass.
        rect(-46, 214, 42, 32, "none", 'stroke="#2e5a48" stroke-width="3"') +
        rect(-54, 282, 58, 7, "#cfd8e0", 'rx="3.5"') + rect(-52, 280, 6, 11, "#8a9aab", 'rx="2"') + rect(-4, 280, 6, 11, "#8a9aab", 'rx="2"') + // The push bar.
        rect(-58, 326, 66, 26, "#3f6a58") + path("M-54 330 h0.1 M4 330 h0.1 M-54 348 h0.1 M4 348 h0.1", "none", 'stroke="#a8b4c4" stroke-width="3" stroke-linecap="round"') + // Kickplate and its rivets.
        ART.rooftopBee(-22, 308, 1.3) +                                                                                                   // A bee sticker.
        path("M-31 186 a6 6 0 0 1 12 0 Z", "#4a5a6a") + circle(-25, 189, 5, "#ff8ecb", 'class="lp-neon lp-twinkle"') + path("M-30 189 H-20 M-25 184 V194", "none", 'stroke="#4a5a6a" stroke-width="1.4"') + // A pink cage lamp.
        path("M16 204 Q6 190 -10 194 Q-30 188 -50 194 Q-64 200 -64 222 Q-62 250 -66 280", "none", 'stroke="#3f8a66" stroke-width="2.4" stroke-linecap="round"') + // Ivy over the top and down the side.
        path(leaves.map(function (l) { return "M" + l[0] + " " + l[1] + " q" + l[2] * 6 + " -8 " + l[2] * 11 + " -2 q" + -l[2] + " 8 " + -l[2] * 11 + " 2 Z"; }).join(" "), "#8be9a8") +
        path("M-14 192 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0Z M-46 194 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0Z M-68 242 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0Z", "#ff8ecb");
    },

    "hang-rooftop-hive": function () { // A straw beehive hung from a rope, dripping honey, with three bees on threads buzzing round it.
      const coils = [[38, 11], [46, 17], [55, 22], [65, 25], [75, 26], [84, 24]];
      return line(333, 0, 333, 34, "#c79256", 2) + path("M298 0 V50 M370 0 V72 M294 0 V96", "none", 'stroke="#8a7aa8" stroke-width="1"') + // The rope, and the bees' threads.
        oval(333, 66, 40, 40, "#ffb84a", 'opacity=".1"') +
        coils.map(function (c) { return oval(333, c[0], c[1], 6, "#d9a75a", 'stroke="#a8743f" stroke-width="1.2"'); }).join("") +      // The coils of straw, top to bottom.
        oval(333, 90, 26, 5, "#8a5a2a") + path("M327 88 a6 6 0 0 1 12 0 Z", "#3a2a1a") +                                                 // The board and the doorway.
        path("M343 92 h10 q-2 3 -2 8 q0 6 -3 6 q-3 0 -3 -6 q0 -5 -2 -8 Z", "#ffb84a", 'class="lp-twinkle"') +                          // A drip of honey running off the board.
        oval(326, 30, 6, 3, "#8be9a8", 'transform="rotate(-30 326 30)"') + oval(340, 30, 6, 3, "#5fae86", 'transform="rotate(30 340 30)"') + circle(333, 31, 2.6, "#ff8ecb") + // A sprig where the rope is tied.
        path("M304 54 q8 6 10 -2 M362 78 q-8 8 -12 0 M300 100 q8 4 12 -4", "none", 'stroke="#fff" stroke-width="1" stroke-dasharray="2 3" opacity=".55"') +
        ART.rooftopBee(298, 56, 1.3, true) + ART.rooftopBee(370, 78, 1.2) + ART.rooftopBee(294, 102, 1.1, true);
    },

    "table-rooftop-vent": function () { // A rooftop air-con unit used as a table, ivy trailing off it, with a city snow globe and a potted flower on top.
      return rect(304, 318, 64, 44, "#8a9aab", 'rx="3"') + rect(302, 315, 68, 5, "#a8b4c4", 'rx="2"') +
        circle(326, 340, 15, "#5a6a7a") + path("M311 340 H341 M326 325 V355 M315.4 329.4 L336.6 350.6 M336.6 329.4 L315.4 350.6", "none", 'stroke="#a8b4c4" stroke-width="1.6"') + circle(326, 340, 4, "#cfd8e0") + // The fan grille.
        path("M348 326 H362 M348 331 H362 M348 336 H362 M348 341 H362 M348 346 H362 M348 351 H362", "none", 'stroke="#5a6a7a" stroke-width="2"') + // Louvres.
        rect(308, 362, 8, 3, "#4a5a6a") + rect(356, 362, 8, 3, "#4a5a6a") +
        path("M366 318 Q372 330 366 344 Q362 352 368 360", "none", 'stroke="#3f8a66" stroke-width="2"') + path("M367 326 q6 -2 8 4 q-6 1 -8 -4 Z M366 340 q-6 -2 -8 4 q6 1 8 -4 Z M367 354 q6 -2 8 4 q-6 1 -8 -4 Z", "#8be9a8") + // Ivy over the edge.
        path("M310 316 h14 l-2 -10 h-10 Z", "#c0764f") + path("M317 306 V292", "none", 'stroke="#3f8a66" stroke-width="2"') + path("M317 300 q-7 -2 -8 -8 q6 1 8 8 Z", "#8be9a8") + // The flower pot...
        circle(317, 289, 5, "#ff8ecb") + circle(317, 289, 1.8, "#ffdc83") +                                                                 // ...and its flower.
        rect(337, 307, 22, 9, "#8a5a2a", 'rx="2"') + circle(348, 296, 13, "#2a3a60") +                                                         // The snow globe's base and its night sky.
        path("M337 304 V296 h5 v-6 h5 v10 h4 v-8 h5 v12 Z", "#46507e") + path("M339 299 h1.5 v1.5 h-1.5Z M349 295 h1.5 v1.5 h-1.5Z M354 301 h1.5 v1.5 h-1.5Z", "#ff8ecb") + // A tiny city inside.
        path("M342 287 h.1 M352 284 h.1 M356 292 h.1 M346 292 h.1 M338 292 h.1", "none", 'stroke="#fff" stroke-width="1.8" stroke-linecap="round" class="lp-twinkle"') + // Snow.
        circle(348, 296, 13, "#bfe8ff", 'opacity=".22" stroke="#e6f6ff" stroke-width="1.5"') + path("M340 290 q2 -5 7 -6", "none", 'stroke="#fff" stroke-width="1.6" opacity=".6" stroke-linecap="round"');
    },

    "plant-rooftop-antenna": function () { // An old TV antenna stuck in a vent pipe, used as a trellis by a morning glory with pink and mint trumpet flowers.
      const blooms = [[2, 300, "#ff8ecb"], [34, 300, "#8be9a8"], [6, 316, "#8be9a8"], [30, 330, "#ff8ecb"], [10, 344, "#ff8ecb"], [20, 286, "#ff8ecb"]];
      return line(18, 364, 18, 284, "#a8b4c4", 2.4) + path("M2 300 H34 M6 314 H30 M9 328 H27", "none", 'stroke="#a8b4c4" stroke-width="2" stroke-linecap="round"') + // The antenna.
        path("M18 362 Q8 352 18 342 Q28 332 18 322 Q8 312 18 302 Q26 294 20 286", "none", 'stroke="#3f8a66" stroke-width="2" stroke-linecap="round"') + // The vine winding up.
        path("M12 352 q-8 -3 -9 -10 q7 1 9 10 Z M24 334 q8 -3 9 -10 q-7 1 -9 10 Z M12 314 q-8 -3 -9 -10 q7 1 9 10 Z M24 296 q8 -3 9 -10 q-7 1 -9 10 Z", "#5fae86") +
        blooms.map(function (b) { return circle(b[0], b[1], 5.4, b[2]) + circle(b[0], b[1], 2, "#fff8f0"); }).join("") +               // Trumpet flowers.
        ART.rooftopBee(-6, 284, 1, true) +
        rect(4, 362, 28, 30, "#8a9aab", 'rx="2"') + rect(2, 360, 32, 6, "#a8b4c4", 'rx="2"') + rect(4, 378, 28, 3, "#6a7a8a") + oval(18, 363, 12, 2.4, "#3a2a1a"); // The vent-pipe pot.
    },

    "chest-rooftop-crate": function () { // A wooden seed crate full of toys: a kite with a bow-tied tail, a mint ball and a plush bee.
      return oval(92, 478, 44, 4, "#00000055") +
        path("M72 388 L88 410 L72 434 L56 410 Z", "#ff8ecb") + path("M72 388 L88 410 L72 410 Z M72 410 L56 410 L72 434 Z", "#8be9a8") + path("M72 388 V434 M56 410 H88", "none", 'stroke="#fff1e0" stroke-width="1.4"') + // The kite.
        circle(94, 430, 8, "#8be9a8") + path("M86 428 q8 4 16 0", "none", 'stroke="#fff" stroke-width="2"') +                         // The ball.
        group(oval(0, 0, 11, 9, "#ffdc83") + path("M-3 -8.6 V8.6 M3 -8.2 V8.2", "none", 'stroke="#2a1a3a" stroke-width="2.4"') + oval(-2, -10, 5, 4, "#eef8ff") + oval(5, -9, 4.5, 3.4, "#eef8ff") +
          circle(-6, -1, 1.3, "#2a1a3a") + oval(-7, 3, 2, 1.2, "#ff8ecb"), 'transform="translate(112 428)"') +                       // The plush bee.
        rect(56, 430, 72, 6, "#6b4426") + [438, 451, 464].map(function (y) { return rect(54, y, 76, 10, "#c79256", 'rx="1"'); }).join("") + // The slats.
        rect(54, 434, 8, 42, "#a8743f", 'rx="1"') + rect(122, 434, 8, 42, "#a8743f", 'rx="1"') + oval(92, 443, 8, 2.4, "#6b4426") + // Corner posts and a hand-hole.
        path("M92 456 l3 1.8 v3.6 l-3 1.8 l-3 -1.8 v-3.6 Z M98.5 456 l3 1.8 v3.6 l-3 1.8 l-3 -1.8 v-3.6 Z M85.5 456 l3 1.8 v3.6 l-3 1.8 l-3 -1.8 v-3.6 Z", "#8a5a2a") + // A honeycomb stamp.
        path("M72 432 Q86 450 100 444 Q116 438 124 456", "none", 'stroke="#fff1e0" stroke-width="1.4"') +                               // The kite's tail draped over the front...
        path("M86 446 l-4 -4 v8 Z M86 446 l4 -4 v8 Z M110 442 l-4 -4 v8 Z M110 442 l4 -4 v8 Z", "#ff8ecb") + path("M122 452 l-4 -3 v7 Z M122 452 l4 -3 v7 Z", "#8be9a8"); // ...with bows.
    },
  };

  // ---- Lumi's own old things (python/make_lumi_worn.py): the worn set she unpacks from her moving boxes when she
  // has just moved in, one a day. Each stands where its spot's other pieces stand. Well loved, a bit tatty, cosy.
  Object.assign(ART, {
    "wall-worn": function () { // Old paper, faded to dusty mauve, peeling in strips with the plaster showing through.
      const strips = [[34, 0, 22, 120], [118, 40, 18, 90], [286, 10, 24, 150], [356, 60, 20, 70]];
      return rect(0, 0, 400, 352, "#3a2d3e") + scatter(17, 40, function (roll) { return circle(round(roll(0, 400)), round(roll(0, 350)), round(roll(3, 7)), "#463650", 'opacity=".7"'); }) + // A faded flower print.
        strips.map(function (s) { return rect(s[0], s[1], s[2], s[3], "#5b5260") + path("M" + s[0] + " " + (s[1] + s[3]) + " q" + s[2] / 2 + " 10 " + s[2] + " 0 v-6 q-" + s[2] / 2 + " 8 -" + s[2] + " 0 Z", "#4d3d52"); }).join("") + // Torn strips, curling at the bottom.
        oval(220, 70, 30, 18, "#2e2333", 'opacity=".6"');                                                        // An old water stain.
    },
    "floor-worn": function () { // Scuffed boards: one a different colour, a gap, scratches where furniture used to be.
      let out = rect(0, 350, 400, 150, "#2b2019") + rect(0, 350, 400, 3, "#5a4434");
      for (let y = 374; y < 500; y += 24) out += line(0, y, 400, y, "#1d1510", 2);
      return out + rect(120, 422, 160, 22, "#3a2a1f") + path("M40 392 l60 6 M250 460 l70 -4 M300 408 l50 3", "none", 'stroke="#4a382b" stroke-width="1.6" stroke-linecap="round"') +
        rect(0, 446, 400, 3, "#120c08", 'opacity=".8"');                                                          // A gap between two boards.
    },
    "art-worn": function () { // A postcard from her old town, held up with criss-crossed tape.
      return group(rect(46, 168, 52, 36, "#e8dcc6") + rect(50, 172, 44, 20, "#7aa7c9") + path("M50 192 l12 -10 l10 6 l10 -12 l12 16 Z", "#5f8f6a") + circle(84, 179, 4, "#ffdc83") +
        line(52, 198, 84, 198, "#a8977f", 1.2) + rect(40, 164, 16, 6, "#f1e7a8", 'opacity=".75" transform="rotate(-30 48 167)"') + rect(88, 200, 16, 6, "#f1e7a8", 'opacity=".75" transform="rotate(-30 96 203)"'),
        'transform="rotate(-4 72 186)"');
    },
    "shelf-worn": function () { // A plank on two piles of bricks, a jar of pens and a chipped mug.
      return rect(300, 168, 18, 32, "#9b4a3a") + path("M300 176 H318 M300 184 H318 M300 192 H318 M309 168 V176 M304 176 V184 M313 184 V192 M308 192 V200", "none", 'stroke="#6e3226" stroke-width="1"') +
        rect(356, 168, 18, 32, "#9b4a3a") + path("M356 176 H374 M356 184 H374 M356 192 H374 M365 168 V176 M360 176 V184 M369 184 V192 M364 192 V200", "none", 'stroke="#6e3226" stroke-width="1"') +
        rect(292, 160, 90, 8, "#b08a5a", 'rx="1"') + path("M300 160 v8 M330 160 v8", "none", 'stroke="#8a6a42" stroke-width="1"') +
        rect(306, 140, 14, 20, "#c9e6e6", 'opacity=".6"') + path("M309 140 l-3 -10 M313 140 l1 -12 M317 140 l4 -9", "none", 'stroke="#ff8ecb" stroke-width="2" stroke-linecap="round"') +
        path("M346 144 h16 v14 q0 2 -2 2 h-12 q-2 0 -2 -2 Z", "#e8dcc6") + path("M362 147 q6 0 5 5 q-1 4 -5 3", "none", 'stroke="#e8dcc6" stroke-width="2"') + path("M346 144 l4 4 l3 -4 Z", "#3a2d3e");
    },
    "frame-worn": function () { // A plain wooden frame, chipped at the corners, with a crack in one pane.
      return path(CLIPS["frame-worn"], "none", 'stroke="#8a6a4a" stroke-width="7" stroke-linejoin="miter"') + line(200, 102, 200, 224, "#8a6a4a", 4) + line(144, 163, 256, 163, "#8a6a4a", 4) +
        path("M142 100 l8 0 l-3 5 Z M258 226 l-9 0 l4 -6 Z", "#3a2d3e") + path("M214 112 l8 14 l-5 6 l9 18", "none", 'stroke="#e6f6ff" stroke-width="1" opacity=".55"') + rect(134, 224, 132, 7, "#7a5a3c", 'rx="1"');
    },
    "curtain-worn": function () { // An old bedsheet pinned over the window with clothes pegs, knotted to one side.
      return line(124, 90, 276, 90, "#d8d0c4", 1.5) + path("M126 90 H274 V120 Q232 112 210 128 Q186 146 168 236 H150 Q160 150 126 132 Z", "#d9d4e8", 'opacity=".9"') +
        path("M150 100 Q156 160 156 236 M190 96 Q186 120 180 140", "none", 'stroke="#b8b2c8" stroke-width="2"') + circle(170, 150, 9, "#c4bed6") + // The knot.
        [138, 180, 222, 262].map(function (x) { return rect(x, 84, 5, 12, "#c79256", 'rx="1"'); }).join("") +                  // The clothes pegs.
        scatter(8, 10, function (roll) { return circle(round(roll(132, 268)), round(roll(96, 118)), 2, "#a8c8e8", 'opacity=".7"'); });   // Little blue dots on the sheet.
    },
    "lamp-worn": function () { // A bare bulb on a tall thin stand, its flex trailing across the floor.
      return oval(52, 250, 54, 54, "#fff3c0", 'opacity=".12"') + rect(51, 262, 3, 138, "#6f6a78") + path("M38 400 h30 l-4 -6 h-22 Z", "#6f6a78") +
        rect(48, 256, 9, 8, "#8a8696") + circle(52, 248, 10, "#fff6d0", 'opacity=".95"') + path("M48 248 q4 -6 8 0", "none", 'stroke="#d8a840" stroke-width="1.2"') +
        path("M53 398 Q90 420 130 410 T200 414", "none", 'stroke="#3a3440" stroke-width="2"');
    },
    "rug-worn": function () { // A rag rug from a thrift shop: rings of old T-shirts, a bit frayed at the edge.
      const rings = ["#8a5a7a", "#5a7a8a", "#a8804a", "#6a8a5a", "#8a5a7a", "#c9a8a0"];
      return rings.map(function (colour, i) { return oval(200, 440, 122 - i * 18, 28 - i * 4.2, colour); }).join("") +
        scatter(13, 22, function (roll) { const a = roll(0, Math.PI * 2); return line(round(200 + 120 * Math.cos(a)), round(440 + 27 * Math.sin(a)), round(200 + 128 * Math.cos(a)), round(440 + 30 * Math.sin(a)), "#8a5a7a", 1.4); });
    },
    "bed-worn": function () { // A mattress straight on the floor, blue ticking, a squashed pillow and a crocheted blanket.
      return rect(286, 424, 108, 26, "#c4cfe0", 'rx="5"') + [298, 314, 330, 346, 362, 378].map(function (x) { return line(x, 426, x, 448, "#8aa0c4", 1.5); }).join("") +
        oval(306, 424, 20, 8, "#f0ece4") + path("M330 420 Q360 414 394 424 V450 H330 Q324 436 330 420 Z", "#c96a8a", 'opacity=".92"') +
        scatter(23, 12, function (roll) { return circle(round(roll(338, 388)), round(roll(426, 446)), 2.4, "#ffdc83", 'opacity=".8"'); }) + rect(286, 448, 108, 4, "#00000044", 'rx="2"');
    },
    "door-worn": function () { // A creaky old door: paint flaking off, a mismatched knob, a draught excluder.
      return rect(-62, 196, 74, 158, "#4a3d36", 'rx="2"') + rect(-56, 202, 62, 152, "#6e6058") +
        scatter(29, 14, function (roll) { return rect(round(roll(-54, 0)), round(roll(206, 346)), round(roll(4, 12)), round(roll(3, 7)), "#8a7a6e", 'rx="1"'); }) + // Flaking paint.
        rect(-50, 214, 50, 50, "none", 'stroke="#5a4c44" stroke-width="2"') + circle(-4, 280, 5, "#9aa4b0") + circle(-4, 280, 2, "#5a646e") +
        rect(-58, 342, 66, 10, "#7a5a8c", 'rx="5"') + path("M-50 347 h50", "none", 'stroke="#ffdc83" stroke-width="1.2" stroke-dasharray="4 3"');
    },
    "hang-worn": function () { // A paper lantern on a string, with a tear patched with tape.
      return line(330, 0, 330, 44, "#8a7aa8", 1.2) + oval(330, 68, 22, 24, "#f3e3c8", 'opacity=".95"') + path("M310 60 Q330 64 350 60 M309 70 Q330 74 351 70 M310 80 Q330 84 350 80", "none", 'stroke="#d8c4a4" stroke-width="1.2"') +
        rect(326, 44, 8, 4, "#5a4a3a") + rect(326, 90, 8, 3, "#5a4a3a") + path("M340 58 l6 8 l-4 6", "none", 'stroke="#3a2d3e" stroke-width="1.6"') + rect(337, 60, 12, 6, "#f1e7a8", 'opacity=".7" transform="rotate(30 343 63)"');
    },
    "table-worn": function () { // A moving box doing a table's job, its flaps folded in, a mug and a book on top.
      return rect(310, 322, 54, 40, "#c8a070") + rect(310, 322, 54, 6, "#b08858") + line(337, 322, 337, 362, "#a07848", 1.2) + rect(330, 328, 14, 22, "#f1e7a8", 'opacity=".7"') +
        path("M318 346 l10 -6 M320 352 l10 -6", "none", 'stroke="#8a6040" stroke-width="1.2"') + rect(342, 310, 14, 12, "#70ebea", 'rx="2"') + path("M356 313 q5 0 4 4 q-1 3 -4 2", "none", 'stroke="#70ebea" stroke-width="2"') +
        rect(314, 314, 24, 8, "#c85a8e", 'rx="1"');
    },
    "plant-worn": function () { // An avocado pit on toothpicks in a jam jar of water, sending up one brave shoot.
      return path("M6 370 H30 V392 Q30 396 26 396 H10 Q6 396 6 392 Z", "#c9e6e6", 'opacity=".55"') + rect(6, 380, 24, 16, "#8ac6d8", 'opacity=".35"') + rect(5, 366, 26, 5, "#d8b24a", 'rx="1"') +
        oval(18, 370, 8, 10, "#6b4426") + path("M4 372 L32 368 M6 366 L30 374", "none", 'stroke="#e8d8a8" stroke-width="1.4"') +
        path("M18 360 Q16 336 20 318", "none", 'stroke="#5fae86" stroke-width="2.4" stroke-linecap="round"') + path("M20 326 q12 -8 14 2 q-8 4 -14 -2 Z M19 336 q-12 -6 -14 4 q8 2 14 -4 Z", "#7fc49a");
    },
    "chest-worn": function () { // A plastic laundry basket for a toy box, with a ball, a plush and a yo-yo poking out.
      return circle(76, 432, 10, "#ff8ecb") + path("M68 428 q8 5 16 0", "none", 'stroke="#fff" stroke-width="2"') + oval(104, 430, 12, 10, "#c9a8ff") + circle(100, 427, 1.4, "#2a1a3a") + circle(108, 427, 1.4, "#2a1a3a") +
        path("M96 422 l-4 -8 l6 4 Z M112 422 l4 -8 l-6 4 Z", "#c9a8ff") + circle(90, 436, 6, "#ffdc83") +
        path("M56 440 H128 L122 476 H62 Z", "#70b8d8") + [70, 84, 98, 112].map(function (x) { return rect(x, 448, 6, 20, "#4a8aa8", 'rx="2"'); }).join("") + rect(54, 438, 76, 5, "#5aa0c0", 'rx="2"');
    },
    // A spot that hasn't been unpacked yet: bare plaster and bare concrete (render() draws these when a spot is empty).
    "wall-bare": function () {
      return rect(0, 0, 400, 352, "#4a4450") + scatter(41, 30, function (roll) { return oval(round(roll(0, 400)), round(roll(0, 350)), round(roll(10, 30)), round(roll(4, 10)), "#524c58", 'opacity=".6"'); }) +
        path("M60 40 l14 10 M300 90 l-10 14 M180 260 l20 6", "none", 'stroke="#3a3440" stroke-width="1"') + rect(0, 340, 400, 12, "#3e3844");    // A crack or two, and a skirting board.
    },
    "floor-bare": function () {
      return rect(0, 350, 400, 150, "#34303a") + scatter(43, 60, function (roll) { return circle(round(roll(0, 400)), round(roll(356, 498)), round(roll(0.6, 1.8)), "#403b46"); }) + rect(0, 350, 400, 3, "#55505c");
    },
    "door-bare": function () { // The flat's own door, before her worn one is unpacked: plain primed wood, a builder's sticker, a brass knob. Her way out to Lumi Dungeons.
      return rect(-62, 196, 74, 158, "#5c5560", 'rx="2"') + rect(-56, 202, 62, 152, "#8a8290") + rect(-50, 214, 50, 54, "none", 'stroke="#7a7280" stroke-width="2"') +
        rect(-50, 280, 50, 62, "none", 'stroke="#7a7280" stroke-width="2"') + circle(-4, 278, 4.5, "#d8b24a") + rect(-44, 226, 22, 12, "#e8e4d8", 'opacity=".8" transform="rotate(-6 -33 232)"');
    },
    // Moving boxes, stacked at the front of the room: as many as are left to unpack (up to four drawn).
    boxes: function (left) {
      const spots = [[318, 452, 46, 40], [360, 458, 40, 34], [326, 418, 38, 34], [362, 428, 32, 30]];
      return spots.slice(0, Math.min(left, spots.length)).map(function (b, i) {
        return rect(b[0], b[1], b[2], b[3], i % 2 ? "#b8905e" : "#c8a070", 'rx="1"') + rect(b[0], b[1], b[2], 5, "#a07848") + rect(b[0] + b[2] / 2 - 4, b[1], 8, b[3], "#f1e7a8", 'opacity=".55"') +
          path("M" + (b[0] + 6) + " " + (b[1] + b[3] - 10) + " h12 M" + (b[0] + 6) + " " + (b[1] + b[3] - 6) + " h8", "none", 'stroke="#5a3a2a" stroke-width="1.4"'); // "FRAGILE", scribbled.
      }).join("");
    },
  });

  // ---- Lumi-Soft prizes (the "prize": "lumi-soft" entries in the catalog): won by playing Lumi-Soft, Lumi's candy-coloured
  // toy target gallery (mnemerynne/lumisoft.py), never sold, rolled from a capsule or found. One piece for every spot, made
  // as a set: pastel bullseyes, range bunting, stars and confetti, cardboard creature standees, stardust BBs, and her
  // Sparkle Popper (a rounded candy toy with a star on the end) where a piece calls for it. Everything here is a toy.
  // Palette: pink #ff8ecb, blush #ffc6e4, lilac #c9a8ff, plum wall #35285a, mint #8be9a8, sea-mint #5fd6b0, gold #ffdc83, cream #fff8ec.
  const SOFT = { pink: "#ff8ecb", blush: "#ffc6e4", lilac: "#c9a8ff", plum: "#35285a", mint: "#8be9a8", sea: "#5fd6b0", gold: "#ffdc83", amber: "#e8b94a", cream: "#fff8ec", ink: "#3a2147", card: "#f2d6ae", cardEdge: "#c99a6a" };
  CLIPS["soft-frame"] = "M150 104 H250 V202 H150 Z"; // The photo's picture area: the view shows through it.
  Object.assign(ART, {
    softTarget: function (x, y, r, flat) { // A pastel bullseye: pink, cream, mint, cream and a gold middle with a sparkle. `flat` squashes it to lie on the floor.
      const rings = [SOFT.pink, SOFT.cream, SOFT.mint, SOFT.cream, SOFT.gold];
      return group(rings.map(function (fill, i) { return circle(0, 0, round(r * (1 - i * .2)), fill); }).join("") + path(star(0, 0, round(r * .17)), "#fff"),
        'transform="translate(' + x + " " + y + ")" + (flat ? " scale(1 " + flat + ")" : "") + '"');
    },
    softFlags: function (x1, y1, x2, y2, sag, count, size, turn) { // Range bunting: a string from one point to another, dipping by `sag`, with `count` triangle flags in turn pink, mint, gold and lilac.
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + sag * 2;                                                  // The curve's control point, so its middle dips by `sag`.
      const at = function (t) { return [round((1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2), round((1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2)]; };
      const colours = [SOFT.pink, SOFT.mint, SOFT.gold, SOFT.lilac], flags = ["", "", "", ""];
      for (let i = 0; i < count; i++) {
        const t = (i + .5) / count, a = at(t - .36 / count), b = at(t + .36 / count), m = at(t);               // Each flag hangs from two points on the string, its tip below the middle.
        flags[(i + (turn || 0)) % 4] += "M" + a[0] + " " + a[1] + " L" + b[0] + " " + b[1] + " L" + m[0] + " " + round(m[1] + size) + " Z ";
      }
      return path("M" + x1 + " " + y1 + " Q" + cx + " " + cy + " " + x2 + " " + y2, "none", 'stroke="' + SOFT.cream + '" stroke-width="1.4" opacity=".85"') +
        flags.map(function (d, i) { return d ? path(d, colours[i]) : ""; }).join("");
    },
    softStandee: function (x, y, s, kind, tilt) { // A cardboard creature cut-out on a little foot (cat, bunny or slime), with a bullseye on its tummy. (x, y) is where it stands.
      const shapes = { // Each creature's cardboard outline as one path, around its feet at 0 0.
        cat: "M-12 0 V-18 Q-12 -23 -7 -23 H7 Q12 -23 12 -18 V0 Z M-11 -31 a11 10 0 1 0 22 0 a11 10 0 1 0 -22 0 Z M-11 -35 L-9 -47 L-2 -40 Z M11 -35 L9 -47 L2 -40 Z",
        bunny: "M-11 0 Q-13 -20 0 -22 Q13 -20 11 0 Z M-10 -31 a10 9 0 1 0 20 0 a10 9 0 1 0 -20 0 Z M-7 -38 Q-11 -56 -5 -57 Q-1 -56 -2 -38 Z M7 -38 Q11 -56 5 -57 Q1 -56 2 -38 Z",
        slime: "M-15 0 Q-17 -14 -10 -24 Q-4 -32 0 -33 Q-3 -40 3 -42 Q2 -37 5 -33 Q12 -30 15 -18 Q17 -8 15 0 Z",
      };
      const face = kind === "slime" ? -19 : -31;                                                                // Where its eyes go: slimes are all face.
      return group(path(shapes[kind], SOFT.cardEdge, 'stroke="' + SOFT.cardEdge + '" stroke-width="3" stroke-linejoin="round"') + path(shapes[kind], SOFT.card) + // A darker cut edge, then the card.
        (kind === "bunny" ? path("M-6 -40 Q-8 -52 -5 -53 Q-3 -50 -3.5 -40 Z M6 -40 Q8 -52 5 -53 Q3 -50 3.5 -40 Z", SOFT.blush) : "") +            // Pink insides of a bunny's ears.
        circle(-4, face, 1.5, SOFT.ink) + circle(4, face, 1.5, SOFT.ink) + oval(-7.5, face + 3.5, 2.4, 1.3, SOFT.pink, 'opacity=".8"') + oval(7.5, face + 3.5, 2.4, 1.3, SOFT.pink, 'opacity=".8"') +
        path("M-1.6 " + (face + 3) + " q1.6 1.6 3.2 0", "none", 'stroke="' + SOFT.ink + '" stroke-width=".9" stroke-linecap="round"') +              // A little smile.
        ART.softTarget(0, kind === "slime" ? -8 : -10, 5.5) + path("M-9 0 L0 5 L9 0 Z", SOFT.cardEdge),                                         // Its tummy bullseye and its folded foot.
        'transform="translate(' + x + " " + y + ") rotate(" + (tilt || 0) + ") scale(" + s + ')"');
    },
    softPopper: function (x, y, s, tilt) { // Lumi's Sparkle Popper, facing right: a chubby lilac candy toy with a bubble of stardust BBs on top, a heart grip and a big sparkle on the end.
      return group(path("M-9 3 Q-14 15 -7 18 Q-1 20 1 13 L3 3 Z", SOFT.pink) +                                                                 // The heart-shaped grip.
        circle(-3, -9, 6.5, "#e6f6ff", 'opacity=".55" stroke="#fff" stroke-width="1"') + circle(-5, -9, 1.6, SOFT.pink) + circle(-1.5, -11, 1.6, SOFT.mint) + circle(-2.5, -6.5, 1.6, SOFT.gold) + // The BB bubble.
        rect(-17, -6, 30, 12, SOFT.lilac, 'rx="6"') + rect(-9, -6, 4, 12, SOFT.mint) + rect(-17, -6, 30, 3.5, "#fff", 'rx="1.75" opacity=".35"') + // The chubby body, a mint band and a shine.
        rect(11, -3.5, 10, 7, SOFT.pink, 'rx="3.5"') + path(star(24, 0, 7.5), SOFT.gold) + circle(24, 0, 1.6, "#fff") +                       // The rounded nozzle and its sparkle.
        path("M2 -1 c-3 -2 -2.6 -4.6 -.8 -4.6 q.8 0 .8 1 q0 -1 .8 -1 c1.8 0 2.2 2.6 -.8 4.6 Z", "#fff1f8"),                                 // A heart sticker on the side.
        'transform="translate(' + x + " " + y + ") rotate(" + (tilt || 0) + ") scale(" + s + ')"');
    },

    "soft-wallpaper": function () { // Plum lilac stripes with rows of soft bullseyes, confetti, range bunting swagged along the top and a mint rail over panelling.
      let stripes = "", targets = "";
      for (let x = 0; x < 400; x += 50) stripes += "M" + x + " 0 h25 V300 h-25 Z ";                                    // Even stripes: 50 goes into the tile exactly.
      [[150, [50, 150, 250, 350]], [226, [0, 100, 200, 300, 400]]].forEach(function (row) {                           // Two staggered rows; those on the edges are cut exactly in half.
        row[1].forEach(function (x) { targets += ART.softTarget(x, row[0], 15); });
      });
      const confetti = scatter(1601, 46, function (roll, i) { // Little paper squares and dots, tumbling in every colour of the set.
        const x = round(roll(8, 392)), y = round(roll(70, 290)), colour = [SOFT.pink, SOFT.mint, SOFT.gold, SOFT.lilac][i % 4];
        return i % 3 ? rect(x, y, 4, 2.4, colour, 'opacity=".55" transform="rotate(' + Math.round(roll(0, 180)) + " " + x + " " + y + ')"') : circle(x, y, 1.6, colour, 'opacity=".6"');
      });
      return rect(0, 0, 400, 352, SOFT.plum) + path(stripes, "#3d2f66") + group(targets, 'opacity=".42"') + confetti +
        scatter(1602, 10, function (roll) { return path(star(round(roll(14, 386)), round(roll(80, 280)), round(roll(3, 6))), SOFT.gold, 'opacity=".7"'); }) + // A few gold sparkles.
        [0, 100, 200, 300].map(function (x, i) { return ART.softFlags(x, 14, x + 100, 14, 12, 6, 14, i); }).join("") +                          // Bunting, one swag every 100, so it tiles.
        [0, 100, 200, 300].map(function (x) { return circle(x, 14, 2.6, SOFT.cream); }).join("") + rect(400 - 2.6, 11.4, 2.6, 5.2, SOFT.cream) + // The pins it hangs from.
        rect(0, 300, 400, 52, "#2b2150") + path("M25 308 h50 v36 h-50 Z M125 308 h50 v36 h-50 Z M225 308 h50 v36 h-50 Z M325 308 h50 v36 h-50 Z", "none", 'stroke="#4a3a7a" stroke-width="2"') + // Panelling.
        rect(0, 296, 400, 6, SOFT.sea) + rect(0, 296, 400, 2, SOFT.mint) + [50, 150, 250, 350].map(function (x) { return path(star(x, 299, 4), SOFT.gold); }).join(""); // The mint rail, with gold stars.
    },

    "soft-floor": function () { // Painted range lanes in two lilacs with pink dashed dividers, a mint toe line, star lane markers and stray confetti.
      let lanes = "";
      for (let x = 50; x < 400; x += 200) lanes += "M" + x + " 350 h100 V500 h-100 Z ";                                    // Every other lane a shade lighter.
      return rect(0, 350, 400, 150, "#30264f") + path(lanes, "#3a2f60") +
        path("M50 372 V500 M150 372 V500 M250 372 V500 M350 372 V500", "none", 'stroke="' + SOFT.pink + '" stroke-width="3" stroke-dasharray="12 9" opacity=".75"') + // Lane dividers.
        rect(0, 362, 400, 6, SOFT.mint, 'opacity=".85"') + rect(0, 368, 400, 2, SOFT.sea) +                                                     // The toe line.
        [0, 100, 200, 300, 400].map(function (x) { return path(star(x, 384, 5), SOFT.gold, 'opacity=".9"'); }).join("") +                       // A gold star in front of each lane.
        [100, 300].map(function (x) { return ART.softTarget(x, 470, 16, .35); }).join("") +                                                     // Bullseye decals far down the lanes.
        scatter(1603, 30, function (roll, i) { const x = round(roll(6, 394)), y = round(roll(392, 494)); return rect(x, y, 4, 2.4, [SOFT.pink, SOFT.mint, SOFT.gold, SOFT.lilac][i % 4], 'opacity=".7" transform="rotate(' + Math.round(roll(0, 180)) + " " + x + " " + y + ')"'); }) +
        rect(0, 350, 400, 3, SOFT.pink, 'opacity=".5"');
    },

    "soft-wallart": function () { // A little pink scoreboard: a bullseye header, a big gold S-rank badge, glowing score bars and three stars, ringed with bulbs.
      const bars = [[180, 5], [192, 4], [204, 3]];                                                                         // Each row of the score: its height, and how many cells are lit.
      return rect(28, 146, 82, 86, "#ff8ecb", 'opacity=".12" rx="10"') + rect(30, 148, 78, 82, "#231a44", 'rx="8" stroke="' + SOFT.pink + '" stroke-width="3"') +
        rect(34, 152, 70, 14, SOFT.pink, 'rx="5"') + ART.softTarget(42, 159, 5) + path("M52 159 h44", "none", 'stroke="#fff1f8" stroke-width="2.4" stroke-dasharray="4 3" stroke-linecap="round"') + // The header.
        circle(54, 192, 16, SOFT.amber) + circle(54, 192, 13, SOFT.gold) + path("M60 185 Q54 179 48.5 184 Q45.5 189.5 54 192 Q62.5 194.5 59.5 200 Q54 205 47.5 199", "none", 'stroke="#fff8dc" stroke-width="3.6" stroke-linecap="round"') + // The S rank.
        path("M45 207 l-5 12 l6 -3 l3 6 l3 -11 Z M63 207 l5 12 l-6 -3 l-3 6 l-3 -11 Z", SOFT.pink) +                                          // Ribbon tails under the badge.
        bars.map(function (b) { let out = ""; for (let i = 0; i < 5; i++) out += rect(76 + i * 5.6, b[0], 4.2, 8, i < b[1] ? SOFT.mint : "#3a3060", 'rx="1.2"' + (i < b[1] ? ' class="lp-neon"' : "")); return out; }).join("") + // Score cells.
        [70, 82, 94].map(function (x, i) { return path(star(x + 6, 222, 4.6), SOFT.gold, 'class="lp-twinkle" style="animation-delay:' + (i * .4) + 's"'); }).join("") +
        [36, 50, 64, 78, 92, 102].map(function (x, i) { return circle(x, 148, 2, i % 2 ? SOFT.gold : SOFT.cream, 'class="lp-twinkle" style="animation-delay:' + (i * .3) + 's"'); }).join(""); // Bulbs along the top.
    },

    "soft-shelf": function () { // Three glass jars of stardust BBs in every pastel, with ribbon-tied lids and star labels, a few BBs rolled loose on a pink shelf.
      const BB = [SOFT.pink, SOFT.mint, SOFT.gold, SOFT.lilac, SOFT.cream];
      function jar(x, w, h, fill, lid, seed) { // A jar `fill` full of BBs, then its glass, its lid and a star label.
        let balls = "";
        const roll = dice(seed);
        for (let y = 197; y > 200 - fill; y -= 3) for (let bx = x - w / 2 + 3 + (Math.round(y) % 2) * 1.5; bx < x + w / 2 - 2; bx += 3.2) balls += circle(round(bx), y, 1.5, BB[Math.floor(roll(0, 5))]); // Packed rows of BBs.
        return balls + rect(x - w / 2, 200 - h, w, h, "#e6f6ff", 'rx="4" opacity=".22" stroke="#f4fbff" stroke-width="1.5"') + rect(x - w / 2 + 2.5, 203 - h, 2.6, h - 8, "#fff", 'rx="1.3" opacity=".5"') + // The glass and its shine.
          rect(x - w / 2 - 1.5, 194 - h, w + 3, 7, lid, 'rx="2.5"') + path("M" + (x - w / 2 - 1.5) + " " + (198 - h) + " h" + (w + 3), "none", 'stroke="#fff" stroke-width="1" opacity=".5"') + // The lid.
          circle(x, 186 - h * .35, 5, "#fff8ec") + path(star(x, 186 - h * .35, 4), lid);                                                    // A round label with a sparkle.
      }
      return jar(312, 24, 36, 26, SOFT.pink, 1611) + jar(340, 18, 26, 14, SOFT.mint, 1612) + jar(364, 20, 31, 22, SOFT.lilac, 1613) +
        path(star(326, 158, 5), SOFT.gold, 'class="lp-twinkle"') + path(star(378, 164, 3.5), "#fff", 'class="lp-twinkle" style="animation-delay:.7s"') +
        circle(328, 198, 1.8, SOFT.gold) + circle(352, 198, 1.8, SOFT.pink) + circle(356, 198.4, 1.6, SOFT.mint) +                              // A few rolled loose.
        rect(294, 200, 88, 6, "#d47aae", 'rx="2"') + rect(294, 205, 88, 1.5, SOFT.mint, 'opacity=".7"') +
        path("M304 206 l6 10 M372 206 l-6 10", "none", 'stroke="#a85a8a" stroke-width="3" stroke-linecap="round"');
    },

    "soft-view": function () { // Out over a toy range on a sunny day: lilac hills with flagpoles, cardboard creatures and bullseyes lined up on the grass, a bunting rope, and confetti drifting down.
      let far = hills(1621, 80, 24, "#b7a6e6");
      [24, 86, 150, 210].forEach(function (x, i) { const y = 70 + (i % 2) * 4; far += line(x, y, x, y - 16, "#7a6aa8", 1.2) + path("M" + x + " " + (y - 16) + " l9 3 l-9 3 Z", [SOFT.pink, SOFT.mint, SOFT.gold, SOFT.lilac][i]); }); // Flagpoles on the hills.
      let mid = rect(0, 100, TILE, 40, "#9fe0b4") + rect(0, 100, TILE, 2, "#c4f0d2");                                       // The range's grass.
      [[22, "cat"], [82, "target"], [130, "bunny"], [186, "target"], [222, "slime"]].forEach(function (m, i) {
        mid += m[1] === "target" ? line(m[0] - 6, 104, m[0], 92, "#8a6a4a", 1.4) + line(m[0] + 6, 104, m[0], 92, "#8a6a4a", 1.4) + ART.softTarget(m[0], 88, 9) // A bullseye on an easel...
          : ART.softStandee(m[0], 104, .5, m[1], i % 2 ? 4 : -4);                                                         // ...or a cardboard creature.
      });
      const near = rect(0, 124, TILE, 20, "#7fd6a0") + path("M0 128 H240 M0 134 H240", "none", 'stroke="#fff" stroke-width="1" stroke-dasharray="8 6" opacity=".5"') + // The near lane.
        [0, 80, 160].map(function (x) { return rect(x + 38, 104, 4, 22, "#c99a6a", 'rx="1.5"') + circle(x + 40, 104, 3, SOFT.gold); }).join("") + // Rope posts...
        [0, 80, 160].map(function (x, i) { return ART.softFlags(x - 40, 108, x + 40, 108, 4, 5, 7, i); }).join("") + ART.softFlags(200, 108, 280, 108, 4, 5, 7, 0); // ...and bunting between them, tiling at 240.
      return view(["#b4d8ff", "#ffd6ec"], ["#141a3a", "#3a2a5e"], 24, far, mid, near,
        falling("snow", scatter(1622, 14, function (roll, i) { const x = round(roll(0, 120)), y = round(roll(0, 130)); return rect(x, y, 3, 1.8, [SOFT.pink, SOFT.mint, SOFT.gold, SOFT.lilac][i % 4], 'transform="rotate(' + Math.round(roll(0, 180)) + " " + x + " " + y + ')"'); })));
    },

    "soft-frame": function () { // The window as an instant photo from range day: a thick cream card, washi tape at the corners, and stickers on its wide bottom edge (her Sparkle Popper, a bullseye, hearts).
      return rect(138, 96, 128, 140, "#000", 'opacity=".18" rx="3"') +                                                             // A soft shadow behind the card.
        path("M138 92 H262 Q266 92 266 96 V228 Q266 232 262 232 H138 Q134 232 134 228 V96 Q134 92 138 92 Z " + CLIPS["soft-frame"], SOFT.cream, 'fill-rule="evenodd"') + // The card, with the picture cut out.
        path(CLIPS["soft-frame"], "none", 'stroke="#e8dff0" stroke-width="2"') +
        [[141, SOFT.pink, -32], [259, SOFT.mint, 32]].map(function (w) { // Washi tape over the two top corners, with little dashes printed on it.
          return group(rect(-15, -5.5, 30, 11, w[1], 'opacity=".8"') + path("M-9 -5.5 v11 M-3 -5.5 v11 M3 -5.5 v11 M9 -5.5 v11", "none", 'stroke="#fff" stroke-width="1.2" stroke-dasharray="2 2" opacity=".6"'),
            'transform="translate(' + w[0] + ' 91) rotate(' + w[2] + ')"');
        }).join("") +
        ART.softPopper(162, 217, .7, -8) + ART.softTarget(240, 217, 8) +                                                         // Stickers: her Sparkle Popper and a bullseye...
        path("M199 222 c-6 -4 -5 -9 -2 -9 q2 0 2 2 q0 -2 2 -2 c3 0 4 5 -2 9 Z", SOFT.pink) + path("M214 219 c-4 -3 -3.5 -6.5 -1.4 -6.5 q1.4 0 1.4 1.4 q0 -1.4 1.4 -1.4 c2.1 0 2.5 3.5 -1.4 6.5 Z", SOFT.lilac) + // ...two hearts...
        path(star(186, 210, 4), SOFT.gold) + path(star(224, 226, 3), SOFT.gold) + path("M190 228 q6 -4 12 0 t12 0", "none", 'stroke="' + SOFT.lilac + '" stroke-width="1.4" stroke-linecap="round"'); // ...and a doodled squiggle.
    },

    "soft-curtains": function () { // Candy-striped panels tied back with bullseye rosettes, range bunting across the top and a mint rod with bullseye ends.
      function panel(flip) { // One tied-back panel, pink with cream stripes following its folds; mirrored for the other side.
        return group(path("M122 88 H166 Q158 140 142 168 Q152 200 160 236 H122 Z", SOFT.pink, 'opacity=".95"') +
          path("M130 88 Q130 140 128 168 Q132 200 134 236 M142 88 Q141 140 134 168 Q140 200 146 236 M154 88 Q150 140 139 168 Q146 200 154 236", "none", 'stroke="' + SOFT.cream + '" stroke-width="3" opacity=".8"') + // Stripes gathered at the tie.
          oval(140, 168, 13, 4, SOFT.sea) + ART.softTarget(146, 168, 6.5),                                                                 // The tie and its rosette.
          flip ? 'transform="translate(400 0) scale(-1 1)"' : "");
      }
      return panel(false) + panel(true) + ART.softFlags(124, 92, 276, 92, 7, 9, 14) +
        rect(120, 84, 160, 6, SOFT.sea, 'rx="3"') + rect(120, 84, 160, 2, SOFT.mint, 'rx="1"') + ART.softTarget(118, 87, 6) + ART.softTarget(282, 87, 6);
    },

    "soft-lamp": function () { // A neon bullseye sign on a candy-striped pole: pink, mint and gold rings glowing round a twinkling star.
      return oval(56, 258, 60, 54, SOFT.pink, 'opacity=".1"') + oval(56, 258, 34, 30, SOFT.gold, 'opacity=".1"') +
        oval(56, 404, 22, 5, "#00000055") + path("M38 404 Q42 390 56 388 Q70 390 74 404 Z", SOFT.lilac) + rect(53, 290, 6, 100, SOFT.cream) + // The base and pole...
        path("M53 302 l6 -6 M53 318 l6 -6 M53 334 l6 -6 M53 350 l6 -6 M53 366 l6 -6 M53 382 l6 -6", "none", 'stroke="' + SOFT.pink + '" stroke-width="4"') + // ...striped like candy.
        circle(56, 258, 34, "#1d1638", 'opacity=".75" stroke="#4a3a7a" stroke-width="2"') +                                                    // The sign's backboard.
        circle(56, 258, 28, "none", 'stroke="' + SOFT.pink + '" stroke-width="3.4" class="lp-neon"') + circle(56, 258, 19, "none", 'stroke="' + SOFT.mint + '" stroke-width="3.2" class="lp-neon"') +
        circle(56, 258, 10, "none", 'stroke="' + SOFT.gold + '" stroke-width="3" class="lp-neon"') + path(star(56, 258, 6), "#fff8dc", 'class="lp-twinkle"') +
        path(star(84, 230, 4), SOFT.gold, 'class="lp-twinkle" style="animation-delay:.6s"') + path(star(26, 286, 3), SOFT.mint, 'class="lp-twinkle" style="animation-delay:1.1s"');
    },

    "soft-rug": function () { // A lilac lane runner with pink edges and dashed lane lines, a bullseye in the middle, gold stars at the ends and cream tassels.
      let tassels = "";
      for (let y = 422; y <= 460; y += 6) tassels += "M64 " + y + " h-6 M336 " + y + " h6 ";                                     // Fringe at both ends.
      return oval(200, 446, 146, 26, "#000", 'opacity=".18"') + path(tassels, "none", 'stroke="' + SOFT.cream + '" stroke-width="2" stroke-linecap="round"') +
        rect(64, 418, 272, 46, "#b9a2ff", 'rx="8"') + rect(64, 418, 272, 7, SOFT.pink, 'rx="3"') + rect(64, 457, 272, 7, SOFT.pink, 'rx="3"') +
        path("M72 433 H328 M72 449 H328", "none", 'stroke="#fff8ec" stroke-width="1.6" stroke-dasharray="10 7" opacity=".7"') +            // Lane lines.
        ART.softTarget(200, 441, 44, .34) + path(star(92, 441, 8), SOFT.gold) + path(star(308, 441, 8), SOFT.gold);
    },

    "soft-bed": function () { // A round padded nest of a bed: pink rim, a cushion full of confetti and BBs, ribbon curls, a cardboard-cat pillow and a starry blanket.
      const bits = scatter(1631, 18, function (roll, i) { const x = round(roll(308, 372)), y = round(roll(424, 440)); return i % 3 ? rect(x, y, 4, 2.2, [SOFT.pink, SOFT.mint, SOFT.gold, SOFT.lilac][i % 4], 'transform="rotate(' + Math.round(roll(0, 180)) + " " + x + " " + y + ')"') : circle(x, y, 1.6, [SOFT.gold, SOFT.mint, SOFT.pink][i % 3]); });
      return oval(340, 460, 56, 6, "#00000055") + oval(340, 430, 50, 19, "#e872b0") + oval(340, 433, 40, 12, "#fff1f8") + bits +          // The back of the rim, the cushion and its confetti.
        ART.softStandee(316, 438, .55, "cat", -70) +                                                                                   // A cardboard-cat pillow, lying down.
        path("M336 440 Q348 420 380 428 Q376 444 352 448 Z", SOFT.lilac) + path(star(356, 436, 3.5), SOFT.gold) + path(star(368, 432, 2.6), SOFT.gold) + // A starry blanket.
        path("M290 432 Q290 460 340 460 Q390 460 390 432 Q390 448 340 448 Q290 448 290 432 Z", SOFT.pink) +                                // The front of the rim.
        path("M296 440 Q340 458 384 440", "none", 'stroke="#fff1f8" stroke-width="1.4" stroke-dasharray="3 3" opacity=".8"') +             // Stitching.
        [[306, 446, SOFT.mint], [374, 446, SOFT.lilac]].map(function (b) { return path("M" + b[0] + " " + b[1] + " l-5 -3.5 v7 Z M" + b[0] + " " + b[1] + " l5 -3.5 v7 Z", b[2]) + circle(b[0], b[1], 1.8, b[2]); }).join(""); // Two ribbon bows on the rim.
    },

    "soft-door": function () { // The range's door: mint with a bullseye porthole, a pink pennant hung on a nail, a star knob, candy-stripe kickplate and bunting over the top.
      let stripes = "";
      for (let x = -58; x <= -8; x += 10) stripes += "M" + x + " 352 l10 -22 h5 l-10 22 Z ";                                        // Pink diagonals on the kickplate, all inside the door.
      return rect(-66, 192, 82, 162, "#3a2a5a", 'rx="3"') + rect(-58, 202, 66, 152, "#6fcfac") + rect(-58, 202, 66, 3, "#a8ecd0") +
        rect(-58, 330, 66, 22, SOFT.cream) + path(stripes, SOFT.pink) +
        rect(-58, 328, 66, 3, "#4fae90") + circle(-25, 244, 19, "#4fae90") + ART.softTarget(-25, 244, 16) +                                    // The porthole.
        circle(-25, 244, 16, "#fff", 'opacity=".18"') + path("M-34 236 q4 -6 10 -7", "none", 'stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"') +
        circle(-25, 274, 1.6, "#8a6a4a") + path("M-25 274 L-36 286 M-25 274 L-14 286", "none", 'stroke="#8a6a4a" stroke-width="1"') +           // A nail and string...
        path("M-38 286 H-12 L-25 308 Z", SOFT.pink) + path(star(-25, 293, 4.5), "#fff8dc") +                                                 // ...and a pennant.
        path(star(0, 300, 6), SOFT.gold) + circle(0, 300, 1.6, "#fff") +                                                                     // A star knob.
        rect(-58, 352, 66, 2, "#3a2a5a") + ART.softFlags(-68, 194, 18, 194, 6, 6, 11, 1);
    },

    "soft-ceiling": function () { // A mobile of bullseyes and a cardboard cat on a mint bar, hung with gold sparkles on their threads.
      return line(333, 0, 333, 30, "#8a7aa8", 1.4) + path("M300 31 V60 M333 31 V82 M366 31 V54 M300 86 V96 M366 76 V92", "none", 'stroke="#8a7aa8" stroke-width="1"') + // Threads.
        rect(294, 28, 78, 5, SOFT.sea, 'rx="2.5" transform="rotate(-4 333 30)"') + circle(333, 30, 3.4, SOFT.gold) +                         // The bar, hanging a little crooked.
        group(ART.softTarget(300, 73, 13), 'transform="rotate(-8 300 60)"') + group(ART.softTarget(366, 65, 11), 'transform="rotate(6 366 54)"') +
        ART.softStandee(333, 122, .7, "cat", 3) + path(star(300, 100, 5), SOFT.gold, 'class="lp-twinkle"') + path(star(366, 96, 4.5), SOFT.pink, 'class="lp-twinkle" style="animation-delay:.6s"');
    },

    "soft-sidetable": function () { // A lilac table with the Star Scope on a little gold tripod, a sparkle cap glinting, and her Sparkle Popper resting on the shelf underneath.
      return ART.table("#a88ad8") + ART.softPopper(336, 338, .62, 0) +                                                                     // On the bottom stretcher.
        path("M332 298 L320 323 M332 298 L332 323 M332 298 L344 323", "none", 'stroke="' + SOFT.amber + '" stroke-width="2" stroke-linecap="round"') + // The tripod.
        group(rect(306, 290.5, 8, 9, SOFT.lilac, 'rx="3"') + rect(312, 288, 38, 14, SOFT.pink, 'rx="7"') + rect(320, 288, 4, 14, SOFT.mint) + rect(338, 288, 4, 14, SOFT.mint) + // The scope's eyepiece, body and bands...
          rect(312, 288, 38, 4, "#fff", 'rx="2" opacity=".35"') + path("M348 288 L356 284 V306 L348 302 Z", SOFT.gold) + path(star(361, 295, 8), "#fff8dc", 'class="lp-twinkle"') + // ...flared end and sparkle cap...
          path("M331 286 c-3 -2.2 -2.6 -5 -.8 -5 q.8 0 .8 1 q0 -1 .8 -1 c1.8 0 2.2 2.8 -.8 5 Z", SOFT.cream), 'transform="rotate(-8 332 296)"') + // ...and a heart sight on top.
        circle(352, 321.5, 1.8, SOFT.pink) + circle(357, 321.5, 1.8, SOFT.mint) + circle(314, 321.5, 1.8, SOFT.gold);                     // Stardust BBs on the tabletop.
    },

    "soft-plant": function () { // A little bush that grows popcorn, plain and candy pink and mint, in a striped popcorn-box pot with a bullseye sticker.
      let stripes = "";
      for (let k = 0; k < 8; k += 2) stripes += "M" + (2 + 4 * k) + " 360 h4 L" + (9 + 3 * k) + " 392 h-3 Z ";                           // Every other stripe pink, narrowing to the foot.
      const puffs = [[2, 318, SOFT.cream], [16, 306, SOFT.blush], [30, 316, SOFT.cream], [8, 334, "#c4f5d4"], [24, 332, SOFT.cream], [36, 334, SOFT.blush], [18, 322, SOFT.cream], [0, 346, SOFT.cream]];
      return path("M18 360 V340", "none", 'stroke="#7a5a3a" stroke-width="3"') +
        circle(18, 326, 20, "#4f9a72") + circle(4, 336, 13, "#5fae86") + circle(32, 336, 13, "#5fae86") + circle(18, 314, 13, "#7fc49a") + // The bush.
        puffs.map(function (p) { return circle(p[0] - 2.4, p[1], 3.2, p[2]) + circle(p[0] + 2.4, p[1] - .6, 3, p[2]) + circle(p[0], p[1] - 3, 3, p[2]) + circle(p[0] + .4, p[1] + .6, 1.2, "#ffe9a8"); }).join("") + // Popcorn puffs.
        path("M2 360 H34 L30 392 H6 Z", SOFT.cream) + path(stripes, SOFT.pink) + rect(0, 356, 36, 6, "#e872b0", 'rx="2"') + ART.softTarget(18, 376, 5) +
        circle(-2, 390, 2.6, SOFT.cream) + circle(40, 389, 2.4, SOFT.blush);                                                                 // Two popped loose on the floor.
    },

    "soft-toychest": function () { // A pastel crate of cardboard creature standees, a cat, a bunny and a slime, poking out with bullseyes on their tummies.
      return oval(92, 478, 44, 4, "#00000055") +
        ART.softStandee(72, 440, .85, "cat", -10) + ART.softStandee(94, 436, .95, "bunny", 2) + ART.softStandee(115, 442, .8, "slime", 12) +   // Behind the front slats.
        rect(56, 430, 72, 6, "#7a5aa8") + [438, 451, 464].map(function (y, i) { return rect(54, y, 76, 10, i % 2 ? "#c9b0ff" : "#d9c4ff", 'rx="1"'); }).join("") + // Lilac slats.
        rect(54, 434, 8, 42, SOFT.pink, 'rx="1"') + rect(122, 434, 8, 42, SOFT.pink, 'rx="1"') + ART.softTarget(92, 457, 8) +                // Pink corner posts and a stencilled bullseye.
        path(star(66, 470, 3), SOFT.gold) + path(star(118, 446, 3), SOFT.gold);
    },

    "soft-trophy": function () { // The Golden Star Scope: a gold toy scope with a sparkle on its end, on a little stand on the bracket.
      return ART.bracket() + rect(90, 130, 20, 4, SOFT.amber, 'rx="1.5"') + rect(98.5, 121, 3, 10, SOFT.amber) +
        group(rect(83, 114, 5, 7, SOFT.amber, 'rx="2"') + rect(87, 112, 24, 11, SOFT.gold, 'rx="5.5" stroke="' + SOFT.amber + '" stroke-width="1"') + rect(93, 112, 3, 11, SOFT.amber) +
          rect(88, 113, 22, 3, "#fff8dc", 'rx="1.5" opacity=".6"') + path(star(114, 117.5, 6.5), "#fff8dc", 'class="lp-twinkle"'), 'transform="rotate(-10 100 118)"') +
        path(star(86, 104, 2.6), SOFT.gold, 'class="lp-twinkle" style="animation-delay:.7s"');
    },
  });

  // ---- The whole room. It is drawn 1000 wide and 500 tall and fills whatever it is given (the whole screen on a TV
  // or computer, a card on a phone), cropping its sides rather than squashing. The furniture above is drawn in a
  // 400-wide block in the middle; the wall and floor repeat across the full width; and there are three windows, the
  // middle one and one out to each side.
  const WIDE = 1000, MIDDLE = 300, TILES = [-100, 300, 700], WINDOWS = [-50, MIDDLE, 650]; // Where the 400-wide pieces sit.
  const NUDGE = { plant: 82 }; // Plants are drawn beside the door but stand between the lamp and Lumi, clear of both.
  const REPEATED = { wallpaper: TILES, floor: TILES, view: WINDOWS, frame: WINDOWS, curtains: WINDOWS };

  // A wall or floor painted one plain colour ("#rrggbb", room mode's paint pots; the server allows nothing else there):
  // the colour itself, with house.js's usual shading, so it sits in the room like a wallpaper.
  const HEX = /^#[0-9a-f]{6}$/;
  const PAINT = {
    wallpaper: function (colour) { return rect(0, 0, 400, 352, colour) + rect(0, 0, 400, 90, "#000", 'opacity=".12"') + rect(0, 300, 400, 52, "#fff", 'opacity=".05"') + rect(0, 340, 400, 12, "#000", 'opacity=".28"'); },
    floor: function (colour) {
      let boards = "";
      for (let y = 380; y < 500; y += 30) boards += rect(0, y, 400, 1.5, "#000", 'opacity=".14"'); // floorboards
      return rect(0, 350, 400, 150, colour) + rect(0, 350, 400, 3, "#fff", 'opacity=".2"') + boards;
    },
  };
  const BARE = { wallpaper: "wall-bare", floor: "floor-bare", door: "door-bare" }; // What an empty wall, floor or door looks like before she unpacks her own (every flat has a door).
  // Her door is pressable (Lumi Pet goes through it to Lumi Dungeons, game.js doorPress): an invisible box over the
  // door's usual place catches the press, so even a door drawn with gaps (beads, a portal) answers anywhere on it.
  const DOOR_HIT = '<rect x="-66" y="192" width="82" height="166" fill="transparent"/>';

  function render(house, backdrop, extra) { // The room as SVG markup, back to front. `house` is {spot: object id} from the server.
    // `extra.boxes`: moving boxes still to unpack, stacked at the front of the room. A spot missing from `house` is
    // bare: plaster and concrete for the wall and floor, nothing at all for furniture.
    // `backdrop`: the page has its own scrolling scenery behind it (the neon theme's drifting pixel cities). The
    // windows are real holes in the wall, so with the first, free view that scenery is what shows through them.
    // Any other view, or a theme with nothing behind the page, paints a view of ours into the holes instead.
    const frame = Object.prototype.hasOwnProperty.call(CLIPS, house.frame) ? house.frame : "frame-arch", opening = CLIPS[frame];
    const open = Boolean(backdrop) && house.view === "view-city";
    const defs = '<defs><clipPath id="lp-view-clip"><path d="' + opening + '"/></clipPath>' +
      '<mask id="lp-wall-mask" maskUnits="userSpaceOnUse" x="-100" y="0" width="' + (WIDE + 200) + '" height="500"><rect x="-100" width="' + (WIDE + 200) + '" height="500" fill="#fff"/>' +
      WINDOWS.map(function (x) { return '<path d="' + opening + '" transform="translate(' + x + ' 0)" fill="#000"/>'; }).join("") + "</mask></defs>";
    // `extra.only`: just these layers (room mode's kitchen and den: her wallpaper, floor and windows, none of her furniture).
    const layers = extra && extra.only ? LAYERS.filter(function (spot) { return extra.only.indexOf(spot) >= 0; }) : LAYERS;
    // `extra.shift`: {spot: [dx, dy]} moves a single-place spot (and "boxes") from where it usually stands: room mode
    // spreads her furniture across the room and stands it back from the front edge, clear of its lower bar.
    const shift = (extra && extra.shift) || {}, moved = function (spot) { return shift[spot] || [0, 0]; };
    return defs + layers.map(function (spot) {
      const painted = PAINT[spot] && HEX.test(house[spot] || "") ? house[spot] : null; // a plain painted wall or floor
      const id = Object.prototype.hasOwnProperty.call(ART, house[spot]) ? house[spot] : BARE[spot];
      const draw = painted ? function () { return PAINT[spot](painted); } : id ? ART[id] : null;
      let art = draw && !(spot === "view" && open) ? draw() : ""; // An object this file doesn't know simply isn't drawn.
      if (art && spot === "view") art = group(art, 'clip-path="url(#lp-view-clip)"');
      if (art && spot === "door") art += DOOR_HIT; // The door's press box, drawn on top of it.
      const places = REPEATED[spot] || [MIDDLE + (NUDGE[spot] || 0) + moved(spot)[0]], dy = REPEATED[spot] ? 0 : moved(spot)[1]; // (walls, floors and windows never move)
      return group(art ? places.map(function (x) { return group(art, 'transform="translate(' + x + " " + dy + ')"'); }).join("") : "",
        'data-spot="' + spot + '"' + (spot === "wallpaper" ? ' mask="url(#lp-wall-mask)"' : "") + (spot === "view" && open ? ' data-open="true"' : "") + (spot === "door" ? ' data-click="door"' : ""));
    }).join("") + (extra && extra.boxes ? group(group(ART.boxes(extra.boxes), 'transform="translate(' + (MIDDLE + moved("boxes")[0]) + " " + moved("boxes")[1] + ')"'), 'data-boxes="' + extra.boxes + '"') : "");
  }

  return { LAYERS: LAYERS, ART: ART, CLIPS: CLIPS, WINDOWS: WINDOWS, WIDE: WIDE, render: render };
});
