'use strict';

/**
 * Lumi Launch's page (erinne templates/games/lumi-launch.html). Tuning id: 'launch'. The Launch agent owns this file.
 * Couch turns were a TV feature; the button stays (free play on one screen) - the Launch agent decides its fate.
 */

// The sounds JSON erinne put in data-sounds (paths now under /lumipet/static/).
function sounds(h) {
  const s = (rel) => h.rawStatic(rel);                                           // unversioned static URL
  return JSON.stringify({
    pop: [1, 2, 3, 4].map((n) => s(`lumi-soft/sounds/pop${n}.wav`)),             // four pops
    rollup: s('lumi-soft/sounds/roll-up.wav'),                                   // roll-up
    yay: s('lumi-soft/sounds/yay.mp3'),                                          // cheer
    aww: s('lumi-soft/sounds/aw-dangit.mp3'),                                    // aww
    ding: s('lumi-soft/sounds/ding.wav'),                                        // ding
    bounce: [2, 4, 6, 8].map((n) => s(`breakout/assets/bounce-${n}.wav`)),       // bounces
  });
}

// erinne lumi-launch.html.
function body(h) {
  return `<section class="ll-stage" id="ll-stage" data-menu="true"
         data-sounds="${h.esc(sounds(h))}">
  <canvas id="ll-view" role="img" aria-label="Lumi Launch: Lumi in her star cannon at the start of a long, starry course."></canvas>

  <div class="ll-hud ll-left" id="ll-hud-left" hidden>
    <div class="ll-who" id="ll-who"></div>
    <div class="ll-line"><span id="ll-shot-label">Launch</span> <b id="ll-shot">1 / 3</b></div>
    <div class="ll-line"><span>Total</span> <b id="ll-total">0 m</b></div>
  </div>
  <div class="ll-hud ll-right" id="ll-hud-right" hidden>
    <div class="ll-far" id="ll-far">0 m</div>
    <div class="ll-puffs" id="ll-puffs" aria-label="Sparkle puffs"></div>
    <div class="ll-line"><span>Best launch</span> <b id="ll-best">0 m</b></div>
  </div>
  <p class="ll-hint" id="ll-hint" aria-live="polite" hidden></p>
  <p class="ll-toast" id="ll-toast" aria-live="polite" hidden></p>

  <div class="ll-touch" id="ll-touch" hidden>
    <button type="button" class="ll-touch-nudge" data-tap="down" aria-label="Lower the angle">▼</button>
    <button type="button" class="ll-touch-nudge" data-tap="up" aria-label="Raise the angle">▲</button>
    <button type="button" class="ll-touch-ok" data-tap="enter" aria-label="OK">OK</button>
  </div>

  <div class="gm-panel ll-panel" id="ll-title" hidden>
    <p class="gm-eyebrow">Lumi’s arcade</p>
    <h1 class="gm-title">LUMI<span> LAUNCH</span></h1>
    <p class="ll-lead">Pop Lumi into her star cannon and see how far she flies! Bounce her off Cloud Pillows, Teacup Flingers and Yarn Rolls, ride the Wish Wind, and keep her out of the honey.</p>
    <p class="ll-coins">SGC <b id="ll-coins">—</b></p>
    <div class="ll-menu" id="ll-menu">
      <button type="button" class="gm-primary" data-go="solo"><b>Play a go</b><small id="ll-solo-note">3 launches</small></button>
      <button type="button" data-go="couch"><b>Couch turns</b><small>Take turns · free play</small></button>
      <button type="button" data-go="board"><b>Best launches</b><small id="ll-board-note">Everyone in Lumi-Town</small></button>
      <button type="button" data-go="sound"><b id="ll-sound">Sound: on</b><small>Doll’s sample pack</small></button>
    </div>
    <p class="ll-error" id="ll-error" role="alert" hidden></p>
    <dl class="ll-keys">
      <dt>OK</dt><dd>Lock the angle · fire · a sparkle puff in the air</dd>
      <dt>▲ ▼</dt><dd>Nudge the angle (the needle stops for you)</dd>
      <dt>P / ⏯</dt><dd>Pause</dd>
      <dt>Works with</dt><dd>Enter or Space · a tap or a click · a gamepad (A, D-pad, Start)</dd>
    </dl>
  </div>

  <div class="gm-panel ll-panel" id="ll-board" hidden>
    <p class="gm-eyebrow">Best launches</p>
    <h2 class="ll-page-title">The longest goes</h2>
    <ol class="ll-rows" id="ll-board-list"></ol>
    <p class="ll-small" id="ll-board-mine"></p>
    <button type="button" class="gm-primary" data-go="menu">Back</button>
  </div>

  <div class="gm-panel ll-panel" id="ll-couch" hidden>
    <p class="gm-eyebrow">Couch turns · free play</p>
    <h2 class="ll-page-title">Who’s launching?</h2>
    <p class="ll-lead" id="ll-couch-how">Press A on a gamepad to join. Up to four Lumis.</p>
    <ol class="ll-rows" id="ll-couch-list"></ol>
    <button type="button" class="gm-primary" data-go="couch-start" id="ll-couch-start">Start (3 rounds)</button>
    <button type="button" data-go="couch-here">Add a player on this screen</button>
    <button type="button" data-go="menu">Back</button>
  </div>

  <div class="gm-panel ll-panel" id="ll-scores" hidden>
    <p class="gm-eyebrow" id="ll-scores-eyebrow">Round 1 of 3</p>
    <h2 class="ll-page-title" id="ll-scores-title"></h2>
    <ol class="ll-rows" id="ll-scores-list"></ol>
    <button type="button" class="gm-primary" data-go="couch-next" id="ll-scores-next">Next launch</button>
    <button type="button" data-go="menu" id="ll-scores-menu">Back to the menu</button>
  </div>

  <div class="gm-panel ll-panel" id="ll-results" hidden>
    <p class="gm-eyebrow" id="ll-results-eyebrow">What a flight!</p>
    <h2 class="ll-page-title" id="ll-results-title"></h2>
    <ol class="ll-rows" id="ll-results-list"></ol>
    <p class="ll-earned" id="ll-results-earned"></p>
    <button type="button" class="gm-primary" data-go="solo">Another go</button>
    <button type="button" data-go="menu">Back to the menu</button>
  </div>

  <div class="gm-panel ll-panel" id="ll-pause" hidden>
    <p class="gm-eyebrow">Paused</p>
    <h2 class="ll-page-title">Lumi’s waiting in the cannon~</h2>
    <button type="button" class="gm-primary" data-go="resume">Keep going</button>
    <button type="button" data-go="quit" id="ll-quit">End the go</button>
    <p class="ll-small" id="ll-quit-note">Ending now still counts the launches she’s finished.</p>
  </div>
</section>`;                                                                      // erinne's markup, coins -> SGC
}

/** Register the Lumi Launch page. */
function register(pages) {
  pages.registerPage({
    slug: 'lumi-launch',                                                         // /lumipet/lumi-launch
    title: 'Lumi Launch',                                                        // tab title
    aliases: ['launch'],                                                         // short URL
    css: ['common.css', 'lumi-launch/game.css'],                                 // no extra .css
    scripts: ['common.js', 'lumi-launch/rules.js', 'lumi-pet/closet.js', 'arcade/lumi-sprite.js', 'gamepad.js', 'lumi-launch/game.js'], // erinne order
    card: { icon: '🎇', name: 'Lumi Launch', description: 'Fire Lumi from her star cannon and see how far she flies. Three launches a go; distance pays SGC.', order: 11 }, // hub card
    body,                                                                        // markup
  });
}

module.exports = { register };
