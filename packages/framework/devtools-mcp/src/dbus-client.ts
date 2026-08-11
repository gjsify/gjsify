// @gjsify/devtools-mcp — client for the org.gjsify.Devtools control plane.
// DBus-call mechanics adapted from the PixelRPG map-editor (apps/mcp-bridge/src/index.ts).
// Copyright (c) PixelRPG. MIT.
//
// Two transports, one call path: the session bus, and a bus-less `Gio.DBusServer` PEER
// address for macOS/Windows, which have no session bus at all. The only wire difference
// is the destination — a peer connection has no bus name, so every call sends `null`.

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

/**
 * Read the peer address an app of this id published, or `null`. A CLAIM, not proof: the
 * app deletes the file on `unexport`/`shutdown`, but Ctrl-C, SIGKILL and a crash all skip
 * that, and on macOS/Windows `GLib.get_user_runtime_dir()` degrades to the user CACHE
 * dir, where a leftover survives reboots. {@link connectToDevtools} therefore VERIFIES
 * the claim by dialling it, and deletes it when nothing answers.
 */
function readAddressFile(path: string): string | null {
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

/**
 * Retract a published address whose claim proved false, so the next bridge run does not
 * repeat the dead dial. A failure here is uninteresting: the file being gone IS the state
 * being asked for.
 */
function deleteAddressFile(path: string): void {
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch {
        // Already gone (or never ours) — the desired state either way.
    }
}

function dialPeer(address: string): Gio.DBusConnection {
    return Gio.DBusConnection.new_for_address_sync(address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT, null, null);
}

/** What the operator can do about an unreachable app — the three ways in, spelled once. */
function threeWaysIn(busNameBase: string, instance?: string): string {
    return (
        'Launch the app with GJSIFY_DEVTOOLS=1 (it then publishes ' +
        `${devtoolsAddressFilePath('<runtime-dir>', busNameBase, instance)}), or set ${DEVTOOLS_ADDRESS_ENV} on both ` +
        'sides, or pass --address to `gjsify debug`.'
    );
}

/** Everything {@link connectToDevtools} needs, explicit so the precedence stays inspectable. */
export interface ConnectContext {
    busNameBase: string;
    instance?: string;
    /** Where an address for this app id WOULD be published — also what gets deleted when it is stale. */
    addressFilePath: string;
    optionAddress?: string | null;
    envAddress: string | null;
    addressFileValue: string | null;
    sessionBusAvailable: boolean;
}

/**
 * The resolution's two I/O steps, overridable ONLY so the specs can drive every row of
 * the precedence — "stale file falls back to the session bus" included — on a host with
 * no bus daemon, which is what CI and macOS are.
 */
export interface ConnectDeps {
    dial?: (address: string) => Gio.DBusConnection;
    sessionBus?: () => Gio.DBusConnection;
}

/**
 * Resolve the precedence into a LIVE connection — dial-then-fallback, not
 * dial-and-hope.
 *
 * The published address file outranks the session bus as positive evidence that an app of
 * exactly this id is listening NOW — but only if the claim is CHECKED, because nothing
 * makes it true: GApplication handles SIGTERM only, so Ctrl-C, SIGKILL and a crash all
 * leave the file behind, and `Gio.DBusConnection.new_for_address_sync` on a vanished
 * socket throws `G_IO_ERROR_NOT_FOUND` (measured, gjs 1.88.1) out of the bridge's FIRST
 * statement. So: dial it, and on failure delete it and continue down the precedence, which
 * degrades to the session bus or to the three-ways-in diagnostic rather than to a raw
 * localised GIO error.
 *
 * An EXPLICIT address (`--address`, `GJSIFY_DEVTOOLS_ADDRESS`) deliberately does NOT fall
 * back: the operator named it on both sides, so talking to something else would hide the
 * typo instead of reporting it.
 */
export function connectToDevtools(
    ctx: ConnectContext,
    deps: ConnectDeps = {},
): { bus: Gio.DBusConnection; transport: ClientTransportChoice } {
    const dial = deps.dial ?? dialPeer;
    const sessionBus = deps.sessionBus ?? (() => Gio.bus_get_sync(Gio.BusType.SESSION, null));
    let addressFileValue = ctx.addressFileValue;
    let staleAddress: string | null = null;
    // At most two rounds: the second runs with the stale claim dropped.
    for (;;) {
        const choice = chooseClientTransport({
            optionAddress: ctx.optionAddress,
            envAddress: ctx.envAddress,
            addressFileValue,
            sessionBusAvailable: ctx.sessionBusAvailable,
        });
        if (choice.kind === 'session-bus') {
            try {
                return { bus: sessionBus(), transport: choice };
            } catch (error) {
                throw new Error(
                    '[gjsify-devtools-mcp] the session bus advertised in DBUS_SESSION_BUS_ADDRESS stopped answering ' +
                        `while connecting to ${ctx.busNameBase}: ${error}. ${threeWaysIn(ctx.busNameBase, ctx.instance)}`,
                );
            }
        }
        if (choice.kind === 'unavailable') {
            // Fail here rather than hand out a client that cannot call anything.
            const stale = staleAddress
                ? ` (the address this app had published, ${staleAddress}, is dead — that stale claim was just removed)`
                : '';
            throw new Error(
                `[gjsify-devtools-mcp] no way to reach ${ctx.busNameBase}: this machine has no session bus, and no ` +
                    `peer address was given${stale}. ${threeWaysIn(ctx.busNameBase, ctx.instance)}`,
            );
        }
        try {
            return { bus: dial(choice.address), transport: choice };
        } catch (error) {
            if (choice.source !== 'address-file') {
                throw new Error(
                    `[gjsify-devtools-mcp] cannot reach ${ctx.busNameBase} at ${choice.address} (from ` +
                        `${choice.source === 'option' ? '--address' : DEVTOOLS_ADDRESS_ENV}): ${error}. Start the app ` +
                        `with GJSIFY_DEVTOOLS=1 ${DEVTOOLS_ADDRESS_ENV}=${choice.address} so it listens there, or omit ` +
                        'the address and let the published address file / the session bus decide.',
                );
            }
            console.error(
                `[gjsify-devtools-mcp] the address published for ${ctx.busNameBase} (${choice.address} in ` +
                    `${ctx.addressFilePath}) does not answer: ${error}. Removing that stale claim — an app killed with ` +
                    'Ctrl-C or SIGKILL never gets to retract it — and continuing down the precedence.',
            );
            deleteAddressFile(ctx.addressFilePath);
            staleAddress = choice.address;
            addressFileValue = null;
        }
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
        const addressFilePath = devtoolsAddressFilePath(GLib.get_user_runtime_dir(), busNameBase, instance);
        // One resolution step, so `transport` and `_bus` cannot disagree: the transport a
        // dial SUCCEEDED on is the transport reported.
        const { bus, transport } = connectToDevtools({
            busNameBase,
            instance,
            addressFilePath,
            optionAddress: options.address,
            envAddress: envValue(DEVTOOLS_ADDRESS_ENV),
            addressFileValue: readAddressFile(addressFilePath),
            sessionBusAvailable: sessionBusAvailable(),
        });
        this._bus = bus;
        this.transport = transport;
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
     * A peer connection has no bus daemon and no name registry, so the message must carry
     * NO destination: the well-known name gets `ServiceUnknown` from a peer that has never
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
     * Whether `busName` currently has an owner, i.e. the app is running. In peer mode
     * there is no name registry and being connected IS the answer, because the socket
     * belongs to exactly one app process.
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
     * Enumerate devtools-enabled instances. Enumeration is a BUS feature: a peer address
     * reaches exactly one app, so peer mode reports that one rather than pretending to
     * have searched.
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
