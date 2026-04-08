const { config } = require('./config');
const { logger } = require('./logger');

function hasGiphyConfig() {
  return Boolean(config.chatbotGifEnabled && config.chatbotGifApiKey);
}

async function fetchGiphyGifUrl(query) {
  if (!hasGiphyConfig()) {
    return null;
  }

  if (typeof query !== 'string' || !query.trim()) {
    return null;
  }

  const params = new URLSearchParams({
    api_key: config.chatbotGifApiKey,
    s: query.trim(),
    rating: config.chatbotGifRating,
    lang: config.chatbotGifLanguage,
    bundle: 'messaging_non_clips',
  });

  try {
    const response = await fetch(`https://api.giphy.com/v1/gifs/translate?${params.toString()}`, {
      signal: AbortSignal.timeout(config.chatbotGifTimeoutMs),
    });

    if (!response.ok) {
      logger.warn(`Giphy request failed with HTTP ${response.status}.`);
      return null;
    }

    const payload = await response.json();
    const gifUrl = payload?.data?.url
      || payload?.data?.bitly_url
      || payload?.data?.images?.original?.url
      || null;

    if (!gifUrl) {
      return null;
    }

    return String(gifUrl).trim();
  } catch (error) {
    logger.warn('Failed to fetch GIF from Giphy.', error.message);
    return null;
  }
}

module.exports = {
  fetchGiphyGifUrl,
  hasGiphyConfig,
};
