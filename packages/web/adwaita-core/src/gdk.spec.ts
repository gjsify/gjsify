// The Gdk clipboard core against the shared vectors, plus what only the core can see: the host it
// is handed, a host that fails, and the subset's refusals.

import { describe, expect, it } from '@gjsify/unit';

import { driveGdkClipboardVectors, GDK_CLIPBOARD_VECTORS } from './conformance/gdk-clipboard.js';
import { createGdk, type ClipboardHost } from './gdk.js';
import { TYPE_INT, TYPE_STRING, UnsupportedGObjectError, Value } from './gobject.js';

function recordingHost(): { host: ClipboardHost; written: string[] } {
    const written: string[] = [];
    return { host: { writeText: (text) => void written.push(text) }, written };
}

async function silenced<T>(body: () => T | Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
    const original = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
        return { result: await body(), warnings };
    } finally {
        console.warn = original;
    }
}

export default async () => {
    const { host, written } = recordingHost();
    const Gdk = createGdk(host);
    await driveGdkClipboardVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            display: true,
            GObject: { TYPE_STRING, TYPE_INT, Value },
            Gdk,
            readBack: async () => written[written.length - 1] ?? null,
        },
        { describe, it, expect },
        GDK_CLIPBOARD_VECTORS,
    );

    await describe('adwaita-core: Gdk clipboard host', async () => {
        await it('hands the host the text of each set_content, and nothing for a clear', () => {
            const { host: h, written: w } = recordingHost();
            const gdk = createGdk(h);
            const clipboard = gdk.Display.get_default().get_clipboard();
            const value = new Value().init(TYPE_STRING);
            value.set_string('one');
            clipboard.set_content(gdk.ContentProvider.new_for_value(value));
            clipboard.set('two');
            clipboard.set_content(null);
            expect(JSON.stringify(w)).toBe(JSON.stringify(['one', 'two']));
        });

        await it('keeps the local content and warns when the host throws or rejects', async () => {
            const gdk = createGdk({
                writeText: (text) => {
                    if (text === 'sync') throw new Error('denied');
                    return Promise.reject(new Error('not allowed'));
                },
            });
            const clipboard = gdk.Display.get_default().get_clipboard();
            const first = await silenced(() =>
                clipboard.set_content(gdk.ContentProvider.new_for_value(new Value().init(TYPE_STRING))),
            );
            expect(first.result).toBe(true);
            const sync = await silenced(() => clipboard.set('sync'));
            expect(sync.warnings.length).toBe(1);
            expect(clipboard.get_formats().contain_gtype(TYPE_STRING)).toBe(true);
            const rejected = await silenced(async () => {
                clipboard.set('async');
                await new Promise((resolve) => setTimeout(resolve, 5));
            });
            expect(rejected.warnings.length).toBe(1);
        });
    });

    await describe('adwaita-core: GObject.Value subset', async () => {
        await it('refuses a type other than TYPE_STRING by name', () => {
            let refused: unknown;
            try {
                new Value().init(TYPE_INT);
            } catch (error) {
                refused = error;
            }
            expect(refused instanceof UnsupportedGObjectError).toBe(true);
        });

        await it('gives no provider for an uninitialised Value and ignores it otherwise', () => {
            const gdk = createGdk(recordingHost().host);
            expect(gdk.ContentProvider.new_for_value(new Value())).toBe(null);
            const value = new Value();
            value.set_string('ignored');
            expect(value.get_string()).toBe(null);
        });

        await it('init returns the Value', () => {
            const value = new Value();
            expect(value.init(TYPE_STRING)).toBe(value);
        });
    });
};
