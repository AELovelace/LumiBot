/* Yarn Pop (the arcade's Breakout, slug "breakout"): Lumi curls up into a ball and you bounce her off a cushion to pop
   every block of wound yarn. Her face says how fast she's going; multiball brings her friends in other colours; the
   falling power-ups are treats. The rules are Breakout's (rules.js, ported from Doll's GameMaker arcade and checked
   by the server before it pays); the menus, coins and showdowns are the shared arcade shell (games/arcade/arcade.js).
   Lumi herself, in the player's own glow, comes from arcade/lumi-sprite.js.

   Controls: ◀ ▶ (held on a keyboard) move the cushion, or point and drag; Enter, ▲, Space or a tap launches her.
   A remote's ◀ ▶ nudge the cushion along. */
(function () {
  "use strict";

  const R = window.BreakoutRules, G = window.MGame, L = window.LumiSprite;
  // Yarn colours for the six brick colours (rules.js codes 1-6): pink, honey, sky, mint, lilac, peach.
  const YARN = [null, "#ff9cc9", "#ffd36b", "#8cc8ff", "#8be9a8", "#c9a8ff", "#ffb48a"];
  const FRIENDS = ["lagoon", "starlight", "zephyr", "wisp", "umbra", "rose"];   // multiball: her friends' glows
  const SIZE = 1.6;                                          // Lumi is drawn a little bigger than the ball she bounces as

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function star(ctx, x, y, r) {                              // a four-pointed sparkle
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill();
  }

  // ---------------------------------------------------------------- arena
  function arenaBack(ctx, x, y) {                            // Lumi's playroom: a plum rug with little hearts, a soft pink frame
    ctx.save();
    const rug = ctx.createLinearGradient(0, y, 0, y + R.H);
    rug.addColorStop(0, "rgb(34,16,52)"); rug.addColorStop(1, "rgb(58,24,70)");
    ctx.fillStyle = rug; roundRect(ctx, x - 6, y - 6, R.W + 12, R.H + 12, 16); ctx.fill();
    ctx.fillStyle = "rgba(255,142,203,.07)";
    for (let hx = 0; hx < R.W; hx += 64) for (let hy = 24; hy < R.H; hy += 64) heart(ctx, x + hx + ((hy / 64) % 2 ? 32 : 0) + 16, y + hy, 7);
    ctx.shadowColor = "#ff8ecb"; ctx.shadowBlur = 18; ctx.strokeStyle = "#ff8ecb"; ctx.lineWidth = 3;
    roundRect(ctx, x - 6, y - 6, R.W + 12, R.H + 12, 16); ctx.stroke();
    ctx.restore();
  }

  function heart(ctx, x, y, r) {
    ctx.beginPath(); ctx.moveTo(x, y + r); ctx.bezierCurveTo(x - r * 1.6, y - r * .2, x - r * .7, y - r * 1.4, x, y - r * .4);
    ctx.bezierCurveTo(x + r * .7, y - r * 1.4, x + r * 1.6, y - r * .2, x, y + r); ctx.fill();
  }

  function blocks(ctx, cells, x, y, t) {                     // wound-yarn blocks, breathing softly
    const pulse = G.reducedMotion ? .5 : (Math.sin(t * 0.0024) + 1) / 2;
    cells.forEach(function (colour, i) {
      if (!colour) return;
      const r = R.brickRect(i), bx = x + r.x + 1, by = y + r.y + 1, w = r.w - 2, h = r.h - 2, c = YARN[colour] || YARN[6];
      ctx.save();
      ctx.shadowColor = c; ctx.shadowBlur = 4 + pulse * 6;
      ctx.fillStyle = c; roundRect(ctx, bx, by, w, h, 5); ctx.fill();
      ctx.shadowBlur = 0; ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 1.2;   // the wound strands
      ctx.beginPath(); for (let s = -h; s < w; s += 5) { ctx.moveTo(bx + s, by + h); ctx.lineTo(bx + s + h, by); } ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(bx, by, w, 3);   // a highlight along the top
      ctx.restore();
    });
  }

  function cushion(ctx, x, y, centre, half, t) {              // the bat: a stitched pink cushion with two tassels
    const top = y + R.BAT_Y - R.BAT_H / 2, left = x + centre - half, w = half * 2, h = R.BAT_H;
    ctx.save();
    ctx.shadowColor = "#ff8ecb"; ctx.shadowBlur = 10;
    const fill = ctx.createLinearGradient(0, top, 0, top + h);
    fill.addColorStop(0, "#ffd3ea"); fill.addColorStop(1, "#ff8ecb");
    ctx.fillStyle = fill; roundRect(ctx, left, top, w, h, h / 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(184,86,159,.7)"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);   // the stitching
    roundRect(ctx, left + 3, top + 3, w - 6, h - 6, (h - 6) / 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#ffd36b";                               // tassels
    [left + 2, left + w - 2].forEach(function (tx) { ctx.beginPath(); ctx.arc(tx, top + h / 2, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(tx - 1, top + h / 2, 2, 7); });
    ctx.restore();
  }

  // The falling treats (rules.js power-ups 0-4): a pillow (wider cushion), friends (multiball), a cookie (bigger),
  // a star wand (every Lumi aims at a block) and a sleepy moon (everything slows down).
  function treat(ctx, kind, px, py, t) {
    const cx = px + 16, cy = py + 8, bob = G.reducedMotion ? 0 : Math.sin(t * 0.01 + px) * 1.5;
    ctx.save(); ctx.translate(cx, cy + bob);
    ctx.shadowColor = "#fff8dc"; ctx.shadowBlur = 8;
    if (kind === 0) { ctx.fillStyle = "#ffb3da"; roundRect(ctx, -14, -6, 28, 12, 6); ctx.fill(); }
    else if (kind === 1) { ["#70ebea", "#ffdc83", "#c9a8ff"].forEach(function (c, i) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-9 + i * 9, 0, 5.5, 0, Math.PI * 2); ctx.fill(); }); }
    else if (kind === 2) { ctx.fillStyle = "#d9a066"; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#6b3f1f"; [[-3, -2], [3, 1], [-1, 4]].forEach(function (d) { ctx.beginPath(); ctx.arc(d[0], d[1], 1.6, 0, Math.PI * 2); ctx.fill(); }); }
    else if (kind === 3) { ctx.strokeStyle = "#fff8dc"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, 7); ctx.lineTo(2, -3); ctx.stroke(); ctx.fillStyle = "#ffdc83"; star(ctx, 5, -5, 8); }
    else { ctx.fillStyle = "#c9d4ff"; ctx.beginPath(); ctx.arc(0, 0, 8, Math.PI * 0.3, Math.PI * 1.7); ctx.arc(4, 0, 6.5, Math.PI * 1.55, Math.PI * 0.45, true); ctx.closePath(); ctx.fill(); }   // a crescent moon
    ctx.restore();
  }

  function lumiLook(i, own) { return i === 0 ? own : { glow: FRIENDS[(i - 1) % FRIENDS.length], outfit: {} }; }   // the first ball is her; the rest, friends

  // --------------------------------------------------------------- module
  const game = {
    slug: "breakout", name: "Yarn Pop",
    load: function (add) {
      for (let n = 2; n <= 9; n++) add("bounce-" + n, "assets/bounce-" + n + ".wav", 2);
      add("lost", "assets/ball-lost.wav", 1);
    },
    create: function (seed, race) {
      return { state: R.newGame(seed, { autoLaunch: race ? 90 : 0 }), target: null, launch: false,
               confetti: [], sparkles: [], spins: new Map(), cheer: 0 };
    },
    step: function (g, keys, events) {
      if (keys.left || keys.right) g.target = null;          // keys took over from the pointer
      R.step(g.state, { left: keys.left, right: keys.right, target: g.target, launch: g.launch }, events);
      g.launch = false;
      g.state.balls.forEach(function (b, i) {                 // she spins as she flies, and leaves sparkles in her glow
        const speed = Math.hypot(b.vx, b.vy);
        g.spins.set(b, (g.spins.get(b) || 0) + (b.go ? speed * 0.035 * (b.vx >= 0 ? 1 : -1) : 0));
        if (!b.go || G.reducedMotion || g.state.frames % 3) return;
        g.sparkles.push({ x: b.x, y: b.y, life: 26, age: 0, glow: i === 0 ? null : FRIENDS[(i - 1) % FRIENDS.length] });
      });
      g.sparkles = g.sparkles.filter(function (s) { return ++s.age < s.life; });
      g.confetti = g.confetti.filter(function (p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.vx *= 0.97; p.spin += p.vx * 0.1;
        return ++p.age < p.life;
      });
      if (g.cheer > 0) g.cheer--;
    },
    effects: function (g, events, play) {
      events.forEach(function (e) {
        if (e.type === "bounce") play("bounce-" + (2 + Math.floor(Math.random() * 8)), 0.5);
        else if (e.type === "lost") play("lost", 0.3);
        else if (e.type === "brick" && !G.reducedMotion) {   // the block pops into star confetti in its colour
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
            g.confetti.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, size: 4 + Math.random() * 5, spin: 0,
                              colour: YARN[e.colour] || YARN[6], life: 22 + Math.random() * 14, age: 0 });
          }
        } else if (e.type === "power") { G.sound.tone(784, 0.14, 0, 0.18, "triangle", 1046.5); G.sound.tone(1046.5, 0.16, .08, 0.14, "triangle"); }
        else if (e.type === "level") { g.cheer = 90; G.sound.tone(660, 0.3, 0, 0.25, "sine", 1320); }
        else if (e.type === "over") G.sound.tone(392, 0.7, 0, 0.25, "triangle", 98);
      });
    },
    action: function (g, action) {
      if (action === "enter" || action === "up") g.launch = true;
      else if (action === "left" || action === "right") {   // a remote: nudge the cushion a good way along
        const from = typeof g.target === "number" ? g.target : g.state.bat;
        g.target = Math.max(0, Math.min(R.W, from + (action === "left" ? -96 : 96)));
      }
    },
    pointer: function (g, x, y, down) {
      if (x >= -40 && x <= R.W + 40) g.target = x;
      if (down) g.launch = true;
    },
    over: function (g) { return g.state.over; },
    claim: function (g) { return { score: g.state.score, level: g.state.level }; },
    board: function (g) { return R.board(g.state); },
    hud: function (g) { return "Score " + g.state.score + " · Level " + g.state.level + " · Lives " + "♥".repeat(Math.max(0, g.state.lives)); },
    boardHud: function (b) { return "Score " + b.score + " · Level " + b.level + " · " + "♥".repeat(b.lives || 0); },
    waiting: function (g) { return g.state.balls.some(function (b) { return !b.go; }) && !g.state.autoLaunch ? "Enter, ▲ or a tap launches Lumi" : ""; },

    drawArena: function (ctx, g, x, y, t, look) {
      const s = g.state, own = look || L.PLAIN;
      arenaBack(ctx, x, y);
      blocks(ctx, s.bricks, x, y, t);
      s.powerUps.forEach(function (p) { treat(ctx, p.kind, x + p.x, y + p.y, t); });
      cushion(ctx, x, y, s.bat, R.batHalf(s), t);
      ctx.save();
      g.sparkles.forEach(function (sp) {                       // her trail
        ctx.globalAlpha = Math.max(0, 0.7 * (1 - sp.age / sp.life)); ctx.fillStyle = L.palette(sp.glow ? { glow: sp.glow } : own).glow;
        star(ctx, x + sp.x, y + sp.y, 3 + 4 * (1 - sp.age / sp.life));
      });
      g.confetti.forEach(function (p) {
        ctx.globalAlpha = 1 - p.age / p.life; ctx.fillStyle = p.colour;
        ctx.save(); ctx.translate(x + p.x, y + p.y); ctx.rotate(p.spin); star(ctx, 0, 0, p.size); ctx.restore();
      });
      ctx.restore();
      s.balls.forEach(function (b, i) {
        const speed = Math.min(1, Math.hypot(b.vx, b.vy) / R.MAX_SPEED);
        L.ball(ctx, lumiLook(i, own), x + b.x, y + b.y, R.radius(b) * SIZE, g.spins.get(b) || 0, b.go ? speed : 0);
      });
      if (g.cheer > 0) {                                       // a new level: Lumi cheers over the field
        L.draw(ctx, own, x + R.W / 2, y + R.H / 2 + 40, 110, { eyes: "happy", alpha: Math.min(1, g.cheer / 30) });
      }
    },

    drawBoard: function (ctx, b, x, y, t, look) {            // another racer's game, from their live board
      arenaBack(ctx, x, y);
      if (!b) {
        ctx.fillStyle = "#b98aa9"; ctx.font = "600 22px " + G.colors().font; ctx.textAlign = "center";
        ctx.fillText("Waiting for their game…", x + R.W / 2, y + R.H / 2);
        return;
      }
      blocks(ctx, b.bricks.split("").map(Number), x, y, t);
      cushion(ctx, x, y, b.bat * R.W, R.BAT_W * (b.wide ? 1.5 : 1) / 2, t);
      b.balls.forEach(function (p, i) { L.ball(ctx, lumiLook(i, look || L.PLAIN), x + p[0] * R.W, y + p[1] * R.H, R.RADIUS * SIZE, t * 0.006, .5); });
    },

    drawIdle: function (ctx, t, W, H, look) {                // behind the menus (which carry the name): blocks, and Lumi bouncing on her cushion
      const row = [];
      for (let i = 0; i < 18; i++) row.push(1 + (i % 6));
      blocks(ctx, row, W / 2 - R.W / 2, 140, t);
      const hop = G.reducedMotion ? 0.5 : Math.abs(Math.sin(t / 420)), bx = W - 220 + (G.reducedMotion ? 0 : Math.sin(t / 1300) * 60);   // to the right of the menu, so she's in view
      cushion(ctx, 0, 140, bx, 40, t);
      L.ball(ctx, look || L.PLAIN, bx, 140 + R.BAT_Y - 24 - hop * 150, 18, t * 0.004, hop > .6 ? .2 : .55);
    },
  };

  window.Arcade.start(game);
})();
