const SMOKE_BOOST_DURATION_MS = 5 * 60 * 1000;
const SMOKE_RARITY_MULTIPLIERS = {
  Common: 1.25,
  Uncommon: 1.5,
  Rare: 2,
  Epic: 2.5,
  Legendary: 3,
};

/** @type {Map<string, { expiresAt: number, multiplier: number, rarityTier: string }>} */
const smokeBoostByUser = new Map();

function getMultiplierForRarity(rarityTier) {
  return SMOKE_RARITY_MULTIPLIERS[rarityTier] ?? SMOKE_RARITY_MULTIPLIERS.Common;
}

function activateSmokeBoost(userId, rarityTier, now = Date.now()) {
  const multiplier = getMultiplierForRarity(rarityTier);
  const expiresAt = now + SMOKE_BOOST_DURATION_MS;
  smokeBoostByUser.set(userId, { expiresAt, multiplier, rarityTier });
  return {
    multiplier,
    rarityTier,
    durationMs: SMOKE_BOOST_DURATION_MS,
    expiresAt,
  };
}

function getSmokeBoost(userId, now = Date.now()) {
  const state = smokeBoostByUser.get(userId);
  if (!state) {
    return { active: false, multiplier: 1, remainingMs: 0, expiresAt: null, rarityTier: null };
  }

  const { expiresAt, multiplier, rarityTier } = state;
  if (expiresAt <= now) {
    smokeBoostByUser.delete(userId);
    return { active: false, multiplier: 1, remainingMs: 0, expiresAt: null, rarityTier: null };
  }

  return {
    active: true,
    multiplier,
    remainingMs: expiresAt - now,
    expiresAt,
    rarityTier,
  };
}

module.exports = {
  activateSmokeBoost,
  getSmokeBoost,
  getMultiplierForRarity,
  SMOKE_RARITY_MULTIPLIERS,
  SMOKE_BOOST_DURATION_MS,
};
