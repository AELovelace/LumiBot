# SadGirlCoin External API v1.1 — Webhooks & Rate Limiting

This document describes the webhook delivery system and rate limiting implementation for the SadGirlCoin External API.

## Webhooks System (NEW in v1.1)

### Overview

Registered apps receive real-time event notifications via HTTP webhooks when:
- External users link/unlink their accounts
- Coins are charged, credited, or transferred via the API
- New coins are minted via the mint endpoint

### Event Types

| Event | Payload | When |
|-------|---------|------|
| `link.created` | external_id, app_id, timestamp | User redeems a link code |
| `transaction.completed` | type, amount, fee, app_id, timestamp | Any coin operation |

### Webhook Configuration

Apps configure their webhook via the web control panel:
- **Webhook URL**: Where to send events (must be HTTPS)
- **Webhook Secret**: Used to sign events (HMAC-SHA256)

### Event Delivery Guarantee

- **At-least-once**: Events retry up to 3 times with exponential backoff (5s, 10s, 20s)
- **Signing**: All webhooks include `X-SGC-Signature` header with HMAC-SHA256 payload signature
- **Retention**: Events stored for 7 days before cleanup
- **Polling**: Dispatcher checks for pending events every 60 seconds

### Validating Webhook Signatures

```javascript
const crypto = require('crypto');

const signature = req.headers['x-sgc-signature']; // "sha256=..."
const secret = process.env.WEBHOOK_SECRET;
const body = req.rawBody; // Raw JSON string

const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(body, 'utf8')
  .digest('hex');

if (signature === expected) {
  // Webhook is authentic
}
```

### Example Webhook Payloads

#### Link Created
```json
{
  "event": "link.created",
  "external_id": "my_app_user_123",
  "app_id": "app_12345",
  "timestamp": "2024-01-15T10:30:45.000Z"
}
```

#### Transaction Completed (Charge)
```json
{
  "event": "transaction.completed",
  "type": "charge",
  "external_id": "my_app_user_123",
  "amount": 500,
  "fee": 10,
  "app_id": "app_12345",
  "timestamp": "2024-01-15T10:30:45.000Z"
}
```

#### Transaction Completed (Mint)
```json
{
  "event": "transaction.completed",
  "type": "mint",
  "external_id": "my_app_user_123",
  "amount": 1000,
  "minted": true,
  "app_id": "app_12345",
  "timestamp": "2024-01-15T10:30:45.000Z"
}
```

#### Transaction Completed (P2P Transfer)
```json
{
  "event": "transaction.completed",
  "type": "transfer",
  "from_external_id": "user_a",
  "to_external_id": "user_b",
  "amount": 250,
  "fee": 5,
  "app_id": "app_12345",
  "timestamp": "2024-01-15T10:30:45.000Z"
}
```

## Rate Limiting

### Per-App Rate Limits

Each app has a configurable `rate_limit_per_min` (default: 60 requests/minute).

- **Enforcement**: Token bucket algorithm (in-memory)
- **Headers**: Each response includes rate limit status:
  - `X-RateLimit-Limit`: App's per-minute limit
  - `X-RateLimit-Remaining`: Requests left in current window

### Example Rate Limit Response

```bash
# Initial request
$ curl -H "Authorization: Bearer sgc_live_..." \
  https://api.example.com/v1/users/12345/balance

HTTP/1.1 200 OK
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
```

```bash
# After exceeding limit
HTTP/1.1 429 Too Many Requests
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests",
    "retry_after_s": 12
  }
}
```

### Link Code Redemption Rate Limits

Additional protection against brute-force attacks on link code redemption:
- **Per Discord ID**: 5 redeems per minute
- **Per IP Address**: 3 redeems per minute

These are tracked separately from the per-app rate limit.

## Integration

### For Developers

1. **Register your app** via the web control panel
2. **Generate API keys** with required scopes
3. **Configure webhook URL** (optional)
4. **Handle rate limiting** by checking headers and respecting `retry_after_s`
5. **Verify webhook signatures** before processing events

### For Server Operators

The webhook dispatcher runs automatically:
- Starts: `startWebhookDispatcher()` in `index.js` on bot startup
- Stops: `stopWebhookDispatcher()` on shutdown
- Polls: Every 60 seconds for pending events
- Cleanup: Hourly cleanup of old rate limit logs (24+ hours)

## Database Schema

### api_webhook_events
```sql
CREATE TABLE IF NOT EXISTS api_webhook_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id        TEXT NOT NULL REFERENCES api_apps(id),
  event_type    TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT DEFAULT NULL,
  next_retry_at TEXT DEFAULT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### api_rate_limit_log
```sql
CREATE TABLE IF NOT EXISTS api_rate_limit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id    TEXT NOT NULL REFERENCES api_apps(id),
  method    TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Troubleshooting

### Webhooks Not Received

1. **Check webhook URL**: Must be publicly accessible HTTPS
2. **Check app is enabled**: Disabled apps don't send webhooks
3. **Check event status**: Query `api_webhook_events` table for failure reasons
4. **Check signature validation**: Ensure you're validating signatures correctly

### Rate Limit Errors

1. **Reduce request rate**: Implement exponential backoff
2. **Batch requests**: Group multiple operations into fewer requests
3. **Request limit increase**: Contact server operators (requires code change)

## Files Modified

- `src/webhookDispatcher.js` — New webhook dispatcher service
- `src/apiKeyStore.js` — Added webhook event firing, rate limit functions
- `src/apiServer.js` — Added rate limit imports and cleanup task
- `src/index.js` — Added webhook dispatcher startup/shutdown
- `src/sadgirlEconomyStore.js` — Added webhook + rate limit log tables

## Future Enhancements

- Webhook delivery status dashboard
- Webhook replay/retry UI
- Advanced rate limit analytics
- Per-event-type webhook URLs
- Webhook filtering by event type
