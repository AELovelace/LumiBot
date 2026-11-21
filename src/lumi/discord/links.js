'use strict';

/**
 * Lumi-Town on Discord: full web addresses for link buttons and embed pictures.
 *
 * Discord needs absolute http(s) URLs. The public base is, in order:
 *   1. LUMI_PUBLIC_URL                         e.g. https://sadgirlsclub.wtf/lumipet
 *   2. the origin of LUMI_DISCORD_OAUTH_REDIRECT_URI + the Lumi base path
 *      (production: https://sadgirlsclub.wtf/lumipet/auth/discord/callback -> https://sadgirlsclub.wtf/lumipet)
 *   3. none: then cards simply have no link button and no picture (they still work)
 */

/** The Lumi base path ('/lumipet'), the same rule auth.js uses. */
function basePath() {
  const raw = String(process.env.LUMI_WEB_BASE_PATH || '/lumipet').trim();            // env or default
  const clean = `/${raw.replace(/^\/+|\/+$/gu, '')}`;                                  // exactly one leading slash, none trailing
  return clean === '/' ? '/lumipet' : clean;                                           // never the site root
}

/** Is this an absolute http(s) URL? Returns the parsed URL or null. */
function parseHttp(text) {
  try {
    const url = new URL(String(text || '').trim());                                    // parse
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;         // only web links
  } catch {
    return null;                                                                       // not a URL
  }
}

/** 'https://sadgirlsclub.wtf/lumipet' (no trailing slash), or null when it can't be worked out. */
function publicBase() {
  const explicit = parseHttp(process.env.LUMI_PUBLIC_URL);                             // 1. set directly
  if (explicit) return `${explicit.origin}${explicit.pathname.replace(/\/+$/u, '')}`;  // as given, minus a trailing slash
  const callback = parseHttp(process.env.LUMI_DISCORD_OAUTH_REDIRECT_URI);            // 2. from the OAuth callback
  if (callback) return `${callback.origin}${basePath()}`;                              // same host, Lumi's path
  return null;                                                                         // 3. unknown
}

/** A full URL under Lumi: page('lumi-pet') -> 'https://…/lumipet/lumi-pet' (null if there is no public base). */
function page(slug = '') {
  const base = publicBase();                                                           // where Lumi lives
  return base ? `${base}/${String(slug).replace(/^\/+/u, '')}` : null;                 // joined
}

/** A full URL for a static file: staticFile('icons/lumi-192.png') (null if there is no public base). */
function staticFile(rel) {
  const base = publicBase();                                                           // where Lumi lives
  return base ? `${base}/static/${String(rel).replace(/^\/+/u, '')}` : null;           // joined
}

module.exports = {
  publicBase,     // 'https://…/lumipet' or null
  page,           // a page URL
  staticFile,     // a static file URL
  basePath,       // '/lumipet'
};
