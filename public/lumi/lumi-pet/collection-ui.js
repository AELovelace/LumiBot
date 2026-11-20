/* The Collection tab: everything Lumi can collect, as a gallery that fills the room like the skill trees do.
   Pure: it reads the catalogs the server already sends (house, closet, toys, mods, garden flowers and decorations)
   and what the pet owns, and works out the shelves, the page of cells being shown, how the cursor moves over them,
   and the list and words beside the page. collection-art.js draws it. Nothing here can be bought or changed: it is
   an album.

   A thing on a shelf is { id, name, owned, from, count?, art }, where `art` says how to draw its picture:
   { kind: "house" | "closet" | "flower" | "decor" | "glyph", ... }. */
(function (root, make) {
  const ui = make();
  if (typeof module === "object" && module.exports) module.exports = ui; else root.LumiPetCollection = ui;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COLUMNS = 6, ROWS = 6, PER_PAGE = COLUMNS * ROWS; // The gallery's grid (collection-art.js draws the same).

  function grand(word) { return word ? word[0].toUpperCase() + word.slice(1) : ""; }
  // LumiBot: what a thing costs in SGC, by the same formula the server charges with (lumi-tuning.js LumiPrice; erinne's own number outside a page).
  function sgc(game, key, native) { const P = typeof LumiPrice === "function" ? LumiPrice : (typeof globalThis !== "undefined" && typeof globalThis.LumiPrice === "function" ? globalThis.LumiPrice : null); return P ? P(game, key, native) : native; }

  function shelves(snap) { // Every shelf of the album: [{ id, icon, name, about, items }]
    const pet = snap.pet, places = ((snap.dungeon || {}).environments || []), capsule = ((snap.garden_decor || {}).capsule || {}).name || "Seedling Capsule";
    function place(id) { const env = places.find(function (entry) { return entry.id === id; }); return env ? env.name : "the dungeon"; }
    const home = [], finds = [];
    ((snap.house || {}).spots || []).forEach(function (spot) {
      spot.items.forEach(function (piece) {
        if (!piece.price && !piece.found && !piece.rarity && spot.items.indexOf(piece) === 0 && /-none$/.test(piece.id)) return; // "Empty bracket": a way to show nothing, not a thing to collect.
        const owned = (!piece.price && !piece.found && !piece.rarity && !piece.worn && !piece.prize) || pet.decor.indexOf(piece.id) >= 0; // A worn piece is hers once it is out of its box; a prize once it is won.
        const item = { id: piece.id, name: piece.name, owned: owned, art: { kind: "house", id: piece.id, spot: spot.id },
          from: spot.name + " · " + (piece.found ? "found in " + place(piece.found) : piece.prize ? "Lumi-Soft prize · " + piece.how : piece.rarity ? grand(piece.rarity) + " · from a capsule" : piece.worn ? "Lumi's own, from moving box " + piece.box : piece.price ? "the Home tab, " + sgc("pet", piece.id, piece.price) + " SGC" : "came with the house") };
        (piece.found ? finds : home).push(item);
      });
    });
    const clothes = [];
    ((snap.closet || {}).slots || []).forEach(function (slot) {
      slot.items.forEach(function (piece) {
        clothes.push({ id: piece.id, name: piece.name, owned: pet.closet.indexOf(piece.id) >= 0, art: { kind: "closet", id: piece.id },
          from: slot.name + " · " + (piece.prize ? "Lumi-Soft prize · " + piece.how : grand(piece.rarity) + " · " + (piece.price ? "the Closet tab, " + sgc("pet", piece.id, piece.price) + " SGC" : "from a capsule")) }); // A game prize has no rarity.
      });
    });
    const toys = ((snap.catalog || {}).toys || []).map(function (toy) {
      return { id: toy.id, name: toy.name, owned: (!toy.price && !toy.rarity) || pet.toys.indexOf(toy.id) >= 0, art: { kind: "glyph", glyph: toy.icon },
        from: toy.rarity ? grand(toy.rarity) + " · from a capsule" : toy.price ? "the Shop, " + sgc("pet", toy.id, toy.price) + " SGC" : "came with Lumi" };
    });
    const mods = ((snap.battle || {}).mods || []).map(function (mod) {
      return { id: mod.id, name: mod.name, owned: pet.mods_owned.indexOf(mod.id) >= 0, art: { kind: "glyph", glyph: mod.tek === "magitek" ? "✦" : "⚙", colour: mod.tek === "magitek" ? "#b48cff" : "#70ebea" },
        from: grand(mod.tek) + " mod · " + (mod.price ? "Battle → Mods, " + sgc("battle", mod.id, mod.price) + " SGC" : "found in dungeon vaults") };
    });
    const garden = snap.garden || { flowers: [], decor: { owned: {} } };
    const flowers = garden.flowers.map(function (flower) {
      return { id: flower.id, name: flower.name, owned: flower.unlocked, art: { kind: "flower", id: flower.id },
        from: (flower.sort === "perennial" ? "Perennial" : "Cut flower") + " · " + (flower.stardust ? "boutique, for starpowder" : flower.coins ? sgc("garden", flower.id, flower.coins) + " SGC" : "every garden starts with it") + " · on the ladder of the garden you are in" };
    });
    const dressing = [];
    ((snap.garden_decor || {}).slots || []).forEach(function (slot) {
      slot.items.forEach(function (piece) {
        const count = (garden.decor.owned || {})[piece.id] || 0;
        dressing.push({ id: piece.id, name: piece.name, owned: count > 0, count: count, art: { kind: "decor", slot: slot.id, id: piece.id },
          from: slot.name + " · " + (piece.rarity === "shop" ? "Garden → Decorations, " + piece.stardust + " starpowder" : grand(piece.rarity) + " · from the " + capsule) });
      });
    });
    return [
      { id: "home", icon: "⌂", name: "For the house", about: "Bought, or won from capsules and Lumi-Soft", items: home },
      { id: "finds", icon: "🏆", name: "Dungeon finds", about: "Trophies and rare pieces from each place", items: finds },
      { id: "closet", icon: "🎀", name: "Things to wear", about: "Bought, or won from capsules and Lumi-Soft", items: clothes },
      { id: "toys", icon: "🧸", name: "Toys", about: "From the Shop and from capsules", items: toys },
      { id: "mods", icon: "⚙", name: "Mods", about: "Bought, or found in dungeon vaults", items: mods },
      { id: "flowers", icon: "❀", name: "Flowers", about: "The garden's flower tree, for the garden you are in", items: flowers },
      { id: "garden", icon: "✧", name: "Garden decorations", about: "Bought with starpowder, or won from the " + capsule, items: dressing },
    ].filter(function (shelf) { return shelf.items.length; });
  }

  function tally(items) { return items.filter(function (item) { return item.owned; }).length; }

  function totals(all) { // { have, total } over every shelf.
    return { have: all.reduce(function (sum, shelf) { return sum + tally(shelf.items); }, 0), total: all.reduce(function (sum, shelf) { return sum + shelf.items.length; }, 0) };
  }

  function view(snap, at) { // What is on the page now. at: { shelf (id), page, cursor }. Out-of-range values are brought back in.
    const all = shelves(snap), shelf = all.find(function (entry) { return entry.id === at.shelf; }) || all[0];
    const pages = Math.max(1, Math.ceil(shelf.items.length / PER_PAGE)), page = Math.max(0, Math.min(pages - 1, at.page || 0));
    const cells = shelf.items.slice(page * PER_PAGE, (page + 1) * PER_PAGE), cursor = Math.max(0, Math.min(cells.length - 1, at.cursor || 0));
    return { all: all, shelf: shelf, pages: pages, page: page, cells: cells, cursor: cursor, item: cells[cursor], have: tally(shelf.items) };
  }

  function move(seen, action) { // One arrow over the cells. Off the left or right edge turns the page. Returns { page, cursor }.
    const x = seen.cursor % COLUMNS, y = Math.floor(seen.cursor / COLUMNS), count = seen.cells.length;
    if (action === "left") return x ? { page: seen.page, cursor: seen.cursor - 1 } : seen.page ? { page: seen.page - 1, cursor: y * COLUMNS + COLUMNS - 1 } : { page: seen.page, cursor: seen.cursor };
    if (action === "right") {
      if (x < COLUMNS - 1 && seen.cursor + 1 < count) return { page: seen.page, cursor: seen.cursor + 1 };
      return seen.page < seen.pages - 1 ? { page: seen.page + 1, cursor: y * COLUMNS } : { page: seen.page, cursor: seen.cursor };
    }
    const to = seen.cursor + (action === "up" ? -COLUMNS : COLUMNS);
    return { page: seen.page, cursor: to < 0 ? seen.cursor : Math.min(to, count - 1) };
  }

  function lines(seen) { // The words above the list: the whole collection, the shelf, then the thing under the cursor.
    const all = totals(seen.all), item = seen.item;
    const out = ["Collected " + all.have + " of " + all.total + " · " + Math.floor(100 * all.have / Math.max(1, all.total)) + "% of everything there is to find",
      seen.shelf.name + ": " + seen.have + " of " + seen.shelf.items.length + (seen.pages > 1 ? " · page " + (seen.page + 1) + " of " + seen.pages : "")];
    if (item) out.push(item.name + (item.count > 1 ? " ×" + item.count : ""), item.owned ? "✓ In Lumi's collection" : "Not hers yet", item.from);
    return out;
  }

  function rows(ctx) { // ctx: { snap, at: { shelf, page, cursor }, zoom, go(change) }. The list beside the gallery.
    const seen = view(ctx.snap, ctx.at), go = ctx.go, here = seen.all.indexOf(seen.shelf);
    const list = [{ key: "look", icon: ctx.zoom ? "‹" : "🔍", name: ctx.zoom ? "Back to the shelf" : seen.item ? "Look at " + seen.item.name : "Nothing on this shelf yet",
      hint: seen.item ? (seen.item.owned ? "Hers" : "Not hers yet") + " · " + seen.item.from : seen.shelf.about, local: function () { go({ zoom: !ctx.zoom }); } }];
    seen.all.forEach(function (shelf, index) {
      list.push({ key: "shelf-" + shelf.id, icon: index === here ? "▸" : shelf.icon, name: shelf.name, hint: tally(shelf.items) + " of " + shelf.items.length + " · " + shelf.about, local: function () { go({ shelf: shelf.id }); } });
    });
    if (seen.pages > 1) {
      list.push({ key: "page-next", icon: "›", name: "Next page", hint: "Page " + (seen.page + 1) + " of " + seen.pages, local: function () { go({ page: (seen.page + 1) % seen.pages }); } });
      list.push({ key: "page-prev", icon: "‹", name: "Previous page", hint: "Page " + (seen.page + 1) + " of " + seen.pages, local: function () { go({ page: (seen.page + seen.pages - 1) % seen.pages }); } });
    }
    list.push({ key: "leave", icon: "♡", name: "Back to Lumi", hint: "An album: nothing here is bought or changed", local: function () { go({ leave: true }); } });
    return list;
  }

  return { COLUMNS: COLUMNS, ROWS: ROWS, PER_PAGE: PER_PAGE, shelves: shelves, totals: totals, view: view, move: move, lines: lines, rows: rows };
});
