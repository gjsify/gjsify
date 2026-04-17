// Browser entry — WebRTC data-channel loopback with DOM logging.

import { runLoopback } from '../loopback-demo.js';

const logEl = document.getElementById('log')!;

function log(tag: string, msg: string): void {
    const line = `[${tag}] ${msg}\n`;
    logEl.textContent += line;
    console.log(line.trimEnd());
    // Auto-scroll to bottom
    logEl.scrollTop = logEl.scrollHeight;
}

runLoopback(log).catch((err) => {
    log('ERROR', err?.message ?? String(err));
});
