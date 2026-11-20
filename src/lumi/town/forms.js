'use strict';

/**
 * A tiny body checker for the Lumi Pet / Town / City routes: the JS stand-in for erinne's pydantic models
 * (model_config extra="forbid", Field(min/max/pattern), strict ints, Literal choices). A bad body is 422 'invalid',
 * like FastAPI's validation error, with a short message naming the field.
 *
 *   const body = form(ctx.body, {
 *     action: { type: 'str', choices: ['cuddle', 'feed'] },          // required (no default)
 *     item: { type: 'str', max: 40, nullable: true, default: null }, // optional
 *     count: { type: 'int', min: 1, max: 99, default: 1 },           // strict whole number
 *   });
 */

const { LumiError } = require('../errors');

/** 422 for a body that doesn't fit its model. */
function invalid(message) {
  return new LumiError(422, 'invalid', message);                                    // FastAPI's 422
}

/** Check `body` against `spec`; returns a clean object with defaults filled in. Throws 422 on anything wrong. */
function form(body, spec) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}; // the JSON object
  for (const key of Object.keys(source)) if (!(key in spec)) throw invalid(`Unexpected field: ${key}.`); // extra="forbid"
  const out = {};                                                                   // the clean values
  for (const [key, rule] of Object.entries(spec)) {
    const given = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined; // what was sent
    if (given === undefined) {                                                      // not sent
      if (!('default' in rule)) throw invalid(`${key} is required.`);              // required field
      out[key] = rule.default;                                                      // its default
      continue;                                                                     // next field
    }
    if (given === null) {                                                           // sent as null
      if (!rule.nullable) throw invalid(`${key} can't be empty.`);                  // not allowed
      out[key] = null;                                                              // null it is
      continue;                                                                     // next field
    }
    if (rule.type === 'str') {
      if (typeof given !== 'string') throw invalid(`${key} must be text.`);         // strings only
      if (rule.max !== undefined && [...given].length > rule.max) throw invalid(`${key} is too long.`); // max_length
      if (rule.pattern && !rule.pattern.test(given)) throw invalid(`${key} isn't in the right shape.`); // pattern
    } else if (rule.type === 'int') {
      if (!Number.isSafeInteger(given)) throw invalid(`${key} must be a whole number.`); // strict int (no "3", no 3.5, no true)
    } else if (rule.type === 'num') {
      if (typeof given !== 'number' || !Number.isFinite(given)) throw invalid(`${key} must be a number.`); // float
    } else if (rule.type === 'bool') {
      if (typeof given !== 'boolean') throw invalid(`${key} must be true or false.`); // strict bool
    }
    if ((rule.type === 'int' || rule.type === 'num') && ((rule.min !== undefined && given < rule.min) || (rule.max !== undefined && given > rule.max))) {
      throw invalid(`${key} is out of range.`);                                     // ge / le
    }
    if (rule.choices && !rule.choices.includes(given)) throw invalid(`${key} isn't one of the choices.`); // Literal[...]
    out[key] = given;                                                               // accepted
  }
  return out;                                                                       // clean body
}

module.exports = { form, invalid };
