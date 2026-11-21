# Lumi-Town × Discord: plan

> Status: **built** (D0–D6, 2026-11-20, tests 600/600; the Activity is off until set up, see §9). This replaces the Discord items in Phase 7 of `lumi-games-port.md`.
> Lumi-Town is live at https://sadgirlsclub.wtf/lumipet/ (`feat/lumi-town` @ `a318d20`, deployed 2026-11-20).

Goal: friends can look after Lumi and follow Lumi-Town **from Discord**, without breaking any money rule the website
keeps. Four pieces, all chosen by Doll on 2026-11-20:

| Piece | What players get |
|---|---|
| **`/lumi-pet` command** | A status card for their Lumi, with buttons for **all care, paid snacks included** |
| **DM reminders** | Opt-in DMs from Lumi when a need gets low, a nap finishes, or flowers are ready |
| **Channel announcements** | Lumi-Town news in a channel: big wins, housewarmings, showdowns, a daily bank summary |
| **Discord Activity** | Lumi Pet running *inside* Discord (a voice-channel Activity) |

---

## 1. What we already have (checked 2026-11-20)

- **One process.** The bot and Lumi-Town share one Node process (`src/index.js:303` calls `initLumiGames()` after
  the economy and the exchange are up). Discord code calls `src/lumi/*` directly. No HTTP hop, no new API.
- **The reminder rules are already ported.** `src/lumi/pet/lumipet.js` keeps erinne's `episodes()`, `_quiet()`,
  `REMIND_EVERY` (3 h), `QUIET` (22:00–07:00) and `REMIND_ORDER` (hunger → energy → joy → nap → garden), marked "Kept
  for Phase 7". Only the sweep loop and the sender are missing. erinne's `mnemerynne/lumipet.py` `sweep()` is the model
  (reference only, never edit erinne).
- **`garden_reminders`** is already a per-pet toggle (default on).
- **Command style.** Member commands are global and named `lumi-*` (`/lumi-blackjack`, `/lumi-cigarette`…). Admin
  commands are registered only in the 3 home guilds (`src/controlPlane.js:203`). Interactions fan out from
  `src/index.js:520` to `handleControlPlaneInteraction` + `handleCommandInteraction` (`src/commands.js:415`).
- **The money lock** (one money action at a time per player) lives *inside* `src/lumi/router.js:239` as a private
  `busy` Set. Discord can't use it yet, so a Discord snack and a website snack could race.
- **Static files are public** (`/lumipet/static/...` needs no login), so Discord embeds can use the pet art as
  thumbnails.
- **Who may play** = members of `DISCORD_PANEL_GUILD_ID`, checked at web login (`webPanelAuth.js:412`).
- **Event bus**: `src/lumi/events.js` `publish(channel, event, data)` is a plain EventEmitter, so Discord code can
  subscribe to it.
- **Lumi's "day"** is America/Los_Angeles.

---

## 2. Shared rules (every piece follows these)

1. **Same door, same rules.** Anything Discord does to a pet goes through the same function the website route uses.
   No second copy of pet logic, prices or tuning.
2. **Same lock.** The per-player money lock moves out of `router.js` into `src/lumi/locks.js`
   (`withUserLock(uid, fn)`). Router and Discord both use it, so a Discord snack and a website snack can't race.
3. **Same members.** Before any pet action from Discord, check the user is in `DISCORD_PANEL_GUILD_ID` (cached
   `guild.members.fetch`, 10 min). Not a member → polite ephemeral "Lumi-Town is for members of the club 💜".
4. **Idempotent money.** `sgc.spend` has no ref key, so a Discord action passes `onceRef: 'lumi-discord:<interaction
   id>'` to `runPetAction`, which claims it in `lumi_coin_refs` inside the same transaction. A retried interaction
   gets 409 `already_done` and never charges twice; a refused action rolls the claim back. *(Built in D0.)*
5. **Only the owner presses.** Every button/select `customId` carries the owner: `lumipet:<verb>:<ownerId>[:<arg>]`.
   Someone else pressing gets an ephemeral "That's not your Lumi!".
6. **Tunable, not hard-coded.** Every interval, threshold and on/off switch is a `tuning.js` id shown on the `/lumi`
   admin page.
7. **Kill switch.** `LUMI_DISCORD_ENABLED` (default `true`) turns off all four pieces without touching the website.

---

## 3. Code layout

