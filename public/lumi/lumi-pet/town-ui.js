/* Lumi Town (Doll's design, 2026-11-12; Market Street 2026-11-14): the town behind her room's door, in two streets.

   The High Street: her house (Lumi Pet), the Lantern & Paw tavern (Lumi Dungeons), the Stardust Garden (Lumi's Garden),
   and three you walk into, each with its own list of games: the Arcade, the Casino (Lumi's Lounge tables) and the
   Lumi-Soft field. Market Street, off the right-hand end of it: the Retro café (Media → Retro) and the Market, whose
   stalls sell Lumi Pet's and Lumi's Garden's things right there in town (game.js builds the stalls' rows from the
   same lists the shops use).

   This file is the town's words and lists: which places there are, on which street, what is inside each, and the rows
   the page shows (game.js reads them like every other tab's rows). town-art.js draws it all. A game opened from the town
   comes back to it when it closes (media.js games.back), so "leaving" a game is walking back out into the town. */
(function (root, make) {
  const town = make();
  if (typeof module === "object" && module.exports) module.exports = town; else root.LumiPetTown = town;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The two streets, and the way between them: off the right-hand end of the High Street onto Market Street.
  const STREETS = {
    high: { id: "high", name: "High Street", other: "market", walk: "Walk to Market Street", hint: "The Retro café and the Market, just round the corner" },
    market: { id: "market", name: "Market Street", other: "high", walk: "Back to the High Street", hint: "The Arcade, the tavern, the Casino, her house, the garden and the field" },
  };

  // The places, street by street, each in its map's reading order (top row left to right, then the bottom row): the
  // list's order and the remote's. An `app` is one of Lumi's own apps, opened straight away (`going` is what she says
  // on the way, and `home` means leaving it doesn't come back here: it's her house); `retro` opens Media → Retro; `games`
  // are what a place's inside offers (the Market's are stalls: `stall` instead of a game's `slug`).
  const PLACES = [
    { id: "arcade", street: "high", icon: "🕹", name: "Arcade", hint: "Yarn Pop, Lumi Conga, Teacup Tower, Prism Drop and Lumi Launch", room: "THE ARCADE",
      hello: "Bleeps, bloops and a carpet full of stars. Which cabinet?",
      games: [
        { slug: "breakout", icon: "🧶", name: "Yarn Pop", hint: "Bounce Lumi off a cushion and pop every block" },
        { slug: "snake", icon: "💃", name: "Lumi Conga", hint: "Lead a conga line of Lumis round the room" },
        { slug: "teacup-tower", icon: "🫖", name: "Teacup Tower", hint: "Bounce up an endless tower of teacups" },
        { slug: "prism-drop", icon: "🔮", name: "Prism Drop", hint: "Drop her glowing ball through the blocks" },
        { slug: "lumi-launch", icon: "🎇", name: "Lumi Launch", hint: "Fire her from the star cannon and see how far she flies" },
      ] },
    { id: "tavern", street: "high", icon: "🗝", name: "Tavern", hint: "The Lantern & Paw: dungeon trips, the arena and skills (Lumi Dungeons)", app: "lumi-dungeons", going: "Into the Lantern & Paw! 🍺" },
    { id: "casino", street: "high", icon: "🎰", name: "Casino", hint: "Lumi's Lounge: Blackjack, Roulette, Horse Racing and Slots", room: "LUMI’S LOUNGE",
      hello: "Lumi's Lounge. The dealer winks. Pick a table.",
      games: [
        { slug: "blackjack", icon: "🂡", name: "Blackjack", hint: "Hit or stand, and beat Dealer Lumi" },
        { slug: "roulette", icon: "🎡", name: "Roulette", hint: "Pick a number and watch the wheel" },
        { slug: "horse-racing", icon: "🏇", name: "Horse Racing", hint: "Back a pony and cheer her home" },
        { slug: "slots", icon: "🎰", name: "Slot Machines", hint: "Three reels, three paylines" },
      ] },
    { id: "home", street: "high", icon: "🏠", name: "Lumi's house", hint: "Back to her room (Lumi Pet)", app: "lumi-pet", home: true, going: "Home again! 🏠" },
    { id: "garden", street: "high", icon: "🌸", name: "Garden", hint: "The Stardust Garden: flowers, starpowder and the press (Lumi's Garden)", app: "lumi-garden", going: "Through the gate into the Stardust Garden! 🌸" },
    { id: "field", street: "high", icon: "🎯", name: "Lumi-Soft field", hint: "Pop cardboard creatures through the Star Scope", room: "THE LUMI-SOFT FIELD",
      hello: "Soft grass, a comfy cushion, and cardboard creatures waiting in the long grass.",
      games: [
        { slug: "lumi-soft", icon: "🎯", name: "Lumi-Soft", hint: "Five stages, bosses and a Daily Range", desk: true },
      ] },
    { id: "cafe", street: "market", icon: "🕹", name: "Retro café", hint: "Console games from the Games folder, with a cocoa (Media → Retro)", retro: true, going: "Into the Retro café! 🕹☕" },
    { id: "market", street: "market", icon: "🧺", name: "Market", hint: "The general store, the capsule machines, the seed stall and garden things", room: "THE MARKET",
      hello: "Striped awnings, warm cookies and a humming capsule machine. Which stall?",
      games: [
        { stall: "store", icon: "🛒", name: "General store", hint: "Snacks, treats and toys for Lumi" },
        { stall: "capsules", icon: "🔮", name: "Capsule machines", hint: "Star, Moon and Seedling Capsules" },
        { stall: "seeds", icon: "🌱", name: "Seed stall", hint: "New flowers for the Stardust Garden" },
        { stall: "garden", icon: "🪴", name: "Garden things", hint: "Decorations for the Stardust Garden" },
      ] },
  ];

  function place(id) { return PLACES.find(function (p) { return p.id === id; }) || null; } // A place by its id, or null.

  function inside(id) { const p = place(id); return p && p.games ? p : null; } // A place you walk into (it has games or stalls), or null.

  function street(id) { return PLACES.filter(function (p) { return p.street === (STREETS[id] ? id : "high"); }); } // A street's places, in its map's order.

  function index(id) { const p = place(id); return Math.max(0, street(p ? p.street : "high").indexOf(p)); } // Where a place sits in its street's list.

  function arrive(at) { // Where a page opened at ?at=<place> starts: inside that place, or on its street's map in front of it.
    const p = place(at) || place("tavern");                 // No place given: in front of the tavern, the way out on an adventure.
    return { street: p.street, inside: p.games ? p.id : null, cursor: index(p.id) };
  }

  /* The town's list. ctx:
       at (the place she's inside, or null for a map), street ("high" or "market"),
       desk (a mouse and keyboard are here: Lumi-Soft needs both), away (she's out on a dungeon trip),
       retro (Media → Retro is turned on), seen (others see her in town: Settings' "Show me in town"),
       stall (the Market stall she's at, or null) and stallRows(id) (its rows: game.js builds them from the shops' lists),
       go({enter} | {leave} | {street} | {stall}) and open(slug, place, words),
       chat (local chat, 2026-11-19; optional): { on (the chat list is open), phrases [{id, icon, text}], people
       [{id, name, muted, block}] (who's here, to mute; block: a guest in her own flat), emotes [{id, icon, text}],
       open(), close(), say(phraseId), emote(id), type(), mute(id), block(id) },
       visit (friends' flats, 2026-11-19; optional): open the list of flats to visit (a row on each street's map). */
  function chatRows(chat) { // Chatting: the quick phrases (a remote or a pad can say them), typing, muting, and back.
    return chat.phrases.map(function (p) {
      return { key: "say-" + p.id, icon: p.icon, name: "“" + p.text + "”", hint: "Say it to everyone here", local: function () { chat.say(p.id); } };
    }).concat((chat.emotes || []).map(function (e) { // Emotes (phase 4): a little animation everyone here sees.
      return { key: "emote-" + e.id, icon: e.icon, name: e.text, hint: "Everyone here sees it", local: function () { chat.emote(e.id); } };
    })).concat([{ key: "say-type", icon: "⌨", name: "Type a message", hint: "T opens it too · Enter sends · Escape closes", local: function () { chat.type(); } }])
      .concat((chat.people || []).reduce(function (out, who) {
        out.push({ key: "mute-" + who.id, icon: who.muted ? "🔈" : "🔇", name: (who.muted ? "Unmute " : "Mute ") + who.name,
                   hint: who.muted ? "Hear what they say again" : "Stop seeing what they say, on this device", local: function () { chat.mute(who.id); } });
        if (who.block && chat.block) out.push({ key: "block-" + who.id, icon: "🚫", name: "Show " + who.name + " out", // (her own flat: a guest)
                   hint: "They go home and can't visit again (Settings can unblock)", local: function () { chat.block(who.id); } });
        return out;
      }, []))
      .concat([{ key: "say-back", icon: "‹", name: "Back", hint: "Escape, Back or B does it too", local: function () { chat.close(); } }]);
  }

  function sayRow(chat) { // The way into chatting, on a street's map and inside a place.
    return { key: "say", icon: "💬", name: "Say something", hint: "Everyone here hears it: a phrase, or type your own", local: function () { chat.open(); } };
  }

  function rows(ctx) {
    if (ctx.chat && ctx.chat.on) return chatRows(ctx.chat);
    const said = ctx.chat ? [sayRow(ctx.chat)] : [];
    const flats = ctx.visit ? [{ key: "flats", icon: "🏠", name: "Visit a friend's flat", hint: "Knock on someone's door, or walk in where it's open", local: function () { ctx.visit(); } }] : [];
    const here = inside(ctx.at);
    if (!here) { // A map: one row per place on this street, the way to the other street, and whether others see her here.
      const way = STREETS[ctx.street] || STREETS.high;
      return street(way.id).map(function (p) {
        const hint = p.id === "tavern" && ctx.away ? "Lumi is out exploring: find her in the Lantern & Paw" : p.hint;
        const row = { key: "place-" + p.id, icon: p.icon, name: p.name, hint: hint };
        if (p.retro && !ctx.retro) row.note = "The Retro café is closed: an admin opens it by turning Retro on (Settings → Entertainment → Media → Retro).";
        else row.local = function () { ctx.go({ enter: p.id }); };
        return row;
      }).concat([
        { key: "street-" + way.other, icon: way.id === "high" ? "➜" : "⬅", name: way.walk, hint: way.hint, local: function () { ctx.go({ street: way.other }); } },
        { key: "seen", icon: "👀", name: "Show me in town: " + (ctx.seen === false ? "off" : "on"),
          hint: ctx.seen === false ? "Nobody sees your Lumi here, and you still see theirs" : "Others in Lumi Town see your Lumi, in her clothes, with her name", send: { action: "town_seen" } },
      ]).concat(flats).concat(said);
    }
    if (here.id === "market" && ctx.stall) { // At a stall: what it sells (game.js), then back to the stalls.
      const stall = here.games.find(function (g) { return g.stall === ctx.stall; });
      return (ctx.stallRows ? ctx.stallRows(ctx.stall) : []).concat([
        { key: "stall-back", icon: "‹", name: "Back to the stalls", hint: stall ? "Away from the " + stall.name.toLowerCase() : "The Market's stalls", local: function () { ctx.go({ stall: null }); } }]);
    }
    return here.games.map(function (g) { // Inside: a row per game or stall, then the way back out.
      if (g.stall) return { key: "stall-" + g.stall, icon: g.icon, name: g.name, hint: g.hint, local: function () { ctx.go({ stall: g.stall }); } };
      const row = { key: "game-" + g.slug, icon: g.icon, name: g.name, hint: g.hint };
      if (g.desk && !ctx.desk) row.note = g.name + " needs a mouse and keyboard: play it on a computer."; // A TV remote or a phone can't aim the Star Scope.
      else row.local = function () { ctx.open(g.slug, here.id, "Let's play " + g.name + "! ✨"); };
      return row;
    }).concat(said).concat([{ key: "leave", icon: "🗺", name: "Back to " + (here.street === "market" ? "Market Street" : "the town map"), hint: "Out the door and into Lumi Town", local: function () { ctx.go({ leave: true }); } }]);
  }

  return { STREETS: STREETS, PLACES: PLACES, place: place, inside: inside, street: street, index: index, arrive: arrive, rows: rows, chatRows: chatRows };
});
