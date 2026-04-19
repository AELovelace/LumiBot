const { logger } = require('./logger');
const { getGuildConfig } = require('./guildConfig');

const UNKNOWN_MESSAGE_ERROR_CODE = 10_008;
const MISSING_ACCESS_ERROR_CODE = 50_001;
const MISSING_PERMISSIONS_ERROR_CODE = 50_013;
const PERMISSION_WARNING_COOLDOWN_MS = 60_000;

const permissionWarningTimestamps = new Map();

function normalizeUnicodeEmoji(value) {
  return String(value || '')
    .replace(/[\uFE0E\uFE0F]/gu, '')
    .trim();
}

function normalizeEmojiKey(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';
  if (raw.startsWith('unicode:')) {
    const unicode = normalizeUnicodeEmoji(raw.slice('unicode:'.length));
    return unicode ? `unicode:${unicode}` : '';
  }
  if (raw.startsWith('id:')) {
    const id = raw.slice('id:'.length).trim();
    return id ? `id:${id}` : '';
  }
  return raw;
}

function isMissingPermissionError(error) {
  if (!error) return false;
  if (error.code === MISSING_ACCESS_ERROR_CODE || error.code === MISSING_PERMISSIONS_ERROR_CODE) {
    return true;
  }
  const normalizedMessage = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return normalizedMessage.includes('missing permissions') || normalizedMessage.includes('missing access');
}

function isUnknownMessageError(error) {
  return Boolean(error && error.code === UNKNOWN_MESSAGE_ERROR_CODE);
}

function warnMissingPermissions(scope, error, guildId) {
  const now = Date.now();
  const key = `${scope}:${guildId || 'unknown'}`;
  const lastWarningAt = permissionWarningTimestamps.get(key) || 0;
  if (now - lastWarningAt < PERMISSION_WARNING_COOLDOWN_MS) return;

  permissionWarningTimestamps.set(key, now);
  logger.warn(
    `Reaction roles ${scope} skipped due to missing permissions in guild ${guildId || 'unknown'}. Needed: Manage Roles, Read Message History, Add Reactions, View Channel.`,
    error.message,
  );
}

function getEmojiKeyFromReaction(emoji) {
  if (!emoji) return '';
  if (emoji.id) return `id:${emoji.id}`;
  if (emoji.name) return normalizeEmojiKey(`unicode:${emoji.name}`);
  return '';
}

async function ensureReactionLoaded(reaction) {
  if (reaction.partial) {
    await reaction.fetch();
  }

  const { message } = reaction;
  if (!message) return null;

  if (message.partial) {
    await message.fetch();
  }

  return message;
}

async function applyRoleFromReaction(reaction, user, removeRole) {
  if (!user || user.bot) return;

  const message = await ensureReactionLoaded(reaction);
  if (!message || !message.inGuild()) return;

  const guildId = message.guildId;
  if (!guildId) return;

  const cfg = getGuildConfig(guildId);
  if (!cfg || !cfg.enabled) return;

  const configuredMessageId = String(cfg.reactionRoleMessageId || '').trim();
  if (!configuredMessageId || configuredMessageId !== message.id) {
    logger.debug(`Reaction roles: skipped message ${message.id} in guild ${guildId}; configured message is ${configuredMessageId || 'none'}.`);
    return;
  }

  const assignments = Array.isArray(cfg.reactionRoleAssignments) ? cfg.reactionRoleAssignments : [];
  if (assignments.length === 0) {
    logger.debug(`Reaction roles: no assignments configured for guild ${guildId}.`);
    return;
  }

  const emojiKey = normalizeEmojiKey(getEmojiKeyFromReaction(reaction.emoji));
  if (!emojiKey) return;

  const assignment = assignments.find((item) => item && normalizeEmojiKey(item.emojiKey) === emojiKey && item.roleId);
  if (!assignment) {
    logger.debug(`Reaction roles: no matching assignment for ${emojiKey} in guild ${guildId}.`);
    return;
  }

  let member;
  try {
    member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id);
  } catch (error) {
    logger.warn(`Reaction roles: failed to fetch member ${user.id} in guild ${guildId}.`, error.message);
    return;
  }

  if (!member) return;

  try {
    if (removeRole) {
      if (member.roles.cache.has(assignment.roleId)) {
        await member.roles.remove(assignment.roleId, 'Reaction role removed');
        logger.info(`Reaction roles: removed role ${assignment.roleId} from ${user.id} in guild ${guildId}.`);
      }
    } else if (!member.roles.cache.has(assignment.roleId)) {
      await member.roles.add(assignment.roleId, 'Reaction role assigned');
      logger.info(`Reaction roles: added role ${assignment.roleId} to ${user.id} in guild ${guildId}.`);
    }
  } catch (error) {
    if (isMissingPermissionError(error)) {
      warnMissingPermissions(removeRole ? 'remove role' : 'add role', error, guildId);
      return;
    }
    logger.warn(`Reaction roles: failed to ${removeRole ? 'remove' : 'add'} role ${assignment.roleId} for ${user.id}.`, error.message);
  }
}

async function handleReactionRoleAdd(reaction, user) {
  try {
    await applyRoleFromReaction(reaction, user, false);
  } catch (error) {
    if (isUnknownMessageError(error)) return;
    if (isMissingPermissionError(error)) {
      warnMissingPermissions('reaction add', error, reaction?.message?.guildId);
      return;
    }
    logger.error('Reaction roles: failed during add event.', error.message);
  }
}

async function handleReactionRoleRemove(reaction, user) {
  try {
    await applyRoleFromReaction(reaction, user, true);
  } catch (error) {
    if (isUnknownMessageError(error)) return;
    if (isMissingPermissionError(error)) {
      warnMissingPermissions('reaction remove', error, reaction?.message?.guildId);
      return;
    }
    logger.error('Reaction roles: failed during remove event.', error.message);
  }
}

module.exports = {
  getEmojiKeyFromReaction,
  handleReactionRoleAdd,
  handleReactionRoleRemove,
};
