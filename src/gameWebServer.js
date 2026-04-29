'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { URL } = require('node:url');

const { logger } = require('./logger');
const { ensureAccount } = require('./sadgirlEconomyStore');
const { manager } = require('./workers/workerManager');
const {
  handleLoginRoute,
  handleCallbackRoute,
  handleLogoutRoute,
  requireUserAuth,
  validateSameOrigin,
} = require('./webPanelAuth');

let GAME_WEB_PORT = Number(process.env.GAME_WEB_PORT) || 7172;
let GAME_WEB_HOST = process.env.GAME_WEB_HOST || '0.0.0.0';
const GAME_WEB_BASE_PATH = (process.env.GAME_WEB_BASE_PATH || '/games').replace(/\/+$/u, '');
let GAME_WEB_DISCORD_OAUTH_REDIRECT_URI =
  process.env.GAME_WEB_DISCORD_OAUTH_REDIRECT_URI?.trim()
  || process.env.WEB_APP_DISCORD_OAUTH_REDIRECT_URI?.trim()
  || process.env.DISCORD_OAUTH_REDIRECT_URI?.trim()
  || '';
const GAME_WEB_POSTMESSAGE_TARGET_ORIGIN =
  process.env.GAME_WEB_POSTMESSAGE_TARGET_ORIGIN?.trim()
  || process.env.WEB_APP_POSTMESSAGE_TARGET_ORIGIN?.trim()
  || '*';
const GAME_WEB_SESSION_SAMESITE =
  process.env.GAME_WEB_SESSION_SAMESITE?.trim()
  || process.env.WEB_APP_SESSION_SAMESITE?.trim()
  || 'None';
const GAME_WEB_SESSION_SECURE =
  String(process.env.GAME_WEB_SESSION_SECURE || process.env.WEB_APP_SESSION_SECURE || '').trim()
    ? ['1', 'true', 'yes', 'on'].includes(String(process.env.GAME_WEB_SESSION_SECURE || process.env.WEB_APP_SESSION_SECURE).trim().toLowerCase())
    : true;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'interest-cohort=(), browsing-topics=()',
  'cache-control': 'no-store',
};

let server = null;
let wsListenerInstalled = false;
const wsClients = new Set();
const wsSubscriptions = new Map();

function p(path) {
  return `${GAME_WEB_BASE_PATH}${path}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function applySecurityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}

function sendHtml(res, status, html) {
  if (res.headersSent || res.writableEnded) return;
  applySecurityHeaders(res);
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  applySecurityHeaders(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function parseUrl(req) {
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return new URL(req.url, `${proto}://${host}`);
}

function routePath(pathname) {
  if (!GAME_WEB_BASE_PATH) return pathname;
  if (pathname === GAME_WEB_BASE_PATH) return '/';
  if (pathname.startsWith(`${GAME_WEB_BASE_PATH}/`)) return pathname.slice(GAME_WEB_BASE_PATH.length);
  return null;
}

function readBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('payload_too_large'));
        try { req.destroy(); } catch { /* ignore */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body_not_object');
  }
  return parsed;
}

function renderLoginPage(nextPath = p('/')) {
  const loginHref = `${p('/auth/discord/login')}?mode=member&popup=1&next=${encodeURIComponent(nextPath)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumi Games Login</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Space+Mono:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(255,0,0,0.24), transparent 32%),
      radial-gradient(circle at bottom right, rgba(190,0,0,0.18), transparent 30%),
      #120607;
    color: #e7deea;
    display: grid;
    place-items: center;
    font-family: 'Space Mono', monospace;
  }
  .box {
    width: min(460px, calc(100vw - 24px));
    padding: 28px;
    border: 1px solid #ff0000;
    background: rgba(24, 8, 10, 0.96);
  }
  h1 { margin: 0 0 8px; font: 44px 'VT323', monospace; color: #ff0000; letter-spacing: 2px; }
  p { margin: 0 0 18px; color: #b9acbc; }
  .btn { width: 100%; padding: 14px 16px; background: #ff0000; color: #fff; border: 0; font: 24px 'VT323', monospace; cursor: pointer; }
</style>
</head>
<body>
  <main class="box">
    <h1>LUMI GAMES</h1>
    <p>Sign in with Discord to play the casino games in a dedicated interface.</p>
    <button class="btn" id="popup-login" type="button">Sign In With Discord</button>
  </main>
<script>
  const loginUrl = ${JSON.stringify(loginHref)};
  const appRoot = ${JSON.stringify(p('/'))};
  function beginPopupLogin() {
    const popup = window.open(loginUrl, 'lumigames_discord_login', 'popup=yes,width=520,height=760,resizable=yes,scrollbars=yes');
    if (!popup) {
      window.open(loginUrl, '_blank', 'noopener');
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await fetch(${JSON.stringify(p('/api/me'))}, { credentials: 'include' });
        if (res.ok) {
          clearInterval(timer);
          window.location.href = appRoot;
        }
      } catch {}
      if (popup.closed) clearInterval(timer);
    }, 1000);
  }
  window.addEventListener('message', async (event) => {
    if (${JSON.stringify(GAME_WEB_POSTMESSAGE_TARGET_ORIGIN)} !== '*' && event.origin !== ${JSON.stringify(GAME_WEB_POSTMESSAGE_TARGET_ORIGIN)}) return;
    if (event.data?.type !== 'lumigames-auth-complete') return;
    try {
      const res = await fetch(${JSON.stringify(p('/api/me'))}, { credentials: 'include' });
      if (res.ok) window.location.href = appRoot;
    } catch {}
  });
  document.getElementById('popup-login').addEventListener('click', beginPopupLogin);
</script>
</body>
</html>`;
}

