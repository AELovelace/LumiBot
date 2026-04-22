/**
 * Touhou Interactive Menu — full-game button/select-menu UI.
 *
 * Triggered by bare  !lumi-touhou / !touhou / !2hu  (no subcommand)
 * or  /lumi-touhou menu.
 *
 * A single embed is edited through every screen.
 * One per-message component collector lives for MENU_TIMEOUT ms.
 *
 * Screens
 *   main → Adopt | Battle | Market | Heal
 *   battle_party → party dropdown → battle_rarity → startBattle()
 *   market → Listings | Potions | Trade | Delist | Buyback | Send
 *   heal → fainted party dropdown → instant heal
 *
 * Text-input flows (Trade, Send) use channel.awaitMessages rather than
 * Discord modals so they work with both slash and prefix interactions.
 */

'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const { logger } = require('./logger');

const {
  BASE_ADOPT_PRICE,
  POTION_PRICE,
  POTION_CAP,
  resolveName,
  getRarity,
  getSuggestedPrice,
  adoptTouhou,
  getUserTouhous,
  getTouhou,
  getListings,
  getListingsPage,
  getListingsCount,
  buyListing,
  getListingPrice,
  delistTouhou,
  sellbackToMarket,
  sendTouhou,
  swapTouhous,
  getOrCreateBattleStats,
  healTouhou,
  getPotionCount,
  addPotions,
  consumePotion,
  getAttacks,
} = require('./touhouStore');

const {
  TOUHOU_MGMT_USER_ID,
  getBalance,
  ensureAccount,
  adjustBalance,
} = require('./sadgirlEconomyStore');

const { startBattle, cancelFaintReminder } = require('./touhouBattle');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MENU_TIMEOUT = 5 * 60 * 1000; // 5-minute idle timeout
const HEAL_COST = 50;
const SELECT_PAGE_SIZE = 24; // StringSelectMenu max is 25; use 24 to be safe
const TOUHOU_TRADER_LIQUIDITY_FLOOR = 1000;

// Maps each screen to the screen Back should navigate to.
const PARENT_SCREEN = {
  main: 'main',
  battle_party: 'main',
  battle_rarity: 'battle_party',
  market: 'main',
  listings: 'market',
  delist: 'market',
  buyback: 'market',
  potions: 'market',
  heal: 'main',
  awaiting_trade: 'market',
  awaiting_send: 'market',
  awaiting_trade_confirm: 'market',
  flash_main: 'main',
  flash_market: 'market',
  flash_listings: 'listings',
};

let touhouDir = '';

function setMenuTouhouDir(dir) { touhouDir = dir; }

// Active sessions: `${userId}_${token}` strings.
// The global safety-net handler uses this to distinguish live vs expired menus.
const activeSessions = new Set();

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function makeToken() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function localPayout(userId, amount, note) {
  if (amount <= 0) return;
  const bal = getBalance(TOUHOU_MGMT_USER_ID);
  adjustBalance(userId, amount, note);
  if (bal >= TOUHOU_TRADER_LIQUIDITY_FLOOR + amount) {
    adjustBalance(TOUHOU_MGMT_USER_ID, -amount, note);
  } else {
    logger.info(`Touhou Trader below liquidity floor (balance=${bal}, payout=${amount}); minting payout.`);
  }
}

