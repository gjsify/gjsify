// The real bus behind `AccountStore`: Gio's object manager client on the session bus.
// `Gio.DBusObjectManagerClient` makes a generic `Gio.DBusProxy` per interface, with the
// properties cached from `GetManagedObjects`, so no typelib beyond Gio is needed.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { GOA_NAMESPACE, type AccountObject, type AccountStore, type Properties } from './dbus.js';

/**
 * The manager client has no timeout of its own: against a session bus that accepts the
 * connection and never answers, the call does not return. A dead bus fails in milliseconds,
 * so this only bounds the hung one (same value and reason as the libgoa driver).
 */
export const CONNECT_TIMEOUT_MS = 5_000;

const ROOT = '/org/gnome/OnlineAccounts';

function proxyOf(object: Gio.DBusObject, name: string): Gio.DBusProxy | undefined {
    return (object.get_interface(`${GOA_NAMESPACE}.${name}`) as Gio.DBusProxy | null) ?? undefined;
}

function wrap(object: Gio.DBusObject): AccountObject {
    return {
        properties(name) {
            const proxy = proxyOf(object, name);
            if (!proxy) return undefined;
            const result: Record<string, unknown> = {};
            for (const key of proxy.get_cached_property_names() ?? []) {
                result[key] = proxy.get_cached_property(key)?.deep_unpack();
            }
            return result satisfies Properties;
        },
        call(name, method, args) {
            const proxy = proxyOf(object, name);
            if (!proxy) return Promise.resolve(undefined);
            return new Promise((resolve) => {
                const params = args.length
                    ? new GLib.Variant(`(${'s'.repeat(args.length)})`, [...args] as never)
                    : null;
                proxy.call(method, params, Gio.DBusCallFlags.NONE, -1, null, (_source, result) => {
                    // A refused or unknown call raises; the caller reads that as "no answer".
                    try {
                        resolve(proxy.call_finish(result).deep_unpack() as unknown[]);
                    } catch {
                        resolve(undefined);
                    }
                });
            });
        },
    };
}

/** The store, or `undefined` when the session bus is unreachable, the name is absent or nothing answered. */
export async function connectSessionBus(timeoutMs: number = CONNECT_TIMEOUT_MS): Promise<AccountStore | undefined> {
    const cancellable = new Gio.Cancellable();
    // SOURCE_REMOVE drops the source once it fired; a client that arrives in time leaves no timer behind.
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });
    try {
        const manager = await new Promise<Gio.DBusObjectManagerClient>((resolve, reject) => {
            Gio.DBusObjectManagerClient.new_for_bus(
                Gio.BusType.SESSION,
                // Not DO_NOT_AUTO_START: the daemon is bus-activated.
                Gio.DBusObjectManagerClientFlags.NONE,
                GOA_NAMESPACE,
                ROOT,
                null,
                cancellable,
                (_source, result) => {
                    try {
                        resolve(Gio.DBusObjectManagerClient.new_for_bus_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                },
            );
        });
        // Without an owner the client is created but empty; that is "no store", not "no accounts".
        if (!manager.get_name_owner()) return undefined;
        return { objects: () => manager.get_objects().map(wrap) };
    } catch {
        // A store that cannot be reached is an answer for this package, not an error.
        return undefined;
    } finally {
        GLib.Source.remove(timer);
    }
}