function renderPage(title, session, body, { active = '', pageScripts = '' } = {}) {
  const nav = [
    ['/', 'Lobby'],
    ['/slots', 'Slots'],
    ['/blackjack', 'Blackjack'],
    ['/holdem', 'Holdem'],
    ['/horseracing', 'Horse Racing'],
    ['/pachinko', 'Pachinko'],
  ].map(([href, label]) => `<a class="${active === href ? 'active' : ''}" href="${p(href)}">${label}</a>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Space+Mono:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      linear-gradient(180deg, rgba(255,0,0,0.12), transparent 18%),
      linear-gradient(135deg, #0b0506, #1a0b0d 65%, #210709);
    color: #ebe4ef;
    font-family: 'Space Mono', monospace;
  }
  .wrap { width: min(980px, calc(100vw - 12px)); margin: 0 auto; padding: 6px 0 12px; }
  header {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
    margin-bottom: 8px; padding: 10px 12px; border: 1px solid #7a1010; background: rgba(24, 8, 10, 0.95);
  }
  h1 { margin: 0; font: 40px 'VT323', monospace; color: #ff0000; letter-spacing: 2px; }
  .subtitle { color: #a394a7; font-size: 12px; }
  nav { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  nav a { text-decoration: none; padding: 5px 8px; border: 1px solid #6f2525; color: #efe6f0; background: rgba(27, 10, 12, 0.9); font-size: 12px; line-height: 1.1; }
  nav a.active { border-color: #ff0000; color: #ff0000; }
  .card { padding: 10px 12px; border: 1px solid #572020; background: rgba(20, 8, 10, 0.94); margin-bottom: 8px; }
  .stack { display: grid; gap: 8px; }
  .slots-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .games-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .item { padding: 8px; border: 1px solid #3d1719; background: rgba(12, 5, 7, 0.86); }
  .board { white-space: pre-wrap; margin: 0; font-family: 'Space Mono', monospace; }
  h2 { margin: 0 0 6px; font: 24px 'VT323', monospace; color: #ff0000; line-height: 1; }
  .metric { font: 22px 'VT323', monospace; color: #fff; }
  .muted { color: #a394a7; font-size: 11px; line-height: 1.2; }
  button.primary, .pill {
    background: #ff0000; border: 0; color: #fff3f3; padding: 4px 8px; font: 16px 'VT323', monospace; line-height: 1; cursor: pointer;
  }
  .pill { display: inline-block; text-decoration: none; }
  input, textarea {
    width: 100%; padding: 5px 7px; margin: 0 0 6px; color: #f6f1f9; background: #16090b; border: 1px solid #7a1010; font: inherit; line-height: 1.1;
  }
  .flash { padding: 6px 8px; border: 1px solid #6f2525; background: rgba(42, 12, 16, 0.78); color: #fbeff0; margin-bottom: 6px; font-size: 12px; line-height: 1.2; }
  .flash.error { border-color: #ff4d4d; color: #ffe3e3; }
  .flash.success { border-color: #ff0000; color: #fff0f0; }
  .logout { background: transparent; border: 1px solid #6f2525; color: #efe6f0; padding: 8px 12px; font-family: inherit; cursor: pointer; }
  @media (max-width: 700px) {
    .wrap { width: calc(100vw - 8px); }
    .slots-grid { grid-template-columns: 1fr; }
    .games-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>LUMI GAMES</h1>
        <div class="subtitle">Dedicated casino interface</div>
      </div>
      <div>
        <div>${escapeHtml(session.username)}</div>
        <form method="POST" action="${p('/auth/logout')}"><button class="logout" type="submit">Logout</button></form>
      </div>
    </header>
    <nav>${nav}</nav>
    ${body}
  </div>
  ${pageScripts}
</body>
</html>`;
}

function generateLobbyId(prefix = 'slots') {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function getWebSlotsChannelId(lobbyId) {
  return `games:web:slots:${String(lobbyId)}`;
}

function getWebBlackjackChannelId(lobbyId) {
  return `games:web:blackjack:${String(lobbyId)}`;
}

function getWebHoldemChannelId(lobbyId) {
  return `games:web:holdem:${String(lobbyId)}`;
}

function getWebHorseracingChannelId(lobbyId) {
  return `games:web:horseracing:${String(lobbyId)}`;
}

function getWebPachinkoChannelId(sessionId) {
  return `games:web:pachinko:${String(sessionId)}`;
}

function serializeSlotsPayload(payload) {
  if (!payload || !payload.embed) return null;
  return {
    channelId: payload.channelId,
    title: payload.embed.title || 'Slots Lobby',
    description: payload.embed.description || '',
    footer: payload.embed.footer || '',
    players: Array.isArray(payload.embed.fields) ? payload.embed.fields.map((field) => ({
      name: field.name,
      value: field.value,
    })) : [],
  };
}

function parseLobbyIdFromChannelId(channelId) {
  return String(channelId || '').replace(/^games:web:slots:/u, '');
}

function parsePrefixedId(channelId, prefix) {
  return String(channelId || '').replace(new RegExp(`^games:web:${prefix}:`, 'u'), '');
}

function serializeSlotsLobbyList(result) {
  if (!result || !Array.isArray(result.lobbies)) return [];
  return result.lobbies.map((lobby) => ({
    lobbyId: parseLobbyIdFromChannelId(lobby.channelId),
    channelId: lobby.channelId,
    playerCount: Number(lobby.playerCount) || 0,
    maxPlayers: Number(lobby.maxPlayers) || 0,
    lastEvent: lobby.lastEvent || 'Pick a bet, then pull the lever.',
    players: Array.isArray(lobby.players) ? lobby.players.map((player) => ({
      username: player.username,
      bet: player.bet,
      spinning: Boolean(player.spinning),
      statusText: player.statusText || '',
    })) : [],
  }));
}

function serializeTextTables(result, prefix, fallbackMaxPlayers = null) {
  if (!result || !Array.isArray(result.tables)) return [];
  return result.tables.map((table) => ({
    lobbyId: parsePrefixedId(table.channelId, prefix),
    channelId: table.channelId,
    playerCount: Number(table.playerCount) || 0,
    maxPlayers: Number.isFinite(Number(table.maxPlayers)) ? Number(table.maxPlayers) : fallbackMaxPlayers,
    content: table.content || '',
    phase: table.phase || '',
    resolving: Boolean(table.resolving),
  }));
}

function serializeTextLobbies(result, prefix) {
  if (!result || !Array.isArray(result.lobbies)) return [];
  return result.lobbies.map((lobby) => ({
    lobbyId: parsePrefixedId(lobby.channelId, prefix),
    channelId: lobby.channelId,
    playerCount: Number(lobby.playerCount) || 0,
    content: lobby.content || '',
    phase: lobby.phase || '',
    raceNumber: Number(lobby.raceNumber) || 0,
    players: Array.isArray(lobby.players) ? lobby.players : [],
  }));
}

function normalizeHorseChoice(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(raw)) return raw;
  if (raw === '1') return 'A';
  if (raw === '2') return 'B';
  if (raw === '3') return 'C';
  if (raw === '4') return 'D';
  return null;
}

function buildWsFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const length = payload.length;
  if (length < 126) return Buffer.concat([Buffer.from([0x81, length]), payload]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(length, 6);
  return Buffer.concat([header, payload]);
}

function parseWsFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;
    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      const high = buffer.readUInt32BE(offset + 2);
      if (high !== 0) throw new Error('Large websocket frames are not supported');
      payloadLength = buffer.readUInt32BE(offset + 6);
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (offset + frameLength > buffer.length) break;
    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    let payload = buffer.subarray(payloadOffset, payloadOffset + payloadLength);
    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      const unmasked = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i += 1) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    messages.push({ opcode, payload: payload.toString('utf8') });
    offset += frameLength;
  }
  return { messages, remaining: buffer.subarray(offset) };
}

function sendWsJson(client, payload) {
  if (!client || client.socket.destroyed) return;
  try { client.socket.write(buildWsFrame(JSON.stringify(payload))); } catch {}
}

function subscribeClient(client, channel) {
  if (!channel) return;
  client.channels.add(channel);
  if (!wsSubscriptions.has(channel)) wsSubscriptions.set(channel, new Set());
  wsSubscriptions.get(channel).add(client);
}

function unsubscribeClient(client, channel) {
  if (!channel) return;
  client.channels.delete(channel);
  const bucket = wsSubscriptions.get(channel);
  if (!bucket) return;
  bucket.delete(client);
  if (bucket.size === 0) wsSubscriptions.delete(channel);
}

function removeWsClient(client) {
  wsClients.delete(client);
  for (const channel of [...client.channels]) unsubscribeClient(client, channel);
}

function broadcastToChannel(channel, payload) {
  const bucket = wsSubscriptions.get(channel);
  if (!bucket) return;
  for (const client of bucket) sendWsJson(client, payload);
}

function handleWsMessage(client, raw) {
  let message;
  try { message = JSON.parse(raw); } catch {
    sendWsJson(client, { type: 'error', message: 'Invalid JSON frame' });
    return;
  }
  if (message.type === 'ping') return sendWsJson(client, { type: 'pong', ts: Date.now() });
  if (message.type === 'subscribe') {
    subscribeClient(client, String(message.channel || ''));
    return sendWsJson(client, { type: 'subscribed', channel: String(message.channel || '') });
  }
  if (message.type === 'unsubscribe') {
    unsubscribeClient(client, String(message.channel || ''));
    return sendWsJson(client, { type: 'unsubscribed', channel: String(message.channel || '') });
  }
  sendWsJson(client, { type: 'error', message: 'Unknown websocket message type' });
}

function installWsBridge() {
  if (wsListenerInstalled) return;
  wsListenerInstalled = true;
  manager.onEngineEvent('slots', (evt) => {
    if (!evt || typeof evt.channelId !== 'string' || !evt.channelId.startsWith('games:web:slots:')) return;
    const lobbyId = evt.channelId.replace(/^games:web:slots:/u, '');
    if (evt.name === 'render') {
      broadcastToChannel(`slots:lobby:${lobbyId}`, { type: 'slots.render', lobbyId, state: serializeSlotsPayload(evt) });
      return;
    }
    if (evt.name === 'lobbyClosed') {
      broadcastToChannel(`slots:lobby:${lobbyId}`, { type: 'slots.closed', lobbyId, content: evt.content || 'Lobby closed' });
      return;
    }
    if (evt.name === 'spinComplete') {
      broadcastToChannel(`slots:lobby:${lobbyId}`, { type: 'slots.spinComplete', lobbyId, result: evt });
    }
  });
  manager.onEngineEvent('blackjack', (evt) => {
    if (!evt || typeof evt.channelId !== 'string' || !evt.channelId.startsWith('games:web:blackjack:')) return;
    const lobbyId = parsePrefixedId(evt.channelId, 'blackjack');
    if (evt.name === 'render') {
      broadcastToChannel(`blackjack:lobby:${lobbyId}`, { type: 'blackjack.render', lobbyId, state: { content: evt.content || '' } });
      return;
    }
    if (evt.name === 'tableClosed') {
      broadcastToChannel(`blackjack:lobby:${lobbyId}`, { type: 'blackjack.closed', lobbyId, content: evt.content || 'Table closed.' });
    }
  });
  manager.onEngineEvent('holdem', (evt) => {
    if (!evt || typeof evt.channelId !== 'string' || !evt.channelId.startsWith('games:web:holdem:')) return;
    const lobbyId = parsePrefixedId(evt.channelId, 'holdem');
    if (evt.name === 'render') {
      broadcastToChannel(`holdem:lobby:${lobbyId}`, { type: 'holdem.render', lobbyId, state: { content: evt.content || '' } });
      return;
    }
    if (evt.name === 'tableClosed') {
      broadcastToChannel(`holdem:lobby:${lobbyId}`, { type: 'holdem.closed', lobbyId, content: evt.content || 'Table closed.' });
    }
  });
  manager.onEngineEvent('horseracing', (evt) => {
    if (!evt || typeof evt.channelId !== 'string' || !evt.channelId.startsWith('games:web:horseracing:')) return;
    const lobbyId = parsePrefixedId(evt.channelId, 'horseracing');
    if (['bettingOpen', 'bettingUpdate', 'bettingClosed', 'raceStart', 'raceFrame', 'raceFinished'].includes(evt.name)) {
      broadcastToChannel(`horseracing:lobby:${lobbyId}`, { type: `horseracing.${evt.name}`, lobbyId, state: { content: evt.content || '' }, content: evt.content || '' });
      return;
    }
    if (evt.name === 'lobbyClosed') {
      broadcastToChannel(`horseracing:lobby:${lobbyId}`, { type: 'horseracing.closed', lobbyId, state: { content: evt.content || 'Lobby closed.' }, content: evt.content || 'Lobby closed.' });
    }
  });
  manager.onEngineEvent('pachinko', (evt) => {
    if (!evt || typeof evt.channelId !== 'string' || !evt.channelId.startsWith('games:web:pachinko:')) return;
    const sessionId = parsePrefixedId(evt.channelId, 'pachinko');
    if (evt.name === 'frame') {
      broadcastToChannel(`pachinko:session:${sessionId}`, { type: 'pachinko.frame', sessionId, content: evt.content || '' });
      return;
    }
    if (evt.name === 'finalresult') {
      broadcastToChannel(`pachinko:session:${sessionId}`, { type: 'pachinko.finalresult', sessionId, resultText: evt.resultText || '', payout: evt.payout || 0 });
    }
  });
}

