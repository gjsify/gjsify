// ADR 0098: the NativeScript port of `Gtk.Application`, held to the shared vectors (real GJS is their
// oracle, in adwaita-core's `application.gjs.spec.ts`) through the real widgets. On the TREES entry
// for the reason `grid-layout.spec.ts` gives.
//
// The one vector this port does not run is the popover one: `Gtk.MenuButton` here has no popover
// (its header says so), so there is no button inside one to resolve from.

import {
    APPLICATION_VECTORS,
    driveApplicationVectors,
    unprovenVfuncs,
    type ApplicationLike,
    type ApplicationScene,
    type ApplicationSubject,
} from '@gjsify/adwaita-core/conformance';
import type { HostKeyEvent } from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

import { nativePlatformHost } from './platform-host.js';
import { activateWidgetAction } from './widgets/actions.js';
import * as Adw from './namespace/adw.js';
import * as Gio from './namespace/gio.js';
import * as GObject from './namespace/gobject.js';
import * as Gtk from './namespace/gtk.js';

const tap = (button: object): void => (button as Gtk.Button).notify({ eventName: 'tap', object: button as never });

const scene: ApplicationScene = {
    window: (app) => new Adw.ApplicationWindow({ application: app as never }),
    buttonIn(window) {
        const box = new Gtk.Box();
        (window as Adw.ApplicationWindow).content = box as never;
        const button = new Gtk.Button();
        box.append(button as never);
        return button;
    },
    popoverButtonIn: () => {
        throw new Error('Gtk.MenuButton has no popover on NativeScript');
    },
    loose: () => new Gtk.Button(),
    activate: (widget, name) => activateWidgetAction(widget as never, name),
    addWindowAction(window, action) {
        (window as unknown as { add_action(a: object): void }).add_action(action);
    },
};

/**
 * The vectors that add no window are programs a platform with a root view cannot run (ADR 0098 § 3:
 * `activate` must add one). This gives them the window and takes it away a tick later, which is
 * what GIO's "holds nothing" ending looks like here.
 */
const run = (app: ApplicationLike): Promise<number> => {
    app.connect('activate', () => {
        const window = scene.window(app);
        void Promise.resolve().then(() => app.remove_window(window));
    });
    return app.runAsync([]);
};

const subject: ApplicationSubject = {
    name: 'adwaita-nativescript',
    isOracle: false,
    GObject: GObject as unknown as ApplicationSubject['GObject'],
    Application: Gtk.Application as unknown as ApplicationSubject['Application'],
    SimpleAction: Gio.SimpleAction as unknown as ApplicationSubject['SimpleAction'],
    handlesOpen: Gio.ApplicationFlags.HANDLES_OPEN,
    scene,
    iconTheme: () => Gtk.IconTheme.get_for_display(null),
};

const portVectors = APPLICATION_VECTORS.filter((vector) => !vector.rule.includes('in a popover'));

