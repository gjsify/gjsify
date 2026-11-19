/**
 * Classic Bluetooth serial ports through BlueZ, with no `rfcomm` binary and no `/dev/rfcomm*`.
 *
 * The recipe, measured against a real label printer: register a client `org.bluez.Profile1` for
 * the Serial Port Profile on the system bus, ask the device to `ConnectProfile`, and BlueZ calls
 * our `NewConnection` with the connected RFCOMM socket as a file descriptor. That descriptor is
 * the serial port. Closing it closes the link; the profile registration lives as long as the port.
 *
 * Raw `register_object`, not `Gio.DBusExportedObject`: the wrapper is a GJS-only override.
 */

import Gio from 'gi://Gio?version=2.0';
import GioUnix from 'gi://GioUnix?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { serialError } from './errors.js';
import { canonicalUuid } from './filter.js';
import type { PortChange, PortConnection, PortHandle, PortSource } from './port-source.js';

export const SERIAL_PORT_PROFILE_UUID = '00001101-0000-1000-8000-00805f9b34fb';

const BLUEZ = 'org.bluez';
const DEVICE = 'org.bluez.Device1';
const OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';
const PROFILE_MANAGER = 'org.bluez.ProfileManager1';
const PROFILE_XML = `<node>
  <interface name="org.bluez.Profile1">
    <method name="Release"/>
    <method name="NewConnection">
      <arg type="o" direction="in"/>
      <arg type="h" direction="in"/>
      <arg type="a{sv}" direction="in"/>
    </method>
    <method name="RequestDisconnection"><arg type="o" direction="in"/></method>
  </interface>
</node>`;

export interface BluezRfcommOptions {
    /** Service class to expose as ports. Default: the Serial Port Profile. */
    serviceClass?: string;
    /** How long to wait for the device to connect, in ms. Default 30 s. */
    connectTimeoutMs?: number;
    /** Include devices that are not paired. Default false: opening one would need pairing first. */
    includeUnpaired?: boolean;
    /** Custom bus, for tests. Default: the system bus. */
    bus?: Gio.DBusConnection;
    /** Name BlueZ shows for our profile registration. Default `gjsify-webserial`. */
    profileName?: string;
    /** D-Bus object path prefix for the client profile; a counter is appended. A valid object path. */
    profilePathPrefix?: string;
}

type ManagedObjects = Record<string, Record<string, Record<string, unknown>>>;

type Callback<T> = (resolve: (value: T) => void, reject: (error: unknown) => void) => void;
const promisify = <T>(fn: Callback<T>): Promise<T> => new Promise(fn);

function addressOf(devicePath: string): string {
    return devicePath.slice(devicePath.lastIndexOf('dev_') + 4).replaceAll('_', ':');
}

export class BluezRfcommSource implements PortSource {
    readonly #serviceClass: string;
    readonly #timeoutMs: number;
    readonly #includeUnpaired: boolean;
    readonly #profileName: string;
    readonly #profilePathPrefix: string;
    #bus: Gio.DBusConnection | null;
    #counter = 0;

    constructor(options: BluezRfcommOptions = {}) {
        this.#serviceClass = canonicalUuid(options.serviceClass ?? SERIAL_PORT_PROFILE_UUID);
        this.#timeoutMs = options.connectTimeoutMs ?? 30_000;
        this.#includeUnpaired = options.includeUnpaired ?? false;
        this.#profileName = options.profileName ?? 'gjsify-webserial';
        this.#profilePathPrefix = options.profilePathPrefix ?? '/org/gjsify/webserial/profile';
        this.#bus = options.bus ?? null;
    }

