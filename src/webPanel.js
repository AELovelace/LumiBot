/**
 * SadGirlCoin Economy Control Panel — web interface.
 * Themed after https://sadgirlsclub.wtf — dark retro web aesthetic.
 *
 * Features:
 *  - Dashboard with system overview
 *  - View and edit per-guild configurations
 *  - Economy settings (coins, tax, transfers, lottery)
 *  - Casino settings (slots, pachinko, blackjack, hold'em, horse racing)
 *  - User manager (search, view, adjust balances, transaction history)
 *  - Memory viewer (proxy to Python chatbot memory service)
 *  - Voice channel reward tracker
 */

const crypto = require('node:crypto');
const http = require('node:http');
const { URL } = require('node:url');
const { logger } = require('./logger');
const {
  MAX_REACTION_ROLE_ASSIGNMENTS,
  getAllGuildConfigs,
  getGuildConfig,
  normalizeReactionRoleAssignments,
  parseReactionRoleEmojiInput,
  upsertGuildConfig,
  removeGuildConfig,
  getBigBusinessUserId,
} = require('./guildConfig');
const {
  getAllStocks,
  getStockById,
  getStockSummary,
  renameStock,
  renameTicker,
} = require('./privateStockStore');
const {
  getBigBusinessBalance,
  getCentralBankBalance,
  getDollStreetBalance,
  getMomijiCasinoBalance,
  getTopHolders,
  getAllAccounts,
  searchAccounts,
  getUserTransactions,
  getAccountInfo,
  getBalance,
  adjustBalance,
  ensureAccount,
  BANK_OWNER_ID,
  getSystemState,
  setSystemState,
  deleteSystemState,
} = require('./sadgirlEconomyStore');
const {
  VALID_SCOPES,
  createApiApp,
  getApiApp,
  listApiApps,
  disableApp,
  enableApp,
  updateApp,
  issueApiKey,
  listKeysForApp,
  revokeApiKey,
  listLinksForApp,
  revokeLinkById,
} = require('./apiKeyStore');
const { activeVoiceUsers, formatVcTime, getVcLeaderboard, getVcRewardProgress } = require('./vcRewards');
const { getAllPatrons, getPatreonStats, getTierInfo } = require('./patreonRewards');
const {
  getAllSettings,
  getSettingsByCategories,
  getSetting,
  setSetting,
  resetSetting,
  resetAllSettings,
  SCHEMA,
} = require('./panelSettings');

const {
  validateAuthConfig,
  assertAuthConfigOrThrow,
  handleLoginRoute,
  handleCallbackRoute,
  handleLogoutRoute,
  renderLoginPage,
  requireAuth,
  requireUserAuth,
  buildUserBadgeHtml,
  validateSameOrigin,
} = require('./webPanelAuth');
const {
  createOAuthClient,
  getOAuthClient,
  listOAuthClientsForApp,
  revokeOAuthClient,
  createAuthorizationCode,
} = require('../SGCServer/src/oauthServer');

const WEB_PANEL_PORT = Number(process.env.WEB_PANEL_PORT) || 7777;
const WEB_PANEL_HOST = process.env.WEB_PANEL_HOST || '0.0.0.0';
// Optional base path prefix when the panel is mounted under a sub-path via a
// reverse proxy (e.g. /dollpanel/admin). Set WEB_PANEL_BASE_PATH=/dollpanel/admin
// in the environment. Must NOT have a trailing slash.
const WEB_PANEL_BASE_PATH = (process.env.WEB_PANEL_BASE_PATH || '').replace(/\/+$/u, '');
// Prepend the base path to an absolute internal path.
function p(path) { return `${WEB_PANEL_BASE_PATH}${path}`; }
const MEMORY_SERVICE_URL = process.env.MEMORY_SERVICE_URL || 'http://127.0.0.1:8765';
let server = null;

// Set to the authenticated session object for the duration of each synchronous
// render call so buildPageHtml can inject the user badge without changing
// every render function's signature.
let _currentSession = null;

/**
 * Call every game/economy module's reloadSettings() so changes made through
 * the web panel take effect in the running process immediately.
 */
function liveReloadAllSettings() {
  const mods = [
    './slots', './pachinko', './blackjack', './texasholdem', './horseracing',
    './touhouBattle', './vcRewards', './sadgirlEconomyScheduler', './sadgirlEconomyCommands', './sadgirlEconomyStore', './privateStockCommands', './bigBusiness', './welcome', './nowPlaying', './chatbot', './braveSearch',
  ];
  for (const mod of mods) {
    try {
      const m = require(mod);
      if (typeof m.reloadSettings === 'function') m.reloadSettings();
    } catch { /* module may not be loaded yet */ }
  }
}

