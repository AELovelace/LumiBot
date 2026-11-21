'use strict';

/**
 * Lumi-Town on Discord: /lumi-pet, Lumi's button menu (docs/plans/lumi-town-discord.md §4).
 *
 * Like the Touhou trader's menu: `/lumi-pet` opens ONE private message, and every button redraws it.
 *
 *   🏠 Home       her picture, needs, what she's doing · 💞 Cuddle · 😴 Nap/☀️ Wake · 🍓 Feed · 🎾 Play · 🛒 Shop
 *                 · 📣 Show my friends · ⚙️ Settings · 🔄 Refresh · 🏠 Visit Lumi (the website)
 *   🍓 Feed       pantry / free / buy-and-feed (asks first)          🎾 Play   her toys
 *   🛒 Shop       snacks, treats, toys (asks first)                   ⚙️ Settings  DM reminders, timezone (a pop-up), news name
 *   📣 Show my friends posts her card, with a big picture of her, in the channel for everyone.
 *
 * customIds ('lumipet:<verb>:<owner id>[:…]'):
 *   nav:<owner>:feed|play|shop|settings   go to a screen          refresh:<owner>             Home (also 🔙 Back)
 *   care:<owner>:cuddle|nap|wake          quick care              feed:<owner> / play:<owner> the Feed / Play menus
 *   buy:<owner>                           the Shop menu           bf / by:<owner>:<item>:<offer>  ✅ buy-and-feed / buy
 *   show:<owner>                          post the show-off card  set:<owner>:remind|news     Settings toggles
 *   tz:<owner>                            open the timezone pop-up  tzset:<owner>             the pop-up's answer
 *
 * Rules (§2 of the plan): every pet change goes through pet/actions.js runPetAction with the shared money lock
 * (lock: true) and a run-once key; only club members (discord/member.js); only the owner presses their buttons;
 * prices come from tuning, exactly like the website. Opening her card counts as a visit for reminders, but never
 * claims the website's daily visit reward. Nobody gets a Lumi made from Discord (adoption is on the website).
 */

const {
  SlashCommandBuilder, MessageFlags, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { parseCustomId, customId } = require('./ids');                                 // button ids (no require loop)
const view = require('./view');                                                       // shared answer/draw helpers
const card = require('./card');                                                       // the screens
const prefs = require('./prefs');                                                     // reminders / timezone / news choices
const reminders = require('./reminders');                                             // hello DM when reminders go on
const { nowMs } = require('../db');
const save = require('../pet/save');
const { runPetAction } = require('../pet/actions');
const { isLumiError } = require('../errors');
const { logger } = require('../../logger');

const {
  playerOf, priceOf, viewOf, readSnap, answer, sayPrivately, letIn, ownerOnly, noPetMessage,
} = view;

const COMMAND = 'lumi-pet';                    // the slash command's name
const OFFER_MS = 60_000;                       // a "buy …?" question lasts one minute
const DISCORD_EPOCH = 1_420_070_400_000n;      // ms: the start of Discord's snowflake clock
const EPHEMERAL = MessageFlags.Ephemeral;      // "only you can see this"

// Every timezone Node knows (IANA names like 'Europe/London'), for the timezone pop-up.
const ZONES = (() => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC']; } // old Node: a few
})();

// ------------------------------------------------------------------------------------------------ the command

/** /lumi-pet: no options, it opens the menu (added to the global member list through discord/index.js). */
function commandData() {
  return new SlashCommandBuilder()
    .setName(COMMAND)
    .setDescription("Open Lumi's menu: care for her, feed, play, shop, and show her to your friends");
}

// ------------------------------------------------------------------------------------------------ helpers

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

/** The display name of an item ('🍪 Cookie'), or its id. */
function itemLabel(itemId) {
  const item = save.ITEMS[itemId];                                                     // catalog entry
  return item ? `${item.icon} ${item.name}` : String(itemId);                          // pretty or raw
}

/** Her name, for the notice lines. */
const petName = (snap) => String((snap.pet && snap.pet.name) || 'Lumi');

/**
 * Run care through runPetAction (shared lock, run-once key) and redraw `screen` (default Home) with what happened.
 * steps: one { action, item } or a list (buy + feed). say(result) -> the success words.
 */
