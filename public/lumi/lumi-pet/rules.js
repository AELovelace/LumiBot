/* Lumi Pet's small pure rules for the page. Her needs, pantry and coins live on the server (mnemerynne/lumipet.py);
   what stays here is what only the device knows (its local clock, for night and day) and how to read things aloud. */
(function (root, make) {
  const rules = make();
  if (typeof module === "object" && module.exports) module.exports = rules; else root.LumiPetRules = rules;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PALETTES = ["rose", "lagoon", "starlight", "zephyr", "wisp", "umbra"]; // Each is also her element in a fight (lumibattle.GLOW_ELEMENT).
  const METERS = ["hunger", "energy", "joy"];
  // Each glow's three colours (game.css has the same for her own room): her glow, her body, her outline and shadow.
  const COLOURS = { rose: ["#ff8ecb", "#fce1f2", "#b8569f"], lagoon: ["#70ebea", "#d2fcf6", "#328b9d"], starlight: ["#ffdc83", "#fff1cd", "#b98b49"],
    zephyr: ["#8be9a8", "#dcfbe6", "#3f9a63"], wisp: ["#c9a8ff", "#efe4ff", "#7a55c0"], umbra: ["#8f9bff", "#d9dcf7", "#3d3f8f"] };
  const LOW = 25; // Below this a need shows in her mood; the last quarter of a meter takes a day to empty.

  function scene(state, now) { // Follow the device's local night, with the server's nap or gentle-wake override.
    const hour = new Date(now).getHours(), night = hour >= 22 || hour < 7;
    const override = state.restUntil > now;
    return { night: night, asleep: override && state.rest === "nap" || (night && !(override && state.rest === "awake")) };
  }

  function legacy(raw) { // Read the old browser-only save (version 1) so its happy moments can move to the account once.
    const value = raw && typeof raw === "object" && raw.version === 1 ? raw : {};
    return {
      moments: Number.isSafeInteger(value.moments) ? Math.max(0, Math.min(999999, value.moments)) : 0,
      glow: PALETTES.includes(value.palette) ? value.palette : null,
    };
  }

  function mood(pet) { // Her most pressing need decides the caption; at zero she droops, and nothing else is lost.
    let worst = null;
    METERS.forEach(function (meter) { if (pet[meter] < LOW && (worst === null || pet[meter] < pet[worst])) worst = meter; });
    return { need: worst, sad: METERS.some(function (meter) { return pet[meter] <= 0; }) };
  }

  function nextPalette(current) { // Glow colours cycle in a fixed order.
    return PALETTES[(PALETTES.indexOf(current) + 1) % PALETTES.length];
  }

  function countdown(ms) { // "1:05" for a timed nap or play; never negative.
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function hexRgb(hex) { // "#ff8ecb" → [255, 142, 203]; anything else → null.
    return /^#[0-9a-f]{6}$/i.test(hex || "") ? [1, 3, 5].map(function (at) { return parseInt(hex.slice(at, at + 2), 16); }) : null;
  }

  function rgbHex(rgb) { // [255, 142, 203] → "#ff8ecb", each part kept to 0–255.
    return "#" + rgb.map(function (part) { return Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0"); }).join("");
  }

  function tint(hex) { // One chosen colour (the RGB sliders) as her three: the colour itself glows, her body is it washed most of the way to white, her shadow it darkened.
    const rgb = hexRgb(hex);
    if (!rgb) return null;
    return { glow: rgbHex(rgb), body: rgbHex(rgb.map(function (part) { return part + (255 - part) * 0.78; })), shadow: rgbHex(rgb.map(function (part) { return part * 0.55; })) };
  }

  function looks(glow, colour) { // Her three colours: her own chosen colour if she has one, else her glow's.
    const own = tint(colour);
    if (own) return own;
    const set = COLOURS[glow] || COLOURS.rose;
    return { glow: set[0], body: set[1], shadow: set[2] };
  }

  function signed(amount, label) { // "+25 joy" or "−10 energy", for an item's description.
    return (amount < 0 ? "−" : "+") + Math.abs(amount) + " " + label;
  }

  return { PALETTES: PALETTES, METERS: METERS, LOW: LOW, COLOURS: COLOURS, scene: scene, legacy: legacy, mood: mood,
    nextPalette: nextPalette, countdown: countdown, signed: signed, hexRgb: hexRgb, rgbHex: rgbHex, tint: tint, looks: looks };
});
