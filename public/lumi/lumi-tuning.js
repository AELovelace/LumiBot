/* LumiBot: the SAME price/prize formula as src/lumi/tuning.js, so what a page shows is exactly what the server charges.
     LumiPrice(game, key, native)  = override for key, else 0 when native is 0, else max(1, round(native * scale * priceMult))
     LumiPayout(game, key, native) = override for key, else max(0, floor(native * scale * payoutMult))
   game: the tuning id ('pet', 'prism', 'breakout', 'city' ...); key: the override key the server uses (usually the
   kind, e.g. 'entry'); native: erinne's own number. window.LUMI_TUNING comes from the page shell (lumi-boot.js).
   Also works under Node (module.exports) so tests can compare it with the server. */
(function (root) {
  "use strict";

  function tuningNow() { // the settings the page was served with
    var t = (root && root.LUMI_TUNING) || {};                                       // window.LUMI_TUNING
    return { scale: typeof t.scale === "number" ? t.scale : 0.2, games: t.games || {} }; // defaults like the server's
  }

  function gameOf(game) { // one game's knobs, with the server's defaults
    var g = tuningNow().games[game] || {};                                          // unknown game: defaults
    return {
      priceMult: typeof g.priceMult === "number" ? g.priceMult : 1,                 // default 1
      payoutMult: typeof g.payoutMult === "number" ? g.payoutMult : 1,              // default 1
      dailyCap: typeof g.dailyCap === "number" ? g.dailyCap : 0,                    // default 0 = uncapped
      enabled: g.enabled !== false,                                                 // default on
      priceOverrides: g.priceOverrides || {},                                       // {key: exact SGC}
      payoutOverrides: g.payoutOverrides || {}                                      // {key: exact SGC}
    };
  }

  function has(map, key) { return key !== undefined && key !== null && Object.prototype.hasOwnProperty.call(map, key); } // own key only

  function LumiPrice(game, key, native) { // SGC a thing costs
    var g = gameOf(game), n = Number(native);                                       // knobs + the native number
    if (has(g.priceOverrides, key)) return g.priceOverrides[key];                   // exact override wins
    if (!isFinite(n) || n <= 0) return 0;                                           // free (or junk) stays 0
    return Math.max(1, Math.round(n * tuningNow().scale * g.priceMult));            // same expression order as the server
  }

  function LumiPayout(game, key, native) { // SGC a prize pays
    var g = gameOf(game), n = Number(native);                                       // knobs + the native number
    if (has(g.payoutOverrides, key)) return g.payoutOverrides[key];                 // exact override wins
    if (!isFinite(n) || n <= 0) return 0;                                           // nothing
    return Math.max(0, Math.floor(n * tuningNow().scale * g.payoutMult));           // same expression order as the server
  }

  function LumiCap(game) { return gameOf(game).dailyCap; }                          // daily prize cap (0 = none)
  function LumiGameOn(game) { return gameOf(game).enabled; }                        // is the game open?

  var api = { LumiPrice: LumiPrice, LumiPayout: LumiPayout, LumiCap: LumiCap, LumiGameOn: LumiGameOn }; // the exports
  if (typeof module === "object" && module.exports) module.exports = api;           // Node (tests)
  if (root) { root.LumiPrice = LumiPrice; root.LumiPayout = LumiPayout; root.LumiCap = LumiCap; root.LumiGameOn = LumiGameOn; } // browser globals
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