function handleWsUpgrade(req, socket) {
  const parsedUrl = parseUrl(req);
  const pathname = routePath(parsedUrl.pathname);
  if (pathname !== '/ws') return socket.destroy();
  const session = requireUserAuth(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  const key = req.headers['sec-websocket-key'];
  if (!key || typeof key !== 'string') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return socket.destroy();
  }
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '\r\n'].join('\r\n'));
  const client = { socket, session, channels: new Set(), buffer: Buffer.alloc(0) };
  wsClients.add(client);
  sendWsJson(client, { type: 'hello', userId: session.discordId, username: session.username });
  socket.on('data', (chunk) => {
    try {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      const { messages, remaining } = parseWsFrames(client.buffer);
      client.buffer = remaining;
      for (const message of messages) {
        if (message.opcode === 0x8) return socket.end();
        if (message.opcode === 0x9) { socket.write(Buffer.from([0x8a, 0x00])); continue; }
        if (message.opcode === 0x1) handleWsMessage(client, message.payload);
      }
    } catch {
      socket.destroy();
    }
  });
  socket.on('close', () => removeWsClient(client));
  socket.on('end', () => removeWsClient(client));
  socket.on('error', () => removeWsClient(client));
}

function requireMemberSession(req, res, { api = false, nextPath = null } = {}) {
  const session = requireUserAuth(req);
  if (session) {
    ensureAccount(session.discordId, session.username);
    return session;
  }
  if (api) {
    sendError(res, 401, 'unauthorized', 'Login required');
    return null;
  }
  res.writeHead(302, { Location: `${p('/login')}?next=${encodeURIComponent(nextPath || p('/'))}` });
  res.end();
  return null;
}

function renderHomePage(session) {
  return renderPage('Games Lobby', session, `
    <div class="card">
      <h2>Game Lobby</h2>
      <p>Use the dedicated games interface for realtime casino tables and live betting games.</p>
      <div class="games-grid">
        <div class="item"><strong>Slots</strong><div class="muted">Shared 3-seat machine</div><a class="pill" href="${p('/slots')}" style="margin-top:10px;">Open</a></div>
        <div class="item"><strong>Blackjack</strong><div class="muted">Realtime table play</div><a class="pill" href="${p('/blackjack')}" style="margin-top:10px;">Open</a></div>
        <div class="item"><strong>Holdem</strong><div class="muted">Shared poker table</div><a class="pill" href="${p('/holdem')}" style="margin-top:10px;">Open</a></div>
        <div class="item"><strong>Horse Racing</strong><div class="muted">Betting window and live race feed</div><a class="pill" href="${p('/horseracing')}" style="margin-top:10px;">Open</a></div>
        <div class="item"><strong>Pachinko</strong><div class="muted">Solo live drop board</div><a class="pill" href="${p('/pachinko')}" style="margin-top:10px;">Open</a></div>
      </div>
    </div>
  `, { active: '/' });
}

function renderSlotsIndexPage(session) {
  const slotsApiPath = JSON.stringify(p('/api/slots/lobbies'));
  const slotsPageBase = JSON.stringify(p('/slots/'));
  return renderPage('Slots', session, `
    <div class="card">
      <h2>Slots Lobbies</h2>
      <p class="muted">Create a new worker-backed slots lobby or join an existing table below.</p>
      <button class="primary" id="create-slots-lobby" type="button">Create Slots Lobby</button>
      <div id="slots-create-result" style="margin-top:12px;"></div>
    </div>
    <div class="card">
      <h2>Open Lobbies</h2>
      <div id="slots-lobby-list"><div class="item">Loading open lobbies...</div></div>
    </div>
  `, {
    active: '/slots',
    pageScripts: `<script>
const listEl = document.getElementById('slots-lobby-list');
const slotsApiPath = ${slotsApiPath};
const slotsPageBase = ${slotsPageBase};
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function renderLobbyList(lobbies) {
  if (!Array.isArray(lobbies) || lobbies.length === 0) {
    listEl.innerHTML = '<div class="item">No open slots lobbies yet. Create one to get things rolling.</div>';
    return;
  }
  listEl.innerHTML = lobbies.map((lobby) => {
    const players = Array.isArray(lobby.players) ? lobby.players : [];
    const playerSummary = players.length
      ? players.map((player) => escapeHtml(player.username) + ' - ' + escapeHtml(player.statusText || ('Bet ' + player.bet))).join('<br>')
      : 'No players yet';
    const joinUrl = slotsPageBase + encodeURIComponent(lobby.lobbyId);
    return [
      '<div class="item">',
      '<strong>Lobby ' + escapeHtml(lobby.lobbyId) + '</strong>',
      '<div>' + escapeHtml(String(lobby.playerCount)) + '/' + escapeHtml(String(lobby.maxPlayers)) + ' seats filled</div>',
      '<div class="muted" style="margin:8px 0;">' + escapeHtml(lobby.lastEvent || '') + '</div>',
      '<div class="muted" style="margin-bottom:10px;">' + playerSummary + '</div>',
      '<a class="pill" href="' + escapeHtml(joinUrl) + '">Open Lobby</a>',
      '</div>',
    ].join('');
  }).join('');
}
async function refreshLobbyList() {
  try {
    const res = await fetch(slotsApiPath);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = '<div class="item">Could not load open lobbies.</div>';
      return;
    }
    renderLobbyList(data.lobbies || []);
  } catch {
    listEl.innerHTML = '<div class="item">Could not load open lobbies.</div>';
  }
}
document.getElementById('create-slots-lobby').addEventListener('click', async () => {
  const result = document.getElementById('slots-create-result');
  result.innerHTML = '<div class="flash">Creating lobby...</div>';
  const res = await fetch(slotsApiPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) {
    result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Create failed.') + '</div>';
    return;
  }
  window.location.href = slotsPageBase + data.lobbyId;
});
refreshLobbyList();
setInterval(refreshLobbyList, 5000);
</script>`,
  });
}

function renderSlotsLobbyPage(session, lobbyId) {
  return renderPage(`Slots ${lobbyId}`, session, `
    <div class="card">
      <h2>Slots Lobby ${escapeHtml(lobbyId)}</h2>
      <div class="muted">Worker channel: <span class="mono">${escapeHtml(getWebSlotsChannelId(lobbyId))}</span></div>
    </div>
    <div class="card">
      <h2>Lobby State</h2>
      <div id="slots-lobby-state"><div class="item">Connecting...</div></div>
    </div>
    <div class="card">
      <h2>Actions</h2>
      <div id="slots-action-result"></div>
      <div class="stack">
        <div class="item"><button class="primary" id="slots-join" type="button">Join Lobby</button></div>
        <div class="item">
          <input id="slots-bet-amount" type="number" min="1" step="1" value="1">
          <button class="primary" id="slots-set-bet" type="button">Set Bet</button>
        </div>
        <div class="item"><button class="primary" id="slots-spin" type="button">Spin</button></div>
        <div class="item"><button class="primary" id="slots-leave" type="button">Leave Lobby</button></div>
      </div>
    </div>
  `, {
    active: '/slots',
    pageScripts: `<script>
const lobbyId = ${JSON.stringify(lobbyId)};
const stateEl = document.getElementById('slots-lobby-state');
const resultEl = document.getElementById('slots-action-result');
let socket;
function renderSlotsState(state) {
  if (!state) {
    stateEl.innerHTML = '<div class="item">Lobby is empty.</div>';
    return;
  }
  const players = Array.isArray(state.players) ? state.players : [];
  stateEl.innerHTML = [
    '<div class="item"><strong>' + (state.title || 'Slots Lobby') + '</strong><div>' + (state.description || '') + '</div><div class="muted">' + (state.footer || '') + '</div></div>',
    '<div class="slots-grid">' + players.map((player) => '<div class="item"><strong>' + player.name + '</strong><pre style="white-space:pre-wrap;margin:8px 0 0;">' + player.value + '</pre></div>').join('') + '</div>'
  ].join('');
}
async function postAction(path, payload) {
  resultEl.innerHTML = '<div class="flash">Working...</div>';
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json();
  if (!res.ok) {
    resultEl.innerHTML = '<div class="flash error">' + (data.error?.message || 'Request failed.') + '</div>';
    return null;
  }
  resultEl.innerHTML = '<div class="flash success">' + (data.message || 'Done.') + '</div>';
  if (data.state) renderSlotsState(data.state);
  return data;
}
async function refreshLobby() {
  const res = await fetch(${JSON.stringify(p('/api/slots/lobbies/'))} + lobbyId);
  const data = await res.json();
  if (!res.ok) {
    stateEl.innerHTML = '<div class="item">Lobby unavailable.</div>';
    return;
  }
  renderSlotsState(data.state);
}
function connectWs() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(proto + '//' + window.location.host + ${JSON.stringify(p('/ws'))});
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe', channel: 'slots:lobby:' + lobbyId }));
  });
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'slots.render' && msg.lobbyId === lobbyId) renderSlotsState(msg.state);
    if (msg.type === 'slots.closed' && msg.lobbyId === lobbyId) {
      stateEl.innerHTML = '<div class="item"><strong>Lobby closed</strong><div>' + (msg.content || '') + '</div></div>';
    }
  });
}
document.getElementById('slots-join').addEventListener('click', () => postAction(${JSON.stringify(p('/api/slots/lobbies/'))} + lobbyId + '/join'));
document.getElementById('slots-set-bet').addEventListener('click', () => postAction(${JSON.stringify(p('/api/slots/lobbies/'))} + lobbyId + '/bet', { amount: Number(document.getElementById('slots-bet-amount').value) }));
document.getElementById('slots-spin').addEventListener('click', () => postAction(${JSON.stringify(p('/api/slots/lobbies/'))} + lobbyId + '/spin'));
document.getElementById('slots-leave').addEventListener('click', () => postAction(${JSON.stringify(p('/api/slots/lobbies/'))} + lobbyId + '/leave'));
connectWs();
refreshLobby();
</script>`,
  });
}

