/* The arcade shell Breakout and Snake share (templates/games/arcade-lobby.html): the menu, solo runs, the showdown
   lobby and tables, the canvas they draw on, and the controls. Each game's own game.js hands it a module
   (Arcade.start) that knows its rules and how to draw them; this file knows nothing about bricks or snakes.

   Coins (Roulette's rules): a solo run or a race costs an entry and pays its score, once the server has checked the
   run (src/lumi/arcade/arcade.js). LumiBot: amounts are SadGirlCoin (SGC); prices come from LumiPrice(slug, 'entry', 25)
   and LumiPrice(slug, 'bet', chip), the same numbers the server charges. Showdowns (mnemerynne/showdown.py): two racers play the same seeded game side by side,
   up to five watchers see both boards live and can bet. A table's stream (EventSource) carries every change, and while
   it's open the server knows you're there; close the game and your seat is let go after 30 seconds.

   Controls: arrows (or a remote's) move through the menus and Enter chooses; in a game, each game says. P pauses a
   solo run. Escape goes back to Games. */
(function () {
  "use strict";

  const G = window.MGame;
  const $ = function (id) { return document.getElementById(id); };
  const W = 1366, H = 768;                                   // the canvas's own units, the GameMaker room's size
  const ARENA = { solo: [363, 144], left: [20, 144], right: [706, 144] };
  // A solo game is drawn as big as the screen allows (Doll, 2026-11-11): the same 640 x 480 game, scaled up to fill
  // the height. Showdowns keep two arenas side by side at their own size. The rules never see the difference.
  const SOLO_K = Math.min((W - 120) / 640, (H - 110) / 480), SOLO = { x: (W - 640 * SOLO_K) / 2, y: 72, k: SOLO_K };
  const L = window.LumiSprite;                               // each player's own Lumi (arcade/lumi-sprite.js)
  const COUNTDOWN = 3;                                       // seconds between a race starting and the games moving

  let mod = null, canvas, ctx, scale = 1, view = "menu", base = "";
  let game = null, run = null, paused = false, finishing = false, result = null;
  let table = null, boards = {}, stream = null, streamFails = 0, offset = 0, lobbyTimer = null, boardTimer = 0;
  let raceRun = null, myRunDone = false, betTarget = "p1", focus = 0, lastKey = 0, message = "";
  const held = { left: false, right: false };
  const audio = {};

  // ------------------------------------------------------------- helpers
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function button(label, onClick, cls) {                     // a menu button the arrows and Enter can reach
    const b = el("button", cls || "", label);
    b.type = "button"; b.dataset.nav = "1";
    b.addEventListener("click", function () { G.sound.unlock(); onClick(); });
    return b;
  }
  function serverNow() { return Date.now() / 1000 + offset; }
  function say(text) { message = text || ""; $("ar-status").textContent = message; }
  function show(which) {                                     // one panel at a time, or none while a game is on screen
    view = which;
    ["menu", "lobby", "table", "over"].forEach(function (name) { $("ar-" + name).hidden = name !== which; });
    $("ar-panel").hidden = !["menu", "lobby", "table", "over"].includes(which);
    if ($("ar-panel").hidden && document.activeElement && $("ar-panel").contains(document.activeElement)) {
      document.activeElement.blur();                         // a hidden button must not keep focus: Space would press it again
    }
    focus = 0;
    focusNav();
  }

  // --------------------------------------------------------------- sound
  function load(name, file, copies) {                        // a few copies of each sound, so quick repeats can overlap
    audio[name] = Array.from({ length: copies || 2 }, function () {
      const a = new Audio(new URL(file, base).href);
      a.preload = "auto";
      return a;
    });
  }
  function play(name, volume) {
    if (!G.sound.isOn() || document.hidden || !audio[name]) return;
    const free = audio[name].find(function (a) { return a.paused || a.ended; });
    if (!free) return;                                       // all busy: skipping one beats a pile-up
    free.volume = volume;
    try { free.currentTime = 0; } catch (e) { /* not loaded yet */ }
    free.play().catch(function () { /* the browser wants a key press first */ });
  }

  // ------------------------------------------------------------- drawing
  function fit() {                                           // crisp at any size: a phone, a laptop or a 4K TV
    const box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!box.width) return;
    scale = box.width / W * dpr;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  }

  // Lumi's starry night (her room's own sky): soft pink and aqua glows and four-pointed sparkles that twinkle.
  const SPARKLES = Array.from({ length: 42 }, function (_, i) { return { x: (i * 397) % W, y: (i * 233) % H, r: 2 + (i % 4), phase: i * 0.7 }; });
  function sparkle(x, y, r) {                                // a four-pointed star, as Lumi Pet draws them
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill();
  }
  function backdrop(t) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgb(18,8,32)"); g.addColorStop(0.55, "rgb(32,14,48)"); g.addColorStop(1, "rgb(52,20,58)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const drift = G.reducedMotion ? 0 : t;
    ctx.globalAlpha = 0.1; ctx.fillStyle = "#ff8ecb";        // her glow, drifting slowly
    ctx.beginPath(); ctx.arc(W * (0.5 + 0.3 * Math.sin(drift / 7000)), H * 0.2, 280, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#70ebea"; ctx.globalAlpha = 0.06;
    ctx.beginPath(); ctx.arc(W * (0.5 - 0.32 * Math.sin(drift / 9000)), H * 0.85, 320, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff8dc";
    SPARKLES.forEach(function (s) { ctx.globalAlpha = 0.25 + 0.35 * (G.reducedMotion ? 0.5 : (Math.sin(t / 900 + s.phase) + 1) / 2); sparkle(s.x, s.y, s.r); });
    ctx.globalAlpha = 1;
  }

  function looks() {                                          // whose Lumi is drawn where: mine, and each racer's from their seat
    const out = { me: L ? L.own(G.api) : null };
    if (table) table.seats.forEach(function (s) { if (s.role === "p1" || s.role === "p2") out[s.role] = s.look; });
    return out;
  }

  function label(text, x, y, size, color, align) {         // text in the theme's font
    ctx.font = "700 " + (size || 18) + "px " + G.colors().font;
    ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color || "#ffe9f5"; ctx.fillText(text, x, y);
  }

  // LumiBot: SGC prices from window.LumiPrice (lumi-tuning.js), the same formula the server charges with.
  function priceOf(key, native, fallback) {                  // SGC for a native price at this game
    return typeof window.LumiPrice === "function" ? window.LumiPrice(mod.slug, key, native) : fallback; // the shared formula
  }
  function entryPrice(t) { return priceOf("entry", t.entry_native || 25, t.entry); } // a racer's entry in SGC
  function chipList(t) {                                     // bet chips with their SGC price; chips costing the same keep the bigger one
    const byPrice = {};                                      // SGC price -> chip
    t.chips.forEach(function (n, i) {                        // each native chip
      const price = priceOf("bet", n, (t.chip_prices || [])[i] || n); // what this chip costs
      if (!byPrice[price] || byPrice[price].native < n) byPrice[price] = { native: n, price: price }; // keep the bigger chip
    });
    return Object.keys(byPrice).map(Number).sort(function (a, b) { return a - b; }).map(function (p) { return byPrice[p]; }); // cheapest first
  }
  function prizeNote(r) {                                    // owed / capped words for a racer's prize
    if (r.owed > 0) return " (" + r.owed + " SGC saved: Lumi-Town Bank is closed for a moment)"; // paid later
    if (r.capped) return " (today's prize limit reached)";  // daily cap
    return "";                                              // nothing to add
  }
  function betLine(b) {                                      // what one of my bets did
    if (b.result === "won") return "Your bet won: " + b.back + " SGC back + " + b.won + " SGC" + (b.owed > 0 ? " (" + b.owed + " SGC saved for later)" : "") + (b.capped ? " (today's prize limit reached)" : ""); // a winner
    if (b.result === "refunded") return "Your bet came back: " + b.back + " SGC" + (b.owed > 0 ? " (" + b.owed + " SGC saved for later)" : ""); // no winner
    return "Your " + b.stake + " SGC bet lost.";             // the house keeps it
  }

  function seatName(role) { const s = table && table.seats.find(function (x) { return x.role === role; }); return s ? s.name : ""; }

  function draw(t) {
    backdrop(t);
    const who = looks();
    if (view === "solo" && game) {
      ctx.save(); ctx.translate(SOLO.x, SOLO.y); ctx.scale(SOLO.k, SOLO.k);   // the whole game, drawn bigger
      mod.drawArena(ctx, game, 0, 0, t, who.me);
      ctx.restore();
      hud(SOLO.x, SOLO.y - 16, mod.hud(game));
      if (paused) center("PAUSED", "P or ⏯ to carry on");
      else if (mod.waiting(game)) label(mod.waiting(game), W / 2, SOLO.y + 480 * SOLO.k + 26, 20, "#70ebea", "center");   // a hint under the arena
    } else if (view === "race" && table) {
      const mine = table.role, other = mine === "p1" ? "p2" : "p1";
      const meAt = mine === "p1" ? ARENA.left : ARENA.right, themAt = mine === "p1" ? ARENA.right : ARENA.left;
      if (game && !myRunDone) {
        mod.drawArena(ctx, game, meAt[0], meAt[1], t, who.me);
        hud(meAt[0], meAt[1] - 18, "YOU · " + mod.hud(game));
      } else {
        drawRemote(mine, meAt);
      }
      drawRemote(other, themAt);
      raceBar();
      const left = (table.race ? table.race.started + COUNTDOWN : 0) - serverNow();
      if (left > 0) center(String(Math.ceil(left)), "Get ready");
      else if (myRunDone && table.phase === "racing") center("Finished", "Waiting for " + (seatName(other) || "the other racer"));
    } else if (view === "watch" && table) {
      drawRemote("p1", ARENA.left);
      drawRemote("p2", ARENA.right);
      raceBar();
    } else {
      mod.drawIdle(ctx, t, W, H, who.me);
    }
  }

  function drawRemote(role, at) {                            // a racer's board, from their live telemetry
    const racer = table.race && table.race.racers.find(function (r) { return r.role === role; });
    const board = racer ? boards[racer.seat] : null;
    mod.drawBoard(ctx, board, at[0], at[1], t0(), looks()[role]);
    hud(at[0], at[1] - 18, (racer ? racer.name : seatName(role) || "—") + (racer && racer.done ? " · finished" : "") +
        (board ? " · " + mod.boardHud(board) : ""));
  }
  function t0() { return performance.now(); }

  function hud(x, y, text) { label(text, x, y, 18, "#ffe9f5"); }

  function raceBar() {                                       // time left, across the top
    if (!table || !table.race) return;
    const left = Math.max(0, table.race.ends - serverNow());
    label("SHOWDOWN · " + Math.floor(left / 60) + ":" + String(Math.floor(left % 60)).padStart(2, "0") + " left", W / 2, 60, 22, "#00f0ff", "center");
  }

  function center(big, small) {                              // a big word over the middle of the screen
    ctx.save(); ctx.shadowColor = "#ff2e97"; ctx.shadowBlur = 24;
    label(big, W / 2, H / 2, 72, "#ffe9f5", "center");
    ctx.restore();
    if (small) label(small, W / 2, H / 2 + 44, 22, "#b98aa9", "center");
  }

  // ---------------------------------------------------------------- loop
  let last = 0, spare = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(100, now - (last || now));
    last = now;
    spare += dt;
    while (spare >= 1000 / 60) { spare -= 1000 / 60; tick(); }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw(now);
    if (view === "race" && game && !myRunDone && now - boardTimer > 200) {   // five live boards a second
      boardTimer = now;
      G.api(boardsUrl(), mod.board(game)).catch(function () { /* a missed board is harmless */ });
    }
  }

  function playing() {                                       // whether my game moves this frame
    if (!game) return false;
    if (view === "solo") return !paused;
    if (view !== "race" || myRunDone || !table || !table.race) return false;
    return serverNow() >= table.race.started + COUNTDOWN;
  }

  function tick() {
    if (!playing()) return;
    const events = [];
    mod.step(game, { left: held.left, right: held.right }, events);
    mod.effects(game, events, play);
    G.report(mod.hud(game));
    if (mod.over(game)) endRun(false);
    else if (view === "race" && serverNow() >= table.race.ends) endRun(true);   // time's up: the run ends where it stands
  }

  // ----------------------------------------------------------- solo runs
  let starting = false;
  async function solo() {
    if (starting || view === "solo") return;                 // one run at a time, however fast the presses come
    starting = true;
    try {
      const started = await G.api(window.LUMI_API + mod.slug + "/run", {});
      $("ar-coins").textContent = started.coins.toLocaleString();
      run = started.run; game = mod.create(started.seed, false); paused = false; finishing = false; myRunDone = false;
      show("solo"); say("");
    } catch (e) { say(e.message); }
    finally { starting = false; }
  }

  async function endRun(timeUp) {                            // a run ended: the server checks it (and pays a solo run)
    if (finishing) return;
    finishing = true;
    const body = Object.assign({ run: view === "race" ? raceRun : run }, mod.claim(game, timeUp));
    if (view === "race") myRunDone = true;
    try {
      result = await G.api(window.LUMI_API + mod.slug + "/run/finish", body);
      const best = Math.max(Number(G.store.get("best", 0)) || 0, result.score);
      G.store.set("best", best);
      if (view === "solo") {
        $("ar-coins").textContent = (result.coins || 0).toLocaleString();
        $("ar-over-title").textContent = "Game over";
        $("ar-over-line").textContent = "Score " + result.score + " · paid " + (result.paid || 0) + " SGC · best " + best + (result.note ? " · " + result.note : ""); // SGC paid, plus "saved"/"limit" notes
        show("over");
      }
    } catch (e) {
      say(e.message);
      if (view === "solo") { $("ar-over-title").textContent = "That run wasn't counted"; $("ar-over-line").textContent = e.message; show("over"); }
    }
  }

  // --------------------------------------------------------------- lobby
  function lobby() {
    leaveStream();
    table = null; game = null;
    show("lobby");
    refreshLobby();
    clearInterval(lobbyTimer);
    lobbyTimer = setInterval(function () { if (view === "lobby" && !document.hidden) refreshLobby(); }, 3000);
  }

  async function refreshLobby() {
    try {
      const data = await G.api(window.LUMI_API + mod.slug + "/tables");
      const list = $("ar-tables"), keep = document.activeElement && document.activeElement.dataset.code;
      list.replaceChildren();
      if (!data.tables.length) list.append(el("p", "ar-muted", "No tables yet. Start one, and anyone can join to race you."));
      data.tables.forEach(function (t) {
        const b = button(t.name + (t.mine ? " (you)" : ""), function () { join(t.code); }, "ar-table-row");
        b.dataset.code = t.code;
        b.append(el("small", "", " " + t.racers + "/2 racing · " + t.watchers + " watching · " + t.phase));
        list.append(b);
        if (keep === t.code) b.focus();
      });
    } catch (e) { say(e.message); }
  }

  async function create() {
    try { enter(await G.api(window.LUMI_API + mod.slug + "/tables", {})); }
    catch (e) { say(e.message); }
  }

  async function join(code) {
    try { enter(await G.api(tableUrl(code), { action: "join" })); }
    catch (e) { say(e.message); refreshLobby(); }
  }

  function tableUrl(code) { return window.LUMI_API + mod.slug + "/tables/" + (code || table.code); }
  function boardsUrl() { return tableUrl() + "/board"; }

  function enter(snapshot) {                                 // sitting at a table: its stream carries everything from now on
    clearInterval(lobbyTimer);
    try { sessionStorage.setItem("arcade:" + mod.slug, snapshot.code); } catch (e) { /* storage blocked */ }
      apply(snapshot);
    openStream(snapshot.code);
  }

  function openStream(code) {
    leaveStream();
    stream = new EventSource(tableUrl(code) + "/stream");
    stream.addEventListener("table", function (e) { streamFails = 0; apply(JSON.parse(e.data)); });
    stream.addEventListener("boards", function (e) { boards = JSON.parse(e.data); });
    stream.addEventListener("end", function (e) { goneFromTable(JSON.parse(e.data).reason); });
    stream.onerror = function () {                           // the browser retries by itself; a table that's gone stops it
      if (++streamFails >= 3) G.api(tableUrl(code)).then(function (s) { if (!s.you) goneFromTable("Your seat was given up."); })
        .catch(function () { goneFromTable("This table has closed."); });
    };
  }

  function leaveStream() { if (stream) { stream.close(); stream = null; } streamFails = 0; }

  function goneFromTable(reason) {
    try { sessionStorage.removeItem("arcade:" + mod.slug); } catch (e) { /* storage blocked */ }
    leaveStream();
    lobby();
    say(reason || "");
  }

  async function act(action, extra) {
    try {
      const snapshot = await G.api(tableUrl(), Object.assign({ action: action }, extra || {}));
      if (snapshot.left) { goneFromTable("You left the table."); return; }
      apply(snapshot);
    } catch (e) { say(e.message); }
  }

  function apply(snapshot) {                                 // a fresh table: what to show, and whether my race starts
    offset = snapshot.server_time - Date.now() / 1000;
    const wasRacing = table && table.phase === "racing";
    if (!table || table.revision !== snapshot.revision) G.showCoins("ar-coins");   // a bet, an entry or a win may have moved coins
    table = snapshot;
    if (table.race) mod.raceSeed = table.race.seed;            // a game that redraws others' boards from the seed needs it
    if (table.phase === "racing") {
      const racing = table.role === "p1" || table.role === "p2";
      if (racing && table.race.run && raceRun !== table.race.run) {   // my race begins
        raceRun = table.race.run; myRunDone = false; finishing = false; boards = {};
        game = mod.create(table.race.seed, true);
        if (serverNow() > table.race.started + COUNTDOWN + 5) { myRunDone = true; endRun(false); }   // a reload mid-race: that run is over
      }
      if (racing && !table.race.run) myRunDone = true;
      view = racing ? "race" : "watch";
      $("ar-panel").hidden = true;
      return;
    }
    if (wasRacing || view === "race" || view === "watch") { game = null; raceRun = null; }
    renderTable();
    if (view !== "table") show("table");
  }

  function renderTable() {
    const t = table, box = $("ar-table-body");
    $("ar-table-title").textContent = t.name;
    box.replaceChildren();
    const seats = el("div", "ar-seats");
    ["p1", "p2"].forEach(function (role) {
      const s = t.seats.find(function (x) { return x.role === role; });
      const row = el("p", "ar-seat" + (s && s.you ? " you" : ""));
      row.append(el("b", "", role.toUpperCase() + " "), document.createTextNode(s ? s.name : "empty seat"));
      if (s) row.append(el("span", s.ready ? "ar-ready" : "ar-muted", s.ready ? " ready ✓" : s.away ? " away" : " not ready"));
      seats.append(row);
    });
    const watchers = t.seats.filter(function (x) { return x.role === "watch"; });
    seats.append(el("p", "ar-muted", watchers.length ? "Watching: " + watchers.map(function (x) { return x.name + (x.you ? " (you)" : ""); }).join(", ") : "Nobody watching yet."));
    box.append(seats);
    if (t.last) {
      const res = el("div", "ar-result");
      res.append(el("p", "ar-win", t.last.winner ? t.last.winner + " wins!" : "No winner: every bet came back."));
      t.last.racers.forEach(function (r) {
        res.append(el("p", "", r.name + ": " + (r.forfeit ? "forfeited" : (r.score + " points (distance " + r.distance + "), paid " + r.paid + " SGC" + prizeNote(r))))); // SGC, plus owed/capped
      });
      (t.last.yours || []).forEach(function (b) { res.append(el("p", "ar-muted", betLine(b))); }); // what my own bets did
      box.append(res);
    }
    box.append(el("p", "ar-muted", "Bets (SGC): " + t.bets.p1 + " on P1 · " + t.bets.p2 + " on P2" +
      (t.bets.mine.length ? " · yours: " + t.bets.mine.map(function (b) { return b.amount + " on " + b.role.toUpperCase(); }).join(", ") : ""))); // totals are SGC charged
    const actions = el("div", "ar-actions");
    const me = t.seats.find(function (x) { return x.you; });
    const both = ["p1", "p2"].every(function (r) { return t.seats.some(function (x) { return x.role === r; }); });
    if (me && (me.role === "p1" || me.role === "p2")) {
      actions.append(button(me.ready ? "Not ready" : "Ready to race (" + entryPrice(t) + " SGC)", function () { act("ready"); }, "gm-primary")); // the entry the server charges
      actions.append(button("Watch instead", function () { act("stand"); }));
    } else if (me) {
      if (!both) actions.append(button("Take the empty racer seat", function () { act("seat"); }, "gm-primary"));
      else {
        const pick = button("Betting on: " + (betTarget === "p1" ? "P1 " + seatName("p1") : "P2 " + seatName("p2")), function () {
          betTarget = betTarget === "p1" ? "p2" : "p1"; renderTable(); focusNav();
        });
        actions.append(pick);
        const chips = el("div", "ar-chips");
        chipList(t).forEach(function (c) { chips.append(button("+" + c.price + " SGC", function () { act("bet", { target: betTarget, amount: c.native }); })); }); // chips priced in SGC
        actions.append(chips);
      }
    }
    actions.append(button("Leave table", function () { act("leave"); }));
    box.append(actions);
    focusNav();
  }

  // ---------------------------------------------------------- navigation
  function navs() { return Array.from($("ar-panel").querySelectorAll("[data-nav]")).filter(function (b) { return b.offsetParent !== null; }); }
  function focusNav() {
    if ($("ar-panel").hidden) return;
    const list = navs();
    if (!list.length) return;
    const current = list.indexOf(document.activeElement);
    if (current >= 0) { focus = current; return; }
    focus = Math.max(0, Math.min(focus, list.length - 1));
    list[focus].focus({ preventScroll: true });
  }
  function moveNav(delta) {
    const list = navs();
    if (!list.length) return;
    const current = list.indexOf(document.activeElement);
    focus = ((current >= 0 ? current : focus) + delta + list.length) % list.length;
    list[focus].focus({ preventScroll: true });
  }

  function onAction(action) {
    if ((view === "solo" || view === "race") && game) {
      if (action === "play" && view === "solo") { paused = !paused; return; }
      if ((action === "left" || action === "right") && performance.now() - lastKey < 60) return;   // held keys move it already
      if (playing() || action === "enter" || action === "up") mod.action(game, action);
      return;
    }
    if (view === "watch") return;
    if (action === "up" || action === "left") moveNav(-1);
    else if (action === "down" || action === "right") moveNav(1);
    else if (action === "enter") { const b = navs()[focus]; if (b) b.click(); }
    else if (action === "play") G.sound.toggle();
  }

  const HOLD = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
  document.addEventListener("keydown", function (e) { if (HOLD[e.key]) { held[HOLD[e.key]] = true; lastKey = performance.now(); } });
  document.addEventListener("keyup", function (e) { if (HOLD[e.key]) held[HOLD[e.key]] = false; });
  window.addEventListener("blur", function () { held.left = held.right = false; if (view === "solo" && game) paused = true; });

  // --------------------------------------------------------------- start
  window.Arcade = {
    load: load, play: play, W: W, H: H,
    start: function (gameModule) {
      mod = gameModule;
      base = document.currentScript ? document.currentScript.src : location.href;
      canvas = $("ar-canvas"); ctx = canvas.getContext("2d");
      mod.load(function (name, file, copies) { load(name, new URL(file, base).href, copies); });
      fit();
      window.addEventListener("resize", fit);
      canvas.addEventListener("pointermove", function (e) { pointer(e, false); });
      canvas.addEventListener("pointerdown", function (e) { pointer(e, true); });
      canvas.addEventListener("pointerup", function (e) { if (game && mod.pointerUp) { const at = arenaPoint(e); mod.pointerUp(game, { x: at[0], y: at[1] }); } });
      $("ar-solo").addEventListener("click", function () { G.sound.unlock(); solo(); });
      $("ar-showdown").addEventListener("click", function () { G.sound.unlock(); lobby(); });
      $("ar-sound").addEventListener("click", function () { $("ar-sound").textContent = "Sound: " + (G.sound.toggle() ? "on" : "off"); });
      $("ar-sound").textContent = "Sound: " + (G.sound.isOn() ? "on" : "off");
      $("ar-create").addEventListener("click", create);
      $("ar-lobby-back").addEventListener("click", function () { clearInterval(lobbyTimer); show("menu"); say(""); });
      $("ar-again").addEventListener("click", solo);
      $("ar-over-menu").addEventListener("click", function () { game = null; show("menu"); });
      ["ar-solo", "ar-showdown", "ar-sound", "ar-create", "ar-lobby-back", "ar-again", "ar-over-menu"].forEach(function (id) { $(id).dataset.nav = "1"; });
      $("ar-best").textContent = String(Number(G.store.get("best", 0)) || 0);
      G.showCoins("ar-coins");
      G.onAction(onAction, { directEnter: function () { return false; } });
      let resume = null;
      try { resume = sessionStorage.getItem("arcade:" + mod.slug); } catch (e) { /* storage blocked */ }
      show("menu");
      if (resume) G.api(tableUrl(resume)).then(function (s) { if (s.you) enter(s); }).catch(function () { /* gone */ });
      requestAnimationFrame(frame);
    },
  };

  function local(e) {                                        // a pointer's place in the canvas's own units
    const box = canvas.getBoundingClientRect();
    return { x: (e.clientX - box.left) / box.width * W, y: (e.clientY - box.top) / box.height * H };
  }
  function arenaPoint(e) {                                   // a pointer's place in my arena's own units (the solo arena is drawn scaled)
    const at = local(e);
    if (view === "solo") return [(at.x - SOLO.x) / SOLO.k, (at.y - SOLO.y) / SOLO.k];
    const origin = table && table.role === "p2" ? ARENA.right : ARENA.left;
    return [at.x - origin[0], at.y - origin[1]];
  }
  function pointer(e, down) {
    if (!game || !mod.pointer || !(view === "solo" || view === "race")) return;
    const at = arenaPoint(e);
    mod.pointer(game, at[0], at[1], down);
  }
})();
