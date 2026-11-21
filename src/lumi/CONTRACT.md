# Lumi-Town internal contract (src/lumi)

This is the stable API that every Lumi game module builds on. It is the reference for the agents (and humans)
porting erinne's games (`C:\scripts\erinne`, commit **43a24f4**; it was 0ddc466 until 43a24f4's front-end-only
"Lumi City: the top and bottom bars everywhere" was merged by hand into `public/lumi/lumi-pet/`) into LumiBot. The plan is
`docs/plans/lumi-games-port.md`; this file wins where they differ in detail.

**Golden rules**

1. Game code never touches SadGirlCoin directly. All coins go through `src/lumi/sgc.js`, inside `db.tx()`.
2. Pass erinne's **native** amounts to `sgc` (the numbers erinne's Python used). `tuning.js` scales them.
3. User ids are Discord id **strings** everywhere: arguments, table columns, and inside JSON saves.
4. "Today" is the Los Angeles day: `db.dayKey()`. Never `new Date().toISOString().slice(0, 10)`.
5. Only ADD files: `src/lumi/routes/<game>.js`, `src/lumi/views/<game>.js`, `src/lumi/<game>/*.js`,
   `tests/lumi/<game>*.test.mjs`. Change a core file only if this contract cannot do what you need, and say so.
