// The Gdk clipboard door of adwaita-web, held to the shared vectors (real GJS is their oracle, in
// adwaita-core's `gdk.gjs.spec.ts`), plus what only a browser shows: the async Clipboard API for a
// write outside an event, and the `copy` event's `clipboardData` inside one. Neither needs the
// permission: `navigator.clipboard` is replaced by a recording fake, and the event carries a
// `DataTransfer` the test reads.

import { driveGdkClipboardVectors, type GdkClipboardNamespaces } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { GtkSourceView } from './gtksource/gtk-source-view.js';
import * as Gdk from './namespace/gdk.js';
import * as GObject from './namespace/gobject.js';

async function withClipboardApi<T>(
    api: { writeText(text: string): Promise<void> },
    body: () => Promise<T>,
): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: api, configurable: true });
    try {
        return await body();
    } finally {
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const GdkTest = async () => {
    const written: string[] = [];
    await withClipboardApi({ writeText: async (text) => void written.push(text) }, () =>
        driveGdkClipboardVectors(
            {
                name: 'adwaita-web',
                isOracle: false,
                display: true,
                GObject,
                Gdk,
                readBack: async () => {
                    await tick();
                    return written[written.length - 1] ?? null;
                },
            } as unknown as GdkClipboardNamespaces & Parameters<typeof driveGdkClipboardVectors>[0],
            { describe, it, expect },
        ),
    );

    await describe('adwaita-web: Gdk clipboard door', async () => {
        const mounted = () => {
            const view = document.createElement('gtk-source-view') as GtkSourceView;
            document.body.append(view);
            return view;
        };
        const copyEvent = () =>
            new ClipboardEvent('copy', { cancelable: true, bubbles: true, clipboardData: new DataTransfer() });
        const setText = (text: string) => {
            const value = new GObject.Value().init(GObject.TYPE_STRING);
            value.set_string(text);
            Gdk.Display.get_default().get_clipboard().set_content(Gdk.ContentProvider.new_for_value(value));
        };

        await it('writes into the copy event when a copy-clipboard handler replaces the default copy', () => {
            const view = mounted();
            view.buffer.text = 'ff 00';
            view.textarea.setSelectionRange(0, 2);
            view.connect_after('copy-clipboard', () => setText('0xFF'));
            const event = copyEvent();
            view.textarea.dispatchEvent(event);
            expect(event.clipboardData?.getData('text/plain')).toBe('0xFF');
            expect(event.defaultPrevented).toBe(true);
            view.remove();
        });

        await it('leaves the browser copy alone when no handler wrote anything', () => {
            const view = mounted();
            const event = copyEvent();
            view.textarea.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            view.remove();
        });

        await it('publishes through navigator.clipboard outside a copy event', async () => {
            const seen: string[] = [];
            await withClipboardApi({ writeText: async (text) => void seen.push(text) }, async () => {
                setText('outside');
                await tick();
            });
            expect(seen[0]).toBe('outside');
        });

        await it('warns, and keeps the content, when the browser refuses the write', async () => {
            const warnings: unknown[][] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => void warnings.push(args);
            try {
                await withClipboardApi({ writeText: () => Promise.reject(new Error('NotAllowedError')) }, async () => {
                    setText('refused');
                    await tick();
                });
            } finally {
                console.warn = original;
            }
            expect(warnings.length).toBe(1);
            expect(Gdk.Display.get_default().get_clipboard().get_formats().to_string()).toBe(
                'gchararray text/plain;charset=utf-8 text/plain',
            );
        });

        await it('puts get_display and get_clipboard on a registered class', () => {
            const Widget = GObject.registerClass({ GTypeName: 'GdkSpecWidget' }, class extends HTMLElement {});
            const widget = new (Widget as unknown as new () => { get_display(): unknown; get_clipboard(): unknown })();
            expect(widget.get_display()).toBe(Gdk.Display.get_default());
            expect(widget.get_clipboard()).toBe(Gdk.Display.get_default().get_clipboard());
        });
    });
};
