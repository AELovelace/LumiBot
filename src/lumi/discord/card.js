'use strict';

/**
 * Lumi-Town on Discord: Lumi's menu screens (docs/plans/lumi-town-discord.md §4). Like the Touhou trader's menu, ONE
 * private message is redrawn through every screen; each screen has 🔙 Back.
 *
 * Pure: it turns a lumipet snapshot into Discord messages ({ embeds, components, files }) and never touches the
 * database or Discord. view.js gathers the facts (snapshot, flat, prices, links, her picture); command.js sends them.
 *
 *   buildPetCard(view)            🏠 Home: her picture, needs, what she's doing, coins + flat, and the menu buttons
 *                                 (view.share: the public "show my friends" card: a big picture, no buttons)
 *   buildFeed(view)               🍓 Feed: the pantry, free food, and food to buy (asks first)
 *   buildPlay(view)               🎾 Play: her toys
 *   buildShop(view)               🛒 Shop: snacks, treats and toys to buy (asks first)
 *   buildSettings(view, prefs, clock)  ⚙️ Settings: DM reminders, her timezone, her name in news
 *   buildConfirm(view, offer)     "Buy 1 Cookie for 8 SGC (and feed her)?" ✅ / ✖
 *   moodLine / meterLine / feedChoices / playChoices / shopChoices   the pieces (exported for tests)
 *
 * view = {
 *   snap          lumipet.state()/act() answer: { pet, coins, now, catalog }
 *   owner         { id, name }        whose Lumi (buttons carry this id; only they may press)
 *   flat          'Lumi Heights 2D' or null
 *   visitWaiting  true when today's website visit reward hasn't been claimed
 *   share         true: the public show-off card
 *   notice        { ok, text } or null   what just happened (or why not)
 *   links         { page, thumb }     absolute URLs or null (links.js)
 *   files         [AttachmentBuilder] her picture as 'lumi.png' (empty when the renderer is off)
 *   priceOf       (itemId, native) -> SGC (tuning.scalePrice('pet', ...), passed in to keep this pure)
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
const PICTURE = 'attachment://lumi.png'; // her picture, attached to the message (portrait.js)
const METERS = [                         // the three needs, in the order the website shows them
  ['hunger', '🍓', 'Hunger'],
  ['energy', '⚡', 'Energy'],
  ['joy', '💖', 'Joy'],
];

// ------------------------------------------------------------------------------------------------ small pieces

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

/** Her name, markdown-safe. */
const nameOf = (pet) => escapeMarkdown(String((pet && pet.name) || 'Lumi'));

/** One line about how she feels: napping, the lowest low need, or content. */
function moodLine(pet, now) {
  const name = nameOf(pet);                                                            // her name
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
    const hit = (list || []).find((item) => item.id === id);                           // look on each shelf
    if (hit) return hit;
  }
  return null;                                                                         // unknown
}

/** Is this food free (always in the pantry)? */
const isFreeFood = (item) => !item.price;

/** Is this toy free (in every toy box)? Same rule as lumipet.act 'play'. */
const isFreeToy = (item) => !item.price && !('rarity' in item);

/** '1,234 SGC' */
const sgcText = (n) => `${Number(n || 0).toLocaleString('en-US')} SGC`;

// ------------------------------------------------------------------------------------------------ choices

/**
 * The feed menu: food she has (held), then free food, then food to buy.
 * Each: { id, item, label, description, buy } (buy: true = needs SGC first).
 */
function feedChoices(snap, priceOf) {
  const held = snap.pet.inventory || {};                                               // pantry counts
  const foods = [...(snap.catalog.snacks || []), ...(snap.catalog.treats || [])];      // everything edible
  const have = foods.filter((f) => f.price && (held[f.id] || 0) > 0)                   // bought and waiting
    .map((f) => ({ id: f.id, item: f, label: `${f.icon} ${f.name}`, description: `${held[f.id]} in the pantry`, buy: false }));
  const free = foods.filter(isFreeFood)                                                // always there
    .map((f) => ({ id: f.id, item: f, label: `${f.icon} ${f.name}`, description: 'Free, always in the pantry', buy: false }));
  const shop = foods.filter((f) => f.price && !((held[f.id] || 0) > 0))                // not in the pantry: buy one
    .map((f) => ({ id: f.id, item: f, label: `${f.icon} ${f.name}`, description: `Buy 1 for ${sgcText(priceOf(f.id, f.price))} and feed her`, buy: true }));
  return [...have, ...free, ...shop].slice(0, MENU_MAX);                               // Discord's cap
}

