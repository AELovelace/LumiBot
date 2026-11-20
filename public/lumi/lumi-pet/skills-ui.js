/* The Skills tab: all six class trees on one page, as a web of skills joined to the ones they need (the rules are in
   mnemerynne/lumibattle.py; the shapes in lumipet_data/battle.json, each skill's `needs` and `at`). Pure: where every
   skill sits, what state it is in, how the cursor moves between them, and the lists and words beside the page.
   skills-art.js draws it.

   A skill is "learned", "ready" (everything it needs is learned and there are points for it), "short" (ready but for
   points) or "locked" (it needs skills Lumi doesn't have yet). */
(function (root, make) {
  const ui = make();
  if (typeof module === "object" && module.exports) module.exports = ui; else root.LumiPetSkills = ui;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The page is the middle of the room's 1000 x 500 drawing: three trees across, two down.
  const LEFT = 348, TOP = 60, TREE_W = 102, TREE_H = 208, COLUMN = 30, ROW = 30, HEAD = 34;
  const COLOURS = { fighter: "#ff7a8a", thief: "#b48cff", monk: "#ffdc83", mage: "#70ebea", cleric: "#8be9a8", paladin: "#ffc38a" };
  const BONUS = { attack: "attack", defense: "defense", magic: "magic", ward: "ward", speed: "speed", hp: "health", mp: "MP", crit: "critical chance", dodge: "dodge", coins: "SGC from fights" }; // LumiBot: shown in SGC
  function price(key, native) { return (typeof LumiPrice === "function" ? LumiPrice("battle", key, native) : native) + " SGC"; } // LumiBot: the SGC sgc.spend charges (game "battle")

  function frame(index) { return { x: LEFT + (index % 3) * TREE_W, y: TOP + Math.floor(index / 3) * TREE_H }; } // A tree's corner.

  function layout(battle) { // Every skill of every tree, with where it is drawn: [{ id, tree, index, x, y, node, colour }].
    const out = [];
    battle.trees.forEach(function (tree, t) {
      const at = frame(t);
      tree.nodes.forEach(function (node, index) {
        out.push({ id: node.id, tree: tree.id, index: index, node: node, colour: COLOURS[tree.id] || "#f0deff",
          x: at.x + 21 + node.at[0] * COLUMN, y: at.y + HEAD + node.at[1] * ROW });
      });
    });
    return out;
  }

  function find(battle, id) { return layout(battle).find(function (spot) { return spot.id === id; }); }

  function state(spot, pet, progress, rules) { // learned | ready | short | locked
    if (pet.skills.indexOf(spot.id) >= 0) return "learned";
    if (spot.node.needs.some(function (need) { return pet.skills.indexOf(need) < 0; })) return "locked";
    return rules.costs[spot.index] <= progress.points ? "ready" : "short";
  }

  function move(battle, from, action) { // The nearest skill in the direction of an arrow; the same skill if there is none that way.
    const spots = layout(battle), here = spots.find(function (spot) { return spot.id === from; }) || spots[0];
    let best = here, score = Infinity;
    spots.forEach(function (spot) {
      const dx = spot.x - here.x, dy = spot.y - here.y;
      const along = action === "left" ? -dx : action === "right" ? dx : action === "up" ? -dy : dy, across = Math.abs(action === "left" || action === "right" ? dy : dx);
      if (along <= 0 || across > along * 1.6) return; // Not that way, or far more sideways than forward.
      const far = along + across * 2.2;
      if (far < score) { score = far; best = spot; }
    });
    return best.id;
  }

  function describe(node) { // What a skill is, in a line.
    if (node.kind === "passive") return "Passive · " + Object.keys(node.bonus).map(function (key) { return "+" + node.bonus[key] + "% " + (BONUS[key] || key); }).join(", ");
    const parts = ["Move", node.power ? "power " + node.power : node.heal ? "heals " + node.heal + "%" : "no damage", node.magic ? (node.element === "glow" ? "her glow's element" : node.element) + " magic" : "physical"];
    if (node.mp) parts.push(node.mp + " MP");
    if (node.effect) parts.push({ pierce: "cuts through armour", poison: "poisons", burn: "burns", stun: "may stun", first: "strikes first", crit: "crits more", ward: "halves damage for a while" }[node.effect] || node.effect);
    return parts.join(" · ");
  }

  function names(battle, ids) { return ids.map(function (id) { return find(battle, id).node.name; }); }

  function choice(snap, id) { // What Enter (or a press of the mouse) does on a skill: a request for the server, or words.
    const spot = find(snap.battle, id), pet = snap.pet, now = state(spot, pet, snap.progress, snap.battle.rules), cost = snap.battle.rules.costs[spot.index];
    if (now === "ready") return { send: { action: "learn", item: id }, name: spot.node.name };
    if (now === "short") return { say: spot.node.name + " costs " + cost + (cost === 1 ? " skill point" : " skill points") + ", and Lumi has " + snap.progress.points + ". Each level brings one more." };
    if (now === "locked") return { say: spot.node.name + " needs " + names(snap.battle, spot.node.needs.filter(function (need) { return pet.skills.indexOf(need) < 0; })).join(" and ") + " first." };
    if (spot.node.kind !== "move") return { say: "Lumi knows " + spot.node.name + ". It is always at work." };
    const carried = pet.moves.indexOf(id) >= 0;
    if (!carried && pet.moves.length >= snap.battle.rules.moves) return { say: "Lumi carries " + snap.battle.rules.moves + " moves. Take one off first: Enter on a move she carries puts it away." };
    if (carried && pet.moves.length === 1) return { say: "Lumi needs at least one move." };
    return { send: { action: "equip", item: id }, name: spot.node.name };
  }

  function lines(snap, id) { // The words above the list: her points, then the skill under the cursor.
    const spot = find(snap.battle, id), pet = snap.pet, rules = snap.battle.rules, now = state(spot, pet, snap.progress, rules), cost = rules.costs[spot.index];
    const tree = snap.battle.trees.find(function (entry) { return entry.id === spot.tree; }), known = snap.battle.trees.reduce(function (sum, entry) { return sum + entry.nodes.filter(function (node) { return pet.skills.indexOf(node.id) >= 0; }).length; }, 0);
    const out = [snap.progress.points + (snap.progress.points === 1 ? " skill point" : " skill points") + " to spend · level " + pet.level + " · " + known + " of " + layout(snap.battle).length + " skills learned",
      tree.name + ": " + spot.node.name, describe(spot.node)];
    if (now === "learned") out.push(spot.node.kind === "move" ? (pet.moves.indexOf(id) >= 0 ? "Learned, and carried into fights (also an ability in the garden)" : "Learned, but not carried: Enter takes it along") : "Learned");
    else out.push("Costs " + cost + (cost === 1 ? " point" : " points") + (spot.node.needs.length ? " · needs " + names(snap.battle, spot.node.needs).map(function (name, i) { return (pet.skills.indexOf(spot.node.needs[i]) >= 0 ? "✓ " : "") + name; }).join(" and ") : " · the first skill of the tree"));
    out.push("Carried moves (" + pet.moves.length + " of " + rules.moves + "): " + pet.moves.map(function (move) { const at = layout(snap.battle).find(function (one) { return one.id === move; }); return at ? at.node.name : (snap.battle.basics.find(function (basic) { return basic.id === move; }) || { name: move }).name; }).join(", "));
    return out;
  }

  function rows(ctx) { // ctx: { snap, cursor (a skill id), go(change) }. The list beside the page.
    const snap = ctx.snap, spot = find(snap.battle, ctx.cursor), what = choice(snap, ctx.cursor), now = state(spot, snap.pet, snap.progress, snap.battle.rules), cost = snap.battle.rules.costs[spot.index];
    const first = { key: "act", icon: now === "learned" ? "✓" : now === "ready" ? "✧" : "🔒", hint: describe(spot.node),
      name: now === "ready" ? "Learn " + spot.node.name + " (" + cost + (cost === 1 ? " point)" : " points)") : now === "learned" && what.send ? (snap.pet.moves.indexOf(ctx.cursor) >= 0 ? "Put away " : "Carry ") + spot.node.name : spot.node.name };
    if (what.send) { first.send = what.send; first.label = spot.node.name; } else first.note = what.say;
    const list = [first];
    if (snap.pet.skills.length) list.push({ key: "respec", icon: "↺", name: "Hand back every skill point", hint: price("respec", snap.battle.rules.respec) + " · every tree starts afresh", send: { action: "respec" }, confirm: true }); // LumiBot: shown in SGC
    list.push({ key: "leave", icon: "♡", name: "Back to Lumi", hint: "Skill points come one a level, from fights", local: function () { ctx.go({ leave: true }); } });
    return list;
  }

  return { COLOURS: COLOURS, frame: frame, layout: layout, find: find, state: state, move: move, describe: describe, choice: choice, lines: lines, rows: rows,
    TREE_W: TREE_W, TREE_H: TREE_H };
});
