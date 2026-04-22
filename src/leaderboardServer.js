'use strict';

/**
 * Public leaderboard HTTP module.
 *
 * Serves a self-refreshing HTML page on a separate port (default 7070) that
 * shows:
 *   - Patreon supporters grouped by tier (with totals).
 *   - The top 50 SadGirlCoin holders, live.
 *
 * The rendered HTML is also written to disk every refresh tick so an external
 * static-file consumer (e.g. a CDN) can pick it up. The intended deployment is
 * an nginx reverse proxy that forwards a public hostname to this port.
 *
 * Endpoints:
 *   GET /              → cached HTML page (auto-reloads via meta refresh)
 *   GET /index.html    → same as /
 *   GET /leaderboard.html → same as /
 *   GET /api/leaderboard.json → JSON snapshot { generatedAt, topHolders, patrons }
 *   GET /healthz       → "ok"
 *
 * No login, no write paths — strictly public read-only.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { logger } = require('./logger');
const { getTopHolders } = require('./sadgirlEconomyStore');
const { getAllPatrons, getPatreonStats, TIERS } = require('./patreonRewards');

const REFRESH_MS = 60 * 1000;
const TOP_N = 50;

let server = null;
let refreshTimer = null;
let cachedHtml = '<!doctype html><html><body><p>Leaderboard warming up...</p></body></html>';
let cachedJson = '{"generatedAt":null,"topHolders":[],"patrons":[]}';
let lastBuildAt = null;
let outputFile = null;
let host = '0.0.0.0';
let port = 7070;

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function formatTimestamp(iso) {
  if (!iso) return 'never';
  try {
    return new Date(iso).toUTCString();
  } catch {
    return String(iso);
  }
}

function trophyFor(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

// ---------------------------------------------------------------------------
// Snapshot building
// ---------------------------------------------------------------------------

function buildSnapshot() {
  const topRaw = getTopHolders(TOP_N) || [];
  const topHolders = topRaw.map((row, i) => ({
    rank: i + 1,
    userId: row.user_id,
    username: row.username || `User ${row.user_id?.slice(-4) ?? '????'}`,
    balance: Number(row.balance || 0),
    totalEarned: Number(row.total_earned || 0),
  }));

  const patronsRaw = getAllPatrons() || [];
  const stats = getPatreonStats();
  const patrons = patronsRaw
    .filter((p) => p.tier_role_id) // only currently-active patrons
    .map((p) => ({
      userId: p.user_id,
      username: p.username || `User ${p.user_id?.slice(-4) ?? '????'}`,
      tierRoleId: p.tier_role_id,
      tierAmount: Number(p.tier_amount || 0),
      monthsPaid: Number(p.total_months_paid || 0),
      lastPayoutPeriod: p.last_payout_period || null,
      firstSeenAt: p.first_seen_at || null,
    }));

  // Group patrons by tier for the rendered HTML — keep tier ordering (highest first).
  const patronsByTier = TIERS.map((t) => ({
    roleId: t.roleId,
    label: t.label,
    amount: t.amount,
    members: patrons.filter((p) => p.tierRoleId === t.roleId),
  }));

  return {
    generatedAt: new Date().toISOString(),
    topHolders,
    patrons,
    patronsByTier,
    patreonStats: stats,
  };
}

function renderHtml(snapshot) {
  const generatedHuman = formatTimestamp(snapshot.generatedAt);
  const tierBlocks = snapshot.patronsByTier.map((tier) => {
    if (!tier.members.length) {
      return `
        <section class="tier">
          <h3>${escapeHtml(tier.label)}</h3>
          <p class="muted">No active supporters at this tier yet.</p>
        </section>`;
    }
    const rows = tier.members.map((m) => `
      <li>
        <span class="patron-name">${escapeHtml(m.username)}</span>
        <span class="patron-meta">${formatNumber(m.monthsPaid)} months paid</span>
      </li>`).join('');
    return `
      <section class="tier">
        <h3>${escapeHtml(tier.label)} <span class="muted">(${tier.members.length})</span></h3>
        <ul class="patron-list">${rows}</ul>
      </section>`;
  }).join('');

  const topRows = snapshot.topHolders.map((h) => `
    <tr>
      <td class="rank">${trophyFor(h.rank)}</td>
      <td class="name">${escapeHtml(h.username)}</td>
      <td class="balance">${formatNumber(h.balance)} SGC</td>
      <td class="earned">${formatNumber(h.totalEarned)}</td>
    </tr>`).join('');

  const stats = snapshot.patreonStats || { activePatrons: 0, totalPatrons: 0, totalPaid: 0 };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="60">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SadGirlCoin — Live Leaderboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0e0b16;
      --bg-soft: #181126;
      --panel: #1f1532;
      --border: #2d2046;
      --text: #f3eaff;
      --muted: #b3a0d8;
      --accent: #e879f9;
      --accent-2: #f0abfc;
      --gold: #facc15;
      --silver: #cbd5e1;
      --bronze: #d97706;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: radial-gradient(circle at top, #1a0f2e, #0e0b16 60%) fixed;
      color: var(--text);
    }
    main { max-width: 1100px; margin: 0 auto; padding: 28px 20px 64px; }
    header { text-align: center; margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: 2.4em; color: var(--accent-2); letter-spacing: 0.5px; }
    h2 { margin: 0 0 16px; font-size: 1.4em; color: var(--accent); }
    h3 { margin: 0 0 10px; font-size: 1.05em; color: var(--accent-2); }
    .meta { color: var(--muted); font-size: 0.9em; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 22px;
      margin-bottom: 24px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.3);
    }
    .grid-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .tier {
      background: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
    }
    .patron-list { list-style: none; padding: 0; margin: 0; }
    .patron-list li {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 4px 0;
      border-bottom: 1px dashed rgba(255,255,255,0.06);
      font-size: 0.95em;
    }
    .patron-list li:last-child { border-bottom: none; }
    .patron-meta { color: var(--muted); font-size: 0.8em; }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      text-align: left; padding: 10px 12px;
      color: var(--muted); font-weight: 600; font-size: 0.85em;
      text-transform: uppercase; letter-spacing: 0.4px;
      border-bottom: 1px solid var(--border);
    }
    tbody td { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    tbody tr:hover { background: rgba(232,121,249,0.06); }
    td.rank { width: 64px; font-weight: 700; color: var(--gold); }
    tbody tr:nth-child(2) td.rank { color: var(--silver); }
    tbody tr:nth-child(3) td.rank { color: var(--bronze); }
    td.balance { font-weight: 700; color: var(--accent-2); }
    td.earned { color: var(--muted); }
    .muted { color: var(--muted); }
    .stats {
      display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;
    }
    .stat {
      flex: 1 1 160px;
      background: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .stat .label { color: var(--muted); font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat .value { font-size: 1.4em; font-weight: 700; margin-top: 4px; color: var(--accent-2); }
    footer { text-align: center; color: var(--muted); margin-top: 28px; font-size: 0.85em; }
    a { color: var(--accent-2); }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>💜 SadGirlCoin — Live Leaderboard</h1>
      <p class="meta">Last updated <strong>${escapeHtml(generatedHuman)}</strong> · auto-refreshes every minute</p>
    </header>

    <section class="panel">
      <h2>🌟 Patreon Supporters</h2>
      <div class="stats">
        <div class="stat"><div class="label">Active supporters</div><div class="value">${formatNumber(stats.activePatrons)}</div></div>
        <div class="stat"><div class="label">All-time supporters</div><div class="value">${formatNumber(stats.totalPatrons)}</div></div>
        <div class="stat"><div class="label">Total stipends paid</div><div class="value">${formatNumber(stats.totalPaid)} SGC</div></div>
      </div>
      <div class="grid-tiers">${tierBlocks}</div>
    </section>

    <section class="panel">
      <h2>💰 Top ${TOP_N} Holders</h2>
      ${snapshot.topHolders.length === 0
        ? '<p class="muted">No accounts yet.</p>'
        : `<table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Holder</th>
                <th>Balance</th>
                <th>Total earned</th>
              </tr>
            </thead>
            <tbody>${topRows}</tbody>
          </table>`}
    </section>

    <footer>
      Generated by Sad Girl Player · <a href="/api/leaderboard.json">JSON snapshot</a>
    </footer>
  </main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Refresh tick
// ---------------------------------------------------------------------------

function rebuild() {
  try {
    const snapshot = buildSnapshot();
    cachedHtml = renderHtml(snapshot);
    cachedJson = JSON.stringify(snapshot);
    lastBuildAt = snapshot.generatedAt;

    if (outputFile) {
      try {
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, cachedHtml, 'utf8');
      } catch (err) {
        logger.warn('Leaderboard server: failed to write HTML file.', err.message);
      }
    }
  } catch (err) {
    logger.error('Leaderboard server: rebuild failed.', err.message);
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(rebuild, REFRESH_MS);
  refreshTimer.unref?.();
}

// ---------------------------------------------------------------------------
// HTTP routing
// ---------------------------------------------------------------------------

function handleRequest(req, res) {
  const url = (req.url || '/').split('?')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', 'allow': 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (url === '/api/leaderboard.json') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30',
    });
    res.end(req.method === 'HEAD' ? '' : cachedJson);
    return;
  }

  if (url === '/' || url === '/index.html' || url === '/leaderboard.html') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=30',
    });
    res.end(req.method === 'HEAD' ? '' : cachedHtml);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startLeaderboardServer(opts = {}) {
  if (server) return;
  port = Number(opts.port) || port;
  host = opts.host || host;
  outputFile = opts.outputFile
    ? path.resolve(opts.outputFile)
    : path.resolve(__dirname, '..', 'data', 'leaderboard.html');

  // Build once synchronously so the first request never sees the placeholder.
  rebuild();
  scheduleRefresh();

  server = http.createServer(handleRequest);
  server.on('error', (err) => {
    logger.error(`Leaderboard server: socket error on ${host}:${port}: ${err.message}`);
  });
  server.listen(port, host, () => {
    logger.info(`Leaderboard server: listening on http://${host}:${port} (HTML mirror → ${outputFile})`);
  });
}

function stopLeaderboardServer() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
}

function getLeaderboardServerStatus() {
  return {
    running: Boolean(server),
    host,
    port,
    lastBuildAt,
    outputFile,
  };
}

module.exports = {
  startLeaderboardServer,
  stopLeaderboardServer,
  getLeaderboardServerStatus,
  // Exposed for tests:
  _internal: { buildSnapshot, renderHtml, rebuild, handleRequest },
};
