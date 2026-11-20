/* Lumi-Soft in the browser: the menus, the mouse and keys, the Star Scope (zoom, dead-zone pan and sway, ported from
   Doll's GameMaker prototype: objSniperController and objCrosshair), the frame loop that runs rules.js 60 steps a
   second, the drawing (art.js) and the talk with the server (mnemerynne/lumisoft.py), which replays the run's log
   before it pays. Everything that changes on screen as text is set with textContent. */
(function () {
  "use strict";

  const M = window.MGame, R = window.LumiSoftRules, A = window.LumiSoftArt, L = window.LumiSprite;
  const $ = id => document.getElementById(id);
  const stage = $("ls-stage"), canvas = $("ls-view"), ctx = canvas.getContext("2d");
  const W = R.C.W, H = R.C.H, STEP = 1000 / 60, BASE = window.LUMI_API + "lumi-soft";
  const SOUNDS = JSON.parse(stage.dataset.sounds);

  /* ---------------------------------------------------------------- settings (this device) */
  const settings = Object.assign({ scope: "hold", pan: 1, dead: 1, reticle: "heart", volume: 0.8 }, M.store.get("settings", {}));
  function saveSettings() { M.store.set("settings", settings); }

  /* ---------------------------------------------------------------- state */
  let info = null;                         // the title screen's data (GET /state): stages, prices, bests, prizes, today's Daily Range
  let mode = "loading";                    // loading, menu, play, paused, over, finishing, results
  let run = null;                          // {ticket, kind, stageId, s (rules state), log, nextContinue}
  let look = L ? L.own(M.api) : null;      // this player's Lumi (glow and outfit), for her cushion and her paws
  const mouse = { x: 0, y: 0 }, keys = { shift: false };
  const cam = { x: 0, y: 0, w: W, h: H }; // the scene rectangle the Star Scope shows
  const anchor = { x: 0, y: 0 };          // the middle of the scope's still zone: where the mouse was when it opened
  let scoped = false, swayT = 0, breath = 1, puffing = false, glowOn = false, battery = 1, kick = 0;
  let cw = 0, ch = 0, dpr = 1, fit = { s: 1, ox: 0, oy: 0 }, last = 0, acc = 0, frameNo = 0;
  let effects = [], texts = [], drops = [], said = { at: 0 }, warned = new Set(), lowSaid = false, reported = "";
  let overTimer = null;

  /* ---------------------------------------------------------------- sound: Doll's own sample pack */
  const audio = {};
  function loadSounds() {
    Object.entries(SOUNDS).forEach(function ([name, files]) {
      audio[name] = (Array.isArray(files) ? files : [files]).map(function (file) { const a = new Audio(file); a.preload = "auto"; return a; });
    });
  }
  function play(name, volume) { // A sample, if sound is on; a busy one is cloned so quick pops can overlap.
    if (!M.sound.isOn() || document.hidden || !audio[name]) return;
    const pool = audio[name], base = pool[Math.floor(Math.random() * pool.length)];
    const a = base.paused || base.ended ? base : base.cloneNode();
    a.volume = Math.max(0, Math.min(1, (volume === undefined ? 0.8 : volume) * settings.volume));
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    a.play().catch(function () { /* the browser wants a click first */ });
  }

  /* ---------------------------------------------------------------- sizes and views */
  function resize() { // The canvas in device pixels, and how the whole scene fits the screen (the wide view).
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(cw * dpr)); canvas.height = Math.max(1, Math.round(ch * dpr));
    const s = Math.min(cw / W, ch / H);
    fit = { s: s, ox: (cw - W * s) / 2, oy: (ch - H * s) / 2 };
    if (scoped) sizeScope();
  }
  function stageDef() { return run ? R.stageOf(run.s) : null; }
  function zoom() { return (stageDef() || {}).zoom || 2.5; }
  function sizeScope() { cam.w = W / zoom(); cam.h = cam.w * ch / cw; clampCam(); }   // the prototype's view: the room divided by the zoom
  function clampCam() { cam.x = Math.max(0, Math.min(W - cam.w, cam.x)); cam.y = Math.max(0, Math.min(H - cam.h, cam.y)); }
  function perPx() { return cam.w / cw; }                                              // scene units per screen pixel, in the scope
  function wideAim() { return { x: (mouse.x - fit.ox) / fit.s, y: (mouse.y - fit.oy) / fit.s }; }
  function openScope() { // Keep the aim where it was: the scope opens with the crosshair under the mouse.
    if (scoped || mode !== "play") return;
    const at = wideAim();
    scoped = true; sizeScope();
    cam.x = at.x - mouse.x * perPx(); cam.y = at.y - mouse.y * perPx(); clampCam();
    anchor.x = mouse.x; anchor.y = mouse.y;                                            // no drift until the mouse is pushed further out
  }
  function closeScope() { scoped = false; }
  function sway() { // The scope's wobble: steadier holding your breath, worse when you're puffing (client only; the server checks where a shot lands).
    const calm = M.reducedMotion ? 0.4 : 1, a = 7 * calm * (keys.shift && !puffing && breath > 0 ? 0.25 : puffing ? 1.8 : 1);
    return { x: Math.sin(swayT) * a + Math.sin(swayT * 2.3) * a * 0.3, y: Math.cos(swayT * 0.71) * a * 0.7 };
  }
  function aim() { // Where a pop would land now, in scene units (before the wind).
    if (!scoped) return wideAim();
    const w = sway();
    return { x: Math.max(0, Math.min(W, cam.x + mouse.x * perPx() + w.x)), y: Math.max(0, Math.min(H, cam.y + mouse.y * perPx() + w.y)) };
  }
  function pan() { // objCrosshair's dead zone: the scope drifts when the mouse leaves the still zone (140 px of a 1366 screen).
    // The prototype centred the zone on the screen; here it's centred where the scope opened, so opening it off to one
    // side doesn't start a drift by itself.
    const dead = 140 * (cw / 1366) * settings.dead, cx = anchor.x, cy = anchor.y, speed = 0.12 * settings.pan * perPx();
    let mx = 0, my = 0;
    if (mouse.x > cx + dead) mx = mouse.x - (cx + dead); else if (mouse.x < cx - dead) mx = mouse.x - (cx - dead);
    if (mouse.y > cy + dead) my = mouse.y - (cy + dead); else if (mouse.y < cy - dead) my = mouse.y - (cy - dead);
    cam.x += mx * speed; cam.y += my * speed; clampCam();
  }

  /* ---------------------------------------------------------------- Spotter Lumi */
  const LINES = {
    training: ["Welcome to the range~ Hold the right button for your Star Scope!", "Hold Shift to hold your breath: the scope goes steady."],
    garden: ["Stardust Garden! Bunnies behind the hedges, eyes open~", "It's the Moss Golem! Pop the glowing flowers on his back!"],
    tower: ["Teacup Tower! Wind's up here: aim a little into it~", "Storm Kite incoming! Hit the bullseyes on her ribbons!"],
    lounge: ["Lumi's Lounge! The patrons with ♡ signs are friends~", "The Bell Phantom! Watch the chandeliers!"],
    dungeon: ["It's so dark down here... press G for the Glow Scope!", "Clockwork Owl! Pop the gears when she blinks!"],
    fair: ["The Night Fair! Everything's moving, so lead your shots~", "Comet Drake on a parade float! Give it everything!"],
  };
  function say(text, ms) { // A line in Spotter Lumi's bubble; a newer line replaces it.
    $("ls-spotter").hidden = false; $("ls-spotter-text").textContent = text;
    said.at = performance.now() + (ms || 3800);
  }
  function toast(text, ms) { const t = $("ls-toast"); t.textContent = text; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, ms || 1600); }

  /* ---------------------------------------------------------------- the frame loop */
  function tick() { // One rules step, with the scope, breath and glow around it.
    const s = run.s;
    swayT += 0.035;
    if (scoped) pan();
    if (keys.shift && !puffing) { breath -= 1 / 180; if (breath <= 0) { breath = 0; puffing = true; } }   // about three seconds of breath
    else { breath = Math.min(1, breath + (puffing ? 1 / 240 : 1 / 120)); if (puffing && breath >= 0.4) puffing = false; }
    if (glowOn) { battery -= 1 / 480; if (battery <= 0) { battery = 0; glowOn = false; } } else battery = Math.min(1, battery + 1 / 600);
    kick = Math.max(0, kick - 0.08);
    R.step(s);
    s.events.forEach(onEvent);
    watch(s);
    if (s.over) gameOver();
    else if (s.done) finishRun();
  }
  function onEvent(e) { // What the rules said just happened.
    const st = stageDef();
    if (e.kind === "segment") {
      const name = st.name + (e.scene < 0 ? " · Boss" : st.training ? "" : " · Scene " + (e.scene + 1));
      toast(name, 1800); glowOn = false;
      const lines = LINES[e.stage] || [];
      if (lines.length) say(e.scene < 0 ? lines[1] || lines[0] : lines[0]);
      if (e.scene <= 0) play("rollup", 0.5);
    } else if (e.kind === "splash") {
      play("aww"); say(["Eep! Shake it off~", "Splash! Pop them before they throw!", "Ack, wet fur! Keep going~"][run.s.lost % 3], 2600);
      drops = Array.from({ length: 26 }, function (_, i) { return { x: (i * 137) % 100 / 100, y: ((i * 71) % 60) / 100, v: 0.002 + (i % 5) * 0.0012, r: 6 + (i % 4) * 4 }; });
      drops.at = performance.now();
    } else if (e.kind === "scene") { toast("Scene clear! +15 s", 1600); play("ding", 0.5); }
    else if (e.kind === "stage" && e.rank) { toast(st.name + " clear! Rank " + e.rank, 2600); play("yay"); }
    else if (e.kind === "boss") { say("You did it! Down it goes~", 2600); }
  }
  function watch(s) { // Spotter Lumi keeps an eye out: a balloon about to fly, a friend, the clock.
    s.targets.forEach(function (tg) {
      const d = tg.def;
      if (d.wind && tg.wind > d.wind * 0.55 && !warned.has(tg.id)) { warned.add(tg.id); say(side(tg) + ": water balloon! Pop it quick!", 2400); }
      if (d.kind === "friend" && !warned.has("f" + tg.id) && R.pose(d, tg.age).ok) { warned.add("f" + tg.id); say("That one's holding a ♡: a friend! Don't pop her~", 2600); }
    });
    if (s.boss && s.boss.def.wind && s.boss.wind > s.boss.def.wind * 0.6 && !warned.has("b" + s.boss.hp)) { warned.add("b" + s.boss.hp); say("It's winding up! Hit a glowing spot to stop it!", 2200); }
    if (!stageDef().training && s.clock < 600 && !lowSaid) { lowSaid = true; say("Ten seconds! Pops add time~", 2400); }
    if (s.clock >= 900) lowSaid = false;
  }
  function side(tg) { const x = R.pose(tg.def, tg.age).x; return x < W / 3 ? "Left" : x > W * 2 / 3 ? "Right" : "Middle"; }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(250, now - (last || now)); last = now; frameNo += 1;
    if (mode === "play") {
      try { acc += dt; while (acc >= STEP && mode === "play") { tick(); acc -= STEP; } }
      catch (e) { console.error(e); acc = 0; if (run) finishRun(); }   // never freeze: a broken frame ends the run, and the server still counts it
    } else acc = 0;
    if (said.at && now > said.at) { $("ls-spotter").hidden = true; said.at = 0; }
    try { draw(now); hud(); } catch (e) { console.error(e); }               // a drawing slip never stops the loop
  }

  /* ---------------------------------------------------------------- drawing */
  const backs = {};
  function backdrop(sky) { // Each backdrop drawn once into its own canvas, then reused every frame.
    if (!backs[sky]) { const c = document.createElement("canvas"); c.width = W; c.height = H; A.backdrop(c.getContext("2d"), sky); backs[sky] = c; }
    return backs[sky];
  }
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#140a24"; ctx.fillRect(0, 0, cw, ch);
    const s = run && run.s, st = s ? stageDef() : (info ? info.stages.stages[0] : null), sky = st ? st.sky : "range";
    ctx.save();
    if (scoped && s) { const k = 1 / perPx(); ctx.scale(k, k); ctx.translate(-cam.x, -cam.y); }
    else { ctx.translate(fit.ox, fit.oy); ctx.scale(fit.s, fit.s); }
    ctx.drawImage(backdrop(sky), 0, 0, W, H);
    if (sky === "fireworks") A.fireworks(ctx, frameNo);
    if (s) world(s, st, now);
    ctx.restore();
    if (!s) return;
    if (st.dark) darkness(s);
    lens(now);
    overlays(now, s);
  }
  function world(s, st, now) { // Props and targets far to near; a pop-up sits behind the cover on its own line.
    const sc = R.scene(s), items = [];
    ((sc && sc.props) || []).forEach(function (p) { items.push({ y: p.y, o: 1, f: function () { A.prop(ctx, p); } }); });
    s.targets.forEach(function (tg) {
      const d = tg.def, p = R.pose(d, tg.age);
      items.push({ y: p.y, o: 0, f: function () { target(d, p, tg); } });
    });
    effects.forEach(function (e) { items.push({ y: e.y, o: 0, f: function () { A.standee(ctx, e.look, e.kind, e.x, e.y, e.s, e.v, { pop: Math.min(1, (now - e.at) / 350) }); } }); });
    items.sort(function (a, b) { return a.y - b.y || a.o - b.o; }).forEach(function (it) { it.f(); });
    if (s.boss) bossDraw(s.boss, now);
    confetti(now);
  }
  function target(d, p, tg) {
    if (d.kind === "pickup") { A.pickup(ctx, d.look, p.x, p.y, d.s || 1, frameNo); return; }
    A.standee(ctx, d.look, d.kind, p.x, p.y, d.s || 1, (d.move || {}).type === "pop" ? p.v : 1, { wind: d.wind ? tg.wind / d.wind : 0 });
    if (d.wind && tg.wind > 0) { // the wind-up's ring: when it closes, the balloon flies
      const f = tg.wind / d.wind;
      ctx.save(); ctx.lineWidth = 6; ctx.strokeStyle = f > 0.7 ? "#ff6f8f" : "#70ebea"; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(p.x, p.top + p.h * 0.45, p.h * 0.7, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }
  function bossDraw(b, now) {
    const d = b.def, p = R.pose(d, b.age), sc = d.s || 1;
    A.boss(ctx, d.look, p.x, p.y, d.w, d.h, sc, b.hurtUntil && now < b.hurtUntil ? (b.hurtUntil - now) / 250 : 0);
    (d.spots || []).forEach(function (sp) { A.spot(ctx, p.x + sp.dx * sc, p.y + sp.dy * sc, sp.r * sc, (b.age + (sp.phase || 0)) % (sp.on + sp.off) < sp.on, frameNo); });
    if (d.wind) { const f = b.wind / d.wind; ctx.save(); ctx.lineWidth = 10; ctx.strokeStyle = f > 0.7 ? "#ff6f8f" : "#70ebea"; ctx.beginPath(); ctx.arc(p.x, p.y - d.h * sc - 70, 44, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke(); ctx.restore(); }
  }
  function confetti(now) { // Each pop bursts into paper confetti (decoration only).
    effects = effects.filter(function (e) { return now - e.at < 900; });
    effects.forEach(function (e) {
      const k = (now - e.at) / 900;
      for (let i = 0; i < 16; i++) {
        const a = i * 0.39 + e.seed, r = 40 + 160 * k * (0.6 + (i % 3) * 0.2);
        ctx.globalAlpha = 1 - k; ctx.fillStyle = ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff", "#fff"][i % 5];
        ctx.fillRect(e.x + Math.cos(a) * r, e.y - e.h / 2 + Math.sin(a) * r + 120 * k * k, 12, 7);
      }
      ctx.globalAlpha = 1;
    });
  }
  function darkness(s) { // The Deep Dungeon: dark, unless the Glow Scope is on (then the creatures shine through).
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = glowOn ? "rgba(6,3,16,.35)" : "rgba(6,3,16,.68)"; ctx.fillRect(0, 0, cw, ch);
    if (glowOn) {
      if (scoped) { const k = 1 / perPx(); ctx.scale(k, k); ctx.translate(-cam.x, -cam.y); } else { ctx.translate(fit.ox, fit.oy); ctx.scale(fit.s, fit.s); }
      ctx.globalCompositeOperation = "lighter";
      s.targets.forEach(function (tg) { const p = R.pose(tg.def, tg.age); if (!p.ok) return; const g = ctx.createRadialGradient(p.x, p.top + p.h / 2, 5, p.x, p.top + p.h / 2, p.h); g.addColorStop(0, "rgba(201,168,255,.55)"); g.addColorStop(1, "rgba(201,168,255,0)"); ctx.fillStyle = g; ctx.fillRect(p.x - p.h, p.top - p.h / 2, p.h * 2, p.h * 2); });
      if (s.boss) { const p = R.pose(s.boss.def, s.boss.age); const g = ctx.createRadialGradient(p.x, p.y - 260, 10, p.x, p.y - 260, 420); g.addColorStop(0, "rgba(201,168,255,.4)"); g.addColorStop(1, "rgba(201,168,255,0)"); ctx.fillStyle = g; ctx.fillRect(p.x - 420, p.y - 680, 840, 840); }
    }
    ctx.restore();
  }
  function lens(now) { // The Star Scope's round view and its reticle; the wide view's soft aim ring; Lumi and her Popper.
    const pal = L ? L.palette(look) : { glow: "#ff8ecb", body: "#fce1f2", shadow: "#b8569f" };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (scoped) {
      const w = sway(), rx = mouse.x + w.x / perPx(), ry = mouse.y + w.y / perPx(), r = Math.min(cw, ch) * 0.5;
      const lx = Math.max(r * 0.75, Math.min(cw - r * 0.75, rx)), ly = Math.max(r * 0.75, Math.min(ch - r * 0.75, ry));   // the lens stays mostly on screen; the crosshair moves inside it
      const g = ctx.createRadialGradient(lx, ly, r * 0.82, lx, ly, r * 1.05);
      g.addColorStop(0, "rgba(10,4,20,0)"); g.addColorStop(1, "rgba(10,4,20,.92)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = "rgba(10,4,20,.92)"; ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.arc(lx, ly, r * 1.05, 0, Math.PI * 2, true); ctx.fill();
      ctx.strokeStyle = "#ff8ecb"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(lx, ly, r * 1.0, 0, Math.PI * 2); ctx.stroke();   // the scope's pink rim
      A.reticle(ctx, rx, ry, 34, settings.reticle, stageDef().dark ? "#fff5fb" : "#ff4f9e");
      A.popper(ctx, cw * 0.88, ch * 1.03, Math.min(cw, ch) * 0.26, pal, kick);   // the Popper's tip and Lumi's paws, bottom right
    } else if (mode === "play" || mode === "paused" || mode === "over") {
      ctx.strokeStyle = "rgba(255,245,251,.85)"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 30, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      A.reticle(ctx, mouse.x, mouse.y, 14, "dot", "#fff5fb");
      lumiOnCushion(pal);
    }
  }
  function lumiOnCushion(pal) { // In the wide view: your Lumi lying on her cushion at the front of the range, Popper at the ready.
    const x = cw * 0.5, y = ch - 8, hgt = Math.min(ch * 0.16, 150);
    ctx.fillStyle = "#ff8ecb"; ctx.beginPath(); ctx.ellipse(x, y - hgt * 0.06, hgt * 0.75, hgt * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffc4e1"; ctx.beginPath(); ctx.ellipse(x, y - hgt * 0.1, hgt * 0.66, hgt * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    if (L) L.draw(ctx, look, x, y - hgt * 0.1, hgt, { eyes: run && run.s.lost && drops.at && performance.now() - drops.at < 1600 ? "closed" : "open" });
    A.popper(ctx, x + hgt * 0.62, y + hgt * 0.1, hgt * 0.7, pal, kick);
  }
  function overlays(now, s) { // Screen-space extras: splash droplets, floating points, the radar and a boss's hearts.
    if (drops.at && now - drops.at < 1600) {
      const k = (now - drops.at) / 1600;
      drops.forEach(function (d) { ctx.globalAlpha = 0.75 * (1 - k); ctx.fillStyle = "#bdf3ff"; ctx.beginPath(); ctx.ellipse(d.x * cw, (d.y + d.v * (now - drops.at) / 16) * ch, d.r, d.r * 1.4, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.globalAlpha = 1;
    }
    texts = texts.filter(function (t) { return now - t.at < 900; });
    texts.forEach(function (t) {
      const k = (now - t.at) / 900, p = toScreen(t.x, t.y);
      ctx.globalAlpha = 1 - k; ctx.font = "700 " + (t.big ? 30 : 22) + "px " + M.colors().font; ctx.textAlign = "center";
      ctx.lineWidth = 5; ctx.strokeStyle = "#140a24"; ctx.strokeText(t.text, p.x, p.y - 40 * k); ctx.fillStyle = t.color; ctx.fillText(t.text, p.x, p.y - 40 * k);
      ctx.globalAlpha = 1;
    });
    radar(s);
    if (s.boss) { const n = s.boss.def.hp, x0 = cw / 2 - n * 12; for (let i = 0; i < n; i++) { A.heart(ctx, x0 + i * 24 + 12, 58, 9); ctx.fillStyle = i < s.boss.hp ? "#ff8ecb" : "#ffffff33"; ctx.fill(); } }
  }
  function toScreen(x, y) { return scoped ? { x: (x - cam.x) / perPx(), y: (y - cam.y) / perPx() } : { x: fit.ox + x * fit.s, y: fit.oy + y * fit.s }; }
  function radar(s) { // A strip along the top: where everything is in the scene, and (scoped) where you're looking.
    const w = Math.min(cw * 0.42, 520), x0 = cw / 2 - w / 2, y0 = 14, hgt = 22;
    ctx.fillStyle = "rgba(14,11,26,.75)"; ctx.strokeStyle = "#ff8ecb88"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y0, w, hgt, 11) : ctx.rect(x0, y0, w, hgt); ctx.fill(); ctx.stroke();
    s.targets.forEach(function (tg) {
      const p = R.pose(tg.def, tg.age); if (!p.ok) return;
      const px = x0 + (p.x / W) * w, py = y0 + 4 + (p.y / H) * (hgt - 8), d = tg.def;
      ctx.fillStyle = d.kind === "friend" ? "#ff8ecb" : d.kind === "pickup" ? "#ffdc83" : d.wind && tg.wind > d.wind * 0.55 && frameNo % 10 < 5 ? "#fff" : "#ff6f8f";
      if (d.kind === "friend") { A.heart(ctx, px, py, 5); ctx.fill(); } else { ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill(); }
    });
    if (s.boss) { const p = R.pose(s.boss.def, s.boss.age); ctx.fillStyle = "#c9a8ff"; ctx.beginPath(); ctx.arc(x0 + (p.x / W) * w, y0 + hgt / 2, 7, 0, Math.PI * 2); ctx.fill(); }
    if (scoped) { ctx.strokeStyle = "#fff"; ctx.strokeRect(x0 + (cam.x / W) * w, y0 + 1, (cam.w / W) * w, hgt - 2); }
  }

  /* ---------------------------------------------------------------- HUD (text) */
  function hud() {
    const playing = !!run && ["play", "paused", "over"].includes(mode);
    $("ls-hud-left").hidden = $("ls-hud-right").hidden = !playing;
    if (!playing) return;
    const s = run.s, st = stageDef();
    $("ls-hearts").textContent = st.training ? "♡ Training" : "♥".repeat(s.hearts) + "♡".repeat(Math.max(0, R.C.HEARTS - s.hearts));
    $("ls-ammo").textContent = s.reloading ? "Reloading…" : "●".repeat(s.ammo) + "○".repeat(R.C.AMMO - s.ammo);
    $("ls-ammo").dataset.reloading = String(s.reloading);
    $("ls-breath").style.setProperty("--fill", Math.round(breath * 100) + "%"); $("ls-breath").dataset.puffing = String(puffing);
    $("ls-glow-wrap").hidden = !st.dark; $("ls-glow").style.setProperty("--fill", Math.round(battery * 100) + "%");
    $("ls-clock").textContent = st.training ? "—" : (s.clock / 60).toFixed(1);
    $("ls-clock").dataset.low = String(!st.training && s.clock < 600);
    $("ls-score").textContent = s.score.toLocaleString();
    $("ls-combo").textContent = "×" + ((10 + Math.min(s.streak, R.C.COMBO_MAX)) / 10).toFixed(1);
    $("ls-wind-line").hidden = !st.wind; $("ls-wind").textContent = st.wind ? "→ " + (st.wind > 40 ? "strong" : "light") + " (aim left)" : "";
    const line = "Lumi-Soft · " + st.name + " · " + s.score.toLocaleString();
    if (line !== reported) { reported = line; M.report(line); }
  }

  /* ---------------------------------------------------------------- input */
  function pointer(e) { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }
  canvas.addEventListener("mousemove", pointer);
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  canvas.addEventListener("mousedown", function (e) {
    pointer(e); M.sound.unlock();
    if (mode !== "play") return;
    if (e.button === 2) { if (settings.scope === "toggle" && scoped) closeScope(); else openScope(); return; }
    if (e.button === 0) shoot();
  });
  window.addEventListener("mouseup", function (e) { if (e.button === 2 && settings.scope === "hold") closeScope(); });
  window.addEventListener("blur", function () { keys.shift = false; if (settings.scope === "hold") closeScope(); if (mode === "play") pause(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && mode === "play") pause(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Shift") keys.shift = true;
    if (mode !== "play" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "r" || e.key === "R") { if (R.reload(run.s)) run.log.reloads.push(run.s.t); }
    if ((e.key === "g" || e.key === "G") && stageDef().dark) { if (glowOn) glowOn = false; else if (battery > 0.15) { glowOn = true; play("ding", 0.3); } }
  });
  document.addEventListener("keyup", function (e) { if (e.key === "Shift") keys.shift = false; });
  M.onAction(function (action) { // P (or a media Play key) pauses; nothing else on the shared key map matters here.
    if (action !== "play") return;
    if (mode === "play") pause(); else if (mode === "paused") resume();
  });

  function shoot() { // One pop at the aim point. The log keeps exactly what was fired, rounded as the server will read it.
    const s = run.s;
    if (!R.canFire(s)) return;
    let at = aim();
    if (!scoped) { at = { x: at.x + (Math.random() - 0.5) * 90, y: at.y + (Math.random() - 0.5) * 90 }; }   // the wide view can't aim finely
    const x = Math.round(at.x * 10) / 10, y = Math.round(at.y * 10) / 10;
    const before = new Map(s.targets.map(function (tg) { return [tg.id, { tg: tg, p: R.pose(tg.def, tg.age) }]; }));
    const out = R.fire(s, x, y);
    if (!out) return;
    run.log.shots.push([s.t, x, y]);
    kick = 1; play("pop", 0.55);
    const now = performance.now(), hit = before.get(out.id);
    if (hit) effects.push({ look: hit.tg.def.look, kind: hit.tg.def.kind, x: hit.p.x, y: hit.p.y, s: hit.tg.def.s || 1, v: hit.p.v, h: hit.p.h, at: now, seed: (out.id % 7) / 7 });
    const text = { pop: "+" + out.points, badge: "★ +" + out.points, friend: "Friend! " + out.points, pickup: out.look === "pickup-star" ? "+" + out.points : { "pickup-clock": "+5 s", "pickup-heart": "+♥", "pickup-crate": "Reloaded!" }[out.look],
      spot: "Bullseye! +" + out.points, beaten: "Down! +" + out.points, boing: "Boing!", miss: "" }[out.what];
    if (text) texts.push({ text: text, x: out.x, y: out.y, at: now, big: out.what === "badge" || out.what === "beaten", color: out.what === "friend" ? "#ff6f8f" : out.what === "boing" ? "#d9b8d0" : "#ffdc83" });
    if (out.what === "badge" || out.what === "spot" || out.what === "pickup") play("ding", 0.35);
    if (out.what === "friend") { play("aww"); say("Nooo, that was a friend! −5 seconds…", 2400); }
    if (out.what === "spot" && s.boss) s.boss.hurtUntil = now + 250;
    if (out.what === "beaten") { play("yay"); }
    if (s.streak === 10) say("Ten in a row! You're sparkling~", 2000);
    if (s.streak === R.C.COMBO_MAX) say("×3.0 combo! Lumi-Soft legend~", 2400);
    if (s.done) finishRun();
  }

  /* ---------------------------------------------------------------- panels */
  const PANELS = ["ls-title", "ls-page", "ls-pause", "ls-over", "ls-results"];
  function show(id) { PANELS.forEach(function (p) { $(p).hidden = p !== id; }); stage.dataset.menu = String(!!id); }
  function error(text) { $("ls-error").textContent = text || ""; $("ls-error").hidden = !text; }
  function stageName(id) { const st = info.stages.stages.find(function (x) { return x.id === id; }); return st ? st.name : id; }
  function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }

  function entrySgc() { return window.LumiPrice("soft", "entry", info.entry); }                    // LumiBot: a run's price in SGC (same tuning as the server)
  function continueSgc(native) { return window.LumiPrice("soft", "continue", native); }           // LumiBot: a continue's price in SGC

  async function menu() { // The title screen, with fresh numbers from the server.
    mode = "menu"; run = null; scoped = false; show("ls-title");
    try {
      info = await M.api(BASE + "/state");
      $("ls-coins").textContent = info.coins.toLocaleString();
      $("ls-story-note").textContent = entrySgc() + " SGC · five stages" + (info.bests.story ? " · best " + info.bests.story.score.toLocaleString() : "");
      $("ls-daily-note").textContent = (info.daily.tried ? "Free practice" : entrySgc() + " SGC · today's try") + " · " + stageName(info.daily.stage);
      const won = info.prizes.filter(function (p) { return p.won; }).length;
      $("ls-prize-note").textContent = won + " of " + info.prizes.length + " won";
      error("");
    } catch (e) { error(e.message || "Lumi-Soft couldn't reach the server."); }
  }
  function page(eyebrow, title, body) { $("ls-page-eyebrow").textContent = eyebrow; $("ls-page-title").textContent = title; $("ls-page-body").replaceChildren(body); show("ls-page"); }

  function stagesPage() {
    const list = el("div", undefined, "ls-list"), story = info.stages.stages.filter(function (s) { return !s.training; });
    story.forEach(function (st, i) {
      const open = i === 0 || info.cleared.indexOf(story[i - 1].id) >= 0, best = info.bests["stage:" + st.id];
      const b = el("button"); b.type = "button"; b.disabled = !open;
      b.append(el("b", (i + 1) + ". " + st.name), el("small", open ? entrySgc() + " SGC" + (best ? " · best " + best.score.toLocaleString() + " · rank " + best.rank : "") : "Clear " + story[i - 1].name + " first"));
      b.addEventListener("click", function () { start("stage", st.id); });
      list.append(b);
    });
    page("Stage select", "Pick a stage", list);
  }
  function dailyPage() {
    const box = el("div"), d = info.daily;
    box.append(el("p", "Today: " + stageName(d.stage) + ", scene " + (d.scene + 1) + ", then its boss. The same range for everyone.", "ls-lead"));
    box.append(el("p", d.tried ? "Your scored try today is used. Practice is free, pays nothing and isn't on the board." : "Your first try today is the scored one (" + entrySgc() + " SGC), even if you stop early.", "ls-small"));
    const go = el("button", d.tried ? "Practice" : "Start today's try", "gm-primary"); go.type = "button";
    go.addEventListener("click", function () { start("daily"); });
    box.append(go);
    const table = el("table", undefined, "ls-board");
    if (!d.board.length) box.append(el("p", "Nobody's on today's board yet. Be the first~", "ls-small"));
    d.board.forEach(function (r, i) { const tr = el("tr"); tr.append(el("td", (i + 1) + ". " + r.name), el("td", r.rank || ""), el("td", r.score.toLocaleString())); table.append(tr); });
    box.append(table);
    page("Daily Range", "Today's range", box);
  }
  function prizesPage() {
    const grid = el("div", undefined, "ls-prizes");
    info.prizes.forEach(function (p) { const c = el("div", undefined, "ls-prize"); c.dataset.won = String(p.won); c.append(el("b", p.name), el("small", (p.closet ? "Closet · " : "House · ") + (p.won ? "Won!" : p.how))); grid.append(c); });
    if (!info.prizes.length) grid.append(el("p", "The prizes aren't in Lumi's catalogs yet.", "ls-small"));
    page("Prizes", "Lumi-Soft for Lumi's house", grid);
  }
  function settingsPage() {
    const box = el("div");
    function row(label, input) { const r = el("label", undefined, "ls-setting"); r.append(el("span", label), input); box.append(r); }
    function choice(key, options) {
      const sel = el("select"); options.forEach(function (o) { const opt = el("option", o[1]); opt.value = String(o[0]); opt.selected = String(settings[key]) === String(o[0]); sel.append(opt); });
      sel.addEventListener("change", function () { settings[key] = typeof options[0][0] === "number" ? Number(sel.value) : sel.value; saveSettings(); });
      return sel;
    }
    row("Star Scope", choice("scope", [["hold", "Hold the right button"], ["toggle", "Click to open or close"]]));
    row("Scope drift speed", choice("pan", [[0.7, "Slow"], [1, "Normal"], [1.4, "Fast"]]));
    row("Still zone in the middle", choice("dead", [[0.6, "Small"], [1, "Normal"], [1.4, "Large"]]));
    row("Reticle", choice("reticle", [["heart", "Heart"], ["star", "Star"], ["paw", "Paw"], ["dot", "Dot"]]));
    const vol = el("input"); vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.1"; vol.value = String(settings.volume);
    vol.addEventListener("input", function () { settings.volume = Number(vol.value); saveSettings(); });
    row("Volume", vol);
    const snd = el("button", M.sound.isOn() ? "Sound is on" : "Sound is off"); snd.type = "button";
    snd.addEventListener("click", function () { snd.textContent = M.sound.toggle() ? "Sound is on" : "Sound is off"; });
    box.append(snd);
    page("Settings", "How the range feels", box);
  }

  $("ls-menu").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-go]"); if (!b || !info) return;
    const go = b.dataset.go;
    if (go === "story") start("story"); else if (go === "training") start("training"); else if (go === "stages") stagesPage();
    else if (go === "daily") dailyPage(); else if (go === "prizes") prizesPage(); else settingsPage();
  });
  $("ls-back").addEventListener("click", menu);

  /* ---------------------------------------------------------------- a run */
  async function start(kind, stageId) {
    M.sound.unlock(); error("");
    try {
      const t = await M.api(BASE + "/start", { mode: kind, stage: stageId || null });
      run = { ticket: t.run, kind: kind, s: R.create(info.stages, t.plan), log: { shots: [], reloads: [], continues: 0 }, nextContinue: t.next_continue, practice: t.practice };
      effects = []; texts = []; drops = []; warned = new Set(); lowSaid = false; breath = 1; puffing = false; glowOn = false; battery = 1; scoped = false;
      run.s.events.forEach(onEvent);
      mode = "play"; show(null); acc = 0;
    } catch (e) { show("ls-title"); error(e.message || "That run couldn't start."); }
  }
  function pause() { if (mode !== "play") return; mode = "paused"; closeScope(); show("ls-pause"); }
  function resume() { if (mode !== "paused") return; mode = "play"; show(null); }
  $("ls-resume").addEventListener("click", resume);
  $("ls-quit").addEventListener("click", function () { finishRun(); });

  function gameOver() { // Out of time or hearts: continue for SGC (the score stays), or end here.
    mode = "over"; closeScope(); show("ls-over");
    const price = run.nextContinue ? continueSgc(run.nextContinue) : 0, s = run.s; // LumiBot: native -> SGC
    $("ls-over-title").textContent = s.hearts <= 0 ? "Soaked!" : "Time's up!";
    $("ls-over-text").textContent = "Score " + s.score.toLocaleString() + ". " + (price ? "Continue for " + price + " SGC: your score stays, hearts come back." : "Continue for free (practice).");
    $("ls-continue").textContent = price ? "Continue · " + price + " SGC" : "Continue";
    let left = 10;
    $("ls-countdown").textContent = left;
    clearInterval(overTimer);
    overTimer = setInterval(function () { left -= 1; $("ls-countdown").textContent = Math.max(0, left); if (left <= 0) { clearInterval(overTimer); finishRun(); } }, 1000);
  }
  $("ls-continue").addEventListener("click", async function () {
    if (mode !== "over") return;
    clearInterval(overTimer);
    try {
      const c = await M.api(BASE + "/continue", { run: run.ticket });
      run.nextContinue = c.next_continue; run.log.continues += 1;
      R.carryOn(run.s); play("rollup", 0.5); say("Back on your cushion! Let's go~", 2200);
      mode = "play"; show(null);
    } catch (e) { $("ls-over-text").textContent = e.message || "That continue couldn't be paid."; }
  });
  $("ls-give-up").addEventListener("click", function () { clearInterval(overTimer); finishRun(); });

  async function finishRun() { // Send the log; the server's replay decides the score and the SGC.
    if (!run || mode === "finishing" || mode === "results") return;
    clearInterval(overTimer);
    mode = "finishing"; closeScope();
    const s = run.s, body = { run: run.ticket, shots: run.log.shots, reloads: run.log.reloads, continues: run.log.continues, end: s.t };
    show("ls-results");
    $("ls-results-title").textContent = "Counting your pops…"; $("ls-results-score").textContent = ""; $("ls-results-ranks").replaceChildren(); $("ls-results-earned").textContent = ""; $("ls-results-won").hidden = true;
    try {
      const r = await M.api(BASE + "/finish", body);
      results(r);
    } catch (e) { $("ls-results-title").textContent = e.message || "The run couldn't be counted."; mode = "results"; }
  }
  function results(r) {
    mode = "results";
    const sum = r.summary;
    $("ls-results-eyebrow").textContent = { story: "Story", stage: "Stage", daily: "Daily Range", training: "Training Range" }[run.kind] || "Results";
    $("ls-results-title").textContent = sum.done ? (run.kind === "story" ? "Story clear! ✨" : "Range clear! ✨") : "Run over";
    $("ls-results-score").textContent = sum.score.toLocaleString();
    const ranks = $("ls-results-ranks"); ranks.replaceChildren();
    sum.cleared.forEach(function (c) { if (!c.rank) return; const li = el("li"); li.append(el("span", stageName(c.stage) + " · " + c.hits + "/" + c.shots + " hits"), el("b", "Rank " + c.rank)); ranks.append(li); });
    const pops = el("li"); pops.append(el("span", "Pops " + sum.pops + " · star badges " + sum.badges + " · best combo " + sum.best), el("b", sum.continues ? sum.continues + " continue" + (sum.continues > 1 ? "s" : "") : "")); ranks.append(pops);
    $("ls-results-earned").textContent = r.refused ? r.refused : r.practice ? "Practice: no SGC this time." :
      "+" + r.paid + " SGC" + (r.said ? " · " + r.said : "") + (r.bests.length ? " · new best!" : ""); // LumiBot: SGC; owed / limit words from the server
    const won = $("ls-results-won"); won.replaceChildren();
    if (r.won.length) {
      won.append(el("h3", "New for Lumi! ✨"));
      r.won.forEach(function (p) { won.append(el("p", p.name + (p.closet ? " (in her Closet)" : " (for her house)"))); });
      won.hidden = false; play("yay");
    }
  }
  $("ls-again").addEventListener("click", menu);

  /* ---------------------------------------------------------------- go */
  // A read-only peek for the browser tests (tests/lumi-soft-browser.mjs): the run, the screen mode, and where a scene point is on screen.
  window.LumiSoftGame = { run: function () { return run; }, mode: function () { return mode; }, toScreen: toScreen, scoped: function () { return scoped; } };
  window.addEventListener("resize", resize);
  resize(); loadSounds(); menu();
  requestAnimationFrame(frame);
})();
