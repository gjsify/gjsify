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
import { describe, expect, it } from '@gjsify/unit';

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
            expect(unprovenVfuncs(APPLICATION_VECTORS).length).toBe(0);
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
