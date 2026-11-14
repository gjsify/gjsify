// Start-at-login and background permission with libportal's semantics, on a Linux host with or
// without a Background portal (ADR 0144 § 2).
//
// This module never imports `gi://Xdp` statically: a deb/rpm host without the typelib would stop
// the whole app at link time, which is the failure Beifahrer's lazy loader exists to avoid. The
// typelib is loaded at the first call instead, and its absence reads as "no portal".

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import type Xdp from 'gi://Xdp?version=1.0';

import { applyAutostartFile } from './autostart-file.js';
import { classifyProbeError, outcomeOf, wantsAutostart, type BackgroundOutcome } from './wish.js';

export { AUTOSTART_FLAG, wantsAutostart, type BackgroundOutcome } from './wish.js';

const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const BACKGROUND_INTERFACE = 'org.freedesktop.portal.Background';

/** The four members of the subset (ADR 0144 § 1), so a test can hand in a stand-in. */
export type BackgroundPortal = Pick<
    Xdp.Portal,
    'request_background' | 'request_background_finish' | 'set_background_status' | 'set_background_status_finish'
>;

export interface BackgroundRequest {
    /** Must equal the desktop file's basename; it also names the fallback autostart file. */
    readonly appId: string;
    /** `Name=` of the fallback file; defaults to the app id. */
    readonly name?: string;
    /** Shown in the portal's dialog. Not used by the fallback, which asks nothing. */
    readonly reason?: string;
    /** What starts at login. Required by the fallback; the portal derives a default without it. */
    readonly commandline?: readonly string[];
    /** `Xdp.BackgroundFlags` bits; without AUTOSTART the request removes an existing entry. */
    readonly flags: number;
    readonly parent?: Xdp.Parent | null;
    readonly cancellable?: Gio.Cancellable | null;
}

/** The seams a test replaces. Everything defaults to the real host. */
export interface BackgroundHost {
    sessionBus(): Promise<Gio.DBusConnection>;
    /** The libportal client, or `null` when the typelib is not installed. */
    loadPortal(): Promise<BackgroundPortal | null>;
    configDir(): string;
}

export const realHost: BackgroundHost = {
    sessionBus: () =>
        new Promise((resolve, reject) => {
            Gio.bus_get(Gio.BusType.SESSION, null, (_source, result) => {
                try {
                    resolve(Gio.bus_get_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        }),
    async loadPortal() {
        let module: { default: typeof Xdp };
        try {
            module = await import('gi://Xdp?version=1.0');
        } catch {
            // The import throws when the typelib is not installed; that is the "no libportal" answer.
            return null;
        }
        return new module.default.Portal();
    },
    configDir: () => GLib.get_user_config_dir(),
};

function call(bus: Gio.DBusConnection): Promise<unknown> {
    return new Promise((resolve, reject) => {
        bus.call(
            PORTAL_NAME,
            PORTAL_PATH,
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', [BACKGROUND_INTERFACE, 'version']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (source, result) => {
                try {
                    resolve((source as Gio.DBusConnection).call_finish(result));
                } catch (error) {
                    reject(error);
                }
            },
        );
    });
}

/**
 * Is there a Background portal on the session bus? Only "nobody serves it" returns `'absent'`;
 * a portal that answers with any other error is broken and the error is thrown, because falling
 * through to a file there would override a portal that said no.
 */
export async function probeBackgroundPortal(host: Pick<BackgroundHost, 'sessionBus'>): Promise<'present' | 'absent'> {
    let bus: Gio.DBusConnection;
    try {
        bus = await host.sessionBus();
    } catch {
        // No session bus at all (a tarball on a bare session) is the strongest form of "no portal".
        return 'absent';
    }
    try {
        await call(bus);
        return 'present';
    } catch (error) {
        const remote = error instanceof GLib.Error ? Gio.DBusError.get_remote_error(error) : null;
        if (classifyProbeError(remote) === 'absent') return 'absent';
        throw error;
    }
}

/**
 * libportal's `request_background`, with a fallback for a host that has no Background portal.
 * Resolves `granted` or `denied`; a cancelled request rejects with `Gio.IOErrorEnum.CANCELLED`
 * and a broken portal rejects with its error. The fallback writes or deletes
 * `$XDG_CONFIG_HOME/autostart/<app-id>.desktop`, asks nothing, and so resolves `granted`.
 */
export async function requestBackground(
    request: BackgroundRequest,
    host: BackgroundHost = realHost,
): Promise<BackgroundOutcome> {
    request.cancellable?.set_error_if_cancelled();

    const portal = (await probeBackgroundPortal(host)) === 'present' ? await host.loadPortal() : null;
    if (portal === null) {
        if (!request.commandline) {
            throw GLib.Error.new_literal(
                Gio.io_error_quark(),
                Gio.IOErrorEnum.INVALID_ARGUMENT,
                'requestBackground: without a Background portal a command line is needed to write the autostart file',
            );
        }
        applyAutostartFile({
            appId: request.appId,
            name: request.name ?? request.appId,
            commandline: request.commandline,
            autostart: wantsAutostart(request.flags),
            configDir: host.configDir(),
        });
        return 'granted';
    }

    const granted = await new Promise<boolean>((resolve, reject) => {
        portal.request_background(
            request.parent ?? null,
            request.reason ?? null,
            request.commandline ? [...request.commandline] : null,
            request.flags,
            request.cancellable ?? null,
            (_source, result) => {
                try {
                    resolve(portal.request_background_finish(result));
                } catch (error) {
                    reject(error);
                }
            },
        );
    });
    return outcomeOf(granted);
}

/**
 * libportal's `set_background_status`. Without a portal there is no status line to set, so it
 * completes and changes nothing observable: a decoration call that throws makes every consumer
 * write a `try` that means nothing (ADR 0144 § 1).
 */
export async function setBackgroundStatus(
    message: string | null,
    cancellable: Gio.Cancellable | null = null,
    host: BackgroundHost = realHost,
): Promise<void> {
    cancellable?.set_error_if_cancelled();
    const portal = (await probeBackgroundPortal(host)) === 'present' ? await host.loadPortal() : null;
    if (portal === null) return;

    await new Promise<void>((resolve, reject) => {
        portal.set_background_status(message, cancellable, (_source, result) => {
            try {
                portal.set_background_status_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}
