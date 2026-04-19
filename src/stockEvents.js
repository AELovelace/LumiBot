/**
 * Stock Market Events — random negative events that affect stock prices.
 *
 * A pool of 30 event templates, each tagged with industry/sector keywords.
 * When an event fires, only stocks whose name or sector matches the event
 * keywords are affected.  An LLM-generated news story is created via the
 * Big Business Ollama endpoint (server-2) and posted to every guild's
 * Big Business channel so the market stays unified across discords.
 *
 * Impact mechanics:
 *   - Each event has a severity range (min/max demand_pressure penalty).
 *   - Affected stocks receive a negative demand_pressure nudge, then
 *     recalculatePrice() is called to propagate it naturally.
 *
 * Debug:
 *   /lumi-stocks event-debug   — rolls a random event, generates the story,
 *                                 and replies ephemerally WITHOUT touching
 *                                 any stock prices.
 */

const { logger } = require('./logger');
const { getAllStocks, recalculatePrice, getStockById } = require('./privateStockStore');
const { getAllGuildConfigs } = require('./guildConfig');
const { getChatbotPersona } = require('./config');

// Same endpoint used by Big Business for LLM generation
const EVENT_LLM_ENDPOINT = 'http://100.83.3.32:11434';
const EVENT_LLM_MODEL    = 'server-2';
const EVENT_LLM_TIMEOUT  = 30_000;

let discordClient = null;

// ---------------------------------------------------------------------------
// Event pool — 30 negative market events
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MarketEvent
 * @property {string}   id          – Unique slug for logging
 * @property {string}   headline    – Short headline template
 * @property {string[]} keywords    – Name / sector fragments that determine
 *                                    which stocks are susceptible.  Matched
 *                                    case-insensitively against the stock's
 *                                    business_name.
 * @property {number}   minSeverity – Min demand_pressure penalty (negative)
 * @property {number}   maxSeverity – Max demand_pressure penalty (negative)
 */

