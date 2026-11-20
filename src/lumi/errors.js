'use strict';

/**
 * Lumi games: the one error type route handlers throw for "no" answers a player should see.
 * The router (router.js) turns a LumiError into an HTTP status and a JSON body:
 *   { error: message, detail: message, code, ...extra }
 * (`detail` is what erinne's common.js api() reads, `error`/`code` are LumiBot's.) Anything that is NOT a
 * LumiError is treated as a bug: logged, and answered with a plain 500.
 */

class LumiError extends Error {
  /**
   * @param {number} status  HTTP status (400, 402, 403, 404, 409, 410, 429 ...)
   * @param {string} code    short machine-readable reason, e.g. 'not_enough_sgc'
   * @param {string} message text that is safe to show the player
   * @param {object} [extra] more JSON fields for the body, e.g. { need: 5, have: 2 }
   */
  constructor(status, code, message, extra = {}) {
    super(message);                                          // the player-facing words
    this.name = 'LumiError';                                 // shows in logs
    this.status = Number.isInteger(status) ? status : 400;   // HTTP status to answer with
    this.code = String(code || 'error');                     // machine-readable reason
    this.extra = extra && typeof extra === 'object' ? extra : {}; // more JSON fields
  }

  /** The JSON body the router sends. */
  toJSON() {
    return { ...this.extra, error: this.message, detail: this.message, code: this.code }; // extra never overrides the core fields
  }
}

const badRequest = (message = 'That request was not understood.', code = 'bad_request', extra) => new LumiError(400, code, message, extra);   // 400
const unauthorized = (message = 'Please log in first.', code = 'login_required', extra) => new LumiError(401, code, message, extra);        // 401
const forbidden = (message = 'You can\'t do that.', code = 'forbidden', extra) => new LumiError(403, code, message, extra);                 // 403
const notFound = (message = 'Not found.', code = 'not_found', extra) => new LumiError(404, code, message, extra);                           // 404
const conflict = (message = 'That changed in the meantime. Please try again.', code = 'conflict', extra) => new LumiError(409, code, message, extra); // 409
const gone = (message = 'That is over now.', code = 'gone', extra) => new LumiError(410, code, message, extra);                              // 410
const tooMany = (message = 'Slow down a little, please.', code = 'slow_down', extra) => new LumiError(429, code, message, extra);          // 429

/** 402: the player can't afford it. Always carries { need, have } so the page can say how short they are. */
function notEnoughSGC(need, have, message) {
  const words = message || `You need ${need} SGC for that, but you have ${have}.`; // default wording
  return new LumiError(402, 'not_enough_sgc', words, { need, have });              // 402 Payment Required
}

/** True for a LumiError (or anything shaped like one). */
function isLumiError(err) {
  return err instanceof LumiError;                          // only our own class counts
}

module.exports = {
  LumiError,      // the class: new LumiError(status, code, message, extra)
  badRequest,     // 400
  unauthorized,   // 401
  forbidden,      // 403
  notFound,       // 404
  conflict,       // 409
  gone,           // 410
  tooMany,        // 429
  notEnoughSGC,   // 402 with { need, have }
  isLumiError,    // instanceof check
};
