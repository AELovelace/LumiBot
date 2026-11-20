/* Lumi Conga (the arcade's Snake, slug "snake"): lead a conga line of Lumis round a little dance floor. Your own Lumi
   leads (arcade/lumi-sprite.js draws her in her glow and outfit); every Lumi you pick up joins the end of the line in
   her own colour and keeps it: pink is 1 point, gold 5, aqua 10. The rules are Snake's (rules.js, replayed by the
   server before it pays); the menus, coins and showdowns are the shared arcade shell (games/arcade/arcade.js).

   Controls: the arrows (or a remote's) turn; up to two turns wait their turn, so quick corners work. In a solo game
   the first arrow starts it. On a touch screen, swipe the way to go. */
(function () {
  "use strict";

  const S = window.SnakeRules, G = window.MGame, L = window.LumiSprite;
  const CELL = 32, BW = S.W * CELL, BH = S.H * CELL;        // 640 x 480, like Yarn Pop's arena
  const GLOWS = { 1: "rose", 2: "rose", 3: "starlight", 4: "lagoon" };   // a dancer's (or a waiting Lumi's) colour by kind
  const LOOKS = {};
  Object.keys(GLOWS).forEach(function (k) { LOOKS[k] = { glow: GLOWS[k], outfit: {} }; });
  const DIRS = { right: 0, down: 1, left: 2, up: 3 };
  const TALL = 34;                                           // a dancer's height, a little over a square
  const GLIDE = 0.35;                                        // share of a move spent sliding into the new square

  function frame(ctx, x, y) {                               // the dance floor: soft tiles in a glowing frame
    ctx.save();
    ctx.fillStyle = "rgb(30,14,44)"; roundRect(ctx, x - 6, y - 6, BW + 12, BH + 12, 18); ctx.fill();
    for (let cx = 0; cx < S.W; cx++) for (let cy = 0; cy < S.H; cy++) {
      ctx.fillStyle = (cx + cy) % 2 ? "rgb(44,20,62)" : "rgb(52,24,72)";
      ctx.fillRect(x + cx * CELL, y + cy * CELL, CELL, CELL);
    }
    ctx.shadowColor = "#ff8ecb"; ctx.shadowBlur = 18; ctx.strokeStyle = "#ff8ecb"; ctx.lineWidth = 3;
    roundRect(ctx, x - 6, y - 6, BW + 12, BH + 12, 18); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "#fff8dc";           // fairy lights round the edge
    for (let i = 0; i < 24; i++) {
      const a = i / 24, px = a < .5 ? x + a * 2 * BW : x + (a - .5) * 2 * BW, py = a < .5 ? y - 6 : y + BH + 6;
      ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function waiting(ctx, x, y, f, t) {                       // a Lumi waiting to join, bobbing on her square, with her points
    if (!f || f.length < 3) return;
    const bob = G.reducedMotion ? 0 : Math.sin(t * 0.008) * 3, cx = x + (f[0] + 0.5) * CELL, cy = y + (f[1] + 1) * CELL - 3;
    L.draw(ctx, LOOKS[f[2]] || LOOKS[2], cx, cy + bob, TALL, { eyes: "happy", glow: .8 });
    ctx.save(); ctx.font = "800 11px " + G.colors().font; ctx.textAlign = "center"; ctx.fillStyle = "#fff8dc";
    ctx.fillText("+" + S.POINTS[f[2]], cx, cy - TALL - 4); ctx.restore();
  }

  // The conga line, tail first so the leader is drawn on top. points: their centres (canvas units), head first.
  function line(ctx, x, y, points, kinds, alive, leader, t) {
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i], ahead = points[i - 1] || [p[0] + (points[1] ? p[0] - points[1][0] : 1), p[1]];
      const flip = ahead[0] < p[0] - 0.01;                   // facing the way the line goes
      const hop = !alive || G.reducedMotion ? 0 : Math.abs(Math.sin(t * 0.012 - i * 0.7)) * 5;   // the conga's bounce, rolling down the line
      const kind = String(kinds[i] || 2), look = i === 0 ? leader : LOOKS[kind === "0" ? 2 : kind] || LOOKS[2];
      L.draw(ctx, look, x + p[0], y + p[1] + CELL / 2 - 3 - hop, i === 0 ? TALL + 4 : TALL,
             { flip: flip, eyes: alive ? (i === 0 ? "open" : "happy") : "closed", glow: i === 0 ? 1 : 0, tilt: alive ? Math.sin(t * 0.012 - i * 0.7) * 0.08 : 0 });
    }
  }

  function glide(f) {                                       // eased slide: quick into the new square, then she sits on it,
    const u = Math.min(1, f / GLIDE);                        // so what you see is where the game has her for most of the move
    return 1 - (1 - u) * (1 - u);
  }

  function spot(ctx, x, y, c) {                             // a soft pink tile under the leader's real square, for wall dodges
    ctx.save(); ctx.fillStyle = "rgba(255,142,203,.30)";
    roundRect(ctx, x + c[0] * CELL + 2, y + c[1] * CELL + 2, CELL - 4, CELL - 4, 8); ctx.fill(); ctx.restore();
  }

  function centres(body, prev, f) {                         // each dancer's centre, glided between her last square and this one
    return body.map(function (c, i) {                        // dancer i steps from where she was (prev[i]) into the square ahead
      const from = prev && prev[i] ? prev[i] : c;            // one who just joined has nowhere to glide from
      return [(from[0] + (c[0] - from[0]) * f + 0.5) * CELL, (from[1] + (c[1] - from[1]) * f + 0.5) * CELL];
    });
  }

  const game = {
    slug: "snake", name: "Lumi Conga",
    load: function (add) { add("eat", "assets/eat.wav", 2); },
    create: function (seed, race) {
      return { state: S.newGame(seed), queue: [], started: race, frames: 0, swipe: null, prev: null };
    },
    step: function (g, keys, events) {
      if (!g.started || !g.state.alive) return;
      if (++g.frames % S.FRAMES_PER_MOVE) return;            // one move every ten frames (rules.js)
      let dir = g.state.heading;
      while (g.queue.length) {                               // the next queued turn that isn't straight back
        const next = g.queue.shift();
        if (next !== dir && next !== (dir + 2) % 4) { dir = next; break; }
      }
      g.prev = g.state.body.map(function (c) { return c.slice(); });   // where everyone was, to glide from
      S.step(g.state, dir, events);
    },
    effects: function (g, events, play) {
      events.forEach(function (e) {
        if (e.type === "eat") { play("eat", 0.3); G.sound.tone([659.25, 783.99, 987.77][e.kind - 2] || 659.25, .12, .05, .12); }   // a little "hi!" as she joins
        else if (e.type === "die") G.sound.tone(330, 0.6, 0, 0.25, "triangle", 110);
      });
    },
    action: function (g, action) {
      if (action === "enter" && !g.started) { g.started = true; return; }
      if (!(action in DIRS)) return;
      g.started = true;
      if (g.queue.length < 2) g.queue.push(DIRS[action]);
    },
    pointer: function (g, x, y, down) { if (down) g.swipe = [x, y]; },
    pointerUp: function (g, at) {                            // a swipe turns that way
      if (!g.swipe) return;
      const dx = at.x - g.swipe[0], dy = at.y - g.swipe[1];
      g.swipe = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) { game.action(g, "enter"); return; }
      game.action(g, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    },
    over: function (g) { return !g.state.alive; },
    claim: function (g) { return { moves: g.state.moves, turns: g.state.turns, died: !g.state.alive }; },
    board: function (g) { return S.board(g.state); },
    hud: function (g) { return "Score " + g.state.score + " · " + g.state.body.length + " Lumis dancing"; },
    boardHud: function (b) { return "Score " + b.score + " · " + b.length + " Lumis" + (b.alive ? "" : " · out"); },
    waiting: function (g) { return g.started ? "" : "Press an arrow to start the conga"; },

    drawArena: function (ctx, g, x, y, t, look) {
      frame(ctx, x, y);
      waiting(ctx, x, y, g.state.food, t);
      const f = g.started && g.state.alive ? glide((g.frames % S.FRAMES_PER_MOVE) / S.FRAMES_PER_MOVE) : 1;
      if (g.state.alive) spot(ctx, x, y, g.state.body[0]);   // where the leader really is, under her feet
      line(ctx, x, y, centres(g.state.body, g.prev, f), g.state.kinds, g.state.alive, look || L.PLAIN, t);
    },

    drawBoard: function (ctx, b, x, y, t, look) {            // another racer's conga, from their live board
      frame(ctx, x, y);
      if (!b) {
        ctx.fillStyle = "#b98aa9"; ctx.font = "600 22px " + G.colors().font; ctx.textAlign = "center";
        ctx.fillText("Waiting for their conga…", x + BW / 2, y + BH / 2);
        return;
      }
      waiting(ctx, x, y, b.food, t);
      const points = [];
      for (let i = 0; i + 1 < b.points.length; i += 2) points.push([b.points[i] * BW, b.points[i + 1] * BH]);
      line(ctx, x, y, points, (b.kinds || "").split("").map(Number), b.alive, look || L.PLAIN, t);
    },

    drawIdle: function (ctx, t, W, H, look) {                // behind the menus (which carry the name): a conga dancing across
      const n = 9, speed = G.reducedMotion ? 0 : t * 0.06, points = [], kinds = [0];
      for (let i = 0; i < n; i++) {
        const along = ((speed - i * 46) % (W + 200) + W + 200) % (W + 200) - 100;
        points.push([along, 600 + Math.sin(along / 90) * 22]);
        if (i) kinds.push(2 + (i % 3));
      }
      line(ctx, 0, -16, points, kinds, true, look || L.PLAIN, t);
    },
  };

  window.Arcade.start(game);
})();
