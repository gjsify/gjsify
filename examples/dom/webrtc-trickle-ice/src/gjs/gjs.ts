// GJS entry — ICE candidate gathering with GLib MainLoop.

import GLib from 'gi://GLib?version=2.0';

import { runTrickleIceDemo } from '../trickle-ice-demo.js';

declare const print: ((msg: string) => void) | undefined;

function log(tag: string, msg: string): void {
    if (typeof print === 'function') {
        print(`[${tag}] ${msg}`);
    } else {
        console.log(`[${tag}] ${msg}`);
    }
}

const loop = GLib.MainLoop.new(null, false);

runTrickleIceDemo(log)
    .then((candidates) => {
        log('main', `Done — ${candidates.length} ICE candidate(s)`);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        }, null);
    })
    .catch((err: any) => {
        log('ERROR', err?.message ?? String(err));
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        }, null);
    });

loop.run();