```
src/lumi/
  locks.js                 // withUserLock(uid, fn): the per-player money lock (moved from router.js)
  pet/actions.js           // runPetAction(uid, username, input, { onceRef, lock }): the ONE entry used by
                           //   routes/pet.js AND Discord (form check + transaction + sgc + town updates)
  discord/
    index.js               // initLumiDiscord(client): registers handlers, starts the reminder + digest timers
    member.js              // isClubMember(client, userId): cached guild-membership check
    card.js                // buildPetCard(snapshot, { owner, share }): embed + action rows (pure, unit-tested)
    command.js             // /lumi-pet definition + interaction handler (commands, buttons, selects, autocomplete)
    reminders.js           // sweep(): pick due players, DM them (erinne's sweep, in JS)
    announce.js            // subscribes to events.js, batches news, posts to the Lumi-Town channel
    activity.js            // Discord Activity routes (phase D5/D6)
```

Wiring: `src/index.js` calls `initLumiDiscord(client)` right after `initLumiGames()`. `/lumi-pet` is added to the
global member command list. The `InteractionCreate` listener gains one line: `void handleLumiInteraction(interaction)`.
It ignores anything whose name or `customId` doesn't start with `lumi-pet` / `lumipet:`.

---

## 4. `/lumi-pet` command

| Subcommand | Does | Visibility |
|---|---|---|
| `/lumi-pet status` | Her card + care buttons | Ephemeral (only you) |
| `/lumi-pet show` | Her card for everyone, **no** buttons (show off your Lumi) | Public |
| `/lumi-pet feed item:<snack>` | Feed from the pantry; if you have none, offers "Buy 1 for N SGC" | Ephemeral |
| `/lumi-pet reminders turn:on\|off` | DM reminders on/off (sends a hello DM when turned on) | Ephemeral |
| `/lumi-pet timezone zone:<tz>` | Your clock for quiet hours (autocomplete: every IANA zone) | Ephemeral |
| `/lumi-pet news name:show\|hide` | Whether Lumi-Town news may name you | Ephemeral |

**The card** (`card.js`): an embed in Lumi's neon theme colour with
- her name, glow and mood line (from `snapshot()`), plus the pet thumbnail from `/lumipet/static/...`,
- meters as bars: 🍓 hunger, ⚡ energy, 💖 joy (`▰▰▰▱▱ 62`), with ⚠️ under `LOW`,
- her current task (napping, until when) and cooldowns ("can eat again in 4 min"),
- your SGC balance and Lumi Heights flat number.

**Buttons** (row 1): 💞 Cuddle · 🎾 Play · 😴 Nap / ☀️ Wake (whichever fits) · 🔄 Refresh · 🏠 Visit Lumi (link to
`/lumipet/lumi-pet`).
**Row 2**: a select menu **🍓 Feed…** listing the pantry (held count) first, then Snack Stand items with their price
("Strawberry Milk: 40 SGC").

**Paid snacks from Discord** (Doll: full care, snacks included):
- Picking an item you hold → feed straight away (free, you already own it).
- Picking an item you don't hold → an ephemeral **confirm** ("Buy 1 Strawberry Milk for 40 SGC and feed her?" ✅ / ✖).
  ✅ runs `buy` + `feed` as one `runPetAction` (a list of two steps, one transaction) inside one lock. The run-once
  key is the **question's** id (`lumi-discord:offer:<id>`), not the click's, so clicking ✅ twice can't buy twice.
  The question expires 60 s after that id's snowflake time. *(As built in D1.)*
