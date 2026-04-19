const fs = require('node:fs');
const path = require('node:path');

const API_BASE = 'https://touhou.fandom.com/api.php';
const CATEGORY_TITLE = 'Category:Characters';
const OUTPUT_PATH = path.resolve(process.cwd(), 'data', 'touhou-rarity-seed.json');

const REQUEST_DELAY_MS = 80;
const BATCH_SIZE = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'SadGirlPlayerTouhouRarityBot/1.0',
      'accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

function buildApiUrl(params) {
  const query = new URLSearchParams({
    format: 'json',
    ...params,
  });
  return `${API_BASE}?${query.toString()}`;
}

async function getAllCharacterTitles() {
  const titles = [];
  let cmcontinue = null;

  while (true) {
    const params = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: CATEGORY_TITLE,
      cmnamespace: '0',
      cmlimit: '500',
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;

    const payload = await fetchJson(buildApiUrl(params));
    const members = payload?.query?.categorymembers || [];

    for (const member of members) {
      if (member?.title) titles.push(member.title);
    }

    const next = payload?.continue?.cmcontinue;
    if (!next) break;
    cmcontinue = next;
    await sleep(REQUEST_DELAY_MS);
  }

  return titles;
}

function parseMainCharacter(page, pageProps) {
  const categories = page?.categories || [];
  const hasMainCategory = categories.some((entry) => /main\s*characters?|protagonists?/i.test(entry?.title || ''));
  if (hasMainCategory) return true;

  const description = String(pageProps?.fandomdescription || '');
  return /\bmain character\b|\bprotagonist\b/i.test(description);
}

function parseAppearancesCount(pageProps) {
  const rawInfoboxes = pageProps?.infoboxes;
  if (!rawInfoboxes) return 0;

  try {
    const infoboxes = JSON.parse(rawInfoboxes);
    for (const box of infoboxes) {
      const dataRows = Array.isArray(box?.data) ? box.data : [];
      for (const row of dataRows) {
        if (row?.type !== 'data') continue;
        const source = String(row?.data?.source || '').toLowerCase();
        if (!source.includes('appearance')) continue;
        const value = String(row?.data?.value || '');
        const liMatches = value.match(/<li>/gi);
        return liMatches ? liMatches.length : 0;
      }
    }
  } catch {
    return 0;
  }

  return 0;
}

function parseRevisionCommentSignal(revisions) {
  if (!Array.isArray(revisions) || revisions.length === 0) return 0;
  let nonEmpty = 0;
  for (const revision of revisions) {
    if (typeof revision?.comment === 'string' && revision.comment.trim().length > 0) {
      nonEmpty += 1;
    }
  }
  return nonEmpty;
}

async function getTalkDiscussionCount(title) {
  const talkPage = `Talk:${title}`;
  const payload = await fetchJson(buildApiUrl({
    action: 'parse',
    page: talkPage,
    prop: 'sections',
  }));

  const sections = payload?.parse?.sections;
  if (!Array.isArray(sections)) return 0;

  return sections.filter((section) => String(section?.toclevel || '') === '1').length;
}

