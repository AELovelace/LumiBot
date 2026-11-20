'use strict';

/**
 * Lumi Pet's page kit (erinne templates/games/lumi-pet.html + games.py), shared by four apps that show different
 * tabs over the same room: Lumi Pet, Lumi Dungeons, Lumi's Garden and Lumi City (lumi-town, reached through her
 * door, so no hub card). Scripts load in erinne game.html's exact order: common.js, rules.js, the 28 kit parts,
 * the extras, then game.js. The pet agent owns this file from here on.
 */

// erinne game.html: every lumi-pet kit part, in load order (city/walker/town-inside/estate included).
const KIT_PARTS = ['house', 'closet', 'picker-ui', 'enemies', 'battle-ui', 'dungeon-ui', 'dungeon-art', 'tavern-art',
  'garden-ui', 'garden-art', 'garden-tree', 'garden-tree-art', 'skills-ui', 'skills-art', 'collection-ui',
  'collection-art', 'party-ui', 'walker', 'town-ui', 'town-art', 'town-folk', 'estate-art', 'city-map', 'city-art',
  'town-inside', 'room-ui', 'room-styles', 'room-art'];

const TAB_NAMES = { care: 'Care', pantry: 'Pantry', toys: 'Toys', closet: 'Closet', home: 'Home', battle: 'Battle', // tab labels
  skills: 'Skills', dungeon: 'Dungeon', garden: 'Garden', shop: 'Shop', collection: 'Collection', settings: 'Settings', town: 'Town' };

// erinne games.py: the four apps on this kit.
const APPS = [
  { slug: 'lumi-pet', title: 'Lumi Pet', icon: '✨', touchIcon: 'icons/lumi-180.png', svg: 'icons/lumi.svg', aliases: ['pet'], order: 1,
    words: ['// A LITTLE LIGHT, JUST FOR YOU', 'LUMI', 'PET', 'A soft place to land.'],
    tabs: ['care', 'pantry', 'toys', 'closet', 'home', 'shop', 'collection', 'settings'], extras: ['gamepad.js'],
    description: 'A little neon companion to feed, cuddle, dress and make a home for. Your first visit each day pays SGC.' },
  { slug: 'lumi-dungeons', title: 'Lumi Dungeons', icon: '🗝', touchIcon: 'icons/lumi-dungeons-180.png', svg: 'icons/lumi-dungeons.svg', aliases: ['dungeons'], order: 2,
    words: ['// DOWN WHERE THE TREASURE IS', 'LUMI', 'DUNGEONS', 'Brave little paws.'],
    tabs: ['dungeon', 'battle', 'skills', 'settings'], extras: [],
    description: 'Take Lumi through twelve dungeons of rooms, puzzle doors and treasure, or into the arena for a fight.' },
  { slug: 'lumi-garden', title: 'Lumi’s Garden', icon: '🌸', touchIcon: 'icons/lumi-garden-180.png', svg: 'icons/lumi-garden.svg', aliases: ['garden'], order: 3,
    words: ['// THE STARDUST GARDEN', 'LUMI’S', 'GARDEN', 'Flowers, powder and patience.'],
    tabs: ['garden', 'settings'], extras: [],
    description: 'Plant flowers, trim them when they’re ready, and press their starpowder into SGC.' },
  { slug: 'lumi-town', title: 'Lumi City', icon: '🏙', touchIcon: 'icons/lumi-180.png', svg: 'icons/lumi.svg', aliases: ['town', 'city'], order: 4, hidden: true,
    words: ['// WHERE SHALL WE GO?', 'LUMI', 'CITY', 'LefTown, Downtown and Right-City: walk anywhere.'],
    tabs: ['town'], extras: ['gamepad.js'],
    description: 'Walk LefTown, Downtown and Right-City, visit friends, buy a plot and build a house.' },
];

