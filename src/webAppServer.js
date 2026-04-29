'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { URL } = require('node:url');

const { logger } = require('./logger');
const {
  ensureAccount,
  getBalance,
  getCentralBankBalance,
  getDollStreetBalance,
  getMomijiCasinoBalance,
  getUserTransactions,
  transferCoins,
  buyYearlyRaffleTicket,
  getTransferFeeRate,
  isLottoDay,
  searchAccounts,
  createMarket,
  getOpenMarkets,
  getPendingMarkets,
  getMarket,
  getMarketOptions,
  isYesNoMarket,
  buyStockPosition,
  getEconomyDb,
} = require('./sadgirlEconomyStore');
const {
  getAllStocks,
  getStockByTicker,
  getStockById,
  getStockSummary,
  getStockTransactions,
  getUserPortfolio,
  getUserHolding,
  buyShares,
  sellShares,
} = require('./privateStockStore');
const { manager } = require('./workers/workerManager');
const {
  handleLoginRoute,
  handleCallbackRoute,
  handleLogoutRoute,
  requireUserAuth,
  validateSameOrigin,
} = require('./webPanelAuth');
const {
  initWebAppStore,
  createNotification,
  getNotificationsForUser,
  markNotificationRead,
  getUnreadNotificationCount,
  createActionReceipt,
  getActionReceiptByKey,
  getReceiptsForUser,
} = require('./webAppStore');

let WEB_APP_PORT = Number(process.env.WEB_APP_PORT) || 7171;
let WEB_APP_HOST = process.env.WEB_APP_HOST || '0.0.0.0';
const WEB_APP_BASE_PATH = (process.env.WEB_APP_BASE_PATH || '').replace(/\/+$/u, '');
const DEFAULT_RAFFLE_COST = Number(process.env.WEB_APP_YEARLY_RAFFLE_COST || 50);
let WEB_APP_DISCORD_OAUTH_REDIRECT_URI =
  process.env.WEB_APP_DISCORD_OAUTH_REDIRECT_URI?.trim()
  || process.env.DISCORD_OAUTH_REDIRECT_URI?.trim()
  || '';
const WEB_APP_POSTMESSAGE_TARGET_ORIGIN =
  process.env.WEB_APP_POSTMESSAGE_TARGET_ORIGIN?.trim() || '*';
const WEB_APP_SESSION_SAMESITE =
  process.env.WEB_APP_SESSION_SAMESITE?.trim() || 'None';
const WEB_APP_SESSION_SECURE =
  String(process.env.WEB_APP_SESSION_SECURE || '').trim()
    ? ['1', 'true', 'yes', 'on'].includes(String(process.env.WEB_APP_SESSION_SECURE).trim().toLowerCase())
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
  return `${WEB_APP_BASE_PATH}${path}`;
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
  if (!WEB_APP_BASE_PATH) return pathname;
  if (pathname === WEB_APP_BASE_PATH) return '/';
  if (pathname.startsWith(`${WEB_APP_BASE_PATH}/`)) return pathname.slice(WEB_APP_BASE_PATH.length);
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
<title>Lumi Web Login</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Space+Mono:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(255,105,180,0.18), transparent 30%),
      radial-gradient(circle at bottom right, rgba(100,149,237,0.16), transparent 28%),
      #0b0b11;
    color: #d7d7df;
    display: grid;
    place-items: center;
    font-family: 'Space Mono', monospace;
  }
  .box {
    width: min(460px, calc(100vw - 32px));
    padding: 28px;
    border: 1px solid #ff69b4;
    background: rgba(15, 15, 24, 0.95);
    box-shadow: 0 0 40px rgba(255,105,180,0.12);
  }
  h1 {
    margin: 0 0 8px;
    font: 42px 'VT323', monospace;
    color: #ff69b4;
    letter-spacing: 2px;
  }
  p {
    margin: 0 0 18px;
    color: #9fa3b6;
  }
  .btn {
    display: inline-block;
    width: 100%;
    padding: 14px 16px;
    text-align: center;
    text-decoration: none;
    background: #5865f2;
    color: white;
    font: 24px 'VT323', monospace;
    letter-spacing: 1px;
    border: 0;
  }
  .meta {
    margin-top: 16px;
    font-size: 12px;
    color: #7c8196;
  }
</style>
</head>
<body>
  <main class="box">
    <h1>LUMI WEB</h1>
    <p>Sign in with Discord to open your SadGirlCoin wallet, bank history, and receipts.</p>
    <button class="btn" id="popup-login" type="button">Sign In With Discord</button>
    <div class="meta">Member login uses the same Discord OAuth session system as the control panel.</div>
  </main>
<script>
  const loginUrl = ${JSON.stringify(loginHref)};
  const appRoot = ${JSON.stringify(p('/'))};

  function beginPopupLogin() {
    const popup = window.open(
      loginUrl,
      'lumibot_discord_login',
      'popup=yes,width=520,height=760,resizable=yes,scrollbars=yes'
    );

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
      if (popup.closed) {
        clearInterval(timer);
      }
    }, 1000);
  }

  window.addEventListener('message', async (event) => {
    if (${JSON.stringify(WEB_APP_POSTMESSAGE_TARGET_ORIGIN)} !== '*' && event.origin !== ${JSON.stringify(WEB_APP_POSTMESSAGE_TARGET_ORIGIN)}) {
      return;
    }
    if (event.data?.type !== 'lumibot-auth-complete') return;
    try {
      const res = await fetch(${JSON.stringify(p('/api/me'))}, { credentials: 'include' });
      if (res.ok) {
        window.location.href = appRoot;
      }
    } catch {}
  });

  document.getElementById('popup-login').addEventListener('click', beginPopupLogin);
</script>
</body>
</html>`;
}

function renderPage(title, session, body, {
  active = '',
  pageScripts = '',
} = {}) {
  const nav = [
    ['/', 'Dashboard'],
    ['/bank', 'Bank'],
    ['/stocks', 'Stocks'],
    ['/portfolio', 'Portfolio'],
    ['/bets', 'Bets'],
    ['/casino/slots', 'Slots'],
    ['/bank/history', 'History'],
    ['/bank/send', 'Send'],
    ['/bank/raffle', 'Raffle'],
  ].map(([href, label]) => {
    const selected = active === href ? 'active' : '';
    return `<a class="${selected}" href="${p(href)}">${label}</a>`;
  }).join('');

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
    color: #d8d8e0;
    background:
      linear-gradient(180deg, rgba(255,105,180,0.06), transparent 20%),
      linear-gradient(135deg, #090910, #11111a 55%, #121827);
    font-family: 'Space Mono', monospace;
  }
  .wrap {
    width: min(900px, calc(100vw - 20px));
    margin: 0 auto;
    padding: 10px 0 24px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
    padding: 18px;
    border: 1px solid #2d3042;
    background: rgba(12, 12, 20, 0.92);
  }
  h1 {
    margin: 0;
    font: 40px 'VT323', monospace;
    color: #ff69b4;
    letter-spacing: 2px;
  }
  .subtitle {
    color: #8d93a9;
    font-size: 12px;
  }
  .userbar {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #cbd0e0;
  }
  .logout {
    background: transparent;
    border: 1px solid #50556f;
    color: #cfd3e7;
    padding: 8px 12px;
    font-family: inherit;
    cursor: pointer;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 18px;
  }
  nav a {
    text-decoration: none;
    padding: 8px 12px;
    border: 1px solid #394056;
    color: #cfd3e7;
    background: rgba(16, 17, 28, 0.85);
  }
  nav a.active {
    border-color: #ff69b4;
    color: #ff69b4;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .card {
    padding: 16px;
    border: 1px solid #2a3044;
    background: rgba(14, 16, 26, 0.92);
  }
  .card h2, .card h3 {
    margin: 0 0 10px;
    font-family: 'VT323', monospace;
    color: #ff69b4;
    letter-spacing: 1px;
  }
  .metric {
    font: 28px 'VT323', monospace;
    color: #fff;
  }
  .muted {
    color: #8d93a9;
    font-size: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    text-align: left;
    padding: 9px 8px;
    border-bottom: 1px solid #23283a;
    vertical-align: top;
    font-size: 13px;
  }
  th {
    color: #ff69b4;
    font-family: 'VT323', monospace;
    font-size: 20px;
  }
  input, textarea {
    width: 100%;
    padding: 10px;
    margin: 0 0 12px;
    color: #f0f2ff;
    background: #0c0f19;
    border: 1px solid #394056;
    font: inherit;
  }
  button.primary, .pill {
    background: #ff69b4;
    border: 0;
    color: #0d0e14;
    padding: 10px 14px;
    font-family: 'VT323', monospace;
    font-size: 22px;
    cursor: pointer;
  }
  .pill {
    display: inline-block;
    text-decoration: none;
  }
  .panel {
    display: grid;
    gap: 14px;
  }
  .stack {
    display: grid;
    gap: 14px;
  }
  .flash {
    padding: 10px 12px;
    border: 1px solid #3e4663;
    background: rgba(30, 35, 54, 0.72);
    color: #dce1f6;
    margin-bottom: 12px;
  }
  .flash.error {
    border-color: #ff5f7a;
    color: #ffd8df;
  }
  .flash.success {
    border-color: #64d9a5;
    color: #dffbef;
  }
  .list {
    display: grid;
    gap: 10px;
  }
  .item {
    padding: 12px;
    border: 1px solid #262d43;
    background: rgba(11, 14, 22, 0.85);
  }
  .mono { font-family: monospace; }
  @media (max-width: 700px) {
    .wrap { width: calc(100vw - 16px); }
    header { padding: 14px; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>LUMI WEB</h1>
        <div class="subtitle">SadGirlCoin member app</div>
      </div>
      <div class="userbar">
        <div>
          <div>${escapeHtml(session.username)}</div>
          <div class="muted mono">${escapeHtml(session.discordId)}</div>
        </div>
        <form method="POST" action="${p('/auth/logout')}">
          <button class="logout" type="submit">Logout</button>
        </form>
      </div>
    </header>
    <nav>${nav}</nav>
    ${body}
  </div>
  ${pageScripts}
</body>
</html>`;
}

