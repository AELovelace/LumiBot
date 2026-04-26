'use strict';

/**
 * Economy store passthrough.
 *
 * SGCServer shares the SadGirlCoin SQLite database with LumiBot, so we
 * re-export LumiBot's sadgirlEconomyStore module rather than duplicating
 * the schema. This keeps schema migrations in one place.
 *
 * The first process to call initEconomyStore() creates the schema; the
 * second process to open the file just sees it. WAL mode (set in the
 * underlying module) makes concurrent read/write across processes safe.
 */

const path = require('node:path');

// Resolve to LumiBot's source tree. Both processes live in the same repo.
const lumiBotStorePath = path.resolve(__dirname, '..', '..', 'src', 'sadgirlEconomyStore.js');

// eslint-disable-next-line import/no-dynamic-require, global-require
module.exports = require(lumiBotStorePath);
