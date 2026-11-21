# Lumi Bot — Command Guide

Lumi is a Touhou-themed Discord bot with a full SadGirlCoin (**SGC**) economy, casino games, prediction markets, a stock exchange, a Touhou collection-and-battle minigame, a cigarette gacha, and an AI chatbot personality. Everything below is what a regular member can use. Admin/owner commands are not included.

Two ways to issue most commands:
- **Slash commands** like `/lumi-bank balance` (auto-completes; recommended).
- **Quick `!` shortcuts** like `!bank` (faster to type once you know them).

You can use either, the result is identical.

---

## 1. Earning SadGirlCoin (SGC)

You don't have to do anything special to start earning. Just **chat**.

- Every message you post is worth **1 SGC per ~50 characters**.
- Posting an **image** counts as +25 bonus characters; posting a **video** counts as +50 bonus characters.
- If you have an active **smoke boost** (see Cigarettes below), your character value is multiplied by 1.25x–3x.
- Joining a **voice channel** also accrues VC time on the leaderboard (and can grant rewards depending on server config).

Coins land in your bank automatically — check them with `/lumi-bank balance`.

---

## 2. Banking — `/lumi-bank` · `!bank`

Your wallet for SadGirlCoin.

| Command | What it does |
|---|---|
| `/lumi-bank balance` · `!bank` | Show your current SGC balance and the server's top 10. |
| `/lumi-bank send <user> <amount> [note]` · `!bank send @user <amount>` | Transfer SGC to another member. Optional note attached to the transaction. |
| `/lumi-bank raffle` · `!bank raffle` | Spend **50 SGC** to buy a yearly raffle ticket. The raffle pays out a large pot at year end. |

> `withdraw`, `give`, and `take` exist on the slash command but require special roles (Big Business / admin). Regular users can ignore them.

---

## 3. Voice-Channel Tracker — `/lumi-vc` · `!vc`

Tracks how long you spend in voice channels.

| Command | What it does |
|---|---|
| `/lumi-vc rank` · `!vc` or `!vc rank` | Top 20 members by total VC time. |
| `/lumi-vc me` · `!vc me` | Your own VC time (total, current session if connected). |

---

## 4. The Casino

All casino games take SGC bets. They're multiplayer — others can join your table mid-session.

### Pachinko — `/lumi-pachinko` · `!pachinko`

The simplest game. Drop a ball, bet on which **peg** (1–10) it lands on.

```
/lumi-pachinko peg:7 bet:25
!pachinko 7 25
```

Center pegs pay smaller multipliers; edge pegs pay big. Risk vs. reward.

### Slots — `/lumi-slots` · `!slots`

Classic 3-reel slot machine with a shared lobby. Multiple players can pull at the same machine.

| Command | What it does |
|---|---|
| `/lumi-slots start` · `!slots` | Open or join a slot machine in this channel. |
| `/lumi-slots leave` · `!slots leave` | Leave the machine. |

Bets and pulls happen via the embed buttons once the machine is open.

### Blackjack — `/lumi-blackjack` · `!blackjack` (alias `!bj`)

Multiplayer blackjack table. Dealer hits to 17. Splits, doubles, and insurance available via buttons.

| Command | What it does |
|---|---|
| `/lumi-blackjack play bet:<amount>` · `!blackjack <bet>` | Sit down (or join) the table with a starting bet. |
| `/lumi-blackjack bet amount:<n>` · `!bj bet <n>` | Change your bet for the next hand. |
| `/lumi-blackjack leave` · `!bj leave` | Leave the table. |

### Texas Hold'em — `/lumi-holdem` · `!holdem` (alias `!th`)

Full no-limit hold'em with shared community cards. The bot handles betting rounds, side pots, and showdowns.

| Command | What it does |
|---|---|
| `/lumi-holdem play bet:<ante>` · `!holdem <bet>` | Sit down with an ante. |
| `/lumi-holdem bet amount:<n>` · `!holdem bet <n>` | Set your ante for the next hand. |
| `/lumi-holdem raise amount:<n>` · `!holdem raise <n>` | Raise during your turn (custom amount). |
| `/lumi-holdem leave` · `!holdem leave` | Leave the table. |

