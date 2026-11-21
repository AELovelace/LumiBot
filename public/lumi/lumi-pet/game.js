/* The companion's controls and presentation. Lumi lives on the account (mnemerynne/lumipet.py): this page only says
   what the person chose (which snack, which toy) and draws what the server answers. Her needs run down while away.

   One file for three apps (mnemerynne/games.py): Lumi Pet (her room: care, pantry, toys, closet, home, shop,
   collection), Lumi Dungeons (dungeon, battle, skills) and Lumi's Garden (garden). The page's tabs say which app this
   is (templates/games/lumi-pet.html), and everything here asks has("dungeon") and the like before offering a thing.
   They are one pet on one save, so all three talk to the same API. */
(function () {
  "use strict";
  const G = window.MGame, R = window.LumiPetRules, H = window.LumiPetHouse, E = window.LumiPetEnemies, Bt = window.LumiPetBattle, W = window.LumiPetCloset, Pk = window.LumiPetPicker, Gd = window.LumiPetGarden, Ga = window.LumiPetGardenArt, Sk = window.LumiPetSkills, Sa = window.LumiPetSkillsArt, Cl = window.LumiPetCollection, Ca = window.LumiPetCollectionArt, Dg = window.LumiPetDungeon, Da = window.LumiPetDungeonArt, Pu = window.LumiPetParty, GT = window.LumiPetGardenTree, GTa = window.LumiPetGardenTreeArt, Ta = window.LumiPetTavernArt, Tw = window.LumiPetTown, TwA = window.LumiPetTownArt, TF = window.LumiPetTownFolk, Ru = window.LumiPetRoom, RA = window.LumiPetRoomArt;
  const $ = function (id) { return document.getElementById(id); };
  const room = $("lp-room"), list = $("lp-list"), houseArt = $("lp-house"), tabButtons = Array.from(document.querySelectorAll("[data-lp-tab]"));
  const API = window.LUMI_API + "lumi-pet/", OLD_SAVE = "mnemerynne-game:lumi-pet:companion";
  const TABS = tabButtons.map(function (button) { return button.dataset.lpTab; }); // This app's tabs, e.g. Lumi Dungeons: dungeon, battle, skills, settings
  const APP = $("gm").dataset.game, NAME = $("gm").dataset.name; // Which of Lumi's apps this page is ("lumi-pet", "lumi-dungeons", "lumi-garden", "lumi-town") and its name.
  const APPS = { // Lumi's three apps, for the "Open ..." rows in Settings: icon, name, and what is there.
    "lumi-pet": ["✨", "Lumi Pet", "Her room: care, snacks, toys, clothes, her house and the shop"],
    "lumi-dungeons": ["🗝", "Lumi Dungeons", "Dungeon trips, arena fights, skills and mods"],
    "lumi-garden": ["🌸", "Lumi’s Garden", "The Stardust Garden: flowers, starpowder and the press"],
  };
  // What "Back" from a full-room view says where it doesn't lead to her room (goHome): Lumi Dungeons' first tab is the dungeon, and the garden is Lumi's Garden's own first tab.
  const LEAVE = APP === "lumi-dungeons" ? { icon: "🗝", name: "Back to the dungeons" } : APP === "lumi-garden" ? { icon: "⚙", name: "Settings", hint: "Sound, reminders and Lumi's other apps · the garden keeps growing" } : null;
  function has(name) { return TABS.indexOf(name) >= 0; } // Whether this app has that tab.
  // Who's playing? (mnemerynne/lumi_tv.py): on a shared TV whose owner has TV guests, a remote's OK picks whose Lumi
  // is shown. The play pass the server answers is sent with every request, so the whole page is that person's.
  const WHO = $("gm").dataset.who === "1", PLAYER_HEADER = "X-Lumi-Player", PLAYER_KEY = "mnemerynne-lumi-player";
  let player = null, picking = false; // The pass holder ({pass, name, owner, idle, at}); whether the picker is showing.
  // Lumi Dungeons with friends (mnemerynne/lumiparty.py, rows in party-ui.js). `party` is the server's party view, kept
  // live by its stream (or by asking every couple of seconds when a play pass is in use: a stream can't carry its
  // header). On the couch (this TV owns the party) every remote has its own cursor and menu here, by remote id.
  const TV = $("gm").dataset.tv === "1", COUCH_KEY = "mnemerynne-lumi-couch";
  let party = null, partyCode = null, partyFeed = null, openParties = [], partiesAsked = 0, partySending = false, partyNext = null;
  let couchCursor = {}, couchGuess = {}, couchCell = {}, couchConfirm = {}, couchSpot = {}, couchEndArmed = false;
  // The co-op fight (Doll's design, 2026-11-11): the creature this person is aiming at, and the Lumi an item is for
  // (by seat); on the couch, one of each per person. The party browser: which party the cursor is on (null: closed).
  let aim = null, ally = null, couchAim = {}, couchAlly = {}, browsing = null, lastCrew = "", lastTeam = "", lastFightLog = "";
  // Settings → Colour: the red, green and blue being tried (null: the colour drawer is closed). Shown in the room as they move.
  let tint = null;
  const MEMORIES = { cuddle: "A warm little cuddle", snack: "A shared snack", play: "Playtime together", rest: "A quiet moment together" };
  const NEEDS = { hunger: "Tummy rumbling. A snack would help.", energy: "So sleepy. A nap would help.", joy: "A little lonely. Stay and play?" };
  const BUSY = { nap: "napping", play: "playing" };
  const KEYS_HOME = "⏮ ⏭ change tab · ▲ ▼ choose<br>◀ ▶ swap in what she owns · Enter opens the spot, to buy more<br>Keyboard: Page Up / Page Down or [ ]<br>Escape / Back returns to Games";
  const KEYS_DUNGEON = "▲ ▼ ◀ ▶ walk, or work a puzzle<br>⏮ ⏭ choose from this list · Enter does it<br>⏯ drink a potion<br>Keyboard: Page Up / Page Down, P<br>Mouse: press a door, a chest, a card, a lamp or a square";
  const CUDDLES = ["Lumi leans into your hand. A tiny purr, just for you.", "Soft wings wrap around your fingers. We can stay like this a while."];
  // Room mode (room-ui.js, room-art.js; Doll's design, 2026-11-19): Lumi Pet without menus. ROOM is the room's own "tab"
  // (one past the real ones): its rows are the things where she is, and its cursor is where she stands. A thing opens a
  // card: the real tab's rows (roomCard is that thing), with the way back. roomAt is remembered on this device.
  const ROOM = TABS.length, PLACE = $("lp-place").textContent;
  // Visiting someone's flat (mnemerynne/lumihouse.py, docs/plans/lumi-pet-social.md phase 3): Lumi Pet opened at
  // ?at=visit-<their account id>. Their rooms, drawn from their own save; her own Lumi walks them; things are look-only.
  // Nothing about a visit is kept on this device (her own room-at stays as it was).
  // Lumi City (2026-11-19): ?at=house-<id> is the house on someone's plot, their second home (its own rooms); her own
  // house is HOME2: her rooms as she decorated them there (lumipet estate.rooms), decorated just like her flat.
  const AT_HOUSE = APP === "lumi-pet" && /^house-\d{1,25}$/.test(new URLSearchParams(location.search).get("at") || "");
  const BACK_AT = APP === "lumi-pet" ? (function (b) { return /^[a-z0-9-]{1,40}$/.test(b) ? b : null; })(new URLSearchParams(location.search).get("back") || "") : null; // a visit's way back out into Lumi City (a plot's or place's id, e.g. plot-l-1-1 or hall-l-3), from the address; tidy ids only
  function wayOut() { return BACK_AT || G.store.get("visit-back", "home"); } // where leaving a house or a friend's flat puts her: the address's &back=, else the old note, else her own lobby
  let VISIT = APP === "lumi-pet" ? (function (m) { return m ? m[1] : null; })(/^(?:visit|house)-(\d{1,25})$/.exec(new URLSearchParams(location.search).get("at") || "")) : null;
  let HOME2 = false; // in her own house (found out when its door answers "own")
  let roomAt = Ru ? (VISIT ? Ru.clean({ room: "bedroom", at: 1 }) : Ru.clean(G.store.get("room-at", null))) : null, roomCard = null, lastThings = ""; // (lastThings: what the lower bar last drew; a visit starts inside the front door)
  let visitView = null, visitDoor = null, visitKnock = null, knockAsked = 0, knockPolled = 0; // their flat once in; whose door this is; a knock waiting
  let houseFolk = [], housePinged = 0, housePingTimer = 0, houseSig = "", knocksWaiting = []; // who else is in this flat; the last check-in; knocks at her own door
  let flatsOn = false, flats = null; // Lumi Town: the list of friends' flats is open, and what it holds (null: still asking)
  let bookOn = false, bookPending = null, typingFor = "chat"; // the guestbook's list is open; a line pressed once to remove; what the typing box is for
  // Free walking (see "Free walking" below):
  const SPEED = { x: 260, y: 130 };   // Drawing units a second, across and in depth (the floor is shallow, so depth is slower).
  const holds = {};                   // who → {x, y}: what each keyboard, pad and panel holds right now (common.js, gamepad.js)
  let target = null;                  // A clicked spot {room, x, y} she's walking to, or null
  let walkFrame = 0, walkLast = 0, walkSaved = true, facing = 1; // The loop's frame and clock; whether G.store has her latest place; which way she faces
  function freshPicks() { return TABS.map(function () { return 0; }).concat([0]); } // Every tab's cursor, and the room's.
  let snap = null, offset = 0, tab = 0, picks = freshPicks(), busy = false, visited = false;
  let battleView = null, finished = null, lastFoe = ""; // Which Battle list is open, the fight that just ended, and the enemy last drawn.
  let lastOutfit = "";
  // The dungeon: the puzzle being worked on here, whether arrows drive it ("board") or the list, the finished trip
  // already read, a row waiting for a second press, and what the dungeon scene last drew.
  const KEYS_SKILLS = "▲ ▼ ◀ ▶ move over the skills · Enter learns one<br>Enter on a learned move carries it or puts it away<br>⏮ ⏭ choose from this list<br>Mouse: press a skill to look, again to learn";
  const KEYS_ALBUM = "▲ ▼ ◀ ▶ move over the pictures · ◀ ▶ at an edge turn the page<br>Enter looks at one large<br>⏮ ⏭ choose from this list<br>Mouse: press a shelf, a picture, or a page arrow";
  let skillCursor = null, skillFocus = "board", lastSkills = ""; // The Skills tab's cursor.
  let album = { shelf: null, page: 0, cursor: 0 }, albumZoom = false, albumFocus = "board", lastAlbum = ""; // The Collection tab: which shelf, page and picture, and whether one is shown large.
  const KEYS_GARDEN = "▲ ▼ ◀ ▶ move over the plots · Enter plants or trims<br>⏯ presses the powder · ⏮ ⏭ choose from this list<br>Keyboard: P presses, Page Up / Page Down<br>Mouse: press a plot, the press, or a watering can";
  const CAN_NOTES = [523.25, 659.25, 783.99, 440]; // One note per watering can.
  let lumiMoved = 0, lumiActUntil = 0, lumiFlip = false; // Lumi in the garden: when she last darted somewhere, and the little move she is making.
  let drawer = null, seed = null, plotCursor = 0, gardenFocus = "list", pending = 0, mini = null, miniTimer = null, lastGarden = "", gardenOpen = false; // The garden: see drawGarden.
  const KEYS_GARDEN_PAGE = "▲ ▼ ◀ ▶ move over the page · Enter unlocks, chooses or levels up<br>⏯ presses the powder · ⏮ ⏭ choose from this list<br>Mouse: press something to look, again to choose";
  const pageCursor = {}; // The garden's pages (the Flower tree, Helpers, Moonrise): where each one's cursor was left.
  let play = {}, focus = "list", lastStory = "", caring = false, dismissedRun = G.store.get("read-run", null), pendingConfirm = null, lastDungeon = ""; // (The last trip's ending is read once per device: Lumi Dungeons opens on its Dungeon tab, and shouldn't open on old news.)
  // Home and Closet: the spot or slot whose full list is open (null: one row each), the choice ◀ ▶ has flipped each
  // row to, and what the room last drew.
  let opened = { home: null, closet: null }, flip = {}, lastHouse = "";
  let effectUntil = 0, lastReport = "", lastList = "", lastKeys = "", lastDone = null, timer = null, polled = 0, reminders = "unsupported";
  // Lumi Town (town-ui.js, town-art.js; Doll's design, 2026-11-12): the map behind her room's door. `townAt` is the place
  // she's inside (the Arcade, the Casino or the Lumi-Soft field), or null on the map; the list's cursor is where she
  // stands. The page opens where ?at= says (media.js sends it when a game opened from here closes), and remembers on
  // this device which cabinet or table each place's cursor was on.
  // Lumi City (Doll's design, 2026-11-19; docs/plans/lumi-city.md) replaced the two-street map: she walks the city freely.
  const TOWN = APP === "lumi-town", KEYS_TOWN = "Arrows, WASD, a stick or a middle-click walk her · Enter or E uses what's in reach<br>⏮ ⏭ go through the list (a whole block, out in the city) · T talks<br>A TV remote's arrows hop to the next door or corner<br>Mouse: press a door, a sign or the ground · Escape / Back returns";
  const C = window.LumiCity, CA = window.LumiCityArt, TI = window.LumiTownInside, WK = window.LumiWalker; // the city's map and pictures, the insides, the walker
  const START_AT = TOWN ? new URLSearchParams(location.search).get("at") || "" : "", townPicks = TOWN ? G.store.get("town-picks", {}) : {}; // where the page opens; each place's last cabinet
  let townAt = null, townSpace = null, insideAt = null;           // the place she's inside (null: out in the city), its room (town-inside.js), her feet in it
  let cityMap = null, cityData = null, cityAt = null, cityTowns = ""; // the city (city-map.js), GET city's answer, her feet out in it, the towns it was built for
  let route = null, routeThen = null, townList = null;            // a walk she's on (points), what she does at its end, a list open in the panel
  let hallDoors = null, nearThing = null, townStarted = false;    // a floor's eight doors (GET heights), what's in reach, whether she's been placed yet
  let marketStall = null, marketDrawer = null, cityParts = {}, citySig = ""; // the Market's stall she's at (and its garden drawer); the city's drawn parts
  const RETRO_ON = $("gm").dataset.retro === "1";                 // Media → Retro is on, so the café is open
  const DESK = !TV && window.matchMedia("(any-pointer: fine)").matches; // A mouse and keyboard are here: Lumi-Soft can be played (media.js offers it only there too).

  function serverNow() { return Date.now() + offset; } // The server's clock, so timers agree across devices.

  // ---- Drawing other Lumis (her friends in a party, the party browser): her own shapes from the page, in their
  // colours and clothes. The template's Lumi is copied once with its ids taken off and its two clothing layers marked.
  const LUMI_SHAPES = (function () {
    const copy = $("lp-pet").cloneNode(true);
    copy.querySelectorAll("title").forEach(function (node) { node.remove(); });
    copy.querySelector("#lp-acc-back").setAttribute("data-slot", "back");
    copy.querySelector("#lp-acc-front").setAttribute("data-slot", "front");
    copy.querySelectorAll("[id]").forEach(function (node) { node.removeAttribute("id"); });
    return copy.innerHTML;
  })();

  function lumiStyle(look) { // Her three colours as the CSS variables her shapes use (game.css .lp-body and friends).
    const c = R.looks(look.glow, look.colour);
    return "--pet-glow:" + c.glow + ";--pet-body:" + c.body + ";--pet-shadow:" + c.shadow;
  }

  function lumiMarkup(look) { // One Lumi, as SVG markup for a 320 x 300 box: her shapes, her clothes, her colours. All of it authored here or in closet.js.
    const outfit = look.outfit || {};
    return '<g style="' + lumiStyle(look) + '">' + LUMI_SHAPES.replace('<g data-slot="back"></g>', "<g>" + W.render(outfit, "back") + "</g>")
      .replace('<g data-slot="front"></g>', "<g>" + W.render(outfit, "front") + "</g>") + "</g>";
  }

  function openApp(slug, where) { // Go to another of Lumi's apps (or, from Lumi Town, a game). Inside Media's game layer the layer swaps the game in its frame (media.js), so its bar and remote keys follow; on its own the page just goes there.
    where = where || {}; // at: where that page starts (Lumi Town: a place); back: the town place to come back to when it closes (media.js games.back).
    if (String(slug).indexOf("casino:") === 0) { location.href = (window.LUMI_CASINO || "/games/") + String(slug).slice(7); return; } // LumiBot: a Casino table is LumiBot's own casino game (Lumi Games app)
    if (framed) window.parent.postMessage({ type: "mnemerynne-game-open", slug: slug, at: where.at || null, back: where.back || null }, location.origin);
    else location.href = slug === "retro" ? window.LUMI_PAGES : window.LUMI_PAGES + slug + (where.at ? "?at=" + encodeURIComponent(where.at) + (where.back && slug === "lumi-pet" ? "&back=" + encodeURIComponent(where.back) : "") : ""); // On its own the browser's Back is the way back (drawTown keeps the town's address current). Retro is Media's own page. A visit carries its way back out in the address (&back=): G.store is per page, so the town's note never reached Lumi Pet (Doll, 2026-11-20).
  }

  function adventure() { // Her room's door (Doll's design, 2026-11-11; Lumi Town 2026-11-12): she trots off through it, out into Lumi Town.
    if (room.dataset.leaving === "true") return; // Already on her way: one press is enough.
    room.dataset.leaving = "true"; // game.css: she trots towards the door and fades.
    say(HOME2 ? "Out into the yard! 🏡" : "Off into town! 🏘");
    G.sound.unlock(); [523.25, 659.25, 783.99].forEach(function (f, i) { G.sound.tone(f, 0.14, i * 0.09, 0.18); }); // Three little steps up: off she goes.
    const out = HOME2 ? wayOut() : snap.pet.home_town === "right" ? "lobby-r" : "lobby-l"; // her house's front door opens onto its plot (the town said which); her flat's onto Lumi Heights' lobby (Lumi City, 2026-11-19)
    setTimeout(function () { openApp("lumi-town", { at: out }); }, 700); // Long enough to see her go.
    setTimeout(function () { delete room.dataset.leaving; }, 2500); // Back in place if this page is still showing (a refused swap, or the browser's Back).
  }

  // ---- Lumi City (Doll's design, 2026-11-19; docs/plans/lumi-city.md): the old Lumi Town grown into a city to walk about
  // in freely. Out in the city she walks the streets of LefTown, Downtown and Right-City (city-map.js, drawn by
  // city-art.js); inside a place she walks its floor (town-inside.js), like her flat. Whatever she walks up to is "in
  // reach" (a doorstep, a cabinet, the lift...), the first row of the list, and Enter (or E, or a press on it) uses it.
  // A TV remote's single presses hop from stop to stop; "Go to…" walks her anywhere by herself.
  const STALL_HELLO = { store: "Everything a little Lumi could want~", capsules: "Turn the handle... what's inside?", seeds: "Every seed here grows in the Stardust Garden.",
                        garden: "Lanterns, planters and pretty things for the garden." };
  const T_SPEED = { city: { x: 340, y: 215 }, inside: { x: 260, y: 130 } }; // drawing units a second: the city's tiles are wider than deep
  const ZOOM = 1.6;                                                     // the city's camera shows 1.6 times as much as a room does (1600 x 800 units): a city, not a room
  const MAIL = ["No letters today. Just a Lumi Realty flyer! 🏡", "A postcard from the Stardust Garden! 🌸", "A coupon for the Retro café. Free cocoa! ☕",
                "Nothing but a little glitter. Someone's been sparkly~ ✨", "A note: “Welcome to Lumi Heights!” 💌"];
  let cityAsked = 0, townPinged = 0, townPingTimer = 0; // when GET city was last asked; the last presence check-in and the next one waiting

  function homeTown() { // Where she lives: her own choice (the office's or her first trip's), else LefTown.
    const me = cityData && cityData.me;
    return (me && me.home_town) || (snap && snap.pet.home_town) || "left";
  }
  function meId() { return cityData && cityData.me ? cityData.me.id : null; } // her account's id (the server's)
  function lotData(id) { return cityData ? cityData.lots.find(function (l) { return l.id === id; }) || null : null; } // GET city's word on a lot
  function lotOnMap(id) { return cityMap ? cityMap.lots.find(function (l) { return l.id === id; }) || null : null; } // where a lot is
  function myLot() { const id = cityData && cityData.me && cityData.me.plot; return id ? lotOnMap(id) : null; } // her own plot, or null
  function coinsNow() { return snap ? snap.coins : 0; }
  function money(n) { return Number(n || 0).toLocaleString(); }
  function price(game, key, native) { return typeof window.LumiPrice === "function" ? window.LumiPrice(game, key, native) : native; } // LumiBot: SGC this costs (lumi-tuning.js, same formula as the server)
  function payout(game, key, native) { return typeof window.LumiPayout === "function" ? window.LumiPayout(game, key, native) : native; } // LumiBot: SGC a prize pays
  function plotSgc(l) { return price("city", "plot", l ? l.suggested : 0); } // LumiBot: the office's price for a lot, in SGC (sgc.spend city/plot)
  function aptOf() { return { floor: 1, door: 1, label: "1A" }; } // LumiBot: flats are numbered by the server (lumi_flats), never from a Discord id; the server always sends apt

  function cityLoad() { // GET city: the towns, every lot and who owns it, her plot, the catalog, the layout.
    cityAsked = Date.now();
    return G.api(API + "city").then(cityTake).catch(function () { /* asked again in a few seconds */ });
  }

  function cityTake(data) { // Keep the city's answer: the map is built again only when a town grew.
    if (!data || !data.layout) return;
    cityData = data;
    if (snap && data.me && typeof data.me.coins === "number") { snap.coins = data.me.coins; $("lp-coins").textContent = money(data.me.coins); }
    const towns = JSON.stringify(data.towns);
    if (towns !== cityTowns || !cityMap) { cityTowns = towns; cityMap = C.build(data.layout, data.towns); if (cityAt) cityAt = C.clean(cityMap, cityAt); }
    cityParts = {}; citySig = ""; lastList = "";                          // the lots' pictures are drawn afresh
    townStart();
    if (snap) render();
  }

  function townStart() { // Once both her save and the city are here: where she starts (?at=), and the first look round.
    if (townStarted || !snap || !cityMap) return;
    townStarted = true;
    if (TI.parse(START_AT)) { enterInside(START_AT, true); return; }     // back from a game: inside its place, at its cabinet
    cityAt = C.arrive(cityMap, START_AT, homeTown());                     // a doorstep, a plot, or (fresh into town) her own town's gate
    nearThing = townReach();
    if (!START_AT && !cityData.me.home_town && !myLot()) { townList = { kind: "home-town" }; picks[tab] = 0; say("Welcome to Lumi City! Where shall we live? 🏡"); } // (only walking in fresh: back from a game she just carries on; the list's "Choose where to live" row is always there)
    else say(START_AT ? "Back out in Lumi City! " + streetName() + "." : "Through the gate into " + TI.TOWN_NAME[homeTown()] + "! ✨");
    townHere();
  }

  function streetName() { return cityMap && cityAt ? C.streetAt(cityMap, cityAt.x, cityAt.y) : "Lumi City"; } // where she is, in words

  // ---- Inside a place --------------------------------------------------------------------------------------------
  function hallCtx(id) { // A floor's doors (from the server) and which one is hers, for town-inside.js.
    const p = TI.parse(id), apt = cityData && cityData.me ? cityData.me.apt : null;
    return { doors: hallDoors && hallDoors.id === id ? hallDoors.doors : null, mine: apt && p && p.kind === "hall" && p.floor === apt.floor && p.town === homeTown() ? apt.door : 0 };
  }

  function loadHall(id) { // GET heights/<town>/<floor>: who lives behind each of the floor's eight doors.
    const p = TI.parse(id);
    G.api(API + "heights/" + p.town + "/" + p.floor).then(function (data) {
      hallDoors = { id: id, doors: data.doors || [] };
      if (townAt === id) { townSpace = TI.space(id, hallCtx(id)); nearThing = townReach(); lastHouse = ""; lastList = ""; render(); }
    }).catch(function () { hallDoors = { id: id, doors: [] }; });
  }

  function stepThrough() { // Through a door: she's simply there on the other side (no sliding across the screen from where she was).
    room.dataset.townStill = "true";
    requestAnimationFrame(function () { requestAnimationFrame(function () { delete room.dataset.townStill; }); });
  }

  function enterInside(id, fresh) { // Walk in: a lobby, a floor of flats, the office, the Arcade...
    const p = TI.parse(id);
    if (!p) return;
    route = null; routeThen = null; townList = null; chatOn = false; marketStall = null; marketDrawer = null; picks[tab] = 0;
    if (p.kind === "hall" && !(hallDoors && hallDoors.id === id)) { hallDoors = { id: id, doors: null }; loadHall(id); }
    townAt = id; townSpace = TI.space(id, hallCtx(id)); insideAt = townSpace.start; stepThrough();
    if (fresh && p.kind === "games") { // back from a game: by the cabinet she played
      const at = townSpace.things.findIndex(function (t) { return t.id === townPicks[id]; });
      if (at >= 0) insideAt = townSpace.walk.stand(at);
    }
    nearThing = townReach();
    say(townSpace.hello);
    G.sound.unlock(); G.sound.tone(659.25, .12, 0, .12); G.sound.tone(880, .16, .1, .1); // the shop bell
    lastHouse = ""; lastList = ""; townHere();
  }

  function leaveInside() { // Out of the door: back onto the street in front of it (a floor of flats: down to its lobby).
    const was = townAt, p = TI.parse(was);
    if (p && p.kind === "hall") { enterInside(TI.lobbyId(p.town)); say("Ding! The lobby."); return; }
    townAt = null; townSpace = null; townList = null; marketStall = null; marketDrawer = null; route = null; routeThen = null; picks[tab] = 0; stepThrough();
    cityAt = (cityMap && C.door(cityMap, was)) || (cityMap ? C.arrive(cityMap, was, homeTown()) : null);
    nearThing = townReach();
    say("Back out on " + streetName() + ". Where next?");
    lastHouse = ""; lastList = ""; townHere();
  }

  function townOpen(slug, back, words, at) { // Off to a game or one of Lumi's apps: she hops in through the door. Leaving it walks back to `back` (a place, a plot), or nowhere (her flat).
    if (room.dataset.leaving === "true") return;                         // one press is enough
    room.dataset.leaving = "true";                                       // game.css: a little hop, and she's gone in
    say(words || "Let's play! ✨");
    G.sound.unlock(); [587.33, 739.99, 880].forEach(function (f, i) { G.sound.tone(f, 0.12, i * 0.09, 0.16); });
    setTimeout(function () { openApp(slug, Object.assign(back ? { back: back } : {}, at ? { at: at } : {})); }, 600);
    setTimeout(function () { delete room.dataset.leaving; }, 2500);      // still here (a refused swap, or the browser's Back): she's back in town
  }

  function visit(kind, host, back, name) { // To someone's flat ("visit-<id>") or house ("house-<id>"): their doorstep, and the way back here afterwards.
    G.store.set("visit-back", back);                                     // (the old note, for a page still on the old script)
    townOpen("lumi-pet", back, kind === "house" ? "Off to " + name + "'s house! 🏡" : "Knock knock at " + name + "'s door! 🚪", kind + "-" + host);
  }

  function useInside(t) { // Use a thing inside: play a cabinet, a stall, the lift, a door...
    if (!t) return;
    const act = t.act, p = TI.parse(townAt);
    if (act === "leave") { leaveInside(); return; }
    if (act.indexOf("game:") === 0) { // a cabinet or table
      const g = t.game;
      if (g.desk && !DESK) { say(g.name + " needs a mouse and keyboard: play it on a computer."); return; } // a TV remote or a phone can't aim the Star Scope
      townPicks[townAt] = t.id; G.store.set("town-picks", townPicks);
      townOpen(g.slug, townAt, "Let's play " + g.name + "! ✨"); return;
    }
    if (act.indexOf("stall:") === 0) { marketStall = act.slice(6); marketDrawer = null; townList = { kind: "stall" }; picks[tab] = 0; say(STALL_HELLO[marketStall] || ""); return; }
    if (act === "elevator") { openFloors(p.town); return; }
    if (act === "directory") { openDirectory(p.town); return; }
    if (act === "mail") { say(MAIL[Math.floor(Math.random() * MAIL.length)]); effect("cuddle", "✉"); return; }
    if (act === "look") { say(t.say); return; }
    if (act.indexOf("door:") === 0) { // a front door on a floor of Lumi Heights
      const d = t.door || {}, label = p.floor + TI.LETTERS[Number(act.slice(5)) - 1];
      if (d.mine) { townOpen("lumi-pet", null, "Home sweet home! 🏠"); return; }          // her own flat
      if (d.id && d.name) { visit("visit", d.id, townAt, d.name); return; }            // a friend's: their doorstep
      say(d.id ? "That door is closed. Maybe another day!" : "Nobody lives in flat " + label + " yet. 🗝"); return;
    }
    if (["land", "listings", "styles", "yard", "capsule"].indexOf(act) >= 0) { townList = { kind: act }; picks[tab] = 0; say(t.say); return; } // the office's counters
    say(t.say);
  }

  // ---- Out in the city -------------------------------------------------------------------------------------------
  function useCity(t) { // Use what she's walked up to in the city: go into a place, home, a friend's house, a sign, a gate.
    if (!t) return;
    if (t.kind === "place") {
      const id = t.id;
      if (TI.parse(id)) { enterInside(id); return; }                     // the lobbies, the office, the Arcade, the Casino, the Market, the field
      if (id === "tavern") { townOpen("lumi-dungeons", "tavern", exploring() ? "Lumi's friends are waiting at the Lantern & Paw! 🍺" : "Into the Lantern & Paw! 🍺"); return; }
      if (id === "garden") { townOpen("lumi-garden", "garden", "Through the gate into the Stardust Garden! 🌸"); return; }
      if (id === "cafe") { if (RETRO_ON) townOpen("retro", "cafe", "Into the Retro café! 🕹☕"); else say("The Retro café is closed for renovations. ☕"); return; } // LumiBot: there is no Retro (Media's emulator), so the café stays shut
      return;
    }
    if (t.kind === "lot") {
      const data = lotData(t.id), lot = t.lot;
      if (data && data.owner && data.owner.id === meId()) { townOpen("lumi-pet", "plot-" + t.id, "Home to my house! 🏡", "house-" + data.owner.id); return; }
      if (data && data.owner) { visit("house", data.owner.id, "plot-" + t.id, data.owner.name); return; }
      say(lot.address + " is for sale: " + money(plotSgc(data)) + " SGC. Ask at Lumi Realty, Downtown! 🏡"); return;
    }
    if (t.kind === "sign") { const s = t.sign; say(s.town ? "This is " + s.words + ", " + TI.TOWN_NAME[s.town] + ". Block " + s.block + "." : "Lumi Way, right in the middle of Downtown!"); return; }
    if (t.kind === "gate") { townList = { kind: "leave", side: t.gate.town }; picks[tab] = 0; say("The " + TI.TOWN_NAME[t.gate.town] + " gate. Off somewhere?"); }
  }

  function thingWords(t) { // What the first row says about whatever's in reach (city or inside): {icon, name, hint}.
    if (townAt) return { icon: t.icon, name: t.name, hint: t.hint };
    if (t.kind === "place") { const p = t.place; return { icon: p.icon, name: p.name, hint: p.id === "cafe" && !RETRO_ON ? "Closed until Retro is turned on" : p.hint }; }
    if (t.kind === "lot") {
      const data = lotData(t.id) || {}, lot = t.lot;
      if (data.owner && data.owner.id === meId()) return { icon: "🏡", name: "My house", hint: lot.address + " · home, sweet second home" };
      if (data.owner) return { icon: "🏠", name: data.owner.name + "'s house", hint: lot.address + (data.list_price ? " · for sale: " + money(data.list_price) + " SGC" : " · knock, or walk in where it's open") };
      return { icon: "🪧", name: "Plot for sale", hint: lot.address + " · " + money(plotSgc(data)) + " SGC at Lumi Realty" };
    }
    if (t.kind === "sign") return { icon: "🪧", name: t.sign.words, hint: t.sign.town ? TI.TOWN_NAME[t.sign.town] + " · block " + t.sign.block : "Downtown" };
    return { icon: "🚪", name: TI.TOWN_NAME[t.gate.town] + " gate", hint: "The way out of the city" };
  }

  function townReach() { // What's in reach where she stands: a thing inside, or a doorstep, sign or gate out in the city (or null).
    if (townAt && townSpace && insideAt) { const i = townSpace.walk.reach(insideAt); return i >= 0 ? townSpace.things[i] : null; }
    if (!townAt && cityMap && cityAt) return C.reach(cityMap, cityAt);
    return null;
  }

  function useNear() { if (!nearThing) return false; if (townAt) useInside(nearThing); else useCity(nearThing); return true; } // Enter, E, or the first row

  function walkRoute(points, then) { // Walk her along a route (city) or to a spot (inside), and maybe do something when she gets there.
    townList = null; chatOn = false;
    route = points && points.length ? points : null; routeThen = then || null;
    if (!route) { if (then) then(); return; }
    startWalk();
  }

  function goTo(t, use) { // Walk up to a thing (its doorstep, or where she stands to use it) and, if `use`, use it there.
    if (!t) return;
    if (townAt) {
      const i = townSpace.things.indexOf(t), spot = i >= 0 ? townSpace.walk.stand(i) : insideAt;
      walkRoute([spot], use ? function () { nearThing = townReach(); useInside(t); lastList = ""; render(); } : null);
      return;
    }
    walkRoute(C.path(cityMap, cityAt, { x: t.x, y: t.y }), use ? function () { nearThing = townReach(); useCity(t); lastList = ""; render(); } : null);
  }

  function townSnap(action) { // A TV remote's press (no key held): hop to the next stop that way.
    if (townAt) {
      const i = townSpace.walk.step(insideAt, action === "left" || action === "up" ? -1 : 1);
      if (i >= 0) walkRoute([townSpace.walk.stand(i)]);
      return;
    }
    const s = C.step(cityMap, cityAt, action);
    if (s) walkRoute(C.path(cityMap, cityAt, s)); else say("That's as far as this street goes!");
  }

  function townKey(action, arrow, meta) { // The keys in Lumi City. True when used here; false lets the usual handling run (Enter chooses the row).
    if (!snap || (!cityMap && !townAt)) return arrow;                    // (still loading: nothing to walk on yet)
    if (chatOn || townList) { // A list is open: the arrows go through it, and ◀ ▶ turn a row's own choice (a price) where it has one
      const list = rows(), row = list[picks[tab]];
      if ((action === "left" || action === "right") && row && row.turn) { row.turn(action === "left" ? -1 : 1); lastList = ""; render(); return true; }
      if (arrow || action === "next" || action === "prev") {
        const by = action === "up" || action === "left" || action === "prev" ? -1 : 1;
        if (list.length) picks[tab] = (picks[tab] + by + list.length) % list.length;
        render(); return true;
      }
      return false;
    }
    if (arrow && meta && meta.held) return true;                         // a held key, stick or pad: free walking moves her
    if (arrow) { townSnap(action); return true; }
    if (action === "next" || action === "prev") { // ⏮ ⏭: out in the city a whole block; inside, through the list
      if (!townAt && cityMap) { walkRoute(C.path(cityMap, cityAt, C.hop(cityMap, cityAt, action === "prev" ? -1 : 1))); return true; }
      const count = rows().length; if (count) picks[tab] = (picks[tab] + (action === "prev" ? count - 1 : 1)) % count;
      render(); return true;
    }
    return false;
  }

  function townPress(event) { // Mouse and touch in Lumi City: a thing (walk to it and use it), or the ground (walk there).
    if (!TOWN || !snap || room.dataset.leaving === "true") return;
    const hit = event.target.closest("[data-click]"), click = hit ? hit.dataset.click : "";
    if (townAt && townSpace) {
      const old = { "game:": "", "stall:": "" }, id = click.indexOf("thing:") === 0 ? click.slice(6) : click === "leave" ? "exit"
        : Object.keys(old).reduce(function (found, k) { return found || (click.indexOf(k) === 0 ? click.slice(k.length) : ""); }, ""); // the old pictures' own presses too
      const t = id ? townSpace.things.find(function (x) { return x.id === id; }) : null;
      if (t) { goTo(t, true); render(); return; }
    } else if (cityMap && click.indexOf("thing:") === 0) {
      const what = click.slice(6), kind = what.split(":")[0], id = what.slice(kind.length + 1);
      const t = C.things(cityMap).find(function (x) { return x.kind === kind && (x.id === id || x.id === id.replace(/^gate-/, "gate-")); });
      if (t) { goTo(t, true); render(); return; }
    }
    townWalkTo(event);
  }

  function townWalkTo(event) { // A press on the ground (or a middle-click anywhere): she walks there and uses nothing.
    const at = floorAt(event);
    if (!at) return;
    if (townAt && townSpace) walkRoute([townSpace.walk.point(at.x, at.y)]);
    else if (cityMap && cityAt) walkRoute(C.path(cityMap, cityAt, C.nearestFree(cityMap, at.x, at.y)));
    render();
  }

  // ---- Walking (the free-walk loop's Lumi City half; game.js walkTick hands over to townTick) --------------------
  function townWalkable() { // The space she's walking on now: {kind, at, free, speed}, or null.
    if (!TOWN || !snap) return null;
    if (townAt && townSpace && insideAt) return { kind: "inside", at: insideAt, free: townSpace.walk.free, speed: T_SPEED.inside };
    if (!townAt && cityMap && cityAt) return { kind: "city", at: cityAt, free: C.freeFn(cityMap), speed: T_SPEED.city };
    return null;
  }

  function townCanWalk() { return Boolean(townWalkable()) && !townList && !chatOn && room.dataset.leaving !== "true"; } // no list open, not going through a door

  function townTick(now) { // One frame of walking in Lumi City.
    walkFrame = 0;
    const dt = walkLast ? Math.min(0.05, (now - walkLast) / 1000) : 0; walkLast = now; // (capped: a slow frame never jumps her)
    const sp = townWalkable(), way = heldWay();
    if (!sp || !townCanWalk() || (!(way.x || way.y) && !route)) { if (!townCanWalk()) { route = null; routeThen = null; } townStopWalk(); return; }
    room.dataset.walking = "true";                                       // game.css: no easing while she walks
    let next, arrived = null;
    if (way.x || way.y) { route = null; routeThen = null; next = WK.slide(sp.free, sp.at, way.x * sp.speed.x * dt, way.y * sp.speed.y * dt); } // the keys take over from a walk she was on
    else {
      const went = WK.follow(sp.free, sp.at, route, sp.speed.x * dt);
      next = { x: went.x, y: went.y }; route = went.route.length ? went.route : null;
      if (went.done) { arrived = routeThen; route = null; routeThen = null; }
    }
    if (Math.abs(next.x - sp.at.x) > 0.01) facing = next.x < sp.at.x ? -1 : 1;
    if (sp.kind === "city") cityAt = next; else insideAt = next;
    townMoved();
    if (arrived) { townStopWalk(); arrived(); return; }                  // there: use it
    walkFrame = requestAnimationFrame(walkTick);
  }

  function townStopWalk() { // Nothing walks her: CSS easing back, and everyone told where she stopped.
    walkFrame = 0; walkLast = 0;
    if (room.dataset.walking) { delete room.dataset.walking; townHereSoon(true); }
  }

  function townMoved() { // After a step: what's in reach now, her place in the picture, and (now and then) the others told.
    const was = nearThing ? nearThing.id : null;
    nearThing = townReach();
    if ((nearThing ? nearThing.id : null) !== was) { if (nearThing) say(townAt ? nearThing.say : thingWords(nearThing).name + " · " + thingWords(nearThing).hint); lastList = ""; render(); }
    else drawTown();
    townHereSoon(false);
  }

  function townHereSoon(now) { // Tell the server where she stands: at most four times a second while walking, and once when she stops.
    if (now) { clearTimeout(townPingTimer); townPingTimer = 0; townHere(); return; }
    if (!townPingTimer) townPingTimer = setTimeout(function () { townPingTimer = 0; townHere(); }, Math.max(0, 250 - (Date.now() - townPinged)));
  }

  // ---- Drawing ---------------------------------------------------------------------------------------------------
  function shownSize() { // How much of the 1000 x 500 drawing the screen shows (it's cropped to fill it): [width, height] in drawing units.
    const box = room.getBoundingClientRect(), k = Math.max(box.width / 1000, box.height / 500) || 1;
    return box.width && box.height ? [box.width / k, box.height / k] : [1000, 500];
  }

  function cityView() { // The camera: centred on her, never past the city's ends or its top and bottom.
    const tw = cityMap.tile[0], s = shownSize().map(function (n) { return n * ZOOM; }), W = 1000 * ZOOM, Hv = 500 * ZOOM; // (in city units: the camera is ZOOM times a room's)
    const L = cityMap.x0 * tw - 60, R = cityMap.x1 * tw + 60, H = cityMap.height;
    const x = Math.max(L - (W - s[0]) / 2, Math.min(R - (W + s[0]) / 2, cityAt.x - W / 2));
    const y = Math.max(-(Hv - s[1]) / 2 - 20, Math.min(H - (Hv + s[1]) / 2 + 20, cityAt.y - Hv * 0.56));
    return { x: Math.round(x), y: Math.round(y) };
  }

  function myLook() { const p = snap.pet; return { glow: p.glow, colour: p.colour || null, outfit: p.outfit || {}, name: p.name || "Lumi" }; } // her own look, for drawing her in the city

  function cityFigure(id, look, words, size) { // One Lumi in the city's picture (or on an inside's folk layer): her shapes in her look, a name tag, a speech line.
    const ns = "http://www.w3.org/2000/svg", g = document.createElementNS(ns, "g"), flip = document.createElementNS(ns, "g"), w = size || 62, h = Math.round(w * 300 / 320);
    g.setAttribute("class", "lp-folk-one lp-cw-lumi" + (id === "me" ? " lp-cw-me" : id.indexOf("npc-") === 0 ? " lp-folk-npc" : " lp-folk-guest")); g.dataset.id = id;
    flip.setAttribute("class", "lp-folk-flip");
    flip.innerHTML = '<ellipse cx="0" cy="1" rx="' + Math.round(w * 0.36) + '" ry="' + Math.round(w * 0.09) + '" fill="#000" opacity=".35"/>' + // a soft shadow at her paws
      '<g class="lp-folk-anim"><svg x="' + (-w / 2) + '" y="' + (-h + 2) + '" width="' + w + '" height="' + h + '" viewBox="0 0 320 300" overflow="visible">' + lumiMarkup(look) + "</svg></g>"; // authored shapes; the look is the server's checked one
    g.append(flip);
    if (words) { const tag = document.createElementNS(ns, "text"); tag.setAttribute("class", "lp-folk-name"); tag.setAttribute("y", "15"); tag.textContent = words; g.append(tag); } // a person's own words: text only
    const said = document.createElementNS(ns, "text"); said.setAttribute("class", "lp-folk-say"); said.setAttribute("y", String(-h - 6)); g.append(said);
    return g;
  }

  function cityPut(node, x, y, faceLeft) { // Stand a Lumi at x, y in the city, in the row of the picture her feet are on (so whoever's in front is drawn in front).
    node.style.transform = "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)"; // (CSS, so the townsfolk's and visitors' steps ease; hers has no easing: game.css .lp-cw-me)
    node.firstChild.dataset.flip = faceLeft ? "true" : "false";
    const row = Math.max(0, Math.min(cityMap.rows - 1, Math.floor(y / cityMap.tile[1]))), slot = houseArt.querySelector('.lp-cw-folk[data-row="' + row + '"]');
    if (slot && node.parentNode !== slot) slot.appendChild(node);
  }

  function drawTown() { // Lumi City: the city around her, or the place she's inside, and everyone else where they stand.
    room.dataset.town = townAt ? TI.parse(townAt).kind : "city";
    room.dataset.open = "false";                                          // the town paints its own sky
    if (townAt && townSpace) { drawInside(); return; }
    if (!cityMap || !cityAt) { // still asking the server for the city
      $("lp-place").textContent = "LUMI CITY";
      if (lastHouse !== "city-wait") { lastHouse = "city-wait"; houseArt.innerHTML = '<rect x="-200" y="-100" width="1400" height="700" fill="#0b0618"/><text x="500" y="260" font-size="18" fill="#ffe9f5" text-anchor="middle">Walking into town…</text>'; }
      return;
    }
    drawCity();
  }

  function drawCity() { // The chunks near the camera (each drawn once and kept), then her and everyone placed.
    const map = cityMap, tw = map.tile[0], night = sceneNow().night, view = cityView();
    $("lp-place").textContent = streetName().toUpperCase();
    const left = view.x - 340, right = view.x + 1000 * ZOOM + 340;        // a margin either side: walking a little doesn't redraw
    const shown = map.chunks.filter(function (ch) { return ch.c1 * tw > left && ch.c0 * tw < right; });
    const sig = JSON.stringify(["city", shown.map(function (ch) { return ch.id; }), night]);
    if (sig !== citySig || lastHouse !== sig) { // a new part of the city came into view (or the lots changed): draw it, then put everyone back in
      citySig = sig; lastHouse = sig;
      const lots = {};
      (cityData.lots || []).forEach(function (l) { lots[l.id] = l; });
      const parts = shown.map(function (ch) { const k = ch.id + ":" + night; return cityParts[k] || (cityParts[k] = CA.chunk(map, ch, lots, night)); });
      houseArt.innerHTML = CA.scene(map, parts, { x: left, w: right - left }, night); // authored in city-art.js and estate-art.js; owners' names escaped there
      cityFolkAll();
      try { history.replaceState(null, "", location.pathname + "?at=" + C.nearestDoor(map, cityAt)); } catch (e) { /* the address is a nicety */ }
    }
    placeCity(view);
  }

  function placeCity(view) { // Move the camera and her; light up whatever's in reach.
    view = view || cityView();
    houseArt.setAttribute("viewBox", view.x + " " + view.y + " " + 1000 * ZOOM + " " + 500 * ZOOM);
    if (folkArt) folkArt.replaceChildren();                               // (the city draws everyone in its own picture)
    let me = houseArt.querySelector('[data-id="me"]');
    if (!me) me = cityFigure("me", myLook(), "", 64);
    cityPut(me, cityAt.x, cityAt.y, facing < 0);
    const mark = nearThing ? nearThing.kind + ":" + nearThing.id : "";
    houseArt.querySelectorAll(".lp-cw-thing").forEach(function (g) { g.classList.toggle("lp-cw-near", g.dataset.thing === mark); });
    room.style.setProperty("--gx", String(Math.round((cityAt.x - view.x) / ZOOM - 500))); // her speech bubble follows her (in a room's units)
    room.style.setProperty("--gy", String(Math.round((cityAt.y - view.y) / ZOOM)));
    room.style.setProperty("--gs", "0.45");
  }

  function drawInside() { // A place's inside: its picture (with the thing in reach lit), her on its floor, and everyone else in here.
    const sp = townSpace, night = sceneNow().night, on = nearThing ? nearThing.id : null;
    $("lp-place").textContent = sp.name;
    const sig = JSON.stringify(["in", sp.id, on, night, hallDoors && hallDoors.id === sp.id ? hallDoors.doors : null]);
    if (sig !== lastHouse) {
      lastHouse = sig;
      houseArt.innerHTML = TI.art(sp, { on: on, night: night });          // authored in town-inside.js and town-art.js; names escaped there
      try { history.replaceState(null, "", location.pathname + "?at=" + sp.id); } catch (e) { /* the address is a nicety */ }
    }
    const s = shownSize(), panels = room.getBoundingClientRect().width > 1000; // a wide screen: the side panels float over the picture, leaving about x 290-710 clear
    const seen = panels ? Math.min(s[0], 440) : s[0], reach = Math.max(0, (sp.reach[1] - sp.reach[0] - seen) / 2); // so a long hallway pans to keep her (and what she's near) out from under them
    const pan = Math.round(Math.max(-reach, Math.min(reach, insideAt.x - 500)));     // a narrow screen follows her along a long hallway
    houseArt.setAttribute("viewBox", pan + " 0 1000 500");
    if (folkArt) folkArt.setAttribute("viewBox", pan + " 0 1000 500");
    room.style.setProperty("--gx", String(Math.round(insideAt.x - 500 - pan)));
    room.style.setProperty("--gy", String(Math.round(insideAt.y)));
    room.style.setProperty("--gs", sp.walk.scale(insideAt.y).toFixed(3));
    room.style.setProperty("--face", String(facing));
    drawFolk();
  }

  // ---- The town's list -------------------------------------------------------------------------------------------
  function backRow(words, to) { // The list's way back: up to the list it came from (`to`), or closed when it has none.
    return { key: "list-back", icon: "‹", name: words || "Back", hint: to ? "Back to the last list" : "Escape, Back or B does it too", local: function () {
      townList = to || null; picks[tab] = 0; pendingConfirm = null;      // up one list (or shut); a half-asked purchase is forgotten
      if (!to) { marketStall = null; marketDrawer = null; }              // leaving the panel: the Market forgets its stall
    } };
  } // end of backRow

  function deeper(list, next) { // Open the list `next` from inside `list`, remembering the way back to it (Doll, 2026-11-20: Back used to shut everything).
    next.back = list; townList = next; picks[tab] = 0; pendingConfirm = null; // its Back row returns here
  } // end of deeper

  function townRows() { // What the panel offers in Lumi City: a list that's open (the phrases, the lift, an office counter...), else the town's own rows.
    if (chatOn) return Tw.chatRows(chatCtx());
    if (townList) return listRows(townList);
    return baseTownRows(); // no list open: the town's own rows (erinne 43a24f4 split them out for the lower bar)
  } // end of townRows

  function baseTownRows() { // The town's own rows: what's in reach first, then Go to…, Where am I?... (the lower bar shows these, like her flat's things)
    const out = [];
    if (townAt && townSpace) { // inside: every thing in here (walk to it and use it), the one in reach first, so a remote and a screen reader reach them all
      const things = townSpace.things.slice().sort(function (a, b) { return (b === nearThing) - (a === nearThing); });
      things.forEach(function (t) { out.push({ key: "thing-" + t.id, icon: t.icon, name: t.name, hint: t === nearThing ? "Right here · Enter" : t.hint, local: function () { if (t === nearThing) useInside(t); else goTo(t, true); } }); });
    } else if (cityMap) {
      if (nearThing) { const w = thingWords(nearThing); out.push({ key: "use", icon: w.icon, name: w.name, hint: w.hint, local: useNear }); } // out in the city: whatever's in reach first
      if (myLot()) out.push({ key: "decorate", icon: "🎨", name: "Decorate my house", hint: "House style and yard things · a preview shows before you buy", // (Doll, 2026-11-20: it used to hide three lists deep in Lumi Realty)
        local: function () { townList = { kind: "decorate" }; picks[tab] = 0; say("Ooh, let's make it pretty! Pick something and I'll show you. 🎨"); } }); // opens the decorate list from anywhere in the city
      out.push({ key: "goto", icon: "🧭", name: "Go to…", hint: "Home, the office, a place, a friend's house: she walks there", local: function () { townList = { kind: "goto" }; picks[tab] = 0; say("Where shall we go?"); } });
      out.push({ key: "where", icon: "📍", name: "Where am I?", hint: streetName(), local: function () { say("We're on " + streetName() + "." + (myLot() ? " Home is " + myLot().address + "." : "")); } });
      if (cityData && !cityData.me.home_town && !myLot()) out.push({ key: "home-town", icon: "🏡", name: "Choose where to live", hint: "LefTown or Right-City", local: function () { townList = { kind: "home-town" }; picks[tab] = 0; } });
    }
    out.push({ key: "seen", icon: "👀", name: "Show me in town: " + (snap.pet.town_seen === false ? "off" : "on"),
      hint: snap.pet.town_seen === false ? "Nobody sees your Lumi here, and you still see theirs" : "Others in Lumi City see your Lumi, in her clothes, with her name", send: { action: "town_seen" } });
    out.push({ key: "say", icon: "💬", name: "Say something", hint: "Everyone near you hears it: a phrase, or type your own", local: function () { chatCtx().open(); } });
    return out;
  }

  function goPlaces() { // "Go to…": home, her house, the office and every place, friends' houses, the gates.
    const out = [], map = cityMap, mineLot = myLot(), town = homeTown();
    const go = function (key, icon, name, hint, t) { out.push({ key: key, icon: icon, name: name, hint: hint, local: function () { say("Off we go! 🧭"); goTo(t, true); } }); };
    const placeThing = function (id) { return C.things(map).find(function (t) { return t.kind === "place" && t.id === id; }); };
    go("go-home", "🏢", "Home: " + (town === "right" ? "Lumi Heights East" : "Lumi Heights West"), "My apartment building" + (cityData.me.apt ? " · flat " + cityData.me.apt.label : ""), placeThing(TI.lobbyId(town)));
    if (mineLot) go("go-house", "🏡", "My house", mineLot.address, C.things(map).find(function (t) { return t.kind === "lot" && t.id === mineLot.id; }));
    map.places.forEach(function (p) { if (p.id !== TI.lobbyId(town)) go("go-" + p.id, p.icon, p.name, p.hint, placeThing(p.id)); });
    (cityData.lots || []).filter(function (l) { return l.owner && l.owner.id !== meId(); }).forEach(function (l) { // everyone's houses
      const lot = lotOnMap(l.id);
      if (lot) go("go-lot-" + l.id, "🏠", l.owner.name + "'s house", lot.address, C.things(map).find(function (t) { return t.kind === "lot" && t.id === l.id; }));
    });
    ["left", "right"].forEach(function (side) { go("go-gate-" + side, "🚪", TI.TOWN_NAME[side] + " gate", "The way out, at the " + side + " end", C.things(map).find(function (t) { return t.id === "gate-" + side; })); });
    return out.concat([backRow()]);
  }

  function openFloors(town) { // The lift: the lobby, and every floor where someone lives (GET heights/<town>).
    townList = { kind: "floors", town: town, floors: null }; picks[tab] = 0; say("Going up! Which floor?");
    G.api(API + "heights/" + town).then(function (data) { if (townList && townList.kind === "floors") { townList.floors = data.floors || []; lastList = ""; render(); } })
      .catch(function () { if (townList && townList.kind === "floors") { townList.floors = []; lastList = ""; render(); } });
  }

  function openDirectory(town) { // The front desk: who lives in this building (GET houses), to walk to their door.
    townList = { kind: "directory", town: town, flats: null }; picks[tab] = 0; say("Who shall we visit? 🛎");
    G.api(API + "houses").then(function (data) { if (townList && townList.kind === "directory") { townList.flats = (data.flats || []).filter(function (f) { return (f.town || "left") === town; }); lastList = ""; render(); } })
      .catch(function () { if (townList && townList.kind === "directory") { townList.flats = []; lastList = ""; render(); } });
  }

  function toDoor(town, apt) { // From the lobby up to a flat's door: the lift to its floor, then she walks to the door.
    enterInside(TI.hallId(town, apt.floor));
    const t = townSpace.things.find(function (x) { return x.id === "door-" + apt.door; });
    if (t) goTo(t, false);
  }

  function estate(send, words) { // Ask Lumi Realty (POST estate): the city's new state comes back, with what she says about it.
    if (busy) return;
    busy = true; pendingConfirm = null;
    G.api(API + "estate", send).then(function (data) {
      cityTake(data);
      const said = data.said || {};
      say(said.text || words || "Done! ✨");
      if (said.won) effect("play", "✧ ✦ ✧"); else effect("cuddle", "🏡");
      refresh();                                                           // her save changed too (coins, home town, what she owns)
    }).catch(function (refused) { say(refused.message); }).then(function () { busy = false; lastList = ""; render(); });
  }

  function sure(key, ask, send, words) { // A row that spends coins (or gives up a plot): the first press asks, the second does it.
    return function () { if (pendingConfirm !== key) { pendingConfirm = key; say(ask); return; } estate(send, words); };
  }

  function listRows(list) { // The rows of a list open in the town's panel.
    const me = cityData ? cityData.me : null, cat = cityData ? cityData.catalog : null, mineLot = myLot(), mineData = mineLot ? lotData(mineLot.id) : null;
    if (list.kind === "goto") return goPlaces();
    if (list.kind === "home-town") return ["left", "right"].map(function (side) {
      return { key: "town-" + side, icon: side === "left" ? "🌷" : "⭐", name: "Live in " + TI.TOWN_NAME[side], hint: side === "left" ? "Flower lanes off Petal Avenue · Lumi Heights West" : "Star streets off Starlight Boulevard · Lumi Heights East",
               local: function () { townList = null; estate({ action: "home_town", item: side }, "Welcome home to " + TI.TOWN_NAME[side] + "! 🏡"); } };
    }).concat([backRow("Decide later")]);
    if (list.kind === "leave") return [
      { key: "leave-home", icon: "🏠", name: "Home to my flat", hint: "Back to her room (Lumi Pet)", local: function () { townList = null; townOpen("lumi-pet", null, "Home again! 🏠"); } },
      { key: "leave-games", icon: "🏠", name: "Leave Lumi City", hint: "Back to her house", local: function () { townList = null; if (framed) G.close(); else location.href = window.LUMI_PAGES + "lumi-pet"; } }, // LumiBot: there is no games hub; leaving the city goes home
      backRow("Stay in town")];
    if (list.kind === "floors") {
      const here = TI.parse(townAt), out = [];
      if (here && here.kind === "hall") out.push({ key: "floor-lobby", icon: "🛎", name: "Lobby", hint: "Down to the front desk and the street door", local: function () { enterInside(TI.lobbyId(list.town)); } });
      if (list.floors === null) out.push({ key: "floors-wait", icon: "⏳", name: "The lift is coming…", hint: "One moment", note: "One moment…" });
      else (list.floors || []).forEach(function (f) {
        const mine = me && me.apt && me.apt.floor === f && homeTown() === list.town;
        if (here && here.kind === "hall" && here.floor === f) return;     // (already on this floor)
        out.push({ key: "floor-" + f, icon: mine ? "🏠" : "⏫", name: "Floor " + f + (mine ? " (home)" : ""), hint: mine ? "My flat is " + me.apt.label : "Eight front doors", local: function () { enterInside(TI.hallId(list.town, f)); } });
      });
      if (me && me.apt && homeTown() === list.town && !(list.floors || []).includes(me.apt.floor)) out.push({ key: "floor-" + me.apt.floor, icon: "🏠", name: "Floor " + me.apt.floor + " (home)", hint: "My flat is " + me.apt.label, local: function () { enterInside(TI.hallId(list.town, me.apt.floor)); } });
      return out.concat([backRow()]);
    }
    if (list.kind === "directory") {
      const out = [];
      if (me && me.apt && homeTown() === list.town) out.push({ key: "dir-me", icon: "🏠", name: "My flat (" + me.apt.label + ")", hint: "Up the lift and home", local: function () { toDoor(list.town, me.apt); } });
      if (list.flats === null) out.push({ key: "dir-wait", icon: "⏳", name: "Looking at the list…", hint: "One moment", note: "One moment…" });
      else if (!list.flats.length) out.push({ key: "dir-none", icon: "🛎", name: "Nobody else lives here yet", hint: "Friends with a Lumi who live in " + TI.TOWN_NAME[list.town] + " show here", note: "Nobody else lives here yet." });
      else list.flats.forEach(function (f) {
        const apt = f.apt || aptOf(f.id);
        out.push({ key: "dir-" + f.id, icon: f.home ? "💡" : "🚪", name: f.name + " · flat " + apt.label, hint: (f.home ? f.name + " is home" : "Nobody's home") + " · " + (f.door === "open" ? "door open" : "knock first"),
                   local: function () { toDoor(list.town, apt); say("Up to flat " + apt.label + "! ⏫"); } });
      });
      return out.concat([backRow()]);
    }
    if (list.kind === "stall") return stallRows(marketStall).concat([backRow("Back to the stalls")]);
    if (!cityData) return [backRow()];
    if (list.kind === "land") { // office land: cheapest first; her own plot first if she has one
      const out = [];
      if (mineLot) out.push({ key: "my-plot", icon: "🏡", name: "My plot: " + mineLot.address, hint: mineData && mineData.list_price ? "For sale at " + money(mineData.list_price) + " SGC" : "List it, sell it, or decorate it", local: function () { deeper(list, { kind: "plot", price: null }); }, estate: { mine: true } }); // (previews her plot as it stands)
      const free = cityData.lots.filter(function (l) { return !l.owner; }).sort(function (a, b) { return plotSgc(a) - plotSgc(b) || (a.id < b.id ? -1 : 1); });
      free.slice(0, 40).forEach(function (l) {
        const lot = lotOnMap(l.id);
        if (!lot) return;
        const row = { key: "buy-" + l.id, icon: l.frontage === "avenue" ? "🌟" : "🪧", name: lot.address, hint: money(plotSgc(l)) + " SGC" + (l.frontage === "avenue" ? " · on the avenue" : "") + (mineLot ? " · you have a home already" : ""),
                      estate: { fresh: true, caption: "Comes with the free Starter Cottage" } }; // preview: what a new plot looks like on day one
        if (mineLot) row.note = "One plot each: sell yours first to buy another.";
        else row.local = sure(row.key, "Buy " + lot.address + " for " + money(plotSgc(l)) + " SGC? Choose it again to buy.", { action: "buy", plot: l.id });
        out.push(row);
      });
      if (!free.length) out.push({ key: "land-none", icon: "🏗", name: "Every plot is taken", hint: "The town grows a new block soon", note: "Every plot is taken just now." });
      return out.concat([backRow()]);
    }
    if (list.kind === "listings") {
      const out = [], sold = cityData.lots.filter(function (l) { return l.owner && l.list_price; }).sort(function (a, b) { return a.list_price - b.list_price; });
      sold.forEach(function (l) {
        const lot = lotOnMap(l.id), mine = l.owner.id === meId();
        if (!lot) return;
        const row = { key: "listing-" + l.id, icon: mine ? "🏡" : "📌", name: lot.address, hint: money(l.list_price) + " SGC from " + (mine ? "you" : l.owner.name) + " · suggested " + money(plotSgc(l)),
                      estate: mine ? { mine: true } : { fresh: true, caption: "Yours with the Starter Cottage (their house and yard things stay theirs)" } }; // buying a listing resets the house (lumicity buy_listing)
        if (mine) row.note = "That's your own listing."; else if (mineLot) row.note = "One plot each: sell yours first to buy another.";
        else row.local = sure(row.key, "Buy " + lot.address + " from " + l.owner.name + " for " + money(l.list_price) + " SGC? Choose it again to buy.", { action: "buy_listing", plot: l.id, price: l.list_price, version: l.version });
        out.push(row);
      });
      if (!sold.length) out.push({ key: "listing-none", icon: "📌", name: "Nothing on the board", hint: "Neighbours' plots for sale show here", note: "Nobody is selling just now." });
      return out.concat([backRow()]);
    }
    if (list.kind === "plot") { // her own plot: list it (◀ ▶ the price), take it off, sell to the office, the house style and the yard
      if (!mineLot || !mineData) return [{ key: "no-plot", icon: "🪧", name: "No plot yet", hint: "Land for sale is at the counter", note: "You don't own a plot yet." }, backRow()];
      const L = cityData.layout.price, worth = plotSgc(mineData), low = Math.ceil(worth * L.list_min), high = Math.floor(worth * L.list_max), stepBy = Math.max(1, Math.round(worth * 0.05)); // LumiBot: listing prices are SGC (the server checks the same range)
      if (list.price === null) list.price = mineData.list_price || worth;
      const out = [{ key: "plot-list", icon: "🏷", name: (mineData.list_price ? "Change the price: " : "List it for ") + money(list.price) + " SGC", hint: "◀ ▶ the price · " + money(low) + " to " + money(high) + " SGC · suggested " + money(worth),
        turn: function (by) { list.price = Math.max(low, Math.min(high, list.price + by * stepBy)); },
        local: sure("plot-list", "Put " + mineLot.address + " up for " + money(list.price) + " SGC? Choose it again.", { action: "list", price: list.price }) }];
      if (mineData.list_price) out.push({ key: "plot-unlist", icon: "✋", name: "Take it off the market", hint: "Listed at " + money(mineData.list_price) + " SGC", local: function () { estate({ action: "unlist" }); } });
      const back = Math.floor(worth * L.sell_office + 0.5); // LumiBot: the same exact SGC the server pays (lumicity sell)
      out.push({ key: "plot-sell", icon: "💰", name: "Sell it to the office: " + money(back) + " SGC", hint: "At once, for half the suggested price · the house and yard things stay yours",
                 local: sure("plot-sell", "Sell " + mineLot.address + " to Lumi Realty for " + money(back) + " SGC? Choose it again.", { action: "sell" }) });
      out.push({ key: "plot-decorate", icon: "🎨", name: "Decorate my house", hint: "House style, fence, mailbox, path, lamp and ornament", local: function () { deeper(list, { kind: "decorate" }); }, estate: { mine: true } }); // one list for the house and the yard (Doll, 2026-11-20)
      return out.concat([backRow(null, list.back)]);
    }
    if (list.kind === "styles") return (cat.styles || []).map(function (s) { // every house style; the highlighted one is previewed on her plot (drawEstatePreview)
      const owned = me.styles.indexOf(s.id) >= 0 || !s.price, up = mineData && mineData.style === s.id; // hers to use? up on her plot now?
      const cost = money(price("city", s.id, s.price)) + " SGC";                       // what it costs, in SGC (same formula as the server)
      const row = { key: "style-" + s.id, icon: up ? "✓" : owned ? s.icon : "✧", name: s.name, hint: up ? "My house now" : owned ? "Yours · Enter puts it up" + (mineLot ? "" : " (once you own a plot)") : cost + " · " + s.hint,
                    estate: { style: s.id, caption: up ? "My house now" : owned ? "Yours · Enter puts it up" : cost } }; // preview: her plot with this house on it
      if (up) row.note = s.name + " is my house already!";
      else if (owned) { if (mineLot) row.local = function () { estate({ action: "style_set", item: s.id }, "Ta-da! A " + s.name + "! 🏡"); }; else row.note = "Buy a plot first, then the house goes up on it."; }
      else row.local = sure(row.key, "Buy the " + s.name + " for " + cost + "? Choose it again.", { action: "style_buy", item: s.id });
      return row;
    }).concat([backRow(null, list.back)]);
    if (list.kind === "yard" || list.kind === "decorate") { // the yard's five spots (and, decorating, the house first), then the Keepsake Capsule
      const out = [];
      if (list.kind === "decorate") { // the house itself: its style
        const style = (cat.styles || []).find(function (s) { return s.id === (mineData && mineData.style); }) || cat.styles[0]; // what's up now (the starter when unset)
        out.push({ key: "deco-house", icon: "🏠", name: "House: " + style.name, hint: "Thirty styles · Enter to choose", local: function () { deeper(list, { kind: "styles" }); }, estate: { mine: true } });
      }
      (cat.slots || []).forEach(function (slot) { // one row per yard spot, naming what's out there now
        const put = mineData && mineData.yard ? mineData.yard[slot.id] : "", item = (cat.yard[slot.id] || []).find(function (i) { return i.id === put; });
        out.push({ key: "slot-" + slot.id, icon: slot.icon, name: slot.name + ": " + (item ? item.name : "nothing yet"), hint: "Enter to choose", local: function () { deeper(list, { kind: "yard-slot", slot: slot.id }); }, estate: { mine: true } });
      });
      out.push({ key: "yard-capsule", icon: "🎁", name: cat.capsule.name, hint: money(price("city", "capsule", cat.capsule.price)) + " SGC · yard treasures you can only win", local: function () { deeper(list, { kind: "capsule" }); } });
      return out.concat([backRow(null, list.back)]);
    }
    if (list.kind === "yard-slot") { // one yard spot: clear it, or every piece for it (owned, for sale, or capsule-only); the highlighted one is previewed
      const slot = list.slot, put = mineData && mineData.yard ? mineData.yard[slot] : "";
      const out = [{ key: "yard-none", icon: "○", name: "Nothing here", hint: "Clear this spot", estate: { slot: slot, item: "", caption: "This spot left empty" },
                     local: function () { if (mineLot) estate({ action: "yard_set", slot: slot, item: "" }, "Cleared!"); else say("Buy a plot first!"); } }];
      (cat.yard[slot] || []).forEach(function (i) {
        const owned = me.yard.indexOf(i.id) >= 0, here = put === i.id, cost = money(price("city", i.id, i.price)) + " SGC"; // hers? out now? its SGC price
        const row = { key: "yard-" + i.id, icon: here ? "✓" : owned ? i.icon : i.price ? "✧" : "🔒", name: i.name, hint: here ? "In the yard now" : owned ? "Yours · Enter puts it out" : i.price ? cost + " · " + i.hint : i.rarity + " · only from the " + cat.capsule.name,
                      estate: { slot: slot, item: i.id, caption: here ? "In the yard now" : owned ? "Yours · Enter puts it out" : i.price ? cost : i.rarity + " · " + cat.capsule.name + " only" } }; // preview: her yard with this piece out
        if (here) row.note = i.name + " is out already.";
        else if (owned) row.local = function () { if (mineLot) estate({ action: "yard_set", slot: slot, item: i.id }, i.name + " is out! 🌷"); else say("Buy a plot first, then the yard is yours to decorate."); };
        else if (i.price) row.local = sure(row.key, "Buy the " + i.name + " for " + cost + "? Choose it again.", { action: "yard_buy", item: i.id });
        else row.note = i.name + " only comes from the " + cat.capsule.name + ".";
        out.push(row);
      });
      return out.concat([backRow(list.back ? "Back to the yard" : null, list.back)]);
    }
    if (list.kind === "capsule") return [
      { key: "capsule-turn", icon: "🎁", name: "Turn the " + cat.capsule.name, hint: money(price("city", "capsule", cat.capsule.price)) + " SGC · a repeat pays back half its value", local: sure("capsule-turn", "Turn it for " + money(price("city", "capsule", cat.capsule.price)) + " SGC? Choose it again.", { action: "capsule" }) },
      { key: "capsule-peek", icon: "🔒", name: "What's inside?", hint: "Every 🔒 piece in the yard lists: highlight one there to see it in your yard", note: "The 🔒 pieces in each yard spot's list come from here. Highlight one to see it in your yard!" },
      backRow(null, list.back)];
    return [backRow()];
  }

  // ---- Shopping at the Market (2026-11-14): Lumi Pet's and Lumi's Garden's own lists, in town (Doll: "shop right in town").
  function shopItems() { // Snacks, treats and toys for sale: the Shop tab, and the Market's general store.
    const pet = snap.pet, c = snap.catalog;
    return c.snacks.concat(c.treats, c.toys).filter(function (thing) { return thing.price && !pet.toys.includes(thing.id); }).map(function (thing) {
      const held = pet.inventory[thing.id] || 0, toy = c.toys.includes(thing);
      return { key: thing.id, icon: thing.icon, name: thing.name, send: { action: "buy", item: thing.id },
        hint: price("pet", thing.id, thing.price) + " SGC" + (toy ? " · a toy to keep" : held ? " · have " + held : "") };
    });
  }

  function powderRow() { // What the garden's things cost: starpowder from Lumi's Garden.
    return { key: "powder", icon: "✦", name: Gd.format(snap.garden.powder) + " starpowder", hint: "From the Stardust Garden's press: seeds and garden things cost it",
      note: "Starpowder comes from Lumi's Garden: trim flowers and use the press." };
  }

  function seedRows() { // The seed stall: every flower not growing in this garden yet, the ones she can unlock first (garden-tree.js says why not).
    const garden = snap.garden, level = snap.pet.level;
    const left = garden.flowers.filter(function (flower) { return GT.state(garden, flower, level) !== "unlocked"; });
    left.sort(function (a, b) { return (GT.state(garden, a, level) === "open" ? 0 : 1) - (GT.state(garden, b, level) === "open" ? 0 : 1); });
    if (!left.length) return [powderRow(), { key: "all-seeds", icon: "🌸", name: "Every seed is growing", hint: "This garden has them all", note: "This garden already grows every flower." }];
    return [powderRow()].concat(left.map(function (flower) {
      const row = { key: "seed-" + flower.id, icon: "🌱", name: flower.name, hint: GT.cost(flower) + " · " + GT.about(flower) };
      if (GT.state(garden, flower, level) === "open") { row.url = "garden"; row.send = { action: "unlock", item: flower.id }; }
      else { row.icon = "🔒"; row.note = GT.why(garden, flower, level); }
      return row;
    }));
  }

  function stallRows(id) { // What one of the Market's stalls sells.
    const garden = snap.garden, decor = snap.garden_decor;
    if (id === "store") return shopItems();
    if (id === "capsules") { // The Star and Moon Capsules (coins), and the Seedling Capsule (starpowder), as their own shops offer them.
      const seedling = Gd.rows({ garden: garden, decor: decor, drawer: "decor", go: function () {} }).find(function (row) { return row.key === "capsule"; });
      return Pk.capsuleRows(snap).concat(seedling ? [Object.assign({}, seedling, { key: "capsule-seed" })] : []);
    }
    if (exploring()) return [{ key: "away", icon: "🗺", name: "Lumi is out exploring", hint: "The garden's stalls wait until she's home", note: "Lumi is out exploring. The garden waits for her, and so does this stall." }];
    if (id === "seeds") return seedRows();
    if (id === "garden") { // The garden's decorations: its slots, a slot's pieces and the store of spares (garden-ui.js), without the garden's own capsule and Back.
      const drawer = marketDrawer || "decor";
      const got = Gd.rows({ garden: garden, decor: decor, drawer: drawer, go: function (change) { marketDrawer = change.drawer || null; } });
      return [powderRow()].concat(drawer === "decor" ? got.filter(function (row) { return row.key !== "back" && row.key !== "capsule"; }) : got);
    }
    return [];
  }

  // ---- Lumi Town's townsfolk, and everyone else's Lumis who are in town now (town-folk.js, mnemerynne/lumitown.py), on
  // their own layer over the town picture (#lp-folk), moved by `transform` only: the picture isn't redrawn for them.
  const folkArt = $("lp-folk"), greeted = new Set(), strolls = {};
  let visitors = [], townPolled = 0, folkSig = "", folkSay = Date.now() + 6000;
  // Local chat (docs/plans/lumi-pet-social.md phase 2, mnemerynne/lumitown.py): what's said where she is.
  let chatOn = false, phrases = [], chatPlace = "", townFeed = null, movedSoon = 0, chatLog = [], myId = null; // (myId: whose lines are "You")
  let emoteList = [], emoteTimer = 0; // the emotes the server offers (lumitown.EMOTES); her own emote's end
  const heardIds = new Set(), mine = new Set(), muted = new Set(G.store.get("town-muted", [])); // lines already shown; my own lines; who this device has muted

  function townHere() { // Tell the server where she stands (unless "Show me in town" is off), and hear who else is near, and what's been said here.
    if (!TOWN || !snap) return;
    const inside = Boolean(townAt), spot = inside ? insideAt : cityAt;
    if (!spot || (!inside && !cityMap)) return;                           // not placed yet
    townPolled = Date.now(); townPinged = Date.now();
    townListen();
    const body = { at: inside ? townAt : "city", inside: inside, x: Math.round(spot.x), y: Math.round(spot.y), face: facing < 0 ? -1 : 1 }; // (Lumi City: where she stands, not just which place)
    if (!inside) body.district = C.district(cityMap, spot.x);             // which block she's in: who's near, and who hears her
    G.api(API + "town", body).then(function (data) {
      if (data.place && data.place !== chatPlace) { chatPlace = data.place; chatLog = []; drawLog(); } // A new place: its own chatter.
      if (data.phrases) phrases = data.phrases;
      if (data.emotes) emoteList = data.emotes;
      if (data.you) myId = data.you;
      hear(data.lines || []); // (A TV, which has no stream, hears lines this way, every few seconds.)
      visitors = (data.here || []).filter(function (v) { return v && v.look && Number.isFinite(v.x) && Number.isFinite(v.y); }); // the server sends only who's near (the same place, or within a block)
      visitors.forEach(function (v) { // A hello, once a visit, for someone near.
        if (greeted.has(v.id)) return;
        greeted.add(v.id);
        say(v.name + "'s " + (v.look.name || "Lumi") + " is here! 👋");
      });
      drawFolk();
    }).catch(function () { /* the town is fine on its own */ });
  }

  function sharesPlace(v) { // A visitor where she is (so they're drawn here): inside the same place, or both out in the city.
    return townAt ? v.inside === true && v.at === townAt : !v.inside;
  }

  function folkNode(id) { return houseArt.querySelector('[data-id="' + id + '"]') || (folkArt && folkArt.querySelector('[data-id="' + id + '"]')); } // a Lumi's figure, in the city's picture or on the folk layer

  function townListen() { // A computer or phone hears lines and moves at once (GET town/stream); a TV's play pass can't ride a stream, so it polls.
    if (!(TOWN || roomOn()) || townFeed || player || !window.EventSource) return;
    townFeed = new EventSource(API + "town/stream"); // (It reconnects by itself after a blip.)
    townFeed.addEventListener("said", function (event) { try { hear([JSON.parse(event.data)]); } catch (e) { /* a garbled line is skipped */ } });
    townFeed.addEventListener("moved", function () { clearTimeout(movedSoon); movedSoon = setTimeout(TOWN ? townHere : housePing, 300); }); // Someone came, went or moved: who's here now (once, for a burst)
    townFeed.addEventListener("city", function () { if (TOWN) cityLoad(); }); // Lumi City: a plot was bought, sold, listed or built on: look again
    townFeed.addEventListener("walk", function (event) { // Someone near her took a step: in the city, in a place, or in her room of a flat.
      try {
        if (TOWN) { // Lumi City: move their Lumi (someone new nearby: ask who's here)
          const s = JSON.parse(event.data), v = visitors.find(function (q) { return q.id === s.uid; });
          if (!v) { clearTimeout(movedSoon); movedSoon = setTimeout(townHere, 300); return; }
          v.x = s.x; v.y = s.y; v.face = s.face; if (s.district) v.district = s.district; placeVisitor(v); return;
        }
        const step = JSON.parse(event.data), p = houseFolk.find(function (q) { return q.id === step.uid; });
        if (!p) { housePingSoon(); return; }
        p.x = step.x; p.y = step.y; p.face = step.face; placeFolk(p);
      } catch (e) { /* a garbled step is skipped */ }
    });
    townFeed.addEventListener("knock", function () { housePing(); }); // Someone at her door: the check-in brings who.
    townFeed.addEventListener("guestbook", function () { refresh().then(function () { say("Someone signed my guestbook! 📖"); }); }); // her own: look again
    townFeed.addEventListener("emote", function (event) { try { const e = JSON.parse(event.data); folkEmote(e.uid, e.emote); } catch (x) { /* skipped */ } });
    townFeed.addEventListener("answer", function (event) { try { knockAnswered(JSON.parse(event.data)); } catch (e) { /* skipped */ } });
    townFeed.addEventListener("home", function () { goneHome(); }); // The host has shut the door, or shown her out.
  }

  function hear(lines) { // New lines said where she is: into the log, and over the speaker's Lumi for a few seconds. Text only, never markup.
    let fresh = false;
    lines.forEach(function (line) {
      if (!line || !line.id || heardIds.has(line.id)) return;
      heardIds.add(line.id);
      if (myId !== null && line.uid === myId) mine.add(line.id);        // her own, said from this or another device
      if (line.place && chatPlace && line.place !== chatPlace) return; // Said somewhere she's just left.
      if (muted.has(line.uid) && !mine.has(line.id)) return;            // Muted on this device.
      chatLog.push(line); fresh = true;
      if (chatLog.length > 6) chatLog.shift();
      if (mine.has(line.id)) return;                                     // Her own: drawn by townSay.
      const said = folkNode("guest-" + String(line.uid)), words = said && said.querySelector(".lp-folk-say"); // (in the city's picture, or on the folk layer)
      if (words) { // Their Lumi's speech line, as the townsfolk's (game.css .lp-folk-say).
        words.textContent = line.text.length > 30 ? line.text.slice(0, 29) + "…" : line.text; // short over her head (the panel's log has it all)
        words.parentNode.classList.add("saying");
        clearTimeout(words.parentNode.sayingUntil);
        words.parentNode.sayingUntil = setTimeout(function () { words.parentNode.classList.remove("saying"); }, 6000);
      }
      G.sound.tone(987.77, .05, 0, .04); // A soft blip: someone spoke.
    });
    if (fresh) drawLog();
  }

  function drawLog() { // The last few lines said here, oldest first: "name: words". Built from text nodes only.
    const log = $("lp-chat-log");
    if (!log) return;
    log.hidden = !TOWN || !chatLog.length;
    log.replaceChildren.apply(log, chatLog.map(function (line) {
      const item = document.createElement("li"), who = document.createElement("b");
      who.textContent = mine.has(line.id) ? "You" : line.name; item.append(who, document.createTextNode(" " + line.text));
      if (mine.has(line.id)) item.className = "mine";
      return item;
    }));
  }

  function townSay(send) { // Say a phrase ({phrase}) or typed words ({text}) to everyone here; the server's words if it can't be said.
    G.api(API + "town/say", send).then(function (data) {
      mine.add(data.line.id); hear([data.line]);
      say("“" + data.line.text + "”"); // Her own bubble says it.
    }).catch(function (refused) { say(refused.message); });
  }

  function chatTyping(open, mode) { // The box to type a line in (T, or Type a message; mode "book": a guestbook line). Held keys let go, so she doesn't walk while you type.
    const form = $("lp-chat-type"), input = $("lp-chat-input");
    if (!form) return;
    if (open) {
      typingFor = mode === "book" ? "book" : "chat";
      input.placeholder = typingFor === "book" ? "A line for " + visitView.name + "'s guestbook…" : "Say something to everyone here…";
      input.setAttribute("aria-label", input.placeholder.replace("…", ""));
    }
    form.hidden = !open;
    if (open) { if (G.letGo) G.letGo(); input.focus(); } else { input.value = ""; input.blur(); }
  }

  function emoteIcon(id) { const e = emoteList.find(function (x) { return x.id === id; }); return e ? e.icon : "✨"; }

  function doEmote(id) { // Her own emote: the server tells everyone where she is (their streams); she plays it at once.
    G.api(API + "town/emote", { emote: id }).then(function () {
      clearTimeout(emoteTimer);
      room.dataset.emote = id; say(emoteIcon(id)); // game.css lp-emote-*: a little animation on her
      const me = TOWN ? houseArt.querySelector('[data-id="me"]') : null;  // Lumi City: she's drawn in the city's picture, so her figure plays it
      if (me) { me.classList.remove("lp-emote-" + id); void me.getBoundingClientRect(); me.classList.add("lp-emote-" + id); setTimeout(function () { me.classList.remove("lp-emote-" + id); }, 1800); }
      emoteTimer = setTimeout(function () { delete room.dataset.emote; }, 1800);
    }).catch(function (refused) { say(refused.message); });
  }

  function folkEmote(uid, id) { // Someone where she is waved, danced...: their Lumi plays it, with its icon over their head.
    const g = folkNode("guest-" + String(uid));
    if (!g || !/^[a-z]{1,16}$/.test(id || "")) return;
    const cls = "lp-emote-" + id, words = g.querySelector(".lp-folk-say");
    g.classList.remove(cls); void g.getBoundingClientRect(); g.classList.add(cls); // (again from the start if it was already playing)
    if (words) { words.textContent = emoteIcon(id); g.classList.add("saying"); }
    clearTimeout(g.emoteUntil);
    g.emoteUntil = setTimeout(function () { g.classList.remove(cls, "saying"); }, 1800);
  }

  function chatMute(id) { // Mute or unmute someone on this device: their lines stop (or start again) showing.
    if (muted.has(id)) muted.delete(id); else muted.add(id);
    G.store.set("town-muted", Array.from(muted));
    const who = visitors.find(function (v) { return v.id === id; });
    say(who ? (muted.has(id) ? "Muted " + who.name + ". Their lines won't show here." : "You can hear " + who.name + " again.") : "");
  }

  function chatCtx() { // The town list's chat (town-ui.js chatRows): who's here to mute, and what each row does.
    const people = (TOWN ? visitors.filter(sharesPlace) : houseFolk.filter(function (p) { return p.room === roomAt.room; }))
      .map(function (v) { return { id: v.id, name: v.name, muted: muted.has(v.id), block: !TOWN && !VISIT && !v.host }; }); // (at home: guests can be shown out)
    return { on: chatOn, phrases: phrases, people: people, emotes: emoteList, emote: doEmote,
             open: function () { chatOn = true; picks[tab] = 0; say("What shall I say?"); },
             close: function () { chatOn = false; picks[tab] = 0; },
             say: function (id) { townSay({ phrase: id }); },
             type: function () { chatTyping(true); },
             mute: chatMute, block: blockGuest };
  }

  // ---- Flats (mnemerynne/lumihouse.py, phase 3): a visit's door, knocks, and who else is in the flat.
  function visitNames() { return { host: visitView.name, lumi: (visitView.look && visitView.look.name) || "Lumi" }; } // Whose flat, for the guest lines (room-ui.js).

  function visitStart() { // Lumi Pet opened to visit someone's flat: in we go, or knock, or a closed door.
    G.api(API + "houses/" + VISIT + (AT_HOUSE ? "?home=house" : "")).then(function (data) {
      visitDoor = data;
      if (data.access === "own" && AT_HOUSE) { // her own house: her second home's rooms, hers to decorate
        HOME2 = true; VISIT = null; visitDoor = null; roomAt = Ru.clean({ room: "bedroom", at: 1 });
        if (snap) take(snap);                                            // (take swaps in the house's rooms)
        say("Home sweet second home! 🏡"); lastList = ""; lastHouse = ""; housePing(); render(); return;
      }
      if (data.access === "own") { location.replace(location.pathname); return; } // Her own flat: just Lumi Pet.
      if (data.access === "in") {
        visitView = data; visitKnock = null; roomAt = Ru.clean({ room: "bedroom", at: 1 });
        say("Hello, " + data.name + "! What a lovely flat~ ✨");
        housePing();
      } else say(data.name + "'s front door. " + (data.home ? "Shall I knock?" : "It's very quiet in there…"));
      lastList = ""; lastHouse = ""; render();
    }).catch(function (refused) { visitDoor = { name: "", access: "closed" }; say(refused.message || "That door is closed."); lastList = ""; render(); });
  }

  function doorRows() { // On someone's doorstep: knock (or wait), or go back to town.
    const name = visitDoor && visitDoor.name ? visitDoor.name : "their", out = [];
    if (visitDoor && visitDoor.access === "knock") out.push(visitKnock
      ? { key: "knock-wait", icon: "⏳", name: "Waiting at the door…", hint: "You knocked at " + name + "'s door", say: "Waiting…", note: "Waiting for " + name + " to come to the door…" }
      : { key: "knock", icon: "🚪", name: "Knock on " + name + "'s door", hint: visitDoor.home ? name + " is home" : "Nobody seems to be in", say: "Knock knock?", local: knock });
    out.push({ key: "back-town", icon: "🏘", name: "Back to town", hint: "Back out into Lumi City", say: "Back to town?", local: leaveVisit }); // erinne 43a24f4: back out into Lumi City
    return out;
  }

  function knock() { // Knock on their door: an open one just lets her in; otherwise wait for an answer (the stream, or knockCheck).
    G.api(API + "houses/" + VISIT + "/knock", {}).then(function (data) {
      if (data.in) { visitStart(); return; }
      visitKnock = data.knock; knockAsked = knockPolled = Date.now();
      say("Knock knock! 🚪 Waiting for " + visitDoor.name + "…");
      G.sound.unlock(); G.sound.tone(330, .08, 0, .2); G.sound.tone(330, .08, .22, .2); // Two little knocks.
      lastList = ""; render();
    }).catch(function (refused) { say(refused.message); });
  }

  function knockAnswered(answer) { // Their answer to her knock: in she comes, or not now.
    if (!visitKnock) return;
    visitKnock = null;
    if (answer.yes) { say(visitDoor.name + " let you in! ✨"); visitStart(); return; }
    say("Not right now. Maybe later!"); lastList = ""; render();
  }

  function knockCheck() { // A TV (no stream) asks after its knock every few seconds; anyone gives up after a minute.
    knockPolled = Date.now();
    if (Date.now() - knockAsked > 60000) { visitKnock = null; say("Nobody came to the door. Maybe they're busy!"); lastList = ""; render(); return; }
    const asked = visitKnock;
    G.api(API + "knocks/" + asked).then(function (state) {
      if (asked !== visitKnock) return;
      if (state.answer !== null) knockAnswered({ yes: state.answer });
      else if (state.gone) { visitKnock = null; say("Nobody came to the door. Maybe they're busy!"); lastList = ""; render(); }
    }).catch(function () { /* asked again in a moment */ });
  }

  function guestLook(thing, at) { // Visiting: she walks to one of their things and says something about it (never uses it). Their door leads out.
    if (typeof at === "number") roomMove({ room: roomAt.room, at: at });
    if (!visitView) return;
    if (thing.act === "door") { leaveVisit(); return; }
    say(Ru.guestLine(thing, visitNames()));
  }

  function leaveVisit() { // Out of their front door (or off the doorstep), back into Lumi Town.
    if (room.dataset.leaving === "true") return;
    room.dataset.leaving = "true";
    say(visitView ? "Bye bye! Thanks for having me~ 👋" : "Back to town!");
    G.sound.unlock(); [783.99, 659.25, 523.25].forEach(function (f, i) { G.sound.tone(f, 0.12, i * 0.09, 0.16); });
    setTimeout(function () { openApp("lumi-town", { at: wayOut() }); }, 700); // back out to where she came from: the hallway outside their flat, or the street by their house
    setTimeout(function () { delete room.dataset.leaving; }, 2500);
  }

  function goneHome() { // The host shut the door or showed her out: a polite goodbye.
    if (!VISIT || !visitView) return;
    visitView = null; houseFolk = []; drawHouseFolk();
    say("Time to go home! 👋");
    setTimeout(function () { openApp("lumi-town", { at: wayOut() }); }, 1500);
  }

  function knockRows() { // Someone at her own door: let them in, or not now.
    const out = [];
    knocksWaiting.forEach(function (k) {
      out.push({ key: "let-" + k.id, icon: "🚪", name: "Let " + k.name + " in", hint: k.name + "'s " + k.lumi + " is knocking", say: k.name + " is at my door!", local: function () { answerKnock(k, true); } });
      out.push({ key: "nope-" + k.id, icon: "🙅", name: "Not now, " + k.name, hint: "They'll hear you're busy", say: "Maybe later?", local: function () { answerKnock(k, false); } });
    });
    return out;
  }

  function answerKnock(k, yes) {
    knocksWaiting = knocksWaiting.filter(function (w) { return w.id !== k.id; }); lastList = "";
    G.api(API + "knocks/" + k.id + "/answer", { yes: yes }).then(function () {
      say(yes ? "Come in, " + k.name + "! ✨" : "Not right now, " + k.name + ".");
    }).catch(function (refused) { say(refused.message); }).then(function () { render(); });
  }

  function sayRows() { // Chatting in a flat (when there's someone to talk to, or she's a guest), and the guestbook.
    const out = [];
    if (VISIT || houseFolk.some(function (p) { return p.room === roomAt.room; })) out.push({ key: "say", icon: "💬", name: "Say something", hint: "Everyone in this room hears it",
      say: "Shall I say something?", local: function () { chatOn = true; bookOn = false; picks[ROOM] = 0; say("What shall I say?"); } });
    const book = bookEntries(), fresh = bookNew();
    if (VISIT || book.length) out.push({ key: "book", icon: "📖", name: VISIT ? visitView.name + "'s guestbook" : "My guestbook" + (fresh ? " (" + fresh + " new)" : ""),
      hint: book.length + (book.length === 1 ? " line" : " lines") + (VISIT ? " · read it, or sign it" : " from visitors"),
      say: VISIT ? "A guestbook! Shall I sign it?" : "My guestbook! Who's been to visit?", local: openBook });
    return out;
  }

  // ---- The guestbook (phase 4, lumipet.sign): visitors leave a line; unlike chat it's kept (the host's last 30).
  function bookEntries() { return (VISIT ? visitView && visitView.guestbook : snap && snap.pet.guestbook) || []; }
  function bookNew() { // Lines the host hasn't opened the guestbook to see yet (this device).
    const seen = Number(G.store.get("book-seen", 0)) || 0;
    return VISIT ? 0 : bookEntries().filter(function (e) { return e.at > seen; }).length;
  }

  function openBook() {
    bookOn = true; chatOn = false; bookPending = null; picks[ROOM] = 0;
    const book = bookEntries();
    if (!VISIT && book.length) G.store.set("book-seen", book[book.length - 1].at); // read now
    say(VISIT ? "Shall I write something nice?" : book.length ? "Look who's been to visit! 📖" : "Nobody has signed it yet.");
  }

  function bookRows() { // The guestbook, newest first: a visitor can sign it; the host can take a line out (press twice).
    const out = [], when = function (at) { try { return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (e) { return ""; } };
    if (VISIT) out.push({ key: "book-sign", icon: "✍", name: "Sign " + visitView.name + "'s guestbook", hint: "A line they can read later · Enter sends · Escape closes",
                          local: function () { chatTyping(true, "book"); } });
    bookEntries().slice().reverse().forEach(function (e) { // (people's own words and names: the list shows them as text)
      const row = { key: "book-" + e.id, icon: "📝", name: "“" + e.text + "”", hint: "— " + e.name + "'s " + e.lumi + " · " + when(e.at) };
      if (VISIT) row.note = e.name + ": “" + e.text + "”";
      else { row.hint += bookPending === e.id ? " · press again to take it out" : " · press to take it out"; row.local = function () { unsign(e); }; }
      out.push(row);
    });
    if (!bookEntries().length) out.push({ key: "book-empty", icon: "📖", name: "No lines yet", hint: VISIT ? "Be the first!" : "Friends sign it when they visit",
                                          note: VISIT ? "Be the first to sign it!" : "Nobody has signed it yet." });
    return out.concat([{ key: "book-back", icon: "‹", name: "Back", hint: "Escape, Back or B does it too", local: function () { bookOn = false; bookPending = null; picks[ROOM] = 0; } }]);
  }

  function signBook(words) { // Visiting: write a line in their guestbook.
    G.api(API + "houses/" + VISIT + "/guestbook", { text: words }).then(function (data) {
      visitView.guestbook = data.guestbook;
      say("Signed! ✍ " + visitView.name + " will see it.");
    }).catch(function (refused) { say(refused.message); }).then(function () { lastList = ""; render(); });
  }

  function unsign(e) { // At home: take a line out of her guestbook. The first press asks; the second does it.
    if (bookPending !== e.id) { bookPending = e.id; say("Press it again to take " + e.name + "'s line out."); return; }
    bookPending = null;
    G.api(API + "act", { action: "guestbook_remove", item: e.id }).then(function (data) { take(data); say("Taken out of the guestbook."); })
      .catch(function (refused) { say(refused.message); }).then(function () { lastList = ""; render(); });
  }

  function blockGuest(id) { // At home: show a guest out, and they can't come back (Settings can unblock them).
    const who = houseFolk.find(function (p) { return p.id === id; });
    G.api(API + "act", { action: "block", item: String(id) }).then(function (data) {
      take(data); chatOn = false;
      say((who ? who.name : "They") + " has gone home, and can't visit again unless you unblock them in Settings.");
    }).catch(function (refused) { say(refused.message); }).then(function () { lastList = ""; render(); });
  }

  function housePingSoon() { if (!housePingTimer && roomOn() && !TOWN) housePingTimer = setTimeout(housePing, 250); } // after a step: once per quarter second at most

  function housePing() { // Say where she stands in this flat (her own: she's home), and hear who else is here, what's said, and knocks.
    clearTimeout(housePingTimer); housePingTimer = 0;
    if (!snap || TOWN || !roomOn() || (VISIT && !visitView)) return;
    housePinged = Date.now();
    townListen();
    G.api(API + "houses/here", { host: VISIT, room: roomAt.room, x: roomAt.x, y: roomAt.y, face: facing, home: AT_HOUSE ? "house" : "flat" }).then(function (data) {
      if (data.place && data.place !== chatPlace) { chatPlace = data.place; chatLog = []; drawLog(); }
      if (data.phrases) phrases = data.phrases;
      if (data.emotes) emoteList = data.emotes;
      if (data.you) myId = data.you;
      if (data.owed && !data.paid) say("A house-warming gift! Lumi-Town Bank is closed for a moment, so your " + data.owed + " SGC is saved for you."); // LumiBot: an owed prize
      if (data.paid) { // A house-warming gift: the first visit today to this friend's flat.
        say("A house-warming gift! +" + data.paid + " SGC 🪙"); effect("cuddle", "+" + data.paid);
        if (snap && typeof data.coins === "number") { snap.coins = data.coins; $("lp-coins").textContent = data.coins.toLocaleString(); }
      }
      hear(data.lines || []);
      houseFolk = (data.here || []).filter(function (p) { return p && p.look; });
      const fresh = (data.knocks || []).filter(function (k) { return !knocksWaiting.some(function (w) { return w.id === k.id; }); });
      knocksWaiting = data.knocks || [];
      if (fresh.length) { // Someone at her door: a bubble and a little knock.
        say(fresh[0].name + "'s " + fresh[0].lumi + " is knocking! 🚪");
        G.sound.tone(392, .08, 0, .2); G.sound.tone(392, .08, .22, .2);
      }
      drawHouseFolk();
      const sig = JSON.stringify([houseFolk.map(function (p) { return [p.id, p.room]; }), knocksWaiting.map(function (k) { return k.id; })]);
      if (sig !== houseSig) { houseSig = sig; lastList = ""; render(); } // Someone came or went: the list and the lower bar change.
    }).catch(function (refused) { if (refused.status === 403 && VISIT) goneHome(); });
  }

  function drawHouseFolk() { // Everyone else in her room of this flat, at full room size, where they stand. Rebuilt only when who's here changes.
    if (!folkArt || TOWN) return;
    const here = roomOn() ? houseFolk.filter(function (p) { return p.room === roomAt.room; }) : [];
    const sig = JSON.stringify([roomAt.room, here.map(function (p) { return [p.id, p.look, p.name, p.host]; })]);
    if (sig !== folkSig) {
      folkSig = sig;
      folkArt.replaceChildren.apply(folkArt, here.map(houseFigure));
    }
    here.forEach(placeFolk);
  }

  function houseFigure(p) { // One of the others: her shadow, her shapes in her look (lumiMarkup: authored), a name tag and a speech line (text only).
    const ns = "http://www.w3.org/2000/svg", g = document.createElementNS(ns, "g"), body = document.createElementNS(ns, "g");
    g.setAttribute("class", "lp-folk-one lp-folk-guest lp-folk-house"); g.dataset.id = "guest-" + String(p.id);
    body.setAttribute("class", "lp-folk-body");
    body.innerHTML = '<ellipse cx="0" cy="2" rx="50" ry="11" fill="url(#lp-rm-shade)"/>' +
      '<g class="lp-folk-anim"><svg x="-75" y="-127" width="150" height="141" viewBox="0 0 320 300" overflow="visible">' + lumiMarkup(p.look) + "</svg></g>"; // (feet at y 0, as hers: room-ui.js; lp-folk-anim: where an emote plays)
    const tag = document.createElementNS(ns, "text"), said = document.createElementNS(ns, "text");
    tag.setAttribute("class", "lp-folk-name lp-folk-tag"); tag.setAttribute("y", "24");
    tag.textContent = (p.look.name || "Lumi") + " · " + p.name + (p.host ? " 🏠" : "");
    said.setAttribute("class", "lp-folk-say lp-folk-big"); said.setAttribute("y", "-150");
    g.append(body, tag, said);
    return g;
  }

  function placeFolk(p) { // Stand one of the others where they are, their size for that depth, facing their way.
    const g = folkArt && folkArt.querySelector('[data-id="guest-' + String(p.id) + '"]');
    if (!g) return;
    const s = Ru.scale(p.y);
    g.style.transform = "translate(" + p.x + "px, " + p.y + "px)";
    g.firstChild.style.transform = "scale(" + (p.face < 0 ? -s : s) + ", " + s + ")";
  }

  // ---- Who else is about in Lumi City (2026-11-19): the townsfolk strolling Downtown's pavements, and everyone else's
  // Lumis near her (POST town says who: the same place, or within a block). Out in the city they're drawn in the city's
  // own picture, row by row (city-art.js), so whoever stands further forward is in front; inside a place, on the folk
  // layer over its picture. (Visits happen by walking to a door now: tap-a-Lumi-to-visit is gone, Doll 2026-11-19.)
  function npcSpot(n, i) { // A townsfolk's stroll along one of Downtown's pavements: {s (their stroll), y, min, max}.
    const ch = cityMap.chunks.find(function (c) { return c.kind === "downtown"; }), tw = cityMap.tile[0], th = cityMap.tile[1];
    const min = (ch.c0 + 1) * tw, max = (ch.c1 - 1) * tw;                  // Downtown, end to end
    const s = strolls[n.id] || (strolls[n.id] = { x: min + (max - min) * ((i * 0.37 + 0.13) % 1), until: 0, left: false });
    return { s: s, y: (n.street === "market" ? cityMap.layout.avenue[1] + 1.6 : cityMap.layout.avenue[0] - 0.4) * th, min: min, max: max }; // the High Street folk up top, Market Street's down below
  }

  function cityPutStyle(node, x, y, faceLeft) { // Stand a Lumi on the folk layer (inside a place): moved by CSS, so a step eases.
    node.style.transform = "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
    node.firstChild.dataset.flip = faceLeft ? "true" : "false";
  }

  function placeVisitor(v) { // Move someone else's Lumi to where they stand now.
    const g = folkNode("guest-" + v.id);
    if (!g) { drawFolk(); return; }
    if (townAt) cityPutStyle(g, v.x, v.y, v.face < 0); else if (cityMap) cityPut(g, v.x, v.y, v.face < 0);
  }

  function cityFolkAll() { folkSig = ""; drawFolk(); } // After the city's picture is drawn afresh: everyone back into it.

  function drawFolk() { // Who's about: in the city, the townsfolk and everyone near; inside a place, whoever else is in here.
    if (!TOWN) return;
    const night = snap ? sceneNow().night : false, want = new Set();
    if (townAt) { // inside: on the folk layer, at their own place on the floor
      if (!folkArt || !townSpace) return;
      houseArt.querySelectorAll(".lp-cw-lumi").forEach(function (g) { g.remove(); });
      visitors.filter(sharesPlace).forEach(function (v) {
        const id = "guest-" + v.id; want.add(id);
        let g = folkArt.querySelector('[data-id="' + id + '"]');
        if (!g) { g = cityFigure(id, v.look, (v.look.name || "Lumi") + " · " + v.name, 92); g.classList.add("lp-folk-house"); folkArt.append(g); }
        cityPutStyle(g, v.x, v.y, v.face < 0);
      });
      Array.from(folkArt.children).forEach(function (g) { if (!want.has(g.dataset.id)) g.remove(); });
      return;
    }
    if (!cityMap || !cityAt || !houseArt.querySelector(".lp-cw-folk")) return;
    if (folkArt) folkArt.replaceChildren();
    TF.FOLK.filter(function (n) { return !night || n.night; }).forEach(function (n, i) { // the townsfolk (the night owls only, at night)
      const id = "npc-" + n.id, spot = npcSpot(n, i); want.add(id);
      let g = houseArt.querySelector('[data-id="' + id + '"]');
      if (!g) g = cityFigure(id, n.look, "", 56);
      cityPut(g, spot.s.x, spot.y, spot.s.left);
    });
    visitors.filter(sharesPlace).forEach(function (v) { // everyone near her, out in the city
      const id = "guest-" + v.id; want.add(id);
      let g = houseArt.querySelector('[data-id="' + id + '"]');
      if (!g) g = cityFigure(id, v.look, (v.look.name || "Lumi") + " · " + v.name, 62);
      cityPut(g, v.x, v.y, v.face < 0);
    });
    houseArt.querySelectorAll(".lp-cw-lumi").forEach(function (g) { if (g.dataset.id !== "me" && !want.has(g.dataset.id)) g.remove(); }); // gone home, or out of range
  }

  function folkWander() { // Once a second in the city: a townsfolk Lumi whose pause is over strolls on, and now and then one says something.
    if (!TOWN || townAt || !cityMap || G.reducedMotion) return;
    const now = Date.now(), night = sceneNow().night, out = TF.FOLK.filter(function (n) { return !night || n.night; });
    out.forEach(function (n, i) {
      const spot = npcSpot(n, i), s = spot.s;
      if (now < s.until) return;
      const by = (70 + Math.random() * 140) * (Math.random() < 0.5 ? -1 : 1), to = Math.max(spot.min, Math.min(spot.max, s.x + by)); // a stroll, turning back at Downtown's ends
      const seconds = Math.abs(to - s.x) / 35, g = houseArt.querySelector('[data-id="npc-' + n.id + '"]');
      s.until = now + seconds * 1000 + TF.pause(Math.random()); s.left = to < s.x; s.x = to;   // about 35 units a second, then a while standing about
      if (g) { g.style.transitionDuration = seconds.toFixed(1) + "s"; cityPut(g, to, spot.y, s.left); }
    });
    if (now < folkSay || !out.length) return;
    folkSay = now + 9000 + Math.random() * 9000;
    const who = out[Math.floor(Math.random() * out.length)], words = houseArt.querySelector('[data-id="npc-' + who.id + '"] .lp-folk-say');
    if (!words) return;
    words.textContent = TF.line(who.street, night, Math.random());
    words.parentNode.classList.add("saying");
    setTimeout(function () { words.parentNode.classList.remove("saying"); }, 4200);
  }
  function welcomeHome() { // Lumi Pet, after a dungeon trip: her welcome-home line, once per trip on this device (dungeon-ui.js welcome).
    const run = snap && snap.dungeon ? snap.dungeon.run : null;
    if (APP !== "lumi-pet" || !run || G.store.get("welcomed-run", null) === run.id) return;
    const line = Dg.welcome(run, serverNow());
    if (!line) return; // Not over, or too old to be news.
    G.store.set("welcomed-run", run.id);
    say(line); effect("cuddle", "✨ ♡");
  }

  function doorPress(event) { // Mouse and touch on her room's door (house.js marks it data-click="door").
    const hit = event.target.closest("[data-click]");
    if (!hit || hit.dataset.click !== "door" || !snap || APP !== "lumi-pet") return;
    if (tint || opened.home || opened.closet) return; // Choosing a colour or trying pieces on: the room is a preview just now.
    adventure();
  }

  function goHome() { // "Back" from a full-room view (the garden, the trees, the gallery): this app's first tab, or its Settings when that view is the first tab.
    if (roomCard) { closeCard(); return; } // Room mode: back to the room the card was opened in.
    changeTab(tab === 0 ? Math.max(0, TABS.indexOf("settings")) : 0); picks[tab] = 0;
  }

  function relabel(list) { // The views' own "Back to Lumi" row, in this app's words (LEAVE).
    return !LEAVE ? list : list.map(function (row) { return row.key === "leave" ? Object.assign({}, row, LEAVE) : row; });
  }

  function awayRows() { // Lumi Pet and Lumi's Garden while she is on a dungeon trip or in a fight: she is in Lumi Dungeons, and this row goes to her.
    const fighting = snap.fight && snap.fight.status === "active";
    if (has("dungeon") || !(exploring() || fighting)) return [];
    return [{ key: "away", icon: "🗝", name: exploring() ? "Lumi is out exploring" : "Lumi is in a fight", hint: "Open Lumi Dungeons to be with her" + (exploring() ? " and bring her home" : ""), local: function () { openApp("lumi-dungeons"); } }];
  }

  function take(data) { // Keep the server's answer and how far this device's clock is from the server's.
    snap = data; offset = data.now - Date.now(); polled = Date.now();
    if (HOME2 && snap.pet) { // her own house (Lumi City): its rooms stand in for her flat's, so drawing and the Home menu just work; no moving boxes there
      snap.pet.house = (snap.pet.estate && snap.pet.estate.rooms) || {};
      snap.boxes = { left: 0, total: 0, ready: false, next: "" };
    }
    $("lp-coins").textContent = data.coins.toLocaleString();
    syncParty();
    if (TOWN && !cityAsked) cityLoad();                                   // Lumi City: the map, the lots and who owns them
    if (TOWN) townStart();
  }

  function say(text) { // The live region announces it to screen readers too; in room mode it's also her speech bubble.
    $("lp-message").textContent = text;
    const bubble = $("lp-guide");
    if (bubble) bubble.textContent = text;
  }

  function effect(action, symbol) { // A brief expression in the room after an interaction.
    room.dataset.action = action; $("lp-effect").textContent = symbol; effectUntil = Date.now() + 4000;
    G.sound.unlock();
    G.sound.tone(action === "rest" ? 392 : 659.25, .22, 0, .09);
    G.sound.tone(action === "rest" ? 293.66 : 880, .3, .14, .06);
  }

  function item(id) { // Look an item up in the server's catalog.
    const c = snap.catalog;
    return c.snacks.concat(c.treats, c.toys).find(function (entry) { return entry.id === id; });
  }

  function sceneNow() { // Night follows this device's clock; naps and wakes come from the server, shifted onto this clock.
    return R.scene({ rest: snap.pet.rest, restUntil: snap.pet.restUntil - offset }, Date.now());
  }

  function mendsIn() { // Milliseconds until her health is full, counted down from the server's answer; a nap halves it.
    const napping = snap.pet.task && snap.pet.task.kind === "nap";
    return Math.max(0, snap.health.mends_in / (napping ? snap.battle.rules.nap_mend : 1) - (serverNow() - snap.now));
  }

  function rows() { // What is on offer now, as plain rows: the list and the remote both read from here.
    if (tab === ROOM) return roomRows(); // Room mode: the things where she is (or someone else's, visiting).
    const list = tabRows();
    return roomCard ? Ru.cardRows(list, roomCard, closeCard, Boolean(opened.home || (tint && tint.spot))) : list; // A card: the tab's rows (some of them), then back to the room.
  }

  function roomRows(bar) { // The room's own list: its spots, then (last, so the spots keep their places) knocks at her door and chatting.
    // bar: for the lower bar, which never shows the phrases.
    if (chatOn && !bar) return Tw.chatRows(chatCtx());
    if (bookOn && !bar) return bookRows();
    if (VISIT) {
      if (!visitView) return doorRows(); // Still on the doorstep.
      return Ru.guestRows(roomAt, { look: guestLook, walk: roomWalk, door: leaveVisit }, visitNames()).concat(sayRows());
    }
    return Ru.rows(roomAt, { open: openCard, walk: roomWalk, door: adventure }).concat(knockRows()).concat(sayRows());
  }

  function tabRows() { // What the selected tab offers.
    const pet = snap.pet, c = snap.catalog, name = TABS[tab], asleep = sceneNow().asleep;
    if (name === "town") return townRows(); // Lumi City: what's in reach, Go to…, a list that's open (the lift, the office...), or what to say.
    if (name === "care") {
      if (awayRows().length) return awayRows(); // She isn't in her room: nothing to cuddle until she is back (the Pantry can still send her a snack).
      const health = snap.health, sore = !health.out && health.hp < health.max; // Hurt, and at home to do something about it.
      const list = [
        { key: "cuddle", icon: "♡", name: "Cuddle", hint: "A little closeness", send: { action: "cuddle" } },
        asleep ? { key: "wake", icon: "☀", name: "Wake gently", hint: "A sleepy little hello", send: { action: "wake" } }
          : { key: "nap", icon: "☾", name: "Nap", hint: "Five minutes of star dreams · +35 energy" + (sore ? " · mends her twice as fast" : ""), send: { action: "nap" } },
      ];
      if (sore) { // A potion from her own pocket; bought food from the Pantry mends her too.
        const potion = { key: "drink", icon: "🧪", name: "Drink a potion (" + pet.potions + ")", hint: health.hp + " of " + health.max + " HP · whole again in " + R.countdown(mendsIn()) + ", sooner with a nap or bought food" };
        if (pet.potions) potion.send = { action: "drink" }; else potion.note = "No potions left. Lumi Dungeons sells them, on its Battle tab.";
        list.push(potion);
      }
      list.push({ key: "adventure", icon: "🏘", name: "Through the door", hint: "Out into Lumi City: Lumi Heights' lobby, then the whole city", local: adventure }); // Her room's door as a row, for remotes, keyboards and phones too narrow to show it.
      return list;
    }
    if (name === "pantry") return c.snacks.concat(c.treats).filter(function (food) { return !food.price || pet.inventory[food.id]; }).map(function (food) {
      return { key: food.id, icon: food.icon, name: food.name, send: { action: "feed", item: food.id },
        hint: R.signed(food.fullness, "hunger") + " · " + R.signed(food.joy, "joy") + (food.price && food.fullness > 0 ? " · +" + food.fullness + "% health" : "") + " · " + (food.price ? pet.inventory[food.id] + " left" : "always in the bowl") };
    });
    if (name === "toys") return c.toys.filter(function (toy) { return (!toy.price && !toy.rarity) || pet.toys.includes(toy.id); }).map(function (toy) { // Free toys, and ones bought or won from a capsule.
      return { key: toy.id, icon: toy.icon, name: toy.name, send: { action: "play", item: toy.id },
        hint: (toy.rarity ? toy.rarity[0].toUpperCase() + toy.rarity.slice(1) + " · " : "") + toy.minutes + " min · " + R.signed(toy.joy, "joy") + " · " + R.signed(toy.energy, "energy") };
    });
    if (name === "home" && tint && tint.spot) return tintRows(); // Painting a wall or floor: the colour sliders.
    if (name === "closet" || name === "home") { // One row per place on Lumi, or per spot in the house; ◀ ▶ flip its choices (picker-ui.js).
      const ctx = { snap: snap, open: opened[name], flip: flip, paint: openPaint, go: function (change) {
        if ("open" in change) { opened[name] = change.open; picks[tab] = change.open ? 1 : (change.pick || 0); }
      } };
      return name === "home" ? Pk.homeRows(ctx) : Pk.closetRows(ctx);
    }
    if (name === "battle") return battleRows();
    if (name === "skills") return relabel(Sk.rows({ snap: snap, cursor: skillCursor || snap.battle.trees[0].nodes[0].id, go: skillsGo }));
    if (name === "collection") return relabel(Cl.rows({ snap: snap, at: album, zoom: albumZoom, go: albumGo }));
    if (name === "garden" && exploring()) return awayRows(); // Lumi's Garden during a dungeon trip: the garden grows without her until she is home (lumipet.garden_act).
    if (name === "garden" && paging()) return relabel(GT.rows(drawer, pageCtx())); // The Flower tree, Helpers or Moonrise page.
    if (name === "garden") return relabel(Gd.rows({ garden: snap.garden, decor: snap.garden_decor, drawer: drawer, seed: seed, cursor: plotCursor, mini: mini, passed: passed(), pending: pending, level: pet.level, go: gardenGo }));
    if (name === "dungeon") { // A dungeon fight and its result use the Battle lists; everything else is the dungeon's own.
      if (couching()) return []; // The couch draws one menu per person instead (drawCouch).
      if ((snap.fight && snap.fight.status === "active") || finished) return battleRows();
      const home = inParty() ? null : function () { openApp("lumi-town", { at: "tavern" }); }; // "Back to town", out the tavern's front door (not from a party: leaving the page would leave her friends).
      const own = Dg.rows({ snap: snap, play: play, dismissed: dismissedRun, care: caring, go: dungeonGo, home: home });
      if (inParty() && party.phase === "lobby") return Pu.lobbyRows(party, partyAct);
      if (inParty() && party.run) return Pu.tripRows(party, own, serverNow(), fightCtx(aim, ally));
      if (!exploring() && !(snap.dungeon.run && snap.dungeon.run.over && dismissedRun !== snap.dungeon.run.id)) { // Choosing where to go: or going with friends.
        askParties();
        if (browsing) return Pu.browserRows(openParties, { at: browsing.at, back: function () { browsing = null; picks[tab] = 0; }, askCode: TV ? null : askCode });
        return (home ? [Dg.homeRow(home)] : []).concat(Pu.startRows({ open: openParties, tv: TV, askCode: askCode, browse: browse }), own); // The way back to town first, then friends, then places.
      }
      return own;
    }
    if (name === "shop") return Pk.capsuleRows(snap).concat(shopItems()); // The capsules first: this is where people look to buy one.
    if (tint) return tintRows(); // The colour drawer: red, green and blue, then keep it or go back.
    const settings = []; // Settings: each app lists what is its own, then the way to Lumi's other apps.
    settings.push({ key: "name", icon: "✎", name: "Name: " + pet.name, hint: "What she's called, and what her friends see in a party", local: askName });
    settings.push({ key: "colour", icon: "🎨", name: "Colour: " + (pet.colour ? pet.colour.toUpperCase() : "her glow's own"), hint: "Red, green and blue sliders for her very own colour", local: openTint });
    if (APP !== "lumi-garden") settings.push({ key: "glow", icon: "✦", name: "Glow: " + pet.glow[0].toUpperCase() + pet.glow.slice(1), hint: "◀ ▶ her colour, and her element in a fight: " + snap.battle.rules.glows[pet.glow], send: { action: "glow", glow: R.nextPalette(pet.glow) },
      turn: function (by) { submit({ key: "glow", send: { action: "glow", glow: Pk.turn(R.PALETTES, pet.glow, by) } }); } });
    if (false && has("dungeon")) settings.push({ key: "storyteller", icon: "✎", name: "Storyteller: " + (pet.storyteller === "live" ? "Live" : "Library"), hint: "Who writes the dungeon's lines: the game's library, or a model as you go", send: { action: "storyteller" } }); // LumiBot: hidden, no live storyteller in Lumi-Town (the library tells the story)
    settings.push({ key: "sound", icon: "♪", name: "Sound: " + (G.sound.isOn() ? "on" : "off"), hint: "Little chimes", local: function () { G.sound.toggle(); } });
    if (APP === "lumi-pet") settings.push({ key: "town-seen", icon: "👀", name: "Show me in Lumi City: " + (pet.town_seen === false ? "off" : "on"), // Also on the town's own map.
      hint: pet.town_seen === false ? "Nobody sees your Lumi in town; you still see theirs" : "Others in Lumi Town see your Lumi there, in her clothes, with her name", send: { action: "town_seen" } });
    if (APP === "lumi-pet") { // Visitors to her flat (lumihouse.py): her front door, and anyone she has blocked.
      const door = pet.door || "knock";
      settings.push({ key: "door", icon: "🚪", name: "My front door: " + { knock: "knock first", open: "open to everyone", closed: "closed" }[door],
        hint: { knock: "Visitors knock, and you let them in · next: open", open: "Anyone in Lumi Town can walk in · next: closed", closed: "Nobody can visit · next: knock first" }[door],
        send: { action: "door" } });
      (snap.blocked || []).forEach(function (b) { // (their names: people's own words, shown as text by the list)
        settings.push({ key: "unblock-" + b.id, icon: "🚫", name: "Unblock " + b.name, hint: "They can visit your flat again", send: { action: "unblock", item: String(b.id) } });
      });
    }
    if (APP === "lumi-pet") settings.push({ key: "room-mode", icon: "🏠", name: "Room mode: " + (pet.room_mode === false ? "off" : "on"), // Walk her flat and press things, or these lists.
      hint: pet.room_mode === false ? "Lists, as before · on: walk Lumi's flat and press the fridge, the bed, the wardrobe…" : "Walk Lumi's flat and press things · off: just the lists", send: { action: "room_mode" } });
    if (WHO) settings.push({ key: "switch-player", icon: "⇄", name: "Switch player", hint: "Playing " + (player ? player.name + "'s" : "this TV's own") + " Lumi · someone else presses OK on their remote", local: function () { forgetPlayer("Who's playing next?"); } }); // A shared TV: hand it to the next person.
    if (reminders !== "unsupported" && !has("dungeon")) { // Phones and computers only: a TV has nobody's pocket to buzz. Her needs and her flowers send them; the dungeons never do.
      if (has("garden")) settings.push({ key: "garden-reminders", icon: "❀", name: "Garden reminders: " + (pet.garden_reminders === false ? "off" : "on"), hint: "A nudge when slow flowers are ready to trim (needs Reminders on)", send: { action: "garden_reminders" } });
      settings.push({ key: "reminders", icon: "✉", name: "Reminders: " + reminders, local: toggleReminders,
        hint: reminders === "blocked" ? "Allow notifications for this site in your browser first" : "A nudge on this device when Lumi needs you" });
    }
    Object.keys(APPS).forEach(function (slug) { // Lumi's other two apps.
      if (slug !== APP) settings.push({ key: "open-" + slug, icon: APPS[slug][0], name: "Open " + APPS[slug][1], hint: APPS[slug][2], local: function () { openApp(slug); } });
    });
    if (APP === "lumi-dungeons" || APP === "lumi-garden") settings.push({ key: "town", icon: "🏘", name: "Back to town", hint: "Lumi City: Lumi Heights, the Arcade, the Casino, Lumi Realty and her house", // Out of the tavern's door, or the garden's gate.
      local: function () { openApp("lumi-town", { at: APP === "lumi-garden" ? "garden" : "tavern" }); } });
    if (!inApp && !framed) settings.push({ key: "install", icon: "⬇", name: "Install " + NAME, hint: "Its own icon on your home screen, opening straight here", local: installApp }); // In a browser tab: each of Lumi's apps can be an app of its own.
    settings.push({ key: "sign-out", icon: "↪", name: "Sign out", hint: "Log out of Lumi-Town on this device", local: signOut }); // LumiBot: the games hub had the only Sign out; now it lives here, last, in every Lumi app's settings
    return settings;
  }

  // ---- Room mode: walking her flat, opening and closing cards (room-ui.js has the rooms, room-art.js the new things).
  function roomOn() { // Room mode is showing: Lumi Pet, her setting on (old saves count as on), and nobody choosing a player or on the couch.
    return APP === "lumi-pet" && Boolean(Ru) && Boolean(snap) && (Boolean(VISIT) || snap.pet.room_mode !== false) && !picking && !couching();
  }

  function syncRoom() { // Keep the tab in step with room mode: the room's own rows when no card is open, the lists when it's off.
    const on = roomOn();
    if (!on) { roomCard = null; if (tab === ROOM) changeTab(0); }
    else if (!roomCard && tab !== ROOM) changeTab(ROOM); // Switched on (from Settings' list), or a card closed.
    if (on && !chatOn && !bookOn && !(VISIT && !visitView)) picks[ROOM] = roomAt.at; // The room's cursor is where she stands (in a list of phrases, or on a doorstep, it's the list's own).
    $("gm").dataset.rooms = String(on || TOWN); // game.css folds the tabs away (Lumi City is laid out like her flat: the lower bar, and the panel only for a list).
    return on;
  }

  function roomMove(to) { // She walks to another spot (or room): remembered on this device, with a soft step.
    target = null; // A snap move (a remote, the lower bar, a thing pressed) ends any free walk to a clicked spot.
    const next = Ru.clean(to), crossing = next.room !== roomAt.room, moved = crossing || next.at !== roomAt.at || next.x !== roomAt.x; // Measured before she goes.
    roomAt = next; picks[ROOM] = roomAt.at;
    if (!VISIT && !HOME2) G.store.set("room-at", roomAt); // (a visit, or her house, isn't remembered: home is where she was)
    housePingSoon();                             // the others in the flat see her step
    if (moved) { G.sound.unlock(); G.sound.tone(crossing ? 587.33 : 523.25, .08, 0, .06); } // A higher step through a doorway.
  }

  function roomWalk(to) { roomMove(to); lastList = ""; render(); } // A "To the kitchen" row, or an edge arrow.

  function openCard(thing, at) { // Use a thing: she walks to it and its card opens (that tab's rows).
    if (VISIT) { guestLook(thing, at); return; } // Someone else's: she only looks (and their door leads out).
    if (typeof at === "number") roomMove({ room: roomAt.room, at: at });
    if (thing.act === "door") { adventure(); return; } // The front door: straight out into town, as ever.
    const to = TABS.indexOf(thing.tab);
    if (to < 0) return; // Not a tab this app has (can't happen in Lumi Pet; kept safe).
    changeTab(to); roomCard = thing; picks[tab] = 0; lastList = "";
    const offered = rows().filter(function (row) { return row.key !== "card-back"; });
    if (thing.keys && offered.length === 1) { // One choice (the potion shelf): no menu, she just does it.
      const only = offered[0];
      roomCard = null; changeTab(ROOM);
      if (only.note && !only.send) say(only.note); else if (only.local) only.local(); else if (only.send) submit(only);
      return;
    }
    say(Ru.guide(roomAt, thing)); // Lumi the guide: what she says as its menu opens (right-hand panel).
  }

  function closeCard() { // Back to the room, standing where she was. True when a card was open.
    if (!roomCard) return false;
    roomCard = null; changeTab(ROOM); lastList = ""; render();
    startWalk(); // A key still held from the menu walks her on at once.
    return true;
  }

  function roomKey(action, arrow, meta) { // The keys in room mode. True when used here; false lets the usual handling run (a card's list, Enter, Play).
    if (chatOn || bookOn || (VISIT && !visitView)) return false; // The phrases, the guestbook, or a doorstep: the arrows go through the list.
    if (tab === ROOM) {
      if (arrow && meta && meta.held) return true; // A held key, pad or panel button: free walking (onHold) moves her, not a snap step.
      if (arrow) { roomMove(Ru.step(roomAt, action === "left" || action === "up" ? -1 : 1)); lastList = ""; render(); return true; }
      if (action === "next" || action === "prev") { roomMove(Ru.hop(roomAt, action === "prev" ? -1 : 1)); lastList = ""; render(); return true; }
      return false; // Enter uses the spot (its row), Play drinks a potion.
    }
    if (roomCard && (action === "next" || action === "prev")) { closeCard(); return true; } // No tabs to flip through in a card: back to the room.
    return false;
  }

  function roomPress(event) { // Mouse and touch in room mode: a thing (walk to it and use it), or the floor (walk to just there).
    if (!roomOn() || room.dataset.leaving === "true") return;
    const hit = event.target.closest("[data-click]");
    if (hit && hit.dataset.click.indexOf("thing:") === 0) {
      const at = Ru.find(roomAt.room, hit.dataset.click.slice(6)), spot = Ru.layout(roomAt.room)[at];
      if (spot) { pendingConfirm = null; openCard(spot, at); render(); }
      return;
    }
    if (tint || (roomCard && (opened.home || opened.closet))) return; // Trying a colour or a piece on: the room is a preview, so a stray press doesn't walk off.
    walkTo(event);
  }

  function floorAt(event) { // Where on the room's 1000 x 500 drawing a press was (or null where the browser can't say).
    const matrix = houseArt.getScreenCTM && houseArt.getScreenCTM();
    if (!matrix) return null;
    const point = houseArt.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function walkTo(event) { // A press on the floor (or a middle-click anywhere): she walks there, never using anything on the way.
    const at = floorAt(event);
    if (!at) return;
    if (roomCard) { roomCard = null; changeTab(ROOM); lastList = ""; render(); } // Walking away closes the card.
    target = Ru.clean(Ru.point(roomAt.room, at.x, at.y)); // Clamped to the room's floor, and (clean) out in front of any thing pressed on: somewhere she can stand. She walks round things in the way.
    startWalk();
  }

  // ---- Free walking (docs/plans/lumi-pet-social.md phase 1, Doll's design 2026-11-19). Held arrows and WASD
  // (common.js MGame.onHold), a gamepad (gamepad.js MPad, its stick analog), the Tab5's or a phone's pad in gamepad mode,
  // and a press on the floor all walk her, a little each animation frame, through room-ui.js move() (which keeps her
  // off the things and carries her through to the next room). The loop only runs while something walks her.
  // A TV remote's single presses stay snap steps (roomKey).
  // (Its state is declared with roomAt, near the top: SPEED, holds, target, walkFrame, walkLast, walkSaved, facing.)

  function onHold(who, x, y) { // A keyboard, pad or panel holds a direction (x, y each -1..1), or lets go (0, 0).
    if (x || y) { holds[who] = { x: x, y: y }; target = null; } // The keys take over from a click's walk.
    else delete holds[who];
    startWalk();
  }

  function heldWay() { // Everything held, added up, no faster than one stick pushed all the way (a diagonal isn't quicker).
    let x = 0, y = 0;
    Object.keys(holds).forEach(function (who) { x += holds[who].x; y += holds[who].y; });
    const size = Math.hypot(x, y);
    return size > 1 ? { x: x / size, y: y / size } : { x: x, y: y };
  }

  function canWalk() { return roomOn() && tab === ROOM && !roomCard && !chatOn && !bookOn && !(VISIT && !visitView) && room.dataset.leaving !== "true"; } // The room is showing, no menu open, not going out of the door.

  function startWalk() { if (!walkFrame) { walkLast = 0; walkFrame = requestAnimationFrame(walkTick); } } // Start the loop (once).

  function stopWalk() { // Nothing walks her: CSS animations back on, and her place remembered on this device.
    walkFrame = 0; walkLast = 0;
    if (room.dataset.walking) delete room.dataset.walking;
    if (!walkSaved) { walkSaved = true; if (!VISIT && !HOME2) G.store.set("room-at", roomAt); }
  }

  function walkTick(now) { // One frame of walking.
    if (TOWN) { townTick(now); return; }                                  // Lumi City walks her its own way (its streets, its insides, routes)
    walkFrame = 0;
    const dt = walkLast ? Math.min(0.05, (now - walkLast) / 1000) : 0; walkLast = now; // (Capped: a slow frame never jumps her across the room.)
    let way = heldWay(), left = Infinity;
    if (!(way.x || way.y) && target) { // A click's walk: straight toward the spot.
      const dx = target.x - roomAt.x, dy = target.y - roomAt.y, size = Math.hypot(dx, dy);
      if (target.room !== roomAt.room || size < 2) target = null;
      else { way = { x: dx / size, y: dy / size }; left = size; }
    }
    if (!canWalk() || !(way.x || way.y)) { if (!canWalk()) target = null; stopWalk(); return; }
    room.dataset.walking = "true"; // game.css: no easing while she walks (it would trail behind her)
    let sx = way.x * SPEED.x * dt, sy = way.y * SPEED.y * dt;
    const step = Math.hypot(sx, sy);
    if (step > left) { sx *= left / step; sy *= left / step; } // The last step of a click's walk lands exactly on the spot.
    if (sx) facing = sx < 0 ? -1 : 1;
    const before = roomAt, still = function (at) { return at.room === before.room && at.x === before.x && at.y === before.y; };
    let next = Ru.move(roomAt, sx, sy);
    if (target && dt && next.room === before.room) { // A click's walk: did that step get her closer?
      const gap = function (at) { return Math.hypot(target.x - at.x, target.y - at.y); };
      if (gap(before) - gap(next) < Math.hypot(sx, sy) / 2) { // Less than half a step closer: a thing is in the way.
        const around = Ru.move(roomAt, 0, SPEED.y * dt);       // Step toward the front, round its base (the front is always clear)...
        if (!still(around)) next = around;
        else if (still(next)) target = null;                   // ...and if nothing moves her at all, she's as close as she can get.
      }
    }
    roomAt = next; picks[ROOM] = roomAt.at; walkSaved = false;
    if (next.room !== before.room) { G.sound.tone(587.33, .08, 0, .06); target = null; } // Through a doorway: the doorway's step.
    if (next.room !== before.room || next.at !== before.at) { lastList = ""; render(); } // A new room, or a new spot (her bubble, the lower bar, the list)
    else placeLumi();                                                                        // otherwise only where she is
    housePingSoon();                                                                         // and the others in the flat see her walk
    walkFrame = requestAnimationFrame(walkTick);
  }

  function placeLumi() { // Where she stands, drawn: the pan that keeps her in view, her place, size and facing (game.css), her shadow, the thing in reach.
    const pan = roomPan(roomAt.x);
    houseArt.setAttribute("viewBox", pan + " 0 1000 500");
    if (folkArt) folkArt.setAttribute("viewBox", pan + " 0 1000 500"); // the others in the flat pan with the room
    room.style.setProperty("--gx", String(Math.round(roomAt.x - 500 - pan))); // from the middle of what's shown
    room.style.setProperty("--gy", String(Math.round(roomAt.y)));             // her feet
    room.style.setProperty("--gs", Ru.scale(roomAt.y).toFixed(3));            // a little smaller further back
    room.style.setProperty("--face", String(facing));
    const shade = document.getElementById("lp-rm-shadow"), r = Ru.shadow(roomAt);
    if (shade) ["cx", "cy", "rx", "ry"].forEach(function (k) { // Her shadow: as attributes (every browser), and as CSS too, so game.css can ease it along with her on a snap step
      shade.setAttribute(k, r[k]); shade.style.setProperty(k, r[k] + "px");
    });
    const near = Ru.reach(roomAt), mark = near >= 0 ? "thing:" + Ru.layout(roomAt.room)[near].id : "";
    houseArt.querySelectorAll(".lp-rm-hit").forEach(function (box) { box.classList.toggle("lp-rm-near", box.dataset.click === mark); });
  }

  function roomPan(x) { // How far to slide the room's drawing sideways so Lumi, at x, is in view: 0 when the screen shows the whole flat's width.
    const box = room.getBoundingClientRect();
    if (!box.width || !box.height) return 0;
    const shown = box.width / Math.max(box.width / 1000, box.height / 500); // Drawing units across the screen (the drawing is cropped to fill it).
    const reach = Math.max(0, (Ru.REACH[1] - Ru.REACH[0] - shown) / 2);        // How far a pan may go before showing past the room's things.
    return Math.round(Math.max(-reach, Math.min(reach, x - 500)));             // Centre on her, never past either end.
  }

  function drawRoom(preview) { // Room mode's picture: the room she's in (house.js walls, room-art.js things), and her standing at her spot.
    const here = Ru.room(roomAt.room);
    const trying = tint && tint.spot ? [tint.spot, tintHex()] : preview || null; // a colour being painted, or a piece tried on
    const own = VISIT ? (visitView ? visitView.house : {}) : snap.pet.house; // visiting: their flat as they decorated it (lumipet.house_view)
    const house = RA.view(here.id, own, VISIT ? null : trying); // this room's own wall and floor (else the bedroom's), with that in it
    room.dataset.rooms = here.id;
    const whose = VISIT && (visitView || visitDoor) ? (visitView || visitDoor).name : ""; // (a person's own name: text only)
    $("lp-place").textContent = whose ? whose.toUpperCase() + "'S " + (visitView ? here.name.replace(/^HER |^THE /, "") : "FRONT DOOR") : here.name; // (not in yet: their doorstep)
    const scenery = document.querySelector(".parallax"), backdrop = Boolean(scenery) && getComputedStyle(scenery).display !== "none";
    const boxes = here.id !== "bedroom" ? 0 : VISIT ? (visitView ? visitView.boxes : 0) : (snap.boxes ? snap.boxes.left : 0);
    const signature = JSON.stringify(["room", here.id, house, backdrop, boxes]);
    if (signature !== lastHouse) { // Only redrawn when the room or what's in it changes: walking just moves her and her shadow (placeLumi).
      lastHouse = signature;
      room.dataset.open = String(backdrop && house.view === "view-city"); // Her windows open onto the page's scenery in every room.
      houseArt.innerHTML = (here.id === "bedroom" ? H.render(house, backdrop, { boxes: boxes, shift: RA.BEDROOM_SHIFT }) : H.render(house, backdrop, { only: RA.SHELL })) + // her furniture spread out (room-art.js)
        RA.scene(here.id, house) + Ru.hits(here.id, roomAt); // All authored in house.js, room-art.js and room-ui.js; nothing a person typed.
    }
    placeLumi(); // A narrow screen follows her across the room (the pan); a wide one shows it all.
    drawHouseFolk(); // Whoever else is in this room of the flat.
  }

  function drawThings(on) { // Room mode's lower bar: the things in this room (and the ways through), each with Lumi's bubble saying what it is.
    const bar = $("lp-things");
    bar.hidden = !on;
    if (!on) { lastThings = ""; return; }
    const list = roomRows(true); // The same rows the room's list has (never the phrases).
    const current = roomCard ? Ru.find(roomAt.room, roomCard.id) : (VISIT && !visitView) || chatOn || bookOn ? picks[ROOM] : roomAt.at; // Her spot, the thing whose menu is open, or (a doorstep, the phrases) the list's cursor.
    const signature = roomAt.room + "|" + list.map(function (row) { return row.key; }).join("|");
    if (signature !== lastThings) { // Rebuilt only when she changes room, so a button being pressed is never swapped mid-press.
      lastThings = signature;
      bar.replaceChildren.apply(bar, list.map(function (row, index) {
        const button = document.createElement("button"), icon = document.createElement("span"), bubble = document.createElement("span"), name = document.createElement("b");
        button.type = "button"; button.className = "lp-thing"; button.dataset.thing = row.key;
        icon.className = "lp-thing-icon"; icon.textContent = row.icon; icon.setAttribute("aria-hidden", "true");
        bubble.className = "lp-thing-say"; name.textContent = row.name; // Her bubble: what it is, then her words for it.
        bubble.append(name, document.createTextNode(" " + (row.say || row.hint)));
        button.append(icon, bubble);
        button.addEventListener("click", function () { // Walk to it and use it (a menu opens on the right where it needs one).
          pendingConfirm = null;
          if (roomCard) { roomCard = null; changeTab(ROOM); } // Another thing: this menu closes first.
          if (index < Ru.layout(roomAt.room).length && !(VISIT && !visitView)) roomMove({ room: roomAt.room, at: index }); // a spot: she walks to it (the buttons after the spots, chatting, the guestbook and knocks, and a doorstep's, have no spot)
          row.local(); lastList = ""; render();
        });
        return button;
      }));
    }
    Array.from(bar.children).forEach(function (button, index) { button.setAttribute("aria-pressed", String(index === current)); });
  }

  function drawRoomBits(on) { // Room mode's extras around the picture: her speech bubble, the lower bar, the arrows to the next rooms.
    const guide = $("lp-guide"), ways = on && !roomCard && !(VISIT && !visitView) ? Ru.neighbours(roomAt) : { left: null, right: null };
    $("gm").dataset.card = String(on && (Boolean(roomCard) || chatOn || bookOn)); // game.css shows the right-hand panel only for an open menu (or the phrases, with the chat log).
    if (!on) { delete room.dataset.rooms; guide.hidden = true; $("lp-place").textContent = PLACE; if (houseArt.getAttribute("viewBox") !== "0 0 1000 500") houseArt.setAttribute("viewBox", "0 0 1000 500"); } // unpanned again
    else { guide.hidden = false; guide.textContent = $("lp-message").textContent; } // Her bubble says what she last said.
    drawThings(on);
    [["left", $("lp-way-left")], ["right", $("lp-way-right")]].forEach(function (pair) {
      const to = ways[pair[0]];
      pair[1].hidden = !to;
      if (to) { // Its label is the room's short name ("kitchen"); its accessible name says where it walks.
        const short = to.name.replace(/^HER |^THE /, "").toLowerCase();
        pair[1].querySelector("[data-way-name]").textContent = short; pair[1].dataset.go = to.id;
        pair[1].setAttribute("aria-label", "Walk to the " + short);
      }
    });
  }

  function drawTownBits(pick) { // Lumi City laid out like her flat (Doll, 2026-11-19): the lower bar of what's here, her bubble, the right-hand panel only while a list is open.
    const guide = $("lp-guide"), placed = Boolean(snap) && Boolean(townAt ? insideAt : cityAt); // her bubble element; placed = she is standing somewhere in the city
    $("gm").dataset.card = String(Boolean(townList) || chatOn);            // game.css: the panel shows only for a list (the lift, Go to…, an office counter, the phrases)
    guide.hidden = !placed; guide.textContent = $("lp-message").textContent; // her words, over her head
    drawTownBar(placed); // the lower bar (hidden until she is placed)
    drawEstatePreview(townList && !chatOn && pick ? pick : null); // Lumi Realty's preview card, for the highlighted row of an open list
  } // end of drawTownBits

  let lastEstate = ""; // what the preview card last drew (one string), so it's only redrawn when the highlighted thing changes
  function estateLook(change) { // Her plot as the preview card shows it: {style, yard} now, with the highlighted row's change put on top. Pure.
    const mine = myLot() ? lotData(myLot().id) : null;                     // her plot's row from GET city (null: no plot yet)
    const look = change.fresh || !mine ? { style: "starter-cottage", yard: {} } : { style: mine.style || "starter-cottage", yard: Object.assign({}, mine.yard || {}) }; // a new plot is bare with the starter; else hers as it stands
    if (change.style) look.style = change.style;                          // a house style being looked at
    if (change.slot) { if (change.item) look.yard[change.slot] = change.item; else delete look.yard[change.slot]; } // a yard piece being looked at ("" = the spot cleared)
    return look;                                                          // {style, yard}
  } // end of estateLook

  function drawEstatePreview(row) { // The preview card (Doll, 2026-11-20): her plot drawn with what's highlighted put on it. Nothing is bought or changed by looking.
    const card = $("lp-estate-card"), Es = window.LumiPetEstateArt;        // the card in the room, and the house drawings (estate-art.js)
    if (!card) return;                                                    // (an old page without the card: nothing to do)
    const change = row && row.estate;                                     // only rows that say what to preview have one
    if (!change || !Es || !cityData) { card.hidden = true; lastEstate = ""; return; } // nothing to show: tuck the card away
    const look = estateLook(change), night = sceneNow().night;            // what to draw, and whether it's dark out
    const name = snap && snap.pet ? snap.pet.name || "Lumi" : "Lumi";     // her nameplate (escaped inside estate-art.js)
    const caption = change.caption || (myLot() ? myLot().address : "");   // the words under the picture
    const sig = JSON.stringify([look, night, name, row.name, caption]);   // everything the card shows
    if (sig === lastEstate) return;                                       // unchanged: leave it be
    lastEstate = sig; card.hidden = false;                                // show it
    const pavement = '<rect x="-8" y="80" width="272" height="44" fill="' + (night ? "#1a1430" : "#241c3e") + '"/><rect x="-8" y="80" width="272" height="2" fill="#3a3450"/>'; // the pavement in front, where a garden path runs out to
    $("lp-estate-svg").innerHTML = pavement + Es.plot({ x: 0, y: 0, w: 256, h: 80 }, { style: look.style, yard: look.yard, night: night, name: name }); // one lot at its city size (authored shapes; the name is escaped there)
    const cap = $("lp-estate-cap"), title = document.createElement("b");  // the caption: the thing's name in gold, then the note
    title.textContent = "Preview · " + row.name;                          // text only: nothing here is read as markup
    cap.replaceChildren(title, document.createTextNode(caption ? " · " + caption : "")); // e.g. "Preview · Rose Villa · 2,400 SGC"
  } // end of drawEstatePreview

  function drawTownBar(on) { // Lumi City's lower bar: what's in reach, the other things here (inside) or the town's rows (out in the city), each with her bubble.
    const bar = $("lp-things"); // the lower bar element (shared with her flat)
    bar.hidden = !on; // shown only once she is placed
    if (!on) { lastThings = ""; return; } // hidden: forget what it drew, so it redraws next time
    const list = baseTownRows();                                            // (the first is what's in reach, when anything is)
    const signature = "town|" + list.map(function (row) { return row.key + ":" + row.name; }).join("|"); // what the bar shows, as one string
    if (signature !== lastThings) { // rebuilt only when what's here changes, so a button being pressed is never swapped mid-press
      lastThings = signature; // remember what is drawn
      bar.replaceChildren.apply(bar, list.map(function (row) { // one button per row
        const button = document.createElement("button"), icon = document.createElement("span"), bubble = document.createElement("span"), name = document.createElement("b"); // the button and its parts
        button.type = "button"; button.className = "lp-thing"; button.dataset.thing = row.key; // a lower-bar thing, keyed by its row
        icon.className = "lp-thing-icon"; icon.textContent = row.icon; icon.setAttribute("aria-hidden", "true"); // its icon (decorative for screen readers)
        bubble.className = "lp-thing-say"; name.textContent = row.name; // her bubble: what it is, then what it does
        bubble.append(name, document.createTextNode(" " + (row.say || row.hint || ""))); // name, then her line or the hint
        button.append(icon, bubble); // put it together
        button.addEventListener("click", function () { // use it: a walk, a list in the panel, or (Show me in town) the server
          pendingConfirm = null; chatOn = false; townList = null; // close anything half-open first
          if (row.local) row.local(); else if (row.send) submit(row); // do it here, or ask the server
          lastList = ""; render(); // redraw everything
        }); // end of the click handler
        return button; // the finished button
      })); // end of the buttons
    } // end of the rebuild
    const near = nearThing ? (townAt ? "thing-" + nearThing.id : "use") : ""; // which button is in reach (inside: the thing; outside: the use row)
    Array.from(bar.children).forEach(function (button) { button.setAttribute("aria-pressed", String(Boolean(near) && button.dataset.thing === near)); }); // light up the one in reach
  } // end of drawTownBar

  function changeTab(to) { // Open a category afresh: its sub-lists closed, nothing half-chosen.
    tab = to; opened = { home: null, closet: null }; flip = {}; battleView = null; pendingConfirm = null; albumZoom = false; albumFocus = "board"; skillFocus = "board"; tint = null; browsing = null;
  }

  // ---- Her name and her colour (Settings).
  function askName() { // A keyboard's way to name her; the server checks it (1 to 16 letters, numbers, spaces, ' . -).
    const name = window.prompt("What's her name?", snap.pet.name);
    if (name !== null && name.trim()) submit({ key: "name", send: { action: "name", name: name } });
  }

  function openTint() { // Open the colour drawer on the colour she has now (her own, or her glow's).
    const now = R.hexRgb(R.looks(snap.pet.glow, snap.pet.colour).glow);
    tint = { r: now[0], g: now[1], b: now[2] }; picks[tab] = 1;
  }

  function openPaint(spot, colour) { // Home → a wall or floor → Paint it a colour: the sliders, on its colour now (or a soft lilac).
    const now = R.hexRgb(colour || "#b98aa9");
    tint = { r: now[0], g: now[1], b: now[2], spot: spot }; picks[tab] = 1; lastList = "";
  }

  function tintHex() { return R.rgbHex([tint.r, tint.g, tint.b]); }

  function nudge(part, by) { tint[part] = Math.max(0, Math.min(255, tint[part] + by)); render(); } // One slider moved by a key.

  function tintRows() { // The colour drawer: a row each for red, green and blue (◀ ▶ move it; the sliders do too), then keep it.
    // With tint.spot it paints that wall or floor instead of colouring her (room mode's paint pots), shown in the room as it moves.
    const names = { r: ["Red", "🔴"], g: ["Green", "🟢"], b: ["Blue", "🔵"] }, painting = tint.spot;
    const rows = [painting ? { key: "tint-back", icon: "‹", name: "Back", hint: "The paint stays as it was", local: function () { tint = null; picks[tab] = 1; } }
      : { key: "tint-back", icon: "‹", name: "Back to Settings", hint: "Her colour stays as it was", local: function () { tint = null; picks[tab] = 1; } }];
    ["r", "g", "b"].forEach(function (part) {
      rows.push({ key: "tint-" + part, icon: names[part][1], name: names[part][0] + " " + tint[part], hint: "◀ ▶ less or more · Enter jumps up a step · or slide it below",
        turn: function (by) { nudge(part, by * 8); }, local: function () { tint[part] = (tint[part] + 32) % 288 > 255 ? 0 : tint[part] + 32; } });
    });
    if (painting) { rows.push({ key: "tint-save", icon: "🎨", name: "Paint it " + tintHex().toUpperCase(), hint: "Free · paint over it any time", send: { action: "paint", spot: painting, colour: tintHex() } }); return rows; }
    rows.push({ key: "tint-save", icon: "✓", name: "Keep " + tintHex().toUpperCase(), hint: "Her very own colour, everywhere she goes", send: { action: "colour", colour: tintHex() } });
    if (snap.pet.colour) rows.push({ key: "tint-glow", icon: "✦", name: "Her glow's own colours", hint: "Back to " + snap.pet.glow + "'s colours (her element stays the same)", send: { action: "colour", colour: "" } });
    return rows;
  }

  function drawTint() { // Her colours in the room (and on her), and the sliders while the drawer is open.
    const panel = $("lp-tint"), look = tint && !tint.spot ? R.tint(tintHex()) : snap.pet.colour ? R.tint(snap.pet.colour) : null; // (painting a wall leaves her as she is)
    ["glow", "body", "shadow"].forEach(function (part) { if (look) room.style.setProperty("--pet-" + part, look[part]); else room.style.removeProperty("--pet-" + part); });
    panel.hidden = !tint;
    if (!tint) return;
    panel.querySelectorAll("[data-tint]").forEach(function (slider) { const part = slider.dataset.tint; if (Number(slider.value) !== tint[part]) slider.value = String(tint[part]); });
    panel.querySelectorAll("[data-tint-n]").forEach(function (number) { number.textContent = String(tint[number.dataset.tintN]); });
  }

  $("lp-tint").addEventListener("input", function (event) { // A slider dragged with a finger or the mouse.
    const part = event.target.dataset.tint;
    if (!tint || !part) return;
    tint[part] = Number(event.target.value); lastList = ""; render();
  });

  function battleRows() { // The Battle tab's lists (battle-ui.js); also used by the Dungeon tab while a fight is on.
    return Bt.rows({ snap: snap, view: battleView, finished: finished, now: serverNow(), countdown: R.countdown,
      go: function (view, pick, clear) { battleView = view; picks[tab] = pick || 0; if (clear) finished = null; } });
  }

  function exploring() { const run = snap.dungeon.run; return run && !run.over ? run : null; } // The trip in progress, if any.
  function trip() { return has("dungeon") ? exploring() : null; } // ...as far as this page shows it: only Lumi Dungeons draws and plays a trip. The other two apps say she is away (awayRows).

  function syncPlay() { // Keep the page's copy of a puzzle in step with where Lumi is: start one at a door, drop it on leaving.
    if (TOWN) return; // No puzzles in town, and its first draw mustn't move the cursor off the place she arrived at.
    const run = trip(), lock = run && run.facing ? run.facing.lock : null, cards = run && !run.facing && run.game && run.game.kind === "match" && !run.room.done;
    const turn = run && run.party && run.party.puzzle ? ":" + run.party.puzzle.phase + run.party.puzzle.turn + ":" + run.party.puzzle.holder : ""; // A party's new turn starts the board afresh.
    const id = (!run ? "" : lock ? run.id + ":" + run.facing.at + ":" + lock.kind + (lock.tries ? lock.tries.length : "") : cards ? run.id + ":" + run.at + ":match" : "") + turn;
    if (play.id === id) { if (watching()) play.board = partyBoard(lock, play.board); return; } // Someone else's turn (or the couch): show their moves as they make them.
    if (lock && lock.kind === "sokoban") { play = { id: id, board: Dg.sokobanStart(lock.rows) }; focus = "board"; }
    else if (lock && lock.kind === "lights") { play = { id: id, board: Dg.lightsStart(lock) }; focus = "board"; }
    else if (lock && lock.kind === "runes") { play = { id: id, guess: [] }; focus = "list"; }
    else if (cards) { play = { id: id, cursor: play.cursor || 0 }; focus = "board"; }
    else { play = { id: id }; focus = "list"; }
    if (run && run.party && lock && (lock.kind === "sokoban" || lock.kind === "lights")) play.board = partyBoard(lock, play.board); // A turn picked up halfway (a reload) carries on from the server's moves.
    picks[tab] = 0;
  }

  function dungeonGo(change) { // What a dungeon row that doesn't ask the server can do: move between board and list, edit a puzzle.
    const lock = exploring() && exploring().facing ? exploring().facing.lock : null;
    if (change.focus) focus = change.focus;
    if (change.dismiss) { dismissedRun = change.dismiss; G.store.set("read-run", change.dismiss); picks[tab] = 0; }
    if ("care" in change) { caring = change.care; picks[tab] = 0; focus = "list"; } // The snack-and-potion list, or back to the room's own.
    if (change.undo) play.board = Dg.sokobanUndo(play.board);
    if (change.reset && lock) play.board = lock.kind === "sokoban" ? Dg.sokobanStart(lock.rows) : Dg.lightsStart(lock);
    if ((change.undo || change.reset) && inParty() && lock) partyProgress(lock.kind === "sokoban" ? { action: "sokoban", moves: play.board.moves } : { action: "lights", picks: play.board.presses });
    if (change.rune && play.guess.length < lock.slots) play.guess = play.guess.concat([change.rune]);
    if (change.erase) play.guess = play.guess.slice(0, -1);
    lastDungeon = "";
  }

  function boardKey(action) { // An arrow or Enter on a puzzle board or the cards.
    const run = exploring(), lock = run.facing ? run.facing.lock : null;
    if (lock && lock.kind === "sokoban") { // Arrows push; Enter takes the last step back.
      play.board = action === "enter" ? Dg.sokobanUndo(play.board) : Dg.sokobanMove(play.board, { up: "u", down: "d", left: "l", right: "r" }[action]);
      if (inParty()) { partyProgress({ action: "sokoban", moves: play.board.moves }); return; } // The others watch each step; the server opens the door once it's solved.
      if (Dg.sokobanSolved(play.board)) submit({ key: "solved", url: "dungeon/act", send: { action: "sokoban", moves: play.board.moves } });
      return;
    }
    const board = lock ? play.board : null, count = lock ? board.size * board.size : run.game.cards.length, width = lock ? board.size : 4;
    const at = lock ? board.cursor : play.cursor;
    if (action === "enter") { // Press the lamp, or turn the card, under the cursor.
      if (lock) {
        play.board = Object.assign(Dg.lightsPress(board, at), { cursor: at });
        if (inParty()) { partyProgress({ action: "lights", picks: play.board.presses }); return; }
        if (Dg.lightsSolved(play.board)) submit({ key: "solved", url: "dungeon/act", send: { action: "lights", picks: play.board.presses } });
      } else submit({ key: "flip", url: "dungeon/act", send: { action: "flip", picks: [at] } });
      return;
    }
    const to = Dg.cursorMove(at, { up: "n", down: "s", left: "w", right: "e" }[action], width, count);
    if (to === null) return; // The edge of the board.
    if (lock) play.board = Object.assign({}, board, { cursor: to }); else play.cursor = to;
  }

  // ---- The Stardust Garden (mnemerynne/lumigarden.py; rows and words in garden-ui.js, drawing in garden-art.js).
  // Its tab works like a dungeon trip: the garden is drawn over the room and the right panel is the garden's own.
  // Arrows move over the plots, Enter plants or trims, Play/Pause presses the powder, Prev/Next move through the list.
  // ---- The Skills tab (rules in mnemerynne/lumibattle.py; layout and words in skills-ui.js, drawing in skills-art.js).
  // All six class trees on one page, drawn over the room. Like the garden: the arrows move over the skills, Enter
  // learns one (or carries or puts away a move), and Prev/Next move through the list beside it.
  function treeing() { return TABS[tab] === "skills" && !trip(); }

  function skillEnter() { // Enter, or a second press of the mouse, on the skill under the cursor.
    const what = Sk.choice(snap, skillCursor);
    if (what.say) { say(what.say); return; }
    submit({ key: "act", name: what.name, label: what.name, send: what.send });
  }

  function skillsGo(change) { if (change.leave) goHome(); }

  function skillsKey(action) { // The keyboard and remote on the skill tree.
    const moving = action === "up" || action === "down" || action === "left" || action === "right";
    if (moving) { skillCursor = Sk.move(snap.battle, skillCursor, action); skillFocus = "board"; picks[tab] = 0; }
    else if (action === "next" || action === "prev") { const many = rows().length; picks[tab] = (picks[tab] + (action === "prev" ? many - 1 : 1)) % many; skillFocus = "list"; }
    else if (action === "enter") { if (skillFocus === "board") skillEnter(); else choose(); return; }
    render();
  }

  function skillClick(name) { // A press on a skill: the first press looks at it, a second press on the same one acts.
    const id = name.split(":")[1];
    if (name.indexOf("skill:") !== 0 || busy) return;
    if (id === skillCursor && skillFocus === "board") skillEnter(); else { skillCursor = id; skillFocus = "board"; picks[tab] = 0; }
    render();
  }

  function drawSkills() { // The skill trees over the room while their tab is open.
    const on = Boolean(snap && treeing());
    room.dataset.skills = String(on);
    if (!on) { lastSkills = ""; return; }
    if (!skillCursor || !Sk.find(snap.battle, skillCursor)) skillCursor = snap.battle.trees[0].nodes[0].id;
    $("gm").dataset.walking = "true"; $("lp-keys").innerHTML = KEYS_SKILLS; // Fixed text from this file.
    $("lp-dungeon").style.display = "";
    const lines = Sk.lines(snap, skillCursor), told = "skills|" + lines.join("|");
    if (told !== lastStory) {
      lastStory = told;
      const story = $("lp-story"); story.textContent = "";
      lines.forEach(function (words, index) { const line = document.createElement("p"); line.textContent = words; if (index === 1) line.className = "lp-scene"; story.appendChild(line); });
    }
    const signature = JSON.stringify([snap.pet.skills, snap.pet.moves, snap.progress.points, skillCursor, skillFocus]);
    if (signature === lastSkills) return;
    lastSkills = signature; lastDungeon = ""; lastGarden = ""; lastAlbum = "";
    $("lp-dungeon").innerHTML = Sa.scene(snap, { cursor: skillCursor, focused: skillFocus === "board" }); // Markup authored in skills-art.js; names are drawn as text by the list, not here.
  }

  // ---- The Collection tab (shelves and words in collection-ui.js, drawing in collection-art.js): a gallery of
  // everything there is to collect, drawn over the room like the skill trees. The arrows move over the pictures
  // (off an edge turns the page), Enter looks at one large, and Prev/Next move through the list beside it.
  function albuming() { return TABS[tab] === "collection" && !trip(); }

  function albumGo(change) { // What a row of the album's list (or a press on the page) can do.
    if (change.leave) { goHome(); return; }
    if (change.shelf) { album = { shelf: change.shelf, page: 0, cursor: 0 }; albumZoom = false; }
    if ("page" in change) { album.page = change.page; album.cursor = 0; albumZoom = false; }
    if ("zoom" in change) albumZoom = change.zoom;
  }

  function albumKey(action) { // The keyboard and remote in the gallery.
    const moving = action === "up" || action === "down" || action === "left" || action === "right";
    if (moving) { const to = Cl.move(Cl.view(snap, album), action); album.page = to.page; album.cursor = to.cursor; albumFocus = "board"; }
    else if (action === "next" || action === "prev") { const many = rows().length; picks[tab] = (picks[tab] + (action === "prev" ? many - 1 : 1)) % many; albumFocus = "list"; }
    else if (action === "enter") { if (albumFocus === "board") albumZoom = !albumZoom; else { choose(); return; } }
    render();
  }

  function albumClick(name) { // A press on the gallery: a shelf, a page arrow, or a picture (a second press looks at it large).
    const what = name.split(":"), seen = Cl.view(snap, album);
    if (what[0] === "shelf") albumGo({ shelf: what[1] });
    else if (what[0] === "page") { const to = seen.page + Number(what[1]); if (to >= 0 && to < seen.pages) albumGo({ page: to }); }
    else if (what[0] === "zoom") albumZoom = false;
    else if (what[0] === "cell") { const at = Number(what[1]); if (at === seen.cursor && albumFocus === "board") albumZoom = true; else { album.cursor = at; albumFocus = "board"; } }
    render();
  }

  function fitThumbs() { // Each little picture is drawn wherever its own file puts it; frame it round what was actually drawn.
    $("lp-dungeon").querySelectorAll("svg[data-thumb]").forEach(function (frame) {
      let box = null;
      try { box = frame.firstChild.getBBox(); } catch (_) { /* not on screen yet: the wide frame it was given will do */ }
      if (!box || !box.width || !box.height) return;
      const side = Math.max(box.width, box.height) * 1.08;
      frame.setAttribute("viewBox", (box.x + box.width / 2 - side / 2) + " " + (box.y + box.height / 2 - side / 2) + " " + side + " " + side);
    });
  }

  function drawAlbum() { // The gallery over the room while its tab is open.
    const on = Boolean(snap && albuming());
    room.dataset.album = String(on);
    if (!on) { lastAlbum = ""; return; }
    const seen = Cl.view(snap, album);
    album = { shelf: seen.shelf.id, page: seen.page, cursor: seen.cursor }; // Kept within what there is.
    $("gm").dataset.walking = "true"; $("lp-keys").innerHTML = KEYS_ALBUM; // Fixed text from this file.
    $("lp-dungeon").style.display = "";
    const lines = Cl.lines(seen), told = "album|" + lines.join("|");
    if (told !== lastStory) {
      lastStory = told;
      const story = $("lp-story"); story.textContent = "";
      lines.forEach(function (words, index) { const line = document.createElement("p"); line.textContent = words; if (index === 2) line.className = "lp-scene"; story.appendChild(line); });
    }
    const signature = JSON.stringify([album, albumZoom, albumFocus, seen.cells.map(function (item) { return item.id + (item.owned ? item.count || 1 : 0); })]);
    if (signature === lastAlbum) return;
    lastAlbum = signature; lastDungeon = ""; lastGarden = ""; lastSkills = "";
    $("lp-dungeon").innerHTML = Ca.scene(snap, { shelf: album.shelf, page: album.page, cursor: album.cursor, zoom: albumZoom, focused: albumFocus === "board" }); // Markup authored in collection-art.js and the art files it borrows from.
    fitThumbs();
  }

  function gardening() { return TABS[tab] === "garden" && !exploring(); }
  function passed() { return serverNow() - snap.now; } // How long ago the server told us its times.

  function lumiTo(spot, act) { // Lumi darts to a place in the garden (a plot, the press) and does a little something there.
    room.style.setProperty("--gx", String(Math.round(spot.x - 500))); room.style.setProperty("--gy", String(Math.round(spot.y)));
    lumiMoved = Date.now();
    if (!act) return;
    lumiFlip = !lumiFlip; // The same little move twice in a row still plays twice (game.css has each under two names).
    room.dataset.gardenAct = act + (lumiFlip ? "" : "-again"); lumiActUntil = Date.now() + 800;
    $("lp-effect").textContent = { dig: "❀", snip: "✂", bounce: "✦", sniff: "♡", cheer: "✧ ✦ ✧" }[act] || "♡"; effectUntil = Date.now() + 1200;
  }

  function lumiCheers(send, note) { // What Lumi does when the server answers a garden choice.
    if (send.action === "dig") lumiTo(Ga.spot(send.plot), "dig"); // Digging a flower up looks like planting one.
    else if (send.action === "plant" || send.action === "plot") lumiTo(Ga.spot(send.action === "plot" ? snap.garden.plots.length - 1 : send.plot), "dig");
    else if (send.action === "trim") lumiTo(Ga.spot(send.plot), note && note.gift ? "cheer" : "snip");
    else if (["trim_all", "capsule", "helper", "ability", "unlock", "moonrise", "decor_buy", "decor_place"].indexOf(send.action) >= 0 || (note && (note.water === "done" || note.feed === "done"))) lumiTo(Ga.spot(plotCursor), "cheer");
  }

  function lumiWanders() { // Left alone for a while, she trots to a flower and has a sniff: a ready one if there is one.
    if (mini || Date.now() - lumiMoved < 6000) return;
    const gone = passed(), planted = [], ready = [];
    snap.garden.plots.forEach(function (plot, index) { if (plot.flower) { planted.push(index); if (Gd.stage(plot, gone) !== "growing") ready.push(index); } });
    const among = ready.length ? ready : planted;
    if (among.length) lumiTo(Ga.spot(among[Math.floor(Math.random() * among.length)]), "sniff"); else lumiMoved = Date.now();
  }

  function pressOnce() { // One squeeze of the press: counted here, sent to the server in a batch a moment later.
    pending += 1;
    lumiTo(Ga.PRESS, "bounce"); // She runs to the machine and jumps on it with every press.
    G.sound.unlock(); G.sound.tone(480 + (pending % 6) * 36, .05, 0, .05);
  }

  function flushPresses() { // Send the presses counted so far. The server decides how many it believes and what they made.
    if (busy || !pending || !snap) return;
    const count = pending;
    pending = 0; busy = true;
    G.api(API + "garden", { action: "press", count: count }).then(function (data) {
      take(data);
      const words = Gd.said({ action: "press" }, data.said, data.garden);
      if (words) { say(words); G.sound.tone(880, .12, 0, .06); }
    }).catch(function (refused) { say(refused.message); }).then(function () { busy = false; render(); });
  }

  function gardenSend(send) { // One garden choice. Presses still waiting go first, so the server sees things in order.
    if (busy) return;
    const count = pending;
    pending = 0; busy = true; pendingConfirm = null;
    (count ? G.api(API + "garden", { action: "press", count: count }) : Promise.resolve()).then(function () {
      return G.api(API + "garden", send);
    }).then(function (data) {
      take(data); lastList = "";
      const words = Gd.said(send, data.said, data.garden, function (id) { return item(id).name; }, data.garden_decor);
      if (words) say(words);
      lumiCheers(send, data.said);
    }).catch(function (refused) {
      say(refused.message);
      if (mini && mini.kind === "water") mini.answer = []; // The answer never arrived: let it be given again.
    }).then(function () { busy = false; render(); });
  }

  function paging() { return gardening() && GT.isPage(drawer) && !mini; } // One of the garden's pages is open (a minigame takes the screen back).

  function pageCtx() { return { garden: snap.garden, cursor: pageAt(), seed: Gd.seedFor(snap.garden, null, seed), level: snap.pet.level, go: gardenGo }; }

  function pageAt() { // The open page's cursor, put somewhere sensible if it isn't on anything.
    if (!GT.find(drawer, snap.garden, pageCursor[drawer])) pageCursor[drawer] = GT.first(drawer, snap.garden, Gd.seedFor(snap.garden, null, seed));
    return pageCursor[drawer];
  }

  function pageEnter() { // Enter, or a second press of the mouse, on what a page's cursor is on.
    const what = GT.choice(drawer, pageCtx(), pageAt()), key = "page:" + drawer + ":" + pageAt();
    if (what.say) { say(what.say); return; }
    if (what.change) { gardenGo(what.change); return; }
    if (busy) return;
    if (what.confirm && pendingConfirm !== key) { pendingConfirm = key; say(what.confirm); return; } // A moonrise replants the garden: never on one stray press.
    gardenSend(what.send);
  }

  function gardenGo(change) { // What a garden row that doesn't ask the server can do.
    if ("drawer" in change) { drawer = change.drawer; picks[tab] = 0; gardenFocus = GT.isPage(drawer) ? "board" : "list"; pendingConfirm = null; } // A page opens with the arrows on it, like Skills.
    if (change.seed) { seed = change.seed; say("Seed chosen. Enter on an empty plot plants it."); }
    if (change.press) pressOnce();
    if (change.feed) feedPress();
    if (change.leave) goHome();
  }

  function plotEnter(index) { // Enter, or a press of the mouse, on a plot: plant, trim, dig, or say how long is left.
    const choice = Gd.plotChoice(snap.garden, index, seed, passed());
    if (choice.say) { say(choice.say); lumiTo(Ga.spot(index), "sniff"); return; }
    if (choice.confirm && pendingConfirm !== "plot") { pendingConfirm = "plot"; say(choice.confirm + " Press again to dig."); return; }
    gardenSend(choice.send);
  }

  function syncMini() { // Keep the page's minigame in step with what the server says is going on.
    const garden = snap.garden, show = gardening() ? garden.water.show : null, feeding = gardening() && garden.feed.until_in !== null && garden.feed.until_in - passed() > -4000;
    if (show) { if (!mini || mini.kind !== "water" || mini.show.length !== show.length) mini = { kind: "water", show: show, phase: "show", started: Date.now(), answer: [], lit: -1, flash: 0, heard: -1 }; }
    else if (feeding) { if (!mini || mini.kind !== "feed") mini = { kind: "feed", until: Date.now() + garden.feed.until_in - passed(), whole: garden.feed.seconds * 1000, left: garden.feed.until_in, count: 0, sent: false }; }
    else mini = null;
    if (mini && !miniTimer) miniTimer = setInterval(stepMini, 100);
    if (!mini && miniTimer) { clearInterval(miniTimer); miniTimer = null; }
  }

  function stepMini() { // Ten times a second while a minigame is on: light the next can, or run the fertilizer's clock down.
    if (!mini || !snap) return;
    if (mini.kind === "water" && mini.phase === "show") {
      const since = Date.now() - mini.started - 500, at = Math.floor(since / 650);
      if (since >= 0 && at >= mini.show.length) { mini.phase = "answer"; mini.lit = -1; lastList = ""; }
      else {
        mini.lit = since >= 0 && since % 650 < 470 ? mini.show[at] : -1;
        if (mini.lit >= 0 && mini.heard !== at) { mini.heard = at; G.sound.tone(CAN_NOTES[mini.lit], .2, 0, .07); }
      }
    } else if (mini.kind === "water") {
      if (mini.flash && Date.now() > mini.flash) { mini.lit = -1; mini.flash = 0; }
    } else {
      mini.left = mini.until - Date.now();
      if (mini.left <= 0 && !mini.sent && !busy) { mini.sent = true; gardenSend({ action: "feed_end", count: mini.count }); }
    }
    render();
  }

  function canPress(can) { // One can of the answer; the last one sends the whole answer.
    if (!mini || mini.kind !== "water" || mini.phase !== "answer" || busy || mini.answer.length >= mini.show.length) return;
    mini.answer.push(can); mini.lit = can; mini.flash = Date.now() + 220;
    G.sound.unlock(); G.sound.tone(CAN_NOTES[can], .14, 0, .07);
    if (mini.answer.length === mini.show.length) gardenSend({ action: "water_answer", picks: mini.answer.slice() });
  }

  function feedPress() { // One press of fertilizer, while the clock is running.
    if (!mini || mini.kind !== "feed" || mini.left <= 0) return;
    mini.count += 1;
    G.sound.unlock(); G.sound.tone(392 + (mini.count % 8) * 30, .04, 0, .05);
  }

  function gardenKey(action) { // The keyboard and remote in the garden.
    if (mini) { // A minigame has the keys: the arrows are the four cans, and Enter or Play feed.
      if (mini.kind === "water") { const can = ["up", "right", "down", "left"].indexOf(action); if (can >= 0) canPress(can); }
      else if (action === "enter" || action === "play") feedPress();
      render(); return;
    }
    const count = Gd.cells(snap.garden), moving = action === "up" || action === "down" || action === "left" || action === "right";
    if (paging()) { // A page: the arrows move over it, Enter acts on what they are on (or on the list), Prev/Next walk the list.
      if (moving) { pageCursor[drawer] = GT.move(drawer, snap.garden, pageAt(), action); gardenFocus = "board"; picks[tab] = 0; pendingConfirm = null; }
      else if (action === "next" || action === "prev") { const many = rows().length; picks[tab] = (picks[tab] + (action === "prev" ? many - 1 : 1)) % many; gardenFocus = "list"; }
      else if (action === "enter") { if (gardenFocus === "board") pageEnter(); else choose(); render(); return; }
      else if (action === "play") pressOnce();
      render(); return;
    }
    if (action === "play") pressOnce();
    else if (action === "enter") { if (gardenFocus === "board" && !drawer) plotEnter(plotCursor); else choose(); return; }
    else if (action === "next" || action === "prev" || (drawer && (action === "up" || action === "down"))) { // The list (a drawer has no plots to walk over).
      const many = rows().length, back = action === "prev" || action === "up";
      picks[tab] = (picks[tab] + (back ? many - 1 : 1)) % many; gardenFocus = "list";
    } else if (moving && !drawer) { plotCursor = Gd.moveCursor(Math.min(plotCursor, count - 1), action, count); gardenFocus = "board"; lumiTo(Ga.spot(plotCursor)); } // She follows the cursor.
    render();
  }

  function gardenClick(name) { // A press of the mouse or a finger on the garden (garden-art.js names each shape).
    const what = name.split(":"), n = Number(what[1]);
    if (what[0] === "press") pressOnce();
    else if (what[0] === "can") canPress(n);
    else if (what[0] === "feed") feedPress();
    else if (what[0] === "plot" && !mini) { plotCursor = n; gardenFocus = "board"; plotEnter(n); }
    else if (what[0] === "tree" && paging()) { // A page: the first press looks, a second press on the same thing acts.
      if (what[1] === pageAt() && gardenFocus === "board") pageEnter(); else { pageCursor[drawer] = what[1]; gardenFocus = "board"; picks[tab] = 0; pendingConfirm = null; }
    }
    render();
  }

  function drawGarden() { // The garden over the room while its tab is open: the plots, the press, and the lines about them.
    const on = Boolean(snap && gardening());
    room.dataset.garden = String(on);
    if (!on) { lastGarden = ""; gardenOpen = false; delete room.dataset.gardenAct; if (mini) syncMini(); return; }
    if (!gardenOpen) { // Just walked in: say what the press did meanwhile, and tell the server she has seen her flowers.
      gardenOpen = true; drawer = null; gardenFocus = "list";
      lumiTo(Ga.spot(Math.min(plotCursor, snap.garden.plots.length - 1)));
      say(Gd.away(snap.garden) || "The Stardust Garden. Plant flowers, trim them when they're ready, and press their powder into SGC.");
      gardenSend({ action: "look" });
    }
    syncMini();
    const garden = snap.garden, gone = passed(), count = Gd.cells(garden);
    plotCursor = Math.min(plotCursor, count - 1);
    $("gm").dataset.walking = "true"; $("lp-keys").innerHTML = KEYS_GARDEN; // Fixed text from this file.
    $("lp-dungeon").style.display = ""; $("lp-dhud").hidden = false;
    $("lp-d-title").textContent = "Stardust Garden" + (garden.gardens > 1 ? " " + (garden.at + 1) + " of " + garden.gardens : "");
    $("lp-d-hp").style.width = Math.min(100, 100 * garden.squeezed / garden.price) + "%"; $("lp-d-mp").style.width = "0%"; // The bar is the next coin.
    $("lp-d-label").textContent = Gd.format(Math.max(0, garden.powder - pending * garden.rates.tap)) + " starpowder · " + garden.coins_today + " press coins today"; // LumiBot: press coins (the garden turns them into SGC through its carry)
    room.dataset.gardenPage = paging() ? drawer : ""; // Lumi steps off the screen while a page is up (game.css).
    if (paging()) { drawPage(garden); return; }
    const lines = Gd.status(garden, plotCursor, seed, gone, pending), told = "garden|" + lines.join("|");
    if (told !== lastStory) {
      lastStory = told;
      const story = $("lp-story"); story.textContent = "";
      lines.forEach(function (words, index) { const line = document.createElement("p"); line.textContent = words; if (!index) line.className = "lp-scene"; story.appendChild(line); });
    }
    const steps = garden.plots.map(function (plot) { return Gd.stage(plot, gone) + (plot.grow ? Math.floor(10 * Math.max(0, 1 - (plot.ready_in - gone) / plot.grow)) : ""); }); // Redraw only when a flower visibly changes.
    const playing = !mini ? null : mini.kind === "water" ? [mini.phase, mini.lit, mini.answer.length, mini.show.length] : [mini.count, Math.ceil(mini.left / 250)];
    const scenery = document.querySelector(".parallax"), sky = Boolean(scenery) && getComputedStyle(scenery).display !== "none"; // The theme's drifting scenery is the garden's sky, where there is some.
    if (lumiActUntil && Date.now() > lumiActUntil) { delete room.dataset.gardenAct; lumiActUntil = 0; }
    const signature = JSON.stringify([garden.at, steps, garden.plot_price, garden.decor.placed, Math.round(garden.squeezed), garden.price, garden.powder > 0.5, plotCursor, gardenFocus, drawer, playing, sky]);
    if (signature === lastGarden) { // Nothing to redraw: just let every flower's timer tick, where it stands.
      Ga.timers(garden, gone).forEach(function (timer) { const words = $("lp-dungeon").querySelector('[data-timer="' + timer[0] + '"]'); if (words && words.textContent !== timer[1]) words.textContent = timer[1]; });
      return;
    }
    lastGarden = signature; lastDungeon = "";
    $("lp-dungeon").innerHTML = Ga.scene(garden, { cursor: plotCursor, focused: gardenFocus === "board" && !drawer, passed: gone, mini: mini, decor: snap.garden_decor, sky: sky }); // Markup authored in garden-art.js; colours are the server's checked #rrggbb.
  }

  function drawPage(garden) { // The Flower tree, Helpers or Moonrise page over the garden, and the lines about what the cursor is on.
    $("lp-keys").innerHTML = KEYS_GARDEN_PAGE; // Fixed text from this file.
    const at = pageAt(), lines = GT.lines(drawer, pageCtx(), at), told = "gpage|" + lines.join("|");
    if (told !== lastStory) {
      lastStory = told;
      const story = $("lp-story"); story.textContent = "";
      lines.forEach(function (words, index) { const line = document.createElement("p"); line.textContent = words; if (index === 1) line.className = "lp-scene"; story.appendChild(line); });
    }
    const signature = JSON.stringify(["page", drawer, at, gardenFocus, pageCtx().seed, snap.pet.level, garden.flowers.map(function (f) { return f.unlocked ? 1 : f.next ? (garden.given >= f.needs ? 3 : 2) : 0; }).join(""),
      Math.floor(garden.powder), garden.helpers.map(function (h) { return h.level; }), garden.upgrades.map(function (u) { return u.count; }), garden.moonrise, garden.given, garden.gardens]);
    if (signature === lastGarden) return;
    lastGarden = signature; lastDungeon = "";
    $("lp-dungeon").innerHTML = GTa.scene(drawer, garden, { cursor: at, focused: gardenFocus === "board", seed: pageCtx().seed, level: snap.pet.level }); // Markup authored in garden-tree-art.js; text escaped there, colours the server's checked #rrggbb.
  }

  function walking() { // In the dungeon with the Dungeon tab open and no fight on: the arrows are Lumi's feet.
    return TABS[tab] === "dungeon" && exploring() && !(snap.fight && snap.fight.status === "active") && !finished && !teamFight();
  }

  function teamFight() { return party && party.run && party.run.party.fight ? party.run.party.fight : null; } // The party's co-op fight going on, if any.

  function fightCtx(aimAt, allyOf) { // What the co-op fight's rows need (party-ui.js teamRows).
    return { aim: aimAt, ally: allyOf, now: serverNow(), describe: Bt.describeMove, items: snap.battle.rules.kit };
  }

  function walk(action) { // One arrow, one room: up is north.
    const way = { up: "n", right: "e", down: "s", left: "w" }[action], run = exploring();
    caring = false; // Walking on puts the snacks away.
    if (run.room.exits.indexOf(way) < 0) { say("There's no way " + Dg.WAYS[way][0] + " from here."); return; }
    submit({ key: "go-" + way, url: "dungeon/act", send: { action: "move", way: way } });
  }

  function drinkPotion() { // The Play/Pause button: a potion, in a fight or between rooms.
    if (!has("battle")) return; // Only where the fights are.
    const team = teamFight();
    if (team) { // The co-op fight: a potion for herself, on her turn.
      if (team.you !== null && team.at === team.you) partyAct({ action: "fight", target: "potion", ally: team.you, turn: team.turn });
      return;
    }
    const fight = snap.fight && snap.fight.status === "active" ? snap.fight : null;
    if (fight) submit({ key: "potion", url: "battle/act", send: { battle: fight.id, turn: fight.turn, action: "potion" } });
    else if (exploring()) submit({ key: "potion", url: "dungeon/act", send: { action: "potion" } });
  }

  function drawDungeon() { // The dungeon scene over the house while she is out, and its line of health and satchel.
    const run = trip(), art = $("lp-dungeon"), bar = $("lp-dhud");
    room.dataset.dungeon = String(Boolean(run));
    room.dataset.away = String(Boolean(snap) && awayRows().length > 0 && !gardening()); // In the other two apps her room is empty while she is out (game.css).
    if (!run) caring = false;
    $("gm").dataset.walking = String(Boolean(run)); // The dungeon's own, taller right panel, with the tabs folded away for the whole trip (game.css). The garden does the same (drawGarden).
    $("lp-keys").innerHTML = snap && walking() ? KEYS_DUNGEON : TOWN ? KEYS_TOWN : KEYS_HOME; // Fixed text from this file.
    const here = TABS[tab] === "dungeon"; // A puzzle's panel covers the room (and Lumi) only while this tab can play it.
    room.dataset.puzzle = String(Boolean(here && run && (run.facing || (run.game && run.game.kind === "match" && !run.room.done))));
    art.style.display = run ? "" : "none"; bar.hidden = !run;
    const told = run ? JSON.stringify([run.id, run.scene, run.story]) : "";
    if (told !== lastStory && !(snap && (gardening() || treeing() || albuming()))) { // The story panel: what this room is like, then the tale so far (its newest line is the message under it).
      lastStory = told;
      const story = $("lp-story"); story.textContent = "";
      (run ? [run.scene].concat((run.story || []).slice(0, -1)) : []).forEach(function (words, index) {
        if (!words) return;
        const line = document.createElement("p"); line.textContent = words; if (!index) line.className = "lp-scene"; // Text only, never markup.
        story.appendChild(line);
      });
      story.scrollTop = story.scrollHeight;
    }
    if (!run) { lastDungeon = ""; return; }
    const hud = Dg.hud(run), signature = JSON.stringify([run.at, run.depth, run.rooms, run.facing, run.game, run.room, play, focus, run.satchel.keys, here]);
    $("lp-d-title").textContent = hud.title; $("lp-d-label").textContent = hud.label;
    $("lp-d-hp").style.width = hud.hp + "%"; $("lp-d-mp").style.width = hud.mp + "%";
    if (signature === lastDungeon) return;
    lastDungeon = signature;
    art.innerHTML = Da.scene(run, play, focus, here); // Markup authored in dungeon-art.js; colours are the server's checked #rrggbb.
  }

  function tellLive(moment) { // Live storyteller: the library's line is already showing; swap in a fresh one if it comes.
    if (snap.pet.storyteller !== "live" || !exploring() || exploring().party) return; // A party trip tells its story from the library.
    G.api(API + "dungeon/tale", {}).then(function (data) {
      const run = snap.dungeon.run;
      if (data.line && run && JSON.stringify(run.event) === moment) { run.say = data.line; say(data.line); }
    }).catch(function () { /* the library line stays */ });
  }

  function drawHouse(preview) { // Draw the room: what the server says is placed, with the highlighted object tried on.
    if (TOWN) { drawTown(); return; } // Lumi Town draws the map, or the place she's in.
    if (roomOn()) { drawRoom(preview); return; } // Room mode: the kitchen, her bedroom or the den.
    if (APP === "lumi-dungeons") { // Lumi Dungeons' lobby is the Lantern & Paw tavern (tavern-art.js), not her apartment (Doll's request, 2026-11-11).
      const night = sceneNow().night, signature = "tavern:" + night;
      if (signature === lastHouse) return; // Only redrawn when day turns to night or back.
      lastHouse = signature;
      room.dataset.open = "false"; // No windows onto the page's scenery here: the tavern paints its own.
      houseArt.innerHTML = Ta.scene({ night: night }); // Markup authored in tavern-art.js; nothing a person typed goes into it.
      return;
    }
    const house = Object.assign({}, snap.pet.house);
    if (preview) house[preview[0]] = preview[1];
    if (tint && tint.spot) house[tint.spot] = tintHex(); // Painting her wall or floor: the colour as it moves (other rooms' show in room mode).
    const scenery = document.querySelector(".parallax"), backdrop = Boolean(scenery) && getComputedStyle(scenery).display !== "none"; // The neon theme's drifting cities.
    const boxes = snap.boxes ? snap.boxes.left : 0, signature = JSON.stringify(house) + backdrop + boxes;
    if (signature === lastHouse) return; // Redrawing would restart the window's scrolling, so only when it changed.
    lastHouse = signature;
    room.dataset.open = String(backdrop && house.view === "view-city"); // The windows are open onto the page's own scenery.
    houseArt.innerHTML = H.render(house, backdrop, { boxes: boxes }); // Markup authored in house.js; nothing a person typed goes into it.
  }

  function drawOutfit(preview) { // Dress her: what the server says she wears, with the highlighted accessory tried on.
    const outfit = Object.assign({}, snap.pet.outfit);
    if (preview && preview[1]) outfit[preview[0]] = preview[1]; else if (preview) delete outfit[preview[0]]; // "Nothing" tries it off.
    const signature = JSON.stringify(outfit);
    if (signature === lastOutfit) return;
    lastOutfit = signature;
    $("lp-acc-back").innerHTML = W.render(outfit, "back"); // Markup authored in closet.js.
    $("lp-acc-front").innerHTML = W.render(outfit, "front");
  }

  function drawFight() { // The fight scene over the room: the enemy, and both sides' bars. Shown for a fight in progress or just ended.
    const team = TABS[tab] === "dungeon" ? teamFight() : null;
    room.dataset.team = String(Boolean(team)); // A co-op fight: every Lumi in one row (game.css).
    $("lp-team").hidden = !team;
    $("lp-fight").classList.toggle("lp-fight-team", Boolean(team));
    if (team) { drawTeam(team); return; }
    lastTeam = "";
    const fight = has("battle") ? snap.fight || finished : null; // Fights are Lumi Dungeons' to show.
    room.dataset.fight = String(Boolean(fight));
    $("lp-fight").hidden = !fight;
    if (!fight) { lastFoe = ""; return; }
    const foe = fight.enemy, bars = Bt.bars(fight), signature = foe.id + foe.colour;
    if (signature !== lastFoe) { lastFoe = signature; $("lp-foe").innerHTML = E.draw(foe.body, foe.colour); } // Art authored in enemies.js.
    $("lp-foe").dataset.down = String(foe.hp <= 0);
    $("lp-f-lumi").textContent = bars.lumi.label; $("lp-f-foe").textContent = bars.foe.label;
    $("lp-f-hp").style.width = bars.lumi.hp + "%"; $("lp-f-mp").style.width = bars.lumi.mp + "%"; $("lp-f-foehp").style.width = bars.foe.hp + "%";
  }

  function drawTeam(fight) { // The party's co-op fight: every Lumi's bars down the left, the creatures on the right (enemies.js).
    room.dataset.fight = "true";
    $("lp-fight").hidden = false;
    const target = couching() ? null : Pu.aimOf(fight, aim);
    const signature = JSON.stringify([fight.lumis.map(function (f) { return [f.name, f.hp, f.hpMax, f.mp, f.mpMax, f.stages, f.guarding, f.gone]; }),
      fight.foes.map(function (f) { return [f.hp, f.status]; }), fight.at, target]);
    if (signature === lastTeam) return;
    const fresh = !lastTeam;
    lastTeam = signature;
    function pct(now, max) { return Math.max(0, Math.min(100, Math.round(100 * now / Math.max(1, max)))) + "%"; }
    $("lp-team-lumis").replaceChildren.apply($("lp-team-lumis"), fight.lumis.map(function (f, seat) { // Text only: names are people's own words.
      const li = document.createElement("li"), name = document.createElement("span"), hp = document.createElement("div"), mp = document.createElement("div");
      li.dataset.turn = String(fight.at === seat); li.dataset.down = String(f.hp <= 0); li.dataset.you = String(fight.you === seat);
      name.textContent = f.name + " · " + (f.gone ? "gone home" : f.hp + "/" + f.hpMax) + (Pu.standing([f]).length && f.guarding ? " 🛡" : "");
      hp.className = "lp-bar"; hp.innerHTML = '<i style="width:' + pct(f.hp, f.hpMax) + '"></i>';
      mp.className = "lp-bar lp-bar-mp"; mp.innerHTML = '<i style="width:' + pct(f.mp, f.mpMax) + '"></i>';
      li.append(name, hp, mp);
      return li;
    }));
    const foes = $("lp-team-foes");
    if (fresh || foes.children.length !== fight.foes.length) foes.replaceChildren.apply(foes, fight.foes.map(function (f, i) { // Each creature, drawn once.
      const box = document.createElement("figure"), art = document.createElementNS("http://www.w3.org/2000/svg", "svg"), label = document.createElement("figcaption"), bar = document.createElement("div");
      box.dataset.click = "aim:" + i;
      art.setAttribute("viewBox", "0 0 200 200"); art.innerHTML = E.draw(f.body, f.colour); // Art authored in enemies.js; colours are the server's checked #rrggbb.
      bar.className = "lp-bar lp-bar-foe"; bar.innerHTML = "<i></i>";
      box.append(art, label, bar);
      return box;
    }));
    fight.foes.forEach(function (f, i) {
      const box = foes.children[i];
      box.dataset.down = String(f.hp <= 0); box.dataset.aim = String(i === target);
      box.querySelector("figcaption").textContent = f.name + " · Lv " + f.level + " · " + f.hp + "/" + f.hpMax;
      box.querySelector(".lp-bar i").style.width = pct(f.hp, f.hpMax);
    });
  }

  // ---- In a party: every friend's Lumi beside yours (on the couch, everyone's), in her own colours and clothes.
  function drawCrew() {
    const box = $("lp-crew"), on = Boolean(party) && (couching() || inParty()) && TABS[tab] === "dungeon" && !browsing;
    const crew = on ? party.members.filter(function (m) { return couching() || m.user !== party.you; }) : [];
    const team = teamFight();
    room.dataset.crew = String(crew.length);
    room.dataset.couchCrew = String(on && couching());
    box.hidden = !crew.length;
    const signature = JSON.stringify(crew.map(function (m) { return [m.user, m.name, m.pet, m.glow, m.colour, m.outfit, m.fainted, team ? team.at : null]; }));
    if (signature === lastCrew) return;
    lastCrew = signature;
    box.replaceChildren.apply(box, crew.map(function (m) {
      const figure = document.createElement("figure"), name = document.createElement("figcaption");
      const seat = team ? team.lumis.findIndex(function (f) { return f.user === m.user; }) : -1;
      figure.className = "lp-crew-lumi"; figure.dataset.ghost = String(m.fainted); figure.dataset.turn = String(seat >= 0 && team.at === seat);
      figure.innerHTML = '<svg viewBox="0 0 320 300" aria-hidden="true">' + lumiMarkup(m) + "</svg>"; // Authored markup; the name goes in as text below.
      name.textContent = (m.pet && m.pet !== "Lumi" ? m.pet + " · " : "") + m.name;
      figure.appendChild(name);
      return figure;
    }));
  }

  // ---- The party browser: every open party, full screen, each with its Lumis (party-ui.js browserScene).
  function browse() { browsing = { at: 0 }; partiesAsked = 0; picks[tab] = 0; askParties(); }

  function browserList() { return openParties.filter(function (p) { return !p.mine && p.phase === "lobby"; }); }

  function drawBrowser() {
    const on = Boolean(snap && browsing && TABS[tab] === "dungeon" && !trip() && !party);
    room.dataset.browse = String(on);
    if (!on) { if (browsing && party) browsing = null; return; }
    if (Date.now() - partiesAsked > 4000) askParties(); // It keeps watching while open.
    const open = browserList();
    browsing.at = Math.max(0, Math.min(browsing.at, open.length - 1));
    $("gm").dataset.walking = "true"; $("lp-dungeon").style.display = "";
    lastDungeon = ""; lastGarden = ""; lastSkills = ""; lastAlbum = "";
    $("lp-dungeon").innerHTML = Pu.browserScene(openParties, { at: browsing.at, lumi: lumiMarkup }); // Authored markup; every name is escaped by party-ui.js.
  }

  function browserKey(action) { // The arrows in the browser move over the cards, and the list's cursor with them (its join rows are in the same order), so Enter joins.
    const count = browserList().length, move = { left: -1, right: 1, up: -1, down: 1 }[action]; // One column of cards: every arrow steps one.
    if (move === undefined || !count) return false;
    browsing.at = Math.max(0, Math.min(count - 1, browsing.at + move)); picks[tab] = browsing.at;
    render(); return true;
  }

  function drawList(current) { // Rebuild the buttons only when the rows change, so focus and the remote's place survive a refresh.
    const signature = TABS[tab] + "|" + current.map(function (row) { return row.key + row.name + row.hint; }).join("|");
    const keys = TABS[tab] + "|" + current.map(function (row) { return row.key; }).join("|");
    if (signature !== lastList && keys === lastKeys && list.children.length === current.length) { // The same rows with new words (a countdown, a count):
      lastList = signature; // change the words where they stand, so a button being pressed is never swapped for another mid-press.
      Array.from(list.children).forEach(function (button, index) {
        const row = current[index], text = button.lastChild;
        button.firstChild.textContent = row.icon; text.firstChild.nodeValue = row.name; text.lastChild.textContent = row.hint;
      });
    } else if (signature !== lastList) {
      lastList = signature; lastKeys = keys;
      list.replaceChildren.apply(list, current.map(function (row, index) {
        const button = document.createElement("button"), icon = document.createElement("span"), text = document.createElement("span"), hint = document.createElement("small");
        button.type = "button"; button.dataset.lpRow = row.key;
        icon.textContent = row.icon; icon.setAttribute("aria-hidden", "true");
        text.append(document.createTextNode(row.name), hint); hint.textContent = row.hint; // The name stays a text node of its own, so it can be changed in place.
        button.append(icon, text);
        button.addEventListener("click", function () { picks[tab] = index; choose(); }); // Mouse and touch act directly.
        return button;
      }));
    }
    const boardHasIt = (walking() && focus === "board" && (play.board || play.cursor !== undefined)) || (gardening() && gardenFocus === "board" && (!drawer || paging())) || (treeing() && skillFocus === "board") || (albuming() && albumFocus === "board"); // Enter would act on the puzzle or the plot, not the list.
    Array.from(list.children).forEach(function (button, index) {
      const chosen = index === picks[tab] && !boardHasIt;
      if (chosen && button.getAttribute("aria-pressed") !== "true" && list.scrollHeight > list.clientHeight) button.scrollIntoView({ block: "nearest" }); // Long lists follow the remote.
      button.setAttribute("aria-pressed", String(chosen));
    });
  }

  function render() { // Refresh the room, meters and list without flooding the remote's status line.
    if (!snap) return;
    if (trip() && TABS[tab] !== "dungeon") changeTab(TABS.indexOf("dungeon")); // A trip (even one begun on another device) keeps Lumi Dungeons in the dungeon.
    const rooming = syncRoom(); // Room mode on or off, and the tab to match.
    const pet = snap.pet, now = Date.now(), scene = sceneNow(), mood = R.mood(pet), task = pet.task;
    room.dataset.palette = pet.glow;
    $("lp-name").textContent = pet.name || "Lumi";
    room.dataset.night = String(scene.night);
    room.dataset.sleep = String(scene.asleep || snap.pet.faint_until > serverNow());
    room.dataset.mood = mood.sad ? "sad" : "fine";
    $("lp-moments").textContent = pet.moments.toLocaleString();
    $("lp-memory").textContent = MEMORIES[pet.memory] || "Our first hello";
    $("lp-level").textContent = pet.level + (snap.progress.next ? " · " + pet.exp + "/" + snap.progress.next + " EXP" : " · the very top");
    const resting = pet.faint_until > serverNow(); // Napping off a lost fight: free in ten minutes.
    R.METERS.forEach(function (meter) { // Each meter is a bar and a number; low ones change colour.
      const bar = $("lp-" + meter), value = Math.round(pet[meter]);
      bar.style.width = value + "%"; bar.parentNode.setAttribute("aria-valuenow", String(value));
      bar.parentNode.dataset.low = String(pet[meter] < R.LOW);
      $("lp-" + meter + "-n").textContent = value;
    });
    const health = snap.health, share = Math.round(100 * health.hp / health.max); // Her health: a bar, and "42/90".
    $("lp-health").style.width = share + "%"; $("lp-health").parentNode.setAttribute("aria-valuenow", String(share));
    $("lp-health").parentNode.dataset.low = String(share < R.LOW);
    $("lp-health-n").textContent = health.hp + "/" + health.max;
    $("lp-clock").textContent = scene.night ? "Moonlight hours" : "A little daytime glow";
    const left = task ? R.countdown(task.finishesAt - serverNow()) : "";
    $("lp-state").textContent = task ? (task.kind === "nap" ? "Napping · " + left : "Playing · " + left)
      : snap.fight || teamFight() ? "In a fight!" : exploring() ? "Exploring · floor " + exploring().depth : resting ? "Napping off a fight · " + R.countdown(pet.faint_until - serverNow())
      : !health.out && health.hp < health.max && mendsIn() > 0 ? "Mending · " + R.countdown(mendsIn())
      : scene.asleep ? "Dreaming in good company" : mood.need ? NEEDS[mood.need] : "Happy to be here with you";
    $("lp-pet-title").textContent = (pet.name || "Lumi") + (scene.asleep ? ", a glowing fairy cat, sleeping peacefully" : ", a glowing fairy cat, awake");
    if (task && task.kind === "play") room.dataset.action = "play"; // She keeps playing for as long as the toy lasts.
    else if (now >= effectUntil) { delete room.dataset.action; $("lp-effect").textContent = scene.asleep ? "z z z" : mood.sad ? "…" : "♡"; }
    tabButtons.forEach(function (button, index) { button.setAttribute("aria-selected", String(index === tab)); });
    syncPlay();
    syncMini(); // Before the list is made: a minigame that just began or ended changes what the list offers.
    const current = rows();
    picks[tab] = Math.min(picks[tab], Math.max(0, current.length - 1)); // A list that shrank keeps a valid selection.
    drawList(current);
    const pick = current[picks[tab]];
    drawHouse(TABS[tab] === "home" && pick && pick.preview);
    drawOutfit(TABS[tab] === "closet" && pick && pick.wear);
    drawDungeon();
    if (APP === "lumi-pet") drawRoomBits(rooming); // After the dungeon's keys: room mode's own.
    if (TOWN) drawTownBits(pick);                  // Lumi City's: the lower bar, her bubble, the panel only for a list, Lumi Realty's preview card
    drawGarden();
    drawSkills();
    drawAlbum();
    drawBrowser();
    drawPad();
    drawFight();
    drawCrew();
    drawTint();
    drawCouch();
    const doing = snap.fight ? "fighting " + snap.fight.enemy.name : task ? BUSY[task.kind] : scene.asleep ? "dreaming" : mood.need ? "needs " + mood.need : "content";
    const report = "Lumi · " + doing + " · " + (tab === ROOM ? Ru.room(roomAt.room).name.toLowerCase() : roomCard ? roomCard.name : tabButtons[tab].textContent) + ": " + (pick ? pick.name : "nothing yet") + " · Enter to choose";
    if (report !== lastReport) { G.report(report); lastReport = report; }
  }

  function announceDone() { // A nap or a play that finished (even while away) is mentioned once, when first seen.
    const done = snap.pet.done;
    if (!done || done.at === lastDone) { if (lastDone === null) lastDone = 0; return; }
    const first = lastDone === null; lastDone = done.at;
    if (first && serverNow() - done.at > 60000) return; // Old news on opening the page stays quiet.
    say(done.kind === "nap" ? "A stretch, a blink, a happy little hello. Lumi feels rested." : "What a game! Lumi flops down, very pleased with the " + item(done.item).name.toLowerCase() + ".");
    effect("cuddle", "✧ ♡");
  }

  var refreshFails = 0, refreshAfter = 0; // Failed asks in a row, and when the next may go (ms): a struggling server gets room to recover.
  function refresh() { // Ask the server how Lumi is; a failure keeps the last picture and tries again later.
    if (picking) return Promise.resolve(); // Nobody's Lumi is chosen yet: nothing to ask about.
    if (Date.now() < refreshAfter) return Promise.resolve(); // Still waiting out the last failure: keep the last picture.
    return G.api(API + "state").then(function (data) { refreshFails = 0; refreshAfter = 0; take(data); announceDone(); welcomeHome(); render(); }).catch(function () {
      refreshFails += 1;
      refreshAfter = Date.now() + Math.min(30000, 1000 * Math.pow(2, refreshFails)); // 2 s, 4 s, 8 s... at most 30 s between tries.
      if (!snap) say("Lumi can't be reached just now. She'll be here when the connection is back.");
    });
  }

  function greet() { // A real moment with Lumi, not just opening the page, counts as today's visit.
    if (visited) return;
    visited = true;
    G.api(API + "visit", {}).then(function (data) {
      $("lp-coins").textContent = data.coins.toLocaleString(); snap.coins = data.coins;
      if (data.paid) say($("lp-message").textContent + " +" + data.paid + " SGC for visiting today.");
      else if (data.owed) say($("lp-message").textContent + " Lumi-Town Bank is closed for a moment: your " + data.owed + " SGC for visiting today is saved for you."); // LumiBot: an owed prize
    }).catch(function () { /* Lumi is just as happy either way */ });
  }

  function choose() { // Act on the selected row: the server's words if it refuses.
    if (!snap) return;
    const row = rows()[picks[tab]];
    if (!row) return;
    if (row.local) { if (pendingConfirm !== row.key) pendingConfirm = null; row.local(); lastList = ""; render(); return; } // Nothing to ask the server: it works at once, even while an answer is on its way.
    if (row.cycle && !row.send) { setCycle(row, 1); return; } // The co-op fight's Aim row: Enter aims at the next creature.
    if (busy) return; // One request at a time.
    if (!row.send) { say(row.note || "That's already in the room."); return; }
    if (row.ask && pendingConfirm !== row.key) { pendingConfirm = row.key; say(row.ask); render(); return; } // Try before you buy: the first press shows it, the second buys it.
    if (row.confirm && pendingConfirm !== row.key) { pendingConfirm = row.key; say("Sure? Choose it once more to go. " + row.hint + "."); return; } // Nothing is lost to one stray press.
    submit(row);
  }

  function setCycle(row, by) { // ◀ ▶ (or Enter on the Aim row) in the co-op fight: the next creature to aim at, or Lumi to give to.
    const to = row.next(by);
    if (row.cycle === "aim") aim = to; else ally = to;
    lastList = ""; render();
  }

  function submit(row) { // Send one choice to the server, one request at a time, and show what came of it.
    if (row.url === "garden") { gardenSend(row.send); return; } // The garden's choices have their own words (garden-ui.js said).
    if (row.url === "party" || (row.url === "dungeon/act" && inParty() && party.run)) { partyAct(row.send); return; } // Out with friends: every dungeon choice is the party's (a step is a vote).
    if (row.url === "party-new") { partyNew(row.send.mode); return; }
    if (row.url === "party-join") { partyJoin(row.send.code); return; }
    if (busy) return;
    pendingConfirm = null;
    busy = true;
    G.api(API + (row.url || "act"), row.send).then(function (data) {
      take(data);
      flip = {}; // What was being tried on is now either bought or put back.
      if (row.url && row.url.indexOf("dungeon") === 0) { // A step in the dungeon: the room's line, and a fight if she walked into one.
        const run = data.dungeon.run;
        lastList = ""; picks[tab] = 0;
        say(run.say);
        if (data.fight && data.fight.status === "active") effect("play", "!");
        else effect(run.over === "defeat" ? "rest" : "cuddle", { treasure: "✦", vault: "✧ ✦ ✧", key: "🗝", game_win: "✧ ✦", home: "⌂", descend: "⤓" }[run.event.scenario] || "·");
        tellLive(JSON.stringify(run.event));
        greet(); return;
      }
      if (row.url) { // A fight began, or a turn was played: say what just happened, from the fight's own log.
        const fight = data.fight;
        battleView = null;
        say(fight.log.slice(row.url === "battle" ? 0 : -3).join(" "));
        if (fight.status !== "active") {
          finished = fight; snap.fight = null; picks[tab] = 0;
          if (fight.dungeon && snap.dungeon.run) { say(fight.log.slice(-2).join(" ") + " " + snap.dungeon.run.say); tellLive(JSON.stringify(snap.dungeon.run.event)); } // What it meant for the trip.
        }
        else if (row.url === "battle") picks[tab] = 0;
        effect(fight.status === "victory" ? "play" : fight.status === "defeat" ? "rest" : "cuddle", fight.status === "victory" ? "✧ ✦ ✧" : fight.status === "defeat" ? "z z z" : "✦");
        greet(); return;
      }
      const send = row.send, thing = send.item ? item(send.item) : null;
      if (send.action === "cuddle") { say(CUDDLES[data.pet.moments % CUDDLES.length]); effect("cuddle", "♡ ♡"); }
      else if (send.action === "feed") { say(thing.name + "! Lumi munches happily" + (thing.boost ? " and sparkles with a little " + thing.boost + " for her next adventure." : ".")); effect("snack", "✦"); }
      else if (send.action === "play") { say("Lumi pounces on the " + thing.name.toLowerCase() + ". " + thing.minutes + " minutes of play!"); effect("play", "✧ ✦"); }
      else if (send.action === "drink") { say("Glug glug! Lumi has " + data.health.hp + " of " + data.health.max + " HP."); effect("snack", "✦"); }
      else if (send.action === "nap") { say("Lumi curls up on the cushion. Five minutes of little star dreams."); effect("rest", "z z z"); }
      else if (send.action === "wake") { say("A stretch, a blink, a happy little hello. Lumi settles beside you."); effect("rest", "☀"); }
      else if (send.action === "decorate") { say(data.said ? "Bought and put out: " + row.label + ". " + data.said.paid + " SGC well spent." : row.label + " is out. Lumi approves."); effect("cuddle", "✧"); }
      else if (send.action === "capsule") { say("The capsule pops open: " + data.said.name + "! (" + data.said.rarity + ")" + (data.said.duplicate ? " Lumi already has one, so it pays back " + data.said.buyback + " SGC" + (data.said.buyback_owed ? " (and " + data.said.buyback_owed + " SGC saved for you while Lumi-Town Bank is closed)" : "") + "." : "")); effect("play", "✧ ✦ ✧"); } // The list stays on this capsule's row, so Enter opens the same kind again.
      else if (send.action === "wear") { say(data.said ? "Bought: " + row.label + ". Lumi tries it on at once." : data.pet.outfit[row.wear[0]] === send.item ? "Lumi puts on the " + row.label.toLowerCase() + "." : "Lumi takes it off."); effect("cuddle", "✧"); }
      else if (send.action === "storyteller") {
        if (data.pet.storyteller !== "live") say("The storyteller is the library: the lines that came with the game.");
        else G.api(API + "dungeon/tale").then(function (found) { say(found.live ? "Live storytelling is on. Each dungeon moment gets a fresh line from " + (found.live === "claude" ? "Claude, with your own key." : "BFGguf.") : "Live storytelling isn't available in Lumi-Town yet; the library tells the story."); }).catch(function () { /* the setting is saved either way */ });
      }
      else if (send.action === "learn") { say("Lumi learned " + (row.label || row.name) + "!"); effect("play", "✧ ✦"); }
      else if (send.action === "equip") { say(data.pet.moves.includes(send.item) ? (row.label || row.name) + " is ready for the next fight." : (row.label || row.name) + " is put away."); }
      else if (send.action === "mod") { say(send.item ? (data.said ? "Bought and fitted: " : "Fitted: ") + row.name + "." : "That slot is empty now."); effect("cuddle", "⚙"); }
      else if (send.action === "potions") { say("One potion, tucked away. Lumi carries " + data.pet.potions + "."); }
      else if (send.action === "heal") { say("A stretch and a shake. Lumi is up and ready."); effect("rest", "☀"); }
      else if (send.action === "respec") { say("Every skill point is back. Her trees start afresh."); battleView = null; }
      else if (send.action === "buy") { say("Bought: " + thing.name + ". " + data.said.paid + " SGC well spent."); effect("cuddle", "✧"); }
      else if (send.action === "unpack") { const got = data.said; say("Box open! " + got.name + (got.put_out ? ": Lumi puts it out at once." : ". Something's already there, so she tucks it away for now (Home).") + (got.left ? " " + got.left + " boxes to go." : " That's the last box. She's all moved in!")); effect("play", "📦"); }
      else if (send.action === "name") { say("Hello, " + data.pet.name + "! What a lovely name."); effect("cuddle", "♡"); }
      else if (send.action === "paint") { tint = null; picks[tab] = 1; say("Fresh paint! I love it."); effect("cuddle", "✧ 🎨"); }
      else if (send.action === "door") say({ knock: "Visitors will knock first, and I'll let them in. 🚪", open: "My door is open to everyone! ✨", closed: "Door closed. No visitors for now." }[data.said.door]);
      else if (send.action === "unblock") say("They can visit again.");
      else if (send.action === "colour") { tint = null; picks[tab] = 1; say(data.pet.colour ? "Ooh, " + data.pet.colour.toUpperCase() + "! That's her very own colour now." : "Back to her glow's own colours."); effect("cuddle", "✧ ✦"); }
      else if (send.action === "stat") { const names = snap.battle.rules.stat_names; say(names[send.item] + " is " + data.progress.stats[send.item] + " now · " + data.progress.stat_points.left + " points left."); effect("cuddle", "↑"); }
      else if (send.action === "stats_auto") { const names = snap.battle.rules.stat_names, placed = data.said.placed; say("Auto placed them: " + Object.keys(placed).map(function (key) { return "+" + placed[key] + " " + names[key].toLowerCase(); }).join(", ") + "."); effect("play", "✨"); }
      else if (send.action === "auto_stats") { say(data.progress.stat_points.auto ? "Auto is on: new points place themselves as she levels." : "Auto is off: you place every new point yourself."); }
      else if (send.action === "stats_reset") { say("Every point is back to place again" + (data.said.paid ? " (" + data.said.paid + " SGC)." : ", free this once.")); }
      else if (send.action === "kit") { const kit = snap.battle.rules.kit[send.item]; say("Bought: " + kit.name + ". Lumi carries " + data.progress.kit[send.item] + "."); effect("cuddle", kit.icon); }
      if (["cuddle", "feed", "play", "nap", "wake"].includes(send.action)) greet(); // Shopping and colours aren't a visit; time together is.
    }).catch(function (refused) { say(refused.message); }).then(function () { busy = false; render(); });
  }

  function onKey(action, controller, remote, meta) { // Keyboard, TV remote, gamepad, and the on-screen arrow pad. Everywhere: ◀ ▶ change tab, ▲ ▼ or ⏮ ⏭ move through the list, Enter chooses.
    // meta.held: a direction that free walking (onHold) is also moving her by (common.js, gamepad.js).
    if (couching()) { couchKey(action, controller, remote); return; } // A couch party: every remote is its own person.
    if (picking) { pickPlayer(action, controller); return; } // Who's playing? waits for someone's OK.
    if (player && Date.now() - player.at > player.idle * 1000) { forgetPlayer("Nobody pressed anything for a while. Who's playing?"); return; } // A long-idle TV asks again.
    if (player) { player.at = Date.now(); keepPlayer(); } // Still here: the idle clock starts over.
    // In the dungeon the arrows are Lumi's own: they walk her from room to room, or work the puzzle in front of her.
    // The list is then reached with ⏮ ⏭ (Prev/Next, or Page Up/Down, or [ ]), and ⏯ drinks a potion.
    if (!snap) return;
    const arrow = ["left", "right", "up", "down"].indexOf(action) >= 0;
    if (action === "next" || action === "prev" || action === "play" || arrow) pendingConfirm = null; // Only a second Enter confirms.
    if (roomOn() && syncRoom() && roomKey(action, arrow, meta)) return; // Room mode: the arrows walk her flat; in a card, ⏮ ⏭ go back.
    if (TOWN && townKey(action, arrow, meta)) return; // Lumi Town: every arrow walks her (it has no other tabs to change to); while chatting they go through the phrases.
    if (albuming()) { albumKey(action); return; } // So has the Collection's gallery.
    if (room.dataset.browse === "true" && arrow && browserKey(action)) return; // The party browser: arrows move over the cards.
    if (treeing()) { skillsKey(action); return; } // The skill tree has its own keys too: the arrows move over the skills.
    if (gardening()) { gardenKey(action); return; } // The garden has its own keys: the arrows walk the plots, Play is the press.
    if ((action === "next" || action === "prev") && trip()) { // On a trip: the list's cursor (the arrows walk, and the other tabs wait at home).
      const count = rows().length;
      if (count) picks[tab] = (picks[tab] + (action === "prev" ? count - 1 : 1)) % count;
      focus = "list"; render(); return;
    }
    if (action === "next" || action === "prev") { changeTab((tab + (action === "prev" ? TABS.length - 1 : 1)) % TABS.length); render(); return; } // The next category.
    if (action === "play") { drinkPotion(); return; }
    if (walking()) {
      if (busy) return;
      const board = play.board || play.cursor !== undefined; // Crates, lamps or cards are in front of her.
      if (arrow && board && watching()) { say("It's " + holderName() + "'s turn. Yours comes round if they don't solve it."); return; } // A party's puzzle: only the holder moves it.
      if (arrow && board) { focus = "board"; boardKey(action); render(); return; }
      if (arrow && exploring().facing) { // A key or rune door has no board: up and down just move through its list.
        if (action === "up" || action === "down") { const count = rows().length; picks[tab] = (picks[tab] + (action === "up" ? count - 1 : 1)) % count; render(); }
        return;
      }
      if (arrow) { walk(action); return; }
      if (action === "enter" && board && focus === "board") { boardKey("enter"); render(); return; }
    }
    if (action === "left" || action === "right") { // A row's own options: its next choice, tried on before anything is bought.
      const row = rows()[picks[tab]], by = action === "left" ? -1 : 1;
      if (row && row.cycle) { setCycle(row, by); return; }
      if (row && row.turn) { row.turn(by); return; }
      if (row && row.options) flip[row.flipKey] = Pk.turn(row.options, row.shown, by);
    } else if (action === "up" || action === "down") {
      const count = rows().length;
      if (count) picks[tab] = (picks[tab] + (action === "up" ? count - 1 : 1)) % count;
    } else if (action === "enter") { choose(); return; }
    render();
  }
  G.onAction(onKey, { directEnter: function () { return true; } });
  function backStep() { // Escape, Backspace, a pad's B: one step back inside the game (true), or nothing to go back from (false: leave the game).
    if (chatOn || flatsOn || bookOn || (TOWN && townList)) { chatOn = false; flatsOn = false; bookOn = false; bookPending = null; if (TOWN && townList) { pendingConfirm = null; townList = townList.back || null; if (!townList) { marketStall = null; marketDrawer = null; } } picks[tab] = 0; lastList = ""; render(); return true; } // The phrases, or the list of flats: back to the places (or the room); a town list opened from another goes back up to it.
    return roomOn() && closeCard(); // Room mode: a card closes.
  }
  if (G.onBack) G.onBack(backStep);
  if (G.onHold) G.onHold(onHold); // Held arrows, WASD and a panel's pad: free walking in room mode (elsewhere the loop just stops at once).
  if (window.MPad) window.MPad.start(function (action, who, meta) { // A gamepad (Xbox, PlayStation, most USB pads; gamepad.js, loaded for Lumi Pet).
    G.sound.unlock();
    if (action === "back") { backStep(); return; }              // B / Circle: out of a menu (or the town's phrases)
    if (action === "home") return;                                // the Xbox / PS button: the browser's, not ours
    onKey(action, undefined, undefined, meta);                    // A, Start, LB / RB and the D-pad, as the keys
  }, onHold);                                                     // the stick (analog) and the D-pad walk her
  if ($("lp-chat-type")) { // Lumi Town's typing box: Enter sends, Escape closes (common.js leaves keys in a text box alone).
    $("lp-chat-type").addEventListener("submit", function (event) {
      event.preventDefault();
      const words = $("lp-chat-input").value.trim();
      if (words && typingFor === "book") signBook(words); else if (words) townSay({ text: words });
      chatTyping(false);
    });
    $("lp-chat-input").addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); chatTyping(false); } });
  }
  document.addEventListener("keydown", function (event) { // T in Lumi Town opens the typing box (never while typing already).
    if ((event.key !== "t" && event.key !== "T") || event.ctrlKey || event.metaKey || event.altKey || !snap || !(TOWN || roomOn())) return;
    if (event.target && event.target.matches && event.target.matches("input, select, textarea")) return;
    event.preventDefault(); chatTyping(true);
  });
  document.addEventListener("keydown", function (event) { // E uses the thing in reach, as Enter does (room mode only; never while typing).
    if ((event.key !== "e" && event.key !== "E") || event.ctrlKey || event.metaKey || event.altKey || !((roomOn() && tab === ROOM) || (TOWN && snap))) return; // (Lumi City too)
    if (event.target && event.target.matches && event.target.matches("input, select, textarea")) return;
    event.preventDefault(); onKey("enter");
  });

  // ---- Touch: the arrow pad and the press button (templates/games/lumi-pet.html), and installing this app (each of Lumi's three has its own manifest: web/app.py lumi_manifest).
  const touchy = window.matchMedia("(pointer: coarse), (max-width: 700px)"); // A touch screen, or a phone-sized window.
  const framed = window.top !== window; // Inside Media's game layer: the frame around it is the app, not this page.
  const inApp = window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || window.navigator.standalone === true;
  let installOffer = null; // The browser's install prompt, once it gives us one.

  function drawPad() { // Show the touch controls where there are arrows to press: walking, and puzzle boards.
    const pad = $("lp-pad"), squeeze = $("lp-squeeze"), on = Boolean(snap) && touchy.matches, out = on && walking() ? exploring() : null;
    const board = Boolean(out) && Boolean(play.board || play.cursor !== undefined);
    pad.hidden = !out || (Boolean(out.facing) && !board); // A key or rune door has nothing for arrows: its list does it all.
    if (!pad.hidden) pad.querySelectorAll("[data-pad]").forEach(function (button) {
      const way = { up: "n", right: "e", down: "s", left: "w" }[button.dataset.pad];
      if (button.dataset.pad === "enter") button.hidden = !board; // The middle button turns a card, flips a lamp, or takes a crate step back.
      else button.disabled = !board && out.room.exits.indexOf(way) < 0; // Walking: only the ways there are.
    });
    squeeze.hidden = !(on && gardening() && !mini && !drawer);
  }

  $("lp-pad").addEventListener("pointerdown", function (event) { // On the way down, so a quick thumb is never missed.
    const button = event.target.closest("[data-pad]");
    if (!button || button.disabled) return;
    event.preventDefault();
    onKey(button.dataset.pad);
  });
  $("lp-squeeze").addEventListener("pointerdown", function (event) { event.preventDefault(); if (snap && gardening()) { pressOnce(); render(); } });
  touchy.addEventListener("change", function () { if (snap) render(); });
  window.addEventListener("resize", function () { if (snap && (roomOn() || TOWN)) { lastHouse = ""; render(); } }); // (Lumi City: a new shape, a new camera) // Room mode: a new shape, a new pan.

  window.addEventListener("beforeinstallprompt", function (event) { // The browser can install this page as an app: keep its offer for the Settings row.
    event.preventDefault(); installOffer = event; lastList = "";
    if (snap) render();
  });
  window.addEventListener("appinstalled", function () { installOffer = null; say(NAME + " is on your home screen now."); });

  function installApp() { // Settings → Install (this app): the browser's own prompt if it gave one, otherwise where to find it.
    if (installOffer) {
      const asked = installOffer;
      installOffer = null; // A prompt can only be used once.
      asked.prompt();
      asked.userChoice.then(function (answer) { say(answer.outcome === "accepted" ? NAME + " is on your home screen now." : "No hurry. The row stays in Settings."); });
      return;
    }
    const iPhone = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    say(iPhone ? "Tap Share, then Add to Home Screen, and " + NAME + " gets an icon of its own." : "Open your browser's menu and choose Install app (or Add to Home screen). If it isn't there, " + NAME + " is already installed.");
  }

  $("lp-dungeon").addEventListener("click", function (event) { // Mouse and touch in the dungeon: the room and its boards answer a press (dungeon-art.js presses).
    const hit = event.target.closest("[data-click]");
    if (!hit || !snap || busy || !walking()) return; // (The garden listens for the press itself, below.)
    const what = hit.dataset.click.split(":"), kind = what[0], n = Number(what[1]);
    pendingConfirm = null;
    if (kind === "way") walk({ n: "up", e: "right", s: "down", w: "left" }[what[1]]); // A door: through it.
    else if (kind === "take") submit({ key: "take", url: "dungeon/act", send: { action: "take" } }); // The chest or the key.
    else if (kind === "cup") submit({ key: "cup-" + n, url: "dungeon/act", send: { action: "cup", picks: [n] } });
    else if (kind === "card") { play.cursor = n; focus = "board"; boardKey("enter"); } // Turn the card that was pressed.
    else if (kind === "lamp") { play.board = Object.assign({}, play.board, { cursor: n }); focus = "board"; boardKey("enter"); }
    else if (kind === "cell") { // Crates: one step towards the square that was pressed.
      const xy = what[1].split(",").map(Number), dx = xy[0] - play.board.at[0], dy = xy[1] - play.board.at[1];
      if (dx || dy) { focus = "board"; boardKey(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")); }
    }
    render();
  });

  houseArt.addEventListener("click", function (event) { if (roomOn()) roomPress(event); else doorPress(event); }); // Room mode's things and floor; otherwise her room's door, through to Lumi Town.
  houseArt.addEventListener("mousedown", function (event) { // A middle-click in room mode: she walks just there (and never uses anything).
    if (event.button !== 1 || !(roomOn() || TOWN) || room.dataset.leaving === "true") return;
    event.preventDefault(); // (no browser autoscroll)
    pendingConfirm = null; if (TOWN) townWalkTo(event); else walkTo(event);
  });
  houseArt.addEventListener("auxclick", function (event) { if (event.button === 1 && (roomOn() || TOWN)) event.preventDefault(); }); // Nor a middle-click's other browser habits.
  $("lp-pet").addEventListener("click", function () { // Room mode: press Lumi herself for a cuddle (the bed's card has it too).
    if (!roomOn() || busy || room.dataset.leaving === "true") return;
    submit({ key: "cuddle", send: { action: "cuddle" } });
  });
  ["lp-way-left", "lp-way-right"].forEach(function (id) { // The arrows at the room's edges: walk through to the next room.
    $(id).addEventListener("click", function () {
      if (!roomOn() || !$(id).dataset.go) return;
      roomWalk(Ru.enter($(id).dataset.go, id === "lp-way-left" ? "right" : "left"));
    });
  });
  houseArt.addEventListener("click", townPress); // Lumi City: a door, a sign, a cabinet, or the ground.
  // (Tapping someone's Lumi in town no longer opens a visit: in Lumi City you walk to their door. Doll, 2026-11-19.)
  window.addEventListener("pageshow", function (event) { // Back from a game (or another app) with the browser's Back: the page comes back as it was left, mid-hop through a door.
    if (event.persisted) delete room.dataset.leaving; // She's here again, and the next press goes somewhere at once.
  });

  $("lp-team").addEventListener("click", function (event) { // Mouse and touch on a creature in the co-op fight: aim at it.
    const hit = event.target.closest("[data-click]");
    if (!hit || couching()) return;
    aim = Number(hit.dataset.click.split(":")[1]); lastList = ""; render();
  });

  $("lp-dungeon").addEventListener("pointerdown", function (event) { // Mouse and touch in the party browser: a card, then the same card again to join.
    const hit = event.target.closest("[data-click]");
    if (!hit || !browsing || hit.dataset.click.indexOf("join:") !== 0) return;
    const code = hit.dataset.click.slice(5), at = browserList().findIndex(function (p) { return p.code === code; });
    if (at === browsing.at) partyJoin(code); else { browsing.at = at; picks[tab] = at; render(); }
  });

  $("lp-dungeon").addEventListener("pointerdown", function (event) { // Mouse and touch in the garden. On the way down, not on the click: the drawing is
    const hit = event.target.closest("[data-click]"); // redrawn as flowers grow, and a click that began on a shape since replaced would be lost.
    if (hit && snap && gardening()) gardenClick(hit.dataset.click);
    else if (hit && snap && treeing()) skillClick(hit.dataset.click);
    else if (hit && snap && albuming()) albumClick(hit.dataset.click);
  });

  tabButtons.forEach(function (button, index) { // Tabs can be tapped too.
    button.addEventListener("click", function () { changeTab(index); render(); });
  });

  function tick() { // Once a second: count timers down, collect a finished nap or play, and look in on her now and then.
    if (!snap) return;
    const task = snap.pet.task;
    if ((task && serverNow() >= task.finishesAt) || Date.now() - polled > 15000) { polled = Date.now(); refresh(); }
    if (TOWN) { folkWander(); if (Date.now() - townPolled > 5000) townHere(); if (!cityData && Date.now() - cityAsked > 5000) cityLoad(); } // Lumi City: the townsfolk, who's near (every five seconds), and the city if it hasn't come yet
    if (!TOWN && roomOn() && Date.now() - housePinged > 5000) housePing(); // A flat (her own, or a visit): who's here, every five seconds.
    if (visitKnock && Date.now() - knockPolled > 3000) knockCheck();      // Waiting at a door: has anyone come? // Lumi Town: the townsfolk, and who else is in town (every five seconds).
    if (gardening()) { // The garden: send the presses made this second, and look in more often so the numbers move.
      lumiWanders();
      flushPresses();
      if (!busy && !mini && Date.now() - polled > 5000) { polled = Date.now(); refresh(); }
    }
    render();
  }

  function visibility() { // Hidden frames stop timers and CSS motion; returning asks the server afresh.
    clearInterval(timer); timer = null;
    room.classList.toggle("lp-hidden", document.hidden);
    if (!document.hidden) { if (snap) refresh(); timer = setInterval(tick, 1000); }
  }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", function () { clearInterval(timer); });
  window.addEventListener("pageshow", visibility);

  // ---- Reminders: push notifications on this device (mnemerynne/push.py, static/sw.js). Each device opts in itself.
  function pushable() { // Needs a modern browser on HTTPS; paired TVs are left out.
    return false; // LumiBot: web push is not ported (Phase 7 sends Discord DMs instead), so "Reminders" stays hidden and nothing calls /push or /sw.js
    // eslint-disable-next-line no-unreachable
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext &&
      !document.documentElement.classList.contains("tv");
  }

  function keyBytes(text) { // The server's key arrives as base64url; the browser wants bytes.
    const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(plain, function (c) { return c.charCodeAt(0); });
  }

  function tell(subscription) { // Hand the server this device's subscription and its clock offset, for quiet hours.
    const json = subscription.toJSON();
    return G.api(API + "push", { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, utc_offset: -new Date().getTimezoneOffset() });
  }

  function setReminders(value) { reminders = value; lastList = ""; render(); }

  function checkReminders() { // On opening: is this device already subscribed? If so, refresh it quietly.
    if (!pushable()) return;
    if (Notification.permission === "denied") { setReminders("blocked"); return; }
    setReminders("off");
    navigator.serviceWorker.getRegistration("/").then(function (registration) {
      return registration ? registration.pushManager.getSubscription() : null;
    }).then(function (subscription) {
      if (subscription) return tell(subscription).then(function () { setReminders("on"); });
    }).catch(function () { /* reminders are a nicety; Lumi plays on without them */ });
  }

  function toggleReminders() { // Must start from a tap or key press, which is what lets the browser ask permission.
    if (reminders === "on") {
      navigator.serviceWorker.getRegistration("/").then(function (registration) {
        return registration ? registration.pushManager.getSubscription() : null;
      }).then(function (subscription) {
        if (!subscription) return;
        return G.api(API + "push/off", { endpoint: subscription.endpoint }).then(function () { return subscription.unsubscribe(); });
      }).then(function () { setReminders("off"); say("Reminders are off on this device."); })
        .catch(function () { say("Reminders couldn't be switched off just now. Try again in a moment."); });
      return;
    }
    Notification.requestPermission().then(function (answer) {
      if (answer !== "granted") { setReminders(answer === "denied" ? "blocked" : "off"); say("No reminders, then. Lumi will wait for you here."); return; }
      return Promise.all([navigator.serviceWorker.register("/sw.js", { scope: "/" }), G.api(API + "push")]).then(function (both) {
        return navigator.serviceWorker.ready.then(function (registration) {
          return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(both[1].key) });
        });
      }).then(tell).then(function () {
        setReminders("on"); say("Reminders are on for this device. Lumi will nudge you when she needs you, never at night.");
      });
    }).catch(function (problem) { say(problem && problem.status ? problem.message : "Reminders couldn't be switched on in this browser."); });
  }

  function signOut() { // LumiBot: the Sign out row. First press asks, second POSTs auth/logout (clears lumi_sess), then the login page.
    if (pendingConfirm !== "sign-out") { pendingConfirm = "sign-out"; say("Sign out of Lumi-Town on this device? Choose Sign out once more."); return; } // never on one stray press
    pendingConfirm = null; // asked and answered
    fetch(window.LUMI_PAGES + "auth/logout", { method: "POST", credentials: "same-origin", redirect: "manual", cache: "no-store" }) // a same-origin POST, so the router's cross-site check lets it through
      .then(function (response) {
        if (response.type !== "opaqueredirect" && !response.ok) throw new Error("sign out refused: " + response.status); // the server answers 302 -> login; anything else is a refusal
        location.href = window.LUMI_PAGES + "login"; // signed out: the Sign in with Discord page
      })
      .catch(function () { say("Couldn't sign out just now. Try again in a moment."); }); // offline or refused: still signed in, say so
  }

  function bringOldMemories() { // Happy moments counted in this browser before pets lived on the account move over, once.
    if (snap.pet.imported) return Promise.resolve();
    let old = null;
    try { old = JSON.parse(localStorage.getItem(OLD_SAVE)); } catch (_) { /* nothing to bring */ }
    const kept = R.legacy(old), body = { action: "import", moments: kept.moments };
    if (kept.glow) body.glow = kept.glow;
    return G.api(API + "act", body).then(take).catch(function () { /* she starts fresh; nothing else depends on it */ });
  }

  function begin() { G.api(API + "state").then(function (data) { // First hello: load her, bring any old memories, then start the clock.
    take(data);
    return bringOldMemories();
  }).then(function () {
    if (location.hash === "#garden" && !has("garden")) { location.replace(window.LUMI_PAGES + "lumi-garden"); return; } // An old "flowers are ready" reminder or home-screen shortcut, from when the garden was a tab of Lumi Pet.
    if (trip()) { tab = TABS.indexOf("dungeon"); say(snap.fight ? snap.fight.log.slice(-3).join(" ") : trip().say); } // A trip was waiting: pick it up where it stopped.
    else if (snap.fight && has("battle")) { tab = TABS.indexOf("battle"); say(snap.fight.log.slice(-3).join(" ")); } // A fight was waiting: pick it up where it stopped.
    else if (TOWN) { if (!townStarted) say("Walking into Lumi City… 🏙"); } // (townStart says hello once the city is here: out of a door, or back from a game)
    else if (awayRows().length) say(exploring() ? "Lumi is out exploring. Lumi Dungeons is where she is." : "Lumi is in the middle of a fight, over in Lumi Dungeons."); // She is busy in another of her apps.
    else if (APP === "lumi-dungeons") say("Where shall we go? Pick a place to explore, or find a fight in the arena.");
    announceDone(); welcomeHome(); render(); // (A fresh trip home outranks a finished nap: it is said last.)
    if (VISIT) visitStart(); else if (roomOn()) housePing(); // A visit: their door. At home: she's home (visitors can knock).
  }).catch(function () {
    say("Lumi can't be reached just now. She'll be here when the connection is back.");
  }); }

  // ---- Lumi Dungeons with friends (mnemerynne/lumiparty.py; rows in party-ui.js).
  function inParty() { return Boolean(party && !party.display && party.you !== null && has("dungeon")); } // A member here, on their own device.
  function couching() { return Boolean(party && party.display); } // This TV is a couch party's screen.
  function partyHolder() { const p = party && party.run && party.run.party.puzzle; return p && p.phase === "attempt" ? p.holder : null; }
  function holderName() { const m = Pu.member(party, partyHolder()); return m ? m.name : "someone"; }
  function watching() { return Boolean(party && party.run && partyHolder() !== null && (couching() || partyHolder() !== party.you)); } // Someone else works the puzzle: show their moves.

  function partyBoard(lock, was) { // The puzzle as the holder has left it so far: replay their moves on a fresh board.
    const puzzle = party && party.run && party.run.party.puzzle;
    if (!lock || !puzzle) return was;
    let board = lock.kind === "sokoban" ? Dg.sokobanStart(lock.rows) : Dg.lightsStart(lock);
    if (lock.kind === "sokoban") puzzle.moves.split("").forEach(function (move) { board = Dg.sokobanMove(board, move); });
    else puzzle.presses.forEach(function (cell) { board = Dg.lightsPress(board, cell); });
    const cursor = couching() ? couchCell[puzzle.holder] : was && was.cursor; // Lamps: the holder's own cursor.
    return Object.assign(board, { cursor: cursor || 0 });
  }

  function syncParty() { // After each snapshot: follow the party this person is in (Lumi Dungeons only), or stop.
    if (couching()) { if (party.run) snap.dungeon.run = party.run; return; } // The couch TV shows the party's trip, whoever's Lumi is underneath.
    if (!has("dungeon")) return;
    const code = snap.party ? snap.party.code : null;
    if (code !== partyCode) followParty(code);
    if (party && party.run && snap.dungeon.run && snap.dungeon.run.party) snap.dungeon.run = party.run; // The stream's copy is the freshest.
  }

  function followParty(code) { // Open (or close) the party's live feed: its stream, or asking every 2 s with a play pass.
    if (partyFeed) { if (partyFeed.close) partyFeed.close(); else clearInterval(partyFeed); }
    partyFeed = null; partyCode = code;
    if (!code) { party = null; return; }
    const url = API + "parties/" + code;
    if (player || !window.EventSource) { partyPoll(url); return; }
    partyFeed = partyStream(url, function () { if (partyCode === code) partyPoll(url); });
  }

  function partyPoll(url) { // Ask every two seconds (a play pass can't ride on a stream, and a stuck stream falls back to this).
    if (partyFeed && partyFeed.close) partyFeed.close();
    partyFeed = setInterval(function () { G.api(url).then(takeParty).catch(partyGone); }, 2000);
  }

  function partyStream(url, stuck) { // The party's live stream. If it says nothing for 6 s or drops for good (a proxy holding it back, too many open tabs), stuck() switches to asking.
    const feed = new EventSource(url + "/stream");
    let heard = false;
    const watchdog = setTimeout(function () { if (!heard) { feed.close(); stuck(); } }, 6000);
    feed.addEventListener("party", function (e) { heard = true; clearTimeout(watchdog); takeParty(JSON.parse(e.data)); });
    feed.addEventListener("end", function (e) { clearTimeout(watchdog); feed.close(); partyGone({ message: JSON.parse(e.data).reason }); });
    feed.addEventListener("error", function () { if (feed.readyState === 2) { clearTimeout(watchdog); stuck(); } }); // 2: closed for good
    return feed;
  }

  function partyGone(why) { // The party broke up, or this member left it: back to their own Lumi.
    if (why && why.status && why.status !== 404 && why.status !== 403) return; // A blip: the next ask tries again.
    if (why instanceof Error && !why.status) return; // No answer at all (connection reset, timeout): a blip too, not a goodbye. Leaving here used to reload state and reopen the feed at once, over and over.
    const was = party;
    followParty(null);
    try { sessionStorage.removeItem(COUCH_KEY); } catch (e) { /* nothing kept */ }
    if (was && why && why.message) say(why.message);
    if (snap && snap.dungeon.run && snap.dungeon.run.party) snap.dungeon.run = null;
    lastList = ""; refresh();
  }

  function takeParty(view) { // A fresh party view: draw it, fetch a fight that just began or ended, say what happened.
    if (!view || view.closed || (!view.display && view.you === null)) { partyGone({ message: view && view.closed ? "The party has broken up." : "" }); return; }
    const before = party;
    party = view; partyCode = view.code;
    if (snap) {
      if (view.run) snap.dungeon.run = view.run;
      else if (snap.dungeon.run && snap.dungeon.run.party) snap.dungeon.run = null; // The trip just ended: the lobby again.
    }
    const me = Pu.member(view, view.you), fighting = Boolean(snap && snap.fight && snap.fight.status === "active");
    const team = view.run && view.run.party.fight, own = Boolean(me && me.fighting && !team); // An older one-each fight is the member's own (fetched with her state).
    if (me && own !== fighting) refresh(); // Such a fight began (or ended) for this member: fetch it.
    const said = view.run ? view.run.say : (view.notes || []).slice(-1)[0];
    if (said && (!before || said !== (before.run ? before.run.say : (before.notes || []).slice(-1)[0]))) say(said);
    if (team) { // The co-op fight: say what just happened, from its log, as it happens.
      const log = team.log.join("|");
      if (log !== lastFightLog) { const was = lastFightLog.split("|"); say(team.log.filter(function (line) { return was.indexOf(line) < 0; }).slice(-3).join(" ") || team.log.slice(-1)[0]); lastFightLog = log; }
      if (team.at !== null && team.at === team.you && (!before || !before.run || !before.run.party.fight || before.run.party.fight.at !== team.at)) { G.sound.unlock(); G.sound.tone(784, .12, 0, .08); picks[tab] = 0; } // Your turn: a little chime.
    } else if (lastFightLog) {
      lastFightLog = ""; aim = null; ally = null;
      const result = view.run && view.run.party.last_fight;
      if (result && result.outcome === "victory") { say("Victory! Every Lumi gains " + result.exp + " EXP." + (result.levels[String(view.you)] ? " Lumi levels up!" : "")); effect("play", "✧ ✦ ✧"); refresh(); }
    }
    if (!before || before.revision !== view.revision) lastList = "";
    render();
  }

  function partyAct(body) { // One move at the party, from this member's own device.
    if (busy || !party) return;
    busy = true; pendingConfirm = null;
    G.api(API + "parties/" + party.code, body).then(function (view) {
      takeParty(view); picks[tab] = Math.min(picks[tab], Math.max(0, rows().length - 1));
      if (view.run && view.run.event && body.action !== "vote" && body.action !== "move") effect("cuddle", "✦");
    }).catch(function (refused) { say(refused.message); }).then(function () { busy = false; render(); });
  }

  function partyProgress(body) { // The holder's crates or lamps, as they go. One request at a time; the latest board wins.
    if (partySending) { partyNext = body; return; }
    partySending = true;
    G.api(API + "parties/" + party.code, body).then(takeParty).catch(function (refused) { say(refused.message); }).then(function () {
      partySending = false;
      if (partyNext) { const next = partyNext; partyNext = null; partyProgress(next); }
    });
  }

  function partyNew(mode) { // Make a party: online with me as host, or this TV's couch party.
    if (busy) return;
    busy = true;
    G.api(API + "parties", { mode: mode }).then(function (view) {
      if (view.display) { startCouch(view); say("Party on this TV! Everyone presses OK on their own remote to join. Code " + view.code + "."); }
      else { followParty(view.code); takeParty(view); say("Party " + view.code + " is open. Friends join from Lumi Dungeons → Dungeon, with this code."); }
    }).catch(function (refused) { say(refused.message); }).then(function () { busy = false; render(); });
  }

  function partyJoin(code) { // Join a party by its code.
    if (busy || !code) return;
    busy = true;
    G.api(API + "parties/" + encodeURIComponent(code), { action: "join" }).then(function (view) {
      browsing = null;
      followParty(view.code); takeParty(view); say("You're in " + view.code + "! Choose I'm ready when you are.");
    }).catch(function (refused) { say(refused.message); }).then(function () { busy = false; render(); });
  }

  function askCode() { // A keyboard's way in: type the code a friend shares.
    const code = window.prompt("The party's code:");
    if (code) partyJoin(code.trim().toUpperCase().replace(/[^0-9A-F]/g, ""));
  }

  function askParties() { // The parties waiting to be joined, looked up now and then while the places list is showing.
    if (Date.now() - partiesAsked < 8000) return;
    partiesAsked = Date.now();
    G.api(API + "parties").then(function (found) {
      openParties = found.parties;
      if (found.mine && found.mine !== partyCode) followParty(found.mine); // In a party already (made on another device): follow it.
      lastList = ""; render();
    }).catch(function () { /* the list simply stays as it was */ });
  }

  // ---- The couch: this TV is the party's screen; each remote is its holder's own member, with its own cursor here.
  function startCouch(view) {
    party = view; partyCode = view.code; couchCursor = {}; couchGuess = {}; couchCell = {}; couchConfirm = {}; couchSpot = {}; couchAim = {}; couchAlly = {};
    try { sessionStorage.setItem(COUCH_KEY, view.code); } catch (e) { /* it just won't survive a reload */ }
    if (picking) { picking = false; if ($("lp-who")) $("lp-who").hidden = true; }
    const url = API + "parties/" + view.code;
    partyFeed = partyStream(url, function () { if (couching() && partyCode === view.code) partyPoll(url); });
    if (has("dungeon")) changeTab(TABS.indexOf("dungeon"));
    takeParty(view);
  }

  function couchPress(controller, body) { // One remote's press, with what it chose, for the server to check and do.
    G.api(API + "parties/" + party.code + "/tv/input", Object.assign({ token: controller }, body)).then(takeParty).catch(function (refused) {
      if (refused.status === 404) partyGone(refused); else say(refused.message);
    });
  }

  function couchMenu(m) { // This person's menu. A new moment (lobby or trip, another room, a fight, a puzzle turn) starts their cursor at the top.
    const run = party.run, p = run && run.party;
    const spot = [party.phase, run ? run.at + ":" + (run.facing ? run.facing.at : "") : "", m.fight ? "fight" : "", p && p.fighting, p && p.puzzle ? p.puzzle.phase + p.puzzle.holder : "",
      p && p.fight ? "turn" + p.fight.at : ""].join("|"); // ...and a new turn in the co-op fight.
    if (couchSpot[m.user] !== spot) { couchSpot[m.user] = spot; couchCursor[m.user] = 0; couchConfirm[m.user] = null; }
    return Pu.couchMenu(party, m, { guess: couchGuess[m.user] || [], now: serverNow(), fight: snap ? fightCtx(couchAim[m.user], couchAlly[m.user]) : null });
  }

  function couchKey(action, controller, remote) { // A key at a couch party.
    if (!controller) { // The TV's own keyboard: Enter twice ends the party here.
      if (action !== "enter") return;
      if (!couchEndArmed) { couchEndArmed = true; say("Press Enter again to end the party on this TV."); return; }
      couchEndArmed = false;
      G.api(API + "parties/" + party.code + "/tv/close", {}).catch(function () { /* it ends by itself in time */ }).then(function () { partyGone({ message: "The party on this TV has ended." }); });
      return;
    }
    const m = party.members.find(function (x) { return x.remote === remote; });
    if (!m) { if (action === "enter") couchPress(controller, { action: "join" }); return; } // A new remote's OK sits it down.
    const puzzle = party.run && party.run.party.puzzle, holding = puzzle && puzzle.phase === "attempt" && puzzle.holder === m.user;
    if (holding && couchBoard(m, action, controller, puzzle)) return;
    if (action === "play") { // ⏯: pass the puzzle on, or drink a potion.
      const team = teamFight(), seat = team ? team.lumis.findIndex(function (f) { return f.user === m.user; }) : -1;
      if (team) { if (seat >= 0 && team.at === seat) couchPress(controller, { action: "fight", target: "potion", ally: seat, turn: team.turn }); return; }
      if (holding) couchPress(controller, { action: "pass" });
      else if (party.run && !m.fainted && !m.fight && m.hp < m.hpMax) couchPress(controller, { action: "potion" });
      return;
    }
    const menu = couchMenu(m);
    let at = Math.min(couchCursor[m.user] || 0, Math.max(0, menu.length - 1));
    if (action === "up" || action === "down") { couchCursor[m.user] = (at + (action === "up" ? menu.length - 1 : 1)) % menu.length; couchConfirm[m.user] = null; drawCouch(); return; }
    const row = menu[at];
    if (!row) return;
    if ((action === "left" || action === "right") && row.cycle) { couchCycle(m, row, action === "left" ? -1 : 1); return; }
    if ((action === "left" || action === "right") && row.turn) { couchPress(controller, row.turn(action === "left" ? -1 : 1)); return; }
    if (action !== "enter") return;
    if (row.cycle && !row.send) { couchCycle(m, row, 1); return; }
    if (row.local) { // A rune added or taken off: kept here until they try the code.
      const guess = couchGuess[m.user] || [];
      couchGuess[m.user] = row.local.erase ? guess.slice(0, -1) : guess.length < party.run.facing.lock.slots ? guess.concat([row.local.rune]) : guess;
      drawCouch(); return;
    }
    if (!row.send) return;
    if (row.confirm && couchConfirm[m.user] !== row.key) { couchConfirm[m.user] = row.key; say(m.name + ": press OK again to leave the party."); drawCouch(); return; }
    if (row.send.action === "rune") couchGuess[m.user] = [];
    couchPress(controller, row.send);
  }

  function couchCycle(m, row, by) { // A couch remote's ◀ ▶ in the co-op fight: their own aim, or who their item is for.
    const to = row.next(by);
    if (row.cycle === "aim") couchAim[m.user] = to; else couchAlly[m.user] = to;
    drawCouch();
  }

  function couchBoard(m, action, controller, puzzle) { // The holder's remote on the crates, lamps or cards. True if it was theirs to take.
    const lock = party.run.facing ? party.run.facing.lock : null;
    const way = { up: "n", down: "s", left: "w", right: "e" }[action];
    if (puzzle.kind === "sokoban" && lock) {
      if (action !== "enter" && !way) return false;
      const board = partyBoard(lock, null);
      const moves = action === "enter" ? board.moves.slice(0, -1) : Dg.sokobanMove(board, { n: "u", s: "d", w: "l", e: "r" }[way]).moves;
      if (moves !== board.moves) couchPress(controller, { action: "sokoban", moves: moves });
      return true;
    }
    if (puzzle.kind === "lights" && lock) {
      const at = couchCell[m.user] || 0, size = lock.size;
      if (way) { const to = Dg.cursorMove(at, way, size, size * size); if (to !== null) { couchCell[m.user] = to; play.board = partyBoard(lock, play.board); render(); } return true; }
      if (action === "enter") { couchPress(controller, { action: "lights", picks: puzzle.presses.concat([at]) }); return true; }
      return false;
    }
    if (puzzle.kind === "match") {
      const cards = party.run.game ? party.run.game.cards.length : 8, at = couchCell[m.user] || 0;
      if (way) { const to = Dg.cursorMove(at, way, 4, cards); if (to !== null) { couchCell[m.user] = to; play.cursor = to; render(); } return true; }
      if (action === "enter") { couchPress(controller, { action: "flip", picks: [at] }); return true; }
    }
    return false;
  }

  function drawCouch() { // One column per person: their Lumi's health, their vote, and their own menu with its cursor.
    const box = $("lp-couch"), on = couching();
    box.hidden = !on; list.hidden = on;
    if (!on) return;
    const columns = party.members.map(function (m) {
      const menu = couchMenu(m), at = Math.min(couchCursor[m.user] || 0, Math.max(0, menu.length - 1));
      return { m: m, menu: menu, at: at };
    });
    const signature = JSON.stringify([party.revision, columns.map(function (c) { return [c.m, c.at, c.menu.map(function (r) { return r.name + (r.hint || ""); }), couchConfirm[c.m.user] || "", couchAim[c.m.user], couchAlly[c.m.user]]; }), Math.floor(serverNow() / 1000)]);
    if (signature === box.dataset.drawn) return;
    box.dataset.drawn = signature;
    const head = document.createElement("p");
    head.className = "lp-couch-head";
    head.textContent = party.phase === "lobby" ? "Party on this TV · press OK on your own remote to join (" + party.members.length + "/3) · Enter on the keyboard twice ends it"
      : party.run ? Pu.status(party, serverNow()).name : "";
    const grid = document.createElement("div");
    grid.className = "lp-couch-grid";
    columns.forEach(function (c) {
      const col = document.createElement("section"), name = document.createElement("h3"), bar = document.createElement("div"), fill = document.createElement("i"), info = document.createElement("small");
      col.className = "lp-couch-col"; col.dataset.ghost = String(c.m.fainted);
      name.textContent = c.m.name + (c.m.host ? " ★" : "") + (party.phase === "lobby" ? (c.m.ready ? " ✓" : " …") : "");
      bar.className = "lp-bar"; fill.style.width = Math.round(100 * c.m.hp / Math.max(1, c.m.hpMax)) + "%"; bar.appendChild(fill);
      info.textContent = c.m.fainted ? "A little ghost" : c.m.hp + "/" + c.m.hpMax + " HP · " + LumiPayout("party", "win", c.m.satchel.coins) + " SGC" + (c.m.fight ? " · vs " + c.m.fight.enemy.name + " " + c.m.fight.enemy.hp + "/" + c.m.fight.enemy.hpMax : "");
      col.append(name, bar, info);
      if (c.m.fight && c.m.fight.log.length) { const said = document.createElement("small"); said.className = "lp-couch-log"; said.textContent = c.m.fight.log.slice(-1)[0]; col.appendChild(said); }
      const menu = document.createElement("ol");
      c.menu.forEach(function (row, i) {
        const li = document.createElement("li");
        li.textContent = row.icon + " " + (couchConfirm[c.m.user] === row.key ? "Press OK again: " : "") + row.name + (row.hint ? " · " + row.hint : "");
        if (i === c.at) li.setAttribute("aria-current", "true");
        menu.appendChild(li);
      });
      col.appendChild(menu);
      grid.appendChild(col);
    });
    box.replaceChildren(head, grid);
  }

  function resumeCouch() { // A TV page reopened mid-party (a reload, or Lumi's other app): pick the couch party up again.
    let code = null;
    try { code = sessionStorage.getItem(COUCH_KEY); } catch (e) { code = null; }
    if (!code || !TV) return false;
    G.api(API + "parties/" + code).then(function (view) { if (view.display) startCouch(view); else partyGone(null); }).catch(function () {
      try { sessionStorage.removeItem(COUCH_KEY); } catch (e) { /* nothing kept */ }
    });
    return true;
  }

  // ---- Who's playing? (mnemerynne/lumi_tv.py). Only on a shared TV whose owner has TV guests (game.html data-who).
  const rawApi = G.api; // Every request in the Lumi kit goes through G.api: a pass that stopped working sends the TV back to the picker.
  G.api = function (url, body) {
    return rawApi(url, body).catch(function (failure) {
      if (failure.status === 403 && player) forgetPlayer(failure.message); // Re-paired, guest removed, or too old.
      throw failure;
    });
  };

  function keepPlayer() { // The pass lives in this TV tab's session only, so Lumi's other two apps open on the same player.
    try { if (player) sessionStorage.setItem(PLAYER_KEY, JSON.stringify(player)); else sessionStorage.removeItem(PLAYER_KEY); } catch (e) { /* private mode: asked again next app */ }
  }

  function usePlayer(found) { // Play as the pass holder from now on (null: the TV's own Lumi).
    player = found; picking = false;
    G.setHeader(PLAYER_HEADER, player ? player.pass : null);
    keepPlayer();
    const box = $("lp-who");
    if (box) box.hidden = true;
    $("lp-player").hidden = !player;
    $("lp-player").textContent = player ? "Playing: " + player.name + "'s Lumi" : "";
    snap = null; finished = null; play = {}; lastList = lastDungeon = lastHouse = lastGarden = lastSkills = lastAlbum = lastStory = ""; visited = false; tab = 0; picks = freshPicks(); roomCard = null; // Nothing of the last player's Lumi stays on screen.
    begin();
  }

  function forgetPlayer(why) { // Back to the picker: the next person presses OK on their own remote.
    player = null; picking = true;
    G.setHeader(PLAYER_HEADER, null);
    keepPlayer();
    $("lp-player").hidden = true;
    showWho(why);
  }

  function showWho(why) { // The picker over the room: whose Lumi to show on this TV.
    picking = true;
    let box = $("lp-who");
    if (!box) {
      box = document.createElement("section");
      box.id = "lp-who"; box.className = "lp-who gm-panel"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Who's playing?");
      box.innerHTML = '<p class="gm-eyebrow">// ONE TV, EVERYONE&rsquo;S LUMI</p><h2>Who&rsquo;s playing?</h2>' +
        '<p class="lp-who-big">Press <b>OK</b> on your own remote to play your Lumi.</p>' +
        '<p class="lp-who-small">Or press Enter on a keyboard for this TV&rsquo;s own Lumi.</p><p class="lp-who-why" id="lp-who-why" aria-live="polite"></p>';
      $("gm").appendChild(box);
    }
    $("lp-who-why").textContent = why || "";
    box.hidden = false;
    G.report("Lumi · Who's playing? Press OK on your remote");
  }

  function pickPlayer(action, controller) { // A press while the picker shows: a remote's OK is a person; a keyboard's Enter is the TV's owner.
    if (action !== "enter") return;
    if (!controller) { usePlayer(null); return; } // No remote identity (keyboard, or the phone's cast controls): the TV's own Lumi.
    rawApi(API + "tv/player", { controller: controller }).then(function (found) {
      usePlayer({ pass: found.pass, name: found.name, owner: found.owner, idle: found.idle, at: Date.now() });
      say("Hello, " + found.name + "! Here is your Lumi.");
    }).catch(function (refused) { $("lp-who-why").textContent = refused.message; });
  }

  if (resumeCouch()) begin(); // A couch party in this TV tab: back to it (the TV's own Lumi underneath).
  else if (WHO) { // A shared TV: pick up the player this TV tab already has, or ask.
    let kept = null;
    try { kept = JSON.parse(sessionStorage.getItem(PLAYER_KEY)); } catch (e) { kept = null; }
    if (kept && kept.pass && Date.now() - kept.at < kept.idle * 1000) usePlayer(kept); else showWho("");
  } else begin();
  visibility();
  checkReminders();
  // LumiBot: no service worker (/sw.js is not served; push reminders are Phase 7 as Discord DMs).
})();
