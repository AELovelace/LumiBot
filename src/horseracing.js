/**
 * Horse Racing — multiplayer betting at the Momiji Casino.
 *
 * /lumi-horserace start   Start a horse racing lobby in the channel.
 * /lumi-horserace leave   Leave the lobby.
 *
 * Players use button controls:
 *   🅰️🅱️©️🅳  — Pick horse A/B/C/D
 *   5️⃣ 🔟 2️⃣0️⃣ — Set bet to 5/10/20 SGC
 *   ❌ — Leave the lobby
 *
 * After a betting window, an ASCII race animates the horses across the
 * screen. Prize pool is split among players who bet on the winner.
 * 2× multiplier if the horse with the fewest historical wins takes it.
 *
 * The lobby stays open and runs races continuously with 30-second
 * betting windows between races. A new message is posted for each race.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const {
  ensureAccount,
  getBalance,
  placeCasinoBet,
  payCasinoPayout,
  getSystemState,
  setSystemState,
} = require('./sadgirlEconomyStore');
const { getSetting } = require('./panelSettings');

// ---------------------------------------------------------------------------
// Constants (configurable via panel settings)
// ---------------------------------------------------------------------------

const HORSES = ['A', 'B', 'C', 'D'];
const HORSE_EMOJI = '🐎';
let TRACK_WIDTH = 50;                    // characters of running room
let RACE_TICK_MS = 600;                  // animation frame interval
let BETTING_WINDOW_MS = 30_000;          // 30s between races
const BET_AMOUNTS = [5, 10, 20];
let DEFAULT_BET = 5;

// ---------------------------------------------------------------------------
// Persistent win stats — saved to SQLite between sessions
// ---------------------------------------------------------------------------

const WIN_STATS_KEY = 'horse_race_wins';

/** @type {{ A: number, B: number, C: number, D: number }} */
const winStats = { A: 0, B: 0, C: 0, D: 0 };
let winStatsLoaded = false;

/** Load win stats from the database (called lazily on first use). */
function loadWinStats() {
  if (winStatsLoaded) return;
  try {
    const raw = getSystemState(WIN_STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const h of HORSES) {
        if (typeof parsed[h] === 'number' && Number.isFinite(parsed[h])) {
          winStats[h] = parsed[h];
        }
      }
      logger.info(`HorseRace: loaded win stats from DB — ${statsLine()}`);
    }
  } catch (err) {
    logger.error('HorseRace: failed to load win stats from DB', err.message);
  }
  winStatsLoaded = true;
}

/** Persist current win stats to the database. */
function saveWinStats() {
  try {
    setSystemState(WIN_STATS_KEY, JSON.stringify(winStats));
  } catch (err) {
    logger.error('HorseRace: failed to save win stats to DB', err.message);
  }
}

function getUnderdog() {
  loadWinStats();
  let min = Infinity;
  let dog = null;
  for (const h of HORSES) {
    if (winStats[h] < min) { min = winStats[h]; dog = h; }
  }
  // If all tied, no underdog bonus
  const allSame = HORSES.every((h) => winStats[h] === min);
  return allSame ? null : dog;
}

function statsLine() {
  return HORSES.map((h) => `${h}: ${winStats[h]}W`).join('  |  ');
}

// ---------------------------------------------------------------------------
// Track rendering
// ---------------------------------------------------------------------------

function renderTrack(positions) {
  const border = `*${'-'.repeat(TRACK_WIDTH + 4)}*`;
  const lines = [border];
  for (let i = 0; i < HORSES.length; i++) {
    const pos = Math.min(positions[i], TRACK_WIDTH);
    const before = ' '.repeat(pos);
    const after = ' '.repeat(TRACK_WIDTH - pos);
    lines.push(`|${HORSES[i]}${before}${HORSE_EMOJI}${after}  |`);
    if (i < HORSES.length - 1) {
      lines.push(`|${'-'.repeat(TRACK_WIDTH + 4)}|`);
    }
  }
  lines.push(border);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function buildBettingButtons() {
  const horseRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hr_horse_A').setLabel('Horse A').setEmoji('1️⃣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hr_horse_B').setLabel('Horse B').setEmoji('2️⃣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hr_horse_C').setLabel('Horse C').setEmoji('3️⃣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hr_horse_D').setLabel('Horse D').setEmoji('4️⃣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hr_leave').setLabel('Leave').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
  const betRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hr_bet_5').setLabel('5 SGC').setEmoji('5️⃣').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('hr_bet_10').setLabel('10 SGC').setEmoji('🔟').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('hr_bet_20').setLabel('20 SGC').setStyle(ButtonStyle.Secondary).setEmoji('💰'),
  );
  return [horseRow, betRow];
}

