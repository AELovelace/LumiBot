'use strict';

/**
 * Request-body checks for the minigame routes: erinne's pydantic models (extra="forbid", strict ints) become these
 * small checks, answering 422 like FastAPI did. (Big run logs use the router's per-route `maxBody` option.)
 */

const { LumiError } = require('../errors');                                      // the 4xx answers

/** A 422 (erinne's FastAPI validation error), with the player-safe words. */
function invalid(message = 'That request is not something this game understands.') {
  return new LumiError(422, 'invalid', message);                                 // 422 unprocessable
}

/** Refuse any key not in `allowed` (pydantic extra="forbid"). */
function onlyKeys(body, allowed) {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw invalid(`Unexpected field: ${key}.`); // no extras
}

/** A strict whole number between low and high (pydantic strict int Field(ge, le)). */
function isInt(v, low, high) {
  return Number.isInteger(v) && v >= low && v <= high;                           // whole and in range
}

/** A number (int or float) between low and high (pydantic float Field(ge, le)). */
function isNum(v, low, high) {
  return typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;   // finite and in range
}

module.exports = { invalid, onlyKeys, isInt, isNum };
