// @gjsify/devtools-mcp — session-bus client for the org.gjsify.Devtools control plane.
// DBus-call mechanics adapted from the PixelRPG map-editor (apps/mcp-bridge/src/index.ts).
// Copyright (c) PixelRPG. MIT.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { type BusAddress, DEVTOOLS_INTERFACE, resolveBusAddress } from '@gjsify/devtools-protocol';

const DBUS_IFACE = 'org.freedesktop.DBus';

/**
 * Talks the `org.gjsify.Devtools` control plane of a running app over the
 * session bus. One per bridge process; resolves a per-instance bus address
 * from the app's base id + an optional instance label.
 */
export class DbusDevtoolsClient {
    private readonly _bus: Gio.DBusConnection;

    constructor(readonly busNameBase: string) {
        this._bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    }

    resolve(label?: string): BusAddress {
        return resolveBusAddress(this.busNameBase, label);
    }

    /** Async call to an instance's Devtools interface; resolves with the reply variant. */
    control(
        label: string | undefined,
        method: string,
        params: GLib.Variant | null,
        replyType: string | null,
    ): Promise<GLib.Variant> {
        const { busName, objectPath } = this.resolve(label);
        return new Promise((res, rej) => {
            this._bus.call(
                busName,
                objectPath,
                DEVTOOLS_INTERFACE,
                method,
                params,
                replyType ? GLib.VariantType.new(replyType) : null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (conn, r) => {
                    try {
                        res((conn as Gio.DBusConnection).call_finish(r));
                    } catch (error) {
                        rej(error);
                    }
                },
            );
        });
    }

    /** Call a `() -> (s)` method and return its JSON string (pretty-printed). */
    async jsonCall(label: string | undefined, method: string, params: GLib.Variant | null = null): Promise<string> {
        const reply = await this.control(label, method, params, '(s)');
        const [json] = reply.recursiveUnpack() as [string];
        return JSON.stringify(JSON.parse(json), null, 2);
    }

    /** Whether `busName` currently has an owner (the app is running). */
    nameHasOwner(busName: string): Promise<boolean> {
        return new Promise((res) => {
            this._bus.call(
                DBUS_IFACE,
                '/org/freedesktop/DBus',
                DBUS_IFACE,
                'NameHasOwner',
                GLib.Variant.new_tuple([GLib.Variant.new_string(busName)]),
                GLib.VariantType.new('(b)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (conn, r) => {
                    try {
                        res(((conn as Gio.DBusConnection).call_finish(r).recursiveUnpack() as unknown[])[0] as boolean);
                    } catch {
                        res(false);
                    }
                },
            );
        });
    }

    /** Enumerate devtools-enabled instances on the bus (base + labelled). */
    listInstances(): Promise<Array<{ instance: string; busName: string }>> {
        return new Promise((res) => {
            this._bus.call(
                DBUS_IFACE,
                '/org/freedesktop/DBus',
                DBUS_IFACE,
                'ListNames',
                null,
                GLib.VariantType.new('(as)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (conn, r) => {
                    try {
                        const names = ((conn as Gio.DBusConnection).call_finish(r).recursiveUnpack() as unknown[])[0] as string[];
                        const base = this.busNameBase;
                        res(
                            names
                                .filter((n) => n === base || n.startsWith(`${base}.`))
                                .map((busName) => ({
                                    instance: busName === base ? 'default' : busName.slice(base.length + 1),
                                    busName,
                                })),
                        );
                    } catch {
                        res([]);
                    }
                },
            );
        });
    }
}
