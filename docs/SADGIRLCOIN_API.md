sudo # SadGirlCoin External API — Integration Guide

> Audience: an AI assistant (or developer) building a third-party integration — a Minecraft plugin, a sister Discord bot, a web app, etc. — that needs to read or move SadGirlCoin (SGC) on behalf of users.

---

## 1. What this API is

SadGirlCoin (SGC) is the soft-currency economy of the LumiBot Discord server. Users earn SGC by chatting, voice activity, casino games, and prediction markets, and spend it on in-server features.

The **External API** lets a registered third-party application:

- Read the SGC balance of a Discord user **who has explicitly linked their account to your app**.
- Charge (debit) coins from that user.
- Pay (credit) coins to that user from your app's treasury.
- Transfer coins between two users who are both linked through your app.
- Read the recent transaction history for a linked user.
- Optionally mint new SGC (privileged apps only).

**Hard rules**:

- You can only operate on Discord users who have explicitly linked your app via a one-time code (see §4).
- Once linked, users grant **blanket spending consent** until they revoke. Stay within reasonable per-action amounts and respect rate limits; the bot's bank owner can disable misbehaving apps in one click.
- Standard SGC economy rules apply: every transfer pays a small fee to the Central Bank (1% normal, 50% on "lotto day"). You cannot bypass these.
- All API operations are recorded in the immutable `transactions` audit log with a `type` prefix of `api:` and a note containing your `app_id`.

---

## 2. Onboarding (one-time, by the human operator)

Before your AI integration can do anything, the **bank owner** must register your app in the LumiBot Web Control Panel:

1. Bank owner logs into the panel (Discord OAuth).
2. **API Apps → + Register new app**.
3. Fills in name, description, optional webhook URL, requested scopes (see §6), and a sensible rate limit.
4. The panel issues a plaintext key shown **exactly once**, in the form `sgc_live_<48 hex chars>`.

The operator gives you (the AI / integration) two values:

| Value | Example | Notes |
|---|---|---|
| Base URL | `https://sadgirlsclub.wtf/v1` or `http://host:7788/v1` | Always ends in `/v1`. |
| API key | `sgc_live_4f3e…` | Treat as a password. Never log or echo. |

You will also be told the `app_id` (e.g. `app_d56e35b…`) — useful for diagnostics, but you don't need it in any request.

---

## 3. Authentication

Every request **except `GET /v1/healthz`** requires:

```
Authorization: Bearer sgc_live_<your_key>
```

Failure modes:

| Status | Meaning |
|---|---|
| 401 `unauthorized` | Header missing, malformed, key revoked, or app disabled. |
| 403 `forbidden` | Key valid, but missing the scope required for this route, or attempted `/v1/mint` without `can_mint`. |
| 429 `rate_limited` | App exceeded its per-minute budget. Honor the `Retry-After-S` field and the `X-RateLimit-Remaining` header. |

Always send `Content-Type: application/json` for `POST`/`DELETE`. Bodies are small JSON objects (≤8 KiB).

---

## 4. The user-link flow (mandatory for any user-facing op)

You can never address a Discord user directly by their Discord ID. You address them by an **`external_id`** that **you** define and that the user has bound to their Discord account through a one-time code.

Examples of good `external_id` choices:

- Minecraft plugin: the player's Mojang UUID.
- Sister Discord bot: that bot's own user-id namespace.
- Web app: your own internal user-id.

`external_id` is opaque to the API; pick something stable and unique within your app. **Do not put PII in it.**

### Preferred flow: browser OAuth link

Your app can ask the API to generate a browser-ready authorize URL for a specific player identity:

1. Your app creates an OAuth client in the control panel with the `authorization_code` grant enabled.
2. Your app generates PKCE values (`state`, `code_challenge`, `code_verifier`) and calls `POST /v1/links/oauth/start`.
3. The API returns an `authorize_url`.
4. Your app gives that URL to the player to open in a browser.
5. The player signs into Discord in the SadGirlsClub panel and approves the link.
6. Your app exchanges the returned authorization `code` at `/oauth/token` and the Discord account is linked to your `external_id`.

