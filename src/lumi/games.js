'use strict';

/**
 * Lumi games: the tuning ids every Lumi game uses, defined up front so the admin page lists them all even before a
 * game's own module lands. A game module may call tuning.define() again with its real keys (it simply replaces this).
 * priceKeys / payoutKeys are erinne's NATIVE numbers (plan section 3.8 / 4), for the admin preview only.
 */

const tuning = require('./tuning');

const DEFAULT_GAMES = [
  ['pet', { label: 'Lumi Pet', priceKeys: { snacks: null, boutique: null, capsule: 150, moon: 300 }, payoutKeys: { visit: 25, housewarm: 10, movein: null, buyback: null } }], // care shop, closet, house
  ['battle', { label: 'Lumi Dungeons: arena', priceKeys: { shop: null }, payoutKeys: { win: null } }],          // fights + Outfitters
  ['dungeon', { label: 'Lumi Dungeons: runs', payoutKeys: { win: null } }],                                     // satchels brought home
  ['party', { label: 'Lumi Dungeons: parties', payoutKeys: { win: null } }],                                    // party satchels
  ['garden', { label: 'Lumi’s Garden', priceKeys: { shop: null }, payoutKeys: { press: null, token: null } }],   // Nursery + powder
  ['prism', { label: 'Prism Drop', payoutKeys: { win: null } }],                                                // score / 10
  ['launch', { label: 'Lumi Launch', priceKeys: { entry: 25 }, payoutKeys: { win: null } }],                    // metres / 20
  ['soft', { label: 'Lumi-Soft', priceKeys: { entry: 25, continue: 50 }, payoutKeys: { win: null } }],          // score / 250
  ['breakout', { label: 'Yarn Pop', priceKeys: { entry: 25 }, payoutKeys: { win: 1 } }],                        // 1 per block
  ['snake', { label: 'Lumi Conga', priceKeys: { entry: 25 }, payoutKeys: { win: 1 } }],                         // 1 per point
  ['teacup-tower', { label: 'Teacup Tower', priceKeys: { entry: 25 }, payoutKeys: { win: 1 } }],                // 1 per floor
  ['city', { label: 'Lumi City (real estate)', priceKeys: { plot: null, style: null, yard: null, capsule: null }, payoutKeys: { sale: null } }], // Lumi City Realty
];

/** Define every default game (idempotent). */
function defineDefaults() {
  for (const [id, def] of DEFAULT_GAMES) tuning.define(id, def);                    // one define each
}

module.exports = { DEFAULT_GAMES, defineDefaults };