function disabledRows() {
  return buildBettingButtons().map((row) => {
    row.components.forEach((b) => b.setDisabled(true));
    return row;
  });
}

// ---------------------------------------------------------------------------
// Lobby state — one lobby per channel
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, {
 *   channelId: string,
 *   channel: object,
 *   players: Map<string, { userId: string, username: string, horse: string|null, bet: number }>,
 *   phase: 'betting' | 'racing' | 'done',
 *   bettingMessage: object|null,
 *   collector: object|null,
 *   bettingTimer: object|null,
 *   raceNumber: number,
 * }>}
 */
const lobbies = new Map();

function createLobbyPlayer(userId, username) {
  return { userId, username, horse: null, bet: DEFAULT_BET };
}

function getReadyFundedPlayers(lobby) {
  return [...lobby.players.values()].filter((player) => {
    if (!player.horse) return false;
    return getBalance(player.userId) >= player.bet;
  });
}

// ---------------------------------------------------------------------------
// Race logic
// ---------------------------------------------------------------------------

async function runRace(lobby) {
  lobby.phase = 'racing';

  // Collect valid bets — deduct from players now
  const racers = [];
  let totalPool = 0;
  const unfundedPlayers = [];

  for (const [userId, p] of lobby.players) {
    if (!p.horse) continue; // no horse picked → skip this race, keep in lobby

    ensureAccount(userId, p.username);
    const bal = getBalance(userId);
    if (bal < p.bet) {
      unfundedPlayers.push(`${p.username} (${bal}/${p.bet} SGC)`);
      p.horse = null;
      continue;
    }

    const result = placeCasinoBet(userId, p.username, p.bet, 'horserace');
    if (!result.success) {
      unfundedPlayers.push(`${p.username} (${bal}/${p.bet} SGC)`);
      p.horse = null;
      continue;
    }

    racers.push({ userId, username: p.username, horse: p.horse, bet: p.bet });
    totalPool += p.bet;
    logger.info(`HorseRace: ${p.username} (${userId}) placed bet=${p.bet} on Horse ${p.horse}`);
  }

  if (racers.length === 0) {
    if (unfundedPlayers.length > 0) {
      try {
        await lobby.channel.send(`🏇 Race cancelled — nobody could cover their current bet. ${unfundedPlayers.join(', ')}`);
      } catch { /* ignore */ }
    }
    // Nobody placed a valid funded bet — restart betting
    await startBettingRound(lobby);
    return;
  }

  // Stop collector for the betting message
  if (lobby.collector) { lobby.collector.stop('raceStarting'); lobby.collector = null; }

  // Disable buttons on the betting message
  try {
    await lobby.bettingMessage.edit({ components: disabledRows() });
  } catch { /* ignore */ }

  // Create a fresh message for the race
  const positions = [0, 0, 0, 0];
  const underdog = getUnderdog();

  // Show who bet on what at the start
  const betsLine = racers.map((r) => `${r.username} → Horse ${r.horse} (${r.bet} SGC)`).join('  |  ');

  let raceMsg;
  try {
    raceMsg = await lobby.channel.send(`🏇 **Race #${lobby.raceNumber}** — And they're off!\n🎫 ${betsLine}\n\`\`\`\n${renderTrack(positions)}\n\`\`\``);
  } catch (err) {
    logger.error('HorseRace: failed to send race message', err.message);
    await startBettingRound(lobby);
    return;
  }

  // Animate
  const winner = await animateRace(positions, raceMsg, lobby, betsLine);

  // Record win (persistent)
  loadWinStats();
  winStats[winner] += 1;
  saveWinStats();
  lobby.raceNumber += 1;

  // Determine winners
  const isUnderdog = underdog === winner;
  const multiplier = isUnderdog ? 2 : 1;
  const winners = racers.filter((r) => r.horse === winner);
  const losers = racers.filter((r) => r.horse !== winner);

  // Build results
  const resultLines = [
    `🏆 **Horse ${winner} wins!** ${isUnderdog ? '*(2× underdog bonus!)*' : ''}`,
    `Prize pool: **${totalPool} SGC**${isUnderdog ? ' × 2' : ''}`,
    '',
  ];

  if (winners.length > 0) {
    const effectivePool = totalPool * multiplier;
    const share = Math.floor(effectivePool / winners.length);
    for (const w of winners) {
      payCasinoPayout(w.userId, share, 'horserace');
      const newBal = getBalance(w.userId);
      resultLines.push(`✅ ${w.username} (Horse ${w.horse}) — won **${share.toLocaleString()} SGC** (bet ${w.bet}) → Balance: **${newBal.toLocaleString()} SGC**`);
      logger.info(`HorseRace: PAYOUT ${w.username} (${w.userId}) Horse ${w.horse} → ${share} SGC, new bal=${newBal}`);
    }
  } else {
    resultLines.push('No one picked the winner — house wins!');
  }

  for (const l of losers) {
    const newBal = getBalance(l.userId);
    resultLines.push(`❌ ${l.username} (Horse ${l.horse}) — lost **${l.bet} SGC** → Balance: **${newBal.toLocaleString()} SGC**`);
  }

  resultLines.push('');
  resultLines.push(`📊 Win Stats: ${statsLine()}`);

  // Update race message with final state + results
  try {
    await raceMsg.edit(
      `🏇 **Race #${lobby.raceNumber - 1}** — Finished!\n🎫 ${betsLine}\n\`\`\`\n${renderTrack(positions)}\n\`\`\`\n${resultLines.join('\n')}`
    );
  } catch (err) {
    logger.error('HorseRace: failed to edit final race msg', err.message);
  }

  // Reset horse picks for next round (keep players in lobby, keep bet amount)
  for (const p of lobby.players.values()) {
    p.horse = null;
  }

  // If anyone still in lobby, start next betting round
  if (lobby.players.size > 0) {
    await startBettingRound(lobby);
  } else {
    lobbies.delete(lobby.channelId);
  }
}

