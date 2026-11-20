'use strict';

/**
 * Lumi games: serves public/lumi/** at /lumipet/static/**.
 * Safe by construction: the path is decoded once, any '..' / '.' / empty / backslash / NUL segment is refused,
 * only allowlisted file types are served, and the resolved file must still be inside public/lumi.
 * Caching: a URL carrying ?v=<version> (pages.js adds it) is cached for a year; anything else for an hour.
 */

const fs = require('node:fs');
const path = require('node:path');
const { SECURITY_HEADERS } = require('./router');

const ROOT = path.resolve(__dirname, '..', '..', 'public', 'lumi');   // the only folder ever served
const TYPES = {                                                        // allowlisted extensions -> content types
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const versions = new Map();                                            // rel path -> version string (mtime based)

// A JSON 404 with the safety headers.
function notFound(res) {
  if (res.headersSent) return;                                         // already answered
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v); // safety headers
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); // not found
  res.end(JSON.stringify({ error: 'Not found.', detail: 'Not found.', code: 'not_found' })); // same shape as API errors
}

/**
 * Turn the part after /static/ into an absolute file path, or null when it isn't allowed.
 * @param {string} rawRel  e.g. 'lumi-pet/game.js' (still %-encoded)
 */
function resolveSafe(rawRel) {
  let rel;                                                             // decoded path
  try { rel = decodeURIComponent(String(rawRel || '')); } catch { return null; } // broken %-escape
  if (!rel || rel.includes('\0') || rel.includes('\\')) return null;   // NUL or backslash: refuse
  const segs = rel.split('/');                                         // path pieces
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null; // no traversal, no hidden files
  const ext = path.extname(rel).toLowerCase();                         // file type
  if (!Object.prototype.hasOwnProperty.call(TYPES, ext)) return null;  // not on the allowlist
  const abs = path.resolve(ROOT, ...segs);                             // the real path
  if (!abs.startsWith(ROOT + path.sep)) return null;                   // escaped the root somehow: refuse
  return { abs, ext, rel };                                            // safe
}

/**
 * Serve one static file. rel: the URL path after '/static/' (e.g. 'common.js'). Always answers (404 when refused).
 */
function serveStatic(req, res, rel, url) {
  const method = String(req.method || 'GET').toUpperCase();            // GET or HEAD only
  if (method !== 'GET' && method !== 'HEAD') return notFound(res);     // nothing else
  const file = resolveSafe(rel);                                       // checked path
  if (!file) return notFound(res);                                     // refused
  let stat;                                                            // file info
  try { stat = fs.statSync(file.abs); } catch { return notFound(res); } // missing
  if (!stat.isFile()) return notFound(res);                            // a folder
  const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`; // cheap validator
  const versioned = Boolean(url && url.searchParams.has('v'));         // ?v= from pages.js
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v); // safety headers
  res.setHeader('cache-control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'); // long for versioned assets
  res.setHeader('etag', etag);                                         // for revalidation
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return undefined; } // unchanged
  res.writeHead(200, { 'content-type': TYPES[file.ext], 'content-length': stat.size }); // headers
  if (method === 'HEAD') { res.end(); return undefined; }             // no body for HEAD
  const stream = fs.createReadStream(file.abs);                        // stream the file
  stream.on('error', () => { try { res.destroy(); } catch { /* gone */ } }); // a read error drops the socket
  stream.pipe(res);                                                    // send it
  return undefined;                                                    // done
}

/** A version token for a static file (its mtime), so URLs change whenever the file does. */
function version(rel) {
  if (versions.has(rel)) return versions.get(rel);                     // cached
  let v = '0';                                                         // unknown file
  try { v = Math.floor(fs.statSync(path.join(ROOT, rel)).mtimeMs).toString(36); } catch { /* missing: '0' */ } // mtime
  versions.set(rel, v);                                                // cache it (restart picks up new files)
  return v;                                                            // e.g. 'lq3k9x2'
}

/** Does this static file exist? (pages.js warns about script lists that point at nothing.) */
function exists(rel) {
  const file = resolveSafe(rel);                                       // same rules as serving
  try { return Boolean(file) && fs.statSync(file.abs).isFile(); } catch { return false; } // present?
}

module.exports = {
  ROOT,          // absolute path of public/lumi
  TYPES,         // the extension allowlist
  serveStatic,   // serve one file
  resolveSafe,   // path checker (tests)
  version,       // cache-busting token
  exists,        // file present?
};
