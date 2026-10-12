// What the platform does for `Gtk.show_uri` and key events — the base, for a host with none (the
// unit tests, a bundle for neither): opening is refused and the core logs it, keys never arrive.
// The platform variants sit beside this file (`.android.ts`, `.ios.ts`); the host that wraps them is
// `platform-host.ts`.

import type { View } from '@nativescript/core';

export function openPlatformUri(_uri: string): void {
    throw new Error('there is no way to open a URI on this host');
}

/** Delivers `(key, keycode, state, pressed)` for key events on `view`; returns how to stop. */
export function listenPlatformKeys(
    _view: View,
    _deliver: (key: string, keycode: number, state: number, pressed: boolean) => boolean,
): () => void {
    return () => {};
}
