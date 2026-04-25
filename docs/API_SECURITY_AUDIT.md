# SadGirlCoin External API — Security Audit Report

**Date:** April 24, 2026  
**Scope:** `src/apiServer.js`, `src/apiKeyStore.js`, `src/sadgirlEconomyStore.js`  
**Status:** Pre-launch (v1.0 implementation complete; v1.1 enhancements pending)

---

## Executive Summary

The API implementation demonstrates solid cryptographic and database practices (hashed keys, parameterized queries, constant-time comparisons, transaction isolation). The primary security model—**blanket spending consent per linked user**—is intentional by design and clearly documented in the integration guide.

**Go-live readiness:** ✅ Acceptable for beta/internal use. **Do NOT promote to production** without implementing the three critical items (webhook dispatch, link-code rate limiting, transaction caps).

---

## ✅ Strengths

### API Key Management
- **Hashing:** SHA-256 with no salt (acceptable for API keys; plaintext shown once).
- **Constant-time comparison:** `crypto.timingSafeEqual()` on verification prevents timing attacks.
- **Storage hygiene:** Plaintext never persisted; key_prefix logged instead of full key.
- **Lifecycle:** Keys revoked (not deleted); revoked keys fail auth immediately.

### Authentication & Authorization
- **Bearer token validation:** Proper `Authorization: Bearer sgc_live_*` parsing.
- **Scope enforcement:** Per-endpoint scope checks; separate `can_mint` flag prevents privilege escalation.
- **Disabled app handling:** Both app-disabled and key-revoked states deny auth.
- **Audit trail:** Last-used timestamp on keys (best-effort).

### Database Security
- **SQL injection:** No risk; all queries parameterized via `better-sqlite3` prepared statements.
- **Transaction safety:** `db.transaction()` wrapper ensures atomicity of multi-statement operations (e.g., link code consumption, idempotency cache).
- **Foreign keys:** Enabled (`PRAGMA foreign_keys = ON`); cascading deletes prevented via soft-delete pattern (revoked_at, disabled_at).

### Input Validation
- **Body size limit:** 8 KB max; oversized bodies return 413 Payload Too Large.
- **Amount bounds:** Positive integers only; max 1,000,000,000 SGC per transaction.
- **String sanitization:** All external inputs trimmed and sliced to safe lengths (e.g., note ≤160 chars).
- **URL decoding:** Safe use of `decodeURIComponent()` for path parameters.

### Rate Limiting
- **Per-app token bucket:** 60-second window; configurable per minute (default 60).
- **In-memory state:** `rateBuckets` Map with automatic cleanup after 2 windows.
- **Remaining counter:** Clients receive `X-RateLimit-Remaining` header for client-side backoff.
- **Retry hint:** `retry_after_s` returned on 429 to guide exponential backoff.

### Idempotency
- **Composite key:** `app_id:client_key` prevents key collision across apps.
- **Response caching:** Full response (status + body) cached; no double-execution of coin ops.
- **Replay detection:** `Idempotency-Replayed: true` header on cache hit.
- **Purge policy:** 24-hour TTL; stale entries auto-deleted.

### Economy Integration
- **Single source of truth:** API coin ops reuse `transferCoins()` from `sadgirlEconomyStore.js`.
- **Fee consistency:** Fees, lotto-day surcharge, and audit-log behavior identical to Discord-originated transfers.
- **Audit trail:** All transactions logged with `api:<app_id>:` prefix in note field.

---

## ⚠️ Medium-Risk Issues

### M1: No Per-Transaction Spending Cap

**Risk:** App could charge max amount (1 billion SGC) in a single call.  
**Impact:** Not mitigated by rate limiting (budget is per-minute, not per-call).  
**Likelihood:** Low (operators trust apps, but malicious app could still issue queries).  
**Mitigation:**
- Add `per_tx_cap` (e.g., 100 SGC max per charge call) to `external_account_links`.
- Add `daily_cap_per_user` to track total debits per user per day.
- Enforce in `apiChargeUser()` before `transferCoins()`.
- Document in operator guide: "Set per-tx-cap to 10x typical transaction size."

---

### M2: Link Code Redemption Not Rate-Limited

