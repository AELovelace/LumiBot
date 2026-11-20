/* Lumi Town's townsfolk (2026-11-14): a few Lumis who live in town and wander up and down the streets, and now and
   then say something. Pure data and choices, so Node can test it (tests/js/lumi_town.test.mjs); game.js draws them,
   with everyone else's Lumis who are in town right now (lumitown.py), on the #lp-folk layer above the town picture,
   moving them by `transform` only, so the picture itself is never redrawn for them.

   Where they walk: along the cobbled street (feet at y STREET_Y) or the lane in front of the bottom row (LANE_Y),
   never outside x WALK_MIN..WALK_MAX, the middle every screen shows (town-art.js). Their looks are authored here,
   with pieces from Lumi Pet's own closet (closet.js), so they're drawn exactly as a Lumi is. */
(function (root, make) {
  const folk = make();
  if (typeof module === "object" && module.exports) module.exports = folk; else root.LumiPetTownFolk = folk;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STREET_Y = 290, LANE_Y = 478;          // feet on the cobbles, or on the lane
  const WALK_MIN = 310, WALK_MAX = 690;        // the middle of the picture every screen shows
  const STEP_MIN = 70, STEP_MAX = 210;         // how far one stroll goes
  const PAUSE_MIN = 2500, PAUSE_MAX = 7000;    // and how long they stand about between strolls (ms)

  // The townsfolk. night: still out after dark (the rest have gone home to bed).
  const FOLK = [
    { id: "pip", name: "Pip", street: "high", path: "street", night: true, look: { glow: "lagoon", colour: null, outfit: { head: "acc-star-clip", neck: "acc-scarf" } } },
    { id: "maple", name: "Maple", street: "high", path: "lane", look: { glow: "starlight", colour: null, outfit: { head: "acc-flower-crown", back: "acc-backpack" } } },
    { id: "juniper", name: "Juniper", street: "high", path: "street", look: { glow: "zephyr", colour: null, outfit: { neck: "acc-bowtie", paws: "acc-boots" } } },
    { id: "biscuit", name: "Biscuit", street: "market", path: "street", night: true, look: { glow: "wisp", colour: null, outfit: { head: "acc-witch-hat", back: "acc-cape" } } },
    { id: "clover", name: "Clover", street: "market", path: "lane", look: { glow: "rose", colour: "#ffb070", outfit: { head: "acc-bow", tail: "acc-tail-bow" } } },
  ];

  // What they say, now and then. By day and by night; each street has a few of its own.
  const LINES = {
    high: ["The arcade's got a new cabinet!", "Have you tried the teacups?", "Lovely day for a walk~", "I heard the dealer winks at everyone.", "The garden smells of starpowder today."],
    market: ["Fresh cookies at the general store!", "I got a legendary from the Moon Capsule once!", "The Retro café does a lovely cocoa.", "Moondaisy seeds are on special.", "Mind the fountain, it splashes!"],
    night: ["Shh... the town's asleep~", "Look at all those stars.", "One more game, then bed.", "The lamps are so pretty at night."],
  };

  function folkOn(street, night) { // Who's out on this street now.
    return FOLK.filter(function (f) { return f.street === street && (!night || f.night); });
  }

  function y(person) { return person.path === "lane" ? LANE_Y : STREET_Y; }

  function start(person, index) { // Where each one first stands: spread along their path.
    return WALK_MIN + ((index * 137 + person.id.length * 41) % (WALK_MAX - WALK_MIN));
  }

  function next(x, roll) { // Their next stroll from x, given two numbers 0..1: how far, and which way (turning back at the edges).
    let step = STEP_MIN + roll[0] * (STEP_MAX - STEP_MIN), to = x + (roll[1] < 0.5 ? -step : step);
    if (to < WALK_MIN || to > WALK_MAX) to = x + (to < WALK_MIN ? step : -step);
    return Math.max(WALK_MIN, Math.min(WALK_MAX, Math.round(to)));
  }

  function pause(roll) { return PAUSE_MIN + roll * (PAUSE_MAX - PAUSE_MIN); } // ms to stand about after a stroll.

  function line(street, night, roll) { // Something one of them might say.
    const lines = night ? LINES.night : (LINES[street] || LINES.high);
    return lines[Math.min(lines.length - 1, Math.floor(roll * lines.length))];
  }

  return { FOLK: FOLK, LINES: LINES, STREET_Y: STREET_Y, LANE_Y: LANE_Y, WALK_MIN: WALK_MIN, WALK_MAX: WALK_MAX,
           folkOn: folkOn, y: y, start: start, next: next, pause: pause, line: line };
});
