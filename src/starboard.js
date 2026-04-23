const { EmbedBuilder } = require('discord.js');

const { config, getChatbotPersona } = require('./config');
const { logger } = require('./logger');
const { awardStarboardCoins } = require('./sadgirlEconomyStore');
const { matchPayout } = require('./bigBusiness');
const { getGuildConfig } = require('./guildConfig');

const STARBOARD_SOURCE_PREFIX = 'source:';
const STARBOARD_SCAN_LIMIT = 100;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_ATTACHMENT_LINKS = 5;
const MAX_EMBED_FIELD_LENGTH = 1_024;
const UNKNOWN_MESSAGE_ERROR_CODE = 10_008;
const MISSING_ACCESS_ERROR_CODE = 50_001;
const MISSING_PERMISSIONS_ERROR_CODE = 50_013;
const PERMISSION_WARNING_COOLDOWN_MS = 60_000;

const STARBOARD_LLM_ENDPOINT = 'http://100.83.3.32:11434';
const STARBOARD_LLM_MODEL = 'server-2';
const STARBOARD_LLM_TIMEOUT_MS = 20_000;

const sourceToStarboardMessageId = new Map();
const processingSourceKeys = new Set();
const permissionWarningTimestamps = new Map();
/** Tracks the last star count we paid out for each source key */
const sourcePaidStars = new Map();
/** Tracks source keys that already received an LLM commentary */
const commentaryPosted = new Set();

// ---------------------------------------------------------------------------
// LLM starboard commentary
// ---------------------------------------------------------------------------

