/**
 * Build the Touhou attacks seed: 3 attacks per character, written to
 * data/touhou-attacks-seed.json.
 *
 * For each character page, we fetch the wikitext (action=parse&prop=wikitext)
 * and try to extract Spell Card names. If we find ≥3 we keep the first 3.
 * Otherwise we fill remaining slots with themed generics.
 *
 * Type and base power are inferred from the spell card name plus the
 * character's rarity from the existing rarity seed file.
 */

const fs = require('node:fs');
const path = require('node:path');

const API_BASE = 'https://touhou.fandom.com/api.php';
const RARITY_SEED_PATH = path.resolve(process.cwd(), 'data', 'touhou-rarity-seed.json');
const TOUHOUS_DIR = path.resolve(process.cwd(), 'touhous');
const OUTPUT_PATH = path.resolve(process.cwd(), 'data', 'touhou-attacks-seed.json');

const REQUEST_DELAY_MS = 80;

const GENERICS = [
  { name: 'Danmaku Burst', type: 'danmaku', basePower: 60, accuracy: 95 },
  { name: 'Spirit Shot', type: 'spirit', basePower: 45, accuracy: 100 },
  { name: 'Focus Strike', type: 'danmaku', basePower: 80, accuracy: 80 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'SadGirlPlayerTouhouAttacksBot/1.0',
      'accept': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function buildApiUrl(params) {
  const query = new URLSearchParams({ format: 'json', ...params });
  return `${API_BASE}?${query.toString()}`;
}

function inferType(name) {
  const n = String(name || '').toLowerCase();
  if (/fire|flame|burn|inferno|sun sign|"sun"|hellfire/.test(n)) return 'fire';
  if (/ice|frost|cold|snow|glacial|cryo|freezing/.test(n)) return 'ice';
  if (/wind|gale|storm|breeze|tempest|sky/.test(n)) return 'wind';
  if (/spirit|soul|ghost|phantom|sanzu|netherworld/.test(n)) return 'spirit';
  if (/holy|sacred|divine|light|purify|sun sign|miracle|prayer/.test(n)) return 'holy';
  if (/dark|shadow|night|curse|hex|void|moon sign/.test(n)) return 'dark';
  return 'danmaku';
}

function powerForRarity(baseRarityScore, slot) {
  // slot 1 = reliable spam (low-mid), slot 2 = mid, slot 3 = signature (high)
  const baseline = [55, 70, 90][slot - 1] || 60;
  const rarityBoost = Math.min(15, Math.round(Number(baseRarityScore || 0) * 1.2));
  return baseline + rarityBoost;
}

function accuracyForSlot(slot) {
  return [95, 90, 80][slot - 1] || 90;
}

function dedupeAttackNames(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(n.trim());
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Extract spell card names from wikitext. Looks for several common patterns:
 *   - * '''Name''' or * "Name" inside a Spell Cards section
 *   - {{Note|...|Card Name}} / similar templates
 *   - tabbed spell-card lists with bold headers
 */
function extractSpellCardsFromWikitext(wikitext) {
  if (!wikitext) return [];

  // Try to isolate the Spell Cards / Spell Card section first
  const sectionMatch = wikitext.match(/==\s*Spell Cards?\s*==([\s\S]*?)(?:==\s*[A-Z]|$)/i);
  const scope = sectionMatch ? sectionMatch[1] : wikitext;

  const candidates = [];

  // Pattern: * '''Spell Card Name''' or * "Spell Card Name"
  const boldRe = /^\s*\*+\s*'''(.+?)'''/gm;
  let match;
  while ((match = boldRe.exec(scope)) !== null) {
    candidates.push(match[1]);
  }

  const quoteRe = /^\s*\*+\s*"([^"\n]{2,80})"/gm;
  while ((match = quoteRe.exec(scope)) !== null) {
    candidates.push(match[1]);
  }

  // Pattern: "Sign" "Card Name" — often appears in table rows
  // (e.g. |Sun Sign "Royal Flare")
  const signRe = /[A-Z][A-Za-z]+\s+Sign\s+"([^"\n]{2,80})"/g;
  while ((match = signRe.exec(scope)) !== null) {
    candidates.push(match[1]);
  }

  // Strip wiki link syntax [[...]] and templates {{...}}
  const cleaned = candidates.map((c) =>
    c.replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/'''/g, '')
      .trim(),
  ).filter((c) => c.length >= 2 && c.length <= 80);

  return dedupeAttackNames(cleaned);
}

async function getWikitext(title) {
  try {
    const payload = await fetchJson(buildApiUrl({
      action: 'parse',
      page: title,
      prop: 'wikitext',
    }));
    return payload?.parse?.wikitext?.['*'] || '';
  } catch {
    return '';
  }
}

function buildAttacks(spellCards, baseRarityScore) {
  const attacks = [];

  // Fill from spell cards first
  for (let i = 0; i < spellCards.length && attacks.length < 3; i++) {
    const name = spellCards[i];
    const slot = attacks.length + 1;
    attacks.push({
      name,
      type: inferType(name),
      basePower: powerForRarity(baseRarityScore, slot),
      accuracy: accuracyForSlot(slot),
      description: 'spell-card',
    });
  }

  // Fill remaining with generics
  for (let i = attacks.length; i < 3; i++) {
    const g = GENERICS[i];
    attacks.push({
      name: g.name,
      type: g.type,
      basePower: g.basePower,
      accuracy: g.accuracy,
      description: 'generic',
    });
  }

  return attacks;
}

function loadRaritySeed() {
  if (!fs.existsSync(RARITY_SEED_PATH)) {
    throw new Error(`Rarity seed not found at ${RARITY_SEED_PATH}. Run \`npm run build:touhou-rarity\` first.`);
  }
  const raw = fs.readFileSync(RARITY_SEED_PATH, 'utf8');
  return JSON.parse(raw);
}

function listLocalCharacters() {
  if (!fs.existsSync(TOUHOUS_DIR)) return [];
  return fs.readdirSync(TOUHOUS_DIR)
    .filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
    .map((f) => path.parse(f).name);
}

async function main() {
  const raritySeed = loadRaritySeed();
  const localChars = new Set(listLocalCharacters());

  // Build the working list = intersection of seed titles and local images
  // (so we only emit attacks for characters the bot can actually display)
  const titles = Object.keys(raritySeed.characters || {});
  const targets = titles.filter((t) => localChars.has(t.replace(/_/g, ' ')) || localChars.has(t));

  console.log(`Rarity seed has ${titles.length} characters; ${targets.length} match local images.`);

  // Plus any local character that isn't in the seed (edge case)
  for (const local of localChars) {
    if (!titles.includes(local) && !targets.includes(local)) {
      targets.push(local);
    }
  }

  console.log(`Will fetch wikitext for ${targets.length} characters...`);

  const characters = {};
  let withSpellCards = 0;

  for (let i = 0; i < targets.length; i++) {
    const title = targets[i];
    const seedEntry = raritySeed.characters[title] || {};
    const baseRarityScore = Number(seedEntry.baseRarityScore || 0);

    const wikitext = await getWikitext(title);
    const spellCards = extractSpellCardsFromWikitext(wikitext);

    if (spellCards.length >= 1) withSpellCards += 1;

    const attacks = buildAttacks(spellCards, baseRarityScore);
    characters[title] = {
      spellCardsFound: spellCards.length,
      attacks,
    };

    if ((i + 1) % 10 === 0 || i === targets.length - 1) {
      console.log(`  [${i + 1}/${targets.length}] ${title} → ${spellCards.length} spell cards`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      api: API_BASE,
      raritySeed: RARITY_SEED_PATH,
      notes: [
        'Spell cards are extracted from page wikitext (==Spell Cards== section + bold/quoted patterns).',
        'When fewer than 3 spell cards are found, the remaining slots are filled with themed generics.',
        'Type is inferred from attack-name keywords. Base power scales with slot (55/70/90) plus rarity boost.',
      ],
    },
    stats: {
      totalCharacters: targets.length,
      withSpellCards,
      generic: targets.length - withSpellCards,
    },
    characters,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`  ${withSpellCards}/${targets.length} characters had real spell cards extracted.`);
}

main().catch((err) => {
  console.error('Failed to build Touhou attacks seed.');
  console.error(err?.stack || err?.message || err);
  process.exitCode = 1;
});
