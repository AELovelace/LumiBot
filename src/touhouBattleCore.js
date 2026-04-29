'use strict';

const {
  getRarity,
  getAttacks,
  addExp,
  setFainted,
  recordWin,
  FAINT_DURATION_MS,
  searchTouhous,
  POTION_HEAL_RATIO,
} = require('./touhouStore');

const HP_BAR_LENGTH = 10;
const RARITY_TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const RARITY_EXP_BONUS = {
  Common: 0,
  Uncommon: 5,
  Rare: 12,
  Epic: 25,
  Legendary: 50,
  'Ultra-Plus Infinity Rare': 100,
};

const TYPE_CHART = {
  fire: { ice: 1.5, dark: 0.75 },
  ice: { wind: 1.5, fire: 0.75 },
  wind: { spirit: 1.5, ice: 0.75 },
  spirit: { holy: 1.5, wind: 0.75 },
  holy: { dark: 1.5, spirit: 0.75 },
  dark: { fire: 1.5, holy: 0.75 },
  danmaku: {},
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferTypeFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/fire|flame|burn|inferno|sun/.test(n)) return 'fire';
  if (/ice|frost|cold|snow|glacial/.test(n)) return 'ice';
  if (/wind|gale|storm|breeze|tempest/.test(n)) return 'wind';
  if (/spirit|soul|ghost|phantom/.test(n)) return 'spirit';
  if (/holy|sacred|divine|light|purify|sun sign/.test(n)) return 'holy';
  if (/dark|shadow|night|curse|hex|void/.test(n)) return 'dark';
  return 'danmaku';
}

function deriveStats(touhouRow, level) {
  const baseRarity = Number(touhouRow.base_rarity_score || 0);
  const isMain = touhouRow.is_main_character ? 1 : 0;
  return {
    hpMax: Math.floor(50 + level * 8 + baseRarity * 3),
    attack: Math.floor(10 + level * 2 + baseRarity),
    defense: Math.floor(8 + level * 1.5 + baseRarity),
    speed: Math.floor(10 + level + isMain * 5),
  };
}

function computeDamage(attacker, defender, attack, defenderDefending) {
  const multiplier = TYPE_CHART[attack.type]?.[defender.type] ?? 1.0;
  const levelTerm = (2 * attacker.level) / 5 + 2;
  const ratio = attacker.stats.attack / Math.max(1, defender.stats.defense);
  let damage = Math.floor((levelTerm * attack.basePower * ratio) / 50 + 2);
  damage = Math.floor(damage * randFloat(0.85, 1.0) * multiplier);
  if (defenderDefending) damage = Math.floor(damage * 0.5);
  return { damage: Math.max(1, damage), multiplier };
}

function rollAccuracy(accuracy, defenderDefending) {
  const adjusted = defenderDefending ? accuracy - 5 : accuracy;
  return Math.random() * 100 < adjusted;
}

function hpBar(current, max) {
  const ratio = clamp(current / max, 0, 1);
  const filled = Math.round(ratio * HP_BAR_LENGTH);
  return `${'█'.repeat(filled)}${'░'.repeat(HP_BAR_LENGTH - filled)}`;
}

function selectOpponent(guildId, rarityChoice, playerLevel, playerTouhouName) {
  const all = searchTouhous(guildId, '').filter((t) => t.name !== playerTouhouName);
  let candidates = all;
  if (rarityChoice !== 'gamble' && RARITY_TIERS.includes(rarityChoice)) {
    candidates = all.filter((t) => {
      const rarity = getRarity(t.trade_count, t.name, t.base_rarity_score || 0, 0);
      return rarity.tier === rarityChoice;
    });
  }
  if (candidates.length === 0) candidates = all;
  if (candidates.length === 0) return null;

  const evilRow = candidates[randInt(0, candidates.length - 1)];
  const evilLevel = Math.max(1, playerLevel + randInt(-2, 2));
  const evilAttacks = getAttacks(evilRow.name);
  const attacks = evilAttacks.length > 0 ? evilAttacks : [
    { slot: 1, name: 'Danmaku Burst', type: 'danmaku', basePower: 60, accuracy: 95, description: null },
    { slot: 2, name: 'Spirit Shot', type: 'spirit', basePower: 45, accuracy: 100, description: null },
    { slot: 3, name: 'Focus Strike', type: 'danmaku', basePower: 80, accuracy: 80, description: null },
  ];

  return {
    name: evilRow.name,
    level: evilLevel,
    type: inferTypeFromName(attacks[0].name) || attacks[0].type || 'danmaku',
    row: evilRow,
    attacks,
    stats: deriveStats(evilRow, evilLevel),
  };
}

