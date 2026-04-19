/**
 * SadGirlCoin Economy Scheduler — recurring timer-loop tasks.
 *
 * - Twice-daily leaderboard post (top 50 by balance) in a configured channel
 * - Weekly free lottery (random holder gets 50 SGC)
 * - Yearly raffle draw (paid tickets, winner gets 25% of central reserve)
 * - Lotto-day flag management (50% transfer fee on draw day)
 */

const { logger } = require('./logger');
const {
  getTopHolders,
  runWeeklyLottery,
  runYearlyRaffle,
  setLottoDay,
  getSystemState,
  setSystemState,
  getCentralBankBalance,
  getDollStreetBalance,
  collectMonthlyTaxes,
  casinoDailyReserveDeposit,
} = require('./sadgirlEconomyStore');
const { getSetting } = require('./panelSettings');

let LEADERBOARD_CHANNEL_ID = '1494913175886233600';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let leaderboardTimer = null;
let lotteryTimer = null;
let stopped = false;
let discordClient = null;

// ---------------------------------------------------------------------------
// Leaderboard posting
// ---------------------------------------------------------------------------

function formatLeaderboard(holders, title = 'SadGirlCoin Leaderboard') {
  if (holders.length === 0) return `**${title}**\nNo holders yet.`;

  const medals = ['🥇', '🥈', '🥉'];
  const lines = holders.map((h, i) => {
    const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
    const name = h.username || h.user_id;
    return `${prefix} ${name} — **${h.balance.toLocaleString()}** SGC`;
  });

  return `**${title}**\n${lines.join('\n')}`;
}

async function postLeaderboard() {
  if (!discordClient) return;

  try {
    const channel = await discordClient.channels.fetch(LEADERBOARD_CHANNEL_ID).catch(() => null);
    if (!channel) {
      logger.warn(`Economy scheduler: leaderboard channel ${LEADERBOARD_CHANNEL_ID} not found.`);
      return;
    }

    const holders = getTopHolders(50);
    const bankBalance = getCentralBankBalance();
    const dollStreetBalance = getDollStreetBalance();
    const text = formatLeaderboard(holders, '💰 SadGirlCoin Top 50 Leaderboard');
    const footer = `\n\n🏦 Central Bank Reserve: **${bankBalance.toLocaleString()}** SGC\n📈 Doll Street (LumiStocks): **${dollStreetBalance.toLocaleString()}** SGC`;

    await channel.send(text + footer);
    logger.info('Economy scheduler: posted leaderboard.');
  } catch (error) {
    logger.error('Economy scheduler: failed to post leaderboard.', error.message);
  }
}

// ---------------------------------------------------------------------------
// Weekly lottery
// ---------------------------------------------------------------------------