// erinne lumi-pet.html, as a template literal. h = pages.helpers(); app = one of APPS.
function body(h, app) {
  const [eyebrow, title1, title2, lead] = app.words;                                // the four header lines
  const roomName = { 'lumi-dungeons': 'THE LANTERN & PAW', 'lumi-town': 'LUMI CITY' }[app.slug] || 'THE STARLIGHT NOOK'; // room caption
  const meters = [['hunger', 'Tummy'], ['energy', 'Energy'], ['joy', 'Joy']]         // her three needs
    .map(([m, label]) => `
    <div class="lp-meter"><span>${label}</span>
      <div class="lp-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="lp-${m}"></i></div>
      <b id="lp-${m}-n">–</b></div>`).join('');
  const tabs = app.tabs.map((tab, i) => `<button type="button" role="tab" data-lp-tab="${h.esc(tab)}" aria-selected="${i === 0 ? 'true' : 'false'}">${h.esc(TAB_NAMES[tab])}</button>`).join('\n    '); // this app's tabs
  const tints = [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]                         // colour sliders
    .map(([p, label]) => `<label><span>${label}</span><input type="range" min="0" max="255" step="1" data-tint="${p}" aria-label="${label}"><b data-tint-n="${p}">0</b></label>`).join('\n    ');
  return `<section class="lp-intro gm-panel" aria-label="Your companion">
  <p class="gm-eyebrow">${h.esc(eyebrow)}</p>
  <h1 class="gm-title">${h.esc(title1)}<span>${h.esc(title2)}</span></h1>
  <p class="lp-lead">${h.esc(lead)}</p>
  <div class="lp-meters">${meters}
    <div class="lp-meter"><span>Health</span>
      <div class="lp-bar" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="lp-health"></i></div>
      <b id="lp-health-n">–</b></div>
  </div>
  <dl class="lp-stats">
    <div><dt>Name</dt><dd id="lp-name">Lumi</dd></div>
    <div><dt>Level</dt><dd id="lp-level">1</dd></div>
    <div><dt>Happy moments</dt><dd id="lp-moments">0</dd></div>
    <div><dt>Last little memory</dt><dd id="lp-memory">Our first hello</dd></div>
    <div><dt>SGC</dt><dd id="lp-coins">—</dd></div>
  </dl>
  <p class="lp-note">Lumi gets hungry, sleepy and lonely while you’re away. She never loses anything, and a snack and a cuddle set her right.</p>
  <p class="lp-save" id="lp-save">Lumi lives on your Discord account: the same on your phone and computer.</p>
</section>

<section class="lp-room" id="lp-room" data-palette="rose" data-sleep="false" aria-label="Lumi's room">
  <div class="lp-room-top"><span id="lp-place">${h.esc(roomName)}</span><span class="lp-player" id="lp-player" hidden></span><span id="lp-clock">A quiet afternoon</span></div>
  <svg class="lp-house" id="lp-house" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>
  <svg class="lp-dungeon" id="lp-dungeon" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="display: none"></svg>
  <svg class="lp-folk" id="lp-folk" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>
  <form class="lp-chat-type" id="lp-chat-type" hidden><input id="lp-chat-input" maxlength="140" autocomplete="off" enterkeyhint="send" aria-label="Say something to everyone here" placeholder="Say something to everyone here…"><button type="submit">Say</button></form>
  <div class="lp-dhud" id="lp-dhud" hidden>
    <span id="lp-d-title"></span>
    <div class="lp-bar"><i id="lp-d-hp"></i></div><div class="lp-bar lp-bar-mp"><i id="lp-d-mp"></i></div>
    <small id="lp-d-label"></small>
  </div>
  <div class="lp-fight" id="lp-fight" hidden>
    <div class="lp-fight-bars">
      <div><span id="lp-f-lumi">Lumi</span><div class="lp-bar"><i id="lp-f-hp"></i></div><div class="lp-bar lp-bar-mp"><i id="lp-f-mp"></i></div></div>
      <div><span id="lp-f-foe"></span><div class="lp-bar lp-bar-foe"><i id="lp-f-foehp"></i></div></div>
    </div>
    <svg class="lp-foe" id="lp-foe" viewBox="0 0 200 200" role="img" aria-label="The enemy"></svg>
    <div class="lp-team" id="lp-team" hidden><ol class="lp-team-lumis" id="lp-team-lumis"></ol><div class="lp-team-foes" id="lp-team-foes"></div></div>
  </div>
  <div class="lp-crew" id="lp-crew" aria-label="Your party" hidden></div>
  <div class="lp-pet-wrap">
    <span class="lp-effect" id="lp-effect" aria-hidden="true">♡</span>
    <svg class="lp-pet" id="lp-pet" viewBox="0 0 320 300" role="img" aria-labelledby="lp-pet-title">
      <title id="lp-pet-title">Lumi, a little glowing cat with fairy wings</title>
      <g class="lp-wings">
        <path d="M113 176 C8 187 25 74 79 108 C104 122 113 153 113 176Z"/>
        <path d="M207 176 C312 187 295 74 241 108 C216 122 207 153 207 176Z"/>
        <path d="M109 182 C36 174 48 238 93 215Z M211 182 C284 174 272 238 227 215Z"/>
      </g>
      <g id="lp-acc-back"></g>
      <path class="lp-tail" d="M217 228 C279 254 286 188 256 193 C238 196 260 215 239 218"/>
      <ellipse class="lp-body" cx="160" cy="214" rx="62" ry="57"/>
      <ellipse class="lp-belly" cx="160" cy="230" rx="36" ry="31"/>
      <path class="lp-body" d="M92 153 L88 62 Q89 49 100 58 L137 93 Q160 83 183 93 L220 58 Q231 49 232 62 L228 153 Q230 204 160 208 Q90 204 92 153Z"/>
      <path class="lp-ear" d="M101 77 L106 118 L126 102Z M219 77 L214 118 L194 102Z"/>
      <path class="lp-star" d="M160 103 L165 116 L179 120 L165 125 L160 139 L155 125 L141 120 L155 116Z"/>
      <g class="lp-eyes-open"><ellipse cx="129" cy="153" rx="5" ry="9"/><ellipse cx="191" cy="153" rx="5" ry="9"/></g>
      <g class="lp-eyes-closed"><path d="M120 154 Q129 163 138 154 M182 154 Q191 163 200 154"/></g>
      <ellipse class="lp-cheek" cx="114" cy="169" rx="13" ry="6"/><ellipse class="lp-cheek" cx="206" cy="169" rx="13" ry="6"/>
      <path class="lp-mouth" d="M155 165 L160 169 L165 165 M160 169 Q151 184 145 173 M160 169 Q169 184 175 173"/>
      <ellipse class="lp-paw" cx="123" cy="259" rx="24" ry="13"/><ellipse class="lp-paw" cx="197" cy="259" rx="24" ry="13"/>
      <g id="lp-acc-front"></g>
    </svg>
  </div>
  <div class="lp-caption"><span class="lp-dot" aria-hidden="true"></span><span id="lp-state">Settling in</span></div>
  <p class="lp-guide" id="lp-guide" aria-hidden="true" hidden></p>
  <nav class="lp-things" id="lp-things" aria-label="Things in the room" hidden></nav>
  <button type="button" class="lp-way lp-way-left" id="lp-way-left" hidden><span aria-hidden="true">◀</span><span data-way-name></span></button>
  <button type="button" class="lp-way lp-way-right" id="lp-way-right" hidden><span data-way-name></span><span aria-hidden="true">▶</span></button>
  <div class="lp-pad" id="lp-pad" role="group" aria-label="Move" hidden>
    <button type="button" data-pad="up" aria-label="Up">▲</button>
    <button type="button" data-pad="left" aria-label="Left">◀</button>
    <button type="button" data-pad="enter" aria-label="Choose">●</button>
    <button type="button" data-pad="right" aria-label="Right">▶</button>
    <button type="button" data-pad="down" aria-label="Down">▼</button>
  </div>
  <button type="button" class="lp-squeeze" id="lp-squeeze" aria-label="Press the powder" hidden><span aria-hidden="true">◎</span><small>Press</small></button>
</section>

<section class="lp-controls gm-panel" aria-label="Spend time with Lumi">
  <p class="gm-eyebrow">// MAKE A LITTLE MOMENT</p>
  <div class="lp-story" id="lp-story" aria-label="The story so far"></div>
  <p id="lp-message" class="lp-message" role="status" aria-live="polite">Hello, you. There’s a place beside me.</p>
  <ul class="lp-chat-log" id="lp-chat-log" aria-label="What's being said here" aria-live="polite" hidden></ul>
  <div class="lp-tabs" role="tablist" aria-label="What to do" data-count="${app.tabs.length}">
    ${tabs}
  </div>
  <div class="lp-tint" id="lp-tint" hidden>
    ${tints}
  </div>
  <div class="lp-actions" id="lp-list" aria-label="Choices"></div>
  <div class="lp-couch" id="lp-couch" aria-label="Everyone's choices" aria-live="polite" hidden></div>
  <p class="gm-keys" id="lp-keys">⏮ ⏭ change tab · ▲ ▼ choose<br>◀ ▶ flip a row's choices · Enter does it<br>Keyboard: Page Up / Page Down or [ ]<br>Escape / Back returns to the Lumi hub</p>
</section>`;                                                                        // erinne's markup, with SGC labels
}

/** Register the four Lumi Pet kit pages (index.js calls this at start). */
function register(pages) {
  for (const app of APPS) {
    pages.registerPage({
      slug: app.slug,                                                               // /lumipet/lumi-pet ...
      title: app.title,                                                             // tab title
      kit: 'lumi-pet',                                                              // all four share the kit
      tabs: app.tabs,                                                               // this app's tabs
      words: app.words,                                                             // header lines
      icon: app.svg,                                                                // favicon
      touchIcon: app.touchIcon,                                                     // home-screen icon
      aliases: app.aliases,                                                         // short URLs
      css: ['common.css', 'lumi-pet/game.css'],                                     // erinne: common.css, kit game.css (no extra .css)
      scripts: ['common.js', 'lumi-pet/rules.js', ...KIT_PARTS.map((p) => `lumi-pet/${p}.js`), ...app.extras, 'lumi-pet/game.js'], // exact erinne order
      card: app.hidden ? null : { icon: app.icon, name: app.title, description: app.description, order: app.order }, // hub card (City: none)
      body: (h) => body(h, app),                                                    // the markup
    });
  }
}

module.exports = { register, KIT_PARTS, APPS };