function trunc(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ---------------------------------------------------------------------------
// Global safety-net handler
// ---------------------------------------------------------------------------

/**
 * Catches tmenu_ component interactions for collectors that have already ended.
 * Returns true if handled; false if the menu session is still active (let the
 * collector handle it naturally).
 */
async function handleTouhouMenuComponent(interaction) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return false;
  if (!interaction.customId.startsWith('tmenu_')) return false;

  // token is the last _ segment (no underscores in our token format)
  const token = interaction.customId.split('_').pop();
  const sessionKey = `${interaction.user.id}_${token}`;
  if (activeSessions.has(sessionKey)) return false; // live session — let its collector handle it

  await interaction.reply({
    content: '⌛ This menu has expired. Run `!lumi-touhou` or `/lumi-touhou menu` again.',
    ephemeral: true,
  }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Screen renderers — pure functions returning { embeds, components }
// ---------------------------------------------------------------------------

function renderMainMenu(token) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎮 Touhou Menu')
        .setColor(0x5865f2)
        .setDescription(
          '🌸 **Adopt** — Adopt a random Touhou (25 SGC)\n' +
          '⚔️ **Battle** — Fight an evil Touhou (PvE)\n' +
          '🏪 **Market** — Buy, trade, and manage listings\n' +
          '💊 **Heal** — Instantly heal a fainted party member (50 SGC)',
        )
        .setFooter({ text: 'Closes after 5 min of inactivity.' }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_adopt_${token}`).setLabel('🌸 Adopt').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tmenu_battle_${token}`).setLabel('⚔️ Battle').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tmenu_market_${token}`).setLabel('🏪 Market').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tmenu_heal_${token}`).setLabel('💊 Heal').setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function renderBattlePartySelect(token, party, statsMap) {
  const options = party.slice(0, SELECT_PAGE_SIZE).map((t) => {
    const stats = statsMap[t.name] || { level: 1, wins: 0, losses: 0, fainted_until: null };
    const fainted = stats.fainted_until && stats.fainted_until > Date.now();
    const rarity = getRarity(t.trade_count, t.name, t.base_rarity_score || 0, stats.level || 1);
    return {
      label: trunc(`${fainted ? '⏸ ' : ''}${rarity.emoji} ${t.name}`, 100),
      description: trunc(
        fainted
          ? `Fainted — heals in ${formatRemaining(stats.fainted_until - Date.now())}`
          : `Lv ${stats.level} • ${stats.wins}W/${stats.losses}L`,
        100,
      ),
      value: t.name,
    };
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('⚔️ Battle — Select Your Fighter')
        .setColor(0x5865f2)
        .setDescription('Pick a party member to go into battle.\n⏸ = fainted (must heal first).')
        .setFooter({ text: 'Select then choose a rarity.' }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`tmenu_party_pick_${token}`)
          .setPlaceholder('Choose your Touhou…')
          .addOptions(options),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderBattleRaritySelect(token, selectedName) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('⚔️ Battle — Choose Opponent Rarity')
        .setColor(0x5865f2)
        .setDescription(
          `**${selectedName}** will fight.\nPick a rarity to face, or **🎲 Gamble** for a random rarity with **+20% EXP/SGC rewards**.`,
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_rarity_Common_${token}`).setLabel('⬜ Common').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tmenu_rarity_Uncommon_${token}`).setLabel('🟩 Uncommon').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tmenu_rarity_Rare_${token}`).setLabel('🟦 Rare').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tmenu_rarity_Epic_${token}`).setLabel('🟪 Epic').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tmenu_rarity_Legendary_${token}`).setLabel('🟨 Legendary').setStyle(ButtonStyle.Danger),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_rarity_gamble_${token}`).setLabel('🎲 Gamble (+20%)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderMarketMenu(token) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🏪 Touhou Market')
        .setColor(0xfaa61a)
        .setDescription(
          '📋 **Listings** — Browse & buy Touhous for sale\n' +
          '🧪 **Potions** — Buy Health Potions (20 SGC each, cap 10)\n' +
          '🔄 **Trade** — Swap Touhous with another user\n' +
          '🗑️ **Delist** — Remove your listing from the market\n' +
          '↩️ **Buyback** — Sell a Touhou back to the market (~2/3 price)\n' +
          '🎁 **Send** — Gift a Touhou to someone for free',
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_mkt_listings_${token}`).setLabel('📋 Listings').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tmenu_mkt_potions_${token}`).setLabel('🧪 Potions').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tmenu_mkt_trade_${token}`).setLabel('🔄 Trade').setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_mkt_delist_${token}`).setLabel('🗑️ Delist').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tmenu_mkt_buyback_${token}`).setLabel('↩️ Buyback').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tmenu_mkt_send_${token}`).setLabel('🎁 Send').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderListingsPage(token, page, listings, total) {
  const totalPages = Math.max(1, Math.ceil(total / SELECT_PAGE_SIZE));
  const lines = listings.map((l) => {
    const r = getRarity(l.trade_count, l.touhou_name, l.base_rarity_score || 0);
    return `${r.emoji} **${l.touhou_name}** — **${l.price} SGC** by <@${l.seller_id}>`;
  });

  const options = listings.map((l) => {
    const r = getRarity(l.trade_count, l.touhou_name, l.base_rarity_score || 0);
    return {
      label: trunc(`${r.emoji} ${l.touhou_name}`, 100),
      description: trunc(`${l.price} SGC`, 100),
      value: l.touhou_name,
    };
  });

  const components = [];
  if (options.length > 0) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`tmenu_buy_pick_${token}`)
          .setPlaceholder('Select a Touhou to buy…')
          .addOptions(options),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tmenu_page_prev_${token}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId(`tmenu_page_next_${token}`).setLabel('➡️ Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
      new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`📋 Listings — Page ${page}/${totalPages}`)
        .setColor(0xfaa61a)
        .setDescription(lines.length > 0 ? lines.join('\n') : '_No listings on this page._')
        .setFooter({ text: `${total} total listing(s) • select below to buy` }),
    ],
    components,
  };
}

function renderDelistSelect(token, myListings) {
  if (myListings.length === 0) {
    return renderFlash('📭 You have no active listings in this server.', 0xfaa61a, token, '🏪 Back to Market');
  }
  const options = myListings.slice(0, SELECT_PAGE_SIZE).map((l) => {
    const r = getRarity(l.trade_count, l.touhou_name, l.base_rarity_score || 0);
    return {
      label: trunc(`${r.emoji} ${l.touhou_name}`, 100),
      description: trunc(`Listed at ${l.price} SGC`, 100),
      value: l.touhou_name,
    };
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🗑️ Delist')
        .setColor(0xfaa61a)
        .setDescription('Select a listing to remove from the marketplace.'),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`tmenu_delist_pick_${token}`)
          .setPlaceholder('Select a listing to remove…')
          .addOptions(options),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderBuybackPage(token, touhous, page) {
  const total = touhous.length;
  const totalPages = Math.max(1, Math.ceil(total / SELECT_PAGE_SIZE));
  const start = (page - 1) * SELECT_PAGE_SIZE;
  const slice = touhous.slice(start, start + SELECT_PAGE_SIZE);

  const options = slice.map((t) => {
    const r = getRarity(t.trade_count, t.name, t.base_rarity_score || 0);
    const suggested = getSuggestedPrice(t.trade_count, t.base_rarity_score || 0);
    const buybackPrice = Math.floor(suggested * 2 / 3);
    return {
      label: trunc(`${r.emoji} ${t.name}`, 100),
      description: trunc(`~${buybackPrice} SGC (2/3 of ~${suggested} suggested)`, 100),
      value: t.name,
    };
  });

  const components = [];
  if (options.length > 0) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`tmenu_buyback_pick_${token}`)
          .setPlaceholder('Select a Touhou to sell back…')
          .addOptions(options),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tmenu_page_prev_${token}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId(`tmenu_page_next_${token}`).setLabel('➡️ Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
      new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`↩️ Buyback — Page ${page}/${totalPages}`)
        .setColor(0xfaa61a)
        .setDescription('Select a Touhou to sell back to the market for ~2/3 of its suggested price.'),
    ],
    components,
  };
}

