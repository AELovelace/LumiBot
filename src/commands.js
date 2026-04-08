const { ChannelType, SlashCommandBuilder } = require('discord.js');

const { config, parsePlayInput } = require('./config');
const { handleAutonomousMessage } = require('./chatbot');
const { logger } = require('./logger');
const { getRandomQuote, addQuote, getRandomJackHandey } = require('./quotes');
const { enqueue, getQueue, getQueueLength } = require('./queue');
const { resolveTitle } = require('./stream');
const { getActiveSessionSummary, playForMember, skipCurrentTrack, stopActiveSession } = require('./voice');
const {
  checkSearchAllowed,
  executeBraveSearch,
  formatSearchResultsForPrompt,
  incrementSearchCount,
} = require('./braveSearch');
const { requestLlmCompletion } = require('./llmClient');

const DISCORD_MAX_CHARS = 2000;

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

function buildPlayerCommands() {
  return [
    new SlashCommandBuilder()
      .setName('lumi-play')
      .setDescription('Play a YouTube/SoundCloud URL, search query, or HTTP stream URL.')
      .addStringOption((option) => option
        .setName('input')
        .setDescription('YouTube/SoundCloud URL, search terms, or stream URL')
        .setRequired(false)),
    new SlashCommandBuilder()
      .setName('lumi-stop')
      .setDescription('Stop playback and leave the voice channel.'),
    new SlashCommandBuilder()
      .setName('lumi-skip')
      .setDescription('Skip the current track and play the next queued one.'),
    new SlashCommandBuilder()
      .setName('lumi-queue')
      .setDescription('Show the current track queue.'),
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
}

function buildHelpText() {
  return [
    'Available commands:',
    '`/lumi-play [input]` - Play a YouTube/SoundCloud URL, search query, or HTTP stream URL.',
    '`/lumi-stop` - Stop playback and leave voice.',
    '`/lumi-skip` - Skip the current track and play the next queued one.',
    '`/lumi-queue` - Show the current track queue.',
    '`/lumi-quote` - Get a random quote from the database.',
    '`/lumi-quoteadd <text>` - Add a new quote to the database.',
    '`/lumi-jh` - Get a random Deep Thought, by Jack Handey.',
    '`/lumi-search <query>` - Ask Lumi to search the web for something.',
    '`/lumi-man` - Show this help message.',
  ].join('\n');
}

async function handlePlayCommand(interaction) {
  const rawInput = (interaction.options.getString('input', false) ?? '').trim();

  // Resolve the typed input (YouTube URL, SoundCloud URL, search query, or HTTP stream)
  let playInput = rawInput ? parsePlayInput(rawInput) : null;

  // Fall back to the default HTTP stream URL if no input was given
  if (!playInput && config.defaultStreamUrl) {
    playInput = { type: 'http', url: config.defaultStreamUrl };
  }

  if (!playInput) {
    await interaction.reply({
      content: 'No input provided and `DEFAULT_STREAM_URL` is not configured.\nUsage: `/play <YouTube URL | SoundCloud URL | search terms | stream URL>`',
      ephemeral: true,
    });
    return;
  }

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({ content: 'Join a guild voice channel first, then try again.', ephemeral: true });
    return;
  }

  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    await interaction.reply({ content: 'Stage channels are not supported in this first version.', ephemeral: true });
    return;
  }

  if (!voiceChannel.joinable) {
    await interaction.reply({ content: 'I do not have permission to join that voice channel.', ephemeral: true });
    return;
  }

  if (!voiceChannel.speakable) {
    await interaction.reply({ content: 'I can join that voice channel, but I do not have permission to speak.', ephemeral: true });
    return;
  }

  // Title resolution and playback can take time — acknowledge the interaction immediately.
  await interaction.deferReply();

  // Resolve a human-readable title for queue display.
  // For HTTP streams this is a fast no-op fallback; for YouTube/SoundCloud/search
  // it calls yt-dlp --print title (a few seconds network round-trip).
  let title = playInput.url ?? playInput.query ?? 'Unknown';
  if (playInput.type !== 'http') {
    const ytInput =
      playInput.type === 'search' ? `ytsearch1:${playInput.query}` : playInput.url;
    title = await resolveTitle(ytInput);
  }

  const track = {
    type: playInput.type,
    url: playInput.url ?? null,
    query: playInput.query ?? null,
    title,
    requestedBy: interaction.user.tag,
  };

  // If something is already playing, add to queue instead of interrupting.
  const activeSession = getActiveSessionSummary(interaction.guildId);
  if (activeSession) {
    const position = enqueue(interaction.guildId, track);

    const isDefaultStreamActive = Boolean(
      config.defaultStreamUrl
        && activeSession.track
        && activeSession.track.type === 'http'
        && activeSession.track.url === config.defaultStreamUrl,
    );

    const isRequestForDefaultStream = Boolean(
      config.defaultStreamUrl
        && track.type === 'http'
        && track.url === config.defaultStreamUrl,
    );

    if (isDefaultStreamActive && !isRequestForDefaultStream && position === 1) {
      await skipCurrentTrack(interaction.guildId);
      await interaction.editReply(`Added **${title}** to the queue and starting it now. The default stream will resume when the queue is empty.`);
      return;
    }

    await interaction.editReply(`Added **${title}** to the queue (position ${position}).`);
    return;
  }

  try {
    await playForMember({
      member: interaction.member,
      textChannel: interaction.channel,
      track,
    });

    await interaction.editReply(
      `Now playing **${title}** in **${voiceChannel.name}**. Use \`/lumi-stop\` to disconnect.`,
    );
  } catch (error) {
    logger.error('Play command failed.', error.message);
    await interaction.editReply(`Could not start playback: ${error.message}`);
  }
}

