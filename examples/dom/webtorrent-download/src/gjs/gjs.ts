// GJS entry — WebTorrent multi-file download with GLib MainLoop.

import GLib from 'gi://GLib?version=2.0';

import { runDownloadDemo } from '../download-demo.js';

declare const print: ((msg: string) => void) | undefined;

function log(tag: string, msg: string): void {
    if (typeof print === 'function') {
        print(`[${tag}] ${msg}`);
    } else {
        console.log(`[${tag}] ${msg}`);
    }
}

const loop = GLib.MainLoop.new(null, false);

runDownloadDemo(log)
    .then(() => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    })
    .catch((err: any) => {
        log('ERROR', err?.message ?? String(err));
        if (err?.stack) log('STACK', err.stack);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    });

loop.run();