function renderHealSelect(token, guildId, userId, party) {
  const faintedOnly = party.filter((t) => {
    const stats = getOrCreateBattleStats(guildId, t.name, userId);
    return stats.fainted_until && stats.fainted_until > Date.now();
  });

  if (faintedOnly.length === 0) {
    return renderFlash('✨ All your Touhous are already healthy and ready to battle!', 0x57f287, token);
  }

  const options = faintedOnly.slice(0, SELECT_PAGE_SIZE).map((t) => {
    const stats = getOrCreateBattleStats(guildId, t.name, userId);
    const r = getRarity(t.trade_count, t.name, t.base_rarity_score || 0, stats.level || 1);
    const remaining = formatRemaining(stats.fainted_until - Date.now());
    return {
      label: trunc(`${r.emoji} ${t.name}`, 100),
      description: trunc(`💤 Heals in ${remaining} • ${HEAL_COST} SGC to instant heal`, 100),
      value: t.name,
    };
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('💊 Heal a Fainted Touhou')
        .setColor(0xed4245)
        .setDescription(`Select a fainted party member to instantly heal for **${HEAL_COST} SGC**.`),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`tmenu_heal_pick_${token}`)
          .setPlaceholder('Choose a Touhou to heal…')
          .addOptions(options),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderPotionAmountSelect(token, currentCount) {
  const maxBuy = POTION_CAP - currentCount;
  if (maxBuy <= 0) {
    return renderFlash(`🧪 Your potion inventory is full (${POTION_CAP}/${POTION_CAP}).`, 0x57f287, token, '🏪 Back to Market');
  }

  const options = [];
  for (let n = 1; n <= Math.min(maxBuy, SELECT_PAGE_SIZE); n++) {
    options.push({
      label: `${n} potion${n > 1 ? 's' : ''} — ${n * POTION_PRICE} SGC`,
      description: `Inventory after: ${currentCount + n}/${POTION_CAP}`,
      value: String(n),
    });
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🧪 Buy Health Potions')
        .setColor(0x57f287)
        .setDescription(
          `Inventory: **${currentCount}/${POTION_CAP}**\n` +
          `Price: **${POTION_PRICE} SGC** each\n` +
          `Potions restore 50% max HP in battle.`,
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`tmenu_potion_amt_${token}`)
          .setPlaceholder('How many potions?')
          .addOptions(options),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderPromptEmbed(title, description, token) {
  return {
    embeds: [new EmbedBuilder().setTitle(title).setColor(0x5865f2).setDescription(description)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel('🔙 Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderFlash(description, color, token, backLabel = '🔙 Back') {
  return {
    embeds: [new EmbedBuilder().setDescription(description).setColor(color)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tmenu_back_${token}`).setLabel(backLabel).setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Navigation helper
// ---------------------------------------------------------------------------

async function navigateTo(dest, menuMsg, token, menuState, guildId, userId) {
  menuState.screen = dest;
  switch (dest) {
    case 'main':
      await menuMsg.edit(renderMainMenu(token));
      break;
    case 'market':
      await menuMsg.edit(renderMarketMenu(token));
      break;
    case 'listings': {
      const total = getListingsCount(guildId);
      const page = menuState.page || 1;
      const offset = (page - 1) * SELECT_PAGE_SIZE;
      const listings = getListingsPage(guildId, SELECT_PAGE_SIZE, offset);
      await menuMsg.edit(renderListingsPage(token, page, listings, total));
      break;
    }
    case 'battle_party':
      if (!menuState.party) {
        menuState.screen = 'main';
        await menuMsg.edit(renderMainMenu(token));
      } else {
        await menuMsg.edit(renderBattlePartySelect(token, menuState.party, menuState.statsMap || {}));
      }
      break;
    default:
      menuState.screen = 'main';
      await menuMsg.edit(renderMainMenu(token));
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function handleTouhouMenu(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: '❌ Touhou commands can only be used in a server.', ephemeral: true });
    return;
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;
  const token = makeToken();
  const sessionKey = `${userId}_${token}`;

  ensureAccount(userId, username);

  // Post the main menu.
  await interaction.reply(renderMainMenu(token));
  const menuMsg = await interaction.fetchReply();
  if (!menuMsg) {
    logger.warn('Touhou menu: could not get menuMsg after reply.');
    return;
  }

  activeSessions.add(sessionKey);

  const menuState = {
    screen: 'main',
    page: 1,
    selectedName: null,
    party: null,
    statsMap: null,
    touhous: null,
  };

  const collector = menuMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === userId && i.customId.endsWith(`_${token}`),
    idle: MENU_TIMEOUT,
  });

  collector.on('collect', async (i) => {
    const cid = i.customId;

    try {
      // ── Back button — handled globally, before any screen-specific logic ──────
      if (cid.startsWith('tmenu_back_')) {
        await i.deferUpdate();
        const dest = PARENT_SCREEN[menuState.screen] || 'main';
        await navigateTo(dest, menuMsg, token, menuState, guildId, userId);
        return;
      }

      // ── MAIN MENU ────────────────────────────────────────────────────────────
      if (menuState.screen === 'main') {
        if (cid.startsWith('tmenu_adopt_')) {
          await i.deferUpdate();
          await handleInlineAdopt(userId, username, guildId, menuMsg, token);
          menuState.screen = 'flash_main';
          return;
        }

        if (cid.startsWith('tmenu_battle_')) {
          await i.deferUpdate();
          const party = getUserTouhous(guildId, userId);
          if (party.length === 0) {
            await menuMsg.edit(renderFlash('❌ You have no Touhous yet! Use 🌸 **Adopt** first.', 0xed4245, token));
            menuState.screen = 'flash_main';
            return;
          }
          const statsMap = {};
          for (const t of party) {
            statsMap[t.name] = getOrCreateBattleStats(guildId, t.name, userId);
          }
          menuState.party = party;
          menuState.statsMap = statsMap;
          menuState.screen = 'battle_party';
          await menuMsg.edit(renderBattlePartySelect(token, party, statsMap));
          return;
        }

        if (cid.startsWith('tmenu_market_')) {
          await i.deferUpdate();
          menuState.screen = 'market';
          await menuMsg.edit(renderMarketMenu(token));
          return;
        }

        if (cid.startsWith('tmenu_heal_')) {
          await i.deferUpdate();
          const party = getUserTouhous(guildId, userId);
          if (party.length === 0) {
            await menuMsg.edit(renderFlash('❌ You have no Touhous yet! Use 🌸 **Adopt** first.', 0xed4245, token));
            menuState.screen = 'flash_main';
            return;
          }
          menuState.party = party;
          menuState.screen = 'heal';
          await menuMsg.edit(renderHealSelect(token, guildId, userId, party));
          return;
        }
        return;
      }

      // ── BATTLE — PARTY SELECT ────────────────────────────────────────────────
      if (menuState.screen === 'battle_party') {
        if (cid.startsWith('tmenu_party_pick_')) {
          await i.deferUpdate();
          const name = i.values[0];
          const stats = (menuState.statsMap || {})[name] || getOrCreateBattleStats(guildId, name, userId);
          if (stats.fainted_until && stats.fainted_until > Date.now()) {
            await menuMsg.edit(renderFlash(
              `💤 **${name}** is fainted and can't battle.\nHeals in ${formatRemaining(stats.fainted_until - Date.now())} — or use 💊 **Heal** to pay ${HEAL_COST} SGC.`,
              0xed4245, token,
            ));
            menuState.screen = 'flash_main';
            return;
          }
          menuState.selectedName = name;
          menuState.screen = 'battle_rarity';
          await menuMsg.edit(renderBattleRaritySelect(token, name));
          return;
        }
        return;
      }

      // ── BATTLE — RARITY SELECT ───────────────────────────────────────────────
      if (menuState.screen === 'battle_rarity') {
        if (cid.startsWith('tmenu_rarity_')) {
          await i.deferUpdate();
          // customId: tmenu_rarity_RARITY_token  (RARITY has no underscores)
          const parts = cid.split('_'); // ['tmenu','rarity','RARITY','token']
          const rarityRaw = parts[2]; // e.g. 'Common', 'gamble'
          const rarityChoice = rarityRaw === 'gamble' ? 'gamble' : rarityRaw;
          const selectedName = menuState.selectedName;

          if (!selectedName) {
            menuState.screen = 'main';
            await menuMsg.edit(renderMainMenu(token));
            return;
          }

          const touhou = getTouhou(guildId, selectedName);
          if (!touhou || touhou.owner_id !== userId) {
            await menuMsg.edit(renderFlash(`❌ You no longer own **${selectedName}**.`, 0xed4245, token));
            menuState.screen = 'flash_main';
            return;
          }

          const attacks = getAttacks(selectedName);
          if (attacks.length === 0) {
            await menuMsg.edit(renderFlash(
              `❌ **${selectedName}** has no attacks seeded. Run \`npm run build:touhou-attacks\` and restart.`,
              0xed4245, token,
            ));
            menuState.screen = 'flash_main';
            return;
          }

          const stats = getOrCreateBattleStats(guildId, selectedName, userId);

          // Stop the menu collector and pass control to the battle engine.
          collector.stop('battle_started');
          activeSessions.delete(sessionKey);

          await menuMsg.edit({
            embeds: [new EmbedBuilder().setDescription(`⚔️ **${selectedName}** charges into battle!`).setColor(0x5865f2)],
            components: [],
          });

          // Wrap so startBattle sends a new channel message rather than
          // replying to the already-replied interaction.
          const battleInteraction = makeBattleInteraction(interaction);

          await startBattle({
            interaction: battleInteraction,
            guildId,
            playerTouhou: touhou,
            playerStats: stats,
            playerAttacks: attacks,
            rarityChoice,
            touhouDir,
            payTouhouTraderPayout: localPayout,
            getPotionCount,
            consumePotion,
          });
          return;
        }
        return;
      }

      // ── MARKET MENU ──────────────────────────────────────────────────────────
      if (menuState.screen === 'market') {
        if (cid.startsWith('tmenu_mkt_listings_')) {
          await i.deferUpdate();
          menuState.page = 1;
          menuState.screen = 'listings';
          const total = getListingsCount(guildId);
          const listings = getListingsPage(guildId, SELECT_PAGE_SIZE, 0);
          await menuMsg.edit(renderListingsPage(token, 1, listings, total));
          return;
        }

        if (cid.startsWith('tmenu_mkt_potions_')) {
          await i.deferUpdate();
          const currentCount = getPotionCount(guildId, userId);
          menuState.screen = 'potions';
          await menuMsg.edit(renderPotionAmountSelect(token, currentCount));
          return;
        }

        if (cid.startsWith('tmenu_mkt_trade_')) {
          await i.deferUpdate();
          menuState.screen = 'awaiting_trade';
          await menuMsg.edit(renderPromptEmbed(
            '🔄 Trade',
            'Type your trade request in chat:\n```\nyour_touhou_name @mention their_touhou_name\n```\n60 seconds to respond, or click Cancel.',
            token,
          ));
          awaitTradeInput(menuMsg, token, interaction, guildId, userId, menuState);
          return;
        }

        if (cid.startsWith('tmenu_mkt_delist_')) {
          await i.deferUpdate();
          const allListings = getListings(guildId);
          const mine = allListings.filter((l) => l.seller_id === userId);
          menuState.screen = 'delist';
          await menuMsg.edit(renderDelistSelect(token, mine));
          return;
        }

        if (cid.startsWith('tmenu_mkt_buyback_')) {
          await i.deferUpdate();
          const all = getUserTouhous(guildId, userId);
          if (all.length === 0) {
            await menuMsg.edit(renderFlash('📭 You have no Touhous to sell back.', 0xfaa61a, token, '🏪 Back to Market'));
            menuState.screen = 'flash_market';
            return;
          }
          menuState.touhous = all;
          menuState.page = 1;
          menuState.screen = 'buyback';
          await menuMsg.edit(renderBuybackPage(token, all, 1));
          return;
        }

        if (cid.startsWith('tmenu_mkt_send_')) {
          await i.deferUpdate();
          menuState.screen = 'awaiting_send';
          await menuMsg.edit(renderPromptEmbed(
            '🎁 Send a Touhou',
            'Type the details in chat:\n```\ntouhou_name @mention\n```\n60 seconds to respond, or click Cancel.',
            token,
          ));
          awaitSendInput(menuMsg, token, interaction, guildId, userId, menuState);
          return;
        }
        return;
      }

      // ── LISTINGS ─────────────────────────────────────────────────────────────
      if (menuState.screen === 'listings') {
        if (cid.startsWith('tmenu_buy_pick_')) {
          await i.deferUpdate();
          const touhouName = i.values[0];
          await handleInlineBuy(menuMsg, token, guildId, userId, username, touhouName, menuState);
          return;
        }
        if (cid.startsWith('tmenu_page_prev_')) {
          await i.deferUpdate();
          menuState.page = Math.max(1, menuState.page - 1);
          const total = getListingsCount(guildId);
          const listings = getListingsPage(guildId, SELECT_PAGE_SIZE, (menuState.page - 1) * SELECT_PAGE_SIZE);
          await menuMsg.edit(renderListingsPage(token, menuState.page, listings, total));
          return;
        }
        if (cid.startsWith('tmenu_page_next_')) {
          await i.deferUpdate();
          menuState.page += 1;
          const total = getListingsCount(guildId);
          const listings = getListingsPage(guildId, SELECT_PAGE_SIZE, (menuState.page - 1) * SELECT_PAGE_SIZE);
          await menuMsg.edit(renderListingsPage(token, menuState.page, listings, total));
          return;
        }
        return;
      }

      // ── DELIST ───────────────────────────────────────────────────────────────
      if (menuState.screen === 'delist') {
        if (cid.startsWith('tmenu_delist_pick_')) {
          await i.deferUpdate();
          const touhouName = i.values[0];
          const result = delistTouhou(guildId, userId, touhouName);
          if (result.success) {
            await menuMsg.edit(renderFlash(`✅ **${touhouName}** removed from the marketplace.`, 0x57f287, token, '🏪 Back to Market'));
          } else {
            await menuMsg.edit(renderFlash(`❌ ${result.error}`, 0xed4245, token, '🏪 Back to Market'));
          }
          menuState.screen = 'flash_market';
          return;
        }
        return;
      }

      // ── BUYBACK ──────────────────────────────────────────────────────────────
      if (menuState.screen === 'buyback') {
        if (cid.startsWith('tmenu_buyback_pick_')) {
          await i.deferUpdate();
          const touhouName = i.values[0];
          const result = sellbackToMarket(guildId, userId, touhouName);
          if (!result.success) {
            await menuMsg.edit(renderFlash(`❌ ${result.error}`, 0xed4245, token, '🏪 Back to Market'));
            menuState.screen = 'flash_market';
            return;
          }
          localPayout(userId, result.payout, `Touhou buyback: ${touhouName}`);
          await menuMsg.edit(renderFlash(
            `💸 Sold **${touhouName}** back to the market for **${result.payout} SGC**.\n_Level reset; Touhou returns to the adoption pool._`,
            0x57f287, token, '🏪 Back to Market',
          ));
          menuState.screen = 'flash_market';
          return;
        }
        if (cid.startsWith('tmenu_page_prev_')) {
          await i.deferUpdate();
          menuState.page = Math.max(1, menuState.page - 1);
          await menuMsg.edit(renderBuybackPage(token, menuState.touhous, menuState.page));
          return;
        }
        if (cid.startsWith('tmenu_page_next_')) {
          await i.deferUpdate();
          menuState.page += 1;
          await menuMsg.edit(renderBuybackPage(token, menuState.touhous, menuState.page));
          return;
        }
        return;
      }

      // ── POTIONS ──────────────────────────────────────────────────────────────
      if (menuState.screen === 'potions') {
        if (cid.startsWith('tmenu_potion_amt_')) {
          await i.deferUpdate();
          const amount = parseInt(i.values[0], 10);
          await handleInlinePotionBuy(menuMsg, token, guildId, userId, username, amount, menuState);
          return;
        }
        return;
      }

      // ── HEAL ─────────────────────────────────────────────────────────────────
      if (menuState.screen === 'heal') {
        if (cid.startsWith('tmenu_heal_pick_')) {
          await i.deferUpdate();
          const touhouName = i.values[0];
          await handleInlineHeal(menuMsg, token, guildId, userId, username, touhouName, menuState);
          return;
        }
        return;
      }

    } catch (err) {
      logger.error('Touhou menu error:', err.message);
      try {
        await menuMsg.edit(renderFlash('❌ An error occurred. Please try again.', 0xed4245, token));
        menuState.screen = 'flash_main';
      } catch { /* ignore */ }
    }
  });

  collector.on('end', async (_collected, reason) => {
    activeSessions.delete(sessionKey);
    if (reason === 'battle_started') return;
    try {
      await menuMsg.edit({
        embeds: [new EmbedBuilder().setDescription('⏰ Menu timed out. Run `!lumi-touhou` again.').setColor(0x4f4f4f)],
        components: [],
      });
    } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Battle interaction wrapper
// ---------------------------------------------------------------------------

/**
 * startBattle() calls interaction.reply() to post the battle embed, then
 * interaction.fetchReply() to get the Message for its own collector.
 * Since the parent interaction already has a reply (the menu), we must
 * intercept reply() to use channel.send() instead.
 */
function makeBattleInteraction(interaction) {
  const wrapper = {
    user: interaction.user,
    member: interaction.member,
    guildId: interaction.guildId,
    channel: interaction.channel,
    client: interaction.client,
    deferred: false,
    replied: false,
    _msg: null,
    async reply(content) {
      this._msg = await interaction.channel.send(content);
      this.replied = true;
      return this._msg;
    },
    async fetchReply() {
      return this._msg;
    },
    async editReply(content) {
      if (!this._msg) return;
      return this._msg.edit(content);
    },
    async followUp(content) {
      return interaction.channel.send(content);
    },
    async deferReply() { /* no-op */ },
  };
  return wrapper;
}

// ---------------------------------------------------------------------------
// Inline action handlers
// ---------------------------------------------------------------------------

async function handleInlineAdopt(userId, username, guildId, menuMsg, token) {
  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < BASE_ADOPT_PRICE) {
    await menuMsg.edit(renderFlash(
      `❌ You need **${BASE_ADOPT_PRICE} SGC** to adopt but only have **${balance} SGC**.`,
      0xed4245, token,
    ));
    return;
  }

  const result = adoptTouhou(guildId, userId);
  if (!result.success) {
    await menuMsg.edit(renderFlash(`❌ ${result.error}`, 0xed4245, token));
    return;
  }

  const { name } = result.touhou;
  adjustBalance(userId, -BASE_ADOPT_PRICE, `Adopted Touhou: ${name}`);
  adjustBalance(TOUHOU_MGMT_USER_ID, BASE_ADOPT_PRICE, `Touhou adoption fee: ${name}`);
  const rarity = getRarity(result.touhou.trade_count || 0, name, result.touhou.base_rarity_score || 0);
  await menuMsg.edit(renderFlash(
    `🎉 You adopted **${name}**! ${rarity.emoji} ${rarity.tier}\n💰 Cost: **${BASE_ADOPT_PRICE} SGC** | Balance: **${balance - BASE_ADOPT_PRICE} SGC**`,
    0x57f287, token,
  ));
}

async function handleInlineBuy(menuMsg, token, guildId, userId, username, touhouName, menuState) {
  ensureAccount(userId, username);
  const listingPrice = getListingPrice(guildId, touhouName);
  if (listingPrice === null) {
    await menuMsg.edit(renderFlash(`❌ **${touhouName}** is no longer listed for sale.`, 0xed4245, token, '🔙 Back to Listings'));
    menuState.screen = 'flash_listings';
    return;
  }

  const balance = getBalance(userId);
  if (balance < listingPrice) {
    await menuMsg.edit(renderFlash(
      `❌ **${touhouName}** costs **${listingPrice} SGC** but you only have **${balance} SGC**.`,
      0xed4245, token, '🔙 Back to Listings',
    ));
    menuState.screen = 'flash_listings';
    return;
  }

  const result = buyListing(guildId, userId, touhouName);
  if (!result.success) {
    await menuMsg.edit(renderFlash(`❌ ${result.error}`, 0xed4245, token, '🔙 Back to Listings'));
    menuState.screen = 'flash_listings';
    return;
  }

  const tax = Math.max(1, Math.floor(result.price * 0.10));
  const sellerReceives = result.price - tax;
  adjustBalance(userId, -result.price, `Bought Touhou: ${touhouName}`);
  adjustBalance(result.sellerId, sellerReceives, `Sold Touhou: ${touhouName} (after 10% tax)`);
  adjustBalance(TOUHOU_MGMT_USER_ID, tax, `Touhou trade tax: ${touhouName}`);

  const rarity = getRarity(result.touhou.trade_count, touhouName, result.touhou.base_rarity_score || 0);
  await menuMsg.edit(renderFlash(
    `💰 Bought **${touhouName}** for **${result.price} SGC**! ${rarity.emoji} ${rarity.tier}\n_(${tax} SGC tax • <@${result.sellerId}> received ${sellerReceives} SGC)_`,
    0x57f287, token, '🏪 Back to Market',
  ));
  menuState.screen = 'flash_market';
}

async function handleInlinePotionBuy(menuMsg, token, guildId, userId, username, amount, menuState) {
  ensureAccount(userId, username);
  const currentCount = getPotionCount(guildId, userId);
  if (currentCount >= POTION_CAP) {
    await menuMsg.edit(renderFlash(`❌ Potion inventory full (${POTION_CAP}/${POTION_CAP}).`, 0xed4245, token, '🏪 Back to Market'));
    menuState.screen = 'flash_market';
    return;
  }

  const addable = Math.min(amount, POTION_CAP - currentCount);
  const totalCost = addable * POTION_PRICE;
  const balance = getBalance(userId);
  if (balance < totalCost) {
    await menuMsg.edit(renderFlash(
      `❌ Need **${totalCost} SGC** for ${addable} potion(s) but you have **${balance} SGC**.`,
      0xed4245, token, '🏪 Back to Market',
    ));
    menuState.screen = 'flash_market';
    return;
  }

  const addResult = addPotions(guildId, userId, addable);
  if (!addResult.success || addResult.added <= 0) {
    await menuMsg.edit(renderFlash('❌ Potion purchase failed: inventory cap reached.', 0xed4245, token, '🏪 Back to Market'));
    menuState.screen = 'flash_market';
    return;
  }

  const finalCost = addResult.added * POTION_PRICE;
  adjustBalance(userId, -finalCost, `Bought ${addResult.added} Health Potion(s)`);
  adjustBalance(TOUHOU_MGMT_USER_ID, finalCost, `Touhou potion sale (${addResult.added})`);
  await menuMsg.edit(renderFlash(
    `🧪 Purchased **${addResult.added}** Health Potion(s) for **${finalCost} SGC**!\nInventory: **${addResult.newCount}/${POTION_CAP}**`,
    0x57f287, token, '🏪 Back to Market',
  ));
  menuState.screen = 'flash_market';
}

async function handleInlineHeal(menuMsg, token, guildId, userId, username, touhouName, menuState) {
  ensureAccount(userId, username);
  const stats = getOrCreateBattleStats(guildId, touhouName, userId);
  if (!stats.fainted_until || stats.fainted_until <= Date.now()) {
    await menuMsg.edit(renderFlash(`✨ **${touhouName}** is already healthy!`, 0x57f287, token));
    menuState.screen = 'flash_main';
    return;
  }

  const balance = getBalance(userId);
  if (balance < HEAL_COST) {
    await menuMsg.edit(renderFlash(
      `❌ Instant heal costs **${HEAL_COST} SGC** but you have **${balance} SGC**.\n` +
      `**${touhouName}** auto-heals in ${formatRemaining(stats.fainted_until - Date.now())}.`,
      0xed4245, token,
    ));
    menuState.screen = 'flash_main';
    return;
  }

  adjustBalance(userId, -HEAL_COST, `Touhou instant-heal: ${touhouName}`);
  adjustBalance(TOUHOU_MGMT_USER_ID, HEAL_COST, `Touhou instant-heal fee: ${touhouName}`);
  healTouhou(guildId, touhouName, userId);
  cancelFaintReminder(guildId, userId, touhouName);
  await menuMsg.edit(renderFlash(
    `✨ **${touhouName}** is healed for **${HEAL_COST} SGC** and ready to battle!`,
    0x57f287, token,
  ));
  menuState.screen = 'flash_main';
}

// ---------------------------------------------------------------------------
// Text-input flows (Trade & Send)
// ---------------------------------------------------------------------------

/**
 * Start listening for the user's trade message in chat, then process it.
 * Fire-and-forget — the menu collector still handles Back/Cancel while this waits.
 */
function awaitTradeInput(menuMsg, token, interaction, guildId, userId, menuState) {
  interaction.channel.awaitMessages({
    filter: (m) => m.author.id === userId && !m.author.bot,
    max: 1,
    time: 60_000,
    errors: ['time'],
  }).then(async (collected) => {
    if (menuState.screen !== 'awaiting_trade') return; // user clicked Cancel

    const msg = collected.first();
    msg.delete().catch(() => {});
    const content = msg.content.trim();

    const mentionMatch = content.match(/<@!?(\d+)>/);
    if (!mentionMatch) {
      await menuMsg.edit(renderFlash('❌ No mention found. Format: `your_name @user their_name`', 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    const targetUserId = mentionMatch[1];
    if (targetUserId === userId) {
      await menuMsg.edit(renderFlash("❌ You can't trade with yourself.", 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    const mentionStart = content.indexOf('<@');
    const mentionEnd = content.indexOf('>', mentionStart) + 1;
    const yourNameRaw = content.slice(0, mentionStart).trim();
    const theirNameRaw = content.slice(mentionEnd).trim();

    if (!yourNameRaw || !theirNameRaw) {
      await menuMsg.edit(renderFlash('❌ Missing Touhou names. Format: `your_name @user their_name`', 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    const yourName = resolveName(yourNameRaw);
    const theirName = resolveName(theirNameRaw);

    if (!yourName) {
      await menuMsg.edit(renderFlash(`❌ Couldn't find a Touhou named **${yourNameRaw}**.`, 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }
    if (!theirName) {
      await menuMsg.edit(renderFlash(`❌ Couldn't find a Touhou named **${theirNameRaw}**.`, 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    // Notify pending and wait for target to type "yes" or "no" in chat.
    await menuMsg.edit({
      embeds: [
        new EmbedBuilder()
          .setDescription(`⏳ Trade request sent to <@${targetUserId}>.\nThey must type **yes** or **no** in chat within 60 seconds.`)
          .setColor(0x5865f2),
      ],
      components: [],
    });
    menuState.screen = 'awaiting_trade_confirm';

    try {
      const confirmCol = await interaction.channel.awaitMessages({
        filter: (m) => m.author.id === targetUserId && ['yes', 'no'].includes(m.content.trim().toLowerCase()),
        max: 1,
        time: 60_000,
        errors: ['time'],
      });

      const confirmMsg = confirmCol.first();
      confirmMsg.delete().catch(() => {});

      if (confirmMsg.content.trim().toLowerCase() === 'no') {
        await menuMsg.edit(renderFlash(`❌ <@${targetUserId}> declined the trade.`, 0xed4245, token, '🏪 Back to Market'));
        menuState.screen = 'flash_market';
        return;
      }

      const result = swapTouhous(guildId, userId, yourName, targetUserId, theirName);
      if (!result.success) {
        await menuMsg.edit(renderFlash(`❌ Trade failed: ${result.error}`, 0xed4245, token, '🏪 Back to Market'));
        menuState.screen = 'flash_market';
        return;
      }

      await menuMsg.edit(renderFlash(
        `🔄 **Trade complete!**\n<@${userId}> gave **${yourName}** ↔ <@${targetUserId}> gave **${theirName}**`,
        0x57f287, token, '🏪 Back to Market',
      ));
      menuState.screen = 'flash_market';
    } catch {
      if (menuState.screen !== 'awaiting_trade_confirm') return;
      await menuMsg.edit(renderFlash('⌛ Trade timed out waiting for confirmation.', 0xfaa61a, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
    }
  }).catch(async () => {
    if (menuState.screen !== 'awaiting_trade') return;
    await menuMsg.edit(renderFlash('⌛ Trade input timed out.', 0xfaa61a, token, '🏪 Back to Market'));
    menuState.screen = 'flash_market';
  });
}

function awaitSendInput(menuMsg, token, interaction, guildId, userId, menuState) {
  interaction.channel.awaitMessages({
    filter: (m) => m.author.id === userId && !m.author.bot,
    max: 1,
    time: 60_000,
    errors: ['time'],
  }).then(async (collected) => {
    if (menuState.screen !== 'awaiting_send') return;

    const msg = collected.first();
    msg.delete().catch(() => {});
    const content = msg.content.trim();

    const mentionMatch = content.match(/<@!?(\d+)>/);
    if (!mentionMatch) {
      await menuMsg.edit(renderFlash('❌ No mention found. Format: `touhou_name @user`', 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    const targetUserId = mentionMatch[1];
    const mentionStart = content.indexOf('<@');
    const nameRaw = content.slice(0, mentionStart).trim();

    if (!nameRaw) {
      await menuMsg.edit(renderFlash('❌ Missing Touhou name. Format: `touhou_name @user`', 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    const touhouName = resolveName(nameRaw);
    if (!touhouName) {
      await menuMsg.edit(renderFlash(`❌ Couldn't find a Touhou named **${nameRaw}**.`, 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    const result = sendTouhou(guildId, userId, targetUserId, touhouName);
    if (!result.success) {
      await menuMsg.edit(renderFlash(`❌ ${result.error}`, 0xed4245, token, '🏪 Back to Market'));
      menuState.screen = 'flash_market';
      return;
    }

    const rarity = getRarity(result.touhou.trade_count, touhouName, result.touhou.base_rarity_score || 0);
    await menuMsg.edit(renderFlash(
      `🎁 You gifted **${touhouName}** to <@${targetUserId}>! ${rarity.emoji} ${rarity.tier}`,
      0x57f287, token, '🏪 Back to Market',
    ));
    menuState.screen = 'flash_market';
  }).catch(async () => {
    if (menuState.screen !== 'awaiting_send') return;
    await menuMsg.edit(renderFlash('⌛ Send input timed out.', 0xfaa61a, token, '🏪 Back to Market'));
    menuState.screen = 'flash_market';
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  handleTouhouMenu,
  handleTouhouMenuComponent,
  setMenuTouhouDir,
};
