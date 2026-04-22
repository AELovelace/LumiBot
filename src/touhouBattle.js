/**
 * Touhou Battle Engine — Pokemon-style PvE battles.
 *
 * Player picks a touhou + a target rarity (or "gamble" for random).
 * Spawn an evil touhou around the player's level (±2). Turn-based loop with
 * Attack / Defend / Run buttons editing one battle-log message until KO.
 *
 * Wins → EXP + scaled SGC payout via solvency-aware payTouhouTraderPayout.
 * Loss/run-fail → fainted 10 minutes (auto-heals via store's lazy clear).
 */

const path = require('node:path');
const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { logger } = require('./logger');

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATTLE_TIMEOUT_MS = 90_000;
const HP_BAR_LENGTH = 10;
const LOG_LINES = 6;
const RARITY_TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const RARITY_EXP_BONUS = {
  Common: 0,
  Uncommon: 5,
  Rare: 12,
  Epic: 25,
  Legendary: 50,
  'Ultra-Plus Infinity Rare': 100,
};

// type advantage matrix (attacker type → defender type → multiplier)
// keys not present default to 1.0
const TYPE_CHART = {
  fire: { ice: 1.5, dark: 0.75 },
  ice: { wind: 1.5, fire: 0.75 },
  wind: { spirit: 1.5, ice: 0.75 },
  spirit: { holy: 1.5, wind: 0.75 },
  holy: { dark: 1.5, spirit: 0.75 },
  dark: { fire: 1.5, holy: 0.75 },
  danmaku: {},
};

// Battle state — one battle per user at a time
const battlesByUser = new Map(); // userId -> BattleState

// Faint reminder timers (best-effort DMs when cooldown expires)
const faintReminders = new Map(); // `${userId}::${touhouName}` -> Timeout

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  // Type multiplier
  const multiplier = TYPE_CHART[attack.type]?.[defender.type] ?? 1.0;

  // Pokemon-style core
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

// ---------------------------------------------------------------------------
// Type inference (from attack name fallback)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Opponent selection
// ---------------------------------------------------------------------------

function selectOpponent(guildId, rarityChoice, playerLevel, playerOwnerId, playerTouhouName) {
  // Build candidate pool: any touhou (including owned by others, even the player)
  // For display-only purposes — we don't change ownership.
  const all = searchTouhous(guildId, '').filter((t) => t.name !== playerTouhouName);

  let candidates = all;
  if (rarityChoice !== 'gamble' && RARITY_TIERS.includes(rarityChoice)) {
    candidates = all.filter((t) => {
      // For unowned touhous level=0 baseline; for owned ones we don't account
      // for owner-specific level here (matchmaking uses base tier only).
      const r = getRarity(t.trade_count, t.name, t.base_rarity_score || 0, 0);
      return r.tier === rarityChoice;
    });
  }

  if (candidates.length === 0) candidates = all;
  if (candidates.length === 0) return null;

  const evilRow = candidates[randInt(0, candidates.length - 1)];
  const evilLevel = Math.max(1, playerLevel + randInt(-2, 2));
  const evilAttacks = getAttacks(evilRow.name);

  // If evil has no attacks seeded, fall back to a generic moveset
  const attacks = evilAttacks.length > 0 ? evilAttacks : [
    { slot: 1, name: 'Danmaku Burst', type: 'danmaku', basePower: 60, accuracy: 95, description: null },
    { slot: 2, name: 'Spirit Shot', type: 'spirit', basePower: 45, accuracy: 100, description: null },
    { slot: 3, name: 'Focus Strike', type: 'danmaku', basePower: 80, accuracy: 80, description: null },
  ];

  // Determine evil's "type" as the type of slot 1 (its signature)
  const type = inferTypeFromName(attacks[0].name) || attacks[0].type || 'danmaku';

  return {
    name: evilRow.name,
    level: evilLevel,
    type,
    row: evilRow,
    attacks,
    stats: deriveStats(evilRow, evilLevel),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function hpBar(current, max) {
  const ratio = clamp(current / max, 0, 1);
  const filled = Math.round(ratio * HP_BAR_LENGTH);
  return `${'█'.repeat(filled)}${'░'.repeat(HP_BAR_LENGTH - filled)}`;
}

function makeImageAttachment(touhouName, touhouDir) {
  const { getImageFile } = require('./touhouStore');
  const file = getImageFile(touhouName);
  if (!file) return null;
  try {
    return new AttachmentBuilder(path.resolve(touhouDir, file), {
      name: file.replace(/ /g, '_'),
    });
  } catch {
    return null;
  }
}

function buildEmbed(state) {
  const player = state.player;
  const evil = state.evil;

  const playerImg = state.playerAttachment?.name;
  const evilImg = state.evilAttachment?.name;

  const playerRarity = getRarity(player.row.trade_count, player.name, player.row.base_rarity_score || 0, player.level);
  const evilRarity = getRarity(evil.row.trade_count, evil.name, evil.row.base_rarity_score || 0, evil.level);

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Battle: ${player.name} vs Evil ${evil.name}`)
    .setColor(state.over ? (state.victory ? 0x57f287 : 0xed4245) : 0x5865f2)
    .addFields(
      {
        name: `${playerRarity.emoji} ${player.name}  (Lv ${player.level} • ${player.type})`,
        value: `\`${hpBar(player.hp, player.stats.hpMax)}\` **${player.hp}/${player.stats.hpMax}**${state.playerDefending ? ' 🛡️' : ''}`,
        inline: false,
      },
      {
        name: `${evilRarity.emoji} Evil ${evil.name}  (Lv ${evil.level} • ${evil.type})`,
        value: `\`${hpBar(evil.hp, evil.stats.hpMax)}\` **${evil.hp}/${evil.stats.hpMax}**`,
        inline: false,
      },
      {
        name: '📜 Battle Log',
        value: state.log.slice(-LOG_LINES).map((l) => `• ${l}`).join('\n') || '_(awaiting first move)_',
        inline: false,
      },
    );

  if (playerImg) embed.setThumbnail(`attachment://${playerImg}`);
  if (evilImg) embed.setImage(`attachment://${evilImg}`);
  const potionText = `Potions: ${state.potionCount}`;
  embed.setFooter({ text: state.over ? `Battle ended. ${potionText}` : `Choose your move — 90s timeout. ${potionText}` });

  return embed;
}