function transactionLabel(txn, viewerId) {
  const direction = txn.to_user_id === viewerId ? 'in' : 'out';
  const counterpart = txn.to_user_id === viewerId ? txn.from_user_id : txn.to_user_id;
  return { direction, counterpart: counterpart || 'SYSTEM' };
}

function renderTransactionsTable(transactions, viewerId) {
  if (!transactions.length) return '<p class="muted">No transactions yet.</p>';
  const rows = transactions.map((txn) => {
    const meta = transactionLabel(txn, viewerId);
    return `<tr>
      <td>${escapeHtml(txn.created_at)}</td>
      <td>${escapeHtml(txn.type)}</td>
      <td>${meta.direction === 'in' ? '+' : '-'}${Number(txn.amount).toLocaleString()}</td>
      <td>${Number(txn.fee || 0).toLocaleString()}</td>
      <td class="mono">${escapeHtml(meta.counterpart)}</td>
      <td>${escapeHtml(txn.note || '')}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead>
      <tr><th>When</th><th>Type</th><th>Amount</th><th>Fee</th><th>Counterparty</th><th>Note</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderReceipts(receipts) {
  if (!receipts.length) return '<p class="muted">No web receipts yet.</p>';
  return `<div class="list">${receipts.map((receipt) => `
    <div class="item">
      <div><strong>${escapeHtml(receipt.summary)}</strong></div>
      <div class="muted">${escapeHtml(receipt.created_at)} • ${escapeHtml(receipt.action_type)}</div>
    </div>
  `).join('')}</div>`;
}

function renderNotifications(notifications) {
  if (!notifications.length) return '<p class="muted">No notifications yet.</p>';
  return `<div class="list">${notifications.map((notification) => `
    <div class="item">
      <div><strong>${escapeHtml(notification.title)}</strong></div>
      <div>${escapeHtml(notification.body || '')}</div>
      <div class="muted">${escapeHtml(notification.created_at)} • ${escapeHtml(notification.kind)}</div>
    </div>
  `).join('')}</div>`;
}

function buildWalletSummary(userId) {
  return {
    balance: getBalance(userId),
    centralBankBalance: getCentralBankBalance(),
    dollStreetBalance: getDollStreetBalance(),
    casinoBalance: getMomijiCasinoBalance(),
    transferFeeRate: getTransferFeeRate(),
    lottoDay: isLottoDay(),
  };
}

function renderDashboard(session) {
  ensureAccount(session.discordId, session.username);
  const wallet = buildWalletSummary(session.discordId);
  const transactions = getUserTransactions(session.discordId, 8);
  const receipts = getReceiptsForUser(session.discordId, 6);
  const notifications = getNotificationsForUser(session.discordId, 6);

  return renderPage('Lumi Web Dashboard', session, `
    <section class="stack">
      <div class="card"><h2>Wallet</h2><div class="metric">${wallet.balance.toLocaleString()} SGC</div><div class="muted">Your spendable balance</div></div>
      <div class="card"><h2>Transfer Fee</h2><div class="metric">${Math.round(wallet.transferFeeRate * 100)}%</div><div class="muted">${wallet.lottoDay ? 'Lotto day fee is active.' : 'Normal transfer rate.'}</div></div>
      <div class="card"><h2>Central Bank</h2><div class="metric">${wallet.centralBankBalance.toLocaleString()}</div><div class="muted">System reserve</div></div>
      <div class="card"><h2>Momiji Casino</h2><div class="metric">${wallet.casinoBalance.toLocaleString()}</div><div class="muted">House balance snapshot</div></div>
    </section>
    <div class="panel" style="margin-top:14px;">
      <div class="card">
        <h2>Quick Actions</h2>
        <a class="pill" href="${p('/bank/send')}">Send SGC</a>
        <a class="pill" href="${p('/bank/raffle')}" style="margin-left:8px;">Buy Raffle Ticket</a>
        <a class="pill" href="${p('/stocks')}" style="margin-left:8px;">Open Stocks</a>
        <a class="pill" href="${p('/bets')}" style="margin-left:8px;">Open Bets</a>
        <a class="pill" href="${p('/casino/slots')}" style="margin-left:8px;">Open Slots</a>
      </div>
      <div class="card">
        <h2>Recent Transactions</h2>
        ${renderTransactionsTable(transactions, session.discordId)}
      </div>
      <div class="card">
        <h2>Recent Receipts</h2>
        ${renderReceipts(receipts)}
      </div>
      <div class="card">
        <h2>Notifications</h2>
        ${renderNotifications(notifications)}
      </div>
    </div>
  `, { active: '/' });
}

function renderBankPage(session) {
  ensureAccount(session.discordId, session.username);
  const wallet = buildWalletSummary(session.discordId);
  return renderPage('Bank', session, `
    <div class="grid">
      <div class="card"><h2>Your Balance</h2><div class="metric">${wallet.balance.toLocaleString()} SGC</div></div>
      <div class="card"><h2>Transfer Fee</h2><div class="metric">${Math.round(wallet.transferFeeRate * 100)}%</div><div class="muted">${wallet.lottoDay ? 'Lotto day surcharge is active.' : 'Standard rate.'}</div></div>
    </div>
    <div class="grid" style="margin-top:14px;">
      <div class="card">
        <h2>Actions</h2>
        <p><a class="pill" href="${p('/bank/send')}">Send SGC</a></p>
        <p><a class="pill" href="${p('/bank/history')}">View History</a></p>
        <p><a class="pill" href="${p('/bank/raffle')}">Buy Raffle Ticket</a></p>
      </div>
      <div class="card">
        <h2>System Accounts</h2>
        <div>Central Bank: <strong>${wallet.centralBankBalance.toLocaleString()} SGC</strong></div>
        <div>Doll Street: <strong>${wallet.dollStreetBalance.toLocaleString()} SGC</strong></div>
        <div>Momiji Casino: <strong>${wallet.casinoBalance.toLocaleString()} SGC</strong></div>
      </div>
    </div>
  `, { active: '/bank' });
}

function renderHistoryPage(session) {
  ensureAccount(session.discordId, session.username);
  const transactions = getUserTransactions(session.discordId, 50);
  const receipts = getReceiptsForUser(session.discordId, 20);
  return renderPage('Bank History', session, `
    <div class="grid">
      <div class="card">
        <h2>Transaction History</h2>
        ${renderTransactionsTable(transactions, session.discordId)}
      </div>
      <div class="card">
        <h2>Web Receipts</h2>
        ${renderReceipts(receipts)}
      </div>
    </div>
  `, { active: '/bank/history' });
}

function renderSendPage(session) {
  ensureAccount(session.discordId, session.username);
  const pageScripts = `<script>
const form = document.getElementById('send-form');
const result = document.getElementById('send-result');
const searchBox = document.getElementById('recipient-search');
const searchResults = document.getElementById('search-results');

async function searchUsers(query) {
  if (!query || query.trim().length < 2) {
    searchResults.innerHTML = '';
    return;
  }
  const res = await fetch(${JSON.stringify(p('/api/users/search?q='))} + encodeURIComponent(query));
  const data = await res.json();
  if (!res.ok) {
    searchResults.innerHTML = '<div class="flash error">Search failed.</div>';
    return;
  }
  searchResults.innerHTML = data.results.map((user) => {
    const label = (user.username || user.userId) + ' (' + user.userId + ')';
    return '<div class="item"><button type="button" class="primary pick-user" data-user-id="' + user.userId + '" data-user-label="' + label.replace(/"/g, '&quot;') + '">Use</button> <span style="margin-left:8px;">' + label + '</span></div>';
  }).join('');
  document.querySelectorAll('.pick-user').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('recipient-user-id').value = btn.dataset.userId;
      document.getElementById('recipient-user-label').textContent = btn.dataset.userLabel;
    });
  });
}

