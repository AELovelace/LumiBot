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
 *   GET /healthz                 → "ok"
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

// Per-IP rate limit (token bucket). Public-facing endpoint sees nginx-proxied
// traffic, so this is cheap insurance against trivial flooding.
const RATE_LIMIT_MAX = 120;          // requests
const RATE_LIMIT_WINDOW_MS = 60_000; // per minute
const rateBuckets = new Map();        // ip → { count, windowStart }

function rateLimitCheck(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return { ok: true, retryAfter: 0 };
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart)) / 1000));
    return { ok: false, retryAfter };
  }
  return { ok: true, retryAfter: 0 };
}

// Periodic GC for the rate-limit map so it can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS * 2) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'interest-cohort=(), browsing-topics=()',
  // Tight CSP — page only uses an inline <style> block, no scripts, no images.
  // Note: omitting frame-ancestors allows framing from any origin (default behavior).
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
};

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

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
        <h3>&gt;&gt; ${escapeHtml(tier.label)}</h3>
        <p class="muted">// no supporters at this tier yet</p>
      </section>`;
    }
    const rows = tier.members.map((m) => `
      <li>
        <span class="patron-name">&gt; ${escapeHtml(m.username)}</span>
        <span class="patron-meta">[${formatNumber(m.monthsPaid)} mo]</span>
      </li>`).join('');
    return `
      <section class="tier">
        <h3>&gt;&gt; ${escapeHtml(tier.label)} <span class="muted">(${tier.members.length})</span></h3>
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
  <title>SADGIRLCOIN.WTF // LIVE LEADERBOARD</title>
  <style>
    :root {
      color-scheme: dark;
      --bg:        #0a0306;
      --bg-soft:   #14080d;
      --panel:     #15080e;
      --panel-2:   #1d0a13;
      --border:    #ff1744;
      --border-dim:#5a0a1a;
      --text:      #ffd6e2;
      --text-bold: #ffffff;
      --muted:     #b07487;
      --red:       #ff1744;
      --red-dim:   #b3001b;
      --pink:      #ff4dd2;
      --pink-hot:  #ff7ad9;
      --pink-soft: #ffaee0;
      --gold:      #ffb86b;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 'Courier New', 'Consolas', 'Lucida Console', monospace;
      font-size: 14px;
      line-height: 1.45;
    }
    body {
      background:
        repeating-linear-gradient(
          0deg,
          rgba(255, 23, 68, 0.04) 0px,
          rgba(255, 23, 68, 0.04) 1px,
          transparent 1px,
          transparent 3px
        ),
        radial-gradient(ellipse at top, #1a0309 0%, #050103 70%) fixed;
    }
    a { color: var(--pink-hot); text-decoration: none; border-bottom: 1px dashed var(--pink-hot); }
    a:hover { color: var(--text-bold); background: var(--red-dim); }

    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 18px 14px 60px;
    }

    /* ----- Title bar ----- */
    .titlebar {
      border: 2px solid var(--red);
      background: linear-gradient(180deg, var(--red) 0%, var(--red-dim) 100%);
      color: var(--text-bold);
      padding: 6px 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 4px 4px 0 #000;
    }
    .titlebar .blink { animation: blink 1.1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }

    .marquee-bar {
      border: 2px solid var(--red);
      border-top: none;
      background: #000;
      color: var(--pink-hot);
      padding: 4px 10px;
      font-size: 12px;
      letter-spacing: 1px;
      text-transform: uppercase;
      box-shadow: 4px 4px 0 #000;
      margin-bottom: 22px;
    }

    /* ----- Section panels ----- */
    .panel {
      background: var(--panel);
      border: 2px solid var(--red);
      box-shadow: 5px 5px 0 #000, 0 0 18px rgba(255, 23, 68, 0.15) inset;
      margin: 0 0 22px;
    }
    .panel-head {
      background: var(--red);
      color: #fff;
      padding: 4px 10px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      border-bottom: 2px solid #000;
    }
    .panel-body { padding: 14px 14px 18px; }

    h1, h2, h3 {
      margin: 0;
      font-family: 'Impact', 'Arial Black', 'Courier New', monospace;
      letter-spacing: 1px;
    }
    h1 { font-size: 22px; }
    h2 { font-size: 16px; color: var(--pink-hot); margin-bottom: 10px; }
    h3 { font-size: 13px; color: var(--pink); margin-bottom: 8px; text-transform: uppercase; }

    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }
    .stat {
      flex: 1 1 160px;
      background: #000;
      border: 1px solid var(--red);
      padding: 6px 10px;
    }
    .stat .label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat .value {
      color: var(--pink-hot);
      font-size: 20px;
      font-weight: 700;
      margin-top: 2px;
      font-family: 'Impact', 'Arial Black', monospace;
      text-shadow: 0 0 6px rgba(255, 77, 210, 0.5);
    }

    .grid-tiers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .tier {
      background: var(--panel-2);
      border: 1px dashed var(--red);
      padding: 10px 12px;
    }
    .patron-list { list-style: none; padding: 0; margin: 0; }
    .patron-list li {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 3px 0;
      border-bottom: 1px dotted var(--border-dim);
      font-size: 13px;
    }
    .patron-list li:last-child { border-bottom: none; }
    .patron-name { color: var(--text-bold); }
    .patron-meta { color: var(--pink-soft); font-size: 11px; }
    .muted { color: var(--muted); font-style: italic; }

    /* ----- Leaderboard table ----- */
    table {
      width: 100%;
      border-collapse: collapse;
      background: #000;
      border: 1px solid var(--red);
    }
    thead th {
      background: var(--red-dim);
      color: #fff;
      text-align: left;
      padding: 4px 10px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-bottom: 2px solid var(--red);
    }
    tbody td {
      padding: 5px 10px;
      border-bottom: 1px solid #2a0510;
      font-size: 13px;
    }
    tbody tr:nth-child(odd) td { background: #100308; }
    tbody tr:hover td { background: var(--red-dim); color: #fff; }
    td.rank {
      width: 60px;
      font-weight: 700;
      color: var(--pink-hot);
      font-family: 'Impact', 'Arial Black', monospace;
    }
    tbody tr:nth-child(1) td.rank { color: var(--gold); text-shadow: 0 0 6px var(--gold); }
    tbody tr:nth-child(2) td.rank { color: #e0e0e0; }
    tbody tr:nth-child(3) td.rank { color: #ff8a3d; }
    td.name { color: var(--text-bold); }
    td.balance { color: var(--pink-hot); font-weight: 700; text-align: right; white-space: nowrap; }
    td.earned { color: var(--muted); text-align: right; white-space: nowrap; }

    /* ----- ASCII rule ----- */
    .ascii-rule {
      color: var(--red);
      font-family: 'Courier New', monospace;
      letter-spacing: -1px;
      overflow: hidden;
      white-space: nowrap;
      margin: 6px 0 14px;
      text-align: center;
    }

    footer {
      margin-top: 24px;
      text-align: center;
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 1px;
    }
    footer .copyleft { color: var(--pink-hot); }

    @media (max-width: 600px) {
      h1 { font-size: 16px; }
      .titlebar { font-size: 12px; }
      td.earned { display: none; }
      thead th:last-child { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <div class="titlebar">
      <span>&#9632; SADGIRLCOIN.WTF // LIVE LEADERBOARD</span>
      <span class="blink">&#9608;</span>
    </div>
    <div class="marquee-bar">
      [SYS] last sync :: ${escapeHtml(generatedHuman)} // page auto-reloads every 60s
    </div>

    <section class="panel">
      <div class="panel-head">&gt; PATRONS / SUPPORTER ROLES</div>
      <div class="panel-body">
        <div class="stats">
          <div class="stat"><div class="label">// active</div><div class="value">${formatNumber(stats.activePatrons)}</div></div>
          <div class="stat"><div class="label">// all-time</div><div class="value">${formatNumber(stats.totalPatrons)}</div></div>
          <div class="stat"><div class="label">// total stipends</div><div class="value">${formatNumber(stats.totalPaid)} SGC</div></div>
        </div>
        <div class="ascii-rule">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>
        <div class="grid-tiers">${tierBlocks}</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">&gt; TOP ${TOP_N} HOLDERS // LIVE</div>
      <div class="panel-body">
        ${snapshot.topHolders.length === 0
          ? '<p class="muted">// no accounts yet</p>'
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
      </div>
    </section>

    <footer>
      <span class="copyleft">[++]</span> generated by sad girl player ::
      <a href="https://sadgirlsclub.wtf">sadgirlsclub.wtf</a>
      <span class="copyleft">[++]</span>
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
  applySecurityHeaders(res);

  const url = (req.url || '/').split('?')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', 'allow': 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  // Health check is exempt from rate limiting (proxy/uptime probes).
  if (url !== '/healthz') {
    const ip = clientIp(req);
    const rl = rateLimitCheck(ip);
    if (!rl.ok) {
      res.writeHead(429, {
        'content-type': 'text/plain; charset=utf-8',
        'retry-after': String(rl.retryAfter),
      });
      res.end('Too Many Requests');
      return;
    }
  }

  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
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
