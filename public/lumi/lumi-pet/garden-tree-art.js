/* The art for Lumi's Garden's three pages (garden-tree.js says where everything sits): drawn over the room in its
   1000 x 500 drawing, like the Skills tab (skills-art.js). The Flower tree shows each flower as its own little bloom
   (garden-art.js head), joined by vines to the flowers it grows from; the Helpers are six frames with a sprout that
   grows with each level; the Moonrise is the moon, filling as the garden gives powder, with what it can bring round
   it. Shapes with data-click are where a mouse or finger can press (game.js listens: "tree:<id>"). */
(function (root, make) {
  const node = typeof module === "object" && module.exports;
  const art = make(node ? require("./garden-tree.js") : root.LumiPetGardenTree, node ? require("./garden-art.js") : root.LumiPetGardenArt, node ? require("./garden-ui.js") : root.LumiPetGarden);
  if (node) module.exports = art; else root.LumiPetGardenTreeArt = art;
})(typeof self !== "undefined" ? self : this, function (UI, Ga, Gd) {
  "use strict";

  const INK = "#0d0a1a", DIM = "#3a3550", LEAF = "#8be9a8", MOONLIGHT = "#fff1cd", R = 10;
  const BRANCH_COLOURS = { quick: "#ffdc83", slow: "#b48cff", perennial: "#8be9a8" }; // Each branch's heading and its lit vines.

  function esc(words) { return String(words).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function text(x, y, words, size, fill, more) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + esc(words) + "</text>"; }
  function circle(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function vine(a, b, stroke, width, more) { // A vine from one flower down to the next: a soft S-curve, not a circuit.
    const mid = (a.y + b.y) / 2;
    return '<path d="M' + a.x + " " + a.y + " C" + a.x + " " + mid + " " + b.x + " " + mid + " " + b.x + " " + b.y + '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '" stroke-linecap="round" ' + (more || "") + "/>";
  }
  function screen(title, tag) { // The dark page itself, with a faint lattice like a garden trellis, and its title.
    let out = rect(-100, 0, 1200, 500, INK, 'opacity=".92"');
    for (let x = 340; x <= 664; x += 18) out += rect(x, 30, .6, 450, LEAF, 'opacity=".06"');
    for (let y = 30; y <= 480; y += 18) out += rect(340, y, 324, .6, LEAF, 'opacity=".06"');
    return out + text(502, 40, title, 11, LEAF, 'font-weight="700" letter-spacing="3" data-page="' + tag + '"');
  }
  function cursor(spot, r, look) { return look.focused === false ? "" : circle(spot.x, spot.y, r, "none", 'stroke="#70ebea" stroke-width="2.5" data-cursor="' + spot.id + '"'); }
  function press(spot, w, h) { return rect(spot.x - w / 2, spot.y - h / 2, w, h, "#000", 'fill-opacity="0" pointer-events="all" data-click="tree:' + spot.id + '"'); }

  function flowers(garden, look) { // The Flower tree.
    const spots = UI.spots("seeds", garden), by = {};
    spots.forEach(function (spot) { by[spot.id] = spot; });
    const had = garden.flowers.filter(function (flower) { return flower.unlocked; }).length;
    let out = screen("FLOWER TREE · " + had + " / " + garden.flowers.length, "seeds");
    spots.forEach(function (spot) { // The vines first, so the flowers sit on top of them.
      spot.flower.after.forEach(function (from) {
        const have = by[from].flower.unlocked, lit = have && spot.flower.unlocked, colour = BRANCH_COLOURS[spot.flower.branch] || MOONLIGHT;
        out += vine(by[from], spot, lit ? colour : have ? "#8a86a8" : DIM, lit ? 2.4 : 1.4, 'data-vine="' + (lit ? "lit" : have ? "open" : "dark") + '"' + (lit ? ' class="lp-neon"' : "") + (from === spot.flower.after[0] ? "" : ' stroke-dasharray="4 3"')); // A bridge from the next branch over is dashed.
      });
    });
    [["quick", "QUICK BLOOMS"], ["slow", "SLOW GIANTS"], ["perennial", "PERENNIALS"]].forEach(function (pair) { // Each branch's name, on a dark pill over its vines.
      const top = spots.find(function (spot) { return spot.flower.branch === pair[0]; });
      if (top) out += rect(top.x - 38, 85, 76, 10, INK, 'rx="5" opacity=".92"') + text(top.x, 92.5, pair[1], 6.5, BRANCH_COLOURS[pair[0]], 'font-weight="700" letter-spacing="1.2"');
    });
    spots.forEach(function (spot) {
      const flower = spot.flower, now = UI.state(garden, flower, look.level), size = 0.95 / (flower.size || 1);
      const ring = now === "unlocked" ? 'stroke="' + flower.colour + '" stroke-width="1.6" class="lp-neon"' : now === "open" ? 'stroke="' + (BRANCH_COLOURS[flower.branch] || MOONLIGHT) + '" stroke-width="2.4" class="lp-twinkle"'
        : now === "waiting" ? 'stroke="' + (BRANCH_COLOURS[flower.branch] || MOONLIGHT) + '" stroke-width="1.4" stroke-dasharray="3 2"' : 'stroke="' + DIM + '" stroke-width="1.2"';
      out += circle(spot.x, spot.y, R + 1, now === "unlocked" ? "#1d2a24" : "#151226", ring + ' data-flower="' + flower.id + '" data-state="' + now + '"');
      out += '<g opacity="' + (now === "unlocked" ? 1 : now === "locked" ? 0.18 : 0.5) + '">' + Ga.head(flower, spot.x, spot.y, size) + "</g>"; // Every flower shows its face, dim until it is hers.
      if (flower.id === look.seed && now === "unlocked") out += circle(spot.x + 9, spot.y - 9, 4.2, LEAF, 'data-seed="' + flower.id + '"') + text(spot.x + 9, spot.y - 7, "✓", 6, INK, 'font-weight="700"'); // The seed Enter plants.
      if (flower.sort === "perennial" && now !== "locked") out += text(spot.x + 15, spot.y + 3, "↻", 7, BRANCH_COLOURS.perennial, 'opacity=".8"');
    });
    if (by[look.cursor]) out += cursor(by[look.cursor], R + 5, look);
    spots.forEach(function (spot) { out += press(spot, 26, 24); });
    return out;
  }

  function helpers(garden, look) { // Six frames, each with its helper's sprout: taller, leafier and brighter with every level.
    const spots = UI.spots("helpers", garden);
    let out = screen("HELPERS · " + Gd.format(garden.powder) + " STARPOWDER", "helpers");
    spots.forEach(function (spot) {
      const helper = spot.helper, level = helper.level, colour = spot.colour, tall = Math.min(78, 14 + 8 * Math.sqrt(level) * 2), base = spot.y + 46, can = garden.powder >= helper.cost;
      out += rect(spot.x - 47, spot.y - 82, 94, 164, "none", 'rx="8" stroke="' + colour + '" stroke-opacity="' + (level ? .5 : .22) + '" stroke-width="1" data-helper="' + helper.id + '" data-level="' + level + '"');
      out += text(spot.x, spot.y - 64, helper.name.toUpperCase(), 6, colour, 'font-weight="700" letter-spacing=".4"');
      out += rect(spot.x - 22, base, 44, 6, "#5b3d2e", 'rx="3"'); // The pot.
      if (level) {
        out += '<path d="M' + spot.x + " " + base + " v-" + tall + '" stroke="' + LEAF + '" stroke-width="2.4" stroke-linecap="round"/>';
        for (let i = 0; i < Math.min(level, 10); i++) { // A leaf a level, up to ten, alternating sides.
          const y = base - 8 - (tall - 12) * (i + 1) / Math.min(level + 1, 11), side = i % 2 ? -1 : 1;
          out += '<ellipse cx="' + (spot.x + side * 6) + '" cy="' + y.toFixed(1) + '" rx="6" ry="2.6" fill="' + LEAF + '" transform="rotate(' + (side * -28) + " " + (spot.x + side * 6) + " " + y.toFixed(1) + ')"/>';
        }
        out += circle(spot.x, base - tall, 5, colour, 'class="lp-neon"'); // Its bud, in the class's colour.
      } else out += circle(spot.x, base - 2, 2.5, "#6f8a5a"); // A seed, waiting.
      out += text(spot.x, spot.y + 66, "LEVEL " + level, 8, level ? MOONLIGHT : "#8a86a8", 'font-weight="700"');
      out += text(spot.x, spot.y + 77, Gd.format(helper.cost) + " to grow", 6.5, can ? colour : "#8a86a8", can ? "" : 'opacity=".8"');
    });
    const at = spots.find(function (spot) { return spot.id === look.cursor; });
    if (at && look.focused !== false) out += rect(at.x - 50, at.y - 85, 100, 170, "none", 'rx="10" stroke="#70ebea" stroke-width="2.5" data-cursor="' + at.id + '"');
    spots.forEach(function (spot) { out += press(spot, 94, 164); });
    return out;
  }

  function moon(garden, look) { // The moon, filling as the garden gives powder, and what a moonrise can bring round it.
    const spots = UI.spots("moon", garden), M = UI.MOON, rising = garden.moonrise, share = Math.max(0, Math.min(1, garden.given / rising.needs));
    let out = screen("MOONRISE" + (rising.count ? " · " + rising.count : ""), "moon");
    spots.forEach(function (spot) { // A faint line from the moon to each thing it can bring, under everything else.
      const full = !spot.thing.garden && spot.thing.count >= spot.thing.max;
      out += '<path d="M' + M.x + " " + M.y + " L" + spot.x + " " + spot.y + '" stroke="' + (rising.ready && !full ? MOONLIGHT : DIM) + '" stroke-width="1" stroke-dasharray="2 4" opacity=".6"/>';
    });
    out += circle(M.x, M.y, 52, "none", 'stroke="' + DIM + '" stroke-width="4"');
    const around = 2 * Math.PI * 52; // How far round the ring the garden has come.
    out += circle(M.x, M.y, 52, "none", 'stroke="' + MOONLIGHT + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + (around * share).toFixed(1) + " " + around.toFixed(1) + '" transform="rotate(-90 ' + M.x + " " + M.y + ')" data-moon="' + Math.round(share * 100) + '"' + (rising.ready ? ' class="lp-neon"' : ""));
    out += circle(M.x, M.y, 42, rising.ready ? MOONLIGHT : "#3d3a52", rising.ready ? 'class="lp-twinkle"' : "") + circle(M.x + 14, M.y - 10, 34, INK, 'opacity="' + (rising.ready ? .0 : .55) + '"'); // Full when ready; a crescent until then.
    out += text(M.x, M.y + 4, rising.ready ? "READY" : Math.floor(share * 100) + "%", 11, rising.ready ? INK : MOONLIGHT, 'font-weight="700"');
    spots.forEach(function (spot) {
      const thing = spot.thing, full = !thing.garden && thing.count >= thing.max, can = rising.ready && !full;
      out += circle(spot.x, spot.y, 17, full ? "#2a2440" : "#151226", 'stroke="' + (full ? LEAF : can ? MOONLIGHT : DIM) + '" stroke-width="' + (can ? 2.2 : 1.2) + '"' + (can ? ' class="lp-twinkle"' : "") + ' data-upgrade="' + spot.id + '" data-count="' + (thing.garden ? garden.gardens - 1 : thing.count) + '"');
      out += text(spot.x, spot.y + 4, thing.garden ? "☾" : full ? "✓" : String(thing.count), 11, full ? LEAF : can ? MOONLIGHT : "#8a86a8", 'font-weight="700"');
      out += text(spot.x, spot.y + 30, thing.name, 7, can || full ? MOONLIGHT : "#8a86a8") + (thing.garden ? "" : text(spot.x, spot.y + 39, thing.count + " / " + thing.max, 6, "#8a86a8"));
    });
    const at = spots.find(function (spot) { return spot.id === look.cursor; });
    if (at) out += cursor(at, 22, look);
    spots.forEach(function (spot) { out += press(spot, 40, 40); });
    return out;
  }

  function scene(page, garden, look) { // look: { cursor, focused, seed, level }
    return page === "seeds" ? flowers(garden, look) : page === "helpers" ? helpers(garden, look) : moon(garden, look);
  }

  return { scene: scene };
});
