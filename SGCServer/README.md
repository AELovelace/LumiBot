# SGCServer

Standalone SadGirlCoin API service. Split out of LumiBot so the banking
backend can run, scale, and deploy independently of the Discord bot.

## What it hosts

| Listener | Default | Purpose |
|----------|---------|---------|
| Public API | `127.0.0.1:7788` | `/v1/*` third-party app routes (charge / credit / transfer / mint / links), typically exposed via nginx. |
| OAuth | shared with public | `/oauth/token`, `/oauth/authorize`, `/oauth/revoke`. |
| Internal | `127.0.0.1:7789` | `/internal/*` privileged routes for LumiBot. **Bind to localhost only.** |

## Setup

1. `cp SGCServer/.env.example SGCServer/.env`
2. Generate a strong internal token:
   ```powershell
   node -e "console.log('sgc_internal_' + require('crypto').randomBytes(32).toString('hex'))"
   ```
   Put it in `SGCServer/.env` as `SGC_INTERNAL_TOKEN=...` AND in the LumiBot
   root `.env` so both processes agree.
3. From the repo root: `cd SGCServer && npm install && npm start`
4. In LumiBot's `.env`, set:
   ```
   SGC_SERVER_INTERNAL_URL=http://127.0.0.1:7789
   SGC_INTERNAL_TOKEN=<same value as SGCServer/.env>
   SGC_API_INPROC_ENABLED=false        # default; LumiBot stops hosting /v1
   SGC_WEBHOOK_DISPATCHER_INPROC=false # default; SGCServer owns the dispatcher
   ```

## Architecture notes

* SGCServer and LumiBot **share the same SQLite file** (`data/sadgirlcoin.sqlite3`).
  WAL mode is enabled automatically so concurrent read/write across processes
  is safe. There is no replication.
* `SGCServer/src/economyStore.js` is a 3-line shim that re-exports
  `LumiBot/src/sadgirlEconomyStore.js` so schema migrations stay
  single-source.
* The webhook dispatcher must run in **exactly one** process — by default
  SGCServer owns it. If you ever go back to in-process mode, set
  `SGC_WEBHOOK_DISPATCHER_INPROC=true` in LumiBot's `.env` and shut down
  SGCServer.
* OAuth access tokens (`sgc_at_*`) and legacy API keys (`sgc_live_*`) are
  both accepted on `/v1/*`. New integrations should use the OAuth
  client_credentials flow.
* User-facing apps can bootstrap browser linking by calling
  `POST /v1/links/oauth/start`, which returns an `/oauth/authorize` URL to
  hand to the player. The older `/v1/links/codes/redeem` flow remains
  available as a compatibility fallback.
* The synthetic "internal" app authenticated by `SGC_INTERNAL_TOKEN`
  bypasses all rate limiting and has every scope. Treat the token as
  highly sensitive.

## Logging

All log lines are prefixed `[SGC]`. Set `LOG_LEVEL=debug` in
`SGCServer/.env` to see per-request and per-coin-op debug output during
the burn-in period.

## Smoke tests

```powershell
# Liveness
curl http://127.0.0.1:7788/v1/healthz
curl http://127.0.0.1:7789/internal/healthz

# Internal route (requires SGC_INTERNAL_TOKEN)
curl -H "Authorization: Bearer $env:SGC_INTERNAL_TOKEN" http://127.0.0.1:7789/internal/constants
```
 
