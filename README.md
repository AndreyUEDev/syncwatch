# Syncwatch

Watch anime together, in sync, from your own files.

Syncwatch keeps video playback aligned across friends — pause, seek and episode changes on one device happen for everyone at once — with a chat overlay on top of the video. Each participant plays their own local copy; only control commands and chat messages travel over the network (a few kilobytes), never the video itself.

## Features

- **Precise sync** — pause and seek from any participant instantly replay for everyone.
- **Local playback** — everyone opens their own file; add a folder of episodes and the playlist builds itself.
- **Chat over video** — reactions and discussion while watching.
- **Works behind NAT/VPN** — falls back to a secure relay on port 443 when a direct connection can't be made.
- **Rooms** — create a room, share a short code, friends join.

## How it works

1. Create a room and get a short code — send it to friends.
2. Everyone picks their local files (name and size are compared, mismatches are highlighted).
3. Watch in sync: playback and seeking propagate to all, with chat on top.

## Tech

Desktop app built with **Tauri** (Rust shell) and a **Svelte + Vite** frontend. Peer-to-peer control channel with a relay fallback. Windows installer via NSIS.

## Build

```bash
cd app
npm install
npm run tauri dev     # run in development
npm run tauri build   # produce the installer
```

## Website

Landing and downloads: [ajimaru.ru/syncwatch](https://ajimaru.ru/syncwatch)
