// `Gio.Application`, `Gtk.Application` and `Adw.Application` on NativeScript (ADR 0098 §§ 1, 3).
//
// The behaviour is the core's (`@gjsify/adwaita-core`); this file is the HOST: how the platform is
// started, which view is the root, and how the application ends. `runAsync` calls
// `Application.run({ create })`, and `create` emits `startup` and `activate` and returns the window
// `activate` added, so a handler that adds none rejects `runAsync` naming this.
//
// A NativeScript app has one root view: `quit()` does not take the window off the screen, it
// finishes the Activity (Android). iOS has no API to end its own process, so there it only resolves.
// Android's own lifecycle (`resume`, `suspend`) stays a `@nativescript/core` event (ADR 0098 § 3).

import { Application, GridLayout, type View } from '@nativescript/core';
import {
    GioApplicationBase,
    withGtkApplication,
    applicationOfWindow,
    installActionMap,
    type ApplicationHost,
} from '@gjsify/adwaita-core';

export const nativeScriptHost: ApplicationHost = {
    name: 'adwaita-nativescript',
    requiresWindow: true,
    start(body) {
        return new Promise<void>((resolve) => {
            Application.run({
                create() {
                    const window = body() as View | null;
                    resolve();
                    // A failed `activate` has no window; the platform still needs a root until `runAsync`
                    // rejects and `exit` ends the Activity.
                    return window ?? new GridLayout();
                },
            });
        });
    },
    detach() {},
    exit() {
        Application.android?.foregroundActivity?.finish?.();
    },
};

export class GioApplication extends GioApplicationBase {
    static override host = nativeScriptHost;
}

export class GtkApplication extends withGtkApplication(GioApplication) {
    static readonly GTypeName: string = 'GtkApplication';
}

export class AdwApplication extends GtkApplication {
    static readonly GTypeName: string = 'AdwApplication';
}

type WindowApplication = { add_window(window: object): void; remove_window(window: object): void };

/**
 * `Gtk.Window:application` and the window's `Gio.ActionMap` (`win.` actions) on a window class.
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