- Prices come from `tuning.scalePrice('pet', …)` exactly like the website (item scale 1, erinne's prices).
- Not enough SGC → the same message the website shows.

After any action the card **edits itself** (`interaction.update`) with the new snapshot and Lumi's `said` line.

**Seen.** Opening `status` counts as a visit for reminders (`seen = now`), so nobody gets DM'd about a need they just
looked at. It does **not** claim the website's daily visit reward. The card says "🎁 daily visit waiting" with the
link, so the website keeps its reason to be opened.

**No pet yet** → "You haven't met Lumi yet!" + Visit button (adoption stays on the website, where the intro scene is).

---

## 5. DM reminders

**Opt-in only.** Off for everyone until they turn it on, either with `/lumi-pet reminders on` or from a new
**"Discord reminders"** toggle in Lumi Pet's settings panel (next to the existing garden-reminder toggle).
Turning on sends a test DM. If Discord refuses (DMs closed, error 50007), it stays off and the player is told why.

**Tables** (added to `createLumiSchema`; as built, one prefs table holds reminders, timezone and the news choice):
```sql
lumi_discord_prefs(user_id TEXT PRIMARY KEY, remind INTEGER NOT NULL DEFAULT 0,
               tz TEXT,                 -- IANA zone; NULL = America/Los_Angeles
               news_hidden INTEGER NOT NULL DEFAULT 0,
               dm_failed_at INTEGER,    -- last 50007; cleared on re-enable
               updated_at INTEGER NOT NULL)
lumi_remind_events(user_id TEXT, kind TEXT, episode TEXT, created_at INTEGER, sent_at INTEGER,
                   PRIMARY KEY (user_id, kind, episode))
```

**Sweep** (`reminders.js`, a `setTimeout` loop like `treasury.js`, every `lumi.remind.intervalMs`, default 5 min,
batches of 100 by `user_id`). This is erinne's `sweep()` with these changes:
- `load(uid, now, { seen: false })` inside `sgc.inGame` (catch up without marking a visit),
- the garden's `ready_since` when `garden_reminders` is on,
- queue new episodes, drop ones that went stale (fed or seen before sending), prune sent rows older than 7 days,
- skip if one was sent within `REMIND_EVERY` or it's quiet hours **in the player's zone** (`Intl.DateTimeFormat` with
  `tz`, falling back to LA),
- **DM outside the transaction**, then mark everything waiting as sent (one DM covers all of them).

**The DM**: one short line in Lumi's voice per kind (hunger: "my tummy's rumbling… 🍓"), the card thumbnail, and
buttons: 🏠 Visit Lumi (link) · 🍓 Feed… (the same select as the card, works from DMs, same confirm rule) ·
🔕 Stop reminders.

**Failure handling**: 50007 → disable, set `dm_failed_at`, log once. Other errors → leave queued, retry next sweep.
Discord rate limits → discord.js queues; the batch size keeps it small.

---

## 6. Channel announcements (Lumi-Town news) — as built in D3

**Where**: a per-guild **Lumi-Town News Channel ID** (`lumiTownChannelId` in `guildConfig.js`), set on the web panel's
Guilds page like the LumiBets channel. *(The plan first said `/lumi-channel`, but that command is only the chatbot's
whitelist, so the channel lives with the other per-guild channels.)* Empty → no news in that guild.

**What** (knobs on the panel's Economy page, category "Lumi-Town Discord"):

| Event | Rule | Emitted from |
|---|---|---|
| Big win | one prize (`win` or `betwin`) ≥ `lumi.discord.newsBigWin` (default 2,000 SGC) | `sgc.pay` (every game) |
| Owed prize paid | an owed prize ≥ the same size, paid when the bank refilled | `treasury.payOwed` |
| Showdown result | a finished showdown with 2+ racers, and its winner | `arcade/showdown.js _settle` |
| **Daily bank summary** | at `lumi.discord.newsDailyHour` (default 9, LA): bank + health, reserve, 24 h in/out, yesterday's top 3 winners | `treasury.status()` + `lumi_daily` |

Dropped from the first draft: **housewarming** (in Lumi-Town it's a small gift a *visitor* gets, not an event) and
**new neighbour** (no clean "first saved" moment; it can come later from `lumi_flats`). The LUMI price is not in the
summary yet.

**How**: game code calls `events.publish(events.NEWS_CHANNEL, kind, data)` INSIDE its transaction, with the ref that
proves it. `discord/news.js` keeps the big ones, waits `lumi.discord.newsBatchMs` (2 min), then checks each ref in the
database (a rolled-back prize is never posted) and sends ONE embed (15 lines max + "and N more") to every Lumi-Town
channel. Players with `/lumi-pet news name:hide` are "a Lumi-Town neighbour". Nothing from the admin log; never who
owes what.

---

## 7. Discord Activity (Lumi Pet inside Discord) — built in D6, behind `LUMI_ACTIVITY_ENABLED`

**What Discord's docs say** (checked 2026-11-20 at docs.discord.com; the research notes are summarised here):
- The Activity loads the **`/` URL mapping** inside `https://<APP_ID>.discordsays.com`, with query params the SDK
  needs (`frame_id`, `instance_id`, `platform`). Mappings match **in list order, first match wins**, so the longer
  prefix goes first. Targets must be directories. The old `/.proxy/` prefix is no longer required (2025-07-30).
- The proxy supports **WebSockets**; **Server-Sent Events are not documented** (Lumi Town, parties and showdown
  tables use SSE: test them in the Activity). It hides users' real IPs.
- **Cookies** inside the iframe need `SameSite=None` **and** `Partitioned`.
- OAuth: `ready()` → `authorize({ scope: ['identify'], prompt: 'none' })` → server swaps the code at
  `/oauth2/token` **without `redirect_uri`** → `authenticate({ access_token })`.
- **Entry Point**: enabling Activities creates a `PRIMARY_ENTRY_POINT` command (type 4, handler 2, usually
  "launch"). A bulk overwrite "will overwrite ALL types of application commands". *(My first draft said Discord
  answers error 50240; that code is **not** in Discord's docs, so treat it as unverified. Either way the overwrite
  must include the Entry Point, which D4 does.)*
- Testing needs no verification: the developer team can launch a non-distributed Activity with Developer Mode on,
  once the platform is ticked under *Settings → Supported Platforms*.
- The SDK (`@discord/embedded-app-sdk` 2.5.0, 2026-05-05) ships only ESM/CJS, so we bundle it with esbuild into one
  local file.

**As built:**
- `GET /lumipet/activity` (`src/lumi/routes/activity.js`): a "waking Lumi up" page, no inline script, loading
  `public/lumi/vendor/discord-embedded-app-sdk.js` (`npm run build:activity-sdk`, committed) and
  `public/lumi/activity/boot.js`.
- `POST /lumipet/api/activity/session { code }`: code → token (no `redirect_uri`) → `/users/@me` → the club check
  (`discord/member.js`, so the bot must be running) → a normal Lumi session in a cookie with
  `SameSite=None; Secure; HttpOnly; Partitioned` → `{ next, access_token }`; boot.js calls `authenticate()` and goes
  to her house.
- The router's rate limit is now **per logged-in player** (`auth.sessionUserId`), per IP only when logged out, so
  Activity players behind Discord's proxy don't share one bucket.
- Framing is the existing `LUMI_FRAME_ANCESTORS` env (the whole app runs in the iframe, not just one page).
- **Not done (known limits):** links that leave `/lumipet` (the Casino's `/games/` tables, Discord login) don't work
  inside the Activity; there's no "Activity mode" that opens them with the SDK's `openExternalLink` yet. Voice-channel
  friends as Lumi Town visitors is later.

---

## 8. Phases

Each phase ends the same way as the port: `npm test` green, `node --check` on new files, a play-through on
`npm run start:3080` with a test bot in a test guild, docs updated, and Doll's go-ahead before the next phase.
*(2026-11-20: Doll asked to "oneshot the rest", so D2–D6 were built in one go. They are tested with fakes; the real
Discord checks are in §9.)*

**D0: plumbing.** ✅ Done 2026-11-20. `locks.js` (the lock moved out of the router), `pet/actions.js` (`POST
/api/lumi-pet/act` now calls it; same behaviour), `discord/member.js`, `discord/index.js` (registry + interaction
router, wired in `src/index.js` and the global command list in `controlPlane.js`), `LUMI_DISCORD_ENABLED`,
`isLumiReady()`, `webPanelAuth.getPanelAuthConfig` exported.
Tests: `tests/lumi/discord_plumbing.test.mjs` (15).

**D1: `/lumi-pet`.** ✅ Done 2026-11-20. `card.js` (pure), `command.js` (status/show/feed, care buttons, feed + play
menus, buy-and-feed question), `ids.js`, `links.js` (`LUMI_PUBLIC_URL`). `runPetAction` takes a list of steps for
buy-and-feed. Extra: a **🎾 Play with…** menu.
Tests: `tests/lumi/discord_pet_command.test.mjs` (21).

**D2: reminders.** ✅ Done 2026-11-20. Tables `lumi_discord_prefs` + `lumi_remind_events`; `discord/prefs.js`,
`discord/reminders.js` (erinne's sweep: catch up without a visit, once per episode, stale drops, one DM per 3 h,
quiet 22:00–07:00 on the player's clock, closed DMs switch it off, a hiccup retries); the DM is her card + 🔕 Stop;
`/lumi-pet reminders | timezone (autocomplete) | news`; Lumi Pet's settings row "Discord DMs from Lumi" (`POST
/api/lumi-pet/discord`, the browser's timezone as the default clock); `discord/view.js` holds the shared helpers;
panel knobs `lumi.discord.remindPaused` / `remindIntervalMs`.
Tests: `tests/lumi/discord_reminders.test.mjs` (10).

**D3: news.** ✅ Done 2026-11-20 (as §6). `discord/news.js`, `events.NEWS_CHANNEL`, hooks in `sgc.pay`,
`treasury.payOwed`, `showdown._settle`; `lumiTownChannelId` on the Guilds page; knobs `newsEnabled` / `newsBigWin` /
`newsBatchMs` / `newsDailyHour`.
Tests: in `tests/lumi/discord_news_activity.test.mjs`: thresholds and kinds, rolled-back prizes never posted, hidden
names, the 15-line cut, owed prizes, showdowns, the daily summary once per day.

**D4: Entry Point safety.** ✅ Done 2026-11-20. `src/commandSync.js` `setGlobalCommands()`: reads the current global
commands, carries every type-4 Entry Point over, then overwrites; if it can't read first, it overwrites nothing.
Both `controlPlane.js` overwrites use it. **Deploy this before enabling Activities in the portal.**

**D5: Activity spike.** Replaced by the docs research above; the parts the docs don't settle (SSE through the
proxy, the Origin/Host the proxy sends) are the first things to check in §9.

**D6: Activity build.** ✅ Built 2026-11-20 (as §7), off by default. Tests: the page and the bundle are served, 404
when off, sign-in sets the iframe cookie, non-members / bad codes / a stopped bot are refused.
Full suite after D2–D6: 600/600.

---

## 9. Setup Doll does

**For `/lumi-pet`, reminders and news (no portal steps):**
- `.env`: `LUMI_PUBLIC_URL=https://sadgirlsclub.wtf/lumipet` (optional; worked out from the OAuth callback otherwise).
- Web panel → Guilds → each guild that wants news: **Lumi-Town News Channel ID**. The bot needs *View Channel*, *Send
  Messages* and *Embed Links* there.
- Web panel → Economy → "Lumi-Town Discord": the reminder and news knobs (defaults are fine).
- Bot intents: none new.

**For the Activity (only after the D4 build is deployed):**
1. Portal → your bot's application → **Activities → Settings → Enable Activities**; tick the platforms under
   **Supported Platforms**.
2. **Activities → URL Mappings**, in this order:
   1. `/lumipet` → `sadgirlsclub.wtf/lumipet`
   2. `/` → `sadgirlsclub.wtf/lumipet/activity`
3. `.env`:
   - `LUMI_ACTIVITY_ENABLED=true`
   - `LUMI_FRAME_ANCESTORS=https://discord.com https://ptb.discord.com https://canary.discord.com https://<APP_ID>.discordsays.com`
   - `LUMI_TRUSTED_ORIGINS=https://sadgirlsclub.wtf,https://<APP_ID>.discordsays.com` (POSTs come from the proxy's origin)
   - `DISCORD_OAUTH_CLIENT_ID` / `DISCORD_OAUTH_CLIENT_SECRET` must be **the bot's own application** (the one with
     the Activity).
4. Restart; in Discord turn on Developer Mode, join a voice channel, start the Activity from the 🚀 menu.
5. Check: sign-in, her house, care actions, the shop, then **Lumi Town / a party / a showdown** (SSE, unverified).

## 10. Risks

- **DM spam feel.** Opt-in, one DM per 3 h, quiet hours, a Stop button on every DM, an admin pause switch.
- **Channel spam.** 2-minute batching, a 15-line cap and a size threshold, all on the panel.
- **Discord-side money bugs.** The money paths are the website's: one `runPetAction` + the shared lock + run-once keys.
- **Activity unknowns:** SSE through Discord's proxy, the Origin/Host it forwards, and links that leave `/lumipet`.
- **Entry Point**: losing it (or a refused overwrite) would break the Activity's launch button or command updates;
  `setGlobalCommands` keeps it and never overwrites blind.
- **Restart** drops a waiting news batch (fine) and the member cache (refetched). Reminder state and the "daily summary
  already posted" mark are in SQLite, so they survive restarts.

## 11. Docs to update as we go

- `docs/LUMI_USER_COMMANDS.md` + `docs/LUMI_USER_COMMANDS_SLASH.md`: `/lumi-pet` and its subcommands (D1–D3).
- `docs/LUMI_GAMES.md`: player guide (Discord care, reminders, news, Activity) + handler guide (admin rows, channel
  setup, portal steps).
- `src/lumi/CONTRACT.md`: `locks.js`, `runPetAction`, the `lumi:news` event shapes.
- `README.md` Lumi-Town section, `.env.example`.
- `docs/17-lumi-games.mmd`: add the Discord side (command, sweep, announcer, Activity proxy).