This is the best UX for web apps, launchers, game chat prompts, and anywhere you can hand a player a clickable or copy-pasteable URL.

### Compatibility fallback: Discord code redeem

```
┌──────────┐   /lumi-link app:<app>     ┌─────────┐  one-time code
│ Discord  │ ─────────────────────────▶ │ LumiBot │ ────────────────┐
│  user    │                            └─────────┘                 │
└──────────┘                                                         ▼
     │  pastes/types code into your app                  ┌──────────────────┐
     ▼                                                   │  Your app / AI   │
┌──────────┐  POST /v1/links/codes/redeem               │                  │
│ Your app │ ◀──────────────────────────────────────────┤  external_id =   │
│          │  { code, external_id, external_name? }    │  e.g. MC UUID    │
└──────────┘  → 200 { link: {...} }                     └──────────────────┘
```

1. The user runs `/lumi-link app:<your-app-name>` in Discord. LumiBot DMs them an ephemeral code like `H7K-4QZ` (default 10 min TTL).
2. Your app collects that code from the user (in-game chat, web form, bot DM — whatever).
3. Your app `POST`s it to `/v1/links/codes/redeem` with the user's `external_id` and an optional human-readable `external_name`.
4. From then on every subsequent call uses that `external_id`.

A user can revoke at any time via `/lumi-link revoke app:<...>` in Discord, or by your app calling `DELETE /v1/links/{external_id}`.

---

## 5. Endpoint reference

Base path: `/v1`. All bodies are JSON. All responses are JSON.

### 5.1 Health & identity

#### `GET /v1/healthz` *(no auth)*

```json
200 OK
{ "ok": true, "ts": "2026-04-24T18:00:00.000Z" }
```

#### `GET /v1/me`

```json
200 OK
{
  "app": {
    "id": "app_d56e…",
    "name": "Smoke MC Plugin",
    "scopes": ["balance:read", "coins:debit", "coins:credit", "links:redeem", "links:revoke"],
    "rate_limit_per_min": 60,
    "can_mint": false,
    "treasury_balance": 200
  }
}
```

Use this on startup to confirm the key works and to discover which scopes you have.

---

### 5.2 Links

#### `POST /v1/links/oauth/start`  *(scope `links:redeem`)*

Returns a browser URL your app can give to the player, plus compatibility info for the legacy code-redeem flow.

```json
Request:
{
  "client_id": "sgc_client_abc123",
  "redirect_uri": "https://example.com/oauth/callback",
  "scope": "balance:read coins:debit",
  "state": "4c2b88f4...",
  "code_challenge": "N2Y0d1...",
  "code_challenge_method": "S256",
  "external_id": "11111111-2222-3333-4444-555555555555",
  "external_name": "Steve"
}

200 OK
{
  "oauth": {
    "authorize_url": "https://sadgirlsclub.wtf/oauth/authorize?response_type=code&client_id=...",
    "client_id": "sgc_client_abc123",
    "redirect_uri": "https://example.com/oauth/callback",
    "scope": "balance:read coins:debit",
    "external_id": "11111111-2222-3333-4444-555555555555",
    "external_name": "Steve",
    "code_challenge_method": "S256"
  },
  "fallback": {
    "method": "link_code",
    "supported": true,
    "redeem_endpoint": "/v1/links/codes/redeem",
    "instructions": "If browser OAuth is unavailable, ask the player to run /lumi-link in Discord and redeem the one-time code through the legacy endpoint."
  }
}
```

Notes:

- `client_id` must belong to the authenticated app.
- The OAuth client must allow the `authorization_code` grant.
- `redirect_uri` must exactly match a registered redirect URI.
- `state` and PKCE (`code_challenge`, `code_challenge_method=S256`) are required.
- `external_id` is the identity that will be linked once the browser flow completes.

