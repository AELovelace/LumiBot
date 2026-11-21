'use strict';

/**
 * Lumi-Town on Discord: the Lumi Pet card (docs/plans/lumi-town-discord.md §4).
 *
 * Pure: it turns a lumipet snapshot into a Discord message ({ embeds, components }) and never touches the database
 * or Discord. command.js gathers the facts (snapshot, flat, prices, links) and sends what this returns.
 *
 *   buildPetCard(view)             her card: needs as bars, what she's doing, coins + flat, care buttons + menus
 *   buildConfirm(view, offer)      the same card asking "Buy 1 Cookie for 8 SGC and feed her?" (✅ / ✖)
 *   moodLine(pet, now)             one line about how she feels
 *   meterLine(icon, label, value)  '🍓 Hunger ▰▰▰▰▰▰▱▱▱▱ **62**' (+ ⚠️ under LOW)
 *
 * view = {
 *   snap        lumipet.state()/act() answer: { pet, coins, now, catalog }
 *   owner       { id, name }                 whose Lumi (buttons carry this id; only they may press)
 *   flat        'Lumi Heights 2D' label or null
 *   visitWaiting  true when today's website visit reward hasn't been claimed
 *   share       true: a public show-off card with no buttons
 *   notice      { ok: bool, text } or null    what just happened (or why not)
 *   links       { page, thumb }              absolute URLs or null (links.js)
 *   priceOf     (itemId, native) -> SGC       tuning.scalePrice('pet', ...) (passed in to keep this pure)
 * }
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, escapeMarkdown,
} = require('discord.js');
const lumipet = require('../pet/lumipet');
const { customId } = require('./ids');                                                // button ids (no require loop)

// Her glow colours (public/lumi/lumi-pet/rules.js COLOURS, first shade of each).
const GLOW_COLOURS = {
  rose: 0xff8ecb, lagoon: 0x70ebea, starlight: 0xffdc83, zephyr: 0x8be9a8, wisp: 0xc9a8ff, umbra: 0x8f9bff,
};
const BAR_SEGMENTS = 10;                 // ▰ per 10 points
const MENU_MAX = 25;                     // Discord's limit on select-menu options
const METERS = [                         // the three needs, in the order the website shows them
  ['hunger', '🍓', 'Hunger'],
  ['energy', '⚡', 'Energy'],
  ['joy', '💖', 'Joy'],
];

/** Discord timestamp markup: <t:unix:R> shows "in 4 minutes" in each viewer's own language and clock. */
function relTime(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;                                             // relative time
}

/** '🍓 Hunger ▰▰▰▰▰▰▱▱▱▱ **62**' with ⚠️ when the need is low (under lumipet.LOW). */
function meterLine(icon, label, value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));                            // 0..100
  const full = Math.round(v / (100 / BAR_SEGMENTS));                                   // filled segments
  const bar = '▰'.repeat(full) + '▱'.repeat(BAR_SEGMENTS - full);                      // the bar
  return `${icon} ${label} ${bar} **${Math.round(v)}**${v < lumipet.LOW ? ' ⚠️' : ''}`; // the line
}

/** One line about how she feels: napping, the lowest low need, or content. */
function moodLine(pet, now) {
  const name = escapeMarkdown(String(pet.name || 'Lumi'));                             // her name, safe for markdown
  if (pet.task && pet.task.kind === 'nap') return `Shh… ${name} is napping 💤`;        // asleep
  const lows = METERS.filter(([key]) => (Number(pet[key]) || 0) < lumipet.LOW)        // needs under the line
    .sort((a, b) => pet[a[0]] - pet[b[0]]);                                            // lowest first
  if (lows.length) {
    const words = {
      hunger: `${name}'s tummy is rumbling… 🍓`,
      energy: `${name} can barely keep her eyes open… 😴`,
      joy: `${name} is feeling a little lonely… 💔`,
    };
    return words[lows[0][0]];                                                          // the most urgent
  }
  if (pet.task && pet.task.kind === 'play') return `${name} is busy playing! 🎾`;      // playing
  if (METERS.every(([key]) => (Number(pet[key]) || 0) >= 60)) return `${name} is glowing and happy to see you! 💜`; // all good
  return `${name} is doing okay. A little care would make her day ✨`;                 // in between
}

