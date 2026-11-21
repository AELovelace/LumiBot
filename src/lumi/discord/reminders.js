'use strict';

/**
 * Lumi-Town on Discord: opt-in DM reminders (docs/plans/lumi-town-discord.md §5, phase D2).
 * erinne's mnemerynne/lumipet.py sweep(), in JS, sending a Discord DM instead of a Web Push.
 *
 *   start(client) / stop()        the timer (every lumi.discord.remindIntervalMs, default 5 min)
 *   sweepOnce({ now, send })      check every opted-in player once; send(uid, message) -> 'sent' | 'blocked' | 'failed'
 *   enable(client, uid)           turn reminders on and send a hello DM (turns itself off if DMs are closed)
 *   sendDm(client, uid, message)  one DM; 'blocked' when Discord says it can't DM that user (50007)
 *   localHour / localTime / isQuiet   the player's own clock (their /lumi-pet timezone, else Los Angeles)
 *   register(discord)             the 🔕 "Stop reminders" button (lumipet:remind:<owner>:off)
 *
 * The rules, same as erinne:
 *   - only players who turned it on (lumi_discord_prefs.remind = 1) and who have a Lumi,
 *   - her needs are caught up WITHOUT counting as a visit (seen stays put),
 *   - each need episode (and each nap that finished while they were away, and each batch of ready slow flowers when
 *     garden reminders are on) is queued once in lumi_remind_events, and dropped if they looked or fed her first,
 *   - at most ONE DM per player per lumipet.REMIND_EVERY (3 h), naming the most urgent need (REMIND_ORDER),
 *   - none during their quiet hours (lumipet.QUIET, 22:00-07:00 on their clock),
 *   - the DB work happens in a transaction; the DM is sent outside it.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { customId } = require('./ids');
const prefs = require('./prefs');
const settings = require('./settings');
const view = require('./view');
const card = require('./card');
const links = require('./links');
const { tx, getDb, nowMs } = require('../db');
const sgc = require('../sgc');
const lumipet = require('../pet/lumipet');
const save = require('../pet/save');
const users = require('../users');
const { logger } = require('../../logger');

const BATCH = 100;                       // players per database batch
const MAX_BATCHES = 20;                  // batches per sweep (2,000 players), the rest next time
const CANNOT_DM = 50007;                 // Discord: "Cannot send messages to this user"
const WEEK_MS = 7 * 24 * 3_600_000;      // sent reminders are forgotten after a week
const LINES = {                          // what Lumi says, by need (her voice)
  hunger: "my tummy's rumbling… could you bring me a snack? 🍓",
  energy: "I'm so sleepy… a little nap would help. 😴",
  joy: 'I miss you… come and play with me? 💖',
  nap: 'I just woke up from a lovely nap! ☀️',
  garden: 'some flowers in the garden are ready to trim! 🌸',
};

let timer = null;                        // the next sweep
let running = false;                     // start() ran and stop() didn't
let inFlight = false;                    // a sweep is going right now
let sweepClient = null;                  // the bot, for DMs

// ------------------------------------------------------------------------------------------------ their clock

/** The hour (0-23) on their clock. tz null = Los Angeles. */
function localHour(tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || prefs.DEFAULT_TZ, hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now)); // their hour
  const hour = Number((parts.find((p) => p.type === 'hour') || {}).value);             // '0'..'23'
  return Number.isFinite(hour) ? hour % 24 : 0;                                         // never NaN
}

/** 'HH:MM' on their clock (for "it's 21:30 there"). */
function localTime(tz, now) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz || prefs.DEFAULT_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now)); // 24-hour
}

/** Is it night on their clock (22:00-07:00)? */
function isQuiet(tz, now) {
  const hour = localHour(tz, now);                                                      // their hour
  return hour >= lumipet.QUIET[0] || hour < lumipet.QUIET[1];                           // erinne's QUIET
}

// ------------------------------------------------------------------------------------------------ what's due

/** Slow flowers ready that they haven't looked at (a batch name), or null. Read-only: never advances the garden. */
function gardenReady(uid, now) {
  const garden = lumipet.sibling('garden');                                             // the garden module (null if absent)
  if (!garden || typeof garden.readySince !== 'function') return null;                  // no garden
  return garden.readySince(garden.current(uid, now), now);                              // erinne ready_since
}

/** The light snapshot the card needs (no garden/dungeon side effects). */
function lightSnap(uid, pet, now) {
  const meters = Object.fromEntries(Object.keys(lumipet.DECAY).map((m) => [m, Math.round(pet[m] * 10) / 10])); // like snapshot()
  return { pet: { ...pet, ...meters }, now, coins: sgc.balance(uid), catalog: lumipet.CATALOG }; // what card.js reads
}