#### `POST /v1/links/codes/redeem`  *(scope `links:redeem`)*

```json
Request:
{
  "code": "H7K-4QZ",
  "external_id": "11111111-2222-3333-4444-555555555555",
  "external_name": "Steve"
}

200 OK
{
  "link": {
    "id": 17,
    "external_id": "11111111-2222-3333-4444-555555555555",
    "external_name": "Steve",
    "created_at": "2026-04-24 18:00:00"
  }
}
```

Errors:

| Status | `error.code` | Meaning |
|---|---|---|
| 404 | `invalid_code` | Code doesn't exist for this app. |
| 409 | `code_already_used` | Already redeemed. |
| 410 | `code_expired` | Past TTL. Ask the user to run `/lumi-link app` again. |
| 409 | `external_id_already_linked` | Another Discord user is bound to this `external_id` under your app. |
| 409 | `discord_already_linked_to_different_external_id` | The Discord user already linked a different `external_id` here; ask them to unlink first. |

#### `GET /v1/links/by-external/{external_id}`  *(scope `links:read`)*

```json
200 OK
{ "link": { "id": 17, "external_id": "...", "external_name": "Steve", "created_at": "..." } }
```

`404 not_found` if no active link exists.

#### `DELETE /v1/links/{external_id}`  *(scope `links:revoke`)*

```json
200 OK
{ "revoked": true }
```

---

### 5.3 Balance & history

#### `GET /v1/users/{external_id}/balance`  *(scope `balance:read`)*

```json
200 OK
{ "external_id": "...", "balance": 989 }
```

`404 not_found` if the user is not linked through your app.

#### `GET /v1/users/{external_id}/transactions?limit=25`  *(scope `txn:read`)*

Returns up to `limit` (max 100, default 25) of the most recent SGC transactions involving this user **that originated from your app** (filtered by note prefix `api:<your_app_id>:`).

```json
200 OK
{
  "external_id": "...",
  "transactions": [
    {
      "id": 4291,
      "from_user_id": "111111111111111111",
      "to_user_id":   "__APP_app_d56e…__",
      "amount": 10,
      "fee":    1,
      "type":   "transfer",
      "note":   "api:app_d56e…:debit song change",
      "created_at": "2026-04-24 18:01:23"
    }
  ]
}
```

---

### 5.4 Coin operations

All four are POST, all return `200 OK { ok: true, ... }` on success, and **all support idempotency** via either an `Idempotency-Key` HTTP header or an `idempotency_key` body field. See §7.

#### `POST /v1/charge`  *(scope `coins:debit`)*

Move coins from the linked user → your app's treasury account.

```json
Request:
{
  "external_id": "11111111-…",
  "amount": 10,
  "note": "song change",
  "idempotency_key": "song-2026-04-24T18:01:23Z-abc123"  // optional
}

200 OK
{
  "ok": true,
  "amount": 10,
  "fee": 1,
  "from": { "external_id": "...", "discord_id": "111…" },
  "to":   { "app_id": "app_d56e…", "treasury_user_id": "__APP_app_d56e…__" },
  "balance": 989
}
```

`amount` is a **positive integer** ≥ 1. The user pays `amount + fee` (fee ≥ 1, ~1% of `amount`, 50% on "lotto day"). The fee is sent to the Central Bank, not your treasury.

Errors:

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Missing/invalid fields. |
| 402 | `Insufficient balance…` | User can't afford `amount + fee`. |
| 404 | `user_not_linked` | No active link for this `external_id`. |

#### `POST /v1/credit`  *(scope `coins:credit`)*

Move coins from your app's treasury → the linked user. Standard fee applies and is paid by your treasury.

```json
Request:
{ "external_id": "...", "amount": 5, "note": "song-skip refund" }

200 OK
{ "ok": true, "amount": 5, "fee": 1, "from": {...}, "to": {...}, "balance": 994 }
```