// ---------------------------------------------------------------------------
// HTML template helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function buildPageHtml(bodyContent, title = 'SGC Control Panel') {
  const session = _currentSession;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Space+Mono:wght@400;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #0a0a0f;
    color: #c9c9d1;
    font-family: 'Space Mono', 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
  }

  /* Scanline overlay */
  body::before {
    content: '';
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.15) 2px,
      rgba(0,0,0,0.15) 4px
    );
    pointer-events: none;
    z-index: 9999;
  }

  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px;
  }

  header {
    border-bottom: 2px solid #ff69b4;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }

  header h1 {
    font-family: 'VT323', monospace;
    font-size: 36px;
    color: #ff69b4;
    text-shadow: 0 0 10px rgba(255,105,180,0.5);
    letter-spacing: 2px;
  }

  header .subtitle {
    color: #888;
    font-size: 12px;
    margin-top: 4px;
  }

  nav {
    margin-bottom: 24px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  nav a, .btn {
    display: inline-block;
    padding: 8px 14px;
    background: #1a1a2e;
    color: #ff69b4;
    text-decoration: none;
    border: 1px solid #ff69b4;
    font-family: 'VT323', monospace;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.2s;
  }

  nav a:hover, .btn:hover {
    background: #ff69b4;
    color: #0a0a0f;
    text-shadow: none;
  }

  nav a.active {
    background: #ff69b4;
    color: #0a0a0f;
  }

  .btn-danger {
    border-color: #ff4444;
    color: #ff4444;
  }

  .btn-danger:hover {
    background: #ff4444;
    color: #0a0a0f;
  }

  .btn-success {
    border-color: #44ff88;
    color: #44ff88;
  }

  .btn-success:hover {
    background: #44ff88;
    color: #0a0a0f;
  }

  .btn-warn {
    border-color: #ffaa44;
    color: #ffaa44;
  }

  .btn-warn:hover {
    background: #ffaa44;
    color: #0a0a0f;
  }

  .btn-sm {
    font-size: 14px;
    padding: 4px 10px;
  }

  h2 {
    font-family: 'VT323', monospace;
    font-size: 28px;
    color: #9b59b6;
    margin-bottom: 16px;
    text-shadow: 0 0 8px rgba(155,89,182,0.4);
  }

  h3 {
    font-family: 'VT323', monospace;
    font-size: 22px;
    color: #ff69b4;
    margin-bottom: 8px;
  }

  .card {
    background: #12121f;
    border: 1px solid #2a2a3e;
    padding: 16px;
    margin-bottom: 16px;
    position: relative;
  }

  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px; height: 100%;
    background: #ff69b4;
  }

  .card .guild-name {
    font-family: 'VT323', monospace;
    font-size: 24px;
    color: #ff69b4;
  }

  .card .guild-id {
    font-size: 11px;
    color: #666;
    font-family: monospace;
  }

  .card .stat {
    display: inline-block;
    margin-right: 20px;
    margin-top: 8px;
  }

  .card .stat-label {
    color: #888;
    font-size: 11px;
    text-transform: uppercase;
  }

  .card .stat-value {
    color: #44ff88;
    font-family: 'VT323', monospace;
    font-size: 20px;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    font-size: 11px;
    font-family: monospace;
  }

  .badge-enabled {
    background: rgba(68,255,136,0.15);
    color: #44ff88;
    border: 1px solid #44ff88;
  }

  .badge-disabled {
    background: rgba(255,68,68,0.15);
    color: #ff4444;
    border: 1px solid #ff4444;
  }

  .badge-override {
    background: rgba(255,170,68,0.15);
    color: #ffaa44;
    border: 1px solid #ffaa44;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }

  th {
    text-align: left;
    padding: 8px;
    border-bottom: 2px solid #ff69b4;
    color: #ff69b4;
    font-family: 'VT323', monospace;
    font-size: 18px;
  }

  td {
    padding: 8px;
    border-bottom: 1px solid #1a1a2e;
    font-size: 13px;
  }

  tr:hover td {
    background: rgba(255,105,180,0.05);
  }

  form {
    margin-top: 12px;
  }

  label {
    display: block;
    margin-bottom: 4px;
    color: #9b59b6;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  input[type="text"], input[type="number"], select, textarea {
    width: 100%;
    padding: 8px;
    background: #0a0a0f;
    border: 1px solid #2a2a3e;
    color: #c9c9d1;
    font-family: 'Space Mono', monospace;
    font-size: 14px;
    margin-bottom: 12px;
  }

  input[type="text"]:focus, input[type="number"]:focus, textarea:focus {
    border-color: #ff69b4;
    outline: none;
    box-shadow: 0 0 5px rgba(255,105,180,0.3);
  }

  textarea {
    min-height: 200px;
    resize: vertical;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .form-row-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }

  .flash {
    padding: 10px 16px;
    margin-bottom: 16px;
    border: 1px solid;
    font-family: 'VT323', monospace;
    font-size: 18px;
  }

  .flash-success {
    background: rgba(68,255,136,0.1);
    border-color: #44ff88;
    color: #44ff88;
  }

  .flash-error {
    background: rgba(255,68,68,0.1);
    border-color: #ff4444;
    color: #ff4444;
  }

  .flash-info {
    background: rgba(100,149,237,0.1);
    border-color: #6495ed;
    color: #6495ed;
  }

  .vc-user {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid #1a1a2e;
  }

  .vc-user:last-child { border-bottom: none; }
  .vc-user .name { color: #ff69b4; }
  .vc-user .time { color: #888; font-size: 12px; }
  .vc-user .pending { color: #44ff88; font-family: 'VT323', monospace; font-size: 18px; }

  .setting-group {
    margin-bottom: 24px;
    padding: 16px;
    background: #12121f;
    border: 1px solid #2a2a3e;
    position: relative;
  }

  .setting-group::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px; height: 100%;
    background: #9b59b6;
  }

  .setting-group h3 {
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #2a2a3e;
  }

  .setting-item {
    display: grid;
    grid-template-columns: 200px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(42,42,62,0.5);
  }

  .setting-item:last-child { border-bottom: none; }

  .setting-item .setting-label {
    color: #ff69b4;
    font-family: 'VT323', monospace;
    font-size: 16px;
  }

  .setting-item .setting-desc {
    color: #666;
    font-size: 11px;
    margin-top: 2px;
    font-family: 'Space Mono', monospace;
  }

  .setting-item input {
    margin-bottom: 0;
    max-width: 300px;
  }

  .setting-item .setting-default {
    color: #555;
    font-size: 11px;
    font-family: monospace;
    white-space: nowrap;
  }

  .search-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .search-bar input {
    flex: 1;
    margin-bottom: 0;
  }

  .pagination {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin: 16px 0;
  }

  .txn-type {
    padding: 2px 6px;
    font-size: 10px;
    border-radius: 2px;
    font-family: monospace;
  }

  .txn-reward { background: rgba(68,255,136,0.2); color: #44ff88; }
  .txn-transfer { background: rgba(100,149,237,0.2); color: #6495ed; }
  .txn-casino { background: rgba(255,170,68,0.2); color: #ffaa44; }
  .txn-tax { background: rgba(255,68,68,0.2); color: #ff4444; }
  .txn-other { background: rgba(155,89,182,0.2); color: #9b59b6; }

  /* Memory viewer styles */
  .mem-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
    align-items: center;
  }

  .mem-toolbar input, .mem-toolbar select {
    margin-bottom: 0;
  }

  .mem-toolbar select {
    max-width: 300px;
  }

  .mem-status {
    padding: 6px 12px;
    font-size: 12px;
    font-family: monospace;
    margin-bottom: 8px;
  }

  .mem-status.ok { color: #44ff88; }
  .mem-status.error { color: #ff4444; }
  .mem-status.loading { color: #6495ed; }

  .mem-editor {
    width: 100%;
    min-height: 400px;
    background: #0a0a0f;
    border: 1px solid #2a2a3e;
    color: #c9c9d1;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    padding: 12px;
    resize: vertical;
  }

  .tab-bar {
    display: flex;
    gap: 0;
    margin-bottom: 0;
  }

  .tab-bar button {
    padding: 10px 20px;
    background: #1a1a2e;
    color: #888;
    border: 1px solid #2a2a3e;
    border-bottom: none;
    font-family: 'VT323', monospace;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-bar button:hover { color: #ff69b4; }

  .tab-bar button.active {
    background: #12121f;
    color: #ff69b4;
    border-color: #ff69b4;
    border-bottom: 1px solid #12121f;
    position: relative;
    z-index: 1;
  }

  .tab-content {
    background: #12121f;
    border: 1px solid #2a2a3e;
    padding: 16px;
    margin-top: -1px;
  }

  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #1a1a2e;
    color: #444;
    font-size: 11px;
    text-align: center;
  }

  @media (max-width: 768px) {
    .form-row, .form-row-3 { grid-template-columns: 1fr; }
    .setting-item { grid-template-columns: 1fr; }
    header h1 { font-size: 28px; }
    nav { gap: 4px; }
    nav a { font-size: 14px; padding: 6px 10px; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>SGC CONTROL PANEL</h1>
    <div class="subtitle">SadGirlCoin Economy Management // bind: ${escapeHtml(WEB_PANEL_HOST)}</div>
  </header>
  <nav>
    <a href="${p('/')}">Dashboard</a>
    <a href="${p('/guilds')}">Guilds</a>
    <a href="${p('/stocks')}">Stocks</a>
    <a href="${p('/economy')}">Economy</a>
    <a href="${p('/runtime')}">Runtime</a>
    <a href="${p('/casino')}">Casino</a>
    <a href="${p('/users')}">Users</a>
    <a href="${p('/memory')}">Memory</a>
    <a href="${p('/vc')}">VC Tracker</a>
    <a href="${p('/patrons')}">Patrons</a>
    <a href="${p('/api-apps')}">API Apps</a>
    ${buildUserBadgeHtml(session)}
  </nav>
  ${bodyContent}
  <footer>sadgirlsclub.wtf // economy control panel // local access only</footer>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function renderDashboard() {
  const configs = getAllGuildConfigs();
  let guildsHtml = '';

  for (const cfg of configs) {
    const bbUserId = getBigBusinessUserId(cfg.guildId);
    let balance = 0;
    try { balance = getBigBusinessBalance(bbUserId); } catch { /* store not ready */ }

    guildsHtml += `
      <div class="card">
        <div class="guild-name">${escapeHtml(cfg.guildName)}</div>
        <div class="guild-id">${escapeHtml(cfg.guildId)}</div>
        <span class="badge ${cfg.enabled ? 'badge-enabled' : 'badge-disabled'}">${cfg.enabled ? 'ENABLED' : 'DISABLED'}</span>
        <div>
          <span class="stat">
            <span class="stat-label">Big Business</span><br>
            <span class="stat-value">${escapeHtml(cfg.bigBusinessName)}</span>
          </span>
          <span class="stat">
            <span class="stat-label">Balance</span><br>
            <span class="stat-value">${balance.toLocaleString()} SGC</span>
          </span>
          <span class="stat">
            <span class="stat-label">Starboard</span><br>
            <span class="stat-value">${escapeHtml(cfg.starboardChannelId || 'none')}</span>
          </span>
        </div>
        <div style="margin-top:12px;">
          <a href="${p(`/guilds/${escapeHtml(cfg.guildId)}`)}" class="btn btn-sm">Edit</a>
        </div>
      </div>`;
  }

  // System accounts
  let centralBalance = 0, dollBalance = 0, casinoBalance = 0;
  try {
    centralBalance = getCentralBankBalance();
    dollBalance = getDollStreetBalance();
    casinoBalance = getMomijiCasinoBalance();
  } catch { /* store not ready */ }

  // VC summary
  const now = Date.now();
  const vcCoinsPerHour = getSetting('vc.coinsPerHour');
  let totalVC = 0;
  for (const [, entry] of activeVoiceUsers) {
    totalVC += getVcRewardProgress(entry, now).pendingCoins;
  }

  return buildPageHtml(`
    <h2>> System Overview</h2>
    <div class="card">
      <span class="stat">
        <span class="stat-label">Configured Guilds</span><br>
        <span class="stat-value">${configs.length}</span>
      </span>
      <span class="stat">
        <span class="stat-label">Users in VC</span><br>
        <span class="stat-value">${activeVoiceUsers.size}</span>
      </span>
      <span class="stat">
        <span class="stat-label">Total Pending VC Payout</span><br>
        <span class="stat-value">${totalVC.toLocaleString()} SGC</span>
      </span>
    </div>
    <h2>> System Accounts</h2>
    <div class="card">
      <span class="stat">
        <span class="stat-label">Central Bank</span><br>
        <span class="stat-value">${centralBalance.toLocaleString()} SGC</span>
      </span>
      <span class="stat">
        <span class="stat-label">Doll Street</span><br>
        <span class="stat-value">${dollBalance.toLocaleString()} SGC</span>
      </span>
      <span class="stat">
        <span class="stat-label">Momiji Casino</span><br>
        <span class="stat-value">${casinoBalance.toLocaleString()} SGC</span>
      </span>
    </div>
    <h2>> Guild Businesses</h2>
    ${guildsHtml || '<p style="color:#666;">No guilds configured.</p>'}
  `);
}

function renderStocks(flash = null) {
  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  const stocks = getAllStocks({ includeInactive: true });
  const rows = stocks.map((stock) => {
    const summary = getStockSummary(stock.id);
    return `
      <tr>
        <td><a href="${p(`/stocks/${stock.id}`)}" style="color:#ff69b4;text-decoration:none;">${escapeHtml(stock.ticker)}</a></td>
        <td>${escapeHtml(stock.business_name)}</td>
        <td>${escapeHtml(stock.entity_type === 'synthetic' ? 'Synthetic' : 'Guild')}</td>
        <td>${stock.is_listed ? '<span class="badge badge-enabled">LISTED</span>' : '<span class="badge badge-disabled">DELISTED</span>'}</td>
        <td style="text-align:right;">${Number(stock.share_price || 0).toFixed(2)} SGC</td>
        <td style="text-align:right;">${Number(summary?.marketCap || 0).toFixed(0)} SGC</td>
        <td style="text-align:right;">${summary?.shareholderCount || 0}</td>
      </tr>`;
  }).join('');

  return buildPageHtml(`
    ${flashHtml}
    <h2>> Stock Exchange</h2>
    <table>
      <tr>
        <th>Ticker</th>
        <th>Name</th>
        <th>Type</th>
        <th>Status</th>
        <th style="text-align:right;">Price</th>
        <th style="text-align:right;">Market Cap</th>
        <th style="text-align:right;">Holders</th>
      </tr>
      ${rows || '<tr><td colspan="7" style="color:#666;">No stocks found.</td></tr>'}
    </table>
  `, 'Stocks — SGC Control Panel');
}

function renderStockDetail(stockId, flash = null) {
  const stock = getStockById(stockId);
  if (!stock) {
    return buildPageHtml('<div class="flash flash-error">Stock not found.</div>', 'Stock Not Found');
  }

  const summary = getStockSummary(stock.id);
  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  return buildPageHtml(`
    ${flashHtml}
    <h2>> Stock: ${escapeHtml(stock.business_name)} (${escapeHtml(stock.ticker)})</h2>
    <a href="${p('/stocks')}" class="btn btn-sm" style="margin-bottom:16px;display:inline-block;">&laquo; Back to Stocks</a>

    <div class="card">
      <span class="stat">
        <span class="stat-label">Type</span><br>
        <span class="stat-value">${escapeHtml(stock.entity_type === 'synthetic' ? 'Synthetic' : 'Guild')}</span>
      </span>
      <span class="stat">
        <span class="stat-label">Listed</span><br>
        <span class="stat-value">${stock.is_listed ? 'Yes' : 'No'}</span>
      </span>
      <span class="stat">
        <span class="stat-label">Price</span><br>
        <span class="stat-value">${Number(stock.share_price || 0).toFixed(2)} SGC</span>
      </span>
      <span class="stat">
        <span class="stat-label">Market Cap</span><br>
        <span class="stat-value">${Number(summary?.marketCap || 0).toFixed(0)} SGC</span>
      </span>
      <span class="stat">
        <span class="stat-label">Shareholders</span><br>
        <span class="stat-value">${summary?.shareholderCount || 0}</span>
      </span>
    </div>

    <h3>Edit Stock Name</h3>
    <div class="card">
      <form method="POST" action="${p(`/stocks/${stock.id}/name`)}">
        <div class="form-row">
          <div>
            <label>Display Name</label>
            <input type="text" name="name" value="${escapeHtml(stock.business_name)}" maxlength="80" required>
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button type="submit" class="btn btn-success">Save Name</button>
          </div>
        </div>
      </form>
      <p style="color:#888;font-size:12px;margin-top:8px;">
        Guild stock names also update that guild's Big Business name. Synthetic stock names are pinned so sync will not overwrite them.
      </p>
    </div>

    <h3>Edit Ticker</h3>
    <div class="card">
      <form method="POST" action="${p(`/stocks/${stock.id}/ticker`)}">
        <div class="form-row">
          <div>
            <label>Ticker Symbol</label>
            <input type="text" name="ticker" value="${escapeHtml(stock.ticker)}" maxlength="6" placeholder="e.g., ACME" required style="text-transform:uppercase;">
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button type="submit" class="btn btn-success">Save Ticker</button>
          </div>
        </div>
      </form>
      <p style="color:#888;font-size:12px;margin-top:8px;">
        Alphanumeric only (A-Z, 0-9). Max 6 characters. Ticker input auto-uppercases.
      </p>
    </div>
  `, `Stock ${stock.ticker} — SGC Control Panel`);
}

// ---------------------------------------------------------------------------
// Guild pages (list, edit, create)
// ---------------------------------------------------------------------------

function renderGuildList() {
  const configs = getAllGuildConfigs();
  let rows = '';

  for (const cfg of configs) {
    const bbUserId = getBigBusinessUserId(cfg.guildId);
    let balance = 0;
    try { balance = getBigBusinessBalance(bbUserId); } catch { /* */ }

    rows += `<tr>
      <td>${escapeHtml(cfg.guildName)}</td>
      <td style="font-size:12px;color:#888;">${escapeHtml(cfg.guildId)}</td>
      <td>${escapeHtml(cfg.bigBusinessName)}</td>
      <td style="color:#44ff88;">${balance.toLocaleString()}</td>
      <td><span class="badge ${cfg.enabled ? 'badge-enabled' : 'badge-disabled'}">${cfg.enabled ? 'ON' : 'OFF'}</span></td>
      <td><a href="${p(`/guilds/${escapeHtml(cfg.guildId)}`)}" class="btn btn-sm">Edit</a></td>
    </tr>`;
  }

  return buildPageHtml(`
    <h2>> All Guilds</h2>
    <table>
      <tr><th>Name</th><th>Guild ID</th><th>Business</th><th>Balance</th><th>Status</th><th></th></tr>
      ${rows || '<tr><td colspan="6" style="color:#666;">No guilds configured.</td></tr>'}
    </table>
    <a href="${p('/guilds/new')}" class="btn btn-success">+ Add Guild</a>
  `);
}

function renderReactionRoleRows(assignments, values = {}) {
  const normalized = Array.isArray(assignments)
    ? normalizeReactionRoleAssignments(assignments)
    : [];
  const byIndex = new Map();

  for (let i = 0; i < normalized.length && i < MAX_REACTION_ROLE_ASSIGNMENTS; i++) {
    byIndex.set(i + 1, normalized[i]);
  }

  let html = '';
  for (let index = 1; index <= MAX_REACTION_ROLE_ASSIGNMENTS; index++) {
    const fromBodyEmoji = String(values[`reactionRoleEmoji${index}`] || '').trim();
    const fromBodyRoleId = String(values[`reactionRoleRoleId${index}`] || '').trim();
    const fromCfg = byIndex.get(index);
    const emojiValue = fromBodyEmoji || fromCfg?.emojiLabel || '';
    const roleValue = fromBodyRoleId || fromCfg?.roleId || '';

    html += `
      <div class="form-row">
        <div>
          <label>Emoji #${index}</label>
          <input type="text" name="reactionRoleEmoji${index}" value="${escapeHtml(emojiValue)}" placeholder="⭐ or <:name:1234567890>">
        </div>
        <div>
          <label>Role ID #${index}</label>
          <input type="text" name="reactionRoleRoleId${index}" value="${escapeHtml(roleValue)}" placeholder="123456789012345678">
        </div>
      </div>`;
  }
  return html;
}

function extractReactionRoleAssignmentsFromBody(body) {
  const rawAssignments = [];

  for (let index = 1; index <= MAX_REACTION_ROLE_ASSIGNMENTS; index++) {
    const emojiRaw = String(body[`reactionRoleEmoji${index}`] || '').trim();
    const roleId = String(body[`reactionRoleRoleId${index}`] || '').trim();
    if (!emojiRaw && !roleId) continue;

    if (!emojiRaw || !roleId) {
      return {
        assignments: [],
        error: `Reaction role row #${index} requires both emoji and role ID.`,
      };
    }

    if (!/^\d+$/u.test(roleId)) {
      return {
        assignments: [],
        error: `Reaction role row #${index} has an invalid role ID.`,
      };
    }

    const parsed = parseReactionRoleEmojiInput(emojiRaw);
    if (!parsed) {
      return {
        assignments: [],
        error: `Reaction role row #${index} has an invalid emoji format.`,
      };
    }

    rawAssignments.push({
      emojiKey: parsed.emojiKey,
      emojiLabel: parsed.emojiLabel,
      roleId,
    });
  }

  return {
    assignments: normalizeReactionRoleAssignments(rawAssignments),
    error: null,
  };
}

function renderGuildEdit(guildId, flash = null) {
  const cfg = getGuildConfig(guildId);
  if (!cfg) {
    return buildPageHtml('<div class="flash flash-error">Guild not found.</div>');
  }

  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  return buildPageHtml(`
    ${flashHtml}
    <h2>> Edit Guild: ${escapeHtml(cfg.guildName)}</h2>
    <div class="card">
      <form method="POST" action="${p(`/guilds/${escapeHtml(cfg.guildId)}`)}">
        <div class="form-row">
          <div>
            <label>Guild Name</label>
            <input type="text" name="guildName" value="${escapeHtml(cfg.guildName)}" required>
          </div>
          <div>
            <label>Guild ID</label>
            <input type="text" name="guildId" value="${escapeHtml(cfg.guildId)}" required>
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Big Business Name</label>
            <input type="text" name="bigBusinessName" value="${escapeHtml(cfg.bigBusinessName)}" required>
          </div>
          <div>
            <label>Big Business Channel ID</label>
            <input type="text" name="bigBusinessChannelId" value="${escapeHtml(cfg.bigBusinessChannelId)}">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Big Business Role ID</label>
            <input type="text" name="bigBusinessRoleId" value="${escapeHtml(cfg.bigBusinessRoleId || '')}" placeholder="Role ping for LumiStocks/LumiBets updates">
          </div>
          <div>
            <label>Reaction Role Message ID</label>
            <input type="text" name="reactionRoleMessageId" value="${escapeHtml(cfg.reactionRoleMessageId || '')}" placeholder="Message Lumi watches for reaction roles">
          </div>
        </div>
        <div class="card" style="margin:10px 0;">
          <h3 style="margin:0 0 8px;">Reaction Role Assignments</h3>
          <p style="font-size:12px;color:#888;margin-bottom:10px;">
            Configure up to ${MAX_REACTION_ROLE_ASSIGNMENTS} emoji-to-role mappings for the message above.
          </p>
          ${renderReactionRoleRows(cfg.reactionRoleAssignments || [])}
        </div>
        <div class="form-row">
          <div>
            <label>LumiBets Channel ID</label>
            <input type="text" name="lumiBetsChannelId" value="${escapeHtml(cfg.lumiBetsChannelId || '')}">
          </div>
          <div>
            <label>LumiBets Archive Channel ID</label>
            <input type="text" name="lumiBetsArchiveChannelId" value="${escapeHtml(cfg.lumiBetsArchiveChannelId || '')}">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Starboard Channel ID</label>
            <input type="text" name="starboardChannelId" value="${escapeHtml(cfg.starboardChannelId)}">
          </div>
          <div>
            <label>Min Stars</label>
            <input type="number" name="starboardMinStars" value="${cfg.starboardMinStars}" min="1">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Starboard Emoji Name</label>
            <input type="text" name="starboardEmojiName" value="${escapeHtml(cfg.starboardEmojiName)}">
          </div>
          <div>
            <label>Enabled</label>
            <select name="enabled">
              <option value="true" ${cfg.enabled ? 'selected' : ''}>Enabled</option>
              <option value="false" ${!cfg.enabled ? 'selected' : ''}>Disabled</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-success" style="margin-top:8px;">Save Changes</button>
      </form>
      <form method="POST" action="${p(`/guilds/${escapeHtml(cfg.guildId)}/delete`)}" style="margin-top:12px;">
        <button type="submit" class="btn btn-danger" onclick="return confirm('Remove this guild config?')">Remove Guild</button>
      </form>
    </div>
  `);
}

function renderGuildNew(flash = null, prefill = {}) {
  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  return buildPageHtml(`
    ${flashHtml}
    <h2>> Add New Guild</h2>
    <div class="card">
      <form method="POST" action="${p('/guilds/new')}">
        <div class="form-row">
          <div>
            <label>Guild ID *</label>
            <input type="text" name="guildId" value="${escapeHtml(prefill.guildId || '')}" required>
          </div>
          <div>
            <label>Guild Name *</label>
            <input type="text" name="guildName" value="${escapeHtml(prefill.guildName || '')}" required>
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Big Business Name</label>
            <input type="text" name="bigBusinessName" value="${escapeHtml(prefill.bigBusinessName || 'Big Business Inc')}">
          </div>
          <div>
            <label>Big Business Channel ID</label>
            <input type="text" name="bigBusinessChannelId" value="${escapeHtml(prefill.bigBusinessChannelId || '')}">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Big Business Role ID</label>
            <input type="text" name="bigBusinessRoleId" value="${escapeHtml(prefill.bigBusinessRoleId || '')}" placeholder="Role ping for LumiStocks/LumiBets updates">
          </div>
          <div>
            <label>Reaction Role Message ID</label>
            <input type="text" name="reactionRoleMessageId" value="${escapeHtml(prefill.reactionRoleMessageId || '')}" placeholder="Message Lumi watches for reaction roles">
          </div>
        </div>
        <div class="card" style="margin:10px 0;">
          <h3 style="margin:0 0 8px;">Reaction Role Assignments</h3>
          <p style="font-size:12px;color:#888;margin-bottom:10px;">
            Configure up to ${MAX_REACTION_ROLE_ASSIGNMENTS} emoji-to-role mappings for the message above.
          </p>
          ${renderReactionRoleRows(prefill.reactionRoleAssignments || [], prefill)}
        </div>
        <div class="form-row">
          <div>
            <label>LumiBets Channel ID</label>
            <input type="text" name="lumiBetsChannelId" value="${escapeHtml(prefill.lumiBetsChannelId || '')}">
          </div>
          <div>
            <label>LumiBets Archive Channel ID</label>
            <input type="text" name="lumiBetsArchiveChannelId" value="${escapeHtml(prefill.lumiBetsArchiveChannelId || '')}">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Starboard Channel ID</label>
            <input type="text" name="starboardChannelId" value="${escapeHtml(prefill.starboardChannelId || '')}">
          </div>
          <div>
            <label>Min Stars</label>
            <input type="number" name="starboardMinStars" value="${prefill.starboardMinStars || 4}" min="1">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Starboard Emoji Name</label>
            <input type="text" name="starboardEmojiName" value="${escapeHtml(prefill.starboardEmojiName || 'star')}">
          </div>
          <div>
            <label>Enabled</label>
            <select name="enabled">
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-success" style="margin-top:8px;">Create Guild</button>
      </form>
    </div>
  `);
}

// ---------------------------------------------------------------------------
// VC Tracker
// ---------------------------------------------------------------------------

function renderVcTracker() {
  const now = Date.now();
  const configs = getAllGuildConfigs();
  const guildNames = new Map();
  for (const cfg of configs) {
    guildNames.set(cfg.guildId, cfg.guildName);
  }

  const vcCoinsPerHour = getSetting('vc.coinsPerHour');
  let usersHtml = '';
  for (const [userId, entry] of activeVoiceUsers) {
    const progress = getVcRewardProgress(entry, now);
    const hours = Math.floor(progress.rewardSeconds / 3600);
    const minutes = Math.floor((progress.rewardSeconds % 3600) / 60);
    const pending = progress.pendingCoins;
    const guild = guildNames.get(entry.guildId) || entry.guildId || 'unknown';

    usersHtml += `
      <div class="vc-user">
        <span class="name">${escapeHtml(entry.username || userId)}</span>
        <span class="time">${hours}h ${minutes}m in VC</span>
        <span class="pending">${pending} SGC pending</span>
        <span class="badge badge-enabled" style="font-size:10px;">${escapeHtml(guild)}</span>
      </div>`;
  }

  return buildPageHtml(`
    <h2>> Voice Channel Tracker</h2>
    <div class="card">
      <span class="stat">
        <span class="stat-label">Users in VC</span><br>
        <span class="stat-value">${activeVoiceUsers.size}</span>
      </span>
      <span class="stat">
        <span class="stat-label">Coins Per Hour</span><br>
        <span class="stat-value">${vcCoinsPerHour} SGC</span>
      </span>
    </div>
    <div class="card">
      <h3 style="margin:0 0 12px;">Currently In Voice</h3>
      ${usersHtml || '<p style="color:#666;">No users currently in voice channels.</p>'}
    </div>
    ${renderVcLeaderboard()}
  `);
}

function renderVcLeaderboard() {
  const lb = getVcLeaderboard(20);
  if (lb.length === 0) {
    return '<div class="card"><p style="color:#666;">No VC time tracked yet.</p></div>';
  }

  let rowsHtml = '';
  for (let i = 0; i < lb.length; i++) {
    const row = lb[i];
    const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
    const inVc = activeVoiceUsers.has(row.user_id) ? '<span class="badge badge-enabled" style="font-size:9px;margin-left:6px;">IN VC</span>' : '';
    rowsHtml += `
      <tr>
        <td style="text-align:center;width:40px;">${medal}</td>
        <td>${escapeHtml(row.username || row.user_id)}${inVc}</td>
        <td style="text-align:right;">${formatVcTime(row.total_seconds)}</td>
      </tr>`;
  }

  return `
    <div class="card">
      <h3 style="margin:0 0 12px;">🎧 All-Time VC Leaderboard</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #333;">
            <th style="text-align:center;padding:4px;">Rank</th>
            <th style="text-align:left;padding:4px;">User</th>
            <th style="text-align:right;padding:4px;">Total Time</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Patreon Rewards Tracker
// ---------------------------------------------------------------------------

function renderPatrons() {
  const stats = getPatreonStats();
  const patrons = getAllPatrons();

  let tierCardsHtml = '';
  for (const t of stats.perTier) {
    tierCardsHtml += `
      <span class="stat">
        <span class="stat-label">${escapeHtml(t.label)}</span><br>
        <span class="stat-value">${t.count} patron${t.count === 1 ? '' : 's'}</span>
      </span>`;
  }

  let rowsHtml = '';
  if (patrons.length === 0) {
    rowsHtml = '<tr><td colspan="7" style="color:#666;text-align:center;padding:12px;">No patrons recorded yet.</td></tr>';
  } else {
    for (const p of patrons) {
      const tier = getTierInfo(p.tier_role_id);
      const tierLabel = tier ? tier.label : (p.tier_role_id ? `Unknown (${p.tier_role_id})` : '— inactive —');
      const signupBadge = p.signup_bonus_paid
        ? `<span class="badge badge-enabled" style="font-size:10px;">PAID</span>`
        : `<span class="badge badge-disabled" style="font-size:10px;">PENDING</span>`;
      const last = p.last_payout_period
        ? `${escapeHtml(p.last_payout_period)}<br><span style="color:#666;font-size:10px;">${escapeHtml(p.last_payout_at || '')}</span>`
        : '<span style="color:#666;">never</span>';
      const signupAt = p.signup_bonus_at ? escapeHtml(p.signup_bonus_at) : '—';
      rowsHtml += `
        <tr>
          <td>${escapeHtml(p.username || p.user_id)}</td>
          <td><span style="color:#666;font-size:11px;">${escapeHtml(p.user_id)}</span></td>
          <td>${escapeHtml(tierLabel)}</td>
          <td style="text-align:center;">${signupBadge}<br><span style="color:#666;font-size:10px;">${signupAt}</span></td>
          <td style="text-align:right;"><strong>${p.total_months_paid}</strong></td>
          <td>${last}</td>
          <td style="color:#666;font-size:11px;">${escapeHtml(p.first_seen_at || '')}</td>
        </tr>`;
    }
  }

  return buildPageHtml(`
    <h2>> Patreon Supporters</h2>
    <div class="card">
      <span class="stat">
        <span class="stat-label">Tracked Patrons</span><br>
        <span class="stat-value">${stats.totalPatrons}</span>
      </span>
      <span class="stat">
        <span class="stat-label">Currently Active</span><br>
        <span class="stat-value">${stats.activePatrons}</span>
      </span>
      <span class="stat">
        <span class="stat-label">Total SGC Paid</span><br>
        <span class="stat-value">${stats.totalPaid.toLocaleString()}</span>
      </span>
      ${tierCardsHtml}
    </div>
    <div class="card">
      <h3 style="margin:0 0 12px;">💖 Patron Roster</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #333;">
            <th style="text-align:left;padding:4px;">User</th>
            <th style="text-align:left;padding:4px;">ID</th>
            <th style="text-align:left;padding:4px;">Tier</th>
            <th style="text-align:center;padding:4px;">Signup Bonus</th>
            <th style="text-align:right;padding:4px;">Months Paid</th>
            <th style="text-align:left;padding:4px;">Last Payout</th>
            <th style="text-align:left;padding:4px;">First Seen</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="card">
      <p style="color:#888;font-size:12px;">
        Monthly stipends are paid on the 1st of each month (UTC). New patrons receive a one-time
        signup bonus equal to their tier amount. Missed payouts are applied retroactively on the
        next sweep (hourly + on bot startup).
      </p>
    </div>
  `, 'Patrons');
}

// ---------------------------------------------------------------------------
// Economy Settings
// ---------------------------------------------------------------------------

function renderSettingsGroup(categoryMap, formAction, pageTitle) {
  let groupsHtml = '';

  for (const [category, settings] of categoryMap) {
    let itemsHtml = '';
    for (const s of settings) {
      const overrideBadge = s.isOverridden
        ? '<span class="badge badge-override" style="margin-left:8px;">CUSTOM</span>'
        : '';
      const inputType = s.type === 'number' ? 'number' : 'text';
      const step = s.type === 'number' && String(s.default).includes('.') ? 'step="any"' : '';

      itemsHtml += `
        <div class="setting-item">
          <div>
            <div class="setting-label">${escapeHtml(s.label)}${overrideBadge}</div>
            <div class="setting-desc">${escapeHtml(s.desc)}</div>
          </div>
          <input type="${inputType}" name="${escapeHtml(s.key)}" value="${escapeHtml(String(s.value))}" ${step}>
          <div class="setting-default">default: ${escapeHtml(String(s.default))}</div>
        </div>`;
    }

    groupsHtml += `
      <div class="setting-group">
        <h3>${escapeHtml(category)}</h3>
        ${itemsHtml}
      </div>`;
  }

  return buildPageHtml(`
    <h2>> ${escapeHtml(pageTitle)}</h2>
    <div class="flash flash-info">Changes are saved to the database and take effect on bot restart, or immediately for new game sessions.</div>
    <form method="POST" action="${escapeHtml(formAction)}">
      ${groupsHtml}
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button type="submit" class="btn btn-success">Save All Settings</button>
        <a href="${escapeHtml(formAction)}/reset" class="btn btn-danger" onclick="return confirm('Reset all settings on this page to defaults?')">Reset to Defaults</a>
      </div>
    </form>
  `);
}

function renderEconomy(flash = null) {
  const categories = getSettingsByCategories(['Economy', 'Tax', 'Casino Reserve', 'Scheduler', 'VC Rewards', 'Big Business', 'Runtime Channels', 'Chatbot', 'Search']);
  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  let groupsHtml = '';
  for (const [category, settings] of categories) {
    let itemsHtml = '';
    for (const s of settings) {
      const overrideBadge = s.isOverridden
        ? '<span class="badge badge-override" style="margin-left:8px;">CUSTOM</span>'
        : '';
      const inputType = s.type === 'number' ? 'number' : 'text';
      const step = s.type === 'number' && String(s.default).includes('.') ? 'step="any"' : '';

      itemsHtml += `
        <div class="setting-item">
          <div>
            <div class="setting-label">${escapeHtml(s.label)}${overrideBadge}</div>
            <div class="setting-desc">${escapeHtml(s.desc)}</div>
          </div>
          <input type="${inputType}" name="${escapeHtml(s.key)}" value="${escapeHtml(String(s.value))}" ${step}>
          <div class="setting-default">default: ${escapeHtml(String(s.default))}</div>
        </div>`;
    }

    groupsHtml += `
      <div class="setting-group">
        <h3>${escapeHtml(category)}</h3>
        ${itemsHtml}
      </div>`;
  }

  return buildPageHtml(`
    ${flashHtml}
    <h2>> Economy Settings</h2>
    <div class="flash flash-info">Changes are saved to the database. Settings take effect on next bot restart or new game session.</div>
    <form method="POST" action="${p('/economy')}">
      ${groupsHtml}
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button type="submit" class="btn btn-success">Save Economy Settings</button>
        <a href="${p('/economy/reset')}" class="btn btn-danger" onclick="return confirm('Reset ALL economy settings to defaults?')">Reset to Defaults</a>
      </div>
    </form>
  `);
}

function renderRuntime(flash = null) {
  const categories = getSettingsByCategories(['Runtime Channels', 'Chatbot', 'Search', 'Big Business', 'VC Rewards']);
  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  let groupsHtml = '';
  for (const [category, settings] of categories) {
    let itemsHtml = '';
    for (const s of settings) {
      const overrideBadge = s.isOverridden
        ? '<span class="badge badge-override" style="margin-left:8px;">CUSTOM</span>'
        : '';
      const inputType = s.type === 'number' ? 'number' : 'text';
      const step = s.type === 'number' && String(s.default).includes('.') ? 'step="any"' : '';

      itemsHtml += `
        <div class="setting-item">
          <div>
            <div class="setting-label">${escapeHtml(s.label)}${overrideBadge}</div>
            <div class="setting-desc">${escapeHtml(s.desc)}</div>
          </div>
          <input type="${inputType}" name="${escapeHtml(s.key)}" value="${escapeHtml(String(s.value))}" ${step}>
          <div class="setting-default">default: ${escapeHtml(String(s.default))}</div>
        </div>`;
    }

    groupsHtml += `
      <div class="setting-group">
        <h3>${escapeHtml(category)}</h3>
        ${itemsHtml}
      </div>`;
  }

  return buildPageHtml(`
    ${flashHtml}
    <h2>> Runtime Settings</h2>
    <div class="flash flash-info">These settings are intended for live runtime control and are hot-reloaded by the panel where supported.</div>
    <form method="POST" action="${p('/runtime')}">
      ${groupsHtml}
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button type="submit" class="btn btn-success">Save Runtime Settings</button>
        <a href="${p('/runtime/reset')}" class="btn btn-danger" onclick="return confirm('Reset ALL runtime settings to defaults?')">Reset to Defaults</a>
      </div>
    </form>
  `);
}

// ---------------------------------------------------------------------------
// Casino Settings
// ---------------------------------------------------------------------------

function renderCasino(flash = null) {
  const categories = getSettingsByCategories(['Slots', 'Pachinko', 'Blackjack', "Texas Hold'em", 'Horse Racing']);
  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  let groupsHtml = '';
  for (const [category, settings] of categories) {
    let itemsHtml = '';
    for (const s of settings) {
      const overrideBadge = s.isOverridden
        ? '<span class="badge badge-override" style="margin-left:8px;">CUSTOM</span>'
        : '';
      const inputType = s.type === 'number' ? 'number' : 'text';
      const step = s.type === 'number' && String(s.default).includes('.') ? 'step="any"' : '';

      itemsHtml += `
        <div class="setting-item">
          <div>
            <div class="setting-label">${escapeHtml(s.label)}${overrideBadge}</div>
            <div class="setting-desc">${escapeHtml(s.desc)}</div>
          </div>
          <input type="${inputType}" name="${escapeHtml(s.key)}" value="${escapeHtml(String(s.value))}" ${step}>
          <div class="setting-default">default: ${escapeHtml(String(s.default))}</div>
        </div>`;
    }

    groupsHtml += `
      <div class="setting-group">
        <h3>🎰 ${escapeHtml(category)}</h3>
        ${itemsHtml}
      </div>`;
  }

  return buildPageHtml(`
    ${flashHtml}
    <h2>> Momiji Casino Settings</h2>
    <div class="flash flash-info">Changes are saved to the database. Settings take effect on next bot restart or new game session.</div>
    <form method="POST" action="${p('/casino')}">
      ${groupsHtml}
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button type="submit" class="btn btn-success">Save Casino Settings</button>
        <a href="${p('/casino/reset')}" class="btn btn-danger" onclick="return confirm('Reset ALL casino settings to defaults?')">Reset to Defaults</a>
      </div>
    </form>
  `);
}

// ---------------------------------------------------------------------------
// User Manager
// ---------------------------------------------------------------------------

function renderUsers(query = '', page = 1) {
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  let accounts, total;

  if (query) {
    const results = searchAccounts(query, 200);
    total = results.length;
    accounts = results.slice(offset, offset + pageSize);
  } else {
    const result = getAllAccounts(pageSize, offset);
    accounts = result.accounts;
    total = result.total;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  let rows = '';
  for (const acct of accounts) {
    const isSystem = acct.user_id.startsWith('__');
    const nameColor = isSystem ? '#9b59b6' : '#ff69b4';
    rows += `<tr>
      <td><a href="${p(`/users/${encodeURIComponent(acct.user_id)}`)}" style="color:${nameColor};text-decoration:none;">${escapeHtml(acct.username || acct.user_id)}</a></td>
      <td style="font-size:11px;color:#666;">${escapeHtml(acct.user_id)}</td>
      <td style="color:#44ff88;font-family:'VT323',monospace;font-size:18px;">${(acct.balance || 0).toLocaleString()}</td>
      <td style="color:#6495ed;">${(acct.total_earned || 0).toLocaleString()}</td>
      <td style="color:#ff4444;">${(acct.total_spent || 0).toLocaleString()}</td>
      <td style="font-size:11px;color:#666;">${escapeHtml(acct.created_at || '')}</td>
    </tr>`;
  }

  let paginationHtml = '';
  if (totalPages > 1) {
    const qParam = query ? `&q=${encodeURIComponent(query)}` : '';
    paginationHtml = '<div class="pagination">';
    if (page > 1) {
      paginationHtml += `<a href="${p(`/users?page=${page - 1}${qParam}`)}" class="btn btn-sm">&laquo; Prev</a>`;
    }
    paginationHtml += `<span class="badge badge-enabled" style="padding:6px 12px;">Page ${page} / ${totalPages}</span>`;
    if (page < totalPages) {
      paginationHtml += `<a href="${p(`/users?page=${page + 1}${qParam}`)}" class="btn btn-sm">Next &raquo;</a>`;
    }
    paginationHtml += '</div>';
  }

  return buildPageHtml(`
    <h2>> User Manager</h2>
    <div class="card">
      <span class="stat">
        <span class="stat-label">Total Accounts</span><br>
        <span class="stat-value">${total.toLocaleString()}</span>
      </span>
    </div>
    <form method="GET" action="${p('/users')}">
      <div class="search-bar">
        <input type="text" name="q" value="${escapeHtml(query)}" placeholder="Search by username or user ID...">
        <button type="submit" class="btn">Search</button>
        ${query ? `<a href="${p('/users')}" class="btn btn-warn">Clear</a>` : ''}
      </div>
    </form>
    <table>
      <tr>
        <th>Username</th>
        <th>User ID</th>
        <th>Balance</th>
        <th>Earned</th>
        <th>Spent</th>
        <th>Created</th>
      </tr>
      ${rows || '<tr><td colspan="6" style="color:#666;">No accounts found.</td></tr>'}
    </table>
    ${paginationHtml}
  `);
}

function getTxnTypeClass(type) {
  if (!type) return 'txn-other';
  if (type.includes('reward') || type.includes('voice') || type.includes('starboard') || type.includes('lottery') || type.includes('raffle')) return 'txn-reward';
  if (type.includes('transfer') || type.includes('withdrawal')) return 'txn-transfer';
  if (type.includes('casino') || type.includes('bet') || type.includes('payout') || type.includes('pachinko')) return 'txn-casino';
  if (type.includes('tax') || type.includes('reserve')) return 'txn-tax';
  return 'txn-other';
}

function renderUserDetail(userId, flash = null) {
  const acct = getAccountInfo(userId);
  if (!acct) {
    return buildPageHtml('<div class="flash flash-error">Account not found.</div>');
  }

  const transactions = getUserTransactions(userId, 100);
  const flashHtml = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-success'}">${escapeHtml(flash.message)}</div>`
    : '';

  let txnRows = '';
  for (const txn of transactions) {
    const typeClass = getTxnTypeClass(txn.type);
    const direction = txn.to_user_id === userId ? '+' : '-';
    const dirColor = direction === '+' ? '#44ff88' : '#ff4444';
    const otherParty = direction === '+'
      ? (txn.from_user_id || 'SYSTEM')
      : txn.to_user_id;

    txnRows += `<tr>
      <td style="font-size:11px;color:#666;">${txn.id}</td>
      <td><span class="txn-type ${typeClass}">${escapeHtml(txn.type)}</span></td>
      <td style="color:${dirColor};font-family:'VT323',monospace;font-size:16px;">${direction}${txn.amount.toLocaleString()}</td>
      <td style="color:#888;">${txn.fee > 0 ? txn.fee.toLocaleString() + ' fee' : ''}</td>
      <td style="font-size:11px;">${escapeHtml(otherParty)}</td>
      <td style="font-size:11px;color:#666;">${escapeHtml(txn.note || '')}</td>
      <td style="font-size:10px;color:#555;">${escapeHtml(txn.created_at || '')}</td>
    </tr>`;
  }

  return buildPageHtml(`
    ${flashHtml}
    <h2>> User: ${escapeHtml(acct.username || acct.user_id)}</h2>
    <a href="${p('/users')}" class="btn btn-sm" style="margin-bottom:16px;display:inline-block;">&laquo; Back to Users</a>
    <div class="card">
      <div class="form-row">
        <div>
          <span class="stat">
            <span class="stat-label">User ID</span><br>
            <span class="stat-value" style="font-size:14px;">${escapeHtml(acct.user_id)}</span>
          </span>
        </div>
        <div>
          <span class="stat">
            <span class="stat-label">Username</span><br>
            <span class="stat-value">${escapeHtml(acct.username || 'unknown')}</span>
          </span>
        </div>
      </div>
      <div>
        <span class="stat">
          <span class="stat-label">Balance</span><br>
          <span class="stat-value">${(acct.balance || 0).toLocaleString()} SGC</span>
        </span>
        <span class="stat">
          <span class="stat-label">Total Earned</span><br>
          <span class="stat-value" style="color:#6495ed;">${(acct.total_earned || 0).toLocaleString()}</span>
        </span>
        <span class="stat">
          <span class="stat-label">Total Spent</span><br>
          <span class="stat-value" style="color:#ff4444;">${(acct.total_spent || 0).toLocaleString()}</span>
        </span>
      </div>
      <div style="margin-top:8px;">
        <span class="stat">
          <span class="stat-label">Created</span><br>
          <span style="color:#888;font-size:12px;">${escapeHtml(acct.created_at || '')}</span>
        </span>
        <span class="stat">
          <span class="stat-label">Updated</span><br>
          <span style="color:#888;font-size:12px;">${escapeHtml(acct.updated_at || '')}</span>
        </span>
      </div>
    </div>

    <h3>Adjust Balance</h3>
    <div class="card">
      <form method="POST" action="${p(`/users/${encodeURIComponent(acct.user_id)}/adjust`)}">
        <div class="form-row-3">
          <div>
            <label>Amount (positive to add, negative to remove)</label>
            <input type="number" name="amount" value="0" required>
          </div>
          <div>
            <label>Reason / Note</label>
            <input type="text" name="note" placeholder="Admin adjustment">
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button type="submit" class="btn btn-warn" onclick="return confirm('Adjust this user\\'s balance?')">Apply Adjustment</button>
          </div>
        </div>
      </form>
    </div>

    <h3>Transaction History (last 100)</h3>
    <div style="overflow-x:auto;">
      <table>
        <tr>
          <th>ID</th>
          <th>Type</th>
          <th>Amount</th>
          <th>Fee</th>
          <th>Other Party</th>
          <th>Note</th>
          <th>Date</th>
        </tr>
        ${txnRows || '<tr><td colspan="7" style="color:#666;">No transactions found.</td></tr>'}
      </table>
    </div>
  `);
}

// ---------------------------------------------------------------------------
// Memory Viewer
// ---------------------------------------------------------------------------

function renderMemory() {
  return buildPageHtml(`
    <h2>> Memory Viewer</h2>
    <p style="color:#888;margin-bottom:16px;font-size:12px;">
      Connected to chatbot memory service at ${escapeHtml(MEMORY_SERVICE_URL)}
    </p>

    <div class="tab-bar">
      <button class="active" onclick="switchTab('state')">Runtime State</button>
      <button onclick="switchTab('users')">User Explorer</button>
    </div>

    <div class="tab-content">
      <!-- Runtime State Tab -->
      <div id="tab-state" class="tab-pane active">
        <div class="mem-toolbar">
          <button class="btn btn-sm" onclick="loadState()">Load State</button>
          <button class="btn btn-sm btn-success" onclick="saveState()">Save State</button>
          <button class="btn btn-sm btn-warn" onclick="formatJson()">Format JSON</button>
          <button class="btn btn-sm btn-danger" onclick="loadBlank()">Blank Snapshot</button>
        </div>
        <div id="stateStatus" class="mem-status"></div>
        <div id="stateSummary" style="color:#888;font-size:12px;margin-bottom:8px;"></div>
        <textarea id="stateEditor" class="mem-editor" spellcheck="false"></textarea>
      </div>

      <!-- User Explorer Tab -->
      <div id="tab-users" class="tab-pane">
        <div class="mem-toolbar">
          <button class="btn btn-sm" onclick="refreshMemUsers()">Refresh Users</button>
          <select id="memUserSelect" onchange="loadMemUser()" style="min-width:200px;">
            <option value="">Select a user...</option>
          </select>
          <input id="memUserLimit" type="number" min="1" max="500" value="100" style="width:80px;" placeholder="Limit">
          <button class="btn btn-sm" onclick="loadMemUser()">Load Latest</button>
        </div>
        <div class="mem-toolbar">
          <input id="memUserQuery" type="text" placeholder="Search selected user's memory..." style="flex:1;min-width:200px;">
          <button class="btn btn-sm" onclick="searchMemUser()">Search</button>
          <button class="btn btn-sm btn-warn" onclick="clearMemView()">Clear</button>
        </div>
        <div id="userMemStatus" class="mem-status"></div>
        <div id="userMemSummary" style="color:#888;font-size:12px;margin-bottom:8px;"></div>
        <textarea id="userMemEditor" class="mem-editor" spellcheck="false" readonly></textarea>
      </div>
    </div>

    <script>
      const MEMORY_API = '/api/memory';

      // Tab switching
      function switchTab(tabId) {
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
        document.getElementById('tab-' + tabId).classList.add('active');
        event.target.classList.add('active');
      }

      // Status helpers
      function setMemStatus(id, msg, cls) {
        const el = document.getElementById(id);
        el.textContent = msg;
        el.className = 'mem-status ' + (cls || '');
      }

      // ── Runtime State ──
      async function memFetch(path, opts) {
        const resp = await fetch(MEMORY_API + path, opts);
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error(data?.error || 'Request failed (' + resp.status + ')');
        return data;
      }

      async function loadState() {
        setMemStatus('stateStatus', 'Loading runtime state...', 'loading');
        try {
          const data = await memFetch('/state');
          document.getElementById('stateEditor').value = JSON.stringify(data, null, 2);
          const channels = Object.keys(data?.channels || {}).length;
          const settings = Object.keys(data?.settings || {}).length;
          document.getElementById('stateSummary').textContent = 'Channels: ' + channels + ' | Settings: ' + settings;
          setMemStatus('stateStatus', 'Loaded runtime state.', 'ok');
        } catch (e) {
          setMemStatus('stateStatus', e.message, 'error');
        }
      }

      async function saveState() {
        let parsed;
        try {
          parsed = JSON.parse(document.getElementById('stateEditor').value || '{}');
        } catch (e) {
          setMemStatus('stateStatus', 'Invalid JSON: ' + e.message, 'error');
          return;
        }
        setMemStatus('stateStatus', 'Saving...', 'loading');
        try {
          await memFetch('/state', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsed),
          });
          document.getElementById('stateEditor').value = JSON.stringify(parsed, null, 2);
          setMemStatus('stateStatus', 'Saved runtime state.', 'ok');
        } catch (e) {
          setMemStatus('stateStatus', e.message, 'error');
        }
      }

      function formatJson() {
        try {
          const parsed = JSON.parse(document.getElementById('stateEditor').value || '{}');
          document.getElementById('stateEditor').value = JSON.stringify(parsed, null, 2);
          setMemStatus('stateStatus', 'Formatted.', 'ok');
        } catch (e) {
          setMemStatus('stateStatus', 'Invalid JSON: ' + e.message, 'error');
        }
      }

      function loadBlank() {
        document.getElementById('stateEditor').value = JSON.stringify({ channels: {}, settings: {} }, null, 2);
        document.getElementById('stateSummary').textContent = 'Channels: 0 | Settings: 0';
        setMemStatus('stateStatus', 'Blank snapshot loaded (not saved).', '');
      }

      // ── User Explorer ──
      let memUsers = [];

      async function refreshMemUsers() {
        setMemStatus('userMemStatus', 'Loading users...', 'loading');
        try {
          const data = await memFetch('/users');
          memUsers = Array.isArray(data?.users) ? data.users : [];
          const select = document.getElementById('memUserSelect');
          select.innerHTML = '<option value="">Select a user...</option>';
          memUsers.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.userId;
            opt.textContent = u.userId + ' (' + (u.entryCount || 0) + ' entries)';
            select.appendChild(opt);
          });
          const totalEntries = memUsers.reduce((s, u) => s + (Number(u.entryCount) || 0), 0);
          document.getElementById('userMemSummary').textContent =
            'Users: ' + memUsers.length + ' | Total entries: ' + totalEntries;
          setMemStatus('userMemStatus', 'Loaded ' + memUsers.length + ' users.', 'ok');
        } catch (e) {
          setMemStatus('userMemStatus', e.message, 'error');
        }
      }

      async function loadMemUser() {
        const userId = document.getElementById('memUserSelect').value;
        if (!userId) { setMemStatus('userMemStatus', 'Select a user first.', 'error'); return; }
        const limit = parseInt(document.getElementById('memUserLimit').value) || 100;
        setMemStatus('userMemStatus', 'Loading...', 'loading');
        try {
          const data = await memFetch('/user/' + encodeURIComponent(userId) + '?limit=' + limit);
          document.getElementById('userMemEditor').value = JSON.stringify(data, null, 2);
          const shown = Array.isArray(data?.entries) ? data.entries.length : 0;
          document.getElementById('userMemSummary').textContent =
            'User: ' + userId + ' | Showing: ' + shown + '/' + (data?.totalEntries || 0);
          setMemStatus('userMemStatus', 'Loaded ' + shown + ' entries for ' + userId + '.', 'ok');
        } catch (e) {
          setMemStatus('userMemStatus', e.message, 'error');
        }
      }

      async function searchMemUser() {
        const userId = document.getElementById('memUserSelect').value;
        if (!userId) { setMemStatus('userMemStatus', 'Select a user first.', 'error'); return; }
        const query = document.getElementById('memUserQuery').value.trim();
        if (!query) { setMemStatus('userMemStatus', 'Enter search text.', 'error'); return; }
        const limit = parseInt(document.getElementById('memUserLimit').value) || 100;
        setMemStatus('userMemStatus', 'Searching...', 'loading');
        try {
          const data = await memFetch('/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId, query, deep: false, limit }),
          });
          document.getElementById('userMemEditor').value = JSON.stringify(data, null, 2);
          const matches = Array.isArray(data?.matches) ? data.matches.length : 0;
          document.getElementById('userMemSummary').textContent =
            'User: ' + userId + ' | Matches: ' + matches;
          setMemStatus('userMemStatus', 'Found ' + matches + ' matches.', 'ok');
        } catch (e) {
          setMemStatus('userMemStatus', e.message, 'error');
        }
      }

      function clearMemView() {
        document.getElementById('memUserQuery').value = '';
        document.getElementById('userMemEditor').value = '';
        document.getElementById('userMemSummary').textContent = '';
        setMemStatus('userMemStatus', 'Cleared.', '');
      }

      // Auto-load state + users on page load
      loadState();
      refreshMemUsers();
    </script>
  `, 'Memory Viewer — SGC Control Panel');
}

// ---------------------------------------------------------------------------
// External API admin views
// ---------------------------------------------------------------------------

function renderFlash(flash) {
  if (!flash) return '';
  const cls = flash.type === 'error' ? 'flash-error' : flash.type === 'success' ? 'flash-success' : 'flash-info';
  return `<div class="flash ${cls}">${escapeHtml(flash.message)}</div>`;
}

function getBridgeConfigView() {
  const token = String(getSystemState('bridge.token') || process.env.SGC_BRIDGE_TOKEN || '').trim();
  const treasuryUserId = String(getSystemState('bridge.treasury_user_id') || process.env.SGC_BRIDGE_TREASURY_USER_ID || '').trim();
  const maxPayoutAmount = String(getSystemState('bridge.max_payout_amount') || process.env.SGC_BRIDGE_MAX_PAYOUT_AMOUNT || '250000').trim();
  const mode = String(getSystemState('bridge.mode') || process.env.SGC_BRIDGE_MODE || 'treasury').trim().toLowerCase() === 'mint'
    ? 'mint'
    : 'treasury';
  return {
    token,
    treasuryUserId,
    maxPayoutAmount,
    mode,
    tokenPreview: token ? `${token.slice(0, 8)}...${token.slice(-6)}` : '(not configured)',
  };
}

function renderApiAppList(flash = null) {
  const apps = listApiApps({ includeDisabled: true });
  const bridge = getBridgeConfigView();
  const rows = apps.map((a) => `
    <tr>
      <td><a href="${p('/api-apps/' + a.id)}">${escapeHtml(a.name)}</a> <span style="color:#777;font-size:11px;">${escapeHtml(a.id)}</span></td>
      <td>${a.disabledAt ? '<span style="color:#ff4444;">disabled</span>' : '<span style="color:#7fff7f;">active</span>'}</td>
      <td>${escapeHtml(a.scopes.join(', ') || '-')}</td>
      <td>${a.rateLimitPerMin}/min</td>
      <td>${a.canMint ? 'yes' : 'no'}</td>
      <td>${escapeHtml(a.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="color:#888;">No API apps registered yet.</td></tr>';

  return buildPageHtml(`
    <h2>&gt; External API Apps</h2>
    ${renderFlash(flash)}
    <p>Apps that hold <code>sgc_live_*</code> bearer tokens and can read/charge SadGirlCoin on behalf of linked Discord users.</p>
    <p><a href="${p('/api-apps/new')}">[+ Register new app]</a></p>
    <h3>Bridge Settings</h3>
    <form method="POST" action="${p('/api-apps/bridge')}" style="max-width:720px;">
      <p style="color:#888;">Controls the runtime bearer token and funding source for <code>/v1/bridge/company/payout</code>.</p>
      <p><label>Bridge bearer token<br><input type="text" name="bridge_token" value="${escapeHtml(bridge.token)}" style="width:100%;font-family:monospace;" placeholder="paste a secret or use regenerate"></label></p>
      <p style="color:#888;">Current token preview: <code>${escapeHtml(bridge.tokenPreview)}</code></p>
      <p><label>Bridge mode<br>
        <select name="bridge_mode">
          <option value="treasury" ${bridge.mode === 'treasury' ? 'selected' : ''}>treasury-backed payout</option>
          <option value="mint" ${bridge.mode === 'mint' ? 'selected' : ''}>mint to company account</option>
        </select>
      </label></p>
      <p><label>Bridge treasury user id<br><input type="text" name="bridge_treasury_user_id" value="${escapeHtml(bridge.treasuryUserId)}" style="width:100%;font-family:monospace;" placeholder="__APP_your_bridge_app__"></label></p>
      <p><label>Bridge max payout amount<br><input type="number" name="bridge_max_payout_amount" value="${escapeHtml(bridge.maxPayoutAmount || '250000')}" min="1" max="1000000000"></label></p>
      <p>
        <button type="submit">Save bridge settings</button>
        <button type="submit" name="action" value="regenerate_token">Save + regenerate token</button>
        <button type="submit" name="action" value="clear_runtime" class="danger">Clear runtime overrides</button>
      </p>
    </form>
    <table class="data-table">
      <thead><tr><th>Name</th><th>Status</th><th>Scopes</th><th>Rate</th><th>Mint</th><th>Created</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `, 'API Apps — SGC Control Panel');
}

function renderApiAppNew(flash = null, prev = {}) {
  const scopeBoxes = VALID_SCOPES.map((s) => `
    <label style="display:block;margin:2px 0;">
      <input type="checkbox" name="scope_${escapeHtml(s)}" ${prev[`scope_${s}`] ? 'checked' : ''}>
      <code>${escapeHtml(s)}</code>
    </label>
  `).join('');

  return buildPageHtml(`
    <h2>&gt; Register API App</h2>
    ${renderFlash(flash)}
    <form method="POST" action="${p('/api-apps')}" style="max-width:640px;">
      <p><label>Name<br><input type="text" name="name" required maxlength="80" value="${escapeHtml(prev.name || '')}" style="width:100%"></label></p>
      <p><label>Description<br><textarea name="description" maxlength="500" rows="3" style="width:100%">${escapeHtml(prev.description || '')}</textarea></label></p>
      <p><label>Rate limit (req/min)<br><input type="number" name="rate_limit_per_min" value="${escapeHtml(prev.rate_limit_per_min || '60')}" min="1" max="6000"></label></p>
      <p><label>Webhook URL (optional)<br><input type="url" name="webhook_url" value="${escapeHtml(prev.webhook_url || '')}" style="width:100%"></label></p>
      <p><label><input type="checkbox" name="can_mint" ${prev.can_mint ? 'checked' : ''}> Allow minting (debits Central Bank)</label></p>
      <fieldset><legend>Scopes</legend>${scopeBoxes}</fieldset>
      <p><button type="submit">Create app + issue first key</button> <a href="${p('/api-apps')}">cancel</a></p>
    </form>
  `, 'New API App — SGC Control Panel');
}

function renderApiAppCreated(app, issued, opts = {}) {
  return buildPageHtml(`
    <h2>&gt; API Key Issued</h2>
    <div class="flash flash-success">${escapeHtml(opts.extraNote || 'App registered successfully.')}</div>
    <p><strong>App:</strong> ${escapeHtml(app.name)} <code>${escapeHtml(app.id)}</code></p>
    <p><strong>Key ID:</strong> <code>${escapeHtml(issued.keyId)}</code></p>
    <p style="background:#220011;border:2px solid #ff1744;padding:12px;">
      <strong>Plaintext key (shown ONCE — copy now):</strong><br>
      <code style="word-break:break-all;font-size:14px;">${escapeHtml(issued.plaintext)}</code>
    </p>
    <p>Send this in the <code>Authorization: Bearer ...</code> header.</p>
    ${app.webhookSecret ? `<p><strong>Webhook signing secret:</strong> <code>${escapeHtml(app.webhookSecret)}</code></p>` : ''}
    <p><a href="${p('/api-apps/' + app.id)}">Continue to app detail →</a></p>
  `, 'Key Issued — SGC Control Panel');
}

function parseOAuthClientForm(body) {
  const redirectUris = String(body.redirect_uris || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const grantTypes = ['authorization_code', 'client_credentials']
    .filter((grantType) => body[`grant_${grantType}`] === 'on' || body[`grant_${grantType}`] === '1');
  return { redirectUris, grantTypes };
}

function renderOAuthClientCreated(app, issued, opts = {}) {
  return buildPageHtml(`
    <h2>&gt; OAuth Client Issued</h2>
    <div class="flash flash-success">${escapeHtml(opts.extraNote || 'OAuth client created successfully.')}</div>
    <p><strong>App:</strong> ${escapeHtml(app.name)} <code>${escapeHtml(app.id)}</code></p>
    <p><strong>Client ID:</strong> <code>${escapeHtml(issued.clientId)}</code></p>
    <p style="background:#220011;border:2px solid #ff1744;padding:12px;">
      <strong>Client secret (shown ONCE â€” copy now):</strong><br>
      <code style="word-break:break-all;font-size:14px;">${escapeHtml(issued.clientSecret)}</code>
    </p>
    <p><strong>Grant types:</strong> <code>${escapeHtml(issued.grantTypes.join(', '))}</code></p>
    <p><strong>Redirect URIs:</strong></p>
    <pre style="white-space:pre-wrap;">${escapeHtml(issued.redirectUris.join('\n') || '(none)')}</pre>
    <p><a href="${p('/api-apps/' + app.id)}">Continue to app detail</a></p>
  `, 'OAuth Client Issued â€” SGC Control Panel');
}

function renderOAuthConsent(session, client, app, payload, flash = null) {
  const requestedScopes = String(payload.scope || '').split(/\s+/u).filter(Boolean);
  const grantedScopes = requestedScopes.length > 0
    ? app.scopes.filter((scope) => requestedScopes.includes(scope))
    : app.scopes.slice();
  const scopeItems = grantedScopes.length > 0
    ? grantedScopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join('')
    : '<li><em>No scopes requested.</em></li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize ${escapeHtml(app.name)} - SadGirlsClub</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Space+Mono:wght@400;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#0a0a0f; color:#c9c9d1;
    font-family:'Space Mono','Courier New',monospace;
    font-size:14px; line-height:1.6; min-height:100vh;
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  body::before {
    content:''; position:fixed; top:0;left:0;right:0;bottom:0;
    background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.15) 4px);
    pointer-events:none; z-index:9999;
  }
  .card {
    background:#12121f; border:1px solid #ff69b4; max-width:680px; width:100%;
    padding:32px; position:relative;
  }
  .card::before {
    content:''; position:absolute; top:0;left:0; width:4px; height:100%; background:#ff69b4;
  }
  h1 { font-family:'VT323',monospace; font-size:34px; color:#ff69b4; margin-bottom:8px; }
  .subtitle { color:#888; font-size:12px; margin-bottom:20px; }
  .flash { padding:10px 14px; margin-bottom:18px; border:1px solid #ff4444; color:#ff4444; background:rgba(255,68,68,0.1); }
  .meta { display:grid; gap:12px; margin-bottom:20px; }
  .meta-row { background:#0f0f18; border:1px solid #2a2a3e; padding:12px; }
  .meta-label { color:#888; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
  ul { margin-left:18px; margin-bottom:20px; }
  code { color:#44ff88; }
  .actions { display:flex; gap:12px; flex-wrap:wrap; margin-top:20px; }
  button {
    display:inline-block; padding:12px 18px; border:1px solid #ff69b4; background:#1a1a2e;
    color:#ff69b4; cursor:pointer; font-family:'VT323',monospace; font-size:22px;
  }
  button:hover { background:#ff69b4; color:#0a0a0f; }
  .danger { border-color:#ff4444; color:#ff4444; }
  .danger:hover { background:#ff4444; color:#0a0a0f; }
</style>
</head>
<body>
<div class="card">
  <h1>AUTHORIZE APP LINK</h1>
  <div class="subtitle">signed in as ${escapeHtml(session.username)} // sadgirlsclub.wtf</div>
  ${flash ? `<div class="flash">${escapeHtml(flash.message)}</div>` : ''}
  <div class="meta">
    <div class="meta-row">
      <div class="meta-label">Application</div>
      <div><strong>${escapeHtml(app.name)}</strong> <code>${escapeHtml(app.id)}</code></div>
    </div>
    <div class="meta-row">
      <div class="meta-label">OAuth Client</div>
      <div><code>${escapeHtml(client.client_id)}</code></div>
    </div>
    <div class="meta-row">
      <div class="meta-label">External Account</div>
      <div><code>${escapeHtml(payload.externalId)}</code>${payload.externalName ? ` // ${escapeHtml(payload.externalName)}` : ''}</div>
    </div>
    <div class="meta-row">
      <div class="meta-label">Redirect URI</div>
      <div><code>${escapeHtml(payload.redirectUri)}</code></div>
    </div>
  </div>
  <p style="margin-bottom:12px;">This app is requesting permission to act on your linked SadGirlCoin account with these scopes:</p>
  <ul>${scopeItems}</ul>
  <p style="color:#888;">Approving creates or refreshes the link for this app and returns an authorization code to the app.</p>
  <form method="POST" action="${p('/oauth/consent')}">
    <input type="hidden" name="client_id" value="${escapeHtml(payload.clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(payload.redirectUri)}">
    <input type="hidden" name="scope" value="${escapeHtml(payload.scope)}">
    <input type="hidden" name="state" value="${escapeHtml(payload.state)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(payload.codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(payload.codeChallengeMethod)}">
    <input type="hidden" name="external_id" value="${escapeHtml(payload.externalId)}">
    <input type="hidden" name="external_name" value="${escapeHtml(payload.externalName)}">
    <div class="actions">
      <button type="submit" name="decision" value="approve">Approve Link</button>
      <button type="submit" name="decision" value="deny" class="danger">Deny</button>
    </div>
  </form>
</div>
</body>
</html>`;
}

function renderApiAppDetail(appId, flash = null) {
  const app = getApiApp(appId);
  if (!app) {
    return buildPageHtml(`<h2>&gt; 404</h2><p>App <code>${escapeHtml(appId)}</code> not found.</p>`);
  }
  const keys = listKeysForApp(appId);
  const links = listLinksForApp(appId);
  const oauthClients = listOAuthClientsForApp(appId);
  const scopeBoxes = VALID_SCOPES.map((s) => `
    <label style="display:block;margin:2px 0;">
      <input type="checkbox" name="scope_${escapeHtml(s)}" ${app.scopes.includes(s) ? 'checked' : ''}>
      <code>${escapeHtml(s)}</code>
    </label>
  `).join('');

  const keyRows = keys.map((k) => `
    <tr>
      <td><code>${escapeHtml(k.id)}</code></td>
      <td><code>${escapeHtml(k.key_prefix)}...</code></td>
      <td>${escapeHtml(k.created_at)}</td>
      <td>${escapeHtml(k.last_used_at || 'never')}</td>
      <td>${k.revoked_at
        ? `<span style="color:#ff4444;">revoked ${escapeHtml(k.revoked_at)}</span>`
        : `<form method="POST" action="${p(`/api-apps/${appId}/keys/${k.id}/revoke`)}" style="display:inline;"><button type="submit">revoke</button></form>`}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="color:#888;">No keys.</td></tr>';

  const linkRows = links.map((l) => `
    <tr>
      <td>${escapeHtml(l.discord_id)}</td>
      <td>${escapeHtml(l.external_id)}</td>
      <td>${escapeHtml(l.external_name || '')}</td>
      <td>${escapeHtml(l.created_at)}</td>
      <td>${l.revoked_at
        ? `<span style="color:#888;">revoked</span>`
        : `<form method="POST" action="${p(`/api-apps/${appId}/links/${l.id}/revoke`)}" style="display:inline;"><button type="submit">revoke</button></form>`}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="color:#888;">No links yet.</td></tr>';

  const oauthRows = oauthClients.map((client) => `
    <tr>
      <td><code>${escapeHtml(client.client_id)}</code></td>
      <td>${escapeHtml((client.grantTypes || []).join(', ') || '-')}</td>
      <td><pre style="white-space:pre-wrap;">${escapeHtml((client.redirectUris || []).join('\n') || '-')}</pre></td>
      <td>${escapeHtml(client.created_at || '')}</td>
      <td>${client.revoked_at
        ? `<span style="color:#ff4444;">revoked ${escapeHtml(client.revoked_at)}</span>`
        : `<form method="POST" action="${p(`/api-apps/${appId}/oauth-clients/${client.client_id}/revoke`)}" style="display:inline;"><button type="submit">revoke</button></form>`}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="color:#888;">No OAuth clients yet.</td></tr>';

  return buildPageHtml(`
    <h2>&gt; ${escapeHtml(app.name)} <span style="color:#777;font-size:13px;">${escapeHtml(app.id)}</span></h2>
    ${renderFlash(flash)}
    <p>${escapeHtml(app.description || '(no description)')}</p>
    <ul>
      <li>Status: ${app.disabledAt ? `<span style="color:#ff4444;">disabled at ${escapeHtml(app.disabledAt)}</span>` : '<span style="color:#7fff7f;">active</span>'}</li>
      <li>Scopes: <code>${escapeHtml(app.scopes.join(', ') || '-')}</code></li>
      <li>Rate limit: ${app.rateLimitPerMin}/min</li>
      <li>Mint: ${app.canMint ? 'yes' : 'no'}</li>
      <li>Treasury account: <code>${escapeHtml(app.treasuryUserId)}</code> (balance: ${getBalance(app.treasuryUserId).toLocaleString()} SGC)</li>
      <li>Webhook: ${escapeHtml(app.webhookUrl || '-')}</li>
      <li>Owner: <code>${escapeHtml(app.ownerDiscordId)}</code></li>
      <li>Created: ${escapeHtml(app.createdAt)}</li>
    </ul>

    <h3>App Settings</h3>
    <form method="POST" action="${p(`/api-apps/${appId}/update`)}" style="max-width:640px;">
      <p style="color:#888;">Adjust API permissions and request budget for this app.</p>
      <p><label>Rate limit (req/min)<br><input type="number" name="rate_limit_per_min" value="${escapeHtml(String(app.rateLimitPerMin || 60))}" min="1" max="100000" required></label></p>
      <p><label><input type="checkbox" name="can_mint" ${app.canMint ? 'checked' : ''}> Allow minting (required for /v1/mint)</label></p>
      <fieldset><legend>Scopes</legend>${scopeBoxes}</fieldset>
      <p><button type="submit">Save settings</button></p>
    </form>

    <h3>Keys</h3>
    <form method="POST" action="${p(`/api-apps/${appId}/keys`)}"><button type="submit">+ Issue new key</button></form>
    <table class="data-table"><thead><tr><th>Key ID</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>${keyRows}</tbody></table>

    <h3>OAuth clients</h3>
    <form method="POST" action="${p(`/api-apps/${appId}/oauth-clients`)}" style="max-width:720px;">
      <p style="color:#888;">Create an OAuth client for browser-based linking. Redirect URIs must match exactly.</p>
      <p><label>Redirect URIs (one per line)<br><textarea name="redirect_uris" rows="4" style="width:100%;" placeholder="https://example.com/oauth/callback"></textarea></label></p>
      <p><label><input type="checkbox" name="grant_authorization_code" checked> authorization_code</label></p>
      <p><label><input type="checkbox" name="grant_client_credentials"> client_credentials</label></p>
      <p><button type="submit">+ Create OAuth client</button></p>
    </form>
    <table class="data-table"><thead><tr><th>Client ID</th><th>Grant types</th><th>Redirect URIs</th><th>Created</th><th></th></tr></thead><tbody>${oauthRows}</tbody></table>

    <h3>Linked users (${links.filter((l) => !l.revoked_at).length} active / ${links.length} total)</h3>
    <table class="data-table"><thead><tr><th>Discord ID</th><th>External ID</th><th>External name</th><th>Linked at</th><th></th></tr></thead><tbody>${linkRows}</tbody></table>

    <h3>Danger zone</h3>
    ${app.disabledAt
      ? `<form method="POST" action="${p(`/api-apps/${appId}/enable`)}"><button type="submit">Re-enable app</button></form>`
      : `<form method="POST" action="${p(`/api-apps/${appId}/disable`)}" onsubmit="return confirm('Disable app and revoke ALL its keys and user links?');"><button type="submit" style="background:#a00;color:#fff;">Disable app + revoke all keys/links</button></form>`}

    <p><a href="${p('/api-apps')}">← back to app list</a></p>
  `, `${app.name} — API App — SGC Control Panel`);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const params = new URLSearchParams(body);
        const result = {};
        for (const [key, value] of params) {
          result[key] = value;
        }
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function buildOauthLoginRedirect(pathname, parsedUrl) {
  const next = `${p(pathname)}${parsedUrl.search || ''}`;
  return `${p('/auth/discord/login')}?mode=member&next=${encodeURIComponent(next)}`;
}

function extractConsentPayload(source) {
  return {
    clientId: String(source.client_id || '').trim(),
    redirectUri: String(source.redirect_uri || '').trim(),
    scope: String(source.scope || '').trim(),
    state: String(source.state || '').trim(),
    codeChallenge: String(source.code_challenge || '').trim(),
    codeChallengeMethod: String(source.code_challenge_method || '').trim(),
    externalId: String(source.external_id || '').trim(),
    externalName: String(source.external_name || '').trim(),
  };
}

function validateConsentPayload(payload) {
  if (!payload.clientId) return 'client_id is required';
  if (!payload.redirectUri) return 'redirect_uri is required';
  if (!payload.state) return 'state is required';
  if (!payload.codeChallenge) return 'code_challenge is required';
  if (payload.codeChallengeMethod !== 'S256') return 'code_challenge_method must be S256';
  if (!payload.externalId) return 'external_id is required';
  if (payload.externalId.length > 200) return 'external_id is too long';
  if (payload.externalName.length > 80) return 'external_name is too long';
  return null;
}

/**
 * Get the real host from X-Forwarded-Host or fall back to req.headers.host.
 * This makes the app proxy-aware when behind nginx or similar reverse proxy.
 */
function getRealHost(req) {
  return req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host || 'localhost';
}

/**
 * Get the real protocol from X-Forwarded-Proto or default to http.
 */
function getRealProto(req) {
  return req.headers['x-forwarded-proto'] || 'http';
}

/**
 * Proxy a request to the Python memory service.
 */
function proxyToMemoryService(subPath, req, res) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(subPath, MEMORY_SERVICE_URL);
    // Forward query string
    const realHost = getRealHost(req);
    const realProto = getRealProto(req);
    const reqUrl = new URL(req.url, `${realProto}://${realHost}`);
    targetUrl.search = reqUrl.search;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        'accept': 'application/json',
        'content-type': req.headers['content-type'] || 'application/json',
      },
      timeout: 10000,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      });
      proxyRes.pipe(res);
      proxyRes.on('end', resolve);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: `Memory service unavailable: ${err.message}` }));
      resolve();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.writeHead(504);
      res.end(JSON.stringify({ error: 'Memory service timeout' }));
      resolve();
    });

    // Forward request body for POST/PUT
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Save settings helper
// ---------------------------------------------------------------------------

function saveSettingsFromForm(body, categoryNames) {
  const schema = SCHEMA;
  let saved = 0;

  for (const [key, schemaDef] of Object.entries(schema)) {
    if (!categoryNames.some((cat) => schemaDef.category === cat)) continue;
    if (!(key in body)) continue;

    const rawValue = body[key];
    if (schemaDef.type === 'number') {
      const num = Number(rawValue);
      if (Number.isFinite(num) && num !== schemaDef.default) {
        setSetting(key, num);
        saved++;
      } else if (Number.isFinite(num) && num === schemaDef.default) {
        // Revert to default (remove override)
        resetSetting(key);
        saved++;
      }
    } else {
      if (rawValue !== String(schemaDef.default)) {
        setSetting(key, rawValue);
        saved++;
      } else {
        resetSetting(key);
        saved++;
      }
    }
  }

  return saved;
}

function resetSettingsForCategories(categoryNames) {
  const schema = SCHEMA;
  let reset = 0;
  for (const [key, schemaDef] of Object.entries(schema)) {
    if (categoryNames.some((cat) => schemaDef.category === cat)) {
      resetSetting(key);
      reset++;
    }
  }
  return reset;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const realHost = getRealHost(req);
  const realProto = getRealProto(req);
  const parsedUrl = new URL(req.url, `${realProto}://${realHost}`);
  // Strip the base path prefix so all route matching works against bare paths.
  const rawPathname = parsedUrl.pathname;
  const pathname = WEB_PANEL_BASE_PATH && rawPathname.startsWith(WEB_PANEL_BASE_PATH)
    ? rawPathname.slice(WEB_PANEL_BASE_PATH.length) || '/'
    : rawPathname;
  const method = req.method;

  // Security headers (defense-in-depth — applied to every response).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // same-origin allows the browser to send a Referer header on same-origin
  // POSTs, which we use as a CSRF fallback when the Origin header is absent
  // or set to the opaque value "null".
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'interest-cohort=(), browsing-topics=()');

  try {
    // CSRF defense for state-changing methods. Applies to ALL routes including
    // /auth/logout. Read-only methods (GET/HEAD) are passed through.
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) {
      logger.warn(`[csrf] rejected ${method} ${pathname}: ${originCheck.reason}`);
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden: cross-origin request rejected.');
      return;
    }

    // ── Auth routes (always public) ───────────────────────────────────
    if (pathname === '/auth/discord/login') {
      handleLoginRoute(req, res);
      return;
    }
    if (pathname === '/auth/discord/callback') {
      await handleCallbackRoute(req, res, parsedUrl);
      return;
    }
    if (pathname === '/auth/logout' && method === 'POST') {
      handleLogoutRoute(req, res);
      return;
    }

    if (pathname === '/oauth/consent' && method === 'GET') {
      const session = requireUserAuth(req);
      if (!session) {
        res.writeHead(302, { Location: buildOauthLoginRedirect(pathname, parsedUrl) });
        res.end();
        return;
      }

      const payload = extractConsentPayload(Object.fromEntries(parsedUrl.searchParams.entries()));
      const payloadError = validateConsentPayload(payload);
      if (payloadError) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, { client_id: payload.clientId }, { id: '', name: 'Unknown app', scopes: [] }, payload, { message: payloadError }));
        return;
      }

      const client = getOAuthClient(payload.clientId);
      if (!client) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, { client_id: payload.clientId }, { id: '', name: 'Unknown app', scopes: [] }, payload, { message: 'Unknown OAuth client.' }));
        return;
      }
      const app = getApiApp(client.app_id);
      if (!app || app.disabledAt) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, client, app || { id: '', name: 'Disabled app', scopes: [] }, payload, { message: 'App is disabled or unavailable.' }));
        return;
      }
      if (!client.grantTypes.includes('authorization_code')) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, client, app, payload, { message: 'Client is not allowed to use authorization_code.' }));
        return;
      }
      if (!client.redirectUris.includes(payload.redirectUri)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, client, app, payload, { message: 'redirect_uri is not registered for this client.' }));
        return;
      }
      const requestedScopes = payload.scope.split(/\s+/u).filter(Boolean);
      const invalidScope = requestedScopes.find((scope) => !app.scopes.includes(scope));
      if (invalidScope) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, client, app, payload, { message: `Scope not allowed: ${invalidScope}` }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderOAuthConsent(session, client, app, payload));
      return;
    }

    if (pathname === '/oauth/consent' && method === 'POST') {
      const body = await parseFormBody(req);
      const payload = extractConsentPayload(body);
      const payloadError = validateConsentPayload(payload);
      if (payloadError) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(payloadError);
        return;
      }

      const session = requireUserAuth(req);
      if (!session) {
        const nextParams = new URLSearchParams({
          client_id: payload.clientId,
          redirect_uri: payload.redirectUri,
          scope: payload.scope,
          state: payload.state,
          code_challenge: payload.codeChallenge,
          code_challenge_method: payload.codeChallengeMethod,
          external_id: payload.externalId,
        });
        if (payload.externalName) nextParams.set('external_name', payload.externalName);
        res.writeHead(302, { Location: `${p('/auth/discord/login')}?mode=member&next=${encodeURIComponent(`${p('/oauth/consent')}?${nextParams.toString()}`)}` });
        res.end();
        return;
      }

      const client = getOAuthClient(payload.clientId);
      const app = client ? getApiApp(client.app_id) : null;
      if (!client || !app || app.disabledAt || !client.grantTypes.includes('authorization_code') || !client.redirectUris.includes(payload.redirectUri)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, client || { client_id: payload.clientId }, app || { id: '', name: 'Unknown app', scopes: [] }, payload, { message: 'Invalid OAuth client or redirect URI.' }));
        return;
      }

      const requestedScopes = payload.scope.split(/\s+/u).filter(Boolean);
      const invalidScope = requestedScopes.find((scope) => !app.scopes.includes(scope));
      if (invalidScope) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, client, app, payload, { message: `Scope not allowed: ${invalidScope}` }));
        return;
      }

      const decision = String(body.decision || '').trim().toLowerCase();
      const redirect = new URL(payload.redirectUri);
      redirect.searchParams.set('state', payload.state);

      if (decision !== 'approve') {
        redirect.searchParams.set('error', 'access_denied');
        res.writeHead(302, { Location: redirect.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      const grantedScope = requestedScopes.length > 0
        ? app.scopes.filter((scope) => requestedScopes.includes(scope)).join(' ')
        : app.scopes.join(' ');

      let code;
      try {
        code = createAuthorizationCode({
          clientId: client.client_id,
          appId: app.id,
          discordId: session.discordId,
          redirectUri: payload.redirectUri,
          scope: grantedScope,
          codeChallenge: payload.codeChallenge,
          codeChallengeMethod: payload.codeChallengeMethod,
          externalId: payload.externalId,
          externalName: payload.externalName,
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthConsent(session, client, app, payload, { message: err.message }));
        return;
      }

      redirect.searchParams.set('code', code);
      res.writeHead(302, { Location: redirect.toString(), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    // ── Auth gate ─────────────────────────────────────────────────────
    const session = requireAuth(req);
    if (!session) {
      if (pathname.startsWith('/api/')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderLoginPage());
      }
      return;
    }

    // Make the session available to synchronous render helpers via module scope.
    _currentSession = session;

    // ── Memory API proxy ──────────────────────────────────────────────
    if (pathname.startsWith('/api/memory/')) {
      const subPath = pathname.replace('/api/memory', '');
      await proxyToMemoryService(subPath, req, res);
      return;
    }

    // ── JSON APIs ─────────────────────────────────────────────────────
    if (pathname === '/api/guilds' && method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const configs = getAllGuildConfigs().map((cfg) => {
        const bbUserId = getBigBusinessUserId(cfg.guildId);
        let balance = 0;
        try { balance = getBigBusinessBalance(bbUserId); } catch { /* */ }
        return { ...cfg, bigBusinessBalance: balance };
      });
      res.end(JSON.stringify(configs, null, 2));
      return;
    }

    const apiGuildReactionRolesMatch = pathname.match(/^\/api\/guilds\/([^/]+)\/reaction-roles$/u);
    if (apiGuildReactionRolesMatch && method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const guildId = decodeURIComponent(apiGuildReactionRolesMatch[1]);
      const cfg = getGuildConfig(guildId);
      if (!cfg) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Guild not found' }));
        return;
      }
      res.end(JSON.stringify({
        guildId: cfg.guildId,
        reactionRoleMessageId: cfg.reactionRoleMessageId || '',
        reactionRoleAssignments: cfg.reactionRoleAssignments || [],
      }, null, 2));
      return;
    }

    if (apiGuildReactionRolesMatch && (method === 'PUT' || method === 'PATCH')) {
      res.setHeader('Content-Type', 'application/json');
      const guildId = decodeURIComponent(apiGuildReactionRolesMatch[1]);
      const cfg = getGuildConfig(guildId);
      if (!cfg) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Guild not found' }));
        return;
      }

      const body = await parseJsonBody(req);
      const nextMessageId = String(body.reactionRoleMessageId || '').trim();
      const nextAssignments = normalizeReactionRoleAssignments(body.reactionRoleAssignments || []);
      if (nextAssignments.length > 0 && !nextMessageId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'reactionRoleMessageId is required when reactionRoleAssignments are set.' }));
        return;
      }

      const updated = upsertGuildConfig({
        ...cfg,
        reactionRoleMessageId: nextMessageId,
        reactionRoleAssignments: nextAssignments,
      });

      res.end(JSON.stringify({
        guildId: updated.guildId,
        reactionRoleMessageId: updated.reactionRoleMessageId,
        reactionRoleAssignments: updated.reactionRoleAssignments,
      }, null, 2));
      return;
    }

    const apiGuildMatch = pathname.match(/^\/api\/guilds\/([^/]+)$/u);
    if (apiGuildMatch && method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const guildId = decodeURIComponent(apiGuildMatch[1]);
      const cfg = getGuildConfig(guildId);
      if (!cfg) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Guild not found' }));
        return;
      }

      const bbUserId = getBigBusinessUserId(cfg.guildId);
      let balance = 0;
      try { balance = getBigBusinessBalance(bbUserId); } catch { /* */ }
      res.end(JSON.stringify({ ...cfg, bigBusinessBalance: balance }, null, 2));
      return;
    }

    if (apiGuildMatch && (method === 'PUT' || method === 'PATCH')) {
      res.setHeader('Content-Type', 'application/json');
      const guildId = decodeURIComponent(apiGuildMatch[1]);
      const existing = getGuildConfig(guildId);
      if (!existing) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Guild not found' }));
        return;
      }

      const body = await parseJsonBody(req);
      const updates = { ...existing };

      if (body.guildName !== undefined) updates.guildName = String(body.guildName || '').trim();
      if (body.bigBusinessName !== undefined) updates.bigBusinessName = String(body.bigBusinessName || '').trim();
      if (body.bigBusinessChannelId !== undefined) updates.bigBusinessChannelId = String(body.bigBusinessChannelId || '').trim();
      if (body.bigBusinessRoleId !== undefined) updates.bigBusinessRoleId = String(body.bigBusinessRoleId || '').trim();
      if (body.lumiBetsChannelId !== undefined) updates.lumiBetsChannelId = String(body.lumiBetsChannelId || '').trim();
      if (body.lumiBetsArchiveChannelId !== undefined) updates.lumiBetsArchiveChannelId = String(body.lumiBetsArchiveChannelId || '').trim();
      if (body.starboardChannelId !== undefined) updates.starboardChannelId = String(body.starboardChannelId || '').trim();
      if (body.starboardEmojiName !== undefined) updates.starboardEmojiName = String(body.starboardEmojiName || 'star').trim();
      if (body.starboardMinStars !== undefined) updates.starboardMinStars = Number(body.starboardMinStars) || 4;
      if (body.enabled !== undefined) updates.enabled = body.enabled !== false;
      if (body.reactionRoleMessageId !== undefined) updates.reactionRoleMessageId = String(body.reactionRoleMessageId || '').trim();
      if (body.reactionRoleAssignments !== undefined) {
        updates.reactionRoleAssignments = normalizeReactionRoleAssignments(body.reactionRoleAssignments || []);
      }

      if (updates.reactionRoleAssignments?.length > 0 && !updates.reactionRoleMessageId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'reactionRoleMessageId is required when reactionRoleAssignments are set.' }));
        return;
      }

      const updated = upsertGuildConfig(updates);
      const bbUserId = getBigBusinessUserId(updated.guildId);
      let balance = 0;
      try { balance = getBigBusinessBalance(bbUserId); } catch { /* */ }
      res.end(JSON.stringify({ ...updated, bigBusinessBalance: balance }, null, 2));
      return;
    }

    if (pathname === '/api/settings' && method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const all = getAllSettings();
      const obj = {};
      for (const [cat, items] of all) {
        obj[cat] = items;
      }
      res.end(JSON.stringify(obj, null, 2));
      return;
    }

    if (pathname === '/api/users' && method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const q = parsedUrl.searchParams.get('q') || '';
      const limit = Number(parsedUrl.searchParams.get('limit')) || 100;
      const offset = Number(parsedUrl.searchParams.get('offset')) || 0;
      if (q) {
        res.end(JSON.stringify(searchAccounts(q, limit), null, 2));
      } else {
        res.end(JSON.stringify(getAllAccounts(limit, offset), null, 2));
      }
      return;
    }

    if (pathname.match(/^\/api\/users\/[^/]+$/u) && method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const userId = decodeURIComponent(pathname.split('/').pop());
      const acct = getAccountInfo(userId);
      if (!acct) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Account not found' }));
        return;
      }
      const txns = getUserTransactions(userId, 100);
      res.end(JSON.stringify({ account: acct, transactions: txns }, null, 2));
      return;
    }

    // ── HTML pages ────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    // Dashboard
    if (pathname === '/' && method === 'GET') {
      res.end(renderDashboard());
      return;
    }

    if (pathname === '/stocks' && method === 'GET') {
      res.end(renderStocks());
      return;
    }

    const stockDetailMatch = pathname.match(/^\/stocks\/(\d+)$/u);
    if (stockDetailMatch && method === 'GET') {
      res.end(renderStockDetail(Number(stockDetailMatch[1])));
      return;
    }

    const stockRenameMatch = pathname.match(/^\/stocks\/(\d+)\/name$/u);
    if (stockRenameMatch && method === 'POST') {
      const stockId = Number(stockRenameMatch[1]);
      const body = await parseFormBody(req);
      const nextName = String(body.name || '').trim();

      const stock = getStockById(stockId);
      if (!stock) {
        res.end(renderStocks({ type: 'error', message: 'Stock not found.' }));
        return;
      }

      if (!nextName) {
        res.end(renderStockDetail(stockId, { type: 'error', message: 'Stock name cannot be empty.' }));
        return;
      }

      if (stock.entity_type !== 'synthetic') {
        const guildCfg = getGuildConfig(stock.guild_id);
        if (guildCfg) {
          upsertGuildConfig({ ...guildCfg, bigBusinessName: nextName });
        }
      }

      const renameResult = renameStock(stockId, nextName, { lockSyntheticName: true });
      if (!renameResult.success) {
        res.end(renderStockDetail(stockId, { type: 'error', message: renameResult.error }));
        return;
      }

      res.end(renderStockDetail(stockId, {
        type: 'success',
        message: `Renamed stock to "${renameResult.newName}".`,
      }));
      return;
    }

    const stockTickerMatch = pathname.match(/^\/stocks\/(\d+)\/ticker$/u);
    if (stockTickerMatch && method === 'POST') {
      const stockId = Number(stockTickerMatch[1]);
      const body = await parseFormBody(req);
      const nextTicker = String(body.ticker || '').trim().toUpperCase();

      const stock = getStockById(stockId);
      if (!stock) {
        res.end(renderStocks({ type: 'error', message: 'Stock not found.' }));
        return;
      }

      if (!nextTicker) {
        res.end(renderStockDetail(stockId, { type: 'error', message: 'Ticker cannot be empty.' }));
        return;
      }

      const renameTickerResult = renameTicker(stockId, nextTicker, { lockSyntheticTicker: true });
      if (!renameTickerResult.success) {
        res.end(renderStockDetail(stockId, { type: 'error', message: renameTickerResult.error }));
        return;
      }

      res.end(renderStockDetail(stockId, {
        type: 'success',
        message: `Changed ticker from "${renameTickerResult.oldTicker}" to "${renameTickerResult.newTicker}".`,
      }));
      return;
    }

    // Guild list
    if (pathname === '/guilds' && method === 'GET') {
      res.end(renderGuildList());
      return;
    }

    // New guild form
    if (pathname === '/guilds/new' && method === 'GET') {
      res.end(renderGuildNew());
      return;
    }

    // Create new guild
    if (pathname === '/guilds/new' && method === 'POST') {
      const body = await parseFormBody(req);
      if (!body.guildId || !body.guildName) {
        res.end(renderGuildNew({ type: 'error', message: 'Guild ID and Name are required.' }, body));
        return;
      }

      const parsedReactionRoles = extractReactionRoleAssignmentsFromBody(body);
      if (parsedReactionRoles.error) {
        res.end(renderGuildNew({ type: 'error', message: parsedReactionRoles.error }, body));
        return;
      }

      const reactionRoleMessageId = String(body.reactionRoleMessageId || '').trim();
      if (parsedReactionRoles.assignments.length > 0 && !reactionRoleMessageId) {
        res.end(renderGuildNew({ type: 'error', message: 'Reaction Role Message ID is required when assignments are configured.' }, body));
        return;
      }

      const bigBusinessRoleId = String(body.bigBusinessRoleId || '').trim();
      if (bigBusinessRoleId && !/^\d+$/u.test(bigBusinessRoleId)) {
        res.end(renderGuildNew({ type: 'error', message: 'Big Business Role ID must be numeric.' }, body));
        return;
      }

      if (getGuildConfig(body.guildId)) {
        res.end(renderGuildNew({ type: 'error', message: 'A guild with this ID already exists.' }, body));
        return;
      }

      upsertGuildConfig({
        guildId: body.guildId,
        guildName: body.guildName,
        bigBusinessName: body.bigBusinessName || 'Big Business Inc',
        bigBusinessChannelId: body.bigBusinessChannelId || '',
        bigBusinessRoleId,
        lumiBetsChannelId: body.lumiBetsChannelId || '',
        lumiBetsArchiveChannelId: body.lumiBetsArchiveChannelId || '',
        reactionRoleMessageId,
        reactionRoleAssignments: parsedReactionRoles.assignments,
        starboardChannelId: body.starboardChannelId || '',
        starboardMinStars: Number(body.starboardMinStars) || 4,
        starboardEmojiName: body.starboardEmojiName || 'star',
        enabled: body.enabled !== 'false',
      });

      res.writeHead(302, { Location: p(`/guilds/${body.guildId}`) });
      res.end();
      return;
    }

    // Delete guild
    const deleteMatch = pathname.match(/^\/guilds\/(\d+)\/delete$/u);
    if (deleteMatch && method === 'POST') {
      removeGuildConfig(deleteMatch[1]);
      res.writeHead(302, { Location: p('/guilds') });
      res.end();
      return;
    }

    // Edit guild form
    const editMatch = pathname.match(/^\/guilds\/(\d+)$/u);
    if (editMatch && method === 'GET') {
      res.end(renderGuildEdit(editMatch[1]));
      return;
    }

    // Update guild
    if (editMatch && method === 'POST') {
      const body = await parseFormBody(req);
      const originalGuildId = editMatch[1];
      const guildId = String(body.guildId || '').trim();

      if (!guildId || !body.guildName) {
        res.end(renderGuildEdit(originalGuildId, { type: 'error', message: 'Guild ID and Name are required.' }));
        return;
      }

      if (guildId !== originalGuildId && getGuildConfig(guildId)) {
        res.end(renderGuildEdit(originalGuildId, { type: 'error', message: 'A guild with this ID already exists.' }));
        return;
      }

      const parsedReactionRoles = extractReactionRoleAssignmentsFromBody(body);
      if (parsedReactionRoles.error) {
        res.end(renderGuildEdit(originalGuildId, { type: 'error', message: parsedReactionRoles.error }));
        return;
      }

      const reactionRoleMessageId = String(body.reactionRoleMessageId || '').trim();
      if (parsedReactionRoles.assignments.length > 0 && !reactionRoleMessageId) {
        res.end(renderGuildEdit(originalGuildId, { type: 'error', message: 'Reaction Role Message ID is required when assignments are configured.' }));
        return;
      }

      const bigBusinessRoleId = String(body.bigBusinessRoleId || '').trim();
      if (bigBusinessRoleId && !/^\d+$/u.test(bigBusinessRoleId)) {
        res.end(renderGuildEdit(originalGuildId, { type: 'error', message: 'Big Business Role ID must be numeric.' }));
        return;
      }

      upsertGuildConfig({
        guildId,
        guildName: body.guildName,
        bigBusinessName: body.bigBusinessName,
        bigBusinessChannelId: body.bigBusinessChannelId || '',
        bigBusinessRoleId,
        lumiBetsChannelId: body.lumiBetsChannelId || '',
        lumiBetsArchiveChannelId: body.lumiBetsArchiveChannelId || '',
        reactionRoleMessageId,
        reactionRoleAssignments: parsedReactionRoles.assignments,
        starboardChannelId: body.starboardChannelId || '',
        starboardMinStars: Number(body.starboardMinStars) || 4,
        starboardEmojiName: body.starboardEmojiName || 'star',
        enabled: body.enabled !== 'false',
      });

      if (guildId !== originalGuildId) {
        removeGuildConfig(originalGuildId);
      }

      res.writeHead(302, { Location: p(`/guilds/${guildId}`) });
      res.end();
      return;
    }

    // VC tracker
    if (pathname === '/vc' && method === 'GET') {
      res.end(renderVcTracker());
      return;
    }

    // Patreon supporters
    if (pathname === '/patrons' && method === 'GET') {
      res.end(renderPatrons());
      return;
    }

    // ── Economy Settings ──────────────────────────────────────────────
    if (pathname === '/economy' && method === 'GET') {
      res.end(renderEconomy());
      return;
    }

    // ── Runtime Settings ──────────────────────────────────────────────
    if (pathname === '/runtime' && method === 'GET') {
      res.end(renderRuntime());
      return;
    }

    if (pathname === '/runtime' && method === 'POST') {
      const body = await parseFormBody(req);
      const cats = ['Runtime Channels', 'Chatbot', 'Search', 'Big Business', 'VC Rewards'];
      const saved = saveSettingsFromForm(body, cats);
      liveReloadAllSettings();
      res.end(renderRuntime({ type: 'success', message: `Saved ${saved} runtime settings. Changes are live where supported.` }));
      return;
    }

    if (pathname === '/runtime/reset' && method === 'GET') {
      const cats = ['Runtime Channels', 'Chatbot', 'Search', 'Big Business', 'VC Rewards'];
      resetSettingsForCategories(cats);
      liveReloadAllSettings();
      res.writeHead(302, { Location: p('/runtime') });
      res.end();
      return;
    }

    if (pathname === '/economy' && method === 'POST') {
      const body = await parseFormBody(req);
      const cats = ['Economy', 'Tax', 'Casino Reserve', 'Scheduler', 'VC Rewards', 'Big Business', 'Runtime Channels', 'Chatbot', 'Search'];
      const saved = saveSettingsFromForm(body, cats);
      liveReloadAllSettings();
      res.end(renderEconomy({ type: 'success', message: `Saved ${saved} economy settings. Changes are live.` }));
      return;
    }

    if (pathname === '/economy/reset' && method === 'GET') {
      const cats = ['Economy', 'Tax', 'Casino Reserve', 'Scheduler', 'VC Rewards', 'Big Business', 'Runtime Channels', 'Chatbot', 'Search'];
      resetSettingsForCategories(cats);
      liveReloadAllSettings();
      res.writeHead(302, { Location: p('/economy') });
      res.end();
      return;
    }

    // ── Casino Settings ───────────────────────────────────────────────
    if (pathname === '/casino' && method === 'GET') {
      res.end(renderCasino());
      return;
    }

    if (pathname === '/casino' && method === 'POST') {
      const body = await parseFormBody(req);
      const cats = ['Slots', 'Pachinko', 'Blackjack', "Texas Hold'em", 'Horse Racing'];
      const saved = saveSettingsFromForm(body, cats);
      liveReloadAllSettings();
      res.end(renderCasino({ type: 'success', message: `Saved ${saved} casino settings. Changes are live.` }));
      return;
    }

    if (pathname === '/casino/reset' && method === 'GET') {
      const cats = ['Slots', 'Pachinko', 'Blackjack', "Texas Hold'em", 'Horse Racing'];
      resetSettingsForCategories(cats);
      liveReloadAllSettings();
      res.writeHead(302, { Location: p('/casino') });
      res.end();
      return;
    }

    // ── User Manager ──────────────────────────────────────────────────
    if (pathname === '/users' && method === 'GET') {
      const q = parsedUrl.searchParams.get('q') || '';
      const page = Number(parsedUrl.searchParams.get('page')) || 1;
      res.end(renderUsers(q, page));
      return;
    }

    // User detail
    const userDetailMatch = pathname.match(/^\/users\/([^/]+)$/u);
    if (userDetailMatch && method === 'GET') {
      const userId = decodeURIComponent(userDetailMatch[1]);
      res.end(renderUserDetail(userId));
      return;
    }

    // Adjust user balance
    const userAdjustMatch = pathname.match(/^\/users\/([^/]+)\/adjust$/u);
    if (userAdjustMatch && method === 'POST') {
      const userId = decodeURIComponent(userAdjustMatch[1]);
      const body = await parseFormBody(req);
      const amount = Number(body.amount);
      const note = body.note || 'Admin panel adjustment';

      if (!Number.isFinite(amount) || amount === 0) {
        res.end(renderUserDetail(userId, { type: 'error', message: 'Enter a non-zero amount.' }));
        return;
      }

      try {
        ensureAccount(userId);
        adjustBalance(userId, amount, note);
        const newBalance = getBalance(userId);
        res.end(renderUserDetail(userId, {
          type: 'success',
          message: `Balance adjusted by ${amount > 0 ? '+' : ''}${amount} SGC. New balance: ${newBalance.toLocaleString()} SGC`,
        }));
      } catch (err) {
        res.end(renderUserDetail(userId, { type: 'error', message: err.message }));
      }
      return;
    }

    // ── Memory Viewer ─────────────────────────────────────────────────
    if (pathname === '/memory' && method === 'GET') {
      res.end(renderMemory());
      return;
    }

    // ── External API Apps (bank-owner only) ──────────────────────────
    if (pathname.startsWith('/api-apps')) {
      if (session.discordId !== BANK_OWNER_ID) {
        res.writeHead(403);
        res.end(buildPageHtml('<h2>> 403</h2><p style="color:#ff4444;">API key management is restricted to the bank owner.</p>'));
        return;
      }

      if (pathname === '/api-apps' && method === 'GET') {
        res.end(renderApiAppList());
        return;
      }
      if (pathname === '/api-apps/new' && method === 'GET') {
        res.end(renderApiAppNew());
        return;
      }
      if (pathname === '/api-apps' && method === 'POST') {
        const body = await parseFormBody(req);
        const name = String(body.name || '').trim();
        if (!name) { res.end(renderApiAppNew({ type: 'error', message: 'Name is required.' }, body)); return; }
        const scopes = Object.keys(body).filter((k) => k.startsWith('scope_')).map((k) => k.slice(6));
        const rateLimit = Math.max(1, Number(body.rate_limit_per_min) || 60);
        const canMint = body.can_mint === 'on' || body.can_mint === '1';
        const webhookUrl = String(body.webhook_url || '').trim() || null;
        try {
          const app = createApiApp({
            name,
            ownerDiscordId: session.discordId,
            description: String(body.description || '').trim(),
            scopes,
            rateLimitPerMin: rateLimit,
            canMint,
            webhookUrl,
          });
          const issued = issueApiKey(app.id);
          res.end(renderApiAppCreated(app, issued));
        } catch (err) {
          res.end(renderApiAppNew({ type: 'error', message: err.message }, body));
        }
        return;
      }

      if (pathname === '/api-apps/bridge' && method === 'POST') {
        const body = await parseFormBody(req);
        const action = String(body.action || '').trim();

        if (action === 'clear_runtime') {
          deleteSystemState('bridge.token');
          deleteSystemState('bridge.treasury_user_id');
          deleteSystemState('bridge.max_payout_amount');
          deleteSystemState('bridge.mode');
          res.end(renderApiAppList({ type: 'success', message: 'Bridge runtime overrides cleared. Env values will be used if present.' }));
          return;
        }

        let bridgeToken = String(body.bridge_token || '').trim();
        const bridgeMode = String(body.bridge_mode || 'treasury').trim().toLowerCase() === 'mint' ? 'mint' : 'treasury';
        const treasuryUserId = String(body.bridge_treasury_user_id || '').trim();
        const maxPayoutAmount = Math.max(1, Math.min(1_000_000_000, Math.floor(Number(body.bridge_max_payout_amount) || 250000)));

        if (action === 'regenerate_token') {
          bridgeToken = crypto.randomBytes(24).toString('hex');
        } else if (!bridgeToken) {
          bridgeToken = String(getSystemState('bridge.token') || process.env.SGC_BRIDGE_TOKEN || '').trim();
        }

        if (!bridgeToken) {
          res.end(renderApiAppList({ type: 'error', message: 'Bridge token is required unless you clear runtime overrides.' }));
          return;
        }
        if (bridgeMode === 'treasury' && !treasuryUserId) {
          res.end(renderApiAppList({ type: 'error', message: 'Bridge treasury user id is required.' }));
          return;
        }

        setSystemState('bridge.token', bridgeToken);
        setSystemState('bridge.treasury_user_id', treasuryUserId);
        setSystemState('bridge.max_payout_amount', String(maxPayoutAmount));
        setSystemState('bridge.mode', bridgeMode);

        const msg = action === 'regenerate_token'
          ? `Bridge settings saved in ${bridgeMode} mode. New token: ${bridgeToken}`
          : `Bridge settings saved in ${bridgeMode} mode.`;
        res.end(renderApiAppList({ type: 'success', message: msg }));
        return;
      }

      const detailMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)$/u);
      if (detailMatch && method === 'GET') {
        res.end(renderApiAppDetail(detailMatch[1]));
        return;
      }

      const updateAppMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/update$/u);
      if (updateAppMatch && method === 'POST') {
        const appId = updateAppMatch[1];
        const body = await parseFormBody(req);
        const rateLimit = Math.max(1, Math.min(100000, Math.floor(Number(body.rate_limit_per_min) || 60)));
        const scopes = Object.keys(body).filter((k) => k.startsWith('scope_')).map((k) => k.slice(6));
        const canMint = body.can_mint === 'on' || body.can_mint === '1';
        try {
          const app = getApiApp(appId);
          if (!app) {
            res.end(renderApiAppList({ type: 'error', message: 'App not found.' }));
            return;
          }
          updateApp(appId, { rateLimitPerMin: rateLimit, scopes, canMint });
          res.end(renderApiAppDetail(appId, { type: 'success', message: `App settings updated. Rate limit ${rateLimit}/min, mint ${canMint ? 'enabled' : 'disabled'}.` }));
        } catch (err) {
          res.end(renderApiAppDetail(appId, { type: 'error', message: err.message }));
        }
        return;
      }

      const issueMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/keys$/u);
      if (issueMatch && method === 'POST') {
        const appId = issueMatch[1];
        try {
          const app = getApiApp(appId);
          if (!app) { res.end(renderApiAppList({ type: 'error', message: 'App not found.' })); return; }
          const issued = issueApiKey(appId);
          res.end(renderApiAppCreated(app, issued, { extraNote: 'New key issued. Store it now — it will not be shown again.' }));
        } catch (err) {
          res.end(renderApiAppDetail(appId, { type: 'error', message: err.message }));
        }
        return;
      }

      const oauthCreateMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/oauth-clients$/u);
      if (oauthCreateMatch && method === 'POST') {
        const appId = oauthCreateMatch[1];
        const body = await parseFormBody(req);
        const { redirectUris, grantTypes } = parseOAuthClientForm(body);
        if (redirectUris.length === 0) {
          res.end(renderApiAppDetail(appId, { type: 'error', message: 'At least one redirect URI is required.' }));
          return;
        }
        if (grantTypes.length === 0) {
          res.end(renderApiAppDetail(appId, { type: 'error', message: 'Select at least one OAuth grant type.' }));
          return;
        }
        try {
          const app = getApiApp(appId);
          if (!app) {
            res.end(renderApiAppList({ type: 'error', message: 'App not found.' }));
            return;
          }
          const issued = createOAuthClient({ appId, redirectUris, grantTypes });
          res.end(renderOAuthClientCreated(app, issued));
        } catch (err) {
          res.end(renderApiAppDetail(appId, { type: 'error', message: err.message }));
        }
        return;
      }

      const revokeKeyMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/keys\/([a-z0-9_]+)\/revoke$/u);
      if (revokeKeyMatch && method === 'POST') {
        revokeApiKey(revokeKeyMatch[2]);
        res.end(renderApiAppDetail(revokeKeyMatch[1], { type: 'success', message: 'Key revoked.' }));
        return;
      }

      const revokeOauthClientMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/oauth-clients\/([a-z0-9_]+)\/revoke$/u);
      if (revokeOauthClientMatch && method === 'POST') {
        revokeOAuthClient(revokeOauthClientMatch[2]);
        res.end(renderApiAppDetail(revokeOauthClientMatch[1], { type: 'success', message: 'OAuth client revoked.' }));
        return;
      }

      const disableMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/disable$/u);
      if (disableMatch && method === 'POST') {
        disableApp(disableMatch[1]);
        res.end(renderApiAppDetail(disableMatch[1], { type: 'success', message: 'App disabled. All keys and links revoked.' }));
        return;
      }

      const enableMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/enable$/u);
      if (enableMatch && method === 'POST') {
        enableApp(enableMatch[1]);
        res.end(renderApiAppDetail(enableMatch[1], { type: 'success', message: 'App re-enabled. (Existing keys/links remain revoked — issue new ones.)' }));
        return;
      }

      const revokeLinkMatch = pathname.match(/^\/api-apps\/([a-z0-9_]+)\/links\/(\d+)\/revoke$/u);
      if (revokeLinkMatch && method === 'POST') {
        revokeLinkById(Number(revokeLinkMatch[2]));
        res.end(renderApiAppDetail(revokeLinkMatch[1], { type: 'success', message: 'Link revoked.' }));
        return;
      }
    }

    // 404
    res.writeHead(404);
    res.end(buildPageHtml('<h2>> 404</h2><p style="color:#ff4444;">Page not found.</p>'));
  } catch (error) {
    logger.error('Web panel request error.', error.message);
    res.writeHead(500);
    res.end(buildPageHtml(`<h2>> 500</h2><p style="color:#ff4444;">Internal error: ${escapeHtml(error.message)}</p>`));
  } finally {
    _currentSession = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function startWebPanel() {
  // Refuse to start without a session secret — sessions must be HMAC-signed.
  assertAuthConfigOrThrow();

  // Validate Discord OAuth config and warn about missing/weak values.
  const authWarnings = validateAuthConfig();
  for (const warning of authWarnings) {
    logger.warn(`[auth] ${warning}`);
  }

  server = http.createServer(handleRequest);

  server.listen(WEB_PANEL_PORT, WEB_PANEL_HOST, () => {
    logger.info(`Web control panel running at http://${WEB_PANEL_HOST}:${WEB_PANEL_PORT}`);
  });

  server.on('error', (error) => {
    logger.error('Web panel server error.', error.message);
  });
}

function stopWebPanel() {
  if (server) {
    server.close();
    server = null;
    logger.info('Web control panel stopped.');
  }
}

module.exports = {
  startWebPanel,
  stopWebPanel,
};
