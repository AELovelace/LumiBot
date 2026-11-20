/* Room mode (Doll's design, 2026-11-19): Lumi Pet without menus. Lumi walks through her flat, the kitchen, her
   bedroom and the den, and each thing in it stands for something to do: the fridge is the Pantry, the bed is a nap,
   the wardrobe is the Closet, the terminal is Settings. Like Microsoft Bob, with Lumi as the guide.

   Nothing here is new game logic. A thing opens a "card", which is the same rows the tab's list shows (game.js
   rows()), sometimes narrowed to a few of them (the potion shelf shows just the potion). So the lists and the rooms can
   never disagree. This file is pure: the rooms and their things, where Lumi stands, which way an arrow takes her,
   the rows of the room and of a card, and the invisible press boxes over the drawing (room-art.js draws the things).

   A room is one 1000 x 500 picture like her bedroom (house.js). Every screen shows about x 290-710 of it, so
   everything pressable sits there. Walking is "snap" walking: ◀ ▶ take her from one thing to the next, and past
   the last thing into the next room, so a TV remote never has to steer.

   Free walking (Doll's design, 2026-11-19, docs/plans/lumi-pet-social.md phase 1): held arrows, WASD, a gamepad, the
   Tab5's pad, and a middle-click walk her anywhere on the floor, left and right (x) and toward or away from the window
   (y, her feet: FRONT at the lower bar, BACK by the wall). Everything in the flat stands against the wall, so each
   thing blocks the floor from its front edge back to the wall: she walks into the gaps between things, never behind
   one, and is always drawn in front of whatever she overlaps. Things hung on the wall (`wall: true`) block nothing.
   A place is { room, at, x, y }: `at` is the spot she's at (the room's list cursor, her bubble), x and y where she
   stands. Snap walking still moves by `at` (x and y follow); free walking moves x and y (`at` follows). */
