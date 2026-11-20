/* LumiBot: turns the page shell's settings (<script type="application/json" id="lumi-boot">, written by
   src/lumi/pages.js) into the window.LUMI_* globals every Lumi script reads. Loaded in <head>, before any game
   script, and contains no secrets. No inline script is needed, so the page works under CSP script-src 'self'. */
(function () {
  "use strict";
  var boot = {};                                                                    // the settings, if they parse
  try { boot = JSON.parse(document.getElementById("lumi-boot").textContent || "{}"); } catch (e) { boot = {}; } // a broken tag: defaults
  window.LUMI_API = typeof boot.api === "string" ? boot.api : "/lumipet/api/";        // API base: fetch(LUMI_API + "lumi-pet/state")
  window.LUMI_STATIC = typeof boot.static === "string" ? boot.static : "/lumipet/static/"; // static files base
  window.LUMI_PAGES = typeof boot.pages === "string" ? boot.pages : "/lumipet/";      // page base: LUMI_PAGES + "lumi-town"
  window.LUMI_CASINO = typeof boot.casino === "string" ? boot.casino : "/games/";   // LumiBot's casino pages: LUMI_CASINO + "slots"
  window.LUMI_TUNING = boot.tuning && typeof boot.tuning === "object" ? boot.tuning : { scale: 0.2, itemScale: 1, games: {} }; // prices/prizes (lumi-tuning.js): play scale 0.2, item scale 1
  window.LUMI_USER = boot.user && typeof boot.user === "object" ? boot.user : null;   // { id, name } of the player
  window.LUMI_FLAGS = boot.flags && typeof boot.flags === "object" ? boot.flags : { tvPlay: false, whoPlays: false, retro: false }; // erinne's TV flags: always off here
})();
