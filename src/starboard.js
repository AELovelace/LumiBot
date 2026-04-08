const { EmbedBuilder } = require('discord.js');

const { config } = require('./config');
const { logger } = require('./logger');

const STARBOARD_SOURCE_PREFIX = 'source:';
const STARBOARD_SCAN_LIMIT = 100;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_ATTACHMENT_LINKS = 5;
const MAX_EMBED_FIELD_LENGTH = 1_024;
const UNKNOWN_MESSAGE_ERROR_CODE = 10_008;
const MISSING_ACCESS_ERROR_CODE = 50_001;
const MISSING_PERMISSIONS_ERROR_CODE = 50_013;
const PERMISSION_WARNING_COOLDOWN_MS = 60_000;

const sourceToStarboardMessageId = new Map();
const processingSourceKeys = new Set();
const permissionWarningTimestamps = new Map();

function isMissingPermissionError(error) {
  if (!error) {
    return false;
  }

  if (error.code === MISSING_ACCESS_ERROR_CODE || error.code === MISSING_PERMISSIONS_ERROR_CODE) {
    return true;
  }

  const normalizedMessage = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return normalizedMessage.includes('missing permissions') || normalizedMessage.includes('missing access');
}

function isUnknownMessageError(error) {
  return Boolean(error && error.code === UNKNOWN_MESSAGE_ERROR_CODE);
}

function warnMissingPermissions(scope, error) {
  const now = Date.now();
  const warningKey = `${scope}:${config.starboardChannelId}`;
  const lastWarningAt = permissionWarningTimestamps.get(warningKey) || 0;

  if (now - lastWarningAt < PERMISSION_WARNING_COOLDOWN_MS) {
    return;
  }

  permissionWarningTimestamps.set(warningKey, now);
  logger.warn(
    `Starboard ${scope} skipped due to missing permissions. Check channel ${config.starboardChannelId} permissions: View Channel, Send Messages, Embed Links (and Read Message History for restart lookup).`,
    error.message,
  );
}

function truncate(value, limit) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function isImageAttachment(attachment) {
  if (attachment.contentType?.startsWith('image/')) {
    return true;
  }

  return /\.(png|jpe?g|gif|webp|bmp|tiff?)$/iu.test(attachment.url);
}

function isStarEmoji(emoji) {
  if (!emoji?.name) {
    return false;
  }

  const normalizedName = emoji.name.toLowerCase();
  const configuredName = config.starboardEmojiName.toLowerCase();
  if (emoji.id) {
    return normalizedName === configuredName;
  }

  return emoji.name === '⭐' || normalizedName === configuredName;
}

function buildSourceKey(message) {
  return `${message.guildId}:${message.channelId}:${message.id}`;
}

function getSourceKeyFromStarboardMessage(message) {
  const footerText = message.embeds?.[0]?.footer?.text;
  if (!footerText) {
    return null;
  }

  const markerIndex = footerText.indexOf(STARBOARD_SOURCE_PREFIX);
  if (markerIndex < 0) {
    return null;
  }

  return footerText.slice(markerIndex + STARBOARD_SOURCE_PREFIX.length).trim() || null;
}

function countStarReactions(message) {
  let totalStars = 0;

  for (const messageReaction of message.reactions.cache.values()) {
    if (!isStarEmoji(messageReaction.emoji)) {
      continue;
    }

    totalStars += messageReaction.count || 0;
  }

  return totalStars;
}

function buildAttachmentLinks(message) {
  const attachments = Array.from(message.attachments.values());
  if (attachments.length === 0) {
    return null;
  }

  const links = attachments
    .slice(0, MAX_ATTACHMENT_LINKS)
    .map((attachment, index) => `[Attachment ${index + 1}](${attachment.url})`);

  if (attachments.length > MAX_ATTACHMENT_LINKS) {
    links.push(`...and ${attachments.length - MAX_ATTACHMENT_LINKS} more`);
  }

  return truncate(links.join('\n'), MAX_EMBED_FIELD_LENGTH);
}