function renderTextLobbyList(lobbies, emptyMessage, pageBase) {
  if (!Array.isArray(lobbies) || lobbies.length === 0) {
    return `<div class="item">${escapeHtml(emptyMessage)}</div>`;
  }
  return lobbies.map((lobby) => {
    const joinUrl = `${pageBase}${encodeURIComponent(lobby.lobbyId)}`;
    return [
      '<div class="item">',
      `<strong>Lobby ${escapeHtml(lobby.lobbyId)}</strong>`,
      `<div>${escapeHtml(String(lobby.playerCount))}${lobby.maxPlayers ? `/${escapeHtml(String(lobby.maxPlayers))}` : ''} seats filled</div>`,
      `<pre class="board">${escapeHtml(lobby.content || 'Waiting for first action...')}</pre>`,
      `<a class="pill" href="${escapeHtml(joinUrl)}">Open Lobby</a>`,
      '</div>',
    ].join('');
  }).join('');
}

function renderBlackjackIndexPage(session) {
  const apiPath = JSON.stringify(p('/api/blackjack/lobbies'));
  const pageBase = JSON.stringify(p('/blackjack/'));
  return renderPage('Blackjack', session, `
    <div class="card">
      <h2>Blackjack Tables</h2>
      <p class="muted">Create a blackjack table or join one that is already running.</p>
      <button class="primary" id="create-blackjack-lobby" type="button">Create Blackjack Table</button>
      <div id="blackjack-create-result" style="margin-top:12px;"></div>
    </div>
    <div class="card">
      <h2>Open Tables</h2>
      <div id="blackjack-lobby-list"><div class="item">Loading blackjack tables...</div></div>
    </div>
  `, {
    active: '/blackjack',
    pageScripts: `<script>
const listEl = document.getElementById('blackjack-lobby-list');
const apiPath = ${apiPath};
const pageBase = ${pageBase};
function renderList(lobbies) {
  listEl.innerHTML = ${JSON.stringify('')} + (Array.isArray(lobbies) && lobbies.length
    ? lobbies.map((lobby) => {
        const joinUrl = pageBase + encodeURIComponent(lobby.lobbyId);
        return '<div class="item"><strong>Lobby ' + lobby.lobbyId + '</strong><pre class="board">' + (lobby.content || 'Waiting for first hand...') + '</pre><a class="pill" href="' + joinUrl + '">Open Table</a></div>';
      }).join('')
    : '<div class="item">No open blackjack tables yet.</div>');
}
async function refreshList() {
  try {
    const res = await fetch(apiPath);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = '<div class="item">Could not load blackjack tables.</div>';
      return;
    }
    renderList(data.lobbies || []);
  } catch {
    listEl.innerHTML = '<div class="item">Could not load blackjack tables.</div>';
  }
}
document.getElementById('create-blackjack-lobby').addEventListener('click', async () => {
  const result = document.getElementById('blackjack-create-result');
  result.innerHTML = '<div class="flash">Creating table...</div>';
  const res = await fetch(apiPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  const data = await res.json();
  if (!res.ok) {
    result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Create failed.') + '</div>';
    return;
  }
  window.location.href = pageBase + data.lobbyId;
});
refreshList();
setInterval(refreshList, 5000);
</script>`,
  });
}

function renderBlackjackLobbyPage(session, lobbyId) {
  const baseApi = JSON.stringify(p('/api/blackjack/lobbies/'));
  const viewerName = JSON.stringify(session.username || '');
  return renderPage(`Blackjack ${lobbyId}`, session, `
    <div class="card"><h2>Blackjack ${escapeHtml(lobbyId)}</h2></div>
    <div class="card"><h2>Table</h2><pre id="blackjack-state" class="board">Connecting...</pre></div>
    <div class="card">
      <h2>Actions</h2>
      <div id="blackjack-result"></div>
      <div class="stack">
        <div class="item" id="blackjack-card-controls"><button class="primary" id="blackjack-hit" type="button">Hit</button> <button class="primary" id="blackjack-stay" type="button">Stay</button> <button class="primary" id="blackjack-surrender" type="button">Surrender</button></div>
        <div class="item" id="blackjack-leave-wrap"><button class="primary" id="blackjack-leave" type="button">Leave Table</button></div>
        <div class="item"><input id="blackjack-ante" type="number" min="1" step="1" value="5"><button class="primary" id="blackjack-play" type="button">Join Table</button></div>
        <div class="item"><input id="blackjack-next-bet" type="number" min="1" step="1" value="5"><button class="primary" id="blackjack-set-bet" type="button">Set Next Bet</button></div>
      </div>
    </div>
  `, {
    active: '/blackjack',
    pageScripts: `<script>
const lobbyId = ${JSON.stringify(lobbyId)};
const viewerName = ${viewerName}.toLowerCase();
const stateEl = document.getElementById('blackjack-state');
const resultEl = document.getElementById('blackjack-result');
const cardControlsEl = document.getElementById('blackjack-card-controls');
const leaveWrapEl = document.getElementById('blackjack-leave-wrap');
const baseApi = ${baseApi};
let socket;
function viewerIsSeated(state) {
  return Boolean(state && state.content && viewerName && state.content.toLowerCase().includes(viewerName));
}
function setJoinedUi(joined) {
  const display = joined ? '' : 'none';
  cardControlsEl.style.display = display;
  leaveWrapEl.style.display = display;
}
function renderState(state) {
  stateEl.textContent = state && state.content ? state.content : 'Table is empty.';
  setJoinedUi(viewerIsSeated(state));
}
async function postAction(path, payload) {
  resultEl.innerHTML = '<div class="flash">Working...</div>';
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) });
  const data = await res.json();
  if (!res.ok) { resultEl.innerHTML = '<div class="flash error">' + (data.error?.message || 'Request failed.') + '</div>'; return null; }
  resultEl.innerHTML = '<div class="flash success">' + (data.message || 'Done.') + '</div>';
  if (data.state) renderState(data.state);
  return data;
}
async function refreshState() {
  const res = await fetch(baseApi + lobbyId);
  const data = await res.json();
  renderState(data.state || null);
}
function connectWs() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(proto + '//' + window.location.host + ${JSON.stringify(p('/ws'))});
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'subscribe', channel: 'blackjack:lobby:' + lobbyId })));
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.lobbyId !== lobbyId) return;
    if (msg.type === 'blackjack.render') renderState(msg.state);
    if (msg.type === 'blackjack.closed') stateEl.textContent = msg.content || 'Table closed.';
  });
}
document.getElementById('blackjack-play').addEventListener('click', () => postAction(baseApi + lobbyId + '/play', { bet: Number(document.getElementById('blackjack-ante').value) }));
document.getElementById('blackjack-set-bet').addEventListener('click', () => postAction(baseApi + lobbyId + '/bet', { amount: Number(document.getElementById('blackjack-next-bet').value) }));
document.getElementById('blackjack-hit').addEventListener('click', () => postAction(baseApi + lobbyId + '/hit'));
document.getElementById('blackjack-stay').addEventListener('click', () => postAction(baseApi + lobbyId + '/stay'));
document.getElementById('blackjack-surrender').addEventListener('click', () => postAction(baseApi + lobbyId + '/surrender'));
document.getElementById('blackjack-leave').addEventListener('click', () => postAction(baseApi + lobbyId + '/leave'));
setJoinedUi(false);
connectWs();
refreshState();
</script>`,
  });
}

