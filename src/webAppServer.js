'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const { logger } = require('./logger');
const {
  ensureAccount,
  getBalance,
  getCentralBankBalance,
  getDollStreetBalance,
  getMomijiCasinoBalance,
  getTopHolders,
  getUserTransactions,
  transferCoins,
  buyYearlyRaffleTicket,
  getTransferFeeRate,
  isLottoDay,
  searchAccounts,
} = require('./sadgirlEconomyStore');
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

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'interest-cohort=(), browsing-topics=()',
  'cache-control': 'no-store',
};

let server = null;

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
  const loginHref = `${p('/auth/discord/login')}?mode=member&next=${encodeURIComponent(nextPath)}`;
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
    <a class="btn" href="${loginHref}">Sign In With Discord</a>
    <div class="meta">Member login uses the same Discord OAuth session system as the control panel.</div>
  </main>
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
    width: min(1180px, calc(100vw - 24px));
    margin: 0 auto;
    padding: 16px 0 40px;
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
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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
    leaderboard: getTopHolders(10),
  };
}

function renderDashboard(session) {
  ensureAccount(session.discordId, session.username);
  const wallet = buildWalletSummary(session.discordId);
  const transactions = getUserTransactions(session.discordId, 8);
  const receipts = getReceiptsForUser(session.discordId, 6);
  const notifications = getNotificationsForUser(session.discordId, 6);

  const leaderboardRows = wallet.leaderboard.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.username || row.user_id)}</td>
      <td>${Number(row.balance).toLocaleString()} SGC</td>
    </tr>
  `).join('');

  return renderPage('Lumi Web Dashboard', session, `
    <section class="grid">
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
      </div>
      <div class="grid">
        <div class="card">
          <h2>Recent Transactions</h2>
          ${renderTransactionsTable(transactions, session.discordId)}
        </div>
        <div class="card">
          <h2>Recent Receipts</h2>
          ${renderReceipts(receipts)}
        </div>
      </div>
      <div class="grid">
        <div class="card">
          <h2>Notifications</h2>
          ${renderNotifications(notifications)}
        </div>
        <div class="card">
          <h2>Top Holders</h2>
          <table>
            <thead><tr><th>#</th><th>User</th><th>Balance</th></tr></thead>
            <tbody>${leaderboardRows}</tbody>
          </table>
        </div>
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
    leaderboard: summary.leaderboard,
  };
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
    });
    return;
  }
  if (pathname === '/auth/logout' && method === 'POST') {
    const originCheck = validateSameOrigin(req);
    if (!originCheck.ok) {
      sendError(res, 403, 'forbidden', `Cross-site POST blocked: ${originCheck.reason}`);
      return;
    }
      handleLogoutRoute(req, res, { loginPath: `${p('/login')}` });
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

  sendError(res, 404, 'not_found', 'Unknown route');
}

function startWebAppServer(opts = {}) {
  if (server) return;
  WEB_APP_PORT = Number(opts.port) || WEB_APP_PORT;
  WEB_APP_HOST = opts.host || WEB_APP_HOST;
  WEB_APP_DISCORD_OAUTH_REDIRECT_URI = opts.authRedirectUri || WEB_APP_DISCORD_OAUTH_REDIRECT_URI;
  initWebAppStore();
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      logger.error(`Web app request failed: ${error.message}`);
      sendError(res, 500, 'internal_error', 'Internal server error');
    });
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
