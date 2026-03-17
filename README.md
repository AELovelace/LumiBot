# SadGirlPlayer

A Discord bot that joins the same server voice channel as the user who requested playback and plays YouTube, SoundCloud, search results, and direct HTTP/HLS audio through yt-dlp and FFmpeg.

## Requirements

- Windows with Node.js 22.12.0 or newer
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

## Discord bot settings

Enable these privileged intents in the Discord Developer Portal:

- Message Content Intent
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

## Notes

- The bot supports simultaneous playback in multiple guilds. Each guild has its own independent voice session and queue.
- If the default stream is active, a new `sb!play` request starts the queued song immediately and the bot returns to the default stream after the queue finishes.
- If playback is already active with non-default audio, additional `sb!play` requests are added to the queue instead of replacing the current track.
- Direct HTTP/HLS streams use reconnect logic. Queued YouTube and SoundCloud tracks advance naturally when they finish.
- The bot uses yt-dlp to extract audio from YouTube and SoundCloud, then uses FFmpeg to encode Opus audio for Discord voice.
- On shutdown (SIGINT/SIGTERM), all active sessions across every guild are stopped cleanly before the process exits.