function renderHoldemIndexPage(session) {
  const apiPath = JSON.stringify(p('/api/holdem/lobbies'));
  const pageBase = JSON.stringify(p('/holdem/'));
  return renderPage('Holdem', session, `
    <div class="card"><h2>Holdem Tables</h2><p class="muted">Create a hold'em table or join an existing one.</p><button class="primary" id="create-holdem-lobby" type="button">Create Holdem Table</button><div id="holdem-create-result" style="margin-top:12px;"></div></div>
    <div class="card"><h2>Open Tables</h2><div id="holdem-lobby-list"><div class="item">Loading hold'em tables...</div></div></div>
  `, {
    active: '/holdem',
    pageScripts: `<script>
const listEl = document.getElementById('holdem-lobby-list');
const apiPath = ${apiPath};
const pageBase = ${pageBase};
function refreshListHtml(lobbies) {
  listEl.innerHTML = Array.isArray(lobbies) && lobbies.length
    ? lobbies.map((lobby) => '<div class="item"><strong>Lobby ' + lobby.lobbyId + '</strong><pre class="board">' + (lobby.content || 'Waiting for players...') + '</pre><a class="pill" href="' + pageBase + encodeURIComponent(lobby.lobbyId) + '">Open Table</a></div>').join('')
    : '<div class="item">No open hold\\'em tables yet.</div>';
}
async function refreshList() {
  try {
    const res = await fetch(apiPath); const data = await res.json();
    if (!res.ok) { listEl.innerHTML = '<div class="item">Could not load hold\\'em tables.</div>'; return; }
    refreshListHtml(data.lobbies || []);
  } catch { listEl.innerHTML = '<div class="item">Could not load hold\\'em tables.</div>'; }
}
document.getElementById('create-holdem-lobby').addEventListener('click', async () => {
  const result = document.getElementById('holdem-create-result');
  result.innerHTML = '<div class="flash">Creating table...</div>';
  const res = await fetch(apiPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  const data = await res.json();
  if (!res.ok) { result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Create failed.') + '</div>'; return; }
  window.location.href = pageBase + data.lobbyId;
});
refreshList();
setInterval(refreshList, 5000);
</script>`,
  });
}

function renderHoldemLobbyPage(session, lobbyId) {
  const baseApi = JSON.stringify(p('/api/holdem/lobbies/'));
  const viewerName = JSON.stringify(session.username || '');
  return renderPage(`Holdem ${lobbyId}`, session, `
    <div class="card"><h2>Holdem ${escapeHtml(lobbyId)}</h2></div>
    <div class="card"><h2>Table</h2><pre id="holdem-state" class="board">Connecting...</pre></div>
    <div class="card"><h2>Private Peek</h2><pre id="holdem-peek" class="board">Use Peek when you are seated in a hand.</pre></div>
    <div class="card">
      <h2>Actions</h2>
      <div id="holdem-result"></div>
      <div class="stack">
        <div class="item" id="holdem-card-controls"><button class="primary" id="holdem-peek-btn" type="button">Peek</button> <button class="primary" id="holdem-check" type="button">Check/Call</button> <button class="primary" id="holdem-fold" type="button">Fold</button></div>
        <div class="item" id="holdem-raise-wrap"><input id="holdem-raise-amount" type="number" min="1" step="1" value="1"><button class="primary" id="holdem-raise" type="button">Raise</button></div>
        <div class="item" id="holdem-leave-wrap"><button class="primary" id="holdem-leave" type="button">Leave Table</button></div>
        <div class="item"><input id="holdem-ante" type="number" min="1" step="1" value="5"><button class="primary" id="holdem-play" type="button">Join Table</button></div>
        <div class="item"><input id="holdem-next-bet" type="number" min="1" step="1" value="5"><button class="primary" id="holdem-set-bet" type="button">Set Ante</button></div>
      </div>
    </div>
  `, {
    active: '/holdem',
    pageScripts: `<script>
const lobbyId = ${JSON.stringify(lobbyId)};
const viewerName = ${viewerName}.toLowerCase();
const stateEl = document.getElementById('holdem-state');
const peekEl = document.getElementById('holdem-peek');
const resultEl = document.getElementById('holdem-result');
const cardControlsEl = document.getElementById('holdem-card-controls');
const raiseWrapEl = document.getElementById('holdem-raise-wrap');
const leaveWrapEl = document.getElementById('holdem-leave-wrap');
const baseApi = ${baseApi};
let socket;
function viewerIsSeated(state) {
  return Boolean(state && state.content && viewerName && state.content.toLowerCase().includes(viewerName));
}
function setJoinedUi(joined) {
  const display = joined ? '' : 'none';
  cardControlsEl.style.display = display;
  raiseWrapEl.style.display = display;
  leaveWrapEl.style.display = display;
}
function renderState(state) {
  stateEl.textContent = state && state.content ? state.content : 'Table is empty.';
  setJoinedUi(viewerIsSeated(state));
}
async function postAction(path, payload) {
  resultEl.innerHTML = '<div class="flash">Working...</div>';
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) });
  const data = await res.json();
  if (!res.ok) { resultEl.innerHTML = '<div class="flash error">' + (data.error?.message || 'Request failed.') + '</div>'; return null; }
  resultEl.innerHTML = '<div class="flash success">' + (data.message || 'Done.') + '</div>';
  if (data.state) renderState(data.state);
  if (data.peek) peekEl.textContent = data.peek;
  return data;
}
async function refreshState() {
  const res = await fetch(baseApi + lobbyId); const data = await res.json(); renderState(data.state || null);
}
function connectWs() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(proto + '//' + window.location.host + ${JSON.stringify(p('/ws'))});
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'subscribe', channel: 'holdem:lobby:' + lobbyId })));
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.lobbyId !== lobbyId) return;
    if (msg.type === 'holdem.render') renderState(msg.state);
    if (msg.type === 'holdem.closed') stateEl.textContent = msg.content || 'Table closed.';
  });
}
document.getElementById('holdem-play').addEventListener('click', () => postAction(baseApi + lobbyId + '/play', { bet: Number(document.getElementById('holdem-ante').value) }));
document.getElementById('holdem-set-bet').addEventListener('click', () => postAction(baseApi + lobbyId + '/bet', { amount: Number(document.getElementById('holdem-next-bet').value) }));
document.getElementById('holdem-peek-btn').addEventListener('click', () => postAction(baseApi + lobbyId + '/peek'));
document.getElementById('holdem-check').addEventListener('click', () => postAction(baseApi + lobbyId + '/check'));
document.getElementById('holdem-fold').addEventListener('click', () => postAction(baseApi + lobbyId + '/fold'));
document.getElementById('holdem-raise').addEventListener('click', () => postAction(baseApi + lobbyId + '/raise', { amount: Number(document.getElementById('holdem-raise-amount').value) }));
document.getElementById('holdem-leave').addEventListener('click', () => postAction(baseApi + lobbyId + '/leave'));
setJoinedUi(false);
connectWs();
refreshState();
</script>`,
  });
}

function renderHorseracingIndexPage(session) {
  const apiPath = JSON.stringify(p('/api/horseracing/lobbies'));
  const pageBase = JSON.stringify(p('/horseracing/'));
  return renderPage('Horse Racing', session, `
    <div class="card"><h2>Horse Racing Lobbies</h2><p class="muted">Create a race lobby or join one already taking bets.</p><button class="primary" id="create-race-lobby" type="button">Create Race Lobby</button><div id="race-create-result" style="margin-top:12px;"></div></div>
    <div class="card"><h2>Open Races</h2><div id="race-lobby-list"><div class="item">Loading races...</div></div></div>
  `, {
    active: '/horseracing',
    pageScripts: `<script>
const listEl = document.getElementById('race-lobby-list');
const apiPath = ${apiPath};
const pageBase = ${pageBase};
function refreshListHtml(lobbies) {
  listEl.innerHTML = Array.isArray(lobbies) && lobbies.length
    ? lobbies.map((lobby) => '<div class="item"><strong>Lobby ' + lobby.lobbyId + '</strong><pre class="board">' + (lobby.content || 'Waiting for first bettor...') + '</pre><a class="pill" href="' + pageBase + encodeURIComponent(lobby.lobbyId) + '">Open Race</a></div>').join('')
    : '<div class="item">No open horse racing lobbies yet.</div>';
}
async function refreshList() {
  try {
    const res = await fetch(apiPath); const data = await res.json();
    if (!res.ok) { listEl.innerHTML = '<div class="item">Could not load races.</div>'; return; }
    refreshListHtml(data.lobbies || []);
  } catch { listEl.innerHTML = '<div class="item">Could not load races.</div>'; }
}
document.getElementById('create-race-lobby').addEventListener('click', async () => {
  const result = document.getElementById('race-create-result');
  result.innerHTML = '<div class="flash">Creating race...</div>';
  const res = await fetch(apiPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  const data = await res.json();
  if (!res.ok) { result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Create failed.') + '</div>'; return; }
  window.location.href = pageBase + data.lobbyId;
});
refreshList();
setInterval(refreshList, 5000);
</script>`,
  });
}

