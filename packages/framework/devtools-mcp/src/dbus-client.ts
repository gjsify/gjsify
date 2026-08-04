// @gjsify/devtools-mcp — client for the org.gjsify.Devtools control plane.
// DBus-call mechanics adapted from the PixelRPG map-editor (apps/mcp-bridge/src/index.ts).
// Copyright (c) PixelRPG. MIT.
//
// Two transports, one call path: the session bus (Linux default, unchanged) and
// a bus-less `Gio.DBusServer` PEER address (macOS/Windows, where there is no
// session bus at all). The only wire difference is the destination — a peer
// connection has no bus name, so every call sends `null` there.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import {
    type BusAddress,
    DEVTOOLS_ADDRESS_ENV,
    DEVTOOLS_INSTANCE_ENV,
    DEVTOOLS_INTERFACE,
    devtoolsAddressFilePath,
    resolveBusAddress,
} from '@gjsify/devtools-protocol';
import { type ClientTransportChoice, chooseClientTransport } from './transport-choice.js';

const DBUS_IFACE = 'org.freedesktop.DBus';

/** Options for {@link DbusDevtoolsClient}. */
export interface DbusDevtoolsClientOptions {
    /**
     * Peer address to dial (`unix:path=…`, `nonce-tcp:host=…,port=…,noncefile=…`).
     * Overrides everything; default is the `GJSIFY_DEVTOOLS_ADDRESS` env var,
     * then the address file the app publishes, then the session bus.
     */
    address?: string;
    /** Instance label used to locate the published address file. Default: `GJSIFY_DEVTOOLS_INSTANCE`. */
    instance?: string;
}

/** A devtools instance reachable from this client. */
export interface DevtoolsInstanceRef {
    instance: string;
    /** Present on the session bus; a peer connection has no bus name. */
    busName?: string;
    /** Present in peer mode: the address this client is connected to. */
    address?: string;
}

function envValue(name: string): string | null {
    const v = GLib.getenv(name);
    return v && v !== '' ? v : null;
}

/** Read a published peer address, or `null` when no app of that id is listening. */
function readAddressFile(base: string, instance?: string): string | null {
    const path = devtoolsAddressFilePath(GLib.get_user_runtime_dir(), base, instance);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        if (!ok) return null;
        const address = new TextDecoder().decode(contents).trim();
        return address === '' ? null : address;
    } catch {
        return null;
    }
}

/** Whether a session bus exists AND answers (see `installDevtools`' twin probe). */
function sessionBusAvailable(): boolean {
    if (!envValue('DBUS_SESSION_BUS_ADDRESS')) return false;
    try {
        Gio.bus_get_sync(Gio.BusType.SESSION, null);
        return true;
    } catch {
        return false;
    }
}

/**
 * Talks the `org.gjsify.Devtools` control plane of a running app. One per bridge
 * process; resolves a per-instance bus address from the app's base id + an
 * optional instance label, and dials either the session bus or a peer socket.
 */
export class DbusDevtoolsClient {
    private readonly _bus: Gio.DBusConnection;
    /** The resolved transport — `peer` means calls carry no destination bus name. */
    readonly transport: ClientTransportChoice;

    constructor(
        readonly busNameBase: string,
        options: DbusDevtoolsClientOptions = {},
    ) {
        const instance = options.instance ?? envValue(DEVTOOLS_INSTANCE_ENV) ?? undefined;
        this.transport = chooseClientTransport({
            optionAddress: options.address,
            envAddress: envValue(DEVTOOLS_ADDRESS_ENV),
            addressFileValue: readAddressFile(busNameBase, instance),
            sessionBusAvailable: sessionBusAvailable(),
        });

        if (this.transport.kind === 'peer') {
            this._bus = Gio.DBusConnection.new_for_address_sync(
                this.transport.address,
                Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT,
                null,
                null,
            );
        } else if (this.transport.kind === 'session-bus') {
            this._bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        } else {
            // Fail here rather than hand out a client that cannot call anything:
            // the three ways in are all the operator needs to hear.
            throw new Error(
                `[gjsify-devtools-mcp] no way to reach ${busNameBase}: this machine has no session bus, and no ` +
                    `peer address was given. Launch the app with GJSIFY_DEVTOOLS=1 (it then publishes ` +
                    `${devtoolsAddressFilePath('<runtime-dir>', busNameBase, instance)}), or set ` +
                    `${DEVTOOLS_ADDRESS_ENV} on both sides, or pass --address to \`gjsify debug\`.`,
            );
        }
    }

    /** Human-readable description of what this client is talking to (for diagnostics). */
    describeTarget(label?: string): string {
        if (this.transport.kind === 'peer') {
            return `peer address ${this.transport.address} (from ${this.transport.source})`;
        }
        return `session bus name ${this.resolve(label).busName}`;
    }

    resolve(label?: string): BusAddress {
        return resolveBusAddress(this.busNameBase, label);
    }

    /**
     * The destination for a call. A peer connection has no bus daemon and no
     * name registry, so the message must carry NO destination — sending the
     * well-known name there gets `ServiceUnknown` from a peer that has never
     * heard of names.
     */
    private _destination(label?: string): string | null {
        return this.transport.kind === 'peer' ? null : this.resolve(label).busName;
    }

    /** Async call to an instance's Devtools interface; resolves with the reply variant. */
    control(
        label: string | undefined,
        method: string,
        params: GLib.Variant | null,
        replyType: string | null,
    ): Promise<GLib.Variant> {
        const { objectPath } = this.resolve(label);
        const destination = this._destination(label);
        return new Promise((res, rej) => {
            this._bus.call(
                destination,
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

    /**
     * Whether `busName` currently has an owner (the app is running). In peer
     * mode there is no name registry: being connected IS the answer, because the
     * socket belongs to exactly one app process.
     */
    nameHasOwner(busName: string): Promise<boolean> {
        if (this.transport.kind === 'peer') return Promise.resolve(!this._bus.is_closed());
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

    /**
     * Enumerate devtools-enabled instances (base + labelled). Enumeration is a
     * BUS feature; a peer address reaches exactly one app, so peer mode reports
     * that one rather than pretending to have searched.
     */
    listInstances(): Promise<DevtoolsInstanceRef[]> {
        if (this.transport.kind === 'peer') {
            const address = this.transport.address;
            return Promise.resolve(this._bus.is_closed() ? [] : [{ instance: this.resolve().instance, address }]);
        }
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
                        const names = (
                            (conn as Gio.DBusConnection).call_finish(r).recursiveUnpack() as unknown[]
                        )[0] as string[];
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