function makeBattleState({ guildId, userId, playerTouhou, playerStats, playerAttacks, rarityChoice, potionCount = 0 }) {
  const evil = selectOpponent(guildId, rarityChoice, playerStats.level, playerTouhou.name);
  if (!evil) {
    return { ok: false, reason: 'no_opponent' };
  }

  const player = {
    name: playerTouhou.name,
    level: playerStats.level,
    type: inferTypeFromName(playerAttacks[0]?.name) || playerAttacks[0]?.type || 'danmaku',
    row: playerTouhou,
    attacks: playerAttacks,
    stats: deriveStats(playerTouhou, playerStats.level),
  };
  player.hp = player.stats.hpMax;
  evil.hp = evil.stats.hpMax;

  return {
    ok: true,
    state: {
      guildId,
      userId,
      player,
      evil,
      log: [
        `A wild Evil ${evil.name} appeared! (Lv ${evil.level} - ${evil.type})`,
        `Go, ${player.name}! (Lv ${player.level} - ${player.type})`,
      ],
      playerDefending: false,
      over: false,
      victory: false,
      rarityChoice,
      isGamble: rarityChoice === 'gamble',
      potionCount: Number(potionCount || 0),
      outcome: null,
      reward: null,
      updatedAt: Date.now(),
    },
  };
}

function applyAttack(attacker, defender, attack, defenderDefending, log, attackerLabel) {
  const hit = rollAccuracy(attack.accuracy, defenderDefending);
  if (!hit) {
    log.push(`${attackerLabel}${attacker.name} used ${attack.name} - but it missed!`);
    return;
  }

  const { damage, multiplier } = computeDamage(attacker, defender, attack, defenderDefending);
  defender.hp = Math.max(0, defender.hp - damage);
  let effectiveness = '';
  if (multiplier > 1.0) effectiveness = ' It is super effective!';
  else if (multiplier < 1.0) effectiveness = ' It is not very effective.';
  log.push(`${attackerLabel}${attacker.name} used ${attack.name} -> ${damage} dmg${defenderDefending ? ' (defended)' : ''}.${effectiveness}`);
}

function serializeBattleState(state) {
  const playerRarity = getRarity(state.player.row.trade_count, state.player.name, state.player.row.base_rarity_score || 0, state.player.level);
  const evilRarity = getRarity(state.evil.row.trade_count, state.evil.name, state.evil.row.base_rarity_score || 0, state.evil.level);
  return {
    over: state.over,
    victory: state.victory,
    outcome: state.outcome,
    potionCount: state.potionCount,
    reward: state.reward,
    player: {
      name: state.player.name,
      level: state.player.level,
      type: state.player.type,
      rarity: playerRarity,
      hp: state.player.hp,
      hpMax: state.player.stats.hpMax,
      hpBar: hpBar(state.player.hp, state.player.stats.hpMax),
      attacks: state.player.attacks,
    },
    evil: {
      name: state.evil.name,
      level: state.evil.level,
      type: state.evil.type,
      rarity: evilRarity,
      hp: state.evil.hp,
      hpMax: state.evil.stats.hpMax,
      hpBar: hpBar(state.evil.hp, state.evil.stats.hpMax),
    },
    log: [...state.log],
  };
}

function finishVictory(state, deps) {
  const evilRarity = getRarity(state.evil.row.trade_count, state.evil.name, state.evil.row.base_rarity_score || 0, state.evil.level);
  const rarityBonus = RARITY_EXP_BONUS[evilRarity.tier] || 0;
  let exp = 15 + state.evil.level * 3 + rarityBonus;
  let sgc = Math.floor(exp * 0.6);
  if (state.isGamble) {
    exp = Math.floor(exp * 1.2);
    sgc = Math.floor(sgc * 1.2);
  }
  recordWin(state.guildId, state.player.name, state.userId);
  const expResult = addExp(state.guildId, state.player.name, state.userId, exp);
  if (deps.payTouhouTraderPayout) {
    deps.payTouhouTraderPayout(state.userId, sgc, `Touhou battle win vs Evil ${state.evil.name}`);
  }
  state.reward = { exp, sgc, newLevel: expResult.newLevel, leveledUp: expResult.leveledUp };
  state.log.push(`Victory! Defeated Evil ${state.evil.name} (${evilRarity.tier}).`);
  state.log.push(`${state.player.name} gained ${exp} EXP and you earned ${sgc} SGC.`);
  if (expResult.leveledUp) {
    state.log.push(`${state.player.name} grew to Lv ${expResult.newLevel}!`);
  }
  state.over = true;
  state.victory = true;
  state.outcome = 'victory';
}

