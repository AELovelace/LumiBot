# Plan: bring Lumi Pet and the Lumi minigames from erinne into LumiBot, paid in SadGirlCoin

Status: **on hold** (2026-11-19). Nothing is built yet. Doll's answers are in **§10 Decisions**.

> ⏸ **Waiting on erinne's new player-home system** (`C:\scripts\erinne\docs\plans\lumi-pet-social.md`: free walking,
> local chat, visiting houses). On 2026-11-19 only its phase 1 (free walking) was built. Port Lumi Pet after it is
> finished, so `house.js`, `room-ui.js`, `lumihouse.py` and `lumitown.py` are ported once, in their final form.
> Before starting, re-check erinne's `git log` for changes to the files listed in §1/§3.8, and update §3.8 and the
> Phase 5 social scope to match.
Source: `C:\scripts\erinne` (Mnemerynne, Python/FastAPI). Its tree is clean. erinne is reference only: we copy from it and never edit it.

Goal: friends in Doll's Discord server log in at **https://sadgirlsclub.wtf/lumipet/** and play Lumi Pet and the Lumi
minigames. Every coin is real SadGirlCoin. All prizes come out of one pool of Lumi-Town money, and admins can tune
every price, prize and cap from the web panel.

---

## 1. What comes over, and what stays behind

| Game (erinne name) | Comes over? | Why |
|---|---|---|
| **Lumi Pet**: care, shop, closet, capsules, house/room | ✅ Phase 2 | The core everything else needs. Lumi-Soft prizes, the lumi-sprite and the party all read the pet's save. |
| **Lumi Dungeons**: battle, skills, mods, dungeon runs, tales | ✅ Phase 3 | Lumi Pet sub-modes that share its save. |
| **Lumi's Garden** | ✅ Phase 3 | A Lumi Pet sub-mode. |
| **Prism Drop** | ✅ Phase 4 | The server rolls every drop. Smallest game, a good first SGC test. |
| **Lumi Launch** | ✅ Phase 4 | The server replays the shot log. Node `require`s the same `rules.js`, so the Python mirror is dropped. |
| **Lumi-Soft** | ✅ Phase 4 | Server replay with the same `rules.js`. Stage prizes go into the pet's closet. |
| **Teacup Tower**, **Yarn Pop** (Breakout), **Lumi Conga** (Snake) + showdowns | ✅ Phase 4 | Lumi-themed arcade. The sounds and art are from royalty-free packs Doll bought (§8). |
| **Party** (co-op dungeons), **Town**, **house visiting** | ✅ Phase 5 | Social. Needs live streams. |
| StickBob Runner | ❌ | Not Lumi-themed: it's Doll's own GameMaker IP, and it trusts the client's score. |
| Casino "Lumi's Lounge" | ❌ (maybe later) | LumiBot already has its own casino. Later, Lumi faces could be drawn at LumiBot's tables using `lumi-look`. |
| Lumi TV, phone remotes, couch mode, `retro`, `casino_remote` | ❌ | Mnemerynne's TV box only. |
| Web Push reminders | ❌ → Phase 7 | Replace with an opt-in **Discord DM** from Lumi when her needs get low. |
| Live dungeon storyteller (Claude / BFGguf) | ❌ → Phase 7 | The tales library works without it. Later it can use LumiBot's own `llmClient`. |

Size: about **8k lines of Python** to rewrite in JS (`lumipet` 901, `lumibattle` 1007, `lumidungeon` 671, `lumigarden` 687,
`lumiparty` 1344, `lumitales` 293, `lumitown` 179, `lumihouse` 173, `lumilaunch` 121, `lumisoft` 253, `prism` 154,
`arcade` 285, `showdown` 522, plus about 1.2k of routes from `web/games.py`). The two `*_rules.py` mirrors (~700 lines)
are **not** ported, because Node uses the `rules.js` files directly. The browser side (~4.3 MB of static files) comes over
almost unchanged.

---

