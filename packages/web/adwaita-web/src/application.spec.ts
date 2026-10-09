// ADR 0098: the web port of `Gtk.Application`, held to the shared vectors (real GJS is their oracle,
// in adwaita-core's `application.gjs.spec.ts`) through real custom elements.
import {
    APPLICATION_VECTORS,
    driveApplicationVectors,
    unprovenVfuncs,
    type ApplicationScene,
    type ApplicationSubject,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { activateWidgetAction } from './application.js';
import { Adw, Gio, GObject, Gtk } from './index.js';
import type { GtkMenuButton } from './elements/gtk-menu-button.js';

const place = <T extends Element>(parent: Element, child: T): T => {
    parent.append(child);
    return child;
};

const made: Element[] = [];

const scene: ApplicationScene = {
    window(app) {
        const window = document.createElement('adw-application-window') as Adw.ApplicationWindow;
        window.application = app;
        document.body.append(window);
        made.push(window);
        return window;
    },
    buttonIn: (window) => place(window as Element, document.createElement('gtk-button')),
    popoverButtonIn(window) {
        const menuButton = place(window as Element, document.createElement('gtk-menu-button')) as GtkMenuButton;
        const popover = menuButton.querySelector('gtk-popover') as Element;
        return place(popover, document.createElement('gtk-button'));
    },
    loose: () => document.createElement('gtk-button'),
    activate: (widget, name) => activateWidgetAction(widget as Element, name),
    addWindowAction(window, action) {
        (window as unknown as { add_action(a: object): void }).add_action(action);
    },
};

const subject: ApplicationSubject = {
    name: 'adwaita-web',
    isOracle: false,
    GObject: GObject as unknown as ApplicationSubject['GObject'],
    Application: Gtk.Application as unknown as ApplicationSubject['Application'],
    SimpleAction: Gio.SimpleAction as unknown as ApplicationSubject['SimpleAction'],
    handlesOpen: Gio.ApplicationFlags.HANDLES_OPEN,
    scene,
};

export const ApplicationTest = async () => {
    await driveApplicationVectors(subject, { describe, it, expect });
    // The page is shared with every other suite: a window left in it moves their layout.
    for (const element of made.splice(0)) element.remove();

    await describe('adwaita-web: Application (ADR 0098 § 3)', async () => {
        await it('has a vector for every unlocked vfunc', () => {
            expect(unprovenVfuncs(APPLICATION_VECTORS, 'Gio.').length).toBe(0);
        });
        await it('Adw.Application is a Gtk.Application', () => {
            expect(Adw.Application.prototype instanceof Gtk.Application).toBe(true);
        });
        await it('quit() takes the windows it added off the page', async () => {
            const app = new Adw.Application({ application_id: 'org.gjsify.vec.WebQuit' });
            const window = scene.window(app as never) as Element;
            app.connect('activate', () => app.quit());
            await app.runAsync([]);
            expect(window.isConnected).toBe(false);
            made.length = 0;
        });
    });
};