async function checkWeeklyLottery() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sunday
  const lastRun = getSystemState('last_weekly_lottery');
  const thisWeek = `${now.getUTCFullYear()}-W${getISOWeek(now)}`;

  if (dayOfWeek !== 0 || lastRun === thisWeek) return; // Run on Sunday

  const winner = runWeeklyLottery();
  setSystemState('last_weekly_lottery', thisWeek);

  if (winner && discordClient) {
    try {
      const channel = await discordClient.channels.fetch(LEADERBOARD_CHANNEL_ID).catch(() => null);
      if (channel) {
        await channel.send(
          `🎰 **Weekly Lottery!**\n<@${winner.userId}> just won **${winner.prize} SGC**! Congrats!`
        );
      }
    } catch (error) {
      logger.error('Economy scheduler: failed to announce weekly lottery.', error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Monthly tax collection
// ---------------------------------------------------------------------------

async function checkMonthlyTaxes() {
  const now = new Date();
  const day = now.getUTCDate();
  const lastRun = getSystemState('last_monthly_tax');
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  // Run on the 1st of each month (collecting for the prior month)
  if (day !== 1 || lastRun === thisMonth) return;

  const result = collectMonthlyTaxes();
  setSystemState('last_monthly_tax', thisMonth);

  logger.info(`Economy scheduler: monthly taxes collected — ${result.totalTaxed} SGC from ${result.userCount} users.`);

  if (discordClient && result.totalTaxed > 0) {
    try {
      const channel = await discordClient.channels.fetch(LEADERBOARD_CHANNEL_ID).catch(() => null);
      if (channel) {
        const topTaxed = result.details
          .sort((a, b) => b.tax - a.tax)
          .slice(0, 10)
          .map((d, i) => `**${i + 1}.** ${d.username || d.userId} — **${d.tax.toLocaleString()}** SGC (${d.tierLabel})`)
          .join('\n');

        await channel.send(
          `🏛️ **Monthly Tax Collection**\n\nCollected **${result.totalTaxed.toLocaleString()} SGC** from **${result.userCount}** account${result.userCount === 1 ? '' : 's'} into the Central Bank.\n\n**Top 10 Taxpayers:**\n${topTaxed}`
        );
      }
    } catch (error) {
      logger.error('Economy scheduler: failed to announce monthly taxes.', error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Daily casino reserve deposit
// ---------------------------------------------------------------------------

async function checkDailyCasinoDeposit() {
  const now = new Date();
  const lastRun = getSystemState('last_casino_reserve_deposit');
  const today = now.toISOString().slice(0, 10);

  if (lastRun === today) return;

  const result = casinoDailyReserveDeposit();
  setSystemState('last_casino_reserve_deposit', today);

  if (result) {
    logger.info(`Economy scheduler: casino deposited ${result.deposited} SGC to central reserve.`);

    if (discordClient) {
      try {
        const channel = await discordClient.channels.fetch(LEADERBOARD_CHANNEL_ID).catch(() => null);
        if (channel) {
          await channel.send(
            `🎰➡️🏦 **Casino Reserve Deposit**\nMomiji Casino deposited **${result.deposited.toLocaleString()} SGC** into the Central Bank reserve.`
          );
        }
      } catch (error) {
        logger.error('Economy scheduler: failed to announce casino deposit.', error.message);
      }
    }
  } else {
    logger.debug('Economy scheduler: casino reserve deposit skipped (balance ≤ 1M).');
  }
}

// ---------------------------------------------------------------------------
// Yearly raffle
// ---------------------------------------------------------------------------

async function checkYearlyRaffle() {
  const now = new Date();
  const month = now.getUTCMonth(); // 0-indexed
  const day = now.getUTCDate();
  const lastRun = getSystemState('last_yearly_raffle');
  const thisYear = String(now.getUTCFullYear());

  // Run on Dec 31
  if (month !== 11 || day !== 31 || lastRun === thisYear) return;

  // Set lotto day flag for 50% transfer fee on raffle day
  const today = now.toISOString().slice(0, 10);
  setLottoDay(today);

  const result = runYearlyRaffle();
  setSystemState('last_yearly_raffle', thisYear);

  if (result && discordClient) {
    try {
      const channel = await discordClient.channels.fetch(LEADERBOARD_CHANNEL_ID).catch(() => null);
      if (channel) {
        await channel.send(
          `🎆 **Yearly Raffle Draw!**\n<@${result.userId}> won **${result.prize.toLocaleString()} SGC** from the Central Bank reserve!\n(${result.totalEntries} total ticket(s) in the draw)\n\n⚠️ _Today is Raffle Day — all transfers have a 50% fee!_`
        );
      }
    } catch (error) {
      logger.error('Economy scheduler: failed to announce yearly raffle.', error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Timer loops
// ---------------------------------------------------------------------------

function msUntilNextHalfDay() {
  const now = new Date();
  const hours = now.getUTCHours();
  // Post at 00:00 and 12:00 UTC
  let nextHour = hours < 12 ? 12 : 24;
  const target = new Date(now);
  target.setUTCHours(nextHour % 24, 0, 0, 0);
  if (nextHour === 24) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
}

function scheduleLeaderboard() {
  if (stopped) return;

  const delay = msUntilNextHalfDay();
  logger.info(`Economy scheduler: next leaderboard post in ${Math.round(delay / 60000)}m.`);

  leaderboardTimer = setTimeout(async () => {
    await postLeaderboard();
    scheduleLeaderboard();
  }, delay);
  leaderboardTimer.unref?.();
}

function scheduleLotteryChecks() {
  if (stopped) return;

  lotteryTimer = setTimeout(async () => {
    await checkWeeklyLottery();
    await checkYearlyRaffle();
    await checkMonthlyTaxes();
    await checkDailyCasinoDeposit();
    scheduleLotteryChecks();
  }, ONE_HOUR_MS);
  lotteryTimer.unref?.();
}

// ---------------------------------------------------------------------------
// ISO week helper
// ---------------------------------------------------------------------------

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function startEconomyScheduler(client) {
  discordClient = client;
  stopped = false;
  scheduleLeaderboard();
  scheduleLotteryChecks();
  logger.info('SadGirlCoin economy scheduler started.');
}

function stopEconomyScheduler() {
  stopped = true;
  if (leaderboardTimer) { clearTimeout(leaderboardTimer); leaderboardTimer = null; }
  if (lotteryTimer) { clearTimeout(lotteryTimer); lotteryTimer = null; }
  discordClient = null;
  logger.info('SadGirlCoin economy scheduler stopped.');
}

function reloadSettings() {
  try {
    LEADERBOARD_CHANNEL_ID = getSetting('scheduler.leaderboardChannelId');
  } catch { /* DB not ready */ }
}

module.exports = {
  startEconomyScheduler,
  stopEconomyScheduler,
  postLeaderboard,
  formatLeaderboard,
  reloadSettings,
};
