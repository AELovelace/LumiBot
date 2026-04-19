# SadGirlPlayer Beta User Guide

This guide covers the current public features and player-facing commands for the SadGirlPlayer beta:

- Voice & Radio
- Lumi Chat, Search, Quotes, and Help
- Bank & Taxes
- LumiBets
- LumiStocks
- Touhou Market
- Pachinko
- Blackjack
- Slots
- Texas Hold'em
- Horse Racing
- VC Time

## Quick Start

- Use slash commands if you want the full command set.
- Use the simplified `!` commands for the fastest economy / game actions.
- All SGC amounts are whole numbers.
- Some slash replies are only visible to you. Most `!` shortcuts post as normal channel messages.
- Several multiplayer games start with a command, then switch to button controls.
- Some Lumi chat features only work in channels where the chatbot is enabled.

## Earning SadGirlCoin

You earn SadGirlCoin (`SGC`) automatically by being active in chat:

- `1 SGC` per `50` text characters
- image attachments add `25` effective characters
- video attachments add `50` effective characters

## Voice & Radio

Use these slash commands to control voice playback:

| What it does | Slash command |
| --- | --- |
| Play a YouTube URL, SoundCloud URL, search query, or stream URL | `/lumi-play [input]` |
| Stop playback and disconnect | `/lumi-stop` |
| Skip the current track | `/lumi-skip` |
| Show the current queue | `/lumi-queue` |

### Notes

- These are slash-only right now.
- You must already be in a guild voice channel to use `/lumi-play`.
- If something is already playing, `/lumi-play` adds the new track to the queue instead of interrupting.

## Lumi Chat, Search, Quotes, and Help

### Slash Commands

| What it does | Slash command |
| --- | --- |
| Search the web through Lumi | `/lumi-search <query>` |
| Get a random quote | `/lumi-quote` |
| Add a quote to the database | `/lumi-quoteadd <text>` |
| Get a Jack Handey deep thought | `/lumi-jh` |
| Show the full command list | `/lumi-man` |

### Lumi Chat

In channels where Lumi chat is enabled, you can also talk to Lumi directly.

What Lumi can do in enabled chat channels:

- reply when directly addressed or when the conversation hooks her
- use per-user memory context when it helps
- give song recommendations when asked
- post GIF replies when asked for one
- perform web searches when explicitly asked

Examples:

- `lumi search aphex twin interviews`
- `lumi can you post a gif`
- `what should i listen to right now`

### Notes

- Web search is rate-limited.
- `/lumi-search` is the cleanest way to force a search.
- Quote commands are public.

## Bank

Use the bank to check your balance, send coins, and buy yearly raffle tickets.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Check your balance | `/lumi-bank balance` | `!bank` or `!bank balance` |
| Send coins | `/lumi-bank send <user> <amount> [note]` | `!bank send @user <amount>` |
| Buy a yearly raffle ticket | `/lumi-bank raffle` | `!bank raffle` |

### How it works

- `balance` shows your balance, the Top 10 holders, the Central Bank reserve, Doll Street, and Momiji Casino.
- Transfers have a fee:
  - normal days: `1%`, minimum `1 SGC`
  - Lotto Day: `50%`
- `!bank send` is the quick version and does not include an optional note.
- A yearly raffle ticket costs `50 SGC`.
- You can buy more than one raffle ticket.
- The yearly raffle winner gets `25%` of the Central Bank reserve.

### Staff / Admin-Only Slash Commands

| What it does | Slash command |
| --- | --- |
| Withdraw from Central Bank | `/lumi-bank withdraw <user> <amount> [note]` |
| Give coins to a user | `/lumi-bank give <user> <amount> [note]` |
| Take coins from a user | `/lumi-bank take <user> <amount> [note]` |

### Monthly Taxes

At the end of every month, taxes are automatically collected and deposited into the Central Bank:

| Balance tier | Tax rate |
| --- | --- |
| Over `100 SGC` | `1%` |
| Over `10,000 SGC` | `5%` |
| Over `1,000,000 SGC` | `10%` |

