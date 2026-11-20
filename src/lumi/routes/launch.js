'use strict';

/**
 * Lumi Launch's API (erinne web/games.py launch_state / launch_start / launch_finish):
 *   GET  /api/lumi-launch/state   the title screen: price (native), bests, the board
 *   POST /api/lumi-launch/start   a ticket and a course (charges the entry)
 *   POST /api/lumi-launch/finish  { run, shots: [[[frame, 'ok'|'up'|'down'], ...] x <=3] } -> the server's replay pays
 * erinne's /tv/player (couch turns on a TV) is dropped: LUMI_FLAGS.tvPlay is false here.
 */

const { tx } = require('../db');                                                 // transactions
const tuning = require('../tuning');                                             // admin knobs
const launch = require('../minis/lumilaunch');                                   // the game
const { onlyKeys, isInt, invalid } = require('../minis/body');                   // erinne's pydantic checks

const FINISH_LIMIT = 128 * 1024;                                                 // 3 launches x 2000 presses fits easily

tuning.define('launch', { label: 'Lumi Launch', priceKeys: { entry: launch.ENTRY }, payoutKeys: { win: null } }); // metres / 20 (native)

// erinne LaunchRun: { run: int >= 1, shots: list (<= 3) of lists (<= 2000) of [0..100000, 'ok'|'up'|'down'] }.
function checkFinish(body) {
  onlyKeys(body, ['run', 'shots']);                                              // never a distance
  if (!isInt(body.run, 1, Number.MAX_SAFE_INTEGER)) throw invalid('Which go was that?'); // the ticket
  const shots = body.shots;                                                      // the presses
  if (!Array.isArray(shots) || shots.length > 3) throw invalid('A go has 3 launches.'); // max_length=3
  for (const log of shots) {
    if (!Array.isArray(log) || log.length > 2000) throw invalid("That go doesn't add up."); // max_length=2000
    for (const press of log) {
      if (!Array.isArray(press) || press.length !== 2 || !isInt(press[0], 0, 100_000) || !launch.BUTTONS.includes(press[1])) {
        throw invalid("That go doesn't add up.");                               // [frame, button]
      }
    }
  }
}

/** Add the Lumi Launch routes. */
function register(router) {
  router.get('/api/lumi-launch/state', (ctx) => launch.state(ctx.user));         // title screen
  router.post('/api/lumi-launch/start', (ctx) => tx(() => launch.start(ctx.user)), { money: true }); // charge + ticket
  router.post('/api/lumi-launch/finish', (ctx) => {
    checkFinish(ctx.body);                                                       // only presses
    return tx(() => launch.finish(ctx.user, ctx.body.run, ctx.body.shots));      // replay, pay once, bests
  }, { money: true, maxBody: FINISH_LIMIT });                                    // a bigger body than the router's 16 KB
}

module.exports = { register };
