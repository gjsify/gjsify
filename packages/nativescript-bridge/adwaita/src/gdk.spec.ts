// The Gdk clipboard door of adwaita-nativescript, held to the shared vectors (real GJS is their
// oracle, in adwaita-core's `gdk.gjs.spec.ts`). The platform write is replaced by a recording host:
// the real one needs an Android or iOS runtime.

import { TYPE_INT, TYPE_STRING, Value } from '@gjsify/adwaita-core';
import {
    driveGdkClipboardVectors,
    GDK_CLIPBOARD_VECTORS,
    type GdkClipboardNamespaces,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { useClipboardHost } from './clipboard-host.js';
import * as Gdk from './namespace/gdk.js';

export default async () => {
    const written: string[] = [];
    useClipboardHost({ writeText: (text) => void written.push(text) });
    try {
        await driveGdkClipboardVectors(
            {
                name: 'adwaita-nativescript',
                isOracle: false,
                display: true,
                GObject: { TYPE_STRING, TYPE_INT, Value },
                Gdk,
                readBack: async () => written[written.length - 1] ?? null,
            } as unknown as GdkClipboardNamespaces & Parameters<typeof driveGdkClipboardVectors>[0],
            { describe, it, expect },
            GDK_CLIPBOARD_VECTORS,
        );
    } finally {
        useClipboardHost(null);
    }

    await describe('adwaita-nativescript: Gdk clipboard door', async () => {
        await it('warns, and keeps the content, on a host with no platform clipboard', () => {
            const warnings: unknown[][] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => void warnings.push(args);
            try {
                Gdk.Display.get_default().get_clipboard().set('lost');
            } finally {
                console.warn = original;
            }
            expect(warnings.length).toBe(1);
            expect(Gdk.Display.get_default().get_clipboard().get_formats().contain_gtype(TYPE_STRING)).toBe(true);
        });
    });
};