- The highest applicable tier is used, not stacked.
- System accounts are exempt.

### Other Economy Notes

- There is also a weekly lottery that gives one holder `50 SGC`.
- On yearly raffle day, Lotto Day is active, so transfers use the `50%` fee.
- Momiji Casino deposits part of its reserve back into the Central Bank automatically.

## LumiBets

LumiBets is a prediction market system. Players create questions, vote them live, then buy positions on the outcome.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Show open markets | `/lumi-bets list` | `!bets` or `!bets list` |
| Buy a position | `/lumi-bets buy <market> <option> <amount>` | `!bets buy <market> <option> <amount>` |
| Propose a market | `/lumi-bets create <title> [description] [options]` | Not available |
| Show pending markets | `/lumi-bets pending` | Not available |

### How it works

- Markets can be simple `yes / no` or multi-option with `2-5` comma-separated options.
- Anyone can create a market with `/lumi-bets create`.
- New public markets start as `pending`.
- A pending market needs `3` star reactions to go live.
- Each successful star reaction costs `3 SGC`.
- Admin-created markets go live immediately with a `6 SGC` seed pool from the Central Bank.
- `buy` accepts either the option name or its number.
- `!bets` only supports `list` and `buy`.

### Important payout rules

- Each buy creates a separate winning or losing position.
- When a market resolves, the full pool is split evenly across winning positions.
- Payouts are not weighted by bet size in the current system.
- If nobody has a winning position, the pool stays with Doll Street.

### Staff / Admin-Only Slash Commands

| What it does | Slash command |
| --- | --- |
| Resolve a market | `/lumi-bets resolve <market> <outcome>` |

### Examples

- `/lumi-bets list`
- `/lumi-bets buy 7 yes 25`
- `/lumi-bets buy 8 2 10`
- `/lumi-bets create title:"best album?" options:"kid a, ok computer, in rainbows"`
- `!bets buy 7 no 10`

## LumiStocks

LumiStocks is a Big Business share exchange. Buy shares in guild businesses, watch prices move with supply and demand, earn weekly dividends, and track your portfolio.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| List all stocks | `/lumi-stocks list` | `!invest` or `!invest list` |
| Buy shares | `/lumi-stocks buy <ticker> <amount>` | `!invest buy <ticker> <amount>` |
| Sell shares | `/lumi-stocks sell <ticker> <shares>` | `!invest sell <ticker> <shares>` |
| View your portfolio | `/lumi-stocks portfolio` | `!portfolio` |
| View stock details | `/lumi-stocks info <ticker>` | `!invest info <ticker>` |
| Post a buy-offer with buttons | `/lumi-stocks offer <ticker>` | `!invest offer <ticker>` |

### Aliases

- `!shares` is a full shorthand alias for `!invest`, so every invest quick command works with either prefix.
- `!portfolio` jumps directly to your portfolio view.

### How it works

- Each enabled guild's Big Business can appear on the exchange as a real stock listing.
- The exchange tries to keep `10` listings visible whenever there are fewer than `10` real guild businesses.
- Empty slots are filled by synthetic companies generated from the naming style of the real Big Businesses.
- If real guild listings grow past `10`, all real guild stocks stay listed and the exchange expands beyond `10`.
- Market cap is based on **current business value + total user investment capital**.
- Share price moves dynamically with supply and demand:
  - more buying pushes price upward
  - more selling pushes price downward
- Stock info also shows performance metrics based on deviation from the average performance of the real Big Businesses.
- Fractional shares are fully supported.
- When you buy shares, your SGC goes into the Big Business treasury.
- When you sell, you are paid from the treasury at the current share price.
- The `/lumi-stocks offer` command posts a message with 💰 buttons for quick `5`, `10`, `20`, `50`, or `100 SGC` purchases.
- Total shareholder value = `(shares × current price) + accumulated dividends`.

### Weekly Dividends

- Dividends are distributed automatically every Sunday at `18:00 UTC`.
- The dividend rate is set per stock by admins (e.g. `5%` of treasury).
- Dividends are split pro-rata based on how many shares each holder owns.
- Lumi posts an LLM-generated corporate announcement in the Big Business channel each week.

