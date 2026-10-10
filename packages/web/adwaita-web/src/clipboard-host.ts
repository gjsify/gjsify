// How the web door publishes `Gdk.Clipboard` content (ADR 0096 Amendment 2).
//
// The browser has two paths and they are not interchangeable:
//   - inside a DOM `copy` event, `event.clipboardData.setData` is synchronous and needs no
//     permission, but only until the event returns; the handler must then `preventDefault()` so the
//     browser does not replace the data with the selection. This is the path of a `copy-clipboard`
//     handler that replaces the default copy.
//   - anywhere else, `navigator.clipboard.writeText` is asynchronous and needs a secure context and
//     a user activation (or the permission); a refusal rejects and the core logs it.

import type { ClipboardHost } from '@gjsify/adwaita-core';

let copying: { data: DataTransfer; wrote: boolean } | null = null;

/**
 * Runs `run` as the handler of a DOM `copy` event: `Clipboard.set_content` calls made meanwhile
 * land in `data`. Returns whether any did, so the caller knows to `preventDefault()`.
 */
export function interceptCopy(data: DataTransfer | null, run: () => void): boolean {
    if (!data) {
        run();
        return false;
    }
    const outer = copying;
    const frame = { data, wrote: false };
    copying = frame;
    try {
        run();
    } finally {
        copying = outer;
    }
    return frame.wrote;
}

export const webClipboardHost: ClipboardHost = {
    writeText(text) {
        if (copying) {
            copying.data.setData('text/plain', text);
            copying.wrote = true;
            return;
        }
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
            return Promise.reject(new Error('navigator.clipboard is not available here'));
        }
        return navigator.clipboard.writeText(text);
    },
};
