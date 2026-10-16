// The Gtk.Application core (ADR 0098) against the shared vectors, through a test host and a
// parent-map scene. Real GJS holds the same vectors in `application.gjs.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { APPLICATION_VECTORS, driveApplicationVectors, unprovenVfuncs } from './conformance/application.js';
import type { ApplicationLike, ApplicationScene, ApplicationSubject } from './conformance/application.js';
import { GtkApplicationBase, ApplicationFlags, ApplicationInhibitFlags, type ApplicationHost } from './application.js';
import {
    SimpleAction,
    actionRegistryOf,
    activateWidgetAction,
    installActionMap,
    insertActionGroup,
    linkWindow,
} from './gio-actions.js';
import { createGObject } from './gobject.js';
import { IconTheme } from './gtk-platform.js';

const iconTheme = new IconTheme();

const host: ApplicationHost = {
    name: 'test host',
    requiresWindow: false,
    start: (body) => void body(),
    detach() {},
    exit() {},
    iconTheme: () => iconTheme,
};

class TestApplication extends GtkApplicationBase {
    static override host = host;
}

const G = createGObject({
    name: 'test door',
    dispatch() {},
    listen() {
        throw new Error('no event system');
    },
    createFromTree: () => ({ children: [], objects: {} }),
    attach() {},
    register() {},
});

const parents = new WeakMap<object, object>();
const parentOf = (node: object): object | undefined => parents.get(node);

class FakeWindow {}
installActionMap(FakeWindow.prototype);

const scene: ApplicationScene = {
    window(app: ApplicationLike) {
        const window = new FakeWindow();
        app.add_window(window);
        return window;
    },
    buttonIn(window) {
        const button = {};
        parents.set(button, window);
        return button;
    },
    popoverButtonIn(window) {
        const menuButton = {};
        const popover = {};
        const button = {};
        parents.set(menuButton, window);
        // A popover is rooted at its owner: the port supplies that as the parent.
        parents.set(popover, menuButton);
        parents.set(button, popover);
        return button;
    },
    loose: () => ({}),
    activate: (widget, name) => activateWidgetAction(widget, name, parentOf),
    addWindowAction(window, action) {
        (window as unknown as { add_action(a: object): void }).add_action(action);
    },
};

const subject: ApplicationSubject = {
    name: 'adwaita-core (test host)',
    isOracle: false,
    GObject: G,
    Application: TestApplication as unknown as ApplicationSubject['Application'],
    SimpleAction: SimpleAction as unknown as ApplicationSubject['SimpleAction'],
    handlesOpen: ApplicationFlags.HANDLES_OPEN,
    scene,
    iconTheme: () => iconTheme,
};

export default async () => {
    await driveApplicationVectors(subject, { describe, it, expect });

    await describe('Gtk.Application core (ADR 0098 § 1a)', async () => {
        await it('has a vector for every entry of UNLOCKED_VFUNCS', () => {
            expect(unprovenVfuncs(APPLICATION_VECTORS, 'Gio.').join()).toBe('');
        });

        await it('fails an entry that has no vector', () => {
            expect(unprovenVfuncs([], 'Gio.').length > 0).toBe(true);
            expect(unprovenVfuncs(APPLICATION_VECTORS, 'Gio.').length).toBe(0);
        });

        await it('rejects a runAsync that activates into a host needing a window', async () => {
            const strict: ApplicationHost = { ...host, requiresWindow: true };
            class Strict extends GtkApplicationBase {
                static override host = strict;
            }
            let message = '';
            await new Strict({ application_id: 'org.gjsify.vec.Strict' }).runAsync([]).catch((e: Error) => {
                message = e.message;
            });
            expect(message.includes('ADR 0098')).toBe(true);
        });

        await it('rejects runAsync with an exception from a handler', async () => {
            const app = new TestApplication({ application_id: 'org.gjsify.vec.Throws' });
            app.connect('activate', () => {
                throw new Error('boom');
            });
            let message = '';
            await app.runAsync([]).catch((e: Error) => {
                message = e.message;
            });
            expect(message).toBe('boom');
        });

        await it('inhibit(LOGOUT) guards the unload until the last cookie goes (gtk_application_inhibit)', () => {
            const calls: boolean[] = [];
            class Guarded extends GtkApplicationBase {
                static override host = { ...host, guardUnload: (active: boolean) => void calls.push(active) };
            }
            const app = new Guarded({ application_id: 'org.gjsify.vec.Inhibit' });
            const first = app.inhibit(null, ApplicationInhibitFlags.LOGOUT, 'unsaved');
            const second = app.inhibit(null, ApplicationInhibitFlags.LOGOUT, null);
            const idle = app.inhibit(null, ApplicationInhibitFlags.IDLE | ApplicationInhibitFlags.SUSPEND);
            expect(first > 0 && second > first && idle > second).toBe(true);
            expect(calls).toStrictEqual([true]);
            app.uninhibit(first);
            app.uninhibit(first);
            app.uninhibit(idle);
            app.uninhibit(9999);
            expect(calls).toStrictEqual([true]);
            app.uninhibit(second);
            expect(calls).toStrictEqual([true, false]);
        });

        await it('inhibit without LOGOUT never guards the unload', () => {
            const calls: boolean[] = [];
            class Guarded extends GtkApplicationBase {
                static override host = { ...host, guardUnload: (active: boolean) => void calls.push(active) };
            }
            const app = new Guarded({ application_id: 'org.gjsify.vec.InhibitOther' });
            app.uninhibit(app.inhibit(null, ApplicationInhibitFlags.SWITCH));
            expect(calls.length).toBe(0);
        });

        await it('inhibit is refused, naming itself, on a host that cannot guard', () => {
            const app = new TestApplication({ application_id: 'org.gjsify.vec.NoInhibit' });
            let message = '';
            try {
                app.inhibit(null, ApplicationInhibitFlags.LOGOUT, 'x');
            } catch (e) {
                message = (e as Error).message;
            }
            expect(message.includes('inhibit()')).toBe(true);
        });

        await it('keeps explicit groups and window links separate', () => {
            const app = new TestApplication({ application_id: 'org.gjsify.vec.Links' });
            const window = {};
            linkWindow(window, app as never);
            insertActionGroup(window, 'x', null);
            expect(actionRegistryOf(app, false) === undefined).toBe(true);
        });
    });
};
