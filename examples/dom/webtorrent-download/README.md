# WebTorrent Multi-File Download

Downloads a multi-file torrent with per-file progress tracking, speed metrics, and content verification.

## What it does

1. Seeds a torrent containing 3 files (including one in a subdirectory)
2. Downloads via magnet URI with detailed progress logging
3. Logs per-file download progress, transfer speed, and peer count
4. Verifies each file's content after download completes

## What it demonstrates

- Multi-file torrent creation and download
- Per-file progress tracking via `file.progress`
- Transfer metrics: `downloadSpeed`, `downloaded`, `numPeers`
- File verification using `file.arrayBuffer()` + `TextDecoder`
- Subdirectory support in torrent file paths

## Run

```bash
yarn build && yarn start
```
