const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { getRarity } = require('../src/touhouStore');

const dbPath = path.resolve(process.cwd(), 'data', 'touhou-market.sqlite3');
const outPath = path.resolve(process.cwd(), 'data', 'touhou-rarity-current.json');

const db = new Database(dbPath, { readonly: true });

const columns = db.prepare('PRAGMA table_info(touhous)').all().map((column) => column.name);
const hasBaseRarity = columns.includes('base_rarity_score');
const hasPopularity = columns.includes('popularity_score');
const hasCommentCount = columns.includes('comment_count');
const hasMainCharacter = columns.includes('is_main_character');

const rows = db.prepare(`
  SELECT
    name,
    trade_count,
    ${hasBaseRarity ? 'base_rarity_score' : '0 AS base_rarity_score'},
    ${hasPopularity ? 'popularity_score' : '0 AS popularity_score'},
    ${hasCommentCount ? 'comment_count' : '0 AS comment_count'},
    ${hasMainCharacter ? 'is_main_character' : '0 AS is_main_character'}
  FROM touhous
  ORDER BY name
`).all();

const characters = rows.map((row) => ({
  name: row.name,
  rarity: getRarity(row.trade_count, row.name, row.base_rarity_score).tier,
  tradeCount: row.trade_count,
  baseRarityScore: row.base_rarity_score,
  popularityScore: row.popularity_score,
  commentCount: row.comment_count,
  isMainCharacter: Boolean(row.is_main_character),
}));

const payload = {
  generatedAt: new Date().toISOString(),
  count: characters.length,
  characters,
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`COUNT=${characters.length}`);
console.log(`OUT=${outPath}`);
for (const item of characters) {
  console.log(`${item.name}\t${item.rarity}`);
}
