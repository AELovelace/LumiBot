'use strict';

/**
 * Prism Drop's page (erinne templates/games/prism-drop.html). Tuning id: 'prism'. The Prism agent owns this file.
 */

// erinne prism-drop.html.
function body(h) {
  return `<section class="gm-panel pd-score" aria-label="Score">
  <p class="gm-eyebrow">// LUMI'S ARCADE</p>
  <h1 class="gm-title">PRISM<span>DROP</span></h1>
  <p class="pd-lead">You pick the pocket, Lumi drops the ball.</p>
  <dl class="pd-stats">
    <div><dt>Score</dt><dd id="pd-score">0</dd></div>
    <div><dt>Best</dt><dd id="pd-best">0</dd></div>
    <div><dt>Drop</dt><dd id="pd-drop">1 / 10</dd></div>
    <div><dt>SGC</dt><dd id="pd-coins">—</dd></div>
  </dl>
  <p class="pd-result" id="pd-result" role="status" aria-live="polite">Pick a pocket, then drop.</p>
  <p class="pd-note">Lumi carries the ball to your pocket, lets it go, and flies down to fetch it for the next drop.</p>
</section>
<section class="pd-machine">
  <canvas id="pd-field" width="640" height="920" role="img"
          aria-label="Ten columns and twenty rows of neon pins over ten numbered pockets."></canvas>
</section>
<section class="gm-panel pd-controls" aria-label="Controls">
  <p class="gm-eyebrow">// POINTS</p>
  <ul class="pd-points">
    <li><b>20</b> right pocket</li>
    <li><b>15</b> one away</li>
    <li><b>10</b> two away</li>
    <li class="pd-coin"><b>+1–5</b> each coin peg</li>
  </ul>
  <p class="gm-eyebrow">// PEGS</p>
  <ul class="pd-legend">
    <li class="pd-block">Block: shoves two sideways</li>
    <li class="pd-bomb">Bomb: blasts it 2–3 any way</li>
    <li class="pd-coinpeg">Coin: bonus points</li>
    <li class="pd-platform">Platform: slides, bounces it back up</li>
  </ul>
  <div class="pd-buttons">
    <button type="button" id="pd-drop-button" class="gm-primary">Drop ↓</button>
    <button type="button" id="pd-replay">↺ Replay</button>
    <button type="button" id="pd-sound" aria-pressed="true">Sound: on</button>
  </div>
  <p class="gm-keys">◀ ▶ pick · Enter drop · ▲ replay · ▼ sound</p>
</section>`;                                                                      // erinne's markup, coins -> SGC
}

/** Register the Prism Drop page. */
function register(pages) {
  pages.registerPage({
    slug: 'prism-drop',                                                          // /lumipet/prism-drop
    title: 'Prism Drop',                                                         // tab title
    css: ['common.css', 'prism-drop/game.css'],                                  // no extra .css
    scripts: ['common.js', 'prism-drop/rules.js', 'lumi-pet/closet.js', 'arcade/lumi-sprite.js', 'prism-drop/game.js'], // erinne order
    card: { icon: '🔮', name: 'Prism Drop', description: 'Pick a pocket and Lumi drops her glowing ball through blocks, bombs and bonus pegs. Ten drops; your score pays SGC.', order: 10 }, // hub card
    body,                                                                        // markup
  });
}

module.exports = { register };
