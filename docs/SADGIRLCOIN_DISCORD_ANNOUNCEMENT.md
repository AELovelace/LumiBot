# SadGirlPlayer Beta

hey everyone, beta is live enough now that it deserved one clean post instead of lore fragments.

you earn `SadGirlCoin` (`SGC`) automatically just by being active in chat:

- `1 SGC` per `50` characters
- image attachments add `25` effective characters
- video attachments add `50` effective characters

what's live right now:

- voice / radio playback
- web search
- quotes + help commands
- bank + yearly raffle
- LumiBets
- LumiStocks
- Touhou market
- pachinko
- blackjack
- texas hold'em
- horse racing
- slots
- VC time tracking

## Voice / Radio

play music or streams in voice with slash commands:

- `/lumi-play [input]`
- `/lumi-stop`
- `/lumi-skip`
- `/lumi-queue`

`/lumi-play` accepts:

- YouTube URLs
- SoundCloud URLs
- search terms
- direct HTTP stream URLs

## Search / Fun / Help

slash-only utility stuff:

- `/lumi-search <query>`
- `/lumi-quote`
- `/lumi-quoteadd <text>`
- `/lumi-jh`
- `/lumi-man`

notes:

- web search is rate-limited
- quote add is public
- `/lumi-man` prints the full command list

## Bank

check your balance, send coins, or buy yearly raffle tickets.

**slash commands**

- `/lumi-bank balance`
- `/lumi-bank send <user> <amount>`
- `/lumi-bank raffle`

**quick commands**

- `!bank`
- `!bank balance`
- `!bank send @user <amount>`
- `!bank raffle`

**important stuff**

- `balance` shows your coins, the Top 10, the Central Bank, Doll Street, and Momiji Casino
- normal transfers have a `1%` fee, minimum `1 SGC`
- on lotto day, transfers have a `50%` fee
- yearly raffle tickets cost `50 SGC`
- the yearly raffle winner gets `25%` of the Central Bank reserve

## LumiBets

prediction market gambling. make markets, vote them live, then buy positions on the outcome.

markets can be:

- **yes / no**
- **multi-option** with `2-5` comma-separated choices

**slash commands**

- `/lumi-bets list`
- `/lumi-bets buy <market> <option> <amount>`
- `/lumi-bets create <title> [description] [options]`
- `/lumi-bets pending`

**quick commands**

- `!bets`
- `!bets list`
- `!bets buy <market> <option> <amount>`
- legacy `!stocks` still works if your muscle memory is cursed

**important stuff**

- new public markets start as pending
- a pending market needs `3` star reacts to go live
- each successful star vote costs `3 SGC`
- admin-created markets go live instantly with a `6 SGC` seed pool
- buying accepts the option name or number
- when a market resolves, the whole pool is split evenly across winning positions
- payouts are **not** weighted by bet size right now

example multi-option market:

`/lumi-bets create title:"best album?" options:"kid a, ok computer, in rainbows"`

## LumiStocks

Big Business stock trading. buy shares, watch prices move with buying and selling, and collect weekly dividends.

the exchange always tries to show `10` listings when there are fewer than `10` real guild businesses. any empty slots get filled by fake companies built out of the same naming vibe as the real ones. if more than `10` real guild businesses exist, all real guild stocks stay listed and the exchange grows past `10`.

**slash commands**

- `/lumi-stocks list`
- `/lumi-stocks buy <ticker> <amount>`
- `/lumi-stocks sell <ticker> <shares>`
- `/lumi-stocks portfolio`
- `/lumi-stocks info <ticker>`
- `/lumi-stocks offer <ticker>`

**quick commands**

- `!invest`
- `!invest list`
- `!invest buy <ticker> <amount>`
- `!invest sell <ticker> <shares>`
- `!invest info <ticker>`
- `!invest offer <ticker>`
- `!shares` — alias for `!invest`
- `!portfolio` — shortcut to your holdings

**important stuff**

- market cap is based on **Big Business value + total user investment capital**
- prices move with supply and demand — more buying pushes up, more selling pushes down
- stock info shows fake company performance metrics compared against real Big Businesses
- fractional shares are fully supported
- buys add SGC to the business treasury; sells pay out from that treasury
- dividends run automatically every Sunday at `18:00 UTC`
- Lumi posts corporate-style dividend announcements in the Big Business channel
- admins can still set dividend rate and hard-override price if needed

## Touhou Market

adopt, trade, gift, and sell Touhou characters.

**slash commands**

- `/lumi-touhou adopt`
- `/lumi-touhou collection [user]`
- `/lumi-touhou send <name> <user>`
- `/lumi-touhou trade <yours> <user> <theirs>`
- `/lumi-touhou sell <name> <price>`
- `/lumi-touhou delist <name>`
- `/lumi-touhou buy <name>`
- `/lumi-touhou market`
- `/lumi-touhou info <name>`
- `/lumi-touhou search <query>`
- `/lumi-touhou stats`