const EVENT_POOL = [
  // ---- Supply-chain / logistics ----
  {
    id: 'port-strike',
    headline: 'Major port strike disrupts global shipping lanes',
    keywords: ['logistics', 'exports', 'transit', 'shipping', 'driftwood'],
    minSeverity: -0.08,
    maxSeverity: -0.18,
  },
  {
    id: 'warehouse-fire',
    headline: 'Massive warehouse fire destroys inventory stockpiles',
    keywords: ['textiles', 'exports', 'brewing', 'garden', 'blossom'],
    minSeverity: -0.06,
    maxSeverity: -0.14,
  },
  {
    id: 'freight-derailment',
    headline: 'Freight train derailment halts rail corridor for weeks',
    keywords: ['transit', 'logistics', 'iron', 'ember', 'works'],
    minSeverity: -0.07,
    maxSeverity: -0.15,
  },

  // ---- Technology / cyber ----
  {
    id: 'data-breach',
    headline: 'Catastrophic data breach exposes millions of customer records',
    keywords: ['analytics', 'media', 'devices', 'signal', 'frequency', 'labs', 'neon'],
    minSeverity: -0.10,
    maxSeverity: -0.22,
  },
  {
    id: 'ai-hallucination-scandal',
    headline: 'AI product recalled after dangerous hallucination incidents',
    keywords: ['labs', 'analytics', 'devices', 'neon', 'tanuki'],
    minSeverity: -0.08,
    maxSeverity: -0.18,
  },
  {
    id: 'cloud-outage',
    headline: '72-hour cloud infrastructure outage impacts enterprise clients',
    keywords: ['analytics', 'media', 'devices', 'signal', 'deep', 'fog'],
    minSeverity: -0.07,
    maxSeverity: -0.16,
  },

  // ---- Regulatory / legal ----
  {
    id: 'antitrust-probe',
    headline: 'Federal antitrust investigation launched into market dominance',
    keywords: ['capital', 'ventures', 'holdings', 'partners', 'velvet', 'abyss'],
    minSeverity: -0.09,
    maxSeverity: -0.20,
  },
  {
    id: 'environmental-fine',
    headline: 'Record environmental fine levied for pollution violations',
    keywords: ['brewing', 'works', 'garden', 'iron', 'blossom', 'coral', 'dusk'],
    minSeverity: -0.06,
    maxSeverity: -0.14,
  },
  {
    id: 'tax-fraud-allegation',
    headline: 'CEO indicted on tax fraud and embezzlement charges',
    keywords: ['capital', 'ventures', 'press', 'holdings', 'partners', 'silver', 'rumor'],
    minSeverity: -0.12,
    maxSeverity: -0.25,
  },
  {
    id: 'ip-lawsuit',
    headline: 'Multi-billion-dollar intellectual property lawsuit filed',
    keywords: ['press', 'media', 'labs', 'vinyl', 'phantom', 'ghost'],
    minSeverity: -0.07,
    maxSeverity: -0.16,
  },

  // ---- Financial / economic ----
  {
    id: 'credit-downgrade',
    headline: 'Major credit agency downgrades corporate debt to junk status',
    keywords: ['capital', 'ventures', 'holdings', 'partners', 'velvet'],
    minSeverity: -0.10,
    maxSeverity: -0.22,
  },
  {
    id: 'interest-rate-hike',
    headline: 'Surprise interest rate hike crushes growth stock valuations',
    keywords: ['ventures', 'capital', 'labs', 'starfall', 'apothecary', 'neon'],
    minSeverity: -0.05,
    maxSeverity: -0.12,
  },
  {
    id: 'earnings-miss',
    headline: 'Quarterly earnings miss sends investors scrambling',
    keywords: ['inc', 'records', 'business', 'dogpunk', 'ramen', 'midnight'],
    minSeverity: -0.06,
    maxSeverity: -0.14,
  },
  {
    id: 'bond-default',
    headline: 'Corporate bond default triggers sector-wide panic',
    keywords: ['capital', 'holdings', 'partners', 'paper', 'lantern'],
    minSeverity: -0.11,
    maxSeverity: -0.24,
  },

  // ---- Consumer / PR ----
  {
    id: 'product-recall',
    headline: 'FDA orders emergency product recall over safety concerns',
    keywords: ['apothecary', 'brewing', 'ramen', 'garden', 'sunken', 'midnight'],
    minSeverity: -0.08,
    maxSeverity: -0.18,
  },
  {
    id: 'boycott-viral',
    headline: 'Viral boycott campaign tanks consumer sentiment overnight',
    keywords: ['press', 'media', 'textiles', 'vinyl', 'hollow', 'star'],
    minSeverity: -0.07,
    maxSeverity: -0.16,
  },
  {
    id: 'ceo-scandal',
    headline: 'CEO caught in personal scandal, board demands resignation',
    keywords: ['inc', 'records', 'business', 'rooftop', 'shrine', 'silver', 'rumor'],
    minSeverity: -0.09,
    maxSeverity: -0.20,
  },
  {
    id: 'influencer-expose',
    headline: 'Influencer exposé reveals sweatshop labor conditions',
    keywords: ['textiles', 'works', 'blossom', 'iron', 'hollow'],
    minSeverity: -0.08,
    maxSeverity: -0.17,
  },

  // ---- Natural disasters / force majeure ----
  {
    id: 'earthquake',
    headline: 'Major earthquake devastates primary production facilities',
    keywords: ['works', 'brewing', 'transit', 'garden', 'iron', 'blossom', 'sunken'],
    minSeverity: -0.09,
    maxSeverity: -0.20,
  },
  {
    id: 'hurricane',
    headline: 'Category 5 hurricane destroys coastal distribution network',
    keywords: ['exports', 'logistics', 'transit', 'coral', 'dusk', 'driftwood'],
    minSeverity: -0.10,
    maxSeverity: -0.22,
  },
  {
    id: 'wildfire',
    headline: 'Uncontrolled wildfire forces evacuation of corporate campus',
    keywords: ['labs', 'analytics', 'garden', 'ember', 'driftwood'],
    minSeverity: -0.07,
    maxSeverity: -0.15,
  },

  // ---- Industry-specific ----
  {
    id: 'contamination',
    headline: 'Contamination scare leads to mass product destruction',
    keywords: ['apothecary', 'brewing', 'ramen', 'garden', 'starfall'],
    minSeverity: -0.08,
    maxSeverity: -0.18,
  },
  {
    id: 'piracy-surge',
    headline: 'Piracy wave collapses digital media revenue projections',
    keywords: ['media', 'press', 'vinyl', 'records', 'phantom', 'ghost', 'frequency'],
    minSeverity: -0.07,
    maxSeverity: -0.16,
  },
  {
    id: 'raw-material-shortage',
    headline: 'Critical raw material shortage sends production costs soaring',
    keywords: ['works', 'textiles', 'brewing', 'iron', 'blossom', 'lantern', 'paper'],
    minSeverity: -0.06,
    maxSeverity: -0.14,
  },
  {
    id: 'union-strike',
    headline: 'Nationwide union strike paralyzes operations for major employers',
    keywords: ['works', 'transit', 'logistics', 'iron', 'sleepy', 'moth'],
    minSeverity: -0.07,
    maxSeverity: -0.15,
  },
  {
    id: 'espionage',
    headline: 'Corporate espionage ring uncovered, trade secrets compromised',
    keywords: ['labs', 'devices', 'analytics', 'signal', 'lost', 'neon', 'deep'],
    minSeverity: -0.09,
    maxSeverity: -0.20,
  },
  {
    id: 'currency-crisis',
    headline: 'Foreign currency collapse wipes out international revenue',
    keywords: ['exports', 'capital', 'ventures', 'coral', 'dusk', 'partners'],
    minSeverity: -0.08,
    maxSeverity: -0.18,
  },
  {
    id: 'supply-chain-hack',
    headline: 'Supply-chain malware attack compromises vendor network',
    keywords: ['devices', 'analytics', 'logistics', 'signal', 'lost', 'fog'],
    minSeverity: -0.09,
    maxSeverity: -0.20,
  },
  {
    id: 'pension-shortfall',
    headline: 'Pension fund shortfall triggers emergency capital allocation',
    keywords: ['holdings', 'capital', 'partners', 'rooftop', 'shrine', 'velvet'],
    minSeverity: -0.06,
    maxSeverity: -0.14,
  },
  {
    id: 'failed-merger',
    headline: 'Blockbuster merger collapses at the last minute',
    keywords: ['ventures', 'capital', 'holdings', 'paper', 'lantern', 'abyss'],
    minSeverity: -0.08,
    maxSeverity: -0.18,
  },
  {
    id: 'whistleblower',
    headline: 'Whistleblower report reveals systematic accounting fraud',
    keywords: ['inc', 'records', 'business', 'silver', 'rumor', 'press', 'ghost'],
    minSeverity: -0.11,
    maxSeverity: -0.24,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripThinkingTags(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .replace(/<\/?think>/giu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Pick a random element from an array.
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Random float in [min, max].
 */
function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Determine which listed stocks are affected by a given event.
 * Returns an array of stock rows.
 */
function findAffectedStocks(event) {
  const stocks = getAllStocks();
  const listed = stocks.filter((s) => s.is_listed && s.status === 'active');

  return listed.filter((stock) => {
    const name = String(stock.business_name || '').toLowerCase();
    return event.keywords.some((kw) => name.includes(kw.toLowerCase()));
  });
}

// ---------------------------------------------------------------------------
// LLM story generation
// ---------------------------------------------------------------------------

/**
 * Ask the server-2 Ollama endpoint to write a short news story explaining
 * why the affected stocks dropped.
 *
 * @param {MarketEvent} event
 * @param {Array}       affectedStocks
 * @returns {Promise<string>} The generated story (or fallback).
 */
async function generateEventStory(event, affectedStocks) {
  const tickerList = affectedStocks.map((s) => `${s.ticker} (${s.business_name})`).join(', ');

  const prompt = [
    `System: ${getChatbotPersona()}`,
    'System: You are a dramatic financial news anchor delivering a BREAKING NEWS segment for the LumiStocks exchange — a fictional stock market inside a Discord economy.',
    'System: Write 2-4 sentences. Be theatrical and sensational but keep it concise. Reference the affected tickers by name. Do not use emojis. Do not use think tags.',
    '',
    `BREAKING NEWS: ${event.headline}`,
    '',
    `Affected tickers: ${tickerList}`,
    '',
    'Deliver the breaking news report:',
  ].join('\n');

  try {
    const response = await fetch(`${EVENT_LLM_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EVENT_LLM_MODEL,
        stream: false,
        prompt,
      }),
      signal: AbortSignal.timeout(EVENT_LLM_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const completion = typeof payload.response === 'string' ? payload.response : '';
    const cleaned = stripThinkingTags(completion);
    if (cleaned) return cleaned;
  } catch (error) {
    logger.warn('Stock event LLM story generation failed, using fallback.', error.message);
  }

  // Deterministic fallback
  return `BREAKING: ${event.headline}. Tickers affected: ${tickerList}. Investors are advised to remain cautious.`;
}

// ---------------------------------------------------------------------------
// Price impact
// ---------------------------------------------------------------------------

/**
 * Apply a negative demand_pressure penalty to each affected stock,
 * then recalculate its price.
 *
 * @param {MarketEvent} event
 * @param {Array}       affectedStocks
 * @returns {Array<{ticker: string, oldPrice: number, newPrice: number, penalty: number}>}
 */
function applyEventImpact(event, affectedStocks) {
  const { getDb } = require('./privateStockStore');
  const db = getDb();
  const results = [];

  for (const stock of affectedStocks) {
    const fresh = getStockById(stock.id);
    if (!fresh) continue;

    const penalty = randBetween(event.minSeverity, event.maxSeverity);
    const currentPressure = Number(fresh.demand_pressure) || 0;
    const newPressure = Math.max(-0.45, currentPressure + penalty);

    db.prepare(`
      UPDATE bb_stocks
      SET demand_pressure = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newPressure, fresh.id);

    const oldPrice = Number(fresh.share_price) || 0;
    const newPrice = recalculatePrice(fresh.id, `Market event: ${event.id}`);

    results.push({
      ticker: fresh.ticker,
      businessName: fresh.business_name,
      oldPrice,
      newPrice: newPrice || oldPrice,
      penalty: Math.round(penalty * 1000) / 1000,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Discord posting
// ---------------------------------------------------------------------------

/**
 * Format the event + story + impact into a Discord embed-style message.
 */
function formatEventMessage(event, story, impactResults) {
  const lines = [
    '📉 **LUMISTOCKS MARKET ALERT** 📉',
    '',
    `> **${event.headline}**`,
    '',
    story,
    '',
  ];

  if (impactResults && impactResults.length > 0) {
    lines.push('**Impact:**');
    for (const r of impactResults) {
      const pctChange = r.oldPrice > 0
        ? ((r.newPrice - r.oldPrice) / r.oldPrice * 100).toFixed(1)
        : '0.0';
      lines.push(`> **${r.ticker}** (${r.businessName}): $${r.oldPrice.toFixed(2)} → $${r.newPrice.toFixed(2)} (${pctChange}%)`);
    }
  } else {
    lines.push('_No listed stocks were affected by this event._');
  }

  return lines.join('\n');
}

/**
 * Post the event message to every guild's Big Business channel.
 */
async function postEventToAllGuilds(message) {
  if (!discordClient) {
    logger.warn('Stock events: no Discord client, cannot post.');
    return;
  }

  const guilds = getAllGuildConfigs().filter((cfg) => cfg.enabled);

  for (const cfg of guilds) {
    const channelId = cfg.bigBusinessChannelId;
    if (!channelId) continue;
    const roleMention = cfg.bigBusinessRoleId ? `<@&${cfg.bigBusinessRoleId}>\n` : '';

    try {
      const channel = await discordClient.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        logger.warn(`Stock events: could not fetch channel ${channelId} for guild ${cfg.guildId}.`);
        continue;
      }
      await channel.send(`${roleMention}${message}`);
    } catch (error) {
      logger.warn(`Stock events: failed to post to guild ${cfg.guildId}.`, error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Core event pipeline
// ---------------------------------------------------------------------------

/**
 * Roll and execute a full market event:
 *   1. Pick a random event from the pool
 *   2. Find affected stocks
 *   3. Apply price impact
 *   4. Generate LLM news story
 *   5. Post to all guild channels
 *
 * @param {Object}  [options]
 * @param {boolean} [options.dryRun=false] – If true, skip price impact + posting. Returns the preview.
 * @returns {Promise<{event: MarketEvent, affected: Array, impact: Array|null, story: string, message: string}>}
 */
async function rollMarketEvent({ dryRun = false } = {}) {
  const event = pick(EVENT_POOL);
  const affected = findAffectedStocks(event);

  logger.info(`Stock events: rolled "${event.id}" — ${affected.length} stock(s) affected${dryRun ? ' (dry run)' : ''}.`);

  let impact = null;
  if (!dryRun && affected.length > 0) {
    impact = applyEventImpact(event, affected);
  }

  // Generate the story (even in dry-run for preview)
  const story = await generateEventStory(event, affected);
  const message = formatEventMessage(event, story, impact);

  if (!dryRun) {
    await postEventToAllGuilds(message);
  }

  return { event, affected, impact, story, message };
}

// ---------------------------------------------------------------------------
// Scheduler integration
// ---------------------------------------------------------------------------

// Random interval: 4-12 hours between events
const MIN_EVENT_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_EVENT_INTERVAL_MS = 12 * 60 * 60 * 1000;

let eventTimer = null;
let stopped = false;

function nextEventDelay() {
  return MIN_EVENT_INTERVAL_MS + Math.random() * (MAX_EVENT_INTERVAL_MS - MIN_EVENT_INTERVAL_MS);
}

function scheduleNextEvent() {
  if (stopped) return;

  const delay = nextEventDelay();
  logger.info(`Stock events: next event in ${Math.round(delay / 60000)}m.`);

  eventTimer = setTimeout(async () => {
    try {
      await rollMarketEvent();
    } catch (error) {
      logger.error('Stock events: unhandled error during market event.', error.message);
    }
    scheduleNextEvent();
  }, delay);
  eventTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function initStockEvents(client) {
  discordClient = client;
  stopped = false;
  scheduleNextEvent();
  logger.info('Stock events scheduler started (random negative events every 4-12h).');
}

function stopStockEvents() {
  stopped = true;
  if (eventTimer) { clearTimeout(eventTimer); eventTimer = null; }
  discordClient = null;
  logger.info('Stock events scheduler stopped.');
}

module.exports = {
  initStockEvents,
  stopStockEvents,
  rollMarketEvent,
  EVENT_POOL,
};