**Risk:** Attacker could brute-force link codes (6 alphanumeric chars = ~32^6 ≈ 1 trillion space, but attacker sees collision failures and code expiry).  
**Impact:** DoS on link code generation; computational load on database.  
**Likelihood:** Low (high computational cost; 10-minute expiry limits window).  
**Mitigation:**
- Add rate limit on `POST /v1/links/codes/redeem` at nginx layer: **5 attempts/minute per Discord ID + 3 attempts/minute per IP.**
- Log failed redemption attempts; alert on 5+ consecutive failures from same IP.
- Current nginx config already has `limit_req` zone; add a second zone for this endpoint.

**Nginx example (add to sadgirlcoin-api.conf):**
```nginx
limit_req_zone $http_x_real_ip zone=sgc_redeem_ip:10m rate=3r/m;
limit_req_zone $remote_user zone=sgc_redeem_user:10m rate=5r/m;

location /v1/links/codes/redeem {
    limit_req zone=sgc_redeem_ip burst=5 nodelay;
    limit_req zone=sgc_redeem_user burst=5 nodelay;
    ...
}
```

---

### M3: Treasury Accounts Never Recovered

**Risk:** If an app is disabled/deleted, its treasury account `__APP_<id>__` balance becomes inaccessible.  
**Impact:** Lost SGC (operational/financial impact depends on treasury balance size).  
**Likelihood:** Medium (operators may disable misbehaving apps; treasury fund recovery not part of current flow).  
**Mitigation:**
- Add endpoint `POST /admin/api-apps/{app_id}/recover-treasury` (bank-owner only) to withdraw treasury.
- Alternatively, auto-distribute treasury balance to bank owner account when app is disabled.
- Document in operator SOP: "Always drain app treasury before disabling an app."

---

### M4: External ID Format Not Validated

**Risk:** If external_id format is predictable (e.g., sequential integers) and two apps use the same system, collision/enumeration risk.  
**Impact:** User linked to wrong app or wrong external_id claimed by attacker.
**Likelihood:** Low (database constraints prevent cross-linking; UNIQUE(app_id, external_id) enforced).  
**Mitigation:**
- Document in integration guide: **"external_id must be globally unique within your app's namespace; use UUID or namespace:id format."**
- Consider adding optional `external_id_prefix` to api_apps table for namespace enforcement.
- Example: Force `external_id` to start with `<app_id>_` prefix.

---

### M5: No API Key Rotation Policy

**Risk:** If a key is leaked, there's no automatic expiration; operator must manually revoke.  
**Impact:** Long-term key exposure.  
**Likelihood:** Low (keys are long / hard to guess; but phishing of operator is always possible).  
**Mitigation:**
- Add `expires_at` column to `api_keys` table (optional, default NULL).
- Encourage 90-day rotation in T&C; send bank owner quarterly reminder to rotate all app keys.
- Support automatic key rotation via web panel: one click to issue new key + revoke old key.

---

## 🔍 Low-Risk / Design Issues

### L1: Treasury Balance Visible to All Key Holders

**Finding:** `GET /v1/me` returns `treasury_balance`.  
**Risk:** Leaks app solvency to anyone with a valid key.  
**Assessment:** **Acceptable** — any internal app employee has legitimate reason to check treasury. Consider it a feature: helps app operator debug funding issues.  
**Mitigation (optional):** Add `hide_treasury_balance` boolean flag to `api_apps`; if true, omit balance from response.

---

### L2: Webhook Delivery Not Implemented (v1)

**Finding:** `webhook_url` and `webhook_secret` columns exist but no dispatcher or signing logic.  
**Risk:** Events like `link.revoked` and `transaction.completed` won't propagate to apps; no audit trail of delivery.  
**Likelihood:** N/A in v1 (webhook not exposed yet).  
**Mitigation (v1.1 priority):**
- Implement webhook dispatcher in `apiServer.js` after every state change.
- Sign outgoing POST with `X-SGC-Signature: sha256=<hmac>` header (HMAC over raw body).
- Retry policy: exponential backoff (5s, 10s, 20s); max 3 attempts.
- Add webhook event log in database for audit trail.
- Document signature verification in integration guide.

---

### L3: Blanket Spending Consent Until Revoke

