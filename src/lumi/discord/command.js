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
const member = require('./member');
const links = require('./links');
const card = require('./card');
const { tx, getDb, dayKey, nowMs } = require('../db');
const lumipet = require('../pet/lumipet');
const save = require('../pet/save');
const { runPetAction } = require('../pet/actions');
const tuning = require('../tuning');
const users = require('../users');
const lumicity = require('../city/lumicity');
const { isLumiError } = require('../errors');
const { logger } = require('../../logger');

const COMMAND = 'lumi-pet';                    // the slash command's name
const OFFER_MS = 60_000;                       // a "buy and feed?" question lasts one minute
const DISCORD_EPOCH = 1_420_070_400_000n;      // ms: the start of Discord's snowflake clock
const EPHEMERAL = MessageFlags.Ephemeral;      // "only you can see this"
const THUMB = 'icons/lumi-192.png';            // her picture (public/lumi/icons; Discord can't show SVG)

// ------------------------------------------------------------------------------------------------ the command

/** /lumi-pet and its subcommands (added to the global member list through discord/index.js). */
function commandData() {
  return new SlashCommandBuilder()
    .setName(COMMAND)
    .setDescription('Look after your Lumi from Discord')
    .addSubcommand((sub) => sub.setName('status').setDescription('See your Lumi and care for her (only you see it)'))
    .addSubcommand((sub) => sub.setName('show').setDescription('Show your Lumi to everyone here'))
    .addSubcommand((sub) => sub.setName('feed').setDescription('Feed your Lumi')
      .addStringOption((opt) => opt.setName('item').setDescription('What to feed her').setRequired(true).setAutocomplete(true)));
}

// ------------------------------------------------------------------------------------------------ helpers

/** The player behind an interaction: { id, name } (name = Discord username, like the website's login). */
function playerOf(interaction) {
  const user = interaction.user;                                                       // who clicked
  const name = String(user.username || user.globalName || 'Someone');                  // the same name the website uses
  users.remember(user.id, name, user.avatar || '');                                    // keep their name fresh for other players
  return { id: String(user.id), name };                                                // what we pass around
}

/** What one item costs in SGC (the same rule as the website's charge). */
function priceOf(itemId, native) {
  return tuning.scalePrice('pet', itemId, native);                                     // item scale, overrides
}

/** 'Lumi Heights 2D' for a player who has a Lumi (numbers them on first use, like the website). */
function flatLabel(uid) {
  try {
    return `Lumi Heights ${lumicity.aptOfNumber(lumicity.flatNumber(uid)).label}`;     // e.g. Lumi Heights 2D
  } catch (error) {
    logger.warn(`Lumi Discord: no flat label for ${uid} (${error.message}).`);         // the card works without it
    return null;
  }
}

/** Has today's website visit reward not been claimed yet? (The card points to it; it never claims it.) */
function visitWaiting(uid) {
  return !getDb().prepare('SELECT 1 FROM lumi_coin_refs WHERE ref = ?').get(`lumi-pet:${uid}:${dayKey()}`); // routes/pet.js's ref
}

/** Everything card.js needs to draw her. snap = a lumipet snapshot (state() or an act() answer). */
function viewOf(owner, snap, { share = false, notice = null } = {}) {
  return {
    snap, owner, share, notice, priceOf,
    flat: flatLabel(owner.id),                                                         // her flat
    visitWaiting: visitWaiting(owner.id),                                              // the website's reward
    links: { page: links.page('lumi-pet'), thumb: links.staticFile(THUMB) },           // absolute URLs (or null)
  };
}

/** Read her now, caught up (marks a visit, like opening the website). */
function readSnap(uid) {
  return tx(() => lumipet.state(uid));                                                 // catch up + save
}

/** Reply to a slash command, or redraw the message a button/menu sits on. */
async function answer(interaction, message, { ephemeral = true } = {}) {
  if (interaction.isChatInputCommand()) {
    return interaction.reply(ephemeral ? { ...message, flags: EPHEMERAL } : message);  // a new message
  }
  return interaction.update(message);                                                  // the card redraws in place
}

/** A short private message (refusals that aren't about the card). */
function sayPrivately(interaction, content) {
  return interaction.reply({ content, flags: EPHEMERAL });                             // only them
}

/**
 * The door every command and button goes through: Lumi-Town must be open and the player must be a club member.
 * Answers the refusal itself and returns false; true means go ahead.
 */
async function letIn(interaction) {
  if (!require('../index').isLumiReady()) {                                            // Lumi-Town is closed (or still starting)
    await sayPrivately(interaction, 'Lumi-Town is closed right now. Please try again later. 🌙');
    return false;
  }
  let ok = false;
  try {
    ok = await member.isClubMember(interaction.client, interaction.user.id);          // same club as the website
  } catch (error) {
    logger.warn(`Lumi Discord: member check failed for ${interaction.user.id} (${error.message}).`);
    await sayPrivately(interaction, "I couldn't check that you're in the club just now. Please try again in a moment. 💜");
    return false;
  }
  if (!ok) await sayPrivately(interaction, 'Lumi-Town is for members of the club. 💜');
  return ok;
}

/** Someone who hasn't met Lumi yet: point them at the website (adoption happens there, with the intro). */
function noPetMessage() {
  const page = links.page('lumi-pet');                                                 // the website
  return `You haven't met Lumi yet! ${page ? `Say hello at ${page} 🌙` : 'Say hello on the Lumi-Town website. 🌙'}`;
}

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

/** /lumi-pet <sub> */
async function onCommand(interaction) {
  if (!(await letIn(interaction))) return;                                             // closed / not a member
  const owner = playerOf(interaction);                                                 // who
  const sub = interaction.options.getSubcommand();                                     // which one
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

/** Suggestions for /lumi-pet feed item: — the same list as the feed menu, filtered by what they typed. */
async function onAutocomplete(interaction) {
  const uid = String(interaction.user.id);                                             // who is typing
  let choices = [];
  try {
    const pet = require('../index').isLumiReady() && save.exists(uid) ? save.peek(uid) : null; // read-only: typing never saves
    if (pet) {
      const typed = String(interaction.options.getFocused() || '').trim().toLowerCase(); // what they typed so far
      choices = card.feedChoices({ pet, catalog: lumipet.CATALOG }, priceOf)           // the menu's list
        .filter((c) => !typed || c.item.name.toLowerCase().includes(typed) || c.id.includes(typed)) // matches
        .map((c) => ({ name: `${c.label} — ${c.description}`.slice(0, 100), value: c.id }));
    }
  } catch (error) {
    logger.warn(`Lumi Discord: feed suggestions failed (${error.message}).`);          // just no suggestions
  }
  await interaction.respond(choices.slice(0, card.MENU_MAX));                          // up to 25
}

/** Buttons and menus: lumipet:<verb>:<owner>:… */
async function onComponent(interaction, args) {
  const [ownerId, ...rest] = args;                                                     // whose card
  if (String(ownerId) !== String(interaction.user.id)) {                               // someone else's buttons
    await sayPrivately(interaction, "That's not your Lumi! Use `/lumi-pet status` to see yours. 💜");
    return;
  }
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
