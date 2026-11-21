'use strict';

/**
 * Lumi-Town on Discord: news in each guild's Lumi-Town channel (docs/plans/lumi-town-discord.md §6, phase D3).
 *
 * Where: guildConfig `lumiTownChannelId`, set per guild on the web panel's Guilds page. No channel = no news there.
 * What (game code publishes on events.NEWS_CHANNEL; see src/lumi/events.js):
 *   'win'      a single prize of at least lumi.discord.newsBigWin SGC (kinds 'win' and 'betwin' only)
 *   'owed'     an owed prize the bank finally paid (same size rule)
 *   'showdown' a finished showdown with 2+ racers, and who won
 *   daily      at lumi.discord.newsDailyHour (Los Angeles), the Lumi-Town Bank summary and today's top 3 winners
 *
 * How:
 *   - events are published INSIDE game transactions, so each one carries a ref; before posting, the ref is checked
 *     in the database (a rolled-back prize never shows up as news),
 *   - news waits lumi.discord.newsBatchMs (2 min) and goes out as ONE post (at most 15 lines + "and N more"),
 *   - players with /lumi-pet news name:hide are "a Lumi-Town neighbour",
 *   - never anything from the admin log, never who owes what.
 *
 *   start(client) / stop()   listen + timers (discord/index.js)
 *   flush({ post })          post what's waiting now (tests pass a fake post)
 *   dailySummary(now)        the daily embed (or null when nothing happened)
 */

const { EmbedBuilder } = require('discord.js');
const settings = require('./settings');
const prefs = require('./prefs');
const events = require('../events');
const tuning = require('../tuning');
const treasury = require('../treasury');
const users = require('../users');
const { getDb, nowMs, dayKey } = require('../db');
const { getAllGuildConfigs } = require('../../guildConfig');
const { getSystemState, setSystemState } = require('../../sadgirlEconomyStore');
const { logger } = require('../../logger');

const PRIZE_KINDS = new Set(['win', 'betwin']);   // what counts as winning (not refunds, visits, buybacks, sales ...)
const MAX_LINES = 15;                             // one post shows at most this many lines
const DAILY_CHECK_MS = 10 * 60_000;               // look at the clock every 10 minutes for the daily summary
const DAILY_KEY = 'lumi.discord.newsDailyLast';   // system_state: the LA day the last summary went out
const COLOUR = 0xff8ecb;                          // Lumi's rose glow

let pending = [];          // events waiting for the next post
let batchTimer = null;     // the post waiting to go out
let dailyTimer = null;     // the daily-summary clock check
let unsubscribe = null;    // stop listening
let newsClient = null;     // the bot

// ------------------------------------------------------------------------------------------------ collecting

/** Is this event worth posting? (size and kind rules; cheap, runs inside the game's transaction) */
function worthIt(event, data) {
  if (!data || typeof data !== 'object') return false;                                  // junk
  if (event === 'showdown') return Number(data.racers) >= 2;                            // a real race
  if (event === 'win') return PRIZE_KINDS.has(data.kind) && Number(data.amount) >= settings.newsBigWin(); // a big prize
  if (event === 'owed') return Number(data.amount) >= settings.newsBigWin();            // a big prize, paid late
  return false;                                                                         // unknown kinds stay quiet
}

/** The event bus listener: keep it for the next batch (never throws into game code). */
function onNews({ event, data }) {
  try {
    if (!settings.newsEnabled() || !worthIt(event, data)) return;                       // switched off / too small
    pending.push({ event, data: { ...data } });                                         // a copy
    if (!batchTimer && newsClient) {                                                    // first one: post after the window
      batchTimer = setTimeout(() => { batchTimer = null; void flush().catch((e) => logger.warn(`Lumi news post failed: ${e.message}`)); }, settings.newsBatchMs());
      if (batchTimer.unref) batchTimer.unref();                                         // never keeps the process alive
    }
  } catch (error) {
    logger.warn(`Lumi news: could not queue ${event} (${error.message}).`);             // news must never break a game
  }
}