searchBox.addEventListener('input', (event) => {
  searchUsers(event.target.value).catch(() => {
    searchResults.innerHTML = '<div class="flash error">Search failed.</div>';
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.innerHTML = '<div class="flash">Sending...</div>';
  const payload = {
    recipientUserId: document.getElementById('recipient-user-id').value,
    amount: Number(document.getElementById('amount').value),
    note: document.getElementById('note').value,
    idempotencyKey: document.getElementById('idempotency-key').value,
  };
  const res = await fetch(${JSON.stringify(p('/api/wallet/send'))}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Send failed.') + '</div>';
    return;
  }
  result.innerHTML = '<div class="flash success">' + data.message + '</div>';
  form.reset();
  document.getElementById('recipient-user-label').textContent = 'No recipient selected yet.';
});
</script>`;

  return renderPage('Send SadGirlCoin', session, `
    <div class="grid">
      <div class="card">
        <h2>Send Coins</h2>
        <div id="send-result"></div>
        <form id="send-form">
          <label>Find recipient</label>
          <input id="recipient-search" placeholder="Search by username or Discord ID">
          <div id="search-results" class="list"></div>
          <div class="flash">Selected recipient: <span id="recipient-user-label">No recipient selected yet.</span></div>
          <input id="recipient-user-id" placeholder="Recipient Discord ID" required>
          <input id="amount" type="number" min="1" step="1" placeholder="Amount in SGC" required>
          <textarea id="note" placeholder="Optional note"></textarea>
          <input id="idempotency-key" placeholder="Optional idempotency key (recommended for retries)">
          <button class="primary" type="submit">Send SGC</button>
        </form>
      </div>
      <div class="card">
        <h2>Notes</h2>
        <p>The transfer fee is charged on top of the amount you send.</p>
        <p class="muted">Example: sending 100 SGC at 1% costs 101 SGC total.</p>
        <p class="muted">If lotto day is active, the fee rate increases automatically.</p>
      </div>
    </div>
  `, { active: '/bank/send', pageScripts });
}

function renderRafflePage(session) {
  const pageScripts = `<script>
const raffleBtn = document.getElementById('raffle-buy');
const raffleResult = document.getElementById('raffle-result');
raffleBtn.addEventListener('click', async () => {
  raffleResult.innerHTML = '<div class="flash">Buying ticket...</div>';
  const res = await fetch(${JSON.stringify(p('/api/wallet/raffle'))}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: 'raffle:' + new Date().toISOString().slice(0, 10) }),
  });
  const data = await res.json();
  if (!res.ok) {
    raffleResult.innerHTML = '<div class="flash error">' + (data.error?.message || 'Purchase failed.') + '</div>';
    return;
  }
  raffleResult.innerHTML = '<div class="flash success">' + data.message + '</div>';
});
</script>`;

  return renderPage('Yearly Raffle', session, `
    <div class="grid">
      <div class="card">
        <h2>Yearly Raffle</h2>
        <p>Buy a raffle ticket with SadGirlCoin. Current displayed cost: <strong>${DEFAULT_RAFFLE_COST} SGC</strong>.</p>
        <div id="raffle-result"></div>
        <button class="primary" id="raffle-buy" type="button">Buy Ticket</button>
      </div>
      <div class="card">
        <h2>How It Works</h2>
        <p>Tickets are recorded in the same economy database as the Discord bot.</p>
        <p class="muted">If the configured raffle price differs from the display, the backend validation still wins.</p>
      </div>
    </div>
  `, { active: '/bank/raffle', pageScripts });
}

function renderStocksPage(session) {
  const stocks = buildStockListView();
  return renderPage('LumiStocks', session, `
    <div class="card">
      <h2>Exchange</h2>
      <p class="muted">Buy and sell with the same stock logic the Discord bot uses.</p>
      <table>
        <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>Move</th><th>Market Cap</th><th>Holders</th></tr></thead>
        <tbody>
          ${stocks.map((entry) => `
            <tr>
              <td><a href="${p(`/stocks/${entry.ticker}`)}" style="color:#ff69b4;text-decoration:none;"><strong>${escapeHtml(entry.ticker)}</strong></a></td>
              <td>${escapeHtml(entry.business_name)}</td>
              <td>${Number(entry.share_price).toFixed(2)} SGC</td>
              <td>${entry.priceChangePct >= 0 ? '+' : ''}${entry.priceChangePct.toFixed(1)}%</td>
              <td>${Number(entry.summary?.marketCap || 0).toFixed(0)} SGC</td>
              <td>${Number(entry.summary?.shareholderCount || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `, { active: '/stocks' });
}

function renderStockDetailPage(session, ticker) {
  const detail = buildStockDetailView(ticker, session.discordId);
  if (!detail) {
    return renderPage('Stock Not Found', session, `<div class="card"><h2>Not found</h2><p>Unknown ticker.</p></div>`, { active: '/stocks' });
  }

  const { stock, summary, transactions, viewerHolding } = detail;
  const pageScripts = `<script>
const stockActionResult = document.getElementById('stock-action-result');
async function submitStockAction(path, payload) {
  stockActionResult.innerHTML = '<div class="flash">Processing...</div>';
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    stockActionResult.innerHTML = '<div class="flash error">' + (data.error?.message || 'Request failed.') + '</div>';
    return;
  }
  stockActionResult.innerHTML = '<div class="flash success">' + data.message + '</div>';
  setTimeout(() => window.location.reload(), 800);
}

document.getElementById('stock-buy-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitStockAction(${JSON.stringify(p('/api/stocks/buy'))}, {
    ticker: ${JSON.stringify(stock.ticker)},
    amountSgc: Number(document.getElementById('buy-amount').value),
    idempotencyKey: document.getElementById('buy-idempotency-key').value,
  });
});

document.getElementById('stock-sell-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitStockAction(${JSON.stringify(p('/api/stocks/sell'))}, {
    ticker: ${JSON.stringify(stock.ticker)},
    shares: Number(document.getElementById('sell-shares').value),
    idempotencyKey: document.getElementById('sell-idempotency-key').value,
  });
});
</script>`;

  return renderPage(`Stock ${stock.ticker}`, session, `
    <div class="grid">
      <div class="card">
        <h2>${escapeHtml(stock.business_name)} (${escapeHtml(stock.ticker)})</h2>
        <div class="metric">${Number(summary.share_price).toFixed(2)} SGC</div>
        <div>Market cap: <strong>${Number(summary.marketCap).toFixed(0)} SGC</strong></div>
        <div>Shareholders: <strong>${Number(summary.shareholderCount)}</strong></div>
        <div>Dividend rate: <strong>${(Number(summary.dividend_rate) * 100).toFixed(1)}%</strong></div>
        <div class="muted" style="margin-top:8px;">Sentiment: ${escapeHtml(summary.metrics?.sentiment || 'Stable')} • Revenue growth ${summary.metrics?.revenueGrowthPct >= 0 ? '+' : ''}${Number(summary.metrics?.revenueGrowthPct || 0).toFixed(1)}%</div>
      </div>
      <div class="card">
        <h2>Your Position</h2>
        <div>${viewerHolding ? `${Number(viewerHolding.shares).toFixed(4)} shares` : 'No position yet.'}</div>
        <div class="muted">${viewerHolding ? `Total invested: ${Number(viewerHolding.total_invested).toFixed(2)} SGC` : 'Buy to open a position.'}</div>
      </div>
    </div>
    <div class="grid" style="margin-top:14px;">
      <div class="card">
        <h2>Trade</h2>
        <div id="stock-action-result"></div>
        <form id="stock-buy-form">
          <label>Buy amount (SGC)</label>
          <input id="buy-amount" type="number" min="1" step="1" required>
          <input id="buy-idempotency-key" placeholder="Optional buy idempotency key">
          <button class="primary" type="submit">Buy Shares</button>
        </form>
        <hr style="border-color:#23283a;margin:14px 0;">
        <form id="stock-sell-form">
          <label>Sell shares</label>
          <input id="sell-shares" type="number" min="0.01" step="0.01" required>
          <input id="sell-idempotency-key" placeholder="Optional sell idempotency key">
          <button class="primary" type="submit">Sell Shares</button>
        </form>
      </div>
      <div class="card">
        <h2>Recent Stock Activity</h2>
        ${renderStockTransactionsTable(transactions)}
      </div>
    </div>
  `, { active: '/stocks', pageScripts });
}

