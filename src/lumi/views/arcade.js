'use strict';

/**
 * Lumi's arcade shell (erinne templates/games/arcade-lobby.html, used by breakout.html, snake.html, teacup-tower.html):
 * Yarn Pop (slug breakout), Lumi Conga (slug snake) and Teacup Tower. The slug is also each game's tuning id, so the
 * entry shown here is tuning.scalePrice(slug, 'entry', 25) - the same number sgc.spend(..., slug, 'entry') charges.
 * The arcade agent owns this file from here on.
 */

const ENTRY_NATIVE = 25;                       // erinne arcade.py: a run (or a showdown seat) costs 25 coins

const GAMES = [                                // erinne games.py entries for the three shell games
  { slug: 'breakout', name: 'Yarn Pop', icon: '🧶', aliases: ['yarn-pop'], order: 20, lead: 'Bounce Lumi, pop the yarn.',
    description: 'Lumi curls up into a ball and you bounce her off a cushion to pop every block: catch treats, juggle her friends, clear level after level. Race someone in a showdown while others bet.',
    controls: '◀ ▶ move the cushion · Enter or ▲ launches Lumi · P pauses · menus: arrows and Enter' },
  { slug: 'snake', name: 'Lumi Conga', icon: '💃', aliases: ['lumi-conga'], order: 21, lead: 'Everybody conga!',
    description: 'Lead a conga line of Lumis: pick up the Lumis waiting around the room and they join the end of the line. Don\'t bump the walls or the line. Race someone in a showdown while others bet.',
    controls: 'Arrows turn · the first arrow starts · P pauses · menus: arrows and Enter' },
  { slug: 'teacup-tower', name: 'Teacup Tower', icon: '🫖', aliases: [], order: 22, lead: 'Brave little bounces.',
    description: 'Lumi bounces up an endless tower of teacups: steer her, run at the walls to fly higher, string big hops into combos. Race someone in a showdown.',
    controls: '◀ ▶ steer · she bounces by herself · faster sideways jumps higher · P pauses · menus: arrows and Enter' },
];

// erinne arcade-lobby.html.
function body(h, g) {
  const words = g.name.split(' ');                                               // "Yarn Pop" -> YARN / POP
  const first = words[0].toUpperCase();                                          // first word
  const rest = words.slice(1).join(' ').toUpperCase();                           // the rest
  const entry = h.price(g.slug, 'entry', ENTRY_NATIVE);                          // SGC per run, from tuning
  return `<section class="ar-stage">
  <canvas id="ar-canvas" width="1366" height="768" role="img" aria-label="${h.esc(g.name)}"></canvas>
  <p class="ar-coins">SGC <b id="ar-coins">—</b></p>
  <div class="ar-panel gm-panel" id="ar-panel">
    <div id="ar-menu">
      <p class="gm-eyebrow">// LUMI'S ARCADE</p>
      <h1 class="gm-title ar-name">${h.esc(first)}<span>${h.esc(rest)}</span></h1>
      <p class="ar-lead">${h.esc(g.lead)}</p>
      <p class="ar-muted">${h.esc(g.description)}</p>
      <div class="ar-actions">
        <button type="button" id="ar-solo" class="gm-primary" data-icon="✦">Play solo (${entry} SGC)</button>
        <button type="button" id="ar-showdown" data-icon="♡">Showdown tables</button>
        <button type="button" id="ar-sound" data-icon="♪">Sound: on</button>
      </div>
      <p class="ar-muted">Best on this device: <b id="ar-best">0</b></p>
      <p class="gm-keys">${h.esc(g.controls)}</p>
    </div>
    <div id="ar-lobby" hidden>
      <p class="gm-eyebrow">// SHOWDOWN TABLES</p>
      <p class="ar-muted">Two racers play the same game side by side; the further run wins. Up to five can watch and bet. Each racer pays ${entry} SGC and is paid their own score.</p>
      <div class="ar-actions">
        <button type="button" id="ar-create" class="gm-primary" data-icon="✦">Start a table</button>
      </div>
      <div class="ar-tables" id="ar-tables"></div>
      <div class="ar-actions"><button type="button" id="ar-lobby-back" data-icon="‹">Back</button></div>
    </div>
    <div id="ar-table" hidden>
      <p class="gm-eyebrow">// SHOWDOWN</p>
      <h2 class="ar-title" id="ar-table-title"></h2>
      <div id="ar-table-body"></div>
      <p class="ar-muted">Close the game and your seat is kept for 30 seconds.</p>
    </div>
    <div id="ar-over" hidden>
      <p class="gm-eyebrow">// GAME OVER</p>
      <h2 class="ar-title" id="ar-over-title">Game over</h2>
      <p id="ar-over-line"></p>
      <div class="ar-actions">
        <button type="button" id="ar-again" class="gm-primary" data-icon="↻">Play again (${entry} SGC)</button>
        <button type="button" id="ar-over-menu" data-icon="‹">Menu</button>
      </div>
    </div>
    <p class="ar-status" id="ar-status" role="status" aria-live="polite"></p>
  </div>
</section>`;                                                                      // erinne's markup with SGC prices
}

/** Register the three arcade-shell pages. */
function register(pages) {
  for (const g of GAMES) {
    pages.registerPage({
      slug: g.slug,                                                              // /lumipet/breakout ...
      title: g.name,                                                             // tab title
      name: g.name,                                                              // data-name
      kit: g.slug,                                                               // its own folder
      aliases: g.aliases,                                                        // /lumipet/yarn-pop -> breakout
      css: ['common.css', `${g.slug}/game.css`, 'arcade/arcade.css'],            // common, kit, then the .css extra
      scripts: ['common.js', `${g.slug}/rules.js`, 'lumi-pet/closet.js', 'arcade/lumi-sprite.js', 'arcade/arcade.js', `${g.slug}/game.js`], // erinne order
      card: { icon: g.icon, name: g.name, description: g.description, order: g.order }, // hub card
      body: (h) => body(h, g),                                                   // markup
    });
  }
}

module.exports = { register, GAMES, ENTRY_NATIVE };