export const AdwApplicationNsTest = async () => {
    const harness = { describe, it, expect };
    await driveApplicationVectors(
        subject,
        harness,
        portVectors.filter((vector) => vector.windowed),
    );
    await driveApplicationVectors(
        { ...subject, name: 'adwaita-nativescript (window supplied)', run },
        harness,
        portVectors.filter((vector) => !vector.windowed),
    );

    await describe('adwaita-nativescript: Application (ADR 0098 § 3)', async () => {
        await it('has a vector for every unlocked vfunc', () => {
            expect(unprovenVfuncs(APPLICATION_VECTORS, 'Gio.').length).toBe(0);
        });
        await it('Adw.Application is a Gtk.Application is a Gio.Application', () => {
            expect(Adw.Application.prototype instanceof Gtk.Application).toBe(true);
            expect(Gtk.Application.prototype instanceof Gio.Application).toBe(true);
        });
        await it('rejects runAsync when activate adds no window, naming the rule', async () => {
            const app = new Gtk.Application({ application_id: 'org.gjsify.vec.NsNoWindow' });
            let message = '';
            try {
                await app.runAsync([]);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('added no window')).toBe(true);
        });
        await it('every window class has application, get_application and set_application', () => {
            const app = new Adw.Application({ application_id: 'org.gjsify.vec.NsWindowApp' });
            const other = new Adw.Application({ application_id: 'org.gjsify.vec.NsWindowOther' });
            for (const Window of [Gtk.Window, Gtk.ApplicationWindow, Adw.Window, Adw.ApplicationWindow]) {
                const window = new Window() as unknown as Gtk.WindowCommon<object>;
                const notified: unknown[] = [];
                (window as unknown as Gtk.Window).connect('notify::application', (_self, data) =>
                    notified.push((data as unknown as { value: unknown }).value),
                );
                expect(window.get_application()).toBe(null);
                window.set_application(app as never);
                expect(window.get_application()).toBe(app);
                expect(window.application).toBe(app);
                expect(app.get_windows().includes(window)).toBe(true);
                window.set_application(other as never);
                expect(app.get_windows().includes(window)).toBe(false);
                expect(other.get_windows().includes(window)).toBe(true);
                window.application = null;
                expect(window.get_application()).toBe(null);
                expect(notified).toStrictEqual([app, other, null]);
            }
        });
        await it('a window reaches inhibit through get_application()', () => {
            const app = new Adw.Application({ application_id: 'org.gjsify.vec.NsWindowInhibit' });
            const window = new Gtk.Window() as unknown as Gtk.WindowCommon<object>;
            window.set_application(app as never);
            const cookie = window.get_application()?.inhibit(window, Gtk.ApplicationInhibitFlags.LOGOUT, 'unsaved');
            expect(typeof cookie).toBe('number');
            window.get_application()?.uninhibit(cookie ?? 0);
            window.set_application(null);
        });
        // The base `listenPlatformKeys` never delivers (iOS and the unit tests), so the wiring is
        // tested through a host whose `listenKeys` hands over its handler.
        await it('hardware keys delivered to the window run the accelerator', () => {
            const original = nativePlatformHost.listenKeys;
            let handler: ((event: HostKeyEvent) => boolean) | undefined;
            let stopped = false;
            nativePlatformHost.listenKeys = (_widget, h) => {
                handler = h;
                return () => {
                    stopped = true;
                };
            };
            try {
                const app = new Adw.Application({ application_id: 'org.gjsify.vec.NsAccel' });
                const window = scene.window(app as never) as Adw.ApplicationWindow;
                const hits: unknown[] = [];
                for (const [owner, name] of [
                    [app, 'save'],
                    [window, 'open'],
                ] as const) {
                    const action = new Gio.SimpleAction({ name });
                    action.connect('activate', () => hits.push(name));
                    (owner as unknown as { add_action(a: object): void }).add_action(action);
                }
                app.set_accels_for_action('app.save', ['<Primary>s']);
                app.set_accels_for_action('win.open', ['<Primary><Shift>o']);
                const key = (k: string, state: number) => handler!({ key: k, keycode: 0, state, pressed: true });
                expect(key('s', 4)).toBe(true);
                expect(key('O', 5)).toBe(true);
                expect(key('s', 0)).toBe(false);
                expect(hits).toStrictEqual(['save', 'open']);
                (window as Adw.ApplicationWindow).application = null;
                expect(stopped).toBe(true);
            } finally {
                nativePlatformHost.listenKeys = original;
            }
        });
        await it('Gtk.ApplicationWindow is a Gio.ActionMap whose actions resolve as win.<name>', () => {
            const window = new Gtk.ApplicationWindow() as unknown as Gtk.Window & {
                add_action(a: object): void;
                lookup_action(name: string): object | null;
                remove_action(name: string): void;
            };
            const hit: string[] = [];
            const action = new Gio.SimpleAction({ name: 'save' });
            action.connect('activate', () => hit.push('save'));
            expect(window.lookup_action('save')).toBe(null);
            window.add_action(action);
            expect(window.lookup_action('save')).toBe(action);
            expect(activateWidgetAction(window as never, 'win.save')).toBe(true);
            expect(hit).toStrictEqual(['save']);
            window.remove_action('save');
            window.remove_action('save');
            expect(window.lookup_action('save')).toBe(null);
            expect(activateWidgetAction(window as never, 'win.save')).toBe(false);
        });
        await it('a button in the window resolves app. and win. through View.parent', async () => {
            const app = new Adw.Application({ application_id: 'org.gjsify.vec.NsResolve' });
            const hit: string[] = [];
            app.connect('activate', () => {
                const window = scene.window(app as never) as Adw.ApplicationWindow;
                for (const [name, tag] of [
                    ['x', 'app'],
                    ['y', 'win'],
                ] as const) {
                    const action = new Gio.SimpleAction({ name });
                    action.connect('activate', () => hit.push(tag));
                    ((tag === 'app' ? app : window) as unknown as { add_action(a: object): void }).add_action(action);
                }
                const button = scene.buttonIn(window) as Gtk.Button;
                button.actionName = 'app.x';
                tap(button);
                button.actionName = 'win.y';
                tap(button);
                app.quit();
            });
            await app.runAsync([]);
            expect(hit).toStrictEqual(['app', 'win']);
        });
    });
};
