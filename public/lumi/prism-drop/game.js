/* Prism Drop (mnemerynne/games.py): pick one of ten pockets, drop a neon ball through twenty rows of pins, score
   points. A game is ten drops and pays SGC when it ends (LumiBot: score / 10 native, LumiPayout('prism', 'win')); the best total stays on this device. The server rolls each
   drop and keeps the score (mnemerynne/prism.py); this file draws the field, animates the ball, plays the sounds and
   handles the controls.

   Controls, the same from a keyboard or a remote panel (common.js turns both into actions):
   ◀ ▶ pick a pocket · Enter drop (or start again after the tenth) · ▲ replay the last drop · ▼ sound on or off.
   A tap on the field picks that pocket, and a second tap on it drops. Ported from MommyBot's ball drop, without
   the wager.

   Lumi plays it with you (Doll, 2026-11-11): the player's own Lumi (arcade/lumi-sprite.js) hovers over the pick holding
   the ball, lets it go, darts round the field while it falls, then flies down to the pocket, picks it up and carries
   it back to the top. Only for looks: the drop's path is the server's. With reduced motion she simply waits at the top. */
(function () {
  "use strict";

  const R = window.PrismRules, G = window.MGame, L = window.LumiSprite;
  const $ = function (id) { return document.getElementById(id); };
  const canvas = $("pd-field"), ctx = canvas.getContext("2d");
  const W = 640, H = 920;                                        // the field's own units; fit() scales them to the screen
  const x = function (column) { return 45 + (column - 1) * 61.1; }, y = function (row) { return 65 + row * 38; };
  // Pins and pockets run cyan to hot pink across the ten columns: the neon theme's two glows.
  const LANES = ["#00f0ff", "#22d4ff", "#4ab0ff", "#738cff", "#9a6bff", "#c053ff", "#e246ec", "#ff38c8", "#ff2e97", "#ff4f6a"];
  const NEON = G.colors();

  let pick = 5, score = 0, drops = 0, best = Number(G.store.get("best", 0)) || 0;
  let last = null, shown = null, animating = false, busy = false, over = false;   // busy: a drop until it's scored
  let ball = null, particles = [], impacts = [], used = new Set(), scale = 1;
  let tick = 0, bounced = [];                                    // how far the platforms have moved, and each one's bounces so far
  const HOLD_Y = 46, TALL = 46;                                  // where Lumi hovers with the ball (her paws), and how tall she is
  // Lumi: where she is, where she's heading, and what she's doing: "hold" (over the pick, the ball in her paws), "dart"
  // (flitting about while it falls), "fetch" (down to the pocket) or "carry" (back up with it).
  const lumi = { x: 0, y: HOLD_Y, tx: 0, ty: HOLD_Y, mode: "hold", flip: false, next: 0, cheer: 0 };

  // ---------------------------------------------------------------- drawing
  function fit() { // Match the canvas's pixels to its size on screen (crisp on a 4K TV and a phone alike).
    const box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!box.width) return;
    scale = box.width / W * dpr;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw();
  }

  function glowDot(px, py, radius, color, blur) { // A filled circle with a bounded neon glow.
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = blur || 0; ctx.fill(); ctx.shadowBlur = 0;
  }

  function drawPeg(column, row, type) { // An ordinary pin, or a block, bomb or coin peg (dimmed once a drop has used it).
    const px = x(column), py = y(row), spent = used.has(row + ":" + column);
    if (type === "block") { // A violet hazard bar: shoves the ball two columns.
      ctx.save(); ctx.shadowColor = "#b14bff"; ctx.shadowBlur = 12;
      ctx.fillStyle = "#3a1258"; ctx.fillRect(px - 14, py - 7, 28, 14); ctx.shadowBlur = 0;
      ctx.strokeStyle = "#b14bff"; ctx.lineWidth = 1.5; ctx.strokeRect(px - 14, py - 7, 28, 14);
      ctx.beginPath(); for (let i = -10; i <= 6; i += 8) { ctx.moveTo(px + i, py + 6); ctx.lineTo(px + i + 6, py - 6); } ctx.stroke();
      ctx.restore();
    } else if (type === "bomb") { // A red-orange core with a cross of glitch sparks; a spent one is a dim husk.
      if (spent) { glowDot(px, py, 5, "rgba(255, 90, 60, .25)"); return; }
      glowDot(px, py, 9, "#ff5a3c", 16); glowDot(px, py, 5, "#1a0408");
      ctx.strokeStyle = "#ffd36b"; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(px - 13, py); ctx.lineTo(px - 9, py); ctx.moveTo(px + 9, py); ctx.lineTo(px + 13, py);
      ctx.moveTo(px, py - 13); ctx.lineTo(px, py - 9); ctx.stroke();
    } else if (type === "coin") { // A gold ring with a plus; a spent one fades.
      if (spent) { glowDot(px, py, 4, "rgba(255, 225, 77, .25)"); return; }
      glowDot(px, py, 9, "#ffe14d", 16); glowDot(px, py, 6.5, "#2a1d00");
      ctx.fillStyle = "#ffe14d"; ctx.font = "700 12px " + NEON.font; ctx.textAlign = "center"; ctx.fillText("+", px, py + 4);
    } else {
      glowDot(px, py, 3.6, LANES[column - 1], 9); glowDot(px - 1, py - 1, 1.2, "rgba(255, 255, 255, .8)");
    }
  }

  function reflect(value, low, high) { // Bounce a position back inside low..high: the same sum as the server's _reflect.
    while (value < low || value > high) value = value < low ? low * 2 - value : high * 2 - value;
    return value;
  }

  function platformLeft(p, at) { // A platform's leftmost column at this point in the drop, smoothly between whole steps (prism.py platform_left).
    const whole = Math.floor(at), last = R.WIDTH - R.PLATFORM_SPAN + 1;
    const from = reflect(p.left + p.dir * whole, 1, last), to = reflect(p.left + p.dir * (whole + 1), 1, last);
    return from + (to - from) * (at - whole);
  }

  function drawPlatforms() { // The sliding bars, under the ball; one that has given all its bounces fades and lets the ball through.
    ((shown && shown.platforms) || []).forEach(function (p, index) {
      const left = x(platformLeft(p, tick)) - 22, width = 61.1 * (R.PLATFORM_SPAN - 1) + 44;
      const spent = (bounced[index] || 0) >= R.PLATFORM_BOUNCES;
      ctx.save();
      ctx.globalAlpha = spent ? .3 : 1;
      ctx.shadowColor = NEON.cyan; ctx.shadowBlur = spent ? 0 : 14;
      ctx.fillStyle = "#0b3a46"; ctx.fillRect(left, y(p.row), width, 9);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = NEON.cyan; ctx.lineWidth = 1.5; ctx.strokeRect(left, y(p.row), width, 9);
      ctx.restore();
    });
  }

  function draw() { // The whole field: grid, lanes, pins, pockets, platforms, then hits, sparks and the ball on top.
    const field = new Map(((shown && shown.obstacles) || []).map(function (o) { return [o.row + ":" + o.column, o.type]; }));
    ctx.clearRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);              // Lumi's night sky, with faint sparkles
    sky.addColorStop(0, "rgb(18,8,32)"); sky.addColorStop(1, "rgb(44,18,58)");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,248,220,.18)";
    for (let i = 0; i < 40; i++) { const sx = (i * 157) % W, sy = (i * 389) % H, r = 1.5 + (i % 3); ctx.beginPath(); ctx.moveTo(sx, sy - r * 2); ctx.lineTo(sx + r * .6, sy); ctx.lineTo(sx, sy + r * 2); ctx.lineTo(sx - r * .6, sy); ctx.closePath(); ctx.fill(); }
    for (let col = 1; col <= R.WIDTH; col++) {
      const chosen = col === pick && !over, landed = !animating && shown && shown.landing === col;
      if (chosen) { // The picked lane: a cyan wash from top to bottom.
        const lane = ctx.createLinearGradient(0, 43, 0, 836);
        lane.addColorStop(0, "rgba(0, 240, 255, .02)"); lane.addColorStop(1, "rgba(0, 240, 255, .14)");
        ctx.fillStyle = lane; ctx.fillRect(x(col) - 25, 43, 50, 793);
      }
      ctx.font = "600 13px " + NEON.font; ctx.textAlign = "center";
      const entry = col >= 4 && col <= 7;                          // the ball enters at pin 4, 5, 6 or 7
      ctx.fillStyle = entry ? NEON.cyan : NEON.muted; ctx.fillText(String(col), x(col), 26);
      if (entry) { ctx.fillStyle = NEON.cyan; ctx.beginPath(); ctx.moveTo(x(col) - 4, 33); ctx.lineTo(x(col) + 4, 33); ctx.lineTo(x(col), 40); ctx.fill(); }
      for (let row = 0; row < R.HEIGHT; row++) drawPeg(col, row, field.get(row + ":" + col));
      // The pocket: a neon outline, lit when the ball landed in it, thicker when it's the pick.
      ctx.save(); ctx.shadowColor = LANES[col - 1]; ctx.shadowBlur = landed ? 22 : chosen ? 14 : 6;
      ctx.fillStyle = landed ? LANES[col - 1] + "66" : LANES[col - 1] + "14"; ctx.fillRect(x(col) - 25, 841, 50, 49);
      ctx.strokeStyle = LANES[col - 1]; ctx.lineWidth = chosen || landed ? 2.5 : 1; ctx.strokeRect(x(col) - 25, 841, 50, 49);
      ctx.restore();
      ctx.fillStyle = landed ? "#0a0010" : NEON.ink; ctx.font = "800 20px " + NEON.font; ctx.fillText(String(col), x(col), 872);
      if (chosen) { ctx.fillStyle = NEON.cyan; ctx.font = "700 9px " + NEON.font; ctx.fillText("PICK", x(col), 908); }
    }
    drawPlatforms();
    impacts.forEach(function (hit) { // Rings where the ball struck, and the coin peg's +N rising.
      ctx.globalAlpha = Math.max(0, hit.life);
      ctx.beginPath(); ctx.arc(hit.x, hit.y, (1 - hit.life) * (hit.type === "bomb" ? 60 : 26) + 5, 0, Math.PI * 2);
      ctx.strokeStyle = hit.color; ctx.lineWidth = hit.type === "bomb" ? 3 : 2; ctx.stroke();
      if (hit.coins) { ctx.fillStyle = "#ffe14d"; ctx.font = "800 22px " + NEON.font; ctx.textAlign = "center";
                       ctx.fillText("+" + hit.coins, hit.x, hit.y - 22 - (1 - hit.life) * 35); }
    });
    particles.forEach(function (p) { ctx.globalAlpha = Math.max(0, p.life); glowDot(p.x, p.y, p.size * Math.max(.1, p.life), p.color, 7); });
    ctx.globalAlpha = 1;
    if (L) L.draw(ctx, L.own(G.api), lumi.x, lumi.y, TALL, { flip: lumi.flip, eyes: lumi.cheer > 0 ? "happy" : "open", tilt: lumi.mode === "dart" ? (lumi.tx - lumi.x) * 0.002 : 0 });
    const held = lumi.mode === "hold" || lumi.mode === "carry";
    const at = held ? { x: lumi.x, y: lumi.y + 6 } : ball;          // in her paws, or wherever the drop has it
    if (at) { glowDot(at.x, at.y, 15, "rgba(" + NEON.glow + ", .18)", 26); glowDot(at.x, at.y, 7, NEON.pink, 20); glowDot(at.x - 2, at.y - 2, 2.4, "#ffffff"); }
  }

  function stepLumi(now) { // One frame of Lumi: hovering, darting, fetching or carrying (a smooth glide toward where she's heading).
    if (G.reducedMotion) { if (lumi.mode === "hold") { lumi.x = x(pick); lumi.y = HOLD_Y; } return; }
    if (lumi.mode === "hold") { lumi.tx = x(pick); lumi.ty = HOLD_Y + Math.sin(now / 420) * 3; }
    if (lumi.mode === "dart" && now >= lumi.next) {                 // a new spot to flit to, every half second or so
      lumi.tx = 40 + Math.random() * (W - 80); lumi.ty = 90 + Math.random() * 700; lumi.next = now + 450 + Math.random() * 500;
    }
    const ease = lumi.mode === "dart" ? 0.06 : lumi.mode === "hold" ? 0.2 : 0.09;
    const dx = lumi.tx - lumi.x;
    if (Math.abs(dx) > 1) lumi.flip = dx < 0;                        // she faces the way she flies
    lumi.x += dx * ease; lumi.y += (lumi.ty - lumi.y) * ease;
    if (lumi.mode === "fetch" && Math.hypot(lumi.tx - lumi.x, lumi.ty - lumi.y) < 4) {   // got it: up she goes
      lumi.mode = "carry"; lumi.tx = x(pick); lumi.ty = HOLD_Y; ball = null;
    } else if (lumi.mode === "carry") {
      lumi.tx = x(pick);
      if (Math.hypot(lumi.tx - lumi.x, lumi.ty - lumi.y) < 3) lumi.mode = "hold";
    }
    if (lumi.cheer > 0) lumi.cheer--;
  }

  function loop(now) { // Lumi moves all the time; while a drop plays, its own frames draw the field.
    requestAnimationFrame(loop);
    stepLumi(now);
    if (!animating) draw();
  }

  // ------------------------------------------------------------------ sound
  function cue(kind, detail) { // Ported from MommyBot's sound.js: swoop, pin taps, block knocks, booms, chimes, a landing tune.
    const t = G.sound.tone;
    if (kind === "drop") { t(880, .24, 0, .2, "sine", 220); t(1320, .18, .04, .1, "sine", 440); }
    else if (kind === "peg") t([523.25, 587.33, 659.25, 783.99, 880][((detail.column || 1) - 1) % 5], .085, 0, .13);
    else if (kind === "block") { t(190, .11, 0, .28, "triangle", 95); t(380, .07, 0, .08); }
    else if (kind === "bomb") { t(155, .34, 0, .42, "triangle", 35); t(510, .17, 0, .12, "sawtooth", 65); t(240, .22, .05, .16, "sine", 55); }
    else if (kind === "coin") { t(1046.5, .15, 0, .22); t(1568, .23, .065, .18); }
    else if (kind === "platform") { t(330, .08, 0, .24, "square"); t(660, .12, .05, .14, "triangle", 880); }
    else if (kind === "landing") {
      const notes = [[523.25, 659.25, 783.99, 1046.5], [523.25, 659.25, 880], [523.25, 659.25]][Math.abs(detail.pick - detail.landing)] || [392, 293.66];
      notes.forEach(function (note, i) { t(note, .25, i * .105, .2, "triangle"); });
    }
  }

  // -------------------------------------------------------------- animation
  function animate(round) { // Play a drop's path; resolves when the ball is in its pocket. Reduced motion skips to the end.
    G.sound.stop(); animating = true; shown = round; used = new Set(); particles = []; impacts = []; tick = 0; bounced = []; buttons();
    if (G.reducedMotion) { finishAnimation(round); return Promise.resolve(); }
    cue("drop");
    return new Promise(function (resolve) {
      lumi.mode = "dart"; lumi.next = 0; lumi.x = x(round.trajectory[0].column);   // she lets go over the entry pin, then darts off
      const points = [{ x: x(round.trajectory[0].column), y: HOLD_Y + 6 }].concat(round.trajectory.map(function (p) {
        return Object.assign({}, p, { x: x(p.column), y: p.row === R.HEIGHT ? 858 : y(p.row) - 8 });
      }));
      const ends = [0];
      points.slice(0, -1).forEach(function (p) { ends.push(ends[ends.length - 1] + (p.hit === "bomb" ? 360 : p.hit === "platform" ? 300 : 195)); });
      const started = performance.now();
      let lastTime = started, seen = -1;
      function frame(time) {
        const elapsed = time - started;
        let seg = 0; while (seg < points.length - 2 && elapsed >= ends[seg + 1]) seg++;
        const f = Math.min(1, (elapsed - ends[seg]) / (ends[seg + 1] - ends[seg])), step = Math.min(2, (time - lastTime) / 16.67);
        lastTime = time;
        const from = points[seg], to = points[seg + 1];
        tick = Math.max(0, seg - 1 + f);                           // the ball reaches path step N as this segment ends, so the platforms are there too
        ball = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f - Math.sin(f * Math.PI) * (from.hit === "bomb" ? 30 : from.hit === "platform" ? 20 : 10) };
        if (seg !== seen) {
          for (let s = seen + 1; s <= seg; s++) {
            const p = points[s];
            if (p.hit === "coin" || p.hit === "bomb") used.add(p.row + ":" + p.column);
            if (p.hit === "platform") bounced[p.platform] = (bounced[p.platform] || 0) + 1;
          }
          seen = seg;
          if (seg > 0 && elapsed - ends[seg] < 120) cue(from.hit || "peg", from);   // no backlog of hits after a stall
          const color = from.hit === "coin" ? "#ffe14d" : from.hit === "bomb" ? "#ff5a3c" : from.hit === "block" ? "#b14bff" : from.hit === "platform" ? NEON.cyan : LANES[Math.max(0, from.column - 1)] || NEON.cyan;
          impacts.push({ x: from.x, y: from.y, life: 1, color: color, type: from.hit, coins: from.coins });
          if (from.hit) { // A burst of sparks: bigger for a bomb.
            const n = from.hit === "bomb" ? 36 : 16, speed = from.hit === "bomb" ? 4 : 2;
            for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n; particles.push({ x: from.x, y: from.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: 2.5, life: 1, color: color }); }
            say(from.hit === "bomb" ? "Boom! New direction…" : from.hit === "coin" ? "Coin peg! +" + from.coins : from.hit === "platform" ? "Bounce! Back up it goes…" : "Blocked! Shoved sideways…");
          }
        }
        for (let i = 0; i < 3; i++) particles.push({ x: ball.x, y: ball.y, vx: (Math.random() - .5) * 2, vy: -Math.random() * 1.8, size: 1.5 + Math.random() * 3, life: 1, color: LANES[(seg + i) % 10] });
        particles.forEach(function (p) { p.x += p.vx * step; p.y += p.vy * step; p.life -= .025 * step; });
        particles = particles.filter(function (p) { return p.life > 0; }).slice(-220);
        impacts.forEach(function (h) { h.life -= (h.type ? .022 : .05) * step; });
        impacts = impacts.filter(function (h) { return h.life > 0; });
        draw();
        if (elapsed >= ends[ends.length - 1]) { finishAnimation(round); resolve(); } else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  function finishAnimation(round) { // The ball at rest in its pocket, every pickup counted even if frames were skipped.
    round.trajectory.forEach(function (p) {
      if (p.hit === "coin" || p.hit === "bomb") used.add(p.row + ":" + p.column);
    });
    bounced = [];                                                  // counted afresh, in case frames were skipped
    round.trajectory.forEach(function (p) { if (p.hit === "platform") bounced[p.platform] = (bounced[p.platform] || 0) + 1; });
    tick = round.trajectory.length - 1;
    ball = { x: x(round.landing), y: 852 }; animating = false; particles = []; impacts = [];
    if (G.reducedMotion) { lumi.mode = "hold"; lumi.x = lumi.tx = x(pick); lumi.y = HOLD_Y; }   // no flying: she's simply back at the top
    else { lumi.mode = "fetch"; lumi.tx = ball.x; lumi.ty = 846; }   // down she goes to fetch it
    lumi.cheer = Math.abs(round.pick - round.landing) === 0 ? 90 : 0;
    cue("landing", round); draw();
  }

  // ------------------------------------------------------------------- game
  function say(text, win) { const el = $("pd-result"); el.textContent = text; el.classList.toggle("win", !!win); }

  function hud() { // The score board, the buttons, and the line a remote panel shows.
    $("pd-score").textContent = String(score);
    $("pd-best").textContent = String(best);
    $("pd-drop").textContent = over ? "Done" : (Math.min(drops + 1, R.DROPS) + " / " + R.DROPS);
    buttons();
    G.report(over ? "Game over · " + score + " points · best " + best : "Score " + score + " · drop " + (drops + 1) + " of " + R.DROPS + " · pocket " + pick);
  }

  function buttons() {
    $("pd-drop-button").textContent = over ? "New game ↻" : "Drop ↓";
    $("pd-drop-button").disabled = animating || busy;
    $("pd-replay").disabled = animating || busy || !last;
    $("pd-sound").textContent = G.sound.isOn() ? "Sound: on" : "Sound: off";
    $("pd-sound").setAttribute("aria-pressed", String(G.sound.isOn()));
  }

  function newGame() { score = 0; drops = 0; over = false; last = null; shown = null; ball = null; used = new Set(); tick = 0; bounced = []; say("Pick a pocket, then drop."); hud(); draw(); }

  async function dropBall() { // One scored drop: the server rolls it and keeps the score, and this plays it back; the tenth ends the game.
    busy = true;
    say("Dropping…");
    hud();
    let result;
    try { result = await G.api(window.LUMI_API + "prism-drop/drop", { pick: pick }); }
    catch (err) {                                                  // nothing was rolled: the same pick can simply try again
      busy = false;
      say(err.status ? err.message : "Couldn't reach the server. Drop again to retry.");
      hud();
      return;
    }
    const round = result.round;
    last = round;
    say("Dropping from pin " + round.trajectory[0].column + "…");
    animate(round).then(function () {
      busy = false;
      score = result.score; drops = result.drops;                  // the server's count, even if another device played too
      const off = Math.abs(round.pick - round.landing);
      const head = ["Right on the prism!", "One pocket off.", "Two pockets off."][off] || "Missed the pocket.";
      say(head + " Pocket " + round.landing + ": +" + round.landingPoints + (round.bonus ? ", coin pegs +" + round.bonus : "") + " = " + round.points + ".", off === 0);
      if (result.over) {
        over = true;
        const record = score > best;
        if (record) { best = score; G.store.set("best", best); }
        const pay = (result.paid ? " +" + result.paid + " SGC!" : "") + (result.said ? " " + result.said : ""); // LumiBot: SGC paid; owed / today's limit words from the server
        say((record ? "New best! " : "Game over. ") + score + " points." + pay + " Enter (or New game) to play again.", record);
        $("pd-coins").textContent = result.coins.toLocaleString();
      }
      hud();
    });
  }

  function replay() { // The last drop again, scoring nothing.
    if (!last || animating || busy) return;
    busy = true; say("Replaying the last drop (no points)…");
    animate(last).then(function () { busy = false; say("Replay done. Pocket " + last.landing + "."); hud(); });
  }

  G.onAction(function (action) { // Keyboard, remote panel and taps all land here.
    if (action === "down") { G.sound.toggle(); buttons(); return; }
    if (animating || busy) return;                                 // the field is busy: wait for the ball to be scored
    if (action === "left" || action === "right") {
      if (over) return;
      pick = Math.max(1, Math.min(R.WIDTH, pick + (action === "left" ? -1 : 1))); hud(); draw();
    } else if (action === "enter") { if (over) newGame(); else dropBall(); }
    else if (action === "up") replay();
  });

  $("pd-drop-button").addEventListener("click", function () { G.tap("enter"); });
  $("pd-replay").addEventListener("click", function () { G.tap("up"); });
  $("pd-sound").addEventListener("click", function () { G.tap("down"); });
  canvas.addEventListener("click", function (e) { // A tap picks that pocket's column; tapping the pick again drops.
    if (animating || busy || over) return;
    const box = canvas.getBoundingClientRect(), fx = (e.clientX - box.left) / box.width * W;
    const column = Math.max(1, Math.min(R.WIDTH, Math.round((fx - 45) / 61.1) + 1));
    if (column === pick) G.tap("enter"); else { pick = column; G.sound.unlock(); hud(); draw(); }
  });
  window.addEventListener("resize", fit);
  lumi.x = lumi.tx = x(pick);
  newGame();
  fit();
  requestAnimationFrame(loop);
  canvas.focus();
  G.showCoins("pd-coins");
  G.api(window.LUMI_API + "prism-drop/run").then(function (run) { // A game left unfinished, here or on another device, carries on.
    if (!run.drops || drops || busy) return;
    score = run.score; drops = run.drops;
    say("Picking up where you left off.");
    hud();
  }).catch(function () { /* a first drop will show whether the server is there */ });
})();