### Staff / Admin-Only Slash Commands

| What it does | Slash command |
| --- | --- |
| Trigger a dividend distribution | `/lumi-stocks dividend <ticker>` |
| Set the share price | `/lumi-stocks price <ticker> <value>` |
| Set the dividend rate | `/lumi-stocks rate <ticker> <percent>` |

### Examples

- `/lumi-stocks list`
- `/lumi-stocks buy <ticker> 50`
- `/lumi-stocks sell <ticker> 2.5`
- `/lumi-stocks portfolio`
- `/lumi-stocks info <ticker>`
- `/lumi-stocks offer <ticker>`
- `!invest buy <ticker> 25`
- `!portfolio`

## Touhou Market

Adopt, trade, gift, and collect Touhou characters. Every Touhou is a unique collectible with rarity that increases as it gets traded.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Adopt a random Touhou | `/lumi-touhou adopt` | `!touhou adopt` |
| View a collection | `/lumi-touhou collection [user]` | `!touhou`, `!touhou collection`, or `!touhou collection @user` |
| Gift a Touhou | `/lumi-touhou send <name> <user>` | `!touhou send <name> @user` |
| Swap Touhous | `/lumi-touhou trade <yours> <user> <theirs>` | `!touhou trade <yours> @user <theirs>` |
| List for sale | `/lumi-touhou sell <name> <price>` | `!touhou sell <name> <price>` |
| Remove a listing | `/lumi-touhou delist <name>` | `!touhou delist <name>` |
| Buy a listed Touhou | `/lumi-touhou buy <name>` | `!touhou buy <name>` |
| Browse market | `/lumi-touhou market` | `!touhou market` |
| View Touhou details | `/lumi-touhou info <name>` | `!touhou info <name>` |
| Search by name | `/lumi-touhou search <query>` | `!touhou search <query>` |
| Global stats | `/lumi-touhou stats` | `!touhou stats` |

### Alias

- `!2hu` is a full shorthand alias for `!touhou`, so every Touhou quick command works with either prefix.
- Plain `!touhou` or `!2hu` with no subcommand shows your own collection.

### How it works

- Adopting costs `25 SGC`.
- You receive a random available Touhou.
- Each Touhou has a rarity tier based on trade count:
  - **Common** `0-1`
  - **Uncommon** `2-5`
  - **Rare** `6-11`
  - **Epic** `12-19`
  - **Legendary** `20+`
- Gifting (`send`) and direct swaps (`trade`) are free.
- Selling lists a Touhou on the marketplace at your chosen price.
- Marketplace purchases charge a `10%` trade tax:
  - buyer pays full listed price
  - seller receives `90%`
  - Central Bank receives `10%`
- **Momiji Inubashiri** is permanently reserved and cannot be traded, sold, or listed.

### Staff / Admin-Only Slash Commands

| What it does | Slash command |
| --- | --- |
| Force-assign a Touhou | `/lumi-touhou assign <name> <user>` |
| Return a Touhou to the market | `/lumi-touhou release <name>` |
| Reset trade count | `/lumi-touhou reset-trades <name>` |

### Examples

- `!touhou adopt`
- `!2hu market`
- `!touhou sell Reimu 50`
- `!touhou buy Marisa`
- `/lumi-touhou info Reimu`

## Pachinko

Pachinko is a quick single-command casino game. Pick a peg from `1` to `10`, place a bet, and watch the ball fall.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Play pachinko | `/lumi-pachinko <peg> <bet>` | `!pachinko <peg> <bet>` |

### How it works

- The ball starts in one of the middle lanes and drifts left or right as it falls.
- You bet on which peg the ball will land on.
- Only one pachinko game can run in a channel at a time.

### Payouts

| Result | Return |
| --- | --- |
| Exact peg | `2x` |
| 1 peg away | `1.5x` |
| 2 pegs away | `1x` (bet back) |
| 3 or more pegs away | `0x` |

### Examples

- `/lumi-pachinko 6 20`
- `!pachinko 4 10`