## 2. Where it lives in LumiBot

**Process:** it runs inside the existing **Lumi Games** server (`src/gameWebServer.js`, port 7172), but it is its own
app under its own path, **`/lumipet`** (`LUMI_WEB_BASE_PATH`, default `/lumipet`). The slots, Touhou and other `/games`
pages are untouched.

```
src/lumi/
  index.js            // initLumiGames(db) + handleLumiRequest(req, res, url) → true when it handled the request
  router.js           // small table of {method, pattern, handler}, so we don't grow another if-chain
  auth.js             // /lumipet/auth/discord/login|callback|logout via webPanelAuth, with its own cookie
                      //   `lumi_sess` (Path=/lumipet) and its own redirect URI; same member check as the games app today
  static.js           // serves public/lumi/** from a fixed root (normalised path, no "..", allowlisted extensions, long cache)
  pages.js            // replaces Jinja templates/game.html: one HTML shell per app with the fixed script load order
  schema.js           // CREATE TABLE IF NOT EXISTS for every lumi_* table (see §5)
  sgc.js              // THE ONLY file that moves SadGirlCoin for the games (see §3)
  treasury.js         // Lumi-Town Bank, category accounts, sliding-scale sweep, emergency draws (see §3)
  tuning.js           // reads every price, prize and cap from lumi settings (see §4); one place, cached, live-reloaded
  events.js           // in-process EventEmitter + SSE helper (replaces Valkey events / rooms_bus)
  pet.js  house.js  battle.js  dungeon.js  tales.js  garden.js
  party.js  town.js  showdown.js  lobby.js
  prism.js  launch.js  soft.js  arcade.js
  data/               // lumipet_data/*.json, lumisoft_data/stages.json (copied)
public/lumi/          // erinne web/static/games/{common.js, gamepad.js, lumi-pet/, lumi-launch/, lumi-soft/,
                      //   prism-drop/, teacup-tower/, breakout/, snake/, arcade/} + icons
tests/lumi/           // erinne tests/js/*.test.mjs with paths fixed, plus new sgc/treasury tests; `npm test` = node --test
```

**Hook:** at the top of `handleRequest` in `gameWebServer.js`, before `routePath`, add
`if (url.pathname === '/lumipet' || url.pathname.startsWith('/lumipet/')) { if (await handleLumiRequest(req, res, url)) return; }`.

**URLs** (all under `https://sadgirlsclub.wtf/lumipet/`):
- `/lumipet/`: the Lumi hub, with your Lumi, your SGC balance and a card for every game.
- `/lumipet/{app}`: `pet`, `dungeons`, `garden`, `prism-drop`, `lumi-launch`, `lumi-soft`, `arcade`, `teacup-tower`, `yarn-pop`, `lumi-conga`.
- `/lumipet/api/{slug}/…`: the game API, the same sub-paths erinne uses under `/api/media/games/{slug}/`.
- `/lumipet/api/coins`: your SGC balance (the coin chip).
- `/lumipet/static/…`: the files.
- `/lumipet/login` and `/lumipet/auth/discord/…`: login.

### Front-end edits (the only ones)
1. **API base**: replace the hard-coded `"/api/media/games/"` with `window.LUMI_API` (`"/lumipet/api/"`), which the page shell sets. That's one sed across `common.js`, `lumi-pet/game.js`, `arcade/*.js`, `lumi-sprite.js` and the game dirs.
2. **common.js**:
   - Drop the `mnemerynne-game-*` postMessage to the TV frame.
   - Rename the localStorage prefix to `lumi-game:`.
   - Set the theme variables on `:root` in the shell.
3. Hide the TV / remote / "who's playing" buttons (the shell sets `tv_play=false`).
4. Rename the coin label to **SGC** everywhere it says "coins". Every price the page shows comes from the server's tuning (§4), so it is never hard-coded in JS.

---

## 3. SadGirlCoin: Lumi-Town's money

### 3.1 The accounts