function stripThinkingTags(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .replace(/<\/?think>/giu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Generate a short LLM commentary about a starred message.
 * Lumi reacts to the content that just got starboarded.
 */
async function generateStarboardCommentary(author, messageContent, starCount, guildName) {
  const snippet = (messageContent || '').slice(0, 500).trim() || '[image / attachment]';

  const prompt = [
    `System: ${getChatbotPersona()}`,
    `System: A message just hit the starboard in ${guildName}. You are reacting to it in a short, casual way — like you just saw it pinned and want to comment. Keep it to 1-2 sentences. Be genuine, funny, or snarky as fits the content. Never use emojis. Do not use think tags or reasoning.`,
    `${author} posted this and it got ${starCount} stars:`,
    `"${snippet}"`,
    'Your reaction:',
  ].join('\n\n');

  try {
    const response = await fetch(`${STARBOARD_LLM_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: STARBOARD_LLM_MODEL,
        stream: false,
        prompt,
      }),
      signal: AbortSignal.timeout(STARBOARD_LLM_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const completion = typeof payload.response === 'string' ? payload.response : '';
    const cleaned = stripThinkingTags(completion);
    if (cleaned) return cleaned;
  } catch (error) {
    logger.warn('Starboard LLM commentary failed.', error.message);
  }

  return null; // no fallback — just skip if LLM fails
}

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

function warnMissingPermissions(scope, error, channelId) {
  const now = Date.now();
  const warningKey = `${scope}:${channelId || 'unknown'}`;
  const lastWarningAt = permissionWarningTimestamps.get(warningKey) || 0;

  if (now - lastWarningAt < PERMISSION_WARNING_COOLDOWN_MS) {
    return;
  }

  permissionWarningTimestamps.set(warningKey, now);
  logger.warn(
    `Starboard ${scope} skipped due to missing permissions. Check channel ${channelId || 'unknown'} permissions: View Channel, Send Messages, Embed Links (and Read Message History for restart lookup).`,
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

function isStarEmoji(emoji, emojiName) {
  if (!emoji?.name) {
    return false;
  }

  const configured = (emojiName || config.starboardEmojiName || '').trim();
  const configuredLower = configured.toLowerCase();
  const normalizedName = emoji.name.toLowerCase();

  if (emoji.id) {
    // Custom guild emoji — match by name (case-insensitive)
    return normalizedName === configuredLower;
  }

  // Unicode emoji — emoji.name IS the literal character (e.g. "⭐", "😭").
  // Match against the configured value as a raw character, OR fall back to
  // the legacy "star" shortcode for backwards compatibility.
  if (emoji.name === configured) return true;
  if (configuredLower === 'star' && emoji.name === '⭐') return true;
  return false;
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

function countStarReactions(message, emojiName) {
  let totalStars = 0;

  for (const messageReaction of message.reactions.cache.values()) {
    if (!isStarEmoji(messageReaction.emoji, emojiName)) {
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

async function fetchStarboardChannel(client, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || typeof channel.send !== 'function' || !channel.messages) {
    return null;
  }

  return channel;
}

async function processStarboardReaction(reaction) {
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

  // Look up per-guild config — if no config, this guild is not tracked
  const guildCfg = getGuildConfig(message.guildId);
  if (!guildCfg || !guildCfg.enabled || !guildCfg.starboardChannelId) {
    return;
  }

  if (!isStarEmoji(reaction.emoji, guildCfg.starboardEmojiName)) {
    return;
  }

  if (message.channelId === guildCfg.starboardChannelId) {
    return;
  }

  const sourceKey = buildSourceKey(message);
  if (processingSourceKeys.has(sourceKey)) {
    return;
  }

  processingSourceKeys.add(sourceKey);
  try {
    const starCount = countStarReactions(message, guildCfg.starboardEmojiName);

    let starboardChannel;
    try {
      starboardChannel = await fetchStarboardChannel(reaction.client, guildCfg.starboardChannelId);
    } catch (error) {
      if (isMissingPermissionError(error)) {
        warnMissingPermissions('channel fetch', error, guildCfg.starboardChannelId);
        return;
      }

      throw error;
    }

    if (!starboardChannel) {
      logger.warn(`Starboard channel ${guildCfg.starboardChannelId} not found or not text-based (guild ${message.guildId}).`);
      return;
    }

    const existingStarboardMessageId = await findExistingStarboardMessage(starboardChannel, sourceKey);
    if (!existingStarboardMessageId && starCount < guildCfg.starboardMinStars) {
      return;
    }

    const payload = buildStarboardPayload(message, starCount, sourceKey);
    if (existingStarboardMessageId) {
      try {
        await starboardChannel.messages.edit(existingStarboardMessageId, payload);
        sourceToStarboardMessageId.set(sourceKey, existingStarboardMessageId);
      } catch (error) {
        if (isUnknownMessageError(error)) {
          sourceToStarboardMessageId.delete(sourceKey);
        } else if (isMissingPermissionError(error)) {
          warnMissingPermissions('message edit', error, guildCfg.starboardChannelId);
          return;
        } else {
          throw error;
        }
      }
    } else if (starCount >= guildCfg.starboardMinStars) {
      let created;
      try {
        created = await starboardChannel.send(payload);
      } catch (error) {
        if (isMissingPermissionError(error)) {
          warnMissingPermissions('message send', error, guildCfg.starboardChannelId);
          return;
        }

        throw error;
      }

      sourceToStarboardMessageId.set(sourceKey, created.id);
      logger.info(`Starboard post created for message ${sourceKey}.`);

      // Post LLM commentary in the guild's Big Business channel
      if (!commentaryPosted.has(sourceKey) && guildCfg.bigBusinessChannelId) {
        commentaryPosted.add(sourceKey);
        void (async () => {
          try {
            const guildName = guildCfg.guildName || 'the server';
            const commentary = await generateStarboardCommentary(
              message.author?.username || 'someone',
              message.content || '',
              starCount,
              guildName,
            );
            if (commentary) {
              const bizChannel = await reaction.client.channels.fetch(guildCfg.bigBusinessChannelId).catch(() => null);
              if (bizChannel) {
                await bizChannel.send(`⭐ **Starboard Hit** — ${message.author?.username || 'someone'} just got ${starCount} star(s)\n> ${commentary}`);
                logger.info(`Starboard commentary posted to business channel for ${sourceKey}.`);
              }
            }
          } catch (err) {
            logger.warn('Starboard: failed to post LLM commentary to business channel.', err.message);
          }
        })();
      }
    }

    // Award SGC for stars (1 coin per new star since last payout)
    if (starCount >= guildCfg.starboardMinStars && message.author && !message.author.bot) {
      try {
        const previouslyPaid = sourcePaidStars.get(sourceKey) || 0;
        const newStars = starCount - previouslyPaid;
        if (newStars > 0) {
          const awarded = awardStarboardCoins(
            message.author.id,
            message.author.username,
            newStars,
          );
          if (awarded > 0) {
            sourcePaidStars.set(sourceKey, starCount);
            logger.info(`Starboard: awarded ${awarded} SGC to ${message.author.username} for ${newStars} new star(s) on ${sourceKey}.`);
            void matchPayout(message.author.username, awarded, 'starboard', message.guildId);
          }
        }
      } catch (error) {
        logger.warn('Failed to award starboard coins.', error.message);
      }
    }
  } finally {
    processingSourceKeys.delete(sourceKey);
  }
}

async function handleMessageReactionAdd(reaction) {
  try {
    await processStarboardReaction(reaction);
  } catch (error) {
    if (isMissingPermissionError(error)) {
      warnMissingPermissions('reaction add', error, 'unknown');
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
      warnMissingPermissions('reaction remove', error, 'unknown');
      return;
    }

    logger.error('Failed to process starboard reaction remove event.', error.message);
  }
}

module.exports = {
  handleMessageReactionAdd,
  handleMessageReactionRemove,
};