> 💡 Your app's treasury account starts at **0 SGC**. To pay users you must first fund the treasury — the bank owner does this from Discord with a regular `/lumi-bank send` to your treasury user-id (shown on the panel's app detail page).

`402` if your treasury can't cover `amount + fee`.

#### `POST /v1/transfer`  *(scope `coins:p2p`)*

Move coins between two users **both linked through your app**.

```json
Request:
{
  "from_external_id": "uuid-A",
  "to_external_id":   "uuid-B",
  "amount": 20,
  "note":   "in-game trade #4521"
}

200 OK
{ "ok": true, "amount": 20, "fee": 1, "from": {...}, "to": {...} }
```

#### `POST /v1/mint`  *(scope `coins:mint` AND `app.can_mint = true`)*

Privileged issuance from the Central Bank reserve to a linked user. This credits the user and debits `__CENTRAL_BANK__` by the same amount. **Highly privileged**; logged with type `api:mint`.

```json
Request:
{ "external_id": "...", "amount": 100, "note": "weekly grant" }

200 OK
{ "ok": true, "amount": 100, "minted": true, "to": {...} }
```

Notes:

- `coins:mint` scope alone is not enough; the app must also have `can_mint = true`.
- Minting does **not** use your app treasury and does **not** charge a transfer fee.
- Current implementation is reserve-backed: the Central Bank balance decreases by `amount`.

Errors:

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Missing/invalid fields. |
| 403 | `forbidden` / `mint_not_authorized` | App is not allowed to mint. |
| 404 | `user_not_linked` | No active link for this `external_id`. |

#### `POST /v1/bridge/company/payout`  *(bridge token; no app scope)*

Pay a **real guild company** (Big Business) selected by stock identifier. This does **not** debit a linked user.

Use this when a Minecraft mod or other game integration should fund a company's account directly by stock ticker or stock id, for example to reward a guild business after an in-game event. The route supports two server-configured modes:

- `treasury` — pay from `SGC_BRIDGE_TREASURY_USER_ID` using normal transfer rules and fees
- `mint` — issue funds from the Central Bank reserve directly to the company account with `fee = 0`

```json
Request:
{
  "stock": "DOGP",
  "amount": 25,
  "note": "minecraft quest reward",
  "idempotency_key": "quest:player123:dogp:reward42"
}

200 OK
{
  "ok": true,
  "mode": "treasury",
  "stock": {
    "id": 7,
    "ticker": "DOGP",
    "business_name": "Dogpunk Records Inc",
    "guild_id": "1170208430460514354"
  },
  "company_account": {
    "user_id": "__BIG_BUSINESS_1170208430460514354__",
    "balance": 1325
  },
  "source_account": {
    "user_id": "__APP_minecraft_bridge__",
    "balance": 8474
  },
  "amount": 25,
  "fee": 1,
  "minted": false
}
```

Notes:

- Authenticate this route with `Authorization: Bearer <SGC_BRIDGE_TOKEN>`.
- `stock` may be either a stock ticker such as `DOGP` or a numeric stock id.
- Only **real guild companies** are eligible. Synthetic stocks are rejected.
- `mode` is returned in the response as either `treasury` or `mint`.
- In `treasury` mode, funds come from `SGC_BRIDGE_TREASURY_USER_ID`, not from a linked player.
- In `treasury` mode, standard transfer fee rules still apply; the bridge treasury pays `amount + fee`.
- In `mint` mode, the company is credited directly from the Central Bank reserve and the response returns `"minted": true` and `"fee": 0`.
- Idempotency works the same way as the other coin-operation routes, but is keyed internally to the bridge endpoint rather than an API app id.

