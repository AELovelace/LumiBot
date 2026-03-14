const { ChannelType } = require('discord.js');

const { config, parseHttpUrl } = require('./config');
const { logger } = require('./logger');
const { getActiveSessionSummary, playForMember, stopActiveSession } = require('./voice');

function buildHelpText() {
  return [
    'Available commands:',
    `${config.commandPrefix}play [url] - Join your current voice channel and start streaming.`,
    `${config.commandPrefix}stop - Stop playback and leave voice.`,
    `${config.commandPrefix}help - Show this help message.`,
  ].join('\n');
}

async function handlePlayCommand(message, args) {
  const requestedUrl = args.join(' ').trim();
  const streamUrl = requestedUrl ? parseHttpUrl(requestedUrl) : config.defaultStreamUrl;

  if (!streamUrl) {
    await message.reply(
      requestedUrl
        ? 'That URL is not a valid http or https stream URL.'
        : `No stream URL was provided and DEFAULT_STREAM_URL is not configured.`,
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

  const startingReply = await message.reply(`Joining **${voiceChannel.name}** and starting the stream...`);

  try {
    await playForMember({
      member: message.member,
      textChannel: message.channel,
      streamUrl,
    });

    await startingReply.edit(`Streaming in **${voiceChannel.name}**. Use ${config.commandPrefix}stop to disconnect.`);
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

async function handleHelpCommand(message) {
  await message.reply(buildHelpText());
}

async function handleMessageCreate(message) {
  if (message.author.bot || !message.inGuild()) {
    return;
  }

  if (config.allowedGuildId && message.guildId !== config.allowedGuildId) {
    return;
  }

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
    case 'help':
      await handleHelpCommand(message);
      break;
    default:
      await message.reply(`Unknown command.\n${buildHelpText()}`);
      break;
  }
}

module.exports = {
  handleMessageCreate,
};
