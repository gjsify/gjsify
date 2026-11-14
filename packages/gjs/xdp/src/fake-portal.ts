// A fake Background portal on a peer-to-peer `Gio.DBusServer`, so libportal's own client code
// (`Xdp.Portal.request_background`) and the driver's probe run for real with no desktop session.
//
// libportal dials the SESSION bus, so the server also plays the few bus methods a client needs
// (Hello, GetNameOwner, StartServiceByName, AddMatch) and the process's session address points at
// it. GLib caches the session connection for the process: one fake per process, and
// `startFakePortal` refuses to go on when the process is bound to another bus, which would put the
// developer's REAL portal into the test (same pattern as system-accounts' fake-goa).

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

export interface PortalAnswer {
    /** The Request.Response code: 0 = the person answered, 1 = the person cancelled, 2 = ended otherwise. */
    readonly response: number;
    readonly background?: boolean;
    readonly autostart?: boolean;
    /** Fail the method call itself with a D-Bus error, as a broken portal does. */
    readonly fail?: boolean;
}

export interface BackgroundCall {
    readonly parentWindow: string;
    readonly reason: string | null;
    readonly autostart: boolean | null;
    readonly commandline: string[] | null;
    readonly flags: number | null;
}

export interface FakePortal {
    /** Serve the Background interface (default) or take it off the bus, as on a host without the portal. */
    setPresent(present: boolean): void;
    answerWith(answer: PortalAnswer): void;
    readonly calls: BackgroundCall[];
    readonly statuses: string[];
}

const PATH = '/org/freedesktop/portal/desktop';

const BUS_XML = `<node><interface name="org.freedesktop.DBus">
  <method name="Hello"><arg type="s" direction="out"/></method>
  <method name="GetNameOwner"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
  <method name="StartServiceByName"><arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="u" direction="out"/></method>
  <method name="AddMatch"><arg type="s" direction="in"/></method>
  <method name="RemoveMatch"><arg type="s" direction="in"/></method>
</interface></node>`;

const BACKGROUND_XML = `<node><interface name="org.freedesktop.portal.Background">
  <method name="RequestBackground">
    <arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/>
  </method>
  <method name="SetStatus"><arg type="a{sv}" direction="in"/></method>
  <property name="version" type="u" access="read"/>
</interface></node>`;

// A D-Bus error reply, which gjs does not log (a thrown plain `Error` would be reported on stderr).
function dbusError(message: string): Error {
    const Ctor = GLib.Error as unknown as new (domain: number, code: number, message: string) => Error;
    return new Ctor(Gio.dbus_error_quark(), Gio.DBusError.FAILED, message);
}

function dial(address: string): Promise<Gio.DBusConnection> {
    return new Promise((resolve, reject) => {
        Gio.bus_get(Gio.BusType.SESSION, null, (_source, result) => {
            try {
                resolve(Gio.bus_get_finish(result));
            } catch (error) {
                reject(new Error(`the session bus at ${address} is unreachable: ${(error as Error).message}`));
            }
        });
    });
}

let started: Promise<FakePortal> | undefined;

/** One fake per process; later calls return the same one, so a test sets its own answer. */
export function startFakePortal(): Promise<FakePortal> {
    started ??= start();
    return started;
}

async function start(): Promise<FakePortal> {
    const calls: BackgroundCall[] = [];
    const statuses: string[] = [];
    let answer: PortalAnswer = { response: 0, background: true, autostart: true };
    let connection: Gio.DBusConnection | undefined;
    let exported: Gio.DBusExportedObject | undefined;
    const sender = ':1.1';

    const guid = Gio.dbus_generate_guid();
    const server = Gio.DBusServer.new_sync(
        `unix:tmpdir=${GLib.get_tmp_dir()}`,
        Gio.DBusServerFlags.AUTHENTICATION_REQUIRE_SAME_USER,
        guid,
        null,
        null,
    );

    const exportBackground = () => {
        if (!connection || exported) return;
        exported = Gio.DBusExportedObject.wrapJSObject(BACKGROUND_XML, {
            get version() {
                return 2;
            },
            RequestBackground(parentWindow: string, options: Record<string, GLib.Variant>) {
                const unpack = <T>(key: string): T | null => (key in options ? (options[key].deepUnpack() as T) : null);
                calls.push({
                    parentWindow,
                    reason: unpack<string>('reason'),
                    autostart: unpack<boolean>('autostart'),
                    commandline: unpack<string[]>('commandline'),
                    flags: unpack<number>('flags'),
                });
                if (answer.fail) throw dbusError('the portal backend fell over');
                const token = unpack<string>('handle_token') ?? 'none';
                const handle = `${PATH}/request/${sender.slice(1).replaceAll('.', '_')}/${token}`;
                const { response, background = false, autostart = false } = answer;
                const peer = connection!;
                // The Response signal must follow the method reply, and carry a sender libportal's
                // well-known-name subscription recognises (a peer connection adds none).
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    const message = Gio.DBusMessage.new_signal(handle, 'org.freedesktop.portal.Request', 'Response');
                    message.set_sender(sender);
                    message.set_body(
                        new GLib.Variant('(ua{sv})', [
                            response,
                            {
                                background: new GLib.Variant('b', background),
                                autostart: new GLib.Variant('b', autostart),
                            },
                        ]),
                    );
                    peer.send_message(message, Gio.DBusSendMessageFlags.NONE);
                    return GLib.SOURCE_REMOVE;
                });
                return handle;
            },
            SetStatus(options: Record<string, GLib.Variant>) {
                statuses.push(options.message ? (options.message.deepUnpack() as string) : '');
            },
        });
        exported.export(connection, PATH);
    };

    server.connect('new-connection', (_server, peer) => {
        connection = peer;
        Gio.DBusExportedObject.wrapJSObject(BUS_XML, {
            Hello: () => sender,
            GetNameOwner: () => sender,
            StartServiceByName: () => 1,
            AddMatch: () => undefined,
            RemoveMatch: () => undefined,
        }).export(peer, '/org/freedesktop/DBus');
        exportBackground();
        return true;
    });
    server.start();

    GLib.setenv('DBUS_SESSION_BUS_ADDRESS', server.get_client_address(), true);
    const bus = await dial(server.get_client_address());
    if (bus.get_guid() !== guid) {
        throw new Error(
            'this process is already bound to a session bus that is not the fake. Run the suite with ' +
                'DBUS_SESSION_BUS_ADDRESS and XDG_RUNTIME_DIR pointing at a path that does not exist (see `test:gjs`).',
        );
    }

    return {
        calls,
        statuses,
        answerWith(next) {
            answer = next;
        },
        setPresent(present) {
            if (present) exportBackground();
            else if (exported) {
                exported.unexport();
                exported = undefined;
            }
        },
    };
}