**quick commands**

- `!touhou`
- `!touhou adopt`
- `!touhou collection`
- `!touhou collection @user`
- `!touhou send <name> @user`
- `!touhou trade <yours> @user <theirs>`
- `!touhou sell <name> <price>`
- `!touhou delist <name>`
- `!touhou buy <name>`
- `!touhou market`
- `!touhou info <name>`
- `!touhou search <query>`
- `!touhou stats`

**aliases**

- every Touhou quick command also works with `!2hu`
- plain `!touhou` or `!2hu` shows your own collection

**important stuff**

- adopting costs `25 SGC`
- gifting and direct trades are free
- marketplace buys have a `10%` trade tax
- rarity goes up as a Touhou gets traded more
- **Momiji Inubashiri** is permanently reserved and cannot be traded or sold

## Pachinko

pick a peg, drop the ball, pray.

**slash command**

- `/lumi-pachinko <peg> <bet>`

**quick command**

- `!pachinko <peg> <bet>`

**payouts**

- exact peg = `2x`
- `1` away = `1.5x`
- `2` away = `1x` back
- `3+` away = rip

## Blackjack

multiplayer blackjack table in the channel. join once, then use buttons for `Hit`, `Stay`, or `Leave`.

**slash commands**

- `/lumi-blackjack play <bet>`
- `/lumi-blackjack leave`
- `/lumi-blackjack bet <amount>`

**quick commands**

- `!blackjack <bet>`
- `!blackjack leave`
- `!blackjack bet <amount>`
- `!bj <bet>`
- `!bj leave`
- `!bj bet <amount>`

**important stuff**

- max `3` players per table
- dealer stands on `17+`
- shared shoe of `2` decks
- table keeps going between hands
- if you leave mid-hand, that bet is gone

**payouts**

- natural blackjack = `2.5x`
- normal win = `2x`
- push = bet back
- lose / bust = `0`

## Texas Hold'em

multiplayer Hold'em table with real betting rounds.

**slash commands**

- `/lumi-holdem play <bet>`
- `/lumi-holdem leave`
- `/lumi-holdem bet <amount>`
- `/lumi-holdem raise <amount>`

**quick commands**

- `!holdem <bet>`
- `!holdem leave`
- `!holdem bet <amount>`
- `!holdem raise <amount>`
- `!th <bet>`
- `!th leave`
- `!th bet <amount>`
- `!th raise <amount>`

**important stuff**

- up to `6` human players per table
- if only `1` human is seated, **Lumi CPU** jumps in
- table controls use buttons: `Peek`, `Check/Call`, `Fold`, `Leave`
- raise buttons are built into the table too
- if you leave during a hand, your ante stays in the pot
- if you time out with no bet to call, you auto-check
- if you time out facing a bet, you auto-fold

## Horse Racing

start the lobby, pick a horse with buttons, set your bet, then watch chaos.

**slash commands**

- `/lumi-horserace start`
- `/lumi-horserace leave`

**quick commands**

- `!horseracing`
- `!horseracing leave`
- `!hr`
- `!hr leave`

**important stuff**

- betting window is `30` seconds
- pick horse `A`, `B`, `C`, or `D`
- bet buttons are `5`, `10`, or `20 SGC`
- the lobby stays open between races
- if the current underdog wins, the prize pool gets doubled
- underdog status is based on saved horse win stats, not just one race

## Slots

shared slot bank with up to `3` people playing side-by-side.

**slash commands**

- `/lumi-slots start`
- `/lumi-slots leave`

**quick commands**

- `!slots`
- `!slots leave`

**important stuff**

- up to `3` players can sit in the same slot area
- each player gets their own machine panel with their own name, bet, and reels
- bet buttons are `1`, `5`, or `10 SGC`
- multiple players can spin at the same time
- you can't change bet or leave while your own reels are spinning
- machine closes after `5` minutes idle

**payouts**

- `3` of a kind in a row = `4x`
- `3` of a kind on a diagonal = `3x`
- winning row hand combo = `2x`
- wins stack on the same spin

**winning row hands** (any order)

- 💎💎⭐ Diamond Star
- 7️⃣7️⃣💎 Lucky Sevens
- 🍒🍒🔔 Cherry Bells

## VC Time

your voice channel time is tracked and persists across reboots. check who hangs out the most.

**slash commands**

- `/lumi-vc rank`
- `/lumi-vc me`

**quick commands**

- `!vc`
- `!vc me`

**important stuff**

- total VC time is tracked automatically whenever you're in a voice channel
- time persists across bot restarts — you never lose credit
- `rank` shows the top 20 leaderboard with a 👑 for first place
- `me` shows your own total VC time and whether you're currently in VC
- users currently in VC are marked with 🟢 on the leaderboard

## Quick Command Cheat Sheet

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

!slots
!slots leave

!vc
!vc me
```

if people want, i can also turn this into a much shorter single-post version for a more casual beta announcement.
