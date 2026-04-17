// Browser entry — WebTorrent seed + download with DOM logging.

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