**Finding:** Once linked, app has unlimited charge authority (within rate limit) until user revokes.  
**Risk:** Malicious or buggy app could drain user balance.  
**Mitigation:** **Already documented.** Integration guide (§4) and Discord `/lumi-link` command show warning: *"**Blanket spending consent** until you revoke."* User responsibility to revoke if they no longer trust the app.  
**Enhancement (v1.1):** Add optional per-transaction approval flow (async webhook confirm) for high-value charges, toggled per app.

---

### L4: No Audit Trail on Who Created API Keys

**Finding:** `api_keys` table has no `created_by_discord_id` column; can't trace who issued a key.  
**Risk:** Insider threat; no accountability for key issuance.  
**Mitigation:**
- Add `created_by_discord_id` text column to `api_keys`.
- Log row: `INSERT INTO api_keys (..., created_by_discord_id) VALUES (..., <bank_owner_id>)`
- Audit query: "Show all keys created by user X in the last 90 days."

---

### L5: Idempotency Key Format Unvalidated

**Finding:** Client can send any string ≤128 chars as idempotency key; no format enforcement.  
**Risk:** Collisions across apps if clients reuse keys (e.g., both send key=`abc`).  
**Mitigation:** **Already mitigated.** Composite key is `app_id:client_key`, so per-app isolation guaranteed.  
**Recommendation:** Document in integration guide: "idempotency_key can be any string ≤128 chars; recommend `<event_type>:<user_id>:<event_id>`."

---

### L6: Link Code Collision Retry Bounded at 5 Attempts

**Finding:** If collision detected, code generation retries up to 5 times; after that, throws error.  
**Risk:** Repeated link code requests could fail with "Failed to generate unique link code."  
**Assessment:** **Statistically safe.** Collision is ~1 in 32^6 × 5 ≈ 1 in 200 trillion. Happens only if database is corrupted.  
**Mitigation:** Log error if it ever occurs; escalate to operator.

---

## 🌐 Deployment & Infrastructure

### Current State

| Component | Status | Details |
|-----------|--------|---------|
| **HTTPS** | ✅ | Nginx reverse proxy; TLS termination on sadgirlsclub.wtf. |
| **API Isolation** | ✅ | Binds to `127.0.0.1:7788`; unreachable from internet without nginx. |
| **Request Validation** | ✅ | Security headers set by API; nginx adds more. |
| **Firewall** | ✅ | Port 7788 closed to WAN; only nginx can connect. |

### Recommended Nginx Additions

```nginx
# In sadgirlcoin-api.conf, add to location /v1/ block:

# HSTS: force HTTPS
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Disable HTTP/2 Server Push (defense against BREACH attack)
add_header X-Content-Type-Options "nosniff" always;

# Prevent embedding in iframes (not applicable to JSON API, but good practice)
add_header X-Frame-Options "DENY" always;
```

---

## 🚨 Critical Items (Before v1.1 / Production)

### 1. Implement Webhook Dispatch & HMAC Signing
**Priority:** HIGH  
**Effort:** 2–3 hours  
**Steps:**
1. Add `webhook_event_log` table: `(id, app_id, event_type, payload_json, attempt_count, next_retry_at, status)`.
2. After each coin op that succeeds, insert event row.
3. Hourly worker: fetch pending events, POST to `app.webhook_url` with signature.
4. Sign format: `X-SGC-Signature: sha256=<hex(HMAC-SHA256(raw_body, webhook_secret))>`.
5. Document integration guide §10.

### 2. Rate-Limit Link Code Redemption
**Priority:** HIGH  
**Effort:** 30 minutes  
**Steps:**
1. Add two `limit_req_zone` directives to nginx for redeem endpoint.
2. Adjust the rate limits if testing shows different abuse patterns.

### 3. Add Per-Transaction Spending Caps
**Priority:** HIGH  
**Effort:** 1–2 hours  
**Steps:**
1. Add `per_tx_cap INTEGER DEFAULT 1000000` to `external_account_links`.
2. Check cap in `apiChargeUser()` before calling `transferCoins()`.
3. Return 402 if exceeded: `{ error: { code: 'cap_exceeded', message: '...' } }`.

