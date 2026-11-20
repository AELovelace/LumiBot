# Lumi-Town: handler guide

Lumi-Town is Lumi Pet and the Lumi minigames (ported from erinne) at **`/lumipet/`** on the Lumi Games server
(port 7172). Players log in with Discord (members of the server only). Every coin is real SadGirlCoin (SGC).
Developers: the internal API is `src/lumi/CONTRACT.md`; the plan is `docs/plans/lumi-games-port.md`.

Status (2026-11-19): **fully ported, waiting for Doll's test pass** (branch `feat/lumi-town`, from erinne `43a24f4`).
`npm test` runs 539 tests, including an end-to-end smoke (`tests/lumi/e2e_smoke.test.mjs`) that plays every game
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

**Not ported:** StickBob Runner and the casino (not Lumi games), erinne's TV, remote and couch modes, web push
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
- **Scale**: preview what every price becomes at a new global scale, then save.
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

Game code uses erinne's own numbers; Lumi-Town scales them: price = max(1, round(erinne price x scale x the
game's price multiplier)), prize = floor(erinne prize x scale x the game's payout multiplier), default scale 0.2
(arcade entry 25 -> 5 SGC). Free things stay free. Each game also has an on/off switch and a daily prize cap per
player, which is **0 = uncapped by default**; an admin sets a cap above 0 on `/lumi` for a game that gets farmed.
Pages show prices with the same formula, so shown = charged.

Global knobs are on the web panel's **Economy** settings page under **Lumi Games**: `lumi.scale`,
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
