'use strict';

/**
 * Lumi core API routes (every game needs these). A route module = a file in src/lumi/routes/ that exports
 * register(router); index.js loads every such file at start, in name order. See CONTRACT.md.
 */

const sgc = require('../sgc');
const save = require('../pet/save');
const tuning = require('../tuning');

/** Add the core routes to the router. */
function register(router) {
  router.get('/api/coins', (ctx) => ({ coins: sgc.balance(ctx.user.id) }));           // the coin chip (common.js showCoins)
  router.get('/api/me', (ctx) => ({                                                     // who am I
    id: ctx.user.id,                                                                    // Discord id
    name: ctx.user.name,                                                                // Discord name
    coins: sgc.balance(ctx.user.id),                                                    // SGC balance
    look: save.look(ctx.user.id),                                                       // her look
  }));
  router.get('/api/lumi-look', (ctx) => save.look(ctx.user.id));                        // arcade/lumi-sprite.js draws her with this
  router.get('/api/tuning', () => tuning.clientTuning());                               // a fresh window.LUMI_TUNING
}

module.exports = { register };