/**
 * One player, in one transaction: catch her up (not a visit), queue new episodes, drop stale ones, prune old ones.
 * Returns { waiting: [kinds], recent: bool (a DM went out within REMIND_EVERY), snap }.
 */
function collect(uid, now) {
  return tx(() => {
    const db = getDb();                                                                 // economy DB
    const pet = lumipet.load(uid, now, { seen: false });                                // caught up, seen unchanged
    const current = lumipet.episodes(pet, now);                                         // { kind: episode }
    if (pet.garden_reminders !== false) {                                               // garden reminders on (default)
      const flowers = gardenReady(uid, now);                                            // a batch of slow flowers
      if (flowers) current.garden = flowers;
    }
    const insert = db.prepare('INSERT OR IGNORE INTO lumi_remind_events (user_id, kind, episode, created_at) VALUES (?, ?, ?, ?)');
    for (const [kind, episode] of Object.entries(current)) insert.run(uid, kind, episode, now); // queue (once per episode)
    const waiting = [];                                                                 // queued and still true
    const drop = db.prepare('DELETE FROM lumi_remind_events WHERE user_id = ? AND kind = ? AND episode = ?');
    for (const row of db.prepare('SELECT kind, episode FROM lumi_remind_events WHERE user_id = ? AND sent_at IS NULL').all(uid)) {
      if (current[row.kind] === row.episode) waiting.push(row.kind);                    // still news
      else drop.run(uid, row.kind, row.episode);                                        // fed or seen before we said anything
    }
    db.prepare('DELETE FROM lumi_remind_events WHERE user_id = ? AND sent_at < ?').run(uid, now - WEEK_MS); // tidy
    const recent = Boolean(db.prepare('SELECT 1 FROM lumi_remind_events WHERE user_id = ? AND sent_at > ?').get(uid, now - lumipet.REMIND_EVERY)); // one per 3 h
    return { waiting, recent, snap: lightSnap(uid, pet, now) };
  });
}

// ------------------------------------------------------------------------------------------------ messages

/** The 🔕 Stop reminders button. */
function stopButton(uid) {
  return new ButtonBuilder().setCustomId(customId('remind', uid, 'off')).setLabel('Stop reminders').setEmoji('🔕').setStyle(ButtonStyle.Secondary);
}

/** The reminder DM: her line on top, then her card (care buttons work from the DM), then Stop reminders. */
function buildReminder(uid, need, snap) {
  const owner = { id: String(uid), name: users.displayName(uid) };                     // whose Lumi
  const message = card.buildPetCard(view.viewOf(owner, snap));                         // the same card as /lumi-pet status
  const name = String((snap.pet && snap.pet.name) || 'Lumi');                          // her name
  return {
    content: `**${name}:** ${LINES[need] || LINES.joy}`,                                // her voice
    embeds: message.embeds,
    components: [...message.components, new ActionRowBuilder().addComponents(stopButton(uid))], // + Stop (max 5 rows)
  };
}

/** The hello DM sent when they turn reminders on. */
function helloMessage(uid) {
  const tz = prefs.get(uid).tz;                                                         // their clock (null = LA)
  const row = new ActionRowBuilder();
  const page = links.page('lumi-pet');                                                  // the website
  if (page) row.addComponents(new ButtonBuilder().setLabel('Visit Lumi').setEmoji('🏠').setStyle(ButtonStyle.Link).setURL(page));
  row.addComponents(stopButton(uid));
  return {
    content: [
      "Hi! It's Lumi 💜 I'll message you here when I need you:",
      'at most once every 3 hours, and never between 22:00 and 07:00 your time.',
      `Your clock: **${tz || prefs.DEFAULT_TZ}**${tz ? '' : ' (change it with `/lumi-pet timezone`)'}.`,
    ].join('\n'),
    components: [row],
  };
}

/** Send one DM. 'sent', 'blocked' (they don't take DMs from the bot), or 'failed' (try again later). */
async function sendDm(client, uid, message) {
  try {
    const user = await client.users.fetch(String(uid));                                 // the person
    await user.send(message);                                                           // their DMs
    return 'sent';
  } catch (error) {
    if (error && error.code === CANNOT_DM) return 'blocked';                            // DMs closed / no shared server
    logger.warn(`Lumi Discord: reminder DM to ${uid} failed (${error && error.message}).`); // Discord trouble
    return 'failed';
  }
}