function buildStarboardPayload(message, starCount, sourceKey) {
  const content = message.content?.trim()
    ? truncate(message.content.trim(), MAX_DESCRIPTION_LENGTH)
    : '*No text content*';

  const embed = new EmbedBuilder()
    .setAuthor({
      name: message.author.tag,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(content)
    .addFields({
      name: 'Source',
      value: `<#${message.channelId}> • [Jump to message](${message.url})`,
    })
    .setTimestamp(message.createdTimestamp)
    .setFooter({ text: `⭐ ${starCount} • ${STARBOARD_SOURCE_PREFIX}${sourceKey}` });

  const attachmentLinks = buildAttachmentLinks(message);
  if (attachmentLinks) {
    embed.addFields({
      name: 'Attachments',
      value: attachmentLinks,
    });
  }

  const imageAttachment = Array.from(message.attachments.values()).find(isImageAttachment);
  if (imageAttachment) {
    embed.setImage(imageAttachment.url);
  }

  return {
    content: `⭐ **${starCount}** in <#${message.channelId}>`,
    embeds: [embed],
  };
}

async function findExistingStarboardMessage(starboardChannel, sourceKey) {
  const cachedStarboardId = sourceToStarboardMessageId.get(sourceKey);
  if (cachedStarboardId) {
    return cachedStarboardId;
  }

  let recentMessages;
  try {
    recentMessages = await starboardChannel.messages.fetch({ limit: STARBOARD_SCAN_LIMIT });
  } catch (error) {
    if (isMissingPermissionError(error)) {
      warnMissingPermissions('history lookup', error);
      return null;
    }

    throw error;
  }

  for (const candidate of recentMessages.values()) {
    const candidateSourceKey = getSourceKeyFromStarboardMessage(candidate);
    if (candidateSourceKey !== sourceKey) {
      continue;
    }

    sourceToStarboardMessageId.set(sourceKey, candidate.id);
    return candidate.id;
  }

  return null;
}

async function fetchStarboardChannel(client) {
  if (!config.starboardChannelId) {
    return null;
  }

  const channel = await client.channels.fetch(config.starboardChannelId);
  if (!channel?.isTextBased() || typeof channel.send !== 'function' || !channel.messages) {
    return null;
  }

  return channel;
}

async function processStarboardReaction(reaction) {
  if (!config.starboardChannelId) {
    return;
  }

  if (!isStarEmoji(reaction.emoji)) {
    return;
  }

  if (reaction.partial) {
    await reaction.fetch();
  }

  const { message } = reaction;
  if (!message) {
    return;
  }

  if (message.partial) {
    await message.fetch();
  }

  if (!message.inGuild()) {
    return;
  }

  if (config.allowedGuildId && message.guildId !== config.allowedGuildId) {
    return;
  }

  if (message.channelId === config.starboardChannelId) {
    return;
  }

  const sourceKey = buildSourceKey(message);
  if (processingSourceKeys.has(sourceKey)) {
    return;
  }

  processingSourceKeys.add(sourceKey);
  try {
    const starCount = countStarReactions(message);

    let starboardChannel;
    try {
      starboardChannel = await fetchStarboardChannel(reaction.client);
    } catch (error) {
      if (isMissingPermissionError(error)) {
        warnMissingPermissions('channel fetch', error);
        return;
      }

      throw error;
    }

    if (!starboardChannel) {
      logger.warn(`Starboard channel ${config.starboardChannelId} not found or not text-based.`);
      return;
    }

    const existingStarboardMessageId = await findExistingStarboardMessage(starboardChannel, sourceKey);
    if (!existingStarboardMessageId && starCount < config.starboardMinStars) {
      return;
    }

    const payload = buildStarboardPayload(message, starCount, sourceKey);
    if (existingStarboardMessageId) {
      try {
        await starboardChannel.messages.edit(existingStarboardMessageId, payload);
        sourceToStarboardMessageId.set(sourceKey, existingStarboardMessageId);
        return;
      } catch (error) {
        if (isUnknownMessageError(error)) {
          sourceToStarboardMessageId.delete(sourceKey);
        } else if (isMissingPermissionError(error)) {
          warnMissingPermissions('message edit', error);
          return;
        } else {
          throw error;
        }
      }
    }

    if (starCount < config.starboardMinStars) {
      return;
    }

    let created;
    try {
      created = await starboardChannel.send(payload);
    } catch (error) {
      if (isMissingPermissionError(error)) {
        warnMissingPermissions('message send', error);
        return;
      }

      throw error;
    }

    sourceToStarboardMessageId.set(sourceKey, created.id);
    logger.info(`Starboard post created for message ${sourceKey}.`);
  } finally {
    processingSourceKeys.delete(sourceKey);
  }
}

async function handleMessageReactionAdd(reaction) {
  try {
    await processStarboardReaction(reaction);
  } catch (error) {
    if (isMissingPermissionError(error)) {
      warnMissingPermissions('reaction add', error);
      return;
    }

    logger.error('Failed to process starboard reaction add event.', error.message);
  }
}

async function handleMessageReactionRemove(reaction) {
  try {
    await processStarboardReaction(reaction);
  } catch (error) {
    if (isMissingPermissionError(error)) {
      warnMissingPermissions('reaction remove', error);
      return;
    }

    logger.error('Failed to process starboard reaction remove event.', error.message);
  }
}

module.exports = {
  handleMessageReactionAdd,
  handleMessageReactionRemove,
};