## Blackjack

Blackjack is a multiplayer table game. Join a table, place your bet, then use buttons to `Hit`, `Stay`, or `Leave`.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Join or start a table | `/lumi-blackjack play <bet>` | `!blackjack <bet>` or `!bj <bet>` |
| Leave a table | `/lumi-blackjack leave` | `!blackjack leave` or `!bj leave` |
| Change your next-hand bet | `/lumi-blackjack bet <amount>` | `!blackjack bet <amount>` or `!bj bet <amount>` |

### How it works

- One blackjack table runs per channel.
- Up to `3` players can sit at the same table.
- After you join, gameplay uses buttons:
  - `Hit`
  - `Stay`
  - `Leave`
- The table stays open between hands and deals again automatically.
- If nobody clicks for about `60` seconds, remaining active players auto-stand.
- Leaving during an active hand forfeits your current bet.

### House rules

- Dealer stands on `17+`.
- The table uses a shared shoe of `2` decks.
- The shoe reshuffles every `5` hands, or earlier if it gets too low.

### Payouts

| Result | Return |
| --- | --- |
| Natural blackjack | `2.5x` |
| Normal win | `2x` |
| Push | `1x` (bet returned) |
| Lose or bust | `0x` |

### Examples

- `/lumi-blackjack play 25`
- `/lumi-blackjack bet 50`
- `!bj 10`
- `!blackjack leave`

## Slots

Slots is a shared multiplayer slot bank. Up to `3` players can be on machines side-by-side in the same play area.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Start or join the slot bank | `/lumi-slots start` | `!slots` |
| Leave the slot bank | `/lumi-slots leave` | `!slots leave` |

### How it works

- One slot bank runs per channel.
- Up to `3` players can share it at once.
- Each player gets their own machine panel with their own name, bet, and reels.
- After joining, use buttons to:
  - `Spin`
  - `1 SGC`, `5 SGC`, `10 SGC`
  - `Leave`
- Multiple players can spin at the same time.
- You cannot change your bet or leave while your own reels are spinning.
- If nobody interacts for `5` minutes, the slot bank closes.

### Symbols

🍒, 🍋, 🔔, 💎, 7️⃣, ⭐

### Win conditions

| Pattern | Multiplier |
| --- | --- |
| Horizontal 3-of-a-kind on any row | `4x` per row |
| Diagonal 3-of-a-kind | `3x` per diagonal |
| Hand combo on a row (💎💎⭐, 7️⃣7️⃣💎, 🍒🍒🔔) | `2x` per row |

Multiple wins on the same spin stack together.

### Examples

- `/lumi-slots start`
- `!slots`
- `!slots leave`

## Texas Hold'em

Texas Hold'em is a multiplayer poker table with ante + betting rounds, community cards, and showdown hand evaluation.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Join or start a table | `/lumi-holdem play <bet>` | `!holdem <bet>` or `!th <bet>` |
| Leave a table | `/lumi-holdem leave` | `!holdem leave` or `!th leave` |
| Change your next-hand ante | `/lumi-holdem bet <amount>` | `!holdem bet <amount>` or `!th bet <amount>` |
| Raise during a hand | `/lumi-holdem raise <amount>` | `!holdem raise <amount>` or `!th raise <amount>` |

### How it works

- One table can run per channel.
- Up to `6` human players can sit at once.
- If only `1` human player is seated, **Lumi CPU** auto-joins as the opponent.
- After joining, gameplay uses buttons:
  - `Peek`
  - `Check` / `Call`
  - `Fold`
  - `Leave`
  - raise buttons on the table message
- Phases: Pre-Flop → Flop → Turn → River → Showdown.
- Best `5`-card hand out of `7` cards wins.
- The table deals a new hand automatically after each round.
- If you leave during a hand, your ante stays in the pot.
- If a player times out:
  - with no outstanding bet, they auto-check
  - facing a bet, they auto-fold

### Lumi CPU

- Lumi CPU auto-seats only when exactly one human is at the table.
- If Lumi CPU wins, the pot stays with the casino instead of paying out to a human account.

