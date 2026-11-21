// Lumi Pet as a Discord Activity: the entry page's script (src/lumi/routes/activity.js serves the page).
// Runs inside Discord's iframe. Steps (Discord's Activity guide):
//   1. DiscordSDK(clientId).ready()                       the Discord client is listening
//   2. commands.authorize({ scope: ["identify"] })        the player says yes (once) -> a one-time code
//   3. POST /lumipet/api/activity/session { code }        the server checks the club and sets an iframe-safe cookie
//   4. commands.authenticate({ access_token })            tells Discord the Activity is signed in
//   5. go to Lumi's house (/lumipet/lumi-pet)              the normal Lumi Pet page, now inside Discord
// window.DiscordEmbedded comes from /lumipet/static/vendor/discord-embedded-app-sdk.js (npm run build:activity-sdk).
(function () {
  "use strict";
  const msg = document.getElementById("activity-msg");                       // the line under the moon
  const say = function (text) { if (msg) msg.textContent = text; };           // show progress / problems

  let cfg = null;                                                             // { clientId, base, next }
  try { cfg = JSON.parse(document.getElementById("lumi-activity").textContent); } catch (e) { cfg = null; }
  if (!cfg || !cfg.clientId) { say("The Activity isn't set up yet (no client id)."); return; }
  if (!window.DiscordEmbedded || !window.DiscordEmbedded.DiscordSDK) { say("Discord's SDK didn't load. Please reopen the Activity."); return; }

  async function start() {
    const sdk = new window.DiscordEmbedded.DiscordSDK(cfg.clientId);          // talks to the Discord client around us
    await sdk.ready();                                                        // 1
    say("Saying hello to Discord…");
    const auth = await sdk.commands.authorize({                               // 2
      client_id: cfg.clientId, response_type: "code", state: "", prompt: "none", scope: ["identify"],
    });
    say("Signing you in…");
    const response = await fetch(cfg.base + "/api/activity/session", {        // 3 (same origin through Discord's proxy)
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: auth.code }),
    });
    let data = {};
    try { data = await response.json(); } catch (e) { data = {}; }
    if (!response.ok) { say(data.error || data.detail || "Lumi couldn't sign you in. Please reopen the Activity."); return; }
    try { await sdk.commands.authenticate({ access_token: data.access_token }); } catch (e) { /* the game works without it */ } // 4
    say("Here she comes! 🌙");
    location.replace(data.next || cfg.next);                                  // 5
  }

  start().catch(function (error) { say("Lumi couldn't start inside Discord: " + (error && error.message ? error.message : "unknown problem") + ". Please reopen the Activity."); });
})();