async function careAndShow(interaction, owner, steps, onceRef, say, screen = card.buildPetCard) {
  let snap;                                                                            // what to draw
  let notice;                                                                          // what to say
  try {
    snap = runPetAction(owner.id, owner.name, steps, { onceRef, lock: true });         // the one door for pet changes
    notice = { ok: true, text: say(snap) };                                            // it worked
  } catch (error) {
    notice = { ok: false, text: wordsFor(error) };                                     // she said no (or no coins / busy)
    snap = readSnap(owner.id);                                                         // draw her as she is
  }
  return answer(interaction, screen(viewOf(owner, snap, { notice })));                 // the screen, redrawn
}

/** Redraw a screen with a notice (no pet change). */
function showScreen(interaction, owner, screen, notice = null) {
  return answer(interaction, screen(viewOf(owner, readSnap(owner.id), { notice })));
}

/** Their clock for the Settings screen: { tz, time }. */
function clockOf(p) {
  const tz = p.tz || prefs.DEFAULT_TZ;                                                 // theirs, or Los Angeles
  return { tz, time: reminders.localTime(tz, nowMs()) };                               // e.g. 20:00
}

/** ⚙️ Settings, redrawn (with an optional notice). */
function showSettings(interaction, owner, notice = null) {
  const p = prefs.get(owner.id);                                                       // their choices
  return answer(interaction, card.buildSettings(viewOf(owner, readSnap(owner.id), { notice }), p, clockOf(p)));
}

/** When a Discord id (snowflake) was made, in ms. */
function snowflakeTime(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);                                  // the top bits are the time
}

/** Is this offer id real and less than a minute old? */
function offerFresh(offerId) {
  return /^\d{15,20}$/u.test(String(offerId || '')) && nowMs() - snowflakeTime(offerId) <= OFFER_MS;
}

/** 'London' / 'new york' / 'Europe/London' -> a real IANA zone, or null. */
function resolveZone(text) {
  const raw = String(text || '').trim();                                               // what they typed
  if (!raw) return null;
  if (prefs.validTz(raw)) return ZONES.find((z) => z.toLowerCase() === raw.toLowerCase()) || raw; // already a zone
  const want = raw.toLowerCase().replace(/\s+/gu, '_');                                // 'new york' -> 'new_york'
  const ends = ZONES.filter((z) => z.toLowerCase().endsWith(`/${want}`));             // 'London' -> 'Europe/London'
  if (ends.length === 1) return ends[0];
  const has = ZONES.filter((z) => z.toLowerCase().includes(want));                     // a part of one
  return has.length === 1 ? has[0] : null;                                             // only when it's clear
}

// ------------------------------------------------------------------------------------------------ feeding and buying

/**
 * They picked a food. Free food and food in the pantry: feed now. Food to buy: ask first (the question carries this
 * interaction's id as the offer, so ✅ can only ever buy once).
 */
async function chooseFood(interaction, owner, itemId) {
  const item = save.ITEMS[itemId];                                                     // what they picked
  if (!item || !['snacks', 'treats'].includes(item.kind)) {                            // not food (or made up)
    return showScreen(interaction, owner, card.buildFeed, { ok: false, text: 'Choose something from the pantry.' });
  }
  const held = ((save.peek(owner.id) || {}).inventory || {})[itemId] || 0;             // how many they have
  if (!item.price || held > 0) {                                                       // free or already bought: just feed
    return careAndShow(interaction, owner, { action: 'feed', item: itemId }, `lumi-discord:${interaction.id}`,
      (snap) => `${petName(snap)} ate the ${itemLabel(itemId)}! 😋`);
  }
  return askToBuy(interaction, owner, itemId, 'bf');                                   // buy one first?
}

/** "Buy 1 … for N SGC?" (mode 'bf' = and feed her, 'buy' = into the pantry / toy box). Says so if they can't afford it. */
async function askToBuy(interaction, owner, itemId, mode) {
  const item = save.ITEMS[itemId];                                                     // what they picked
  const back = mode === 'bf' ? card.buildFeed : card.buildShop;                        // where a "no" lands
  if (!item || !item.price || (mode === 'bf' && !['snacks', 'treats'].includes(item.kind))) {
    return showScreen(interaction, owner, back, { ok: false, text: "The shop doesn't sell that." });
  }
  const snap = readSnap(owner.id);                                                     // her (and their coins) now
  const price = priceOf(itemId, item.price);                                           // what one costs
  if (snap.coins < price) {                                                            // can't afford it: say so now
    return answer(interaction, back(viewOf(owner, snap, { notice: { ok: false, text: `A ${itemLabel(itemId)} costs ${price.toLocaleString('en-US')} SGC, but you have ${Number(snap.coins).toLocaleString('en-US')}.` } })));
  }
  return answer(interaction, card.buildConfirm(viewOf(owner, snap), { mode, itemId, price, offerId: String(interaction.id) })); // ask first
}