/** The play menu: her own toys plus the free ones. */
function playChoices(snap) {
  const owned = new Set(Array.isArray(snap.pet.toys) ? snap.pet.toys : []);           // her toy box
  return (snap.catalog.toys || [])
    .filter((t) => isFreeToy(t) || owned.has(t.id))                                    // ones she can play with
    .map((t) => ({ id: t.id, item: t, label: `${t.icon} ${t.name}`, description: `${t.minutes} min of play` }))
    .slice(0, MENU_MAX);                                                               // Discord's cap
}

/** The shop: snacks and treats (any number held), and toys she doesn't have yet (capsule-only toys aren't sold). */
function shopChoices(snap, priceOf) {
  const held = snap.pet.inventory || {};                                               // pantry counts
  const owned = new Set(Array.isArray(snap.pet.toys) ? snap.pet.toys : []);           // her toy box
  const food = [...(snap.catalog.snacks || []), ...(snap.catalog.treats || [])].filter((f) => f.price && (held[f.id] || 0) < lumipet.MAX_HELD)
    .map((f) => ({ id: f.id, item: f, label: `${f.icon} ${f.name}`, description: `${sgcText(priceOf(f.id, f.price))} · ${held[f.id] || 0} in the pantry` }));
  const toys = (snap.catalog.toys || []).filter((t) => t.price && !('rarity' in t) && !owned.has(t.id))
    .map((t) => ({ id: t.id, item: t, label: `${t.icon} ${t.name}`, description: `${sgcText(priceOf(t.id, t.price))} · a toy for her box` }));
  return [...food, ...toys].slice(0, MENU_MAX);                                        // Discord's cap
}

// ------------------------------------------------------------------------------------------------ the embed

/** Her colour for the embed's side stripe. */
function colourOf(pet) {
  return /^#[0-9a-f]{6}$/iu.test(String(pet.colour || '')) ? parseInt(pet.colour.slice(1), 16) : (GLOW_COLOURS[pet.glow] || GLOW_COLOURS.rose); // her own, or her glow's
}

/** The card: her name, mood, needs, what she's doing, coins and flat, and her picture. */
function buildEmbed(view, { line } = {}) {
  const { snap, owner, flat, visitWaiting, notice, links, share } = view;
  const pet = snap.pet;                                                                // her save
  const description = [line || moodLine(pet, snap.now)];                               // how she feels (or the screen's question)
  if (notice && notice.text) description.push('', `${notice.ok ? '✅' : '⚠️'} ${notice.text}`); // what just happened
  const footer = [];
  if (!share) footer.push(`🪙 ${sgcText(snap.coins)}`);                                // their balance (not for everyone)
  if (flat) footer.push(`🏢 ${flat}`);                                                 // their flat
  if (visitWaiting && !share) footer.push('🎁 daily visit waiting on the website');    // the website's reward
  const embed = new EmbedBuilder()
    .setColor(colourOf(pet))
    .setAuthor({ name: `${owner.name}'s Lumi`.slice(0, 256) })
    .setTitle(`🌙 ${nameOf(pet)}`.slice(0, 256))
    .setDescription(description.join('\n').slice(0, 4096))
    .addFields({ name: 'Needs', value: METERS.map(([key, icon, label]) => meterLine(icon, label, pet[key])).join('\n') });
  if (!share) {
    embed.addFields(
      { name: 'Right now', value: nowLines(pet, snap.now, snap.catalog).join('\n'), inline: true },
      { name: 'Happy moments', value: `✨ ${Number(pet.moments || 0).toLocaleString('en-US')}`, inline: true },
    );
  }
  if (footer.length) embed.setFooter({ text: footer.join(' · ').slice(0, 2048) });
  embed.setTimestamp(snap.now);
  if (links && links.page) embed.setURL(links.page);                                   // the title opens her page
  const picture = view.files && view.files.length ? PICTURE : (links && links.thumb) || null; // her own picture, or the icon
  if (picture && share) embed.setImage(picture);                                       // big, to show her off
  else if (picture) embed.setThumbnail(picture);                                       // small, beside her needs
  return embed;
}

