// THE ORACLE: the WINDOW_VECTORS run against real `gi://Gtk` windows. A vector that fails here is a
// wrong vector; fix the vector. Windows are presented, so run it under `scripts/headless-run`.
// `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`, so the dynamic `gi://` loads do not count.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveWindowVectors, WINDOW_VECTORS, type WindowSubject } from './conformance/window-members.js';

type Obj = Record<string, (...args: unknown[]) => unknown>;
interface GtkModule {
    init_check(): boolean;
    Window: new (params?: Record<string, unknown>) => object;
    Button: new () => object;
    Box: new () => object;
}

export default async () => {
    await on('Gjs', async () => {
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkModule;
        if (!Gtk.init_check()) return;

        const c = (o: object, m: string, ...a: unknown[]) => (o as Obj)[m]!(...a);
        const buttons = new WeakMap<object, [object, object]>();
        const subject: WindowSubject = {
            name: 'GJS (real Gtk.Window)',
            isOracle: true,
            capabilities: { maximizable: true, observesFocus: true, hideOnClose: true },
            create({ hideOnClose }) {
                const w = new Gtk.Window({ hide_on_close: hideOnClose ?? false });
                const box = new Gtk.Box();
                const pair: [object, object] = [new Gtk.Button(), new Gtk.Button()];
                c(box, 'append', pair[0]);
                c(box, 'append', pair[1]);
                c(w, 'set_child', box);
                buttons.set(w, pair);
                return w;
            },
            show: (w) => void c(w, 'present'),
            connect: (w, signal, handler) => c(w, 'connect', signal, handler) as number,
            close: (w) => void c(w, 'close'),
            maximize: (w) => void c(w, 'maximize'),
            unmaximize: (w) => void c(w, 'unmaximize'),
            isMaximized: (w) => c(w, 'is_maximized') as boolean,
            isVisible: (w) => c(w, 'is_visible') as boolean,
            focusables: (w) => buttons.get(w)!,
            setFocus: (w, widget) => void c(w, 'set_focus', widget),
            getFocus: (w) => c(w, 'get_focus') as object | null,
        };
        await driveWindowVectors(subject, { describe, it, expect }, WINDOW_VECTORS);
    });
};