function renderPortfolioPage(session) {
  const holdings = getUserPortfolio(session.discordId);
  return renderPage('Portfolio', session, `
    <div class="card">
      <h2>Your Portfolio</h2>
      ${holdings.length === 0 ? '<p class="muted">No holdings yet.</p>' : `
        <table>
          <thead><tr><th>Ticker</th><th>Name</th><th>Shares</th><th>Avg Cost</th><th>Current</th><th>Invested</th><th>Dividends</th></tr></thead>
          <tbody>
            ${holdings.map((holding) => `
              <tr>
                <td><a href="${p(`/stocks/${holding.ticker}`)}" style="color:#ff69b4;text-decoration:none;">${escapeHtml(holding.ticker)}</a></td>
                <td>${escapeHtml(holding.business_name)}</td>
                <td>${Number(holding.shares).toFixed(4)}</td>
                <td>${Number(holding.avg_cost_basis).toFixed(2)}</td>
                <td>${Number(holding.share_price).toFixed(2)}</td>
                <td>${Number(holding.total_invested).toFixed(2)}</td>
                <td>${Number(holding.total_dividends).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `, { active: '/portfolio' });
}

function renderBetsPage(session) {
  const openMarkets = getOpenMarkets();
  const pendingMarkets = getPendingMarkets();
  return renderPage('LumiBets', session, `
    <div class="grid">
      <div class="card">
        <h2>Open Markets</h2>
        ${renderMarketCards(openMarkets, session.discordId)}
      </div>
      <div class="card">
        <h2>Pending Markets</h2>
        ${renderMarketCards(pendingMarkets, session.discordId)}
      </div>
    </div>
    <div class="card" style="margin-top:14px;">
      <h2>Create Market</h2>
      <form id="create-market-form">
        <input id="market-title" placeholder="Market title" required>
        <textarea id="market-description" placeholder="Description"></textarea>
        <input id="market-options" placeholder="Optional options, comma-separated. Leave blank for yes/no.">
        <button class="primary" type="submit">Create Market</button>
      </form>
      <div id="create-market-result"></div>
    </div>
  `, {
    active: '/bets',
    pageScripts: `<script>
document.getElementById('create-market-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.getElementById('create-market-result');
  result.innerHTML = '<div class="flash">Creating...</div>';
  const res = await fetch(${JSON.stringify(p('/api/bets'))}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: document.getElementById('market-title').value,
      description: document.getElementById('market-description').value,
      options: document.getElementById('market-options').value,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Create failed.') + '</div>';
    return;
  }
  result.innerHTML = '<div class="flash success">' + data.message + '</div>';
  setTimeout(() => window.location.href = ${JSON.stringify(p('/bets/'))} + data.marketId, 700);
});
</script>`,
  });
}

function renderBetDetailPage(session, marketId) {
  const market = getMarket(Number(marketId));
  if (!market) {
    return renderPage('Market Not Found', session, `<div class="card"><h2>Not found</h2><p>Unknown market.</p></div>`, { active: '/bets' });
  }
  const view = buildMarketView(market, session.discordId);
  const pageScripts = `<script>
document.getElementById('bet-buy-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.getElementById('bet-buy-result');
  result.innerHTML = '<div class="flash">Buying position...</div>';
  const res = await fetch(${JSON.stringify(p(`/api/bets/${market.id}/buy`))}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      side: document.getElementById('bet-side').value,
      amountSgc: Number(document.getElementById('bet-amount').value),
      idempotencyKey: document.getElementById('bet-idempotency-key').value,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Buy failed.') + '</div>';
    return;
  }
  result.innerHTML = '<div class="flash success">' + data.message + '</div>';
  setTimeout(() => window.location.reload(), 700);
});
</script>`;

  return renderPage(`Bet #${market.id}`, session, `
    <div class="grid">
      <div class="card">
        <h2>#${market.id} ${escapeHtml(market.title)}</h2>
        <div>${escapeHtml(market.description || '')}</div>
        <div class="muted" style="margin-top:8px;">Status: ${escapeHtml(market.status)} • Pool: ${Number(market.pool || 0).toLocaleString()} SGC • Stars: ${Number(market.star_count || 0)}</div>
      </div>
      <div class="card">
        <h2>Market Options</h2>
        ${view.options.map((option) => `
          <div class="item" style="margin-bottom:8px;">
            <strong>${escapeHtml(option.name)}</strong><br>
            ${Number(option.totalAmount).toLocaleString()} SGC across ${option.positionCount} position(s)
            <div class="muted">${option.sharePct.toFixed(1)}% of staked volume</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="grid" style="margin-top:14px;">
      <div class="card">
        <h2>Buy Position</h2>
        <div id="bet-buy-result"></div>
        <form id="bet-buy-form">
          <label>Option</label>
          <input id="bet-side" placeholder="Option name or number" required>
          <label>Amount (SGC)</label>
          <input id="bet-amount" type="number" min="1" step="1" required>
          <input id="bet-idempotency-key" placeholder="Optional idempotency key">
          <button class="primary" type="submit">Buy Position</button>
        </form>
      </div>
      <div class="card">
        <h2>Your Positions</h2>
        ${view.viewerPositions.length === 0 ? '<p class="muted">No positions on this market yet.</p>' : `
          <table>
            <thead><tr><th>When</th><th>Side</th><th>Amount</th><th>Settled</th><th>Payout</th></tr></thead>
            <tbody>
              ${view.viewerPositions.map((position) => `
                <tr>
                  <td>${escapeHtml(position.created_at)}</td>
                  <td>${escapeHtml(position.side)}</td>
                  <td>${Number(position.amount).toLocaleString()}</td>
                  <td>${position.settled ? 'Yes' : 'No'}</td>
                  <td>${Number(position.payout || 0).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    </div>
  `, { active: '/bets', pageScripts });
}

function renderSlotsIndexPage(session) {
  return renderPage('Slots', session, `
    <div class="card">
      <h2>Slots Lobbies</h2>
      <p class="muted">Create a new worker-backed slots lobby and open it inside this embedded app.</p>
      <button class="primary" id="create-slots-lobby" type="button">Create Slots Lobby</button>
      <div id="slots-create-result" style="margin-top:12px;"></div>
    </div>
  `, {
    active: '/casino/slots',
    pageScripts: `<script>
document.getElementById('create-slots-lobby').addEventListener('click', async () => {
  const result = document.getElementById('slots-create-result');
  result.innerHTML = '<div class="flash">Creating lobby...</div>';
  const res = await fetch(${JSON.stringify(p('/api/casino/slots/lobbies'))}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) {
    result.innerHTML = '<div class="flash error">' + (data.error?.message || 'Create failed.') + '</div>';
    return;
  }
  window.location.href = ${JSON.stringify(p('/casino/slots/'))} + data.lobbyId;
});
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
      <div id="slots-lobby-state" class="list"><div class="item">Connecting...</div></div>
    </div>
    <div class="card">
      <h2>Actions</h2>
      <div id="slots-action-result"></div>
      <div class="list">
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
    active: '/casino/slots',
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
    ...players.map((player) => '<div class="item"><strong>' + player.name + '</strong><pre style="white-space:pre-wrap;margin:8px 0 0;">' + player.value + '</pre></div>')
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
  const res = await fetch(${JSON.stringify(p('/api/casino/slots/lobbies/'))} + lobbyId);
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
    if (msg.type === 'slots.render' && msg.lobbyId === lobbyId) {
      renderSlotsState(msg.state);
    }
    if (msg.type === 'slots.closed' && msg.lobbyId === lobbyId) {
      stateEl.innerHTML = '<div class="item"><strong>Lobby closed</strong><div>' + (msg.content || '') + '</div></div>';
    }
  });
}

document.getElementById('slots-join').addEventListener('click', () => {
  postAction(${JSON.stringify(p('/api/casino/slots/lobbies/'))} + lobbyId + '/join');
});
document.getElementById('slots-set-bet').addEventListener('click', () => {
  postAction(${JSON.stringify(p('/api/casino/slots/lobbies/'))} + lobbyId + '/bet', {
    amount: Number(document.getElementById('slots-bet-amount').value),
  });
});
document.getElementById('slots-spin').addEventListener('click', () => {
  postAction(${JSON.stringify(p('/api/casino/slots/lobbies/'))} + lobbyId + '/spin');
});
document.getElementById('slots-leave').addEventListener('click', () => {
  postAction(${JSON.stringify(p('/api/casino/slots/lobbies/'))} + lobbyId + '/leave');
});

connectWs();
refreshLobby();
</script>`,
  });
}

function requireMemberSession(req, res, {
  api = false,
  nextPath = null,
} = {}) {
  const session = requireUserAuth(req);
  if (session) {
    ensureAccount(session.discordId, session.username);
    return session;
  }

  if (api) {
    sendError(res, 401, 'unauthorized', 'Login required');
    return null;
  }

  const target = nextPath || p('/');
  res.writeHead(302, {
    Location: `${p('/login')}?next=${encodeURIComponent(target)}`,
  });
  res.end();
  return null;
}

function walletPayloadFor(session) {
  const summary = buildWalletSummary(session.discordId);
  return {
    userId: session.discordId,
    username: session.username,
    balance: summary.balance,
    transferFeeRate: summary.transferFeeRate,
    lottoDay: summary.lottoDay,
    systemAccounts: {
      centralBank: summary.centralBankBalance,
      dollStreet: summary.dollStreetBalance,
      momijiCasino: summary.casinoBalance,
    },
  };
}

function getMarketPositionStats(marketId) {
  const db = getEconomyDb();
  const rows = db.prepare(`
    SELECT side, COUNT(*) AS position_count, COALESCE(SUM(amount), 0) AS total_amount
    FROM stock_positions
    WHERE market_id = ?
    GROUP BY side
    ORDER BY total_amount DESC, side ASC
  `).all(Number(marketId));
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  return {
    totalAmount,
    options: rows.map((row) => ({
      side: row.side,
      totalAmount: Number(row.total_amount || 0),
      positionCount: Number(row.position_count || 0),
      sharePct: totalAmount > 0 ? ((Number(row.total_amount || 0) / totalAmount) * 100) : 0,
    })),
  };
}

function getViewerMarketPositions(userId, marketId) {
  const db = getEconomyDb();
  return db.prepare(`
    SELECT id, side, amount, settled, payout, created_at
    FROM stock_positions
    WHERE user_id = ? AND market_id = ?
    ORDER BY id DESC
  `).all(String(userId), Number(marketId));
}

function buildMarketView(market, viewerId = null) {
  if (!market) return null;
  const options = getMarketOptions(market);
  const stats = getMarketPositionStats(market.id);
  const statsBySide = new Map(stats.options.map((entry) => [entry.side.toLowerCase(), entry]));
  return {
    ...market,
    options: options.map((option) => {
      const stat = statsBySide.get(String(option).toLowerCase());
      return {
        name: option,
        totalAmount: stat?.totalAmount || 0,
        positionCount: stat?.positionCount || 0,
        sharePct: stat?.sharePct || 0,
      };
    }),
    isYesNo: isYesNoMarket(market),
    viewerPositions: viewerId ? getViewerMarketPositions(viewerId, market.id) : [],
  };
}

function buildStockListView() {
  return getAllStocks().map((stock) => {
    const summary = getStockSummary(stock.id);
    const priceChangePct = summary && Number(summary.initial_price) > 0
      ? (((Number(summary.share_price) - Number(summary.initial_price)) / Number(summary.initial_price)) * 100)
      : 0;
    return {
      ...stock,
      summary,
      priceChangePct,
    };
  });
}

function buildStockDetailView(stockRef, userId = null) {
  const stock = typeof stockRef === 'object' && stockRef
    ? stockRef
    : (/^\d+$/u.test(String(stockRef || '')) ? getStockById(Number(stockRef)) : getStockByTicker(String(stockRef || '')));
  if (!stock) return null;
  const summary = getStockSummary(stock.id);
  const transactions = getStockTransactions(stock.id, 20);
  const viewerHolding = userId ? getUserHolding(userId, stock.id) : null;
  return {
    stock,
    summary,
    transactions,
    viewerHolding,
  };
}

function renderStockTransactionsTable(transactions) {
  if (!transactions.length) return '<p class="muted">No stock transactions yet.</p>';
  return `<table>
    <thead><tr><th>When</th><th>Type</th><th>Shares</th><th>Price</th><th>Total</th><th>Note</th></tr></thead>
    <tbody>
      ${transactions.map((txn) => `
        <tr>
          <td>${escapeHtml(txn.created_at)}</td>
          <td>${escapeHtml(txn.type)}</td>
          <td>${Number(txn.shares || 0).toFixed(4)}</td>
          <td>${Number(txn.price_per_share || 0).toFixed(2)}</td>
          <td>${Number(txn.total_amount || 0).toFixed(2)}</td>
          <td>${escapeHtml(txn.note || '')}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function renderMarketCards(markets, viewerId) {
  if (!markets.length) return '<p class="muted">No markets here yet.</p>';
  return `<div class="list">${markets.map((market) => {
    const view = buildMarketView(market, viewerId);
    const optionLines = view.options.map((option) =>
      `<div>${escapeHtml(option.name)}: <strong>${Number(option.totalAmount).toLocaleString()} SGC</strong> <span class="muted">(${option.sharePct.toFixed(1)}%)</span></div>`
    ).join('');
    return `<div class="item">
      <div><strong><a href="${p(`/bets/${market.id}`)}" style="color:#ff69b4;text-decoration:none;">#${market.id} ${escapeHtml(market.title)}</a></strong></div>
      <div>${escapeHtml(market.description || '')}</div>
      <div class="muted">Status: ${escapeHtml(market.status)} • Pool: ${Number(market.pool || 0).toLocaleString()} SGC</div>
      <div style="margin-top:8px;">${optionLines}</div>
    </div>`;
  }).join('')}</div>`;
}

function generateLobbyId(prefix = 'slots') {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function getWebSlotsChannelId(lobbyId) {
  return `web:slots:${String(lobbyId)}`;
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

function buildWsFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(length, 6);
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
      for (let i = 0; i < payloadLength; i += 1) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    messages.push({ opcode, payload: payload.toString('utf8') });
    offset += frameLength;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

function sendWsJson(client, payload) {
  if (!client || client.socket.destroyed) return;
  try {
    client.socket.write(buildWsFrame(JSON.stringify(payload)));
  } catch {
    // socket teardown handled elsewhere
  }
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
  if (!client) return;
  wsClients.delete(client);
  for (const channel of [...client.channels]) {
    unsubscribeClient(client, channel);
  }
}

function broadcastToChannel(channel, payload) {
  const bucket = wsSubscriptions.get(channel);
  if (!bucket) return;
  for (const client of bucket) {
    sendWsJson(client, payload);
  }
}

function handleWsMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    sendWsJson(client, { type: 'error', message: 'Invalid JSON frame' });
    return;
  }

  if (message.type === 'ping') {
    sendWsJson(client, { type: 'pong', ts: Date.now() });
    return;
  }
  if (message.type === 'subscribe') {
    subscribeClient(client, String(message.channel || ''));
    sendWsJson(client, { type: 'subscribed', channel: String(message.channel || '') });
    return;
  }
  if (message.type === 'unsubscribe') {
    unsubscribeClient(client, String(message.channel || ''));
    sendWsJson(client, { type: 'unsubscribed', channel: String(message.channel || '') });
    return;
  }

  sendWsJson(client, { type: 'error', message: 'Unknown websocket message type' });
}

function installWsBridge() {
  if (wsListenerInstalled) return;
  wsListenerInstalled = true;

  manager.onEngineEvent('slots', (evt) => {
    if (!evt || typeof evt.channelId !== 'string' || !evt.channelId.startsWith('web:slots:')) return;
    const lobbyId = evt.channelId.replace(/^web:slots:/u, '');
    if (evt.name === 'render') {
      broadcastToChannel(`slots:lobby:${lobbyId}`, {
        type: 'slots.render',
        lobbyId,
        state: serializeSlotsPayload(evt),
      });
      return;
    }
    if (evt.name === 'lobbyClosed') {
      broadcastToChannel(`slots:lobby:${lobbyId}`, {
        type: 'slots.closed',
        lobbyId,
        content: evt.content || 'Lobby closed',
      });
      return;
    }
    if (evt.name === 'spinComplete') {
      broadcastToChannel(`slots:lobby:${lobbyId}`, {
        type: 'slots.spinComplete',
        lobbyId,
        result: evt,
      });
    }
  });
}

function handleWsUpgrade(req, socket) {
  let parsedUrl;
  try {
    parsedUrl = parseUrl(req);
  } catch {
    socket.destroy();
    return;
  }
  const pathname = routePath(parsedUrl.pathname);
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const session = requireUserAuth(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key || typeof key !== 'string') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n'));

  const client = {
    socket,
    session,
    channels: new Set(),
    buffer: Buffer.alloc(0),
  };
  wsClients.add(client);
  subscribeClient(client, `user:${session.discordId}`);
  sendWsJson(client, {
    type: 'hello',
    userId: session.discordId,
    username: session.username,
  });

  socket.on('data', (chunk) => {
    try {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      const { messages, remaining } = parseWsFrames(client.buffer);
      client.buffer = remaining;
      for (const message of messages) {
        if (message.opcode === 0x8) {
          socket.end();
          return;
        }
        if (message.opcode === 0x9) {
          socket.write(Buffer.from([0x8a, 0x00]));
          continue;
        }
        if (message.opcode === 0x1) {
          handleWsMessage(client, message.payload);
        }
      }
    } catch {
      socket.destroy();
    }
  });
  socket.on('close', () => removeWsClient(client));
  socket.on('end', () => removeWsClient(client));
  socket.on('error', () => removeWsClient(client));
}

async function handleRequest(req, res) {
  const parsedUrl = parseUrl(req);
  const pathname = routePath(parsedUrl.pathname);
  const method = (req.method || 'GET').toUpperCase();

  if (pathname === null) {
    sendError(res, 404, 'not_found', 'Unknown route');
    return;
  }

  if (pathname === '/auth/discord/login' && method === 'GET') {
    handleLoginRoute(req, res, {
      authConfig: { redirectUri: WEB_APP_DISCORD_OAUTH_REDIRECT_URI },
    });
    return;
  }
  if (pathname === '/auth/discord/callback' && method === 'GET') {
    await handleCallbackRoute(req, res, parsedUrl, {
      basePath: WEB_APP_BASE_PATH,
      loginPath: `${p('/login')}`,
      authConfig: { redirectUri: WEB_APP_DISCORD_OAUTH_REDIRECT_URI },
      popupMessageType: 'lumibot-auth-complete',
      popupTargetOrigin: WEB_APP_POSTMESSAGE_TARGET_ORIGIN,
      cookieOptions: {
        sameSite: WEB_APP_SESSION_SAMESITE,
        secure: WEB_APP_SESSION_SECURE,
      },
    });
    return;
  }
  if (pathname === '/auth/logout' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
      if (!originCheck.ok) {
        sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
        return;
      }
      handleLogoutRoute(req, res, {
        loginPath: `${p('/login')}`,
        cookieOptions: {
          sameSite: WEB_APP_SESSION_SAMESITE,
          secure: WEB_APP_SESSION_SECURE,
        },
      });
      return;
    }
  if (pathname === '/login' && method === 'GET') {
    const nextPath = String(parsedUrl.searchParams.get('next') || p('/'));
    sendHtml(res, 200, renderLoginPage(nextPath));
    return;
  }

  if (pathname === '/api/me' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    sendJson(res, 200, {
      viewer: {
        discordId: session.discordId,
        username: session.username,
      },
      wallet: walletPayloadFor(session),
      unreadNotifications: getUnreadNotificationCount(session.discordId),
    });
    return;
  }

  if (pathname === '/api/wallet' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    sendJson(res, 200, walletPayloadFor(session));
    return;
  }

  if (pathname === '/api/wallet/transactions' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const limit = Math.max(1, Math.min(100, Number(parsedUrl.searchParams.get('limit')) || 50));
    sendJson(res, 200, {
      transactions: getUserTransactions(session.discordId, limit),
    });
    return;
  }

  if (pathname === '/api/receipts' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const limit = Math.max(1, Math.min(100, Number(parsedUrl.searchParams.get('limit')) || 20));
    sendJson(res, 200, {
      receipts: getReceiptsForUser(session.discordId, limit),
    });
    return;
  }

  if (pathname === '/api/notifications' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const limit = Math.max(1, Math.min(100, Number(parsedUrl.searchParams.get('limit')) || 20));
    sendJson(res, 200, {
      notifications: getNotificationsForUser(session.discordId, limit),
      unread: getUnreadNotificationCount(session.discordId),
    });
    return;
  }

  const markNotifMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/u);
  if (markNotifMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    markNotificationRead(session.discordId, Number(markNotifMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/users/search' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const query = String(parsedUrl.searchParams.get('q') || '').trim();
    if (query.length < 2) {
      sendJson(res, 200, { results: [] });
      return;
    }
    const results = searchAccounts(query, 10)
      .filter((row) => row.user_id !== session.discordId && !String(row.user_id).startsWith('__'))
      .map((row) => ({
        userId: row.user_id,
        username: row.username,
        balance: row.balance,
      }));
    sendJson(res, 200, { results });
    return;
  }

  if (pathname === '/api/stocks' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    sendJson(res, 200, {
      stocks: buildStockListView(),
      portfolio: getUserPortfolio(session.discordId),
    });
    return;
  }

  const stockDetailApiMatch = pathname.match(/^\/api\/stocks\/([^/]+)$/u);
  if (stockDetailApiMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const detail = buildStockDetailView(decodeURIComponent(stockDetailApiMatch[1]), session.discordId);
    if (!detail) return sendError(res, 404, 'not_found', 'Stock not found');
    sendJson(res, 200, detail);
    return;
  }

  if (pathname === '/api/stocks/buy' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    let body;
    try { body = await readJsonBody(req); } catch (error) { return sendError(res, 400, 'bad_request', error.message); }
    const ticker = String(body.ticker || '').trim().toUpperCase();
    const amountSgc = Number(body.amountSgc);
    const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 160);
    if (!ticker) return sendError(res, 400, 'bad_request', 'ticker is required');
    if (!Number.isFinite(amountSgc) || amountSgc <= 0 || Math.floor(amountSgc) !== amountSgc) {
      return sendError(res, 400, 'bad_request', 'amountSgc must be a positive integer');
    }
    const existingReceipt = getActionReceiptByKey(session.discordId, 'stocks.buy', idempotencyKey);
    if (existingReceipt) {
      return sendJson(res, 200, { ok: true, replayed: true, message: existingReceipt.summary, receipt: existingReceipt });
    }
    const stock = getStockByTicker(ticker);
    if (!stock) return sendError(res, 404, 'not_found', 'Stock not found');
    const result = buyShares(session.discordId, session.username, stock.id, amountSgc);
    if (!result.success) return sendError(res, 400, 'buy_failed', result.error);
    const summary = `Bought ${result.shares.toFixed(4)} shares of ${ticker} for ${amountSgc.toLocaleString()} SGC.`;
    const receipt = createActionReceipt(session.discordId, {
      actionType: 'stocks.buy',
      idempotencyKey,
      summary,
      payload: { ticker, amountSgc, shares: result.shares, newPrice: result.newPrice },
    });
    createNotification(session.discordId, {
      kind: 'stocks',
      title: `Bought ${ticker}`,
      body: summary,
      link: p(`/stocks/${ticker}`),
    });
    sendJson(res, 200, {
      ok: true,
      message: summary,
      balance: getBalance(session.discordId),
      receipt,
      result,
    });
    return;
  }

  if (pathname === '/api/stocks/sell' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    let body;
    try { body = await readJsonBody(req); } catch (error) { return sendError(res, 400, 'bad_request', error.message); }
    const ticker = String(body.ticker || '').trim().toUpperCase();
    const shares = Number(body.shares);
    const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 160);
    if (!ticker) return sendError(res, 400, 'bad_request', 'ticker is required');
    if (!Number.isFinite(shares) || shares <= 0) {
      return sendError(res, 400, 'bad_request', 'shares must be a positive number');
    }
    const existingReceipt = getActionReceiptByKey(session.discordId, 'stocks.sell', idempotencyKey);
    if (existingReceipt) {
      return sendJson(res, 200, { ok: true, replayed: true, message: existingReceipt.summary, receipt: existingReceipt });
    }
    const stock = getStockByTicker(ticker);
    if (!stock) return sendError(res, 404, 'not_found', 'Stock not found');
    const result = sellShares(session.discordId, session.username, stock.id, shares);
    if (!result.success) return sendError(res, 400, 'sell_failed', result.error);
    const summary = `Sold ${Number(shares).toFixed(4)} shares of ${ticker} for ${Number(result.proceeds).toLocaleString()} SGC.`;
    const receipt = createActionReceipt(session.discordId, {
      actionType: 'stocks.sell',
      idempotencyKey,
      summary,
      payload: { ticker, shares, proceeds: result.proceeds, newPrice: result.newPrice },
    });
    createNotification(session.discordId, {
      kind: 'stocks',
      title: `Sold ${ticker}`,
      body: summary,
      link: p(`/stocks/${ticker}`),
    });
    sendJson(res, 200, {
      ok: true,
      message: summary,
      balance: getBalance(session.discordId),
      receipt,
      result,
    });
    return;
  }

  if (pathname === '/api/bets/open' && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    sendJson(res, 200, {
      open: getOpenMarkets().map((market) => buildMarketView(market, session.discordId)),
      pending: getPendingMarkets().map((market) => buildMarketView(market, session.discordId)),
    });
    return;
  }

  const betDetailApiMatch = pathname.match(/^\/api\/bets\/(\d+)$/u);
  if (betDetailApiMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const market = getMarket(Number(betDetailApiMatch[1]));
    if (!market) return sendError(res, 404, 'not_found', 'Market not found');
    sendJson(res, 200, { market: buildMarketView(market, session.discordId) });
    return;
  }

  if (pathname === '/api/bets' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    let body;
    try { body = await readJsonBody(req); } catch (error) { return sendError(res, 400, 'bad_request', error.message); }
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const options = String(body.options || '').trim() || null;
    if (!title) return sendError(res, 400, 'bad_request', 'title is required');
    const result = createMarket(session.discordId, title, description, options, { adminAutoLive: false, guildId: '' });
    if (!result.success) return sendError(res, 400, 'create_failed', result.error);
    const summary = `Created market #${result.marketId}: ${title}`;
    const receipt = createActionReceipt(session.discordId, {
      actionType: 'bets.create',
      summary,
      payload: { marketId: result.marketId, title, options: result.options },
    });
    createNotification(session.discordId, {
      kind: 'bets',
      title: 'Market created',
      body: summary,
      link: p(`/bets/${result.marketId}`),
    });
    sendJson(res, 200, {
      ok: true,
      marketId: result.marketId,
      message: summary,
      receipt,
    });
    return;
  }

  const betBuyApiMatch = pathname.match(/^\/api\/bets\/(\d+)\/buy$/u);
  if (betBuyApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    let body;
    try { body = await readJsonBody(req); } catch (error) { return sendError(res, 400, 'bad_request', error.message); }
    const marketId = Number(betBuyApiMatch[1]);
    const side = String(body.side || '').trim();
    const amountSgc = Number(body.amountSgc);
    const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 160);
    if (!side) return sendError(res, 400, 'bad_request', 'side is required');
    if (!Number.isFinite(amountSgc) || amountSgc <= 0 || Math.floor(amountSgc) !== amountSgc) {
      return sendError(res, 400, 'bad_request', 'amountSgc must be a positive integer');
    }
    const existingReceipt = getActionReceiptByKey(session.discordId, 'bets.buy', idempotencyKey);
    if (existingReceipt) {
      return sendJson(res, 200, { ok: true, replayed: true, message: existingReceipt.summary, receipt: existingReceipt });
    }
    const result = buyStockPosition(session.discordId, session.username, marketId, side, amountSgc);
    if (!result.success) return sendError(res, 400, 'buy_failed', result.error);
    const market = getMarket(marketId);
    const summary = `Bought ${amountSgc.toLocaleString()} SGC on ${result.matchedSide || side} for market #${marketId}.`;
    const receipt = createActionReceipt(session.discordId, {
      actionType: 'bets.buy',
      idempotencyKey,
      summary,
      payload: { marketId, title: market?.title || '', side: result.matchedSide || side, amountSgc },
    });
    createNotification(session.discordId, {
      kind: 'bets',
      title: `Bought market position #${marketId}`,
      body: summary,
      link: p(`/bets/${marketId}`),
    });
    sendJson(res, 200, {
      ok: true,
      message: summary,
      balance: getBalance(session.discordId),
      receipt,
    });
    return;
  }

  if (pathname === '/api/casino/slots/lobbies' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = generateLobbyId('slots');
    sendJson(res, 200, {
      ok: true,
      lobbyId,
      joinUrl: p(`/casino/slots/${lobbyId}`),
    });
    return;
  }

  const slotsLobbyApiMatch = pathname.match(/^\/api\/casino\/slots\/lobbies\/([^/]+)$/u);
  if (slotsLobbyApiMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsLobbyApiMatch[1]);
    try {
      const result = await manager.sendCommand('slots', 'getLobby', { channelId: getWebSlotsChannelId(lobbyId) }, { channelId: getWebSlotsChannelId(lobbyId) });
      sendJson(res, 200, {
        ok: true,
        lobbyId,
        state: result && result.ok ? serializeSlotsPayload(result) : null,
      });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsJoinApiMatch = pathname.match(/^\/api\/casino\/slots\/lobbies\/([^/]+)\/join$/u);
  if (slotsJoinApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsJoinApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'join', {
        channelId,
        userId: session.discordId,
        username: session.username,
      }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'join_failed', 'Could not join slots lobby');
      sendJson(res, 200, {
        ok: true,
        message: 'Joined slots lobby.',
        state: serializeSlotsPayload(result),
      });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsBetApiMatch = pathname.match(/^\/api\/casino\/slots\/lobbies\/([^/]+)\/bet$/u);
  if (slotsBetApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    let body;
    try { body = await readJsonBody(req); } catch (error) { return sendError(res, 400, 'bad_request', error.message); }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
      return sendError(res, 400, 'bad_request', 'amount must be a positive integer');
    }
    const lobbyId = decodeURIComponent(slotsBetApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'setBet', {
        channelId,
        userId: session.discordId,
        username: session.username,
        amount,
      }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'bet_failed', 'Could not set bet');
      sendJson(res, 200, {
        ok: true,
        message: `Set bet to ${amount} SGC.`,
        state: serializeSlotsPayload(result),
      });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsSpinApiMatch = pathname.match(/^\/api\/casino\/slots\/lobbies\/([^/]+)\/spin$/u);
  if (slotsSpinApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsSpinApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'spin', {
        channelId,
        userId: session.discordId,
        username: session.username,
      }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'spin_failed', 'Could not spin');
      sendJson(res, 200, {
        ok: true,
        message: 'Spin started.',
        state: serializeSlotsPayload(result),
      });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  const slotsLeaveApiMatch = pathname.match(/^\/api\/casino\/slots\/lobbies\/([^/]+)\/leave$/u);
  if (slotsLeaveApiMatch && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;
    const lobbyId = decodeURIComponent(slotsLeaveApiMatch[1]);
    const channelId = getWebSlotsChannelId(lobbyId);
    try {
      const result = await manager.sendCommand('slots', 'leave', {
        channelId,
        userId: session.discordId,
      }, { channelId });
      if (!result.ok) return sendError(res, 400, result.reason || 'leave_failed', 'Could not leave lobby');
      sendJson(res, 200, {
        ok: true,
        message: 'Left slots lobby.',
        state: result.closed ? null : serializeSlotsPayload(result),
      });
    } catch (error) {
      sendError(res, 503, 'slots_unavailable', error.message);
    }
    return;
  }

  if (pathname === '/api/wallet/send' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendError(res, 400, 'bad_request', error.message);
      return;
    }

    const recipientUserId = String(body.recipientUserId || '').trim();
    const amount = Number(body.amount);
    const note = String(body.note || '').trim().slice(0, 160);
    const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 160);

    if (!recipientUserId || !/^\d+$/u.test(recipientUserId)) {
      sendError(res, 400, 'bad_request', 'recipientUserId must be a Discord ID');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
      sendError(res, 400, 'bad_request', 'amount must be a positive integer');
      return;
    }

    const existingReceipt = getActionReceiptByKey(session.discordId, 'wallet.send', idempotencyKey);
    if (existingReceipt) {
      sendJson(res, 200, {
        ok: true,
        replayed: true,
        message: existingReceipt.summary,
        receipt: existingReceipt,
      });
      return;
    }

    ensureAccount(recipientUserId);
    const result = transferCoins(session.discordId, recipientUserId, amount, note);
    if (!result.success) {
      sendError(res, 400, 'transfer_failed', result.error);
      return;
    }

    const summary = `Sent ${amount.toLocaleString()} SGC to ${recipientUserId}. Fee: ${result.fee.toLocaleString()} SGC.`;
    const receipt = createActionReceipt(session.discordId, {
      actionType: 'wallet.send',
      idempotencyKey,
      summary,
      payload: { recipientUserId, amount, fee: result.fee, note },
    });
    createNotification(session.discordId, {
      kind: 'wallet',
      title: 'Transfer sent',
      body: summary,
      link: p('/bank/history'),
    });
    createNotification(recipientUserId, {
      kind: 'wallet',
      title: 'Transfer received',
      body: `You received ${amount.toLocaleString()} SGC from ${session.username || session.discordId}.`,
      link: p('/bank/history'),
    });

    sendJson(res, 200, {
      ok: true,
      fee: result.fee,
      balance: getBalance(session.discordId),
      message: summary,
      receipt,
    });
    return;
  }

  if (pathname === '/api/wallet/raffle' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) return sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
    const session = requireMemberSession(req, res, { api: true });
    if (!session) return;

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendError(res, 400, 'bad_request', error.message);
      return;
    }

    const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 160);
    const existingReceipt = getActionReceiptByKey(session.discordId, 'wallet.raffle', idempotencyKey);
    if (existingReceipt) {
      sendJson(res, 200, {
        ok: true,
        replayed: true,
        message: existingReceipt.summary,
        receipt: existingReceipt,
      });
      return;
    }

    const result = buyYearlyRaffleTicket(session.discordId, session.username);
    if (!result.success) {
      sendError(res, 400, 'raffle_failed', result.error);
      return;
    }

    const summary = `Bought a yearly raffle ticket. You now have ${result.ticketCount} ticket(s).`;
    const receipt = createActionReceipt(session.discordId, {
      actionType: 'wallet.raffle',
      idempotencyKey,
      summary,
      payload: { ticketCount: result.ticketCount },
    });
    createNotification(session.discordId, {
      kind: 'raffle',
      title: 'Raffle ticket purchased',
      body: summary,
      link: p('/bank/raffle'),
    });

    sendJson(res, 200, {
      ok: true,
      ticketCount: result.ticketCount,
      balance: getBalance(session.discordId),
      message: summary,
      receipt,
    });
    return;
  }

  if (pathname === '/' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/') });
    if (!session) return;
    sendHtml(res, 200, renderDashboard(session));
    return;
  }

  if (pathname === '/bank' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/bank') });
    if (!session) return;
    sendHtml(res, 200, renderBankPage(session));
    return;
  }

  if (pathname === '/bank/history' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/bank/history') });
    if (!session) return;
    sendHtml(res, 200, renderHistoryPage(session));
    return;
  }

  if (pathname === '/bank/send' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/bank/send') });
    if (!session) return;
    sendHtml(res, 200, renderSendPage(session));
    return;
  }

  if (pathname === '/bank/raffle' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/bank/raffle') });
    if (!session) return;
    sendHtml(res, 200, renderRafflePage(session));
    return;
  }

  if (pathname === '/stocks' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/stocks') });
    if (!session) return;
    sendHtml(res, 200, renderStocksPage(session));
    return;
  }

  const stockPageMatch = pathname.match(/^\/stocks\/([^/]+)$/u);
  if (stockPageMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p(`/stocks/${decodeURIComponent(stockPageMatch[1])}`) });
    if (!session) return;
    sendHtml(res, 200, renderStockDetailPage(session, decodeURIComponent(stockPageMatch[1])));
    return;
  }

  if (pathname === '/portfolio' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/portfolio') });
    if (!session) return;
    sendHtml(res, 200, renderPortfolioPage(session));
    return;
  }

  if (pathname === '/bets' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/bets') });
    if (!session) return;
    sendHtml(res, 200, renderBetsPage(session));
    return;
  }

  if (pathname === '/casino/slots' && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p('/casino/slots') });
    if (!session) return;
    sendHtml(res, 200, renderSlotsIndexPage(session));
    return;
  }

  const slotsLobbyPageMatch = pathname.match(/^\/casino\/slots\/([^/]+)$/u);
  if (slotsLobbyPageMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p(`/casino/slots/${slotsLobbyPageMatch[1]}`) });
    if (!session) return;
    sendHtml(res, 200, renderSlotsLobbyPage(session, decodeURIComponent(slotsLobbyPageMatch[1])));
    return;
  }

  const betPageMatch = pathname.match(/^\/bets\/(\d+)$/u);
  if (betPageMatch && method === 'GET') {
    const session = requireMemberSession(req, res, { nextPath: p(`/bets/${betPageMatch[1]}`) });
    if (!session) return;
    sendHtml(res, 200, renderBetDetailPage(session, betPageMatch[1]));
    return;
  }

  sendError(res, 404, 'not_found', 'Unknown route');
}

