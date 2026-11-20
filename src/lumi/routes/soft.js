'use strict';

/**
 * Lumi-Soft's API (erinne web/games.py soft_state / soft_start / soft_continue / soft_finish):
 *   GET  /api/lumi-soft/state     the title screen: stages, prices (native), bests, prizes, today's Daily Range
 *   POST /api/lumi-soft/start     { mode, stage? } a ticket (charges the entry unless practice)
 *   POST /api/lumi-soft/continue  { run } pay for a continue
 *   POST /api/lumi-soft/finish    { run, shots, reloads, continues, end } -> the server's replay pays
 */

const { tx } = require('../db');                                                 // transactions
const tuning = require('../tuning');                                             // admin knobs
const soft = require('../minis/lumisoft');                                       // the game
const { onlyKeys, isInt, isNum, invalid } = require('../minis/body');            // erinne's pydantic checks

const FINISH_LIMIT = 512 * 1024;                                                 // up to 20,000 shots of a long story run

tuning.define('soft', { label: 'Lumi-Soft', priceKeys: { entry: soft.ENTRY, continue: soft.CONTINUES[0] }, payoutKeys: { win: null } }); // score / 250 (native)

// erinne SoftStart: { mode: training|story|stage|daily, stage: str (<= 40) | null }.
function checkStart(body) {
  onlyKeys(body, ['mode', 'stage']);                                             // never a score or price
  if (!soft.MODES.includes(body.mode)) throw invalid('Choose Story, a stage, the Daily Range or the Training Range.'); // a known mode
  if (body.stage !== undefined && body.stage !== null && (typeof body.stage !== 'string' || body.stage.length > 40)) throw invalid('Which stage?'); // a short id
}

// erinne SoftRun: { run: int >= 1 }.
function checkRun(body, extra = []) {
  onlyKeys(body, ['run', ...extra]);                                             // the ticket (and the log)
  if (!isInt(body.run, 1, Number.MAX_SAFE_INTEGER)) throw invalid('Which run was that?'); // a ticket
}

// erinne SoftFinish: shots [[0..1e7, -5000..10000, -5000..10000]] (<= 20000), reloads [0..1e7] (<= 10000), continues 0..1000, end 0..1e7.
function checkFinish(body) {
  checkRun(body, ['shots', 'reloads', 'continues', 'end']);                     // nothing that's a score
  const shots = body.shots === undefined ? [] : body.shots;                      // default []
  const reloads = body.reloads === undefined ? [] : body.reloads;                // default []
  if (!Array.isArray(shots) || shots.length > 20_000) throw invalid("That run doesn't add up."); // too many shots
  for (const s of shots) {
    if (!Array.isArray(s) || s.length !== 3 || !isInt(s[0], 0, 10_000_000) || !isNum(s[1], -5000, 10_000) || !isNum(s[2], -5000, 10_000)) {
      throw invalid("That run doesn't add up.");                                // [step, x, y]
    }
  }
  if (!Array.isArray(reloads) || reloads.length > 10_000 || reloads.some((r) => !isInt(r, 0, 10_000_000))) throw invalid("That run doesn't add up."); // reload steps
  if (body.continues !== undefined && !isInt(body.continues, 0, 1000)) throw invalid("That run doesn't add up."); // continues used
  if (!isInt(body.end, 0, 10_000_000)) throw invalid("That run doesn't add up."); // the last step (required)
  return { shots, reloads, continues: body.continues || 0, end: body.end };      // the log
}

/** Add the Lumi-Soft routes. */
function register(router) {
  router.get('/api/lumi-soft/state', (ctx) => soft.state(ctx.user));            // title screen
  router.post('/api/lumi-soft/start', (ctx) => {
    checkStart(ctx.body);                                                        // mode + stage only
    return tx(() => soft.start(ctx.user, ctx.body.mode, ctx.body.stage === undefined ? null : ctx.body.stage)); // charge + ticket
  }, { money: true });
  router.post('/api/lumi-soft/continue', (ctx) => {
    checkRun(ctx.body);                                                          // the ticket only
    return tx(() => soft.carryOn(ctx.user, ctx.body.run));                       // pay for a continue
  }, { money: true });
  router.post('/api/lumi-soft/finish', (ctx) => {
    const log = checkFinish(ctx.body);                                           // only the log
    return tx(() => soft.finish(ctx.user, ctx.body.run, log));                   // replay, pay once, prizes
  }, { money: true, maxBody: FINISH_LIMIT });                                    // a bigger body than the router's 16 KB
}

module.exports = { register };