/** A message: the embed, the rows, and her picture file. */
function message(view, embed, rows) {
  return { embeds: [embed], components: rows, files: view.files || [] };
}

/** 🔙 Back (to Home), plus any extra buttons. */
function backRow(view, ...extra) {
  return new ActionRowBuilder().addComponents(
    ...extra,
    new ButtonBuilder().setCustomId(customId('refresh', view.owner.id)).setLabel('Back').setEmoji('🔙').setStyle(ButtonStyle.Secondary),
  );
}

/** A select menu row. */
function selectRow(id, placeholder, choices) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder)
      .addOptions(choices.map((c) => ({ label: c.label.slice(0, 100), description: c.description.slice(0, 100), value: c.id }))),
  );
}

// ------------------------------------------------------------------------------------------------ screens

/** 🏠 Home: the card and the menu (or, with view.share, the public show-off card). */
function buildPetCard(view) {
  const embed = buildEmbed(view);
  if (view.share) return message(view, embed, []);                                    // look, don't touch
  const { snap, owner, links } = view;
  const pet = snap.pet;
  const napping = (pet.task && pet.task.kind === 'nap') || (pet.rest === 'nap' && pet.restUntil > snap.now); // asleep?
  const care = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId('care', owner.id, 'cuddle')).setLabel('Cuddle').setEmoji('💞').setStyle(ButtonStyle.Primary),
    napping
      ? new ButtonBuilder().setCustomId(customId('care', owner.id, 'wake')).setLabel('Wake').setEmoji('☀️').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId(customId('care', owner.id, 'nap')).setLabel('Nap').setEmoji('😴').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(pet.task)), // can't nap mid-play
    new ButtonBuilder().setCustomId(customId('nav', owner.id, 'feed')).setLabel('Feed').setEmoji('🍓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(customId('nav', owner.id, 'play')).setLabel('Play').setEmoji('🎾').setStyle(ButtonStyle.Success).setDisabled(Boolean(pet.task)), // one thing at a time
    new ButtonBuilder().setCustomId(customId('nav', owner.id, 'shop')).setLabel('Shop').setEmoji('🛒').setStyle(ButtonStyle.Secondary),
  );
  const more = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId('show', owner.id)).setLabel('Show my friends').setEmoji('📣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(customId('nav', owner.id, 'settings')).setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId('refresh', owner.id)).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );
  if (links && links.page) more.addComponents(new ButtonBuilder().setLabel('Visit Lumi').setEmoji('🏠').setStyle(ButtonStyle.Link).setURL(links.page)); // the website
  return message(view, embed, [care, more]);
}

/** 🍓 Feed: what she has, what's free, what can be bought (buying asks first). */
function buildFeed(view) {
  const choices = feedChoices(view.snap, view.priceOf);                                // what she could eat
  const embed = buildEmbed(view, { line: `🍓 What should ${nameOf(view.snap.pet)} eat? Food you don't have yet asks before buying.` });
  return message(view, embed, [selectRow(customId('feed', view.owner.id), '🍓 Pick something to eat…', choices), backRow(view)]);
}

/** 🎾 Play: her toys (none while she's busy). */
function buildPlay(view) {
  const choices = view.snap.pet.task ? [] : playChoices(view.snap);                   // one thing at a time
  if (!choices.length) {
    const why = view.snap.pet.task ? `${nameOf(view.snap.pet)} is busy right now. Try again when she's done!` : 'No toys yet! The 🛒 Shop has some.';
    return message(view, buildEmbed(view, { line: `🎾 ${why}` }), [backRow(view)]);
  }
  const embed = buildEmbed(view, { line: `🎾 What should ${nameOf(view.snap.pet)} play with?` });
  return message(view, embed, [selectRow(customId('play', view.owner.id), '🎾 Pick a toy…', choices), backRow(view)]);
}

