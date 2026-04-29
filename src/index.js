const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const { flushChatbotState, initializeChatbot, shutdownChatbotPersistence } = require('./chatbot');
const { handleCommandInteraction, handleMessageCreate } = require('./commands');
const { config, getMissingConfigValues } = require('./config');
const { handleControlPlaneInteraction, registerControlPlane } = require('./controlPlane');
const { initEconomyStore, closeEconomyStore, getEconomyDb, adjustBalance, getSystemState, setSystemState, TOUHOU_MGMT_USER_ID } = require('./sadgirlEconomyStore');
const { startEconomyScheduler, stopEconomyScheduler } = require('./sadgirlEconomyScheduler');
const { startWebhookDispatcher, stopWebhookDispatcher } = require('./webhookDispatcher');
const { initTouhouStore, closeTouhouStore, computeHistoricalOwings } = require('./touhouStore');
const { setTouhouDir } = require('./touhouCommands');
const { setMenuTouhouDir } = require('./touhouMenu');
const { logger } = require('./logger');
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
const { startWebAppServer, stopWebAppServer } = require('./webAppServer');
const { startLeaderboardServer, stopLeaderboardServer } = require('./leaderboardServer');
const { startApiServer, stopApiServer } = require('./apiServer');
const { initPrivateStockStore } = require('./privateStockStore');
const { startPrivateStockScheduler, stopPrivateStockScheduler } = require('./privateStockScheduler');
const { initStockEvents, stopStockEvents } = require('./stockEvents');
const { reloadSettings: reloadPrivateStockSettings } = require('./privateStockCommands');
const { initCigaretteStore, closeCigaretteStore } = require('./cigaretteStore');
const {
  startPatreonRewards,
  stopPatreonRewards,
  handleGuildMemberAdd: handlePatreonMemberAdd,
  handleGuildMemberUpdate: handlePatreonMemberUpdate,
} = require('./patreonRewards');
const path = require('node:path');
const { manager: workerManager } = require('./workers/workerManager');

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

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down.`);

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
    stopWebAppServer();
    stopLeaderboardServer();
    stopApiServer();
  } catch (error) {
    logger.warn('Failed to stop web panel during shutdown.', error.message);
  }

  // Stop Patreon rewards
  try {
    stopPatreonRewards();
  } catch (error) {
    logger.warn('Failed to stop Patreon rewards during shutdown.', error.message);
  }

  // Shutdown SadGirlCoin economy
  try {
    stopEconomyScheduler();
    stopWebhookDispatcher();
    closeEconomyStore();
  } catch (error) {
    logger.warn('Failed to close SadGirlCoin economy DB during shutdown.', error.message);
  }

  // Tear down game worker pool last so any in-flight game ops can finish
  // their final replies before the workers terminate.
  try {
    await workerManager.shutdown();
  } catch (error) {
    logger.warn('Failed to shut down game worker pool.', error.message);
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
      // Phase 4 (split): the canonical webhook dispatcher now lives in
      // SGCServer. We only spin up an in-proc dispatcher when explicitly
      // opted-in, otherwise we'd double-deliver every webhook.
      if (config.sgcWebhookDispatcherInproc) {
        logger.info('SGC webhook dispatcher: running IN-PROCESS (legacy mode).');
        startWebhookDispatcher();
      } else {
        logger.info('SGC webhook dispatcher: skipped (canonical owner is SGCServer).');
      }

      // Smoke-test SGCServer connectivity if configured (non-fatal).
      try {
        const sgcClient = require('./sgcClient');
        if (sgcClient.isEnabled()) {
          sgcClient.ping().then((ok) => {
            if (ok) logger.info(`SGCServer reachable at ${config.sgcServerInternalUrl}.`);
            else logger.warn(`SGCServer NOT reachable at ${config.sgcServerInternalUrl} — make sure it's running.`);
          }).catch(() => {});
        } else {
          logger.debug('sgcClient disabled (SGC_SERVER_INTERNAL_URL or SGC_INTERNAL_TOKEN not set).');
        }
      } catch (clientErr) {
        logger.warn(`sgcClient smoke check failed: ${clientErr.message}`);
      }

      // Reload panel-configurable settings from DB overrides
      try {
        const { reloadSettings: reloadSlots } = require('./slots');
        const { reloadSettings: reloadPachinko } = require('./pachinko');
        const { reloadSettings: reloadBlackjack } = require('./blackjack');
        const { reloadSettings: reloadHoldem } = require('./texasholdem');
        const { reloadSettings: reloadHorseRacing } = require('./horseracing');
        const { reloadSettings: reloadTouhouBattle } = require('./touhouBattle');
        const { reloadSettings: reloadVcSettings } = require('./vcRewards');
        const { reloadSettings: reloadScheduler } = require('./sadgirlEconomyScheduler');
        const { reloadSettings: reloadCommands } = require('./sadgirlEconomyCommands');
        reloadSlots();
        reloadPachinko();
        reloadBlackjack();
        reloadHoldem();
        reloadHorseRacing();
        reloadTouhouBattle();
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
      setMenuTouhouDir(touhouImgDir);
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

    if (config.webAppEnabled) {
      try {
        startWebAppServer({
          port: config.webAppPort,
          host: config.webAppHost,
          authRedirectUri: config.webAppDiscordOAuthRedirectUri,
        });
      } catch (error) {
        logger.error('Failed to start Lumi Web app.', error.message);
      }
    }

    // Start public leaderboard HTTP server (intended for nginx reverse proxy).
    if (config.leaderboardServerEnabled) {
      try {
        startLeaderboardServer({
          port: config.leaderboardServerPort,
          host: config.leaderboardServerHost,
          outputFile: config.leaderboardServerOutputFile,
        });
      } catch (error) {
        logger.error('Failed to start public leaderboard server.', error.message);
      }
    }

    // Start external SadGirlCoin API (third-party apps via API keys).
    if (config.sgcApiEnabled) {
      try {
        startApiServer({
          port: config.sgcApiPort,
          host: config.sgcApiHost,
          linkCodeTtlMs: config.sgcApiLinkCodeTtlMs,
        });
      } catch (error) {
        logger.error('Failed to start SadGirlCoin external API.', error.message);
      }
    }

    // Start Patreon supporter rewards (monthly stipends + signup bonuses)
    try {
      await startPatreonRewards(readyClient);
    } catch (error) {
      logger.error('Failed to start Patreon rewards.', error.message);
    }
  }

  // Phase 1 of multi-threaded game runtime. The worker pool is gated by
  // a config flag so this rollout is opt-in. Engines are registered here
  // and started together; game adapters (added in later phases) reach
  // the manager via require('./workers/workerManager').
  if (config.gameWorkersEnabled) {
    try {
      const poolSize = Math.max(1, Math.min(config.gameWorkerPoolSize, 8));
      workerManager.registerEngine('echo', {
        scriptPath: path.resolve(__dirname, 'workers', 'engines', 'echo', 'worker.js'),
        poolSize,
      });
      if (config.gameWorkersBlackjack) {
        workerManager.registerEngine('blackjack', {
          scriptPath: path.resolve(__dirname, 'workers', 'engines', 'blackjack', 'worker.js'),
          poolSize,
        });
      }
      if (config.gameWorkersPachinko) {
        workerManager.registerEngine('pachinko', {
          scriptPath: path.resolve(__dirname, 'workers', 'engines', 'pachinko', 'worker.js'),
          poolSize,
        });
      }
      if (config.gameWorkersSlots) {
        workerManager.registerEngine('slots', {
          scriptPath: path.resolve(__dirname, 'workers', 'engines', 'slots', 'worker.js'),
          poolSize,
        });
      }
      if (config.gameWorkersHorseracing) {
        workerManager.registerEngine('horseracing', {
          scriptPath: path.resolve(__dirname, 'workers', 'engines', 'horseracing', 'worker.js'),
          poolSize,
        });
      }
      if (config.gameWorkersHoldem) {
        workerManager.registerEngine('holdem', {
          scriptPath: path.resolve(__dirname, 'workers', 'engines', 'holdem', 'worker.js'),
          poolSize,
        });
      }
      workerManager.start();
      logger.info(`Game worker pool enabled (size=${poolSize}, engines=${[
        'echo',
        config.gameWorkersBlackjack ? 'blackjack' : null,
        config.gameWorkersPachinko ? 'pachinko' : null,
        config.gameWorkersSlots ? 'slots' : null,
        config.gameWorkersHorseracing ? 'horseracing' : null,
        config.gameWorkersHoldem ? 'holdem' : null,
      ].filter(Boolean).join(', ')}).`);

      if (config.gameWorkersBlackjack) {
        // Push the latest panel-side blackjack settings into the worker
        // now that workers are live (the earlier reloadBlackjack() call
        // ran before manager.start() and was a no-op).
        try {
          const bjAdapter = require('./blackjackAdapter');
          bjAdapter.reloadSettings();
          logger.info('Worker-backed Blackjack engine activated.');
        } catch (err) {
          logger.warn('Failed to seed blackjack worker settings.', err.message);
        }
      }
      if (config.gameWorkersPachinko) {
        try {
          const pkAdapter = require('./pachinkoAdapter');
          pkAdapter.reloadSettings();
          logger.info('Worker-backed Pachinko engine activated.');
        } catch (err) {
          logger.warn('Failed to seed pachinko worker settings.', err.message);
        }
      }
      if (config.gameWorkersSlots) {
        try {
          const slAdapter = require('./slotsAdapter');
          slAdapter.reloadSettings();
          logger.info('Worker-backed Slots engine activated.');
        } catch (err) {
          logger.warn('Failed to seed slots worker settings.', err.message);
        }
      }
      if (config.gameWorkersHorseracing) {
        try {
          const hrAdapter = require('./horseracingAdapter');
          hrAdapter.reloadSettings();
          logger.info('Worker-backed Horseracing engine activated.');
        } catch (err) {
          logger.warn('Failed to seed horseracing worker settings.', err.message);
        }
      }
      if (config.gameWorkersHoldem) {
        try {
          const thAdapter = require('./holdemAdapter');
          thAdapter.reloadSettings();
          logger.info("Worker-backed Texas Hold'em engine activated.");
        } catch (err) {
          logger.warn('Failed to seed holdem worker settings.', err.message);
        }
      }
    } catch (error) {
      logger.error('Failed to start game worker pool.', error.message);
    }
  } else {
    logger.info('Game worker pool disabled (set GAME_WORKERS_ENABLED=true to enable).');
  }

  await registerControlPlane(readyClient);

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
  try { handlePatreonMemberAdd(member); } catch (err) { logger.warn('Patreon member-add handler failed.', err.message); }
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  try { handlePatreonMemberUpdate(oldMember, newMember); } catch (err) { logger.warn('Patreon member-update handler failed.', err.message); }
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