/** Turn reminders on and say hello. Returns { ok, text } for whoever asked (Discord reply or the website). */
async function enable(client, uid) {
  prefs.setRemind(uid, true);                                                           // on (clears an old failure)
  const result = client ? await sendDm(client, uid, helloMessage(uid)) : 'failed';      // the hello DM
  if (result === 'blocked') {
    prefs.markDmFailed(uid);                                                            // off again: we can't reach them
    return { ok: false, text: "I couldn't DM you, so reminders are still off. Allow DMs from server members (Server ▸ Privacy Settings ▸ Direct Messages), then try again. 💜" };
  }
  if (result === 'failed') return { ok: true, text: "Reminders are on, but my hello DM didn't go through just now. I'll keep trying when Lumi needs you. 💜" };
  return { ok: true, text: 'Reminders are on! I sent you a hello DM. 💌' };
}

// ------------------------------------------------------------------------------------------------ the sweep

/** Check every opted-in player once (in batches). send(uid, message) -> 'sent' | 'blocked' | 'failed'. */
async function sweepOnce({ now = nowMs(), send } = {}) {
  const totals = { checked: 0, sent: 0, blocked: 0, failed: 0 };                         // what happened
  if (settings.remindPaused()) return totals;                                           // an admin paused them
  let after = '';                                                                       // the batch cursor
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const ids = prefs.remindBatch(after, BATCH);                                        // the next players
    for (const uid of ids) {
      totals.checked += 1;
      if (!save.exists(uid)) continue;                                                  // no Lumi: nothing to say (and none made)
      let got;
      try {
        got = collect(uid, now);                                                        // what's due
      } catch (error) {
        logger.warn(`Lumi Discord: reminder check for ${uid} failed (${error.message}).`); // skip this one
        continue;
      }
      if (!got.waiting.length || got.recent) continue;                                  // nothing new, or told lately
      if (isQuiet(prefs.get(uid).tz, now)) continue;                                    // night on their clock
      const need = lumipet.REMIND_ORDER.find((kind) => got.waiting.includes(kind));     // the most urgent
      const result = await send(uid, buildReminder(uid, need, got.snap));               // outside any transaction
      if (result === 'sent') {
        getDb().prepare('UPDATE lumi_remind_events SET sent_at = ? WHERE user_id = ? AND sent_at IS NULL').run(now, uid); // one DM covers everything waiting
        totals.sent += 1;
      } else if (result === 'blocked') {
        prefs.markDmFailed(uid);                                                        // they closed their DMs: off
        totals.blocked += 1;
      } else {
        totals.failed += 1;                                                             // queued: next time
      }
    }
    if (ids.length < BATCH) break;                                                      // that was everyone
    after = ids[ids.length - 1];                                                        // next batch
  }
  return totals;
}

/** Schedule the next sweep. */
function schedule() {
  if (!running) return;                                                                 // stopped
  timer = setTimeout(tick, settings.remindIntervalMs());                                // live interval from the panel
  if (timer.unref) timer.unref();                                                       // never keeps the process alive
}

/** One timer tick: sweep, then always schedule the next. */
async function tick() {
  if (inFlight) { schedule(); return; }                                                 // the last one is still going
  inFlight = true;
  try {
    const totals = await sweepOnce({ send: (uid, message) => sendDm(sweepClient, uid, message) }); // DMs through the bot
    if (totals.sent || totals.blocked) logger.info(`Lumi reminders: ${totals.sent} sent, ${totals.blocked} turned off (DMs closed), ${totals.checked} checked.`);
  } catch (error) {
    logger.error(`Lumi reminders sweep failed: ${error && (error.stack || error.message)}`); // a bug: try again next time
  } finally {
    inFlight = false;
    schedule();                                                                         // always the next one
  }
}

/** Start the timer (discord/index.js initLumiDiscord). */
function start(client) {
  sweepClient = client;                                                                 // for DMs
  if (running) return;                                                                  // already going
  running = true;
  schedule();                                                                           // first sweep after one interval
}

/** Stop the timer (shutdown). */
function stop() {
  running = false;
  if (timer) clearTimeout(timer);                                                       // cancel the next one
  timer = null;
}

/** The 🔕 button: turn reminders off (no membership check: turning things off always works). */
async function onComponent(interaction, args) {
  const [ownerId] = args;                                                               // whose
  if (!(await view.ownerOnly(interaction, ownerId))) return;                            // someone else's
  prefs.setRemind(ownerId, false);                                                      // off
  await interaction.update({
    content: '🔕 Okay, no more reminder DMs. Turn them back on with `/lumi-pet reminders turn:on` or in Lumi Pet\'s settings.',
    embeds: [], components: [],
  });
}

/** Plug the Stop button in (discord/index.js passes itself). */
function register(discord) {
  discord.registerHandler({ verbs: ['remind'], onComponent });                          // lumipet:remind:<owner>:off
}

module.exports = {
  start, stop, sweepOnce, enable, sendDm, buildReminder, helloMessage, register,
  localHour, localTime, isQuiet, LINES,
};