| Account id | Shown as | What it is |
|---|---|---|
| `__LUMI_TOWN_BANK__` | **Lumi-Town Bank** | The main account. **Every** prize, reward and refund is paid from here. |
| `__LUMI_HOLDINGS__` | **Lumi Holdings Inc.** (ticker **LUMI**) | A permanent company on Doll Street. Its account is the treasury behind the stock and the **reserve capital** behind the bank. |
| `__LUMI_SNACKS__` | Lumi's Snack Stand | Snacks and toys (pet care shop) |
| `__LUMI_BOUTIQUE__` | Lumi's Boutique | Decor, wear, house things |
| `__LUMI_CAPSULES__` | Moon Capsule Co. | Capsules and moon capsules (the closet gacha) |
| `__LUMI_OUTFITTERS__` | Dungeon Outfitters | Respec, mods, potions, heals, stat resets, kit |
| `__LUMI_NURSERY__` | Starpowder Nursery | Garden plots and seeds |
| `__LUMI_ARCADE__` | Lumi Arcade | Entries and continues (Prism Drop, Launch, Lumi-Soft, Teacup Tower, Yarn Pop, Lumi Conga) and showdown entries and bets |

The themed names are just display names. They live in `lumi_accounts(category, account_id, display_name, games_json)`, so
admins can rename them or move a game to another category from the admin page. Like Tay's Tobacco and Touhou Management,
they are system accounts (`__*__`), so the leaderboard and lottery hide them. Fix-list #31 also makes the lottery skip
them.

### 3.2 How money moves

```
player ──spend──▶ themed category account (Snack Stand, Boutique, …)
                        │  sweep: taxed into the bank on a sliding scale (3.3)
                        ▼
                 Lumi-Town Bank ──pay──▶ player (every prize)
                   ▲        │  overflow above the ceiling
     emergency     │        ▼
     draws (3.4)   └── Lumi Holdings Inc. (reserve, the LUMI stock's treasury)
                              ▲   share buys add capital   │ share sells and dividends (limited by the reserve floor)
                              └──────── Doll Street ────────┘
```

- **Spend**: player → the category's account, in the same SQLite transaction as the game change it pays for.
- **Pay**: Lumi-Town Bank → player. If the bank can't cover it, an emergency draw happens **inside the same transaction** (3.4), so a prize never fails while the pool as a whole has money.
- **One pool of liquidity**: what can be paid out = bank + every category account + Holdings above its floor. The category accounts keep their themed balances (so you can see which shop earns what), but they are all reachable for payouts.
- **Nothing is ever minted.** erinne's "new coins" (rewards, buybacks, refills) are all paid by the bank. The only new money entering Lumi-Town is the one-time seed from Central Bank (3.6) and share purchases of LUMI.

### 3.3 The sweep: a sliding-scale tax on the category accounts

Every 15 minutes, and on demand from the admin page, `treasury.sweep()` runs one transaction:
1. `health = bank balance ÷ bank target` (the target is set on the admin page; default 100,000).
2. Pick the tax rate from the sliding scale (all bands editable):

   | Bank health | Tax taken from each category's balance |
   |---|---|
   | below 25% | **100%** |
   | 25% – 50% | 75% |
   | 50% – 100% | 50% |
   | 100% – 150% | 25% |
   | 150% or more | 10% |

3. Move `floor(balance × rate)` from each category account to the bank (ledger type `lumi_sweep`).
4. **Overflow**: if the bank is above its ceiling (default 2× target), move the excess to Lumi Holdings (ledger type `lumi_overflow`). This grows the reserve and, through the treasury, LUMI's share price.