function animateRace(positions, raceMsg, lobby, betsLine) {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      let finished = false;
      let winner = null;

      for (let i = 0; i < 4; i++) {
        // Random advance: 0-4 spaces per tick
        positions[i] += Math.floor(Math.random() * 5);
        if (positions[i] >= TRACK_WIDTH) {
          positions[i] = TRACK_WIDTH;
          if (!winner) winner = HORSES[i]; // first horse past the line wins
          finished = true;
        }
      }

      try {
        await raceMsg.edit(
          `🏇 **Race #${lobby.raceNumber}** — ${finished ? 'Finished!' : 'Racing...'}\n🎫 ${betsLine}\n\`\`\`\n${renderTrack(positions)}\n\`\`\``
        );
      } catch { /* ignore edit failures */ }

      if (finished) {
        clearInterval(interval);
        resolve(winner);
      }
    }, RACE_TICK_MS);
  });
}

// ---------------------------------------------------------------------------
// Betting round
// ---------------------------------------------------------------------------

function buildBettingContent(lobby) {
  const underdog = getUnderdog();
  const underdogNote = underdog ? `\n🔥 **Horse ${underdog}** is the underdog — 2× payout if it wins!` : '';
  const playerList = [...lobby.players.values()]
    .map((p) => {
      const balance = getBalance(p.userId);
      const affordNote = balance < p.bet ? ` | Can't afford current bet (${balance} SGC)` : '';
      return `• ${p.username} — Horse: ${p.horse ?? '?'} | Bet: ${p.bet} SGC${affordNote}`;
    })
    .join('\n');

  return [
    `🏇 **Horse Race — Betting Open** *(Race #${lobby.raceNumber})*`,
    `Pick your horse and set your bet! Race starts in **${BETTING_WINDOW_MS / 1000}s**.${underdogNote}`,
    `📊 Stats: ${statsLine()}`,
    '',
    `**Players:**\n${playerList || '_No one yet — use /lumi-horserace start to join!_'}`,
  ].join('\n');
}

/** First betting round — uses the interaction reply so it's guaranteed visible. */
async function startBettingRoundFromInteraction(lobby, interaction) {
  lobby.phase = 'betting';
  const content = buildBettingContent(lobby);

  try {
    await interaction.reply({ content, components: buildBettingButtons() });
    lobby.bettingMessage = await interaction.fetchReply();
    setupBettingCollector(lobby);
  } catch (err) {
    logger.error('HorseRace: failed to send initial betting message', err.message);
    lobbies.delete(lobby.channelId);
    return;
  }

  scheduleBettingTimer(lobby);
}

