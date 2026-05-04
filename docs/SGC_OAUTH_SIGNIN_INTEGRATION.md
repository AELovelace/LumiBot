# SGC OAuth Sign-in Mode — Integration Brief for AI Agents

## What it is

The SGC API supports using Discord OAuth as a login provider — not just account linking. When your app cannot generate a stable `external_id` per user, omit it entirely. The token response will always return `discord_id`, which you use as your user identity.

---

## Flow

```
1. Your app backend: POST /v1/links/oauth/start
   → receives authorize_url

2. Send player to authorize_url (browser/redirect/link)

3. Player signs into Discord on sadgirlsclub.wtf consent page, clicks Approve

4. SGC redirects to your redirect_uri with ?code=...&state=...

5. Your app backend: POST /oauth/token (standard auth-code + PKCE exchange)
   → receives access_token + discord_id (+ optional username if identity:read)

6. Store discord_id as your user's stable identifier
```

---

## Step 1 — Start the flow

```http
POST /v1/links/oauth/start
Authorization: Bearer sgc_live_<your_api_key>
Content-Type: application/json

{
  "client_id": "sgc_client_<your_client_id>",
  "redirect_uri": "https://yourapp.example.com/auth/sgc/callback",
  "scope": "identity:read balance:read",
  "state": "<random_csrf_token>",
  "code_challenge": "<S256_pkce_challenge>",
  "code_challenge_method": "S256"
}
```

`external_id` is intentionally omitted — that is what activates sign-in mode.

Response includes `oauth.authorize_url`. Send the player there.

---

## Step 2 — Exchange the code

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<code_from_callback>
&client_id=sgc_client_<your_client_id>
&client_secret=<your_client_secret>
&redirect_uri=https://yourapp.example.com/auth/sgc/callback
&code_verifier=<your_pkce_verifier>
```

Response:

```json
{
  "access_token": "sgc_at_...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "identity:read balance:read",
  "discord_id": "319254336402358272",
  "user": {
    "discord_id": "319254336402358272",
    "discord_username": ".doll",
    "discord_name": ".doll"
  },
  "discord_username": ".doll",
  "discord_name": ".doll"
}
```

`discord_id` is always present on auth-code grants. `user`/`discord_username` only appear if the app has `identity:read` in its granted scope (and optionally the per-app `oauth_include_discord_name` flag enabled in the SGC panel).

---

## Prerequisites (one-time operator setup)

1. SGC panel → API Apps → register your app with at least `identity:read` in scopes.
2. Add an OAuth client with `authorization_code` grant and your `redirect_uri`.
3. Note your `client_id`, `client_secret`, and API key.
4. Optional: enable "Expose Discord username in OAuth responses" checkbox on the app (having `identity:read` in the granted scope is also sufficient without the checkbox).

---

## PKCE generation (Node.js)

```js
const crypto = require('crypto');
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256')
  .update(codeVerifier).digest('base64url');
// Store codeVerifier in session for the /oauth/token exchange.
```

---

## API endpoints

| Endpoint | Method | Notes |
|---|---|---|
| `/v1/links/oauth/start` | POST | Authenticated with app API key. Returns `authorize_url`. |
| `/oauth/authorize` | GET | Browser-facing. Redirects to consent page. |
| `/oauth/consent` | GET / POST | Browser-facing. Hosted on the LumiBot web panel (port 7777 / `/auth/`). |
| `/oauth/token` | POST | Server-to-server. Returns token + `discord_id`. |
| `/oauth/revoke` | POST | Revoke an access token. |

All `/oauth/*` and `/v1/*` routes live on the same backend host: `http://127.0.0.1:7788` locally, or `https://your-domain/{path}` via nginx.

---

## Security notes

- Always validate `state` on the callback matches what you sent.
- `discord_id` is stable and unique per Discord user — safe as a primary key.
- Access tokens expire in 24 hours. There is no refresh token — restart the flow to re-authenticate.
- PKCE (`code_challenge` / `code_verifier`) is required. Method must be `S256`.
- Never log or expose `client_secret` or `access_token` values.

---

## Comparison: sign-in mode vs linking mode

| | Sign-in mode | Linking mode |
|---|---|---|
| `external_id` in request | Omitted | Required |
| Use case | App uses `discord_id` as user key | App has its own user ID (MC UUID, etc.) |
| `external_account_links` row created | No | Yes |
| `discord_id` in token response | Always | Only if `oauthExposeDiscordName` or `identity:read` |
| Can call `/v1/users/{external_id}/*` | No (no link row) | Yes |
| Can call `/v1/charge` / `/v1/credit` | No (no link row) | Yes |

Sign-in mode is purely an identity/authentication flow. To also move coins, the user must also go through a linking step (which can happen in the same flow if you supply an `external_id`).
