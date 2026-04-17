// Node.js entry — WebTorrent seed + download with console logging.
//
// Serves as the reference implementation to compare against the GJS build.
// Node.js has native WebSocket (v22+) and all required builtins,
// so no polyfills are needed.

import { runTorrentDemo } from '../torrent-demo.js';

function log(tag: string, msg: string): void {
    console.log(`[${tag}] ${msg}`);
}

runTorrentDemo(log)
    .then(() => process.exit(0))
    .catch((err) => {
        log('ERROR', err?.message ?? String(err));
        process.exit(1);
    });
