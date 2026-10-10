// THE ORACLE: the GDK_CLIPBOARD_VECTORS run against real `gi://Gdk`. A vector that fails here is a
// wrong vector; fix the vector. The vectors that need a display are skipped without one.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    driveGdkClipboardVectors,
    GDK_CLIPBOARD_VECTORS,
    type GdkClipboardNamespaces,
} from './conformance/gdk-clipboard.js';

interface ReadableClipboard {
    read_text_async(cancellable: null, callback: (source: ReadableClipboard, result: unknown) => void): void;
    read_text_finish(result: unknown): string | null;
}

export default async () => {
    await on('Gjs', async () => {
        const GObject = (await import('gi://GObject?version=2.0' as string)).default;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default;
        const Gdk = (await import('gi://Gdk?version=4.0' as string)).default;
        const display = Gtk.init_check();
        await driveGdkClipboardVectors(
            {
                name: 'GJS (real Gdk)',
                isOracle: true,
                display,
                GObject,
                Gdk,
                readBack: () =>
                    new Promise((resolve) => {
                        const clipboard = Gdk.Display.get_default().get_clipboard() as ReadableClipboard;
                        clipboard.read_text_async(null, (source, result) => {
                            try {
                                resolve(source.read_text_finish(result));
                            } catch {
                                resolve(null);
                            }
                        });
                    }),
            } as GdkClipboardNamespaces & Parameters<typeof driveGdkClipboardVectors>[0],
            { describe, it, expect },
            GDK_CLIPBOARD_VECTORS,
        );
    });
};
