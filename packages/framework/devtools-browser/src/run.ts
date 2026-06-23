// runBrowserDevtools — one-call entry point for the `gjsify browse` CLI and any
// host launcher. Constructs an Adw.Application hosting a BrowserWindow and wires
// the opt-in devtools control plane (a no-op unless GJSIFY_DEVTOOLS is set, or
// `devtools: true`).

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import GObject from '@girs/gobject-2.0';

import { installDevtools, type DevtoolsExtension } from '@gjsify/devtools';
import { inspectorProtocolExtension } from '@gjsify/devtools-cdp';

import { browserDevtoolsExtension } from './browser-devtools-extension.js';
import { BrowserWindow } from './browser-window.js';
import type { BrowserWindowOptions } from './browser-window.js';

export interface RunBrowserDevtoolsOptions extends BrowserWindowOptions {
    /** GApplication id, e.g. `org.example.Browser`. */
    applicationId: string;
    /** Force-enable the devtools control plane (otherwise gated on `GJSIFY_DEVTOOLS`). */
    devtools?: boolean;
    /**
     * Enable WebKit's remote inspector protocol on this port (sets
     * `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:<port>` before the WebView is built)
     * and add the `Cdp*` control-plane methods (@gjsify/devtools-cdp). Drives the
     * deep protocol (Runtime/DOM/CSS/Network/Console/Debugger) over MCP.
     */
    inspectorPort?: number;
    /**
     * One-shot mode: once the initial page has loaded, capture a WebKit
     * screenshot to this path and quit. Turns `gjsify browse <url> --screenshot
     * out.png` into a build→load→shoot→exit command (CI / quick single captures).
     * For many stories in one session, drive a *running* browser over the
     * `Browser*` control plane instead (no relaunch per shot).
     */
    screenshot?: string;
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
        // Best-effort: WebKit reads WEBKIT_INSPECTOR_HTTP_SERVER once, at
        // WebKitInitialize — triggered as the first WebView type initializes,
        // which may be at module import (before this constructor). So this only
        // binds the server when WebKit has not initialized yet. The authoritative
        // place is the LAUNCHER env (`gjsify browse --inspector-port` sets it
        // before spawning gjs); direct callers should likewise export it before
        // importing this module for a guaranteed bind.
        if (options.inspectorPort !== undefined) {
            GLib.setenv('WEBKIT_INSPECTOR_HTTP_SERVER', `127.0.0.1:${options.inspectorPort}`, true);
        }
        this.connect('activate', () => this._onActivate());
    }

    private _onActivate(): void {
        if (!this._window) {
            this._window = new BrowserWindow(this, {
                title: this._options.title,
                homeUrl: this._options.homeUrl,
            });
            const extend: DevtoolsExtension[] = [
                browserDevtoolsExtension({
                    bridge: this._window.bridge,
                    core: this._window.core,
                    window: this._window,
                }),
            ];
            // When the remote inspector is enabled, make this WebView inspectable
            // (WebKitGTK gates the remote inspector server on developer-extras) and
            // expose the Cdp* deep-protocol methods.
            if (this._options.inspectorPort !== undefined) {
                this._window.bridge.get_settings().set_enable_developer_extras(true);
                extend.push(inspectorProtocolExtension({ port: this._options.inspectorPort }));
            }
            // Opt-in devtools control plane (no-op unless GJSIFY_DEVTOOLS / devtools:true).
            // Adw.ApplicationWindow does NOT expose its `win.*` actions as a
            // Gio.ActionGroup, so pass it explicitly for list_actions/activate_action.
            installDevtools(this, {
                enabled: this._options.devtools || undefined,
                winActionGroup: this._window.window as unknown as Gio.ActionGroup,
                extend,
            });
            if (this._options.screenshot) {
                this._scheduleOneShot(this._options.screenshot);
            }
        }
        this._window.present();
    }

    /**
     * One-shot screenshot: capture the page once it has loaded (plus a short
     * settle so it has painted), write it, then quit. Uses the WebKit snapshot
     * (`bridge.takeScreenshot`) — the generic GSK Screenshot would be blank
     * because WebKit composites out-of-process.
     */
    private _scheduleOneShot(path: string): void {
        const win = this._window;
        if (!win) return;
        let captured = false;
        const capture = (): void => {
            if (captured) return;
            captured = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                win.bridge
                    .takeScreenshot('full')
                    .then((bytes) => {
                        GLib.file_set_contents(path, bytes);
                        console.log(`[gjsify browse] screenshot → ${path} (${bytes.length} bytes)`);
                        this.quit();
                    })
                    .catch((error: unknown) => {
                        console.error(`[gjsify browse] screenshot failed: ${error}`);
                        this.quit();
                    });
                return GLib.SOURCE_REMOVE;
            });
        };
        win.core.onPageLoaded(() => capture());
        // Fallback if the load event never fires (e.g. a page:* built-in page).
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            capture();
            return GLib.SOURCE_REMOVE;
        });
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
