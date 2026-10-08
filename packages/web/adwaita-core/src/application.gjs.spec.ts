// THE ORACLE (ADR 0098 § Proof): the APPLICATION_VECTORS run against real `gi://Gtk` Application.
// A vector that fails here is a wrong vector; fix the vector. `.gjs.spec.ts` is skipped by
// `audit-runtimes.mjs`, so the dynamic `gi://` loads do not count against this package's runtimes.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveApplicationVectors, type ApplicationScene, type ApplicationSubject } from './conformance/application.js';
import type { GObjectNamespace } from './gobject.js';

type Ctor = new (params?: Record<string, unknown>) => Record<string, unknown>;
interface GioModule {
    SimpleAction: ApplicationSubject['SimpleAction'];
    ApplicationFlags: { HANDLES_OPEN: number };
}
interface GtkModule {
    init_check(): boolean;
    Application: ApplicationSubject['Application'];
    ApplicationWindow: Ctor;
    Button: Ctor;
    Box: Ctor;
    MenuButton: Ctor;
    Popover: Ctor;
}

export default async () => {
    await on('Gjs', async () => {
        const GObject = (await import('gi://GObject?version=2.0' as string)).default as GObjectNamespace;
        const Gio = (await import('gi://Gio?version=2.0' as string)).default as GioModule;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkModule;
        const hasDisplay = Gtk.init_check();

        const call = (o: unknown, m: string, ...a: unknown[]) =>
            (o as Record<string, (...args: unknown[]) => unknown>)[m]!(...a);
        const scene: ApplicationScene | undefined = hasDisplay
            ? {
                  window: (app) => new Gtk.ApplicationWindow({ application: app }),
                  buttonIn(window) {
                      const button = new Gtk.Button();
                      call(window, 'set_child', button);
                      return button;
                  },
                  popoverButtonIn(window) {
                      const button = new Gtk.Button();
                      const popover = new Gtk.Popover();
                      call(popover, 'set_child', button);
                      const menuButton = new Gtk.MenuButton();
                      call(menuButton, 'set_popover', popover);
                      const box = new Gtk.Box();
                      call(box, 'append', menuButton);
                      call(window, 'set_child', box);
                      return button;
                  },
                  loose: () => new Gtk.Button(),
                  activate: (widget, name) => {
                      const hit = { ran: false };
                      const action = name.slice(name.indexOf('.') + 1);
                      void action;
                      // `activate_action` returns whether the action was found and enabled.
                      hit.ran = call(widget, 'activate_action', name, null) === true;
                      return hit.ran;
                  },
                  addWindowAction: (window, action) => call(window, 'add_action', action),
              }
            : undefined;

        await driveApplicationVectors(
            {
                name: 'GJS (real Gtk.Application)',
                isOracle: true,
                GObject,
                Application: Gtk.Application,
                SimpleAction: Gio.SimpleAction,
                handlesOpen: Gio.ApplicationFlags.HANDLES_OPEN,
                scene,
                // The runner's own main loop is running, so `runAsync` refuses; register + activate
                // is the same startup-then-activate order. `runAsync` itself is measured standalone.
                ready: (app) => void call(app, 'register', null),
                run: async (app) => {
                    call(app, 'register', null);
                    call(app, 'activate');
                    return 0;
                },
            },
            { describe, it, expect },
        );
    });
};
