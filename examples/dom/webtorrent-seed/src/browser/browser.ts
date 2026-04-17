// Browser entry — WebTorrent seed + download with DOM logging.
//
// Uses the shared torrent-demo logic. In the browser, WebTorrent's
// pre-built bundle provides all Node.js polyfills (events, path, etc.).

import { runTorrentDemo } from '../torrent-demo.js';

const logEl = document.getElementById('log')!;

function log(tag: string, msg: string): void {
    const line = `[${tag}] ${msg}\n`;
    logEl.textContent += line;
    console.log(line.trimEnd());
    logEl.scrollTop = logEl.scrollHeight;
}

runTorrentDemo(log).catch((err) => {
    log('ERROR', err?.message ?? String(err));
});