function renderHorseracingLobbyPage(session, lobbyId) {
  const baseApi = JSON.stringify(p('/api/horseracing/lobbies/'));
  return renderPage(`Horse Racing ${lobbyId}`, session, `
    <div class="card"><h2>Horse Racing ${escapeHtml(lobbyId)}</h2></div>
    <div class="card"><h2>Race Feed</h2><pre id="race-state" class="board">Connecting...</pre></div>
    <div class="card">
      <h2>Actions</h2>
      <div id="race-result"></div>
      <div class="stack">
        <div class="item"><button class="primary" id="race-join" type="button">Join Lobby</button> <button class="primary" id="race-leave" type="button">Leave Lobby</button></div>
        <div class="item"><input id="race-bet" type="number" min="1" step="1" value="5"><button class="primary" id="race-set-bet" type="button">Set Bet</button></div>
        <div class="item">
          <div class="muted" style="margin-bottom:6px;">Pick your horse:</div>
          <button class="primary" data-race-horse="A" type="button">Horse A</button>
          <button class="primary" data-race-horse="B" type="button">Horse B</button>
          <button class="primary" data-race-horse="C" type="button">Horse C</button>
          <button class="primary" data-race-horse="D" type="button">Horse D</button>
        </div>
      </div>
    </div>
  `, {
    active: '/horseracing',
    pageScripts: `<script>
const lobbyId = ${JSON.stringify(lobbyId)};
const stateEl = document.getElementById('race-state');
const resultEl = document.getElementById('race-result');
const baseApi = ${baseApi};
let socket;
function renderState(state) { stateEl.textContent = state && state.content ? state.content : 'Lobby is empty.'; }
async function postAction(path, payload) {
  resultEl.innerHTML = '<div class="flash">Working...</div>';
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) });
  const data = await res.json();
  if (!res.ok) { resultEl.innerHTML = '<div class="flash error">' + (data.error?.message || 'Request failed.') + '</div>'; return null; }
  resultEl.innerHTML = '<div class="flash success">' + (data.message || 'Done.') + '</div>';
  if (data.state) renderState(data.state);
  return data;
}
async function refreshState() {
  const res = await fetch(baseApi + lobbyId); const data = await res.json(); renderState(data.state || null);
}
function connectWs() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(proto + '//' + window.location.host + ${JSON.stringify(p('/ws'))});
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'subscribe', channel: 'horseracing:lobby:' + lobbyId })));
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.lobbyId !== lobbyId) return;
    if (msg.type.startsWith('horseracing.')) renderState(msg.state || { content: msg.content || '' });
  });
}
document.getElementById('race-join').addEventListener('click', () => postAction(baseApi + lobbyId + '/join'));
document.getElementById('race-leave').addEventListener('click', () => postAction(baseApi + lobbyId + '/leave'));
document.getElementById('race-set-bet').addEventListener('click', () => postAction(baseApi + lobbyId + '/bet', { amount: Number(document.getElementById('race-bet').value) }));
for (const button of document.querySelectorAll('[data-race-horse]')) {
  button.addEventListener('click', () => postAction(baseApi + lobbyId + '/horse', { horse: button.getAttribute('data-race-horse') }));
}
connectWs();
refreshState();
</script>`,
  });
}

function renderPachinkoPage(session) {
  return renderPage('Pachinko', session, `
    <div class="card"><h2>Pachinko</h2><p class="muted">Pick a peg, set your bet, and watch the live drop feed.</p></div>
    <div class="card"><h2>Board</h2><pre id="pachinko-state" class="board">Ready for first drop.</pre></div>
    <div class="card">
      <h2>Drop</h2>
      <div id="pachinko-result"></div>
      <input id="pachinko-peg" type="number" min="1" max="9" step="1" value="5">
      <input id="pachinko-bet" type="number" min="1" step="1" value="5">
      <button class="primary" id="pachinko-drop" type="button">Drop Ball</button>
    </div>
  `, {
    active: '/pachinko',
    pageScripts: `<script>
const stateEl = document.getElementById('pachinko-state');
const resultEl = document.getElementById('pachinko-result');
const sessionId = 'pachinko-' + Math.random().toString(16).slice(2);
let socket;
function connectWs() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(proto + '//' + window.location.host + ${JSON.stringify(p('/ws'))});
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'subscribe', channel: 'pachinko:session:' + sessionId })));
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.sessionId !== sessionId) return;
    if (msg.type === 'pachinko.frame') stateEl.textContent = msg.content || '';
    if (msg.type === 'pachinko.finalresult') {
      stateEl.textContent = msg.resultText || '';
      resultEl.innerHTML = '<div class="flash success">Drop resolved.</div>';
    }
  });
}
document.getElementById('pachinko-drop').addEventListener('click', async () => {
  resultEl.innerHTML = '<div class="flash">Dropping...</div>';
  const res = await fetch(${JSON.stringify(p('/api/pachinko/drop'))}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      peg: Number(document.getElementById('pachinko-peg').value),
      bet: Number(document.getElementById('pachinko-bet').value),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    resultEl.innerHTML = '<div class="flash error">' + (data.error?.message || 'Drop failed.') + '</div>';
    return;
  }
  stateEl.textContent = (data.state && data.state.content) || 'Drop started.';
});
connectWs();
</script>`,
  });
}

