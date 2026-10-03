// Probe for GjsifyTerminal.ResizeWatcher's SIGWINCH source lifecycle.
//
// `start()` attaches a GLib source to the default main context, and that source
// holds a reference back to the watcher (it is the callback's user_data). While
// the source id was discarded nothing could release it, so a started watcher was
// immortal. The reference is observable without a terminal or a signal, so the
// probe compares two watchers in one process:
//
//   live     — started, never stopped
//   stopped  — started, then stop() twice
//
// `stop()` must leave the stopped watcher exactly one reference lighter.

import System from 'system';
import { nativeTerminal } from '@gjsify/terminal-native';

function measure() {
    const watcherClass = nativeTerminal?.ResizeWatcher;
    if (!watcherClass) return { available: false };

    const live = new watcherClass();
    live.start();
    const stopped = new watcherClass();
    stopped.start();

    // Before the fix `stop` is undefined and this throws a TypeError.
    let stopIdempotent = false;
    try {
        stopped.stop();
        stopped.stop();
        stopIdempotent = true;
    } catch {
        stopIdempotent = false;
    }

    return {
        available: true,
        stop_idempotent: stopIdempotent,
        refs_live: System.refcount(live),
        refs_stopped: System.refcount(stopped),
    };
}

// Use print() — the GJS built-in — so the output isn't mixed with console.log.
// oxlint-disable-next-line typescript/no-explicit-any -- print() is a GJS built-in not present in TypeScript's lib.dom.d.ts or @types/node
(globalThis as any).print(JSON.stringify(measure()));
