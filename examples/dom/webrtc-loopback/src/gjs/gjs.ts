// GJS entry — WebRTC data-channel loopback with GLib MainLoop.
//
// `gjsify build --globals auto` detects RTCPeerConnection usage and
// injects @gjsify/webrtc/register automatically.

import GLib from 'gi://GLib?version=2.0';

import { runLoopback } from '../loopback-demo.js';

declare const print: ((msg: string) => void) | undefined;

function log(tag: string, msg: string): void {
    if (typeof print === 'function') {
        print(`[${tag}] ${msg}`);
    } else {
        console.log(`[${tag}] ${msg}`);
    }
}

const loop = GLib.MainLoop.new(null, false);

runLoopback(log)
    .then(() => {
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
