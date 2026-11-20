/* Lumi Dungeons' lobby (Doll's request, 2026-11-11): the Lantern & Paw, the tavern adventurers set out from. It is
   drawn behind the Dungeon, Battle and Settings lists in place of her apartment (house.js), in the same 1000 x 500
   room, so Lumi stands in the same place: on the rug in the middle, the floor starting at y 350.

   Layout, left to right: the bar and its glowing bottles; the quest board; Lumi under the hanging sign; the hearth;
   a window and a round table. The quest board, sign and hearth sit in the middle strip (x 350-650) that every
   screen shows; the bar and the table are what a wide screen adds at the sides. Plain SVG, all authored here:
   nothing a person typed goes into it. game.css makes the fire flicker and the lanterns breathe (.lp-tv-*). */
(function (root, make) {
  const art = make();
  if (typeof module === "object" && module.exports) module.exports = art; else root.LumiPetTavernArt = art;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NAME = "The Lantern & Paw"; // The tavern's name (the room's label in templates/games/lumi-pet.html says it too).
  const WOOD = "#3b2418", WOOD_DARK = "#24150d", WOOD_LIGHT = "#6a4028", BRASS = "#d8b24a", STONE = "#5a5260", STONE_DARK = "#3e3844";
  const POTIONS = ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff", "#8be9a8", "#ff9d6b"]; // The bottles behind the bar: Lumi's own neon colours.

  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function path(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function line(x1, y1, x2, y2, stroke, width, more) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + width + '" ' + (more || "") + "/>"; }
  function text(x, y, words, size, fill, more) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + words + "</text>"; }
  function group(inner, more) { return "<g " + (more || "") + ">" + inner + "</g>"; }
  function glow(inner) { return group(inner, 'class="lp-tv-glow"'); } // A light that breathes (game.css): the group's opacity moves, the shape keeps its own.
  function dice(seed) { // A steady seeded roll, so the planks and stones are the same on every draw (and every device).
    let value = seed;
    return function (low, high) { value = (value * 16807) % 2147483647; return Math.round((low + (value / 2147483647) * (high - low)) * 10) / 10; };
  }

  function walls() { // Warm wooden planks, a darker wainscot, the ceiling beam and four posts.
    const roll = dice(7);
    let planks = "";
    for (let x = -10; x < 1010; x += 34) planks += rect(x, 26, 34, 280, roll(0, 1) > .5 ? "#43291b" : WOOD) + line(x, 26, x, 306, "#2a1810", 1.2); // One plank, a seam.
    for (let i = 0; i < 26; i++) { const x = roll(0, 1000), y = roll(40, 290); planks += oval(x, y, 3, 1.6, "#2a1810", 'opacity=".6"'); } // Knots in the wood.
    const posts = [70, 330, 670, 930].map(function (x) { return rect(x - 11, 0, 22, 352, WOOD_DARK) + rect(x - 11, 0, 4, 352, "#3a2416"); }).join("");
    return rect(-20, 0, 1040, 352, WOOD) + planks +
      rect(-20, 300, 1040, 52, "#2a1910") + rect(-20, 296, 1040, 7, WOOD_LIGHT) + // The wainscot and its rail.
      rect(-20, 0, 1040, 26, WOOD_DARK) + rect(-20, 22, 1040, 4, "#3a2416") + posts;
  }

  function floor() { // Worn floorboards, and a round rug where Lumi stands.
    const roll = dice(11);
    let seams = "";
    [372, 398, 428, 462].forEach(function (y, row) { // Rows of boards, wider towards the front, their ends staggered.
      seams += line(-20, y, 1020, y, "#2e1b10", 1.4);
      for (let x = roll(0, 90) - 40 + row * 30; x < 1020; x += roll(120, 200)) seams += line(x, y, x, y + (row < 3 ? [26, 30, 34][row] : 40), "#2e1b10", 1.2);
    });
    return rect(-20, 350, 1040, 150, "#4a2c1a") + rect(-20, 350, 1040, 5, "#2a1910") + seams +
      oval(500, 452, 176, 36, "#5a2440") + oval(500, 452, 164, 30, "#7a2f4a") + oval(500, 452, 140, 24, "none", 'stroke="#c9a8ff" stroke-width="2" stroke-dasharray="7 5" opacity=".7"') +
      oval(500, 452, 70, 11, "#ff8ecb", 'opacity=".18"');
  }

  function lantern(x, drop) { // A brass lantern on a chain from the beam, with a soft breathing glow.
    return line(x, 26, x, drop, "#8a7a5a", 1.6, 'stroke-dasharray="3 2"') +
      glow(circle(x, drop + 18, 46, "#ffcf7a", 'opacity=".12"')) +
      path("M" + (x - 10) + " " + drop + " h20 l-3 6 h-14 Z", BRASS) + rect(x - 9, drop + 6, 18, 22, "#ffe6a8", 'rx="2" opacity=".95"') +
      line(x - 3, drop + 6, x - 3, drop + 28, BRASS, 1.4) + line(x + 3, drop + 6, x + 3, drop + 28, BRASS, 1.4) + path("M" + (x - 10) + " " + (drop + 28) + " h20 l-4 6 h-12 Z", BRASS);
  }

  function bar() { // The bar on the left: shelves of glowing bottles, the counter, its taps and mugs, three stools.
    const roll = dice(23);
    let bottles = "";
    [128, 192].forEach(function (shelf, row) { // Two shelves, each with a row of bottles of different shapes.
      bottles += rect(96, shelf, 220, 7, WOOD_LIGHT) + rect(96, shelf + 7, 220, 3, WOOD_DARK);
      for (let x = 106, i = row * 3; x < 306; x += roll(22, 30), i++) {
        const h = roll(22, 38), w = roll(10, 15), c = POTIONS[i % POTIONS.length];
        bottles += oval(x + w / 2, shelf - h / 2, w, h / 1.6, c, 'opacity=".12"') + rect(x, shelf - h, w, h, c, 'rx="3" opacity=".85"') + // The glass and its glow.
          rect(x + w / 2 - 2, shelf - h - 8, 4, 9, c, 'opacity=".85"') + rect(x + w / 2 - 3, shelf - h - 10, 6, 3, "#8a6040") + rect(x + 2, shelf - h + 4, 2, h - 8, "#ffffff", 'opacity=".35"');
      }
    });
    const taps = [130, 160, 190].map(function (x) { return rect(x - 3, 254, 6, 18, BRASS) + rect(x - 7, 250, 14, 6, BRASS, 'rx="2"') + rect(x - 2, 272, 4, 6, "#a8862e"); }).join("");
    const mugs = [[240, "#ffdc83"], [280, "#ff8ecb"]].map(function (m) { // Two mugs on the counter, one frothy.
      return rect(m[0] - 9, 256, 18, 22, "#c8a070", 'rx="2"') + path("M" + (m[0] + 9) + " 260 q8 0 7 8 q-1 6 -7 5", "none", 'stroke="#c8a070" stroke-width="3"') + oval(m[0], 256, 10, 4, m[1] === "#ffdc83" ? "#fff6e0" : m[1]);
    }).join("");
    const stools = [110, 200, 290].map(function (x) { return line(x - 12, 420, x - 16, 470, WOOD_DARK, 4) + line(x + 12, 420, x + 16, 470, WOOD_DARK, 4) + line(x - 14, 448, x + 14, 448, WOOD_DARK, 3) + oval(x, 418, 22, 7, "#8a3a5a") + oval(x, 416, 20, 5, "#a84a6e"); }).join("");
    return text(206, 64, "✦ POTIONS ✦", 13, "#ffdc83", 'font-family="serif" letter-spacing="3" opacity=".85"') + bottles +
      rect(50, 274, 282, 14, WOOD_LIGHT, 'rx="3"') + rect(56, 288, 270, 98, "#4a2c1a") + // The counter's top and front.
      [74, 162, 250].map(function (x) { return rect(x, 300, 64, 72, "none", 'stroke="#6a4028" stroke-width="3" rx="3"'); }).join("") + taps + mugs + stools;
  }

  function questBoard() { // The quest board left of Lumi: pinned notices and a map with a red X.
    const notes = [[360, 172, -5, 34, 30], [402, 166, 4, 30, 36], [366, 214, 3, 30, 26], [430, 210, -3, 22, 28]].map(function (n, i) {
      const lines = [0, 1, 2].map(function (k) { return line(n[0] + 5, n[1] + 9 + k * 7, n[0] + n[3] - 6 - (k === 2 ? 8 : 0), n[1] + 9 + k * 7, "#8a7a6a", 1.2); }).join("");
      return group(rect(n[0], n[1], n[3], n[4], "#f3e3c8") + lines + circle(n[0] + n[3] / 2, n[1] + 3, 2.6, POTIONS[i]), 'transform="rotate(' + n[2] + " " + (n[0] + n[3] / 2) + " " + (n[1] + n[4] / 2) + ')"');
    }).join("");
    const map = group(rect(400, 208, 28, 34, "#e8d4a8") + path("M404 236 Q410 222 416 226 T424 214", "none", 'stroke="#8a5a3a" stroke-width="1.4" stroke-dasharray="3 2"') +
      path("M420 211 l6 6 M426 211 l-6 6", "none", 'stroke="#e8556a" stroke-width="2.2"'), 'transform="rotate(2 414 225)"');
    return rect(346, 150, 112, 106, "#5a3a24", 'rx="4"') + rect(352, 162, 100, 88, "#b0804e") + rect(372, 144, 60, 16, WOOD_LIGHT, 'rx="2"') +
      text(402, 156, "QUESTS", 10, "#ffe9c8", 'font-family="serif" letter-spacing="2"') + notes + map;
  }

  function sign() { // The tavern's sign over Lumi: a lantern and a paw, hung on two chains from the beam.
    const paw = circle(518, 102, 9, "#ff8ecb") + circle(507, 89, 3.6, "#ff8ecb") + circle(515, 85, 3.6, "#ff8ecb") + circle(523, 85, 3.6, "#ff8ecb") + circle(531, 89, 3.6, "#ff8ecb");
    const lamp = path("M474 82 h16 l-2 5 h-12 Z", BRASS) + rect(475, 87, 14, 18, "#ffe6a8", 'rx="2"') + path("M474 105 h16 l-3 5 h-10 Z", BRASS) + circle(482, 96, 13, "#ffcf7a", 'opacity=".25"');
    return line(452, 26, 452, 72, "#8a7a5a", 1.6, 'stroke-dasharray="3 2"') + line(548, 26, 548, 72, "#8a7a5a", 1.6, 'stroke-dasharray="3 2"') +
      rect(440, 70, 120, 50, WOOD_LIGHT, 'rx="7"') + rect(445, 75, 110, 40, "#8a5434", 'rx="5"') + rect(445, 75, 110, 40, "none", 'stroke="' + BRASS + '" stroke-width="1.5" rx="5"') +
      lamp + text(500, 101, "&amp;", 16, "#ffe9c8", 'font-family="serif"') + paw;
  }

  function hearth() { // The hearth right of Lumi: a stone chimney, the mantel and its things, and a fire that flickers.
    const roll = dice(31);
    let stones = "";
    for (let y = 30, row = 0; y < 350; y += 20, row++) { // Stones in courses, every other one offset.
      const left = y < 160 ? 584 : 556, right = y < 160 ? 690 : 716;
      for (let x = left - (row % 2 ? 14 : 0); x < right; x += roll(24, 34)) stones += rect(Math.max(left, x) + 1, y + 1, Math.min(28, right - Math.max(left, x)) - 2, 18, roll(0, 1) > .5 ? STONE : "#4e4756", 'rx="3"');
    }
    const flames = group(path("M600 350 Q598 316 614 300 Q610 320 626 326 Q622 296 640 276 Q642 304 656 312 Q654 296 664 290 Q676 318 670 350 Z", "#ff7a3a") +
      path("M612 350 Q612 326 626 316 Q626 332 638 334 Q636 312 648 300 Q652 322 660 330 Q664 340 658 350 Z", "#ffb347") +
      path("M624 350 Q626 334 636 328 Q638 340 646 338 Q650 344 648 350 Z", "#ffe6a8"), 'class="lp-tv-fire"');
    const logs = rect(598, 344, 76, 9, "#5a3420", 'rx="4"') + rect(606, 338, 60, 8, "#6e4228", 'rx="4" transform="rotate(-6 636 342)"');
    const shield = path("M612 64 h46 v26 q0 24 -23 34 q-23 -10 -23 -34 Z", "#7a2f4a", 'stroke="' + BRASS + '" stroke-width="3"') +
      circle(635, 96, 7, "#ffdc83") + circle(626, 85, 3, "#ffdc83") + circle(632, 81, 3, "#ffdc83") + circle(638, 81, 3, "#ffdc83") + circle(644, 85, 3, "#ffdc83"); // Lumi's paw on the shield.
    const mantel = rect(548, 156, 176, 12, WOOD_LIGHT, 'rx="2"') + rect(552, 168, 168, 5, WOOD_DARK) +
      rect(566, 132, 8, 24, "#f3e3c8") + glow(path("M570 126 q4 4 0 8 q-4 -4 0 -8Z", "#ffdc83")) + // A candle.
      rect(700, 136, 8, 20, "#f3e3c8") + glow(path("M704 130 q4 4 0 8 q-4 -4 0 -8Z", "#ffdc83")) +
      path("M622 156 l4 -18 h18 l4 18 Z", BRASS) + oval(635, 136, 12, 4, "#e8c86a") + rect(631, 128, 8, 8, BRASS) + // A little trophy cup.
      oval(676, 148, 10, 8, "#70ebea", 'opacity=".85"') + rect(673, 136, 6, 6, "#70ebea", 'opacity=".85"'); // A potion someone left.
    return glow(oval(636, 380, 150, 30, "#ffb060", 'opacity=".16"')) + stones +
      path("M586 350 V262 Q636 214 686 262 V350 Z", "#160c08") + path("M586 350 V262 Q636 214 686 262", "none", 'stroke="' + STONE_DARK + '" stroke-width="6"') +
      logs + flames + rect(574, 346, 124, 8, STONE_DARK, 'rx="2"') + shield + mantel;
  }

  function window_(night) { // A window on the far right: stars and the moon at night, a blue day with a cloud by day.
    const sky = night ? "#141a3a" : "#8fc8ff";
    const outside = night ? circle(842, 136, 13, "#fff6d8") + circle(848, 132, 11, sky) + [[796, 124], [818, 168], [866, 176], [880, 128], [804, 196]].map(function (s) { return circle(s[0], s[1], 1.6, "#ffffff"); }).join("")
      : oval(820, 150, 22, 9, "#ffffff", 'opacity=".9"') + oval(838, 144, 16, 9, "#ffffff", 'opacity=".9"') + circle(868, 128, 12, "#fff3b0");
    return rect(774, 104, 116, 124, WOOD_DARK, 'rx="4"') + rect(782, 112, 100, 108, sky) + outside +
      line(832, 112, 832, 220, WOOD_DARK, 5) + line(782, 166, 882, 166, WOOD_DARK, 5) + rect(768, 226, 128, 10, WOOD_LIGHT, 'rx="2"') +
      (night ? "" : path("M782 220 L882 220 L940 360 L700 360 Z", "#fff3c8", 'opacity=".07"')); // By day, a soft shaft of light on the floor.
  }

  function table() { // A round table on the right, two mugs, a candle and a pair of dice, and a chair.
    const chair = line(930, 392, 930, 470, WOOD_DARK, 5) + line(960, 392, 962, 470, WOOD_DARK, 5) + rect(924, 386, 44, 10, "#5a3420", 'rx="3"') + rect(956, 320, 8, 74, "#5a3420") + rect(930, 324, 34, 8, "#5a3420", 'rx="2"');
    return chair + line(840, 386, 840, 458, WOOD_DARK, 10) + oval(840, 462, 30, 7, WOOD_DARK) + oval(840, 380, 66, 15, "#6e4228") + oval(840, 377, 66, 14, WOOD_LIGHT) +
      rect(808, 356, 14, 18, "#c8a070", 'rx="2"') + oval(815, 356, 8, 3, "#fff6e0") + rect(860, 358, 14, 16, "#c8a070", 'rx="2"') + oval(867, 358, 8, 3, "#ff8ecb") +
      rect(836, 352, 7, 18, "#f3e3c8") + glow(path("M839.5 346 q4 4 0 8 q-4 -4 0 -8Z", "#ffdc83")) +
      rect(882, 368, 9, 9, "#fff", 'rx="2" transform="rotate(12 886 372)"') + circle(886.5, 372.5, 1.3, "#2a1a3e") + rect(893, 370, 9, 9, "#fff", 'rx="2" transform="rotate(-8 897 374)"') + circle(895, 372, 1.1, "#2a1a3e") + circle(899, 376, 1.1, "#2a1a3e");
  }

  function barrels() { // A stack of barrels at the far left, under the bar's end.
    function barrel(x, y) { return oval(x, y, 26, 34, "#6e4228") + line(x - 26, y - 14, x + 26, y - 14, "#8a7a5a", 3) + line(x - 26, y + 14, x + 26, y + 14, "#8a7a5a", 3) + oval(x, y, 8, 10, "#5a3420", 'opacity=".6"'); }
    return barrel(24, 440) + barrel(24, 372);
  }

  function scene(opts) { // The whole tavern as SVG markup. opts.night: the window shows stars and the lanterns glow brighter.
    const night = Boolean(opts && opts.night);
    return group(walls() + window_(night) + floor() + bar() + barrels() + questBoard() + table() +
      (night ? rect(-20, 0, 1040, 500, "#0a0620", 'opacity=".22"') : "") + // Night dims the room a little, under the fire, the sign and the lanterns, which stay bright.
      hearth() + sign() + lantern(30, 52) + lantern(760, 46),
      'data-tavern="' + (night ? "night" : "day") + '"');
  }

  return { NAME: NAME, scene: scene };
});