/** What she's doing right now, plus any cooldowns (a few short lines). */
function nowLines(pet, now, catalog) {
  const lines = [];
  const task = pet.task;                                                               // nap or play, or null
  if (task && task.kind === 'nap') lines.push(`😴 Napping, wakes ${relTime(task.finishesAt)}`);
  else if (task && task.kind === 'play') {
    const toy = findItem(catalog, task.item);                                          // which toy
    lines.push(`🎾 Playing with ${toy ? `${toy.icon} ${toy.name}` : 'a toy'}, done ${relTime(task.finishesAt)}`);
  } else if (pet.rest === 'nap' && pet.restUntil > now) lines.push(`😴 Dozing until ${relTime(pet.restUntil)}`);
  else lines.push('☀️ Awake');
  const cd = pet.cooldowns || {};                                                      // quick-care cooldowns
  if ((cd.feed || 0) > now) lines.push(`🍽️ Can eat again ${relTime(cd.feed)}`);
  if ((cd.cuddle || 0) > now) lines.push(`💞 Can cuddle again ${relTime(cd.cuddle)}`);
  return lines;
}

/** An item from the catalog (snacks, treats, toys) by id, or null. */
function findItem(catalog, id) {
  if (!id || !catalog) return null;                                                    // nothing asked
  for (const list of [catalog.snacks, catalog.treats, catalog.toys]) {
    const hit = (list || []).find((item) => item.id === id);                           // look in each shelf
    if (hit) return hit;
  }
  return null;                                                                         // unknown
}

/** Is this food free (always in the pantry)? */
const isFreeFood = (item) => !item.price;

/** Is this toy free (in every toy box)? Same rule as lumipet.act 'play'. */
const isFreeToy = (item) => !item.price && !('rarity' in item);

/**
 * The feed menu's choices: food she has (held), then free food, then food to buy.
 * Each: { id, item, label, description, buy } (buy: true = needs SGC first).
 */
function feedChoices(snap, priceOf) {
  const pet = snap.pet;                                                                // her save
  const held = pet.inventory || {};                                                    // pantry counts
  const foods = [...(snap.catalog.snacks || []), ...(snap.catalog.treats || [])];      // everything edible
  const have = foods.filter((f) => f.price && (held[f.id] || 0) > 0)                   // bought and waiting
    .map((f) => ({ id: f.id, item: f, label: `${f.icon} ${f.name}`, description: `${held[f.id]} in the pantry`, buy: false }));
  const free = foods.filter(isFreeFood)                                                // always there
    .map((f) => ({ id: f.id, item: f, label: `${f.icon} ${f.name}`, description: 'Free, always in the pantry', buy: false }));
  const shop = foods.filter((f) => f.price && !((held[f.id] || 0) > 0))                // not in the pantry: buy one
    .map((f) => ({ id: f.id, item: f, label: `${f.icon} ${f.name}`, description: `Buy 1 for ${priceOf(f.id, f.price).toLocaleString('en-US')} SGC and feed her`, buy: true }));
  return [...have, ...free, ...shop].slice(0, MENU_MAX);                               // Discord's cap
}

/** The play menu's choices: her own toys plus the free ones. */
function playChoices(snap) {
  const pet = snap.pet;                                                                // her save
  const owned = new Set(Array.isArray(pet.toys) ? pet.toys : []);                      // her toy box
  return (snap.catalog.toys || [])
    .filter((t) => isFreeToy(t) || owned.has(t.id))                                    // ones she can play with
    .map((t) => ({ id: t.id, item: t, label: `${t.icon} ${t.name}`, description: `${t.minutes} min of play` }))
    .slice(0, MENU_MAX);                                                               // Discord's cap
}

/** The embed: her name, mood, needs, what she's doing, coins and flat. */
function buildEmbed(view) {
  const { snap, owner, flat, visitWaiting, notice, links } = view;
  const pet = snap.pet;                                                                // her save
  const now = snap.now;                                                                // the server's clock
  const colour = /^#[0-9a-f]{6}$/iu.test(String(pet.colour || '')) ? parseInt(pet.colour.slice(1), 16) : (GLOW_COLOURS[pet.glow] || GLOW_COLOURS.rose); // her own colour, or her glow's
  const description = [moodLine(pet, now)];                                            // how she feels
  if (notice && notice.text) description.push('', `${notice.ok ? '✅' : '⚠️'} ${notice.text}`); // what just happened
  const footer = [`🪙 ${Number(snap.coins || 0).toLocaleString('en-US')} SGC`];        // their balance
  if (flat) footer.push(`🏢 ${flat}`);                                                 // their flat
  if (visitWaiting) footer.push('🎁 daily visit waiting on the website');              // the website's reward
  const embed = new EmbedBuilder()
    .setColor(colour)
    .setAuthor({ name: `${owner.name}'s Lumi`.slice(0, 256) })
    .setTitle(`🌙 ${escapeMarkdown(String(pet.name || 'Lumi'))}`.slice(0, 256))
    .setDescription(description.join('\n').slice(0, 4096))
    .addFields(
      { name: 'Needs', value: METERS.map(([key, icon, label]) => meterLine(icon, label, pet[key])).join('\n') },
      { name: 'Right now', value: nowLines(pet, now, snap.catalog).join('\n'), inline: true },
      { name: 'Happy moments', value: `✨ ${Number(pet.moments || 0).toLocaleString('en-US')}`, inline: true },
    )
    .setFooter({ text: footer.join(' · ').slice(0, 2048) })
    .setTimestamp(now);
  if (links && links.page) embed.setURL(links.page);                                   // the title opens her page
  if (links && links.thumb) embed.setThumbnail(links.thumb);                           // her picture
  return embed;
}

