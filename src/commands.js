const { ChannelType, SlashCommandBuilder } = require('discord.js');

const { config } = require('./config');
const { handleAutonomousMessage } = require('./chatbot');
const { logger } = require('./logger');
const { awardMessageCoins } = require('./sadgirlEconomyStore');
const { evaluateRewardEligibility, buildDebugWarning } = require('./antiFarming');
const { getSmokeBoost } = require('./smokeBoost');
const { buildEconomyCommands, handleBankCommand, handleBetsCommand } = require('./sadgirlEconomyCommands');
const { handleApiLinkCommand } = require('./apiLinkCommands');
const { buildTouhouCommand, handleTouhouCommand } = require('./touhouCommands');
const { handleTouhouMenu, handleTouhouMenuComponent } = require('./touhouMenu');
const { buildCigaretteCommand, handleCigaretteCommand } = require('./cigaretteCommands');
const { buildPachinkoCommand, handlePachinkoCommand } = require('./pachinko');
const { buildBlackjackCommand, handleBlackjackCommand } = require('./blackjack');
const { buildHoldemCommand, handleHoldemCommand } = require('./texasholdem');
const { buildHorseRaceCommand, handleHorseRaceCommand } = require('./horseracing');
const { buildSlotsCommand, handleSlotsCommand } = require('./slots');
const { buildPrivateStockCommand, handlePrivateStockCommand, handleStockButtonInteraction } = require('./privateStockCommands');
const { formatVcTime, getVcLeaderboard, getUserVcTime, activeVoiceUsers } = require('./vcRewards');
const { getRandomQuote, addQuote, getRandomJackHandey } = require('./quotes');
const {
  checkSearchAllowed,
  executeBraveSearch,
  formatSearchResultsForPrompt,
  incrementSearchCount,
} = require('./braveSearch');
const { requestLlmCompletion } = require('./llmClient');

const DISCORD_MAX_CHARS = 2000;
const SERVER_2_MODEL = 'server-2';

function getServer2Endpoint() {
  if (Array.isArray(config.llmEndpoints) && config.llmEndpoints.length > 1 && config.llmEndpoints[1]) {
    return config.llmEndpoints[1];
  }

  if (Array.isArray(config.llmEndpoints) && config.llmEndpoints.length > 0 && config.llmEndpoints[0]) {
    return config.llmEndpoints[0];
  }

  return null;
}

async function generateRewardLimitMessage(message, eligibility) {
  const server2Endpoint = getServer2Endpoint();
  const fallback = buildDebugWarning(eligibility);
  if (!server2Endpoint) {
    return fallback;
  }

  const cooldownSeconds = Math.max(1, Math.ceil(eligibility.cooldownRemainingMs / 1000));
  const systemOverride = [
    'System: A user is being warned that their message rewards are temporarily suppressed for spam-like coin farming behavior.',
    'System: Reply as Lumi in character, sweet but firm, in 2-4 short sentences.',
    'System: Explain that they are being rate limited from earning SadGirlCoin right now because their posts looked spammy or repetitive.',
    'System: Do not mention policy, moderation systems, or internal heuristics.',
    'System: After the warning, include a short plain-text debug block with action, reasons, cooldown_s, similarity, and strikes.',
    'System: Do not use markdown code fences. Do not use speaker labels. Do not use emojis unless they fit Lumi naturally.',
  ].join(' ');

  const latestContent = [
    `Username: ${message.author.username}`,
    `Suppressed message: ${message.content || '[attachment only]'}`,
    `Action: ${eligibility.action}`,
    `Reasons: ${eligibility.reasons.join(', ') || 'unknown'}`,
    `Cooldown seconds: ${cooldownSeconds}`,
    `Similarity score: ${(eligibility.debug?.topSimilarity ?? 0).toFixed(2)}`,
    `Strike count: ${eligibility.debug?.strikes ?? 0}`,
    'Write the warning now.',
  ].join('\n');

  try {
    return await requestLlmCompletion({
      latestContent,
      history: [],
      memoryClues: [],
      deepRecall: false,
      maxResponseChars: 550,
      systemOverride,
      endpointOverride: server2Endpoint,
      modelOverride: SERVER_2_MODEL,
      timeoutMsOverride: 20_000,
    });
  } catch (error) {
    logger.warn('Failed to generate reward limit message via server-2.', error.message);
    return fallback;
  }
}

/**
 * Split a long string into Discord-safe chunks (≤2000 chars),
 * preferring to break at sentence or word boundaries.
 */
