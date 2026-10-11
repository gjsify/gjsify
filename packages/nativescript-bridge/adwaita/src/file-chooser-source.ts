// Picking a document — the base, for a host with no picker (the unit tests, iOS until ADR 0100 reasons
// about its document picker): the pick is refused, and the core rejects it as `Gtk.DialogError.FAILED`.
// The Android variant sits beside this file; the host that wraps it is `file-chooser-host.ts`.

import type { FileChooserHandle } from '@gjsify/adwaita-core';

import type { SafIntentSpec } from './file-chooser-intent.js';

/** Resolves the picked document, or `null` when the user backed out of the picker. */
export function pickPlatformDocument(_intent: SafIntentSpec): Promise<FileChooserHandle | null> {
    return Promise.reject(new Error('there is no platform file picker on this host'));
}
