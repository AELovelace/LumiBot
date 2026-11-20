'use strict';

/**
 * Lumi games: the HTML pages. Replaces erinne's Jinja templates (templates/game.html + templates/games/*.html).
 *
 * A game page = the shared shell below + the game's own body markup (a view in src/lumi/views/*.js) + its
 * stylesheets and scripts IN THE EXACT ORDER erinne's game.html loaded them. The shell:
 *  - escapes everything it prints, sets data-theme="neon" (public/lumi/theme.css has the theme's CSS variables),
 *  - carries NO inline JavaScript (CSP script-src 'self'): its settings ride in <script type="application/json"
 *    id="lumi-boot"> and public/lumi/lumi-boot.js turns them into window.LUMI_API, LUMI_STATIC, LUMI_PAGES,
 *    LUMI_TUNING, LUMI_USER and LUMI_FLAGS (tvPlay / whoPlays / retro are always false here),
 *  - loads public/lumi/lumi-tuning.js, which gives every page LumiPrice(game, key, native) / LumiPayout(...).
 *
 * Register a page from a view module:  pages.registerPage({ slug, title, kit, scripts, body: (h) => '...' })
 */

const { scriptJson } = require('../webPanelAuth');
const tuning = require('./tuning');
const staticFiles = require('./static');
const { logger } = require('../logger');

const pages = new Map();                       // slug -> page definition
const aliases = new Map();                     // alias -> slug (e.g. 'yarn-pop' -> 'breakout')
let BASE = '/lumipet';                         // set by configure()

/** index.js tells pages.js the base path once at start. */
function configure({ base }) {
  BASE = base;                                 // e.g. '/lumipet'
}

