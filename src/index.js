const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const { flushChatbotState, initializeChatbot, shutdownChatbotPersistence } = require('./chatbot');
const { handleCommandInteraction, handleMessageCreate } = require('./commands');
const { config, getMissingConfigValues } = require('./config');
const { handleControlPlaneInteraction, registerControlPlane } = require('./controlPlane');
const { logger } = require('./logger');
const { initNowPlaying } = require('./nowPlaying');
const { stopAllSessions } = require('./voice');
const { killExistingProcesses } = require('./processCleanup');
const { handleMessageReactionAdd, handleMessageReactionRemove } = require('./starboard');
const { handleGuildMemberAdd } = require('./welcome');

const missingConfigValues = getMissingConfigValues();
if (missingConfigValues.length > 0) {
  logger.error(`Missing required configuration: ${missingConfigValues.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

let isShuttingDown = false;
let nowPlayingWatcher = null;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down.`);

  if (nowPlayingWatcher) {
    try { nowPlayingWatcher.stop(); } catch { }
  }

  try {
    await stopAllSessions(`process shutdown (${signal})`);
  } catch (error) {
    logger.error('Failed to stop active sessions during shutdown.', error.message);
  }

  try {
    await flushChatbotState();
  } catch (error) {
    logger.warn('Failed to flush chatbot memory during shutdown.', error.message);
  }

  try {
    await shutdownChatbotPersistence();
  } catch (error) {
    logger.warn('Failed to stop chatbot memory SQL service during shutdown.', error.message);
  }

  client.destroy();
  process.exit(0);
}

client.once(Events.ClientReady, async (readyClient) => {
  await initializeChatbot();
  await registerControlPlane(readyClient);
  nowPlayingWatcher = initNowPlaying(readyClient);

  logger.info(`Logged in as ${readyClient.user.tag}`);
  if (config.allowedGuildId) {
    logger.info(`Guild lock enabled for ${config.allowedGuildId}`);
  }

  logger.info(
    `Chatbot mode: ${config.chatbotEnabled ? 'enabled' : 'disabled'}; channels=${config.chatbotChannelIds.length}; endpoints=${config.llmEndpoints.length}; model=${config.chatbotModel}; local-gpu=${config.llmUseLocalGpu ? 'on' : 'off'}`,
  );
});

client.on(Events.MessageCreate, (message) => {
  void handleMessageCreate(message);
});

client.on(Events.MessageReactionAdd, (reaction) => {
  void handleMessageReactionAdd(reaction);
});

client.on(Events.MessageReactionRemove, (reaction) => {
  void handleMessageReactionRemove(reaction);
});

client.on(Events.GuildMemberAdd, (member) => {
  void handleGuildMemberAdd(member);
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleControlPlaneInteraction(interaction);
  void handleCommandInteraction(interaction);
});

client.on(Events.Error, (error) => {
  logger.error('Discord client error.', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection.', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception.', error);
});

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

(async () => {
  logger.info('Starting SadGirlPlayer...');
  
  // Kill any existing processes before starting
  await killExistingProcesses();
  
  try {
    await client.login(config.discordToken);
  } catch (error) {
    logger.error('Discord login failed.', error);
    process.exit(1);
  }
})();
