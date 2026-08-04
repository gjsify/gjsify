// @gjsify/devtools — the opt-in entry point.
// Original implementation.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type Gtk from '@girs/gtk-4.0';
import {
    DEVTOOLS_ADDRESS_ENV,
    DEVTOOLS_ENABLE_ENV,
    DEVTOOLS_INSTANCE_ENV,
    DEVTOOLS_INTERFACE,
    devtoolsAddressFilePath,
    isDevtoolsEnabledValue,
} from '@gjsify/devtools-protocol';
import { DevtoolsService } from './devtools-service.js';
import type { InstallDevtoolsOptions } from './extension.js';
import { removeDevtoolsAddressFile, startDevtoolsPeerServer, writeDevtoolsAddressFile } from './peer-transport.js';

/** The variable that carries a session-bus address, if the platform has one. */
const SESSION_BUS_ENV = 'DBUS_SESSION_BUS_ADDRESS';

/**
 * GC root: keep each exported service (and its `Gio.DBusExportedObject`)
 * reachable for the app's lifetime. SpiderMonkey can otherwise collect a
 * wrapper that is only reachable through its own DBus export self-cycle — a
 * real failure mode seen elsewhere in this project.
 */
const activeServices = new Set<DevtoolsService>();

function envEnabled(): boolean {
    return isDevtoolsEnabledValue(GLib.getenv(DEVTOOLS_ENABLE_ENV));
}

function envValue(name: string): string | null {
    const v = GLib.getenv(name);
    return v && v !== '' ? v : null;
}

/**
 * Is there a session bus that actually ANSWERS? Not the same question as "is
 * `DBUS_SESSION_BUS_ADDRESS` set": on macOS, Homebrew's dbus advertises
 * `launchd:env=DBUS_LAUNCHD_SESSION_BUS_SOCKET`, and when that inner variable is
 * empty the address is present and unusable — the state that made every macOS
 * attempt read as an app bug. The env check comes FIRST on purpose: with the
 * variable unset, `Gio.bus_get_sync` may try to AUTOLAUNCH a bus, and spawning a
 * daemon is not something a diagnostic probe should do.
 */
function sessionBusUsable(): boolean {
    if (!envValue(SESSION_BUS_ENV)) return false;
    try {
        // The shared session connection GIO caches — the same one GApplication
        // uses, so success here means the app could have registered.
        Gio.bus_get_sync(Gio.BusType.SESSION, null);
        return true;
    } catch {
        return false;
    }
}

/** Which transport `installDevtools` uses. See {@link chooseDevtoolsTransport}. */
export type DevtoolsTransportChoice =
    /** Stand up a `Gio.DBusServer`. `address: null` = auto-pick a socket. */
    | { kind: 'peer'; address: string | null; reason: 'requested' | 'no-session-bus' }
    /** Export on the application's own session-bus connection. */
    | { kind: 'session-bus' }
    /** Nothing usable — the bus works, but this app has not registered on it yet. */
    | { kind: 'unregistered' };

/**
 * The transport PRECEDENCE, as one pure function so it is machine-checked
 * rather than merely described:
 *
 * | requested address | app has bus connection | session bus answers | choice |
 * |---|---|---|---|
 * | set   | any | any | `peer` at that address — an explicit request always wins |
 * | unset | yes | any | `session-bus` — **Linux is byte-unchanged** |
 * | unset | no  | no  | `peer`, auto-picked — this machine has no usable bus |
 * | unset | no  | yes | `unregistered` — the bus is fine, the CALL SITE is early |
 *
 * The third row is the point of the whole transport, and it AUTO-PICKS rather
 * than failing: `GJSIFY_DEVTOOLS=1` is an explicit request for a control plane,
 * and answering it with "no control plane, one line on stderr" is exactly the
 * silent absence being removed. It cannot regress Linux — a host whose bus
 * answers never reaches that row.
 *
 * The fourth row deliberately does NOT fall back. The bus works, so the honest
 * diagnosis is that `installDevtools` ran before the application registered
 * (call it from `startup`); standing a socket up there would paper over a
 * call-site bug and hide it behind a working-looking address.
 */
export function chooseDevtoolsTransport(input: {
    requestedAddress?: string | null;
    hasAppConnection: boolean;
    sessionBusUsable: boolean;
}): DevtoolsTransportChoice {
    if (input.requestedAddress) return { kind: 'peer', address: input.requestedAddress, reason: 'requested' };
    if (input.hasAppConnection) return { kind: 'session-bus' };
    if (!input.sessionBusUsable) return { kind: 'peer', address: null, reason: 'no-session-bus' };
    return { kind: 'unregistered' };
}

/**
 * The diagnostic for "no connection to export on". It must NAME THE RIGHT
 * CAUSE: the old message blamed the call site unconditionally ("call
 * installDevtools() from the startup handler"), which on macOS sent every reader
 * hunting a bug in their own app when the machine simply has no session bus.
 * Three distinguishable states, three answers.
 */
