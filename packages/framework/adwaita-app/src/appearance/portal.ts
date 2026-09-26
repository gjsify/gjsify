// Linux: the XDG Settings portal, `org.freedesktop.portal.Settings`.
//
// The portal is the one source that works on GNOME, KDE and inside a Flatpak
// alike, so it is asked first; libadwaita does the same
// (`adw-settings-impl-portal.c`). `ReadAll` over the one namespace answers both
// keys in a single round trip and simply omits a key the backend does not
// provide, so "no accent on this desktop" needs no error handling. It is also
// interface version 1, older than `ReadOne`, so no version probe is needed.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import type { DesktopAppearance } from '@gjsify/adwaita-core';

import { appearanceFromPortal } from './mapping.js';

export const PORTAL_BUS_NAME = 'org.freedesktop.portal.Desktop';
export const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop';
export const PORTAL_SETTINGS_INTERFACE = 'org.freedesktop.portal.Settings';
export const APPEARANCE_NAMESPACE = 'org.freedesktop.appearance';

/**
 * Long enough for the portal's D-Bus ACTIVATION on first use, far below
 * GDBus's 25 s default: a reader that blocks page rendering for 25 s behind a
 * wedged portal is worse than falling back to GSettings.
 */
const PORTAL_TIMEOUT_MS = 5000;

/** Where to reach the portal. `busName` is `null` on a peer-to-peer connection (the tests). */
export interface PortalEndpoint {
    readonly connection: Gio.DBusConnection;
    readonly busName: string | null;
}

/**
 * The appearance the portal reports, or `null` when no portal answered — the
 * caller then falls back. A portal that answers with neither key yields `{}`,
 * which is an answer ("this desktop says nothing"), not a failure.
 */
export function readPortalAppearance(endpoint: PortalEndpoint): Promise<DesktopAppearance | null> {
    return new Promise((resolve) => {
        endpoint.connection.call(
            endpoint.busName,
            PORTAL_OBJECT_PATH,
            PORTAL_SETTINGS_INTERFACE,
            'ReadAll',
            new GLib.Variant('(as)', [[APPEARANCE_NAMESPACE]]),
            new GLib.VariantType('(a{sa{sv}})'),
            Gio.DBusCallFlags.NONE,
            PORTAL_TIMEOUT_MS,
            null,
            (connection, result) => {
                try {
                    const [namespaces] = (connection as Gio.DBusConnection).call_finish(result).recursiveUnpack() as [
                        Record<string, Record<string, unknown>>,
                    ];
                    resolve(appearanceFromPortal(namespaces[APPEARANCE_NAMESPACE] ?? {}));
                } catch {
                    // call_finish throws for every "no portal here" shape — ServiceUnknown with no
                    // portal installed, UnknownMethod on a backend without Settings, a timeout on a
                    // wedged one. All of them mean the same thing to the caller: ask GSettings.
                    resolve(null);
                }
            },
        );
    });
}

/**
 * Call `changed` whenever the portal announces a change in the appearance
 * namespace. Returns the unsubscribe. The caller re-reads rather than applying
 * the signal's one value, so a burst of changes collapses into one answer.
 */
export function watchPortalAppearance(endpoint: PortalEndpoint, changed: () => void): () => void {
    const id = endpoint.connection.signal_subscribe(
        endpoint.busName,
        PORTAL_SETTINGS_INTERFACE,
        'SettingChanged',
        PORTAL_OBJECT_PATH,
        APPEARANCE_NAMESPACE,
        Gio.DBusSignalFlags.NONE,
        () => changed(),
    );
    return () => endpoint.connection.signal_unsubscribe(id);
}

/** The session bus, or `null` where there is none (no `DBUS_SESSION_BUS_ADDRESS`, a CI container). */
export function sessionPortalEndpoint(): Promise<PortalEndpoint | null> {
    return new Promise((resolve) => {
        Gio.bus_get(Gio.BusType.SESSION, null, (_source, result) => {
            try {
                resolve({ connection: Gio.bus_get_finish(result), busName: PORTAL_BUS_NAME });
            } catch {
                // bus_get_finish throws when no session bus can be reached — the headless and
                // non-Linux case, which the reader answers from GSettings or not at all.
                resolve(null);
            }
        });
    });
}