The scheduler uses try/finally and always reschedules, so one error never stops it (fix-list #24 lesson). It runs on an `unref()`'d timer.

### 3.4 Emergency draws

When a prize is bigger than the bank's balance, `pay()` tops the bank up first, in this order and inside the same transaction:
1. **Category accounts**, largest balance first, until the shortfall plus a refill buffer (default 10% of target) is covered.
2. **Lumi Holdings**, but only down to its **reserve floor** (default 50,000).
3. If it still can't be covered, the prize is not paid. The player sees "Lumi-Town Bank is closed for a moment, your prize is saved", and the prize stays owed in `lumi_owed` (paid-once ref). It is paid automatically by the next sweep that has the money. Admins are told on the admin page.

Each draw is logged as `lumi_emergency_draw` with its source, and shown on the admin page with a counter. Frequent emergency draws mean prizes are too generous for what the shops take in.

### 3.5 Lumi Holdings Inc. on the stock exchange

A new stock kind, `entity_type = 'lumi'`, in `privateStockStore.js`:
- **Permanent**:
  - `syncStockUniverse` always keeps it `active` and listed, never delists or deactivates it, and lists it first after the guild stocks.
  - It doesn't take a synthetic slot.
  - `guild_id = '__LUMI_HOLDINGS__'`, `ticker = 'LUMI'`, `business_name = 'Lumi Holdings Inc.'`, created by `ensureLumiHoldingsStock()` at init.
- **Real treasury**: `getCorporateTreasuryBalance` returns the balance of `__LUMI_HOLDINGS__`. It never uses `synthetic_treasury`, so it never mints (unlike fix-list #14).
- **Buy**: the 5% Doll Street fee stays as it is, and the net goes into `__LUMI_HOLDINGS__`. Buying LUMI is literally investing in Lumi-Town's reserve.
- **Sell**: paid from `__LUMI_HOLDINGS__`, but a sale can't take the treasury below the **reserve floor**. Instead it's refused with "LUMI is illiquid right now".
- **Dividends**: paid only from the part of the treasury above the floor, at an admin-set rate (default 2% weekly). They are skipped while any prize is owed (3.4).
- **Price**: based on the treasury, which rises with overflow and falls with emergency draws, so LUMI's price is a live health readout for Lumi-Town.
  - This **requires fix-list #13** (the market-cap double count) first, or LUMI would be exploitable from day one.
  - Fix-list #12 (ignored `adjustBalance` results in buy/sell) is also fixed before LUMI lists.

### 3.6 Seeding (agreed: 250k from Central Bank)

There is a one-time **Seed** action on the admin page: Central Bank → **100,000 to Lumi-Town Bank + 150,000 to Lumi Holdings** (the split is editable before you press it). It is recorded as `lumi_seed`, and Central Bank's balance is checked first (fix-list #21).

### 3.7 The coin API (`src/lumi/sgc.js`): the only door

```js
spend(userId, username, amount, game, kind)   // player → that game's category account; throws NotEnoughSGC
pay(userId, amount, game, kind, ref)          // Lumi-Town Bank → player, emergency draw if needed; ref = pay once
balance(userId)                               // the coin chip
inGame(fn)                                    // db.transaction(fn): game state + coin moves commit together or not at all
```
- Every amount passes `Number.isSafeInteger(n) && n > 0`.
- Ledger `type` is `lumi_{game}_{kind}` (e.g. `lumi_pet_shop`, `lumi_battle_win`, `lumi_launch_entry`). This needs a new store function, `moveCoins(from, to, amount, type, note)`, that checks the sender's balance (system accounts included) and **throws** on failure. Don't use `adjustBalance` (it logs as admin and doesn't throw; fix-list #12, #27) or `transferCoins` (1% fee).
- Pay-once refs live in `lumi_coin_refs(ref TEXT PRIMARY KEY, …)`, written in the same transaction.
- **All Lumi tables live in the economy DB** (`getEconomyDb()`, like `webAppStore.js`). A separate file ATTACHed in WAL mode wouldn't be atomic with the coin move.
- `busy_timeout` is set, and `SQLITE_BUSY` becomes "try again" (SGCServer writes the same file).

### 3.8 Every erinne coin touchpoint, mapped
| erinne call (file:line) | What | LumiBot call | Category |
|---|---|---|---|
| web/games.py:625 | daily visit | `pay(…, 'pet', 'visit', 'lumi-pet:{uid}:{day}')` | bank |
| web/games.py:598 | housewarming | `pay(…, 'pet', 'housewarm', 'lumi-housewarm:{me}:{host}:{day}')` + daily cap | bank |
| lumipet.py:300 | move-in decor refund | `pay(…, 'pet', 'movein', 'lumi-move-in:{uid}')` | bank |
| lumipet.py:561 | snacks, toys | `spend(…, 'pet', 'snacks')` | Snack Stand |
| lumipet.py:587 / 611 | decor, wear | `spend(…, 'pet', 'boutique')` | Boutique |
| lumipet.py:633 | capsule / moon capsule | `spend(…, 'pet', 'capsule')` | Moon Capsule Co. |
| lumipet.py:645 | duplicate buyback | `pay(…, 'pet', 'buyback', 'lumi-buyback:{uid}:{roll}')` (the ref is new) | bank |
| lumibattle.py:865 | battle win | `pay(…, 'battle', 'win', 'lumi-battle:{id}')` | bank |
| lumibattle.py:891-976 | respec, mods, potions, heal, reset, kit | `spend(…, 'battle', 'shop')` | Outfitters |
| lumidungeon.py:593 | satchel brought home | `pay(…, 'dungeon', 'win', 'lumi-run:{uid}:{run}')` | bank |
| lumiparty.py:865 | party satchel | `pay(…, 'party', 'win', 'lumi-party:{code}:{run}:{uid}')` | bank |
| lumigarden.py:272 / 335 | powder pressed into coins; token gift | `pay(…, 'garden', 'press' / 'token', <erinne ref>)` | bank |
| lumigarden.py:440 / 484 | plot, seed | `spend(…, 'garden', 'shop')` | Nursery |
| prism.py:148 | score payout | `pay(…, 'prism', 'win', 'lumi-prism:{run}')` (the ref is new) | bank |
| lumilaunch.py:62 / 109 | entry; metres payout | `spend(…, 'launch', 'entry')`; `pay(…, 'launch', 'win', 'lumi-launch:{run}')` | Arcade / bank |
| lumisoft.py:164 / 192 / 223 | entry; continues; score payout | `spend` ×2; `pay(…, 'soft', 'win', 'lumi-soft:{run}')` | Arcade / bank |
| arcade.py:255 / 283 | entry; score payout | `spend(…, slug, 'entry')`; `pay(…, slug, 'win', '{slug}:{run}')` | Arcade / bank |
| showdown.py:135 / 419 / 97 / 83 / 108 / 110 | racer entry, watcher bet, prizes, refunds | `spend` / `pay` with refs `{slug}:{run}:…` | Arcade / bank |

Every number in that table (entry, divisor, price, cap) comes from `tuning.js` (§4), never from a constant.

---

## 4. Tuning: lower buy-ins *and* payouts, still profitable to play

Doll's rule: payouts can come down as long as buy-ins come down too, so playing well still earns.

**Default: scale both by the same factor.** The Lumi economy scale defaults to **0.2**:
- Every entry, continue and shop price is ×0.2, rounded, with a minimum of 1. Arcade entry 25 → **5**; Lumi-Soft continues 50/100/200/400 → **10/20/40/80**; capsule 150 → **30**; moon capsule 300 → **60**.
- Every payout is ×0.2: Prism score ÷10 → **÷50**; Launch metres ÷20 → **÷100**; Lumi-Soft ÷250 → **÷1250**; arcade 1 per point → **1 per 5 points**; battle EXP×0.6 → **×0.12**; daily visit 25 → **5**; housewarming 10 → **2**.

Because entry and payout shrink by the same factor, each game's **player return** (prizes ÷ entries) is exactly what it was in erinne. A run that earned in erinne still earns here, just in smaller numbers that suit real SGC.

Teacup Tower and Yarn Pop take their score from the browser (only bounded), so they get a daily cap from day one. Every game gets a per-player daily cap (default 100 SGC of prizes, editable, and 0 = no cap).

### The admin page: `/lumi` on the web panel (admin-only, port 7777)

A new page in `src/webPanel.js` (as its own file, `src/lumiAdminPage.js`, to keep webPanel from growing). Every POST checks the admin session and same-origin, and every change is written to `lumi_admin_log(who, key, old, new, at)`.

1. **Lumi-Town treasury**:
   - Balances of the Bank, Holdings and each themed account.
   - Bank health %, the current sweep rate, 24 h / 7 d in and out, the emergency-draw count and log, and owed prizes.
   - LUMI's price and shareholder count.
2. **Game knobs**: one row per game:
   - On/off, entry cost, continue costs, payout divisor or rate, daily cap.
   - **Live stats**: plays, SGC in, SGC out, **player return %**, house net (24 h / 7 d from the ledger).
   - A warning badge when player return is under 100% (not profitable to play) or over 200% (it's printing).
3. **Shop prices**: a price multiplier per category, plus per-item overrides for the pet shop, boutique, capsules, outfitters and nursery.
4. **Economy scale**: the global scale (default 0.2), with a preview of what every number becomes before you save.
5. **Treasury policy**:
   - Bank target and ceiling, the sliding-scale bands, sweep interval and refill buffer.
   - Holdings reserve floor, LUMI dividend rate and emergency-draw order.
6. **Actions**:
   - Sweep now.
   - Seed from Central Bank.
   - Move SGC between Lumi accounts (logged).
   - Rename themed accounts and choose which games feed which account.
   - Pay owed prizes now.
   - A **pause all payouts** switch (games keep running, prizes are owed).

Storage: all knobs are `lumi.*` keys in the existing `system_state` `setting.` store. Through `panelSettings.js`, they show up in the existing settings plumbing for free. `tuning.js` caches them and reloads when the admin page saves.

---

## 5. Database (tables in the economy DB, all `lumi_` prefixed)

From erinne `migrations/games/0001_games.sql` + `0002_lumi_launch.sql`:
- `lumi_pets(user_id TEXT PK, save TEXT /*json*/, …)`
- `lumi_battles`, `lumi_runs`, `lumi_gardens`, `lumi_parties`, `lumi_party_members`
- `lumi_prism_runs`, `lumi_launch_runs`, `lumi_launch_bests`, `lumi_soft_runs`, `lumi_soft_bests`, `lumi_soft_progress`
- `lumi_arcade_runs`, `lumi_arcade_rooms`

New:
- `lumi_coin_refs`, `lumi_daily(user_id, game, day, earned)`, `lumi_owed`
- `lumi_accounts`, `lumi_admin_log`

Rules:
- **`user_id` is TEXT** (Discord snowflakes are bigger than 2^53). erinne's INTEGER ids inside JSON saves become strings too.
- "Day" uses one fixed timezone (America/Los_Angeles), not the server clock.
- Display names come from the Discord session, cached in the save.
- Dropped: `lumi_push_events`, `push_subscriptions`, `casino_rooms`.

---

## 6. Framework swaps (erinne → LumiBot)

| erinne | LumiBot replacement |
|---|---|
| `_session_user`, `media_user`, `_media_on` | `src/lumi/auth.js` (the `lumi_sess` cookie, the same guild-member check the games app uses today) |
| `_csrf_guard` | `validateSameOrigin(req)` on every POST, with a Lumi-only trusted-origins list |
| `security.GamesShed` | A per-user in-flight lock (one money action at a time per player), plus a per-IP token bucket on `/lumipet/api/*` |
| `db.transaction` / `read_transaction` | `sgc.inGame(fn)` |
| `events` + `rooms_bus.sse` (Valkey) | `src/lumi/events.js`: an EventEmitter plus a tiny SSE writer (25 s heartbeat, `X-Accel-Buffering: no`). The front-end already uses `EventSource`. |
| `lobby.PRESENCE`, `showdown.Hub`, `lumitown.Town`, `lumihouse` | Ported as-is: in-memory Maps with expiry sweeps. They reset on restart, as in erinne. |
| `users.get_user_by_id` | The Discord username from the session, cached |
| `media.daily_cap` | `tuning.js` |
| `push` + `lumipet.sweep` | Phase 7: an opt-in Discord DM |
| Python decay / time | `Date.now()` and stored timestamps. Decay is computed on read. |

---

## 7. Phases

Each phase ends with `npm test` green, `node --check` on new files, a play-through on `npm run start:3080`, docs updated, and Doll's go-ahead before the next phase.

**Phase 0: make it safe to share**
- Fix-list P0: #1 XSS, #2 open redirect, #3 frame-ancestors / script-src, #4 / #5 OAuth state, #6 ws caps, #7 per-app cookie and trust list, #8 fake lobbies.
- Money fixes that Lumi depends on: #9 / #10 bet races, #12 ignored debit results, #13 market-cap double count, #20 integer guards, #21 system-account balance checks, #24 scheduler try/finally.

**Phase 1: Lumi-Town foundation**
- The `src/lumi/` skeleton, `/lumipet` routing, login, static files, the page shell and the hub page with your SGC balance.
- Store: `moveCoins` and the 8 Lumi accounts.
- `treasury.js`: sweep, emergency draws, overflow, owed prizes.
- `sgc.js`, `tuning.js`.
- **Lumi Holdings / LUMI** on the exchange.
- The **`/lumi` admin page**: treasury, policy, actions, seed. The game rows fill in as games land.
- Copy the static files, data and `.mjs` tests, and wire `npm test`.
- New tests:
  - `sgc.test.mjs`: spend, pay, duplicate ref, bad amount, rollback.
  - `treasury.test.mjs`: every sweep band, overflow, the emergency-draw order, the reserve floor, owed prizes paid later.
  - `lumi_stock.test.mjs`: buy adds to the reserve, sell is blocked at the floor, dividends only above the floor, it stays listed through `syncStockUniverse`.

**Phase 2: Lumi Pet core**
- `pet.js` and `house.js`: state, care, Snack Stand, Boutique, capsules, closet, room/house, moving boxes, daily visit.
- Done when the pet tests pass and a friend can adopt, feed, shop and decorate with real SGC, with the money landing in the right themed accounts.

**Phase 3: Dungeons and Garden**
- `battle.js` (Outfitters), `dungeon.js` (Sokoban replay), `tales.js` (library only), `garden.js` (Nursery, press bands, tap rate cap).

**Phase 4: minigames**
- Prism Drop first.
- Then Lumi Launch and Lumi-Soft, which `require` their `rules.js`. erinne's run fixtures become parity tests.
- Then Teacup Tower, Yarn Pop, Lumi Conga (port the `check_snake` replay) and showdowns.
- Each one gets its admin row and live stats.

**Phase 5: social**
- Party (SSE), Town (chat, emotes, presence), house visiting (knock, guestbook, housewarming).
- Chat goes through `moderation.evaluateIncomingMessage`, with a length cap, HTML-escaped on render.

**Phase 6: go public**
- nginx (§8), Discord redirect, the `.env` keys, a smoke test from outside, and the player guide posted.

**Phase 7: nice-to-haves**
- Discord DM pet reminders.
- `/lumi pet` slash command (a status card + link).
- The LLM storyteller via `llmClient`.
- Lumi faces at LumiBot's casino tables.
- A Lumi-Town treasury post in the leaderboard channel.

---

## 8. Deploy at https://sadgirlsclub.wtf/lumipet/

1. **Discord**: add `https://sadgirlsclub.wtf/lumipet/auth/discord/callback` to the Discord app's redirect list. Set `LUMI_DISCORD_OAUTH_REDIRECT_URI` to it.
2. **`.env`** (also added to `.env.example`, no new secrets):
   - `LUMI_WEB_ENABLED=true`
   - `LUMI_WEB_BASE_PATH=/lumipet`
   - `LUMI_DISCORD_OAUTH_REDIRECT_URI=…`
   - `LUMI_SESSION_SECURE=true`
   - `LUMI_TRUSTED_ORIGINS=https://sadgirlsclub.wtf`
   - `GAME_WEB_HOST=127.0.0.1` if nginx is on the same box. The repo conf proxies to `10.1.1.23`; then keep `0.0.0.0` and firewall 7172 to the nginx host.
3. **nginx** (`scripts/nginx/sadgirlsclub.wtf.site.conf`): `location = /lumipet { return 301 /lumipet/; }` and `location /lumipet/ { proxy_pass http://10.1.1.23:7172; … }` with:
   - X-Forwarded-* headers
   - `proxy_buffering off` + `proxy_read_timeout 1h` on `~ ^/lumipet/api/.+/stream$` (SSE)
   - a long cache + gzip on `/lumipet/static/`
   - `client_max_body_size 64k`
   - a `limit_req` zone on `/lumipet/api/`

   These go **before** the catch-all `location /` that proxies to :3000.
4. **Who can play**: members of Doll's server, exactly as the games app checks today (Doll, 2026-11-19).

## 9. Risks and gotchas

- **Asset licences**: the Breakout sounds and power-ups and the Lumi-Soft sounds are from royalty-free sample packs Doll bought (2026-11-19). Add `public/lumi/CREDITS.md` naming the packs (Doll to fill in), and keep the files inside the game, never as a downloadable pack.
- **Client-trusted scores**: Teacup Tower and Yarn Pop only bound the browser's score, so they get daily caps from day one. Server replay can come later.
- **In-memory social state** (town, houses, parties) resets when the bot restarts. A banner on reconnect is enough.
- **Shared DB writers**: SGCServer writes the same economy file, hence `busy_timeout` and "try again".
- **One process**: everything assumes a single Node process (true today). The worker pool stays out of the Lumi games.
- **Big JS files**: `house.js` (659 KB) and `game.js` (203 KB) are served as-is with gzip, no build step.
- **Python tools**: the `python/make_lumi_*.py` asset generators come to `python/`. `lumi_pet_editor.py` imports mnemerynne, so it stays in erinne.
- **LUMI and the stock bugs**: LUMI must not list until fix-list #12 and #13 are done (Phase 0).

## 10. Decisions (Doll, 2026-11-19)

1. **Payouts**: lowering payouts is fine *if buy-ins drop with them, so playing stays profitable*. → Scale both by the same factor (default 0.2), with live player-return stats and an **admin page to control all of it** (§4).
2. **Money**: seeding from Central Bank is fine (250k). → **Lumi-Town Bank** is the main account. **Lumi Holdings Inc.** is a permanent stock that serves as its reserve capital. Themed accounts hold each category of sales. One pool of liquidity via a **sliding-scale sweep** and **emergency draws** (§3).
3. **Who can play**: keep the current setup (members of Doll's server).
4. **Assets**: from royalty-free sample packs Doll bought, so they're OK to serve.
5. **URL**: `https://sadgirlsclub.wtf/lumipet/`.
6. Everyone already has SGC, so there's no starting purse.

## 11. Docs to update as we go
- `README.md`: a Lumi-Town section.
- `docs/LUMI_GAMES.md` (new): a player guide plus a handler guide (admin page, sweep, emergency draws, seeding, LUMI).
- `docs/SADGIRLCOIN_USER_README.md` and `docs/SADGIRLCOIN_API.md`: the 8 Lumi accounts, the `lumi_*` ledger types and LUMI.
- `docs/LUMI_USER_COMMANDS*.md` if a `/lumi pet` command lands.
- New diagrams: `docs/16-lumi-town-money.mmd` (the flow in §3.2) and `docs/17-lumi-games.mmd`.
- `.env.example`: the `LUMI_*` keys.