function startWebAppServer(opts = {}) {
  if (server) return;
  WEB_APP_PORT = Number(opts.port) || WEB_APP_PORT;
  WEB_APP_HOST = opts.host || WEB_APP_HOST;
  WEB_APP_DISCORD_OAUTH_REDIRECT_URI = opts.authRedirectUri || WEB_APP_DISCORD_OAUTH_REDIRECT_URI;
  initWebAppStore();
  installWsBridge();
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      logger.error(`Web app request failed: ${error.message}`);
      sendError(res, 500, 'internal_error', 'Internal server error');
    });
  });
  server.on('upgrade', (req, socket) => {
    try {
      handleWsUpgrade(req, socket);
    } catch {
      try { socket.destroy(); } catch { /* ignore */ }
    }
  });
  server.listen(WEB_APP_PORT, WEB_APP_HOST, () => {
    logger.info(`Lumi Web app running at http://${WEB_APP_HOST}:${WEB_APP_PORT}${WEB_APP_BASE_PATH || '/'}`);
  });
  server.on('error', (error) => {
    logger.error(`Lumi Web app server error: ${error.message}`);
  });
}

function stopWebAppServer() {
  if (!server) return;
  try { server.close(); } catch { /* ignore */ }
  server = null;
}

module.exports = {
  startWebAppServer,
  stopWebAppServer,
};
