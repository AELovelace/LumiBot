/* The Home and Closet tabs' lists: one row per spot in the house, or per place on Lumi, each showing one of its
   choices. In the Closet ◀ ▶ flip through a row's choices, shown on her before anything is bought; Enter buys it or
   wears it. In Home ◀ ▶ flip only through what she owns (Doll's call, 2026-11-11: swapping her own things round
   shouldn't wander into the shop), and Enter on a row opens the spot's whole list, where new things are tried and
   bought. Pure: it turns the server's snapshot into plain rows for game.js to draw.

   A row is { key, icon, name, hint } and may have: `options` and `shown` (the choices ◀ ▶ flip through, and the one
   showing), `flipKey` (where game.js remembers the choice), `preview` or `wear` ([spot or slot, choice] to draw),
   `label` (the choice's own name, for messages), and one of `send`, `local` or `note` as in the other lists.
   Buying is try-before-you-buy: a row that would spend SGC has `ask` (what to say the first time it is chosen), so
   the first press or tap only shows the piece in the room (or on her) and the second buys it (game.js choose). */
(function (root, make) {
  const ui = make();
  if (typeof module === "object" && module.exports) module.exports = ui; else root.LumiPetPicker = ui;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function turn(options, current, by) { // The choice `by` steps round from `current`, wrapping at the ends.
    const at = Math.max(0, options.indexOf(current));
    return options[(at + by + options.length) % options.length];
  }

  function capital(text) { return text[0].toUpperCase() + text.slice(1); }
  // LumiBot: what a thing costs in SGC, by the same formula the server charges with (lumi-tuning.js LumiPrice; erinne's own number outside a page).
  function sgc(game, key, native) { const P = typeof LumiPrice === "function" ? LumiPrice : (typeof globalThis !== "undefined" && typeof globalThis.LumiPrice === "function" ? globalThis.LumiPrice : null); return P ? P(game, key, native) : native; }

  function homeRows(ctx) { // ctx: { snap, open (a spot id, or null for the list of spots), flip, go(change), paint(spot, colour) }
    const snap = ctx.snap, pet = snap.pet, go = ctx.go, HEX = /^#[0-9a-f]{6}$/;
    // Room mode (2026-11-19): the kitchen's and den's walls and floors share the bedroom's pieces (`same_as`), and any
    // wall or floor can be painted a plain colour instead ("#rrggbb"). Until a room has its own, it shows the bedroom's.
    function base(entry) { return entry.same_as ? snap.house.spots.find(function (other) { return other.id === entry.same_as; }) || entry : entry; } // whose pieces it takes
    function out(entry) { const own = pet.house[entry.id]; return own !== undefined ? own : entry.same_as ? pet.house[entry.same_as] : undefined; } // what shows there now
    function put(entry, id) { return entry.same_as ? { action: "decorate", item: id, spot: entry.id } : { action: "decorate", item: id }; } // into this room's spot
    function mine(piece) { return (!piece.price && !piece.found && !piece.rarity && !piece.worn && !piece.prize) || pet.decor.indexOf(piece.id) >= 0; } // Free with the house, or already hers.
    function hidden(piece) { return (piece.found || piece.rarity || piece.worn || piece.prize) && !mine(piece); } // A dungeon trophy, Star Capsule or Lumi-Soft prize, or packed box she hasn't got: it can't be bought.
    function ask(piece) { return "Here's the " + piece.name + " in the room. Choose it again to buy it for " + sgc("pet", piece.id, piece.price) + " SGC."; } // Try before you buy. (Boutique: pet/boutique, key = the piece)
    function where(piece) { // The dungeon place a found piece comes from, by name: "the Moonlit Shrine".
      const env = ((snap.dungeon || {}).environments || []).find(function (entry) { return entry.id === piece.found; });
      return env ? "the " + env.name : "the dungeon";
    }
    const spot = snap.house.spots.find(function (entry) { return entry.id === ctx.open; });
    const above = snap.boxes && snap.boxes.left ? 1 : 0; // The moving-box row sits above the spots while any are left.
    if (spot) return [{ key: "back", icon: "‹", name: "Back to the house", hint: spot.name, local: function () { go({ open: null, pick: above + snap.house.spots.indexOf(spot) }); } }]
      .concat(base(spot).paintable && ctx.paint ? [{ key: "paint", icon: "🎨", // A wall or floor: any colour at all, free, with sliders.
        name: HEX.test(out(spot) || "") ? "Painted " + out(spot).toUpperCase() + ": change the colour" : "Paint it a colour", hint: "Red, green and blue sliders · free, and painted over any time",
        local: function () { ctx.paint(spot.id, HEX.test(out(spot) || "") ? out(spot) : null); } }] : [])
      .concat(base(spot).items.map(function (piece) {
        const here = out(spot) === piece.id, owned = mine(piece);
        const row = { key: piece.id, icon: here ? "✓" : owned ? "○" : piece.worn ? "📦" : hidden(piece) ? "🔒" : "✧", name: piece.name, label: piece.name, preview: [spot.id, piece.id],
          hint: here ? "In the room now" : owned ? "Yours · Enter puts it out" : piece.worn ? "Her own · still in moving box " + piece.box : piece.found ? "Found in " + where(piece) + (spot.id === "trophy" ? "'s vault" : " · a rare find") : piece.prize ? "Lumi-Soft prize · " + piece.how : piece.rarity ? capital(piece.rarity) + " · only from a capsule" : sgc("pet", piece.id, piece.price) + " SGC · choose to see it, again to buy" };
        if (here) row.note = piece.name + " is already in the room."; else if (!hidden(piece)) { row.send = put(spot, piece.id); if (!owned) row.ask = ask(piece); }
        else row.note = piece.worn ? "That's still in moving box " + piece.box + ". Lumi unpacks one a day." : piece.found ? piece.name + " can't be bought. It's waiting somewhere in " + where(piece) + "." // Each locked kind says where it comes from.
          : piece.prize ? piece.name + " is a Lumi-Soft prize. " + piece.how + "." : piece.name + " only comes from a capsule.";
        return row;
      }));
    const boxes = snap.boxes || { left: 0 }, top = [];
    if (boxes.left) top.push(boxes.ready // Her moving boxes: one a day, her own worn things.
      ? { key: "unpack", icon: "📦", name: "Unpack a moving box", hint: "Box " + (boxes.total - boxes.left + 1) + " of " + boxes.total + ": " + boxes.next, send: { action: "unpack" } }
      : { key: "unpack", icon: "📦", name: "Moving boxes: " + boxes.left + " left", hint: "One a day · next: " + boxes.next, note: "Lumi has unpacked enough for one day. Another box tomorrow!" });
    return top.concat(snap.house.spots.map(function (entry) {
      const choices = base(entry).items.filter(mine); // ◀ ▶ step only through what is hers (free with the house, bought, won, found or unpacked).
      const ids = choices.map(function (piece) { return piece.id; }), placed = out(entry);
      if (HEX.test(placed || "") && ids.indexOf(ctx.flip[entry.id]) < 0) return { key: entry.id, icon: "🎨", name: entry.name, label: "painted " + placed, options: ids, shown: null, flipKey: entry.id, preview: null, // painted a colour
        hint: "Painted " + placed.toUpperCase() + " · " + (ids.length ? "◀ ▶ through yours, or " : "") + "Enter for paint and papers", local: function () { go({ open: entry.id }); } };
      const shown = ids.indexOf(ctx.flip[entry.id]) >= 0 ? ctx.flip[entry.id] : placed;
      const piece = choices.find(function (found) { return found.id === shown; }) || null;
      const more = ids.length > (piece && piece.id === placed ? 1 : 0); // Something else of hers to flip to.
      if (!piece) return { key: entry.id, icon: "⌂", name: entry.name, label: "nothing yet", options: ids, shown: null, flipKey: entry.id, preview: null, // Bare: nothing here yet.
        hint: "Bare for now · " + (ids.length ? "◀ ▶ through yours, or " : "") + "Enter to see what you could buy", local: function () { go({ open: entry.id }); } };
      const row = { key: entry.id, icon: "⌂", name: entry.name, label: piece.name, options: ids, shown: piece.id, flipKey: entry.id, preview: [entry.id, piece.id],
        hint: (more ? "◀ " + piece.name + " ▶" : piece.name) + " · " + (piece.id === placed ? "in the room · Enter for more" : "yours · Enter puts it out") };
      if (piece.id === placed) row.local = function () { go({ open: entry.id }); }; else row.send = put(entry, piece.id);
      return row;
    }));
  }

  function capsuleRows(snap) { // The two capsules. Sold at the top of the Closet and of the Shop: they give clothes, toys and things for the house.
    const capsule = snap.closet.capsule, moon = snap.closet.moon, REPEAT = " · a repeat pays back half its value";
    return [{ key: "capsule", icon: "🔮", name: capsule.name, hint: sgc("pet", "capsule", capsule.price) + " SGC · something to wear, a toy or something for the house" + REPEAT, send: { action: "capsule" } },
      { key: "capsule-moon", icon: "🌙", name: moon.name, hint: sgc("pet", "moon", moon.price) + " SGC · rare, epic or legendary only" + REPEAT, send: { action: "capsule", item: "moon" } }];
  }

  function closetRows(ctx) { // ctx as for homeRows; `open` is a slot id, or null for the list of places on Lumi.
    const snap = ctx.snap, pet = snap.pet, go = ctx.go;
    const CAPSULES = 2; // The capsule rows come first, so a slot's place in the list is this many further down.
    function status(piece, worn) {
      return worn ? "wearing it" : pet.closet.indexOf(piece.id) >= 0 ? "hers · Enter puts it on" : piece.price ? sgc("pet", piece.id, piece.price) + " SGC · Enter buys it" : piece.prize ? piece.how : "only from a capsule";
    }
    function grade(piece) { return piece.prize ? "Lumi-Soft prize" : capital(piece.rarity); } // A game prize has no rarity: it says where it is won instead.
    function locked(piece) { return piece.prize ? piece.name + " is a Lumi-Soft prize. " + piece.how + "." : piece.name + " only comes from a capsule."; } // Why it can't be bought.
    const slot = snap.closet.slots.find(function (entry) { return entry.id === ctx.open; });
    if (slot) return [{ key: "back", icon: "‹", name: "Back to the closet", hint: slot.name, local: function () { go({ open: null, pick: CAPSULES + snap.closet.slots.indexOf(slot) }); } }]
      .concat(slot.items.map(function (piece) {
        const owned = pet.closet.indexOf(piece.id) >= 0, worn = pet.outfit[slot.id] === piece.id;
        const row = { key: piece.id, icon: worn ? "✓" : owned ? "○" : piece.price ? "✧" : "🔒", name: piece.name, label: piece.name, wear: [slot.id, piece.id],
          hint: grade(piece) + " · " + (worn ? "wearing it · Enter takes it off" : status(piece, false)) };
        if (owned || piece.price) row.send = { action: "wear", item: piece.id }; else row.note = locked(piece);
        if (!owned && piece.price) row.ask = "Lumi tries on the " + piece.name + ". Choose it again to buy it for " + sgc("pet", piece.id, piece.price) + " SGC."; // Try before you buy.
        return row;
      }));
    return capsuleRows(snap)
      .concat(snap.closet.slots.map(function (entry) {
        const ids = [null].concat(entry.items.map(function (piece) { return piece.id; })), worn = pet.outfit[entry.id] || null, key = "slot:" + entry.id;
        const shown = Object.prototype.hasOwnProperty.call(ctx.flip, key) && ids.indexOf(ctx.flip[key]) >= 0 ? ctx.flip[key] : worn;
        const piece = entry.items.find(function (found) { return found.id === shown; });
        const row = { key: "slot-" + entry.id, icon: worn ? "✓" : "○", name: entry.name, label: piece ? piece.name : "nothing", options: ids, shown: shown, flipKey: key, wear: [entry.id, shown],
          hint: "◀ " + (piece ? piece.name : "Nothing") + " ▶ · " + (piece ? grade(piece) + " · " + status(piece, shown === worn) : shown === worn ? "nothing on" : "Enter takes it off") };
        if (shown === worn) row.local = function () { go({ open: entry.id }); };       // Nothing to change: open the whole list instead.
        else if (!piece) row.send = { action: "wear", item: worn };                      // "Nothing": take off what she has on.
        else if (pet.closet.indexOf(piece.id) >= 0 || piece.price) row.send = { action: "wear", item: piece.id };
        else row.note = locked(piece);
        return row;
      }));
  }

  return { turn: turn, homeRows: homeRows, closetRows: closetRows, capsuleRows: capsuleRows };
});