### Horse Racing — `/lumi-horserace` · `!horseracing` (alias `!hr`)

Lobby-based horse race. Each entrant picks a horse, places a bet, and watches the simulated race play out in the channel.

| Command | What it does |
|---|---|
| `/lumi-horserace start` · `!hr` | Open or join a race lobby. |
| `/lumi-horserace leave` · `!hr leave` | Leave before the race starts. |

---

## 5. LumiBets — Prediction Markets — `/lumi-bets` · `!bets`

Server-run prediction markets. Mods open markets ("Will X happen by Friday?"), members buy shares of an outcome with SGC, and the winning side splits the pot when the market resolves.

| Command | What it does |
|---|---|
| `/lumi-bets list` · `!bets` | Show all open markets with current odds. |
| `/lumi-bets buy market:<id> option:<name-or-#> amount:<sgc>` · `!bets buy <market_id> <option> <amount>` | Buy into a market. The `option` is the side you think will win — either its name (e.g. `yes`) or its number from the list. |

Payouts are automatic when the market resolves. You'll see them in your bank history.

---

## 6. LumiStocks — Stock Exchange — `/lumi-stocks` · `!invest` (aliases `!stocks`, `!shares`, `!portfolio`)

A live stock exchange where each guild's "Big Business" account is a publicly traded company alongside synthetic stocks. Prices move based on activity, news events, and order flow.

| Command | What it does |
|---|---|
| `/lumi-stocks list` · `!invest` | List all listed tickers with current price and 24h change. |
| `/lumi-stocks portfolio` · `!portfolio` | Your holdings, average cost, and unrealized P/L. |
| `/lumi-stocks buy ticker:<sym> amount:<sgc>` · `!invest buy <ticker> <sgc>` | Buy shares of a ticker for the given SGC amount. |
| `/lumi-stocks sell ticker:<sym> shares:<n>` · `!invest sell <ticker> <shares>` | Sell `<shares>` of a ticker (fractional shares allowed). |
| `!invest info <ticker>` | Detail card for a ticker (price, supply, recent events). |
| `!invest offer <ticker>` | Show the current bid/ask spread. |

There's also a public **leaderboard / charts page** served by the bot — your server admin will share the URL if it's enabled.

---

## 7. Touhou Collector & Battler — `/lumi-touhou` · `!touhou` (alias `!2hu`)

Collect Touhou characters, trade them, fight them. Each Touhou has a rarity (Common → Uncommon → Rare → Epic → Legendary) and battle stats.

### Collecting

