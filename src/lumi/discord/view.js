'use strict';

/**
 * Lumi-Town on Discord: the shared helpers every piece uses to answer people and draw Lumi's card.
 * (command.js, reminders.js and news.js all use these; none of them requires another piece.)
 *
 *   playerOf(interaction)         -> { id, name } (and refreshes their name for other players)
 *   viewOf(owner, snap, opts)     -> what card.js needs (flat, links, prices, the website's visit reward)
 *   readSnap(uid)                 -> her snapshot, caught up (counts as a visit)
 *   answer(interaction, message)  reply to a command, or redraw the message a button sits on
 *   sayPrivately(interaction, t)  a short "only you" message
 *   letIn(interaction)            Lumi-Town open + club member? (answers the "no" itself)
 *   ownerOnly(interaction, owner) is it their own button? (answers the "no" itself)
 *   noPetMessage()                "You haven't met Lumi yet!" with the website link
 */

const { MessageFlags } = require('discord.js');
const member = require('./member');
const links = require('./links');
const portrait = require('./portrait');                                                // her picture as a PNG
const save = require('../pet/save');                                                   // save.look(uid)
const { tx, getDb, dayKey } = require('../db');
const lumipet = require('../pet/lumipet');
const tuning = require('../tuning');
const users = require('../users');
const lumicity = require('../city/lumicity');
const { logger } = require('../../logger');

const EPHEMERAL = MessageFlags.Ephemeral;      // "only you can see this"
const THUMB = 'icons/lumi-192.png';            // her picture (public/lumi/icons; Discord can't show SVG)

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

/** Her picture as an attachment ('lumi.png'), or [] when the renderer is off. Big for showing her off. */
function pictureFiles(uid, pet, { share = false } = {}) {
  const png = portrait.portrait(save.look(uid), { eyes: portrait.eyesFor(pet), size: share ? 512 : 256 }); // her look, her eyes
  return png ? [portrait.attachment(png)] : [];                                        // attachment://lumi.png
}

/** Everything card.js needs to draw her. snap = a lumipet snapshot (state() or an act() answer). */
function viewOf(owner, snap, { share = false, notice = null } = {}) {
  return {
    snap, owner, share, notice, priceOf,
    flat: flatLabel(owner.id),                                                         // her flat
    visitWaiting: visitWaiting(owner.id),                                              // the website's reward
    links: { page: links.page('lumi-pet'), thumb: links.staticFile(THUMB) },           // absolute URLs (or null)
    files: pictureFiles(owner.id, snap.pet, { share }),                                // her own picture
  };
}

/** Read her now, caught up (marks a visit, like opening the website). */
function readSnap(uid) {
  return tx(() => lumipet.state(uid));                                                 // catch up + save
}

/**
 * Reply to a slash command, or redraw the message a button/menu/pop-up sits on (editReply when already deferred).
 * A redraw with a new picture drops the old one (attachments: []), so the message never piles up images.
 */
async function answer(interaction, message, { ephemeral = true } = {}) {
  if (interaction.isChatInputCommand()) {
    return interaction.reply(ephemeral ? { ...message, flags: EPHEMERAL } : message);  // a new message
  }
  const payload = message.files && message.files.length ? { ...message, attachments: [] } : message; // replace, don't add
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload); // we said "working on it" first
  return interaction.update(payload);                                                  // the menu redraws in place
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

/** Is this their own button? Says "not your Lumi" and returns false when it isn't. */
async function ownerOnly(interaction, ownerId) {
  if (String(ownerId) === String(interaction.user.id)) return true;                    // theirs
  await sayPrivately(interaction, "That's not your Lumi! Use `/lumi-pet status` to see yours. 💜");
  return false;
}

/** Someone who hasn't met Lumi yet: point them at the website (adoption happens there, with the intro). */
function noPetMessage() {
  const page = links.page('lumi-pet');                                                 // the website
  return `You haven't met Lumi yet! ${page ? `Say hello at ${page} 🌙` : 'Say hello on the Lumi-Town website. 🌙'}`;
}

module.exports = {
  playerOf, priceOf, flatLabel, visitWaiting, viewOf, pictureFiles, readSnap, answer, sayPrivately, letIn, ownerOnly, noPetMessage,
  EPHEMERAL, THUMB,
};
