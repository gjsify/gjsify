// Picking a document on iOS: not implemented yet. ADR 0100 reasons about Android's Storage Access
// Framework only; `UIDocumentPickerViewController` is the iOS counterpart and still needs its own
// decision. Until then the pick is refused and the core rejects it as `Gtk.DialogError.FAILED`.

import type { FileChooserHandle } from '@gjsify/adwaita-core';

import type { SafIntentSpec } from './file-chooser-intent.js';

export function pickPlatformDocument(_intent: SafIntentSpec): Promise<FileChooserHandle | null> {
    return Promise.reject(new Error('iOS has no file picker here yet (ADR 0100 covers Android only)'));
}
