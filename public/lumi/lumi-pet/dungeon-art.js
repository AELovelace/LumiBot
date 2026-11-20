/* The art for Lumi's dungeon: one backdrop per environment, the doorways of the room she is in, what stands in it,
   the puzzle or game she is playing, and a small map of where she has been. Plain SVG in the same 1000 x 500 room as
   her house (house.js), so she stands in the same place.

   The server's catalog (mnemerynne/lumipet_data/dungeon.json) names the environments and their colours; this file
   only knows how each looks. Every environment needs a motif here (tests/js/lumi_dungeon.test.mjs checks). Colours
   come from the server, which only accepts "#rrggbb"; everything else is authored here, never typed by a person. */
(function (root, make) {
  const art = make();
  if (typeof module === "object" && module.exports) module.exports = art; else root.LumiPetDungeonArt = art;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const INK = "#0d0a1a", RUNE = { sun: "☀", moon: "☾", star: "★", leaf: "❧", wave: "≈" };
  const KIND_COLOUR = { start: "#8be9a8", empty: "#8a86a8", enemy: "#ff7a8a", treasure: "#ffdc83", key: "#ffdc83", vault: "#c9a8ff", game: "#70ebea", stairs: "#ff9d6b", unknown: "#3a3550" };

  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function oval(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function path(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function text(x, y, words, size, fill, more) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + words + "</text>"; }
  function group(inner, more) { return "<g " + (more || "") + ">" + inner + "</g>"; }
  function star(x, y, r) {
    const s = r * 0.3;
    return "M" + x + " " + (y - r) + " L" + (x + s) + " " + (y - s) + " L" + (x + r) + " " + y + " L" + (x + s) + " " + (y + s) + " L" + x + " " + (y + r) +
      " L" + (x - s) + " " + (y + s) + " L" + (x - r) + " " + y + " L" + (x - s) + " " + (y - s) + "Z";
  }
  function across(seed, gap, draw) { // Call draw(x, roll, i) at intervals across the whole width, with a steady seeded dice.
    let value = seed, out = "";
    function roll(low, high) { value = (value * 16807) % 2147483647; return Math.round((low + (value / 2147483647) * (high - low)) * 10) / 10; }
    for (let x = -80, i = 0; x < 1100; x += gap, i++) out += draw(x + roll(0, gap * .3), roll, i);
    return out;
  }
  function safe(colour) { return /^#[0-9a-f]{6}$/.test(colour) ? colour : "#888888"; }

  // ---- What makes each environment look like itself, drawn over a plain wall and floor in its colours (p).
  const MOTIF = {
    "moonlit-shrine": function (p) { return circle(820, 90, 46, p.accent, 'opacity=".5"') + path("M0 70 Q500 110 1000 70", "none", 'stroke="' + p.accent + '" stroke-opacity=".35" stroke-width="1.5"') +
      across(3, 120, function (x, roll) { const y = roll(92, 108); return oval(x, y + 14, 22, 26, p.glow, 'opacity=".12"') + oval(x, y + 14, 11, 15, p.glow, 'opacity=".9"') + rect(x - 6, y - 3, 12, 3, INK) + rect(x - 6, y + 28, 12, 3, INK); }); },
    "crystal-cavern": function (p) { return across(5, 70, function (x, roll, i) { const h = roll(40, 120), c = i % 2 ? p.accent : p.glow; return path("M" + (x - 16) + " 352 L" + (x - 4) + " " + (352 - h * .7) + " L" + x + " " + (352 - h) + " L" + (x + 9) + " " + (352 - h * .6) + " L" + (x + 18) + " 352 Z", c, 'opacity=".55"'); }) +
      across(6, 150, function (x, roll) { const h = roll(30, 80); return path("M" + (x - 12) + " 0 L" + x + " " + h + " L" + (x + 12) + " 0 Z", p.accent, 'opacity=".3"'); }); },
    "mushroom-hollow": function (p) { return across(7, 110, function (x, roll, i) { const h = roll(50, 130), w = h * .55, c = i % 3 ? p.accent : p.glow; return rect(x - 5, 352 - h, 10, h, "#fff1e0", 'opacity=".8"') + path("M" + (x - w) + " " + (352 - h) + " Q" + x + " " + (352 - h - w * 1.3) + " " + (x + w) + " " + (352 - h) + " Z", c, 'opacity=".85"') + circle(x - w * .4, 352 - h - w * .35, 4, "#fff", 'opacity=".7"') + circle(x + w * .3, 352 - h - w * .2, 3, "#fff", 'opacity=".7"'); }) +
      across(8, 60, function (x, roll) { return circle(x, roll(20, 300), roll(1, 2.5), p.glow, 'opacity=".5" class="lp-twinkle"'); }); },
    "cloud-library": function (p) { let out = ""; [90, 170, 250].forEach(function (y) { out += rect(0, y, 1000, 5, p.accent, 'opacity=".35"'); });
      return out + across(9, 13, function (x, roll, i) { const shelf = [90, 170, 250][i % 3], h = roll(34, 62); return rect(x, shelf - h, 9, h, ["#c85a8e", "#70ebea", "#ffdc83", "#9c73b8", "#7fc49a"][i % 5], 'opacity=".6"'); }) +
        across(10, 260, function (x, roll) { const y = roll(300, 330); return oval(x, y, 60, 14, "#fff", 'opacity=".25"') + oval(x - 26, y - 9, 28, 14, "#fff", 'opacity=".25"') + oval(x + 20, y - 12, 34, 16, "#fff", 'opacity=".25"'); }); },
    "sunken-temple": function (p) { return across(11, 170, function (x) { return rect(x, 40, 44, 312, p.accent, 'opacity=".22"') + rect(x - 8, 40, 60, 14, p.accent, 'opacity=".3"') + rect(x - 8, 338, 60, 14, p.accent, 'opacity=".3"'); }) +
      path("M0 380 q25 -10 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0", "none", 'stroke="' + p.glow + '" stroke-opacity=".4" stroke-width="2"') +
      across(12, 140, function (x, roll) { const y = roll(120, 300); return path("M" + x + " " + y + " q10 -7 18 0 q-8 7 -18 0 Z M" + x + " " + y + " l-8 -5 v10 Z", p.glow, 'opacity=".6"'); }); },
    "clockwork-tower": function (p) { return across(13, 190, function (x, roll, i) { const y = roll(90, 260), r = roll(34, 70); return circle(x, y, r, "none", 'stroke="' + p.accent + '" stroke-opacity=".45" stroke-width="12" stroke-dasharray="14 10"') + circle(x, y, r - 12, "none", 'stroke="' + p.glow + '" stroke-opacity=".35" stroke-width="4"') + circle(x, y, 7, i % 2 ? p.accent : p.glow, 'opacity=".6"'); }) +
      rect(0, 330, 1000, 6, p.accent, 'opacity=".4"'); },
    "candy-catacombs": function (p) { return across(15, 90, function (x, roll, i) { const r = roll(22, 44), c = ["#ffb3d1", "#b9e4ff", "#fff1cd", "#c9a8ff", "#9bd6ae"][i % 5]; return path("M" + (x - r) + " 352 A" + r + " " + r + " 0 0 1 " + (x + r) + " 352 Z", c, 'opacity=".7"') + oval(x - r * .3, 352 - r * .55, r * .2, r * .12, "#fff", 'opacity=".6"'); }) +
      across(16, 44, function (x, roll, i) { return i % 2 ? rect(x, 0, 14, 60, p.accent, 'opacity=".28"') : ""; }) + path("M0 60 q22 26 44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0 t44 0", p.accent, 'opacity=".3"'); },
    "toy-attic": function (p) { return path("M0 0 L500 110 L1000 0 Z", INK, 'opacity=".3"') + path("M0 20 L500 130 M1000 20 L500 130 M250 0 L250 76 M750 0 L750 76", "none", 'stroke="' + p.accent + '" stroke-opacity=".35" stroke-width="8"') +
      across(17, 150, function (x, roll, i) { const s = roll(40, 70); return rect(x, 352 - s, s * 1.2, s, i % 2 ? "#a8743f" : "#c79256", 'opacity=".75"') + path("M" + x + " " + (352 - s * .6) + " h" + (s * 1.2), "none", 'stroke="' + INK + '" stroke-opacity=".3" stroke-width="2"'); }) +
      across(18, 300, function (x, roll) { const y = roll(140, 220); return path("M" + (x - 16) + " " + (y + 34) + " V" + y + " A16 16 0 0 1 " + (x + 16) + " " + y + " V" + (y + 34) + " l-8 -6 l-8 6 l-8 -6 Z", "#fff", 'opacity=".28"') + circle(x - 6, y, 2, INK) + circle(x + 6, y, 2, INK); }); },
    "starship-wreck": function (p) { return across(19, 130, function (x, roll, i) { const y = roll(60, 220); return rect(x, y, 96, 70, "none", 'stroke="' + p.accent + '" stroke-opacity=".4" stroke-width="2" rx="6" transform="rotate(' + roll(-5, 5) + " " + x + " " + y + ')"') + circle(x + 14, y + 14, 3.5, i % 2 ? p.glow : "#ff7a8a", 'class="lp-twinkle" style="animation-delay:' + (i * .31 % 2).toFixed(2) + 's"') + rect(x + 26, y + 11, 50, 5, p.accent, 'opacity=".3"'); }) +
      across(20, 46, function (x, roll) { return path(star(x, roll(8, 50), roll(1.5, 4)), "#fff", 'opacity=".7"'); }) + rect(0, 340, 1000, 4, p.glow, 'opacity=".5"'); },
    "neon-arcade": function (p) { return across(21, 150, function (x, roll, i) { const c = i % 2 ? p.accent : p.glow; return rect(x, 210, 70, 142, INK, 'opacity=".75" rx="4"') + rect(x + 8, 222, 54, 40, c, 'opacity=".5" class="lp-twinkle" style="animation-delay:' + (i * .4 % 2).toFixed(2) + 's"') + rect(x + 14, 276, 14, 6, c) + circle(x + 48, 279, 5, c); }) +
      across(22, 240, function (x, roll, i) { const y = roll(70, 130), c = i % 2 ? p.glow : p.accent; return path("M" + x + " " + y + " h70 l-10 22 h-70 Z", "none", 'stroke="' + c + '" stroke-width="3" class="lp-neon"'); }) +
      across(23, 9, function (x, roll) { const y = roll(0, 340); return path("M" + x + " " + y + " l-2 12", "none", 'stroke="#cfe0ff" stroke-opacity=".3" stroke-width="1"'); }); },
    "data-vault": function (p) { return across(25, 100, function (x, roll, i) { let rack = rect(x, 60, 70, 292, INK, 'opacity=".7" rx="3"'); for (let y = 76; y < 340; y += 22) rack += rect(x + 8, y, 54, 12, p.wall, 'opacity=".9"') + circle(x + 16, y + 6, 2.2, (i + y) % 3 ? p.accent : p.glow, 'class="lp-twinkle" style="animation-delay:' + ((i * 7 + y) % 20 / 10).toFixed(1) + 's"') + rect(x + 26, y + 4, 28, 3, p.accent, 'opacity=".3"'); return rack; }) +
      rect(0, 352, 1000, 3, p.accent, 'opacity=".6"'); },
    "rooftop-garden": function (p) { return across(27, 60, function (x, roll) { const h = roll(60, 190); let tower = rect(x, 352 - h, 46, h, INK, 'opacity=".55"'); for (let y = 352 - h + 10; y < 340; y += 16) tower += rect(x + 8, y, 6, 7, p.glow, 'opacity="' + roll(.15, .7) + '"') + rect(x + 26, y, 6, 7, "#ffdc83", 'opacity="' + roll(.15, .7) + '"'); return tower; }) +
      across(28, 120, function (x, roll, i) { const leaf = i % 2 ? p.accent : "#5fae86"; return rect(x, 322, 60, 30, "#a8743f", 'opacity=".9" rx="3"') + [-20, 0, 20].map(function (a) { return oval(x + 30, 304, 7, 22, leaf, 'transform="rotate(' + a + " " + (x + 30) + ' 326)"'); }).join(""); }); },
  };

  function backdrop(env) { // The room itself, in this environment's colours, with its motif.
    const p = { wall: safe(env.palette.wall), floor: safe(env.palette.floor), accent: safe(env.palette.accent), glow: safe(env.palette.glow) };
    const motif = Object.prototype.hasOwnProperty.call(MOTIF, env.id) ? MOTIF[env.id](p) : "";
    return rect(-100, 0, 1200, 352, p.wall) + oval(500, 330, 520, 200, p.accent, 'opacity=".07"') + motif + rect(-100, 350, 1200, 150, p.floor) + rect(-100, 350, 1200, 3, p.accent, 'opacity=".45"') +
      oval(500, 440, 190, 34, INK, 'opacity=".25"');
  }

  // ---- The ways out of the room she is in. Three doors on the far wall (west, north, east) and a mat for south.
  const DOOR_X = { w: 385, n: 500, e: 615 }; // Kept within the middle of the room, which the side panels never cover.
  function doors(run, palette) {
    const xy = run.at.split(",").map(Number), step = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }, glow = safe(palette.glow);
    return run.room.exits.map(function (way) {
      const to = run.rooms[(xy[0] + step[way][0]) + "," + (xy[1] + step[way][1])] || { kind: "unknown" };
      const known = to.kind !== "unknown", locked = to.kind === "vault" && !to.done, colour = known ? KIND_COLOUR[to.kind] : "#6a648a";
      if (way === "s") return path("M440 478 h120 l14 18 h-148 Z", INK, 'opacity=".7"') + path("M488 484 h24 l-12 10 Z", colour) + text(500, 474, "S", 13, colour, 'font-weight="700"');
      const x = DOOR_X[way];
      return path("M" + (x - 30) + " 352 V230 A30 30 0 0 1 " + (x + 30) + " 230 V352 Z", INK, 'opacity=".85" stroke="' + colour + '" stroke-width="3"') +
        (known && !locked ? oval(x, 300, 18, 40, colour, 'opacity=".14"') : "") +
        (locked ? rect(x - 9, 284, 18, 16, "#ffdc83", 'rx="3"') + path("M" + (x - 5) + " 284 v-6 a5 5 0 0 1 10 0 v6", "none", 'stroke="#ffdc83" stroke-width="3"') : text(x, 302, known ? "" : "?", 26, "#6a648a")) +
        text(x, 196, way.toUpperCase(), 14, colour, 'font-weight="700"') + (known ? "" : circle(x, 214, 2, glow, 'class="lp-twinkle"'));
    }).join("");
  }

  // ---- What stands in the room.
  function chest(x, y, open, gold) {
    return rect(x - 30, y - 22, 60, 30, gold ? "#8a5a2a" : "#a8743f", 'rx="3"') + (open ? path("M" + (x - 30) + " " + (y - 22) + " Q" + x + " " + (y - 52) + " " + (x + 30) + " " + (y - 22) + " L" + (x + 26) + " " + (y - 30) + " Q" + x + " " + (y - 60) + " " + (x - 26) + " " + (y - 30) + " Z", "#c79256") + oval(x, y - 22, 26, 6, gold ? "#ffdc83" : "#3a2147")
      : path("M" + (x - 30) + " " + (y - 22) + " Q" + x + " " + (y - 44) + " " + (x + 30) + " " + (y - 22) + " Z", "#c79256")) + rect(x - 5, y - 20, 10, 11, "#ffdc83", 'rx="2"');
  }
  function feature(run) {
    const room = run.room, x = 606, y = 424;
    if (room.kind === "start") return oval(x, 432, 54, 14, "#8be9a8", 'opacity=".25"') + path("M" + (x - 32) + " 432 L" + x + " 404 L" + (x + 32) + " 432 V448 H" + (x - 32) + " Z", "none", 'stroke="#8be9a8" stroke-width="3" stroke-linejoin="round"') + text(x, 468, "HOME", 11, "#8be9a8", 'font-weight="700" letter-spacing="2"');
    if (room.kind === "stairs") return path("M" + (x - 50) + " " + (y - 30) + " h100 v40 h-100 Z", INK, 'opacity=".8"') + [0, 1, 2, 3].map(function (i) { return rect(x - 44 + i * 10, y - 24 + i * 9, 88 - i * 20, 6, "#ff9d6b", 'opacity="' + (0.9 - i * .2) + '"'); }).join("") + text(x, y + 28, "DOWN", 11, "#ff9d6b", 'font-weight="700" letter-spacing="2"');
    if (room.kind === "treasure") return chest(x, y, room.done, false);
    if (room.kind === "vault") return chest(x, y, room.done, true) + path(star(x + 34, y - 46, 9), "#fff8dc", 'class="lp-twinkle"');
    if (room.kind === "key") return room.done ? "" : oval(x, y - 6, 26, 12, "#ffdc83", 'opacity=".18"') + circle(x - 14, y - 8, 8, "none", 'stroke="#ffdc83" stroke-width="4"') + path("M" + (x - 6) + " " + (y - 8) + " h26 M" + (x + 12) + " " + (y - 8) + " v8 M" + (x + 19) + " " + (y - 8) + " v6", "none", 'stroke="#ffdc83" stroke-width="4" stroke-linecap="round" class="lp-twinkle"'); // Waiting to be picked up; gone once it is.
    if (room.kind === "game" && run.game && run.game.kind === "cups") return [-40, 0, 40].map(function (dx) { return path("M" + (x + dx - 17) + " " + y + " L" + (x + dx - 11) + " " + (y - 36) + " H" + (x + dx + 11) + " L" + (x + dx + 17) + " " + y + " Z", room.done ? "#6a648a" : "#70ebea") + oval(x + dx, y, 17, 4, INK, 'opacity=".4"'); }).join("");
    return "";
  }

  // ---- Puzzles and games, drawn on a panel in the middle of the room.
  function panel(inner, title) { return rect(340, 96, 320, 316, INK, 'opacity=".9" rx="14" stroke="#70ebea" stroke-opacity=".5" stroke-width="2"') + text(500, 122, title, 13, "#70ebea", 'font-weight="700" letter-spacing="2"') + inner; }
  function sokoban(board, focused) {
    const size = Math.min(34, Math.floor(250 / Math.max(board.width, board.height))), ox = 500 - board.width * size / 2, oy = 268 - board.height * size / 2;
    let out = "";
    for (let y = 0; y < board.height; y++) for (let x = 0; x < board.width; x++) {
      const key = x + "," + y, px = ox + x * size, py = oy + y * size;
      out += board.walls[key] ? rect(px, py, size, size, "#4a4470", 'stroke="#2a2548" stroke-width="1"') : rect(px, py, size, size, "#1c1830", 'stroke="#2a2548" stroke-width="1"');
      if (board.goals[key]) out += circle(px + size / 2, py + size / 2, size * .18, "#8be9a8", 'opacity=".9"');
      if (board.crates[key]) out += rect(px + size * .12, py + size * .12, size * .76, size * .76, board.goals[key] ? "#8be9a8" : "#c79256", 'rx="3" stroke="' + INK + '" stroke-opacity=".5" stroke-width="2"') + path("M" + (px + size * .25) + " " + (py + size * .25) + " L" + (px + size * .75) + " " + (py + size * .75) + " M" + (px + size * .75) + " " + (py + size * .25) + " L" + (px + size * .25) + " " + (py + size * .75), "none", 'stroke="' + INK + '" stroke-opacity=".35" stroke-width="2"');
    }
    const lx = ox + board.at[0] * size + size / 2, ly = oy + board.at[1] * size + size / 2, r = size * .3;
    out += path("M" + (lx - r) + " " + (ly - r * .4) + " L" + (lx - r * .8) + " " + (ly - r * 1.4) + " L" + (lx - r * .2) + " " + (ly - r * .8) + " L" + (lx + r * .2) + " " + (ly - r * .8) + " L" + (lx + r * .8) + " " + (ly - r * 1.4) + " L" + (lx + r) + " " + (ly - r * .4) + " Z", "var(--pet-body)") + circle(lx, ly, r, "var(--pet-body)", 'stroke="var(--pet-shadow)" stroke-width="1.5"') + circle(lx - r * .35, ly - r * .1, 1.6, INK) + circle(lx + r * .35, ly - r * .1, 1.6, INK);
    return panel(out, focused ? "PUSH THE CRATES ONTO THE DOTS" : "PAUSED · CHOOSE BELOW");
  }
  function lights(board, focused) {
    const size = board.size, cell = Math.floor(230 / size), ox = 500 - size * cell / 2, oy = 270 - size * cell / 2;
    let out = "";
    board.lamps.forEach(function (lit, i) {
      const x = ox + (i % size) * cell + cell / 2, y = oy + Math.floor(i / size) * cell + cell / 2;
      out += (lit ? circle(x, y, cell * .46, "#ffdc83", 'opacity=".2"') : "") + circle(x, y, cell * .32, lit ? "#ffdc83" : "#2a2548", 'stroke="#4a4470" stroke-width="2"') +
        (focused && i === board.cursor ? circle(x, y, cell * .42, "none", 'stroke="#70ebea" stroke-width="3"') : "");
    });
    return panel(out, focused ? "PUT EVERY LAMP OUT" : "PAUSED · CHOOSE BELOW");
  }
  function runes(lock, guess) {
    let out = "";
    lock.tries.slice(-6).forEach(function (attempt, row) {
      const y = 152 + row * 30;
      attempt.guess.forEach(function (rune, i) { // Each rune lights up by how it did: green and filled, ringed gold, or left dim.
        const mark = attempt.marks ? attempt.marks[i] : "", x = 404 + i * 34;
        if (mark === "right") out += rect(x - 14, y - 13, 28, 26, "#8be9a8", 'rx="6" data-rune="right"');
        if (mark === "near") out += rect(x - 14, y - 13, 28, 26, "none", 'rx="6" stroke="#ffdc83" stroke-width="2" data-rune="near"');
        out += text(x, y + 6, RUNE[rune], 20, mark === "right" ? "#12301c" : mark === "miss" ? "#6f6a8c" : "#f0deff");
      });
      for (let i = 0; i < attempt.exact; i++) out += circle(556 + i * 14, y, 5, "#8be9a8");
      for (let i = 0; i < attempt.near; i++) out += circle(556 + (attempt.exact + i) * 14, y, 5, "none", 'stroke="#ffdc83" stroke-width="2"');
    });
    for (let i = 0; i < lock.slots; i++) out += rect(388 + i * 58, 346, 48, 48, "#1c1830", 'rx="8" stroke="#70ebea" stroke-opacity=".6" stroke-width="2"') + (guess[i] ? text(412 + i * 58, 381, RUNE[guess[i]], 30, "#ffdc83") : "");
    return panel(out + text(500, 338, "green: right place   gold ring: wrong place   dim: not in the code", 10, "#8a86a8"), "FIND THE RUNE CODE");
  }
  function keyDoor(has) { return panel(path("M440 392 V230 A60 60 0 0 1 560 230 V392 Z", "#3d2450", 'stroke="#ffdc83" stroke-width="3"') + circle(500, 300, 14, INK) + path("M494 306 h12 l4 30 h-20 Z", INK) + (has ? path(star(540, 210, 12), "#ffdc83", 'class="lp-twinkle"') : ""), has ? "LUMI HAS THE KEY" : "LOCKED · IT NEEDS A KEY"); }
  function match(game, cursor, focused) {
    let out = "";
    game.cards.forEach(function (card, i) {
      const x = 374 + (i % 4) * 66, y = 160 + Math.floor(i / 4) * 110, found = game.found.indexOf(i) >= 0;
      out += rect(x, y, 54, 92, card ? "#f0deff" : "#3d2450", 'rx="8" opacity="' + (found ? .45 : 1) + '" stroke="' + (focused && i === cursor ? "#70ebea" : "#6a648a") + '" stroke-width="' + (focused && i === cursor ? 4 : 2) + '"') +
        text(x + 27, y + 58, card ? RUNE[card] : "?", card ? 34 : 26, card ? "#3d2450" : "#6a648a");
    });
    return panel(out, focused ? "FIND THE PAIRS · " + game.left + " TURNS LEFT" : "PAUSED · CHOOSE BELOW");
  }

  function map(run) { // Where she has been: a small grid, top right of the middle of the room.
    const cell = 15, ox = 566, oy = 44, step = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
    let out = rect(ox - 6, oy - 6, 5 * cell + 12, 4 * cell + 12, INK, 'opacity=".6" rx="6"');
    Object.keys(run.rooms).forEach(function (key) {
      const xy = key.split(",").map(Number), room = run.rooms[key], x = ox + xy[0] * cell, y = oy + xy[1] * cell;
      (room.exits || []).forEach(function (way) { out += rect(x + cell / 2 - 1.5 + step[way][0] * cell / 2, y + cell / 2 - 1.5 + step[way][1] * cell / 2, 3, 3, "#8a86a8"); });
      out += rect(x + 3, y + 3, cell - 6, cell - 6, KIND_COLOUR[room.kind] || KIND_COLOUR.unknown, 'rx="2" opacity="' + (room.kind === "unknown" ? .7 : room.done ? .55 : 1) + '"');
      if (key === run.at) out += rect(x + 1, y + 1, cell - 2, cell - 2, "none", 'rx="3" stroke="#fff" stroke-width="2"');
    });
    return out;
  }

  // ---- Where a mouse or a finger can press: see-through shapes over the doors, the chest, the cups and each square of a
  // board, each named in data-click for game.js ("way:n", "take", "cup:1", "card:5", "lamp:3", "cell:2,4").
  function press(x, y, w, h, name) { return rect(x, y, w, h, "#000", 'fill-opacity="0" pointer-events="all" data-click="' + name + '"'); }
  function presses(run, play) {
    let out = "";
    if (run.facing) {
      const lock = run.facing.lock, board = play.board;
      if (lock.kind === "sokoban" && board) {
        const size = Math.min(34, Math.floor(250 / Math.max(board.width, board.height))), ox = 500 - board.width * size / 2, oy = 268 - board.height * size / 2;
        for (let y = 0; y < board.height; y++) for (let x = 0; x < board.width; x++) out += press(ox + x * size, oy + y * size, size, size, "cell:" + x + "," + y);
      } else if (lock.kind === "lights" && board) {
        const size = board.size, cell = Math.floor(230 / size), ox = 500 - size * cell / 2, oy = 270 - size * cell / 2;
        board.lamps.forEach(function (lit, i) { out += press(ox + (i % size) * cell, oy + Math.floor(i / size) * cell, cell, cell, "lamp:" + i); });
      }
      return out;
    }
    if (run.game && run.game.kind === "match" && !run.room.done) {
      run.game.cards.forEach(function (card, i) { out += press(374 + (i % 4) * 66, 160 + Math.floor(i / 4) * 110, 54, 92, "card:" + i); });
      return out;
    }
    run.room.exits.forEach(function (way) { out += way === "s" ? press(426, 458, 148, 40, "way:s") : press(DOOR_X[way] - 32, 184, 64, 168, "way:" + way); });
    const room = run.room;
    if (!room.done && (room.kind === "treasure" || room.kind === "vault" || room.kind === "key")) out += press(570, 362, 72, 74, "take");
    if (!room.done && room.kind === "game" && run.game && run.game.kind === "cups") [-40, 0, 40].forEach(function (dx, cup) { out += press(606 + dx - 19, 384, 38, 46, "cup:" + cup); });
    return out;
  }

  function scene(run, play, focus, showPuzzle) { // Everything in the room, back to front. `play` is the puzzle in progress on the page, if any.
    // `showPuzzle` false: leave the puzzle or card panel out (the Dungeon tab isn't open, so nothing could be done with it).
    let middle = "";
    if (showPuzzle === false) middle = "";
    else if (run.facing) {
      const lock = run.facing.lock;
      middle = lock.kind === "sokoban" && play.board ? sokoban(play.board, focus === "board") : lock.kind === "lights" && play.board ? lights(play.board, focus === "board")
        : lock.kind === "runes" ? runes(lock, play.guess || []) : keyDoor(run.satchel.keys > 0);
    } else if (run.game && run.game.kind === "match" && !run.room.done) middle = match(run.game, play.cursor || 0, focus === "board");
    return backdrop(run.env) + doors(run, run.env.palette) + feature(run) + map(run) + middle + (showPuzzle === false ? "" : presses(run, play));
  }

  return { MOTIF: MOTIF, backdrop: backdrop, scene: scene, map: map };
});
