'use strict';

/**
 * Lumi-Town on Discord: the /lumi-pet command and its buttons (docs/plans/lumi-town-discord.md §4, phase D1).
 *
 *   /lumi-pet status            her card with care buttons + feed/play menus (only you see it)
 *   /lumi-pet show              her card for everyone in the channel, no buttons
 *   /lumi-pet feed item:<…>     feed her from the pantry; something you don't have asks to buy one first
 *
 * Buttons and menus (customId 'lumipet:<verb>:<owner id>[:…]'):
 *   care:<owner>:cuddle|nap|wake     quick care
 *   refresh:<owner>                  redraw the card (also "Never mind" on a purchase question)
 *   feed:<owner>                     the feed menu (value = item id)
 *   play:<owner>                     the play menu (value = toy id)
 *   bf:<owner>:<item>:<offer id>     ✅ on "Buy 1 … and feed her?": buy + feed in ONE transaction, run once per offer
 *
 * Rules (§2 of the plan): every pet change goes through pet/actions.js runPetAction with the shared money lock
 * (lock: true) and a run-once key; only club members (discord/member.js); only the owner presses their buttons;
 * prices come from tuning, exactly like the website. Checking her card counts as a visit for reminders (seen = now),
 * but it never claims the website's daily visit reward.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseCustomId } = require('./ids');                                           // button ids (no require loop)
const view = require('./view');                                                       // shared answer/draw helpers
const card = require('./card');
const prefs = require('./prefs');                                                     // reminders / timezone / news choices
const reminders = require('./reminders');                                             // test DM when reminders go on
const { nowMs } = require('../db');
const lumipet = require('../pet/lumipet');
const save = require('../pet/save');
const { runPetAction } = require('../pet/actions');
const { isLumiError } = require('../errors');
const { logger } = require('../../logger');

const COMMAND = 'lumi-pet';                    // the slash command's name
const OFFER_MS = 60_000;                       // a "buy and feed?" question lasts one minute
const DISCORD_EPOCH = 1_420_070_400_000n;      // ms: the start of Discord's snowflake clock
const EPHEMERAL = MessageFlags.Ephemeral;      // "only you can see this"

// ------------------------------------------------------------------------------------------------ the command

/** /lumi-pet and its subcommands (added to the global member list through discord/index.js). */
function commandData() {
  return new SlashCommandBuilder()
    .setName(COMMAND)
    .setDescription('Look after your Lumi from Discord')
    .addSubcommand((sub) => sub.setName('status').setDescription('See your Lumi and care for her (only you see it)'))
    .addSubcommand((sub) => sub.setName('show').setDescription('Show your Lumi to everyone here'))
    .addSubcommand((sub) => sub.setName('feed').setDescription('Feed your Lumi')
      .addStringOption((opt) => opt.setName('item').setDescription('What to feed her').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName('reminders').setDescription('Lumi DMs you when she needs you (at most every 3 h, never at night)')
      .addStringOption((opt) => opt.setName('turn').setDescription('On or off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
    .addSubcommand((sub) => sub.setName('timezone').setDescription('Your timezone, so Lumi stays quiet 22:00-07:00 your time')
      .addStringOption((opt) => opt.setName('zone').setDescription('e.g. Europe/London (start typing)').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName('news').setDescription('Whether Lumi-Town news may name you (big wins, showdowns)')
      .addStringOption((opt) => opt.setName('name').setDescription('Show or hide your name').setRequired(true)
        .addChoices({ name: 'show my name', value: 'show' }, { name: 'hide my name', value: 'hide' })));
}

// Every timezone Node knows, for /lumi-pet timezone suggestions (IANA names like 'Europe/London').
const ZONES = (() => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC']; } // old Node: a few
})();

// ------------------------------------------------------------------------------------------------ helpers
// (shared with reminders.js and news.js: discord/view.js)
const {
  playerOf, priceOf, viewOf, readSnap, answer, sayPrivately, letIn, ownerOnly, noPetMessage,
} = view;

/** Turn an error into words for the card (or rethrow a real bug). */
function wordsFor(error) {
  if (isLumiError(error)) {
    if (error.code === 'already_done') return 'That was already done. ✨';             // a double click
    return error.message;                                                              // her words / not enough SGC / busy
  }
  if (error && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED')) return 'Lumi-Town is busy for a moment. Please try again.'; // retryable
  if (error && error.code === 'insufficient_funds') return `You need ${error.need} SGC for that, but you have ${error.have}.`; // raw store refusal
  throw error;                                                                         // a bug: discord/index.js says sorry
}

/**
 * Run care through runPetAction (shared lock, run-once key) and redraw the card with what happened.
 * steps: one { action, item } or a list (buy + feed). say(result) -> the success words.
 */
async function careAndShow(interaction, owner, steps, onceRef, say) {
  let snap;                                                                            // what to draw
  let notice;                                                                          // what to say
  try {
    snap = runPetAction(owner.id, owner.name, steps, { onceRef, lock: true });         // the one door for pet changes
    notice = { ok: true, text: say(snap) };                                            // it worked
  } catch (error) {
    notice = { ok: false, text: wordsFor(error) };                                     // she said no (or no coins / busy)
    snap = readSnap(owner.id);                                                         // draw her as she is
  }
  return answer(interaction, card.buildPetCard(viewOf(owner, snap, { notice })));      // the card, redrawn
}

/** The display name of an item ('🍪 Cookie'), or its id. */
function itemLabel(itemId) {
  const item = save.ITEMS[itemId];                                                  // catalog entry
  return item ? `${item.icon} ${item.name}` : String(itemId);                          // pretty or raw
}

/** Her name, for the notice lines. */
const petName = (snap) => String((snap.pet && snap.pet.name) || 'Lumi');

// ------------------------------------------------------------------------------------------------ feeding

/**
 * They picked a food (menu or /lumi-pet feed). Free food and food in the pantry: feed now. Food to buy: ask first
 * (the question carries this interaction's id as the offer, so ✅ can only ever buy once).
 */
async function chooseFood(interaction, owner, itemId) {
  const item = save.ITEMS[itemId];                                                  // what they picked
  if (!item || !['snacks', 'treats'].includes(item.kind)) {                            // not food (or made up)
    const snap = readSnap(owner.id);
    return answer(interaction, card.buildPetCard(viewOf(owner, snap, { notice: { ok: false, text: 'Choose something from the pantry.' } })));
  }
  const held = ((save.peek(owner.id) || {}).inventory || {})[itemId] || 0;             // how many they have
  if (!item.price || held > 0) {                                                       // free or already bought: just feed
    return careAndShow(interaction, owner, { action: 'feed', item: itemId }, `lumi-discord:${interaction.id}`,
      (snap) => `${petName(snap)} ate the ${itemLabel(itemId)}! 😋`);
  }
  const snap = readSnap(owner.id);                                                     // her (and their coins) now
  const price = priceOf(itemId, item.price);                                           // what one costs
  if (snap.coins < price) {                                                            // can't afford it: say so now
    return answer(interaction, card.buildPetCard(viewOf(owner, snap, { notice: { ok: false, text: `A ${itemLabel(itemId)} costs ${price.toLocaleString('en-US')} SGC, but you have ${Number(snap.coins).toLocaleString('en-US')}.` } })));
  }
  return answer(interaction, card.buildConfirm(viewOf(owner, snap), { itemId, price, offerId: String(interaction.id) })); // ask first
}

/** When a Discord id (snowflake) was made, in ms. */
function snowflakeTime(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);                                  // the top bits are the time
}

/** ✅ on a buy-and-feed question. */
async function confirmBuyAndFeed(interaction, owner, itemId, offerId) {
  if (!/^\d{15,20}$/u.test(String(offerId || '')) || nowMs() - snowflakeTime(offerId) > OFFER_MS) { // a bad or stale offer
    const snap = readSnap(owner.id);
    return answer(interaction, card.buildPetCard(viewOf(owner, snap, { notice: { ok: false, text: 'That offer ran out. Pick the snack again if you still want it.' } })));
  }
  return careAndShow(interaction, owner,
    [{ action: 'buy', item: itemId, count: 1 }, { action: 'feed', item: itemId }],    // both, or neither
    `lumi-discord:offer:${offerId}`,                                                    // once per question, however many clicks
    (snap) => `You bought a ${itemLabel(itemId)} for ${Number(snap.paid || 0).toLocaleString('en-US')} SGC and ${petName(snap)} ate it! 😋`);
}

// ------------------------------------------------------------------------------------------------ handlers

/** /lumi-pet reminders | timezone | news: their own choices (no pet needed to change them). */
async function onChoice(interaction, owner, sub) {
  if (sub === 'reminders') {
    const on = interaction.options.getString('turn', true) === 'on';                   // on / off
    if (!on) {
      prefs.setRemind(owner.id, false);                                                // off
      await sayPrivately(interaction, 'Okay! Lumi won’t DM you any more. 🔕 Turn it back on with `/lumi-pet reminders turn:on`.');
      return;
    }
    await interaction.deferReply({ flags: EPHEMERAL });                                // the test DM can take a moment
    const result = await reminders.enable(interaction.client, owner.id);               // on + a test DM
    await interaction.editReply({ content: result.text });                             // what happened
  } else if (sub === 'timezone') {
    const zone = String(interaction.options.getString('zone', true) || '').trim();     // what they picked/typed
    if (!prefs.validTz(zone)) {
      await sayPrivately(interaction, `I don't know the timezone “${zone.slice(0, 64)}”. Start typing a city, like *London* or *New_York*, and pick one from the list.`);
      return;
    }
    prefs.setTz(owner.id, zone);                                                       // stored
    await sayPrivately(interaction, `Got it! Your clock is **${zone}** (it's ${reminders.localTime(zone, nowMs())} there). Lumi stays quiet 22:00–07:00 your time. 🌙`);
  } else if (sub === 'news') {
    const hide = interaction.options.getString('name', true) === 'hide';               // show / hide
    prefs.setNewsHidden(owner.id, hide);                                               // stored
    await sayPrivately(interaction, hide ? 'Okay! Lumi-Town news will call you “a Lumi-Town neighbour”. 🤫' : 'Okay! Lumi-Town news may name you. ✨');
  }
}

/** /lumi-pet <sub> */
async function onCommand(interaction) {
  if (!(await letIn(interaction))) return;                                             // closed / not a member
  const owner = playerOf(interaction);                                                 // who
  const sub = interaction.options.getSubcommand();                                     // which one
  if (['reminders', 'timezone', 'news'].includes(sub)) {                               // settings: no pet needed
    await onChoice(interaction, owner, sub);
    return;
  }
  if (!save.exists(owner.id)) {                                                        // never met her: don't create one here
    await sayPrivately(interaction, noPetMessage());
    return;
  }
  if (sub === 'status') {
    await answer(interaction, card.buildPetCard(viewOf(owner, readSnap(owner.id))));  // private card + buttons
  } else if (sub === 'show') {
    await answer(interaction, card.buildPetCard(viewOf(owner, readSnap(owner.id), { share: true })), { ephemeral: false }); // for everyone
  } else if (sub === 'feed') {
    await chooseFood(interaction, owner, interaction.options.getString('item', true)); // feed (or ask to buy)
  } else {
    await sayPrivately(interaction, 'Lumi doesn’t know that one yet.');                // a subcommand from a newer build
  }
}

/** Timezone suggestions: IANA names containing what they typed ('lond' -> Europe/London). */
function zoneChoices(typed) {
  const want = typed.replace(/\s+/gu, '_');                                            // 'new york' -> 'new_york'
  const hits = want ? ZONES.filter((z) => z.toLowerCase().includes(want)) : ['America/Los_Angeles', 'America/New_York', 'America/Chicago', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
  return hits.slice(0, card.MENU_MAX).map((z) => ({ name: z, value: z }));             // up to 25
}

/** Suggestions while typing: foods for /lumi-pet feed item:, zones for /lumi-pet timezone zone:. */
async function onAutocomplete(interaction) {
  const uid = String(interaction.user.id);                                             // who is typing
  const focused = interaction.options.getFocused(true) || {};                          // { name, value }
  const typed = String(focused.value || '').trim().toLowerCase();                      // what they typed so far
  let choices = [];
  try {
    if (focused.name === 'zone') {
      choices = zoneChoices(typed);                                                    // no pet needed
    } else {
      const pet = require('../index').isLumiReady() && save.exists(uid) ? save.peek(uid) : null; // read-only: typing never saves
      if (pet) {
        choices = card.feedChoices({ pet, catalog: lumipet.CATALOG }, priceOf)         // the menu's list
          .filter((c) => !typed || c.item.name.toLowerCase().includes(typed) || c.id.includes(typed)) // matches
          .map((c) => ({ name: `${c.label} — ${c.description}`.slice(0, 100), value: c.id }));
      }
    }
  } catch (error) {
    logger.warn(`Lumi Discord: suggestions failed (${error.message}).`);               // just no suggestions
  }
  await interaction.respond(choices.slice(0, card.MENU_MAX));                          // up to 25
}

/** Buttons and menus: lumipet:<verb>:<owner>:… */
async function onComponent(interaction, args) {
  const [ownerId, ...rest] = args;                                                     // whose card
  if (!(await ownerOnly(interaction, ownerId))) return;                                // someone else's buttons
  if (!(await letIn(interaction))) return;                                             // closed / not a member
  const owner = playerOf(interaction);                                                 // who
  if (!save.exists(owner.id)) { await sayPrivately(interaction, noPetMessage()); return; } // (a save that vanished)
  const verb = parseCustomId(interaction.customId).verb;                               // what they pressed
  const once = `lumi-discord:${interaction.id}`;                                       // a retried interaction runs once

  if (verb === 'refresh') {
    await answer(interaction, card.buildPetCard(viewOf(owner, readSnap(owner.id))));
  } else if (verb === 'care') {
    const action = rest[0];                                                            // cuddle / nap / wake
    const words = {
      cuddle: (s) => `You cuddled ${petName(s)} 💞`,
      nap: (s) => `${petName(s)} curled up for a nap 💤`,
      wake: (s) => `${petName(s)} is awake ☀️`,
    };
    if (!words[action]) { await sayPrivately(interaction, 'Lumi doesn’t know that one.'); return; } // a made-up button
    await careAndShow(interaction, owner, { action }, once, words[action]);
  } else if (verb === 'feed') {
    await chooseFood(interaction, owner, String((interaction.values || [])[0] || ''));  // the picked food
  } else if (verb === 'play') {
    const toy = String((interaction.values || [])[0] || '');                           // the picked toy
    await careAndShow(interaction, owner, { action: 'play', item: toy }, once, (s) => `${petName(s)} is playing with the ${itemLabel(toy)}! 🎾`);
  } else if (verb === 'bf') {
    await confirmBuyAndFeed(interaction, owner, rest[0], rest[1]);                     // ✅ buy & feed
  }
}

/** Plug /lumi-pet into the Discord side. discord/index.js calls this once and passes itself in (no require loop). */
function register(discord) {
  discord.registerHandler({
    command: { name: COMMAND, data: commandData() },                                   // /lumi-pet
    verbs: ['care', 'refresh', 'feed', 'play', 'bf'],                                  // its buttons and menus
    onCommand, onAutocomplete, onComponent,
  });
}

module.exports = {
  register,          // plug in
  commandData,       // the slash command
  snowflakeTime,     // tests
  OFFER_MS,          // 60 s
  COMMAND,           // 'lumi-pet'
};
