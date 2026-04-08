# SadGirlPlayer

A Discord bot that joins the same server voice channel as the user who requested playback and plays YouTube, SoundCloud, search results, and direct HTTP/HLS audio through yt-dlp and FFmpeg.

## Requirements

- Windows with Node.js 22.12.0 or newer
- Python 3.11 or newer for the Lumi memory SQL service
- A Discord bot token
- A server where the bot can read messages, connect to voice, and speak
- FFmpeg is bundled through `ffmpeg-static` by default, but you can override it with `FFMPEG_PATH`
- yt-dlp for YouTube and SoundCloud playback. The bot will auto-detect `yt-dlp.exe` or `yt-dlp` in the workspace root, or you can set `YTDLP_PATH`.

## Setup

1. Copy [.env.example](.env.example) to `.env`.
2. Fill in `DISCORD_TOKEN`.
3. Put `yt-dlp.exe` in the workspace root, or set `YTDLP_PATH` to your yt-dlp binary.
4. Optionally set `DEFAULT_STREAM_URL` to a public HTTP/HLS stream URL.
5. Install dependencies with `npm install`.
6. Start the bot with `npm start`.
	- For local RTX 3080 mode with `HammerAI/llama-3-lexi-uncensored`, use `npm run start:3080`.

## Discord bot settings

Enable these privileged intents in the Discord Developer Portal:

- Message Content Intent
- Message Reactions Intent (required for starboard reposting)
- Server Members Intent is not required for the current design

Invite the bot with permissions that cover:

- View Channels
- Send Messages
- Read Message History
- Connect
- Speak

## Commands

- `sb!play` — Join your current voice channel and play `DEFAULT_STREAM_URL` if configured
- `sb!play <YouTube URL>` — Play a YouTube track
- `sb!play <SoundCloud URL>` — Play a SoundCloud track
- `sb!play <search terms>` — Search YouTube and play the first result
- `sb!play <http(s) stream URL>` — Play a direct HTTP/HLS audio stream
- `sb!stop` / `sb!leave` — Stop playback, clear the queue, and leave voice
- `sb!skip` — Skip the current track and move to the next queued track
- `sb!queue` / `sb!q` — Show the current queued tracks
- `sb!quote` — Get a random quote from the database
- `sb!quoteadd <text>` — Add a new quote to the database
- `sb!jh` — Get a random Deep Thought, by Jack Handey
- `sb!help` — Show quick command help
- `sb!readme` — Show the full command list in Discord

## Starboard

Messages that get more than 3 star reactions are reposted to the configured starboard channel.

Settings:

- `STARBOARD_CHANNEL_ID=1136106008587030548`
- `STARBOARD_MIN_STARS=4`
- `STARBOARD_EMOJI_NAME=star` (counts custom `:star:` emoji name and Unicode `⭐`)

## Autonomous Chatbot Mode (Lumi)

The bot can also run as a general-purpose chat participant in specific text channels.

Behavior defaults in this implementation:

- Channel whitelist only (`CHATBOT_CHANNEL_IDS`)
- 20% baseline unsolicited reply chance (`CHATBOT_REPLY_CHANCE=0.2`)
- Additional reply triggers for direct mentions/replies and conversational interest heuristics
- Interest trigger threshold defaults to `2` (`CHATBOT_INTEREST_THRESHOLD=2`)
- Recent back-and-forth now boosts reply likelihood inside a rolling conversation window
- Conservative per-channel cooldown (`CHATBOT_COOLDOWN_MS=15000`)
- Active conversations use a shorter follow-up cooldown (`CHATBOT_FOLLOWUP_COOLDOWN_MS=5000`)
- Conversation momentum temporarily boosts reply chance after Lumi has joined the exchange
- Sliding context window per channel (`CHATBOT_CONTEXT_MESSAGES=20`)

### LLM Infrastructure

Base env values (round-robin + failover):

- `CHATBOT_MODEL=qwen2.5:7b`
- `CHATBOT_PERSONA=...` hot-reloads from `.env` on the next model request (no restart needed)
- `LLM_ENDPOINTS=http://172.27.23.252:11434,http://172.27.23.252:11435`
- `LLM_TIMEOUT_MS=25000`
- `LLM_RETRY_LIMIT=2`
- `LLM_RETRY_BASE_DELAY_MS=1000`

Optional local RTX 3080 mode (Ollama-compatible endpoint):

- `LLM_USE_LOCAL_GPU=true`
- `LLM_LOCAL_ENDPOINT=http://127.0.0.1:11434`
- `CHATBOT_MODEL=HammerAI/llama-3-lexi-uncensored`

When local GPU mode is enabled, the local endpoint is tried first and the remaining `LLM_ENDPOINTS` are still available for retry/failover.

### Persistent Long-Term Memory

Chat context and runtime Lumi settings now persist in SQLite through a local Python service.
The bot auto-starts the service, prefers the workspace `.venv` interpreter when present, and falls back to the system Python launcher.
If the configured memory-service port is unavailable, the bot automatically picks a free localhost port for that session.

Conversation memory now also tracks per-user long-term history in dedicated SQL tables. Lumi can search those tables for context clues while chatting.

Settings:

