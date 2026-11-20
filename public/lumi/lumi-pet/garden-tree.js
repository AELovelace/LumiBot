/* Lumi's Garden's three pages, drawn over the room like the Dungeons' Skills tab (skills-ui.js): the Flower tree, the
   Helpers and the Moonrise. Pure: where everything sits, what state it is in, how the cursor moves, and the words and
   list beside the page. garden-tree-art.js draws it; mnemerynne/lumigarden.py decides every unlock, level and price.

   The Flower tree: Moondaisy opens three branches (garden.json `branch`): Quick blooms (short timers, for sitting
   with the garden), Slow giants (long timers, to leave overnight) and Perennials (grow back). A flower opens from any
   one of the flowers in its `after`; Midnight Rose crowns the two cut branches. A flower is "unlocked", "open" (the
   tree allows it and its gates are met: Enter unlocks it for its price), "waiting" (the tree allows it but this
   garden hasn't given enough powder yet, or Lumi's level is too low) or "locked" (it grows from flowers not yet had).

   A page's choice is { send, name, confirm } (a request for the server), { change } (for game.js's gardenGo) or
   { say } (words only). Rows are the same shape as garden-ui.js's. */
(function (root, make) {
  const tree = make(typeof module === "object" && module.exports ? require("./garden-ui.js") : root.LumiPetGarden);
  if (typeof module === "object" && module.exports) module.exports = tree; else root.LumiPetGardenTree = tree;
})(typeof self !== "undefined" ? self : this, function (Gd) {
  "use strict";

  const PAGES = ["seeds", "helpers", "moon"]; // The garden drawers that are pages now (garden-ui.js opens them).
  const BRANCH_NAMES = { root: "The first flower", quick: "Quick blooms", slow: "Slow giants", perennial: "Perennials", crown: "The crown" };
  const COLUMNS = { quick: 410, slow: 502, perennial: 594 }; // The Flower tree's three branches across the middle of the 1000 x 500 drawing.
  const ROOT = { x: 502, y: 66 }, FIRST_ROW = 108, ROW = 24;
  const COLOURS = { fighter: "#ff7a8a", thief: "#b48cff", monk: "#ffdc83", mage: "#70ebea", cleric: "#8be9a8", paladin: "#ffc38a" }; // As skills-ui.js.
  const MOON = { x: 502, y: 258, ring: 136 }; // The Moonrise page: the moon in the middle, what it can bring around it.

  function isPage(drawer) { return PAGES.indexOf(drawer) >= 0; }

  // ---- Where things sit.
  function flowerSpots(garden) { // [{ id, x, y, flower }], every flower on the tree.
    const rows = { quick: 0, slow: 0, perennial: 0 }, out = [];
    garden.flowers.forEach(function (flower) {
      const branch = flower.branch || "root";
      if (branch === "root") out.push({ id: flower.id, x: ROOT.x, y: ROOT.y, flower: flower });
      else if (branch === "crown") out.push({ id: flower.id, x: (COLUMNS.quick + COLUMNS.slow) / 2, y: FIRST_ROW + 14 * ROW + 8, flower: flower }); // Below the tops of both cut branches.
      else { out.push({ id: flower.id, x: COLUMNS[branch], y: FIRST_ROW + rows[branch] * ROW, flower: flower }); rows[branch] += 1; }
    });
    return out;
  }

  function helperSpots(garden) { // Six frames, three across and two down, like the Skills page's six trees.
    return garden.helpers.map(function (helper, i) { return { id: helper.id, x: 399 + (i % 3) * 103, y: 160 + Math.floor(i / 3) * 186, helper: helper, colour: COLOURS[helper.id] || "#f0deff" }; });
  }

  function moonSpots(garden) { // "Another garden", then each lasting upgrade, in a ring round the moon from the top.
    const things = [{ id: "garden", name: "Another garden", about: "A new starter garden beside this one, to fill from the first flower", garden: true }].concat(garden.upgrades);
    return things.map(function (thing, i) {
      const turn = -Math.PI / 2 + i * 2 * Math.PI / things.length;
      return { id: thing.id, x: Math.round(MOON.x + MOON.ring * Math.cos(turn)), y: Math.round(MOON.y + MOON.ring * 0.92 * Math.sin(turn)), thing: thing };
    });
  }

  function spots(page, garden) { return page === "seeds" ? flowerSpots(garden) : page === "helpers" ? helperSpots(garden) : moonSpots(garden); }

  function find(page, garden, id) { return spots(page, garden).find(function (spot) { return spot.id === id; }); }

  function first(page, garden, seed) { // Where the cursor starts: the chosen seed, or something that can be unlocked; the first helper; the new garden.
    if (page !== "seeds") return spots(page, garden)[0].id;
    const open = garden.flowers.find(function (flower) { return flower.next; });
    return find(page, garden, seed) && garden.flowers.some(function (flower) { return flower.id === seed && flower.unlocked; }) ? seed : open ? open.id : garden.flowers[0].id;
  }

  function move(page, garden, from, action) { // The nearest thing in the direction of an arrow; the same one if there is none that way (as skills-ui.js).
    const all = spots(page, garden), here = all.find(function (spot) { return spot.id === from; }) || all[0];
    let best = here, score = Infinity;
    all.forEach(function (spot) {
      const dx = spot.x - here.x, dy = spot.y - here.y;
      const along = action === "left" ? -dx : action === "right" ? dx : action === "up" ? -dy : dy, across = Math.abs(action === "left" || action === "right" ? dy : dx);
      if (along <= 0 || across > along * 1.6) return; // Not that way, or far more sideways than forward.
      const far = along + across * 2.2;
      if (far < score) { score = far; best = spot; }
    });
    return best.id;
  }

  // ---- States and words.
  function flowerOf(garden, id) { return garden.flowers.find(function (flower) { return flower.id === id; }); }

  function state(garden, flower, level) { // unlocked | open | waiting | locked
    if (flower.unlocked) return "unlocked";
    if (!flower.next) return "locked";
    return garden.given < flower.needs || (level || 1) < flower.level ? "waiting" : "open";
  }

  function cost(flower) { return flower.stardust ? Gd.format(flower.stardust) + " starpowder" : Gd.sgcPrice(flower.id, flower.coins) + " SGC"; } // LumiBot: SGC, keyed by the flower id like the server

  function grows(garden, flower) { // "Glass Lily or Phoenix Daisy"
    return flower.after.map(function (id) { return flowerOf(garden, id).name; }).join(" or ");
  }

  function about(flower) { // How it grows, in a line.
    return Gd.span(flower.minutes_now) + " · " + Gd.format(flower.powder_now) + " powder · " + (flower.sort === "perennial" ? "grows back after every trim" : "plant again after each harvest");
  }

  function why(garden, flower, level) { // Why a flower can't be unlocked yet, in a sentence.
    const now = state(garden, flower, level);
    if (now === "locked") return flower.name + " grows from " + grows(garden, flower) + ": unlock " + (flower.after.length > 1 ? "one of them" : "it") + " first.";
    if (garden.given < flower.needs) return flower.name + " opens when this garden has given " + Gd.format(flower.needs) + " starpowder (" + Gd.format(garden.given) + " so far).";
    return flower.name + " needs Lumi to be level " + flower.level + ".";
  }

  function upgradeOf(garden, id) { return garden.upgrades.find(function (thing) { return thing.id === id; }); }

  function choice(page, ctx, id) { // What Enter (or a second press of the mouse) does on the page.
    const garden = ctx.garden;
    if (page === "seeds") {
      const flower = flowerOf(garden, id), now = state(garden, flower, ctx.level);
      if (now === "unlocked") return { change: { seed: id, drawer: null } }; // Choose it as the seed, and back to the plots to plant it.
      if (now === "open") return { send: { action: "unlock", item: id }, name: "Unlock " + flower.name };
      return { say: why(garden, flower, ctx.level) };
    }
    if (page === "helpers") {
      const helper = garden.helpers.find(function (one) { return one.id === id; });
      if (garden.powder < helper.cost) return { say: helper.name + " costs " + Gd.format(helper.cost) + " starpowder to level up, and there is " + Gd.format(garden.powder) + ". Trim flowers for more." };
      return { send: { action: "helper", item: id }, name: helper.name + " to level " + (helper.level + 1) };
    }
    if (!garden.moonrise.ready) return { say: "A moonrise needs every plot dug and " + Gd.format(garden.moonrise.needs) + " starpowder given by this garden (" + Gd.format(garden.given) + " so far)." };
    const thing = id === "garden" ? null : upgradeOf(garden, id);
    if (thing && thing.count >= thing.max) return { say: thing.name + " is as high as it goes." };
    return { send: { action: "moonrise", item: id }, name: "Moonrise: " + (thing ? thing.name : "another garden"),
      confirm: "A moonrise replants this garden from the first flower" + (thing ? ", for " + thing.name.toLowerCase() + " for good" : ", and gives you a second garden") + ". Press Enter again to go ahead." };
  }

  function lines(page, ctx, id) { // The words above the list: the page at a glance, then what the cursor is on.
    const garden = ctx.garden;
    if (page === "seeds") {
      const flower = flowerOf(garden, id), now = state(garden, flower, ctx.level), had = garden.flowers.filter(function (one) { return one.unlocked; }).length;
      const out = ["Flower tree · " + had + " of " + garden.flowers.length + " unlocked in this garden · it has given " + Gd.format(garden.given) + " starpowder",
        BRANCH_NAMES[flower.branch || "root"] + ": " + flower.name, about(flower)];
      if (now === "unlocked") out.push(flower.id === ctx.seed ? "Unlocked, and the seed Enter plants" : "Unlocked · Enter makes it the seed to plant");
      else if (now === "open") out.push("Ready to unlock: " + cost(flower));
      else out.push(why(garden, flower, ctx.level) + " Then " + cost(flower) + ".");
      if (flower.after.length) out.push("Grows from " + flower.after.map(function (one) { return (flowerOf(garden, one).unlocked ? "✓ " : "") + flowerOf(garden, one).name; }).join(" or "));
      return out;
    }
    if (page === "helpers") {
      const helper = garden.helpers.find(function (one) { return one.id === id; }), total = garden.helpers.reduce(function (sum, one) { return sum + one.level; }, 0);
      return ["Helpers · " + Gd.format(garden.powder) + " starpowder to spend · " + total + " levels in all", helper.name + " · level " + helper.level, helper.about,
        "Next level: " + Gd.format(helper.cost) + " starpowder", "Lumi's own skills in this class, and her mods, make this helper stronger still"];
    }
    const spot = find(page, garden, id), thing = spot.thing, moon = garden.moonrise;
    const out = ["Moonrise" + (moon.count ? " · " + moon.count + " so far" : "") + " · " +(moon.ready ? "this garden is ready" : "this garden has given " + Gd.format(garden.given) + " of " + Gd.format(moon.needs) + " starpowder" + (garden.plot_price === null ? "" : " · and needs every plot")),
      thing.name, thing.about];
    if (!thing.garden) out.push("Have " + thing.count + " of " + thing.max + " · lasts for good, through every moonrise");
    out.push("A moonrise replants this garden as a starter garden: its flowers and plots start afresh");
    return out;
  }

  function rows(page, ctx) { // ctx: { garden, cursor, seed, level, go }. The list beside the page.
    const what = choice(page, ctx, ctx.cursor), garden = ctx.garden, list = [];
    let name, icon, hint;
    if (page === "seeds") {
      const flower = flowerOf(garden, ctx.cursor), now = state(garden, flower, ctx.level);
      icon = now === "unlocked" ? "✓" : now === "open" ? "✧" : "🔒"; hint = about(flower);
      name = now === "unlocked" ? "Plant " + flower.name + " from now on" : now === "open" ? "Unlock " + flower.name + " (" + cost(flower) + ")" : flower.name;
    } else if (page === "helpers") {
      const helper = garden.helpers.find(function (one) { return one.id === ctx.cursor; });
      icon = "✦"; name = "Level up " + helper.name + " (" + Gd.format(helper.cost) + ")"; hint = helper.about;
    } else {
      const thing = find(page, garden, ctx.cursor).thing;
      icon = "☾"; name = "Moonrise: " + thing.name; hint = thing.garden ? thing.about : thing.about + " · have " + thing.count + " of " + thing.max;
    }
    const act = { key: "act", icon: icon, name: name, hint: hint };
    if (what.send) { act.url = "garden"; act.send = what.send; if (what.confirm) act.confirm = true; }
    else if (what.change) act.local = function () { ctx.go(what.change); };
    else act.note = what.say;
    list.push(act);
    PAGES.filter(function (other) { return other !== page; }).forEach(function (other) { // A hop to the other two pages.
      list.push({ key: "page-" + other, icon: other === "seeds" ? "❀" : other === "helpers" ? "♟" : "☾", name: other === "seeds" ? "The flower tree" : other === "helpers" ? "The helpers" : "Moonrise",
        hint: other === "seeds" ? "Unlock flowers, choose the seed" : other === "helpers" ? "Six class helpers, levelled with starpowder" : "Replant this garden for something that lasts",
        local: function () { ctx.go({ drawer: other }); } });
    });
    list.push({ key: "back", icon: "‹", name: "Back to the garden", hint: "The plots and the press", local: function () { ctx.go({ drawer: null }); } });
    return list;
  }

  return { PAGES: PAGES, BRANCH_NAMES: BRANCH_NAMES, COLOURS: COLOURS, MOON: MOON, isPage: isPage, spots: spots, find: find, first: first, move: move,
    state: state, choice: choice, lines: lines, rows: rows, cost: cost, about: about, why: why };   // cost/about/why: the Market's seed stall too (game.js)
});
