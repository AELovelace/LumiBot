const { config } = require('./config');
const { logger } = require('./logger');

const SOUNDCLOUD_API_BASE = 'https://api.soundcloud.com';
const SOUNDCLOUD_OAUTH_URL = 'https://secure.soundcloud.com/oauth/token';
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

const tokenState = {
  accessToken: null,
  refreshToken: null,
  expiresAtMs: 0,
  inFlightTokenPromise: null,
};

let missingCredentialsLogged = false;

function hasSoundCloudCredentials() {
  return Boolean(config.soundcloudClientId && config.soundcloudClientSecret);
}

function cacheTokenPayload(tokenPayload) {
  if (!tokenPayload?.access_token) {
    throw new Error('OAuth response missing access_token.');
  }

  const expiresInSeconds = Number.parseInt(tokenPayload.expires_in, 10);
  const expiresInMs = Number.isNaN(expiresInSeconds) || expiresInSeconds <= 0
    ? 3_600_000
    : expiresInSeconds * 1_000;

  tokenState.accessToken = tokenPayload.access_token;
  tokenState.refreshToken = tokenPayload.refresh_token || tokenState.refreshToken;
  tokenState.expiresAtMs = Date.now() + expiresInMs;
}

function isAccessTokenUsable() {
  return Boolean(
    tokenState.accessToken
    && (Date.now() + TOKEN_EXPIRY_SKEW_MS) < tokenState.expiresAtMs,
  );
}

function buildBasicAuthHeader() {
  const encodedCredentials = Buffer
    .from(`${config.soundcloudClientId}:${config.soundcloudClientSecret}`)
    .toString('base64');

  return `Basic ${encodedCredentials}`;
}

async function requestTokenWithClientCredentials() {
  const response = await fetch(SOUNDCLOUD_OAUTH_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json; charset=utf-8',
      'content-type': 'application/x-www-form-urlencoded',
      authorization: buildBasicAuthHeader(),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} during client_credentials token exchange.`);
  }

  return response.json();
}

async function requestTokenWithRefreshToken() {
  const response = await fetch(SOUNDCLOUD_OAUTH_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json; charset=utf-8',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.soundcloudClientId,
      client_secret: config.soundcloudClientSecret,
      refresh_token: tokenState.refreshToken,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while refreshing SoundCloud token.`);
  }

  return response.json();
}

async function getAccessToken() {
  if (!hasSoundCloudCredentials()) {
    if (!missingCredentialsLogged) {
      logger.warn('SoundCloud search: SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET are required.');
      missingCredentialsLogged = true;
    }
    return null;
  }

  if (isAccessTokenUsable()) {
    return tokenState.accessToken;
  }

  if (tokenState.inFlightTokenPromise) {
    return tokenState.inFlightTokenPromise;
  }

  tokenState.inFlightTokenPromise = (async () => {
    if (tokenState.refreshToken) {
      try {
        const refreshedPayload = await requestTokenWithRefreshToken();
        cacheTokenPayload(refreshedPayload);
        return tokenState.accessToken;
      } catch (error) {
        logger.warn(`SoundCloud auth: refresh token exchange failed. ${error.message}`);
      }
    }

    const tokenPayload = await requestTokenWithClientCredentials();
    cacheTokenPayload(tokenPayload);
    return tokenState.accessToken;
  })()
    .catch((error) => {
      logger.warn(`SoundCloud auth: token exchange failed. ${error.message}`);
      tokenState.accessToken = null;
      tokenState.expiresAtMs = 0;
      return null;
    })
    .finally(() => {
      tokenState.inFlightTokenPromise = null;
    });

  return tokenState.inFlightTokenPromise;
}

async function runTrackSearch(query, accessToken) {
  const url = `${SOUNDCLOUD_API_BASE}/tracks?q=${encodeURIComponent(query)}&limit=1&access=playable`;

  return fetch(url, {
    headers: {
      accept: 'application/json; charset=utf-8',
      authorization: `OAuth ${accessToken}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Search SoundCloud for the first track matching `query`.
 *
 * Returns { title, artist, url, artworkUrl } on success, or null if no
 * results are found or any error occurs.
 *
 * @param {string} query
 * @returns {Promise<{ title: string, artist: string, url: string, artworkUrl: string | null } | null>}
 */
async function searchSoundCloud(query) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    return null;
  }

  let accessToken = await getAccessToken();
  if (!accessToken) {
    return null;
  }

  let response;
  try {
    response = await runTrackSearch(trimmedQuery, accessToken);
  } catch (error) {
    logger.warn(`SoundCloud search: fetch failed. ${error.message}`);
    return null;
  }

  if (response.status === 401) {
    tokenState.accessToken = null;
    tokenState.expiresAtMs = 0;

    accessToken = await getAccessToken();
    if (!accessToken) {
      return null;
    }

    try {
      response = await runTrackSearch(trimmedQuery, accessToken);
    } catch (error) {
      logger.warn(`SoundCloud search: retry fetch failed. ${error.message}`);
      return null;
    }
  }

  if (!response.ok) {
    logger.warn(`SoundCloud search: HTTP ${response.status} for query "${trimmedQuery}"`);
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    logger.warn(`SoundCloud search: failed to parse response JSON. ${error.message}`);
    return null;
  }

  const collection = Array.isArray(data)
    ? data
    : Array.isArray(data?.collection)
      ? data.collection
      : [];

  const track = collection[0];
  if (!track) {
    logger.debug(`SoundCloud search: no results for "${trimmedQuery}"`);
    return null;
  }

  return {
    title: track.title ?? trimmedQuery,
    artist: track.user?.username ?? 'Unknown Artist',
    url: track.permalink_url,
    artworkUrl: track.artwork_url ?? null,
  };
}

module.exports = { searchSoundCloud };
