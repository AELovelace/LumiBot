# Lumi-Town: handler guide

Lumi-Town is Lumi Pet and the Lumi minigames (ported from erinne) at **`/lumipet/`** on the Lumi Games server
(port 7172). Players log in with Discord (members of the server only). Every coin is real SadGirlCoin (SGC).
Developers: the internal API is `src/lumi/CONTRACT.md`; the plan is `docs/plans/lumi-games-port.md`.

Status (2026-11-19): **fully ported, waiting for Doll's test pass** (branch `feat/lumi-town`, from erinne `43a24f4`).
`npm test` runs 544 tests, including an end-to-end smoke (`tests/lumi/e2e_smoke.test.mjs`) that plays every game
through the real server with three fake players and checks every SGC move.

## The games

| Page (`/lumipet/<slug>`) | What | Server code |
|---|---|---|
| `lumi-pet` | Lumi Pet: care, snacks, toys, closet, capsules, her flat, room mode, moving boxes | `src/lumi/pet/` |
| `lumi-dungeons` | battles, skills, mods, dungeon trips (Sokoban, lights, runes...), tales, co-op parties of 3 | `src/lumi/dungeon/`, `src/lumi/party/` |
| `lumi-garden` | Lumi's Garden: plots, seeds, starpowder, the coin press | `src/lumi/garden/` |
| `lumi-town` | Lumi Town / Lumi City: walk about, local chat, emotes, visit flats, knock, guestbook, plots and real estate | `src/lumi/town/`, `src/lumi/city/` |
| `prism-drop`, `lumi-launch`, `lumi-soft` | minigames (the server rolls Prism; Launch and Soft are replayed with the page's own `rules.js`) | `src/lumi/minis/` |
| `teacup-tower`, `breakout` (Yarn Pop), `snake` (Lumi Conga) | arcade, solo runs and showdowns (race rooms with watcher bets) | `src/lumi/arcade/` |

**No hub:** `/lumipet/` goes straight to Lumi's house. Every game is reached from inside Lumi Pet: walk into Lumi Town
and use its buildings: the **Arcade** (Yarn Pop, Lumi Conga, Teacup Tower, Prism Drop, Lumi Launch), the
**Lumi-Soft field**, the **Tavern** (Dungeons), the **Garden gate**, the **Market**, the **Real-estate office**, and
**Lumi Heights** (flats). The **Casino** (Lumi's Lounge) opens LumiBot's own casino tables on the Lumi Games app
(`/games/slots`, `blackjack`, `holdem`, `horseracing`: Momiji Casino, its own Discord login). The **Retro café** is closed.
**Sign out** is the last row of the settings list in Lumi Pet (and in Dungeons and the Garden): choose it twice and it
POSTs `/lumipet/auth/logout` (ends the session, clears `lumi_sess`) and goes to the Sign in page.

### Decorating your plot (Lumi City)

Once you own a plot (buy one at the **Land for sale** counter in Lumi Realty, Downtown):

- **Decorate my house** 🎨 is on the lower bar anywhere out in Lumi City. It opens one list:
  - the **House** style (30 styles)
  - the five yard spots: fence, mailbox, path, lamp, ornament
  - the Keepsake Capsule.
- The same list is in the office too: Land for sale → **My plot** → **Decorate my house**.
- **Preview card** (added 2026-11-20): in the Realty lists, the highlighted row is drawn on your own plot in a card:
  - top-left on a wide screen, top-middle on a phone
  - for house styles, yard pieces (🔒 capsule-only ones too), land for sale (a new plot comes with the Starter
    Cottage) and neighbours' listings
  - the caption shows the price in SGC, "Yours", or the capsule rarity
  - looking never buys anything.
- Buying still asks twice: highlight, Enter ("Buy … for N SGC? Choose it again."), Enter again. Things you own go up
  with one Enter, and a style or yard piece you buy is kept even if you sell the plot.
- **Back** and **Escape** go up one list (yard spot → decorate list → My plot → Land for sale), not all the way out.
- **Leaving a house** (yours or a friend's) puts you back on that plot's doorstep, and leaving a friend's flat puts you
  back in their hallway (fixed 2026-11-20: everyone used to land outside Lumi Heights West). The town page passes the
  way back in the address, `lumi-pet?at=house-<id>&back=plot-l-1-3`, because `G.store` notes are per page and Lumi
  Pet couldn't read the town's.
- Code: `public/lumi/lumi-pet/game.js` (`listRows` decorate/styles/yard-slot, `drawEstatePreview`), the card's markup
  in `src/lumi/views/lumi-pet.js`, its style at the end of `game.css`, drawings in `estate-art.js`.

**Not ported:** StickBob Runner and erinne's casino (LumiBot's casino is used instead), erinne's TV, remote and couch modes, web push
reminders (planned as Discord DMs later), and the live AI storyteller (the tales library tells the stories).

## The admin page: `/lumi` on the web panel

Open the web panel (admins only) and click **Lumi-Town**. Everything there is logged in the **Admin log** with who did it.

- **Treasury**:
  - Shows the Bank, Holdings and LUMI cards, and every account's balance with 24 h / 7 d in and out.
  - Lists emergency draws and owed prizes.
  - Shows red banners when payouts are paused or prizes are owed.
- **Game knobs**: one row per game:
  - on/off, price ×, payout ×, daily cap (0 = no cap)
  - live stats: spends, SGC in/out, **player return %**, house net
  - A badge says **not profitable to play** (players get back < 100%), **printing** (> 200%), or **ok**.
- **Overrides**: an exact SGC price or prize for one item (JSON per game).
- **Scales**: the **play scale** (entries, continues, bets and every prize) and the **item scale** (every shop item,
  and capsule buybacks / move-in refunds). Preview both (items and play rows are grouped), then save; each change is
  logged. Each game row also shows its keys as `native→SGC` with `(play)`, `(item)`, `(prize)` or `(item value)`.
- **Policy**: bank target and ceiling, sweep bands, sweep interval, refill buffer, reserve floor, LUMI dividend rate.
- **Actions**:
  - Sweep now, Pay owed now, and **Pause all payouts** (games keep running; prizes are owed until resumed).
  - **Seed** from Central Bank, and move SGC between Lumi accounts.
  - Rename the themed shops and choose which games feed which shop.

If a game gets farmed, set a daily cap above 0 on its row, or lower its payout ×.

## Turning it on

1. `.env`: `GAME_WEB_ENABLED=true`, `LUMI_WEB_ENABLED=true`, and `LUMI_DISCORD_OAUTH_REDIRECT_URI` (production:
   `https://sadgirlsclub.wtf/lumipet/auth/discord/callback`). Add that same URL to the Discord app's redirect list.
2. For local testing over plain http set `LUMI_SESSION_SECURE=false` (otherwise the login cookie needs https).
3. nginx: proxy `/lumipet/` to the Lumi Games server (plan section 8), with buffering off for `.../stream` URLs.

## Where the money goes

```
player --buys--> a themed shop account --15-min sweep--> Lumi-Town Bank --prizes--> player
                                                     bank above its ceiling --> Lumi Holdings Inc. (the reserve)
                         bank short of a prize? --> emergency draw: shops (richest first), then Holdings above its floor
```

| Account | Name | Takes money from |
|---|---|---|
| `__LUMI_TOWN_BANK__` | Lumi-Town Bank | pays every prize, reward and refund |
| `__LUMI_HOLDINGS__` | Lumi Holdings Inc. | the reserve; the LUMI stock's treasury |
| `__LUMI_SNACKS__` | Lumi's Snack Stand | pet snacks and toys |
| `__LUMI_BOUTIQUE__` | Lumi's Boutique | decor, wear, house things |
| `__LUMI_CAPSULES__` | Moon Capsule Co. | capsules and moon capsules |
| `__LUMI_OUTFITTERS__` | Dungeon Outfitters | dungeon/battle shop |
| `__LUMI_NURSERY__` | Starpowder Nursery | garden plots and seeds |
| `__LUMI_ARCADE__` | Lumi Arcade | minigame entries, continues, showdown bets |
| `__LUMI_REALTY__` | Lumi City Realty | plots, house styles, yard pieces, estate capsules |

These are system accounts: hidden from the leaderboard, never win the weekly lottery, never taxed.
Nothing is ever minted: the only new money is the one-time seed from Central Bank and LUMI share purchases.

**The sweep** (every `lumi.treasury.sweepIntervalMs`, default 15 min): bank health = bank / target
(`lumi.treasury.bankTarget`, 100,000). Each shop gives the bank: under 25% health 100%, 25-50% 75%,
50-100% 50%, 100-150% 25%, 150%+ 10% (`lumi.treasury.bands`). Above the ceiling (`bankCeiling`, 200,000) the
bank overflows into Lumi Holdings. Then owed prizes are paid, oldest first.

**Owed prizes**: when the whole pool can't pay a prize (or payouts are paused), the prize is saved in `lumi_owed`
and paid automatically by a later sweep. LUMI dividends wait while anything is owed.

**Lumi Holdings / LUMI**: always listed on Doll Street. Buying LUMI adds to the reserve (minus Doll Street's 5%).
Sells and dividends never take the reserve under `lumi.treasury.reserveFloor` (50,000); a sale that would is
refused ("LUMI is illiquid right now"). Dividends: `lumi.treasury.lumiDividendRate` (2%) of the reserve above the
floor, weekly.

## Prices and prizes

Game code uses erinne's own numbers; Lumi-Town scales them with **two scales**:

| Scale | Setting (default) | Prices it sets | Payouts it sets |
|---|---|---|---|
| **Play scale** | `lumi.scale` (0.2) | a go at a game: the tuning keys `entry`, `continue`, `bet` | every prize: `win`, `betwin`, `press`, `token`, `visit`, `housewarm` ... |
| **Item scale** | `lumi.itemScale` (1) | every other price key: pet snacks, toys, decor, wear, both capsules, city plots, styles, yard pieces, the Keepsake Capsule, battle respec, potions, heals, stat resets, mods, kit, garden plots and seeds | `buyback` and `movein` (they give an item's value back) |

price = max(1, round(erinne price x bucket scale x the game's price multiplier)), prize = floor(erinne prize x
bucket scale x the game's payout multiplier). The bucket comes from the tuning **key** the game passes (an item's
own id for shop items), so the page's `LumiPrice` / `LumiPayout` pick the same scale as the server. Free things
stay free; an exact per-item override on `/lumi` still beats the formula. Lumi City's office sale is already exact
SGC and is not scaled at all.

Why two (Doll, 2026-11-19): players already earn 15 SGC an hour in voice chat, so **items keep erinne's prices**;
play costs and prizes stay scaled together so the minigames stay profitable to play.

Examples at the defaults:

| Thing | erinne price | SGC |
|---|---|---|
| a cookie (snack) | 8 | 8 |
| Star Capsule / Moon Capsule | 150 / 300 | 150 / 300 |
| a battle potion | 20 | 20 |
| a Lumi City plot (LefTown block 1, lot 1) | 6,000 | 6,000 |
| arcade entry / Lumi-Soft first continue | 25 / 50 | 5 / 10 |
| daily visit prize | 25 | 5 |

Each game also has an on/off switch and a daily prize cap per player, which is **0 = uncapped by default**; an
admin sets a cap above 0 on `/lumi` for a game that gets farmed. Pages show prices with the same formula, so
shown = charged.

Global knobs are on the web panel's **Economy** settings page under **Lumi Games**: `lumi.scale` (Play scale),
`lumi.itemScale` (Item scale),
`lumi.treasury.*` (target, ceiling, bands JSON, sweep interval, refill buffer, reserve floor, LUMI dividend rate,
pause all payouts `true`/`false`) and the seed split. Per-game knobs (`setting.lumi.game.<game>.*`) and the
treasury dashboard are on the `/lumi` admin page (above).

## Seeding (once)

The plan's seed is 250,000 SGC from Central Bank: 100,000 to the bank, 150,000 to Holdings (split in the
`lumi.seed.*` settings). The `/lumi` admin page's **Seed** button calls `treasury.seed(total, toBank, toHoldings)`,
which checks Central Bank's balance first, logs who did it, and refuses to run a second time. Until someone
presses it, the games simply owe their prizes (nothing is lost) and shops still collect, so **seed right after the
first deploy**.

## Ledger types (transactions.type)

`lumi_<game>_<kind>` for every spend and prize (e.g. `lumi_pet_snacks`, `lumi_prism_win`), `lumi_<game>_refund`,
`lumi_sweep`, `lumi_overflow`, `lumi_owed_paid`, `lumi_emergency_draw`, `lumi_seed`, `lumi_admin_move`,
`lumi_share_buy`, `lumi_share_sell`, `lumi_dividend`.
