/* Lumi-Soft's art, drawn with canvas paths in scene units (2732 x 1536), so it stays sharp through the Star Scope at
   any zoom. Everything is authored here: the six backdrops, the cover props, the cardboard creature standees (Lumi
   Dungeons' creatures, as cut-outs on little wooden stands), friends with ♡ signs, pickups, the five bosses, the
   Sparkle Popper and Lumi's paws. Nothing a person typed is drawn. game.js decides where things are (rules.js pose);
   this file only knows how they look. A toy and a cardboard fair: no real-gun shapes anywhere. */
(function (root, make) {
  const art = make();                                                                // build the module once
  if (typeof module === "object" && module.exports) module.exports = art; else root.LumiSoftArt = art;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const INK = "#462846", CARD = "#e9cfa4", CARD_EDGE = "#b98d5a", PINK = "#ff8ecb", LILAC = "#c9a8ff", GOLD = "#ffdc83", MINT = "#8be9a8", AQUA = "#70ebea";
  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------ little helpers */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); } // a rounded rectangle path
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); }                          // a circle path
  function fillStroke(c, fill, stroke, width) { if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = width || 2; c.stroke(); } }
  function star(c, x, y, r, points, inner) { // a star path with `points` points
    c.beginPath();
    for (let i = 0; i < points * 2; i++) { const a = i * Math.PI / points - Math.PI / 2, d = i % 2 ? r * (inner || 0.45) : r; c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
    c.closePath();
  }
  function heart(c, x, y, s) { // a heart path, centred on (x, y), s wide-ish
    c.beginPath(); c.moveTo(x, y + s * 0.55);
    c.bezierCurveTo(x - s * 1.1, y - s * 0.1, x - s * 0.5, y - s * 0.9, x, y - s * 0.3);
    c.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 1.1, y - s * 0.1, x, y + s * 0.55); c.closePath();
  }
  function face(c, x, y, s, mood) { // two eyes and a mouth; mood "grin" (a creature) or "smile" (a friend)
    c.fillStyle = INK; c.strokeStyle = INK; c.lineWidth = 2.4 * s; c.lineCap = "round";
    c.beginPath(); c.ellipse(x - 9 * s, y, 2.8 * s, 4 * s, 0, 0, TAU); c.ellipse(x + 9 * s, y, 2.8 * s, 4 * s, 0, 0, TAU); c.fill();
    c.beginPath();
    if (mood === "grin") { c.moveTo(x - 7 * s, y + 7 * s); c.lineTo(x - 3 * s, y + 10 * s); c.lineTo(x, y + 7 * s); c.lineTo(x + 3 * s, y + 10 * s); c.lineTo(x + 7 * s, y + 7 * s); }
    else { c.moveTo(x - 6 * s, y + 7 * s); c.quadraticCurveTo(x, y + 13 * s, x + 6 * s, y + 7 * s); }
    c.stroke();
    c.fillStyle = "rgba(255,142,203,.55)"; c.beginPath(); c.ellipse(x - 15 * s, y + 6 * s, 5 * s, 2.6 * s, 0, 0, TAU); c.ellipse(x + 15 * s, y + 6 * s, 5 * s, 2.6 * s, 0, 0, TAU); c.fill();
  }

  /* ------------------------------------------------------------ backdrops */
  function sky(c, top, bottom) { const g = c.createLinearGradient(0, 0, 0, 1536); g.addColorStop(0, top); g.addColorStop(1, bottom); c.fillStyle = g; c.fillRect(0, 0, 2732, 1536); }
  function hills(c, y, color, bumps, seed) { // a row of soft hills along y
    c.beginPath(); c.moveTo(0, 1536); c.lineTo(0, y);
    for (let i = 0; i <= bumps; i++) { const x = i * 2732 / bumps, h = 60 + ((i * 37 + seed * 13) % 7) * 18; c.quadraticCurveTo(x - 2732 / bumps / 2, y - h, x, y); }
    c.lineTo(2732, 1536); c.closePath(); c.fillStyle = color; c.fill();
  }
  function cloud(c, x, y, s, color) { c.fillStyle = color; c.beginPath(); [[0, 0, 60], [55, -20, 70], [120, 0, 55], [60, 20, 60]].forEach(function (b) { c.moveTo(x + b[0] * s + b[2] * s, y + b[1] * s); c.arc(x + b[0] * s, y + b[1] * s, b[2] * s, 0, TAU); }); c.fill(); }
  function bunting(c, x1, x2, y, sag, colors) { // a string of little triangle flags
    c.strokeStyle = "#fff6"; c.lineWidth = 3; c.beginPath(); c.moveTo(x1, y); c.quadraticCurveTo((x1 + x2) / 2, y + sag, x2, y); c.stroke();
    for (let i = 1; i < 14; i++) {
      const t = i / 14, x = x1 + (x2 - x1) * t, yy = y + 2 * sag * t * (1 - t);
      c.beginPath(); c.moveTo(x - 18, yy); c.lineTo(x + 18, yy); c.lineTo(x, yy + 38); c.closePath(); c.fillStyle = colors[i % colors.length]; c.fill();
    }
  }
  function bullseye(c, x, y, r) { [PINK, "#fff", PINK, "#fff", GOLD].forEach(function (col, i) { circle(c, x, y, r * (1 - i * 0.2)); c.fillStyle = col; c.fill(); }); }

  const BACKDROPS = {
    range: function (c) {                                      // the Training Range: a sunny meadow with bullseye boards
      sky(c, "#9fd8ff", "#ffe6f4");
      cloud(c, 300, 220, 1.2, "#fff"); cloud(c, 1500, 160, 1.5, "#fff"); cloud(c, 2300, 260, 1, "#fff");
      hills(c, 760, "#b8e6c4", 6, 1); hills(c, 900, "#9fdcb0", 5, 3);
      [[400, 640], [2350, 620]].forEach(function (b) { c.fillStyle = "#c98f5a"; c.fillRect(b[0] - 8, b[1], 16, 200); bullseye(c, b[0], b[1] - 40, 90); });
      bunting(c, 0, 2732, 120, 140, [PINK, LILAC, GOLD, MINT, AQUA]);
      c.fillStyle = "#c7f0cf"; c.fillRect(0, 1000, 2732, 536);
    },
    morning: function (c) {                                    // the Stardust Garden: pastel morning, rows of flowers
      sky(c, "#ffd9ec", "#fff6dd");
      circle(c, 2300, 260, 120); c.fillStyle = "#fff3c4"; c.fill();
      cloud(c, 500, 260, 1.3, "#fff"); cloud(c, 1600, 200, 1, "#fff");
      hills(c, 640, "#cfeccc", 7, 2); hills(c, 760, "#b5e3b8", 6, 5);
      for (let i = 0; i < 160; i++) { const x = (i * 173) % 2732, y = 800 + ((i * 71) % 700); circle(c, x, y, 7); c.fillStyle = [PINK, LILAC, GOLD, "#fff"][i % 4]; c.fill(); }
      c.fillStyle = "#a6dcae"; c.fillRect(0, 1380, 2732, 160);
    },
    sunset: function (c) {                                     // Teacup Tower: rooftops at sunset, a giant teapot on the skyline
      sky(c, "#ff9fb8", "#ffd7a3");
      circle(c, 1366, 520, 220); c.fillStyle = "#fff0b8"; c.fill();
      c.fillStyle = "#b46a8d";
      [[0, 520, 380], [420, 470, 300], [820, 540, 420], [1340, 440, 360], [1800, 500, 300], [2200, 460, 532]].forEach(function (b) { c.fillRect(b[0], b[1], b[2], 1100); });
      c.fillStyle = "#9b5579"; rr(c, 1180, 230, 380, 260, 120); c.fill(); rr(c, 1520, 300, 140, 40, 20); c.fill(); rr(c, 1310, 190, 120, 50, 20); c.fill(); // the teapot
      c.fillStyle = "#ffe3a3"; for (let i = 0; i < 40; i++) { c.fillRect(60 + (i * 271) % 2620, 560 + (i * 97) % 600, 26, 36); }  // lit windows
      bunting(c, 0, 1366, 300, 90, [PINK, GOLD, LILAC]); bunting(c, 1366, 2732, 320, 90, [AQUA, PINK, GOLD]);
    },
    neon: function (c) {                                       // Lumi's Lounge: plum walls, neon signs, chandeliers
      sky(c, "#2a1440", "#140a24");
      for (let x = 0; x < 2732; x += 120) { c.fillStyle = x % 240 ? "#2f1748" : "#33194e"; c.fillRect(x, 0, 120, 1536); }
      [[500, 420], [1366, 340], [2232, 420]].forEach(function (p) {                       // chandeliers (the Bell Phantom hops between them)
        c.strokeStyle = GOLD; c.lineWidth = 4; c.beginPath(); c.moveTo(p[0], 0); c.lineTo(p[0], p[1] - 90); c.stroke();
        c.beginPath(); c.ellipse(p[0], p[1] - 60, 120, 34, 0, 0, TAU); c.fillStyle = "#ffe9a8"; c.fill();
        for (let i = -3; i <= 3; i++) { circle(c, p[0] + i * 34, p[1] - 30 + Math.abs(i) * -4, 9); c.fillStyle = "#fff8d9"; c.fill(); }
      });
      c.shadowBlur = 30; c.shadowColor = PINK; c.strokeStyle = PINK; c.lineWidth = 8;
      rr(c, 980, 120, 772, 120, 60); c.stroke(); c.shadowColor = AQUA; c.strokeStyle = AQUA; star(c, 1080, 180, 34, 5); c.stroke(); star(c, 1652, 180, 34, 5); c.stroke(); c.shadowBlur = 0;
      c.fillStyle = "#3d1f55"; c.fillRect(0, 1180, 2732, 356);
      c.fillStyle = "#4a2766"; for (let x = 0; x < 2732; x += 90) c.fillRect(x, 1180, 45, 356);   // a checked carpet
    },
    dark: function (c) {                                       // the Deep Dungeon: stone, torches, glowing moss
      sky(c, "#1b1430", "#0c0917");
      c.strokeStyle = "#2a2142"; c.lineWidth = 4;
      for (let y = 40; y < 1536; y += 80) for (let x = (y / 80) % 2 ? 0 : 70; x < 2732; x += 140) { rr(c, x, y, 130, 70, 10); c.stroke(); }
      [[300, 420], [1366, 360], [2430, 420]].forEach(function (p) {                     // torches: the only warm light
        const g = c.createRadialGradient(p[0], p[1], 10, p[0], p[1], 300); g.addColorStop(0, "rgba(255,190,110,.45)"); g.addColorStop(1, "rgba(255,190,110,0)");
        c.fillStyle = g; c.fillRect(p[0] - 300, p[1] - 300, 600, 600);
        c.fillStyle = "#6b4a2f"; c.fillRect(p[0] - 10, p[1], 20, 90); circle(c, p[0], p[1] - 10, 26); c.fillStyle = "#ffb86b"; c.fill();
      });
      for (let i = 0; i < 70; i++) { circle(c, (i * 389) % 2732, 1100 + (i * 53) % 420, 6); c.fillStyle = i % 2 ? "rgba(139,233,168,.5)" : "rgba(112,235,234,.4)"; c.fill(); }
    },
    fireworks: function (c) {                                  // the Night Fair: a starry sky, a Ferris wheel, strings of lights
      sky(c, "#1d1140", "#46205e");
      for (let i = 0; i < 120; i++) { circle(c, (i * 523) % 2732, (i * 211) % 700, (i % 3) + 1.5); c.fillStyle = "#fff8"; c.fill(); }
      c.strokeStyle = "#ffb3d9"; c.lineWidth = 10; circle(c, 1900, 700, 320); c.stroke();               // the Ferris wheel's rim and spokes
      c.lineWidth = 5; for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.beginPath(); c.moveTo(1900, 700); c.lineTo(1900 + Math.cos(a) * 320, 700 + Math.sin(a) * 320); c.stroke(); }
      c.fillStyle = "#7a55c0"; c.beginPath(); c.moveTo(1900, 700); c.lineTo(1700, 1180); c.lineTo(2100, 1180); c.closePath(); c.fill();
      circle(c, 1900, 700, 30); c.fillStyle = GOLD; c.fill();
      for (let row = 0; row < 3; row++) for (let x = 0; x < 2732; x += 60) { circle(c, x + row * 20, 300 + row * 140 + Math.abs(((x / 60) % 10) - 5) * 8, 7); c.fillStyle = [PINK, GOLD, AQUA, LILAC][(x / 60 + row) % 4]; c.fill(); }
      c.fillStyle = "#2c1748"; c.fillRect(0, 1260, 2732, 276);
    },
  };

  function fireworks(c, time) { // The Night Fair's sky, alive: bursts that bloom and fade (decoration only, never in the way).
    for (let i = 0; i < 4; i++) {
      const life = (time / 60 + i * 1.3) % 5.2, x = 300 + ((i * 677) % 1300), y = 180 + ((i * 131) % 260), r = Math.min(1, life / 1.2) * 150;
      if (life > 2.6) continue;
      c.globalAlpha = Math.max(0, 1 - life / 2.6);
      for (let k = 0; k < 14; k++) { const a = k * TAU / 14; circle(c, x + Math.cos(a) * r, y + Math.sin(a) * r, 7); c.fillStyle = [PINK, GOLD, AQUA, LILAC][(i + k) % 4]; c.fill(); }
      c.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------ cover props (drawn in front of what's behind them) */
  const PROPS = {
    hedge: function (c, x, y, w, h) { c.fillStyle = "#7fc49a"; rr(c, x - w / 2, y - 10, w, h + 30, 40); c.fill(); for (let i = 0; i < w / 50; i++) { circle(c, x - w / 2 + 25 + i * 50, y - 6, 30); c.fill(); } for (let i = 0; i < w / 70; i++) { circle(c, x - w / 2 + 35 + i * 70, y + 20, 8); c.fillStyle = [PINK, "#fff", GOLD][i % 3]; c.fill(); c.fillStyle = "#7fc49a"; } },
    flowerbed: function (c, x, y, w, h) { c.fillStyle = "#b07a55"; rr(c, x - w / 2, y + 10, w, h, 18); c.fill(); for (let i = 0; i < w / 34; i++) { const fx = x - w / 2 + 17 + i * 34; c.fillStyle = "#6fb987"; c.fillRect(fx - 3, y - 20, 6, 32); star(c, fx, y - 26, 16, 5, 0.55); c.fillStyle = [PINK, LILAC, GOLD, "#fff"][i % 4]; c.fill(); } },
    fence: function (c, x, y, w, h) { c.fillStyle = "#fff1f7"; for (let px = x - w / 2; px < x + w / 2; px += 46) { c.beginPath(); c.moveTo(px, y + h + 20); c.lineTo(px, y + 8); c.lineTo(px + 17, y - 14); c.lineTo(px + 34, y + 8); c.lineTo(px + 34, y + h + 20); c.closePath(); c.fill(); } c.fillRect(x - w / 2, y + 30, w, 18); c.fillRect(x - w / 2, y + h - 10, w, 18); },
    bench: function (c, x, y, w, h) { c.fillStyle = "#c98f5a"; rr(c, x - w / 2, y, w, 30, 8); c.fill(); c.fillStyle = "#a8703f"; c.fillRect(x - w / 2 + 30, y + 30, 26, h); c.fillRect(x + w / 2 - 56, y + 30, 26, h); },
    hay: function (c, x, y, w, h) { c.fillStyle = "#f2d27a"; rr(c, x - w / 2, y - 10, w, h + 20, 26); c.fill(); c.strokeStyle = "#d9b25a"; c.lineWidth = 4; for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(x - w / 2 + 20, y + 10 + i * 16); c.lineTo(x + w / 2 - 20, y + 4 + i * 16); c.stroke(); } },
    balcony: function (c, x, y, w, h) { c.fillStyle = "#c97ba0"; c.fillRect(x - w / 2, y - 190, w, 190 + h); c.fillStyle = "#ffe3a3"; c.fillRect(x - w / 2 + 30, y - 160, w - 60, 110); c.fillStyle = "#fff1f7"; c.fillRect(x - w / 2 - 10, y - 4, w + 20, 16); for (let px = x - w / 2; px <= x + w / 2; px += 30) c.fillRect(px, y + 12, 8, h - 10); },
    rail: function (c, x, y, w, h) { c.fillStyle = "#fff1f7"; c.fillRect(x - w / 2, y - 4, w, 14); c.fillRect(x - w / 2, y + h - 14, w, 14); for (let px = x - w / 2; px <= x + w / 2; px += 36) c.fillRect(px, y, 10, h); },
    slots: function (c, x, y, w, h) { c.fillStyle = "#ff8ecb"; rr(c, x - w / 2, y - 270, w, 270 + h, 36); c.fill(); c.fillStyle = "#fff5fb"; rr(c, x - w / 2 + 26, y - 210, w - 52, 100, 14); c.fill(); [0, 1, 2].forEach(function (i) { star(c, x - w / 2 + 60 + i * ((w - 120) / 2), y - 160, 22, 5); c.fillStyle = [PINK, GOLD, AQUA][i]; c.fill(); }); c.fillStyle = GOLD; circle(c, x + w / 2 - 10, y - 220, 16); c.fill(); },
    table: function (c, x, y, w, h) { c.fillStyle = "#3f9a63"; c.beginPath(); c.ellipse(x, y + 20, w / 2, 46, 0, 0, TAU); c.fill(); c.strokeStyle = GOLD; c.lineWidth = 6; c.stroke(); c.fillStyle = "#5a3a6e"; c.fillRect(x - w / 2 + 10, y + 20, w - 20, h); },
    bar: function (c, x, y, w, h) { c.fillStyle = "#6b3d7e"; rr(c, x - w / 2, y, w, h + 40, 14); c.fill(); c.fillStyle = "#ffb3d9"; c.fillRect(x - w / 2 - 10, y - 6, w + 20, 18); },
    pillar: function (c, x, y, w, h) { c.fillStyle = "#3a2d55"; c.fillRect(x - w / 2, y - 380, w, 380 + h); c.strokeStyle = "#4b3b6b"; c.lineWidth = 4; for (let py = y - 360; py < y + h; py += 60) { c.beginPath(); c.moveTo(x - w / 2, py); c.lineTo(x + w / 2, py); c.stroke(); } },
    crate: function (c, x, y, w, h) { c.fillStyle = "#a8703f"; c.fillRect(x - w / 2, y - 8, w, h + 30); c.strokeStyle = "#7d5230"; c.lineWidth = 8; c.strokeRect(x - w / 2, y - 8, w, h + 30); c.beginPath(); c.moveTo(x - w / 2, y - 8); c.lineTo(x + w / 2, y + h + 22); c.stroke(); },
    barrel: function (c, x, y, w, h) { c.fillStyle = "#8a5a35"; c.beginPath(); c.ellipse(x, y + h / 2, w / 2, h / 2 + 30, 0, 0, TAU); c.fill(); c.strokeStyle = "#5c3b22"; c.lineWidth = 8; [y + 10, y + h - 10].forEach(function (yy) { c.beginPath(); c.moveTo(x - w / 2 + 10, yy); c.lineTo(x + w / 2 - 10, yy); c.stroke(); }); },
    stall: function (c, x, y, w, h) { c.fillStyle = "#fff5fb"; c.fillRect(x - w / 2, y, w, h + 30); for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? PINK : "#fff"; c.beginPath(); const sx = x - w / 2 + i * w / 8; c.moveTo(sx, y - 210); c.lineTo(sx + w / 8, y - 210); c.lineTo(sx + w / 8, y - 160); c.quadraticCurveTo(sx + w / 16, y - 130, sx, y - 160); c.closePath(); c.fill(); } c.fillStyle = "#c98f5a"; c.fillRect(x - w / 2, y - 160, 14, 160); c.fillRect(x + w / 2 - 14, y - 160, 14, 160); },
  };
  const PROP_UP = { balcony: 190, slots: 270, pillar: 380, stall: 210 };      // how far each prop reaches above its ground line

  function prop(c, p) { const f = PROPS[p.look] || PROPS.crate; c.save(); f(c, p.x, p.y, p.w, p.h); c.restore(); }

  /* ------------------------------------------------------------ cardboard creatures */
  // Each body is drawn in a 100 x 131 box, bottom-centre at (0, 0); game.js scales it and lowers a pop-up into its cover.
  const BODIES = {
    "dust-bunny": function (c) { c.fillStyle = "#d9cfe8"; c.beginPath(); c.ellipse(-22, -112, 12, 26, -0.2, 0, TAU); c.ellipse(22, -112, 12, 26, 0.2, 0, TAU); c.fill(); circle(c, 0, -52, 44); c.fill(); for (let i = 0; i < 10; i++) { circle(c, Math.cos(i) * 40, -52 + Math.sin(i) * 40, 10); c.fill(); } face(c, 0, -62, 1, "grin"); },
    "puddle-slime": function (c) { c.fillStyle = "#70ebea"; c.beginPath(); c.moveTo(-46, -6); c.quadraticCurveTo(-50, -100, 0, -110); c.quadraticCurveTo(50, -100, 46, -6); c.closePath(); c.fill(); c.fillStyle = "#fff8"; c.beginPath(); c.ellipse(-18, -80, 8, 14, 0.4, 0, TAU); c.fill(); face(c, 0, -56, 1, "grin"); },
    thornling: function (c) { c.fillStyle = "#6fb987"; c.fillRect(-6, -60, 12, 56); [-1, 1].forEach(function (d) { c.beginPath(); c.ellipse(d * 26, -60, 26, 12, d * 0.5, 0, TAU); c.fill(); }); circle(c, 0, -92, 34); c.fill(); c.fillStyle = "#3f9a63"; for (let i = 0; i < 6; i++) { const a = i * TAU / 6; c.beginPath(); c.moveTo(Math.cos(a) * 30, -92 + Math.sin(a) * 30); c.lineTo(Math.cos(a) * 44, -92 + Math.sin(a) * 44); c.lineTo(Math.cos(a + 0.3) * 30, -92 + Math.sin(a + 0.3) * 30); c.fill(); } face(c, 0, -94, 0.9, "grin"); },
    "static-sprite": function (c) { star(c, 0, -66, 58, 7, 0.6); c.fillStyle = GOLD; c.fill(); c.strokeStyle = "#e8a83a"; c.lineWidth = 3; c.stroke(); face(c, 0, -66, 1, "grin"); },
    "gloom-bat": function (c) { c.fillStyle = "#7a55c0"; [-1, 1].forEach(function (d) { c.beginPath(); c.moveTo(d * 20, -70); c.quadraticCurveTo(d * 70, -120, d * 50, -40); c.quadraticCurveTo(d * 40, -60, d * 20, -40); c.fill(); }); circle(c, 0, -62, 30); c.fill(); c.beginPath(); c.moveTo(-18, -86); c.lineTo(-10, -106); c.lineTo(-4, -88); c.moveTo(18, -86); c.lineTo(10, -106); c.lineTo(4, -88); c.fill(); face(c, 0, -62, 0.85, "grin"); },
    "frost-moth": function (c) { c.fillStyle = "#d2f2fc"; [-1, 1].forEach(function (d) { c.beginPath(); c.ellipse(d * 32, -84, 30, 22, d * 0.4, 0, TAU); c.ellipse(d * 26, -46, 22, 16, -d * 0.3, 0, TAU); c.fill(); }); c.fillStyle = "#9fc6e6"; c.beginPath(); c.ellipse(0, -64, 14, 40, 0, 0, TAU); c.fill(); face(c, 0, -84, 0.7, "grin"); },
    "cinder-mite": function (c) { c.strokeStyle = "#b8562f"; c.lineWidth = 5; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(-30, -40 + i * 12); c.lineTo(-50, -20 + i * 14); c.moveTo(30, -40 + i * 12); c.lineTo(50, -20 + i * 14); c.stroke(); } circle(c, 0, -56, 40); c.fillStyle = "#ff9f6b"; c.fill(); c.fillStyle = GOLD; circle(c, 0, -96, 10); c.fill(); face(c, 0, -60, 1, "grin"); },
    "lantern-imp": function (c) { c.fillStyle = "#c26fb5"; circle(c, -6, -66, 34); c.fill(); c.beginPath(); c.moveTo(-30, -86); c.lineTo(-40, -118); c.lineTo(-16, -96); c.moveTo(18, -86); c.lineTo(28, -118); c.lineTo(4, -96); c.fill(); face(c, -6, -70, 0.9, "grin"); c.fillStyle = GOLD; rr(c, 26, -66, 22, 30, 6); c.fill(); c.strokeStyle = "#8a5a35"; c.lineWidth = 3; c.beginPath(); c.moveTo(37, -66); c.lineTo(37, -78); c.stroke(); },
    "tin-sentinel": function (c) { c.fillStyle = "#c8cde0"; rr(c, -34, -110, 68, 60, 12); c.fill(); rr(c, -40, -54, 80, 50, 12); c.fill(); c.strokeStyle = "#8e93ad"; c.lineWidth = 3; c.stroke(); c.fillStyle = PINK; circle(c, 0, -122, 7); c.fill(); c.strokeStyle = "#8e93ad"; c.beginPath(); c.moveTo(0, -116); c.lineTo(0, -110); c.stroke(); face(c, 0, -84, 0.9, "grin"); },
    "shade-cat": function (c) { c.fillStyle = "#3d3f8f"; circle(c, 0, -56, 40); c.fill(); c.beginPath(); c.moveTo(-34, -78); c.lineTo(-30, -118); c.lineTo(-8, -94); c.moveTo(34, -78); c.lineTo(30, -118); c.lineTo(8, -94); c.fill(); c.fillStyle = "#c9f0ff"; c.beginPath(); c.ellipse(-14, -62, 6, 9, 0, 0, TAU); c.ellipse(14, -62, 6, 9, 0, 0, TAU); c.fill(); c.strokeStyle = "#c9f0ff"; c.lineWidth = 2.4; c.beginPath(); c.moveTo(-6, -44); c.lineTo(0, -40); c.lineTo(6, -44); c.stroke(); },
    can: function (c) { c.fillStyle = "#e0e6f5"; rr(c, -30, -110, 60, 108, 8); c.fill(); c.fillStyle = PINK; c.fillRect(-30, -80, 60, 46); c.fillStyle = "#fff"; star(c, 0, -57, 16, 5); c.fill(); },
    balloon: function (c) { c.strokeStyle = "#fff9"; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -40); c.quadraticCurveTo(10, -20, 0, 0); c.stroke(); c.fillStyle = PINK; c.beginPath(); c.ellipse(0, -84, 40, 48, 0, 0, TAU); c.fill(); c.fillStyle = "#fff7"; c.beginPath(); c.ellipse(-14, -100, 8, 14, 0.4, 0, TAU); c.fill(); },
  };
  const FRIENDS = {                                            // friends: always smiling, always holding a ♡ sign
    "friend-lumi": function (c) { c.fillStyle = "#fce1f2"; circle(c, 0, -56, 36); c.fill(); c.fillStyle = PINK; c.beginPath(); c.moveTo(-30, -76); c.lineTo(-28, -112); c.lineTo(-8, -88); c.moveTo(30, -76); c.lineTo(28, -112); c.lineTo(8, -88); c.fill(); face(c, 0, -58, 0.9, "smile"); },
    "friend-bunny": function (c) { c.fillStyle = "#fff5fb"; c.beginPath(); c.ellipse(-16, -108, 9, 24, -0.15, 0, TAU); c.ellipse(16, -108, 9, 24, 0.15, 0, TAU); c.fill(); circle(c, 0, -56, 38); c.fill(); face(c, 0, -60, 0.9, "smile"); },
    "friend-patron": function (c) { c.fillStyle = "#ffd9a8"; circle(c, 0, -60, 40); c.fill(); c.fillStyle = "#3d2450"; c.beginPath(); c.moveTo(0, -18); c.lineTo(-16, -26); c.lineTo(-16, -10); c.closePath(); c.moveTo(0, -18); c.lineTo(16, -26); c.lineTo(16, -10); c.closePath(); c.fill(); face(c, 0, -64, 0.9, "smile"); },
  };

  function standee(c, look, kind, x, y, s, v, opts) { // One cardboard cut-out at (x, y), scale s, risen v (0-1). opts: {wind (0-1 of a wind-up), pop (0-1 popping), badge}
    const o = opts || {}, w = 100, h = 131;
    c.save();
    c.translate(x, y + h * s * (1 - v));                      // a pop-up is lowered into its cover by what hasn't risen
    c.scale(s, s);
    if (o.pop) { c.globalAlpha = 1 - o.pop; c.translate(0, -20 * o.pop); c.rotate(o.pop * 0.6); }
    const pick = kind === "friend" ? FRIENDS[look] || FRIENDS["friend-lumi"] : BODIES[look] || BODIES["dust-bunny"];
    if (kind !== "pickup" && look !== "balloon") {
      c.fillStyle = "#8a5a35"; c.fillRect(-4, -6, 8, 22); c.fillRect(-20, 12, 40, 6);    // the little wooden stand
      c.save(); c.shadowColor = "rgba(0,0,0,.3)"; c.shadowBlur = 8; c.shadowOffsetY = 4;
      c.fillStyle = CARD; c.strokeStyle = CARD_EDGE; c.lineWidth = 3; rr(c, -w / 2, -h, w, h - 4, 18); c.fill(); c.stroke(); c.restore();   // the card itself
    }
    pick(c);
    if (kind === "friend") {                                  // the ♡ sign, held up high: never mistake a friend
      c.fillStyle = "#fff"; rr(c, 14, -134, 46, 40, 8); c.fill(); c.strokeStyle = PINK; c.lineWidth = 3; c.stroke();
      heart(c, 37, -112, 13); c.fillStyle = PINK; c.fill(); c.fillStyle = "#8a5a35"; c.fillRect(34, -96, 5, 40);
    } else if (kind === "creature" && look !== "can" && look !== "balloon") {
      c.save(); c.shadowColor = GOLD; c.shadowBlur = 14; star(c, 0, -h + 18, 11, 5); c.fillStyle = "#fff9d7"; c.fill(); c.restore();   // the star badge on the top quarter
    }
    if (o.wind) {                                             // a water balloon, held up and swelling as the wind-up runs
      const r = 10 + 14 * o.wind;
      c.fillStyle = "rgba(112,235,234,.85)"; c.beginPath(); c.ellipse(-44, -h - 10 - r, r, r * 1.1, 0, 0, TAU); c.fill();
      c.fillStyle = "#fff8"; circle(c, -48, -h - 14 - r * 1.3, r * 0.25); c.fill();
    }
    c.restore();
  }

  function pickup(c, look, x, y, s, t) { // A floating pickup: a gold star, a clock, a heart or a BB crate, glowing.
    c.save(); c.translate(x, y); c.scale(s, s);
    c.shadowColor = "#fff"; c.shadowBlur = 20;
    if (look === "pickup-star") { c.rotate(Math.sin(t / 20) * 0.2); star(c, 0, -60, 48, 5); c.fillStyle = GOLD; c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 4; c.stroke(); }
    else if (look === "pickup-clock") { circle(c, 0, -60, 46); c.fillStyle = "#fff5fb"; c.fill(); c.strokeStyle = PINK; c.lineWidth = 8; c.stroke(); c.lineWidth = 6; c.strokeStyle = INK; c.beginPath(); c.moveTo(0, -60); c.lineTo(0, -88); c.moveTo(0, -60); c.lineTo(20, -60); c.stroke(); }
    else if (look === "pickup-heart") { heart(c, 0, -56, 52); c.fillStyle = PINK; c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 4; c.stroke(); }
    else { rr(c, -44, -100, 88, 80, 12); c.fillStyle = LILAC; c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 4; c.stroke(); for (let i = 0; i < 3; i++) { circle(c, -22 + i * 22, -60, 9); c.fillStyle = "#fff9d7"; c.fill(); } }
    c.restore();
  }

  /* ------------------------------------------------------------ bosses (big cardboard rigs; game.js draws their weak spots) */
  const BOSSES = {
    "moss-golem": function (c, w, h) { c.fillStyle = "#7d8c6a"; rr(c, -w / 2, -h, w, h, 120); c.fill(); c.fillStyle = "#8fc49a"; for (let i = 0; i < 14; i++) { circle(c, -w / 2 + 40 + (i * 67) % (w - 80), -h + 60 + (i * 53) % (h - 120), 36); c.fill(); } face(c, 0, -h * 0.42, 4.2, "grin"); c.fillStyle = "#6a7757"; rr(c, -w / 2 - 50, -h * 0.6, 70, 240, 30); c.fill(); rr(c, w / 2 - 20, -h * 0.6, 70, 240, 30); c.fill(); },
    "storm-kite": function (c, w, h) { c.fillStyle = AQUA; c.beginPath(); c.moveTo(0, -h); c.lineTo(w / 2, -h / 2); c.lineTo(0, 0); c.lineTo(-w / 2, -h / 2); c.closePath(); c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 8; c.beginPath(); c.moveTo(0, -h); c.lineTo(0, 0); c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2, -h / 2); c.stroke(); face(c, 0, -h * 0.55, 2.4, "grin"); c.strokeStyle = PINK; c.lineWidth = 6; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-60, 80, 0, 140); c.stroke(); },
    "bell-phantom": function (c, w, h) { c.fillStyle = "rgba(239,228,255,.92)"; c.beginPath(); c.moveTo(-w / 2, 0); c.quadraticCurveTo(-w / 2, -h, 0, -h); c.quadraticCurveTo(w / 2, -h, w / 2, 0); for (let i = 4; i >= 0; i--) c.quadraticCurveTo(-w / 2 + (i + 0.5) * w / 5, 30, -w / 2 + i * w / 5, 0); c.fill(); c.fillStyle = GOLD; circle(c, 0, 10, 26); c.fill(); face(c, 0, -h * 0.55, 2.6, "grin"); },
    "clockwork-owl": function (c, w, h) { c.fillStyle = "#b98b49"; c.beginPath(); c.ellipse(0, -h / 2, w / 2, h / 2, 0, 0, TAU); c.fill(); c.fillStyle = "#d9b36a"; c.beginPath(); c.ellipse(0, -h * 0.35, w * 0.3, h * 0.3, 0, 0, TAU); c.fill(); [-1, 1].forEach(function (d) { star(c, d * 110, -h * 0.64, 70, 12, 0.85); c.fillStyle = "#8a6a2a"; c.fill(); circle(c, d * 110, -h * 0.64, 46); c.fillStyle = "#fff5e0"; c.fill(); }); c.fillStyle = "#e8a83a"; c.beginPath(); c.moveTo(-20, -h * 0.5); c.lineTo(20, -h * 0.5); c.lineTo(0, -h * 0.42); c.fill(); },
    "comet-drake": function (c, w, h) { c.fillStyle = "#ff8ecb"; rr(c, -w / 2, -60, w, 60, 20); c.fill(); c.fillStyle = "#fff5fb"; for (let i = 0; i < 8; i++) { circle(c, -w / 2 + 40 + i * (w - 80) / 7, -6, 18); c.fill(); } c.fillStyle = LILAC; c.beginPath(); c.ellipse(-40, -200, 180, 120, 0, 0, TAU); c.fill(); c.beginPath(); c.ellipse(190, -360, 90, 70, 0.3, 0, TAU); c.fill(); c.fillRect(110, -330, 70, 160); c.fillStyle = GOLD; [-1, 0, 1].forEach(function (i) { star(c, -80 + i * 70, -300, 30, 4); c.fill(); }); c.fillStyle = "#c9a8ff"; c.beginPath(); c.moveTo(-200, -230); c.quadraticCurveTo(-340, -420, -130, -320); c.fill(); face(c, 214, -338, 1.7, "grin"); },   // below the jewel on her brow (a weak spot)
  };

  function boss(c, look, x, y, w, h, s, hurt) { // A boss at (x, y) bottom-centre; hurt (0-1) flashes it after a weak spot is hit.
    c.save(); c.translate(x, y); c.scale(s, s);
    c.save(); c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = 20; c.shadowOffsetY = 10;
    c.fillStyle = CARD; c.strokeStyle = CARD_EDGE; c.lineWidth = 6; rr(c, -w / 2 - 20, -h - 20, w + 40, h + 30, 60); c.fill(); c.stroke(); c.restore();   // the big card behind it
    (BOSSES[look] || BOSSES["moss-golem"])(c, w, h);
    if (hurt) { c.globalAlpha = hurt * 0.5; c.fillStyle = "#fff"; rr(c, -w / 2 - 20, -h - 20, w + 40, h + 30, 60); c.fill(); }
    c.restore();
  }

  function spot(c, x, y, r, open, t) { // A weak spot: a bullseye that opens and glows; closed, it's a shut cardboard flap.
    if (!open) { circle(c, x, y, r * 0.8); c.fillStyle = CARD_EDGE; c.fill(); return; }
    c.save(); c.shadowColor = GOLD; c.shadowBlur = 18 + 6 * Math.sin(t / 6);
    bullseye(c, x, y, r); c.restore();
  }

  /* ------------------------------------------------------------ the Sparkle Popper and Lumi's paws (screen space) */
  function popper(c, x, y, size, pal, kick) { // The toy marker, seen from behind Lumi: candy body, a star on the tip, her paws on it. kick: 0-1 just after a pop.
    c.save(); c.translate(x, y + kick * size * 0.08); c.scale(size / 100, size / 100); c.rotate(-0.08 - kick * 0.05);
    c.fillStyle = "#ffb3d9"; rr(c, -18, -150, 36, 160, 18); c.fill();                      // the long candy barrel
    c.fillStyle = "#fff"; for (let i = 0; i < 4; i++) c.fillRect(-18, -140 + i * 34, 36, 9);   // its stripes
    star(c, 0, -160, 26, 5); c.fillStyle = GOLD; c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke();   // the star on its tip
    c.fillStyle = LILAC; rr(c, -42, -20, 84, 70, 26); c.fill();                           // the body, with a heart window
    heart(c, 0, 12, 18); c.fillStyle = "#fff"; c.fill();
    c.fillStyle = pal.body; c.strokeStyle = pal.shadow; c.lineWidth = 3;                  // Lumi's paws
    c.beginPath(); c.ellipse(-46, 26, 26, 18, -0.3, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(40, -40, 24, 17, 0.4, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = pal.glow; [[-56, 20], [-46, 14], [-36, 20], [32, -46], [42, -50], [50, -42]].forEach(function (b) { circle(c, b[0], b[1], 4); c.fill(); });   // toe beans
    c.restore();
  }

  function reticle(c, x, y, r, style, color) { // The Star Scope's crosshair: thin lines, a ring and the chosen centre (heart, star, paw or dot).
    c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x - r, y); c.lineTo(x - r * 0.25, y); c.moveTo(x + r * 0.25, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y - r * 0.25); c.moveTo(x, y + r * 0.25); c.lineTo(x, y + r); c.stroke();
    circle(c, x, y, r * 0.55); c.stroke();
    if (style === "heart") { heart(c, x, y, 9); c.fill(); }
    else if (style === "star") { star(c, x, y, 9, 5); c.fill(); }
    else if (style === "paw") { circle(c, x, y + 3, 5); c.fill(); [[-6, -4], [-2, -8], [2, -8], [6, -4]].forEach(function (b) { circle(c, x + b[0], y + b[1], 2.2); c.fill(); }); }
    else { circle(c, x, y, 3); c.fill(); }
    c.restore();
  }

  return { BACKDROPS: BACKDROPS, PROPS: PROPS, PROP_UP: PROP_UP, BODIES: BODIES, FRIENDS: FRIENDS, BOSSES: BOSSES,
    backdrop: function (c, sky) { (BACKDROPS[sky] || BACKDROPS.range)(c); }, fireworks: fireworks, prop: prop, standee: standee,
    pickup: pickup, boss: boss, spot: spot, popper: popper, reticle: reticle, heart: heart, star: star };
});