### 4. Operator SOP: Key Rotation & Treasury Recovery
**Priority:** MEDIUM  
**Effort:** Document only  
**Steps:**
1. Add "Operator Security Checklist" to web panel or `/docs/OPERATOR_SOP.md`.
2. Monthly reminder: rotate all API keys older than 90 days.
3. Before disabling app: drain app treasury or add recovery endpoint.

---

## Test Cases for Next Sprint

### Idempotency
- Send same `/charge` request 3 times with same `Idempotency-Key` → verify only one debit + header `Idempotency-Replayed: true` on 2nd/3rd.

### Concurrency
- 10 concurrent `/charge` calls for same user within 1 second → verify rate limiting or all succeed once (check intent).

### Boundary Conditions
- `/charge` with amount=0, -1, 1000000001 → verify validation errors.
- `/charge` with 9 KB body → verify 413 Payload Too Large.

### Revocation Propagation
- Revoke key → immediately retry with same key → verify 401 Unauthorized (<1s latency).

### Scope Denial
- Request `/v1/charge` with key lacking `coins:debit` scope → verify 403.

---

## Threat Model

### Attacker: Malicious Application Operator
**Motive:** Drain funds from linked users.  
**Attack:** Issue high-volume `/charge` calls targeting many users.  
**Defenses:**
- Rate limit per app (60/min typical).
- User consent via `/lumi-link` (users must explicitly link).
- Revocation (user can unlink anytime).
- Bank owner can disable app.
- Audit trail (all charges logged).
- **Gap:** Per-transaction cap adds defense; implement M1 mitigation.

### Attacker: API Key Leaked
**Motive:** Use stolen key to charge users.  
**Attack:** Integrate stolen key into malicious bot.  
**Defenses:**
- Key prefix logged; operator can spot suspicious usage pattern.
- Key revocation (operator can revoke if notified).
- Rate limiting (limits damage even if compromised).
- **Gap:** No automatic expiration; encourage 90-day rotation.

### Attacker: Code Brute-Force
**Motive:** Intercept link codes and claim user's external IDs.  
**Attack:** Loop through 32^6 code space.  
**Defenses:**
- 10-minute expiry limits window.
- Database uniqueness constraints prevent duplicate claims.
- **Gap:** Rate limiting on redemption hardens defense; implement M2 mitigation.

### Attacker: SQL Injection
**Motive:** Bypass auth, read user balances, modify transactions.  
**Attack:** Inject SQL in external_id or note field.  
**Defenses:**
- Parameterized queries (no injectable strings).
- **Risk Level:** ✅ Very Low.

### Attacker: MITM (Unencrypted Channel)
**Motive:** Steal keys in transit.  
**Attack:** Network sniffing.  
**Defenses:**
- HTTPS required (nginx enforces).
- API never exposed on HTTP.
- **Risk Level:** ✅ Very Low.

---

## Compliance & Privacy

### GDPR
- **Data minimization:** API stores Discord IDs and external IDs; no additional PII.
- **Right to be forgotten:** Revoking link deletes `external_account_links` row (soft-delete via revoked_at).
- **Audit trail:** Transactions not deleted (accounting requirement); link with `api:` prefix for data lineage.
- **Recommendation:** Document in privacy policy that Discord ID is shared with third-party apps on user consent.

### Financial Auditability
- **Immutable log:** `transactions` table append-only; all corrections are new reversals.
- **Reconciliation:** Bank owner can compare sum of all `transactions.amount` with live account balances.
- **Audit ready:** Export entire `transactions` table filtered to `type LIKE 'api:%'` for third-party review.

---

## Conclusion

**Overall Assessment:** 🟢 **Acceptable for beta/internal deployment.**

**Strengths:** Cryptographic hygiene, database safety, rate limiting, idempotency.  
**Gaps:** Webhook dispatch (v1 feature incomplete), link-code rate limiting (easy fix), transaction caps (high value).  
**Recommendation:** Implement all critical items (M1, M2, L2) before promoting API to public/production status. Current v1.0 is safe for invited pilot customers with operator oversight.

---

**Next Review:** After v1.1 (webhook + caps + rate limits implemented).  
**Threat Model Update:** When multi-region deployment or B2B integrations go live.