async function handleRequest(req, res) {
  const parsedUrl = parseUrl(req);
  const pathname = routePath(parsedUrl.pathname);
  const method = (req.method || 'GET').toUpperCase();
  if (pathname === null) return sendError(res, 404, 'not_found', 'Unknown route');

  if (pathname === '/auth/discord/login' && method === 'GET') {
    handleLoginRoute(req, res, { authConfig: { redirectUri: GAME_WEB_DISCORD_OAUTH_REDIRECT_URI } });
    return;
  }
  if (pathname === '/auth/discord/callback' && method === 'GET') {
    await handleCallbackRoute(req, res, parsedUrl, {
      basePath: GAME_WEB_BASE_PATH,
      loginPath: `${p('/login')}`,
      authConfig: { redirectUri: GAME_WEB_DISCORD_OAUTH_REDIRECT_URI },
      popupMessageType: 'lumigames-auth-complete',
      popupTargetOrigin: GAME_WEB_POSTMESSAGE_TARGET_ORIGIN,
      cookieOptions: { sameSite: GAME_WEB_SESSION_SAMESITE, secure: GAME_WEB_SESSION_SECURE },
    });
    return;
  }
  if (pathname === '/auth/logout' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    handleLogoutRoute(req, res, {
      loginPath: `${p('/login')}`,
      cookieOptions: { sameSite: GAME_WEB_SESSION_SAMESITE, secure: GAME_WEB_SESSION_SECURE },
    });
    return;
  }
  if (pathname === '/login' && method === 'GET') {
    return sendHtml(res, 200, renderLoginPage(String(parsedUrl.searchParams.get('next') || p('/'))));
  }

  if (pathname === '/api/me' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    sendJson(res, 200, { viewer: { discordId: session.discordId, username: session.username } });
    return;
  }

  if (pathname === '/api/blackjack/lobbies' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    try {
      const result = await manager.sendCommand('blackjack', 'listTables', {}, { channelId: 'games:web:blackjack:lobby-directory' });
      sendJson(res, 200, { ok: true, lobbies: serializeTextTables(result, 'blackjack') });
    } catch (error) {
      sendError(res, 503, 'blackjack_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/blackjack/lobbies' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = generateLobbyId('blackjack');
    sendJson(res, 200, { ok: true, lobbyId, joinUrl: p(`/blackjack/${lobbyId}`) });
    return;
  }

  const blackjackLobbyApiMatch = pathname.match(/^\/api\/blackjack\/lobbies\/([^/]+)$/u);
  if (blackjackLobbyApiMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(blackjackLobbyApiMatch[1]);
    const channelId = getWebBlackjackChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('blackjack', 'getTable', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, lobbyId, state: result && result.ok ? { content: result.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'blackjack_unavailable', error.message);
    }
    return;
  }

  const blackjackPlayApiMatch = pathname.match(/^\/api\/blackjack\/lobbies\/([^/]+)\/play$/u);
  if (blackjackPlayApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const bet = Number(body.bet);
    if (!Number.isInteger(bet) || bet <= 0) return sendError(res, 400, 'bad_request', 'bet must be a positive integer');
    const lobbyId = decodeURIComponent(blackjackPlayApiMatch[1]);
    const channelId = getWebBlackjackChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('blackjack', 'play', { channelId, userId: session.discordId, username: session.username, bet }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'play_failed', 'Could not join blackjack table');
      sendJson(res, 200, { ok: true, message: 'Joined blackjack table.', state: { content: result.content || '' } });
    } catch (error) {
      sendError(res, 503, 'blackjack_unavailable', error.message);
    }
    return;
  }

  const blackjackBetApiMatch = pathname.match(/^\/api\/blackjack\/lobbies\/([^/]+)\/bet$/u);
  if (blackjackBetApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) return sendError(res, 400, 'bad_request', 'amount must be a positive integer');
    const lobbyId = decodeURIComponent(blackjackBetApiMatch[1]);
    const channelId = getWebBlackjackChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('blackjack', 'setBet', { channelId, userId: session.discordId, amount }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'bet_failed', 'Could not set blackjack bet');
      const snapshot = await manager.sendCommand('blackjack', 'getTable', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, message: `Set next bet to ${amount} SGC.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'blackjack_unavailable', error.message);
    }
    return;
  }

  for (const action of ['hit', 'stay', 'surrender', 'leave']) {
    const match = pathname.match(new RegExp(`^/api/blackjack/lobbies/([^/]+)/${action}$`, 'u'));
    if (match && method === 'POST') {
      const originCheck = validateSameOrigin(req);
      if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
      const session = requireMemberSession(req, res, { api: true });
      if (!session) return;
      const lobbyId = decodeURIComponent(match[1]);
      const channelId = getWebBlackjackChannelId(lobbyId);
      try {
        const result = await manager.sendCommand('blackjack', action, { channelId, userId: session.discordId }, { channelId });
        if (!result.ok) return sendError(res, 400, result.reason || `${action}_failed`, `Could not ${action} at blackjack table`);
        const snapshot = action === 'leave' ? await manager.sendCommand('blackjack', 'getTable', { channelId }, { channelId }).catch(() => null) : null;
        sendJson(res, 200, { ok: true, message: `Blackjack ${action} complete.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : (result.content ? { content: result.content } : null) });
      } catch (error) {
        sendError(res, 503, 'blackjack_unavailable', error.message);
      }
      return;
    }
  }

  if (pathname === '/api/holdem/lobbies' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    try {
      const result = await manager.sendCommand('holdem', 'listTables', {}, { channelId: 'games:web:holdem:lobby-directory' });
      sendJson(res, 200, { ok: true, lobbies: serializeTextTables(result, 'holdem') });
    } catch (error) {
      sendError(res, 503, 'holdem_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/holdem/lobbies' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = generateLobbyId('holdem');
    sendJson(res, 200, { ok: true, lobbyId, joinUrl: p(`/holdem/${lobbyId}`) });
    return;
  }

  const holdemLobbyApiMatch = pathname.match(/^\/api\/holdem\/lobbies\/([^/]+)$/u);
  if (holdemLobbyApiMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(holdemLobbyApiMatch[1]);
    const channelId = getWebHoldemChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('holdem', 'getTable', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, lobbyId, state: result && result.ok ? { content: result.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'holdem_unavailable', error.message);
    }
    return;
  }

  const holdemPlayApiMatch = pathname.match(/^\/api\/holdem\/lobbies\/([^/]+)\/play$/u);
  if (holdemPlayApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const bet = Number(body.bet);
    if (!Number.isInteger(bet) || bet <= 0) return sendError(res, 400, 'bad_request', 'bet must be a positive integer');
    const lobbyId = decodeURIComponent(holdemPlayApiMatch[1]);
    const channelId = getWebHoldemChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('holdem', 'play', { channelId, userId: session.discordId, username: session.username, bet }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'play_failed', 'Could not join hold\'em table');
      if (result.isNew) await manager.sendCommand('holdem', 'tableReady', { channelId }, { channelId });
      const snapshot = await manager.sendCommand('holdem', 'getTable', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, message: 'Joined hold\'em table.', state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'holdem_unavailable', error.message);
    }
    return;
  }

  const holdemBetApiMatch = pathname.match(/^\/api\/holdem\/lobbies\/([^/]+)\/bet$/u);
  if (holdemBetApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) return sendError(res, 400, 'bad_request', 'amount must be a positive integer');
    const lobbyId = decodeURIComponent(holdemBetApiMatch[1]);
    const channelId = getWebHoldemChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('holdem', 'bet', { channelId, userId: session.discordId, amount }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'bet_failed', 'Could not set hold\'em ante');
      const snapshot = await manager.sendCommand('holdem', 'getTable', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, message: `Set ante to ${amount} SGC.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'holdem_unavailable', error.message);
    }
    return;
  }

  const holdemPeekApiMatch = pathname.match(/^\/api\/holdem\/lobbies\/([^/]+)\/peek$/u);
  if (holdemPeekApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(holdemPeekApiMatch[1]);
    const channelId = getWebHoldemChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('holdem', 'peek', { channelId, userId: session.discordId }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'peek_failed', 'Could not peek hold\'em hand');
      sendJson(res, 200, { ok: true, message: 'Peeked hand.', peek: result.content || '' });
    } catch (error) {
      sendError(res, 503, 'holdem_unavailable', error.message);
    }
    return;
  }

  for (const action of ['check', 'fold', 'leave']) {
    const match = pathname.match(new RegExp(`^/api/holdem/lobbies/([^/]+)/${action}$`, 'u'));
    if (match && method === 'POST') {
      const originCheck = validateSameOrigin(req);
      if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
      const session = requireMemberSession(req, res, { api: true });
      if (!session) return;
      const lobbyId = decodeURIComponent(match[1]);
      const channelId = getWebHoldemChannelId(lobbyId);
      try {
        const result = await manager.sendCommand('holdem', action, { channelId, userId: session.discordId }, { channelId });
        if (!result.ok) return sendError(res, 400, result.reason || `${action}_failed`, `Could not ${action} in hold'em`);
        const snapshot = await manager.sendCommand('holdem', 'getTable', { channelId }, { channelId }).catch(() => null);
        sendJson(res, 200, { ok: true, message: `Hold'em ${action} complete.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
      } catch (error) {
        sendError(res, 503, 'holdem_unavailable', error.message);
      }
      return;
    }
  }

  const holdemRaiseApiMatch = pathname.match(/^\/api\/holdem\/lobbies\/([^/]+)\/raise$/u);
  if (holdemRaiseApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) return sendError(res, 400, 'bad_request', 'amount must be a positive integer');
    const lobbyId = decodeURIComponent(holdemRaiseApiMatch[1]);
    const channelId = getWebHoldemChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('holdem', 'raise', { channelId, userId: session.discordId, username: session.username, amount }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'raise_failed', 'Could not raise in hold\'em');
      const snapshot = await manager.sendCommand('holdem', 'getTable', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, message: `Raised by ${amount} SGC.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'holdem_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/horseracing/lobbies' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    try {
      const result = await manager.sendCommand('horseracing', 'listLobbies', {}, { channelId: 'games:web:horseracing:lobby-directory' });
      sendJson(res, 200, { ok: true, lobbies: serializeTextLobbies(result, 'horseracing') });
    } catch (error) {
      sendError(res, 503, 'horseracing_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/horseracing/lobbies' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = generateLobbyId('horseracing');
    const channelId = getWebHorseracingChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('horseracing', 'join', {
        channelId,
        userId: session.discordId,
        username: session.username,
      }, { channelId });
      if (!result.ok) {
        return sendError(res, 400, result.reason || 'create_failed', 'Could not create horse racing lobby');
      }
      sendJson(res, 200, {
        ok: true,
        lobbyId,
        joinUrl: p(`/horseracing/${lobbyId}`),
        state: { content: result.content || '' },
      });
    } catch (error) {
      sendError(res, 503, 'horseracing_unavailable', error.message);
    }
    return;
  }

  const horseracingLobbyApiMatch = pathname.match(/^\/api\/horseracing\/lobbies\/([^/]+)$/u);
  if (horseracingLobbyApiMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(horseracingLobbyApiMatch[1]);
    const channelId = getWebHorseracingChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('horseracing', 'getLobby', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, lobbyId, state: result && result.ok ? { content: result.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'horseracing_unavailable', error.message);
    }
    return;
  }

  for (const action of ['join', 'leave']) {
    const match = pathname.match(new RegExp(`^/api/horseracing/lobbies/([^/]+)/${action}$`, 'u'));
    if (match && method === 'POST') {
      const originCheck = validateSameOrigin(req);
      if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
      const session = requireMemberSession(req, res, { api: true });
      if (!session) return;
      const lobbyId = decodeURIComponent(match[1]);
      const channelId = getWebHorseracingChannelId(lobbyId);
      try {
        const result = await manager.sendCommand('horseracing', action, { channelId, userId: session.discordId, username: session.username }, { channelId });
        if (!result.ok) return sendError(res, 400, result.reason || `${action}_failed`, `Could not ${action} horse racing lobby`);
        const snapshot = await manager.sendCommand('horseracing', 'getLobby', { channelId }, { channelId }).catch(() => null);
        sendJson(res, 200, { ok: true, message: `Horse racing ${action} complete.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
      } catch (error) {
        sendError(res, 503, 'horseracing_unavailable', error.message);
      }
      return;
    }
  }

  const horseracingBetApiMatch = pathname.match(/^\/api\/horseracing\/lobbies\/([^/]+)\/bet$/u);
  if (horseracingBetApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) return sendError(res, 400, 'bad_request', 'amount must be a positive integer');
    const lobbyId = decodeURIComponent(horseracingBetApiMatch[1]);
    const channelId = getWebHorseracingChannelId(lobbyId);
    try {
      let result = await manager.sendCommand('horseracing', 'setBet', { channelId, userId: session.discordId, username: session.username, amount }, { channelId });
      if (!result.ok && result.reason === 'no_lobby') {
        const joinResult = await manager.sendCommand('horseracing', 'join', {
          channelId,
          userId: session.discordId,
          username: session.username,
        }, { channelId });
        if (!joinResult.ok) return sendError(res, 400, joinResult.reason || 'join_failed', 'Could not join horse racing lobby');
        result = await manager.sendCommand('horseracing', 'setBet', { channelId, userId: session.discordId, username: session.username, amount }, { channelId });
      }
      if (!result.ok) return sendError(res, 400, result.reason || 'bet_failed', 'Could not set horse racing bet');
      const snapshot = await manager.sendCommand('horseracing', 'getLobby', { channelId }, { channelId }).catch(() => null);
      sendJson(res, 200, { ok: true, message: `Set horse racing bet to ${amount} SGC.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'horseracing_unavailable', error.message);
    }
    return;
  }

  const horseracingHorseApiMatch = pathname.match(/^\/api\/horseracing\/lobbies\/([^/]+)\/horse$/u);
  if (horseracingHorseApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const horse = normalizeHorseChoice(body.horse);
    if (!horse) return sendError(res, 400, 'bad_request', 'horse must be A, B, C, or D');
    const lobbyId = decodeURIComponent(horseracingHorseApiMatch[1]);
    const channelId = getWebHorseracingChannelId(lobbyId);
    try {
      let result = await manager.sendCommand('horseracing', 'pickHorse', { channelId, userId: session.discordId, username: session.username, horse }, { channelId });
      if (!result.ok && result.reason === 'no_lobby') {
        const joinResult = await manager.sendCommand('horseracing', 'join', {
          channelId,
          userId: session.discordId,
          username: session.username,
        }, { channelId });
        if (!joinResult.ok) return sendError(res, 400, joinResult.reason || 'join_failed', 'Could not join horse racing lobby');
        result = await manager.sendCommand('horseracing', 'pickHorse', { channelId, userId: session.discordId, username: session.username, horse }, { channelId });
      }
      if (!result.ok) return sendError(res, 400, result.reason || 'horse_failed', 'Could not pick horse');
      const snapshot = await manager.sendCommand('horseracing', 'getLobby', { channelId }, { channelId }).catch(() => null);
      sendJson(res, 200, { ok: true, message: `Picked horse ${horse}.`, state: snapshot && snapshot.ok ? { content: snapshot.content || '' } : null });
    } catch (error) {
      sendError(res, 503, 'horseracing_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/pachinko/drop' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || '').trim();
    const peg = Number(body.peg);
    const bet = Number(body.bet);
    if (!sessionId) return sendError(res, 400, 'bad_request', 'sessionId is required');
    if (!Number.isInteger(peg) || !Number.isInteger(bet)) return sendError(res, 400, 'bad_request', 'peg and bet must be integers');
    const channelId = getWebPachinkoChannelId(sessionId);
    try {
      const result = await manager.sendCommand('pachinko', 'drop', { channelId, userId: session.discordId, username: session.username, peg, bet }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'drop_failed', 'Could not start pachinko drop');
      sendJson(res, 200, { ok: true, message: 'Pachinko drop started.', state: { content: [result.initial?.header, result.initial?.firstRow].filter(Boolean).join('\n') } });
    } catch (error) {
      sendError(res, 503, 'pachinko_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/slots/lobbies' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    try {
      const result = await manager.sendCommand('slots', 'listLobbies', {}, { channelId: 'games:web:slots:lobby-directory' });
      sendJson(res, 200, { ok: true, lobbies: serializeSlotsLobbyList(result) });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/slots/lobbies' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = generateLobbyId('slots');
    sendJson(res, 200, { ok: true, lobbyId, joinUrl: p(`/slots/${lobbyId}`) });
    return;
  }

  const slotsLobbyApiMatch = pathname.match(/^\/api\/slots\/lobbies\/([^/]+)$/u);
  if (slotsLobbyApiMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsLobbyApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'getLobby', { channelId }, { channelId });
      sendJson(res, 200, { ok: true, lobbyId, state: result && result.ok ? serializeSlotsPayload(result) : null });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsJoinApiMatch = pathname.match(/^\/api\/slots\/lobbies\/([^/]+)\/join$/u);
  if (slotsJoinApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsJoinApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'join', { channelId, userId: session.discordId, username: session.username }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'join_failed', 'Could not join slots lobby');
      sendJson(res, 200, { ok: true, message: 'Joined slots lobby.', state: serializeSlotsPayload(result) });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsBetApiMatch = pathname.match(/^\/api\/slots\/lobbies\/([^/]+)\/bet$/u);
  if (slotsBetApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const body = await readJsonBody(req);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
      return sendError(res, 400, 'bad_request', 'amount must be a positive integer');
    }
    const lobbyId = decodeURIComponent(slotsBetApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'setBet', { channelId, userId: session.discordId, username: session.username, amount }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'bet_failed', 'Could not set bet');
      sendJson(res, 200, { ok: true, message: `Set bet to ${amount} SGC.`, state: serializeSlotsPayload(result) });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsSpinApiMatch = pathname.match(/^\/api\/slots\/lobbies\/([^/]+)\/spin$/u);
  if (slotsSpinApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsSpinApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'spin', { channelId, userId: session.discordId, username: session.username }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'spin_failed', 'Could not spin');
      sendJson(res, 200, { ok: true, message: 'Spin started.', state: serializeSlotsPayload(result) });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsLeaveApiMatch = pathname.match(/^\/api\/slots\/lobbies\/([^/]+)\/leave$/u);
  if (slotsLeaveApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsLeaveApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'leave', { channelId, userId: session.discordId }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'leave_failed', 'Could not leave lobby');
      sendJson(res, 200, { ok: true, message: 'Left slots lobby.', state: result.closed ? null : serializeSlotsPayload(result) });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/') });
    if (!session) return;
    sendHtml(res, 200, renderHomePage(session));
    return;
  }
  if (pathname === '/blackjack' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/blackjack') });
    if (!session) return;
    sendHtml(res, 200, renderBlackjackIndexPage(session));
    return;
  }
  const blackjackLobbyPageMatch = pathname.match(/^\/blackjack\/([^/]+)$/u);
  if (blackjackLobbyPageMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p(`/blackjack/${blackjackLobbyPageMatch[1]}`) });
    if (!session) return;
    sendHtml(res, 200, renderBlackjackLobbyPage(session, decodeURIComponent(blackjackLobbyPageMatch[1])));
    return;
  }
  if (pathname === '/holdem' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/holdem') });
    if (!session) return;
    sendHtml(res, 200, renderHoldemIndexPage(session));
    return;
  }
  const holdemLobbyPageMatch = pathname.match(/^\/holdem\/([^/]+)$/u);
  if (holdemLobbyPageMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p(`/holdem/${holdemLobbyPageMatch[1]}`) });
    if (!session) return;
    sendHtml(res, 200, renderHoldemLobbyPage(session, decodeURIComponent(holdemLobbyPageMatch[1])));
    return;
  }
  if (pathname === '/horseracing' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/horseracing') });
    if (!session) return;
    sendHtml(res, 200, renderHorseracingIndexPage(session));
    return;
  }
  const horseracingLobbyPageMatch = pathname.match(/^\/horseracing\/([^/]+)$/u);
  if (horseracingLobbyPageMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p(`/horseracing/${horseracingLobbyPageMatch[1]}`) });
    if (!session) return;
    sendHtml(res, 200, renderHorseracingLobbyPage(session, decodeURIComponent(horseracingLobbyPageMatch[1])));
    return;
  }
  if (pathname === '/pachinko' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/pachinko') });
    if (!session) return;
    sendHtml(res, 200, renderPachinkoPage(session));
    return;
  }
  if (pathname === '/slots' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/slots') });
    if (!session) return;
    sendHtml(res, 200, renderSlotsIndexPage(session));
    return;
  }
  const slotsLobbyPageMatch = pathname.match(/^\/slots\/([^/]+)$/u);
  if (slotsLobbyPageMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p(`/slots/${slotsLobbyPageMatch[1]}`) });
    if (!session) return;
    sendHtml(res, 200, renderSlotsLobbyPage(session, decodeURIComponent(slotsLobbyPageMatch[1])));
    return;
  }

  sendError(res, 404, 'not_found', 'Unknown route');
}

function startGameWebServer(opts = {}) {
  if (server) return;
  GAME_WEB_PORT = Number(opts.port) || GAME_WEB_PORT;
  GAME_WEB_HOST = opts.host || GAME_WEB_HOST;
  GAME_WEB_DISCORD_OAUTH_REDIRECT_URI = opts.authRedirectUri || GAME_WEB_DISCORD_OAUTH_REDIRECT_URI;
  installWsBridge();
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      logger.error(`Game web request failed: ${error.message}`);
      sendError(res, 500, 'internal_error', 'Internal server error');
    });
  });
  server.on('upgrade', (req, socket) => {
    try { handleWsUpgrade(req, socket); } catch { try { socket.destroy(); } catch {} }
  });
  server.listen(GAME_WEB_PORT, GAME_WEB_HOST, () => {
    logger.info(`Lumi Games web app running at http://${GAME_WEB_HOST}:${GAME_WEB_PORT}${GAME_WEB_BASE_PATH || '/'}`);
  });
  server.on('error', (error) => logger.error(`Lumi Games web server error: ${error.message}`));
}

function stopGameWebServer() {
  if (!server) return;
  try { server.close(); } catch {}
  server = null;
}

module.exports = {
  startGameWebServer,
  stopGameWebServer,
};
