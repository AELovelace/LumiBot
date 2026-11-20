/* The art for the Skills tab: six class trees as neon webs on a dark screen, drawn over the room in its 1000 x 500
   drawing. A circle is a move and a diamond is a passive; a skill glows in its class's colour once learned, is
   ringed brightly when it can be learned, and is dim while locked. Lines join each skill to the ones it needs and
   light up as the path is learned. Where things sit comes from skills-ui.js layout(); shapes with data-click are
   where a mouse or finger can press (game.js listens). */
(function (root, make) {
  const art = make(typeof module === "object" && module.exports ? require("./skills-ui.js") : root.LumiPetSkills);
  if (typeof module === "object" && module.exports) module.exports = art; else root.LumiPetSkillsArt = art;
})(typeof self !== "undefined" ? self : this, function (UI) {
  "use strict";

  const INK = "#0d0a1a", DIM = "#3a3550", R = 9;

  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function text(x, y, words, size, fill, more) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + words + "</text>"; }
  function line(a, b, stroke, width, more) { // A wire from one skill to the next: down, across, down, like a circuit.
    const mid = Math.round((a.y + b.y) / 2);
    return '<path d="M' + a.x + " " + a.y + " V" + mid + " H" + b.x + " V" + b.y + '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '" stroke-linejoin="round" ' + (more || "") + "/>";
  }
  function shape(spot, fill, more) { // A circle for a move, a diamond for a passive.
    if (spot.node.kind === "move") return '<circle cx="' + spot.x + '" cy="' + spot.y + '" r="' + R + '" fill="' + fill + '" ' + more + "/>";
    return '<path d="M' + spot.x + " " + (spot.y - R - 1) + " L" + (spot.x + R + 1) + " " + spot.y + " L" + spot.x + " " + (spot.y + R + 1) + " L" + (spot.x - R - 1) + " " + spot.y + ' Z" fill="' + fill + '" ' + more + "/>";
  }

  function scene(snap, look) { // look: { cursor (a skill id), focused }
    const battle = snap.battle, pet = snap.pet, spots = UI.layout(battle), by = {};
    spots.forEach(function (spot) { by[spot.id] = spot; });
    let out = rect(-100, 0, 1200, 500, INK, 'opacity=".9"');
    for (let x = 340; x <= 664; x += 18) out += rect(x, 40, .6, 440, "#70ebea", 'opacity=".07"'); // A faint grid, like a screen.
    for (let y = 40; y <= 480; y += 18) out += rect(340, y, 324, .6, "#70ebea", 'opacity=".07"');
    out += text(502, 50, "SKILLS · " + snap.progress.points + (snap.progress.points === 1 ? " POINT" : " POINTS"), 11, "#70ebea", 'font-weight="700" letter-spacing="3" data-points="' + snap.progress.points + '"');
    battle.trees.forEach(function (tree, t) {
      const at = UI.frame(t), colour = UI.COLOURS[tree.id] || "#f0deff", known = tree.nodes.filter(function (node) { return pet.skills.indexOf(node.id) >= 0; }).length;
      out += rect(at.x + 2, at.y + 4, UI.TREE_W - 4, UI.TREE_H - 8, "none", 'rx="8" stroke="' + colour + '" stroke-opacity="' + (known ? .45 : .2) + '" stroke-width="1" data-tree="' + tree.id + '"') +
        text(at.x + UI.TREE_W / 2, at.y + 17, tree.name.toUpperCase(), 9, colour, 'font-weight="700" letter-spacing="2"') +
        text(at.x + UI.TREE_W / 2, at.y + UI.TREE_H - 10, known + " / " + tree.nodes.length, 7, colour, 'opacity=".7"');
    });
    spots.forEach(function (spot) { // The wires first, so the skills sit on top of them.
      spot.node.needs.forEach(function (need) {
        const lit = pet.skills.indexOf(need) >= 0 && pet.skills.indexOf(spot.id) >= 0, open = pet.skills.indexOf(need) >= 0;
        out += line(by[need], spot, lit ? spot.colour : open ? "#8a86a8" : DIM, lit ? 2.4 : 1.4, 'data-wire="' + (lit ? "lit" : open ? "open" : "dark") + '"' + (lit ? ' class="lp-neon"' : ""));
      });
    });
    spots.forEach(function (spot) {
      const now = UI.state(spot, pet, snap.progress, battle.rules), carried = pet.moves.indexOf(spot.id) >= 0;
      const look_ = now === "learned" ? ['stroke="#fff8dc" stroke-width="1.2" class="lp-neon"', spot.colour] : now === "ready" ? ['stroke="' + spot.colour + '" stroke-width="2.4" class="lp-twinkle"', "#241d3a"]
        : now === "short" ? ['stroke="' + spot.colour + '" stroke-width="1.4" stroke-dasharray="3 2"', "#1a1530"] : ['stroke="' + DIM + '" stroke-width="1.2"', "#151226"];
      out += shape(spot, look_[1], look_[0] + ' data-skill="' + spot.id + '" data-state="' + now + '"') +
        text(spot.x, spot.y + 3, now === "learned" ? (spot.node.kind === "move" ? (carried ? "★" : "✓") : "◆") : now === "locked" ? "·" : String(battle.rules.costs[spot.index]), 8, now === "learned" ? INK : now === "locked" ? DIM : spot.colour, 'font-weight="700"');
    });
    if (look.focused !== false && by[look.cursor]) { // The cursor, and the name of what it is on.
      const spot = by[look.cursor];
      out += '<circle cx="' + spot.x + '" cy="' + spot.y + '" r="' + (R + 5) + '" fill="none" stroke="#70ebea" stroke-width="2.5" data-cursor="' + spot.id + '"/>';
    }
    spots.forEach(function (spot) { out += rect(spot.x - 14, spot.y - 14, 28, 28, "#000", 'fill-opacity="0" pointer-events="all" data-click="skill:' + spot.id + '"'); });
    return out;
  }

  return { scene: scene };
});
