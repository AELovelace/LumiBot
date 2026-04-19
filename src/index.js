const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const { flushChatbotState, initializeChatbot, shutdownChatbotPersistence } = require('./chatbot');
const { handleCommandInteraction, handleMessageCreate } = require('./commands');
const { config, getMissingConfigValues } = require('./config');
const { handleControlPlaneInteraction, registerControlPlane } = require('./controlPlane');
const { initEconomyStore, closeEconomyStore, getEconomyDb, adjustBalance, getSystemState, setSystemState, TOUHOU_MGMT_USER_ID } = require('./sadgirlEconomyStore');
const { startEconomyScheduler, stopEconomyScheduler } = require('./sadgirlEconomyScheduler');
const { initTouhouStore, closeTouhouStore, computeHistoricalOwings } = require('./touhouStore');
const { setTouhouDir } = require('./touhouCommands');
const { logger } = require('./logger');
const { initNowPlaying } = require('./nowPlaying');
const { stopAllSessions } = require('./voice');
const { killExistingProcesses } = require('./processCleanup');
const { handleMessageReactionAdd, handleMessageReactionRemove } = require('./starboard');
const { handleStockStarReaction } = require('./sadgirlStockActivation');
const { handleReactionRoleAdd, handleReactionRoleRemove } = require('./reactionRoles');
const { setThoughtRelayClient } = require('./thoughtRelay');
const { handleGuildMemberAdd } = require('./welcome');
const { handleVoiceStateUpdate, startVcRewards, stopVcRewards } = require('./vcRewards');
const { initBigBusiness, stopBigBusiness } = require('./bigBusiness');
const { initGuildConfig } = require('./guildConfig');
const { startWebPanel, stopWebPanel } = require('./webPanel');
const { initPrivateStockStore } = require('./privateStockStore');
const { startPrivateStockScheduler, stopPrivateStockScheduler } = require('./privateStockScheduler');
const { initStockEvents, stopStockEvents } = require('./stockEvents');
const { reloadSettings: reloadPrivateStockSettings } = require('./privateStockCommands');
const { initCigaretteStore, closeCigaretteStore } = require('./cigaretteStore');

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

setThoughtRelayClient(client);

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

  // Shutdown Touhou market
  try {
    closeTouhouStore();
  } catch (error) {
    logger.warn('Failed to close Touhou market DB during shutdown.', error.message);
  }

  // Shutdown cigarette gachapon
  try {
    closeCigaretteStore();
  } catch (error) {
    logger.warn('Failed to close cigarette store DB during shutdown.', error.message);
  }

  // Stop VC rewards (pays out remaining hours)
  try {
    stopVcRewards();
  } catch (error) {
    logger.warn('Failed to stop VC rewards during shutdown.', error.message);
  }

  // Stop Big Business Inc
  try {
    stopBigBusiness();
  } catch (error) {
    logger.warn('Failed to stop Big Business Inc during shutdown.', error.message);
  }

  try {
      stopStockEvents();
    } catch (error) {
      logger.warn('Failed to stop stock events during shutdown.', error.message);
    }

    try {
  } catch (error) {
    logger.warn('Failed to stop private stock scheduler during shutdown.', error.message);
  }

  // Stop web control panel
  try {
    stopWebPanel();
  } catch (error) {
    logger.warn('Failed to stop web panel during shutdown.', error.message);
  }

  // Shutdown SadGirlCoin economy
  try {
    stopEconomyScheduler();
    closeEconomyStore();
  } catch (error) {
    logger.warn('Failed to close SadGirlCoin economy DB during shutdown.', error.message);
  }

  client.destroy();
  process.exit(0);
}