export function describeMissingConnection(sessionBusAddress: string | null, busAnswers: boolean): string {
    if (!sessionBusAddress) {
        return (
            `[gjsify-devtools] this machine has no session bus (${SESSION_BUS_ENV} is unset) — using the ` +
            `bus-less peer transport instead. Point the bridge at the address below, or set ${DEVTOOLS_ADDRESS_ENV} ` +
            'on both the app and `gjsify debug` to pin it yourself.'
        );
    }
    if (!busAnswers) {
        return (
            `[gjsify-devtools] ${SESSION_BUS_ENV} is set (${sessionBusAddress}) but no bus answers there — using ` +
            "the bus-less peer transport instead. On macOS this is the usual state: Homebrew's dbus listens on " +
            'launchd, so the advertised address only works while that socket is live.'
        );
    }
    return (
        '[gjsify-devtools] the session bus answers but this application is not registered on it yet — call ' +
        'installDevtools() from the GtkApplication "startup" handler (the bus connection and object path exist ' +
        'only after registration).'
    );
}

/**
 * Install the devtools control plane on a GTK application. A no-op returning
 * `null` unless `GJSIFY_DEVTOOLS` is set (or `options.enabled` is true), so it
 * is safe to leave in production code. Call from the application's `startup`
 * handler — the session-bus connection + object path are only available after
 * the application has registered.
 *
 * Needs NO session bus (macOS, Windows): with none, it listens on a socket of
 * its own and publishes the address. {@link chooseDevtoolsTransport} documents
 * the precedence; `options.address` / `GJSIFY_DEVTOOLS_ADDRESS` pins it.
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
    const instance = options.instance ?? envValue(DEVTOOLS_INSTANCE_ENV) ?? undefined;
    const resolved: InstallDevtoolsOptions = { ...options, instance };
    const service = new DevtoolsService(app, resolved);

    // Both getters g_return_if_fail on an UNREGISTERED application, so asking
    // before registration logs two GLib-GIO-CRITICALs and returns null anyway.
    // Reachable on purpose now: on a bus-less host installDevtools may run
    // outside `startup`, and a CRITICAL that means "there is no bus here" reads
    // like a defect.
    const registered = app.get_is_registered();
    const connection = registered ? app.get_dbus_connection() : null;
    const basePath = registered ? app.get_dbus_object_path() : null;
    const sessionBusAddress = envValue(SESSION_BUS_ENV);
    const hasAppConnection = Boolean(connection && basePath);
    // Only probed when it can change the outcome — an app that already holds a
    // bus connection has answered the question by existing.
    const busAnswers = hasAppConnection || sessionBusUsable();
    const transport = chooseDevtoolsTransport({
        requestedAddress: options.address ?? envValue(DEVTOOLS_ADDRESS_ENV),
        hasAppConnection,
        sessionBusUsable: busAnswers,
    });

    const appId = app.get_application_id() ?? 'unknown';
    // The app's own path when it has one; on a bus-less host the application
    // never registers, so derive it the way Gio.Application does (id dots →
    // slashes) — that keeps the bridge's predicted path correct either way.
    const objectPath = `${basePath ?? `/${appId.replace(/\./g, '/')}`}/devtools`;

    if (transport.kind === 'unregistered' || (transport.kind === 'peer' && transport.reason === 'no-session-bus')) {
        console.error(describeMissingConnection(sessionBusAddress, busAnswers));
    }

    if (transport.kind === 'session-bus' && connection) {
        service.export(connection, objectPath);
        // Confirm the export so "did devtools actually come up?" is answerable
        // from the app's own stderr. installDevtools only reaches here when
        // devtools is ENABLED (gate passed / opts.enabled), so this line only
        // appears when the operator explicitly turned devtools on — exactly when
        // they want the confirmation. Its ABSENCE is the diagnostic: no line ⇒
        // installDevtools was never called (e.g. a stale app bundle) or the gate
        // was off — as opposed to the previous silence, where a present-but-not-
        // exported object was indistinguishable from a not-installed one.
        console.log(`[gjsify-devtools] exported ${DEVTOOLS_INTERFACE} at ${objectPath} (dest ${appId})`);
    } else if (transport.kind === 'peer') {
        const peer = startDevtoolsPeerServer(service, objectPath, transport.address ?? undefined);
        service.attachPeerServer(peer);
        const addressFile = writeDevtoolsAddressFile(
            devtoolsAddressFilePath(GLib.get_user_runtime_dir(), appId, instance),
            peer.address,
        );
        console.log(
            `[gjsify-devtools] exported ${DEVTOOLS_INTERFACE} at ${objectPath} ` +
                `(peer address ${peer.address}${addressFile ? `, published to ${addressFile}` : ''})`,
        );
        // A dead address must not stay discoverable. GApplication::shutdown is
        // the one exit hook GJS reliably has (there is no atexit), and it fires
        // both on quit and when the last window closes.
        if (addressFile) app.connect('shutdown', () => removeDevtoolsAddressFile(addressFile));
    }

    activeServices.add(service);
    return service;
}

/** Stop exposing a previously-installed service and release its GC root. */
export function uninstallDevtools(service: DevtoolsService): void {
    service.unexport();
    activeServices.delete(service);
}
