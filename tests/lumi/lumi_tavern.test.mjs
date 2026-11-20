// Lumi Dungeons' lobby, the Lantern & Paw tavern (tavern-art.js): it draws, day and night, with nothing broken in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Ta = require("../../public/lumi/lumi-pet/tavern-art.js");

test("the tavern draws by day and by night, and they differ only where they should", () => {
  const day = Ta.scene({ night: false }), night = Ta.scene({ night: true });
  for (const drawn of [day, night]) {
    assert.ok(drawn.length > 8000, "A whole room, not a stub");
    assert.equal(/NaN|undefined|Infinity/.test(drawn), false, "No broken numbers");
    assert.equal(/<script|on\w+=/i.test(drawn), false, "Only shapes");
    assert.ok(drawn.includes('class="lp-tv-fire"') && drawn.includes('class="lp-tv-glow"'), "The fire flickers and the lights breathe (game.css)");
    assert.equal((drawn.match(/<g /g) || []).length, (drawn.match(/<\/g>/g) || []).length, "Every group is closed");
  }
  assert.match(day, /data-tavern="day"/);
  assert.match(night, /data-tavern="night"/);
  assert.ok(day.includes("#8fc8ff") && !night.includes("#8fc8ff"), "A blue sky in the window by day only");
  assert.ok(night.includes("#141a3a") && !day.includes("#141a3a"), "Stars in the window at night only");
  assert.equal(Ta.scene(), day, "No options is daytime");
  assert.equal(Ta.scene({ night: false }), day, "The same tavern every time (seeded planks and stones)");
  assert.equal(Ta.NAME, "The Lantern & Paw");
});

test("a breathing light keeps its own faintness: the animated group holds it, not the shape", () => {
  const drawn = Ta.scene({ night: true });
  assert.equal(/<(circle|ellipse|path|rect)[^>]*class="lp-tv-glow"/.test(drawn), false, "game.css animates opacity, which would override a shape's own");
});
