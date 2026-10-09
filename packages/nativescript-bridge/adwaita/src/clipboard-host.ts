// How the NativeScript door publishes `Gdk.Clipboard` content (ADR 0096 Amendment 2): the platform's
// own write, `./clipboard-source.ts` and its `.android` / `.ios` variants. There is no `copy` event
// to write into here, so every write is the platform call.

import type { ClipboardHost } from '@gjsify/adwaita-core';

import { writePlatformText } from './clipboard-source.js';

let replacement: ClipboardHost | null = null;

/** @internal A seam for the specs: `null` restores the platform's own. */
export function useClipboardHost(host: ClipboardHost | null): void {
    replacement = host;
}

export const nativeClipboardHost: ClipboardHost = {
    writeText: (text) => (replacement ? replacement.writeText(text) : writePlatformText(text)),
};
