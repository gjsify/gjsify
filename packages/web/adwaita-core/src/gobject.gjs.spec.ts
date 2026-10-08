// THE ORACLE (ADR 0096 § 5): the GOBJECT_VECTORS run against real `gi://GObject`, and real Gtk
// for the template rows. A vector that fails here is a wrong vector; fix the vector.
//
// `.gjs.spec.ts` is load-bearing: `scripts/audit-runtimes.mjs` skips that suffix, so the dynamic
// `gi://` loads do not count against this package's all-`polyfill` runtime declaration. The
// modules are loaded at runtime and cast, as `@gjsify/console`'s GError suite does, to keep
// `@girs/*` out of this package's type scope and the Node bundle clean.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveGObjectVectors, type GObjectSubject } from './conformance/gobject.js';
import type { GObjectConstructor, GObjectInstance, GObjectNamespace } from './gobject.js';

interface GtkModule {
    init_check(): boolean;
    Box: GObjectConstructor;
}

type BindFlags = Record<'DEFAULT' | 'BIDIRECTIONAL' | 'SYNC_CREATE' | 'INVERT_BOOLEAN', number>;
type GObjectModule = GObjectNamespace & { BindingFlags: BindFlags };

const FLAGS = {
    bidirectional: 'BIDIRECTIONAL',
    'sync-create': 'SYNC_CREATE',
    'invert-boolean': 'INVERT_BOOLEAN',
} as const;

export default async () => {
    await on('Gjs', async () => {
        const GObject = (await import('gi://GObject?version=2.0' as string)).default as GObjectModule;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkModule;
        // Without a display Gtk cannot build a widget, so the template rows are not run; the
        // plain-GObject rows are.
        const hasDisplay = Gtk.init_check();

        const subject: GObjectSubject = {
            name: 'GJS (real gi://GObject)',
            isOracle: true,
            GObject,
            Widget: hasDisplay ? Gtk.Box : undefined,
            template: (source) => source.xml,
            bind: (source, sourceProperty, target, targetProperty, flags) => {
                const bits = flags.reduce(
                    (all, flag) => all | GObject.BindingFlags[FLAGS[flag]],
                    GObject.BindingFlags.DEFAULT,
                );
                (
                    source as unknown as {
                        bind_property(from: string, to: GObjectInstance, toProperty: string, bits: number): unknown;
                    }
                ).bind_property(sourceProperty, target, targetProperty, bits);
            },
        };

        await driveGObjectVectors(subject, { describe, it, expect });
    });
};
