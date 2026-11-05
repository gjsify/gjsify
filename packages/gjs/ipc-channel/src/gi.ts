// SPDX-License-Identifier: MIT
// Gio and GLib through GJS's synchronous `imports.gi`, not a static `@girs`
// import: `@gjsify/process` loads the channel at startup and must stay free of
// a top-level `gi://` edge (the `@gjsify/utils/core` membership rule). Called
// only once a channel is actually opened, which happens on GJS alone.

import type Gio from '@girs/gio-2.0';
import type GLib from '@girs/glib-2.0';

interface GiHost {
    imports?: { gi?: { Gio?: typeof Gio; GLib?: typeof GLib } };
}

function gi(): { Gio: typeof Gio; GLib: typeof GLib } {
    const ns = (globalThis as unknown as GiHost).imports?.gi;
    if (!ns?.Gio || !ns.GLib) throw new Error('@gjsify/ipc-channel needs a GJS host (imports.gi)');
    return { Gio: ns.Gio, GLib: ns.GLib };
}

export const gio = (): typeof Gio => gi().Gio;
export const glib = (): typeof GLib => gi().GLib;
