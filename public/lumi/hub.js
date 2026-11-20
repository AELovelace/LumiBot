/* LumiBot: the Lumi-Town hub's small bits of life (no inline script, so CSP script-src 'self' holds). */
(function () {
  "use strict";
  document.querySelectorAll(".hub-glow[data-colour]").forEach(function (el) { // her own colour, when she has one
    var c = el.getAttribute("data-colour");                                    // e.g. "#ff88cc"
    if (/^#[0-9a-f]{6}$/i.test(c || "")) el.style.color = c;                   // only a real hex colour
  });
  function refreshCoins() { // keep the SGC number current while the hub is open
    fetch((window.LUMI_API || "/lumipet/api/") + "coins", { credentials: "same-origin", cache: "no-store" }) // GET /lumipet/api/coins
      .then(function (r) { return r.ok ? r.json() : null; })                   // ignore failures
      .then(function (d) { var el = document.getElementById("hub-coins"); if (d && el) el.textContent = Number(d.coins || 0).toLocaleString("en-US"); }) // show it
      .catch(function () { /* the balance is a nicety */ });
  }
  setInterval(function () { if (!document.hidden) refreshCoins(); }, 30000); // every 30 s while visible
})();
