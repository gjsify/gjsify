// @gjsify/devtools — the opt-in entry point.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';
import {
    appIdToObjectPath,
    DEVTOOLS_ADDRESS_ENV,
    DEVTOOLS_ENABLE_ENV,
    DEVTOOLS_INSTANCE_ENV,
    DEVTOOLS_INTERFACE,
    devtoolsAddressFilePath,
    isDevtoolsEnabledValue,
} from '@gjsify/devtools-protocol';
import { DevtoolsService } from './devtools-service.js';
import type { InstallDevtoolsOptions } from './extension.js';
import {
    DevtoolsPeerServerError,
    removeDevtoolsAddressFile,
    startDevtoolsPeerServer,
    writeDevtoolsAddressFile,
} from './peer-transport.js';

/** The variable that carries a session-bus address, if the platform has one. */
const SESSION_BUS_ENV = 'DBUS_SESSION_BUS_ADDRESS';

/**
 * GC root: keeps each exported service (and its `Gio.DBusExportedObject`) reachable for
 * the app's lifetime. SpiderMonkey otherwise collects a wrapper that is only reachable
 * through its own DBus-export self-cycle.
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
 * Is there a session bus that actually ANSWERS? A different question from "is
 * `DBUS_SESSION_BUS_ADDRESS` set": Homebrew's dbus on macOS advertises
 * `launchd:env=DBUS_LAUNCHD_SESSION_BUS_SOCKET`, and with that inner variable empty the
 * address is present and unusable — the state that made every macOS attempt read as an
 * app bug. The env check comes FIRST because `Gio.bus_get_sync` may AUTOLAUNCH a bus
 * when the variable is unset, and a diagnostic probe must not spawn a daemon.
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
 * The transport PRECEDENCE, as one pure function so a spec can check it:
 *
 * | requested address | app has bus connection | session bus answers | choice |
 * |---|---|---|---|
 * | set   | any | any | `peer` at that address — an explicit request always wins |
 * | unset | yes | any | `session-bus` — **Linux is byte-unchanged** |
 * | unset | no  | no  | `peer`, auto-picked — this machine has no usable bus |
 * | unset | no  | yes | `unregistered` — the bus is fine, the CALL SITE is early |
 *
 * Row three AUTO-PICKS rather than failing: `GJSIFY_DEVTOOLS=1` is an explicit request
 * for a control plane, so refusing it with one stderr line is the silent absence this
 * transport exists to remove. Row four deliberately does NOT fall back — the bus works,
 * so the honest diagnosis is a call site that ran before registration, and a socket
 * there would hide that behind a working-looking address.
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
 * The diagnostic for "no connection to export on", which must NAME THE RIGHT CAUSE:
 * blaming the call site unconditionally sent every macOS reader hunting a bug in their
 * own app when the machine simply has no session bus. Three states, three answers.
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
 * Needs NO session bus (macOS, Windows): with none it listens on a socket of its own
 * and publishes the address — precedence in {@link chooseDevtoolsTransport},
 * `options.address` / `GJSIFY_DEVTOOLS_ADDRESS` pins it.
 *
 * TOTAL BY CONTRACT: it never throws. Every failure is reported on stderr with the
 * address and the way out, and returns `null` like the disabled path, because callers
 * wire it into `startup`/`activate` handlers whose remaining statements GJS would
 * silently skip on a throw.
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
    const service = new DevtoolsService(app, { ...options, instance });
    try {
        return exportDevtools(app, service, options, instance);
    } catch (error) {
        // Totality, and load-bearing: consumers call this opt-in diagnostic from inside a
        // GObject handler (storybook's `activate` before `present()`, adwaita-app's
        // `startup` before `onStartup`), and GJS LOGS an exception thrown in a handler
        // while SWALLOWING it — skipping the rest of that handler. A throw here would
        // cost the consumer its window and be diagnosed as "my app hangs".
        service.unexport(); // idempotent — stops a server that did come up, retracts its address file
        console.error(
            `[gjsify-devtools] devtools stayed OFF, the app is unaffected — ${describeInstallFailure(error)}`,
        );
        return null;
    }
}

/** The failure sentence for {@link installDevtools}' log line. */
function describeInstallFailure(error: unknown): string {
    // A DevtoolsPeerServerError already carries the operator-facing sentence
    // (which address, and what to do); anything else is unexpected, so it is
    // reported verbatim rather than paraphrased into something reassuring.
    if (error instanceof DevtoolsPeerServerError) return error.message;
    return error instanceof Error ? error.message : String(error);
}

/**
 * The fallible half of {@link installDevtools}, its only caller. Every failing operation
 * lives in this ONE function, which makes the wrapper's totality structural: a new
 * throwing call added here is caught by construction.
 */
function exportDevtools(
    app: Gtk.Application,
    service: DevtoolsService,
    options: InstallDevtoolsOptions,
    instance: string | undefined,
): DevtoolsService {
    // Both getters g_return_if_fail on an UNREGISTERED application: asking before
    // registration logs two GLib-GIO-CRITICALs and returns null anyway, and on a bus-less
    // host that CRITICAL reads like a defect when it only means "no bus here".
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
    // The app's own path where it has one; on a bus-less host it never registers, so
    // derive it through the SHARED helper the bridge predicts with — one derivation, so
    // the two cannot disagree about an id GApplication rewrites (see appIdToObjectPath).
    const objectPath = `${basePath ?? appIdToObjectPath(appId)}/devtools`;

    if (transport.kind === 'unregistered' || (transport.kind === 'peer' && transport.reason === 'no-session-bus')) {
        console.error(describeMissingConnection(sessionBusAddress, busAnswers));
    }

    if (transport.kind === 'session-bus' && connection) {
        service.export(connection, objectPath);
        // Confirms the export, so "did devtools come up?" is answerable from the app's
        // own stderr. Only reachable with devtools ENABLED, so its ABSENCE is the
        // diagnostic: no line means installDevtools never ran (a stale bundle) or the
        // gate was off.
        console.log(`[gjsify-devtools] exported ${DEVTOOLS_INTERFACE} at ${objectPath} (dest ${appId})`);
    } else if (transport.kind === 'peer') {
        // Throws a DevtoolsPeerServerError when the address cannot be listened on
        // (in use, occupied by a non-socket, malformed). installDevtools catches it.
        const peer = startDevtoolsPeerServer(service, objectPath, transport.address ?? undefined);
        const addressFile = writeDevtoolsAddressFile(
            devtoolsAddressFilePath(GLib.get_user_runtime_dir(), appId, instance),
            peer.address,
        );
        // The service owns both, so `unexport()` retracts the claim together with
        // the socket it names — see DevtoolsService.unexport().
        service.attachPeerServer(peer, addressFile);
        console.log(
            `[gjsify-devtools] exported ${DEVTOOLS_INTERFACE} at ${objectPath} ` +
                `(peer address ${peer.address}${addressFile ? `, published to ${addressFile}` : ''})`,
        );
        // A dead address must not stay discoverable. GApplication::shutdown is the only
        // exit hook GJS reliably has (there is no atexit) and fires on quit and on the
        // last window closing, but GApplication handles SIGTERM only — Ctrl-C, SIGKILL
        // and a crash all skip it, and on macOS/Windows `GLib.get_user_runtime_dir()`
        // degrades to the user CACHE dir, where a leftover file survives reboots. Our own
        // SIGINT handler is not the answer (unix-only, changes an app's termination
        // semantics from inside a diagnostic, still misses SIGKILL), so the claim is
        // VERIFIED at the consumer: the bridge deletes the file when nothing answers.
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
