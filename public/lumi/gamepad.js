/* Gamepads for the built-in games (first used by Lumi Launch, 2026-11-14): any pad the browser sees (navigator.getGamepads,
   the "standard" layout: Xbox, PlayStation, Switch Pro, most USB pads) turns into the same actions MGame's keys and
   remotes give: "left", "right", "up", "down", "enter", "play", plus "back".

   Buttons: A / Cross = enter · B / Circle = back · Start / Options = play · the D-pad and the left stick = arrows ·
   LB / RB (L1 / R1) = prev / next · the Xbox / PS button = home (where the browser passes it on; not every one does).
   A held direction repeats like a keyboard (after REPEAT_WAIT ms, then every REPEAT_EVERY ms), so menus scroll.
   Each pad says who it is ("pad:0", "pad:1", ...), so a couch game can tell its players apart.

   A game loads it through its Game.extras ("gamepad.js") and calls MPad.start(function (action, who) {...}).
   No pad, or a browser without the Gamepad API: nothing happens and nothing breaks. Node can test it through
   MPad.create(getPads, onAction), which polls only when told to (tests/js/gamepad.test.mjs).

   Held walking (Lumi Pet's free walking, 2026-11-19), opt-in: MPad.start(onAction, onHold) also calls
   onHold(who, x, y) whenever a pad's walking direction changes. x and y run -1..1 (y: -1 is up, away from you).
   The left stick is analog past a small dead zone (a gentle push walks slowly); the D-pad is a full ±1 and wins over
   the stick. An unplugged pad reports 0, 0 once. With onHold, the direction actions still arrive (menus need them)
   but carry a third argument { held: true }, so the game can skip them where the hold already moves something.
   Without onHold, nothing changes for older games. */
(function (root) {
  "use strict";

  const BUTTONS = { 0: "enter", 1: "back", 4: "prev", 5: "next", 9: "play", 12: "up", 13: "down", 14: "left", 15: "right", 16: "home" };   // the standard layout
  const STICK_ON = 0.5, STICK_OFF = 0.35;                   // the left stick: past half-way is a press; back under a third lets go
  const REPEAT_WAIT = 420, REPEAT_EVERY = 140;               // a held direction repeats, like a held arrow key
  const REPEATS = { up: 1, down: 1, left: 1, right: 1 };   // only directions repeat; OK, back and play never do
  const DEAD = 0.15;                                        // held walking: a stick resting under this is still

  function analog(v) {                                      // one stick axis past the dead zone, rescaled so just past it is ~0 and the edge is 1
    const size = Math.abs(v);
    if (!(size > DEAD)) return 0;                           // (also catches NaN from an odd pad)
    return Math.sign(v) * Math.min(1, (size - DEAD) / (1 - DEAD));
  }

  function walking(pad) {                                   // a pad's held walking direction {x, y}: the D-pad (full) wins over the stick (analog)
    const b = function (n) { const button = pad.buttons && pad.buttons[n]; return Boolean(button && (button.pressed || button.value > 0.5)); };
    const dx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), dy = (b(13) ? 1 : 0) - (b(12) ? 1 : 0);   // D-pad: right - left, down - up
    if (dx || dy) return { x: dx, y: dy };
    const ax = (pad.axes && pad.axes[0]) || 0, ay = (pad.axes && pad.axes[1]) || 0;
    return { x: Math.round(analog(ax) * 50) / 50, y: Math.round(analog(ay) * 50) / 50 };   // steps of 0.02, so a trembling thumb doesn't flood onHold
  }

  function create(getPads, onAction, onHold) {              // one poller: getPads() is navigator.getGamepads, or a test's fake; onHold optional
    const seen = {};                                        // per pad: what was held last poll, and when each began or repeated
    const tag = onHold ? { held: true } : undefined;        // with held walking on, direction actions say so (see the top)
    const fire = function (action, id) { if (tag && REPEATS[action]) onAction(action, id, tag); else onAction(action, id); }; // a press, tagged when it's a held direction

    function held(pad, mine) {                              // the actions this pad holds right now
      const out = new Set();
      Object.keys(BUTTONS).forEach(function (n) {
        const b = pad.buttons && pad.buttons[n];
        if (b && (b.pressed || b.value > 0.5)) out.add(BUTTONS[n]);
      });
      const ax = (pad.axes && pad.axes[0]) || 0, ay = (pad.axes && pad.axes[1]) || 0;
      const was = mine.stick || {};
      const stick = {                                       // a little stickiness, so a stick resting at the edge doesn't chatter
        left: ax < -(was.left ? STICK_OFF : STICK_ON), right: ax > (was.right ? STICK_OFF : STICK_ON),
        up: ay < -(was.up ? STICK_OFF : STICK_ON), down: ay > (was.down ? STICK_OFF : STICK_ON),
      };
      mine.stick = stick;
      Object.keys(stick).forEach(function (k) { if (stick[k]) out.add(k); });
      return out;
    }

    function poll(now) {                                    // look at every pad once; fire an action for each new press (and repeats)
      let pads = [];
      try { pads = Array.from(getPads() || []); } catch (e) { return; }   // a browser that refuses: no pads
      const here = new Set();
      pads.forEach(function (pad) {
        if (!pad || pad.connected === false) return;
        const id = "pad:" + pad.index, mine = seen[id] || (seen[id] = { down: {}, stick: {} });
        here.add(id);
        const now_ = held(pad, mine);
        now_.forEach(function (action) {
          const since = mine.down[action];
          if (since === undefined) {                        // a fresh press
            mine.down[action] = { at: now, next: now + REPEAT_WAIT };
            fire(action, id);
          } else if (REPEATS[action] && now >= since.next) {   // still held: repeat
            since.next = now + REPEAT_EVERY;
            fire(action, id);
          }
        });
        Object.keys(mine.down).forEach(function (action) { if (!now_.has(action)) delete mine.down[action]; });   // let go
        if (onHold) {                                       // held walking: tell the game only when the direction changes
          const way = walking(pad), last = mine.way || { x: 0, y: 0 };
          if (way.x !== last.x || way.y !== last.y) { mine.way = way; onHold(id, way.x, way.y); }
        }
      });
      Object.keys(seen).forEach(function (id) {             // an unplugged pad lets go of everything
        if (here.has(id)) return;
        if (onHold && seen[id].way && (seen[id].way.x || seen[id].way.y)) onHold(id, 0, 0);   // ...and stops walking
        delete seen[id];
      });
    }

    return { poll: poll, pads: function () { return Object.keys(seen); } };
  }

  let running = null;
  function start(onAction, onHold) {                        // the browser's pads, polled every animation frame (onHold: optional held walking)
    if (running || typeof navigator === "undefined" || !navigator.getGamepads) return false;
    running = create(function () { return navigator.getGamepads(); }, onAction, onHold);
    const loop = function (now) { if (!running) return; running.poll(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    return true;
  }
  function stop() { running = null; }

  const API = { create: create, start: start, stop: stop, BUTTONS: BUTTONS, DEAD: DEAD };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.MPad = API;
})(this);