/** ✅ on a buy (-and-feed) question. */
async function confirmBuy(interaction, owner, itemId, offerId, mode) {
  const back = mode === 'bf' ? card.buildFeed : card.buildShop;                        // where a stale offer lands
  if (!offerFresh(offerId)) {
    return showScreen(interaction, owner, back, { ok: false, text: 'That offer ran out. Pick it again if you still want it.' });
  }
  if (mode === 'bf') {
    return careAndShow(interaction, owner,
      [{ action: 'buy', item: itemId, count: 1 }, { action: 'feed', item: itemId }],  // both, or neither
      `lumi-discord:offer:${offerId}`,                                                  // once per question, however many clicks
      (snap) => `You bought a ${itemLabel(itemId)} for ${Number(snap.paid || 0).toLocaleString('en-US')} SGC and ${petName(snap)} ate it! 😋`);
  }
  const toy = save.ITEMS[itemId] && save.ITEMS[itemId].kind === 'toys';                // where it goes
  return careAndShow(interaction, owner, { action: 'buy', item: itemId, count: 1 }, `lumi-discord:offer:${offerId}`,
    (snap) => `Bought a ${itemLabel(itemId)} for ${Number(((snap.said || {}).paid) || 0).toLocaleString('en-US')} SGC. It's in her ${toy ? 'toy box' : 'pantry'}! 🛍️`,
    card.buildShop);                                                                    // stay in the shop
}

// ------------------------------------------------------------------------------------------------ show my friends

/** 📣 Post her show-off card (a big picture of her) in the channel, and say so on the menu. */
async function showFriends(interaction, owner) {
  const snap = readSnap(owner.id);                                                     // her now
  const shared = card.buildPetCard(viewOf(owner, snap, { share: true }));             // the public card
  await answer(interaction, card.buildPetCard(viewOf(owner, snap, { notice: { ok: true, text: 'Shared! Everyone here can see her now. 📣' } }))); // the menu, with a note
  await interaction.followUp({ embeds: shared.embeds, files: shared.files });          // public (no ephemeral flag)
}

// ------------------------------------------------------------------------------------------------ settings

/** 🔔 / 📣 toggles. Turning reminders on sends a hello DM first, so the menu waits for it (deferUpdate). */
async function toggle(interaction, owner, what) {
  const p = prefs.get(owner.id);                                                       // current choices
  if (what === 'news') {
    prefs.setNewsHidden(owner.id, !p.newsHidden);                                      // flip
    return showSettings(interaction, owner, { ok: true, text: !p.newsHidden ? 'Lumi-Town news will call you “a Lumi-Town neighbour”. 🤫' : 'Lumi-Town news may name you again. ✨' });
  }
  if (what === 'remind') {
    if (p.remind) {
      prefs.setRemind(owner.id, false);                                                // off
      return showSettings(interaction, owner, { ok: true, text: 'Okay! Lumi won’t DM you any more. 🔕' });
    }
    await interaction.deferUpdate();                                                   // the hello DM can take a moment
    const result = await reminders.enable(interaction.client, owner.id);               // on + a hello DM
    return showSettings(interaction, owner, { ok: result.ok, text: result.text });
  }
  return sayPrivately(interaction, 'Lumi doesn’t know that one.');                     // a made-up button
}

/** 🕐 Open the timezone pop-up (a Discord modal). */
function askTimezone(interaction, owner) {
  const input = new TextInputBuilder().setCustomId('zone').setLabel('Your timezone (a city, e.g. London)')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64).setPlaceholder('Europe/London, New_York, Tokyo…');
  const current = prefs.get(owner.id).tz;                                              // what they chose before
  if (current) input.setValue(current);
  return interaction.showModal(new ModalBuilder().setCustomId(customId('tzset', owner.id)).setTitle('🕐 Your clock')
    .addComponents(new ActionRowBuilder().addComponents(input)));
}

/** The pop-up's answer: a city or zone name -> their clock. */
async function setTimezone(interaction, owner) {
  const typed = String(interaction.fields.getTextInputValue('zone') || '').trim();     // what they typed
  const zone = resolveZone(typed);                                                     // a real zone, or null
  if (!zone) return showSettings(interaction, owner, { ok: false, text: `I don't know “${typed.slice(0, 64)}”. Try a big city near you, like *London*, *New_York* or *Tokyo*, or a zone like *Europe/Berlin*.` });
  prefs.setTz(owner.id, zone);                                                         // stored
  return showSettings(interaction, owner, { ok: true, text: `Your clock is ${zone} now. Lumi stays quiet 22:00–07:00 there. 🌙` });
}

