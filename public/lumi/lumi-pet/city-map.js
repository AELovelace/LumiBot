/* Lumi City's map (Doll's design, 2026-11-19; docs/plans/lumi-city.md): one long city seen from above at a tilt.
   LefTown on the left, Downtown in the middle, Right-City on the right, and a gate at each far end.

   The map is tiles (mnemerynne/lumipet_data/city.json, sent by GET city as `layout`). Columns are signed: Downtown's
   first column is downtown.x0, LefTown's block n always sits at the same columns to its left and Right-City's to its
   right, so when a town fills and grows a block at its gate, nothing already built moves: every address, every door
   and every walk from Downtown stays where it was. The gate moves out with the town, and arriving through it always
   puts her on the same tile just inside it (gate.arrive).

   This file is pure (no page): it builds the map for the current number of blocks, says where a Lumi may stand,
   finds the doors, the street names and addresses, the stops a TV remote hops between, and a route from anywhere to
   anywhere ("Go to…"). city-art.js draws it; game.js walks her on it with walker.js. */
(function (root, make) {
  const node = typeof module === "object" && module.exports;                // Node (the tests) or a page
  const city = make(node ? require("./walker.js") : root.LumiWalker);       // the shared walker
  if (node) module.exports = city; else root.LumiCity = city;
})(typeof self !== "undefined" ? self : this, function (Walker) {
  "use strict";

  const HALF = 14;   // Half a Lumi's width at her feet, in drawing units: how close she may come to a wall or a hedge.
  const NEAR = 44;   // A door is in reach when her feet are this close to its doorstep (across), and within REACH_Y in depth.
  const REACH_Y = 30;
  const ROMAN = ["", "", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"]; // a street name's second, third... time round

  function placeNames() { // Each Downtown place's name and what Lumi says about it (the server's ids, city.json's letters).
    return {
      "lobby-l": { name: "Lumi Heights West", icon: "🏢", hint: "Apartments for LefTown folk: the lobby, the lift and everyone's front doors" },
      "lobby-r": { name: "Lumi Heights East", icon: "🏢", hint: "Apartments for Right-City folk: the lobby, the lift and everyone's front doors" },
      arcade: { name: "Arcade", icon: "🕹", hint: "Yarn Pop, Lumi Conga, Teacup Tower, Prism Drop and Lumi Launch" },
      tavern: { name: "Tavern", icon: "🗝", hint: "The Lantern & Paw: dungeon trips, the arena and skills (Lumi Dungeons)" },
      office: { name: "Real-estate office", icon: "🏡", hint: "Buy a plot, sell yours, house styles, yard things and the Keepsake Capsule" },
      casino: { name: "Casino", icon: "🎰", hint: "Lumi's Lounge: Blackjack, Roulette, Horse Racing and Slots" },
      market: { name: "Market", icon: "🧺", hint: "The general store, the capsule machines, the seed stall and garden things" },
      cafe: { name: "Retro café", icon: "☕", hint: "Console games from the Games folder, with a cocoa (Media → Retro)" },
      garden: { name: "Garden gate", icon: "🌸", hint: "The Stardust Garden: flowers, starpowder and the press (Lumi's Garden)" },
      field: { name: "Lumi-Soft field", icon: "🎯", hint: "Pop cardboard creatures through the Star Scope" },
    };
  }
  const PLACES = placeNames();

  function laneName(layout, town, block) { // A block's own street (its cross lane), e.g. "Daisy Lane", "Daisy Lane II" once the list runs out.
    const lanes = layout.towns[town].lanes, n = lanes.length, round = Math.floor((block - 1) / n) + 1; // which time round the list
    return lanes[(block - 1) % n] + (round > 1 ? ROMAN[round] || " " + round : ""); // (the first time round has no number)
  }

  function rects(rows, keys) { // Every letter's footprint in a block of rows: {letter: [col, row, width, height]} (city.json keeps each a solid rectangle).
    const out = {};
    rows.forEach(function (line, r) {
      for (let c = 0; c < line.length; c++) {
        const k = line[c];
        if (keys.indexOf(k) < 0) continue;                              // not one we're after
        const box = out[k];
        if (!box) { out[k] = [c, r, 1, 1]; continue; }                  // its first tile
        box[2] = Math.max(box[2], c - box[0] + 1); box[3] = Math.max(box[3], r - box[1] + 1); // grow it to cover this tile
      }
    });
    return out;
  }

  /* The whole city for the current number of blocks in each town: towns = {left: n, right: n}. Returns:
     {layout, tile [w, h], rows, x0, x1 (columns x0 .. x1-1), grid (row strings, column c at grid[r][c - x0]),
      chunks [{id, kind: downtown|block|gate, town, block, c0, c1}], lots [...], places [...], signs [...], gates {left, right}} */
  function build(layout, towns) {
    const tw = layout.tile[0], th = layout.tile[1], R = layout.rows;
    const left = Math.max(1, towns && towns.left || layout.start_blocks), right = Math.max(1, towns && towns.right || layout.start_blocks);
    const down = layout.downtown, dw = down.rows[0].length, bw = layout.template.rows[0].length, gw = layout.gate.rows[0].length;
    const chunks = [];                                                   // left to right
    const lx = down.x0 - left * bw - gw;                                 // the city's first column: LefTown's gate
    chunks.push({ id: "l" + (left + 1), kind: "gate", town: "left", block: left + 1, c0: lx, c1: lx + gw });
    for (let b = left; b >= 1; b--) { const c0 = down.x0 - b * bw; chunks.push({ id: "l" + b, kind: "block", town: "left", block: b, c0: c0, c1: c0 + bw }); }
    chunks.push({ id: "down", kind: "downtown", town: null, block: 0, c0: down.x0, c1: down.x0 + dw });
    for (let b = 1; b <= right; b++) { const c0 = down.x0 + dw + (b - 1) * bw; chunks.push({ id: "r" + b, kind: "block", town: "right", block: b, c0: c0, c1: c0 + bw }); }
    const rx = down.x0 + dw + right * bw;                                // Right-City's gate
    chunks.push({ id: "r" + (right + 1), kind: "gate", town: "right", block: right + 1, c0: rx, c1: rx + gw });
    const x0 = lx, x1 = rx + gw;
    const grid = [];
    for (let r = 0; r < R; r++) { // Each row of the whole city, chunk by chunk.
      grid.push(chunks.map(function (ch) {
        if (ch.kind === "downtown") return down.rows[r];
        if (ch.kind === "gate") return ch.town === "left" ? layout.gate.rows[r].split("").reverse().join("") : layout.gate.rows[r]; // (the arch side outward)
        return layout.template.rows[r];
      }).join(""));
    }
    const lots = [], places = [], signs = [];
    const lotKeys = layout.template.lots.map(function (l) { return l.key; });
    const lotRects = rects(layout.template.rows, lotKeys);
    chunks.forEach(function (ch) {
      if (ch.kind === "block") {
        const lane = laneName(layout, ch.town, ch.block), townName = layout.towns[ch.town].name;
        layout.template.lots.forEach(function (l) {
          const box = lotRects[l.key], c0 = ch.c0 + box[0];
          lots.push({ id: ch.town[0] + "-" + ch.block + "-" + l.lot, town: ch.town, block: ch.block, lot: l.lot, frontage: l.frontage, chunk: ch.id,
            rect: [c0, box[1], box[2], box[3]], box: { x: c0 * tw, y: box[1] * th, w: box[2] * tw, h: box[3] * th },
            door: { x: (c0 + box[2] / 2) * tw, y: (box[1] + box[3] + 0.5) * th }, lane: lane,
            address: l.lot + " " + lane + ", " + townName });
        });
        signs.push({ id: "sign-" + ch.id, chunk: ch.id, x: (ch.c0 + 0.5) * tw, y: (layout.avenue[0] - 0.5) * th, words: lane,
          town: ch.town, block: ch.block });                             // at the corner where its lane meets the avenue
      } else if (ch.kind === "downtown") {
        const found = rects(down.rows, Object.keys(down.places));
        Object.keys(down.places).forEach(function (k) {
          const p = down.places[k], box = found[k], c0 = ch.c0 + box[0];
          places.push(Object.assign({ id: p.id, key: k, build: p.build, town: p.town || null, chunk: ch.id,
            rect: [c0, box[1], box[2], box[3]], box: { x: c0 * tw, y: box[1] * th, w: box[2] * tw, h: box[3] * th },
            door: { x: (c0 + box[2] / 2) * tw, y: (box[1] + box[3] + 0.5) * th } }, PLACES[p.id] || { name: p.id, icon: "🏠", hint: "" }));
        });
        signs.push({ id: "sign-down", chunk: ch.id, x: (ch.c0 + dw / 2) * tw, y: (layout.avenue[1] + 1.5) * th, words: down.street, town: null, block: 0 });
      }
    });
    const arrive = layout.gate.arrive;                                   // [column from the outer edge, row] inside a gate
    const gates = {
      left: { town: "left", chunk: chunks[0].id, edge: x0 * tw, arrive: { x: (x0 + arrive[0] + 0.5) * tw, y: (arrive[1] + 0.5) * th },
              x: (x0 + 0.5) * tw, y: (layout.avenue[0] + 1) * th },
      right: { town: "right", chunk: chunks[chunks.length - 1].id, edge: x1 * tw, arrive: { x: (x1 - arrive[0] - 0.5) * tw, y: (arrive[1] + 0.5) * th },
               x: (x1 - 0.5) * tw, y: (layout.avenue[0] + 1) * th },
    };
    return { layout: layout, tile: [tw, th], rows: R, x0: x0, x1: x1, grid: grid, chunks: chunks, lots: lots, places: places, signs: signs, gates: gates,
             towns: { left: left, right: right }, width: (x1 - x0) * tw, height: R * th };
  }

  function sym(map, c, r) { // The symbol at column c, row r ("T" off the map: nobody walks off the edge).
    if (r < 0 || r >= map.rows || c < map.x0 || c >= map.x1) return "T";
    return map.grid[r][c - map.x0];
  }

  function walkable(map, c, r) { return map.layout.walk.indexOf(sym(map, c, r)) >= 0; } // May a Lumi stand on this tile?

  function tileOf(map, x, y) { return { c: Math.floor(x / map.tile[0]), r: Math.floor(y / map.tile[1]) }; } // The tile under a point.

  function free(map, x, y) { // May her feet be at x, y? Both sides of her feet on walkable tiles.
    const tw = map.tile[0], th = map.tile[1], r = Math.floor(y / th);
    return walkable(map, Math.floor((x - HALF) / tw), r) && walkable(map, Math.floor((x + HALF) / tw), r) && walkable(map, Math.floor(x / tw), r);
  }

  function freeFn(map) { return function (x, y) { return free(map, x, y); }; } // free() for walker.js

  function move(map, at, dx, dy) { return Walker.slide(freeFn(map), at, dx, dy); } // One free-walking step, sliding along walls.

  function chunkAt(map, x) { // Which part of the city a point is in (a block, Downtown, or a gate), or the nearest end.
    const c = Math.floor(x / map.tile[0]);
    return map.chunks.find(function (ch) { return c >= ch.c0 && c < ch.c1; }) || (c < map.x0 ? map.chunks[0] : map.chunks[map.chunks.length - 1]);
  }

  function district(map, x) { return chunkAt(map, x).id; } // Where she is for chat and who's nearby: "down", "l2", "r3" (a gate counts as the block after the last).

  function blockIndex(id) { // A district as a signed block number: Downtown 0, LefTown's -n, Right-City's +n (who's within one block).
    if (id === "down") return 0;
    const m = /^([lr])(\d+)$/.exec(id || "");
    return m ? (m[1] === "l" ? -1 : 1) * Number(m[2]) : 0;
  }

  function streetAt(map, x, y) { // The street she's on, in words: "Petal Avenue, LefTown", "Daisy Lane, LefTown", "Lumi Way, Downtown".
    const ch = chunkAt(map, x), row = Math.floor(y / map.tile[1]), L = map.layout;
    const onAvenue = row >= L.avenue[0] - 1 && row <= L.avenue[1] + 1; // the road and its two pavements
    if (ch.kind === "downtown") return (onAvenue ? L.downtown.street : "the plaza") + ", Downtown";
    const town = L.towns[ch.town];
    if (ch.kind === "gate") return town.name + " gate, " + town.avenue;
    return (onAvenue ? town.avenue : laneName(L, ch.town, ch.block)) + ", " + town.name;
  }

  function things(map) { // Everything she can walk up to and use: places' doors, lots' doors, street signs and the two gates.
    const out = [];
    map.places.forEach(function (p) { out.push({ kind: "place", id: p.id, x: p.door.x, y: p.door.y, place: p }); });
    map.lots.forEach(function (l) { out.push({ kind: "lot", id: l.id, x: l.door.x, y: l.door.y, lot: l }); });
    map.signs.forEach(function (s) { out.push({ kind: "sign", id: s.id, x: s.x, y: s.y, sign: s }); }); // (she reads it standing on the pavement at its foot)
    ["left", "right"].forEach(function (side) { const g = map.gates[side]; out.push({ kind: "gate", id: "gate-" + side, x: g.arrive.x + (side === "left" ? -map.tile[0] : map.tile[0]), y: g.arrive.y, gate: g }); });
    return out;
  }

  function reach(map, at, list) { // The thing in reach where she stands (closest doorstep within NEAR across and REACH_Y in depth), or null.
    let best = null, gap = Infinity;
    (list || things(map)).forEach(function (t) {
      const dx = Math.abs(at.x - t.x), dy = Math.abs(at.y - t.y);
      if (dx <= NEAR && dy <= REACH_Y && dx + dy < gap) { gap = dx + dy; best = t; }
    });
    return best;
  }

  function nearestFree(map, x, y) { // The walkable tile nearest a point (a press on a building walks her to the street in front), as its centre.
    const tw = map.tile[0], th = map.tile[1], start = tileOf(map, x, y);
    if (walkable(map, start.c, start.r) && free(map, x, y)) return { x: x, y: y };
    for (let ring = 1; ring < 40; ring++) { // rings of tiles further and further out, nearest first
      let best = null, gap = Infinity;
      for (let dc = -ring; dc <= ring; dc++) for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;    // only this ring
        const c = start.c + dc, r = start.r + dr, cx = (c + 0.5) * tw, cy = (r + 0.5) * th;
        if (!walkable(map, c, r) || !free(map, cx, cy)) continue;
        const d = Math.hypot(cx - x, cy - y);
        if (d < gap) { gap = d; best = { x: cx, y: cy }; }
      }
      if (best) return best;
    }
    return { x: map.gates.left.arrive.x, y: map.gates.left.arrive.y }; // (can't happen on a real map)
  }

  function clear(map, a, b) { // A straight walk from a to b stays on walkable ground (checked every few units).
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      if (!free(map, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)) return false;
    }
    return true;
  }

  function path(map, from, to) { // A route from one point to another along the streets: a list of points to walk through, the last one `to`
    // (or the nearest walkable spot to it). Breadth-first over tiles, then straightened wherever a straight line is clear. [] when already there.
    const tw = map.tile[0], th = map.tile[1];
    const goal = nearestFree(map, to.x, to.y), start = nearestFree(map, from.x, from.y);
    const a = tileOf(map, start.x, start.y), b = tileOf(map, goal.x, goal.y), W = map.x1 - map.x0;
    const key = function (c, r) { return (r * W) + (c - map.x0); };   // one number per tile
    const came = new Map(), queue = [[a.c, a.r]];
    came.set(key(a.c, a.r), null);
    while (queue.length) { // breadth-first: the first time the goal is reached is a shortest way in tiles
      const cur = queue.shift();
      if (cur[0] === b.c && cur[1] === b.r) break;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        const c = cur[0] + d[0], r = cur[1] + d[1], k = key(c, r);
        if (came.has(k) || !walkable(map, c, r)) return;
        came.set(k, cur); queue.push([c, r]);
      });
    }
    if (!came.has(key(b.c, b.r))) return [];                              // no way there (shouldn't happen: city.json is checked)
    const tiles = [];
    for (let cur = [b.c, b.r]; cur; cur = came.get(key(cur[0], cur[1]))) tiles.unshift(cur);
    const points = tiles.map(function (t) { return { x: (t[0] + 0.5) * tw, y: (t[1] + 0.5) * th }; });
    points[0] = start; points[points.length - 1] = goal;                  // begin where she is, end exactly at the spot
    const out = [];
    let here = points[0], i = 0;
    while (i < points.length - 1) { // straighten: from where she is, jump to the furthest point she can walk to in a straight line
      let j = points.length - 1;
      while (j > i + 1 && !clear(map, here, points[j])) j--;
      out.push(points[j]); here = points[j]; i = j;
    }
    return out;
  }

  function stops(map) { // The spots a TV remote's arrows hop between: every doorstep, sign and gate, and each lane's corners.
    const tw = map.tile[0], th = map.tile[1], out = things(map).map(function (t) { return { x: t.x, y: t.y, id: t.id }; });
    map.chunks.forEach(function (ch) { // where each block's lane crosses the back lanes and the bottom pavement
      if (ch.kind !== "block") return;
      for (let r = 0; r < map.rows; r++) {
        const across = walkable(map, ch.c0 + 1, r) && walkable(map, ch.c0, r); // a street going across meets the lane here
        if (across && (r < map.layout.avenue[0] - 1 || r > map.layout.avenue[1] + 1)) out.push({ x: (ch.c0 + 0.5) * tw, y: (r + 0.5) * th, id: "corner-" + ch.id + "-" + r });
      }
    });
    return out;
  }

  function step(map, at, dir) { // A remote's arrow ("left", "right", "up", "down"): the next stop that way, or null at the end.
    // Left and right look along her street first (the same depth, give or take a tile); up and down along her lane first.
    const th = map.tile[1], tw = map.tile[0], all = stops(map);
    const ahead = all.filter(function (s) {
      if (dir === "left") return s.x < at.x - 8;
      if (dir === "right") return s.x > at.x + 8;
      if (dir === "up") return s.y < at.y - 8;
      return s.y > at.y + 8;
    });
    const along = ahead.filter(function (s) { return dir === "left" || dir === "right" ? Math.abs(s.y - at.y) <= th * 1.2 : Math.abs(s.x - at.x) <= tw * 1.6; });
    const pool = along.length ? along : ahead;                           // her own street first, else anywhere that way
    let best = null, gap = Infinity;
    pool.forEach(function (s) {
      const main = dir === "left" || dir === "right" ? Math.abs(s.x - at.x) : Math.abs(s.y - at.y);
      const side = dir === "left" || dir === "right" ? Math.abs(s.y - at.y) : Math.abs(s.x - at.x);
      const d = main + side * 2;                                         // straight on is better than off to one side
      if (d < gap) { gap = d; best = s; }
    });
    return best;
  }

  function hop(map, at, by) { // ⏮ ⏭: the next block that way (its street sign), or the gate at the end.
    const here = map.chunks.indexOf(chunkAt(map, at.x)), to = map.chunks[Math.max(0, Math.min(map.chunks.length - 1, here + by))];
    if (to.kind === "gate") { const g = map.gates[to.town]; return { x: g.arrive.x, y: g.arrive.y }; }
    const sign = map.signs.find(function (s) { return s.chunk === to.id; }), road = (map.layout.avenue[0] + 0.5) * map.tile[1]; // the avenue's first lane
    return sign ? { x: sign.x + map.tile[0] * (to.kind === "downtown" ? 0 : 1), y: road } : { x: (to.c0 + to.c1) / 2 * map.tile[0], y: road };
  }

  function arrive(map, at, home) { // Where a page opened at ?at=<id> starts her: a place's or a lot's doorstep, a gate, or (nothing given) her home town's gate.
    // Older addresses still work: "home" (her old house on the High Street) is her apartment building's lobby door.
    const town = home === "right" ? "right" : "left";
    let id = at || "";
    if (id === "home") id = town === "right" ? "lobby-r" : "lobby-l";
    const m = /^plot-([lr]-\d{1,3}-[1-8])$/.exec(id);
    if (m) { const lot = map.lots.find(function (l) { return l.id === m[1]; }); if (lot) return { x: lot.door.x, y: lot.door.y }; }
    if (id === "gate-left" || id === "gate-right") { const g = map.gates[id.slice(5)]; return { x: g.arrive.x, y: g.arrive.y }; }
    const place = map.places.find(function (p) { return p.id === id; });
    if (place) return { x: place.door.x, y: place.door.y };
    const g = map.gates[town];
    return { x: g.arrive.x, y: g.arrive.y };                             // fresh into town: through her own town's gate
  }

  function door(map, id) { // A place's or lot's doorstep by id (a place id, or a lot id like "l-2-5"), or null.
    const p = map.places.find(function (x) { return x.id === id; }) || map.lots.find(function (x) { return x.id === id; });
    return p ? { x: p.door.x, y: p.door.y } : null;
  }

  function nearestDoor(map, at) { // The id to put in the page's address (?at=) for where she stands: the closest doorstep, or a gate.
    let best = null, gap = Infinity;
    map.places.concat(map.lots).forEach(function (p) { const d = Math.hypot(p.door.x - at.x, p.door.y - at.y); if (d < gap) { gap = d; best = p; } });
    return best ? (best.lot ? "plot-" + best.id : best.id) : "gate-left";
  }

  function clean(map, at) { // A remembered spot made safe: on walkable ground (the nearest, if the map changed under it).
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
    return nearestFree(map, at.x, at.y);
  }

  return { HALF: HALF, NEAR: NEAR, PLACES: PLACES, build: build, laneName: laneName, sym: sym, walkable: walkable, free: free, freeFn: freeFn, move: move,
           chunkAt: chunkAt, district: district, blockIndex: blockIndex, streetAt: streetAt, things: things, reach: reach, nearestFree: nearestFree,
           path: path, stops: stops, step: step, hop: hop, arrive: arrive, door: door, nearestDoor: nearestDoor, clean: clean };
});