### Examples

- `/lumi-holdem play 15`
- `/lumi-holdem raise 5`
- `!th 10`
- `!holdem raise 2`
- `!holdem leave`

## Horse Racing

Horse Racing is a multiplayer betting lobby. Start or join the lobby, then use buttons to pick a horse and set your bet.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Start or join the lobby | `/lumi-horserace start` | `!horseracing` or `!hr` |
| Leave the lobby | `/lumi-horserace leave` | `!horseracing leave` or `!hr leave` |

### How it works

- The command only starts or joins the lobby.
- After that, use buttons to:
  - pick Horse `A`, `B`, `C`, or `D`
  - set your bet to `5`, `10`, or `20 SGC`
  - leave the lobby
- Each betting round stays open for `30` seconds.
- The lobby stays open between races.
- Horse picks reset between races, but players stay seated unless they leave.
- If nobody places a funded bet before the timer ends, the lobby closes.

### Payout rules

- The prize pool is split evenly among everyone who picked the winner.
- If the underdog wins, the effective pool is doubled before payout.
- Underdog status is based on saved horse win stats, not just one race.
- If nobody picked the winner, the house keeps the pool.

### Examples

- `/lumi-horserace start`
- `!horseracing`
- `!hr leave`

## VC Time

Your voice channel time is tracked automatically and persists across bot restarts. Check who hangs out the most.

### Commands

| What it does | Slash command | Simplified `!` command |
| --- | --- | --- |
| Voice channel time leaderboard | `/lumi-vc rank` | `!vc` |
| Show your own VC time | `/lumi-vc me` | `!vc me` |

### How it works

- Total VC time is tracked automatically whenever you are in a voice channel.
- Time persists across bot restarts — you never lose credit.
- `rank` shows the top 20 leaderboard with a 👑 for first place.
- `me` shows your own total VC time and whether you are currently in VC.
- Users currently in VC are marked with 🟢 on the leaderboard.

### Examples

- `/lumi-vc rank`
- `/lumi-vc me`
- `!vc`
- `!vc me`

## Command Summary

### Slash-only Utility Commands

```text
/lumi-play [input]
/lumi-stop
/lumi-skip
/lumi-queue
/lumi-search <query>
/lumi-quote
/lumi-quoteadd <text>
/lumi-jh
/lumi-man
```

### Quick `!` Economy / Game Commands

```text
!bank
!bank balance
!bank send @user <amount>
!bank raffle

!bets
!bets list
!bets buy <market> <option> <amount>

!invest
!invest list
!invest buy <ticker> <amount>
!invest sell <ticker> <shares>
!invest info <ticker>
!invest offer <ticker>
!shares
!portfolio

!touhou
!touhou adopt
!touhou collection
!touhou collection @user
!touhou send <name> @user
!touhou trade <yours> @user <theirs>
!touhou sell <name> <price>
!touhou delist <name>
!touhou buy <name>
!touhou market
!touhou info <name>
!touhou search <query>
!touhou stats

!pachinko <peg> <bet>

!blackjack <bet>
!blackjack leave
!blackjack bet <amount>
!bj <bet>
!bj leave
!bj bet <amount>

!slots
!slots leave

!holdem <bet>
!holdem leave
!holdem bet <amount>
!holdem raise <amount>
!th <bet>
!th leave
!th bet <amount>
!th raise <amount>

!horseracing
!horseracing leave
!hr
!hr leave

!vc
!vc me
```

## Best Way To Learn

If you are new, start here:

1. Run `!bank` to see your balance.
2. Try `!pachinko 5 5` for a quick game.
3. Use `!blackjack 10` if a table is open, or to start one.
4. Use `!slots` to join the slot bank, then spin with the button.
5. Use `!horseracing`, then pick a horse with the buttons.
6. Use `!holdem 10` for a poker hand against Lumi CPU or other players.
7. Use `!touhou adopt` to get your first Touhou.
8. Use `!bets` to see live markets, then place a small position with `!bets buy`.
9. Use `!invest` to see Big Business stocks and buy shares.