// ------------------------------------------------------------------------------------------------ handlers

/** /lumi-pet: open the menu on Home. */
async function onCommand(interaction) {
  if (!(await letIn(interaction))) return;                                             // closed / not a member
  const owner = playerOf(interaction);                                                 // who
  if (!save.exists(owner.id)) {                                                        // never met her: don't create one here
    await sayPrivately(interaction, noPetMessage());
    return;
  }
  await answer(interaction, card.buildPetCard(viewOf(owner, readSnap(owner.id))));    // 🏠 Home, only for them
}

const SCREENS = { feed: card.buildFeed, play: card.buildPlay, shop: card.buildShop }; // nav targets (settings has its own)

/** Buttons, menus and the pop-up: lumipet:<verb>:<owner>:… */
async function onComponent(interaction, args) {
  const [ownerId, ...rest] = args;                                                     // whose menu
  if (!(await ownerOnly(interaction, ownerId))) return;                                // someone else's buttons
  if (!(await letIn(interaction))) return;                                             // closed / not a member
  const owner = playerOf(interaction);                                                 // who
  if (!save.exists(owner.id)) { await sayPrivately(interaction, noPetMessage()); return; } // (a save that vanished)
  const verb = parseCustomId(interaction.customId).verb;                               // what they pressed
  const once = `lumi-discord:${interaction.id}`;                                       // a retried interaction runs once
  const picked = String((interaction.values || [])[0] || '');                          // a menu's choice

  if (verb === 'refresh') {
    await showScreen(interaction, owner, card.buildPetCard);                           // 🏠 Home (and 🔙 Back)
  } else if (verb === 'nav') {
    if (rest[0] === 'settings') await showSettings(interaction, owner);                // ⚙️
    else if (SCREENS[rest[0]]) await showScreen(interaction, owner, SCREENS[rest[0]]); // 🍓 🎾 🛒
    else await showScreen(interaction, owner, card.buildPetCard);                      // anything else: Home
  } else if (verb === 'care') {
    const words = {
      cuddle: (s) => `You cuddled ${petName(s)} 💞`,
      nap: (s) => `${petName(s)} curled up for a nap 💤`,
      wake: (s) => `${petName(s)} is awake ☀️`,
    };
    if (!words[rest[0]]) { await sayPrivately(interaction, 'Lumi doesn’t know that one.'); return; } // a made-up button
    await careAndShow(interaction, owner, { action: rest[0] }, once, words[rest[0]]);
  } else if (verb === 'feed') {
    await chooseFood(interaction, owner, picked);                                      // feed (or ask to buy)
  } else if (verb === 'play') {
    await careAndShow(interaction, owner, { action: 'play', item: picked }, once, (s) => `${petName(s)} is playing with the ${itemLabel(picked)}! 🎾`);
  } else if (verb === 'buy') {
    await askToBuy(interaction, owner, picked, 'buy');                                 // 🛒 ask first
  } else if (verb === 'bf' || verb === 'by') {
    await confirmBuy(interaction, owner, rest[0], rest[1], verb === 'bf' ? 'bf' : 'buy'); // ✅
  } else if (verb === 'show') {
    await showFriends(interaction, owner);                                             // 📣
  } else if (verb === 'set') {
    await toggle(interaction, owner, rest[0]);                                         // 🔔 / 📣 name
  } else if (verb === 'tz') {
    await askTimezone(interaction, owner);                                             // 🕐 pop-up
  } else if (verb === 'tzset') {
    await setTimezone(interaction, owner);                                             // the pop-up's answer
  }
}

/** Plug /lumi-pet into the Discord side. discord/index.js calls this once and passes itself in (no require loop). */
function register(discord) {
  discord.registerHandler({
    command: { name: COMMAND, data: commandData() },                                   // /lumi-pet
    verbs: ['care', 'refresh', 'nav', 'feed', 'play', 'buy', 'bf', 'by', 'show', 'set', 'tz', 'tzset'], // its buttons, menus and pop-up
    onCommand, onComponent,
  });
}

module.exports = {
  register,          // plug in
  commandData,       // the slash command
  snowflakeTime,     // tests
  resolveZone,       // tests
  OFFER_MS,          // 60 s
  COMMAND,           // 'lumi-pet'
};
