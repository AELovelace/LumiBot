# LumiBot audit: fix-list (2026-11-19)

Read-only audit of `main` at `ec90e1f`. Nothing was changed. Each line names the file:line, the defect, how it goes
wrong, and the fix. Findings marked ✔ were re-checked by hand after the audit; the rest were verified by reading the code
unless marked *unverified*.

Good news first: **`.env` has never been committed** (every commit on every branch was checked), so no secrets need rotating.

## Fix status (2026-11-19, uncommitted in the working tree)

**Fixed:**
- **P0:** #1, #2, #3 (frame-ancestors only), #4, #5, #6, #7 (per-app trust lists), #8
- **P1:** #9, #10, #11, #12, #13, #15, #16, #17, #18, #20, #24, #36
  - Pachinko double-drop, hold'em antes charged twice / lost / pot paid twice, and the horse-race leave-mid-race bug were fixed too.
- **P2:** #38, #39, #40, #41, #42, #48, #49, #50
  - Plus the URL part of #43 and the starboard config part of #51.
- **#21 (partial):** casino payouts below zero now log a warning.

**Deferred:**
- **#3** CSP `script-src`: needs nonces, because the pages use inline scripts.
- **#7** per-app session cookie: comes with the Lumi port.
- **#14** synthetic stock minting: needs a real backing account per synthetic stock.
- **#13 follow-up:** a 24 h sell lock now stops instant pump-and-dump. Selling *after* 24 h can still profit, because the 100-share minimum float and the peer performance score inflate the price.
- **#19, #22, #23, #25–#35, #37, #44–#47, #51 (rest), all of P3.**

New helpers:
- `sadgirlEconomyStore.adjustBalancesAtomic(moves)` and `payThenRun(moves, action)`: money first, item second, refund on failure.
- `gameWebServer` `mustAdjustBalance` / `runEconomyTransaction`.
- `workers/engines/secureRandom.js`.

**Deployed** to doll-chan on 2026-11-19 at 19:10 PST.
- Commit `37e3b66` (branch `fix/audit-2026-11-19`), with a pre-update backup at `/var/backups/sadgirlplayer/20261119-191003`.
- Checked live:
  - CSP now has `frame-ancestors 'self'`.
  - The XSS lobby URL returns 404.
  - Admin commands are registered only in the 3 home guilds.
- site-chan's arcade snippet was retired the same evening.
- The update first failed because the venv's `bin/` scripts had lost their exec bit (`chmod +x .venv-fedora/bin/*` fixed it).

### Before deploying these fixes to doll-chan (`/opt/sadgirlplayer`, env `/etc/sadgirlplayer/runtime.env`)

doll-chan runs `ec90e1f` (the commit before these fixes) with `GAME_WORKERS_*=true`, so the worker bet races #9, #10, #17 and #18 **are live in production today**, both in Discord and on the web.

Env changes needed in the same restart:
`arcade.beepsquad.wtf` is **discontinued** (Doll, 2026-11-19), so it comes out of every list.