client.once(Events.ClientReady, async (readyClient) => {
  await initializeChatbot();

  // Initialize SadGirlCoin economy
  if (config.economyEnabled) {
    // Initialize per-guild configuration (must run before economy systems)
    try {
      initGuildConfig();
    } catch (error) {
      logger.error('Failed to initialize guild config.', error.message);
    }

    try {
      initEconomyStore(config.economyDbFile);

      // Reload panel-configurable settings from DB overrides
      try {
        const { reloadSettings: reloadSlots } = require('./slots');
        const { reloadSettings: reloadPachinko } = require('./pachinko');
        const { reloadSettings: reloadBlackjack } = require('./blackjack');
        const { reloadSettings: reloadHoldem } = require('./texasholdem');
        const { reloadSettings: reloadHorseRacing } = require('./horseracing');
        const { reloadSettings: reloadVcSettings } = require('./vcRewards');
        const { reloadSettings: reloadScheduler } = require('./sadgirlEconomyScheduler');
        const { reloadSettings: reloadCommands } = require('./sadgirlEconomyCommands');
        reloadSlots();
        reloadPachinko();
        reloadBlackjack();
        reloadHoldem();
        reloadHorseRacing();
        reloadVcSettings();
        reloadScheduler();
        reloadCommands();
        logger.info('Panel settings loaded from database overrides.');
      } catch (settingsErr) {
        logger.warn('Could not reload panel settings (non-fatal).', settingsErr.message);
      }

      startEconomyScheduler(readyClient);
    } catch (error) {
      logger.error('Failed to initialize SadGirlCoin economy.', error.message);
    }

    // Initialize Touhou market
    try {
      const touhouDbPath = config.touhouDbFile;
      const touhouImgDir = config.touhouDir;
      initTouhouStore(touhouDbPath, touhouImgDir);
      setTouhouDir(touhouImgDir);
    } catch (error) {
      logger.error('Failed to initialize Touhou market.', error.message);
    }

    // Initialize cigarette gachapon
    try {
      initCigaretteStore(config.cigaretteDbFile, config.cigaretteDataCsv);
    } catch (error) {
      logger.error('Failed to initialize cigarette store.', error.message);
    }

    // One-time retroactive credit for Touhou Management Inc
    try {
      const migDone = getSystemState('touhou_mgmt_retroactive_v1');
      if (!migDone) {
        const owings = computeHistoricalOwings(25);
        const total = owings.adoptTotal + owings.taxTotal;
        if (total > 0) {
          adjustBalance(TOUHOU_MGMT_USER_ID, total,
            `Retroactive Touhou Management Inc credit (${owings.adoptTotal} adopt + ${owings.taxTotal} trade taxes)`);
        }
        setSystemState('touhou_mgmt_retroactive_v1', '1');
        logger.info(`Touhou Mgmt retroactive credit applied: ${total} SGC`);
      }
    } catch (error) {
      logger.warn('Touhou Management Inc retroactive migration failed.', error.message);
    }

    // Start voice-channel coin rewards (15 SGC / hour)
    try {
      startVcRewards(readyClient);
    } catch (error) {
      logger.error('Failed to start VC rewards.', error.message);
    }

    // Start Big Business Inc matching fund
    try {
      initBigBusiness(readyClient);
    } catch (error) {
      logger.error('Failed to initialize Big Business Inc.', error.message);
    }

    try {
      initPrivateStockStore(getEconomyDb());
      reloadPrivateStockSettings();
      startPrivateStockScheduler(readyClient);
      initStockEvents(readyClient);
    } catch (error) {
      logger.error('Failed to initialize private stock exchange.', error.message);
    }

    // Start web control panel (127.0.0.1 only)
    try {
      startWebPanel();
    } catch (error) {
      logger.error('Failed to start web control panel.', error.message);
    }
  }

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

client.on(Events.MessageReactionAdd, (reaction, user) => {
  void handleMessageReactionAdd(reaction);
  void handleReactionRoleAdd(reaction, user);
  void handleStockStarReaction(reaction, user, client);
});

client.on(Events.MessageReactionRemove, (reaction, user) => {
  void handleMessageReactionRemove(reaction);
  void handleReactionRoleRemove(reaction, user);
});

client.on(Events.GuildMemberAdd, (member) => {
  void handleGuildMemberAdd(member);
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  handleVoiceStateUpdate(oldState, newState);
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