- `CHATBOT_MEMORY_DB_FILE=data/chatbot-memory.sqlite3`
- `CHATBOT_MEMORY_PYTHON=` (optional explicit Python executable path)
- `CHATBOT_MEMORY_SERVICE_HOST=127.0.0.1`
- `CHATBOT_MEMORY_SERVICE_PORT=8765`
- `CHATBOT_MEMORY_SEARCH_LIMIT=6` (normal clue retrieval)
- `CHATBOT_MEMORY_RECALL_LIMIT=20` (deeper recall retrieval)
- `CHATBOT_MEMORY_FILE=data/chatbot-memory.json` (legacy JSON import source)
- `CHATBOT_MEMORY_FLUSH_MS=5000`

If the SQLite database is empty and the legacy JSON file exists, Lumi imports the existing memory automatically on first startup.

By default, Lumi uses the recent short-term context window (`CHATBOT_CONTEXT_MESSAGES`, default `20`).
If a message asks Lumi to remember or recall something, Lumi additionally performs a deeper search over the full SQL memory database.

### Local Memory Admin Web Page

The Python memory service now exposes a local admin page to inspect and edit runtime state, and to explore per-user SQL memory.

- URL: `http://127.0.0.1:8765/admin` (or your configured `CHATBOT_MEMORY_SERVICE_HOST` + `CHATBOT_MEMORY_SERVICE_PORT`)
- Runtime state actions: **Load from DB**, edit JSON, then **Save to DB**
- Per-user explorer: refresh user list, select a user, load latest rows, and run user-scoped search
- The page runs on the host PC through the same local service used by the bot

If the configured service port is unavailable, the bot may choose a temporary fallback localhost port for that run (check logs for the exact admin URL).

### Slash Command Control Plane (Admin UI)

Enable slash commands to manage Lumi at runtime:

- `/lumi-status`
- `/lumi-toggle enabled:true|false`
- `/lumi-set reply_chance:<0..1> interest_threshold:<n> cooldown_ms:<n> conversation_window_ms:<n> followup_cooldown_ms:<n> momentum_window_ms:<n> momentum_chance_boost:<0..1> momentum_max_reply_chance:<0..1> context_messages:<n> max_response_chars:<n>`
- `/lumi-set interest_threshold:<n>`
- `/lumi-channel action:add|remove|list channel:#channel`

Control plane settings:

- `CONTROL_PLANE_ENABLED=true`
- `SLASH_GUILD_ID=<guild-id>` for fast guild-scoped command registration (recommended)
- `ADMIN_USER_IDS=<comma-separated-user-ids>` for explicit admin override

Users with Manage Server permission can use these commands by default.

### Moderation Stack

Autonomous input/output moderation is enabled by default:

- Input filtering for empty/oversized messages and optional blocklist terms
- Optional Discord invite-link blocking
- Output mention-count cap and output-length cap

Settings:

- `MODERATION_ENABLED=true`
- `MODERATION_BLOCKLIST=<comma-separated-terms>`
- `MODERATION_MAX_INPUT_CHARS=750`
- `MODERATION_MAX_OUTPUT_CHARS=450`
- `MODERATION_MAX_MENTIONS=3`
- `MODERATION_BLOCK_INVITE_LINKS=true`

### Suggested First-Pass Tuning

- Lower noise: reduce `CHATBOT_REPLY_CHANCE` to `0.1`
- Higher activity: raise `CHATBOT_REPLY_CHANCE` to `0.3`
- More interest-triggered replies: lower `CHATBOT_INTEREST_THRESHOLD` to `1`
- Make Lumi stay in a conversation longer: raise `CHATBOT_CONVERSATION_WINDOW_MS`
- Make follow-ups feel snappier: lower `CHATBOT_FOLLOWUP_COOLDOWN_MS`
- Make Lumi cling to a live exchange more strongly: raise `CHATBOT_MOMENTUM_CHANCE_BOOST`
- Cap how eager momentum can get: lower `CHATBOT_MOMENTUM_MAX_REPLY_CHANCE`
- Longer answers: raise `CHATBOT_MAX_RESPONSE_CHARS`
- Faster turn-taking: lower `CHATBOT_COOLDOWN_MS`

### GIF Reactions (Giphy)

Lumi can optionally append a Giphy link when the reply tone fits.

Settings:

- `CHATBOT_GIF_ENABLED=true`
- `CHATBOT_GIF_CHANCE=0.35` (additional probability gate after normal reply generation)
- `GIPHY_API_KEY=<your-giphy-api-key>`
- `CHATBOT_GIF_RATING=pg-13`
- `CHATBOT_GIF_LANG=en`
- `CHATBOT_GIF_TIMEOUT_MS=5000`

If `GIPHY_API_KEY` is missing, GIF lookups are skipped automatically.

## Notes

- The bot supports simultaneous playback in multiple guilds. Each guild has its own independent voice session and queue.
- If the default stream is active, a new `sb!play` request starts the queued song immediately and the bot returns to the default stream after the queue finishes.
- If playback is already active with non-default audio, additional `sb!play` requests are added to the queue instead of replacing the current track.
- Direct HTTP/HLS streams use reconnect logic. Queued YouTube and SoundCloud tracks advance naturally when they finish.
- The bot uses yt-dlp to extract audio from YouTube and SoundCloud, then uses FFmpeg to encode Opus audio for Discord voice.
- On shutdown (SIGINT/SIGTERM), all active sessions across every guild are stopped cleanly before the process exits.
