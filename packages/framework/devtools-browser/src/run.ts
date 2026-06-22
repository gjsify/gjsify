// runBrowserDevtools — one-call entry point for the `gjsify browse` CLI and any
// host launcher. Constructs an Adw.Application hosting a BrowserWindow and wires
// the opt-in devtools control plane (a no-op unless GJSIFY_DEVTOOLS is set, or
// `devtools: true`).

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GObject from '@girs/gobject-2.0';

import { installDevtools } from '@gjsify/devtools';

import { browserDevtoolsExtension } from './browser-devtools-extension.js';
import { BrowserWindow } from './browser-window.js';
import type { BrowserWindowOptions } from './browser-window.js';

export interface RunBrowserDevtoolsOptions extends BrowserWindowOptions {
    /** GApplication id, e.g. `org.example.Browser`. */
    applicationId: string;
    /** Force-enable the devtools control plane (otherwise gated on `GJSIFY_DEVTOOLS`). */
    devtools?: boolean;
}

/**
 * Hosts the browser window and installs devtools on activate. Devtools is wired
 * at activate time (when the application is registered, so its session-bus
 * connection + object path are available — same timing as the storybook app).
 */
export class BrowserApplication extends Adw.Application {
    private _window: BrowserWindow | null = null;
    private _options: RunBrowserDevtoolsOptions;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyBrowserApplication' }, BrowserApplication);
    }

    constructor(options: RunBrowserDevtoolsOptions) {
        super({
            application_id: options.applicationId,
            flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
        });
        this._options = options;
        this.connect('activate', () => this._onActivate());
    }

    private _onActivate(): void {
        if (!this._window) {
            this._window = new BrowserWindow(this, {
                title: this._options.title,
                homeUrl: this._options.homeUrl,
            });
            // Opt-in devtools control plane (no-op unless GJSIFY_DEVTOOLS / devtools:true).
            // Adw.ApplicationWindow does NOT expose its `win.*` actions as a
            // Gio.ActionGroup, so pass it explicitly for list_actions/activate_action.
            installDevtools(this, {
                enabled: this._options.devtools || undefined,
                winActionGroup: this._window.window as unknown as Gio.ActionGroup,
                extend: [
                    browserDevtoolsExtension({
                        bridge: this._window.bridge,
                        core: this._window.core,
                        window: this._window,
                    }),
                ],
            });
        }
        this._window.present();
    }
}

GObject.type_ensure(BrowserApplication.$gtype);

/**
 * Construct and run a browser application, resolving with its exit code.
 */
export async function runBrowserDevtools(options: RunBrowserDevtoolsOptions): Promise<number> {
    const app = new BrowserApplication(options);
    return app.runAsync([imports.system.programInvocationName, ...ARGV]);
}
