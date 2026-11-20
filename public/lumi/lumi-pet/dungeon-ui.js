/* The Dungeon tab's lists, and the puzzles as played on the page. Pure: it turns the server's snapshot into plain
   rows for game.js to draw, and keeps a Sokoban or Lights Out board while it is being worked on. Nothing here decides
   an outcome: a solved puzzle is sent to the server as the moves that solved it, and the server replays them
   (mnemerynne/lumidungeon.py) before any door opens.

   A row is { key, icon, name, hint } plus one of: `send` (a request body; `url` says where), `local` (a function that
   only changes what is showing), or `note` (words to say when it can't be chosen). */
(function (root, make) {
  const ui = make();
  if (typeof module === "object" && module.exports) module.exports = ui; else root.LumiPetDungeon = ui;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const WAYS = { n: ["north", "▲", 0, -1], e: ["east", "▶", 1, 0], s: ["south", "▼", 0, 1], w: ["west", "◀", -1, 0] };
  const KINDS = { unknown: "somewhere new", start: "the way home", empty: "an empty room", enemy: "a creature's den", treasure: "a treasure room",
    key: "where the key was", vault: "the vault", game: "a game room", stairs: "the stairs down" };
  const RUNE = { sun: "☀", moon: "☾", star: "★", leaf: "❧", wave: "≈" };
  const FAMILY = { mystical: "✦", fantasy: "♜", cyberpunk: "⌬" };
  const STEP = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };

  function step(at, way) { // The room next door: "2,1" going east is "3,1".
    const xy = at.split(",").map(Number);
    return (xy[0] + WAYS[way][2]) + "," + (xy[1] + WAYS[way][3]);
  }

  // LumiBot: satchel coins are erinne's NATIVE numbers until she walks home; show what they bank as, in SGC, with the
  // same formula the server pays with (window.LumiPayout, game "dungeon" solo or "party" with friends, key "win").
  function sgc(native, game) { // "5 SGC"
    const pay = typeof LumiPayout === "function" ? LumiPayout : null;              // lumi-tuning.js (every page loads it)
    return (pay ? pay(game || "dungeon", "win", native) : native) + " SGC";        // scaled like the server's sgc.pay
  }
  function gameOf(run) { return run && run.party ? "party" : "dungeon"; }          // which prize table a trip pays from

  function carrying(bag, game) { // "5 SGC · 1 potion · a key · 1 thing for the house" (a trophy, or a piece of the place's set)
    const parts = [sgc(bag.coins, game)];                                           // native satchel coins, shown as SGC
    if (bag.potions) parts.push(bag.potions + (bag.potions === 1 ? " potion" : " potions"));
    if (bag.keys) parts.push("a key");
    if (bag.trophies.length) parts.push(bag.trophies.length + (bag.trophies.length === 1 ? " thing for the house" : " things for the house"));
    if (bag.mods.length) parts.push(bag.mods.length + (bag.mods.length === 1 ? " mod" : " mods"));
    return parts.join(" · ");
  }

  // ---- Sokoban, as played on the page. The same rules as the server's replay: one step at a time, a crate moves if
  // the square beyond it is free, and it is solved when every crate stands on a goal.
  function sokobanStart(rows) {
    const board = { walls: {}, goals: {}, crates: {}, at: null, moves: "", width: rows[0].length, height: rows.length, rows: rows };
    rows.forEach(function (row, y) {
      row.split("").forEach(function (cell, x) {
        const key = x + "," + y;
        if (cell === "#") board.walls[key] = true;
        if (".*+".indexOf(cell) >= 0) board.goals[key] = true;
        if ("$*".indexOf(cell) >= 0) board.crates[key] = true;
        if ("@+".indexOf(cell) >= 0) board.at = [x, y];
      });
    });
    return board;
  }

  function sokobanMove(board, key) { // A new board after one step, or the same board if the step is blocked.
    const d = STEP[key], to = [board.at[0] + d[0], board.at[1] + d[1]], toKey = to.join(",");
    if (board.walls[toKey]) return board;
    const crates = Object.assign({}, board.crates);
    if (crates[toKey]) {
      const beyond = (to[0] + d[0]) + "," + (to[1] + d[1]);
      if (board.walls[beyond] || crates[beyond]) return board;
      delete crates[toKey]; crates[beyond] = true;
    }
    return Object.assign({}, board, { crates: crates, at: to, moves: board.moves + key });
  }

  function sokobanUndo(board) { // Take back the last step, by replaying all the others from the start.
    return board.moves.slice(0, -1).split("").reduce(sokobanMove, sokobanStart(board.rows));
  }

  function sokobanSolved(board) { return Object.keys(board.crates).every(function (key) { return board.goals[key]; }); }

  // ---- Lights Out, as played on the page: a press flips a lamp and its neighbours.
  function lightsStart(lock) { return { size: lock.size, lamps: lock.board.slice(), presses: [], cursor: 0 }; }

  function lightsPress(board, cell) {
    const size = board.size, lamps = board.lamps.slice(), x = cell % size, y = Math.floor(cell / size);
    [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].forEach(function (c) {
      if (c[0] >= 0 && c[0] < size && c[1] >= 0 && c[1] < size) lamps[c[1] * size + c[0]] = !lamps[c[1] * size + c[0]];
    });
    return Object.assign({}, board, { lamps: lamps, presses: board.presses.concat([cell]) });
  }

  function lightsSolved(board) { return board.lamps.every(function (lit) { return !lit; }); }

  function cursorMove(cursor, way, width, count) { // Move a board cursor one square; null when it would leave the board (so the list can take over).
    const x = cursor % width, y = Math.floor(cursor / width), nx = x + WAYS[way][2], ny = y + WAYS[way][3];
    return nx < 0 || nx >= width || ny < 0 || ny * width + nx >= count ? null : ny * width + nx;
  }

  // ---- The lists.
  function brought(ended) { // What a trip that ended at home brought back: ["24 SGC", "2 potions", "something for the house"].
    const parts = [(ended.coins || 0) + (ended.owed ? ended.owed : 0) + " SGC"];   // the server sends the SGC actually paid (+ any owed), already scaled
    if (ended.potions) parts.push(ended.potions + (ended.potions === 1 ? " potion" : " potions"));
    if (ended.trophies.length) parts.push(ended.trophies.length === 1 ? "something for the house" : ended.trophies.length + " things for the house");
    if (ended.mods.length) parts.push(ended.mods.length === 1 ? "a new mod" : ended.mods.length + " new mods");
    return parts;
  }

  function listed(parts) { return parts.length < 2 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]; } // "a, b and c"

  function summary(run) { // How a finished trip ended, for its one "carry on" row.
    const ended = run.ended || {};
    if (run.over === "home") return "Home from floor " + ended.depth + " with " + brought(ended).join(", ");
    return (run.over === "defeat" ? "Carried home from floor " : "Came home early from floor ") + ended.depth + " · left behind: " + carrying(ended.lost, gameOf(run)); // the lost satchel, in SGC
  }

  // Lumi Pet's welcome home: what she says back in her room after a trip, once per trip (game.js welcomeHome). Only an
  // ending the server dated (ended.at, in ms) and that is under WELCOME_HOURS old counts: no "Home!" for a trip from days ago.
  const WELCOME_HOURS = 12;
  function welcome(run, now) { // Her line, or "" when there is nothing fresh to welcome.
    const ended = run && run.over ? run.ended : null;
    if (!ended || !ended.at || now - ended.at > WELCOME_HOURS * 3600000) return "";
    const place = run.env && run.env.name ? run.env.name : "the dungeons";
    if (run.over === "home") return "Home! " + place + ", floor " + ended.depth + ": she brought back " + listed(brought(ended)) + ".";
    if (run.over === "defeat") return "Carried home from " + place + ", all worn out. A cuddle and a nap would help.";
    return "Home early from " + place + ". Whatever she was carrying stayed down there, but she's safe and sound.";
  }

  function places(snap) { // Not out exploring: where to go.
    return snap.dungeon.environments.map(function (env) {
      const row = { key: "env-" + env.id, icon: FAMILY[env.family], name: env.name, hint: env.open ? env.about : "Opens at level " + env.opens };
      if (env.open) { row.url = "dungeon"; row.send = { env: env.id }; } else row.note = env.name + " opens at level " + env.opens + ".";
      return row;
    });
  }

  function doorRows(run, play, go) { // Standing at a locked door. `play` is the page's puzzle: { board } for crates and lamps, { guess } for runes.
    const board = play.board || { moves: "", presses: [] }; // Not started yet: nothing done so far.
    const lock = run.facing.lock, back = { key: "back", icon: "‹", name: "Step back", hint: "Leave the door for now", url: "dungeon/act", send: { action: "back" } };
    if (lock.kind === "key") return [
      run.satchel.keys ? { key: "unlock", icon: "🗝", name: "Use the key", hint: "It fits!", url: "dungeon/act", send: { action: "unlock" } }
        : { key: "unlock", icon: "🗝", name: "Use a key", hint: "Lumi doesn't have one yet", note: "Lumi needs a key. There's one somewhere on this floor." }, back];
    if (lock.kind === "sokoban") return [
      { key: "play", icon: "▣", name: "The crates", hint: board.moves.length + " steps so far · arrows push · Enter takes a step back", local: function () { go({ focus: "board" }); } },
      { key: "undo", icon: "↶", name: "Undo a step", hint: "Take the last step back", local: function () { go({ undo: true }); } },
      { key: "reset", icon: "↺", name: "Start over", hint: "Put every crate back", local: function () { go({ reset: true }); } }, back];
    if (lock.kind === "lights") return [
      { key: "play", icon: "▣", name: "The lamps", hint: board.presses.length + " presses so far · arrows move · Enter flips a lamp", local: function () { go({ focus: "board" }); } },
      { key: "reset", icon: "↺", name: "Start over", hint: "Light them as they were", local: function () { go({ reset: true }); } }, back];
    const guess = play.guess || [], full = guess.length === lock.slots; // runes
    const rows = lock.runes.map(function (rune) {
      const row = { key: "rune-" + rune, icon: RUNE[rune], name: "Add " + rune, hint: "Code so far: " + (guess.map(function (r) { return RUNE[r]; }).join(" ") || "nothing yet") };
      if (full) row.note = "That's " + lock.slots + " runes. Try the code, or take one off."; else row.local = function () { go({ rune: rune }); };
      return row;
    });
    rows.unshift(full ? { key: "try", icon: "✓", name: "Try this code", hint: guess.map(function (r) { return RUNE[r]; }).join(" ") + " · " + lock.left + " tries left", url: "dungeon/act", send: { action: "rune", picks: guess } }
      : { key: "try", icon: "✓", name: "Try this code", hint: "Choose " + lock.slots + " runes first · " + lock.left + " tries left", note: "Choose " + lock.slots + " runes first." });
    rows.push({ key: "erase", icon: "↶", name: "Take one off", hint: "Remove the last rune", local: function () { go({ erase: true }); } }, back);
    return rows;
  }

  function potionRow(snap, run) { // A potion: her own, or one found on this trip.
    const ready = snap.potions_ready === undefined ? snap.pet.potions : snap.potions_ready;
    const potion = { key: "potion", icon: "🧪", name: "Drink a potion (" + ready + ")", hint: "Lumi has " + run.hp + " of " + run.hpMax + " HP" };
    if (run.hp >= run.hpMax) potion.note = "Lumi is already at full health.";
    else if (ready) { potion.url = "dungeon/act"; potion.send = { action: "potion" }; } else potion.note = "Lumi has no potions with her.";
    return potion;
  }

  function careRows(snap, run, go) { // "Look after Lumi" on a trip: a snack or a potion, and nothing else until she is home.
    const pet = snap.pet, foods = snap.catalog.snacks.concat(snap.catalog.treats).filter(function (food) { return !food.price || pet.inventory[food.id]; });
    return [{ key: "explore", icon: "‹", name: "Back to exploring", hint: "Lumi has " + run.hp + " of " + run.hpMax + " HP", local: function () { go({ care: false }); } }]
      .concat(foods.map(function (food) { // Bought food mends her by its tummy number; the free bowl only fills her tummy.
        return { key: food.id, icon: food.icon, name: food.name, send: { action: "feed", item: food.id },
          hint: "+" + food.fullness + " tummy" + (food.price && food.fullness > 0 ? " · +" + food.fullness + "% health" : "") + " · " + (food.price ? pet.inventory[food.id] + " left" : "always in the bowl") };
      })).concat([potionRow(snap, run)]);
  }

  function homeRow(home) { // Lumi Dungeons' way out (Doll's design, 2026-11-11): out of the tavern into Lumi Town (2026-11-12), where her house is. `home` opens the town.
    return { key: "go-home", icon: "🏘", name: "Back to town", hint: "Out the tavern door into Lumi City · Downtown, by Lumi Heights", local: home }; // erinne 43a24f4: the way out says Lumi City
  }

  function rows(ctx) { // ctx: { snap, play, dismissed, care (the snack-and-potion list is open), go(change), home (opens Lumi Pet, or null) }
    const snap = ctx.snap, run = snap.dungeon.run, go = ctx.go;
    if (!run || (run.over && ctx.dismissed === run.id)) return places(snap);
    if (run.over) { // A trip just ended: its summary, and first the way back to town (which counts the ending as read on the way out).
      const carry = { key: "continue", icon: "›", name: run.over === "home" ? "Home again!" : "Carry on", hint: summary(run), local: function () { go({ dismiss: run.id }); } };
      if (!ctx.home) return [carry];
      return [homeRow(function () { go({ dismiss: run.id }); ctx.home(); }), carry];
    }
    if (ctx.care) return careRows(snap, run, go);
    const tabs = { key: "care", icon: "♡", name: "Look after Lumi", hint: "A snack or a potion · everything else waits until she's home", local: function () { go({ care: true }); } };
    if (run.facing) return doorRows(run, ctx.play || {}, go).concat([tabs]);
    const list = [], room = run.room;
    if (run.game && !room.done) {
      if (run.game.kind === "cups") ["Left", "Middle", "Right"].forEach(function (name, cup) {
        list.push({ key: "cup-" + cup, icon: "🥤", name: name + " cup", hint: "Lift it and see", url: "dungeon/act", send: { action: "cup", picks: [cup] } });
      });
      else list.push({ key: "play", icon: "▣", name: "The cards", hint: run.game.left + " turns left · arrows move · Enter turns a card", local: function () { go({ focus: "board" }); } });
    }
    if (!room.done && (room.kind === "treasure" || room.kind === "vault")) list.push({ key: "take", icon: "✦", name: "Open the chest", hint: room.kind === "vault" ? "The vault's treasure, at last" : "See what's inside", url: "dungeon/act", send: { action: "take" } });
    if (!room.done && room.kind === "key") list.push({ key: "take", icon: "🗝", name: "Pick up the key", hint: "It opens the locked door on this floor", url: "dungeon/act", send: { action: "take" } });
    if (room.kind === "start") list.push({ key: "leave", icon: "⌂", name: "Go home", hint: "Keep everything in the satchel: " + carrying(run.satchel, gameOf(run)), url: "dungeon/act", send: { action: "leave" } });
    if (room.kind === "stairs") list.push({ key: "descend", icon: "⤓", name: "Go down the stairs", hint: "Floor " + (run.depth + 1) + ": tougher creatures, better treasure, no way back up", url: "dungeon/act", send: { action: "descend" } });
    room.exits.forEach(function (way) {
      const to = run.rooms[step(run.at, way)] || { kind: "unknown" };
      list.push({ key: "go-" + way, icon: WAYS[way][1], name: "Go " + WAYS[way][0], url: "dungeon/act", send: { action: "move", way: way },
        hint: (to.kind === "vault" && !to.done ? "a locked door" : KINDS[to.kind]) + (to.kind === "enemy" && !to.done ? " · it's still there" : "") });
    });
    list.push({ key: "look", icon: "◉", name: "Look around", hint: "Notice something about this room", url: "dungeon/act", send: { action: "look" } });
    if (run.hp < run.hpMax) list.push(potionRow(snap, run));
    list.push(tabs);
    list.push({ key: "abandon", icon: "✕", name: "Give up and go home", hint: "Leaves the satchel behind: " + carrying(run.satchel, gameOf(run)), confirm: "abandon", url: "dungeon/act", send: { action: "abandon" } });
    return list;
  }

  function hud(run) { // The line and bars shown over the room while exploring.
    function pct(now, max) { return Math.max(0, Math.min(100, Math.round(now / Math.max(1, max) * 100))); }
    return { title: run.env.name + " · floor " + run.depth, hp: pct(run.hp, run.hpMax), mp: pct(run.mp, run.mpMax),
      label: run.hp + "/" + run.hpMax + " HP · " + run.mp + " MP · satchel: " + carrying(run.satchel, gameOf(run)) }; // satchel in SGC
  }

  return { WAYS: WAYS, RUNE: RUNE, step: step, carrying: carrying, sgc: sgc, gameOf: gameOf, rows: rows, hud: hud, summary: summary, cursorMove: cursorMove,
    homeRow: homeRow, welcome: welcome, WELCOME_HOURS: WELCOME_HOURS,
    sokobanStart: sokobanStart, sokobanMove: sokobanMove, sokobanUndo: sokobanUndo, sokobanSolved: sokobanSolved,
    lightsStart: lightsStart, lightsPress: lightsPress, lightsSolved: lightsSolved };
});