| Command | What it does |
|---|---|
| `/lumi-touhou adopt` · `!adopt` | Adopt a random Touhou for **25 SGC**. The rarer the pull, the better. |
| `/lumi-touhou collection [user]` · `!collection [@user]` | View your collection (or someone else's). |
| `/lumi-touhou info name:<name>` · `!touhou info <name>` | Show full stats and lore for any Touhou. |
| `/lumi-touhou search query:<q>` · `!touhou search <q>` | Search the catalogue by name/keyword. |
| `/lumi-touhou stats` · `!touhou stats` | Server-wide collection stats. |

### Trading & Marketplace

| Command | What it does |
|---|---|
| `/lumi-touhou send name:<name> user:@user` · `!touhou send <name> @user` | Gift one of your Touhous to a friend. |
| `/lumi-touhou trade yours:<a> user:@user theirs:<b>` · `!touhou trade <a> @user <b>` | Propose a 1-for-1 swap. The other person must accept. |
| `/lumi-touhou sell name:<name> price:<sgc>` · `!touhou sell <name> <price>` | List a Touhou on the server marketplace. |
| `!touhou delist <name>` | Pull your listing back off the market. |
| `/lumi-touhou buy name:<name>` · `!touhou buy <name>` | Buy a listed Touhou from the marketplace. |
| `/lumi-touhou market` · `!touhou market` | Browse the marketplace. |
| `/lumi-touhou listings [page]` · `!touhou listings [page]` | List every Touhou for sale in this server. |
| `!touhou buyback <name>` | Buy back a Touhou you previously sold (if still listed). |

### Battling

Touhous can fight each other for SGC. They take damage and need healing between fights.

| Command | What it does |
|---|---|
| `/lumi-touhou buy item:Health Potion amount:<n>` · `!touhou buy potion [n]` | Buy battle potions at **20 SGC each**. |
| `!touhou battle <name> <Common\|Uncommon\|Rare\|Epic\|Legendary\|gamble>` | Send your Touhou into a fight. The last argument picks the rarity tier of the opponent (or `gamble` for a random tier with a bigger payout). |
| `!touhou heal <name> [pay]` · `!touhou party` | Heal a wounded Touhou (auto-heals slowly; add `pay` to rush the heal for SGC). `party` shows your active battle squad. |

### Quick start: just type `!touhou`

Sending `!touhou` (or `/lumi-touhou menu`) with no arguments opens an **interactive menu** with buttons for everything above — by far the easiest way to get started.

---

## 8. Cigarettes & Smoke Boosts — `/lumi-cigarette` · `!cigarette` (aliases `!cigs`, `!cig`)

A cigarette gacha. Pulls are cheap, and smoking the rare ones temporarily multiplies your chat earnings.

| Command | What it does |
|---|---|
| `/lumi-cigarette gacha` · `!cig gacha` (or `pull`, `dispense`) | Pull one random cigarette for **1 SGC**. |
| `/lumi-cigarette case [user]` · `!cig` (or `!cig @user`) | View your case (or someone else's). Each cigarette has a slot number. |
| `/lumi-cigarette leaderboard` · `!cig lb` | Top cigarette smokers in the server. |
| `/lumi-cigarette smoke slot:<n>` · `!smoke <n>` | Smoke the cigarette in slot `<n>`. Grants a **5-minute boost** of 1.25x – 3x to all SGC you earn from messages, scaling with rarity. |
| `/lumi-cigarette buff` · `!smokebuff` (or `!sb`) | Show your current boost multiplier and time remaining. |
| `/lumi-cigarette trade <yours> @user <theirs\|amount>` · `!cig trade <yours> @user <theirs\|$amount>` | Trade a cigarette for another cigarette **or** sell it for SGC. The other person must approve. |

---

## 8½. Lumi Pet (Lumi-Town) — `/lumi-pet` (slash only)

Lumi-Town lives on the web at **https://sadgirlsclub.wtf/lumipet/** (members of the server only). Meet Lumi there
first; after that you can look after her from Discord as well. It's the same Lumi and the same SGC: anything you do
here shows on the website and the other way round.

| Command | What it does |
|---|---|
| `/lumi-pet status` | Her card, **only you see it**: her hunger, energy and joy as bars (⚠️ when one is low), what she's doing, your SGC and your Lumi Heights flat. Buttons: **💞 Cuddle**, **😴 Nap** / **☀️ Wake**, **🔄 Refresh**, **🏠 Visit Lumi** (opens the website). Menus: **🍓 Feed her…** and **🎾 Play with…**. |
| `/lumi-pet show` | Her card for **everyone in the channel**, without buttons. |
| `/lumi-pet feed item:<food>` | Feed her. Start typing to search the pantry and the Snack Stand. |
| `/lumi-pet reminders turn:<on\|off>` | **DM reminders.** Lumi DMs you when she's hungry, sleepy or lonely, when a nap finished, or when slow flowers are ready in her garden. You get a hello DM when you turn it on. |
| `/lumi-pet timezone zone:<zone>` | Your clock, so reminders stay quiet from 22:00 to 07:00 **your** time (start typing a city, like *London* or *New_York*). Until you set it, Los Angeles time is used. |
| `/lumi-pet news name:<show\|hide>` | Lumi-Town news posts big wins and showdown winners in the server's Lumi-Town channel. **hide** shows you as "a Lumi-Town neighbour" instead. |

**DM reminders:**
- Off until you turn them on, with the command above or **Settings ▸ Discord DMs from Lumi** in Lumi Pet (that one
  also sets your timezone from your browser).
- At most **one DM every 3 hours**, never at night on your clock, and never about something you've already seen or
  fixed on the website.
- The DM is her card, so you can cuddle, feed or play right there. **🔕 Stop reminders** turns them off.
- If your DMs are closed to server members, Lumi can't reach you and reminders switch themselves off. Open them in
  *Server ▸ Privacy Settings ▸ Direct Messages* and turn reminders on again.

**Lumi Pet inside Discord (Activity):** once the admins switch it on, start **Lumi Pet** from the 🚀 Activities
button in a voice channel. It's the same Lumi and the same SGC as the website. The Casino tables open on the website,
not inside Discord.

**Feeding and buying:**
- Free food (🍎 Apple) and food already in her pantry are eaten straight away. Free.
- Food you don't have asks **"Buy 1 … for N SGC and feed her?"** with ✅ **Buy & feed** / ✖️ **Never mind**. Nothing
  is charged until you press ✅. The question lasts one minute, and pressing ✅ twice still buys only once.
- If she can't eat yet (she just ate), nothing is charged.
- Prices are the same as the website's Snack Stand.

**Good to know:**
- Only you can press the buttons on your card.
- Checking her card counts as a visit (so she won't send a reminder about something you just saw), but the
  **daily visit reward** is only on the website. The card says 🎁 when it's waiting.
- Adopting Lumi, the shop for toys, decor and clothes, dungeons, the garden and the minigames are all on the website.

---

## 9. Misc / Utility

| Command | What it does |
|---|---|
| `/lumi-man` | Show the in-bot help message. |
| `/lumi-quote` | Random quote from the server's quote book. |
| `/lumi-quoteadd text:<quote>` | Add a quote to the book. |
| `/lumi-jh` | Random Jack Handey "Deep Thought." |
| `/lumi-search query:<q>` | Ask Lumi to search the web (Brave Search) and answer in-character. Rate-limited per user/day. |

---

## 10. Talking to Lumi (no command needed)

Lumi has an autonomous AI personality and **does not need to be summoned** — she reads the channel and decides for herself when to chime in. To get her attention reliably:

- **Mention her** (`@Lumi`) or **reply** to one of her messages — she'll always respond.
- Otherwise she joins conversations probabilistically. If she stays quiet, that's by design (she has cooldowns to avoid spamming).
- She has long-term memory: she remembers things about you over time. If she misremembers something, just correct her — she'll update.
- She can do **web searches in conversation** if you ask, with the same daily rate-limit as `/lumi-search`.

She can also send **GIFs** occasionally and react to messages.

---

## 11. Other server features (no commands)

These run quietly in the background:

- **Reaction roles** — react to a designated message with the configured emoji to grant yourself a role; remove the reaction to drop it.
- **Starboard** — if a message gets enough ⭐ reactions (default 4), it's pinned to the starboard channel.
- **Welcome messages** — new members get a welcome on join.
- **Voice rewards** — extended VC time can earn periodic SGC payouts depending on guild config.
- **Public leaderboard / charts** — economy and stock data are exposed via a webpage if your admins enable it.

---

## TL;DR Cheat Sheet

```
/lumi-man              ← full in-bot help
!bank                  ← check SGC
!cig                   ← cigarette case
!smoke <slot>          ← activate earnings boost
!touhou                ← interactive Touhou menu
!adopt                 ← +1 random Touhou (25 SGC)
!invest                ← stock exchange list
!portfolio             ← your stocks
!bets                  ← prediction markets
!pachinko 5 10         ← drop ball on peg 5, bet 10 SGC
!slots / !bj / !th / !hr   ← casino tables
/lumi-pet status       ← your Lumi: needs, cuddle, feed, play
@Lumi <anything>       ← talk to her
```
