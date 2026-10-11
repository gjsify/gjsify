// How the NativeScript door answers `Gtk.FileDialog` (ADR 0100 § 2, § 3, § 5). The subset itself —
// argument checks, the async/finish pairs, `Gio.File`, the stream — is `@gjsify/adwaita-core`'s; this
// file is the driver below it, registered on import. The picker is `./file-chooser-source.ts` and its
// `.android` variant; the intent it sends is `./file-chooser-intent.ts`.
//
// A picker the user backs out of is `Gtk.DialogError.DISMISSED`; anything the platform throws
// becomes `Gtk.DialogError.FAILED` in the core, with the cause in the message.

import {
    dismissedError,
    registerFileChooserDriver,
    type FileChooserDriver,
    type FileChooserHandle,
    type FileChooserRequest,
} from '@gjsify/adwaita-core';

import { safIntentSpec, type SafIntentSpec } from './file-chooser-intent.js';
import { pickPlatformDocument } from './file-chooser-source.js';

/** Picks one document for an intent; `null` when the user backed out. */
export type DocumentSource = (intent: SafIntentSpec, request: FileChooserRequest) => Promise<FileChooserHandle | null>;

let replacement: DocumentSource | null = null;

/** @internal A seam for the specs: `null` restores the platform's own. */
export function useDocumentSource(source: DocumentSource | null): void {
    replacement = source;
}

async function pick(kind: 'open' | 'save', request: FileChooserRequest): Promise<FileChooserHandle> {
    const intent = safIntentSpec(kind, request);
    const handle = await (replacement ? replacement(intent, request) : pickPlatformDocument(intent));
    if (handle === null) throw dismissedError();
    return handle;
}

export const nativeFileChooserDriver: FileChooserDriver = {
    open: (request) => pick('open', request),
    save: (request) => pick('save', request),
};

registerFileChooserDriver(nativeFileChooserDriver);
