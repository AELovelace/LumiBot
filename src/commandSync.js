'use strict';

/**
 * Global slash-command sync that keeps the Activity "Launch" command (docs/plans/lumi-town-discord.md §7, phase D4).
 *
 * When Activities are switched on in the Discord developer portal, Discord adds a PRIMARY_ENTRY_POINT command
 * (type 4, usually called "launch"): the button that starts the Activity. A bulk overwrite
 * (`client.application.commands.set([...])`) "will overwrite ALL types of application commands" (Discord docs), so a
 * list without it would remove it (or be refused). Discord's own guidance is to include it in the list.
 *
 *   setGlobalCommands(client, commands)
 *     1. reads the app's current global commands,
 *     2. carries every Entry Point command over unchanged (name, description, handler, integration types, contexts),
 *     3. bulk-overwrites with [...commands, ...entry points].
 *   If step 1 fails, NOTHING is overwritten (an Entry Point is never lost to a hiccup); the next start tries again.
 *
 *   keepEntryPoints(existing, commands)   the pure part, for tests
 */

const { logger } = require('./logger');

const PRIMARY_ENTRY_POINT = 4;          // ApplicationCommandType.PrimaryEntryPoint
const DISCORD_LAUNCH_ACTIVITY = 2;      // EntryPointCommandHandlerType.DiscordLaunchActivity (Discord launches it)

/** The JSON Discord needs to keep one Entry Point command as it is. */
function entryPointData(cmd) {
  const data = {
    name: cmd.name,                                                                    // usually 'launch'
    description: cmd.description || 'Launch the Activity',                             // Discord requires one
    type: PRIMARY_ENTRY_POINT,                                                         // 4
    handler: cmd.handler === undefined || cmd.handler === null ? DISCORD_LAUNCH_ACTIVITY : cmd.handler, // who launches it
  };
  const integrationTypes = cmd.integrationTypes || cmd.integration_types;              // discord.js camelCase or raw
  const contexts = cmd.contexts;                                                       // where it can be used
  if (Array.isArray(integrationTypes) && integrationTypes.length) data.integration_types = integrationTypes; // keep as set
  if (Array.isArray(contexts) && contexts.length) data.contexts = contexts;           // keep as set
  if (cmd.nameLocalizations) data.name_localizations = cmd.nameLocalizations;         // keep translations
  if (cmd.descriptionLocalizations) data.description_localizations = cmd.descriptionLocalizations;
  return data;
}

/** Our commands plus every existing Entry Point command (pure). existing: iterable of discord.js commands. */
function keepEntryPoints(existing, commands) {
  const entryPoints = [...(existing || [])].filter((cmd) => cmd && cmd.type === PRIMARY_ENTRY_POINT).map(entryPointData); // the Launch command(s)
  return [...commands, ...entryPoints];                                                // ours + theirs
}

/** Bulk-overwrite the global commands, keeping the Entry Point. Returns the list sent, or null if it was skipped. */
async function setGlobalCommands(client, commands) {
  let existing;                                                                        // what Discord has now
  try {
    existing = await client.application.commands.fetch();                             // a Collection (Map)
  } catch (error) {
    logger.error(`Slash commands NOT updated: could not read the current list first (${error.message}). Will try again on the next start.`); // never risk the Launch command
    return null;
  }
  const list = keepEntryPoints(existing.values ? existing.values() : existing, commands); // ours + Launch
  await client.application.commands.set(list);                                         // one overwrite
  const kept = list.length - commands.length;                                          // entry points carried over
  if (kept) logger.info(`Kept ${kept} Activity entry point command(s) while updating slash commands.`); // breadcrumb
  return list;
}

module.exports = { setGlobalCommands, keepEntryPoints, entryPointData, PRIMARY_ENTRY_POINT, DISCORD_LAUNCH_ACTIVITY };
