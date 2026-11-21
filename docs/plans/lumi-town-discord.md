# Lumi-Town × Discord: plan

> Status: **planning** (2026-11-20). This replaces the Discord items in Phase 7 of `lumi-games-port.md`.
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
| `/lumi-pet reminders on\|off` | DM reminders on/off (sends a test DM when turned on) | Ephemeral |
| `/lumi-pet timezone zone:<tz>` | Your clock for quiet hours (autocomplete: common IANA zones) | Ephemeral |
| `/lumi-pet news on\|off` | Whether announcements may mention you by name | Ephemeral |

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
  ✅ runs `buy` + `feed` as one `runPetAction` inside one lock, ref = the confirm interaction's id. The confirm
  expires after 60 s.
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

**Tables** (added to `createLumiSchema`):
```sql
lumi_reminders(user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
               tz TEXT,                 -- IANA zone; NULL = America/Los_Angeles
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

## 6. Channel announcements

**Where**: a new guild channel kind `lumitown`, set with the existing admin `/lumi-channel` command (one more
`addChoices` entry in `controlPlane.js`). Unset → no announcements in that guild.

**What** (each one is a tuning switch plus thresholds on `/lumi`):

| Event | Default rule | Emitted from |
|---|---|---|
| Big win | prize ≥ 2,000 SGC **or** ≥ 20× the entry | `sgc.pay` callers in the minigames |
| Showdown result | every finished showdown with ≥ 2 players | showdown hub |
| Housewarming | a player's first housewarming | `lumihouse` |
| New neighbour | a new Lumi Heights flat number | `lumicity.init()` |
| Owed prize paid | the bank ran dry and later paid what it owed | `treasury.js` |
| **Daily bank summary** | 09:00 LA: bank balance, swept in, paid out, LUMI price, top 3 winners | `treasury.status()` |

**How**: game code calls `events.publish('lumi:news', kind, data)` (one line at each site). `announce.js` subscribes,
**batches for 2 minutes** (so a hot streak is one post, not ten), and posts one embed per batch. Players with
`/lumi-pet news off` appear as "a Lumi-Town neighbour". Never posts amounts owed to a named player, and never anything
from the admin log.

---

## 7. Discord Activity (Lumi Pet inside Discord)

The biggest piece, with real unknowns, so it starts with a **spike** (D5) and builds only after the spike passes.

**How Activities work** (to confirm in the spike against Discord's current docs): Discord loads the app in an iframe at
`https://<APP_ID>.discordsays.com`. Every request goes through Discord's proxy using **URL mappings** set in the
developer portal. The page loads Discord's **Embedded App SDK**, calls `ready()`, then `authorize()` → gets a `code`
→ our server swaps it for a token with the existing client secret.

**Spike questions** (each answered with a tiny test page before any real work):
1. **URL mapping.** Map root `/` → `sadgirlsclub.wtf` so existing absolute `/lumipet/...` URLs keep working
   unchanged. Do the static files, the API and the **SSE streams** all work through the proxy? Is there a proxy
   timeout on long-lived SSE?
2. **Login inside the iframe.** The `lumi_sess` cookie is `SameSite=Lax` on our domain. Inside the Activity it is a
   third-party context. Try `SameSite=None; Secure; Partitioned` for an Activity-only session cookie first (Discord's
   desktop app is Chromium). If that fails, fall back to a short-lived **bearer token**: `lumi-boot.js` stores it and
   `common.js` adds it to every fetch, with a signed `?t=` on `EventSource` stream URLs.
3. **Framing.** `frame-ancestors 'self'` blocks Discord. Allow `https://discord.com https://*.discordsays.com` **only on
   Activity responses**, via `buildFrameAncestorsDirective` and an env list (`LUMI_ACTIVITY_FRAME_ANCESTORS`).
   nginx's own CSP header must match.
4. **Client IPs.** Through the proxy, every Activity player may share Discord's IPs. The per-IP bucket on
   `/lumipet/api/*` (and nginx `limit_req`) would lump them together. Key Activity requests by user instead.
5. **⚠️ Entry Point command.** Turning on Activities makes Discord add a **PRIMARY_ENTRY_POINT** command to the app.
   `controlPlane.js:209` bulk-overwrites the global commands with `application.commands.set(globalCommands)`. If the
   entry point isn't in that list, Discord rejects the **whole** update (error 50240), and *every* new or changed
   slash command would stop registering. Fix **before** enabling Activities: fetch the existing commands and pass
   the entry-point command through unchanged.

**Build (D6)**, if the spike passes:
- `GET /lumipet/activity`: a small entry page (auth: false) that loads the **vendored, pinned** Embedded App SDK
  bundle from `public/lumi/vendor/` (CSP stays `script-src 'self'`, no CDN), runs `ready()` → `authorize()` →
  `POST /lumipet/api/activity/session`, then goes to `/lumipet/lumi-pet`.
