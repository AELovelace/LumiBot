const { config } = require('./config');
const { logger } = require('./logger');

const DISCORD_MAX_CHARS = 2000;
let relayClient = null;

function setThoughtRelayClient(client) {
  relayClient = client;
}

function splitMessage(text, maxLen = DISCORD_MAX_CHARS) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }

  if (text.length <= maxLen) {
    return [text.trim()];
  }

  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    let splitPoint = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' '));
    if (splitPoint < maxLen / 2) {
      splitPoint = maxLen - 1;
    }

    chunks.push(remaining.slice(0, splitPoint + 1).trim());
    remaining = remaining.slice(splitPoint + 1).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function buildThoughtMessage(thoughtText, metadata = {}) {
  const headerParts = [];

  if (typeof metadata.kind === 'string' && metadata.kind.trim()) {
    headerParts.push(metadata.kind.trim());
  }

  if (typeof metadata.model === 'string' && metadata.model.trim()) {
    headerParts.push(`model=${metadata.model.trim()}`);
  }

  if (typeof metadata.endpoint === 'string' && metadata.endpoint.trim()) {
    headerParts.push(`endpoint=${metadata.endpoint.trim()}`);
  }

  const header = headerParts.length > 0 ? `[thought] ${headerParts.join(' | ')}` : '[thought]';
  return `${header}\n${thoughtText}`;
}

async function sendThoughtToChannel(channelId, thoughtText, metadata) {
  if (!relayClient || !channelId || !thoughtText) {
    return;
  }

  try {
    const channel = relayClient.channels.cache.get(channelId)
      || await relayClient.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      logger.warn(`Thought relay channel ${channelId} not found or not text-based.`);
      return;
    }

    const chunks = splitMessage(buildThoughtMessage(thoughtText, metadata));
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await channel.send({
        content: chunk,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    logger.warn(`Failed to relay stripped thoughts to channel ${channelId}.`, error.message);
  }
}

async function relayThoughtSegments(thoughtSegments, metadata = {}) {
  if (!relayClient || !Array.isArray(config.thoughtChannelIds) || config.thoughtChannelIds.length === 0) {
    return;
  }

  const segments = thoughtSegments
    .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
    .filter(Boolean);

  if (segments.length === 0) {
    return;
  }

  for (const channelId of config.thoughtChannelIds) {
    for (const segment of segments) {
      // eslint-disable-next-line no-await-in-loop
      await sendThoughtToChannel(channelId, segment, metadata);
    }
  }
}

module.exports = {
  relayThoughtSegments,
  setThoughtRelayClient,
};