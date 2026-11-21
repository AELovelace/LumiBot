'use strict';

/**
 * Lumi Pet's own API (erinne mnemerynne/web/games.py: pet_visit, pet_state, pet_act, _named).
 *   POST /api/lumi-pet/visit   the first visit of the LA day pays a little SGC (pay 'pet','visit', ref lumi-pet:<uid>:<day>)
 *   GET  /api/lumi-pet/state   Lumi as she is now, caught up
 *   POST /api/lumi-pet/act     one care action or purchase (lumipet.act); a refusal is 400 and changes nothing
 *   POST /api/lumi-pet/discord Discord DM reminders on/off from Lumi Pet's settings ({ remind, tz }); state has `discord`
 * Fights, dungeon, garden and party routes belong to their own modules (they call lumipet.fightStart etc.).
 */

const { tx, dayKey } = require('../db');
const sgc = require('../sgc');
const lumipet = require('../pet/lumipet');
const { runPetAction, refusals, named, ACT_FORM } = require('../pet/actions');    // the one care/purchase entry (shared with Discord)
const { form } = require('../town/forms');                                          // body checks
const { LumiError } = require('../errors');

const PET_VISIT = 25;                                                               // erinne coins.PET_VISIT (native)

/** Her Discord settings for the page: { on, remind, tz } (on = the Discord side is running, so the row is shown). */
function discordView(uid) {
  const discord = require('../discord');                                            // lazy: the bot side may be off
  if (!discord.isEnabled()) return { on: false, remind: false, tz: null };          // switched off: no row
  const p = require('../discord/prefs').get(uid);                                   // their choices
  return { on: Boolean(discord.getClient()), remind: p.remind, tz: p.tz };          // what the settings row shows
}

/** Add the Lumi Pet routes (index.js calls this once). */
function register(router) {
  router.post('/api/lumi-pet/visit', (ctx) => tx(() => {                            // one transaction: ref + coins
    const uid = ctx.user.id;                                                        // Discord id
    const r = sgc.pay(uid, ctx.user.name, PET_VISIT, 'pet', 'visit', `lumi-pet:${uid}:${dayKey()}`); // once per LA day
    return { paid: r.paid, owed: r.owed, capped: r.capped, coins: sgc.balance(uid) }; // what the page shows
  }), { money: true });                                                             // one money action at a time

  router.get('/api/lumi-pet/state', (ctx) => ({ ...tx(() => named(lumipet.state(ctx.user.id))), discord: discordView(ctx.user.id) })); // read + catch up (saves), + her Discord settings

  // Lumi Pet's settings: "Discord DMs from Lumi" on/off (src/lumi/discord/reminders.js). Turning on sends a hello DM
  // through the bot; the browser's own timezone becomes their quiet-hours clock unless they already chose one.
  router.post('/api/lumi-pet/discord', async (ctx) => {
    const body = form(ctx.body, { remind: { type: 'bool' }, tz: { type: 'str', max: 64, nullable: true, default: null } }); // only these
    const uid = ctx.user.id;                                                        // Discord id
    const discord = require('../discord');                                          // the Discord side (lazy: no load loop)
    const prefs = require('../discord/prefs');                                      // their choices
    if (!body.remind) {
      prefs.setRemind(uid, false);                                                  // off always works
      return { discord: discordView(uid), said: 'Lumi won’t DM you any more.' };
    }
    if (!discord.isEnabled() || !discord.getClient()) throw new LumiError(503, 'discord_off', 'Lumi can’t reach Discord right now. Please try again later.'); // bot not running
    if (body.tz && prefs.validTz(body.tz) && !prefs.get(uid).tz) prefs.setTz(uid, body.tz); // the browser's clock, if they never picked one
    const result = await require('../discord/reminders').enable(discord.getClient(), uid); // on + the hello DM
    return { discord: discordView(uid), said: result.text };
  });

  router.post('/api/lumi-pet/act', (ctx) => runPetAction(ctx.user.id, ctx.user.name, ctx.body), { money: true }); // pet/actions.js; the router holds the money lock
}

module.exports = { register, refusals, named, ACT_FORM, PET_VISIT };
