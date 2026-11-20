/* The Battle tab's lists: what to offer when Lumi is between fights (find a fight, stats, skills, moves, mods,
   potions and fight items) and during one (her moves, Defend, Potion, her fight items, Run). Pure: it turns the server's snapshot into plain rows for game.js to
   draw, and never decides an outcome. The fighting itself is mnemerynne/lumibattle.py.

   A row is { key, icon, name, hint } plus one of: `send` (a request body; `url` says where, default "act"),
   `local` (a function that only changes which list is showing), or `note` (words to say when it can't be chosen). */
(function (root, make) {
  const ui = make();
  if (typeof module === "object" && module.exports) module.exports = ui; else root.LumiPetBattle = ui;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TIERS = { // In the order they are offered.
    common: ["Common", "A gentle warm-up"], uncommon: ["Uncommon", "A fair scrap"], rare: ["Rare", "Bring a plan"],
    epic: ["Epic", "Bring the right element"], legendary: ["Legendary", "The Comet Drake waits"], gamble: ["Gamble", "Anything at all · a fifth more reward"],
  };
  const ICON = { fire: "🔥", ice: "❄", wind: "🍃", spirit: "👻", holy: "☀", dark: "🌙", none: "🐾", glow: "✦" };
  const EFFECT = { pierce: "cuts through armour", crit: "often critical", first: "strikes first", poison: "poisons", burn: "burns",
    stun: "may stun", ward: "halves damage taken", drain: "drains health" };
  const BONUS = { attack: "attack", defense: "defense", magic: "magic", ward: "ward", speed: "speed", hp: "health", mp: "MP",
    crit: "critical chance", dodge: "dodge", coins: "SGC from wins" }; // LumiBot: shown in SGC

  // LumiBot: Outfitters prices are erinne's NATIVE numbers; show the SGC the server charges (window.LumiPrice, game "battle",
  // the same key sgc.spend uses: the item / mod id, or respec, heal, potion, reset).
  function price(key, native) { // "20 SGC"
    const f = typeof LumiPrice === "function" ? LumiPrice : null;                  // lumi-tuning.js (every page loads it)
    return (f ? f("battle", key, native) : native) + " SGC";                       // scaled like the server's sgc.spend
  }

  function describeMove(move) { // "Power 60 · spell · fire · 4 MP · burns"
    const parts = [];
    if (move.power) parts.push("Power " + move.power + (move.hits > 1 ? " ×" + move.hits : ""));
    if (move.heal) parts.push("Heals " + move.heal + "%");
    parts.push(move.magic ? "spell" : "physical");
    if (move.element !== "none") parts.push(move.element === "glow" ? "her glow's element" : move.element);
    if (move.mp) parts.push(move.mp + " MP");
    if (move.effect) parts.push(EFFECT[move.effect] + (move.effect === "ward" ? " for " + (move.turns || 2) + " turns" : ""));
    return parts.join(" · ");
  }

  function describeBonus(bonus) { // "+10% attack, +3% health"
    return Object.keys(bonus).map(function (key) { return "+" + bonus[key] + "% " + BONUS[key]; }).join(", ");
  }

  function capital(text) { return text[0].toUpperCase() + text.slice(1); }

  function fightRows(snap) { // During a fight: her ready moves, then the three things she can always do.
    const fight = snap.fight, lumi = fight.player;
    function turn(action) { return { battle: fight.id, turn: fight.turn, action: action }; }
    return lumi.moves.map(function (move, index) {
      return { key: "move" + index, icon: ICON[move.element] || ICON.none, name: move.name, url: "battle/act", send: turn("move" + index),
        hint: describeMove(move) + (move.mp > lumi.mp ? " · not enough MP" : "") };
    }).concat([
      { key: "defend", icon: "🛡", name: "Defend", hint: "Halve the next hit · gather 6 MP", url: "battle/act", send: turn("defend") },
      { key: "potion", icon: "🧪", name: "Potion (" + (snap.potions_ready === undefined ? snap.pet.potions : snap.potions_ready) + ")", hint: "Restores half her health", url: "battle/act", send: turn("potion") },
    ]).concat(kitRows(snap, function (item) { return { url: "battle/act", send: turn(item) }; }), [
      { key: "run", icon: "💨", name: "Run", hint: "Three times in four she gets away", url: "battle/act", send: turn("run") },
    ]);
  }

  function kitRows(snap, use) { // Her fight items, those she has with her: a mana potion, X-Attack, X-Defend, X-Speed. use(item) says how to send one.
    const kit = snap.battle.rules.kit, held = snap.progress.kit || {};
    return Object.keys(kit).filter(function (item) { return held[item] > 0; }).map(function (item) {
      return Object.assign({ key: item, icon: kit[item].icon, name: kit[item].name + " (" + held[item] + ")", hint: kit[item].about }, use(item));
    });
  }

  function statRows(snap, back) { // The Stats page: every stat, its number and the points in it; Enter places one.
    const progress = snap.progress, points = progress.stat_points, rules = snap.battle.rules, names = rules.stat_names;
    const rows = [back(null, 1, points.left ? points.left + (points.left === 1 ? " point" : " points") + " to place" : "Every point placed")];
    rules.stat_keys.forEach(function (key) {
      const placed = points.placed[key], full = placed >= points.cap, value = key === "hp" || key === "mp" ? progress.stats[key] : progress.stats[key];
      const row = { key: "stat-" + key, icon: full ? "✓" : "＋", name: names[key] + " " + value, hint: placed + " of " + points.cap + " points · each adds " + points.per_point[key] + (points.left && !full ? " · Enter places one" : "") };
      if (!points.left) row.note = "No points waiting. Each level brings " + rules.points_per_level + " more.";
      else if (full) row.note = names[key] + " holds as many points as her level allows.";
      else row.send = { action: "stat", item: key, count: 1 };
      rows.push(row);
    });
    const leans = points.leans.map(function (key) { return names[key].toLowerCase(); }).join(", ");
    if (points.left) rows.push({ key: "stats-auto", icon: "✨", name: "Auto places the rest", hint: "Leaning on " + leans + ": her skill trees and the moves she uses most", send: { action: "stats_auto" } });
    rows.push({ key: "auto-stats", icon: points.auto ? "✓" : "○", name: "Auto on level-up: " + (points.auto ? "on" : "off"), hint: points.auto ? "New points place themselves as she levels" : "You place every new point yourself", send: { action: "auto_stats" } });
    const placedAny = rules.stat_keys.some(function (key) { return points.placed[key]; });
    if (placedAny) rows.push({ key: "stats-reset", icon: "↺", name: "Take every point back", hint: points.free_reset ? "Free this once · then place them again" : price("reset", rules.stat_reset) + " · then place them again", send: { action: "stats_reset" }, confirm: "stats-reset" }); // LumiBot: shown in SGC
    return rows;
  }

  function rows(ctx) { // ctx: { snap, view, finished, now, go(view, pick, clearFinished), countdown(ms) }
    const snap = ctx.snap, pet = snap.pet, battle = snap.battle, progress = snap.progress, rules = battle.rules, go = ctx.go, view = ctx.view;
    function back(to, pick, label) { return { key: "back", icon: "‹", name: "Back", hint: label, local: function () { go(to, pick); } }; }
    if (snap.fight && snap.fight.status === "active") return fightRows(snap);
    if (ctx.finished) { // The fight just ended: one row to read the result and carry on.
      const reward = ctx.finished.reward;
      return [{ key: "continue", icon: "›", name: ctx.finished.status === "victory" ? "Hooray!" : "Carry on", local: function () { go(null, 0, true); },
        hint: reward ? "+" + reward.exp + " EXP · +" + (reward.sgc !== undefined ? reward.sgc : reward.coins) + " SGC" + (reward.levels ? " · level " + reward.level + "!" : "") // LumiBot: shown in SGC
          : ctx.finished.status === "ran" ? "Safe and sound" : "She'll be up again soon" }];
    }
    if (view === "stats") return statRows(snap, back);
    if (view === "kit") return [back(null, 6, "Used in a fight: on her, or on a friend in a party")].concat(Object.keys(rules.kit).map(function (item) {
      const thing = rules.kit[item], held = (progress.kit || {})[item] || 0;
      return { key: "buy-" + item, icon: thing.icon, name: "Buy " + thing.name, hint: price(item, thing.price) + " · " + thing.about + " · carrying " + held + " of " + rules.kit_cap, send: { action: "kit", item: item, count: 1 } }; // LumiBot: shown in SGC
    }));
    if (view === "fight") return [back(null, 0, "Who to look for")].concat(rules.tiers.concat(["gamble"]).map(function (tier) {
      return { key: "tier-" + tier, icon: tier === "gamble" ? "🎲" : "⚔", name: TIERS[tier][0], hint: TIERS[tier][1], url: "battle", send: { tier: tier } };
    }));
    if (view === "skills") return [back(null, 2, progress.points + " skill points to spend")].concat(battle.trees.map(function (tree) {
      const known = tree.nodes.filter(function (node) { return pet.skills.includes(node.id); }).length;
      return { key: "tree-" + tree.id, icon: "✦", name: tree.name, hint: tree.about + " · " + known + " of " + tree.nodes.length, local: function () { go("tree:" + tree.id, Math.min(known + 1, tree.nodes.length)); } };
    }));
    if (view && view.indexOf("tree:") === 0) {
      const tree = battle.trees.find(function (entry) { return "tree:" + entry.id === view; });
      const known = tree.nodes.filter(function (node) { return pet.skills.includes(node.id); }).length;
      return [back("skills", 1 + battle.trees.indexOf(tree), tree.name + " · " + progress.points + " points to spend")].concat(tree.nodes.map(function (node, index) {
        const learned = pet.skills.includes(node.id), cost = rules.costs[index];
        const missing = (node.needs || []).filter(function (need) { return !pet.skills.includes(need); }).map(function (need) { return tree.nodes.find(function (other) { return other.id === need; }).name; });
        const next = !learned && !missing.length; // Every skill that leads to it is learned (the Skills tab draws the whole tree).
        const row = { key: node.id, icon: learned ? "✓" : next ? "✧" : "·", name: node.name,
          hint: (node.kind === "move" ? describeMove(node) : describeBonus(node.bonus)) + " · " + (learned ? "learned" : cost + (cost === 1 ? " point" : " points")) };
        if (learned) row.note = "Lumi already knows " + node.name + ".";
        else if (!next) row.note = node.name + " needs " + missing.join(" and ") + " first.";
        else row.send = { action: "learn", item: node.id };
        return row;
      }));
    }
    if (view === "moves") {
      const known = battle.basics.concat(battle.trees.reduce(function (all, tree) {
        return all.concat(tree.nodes.filter(function (node) { return node.kind === "move" && pet.skills.includes(node.id); }));
      }, []));
      return [back(null, 3, pet.moves.length + " of " + rules.moves + " ready")].concat(known.map(function (move) {
        const ready = pet.moves.includes(move.id);
        return { key: move.id, icon: ready ? "✓" : "○", name: move.name, hint: describeMove(move) + (ready ? " · ready" : ""), send: { action: "equip", item: move.id } };
      }));
    }
    if (view === "mods") return [back(null, 4, "Three cybertek, two magitek")].concat(progress.slots.map(function (slot, index) {
      const fitted = battle.mods.find(function (mod) { return mod.id === slot.mod; });
      const row = { key: "slot-" + index, icon: slot.tek === "magitek" ? "🔮" : "⚙", name: capital(slot.tek) + " slot",
        hint: slot.open ? (fitted ? fitted.name + " · " + describeBonus(fitted.bonus) : "Empty") : "Opens at level " + slot.opens };
      if (slot.open) row.local = function () { go("slot:" + index, 0); }; else row.note = "That slot opens at level " + slot.opens + ".";
      return row;
    }));
    if (view && view.indexOf("slot:") === 0) {
      const index = Number(view.slice(5)), slot = progress.slots[index];
      return [back("mods", 1 + index, capital(slot.tek) + " slot"), { key: "empty", icon: "○", name: "Leave empty", hint: "Take the mod out", send: { action: "mod", slot: index } }]
        .concat(battle.mods.filter(function (mod) { return mod.tek === slot.tek; }).map(function (mod) {
          const owned = pet.mods_owned.includes(mod.id), here = slot.mod === mod.id;
          const row = { key: mod.id, icon: here ? "✓" : owned ? "○" : "✧", name: mod.name,
            hint: describeBonus(mod.bonus) + " · " + (here ? "fitted here" : owned ? "yours" : price(mod.id, mod.price)) }; // LumiBot: shown in SGC
          if (here) row.note = mod.name + " is already fitted here."; else row.send = { action: "mod", item: mod.id, slot: index };
          return row;
        }));
    }
    // The Battle tab's front page.
    const resting = pet.faint_until > ctx.now, fitted = progress.slots.filter(function (slot) { return slot.mod; }).length;
    const front = [resting
      ? { key: "heal", icon: "☀", name: "Wake her now", hint: price("heal", rules.heal) + " · or free in " + ctx.countdown(pet.faint_until - ctx.now), send: { action: "heal" } } // LumiBot: shown in SGC
      : { key: "fight", icon: "⚔", name: "Find a fight", hint: "Level " + pet.level + " · " + pet.wins + (pet.wins === 1 ? " win" : " wins"), local: function () { go("fight", 1); } },
      { key: "stats", icon: "📈", name: "Stats", hint: progress.stat_points.left ? progress.stat_points.left + (progress.stat_points.left === 1 ? " point" : " points") + " to place" : "Health " + progress.stats.hp + " · attack " + progress.stats.attack + " · magic " + progress.stats.magic, local: function () { go("stats", 1); } },
      { key: "skills", icon: "✦", name: "Skills", hint: progress.points + (progress.points === 1 ? " point" : " points") + " to spend", local: function () { go("skills", 1); } },
      { key: "moves", icon: "🐾", name: "Moves", hint: pet.moves.length + " of " + rules.moves + " ready", local: function () { go("moves", 1); } },
      { key: "mods", icon: "⚙", name: "Mods", hint: fitted + " of " + progress.slots.length + " fitted", local: function () { go("mods", 1); } },
      { key: "potions", icon: "🧪", name: "Buy a potion", hint: price("potion", rules.potion) + " · carrying " + pet.potions + " of " + rules.potion_cap, send: { action: "potions", count: 1 } }, // LumiBot: shown in SGC
      { key: "kit", icon: "⚔", name: "Fight items", hint: "Mana potions, X-Attack, X-Defend, X-Speed", local: function () { go("kit", 1); } }];
    if (pet.skills.length) front.push({ key: "respec", icon: "↺", name: "Hand back skill points", hint: price("respec", rules.respec) + " · start her trees afresh", send: { action: "respec" } }); // LumiBot: shown in SGC
    return front;
  }

  function bars(fight) { // The numbers for the fight's health and MP bars, as percentages and labels.
    function pct(now, max) { return Math.max(0, Math.min(100, Math.round(now / Math.max(1, max) * 100))); }
    const lumi = fight.player, foe = fight.enemy;
    return { lumi: { hp: pct(lumi.hp, lumi.hpMax), mp: pct(lumi.mp, lumi.mpMax), label: (lumi.name || "Lumi") + " · Lv " + lumi.level + " · " + lumi.hp + "/" + lumi.hpMax + " HP · " + lumi.mp + " MP" },
      foe: { hp: pct(foe.hp, foe.hpMax), label: foe.name + " · Lv " + foe.level + " · " + capital(foe.tier) + " · " + foe.hp + "/" + foe.hpMax + " HP" } };
  }

  return { TIERS: TIERS, ICON: ICON, rows: rows, bars: bars, describeMove: describeMove, describeBonus: describeBonus, kitRows: kitRows };
});
