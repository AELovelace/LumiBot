/* LumiBot: the SAME price/prize formula as src/lumi/tuning.js, so what a page shows is exactly what the server charges.
     LumiPrice(game, key, native)  = override for key, else 0 when native is 0, else max(1, round(native * bucketScale * priceMult))
     LumiPayout(game, key, native) = override for key, else max(0, floor(native * bucketScale * payoutMult))
   bucketScale comes from the KEY (Doll, 2026-11-19: items keep erinne's prices, play costs and prizes stay scaled together):
     play scale (LUMI_TUNING.scale, 0.2):    price keys entry / continue / bet, and every payout key but buyback / movein
     item scale (LUMI_TUNING.itemScale, 1):  every other price key (shop items, capsules, plots ...), payout keys buyback / movein
   game: the tuning id ('pet', 'prism', 'breakout', 'city' ...); key: the override key the server uses (usually the
   kind, e.g. 'entry'); native: erinne's own number. window.LUMI_TUNING comes from the page shell (lumi-boot.js).
   Also works under Node (module.exports) so tests can compare it with the server. */
(function (root) {
  "use strict";

  function tuningNow() { // the settings the page was served with
    var t = (root && root.LUMI_TUNING) || {};                                       // window.LUMI_TUNING
    return { scale: typeof t.scale === "number" ? t.scale : 0.2, itemScale: typeof t.itemScale === "number" ? t.itemScale : 1, games: t.games || {} }; // defaults like the server's (play 0.2, item 1)
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

  var PLAY_PRICE_KEYS = { entry: true, "continue": true, bet: true };              // price keys that are a go at a game (play scale); the rest are items
  var ITEM_PAYOUT_KEYS = { buyback: true, movein: true };                          // payout keys that give back an item's value (item scale); the rest are prizes

  function priceScale(key) { // the scale a price key uses (same rule as tuning.priceBucket)
    var t = tuningNow();                                                            // current knobs
    return has(PLAY_PRICE_KEYS, String(key)) ? t.scale : t.itemScale;               // play or item
  }

  function payoutScale(key) { // the scale a payout key uses (same rule as tuning.payoutBucket)
    var t = tuningNow();                                                            // current knobs
    return has(ITEM_PAYOUT_KEYS, String(key)) ? t.itemScale : t.scale;              // item or play
  }

  function has(map, key) { return key !== undefined && key !== null && Object.prototype.hasOwnProperty.call(map, key); } // own key only

  function LumiPrice(game, key, native) { // SGC a thing costs
    var g = gameOf(game), n = Number(native);                                       // knobs + the native number
    if (has(g.priceOverrides, key)) return g.priceOverrides[key];                   // exact override wins
    if (!isFinite(n) || n <= 0) return 0;                                           // free (or junk) stays 0
    return Math.max(1, Math.round(n * priceScale(key) * g.priceMult));              // same expression order as the server
  }

  function LumiPayout(game, key, native) { // SGC a prize pays
    var g = gameOf(game), n = Number(native);                                       // knobs + the native number
    if (has(g.payoutOverrides, key)) return g.payoutOverrides[key];                 // exact override wins
    if (!isFinite(n) || n <= 0) return 0;                                           // nothing
    return Math.max(0, Math.floor(n * payoutScale(key) * g.payoutMult));            // same expression order as the server
  }

  function LumiCap(game) { return gameOf(game).dailyCap; }                          // daily prize cap (0 = none)
  function LumiGameOn(game) { return gameOf(game).enabled; }                        // is the game open?

  var api = { LumiPrice: LumiPrice, LumiPayout: LumiPayout, LumiCap: LumiCap, LumiGameOn: LumiGameOn }; // the exports
  if (typeof module === "object" && module.exports) module.exports = api;           // Node (tests)
  if (root) { root.LumiPrice = LumiPrice; root.LumiPayout = LumiPayout; root.LumiCap = LumiCap; root.LumiGameOn = LumiGameOn; } // browser globals
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
