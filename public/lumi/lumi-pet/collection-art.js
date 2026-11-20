/* The art for the Collection tab: a gallery of little pictures over the room, a page of 36 at a time, with the
   shelves along the top. A thing Lumi has is drawn in its colours; one she doesn't have yet is a grey shape with a
   question mark. Looking at one draws it large.

   Every picture is the thing's own drawing from the file that already draws it in the game (house.js, closet.js,
   garden-art.js), placed in a small frame of its own. Those drawings sit wherever they belong in a room or a
   garden, so each frame is marked data-thumb and game.js fits it round its drawing once it is on the page
   (fitThumbs). Shapes with data-click are where a mouse or finger can press. */
(function (root, make) {
  const node = typeof module === "object" && module.exports;
  const art = make(node ? require("./collection-ui.js") : root.LumiPetCollection, node ? require("./house.js") : root.LumiPetHouse,
    node ? require("./closet.js") : root.LumiPetCloset, node ? require("./garden-art.js") : root.LumiPetGardenArt);
  if (node) module.exports = art; else root.LumiPetCollectionArt = art;
})(typeof self !== "undefined" ? self : this, function (UI, House, Closet, Garden) {
  "use strict";

  const INK = "#0d0a1a", LEFT = 349, TOP = 98, CELL_W = 48, CELL_H = 52, GAP = 3;

  function rect(x, y, w, h, fill, more) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (more || "") + "/>"; }
  function text(x, y, words, size, fill, more) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' + (more || "") + ">" + words + "</text>"; }
  function own(table, key) { return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null; }

  function drawing(item, snap) { // The thing's own drawing, wherever its file puts it. "" if that file doesn't know it.
    const how = item.art;
    if (how.kind === "house") { const draw = own(House.ART, how.id); return draw ? draw() : ""; }
    if (how.kind === "closet") { const worn = own(Closet.ART, how.id); return worn ? worn.svg : ""; }
    if (how.kind === "flower") { const flower = ((snap.garden || {}).flowers || []).find(function (one) { return one.id === how.id; }); return flower ? Garden.bloom(flower) : ""; }
    if (how.kind === "decor") return Garden.piece(how.slot, how.id, snap.garden_decor);
    return "";
  }

  function picture(item, snap, x, y, size) { // One thing in a frame of this size. Glyphs (toys, mods) are plain text; the rest are fitted later.
    const dim = item.owned ? "" : ' class="lp-unowned"';
    if (item.art.kind === "glyph") return "<g" + dim + ">" + text(x + size / 2, y + size * .68, item.art.glyph, size * .56, item.art.colour || "#f0deff") + "</g>";
    const inner = drawing(item, snap);
    if (!inner) return text(x + size / 2, y + size * .62, "?", size * .4, "#6a648a");
    return '<svg data-thumb="' + item.id + '" x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" viewBox="0 0 400 500" overflow="hidden"><g' + dim + ">" + inner + "</g></svg>";
  }

  function scene(snap, look) { // look: { shelf, page, cursor, zoom, focused }
    const seen = UI.view(snap, look), all = UI.totals(seen.all);
    let out = rect(-100, 0, 1200, 500, INK, 'opacity=".92"');
    out += text(500, 52, "COLLECTION · " + all.have + " OF " + all.total, 11, "#ff8ecb", 'font-weight="700" letter-spacing="3" data-have="' + all.have + '"');
    const chip = 300 / seen.all.length;
    seen.all.forEach(function (shelf, index) { // The shelves, along the top.
      const x = 350 + index * chip, on = shelf === seen.shelf;
      out += rect(x + 1, 60, chip - 2, 26, on ? "#3d2450" : "#1a1530", 'rx="6" stroke="' + (on ? "#ff8ecb" : "#3a3550") + '" stroke-width="' + (on ? 1.6 : 1) + '" data-shelf="' + shelf.id + '"') +
        text(x + chip / 2, 73, shelf.icon, 9, on ? "#fff8dc" : "#8a86a8") + text(x + chip / 2, 82.5, shelf.items.filter(function (item) { return item.owned; }).length + "/" + shelf.items.length, 5, on ? "#ff8ecb" : "#6a648a") +
        rect(x, 58, chip, 30, "#000", 'fill-opacity="0" pointer-events="all" data-click="shelf:' + shelf.id + '"');
    });
    seen.cells.forEach(function (item, index) { // The page of cells.
      const x = LEFT + (index % UI.COLUMNS) * (CELL_W + GAP), y = TOP + Math.floor(index / UI.COLUMNS) * (CELL_H + GAP);
      out += rect(x, y, CELL_W, CELL_H, item.owned ? "#241d3a" : "#151226", 'rx="6" stroke="' + (item.owned ? "#8be9a8" : "#3a3550") + '" stroke-width="1" data-cell="' + (item.owned ? "have" : "missing") + '"') +
        picture(item, snap, x + 4, y + 3, CELL_W - 8) + (item.owned ? "" : text(x + CELL_W - 8, y + 12, "?", 9, "#8a86a8", 'font-weight="700"')) +
        (item.count > 1 ? text(x + 9, y + CELL_H - 5, "×" + item.count, 6, "#ffdc83", 'font-weight="700"') : "") +
        rect(x, y, CELL_W, CELL_H, "#000", 'fill-opacity="0" pointer-events="all" data-click="cell:' + index + '"');
    });
    if (!seen.cells.length) out += text(500, 250, "Nothing on this shelf yet", 10, "#8a86a8");
    if (look.focused !== false && seen.item && !look.zoom) {
      const x = LEFT + (seen.cursor % UI.COLUMNS) * (CELL_W + GAP), y = TOP + Math.floor(seen.cursor / UI.COLUMNS) * (CELL_H + GAP);
      out += rect(x - 2, y - 2, CELL_W + 4, CELL_H + 4, "none", 'rx="8" stroke="#70ebea" stroke-width="2.5" data-cursor="' + seen.cursor + '"');
    }
    if (seen.pages > 1) { // Turn the page.
      out += text(500, 455, "page " + (seen.page + 1) + " of " + seen.pages, 8, "#c9aecf", 'data-page="' + seen.page + '"') +
        text(420, 457, "‹", 16, seen.page ? "#70ebea" : "#3a3550") + rect(400, 438, 40, 28, "#000", 'fill-opacity="0" pointer-events="all" data-click="page:-1"') +
        text(580, 457, "›", 16, seen.page < seen.pages - 1 ? "#70ebea" : "#3a3550") + rect(560, 438, 40, 28, "#000", 'fill-opacity="0" pointer-events="all" data-click="page:1"');
    }
    if (look.zoom && seen.item) { // One thing, large.
      const item = seen.item;
      out += rect(352, 96, 296, 336, INK, 'opacity=".96" rx="14" stroke="' + (item.owned ? "#8be9a8" : "#6a648a") + '" stroke-width="2" data-zoom="' + item.id + '"') +
        picture(item, snap, 390, 112, 220) + text(500, 362, item.name.toUpperCase(), 10, "#fff8dc", 'font-weight="700" letter-spacing="1.5"') +
        text(500, 380, item.owned ? "✓ in Lumi's collection" + (item.count > 1 ? " ×" + item.count : "") : "not hers yet", 8, item.owned ? "#8be9a8" : "#c9aecf") +
        rect(352, 96, 296, 336, "#000", 'fill-opacity="0" pointer-events="all" data-click="zoom"');
    }
    return out;
  }

  return { scene: scene, picture: picture, drawing: drawing };
});
