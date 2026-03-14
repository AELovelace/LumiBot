const { Client, Events, GatewayIntentBits } = require('discord.js');

const { handleMessageCreate } = require('./commands');
const { config, getMissingConfigValues } = require('./config');
const { logger } = require('./logger');
const { stopAllSessions } = require('./voice');

const missingConfigValues = getMissingConfigValues();
if (missingConfigValues.length > 0) {
  logger.error(`Missing required configuration: ${missingConfigValues.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down.`);

  try {
    await stopAllSessions(`process shutdown (${signal})`);
  } catch (error) {
    logger.error('Failed to stop active sessions during shutdown.', error.message);
  }

  client.destroy();
  process.exit(0);
}

client.once(Events.ClientReady, (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag}`);
  if (config.allowedGuildId) {
    logger.info(`Guild lock enabled for ${config.allowedGuildId}`);
  }
});

client.on(Events.MessageCreate, (message) => {
  void handleMessageCreate(message);
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
  try {
    await client.login(config.discordToken);
  } catch (error) {
    logger.error('Discord login failed.', error);
    process.exit(1);
  }
})();
