# SadGirlPlayer

A Discord bot that joins the same server voice channel as the user who requested playback and relays a live HLS `.m3u8` stream through FFmpeg.

## Requirements

- Windows with Node.js 22.12.0 or newer
- A Discord bot token
- A server where the bot can read messages, connect to voice, and speak
- FFmpeg is bundled through `ffmpeg-static` by default, but you can override it with `FFMPEG_PATH`

## Setup

1. Copy [.env.example](.env.example) to `.env`.
2. Fill in `DISCORD_TOKEN`.
3. Optionally set `DEFAULT_STREAM_URL` to a public live `.m3u8` URL.
4. Install dependencies with `npm install`.
5. Start the bot with `npm start`.

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

- `sb!play` — Join your current voice channel and play the configured default stream URL
- `sb!play <url>` — Join your current voice channel and play the supplied URL
- `sb!stop` — Stop playback and leave voice
- `sb!help` — Show command help

## Notes

- The bot supports simultaneous playback in multiple guilds. Each guild has its own independent voice session and stream pipeline.
- Each guild can have the bot in at most one voice channel at a time. Starting a new `sb!play` in the same guild replaces the previous session.
- The bot expects public HLS inputs. Protected streams that need custom headers, cookies, or tokens are not implemented yet.
- Auto-reconnect is included for dropped stream and voice failures, with bounded retry counts per session.
- The bot uses FFmpeg to strip video and encode to Opus before sending audio into Discord voice.
- On shutdown (SIGINT/SIGTERM), all active sessions across every guild are stopped cleanly before the process exits.