/** 🛒 Shop: snacks, treats and toys (buying asks first). */
function buildShop(view) {
  const choices = shopChoices(view.snap, view.priceOf);                                // what's for sale
  const embed = buildEmbed(view, { line: '🛒 The Snack Stand and the toy shop. Pick something and I\'ll ask before buying. Food goes to her pantry, toys to her toy box.' });
  if (!choices.length) return message(view, embed, [backRow(view)]);                  // nothing left to buy
  return message(view, embed, [selectRow(customId('buy', view.owner.id), '🛒 Pick something to buy…', choices), backRow(view)]);
}

/**
 * ⚙️ Settings. prefs = discord/prefs.get(uid); clock = { tz, time } (their zone and the time there now).
 */
function buildSettings(view, prefs, clock) {
  const { owner } = view;
  const embed = new EmbedBuilder()
    .setColor(colourOf(view.snap.pet))
    .setAuthor({ name: `${owner.name}'s Lumi`.slice(0, 256) })
    .setTitle('⚙️ Settings')
    .setDescription([
      view.notice && view.notice.text ? `${view.notice.ok ? '✅' : '⚠️'} ${view.notice.text}\n` : '',
      `🔔 **DM reminders:** ${prefs.remind ? 'on' : 'off'}`,
      '　Lumi DMs you when she needs you: at most every 3 hours, never 22:00–07:00 your time.',
      `🕐 **Your clock:** ${clock.tz} (it's ${clock.time} there)${prefs.tz ? '' : ' · Los Angeles until you set yours'}`,
      `📣 **Lumi-Town news:** ${prefs.newsHidden ? 'calls you “a Lumi-Town neighbour”' : 'may name you (big wins, showdowns)'}`,
    ].filter(Boolean).join('\n'));
  if (view.files && view.files.length) embed.setThumbnail(PICTURE);                    // her picture
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId('set', owner.id, 'remind')).setLabel(prefs.remind ? 'Turn reminders off' : 'Turn reminders on').setEmoji(prefs.remind ? '🔕' : '🔔').setStyle(prefs.remind ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(customId('tz', owner.id)).setLabel('Set my timezone').setEmoji('🕐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId('set', owner.id, 'news')).setLabel(prefs.newsHidden ? 'Show my name in news' : 'Hide my name in news').setEmoji(prefs.newsHidden ? '👀' : '🙈').setStyle(ButtonStyle.Secondary),
  );
  return message(view, embed, [row, backRow(view)]);
}

/**
 * "Buy 1 … for N SGC?" offer = { mode: 'bf' (buy and feed) | 'buy', itemId, price, offerId }.
 * ✅ carries the offer id (the run-once key, so a double click can't buy twice); ✖ goes back.
 */
function buildConfirm(view, offer) {
  const item = findItem(view.snap.catalog, offer.itemId);                              // what they picked
  const label = item ? `${item.icon} ${item.name}` : offer.itemId;                     // how it reads
  const feed = offer.mode !== 'buy';                                                   // buy-and-feed (default) or just buy
  const ask = `Buy 1 ${label} for **${sgcText(offer.price)}**${feed ? ' and feed her' : ''}? (this offer lasts a minute)`;
  const embed = buildEmbed({ ...view, notice: null }, { line: `🛒 ${ask}` });
  const yes = new ButtonBuilder().setCustomId(customId(feed ? 'bf' : 'by', view.owner.id, offer.itemId, offer.offerId))
    .setLabel(feed ? 'Buy & feed' : 'Buy').setEmoji('✅').setStyle(ButtonStyle.Success);
  const no = new ButtonBuilder().setCustomId(customId('nav', view.owner.id, feed ? 'feed' : 'shop')).setLabel('Never mind').setEmoji('✖️').setStyle(ButtonStyle.Secondary);
  return message(view, embed, [new ActionRowBuilder().addComponents(yes, no)]);
}

module.exports = {
  buildPetCard, buildFeed, buildPlay, buildShop, buildSettings, buildConfirm, // screens
  moodLine, meterLine, feedChoices, playChoices, shopChoices, findItem,        // pieces
  GLOW_COLOURS, MENU_MAX, PICTURE,
};