/** HTML-escape text (and attribute values). */
function esc(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/gu, '&amp;')                   // & first
    .replace(/</gu, '&lt;')                    // <
    .replace(/>/gu, '&gt;')                    // >
    .replace(/"/gu, '&quot;')                  // "
    .replace(/'/gu, '&#39;');                  // '
}

/** A /lumipet/static/... URL with a cache-busting ?v= (the file's mtime). */
function staticUrl(rel) {
  return `${BASE}/static/${rel.split('/').map(encodeURIComponent).join('/')}?v=${staticFiles.version(rel)}`; // versioned URL
}

/** The helpers every view's body(h) gets. */
function helpers() {
  return {
    esc,                                                                         // escape text
    staticUrl,                                                                   // versioned static URL
    rawStatic: (rel) => `${BASE}/static/${rel}`,                                 // unversioned (for JSON data attributes)
    price: (game, key, native) => tuning.scalePrice(game, key, native),          // SGC a thing costs (same as the charge)
    payout: (game, key, native) => tuning.scalePayout(game, key, native),        // SGC a prize pays
    sgc: (n) => `${Number(n || 0).toLocaleString('en-US')} SGC`,                 // "1,234 SGC"
    base: BASE,                                                                  // '/lumipet'
  };
}

/**
 * Register a page.
 * @param {object} def
 *   slug      URL piece: /lumipet/<slug> (lowercase, dashes)
 *   title     <title> text
 *   name      data-name on <main> (default: title)
 *   kit       folder under public/lumi this page is built from (default: slug); data-kit on <main>
 *   css       stylesheet paths under public/lumi, in order (default: ['common.css', `${kit}/game.css`])
 *   scripts   script paths under public/lumi, IN LOAD ORDER (default: ['common.js', `${kit}/rules.js`, `${kit}/game.js`])
 *   body      (h, page, view) => HTML string for inside <main class="gm" id="gm">; h = helpers()
 *   card      { icon, name, description, order } to show on the hub, or null to hide it there
 *   icon      favicon path under public/lumi (default 'icons/lumi.svg')
 *   touchIcon apple-touch-icon path under public/lumi (optional)
 *   aliases   other slugs that redirect here (e.g. ['yarn-pop'])
 *   ...       anything else (tabs, words) is kept on the definition for the view to use
 */
function registerPage(def) {
  if (!def || !/^[a-z0-9-]{1,40}$/u.test(String(def.slug))) throw new Error(`registerPage: bad slug "${def && def.slug}"`); // URL-safe slug
  if (typeof def.body !== 'function') throw new Error(`registerPage(${def.slug}): body must be a function`); // markup builder
  const kit = def.kit || def.slug;                                               // asset folder
  const page = {
    ...def,                                                                      // keep the view's own fields
    kit,                                                                         // resolved kit
    name: def.name || def.title || def.slug,                                     // data-name
    title: def.title || def.slug,                                                // <title>
    css: def.css || ['common.css', `${kit}/game.css`],                           // stylesheets in order
    scripts: def.scripts || ['common.js', `${kit}/rules.js`, `${kit}/game.js`],  // scripts in order
    icon: def.icon || 'icons/lumi.svg',                                          // favicon
  };
  for (const rel of [...page.css, ...page.scripts]) {                            // catch typos at start-up
    if (!staticFiles.exists(rel)) logger.warn(`Lumi page ${page.slug}: ${rel} is not in public/lumi.`); // loud, not fatal
  }
  pages.set(page.slug, page);                                                    // store (re-registering replaces)
  for (const alias of def.aliases || []) aliases.set(alias, page.slug);          // short names
  return page;                                                                   // the stored definition
}

/** A registered page by slug, or null. */
function getPage(slug) {
  return pages.get(slug) || null;                                                // definition or null
}

/** The slug an alias points to, or null. */
function aliasOf(slug) {
  return aliases.get(slug) || null;                                              // e.g. 'breakout'
}

/** Every page (hub cards come from these). */
function listPages() {
  return [...pages.values()];                                                    // registration order
}

/** The window.LUMI_* settings for a page, as JSON for <script type="application/json" id="lumi-boot">. */
function bootData(user) {
  return {
    api: `${BASE}/api/`,                                                         // window.LUMI_API
    static: `${BASE}/static/`,                                                   // window.LUMI_STATIC
    pages: `${BASE}/`,                                                           // window.LUMI_PAGES (links to other games)
    tuning: tuning.clientTuning(),                                               // window.LUMI_TUNING
    user: user ? { id: user.id, name: user.name } : null,                        // window.LUMI_USER
    flags: { tvPlay: false, whoPlays: false, retro: false },                     // window.LUMI_FLAGS (erinne's tv_play/who_plays/retro_on)
  };
}

/** The <head> parts every Lumi page shares. */
function head({ title, icon, touchIcon, css, user }) {
  return [
    '<meta charset="utf-8">',                                                    // UTF-8
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">', // phones
    '<meta name="color-scheme" content="dark">',                                 // neon is dark
    '<meta name="theme-color" content="#1a0f2e">',                               // browser chrome colour
    `<title>${esc(title)}</title>`,                                              // tab title
    `<link rel="icon" href="${esc(staticUrl(icon))}">`,                          // favicon
    touchIcon ? `<link rel="apple-touch-icon" href="${esc(staticUrl(touchIcon))}">` : '', // home-screen icon
    `<link rel="stylesheet" href="${esc(staticUrl('theme.css'))}">`,             // theme variables (always first)
    ...css.map((rel) => `<link rel="stylesheet" href="${esc(staticUrl(rel))}">`), // the page's own stylesheets
    `<script type="application/json" id="lumi-boot">${scriptJson(bootData(user))}</script>`, // settings (data, not code)
    `<script src="${esc(staticUrl('lumi-boot.js'))}"></script>`,                 // -> window.LUMI_*
    `<script src="${esc(staticUrl('lumi-tuning.js'))}"></script>`,               // -> LumiPrice / LumiPayout
  ].filter(Boolean).join('\n');                                                  // one tag per line
}

/** Render a registered game page for a player. Returns HTML, or null when the slug isn't registered. */
function render(slug, { user } = {}) {
  const page = pages.get(slug);                                                  // the definition
  if (!page) return null;                                                        // unknown page
  const h = helpers();                                                           // view helpers
  const data = Object.entries(page.data || {})                                   // extra data-* attributes
    .map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join('');                    // escaped
  return `<!doctype html>
<html lang="en" data-theme="neon">
<head>
${head({ title: page.title, icon: page.icon, touchIcon: page.touchIcon, css: page.css, user })}
</head>
<body>
<main class="gm" id="gm" data-game="${esc(page.slug)}" data-kit="${esc(page.kit)}" data-name="${esc(page.name)}"${data}>
${page.body(h, page, { user })}
</main>
${page.scripts.map((rel) => `<script src="${esc(staticUrl(rel))}"></script>`).join('\n')}
</body>
</html>`;                                                                         // erinne's game.html, in HTML
}

/**
 * The hub at /lumipet/: hello, the player's SGC, their Lumi, and a card per game (pages with a `card`).
 * @param {{ user, coins: number, look: {name, glow, colour} }} info
 */
function renderHub({ user, coins, look }) {
  const cards = listPages().filter((p) => p.card)                                // only pages that want a card
    .sort((a, b) => (a.card.order || 99) - (b.card.order || 99))                 // in their order
    .map((p) => `
    <a class="hub-card hub-game" href="${esc(`${BASE}/${p.slug}`)}">
      <span class="hub-icon" aria-hidden="true">${esc(p.card.icon || '✦')}</span>
      <b>${esc(p.card.name || p.title)}</b>
      <small>${esc(p.card.description || '')}</small>
    </a>`).join('');                                                             // one link each
  const glow = look && look.colour ? look.colour : '';                           // her own colour, if set
  return `<!doctype html>
<html lang="en" data-theme="neon">
<head>
${head({ title: 'Lumi-Town', icon: 'icons/lumi.svg', touchIcon: 'icons/lumi-180.png', css: ['hub.css'], user })}
</head>
<body>
<main class="hub">
  <section class="hub-card hub-hello">
    <p class="hub-eyebrow">// LUMI-TOWN</p>
    <h1 class="hub-title">HELLO,<span>${esc(user ? user.name : 'friend')}</span></h1>
    <dl class="hub-stats">
      <div><dt>Your SGC</dt><dd id="hub-coins">${esc(Number(coins || 0).toLocaleString('en-US'))}</dd></div>
      <div><dt>Your Lumi</dt><dd><span class="hub-glow hub-glow-${esc(look ? look.glow : 'rose')}"${glow ? ` data-colour="${esc(glow)}"` : ''}></span> ${esc(look ? look.name : 'Lumi')}</dd></div>
    </dl>
    <p class="hub-note">Every coin here is real SadGirlCoin. Shops sell, prizes pay, and Lumi-Town Bank keeps it all going.</p>
    <form method="post" action="${esc(`${BASE}/auth/logout`)}"><button type="submit" class="hub-link">Sign out</button></form>
  </section>
  <section class="hub-games" aria-label="Games">${cards}
  </section>
</main>
<script src="${esc(staticUrl('hub.js'))}"></script>
</body>
</html>`;                                                                         // the hub page
}

module.exports = {
  configure,      // set the base path
  registerPage,   // add a page
  getPage,        // a page by slug
  aliasOf,        // alias -> slug
  listPages,      // every page
  render,         // HTML for a game page
  renderHub,      // HTML for the hub
  bootData,       // window.LUMI_* values (tests)
  esc,            // HTML escape
  staticUrl,      // versioned static URL
  helpers,        // view helpers
};
