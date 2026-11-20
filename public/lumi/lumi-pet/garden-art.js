/* The art for Lumi's Stardust Garden: a meadow under the open sky, the powder press, a grid of plots with a flower in
   each at whatever stage it has reached and a timer under it, the garden's decorations, and the two minigames'
   panels. Plain SVG in the same 1000 x 500 room as her house and the dungeon, kept to the middle (x 340 to 660) so
   the side panels never cover it.

   The server's catalog (mnemerynne/lumipet_data/garden.json, written by python/make_lumi_garden.py) names every
   flower and decoration and gives each its shape and colours; this file only knows how to draw each shape. Every
   flower shape needs an entry in BLOOMS and every decoration slot one in DECOR (tests/js/lumi_garden.test.mjs
   checks both against the catalog). Colours come from the server, which only accepts "#rrggbb"; everything else
   is authored here. Shapes with data-click are where a mouse or finger can press (game.js listens). */
(function (root, make) {
  const art = make();
  if (typeof module === "object" && module.exports) module.exports = art; else root.LumiPetGardenArt = art;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const INK = "#0d0a1a", STEM = "#5fae86", LEAF = "#6fbf8f";
  const COLUMNS = 4, TILE_W = 58, TILE_H = 50, GAP = 5, LEFT = 376, TOP = 178, RIGHT = LEFT + COLUMNS * TILE_W + (COLUMNS - 1) * GAP;
  const PRESS_X = 100; // The press stands to the right, clear of the bar of words at the top left (game.css .lp-dhud).
  const CANS = [{ x: 500, y: 196, colour: "#70ebea", arrow: "▲" }, { x: 590, y: 272, colour: "#ffdc83", arrow: "▶" }, { x: 500, y: 348, colour: "#ff6b8b", arrow: "▼" }, { x: 410, y: 272, colour: "#8be9a8", arrow: "◀" }];

  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function path(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function line(d, stroke, width, more) { return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + (width || 2) + '" stroke-linecap="round" ' + (more || "") + "/>"; }
  function text(x, y, words, size, fill, more) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + words + "</text>"; }
  function safe(colour) { return /^#[0-9a-f]{6}$/.test(colour) ? colour : "#f0deff"; }
  function n1(value) { return Math.round(value * 10) / 10; }
  function press(x, y, w, h, name) { return rect(x, y, w, h, "#000", 'fill-opacity="0" pointer-events="all" data-click="' + name + '"'); }
  function tile(index) { return { x: LEFT + (index % COLUMNS) * (TILE_W + GAP), y: TOP + Math.floor(index / COLUMNS) * (TILE_H + GAP) }; }
  function turned(inner, angle, x, y, more) { return '<g transform="rotate(' + n1(angle) + " " + n1(x) + " " + n1(y) + ')" ' + (more || "") + ">" + inner + "</g>"; }
  function petal(x, y, long, wide, angle, fill, more) { // One pointed petal, its base at (x, y), pointing up before it is turned.
    return turned(path("M" + n1(x) + " " + n1(y) + " q" + n1(wide) + " " + n1(-long / 2) + " 0 " + n1(-long) + " q" + n1(-wide) + " " + n1(long / 2) + " 0 " + n1(long) + "Z", fill, more), angle, x, y);
  }
  function ring(x, y, count, draw) { let out = ""; for (let i = 0; i < count; i++) out += draw(360 / count * i, i); return out; } // The same thing, turned round a centre.
  function heartShape(x, y, s, fill) { return path("M" + n1(x) + " " + n1(y + s) + " q" + n1(-s * 1.4) + " " + n1(-s) + " " + n1(-s * .7) + " " + n1(-s * 1.6) + " q" + n1(s * .6) + " " + n1(-s * .3) + " " + n1(s * .7) + " " + n1(s * .4) +
    " q" + n1(s * .1) + " " + n1(-s * .7) + " " + n1(s * .7) + " " + n1(-s * .4) + " q" + n1(s * .7) + " " + n1(s * .6) + " " + n1(-s * .7) + " " + n1(s * 1.6) + "Z", fill); }
  function starPoints(x, y, r, points) { // A star with this many points, as a path.
    let d = "";
    for (let i = 0; i < points * 2; i++) { const a = Math.PI * i / points - Math.PI / 2, q = i % 2 ? r * .45 : r; d += (i ? "L" : "M") + n1(x + Math.cos(a) * q) + " " + n1(y + Math.sin(a) * q); }
    return d + "Z";
  }

  // ---- Flower heads, one per shape. Each draws a bloom centred on (x, y) of about radius s, in the flower's own
  // colour c and heart colour h, with n petals (or bells, or spots: whatever the shape counts).
  const BLOOMS = {
    daisy: function (x, y, s, c, h, n) { return ring(x, y, n, function (a) { return turned(oval(x, y - s * .62, s * .17, s * .46, c), a, x, y); }) + circle(x, y, s * .3, h); },
    bell: function (x, y, s, c, h, n) { let out = line("M" + x + " " + n1(y + s) + " Q" + n1(x - s * .1) + " " + n1(y - s * 1.3) + " " + n1(x + s * 1.3) + " " + n1(y - s * .9), STEM, 1.6); // an arching stem, with bells hung along it
      for (let i = 0; i < n; i++) { const t = (i + 1) / (n + .3), bx = x + s * 1.3 * t * t - s * .05 * t, by = y - s * 1.15 * t + s * .35 * t * t + s * .25, w = s * (.36 - .03 * i);
        out += line("M" + n1(bx) + " " + n1(by - w * 1.3) + " v" + n1(w * .5), STEM, 1) + path("M" + n1(bx - w) + " " + n1(by + w * .7) + " Q" + n1(bx - w * .9) + " " + n1(by - w * .9) + " " + n1(bx) + " " + n1(by - w * .9) +
          " Q" + n1(bx + w * .9) + " " + n1(by - w * .9) + " " + n1(bx + w) + " " + n1(by + w * .7) + " Z", i % 2 ? h : c, 'stroke="' + INK + '" stroke-opacity=".15" stroke-width=".8"') + circle(bx, by + w * .85, w * .22, i % 2 ? c : h); }
      return out; },
    puff: function (x, y, s, c, h, n) { return circle(x, y, s * .95, c, 'opacity=".25"') + ring(x, y, n, function (a) { return turned(line("M" + x + " " + y + " v" + n1(-s * .8), c, 1.2) + circle(x, y - s * .85, s * .12, c), a, x, y); }) + circle(x, y, s * .2, h); },
    star: function (x, y, s, c, h, n) { return path(starPoints(x, y, s, n), c, 'stroke="' + h + '" stroke-width="1" stroke-linejoin="round"') + circle(x, y, s * .22, h); },
    poppy: function (x, y, s, c, h, n) { return ring(x, y, n, function (a) { return turned(circle(x, y - s * .45, s * .52, c, 'opacity=".92"'), a, x, y); }) + circle(x, y, s * .3, INK) + circle(x, y, s * .14, h); },
    spike: function (x, y, s, c, h, n) { let out = ""; const rows = n + 2;
      for (let i = 0; i < rows; i++) { const r = s * (.34 - .2 * i / rows), by = y + s * .9 - i * s * 2 / rows; out += circle(x - r * .9, by, r, c) + circle(x + r * .9, by - s * .08, r, i % 2 ? h : c); }
      return out + circle(x, y - s * 1.15, s * .12, h); },
    clover: function (x, y, s, c, h, n) { return ring(x, y, n, function (a) { return turned(circle(x - s * .2, y - s * .5, s * .32, c) + circle(x + s * .2, y - s * .5, s * .32, c) + path("M" + n1(x - s * .42) + " " + n1(y - s * .4) + " L" + x + " " + y + " L" + n1(x + s * .42) + " " + n1(y - s * .4) + "Z", c), a + 180 / n, x, y); }) + circle(x, y, s * .16, h); },
    trumpet: function (x, y, s, c, h, n) { return turned(path("M" + n1(x - s * .15) + " " + n1(y + s * .7) + " L" + n1(x - s * .8) + " " + n1(y - s * .6) + " Q" + x + " " + n1(y - s * 1.1) + " " + n1(x + s * .8) + " " + n1(y - s * .6) + " L" + n1(x + s * .15) + " " + n1(y + s * .7) + "Z", c) +
      oval(x, y - s * .65, s * .8, s * .3, h) + oval(x, y - s * .65, s * .45, s * .14, INK, 'opacity=".5"') + (n > 5 ? oval(x, y - s * .68, s * .95, s * .38, "none", 'stroke="' + c + '" stroke-width="1.5"') : ""), 20, x, y); },
    mushroom: function (x, y, s, c, h, n) { let spots = ""; for (let i = 0; i < n; i++) spots += circle(x - s * .6 + i * s * 1.2 / Math.max(1, n - 1), y - s * (.25 + .18 * (i % 2)), s * .13, h);
      return rect(n1(x - s * .2), n1(y), n1(s * .4), n1(s * .9), "#f6f1ff", 'rx="' + n1(s * .15) + '"') + path("M" + n1(x - s) + " " + n1(y + s * .1) + " Q" + x + " " + n1(y - s * 1.3) + " " + n1(x + s) + " " + n1(y + s * .1) + "Z", c) + spots; },
    tulip: function (x, y, s, c, h, n) { let top = "M" + n1(x - s * .7) + " " + n1(y - s * .7); for (let i = 1; i <= n; i++) top += " L" + n1(x - s * .7 + (i - .5) * s * 1.4 / n) + " " + n1(y - s * .25) + " L" + n1(x - s * .7 + i * s * 1.4 / n) + " " + n1(y - s * .7);
      return path(top + " Q" + n1(x + s * .8) + " " + n1(y + s * .8) + " " + x + " " + n1(y + s * .8) + " Q" + n1(x - s * .8) + " " + n1(y + s * .8) + " " + n1(x - s * .7) + " " + n1(y - s * .7) + "Z", c, 'stroke="' + h + '" stroke-width="1"'); },
    sun: function (x, y, s, c, h, n) { return ring(x, y, n, function (a) { return turned(path("M" + n1(x - s * .2) + " " + n1(y - s * .45) + " L" + x + " " + n1(y - s * 1.05) + " L" + n1(x + s * .2) + " " + n1(y - s * .45) + "Z", c), a, x, y); }) +
      circle(x, y, s * .52, h) + circle(x, y, s * .3, INK, 'opacity=".25"'); },
    hearts: function (x, y, s, c, h, n) { let out = line("M" + x + " " + n1(y + s) + " Q" + n1(x + s * .1) + " " + n1(y - s * 1.2) + " " + n1(x + s * 1.2) + " " + n1(y - s * .6), STEM, 1.6);
      for (let i = 0; i < n; i++) { const t = (i + 1) / (n + .5), hx = x + s * 1.2 * t * t + s * .1 * t, hy = y - s * 1.1 * t + s * .7 * t * t; out += heartShape(hx, hy + s * .15, s * (.3 - .02 * i), i % 2 ? h : c); }
      return out; },
    cactus: function (x, y, s, c, h, n) { let spines = ""; for (let i = 0; i < n; i++) spines += line("M" + n1(x - s * .5 + i * s / Math.max(1, n - 1)) + " " + n1(y + s * .1) + " v" + n1(s * .5), "#d9f0e8", 1, 'opacity=".7"');
      return rect(n1(x - s * .7), n1(y - s * .2), n1(s * 1.4), n1(s * 1.3), LEAF, 'rx="' + n1(s * .6) + '"') + spines + ring(x, y - s * .45, 5, function (a) { return turned(oval(x, y - s * .75, s * .16, s * .3, c), a, x, y - s * .45); }) + circle(x, y - s * .45, s * .16, h); },
    rose: function (x, y, s, c, h, n) { let out = ""; const rings = Math.max(3, Math.round(n / 2));
      for (let i = 0; i < rings; i++) out += circle(x + (i % 2 ? s * .06 : -s * .06), y, s * (1 - i / rings), i % 2 ? h : c, 'stroke="' + INK + '" stroke-opacity=".15" stroke-width="1"');
      return out + line("M" + n1(x - s * .2) + " " + y + " q" + n1(s * .2) + " " + n1(-s * .3) + " " + n1(s * .4) + " 0", INK, 1, 'opacity=".35"'); },
    lotus: function (x, y, s, c, h, n) { let out = ""; for (let i = 0; i < n; i++) { const a = -80 + 160 * i / (n - 1); out += petal(x, y + s * .5, s * (1.5 - Math.abs(a) / 160), s * .5, a, i % 2 ? h : c, 'stroke="' + INK + '" stroke-opacity=".12" stroke-width="1"'); }
      return out + oval(x, y + s * .55, s * .9, s * .18, LEAF); },
    orchid: function (x, y, s, c, h, n) { return [0, 120, 240].map(function (a) { return petal(x, y, s * 1.15, s * .32, a, c, 'opacity=".85"'); }).join("") + [70, 290].map(function (a) { return petal(x, y, s, s * .7, a, c); }).join("") +
      petal(x, y, s * .8, s * .5, 180, h) + circle(x, y, s * .16, "#fff8dc") + (n > 5 ? circle(x, y + s * .4, s * .08, INK) : ""); },
    cluster: function (x, y, s, c, h, n) { return ring(x, y, n, function (a, i) { return turned(circle(x, y - s * .55, s * .34, i % 3 ? c : h, 'stroke="' + INK + '" stroke-opacity=".12" stroke-width="1"'), a, x, y); }) + circle(x, y, s * .42, c) + circle(x, y, s * .1, h); },
    lily: function (x, y, s, c, h, n) { return ring(x, y, n, function (a) { return petal(x, y, s * 1.15, s * .42, a, c, 'stroke="' + h + '" stroke-width=".8"'); }) + ring(x, y, 3, function (a) { return turned(line("M" + x + " " + y + " v" + n1(-s * .5), h, 1) + circle(x, y - s * .52, s * .08, h), a + 30, x, y); }); },
    iris: function (x, y, s, c, h, n) { const half = Math.max(2, Math.round(n / 2)); let out = "";
      for (let i = 0; i < half; i++) out += petal(x, y, s * 1.05, s * .5, 130 + 100 * i / (half - 1), c) + turned(line("M" + x + " " + n1(y + s * .2) + " v" + n1(s * .5), h, 1.4), 130 + 100 * i / (half - 1) - 180, x, y);
      for (let i = 0; i < half; i++) out += petal(x, y, s * 1.1, s * .3, -35 + 70 * i / (half - 1), c, 'opacity=".9"');
      return out + circle(x, y, s * .16, h); },
    fern: function (x, y, s, c, h, n) { let out = ""; for (let i = 0; i < n; i++) { const a = -70 + 140 * i / (n - 1); let frond = line("M" + x + " " + n1(y + s) + " q" + n1(s * .25) + " " + n1(-s) + " 0 " + n1(-s * 1.9), c, 1.4);
      for (let k = 1; k <= 4; k++) frond += oval(x + (k % 2 ? s * .2 : -s * .08), y + s - k * s * .42, s * .2, s * .09, k % 2 ? c : h, 'transform="rotate(' + (k % 2 ? -30 : 30) + " " + n1(x) + " " + n1(y + s - k * s * .42) + ')"');
      out += turned(frond, a, x, y + s); }
      return out; },
    wisteria: function (x, y, s, c, h, n) { let out = line("M" + x + " " + n1(y + s) + " Q" + n1(x - s * .2) + " " + n1(y - s * 1.2) + " " + n1(x + s * .7) + " " + n1(y - s), STEM, 1.6);
      for (let i = 0; i < n; i++) { const r = s * (.34 - .03 * i), by = y - s * .85 + i * s * .32; out += circle(x + s * .7 - r * .7, by, r, i % 2 ? h : c) + circle(x + s * .7 + r * .7, by + s * .1, r, c); }
      return out; },
  };

  function head(flower, x, y, grow) { // The flower's own head, at this share of full size.
    const draw = Object.prototype.hasOwnProperty.call(BLOOMS, flower.shape) ? BLOOMS[flower.shape] : BLOOMS.daisy;
    return draw(x, y, 8.5 * (flower.size || 1) * (grow || 1), safe(flower.colour), safe(flower.heart), flower.petals);
  }

  function plant(x, y, flower, stage, progress) { // One flower standing on its plot, by stage. (x, y) is where the stem meets the soil.
    if (stage === "growing" && progress < 0.34) return line("M" + x + " " + y + " v-7", STEM, 2.5) + oval(x - 4, y - 7, 4, 2.4, STEM, 'transform="rotate(-30 ' + (x - 4) + " " + (y - 7) + ')"') + oval(x + 4, y - 7, 4, 2.4, STEM, 'transform="rotate(30 ' + (x + 4) + " " + (y - 7) + ')"');
    const size = flower.size || 1, tall = stage === "growing" ? 9 + 9 * progress : Math.min(22, 15 + 5 * size);
    const stem = flower.shape === "mushroom" || flower.shape === "cactus" ? "" : line("M" + x + " " + y + " v-" + n1(tall), STEM, 2.5) + oval(x + 5, y - tall * .45, 5, 2.4, STEM, 'transform="rotate(-25 ' + (x + 5) + " " + n1(y - tall * .45) + ')"');
    if (stage === "growing") return stem + head(flower, x, y - tall, 0.3 + 0.5 * (progress - 0.34) / 0.66); // The same flower, small: it is already itself while it grows.
    if (stage === "overgrown") return turned(stem + head(flower, x, y - tall, 1), 26, x, y, 'opacity=".62"') + oval(x - 8, y - 4, 7, 3, "#6f8a5a") + oval(x + 9, y - 3, 7, 3, "#6f8a5a");
    return stem + head(flower, x, y - tall, 1);
  }

  function clock(ms) { // "1:05" · "2:03:00", the same as garden-ui.js clock.
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), pad = function (v) { return String(v).padStart(2, "0"); };
    return h ? h + ":" + pad(m) + ":" + pad(s % 60) : m + ":" + pad(s % 60);
  }

  function backdrop(open) { // A meadow at night. `open`: the theme has scenery drifting behind the page, so the sky is left clear to show it.
    let sky = "";
    if (!open) { // No scenery behind the page: paint a sky of our own.
      sky = rect(-100, 0, 1200, 500, "#15102e");
      for (let i = 0; i < 40; i++) sky += circle((i * 197) % 1000, 12 + (i * 61) % 130, i % 5 ? 1 : 1.8, "#f6f1ff", 'opacity="' + (0.35 + (i % 4) * 0.15) + '"' + (i % 6 ? "" : ' class="lp-twinkle"'));
    }
    return '<g data-sky="' + (open ? "open" : "painted") + '">' + sky + "</g>" + oval(250, 196, 420, 64, "#1b2a3a") + oval(780, 204, 460, 74, "#182536") + rect(-100, 176, 1200, 330, "#1c3030") + oval(500, 480, 520, 60, "#17282a");
  }

  // ---- Decorations: one drawing function per slot. Each is given which of the slot's three things it is (0, 1, 2),
  // its two colours, and where the beds end (`bottom`). They never change a number.
  const DECOR = {
    fence: function (t, a, b) { let out = "";
      for (let x = LEFT - 6; x <= RIGHT + 2; x += t === 1 ? 9 : 12) { if (x > 468 && x < 528) continue; // a gap for the arch and the path
        out += t === 0 ? path("M" + x + " 176 v-12 l3 -4 l3 4 v12 Z", a, 'stroke="' + b + '" stroke-width=".8"') : t === 1 ? rect(x, 160, 4, 16, a, 'rx="2" stroke="' + b + '" stroke-width=".6"') + rect(x - 1, 166, 6, 1.5, b)
          : path("M" + x + " 176 l3 -16 l3 16 Z", a, 'opacity=".85" stroke="' + b + '" stroke-width=".8" class="lp-twinkle"'); }
      return out + (t === 2 ? "" : rect(LEFT - 6, 168, 92, 2, b, 'opacity=".7"') + rect(530, 168, RIGHT - 528, 2, b, 'opacity=".7"')); },
    path: function (t, a, b, bottom) { let out = "";
      for (let i = 0; i < 6; i++) { const x = 494 + (i % 2) * 12, y = bottom + 10 + i * 9;
        out += t === 0 ? oval(x, y, 9, 4, a, 'stroke="' + b + '" stroke-width=".8" opacity=".85"') : t === 1 ? rect(x - 12 + (i % 2) * 2, y - 4, 22, 7, i % 2 ? a : b, 'rx="1.5" opacity=".85"') : oval(x, y, 10, 4.5, b, 'opacity=".8"') + circle(x - 3, y - 1, 2, a) + circle(x + 4, y + 1, 1.5, a); }
      return out; },
    edging: function () { return ""; }, // Drawn with each plot (see plots): the border itself changes.
    statue: function (t, a, b, bottom) { const x = 356, y = bottom - 4;
      return oval(x, y + 14, 12, 3.5, INK, 'opacity=".3"') + (t === 0 ? path("M" + (x - 8) + " " + (y - 6) + " l8 -24 l8 24 Z", a, 'stroke="' + b + '" stroke-width="1"') + circle(x, y - 2, 6.5, "#f3d9c4") + path("M" + (x - 6) + " " + (y + 2) + " q6 11 12 0 Z", "#f6f1ff") + rect(x - 7, y + 6, 14, 9, b, 'rx="3"')
        : t === 1 ? oval(x - 3.5, y - 16, 2.6, 9, a) + oval(x + 3.5, y - 16, 2.6, 9, a) + circle(x, y - 4, 7, a, 'stroke="' + b + '" stroke-width="1"') + oval(x, y + 8, 8, 7, a, 'stroke="' + b + '" stroke-width="1"') + circle(x - 2.5, y - 5, 1, INK) + circle(x + 2.5, y - 5, 1, INK)
          : petal(x - 2, y - 2, 16, 7, -50, b, 'opacity=".7"') + petal(x + 2, y - 2, 16, 7, 50, b, 'opacity=".7"') + circle(x, y - 10, 5, a) + path("M" + (x - 6) + " " + (y + 14) + " l6 -20 l6 20 Z", a, 'stroke="' + b + '" stroke-width="1"') + path(starPoints(x + 9, y - 16, 4, 4), "#fff8dc", 'class="lp-twinkle"')); },
    scarecrow: function (t, a, b, bottom) { const x = 644, y = bottom + 10;
      return line("M" + x + " " + y + " v-40 M" + (x - 13) + " " + (y - 26) + " h26", "#c79256", 3) + (t === 0 ? circle(x, y - 46, 8, a) + path("M" + (x - 7) + " " + (y - 51) + " l2 -8 l5 6 Z M" + (x + 7) + " " + (y - 51) + " l-2 -8 l-5 6 Z", a) + circle(x - 3, y - 47, 1.3, INK) + circle(x + 3, y - 47, 1.3, INK) + path("M" + (x - 9) + " " + (y - 30) + " h18 l-3 14 h-12 Z", b)
        : t === 1 ? oval(x, y - 45, 9.5, 8, a, 'stroke="' + b + '" stroke-width="1"') + rect(x - 1.5, y - 56, 3, 5, "#5fae86") + path("M" + (x - 5) + " " + (y - 47) + " l2 -3 l2 3 Z M" + (x + 1) + " " + (y - 47) + " l2 -3 l2 3 Z", INK) + path("M" + (x - 9) + " " + (y - 30) + " h18 l-2 12 h-14 Z", b)
          : rect(x - 8, y - 54, 16, 14, a, 'rx="3" stroke="' + b + '" stroke-width="1"') + circle(x - 3.5, y - 47, 2, b, 'class="lp-twinkle"') + circle(x + 3.5, y - 47, 2, b, 'class="lp-twinkle"') + line("M" + x + " " + (y - 54) + " v-6", b, 1.5) + circle(x, y - 61, 1.8, a) + rect(x - 8, y - 32, 16, 13, b, 'rx="2"')); },
    press: function () { return ""; }, // Drawn with the machine itself (see machine).
    lamps: function (t, a, b, bottom) { return [348, 652].map(function (x) { const top = TOP - 14;
      return line("M" + x + " " + (bottom + 2) + " V" + top, "#6a648a", 2.5) + (t === 0 ? rect(x - 5, top - 13, 10, 13, a, 'rx="4" opacity=".3"') + circle(x - 1.5, top - 8, 1.5, b, 'class="lp-twinkle"') + circle(x + 2, top - 4, 1.5, a, 'class="lp-twinkle"')
        : t === 1 ? oval(x, top - 8, 6.5, 8, a, 'stroke="' + b + '" stroke-width="1" class="lp-neon"') + rect(x - 3, top - 17, 6, 2, b) + rect(x - 3, top - 1, 6, 2, b)
          : path("M" + (x - 9) + " " + (top - 2) + " Q" + x + " " + (top - 20) + " " + (x + 9) + " " + (top - 2) + " Z", a, 'class="lp-neon"') + circle(x - 3, top - 8, 1.4, b) + circle(x + 3, top - 6, 1.2, b)); }).join(""); },
    arch: function (t, a, b) { const base = 176;
      return t === 0 ? path("M474 " + base + " V148 A26 26 0 0 1 526 148 V" + base, "none", 'stroke="#5fae86" stroke-width="4"') + [[474, 160], [480, 134], [500, 124], [520, 134], [526, 160]].map(function (p, i) { return circle(p[0], p[1], 4, i % 2 ? b : a); }).join("")
        : t === 1 ? circle(500, 150, 26, "none", 'stroke="' + a + '" stroke-width="5"') + circle(500, 150, 26, "none", 'stroke="' + b + '" stroke-width="1.5"') + rect(470, 172, 60, 4, b, 'rx="2"')
          : path("M474 " + base + " V148 A26 26 0 0 1 526 148 V" + base, "none", 'stroke="' + a + '" stroke-width="3"') + path("M474 150 q13 12 26 0 q13 12 26 0", "none", 'stroke="' + b + '" stroke-width="2"') + heartShape(500, 124, 4, b); },
    fountain: function (t, a, b, bottom) { const x = 396, y = bottom + 44;
      return oval(x, y + 8, 20, 4, INK, 'opacity=".3"') + (t === 0 ? rect(x - 2.5, y - 14, 5, 20, a) + oval(x, y - 15, 15, 4.5, a, 'stroke="' + b + '" stroke-width="1"') + oval(x, y - 15.5, 11, 2.5, "#9fd8ff", 'opacity=".8"')
        : t === 1 ? oval(x, y + 3, 19, 6, a, 'stroke="' + b + '" stroke-width="1"') + oval(x, y + 2, 15, 4, "#9fd8ff", 'opacity=".8"') + rect(x - 2, y - 14, 4, 16, a) + line("M" + x + " " + (y - 14) + " q-9 -10 -10 6 M" + x + " " + (y - 14) + " q9 -10 10 6", "#cfeeff", 1.3, 'class="lp-twinkle"')
          : rect(x - 12, y - 8, 24, 14, a, 'rx="3" stroke="' + b + '" stroke-width="1"') + line("M" + (x - 12) + " " + (y - 8) + " v-14 M" + (x + 12) + " " + (y - 8) + " v-14", b, 2) + path("M" + (x - 16) + " " + (y - 21) + " L" + x + " " + (y - 32) + " L" + (x + 16) + " " + (y - 21) + " Z", b) + rect(x - 3, y - 14, 6, 5, "#c79256")); },
    bench: function (t, a, b, bottom) { const x = 604, y = bottom + 44;
      return oval(x, y + 8, 22, 4, INK, 'opacity=".3"') + (t === 0 ? rect(x - 18, y - 4, 36, 5, a, 'rx="2" stroke="' + b + '" stroke-width=".8"') + rect(x - 18, y - 16, 36, 4, a, 'rx="2"') + line("M" + (x - 15) + " " + y + " v8 M" + (x + 15) + " " + y + " v8 M" + (x - 15) + " " + (y - 14) + " v10 M" + (x + 15) + " " + (y - 14) + " v10", b, 2)
        : t === 1 ? line("M" + (x - 16) + " " + (y + 8) + " L" + (x - 10) + " " + (y - 30) + " H" + (x + 10) + " L" + (x + 16) + " " + (y + 8), b, 2) + line("M" + (x - 8) + " " + (y - 30) + " v22 M" + (x + 8) + " " + (y - 30) + " v22", "#f6f1ff", 1) + rect(x - 11, y - 9, 22, 5, a, 'rx="2"')
          : path("M" + (x - 20) + " " + (y + 4) + " l8 -12 h30 l-8 12 Z", a, 'stroke="' + b + '" stroke-width="1"') + line("M" + (x - 8) + " " + (y - 8) + " l-8 12 M" + (x + 4) + " " + (y - 8) + " l-8 12", b, 1) + circle(x + 6, y - 6, 3, "#c79256")); },
    tree: function (t, a, b) { const x = 360, y = 170;
      return t === 0 ? rect(x - 3, y - 26, 6, 28, "#8a5a3a") + circle(x, y - 38, 16, a, 'opacity=".9"') + circle(x - 11, y - 30, 10, a) + circle(x + 11, y - 30, 10, a) + [[-8, -42], [6, -36], [0, -28], [12, -44]].map(function (p) { return circle(x + p[0], y + p[1], 2, b); }).join("")
        : t === 1 ? rect(x - 3, y - 30, 6, 32, "#8a5a3a") + [-14, -8, -2, 4, 10].map(function (dx, i) { return line("M" + (x + dx / 2) + " " + (y - 40) + " q" + dx + " 8 " + (dx * 1.2) + " " + (30 + (i % 2) * 6), i % 2 ? b : a, 2.2); }).join("") + circle(x, y - 40, 9, a)
          : rect(x - 2.5, y - 8, 5, 10, "#8a5a3a") + [0, 1, 2].map(function (i) { return path("M" + (x - 15 + i * 3) + " " + (y - 8 - i * 13) + " L" + x + " " + (y - 30 - i * 13) + " L" + (x + 15 - i * 3) + " " + (y - 8 - i * 13) + " Z", i % 2 ? b : a); }).join("") + path(starPoints(x, y - 58, 4, 5), "#ffdc83", 'class="lp-twinkle"'); },
    bush: function (t, a, b, bottom) { return [446, 554].map(function (x) { const y = bottom + 46;
      return t === 0 ? circle(x, y - 6, 11, a, 'stroke="' + b + '" stroke-width="1"') + rect(x - 2, y + 4, 4, 5, "#8a5a3a")
        : t === 1 ? path(starPoints(x, y - 6, 12, 5), a, 'stroke="' + b + '" stroke-width="1" stroke-linejoin="round"') + rect(x - 2, y + 3, 4, 6, "#8a5a3a")
          : oval(x, y - 3, 13, 9, a) + [[-6, -6], [3, -8], [7, -1], [-2, 0]].map(function (p) { return circle(x + p[0], y + p[1], 2, b); }).join(""); }).join(""); },
    banner: function (t, a, b) { let out = "";
      if (t === 0) { out += line("M" + LEFT + " 150 Q500 164 " + RIGHT + " 150", "#c9aecf", 1); for (let i = 0; i < 11; i++) { const x = LEFT + 12 + i * 22.4, y = 152 + 10 * Math.sin(Math.PI * (i + .5) / 11); out += path("M" + n1(x - 5) + " " + n1(y) + " h10 l-5 9 Z", i % 2 ? a : b); } }
      else if (t === 1) out += [392, 432].map(function (x) { return line("M" + x + " 138 v6", "#c9aecf", 1) + rect(x - 7, 144, 14, 2, b) + [-5, 0, 5].map(function (dx, i) { return rect(x + dx - 1, 146, 2, 9 + i * 3, a, 'class="lp-twinkle"'); }).join(""); }).join("");
      else out += [388, 416, 584, 612].map(function (x, i) { return line("M" + x + " 176 v-18", "#c9aecf", 1.2) + ring(x, 156, 4, function (ang) { return turned(path("M" + x + " 156 q5 -7 0 -8 Z", i % 2 ? a : b), ang, x, 156); }) + circle(x, 156, 1.3, "#fff8dc"); }).join("");
      return out; },
    critters: function (t, a, b, bottom) { return [[392, 0.2], [455, 0.7], [530, 0.35], [600, 0.85], [640, 0.5]].map(function (spot, i) { const x = spot[0], y = TOP - 6 + (bottom - TOP) * spot[1];
      return t === 0 ? oval(x - 3, y, 3, 4.5, i % 2 ? a : b, 'opacity=".9" class="lp-twinkle"') + oval(x + 3, y, 3, 4.5, i % 2 ? a : b, 'opacity=".9" class="lp-twinkle"') + rect(x - .5, y - 3, 1, 6, INK)
        : t === 1 ? circle(x, y, 4.5, a, 'opacity=".25" class="lp-twinkle"') + circle(x, y, 1.6, b, 'class="lp-twinkle"')
          : oval(x, y, 3.6, 3, a, 'stroke="' + INK + '" stroke-width=".6"') + circle(x - 1.2, y - .5, .8, b) + circle(x + 1.3, y + .6, .8, b) + circle(x, y - 3, 1.4, INK); }).join(""); },
    sky: function (t, a, b) { const x = 446, y = 112;
      return t === 0 ? path("M" + (x + 6) + " " + (y - 13) + " A14 14 0 1 0 " + (x + 6) + " " + (y + 13) + " A10.5 10.5 0 1 1 " + (x + 6) + " " + (y - 13) + " Z", a, 'class="lp-neon"') + path(starPoints(x + 14, y - 8, 3, 4), b, 'class="lp-twinkle"')
        : t === 1 ? oval(x, y - 6, 12, 14, a, 'stroke="' + b + '" stroke-width="1"') + path("M" + (x - 6) + " " + (y - 18) + " q6 12 0 24 M" + (x + 6) + " " + (y - 18) + " q-6 12 0 24", "none", 'stroke="' + b + '" stroke-width="1"') + line("M" + (x - 5) + " " + (y + 7) + " l2 7 M" + (x + 5) + " " + (y + 7) + " l-2 7", b, .8) + rect(x - 3.5, y + 14, 7, 5, "#c79256", 'rx="1"')
          : path("M" + x + " " + (y - 16) + " l10 12 l-10 16 l-10 -16 Z", a, 'stroke="' + b + '" stroke-width="1"') + line("M" + x + " " + (y - 16) + " v28 M" + (x - 10) + " " + (y - 4) + " h20", b, .8) + line("M" + x + " " + (y + 12) + " q6 8 -2 16 q-6 6 2 12", b, 1) + path("M" + (x - 4) + " " + (y + 26) + " l4 3 l-4 3 Z", a); },
  };

  function placed(garden, decor) { // { slot: { thing, a, b } } for whatever stands in this garden, from the catalog.
    const found = {}, here = (garden.decor && garden.decor.placed) || {};
    ((decor && decor.slots) || []).forEach(function (slot) {
      const item = slot.items.find(function (one) { return one.id === here[slot.id]; });
      if (item) found[slot.id] = { thing: item.thing, a: safe(item.a), b: safe(item.b) };
    });
    return found;
  }

  function decorations(out, bottom, behind) { // Everything placed, in two layers: what stands behind the beds, and what stands in front.
    const back = ["sky", "tree", "banner", "arch", "fence", "lamps"];
    return Object.keys(out).filter(function (slot) { return Object.prototype.hasOwnProperty.call(DECOR, slot) && (back.indexOf(slot) >= 0) === behind; })
      .map(function (slot) { return '<g data-decor="' + slot + '">' + DECOR[slot](out[slot].thing, out[slot].a, out[slot].b, bottom) + "</g>"; }).join("");
  }

  function plots(garden, cursor, focused, passed, edging) { // The grid: every plot with its flower and timer, and a patch of grass where the next could be dug.
    const flowers = {};
    garden.flowers.forEach(function (flower) { flowers[flower.id] = flower; });
    let out = "";
    garden.plots.forEach(function (plot, index) {
      const at = tile(index), left = plot.ready_in - passed, stage = plot.stage === "growing" && left <= 0 ? "ready" : plot.stage;
      const edge = !edging ? 'stroke="#241a2c" stroke-width="2"' : edging.thing === 0 ? 'stroke="' + edging.a + '" stroke-width="2" class="lp-neon"'
        : edging.thing === 1 ? 'stroke="' + edging.a + '" stroke-width="3" stroke-dasharray="1 5" stroke-linecap="round"' : 'stroke="' + edging.a + '" stroke-width="2.5" stroke-dasharray="9 3"';
      out += rect(at.x, at.y, TILE_W, TILE_H, "#3a2a3f", 'rx="7" ' + edge + ' data-plot="' + stage + '"') + rect(at.x + 5, at.y + TILE_H - 20, TILE_W - 10, 8, "#2a1d2f", 'rx="4"');
      if (plot.flower && flowers[plot.flower]) {
        out += plant(at.x + TILE_W / 2, at.y + TILE_H - 14, flowers[plot.flower], stage, plot.grow ? Math.max(0, Math.min(1, 1 - left / plot.grow)) : 1);
        const words = stage === "growing" ? clock(left) : stage === "ready" ? "ready ✦" : "overgrown"; // The timer under every flower; game.js counts it down in place.
        out += text(at.x + TILE_W / 2, at.y + TILE_H - 3, words, 7.5, stage === "growing" ? "#c9aecf" : stage === "ready" ? "#ffdc83" : "#b89a8a", 'data-timer="' + index + '" font-weight="700"');
      }
    });
    if (garden.plot_price !== null) {
      const at = tile(garden.plots.length);
      out += rect(at.x, at.y, TILE_W, TILE_H, "none", 'rx="7" stroke="#8a86a8" stroke-width="2" stroke-dasharray="6 5"') + text(at.x + TILE_W / 2, at.y + 26, "+", 22, "#8a86a8") +
        text(at.x + TILE_W / 2, at.y + 42, (typeof (typeof self !== "undefined" ? self : globalThis).LumiPrice === "function" ? (typeof self !== "undefined" ? self : globalThis).LumiPrice("garden", "plot", garden.plot_price) : garden.plot_price) + " SGC", 8, "#8a86a8"); // LumiBot: the plot's SGC price
    }
    if (focused) { const at = tile(cursor); out += rect(at.x - 3, at.y - 3, TILE_W + 6, TILE_H + 6, "none", 'rx="9" stroke="#70ebea" stroke-width="3" data-cursor="' + cursor + '"'); }
    return out;
  }

  function machine(garden, skin) { // The powder press: a hopper of starpowder over a plate, with how near the next coin is.
    const body = skin ? skin.a : "#6a648a", trim = skin ? skin.b : "#8a86a8", near = Math.max(0, Math.min(1, garden.squeezed / garden.price));
    const extra = !skin ? "" : skin.thing === 1 ? path("M488 84 q12 -12 24 0 q-12 12 -24 0 Z M500 84 l-8 14 M500 84 l8 14", trim, 'stroke="' + trim + '" stroke-width="2"')
      : skin.thing === 2 ? path(starPoints(462, 60, 6, 4), "#fff8dc", 'class="lp-twinkle"') + path(starPoints(540, 70, 4, 4), "#fff8dc", 'class="lp-twinkle"') : "";
    return '<g transform="translate(' + PRESS_X + ' 0)" data-press="' + (skin ? skin.thing : "plain") + '">' + rect(452, 84, 96, 12, body, 'rx="4"') + path("M462 84 L474 52 H526 L538 84 Z", trim, 'stroke="' + INK + '" stroke-opacity=".4" stroke-width="2"') +
      (garden.powder > 0.5 ? path("M476 60 H524 L530 78 H470 Z", "#f0deff", 'opacity=".85" class="lp-twinkle"') : "") +
      rect(470, 96, 60, 30, INK, 'opacity=".75" rx="4"') + rect(474, 114, 52, 8, "#2a2548", 'rx="4"') + rect(474, 114, 52 * near, 8, "#ffdc83", 'rx="4" data-near="' + Math.round(near * 100) + '"') +
      circle(500, 105, 5, "#ffdc83", 'opacity=".6"') + rect(444, 126, 112, 8, body, 'rx="4"') + text(500, 148, "PRESS", 9, "#c9aecf", 'letter-spacing="3"') + extra + "</g>";
  }

  function presses(garden) { // Where a mouse or finger can press: each plot, the patch for the next one, and the press.
    let out = press(440 + PRESS_X, 46, 120, 106, "press");
    for (let i = 0; i < garden.plots.length + (garden.plot_price === null ? 0 : 1); i++) { const at = tile(i); out += press(at.x, at.y, TILE_W, TILE_H, "plot:" + i); }
    return out;
  }

  function panel(inner, title) { return rect(340, 96, 320, 316, INK, 'opacity=".92" rx="14" stroke="#70ebea" stroke-opacity=".5" stroke-width="2"') + text(500, 124, title, 13, "#70ebea", 'font-weight="700" letter-spacing="2"') + inner; }

  function watering(mini) { // Four cans in a cross, one per arrow. `mini.lit`: the can lit just now (showing, or just pressed), or -1.
    let out = "";
    CANS.forEach(function (can, i) {
      const lit = mini.lit === i;
      out += circle(can.x, can.y, 38, can.colour, 'opacity="' + (lit ? 1 : 0.22) + '" data-can="' + (lit ? "lit" : "dim") + '"' + (lit ? ' class="lp-neon"' : "")) +
        path("M" + (can.x - 14) + " " + (can.y - 8) + " h22 v20 h-22 Z M" + (can.x + 8) + " " + (can.y - 2) + " l14 -8 l2 4 l-12 10 Z", lit ? INK : can.colour, 'opacity="' + (lit ? 0.8 : 0.9) + '"') +
        text(can.x, can.y + 30, can.arrow, 10, lit ? INK : "#c9aecf") + (mini.phase === "answer" ? rect(can.x - 40, can.y - 40, 80, 80, "#000", 'fill-opacity="0" pointer-events="all" data-click="can:' + i + '"') : "");
    });
    const dots = mini.show.map(function (_, i) { return circle(500 - (mini.show.length - 1) * 7 + i * 14, 392, 4, i < mini.answer.length ? "#8be9a8" : "#3a3550"); }).join("");
    return panel(out + dots, mini.phase === "show" ? "WATCH THE CANS" : "YOUR TURN · " + mini.answer.length + " OF " + mini.show.length);
  }

  function feeding(mini) { // One big button, a count, and the time running out.
    const share = Math.max(0, Math.min(1, mini.left / mini.whole));
    return panel(circle(500, 262, 74, "#8be9a8", 'opacity=".25"') + circle(500, 262, 58, "#8be9a8", 'class="lp-neon"') + text(500, 274, String(mini.count), 38, INK, 'font-weight="700"') +
      rect(380, 366, 240, 10, "#2a2548", 'rx="5"') + rect(380, 366, 240 * share, 10, "#ffdc83", 'rx="5"') + rect(340, 140, 320, 272, "#000", 'fill-opacity="0" pointer-events="all" data-click="feed"'), "PRESS! PRESS! PRESS!");
  }

  function scene(garden, look) { // Everything, back to front. look: { cursor, focused, passed, mini, decor (the catalog), sky (true: leave it open) }.
    const out = placed(garden, look.decor), count = garden.plots.length + (garden.plot_price === null ? 0 : 1);
    const bottom = TOP + Math.ceil(Math.max(count, 4) / COLUMNS) * (TILE_H + GAP) - GAP;
    const base = backdrop(Boolean(look.sky)) + decorations(out, bottom, true) + machine(garden, out.press) + plots(garden, look.cursor, look.focused && !look.mini, look.passed || 0, out.edging) + decorations(out, bottom, false);
    if (look.mini && look.mini.kind === "water") return base + watering(look.mini);
    if (look.mini && look.mini.kind === "feed") return base + feeding(look.mini);
    return base + presses(garden);
  }

  function bloom(flower) { // One flower by itself, stem and all, for the Collection's gallery.
    return line("M200 330 V246", STEM, 6) + oval(214, 296, 16, 7, STEM, 'transform="rotate(-25 214 296)"') + head(flower, 200, 240, 5 / (flower.size || 1));
  }

  function piece(slot, id, decor) { // One decoration by itself, drawn where it would stand in a garden.
    const only = { decor: { placed: {} } }, bottom = TOP + 2 * (TILE_H + GAP) - GAP;
    only.decor.placed[slot] = id;
    const out = placed(only, decor)[slot];
    if (!out || !Object.prototype.hasOwnProperty.call(DECOR, slot)) return "";
    if (slot === "edging") return plots({ plots: [{ flower: null, stage: "empty", ready_in: 0, grow: 0 }], plot_price: null, flowers: [] }, 0, false, 0, out); // The border is the plot's own.
    if (slot === "press") return machine({ squeezed: 0, price: 1, powder: 1 }, out);
    return DECOR[slot](out.thing, out.a, out.b, bottom);
  }

  function spot(index) { // Where Lumi stands beside a plot, as { x, y } in the drawing: its lower left corner.
    const at = tile(index);
    return { x: at.x + 6, y: at.y + TILE_H - 6 };
  }

  function timers(garden, passed) { // What each plot's timer should say now: [index, words] for every growing flower.
    return garden.plots.map(function (plot, index) { return plot.flower && plot.stage === "growing" && plot.ready_in - passed > 0 ? [index, clock(plot.ready_in - passed)] : null; }).filter(Boolean);
  }

  return { scene: scene, bloom: bloom, piece: piece, spot: spot, timers: timers, head: head, SHAPES: Object.keys(BLOOMS), DECOR: Object.keys(DECOR), CANS: CANS, PRESS: { x: 444 + PRESS_X, y: 150 } }; // PRESS: where Lumi stands to work the machine.
});
