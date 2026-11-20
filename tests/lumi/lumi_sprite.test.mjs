// Lumi on the arcade canvases (arcade/lumi-sprite.js): her drawing is an SVG image, and an image is strict XML, so
// every piece she can wear (lumi-pet/closet.js) must still make a well-formed one. A page forgives a repeated
// attribute; an image refuses to load and she'd be drawn as a plain shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const closet = require("../../public/lumi/lumi-pet/closet.js");
globalThis.LumiPetCloset = closet;                           // as the page has it, before lumi-sprite.js loads
const L = require("../../public/lumi/arcade/lumi-sprite.js");

function wellFormed(svg) { // No tag repeats an attribute, and every tag that opens closes, in order.
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, closing, name, attrs, self] = m;
    const keys = [...attrs.matchAll(/\s+([\w:-]+)=/g)].map(a => a[1]);
    if (new Set(keys).size !== keys.length) return "repeats an attribute in <" + name + ">";
    if (closing) { if (stack.pop() !== name) return "closes </" + name + "> out of order"; }
    else if (!self) stack.push(name);
  }
  return stack.length ? "leaves <" + stack.at(-1) + "> open" : "";
}

test("every piece she can wear makes a well-formed picture, in every glow", () => {
  for (const id of Object.keys(closet.ART)) {
    for (const glow of Object.keys(L.PALETTES)) {
      const problem = wellFormed(L.svg({ glow, outfit: { [closet.ART[id].slot || "head"]: id, any: id } }, "open"));
      assert.equal(problem, "", id + " in " + glow + ": " + problem);
    }
  }
});

test("her eyes and an unknown glow still draw", () => {
  for (const eyes of ["open", "closed", "happy", "nonsense"]) assert.equal(wellFormed(L.svg({ glow: "rose", outfit: {} }, eyes)), "");
  assert.deepEqual(L.palette({ glow: "not-a-glow" }), L.PALETTES.rose);
  assert.deepEqual(L.palette(null), L.PALETTES.rose);
});
