'use strict';

/**
 * Crypto-backed randomness for the money games (audit #36).
 *
 * Math.random() is a fast but predictable PRNG; anything that decides who
 * wins SadGirlCoin should come from the OS cryptographic generator instead.
 * These helpers are drop-in replacements that keep the same distributions:
 *   - randomInt(n)  === Math.floor(Math.random() * n)   (uniform 0..n-1)
 *   - randomFloat() === Math.random()                    (uniform [0, 1))
 */

const crypto = require('node:crypto'); // Node's built-in cryptographic random source

const FLOAT_BITS = 48; // how many random bits go into one float (crypto.randomInt caps ranges below 2**48)
const FLOAT_SCALE = 2 ** FLOAT_BITS; // divide by this to squash the 48-bit integer into [0, 1)

/** Uniform integer in [0, maxExclusive). Same distribution as Math.floor(Math.random() * maxExclusive). */
function randomInt(maxExclusive) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) { // guard: only positive whole numbers make sense here
    throw new RangeError(`randomInt needs a positive safe integer, got ${maxExclusive}`); // fail loudly instead of returning junk
  }
  return crypto.randomInt(maxExclusive); // crypto.randomInt(max) returns an unbiased integer 0..max-1
}

/** Uniform float in [0, 1) with 48 bits of crypto randomness. Same distribution as Math.random(). */
function randomFloat() {
  return crypto.randomBytes(6).readUIntBE(0, 6) / FLOAT_SCALE; // 6 random bytes = 48-bit integer, scaled down to [0, 1)
}

/** In-place Fisher-Yates shuffle using crypto randomness. Returns the same array for chaining. */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) { // walk from the last card down to the second card
    const j = randomInt(i + 1); // pick a random slot from 0..i (inclusive), exactly like the old Math.random version
    [arr[i], arr[j]] = [arr[j], arr[i]]; // swap the two cards
  }
  return arr; // hand the shuffled array back
}

module.exports = { randomInt, randomFloat, shuffleInPlace }; // share the helpers with every engine