/** Did this event's transaction really commit? (its ref is in the database the way the event says) */
function committed({ event, data }) {
  const db = getDb();                                                                   // economy DB
  if (!data.ref) return false;                                                          // no proof: skip
  const row = db.prepare('SELECT amount FROM lumi_coin_refs WHERE ref = ?').get(String(data.ref)); // the prize's ref
  if (!row) return false;                                                               // rolled back
  if (event === 'win') return row.amount >= Number(data.amount);                        // paid that much
  if (event === 'owed') return !db.prepare('SELECT 1 FROM lumi_owed WHERE ref = ?').get(String(data.ref)); // no longer owed
  return true;                                                                          // showdown: the race settled
}

// ------------------------------------------------------------------------------------------------ writing

/** A game's display name ('Prism Drop'). */
function gameName(game) {
  const def = tuning.definedGames().find((g) => g.game === game);                       // the registry
  return def ? def.label : String(game);                                                // label or id
}

/** 1234 -> '1,234 SGC'. */
const sgcText = (n) => `${Number(n || 0).toLocaleString('en-US')} SGC`;

/** One line of news. who(uid) gives the (maybe hidden) name. */
function lineFor({ event, data }, who) {
  if (event === 'win') return `🏆 **${who(data.uid)}** won **${sgcText(data.amount)}** in ${gameName(data.game)}!`;
  if (event === 'owed') return `💸 Lumi-Town Bank paid **${who(data.uid)}** a **${sgcText(data.amount)}** ${gameName(data.game)} prize it owed.`;
  if (event === 'showdown') return `🏁 **${who(data.uid)}** won a ${gameName(data.game)} showdown against ${Number(data.racers) - 1} other racer${Number(data.racers) === 2 ? '' : 's'}!`;
  return null;                                                                          // unknown
}

