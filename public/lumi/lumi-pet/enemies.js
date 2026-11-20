/* The creatures Lumi fights, drawn as plain SVG in a 200 x 200 box. There are twenty enemies in the server's catalog
   (mnemerynne/lumipet_data/battle.json) but only fifteen body shapes here: each enemy names a body and a colour, so a
   Dust Bunny and a Puddle Slime are the same blob in different colours. Every body in lumibattle.BODIES needs an entry
   (tests/js/lumi_enemies.test.mjs checks). All original creatures: nothing here is anyone else's character.

   The colour comes from the server, which only accepts "#rrggbb", so it is safe to put into markup. */
(function (root, make) {
  const enemies = make();
  if (typeof module === "object" && module.exports) module.exports = enemies; else root.LumiPetEnemies = enemies;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const INK = "#2a1a3a", EDGE = 'stroke="' + INK + '" stroke-opacity=".45" stroke-width="3" stroke-linejoin="round"';

  function eyes(x1, x2, y, size) { // Two dark eyes with a glint: what makes a shape a creature.
    const r = size || 7;
    return [x1, x2].map(function (x) {
      return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r * .7 + '" ry="' + r + '" fill="' + INK + '"/><circle cx="' + (x + r * .25) + '" cy="' + (y - r * .35) + '" r="' + r * .28 + '" fill="#fff"/>';
    }).join("");
  }
  function shape(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" ' + (more === undefined ? EDGE : more) + "/>"; }
  function sheen(d) { return '<path d="' + d + '" fill="#fff" opacity=".28"/>'; } // A soft highlight.
  function shade(d) { return '<path d="' + d + '" fill="' + INK + '" opacity=".22"/>'; } // A soft shadow.

  const BODIES = {
    blob: function (c) { return shape("M36 164 Q22 86 100 76 Q178 86 164 164 Q100 180 36 164Z", c) + sheen("M58 108 Q70 88 100 86 Q76 96 66 118Z") + eyes(80, 120, 128) + shape("M90 146 Q100 154 110 146", "none", 'stroke="' + INK + '" stroke-width="3" stroke-linecap="round"'); },
    spark: function (c) { return shape("M100 20 L120 78 L180 100 L120 122 L100 180 L80 122 L20 100 L80 78Z", c) + sheen("M100 40 L110 82 L100 90 L92 82Z") + eyes(88, 112, 100, 6) + shape("M150 40 l8 16 l16 8 l-16 8 l-8 16 l-8 -16 l-16 -8 l16 -8Z", c, 'opacity=".7"'); },
    bug: function (c) { return shape("M50 96 L22 76 M50 120 L18 124 M56 142 L30 166 M150 96 L178 76 M150 120 L182 124 M144 142 L170 166 M84 66 Q70 36 56 34 M116 66 Q130 36 144 34", "none", 'stroke="' + INK + '" stroke-width="5" stroke-linecap="round"') + shape("M100 60 Q160 66 156 122 Q150 170 100 172 Q50 170 44 122 Q40 66 100 60Z", c) + shade("M100 62 V172 M52 106 H148 M56 138 H144") + shape("M100 62 V172", "none", 'stroke="' + INK + '" stroke-opacity=".3" stroke-width="3"') + eyes(84, 116, 90, 6); },
    wing: function (c) { return shape("M92 104 Q20 30 14 96 Q14 140 90 124Z M108 104 Q180 30 186 96 Q186 140 110 124Z", c, EDGE + ' fill-opacity=".8"') + shape("M90 128 Q40 132 44 162 Q70 166 94 140Z M110 128 Q160 132 156 162 Q130 166 106 140Z", c, EDGE + ' fill-opacity=".6"') + shape("M82 86 L78 60 L96 78Z M118 86 L122 60 L104 78Z", c) + '<ellipse cx="100" cy="112" rx="26" ry="36" fill="' + c + '" ' + EDGE + "/>" + eyes(90, 110, 100, 6); },
    sprout: function (c) { return shape("M100 74 Q60 20 34 44 Q52 78 100 74Z M100 74 Q140 20 166 44 Q148 78 100 74Z", c) + shape("M100 70 Q160 80 152 132 Q144 176 100 176 Q56 176 48 132 Q40 80 100 70Z", c) + shape("M50 110 L30 104 M48 136 L28 140 M150 110 L170 104 M152 136 L172 140 M70 168 L62 186 M130 168 L138 186", "none", 'stroke="' + INK + '" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"') + sheen("M66 104 Q76 86 98 82 Q80 94 74 114Z") + eyes(84, 116, 122); },
    imp: function (c) { return shape("M132 150 Q176 150 170 112 l10 -4 l-4 14 l-8 -2", "none", 'stroke="' + INK + '" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"') + shape("M68 70 Q52 34 40 30 Q44 56 58 80Z M132 70 Q148 34 160 30 Q156 56 142 80Z", c) + '<ellipse cx="100" cy="150" rx="34" ry="30" fill="' + c + '" ' + EDGE + "/>" + '<circle cx="100" cy="96" r="44" fill="' + c + '" ' + EDGE + "/>" + sheen("M70 80 Q82 62 102 60 Q84 70 78 90Z") + eyes(84, 116, 96) + shape("M84 116 Q100 130 116 116 L110 122 L104 116 L98 122 L92 116Z", INK, ""); },
    crab: function (c) { return shape("M52 136 L26 160 M64 148 L44 174 M148 136 L174 160 M136 148 L156 174", "none", 'stroke="' + INK + '" stroke-opacity=".6" stroke-width="6" stroke-linecap="round"') + shape("M44 104 Q20 96 22 66 Q40 50 54 70 L40 76 L56 84Z M156 104 Q180 96 178 66 Q160 50 146 70 L160 76 L144 84Z", c) + '<ellipse cx="100" cy="124" rx="62" ry="38" fill="' + c + '" ' + EDGE + "/>" + sheen("M56 112 Q70 94 100 92 Q76 100 66 120Z") + shape("M84 96 V76 M116 96 V76", "none", 'stroke="' + INK + '" stroke-opacity=".6" stroke-width="4"') + eyes(84, 116, 72, 6); },
    cat: function (c) { return shape("M140 150 Q190 160 176 110 Q168 96 158 108", "none", 'stroke="' + c + '" stroke-width="14" stroke-linecap="round"') + '<ellipse cx="100" cy="148" rx="42" ry="34" fill="' + c + '" ' + EDGE + "/>" + shape("M54 104 L50 40 L84 70 Q100 64 116 70 L150 40 L146 104 Q146 136 100 138 Q54 136 54 104Z", c) + shape("M60 58 L64 84 L78 72Z M140 58 L136 84 L122 72Z", "#fff", 'opacity=".3"') + '<ellipse cx="82" cy="100" rx="6" ry="9" fill="#ffe66b"/><ellipse cx="118" cy="100" rx="6" ry="9" fill="#ffe66b"/><ellipse cx="82" cy="100" rx="2" ry="8" fill="' + INK + '"/><ellipse cx="118" cy="100" rx="2" ry="8" fill="' + INK + '"/>'; },
    golem: function (c) { return shape("M36 92 h28 v62 h-28Z M136 92 h28 v62 h-28Z", c) + shape("M62 78 h76 q10 0 10 10 v66 q0 10 -10 10 h-76 q-10 0 -10 -10 v-66 q0 -10 10 -10Z", c) + shape("M68 164 h24 v20 h-24Z M108 164 h24 v20 h-24Z", c) + shape("M70 30 h60 q8 0 8 8 v34 q0 8 -8 8 h-60 q-8 0 -8 -8 v-34 q0 -8 8 -8Z", c) + shade("M62 120 H138 M100 88 V160") + sheen("M70 38 h30 v8 h-30Z") + eyes(86, 114, 56, 6); },
    ghost: function (c) { return shape("M40 170 V96 Q40 34 100 34 Q160 34 160 96 V170 L140 154 L120 170 L100 154 L80 170 L60 154Z", c, EDGE + ' fill-opacity=".88"') + sheen("M62 84 Q72 54 100 50 Q80 64 74 96Z") + eyes(82, 118, 96, 9) + '<ellipse cx="100" cy="124" rx="8" ry="10" fill="' + INK + '"/>'; },
    bird: function (c) { return shape("M36 120 L10 104 L18 132 L8 146 L40 138Z", c) + '<ellipse cx="96" cy="122" rx="60" ry="42" fill="' + c + '" ' + EDGE + "/>" + shape("M70 112 Q110 84 140 124 Q110 150 70 112Z", c) + shade("M70 112 Q110 84 140 124 Q110 150 70 112Z") + '<circle cx="142" cy="82" r="30" fill="' + c + '" ' + EDGE + "/>" + shape("M168 80 L194 88 L168 96Z", "#ffb84a") + eyes(140, 156, 78, 6) + shape("M84 162 V182 M108 162 V182", "none", 'stroke="#ffb84a" stroke-width="5" stroke-linecap="round"'); },
    hound: function (c) { return shape("M40 128 Q14 110 22 86", "none", 'stroke="' + c + '" stroke-width="12" stroke-linecap="round"') + shape("M56 150 V184 M80 154 V184 M116 154 V184 M140 150 V184", "none", 'stroke="' + c + '" stroke-width="14" stroke-linecap="round"') + '<ellipse cx="96" cy="134" rx="58" ry="30" fill="' + c + '" ' + EDGE + "/>" + shape("M118 70 L112 34 L138 56Z M166 70 L176 36 L150 56Z", c) + '<circle cx="144" cy="86" r="34" fill="' + c + '" ' + EDGE + "/>" + '<ellipse cx="166" cy="98" rx="20" ry="14" fill="' + c + '" ' + EDGE + "/>" + '<circle cx="182" cy="94" r="5" fill="' + INK + '"/>' + eyes(134, 154, 80, 6); },
    jelly: function (c) { return shape("M60 112 Q50 150 62 184 M84 116 Q94 150 80 186 M116 116 Q106 150 120 186 M140 112 Q150 150 138 184", "none", 'stroke="' + c + '" stroke-width="8" stroke-linecap="round" opacity=".8"') + shape("M34 118 Q30 34 100 34 Q170 34 166 118 Q134 106 100 118 Q66 106 34 118Z", c, EDGE + ' fill-opacity=".85"') + sheen("M56 84 Q66 52 98 48 Q76 62 70 94Z") + eyes(82, 118, 88, 8); },
    crystal: function (c) { return shape("M100 14 L146 76 L128 180 H72 L54 76Z", c, EDGE + ' fill-opacity=".85"') + shape("M40 96 L60 120 L52 176 H28 L20 124Z M160 96 L180 124 L172 176 H148 L140 120Z", c, EDGE + ' fill-opacity=".7"') + sheen("M100 14 L120 76 L100 180 L92 76Z") + shape("M100 14 L54 76 L72 180", "#ff8ecb", 'opacity=".18"') + shape("M100 14 L146 76 L128 180", "#70ebea", 'opacity=".18"') + eyes(86, 114, 104, 6); },
    drake: function (c) { return shape("M84 96 Q30 20 10 70 Q30 76 36 96 Q52 96 60 116Z M116 96 Q170 20 190 70 Q170 76 164 96 Q148 96 140 116Z", c, EDGE + ' fill-opacity=".8"') + shape("M132 160 Q190 176 184 128 l12 4 l-8 -18 l-12 12", "none", 'stroke="' + c + '" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"') + '<ellipse cx="100" cy="146" rx="46" ry="38" fill="' + c + '" ' + EDGE + "/>" + '<ellipse cx="100" cy="154" rx="26" ry="24" fill="#fff" opacity=".3"/>' + shape("M78 60 L66 24 L90 46Z M122 60 L134 24 L110 46Z", "#ffe66b") + shape("M62 86 Q62 44 100 44 Q138 44 138 86 Q138 116 100 118 Q62 116 62 86Z", c) + eyes(84, 116, 80) + shape("M90 100 Q100 106 110 100", "none", 'stroke="' + INK + '" stroke-width="3" stroke-linecap="round"') + shape("M94 94 l-3 4 M106 94 l3 4", "none", 'stroke="' + INK + '" stroke-width="2"'); },
  };

  function draw(body, colour) { // One creature. An unknown body or an odd colour draws the plain blob in grey.
    const safe = /^#[0-9a-f]{6}$/.test(colour) ? colour : "#999999";
    return (Object.prototype.hasOwnProperty.call(BODIES, body) ? BODIES[body] : BODIES.blob)(safe);
  }

  return { BODIES: BODIES, draw: draw };
});