function finishDefeat(state, outcome) {
  const until = Date.now() + FAINT_DURATION_MS;
  setFainted(state.guildId, state.player.name, state.userId, until);
  state.log.push(
    outcome === 'timeout'
      ? `${state.player.name} fainted from inaction.`
      : `${state.player.name} was defeated by Evil ${state.evil.name}!`,
  );
  state.log.push('Auto-heals in 10:00 or use instant heal later.');
  state.over = true;
  state.victory = false;
  state.outcome = outcome;
}

function resolveBattleAction(state, action, deps = {}) {
  if (!state || state.over) return state;
  const { player, evil } = state;

  if (action.kind === 'potion') {
    if (player.hp >= player.stats.hpMax) {
      state.log.push(`${player.name} is already at full health.`);
      state.updatedAt = Date.now();
      return state;
    }
    const consumed = deps.consumePotion ? deps.consumePotion(state.guildId, state.userId) : { success: false, code: 'NO_STOCK' };
    if (!consumed.success) {
      state.potionCount = 0;
      state.log.push('No potions left!');
      state.updatedAt = Date.now();
      return state;
    }
    state.potionCount = consumed.newCount;
    const healAmount = Math.max(1, Math.floor(player.stats.hpMax * POTION_HEAL_RATIO));
    const before = player.hp;
    player.hp = Math.min(player.stats.hpMax, player.hp + healAmount);
    state.log.push(`${player.name} used a Health Potion and restored ${player.hp - before} HP.`);
    const evilAtk = evil.attacks[randInt(0, evil.attacks.length - 1)];
    applyAttack(evil, player, evilAtk, false, state.log, 'Evil ');
    if (player.hp <= 0) {
      finishDefeat(state, 'defeat');
    }
    state.updatedAt = Date.now();
    return state;
  }

  if (action.kind === 'run') {
    if (Math.random() < 0.75) {
      state.log.push('You ran away successfully!');
      state.over = true;
      state.victory = false;
      state.outcome = 'ran';
      state.updatedAt = Date.now();
      return state;
    }
    state.log.push("You tried to run but couldn't escape!");
    const evilAtk = evil.attacks[randInt(0, evil.attacks.length - 1)];
    applyAttack(evil, player, evilAtk, false, state.log, 'Evil ');
    if (player.hp <= 0) {
      finishDefeat(state, 'defeat');
    }
    state.updatedAt = Date.now();
    return state;
  }

  const playerFirst = player.stats.speed > evil.stats.speed
    || (player.stats.speed === evil.stats.speed && Math.random() < 0.5);
  const playerWillDefend = action.kind === 'defend';
  state.playerDefending = playerWillDefend;
  const playerAttack = action.kind === 'attack' ? player.attacks[action.attackIndex] : null;
  const evilAttack = evil.attacks[randInt(0, evil.attacks.length - 1)];
  const turns = [];

  if (playerFirst) {
    if (playerAttack) turns.push({ atk: player, def: evil, move: playerAttack, attackerLabel: '' });
    turns.push({ atk: evil, def: player, move: evilAttack, attackerLabel: 'Evil ' });
  } else {
    turns.push({ atk: evil, def: player, move: evilAttack, attackerLabel: 'Evil ' });
    if (playerAttack) turns.push({ atk: player, def: evil, move: playerAttack, attackerLabel: '' });
  }

  if (playerWillDefend) {
    state.log.push(`${player.name} braces for impact!`);
  }

  for (const turn of turns) {
    if (player.hp <= 0 || evil.hp <= 0) break;
    const defenderDefending = turn.def === player && playerWillDefend;
    applyAttack(turn.atk, turn.def, turn.move, defenderDefending, state.log, turn.attackerLabel);
  }

  state.playerDefending = false;
  if (player.hp <= 0) finishDefeat(state, 'defeat');
  else if (evil.hp <= 0) finishVictory(state, deps);
  state.updatedAt = Date.now();
  return state;
}

module.exports = {
  FAINT_DURATION_MS,
  inferTypeFromName,
  makeBattleState,
  resolveBattleAction,
  serializeBattleState,
};