/** A name for news: their display name, or "a Lumi-Town neighbour" if they asked to be hidden. Markdown-safe. */
function namer(uids) {
  const hidden = prefs.hiddenSet(uids);                                                 // who asked not to be named
  return (uid) => (hidden.has(String(uid)) ? 'a Lumi-Town neighbour' : users.displayName(uid).replace(/[*_~`|>\\]/gu, '')); // safe text
}

/** The news embed for these events (null when none survive the checks). */
function buildNews(items) {
  const real = items.filter((item) => { try { return committed(item); } catch { return false; } }); // committed only
  if (!real.length) return null;                                                        // nothing to say
  const who = namer(real.map((item) => item.data.uid));                                 // names (or hidden)
  const lines = real.map((item) => lineFor(item, who)).filter(Boolean);                 // one line each
  const shown = lines.slice(0, MAX_LINES);                                              // keep it short
  if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more!`);
  return new EmbedBuilder().setColor(COLOUR).setTitle('🌙 Lumi-Town news').setDescription(shown.join('\n')).setTimestamp(nowMs());
}

/** Every channel that wants Lumi-Town news. */
function newsChannels() {
  return [...new Set(getAllGuildConfigs().filter((cfg) => cfg.enabled && cfg.lumiTownChannelId).map((cfg) => cfg.lumiTownChannelId))]; // unique ids
}

/** Post one embed to every Lumi-Town channel (errors are logged per channel). */
async function postEverywhere(embed) {
  let posted = 0;
  for (const id of newsChannels()) {
    try {
      const channel = await newsClient.channels.fetch(id);                              // the channel
      if (channel && typeof channel.send === 'function') { await channel.send({ embeds: [embed] }); posted += 1; } // posted
    } catch (error) {
      logger.warn(`Lumi news: could not post in channel ${id} (${error.message}).`);    // wrong id / no permission
    }
  }
  return posted;
}

/** Post what's waiting now. opts.post(embed) replaces the real posting (tests). Returns the embed (or null). */
async function flush({ post = postEverywhere } = {}) {
  const items = pending;                                                                // take the batch
  pending = [];                                                                         // start a new one
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }                      // posting now
  const embed = buildNews(items);                                                       // checked + written
  if (embed) await post(embed);                                                         // out it goes
  return embed;
}

// ------------------------------------------------------------------------------------------------ the daily summary

/** The daily Lumi-Town Bank summary: bank, reserve, the last 24 h, and today's top 3 winners (LA day). */
function dailySummary(now = nowMs()) {
  const status = treasury.status();                                                     // the admin page's numbers
  const bank = status.accounts.find((a) => a.category === 'bank') || { balance: status.bank.balance, in24h: 0, out24h: 0 }; // Lumi-Town Bank
  const holdings = status.accounts.find((a) => a.category === 'holdings') || { balance: 0 }; // Lumi Holdings
  const day = dayKey(now - 12 * 3_600_000);                                             // "today" for a morning post = yesterday's play
  const top = getDb().prepare('SELECT user_id, SUM(earned) AS won FROM lumi_daily WHERE day = ? GROUP BY user_id ORDER BY won DESC LIMIT 3').all(day); // biggest winners
  const who = namer(top.map((row) => row.user_id));                                     // names (or hidden)
  const medals = ['🥇', '🥈', '🥉'];
  const lines = [
    `🏦 **Lumi-Town Bank:** ${sgcText(bank.balance)} (health ${Math.round(status.bank.health * 100)}%)`,
    `💎 **Lumi Holdings reserve:** ${sgcText(holdings.balance)}`,
    `📥 Swept in, last 24 h: ${sgcText(bank.in24h)} · 📤 Paid out: ${sgcText(bank.out24h)}`,
  ];
  if (top.length) lines.push('', `**Top winners (${day}):**`, ...top.map((row, i) => `${medals[i]} ${who(row.user_id)}: ${sgcText(row.won)}`)); // the podium
  return new EmbedBuilder().setColor(COLOUR).setTitle('🌅 Good morning, Lumi-Town!').setDescription(lines.join('\n')).setTimestamp(now);
}

/** The LA hour right now. */
function laHour(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
  return Number((parts.find((p) => p.type === 'hour') || {}).value) % 24;              // 0..23
}

/** Post the daily summary if it's time and it hasn't gone out today (remembered across restarts). */
async function maybeDaily({ now = nowMs(), post = postEverywhere } = {}) {
  const hour = settings.newsDailyHour();                                                // null = off
  if (!settings.newsEnabled() || hour === null || laHour(now) !== hour) return false;   // not now
  const today = dayKey(now);                                                            // LA day
  if (getSystemState(DAILY_KEY) === today) return false;                                // already posted
  setSystemState(DAILY_KEY, today);                                                     // claim today first (no double post)
  await post(dailySummary(now));                                                        // out it goes
  return true;
}

// ------------------------------------------------------------------------------------------------ start / stop

/** Listen for news and watch the clock (discord/index.js). */
function start(client) {
  newsClient = client;                                                                  // for posting
  if (!unsubscribe) unsubscribe = events.subscribe(events.NEWS_CHANNEL, onNews);        // hear the games
  if (!dailyTimer) {
    dailyTimer = setInterval(() => { void maybeDaily().catch((e) => logger.warn(`Lumi daily summary failed: ${e.message}`)); }, DAILY_CHECK_MS);
    if (dailyTimer.unref) dailyTimer.unref();                                           // never keeps the process alive
  }
}

/** Stop listening and drop anything waiting (shutdown). */
function stop() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }                               // deaf
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }                      // no post
  if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; }                     // no clock
  pending = [];                                                                         // forget the batch
  newsClient = null;
}

/** Tests: listen without a bot (nothing is posted until flush()). */
function listenForTests() {
  if (!unsubscribe) unsubscribe = events.subscribe(events.NEWS_CHANNEL, onNews);
}

module.exports = {
  start, stop, flush, dailySummary, maybeDaily, buildNews, worthIt, newsChannels, listenForTests,
  pendingCount: () => pending.length,
};
