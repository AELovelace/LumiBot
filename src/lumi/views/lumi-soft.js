'use strict';

/**
 * Lumi-Soft's page (erinne templates/games/lumi-soft.html). Tuning id: 'soft'. The Lumi-Soft agent owns this file.
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
  });
}

// erinne lumi-soft.html.
function body(h) {
  return `<section class="ls-stage" id="ls-stage"
         data-sounds="${h.esc(sounds(h))}">
  <canvas id="ls-view" role="img" aria-label="Lumi-Soft: a cardboard target range seen through Lumi's Star Scope."></canvas>

  <div class="ls-hud ls-left" id="ls-hud-left" hidden>
    <div class="ls-hearts" id="ls-hearts" aria-label="Hearts"></div>
    <div class="ls-ammo" id="ls-ammo" aria-label="Stardust BBs"></div>
    <div class="ls-breath"><span>Breath</span><i id="ls-breath"></i></div>
    <div class="ls-glow" id="ls-glow-wrap" hidden><span>Glow Scope (G)</span><i id="ls-glow"></i></div>
  </div>
  <div class="ls-hud ls-right" id="ls-hud-right" hidden>
    <div class="ls-clock" id="ls-clock">60.0</div>
    <div class="ls-line"><span>Score</span> <b id="ls-score">0</b></div>
    <div class="ls-line"><span>Combo</span> <b id="ls-combo">×1.0</b></div>
    <div class="ls-line" id="ls-wind-line" hidden><span>Wind</span> <b id="ls-wind"></b></div>
  </div>
  <div class="ls-spotter" id="ls-spotter" hidden><span class="ls-spotter-face" aria-hidden="true">🎧</span><p id="ls-spotter-text" aria-live="polite"></p></div>
  <p class="ls-toast" id="ls-toast" aria-live="polite" hidden></p>

  <div class="gm-panel ls-panel" id="ls-title" hidden>
    <p class="gm-eyebrow">Lumi’s range · Mouse &amp; keyboard</p>
    <h1 class="gm-title">LUMI<span>-SOFT</span></h1>
    <p class="ls-lead">Lie on your cushion, open the Star Scope and pop the cardboard creatures with your Sparkle Popper. Friends hold a ♡ sign: leave them be!</p>
    <p class="ls-coins">SGC <b id="ls-coins">—</b></p>
    <div class="ls-menu" id="ls-menu">
      <button type="button" class="gm-primary" data-go="story"><b>Story</b><small id="ls-story-note"></small></button>
      <button type="button" data-go="stages"><b>Stage select</b><small>One stage, for score</small></button>
      <button type="button" data-go="daily"><b>Daily Range</b><small id="ls-daily-note"></small></button>
      <button type="button" data-go="training"><b>Training Range</b><small>Free · no clock</small></button>
      <button type="button" data-go="prizes"><b>Prizes</b><small id="ls-prize-note"></small></button>
      <button type="button" data-go="settings"><b>Settings</b><small>Scope, reticle, sound</small></button>
    </div>
    <p class="ls-error" id="ls-error" role="alert" hidden></p>
    <dl class="ls-keys">
      <dt>Mouse</dt><dd>Aim</dd>
      <dt>Right button</dt><dd>Star Scope (hold)</dd>
      <dt>Left button</dt><dd>Pop</dd>
      <dt>Shift</dt><dd>Hold your breath: steady</dd>
      <dt>R</dt><dd>Reload</dd>
      <dt>G</dt><dd>Glow Scope (in the dark)</dd>
      <dt>P</dt><dd>Pause</dd>
    </dl>
  </div>

  <div class="gm-panel ls-panel" id="ls-page" hidden>
    <p class="gm-eyebrow" id="ls-page-eyebrow"></p>
    <h2 class="ls-page-title" id="ls-page-title"></h2>
    <div class="ls-page-body" id="ls-page-body"></div>
    <button type="button" id="ls-back">Back</button>
  </div>

  <div class="gm-panel ls-panel" id="ls-pause" hidden>
    <p class="gm-eyebrow">Paused</p>
    <h2 class="ls-page-title">Take a breath~</h2>
    <button type="button" class="gm-primary" id="ls-resume">Keep going</button>
    <button type="button" id="ls-quit">End the run</button>
    <p class="ls-small">Ending now still counts your score so far.</p>
  </div>

  <div class="gm-panel ls-panel" id="ls-over" hidden>
    <p class="gm-eyebrow">Splash!</p>
    <h2 class="ls-page-title" id="ls-over-title">Game over</h2>
    <p class="ls-lead" id="ls-over-text"></p>
    <p class="ls-countdown" id="ls-countdown"></p>
    <button type="button" class="gm-primary" id="ls-continue">Continue</button>
    <button type="button" id="ls-give-up">End the run</button>
  </div>

  <div class="gm-panel ls-panel" id="ls-results" hidden>
    <p class="gm-eyebrow" id="ls-results-eyebrow">Results</p>
    <h2 class="ls-page-title" id="ls-results-title"></h2>
    <p class="ls-big" id="ls-results-score"></p>
    <ul class="ls-ranks" id="ls-results-ranks"></ul>
    <p class="ls-earned" id="ls-results-earned"></p>
    <div class="ls-won" id="ls-results-won" hidden></div>
    <button type="button" class="gm-primary" id="ls-again">Back to the range</button>
  </div>
</section>`;                                                                      // erinne's markup, coins -> SGC
}

/** Register the Lumi-Soft page. */
function register(pages) {
  pages.registerPage({
    slug: 'lumi-soft',                                                           // /lumipet/lumi-soft
    title: 'Lumi-Soft',                                                          // tab title
    aliases: ['soft'],                                                           // short URL
    css: ['common.css', 'lumi-soft/game.css'],                                   // no extra .css
    scripts: ['common.js', 'lumi-soft/rules.js', 'lumi-pet/closet.js', 'arcade/lumi-sprite.js', 'lumi-soft/art.js', 'lumi-soft/game.js'], // erinne order
    card: { icon: '🎯', name: 'Lumi-Soft', description: 'Pop cardboard creatures through the Star Scope: five stages, bosses and a Daily Range. Mouse & keyboard.', order: 12 }, // hub card
    body,                                                                        // markup
  });
}

module.exports = { register };
