'use strict';

/**
 * Lumi Dungeons API (erinne mnemerynne/web/games.py, the lumi-pet battle and dungeon routes, lines 825-915 and
 * 1142-1176). Every POST only says what was CHOSEN (a tier, a button, a direction, puzzle moves): the server rolls,
 * replays and pays. A body with anything else is refused with 422, like erinne's pydantic models (extra="forbid").
 *
 *   POST /api/lumi-pet/battle         { tier }                       start a fight
 *   POST /api/lumi-pet/battle/act     { battle, turn, action }       one button in a fight
 *   POST /api/lumi-pet/dungeon        { env }                        set out on a trip
 *   POST /api/lumi-pet/dungeon/act    { action, way?, moves?, picks? } one choice in the dungeon
 *   GET  /api/lumi-pet/dungeon/tale   -> { live: null }              no live storyteller in LumiBot
 *   POST /api/lumi-pet/dungeon/tale   -> { line: null }              so the library's line always stays
 */

const { tx } = require('../db');                                                   // one transaction per action
const tuning = require('../tuning');                                               // the admin page's entries
const { LumiError } = require('../errors');                                        // "no" answers
const lumibattle = require('../dungeon/lumibattle');                               // prices for the admin preview
const lumipet = require('../pet/lumipet');                                         // erinne lumipet fight_*/dungeon_* (the one code path)
const { refusals } = require('./pet');                                             // a PetError (Lumi refusing) -> 400 with her words

const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'gamble'];       // FightStart.tier
const FIGHT_ACTIONS = ['move0', 'move1', 'move2', 'move3', 'defend', 'potion', 'ether', 'x-attack', 'x-defend', 'x-speed', 'run']; // FightTurn.action
const DUNGEON_ACTIONS = ['move', 'look', 'take', 'back', 'unlock', 'sokoban', 'lights', 'rune', 'cup', 'flip', 'potion', 'descend', 'leave', 'abandon']; // DungeonStep.action
const WAYS = ['n', 'e', 's', 'w'];                                                 // DungeonStep.way

// The admin page's rows: every Outfitters key with its native price (sgc keys), and the two prizes.
tuning.define('battle', {
  label: 'Lumi Dungeons: arena',                                                   // same label as games.js
  priceKeys: {                                                                     // key -> native price (for the preview)
    respec: lumibattle.RESPEC_PRICE, heal: lumibattle.HEAL_PRICE, potion: lumibattle.POTION_PRICE, reset: lumibattle.STAT_RESET_PRICE, // services
    ...Object.fromEntries(Object.entries(lumibattle.KIT).map(([id, item]) => [id, item.price])), // fight items
    ...Object.fromEntries(lumibattle.CATALOG.mods.filter((mod) => mod.price).map((mod) => [mod.id, mod.price])), // mods for sale
  },
  payoutKeys: { win: null },                                                       // EXP x 0.6 per win
});
tuning.define('dungeon', { label: 'Lumi Dungeons: runs', payoutKeys: { win: null } }); // satchels brought home

// 422 like erinne's request models.
function invalid(message = 'That request was not understood.') {
  return new LumiError(422, 'invalid', message);                                   // unprocessable
}

// Only these keys may be in the body (pydantic extra="forbid").
function only(body, allowed) {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));         // anything else?
  if (extra.length) throw invalid(`Unexpected field: ${extra[0]}.`);               // refuse
}

/** Add the Lumi Dungeons routes. */
function register(router) {
  router.post('/api/lumi-pet/battle', (ctx) => {                                   // start a fight
    const body = ctx.body;                                                         // { tier }
    only(body, ['tier']);                                                          // nothing else (never an enemy)
    if (!TIERS.includes(body.tier)) throw invalid('Choose a kind of opponent, or Gamble.'); // a known tier
    return refusals(() => tx(() => lumipet.fightStart(ctx.user.id, body.tier)));   // fight + pet together
  }, { money: true });                                                             // one at a time per player

  router.post('/api/lumi-pet/battle/act', (ctx) => {                               // one button in a fight
    const body = ctx.body;                                                         // { battle, turn, action }
    only(body, ['battle', 'turn', 'action']);                                      // never a damage number or a result
    if (!Number.isSafeInteger(body.battle) || body.battle < 1) throw invalid('Which fight?'); // a fight id
    if (!Number.isSafeInteger(body.turn) || body.turn < 0) throw invalid('Which turn?'); // the turn the page showed
    if (!FIGHT_ACTIONS.includes(body.action)) throw invalid("Lumi doesn't know that one."); // a known button
    return refusals(() => tx(() => lumipet.fightAct(ctx.user.id, body.battle, body.turn, body.action, undefined, null, { username: ctx.user.name }))); // turn + pet + SGC together
  }, { money: true });                                                             // one at a time per player

  router.post('/api/lumi-pet/dungeon', (ctx) => {                                  // set out
    const body = ctx.body;                                                         // { env }
    only(body, ['env']);                                                           // nothing else
    if (typeof body.env !== 'string' || body.env.length < 1 || body.env.length > 40) throw invalid('Where to?'); // 1-40 characters
    return refusals(() => tx(() => lumipet.dungeonStart(ctx.user.id, body.env)));  // trip + pet together
  }, { money: true });                                                             // one at a time per player

  router.post('/api/lumi-pet/dungeon/act', (ctx) => {                              // one choice in the dungeon
    const body = ctx.body;                                                         // { action, way, moves, picks }
    only(body, ['action', 'way', 'moves', 'picks']);                               // never a room, a reward or a result
    if (!DUNGEON_ACTIONS.includes(body.action)) throw invalid("Lumi doesn't know that one."); // a known choice
    const way = body.way === undefined ? null : body.way;                          // optional
    if (way !== null && !WAYS.includes(way)) throw invalid('Which way?');          // n, e, s or w
    const moves = body.moves === undefined ? '' : body.moves;                      // optional Sokoban answer
    if (typeof moves !== 'string' || moves.length > 600 || !/^[udlr]*$/u.test(moves)) throw invalid('Those moves are not understood.'); // u/d/l/r only
    const picks = body.picks === undefined ? [] : body.picks;                      // optional picks
    if (!Array.isArray(picks) || picks.length > 200 || picks.some((p) => !(Number.isSafeInteger(p) || (typeof p === 'string' && p.length <= 40)))) { // ints or short words
      throw invalid('Those picks are not understood.');                            // refuse
    }
    return refusals(() => tx(() => lumipet.dungeonAct(ctx.user.id, body.action, { way, moves, picks, username: ctx.user.name }))); // step + pet + SGC together
  }, { money: true });                                                             // one at a time per player

  router.get('/api/lumi-pet/dungeon/tale', () => ({ live: null }));                // no live storyteller here
  router.post('/api/lumi-pet/dungeon/tale', () => ({ line: null }), { body: false }); // the library's line stays
}

module.exports = { register };