async function handleStopCommand(interaction) {
  const activeSession = getActiveSessionSummary(interaction.guildId);
  if (!activeSession) {
    await interaction.reply({ content: 'There is no active playback session in this server right now.', ephemeral: true });
    return;
  }

  await stopActiveSession(interaction.guildId, `stop requested by ${interaction.user.tag}`);
  await interaction.reply('Playback stopped and the bot left voice.');
}

async function handleSkipCommand(interaction) {
  const activeSession = getActiveSessionSummary(interaction.guildId);
  if (!activeSession) {
    await interaction.reply({ content: 'There is no active playback session in this server right now.', ephemeral: true });
    return;
  }

  const queueLength = getQueueLength(interaction.guildId);
  const skipped = await skipCurrentTrack(interaction.guildId);

  if (skipped) {
    if (queueLength > 0) {
      await interaction.reply(`Skipped. ${queueLength} track(s) remaining in the queue.`);
    } else if (activeSession.resumeDefaultStreamAfterQueue && activeSession.track?.type !== 'http') {
      await interaction.reply('Skipped. Resuming the default stream.');
    } else {
      await interaction.reply('Skipped. The queue is empty — playback will stop.');
    }
  }
}

async function handleQueueCommand(interaction) {
  const queue = getQueue(interaction.guildId);

  if (queue.length === 0) {
    await interaction.reply({ content: 'The queue is empty.', ephemeral: true });
    return;
  }

  const lines = queue.map(
    (track, i) => `${i + 1}. **${track.title}** (requested by ${track.requestedBy})`,
  );
  await interaction.reply(`**Queue (${queue.length} track${queue.length === 1 ? '' : 's'}):**\n${lines.join('\n')}`);
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

const commandHandlers = new Map([
  ['lumi-play', handlePlayCommand],
  ['lumi-stop', handleStopCommand],
  ['lumi-skip', handleSkipCommand],
  ['lumi-queue', handleQueueCommand],
  ['lumi-quote', handleQuoteCommand],
  ['lumi-quoteadd', handleQuoteAddCommand],
  ['lumi-jh', handleJackHandeyCommand],
  ['lumi-man', handleManCommand],
  ['lumi-search', handleSearchCommand],
]);

async function handleCommandInteraction(interaction) {
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

  if (config.allowedGuildId && message.guildId !== config.allowedGuildId) {
    return;
  }

  await handleAutonomousMessage(message);
}

module.exports = {
  buildPlayerCommands,
  handleCommandInteraction,
  handleMessageCreate,
};
