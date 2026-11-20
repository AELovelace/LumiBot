/* LumiBot port (src/lumi/CONTRACT.md): API calls go to window.LUMI_API (/lumipet/api/), set by the page shell before this file loads;
   saved settings use the "lumi-game:" localStorage prefix; nothing is posted to a TV frame (there is none here); coins are SadGirlCoin (SGC).

   Shared by the built-in games (mnemerynne/games.py): one set of actions however they arrive, the talk with
   Media's game layer (media.js games), the theme's colours, sound and the best score kept on this device.

   Actions: "left", "right", "up", "down", "enter", "play", "prev", "next". Prev and Next are a remote's track buttons, or Page Up / Page Down
   or [ and ] on a keyboard; a game that has no use for them ignores them. Keyboard Play is P or a media Play key; other actions use arrows, WASD, Enter, Space, or
   from the TV page, which forwards a remote panel's arrows and Enter here as messages ({type:
   "mnemerynne-game-key", key}). Escape or Backspace inside the frame asks the TV page to close the game.

   To the TV page (same origin only): {type: "mnemerynne-game-state", sub} whenever the score line changes, so a
   remote panel shows it under the game's name; {type: "mnemerynne-game-close"} to go back to Games. */
(function () {
  "use strict";

  const framed = window.parent !== window;
  const KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "enter", " ": "enter",
                 a: "left", d: "right", w: "up", s: "down", A: "left", D: "right", W: "up", S: "down",
                 MediaPlay: "play", MediaPlayPause: "play", p: "play", P: "play",
                 MediaTrackNext: "next", MediaTrackPrevious: "prev", PageDown: "next", PageUp: "prev", "]": "next", "[": "prev" };
  const PAD_ACTIONS = { up: "up", down: "down", left: "left", right: "right", a: "enter", start: "play", l: "prev", r: "next" };
  let onAction = null, directEnter = null, tabNavigation = false;
  let onBack = null; // A game's own "back" (Lumi Pet's room mode closes a card): true when it used the key, so the game stays open.

  function toParent(kind, extra) { // LumiBot port: there is no TV page around the games, so nothing is ever posted out of the frame
    return { kind: kind, extra: extra }; // kept as a harmless no-op so every caller below stays unchanged
  }

  function act(action, controller, remote, meta) { // A signed panel input keeps its identity (and says which remote it was); local keys and older games need neither.
    sound.unlock();
    if (onAction) onAction(action, controller, remote, meta); // meta: { held: true } on a direction that MGame.onHold is also walking (see below)
  }

  // ---- Held walking (Lumi Pet's free walking, 2026-11-19), opt-in through MGame.onHold(fn). A game that asks gets
  // fn(who, x, y) whenever a held direction changes: who is "keys" (arrows and WASD), or "panel:<controller>" (a remote
  // panel in gamepad mode, the Tab5 or a phone, whose buttons say when they go up as well as down). x and y are -1..1,
  // y -1 being up. A remote panel's press mode (mnemerynne-game-key) has no "let go", so it stays a single press.
  // The direction actions still arrive as before, tagged { held: true }, so menus keep working and the game can skip
  // them where the hold already moves something. Games that never call onHold see no change at all.
  const WAYS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }; // a direction as a step on x and y
  let onHold = null;
  const holding = {};   // who → { key: direction } of what's held right now (key: the keyboard's e.code, or the pad button)
  const heldKeys = {};  // e.code → direction: the keyup lets go of the same key even if Shift changed its letter in between

  function way(held) { // The walking direction of a set of held directions: opposite ones cancel, each axis -1..1.
    let x = 0, y = 0;
    Object.keys(held).forEach(function (key) { const step = WAYS[held[key]]; x += step[0]; y += step[1]; });
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  function hold(who, key, direction, down) { // One direction held or let go; tells the game only when the walking direction changed.
    if (!onHold) return;
    const held = holding[who] || (holding[who] = {}), before = way(held);
    if (down && WAYS[direction]) held[key] = direction; else delete held[key];
    const after = way(held);
    if (after.x !== before.x || after.y !== before.y) onHold(who, after.x, after.y);
  }

  function letGo() { // The window lost focus or was hidden: every held direction is let go, so nobody walks off on their own.
    Object.keys(heldKeys).forEach(function (code) { delete heldKeys[code]; });
    Object.keys(holding).forEach(function (who) {
      const was = way(holding[who]);
      holding[who] = {};
      if (onHold && (was.x || was.y)) onHold(who, 0, 0);
    });
  }
  window.addEventListener("blur", letGo);
  document.addEventListener("visibilitychange", function () { if (document.hidden) letGo(); });

  document.addEventListener("keyup", function (e) { // A held arrow or WASD let go (always, even if the focus moved into a text box meanwhile).
    const direction = heldKeys[e.code];
    if (!direction) return;
    delete heldKeys[e.code];
    hold("keys", e.code, direction, false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Tab") { tabNavigation = true; return; } // Explicit keyboard focus navigation retains native button activation.
    if (e.target && (e.target.matches("input, select, textarea") || e.target.isContentEditable)) return; // Native form editing keeps its keys.
    if (e.key === "Escape" || e.key === "Backspace") {
      if (onBack && onBack()) { e.preventDefault(); return; } // The game went back a step itself (a card closed): not out of the game.
      if (framed) { e.preventDefault(); toParent("close"); }
      return;
    }
    const action = KEYS[e.key];
    if (!action) return;
    if (["left", "right", "up", "down"].includes(action)) tabNavigation = false;
    const tag = (e.target && e.target.tagName) || "";
    if (action === "enter" && tag === "BUTTON" && !(directEnter && directEnter() && !tabNavigation)) return; // Casino tables can make Enter submit a bet regardless of old focus.
    e.preventDefault();
    if (onHold && WAYS[action]) { // Held walking: remember which key holds which way (repeats change nothing), and tag the action.
      if (!e.repeat) { heldKeys[e.code] = action; hold("keys", e.code, action, true); }
      act(action, undefined, undefined, { held: true });
      return;
    }
    act(action);
  });

  window.addEventListener("message", function (e) { // A remote panel's arrow or Enter, forwarded by the TV page.
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const data = e.data || {};
    if (data.type === "mnemerynne-game-key" && KEYS[data.key]) act(KEYS[data.key], typeof data.controller === "string" ? data.controller : undefined,
      Number.isInteger(data.remote) ? data.remote : undefined);
    // A remote panel in gamepad mode (media/remotes.py PAD_BUTTONS): a button going down is the game's action, as a
    // press is (A or Start: enter or play; L / R: prev / next); going up, and X, Y, B and Select, mean nothing here.
    if (data.type === "mnemerynne-game-pad" && data.down === true && data.button === "b" && onBack) { sound.unlock(); onBack(); return; } // B is "back" where a game has one.
    const padHeld = data.type === "mnemerynne-game-pad" && Boolean(onHold) && Boolean(WAYS[data.button]); // a panel D-pad button, with held walking on
    if (padHeld) hold("panel:" + (typeof data.controller === "string" ? data.controller : "?"), data.button, data.button, data.down === true); // down walks, up stops
    if (data.type === "mnemerynne-game-pad" && data.down === true && PAD_ACTIONS[data.button]) act(PAD_ACTIONS[data.button],
      typeof data.controller === "string" ? data.controller : undefined, Number.isInteger(data.remote) ? data.remote : undefined, padHeld ? { held: true } : undefined);
    if (data.type === "mnemerynne-game-scale" && document.documentElement.classList.contains("tv") &&
        Number.isFinite(data.scale) && data.scale >= .75 && data.scale <= 3) {
      document.documentElement.style.setProperty("--ui-scale", String(data.scale)); // Reuse the UI's rem scale, never multiply it twice.
      window.dispatchEvent(new Event("resize")); // Canvas games redraw at the new CSS size, retaining device-pixel sharpness.
    }
  });

  function colors() { // The theme's tokens (theme-neon.css by default), so the game matches whatever look is on.
    const css = getComputedStyle(document.documentElement), read = function (name, fallback) {
      return (css.getPropertyValue(name) || "").trim() || fallback;
    };
    return { pink: read("--rose", "#ff2e97"), pinkSoft: read("--rose-deep", "#ff7ac0"), cyan: read("--cyan", "#00f0ff"),
             ink: read("--ink", "#ffe9f5"), muted: read("--muted", "#b98aa9"), night: read("--blush", "#07020d"),
             glow: read("--glow", "255, 46, 151"), font: read("--serif", "system-ui, sans-serif") };
  }

  const game = (document.getElementById("gm") || {}).dataset || {};
  const store = { // This device's own records, per game; a blocked or private browser simply forgets them.
    get: function (name, fallback) {
      try { const v = localStorage.getItem("lumi-game:" + game.game + ":" + name); return v === null ? fallback : JSON.parse(v); } // LumiBot: keys start "lumi-game:"
      catch (e) { return fallback; }
    },
    set: function (name, value) {
      try { localStorage.setItem("lumi-game:" + game.game + ":" + name, JSON.stringify(value)); } catch (e) { /* storage blocked */ } // LumiBot: keys start "lumi-game:"
    },
  };

  const sound = (function () { // Short synthesized notes (Web Audio): no files, a polyphony cap, muting remembered.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let on = store.get("sound", true), ctx = null, master = null;
    const voices = new Set();
    function unlock() { // Start or resume audio; browsers only allow it after a key or tap (the TV box allows it anyway).
      if (!on || !Ctx || document.hidden) return;
      try {
        if (!ctx) { ctx = new Ctx(); master = ctx.createGain(); master.gain.value = 0.3; master.connect(ctx.destination); }
        if (ctx.state === "suspended") ctx.resume().catch(function () {});
      } catch (e) { ctx = null; }
    }
    function stop() { // Silence everything now (muted, or the page hidden).
      voices.forEach(function (v) { try { v.stop(); } catch (e) { /* already ended */ } });
      voices.clear();
    }
    function tone(freq, duration, delay, volume, type, endFreq) { // One click-free note, sliding from freq to endFreq.
      if (!on || !ctx || ctx.state !== "running" || document.hidden || voices.size >= 32) return;
      try {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), start = ctx.currentTime + (delay || 0);
        osc.type = type || "sine";
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(endFreq || freq, start + duration);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume || 0.2, start + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain); gain.connect(master);
        voices.add(osc);
        osc.onended = function () { osc.disconnect(); gain.disconnect(); voices.delete(osc); };
        osc.start(start); osc.stop(start + duration + 0.02);
      } catch (e) { stop(); }   // a missing audio device never stops the game
    }
    function toggle() { on = !on; store.set("sound", on); if (!on) stop(); else unlock(); return on; }
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); });
    return { unlock: unlock, stop: stop, tone: tone, toggle: toggle, isOn: function () { return on; } };
  })();

  const extraHeaders = {}; // Sent with every api() call: the Lumi apps' play pass on a shared TV (mnemerynne/lumi_tv.py).

  async function api(url, body) { // A bounded GET, or a POST when there's a body. A refusal throws with its status and the server's words.
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      headers: Object.assign({}, extraHeaders, body === undefined ? {} : { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000), cache: "no-store" });
    let data = {};
    try { data = await response.json(); } catch (e) { // Not JSON: a proxy's error page (nginx's 502) or a cut-off answer.
      if (response.ok) throw e;                        // A good answer that won't parse is still a failure, as before.
    }
    if (!response.ok) { // The failure always carries its status, so callers can tell "the server is struggling" from "no".
      const words = typeof data.detail === "string" ? data.detail : typeof data.error === "string" ? data.error : "This move could not be accepted."; // LumiBot errors carry both detail and error
      const failure = new Error(words); // the message the game shows the player
      failure.status = response.status; // HTTP status (402 = not enough SGC, 409 = busy, 429 = slow down)
      failure.code = typeof data.code === "string" ? data.code : ""; // LumiBot's machine-readable reason, e.g. "not_enough_sgc"
      failure.data = data; // the whole error body (need/have and other extras)
      throw failure;
    }
    return data;
  }

  function showCoins(id) { // Put this account's SadGirlCoin (SGC) balance in an element; if it can't be read, the game simply plays on.
    api(window.LUMI_API + "coins").then(function (data) { // GET /lumipet/api/coins -> { coins: <SGC balance> }
      const box = document.getElementById(id);
      if (box) box.textContent = data.coins.toLocaleString(); // the page's label next to it says "SGC"
    }).catch(function () { /* the balance is a nicety, never a reason to stop */ });
  }

  window.MGame = {
    api: api, showCoins: showCoins,
    setHeader: function (name, value) { if (value) extraHeaders[name] = value; else delete extraHeaders[name]; }, // Add (or, with no value, drop) a header every api() call sends.
    framed: framed,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    onAction: function (fn, options) { onAction = fn; directEnter = options && options.directEnter; }, // Optional direct Enter controls; older games keep native buttons.
    onBack: function (fn) { onBack = fn; }, // fn() → true when Escape / Backspace / a pad's B went back a step in the game (false: leave the game, as before)
    onHold: function (fn) { onHold = fn; letGo(); }, // Held walking: fn(who, x, y) as a held direction changes (see "Held walking" above); null turns it off
    letGo: letGo,                                    // let go of everything held (a game opening a text box, say)
    tap: act,                                                // the game's own buttons and taps, as actions
    report: function (sub) { toParent("state", { sub: String(sub || "").slice(0, 300) }); },   // the line a remote shows
    close: function () { toParent("close"); },
    colors: colors, store: store, sound: sound,
  };
})();