/** The care buttons (row 1). */
function careRow(view) {
  const { snap, owner, links } = view;
  const pet = snap.pet;
  const napping = (pet.task && pet.task.kind === 'nap') || (pet.rest === 'nap' && pet.restUntil > snap.now); // asleep?
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId('care', owner.id, 'cuddle')).setLabel('Cuddle').setEmoji('💞').setStyle(ButtonStyle.Primary),
    napping
      ? new ButtonBuilder().setCustomId(customId('care', owner.id, 'wake')).setLabel('Wake').setEmoji('☀️').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId(customId('care', owner.id, 'nap')).setLabel('Nap').setEmoji('😴').setStyle(ButtonStyle.Secondary)
        .setDisabled(Boolean(pet.task)),                                               // can't nap mid-play
    new ButtonBuilder().setCustomId(customId('refresh', owner.id)).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );
  if (links && links.page) row.addComponents(new ButtonBuilder().setLabel('Visit Lumi').setEmoji('🏠').setStyle(ButtonStyle.Link).setURL(links.page)); // the website
  return row;
}

/** The feed menu (row 2). */
function feedRow(view) {
  const choices = feedChoices(view.snap, view.priceOf);                                // what she could eat
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId('feed', view.owner.id))
      .setPlaceholder('🍓 Feed her…')
      .addOptions(choices.map((c) => ({ label: c.label.slice(0, 100), description: c.description.slice(0, 100), value: c.id }))),
  );
}

/** The play menu (row 3), or null when she's busy or has nothing to play with. */
function playRow(view) {
  if (view.snap.pet.task) return null;                                                 // one thing at a time
  const choices = playChoices(view.snap);                                              // her toys
  if (!choices.length) return null;                                                    // an empty menu isn't allowed
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId('play', view.owner.id))
      .setPlaceholder('🎾 Play with…')
      .addOptions(choices.map((c) => ({ label: c.label.slice(0, 100), description: c.description.slice(0, 100), value: c.id }))),
  );
}

/** Her card. A shared (public) card has no buttons; a private one has care buttons and the menus. */
function buildPetCard(view) {
  const embeds = [buildEmbed(view)];                                                   // the card
  if (view.share) return { embeds, components: [] };                                   // look, don't touch
  const components = [careRow(view), feedRow(view)];                                   // care + food
  const play = playRow(view);                                                          // toys, when free
  if (play) components.push(play);
  return { embeds, components };
}

/**
 * The same card asking to confirm a purchase. offer = { itemId, price, offerId }.
 * ✅ carries the offer id (the run-once key, so a double click can't buy twice); ✖ just redraws the card.
 */
function buildConfirm(view, offer) {
  const item = findItem(view.snap.catalog, offer.itemId);                              // what they picked
  const label = item ? `${item.icon} ${item.name}` : offer.itemId;                     // how it reads
  const ask = `Buy 1 ${label} for **${Number(offer.price).toLocaleString('en-US')} SGC** and feed her? (this offer lasts a minute)`;
  const embeds = [buildEmbed({ ...view, notice: null }).setDescription(`${moodLine(view.snap.pet, view.snap.now)}\n\n🛒 ${ask}`)]; // the question
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId('bf', view.owner.id, offer.itemId, offer.offerId)).setLabel('Buy & feed').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(customId('refresh', view.owner.id)).setLabel('Never mind').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  )];
  return { embeds, components };
}

module.exports = {
  buildPetCard,   // her card
  buildConfirm,   // the buy-and-feed question
  moodLine,       // how she feels
  meterLine,      // one need as a bar
  feedChoices,    // what the feed menu offers
  playChoices,    // what the play menu offers
  findItem,       // catalog lookup
  GLOW_COLOURS,   // glow -> embed colour
  MENU_MAX,       // 25
};
