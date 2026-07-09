// @gjsify/devtools — the opt-in entry point.
// Original implementation.

import GLib from '@girs/glib-2.0';
import type Gtk from '@girs/gtk-4.0';
import { DEVTOOLS_INTERFACE } from '@gjsify/devtools-protocol';
import { DevtoolsService } from './devtools-service.js';
import type { InstallDevtoolsOptions } from './extension.js';

/**
 * GC root: keep each exported service (and its `Gio.DBusExportedObject`)
 * reachable for the app's lifetime. SpiderMonkey can otherwise collect a
 * wrapper that is only reachable through its own DBus export self-cycle — a
 * real failure mode seen elsewhere in this project.
 */
const activeServices = new Set<DevtoolsService>();

function envEnabled(): boolean {
    const v = GLib.getenv('GJSIFY_DEVTOOLS');
    if (v == null) return false;
    const t = v.toLowerCase();
    return t !== '' && t !== '0' && t !== 'false';
}

function envInstance(): string | undefined {
    const v = GLib.getenv('GJSIFY_DEVTOOLS_INSTANCE');
    return v && v !== '' ? v : undefined;
}

/**
 * Install the devtools control plane on a GTK application. A no-op returning
 * `null` unless `GJSIFY_DEVTOOLS` is set (or `options.enabled` is true), so it
 * is safe to leave in production code. Call from the application's `startup`
 * handler — the session-bus connection + object path are only available after
 * the application has registered.
 *
 * @example
 * ```ts
 * this.connect('startup', () => {
 *   installDevtools(this, { extend: [myAppDevtoolsExtension()] });
 * });
 * ```
 */
export function installDevtools(app: Gtk.Application, options: InstallDevtoolsOptions = {}): DevtoolsService | null {
    if (!(options.enabled ?? envEnabled())) return null;
    const resolved: InstallDevtoolsOptions = { ...options, instance: options.instance ?? envInstance() };
    const service = new DevtoolsService(app, resolved);

    const connection = app.get_dbus_connection();
    const basePath = app.get_dbus_object_path();
    if (connection && basePath) {
        const objectPath = `${basePath}/devtools`;
        service.export(connection, objectPath);
        // Confirm the export so "did devtools actually come up?" is answerable
        // from the app's own stderr. installDevtools only reaches here when
        // devtools is ENABLED (gate passed / opts.enabled), so this line only
        // appears when the operator explicitly turned devtools on — exactly when
        // they want the confirmation. Its ABSENCE is the diagnostic: no line ⇒
        // installDevtools was never called (e.g. a stale app bundle) or the gate
        // was off — as opposed to the previous silence, where a present-but-not-
        // exported object was indistinguishable from a not-installed one.
        console.log(
            `[gjsify-devtools] exported ${DEVTOOLS_INTERFACE} at ${objectPath} (dest ${app.get_application_id() ?? '?'})`,
        );
    } else {
        console.error(
            '[gjsify-devtools] no session-bus connection yet — call installDevtools() from the GtkApplication "startup" handler',
        );
    }

    activeServices.add(service);
    return service;
}

/** Stop exposing a previously-installed service and release its GC root. */
export function uninstallDevtools(service: DevtoolsService): void {
    service.unexport();
    activeServices.delete(service);
}