function percentileRank(sortedValues, value) {
  if (!sortedValues.length) return 0;
  let count = 0;
  for (const candidate of sortedValues) {
    if (candidate <= value) count += 1;
  }
  return Math.round((count / sortedValues.length) * 100);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function hydrateMetadata(titles) {
  const byTitle = new Map();

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const chunk = titles.slice(i, i + BATCH_SIZE);
    const payload = await fetchJson(buildApiUrl({
      action: 'query',
      prop: 'categories|pageprops',
      cllimit: 'max',
      titles: chunk.join('|'),
    }));

    const pages = Object.values(payload?.query?.pages || {});
    for (const page of pages) {
      const title = page?.title;
      if (!title) continue;
      const pageProps = page?.pageprops || {};

      byTitle.set(title, {
        title,
        isMainCharacter: parseMainCharacter(page, pageProps),
        appearancesCount: parseAppearancesCount(pageProps),
        description: String(pageProps?.fandomdescription || ''),
      });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return byTitle;
}

async function hydrateCommentSignals(byTitle) {
  for (const [title, meta] of byTitle) {
    let discussionCommentCount = 0;
    try {
      discussionCommentCount = await getTalkDiscussionCount(title);
    } catch {
      discussionCommentCount = 0;
    }

    let revisionCommentSignal = 0;
    try {
      const revisionPayload = await fetchJson(buildApiUrl({
        action: 'query',
        prop: 'revisions',
        rvprop: 'comment',
        rvlimit: 'max',
        titles: title,
      }));
      const page = Object.values(revisionPayload?.query?.pages || {})[0] || {};
      revisionCommentSignal = parseRevisionCommentSignal(page?.revisions);
    } catch {
      revisionCommentSignal = 0;
    }

    meta.discussionCommentCount = discussionCommentCount;
    meta.revisionCommentSignal = revisionCommentSignal;
    meta.commentCount = discussionCommentCount + revisionCommentSignal;

    await sleep(REQUEST_DELAY_MS);
  }
}

function buildSeed(byTitle) {
  const all = Array.from(byTitle.values());

  const commentValues = all.map((entry) => entry.commentCount || 0).sort((a, b) => a - b);
  const appearanceValues = all.map((entry) => entry.appearancesCount || 0).sort((a, b) => a - b);

  const popularitySorted = [];

  for (const entry of all) {
    const commentPercentile = percentileRank(commentValues, entry.commentCount || 0);
    const appearancePercentile = percentileRank(appearanceValues, entry.appearancesCount || 0);
    const popularityScore = Math.round(commentPercentile * 0.7 + appearancePercentile * 0.3);

    entry.commentPercentile = commentPercentile;
    entry.appearancePercentile = appearancePercentile;
    entry.popularityScore = popularityScore;
    popularitySorted.push(popularityScore);
  }

  popularitySorted.sort((a, b) => a - b);
  const veryPopularThreshold = popularitySorted[Math.max(0, Math.floor(popularitySorted.length * 0.9) - 1)] || 0;

  const characters = {};
  for (const entry of all) {
    const veryPopularBoost = entry.popularityScore >= veryPopularThreshold ? 2 : 0;
    const mainBoost = entry.isMainCharacter ? 3 : 0;
    const baseFromPopularity = Math.round(entry.popularityScore / 13);
    const baseRarityScore = clamp(baseFromPopularity + mainBoost + veryPopularBoost, 0, 12);

    characters[entry.title] = {
      commentCount: entry.commentCount,
      discussionCommentCount: entry.discussionCommentCount,
      revisionCommentSignal: entry.revisionCommentSignal,
      appearancesCount: entry.appearancesCount,
      popularityScore: entry.popularityScore,
      isMainCharacter: entry.isMainCharacter,
      baseRarityScore,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    source: {
      category: 'https://touhou.fandom.com/wiki/Category:Characters',
      api: API_BASE,
      notes: [
        'Character list is crawled through MediaWiki categorymembers continuation (all category pages).',
        'commentCount combines top-level talk-page thread count and revision comment signal due direct Fandom discussion endpoints being Cloudflare-protected in headless fetch contexts.',
        'baseRarityScore blends popularity percentile, main-character boost, and a very-popular boost (top 10%).',
      ],
    },
    characters,
  };
}

async function main() {
  console.log('Fetching Touhou character titles from category pages...');
  const titles = await getAllCharacterTitles();
  console.log(`Found ${titles.length} character pages.`);

  console.log('Hydrating category/pageprops metadata...');
  const metadata = await hydrateMetadata(titles);

  console.log('Hydrating comment/popularity signals...');
  await hydrateCommentSignals(metadata);

  const seed = buildSeed(metadata);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

  console.log(`Wrote Touhou rarity seed: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('Failed to build Touhou rarity seed.');
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
