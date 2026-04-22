/**
 * Pachinko Minigame — drop a ball down a 10-wide grid and bet on the landing peg.
 *
 * The ball starts in one of the middle four pegs (positions 3–6, displayed as 4–7)
 * and drifts left or right randomly each row across 10 rows.
 *
 * Display format per row:  |.....o....|
 *   |  = wall   .  = empty   o  = ball
 *
 * Payouts (based on distance from guessed peg):
 *   exact  → 2×    (distance 0)
 *   1 off  → 1.5×  (distance 1)
 *   2 off  → 1×    (distance 2)
 *   3+ off → 0×
 */

const { SlashCommandBuilder } = require('discord.js');
const { logger } = require('./logger');
const {
  ensureAccount,
  getBalance,
  placePachinkoBet,
  payPachinkoPayout,
} = require('./sadgirlEconomyStore');
const { getSetting } = require('./panelSettings');

let GRID_WIDTH = 10;   // number of peg positions (0-indexed 0–9)
let GRID_ROWS  = 9;    // rows the ball falls through
let ROW_DELAY  = 500;  // ms between animated rows

// Middle four starting positions (0-indexed)
const START_POSITIONS = [3, 4, 5, 6];

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Simulate the ball's path.  Returns an array of row positions (length = GRID_ROWS).
 */
function simulateDrop() {
  const path = [];
  let pos = START_POSITIONS[Math.floor(Math.random() * START_POSITIONS.length)];

  for (let row = 0; row < GRID_ROWS; row++) {
    path.push(pos);
    // Drift left or right randomly, clamped to edges
    const drift = Math.random() < 0.5 ? -1 : 1;
    pos = Math.max(0, Math.min(GRID_WIDTH - 1, pos + drift));
  }

  return path;
}

/**
 * Render a single row string.
 *   |.....o....|
 */
function renderRow(ballPos) {
  const cells = Array(GRID_WIDTH).fill('.');
  cells[ballPos] = 'o';
  return `\`|${cells.join('')}|\``;
}

/**
 * Render the peg numbers footer.
 *   |1234567890|
 */
function renderPegNumbers() {
  const nums = Array.from({ length: GRID_WIDTH }, (_, i) => ((i + 1) % 10).toString());
  return `\`|${nums.join('')}|\``;
}

// ---------------------------------------------------------------------------
// Payout logic
// ---------------------------------------------------------------------------

function getMultiplier(guessedPeg, landedPeg) {
  const dist = Math.abs(guessedPeg - landedPeg);
  if (dist === 0) return 2;
  if (dist === 1) return 1.5;
  if (dist === 2) return 1;
  return 0;
}

// Active games per channel to prevent spam
const activeGames = new Set();

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

function buildPachinkoCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-pachinko')
    .setDescription('Drop a pachinko ball and bet on the landing peg!')
    .addIntegerOption((opt) => opt
      .setName('peg')
      .setDescription('Peg number you think the ball will land on (1–10)')
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(true))
    .addIntegerOption((opt) => opt
      .setName('bet')
      .setDescription('Amount of SGC to wager')
      .setMinValue(1)
      .setRequired(true))
    .toJSON();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handlePachinkoCommand(interaction) {
  const userId   = interaction.user.id;
  const username = interaction.user.username;
  const peg      = interaction.options.getInteger('peg', true);   // 1-indexed
  const bet      = interaction.options.getInteger('bet', true);
  const channelId = interaction.channelId;

  // Prevent multiple concurrent games in the same channel
  if (activeGames.has(channelId)) {
    await interaction.reply({ content: '🎰 A pachinko game is already running in this channel! Wait for it to finish.', ephemeral: true });
    return;
  }

  // Validate balance
  ensureAccount(userId, username);
  const balance = getBalance(userId);
  if (balance < bet) {
    await interaction.reply({ content: `❌ You only have **${balance.toLocaleString()} SGC** but tried to bet **${bet.toLocaleString()}**.`, ephemeral: true });
    return;
  }

  // Place bet (deduct coins)
  const betResult = placePachinkoBet(userId, username, bet);
  if (!betResult.success) {
    await interaction.reply({ content: `❌ ${betResult.error}`, ephemeral: true });
    return;
  }

  activeGames.add(channelId);

  try {
    // Simulate the full path up front
    const path = simulateDrop();
    const landedPos = path[path.length - 1]; // 0-indexed
    const landedPeg = landedPos + 1;          // 1-indexed for display
    const multiplier = getMultiplier(peg, landedPeg);
    const payout = Math.floor(bet * multiplier);

    // Start the animation — single message that gets edited with each new row
    const header = `🎰 **Pachinko!** ${username} bet **${bet.toLocaleString()} SGC** on peg **${peg}**`;
    const rows = [renderRow(path[0])];
    await interaction.reply(`${header}\n${rows.join('\n')}`);

    // Animate rows 1–8 by editing the same message
    for (let row = 1; row < path.length; row++) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(ROW_DELAY);
      rows.push(renderRow(path[row]));
      // eslint-disable-next-line no-await-in-loop
      await interaction.editReply(`${header}\n${rows.join('\n')}`);
    }

    // Peg labels
    await sleep(ROW_DELAY);
    rows.push(renderPegNumbers());
    await interaction.editReply(`${header}\n${rows.join('\n')}`);

    // Payout
    if (payout > 0) {
      payPachinkoPayout(userId, payout);
    }

    // Result message — separate message that tags the user
    await sleep(ROW_DELAY / 2);
    const resultLines = [
      `<@${userId}> — Ball landed on peg **${landedPeg}**!`,
    ];

    if (multiplier === 2) {
      resultLines.push(`🎉 **EXACT HIT!** You win **${payout.toLocaleString()} SGC** (2×)!`);
    } else if (multiplier === 1.5) {
      resultLines.push(`✨ Close! 1 off — you win **${payout.toLocaleString()} SGC** (1.5×).`);
    } else if (multiplier === 1) {
      resultLines.push(`😐 2 off — you get your bet back: **${payout.toLocaleString()} SGC** (1×).`);
    } else {
      resultLines.push(`💀 Too far off — you lose **${bet.toLocaleString()} SGC**. Better luck next time!`);
    }

    await interaction.followUp(resultLines.join('\n'));
    logger.info(`Pachinko: ${username} bet ${bet} on peg ${peg}, landed ${landedPeg}, mult ${multiplier}×, payout ${payout}`);
  } finally {
    activeGames.delete(channelId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function reloadSettings() {
  try {
    GRID_WIDTH = getSetting('pachinko.gridWidth');
    GRID_ROWS = getSetting('pachinko.gridRows');
    ROW_DELAY = getSetting('pachinko.rowDelay');
  } catch { /* DB not ready */ }
}

const { config } = require('./config');
if (config.gameWorkersEnabled && config.gameWorkersPachinko) {
  module.exports = require('./pachinkoAdapter');
} else {
  module.exports = {
    buildPachinkoCommand,
    handlePachinkoCommand,
    reloadSettings,
  };
}
