const { ChannelType } = require('discord.js');

const { config, parseHttpUrl } = require('./config');
const { handleAutonomousMessage } = require('./chatbot');
const { logger } = require('./logger');
const { getRandomQuote, addQuote, getRandomJackHandey } = require('./quotes');
const { enqueue, getQueue, getQueueLength } = require('./queue');
const { resolveTitle } = require('./stream');
const { getActiveSessionSummary, playForMember, skipCurrentTrack, stopActiveSession } = require('./voice');

function buildHelpText() {
  return [
    'Available commands:',
    `${config.commandPrefix}play [url|search] - Play a YouTube/SoundCloud URL, search query, or HTTP stream URL.`,
    `${config.commandPrefix}stop / ${config.commandPrefix}leave - Stop playback and leave voice.`,
    `${config.commandPrefix}skip - Skip the current track and play the next queued one.`,
    `${config.commandPrefix}queue / ${config.commandPrefix}q - Show the current track queue.`,
    `${config.commandPrefix}quote - Get a random quote from the database.`,
    `${config.commandPrefix}quoteadd [text] - Add a new quote to the database.`,
    `${config.commandPrefix}jh - Get a random Deep Thought, by Jack Handey.`,
    `${config.commandPrefix}help - Show this help message.`,
    `${config.commandPrefix}readme - Show the full command list.`,
  ].join('\n');
}

async function handlePlayCommand(message, args) {
  const rawInput = args.join(' ').trim();

  // Resolve the typed input (YouTube URL, SoundCloud URL, search query, or HTTP stream)
  let playInput = rawInput ? parsePlayInput(rawInput) : null;

  // Fall back to the default HTTP stream URL if no input was given
  if (!playInput && config.defaultStreamUrl) {
    playInput = { type: 'http', url: config.defaultStreamUrl };
  }

  if (!playInput) {
    await message.reply(
      `No input provided and \`DEFAULT_STREAM_URL\` is not configured.\n` +
      `Usage: \`${config.commandPrefix}play <YouTube URL | SoundCloud URL | search terms | stream URL>\``,
    );
    return;
  }

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await message.reply('Join a guild voice channel first, then try again.');
    return;
  }

  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    await message.reply('Stage channels are not supported in this first version.');
    return;
  }

  if (!voiceChannel.joinable) {
    await message.reply('I do not have permission to join that voice channel.');
    return;
  }

  if (!voiceChannel.speakable) {
    await message.reply('I can join that voice channel, but I do not have permission to speak.');
    return;
  }

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
    requestedBy: message.author.tag,
  };

  // If something is already playing, add to queue instead of interrupting.
  const activeSession = getActiveSessionSummary(message.guildId);
  if (activeSession) {
    const position = enqueue(message.guildId, track);

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
      await skipCurrentTrack(message.guildId);
      await message.reply(`Added **${title}** to the queue and starting it now. The default stream will resume when the queue is empty.`);
      return;
    }

    await message.reply(`Added **${title}** to the queue (position ${position}).`);
    return;
  }

  const startingReply = await message.reply(`Joining **${voiceChannel.name}** and starting playback...`);

  try {
    await playForMember({
      member: message.member,
      textChannel: message.channel,
      track,
    });

    await startingReply.edit(
      `Now playing **${title}** in **${voiceChannel.name}**. Use \`${config.commandPrefix}stop\` to disconnect.`,
    );
  } catch (error) {
    logger.error('Play command failed.', error.message);
    await startingReply.edit(`Could not start playback: ${error.message}`);
  }
}

async function handleStopCommand(message) {
  const activeSession = getActiveSessionSummary(message.guildId);
  if (!activeSession) {
    await message.reply('There is no active playback session in this server right now.');
    return;
  }

  await stopActiveSession(message.guildId, `stop requested by ${message.author.tag}`);
  await message.reply('Playback stopped and the bot left voice.');
}

async function handleSkipCommand(message) {
  const activeSession = getActiveSessionSummary(message.guildId);
  if (!activeSession) {
    await message.reply('There is no active playback session in this server right now.');
    return;
  }

  const queueLength = getQueueLength(message.guildId);
  const skipped = await skipCurrentTrack(message.guildId);

  if (skipped) {
    if (queueLength > 0) {
      await message.reply(`Skipped. ${queueLength} track(s) remaining in the queue.`);
    } else if (activeSession.resumeDefaultStreamAfterQueue && activeSession.track?.type !== 'http') {
      await message.reply('Skipped. Resuming the default stream.');
    } else {
      await message.reply('Skipped. The queue is empty — playback will stop.');
    }
  }
}

async function handleQueueCommand(message) {
  const queue = getQueue(message.guildId);

  if (queue.length === 0) {
    await message.reply('The queue is empty.');
    return;
  }

  const lines = queue.map(
    (track, i) => `${i + 1}. **${track.title}** (requested by ${track.requestedBy})`,
  );
  await message.reply(`**Queue (${queue.length} track${queue.length === 1 ? '' : 's'}):**\n${lines.join('\n')}`);
}

async function handleHelpCommand(message) {
  await message.reply(buildHelpText());
}

async function handleReadmeCommand(message) {
  await message.reply(buildHelpText());
}

async function handleQuoteCommand(message) {
  const quote = getRandomQuote();
  if (!quote) {
    await message.reply(`There are no quotes in the database yet. Use \`${config.commandPrefix}quoteadd\` to add one!`);
    return;
  }
  await message.reply(`📖 Quote #${quote.number}/${quote.total}:\n> ${quote.text}`);
}

async function handleQuoteAddCommand(message, args) {
  const text = args.join(' ').trim();
  if (!text) {
    await message.reply(`Please provide the quote text. Usage: \`${config.commandPrefix}quoteadd <your quote>\``);
    return;
  }
  const result = addQuote(text);
  await message.reply(`✅ Quote #${result.number} added! There are now ${result.total} quote(s) in the database.`);
}

async function handleJackHandeyCommand(message) {
  const result = getRandomJackHandey();
  if (!result) {
    await message.reply('Could not load Jack Handey quotes.');
    return;
  }
  await message.reply(`${result.quote} \u2014 ${result.attribution}`);
}

async function handleMessageCreate(message) {
  if (message.author.bot || !message.inGuild()) {
    return;
  }

  if (config.allowedGuildId && message.guildId !== config.allowedGuildId) {
    return;
  }

  await handleAutonomousMessage(message);

  if (!message.content.startsWith(config.commandPrefix)) {
    return;
  }

  const body = message.content.slice(config.commandPrefix.length).trim();
  if (!body) {
    await handleHelpCommand(message);
    return;
  }

  const [commandName, ...args] = body.split(/\s+/u);
  switch (commandName.toLowerCase()) {
    case 'play':
      await handlePlayCommand(message, args);
      break;
    case 'stop':
    case 'leave':
      await handleStopCommand(message);
      break;
    case 'skip':
      await handleSkipCommand(message);
      break;
    case 'queue':
    case 'q':
      await handleQueueCommand(message);
      break;
    case 'quote':
      await handleQuoteCommand(message);
      break;
    case 'quoteadd':
      await handleQuoteAddCommand(message, args);
      break;
    case 'jh':
      await handleJackHandeyCommand(message);
      break;
    case 'help':
      await handleHelpCommand(message);
      break;
    case 'readme':
      await handleReadmeCommand(message);
      break;
    default:
      await message.reply(`Unknown command.\n${buildHelpText()}`);
      break;
  }
}

module.exports = {
  handleMessageCreate,
};
