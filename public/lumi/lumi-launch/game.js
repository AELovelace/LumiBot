/* Lumi Launch in the browser (Doll's break game, 2026-11-14): the menus, every kind of input, the frame loop that runs
   rules.js 60 steps a second, the drawing, solo goes (paid, replayed by mnemerynne/lumilaunch.py) and couch turns
   (free play on one screen, up to four Lumis).

   Inputs, all turned into the same few actions (input()):
   - keys: Enter or Space = OK, arrows / WASD, P pauses (common.js);
   - every Mnemerynne remote on a TV (the TV's own, the Erynne panel, the phone remote, TV guests'): their presses
     arrive through common.js with the remote's id, which is how couch turns know whose turn a press is;
   - gamepads (gamepad.js): A = OK, B = back, Start = pause, D-pad and stick = arrows, each pad its own player;
   - a tap or click anywhere on the course = OK, and big touch buttons on phones.
   A press is queued and lands at the start of the next frame, logged as [frame, button]: exactly what the server
   replays. Everything that changes on screen as text is set with textContent. */
(function () {
  "use strict";

  const M = window.MGame, R = window.LumiLaunchRules, L = window.LumiSprite, PAD = window.MPad;
  const $ = function (id) { return document.getElementById(id); };
  const stage = $("ll-stage"), canvas = $("ll-view"), ctx = canvas.getContext("2d");
  const C = R.C, BASE = window.LUMI_API + "lumi-launch", STEP = 1000 / 60;
  const SOUNDS = JSON.parse(stage.dataset.sounds);
  const TV = ($("gm").dataset || {}).tv === "1";               // a paired TV: remotes can join couch turns
  const GLOWS = ["rose", "lagoon", "starlight", "zephyr", "wisp", "umbra"];   // plain Lumis for couch players without an account
  const PANELS = ["ll-title", "ll-board", "ll-couch", "ll-scores", "ll-results", "ll-pause"];
  const RU = 22;                                             // her ball's radius in course units (drawing only)

  /* ---------------------------------------------------------------- state */
  let info = null;                     // the title screen's data (GET /state): price, coins, bests, the household board
  let view = "menu";                   // menu, board, couch, scores, results, paused, play, between, finishing
  let go = null;                       // the go being played: {kind: "solo" | "couch", seed, run, n, logs, metres, players, round, turn}
  let s = null, log = [], queue = [];  // this launch's rules state, its presses so far, and presses waiting for the next frame
  let before = "play";                 // what a pause returns to
  let betweenAt = 0;                   // when OK may move on after a landing (so a late puff press doesn't skip ahead)
  let starting = false, reported = "", spin = 0;
  const cam = { x: 0, k: 1 };          // the view: the course x at the screen's left, and px per course unit
  let cw = 0, ch = 0, dpr = 1, last = 0, acc = 0, fx = [], frameNo = 0;

  /* ---------------------------------------------------------------- sound: Doll's own sample pack */
  const audio = {};
  Object.entries(SOUNDS).forEach(function ([name, files]) {   // a few files for each sound, cloned when busy so they overlap
    audio[name] = (Array.isArray(files) ? files : [files]).map(function (file) { const a = new Audio(file); a.preload = "auto"; return a; });
  });
  function play(name, volume) { // A sample, if sound is on and the page is showing.
    if (!M.sound.isOn() || document.hidden || !audio[name]) return;
    const pool = audio[name], base = pool[Math.floor(Math.random() * pool.length)];
    const a = base.paused || base.ended ? base : base.cloneNode();
    a.volume = Math.max(0, Math.min(1, volume === undefined ? 0.8 : volume));
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    a.play().catch(function () { /* the browser wants a press first */ });
  }
  function tone(f, d, delay, vol, type, end) { M.sound.tone(f, d, delay, vol, type, end); }   // a small synth note (common.js)

  /* ---------------------------------------------------------------- panels and menus */
  function show(id) { // One panel at a time (or none while she flies); focus goes to its first button for remotes.
    PANELS.forEach(function (p) { $(p).hidden = p !== id; });
    stage.dataset.menu = id ? "true" : "false";
    const playing = !id;
    $("ll-hud-left").hidden = $("ll-hud-right").hidden = !playing;
    $("ll-touch").hidden = !playing || TV || !matchMedia("(pointer: coarse)").matches;
    $("ll-hint").hidden = !playing;
    if (id) { const first = navs()[0]; if (first) first.focus({ preventScroll: true }); }
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // Space mustn't press a hidden button
  }
  function navs() { // The buttons a remote's arrows move between, in the panel that's showing.
    const open = PANELS.map($).find(function (p) { return !p.hidden; });
    return open ? Array.from(open.querySelectorAll("button")).filter(function (b) { return !b.hidden && b.offsetParent !== null; }) : [];
  }
  function moveNav(delta) {
    const list = navs();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement);
    list[((at < 0 ? 0 : at + delta) + list.length) % list.length].focus({ preventScroll: true });
  }
  function nav(action) { // Arrows move, OK presses the button that has focus.
    if (action === "up" || action === "left") moveNav(-1);
    else if (action === "down" || action === "right") moveNav(1);
    else if (action === "enter") { const b = navs().includes(document.activeElement) ? document.activeElement : navs()[0]; if (b) b.click(); }
  }
  function toast(text, ms) { const t = $("ll-toast"); t.textContent = text; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, ms || 1800); }
  function error(text) { const e = $("ll-error"); e.textContent = text || ""; e.hidden = !text; }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function row(list, left, right, cls) { // one line of a list: a name and a number
    const li = el("li", cls || "");
    li.append(el("span", "", left), el("b", "", right));
    list.append(li);
  }

  async function loadInfo() { // The title screen's numbers (it plays on without them).
    try {
      info = await M.api(BASE + "/state");
      $("ll-coins").textContent = info.coins.toLocaleString();
      $("ll-solo-note").textContent = window.LumiPrice("launch", "entry", info.entry) + " SGC · " + info.shots + " launches" + (metresPerSgc(info.metres_per_coin) ? " · every " + metresPerSgc(info.metres_per_coin).toLocaleString() + " m pays 1 SGC" : ""); // LumiBot: SGC, same tuning as the server
      $("ll-board-note").textContent = info.board.length ? "Longest: " + info.board[0].go.toLocaleString() + " m (" + info.board[0].name + ")" : "Nobody's launched yet";
    } catch (e) { error(e.message); }
  }
  function metresPerSgc(perCoin) { // LumiBot: metres for one SGC (the smallest native prize LumiPayout turns into 1 SGC, times metres per coin); 0 = pays nothing
    for (let n = 1; n <= 100000; n++) if (window.LumiPayout("launch", "win", n) >= 1) return n * perCoin; // the first whole SGC
    return 0;                                                                     // payouts are off
  }
  function menu() { go = null; s = null; view = "menu"; error(""); show("ll-title"); loadInfo(); report("In the menu"); }

  function board() { // The household's longest goes.
    view = "board"; show("ll-board");
    const list = $("ll-board-list"); list.replaceChildren();
    const rows = (info && info.board) || [];
    if (!rows.length) list.append(el("li", "ll-muted", "Nobody's launched yet. Be the first!"));
    rows.forEach(function (r, i) { row(list, (i + 1) + ". " + r.name, r.go.toLocaleString() + " m · longest " + r.shot.toLocaleString() + " m"); });
    $("ll-board-mine").textContent = info ? "Your best go: " + info.best.go.toLocaleString() + " m · your longest launch: " + info.best.shot.toLocaleString() + " m" : "";
  }

  function report(text) { if (text !== reported) { reported = text; M.report(text); } }   // the line under the game's name on a remote

  /* ---------------------------------------------------------------- a solo go (paid, replayed by the server) */
  async function solo() {
    if (starting) return;
    starting = true; error("");
    try {
      const t = await M.api(BASE + "/start", {});
      go = { kind: "solo", run: t.run, seed: t.seed, n: 0, logs: [], metres: [] };
      $("ll-coins").textContent = t.coins.toLocaleString();
      launch();
    } catch (e) { error(e.message); show("ll-title"); }
    finally { starting = false; }
  }

  async function finishGo() { // The go is over: the server flies every launch again and pays what it saw.
    view = "finishing";
    const body = { run: go.run, shots: go.logs };
    const list = $("ll-results-list"); list.replaceChildren();
    try {
      const r = await M.api(BASE + "/finish", body);
      $("ll-results-eyebrow").textContent = r.new_best.go ? "A new best go!" : "What a flight!";
      $("ll-results-title").textContent = r.summary.total.toLocaleString() + " m in all";
      r.summary.shots.forEach(function (x, i) { row(list, "Launch " + (i + 1) + ENDS[x.end], x.m.toLocaleString() + " m"); });
      $("ll-results-earned").textContent = r.refused ? r.refused :
        "Paid " + r.paid + " SGC" + (r.said ? " · " + r.said : "") + " · you have " + r.coins.toLocaleString() + " SGC"; // LumiBot: SGC; owed / limit words from the server
      if (r.new_best.go || r.new_best.shot) play("yay", 0.8);
      if (info) { info.best = r.best; info.board = r.board || info.board; info.coins = r.coins; }
    } catch (e) {
      $("ll-results-eyebrow").textContent = "Hmm~";
      $("ll-results-title").textContent = "That go wasn't counted";
      $("ll-results-earned").textContent = e.message;
    }
    view = "results"; show("ll-results"); report("Lumi Launch · results");
  }
  const ENDS = { rest: "", honey: " · stuck in honey 🍯", nap: " · fell asleep 💤", time: " · still rolling at a minute", "": "" };

  /* ---------------------------------------------------------------- couch turns (free play, one screen) */
  function couch() {
    go = { kind: "couch", seed: 1 + Math.floor(Math.random() * (R.M - 2)), players: [], round: 1, turn: 0 };
    view = "couch"; show("ll-couch");
    $("ll-couch-how").textContent = TV ? "Press OK on your remote, or A on a gamepad, to join. Up to four Lumis." :
      "Press A on a gamepad to join, or add players who'll share this screen. Up to four Lumis.";
    renderCouch();
  }
  function renderCouch() {
    const list = $("ll-couch-list"); list.replaceChildren();
    if (!go.players.length) list.append(el("li", "ll-muted", "Nobody yet~"));
    go.players.forEach(function (p, i) { row(list, (i + 1) + ". " + p.name + (p.pending ? " …" : ""), HOW[p.who.split(":")[0]]); });
    $("ll-couch-start").disabled = !go.players.length;
  }
  const HOW = { remote: "remote", pad: "gamepad", here: "this screen" };

  async function join(who, controller) { // Someone pressed OK to join: on a TV, the server says whose remote it is and how their Lumi looks.
    if (go.players.length >= 4) { toast("Four Lumis is a full couch!"); return; }
    const n = go.players.length;
    const p = { who: who, name: "Player " + (n + 1), look: { glow: GLOWS[n % GLOWS.length], outfit: {} }, metres: [], total: 0, pending: !!controller };
    go.players.push(p); renderCouch();
    if (controller) {
      try {
        const r = await M.api(BASE + "/tv/player", { controller: controller });
        const twin = go.players.filter(function (q) { return q !== p && q.account === r.name; }).length;
        p.account = r.name; p.name = r.name + (twin ? " " + (twin + 1) : ""); p.look = r.look || p.look;
      } catch (e) { toast(e.message, 2600); }   // still plays, as a plain Lumi
      p.pending = false;
    }
    play("ding", 0.6); renderCouch();
  }

  function couchStart() { if (!go.players.length) return; go.round = 1; go.turn = 0; launch(); }

  function current() { return go && go.kind === "couch" ? go.players[go.turn] : null; }   // whose turn it is

  function mayPress(who) { // In couch turns only the player whose turn it is can launch; this screen's own keys always can.
    const p = current();
    return !p || who === "here" || p.who === who || p.who.startsWith("here");
  }

  function scores(final) { // Between turns: everyone's totals; at the end, who flew furthest.
    const list = $("ll-scores-list"); list.replaceChildren();
    const order = go.players.slice().sort(function (a, b) { return b.total - a.total; });
    const tie = order.length > 1 && order[1].total === order[0].total;                  // a tie: no crown for anyone
    order.forEach(function (p, i) { row(list, (final && i === 0 && !tie ? "👑 " : "") + p.name, p.total.toLocaleString() + " m (" + p.metres.join(" + ") + ")"); });
    const who = go.players[go.turn], next = $("ll-scores-next");
    if (final) {
      $("ll-scores-eyebrow").textContent = "Final scores";
      $("ll-scores-title").textContent = tie ? "A tie! What a couch~" : order[0].name + " wins!";
      next.textContent = "Play again"; next.dataset.go = "couch-again";
      play("yay", 0.8);
    } else {
      const was = go.lastName, m = go.lastM;
      $("ll-scores-eyebrow").textContent = "Round " + go.round + " of " + C.SHOTS;
      $("ll-scores-title").textContent = was + " flew " + m.toLocaleString() + " m!";
      next.textContent = "Next up: " + who.name; next.dataset.go = "couch-next";
    }
    view = "scores"; show("ll-scores");
  }

  /* ---------------------------------------------------------------- a launch */
  function launch() { // Lumi into the cannon: a fresh launch on this go's course.
    s = R.newShot(go.seed); log = []; queue = []; fx = []; spin = 0;
    cam.k = baseK(); cam.x = aimX();
    view = "play"; show(null);
    const p = current();
    $("ll-who").textContent = p ? p.name + "'s turn" : "";
    $("ll-who").hidden = !p;
  }

  function landed() { // She has stopped: count it, then on to the next launch, the scores or the server.
    const m = R.metres(s);
    betweenAt = performance.now() + 900;
    if (go.kind === "solo") {
      go.logs.push(log); go.metres.push(m); go.n++;
      if (go.n >= C.SHOTS) { view = "finishing"; go.finishAt = performance.now() + 1400; return; }   // the frame loop sends it
      view = "between";
    } else {
      const p = current();
      p.metres.push(m); p.total += m;
      go.lastName = p.name; go.lastM = m;
      view = "between";
      go.nextAt = performance.now() + 1600;                  // the frame loop moves on (a pause just waits longer)
    }
  }

  function nextTurn() { // Couch turns: the next player, or the next round, or the end
    go.turn++;
    if (go.turn >= go.players.length) { go.turn = 0; go.round++; }
    scores(go.round > C.SHOTS);
  }

  function quit() { // End the go from the pause panel: a solo go still pays what's finished.
    if (go && go.kind === "solo") finishGo();
    else menu();
  }
  function pause() { if (view === "play" || view === "between") { before = view; view = "paused"; show("ll-pause"); $("ll-quit").textContent = go && go.kind === "couch" ? "Stop playing" : "End the go"; } }
  function resume() { if (view === "paused") { view = before; show(null); } }

  /* ---------------------------------------------------------------- input: every kind, one place */
  function input(action, who, controller) {
    M.sound.unlock();
    if (view === "play") {
      if (action === "play" || action === "back") { pause(); return; }
      if (!mayPress(who)) { toast("It's " + current().name + "'s turn!"); return; }
      if (action === "enter") queue.push("ok");
      else if (action === "up" || action === "right") queue.push("up");
      else if (action === "down" || action === "left") queue.push("down");
      return;
    }
    if (view === "between") {
      if (action === "play" || action === "back") pause();
      else if (action === "enter" && go.kind === "solo" && performance.now() >= betweenAt && mayPress(who)) launch();
      return;
    }
    if (view === "finishing") return;
    if (view === "paused" && action === "play") { resume(); return; }
    if (view === "couch" && action === "enter" && who !== "here" && !go.players.some(function (p) { return p.who === who; })) {
      join(who, controller); return;                       // a new remote or pad joins; a joined one presses buttons
    }
    if (action === "back") { if (view === "paused") resume(); else if (view === "menu") M.close(); else menu(); return; }
    if (action === "play" && view === "menu") { toggleSound(); return; }
    nav(action);
  }

  M.onAction(function (action, controller, remote) { // keys and every remote (common.js)
    input(action, remote !== undefined ? "remote:" + remote : "here", controller);
  }, { directEnter: function () { return view === "play" || view === "between"; } });
  if (PAD) PAD.start(function (action, who) { input(action, who); });   // gamepads, each its own player

  canvas.addEventListener("pointerdown", function (e) { // a tap or click on the course is OK
    if (view !== "play" && view !== "between") return;
    e.preventDefault(); input("enter", "here");
  });
  $("ll-touch").addEventListener("pointerdown", function (e) {
    const b = e.target.closest("[data-tap]");
    if (!b) return;
    e.preventDefault(); input(b.dataset.tap, "here");
  });
  stage.addEventListener("click", function (e) { // the panels' buttons
    const b = e.target.closest("button[data-go]");
    if (!b || b.disabled) return;
    M.sound.unlock();
    ({ solo: solo, couch: couch, board: board, sound: toggleSound, menu: menu, resume: resume, quit: quit,
       "couch-start": couchStart, "couch-next": launch, "couch-again": function () { const keep = go.players; couch(); go.players = keep.map(function (p) { return Object.assign(p, { metres: [], total: 0 }); }); renderCouch(); },
       "couch-here": function () { join("here:" + go.players.length); } })[b.dataset.go]();
  });
  function toggleSound() { $("ll-sound").textContent = "Sound: " + (M.sound.toggle() ? "on" : "off"); }
  $("ll-sound").textContent = "Sound: " + (M.sound.isOn() ? "on" : "off");
  window.addEventListener("blur", function () { if (view === "play") pause(); });

  /* ---------------------------------------------------------------- the frame loop */
  function tick() { // One rules step: the presses that came in land first, logged with the frame they landed on.
    queue.forEach(function (b) { log.push([s.t, b]); R.press(s, b); });
    queue = [];
    s.events.forEach(onEvent);
    R.step(s);
    s.events.forEach(onEvent);
    if (s.phase === "fly") {
      spin += s.vx / RU * 0.6;
      if (frameNo % 2 === 0 && Math.abs(s.vx) + Math.abs(s.vy) > 4) sparkle(s.x - s.vx, s.y + RU, 1, ["#ffe9f5", "#ff8ecb", "#ffdc83"]);
    }
    if (s.phase === "done") landed();
  }

  function onEvent(e) { // What the rules said just happened: sounds and sparkles.
    const x = s.x, y = s.y + RU;
    if (e.type === "nudge") tone(520, 0.04, 0, 0.12);
    else if (e.type === "lock") { tone(660, 0.08, 0, 0.18); play("rollup", 0.45); }
    else if (e.type === "fire") { play("pop", 0.9); tone(140, 0.25, 0, 0.3, "triangle", 60); sparkle(C.MUZZLE_X, C.MUZZLE_Y, 22, ["#ffdc83", "#ff8ecb", "#c9a8ff"]); }
    else if (e.type === "puff") { tone(880, 0.12, 0, 0.2, "triangle", 1320); sparkle(x, y, 16, ["#70ebea", "#ffe9f5", "#c9a8ff"]); }
    else if (e.type === "bounce") { if (Math.abs(s.vy) > 3) play("bounce", 0.45); dust(x, 6); }
    else if (e.type === "pillow") { play("bounce", 0.8); tone(400, 0.18, 0, 0.18, "sine", 800); sparkle(x, s.y, 10, ["#ffffff", "#ffd6ec"]); }
    else if (e.type === "teacup") { play("pop", 0.7); tone(700, 0.1, 0, 0.16); tone(1050, 0.12, 0.08, 0.16); sparkle(x, s.y, 12, ["#ffe9f5", "#c9a8ff"]); }
    else if (e.type === "yarn") { tone(300, 0.25, 0, 0.18, "sawtooth", 900); dust(x, 8); }
    else if (e.type === "wind") tone(260, 0.2, 0, 0.06, "sine", 380);
    else if (e.type === "stardust") { play("ding", 0.7); sparkle(x, y, 14, ["#ffdc83", "#fff1cd"]); }
    else if (e.type === "comet") { play("pop", 0.8); tone(500, 0.4, 0, 0.22, "triangle", 1800); sparkle(x, y, 26, ["#ffdc83", "#ff9d6b", "#ff8ecb"]); }
    else if (e.type === "stop") {
      if (e.why === "honey" || e.why === "nap") play("aww", 0.8);
      else if (info && go.kind === "solo" && e.m > info.best.shot) play("yay", 0.7);
      else { tone(523, 0.12, 0, 0.18); tone(784, 0.18, 0.1, 0.18); }
    }
  }

  function sparkle(x, y, n, colors) { // little stars flying out from a spot on the course
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 4;
      fx.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, life: 40 + Math.random() * 30, max: 70, c: colors[i % colors.length], star: true });
    }
  }
  function dust(x, n) { for (let i = 0; i < n; i++) fx.push({ x: x, y: 4, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3, life: 30, max: 30, c: "#e8d6f0", star: false }); }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(100, now - (last || now)); last = now;
    if (view === "play" || view === "between" || view === "finishing") {
      acc += dt;
      while (acc >= STEP) { acc -= STEP; frameNo++; if (view === "play") tick(); stepFx(); }
    } else acc = 0;
    if (view === "between" && go.kind === "couch" && now >= go.nextAt) nextTurn();
    if (view === "finishing" && go.finishAt && now >= go.finishAt) { go.finishAt = 0; finishGo(); }
    draw(now);
    hud();
  }
  function stepFx() { fx = fx.filter(function (p) { p.x += p.vx; p.y += p.vy; p.vy -= 0.08; p.vx *= 0.98; return --p.life > 0; }); if (fx.length > 400) fx.splice(0, fx.length - 400); }

  function hud() { // The numbers around the edges, and the line a remote shows.
    if (!s || view === "menu") return;
    const far = s.phase === "aim" || s.phase === "power" ? 0 : R.metres(s), p = current();   // 0 m until she's out of the cannon
    set("ll-far", far.toLocaleString() + " m");
    set("ll-puffs", "✦".repeat(s.puffs) + "✧".repeat(C.PUFFS - s.puffs));
    if (go.kind === "solo") {
      set("ll-shot-label", "Launch");
      set("ll-shot", Math.min(go.n + (view === "play" ? 1 : 0), C.SHOTS) + " / " + C.SHOTS);
      set("ll-total", (go.metres.reduce(function (a, b) { return a + b; }, 0) + (view === "play" ? far : 0)).toLocaleString() + " m");
      set("ll-best", ((info && info.best.shot) || 0).toLocaleString() + " m");
    } else if (p) {
      set("ll-shot-label", "Round");
      set("ll-shot", Math.min(go.round, C.SHOTS) + " / " + C.SHOTS);
      set("ll-total", (p.total + (view === "play" ? far : 0)).toLocaleString() + " m");
      set("ll-best", Math.max.apply(null, go.players.map(function (q) { return Math.max(0, ...q.metres); })).toLocaleString() + " m");
    }
    let hint = "";
    if (view === "play") hint = s.phase === "aim" ? "OK locks the angle · ▲ ▼ nudge it" : s.phase === "power" ? "OK fires!" :
      s.puffs ? "OK: sparkle puff (" + s.puffs + " left)" : "";
    else if (view === "between" && go.kind === "solo") hint = far.toLocaleString() + " m! OK for launch " + (go.n + 1) + " of " + C.SHOTS;
    else if (view === "between") hint = far.toLocaleString() + " m!";
    else if (view === "finishing") hint = far.toLocaleString() + " m! Counting it up~";
    set("ll-hint", hint);
    $("ll-hint").hidden = !hint || stage.dataset.menu === "true";
    if (view === "play" || view === "between") report((p ? p.name + " · " : "") + "Launch · " + far.toLocaleString() + " m");
  }
  function set(id, text) { const e = $(id); if (e.textContent !== text) e.textContent = text; }

  /* ---------------------------------------------------------------- the view */
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(cw * dpr)); canvas.height = Math.max(1, Math.round(ch * dpr));
  }
  function ground() { return ch * 0.8; }                     // the ground line, on screen
  function baseK() { return Math.max(0.3, Math.min(ch / 760, cw / (cw < ch ? 600 : 1000))); }   // px per course unit when she's low (a phone held upright sees less course, bigger)
  function aimX() { return -cw * 0.1 / cam.k; }              // the cannon a little in from the left
  function sx(x) { return (x - cam.x) * cam.k; }
  function sy(y) { return ground() - y * cam.k; }

  function follow() { // Ease the camera after her; zoom out when she flies high.
    let kt = baseK(), xt;
    if (s && (s.phase === "fly" || s.phase === "done")) {
      kt = Math.min(baseK(), (ground() - 140) / Math.max(1, s.y + 2 * RU + 120));   // room above her for the HUD
      xt = s.x - cw * 0.36 / cam.k;
      if (s.x < cw * 0.36 / cam.k - cw * 0.1 / cam.k) xt = aimX();
    } else xt = aimX();
    const ease = G_reduced ? 1 : 0.1;
    cam.k += (Math.max(0.12, kt) - cam.k) * ease;
    cam.x += (xt - cam.x) * (G_reduced ? 1 : 0.14);
  }
  const G_reduced = M.reducedMotion;

  const STARS = Array.from({ length: 70 }, function (_, i) { return { x: (i * 397) % 1000 / 1000, y: (i * 233) % 620 / 1000, r: 1 + (i % 3), p: i * 0.7 }; });
  function four(x, y, r) { // a four-pointed sparkle, as Lumi Pet draws them
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill();
  }

  function sky(t) { // Lumi's starry night, the moon and two rows of hills drifting slower than the course
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, "#120820"); g.addColorStop(0.55, "#2a1240"); g.addColorStop(1, "#4a1c52");
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#fff8dc";
    STARS.forEach(function (st) {
      const x = ((st.x * cw * 1.4 - cam.x * cam.k * 0.03) % (cw * 1.4) + cw * 1.4) % (cw * 1.4) - cw * 0.2;
      ctx.globalAlpha = 0.3 + 0.4 * (G_reduced ? 0.5 : (Math.sin(t / 800 + st.p) + 1) / 2);
      four(x, st.y * ch, st.r * 1.6);
    });
    ctx.globalAlpha = 1;
    ctx.save(); ctx.shadowColor = "#fff1cd"; ctx.shadowBlur = 30; ctx.fillStyle = "#fff1cd";   // her moon
    ctx.beginPath(); ctx.arc(cw * 0.82, ch * 0.16, Math.min(cw, ch) * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    hills(0.12, ch * 0.62, 70, "#3a1a4e", 260);
    hills(0.3, ch * 0.7, 46, "#4f2463", 170, true);
  }
  function hills(par, base, high, color, wave, houses) {
    const shift = cam.x * cam.k * par;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, ch);
    for (let px = 0; px <= cw + 8; px += 8) ctx.lineTo(px, base - high * (0.6 + 0.4 * Math.sin((px + shift) / wave)) - high * 0.3 * Math.sin((px + shift) / (wave * 0.37)));
    ctx.lineTo(cw, ch); ctx.fill();
    if (!houses) return;
    for (let n = Math.floor(shift / 340) - 1; n < (shift + cw) / 340 + 1; n++) {   // little Lumi Town cottages with a lit window
      const px = n * 340 - shift + 120, top = base - high * (0.6 + 0.4 * Math.sin((px + shift) / wave)) - high * 0.3 * Math.sin((px + shift) / (wave * 0.37));
      ctx.fillStyle = color; ctx.fillRect(px - 16, top - 20, 32, 26);
      ctx.beginPath(); ctx.moveTo(px - 22, top - 18); ctx.lineTo(px, top - 38); ctx.lineTo(px + 22, top - 18); ctx.fill();
      ctx.fillStyle = "#ffdc83"; ctx.globalAlpha = 0.75; ctx.fillRect(px - 5, top - 12, 10, 9); ctx.globalAlpha = 1;
    }
  }

  function field() { // The ground, the distance signs and the best-launch flag
    const gy = ground();
    const g = ctx.createLinearGradient(0, gy, 0, ch);
    g.addColorStop(0, "#7c4f8f"); g.addColorStop(0.08, "#5c3570"); g.addColorStop(1, "#2a1238");
    ctx.fillStyle = g; ctx.fillRect(0, gy, cw, ch - gy);
    ctx.fillStyle = "#c9a8ff"; ctx.fillRect(0, gy, cw, 3);
    const k = cam.k, left = cam.x, right = cam.x + cw / k;
    ctx.font = "700 " + Math.max(11, Math.round(14 * k / baseK())) + "px " + M.colors().font; ctx.textAlign = "center";
    for (let m = Math.max(50, Math.ceil(left / C.UNIT / 50) * 50); m * C.UNIT < right + 200; m += 50) {   // a sign every 50 m
      const x = sx(m * C.UNIT), big = m % 250 === 0;
      ctx.fillStyle = "#3a1a4e"; ctx.fillRect(x - 2, gy - 34 * k, 4, 34 * k);
      ctx.fillStyle = big ? "#ffdc83" : "#ffe9f5"; ctx.fillRect(x - 24 * k, gy - 50 * k, 48 * k, 20 * k);
      ctx.fillStyle = "#462846"; ctx.fillText(m + " m", x, gy - 35 * k);
    }
    const best = go && go.kind === "solo" && info ? info.best.shot : 0;
    if (best > 0) {                                          // her best launch, a pink flag
      const x = sx(best * C.UNIT);
      if (x > -40 && x < cw + 40) {
        ctx.fillStyle = "#ffe9f5"; ctx.fillRect(x - 1.5, gy - 80 * k, 3, 80 * k);
        ctx.fillStyle = "#ff8ecb"; ctx.beginPath(); ctx.moveTo(x + 1.5, gy - 80 * k); ctx.lineTo(x + 34 * k, gy - 70 * k); ctx.lineTo(x + 1.5, gy - 60 * k); ctx.fill();
        ctx.fillStyle = "#ffe9f5"; ctx.fillText("best", x + 16 * k, gy - 86 * k);
      }
    }
  }

  function pieces(t) { // The course pieces in view
    if (!go) return;
    const first = Math.floor((cam.x - C.START) / C.SLOT) - 1, lastSlot = Math.floor((cam.x + cw / cam.k - C.START) / C.SLOT) + 1;
    for (let i = Math.max(0, first); i <= lastSlot; i++) {
      const p = R.piece(go.seed, i);
      if (p) art(p, !!(s && s.used[i]), t);
    }
  }

  function art(p, used, t) { // One piece, drawn in course units around its spot
    const k = cam.k, x = sx(p.x), w = p.w * k, gy = ground();
    ctx.save();
    if (p.kind === "pillow") {                                // a puffy cloud cushion
      ctx.fillStyle = "#fff5fb"; ctx.shadowColor = "#ff8ecb"; ctx.shadowBlur = 12;
      const h = p.h * k;
      ctx.beginPath(); ctx.ellipse(x + w * 0.5, gy - h * 0.45, w * 0.5, h * 0.55, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.25, gy - h * 0.7, w * 0.22, h * 0.4, 0, 0, Math.PI * 2); ctx.ellipse(x + w * 0.7, gy - h * 0.75, w * 0.25, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = "#ff8ecb"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w * 0.2, gy - h * 0.35); ctx.quadraticCurveTo(x + w * 0.5, gy - h * 0.15, x + w * 0.8, gy - h * 0.35); ctx.stroke();
    } else if (p.kind === "teacup") {                         // a pastel teacup on its saucer (tipped once it's thrown her)
      const h = p.h * k;
      ctx.translate(x + w / 2, gy);
      if (used) ctx.rotate(0.5);
      ctx.fillStyle = "#c9a8ff"; ctx.beginPath(); ctx.ellipse(0, -3 * k, w * 0.65, 6 * k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffe9f5"; ctx.beginPath(); ctx.moveTo(-w / 2, -h); ctx.lineTo(w / 2, -h); ctx.quadraticCurveTo(w * 0.45, -6 * k, 0, -6 * k); ctx.quadraticCurveTo(-w * 0.45, -6 * k, -w / 2, -h); ctx.fill();
      ctx.strokeStyle = "#ffe9f5"; ctx.lineWidth = 5 * k; ctx.beginPath(); ctx.arc(w / 2, -h * 0.6, h * 0.22, -1.2, 1.2); ctx.stroke();
      ctx.fillStyle = "#ff8ecb"; ctx.fillRect(-w / 2, -h, w, 6 * k);
    } else if (p.kind === "yarn") {                           // a ball of yarn (unrolled once she's ridden it)
      const r = p.h * k * 0.6;
      ctx.fillStyle = "#ff8ecb";
      if (used) { ctx.fillRect(x, gy - 3 * k, w * 1.6, 3 * k); }
      else {
        ctx.beginPath(); ctx.arc(x + w * 0.5, gy - r, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#b8569f"; ctx.lineWidth = 1.5;
        for (let n = -1; n <= 1; n++) { ctx.beginPath(); ctx.arc(x + w * 0.5 + n * r * 0.3, gy - r, r * 0.8, -1 + n, 1 + n); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(x + w * 0.5 + r, gy - 2); ctx.quadraticCurveTo(x + w, gy, x + w * 1.1, gy - 2); ctx.stroke();
      }
    } else if (p.kind === "wind") {                           // a Wish Wind: a soft aqua column with swirls rising
      const h = p.h * k, g = ctx.createLinearGradient(0, gy, 0, gy - h);
      g.addColorStop(0, "rgba(112,235,234,0.28)"); g.addColorStop(1, "rgba(112,235,234,0)");
      ctx.fillStyle = g; ctx.fillRect(x, gy - h, w, h);
      ctx.strokeStyle = "rgba(210,252,246,0.6)"; ctx.lineWidth = 2;
      for (let n = 0; n < 4; n++) {
        const yy = gy - ((t / (G_reduced ? 1e9 : 6) + n * h / 4) % h);
        ctx.beginPath(); ctx.arc(x + w * (0.3 + 0.13 * n), yy, 8 * k, 0, Math.PI * 1.5); ctx.stroke();
      }
    } else if (p.kind === "stardust" && !used) {              // floating stardust, twinkling
      ctx.fillStyle = "#ffdc83"; ctx.shadowColor = "#ffdc83"; ctx.shadowBlur = 16;
      four(x + w / 2, sy(p.y + p.h / 2), (18 + 4 * Math.sin(t / 200)) * k);
      ctx.fillStyle = "#fff1cd"; four(x + w / 2 + 14 * k, sy(p.y + p.h / 2) - 12 * k, 6 * k);
    } else if (p.kind === "comet" && !used) {                 // a little comet waiting to be ridden
      const cy = sy(p.y + p.h / 2), cx = x + w / 2;
      const g = ctx.createLinearGradient(cx - 70 * k, cy, cx, cy); g.addColorStop(0, "rgba(255,157,107,0)"); g.addColorStop(1, "rgba(255,220,131,0.9)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - 70 * k, cy - 4 * k); ctx.lineTo(cx, cy - 14 * k); ctx.lineTo(cx, cy + 14 * k); ctx.lineTo(cx - 70 * k, cy + 4 * k); ctx.fill();
      ctx.fillStyle = "#fff1cd"; ctx.shadowColor = "#ff9d6b"; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(cx, cy, 15 * k, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === "honey") {                          // a honey puddle and its tipped pot
      ctx.fillStyle = "#ffb347"; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(x + w / 2, gy - 2 * k, w / 2, 9 * k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = "#e08e2b"; ctx.beginPath(); ctx.ellipse(x + w * 0.15, gy - 14 * k, 14 * k, 12 * k, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff1cd"; ctx.font = "700 " + Math.round(10 * k) + "px sans-serif"; ctx.textAlign = "center"; ctx.fillText("HONEY", x + w * 0.15, gy - 11 * k);
    } else if (p.kind === "nap") {                            // a nap mat with a sleepy moon
      ctx.fillStyle = "#8f9bff"; ctx.fillRect(x, gy - p.h * k, w, p.h * k);
      ctx.fillStyle = "#d9dcf7"; ctx.fillRect(x, gy - p.h * k, w, 3 * k);
      ctx.fillStyle = "#fff1cd"; ctx.beginPath(); ctx.arc(x + w * 0.8, gy - 34 * k, 12 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8f9bff"; ctx.beginPath(); ctx.arc(x + w * 0.8 + 6 * k, gy - 38 * k, 11 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d9dcf7"; ctx.font = "700 " + Math.round(14 * k) + "px sans-serif"; ctx.fillText("z", x + w * 0.4, gy - 22 * k - 4 * Math.sin(t / 400) * k);
    }
    ctx.restore();
  }

  function cannon() { // Her star cannon at the start, the needle's arc while aiming, and the power bar
    const k = cam.k, bx = sx(0), by = ground(), aim = s ? (C.AIM_LOW + s.aim) * Math.PI / 180 : Math.PI / 4;
    ctx.save();
    ctx.translate(sx(C.MUZZLE_X * 0.35), sy(28)); ctx.rotate(-aim);           // the barrel, lilac with gold stars
    ctx.fillStyle = "#c9a8ff"; ctx.strokeStyle = "#7a55c0"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-10 * k, -18 * k, 92 * k, 36 * k, 12 * k) : ctx.rect(-10 * k, -18 * k, 92 * k, 36 * k); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffdc83"; four(26 * k, 0, 9 * k); four(54 * k, -6 * k, 5 * k);
    ctx.fillStyle = "#ff8ecb"; ctx.fillRect(76 * k, -20 * k, 10 * k, 40 * k);
    ctx.restore();
    ctx.fillStyle = "#ff8ecb"; ctx.beginPath(); ctx.arc(bx + 18 * k, by - 18 * k, 18 * k, 0, Math.PI * 2); ctx.fill();   // the wheel
    ctx.fillStyle = "#ffe9f5"; ctx.beginPath(); ctx.arc(bx + 18 * k, by - 18 * k, 6 * k, 0, Math.PI * 2); ctx.fill();
    if (!s) return;
    if (s.phase === "aim") {                                   // the needle's arc, 15° to 75°
      const cx = sx(C.MUZZLE_X * 0.35), cy = sy(28), r = 150 * k;
      ctx.strokeStyle = "rgba(255,233,245,0.35)"; ctx.lineWidth = 3; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, r, -75 * Math.PI / 180, -15 * Math.PI / 180); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = "#ffdc83"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(aim) * r, cy - Math.sin(aim) * r); ctx.stroke();
      ctx.fillStyle = "#ffe9f5"; ctx.font = "700 " + Math.round(18 * Math.max(1, k)) + "px " + M.colors().font; ctx.textAlign = "left";
      ctx.fillText((C.AIM_LOW + s.aim) + "°", cx + Math.cos(aim) * (r + 10), cy - Math.sin(aim) * (r + 10));
    }
    if (s.phase === "power") {                                 // the power bar beside the cannon
      const x = bx + 120 * k, top = by - 190 * k, h = 160 * k, wbar = 22 * k, f = s.power / 100;
      ctx.fillStyle = "rgba(14,11,26,0.75)"; ctx.fillRect(x, top, wbar, h);
      const g = ctx.createLinearGradient(0, top + h, 0, top); g.addColorStop(0, "#70ebea"); g.addColorStop(0.6, "#ffdc83"); g.addColorStop(1, "#ff8ecb");
      ctx.fillStyle = g; ctx.fillRect(x, top + h * (1 - f), wbar, h * f);
      ctx.strokeStyle = "#ffe9f5"; ctx.lineWidth = 2; ctx.strokeRect(x, top, wbar, h);
    }
  }

  function lumi(t) { // Her: peeking from the barrel, a spinning ball in flight, or sitting where she stopped
    if (!s || !L) return;
    const look = current() ? current().look : L.own(M.api), k = cam.k;
    if (s.phase === "aim" || s.phase === "power") {
      const aim = (C.AIM_LOW + s.aim) * Math.PI / 180, cx = sx(C.MUZZLE_X * 0.35) + Math.cos(aim) * 70 * k, cy = sy(28) - Math.sin(aim) * 70 * k;
      L.ball(ctx, look, cx, cy, RU * k, -aim + Math.PI / 2, 0.2);
      return;
    }
    const x = sx(s.x), y = sy(s.y + RU);
    if (s.phase === "fly") { L.ball(ctx, look, x, y, RU * k, spin, Math.min(1, (Math.abs(s.vx) + Math.abs(s.vy)) / 30)); return; }
    const h = 70 * k;                                          // she's stopped: sitting up, or asleep, or stuck
    if (s.end === "nap") {
      L.draw(ctx, look, x, sy(0), h, { eyes: "closed", squash: 0.85 });
      ctx.fillStyle = "#d9dcf7"; ctx.font = "700 " + Math.round(20 * k) + "px sans-serif"; ctx.textAlign = "left";
      ctx.fillText("z z", x + 20 * k, sy(0) - h - 6 * k - 6 * Math.sin(t / 400) * k);
    } else if (s.end === "honey") {
      L.draw(ctx, look, x, sy(0), h, { eyes: "closed", squash: 0.75, tilt: 0.1 });
      ctx.fillStyle = "#ffb347"; ctx.globalAlpha = 0.85; ctx.fillRect(x - 18 * k, sy(0) - 12 * k, 36 * k, 12 * k); ctx.globalAlpha = 1;
    } else L.draw(ctx, look, x, sy(0), h, { eyes: "happy" });
  }

  function effects() { // the sparkles and dust
    fx.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.c;
      if (p.star) four(sx(p.x), sy(p.y), 5 * cam.k); else { ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 4 * cam.k, 0, Math.PI * 2); ctx.fill(); }
    });
    ctx.globalAlpha = 1;
  }

  function idle(t) { // Behind the menus: Lumi bobbing in her cannon, the course stretching away
    ctx.save(); ctx.globalAlpha = 0.9;
    const look = L ? L.own(M.api) : null, k = cam.k;
    if (L) L.ball(ctx, look, sx(C.MUZZLE_X * 0.35) + 50 * k, sy(28) - 50 * k - (G_reduced ? 0 : Math.sin(t / 500) * 4 * k), RU * k, -Math.PI / 4 + Math.PI / 2, 0.2);
    ctx.restore();
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    follow();
    sky(t);
    field();
    pieces(t);
    cannon();
    if (s && (view !== "menu" && view !== "board" && view !== "couch")) lumi(t); else idle(t);
    effects();
  }

  /* ---------------------------------------------------------------- start */
  // A read-only peek for the Chrome checks (tests/lumi-launch-browser.mjs): what's showing and the launch in play.
  window.LumiLaunchGame = { view: function () { return view; }, shot: function () { return s; }, go: function () { return go; } };
  window.addEventListener("resize", resize);
  resize();
  cam.k = baseK(); cam.x = aimX();
  menu();
  requestAnimationFrame(frame);
})();
