'use strict';

/**
 * Prism Drop's API (erinne web/games.py prism_run / prism_drop):
 *   GET  /api/prism-drop/run   the game in progress, so a reload or another device picks it up
 *   POST /api/prism-drop/drop  { pick: 1..10 } one drop; the tenth finishes the game and pays (src/lumi/minis/prism.js)
 */

const tuning = require('../tuning');                                             // admin knobs
const prism = require('../minis/prism');                                         // the game
const { onlyKeys, isInt, invalid } = require('../minis/body');                   // erinne's pydantic checks

tuning.define('prism', { label: 'Prism Drop', payoutKeys: { win: null } });      // score / 10 per game (native), admin page entry

/** Add the Prism Drop routes. */
function register(router) {
  router.get('/api/prism-drop/run', (ctx) => prism.current(ctx.user.id));        // { drops, score }
  router.post('/api/prism-drop/drop', (ctx) => {
    onlyKeys(ctx.body, ['pick']);                                                // the player only says which pocket
    if (!isInt(ctx.body.pick, 1, prism.WIDTH)) throw invalid('Pick a pocket from 1 to 10.'); // a real pocket
    return prism.play(ctx.user, ctx.body.pick);                                  // roll it (own transaction)
  }, { money: true });                                                           // one drop at a time per player
}

module.exports = { register };
