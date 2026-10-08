// `Gio.Application`, `Gtk.Application` and `Adw.Application` on the browser (ADR 0098 §§ 1, 3).
//
// The behaviour is the core's (`@gjsify/adwaita-core`); this file is the HOST: when the platform is
// ready (`DOMContentLoaded`), how a window leaves it, and the walk that resolves `app.` / `win.`
// from an element. A web page has no process, so `quit()` removes the windows the application
// added and the tab stays.

import {
    GioApplicationBase,
    withGtkApplication,
    activateWidgetAction as activateIn,
    applicationOfWindow,
    installActionMap,
    type ApplicationHost,
} from '@gjsify/adwaita-core';

export const webHost: ApplicationHost = {
    name: 'adwaita-web',
    requiresWindow: false,
    start(body) {
        return new Promise<void>((resolve) => {
            const go = (): void => {
                body();
                resolve();
            };
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
            else go();
        });
    },
    detach(window) {
        (window as Element).remove();
    },
    exit() {},
};

/** An element's parent for action resolution; a popover is rooted at the widget that owns it. */
export function parentOfElement(node: object): object | null {
    if (!(node instanceof Element)) return null;
    const anchor = (node as { anchor?: unknown }).anchor;
    return anchor instanceof Element ? anchor : node.parentElement;
}

/** What a `Gtk.Actionable` does on activation: the action `prefix.name` found from `widget`. */
export function activateWidgetAction(widget: Element, fullName: string, parameter: unknown = null): boolean {
    return activateIn(widget, fullName, parentOfElement, parameter);
}

export class GioApplication extends GioApplicationBase {
    static override host = webHost;
}

export class GtkApplication extends withGtkApplication(GioApplication) {}

export class AdwApplication extends GtkApplication {}

type WindowApplication = { add_window(window: object): void; remove_window(window: object): void };

/**
 * `Gtk.Window:application` and the window's `Gio.ActionMap` (`win.` actions) on an element class.
 * Setting the property is `add_window`, as on GTK; setting it to `null` is `remove_window`.
 */
export function defineWindowApplication(proto: object): void {
    installActionMap(proto);
    Object.defineProperty(proto, 'application', {
        configurable: true,
        enumerable: true,
        get(this: object) {
            return applicationOfWindow(this);
        },
        set(this: object, value: WindowApplication | null) {
            const current = applicationOfWindow(this) as unknown as WindowApplication | null;
            if (current === value) return;
            current?.remove_window(this);
            value?.add_window(this);
        },
    });
}
