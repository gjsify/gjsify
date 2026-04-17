# WebTorrent Streaming

Streams torrent content chunk-by-chunk, demonstrating progressive data consumption from a P2P transfer.

## What it does

1. Generates a larger payload (~20KB, 200 lines with unique identifiers)
2. Seeds it as a torrent and downloads via magnet URI
3. Reads the downloaded file and outputs content in chunks of 20 lines
4. Shows first and last line of each chunk as preview
5. Verifies full content integrity after streaming completes

## What it demonstrates

- Larger payload handling in WebTorrent (multiple pieces)
- Chunk-based content consumption after download
- Progressive output with byte counters
- Content integrity verification via string comparison

## Run

```bash
yarn build && yarn start
```
