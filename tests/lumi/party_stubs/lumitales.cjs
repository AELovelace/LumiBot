'use strict';
// TEST-ONLY stand-in for src/lumi/dungeon/lumitales.js (used only while the real port is missing): a fixed line per scenario.
function line(run) { return `[${run.event.scenario}]`; }                 // the library's line
function scene() { return ''; }                                          // no scene text
module.exports = { line, scene, STUB: true };