(function (root, make) {
  const node = typeof module === "object" && module.exports;                    // Node (the tests) or a page
  const ui = make(node ? require("./walker.js") : root.LumiWalker);             // the shared walker (walker.js, loaded before this file)
  if (node) module.exports = ui; else root.LumiPetRoom = ui;
})(typeof self !== "undefined" ? self : this, function (Walker) {
  "use strict";

  // The flat, left to right. Each thing: where Lumi stands to use it (x), its press box over the drawing [x, y, w, h],
  // which tab's rows it opens (tab), and optionally only some of them (keys), and what's said when that leaves none (empty).
  // Lumi's own words, always first person: `say` is her bubble over it in the lower bar (what it is), `open` what she
  // says when its menu opens. act: "door" goes straight out through her front door (no menu). In the bedroom, the boxes
  // sit over house.js's own furniture (its 400-wide block starts at x 300); in the kitchen and the den over room-art.js's things.
  // The Home menu's spots each room's paint pots show (the bedroom: all her own furniture, none of the other rooms').
  const KITCHEN_SPOTS = ["kitchen-wall", "kitchen-floor", "fridge", "bowl", "counter", "potions", "paints"];
  const DEN_SPOTS = ["den-wall", "den-floor", "wardrobe", "terminal", "capsules", "paints"];
  const ELSEWHERE = KITCHEN_SPOTS.concat(DEN_SPOTS).filter(function (spot) { return spot !== "paints"; });

  const ROOMS = [
    { id: "kitchen", name: "HER KITCHEN", things: [
      { id: "fridge", icon: "🧊", name: "My fridge", hint: "Snacks and treats", say: "My fridge! Snacks and treats live in here.", open: "Something tasty? I'll share!",
        x: 340, box: [283, 160, 115, 265], tab: "pantry" },
      { id: "bowl", icon: "🥣", name: "My bowl", hint: "Free snacks, always there", say: "My bowl! It's never, ever empty.", open: "Ooh, what's in my bowl today?",
        x: 470, box: [425, 375, 90, 58], tab: "pantry" },
      { id: "potions", icon: "🧪", name: "My potion shelf", hint: "Mends me after a fight", say: "My potions, for when I'm hurt after a fight.", open: "Glug glug!",
        x: 680, wall: true, box: [622, 180, 115, 160], tab: "care", keys: ["drink"], empty: "I'm fine just now! Potions are for after a fight." },
      { id: "paint", icon: "🎨", name: "My kitchen paint pots", hint: "Decorate my kitchen", say: "My paint pots! Let's make my kitchen pretty.", open: "What shall we change in here?",
        x: 785, box: [745, 350, 75, 82], tab: "home", keys: KITCHEN_SPOTS },
    ] },
    { id: "bedroom", name: "HER BEDROOM", things: [
      { id: "door", icon: "🚪", name: "My front door", hint: "Out into Lumi City", say: "My front door! Shall we go out into town?", open: "Off we go!", // erinne 43a24f4: her door opens on Lumi City
        x: 236, wall: true, box: [194, 192, 82, 166], act: "door" },
      { id: "toychest", icon: "🧸", name: "My toy chest", hint: "Play with my toys", say: "My toy chest! All my favourite toys.", open: "Playtime? Pick a toy, any toy!",
        x: 386, box: [346, 362, 82, 72], tab: "toys" },
      { id: "trophy", icon: "🏆", name: "My trophy shelf", hint: "Everything I've found and won", say: "My treasures! Everything I've found and won.", open: "Look at all my treasures!",
        x: 430, wall: true, box: [370, 95, 75, 55], tab: "collection" },
      { id: "paint", icon: "🎨", name: "My paint pots", hint: "Decorate my room", say: "My paint pots! Let's make my room pretty.", open: "What shall we change?",
        x: 505, box: [465, 385, 75, 50], tab: "home", skip: ELSEWHERE },
      { id: "bed", icon: "🛏", name: "My bed", hint: "Cuddles and naps", say: "My bed. Cuddles and naps happen here.", open: "A cuddle? Or a little nap?",
        x: 726, box: [665, 290, 125, 140], tab: "care" },
    ] },
    { id: "den", name: "THE DEN", things: [
      { id: "wardrobe", icon: "👗", name: "My wardrobe", hint: "My clothes", say: "My wardrobe! So many outfits.", open: "What shall I wear?",
        x: 310, box: [240, 155, 140, 275], tab: "closet" },
      { id: "terminal", icon: "🖥", name: "My terminal", hint: "My name, colour, sound and reminders", say: "My terminal. Beep boop, my settings!", open: "Beep boop! What shall we change?",
        x: 500, box: [440, 245, 120, 185], tab: "settings" },
      { id: "paint", icon: "🎨", name: "My den paint pots", hint: "Decorate my den", say: "My paint pots! Let's make my den pretty.", open: "What shall we change in here?",
        x: 605, box: [565, 350, 75, 82], tab: "home", keys: DEN_SPOTS },
      { id: "capsules", icon: "🎁", name: "My capsule machine", hint: "Capsules, furniture and clothes", say: "My capsule machine! What's inside this time?", open: "Turn the handle... what's inside?",
        x: 690, box: [640, 205, 105, 225], tab: "shop" },
    ] },
  ];
  const START = { room: "bedroom", at: 4 }; // A first visit: by the paint pots (layout index: after the way to the kitchen), about where she always stood.
  const EDGE = { left: 180, right: 820 };    // Where she stands on a "next room" row: at the edge she'll walk through.
  const REACH = [150, 850];                  // The stretch of each room with things in it: a narrow screen pans within it to follow her (game.js roomPan).

  function room(id) { return ROOMS.find(function (r) { return r.id === id; }) || ROOMS[1]; } // An unknown room is her bedroom.
  function index(id) { return ROOMS.indexOf(room(id)); } // A room's place in the flat, left to right.

  function way(to, side) { // A spot at a room's edge that walks through to the next room, in Lumi's words.
    const short = to.name.replace(/^HER |^THE /, "").toLowerCase(), mine = to.name.indexOf("HER ") === 0; // "kitchen"; and whose it is
    return { go: to.id, side: side, x: EDGE[side], icon: side === "left" ? "◀" : "▶", name: "To " + (mine ? "my " : "the ") + short, hint: "Walk through",
             say: "This way to " + (mine ? "my " : "the ") + short + "!" };
  }

  function layout(id) { // A room's spots in walking order: a way into the room on the left, its things, a way on the right.
    const i = index(id), out = [];
    if (i > 0) out.push(way(ROOMS[i - 1], "left"));
    room(id).things.forEach(function (thing) { out.push(thing); });
    if (i < ROOMS.length - 1) out.push(way(ROOMS[i + 1], "right"));
    return out;
  }

  // ---- Free walking's floor (all in the room's 1000 x 500 drawing units).
  const FRONT = 430, BACK = 372;      // Her feet: at the front (just above the lower bar) and furthest back (by the wall, which meets the floor at y 352).
  const HALF = 26;                    // Half her width at her feet: how close she may come to a thing's side.
  const NEAR = 30;                    // A thing is in reach when she stands within this of its sides (or in front of it).
  const SHRINK = 0.18;                // How much smaller she is at the back than at the front.
  const EXTRA = { kitchen: [[540, 660, 412]] }; // Blocks that aren't things: the kitchen counter (room-art.js PLACE), [left, right, front].

  function blocks(id) { // Each floor-standing thing's patch of floor, [left, right, front]: from its front edge back to the wall.
    const out = room(id).things.filter(function (t) { return !t.wall; }).map(function (t) {
      return [t.box[0], t.box[0] + t.box[2], Math.min(FRONT - 6, t.box[1] + t.box[3] - 14)]; // its press box's foot, a little in (shadows and bases overlap)
    });
    return out.concat(EXTRA[id] || []);
  }

  function free(id, x, y) { // May she stand with her feet at x, y? (Never inside a thing's patch of floor.)
    return !blocks(id).some(function (b) { return x > b[0] - HALF && x < b[1] + HALF && y < b[2]; });
  }

  function settle(id, x, y) { // The nearest y in front of x, y where she may stand (FRONT always is: every patch ends above it).
    let feet = Math.max(BACK, Math.min(FRONT, y));
    while (!free(id, x, feet) && feet < FRONT) feet = Math.min(FRONT, feet + 2);
    return feet;
  }

  function spotNear(id, x) { // The spot nearest x (things and the ways through): her bubble and the list cursor while she walks.
    let best = 0, gap = Infinity;
    layout(id).forEach(function (s, i) { const d = Math.abs(s.x - x); if (d < gap) { gap = d; best = i; } });
    return best;
  }

  function clean(at) { // A remembered place (this device's G.store) made safe: a real room, a spot in it, and where she stands.
    // An old save ({room, at}) or a snap move stands her at the spot (at the front); a free walk's ({room, x, y}) keeps her there.
    const id = at && typeof at.room === "string" ? room(at.room).id : START.room, spots = layout(id);
    if (at && Number.isFinite(at.x)) {
      const x = Math.max(EDGE.left, Math.min(EDGE.right, at.x)), y = settle(id, x, Number.isFinite(at.y) ? at.y : FRONT);
      const near = reachAt(id, x);                                     // her spot: the thing in reach, else the nearest spot
      return { room: id, at: near >= 0 ? near : spotNear(id, x), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }
    const n = at && Number.isInteger(at.at) ? at.at : START.at, i = Math.max(0, Math.min(spots.length - 1, n));
    return { room: id, at: i, x: spots[i].x, y: FRONT };
  }

  function move(at, dx, dy) { // Free walking: one step by dx, dy. Each axis on its own, so she slides along a thing she bumps;
    // past a side edge she walks through to the next room (at the same depth), and the flat's ends stop her.
    const here = clean(at), id = here.room;
    const depth = Math.max(BACK, Math.min(FRONT, here.y + (dy || 0))) - here.y; // the step in depth, kept on the floor
    const went = Walker.slide(function (fx, fy) { return free(id, fx, fy); }, here, dx || 0, depth); // the shared walker: each axis on its own, sliding along a thing she bumps
    const x = went.x, y = went.y;
    const i = index(id), side = x < EDGE.left ? -1 : x > EDGE.right ? 1 : 0;
    if (side && ROOMS[i + side]) {                                      // through to the next room, just inside its other edge
      const to = ROOMS[i + side].id, nx = side < 0 ? EDGE.right - 4 : EDGE.left + 4;
      return clean({ room: to, x: nx, y: settle(to, nx, y) });
    }
    return clean({ room: id, x: x, y: y });                             // (clean keeps her inside the flat's ends)
  }

  function reachAt(id, x) { // The thing in reach at x in room id (its layout index), or -1: the one within NEAR whose spot is closest.
    let best = -1, gap = Infinity;
    layout(id).forEach(function (s, i) {
      if (s.go) return;
      const d = Math.abs(x - s.x), inside = x >= s.box[0] - NEAR && x <= s.box[0] + s.box[2] + NEAR;
      if (inside && d < gap) { gap = d; best = i; }
    });
    return best;
  }

  function reach(at) { const here = clean(at); return reachAt(here.room, here.x); } // The thing in reach where she stands, or -1.

  function scale(y) { return 1 - SHRINK * (FRONT - Math.max(BACK, Math.min(FRONT, y))) / (FRONT - BACK); } // Her size at feet y: 1 at the front.

  function point(id, x, y) { // Where a press on the floor walks her: inside the room's walking stretch and floor band.
    return { room: room(id).id, x: Math.max(EDGE.left, Math.min(EDGE.right, x)), y: Math.max(BACK, Math.min(FRONT, y)) };
  }

  function enter(id, side) { // Arriving in a room from one side: standing at the first thing on that side (not on the way back out).
    const spots = layout(id), things = spots.map(function (s, i) { return s.go ? -1 : i; }).filter(function (i) { return i >= 0; });
    return clean({ room: id, at: side === "right" ? things[things.length - 1] : things[0] }); // (x and y: at that thing, at the front)
  }

  function step(at, by) { // ◀ (-1) or ▶ (+1): the next spot that way. A "next room" spot walks straight through; the flat's ends stop her.
    const here = clean(at), spots = layout(here.room), to = here.at + by;
    if (to < 0 || to >= spots.length) return here;               // the end of the flat
    const spot = spots[to];
    return spot.go ? enter(spot.go, by > 0 ? "left" : "right") : clean({ room: here.room, at: to });
  }

  function hop(at, by) { // ⏮ ⏭: the whole next room that way (or stay, at the flat's ends).
    const here = clean(at), i = index(here.room) + by;
    if (i < 0 || i >= ROOMS.length) return here;
    return enter(ROOMS[i].id, by > 0 ? "left" : "right");
  }

  function spot(at) { const here = clean(at); return layout(here.room)[here.at]; } // What she's standing at.

  function rows(at, ctx) { // The room's own list (no card open): one row per spot, so a remote, a keyboard and a screen reader all reach everything.
    // ctx.open(thing, index): open its card (game.js); ctx.walk(state): go to another room; ctx.door(): out of the front door.
    const here = clean(at);
    return layout(here.room).map(function (s, i) {
      if (s.go) return { key: "go-" + s.go, icon: s.icon, name: s.name, hint: s.hint, say: s.say, local: function () { ctx.walk(enter(s.go, s.side === "left" ? "right" : "left")); } };
      return { key: "thing-" + s.id, icon: s.icon, name: s.name, hint: s.hint, say: s.say, local: function () { if (s.act === "door") ctx.door(); else ctx.open(s, i); } };
    });
  }

  function cardRows(list, thing, back, open) { // A card: the tab's rows (only `keys`, or all but `skip`), then the way back to the room.
    // `open`: a spot's own full list is open (Home), so its pieces all show; the narrowing is for the list of spots.
    const keep = function (row) { return thing.keys ? thing.keys.indexOf(row.key) >= 0 : thing.skip ? thing.skip.indexOf(row.key) < 0 : true; };
    const shown = open ? list.slice() : list.filter(keep);
    if (!shown.length) shown.push({ key: "card-empty", icon: thing.icon, name: thing.name, hint: thing.empty || "Nothing here just now", note: thing.empty || "Nothing here just now." });
    shown.push({ key: "card-back", icon: "↩", name: "Back to the room", hint: "Escape, Back or B does it too", local: back });
    return shown;
  }

  function guide(at, thing) { // Lumi's words for a spot (her bubble in the lower bar), or for an open menu (`thing`): always first person.
    const s = thing || spot(at);
    return !s ? "" : thing ? s.open || s.say : s.say;
  }

  function hits(id, at) { // Invisible press boxes over a room's things (game.js listens for data-click="thing:id" and "go:room"),
    // and her soft shadow on the floor where she's standing (Doll, 2026-11-19: a shadow, not a dashed ring, so she stands
    // on the floor instead of floating). All authored here.
    // `at`: a spot's index (snap), or a place {x, y} (free walking). The shadow has id lp-rm-shadow, so game.js can slide
    // it as she walks (shadow()) without redrawing the room; the thing in reach gets class lp-rm-near (its glow).
    const here = typeof at === "object" && at ? clean(Object.assign({}, at, { room: id })) : clean({ room: id, at: at });
    const near = reach(here), nearId = near >= 0 ? layout(id)[near].id : null;
    let out = "";
    room(id).things.forEach(function (t) {
      out += '<rect x="' + t.box[0] + '" y="' + t.box[1] + '" width="' + t.box[2] + '" height="' + t.box[3] + '" rx="10" fill="transparent" class="lp-rm-hit' + (t.id === nearId ? " lp-rm-near" : "") + '" data-click="thing:' + t.id + '"/>';
    });
    const r = shadow(here);
    out += '<defs><radialGradient id="lp-rm-shade"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".55" stop-color="#000" stop-opacity=".3"/>' + // dark under her,
      '<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' +                                                  // fading out at the edge: a cheap soft shadow
      '<ellipse id="lp-rm-shadow" class="lp-rm-shadow" cx="' + r.cx + '" cy="' + r.cy + '" rx="' + r.rx + '" ry="' + r.ry + '" fill="url(#lp-rm-shade)"/>';
    return out;
  }

  function shadow(at) { // Her shadow on the floor under her paws, smaller further back: {cx, cy, rx, ry} for game.js to move as she walks.
    const s = scale(at.y);
    return { cx: Math.round(at.x), cy: Math.round(at.y + 2), rx: Math.round(50 * s), ry: Math.round(11 * s) };
  }

  function find(id, thingId) { // A thing's place in its room's layout (a press on the drawing), or -1.
    return layout(id).findIndex(function (s) { return s.id === thingId; });
  }

  function nearest(id, x) { // The spot nearest a press on the floor: she walks to the thing closest to it.
    let best = 0, gap = Infinity;
    layout(id).forEach(function (s, i) { const d = Math.abs(s.x - x); if (!s.go && d < gap) { gap = d; best = i; } });
    return best;
  }

  // ---- Visiting someone else's flat (lumihouse.py, docs/plans/lumi-pet-social.md phase 3): the same rooms and things,
  // but look-only. A visitor's own Lumi speaks, about the host's things (never "my"). {host}: their name; {lumi}: their Lumi's.
  const GUEST = {
    fridge: "No snacking from {host}'s fridge! Well... maybe one.", bowl: "That's {lumi}'s bowl. I won't touch it~",
    potions: "{host}'s potions! Such pretty bottles.", paint: "{host} decorated in here. So pretty!",
    toychest: "{lumi}'s toys! Maybe we can play together later.", trophy: "Look at all {lumi}'s treasures!",
    bed: "A comfy bed. Not mine though!", wardrobe: "{lumi} has such nice clothes!", terminal: "Beep boop? Better not touch.",
    capsules: "{host}'s capsule machine! What's inside, I wonder?",
  };
  function fill(words, names) { return words.replace(/\{host\}/g, names.host).replace(/\{lumi\}/g, names.lumi); }

  function guestLine(thing, names) { // What a visitor's Lumi says pressing one of the host's things (names: {host, lumi}).
    return thing.act === "door" ? "Back out into town? Thanks for having me!" : fill(GUEST[thing.id] || "Ooh, {host}'s things!", names);
  }

  function guestRows(at, ctx, names) { // A visitor's list of a room: the same spots, named for the host, look-only.
    // ctx.look(thing, index): walk to it and say guestLine; ctx.walk(state): another room; ctx.door(): leave the flat.
    const here = clean(at);
    return layout(here.room).map(function (s, i) {
      const theirs = { door: "front door", toychest: "toy chest", trophy: "trophy shelf", paint: "paint pots", bowl: "bowl" };
      if (s.go) {
        const to = room(s.go), short = to.name.replace(/^HER |^THE /, "").toLowerCase();
        return { key: "go-" + s.go, icon: s.icon, name: "To the " + short, hint: "Walk through", say: "This way to the " + short + "!",
                 local: function () { ctx.walk(enter(s.go, s.side === "left" ? "right" : "left")); } };
      }
      const noun = theirs[s.id] || s.name.replace(/^My (kitchen |den )?/, "").toLowerCase();
      return { key: "thing-" + s.id, icon: s.icon, name: names.host + "'s " + noun, hint: s.act === "door" ? "Back out into Lumi Town" : "Just looking",
               say: s.act === "door" ? "The way out, back to town." : fill(GUEST[s.id] || "{host}'s " + noun + ".", names),
               local: function () { if (s.act === "door") ctx.door(); else ctx.look(s, i); } };
    });
  }

  function tabs() { // Every tab some thing opens (tests: each of Lumi Pet's tabs must be reachable from a room).
    const out = [];
    ROOMS.forEach(function (r) { r.things.forEach(function (t) { if (t.tab && out.indexOf(t.tab) < 0) out.push(t.tab); }); });
    return out;
  }

  function neighbours(at) { // The rooms either side of where she is ({left, right}: a room or null), for the edge arrows.
    const i = index(clean(at).room);
    return { left: i > 0 ? ROOMS[i - 1] : null, right: i < ROOMS.length - 1 ? ROOMS[i + 1] : null };
  }

  return { ROOMS: ROOMS, START: START, REACH: REACH, KITCHEN_SPOTS: KITCHEN_SPOTS, DEN_SPOTS: DEN_SPOTS, room: room, layout: layout, clean: clean, enter: enter, step: step, hop: hop, spot: spot,
           rows: rows, cardRows: cardRows, guide: guide, hits: hits, find: find, nearest: nearest, tabs: tabs, neighbours: neighbours,
           FRONT: FRONT, BACK: BACK, blocks: blocks, free: free, move: move, reach: reach, scale: scale, point: point, shadow: shadow, // free walking
           guestRows: guestRows, guestLine: guestLine }; // visiting
});