6. Code style (owner's rule, mandatory): every line you write gets a short trailing `//` comment saying what it
   does. The human handler is not a strong coder. Python scripts go in `/python/`, PowerShell in `/ps/`.

---

## 1. Layout

```
src/lumi/
  index.js        initLumiGames(), stopLumiGames(), handleLumiRequest(), isLumiPath(), getRouter()
  db.js           getDb, tx, inTransaction, nowMs, dayKey, setClock, parseJson
  errors.js       LumiError + badRequest/unauthorized/forbidden/notFound/conflict/gone/tooMany/notEnoughSGC
  schema.js       every lumi_* table (createLumiSchema), DEFAULT_CATEGORIES, LUMI_TABLES
  tuning.js       prices, prizes, caps, treasury knobs (define, scalePrice, scalePayout, cap, enabled ...)
  treasury.js     categories, sweep, emergency draws, owed prizes, seed, status, scheduler
  sgc.js          spend / pay / refund / balance / inGame  <- THE ONLY DOOR TO COINS
  events.js       publish / subscribe / sse (erinne's SSE wire format)
  auth.js         /lumipet login (cookie lumi_sess), requireUser(ctx), currentUser(req)
  users.js        remember / displayName / avatarUrl
  router.js       createRouter (route table, auth, same-origin, JSON body, money lock, rate limit)
  static.js       /lumipet/static/** from public/lumi
  pages.js        page shell + registerPage (no hub: /lumipet/ redirects to /lumipet/lumi-pet)
  games.js        default tuning ids (defineDefaults)
  pet/save.js     Lumi Pet's save model (fresh, load, save, peek, look, placed, catalogs ...)
  routes/*.js     API modules: each exports register(router)       <- game agents add files here
  views/*.js      page modules: each exports register(pages)       <- game agents add/own files here
  data/           erinne lumipet_data/** + lumisoft_data/stages.json (stages.json sits next to the others)
public/lumi/      erinne web/static/games/{common.js, common.css, gamepad.js, lumi-pet, lumi-launch, lumi-soft,
                  prism-drop, teacup-tower, breakout, snake, arcade} + icons/lumi* + LumiBot's lumi-boot.js,
                  lumi-tuning.js, theme.css, hub.css (login page styles)
tests/lumi/       erinne's JS tests (paths fixed) + sgc/treasury/lumi_stock/lumi_save/lumi_web tests + lumi_env.mjs
```

URLs (base `LUMI_WEB_BASE_PATH`, default `/lumipet`):

| URL | What |
|---|---|
| `/lumipet/` | 302 to `/lumipet/lumi-pet`, her house. There is no games hub (Doll, 2026-11-19): every game is reached from inside Lumi Pet through Lumi Town's buildings (Arcade, Lumi-Soft field, Tavern, Garden gate, Market, Casino) |
| `/lumipet/<slug>` | a registered page (login needed; logged out -> 302 to `/lumipet/login?next=...`) |
| `/lumipet/api/...` | JSON API (routes/*.js) |
| `/lumipet/static/...` | files in `public/lumi` |
| `/lumipet/login`, `/lumipet/auth/discord/login`, `/lumipet/auth/discord/callback`, `POST /lumipet/auth/logout` | login |

### Ids: three different names per game

| Game | page slug (`/lumipet/<slug>`, `data-game`) | aliases | API prefix (front-end `LUMI_API + ...`) | tuning / ledger id |
|---|---|---|---|---|
| Lumi Pet | `lumi-pet` | `pet` | `/api/lumi-pet/...` | `pet` |
| Lumi Dungeons | `lumi-dungeons` | `dungeons` | `/api/lumi-pet/...` (shared kit) | `battle`, `dungeon`, `party` |
| Lumi's Garden | `lumi-garden` | `garden` | `/api/lumi-pet/garden` | `garden` |
| Lumi City / town | `lumi-town` (no hub card) | `town`, `city` | `/api/lumi-pet/town...`, `/city`, `/estate`, `/heights/...`, `/houses/...` | `city` (real estate), `pet` (housewarming) |
| Prism Drop | `prism-drop` | | `/api/prism-drop/...` | `prism` |
| Lumi Launch | `lumi-launch` | `launch` | `/api/lumi-launch/...` | `launch` |
| Lumi-Soft | `lumi-soft` | `soft` | `/api/lumi-soft/...` | `soft` |
| Yarn Pop | `breakout` | `yarn-pop` | `/api/breakout/run`, `/run/finish`, `/tables...` | `breakout` |
| Lumi Conga | `snake` | `lumi-conga` | `/api/snake/...` | `snake` |
| Teacup Tower | `teacup-tower` | | `/api/teacup-tower/...` | `teacup-tower` |

Page slugs are erinne's slugs on purpose: the copied JS opens other games with `window.LUMI_PAGES + slug`
(e.g. Lumi City's arcade doors), so they must match. The plan's short names are aliases (302 redirects).
API paths are exactly erinne's `/api/media/games/<x>` paths with that prefix replaced by `/lumipet/api/`.

---

## 2. db.js

```js
const { getDb, tx, inTransaction, nowMs, dayKey, setClock, parseJson } = require('../db'); // from src/lumi/<dir>/
getDb()            // better-sqlite3 handle of the ECONOMY database (all lumi_* tables live there). Throws if not open.
tx(fn)             // run fn() in ONE transaction, return its result; throw -> everything rolls back.
                   // fn must be synchronous (no await inside). Nested tx() = savepoint of the outer one.
inTransaction()    // true while a transaction is open
nowMs()            // Date.now(), but tests can fake it with setClock(fn); setClock(null) restores
dayKey(ts?)        // 'YYYY-MM-DD' in America/Los_Angeles (default: now)
parseJson(text, fallback)  // JSON.parse that returns fallback for NULL/broken text
```

`busy_timeout` is 5000 ms (SGCServer writes the same file). A leftover `SQLITE_BUSY` becomes HTTP 503 `try_again`.

## 3. errors.js

```js
const { LumiError, badRequest, unauthorized, forbidden, notFound, conflict, gone, tooMany, notEnoughSGC } = require('../errors');
new LumiError(status, code, message, extra = {})
badRequest(message?, code = 'bad_request', extra?)   // 400
unauthorized(message?, code = 'login_required', extra?) // 401
forbidden(message?, code = 'forbidden', extra?)      // 403
notFound(message?, code = 'not_found', extra?)       // 404
conflict(message?, code = 'conflict', extra?)        // 409
gone(message?, code = 'gone', extra?)                // 410
tooMany(message?, code = 'slow_down', extra?)        // 429
notEnoughSGC(need, have, message?)                   // 402, code 'not_enough_sgc', extra { need, have }
```

Throw them from handlers. The router answers `status` with JSON `{ ...extra, error: message, detail: message, code }`.
`detail` is what erinne's `common.js api()` shows; LumiBot's `common.js` also sets `failure.code` and
`failure.data` (the whole body). Port erinne's `PetError`/`Refused`/`HTTPException(409, "...")` as LumiErrors with
the same status and message. Anything that is not a LumiError is a bug: logged with its stack, answered 500.

## 4. Tables (schema.js)

All created at start with `CREATE TABLE IF NOT EXISTS` in the economy DB. Use these exact names.

| Table | Columns (erinne source) | Owner |
|---|---|---|
| `lumi_pets` | `user_id TEXT PK, data TEXT (JSON), updated_at` (0001) | pet (via `pet/save.js`) |
| `lumi_gardens` | `user_id TEXT PK, state TEXT, updated_at` | garden |
| `lumi_runs` | `user_id TEXT PK, state TEXT, updated_at` (dungeon runs) | dungeon |
| `lumi_battles` | `id PK AUTOINCREMENT, user_id TEXT, state, turn, status, created_at INT ms`; unique active per user | battle |
| `lumi_parties` | `code TEXT PK, state TEXT, updated_at REAL` | party |
| `lumi_party_members` | `user_id TEXT PK, code -> lumi_parties ON DELETE CASCADE` | party |
| `lumi_arcade_rooms` | `code PK, game, state, updated_at REAL` (was arcade_rooms) | arcade/showdown |
| `lumi_arcade_runs` | `id PK, user_id TEXT, game, seed, room, started_at REAL, finished` (was arcade_runs) | arcade |
| `lumi_prism_runs` | `user_id TEXT PK, drops, score, updated_at` (was prism_runs) | prism |
| `lumi_soft_progress` | `user_id TEXT PK, data` (was lumisoft_progress) | soft |
| `lumi_soft_bests` | `user_id TEXT, board, score, rank, at REAL, PK(user_id, board)` (was lumisoft_bests) | soft |
| `lumi_soft_runs` | `id PK, user_id TEXT, mode, stage, day, practice, started_at REAL, continues, finished` (was lumisoft_runs) | soft |
| `lumi_launch_runs` | `id PK, user_id TEXT, seed, started_at REAL, finished, score, paid` (0002) | launch |
| `lumi_launch_bests` | `user_id TEXT PK, best_go, best_shot, at REAL` (0002) | launch |
| `lumi_city_towns` | `town PK ('left'/'right'), blocks` (0003) | city |
| `lumi_plots` | `town, block, lot, user_id TEXT, style, yard, paid, bought_at, list_price, listed_at, version`; one per user (0003) | city |
| `lumi_flats` | `n INTEGER PK AUTOINCREMENT, user_id TEXT UNIQUE`: Lumi Heights flat numbers, in the order players first got a Lumi (never renumbered; made by `lumicity.init()`) | city / pet |
| `lumi_coin_refs` | `ref TEXT PK, user_id, amount, at` - pay-once refs | sgc |
| `lumi_daily` | `user_id, game, day, earned, PK(user_id, game, day)` - daily caps | sgc |
| `lumi_owed` | `id PK, user_id, username, amount, game, kind, ref UNIQUE, at` - prizes waiting for money | sgc/treasury |
| `lumi_accounts` | `category PK, account_id, display_name, games_json` | treasury |
| `lumi_admin_log` | `id PK, who, key, old, new, at` | tuning/treasury/admin page |
| `lumi_users` | `user_id PK, name, avatar, updated_at` | users.js |

Dropped from erinne: `coin_accounts`, `coin_transactions` (SGC `accounts`/`transactions` replace them),
`lumi_push_events`, `push_subscriptions`, `casino_rooms`, `runner_runs`.
`lumi_plots.paid` and any other stored price: store the **SGC actually charged** (what `spend` returned).
Need a new table? Create it in your own module's init with `CREATE TABLE IF NOT EXISTS lumi_<name>` (call it from
your `register()`), and add it to the table above in your report.

## 5. sgc.js - the only door to coins

```js
const sgc = require('../sgc');
sgc.spend(uid, username, native, game, kind, { key, note } = {})            // -> SGC charged (number)
sgc.pay(uid, username, native, game, kind, ref, { key, note, cap = true, exact = false } = {}) // -> { paid, owed, capped, duplicate? }
sgc.refund(uid, username, scaledAmount, game, ref, { kind = 'refund', note } = {}) // -> { refunded, owed, duplicate? }
sgc.transfer(fromUid, fromName, toUid, toName, amount, game, kind, ref)      // player -> player, EXACT SGC -> { moved, duplicate? }
sgc.balance(uid)                                                            // -> SGC balance (safe outside tx)
sgc.inGame(fn)                                                              // = db.tx(fn)
```

* **All of spend/pay/refund must run inside `db.tx()`** together with the game change they belong to (they throw
  `"must be called inside db.tx"` otherwise). Example:

  ```js
  const charged = db.tx(() => {                                    // one transaction: game row + coins
    const pet = save.load(ctx.user.id);                            // read + catch up
    const paid = sgc.spend(ctx.user.id, ctx.user.name, item.price, 'pet', 'snacks', { key: item.id }); // charge (throws 402)
    pet.inventory[item.id] = (pet.inventory[item.id] || 0) + 1;    // the game change
    save.save(ctx.user.id, pet);                                   // write it
    return paid;                                                   // SGC charged
  });
  ```
* `uid` is the Discord id string (`ctx.user.id`); `username` is `ctx.user.name`.
* `game` and `kind` are lowercase `[a-z0-9-]`. Ledger type = `lumi_${game}_${kind}` (refunds: `lumi_${game}_refund`).
* `key` = the tuning override key (default: `kind`). Use the item id for shop items (`{ key: item.id }`) so admins
  can override single prices; use `'entry'`, `'continue'`, `'win'` etc. for minigames.
* **The key also picks the scale** (section 6, Doll 2026-11-19): spend keys `entry`, `continue`, `bet` use the
  **play scale** (`lumi.scale`, 0.2); every other spend key is an **item** and uses the **item scale**
  (`lumi.itemScale`, 1 = erinne's own price). Pay keys `buyback`, `movein` give an item's value back and use the
  item scale; every other pay key is a **prize** on the play scale. So never pass `'entry'`/`'continue'`/`'bet'` as
  the key of a shop item, and never pay a prize under `buyback`/`movein` (or the other way round).
* **spend**: `native` 0 -> returns 0, nothing moves (free stays free). Moves player -> the category account
  (`treasury.categoryAccount(game, kind)`). Throws `LumiError 402 not_enough_sgc {need, have}` (so your tx rolls
  back) or `403 game_off` when an admin switched the game off.
* **pay**: pays from Lumi-Town Bank. Never throws for money reasons. Steps: duplicate `ref` -> `{paid:0, owed:0,
  capped:false, duplicate:true}`; scale with `scalePayout`; daily cap (`tuning.cap(game)`, SGC per player per game
  per LA day; **default 0 = uncapped** (Doll's call), an admin can set a cap per game on `/lumi`; skip it with
  `{cap:false}`); the ref is claimed even when the amount is 0; payouts paused or the whole pool can't cover it ->
  written to `lumi_owed` and `{paid:0, owed:n}`; otherwise an emergency draw if needed and `{paid:n, owed:0}`. When
  `owed > 0` tell the player: "Lumi-Town Bank is closed for a moment, your prize is saved." When `capped` tell them
  they hit today's limit.
* **pay `{ exact: true }`**: `native` is ALREADY whole SGC (e.g. a price stored in SGC, like Lumi City's office
  buyback of a plot): no scaling and no override key; everything else (ref, cap unless `cap:false`, owed) as above.
* **refund**: gives back an exact earlier charge (the number `spend` returned), once per `ref`, from the category
  account it went to (`opts.kind` = the original spend's kind for the lookup), topping up from the bank if the shop
  was swept since; anything uncoverable is owed (ref `${ref}:rest`). No scaling, no cap.
* **transfer**: one player pays another an EXACT whole-SGC amount (erinne `coins.transfer`: Lumi City plot listings).
  Strict and fee-free (`moveCoins`, never `transferCoins` with its 1% fee); no scaling, no cap; nothing goes through
  the treasury. Pay-once by `ref` (`{moved:0, duplicate:true}` the second time). Throws `402 not_enough_sgc`,
  `400 self_trade` or `403 game_off`. Ledger type `lumi_${game}_${kind}` (e.g. `lumi_city_trade`).

### Ref naming (plan section 3.8; refs are 1-200 printable ASCII, no spaces)

| What | game, kind | ref |
|---|---|---|
| daily visit | `pet, visit` | `lumi-pet:{uid}:{dayKey()}` |
| housewarming | `pet, housewarm` | `lumi-housewarm:{me}:{host}:{dayKey()}` |
| move-in refund | `pet, movein` (`cap:false`) | `lumi-move-in:{uid}` |
| capsule duplicate buyback | `pet, buyback` | `lumi-buyback:{uid}:{roll}` |
| battle win | `battle, win` | `lumi-battle:{battle id}` |
| dungeon satchel | `dungeon, win` | `lumi-run:{uid}:{run}` |
| party satchel | `party, win` | `lumi-party:{code}:{run}:{uid}` |
| garden press | `garden, press` | `lumi-garden:{uid}:{press coins ever made}` (see the press carry below) |
| garden token gift | `garden, token` | `lumi-garden-token:{uid}:{now}` |
| Prism Drop | `prism, win` | `lumi-prism:{run}` |
| Lumi Launch | `launch, win` | `lumi-launch:{run}` |
| Lumi-Soft | `soft, win` | `lumi-soft:{run}` |
| arcade solo (and a racer's own score) | `{slug}, win` | `{slug}:{run}` |
| showdown bet given back (no winner / left) | `{slug}, refund` (`refund`, kind `bet`) | `{slug}:{code}:{betId}:back` |
| showdown winning bet: the stake back | `{slug}, refund` (`refund`, kind `bet`) | `{slug}:{code}:{betId}:stake` |
| showdown winning bet: as much again | `{slug}, betwin` | `{slug}:{code}:{betId}:win` |
| Lumi City sale to the office | `city, sale` (`exact:true, cap:false`) | `lumi-city:{town}:{block}:{lot}:{bought_at}` |
| Lumi City plot bought from a listing | `city, trade` (`sgc.transfer`, buyer -> seller) | `lumi-plot:{plot}:{bought_at}:{version}` |
| Lumi City Keepsake repeat buyback | `city, buyback` (`cap:false`) | `lumi-city-buyback:{uid}:{random}` |
| Discord run-once guard (not a payout: amount 0) | `runPetAction(..., { onceRef })` | `lumi-discord:{interaction id}` |

Spends with `kind`: `pet,snacks` (snacks + toys), `pet,boutique` (decor, wear, house things), `pet,capsule`
(both capsules), `battle,shop` (respec, mods, potions, heals, reset, kit), `garden,shop` (plots, seeds),
`<arcade game>,entry` / `soft,continue`, `<slug>,bet` (showdown bets), `city,<plot|style|yard|capsule>`.

**Garden press carry.** A press makes erinne press coins (native). They wait in the garden save's `unpaid` until they
make at least one whole SGC: then the smallest native amount that scales to that whole SGC is paid
(`sgc.pay(..., 'garden', 'press', 'lumi-garden:{uid}:{paid}')`) and the rest stays in `unpaid` for the next press, so
no fraction of an SGC is ever lost to rounding (src/lumi/garden/lumigarden.js `_payPress`).

## 6. tuning.js

```js
const tuning = require('../tuning');
tuning.define(game, { label, priceKeys, payoutKeys, defaults })  // register for the admin page (call at module load)
tuning.scalePrice(game, key, native)    // max(1, round(native * bucketScale(key) * priceMult)); native 0 -> 0; override wins
tuning.scalePayout(game, key, native)   // floor(native * bucketScale(key) * payoutMult) (may be 0); override wins
tuning.priceBucket(key)                 // 'play' for entry/continue/bet, else 'item'
tuning.payoutBucket(key)                // 'item' for buyback/movein, else 'play'
tuning.cap(game)                        // daily prize cap in SGC (default 0 = uncapped; admins can set a cap per game)
tuning.enabled(game)                    // admin on/off (spends refused while off)
tuning.gameSettings(game)               // { enabled, priceMult, payoutMult, dailyCap, priceOverrides, payoutOverrides }
tuning.scale()                          // play scale (default 0.2): play prices + prizes
tuning.itemScale()                      // item scale (default 1): item prices + buyback/movein
tuning.treasuryPolicy()                 // { bankTarget, bankCeiling, bands, sweepIntervalMs, refillBufferPct,
                                        //   reserveFloor, lumiDividendRate, payoutsPaused }
tuning.clientTuning()                   // what the page shell injects as window.LUMI_TUNING
tuning.set(key, value, who)             // a global 'lumi.*' key from panelSettings SCHEMA (logged)
tuning.setGame(game, knob, value, who)  // knob: enabled|priceMult|payoutMult|dailyCap|priceOverrides|payoutOverrides (logged)
tuning.reload()                         // re-read now (the cache also refreshes itself every 5 s)
```

`define` example (erinne natives, for the admin preview; call it from your routes module):

```js
tuning.define('prism', { label: 'Prism Drop', payoutKeys: { win: null } });             // score / 10 per drop run
tuning.define('soft', { label: 'Lumi-Soft', priceKeys: { entry: 25, continue: 50 }, payoutKeys: { win: null },
  defaults: { dailyCap: 0 } });                                                         // per-game default (0 = uncapped)
```

**Two scales, chosen by the key** (Doll, 2026-11-19: players already earn 15 SGC/hour in voice chat, so items keep
erinne's prices; play costs and prizes stay scaled together so minigames stay profitable):

| Bucket | Scale (default) | Price keys | Payout keys |
|---|---|---|---|
| play | `lumi.scale` "Play scale" (0.2) | exactly `entry`, `continue`, `bet` | every key except the two below (`win`, `betwin`, `press`, `token`, `visit`, `housewarm` ...) |
| item | `lumi.itemScale` "Item scale" (1) | every other key (pet item ids, `capsule`, `moon`, city `plot` / style / yard ids / `capsule`, battle `respec` / `potion` / `heal` / `reset` / mod and kit ids, garden `plot` / flower ids) | exactly `buyback`, `movein` |

`pay({ exact: true })` (city `sale`) is never scaled. The rule is key-only on purpose: the page's `LumiPrice` /
`LumiPayout` know just game + key, and `clientTuning()` sends both scales (`{ scale, itemScale, games }`).

`games.js` already defines every id in section 1; redefining replaces the entry. Storage: system_state rows
`setting.lumi.scale`, `setting.lumi.itemScale`, `setting.lumi.treasury.*`, `setting.lumi.seed.*` (shown on the web
panel's Economy settings page, category "Lumi Games") and `setting.lumi.game.<game>.<knob>` (the `/lumi` admin
page, which also edits both scales with a preview). Defaults: play scale 0.2, item scale 1, priceMult 1, payoutMult 1, **dailyCap 0 = uncapped** (Doll, 2026-11-19: every game is uncapped by default; an admin
sets a cap above 0 per game on `/lumi` when abuse shows up), enabled true. erinne's own once-a-day rules are not caps
and stay (the daily visit prize, house-warming gifts from at most 3 homes a day).

**Client side**: every page has `window.LumiPrice(game, key, native)`, `window.LumiPayout(game, key, native)`,
`window.LumiCap(game)`, `window.LumiGameOn(game)` (public/lumi/lumi-tuning.js, same formula, fed by
`window.LUMI_TUNING`). Patch any hard-coded price/prize text in your game's JS to use them, with the same `game`
and `key` the server passes to `sgc`, so the shown price IS the charged price. Server-rendered text can use
`h.price(game, key, native)` in a view. Also rename visible "coins" to "SGC" in your game's JS.

## 7. treasury.js (game code rarely needs it)

```js
treasury.categoryAccount(game, kind) // -> { category, accountId, displayName } ("game:kind" first, then "game";
                                     //    unmapped -> Lumi-Town Bank, logged once)
treasury.categories() / setCategory(category, { displayName, games }, who)
treasury.sweep(who = 'scheduler')    // one transaction: band tax shops -> bank ('lumi_sweep'), overflow -> Holdings
                                     // ('lumi_overflow'), owed prizes oldest-first ('lumi_owed_paid'); logs itself
treasury.ensureCovers(amount)        // emergency draw INSIDE the caller's tx: shops richest first until shortfall +
                                     // refill buffer, then Holdings down to its floor ('lumi_emergency_draw'); bool
treasury.payOwed() / payOwedNow(who = 'system')   // pay owed prizes (inside tx, not logged / own tx, logged)
treasury.seed(total, toBank, toHoldings, { who = 'system', force })  // one-time Central Bank seed ('lumi_seed'), checks CB first; logged
treasury.adminMove(fromId, toId, amount, who = 'system')             // between Lumi accounts ('lumi_admin_move'); logged
treasury.status()                    // everything the admin page shows (balances, health, rate, 24h/7d flows, draws, owed)
treasury.start() / stop()            // unref'd sweep scheduler (try/finally, always reschedules, in-flight guard)
treasury.health(), rateFor(health), BANK, HOLDINGS
```

**Audit log.** `sweep`, `payOwedNow`, `seed`, `adminMove` and `setCategory` each write their own ONE
`lumi_admin_log` row (keys `treasury.sweep`, `treasury.payOwed`, `treasury.seed`, `treasury.move`,
`category.<name>`) as the `who` they are given, inside the same transaction as the money. Callers never log these
again (the `/lumi` page passes the admin's name). The 15-minute scheduler calls `sweep('scheduler')`, which is only
logged when money actually moved, so the timer doesn't bury the admins' rows.

### Accounts and categories

| Account id | Name | Category (`lumi_accounts`) | Fed by (`games_json`) |
|---|---|---|---|
| `__LUMI_TOWN_BANK__` | Lumi-Town Bank | (bank: pays every prize) | |
| `__LUMI_HOLDINGS__` | Lumi Holdings Inc. | (reserve, LUMI's treasury) | |
| `__LUMI_SNACKS__` | Lumi's Snack Stand | `snacks` | `pet:snacks` |
| `__LUMI_BOUTIQUE__` | Lumi's Boutique | `boutique` | `pet:boutique` |
| `__LUMI_CAPSULES__` | Moon Capsule Co. | `capsules` | `pet:capsule` |
| `__LUMI_OUTFITTERS__` | Dungeon Outfitters | `outfitters` | `battle`, `dungeon`, `party` |
| `__LUMI_NURSERY__` | Starpowder Nursery | `nursery` | `garden` |
| `__LUMI_ARCADE__` | Lumi Arcade | `arcade` | `prism`, `launch`, `soft`, `breakout`, `snake`, `teacup-tower` |
| `__LUMI_REALTY__` | Lumi City Realty | `realty` | `city` |

All are `__*__` system accounts: hidden from leaderboards, skipped by the weekly lottery, exempt from monthly tax.
The store also exports `moveCoins(from, to, amount, type, note)` (strict, fee-free, throws `CoinMoveError` with
`code` / `need` / `have`) and `LUMI_*_USER_ID` constants - but games use `sgc`, not these.

### Lumi Holdings / LUMI (privateStockStore.js)

`ensureLumiHoldingsStock()` (run by `initLumiGames`) lists ticker `LUMI`, `entity_type 'lumi'`,
`guild_id '__LUMI_HOLDINGS__'`. Permanent (sync never delists it, no synthetic slot, listed right after guild
stocks); treasury = the real `__LUMI_HOLDINGS__` balance; price = reserve per share (neutral performance); buys
credit the net to Holdings (`lumi_share_buy`); sells (`lumi_share_sell`) and dividends (`lumi_dividend`) never take
it below `lumi.treasury.reserveFloor`; dividends = `lumiDividendRate` x the excess, divided by at least the
100-share reference float, skipped while `lumi_owed` has rows. The 24 h sell lock applies as for every stock.

## 8. Routes (router.js)

A route module:

```js
// src/lumi/routes/prism.js
'use strict';
const { tx } = require('../db');                       // transactions
const sgc = require('../sgc');                         // coins
const tuning = require('../tuning');                   // knobs
const { badRequest } = require('../errors');           // "no" answers

tuning.define('prism', { label: 'Prism Drop', payoutKeys: { win: null } }); // admin page entry

function register(router) {                            // index.js calls this once at start
  router.get('/api/prism-drop/run', (ctx) => ({ run: null }));                   // GET -> JSON 200
  router.post('/api/prism-drop/drop', (ctx) => {                                 // POST: same-origin + JSON body checked
    const pick = ctx.body.pick;                                                  // parsed JSON object
    if (!Number.isInteger(pick)) throw badRequest('Pick a pocket first.');       // -> 400 {error, detail, code}
    return tx(() => ({ ok: true }));                                             // game change + coins together
  }, { money: true });                                                           // one money action per player at a time
}
module.exports = { register };
```

* `router.route(method, pattern, handler, opts)`, plus `router.get` / `router.post`. Patterns are under the base
  path, with `:params` (decoded) and a trailing `*` (`ctx.params.rest`). First registered match wins; registering
  the same method+pattern twice throws. Page routes (`/` and `/:slug`) are registered after all modules.
* `ctx = { req, res, url, method, path, params, query, body, user, ip, json(status, body), html(status, html),
  redirect(location, status), streaming }`. `ctx.user = { id, name, avatar }` (auth on by default).
* Return a value -> JSON 200 (`undefined` -> `{ok:true}`). Or answer yourself with `ctx.json/html/redirect` or
  `events.sse()`. Async handlers are fine (but never `await` inside `tx()`).
* opts: `auth` (default true; logged out -> 401 JSON for `/api/*`, a login redirect for pages), `money` (default
  false: per-player in-flight lock from `locks.js`, a second concurrent call -> 409 `busy`; the Discord side takes
  the **same** lock, so a website call and a Discord button can't overlap either), `body` (default true: POST/PUT/PATCH
  bodies parsed as a JSON object, 16 KB cap, 400 `bad_json` / 413 `too_large`), `maxBody` (bytes, default 16 KB: a
  bigger cap for one route, e.g. `{ money: true, maxBody: 512 * 1024 }` for a finished run's log; used by
  `/api/lumi-soft/finish` 512 KB, `/api/lumi-launch/finish` 128 KB, `/api/<arcade slug>/run/finish` 1 MB),
  `raw` (handler owns `res` entirely). A body over the cap is answered 413 and the rest of the upload is drained
  (never `req.destroy()`), so the client really receives the 413. Never hand-roll a body reader: use `maxBody`.
* Every non-GET is checked same-origin (own host + `LUMI_TRUSTED_ORIGINS`) -> 403 `cross_site`.
* `/api/*` has a per-IP token bucket (`LUMI_API_RATE_PER_SEC`, `LUMI_API_RATE_BURST`) -> 429 `slow_down`.
* Core routes already exist (`routes/core.js`): `GET /api/coins` -> `{coins}`, `GET /api/me`,
  `GET /api/lumi-look` -> `look(uid)`, `GET /api/tuning`.

## 9. Live updates (events.js)

```js
const events = require('../events');
events.publish(channel, event, data)                 // fan out to every subscriber of channel
events.subscribe(channel, fn({ event, data }))       // -> unsubscribe()
events.sse(ctx, channel, { onOpen(stream), onClose(), filter(event, data, ctx), heartbeatMs })
  // -> stream { send(event, data, id?), comment(text), close(), closed }
```

Wire format = erinne's `rooms_bus.sse`: `": hello\n\n"` first, then `"event: <kind>\ndata: <json>\n\n"`, and
`": ping\n\n"` every 25 s. Headers include `X-Accel-Buffering: no`. `filter` is erinne's per-viewer `_relay`:
return `null`/`false` to skip, `true` to pass, or `[event, data]` to send something else. Use `onOpen` to send the
first state (erinne's party stream sends `party` first). Max 8 open streams per player (429). Suggested channels:
`'town'`, `` `party:${code}` ``, `` `arcade:${slug}:${code}` ``. Don't mark stream routes `money: true`.
Social state (town presence, knocks, showdown hubs) stays in-memory Maps with expiry sweeps, as in erinne.

## 10. Pages (pages.js) and views

```js
// src/lumi/views/<game>.js
function register(pages) {
  pages.registerPage({
    slug: 'prism-drop', title: 'Prism Drop',                     // URL + <title>
    kit: 'prism-drop',                                           // public/lumi folder (default: slug)
    css: ['common.css', 'prism-drop/game.css'],                  // in order (theme.css is always first)
    scripts: ['common.js', 'prism-drop/rules.js', 'lumi-pet/closet.js', 'arcade/lumi-sprite.js', 'prism-drop/game.js'], // EXACT load order
    card: { icon: '🔮', name: 'Prism Drop', description: '...', order: 10 },   // optional metadata (no hub shows it any more)
    aliases: ['prism'],                                          // 302 to the slug
    body: (h, page, { user }) => `<section>...${h.esc(text)}... ${h.price('prism', 'entry', 25)} SGC</section>`,
  });
}
module.exports = { register };
```

`h` = `{ esc, staticUrl(rel), rawStatic(rel), price(game, key, native), payout(...), sgc(n), base }`.
The shell renders `<main class="gm" id="gm" data-game data-kit data-name>`, loads `lumi-boot.js` and
`lumi-tuning.js` in `<head>`, then your scripts (versioned `?v=` URLs) after `<main>`. It contains NO inline
JavaScript (CSP `script-src 'self'`); never add inline `<script>` or `on*=` attributes. Globals available to every
script: `window.LUMI_API` (`/lumipet/api/`), `LUMI_STATIC`, `LUMI_PAGES` (`/lumipet/`), `LUMI_TUNING`,
`LUMI_USER` (`{id, name}`), `LUMI_FLAGS` (`{tvPlay:false, whoPlays:false, retro:false}` - erinne's TV-only modes
are off). Already registered (views/): `lumi-pet`, `lumi-dungeons`, `lumi-garden`, `lumi-town` (lumi-pet.js),
`prism-drop`, `lumi-launch`, `lumi-soft`, `breakout`, `snake`, `teacup-tower` - their owners may edit them.

Front-end edits already done in public/lumi: every `/api/media/games/` -> `window.LUMI_API`, page links
`/media/games/<slug>` -> `window.LUMI_PAGES + slug` (`/media`, retro -> the front door, i.e. her house; the Retro café says it's closed). The Casino's tables are `casino:<page>` slugs that `openApp` sends to LumiBot's own casino pages (`window.LUMI_CASINO`, i.e. `GAME_WEB_BASE_PATH`: slots, blackjack, holdem, horseracing), `common.js` posts nothing to a TV
frame, uses the `lumi-game:` localStorage prefix, reads errors' `detail`/`error`/`code`, and its coin chip calls
`/lumipet/api/coins`. Not done (per game): "coins" wording inside game JS, hard-coded prices in JS, TV/couch/
who's-playing code paths (flags are false, so they stay dormant), and lumi-pet/game.js's push + `/sw.js`
service-worker registration (fails quietly; push is Phase 7).

## 11. Auth and users

```js
const auth = require('../auth');   auth.requireUser(ctx) -> { id, name, avatar } (throws 401); auth.currentUser(req) -> user|null
const users = require('../users'); users.displayName(uid) -> 'Name' | 'Someone'; users.avatarUrl(uid, size); users.remember(...)
```

Cookie `lumi_sess` (Path=/lumipet, `LUMI_SESSION_SECURE`, `LUMI_SESSION_SAMESITE` default Lax), redirect URI
`LUMI_DISCORD_OAUTH_REDIRECT_URI`, member check identical to the games app (OAuth `mode=member`). Every request
also refreshes the player's SGC account name and `lumi_users` row, so `displayName` works for anyone who has
opened Lumi. erinne's `users.get_user_by_id(...)["display"]` -> `users.displayName(uid)`.

## 12. Pet save (pet/save.js)

```js
const save = require('../pet/save');
save.load(uid, { now, seen = true })  // INSIDE tx: fresh defaults under the stored save, erinne's migrations,
                                     // estateOf, advance hook, saved back; returns the live pet object
save.save(uid, pet)                  // erinne _save (upsert)
save.peek(uid) / exists(uid)         // read-only (null / false when no Lumi)
save.look(uid)                       // { glow, outfit, colour, name } for drawing her anywhere (read-only)
save.townSeen(uid), save.door(uid) -> { door, blocked: [ids as strings] }, save.guestbook(pet), save.boxes(pet)
save.fresh(now), freshEstate(), estateOf(pet), placed(pet), takes(spotId), shelf(prize), moveInWorth(pet)
save.CATALOG, HOUSE, CLOSET, BATTLE      // validated data (lumipet_data/*.json)
save.WEAR, DECOR, ITEMS, PRIZES, BOXES, SPOTS   // erinne _WEAR, _DECOR, _ITEMS, _PRIZES, BOXES, _SPOTS
save.GLOWS, RARITIES, KINDS, BOOSTS, DOORS, HOMES, NAME_RE, COLOUR_RE, MOVE_IN, START, HOUR, PetError ...
// hooks for the modules that own the rest of lumipet.py / lumibattle.py:
save.setAdvance(fn(pet, now))        // pet module: decay, naps, mending (erinne advance) - runs on every load
save.addFreshFields(fn() -> {})      // any module: default fields merged under every save
save.setSettlePoints(fn(pet))        // battle module: stat-points migration (erinne settle_points)
save.setMoveInRefund(fn(uid, pet, worthNative))  // pet module: pay the move-in refund (lumi-move-in ref, cap:false)
```

`fresh()` already includes erinne's `lumibattle.fresh_fields()` (moves from battle.json basics, 5 mod slots,
7 stat keys). erinne's `GAME = "lumi-pet"` ledger name is `pet` here.

Fights and dungeon trips have ONE code path: `pet/lumipet.js` exports erinne's `fightStart(uid, tier, now, rng, opts)`,
`fightAct(uid, battleId, turn, action, now, rng, { username })`, `_narrate(uid, rng)`, `dungeonStart(uid, env, now,
rng, opts)` and `dungeonAct(uid, action, { way, moves, picks, now, rng, username })`; `routes/dungeon.js` calls them
directly (PetError -> 400 via `routes/pet.js refusals`). The old `dungeon/play.js` hand-off is gone.

**Care actions and purchases have ONE entry: `pet/actions.js` `runPetAction(uid, username, input, { onceRef, lock })`.**
`POST /api/lumi-pet/act` and the Discord side both call it. It checks `input` against `ACT_FORM` (422 `invalid`),
runs `lumipet.act()` with the coins in one `tx()`, turns a PetError into a 400 `refused`, then tells the town (look
changed, guests sent home). `onceRef` (Discord: `lumi-discord:{interaction id}`) is claimed in `lumi_coin_refs` in the
same transaction: a second run is a 409 `already_done`, and a refused action rolls the claim back. `lock: true` takes
the `locks.js` money lock itself (Discord); the website route leaves it false because the router already holds it.
`refusals`, `named` and `ACT_FORM` live there too; `routes/pet.js` re-exports them.

## 12b. Discord side (src/lumi/discord) — docs/plans/lumi-town-discord.md

* `locks.js`: `take(uid)` / `release(uid)` / `isBusy(uid)` / `withUserLock(uid, fn)` / `busyError()`. One in-memory
  Set for the whole process (router + Discord).
* `discord/index.js`: `initLumiDiscord(client)` (after `initLumiGames()`, only if `isLumiReady()`),
  `stopLumiDiscord()`, `handleLumiInteraction(i)` (wired in `src/index.js` InteractionCreate). Pieces plug in with
  `registerHandler({ command: { name, data }, verbs, onCommand, onAutocomplete, onComponent(i, args) })`. It answers
  only registered slash commands and `lumipet:<verb>:...` customIds (`customId(verb, ...args)` builds one, 100-char
  max); everything else is ignored. A crash in a piece is logged and answered with one polite ephemeral message.
  `commandDefinitions()` is added to the global member command list in `controlPlane.js`.
* `discord/member.js`: `isClubMember(client, userId)`: is the user in `DISCORD_PANEL_GUILD_ID` (the same guild the
  website's login checks)? Cached 10 min for yes and 1 min for no; one lookup per user at a time; Discord errors
  throw and are not cached.
* `LUMI_DISCORD_ENABLED=false` switches all of it off (no commands registered, nothing answered). The website
  doesn't change.

## 13. Testing

* `npm test` = `node --test "tests/lumi/*.test.mjs"` (Node 24 does not accept a bare directory). Name files
  `tests/lumi/<something>.test.mjs`; helpers without `.test.` are not run.
* `tests/lumi/lumi_env.mjs`: `boot()` -> `{ eco, stock, lumi, db, sgc, tuning, treasury, errors }` on a fresh
  in-memory DB (each test file is its own process); `setBalance(eco, id, n)`; `resetLumi(eco)` empties the Lumi
  accounts, owed/refs/daily rows and lumi settings. Use Discord-shaped ids (`'123456789012345678'`).
* Fake the clock with `db.setClock(() => ms)` (restore with `null`). Fake a login over HTTP with
  `require('../../src/webPanelAuth.js').createSession(id, name, '', [])` -> cookie `lumi_sess=<encoded>` (set
  `WEB_PANEL_SESSION_SECRET` first); see `lumi_web.test.mjs` for a full HTTP harness and how to add a test route.
* Never open `data/*.sqlite3`. Never start the real bot.
* `tests/lumi/e2e_smoke.test.mjs` is the integration smoke: it boots the REAL `src/gameWebServer.js` on an in-memory
  DB, seeds the treasury, and plays every game over HTTP as three players, checking each SGC move lands in the right
  themed account (spends) or comes from Lumi-Town Bank (prizes), that every page's scripts/styles load, and that every
  API path the pages call is a route. Add a step there when you add a game or a cross-module hand-off.