function splitMessage(text, maxLen = DISCORD_MAX_CHARS) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    let splitPoint = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
    );
    if (splitPoint < maxLen / 2) {
      splitPoint = window.lastIndexOf(' ');
    }
    if (splitPoint <= 0) {
      splitPoint = maxLen - 1;
    }
    chunks.push(remaining.slice(0, splitPoint + 1).trim());
    remaining = remaining.slice(splitPoint + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function buildGlobalCommands() {
  const cmds = [
    new SlashCommandBuilder()
      .setName('lumi-quote')
      .setDescription('Get a random quote from the database.'),
    new SlashCommandBuilder()
      .setName('lumi-quoteadd')
      .setDescription('Add a new quote to the database.')
      .addStringOption((option) => option
        .setName('text')
        .setDescription('The quote text to add')
        .setRequired(true)),
    new SlashCommandBuilder()
      .setName('lumi-jh')
      .setDescription('Get a random Deep Thought, by Jack Handey.'),
    new SlashCommandBuilder()
      .setName('lumi-man')
      .setDescription('Show the full command list.'),
    new SlashCommandBuilder()
      .setName('lumi-search')
      .setDescription('Ask Lumi to search the web for something.')
      .addStringOption((option) => option
        .setName('query')
        .setDescription('What to search for')
        .setRequired(true)),
  ].map((command) => command.toJSON());

  return [...cmds, buildTouhouCommand(), buildCigaretteCommand(), buildPachinkoCommand(), buildBlackjackCommand(), buildHoldemCommand(), buildHorseRaceCommand(), buildSlotsCommand(), buildVcCommand(), buildPrivateStockCommand()];
}

function buildHelpText() {
  return [
    'Available commands:',
    '`/lumi-quote` - Get a random quote from the database.',
    '`/lumi-quoteadd <text>` - Add a new quote to the database.',
    '`/lumi-jh` - Get a random Deep Thought, by Jack Handey.',
    '`/lumi-search <query>` - Ask Lumi to search the web for something.',
    '`/lumi-man` - Show this help message.',
    '`/lumi-touhou adopt` - Adopt a random Touhou (25 SGC).',
    '`/lumi-touhou collection` - View your Touhou collection.',
    '`/lumi-touhou send <name> <user>` - Gift a Touhou to someone.',
    '`/lumi-touhou trade <yours> <user> <theirs>` - Request a Touhou swap (recipient must approve).',
    '`/lumi-touhou sell <name> <price>` - List a Touhou for sale.',
    '`/lumi-touhou buy <name>` - Buy a listed Touhou.',
    '`/lumi-touhou buy item:Health Potion amount:<n>` - Buy battle potions (20 SGC each).',
    '`/lumi-touhou market` - Browse the Touhou market.',
    '`/lumi-touhou listings [page]` - List all Touhous currently for sale in this server.',
    '`/lumi-touhou info <name>` - View Touhou details.',
    '`/lumi-cigarette gacha` - Pull one random cigarette (1 SGC).',
    '`/lumi-cigarette case` - View your cigarette case.',
    '`/lumi-cigarette leaderboard` - Show top cigarette smokers.',
    '`/lumi-cigarette smoke <slot>` - Smoke a cigarette from your case and get a rarity-based 1.25x–3x message/image/video character value boost for 5 minutes.',
    '`/lumi-cigarette buff` - Check your active smoke boost multiplier and remaining time.',
    '`/lumi-cigarette trade <yours> <user> <theirs|money>` - Request a swap/sale (recipient must approve).',
    '`/lumi-bank balance` - Check your SadGirlCoin balance and top 10.',
    '`/lumi-bank send <user> <amount>` - Send SGC to another member.',
    '`/lumi-bank raffle` - Buy a yearly raffle ticket (50 SGC).',
    '`/lumi-bets list` - Show open LumiBet markets.',
    '`/lumi-bets buy <market> <option> <amount>` - Invest in a market (option name or number).',
    '`/lumi-stocks list` - Show listed Big Business and synthetic stocks.',
    '`/lumi-stocks buy <ticker> <amount>` - Buy stock with SGC.',
    '`/lumi-stocks sell <ticker> <shares>` - Sell stock back into the market.',
    '`/lumi-stocks portfolio` - Show your stock portfolio.',
    '`/lumi-pachinko <peg> <bet>` - Drop a pachinko ball and bet on the landing peg!',
    '`/lumi-blackjack play <bet>` - Join a multiplayer blackjack table!',
    '`/lumi-blackjack leave` - Leave the blackjack table.',
    '`/lumi-blackjack bet <amount>` - Change your bet for the next hand.',
    '`/lumi-holdem play <bet>` - Join a Texas Hold\'em table!',
    '`/lumi-holdem leave` - Leave the Texas Hold\'em table.',
    '`/lumi-holdem bet <amount>` - Change your ante for the next hand.',
    '`/lumi-holdem raise <amount>` - Raise during a hand (custom amount).',
    '`/lumi-horserace start` - Start or join a horse race lobby!',
    '`/lumi-horserace leave` - Leave the horse race lobby.',
    '`/lumi-slots start` - Open or join a slot machine!',
    '`/lumi-slots leave` - Leave the slot machine.',
    '`/lumi-vc rank` - Voice channel time leaderboard.',
    '`/lumi-vc me` - Show your own VC time stats.',
  ].join('\n');
}

async function handleManCommand(interaction) {
  await interaction.reply({ content: buildHelpText(), ephemeral: true });
}

async function handleQuoteCommand(interaction) {
  const quote = getRandomQuote();
  if (!quote) {
    await interaction.reply({ content: 'There are no quotes in the database yet. Use `/quoteadd` to add one!', ephemeral: true });
    return;
  }
  await interaction.reply(`📖 Quote #${quote.number}/${quote.total}:\n> ${quote.text}`);
}

async function handleQuoteAddCommand(interaction) {
  const text = interaction.options.getString('text', true).trim();
  if (!text) {
    await interaction.reply({ content: 'Please provide the quote text. Usage: `/quoteadd <your quote>`', ephemeral: true });
    return;
  }
  const result = addQuote(text);
  await interaction.reply(`✅ Quote #${result.number} added! There are now ${result.total} quote(s) in the database.`);
}

async function handleJackHandeyCommand(interaction) {
  const result = getRandomJackHandey();
  if (!result) {
    await interaction.reply({ content: 'Could not load Jack Handey quotes.', ephemeral: true });
    return;
  }
  await interaction.reply(`${result.quote} \u2014 ${result.attribution}`);
}

async function handleSearchCommand(interaction) {
  const query = interaction.options.getString('query', true).trim();
  if (!query) {
    await interaction.reply({ content: 'Please provide a search query.', ephemeral: true });
    return;
  }

  const userId = interaction.user.id;
  const searchCheck = checkSearchAllowed(userId);

  if (!searchCheck.allowed) {
    // Generate an in-character rate-limit response
    try {
      await interaction.deferReply();
      const systemOverride = searchCheck.reason.startsWith('cooldown')
        ? 'System: The user asked you to search the web but they need to wait before searching again. Let them know gently and in-character. Be sweet but firm.'
        : 'System: The user asked you to search the web, but they\'ve used up their searches for today. Remind them gently and in-character that doll pays for each web search out of pocket, so you can only do a limited number per day. Be sweet but firm about it.';

      const response = await requestLlmCompletion({
        latestContent: query,
        history: [],
        memoryClues: [],
        deepRecall: false,
        maxResponseChars: config.chatbotMaxResponseChars,
        searchResults: null,
        systemOverride,
      });

      const rlChunks = splitMessage(response || 'Sorry, search is unavailable right now.');
      await interaction.editReply(rlChunks[0]);
      for (let i = 1; i < rlChunks.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await interaction.followUp(rlChunks[i]);
      }
    } catch (error) {
      logger.warn('Failed to generate search rate-limit response.', error.message);
      if (interaction.deferred) {
        await interaction.editReply('Search is unavailable right now.').catch(() => {});
      } else {
        await interaction.reply({ content: 'Search is unavailable right now.', ephemeral: true }).catch(() => {});
      }
    }

    return;
  }

  await interaction.deferReply();

  try {
    const results = await executeBraveSearch(query);

    if (results.length === 0) {
      await interaction.editReply('I searched the web but couldn\'t find anything useful for that.');
      return;
    }

    incrementSearchCount(userId);
    const searchResults = formatSearchResultsForPrompt(results);
    logger.info(`Brave Search (slash) executed for user ${userId}: "${query}"`);

    const response = await requestLlmCompletion({
      latestContent: query,
      history: [],
      memoryClues: [],
      deepRecall: false,
      maxResponseChars: config.chatbotMaxResponseChars,
      searchResults,
    });

    const searchChunks = splitMessage(response || "I found some results but couldn't put together a good answer.");
    await interaction.editReply(searchChunks[0]);
    for (let i = 1; i < searchChunks.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await interaction.followUp(searchChunks[i]);
    }
  } catch (error) {
    logger.error('Search command failed.', error.message);
    await interaction.editReply('Something went wrong while searching the web.').catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// /lumi-vc — Voice channel time leaderboard
// ---------------------------------------------------------------------------

function buildVcCommand() {
  return new SlashCommandBuilder()
    .setName('lumi-vc')
    .setDescription('Voice channel time leaderboard — see who hangs out the most.')
    .addSubcommand((sub) => sub
      .setName('rank')
      .setDescription('Show the top 20 VC time leaderboard.'))
    .addSubcommand((sub) => sub
      .setName('me')
      .setDescription('Show your own VC time stats.'))
    .toJSON();
}

async function handleVcCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'me') {
    const userId = interaction.user.id;
    const total = getUserVcTime(userId);
    const inVc = activeVoiceUsers.has(userId);
    const status = inVc ? '🟢 Currently in VC' : '⚫ Not in VC';
    await interaction.reply({
      content: [
        `**Your VC Time** — ${status}`,
        `Total: **${formatVcTime(total)}**`,
      ].join('\n'),
    });
    return;
  }

  // Default: rank / leaderboard
  const lb = getVcLeaderboard(20);
  if (lb.length === 0) {
    await interaction.reply({ content: 'No VC time tracked yet.', ephemeral: true });
    return;
  }

  const lines = lb.map((row, i) => {
    const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const inVc = activeVoiceUsers.has(row.user_id) ? ' 🟢' : '';
    return `${medal} **${row.username || row.user_id}** — ${formatVcTime(row.total_seconds)}${inVc}`;
  });

  const userId = interaction.user.id;
  const userTotal = getUserVcTime(userId);
  const userRank = lb.findIndex((r) => r.user_id === userId);

  lines.push('');
  if (userRank >= 0) {
    lines.push(`Your rank: **#${userRank + 1}** — ${formatVcTime(userTotal)}`);
  } else if (userTotal > 0) {
    lines.push(`Your total: **${formatVcTime(userTotal)}** (not in top 20)`);
  }

  await interaction.reply({
    content: `**🎧 Voice Channel Leaderboard**\n${lines.join('\n')}`,
  });
}

const commandHandlers = new Map([
  ['lumi-quote', handleQuoteCommand],
  ['lumi-quoteadd', handleQuoteAddCommand],
  ['lumi-jh', handleJackHandeyCommand],
  ['lumi-man', handleManCommand],
  ['lumi-search', handleSearchCommand],
  ['lumi-bank', handleBankCommand],
  ['lumi-bets', handleBetsCommand],
  ['lumi-link', handleApiLinkCommand],
  ['lumi-stocks', handlePrivateStockCommand],
  ['lumi-touhou', handleTouhouCommand],
  ['lumi-cigarette', handleCigaretteCommand],
  ['lumi-pachinko', handlePachinkoCommand],
  ['lumi-blackjack', handleBlackjackCommand],
  ['lumi-holdem', handleHoldemCommand],
  ['lumi-horserace', handleHorseRaceCommand],
  ['lumi-slots', handleSlotsCommand],
  ['lumi-vc', handleVcCommand],
]);

async function handleCommandInteraction(interaction) {
  if (await handleTouhouMenuComponent(interaction)) {
    return;
  }
  if (await handleStockButtonInteraction(interaction)) {
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const handler = commandHandlers.get(interaction.commandName);
  if (!handler) {
    return;
  }

  try {
    await handler(interaction);
  } catch (error) {
    logger.error(`Slash command /${interaction.commandName} failed.`, error.message);
    const reply = { content: 'Something went wrong while running that command.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

async function handleMessageCreate(message) {
  if (message.author.bot || !message.inGuild()) {
    return;
  }

  // ── Economy & casino games work in ALL guilds ──

  // Award SadGirlCoin for chatting (1 SGC per 50 characters)
  // Images count as 25 bonus chars (half a coin), videos count as 50 bonus chars (full coin)
  if (config.economyEnabled) {
    try {
      const hasAttachment = message.attachments.size > 0;

      // Anti-farming gate: suppress rewards on low-effort / duplicate / burst posting.
      // Does not block the message itself — the user just doesn't earn coins for it.
      const eligibility = evaluateRewardEligibility({
        userId: message.author.id,
        channelId: message.channelId,
        content: message.content ?? '',
        hasAttachment,
      });

      if (!eligibility.eligible) {
        logger.debug(`Suppressed SGC reward for ${message.author.username}: ${eligibility.reasons.join(',')}`);
        if (eligibility.shouldNotify) {
          const warningMessage = await generateRewardLimitMessage(message, eligibility);
          await message.reply({ content: warningMessage, allowedMentions: { repliedUser: false } })
            .catch(() => {});
        }
      } else {
        let effectiveChars = message.content?.length ?? 0;

        for (const attachment of message.attachments.values()) {
          const ct = attachment.contentType ?? '';
          if (ct.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/iu.test(attachment.url)) {
            effectiveChars += 50;
          } else if (ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/iu.test(attachment.url)) {
            effectiveChars += 25;
          }
        }

        const smokeBoost = getSmokeBoost(message.author.id);
        if (smokeBoost.active) {
          effectiveChars = Math.floor(effectiveChars * smokeBoost.multiplier);
        }

        if (effectiveChars > 0) {
          const coins = awardMessageCoins(message.author.id, message.author.username, effectiveChars);
          if (coins > 0) {
            logger.debug(`Awarded ${coins} SGC to ${message.author.username} (${effectiveChars} effective chars${smokeBoost.active ? ', smoke boost active' : ''}).`);
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to award message coins.', error.message);
    }
  }

  // ── ! prefix shortcuts for casino games ──
  if (message.content.startsWith('!')) {
    const handled = await handlePrefixCommand(message);
    if (handled) return;
  }

  // ── Autonomous chatbot: home guild only ──
  if (config.allowedGuildId && message.guildId !== config.allowedGuildId) {
    return;
  }

  await handleAutonomousMessage(message);
}

// ---------------------------------------------------------------------------
// ! prefix command adapter — wraps a Message into a fake interaction
// ---------------------------------------------------------------------------

/**
 * Build a minimal object that mimics a Discord ChatInputCommandInteraction
 * just enough for the game handlers to work (reply, editReply, fetchReply,
 * followUp, options, user, channel, channelId, client).
 */
function fakeInteraction(message, optionsData = {}) {
  let replyMsg = null;

  const interaction = {
    user: message.author,
    member: message.member,
    channelId: message.channelId,
    channel: message.channel,
    client: message.client,
    guildId: message.guildId,

    options: {
      getSubcommand() { return optionsData._subcommand ?? null; },
      getInteger(name) { return optionsData[name] ?? null; },
      getNumber(name) { return optionsData[name] ?? null; },
      getString(name) { return optionsData[name] ?? null; },
      getUser(name) { return optionsData[name] ?? null; },
      getBoolean(name) { return optionsData[name] ?? null; },
    },

    async reply(content) {
      const payload = typeof content === 'string' ? { content } : content;
      const sendable = {
        content: payload.content,
        components: payload.components,
        files: payload.files,
        embeds: payload.embeds,
      };
      // Ephemeral messages → send as a normal reply that auto-deletes after 8s
      if (payload.ephemeral) {
        const m = await message.reply(sendable);
        setTimeout(() => m.delete().catch(() => {}), 8000);
        replyMsg = m;
        return m;
      }
      replyMsg = await message.channel.send(sendable);
      return replyMsg;
    },

    async editReply(content) {
      if (!replyMsg) return;
      const payload = typeof content === 'string' ? { content } : content;
      return replyMsg.edit(payload);
    },

    async fetchReply() {
      return replyMsg;
    },

    async followUp(content) {
      const payload = typeof content === 'string' ? { content } : content;
      return message.channel.send(payload);
    },

    async deferReply() { /* no-op for prefix */ },
  };

  return interaction;
}

async function handlePrefixCommand(message) {
  const text = message.content.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  // ── !pachinko <peg> <bet> ──
  if (cmd === '!pachinko') {
    const peg = parseInt(parts[1], 10);
    const bet = parseInt(parts[2], 10);
    if (!peg || !bet || peg < 1 || peg > 10 || bet < 1) {
      await message.reply('Usage: `!pachinko <peg 1-10> <bet>`');
      return true;
    }
    const fake = fakeInteraction(message, { peg, bet });
    await handlePachinkoCommand(fake);
    return true;
  }

  // ── !blackjack [bet] / !blackjack leave / !blackjack bet <amount> ──
  if (cmd === '!blackjack' || cmd === '!bj') {
    const sub = (parts[1] ?? '').toLowerCase();
    if (sub === 'leave') {
      const fake = fakeInteraction(message, { _subcommand: 'leave' });
      await handleBlackjackCommand(fake);
    } else if (sub === 'bet') {
      const amount = parseInt(parts[2], 10);
      if (!amount || amount < 1) {
        await message.reply('Usage: `!blackjack bet <amount>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'bet', amount });
      await handleBlackjackCommand(fake);
    } else {
      const bet = parseInt(sub, 10) || parseInt(parts[1], 10);
      if (!bet || bet < 1) {
        await message.reply('Usage: `!blackjack <bet>` | `!blackjack leave` | `!blackjack bet <amount>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'play', bet });
      await handleBlackjackCommand(fake);
    }
    return true;
  }

  // ── !holdem [bet] / !holdem leave / !holdem bet <amount> ──
  if (cmd === '!holdem' || cmd === '!th') {
    const sub = (parts[1] ?? '').toLowerCase();
    if (sub === 'leave') {
      const fake = fakeInteraction(message, { _subcommand: 'leave' });
      await handleHoldemCommand(fake);
    } else if (sub === 'bet') {
      const amount = parseInt(parts[2], 10);
      if (!amount || amount < 1) {
        await message.reply('Usage: `!holdem bet <amount>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'bet', amount });
      await handleHoldemCommand(fake);
    } else if (sub === 'raise') {
      const amount = parseInt(parts[2], 10);
      if (!amount || amount < 1) {
        await message.reply('Usage: `!holdem raise <amount>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'raise', amount });
      await handleHoldemCommand(fake);
    } else {
      const bet = parseInt(sub, 10) || parseInt(parts[1], 10);
      if (!bet || bet < 1) {
        await message.reply('Usage: `!holdem <bet>` | `!holdem leave` | `!holdem bet <amount>` | `!holdem raise <amount>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'play', bet });
      await handleHoldemCommand(fake);
    }
    return true;
  }

  // ── !horseracing / !hr ──
  if (cmd === '!horseracing' || cmd === '!hr') {
    const sub = (parts[1] ?? '').toLowerCase();
    if (sub === 'leave') {
      const fake = fakeInteraction(message, { _subcommand: 'leave' });
      await handleHorseRaceCommand(fake);
    } else {
      const fake = fakeInteraction(message, { _subcommand: 'start' });
      await handleHorseRaceCommand(fake);
    }
    return true;
  }

  // ── !slots ──
  if (cmd === '!slots') {
    const sub = (parts[1] ?? '').toLowerCase();
    if (sub === 'leave') {
      const fake = fakeInteraction(message, { _subcommand: 'leave' });
      await handleSlotsCommand(fake);
    } else {
      const fake = fakeInteraction(message, { _subcommand: 'start' });
      await handleSlotsCommand(fake);
    }
    return true;
  }

  // ── !vc [rank|me] ──
  if (cmd === '!vc') {
    const sub = (parts[1] ?? 'rank').toLowerCase();
    if (sub === 'me') {
      const fake = fakeInteraction(message, { _subcommand: 'me' });
      await handleVcCommand(fake);
    } else {
      const fake = fakeInteraction(message, { _subcommand: 'rank' });
      await handleVcCommand(fake);
    }
    return true;
  }

  // ── !bank [balance|send|raffle] ──
  if (cmd === '!bank') {
    const sub = (parts[1] ?? 'balance').toLowerCase();
    if (sub === 'send') {
      const mentioned = message.mentions.users.first();
      const amount = parseInt(parts[3], 10) || parseInt(parts[2], 10);
      if (!mentioned || !amount || amount < 1) {
        await message.reply('Usage: `!bank send @user <amount>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'send', user: mentioned, amount, note: '' });
      await handleBankCommand(fake);
    } else if (sub === 'raffle') {
      const fake = fakeInteraction(message, { _subcommand: 'raffle' });
      await handleBankCommand(fake);
    } else {
      const fake = fakeInteraction(message, { _subcommand: 'balance' });
      await handleBankCommand(fake);
    }
    return true;
  }

  // ── !bets [list|buy] ──
  if (cmd === '!bets') {
    const sub = (parts[1] ?? 'list').toLowerCase();
    if (sub === 'buy') {
      const market = parseInt(parts[2], 10);
      const side = (parts[3] ?? '').toLowerCase();
      const amount = parseInt(parts[4], 10);
      if (!market || !side || !amount || amount < 1) {
        await message.reply('Usage: `!bets buy <market_id> <option> <amount>` (option = name or number)');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'buy', market, side, amount });
      await handleBetsCommand(fake);
    } else {
      const fake = fakeInteraction(message, { _subcommand: 'list' });
      await handleBetsCommand(fake);
    }
    return true;
  }

  // ── !stocks / !invest / !shares / !portfolio ──
  if (cmd === '!stocks' || cmd === '!invest' || cmd === '!shares' || cmd === '!portfolio') {
    const sub = cmd === '!portfolio' ? 'portfolio' : (parts[1] ?? 'list').toLowerCase();

    if (sub === 'buy') {
      const ticker = parts[2] ?? '';
      const amount = parseInt(parts[3], 10);
      if (!ticker || !amount || amount < 1) {
        await message.reply('Usage: `!invest buy <ticker> <amount>`');
        return true;
      }
      await handlePrivateStockCommand(fakeInteraction(message, { _subcommand: 'buy', ticker, amount }));
    } else if (sub === 'sell') {
      const ticker = parts[2] ?? '';
      const shares = parseFloat(parts[3]);
      if (!ticker || !shares || shares <= 0) {
        await message.reply('Usage: `!invest sell <ticker> <shares>`');
        return true;
      }
      await handlePrivateStockCommand(fakeInteraction(message, { _subcommand: 'sell', ticker, shares }));
    } else if (sub === 'info') {
      const ticker = parts[2] ?? '';
      if (!ticker) {
        await message.reply('Usage: `!invest info <ticker>`');
        return true;
      }
      await handlePrivateStockCommand(fakeInteraction(message, { _subcommand: 'info', ticker }));
    } else if (sub === 'offer') {
      const ticker = parts[2] ?? '';
      if (!ticker) {
        await message.reply('Usage: `!invest offer <ticker>`');
        return true;
      }
      await handlePrivateStockCommand(fakeInteraction(message, { _subcommand: 'offer', ticker }));
    } else if (sub === 'portfolio') {
      await handlePrivateStockCommand(fakeInteraction(message, { _subcommand: 'portfolio' }));
    } else {
      await handlePrivateStockCommand(fakeInteraction(message, { _subcommand: 'list' }));
    }
    return true;
  }

  // ── !touhou / !2hu + top-level aliases ──
  // Bare !lumi-touhou → interactive menu
  if (cmd === '!lumi-touhou' && !parts[1]) {
    await handleTouhouMenu(fakeInteraction(message, {}));
    return true;
  }

  if (cmd === '!collection' || cmd === '!adopt' || cmd === '!battle') {
    if (cmd === '!collection') {
      const mentioned = message.mentions.users.first();
      await handleTouhouCommand(fakeInteraction(message, { _subcommand: 'collection', user: mentioned || null }));
      return true;
    }
    if (cmd === '!adopt') {
      await handleTouhouCommand(fakeInteraction(message, { _subcommand: 'adopt' }));
      return true;
    }
    if (cmd === '!battle') {
      const rest = parts.slice(1);
      if (rest.length < 2) {
        await message.reply('Usage: `!battle <name> <Common|Uncommon|Rare|Epic|Legendary|gamble>`');
        return true;
      }
      const last = rest[rest.length - 1].toLowerCase();
      const validRarities = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', gamble: 'gamble' };
      const rarity = validRarities[last];
      if (!rarity) {
        await message.reply('Last arg must be one of: Common, Uncommon, Rare, Epic, Legendary, gamble.');
        return true;
      }
      const name = rest.slice(0, -1).join(' ');
      if (!name) {
        await message.reply('Usage: `!battle <name> <rarity|gamble>`');
        return true;
      }
      await handleTouhouCommand(fakeInteraction(message, { _subcommand: 'battle', name, rarity }));
      return true;
    }
  }

  if (cmd === '!touhou' || cmd === '!2hu') {
    // Bare !touhou / !2hu with no subcommand → open interactive menu
    if (!parts[1]) {
      await handleTouhouMenu(fakeInteraction(message, {}));
      return true;
    }

    const sub = parts[1].toLowerCase();

    if (sub === 'adopt') {
      const fake = fakeInteraction(message, { _subcommand: 'adopt' });
      await handleTouhouCommand(fake);
    } else if (sub === 'send') {
      const mentioned = message.mentions.users.first();
      if (!mentioned) {
        await message.reply('Usage: `!touhou send <name> @user`');
        return true;
      }
      // Everything between "send" and the mention is the touhou name
      const mentionIndex = text.indexOf('<@');
      const name = text.slice(text.indexOf(sub) + sub.length, mentionIndex).trim();
      if (!name) {
        await message.reply('Usage: `!touhou send <name> @user`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'send', name, user: mentioned });
      await handleTouhouCommand(fake);
    } else if (sub === 'trade') {
      const mentioned = message.mentions.users.first();
      if (!mentioned) {
        await message.reply('Usage: `!touhou trade <yours> @user <theirs>`');
        return true;
      }
      const mentionIndex = text.indexOf('<@');
      const mentionEnd = text.indexOf('>', mentionIndex) + 1;
      const yours = text.slice(text.indexOf(sub) + sub.length, mentionIndex).trim();
      const theirs = text.slice(mentionEnd).trim();
      if (!yours || !theirs) {
        await message.reply('Usage: `!touhou trade <yours> @user <theirs>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'trade', yours, user: mentioned, theirs });
      await handleTouhouCommand(fake);
    } else if (sub === 'sell') {
      const lastSpaceIdx = text.lastIndexOf(' ');
      const price = parseInt(text.slice(lastSpaceIdx + 1), 10);
      const name = text.slice(text.indexOf(sub) + sub.length, lastSpaceIdx).trim();
      if (!name || !price || price < 1) {
        await message.reply('Usage: `!touhou sell <name> <price>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'sell', name, price });
      await handleTouhouCommand(fake);
    } else if (sub === 'delist') {
      const name = parts.slice(2).join(' ');
      if (!name) {
        await message.reply('Usage: `!touhou delist <name>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'delist', name });
      await handleTouhouCommand(fake);
    } else if (sub === 'buy') {
      const rest = parts.slice(2);
      if (rest.length === 0) {
        await message.reply('Usage: `!touhou buy <name>` or `!touhou buy potion [amount]`');
        return true;
      }

      if (rest[0].toLowerCase() === 'potion') {
        const amount = rest[1] ? parseInt(rest[1], 10) : 1;
        if (!Number.isInteger(amount) || amount < 1) {
          await message.reply('Usage: `!touhou buy potion [amount]`');
          return true;
        }
        const fake = fakeInteraction(message, { _subcommand: 'buy', item: 'potion', amount });
        await handleTouhouCommand(fake);
        return true;
      }

      const name = rest.join(' ');
      const fake = fakeInteraction(message, { _subcommand: 'buy', name });
      await handleTouhouCommand(fake);
    } else if (sub === 'market') {
      const fake = fakeInteraction(message, { _subcommand: 'market' });
      await handleTouhouCommand(fake);
    } else if (sub === 'listings') {
      const rawPage = parts[2] ? parseInt(parts[2], 10) : 1;
      const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
      const fake = fakeInteraction(message, { _subcommand: 'listings', page });
      await handleTouhouCommand(fake);
    } else if (sub === 'info') {
      const name = parts.slice(2).join(' ');
      if (!name) {
        await message.reply('Usage: `!touhou info <name>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'info', name });
      await handleTouhouCommand(fake);
    } else if (sub === 'search') {
      const query = parts.slice(2).join(' ');
      if (!query) {
        await message.reply('Usage: `!touhou search <query>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'search', query });
      await handleTouhouCommand(fake);
    } else if (sub === 'stats') {
      const fake = fakeInteraction(message, { _subcommand: 'stats' });
      await handleTouhouCommand(fake);
    } else if (sub === 'buyback') {
      const name = parts.slice(2).join(' ');
      if (!name) {
        await message.reply('Usage: `!touhou buyback <name>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'buyback', name });
      await handleTouhouCommand(fake);
    } else if (sub === 'battle') {
      // !touhou battle <name...> <rarity-or-gamble>
      const rest = parts.slice(2);
      if (rest.length < 2) {
        await message.reply('Usage: `!touhou battle <name> <Common|Uncommon|Rare|Epic|Legendary|gamble>`');
        return true;
      }
      const last = rest[rest.length - 1].toLowerCase();
      const validRarities = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', gamble: 'gamble' };
      const rarity = validRarities[last];
      if (!rarity) {
        await message.reply('Last arg must be one of: Common, Uncommon, Rare, Epic, Legendary, gamble.');
        return true;
      }
      const name = rest.slice(0, -1).join(' ');
      if (!name) {
        await message.reply('Usage: `!touhou battle <name> <rarity|gamble>`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'battle', name, rarity });
      await handleTouhouCommand(fake);
    } else if (sub === 'heal') {
      // !touhou heal <name...> [pay]
      const rest = parts.slice(2);
      let pay = false;
      let nameParts = rest;
      if (rest.length > 0 && rest[rest.length - 1].toLowerCase() === 'pay') {
        pay = true;
        nameParts = rest.slice(0, -1);
      }
      const name = nameParts.join(' ');
      if (!name) {
        await message.reply('Usage: `!touhou heal <name> [pay]`');
        return true;
      }
      const fake = fakeInteraction(message, { _subcommand: 'heal', name, pay });
      await handleTouhouCommand(fake);
    } else if (sub === 'party') {
      const fake = fakeInteraction(message, { _subcommand: 'party' });
      await handleTouhouCommand(fake);
    } else {
      // Default: show own collection, or if user typed a name, show that user's collection
      // Unknown subcommand → fall back to collection
      const mentioned = message.mentions.users.first();
      const fake = fakeInteraction(message, { _subcommand: 'collection', user: mentioned || null });
      await handleTouhouCommand(fake);
    }
    return true;
  }

  // ── !cigarette / !cigs / !cig ──
  if (cmd === '!smokebuff' || cmd === '!sb') {
    const boost = getSmokeBoost(message.author.id);
    if (!boost.active) {
      await message.reply('🚬 You have no active smoke boost. Use `!smoke <slot>` to activate one.');
      return true;
    }

    const totalSeconds = Math.max(0, Math.ceil(boost.remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timeLeft = `${minutes}m ${String(seconds).padStart(2, '0')}s`;

    await message.reply(
      `🚬 **Smoke Boost Active** — **${boost.multiplier}x** character value` +
      `${boost.rarityTier ? ` (${boost.rarityTier})` : ''}\n` +
      `⏳ Time remaining: **${timeLeft}**`
    );
    return true;
  }

  if (cmd === '!smoke') {
    const slotStr = parts[1]?.trim();
    const slot = parseInt(slotStr, 10);
    if (!slotStr || isNaN(slot) || slot < 1) {
      await message.reply('Usage: `!smoke <slot number>` (use `!cigarette case` to see slot numbers)');
      return true;
    }
    await handleCigaretteCommand(fakeInteraction(message, { _subcommand: 'smoke', slot }));
    return true;
  }

  if (cmd === '!cigarette' || cmd === '!cigs' || cmd === '!cig') {
    const sub = (parts[1] ?? 'case').toLowerCase();

    if (sub === 'gacha' || sub === 'pull' || sub === 'dispense') {
      await handleCigaretteCommand(fakeInteraction(message, { _subcommand: 'gacha' }));
    } else if (sub === 'leaderboard' || sub === 'top' || sub === 'lb') {
      await handleCigaretteCommand(fakeInteraction(message, { _subcommand: 'leaderboard' }));
    } else if (sub === 'smoke') {
      const slotStr = parts[2]?.trim();
      const slot = parseInt(slotStr, 10);
      if (!slotStr || isNaN(slot) || slot < 1) {
        await message.reply('Usage: `!cigarette smoke <slot number>` (use `!cigarette case` to see slot numbers)');
        return true;
      }
      await handleCigaretteCommand(fakeInteraction(message, { _subcommand: 'smoke', slot }));
    } else if (sub === 'trade') {
      const mentioned = message.mentions.users.first();
      if (!mentioned) {
        await message.reply('Usage: `!cigarette trade <yours> @user <theirs>` OR `!cigarette trade <yours> @user <money>`');
        return true;
      }
      const mentionIndex = text.indexOf('<@');
      const mentionEnd = text.indexOf('>', mentionIndex) + 1;
      const yours = text.slice(text.indexOf(sub) + sub.length, mentionIndex).trim();
      const target = text.slice(mentionEnd).trim();
      if (!yours || !target) {
        await message.reply('Usage: `!cigarette trade <yours> @user <theirs>` OR `!cigarette trade <yours> @user <money>`');
        return true;
      }
      const moneyMatch = target.match(/^\$?(\d+)$/u);
      const money = moneyMatch ? Number.parseInt(moneyMatch[1], 10) : null;
      await handleCigaretteCommand(fakeInteraction(message, {
        _subcommand: 'trade',
        yours,
        user: mentioned,
        theirs: money ? null : target,
        money,
      }));
    } else {
      const mentioned = message.mentions.users.first();
      await handleCigaretteCommand(fakeInteraction(message, { _subcommand: 'case', user: mentioned || null }));
    }
    return true;
  }

  return false; // not a recognized prefix command
}

module.exports = {
  buildGlobalCommands,
  handleCommandInteraction,
  handleMessageCreate,
};
