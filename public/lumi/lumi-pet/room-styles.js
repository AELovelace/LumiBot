/* The 15 styles of room mode's things (Doll's design, 2026-11-19): the fridge, her food bowl, the kitchen counter, the
   potion shelf, the wardrobe, the terminal, the capsule machine and the paint pots each come in the same 15 "sets"
   (python/make_lumi_room_styles.py writes them into the house catalog: Plain free, five in the Shop, nine from capsules).

   A set is a palette and a motif: Strawberry is pink with seeds, Kitty has ears and a face, Galaxy is deep blue with
   stars, Starlight is gold with crystals. Every thing draws its own shape in the set's colours, with the motif on its
   panels (or, on a small thing, as a little emblem). Plain is each thing's own first look.

   Drawn in the room's 1000 x 500 coordinates, where room-art.js places each thing. Every piece is also added to
   house.js's ART (as "<thing>-<set>", in house.js's 400 x 500 block), so the Collection and the Home menu's pictures
   show it like any other piece of her furniture. All authored here: nothing a person typed goes into it. */
(function (root, make) {
  const node = typeof module === "object" && module.exports;
  const styles = make(node ? require("./house.js") : root.LumiPetHouse);
  if (node) module.exports = styles; else root.LumiPetRoomStyles = styles;
})(typeof self !== "undefined" ? self : this, function (House) {
  "use strict";

  const GLOW = "var(--pet-glow)", LINE = "#5a3a6e", INK = "#2a1838";
  const OUT = 'stroke="' + LINE + '" stroke-width="3"';

  // ---- Small drawing helpers (house.js's shapes).
  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function path(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function group(inner, more) { return "<g " + (more || "") + ">" + inner + "</g>"; }
  function shadow(x, y, rx) { return oval(x, y, rx, 9, "#000", 'opacity=".22"'); }
  function star(x, y, r) { // A four-pointed sparkle, like the one on Lumi's forehead.
    const s = r * 0.3;
    return "M" + x + " " + (y - r) + " L" + (x + s) + " " + (y - s) + " L" + (x + r) + " " + y + " L" + (x + s) + " " + (y + s) + " L" + x + " " + (y + r) +
      " L" + (x - s) + " " + (y + s) + " L" + (x - r) + " " + y + " L" + (x - s) + " " + (y - s) + "Z";
  }
  function heart(x, y, r) { return "M" + x + " " + (y + r) + " C" + (x - r * 1.6) + " " + (y - r * .2) + " " + (x - r * .6) + " " + (y - r * 1.4) + " " + x + " " + (y - r * .4) +
    " C" + (x + r * .6) + " " + (y - r * 1.4) + " " + (x + r * 1.6) + " " + (y - r * .2) + " " + x + " " + (y + r) + "Z"; }

  // ---- The 15 sets, in the catalog's order. body/dark/trim/accent colour a thing; trio colours bottles, paints and
  // capsules; motif is drawn on its panels. Plain (null colours) keeps each thing's own first look.
  const SETS = [
    { id: "plain", name: "Plain", motif: "none" },
    { id: "mint", name: "Mint retro", body: "#bff0dc", dark: "#5fb894", trim: "#ffffff", accent: "#3ea57d", trio: ["#7fe0b8", "#fff3b0", "#ff9ab5"], motif: "chrome" },
    { id: "strawberry", name: "Strawberry", body: "#ff9fb6", dark: "#d9506f", trim: "#fff2a8", accent: "#5fbf6a", trio: ["#ff6b8b", "#ffd1dc", "#8be9a8"], motif: "seeds" },
    { id: "wood", name: "Woodland", body: "#c8955f", dark: "#8a5a3b", trim: "#a8743f", accent: "#ffdc83", trio: ["#d98f3a", "#8be9a8", "#c9a8ff"], motif: "wood" },
    { id: "stripes", name: "Candy stripe", body: "#ffffff", dark: "#d9506f", trim: "#ff8ecb", accent: "#ff4f8b", trio: ["#ff8ecb", "#ffffff", "#ff4f8b"], motif: "stripes" },
    { id: "chrome", name: "Chrome", body: "#d8dee8", dark: "#8a94a6", trim: "#ffffff", accent: "#70ebea", trio: ["#c0c8d4", "#70ebea", "#ffffff"], motif: "chrome" },
    { id: "gingham", name: "Berry gingham", body: "#fff0f4", dark: "#c2416b", trim: "#e05b84", accent: "#e05b84", trio: ["#e05b84", "#c9a8ff", "#ff9ab5"], motif: "checks" },
    { id: "sprout", name: "Sprout", body: "#dff5c8", dark: "#6fae4f", trim: "#8fd46a", accent: "#4f9a38", trio: ["#8fd46a", "#fff3b0", "#c8e6a0"], motif: "leaves" },
    { id: "bubble", name: "Bubblegum", body: "#ffc7ea", dark: "#d26aa8", trim: "#ffffff", accent: "#ff6fc0", trio: ["#ff6fc0", "#a8e6ff", "#fff3b0"], motif: "bubbles" },
    { id: "kitty", name: "Kitty", body: "#fbe3f0", dark: "#b8569f", trim: "#ffb3d1", accent: "#ff8ecb", trio: ["#ff8ecb", "#ffdc83", "#c9a8ff"], motif: "kitty" },
    { id: "frosting", name: "Frosted", body: "#f6d7b0", dark: "#b07d4a", trim: "#ffffff", accent: "#ff8ecb", trio: ["#ff8ecb", "#ffffff", "#a8e6ff"], motif: "frosting" },
    { id: "neon", name: "Neon grid", body: "#1b1530", dark: "#0b0818", trim: "#70ebea", accent: "#ff2e97", trio: ["#ff2e97", "#70ebea", "#c9a8ff"], motif: "neon" },
    { id: "holo", name: "Holographic", body: "#e8e0ff", dark: "#9a8cd6", trim: "#ffffff", accent: "#70ebea", trio: ["#ffb3e6", "#b3f0ff", "#fff3b0"], motif: "holo" },
    { id: "galaxy", name: "Galaxy", body: "#2a1b52", dark: "#140d2e", trim: "#c9a8ff", accent: "#8f9bff", trio: ["#8f9bff", "#ff8ecb", "#c9a8ff"], motif: "galaxy" },
    { id: "starlight", name: "Starlight", body: "#fff6d8", dark: "#c9a24b", trim: "#ffdc83", accent: "#ffd34d", trio: ["#ffdc83", "#ffffff", "#ffb84d"], motif: "starlight" },
  ];
  const BY_ID = {};
  SETS.forEach(function (set) { BY_ID[set.id] = set; });

  function dice(seed) { // The same "random" every draw, so a motif never reshuffles.
    let value = seed;
    return function (low, high) { value = (value * 16807) % 2147483647; return Math.round((low + (value / 2147483647) * (high - low)) * 10) / 10; };
  }

  // ---- Motifs: drawn inside a panel [x, y, w, h], never past its edges.
  function motif(st, x, y, w, h, seed) {
    const roll = dice(seed || 7), m = st.motif;
    let out = "";
    if (m === "chrome") { // Two soft highlights down the panel, like polished metal.
      out += rect(x + w * .14, y + 4, Math.max(3, w * .08), h - 8, "#ffffff", 'opacity=".55" rx="2"') + rect(x + w * .28, y + 4, Math.max(2, w * .04), h - 8, "#ffffff", 'opacity=".35" rx="2"');
    } else if (m === "seeds") { // Strawberry seeds in neat staggered rows.
      for (let row = 0, yy = y + 9; yy < y + h - 5; row++, yy += 14) for (let xx = x + 8 + (row % 2) * 7; xx < x + w - 5; xx += 14) out += oval(xx, yy, 2, 3.2, st.trim);
    } else if (m === "wood") { // Wood grain: gentle wavy lines and a knot.
      for (let yy = y + 10; yy < y + h - 4; yy += 12) out += path("M" + (x + 3) + " " + yy + " q" + (w / 4) + " -4 " + (w / 2) + " 0 t" + (w / 2 - 6) + " 0", "none", 'stroke="' + st.dark + '" stroke-width="1.6" opacity=".55"');
      out += oval(x + w * .65, y + h * .45, 5, 3, "none", 'stroke="' + st.dark + '" stroke-width="1.6" opacity=".6"');
    } else if (m === "stripes") { // Candy stripes.
      for (let xx = x + 4; xx < x + w - 4; xx += 14) out += rect(xx, y + 2, Math.min(7, x + w - 2 - xx), h - 4, st.trim, 'opacity=".85"');
    } else if (m === "checks") { // Gingham: see-through squares, darker where they cross.
      for (let xx = x + 2; xx < x + w - 2; xx += 16) out += rect(xx, y + 2, Math.min(8, x + w - 2 - xx), h - 4, st.trim, 'opacity=".35"');
      for (let yy = y + 2; yy < y + h - 2; yy += 16) out += rect(x + 2, yy, w - 4, Math.min(8, y + h - 2 - yy), st.trim, 'opacity=".35"');
    } else if (m === "leaves") { // Little sprouting leaves, scattered.
      for (let i = 0; i < Math.max(3, Math.round(w * h / 900)); i++) {
        const lx = roll(x + 8, x + w - 8), ly = roll(y + 8, y + h - 8);
        out += oval(lx, ly, 5, 2.6, st.trim, 'transform="rotate(' + roll(-50, 50) + " " + lx + " " + ly + ')"');
      }
    } else if (m === "bubbles") { // Bubbles, some with a shine.
      for (let i = 0; i < Math.max(3, Math.round(w * h / 1100)); i++) {
        const bx = roll(x + 9, x + w - 9), by = roll(y + 9, y + h - 9), r = roll(3, 7);
        out += circle(bx, by, r, "none", 'stroke="' + st.trim + '" stroke-width="1.8" opacity=".9"') + circle(bx - r * .35, by - r * .35, r * .25, st.trim);
      }
    } else if (m === "kitty") { // A sleepy kitty face in the middle of the panel.
      const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) / 60;
      out += path("M" + (cx - 14 * s) + " " + cy + " q" + 5 * s + " " + 5 * s + " " + 10 * s + " 0 M" + (cx + 4 * s) + " " + cy + " q" + 5 * s + " " + 5 * s + " " + 10 * s + " 0", "none", 'stroke="' + st.dark + '" stroke-width="' + 2.2 * s + '" stroke-linecap="round"') +
        oval(cx - 16 * s, cy + 8 * s, 5 * s, 3 * s, st.trim) + oval(cx + 16 * s, cy + 8 * s, 5 * s, 3 * s, st.trim) +
        path("M" + (cx - 3 * s) + " " + (cy + 7 * s) + " q" + 3 * s + " " + 3 * s + " " + 6 * s + " 0", "none", 'stroke="' + st.dark + '" stroke-width="' + 1.8 * s + '"');
    } else if (m === "frosting") { // Icing poured over the top, dripping down, with sprinkles.
      let drip = "M" + x + " " + y + " H" + (x + w) + " V" + (y + h * .22);
      for (let xx = x + w; xx > x; xx -= 16) drip += " q-4 " + (8 + roll(0, 10)) + " -8 0 q-4 -6 -8 0";
      out += path(drip + " V" + y + " Z", st.trim);
      for (let i = 0; i < Math.round(w / 9); i++) out += rect(roll(x + 4, x + w - 6), roll(y + h * .35, y + h - 6), 4, 1.6, SETS[1 + (i % 4)].trio[0], 'rx=".8"');
    } else if (m === "neon") { // A glowing grid.
      for (let xx = x + 10; xx < x + w - 2; xx += 14) out += path("M" + xx + " " + (y + 2) + " V" + (y + h - 2), "none", 'stroke="' + st.trim + '" stroke-width="1" opacity=".55"');
      for (let yy = y + 10; yy < y + h - 2; yy += 14) out += path("M" + (x + 2) + " " + yy + " H" + (x + w - 2), "none", 'stroke="' + st.accent + '" stroke-width="1" opacity=".55"');
    } else if (m === "holo") { // Shimmering bands of pink, blue and yellow.
      for (let yy = y + 2, i = 0; yy < y + h - 2; yy += 12, i++) out += rect(x + 2, yy, w - 4, Math.min(8, y + h - 2 - yy), st.trio[i % 3], 'opacity=".55"');
    } else if (m === "galaxy") { // Stars and a faint swirl of nebula.
      out += oval(x + w * .55, y + h * .45, w * .32, h * .18, st.accent, 'opacity=".25" transform="rotate(-20 ' + (x + w * .55) + " " + (y + h * .45) + ')"');
      for (let i = 0; i < Math.max(5, Math.round(w * h / 500)); i++) out += circle(roll(x + 4, x + w - 4), roll(y + 4, y + h - 4), roll(.6, 1.6), "#ffffff", 'opacity="' + roll(.5, 1) + '"');
      out += path(star(x + w * .3, y + h * .3, Math.min(6, w * .1)), "#ffffff");
    } else if (m === "starlight") { // Golden sparkles.
      for (let i = 0; i < Math.max(3, Math.round(w * h / 1400)); i++) out += path(star(roll(x + 8, x + w - 8), roll(y + 8, y + h - 8), roll(3, 6)), st.dark, 'opacity=".85"');
    }
    return out;
  }

  function emblem(st, x, y, r) { // A small thing's motif: one little badge (a bowl or a paint pot has no room for a pattern).
    const m = st.motif;
    if (m === "none") return "";
    if (m === "kitty") return path("M" + (x - r) + " " + (y - r * .2) + " L" + (x - r * .6) + " " + (y - r) + " L" + (x - r * .2) + " " + (y - r * .5) + " L" + (x + r * .2) + " " + (y - r * .5) +
      " L" + (x + r * .6) + " " + (y - r) + " L" + (x + r) + " " + (y - r * .2) + " Q" + x + " " + (y + r * 1.1) + " " + (x - r) + " " + (y - r * .2) + "Z", st.accent);
    if (m === "seeds" || m === "frosting") return path(heart(x, y, r * .8), st.accent);
    if (m === "galaxy" || m === "starlight" || m === "neon" || m === "holo") return path(star(x, y, r), m === "galaxy" ? "#ffffff" : st.accent);
    if (m === "leaves") return oval(x - r * .4, y, r * .8, r * .4, st.accent, 'transform="rotate(-30 ' + x + " " + y + ')"') + oval(x + r * .4, y, r * .8, r * .4, st.accent, 'transform="rotate(30 ' + x + " " + y + ')"');
    return circle(x, y, r * .6, st.accent);
  }

  function ears(st, left, right, top) { // Kitty: two pointed ears on a thing's top edge.
    if (st.motif !== "kitty") return "";
    return path("M" + left + " " + top + " l8 -18 l10 18 Z M" + right + " " + top + " l-8 -18 l-10 18 Z", st.body, OUT) +
      path("M" + (left + 5) + " " + (top - 2) + " l3 -8 l5 8 Z M" + (right - 5) + " " + (top - 2) + " l-3 -8 l-5 8 Z", st.trim);
  }

  function crown(st, left, right, top) { // Starlight: a row of little crystals on the top edge.
    if (st.motif !== "starlight") return "";
    let out = "";
    for (let x = left + 10; x < right - 6; x += 18) out += path("M" + (x - 5) + " " + top + " L" + x + " " + (top - 14) + " L" + (x + 5) + " " + top + " Z", "#fff3b0", 'stroke="' + st.dark + '" stroke-width="1.5"');
    return out;
  }

  // ---- The things. Each takes a style (a set, or its own Plain colours) and draws itself where room-art.js expects.
  const PLAIN = { // Each thing's own first look (what room-art.js drew before there were styles).
    fridge: { body: "#e9eef7", dark: LINE, trim: "#ffffff", accent: GLOW, trio: ["#ff8ecb", "#ffdc83", "#70ebea"] },
    bowl: { body: "#ffffff", dark: LINE, trim: "#f5c26b", accent: GLOW, trio: ["#f5c26b", "#d98f3a", "#e8a650"] },
    counter: { body: "#8c5f86", dark: "#6e4468", trim: "#b98aa9", accent: GLOW, trio: ["#ff9d6b", "#8be9a8", "#ffffff"] },
    potions: { body: "#8a5a3b", dark: INK, trim: "#c79a6b", accent: GLOW, trio: ["#ff6b8b", "#70ebea", "#8be9a8"] },
    wardrobe: { body: "#a8789f", dark: "#8c5f86", trim: "#c39abc", accent: "#ff8ecb", trio: ["#ff8ecb", "#ffdc83", "#70ebea"] },
    terminal: { body: INK, dark: "#3b2a4d", trim: "#5d4a72", accent: GLOW, trio: ["#ffdc83", "#70ebea", "#ff8ecb"] },
    capsules: { body: "#e0455f", dark: INK, trim: "#f6f6f6", accent: GLOW, trio: ["#ff8ecb", "#70ebea", "#ffdc83"] },
    paints: { body: "#dfe4f0", dark: LINE, trim: "#ff8ecb", accent: GLOW, trio: ["#ff8ecb", "#c79a6b", "#ffffff"] },
  };

  function style(thing, setId) { // A thing's colours and motif in a set (Plain, or an unknown set: its own look).
    const set = BY_ID[setId] || SETS[0];
    return set.id === "plain" ? Object.assign({ motif: "none", id: "plain" }, PLAIN[thing]) : set;
  }

  const DRAW = {
    fridge: function (st) { // A tall rounded fridge, freezer above, handles, magnets and a shopping list. Opens the Pantry.
      return shadow(380, 472, 62) + rect(328, 222, 104, 250, st.body, 'rx="16" ' + OUT) +
        motif(st, 334, 228, 92, 66, 11) + motif(st, 334, 306, 92, 158, 12) +
        path("M328 300 H432", "none", 'stroke="' + LINE + '" stroke-width="3"') +
        rect(414, 244, 7, 38, st.accent, 'rx="3"') + rect(414, 318, 7, 70, st.accent, 'rx="3"') +
        circle(352, 330, 7, st.trio[0]) + rect(366, 344, 16, 12, st.trio[1], 'rx="2"') + path("M348 360 l6 -10 l6 10 z", st.trio[2]) +
        rect(344, 236, 40, 30, "#fff", 'rx="3" opacity=".9"') + path("M350 246 H378 M350 254 H372", "none", 'stroke="#c9a8ff" stroke-width="2"') +
        ears(st, 338, 422, 224) + crown(st, 330, 430, 224);
    },
    bowl: function (st) { // Her food bowl on a mat, always a little full: the free snacks.
      return rect(458, 452, 84, 14, st.accent, 'rx="7" opacity=".55"') +
        path("M466 432 Q500 470 534 432 Z", st.body, OUT) + path("M470 436 Q500 448 530 436", "none", 'stroke="' + st.dark + '" stroke-width="2" opacity=".5"') +
        oval(500, 433, 34, 7, "#f5c26b") + circle(490, 430, 4, "#d98f3a") + circle(506, 429, 4, "#d98f3a") + circle(498, 426, 3.5, "#e8a650") +
        (st.motif === "none" ? path("M484 446 L488 440 L492 446 L488 452 Z", st.accent) : emblem(st, 500, 450, 6)) + ears(st, 470, 530, 434);
    },
    counter: function (st) { // A low kitchen counter with fruit and a mug: it makes the kitchen read as one.
      return rect(440, 360, 120, 18, st.trim, 'rx="4" ' + OUT) + rect(446, 378, 108, 40, st.body, OUT) + motif(st, 450, 381, 100, 34, 21) +
        path("M500 380 V416", "none", 'stroke="' + LINE + '" stroke-width="2"') + circle(492, 398, 2.5, st.accent) + circle(508, 398, 2.5, st.accent) +
        circle(470, 352, 9, st.trio[0]) + circle(486, 350, 7, st.trio[1]) + rect(512, 338, 26, 22, st.trio[2], 'rx="4" ' + OUT) + crown(st, 440, 560, 360);
    },
    potions: function (st) { // A wall shelf of three potions under a little glowing cross. Drinking one mends her.
      const bottle = function (x, colour, tall) {
        const top = 300 - tall;
        return rect(x - 5, top - 8, 10, 8, "#c79a6b", 'rx="2"') + rect(x - 4, top, 8, 14, "#dfe9ff", 'opacity=".8"') +
          circle(x, top + 28, 15, colour, OUT + ' opacity=".9"') + circle(x - 5, top + 23, 4, "#fff", 'opacity=".7"');
      };
      return rect(568, 300, 104, 10, st.body, 'rx="3" ' + OUT) + motif(st, 572, 302, 96, 6, 31) +
        path("M580 310 L590 330 M660 310 L650 330", "none", 'stroke="' + LINE + '" stroke-width="4"') +
        bottle(592, st.trio[0], 40) + bottle(620, st.trio[1], 52) + bottle(648, st.trio[2], 38) +
        rect(600, 188, 40, 40, st.dark, 'rx="8" opacity=".9"') +
        (st.motif === "none" || st.motif === "chrome" ? group(path("M620 196 V220 M608 208 H632", "none", 'stroke="' + st.accent + '" stroke-width="6" stroke-linecap="round"'), 'class="lp-tw-glow"')
          : group(emblem(st, 620, 208, 12), 'class="lp-tw-glow"')) + ears(st, 602, 638, 190);
    },
    wardrobe: function (st) { // A tall wardrobe, one door ajar with a dress peeking out. Opens the Closet.
      return shadow(370, 473, 72) + rect(310, 212, 120, 260, st.body, 'rx="10" ' + OUT) + rect(304, 204, 132, 16, st.dark, 'rx="6" ' + OUT) +
        rect(320, 226, 48, 230, st.trim, 'rx="5" ' + OUT) + motif(st, 324, 230, 40, 222, 41) +
        path("M372 226 L420 236 V448 L372 456 Z", st.trim, OUT) +
        path("M374 250 Q392 236 410 250", "none", 'stroke="#ddd" stroke-width="3"') + path("M378 252 L404 252 L414 330 L368 330 Z", st.accent, OUT) + circle(391, 290, 4, st.trio[1]) +
        circle(360, 340, 5, GLOW) + circle(380, 345, 5, GLOW) + ears(st, 314, 426, 206) + crown(st, 304, 436, 206);
    },
    terminal: function (st) { // A desk terminal with a glowing screen of settings, a keyboard and a mug. Opens Settings.
      return shadow(500, 472, 70) + rect(440, 380, 120, 12, st.dark, 'rx="3" ' + OUT) + rect(448, 392, 10, 80, st.dark, OUT) + rect(542, 392, 10, 80, st.dark, OUT) +
        rect(456, 296, 88, 66, st.body, 'rx="8" ' + OUT) + rect(464, 304, 72, 50, "#0b1030", 'rx="4"') +
        group(path("M470 314 H500 M470 324 H520 M470 334 H492 M470 344 H512", "none", 'stroke="' + st.accent + '" stroke-width="3" stroke-linecap="round"') + rect(516, 340, 8, 6, st.trio[1]), 'class="lp-tw-glow"') +
        rect(494, 362, 12, 18, st.body) + rect(468, 370, 64, 8, st.trim, 'rx="2"') + rect(536, 362, 14, 18, st.trio[0], 'rx="3" ' + OUT) +
        emblem(st, 536, 300, 6) + ears(st, 460, 540, 298) + crown(st, 456, 544, 298);
    },
    capsules: function (st) { // A capsule machine: a dome of capsules on a stand, a big handle, a chute. Opens the Shop.
      let balls = "";
      [[612, 300, 0], [636, 296, 1], [624, 318, 2], [648, 316, 0], [604, 322, 1], [660, 302, 2]].forEach(function (b) {
        balls += circle(b[0], b[1], 10, st.trio[b[2]], 'stroke="' + LINE + '" stroke-width="2"') + path("M" + (b[0] - 10) + " " + b[1] + " H" + (b[0] + 10), "none", 'stroke="' + LINE + '" stroke-width="1.5"');
      });
      return shadow(630, 473, 54) + circle(632, 305, 46, "#dff6ff", 'opacity=".55" ' + OUT) + balls + circle(614, 286, 9, "#fff", 'opacity=".7"') +
        rect(590, 346, 84, 126, st.body, 'rx="10" ' + OUT) + motif(st, 595, 351, 74, 116, 51) +
        circle(632, 384, 16, st.trim, OUT) + rect(626, 368, 12, 32, "#bbb", 'rx="4"') + rect(612, 420, 40, 26, st.dark, 'rx="5" ' + OUT) + circle(632, 433, 6, st.accent, 'class="lp-tw-glow"') +
        ears(st, 596, 668, 266) + crown(st, 600, 664, 262);
    },
    paints: function (st) { // Two paint pots and a brush: decorating this room.
      return shadow(547, 470, 36) +
        rect(520, 430, 30, 38, st.body, 'rx="4" ' + OUT) + oval(535, 430, 15, 5, st.trio[0]) + path("M528 430 Q530 444 534 446 Q536 438 538 430 Z", st.trio[0]) + emblem(st, 535, 452, 6) +
        rect(552, 440, 26, 28, st.body, 'rx="4" ' + OUT) + oval(565, 440, 13, 4.5, st.motif === "none" ? GLOW : st.accent) +
        path("M560 418 L590 392", "none", 'stroke="#c79a6b" stroke-width="6" stroke-linecap="round"') + path("M556 422 L566 412 L570 424 Z", st.motif === "none" ? GLOW : st.accent, OUT);
    },
  };
  // Where each thing was first drawn, [middle, foot]: the Collection's picture centres it in house.js's 400 x 500 block.
  const FRAME = { fridge: [380, 472], bowl: [500, 466], counter: [500, 418], potions: [620, 330], wardrobe: [370, 472], terminal: [500, 472], capsules: [632, 472], paints: [549, 470] };

  function draw(thing, item) { // A thing's markup in the room's coordinates, in the style of `item` ("fridge-galaxy"), or Plain.
    const setId = typeof item === "string" && item.indexOf(thing + "-") === 0 ? item.slice(thing.length + 1) : "plain";
    return DRAW[thing] ? DRAW[thing](style(thing, setId)) : "";
  }

  // Every piece into house.js's ART, so the Collection and Home's pictures draw it like her other furniture.
  Object.keys(DRAW).forEach(function (thing) {
    SETS.forEach(function (set) {
      House.ART[thing + "-" + set.id] = function () {
        const at = FRAME[thing];
        return group(draw(thing, thing + "-" + set.id), 'transform="translate(' + (200 - at[0]) + " " + (470 - at[1]) + ')"');
      };
    });
  });

  return { SETS: SETS, THINGS: Object.keys(DRAW), draw: draw, style: style };
});