function buildComponents(state) {
  if (state.over) return [];

  const attackRow = new ActionRowBuilder();
  for (let i = 0; i < state.player.attacks.length; i++) {
    const a = state.player.attacks[i];
    attackRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`tb_atk_${i}_${state.token}`)
        .setLabel(`${a.name} (${a.basePower})`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  const utilRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tb_def_${state.token}`).setLabel('🛡️ Defend').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tb_pot_${state.token}`).setLabel(`🧪 Potion x${state.potionCount}`).setStyle(ButtonStyle.Success).setDisabled(state.potionCount <= 0),
    new ButtonBuilder().setCustomId(`tb_run_${state.token}`).setLabel('🏃 Run').setStyle(ButtonStyle.Danger),
  );

  return [attackRow, utilRow];
}

// ---------------------------------------------------------------------------
// Faint reminder DM
// ---------------------------------------------------------------------------

function scheduleFaintReminder(client, guildId, userId, touhouName) {
  const key = `${guildId}::${userId}::${touhouName}`;
  const existing = faintReminders.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    faintReminders.delete(key);
    try {
      const user = await client.users.fetch(userId);
      await user.send(`✨ **${touhouName}** has recovered and is ready to battle again!`);
    } catch (err) {
      logger.warn(`Touhou heal-ready DM failed for ${userId} (${touhouName}): ${err.message}`);
    }
  }, FAINT_DURATION_MS);

  faintReminders.set(key, timer);
}

