'use strict';

/**
 * Lumi-Town on Discord: the front door for everything Lumi does in Discord (docs/plans/lumi-town-discord.md).
 *
 *   initLumiDiscord(client)        src/index.js calls this right after initLumiGames(), once the bot is ready
 *   stopLumiDiscord()              shutdown: stop timers (reminders and the news digest, in later phases)
 *   handleLumiInteraction(i)       from the InteractionCreate listener; answers only what is Lumi's
 *   registerHandler(def)           how the pieces plug in (D1 /lumi-pet, D2 reminders, D3 news)
 *   commandDefinitions()           slash commands the pieces add to the global member list
 *   isEnabled() / getClient()      for the pieces
 *
 * What counts as "Lumi's": a slash command or autocomplete whose name a handler registered, or a button / select
 * menu / modal whose customId starts with "lumipet:". Everything else is ignored, so this can sit next to the other
 * InteractionCreate handlers without double-answering.
 *
 * LUMI_DISCORD_ENABLED=false turns the whole Discord side off; the website keeps working.
 */

const { logger } = require('../../logger');

const CUSTOM_ID_PREFIX = 'lumipet:';     // every Lumi button/select customId starts with this

const commandHandlers = new Map();      // command name -> handler def (slash commands + their autocomplete)
const componentHandlers = new Map();    // customId verb ('lumipet:<verb>:...') -> handler def
let client = null;                      // the discord.js Client once started
let started = false;                    // initLumiDiscord ran and stop didn't

/** LUMI_DISCORD_ENABLED (default true): is the Discord side switched on? */
function isEnabled() {
  const raw = String(process.env.LUMI_DISCORD_ENABLED ?? 'true').trim().toLowerCase(); // env text
  return !['0', 'false', 'no', 'off'].includes(raw);                                   // anything else = on
}

/**
 * Plug a piece in.
 * def.command   optional: { name, data } where data is a SlashCommandBuilder (or its JSON)
 * def.verbs     optional: customId verbs this piece answers ('lumipet:<verb>:...')
 * def.onCommand(interaction), def.onAutocomplete(interaction), def.onComponent(interaction, parts)
 */
function registerHandler(def) {
  if (!def || typeof def !== 'object') throw new Error('registerHandler: a definition object is needed'); // programming bug
  if (def.command) {
    const name = String(def.command.name);                                             // e.g. 'lumi-pet'
    if (commandHandlers.has(name)) throw new Error(`registerHandler: /${name} is registered twice`); // two pieces claimed it
    commandHandlers.set(name, def);                                                    // slash command + autocomplete
  }
  for (const verb of def.verbs || []) {
    if (componentHandlers.has(verb)) throw new Error(`registerHandler: verb "${verb}" is registered twice`); // two pieces claimed it
    componentHandlers.set(verb, def);                                                  // buttons / selects / modals
  }
}

/** The slash commands the pieces add (controlPlane puts them in the global member list). Empty when switched off. */
function commandDefinitions() {
  if (!isEnabled()) return [];                                                         // off: no commands at all
  return [...commandHandlers.values()].map((def) => def.command.data);                 // builders (or JSON)
}

/** Split 'lumipet:<verb>:<a>:<b>' into { verb, args: [a, b] } (null if not ours). */
function parseCustomId(customId) {
  const text = String(customId || '');                                                 // may be undefined
  if (!text.startsWith(CUSTOM_ID_PREFIX)) return null;                                 // not Lumi's
  const [verb, ...args] = text.slice(CUSTOM_ID_PREFIX.length).split(':');             // pieces
  return verb ? { verb, args } : null;                                                 // a verb is required
}

/** Build a customId: customId('feed', ownerId, 'berry') -> 'lumipet:feed:<ownerId>:berry' (Discord max 100 chars). */
function customId(verb, ...args) {
  const id = [CUSTOM_ID_PREFIX + verb, ...args.map(String)].join(':');                // join
  if (id.length > 100) throw new Error(`customId too long (${id.length}): ${id}`);    // Discord's limit
  return id;                                                                           // done
}

/** Start the Discord side (after initLumiGames). Safe to call twice. */
function initLumiDiscord(discordClient) {
  if (!isEnabled()) {
    logger.info('Lumi-Town on Discord is switched off (LUMI_DISCORD_ENABLED=false).'); // breadcrumb
    return false;                                                                      // nothing started
  }
  client = discordClient;                                                              // keep the bot
  started = true;                                                                      // open
  logger.info(`Lumi-Town on Discord ready (${commandHandlers.size} commands, ${componentHandlers.size} button verbs).`); // breadcrumb
  return true;                                                                         // started
}

/** Stop the Discord side (shutdown). Later phases stop their timers here. */
function stopLumiDiscord() {
  started = false;                                                                     // refuse new work
}

/** The bot (null before init). */
function getClient() {
  return client;                                                                       // discord.js Client
}

/** Is this interaction one of Lumi's? (cheap check, no side effects) */
function isLumiInteraction(interaction) {
  if (!interaction) return false;                                                      // nothing
  if (typeof interaction.isChatInputCommand === 'function' && (interaction.isChatInputCommand() || interaction.isAutocomplete())) {
    return commandHandlers.has(interaction.commandName);                               // a registered slash command
  }
  const parsed = parseCustomId(interaction.customId);                                  // a button/select/modal?
  return Boolean(parsed && componentHandlers.has(parsed.verb));                        // a registered verb
}

/** Answer an interaction if it is Lumi's. Returns true when it was ours (answered or failed politely). */
async function handleLumiInteraction(interaction) {
  if (!started || !isLumiInteraction(interaction)) return false;                       // not ours (or switched off)
  try {
    if (interaction.isAutocomplete()) {
      const def = commandHandlers.get(interaction.commandName);                        // the command's piece
      if (def.onAutocomplete) await def.onAutocomplete(interaction);                   // suggestions
      return true;
    }
    if (interaction.isChatInputCommand()) {
      await commandHandlers.get(interaction.commandName).onCommand(interaction);       // the slash command
      return true;
    }
    const { verb, args } = parseCustomId(interaction.customId);                        // a button/select/modal
    await componentHandlers.get(verb).onComponent(interaction, args);                  // its piece
    return true;
  } catch (error) {
    logger.error(`Lumi Discord interaction failed (${interaction.commandName || interaction.customId}): ${error && (error.stack || error.message)}`); // a bug
    await sayOops(interaction);                                                        // don't leave them hanging
    return true;
  }
}

/** Last-resort ephemeral reply after a crash (never throws). */
async function sayOops(interaction) {
  if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) return; // autocomplete can't show a message
  const payload = { content: 'Something went wrong in Lumi-Town. Please try again. 💜', ephemeral: true }; // the words
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload); // already answered once
    else await interaction.reply(payload);                                             // first answer
  } catch { /* the interaction expired: nothing more to do */ }
}

module.exports = {
  initLumiDiscord,         // start (src/index.js)
  stopLumiDiscord,         // stop (shutdown)
  handleLumiInteraction,   // InteractionCreate hook
  isLumiInteraction,       // cheap "is it ours?"
  registerHandler,         // pieces plug in here
  commandDefinitions,      // slash commands for the global list
  parseCustomId,           // 'lumipet:<verb>:...' -> { verb, args }
  customId,                // build one
  isEnabled,               // LUMI_DISCORD_ENABLED
  getClient,               // the bot
  CUSTOM_ID_PREFIX,        // 'lumipet:'
};
