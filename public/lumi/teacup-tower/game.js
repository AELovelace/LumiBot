/* Teacup Tower: Lumi (the Lumi Pet mascot, drawn from Lumi Pet's own artwork) bounces up an endless tower of teacups.
   The rules are rules.js; the menus, coins and showdowns are the shared arcade shell (games/arcade/arcade.js).

   Controls: ◀ ▶ steer (hold them on a keyboard, or point and drag; a remote's presses steer for a moment each). She
   bounces by herself. The faster she's going sideways, the higher she bounces: run at a wall for a kick. */
(function () {
  "use strict";

  const T = window.TeacupRules, G = window.MGame;
  const PALETTE = ["#ff8ecb", "#00f0ff", "#ffe14d", "#7dff3a", "#b14bff", "#ff9a2a"];   // a new colour every 25 floors
  // Lumi Pet's own shapes (templates/games/lumi-pet.html), viewBox 320 x 300, her paws resting at y ~272.
  const LUMI = {
    wings: ["M113 176 C8 187 25 74 79 108 C104 122 113 153 113 176Z", "M207 176 C312 187 295 74 241 108 C216 122 207 153 207 176Z",
            "M109 182 C36 174 48 238 93 215Z M211 182 C284 174 272 238 227 215Z"],
    tail: "M217 228 C279 254 286 188 256 193 C238 196 260 215 239 218",
    head: "M92 153 L88 62 Q89 49 100 58 L137 93 Q160 83 183 93 L220 58 Q231 49 232 62 L228 153 Q230 204 160 208 Q90 204 92 153Z",
    ears: "M101 77 L106 118 L126 102Z M219 77 L214 118 L194 102Z",
    star: "M160 103 L165 116 L179 120 L165 125 L160 139 L155 125 L141 120 L155 116Z",
    mouth: "M155 165 L160 169 L165 165 M160 169 Q151 184 145 173 M160 169 Q169 184 175 173",
  };
  const PATHS = {};
  Object.keys(LUMI).forEach(function (k) { PATHS[k] = [].concat(LUMI[k]).map(function (d) { return new Path2D(d); }); });
  const GLOW = "#ff8ecb", BODY = "#fce1f2", SHADOW = "#b8569f";

  function screenY(y, worldY, camera) { return y + T.H - (worldY - camera); }
  const remote = {};                                          // the smoothed view of each other racer's board, by screen side

  // Each player's own Lumi (arcade/lumi-sprite.js: her glow and what she wears); the drawing below stands in where
  // the sprite isn't loaded (Node's tests). `size` is her scale in Lumi Pet's 320 x 300 drawing (0.22: about 51 tall).
  function drawLumi(ctx, x, y, size, squash, tilt, blink, look) {   // her feet at (x, y)
    if (window.LumiSprite) {
      window.LumiSprite.draw(ctx, look || window.LumiSprite.PLAIN, x, y, (272 - 40) * size, { squash: squash, tilt: tilt, eyes: blink ? "closed" : "open" });
      return;
    }
    ctx.save();
    ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(size * (2 - squash), size * squash); ctx.translate(-160, -272);
    ctx.shadowColor = SHADOW; ctx.shadowBlur = 30;
    ctx.fillStyle = "rgba(255,142,203,.22)"; ctx.strokeStyle = GLOW; ctx.lineWidth = 2;
    PATHS.wings.forEach(function (p) { ctx.fill(p); ctx.stroke(p); });
    ctx.shadowBlur = 0;
    ctx.strokeStyle = SHADOW; ctx.lineWidth = 17; ctx.lineCap = "round"; ctx.stroke(PATHS.tail[0]);
    ctx.fillStyle = BODY; ctx.strokeStyle = SHADOW; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(160, 214, 62, 57, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.53)"; ctx.beginPath(); ctx.ellipse(160, 230, 36, 31, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BODY; ctx.fill(PATHS.head[0]); ctx.stroke(PATHS.head[0]);
    ctx.fillStyle = GLOW; ctx.fill(PATHS.ears[0]);
    ctx.fillStyle = "#fff9d7"; ctx.fill(PATHS.star[0]); ctx.strokeStyle = SHADOW; ctx.stroke(PATHS.star[0]);
    ctx.fillStyle = "#462846";
    if (blink) { ctx.fillRect(122, 152, 14, 3); ctx.fillRect(184, 152, 14, 3); }
    else { ctx.beginPath(); ctx.ellipse(129, 153, 5, 9, 0, 0, Math.PI * 2); ctx.ellipse(191, 153, 5, 9, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = GLOW;
    ctx.beginPath(); ctx.ellipse(114, 169, 13, 6, 0, 0, Math.PI * 2); ctx.ellipse(206, 169, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#462846"; ctx.lineWidth = 2.8; ctx.stroke(PATHS.mouth[0]);
    ctx.fillStyle = BODY; ctx.strokeStyle = SHADOW; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(123, 259, 24, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(197, 259, 24, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function cupRow(ctx, left, top, w, colour, kind, t) {      // a row of teacups whose rims are the cup's top
    const count = Math.max(1, Math.floor(w / 64)), cw = w / count;
    ctx.fillStyle = "rgba(255,255,255,.12)";                   // the saucer under them
    ctx.beginPath(); ctx.ellipse(left + w / 2, top + 28, w / 2 + 6, 6, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < count; i++) {
      const cx = left + i * cw + cw / 2, rim = cw * 0.42, base = rim * 0.72;
      ctx.save(); ctx.shadowColor = colour; ctx.shadowBlur = 10;
      ctx.fillStyle = "rgba(20,8,30,.9)"; ctx.strokeStyle = colour; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - rim, top); ctx.lineTo(cx + rim, top); ctx.lineTo(cx + base, top + 24);
      ctx.lineTo(cx - base, top + 24); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + rim + 2, top + 10, 6, -Math.PI / 2, Math.PI / 2); ctx.stroke();   // the handle
      ctx.restore();
      ctx.fillStyle = "rgba(255,214,150,.55)";                 // tea in it
      ctx.beginPath(); ctx.ellipse(cx, top + 2, rim - 2, 3, 0, 0, Math.PI * 2); ctx.fill();
      if (kind === "cracked") {                               // a jagged crack: it takes one bounce
        ctx.strokeStyle = "#ffe9f5"; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(cx - 4, top + 3); ctx.lineTo(cx + 2, top + 10); ctx.lineTo(cx - 3, top + 16); ctx.lineTo(cx + 3, top + 23); ctx.stroke();
      }
    }
    if (kind === "slide") {                                   // little arrows: this one wanders
      ctx.fillStyle = colour; ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(t / 300));
      ctx.beginPath(); ctx.moveTo(left - 10, top + 12); ctx.lineTo(left - 2, top + 6); ctx.lineTo(left - 2, top + 18); ctx.fill();
      ctx.beginPath(); ctx.moveTo(left + w + 10, top + 12); ctx.lineTo(left + w + 2, top + 6); ctx.lineTo(left + w + 2, top + 18); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function tower(ctx, x, y, seed, camera, frame, broken, t) { // the walls, the wallpaper and every floor in view
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, T.W, T.H); ctx.clip();
    const band = Math.floor(camera / T.GAP / 25), colour = PALETTE[band % PALETTE.length];
    const bg = ctx.createLinearGradient(0, y, 0, y + T.H);
    bg.addColorStop(0, "rgb(26,10,40)"); bg.addColorStop(1, "rgb(10,4,18)");
    ctx.fillStyle = bg; ctx.fillRect(x, y, T.W, T.H);
    ctx.fillStyle = "rgba(255,142,203,.07)";                  // star wallpaper, drifting slower than the floors
    for (let row = -1; row < 9; row++) {
      const wy = y + T.H - ((row * 60 - (camera * 0.5) % 60) + 60);
      for (let col = 0; col < 11; col++) ctx.fillRect(x + 30 + col * 58 + (row % 2) * 29, wy, 4, 4);
    }
    ctx.fillStyle = "rgba(255,46,151,.25)"; ctx.fillRect(x, y, T.WALL, T.H); ctx.fillRect(x + T.W - T.WALL, y, T.WALL, T.H);
    ctx.fillStyle = colour; ctx.globalAlpha = 0.8; ctx.fillRect(x + T.WALL - 2, y, 2, T.H); ctx.fillRect(x + T.W - T.WALL, y, 2, T.H); ctx.globalAlpha = 1;
    const low = Math.max(0, Math.floor(camera / T.GAP) - 1), high = Math.ceil((camera + T.H) / T.GAP) + 1;
    for (let n = low; n <= high; n++) {
      if (broken && broken[n]) continue;
      const f = T.floorAt(seed, n), top = screenY(y, n * T.GAP, camera), left = x + T.platformX(f, frame);
      const tint = PALETTE[Math.floor(n / 25) % PALETTE.length];
      if (f.kind === "ground") {
        ctx.fillStyle = "rgba(255,142,203,.18)"; ctx.fillRect(x, top, T.W, T.H);
        ctx.fillStyle = tint; ctx.fillRect(x, top, T.W, 3);
      } else if (f.kind === "saucer") {                       // a landing saucer every 25 floors, with its number
        ctx.save(); ctx.shadowColor = tint; ctx.shadowBlur = 18; ctx.fillStyle = "rgba(20,8,30,.95)"; ctx.strokeStyle = tint; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(left + f.w / 2, top + 8, f.w / 2, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        ctx.fillStyle = tint; ctx.font = "800 20px " + G.colors().font; ctx.textAlign = "center"; ctx.fillText("FLOOR " + n, left + f.w / 2, top + 40);
      } else {
        cupRow(ctx, left, top, f.w, tint, f.kind, t);
      }
      if (n % 5 === 0 && n) {                                 // floor numbers on the wall
        ctx.fillStyle = "rgba(255,233,245,.6)"; ctx.font = "700 12px " + G.colors().font; ctx.textAlign = "left"; ctx.fillText(String(n), x + 2, top + 4);
      }
    }
    ctx.restore();
  }

  const game = {
    slug: "teacup-tower", name: "Teacup Tower",
    load: function () { /* every sound is synthesized (common.js) */ },
    create: function (seed, race) {
      const state = T.newGame(seed);
      state.started = race;                                   // a race starts on the countdown; solo on the first press
      return { state: state, nudge: 0, nudgeDir: 0, sparks: [], pops: [], flash: 0, squash: 1, blink: 0 };
    },
    step: function (g, keys, events) {
      const s = g.state;
      if (!s.started && (keys.left || keys.right)) s.started = true;
      const nudging = g.nudge > 0 ? (g.nudge--, g.nudgeDir) : 0;   // a remote's press steers for a moment
      T.step(s, { left: keys.left || nudging < 0, right: keys.right || nudging > 0 }, events);
      g.squash += (1 - g.squash) * 0.25;
      if (--g.blink < -180) g.blink = 8;
      if (Math.abs(s.vx) > 5 && !G.reducedMotion) g.sparks.push({ x: s.x, y: s.y + 30, life: 24, age: 0 });
      g.sparks = g.sparks.filter(function (p) { return ++p.age < p.life; });
      g.pops = g.pops.filter(function (p) { return ++p.age < 60; });
      if (g.flash > 0) g.flash--;
    },
    effects: function (g, events) {
      events.forEach(function (e) {
        if (e.type === "bounce") { g.squash = 0.78; G.sound.tone(480 + Math.min(e.floor, 60) * 6, 0.09, 0, 0.12, "sine", 760); }
        else if (e.type === "wall") G.sound.tone(260, 0.05, 0, 0.12, "square", 200);
        else if (e.type === "combo") {
          g.pops.push({ text: "COMBO ×" + e.combo, x: g.state.x, y: g.state.y + 90, age: 0 });
          [0, 0.06, 0.12].forEach(function (d, i) { G.sound.tone(660 * (1 + i * 0.25), 0.1, d, 0.14, "triangle"); });
        } else if (e.type === "combo-end" && e.combo >= 3) g.pops.push({ text: e.floors + " floors in one go!", x: g.state.x, y: g.state.y + 120, age: 0 });
        else if (e.type === "crack") G.sound.tone(900, 0.12, 0, 0.15, "sawtooth", 260);
        else if (e.type === "milestone") { g.pops.push({ text: "FLOOR " + e.floor + "!", x: T.W / 2, y: g.state.y + 140, age: 0 }); G.sound.tone(523, 0.3, 0, 0.18, "sine", 1046); }
        else if (e.type === "hurry") { g.flash = 90; G.sound.tone(880, 0.08, 0, 0.15, "square"); G.sound.tone(880, 0.08, 0.15, 0.15, "square"); }
        else if (e.type === "over") G.sound.tone(500, 0.8, 0, 0.25, "sawtooth", 60);
      });
    },
    action: function (g, action) {
      if (action === "left" || action === "right") { g.nudge = 14; g.nudgeDir = action === "left" ? -1 : 1; g.state.started = true; }
      else if (action === "enter" || action === "up") g.state.started = true;
    },
    pointer: function (g, x, y, down) {                       // hold a finger or the mouse button to one side of her
      if (!down && !g.pointing) return;
      g.pointing = down || g.pointing;
      g.nudge = 2; g.nudgeDir = x < g.state.x - 10 ? -1 : x > g.state.x + 10 ? 1 : 0;
      g.state.started = true;
    },
    pointerUp: function (g) { g.pointing = false; g.nudge = 0; },
    over: function (g) { return g.state.over; },
    claim: function (g) { return { score: g.state.best }; },
    board: function (g) { return T.board(g.state); },
    hud: function (g) { return "Floor " + g.state.best + (g.state.combo >= 2 ? " · Combo ×" + g.state.combo : "") + (g.state.rise ? " · rising" : ""); },
    boardHud: function (b) { return "Floor " + b.score + (b.alive ? "" : " · fell"); },
    waiting: function (g) { return g.state.started ? "" : "Press ◀ or ▶ to start climbing"; },

    drawArena: function (ctx, g, x, y, t, look) {
      const s = g.state;
      tower(ctx, x, y, s.seed, s.camera, s.frames, s.broken, t);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, T.W, T.H); ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      g.sparks.forEach(function (p) {
        ctx.globalAlpha = 1 - p.age / p.life; ctx.fillStyle = GLOW;
        ctx.beginPath(); ctx.arc(x + p.x, screenY(y, p.y, s.camera), 3, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      drawLumi(ctx, x + s.x, screenY(y, s.y, s.camera), 0.22, g.squash, s.vx * 0.02, g.blink > 0, look);
      g.pops.forEach(function (p) {
        ctx.globalAlpha = 1 - p.age / 60; ctx.fillStyle = "#ffe14d"; ctx.font = "800 26px " + G.colors().font; ctx.textAlign = "center";
        ctx.fillText(p.text, x + Math.max(90, Math.min(T.W - 90, p.x)), screenY(y, p.y + p.age, s.camera));
      });
      ctx.globalAlpha = 1;
      if (g.flash > 0 && Math.floor(g.flash / 10) % 2 === 0) {
        ctx.fillStyle = "#ff2e97"; ctx.font = "800 44px " + G.colors().font; ctx.textAlign = "center"; ctx.fillText("FASTER!", x + T.W / 2, y + 70);
      }
      ctx.restore();
      ctx.save(); ctx.shadowColor = "#ff8ecb"; ctx.shadowBlur = 16; ctx.strokeStyle = "#ff8ecb"; ctx.lineWidth = 3;   // Lumi's soft pink frame
      ctx.strokeRect(x - 4, y - 4, T.W + 8, T.H + 8); ctx.restore();
    },

    drawBoard: function (ctx, b, x, y, t, look) {             // another racer's climb (their own Lumi): their tower from the race's seed
      if (!b || !game.raceSeed) {
        ctx.fillStyle = "rgb(10,4,18)"; ctx.fillRect(x, y, T.W, T.H);
        ctx.fillStyle = "#b98aa9"; ctx.font = "600 22px " + G.colors().font; ctx.textAlign = "center";
        ctx.fillText("Waiting for their climb…", x + T.W / 2, y + T.H / 2);
        return;
      }
      // Boards arrive five times a second: glide the view and Lumi toward each one instead of stepping (one record
      // per side of the screen; a big change, like a new race, snaps).
      const worldY = b.height + b.points[1] * T.H, s = remote[x] || (remote[x] = { cam: b.height, x: b.points[0] * T.W, y: worldY, frame: b.frame });
      const glide = function (from, to) { return Math.abs(to - from) > 400 ? to : from + (to - from) * 0.2; };
      s.cam = glide(s.cam, b.height); s.x = glide(s.x, b.points[0] * T.W); s.y = glide(s.y, worldY);
      s.frame = b.frame > s.frame ? s.frame + Math.min(4, b.frame - s.frame) : b.frame;   // sliding cups keep moving smoothly
      tower(ctx, x, y, game.raceSeed, s.cam, s.frame, null, t);
      drawLumi(ctx, x + s.x, screenY(y, s.y, s.cam), 0.22, 1, 0, !b.alive, look);
      ctx.save(); ctx.shadowColor = "#ff8ecb"; ctx.shadowBlur = 16; ctx.strokeStyle = "#ff8ecb"; ctx.lineWidth = 3;   // Lumi's soft pink frame
      ctx.strokeRect(x - 4, y - 4, T.W + 8, T.H + 8); ctx.restore();
    },

    drawIdle: function (ctx, t, W, H, look) {                 // behind the menus: the name, a cup and Lumi bouncing on it
      cupRow(ctx, W - 300, 640, 140, "#00f0ff", "cup", t);   // to the right of the menu panel, so she's in view
      const hop = G.reducedMotion ? 0 : Math.abs(Math.sin(t / 380)) * 160;
      drawLumi(ctx, W - 230, 640 - hop, 0.34, 1, 0, false, look);
    },
  };

  window.Arcade.start(game);
})();
