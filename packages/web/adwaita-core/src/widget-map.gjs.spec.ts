// THE ORACLE: the WIDGET_MAP_VECTORS run against real `gi://Gtk` widgets in a presented window. A
// vector that fails here is a wrong vector; fix the vector. Run it under `scripts/headless-run`.
// `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`, so the dynamic `gi://` loads do not count.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveWidgetMapVectors, WIDGET_MAP_VECTORS, type WidgetMapSubject } from './conformance/widget-map.js';

type Obj = Record<string, (...args: unknown[]) => unknown>;
interface GtkModule {
    init_check(): boolean;
    Window: new () => object;
    Box: new () => object;
}
interface GLibModule {
    MainContext: { default(): { iteration(mayBlock: boolean): boolean } };
}

export default async () => {
    await on('Gjs', async () => {
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkModule;
        const GLib = (await import('gi://GLib' as string)).default as GLibModule;
        if (!Gtk.init_check()) return;

        const c = (o: object, m: string, ...a: unknown[]) => (o as Obj)[m]!(...a);
        const windows: object[] = [];
        const subject: WidgetMapSubject = {
            name: 'GJS (real Gtk.Widget)',
            isOracle: true,
            box: () => new Gtk.Box(),
            append: (parent, child) => void c(parent, 'append', child),
            remove: (parent, child) => void c(parent, 'remove', child),
            present(widget) {
                const window = new Gtk.Window();
                c(window, 'set_child', widget);
                c(window, 'present');
                windows.push(window);
            },
            setVisible: (widget, visible) => void c(widget, 'set_visible', visible),
            connect: (widget, signal, handler) => c(widget, 'connect', signal, handler) as number,
            isMapped: (widget) => c(widget, 'get_mapped') as boolean,
            async settle() {
                const context = GLib.MainContext.default();
                while (context.iteration(false));
            },
            dispose() {
                for (const window of windows.splice(0)) c(window, 'destroy');
            },
        };
        await driveWidgetMapVectors(subject, { describe, it, expect }, WIDGET_MAP_VECTORS);
    });
};
