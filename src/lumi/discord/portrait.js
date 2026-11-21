'use strict';

/**
 * Lumi-Town on Discord: a picture of THEIR Lumi (her glow or her own colour, what she's wearing, her eyes), as a PNG.
 *
 * Her drawing is the arcade's (public/lumi/arcade/lumi-sprite.js svg(), the same Lumi as Lumi Pet, dressed by
 * public/lumi/lumi-pet/closet.js). Discord can't show SVG, so @resvg/resvg-js turns it into a PNG (prebuilt, no system
 * libraries). Her own colour (the website's RGB sliders) uses the website's own rule (lumi-pet/rules.js tint()).
 *
 *   portrait(look, { eyes, size })  -> PNG Buffer, or null if the renderer isn't available (cards then use the icon)
 *     look  save.look(uid): { glow, outfit, colour, name }
 *     eyes  'open' | 'closed' (napping) | 'happy'
 *     size  width in px (height follows her 400 x 380 drawing)
 *   eyesFor(pet)                    which eyes fit how she is right now
 *   attachment(png, name)           a discord.js AttachmentBuilder for it
 *
 * Pictures are cached by look + eyes + size (most players look the same for days).
 */

const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const { logger } = require('../../logger');

const PUBLIC = path.resolve(__dirname, '..', '..', '..', 'public', 'lumi');    // the website's own files
const CACHE_MAX = 300;                                                          // pictures kept in memory
const OWN = '__own';                                                            // a palette key for her own colour (never a real glow)

let parts = null;          // { sprite, rules, Resvg } once loaded (or false if they can't be)
const cache = new Map();   // key -> PNG Buffer

/**
 * Load the browser scripts (UMD: they export themselves under Node) and the renderer, once.
 * lumi-sprite.js finds the closet on its `self` root, so `self` is set ONLY for the moment of that require, then put
 * back, so nothing else in the bot ever sees a `self` global.
 */
function load() {
  if (parts !== null) return parts;                                                     // done before
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'self');                // was there one?
  const before = globalThis.self;
  try {
    const closet = require(path.join(PUBLIC, 'lumi-pet', 'closet.js'));                // what she can wear
    globalThis.self = { LumiPetCloset: closet };                                       // the root the sprite reads
    const sprite = require(path.join(PUBLIC, 'arcade', 'lumi-sprite.js'));            // her drawing
    const rules = require(path.join(PUBLIC, 'lumi-pet', 'rules.js'));                  // tint() for her own colour
    const { Resvg } = require('@resvg/resvg-js');                                       // SVG -> PNG
    parts = { sprite, rules, Resvg };
  } catch (error) {
    logger.warn(`Lumi portraits are off (${error.message}); cards will use the Lumi icon.`); // the cards still work
    parts = false;
  } finally {
    if (had) globalThis.self = before; else delete globalThis.self;                     // leave no trace
  }
  return parts;
}

/** Which eyes fit her now: closed while napping, happy when every need is good, open otherwise. */
function eyesFor(pet) {
  if (!pet) return 'open';
  if ((pet.task && pet.task.kind === 'nap') || pet.rest === 'nap') return 'closed';   // asleep
  if (['hunger', 'energy', 'joy'].every((m) => Number(pet[m]) >= 70)) return 'happy';  // content
  return 'open';
}

/** Her drawing as SVG text (her own colour swapped in when she has one). */
function svgFor(look, eyes) {
  const { sprite, rules } = parts;
  const own = look && look.colour ? rules.tint(look.colour) : null;                     // { glow, body, shadow } or null
  if (!own) return sprite.svg(look, eyes);                                              // her glow's colours
  sprite.PALETTES[OWN] = own;                                                           // a one-off palette...
  try {
    return sprite.svg({ ...look, glow: OWN }, eyes);                                    // ...used for this drawing
  } finally {
    delete sprite.PALETTES[OWN];                                                        // ...and gone again
  }
}

/** Her picture as a PNG (or null without a renderer). */
function portrait(look, { eyes = 'open', size = 256 } = {}) {
  if (!load()) return null;                                                             // no renderer: icon instead
  const width = Math.max(64, Math.min(1024, Math.round(size)));                         // sane sizes only
  const key = JSON.stringify([look && look.glow, look && look.colour, look && look.outfit, eyes, width]); // what makes it different
  if (cache.has(key)) return cache.get(key);                                            // drawn before
  try {
    const png = new parts.Resvg(svgFor(look || {}, eyes), { fitTo: { mode: 'width', value: width } }).render().asPng(); // draw
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);               // forget the oldest
    cache.set(key, png);
    return png;
  } catch (error) {
    logger.warn(`Lumi portrait failed (${error.message}).`);                            // a bad outfit piece, say
    return null;
  }
}

/** A Discord attachment for a picture ('lumi.png' unless named). */
function attachment(png, name = 'lumi.png') {
  return new AttachmentBuilder(png, { name, description: 'Lumi' });                     // attachment://lumi.png
}

module.exports = { portrait, eyesFor, attachment, svgFor: (look, eyes) => (load() ? svgFor(look, eyes) : null) };
