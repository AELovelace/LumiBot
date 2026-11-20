/* The walker (Lumi City, Doll's design 2026-11-19; docs/plans/lumi-city.md): how a Lumi moves when she walks freely,
   shared by every place she can walk. Her flat (room-ui.js), the insides of Lumi Town's places (town-inside.js) and
   the city's streets (city-map.js) each say where she may stand (a `free(x, y)` test); this file moves her by a step
   without ever putting her somewhere she may not stand, and walks her toward a spot or along a route.

   Pure: no page, no clock. Every number is in the drawing's own units, the same as the place's picture. */
(function (root, make) {
  const walker = make();
  if (typeof module === "object" && module.exports) module.exports = walker; else root.LumiWalker = walker;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function slide(free, at, dx, dy) { // One step by dx, dy from {x, y}. Each axis on its own, so she slides along a wall or a thing she bumps
    // instead of stopping dead: across first, then up or down. Returns the new {x, y} (the same spot when both are blocked).
    let x = at.x + (dx || 0), y = at.y;                       // try the step across
    if (!free(x, y)) x = at.x;                                // bumped something sideways: stay where she was across
    const ny = y + (dy || 0);                                 // then try the step up or down
    if (free(x, ny)) y = ny;                                  // (bumped going up or down: stay where she was in depth)
    return { x: x, y: y };
  }

  function toward(free, at, to, step) { // A walk to a spot: one step of length `step` straight at `to`, sliding round anything in the way.
    // Returns {x, y, done}: done when she's there (or as close as she can get this step).
    const dx = to.x - at.x, dy = to.y - at.y, gap = Math.hypot(dx, dy); // how far is left
    if (gap < 0.5) return { x: to.x, y: to.y, done: true };  // already there
    const k = Math.min(1, step / gap);                         // the whole way when it's closer than a step
    const next = slide(free, at, dx * k, dy * k);              // straight at it, sliding along anything in the way
    const stuck = next.x === at.x && next.y === at.y;          // nothing moved her at all
    return { x: next.x, y: next.y, done: stuck || (k === 1 && next.x === to.x && next.y === to.y) };
  }

  function follow(free, at, route, step) { // A walk along a route (a list of {x, y} points, a path found by city-map.js): one step's worth.
    // Uses up points as she reaches them, carrying the rest of the step on to the next one. Returns {x, y, route, done}.
    let here = { x: at.x, y: at.y }, left = step, rest = route.slice();
    while (rest.length && left > 0) {
      const to = rest[0], gap = Math.hypot(to.x - here.x, to.y - here.y); // the next point on the way
      if (gap <= left) { // reached it this step: on to the next, with what's left of the step
        if (!free(to.x, to.y)) { rest = []; break; }           // (a point she can't stand on: the route has gone stale, stop)
        here = { x: to.x, y: to.y }; left -= gap; rest.shift(); continue;
      }
      const went = toward(free, here, to, left);               // part of the way there
      if (went.x === here.x && went.y === here.y) { rest = []; break; } // stuck: give up the route
      here = { x: went.x, y: went.y }; left = 0;
    }
    return { x: here.x, y: here.y, route: rest, done: !rest.length };
  }

  function heldWay(holds) { // Everything held (keys, a stick, a panel's pad: who → {x, y}), added up, never faster than one stick pushed all the way.
    let x = 0, y = 0;
    Object.keys(holds).forEach(function (who) { x += holds[who].x; y += holds[who].y; }); // all of them together
    const size = Math.hypot(x, y);
    return size > 1 ? { x: x / size, y: y / size } : { x: x, y: y };                      // (a diagonal is no quicker)
  }

  /* A floor (one room seen from the front, like her flat or the inside of a place in town): she walks left and right
     (x, between edge[0] and edge[1]) and toward or away from the back wall (y, her feet: between back and front).
     Things stand against the back wall; each blocks the floor from its front edge back to the wall. plan:
       things [{id, x, box: [x, y, w, h], wall?}] (where she stands to use it, and its press box over the picture),
       edge [left, right], back, front, half (half her width at the feet), near (reach), shrink (smaller at the back),
       extra [[left, right, front]] (blocks that aren't things). */
  function floor(plan) {
    const half = plan.half || 26, near = plan.near || 30, shrink = plan.shrink || 0; // her width, reach, and depth shrink
    function blocks() { // Each floor-standing thing's patch of floor, [left, right, front]: from its front edge back to the wall.
      return plan.things.filter(function (t) { return !t.wall && t.box; }).map(function (t) {
        return [t.box[0], t.box[0] + t.box[2], Math.min(plan.front - 6, t.box[1] + t.box[3] - 14)]; // its press box's foot, a little in
      }).concat(plan.extra || []);
    }
    function free(x, y) { // May she stand with her feet at x, y? Inside the floor, and never inside a thing's patch.
      if (x < plan.edge[0] || x > plan.edge[1] || y < plan.back || y > plan.front) return false; // off the floor
      return !blocks().some(function (b) { return x > b[0] - half && x < b[1] + half && y < b[2]; });
    }
    function settle(x, y) { // The nearest place in front of x, y where she may stand (the front always is).
      let feet = Math.max(plan.back, Math.min(plan.front, y));
      while (!free(x, feet) && feet < plan.front) feet = Math.min(plan.front, feet + 2); // step forward until clear
      return feet;
    }
    function clean(at) { // A place made safe: on the floor, out in front of anything.
      const x = Math.max(plan.edge[0], Math.min(plan.edge[1], at && Number.isFinite(at.x) ? at.x : (plan.edge[0] + plan.edge[1]) / 2));
      const y = settle(x, at && Number.isFinite(at.y) ? at.y : plan.front);
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }
    function move(at, dx, dy) { return clean(slide(free, clean(at), dx, dy)); } // One free-walking step.
    function reach(at) { // The thing in reach where she stands (its index in plan.things), or -1: the closest whose sides she's within `near` of.
      let best = -1, gap = Infinity;
      plan.things.forEach(function (t, i) {
        const box = t.box || [t.x - 30, 0, 60, 0], d = Math.abs(at.x - t.x) - (t.depth !== undefined ? 1000 : 0); // a thing out on the floor (a mat, a cushion) wins when she's on it
        const inside = at.x >= box[0] - near && at.x <= box[0] + box[2] + near && (t.depth === undefined || Math.abs(at.y - t.depth) <= (t.reachY || 40)); // close enough across (and in depth, for a thing out on the floor)
        if (inside && d < gap) { gap = d; best = i; }
      });
      return best;
    }
    function stand(i) { // Where she stands to use thing i: in front of it, at its own x.
      const t = plan.things[i];
      return clean({ x: t.x, y: t.depth !== undefined ? t.depth : plan.front - 24 }); // (a step back from the very front, where a mat or a cushion may lie)
    }
    function step(at, by) { // A remote's ◀ ▶: the next thing that way along the floor (or stay at the end). Returns its index, or -1.
      const order = plan.things.map(function (t, i) { return i; }).sort(function (a, b) { return plan.things[a].x - plan.things[b].x; }); // left to right
      const here = reach(at);
      if (here >= 0) { const k = order.indexOf(here) + by; return k >= 0 && k < order.length ? order[k] : here; } // the neighbour of the one she's at
      const ahead = order.filter(function (i) { return by > 0 ? plan.things[i].x > at.x : plan.things[i].x < at.x; }); // the ones that way
      return ahead.length ? (by > 0 ? ahead[0] : ahead[ahead.length - 1]) : -1;
    }
    function scale(y) { return 1 - shrink * (plan.front - Math.max(plan.back, Math.min(plan.front, y))) / Math.max(1, plan.front - plan.back); } // her size at depth y
    function point(x, y) { return clean({ x: x, y: y }); } // where a press on the floor walks her
    return { free: free, clean: clean, move: move, reach: reach, stand: stand, step: step, scale: scale, point: point, blocks: blocks };
  }

  return { slide: slide, toward: toward, follow: follow, heldWay: heldWay, floor: floor };
});