function cancelFaintReminder(guildId, userId, touhouName) {
  const key = `${guildId}::${userId}::${touhouName}`;
  const t = faintReminders.get(key);
  if (t) {
    clearTimeout(t);
    faintReminders.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Battle entry point
// ---------------------------------------------------------------------------

async function startBattle({
  interaction,
  guildId,
  playerTouhou,
  playerStats,
  playerAttacks,
  rarityChoice,
  touhouDir,
  payTouhouTraderPayout,
  getPotionCount,
  consumePotion,
}) {
  const userId = interaction.user.id;

  if (battlesByUser.has(userId)) {
    await interaction.reply({
      content: '❌ You already have an active battle. Finish it first!',
      ephemeral: true,
    });
    return;
  }

  const evil = selectOpponent(guildId, rarityChoice, playerStats.level, userId, playerTouhou.name);
  if (!evil) {
    await interaction.reply({ content: '❌ No suitable opponent found.', ephemeral: true });
    return;
  }

  const playerSide = {
    name: playerTouhou.name,
    level: playerStats.level,
    type: inferTypeFromName(playerAttacks[0]?.name) || playerAttacks[0]?.type || 'danmaku',
    row: playerTouhou,
    attacks: playerAttacks,
    stats: deriveStats(playerTouhou, playerStats.level),
  };
  playerSide.hp = playerSide.stats.hpMax;
  evil.hp = evil.stats.hpMax;

  const token = `${Date.now()}_${randInt(0, 99999)}`;
  const playerAttachment = makeImageAttachment(playerSide.name, touhouDir);
  const evilAttachment = makeImageAttachment(evil.name, touhouDir);

  const state = {
    guildId,
    userId,
    token,
    player: playerSide,
    evil,
    log: [
      `A wild **Evil ${evil.name}** appeared! (Lv ${evil.level} • ${evil.type})`,
      `Go, **${playerSide.name}**! (Lv ${playerSide.level} • ${playerSide.type})`,
    ],
    playerDefending: false,
    over: false,
    victory: false,
    rarityChoice,
    isGamble: rarityChoice === 'gamble',
    playerAttachment,
    evilAttachment,
    interaction,
    touhouDir,
    payTouhouTraderPayout,
    potionCount: Number(getPotionCount ? getPotionCount(guildId, userId) : 0),
    consumePotion,
  };

  battlesByUser.set(userId, state);

  const files = [playerAttachment, evilAttachment].filter(Boolean);
  await interaction.reply({
    embeds: [buildEmbed(state)],
    components: buildComponents(state),
    files,
  });
  state.message = await interaction.fetchReply();

  setupCollector(state);
}

function setupCollector(state) {
  const collector = state.message.createMessageComponentCollector({
    filter: (btn) => btn.customId.endsWith(`_${state.token}`),
    time: BATTLE_TIMEOUT_MS,
    idle: BATTLE_TIMEOUT_MS,
  });

  state.collector = collector;

  collector.on('collect', async (btn) => {
    if (btn.user.id !== state.userId) {
      await btn.reply({ content: 'Only the battle initiator can act.', ephemeral: true }).catch(() => {});
      return;
    }
    if (state.over) {
      await btn.reply({ content: 'This battle is already over.', ephemeral: true }).catch(() => {});
      return;
    }

    try {
      await btn.deferUpdate();
    } catch {
      // ignore
    }

    if (btn.customId.startsWith('tb_atk_')) {
      const idx = parseInt(btn.customId.split('_')[2], 10);
      await resolveTurn(state, { kind: 'attack', attackIndex: idx });
    } else if (btn.customId.startsWith('tb_def_')) {
      await resolveTurn(state, { kind: 'defend' });
    } else if (btn.customId.startsWith('tb_pot_')) {
      await resolveTurn(state, { kind: 'potion' });
    } else if (btn.customId.startsWith('tb_run_')) {
      await resolveTurn(state, { kind: 'run' });
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (state.over) return;
    if (reason === 'time' || reason === 'idle') {
      state.log.push('⌛ You took too long! **You forfeit the battle.**');
      await endBattle(state, { outcome: 'timeout' });
    }
  });
}

// ---------------------------------------------------------------------------
// Turn resolution
// ---------------------------------------------------------------------------

async function resolveTurn(state, action) {
  const { player, evil } = state;

  if (action.kind === 'potion') {
    if (player.hp >= player.stats.hpMax) {
      state.log.push(`🧪 **${player.name}** is already at full health.`);
      await refresh(state);
      return;
    }

    const consumed = state.consumePotion ? state.consumePotion(state.guildId, state.userId) : { success: false, code: 'NO_STOCK' };
    if (!consumed.success) {
      state.potionCount = 0;
      state.log.push('🧪 No potions left!');
      await refresh(state);
      return;
    }

    state.potionCount = consumed.newCount;
    const healAmount = Math.max(1, Math.floor(player.stats.hpMax * POTION_HEAL_RATIO));
    const before = player.hp;
    player.hp = Math.min(player.stats.hpMax, player.hp + healAmount);
    const healed = player.hp - before;
    state.log.push(`🧪 **${player.name}** used a Health Potion and restored **${healed} HP**.`);

    // Potion uses the player's turn; enemy gets one action this round.
    const evilAtk = evil.attacks[randInt(0, evil.attacks.length - 1)];
    applyAttack(evil, player, evilAtk, false, state.log, 'Evil ');
    if (player.hp <= 0) {
      await endBattle(state, { outcome: 'defeat' });
      return;
    }

    await refresh(state);
    return;
  }

  // Run attempt resolves immediately (no order)
  if (action.kind === 'run') {
    if (Math.random() < 0.75) {
      state.log.push(`🏃 You ran away successfully!`);
      await endBattle(state, { outcome: 'ran' });
      return;
    }
    state.log.push(`🏃 You tried to run but couldn't escape!`);
    // Free hit for evil
    const evilAtk = evil.attacks[randInt(0, evil.attacks.length - 1)];
    applyAttack(evil, player, evilAtk, false, state.log, 'Evil ');
    if (player.hp <= 0) {
      await endBattle(state, { outcome: 'defeat' });
      return;
    }
    await refresh(state);
    return;
  }

  // Determine turn order by speed
  const playerFirst = player.stats.speed > evil.stats.speed
    || (player.stats.speed === evil.stats.speed && Math.random() < 0.5);

  // Pre-resolve player intent
  let playerWillDefend = action.kind === 'defend';
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
    state.log.push(`🛡️ **${player.name}** braces for impact!`);
  }

  for (const t of turns) {
    if (player.hp <= 0 || evil.hp <= 0) break;
    const defenderDefending = (t.def === player && playerWillDefend);
    applyAttack(t.atk, t.def, t.move, defenderDefending, state.log, t.attackerLabel);
  }

  state.playerDefending = false;

  if (player.hp <= 0) {
    await endBattle(state, { outcome: 'defeat' });
    return;
  }
  if (evil.hp <= 0) {
    await endBattle(state, { outcome: 'victory' });
    return;
  }

  await refresh(state);
}

function applyAttack(attacker, defender, attack, defenderDefending, log, attackerLabel) {
  const hit = rollAccuracy(attack.accuracy, defenderDefending);
  if (!hit) {
    log.push(`💨 ${attackerLabel}**${attacker.name}** used **${attack.name}** — but it missed!`);
    return;
  }

  const { damage, multiplier } = computeDamage(attacker, defender, attack, defenderDefending);
  defender.hp = Math.max(0, defender.hp - damage);

  let effectiveness = '';
  if (multiplier > 1.0) effectiveness = " — **It's super effective!**";
  else if (multiplier < 1.0) effectiveness = ' — _It\'s not very effective..._';

  log.push(
    `⚔️ ${attackerLabel}**${attacker.name}** used **${attack.name}** → **${damage} dmg**${defenderDefending ? ' (defended)' : ''}${effectiveness}`,
  );
}

async function refresh(state) {
  try {
    await state.message.edit({
      embeds: [buildEmbed(state)],
      components: buildComponents(state),
    });
  } catch (err) {
    logger.warn(`Battle refresh failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Battle end + rewards
// ---------------------------------------------------------------------------

async function endBattle(state, { outcome }) {
  state.over = true;
  state.victory = outcome === 'victory';
  if (state.collector) state.collector.stop('done');
  battlesByUser.delete(state.userId);

  if (outcome === 'victory') {
    await applyVictory(state);
  } else if (outcome === 'defeat' || outcome === 'timeout') {
    await applyDefeat(state, outcome);
  }
  // 'ran' → no rewards, no penalty

  try {
    await state.message.edit({
      embeds: [buildEmbed(state)],
      components: [],
    });
  } catch (err) {
    logger.warn(`Battle final edit failed: ${err.message}`);
  }
}

async function applyVictory(state) {
  const { player, evil, userId, isGamble, guildId } = state;
  const evilRarity = getRarity(evil.row.trade_count, evil.name, evil.row.base_rarity_score || 0, evil.level);

  const rarityBonus = RARITY_EXP_BONUS[evilRarity.tier] || 0;
  let exp = 15 + evil.level * 3 + rarityBonus;
  let sgc = Math.floor(exp * 0.6);
  if (isGamble) {
    exp = Math.floor(exp * 1.2);
    sgc = Math.floor(sgc * 1.2);
  }

  recordWin(guildId, player.name, userId);
  const expResult = addExp(guildId, player.name, userId, exp);

  if (state.payTouhouTraderPayout) {
    state.payTouhouTraderPayout(userId, sgc, `Touhou battle win vs Evil ${evil.name}`);
  }

  state.log.push(
    `🏆 **Victory!** Defeated Evil ${evil.name} (${evilRarity.tier}).`,
    `📈 **${player.name}** gained **${exp} EXP** and you earned **${sgc} SGC**.`,
  );
  if (expResult.leveledUp) {
    state.log.push(`✨ **${player.name}** grew to **Lv ${expResult.newLevel}**!`);
  }
}

async function applyDefeat(state, outcome) {
  const { player, evil, userId, guildId } = state;
  const until = Date.now() + FAINT_DURATION_MS;
  setFainted(guildId, player.name, userId, until);

  state.log.push(
    outcome === 'timeout'
      ? `💤 **${player.name}** fainted from inaction.`
      : `💤 **${player.name}** was defeated by Evil ${evil.name}!`,
    `Auto-heals in **10:00** — or pay 50 SGC with \`/lumi-touhou heal name:${player.name} pay:true\` for instant heal.`,
  );

  scheduleFaintReminder(state.interaction.client, guildId, userId, player.name);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  startBattle,
  cancelFaintReminder,
};