1. **Trusted origins:** `runtime.env` has `WEB_PANEL_TRUSTED_ORIGINS=sadgirlsclub.wtf,arcade.beepsquad.wtf`.
   - The games and web apps no longer read that list (#7).
   - Set `GAME_WEB_TRUSTED_ORIGINS=sadgirlsclub.wtf` and `WEB_APP_TRUSTED_ORIGINS=sadgirlsclub.wtf` (only needed if those apps are reached through a different host than their own).
   - Then set `WEB_PANEL_TRUSTED_ORIGINS=sadgirlsclub.wtf`, or empty it.
2. **Proxy IPs:** nginx runs on **site-chan (`10.1.1.20`)** and passes `X-Real-IP $remote_addr` in the `/lumibot/` and `/games/` blocks (`/etc/nginx/sites-available/default`), so set `WEB_TRUSTED_PROXY_IPS=10.1.1.20`. Otherwise every friend shares one IP for the login rate limit (30 per minute).
   - Optional leftover: `/etc/nginx/snippets/arcade-forwarded-host.conf` (the arcade `$lumi_forwarded_host` map) can be removed and those blocks switched to `$host`.
   - The repo copy `scripts/nginx/sadgirlsclub.wtf.site.conf` doesn't have the live `/lumibot/` and `/games/` blocks. Sync it from site-chan.
3. **OAuth hosts:**
   - Remove `arcade.beepsquad.wtf` from `DISCORD_OAUTH_PUBLIC_HOSTS`. Leave it empty unless people log in on a host other than the one in the configured redirect URIs; logins that come back on a different host now fail (#5 state cookie).
   - Remove the arcade callbacks from the Discord app's redirect list.
   - With no iframe embedding left, `GAME_WEB_SESSION_SAMESITE` / `WEB_APP_SESSION_SAMESITE` can go back to `Lax`.
4. **Admin servers:** `SLASH_GUILD_ID` lists 3 guilds. Manage Server in any of them now grants Lumi admin (#38), and admin commands are registered only there.
5. **Stock prices:** guild stock prices drop on the first sync (#13).
   - About −2 to −6 % for lightly invested stocks, up to about −44 % for heavily invested ones, 0 % with no investors.
   - Synthetic stocks drop about −4 to −45 %.
   - Warn players before restarting.

Priorities:
- **P0**: fix before the games app is served publicly to friends.
- **P1**: money is created, lost or duplicated.
- **P2**: bot behaviour and crashes.
- **P3**: repo hygiene and docs.

---

## P0: blockers for public serving (web apps)

| # | Sev | Where | Defect → scenario | Fix |
|---|---|---|---|---|
| 1 ✔ | **critical** | `src/gameWebServer.js:1163, 1364, 1547, 1733, 2180`; `src/webAppServer.js:1260`; route e.g. `gameWebServer.js:3380` | Lobby and battle ids from the URL are `decodeURIComponent`ed and written into a `<script>` with `JSON.stringify`, which does not escape `<`. The CSP has no `script-src`. A link like `/games/slots/%3C%2Fscript%3E%3Cscript%3E…` runs script on the games origin. That script passes the same-origin check and can buy an attacker's Touhou listing with the victim's whole balance. | Use `scriptJson` (export it from `webPanelAuth.js`, and also escape `>` `&` U+2028/2029) everywhere. Validate ids with `^[a-z]+-[0-9a-f]{12}$`. Add `script-src 'self' 'nonce-…'`. |
| 2 ✔ | medium | `src/webPanelAuth.js:195-199` (used at 443, 452) | `normalizeNextPath` only blocks a leading `//`, so `next=/%5Cevil.com` redirects off-site straight after a real Discord login (phishing). | Reject `\` and control characters, then require `new URL(next, 'http://x').origin === 'http://x'`. |
| 3 | medium | `gameWebServer.js:96-102`, `webAppServer.js:80-85` | No `frame-ancestors` or `X-Frame-Options`, while cookies can be `SameSite=None`. Any site can frame the app and trick clicks on spin, bet or buy. | CSP `frame-ancestors 'self'` (plus any site that really embeds it). |
| 4 | medium | `webPanelAuth.js:201-210, 330-353` | `oauthStates` grows on every unauthenticated GET `/auth/discord/login` and is only swept every 10 minutes. Flooding that URL exhausts the bot's memory. | Cap the map and rate-limit per IP. |
| 5 | low | `webPanelAuth.js:201, 380` | The OAuth `state` isn't bound to the browser, so an attacker can log a victim in as the attacker (login CSRF). | Set a state cookie and compare it at the callback. |
| 6 | medium | `gameWebServer.js:813-849, 990-993, 857, 891` | The websocket accepts frames up to 4 GB and buffers them, with unlimited subscriptions to any channel string, and nobody checks who owns a channel. | Cap payloads at ~4 KB, cap the buffer and channel count, allow known prefixes only, and check ownership. |
| 7 | low | `webPanelAuth.js:17, 549-557, 419-421` | One trust list and one `sgc_panel_sess` cookie cover the admin panel, Lumi Web and Lumi Games, and `isPanelAdmin` is set even on member logins. Trusting the arcade for games also trusts it for admin POSTs. | Give each app its own trust list and cookie name, and drop the admin flag on member logins. |
| 8 | low | `gameWebServer.js:2739, 3199, 3309, 3381` | `rememberWebLobby` runs on GET with any id, so anyone can fill everyone's lobby list with fakes for 6 h. | Remember a lobby only on POST create. |

## P1: money correctness (SadGirlCoin)

| # | Sev | Where | Defect → scenario | Fix |
|---|---|---|---|---|
| 9 ✔ | **high** | `src/workers/engines/slots/worker.js:191-200` vs `233, 276` | `setBet` awaits the balance check and then writes `player.bet`; `runSpin` pays `player.bet * points`. Bet 1, spin, then `setBet(25)`: the payout is on 25 while only 1 was taken. It can be repeated. | Freeze the wager when the bet is placed and pass it to `runSpin`. Re-check `spinning` after the await. |
| 10 | **high** | `workers/engines/horseracing/worker.js:185-196, 406-423` | `phase` stays `betting` during the funding loop, and the pool reads `p.bet` after the await. Wager 1, raise mid-funding, and win on the big amount. | Set `phase='funding'` before the loop and snapshot bets before any await. |
| 11 ✔ | **high** | `src/sadgirlEconomyStore.js:451-471`, `src/bigBusiness.js:219-224` | `depositBigBusiness` updates an account that may not exist (a guild enabled after boot), ignores `changes`, and still writes a ledger row. Buyers' coins vanish. | Create the account in `ensureStockForGuild`/`matchPayout`, and throw when `changes === 0`. |
| 12 | **high** | `src/privateStockStore.js:867, 985, 1124, 1133`; `src/cigaretteCommands.js:99-100, 360-361`; `src/touhouCommands.js:684-686`; `src/touhouMenu.js:997, 1034-1036, 1075, 1104`; `gameWebServer.js:2345-2350` | `adjustBalance` returns `{success:false}` instead of throwing, and callers ignore it. If the debit fails (e.g. SGCServer wrote the same DB), the credits still commit, which mints coins. | Inside transactions, `if (!r.success) throw`. Do the debit and the credits in one transaction. |
| 13 ✔ | **high** | `privateStockStore.js:301-306, 465-476` | Market cap = treasury (95% of each buy) + invested capital (100%). Each buy lifts the price by ~1.95× its size, so buying then selling at once can drain the Big Business treasury. | Count one or the other, not both. |
| 14 | **high** | `privateStockStore.js:421-434, 977-982` | Synthetic stocks pay sellers from `synthetic_treasury`, which no real account backs and which is refilled on every sync. That creates SGC from nothing. | Back synthetic stocks with a real system account, or cap sells at its balance. |
| 15 | medium | `gameWebServer.js:2622-2657, 140-147, 788, 2700` | Web Touhou battles: there's no one-at-a-time limit, so they run in parallel; the win is paid even when the trader account can't cover it (new SGC); and timed-out battles are never deleted. | One active battle per user, a balance-checked payout, and a TTL sweeper. |
| 16 | medium | `src/touhouBattle.js:391-410, 499-534` | Discord battles: spamming the killing blow runs `endBattle` again and again, paying SGC and EXP each time. | Re-check `state.over` after `deferUpdate`, and guard `resolveTurn`/`endBattle`. |
| 17 | medium | `workers/engines/blackjack/worker.js:276-307` | The join check runs before three awaits, so a double click is debited twice, or one friend is charged without getting a seat. | Re-check after the awaits, or keep a per-channel joining set. |
| 18 | medium | `workers/engines/holdem/worker.js:577-595, 628-648` | A double raise/check debits twice and moves the turn on twice (*unverified* on `scheduleTurn`). | A per-table `busy` lock. |
| 19 | medium | `src/starboard.js:27, 368-375` | Paid star counts live in memory only. After a restart any reaction re-awards the whole star count plus the Big Business match. Self-stars and bot reactions count too. | Store paid counts in SQLite, and exclude the author and bots. |
| 20 | medium | `sadgirlEconomyStore.js:609, 1157, 1223`; `privateStockStore.js:862, 966`; `SGCServer/src/internalRoutes.js:112, 131` | Amounts are only checked `<= 0`. Fractional and REAL values get written to INTEGER balances, and NaN slips through. | `Number.isSafeInteger(n) && n > 0` in every store mutator. |
| 21 ✔ | medium | `sadgirlEconomyStore.js:1187-1201, 913`; `apiKeyStore.js:690`; `apiServer.js:327`; `SGCServer/src/server.js:344` | Momiji Casino (`payCasinoPayout`) and Central Bank (mint and seed) can go negative without any check. | Check the balance inside the transaction, or document that a deficit is allowed. |
| 22 | medium | `SGCServer/src/oauthServer.js:275-277`; `server.js:585-631` | A token with an empty scope gets every scope the app has, and coin routes ignore `auth.discordId`, so one user's token can charge any linked user. | Empty scope grants nothing, and a user-bound token acts only on that user. |
| 23 | medium | `src/webhookDispatcher.js:172-175` (and SGCServer) | An async `setInterval` with no in-flight guard overlaps itself and re-sends rows. There's no delivery id and no signed timestamp, so receivers can't spot replays. | A running flag, an `in_flight` state, and `X-SGC-Delivery` plus a signed timestamp. |
| 24 | medium | `src/sadgirlEconomyScheduler.js:241-247`; `src/vcRewards.js:127-163` | One thrown error (e.g. SQLITE_BUSY) stops the lottery, raffle, tax and VC loops until restart. | try/finally, always rescheduling. |
| 25 | medium | `src/apiServer.js:245`; `SGCServer/src/server.js:261` | The bridge token is compared with `===`, while the security doc says constant-time. | `crypto.timingSafeEqual`. |
| 26 | medium | `apiServer.js:439-446` (and SGCServer) | The link-code rate limit is keyed on `body.discord_id`, which the caller chooses, and on a spoofable `x-real-ip`. | Key on app + code, and trust `x-real-ip` only from the proxy. |
| 27 | medium | `sadgirlEconomyStore.js:1241-1245` | `adjustBalance` logs every move as `__ADMIN__`/`admin_give`/`admin_take`: trades, dividends, Patreon, cigarettes. The ledger can't be audited. | A `type` parameter. |
| 28 | medium | `src/antiFarming.js:319-322` | `REWARD_COOLDOWN` is only added when the message is already ineligible, so the cooldown never throttles anything. | Apply it to eligible messages. |
| 29 | low | `patreonRewards.js:211-214` | The stipend is credited before the payout row is written, outside one transaction, so a crash between them pays twice. | One transaction. |
| 30 | low | `cigaretteStore.js:454` | The item moves in a different DB file from the money, so a sale isn't atomic. | Compensate on failure, or ATTACH both DBs. |
| 31 | low | `sadgirlEconomyStore.js:746-750, 774` | The lottery can draw system accounts (only Central Bank is excluded), and raffle tickets bought on Dec 31 after the draw are lost. | Exclude `__*__` accounts, and close sales at the draw. |
| 32 | low | `apiServer.js:600-619` | Idempotency keys aren't bound to the route or body, and 4xx responses are cached for 24 h. | Key on route + body hash, and cache 2xx only. |
| 33 | low | `apiKeyStore.js:656, 754` | Charge and transfer webhooks read a `result.amount` that doesn't exist, and a non-mint `/v1/credit` fires no webhook. | Pass the amount, and fire the webhook. |
| 34 | low | `src/sadgirlStockActivation.js:27` | Star-vote dedupe is in memory, so a restart lets people vote and be charged again. | A unique (message, user) row. |
| 35 | low | `src/workers/workerManager.js:113-127, 135-145` | A worker crash drops tables whose bets were already taken (no refund), and routing hashes over `live.length`, so channels move to the wrong worker. | Route by slot, and keep a journal of open bets so they can be refunded. |
| 36 | low | `*/engine.js` (blackjack:40, holdem:40, slots:81, pachinko:18-21, horseracing:58) | `Math.random` decides money games. | `crypto.randomInt`. |
| 37 | low | `src/apiServer.js` vs `SGCServer/src/server.js` | Both default to `0.0.0.0:7788`; whichever starts second just logs EADDRINUSE. Their scopes and rate limits have drifted apart. | Pick one owner and disable the other by config. |

## P2: bot core and chatbot

| # | Sev | Where | Defect → scenario | Fix |
|---|---|---|---|---|
| 38 ✔ | **high** | `src/controlPlane.js:19-29, 205` | `isAdminUser` accepts ManageGuild in *any* guild, and the admin commands are global. Another server's admin can `/lumi-reset` (wipe memory) or mint 15 SGC per `/lumi-bigbusinessdebug simulate`. | Require `guildId === config.allowedGuildId` or ADMIN_USER_IDS, and register admin commands per guild. |
| 39 ✔ | **high** | `src/processCleanup.js:6-15` | On startup it kills every `node` process whose command line contains `index.js`, which includes **SGCServer** (`SGCServer/src/index.js`), the `--watch` parent and unrelated apps. It never kills the vector/RAG Python services. | Match this repo's absolute `src/index.js` path, or use a PID file. |
| 40 ✔ | **high** | `src/index.js:48`; `welcome.js:30-76`; `commands.js:205, 296`; `starboard.js:345`; `moderation.js:4` | The client has no `allowedMentions`. LLM and user text reaches channels unfiltered, a crafted display name or quote can produce `@everyone`, and role mentions are never counted. | `allowedMentions: { parse: ['users'], repliedUser: true }` on the Client, and `evaluateOutgoingMessage` on every LLM post. |
| 41 | **high** | `src/llmClient.js:323-380, 805` (4533b24) | Output cut off inside an unclosed `<think>` posts the model's reasoning, and output with only `</think>` (Qwen3/llama.cpp) posts the reasoning that came before it. | Unclosed with no final marker → `''` and fall back. Treat text before a bare `</think>` as thought. |
| 42 | medium | `llmClient.js:13-14, 160, 199-201` | The leak heuristic (two "i need / i want…" lines) eats real replies, and the curly quotes on line 14 are mojibake (`â€œ`). | Run it only when think markers or labels are present, and fix the quotes. |
| 43 | medium | `llmClient.js:453` | Any line starting `word:` is dropped, including `https://` URLs and "note: …". | Exclude URLs, and match only known usernames. |
| 44 | medium | `src/chatbot.js:27, 833-869` | With search disabled, "i can't find my keys" gets a "you used up your searches" reply. `reason === 'cooldown'` never matches `cooldown:Ns`. | Intercept only on real limits, and use `startsWith('cooldown')`. |
| 45 | medium | `chatbot.js:278-301` | `reloadSettings` reads keys missing from the panel SCHEMA, throws, wipes env `channelIds`, and runs before the DB is ready, so panel chatbot settings never take effect. | Add the keys, keep env values when the panel's are empty, and call it after init. |
| 46 | medium | `src/ragClient.js:68` | The Python child's stdout/stderr pipes are never drained, and the handle is thrown away (it's never stopped, so orphans pile up). | `stdio: 'ignore'` or logged, keep the handle, and stop it in `shutdown()`. |
| 47 | low-med | `chatbot.js:681, 937` | `lastReplyAt` is set after the 5-25 s LLM call, which allows parallel calls and bursts of replies. | A per-channel in-flight flag. |
| 48 | low | `src/index.js:117-126` | An empty `try {}` means `stopPrivateStockScheduler` is never called on shutdown. | Restore the call. |
| 49 | low | `index.js:518` | After `uncaughtException` the bot keeps running in an undefined state. | Log, then `shutdown()`. |
| 50 | low | `touhouBattle.js:377` | `battlesByUser.set` runs before reply/fetchReply, so a throw locks the user out until restart. | Set it after, or clear it in `catch`. |
| 51 | low | assorted | reactionroles-debug slices to 3900 chars (the limit is 2000); quotes have no length cap; the Brave quota check/increment isn't atomic; the rate-limited `/lumi-search` path still calls the LLM; `starboard.js:19` hard-codes `http://100.83.3.32:11434` and `server-2`. | Small individual fixes. |

## P3: hygiene and docs

- **package.json**:
  - Pin `discord.js` (installed 14.25.1; it's currently `"latest"`).
  - The `check` script misses 33 of 62 src files. Replace it with a loop over `src/**/*.js`.
  - Remove the 18 extraneous packages (old `@discordjs/voice` and others).
- **.gitignore vs tracked files**:
  - `data/chatbot-memory.json` holds real chat history but is tracked; untrack it.
  - `data/quotes.json` is changed at runtime, so it is always dirty.
  - The `*.json` rule also ignores `SGCServer/package.json`, so a fresh clone of SGCServer can't install.
- **Root clutter**:
  - `yt-dlp.exe` (18 MB, tracked, unused since music was removed): `git rm` it now; purging it from history needs filter-repo.
  - `sgctest.out`: a log containing local paths.
  - `fetch_touhou.py` belongs in `python/`.
  - `cigarette_market_data_expanded.csv` is loaded by default config, so move it to `data/seed/` and update the default.
  - `ding.wav`: the games app serves it from the cwd, so move it alongside the other static assets.
  - `android/` is untracked, `.idea/` only: delete it or ignore it.
- **Docs**:
  - `README.md` still describes the removed music bot. It never mentions Lumi Web, Lumi Games, the web panel, the leaderboard, SGCServer, private stocks, Patreon or the worker pool, or that several servers bind `0.0.0.0`.
  - The root `IMPLEMENTATION_*`, `RAG_*` and `VECTOR_*` docs duplicate each other; move them into `docs/`.
  - `API_SECURITY_AUDIT.md` (L2, M2) and `SADGIRLCOIN_API.md` (`link.revoked` is never fired; the doc says there's no durable webhook queue, but there is one) are out of date.
- **No tests or lint**: there's no `npm test` and no eslint. The `scripts/smoke-*.js` files aren't wired in. Add `node --test` (the Lumi port brings ~190 tests that already pass).
- **Python services**: they bind 127.0.0.1 (fine), but `/shutdown` and `/memory/reset` have no auth. That's acceptable only while they stay local-only.
