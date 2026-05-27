// GJS entry — WebTorrent streaming demo with GLib MainLoop.

import GLib from 'gi://GLib?version=2.0';

import { runStreamDemo } from '../stream-demo.js';

declare const print: ((msg: string) => void) | undefined;

function log(tag: string, msg: string): void {
    if (typeof print === 'function') {
        print(`[${tag}] ${msg}`);
    } else {
        console.log(`[${tag}] ${msg}`);
    }
}

const loop = GLib.MainLoop.new(null, false);

runStreamDemo(log)
    .then(() => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    })
    .catch((err) => {
        const e = err as Error;
        log('ERROR', e?.message ?? String(e));
        if (e?.stack) log('STACK', e.stack);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    });

loop.run();