Errors:

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Missing/invalid `stock` or `amount`. |
| 400 | `amount_too_large` | Exceeds `SGC_BRIDGE_MAX_PAYOUT_AMOUNT`. |
| 400 | `not_a_real_company` | The stock refers to a synthetic listing, not a guild company. |
| 401 | `unauthorized` | Missing/invalid bridge bearer token. |
| 402 | `insufficient_funds` | In `treasury` mode, the bridge treasury cannot cover `amount + fee`. |
| 404 | `stock_not_found` | No stock matched the provided ticker/id. |
| 503 | `bridge_disabled` | `SGC_BRIDGE_TOKEN` is not configured on the server. |
| 503 | `bridge_not_funded` | In `treasury` mode, `SGC_BRIDGE_TREASURY_USER_ID` is not configured. |

Bridge configuration:

- `SGC_BRIDGE_TOKEN` — bearer token used by the mod or bridge client.
- `SGC_BRIDGE_MODE` — `treasury` or `mint`; defaults to `treasury`.
- `SGC_BRIDGE_TREASURY_USER_ID` — source account that funds company payouts in `treasury` mode.
- `SGC_BRIDGE_MAX_PAYOUT_AMOUNT` — optional per-request cap; defaults to `250000`.

---

## 6. Scopes

When the operator registers your app, they tick a subset of these. If you call a route without the scope, you get `403`.

| Scope | Grants |
|---|---|
| `links:redeem` | `POST /v1/links/codes/redeem` |
| `links:read` | `GET /v1/links/by-external/{id}` |
| `links:revoke` | `DELETE /v1/links/{id}` |
| `balance:read` | `GET /v1/users/{id}/balance` |
| `txn:read` | `GET /v1/users/{id}/transactions` |
| `coins:debit` | `POST /v1/charge` |
| `coins:credit` | `POST /v1/credit` |
| `coins:p2p` | `POST /v1/transfer` |
| `coins:mint` | `POST /v1/mint` (also requires `can_mint`) |

**Principle of least privilege**: ask for only what you need. A "charge per song" bot only needs `links:redeem`, `links:revoke`, `balance:read`, `coins:debit`.

---

## 7. Idempotency

Network retries are inevitable. To avoid double-charging, send an `Idempotency-Key` on every state-changing request:

```
POST /v1/charge
Idempotency-Key: song-2026-04-24T18:01:23.456Z-discordId-111
```

(or include `"idempotency_key": "..."` in the JSON body — they are equivalent).

- The server caches the **status + body** of the first call for that `(app_id, key)` for 24 hours.
- A retry with the same key returns the cached response and adds the response header `Idempotency-Replayed: true`. **No second debit happens.**
- 5xx responses are **not** cached — those are safe to retry without bumping the key.

**Rule of thumb for AI integrations**: derive the idempotency key from a stable property of the real-world event you're charging for. Bad: `Date.now()`. Good: `${eventType}:${userId}:${eventId}` (e.g. `song-skip:steve:9182374`).

---

## 8. Rate limiting

Each app has a per-minute budget set by the operator (default 60). Exceed it → `429 rate_limited` with:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests", "retry_after_s": 37 } }
```

Response headers on every call:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
```

Strategy:

- Treat `X-RateLimit-Remaining < 5` as "back off; batch if possible".
- On `429`, sleep for `retry_after_s` seconds before retrying.
- Don't multi-thread blindly — one in-flight request per user action is plenty for 99% of use cases.

---

## 9. Error envelope

All non-2xx responses follow:

```json
{
  "error": {
    "code": "snake_case_machine_readable",
    "message": "human-readable message",
    "...":     "(optional extra fields like retry_after_s)"
  }
}
```

Robust handling:

```python
import requests

resp = requests.post(f"{BASE}/v1/charge", json={...},
                     headers={"Authorization": f"Bearer {KEY}",
                              "Idempotency-Key": idem_key})

if resp.status_code == 200:
    data = resp.json()
elif resp.status_code == 402:
    # User doesn't have enough SGC. Tell them, don't retry.
    refuse_action(resp.json()["error"]["message"])
elif resp.status_code == 401:
    raise RuntimeError("API key revoked or app disabled — contact bank owner")
elif resp.status_code == 429:
    sleep(resp.json()["error"]["retry_after_s"])
    # retry with the SAME idempotency key
elif resp.status_code >= 500:
    # transient — retry with the SAME idempotency key, exponential backoff
    ...
else:
    log_and_alert(resp.text)
```

---

## 10. Webhooks (optional)

If the operator configured a webhook URL when registering your app, LumiBot will POST events to it as JSON, signed with `X-SGC-Signature: sha256=<hex hmac>` over the raw body using your app's `webhook_secret` (shown once when the webhook URL is first set).

Webhook policy:

- Webhook URLs must use `https://`.
- Webhook URLs must use an exact hostname listed in `SGC_WEBHOOK_ALLOWLIST`.
- Direct IP addresses and localhost-style hosts are rejected.

Events (v1):

- `link.revoked` — a user revoked your access. Stop charging them immediately.
- `transaction.completed` — fired after any successful API-mediated transfer involving your app.

Verify the signature constant-time before trusting payloads. Failed deliveries are retried up to 3 times with a 5-second timeout each, then dropped (LumiBot does not maintain a durable webhook queue in v1).

---

## 11. Worked examples

### Example A — Minecraft "1 SGC per /skip" plugin

Scopes: `links:redeem`, `links:revoke`, `balance:read`, `coins:debit`.

```python
def on_player_skip(uuid: str, song_id: str):
    idem = f"skip:{uuid}:{song_id}"
    r = http.post(f"{BASE}/v1/charge",
                  headers={"Authorization": f"Bearer {KEY}",
                           "Idempotency-Key": idem,
                           "Content-Type": "application/json"},
                  json={"external_id": uuid, "amount": 1, "note": f"skipped {song_id}"})
    if r.status_code == 200:
        announce_in_chat(f"-1 SGC from {nick(uuid)}; new balance: {r.json()['balance']}")
    elif r.status_code == 402:
        deny_skip(uuid, "Not enough SadGirlCoin to skip — earn some in Discord first.")
    elif r.status_code == 404:
        prompt_link(uuid)  # tell them to /lumi-link app:<this-plugin> in Discord
    else:
        log.error("skip charge failed: %s %s", r.status_code, r.text)
```

### Example B — Player-to-player shop in Minecraft

Scopes add: `coins:p2p`.

```python
def on_buy(buyer_uuid, seller_uuid, item, price):
    idem = f"buy:{buyer_uuid}:{seller_uuid}:{item}:{tx_id}"
    r = http.post(f"{BASE}/v1/transfer",
                  headers={**AUTH, "Idempotency-Key": idem},
                  json={"from_external_id": buyer_uuid,
                        "to_external_id":   seller_uuid,
                        "amount": price,
                        "note":   f"shop {item}"})
    # Both players must have linked to this plugin first.
```

### Example C — SadBot song-change tax (sister Discord bot)

`external_id` = the same Discord ID, but namespaced by the sister bot. Same flow: user runs `/lumi-link app:SadBot` in Lumi's Discord, gets a code, pastes it in SadBot. SadBot then `POST`s `/v1/charge` on every song-change with `idempotency_key = f"songchange:{guild_id}:{request_id}"`.

### Example D — Minecraft mod pays a guild company by stock ticker

This uses the bridge route, so it does not require a linked player and does not debit user funds. Depending on server configuration, it either pays from the configured bridge treasury or mints from the Central Bank reserve into the real company's Big Business account.

