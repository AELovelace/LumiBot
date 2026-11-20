/* The art for what Lumi wears: each accessory drawn as plain SVG over (or behind) her own drawing, in her 320 x 300
   box (templates/games/lumi-pet.html). The server's catalog (mnemerynne/lumipet_data/closet.json) says which
   accessories exist, their slot, rarity and price; this file only knows how each looks. Every catalog id needs an
   entry here (tests/js/lumi_closet.test.mjs checks). One accessory per slot, paperdoll style.

   `layer` is where it is drawn: "back" (behind her body: capes, packs) or "front" (over her). Accessories are for
   looks only; nothing here changes a fight. All authored here: nothing a person typed goes into this markup. */
(function (root, make) {
  const closet = make();
  if (typeof module === "object" && module.exports) module.exports = closet; else root.LumiPetCloset = closet;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EDGE = 'stroke="#462846" stroke-opacity=".5" stroke-width="2" stroke-linejoin="round"';
  function p(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more === undefined ? EDGE : more) + "/>"; }
  function c(x, y, r, fill, more) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" ' + (more === undefined ? EDGE : more) + "/>"; }
  function o(x, y, rx, ry, fill, more) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" ' + (more === undefined ? EDGE : more) + "/>"; }
  function star(x, y, r) { // A four-pointed sparkle.
    const s = r * 0.3;
    return "M" + x + " " + (y - r) + " L" + (x + s) + " " + (y - s) + " L" + (x + r) + " " + y + " L" + (x + s) + " " + (y + s) + " L" + x + " " + (y + r) +
      " L" + (x - s) + " " + (y + s) + " L" + (x - r) + " " + y + " L" + (x - s) + " " + (y - s) + "Z";
  }
  function bow(x, y, size, fill) { // A ribbon bow: two loops and a knot.
    const w = size, h = size * .7;
    return p("M" + x + " " + y + " L" + (x - w) + " " + (y - h) + " L" + (x - w) + " " + (y + h) + "Z M" + x + " " + y + " L" + (x + w) + " " + (y - h) + " L" + (x + w) + " " + (y + h) + "Z", fill) + c(x, y, size * .28, fill);
  }
  const LINE = 'stroke-linecap="round" fill="none"';

  const ART = {
    // Head
    "acc-bow": { layer: "front", svg: bow(212, 72, 20, "#ff8ecb") },
    "acc-star-clip": { layer: "front", svg: p(star(112, 86, 13), "#ffdc83") },
    "acc-flower-crown": { layer: "front", svg: p("M112 92 Q160 70 208 92", "none", 'stroke="#7fc49a" stroke-width="4" ' + LINE) +
      [[116, 90, "#ff8ecb"], [138, 81, "#fff1cd"], [160, 78, "#c9a8ff"], [182, 81, "#fff1cd"], [204, 90, "#ff8ecb"]].map(function (f) {
        return [0, 72, 144, 216, 288].map(function (a) { const r = a * Math.PI / 180; return c(Math.round((f[0] + 5 * Math.cos(r)) * 10) / 10, Math.round((f[1] + 5 * Math.sin(r)) * 10) / 10, 4, f[2], ""); }).join("") + c(f[0], f[1], 2.6, "#ffdc83", "");
      }).join("") },
    "acc-witch-hat": { layer: "front", svg: p("M122 82 Q150 40 176 2 Q188 44 198 82 Z", "#5a3fa8") + o(160, 84, 64, 12, "#4a3190") + p("M126 74 Q160 84 195 74 L197 82 Q160 92 124 82 Z", "#ffdc83") + p(star(170, 40, 7), "#ffdc83", "") },
    "acc-crown": { layer: "front", svg: p("M126 86 L122 50 L142 66 L160 40 L178 66 L198 50 L194 86 Z", "#ffdc83") + c(160, 72, 5, "#ff8ecb") + c(138, 76, 3.5, "#70ebea") + c(182, 76, 3.5, "#70ebea") + p(star(160, 34, 7), "#fff8dc", "") },
    // Neck
    "acc-bell-collar": { layer: "front", svg: p("M118 196 Q160 216 202 196", "none", 'stroke="#e8556a" stroke-width="8" ' + LINE) + c(160, 214, 8, "#ffdc83") + p("M156 216 H164", "none", 'stroke="#8a6a2a" stroke-width="2" ' + LINE) },
    "acc-bowtie": { layer: "front", svg: bow(160, 210, 16, "#70ebea") },
    "acc-scarf": { layer: "front", svg: p("M114 192 Q160 220 206 192 L208 206 Q160 234 112 206 Z", "#ff9d6b") + p("M184 212 L200 208 L206 250 L190 252 Z", "#ff9d6b") + p("M190 238 L205 236 M191 245 L206 243", "none", 'stroke="#fff1cd" stroke-width="2.5"') },
    "acc-star-pendant": { layer: "front", svg: p("M124 196 Q160 222 196 196", "none", 'stroke="#d9b24a" stroke-width="2" ' + LINE) + p(star(160, 222, 11), "#ffdc83") },
    // Wings
    "acc-wing-ribbons": { layer: "front", svg: bow(108, 178, 11, "#c9a8ff") + bow(212, 178, 11, "#c9a8ff") },
    "acc-wing-glitter": { layer: "front", svg: [[52, 120, 7], [74, 150, 5], [40, 148, 4], [268, 120, 7], [246, 150, 5], [280, 148, 4], [66, 206, 4], [254, 206, 4]].map(function (s) { return p(star(s[0], s[1], s[2]), "#fff8dc", 'opacity=".95"'); }).join("") },
    "acc-wing-aurora": { layer: "front", svg: ["#70ebea", "#c9a8ff", "#ff8ecb"].map(function (colour, i) {
      const inset = i * 9;
      return p("M" + (108 - inset * .4) + " " + (170 - inset * .3) + " C" + (22 + inset) + " " + (180 - inset) + " " + (36 + inset) + " " + (88 + inset) + " " + (80 + inset * .2) + " " + (112 + inset * .5) +
        " M" + (212 + inset * .4) + " " + (170 - inset * .3) + " C" + (298 - inset) + " " + (180 - inset) + " " + (284 - inset) + " " + (88 + inset) + " " + (240 - inset * .2) + " " + (112 + inset * .5), "none", 'stroke="' + colour + '" stroke-width="4" opacity=".85" ' + LINE);
    }).join("") },
    // Back (drawn behind her)
    "acc-backpack": { layer: "back", svg: p("M88 186 q0 -14 14 -14 h116 q14 0 14 14 v52 q0 14 -14 14 h-116 q-14 0 -14 -14 Z", "#e8556a") + p("M88 214 h144", "none", 'stroke="#b83a4e" stroke-width="3"') },
    "acc-cape": { layer: "back", svg: p("M104 186 Q60 250 78 290 Q160 300 242 290 Q260 250 216 186 Z", "#c0392b") + p("M104 186 Q84 240 92 288 M216 186 Q236 240 228 288", "none", 'stroke="#8f2a20" stroke-width="2" opacity=".6"') },
    "acc-jetpack": { layer: "back", svg: [84, 214].map(function (x) {
      return p("M" + x + " 190 q0 -10 11 -10 q11 0 11 10 v48 h-22 Z", "#a8b4c4") + p("M" + (x + 2) + " 238 h18 l-4 10 h-10 Z", "#6a7484") + p("M" + (x + 5) + " 248 q6 24 6 28 q0 -4 6 -28 Z", "#ffb84a", 'class="lp-twinkle"') + p("M" + x + " 204 h22", "none", 'stroke="#6a7484" stroke-width="2"');
    }).join("") },
    // Paws
    "acc-socks": { layer: "front", svg: [123, 197].map(function (x) { return o(x, 259, 25, 14, "#70ebea") + p("M" + (x - 22) + " 255 Q" + x + " 249 " + (x + 22) + " 255 M" + (x - 24) + " 262 Q" + x + " 256 " + (x + 24) + " 262", "none", 'stroke="#fff" stroke-width="3" opacity=".8"'); }).join("") },
    "acc-boots": { layer: "front", svg: [123, 197].map(function (x) { return p("M" + (x - 22) + " 244 h44 v16 q0 12 -12 12 h-22 q-12 0 -12 -12 Z", "#ffdc83") + p("M" + (x - 24) + " 246 h48", "none", 'stroke="#d9b24a" stroke-width="4" ' + LINE); }).join("") },
    "acc-star-mitts": { layer: "front", svg: [123, 197].map(function (x) { return o(x, 259, 26, 15, "#c9a8ff") + p(star(x, 259, 9), "#ffdc83", ""); }).join("") },
    // Tail
    "acc-tail-bow": { layer: "front", svg: bow(270, 196, 13, "#ff8ecb") },
    "acc-tail-ring": { layer: "front", svg: o(266, 240, 13, 7, "none", 'stroke="#ffdc83" stroke-width="5" transform="rotate(-25 266 240)"') + c(276, 234, 3, "#70ebea") },
    "acc-comet-trail": { layer: "front", svg: [[282, 184, 9], [296, 168, 6], [306, 154, 4], [290, 204, 4]].map(function (s, i) { return p(star(s[0], s[1], s[2]), i % 2 ? "#70ebea" : "#ffdc83", 'class="lp-twinkle" style="animation-delay:' + (i * .4) + 's"'); }).join("") },

    // ---- Star Capsule prizes: won from the capsules, never sold (the "rarity" entries in the catalog).
    // Star Capsule back
    // Everything here is drawn behind her, so the hidden ends of sticks and strings simply vanish behind her body.
    // A giant swirl lollipop strapped behind her, poking up over one shoulder with a ribbon on its stick.
    "acc-giant-lollipop": { layer: "back", svg: (function () {
      let spiral = "";
      for (let d = 0; d <= 1260; d += 20) { // Three and a half turns, outwards from the middle.
        const a = d * Math.PI / 180, r = 2 + d / 1260 * 27;
        spiral += (d ? " L" : "M") + Math.round((262 + r * Math.cos(a)) * 10) / 10 + " " + Math.round((70 + r * Math.sin(a)) * 10) / 10;
      }
      return p("M198 210 L250 100", "none", 'stroke="#fff1cd" stroke-width="8" ' + LINE) + p("M198 210 L250 100", "none", 'stroke="#d9b98a" stroke-width="2" opacity=".7" ' + LINE) +
        c(262, 70, 34, "#fff8dc") + p(spiral, "none", 'stroke="#ff8ecb" stroke-width="5" ' + LINE) + bow(245, 110, 12, "#70ebea");
    })() },
    // A wanderer's stick over the shoulder with a spotty bundle knotted to the far end.
    "acc-bindle": { layer: "back", svg: p("M40 124 C12 132 12 184 44 184 C76 184 76 132 48 124 Z", "#4a68c8") +
      [[32, 148, 4], [52, 144, 3.5], [26, 166, 3], [44, 166, 4.5], [60, 162, 3], [38, 178, 2.5]].map(function (d) { return c(d[0], d[1], d[2], "#fff8dc", ""); }).join("") +
      p("M130 178 L16 96", "none", 'stroke="#a8743e" stroke-width="7" ' + LINE) +
      p("M44 124 L28 108 L37 125 Z M44 124 L62 112 L51 126 Z", "#2e4a96") + c(44, 124, 5.5, "#2e4a96") },
    // A shiny heart balloon on a wavy string, tied somewhere behind her.
    "acc-heart-balloon": { layer: "back", svg: p("M262 92 Q246 118 262 142 Q272 170 212 204", "none", 'stroke="#fff1cd" stroke-width="2" ' + LINE) +
      p("M262 88 C222 66 226 22 250 20 C258 20 262 26 262 32 C262 26 266 20 274 20 C298 22 302 66 262 88Z", "#ff5f8f") + p("M257 92 L262 86 L267 92 Z", "#c43b6c") +
      p("M240 34 Q234 44 238 56", "none", 'stroke="#fff" stroke-width="4" opacity=".8" ' + LINE) },
    // A little teddy bear riding piggyback, peering round her side and waving.
    "acc-teddy-rider": { layer: "back", svg: o(82, 232, 26, 24, "#c98f58") + o(54, 216, 8, 15, "#c98f58", EDGE + ' transform="rotate(32 54 216)"') +
      c(58, 168, 9, "#c98f58") + c(98, 168, 9, "#c98f58") + c(58, 168, 4.5, "#ffc6e4", "") + c(98, 168, 4.5, "#ffc6e4", "") + c(78, 186, 25, "#d8a26b") + o(78, 196, 13, 9.5, "#fff1cd", "") +
      c(69, 183, 3.5, "#462846", "") + c(87, 183, 3.5, "#462846", "") + o(78, 192, 4, 3, "#462846", "") + p("M72 199 Q78 204 84 199", "none", 'stroke="#462846" stroke-width="2" ' + LINE) +
      bow(82, 214, 11, "#e8556a") },
    // A tilted parasol: alternate pink and cream panels, curved ribs, a scalloped lace hem and a curly handle reaching down behind her.
    "acc-lace-parasol": { layer: "back", svg: (function () {
      const hem = [-75, -50, -25, 0, 25, 50, 75]; // Where the ribs meet the hem, in the parasol's own tilted coordinates.
      let panels = "";
      hem.slice(0, 6).forEach(function (x, i) {
        panels += p("M0 -60 Q" + (x * .8) + " -46 " + x + " 0 A13 8 0 0 0 " + (x + 25) + " 0 Q" + ((x + 25) * .8) + " -46 0 -60Z", i % 2 ? "#fff1cd" : "#ff9fd2");
      });
      return '<g transform="translate(72 74) rotate(-35)">' + p("M0 0 V150", "none", 'stroke="#a8743e" stroke-width="6" ' + LINE) + panels +
        hem.map(function (x) { return c(x, 0, 3, "#fff8dc"); }).join("") + hem.slice(0, 6).map(function (x) { return c(x + 12.5, 8, 2.6, "#fff8dc", 'stroke="#ff8ecb" stroke-width="1"'); }).join("") +
        c(0, -64, 6, "#ffdc83") + "</g>";
    })() },
    // A little air tank peeking from her side with a hose and nozzle, blowing a stream of see-through bubbles.
    "acc-bubble-pack": { layer: "back", svg: p("M76 202 q0 -12 14 -12 h18 v62 h-18 q-14 0 -14 -12 Z", "#70ebea") + p("M76 214 h32 M76 228 h32", "none", 'stroke="#2a8c94" stroke-width="2.5"') +
      c(88, 202, 5.5, "#fff8dc") + p("M88 202 L91 199", "none", 'stroke="#e8556a" stroke-width="1.8" ' + LINE) + p("M86 190 Q84 170 66 170", "none", 'stroke="#c9a8ff" stroke-width="5" ' + LINE) + p("M70 164 L58 168 L60 176 L70 176 Z", "#ffdc83") +
      [[46, 156, 11, 0], [28, 128, 8, .4], [58, 124, 14, .9], [34, 92, 10, 1.3], [66, 84, 7, .2], [44, 56, 13, .7], [84, 42, 6, 1.5], [26, 40, 6, 1], [270, 120, 10, .5], [292, 88, 7, 1.2], [262, 62, 12, .1], [286, 34, 6, .8]].map(function (b) {
        return '<g class="lp-twinkle" style="animation-delay:' + b[3] + 's">' + c(b[0], b[1], b[2], "#bff6f4", 'fill-opacity=".2" stroke="#d6fbf8" stroke-width="2"') +
          p("M" + (b[0] - b[2] * .55) + " " + (b[1] - b[2] * .2) + " Q" + (b[0] - b[2] * .5) + " " + (b[1] - b[2] * .6) + " " + (b[0] - b[2] * .1) + " " + (b[1] - b[2] * .65), "none", 'stroke="#fff" stroke-width="2" ' + LINE) + "</g>";
      }).join("") },
    // A great brass star-reading instrument hung behind her like a halo: graduated rings, two tilted orbit hoops, planets on the rim and a star at the very top.
    "acc-astrolabe-ring": { layer: "back", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, cx = 160, cy = 178;
      let ticks = "";
      for (let d = 0; d < 360; d += 7.5) { const a = d * Math.PI / 180, long = d % 45 === 0 ? 100 : 106; ticks += "M" + r(cx + long * Math.cos(a)) + " " + r(cy + long * Math.sin(a)) + " L" + r(cx + 112 * Math.cos(a)) + " " + r(cy + 112 * Math.sin(a)) + " "; } // A short mark every 7.5 degrees and a long one every 45.
      function hoop(angle, colour) { return o(cx, cy, 116, 40, "none", 'stroke="' + colour + '" stroke-width="2.5" transform="rotate(' + angle + " " + cx + " " + cy + ')"'); }
      const planets = [[150, "#ff9d6b", 8], [205, "#70ebea", 6], [335, "#c9a8ff", 8], [28, "#ff8ecb", 6], [62, "#a9ee9f", 5], [118, "#ffdc83", 5]].map(function (s) { // Angles picked so each sits where her body won't hide it.
        const a = s[0] * Math.PI / 180, x = r(cx + 117 * Math.cos(a)), y = r(cy + 117 * Math.sin(a));
        return c(x, y, s[2], s[1]) + c(r(x - s[2] * .3), r(y - s[2] * .3), r(s[2] * .28), "#fff", 'opacity=".8"');
      }).join("");
      return hoop(30, "#c9a8ff") + hoop(-30, "#70ebea") + c(cx, cy, 117, "none", 'stroke="#b58a2e" stroke-width="7"') + c(cx, cy, 117, "none", 'stroke="#ffdc83" stroke-width="4"') + c(cx, cy, 97, "none", 'stroke="#ffdc83" stroke-width="2" opacity=".85"') +
        p(ticks, "none", 'stroke="#ffe9ad" stroke-width="1.6" ' + LINE) + planets +
        p(star(160, 61, 15), "#fff8dc", 'stroke="#b58a2e" stroke-width="1.5" class="lp-neon"') +
        p(star(62, 100, 5), "#fff8dc", 'class="lp-twinkle"') + p(star(262, 104, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.6s"') + p(star(46, 234, 4), "#70ebea", 'class="lp-twinkle" style="animation-delay:1.2s"');
    })() },

    // Star Capsule head
    // A two-leaf seedling growing straight out of the top of her head.
    "acc-sprout": { layer: "front", svg: p("M160 92 Q157 78 160 64", "none", 'stroke="#4f9e63" stroke-width="5" ' + LINE) +
      p("M160 68 C148 44 124 42 112 50 C116 70 142 80 160 68Z", "#8ddc8f") + p("M160 64 C170 36 196 32 210 40 C208 62 182 76 160 64Z", "#a9ee9f") +
      p("M154 65 Q136 56 122 53 M166 60 Q184 50 200 44", "none", 'stroke="#4f9e63" stroke-width="2.5" ' + LINE) },
    // A cone tilted a little to one side, two wrapped stripes, a fluffy pom on the tip and a couple of confetti dots.
    "acc-party-hat": { layer: "front", svg: p("M172 28 L134 92 Q164 98 192 88 Z", "#70ebea") +
      p("M164.4 40.8 L179 49 L183 61 L156.8 53.6 Z", "#ff8ecb", "") + p("M149.2 66.4 L187 73 L191 85 L141.6 79.2 Z", "#ffdc83", "") +
      [[166, 28, 7], [178, 28, 7], [172, 19, 7], [172, 28, 8]].map(function (b) { return c(b[0], b[1], b[2], "#fff1cd"); }).join("") +
      c(126, 66, 3.5, "#ff8ecb", "") + c(212, 62, 3.5, "#ffdc83", "") + c(204, 40, 2.5, "#c9a8ff", "") },
    // Two knitted caps pulled over her ear tips: ribbed hem, stitch lines and a pom-pom on each.
    "acc-ear-cosies": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
        p("M86 92 L87 62 Q89 44 102 55 L126 78 Q106 80 86 92Z", "#c9a8ff") +
        p("M84 96 Q104 80 130 80 L124 69 Q102 72 84 84 Z", "#fff1cd") +
        p("M92 90 L91 80 M101 85 L99 75 M111 81 L109 71 M120 78 L118 69", "none", 'stroke="#d9b24a" stroke-width="2" ' + LINE) +
        p("M94 72 Q98 64 96 56 M104 70 Q106 66 104 60", "none", 'stroke="#8a6cf0" stroke-width="2" ' + LINE) +
        c(91, 48, 11, "#ff8ecb") + p("M85 44 L95 52 M95 43 L86 53 M91 40 V56", "none", 'stroke="#ffc6e4" stroke-width="2" ' + LINE) + "</g>";
    }).join("") },
    // A red spotted mushroom cap with a cream frill of gills along the brim.
    "acc-toadstool-cap": { layer: "front", svg: p("M126 90 Q160 104 194 90 L192 84 Q160 96 128 84 Z", "#fff1cd") +
      p("M118 86 C118 46 148 30 160 30 C172 30 202 46 202 86 Q160 100 118 86Z", "#e8556a") +
      p("M136 88 L134 94 M148 91 L147 97 M160 92 V98 M172 91 L173 97 M184 88 L186 94", "none", 'stroke="#d9b24a" stroke-width="2" ' + LINE) +
      [[140, 58, 9], [168, 46, 11], [188, 68, 8], [158, 74, 7], [128, 76, 4.5], [183, 44, 4]].map(function (s) { return c(s[0], s[1], s[2], "#fff8dc", 'stroke="#b83a4e" stroke-opacity=".5" stroke-width="1.5"'); }).join("") +
      p("M126 66 Q132 46 148 38", "none", 'stroke="#ffc1c9" stroke-width="3" opacity=".8" ' + LINE) },
    // A tiny ringed planet held up by a gold circlet: the ring passes behind and then in front of the globe, a moon keeps it company.
    "acc-planet-topper": { layer: "front", svg: p("M118 94 Q160 76 202 94", "none", 'stroke="#d9b24a" stroke-width="7" ' + LINE) + p("M118 94 Q160 76 202 94", "none", 'stroke="#ffdc83" stroke-width="3.5" ' + LINE) +
      c(132, 87, 3, "#70ebea") + c(188, 87, 3, "#70ebea") + p("M142 80 Q160 94 178 80 L182 88 Q160 100 138 88 Z", "#ffdc83") + p("M152 89 H168", "none", 'stroke="#b58a2e" stroke-width="2" ' + LINE) +
      p("M110 50 A50 13 0 0 1 210 50", "none", 'stroke="#ffdc83" stroke-width="5" transform="rotate(-16 160 50)" ' + LINE) +
      c(160, 50, 29, "#c9a8ff") + p("M135.8 36 Q160 42 184.2 36 L188 45 Q160 52 132 45 Z", "#8a6cf0", 'opacity=".85"') + p("M132 56 Q160 63 188 56 L184.2 65 Q160 71 135.8 65 Z", "#ff8ecb", 'opacity=".75"') +
      p("M140 34 Q148 26 160 25", "none", 'stroke="#fff" stroke-width="4" opacity=".75" ' + LINE) +
      p("M110 50 A50 13 0 0 0 210 50", "none", 'stroke="#ffdc83" stroke-width="5" transform="rotate(-16 160 50)" ' + LINE) +
      p("M116 50 A44 10 0 0 0 204 50", "none", 'stroke="#70ebea" stroke-width="1.8" transform="rotate(-16 160 50)" ' + LINE) +
      c(232, 24, 8, "#fff1cd") + c(230, 22, 2, "#e6cf9e", "") + c(235, 27, 1.4, "#e6cf9e", "") +
      p(star(100, 26, 7), "#fff8dc", 'class="lp-twinkle"') + p(star(214, 56, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.5s"') + p(star(118, 12, 4), "#70ebea", 'class="lp-twinkle" style="animation-delay:1s"') },

    // Star Capsule neck
    // Eleven chunky candy beads strung along her neck, each with a shiny dab.
    "acc-candy-beads": { layer: "front", svg: ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff", "#a9ee9f"].concat(["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff", "#a9ee9f", "#ff8ecb"]).map(function (colour, i) {
      const t = i / 10, x = Math.round(((1 - t) * (1 - t) * 116 + 2 * (1 - t) * t * 160 + t * t * 204) * 10) / 10, y = Math.round(((1 - t) * (1 - t) * 196 + 2 * (1 - t) * t * 238 + t * t * 196) * 10) / 10; // A point along the dip of the string.
      return c(x, y, 7.5, colour) + c(x - 2, y - 2.5, 1.8, "#fff", 'opacity=".9"');
    }).join("") },
    // A triangle of spotty cloth tied at her neck.
    "acc-bandana": { layer: "front", svg: p("M116 196 Q160 214 204 196 L160 250 Z", "#4aa3e8") +
      [[140, 212, 3], [160, 216, 3.5], [180, 212, 3], [150, 229, 3], [170, 229, 3], [160, 241, 2.5]].map(function (d) { return c(d[0], d[1], d[2], "#fff8dc", ""); }).join("") +
      p("M116 196 Q160 214 204 196", "none", 'stroke="#2c74b5" stroke-width="5" ' + LINE) +
      p("M204 196 L216 188 L213 201 Z M204 196 L218 204 L206 208 Z", "#4aa3e8") + c(204, 197, 4.5, "#2c74b5") },
    // A wide navy collar with two white piping stripes and a red neckerchief knotted at the V.
    "acc-sailor-collar": { layer: "front", svg: p("M110 192 Q134 212 160 232 Q186 212 210 192 L216 214 L160 250 L104 214 Z", "#2e4a96") +
      p("M110 208 L160 240 L210 208", "none", 'stroke="#fff" stroke-width="3" ' + LINE) + p("M109 201 L160 234 L211 201", "none", 'stroke="#fff" stroke-width="2" opacity=".85" ' + LINE) +
      p("M152 232 L140 252 L153 247 Z M168 232 L180 252 L167 247 Z", "#e8556a") + p("M150 222 h20 l-3 14 h-14 Z", "#e8556a") + p("M155 226 v7 M165 226 v7", "none", 'stroke="#b83a4e" stroke-width="1.6" ' + LINE) },
    // A pleated lace ruff: a wide band with a scalloped outer edge, fold lines, a layer of pink frill and a tiny bow in the middle.
    "acc-lace-ruff": { layer: "front", svg: (function () {
      function at(t, a, b, d) { return [Math.round(((1 - t) * (1 - t) * a + 2 * (1 - t) * t * 160 + t * t * b) * 10) / 10, Math.round(((1 - t) * (1 - t) * 196 + 2 * (1 - t) * t * d + t * t * 196) * 10) / 10]; } // A point along a dipping curve.
      function frill(a, b, d, n, r, fill) { // A band from under her chin out to a scalloped edge of n bumps.
        let path = "M114 194 Q160 218 206 194 L" + at(1, a, b, d).join(" ");
        for (let i = n - 1; i >= 0; i--) path += " A" + r + " " + r + " 0 0 1 " + at(i / n, a, b, d).join(" ");
        return p(path + " Z", fill);
      }
      let folds = "";
      for (let i = 1; i < 12; i++) { folds += "M" + at(i / 12, 116, 204, 216).join(" ") + " L" + at(i / 12, 100, 220, 258).join(" ") + " "; } // One pleat line per scallop.
      return frill(100, 220, 258, 12, 11, "#fff8dc") + p(folds, "none", 'stroke="#d9b98a" stroke-width="1.6" ' + LINE) + frill(110, 210, 236, 10, 8, "#ffc6e4") + bow(160, 210, 10, "#ff8ecb");
    })() },
    // A beaten-gold torque set with five little moons running through their phases, full at the centre, with a pearl dangling beneath.
    "acc-moon-phase-torque": { layer: "front", svg: (function () {
      function at(t) { return [Math.round(((1 - t) * (1 - t) * 112 + 2 * (1 - t) * t * 160 + t * t * 208) * 10) / 10, Math.round(((1 - t) * (1 - t) * 198 + 2 * (1 - t) * t * 236 + t * t * 198) * 10) / 10]; } // A point along the collar.
      const lit = [.2, .72, 1, .72, .2], r = 8; // How much of each moon is lit: crescent, gibbous, full and back again.
      let out = p("M110 197 Q160 238 210 197", "none", 'stroke="#b58a2e" stroke-width="28" ' + LINE) + p("M110 197 Q160 238 210 197", "none", 'stroke="#ffdc83" stroke-width="24" ' + LINE) +
        p("M114 200 Q160 237 206 200", "none", 'stroke="#241a58" stroke-width="19" ' + LINE);
      lit.forEach(function (l, i) {
        const m = at(.1 + i * .2), left = i < 2, crescent = l < .5, rx = Math.round(r * Math.abs(1 - 2 * l) * 10) / 10; // rx is how far the shadow's edge bows.
        out += c(m[0], m[1], r, "#3c3580", 'stroke="#c9a8ff" stroke-width="1"');
        out += l === 1 ? c(m[0], m[1], r, "#fff1cd", "") : p("M" + m[0] + " " + (m[1] - r) + " A" + r + " " + r + " 0 0 " + (left ? 0 : 1) + " " + m[0] + " " + (m[1] + r) + " A" + rx + " " + r + " 0 0 " + (crescent === left ? 1 : 0) + " " + m[0] + " " + (m[1] - r) + "Z", "#fff1cd", "");
      });
      return out + p("M160 229 V236", "none", 'stroke="#d9b24a" stroke-width="3" ' + LINE) + c(160, 241, 7, "#fff8dc") + c(157.5, 238.5, 2, "#fff", "") +
        p(star(132, 240, 5), "#ffdc83", 'class="lp-twinkle"') + p(star(188, 240, 5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:.7s"');
    })() },
    // A midnight capelet sewn with a gold-linked constellation, a scalloped gold hem and a great teardrop jewel that shines.
    "acc-constellation-mantle": { layer: "front", svg: p("M108 192 Q160 222 212 192 L224 232 Q208 248 192 238 Q176 254 160 243 Q144 254 128 238 Q112 248 96 232 Z", "#241a58") +
      p("M97 232 Q112 247 128 237 Q144 253 160 242 Q176 253 192 237 Q208 247 223 232", "none", 'stroke="#ffdc83" stroke-width="4" ' + LINE) +
      p("M108 192 Q160 222 212 192", "none", 'stroke="#ffdc83" stroke-width="5" ' + LINE) +
      p("M111 212 L126 226 L137 208 L146 234 M209 212 L194 226 L183 208 L174 234", "none", 'stroke="#c9a8ff" stroke-width="1.4" opacity=".9" ' + LINE) +
      [[111, 212, 4, 0], [126, 226, 5, .3], [137, 208, 4, .9], [146, 234, 3.5, 1.4], [209, 212, 4, .6], [194, 226, 5, 1.1], [183, 208, 4, .2], [174, 234, 3.5, 1.7]].map(function (s) {
        return p(star(s[0], s[1], s[2] + 2), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + s[3] + 's"');
      }).join("") +
      [128, 160, 192].map(function (x, i) { return c(x, [240, 245, 240][i], 3.5, "#fff1cd") + c(x, [248, 251, 248][i], 2, "#ff8ecb", ""); }).join("") +
      p(star(160, 225, 25), "#ffdc83") + p("M160 208 L172 224 L160 244 L148 224 Z", "#70ebea", 'stroke="#2a8c94" stroke-width="2" stroke-linejoin="round" class="lp-neon"') +
      p("M160 208 L166 224 L160 244 L154 224 Z", "#c6fbf4", "") + p("M148 224 L172 224", "none", 'stroke="#2a8c94" stroke-width="1" opacity=".7"') },

    // Star Capsule paws
    // Her paws sit at (123, 259) and (197, 259).
    // Lilac slippers each topped with a big fluffy pom-pom made of soft overlapping tufts.
    "acc-pom-slippers": { layer: "front", svg: [123, 197].map(function (x) {
      const tufts = [0, 45, 90, 135, 180, 225, 270, 315].map(function (d) { const a = d * Math.PI / 180; return [Math.round((x + 7.5 * Math.cos(a)) * 10) / 10, Math.round((249 + 7.5 * Math.sin(a)) * 10) / 10]; }); // Around the middle of the pom.
      return o(x, 261, 26, 14, "#c9a8ff") + o(x, 268, 21, 6, "#a98be6", 'opacity=".55"') + tufts.map(function (t) { return c(t[0], t[1], 6, "#d8b6d8", ""); }).join("") + tufts.map(function (t) { return c(t[0], t[1], 5, "#fff8ec", ""); }).join("") + c(x, 249, 7, "#fff8ec", "");
    }).join("") },
    // Sandals: a cork sole under each paw, a strap over it and a daisy on the strap.
    "acc-daisy-sandals": { layer: "front", svg: [123, 197].map(function (x) {
      return o(x, 271, 29, 7.5, "#d9a86a") + p("M" + (x - 22) + " 268 Q" + (x - 20) + " 250 " + x + " 250 Q" + (x + 20) + " 250 " + (x + 22) + " 268", "none", 'stroke="#70ebea" stroke-width="6" ' + LINE) +
        [0, 51, 103, 154, 206, 257, 309].map(function (d) { const a = d * Math.PI / 180; return c(Math.round((x + 7.5 * Math.cos(a)) * 10) / 10, Math.round((251 + 7.5 * Math.sin(a)) * 10) / 10, 3.8, "#fff"); }).join("") + c(x, 251, 4.6, "#ffdc83");
    }).join("") },
    // Green frog-faced booties with bulgy eyes on top and a wide smile.
    "acc-frog-booties": { layer: "front", svg: [123, 197].map(function (x) {
      return o(x, 262, 27, 15, "#86d67e") + [-1, 1].map(function (s) { return c(x + s * 13, 247, 9, "#86d67e") + c(x + s * 13, 246, 6, "#fff", "") + c(x + s * 12, 247, 3, "#2a3a2a", ""); }).join("") +
        p("M" + (x - 15) + " 264 Q" + x + " 275 " + (x + 15) + " 264", "none", 'stroke="#2f6e3e" stroke-width="2.5" ' + LINE) + o(x - 19, 262, 4, 2.4, "#ff8ecb", 'opacity=".75"') + o(x + 19, 262, 4, 2.4, "#ff8ecb", 'opacity=".75"');
    }).join("") },
    // Coral high-top skates flaring out at the toe, laced up the middle, on a metal plate with two chunky teal wheels each.
    "acc-roller-skates": { layer: "front", svg: [123, 197].map(function (x) {
      return p("M" + (x - 16) + " 238 h32 q3 12 11 22 q4 6 2 11 q-1 3 -6 3 h-46 q-5 0 -6 -3 q-2 -5 2 -11 q8 -10 11 -22 Z", "#ff8a8a") + o(x, 269, 20, 4, "#fff1cd", "") + p("M" + (x - 17) + " 240 h34", "none", 'stroke="#fff1cd" stroke-width="7" ' + LINE) +
        p("M" + (x - 6) + " 247 L" + (x + 6) + " 252 M" + (x + 6) + " 247 L" + (x - 6) + " 252 M" + (x - 8) + " 255 L" + (x + 8) + " 261 M" + (x + 8) + " 255 L" + (x - 8) + " 261", "none", 'stroke="#fff" stroke-width="2.4" ' + LINE) +
        p("M" + (x - 24) + " 276 h48", "none", 'stroke="#8d97a8" stroke-width="5" ' + LINE) + [-14, 14].map(function (d) { return c(x + d, 284, 8, "#70ebea") + c(x + d, 284, 3, "#fff8dc"); }).join("");
    }).join("") },
    // Satin ballet shoes with ribbons criss-crossing up the ankle and a tiny bow at the top.
    "acc-ballet-ribbons": { layer: "front", svg: [123, 197].map(function (x) {
      return o(x, 261, 27, 14.5, "#ffb3da") + p("M" + (x - 15) + " 255 Q" + x + " 262 " + (x + 15) + " 255", "none", 'stroke="#e87fb4" stroke-width="2.5" ' + LINE) + p("M" + (x - 18) + " 266 Q" + (x - 6) + " 272 " + (x + 8) + " 271", "none", 'stroke="#fff" stroke-width="2.5" opacity=".7" ' + LINE) +
        p("M" + (x - 19) + " 254 L" + (x + 15) + " 240 M" + (x + 19) + " 254 L" + (x - 15) + " 240 M" + (x - 15) + " 248 L" + (x + 12) + " 233 M" + (x + 15) + " 248 L" + (x - 12) + " 233", "none", 'stroke="#ff7fb8" stroke-width="3.5" ' + LINE) + bow(x, 233, 9, "#ff7fb8");
    }).join("") },
    // Paws lost in fluffy clouds: a small rainbow rising from each, drips of rain below and a twinkle on top.
    "acc-cloud-hoppers": { layer: "front", svg: [0, 1].map(function (m) {
      const x = 123, puffs = [[-20, 264, 11], [-7, 257, 13], [9, 256, 14], [22, 263, 11], [-10, 270, 12], [10, 271, 12]];
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + [[20, "#ff8ecb"], [16, "#ffdc83"], [12, "#70ebea"]].map(function (a) {
        return p("M" + (x - 18 - a[0]) + " 258 A" + a[0] + " " + a[0] + " 0 0 1 " + (x - 18 + a[0]) + " 258", "none", 'stroke="' + a[1] + '" stroke-width="3.5" stroke-linecap="butt" fill="none"');
      }).join("") + puffs.map(function (b) { return c(x + b[0], b[1], b[2] + 1.5, "#b9c7e8", ""); }).join("") + puffs.map(function (b) { return c(x + b[0], b[1], b[2], "#fff", ""); }).join("") +
        p("M" + (x - 22) + " 270 Q" + x + " 282 " + (x + 26) + " 270", "none", 'stroke="#c9d6f2" stroke-width="3" ' + LINE) +
        [[-14, 287], [2, 291], [16, 286]].map(function (d) { const dx = x + d[0], dy = d[1]; return p("M" + dx + " " + (dy - 6) + " Q" + (dx + 5) + " " + (dy + 1) + " " + dx + " " + (dy + 4) + " Q" + (dx - 5) + " " + (dy + 1) + " " + dx + " " + (dy - 6) + "Z", "#70c8f0", ""); }).join("") +
        p(star(x + 14, 246, 6.5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:' + (m * .5) + 's"') + p(star(x - 2, 244, 3.5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (.9 + m * .4) + 's"') + "</g>";
    }).join("") },
    // The legendary pair: midnight boots with a galaxy swirling in the leather, gold cuffs and soles, a glowing star on each toe, feather wings at the ankle, a tilted orbit ring and stardust rising from a shining arc beneath.
    "acc-starstrider-boots": { layer: "front", svg: [0, 1].map(function (m) {
      const x = 123, tw = function (d) { return 'class="lp-twinkle" style="animation-delay:' + (d + m * .35) + 's"'; };
      const wing = function (tipX, tipY, footY, fill) { return p("M" + (x - 25) + " " + footY + " C" + (x - 40) + " " + (footY - 8) + " " + tipX + " " + (tipY + 14) + " " + tipX + " " + tipY + " C" + (tipX + 16) + " " + (tipY + 2) + " " + (x - 24) + " " + (footY - 18) + " " + (x - 22) + " " + (footY - 4) + " Z", fill); }; // One ankle feather, from the boot out to its tip.
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + wing(x - 70, 246, 262, "#ffdc83") + wing(x - 66, 230, 256, "#ffe9ad") + wing(x - 56, 216, 250, "#fff8ec") + wing(x - 42, 208, 245, "#fff8ec") +
        p("M" + (x - 26) + " 268 q0 -26 14 -29 h24 q14 3 14 29 q0 10 -12 10 h-28 q-12 0 -12 -10 Z", "#241a78", 'stroke="#ffdc83" stroke-width="2.5" stroke-linejoin="round"') +
        o(x - 7, 256, 13, 7, "#c94fd8", 'opacity=".55" transform="rotate(-18 ' + (x - 7) + ' 256)"') + o(x + 9, 264, 12, 6, "#2fb6d8", 'opacity=".55" transform="rotate(-12 ' + (x + 9) + ' 264)"') + o(x - 4, 270, 11, 4, "#ff8ecb", 'opacity=".4"') +
        p("M" + (x - 16) + " 262 Q" + (x - 2) + " 248 " + (x + 16) + " 254 Q" + (x + 4) + " 262 " + (x - 8) + " 262", "none", 'stroke="#d9c8ff" stroke-width="1.5" opacity=".8" ' + LINE) +
        p("M" + (x - 17) + " 240 h34", "none", 'stroke="#b58a2e" stroke-width="10" ' + LINE) + p("M" + (x - 17) + " 240 h34", "none", 'stroke="#ffdc83" stroke-width="6.5" ' + LINE) + c(x, 240, 4.5, "#ff8ecb") +
        p("M" + (x - 24) + " 278 h48", "none", 'stroke="#ffdc83" stroke-width="4" ' + LINE) +
        p(star(x, 264, 14), "#fff8dc", 'stroke="#b58a2e" stroke-width="1.2" stroke-linejoin="round" class="lp-neon"') + c(x, 264, 3.5, "#70ebea", "") +
        [[-16, 250, 2.6], [15, 250, 2.2], [-20, 268, 2], [19, 271, 2.4]].map(function (s, i) { return p(star(x + s[0], s[1], s[2] + 1.2), "#fff8dc", tw(i * .4)); }).join("") +
        o(x, 266, 36, 10, "none", 'stroke="#ffdc83" stroke-width="2" opacity=".85" transform="rotate(-14 ' + x + ' 266)"') + c(x - 34, 275, 4.5, "#70ebea", tw(.5)) + c(x + 31, 257, 2.8, "#ff8ecb", tw(1)) +
        p("M" + (x - 32) + " 284 Q" + x + " 296 " + (x + 32) + " 284", "none", 'stroke="#70ebea" stroke-width="2.5" opacity=".85" class="lp-neon" ' + LINE) +
        p(star(x - 15, 294, 4), "#ffdc83", tw(.2)) + p(star(x, 295, 3), "#70ebea", tw(1.1)) + p(star(x + 16, 294, 3.5), "#fff8dc", tw(.7)) + "</g>";
    }).join("") },

    // Star Capsule tail
    // Her tail runs out from her side, around the curl at about (271, 210), to its tip at (239, 218).
    // Two shiny cherries dangling from the outside of her curl.
    "acc-cherry-charm": { layer: "front", svg: p("M274 206 Q286 212 297 228 M274 206 Q276 220 278 234", "none", 'stroke="#5f9e4f" stroke-width="3" ' + LINE) +
      p("M274 206 C282 192 298 192 304 200 C296 210 282 212 274 206Z", "#8ddc8f") + c(298, 236, 10, "#e8405f") + c(278, 243, 10, "#f0506e") + c(294.5, 232.5, 2.4, "#fff", 'opacity=".85"') + c(274.5, 239.5, 2.4, "#fff", 'opacity=".85"') },
    // A golden curtain tassel: cord looped on her tail, a round knot, a waisted cap and a skirt of threads.
    "acc-tail-tassel": { layer: "front", svg: p("M268 208 Q282 212 284 226", "none", 'stroke="#d9b24a" stroke-width="4" ' + LINE) + c(284, 228, 6.5, "#ffdc83") + p("M278 233 h12 l4 10 h-20 Z", "#d9a83a") +
      p("M274 243 L271 254 H297 L294 243 Z", "#ffdc83") + p("M277 245 L275.5 253 M282 245 L281 253 M287 245 L288 253 M292 245 L293.5 253", "none", 'stroke="#b58a2e" stroke-width="1.8" ' + LINE) },
    // A knitted sleeve pulled along her tail: two colours of stripe that follow the curve, with cream ribbed cuffs.
    "acc-tail-cosy": { layer: "front", svg: (function () {
      const LOOP = "M237 233.7 C280.1 239.2 282.4 188.6 256 193";
      return p(LOOP, "none", 'stroke="#70ebea" stroke-width="20" fill="none"') + p(LOOP, "none", 'stroke="#ff8ecb" stroke-width="20" stroke-dasharray="7 11" fill="none"') +
        p("M240 223.5 L237.5 243.5 M257.5 183 L259.5 203", "none", 'stroke="#fff1cd" stroke-width="7" fill="none"'); // Cuffs set square across each end of the sleeve.
    })() },
    // A paper lantern hung on a thread above her curl, with a warm glow inside and a little tassel underneath.
    "acc-tail-lantern": { layer: "front", svg: p("M262 190 Q270 166 292 168", "none", 'stroke="#d9b24a" stroke-width="2.5" ' + LINE) + p("M285 168 h14 l2 5 h-18 Z", "#d9a83a") +
      o(292, 192, 18, 20, "#e8556a") + o(292, 192, 10, 13, "#ffdc83", 'class="lp-twinkle" opacity=".9"') + o(292, 192, 18, 20, "none", 'stroke="#b83a4e" stroke-width="1.8"') + p("M292 172 V212 M281 176 Q276 192 281 208 M303 176 Q308 192 303 208", "none", 'stroke="#b83a4e" stroke-width="1.8" ' + LINE) +
      p("M284 211 h16 l-2 5 h-12 Z", "#d9a83a") + p("M292 216 V226", "none", 'stroke="#d9b24a" stroke-width="2.5" ' + LINE) + p("M288 226 h8 l2 15 h-12 Z", "#ffdc83") },
    // Three long wavy ribbons streaming from a knot on her curl, each cut to a swallow tail.
    "acc-tail-streamers": { layer: "front", svg: [["M270 204 C284 192 278 176 292 168 C300 163 300 156 306 152", "#ff8ecb", "M301 150 L312 150 L306 158 Z"], ["M272 208 C288 206 292 192 304 192 C308 192 310 190 313 186", "#70ebea", "M308 182 L315 188 L306 192 Z"], ["M272 214 C286 222 288 236 300 238 C306 240 308 244 310 250", "#ffdc83", "M304 250 L314 246 L312 256 Z"]].map(function (r) {
      return p(r[2], r[1], "") + p(r[0], "none", 'stroke="' + r[1] + '" stroke-width="7" ' + LINE) + p(r[0], "none", 'stroke="#fff" stroke-width="1.5" opacity=".55" ' + LINE);
    }).join("") + bow(270, 208, 9, "#c9a8ff") },
    // A dragon's tail: teal scales laid along the curve, a row of spines around the outside and a spade-shaped tip.
    "acc-dragon-tail": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, A = [[237, 233.7], [280.1, 239.2], [282.4, 188.6], [256, 193]];
      function at(t) { const u = 1 - t, q = [0, 1].map(function (k) { return u * u * u * A[0][k] + 3 * u * u * t * A[1][k] + 3 * u * t * t * A[2][k] + t * t * t * A[3][k]; }), d = [0, 1].map(function (k) { return 3 * u * u * (A[1][k] - A[0][k]) + 6 * u * t * (A[2][k] - A[1][k]) + 3 * t * t * (A[3][k] - A[2][k]); }), l = Math.hypot(d[0], d[1]); return { x: q[0], y: q[1], tx: d[0] / l, ty: d[1] / l }; } // A point on the loop and which way it's heading.
      const LOOP = "M237 233.7 C280.1 239.2 282.4 188.6 256 193 C238 196 260 215 239 218";
      let spines = "", scales = "";
      [.06, .22, .38, .54, .7, .86].forEach(function (t) { // Spikes standing on the outside edge.
        const a = at(t), nx = -a.ty, ny = a.tx, bx = a.x + nx * 8, by = a.y + ny * 8;
        spines += "M" + r(bx - a.tx * 6) + " " + r(by - a.ty * 6) + " L" + r(bx + nx * 13) + " " + r(by + ny * 13) + " L" + r(bx + a.tx * 6) + " " + r(by + a.ty * 6) + "Z ";
      });
      for (let i = 0; i <= 11; i++) { // Rows of little U-shaped scales along the loop.
        const a = at(i / 11), nx = -a.ty, ny = a.tx;
        [-4.2, 3.6].forEach(function (off) {
          const px = a.x + nx * off, py = a.y + ny * off;
          scales += "M" + r(px - a.ty * -3) + " " + r(py + a.tx * -3) + " Q" + r(px + a.tx * 6) + " " + r(py + a.ty * 6) + " " + r(px - a.ty * 3) + " " + r(py + a.tx * 3) + " ";
        });
      }
      return p(spines, "#2f8f83") + p(LOOP, "none", 'stroke="#28706a" stroke-width="20" ' + LINE) + p(LOOP, "none", 'stroke="#49c2a8" stroke-width="16" ' + LINE) + p(scales, "none", 'stroke="#1f6e66" stroke-width="1.5" ' + LINE) +
        p("M239 218 C232 208 222 208 216 214 C220 218 222 222 216 226 C224 232 234 230 239 218Z", "#2f8f83") + p("M238 218 Q228 216 221 219", "none", 'stroke="#a9f0dc" stroke-width="2" ' + LINE) +
        p(star(290, 176, 5), "#a9f0dc", 'class="lp-twinkle"') + p(star(304, 216, 4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.7s"');
    })() },
    // A wind-up tail in brass plates, with meshing gears on the outside, tiny rivets and one twinkling jewel.
    "acc-clockwork-tail": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, LOOP = "M237 233.7 C280.1 239.2 282.4 188.6 256 193 C238 196 260 215 239 218";
      function gear(x, y, size, teeth, turn, fill) { // A toothed wheel with a hub and spokes.
        let d = "";
        for (let i = 0; i < teeth * 4; i++) { const a = (i * Math.PI / (teeth * 2)) + turn, out = i % 4 < 2 ? size * 1.28 : size, ang = a - Math.PI / (teeth * 4); d += (i ? " L" : "M") + r(x + out * Math.cos(ang)) + " " + r(y + out * Math.sin(ang)); }
        return p(d + "Z", fill) + c(x, y, r(size * .62), "#7a5a24", "") + c(x, y, r(size * .4), fill, "") + c(x, y, r(size * .16), "#3a2a12", "");
      }
      return p(LOOP, "none", 'stroke="#7a5a24" stroke-width="20" ' + LINE) + p(LOOP, "none", 'stroke="#d9b24a" stroke-width="16" ' + LINE) + p(LOOP, "none", 'stroke="#8a6a2a" stroke-width="16" stroke-dasharray="2 11" fill="none"') +
        gear(292, 222, 16, 10, 0, "#ffdc83") + gear(298, 192, 11, 8, .35, "#d9b24a") + gear(276, 170, 8, 7, .1, "#ffe9ad") +
        [[252, 238], [266, 231], [275, 216], [276, 202]].map(function (v) { return c(v[0], v[1], 2, "#fff1cd", ""); }).join("") +
        c(250, 205, 5.5, "#70ebea", 'stroke="#2a8c94" stroke-width="1.5" class="lp-twinkle"') + p(star(306, 244, 5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:.6s"');
    })() },

    // Star Capsule wings
    // Each drawing is made once for her left side and mirrored about x = 160 for the right.
    // Painted-on spots in cream and sky blue.
    "acc-wing-dots": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + [[62, 128, 9], [84, 140, 6], [47, 140, 5.5], [73, 158, 7.5], [55, 163, 4.5], [78, 119, 4.5], [80, 198, 7.5], [64, 205, 4.5], [90, 211, 4]].map(function (d, i) {
        return c(d[0], d[1], d[2], i % 2 ? "#70ebea" : "#fff1cd", 'opacity=".95"');
      }).join("") + "</g>";
    }).join("") },
    // Little gold bells tied to the wing edges with short red ribbons.
    "acc-wing-bells": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + [[45, 158, 10], [58, 104, 8], [66, 217, 8]].map(function (b) {
        const x = b[0], y = b[1], s = b[2];
        return p("M" + x + " " + (y - 3) + " V" + (y + 4), "none", 'stroke="#e8556a" stroke-width="3" ' + LINE) +
          p("M" + (x - s) + " " + (y + 2 * s + 2) + " Q" + (x - s) + " " + (y + 4) + " " + x + " " + (y + 4) + " Q" + (x + s) + " " + (y + 4) + " " + (x + s) + " " + (y + 2 * s + 2) + " L" + (x + s + 3) + " " + (y + 2 * s + 6) + " H" + (x - s - 3) + " Z", "#ffdc83") +
          c(x, y + 2 * s + 7, 3, "#b58a2e", "");
      }).join("") + "</g>";
    }).join("") },
    // Big felt hearts sewn on with white running stitch.
    "acc-wing-hearts": { layer: "front", svg: (function () {
      function heart(x, y, s) { const r = function (n) { return Math.round(n * 10) / 10; }; return "M" + x + " " + r(y + s) + " C" + r(x - 1.7 * s) + " " + r(y + .1 * s) + " " + r(x - .9 * s) + " " + r(y - s) + " " + x + " " + r(y - .3 * s) + " C" + r(x + .9 * s) + " " + r(y - s) + " " + r(x + 1.7 * s) + " " + r(y + .1 * s) + " " + x + " " + r(y + s) + "Z"; }
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + [[64, 138, 22, "#e8556a"], [77, 201, 11, "#ff8ecb"]].map(function (h) {
          return p(heart(h[0], h[1], h[2]), h[3]) + p(heart(h[0], h[1], Math.round(h[2] * .78)), "none", 'stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3" ' + LINE);
        }).join("") + "</g>";
      }).join("");
    })() },
    // Two big green leaves laid over her wings, with a pale midrib, side veins and a touch of autumn at the tip.
    "acc-wing-leaves": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + p("M97 176 C58 182 26 150 30 98 C70 92 96 126 97 176Z", "#7ccb7e") + p("M30 98 C42 96 54 98 62 104 C48 110 38 122 34 132 C30 122 29 110 30 98Z", "#e8b04a", 'opacity=".85"') +
        p("M97 176 Q66 142 34 104 M80 156 Q58 158 46 150 M68 142 Q50 138 40 128 M80 156 Q84 136 80 122 M68 142 Q72 124 66 108", "none", 'stroke="#3f8a55" stroke-width="2.2" ' + LINE) +
        p("M101 190 C80 180 56 188 50 216 C76 226 98 214 101 190Z", "#9edb8b") + p("M101 190 Q76 202 50 216 M84 197 Q78 208 72 212 M84 197 Q74 192 66 192", "none", 'stroke="#4f9e63" stroke-width="2" ' + LINE) + "</g>";
    }).join("") },
    // Painted butterfly wings: amber panes, a dark border dotted with white, veins, and an eyespot on the lower wing.
    "acc-wing-butterfly": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + p("M98 177 C10 176 28 76 79 108 C90 115 92 132 92 153 Q92 170 98 177Z", "#ffa63d", 'stroke="#3a1c3a" stroke-width="5" stroke-linejoin="round"') +
        p("M98 176 Q60 150 46 118 M98 176 Q70 128 66 108 M98 176 Q50 168 38 142 M92 150 Q84 124 78 112", "none", 'stroke="#3a1c3a" stroke-width="2.4" ' + LINE) +
        [[40, 124, 2.8], [37, 136, 3], [42, 150, 2.8], [52, 164, 2.8], [50, 112, 2.6], [64, 106, 2.4]].map(function (d) { return c(d[0], d[1], d[2], "#fff8dc", ""); }).join("") +
        p("M103 183 C38 174 48 238 93 215 L100 200 Z", "#ffc35e", 'stroke="#3a1c3a" stroke-width="4.5" stroke-linejoin="round"') +
        c(76, 202, 10.5, "#3a1c3a", "") + c(76, 202, 7, "#ffe07a", "") + c(76, 202, 3.8, "#3b6fd8", "") + c(74.5, 200.5, 1.2, "#fff", "") + "</g>";
    }).join("") },
    // A church-window wing: wedges of coloured glass fanned from the shoulder, in two rings, with dark leading and a jewel at the hinge.
    "acc-wing-stained-glass": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      function bez(a, b, e, f, t) { const u = 1 - t; return [0, 1].map(function (k) { return r(u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * e[k] + t * t * t * f[k]); }); } // A point on a wing's outer curve.
      const colours = ["#ff8ecb", "#70ebea", "#ffdc83", "#c9a8ff", "#8ddc8f", "#ff9d6b"], LEAD = 'stroke="#2b1d50" stroke-width="2" stroke-linejoin="round" fill-opacity=".9"';
      function fan(base, rim, shift) { // Two rings of glass panes between the hinge and the points around the rim.
        let out = "";
        for (let i = 0; i < rim.length - 1; i++) {
          const mid = function (q) { return [r(base[0] + (q[0] - base[0]) * .55), r(base[1] + (q[1] - base[1]) * .55)]; }, m1 = mid(rim[i]), m2 = mid(rim[i + 1]);
          out += p("M" + base.join(" ") + " L" + m1.join(" ") + " L" + m2.join(" ") + "Z", colours[(i + shift) % 6], LEAD);
          out += p("M" + m1.join(" ") + " L" + rim[i].join(" ") + " L" + rim[i + 1].join(" ") + " L" + m2.join(" ") + "Z", colours[(i + shift + 2) % 6], LEAD);
        }
        return out;
      }
      const upperOut = [[98, 177], [10, 176], [28, 76], [79, 108]], upperIn = [[79, 108], [90, 115], [92, 132], [92, 153]], lower = [[103, 183], [38, 174], [48, 238], [93, 215]];
      const top = [0, .18, .33, .47, .6, .72, .85, 1].map(function (t) { return bez(upperOut[0], upperOut[1], upperOut[2], upperOut[3], t); }).concat([.5, 1].map(function (t) { return bez(upperIn[0], upperIn[1], upperIn[2], upperIn[3], t); }));
      const low = [0, .22, .45, .68, .85, 1].map(function (t) { return bez(lower[0], lower[1], lower[2], lower[3], t); });
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + p("M98 177 C10 176 28 76 79 108 C90 115 92 132 92 153 Q92 170 98 177Z M103 183 C38 174 48 238 93 215 L100 200 Z", "#fff1cd", 'fill-opacity=".5" stroke="none"') +
          fan([96, 175], top, m) + fan([100, 192], low, m + 3) +
          p("M98 177 C10 176 28 76 79 108 C90 115 92 132 92 153 Q92 170 98 177Z M103 183 C38 174 48 238 93 215 L100 200 Z", "none", 'stroke="#2b1d50" stroke-width="3.5" stroke-linejoin="round"') +
          c(96, 176, 5.5, "#ffdc83") + c(100, 192, 4, "#ffdc83") +
          p(star(52, 132, 6), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (m * .6) + 's"') + p(star(66, 204, 4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (.4 + m * .6) + 's"') + "</g>";
      }).join("");
    })() },
    // A proper swept wing of broad round feathers: long gold-dipped flight feathers fanning up and out, peach ones layered over their roots, and a blush-pink row below.
    "acc-wing-dawn-feathers": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      function feather(x, y, a, len, w, fill) { // One round-ended feather with its quill, drawn pointing up and then turned.
        return p("M0 0 C" + -w + " " + r(-len * .3) + " " + -w + " " + r(-len * .85) + " 0 " + -len + " C" + w + " " + r(-len * .85) + " " + w + " " + r(-len * .3) + " 0 0Z M0 -4 L0 " + (6 - len), fill, 'stroke="#8a6a55" stroke-opacity=".7" stroke-width="1.4" stroke-linejoin="round" transform="translate(' + x + " " + y + ") rotate(" + a + ')"');
      }
      function tip(x, y, a, len, w) { // The gold dip at a feather's end.
        const o = r(.6 * w), s = r(-.8 * len);
        return p("M" + -o + " " + s + " Q" + r(-.45 * w) + " " + r(-.97 * len) + " 0 " + -len + " Q" + r(.45 * w) + " " + r(-.97 * len) + " " + o + " " + s + " Q0 " + r(-.72 * len) + " " + -o + " " + s + "Z", "#ffdc83", 'stroke="#b58a2e" stroke-width="1" stroke-linejoin="round" transform="translate(' + x + " " + y + ") rotate(" + a + ')"');
      }
      const long = [[-86, 66], [-74, 76], [-62, 84], [-50, 86], [-38, 80], [-27, 70], [-20, 58]], low = [[-132, 40], [-116, 50], [-100, 48]], covert = [[-82, 42], [-66, 46], [-50, 46], [-35, 42], [-23, 36]];
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + low.map(function (f) { return feather(98, 190, f[0], f[1], 13, "#ffd3e6"); }).join("") +
          long.map(function (f) { return feather(92, 172, f[0], f[1], 14, "#fff8ec") + tip(92, 172, f[0], f[1], 14); }).join("") +
          covert.map(function (f) { return feather(93, 173, f[0], f[1], 13, "#ffc48a"); }).join("") +
          p(star(22, 118, 6), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (m * .5) + 's"') + p(star(50, 74, 4.5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:' + (.8 + m * .5) + 's"') + "</g>";
      }).join("");
    })() },

    // ---- Star Capsule wardrobe: ten more Capsule-only things for every slot, won from the capsules, never sold.
    // Star Capsule wardrobe head
    // The top of her head runs from about (122, 92) to (198, 92) between her ears, which stand up at (88, 62) and (232, 62).
    // A blue baseball cap worn with its peak pushed round to her right: panel seams, a top button and a star on the front.
    "acc-baseball-cap": { layer: "front", svg: p("M122 92 C120 54 200 54 198 92 Q160 100 122 92Z", "#4aa3e8") + // The rounded crown.
      p("M160 63 Q146 74 142 96 M160 63 Q174 74 178 96", "none", 'stroke="#2c74b5" stroke-width="2" ' + LINE) + // Two panel seams curving down from the button.
      p(star(160, 80, 9), "#fff8dc", "") + // A cream star on the front panel.
      p("M122 92 Q160 100 198 92", "none", 'stroke="#2c74b5" stroke-width="4" ' + LINE) + // The sweatband along the bottom edge.
      p("M188 90 Q214 74 244 84 Q242 96 194 98Z", "#2c74b5") + // The peak, sticking out sideways.
      c(160, 62, 4.5, "#2c74b5") },
    // A pink headband with two tall white bunny ears, the right one flopped over at the tip, and a little bow.
    "acc-bunny-band": { layer: "front", svg: p("M144 86 C128 60 124 22 136 14 C150 8 158 50 156 84Z", "#fff8ec") + // Left ear, standing tall.
      p("M147 78 C137 58 133 32 138 22 C146 24 150 52 151 78Z", "#ffb3da", "") + // Its pink inside.
      p("M166 84 C164 54 170 30 182 24 C196 18 212 26 208 38 C196 36 184 48 178 84Z", "#fff8ec") + // Right ear, bent over.
      p("M170 78 C170 56 174 38 184 32 C192 28 200 30 201 33 C188 38 180 54 174 78Z", "#ffb3da", "") +
      p("M112 98 Q160 74 208 98", "none", 'stroke="#ff8ecb" stroke-width="7" ' + LINE) + // The band itself, over the ear bases.
      bow(194, 90, 8, "#c9a8ff") },
    // A puffy white chef's hat: three soft puffs on a pleated band with a pink heart badge.
    "acc-chef-hat": { layer: "front", svg: c(136, 62, 18, "#fff8ec") + c(184, 62, 18, "#fff8ec") + c(160, 48, 23, "#fff8ec") + // The puffs.
      p("M150 40 Q156 34 164 34", "none", 'stroke="#e6dccf" stroke-width="2.5" ' + LINE) + // A soft fold on the middle puff.
      p("M130 94 L132 70 Q160 76 188 70 L190 94 Q160 100 130 94Z", "#fff8ec") + // The band.
      p("M144 75 L143 96 M176 75 L177 96", "none", 'stroke="#e6dccf" stroke-width="2" ' + LINE) + // Pleats.
      p("M160 92 C152 87 152 80 156 80 C158 80 160 82 160 84 C160 82 162 80 164 80 C168 80 168 87 160 92Z", "#ff8ecb", "") }, // Heart badge.
    // A pale blue nightcap with a cream cuff, sprinkled with stars, flopping over to her right with a pom-pom on the tip.
    "acc-sleepy-nightcap": { layer: "front", svg: p("M124 86 C126 50 150 34 180 36 C212 38 234 60 238 96 L226 94 C224 76 214 66 200 66 L198 86Z", "#9fc3ff") + // The cap and its droopy tip.
      [[148, 62, 5], [176, 50, 4], [184, 72, 4.5], [216, 56, 3.5], [162, 76, 3]].map(function (s) { return p(star(s[0], s[1], s[2]), "#ffdc83", ""); }).join("") + // Star print.
      p("M138 66 A7 7 0 1 0 146 76 A5.5 5.5 0 1 1 138 66Z", "#fff1cd", "") + // A little crescent moon.
      p("M120 96 Q160 82 202 96 L200 82 Q160 70 122 82Z", "#fff8ec") + // The fluffy cuff.
      c(232, 100, 9, "#fff8ec") },
    // A wide woven straw hat with a pink ribbon, ribbon tails behind and a daisy tucked in the band.
    "acc-straw-sunhat": { layer: "front", svg: o(160, 90, 76, 15, "#f2d28c") + // The brim.
      o(160, 90, 62, 10, "none", 'stroke="#c99a52" stroke-width="1.6" stroke-dasharray="4 4"') + // A ring of weave on the brim.
      p("M190 86 L214 112 L206 114 L186 90Z M192 86 L222 104 L216 110Z", "#ff8ecb") + // Ribbon tails trailing off the back.
      p("M128 90 C126 52 194 52 192 90 Q160 98 128 90Z", "#f2d28c") + // The crown.
      p("M132 72 Q160 66 188 72", "none", 'stroke="#c99a52" stroke-width="1.6" stroke-dasharray="4 4"') + // A row of weave on the crown.
      p("M128 80 Q160 88 192 80 L192 90 Q160 98 128 90Z", "#ff8ecb") + // The ribbon band.
      [0, 60, 120, 180, 240, 300].map(function (d) { const a = d * Math.PI / 180; return c(Math.round((182 + 6 * Math.cos(a)) * 10) / 10, Math.round((84 + 6 * Math.sin(a)) * 10) / 10, 4, "#fff"); }).join("") + // Daisy petals.
      c(182, 84, 3.6, "#ffdc83", "") },
    // A tiny plum top hat perched at a jaunty angle, with a lilac band and a heart playing card tucked in it.
    "acc-tiny-top-hat": { layer: "front", svg: '<g transform="rotate(14 178 88)">' + o(178, 88, 30, 6.5, "#3a2a52") + // The brim.
      p("M161 86 L163 44 Q178 40 193 44 L195 86 Q178 91 161 86Z", "#4a3868") + // The tall body.
      o(178, 44, 15, 4.5, "#5a4880") + // The top.
      p("M162 74 Q178 78 194 74 L195 84 Q178 89 161 84Z", "#c9a8ff", "") + // The band.
      p("M188 76 L194 50 L206 53 L200 79Z", "#fff8ec", 'stroke="#462846" stroke-opacity=".5" stroke-width="1.5" stroke-linejoin="round"') + // The playing card.
      p("M197 70 C190 66 192 59 195 60 C196.5 60.4 197 62 197 63 C198 62 199 61 200.5 61.5 C203 63 202 69 197 70Z", "#e8556a", "") + // Its heart.
      p("M166 50 V70", "none", 'stroke="#fff" stroke-width="2.5" opacity=".35" ' + LINE) + "</g>" }, // A shine down the side.
    // A two-tier birthday cake balanced on her head: pink and lilac sponge, drippy icing, sprinkles and three lit candles.
    "acc-birthday-cake-hat": { layer: "front", svg: p("M126 92 V72 H194 V92 Q160 100 126 92Z", "#ffb3da") + // Bottom tier.
      p("M126 72 Q126 64 160 64 Q194 64 194 72 V78 Q190 84 186 78 Q180 86 174 78 Q168 84 162 78 Q156 86 150 78 Q144 84 138 78 Q132 86 126 78Z", "#fff8ec") + // Its drippy icing.
      p("M142 72 V56 H178 V72 Q160 76 142 72Z", "#c9a8ff") + // Top tier.
      p("M142 56 Q142 50 160 50 Q178 50 178 56 V60 Q174 66 168 60 Q162 66 156 60 Q150 66 142 60Z", "#fff8ec") + // Its icing.
      [[134, 88, "#70ebea"], [148, 90, "#ffdc83"], [172, 90, "#70ebea"], [186, 87, "#ff8ecb"], [152, 68, "#ff8ecb"], [168, 68, "#ffdc83"]].map(function (s) { return c(s[0], s[1], 2, s[2], ""); }).join("") + // Sprinkles.
      [150, 160, 170].map(function (x, i) { // Each candle with its flame.
        return p("M" + (x - 2.5) + " 52 V36 h5 V52Z", ["#70ebea", "#ff8ecb", "#ffdc83"][i]) + o(x, 30, 3.5, 5.5, "#ffb84a", 'class="lp-twinkle" style="animation-delay:' + (i * .3) + 's"') + o(x, 31.5, 1.6, 2.8, "#fff8dc", "");
      }).join("") },
    // A spiral pearl unicorn horn on a lilac headband, with roses and leaves around its base and a few twinkles.
    "acc-unicorn-horn": { layer: "front", svg: p("M112 98 Q160 74 208 98", "none", 'stroke="#c9a8ff" stroke-width="6" ' + LINE) + // The headband.
      p("M148 86 L160 16 L172 86 Q160 92 148 86Z", "#fff1cd") + // The horn.
      p("M150 76 L170.5 69 M152 62 L168.5 55 M154.5 48 L166.5 42 M156.5 35 L164 31 M158.5 25 L161.5 23", "none", 'stroke="#ffc94a" stroke-width="3" ' + LINE) + // The spiral groove.
      p("M154 80 L158 30", "none", 'stroke="#fff" stroke-width="2.5" opacity=".7" ' + LINE) + // Pearly shine.
      p("M126 90 Q118 80 112 86 Q118 94 126 90Z M194 90 Q202 80 208 86 Q202 94 194 90Z M144 92 Q138 100 130 98 Q136 90 144 92Z M176 92 Q182 100 190 98 Q184 90 176 92Z", "#8ddc8f") + // Leaves.
      [[138, 88, 9, "#ff8ecb"], [182, 88, 9, "#ff8ecb"], [124, 94, 6, "#c9a8ff"], [196, 94, 6, "#c9a8ff"]].map(function (f) { // Roses, each with a swirl.
        return c(f[0], f[1], f[2], f[3]) + p("M" + f[0] + " " + f[1] + " m-" + (f[2] * .45) + " 0 a" + (f[2] * .45) + " " + (f[2] * .45) + " 0 1 1 " + (f[2] * .45) + " " + (f[2] * .45), "none", 'stroke="#fff" stroke-width="1.6" opacity=".8" ' + LINE);
      }).join("") +
      p(star(132, 40, 6), "#fff8dc", 'class="lp-twinkle"') + p(star(192, 30, 5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:.6s"') + p(star(204, 60, 3.5), "#c9a8ff", 'class="lp-twinkle" style="animation-delay:1.1s"') },
    // A white china teapot worn as a hat: blue band, a painted rose, a pink knob on the lid and steam curling from the spout.
    "acc-teapot-hat": { layer: "front", svg: p("M188 60 C214 52 216 86 190 84", "none", 'stroke="#462846" stroke-opacity=".5" stroke-width="10" ' + LINE) + p("M188 60 C214 52 216 86 190 84", "none", 'stroke="#fff8ec" stroke-width="6" ' + LINE) + // The handle.
      p("M134 80 C120 78 112 62 104 48 L114 44 C120 58 126 66 136 66Z", "#fff8ec") + // The spout.
      o(160, 91, 24, 5, "#e2d6ee") + // The foot ring.
      p("M130 88 C124 62 140 46 160 46 C180 46 196 62 190 88 Q160 96 130 88Z", "#fff8ec") + // The round pot.
      p("M128 72 Q160 80 192 72", "none", 'stroke="#4aa3e8" stroke-width="4" ' + LINE) + p("M130 80 Q160 88 190 80", "none", 'stroke="#4aa3e8" stroke-width="1.6" stroke-dasharray="1 4" ' + LINE) + // Blue band and a row of dots.
      p("M150 62 Q144 56 148 52 Q152 58 150 62Z M170 62 Q176 56 172 52 Q168 58 170 62Z", "#8ddc8f", "") + c(160, 60, 6.5, "#ff8ecb", "") + p("M157 60 a3 3 0 1 1 3 3", "none", 'stroke="#fff" stroke-width="1.6" ' + LINE) + // The painted rose.
      p("M138 50 Q160 34 182 50 Q160 56 138 50Z", "#fff8ec") + p("M140 50 Q160 55 180 50", "none", 'stroke="#ffdc83" stroke-width="2" ' + LINE) + c(160, 38, 5, "#ff8ecb") + // The lid with a gold rim and its knob.
      [[0, 0], [12, .7]].map(function (s) { return p("M" + (102 + s[0]) + " 40 C" + (94 + s[0]) + " 32 " + (110 + s[0]) + " 26 " + (102 + s[0]) + " 16 C" + (96 + s[0]) + " 10 " + (104 + s[0]) + " 6 " + (102 + s[0]) + " 4", "none", 'stroke="#fff" stroke-width="3" opacity=".7" class="lp-twinkle" style="animation-delay:' + s[1] + 's" ' + LINE); }).join("") }, // Two wisps of steam.
    // The epic showpiece: a glowing see-through moon jellyfish for a bonnet, with a scalloped frilly hem, the four pink rings of a moon jelly, shining spots and long drifting ribbon tentacles.
    "acc-moonjelly-bonnet": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      let hem = "M106 94 C100 24 220 24 214 94";
      for (let i = 8; i >= 0; i--) hem += " A6 6 0 0 1 " + r(106 + i * 12) + " 94"; // Nine scallops back along the bottom edge.
      const tentacles = [0, 1].map(function (m) { // Ribbons drifting down beside her face, drawn for her left and mirrored.
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
          p("M112 96 C98 112 108 126 94 142 C84 154 94 170 82 188", "none", 'stroke="#ffb3da" stroke-width="5" opacity=".85" ' + LINE) +
          p("M122 98 C114 114 122 124 112 136 C106 144 110 152 104 160", "none", 'stroke="#d9b8ff" stroke-width="4" opacity=".85" ' + LINE) +
          p("M106 92 C92 102 94 116 82 124 C74 130 78 140 70 148", "none", 'stroke="#bff6f4" stroke-width="3" opacity=".85" ' + LINE) +
          c(82, 188, 3, "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (m * .5) + 's"') + "</g>";
      }).join("");
      return tentacles + p(hem + "Z", "#d9b8ff", 'fill-opacity=".9" stroke="#8a6cf0" stroke-opacity=".6" stroke-width="2" stroke-linejoin="round"') + // The bell.
        o(160, 62, 40, 18, "#f3e6ff", 'opacity=".7"') + // Its inner glow.
        [[142, 58], [178, 58], [150, 76], [170, 76]].map(function (g) { return c(g[0], g[1], 7.5, "none", 'stroke="#ff8ecb" stroke-width="3"'); }).join("") + // The four rings.
        p("M108 96 Q114 104 120 97 Q126 105 132 98 Q138 106 144 99 Q150 107 156 100 Q160 106 164 100 Q170 107 176 99 Q182 106 188 98 Q194 105 200 97 Q206 104 212 96", "none", 'stroke="#ffb3da" stroke-width="3" opacity=".9" ' + LINE) + // A pink ruffle peeping under the rim.
        p("M112 86 Q160 98 208 86", "none", 'stroke="#fff8ec" stroke-width="2.5" opacity=".8" ' + LINE) + // A frill line along the rim.
        [[120, 74, 0], [130, 52, .4], [190, 52, .8], [200, 74, 1.2], [160, 88, .6], [160, 44, 1.5]].map(function (s) { return c(s[0], s[1], 2.6, "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + s[2] + 's"'); }).join("") + // Shining spots.
        p("M120 72 Q124 56 138 48", "none", 'stroke="#fff" stroke-width="4" opacity=".7" ' + LINE) + // A highlight on the dome.
        p(star(160, 30, 9), "#fff8dc", 'stroke="#8a6cf0" stroke-width="1.2" class="lp-neon"') +
        p(star(98, 50, 5), "#bff6f4", 'class="lp-twinkle" style="animation-delay:.3s"') + p(star(226, 44, 6), "#ffc6e4", 'class="lp-twinkle" style="animation-delay:.9s"');
    })() },

    // Star Capsule wardrobe neck
    // Her neck runs under her chin from about (116, 196) through (160, 206) to (204, 196); her belly is below, centred on (160, 230).
    // A chain of white and blush daisies on a green stem, with little leaves between the flowers.
    "acc-daisy-chain": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      function at(t) { return [r((1 - t) * (1 - t) * 116 + 2 * (1 - t) * t * 160 + t * t * 204), r((1 - t) * (1 - t) * 196 + 2 * (1 - t) * t * 236 + t * t * 196)]; } // A point along the stem.
      let out = p("M116 196 Q160 236 204 196", "none", 'stroke="#5f9e4f" stroke-width="3" ' + LINE); // The stem.
      for (let i = 0; i < 6; i++) { const l = at((i + .5) / 6); out += p("M" + l[0] + " " + l[1] + " q4 -7 9 -2 q-4 6 -9 2Z", "#8ddc8f", ""); } // A leaf between each pair of flowers.
      for (let i = 0; i <= 6; i++) { // Seven daisies, each six petals round a gold middle.
        const d = at(i / 6), petal = i % 2 ? "#ffd6ec" : "#fff";
        out += [0, 60, 120, 180, 240, 300].map(function (g) { const a = (g + i * 15) * Math.PI / 180; return c(r(d[0] + 5 * Math.cos(a)), r(d[1] + 5 * Math.sin(a)), 3.8, petal, 'stroke="#d9b8c8" stroke-width="1"'); }).join("") + c(d[0], d[1], 3.2, "#ffdc83", "");
      }
      return out;
    })() },
    // A stitched leather collar with a gold buckle, a silver ring and a little teal fish-shaped name tag.
    "acc-fish-tag-collar": { layer: "front", svg: p("M116 194 Q160 216 204 194", "none", 'stroke="#a8743e" stroke-width="9" ' + LINE) + // The leather strap.
      p("M118 194 Q160 215 202 194", "none", 'stroke="#f3d7a8" stroke-width="1.4" stroke-dasharray="3 3" fill="none"') + // Stitching.
      '<g transform="rotate(26 131 200)">' + p("M125 194 h12 v12 h-12Z", "none", 'stroke="#ffdc83" stroke-width="2.5" stroke-linejoin="round"') + p("M131 194 v12", "none", 'stroke="#ffdc83" stroke-width="2" ' + LINE) + "</g>" + // The buckle.
      c(160, 208, 3.5, "none", 'stroke="#c8ccd8" stroke-width="2.5"') + p("M160 211 L158 214", "none", 'stroke="#c8ccd8" stroke-width="2" ' + LINE) + // Ring and its link.
      p("M166 222 L178 213 L175 222 L178 231Z", "#70ebea") + o(156, 222, 12, 8, "#70ebea") + // The fish's tail and body.
      p("M153 215 Q158 209 163 215", "#2a8c94", "") + c(149, 221, 2, "#2a5a64", "") + // Its fin and eye.
      p("M155 218 q3 4 0 8 M160 218 q3 4 0 8", "none", 'stroke="#2a8c94" stroke-width="1.5" ' + LINE) + // Scales.
      p("M147 218 Q150 215 154 215", "none", 'stroke="#fff" stroke-width="1.8" opacity=".8" ' + LINE) },
    // A red necktie with gold stripes and a darker knot, over two little white shirt-collar points.
    "acc-striped-necktie": { layer: "front", svg: p("M160 206 L138 194 L144 214Z M160 206 L182 194 L176 214Z", "#fff8ec") + // Collar points.
      p("M155 216 L165 216 L173 250 L160 262 L147 250Z", "#e8556a") + // The tie.
      p("M152.5 229 L165.8 221.5 M150 241 L168 231 M150.5 252 L170 241", "none", 'stroke="#ffdc83" stroke-width="3.5" fill="none"') + // Stripes running edge to edge.
      p("M151 203 h18 l-3 13 h-12Z", "#c83c52") },
    // A white dinner bib tied at the back, with dashed pink piping and a pair of cherries printed on it.
    "acc-cherry-bib": { layer: "front", svg: p("M118 196 Q108 192 102 184 M202 196 Q212 192 218 184", "none", 'stroke="#ff8ecb" stroke-width="3" ' + LINE) + // Tie strings.
      p("M118 196 Q160 216 202 196 C214 222 200 250 160 252 C120 250 106 222 118 196Z", "#fff8ec") + // The bib.
      p("M121 204 C115 224 126 244 160 245 C194 244 205 224 199 204", "none", 'stroke="#ff8ecb" stroke-width="2.5" stroke-dasharray="5 3" ' + LINE) + // Piping.
      p("M118 196 Q160 216 202 196", "none", 'stroke="#ff8ecb" stroke-width="5" ' + LINE) + // The neck band.
      p("M154 232 Q156 222 164 218 M168 234 Q166 226 164 218", "none", 'stroke="#5f9e4f" stroke-width="2.5" ' + LINE) + p("M164 218 Q172 210 178 216 Q170 222 164 218Z", "#8ddc8f", "") + // Stems and a leaf.
      c(153, 236, 6.5, "#e8405f") + c(169, 238, 6.5, "#e8405f") + c(150.5, 233.5, 1.8, "#fff", "") + c(166.5, 235.5, 1.8, "#fff", "") },
    // A fluffy hot-pink feather boa looped round her neck, one end dangling down her right side.
    "acc-feather-boa": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, puffs = [];
      function along(a, b, q, n) { // Puffs either side of a curve from a to b bending towards q, n steps.
        for (let i = 0; i <= n; i++) {
          const t = i / n, u = 1 - t, x = u * u * a[0] + 2 * u * t * q[0] + t * t * b[0], y = u * u * a[1] + 2 * u * t * q[1] + t * t * b[1];
          const dx = 2 * u * (q[0] - a[0]) + 2 * t * (b[0] - q[0]), dy = 2 * u * (q[1] - a[1]) + 2 * t * (b[1] - q[1]), l = Math.hypot(dx, dy), s = i % 2 ? 6 : 4.5; // Across the curve, a little uneven so it looks fluffy.
          puffs.push([r(x - dy / l * s), r(y + dx / l * s)], [r(x + dy / l * s), r(y - dx / l * s)]);
        }
      }
      along([108, 192], [212, 192], [160, 226], 12); // Round her neck.
      along([209, 198], [212, 256], [222, 226], 6); // The dangling end.
      const BOA = "M108 192 Q160 226 212 192 M209 198 Q222 226 212 256";
      return puffs.map(function (d) { return c(d[0], d[1], 7.5, "#ff6fae", 'stroke="#c43b80" stroke-opacity=".5" stroke-width="1.5"'); }).join("") + // Fluffy outer edge.
        p(BOA, "none", 'stroke="#ff6fae" stroke-width="15" ' + LINE) + // A solid core hiding the inner outlines.
        puffs.filter(function (d, i) { return i % 2 === 0; }).map(function (d, i) { return c(d[0], d[1], 4, i % 2 ? "#ffb3da" : "#ffc6e4", ""); }).join("") + // Soft lighter feathers.
        p(BOA, "none", 'stroke="#fff" stroke-width="2" stroke-dasharray="2 9" opacity=".6" ' + LINE); // Little glints along it.
    })() },
    // A dotted gold chain with an engraved heart locket and a pink gem set in the middle.
    "acc-heart-locket": { layer: "front", svg: p("M120 194 Q160 232 200 194", "none", 'stroke="#d9b24a" stroke-width="3.5" stroke-dasharray="0.1 4.5" ' + LINE) + // The chain, as a row of round links.
      c(160, 214, 3, "none", 'stroke="#d9b24a" stroke-width="2"') + // The bail.
      p("M160 248 C138 236 136 220 147 217 C153 215.5 158 219 160 223 C162 219 167 215.5 173 217 C184 220 182 236 160 248Z", "#ffdc83", 'stroke="#b58a2e" stroke-width="2" stroke-linejoin="round"') + // The heart.
      p("M160 241 C145 232 144 223 150 221 C155 220 158 223 160 227 C162 223 165 220 170 221 C176 223 175 232 160 241Z", "none", 'stroke="#d9a83a" stroke-width="1.5" stroke-linejoin="round"') + // Engraved inner line.
      c(160, 231, 4.5, "#ff5f8f", 'stroke="#c43b6c" stroke-width="1.2"') + c(158.5, 229.5, 1.3, "#fff", "") + // The gem.
      p("M144 222 Q143 229 149 234", "none", 'stroke="#fff" stroke-width="2" opacity=".75" ' + LINE) + p(star(181, 214, 5), "#fff8dc", 'class="lp-twinkle"') },
    // A gold winner's medal on a crossed blue and red ribbon, with a five-pointed star stamped in it.
    "acc-champion-medal": { layer: "front", svg: p("M120 194 L132 190 L164 232 L154 236Z", "#4aa3e8") + p("M126 192 L159 234", "none", 'stroke="#fff" stroke-width="2" ' + LINE) + // Blue strap.
      p("M200 194 L188 190 L156 232 L166 236Z", "#e8556a") + p("M194 192 L161 234", "none", 'stroke="#fff" stroke-width="2" ' + LINE) + // Red strap, crossing over.
      c(160, 240, 14, "#ffdc83", 'stroke="#b58a2e" stroke-width="2.5"') + c(160, 240, 10, "none", 'stroke="#d9a83a" stroke-width="1.5"') + // The medal and its rim.
      p((function () { let d = ""; for (let i = 0; i < 10; i++) { const a = (i * 36 - 90) * Math.PI / 180, l = i % 2 ? 3 : 7.5; d += (i ? " L" : "M") + Math.round((160 + l * Math.cos(a)) * 10) / 10 + " " + Math.round((241 + l * Math.sin(a)) * 10) / 10; } return d + "Z"; })(), "#d9a83a", "") + // The stamped star.
      p("M150 232 Q153 229 157 228", "none", 'stroke="#fff" stroke-width="2" opacity=".8" ' + LINE) },
    // A string of pearls and sea glass with a peach scallop shell, a pearl drop and a little orange starfish.
    "acc-mermaid-shells": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      function at(t) { return [r((1 - t) * (1 - t) * 118 + 2 * (1 - t) * t * 160 + t * t * 202), r((1 - t) * (1 - t) * 194 + 2 * (1 - t) * t * 232 + t * t * 194)]; } // A point along the string.
      let beads = "";
      [0, .08, .16, .24, .32, .4, .6, .68, .76, .84, .92, 1].forEach(function (t, i) { // Pearls, with a bead of sea glass every third.
        const b = at(t);
        beads += i % 3 === 1 ? c(b[0], b[1], 3.4, i % 2 ? "#a9ee9f" : "#70ebea", 'stroke="#2a8c94" stroke-opacity=".5" stroke-width="1"') : c(b[0], b[1], 4.2, "#fff8ec", 'stroke="#c8b8d8" stroke-width="1"') + c(r(b[0] - 1.3), r(b[1] - 1.3), 1.2, "#fff", "");
      });
      return p("M118 194 Q160 232 202 194", "none", 'stroke="#e8d8c8" stroke-width="1.5" ' + LINE) + beads + // The string, then the beads on it.
        p("M153 211 h14 l-2 6 h-10Z", "#ff9f8a") + // The shell's hinge.
        p("M160 216 L142 231 Q143 239 149 241 Q154 245 160 244 Q166 245 171 241 Q177 239 178 231Z", "#ffc6b8", 'stroke="#c46a5a" stroke-opacity=".6" stroke-width="1.8" stroke-linejoin="round"') + // The scallop shell.
        p("M160 217 L147 239 M160 217 L153 243 M160 217 V244 M160 217 L167 243 M160 217 L173 239", "none", 'stroke="#e88a78" stroke-width="1.6" ' + LINE) + // Its ridges.
        c(160, 250, 4.5, "#fff8ec", 'stroke="#c8b8d8" stroke-width="1"') + c(158.6, 248.6, 1.3, "#fff", "") + // A pearl drop.
        p((function () { let d = ""; for (let i = 0; i < 10; i++) { const a = (i * 36 - 90) * Math.PI / 180, l = i % 2 ? 3.5 : 9; d += (i ? " L" : "M") + r(186 + l * Math.cos(a)) + " " + r(214 + l * Math.sin(a)); } return d + "Z"; })(), "#ff9d6b", 'stroke="#c4603a" stroke-opacity=".6" stroke-width="1.5" stroke-linejoin="round"') + // The starfish.
        c(186, 214, 1.4, "#fff1cd", "") + c(186, 209, 1, "#fff1cd", "") + c(190.5, 213, 1, "#fff1cd", "") +
        p(star(134, 224, 4.5), "#bff6f4", 'class="lp-twinkle"') + p(star(176, 252, 3.5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.7s"');
    })() },
    // A navy velvet choker with gold edges and studs, a crystal prism hanging from it and a soft rainbow fanning out below.
    "acc-prism-choker": { layer: "front", svg: ["#ff5f6d", "#ffa64a", "#ffe066", "#7be08a", "#5fb4ff", "#b48cff"].map(function (colour, i) { // The rainbow, one slice per colour.
        const x = function (k) { return Math.round((138 + k * 44 / 6) * 10) / 10; };
        return p("M160 238 L" + x(i) + " 272 L" + x(i + 1) + " 272Z", colour, 'opacity=".5"');
      }).join("") +
      p("M114 192 Q160 214 206 192", "none", 'stroke="#ffdc83" stroke-width="12" ' + LINE) + p("M114 192 Q160 214 206 192", "none", 'stroke="#3c2a6a" stroke-width="8" ' + LINE) + // Gold-edged velvet band.
      [[128, 199.5], [143, 202.5], [177, 202.5], [192, 199.5]].map(function (s) { return c(s[0], s[1], 2, "#ffdc83", ""); }).join("") + // Studs.
      p("M155 205 h10 l-2 6 h-6Z", "#ffdc83") + // The setting.
      p("M160 210 L170 217 L170 232 L160 240 L150 232 L150 217Z", "#e6fbff", 'stroke="#5fb4ff" stroke-width="1.5" stroke-linejoin="round" class="lp-neon"') + // The crystal.
      p("M150 217 L160 222 L170 217 M160 222 V240", "none", 'stroke="#9fd8ff" stroke-width="1.2" ' + LINE) + p("M154 220 V230", "none", 'stroke="#fff" stroke-width="2" ' + LINE) + // Facets and a glint.
      p(star(178, 224, 5), "#fff8dc", 'class="lp-twinkle"') + p(star(140, 246, 4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.6s"') + p(star(184, 264, 3.5), "#ffe066", 'class="lp-twinkle" style="animation-delay:1.2s"') },
    // The legendary collar: two tiers of flame-red and amber phoenix feathers fanning round her neck, each long feather with a gold eye, a gold band, a blazing sun medallion with a ruby heart and embers drifting up.
    "acc-phoenix-collar": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      let quills = "";
      function feather(deg, len, w, fill, eye) { // One feather leaning out from a point on her collar line.
        const a = deg * Math.PI / 180, bx = 160 + 48 * Math.cos(a), by = 190 + 16 * Math.sin(a);
        let dx = Math.cos(a), dy = Math.sin(a) * 1.2 + .35; const l = Math.hypot(dx, dy); dx /= l; dy /= l; // Outwards, pulled a little downwards.
        const tx = bx + dx * len, ty = by + dy * len, mx = bx + dx * len * .55, my = by + dy * len * .55;
        quills += "M" + r(bx) + " " + r(by) + " L" + r(bx + dx * len * .85) + " " + r(by + dy * len * .85) + " ";
        return p("M" + r(bx) + " " + r(by) + " Q" + r(mx - dy * w) + " " + r(my + dx * w) + " " + r(tx) + " " + r(ty) + " Q" + r(mx + dy * w) + " " + r(my - dx * w) + " " + r(bx) + " " + r(by) + "Z", fill) +
          (eye ? c(r(tx - dx * 10), r(ty - dy * 10), 3.6, "#ffdc83", "") + c(r(tx - dx * 10), r(ty - dy * 10), 1.6, "#2fb6d8", "") : "");
      }
      let outer = "", inner = "";
      for (let d = 6; d <= 174; d += 14) outer += feather(d, 44, 11, (d / 14) % 2 < 1 ? "#e8403a" : "#ff6a3a", true); // Thirteen long red feathers.
      const outerQuills = quills; quills = "";
      for (let d = 14; d <= 166; d += 19) inner += feather(d, 28, 9, (d / 19) % 2 < 1 ? "#ff9d3a" : "#ffc04a", false); // Nine shorter amber ones on top.
      return outer + p(outerQuills, "none", 'stroke="#8f2a20" stroke-width="1.5" opacity=".7" ' + LINE) + inner + p(quills, "none", 'stroke="#b8642a" stroke-width="1.3" opacity=".7" ' + LINE) +
        p("M112 194 Q160 222 208 194", "none", 'stroke="#b58a2e" stroke-width="9" ' + LINE) + p("M112 194 Q160 222 208 194", "none", 'stroke="#ffdc83" stroke-width="5.5" ' + LINE) + // The gold band.
        '<g transform="rotate(45 160 216)">' + p(star(160, 216, 17), "#ffb84a") + "</g>" + p(star(160, 216, 21), "#ffdc83") + // Sun rays, eight points.
        c(160, 216, 10, "#ffdc83", 'stroke="#b58a2e" stroke-width="2"') + c(160, 216, 6, "#e8405f", 'stroke="#8f2a20" stroke-width="1.2" class="lp-neon"') + c(158, 214, 1.8, "#fff", "") + // The medallion and its ruby.
        [[94, 182, 4, 0], [84, 210, 3, .5], [104, 250, 3.5, 1], [226, 182, 4, .3], [236, 210, 3, .8], [216, 250, 3.5, 1.3]].map(function (s) { return p(star(s[0], s[1], s[2]), s[3] * 10 % 2 ? "#ffdc83" : "#ff9d3a", 'class="lp-twinkle" style="animation-delay:' + s[3] + 's"'); }).join(""); // Drifting embers.
    })() },

    // Star Capsule wardrobe wings
    // Round two of the capsule wings. Each is drawn once over her left wing and mirrored about x = 160 for the right.
    // Her upper wing runs from its hinge at about (98, 177) out to a tip near (28, 100); the lower one from (101, 190) down to (50, 220).
    // Little purple bat wings: a pointed top edge, three scallops underneath, dark finger bones and a tiny claw at the tip.
    "acc-wing-bat": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
        p("M100 186 Q74 184 46 218 Q62 214 66 230 Q84 218 99 210 Z", "#6a4aa6") + // The small lower wing, one scallop deep.
        p("M96 150 Q70 74 20 86 Q44 112 32 138 Q58 142 54 172 Q80 166 99 190 Z", "#7a55b8") + // The big upper wing: the top edge, then three scallops back to the hinge.
        p("M95 160 L22 88 M95 166 L33 138 M97 176 L55 171", "none", 'stroke="#3e2a66" stroke-width="2.6" ' + LINE) + // Finger bones out to each point.
        o(66, 128, 11, 5, "#b490e8", 'opacity=".55" transform="rotate(38 66 128)"') + // A soft shine on the skin.
        p("M23 89 L12 77 L28 85 Z", "#3e2a66", "") + "</g>"; // The little hooked claw.
    }).join("") },
    // Shiny red ladybird shells over her wings, with black spots, a glint, and see-through flying wings peeking out underneath.
    "acc-wing-ladybird": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
        p("M103 183 C38 174 48 238 93 215 L100 200 Z", "#fff8ec", 'fill-opacity=".6" stroke="#8a7a8a" stroke-width="1.5" stroke-linejoin="round"') + // The thin flying wing below.
        p("M101 190 Q74 196 56 212 M88 194 Q80 206 82 216", "none", 'stroke="#8a7a8a" stroke-width="1.4" opacity=".8" ' + LINE) + // Its veins.
        '<g transform="rotate(-42 62 140)">' + // The shell is drawn upright and tipped outwards along the wing.
        o(62, 140, 29, 51, "#e8405f", 'stroke="#2a1a2a" stroke-width="3"') +
        [[60, 104, 7.5], [46, 128, 6], [76, 126, 6.5], [58, 152, 8], [44, 168, 5], [78, 170, 5.5]].map(function (s) { return c(s[0], s[1], s[2], "#2a1a2a", ""); }).join("") + // Black spots.
        p("M44 112 Q48 98 60 94", "none", 'stroke="#fff" stroke-width="4" opacity=".8" ' + LINE) + "</g>" + "</g>"; // The glint near the top.
    }).join("") },
    // Fluffy cloud wings: heaps of white puffs with a soft blue shadow under each.
    "acc-wing-cloud-puff": { layer: "front", svg: [0, 1].map(function (m) {
      const puffs = [[42, 110, 14], [62, 102, 15], [80, 114, 12], [32, 134, 13], [53, 130, 16], [74, 136, 14], [89, 154, 11], [42, 156, 12], [64, 158, 13], [84, 172, 10], [56, 198, 11], [74, 192, 11], [70, 214, 10], [89, 205, 10], [88, 186, 9]]; // [x, y, radius], upper wing then lower.
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
        puffs.map(function (b) { return c(b[0], b[1] + 2.5, b[2] + 1.5, "#b9c7e8", ""); }).join("") + // The shadow layer, nudged down.
        puffs.map(function (b) { return c(b[0], b[1], b[2], "#fff", ""); }).join("") + "</g>"; // The white layer on top.
    }).join("") },
    // Folded paper wings: flat facets in three shades of mint paper, with crisp fold lines and little printed stars.
    "acc-wing-origami": { layer: "front", svg: [0, 1].map(function (m) {
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
        p("M97 174 L82 110 L22 94 Z", "#bdf0ea") + p("M97 174 L22 94 L30 156 Z", "#86d8d4") + p("M97 174 L30 156 L72 182 Z", "#55b4b8") + // Upper wing: light, middle and shadowed folds.
        p("M101 190 L48 198 L62 232 Z", "#bdf0ea") + p("M101 190 L62 232 L92 220 Z", "#55b4b8") + // Lower wing: two folds.
        p("M97 174 L22 94 M97 174 L30 156 M101 190 L62 232", "none", 'stroke="#fff" stroke-width="1.6" opacity=".9" ' + LINE) + // Crisp fold creases.
        [[64, 120, 4], [48, 108, 3], [80, 136, 3]].map(function (s) { return p(star(s[0], s[1], s[2]), "#ff8ecb", ""); }).join("") + "</g>"; // Stars printed on the paper.
    }).join("") },
    // Long see-through dragonfly wings with a lacy net of veins, a rainbow sheen and a dark spot near each tip.
    "acc-wing-dragonfly": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      function blade(x, y, a, rx, ry) { // One wing, drawn lying along x with its tip at -rx, then turned into place.
        let veins = "M" + (4 - rx) + " 0 L" + (rx - 6) + " 0";
        for (let i = -2; i <= 2; i++) { const vx = r(i * rx / 3), h = r(ry * .9 * Math.sqrt(1 - (vx / rx) * (vx / rx))); veins += " M" + vx + " " + -h + " L" + r(vx - 5) + " " + h; } // A few cross veins, slanted a little.
        return '<g transform="translate(' + x + " " + y + ") rotate(" + a + ')">' + o(0, 0, rx, ry, "#9ff0ee", 'fill-opacity=".6" stroke="#2a8c94" stroke-width="2"') +
          o(r(-rx * .2), r(-ry * .35), r(rx * .6), r(ry * .3), "#fff", 'opacity=".55"') + o(r(rx * .25), r(ry * .4), r(rx * .45), r(ry * .25), "#ffc6e4", 'opacity=".6"') + // A white sheen and a pink one.
          p(veins, "none", 'stroke="#2a8c94" stroke-width="1.2" opacity=".55" ' + LINE) + o(9 - rx, 0, 5, r(ry * .45), "#2a8c94", "") + "</g>"; // Veins, then the dark spot by the tip.
      }
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + blade(60, 200, -12, 42, 11) + blade(58, 134, 44, 52, 13) + c(97, 180, 4.5, "#2a8c94", "") + // Lower wing, upper wing, and the joint.
          p(star(30, 160, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (m * .6) + 's"') + "</g>";
      }).join("");
    })() },
    // Mermaid fins: webbed sea-blue fans with lilac hearts, spiky scalloped edges, a scaly base and a pearl at each hinge.
    "acc-wing-mermaid-fins": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, rad = Math.PI / 180;
      function fan(x, y, from, to, len, n, fill, more) { // A fin fanned out from (x, y): n panels between two angles, each edge dipping in between the ribs.
        let d = "M" + x + " " + y, ribs = "";
        for (let i = 0; i <= n; i++) {
          const a = (from + (to - from) * i / n) * rad, px = r(x + len * Math.cos(a)), py = r(y + len * Math.sin(a));
          if (i === 0) d += " L" + px + " " + py;
          else { const am = (from + (to - from) * (i - .5) / n) * rad; d += " Q" + r(x + len * .84 * Math.cos(am)) + " " + r(y + len * .84 * Math.sin(am)) + " " + px + " " + py; } // The scallop between two ribs.
          ribs += "M" + x + " " + y + " L" + px + " " + py + " ";
        }
        return p(d + "Z", fill, more) + (more === undefined ? p(ribs, "none", 'stroke="#3f9ec0" stroke-width="1.6" opacity=".8" ' + LINE) : "");
      }
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
          fan(100, 192, 148, 198, 52, 5, "#7fdcea") + fan(100, 192, 148, 198, 30, 5, "#c9a8ff", 'opacity=".75"') + // Lower fin and its lilac heart.
          fan(96, 172, 184, 258, 84, 8, "#7fdcea") + fan(96, 172, 184, 258, 50, 8, "#c9a8ff", 'opacity=".75"') + // Upper fin and its lilac heart.
          p("M78 166 a5 5 0 0 1 10 0 M84 156 a5 5 0 0 1 10 0 M72 154 a5 5 0 0 1 10 0 M80 146 a5 5 0 0 1 10 0", "none", 'stroke="#fff" stroke-width="1.6" opacity=".8" ' + LINE) + // Little scales at the base.
          c(96, 176, 6.5, "#fff8ec", 'stroke="#c9a8ff" stroke-width="1.5"') + c(94, 174, 2, "#fff", "") + // The pearl at the hinge.
          p(star(26, 128, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (m * .5) + 's"') + "</g>";
      }).join("");
    })() },
    // Gingerbread biscuits baked in the shape of her wings: piped white icing round the edges, a squiggle across, and sweets pressed on.
    "acc-wing-gingerbread": { layer: "front", svg: (function () {
      const UP = "M98 177 C10 176 28 76 79 108 C90 115 92 132 92 153 Q92 170 98 177Z", LOW = "M103 183 C38 174 48 238 93 215 L100 200 Z"; // Her own wing outlines.
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
          p(UP, "#c98a4b", 'stroke="#8a5a2a" stroke-width="2.5" stroke-linejoin="round"') + p(LOW, "#c98a4b", 'stroke="#8a5a2a" stroke-width="2.5" stroke-linejoin="round"') + // The biscuits.
          '<g transform="translate(96 174) scale(.78) translate(-96 -174)">' + p(UP, "none", 'stroke="#fff8ec" stroke-width="4" stroke-dasharray="1 7" ' + LINE) + "</g>" + // Dotted icing just inside the upper edge.
          '<g transform="translate(100 196) scale(.7) translate(-100 -196)">' + p(LOW, "none", 'stroke="#fff8ec" stroke-width="4" stroke-dasharray="1 7" ' + LINE) + "</g>" + // And the lower one.
          p("M42 140 q5 -8 10 0 t10 0 t10 0 t10 0", "none", 'stroke="#fff8ec" stroke-width="3.5" ' + LINE) + // A squiggle of icing across the middle.
          c(56, 120, 5.5, "#ff8ecb") + c(76, 156, 5, "#70ebea") + c(46, 158, 4.5, "#ffdc83") + c(68, 204, 5, "#a9ee9f") + c(66, 104, 3.5, "#c9a8ff") + // Sweets pressed into the dough.
          p("M36 124 l5 -2 M78 128 l3 4 M58 172 l5 1", "none", 'stroke="#e8556a" stroke-width="2.4" ' + LINE) + "</g>"; // A few sprinkles.
      }).join("");
    })() },
    // Pale green luna moth wings: a plum leading edge, golden eyespots, fine veins, and long ribbon tails curling down from the lower wings.
    "acc-wing-luna-moth": { layer: "front", svg: [0, 1].map(function (m) {
      function eye(x, y, s) { return c(x, y, s, "#a0466e", "") + c(x, y, s * .72, "#ffdc83", "") + c(x, y, s * .4, "#8ec9e8", "") + p("M" + (x - s * .5) + " " + (y - s * .2) + " Q" + x + " " + (y - s * .7) + " " + (x + s * .5) + " " + (y - s * .2), "none", 'stroke="#fff" stroke-width="1.4" ' + LINE); } // A ringed eyespot with a glint.
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
        p("M102 184 C44 174 38 212 60 222 C54 240 42 260 32 280 C30 288 40 288 44 282 C58 262 72 244 84 228 C92 222 98 212 100 200 Z", "#b6eaa0", 'stroke="#6fa85e" stroke-width="2" stroke-linejoin="round"') + // Lower wing running into its long tail.
        p("M44 282 Q36 290 28 284", "none", 'stroke="#a0466e" stroke-width="4" ' + LINE) + // A plum tip on the tail.
        p("M98 176 C14 180 18 84 66 100 C86 108 92 132 92 152 Q92 168 98 176Z", "#c8f2b0", 'stroke="#6fa85e" stroke-width="2" stroke-linejoin="round"') + // Upper wing.
        p("M32.5 133.5 C29 112 42 92 66 100 C86 108 92 132 92 152", "none", 'stroke="#a0466e" stroke-width="5" ' + LINE) + // The plum leading edge: the top half of the wing's own outline.
        p("M96 172 Q60 150 30 150 M96 172 Q64 130 44 110 M96 172 Q78 126 70 106 M100 196 Q74 208 60 222 M100 200 Q80 230 50 266", "none", 'stroke="#7fb86a" stroke-width="1.5" opacity=".9" ' + LINE) + // Fine veins.
        eye(56, 140, 10) + eye(70, 210, 6.5) +
        p(star(20, 104, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (m * .5) + 's"') + "</g>";
    }).join("") },
    // Wings of sharp ice crystals fanned from the shoulder, each faceted and pale blue, with snowflakes drifting round them.
    "acc-wing-frost-crystal": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      function shard(x, y, a, len, w) { // One long crystal pointing up from (x, y), then turned: a lit left face and a shaded right one.
        const k = r(-len * .4);
        return '<g transform="translate(' + x + " " + y + ") rotate(" + a + ')">' + p("M0 0 L" + -w + " " + k + " L0 " + -len + " L" + w + " " + k + "Z", "#e2f7ff", 'fill-opacity=".9" stroke="#5fa8d0" stroke-width="1.6" stroke-linejoin="round"') +
          p("M0 0 L" + w + " " + k + " L0 " + -len + "Z", "#a8dcf4", 'opacity=".8"') + "</g>";
      }
      function flake(x, y, s, delay) { // A six-armed snowflake with a dot in the middle.
        let d = "";
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, ex = r(x + s * Math.cos(a)), ey = r(y + s * Math.sin(a)); d += "M" + x + " " + y + " L" + ex + " " + ey + " "; }
        return '<g class="lp-twinkle" style="animation-delay:' + delay + 's">' + p(d, "none", 'stroke="#fff" stroke-width="1.8" ' + LINE) + c(x, y, r(s * .28), "#bfe8ff", "") + "</g>";
      }
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
          [[-124, 40], [-108, 50], [-93, 42]].map(function (s) { return shard(99, 192, s[0], s[1], 9); }).join("") + // The lower wing's crystals.
          [[-84, 62], [-71, 80], [-58, 90], [-45, 84], [-33, 70], [-21, 54]].map(function (s) { return shard(93, 174, s[0], s[1], 11); }).join("") + // The upper wing's crystals, longest in the middle.
          c(94, 177, 5.5, "#bfe8ff", 'stroke="#5fa8d0" stroke-width="1.5"') + // A frosty bead at the hinge.
          flake(22, 116, 8, m * .6) + flake(40, 74, 5.5, .9 + m * .4) + flake(44, 236, 6, .4 + m * .5) + "</g>";
      }).join("");
    })() },
    // The legendary pair: wings of living flame. Crimson plumes with orange and glowing gold hearts sweep up and out, flicking at the tips, embers drift off them and a fire-opal sits at the hinge.
    "acc-wing-phoenix": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; };
      function flame(x, y, a, len, w, fill) { // One flame-shaped plume pointing up from (x, y) with a curling flick at its tip, then turned into place.
        return p("M0 0 C" + -w + " " + r(-len * .25) + " " + r(-w * 1.1) + " " + r(-len * .6) + " " + r(-w * .25) + " " + r(-len * .82) + " Q" + r(w * .15) + " " + r(-len * .9) + " " + r(-w * .35) + " " + -len +
          " Q" + r(w * .9) + " " + r(-len * .86) + " " + r(w * .55) + " " + r(-len * .55) + " C" + r(w * .4) + " " + r(-len * .35) + " " + r(w * .7) + " " + r(-len * .15) + " 0 0Z", fill,
          'stroke="#9a1f3a" stroke-opacity=".45" stroke-width="1.4" stroke-linejoin="round" transform="translate(' + x + " " + y + ") rotate(" + a + ')"');
      }
      const upper = [[-86, 82], [-73, 94], [-59, 98], [-45, 92], [-32, 80], [-20, 62]], lower = [[-128, 48], [-112, 58], [-96, 48]]; // [angle, length] of each plume.
      return [0, 1].map(function (m) {
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
          lower.map(function (f) { return flame(99, 192, f[0], f[1], 13, "#e8405f") + flame(99, 192, f[0], r(f[1] * .7), 9, "#ff9d3d"); }).join("") + // Lower plumes: crimson with orange inside.
          upper.map(function (f) { return flame(93, 174, f[0], f[1], 15, "#e8405f"); }).join("") + // Upper plumes, crimson outer layer.
          upper.map(function (f) { return flame(93, 174, f[0], r(f[1] * .78), 11, "#ff9d3d"); }).join("") + // Orange middle layer.
          '<g class="lp-neon">' + upper.map(function (f) { return flame(93, 174, f[0], r(f[1] * .5), 7, "#ffdc83"); }).join("") + "</g>" + // Glowing gold hearts.
          [[44, 62, 2.6, .7, "#ff9d3d"], [12, 150, 2.4, 1.3, "#ffdc83"], [36, 248, 2.6, .4, "#ff9d3d"]].map(function (e) { return c(e[0], e[1], e[2], e[4], 'class="lp-twinkle" style="animation-delay:' + (e[3] + m * .5) + 's"'); }).join("") + // Drifting embers.
          p(star(18, 96, 6), "#ffdc83", 'class="lp-twinkle" style="animation-delay:' + (m * .5) + 's"') + p(star(58, 236, 4.5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (1 + m * .5) + 's"') + // Two bright sparks.
          c(95, 178, 6.5, "#ff5f3d", 'stroke="#ffdc83" stroke-width="2.5"') + c(93, 176, 2, "#fff8dc", "") + "</g>"; // The fire-opal at the hinge.
      }).join("");
    })() },

    // Star Capsule wardrobe back
    // Round two of the capsule back pieces. All drawn behind her, so whatever passes behind her body is simply hidden.
    // A butterfly net slung over her shoulder: the handle's end pokes out low on her right, the hoop and a floaty net bag up on her left, with a butterfly resting on the rim.
    "acc-butterfly-net": { layer: "back", svg: p("M244 262 L80 52", "none", 'stroke="#a8743e" stroke-width="6" ' + LINE) + // The wooden handle.
      p("M30 42 C22 72 30 98 46 100 C62 100 78 66 86 34", "#fff", 'fill-opacity=".35" stroke="#fff" stroke-width="2" stroke-linejoin="round"') + // The see-through net bag.
      p("M34 60 Q56 64 82 48 M38 80 Q54 82 72 68 M46 44 Q44 72 48 98 M62 40 Q64 66 58 94", "none", 'stroke="#fff" stroke-width="1.3" opacity=".75" ' + LINE) + // Mesh lines across it.
      o(58, 38, 30, 13, "none", 'stroke="#70ebea" stroke-width="5" transform="rotate(-20 58 38)"') + // The hoop.
      p("M50 22 C42 10 32 16 38 25 Z M50 22 C58 10 68 16 62 25 Z", "#ffdc83") + p("M50 22 C44 30 40 30 42 25 Z M50 22 C56 30 60 30 58 25 Z", "#ff9d6b") + p("M50 14 V27", "none", 'stroke="#462846" stroke-width="2.4" ' + LINE) }, // A butterfly sitting on the rim: wings, lower wings, body.
    // A little ukulele carried on her back: the round wooden body peeks out by her left hip, the neck and tuning pegs rise over her right shoulder.
    "acc-ukulele": { layer: "back", svg: p("M80 222 L240 56", "none", 'stroke="#6a4424" stroke-width="10" ' + LINE) + // The dark fretboard neck, running behind her.
      '<g transform="translate(240 56) rotate(-46)">' + p("M-2 -7 L22 -9 Q27 0 22 9 L-2 7 Z", "#a8743e") + [6, 15].map(function (x) { return c(x, -11, 3.2, "#fff1cd") + c(x, 11, 3.2, "#fff1cd"); }).join("") + "</g>" + // Headstock with four pegs.
      c(60, 244, 24, "#e0a060") + c(80, 222, 18, "#e0a060") + c(60, 244, 24, "#e0a060", "") + c(80, 222, 18, "#e0a060", "") + // Both bouts of the body (outlined, then refilled so they read as one shape).
      c(80, 222, 7, "#5a3a1e", "") + p("M48 244 L58 254", "none", 'stroke="#6a4424" stroke-width="5" ' + LINE) + // Sound hole and bridge.
      p("M52 247 L238 54 M55 250 L241 57", "none", 'stroke="#fff8ec" stroke-width="1" opacity=".85" ' + LINE) + // Strings.
      p("M50 246 C39 238 41 228 50 234 C59 228 61 238 50 246 Z", "#ff8ecb", 'stroke="#fff" stroke-width="1.5" stroke-linejoin="round"') }, // A heart sticker on the body.
    // A big brass wind-up key standing up out of her back, as if she's a clockwork toy, with little turning marks beside it.
    "acc-wind-up-key": { layer: "back", svg: '<g transform="rotate(-12 160 120)">' + // Tipped a touch to one side.
      p("M154 40 h12 v80 h-12 Z", "#d9a83a") + o(160, 64, 11, 4.5, "#b58a2e") + // The shaft and a collar.
      p("M156 38 C134 12 104 18 106 40 C108 60 136 60 156 44 Z", "#ffdc83") + p("M164 38 C186 12 216 18 214 40 C212 60 184 60 164 44 Z", "#ffdc83") + // The two loops of the key's bow.
      o(128, 38, 10, 7, "#d9a83a", "") + o(192, 38, 10, 7, "#d9a83a", "") + // Pressed hollows in each loop.
      c(160, 41, 8, "#ffdc83") + c(160, 41, 3, "#b58a2e", "") + // The hub and its rivet.
      p("M124 30 Q130 26 138 28", "none", 'stroke="#fff8dc" stroke-width="2.5" opacity=".9" ' + LINE) + "</g>" + // A shine on the brass.
      p("M92 26 Q84 40 92 54 M228 26 Q236 40 228 54", "none", 'stroke="#ffdc83" stroke-width="3" opacity=".85" class="lp-twinkle" ' + LINE) }, // Turning marks.
    // A wicker market basket on her back, peeking over her left shoulder with a baguette, two tulips and a leafy green poking out.
    "acc-market-basket": { layer: "back", svg: '<g transform="rotate(-10 70 130)">' + // The whole basket leans a little.
      o(66, 60, 9, 42, "#e0a35a", EDGE + ' transform="rotate(-12 66 60)"') + p("M58 40 l10 -4 M56 56 l11 -4 M56 72 l11 -4", "none", 'stroke="#a8743e" stroke-width="2.2" ' + LINE) + // The baguette and its score marks.
      p("M44 104 Q40 86 36 72 M52 104 Q54 84 50 66", "none", 'stroke="#4f9e63" stroke-width="3" ' + LINE) + p("M34 104 C26 92 30 84 38 88 C40 96 40 100 34 104 Z", "#8ddc8f") + // Tulip stems and a leaf.
      p("M29 72 L31 60 L36 66 L40 58 L44 70 Q38 80 29 72 Z", "#ff8ecb") + p("M44 66 L45 54 L50 60 L54 52 L58 64 Q52 74 44 66 Z", "#ffdc83") + // Two tulip heads.
      p("M36 104 L104 104 L98 160 L42 160 Z", "#d9a86a") + // The basket.
      p("M40 118 H101 M41 132 H100 M42 146 H99 M50 104 L52 160 M64 104 L64 160 M78 104 L77 160 M92 104 L89 160", "none", 'stroke="#a8743e" stroke-width="2" opacity=".75" ' + LINE) + // The weave.
      p("M32 98 h78 q3 0 3 3 v6 q0 3 -3 3 h-78 q-3 0 -3 -3 v-6 q0 -3 3 -3 Z", "#b8834a") + "</g>" }, // The rim.
    // A big pink scallop shell opened out behind her like a fan, ribbed in two pinks, with a pearl sitting at the top between her ears.
    "acc-scallop-shell": { layer: "back", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, cx = 160, cy = 232, rad = Math.PI / 180;
      function at(a, k) { return [r(cx + 128 * k * Math.cos(a * rad)), r(cy + 196 * k * Math.sin(a * rad))]; } // A point on the shell at angle a, k of the way out.
      let wedges = "", ribs = "";
      for (let i = 0; i < 10; i++) {
        const a = 212 + i * 11.6, b = a + 11.6, A = at(a, 1), B = at(b, 1), M = at((a + b) / 2, 1.07); // Each wedge's edge bows outwards into a scallop.
        wedges += p("M" + cx + " " + cy + " L" + A.join(" ") + " Q" + M.join(" ") + " " + B.join(" ") + "Z", i % 2 ? "#ffd9ec" : "#ff9fd0", "");
        if (i) ribs += "M" + at(a, .3).join(" ") + " L" + at(a, .97).join(" ") + " ";
      }
      return wedges + p(ribs, "none", 'stroke="#d0609e" stroke-width="2" opacity=".75" ' + LINE) + // The ribs between wedges.
        p("M" + at(212, 1).join(" ") + " L" + cx + " " + cy + " L" + at(328, 1).join(" "), "none", EDGE) + // The shell's two straight sides.
        c(160, 56, 11, "#fff8ec") + c(156, 52, 3.5, "#fff", "") + o(160, 68, 14, 3, "#e87fb4", 'opacity=".5"') + // The pearl, its glint and a little shadow.
        p(star(70, 92, 5), "#fff8dc", 'class="lp-twinkle"') + p(star(254, 96, 4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.8s"');
    })() },
    // A pink quiver slung across her back, its top peeking over her right shoulder with three heart-tipped arrows.
    "acc-cupid-quiver": { layer: "back", svg: '<g transform="translate(196 150) rotate(30)">' + // Drawn upright, then tipped across her back.
      [-7, 0, 7].map(function (x, i) {
        const top = [-160, -168, -158][i];
        return p("M" + x + " -120 L" + x + " " + (top + 6), "none", 'stroke="#d9b98a" stroke-width="3" ' + LINE) + // The arrow's shaft.
          p("M" + x + " " + (top + 8) + " C" + (x - 11) + " " + (top - 2) + " " + (x - 6) + " " + (top - 12) + " " + x + " " + (top - 5) + " C" + (x + 6) + " " + (top - 12) + " " + (x + 11) + " " + (top - 2) + " " + x + " " + (top + 8) + "Z", ["#ff5f8f", "#e8405f", "#ff8ecb"][i]); // Its heart tip.
      }).join("") +
      p("M-13 -124 h26 v244 q0 10 -13 10 q-13 0 -13 -10 Z", "#ff8ecb") + // The quiver.
      p("M-14 -124 h28 v8 h-28 Z M-13 106 h26 v6 h-26 Z", "#ffdc83") + // Gold bands at its mouth and foot.
      p("M0 -90 C-9 -97 -9 -106 0 -102 C9 -106 9 -97 0 -90 Z", "#fff8ec", "") + c(0, 90, 3, "#fff8ec", "") + "</g>" }, // A white heart near the top, a stud near the foot.
    // A carp windsock flying from a pole behind her: a red koi with gold scales streams over her head, mouth open to the wind, under a gold finial.
    "acc-koi-streamer": { layer: "back", svg: p("M244 250 V14", "none", 'stroke="#d9b24a" stroke-width="5" ' + LINE) + c(244, 9, 5.5, "#ffdc83") + // The pole and its finial.
      p("M238 20 C200 12 170 28 124 24 L98 10 Q108 32 98 54 L124 42 C170 46 200 58 238 50 Z", "#ff6b5b") + // The koi: body and forked tail fin.
      p("M232 46 C200 54 170 42 128 38 C170 38 200 44 232 40 Z", "#fff1cd", 'opacity=".9"') + // Its pale belly stripe.
      p("M200 26 a7 7 0 0 0 0 12 M186 24 a7 7 0 0 0 0 12 M172 26 a7 7 0 0 0 0 12 M158 25 a7 7 0 0 0 0 12 M144 25 a7 7 0 0 0 0 11", "none", 'stroke="#ffdc83" stroke-width="2.2" ' + LINE) + // Gold scales.
      p("M104 18 L120 32 M104 46 L120 36", "none", 'stroke="#c43b2e" stroke-width="1.8" opacity=".8" ' + LINE) + // Tail fin rays.
      p("M214 22 Q208 35 214 48", "none", 'stroke="#c43b2e" stroke-width="2" ' + LINE) + // The gill line.
      c(226, 30, 6, "#fff") + c(227, 30, 3, "#2a1a2a", "") + // The big round eye.
      o(239, 35, 4, 15, "#ffdc83") }, // The open mouth ring at the pole.
    // A huge glowing crescent moon cradling her from behind, curving up past both sides, with craters and two stars hung from its tips on threads.
    "acc-crescent-moon": { layer: "back", svg: p("M36 64 C14 220 104 296 160 296 C216 296 306 220 284 64 C264 190 214 252 160 252 C106 252 56 190 36 64 Z", "#ffe9ad", 'stroke="#d9b24a" stroke-width="3" stroke-linejoin="round" class="lp-neon"') + // The moon.
      [[40, 132, 7], [52, 176, 9], [32, 104, 4], [280, 132, 7], [266, 178, 8], [289, 104, 4], [92, 270, 6], [228, 270, 6]].map(function (k) { return c(k[0], k[1], k[2], "#f2d27a", ""); }).join("") + // Craters.
      p("M36 64 V88 M284 64 V80", "none", 'stroke="#fff1cd" stroke-width="1.5" ' + LINE) + // Threads from the tips.
      p(star(36, 98, 11), "#ffdc83", 'stroke="#b58a2e" stroke-width="1.2" stroke-linejoin="round" class="lp-twinkle"') + p(star(284, 88, 8), "#fff8dc", 'stroke="#b58a2e" stroke-width="1.2" stroke-linejoin="round" class="lp-twinkle" style="animation-delay:.7s"') + // The hanging stars.
      p(star(70, 40, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.3s"') + p(star(252, 30, 6), "#ffdc83", 'class="lp-twinkle" style="animation-delay:1.1s"') + p(star(300, 230, 4), "#fff8dc", 'class="lp-twinkle" style="animation-delay:1.5s"') }, // Loose twinkles.
    // A rainbow arching over her head from one fluffy cloud to another, with sparkles in the air.
    "acc-rainbow-arch": { layer: "back", svg: ["#ff6b6b", "#ff9d3d", "#ffdc83", "#8ddc8f", "#70c8f0", "#c9a8ff"].map(function (colour, i) {
      const rr = 136 - i * 8; // Each band 8 px inside the last.
      return p("M" + (160 - rr) + " 200 A" + rr + " " + rr + " 0 0 1 " + (160 + rr) + " 200", "none", 'stroke="' + colour + '" stroke-width="8.5" stroke-linecap="butt" fill="none"');
    }).join("") + p("M24 200 A136 136 0 0 1 296 200 M76 200 A84 84 0 0 1 244 200", "none", 'stroke="#462846" stroke-opacity=".35" stroke-width="1.5" fill="none"') + // Thin edges either side of the bands.
      [0, 1].map(function (m) {
        const puffs = [[30, 204, 13], [48, 196, 15], [66, 204, 12], [20, 214, 10], [42, 216, 13], [62, 216, 11]]; // A cloud at the rainbow's left foot, mirrored for the right.
        return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + puffs.map(function (b) { return c(b[0], b[1] + 2, b[2] + 1.5, "#b9c7e8", ""); }).join("") + puffs.map(function (b) { return c(b[0], b[1], b[2], "#fff", ""); }).join("") + "</g>";
      }).join("") +
      p(star(108, 46, 6), "#fff8dc", 'class="lp-twinkle"') + p(star(216, 40, 5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.6s"') + p(star(296, 150, 4.5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:1.2s"') }, // Sparkles.
    // The legendary piece: a peacock's train fanned right out behind her: thirteen long teal-green plumes, each ending in a glowing jewel eye, with smaller eyes nearer her sides and golden sparkles.
    "acc-peacock-train": { layer: "back", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, cx = 160, cy = 236, rad = Math.PI / 180;
      function at(a, k) { return [r(cx + 140 * k * Math.cos(a * rad)), r(cy + 190 * k * Math.sin(a * rad))]; } // A point at angle a, k of the way out to the eyes.
      function turn(a, k) { const q = at(a, k), dx = q[0] - cx, dy = q[1] - cy; return 'transform="rotate(' + r(Math.atan2(dy, dx) / rad) + " " + q.join(" ") + ')"'; } // Lines a shape up with its plume.
      function eye(a, k, s) { const q = at(a, k); return o(q[0], q[1], r(16 * s), r(13 * s), "#ffdc83", 'stroke="#b58a2e" stroke-width="1.5" ' + turn(a, k)) + o(r(q[0]), q[1], r(11 * s), r(9 * s), "#2fc2b0", turn(a, k) + ' stroke="none"') + o(q[0], q[1], r(6.5 * s), r(5.5 * s), "#2e4ab8", 'stroke="#1a1f5e" stroke-width="1.5" ' + turn(a, k)); } // Gold, teal, then royal blue.
      const outer = [192, 205, 218, 231, 244, 257, 270, 283, 296, 309, 322, 335, 348], inner = [198, 214, 230, 310, 326, 342]; // Plume angles.
      let shafts = "";
      outer.forEach(function (a) { shafts += "M" + cx + " " + cy + " L" + at(a, .94).join(" ") + " "; });
      return p(shafts, "none", 'stroke="#c9b25a" stroke-width="2" ' + LINE) + // The quills.
        outer.map(function (a) { const q = at(a, .76); return o(q[0], q[1], 40, 15, "#2f9e7a", 'fill-opacity=".85" stroke="#1f6e56" stroke-width="1.5" ' + turn(a, .76)); }).join("") + // The feathery green vanes.
        '<g class="lp-neon">' + outer.map(function (a) { return eye(a, 1, 1); }).join("") + "</g>" + // The big eyes, glowing.
        inner.map(function (a) { const q = at(a, .68); return o(q[0], q[1], 9, 7.5, "#ffdc83", turn(a, .68)) + o(q[0], q[1], 5, 4, "#2e4ab8", turn(a, .68) + ' stroke="none"'); }).join("") + // Smaller eyes nearer her sides.
        p(star(22, 120, 6), "#fff8dc", 'class="lp-twinkle"') + p(star(298, 118, 6), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.7s"') + p(star(160, 18, 5), "#ffdc83", 'class="lp-twinkle" style="animation-delay:1.3s"');
    })() },

    // Star Capsule wardrobe paws
    // Round two of capsule-only paw wear. Her paws are 24 x 13 ovals at (123, 259) and (197, 259); anything drawn in a
    // [0, 1] loop is drawn once for her left paw and then mirrored across the middle (x = 160) for her right one.
    // Strawberry slippers: plump red berries over each paw, dotted with golden seeds, with a pointy green leaf cap and a stalk.
    "acc-strawberry-slippers": { layer: "front", svg: [123, 197].map(function (x) {
      return o(x, 261, 26, 14.5, "#f0506e") + // The berry itself, a touch bigger than her paw.
        [[-16, 263], [-7, 268], [5, 268], [16, 263], [-10, 261], [10, 262], [0, 263]].map(function (s) { return o(x + s[0], s[1], 1.6, 2.4, "#ffe08a", ""); }).join("") + // Seeds dotted over the front.
        o(x - 15, 266, 5, 2.4, "#fff", 'opacity=".45" transform="rotate(-25 ' + (x - 15) + ' 266)"') + // A glossy shine low on the berry.
        p("M" + (x - 21) + " 253 L" + (x - 15) + " 243 L" + (x - 7) + " 250 L" + x + " 240 L" + (x + 7) + " 250 L" + (x + 15) + " 243 L" + (x + 21) + " 253 Q" + x + " 259 " + (x - 21) + " 253Z", "#6cc06a") + // The pointy leaf cap.
        p("M" + x + " 244 q1 -6 6 -9", "none", 'stroke="#4f8f3e" stroke-width="3" ' + LINE); // The little stalk on top.
    }).join("") },
    // Frilly-sock Mary Janes: white socks with a lacy ruffle, cornflower-blue patent shoes, a strap with a gold button and a shine on the toe.
    "acc-frilly-mary-janes": { layer: "front", svg: [123, 197].map(function (x) {
      return o(x, 258, 24.5, 13, "#fff8ec") + // The sock over her paw.
        p("M" + (x - 21) + " 251" + [-21, -14, -7, 0, 7, 14].map(function (d) { return " Q" + (x + d + 3.5) + " 241 " + (x + d + 7) + " 251"; }).join("") + " Q" + x + " 256 " + (x - 21) + " 251Z", "#fff8ec", 'stroke="#d8a8cc" stroke-width="1.5" stroke-linejoin="round"') + // The scalloped lace ruffle round the top of the sock: six bumps along the top, a soft curve underneath.
        [-10.5, 0, 10.5].map(function (d) { return c(x + d, 249, 1.7, "#ff8ecb", ""); }).join("") + // Pink dots in the lace.
        p("M" + (x - 26) + " 266 Q" + (x - 25) + " 259 " + (x - 14) + " 259 Q" + x + " 264 " + (x + 14) + " 259 Q" + (x + 25) + " 259 " + (x + 26) + " 266 Q" + (x + 26) + " 276 " + (x + 12) + " 276 H" + (x - 12) + " Q" + (x - 26) + " 276 " + (x - 26) + " 266Z", "#4a63c8") + // The shoe, dipping in the middle where the sock shows.
        p("M" + (x - 20) + " 261 Q" + x + " 247 " + (x + 20) + " 261", "none", 'stroke="#2f3f8f" stroke-width="4.5" ' + LINE) + // The strap across the top of her paw.
        c(x + 16, 256.5, 2.8, "#ffdc83") + // The strap's gold button.
        p("M" + (x - 17) + " 269 Q" + (x - 9) + " 273 " + (x - 1) + " 272", "none", 'stroke="#fff" stroke-width="2.5" opacity=".75" ' + LINE); // Patent shine on the toe.
    }).join("") },
    // Garden clogs: chunky sunny-orange clogs full of round air holes, the riveted strap flipped forward and a pink flower charm.
    "acc-garden-clogs": { layer: "front", svg: [123, 197].map(function (x) {
      return p("M" + (x - 26) + " 266 Q" + (x - 27) + " 247 " + (x - 10) + " 245 H" + (x + 10) + " Q" + (x + 27) + " 247 " + (x + 26) + " 266 Q" + (x + 25) + " 276 " + (x + 14) + " 276 H" + (x - 14) + " Q" + (x - 25) + " 276 " + (x - 26) + " 266Z", "#ffa94d") + // The clog's rounded body.
        p("M" + (x - 25) + " 270 H" + (x + 25), "none", 'stroke="#d9772a" stroke-width="3" ' + LINE) + // The sole line.
        [[-12, 252], [-4, 250], [4, 250], [12, 252], [-8, 258], [0, 257], [8, 258], [-16, 259]].map(function (h) { return c(x + h[0], h[1], 2.2, "#c9661c", ""); }).join("") + // Air holes over the toe.
        p("M" + (x - 24) + " 260 Q" + x + " 228 " + (x + 24) + " 260", "none", 'stroke="#a8481a" stroke-width="5.5" ' + LINE) + // The strap flipped forward over her paw.
        p("M" + (x - 19) + " 266 Q" + (x - 19) + " 254 " + (x - 12) + " 250", "none", 'stroke="#fff" stroke-width="2.4" opacity=".5" ' + LINE) + // A rubbery shine.
        c(x - 24, 260, 3.4, "#ffd08a") + c(x + 24, 260, 3.4, "#ffd08a") + // Its rivets at each side.
        [0, 72, 144, 216, 288].map(function (d) { const a = d * Math.PI / 180; return c(Math.round((x + 13 + 4 * Math.cos(a)) * 10) / 10, Math.round((263 + 4 * Math.sin(a)) * 10) / 10, 3, "#ff8ecb", ""); }).join("") + c(x + 13, 263, 2.2, "#ffdc83", ""); // The flower charm.
    }).join("") },
    // Chunky sneakers: cream high-tops with a pink tongue, white laces, a teal star on the side and a thick lilac sole.
    "acc-chunky-sneakers": { layer: "front", svg: [123, 197].map(function (x) {
      return p("M" + (x - 24) + " 268 Q" + (x - 26) + " 247 " + (x - 8) + " 245 H" + (x + 8) + " Q" + (x + 26) + " 247 " + (x + 24) + " 268Z", "#fff8ec") + // The upper.
        p("M" + (x - 7) + " 260 V245 Q" + x + " 236 " + (x + 7) + " 245 V260Z", "#ff8ecb") + // The tongue poking up.
        p("M" + (x - 9) + " 248 H" + (x + 9) + " M" + (x - 9) + " 253 H" + (x + 9) + " M" + (x - 9) + " 258 H" + (x + 9), "none", 'stroke="#fff" stroke-width="2.6" ' + LINE) + // Laces across it.
        p(star(x + 17, 259, 5.5), "#70ebea", "") + // The star on the side.
        p("M" + (x - 27) + " 267 H" + (x + 27) + " Q" + (x + 28) + " 277 " + (x + 20) + " 278 H" + (x - 20) + " Q" + (x - 28) + " 277 " + (x - 27) + " 267Z", "#c9a8ff") + // The thick sole.
        p("M" + (x - 25) + " 272.5 H" + (x + 25), "none", 'stroke="#ff8ecb" stroke-width="2.5" ' + LINE); // A pink stripe round the sole.
    }).join("") },
    // Fluffy snow boots: sky-blue boots with a fat cream fur cuff, two pom-pom ties, a snowflake on the front and a ridged sole.
    "acc-snow-boots": { layer: "front", svg: [123, 197].map(function (x) {
      return p("M" + (x - 23) + " 250 H" + (x + 23) + " L" + (x + 24) + " 264 Q" + (x + 26) + " 277 " + (x + 12) + " 277 H" + (x - 12) + " Q" + (x - 26) + " 277 " + (x - 24) + " 264Z", "#7fb8f0") + // The boot.
        p("M" + (x - 25) + " 272 Q" + x + " 280 " + (x + 25) + " 272", "none", 'stroke="#4a74b8" stroke-width="4" ' + LINE) + // The ridged sole.
        p("M" + x + " 255 V269 M" + (x - 6) + " 258.5 L" + (x + 6) + " 265.5 M" + (x + 6) + " 258.5 L" + (x - 6) + " 265.5", "none", 'stroke="#fff" stroke-width="2.2" ' + LINE) + c(x, 262, 2, "#fff", "") + // The snowflake.
        [-22, -15, -7.5, 0, 7.5, 15, 22].map(function (d, i) { return c(x + d, 247 + (i % 2) * 1.5, 6.5, "#fff8ec", 'stroke="#c8d4ec" stroke-width="1.5"'); }).join("") + // The fur cuff, bumpy like real fluff.
        p("M" + (x + 15) + " 252 Q" + (x + 19) + " 258 " + (x + 17) + " 262", "none", 'stroke="#4a74b8" stroke-width="2" ' + LINE) + c(x + 17, 265, 4.5, "#fff8ec", 'stroke="#c8d4ec" stroke-width="1.5"'); // One fluffy pom-pom tie hanging off the cuff.
    }).join("") },
    // Jingle bell anklets: a red velvet ribbon round each paw with three shiny gold bells hanging off it and a bow at the side.
    "acc-bell-anklets": { layer: "front", svg: [123, 197].map(function (x) {
      return p("M" + (x - 24) + " 251 Q" + x + " 261 " + (x + 24) + " 251", "none", 'stroke="#8f2a3a" stroke-width="8" ' + LINE) + p("M" + (x - 24) + " 251 Q" + x + " 261 " + (x + 24) + " 251", "none", 'stroke="#e8405f" stroke-width="5" ' + LINE) + // The ribbon, red on a darker edge.
        [[-13, 262, 5.5], [0, 265, 6.5], [13, 262, 5.5]].map(function (b) {
          return c(x + b[0], b[1], b[2], "#f5c042", 'stroke="#8a6a2a" stroke-width="1.6"') + p("M" + (x + b[0] - b[2] * .6) + " " + (b[1] + 1) + " H" + (x + b[0] + b[2] * .6), "none", 'stroke="#8a6a2a" stroke-width="1.6" ' + LINE) + c(x + b[0], b[1] + b[2] * .55, 1.3, "#8a6a2a", "") + c(x + b[0] - 1.8, b[1] - 2, 1.5, "#fff8dc", ""); // Bell, slit, clapper and shine.
        }).join("") + bow(x - 21, 251, 6.5, "#e8405f"); // The ribbon bow at the side.
    }).join("") },
    // Toadstool booties: a red spotted mushroom cap over each paw on a cream stalk boot, with gills underneath and a little leaf.
    "acc-toadstool-booties": { layer: "front", svg: [123, 197].map(function (x) {
      return o(x, 266, 24, 10, "#fff1cd") + // The cream stalk boot.
        p("M" + (x - 22) + " 260 Q" + x + " 266 " + (x + 22) + " 260", "none", 'stroke="#e0c49a" stroke-width="2" ' + LINE) + // The gills under the cap's edge.
        p("M" + (x - 29) + " 257 Q" + (x - 28) + " 233 " + x + " 232 Q" + (x + 28) + " 233 " + (x + 29) + " 257 Q" + x + " 263 " + (x - 29) + " 257Z", "#e8405f") + // The cap.
        [[-16, 246, 4], [0, 240, 4.5], [15, 247, 3.5], [-6, 252, 2.8], [8, 254, 2.4], [-21, 254, 2]].map(function (s) { return c(x + s[0], s[1], s[2], "#fff8ec", ""); }).join("") + // White spots.
        p("M" + (x + 21) + " 271 q7 -8 3 -15 q-7 6 -3 15Z", "#86d67e"); // A leaf sprouting at the heel.
    }).join("") },
    // Pearly seashell slippers: scalloped pink shells with fanned ribs and a mother-of-pearl shimmer, a pearl in the middle, a coral starfish clinging to the outer side and a twinkle.
    "acc-seashell-slippers": { layer: "front", svg: [0, 1].map(function (m) {
      const x = 123, r = function (n) { return Math.round(n * 10) / 10; };
      const rim = [195, 220, 245, 270, 295, 320, 345].map(function (d) { const a = d * Math.PI / 180; return [r(x + 30 * Math.cos(a)), r(279 + 35 * Math.sin(a))]; }); // Seven points round the shell's top edge.
      let shell = "M" + x + " 279 L" + rim[0][0] + " " + rim[0][1];
      for (let i = 1; i < rim.length; i++) { const mid = (195 + 25 * i - 12.5) * Math.PI / 180; shell += " Q" + r(x + 36 * Math.cos(mid)) + " " + r(279 + 41 * Math.sin(mid)) + " " + rim[i][0] + " " + rim[i][1]; } // One bump between each pair of points: the scalloped edge.
      const ribs = rim.slice(1, 6).map(function (q) { return "M" + x + " 276 L" + q[0] + " " + q[1]; }).join(" "); // Ridges fanning out from the hinge.
      let fish = "";
      for (let i = 0; i < 10; i++) { const a = (i * 36 - 90) * Math.PI / 180, len = i % 2 ? 3.4 : 8.5; fish += (i ? " L" : "M") + r(x - 27 + len * Math.cos(a)) + " " + r(271 + len * Math.sin(a)); } // A five-armed starfish.
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + p(shell + "Z", "#ffc6dc") +
        o(x - 6, 256, 15, 8, "#70ebea", 'opacity=".22"') + o(x + 8, 252, 12, 7, "#c9a8ff", 'opacity=".3"') + // Mother-of-pearl shimmer.
        p(ribs, "none", 'stroke="#e486ac" stroke-width="2" ' + LINE) +
        p("M" + (x - 9) + " 282 L" + (x + 9) + " 282 L" + (x + 5) + " 273 L" + (x - 5) + " 273Z", "#f5a8c4") + // The hinge at the bottom.
        c(x, 262, 5.5, "#fff8ec") + c(x - 1.8, 260.2, 1.8, "#fff", "") + // The pearl and its gleam.
        p(fish + "Z", "#ff9d6b") + c(x - 27, 271, 1.6, "#ffd8b0", "") + // The starfish and its middle.
        p(star(x + 15, 248, 4.5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (m * .6) + 's"') + "</g>";
    }).join("") },
    // Glass slippers: see-through faceted crystal slippers with her paw showing through, a crystal bow, glints on the facets and a soft glow underneath.
    "acc-glass-slippers": { layer: "front", svg: [0, 1].map(function (m) {
      const x = 123, tw = function (d) { return 'class="lp-twinkle" style="animation-delay:' + (d + m * .5) + 's"'; };
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" + o(x, 278, 25, 3.5, "#bfefff", 'opacity=".45"') + // Glow on the floor.
        p("M" + (x - 26) + " 265 Q" + (x - 26) + " 253 " + (x - 14) + " 253 Q" + x + " 259 " + (x + 14) + " 253 Q" + (x + 26) + " 253 " + (x + 26) + " 265 Q" + (x + 26) + " 277 " + (x + 12) + " 277 H" + (x - 12) + " Q" + (x - 26) + " 277 " + (x - 26) + " 265Z", "#bfefff", 'fill-opacity=".5" stroke="#7fd0ec" stroke-width="2" stroke-linejoin="round"') + // The slipper, see-through.
        p("M" + (x - 21) + " 264 L" + (x - 9) + " 271 L" + x + " 263 L" + (x + 9) + " 271 L" + (x + 21) + " 264 M" + (x - 9) + " 271 L" + (x - 12) + " 277 M" + (x + 9) + " 271 L" + (x + 12) + " 277", "none", 'stroke="#fff" stroke-width="1.4" opacity=".85" ' + LINE) + // Cut facets.
        p("M" + (x - 14) + " 253 Q" + x + " 259 " + (x + 14) + " 253", "none", 'stroke="#fff" stroke-width="2.5" ' + LINE) + // The bright rim of the opening.
        p("M" + (x - 22) + " 262 Q" + (x - 22) + " 257 " + (x - 17) + " 256", "none", 'stroke="#fff" stroke-width="2.5" opacity=".9" ' + LINE) + // A shine on the side.
        p("M" + x + " 258 L" + (x - 10) + " 252 L" + (x - 10) + " 264Z M" + x + " 258 L" + (x + 10) + " 252 L" + (x + 10) + " 264Z", "#e4f9ff", 'stroke="#5ab4d8" stroke-width="1.5" stroke-linejoin="round"') + c(x, 258, 2.8, "#c9f4ff", 'stroke="#5ab4d8" stroke-width="1.5"') + // The crystal bow.
        p(star(x - 16, 268, 4.5), "#fff", tw(0)) + p(star(x + 18, 249, 3.5), "#fff8dc", tw(.7)) + p(star(x + 6, 272, 2.5), "#fff", tw(1.3)) + "</g>"; // Glints.
    }).join("") },
    // The epic pair: crimson boots wrapped in a cuff of living flame (red, orange and gold tongues), a gold band with a ruby, a gold phoenix feather on the toe, flame wisps streaming from the heel, a glowing ember sole and sparks drifting up.
    "acc-phoenix-boots": { layer: "front", svg: [0, 1].map(function (m) {
      const x = 123, tw = function (d) { return 'class="lp-twinkle" style="animation-delay:' + (d + m * .45) + 's"'; };
      const flame = function (s, fill) { // One layer of the flame cuff, scaled around its base at (x, 250).
        const pts = [[-23, 0], [-28, -12], [-19, -24], [-18, -14], [-12, -12], [-14, -26], [-3, -34], [-3, -20], [3, -15], [4, -26], [14, -30], [10, -19], [15, -12], [20, -18], [25, -24], [28, -10], [23, 0]]; // Start, then control/end pairs for each tongue.
        let d = "";
        pts.forEach(function (q, i) { d += (i === 0 ? "M" : i % 2 ? " Q" : " ") + Math.round((x + q[0] * s) * 10) / 10 + " " + Math.round((250 + q[1] * s) * 10) / 10; });
        return p(d + "Z", fill, 'stroke="#8a1a2a" stroke-opacity=".35" stroke-width="1.5" stroke-linejoin="round"');
      };
      return "<g" + (m ? ' transform="matrix(-1 0 0 1 320 0)"' : "") + ">" +
        p("M" + (x - 24) + " 268 Q" + (x - 40) + " 268 " + (x - 48) + " 252 Q" + (x - 38) + " 258 " + (x - 32) + " 256 Q" + (x - 41) + " 246 " + (x - 38) + " 234 Q" + (x - 28) + " 250 " + (x - 24) + " 256Z", "#ff6a3a") + // Flame wisps streaming from the heel.
        p("M" + (x - 24) + " 265 Q" + (x - 34) + " 264 " + (x - 40) + " 256 Q" + (x - 32) + " 258 " + (x - 24) + " 259Z", "#ffd04a", "") + // Their hot yellow middle.
        flame(1, "#e8405f") + flame(.75, "#ff8a3a") + flame(.48, "#ffdc6a") + // The flame cuff: red, orange, gold.
        p("M" + (x - 24) + " 250 H" + (x + 24) + " L" + (x + 25) + " 264 Q" + (x + 27) + " 277 " + (x + 12) + " 277 H" + (x - 12) + " Q" + (x - 27) + " 277 " + (x - 25) + " 264Z", "#a8243c") + // The crimson boot.
        p("M" + (x - 25) + " 250 H" + (x + 25), "none", 'stroke="#b58a2e" stroke-width="8" ' + LINE) + p("M" + (x - 25) + " 250 H" + (x + 25), "none", 'stroke="#ffdc83" stroke-width="5" ' + LINE) + c(x, 250, 3.6, "#ff4a6a") + // The gold band and its ruby.
        p("M" + x + " 273 C" + (x - 10) + " 267 " + (x - 8) + " 258 " + x + " 254 C" + (x + 8) + " 258 " + (x + 10) + " 267 " + x + " 273Z", "#ffdc83", 'stroke="#b58a2e" stroke-width="1.5" stroke-linejoin="round"') + // The phoenix feather on the toe.
        p("M" + x + " 271 V257 M" + x + " 266 L" + (x - 5) + " 262 M" + x + " 266 L" + (x + 5) + " 262 M" + x + " 261 L" + (x - 4) + " 258 M" + x + " 261 L" + (x + 4) + " 258", "none", 'stroke="#b5462e" stroke-width="1.3" ' + LINE) + // Its quill and vanes.
        p("M" + (x - 25) + " 274 Q" + x + " 282 " + (x + 25) + " 274", "none", 'stroke="#ffb84a" stroke-width="3.5" class="lp-neon" ' + LINE) + // The glowing ember sole.
        [[-15, 212, 2.4], [-3, 204, 1.8], [11, 208, 2.6], [21, 218, 1.8], [3, 194, 1.5]].map(function (s, i) { return c(x + s[0], s[1], s[2], i % 2 ? "#ffdc83" : "#ff9d3a", tw(i * .35)); }).join("") + // Sparks drifting up.
        p(star(x - 30, 228, 4), "#fff1cd", tw(.9)) + "</g>";
    }).join("") },

    // Star Capsule wardrobe tail
    // Round two of capsule-only tail wear. Her visible tail runs "M237 233.7 C280.1 239.2 282.4 188.6 256 193 C238 196 260 215 239 218":
    // out from her side, up round the curl (outermost near x 275), over the top at (256, 193) and in to its tip at (239, 218).
    // The pieces that follow the curl share a little helper, at(t): t = 0 where it leaves her side, 1 at the top, 2 at the tip.
    // Two sticking plasters crossed over the outside of her curl, each with a soft pad and air holes, a pink heart on top and a "get well" sparkle.
    "acc-tail-heart-plasters": { layer: "front", svg: [-32, 32].map(function (deg) {
      const turn = ' transform="rotate(' + deg + ' 274 215)"'; // Both plasters are drawn level, then tipped into an X round the middle of the cross.
      return p("M258 209.5 H290 A5.5 5.5 0 0 1 290 220.5 H258 A5.5 5.5 0 0 1 258 209.5Z", "#f3c99a", EDGE + turn) + // The plaster strip.
        p("M268.5 211 H279.5 V219 H268.5Z", "#fff1dc", 'stroke="#d9a878" stroke-width="1"' + turn) + // The soft pad in the middle.
        p("M259 213 h.1 M259 217 h.1 M263 215 h.1 M285 215 h.1 M289 213 h.1 M289 217 h.1", "none", 'stroke="#c48a5a" stroke-width="1.8" stroke-linecap="round"' + turn); // Air holes at the ends.
    }).join("") +
      p("M274 222 C266 216 266 208 274 211 C282 208 282 216 274 222Z", "#ff5c8a", 'stroke="#c0306a" stroke-width="1.5" stroke-linejoin="round"') + c(271, 212.5, 1.4, "#fff", 'opacity=".8"') + // The heart over the cross, with a shine.
      p(star(296, 200, 4), "#fff8dc", 'class="lp-twinkle"') + p(star(290, 234, 3), "#ffdc83", 'class="lp-twinkle" style="animation-delay:.8s"') },
    // A daisy chain threaded along her whole tail: a green stem, seven white daisies with sunny middles and two leaves.
    "acc-tail-daisy-chain": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, SEG = [[[237, 233.7], [280.1, 239.2], [282.4, 188.6], [256, 193]], [[256, 193], [238, 196], [260, 215], [239, 218]]];
      function at(t) { // A point on her tail and which way it's heading there.
        const s = SEG[t < 1 ? 0 : 1], k = t < 1 ? t : t - 1, u = 1 - k;
        const q = [0, 1].map(function (i) { return u * u * u * s[0][i] + 3 * u * u * k * s[1][i] + 3 * u * k * k * s[2][i] + k * k * k * s[3][i]; });
        const d = [0, 1].map(function (i) { return 3 * u * u * (s[1][i] - s[0][i]) + 6 * u * k * (s[2][i] - s[1][i]) + 3 * k * k * (s[3][i] - s[2][i]); }), l = Math.hypot(d[0], d[1]) || 1;
        return { x: q[0], y: q[1], tx: d[0] / l, ty: d[1] / l };
      }
      let out = p("M237 233.7 C280.1 239.2 282.4 188.6 256 193 C238 196 260 215 239 218", "none", 'stroke="#5f9e4f" stroke-width="3" ' + LINE); // The stem everything is threaded on.
      [.17, .7].forEach(function (t) { const a = at(t), deg = r(Math.atan2(a.ty, a.tx) * 180 / Math.PI); out += o(r(a.x + a.ty * 6), r(a.y - a.tx * 6), 6, 2.6, "#7fc96a", 'stroke="#4f8f3e" stroke-width="1" transform="rotate(' + deg + " " + r(a.x + a.ty * 6) + " " + r(a.y - a.tx * 6) + ')"'); }); // Two leaves on the outer side.
      [.04, .32, .58, .84, 1.14, 1.48, 1.9].forEach(function (t, i) { // Seven daisies.
        const a = at(t);
        for (let k = 0; k < 6; k++) { const ang = (k * 60 + i * 20) * Math.PI / 180; out += c(r(a.x + 4.6 * Math.cos(ang)), r(a.y + 4.6 * Math.sin(ang)), 3.1, "#fff", 'stroke="#c9b8a8" stroke-width="1"'); } // Petals.
        out += c(r(a.x), r(a.y), 2.8, "#ffd04a", 'stroke="#d99a2a" stroke-width="1"'); // The sunny middle.
      });
      return out;
    })() },
    // A puffy mint scrunchie with white polka dots, gathered round her tail just below the top of the curl.
    "acc-tail-scrunchie": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, puffs = [];
      for (let j = 0; j < 12; j++) { const a = (j * 30 + 15) * Math.PI / 180; puffs.push([r(274 + 17 * Math.cos(a)), r(213 + 7.5 * Math.sin(a)), Math.sin(a)]); } // Twelve puffs round a ring that wraps her tail.
      puffs.sort(function (m, n) { return m[2] - n[2]; }); // Back puffs first so the front ones sit on top.
      return puffs.map(function (q) { return c(q[0], q[1], 7.6, q[2] > 0 ? "#8fe3d0" : "#5fb8a6", 'stroke="#2f8a7a" stroke-width="1.6"'); }).join("") +
        puffs.filter(function (q) { return q[2] > 0; }).map(function (q, i) { return c(r(q[0] + (i % 2 ? 2 : -2)), r(q[1] + 1), 1.8, "#fff", ""); }).join(""); // Polka dots on the front puffs.
    })() },
    // A red ribbon band round the base of her tail with a bow, and a big gold jingle bell hanging underneath.
    "acc-tail-jingle-bell": { layer: "front", svg: p("M243 224 L245.5 243", "none", 'stroke="#8f2a3a" stroke-width="9" ' + LINE) + p("M243 224 L245.5 243", "none", 'stroke="#e8405f" stroke-width="6" ' + LINE) + // The ribbon band.
      p("M245.5 243 L247 250", "none", 'stroke="#e8405f" stroke-width="2.5" ' + LINE) + c(247.2, 250.5, 2.6, "#d9a83a") + // The loop the bell hangs from.
      c(248, 259, 9, "#f5c042", 'stroke="#8a6a2a" stroke-width="2"') + p("M241.5 259.5 H254.5", "none", 'stroke="#8a6a2a" stroke-width="2" ' + LINE) + c(248, 263.5, 2, "#8a6a2a", "") + // The bell, its slit and clapper.
      p("M242.5 255 Q244 251 248 250.5", "none", 'stroke="#fff8dc" stroke-width="2.2" ' + LINE) + bow(244, 232, 8, "#e8405f") + // A shine, and the bow on the band.
      p(star(262, 254, 3.5), "#fff8dc", 'class="lp-twinkle"') },
    // A blue butterfly perched on top of her curl, wings open, with a dotted line showing the loop it flew in on.
    "acc-butterfly-friend": { layer: "front", svg: p("M258 172 C266 150 290 164 292 142 C294 126 306 122 312 128", "none", 'stroke="#fff" stroke-width="1.8" stroke-dasharray="1 5" opacity=".75" ' + LINE) + // Its flight path.
      o(248, 171, 12, 8.5, "#5ab4ff", EDGE + ' transform="rotate(-35 248 171)"') + o(268, 171, 12, 8.5, "#5ab4ff", EDGE + ' transform="rotate(35 268 171)"') + // Top wings.
      o(250, 184, 7, 5.5, "#c9a8ff", EDGE + ' transform="rotate(30 250 184)"') + o(266, 184, 7, 5.5, "#c9a8ff", EDGE + ' transform="rotate(-30 266 184)"') + // Bottom wings.
      [[243, 167, 2.4], [250, 173, 1.6], [273, 167, 2.4], [266, 173, 1.6], [249, 185, 1.6], [267, 185, 1.6]].map(function (s) { return c(s[0], s[1], s[2], "#fff", ""); }).join("") + // White spots on the wings.
      o(258, 177, 2.6, 9, "#462846", "") + p("M257 169 Q253 160 248 159 M259 169 Q263 160 268 159", "none", 'stroke="#462846" stroke-width="1.6" ' + LINE) + c(248, 159, 1.8, "#462846", "") + c(268, 159, 1.8, "#462846", "") + // Body and curly antennae.
      p(star(282, 178, 3.5), "#fff8dc", 'class="lp-twinkle"') },
    // A string of fairy lights spiralling round her tail: a dark green wire looping round it and seven little bulbs glowing in turns along the front.
    "acc-tail-fairy-lights": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, SEG = [[[237, 233.7], [280.1, 239.2], [282.4, 188.6], [256, 193]], [[256, 193], [238, 196], [260, 215], [239, 218]]];
      function at(t) { // A point on her tail and which way it's heading there.
        const s = SEG[t < 1 ? 0 : 1], k = t < 1 ? t : t - 1, u = 1 - k;
        const q = [0, 1].map(function (i) { return u * u * u * s[0][i] + 3 * u * u * k * s[1][i] + 3 * u * k * k * s[2][i] + k * k * k * s[3][i]; });
        const d = [0, 1].map(function (i) { return 3 * u * u * (s[1][i] - s[0][i]) + 6 * u * k * (s[2][i] - s[1][i]) + 3 * k * k * (s[3][i] - s[2][i]); }), l = Math.hypot(d[0], d[1]) || 1;
        return { x: q[0], y: q[1], tx: d[0] / l, ty: d[1] / l };
      }
      const STEP = .11, off = function (t) { return 7.5 * Math.cos(Math.PI * (t - .1) / STEP); }; // How far the wire sits from the middle of her tail: it swings from edge to edge every STEP.
      let front = "", back = "", last = null;
      for (let i = 0; i <= 96; i++) { // The wire wraps round and round: runs going one way are in front of her tail, runs going the other way are behind it.
        const t = .02 + i * 1.47 / 96, a = at(t), s = off(t), pt = r(a.x - a.ty * s) + " " + r(a.y + a.tx * s);
        if (last) { if (Math.sin(Math.PI * (t - .1) / STEP) > 0) front += "M" + last + " L" + pt + " "; else back += "M" + last + " L" + pt + " "; }
        last = pt;
      }
      const COLOURS = ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff"];
      let bulbs = "";
      for (let j = 0; j < 7; j++) { // A bulb halfway along every front run, right in the middle of her tail.
        const t = .1 + STEP * (.5 + 2 * j), a = at(t), bx = r(a.x), by = r(a.y), colour = COLOURS[j % 4];
        bulbs += c(bx, by, 7, colour, 'opacity=".35" class="lp-twinkle" style="animation-delay:' + r(j * .3) + 's"') + // Its glow.
          c(bx, by, 4, colour, 'stroke="#fff" stroke-width="1.2"') + c(r(bx - 1.2), r(by - 1.2), 1.2, "#fff", ""); // The bulb and its glint.
      }
      return p(back, "none", 'stroke="#1f3a28" stroke-width="1.6" opacity=".4" ' + LINE) + p(front, "none", 'stroke="#2f5a3a" stroke-width="2.4" ' + LINE) + bulbs; // Behind-runs faint, front-runs solid, bulbs on top.
    })() },
    // A rainbow pinwheel on a gold stick tied to her curl with a bow: four curled paper blades round a pearly pin, and a couple of breeze lines.
    "acc-tail-pinwheel": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, X = 294, Y = 154, R = 21;
      const P = function (deg, len) { const a = deg * Math.PI / 180; return r(X + len * Math.cos(a)) + " " + r(Y + len * Math.sin(a)); }; // A point round the pin.
      return p("M271 212 L" + X + " " + Y, "none", 'stroke="#b58a2e" stroke-width="5" ' + LINE) + p("M271 212 L" + X + " " + Y, "none", 'stroke="#ffdc83" stroke-width="3" ' + LINE) + // The stick.
        ["#ff8ecb", "#ffdc83", "#70ebea", "#c9a8ff"].map(function (colour, k) { const a = -20 + k * 90; return p("M" + X + " " + Y + " L" + P(a, R) + " Q" + P(a + 55, R * .95) + " " + P(a + 88, R * .3) + "Z", colour); }).join("") + // The four blades, each curling back to the middle.
        c(X, Y, 3.4, "#fff8dc") + bow(271, 212, 7, "#ff8ecb") + // The pin, and the bow tying it on.
        p("M268 140 Q276 132 282 134 M310 170 Q316 164 316 156", "none", 'stroke="#fff" stroke-width="2" opacity=".6" ' + LINE); // Breeze lines.
    })() },
    // A mermaid's tail: shimmering aqua scales over her whole tail with a lilac sheen, a lacy lilac fin at the tip, a pearl and a few rising bubbles.
    "acc-mermaid-tail": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, SEG = [[[237, 233.7], [280.1, 239.2], [282.4, 188.6], [256, 193]], [[256, 193], [238, 196], [260, 215], [239, 218]]];
      function at(t) { // A point on her tail and which way it's heading there.
        const s = SEG[t < 1 ? 0 : 1], k = t < 1 ? t : t - 1, u = 1 - k;
        const q = [0, 1].map(function (i) { return u * u * u * s[0][i] + 3 * u * u * k * s[1][i] + 3 * u * k * k * s[2][i] + k * k * k * s[3][i]; });
        const d = [0, 1].map(function (i) { return 3 * u * u * (s[1][i] - s[0][i]) + 6 * u * k * (s[2][i] - s[1][i]) + 3 * k * k * (s[3][i] - s[2][i]); }), l = Math.hypot(d[0], d[1]) || 1;
        return { x: q[0], y: q[1], tx: d[0] / l, ty: d[1] / l };
      }
      const LOOP = "M237 233.7 C280.1 239.2 282.4 188.6 256 193 C238 196 260 215 239 218";
      let scales = "";
      for (let i = 0; i <= 14; i++) { // Rows of little scallops along her tail, three across, opening towards the tip.
        const t = i * 1.85 / 14, a = at(t);
        [-5, 0, 5].forEach(function (side, j) {
          const sx = a.x - a.ty * side + a.tx * (j === 1 ? 2.5 : 0), sy = a.y + a.tx * side + a.ty * (j === 1 ? 2.5 : 0); // The middle row is staggered half a scale.
          scales += "M" + r(sx - a.ty * 2.6) + " " + r(sy + a.tx * 2.6) + " Q" + r(sx + a.tx * 4.5) + " " + r(sy + a.ty * 4.5) + " " + r(sx + a.ty * 2.6) + " " + r(sy - a.tx * 2.6) + " ";
        });
      }
      return p(LOOP, "none", 'stroke="#1f7f8a" stroke-width="20" ' + LINE) + p(LOOP, "none", 'stroke="#46c9c4" stroke-width="16" ' + LINE) + // Deep teal edge, aqua tail.
        p(LOOP, "none", 'stroke="#c9a8ff" stroke-width="6" opacity=".45" ' + LINE) + p(scales, "none", 'stroke="#d8fff8" stroke-width="1.3" opacity=".85" ' + LINE) + // A lilac sheen down the middle, and the scales.
        p("M243 218 C236 207 226 199 211 197 C217 205 220 212 226 218 C220 224 216 231 209 239 C224 237 236 229 243 218Z", "#b89cff", 'stroke="#7a5ac8" stroke-width="1.8" stroke-linejoin="round"') + // The fin.
        p("M240 218 L215 200 M240 218 L222 210 M240 218 L222 226 M240 218 L213 236", "none", 'stroke="#e6dcff" stroke-width="1.4" opacity=".9" ' + LINE) + // Its lacy ribs.
        c(279, 200, 3.8, "#fff8ec", 'stroke="#c9a8ff" stroke-width="1.2"') + c(278, 199, 1.2, "#fff", "") + // A pearl set in the scales.
        c(300, 206, 4, "none", 'stroke="#bfefff" stroke-width="1.6"') + c(306, 192, 2.8, "none", 'stroke="#bfefff" stroke-width="1.4"') + c(300, 180, 2, "none", 'stroke="#bfefff" stroke-width="1.2"') + // Bubbles rising.
        p(star(292, 230, 4), "#fff8dc", 'class="lp-twinkle"');
    })() },
    // A fan of five peacock feathers rising from a gold clasp on her curl, each with wispy green fronds and a gold, teal and deep blue eye.
    "acc-peacock-plume": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, BX = 278, BY = 208;
      return [[-105, 54], [-82, 58], [-60, 54], [-38, 42], [-16, 31]].map(function (f, i) { // [direction in degrees, length] for each feather.
        const a = f[0] * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), turn = f[0] + 90, k = f[1] / 58; // k shrinks the shorter feathers' eyes.
        const mx = r(BX + ux * f[1] * .55), my = r(BY + uy * f[1] * .55), ex = r(BX + ux * f[1] * .86), ey = r(BY + uy * f[1] * .86);
        const spin = function (x, y) { return ' transform="rotate(' + turn + " " + x + " " + y + ')"'; };
        return o(mx, my, r(4.5 * k + 1.5), r(f[1] * .4), "#3fae8a", 'opacity=".55"' + spin(mx, my)) + // Wispy fronds.
          p("M" + BX + " " + BY + " L" + r(BX + ux * f[1]) + " " + r(BY + uy * f[1]), "none", 'stroke="#e6e0b0" stroke-width="1.6" ' + LINE) + // The quill.
          o(ex, ey, r(7.5 * k), r(9.5 * k), "#9ad04a", 'stroke="#4a7a2a" stroke-width="1.2"' + spin(ex, ey)) + o(ex, ey, r(5.3 * k), r(6.8 * k), "#2fb6a8", "" + spin(ex, ey)) + // The eye: gold-green ring, teal ...
          o(r(ex - ux * k), r(ey - uy * k), r(3 * k), r(4 * k), "#1f3f9f", "" + spin(ex, ey)) + (i % 2 ? "" : c(r(ex + ux * 2 * k), r(ey + uy * 2 * k), 1.2, "#fff", 'opacity=".8"')); // ... and a deep blue heart, with a glint on every other one.
      }).join("") + c(BX, BY, 6.5, "#ffdc83") + c(BX, BY, 3.2, "#2a7fd8", 'stroke="#fff" stroke-width="1"') + // The gold clasp and its sapphire.
        p(star(302, 140, 4), "#fff8dc", 'class="lp-twinkle"') + p(star(250, 150, 3), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.8s"');
    })() },
    // The legendary piece: five bushy fox-spirit tails fanning out behind her own, ghostly cream with glowing sky-blue and lilac tips, three foxfire
    // wisps floating round her, and a red bow at the root with a gold bell and a zigzag paper streamer. Her own tail is drawn again on top so it stays in front.
    "acc-kitsune-tails": { layer: "front", svg: (function () {
      const r = function (n) { return Math.round(n * 10) / 10; }, RX = 244, RY = 226; // Where the spirit tails grow from.
      function tail(tx, ty, bend, s, from) { // A bushy tail from the root out to (tx, ty): thin at the root, fattest past halfway, pointed at the tip, bowed sideways by bend.
        const dx = tx - RX, dy = ty - RY, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, left = [], right = [];
        for (let i = 0; i <= 16; i++) { // `from` > 0 draws only the outer part of the same outline: the glowing tip.
          const a = from + (1 - from) * i / 16, w = s * 16 * Math.pow(Math.sin(Math.PI * Math.pow(a, 1.5)), .6) + 3 * (1 - a), mid = bend * Math.sin(Math.PI * a); // How wide the tail is here (plump, with a rounded tip), and how far it bows.
          const cx = RX + ux * L * a - uy * mid, cy = RY + uy * L * a + ux * mid;
          left.push(r(cx - uy * w) + " " + r(cy + ux * w)); right.unshift(r(cx + uy * w) + " " + r(cy - ux * w));
        }
        return "M" + left.concat(right).join(" L") + "Z";
      }
      const TAILS = [[312, 264, -16, .75], [316, 216, -16, .85], [306, 168, -16, .9], [280, 132, -16, .85], [250, 122, -12, .75]]; // [tip x, tip y, bend, width] for each spirit tail.
      const wisp = function (x, y, d) { return p("M" + (x + 5) + " " + (y - 16) + " Q" + (x - 1) + " " + (y - 8) + " " + (x + 6) + " " + y + " Q" + (x + 8) + " " + (y + 7) + " " + x + " " + (y + 7) + " Q" + (x - 7) + " " + (y + 7) + " " + (x - 6) + " " + y + " Q" + (x - 5) + " " + (y - 9) + " " + (x + 5) + " " + (y - 16) + "Z", "#8fd8ff", 'opacity=".9" class="lp-neon lp-twinkle" style="animation-delay:' + d + 's"') + c(x, y + 1.5, 2.6, "#fff", ""); }; // A foxfire flame, its tip flicking to one side, with a white-hot core.
      return TAILS.map(function (t) { return p(tail(t[0], t[1], t[2], t[3], 0), "#fff8ec", 'fill-opacity=".8" stroke="#c9a8ff" stroke-width="2" stroke-linejoin="round" class="lp-neon"'); }).join("") + // The spirit tails.
        TAILS.map(function (t, i) { return p(tail(t[0], t[1], t[2], t[3], .66),i % 2 ? "#c9a8ff" : "#8fd8ff", 'opacity=".9" class="lp-twinkle" style="animation-delay:' + r(i * .45) + 's"'); }).join("") + // Their glowing tips.
        p("M237 233.7 C280.1 239.2 282.4 188.6 256 193 C238 196 260 215 239 218", "none", 'class="lp-tail"') + // Her own tail again, in front of the spirits.
        wisp(304, 116, 0) + wisp(308, 286, .7) + wisp(262, 284, 1.3) + // Three foxfire wisps.
        p("M250 236 l6 3 l-4 4 l6 3 l-4 4", "none", 'stroke="#fff8ec" stroke-width="3" stroke-linejoin="round" fill="none"') + // A zigzag paper streamer.
        bow(243, 232, 9, "#e8405f") + c(243, 245, 5.5, "#f5c042", 'stroke="#8a6a2a" stroke-width="1.5"') + p("M239.5 246 H246.5", "none", 'stroke="#8a6a2a" stroke-width="1.4" ' + LINE) + // The red bow and its gold bell.
        p(star(296, 142, 4), "#fff8dc", 'class="lp-twinkle"') + p(star(230, 112, 3.5), "#fff8dc", 'class="lp-twinkle" style="animation-delay:.9s"');
    })() },

    // ---- Lumi-Soft prizes: won by playing Lumi-Soft (the "prize": "lumi-soft" entries in the catalog), never sold or rolled.
    // Pastel safety goggles pushed up on her head: a lilac strap with stitching round her head, pink rims and two mint lenses with a gold sparkle in each.
    "acc-soft-goggles": { layer: "front", svg: p("M92 116 Q160 78 228 116", "none", 'stroke="#462846" stroke-opacity=".5" stroke-width="10" ' + LINE) + p("M92 116 Q160 78 228 116", "none", 'stroke="#c9a8ff" stroke-width="7" ' + LINE) + // The strap.
      p("M100 110 Q160 80 220 110", "none", 'stroke="#fff8ec" stroke-width="1.4" stroke-dasharray="3 3" opacity=".8" ' + LINE) + // Its stitching.
      p("M151 86 Q160 80 169 86", "none", 'stroke="#462846" stroke-opacity=".5" stroke-width="8" ' + LINE) + p("M151 86 Q160 80 169 86", "none", 'stroke="#ff8ecb" stroke-width="5" ' + LINE) + // The bridge.
      [137, 183].map(function (x, i) { // Each eyepiece: a chunky pink rim, a mint lens, a gold sparkle and a shine.
        return c(x, 86, 16, "#ff8ecb") + c(x, 86, 11.5, "#bff6f4", 'stroke="#f2b8dc" stroke-width="1.5"') + p(star(x, 86, 8), "#ffdc83", "") + c(x, 86, 1.6, "#fff", "") +
          p("M" + (x - 7) + " 80 Q" + (x - 4) + " 76 " + x + " 75.5", "none", 'stroke="#fff" stroke-width="2.4" opacity=".75" ' + LINE) +
          c(x + (i ? 15 : -15), 92, 3, "#ffdc83") + p(star(x + (i ? 10 : -10), 72, 3), "#fff8dc", 'class="lp-twinkle" style="animation-delay:' + (i * .6) + 's"'); // A gold clip where it meets the strap, and a twinkle.
      }).join("") +
      p("M201 108 c-4 -3 -3.4 -6.6 -1.2 -6.6 q1.2 0 1.2 1.4 q0 -1.4 1.2 -1.4 c2.2 0 2.8 3.6 -1.2 6.6 Z", "#ff8ecb", "") }, // A heart sticker on the strap.
  };

  function render(outfit, layer) { // The markup for everything she wears on one layer. `outfit` is {slot: accessory id}.
    return Object.keys(outfit).map(function (slot) {
      const id = outfit[slot], art = Object.prototype.hasOwnProperty.call(ART, id) ? ART[id] : null;
      return art && art.layer === layer ? '<g data-acc="' + slot + '">' + art.svg + "</g>" : ""; // One this file doesn't know simply isn't drawn.
    }).join("");
  }

  return { ART: ART, render: render };
});