    async #managedObjects(bus: Gio.DBusConnection): Promise<ManagedObjects> {
        const reply = await this.#call(bus, '/', OBJECT_MANAGER, 'GetManagedObjects', null);
        return reply.get_child_value(0).recursiveUnpack() as ManagedObjects;
    }

    async #connection(): Promise<Gio.DBusConnection> {
        if (this.#bus) return this.#bus;
        this.#bus = await promisify<Gio.DBusConnection>((resolve, reject) =>
            Gio.bus_get(Gio.BusType.SYSTEM, null, (_s, res) => {
                try {
                    resolve(Gio.bus_get_finish(res));
                } catch (error) {
                    reject(error);
                }
            }),
        );
        return this.#bus;
    }

    #call(
        bus: Gio.DBusConnection,
        path: string,
        iface: string,
        method: string,
        parameters: GLib.Variant | null,
        timeoutMs = 30_000,
    ): Promise<GLib.Variant> {
        return promisify((resolve, reject) =>
            bus.call(
                BLUEZ,
                path,
                iface,
                method,
                parameters,
                null,
                Gio.DBusCallFlags.NONE,
                timeoutMs,
                null,
                (_s, res) => {
                    try {
                        resolve(bus.call_finish(res));
                    } catch (error) {
                        reject(error);
                    }
                },
            ),
        );
    }

    async available(): Promise<boolean> {
        try {
            const bus = await this.#connection();
            await this.#call(bus, '/org/bluez', 'org.freedesktop.DBus.Peer', 'Ping', null, 2_000);
            return true;
        } catch {
            return false;
        }
    }

    async list(): Promise<PortHandle[]> {
        const bus = await this.#connection();
        const objects = await this.#managedObjects(bus);
        const handles: PortHandle[] = [];
        for (const [path, interfaces] of Object.entries(objects)) {
            const device = interfaces[DEVICE];
            if (!device) continue;
            const uuids = ((device.UUIDs as string[] | undefined) ?? []).map((u) => u.toLowerCase());
            if (!uuids.includes(this.#serviceClass)) continue;
            if (!this.#includeUnpaired && device.Paired !== true) continue;
            handles.push({
                id: addressOf(path),
                name: String(device.Alias ?? device.Name ?? addressOf(path)),
                info: { bluetoothServiceClassId: this.#serviceClass },
            });
        }
        return handles;
    }

    async open(id: string): Promise<PortConnection> {
        const bus = await this.#connection();
        // The adapter is part of the device path, so look it up instead of assuming `hci0`.
        const devicePath = Object.entries(await this.#managedObjects(bus)).find(
            ([path, interfaces]) => interfaces[DEVICE] && addressOf(path) === id,
        )?.[0];
        if (!devicePath) throw serialError('NotFoundError', `No Bluetooth device ${id}.`);
        const profilePath = `${this.#profilePathPrefix}${++this.#counter}`;

        let deliver!: (value: { input: Gio.InputStream; output: Gio.OutputStream }) => void;
        let fail!: (error: unknown) => void;
        const connected = new Promise<{ input: Gio.InputStream; output: Gio.OutputStream }>((resolve, reject) => {
            deliver = resolve;
            fail = reject;
        });
        connected.catch(() => undefined);

        const node = Gio.DBusNodeInfo.new_for_xml(PROFILE_XML);
        const iface = node.interfaces[0];
        const onMethodCall = (
            _connection: Gio.DBusConnection,
            _sender: string,
            _path: string,
            _iface: string,
            method: string,
            parameters: GLib.Variant,
            invocation: Gio.DBusMethodInvocation,
        ): void => {
            if (method === 'NewConnection') {
                try {
                    const fdList = invocation.get_message().get_unix_fd_list();
                    if (!fdList) throw new Error('BlueZ sent no file descriptor');
                    const index = parameters.get_child_value(1).get_handle();
                    // One dup per direction, each stream closing its own: the descriptor then outlives
                    // neither half, and a pending read does not keep a half-closed socket alive.
                    const input = GioUnix.InputStream.new(fdList.get(index), true);
                    const output = GioUnix.OutputStream.new(fdList.get(index), true);
                    invocation.return_value(null);
                    deliver({ input, output });
                } catch (error) {
                    invocation.return_dbus_error(
                        'org.bluez.Error.Rejected',
                        error instanceof Error ? error.message : String(error),
                    );
                    fail(error);
                }
                return;
            }
            // Release and RequestDisconnection: nothing to hold on to.
            invocation.return_value(null);
        };

        const registered = bus.register_object(
            profilePath,
            iface,
            onMethodCall as unknown as Parameters<Gio.DBusConnection['register_object']>[2],
            null,
            null,
        );

        let profileRegistered = false;
        const cleanup = async (): Promise<void> => {
            if (profileRegistered) {
                profileRegistered = false;
                await this.#call(
                    bus,
                    '/org/bluez',
                    PROFILE_MANAGER,
                    'UnregisterProfile',
                    new GLib.Variant('(o)', [profilePath]),
                ).catch(() => undefined);
            }
            bus.unregister_object(registered);
        };

        try {
            const options = {
                Name: GLib.Variant.new_string(this.#profileName),
                Role: GLib.Variant.new_string('client'),
                RequireAuthentication: GLib.Variant.new_boolean(false),
                RequireAuthorization: GLib.Variant.new_boolean(false),
            };
            await this.#call(
                bus,
                '/org/bluez',
                PROFILE_MANAGER,
                'RegisterProfile',
                new GLib.Variant('(osa{sv})', [profilePath, this.#serviceClass, options]),
            );
            profileRegistered = true;

            const connectProfile = this.#call(
                bus,
                devicePath,
                DEVICE,
                'ConnectProfile',
                new GLib.Variant('(s)', [this.#serviceClass]),
                this.#timeoutMs,
            );
            connectProfile.catch((error) => fail(error));
            const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.#timeoutMs, () => {
                fail(serialError('NetworkError', 'The device did not connect in time.'));
                return GLib.SOURCE_REMOVE;
            });
            let streams: { input: Gio.InputStream; output: Gio.OutputStream };
            try {
                streams = await connected;
            } finally {
                GLib.source_remove(timer);
            }
            return new RfcommConnection(streams.input, streams.output, cleanup);
        } catch (error) {
            await cleanup();
            throw error;
        }
    }

    subscribe(listener: (change: PortChange) => void): () => void {
        let bus: Gio.DBusConnection | null = null;
        let cancelled = false;
        let signalIds: number[] = [];
        const watch = async (): Promise<void> => {
            bus = await this.#connection();
            if (cancelled) return;
            const handler =
                (added: boolean) =>
                (_c: Gio.DBusConnection, _s: string, _p: string, _i: string, _n: string, params: GLib.Variant) => {
                    const path = params.get_child_value(0).get_string()[0];
                    if (!path.includes('/dev_')) return;
                    const body = params.get_child_value(1);
                    const handle: PortHandle = {
                        id: addressOf(path),
                        name: addressOf(path),
                        info: { bluetoothServiceClassId: this.#serviceClass },
                    };
                    if (added) {
                        void this.list().then((all) => {
                            const known = all.find((h) => h.id === handle.id);
                            if (known) listener({ type: 'connect', handle: known });
                        });
                    } else if (String(body.recursiveUnpack()).includes(DEVICE)) {
                        listener({ type: 'disconnect', handle });
                    }
                };
            signalIds = [
                bus.signal_subscribe(
                    BLUEZ,
                    OBJECT_MANAGER,
                    'InterfacesAdded',
                    '/',
                    null,
                    Gio.DBusSignalFlags.NONE,
                    handler(true) as never,
                ),
                bus.signal_subscribe(
                    BLUEZ,
                    OBJECT_MANAGER,
                    'InterfacesRemoved',
                    '/',
                    null,
                    Gio.DBusSignalFlags.NONE,
                    handler(false) as never,
                ),
            ];
        };
        void watch();
        return () => {
            cancelled = true;
            for (const sid of signalIds) bus?.signal_unsubscribe(sid);
            signalIds = [];
        };
    }
}

class RfcommConnection implements PortConnection {
    readonly #input: Gio.InputStream;
    readonly #output: Gio.OutputStream;
    readonly #release: () => Promise<void>;
    readonly #cancellable = new Gio.Cancellable();
    #closed = false;

    constructor(input: Gio.InputStream, output: Gio.OutputStream, release: () => Promise<void>) {
        this.#input = input;
        this.#output = output;
        this.#release = release;
    }

    async read(): Promise<Uint8Array | null> {
        if (this.#closed) return null;
        try {
            const bytes = await promisify<GLib.Bytes>((resolve, reject) =>
                this.#input.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, this.#cancellable, (_s, res) => {
                    try {
                        resolve(this.#input.read_bytes_finish(res));
                    } catch (error) {
                        reject(error);
                    }
                }),
            );
            // An empty read is the peer closing the socket.
            return bytes.get_size() === 0 ? null : new Uint8Array(bytes.toArray());
        } catch (error) {
            if (this.#closed || this.#cancellable.is_cancelled()) return null;
            throw error;
        }
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (this.#closed) throw new Error('connection closed');
        await promisify<void>((resolve, reject) =>
            this.#output.write_all_async(bytes, GLib.PRIORITY_DEFAULT, this.#cancellable, (_s, res) => {
                try {
                    this.#output.write_all_finish(res);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }),
        );
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        this.#cancellable.cancel();
        try {
            this.#input.close(null);
        } catch {
            // already gone
        }
        try {
            this.#output.close(null);
        } catch {
            // already gone
        }
        await this.#release();
    }
}