- `POST /lumipet/api/activity/session`: swap the code, `GET /users/@me` + the member check (same guild rule),
  create the session (cookie or token, whichever won the spike).
- An "Activity mode" flag in `LUMI_FLAGS`: hides "sign out", and makes outbound links (Visit page, Casino tables
  at `/games/`) open with the SDK's `openExternalLink` instead of navigating the iframe.
- Later (not in D6): show the other people in the voice channel as visitors in Lumi Town.

---

## 8. Phases

Each phase ends the same way as the port: `npm test` green, `node --check` on new files, a play-through on
`npm run start:3080` with a test bot in a test guild, docs updated, and Doll's go-ahead before the next phase.

**D0: plumbing.** ✅ Done 2026-11-20. `locks.js` (the lock moved out of the router), `pet/actions.js` (`POST
/api/lumi-pet/act` now calls it; same behaviour), `discord/member.js`, `discord/index.js` (registry + interaction
router, wired in `src/index.js` and the global command list in `controlPlane.js`), `LUMI_DISCORD_ENABLED`,
`isLumiReady()`, `webPanelAuth.getPanelAuthConfig` exported.
Tests: `tests/lumi/discord_plumbing.test.mjs` (15): shared lock vs the real website route, `onceRef` once-only and
rollback, input checks, member cache TTLs / shared lookups / errors not cached, the router only answering its own.
Full suite 559/559.

**D1: `/lumi-pet`.** `card.js`, `command.js`: status/show/feed, buttons, feed select, buy-and-feed confirm.
Tests: `card.test.mjs` (pure card builder: bars, low marks, button sets per task), owner-only presses, insufficient
SGC, the confirm expiring, a double-press not double-charging.

**D2: reminders.** Tables, sweep, DM, the settings toggle in Lumi Pet, `reminders` / `timezone` subcommands, admin row.
Tests: a port of erinne's `tests/test_push.py` cases (once per episode, stale drop, 3 h gap, quiet hours in a
non-LA zone, 50007 disables) with a fake DM sender.

**D3: announcements.** `lumitown` channel kind, `publish` calls at each site, batching, daily summary, `news`
subcommand, admin switches.
Tests: batching window, opt-out names, thresholds from tuning.

**D4: Entry Point safety.** The `controlPlane.js` command-sync fix from §7.5, shipped and deployed **before** anyone
enables Activities in the portal. Test with a mocked `application.commands`.

**D5: Activity spike.** Answer §7 questions 1–4 with a throwaway page. Write the findings into this file. Doll
decides go / no-go.

**D6: Activity build.** As in §7, if D5 says go.

---

## 9. Setup Doll does (Discord developer portal and `.env`)

- **Bot intents**: none new (DMs to users and posts to channels need no privileged intent; the member check uses
  `guild.members.fetch(id)` for one user).
- **D3**: run `/lumi-channel` with the new `lumitown` kind in each guild that wants news.
- **D5/D6 only**: in the portal, *Activities → Settings → Enable*, then *URL Mappings*: `/` →
  `sadgirlsclub.wtf`. **Only after D4 is deployed.**
- `.env` (also in `.env.example`):
  - `LUMI_DISCORD_ENABLED=true`
  - `LUMI_ACTIVITY_ENABLED=false` (D6 turns it on)
  - `LUMI_ACTIVITY_FRAME_ANCESTORS=https://discord.com https://*.discordsays.com`

## 10. Risks

- **DM spam feel.** Opt-in, one DM per 3 h, quiet hours and a Stop button on every DM. The admin page shows how many
  people are opted in and DMs sent today.
- **Channel spam.** 2-minute batching plus thresholds on the admin page. The default is conservative.
- **Discord-side money bugs.** The money paths are the website's, through one `runPetAction` + shared lock + ref key.
  Nothing new touches `sgc` directly.
- **Activity cookies/proxy** are the unknowns, which is why D5 is a spike with a go/no-go.
- **Entry Point 50240** would silently freeze command updates. Hence D4 ships first.
- **Restart** drops the 2-minute announcement batch in memory (fine) and the member cache (refetched). Reminder state
  is in SQLite, so it survives restarts.

## 11. Docs to update as we go

- `docs/LUMI_USER_COMMANDS.md` + `docs/LUMI_USER_COMMANDS_SLASH.md`: `/lumi-pet` and its subcommands (D1–D3).
- `docs/LUMI_GAMES.md`: player guide (Discord care, reminders, news, Activity) + handler guide (admin rows, channel
  setup, portal steps).
- `src/lumi/CONTRACT.md`: `locks.js`, `runPetAction`, the `lumi:news` event shapes.
- `README.md` Lumi-Town section, `.env.example`.
- `docs/17-lumi-games.mmd`: add the Discord side (command, sweep, announcer, Activity proxy).
