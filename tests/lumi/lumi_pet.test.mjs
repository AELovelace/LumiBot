// The page's small rules for Lumi: the device's night and day, moods, and reading an old browser save.
// Her needs and their decay are the server's (tests/test_lumipet.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const R = createRequire(import.meta.url)("../../public/lumi/lumi-pet/rules.js");
const at = (hour, minute = 0) => new Date(2026, 10, 2, hour, minute).getTime();
const auto = { rest: "auto", restUntil: 0 };

test("night follows local time, including the exact wake and sleep boundaries", () => {
  for (const [hour, minute, asleep] of [[6, 59, true], [7, 0, false], [21, 59, false], [22, 0, true], [0, 0, true]]) {
    assert.deepEqual(R.scene(auto, at(hour, minute)), { night: asleep, asleep });
  }
});

test("a nap sleeps by day and a gentle wake stays up at night, each only until it runs out", () => {
  const nap = { rest: "nap", restUntil: at(12) + 300000 };
  assert.equal(R.scene(nap, at(12)).asleep, true);
  assert.equal(R.scene(nap, at(12) + 300000).asleep, false);
  const awake = { rest: "awake", restUntil: at(23) + 900000 };
  assert.equal(R.scene(awake, at(23)).asleep, false);
  assert.equal(R.scene(awake, at(23) + 900000).asleep, true);
});

test("the old browser save gives up its moments and glow, and junk gives nothing", () => {
  assert.deepEqual(R.legacy({ version: 1, moments: 42, palette: "lagoon" }), { moments: 42, glow: "lagoon" });
  assert.deepEqual(R.legacy({ version: 1, moments: 1.5, palette: "plaid" }), { moments: 0, glow: null });
  assert.deepEqual(R.legacy({ version: 1, moments: 1000000 }), { moments: 999999, glow: null });
  for (const junk of [null, "text", 7, { version: 3, moments: 9 }]) assert.deepEqual(R.legacy(junk), { moments: 0, glow: null });
});

test("her mood names the lowest need under a quarter, and she is only sad at zero", () => {
  assert.deepEqual(R.mood({ hunger: 80, energy: 60, joy: 25 }), { need: null, sad: false });
  assert.deepEqual(R.mood({ hunger: 20, energy: 10, joy: 90 }), { need: "energy", sad: false });
  assert.deepEqual(R.mood({ hunger: 0, energy: 50, joy: 50 }), { need: "hunger", sad: true });
});

test("glows cycle, timers read as minutes and seconds, and item effects carry their sign", () => {
  assert.deepEqual(["rose", "lagoon", "starlight", "zephyr", "wisp", "umbra"].map(R.nextPalette), ["lagoon", "starlight", "zephyr", "wisp", "umbra", "rose"]);
  assert.deepEqual([125000, 59001, 0, -5000].map(R.countdown), ["2:05", "1:00", "0:00", "0:00"]);
  assert.equal(R.signed(25, "joy"), "+25 joy");
  assert.equal(R.signed(-10, "energy"), "−10 energy");
});