```python
def reward_company(stock_ticker, amount, event_id):
    idem = f"company-reward:{stock_ticker}:{event_id}"
    r = http.post(f"{BASE}/v1/bridge/company/payout",
                  headers={
                      "Authorization": f"Bearer {BRIDGE_TOKEN}",
                      "Idempotency-Key": idem,
                  },
                  json={
                      "stock": stock_ticker,
                      "amount": amount,
                      "note": "minecraft seasonal objective",
                  })
    if r.status_code == 200:
        company = r.json()["stock"]["business_name"]
        balance = r.json()["company_account"]["balance"]
        log.info("paid %s SGC to %s; new company balance=%s", amount, company, balance)
    else:
        log.error("company payout failed: %s %s", r.status_code, r.text)
```

---

## 12. Operational checklist for your AI integration

Before going live:

- [ ] Store the API key in a secret manager (env var, `.env`, vault). Never check it into source.
- [ ] On boot, call `GET /v1/me` and abort startup if it doesn't return 200 with the expected scopes.
- [ ] Always send `Idempotency-Key` on `/charge`, `/credit`, `/transfer`, `/mint`.
- [ ] Implement backoff for 429/5xx using the **same** idempotency key on retry.
- [ ] On 401 mid-runtime, surface a loud error to the operator — your key was revoked or the app was disabled.
- [ ] Tell users clearly that linking grants spending consent until they `/lumi-link revoke` it.
- [ ] Display per-action SGC costs **before** you charge, not after.
- [ ] If you ever need to `/credit` users, fund your treasury account first (the bank owner does this with a regular Discord `/lumi-bank send` to your `treasury_user_id`).
- [ ] If you use `/v1/mint`, verify both `coins:mint` scope and `can_mint = true` on the app before shipping.
- [ ] If you use `/v1/bridge/company/payout` in `treasury` mode, fund `SGC_BRIDGE_TREASURY_USER_ID` first and keep `SGC_BRIDGE_TOKEN` in server-side secrets only.
- [ ] If you use `/v1/bridge/company/payout` in `mint` mode, treat it like privileged issuance from the Central Bank reserve.
- [ ] Log `app_id`, `external_id`, `idempotency_key`, and HTTP status on every call (never log the API key or the response body of `/links/codes/redeem` if it might contain a real-world identity).

---

## 13. FAQ for AI agents

**Q: Can I look up a user's Discord ID from their `external_id`?**
A: No — the API never reveals Discord IDs to third-party apps. You only ever see your own `external_id`s.

**Q: Can I see a user's total SGC balance even if they haven't linked?**
A: No. `balance:read` only works for users linked to **your** app.

**Q: Can two apps share the same link?**
A: No, each `(app_id, discord_id)` pair is independent. A user must run `/lumi-link app:<...>` once per app.

**Q: What happens to a user's funds if my app is disabled?**
A: User funds are unaffected — they live in the user's own SGC account. Only your treasury balance is "stuck" in `__APP_<id>__` and the bank owner can move it back out manually.

**Q: Can I refund a charge?**
A: Use `POST /v1/credit` with the same `external_id` and `amount`. The audit trail is immutable; refunds appear as a separate transaction. Use a deterministic idempotency key like `refund:<original-idempotency-key>` to keep retries safe.

**Q: Can a game integration pay a guild company like Dogpunk Records Inc directly?**
A: Yes, via `POST /v1/bridge/company/payout`, using the company's stock ticker or stock id. This is a server-side bridge route that does not debit a linked user. Depending on `SGC_BRIDGE_MODE`, it either uses `SGC_BRIDGE_TREASURY_USER_ID` or mints from the Central Bank reserve.

**Q: Does `/v1/mint` create money out of thin air?**
A: No. Current implementation is reserve-backed: it credits the target account and debits `__CENTRAL_BANK__` by the same amount.

**Q: Does `amount` support decimals?**
A: No — SGC is integer-only. `amount` must be a positive integer ≤ 1,000,000,000.

**Q: How do I know if it's "lotto day" (50% transfer fee)?**
A: There is no dedicated endpoint in v1. Make a tiny `/v1/me`-and-then-test-charge if the fee matters to your UX, or just always show the actual `fee` field returned by the call.
