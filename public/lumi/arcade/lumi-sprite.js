/* Lumi for the arcade games' canvases: the same Lumi as Lumi Pet (her shapes from templates/games/lumi-pet.html, her
   glow colours from lumi-pet/game.css, what she wears from lumi-pet/closet.js), so each player sees their own Lumi
   leading Lumi Conga, curled up as Yarn Pop's ball, carrying Prism Drop's ball and climbing Teacup Tower.

   A look is { glow, outfit } (mnemerynne/arcade.py lumi_look; GET {LUMI_API}lumi-look for this player, and each
   showdown seat carries its racer's). draw() puts her on a canvas from a cached image of her SVG; until that image
   has loaded (a moment, once per look) a plain drawing of her stands in. ball() draws her curled up into a ball.
   Everything drawn here is authored here or in closet.js: nothing a person typed goes into the SVG. */
(function (root, make) {
  const sprite = make(root.LumiPetCloset);
  if (typeof module === "object" && module.exports) module.exports = sprite; else root.LumiSprite = sprite;
})(typeof self !== "undefined" ? self : this, function (closet) {
  "use strict";

  // Her six glows (lumi-pet/game.css .lp-room[data-palette]): the wing glow, her body and her outline.
  const PALETTES = {
    rose: { glow: "#ff8ecb", body: "#fce1f2", shadow: "#b8569f" },
    lagoon: { glow: "#70ebea", body: "#d2fcf6", shadow: "#328b9d" },
    starlight: { glow: "#ffdc83", body: "#fff1cd", shadow: "#b98b49" },
    zephyr: { glow: "#8be9a8", body: "#dcfbe6", shadow: "#3f9a63" },
    wisp: { glow: "#c9a8ff", body: "#efe4ff", shadow: "#7a55c0" },
    umbra: { glow: "#8f9bff", body: "#d9dcf7", shadow: "#3d3f8f" },
  };
  const PLAIN = { glow: "rose", outfit: {} };                // anyone whose look isn't known yet
  const BOX = { x: -40, y: -50, w: 400, h: 380 };            // her 320 x 300 drawing, with room for hats, wings and tails
  const FEET = 272;                                          // where her paws rest in her own drawing
  const INK = "#462846";

  function palette(look) { return PALETTES[(look && look.glow) || "rose"] || PALETTES.rose; }

  // Her eyes: open (the usual), closed (asleep, or a blink) or happy (two little arches, for a cheer).
  const EYES = {
    open: '<g fill="' + INK + '"><ellipse cx="129" cy="153" rx="5" ry="9"/><ellipse cx="191" cy="153" rx="5" ry="9"/></g>',
    closed: '<path d="M120 154 Q129 163 138 154 M182 154 Q191 163 200 154" fill="none" stroke="' + INK + '" stroke-width="2.8" stroke-linecap="round"/>',
    happy: '<path d="M120 158 Q129 146 138 158 M182 158 Q191 146 200 158" fill="none" stroke="' + INK + '" stroke-width="3.2" stroke-linecap="round"/>',
  };

  // closet.js is written for a page, which forgives an attribute given twice (it keeps the first); an SVG image is
  // strict XML and won't load at all. So each tag keeps only the first of any repeated attribute, as the page does.
  function tidy(markup) {
    return markup.replace(/<([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, function (tag, name, attrs, close) {
      const seen = new Set(), kept = [];
      attrs.replace(/\s+([\w:-]+)="([^"]*)"/g, function (_, key, value) { if (!seen.has(key)) { seen.add(key); kept.push(key + '="' + value + '"'); } return ""; });
      return "<" + name + (kept.length ? " " + kept.join(" ") : "") + (close ? "/>" : ">");
    });
  }

  function svg(look, eyes) { // Her whole drawing, as Lumi Pet draws her (templates/games/lumi-pet.html), dressed.
    const p = palette(look), outfit = (look && look.outfit) || {};
    const wear = function (layer) { return closet && closet.render ? tidy(closet.render(outfit, layer)) : ""; };
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [BOX.x, BOX.y, BOX.w, BOX.h].join(" ") + '" width="' + BOX.w * 2 + '" height="' + BOX.h * 2 + '">' +
      '<g fill="' + p.glow + '" fill-opacity=".22" stroke="' + p.glow + '" stroke-width="2">' +
        '<path d="M113 176 C8 187 25 74 79 108 C104 122 113 153 113 176Z"/><path d="M207 176 C312 187 295 74 241 108 C216 122 207 153 207 176Z"/>' +
        '<path d="M109 182 C36 174 48 238 93 215Z M211 182 C284 174 272 238 227 215Z"/></g>' +
      wear("back") +
      '<path d="M217 228 C279 254 286 188 256 193 C238 196 260 215 239 218" fill="none" stroke="' + p.shadow + '" stroke-width="17" stroke-linecap="round"/>' +
      '<ellipse cx="160" cy="214" rx="62" ry="57" fill="' + p.body + '" stroke="' + p.shadow + '" stroke-width="2"/>' +
      '<ellipse cx="160" cy="230" rx="36" ry="31" fill="#ffffff" fill-opacity=".53"/>' +
      '<path d="M92 153 L88 62 Q89 49 100 58 L137 93 Q160 83 183 93 L220 58 Q231 49 232 62 L228 153 Q230 204 160 208 Q90 204 92 153Z" fill="' + p.body + '" stroke="' + p.shadow + '" stroke-width="2"/>' +
      '<path d="M101 77 L106 118 L126 102Z M219 77 L214 118 L194 102Z" fill="' + p.glow + '"/>' +
      '<path d="M160 103 L165 116 L179 120 L165 125 L160 139 L155 125 L141 120 L155 116Z" fill="#fff9d7" stroke="' + p.shadow + '"/>' +
      (EYES[eyes] || EYES.open) +
      '<ellipse cx="114" cy="169" rx="13" ry="6" fill="' + p.glow + '"/><ellipse cx="206" cy="169" rx="13" ry="6" fill="' + p.glow + '"/>' +
      '<path d="M155 165 L160 169 L165 165 M160 169 Q151 184 145 173 M160 169 Q169 184 175 173" fill="none" stroke="' + INK + '" stroke-width="2.8" stroke-linecap="round"/>' +
      '<ellipse cx="123" cy="259" rx="24" ry="13" fill="' + p.body + '" stroke="' + p.shadow + '" stroke-width="2"/>' +
      '<ellipse cx="197" cy="259" rx="24" ry="13" fill="' + p.body + '" stroke="' + p.shadow + '" stroke-width="2"/>' +
      wear("front") + "</svg>";
  }

  const images = new Map();                                  // one image per look and eyes, made once
  function key(look, eyes) { return JSON.stringify([(look && look.glow) || "rose", (look && look.outfit) || {}, eyes || "open"]); }
  function image(look, eyes) { // Her drawing as an image, ready to draw (null while it loads, or outside a browser).
    if (typeof Image === "undefined") return null;
    const k = key(look, eyes);
    let found = images.get(k);
    if (!found) {
      found = { img: new Image(), ready: false };
      found.img.onload = function () { found.ready = true; };
      found.img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg(look, eyes));
      images.set(k, found);
      if (images.size > 64) images.delete(images.keys().next().value);   // a long showdown evening never piles up images
    }
    return found.ready ? found.img : null;
  }

  // draw(ctx, look, x, y, height, opts): her paws at (x, y), `height` canvas units tall (head to paws).
  // opts: flip (face left), eyes ("open", "closed", "happy"), tilt (radians), squash (1 = none; under 1 squashed flat,
  // as on landing), alpha, glow (how much she shines: 0 to 1).
  function draw(ctx, look, x, y, height, opts) {
    opts = opts || {};
    const unit = height / (FEET - 40), squash = opts.squash || 1, p = palette(look);   // her head's top is about y = 40 in her drawing
    ctx.save();
    ctx.translate(x, y);
    if (opts.tilt) ctx.rotate(opts.tilt);
    ctx.scale(unit * (opts.flip ? -1 : 1) * (2 - squash), unit * squash);
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    if (opts.glow !== 0) { ctx.shadowColor = p.glow; ctx.shadowBlur = 16 * (opts.glow === undefined ? 1 : opts.glow); }   // a soft shine in her own glow (the blur isn't scaled with her)
    const img = image(look, opts.eyes);
    if (img) ctx.drawImage(img, BOX.x - 160, BOX.y - FEET, BOX.w, BOX.h);
    else stand(ctx, p);
    ctx.restore();
  }

  function stand(ctx, p) { // The moment before her image has loaded: her shape in her colours, centred on her paws.
    ctx.translate(-160, -FEET);
    ctx.fillStyle = p.body; ctx.strokeStyle = p.shadow; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(160, 214, 62, 57, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(160, 140, 70, 62, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.glow;
    ctx.beginPath(); ctx.moveTo(101, 77); ctx.lineTo(106, 118); ctx.lineTo(126, 102); ctx.moveTo(219, 77); ctx.lineTo(214, 118); ctx.lineTo(194, 102); ctx.fill();
  }

  // ball(ctx, look, x, y, r, spin, speed): Lumi curled up into a ball, radius r, turned by `spin` (radians). Her face
  // says how fast she's going (speed 0 to 1): a happy smile when it's gentle, wide eyes in between, squeezed-shut
  // eyes and an "o" of a mouth when she's flying.
  function ball(ctx, look, x, y, r, spin, speed) {
    const p = palette(look), s = r / 20;                     // drawn in a 40-unit circle
    ctx.save();
    ctx.translate(x, y); ctx.rotate(spin || 0); ctx.scale(s, s);
    ctx.shadowColor = p.glow; ctx.shadowBlur = 12;
    ctx.fillStyle = p.glow; ctx.globalAlpha *= .35;          // her folded wings, peeking out
    ctx.beginPath(); ctx.ellipse(-19, 4, 9, 14, -0.5, 0, Math.PI * 2); ctx.ellipse(19, 4, 9, 14, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha /= .35;
    ctx.fillStyle = p.glow;                                  // her ears
    ctx.beginPath(); ctx.moveTo(-15, -12); ctx.lineTo(-17, -27); ctx.lineTo(-4, -18); ctx.closePath();
    ctx.moveTo(15, -12); ctx.lineTo(17, -27); ctx.lineTo(4, -18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.body; ctx.strokeStyle = p.shadow; ctx.lineWidth = 1.6;   // her round, curled-up body
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
    ctx.strokeStyle = p.shadow; ctx.lineWidth = 4.5; ctx.lineCap = "round";     // her tail, wrapped round her
    ctx.beginPath(); ctx.arc(0, 0, 16.5, 0.35, 1.9); ctx.stroke();
    ctx.fillStyle = "#fff9d7"; ctx.strokeStyle = p.shadow; ctx.lineWidth = .8;   // the star on her forehead
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, d = i % 2 ? 2 : 5; ctx.lineTo(Math.cos(a) * d, -10 + Math.sin(a) * d); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.glow; ctx.globalAlpha *= .8;           // her cheeks
    ctx.beginPath(); ctx.ellipse(-10, 5, 3.6, 1.8, 0, 0, Math.PI * 2); ctx.ellipse(10, 5, 3.6, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha /= .8;
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1.7; ctx.lineCap = "round";
    const fast = speed > 0.72, slow = speed < 0.4;
    ctx.beginPath();
    if (fast) { ctx.moveTo(-9, -1); ctx.lineTo(-5, 1); ctx.lineTo(-9, 3); ctx.moveTo(9, -1); ctx.lineTo(5, 1); ctx.lineTo(9, 3); ctx.stroke();   // > <
                ctx.beginPath(); ctx.ellipse(0, 7, 2, 2.6, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (slow) { ctx.moveTo(-9, 2); ctx.quadraticCurveTo(-6.5, -2, -4, 2); ctx.moveTo(4, 2); ctx.quadraticCurveTo(6.5, -2, 9, 2); ctx.stroke();   // ^ ^
                     ctx.beginPath(); ctx.moveTo(-2.5, 6); ctx.quadraticCurveTo(0, 8.5, 2.5, 6); ctx.stroke(); }
    else { ctx.ellipse(-6.5, 1, 1.6, 2.8, 0, 0, Math.PI * 2); ctx.ellipse(6.5, 1, 1.6, 2.8, 0, 0, Math.PI * 2); ctx.fill();   // wide eyes
           ctx.beginPath(); ctx.moveTo(-2, 6.5); ctx.lineTo(0, 7.5); ctx.lineTo(2, 6.5); ctx.stroke(); }
    ctx.restore();
  }

  // ---- This player's own look, asked for once (the account that pays the coins: on a TV, the TV's owner).
  let mine = null, asked = null;
  function own(api) {
    if (!asked && api) asked = api(window.LUMI_API + "lumi-look").then(function (look) { mine = look; return look; }).catch(function () { return PLAIN; });
    return mine || PLAIN;
  }

  return { PALETTES: PALETTES, PLAIN: PLAIN, palette: palette, svg: svg, image: image, draw: draw, ball: ball, own: own };
});