/** Subsequent betting rounds — sends a new channel message. */
async function startBettingRound(lobby) {
  lobby.phase = 'betting';
  const content = buildBettingContent(lobby);

  try {
    const msg = await lobby.channel.send({ content, components: buildBettingButtons() });
    lobby.bettingMessage = msg;
    setupBettingCollector(lobby);
  } catch (err) {
    logger.error('HorseRace: failed to send betting message', err.message);
    lobbies.delete(lobby.channelId);
    return;
  }

  scheduleBettingTimer(lobby);
}

function scheduleBettingTimer(lobby) {
  lobby.bettingTimer = setTimeout(async () => {
    const anyReady = getReadyFundedPlayers(lobby).length > 0;
    if (!anyReady || lobby.players.size === 0) {
      if (lobby.collector) lobby.collector.stop('noBets');
      lobbies.delete(lobby.channelId);
      try {
        await lobby.bettingMessage.edit({
          content: '🏇 **Horse Race — Closed** (no funded bets placed)',
          components: disabledRows(),
        });
      } catch { /* ignore */ }
      return;
    }
    await runRace(lobby);
  }, BETTING_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// Button collector for betting phase
// ---------------------------------------------------------------------------

function setupBettingCollector(lobby) {
  const filter = (i) => i.customId.startsWith('hr_');
  const collector = lobby.bettingMessage.createMessageComponentCollector({ filter, time: BETTING_WINDOW_MS + 5000 });
  lobby.collector = collector;

  collector.on('collect', async (btn) => {
    const userId = btn.user.id;
    const username = btn.user.username;

    // ── Leave ──
    if (btn.customId === 'hr_leave') {
      if (lobby.players.has(userId)) {
        lobby.players.delete(userId);
        await btn.reply({ content: 'You left the horse race lobby.', ephemeral: true }).catch(() => {});

        if (lobby.players.size === 0) {
          collector.stop('allLeft');
          if (lobby.bettingTimer) clearTimeout(lobby.bettingTimer);
          lobbies.delete(lobby.channelId);
          try {
            await lobby.bettingMessage.edit({
              content: '🏇 **Horse Race — Closed** (everyone left)',
              components: disabledRows(),
            });
          } catch { /* ignore */ }
          return;
        }

        await updateBettingMessage(lobby);
      } else {
        await btn.reply({ content: "You're not in this lobby.", ephemeral: true }).catch(() => {});
      }
      return;
    }

    // ── Horse pick ──
    if (btn.customId.startsWith('hr_horse_')) {
      const horse = btn.customId.replace('hr_horse_', '');
      ensureAccount(userId, username);
      const balance = getBalance(userId);

      // Auto-join if not in lobby
      if (!lobby.players.has(userId)) {
        if (balance < DEFAULT_BET) {
          await btn.reply({ content: `❌ You need at least **${DEFAULT_BET} SGC** to join horse racing. You only have **${balance.toLocaleString()} SGC**.`, ephemeral: true }).catch(() => {});
          return;
        }
        lobby.players.set(userId, createLobbyPlayer(userId, username));
      }

      const player = lobby.players.get(userId);
      if (balance < player.bet) {
        await btn.reply({ content: `❌ You need **${player.bet.toLocaleString()} SGC** to back a horse right now, but you only have **${balance.toLocaleString()} SGC**. Lower your bet first.`, ephemeral: true }).catch(() => {});
        return;
      }

      player.horse = horse;
      logger.info(`HorseRace: ${username} (${userId}) picked Horse ${horse}`);

      await btn.reply({ content: `You picked **Horse ${horse}**! (Bet: ${player.bet} SGC)`, ephemeral: true }).catch(() => {});
      await updateBettingMessage(lobby);
      return;
    }

    // ── Bet amount ──
    if (btn.customId.startsWith('hr_bet_')) {
      const amount = parseInt(btn.customId.replace('hr_bet_', ''), 10);
      ensureAccount(userId, username);
      const bal = getBalance(userId);

      if (!lobby.players.has(userId)) {
        if (bal < amount) {
          await btn.reply({ content: `❌ You only have **${bal.toLocaleString()} SGC**.`, ephemeral: true }).catch(() => {});
          return;
        }
        lobby.players.set(userId, createLobbyPlayer(userId, username));
      }

      const player = lobby.players.get(userId);
      if (bal < amount) {
        await btn.reply({ content: `❌ You only have **${bal.toLocaleString()} SGC**.`, ephemeral: true }).catch(() => {});
        return;
      }

      player.bet = amount;
      await btn.reply({ content: `Bet set to **${amount} SGC**. (Horse: ${player.horse ?? 'not picked'})`, ephemeral: true }).catch(() => {});
      await updateBettingMessage(lobby);
      return;
    }
  });

  collector.on('end', () => {
    // Cleanup reference; race or close will handle the rest
    lobby.collector = null;
  });
}

async function updateBettingMessage(lobby) {
  const content = buildBettingContent(lobby);
  try {
    await lobby.bettingMessage.edit({ content });
  } catch (err) {
    logger.error('HorseRace: failed to update betting message', err.message);
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

function buildHorseRaceCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-horserace')
    .setDescription('Bet on horse races at the Momiji Casino!')
    .addSubcommand((sub) => sub
      .setName('start')
      .setDescription('Start or join a horse race lobby in this channel.'))
    .addSubcommand((sub) => sub
      .setName('leave')
      .setDescription('Leave the horse race lobby.'))
    .toJSON();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleHorseRaceCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return handleStart(interaction);
  if (sub === 'leave') return handleLeave(interaction);
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

async function handleStart(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const channelId = interaction.channelId;

  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < DEFAULT_BET) {
    await interaction.reply({
      content: `You need at least **${DEFAULT_BET} SGC** to join horse racing. You only have **${balance.toLocaleString()} SGC**.`,
      ephemeral: true,
    });
    return;
  }

  // Resolve the channel (interaction.channel may be null if not cached)
  const channel = interaction.channel ?? await interaction.client.channels.fetch(channelId);

  let lobby = lobbies.get(channelId);

  if (lobby) {
    // Refresh channel reference in case it was null before
    lobby.channel = channel;

    // Already a lobby — just join it
    if (lobby.players.has(userId)) {
      await interaction.reply({ content: "You're already in the horse race lobby!", ephemeral: true });
      return;
    }
    lobby.players.set(userId, createLobbyPlayer(userId, username));
    await interaction.reply({ content: `You joined the horse race lobby! Pick a horse and bet using the buttons.`, ephemeral: true });
    await updateBettingMessage(lobby);
    return;
  }

  // Create new lobby
  lobby = {
    channelId,
    channel,
    players: new Map(),
    phase: 'betting',
    bettingMessage: null,
    collector: null,
    bettingTimer: null,
    raceNumber: 1,
  };
  lobby.players.set(userId, createLobbyPlayer(userId, username));
  lobbies.set(channelId, lobby);

  // Use the interaction reply as the first betting message (visible to everyone)
  await startBettingRoundFromInteraction(lobby, interaction);
}

async function handleLeave(interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const lobby = lobbies.get(channelId);

  if (!lobby || !lobby.players.has(userId)) {
    await interaction.reply({ content: "You're not in a horse race lobby in this channel.", ephemeral: true });
    return;
  }

  lobby.players.delete(userId);
  await interaction.reply({ content: 'You left the horse race lobby.', ephemeral: true });

  if (lobby.players.size === 0) {
    if (lobby.collector) lobby.collector.stop('allLeft');
    if (lobby.bettingTimer) clearTimeout(lobby.bettingTimer);
    lobbies.delete(channelId);
    if (lobby.bettingMessage) {
      try {
        await lobby.bettingMessage.edit({
          content: '🏇 **Horse Race — Closed** (everyone left)',
          components: disabledRows(),
        });
      } catch { /* ignore */ }
    }
    return;
  }

  if (lobby.phase === 'betting') {
    await updateBettingMessage(lobby);
  }
}

function reloadSettings() {
  try {
    TRACK_WIDTH = getSetting('horseracing.trackWidth');
    RACE_TICK_MS = getSetting('horseracing.raceTickMs');
    BETTING_WINDOW_MS = getSetting('horseracing.bettingWindowMs');
    DEFAULT_BET = getSetting('horseracing.defaultBet');
  } catch { /* DB not ready */ }
}

const { config } = require('./config');
if (config.gameWorkersEnabled && config.gameWorkersHorseracing) {
  module.exports = require('./horseracingAdapter');
} else {
  module.exports = { buildHorseRaceCommand, handleHorseRaceCommand, reloadSettings };
}
