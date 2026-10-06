// A fake GNOME Online Accounts on a peer-to-peer `Gio.DBusServer`, so the driver's GVariant
// marshalling and libgoa's own client code run for real with no GNOME session.
//
// libgoa has no constructor taking a connection: `Goa.Client.new` dials the SESSION bus. So
// the server also plays the bus methods a client of that bus needs (Hello,
// GetNameOwner, StartServiceByName, AddMatch) and the process's session address points at it.
//
// GLib caches the session connection for the life of the process. The fake is therefore one
// server per process, and `startFakeGoa` refuses to go on when the process is already bound to
// another bus: libgoa would then list the developer's REAL accounts into the test.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import type { AccountService } from './types.js';

export interface FakeMail {
    readonly email: string;
    readonly name: string;
    readonly imap?: { host: string; user: string; ssl: boolean; tls: boolean };
    readonly smtp?: { host: string; user: string; ssl: boolean; tls: boolean; auth: boolean };
}

export interface FakeAccount {
    readonly id: string;
    readonly provider?: string;
    readonly identity?: string;
    readonly disabled?: Partial<Record<AccountService, boolean>>;
    readonly mail?: FakeMail;
    readonly calendar?: boolean;
    readonly contacts?: boolean;
    readonly files?: boolean;
    /** Secret id → dummy secret. */
    readonly passwords?: Readonly<Record<string, string>>;
    readonly oauth2?: { readonly token: string; readonly expiresIn: number };
}

export interface FakeGoa {
    setAccounts(accounts: readonly FakeAccount[]): void;
    /** The secret ids libgoa was asked for since `setAccounts`, never the secrets. */
    readonly requestedPasswordIds: string[];
    /** How many `GetManagedObjects` calls arrived: proof the driver talked to THIS server. */
    managedObjectsCalls(): number;
}

const NS = 'org.gnome.OnlineAccounts';
const ROOT = '/org/gnome/OnlineAccounts';

const BUS_XML = `<node><interface name="org.freedesktop.DBus">
  <method name="Hello"><arg type="s" direction="out"/></method>
  <method name="GetNameOwner"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
  <method name="StartServiceByName"><arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="u" direction="out"/></method>
  <method name="AddMatch"><arg type="s" direction="in"/></method>
  <method name="RemoveMatch"><arg type="s" direction="in"/></method>
</interface></node>`;

const MANAGER_XML = `<node><interface name="org.freedesktop.DBus.ObjectManager">
  <method name="GetManagedObjects"><arg type="a{oa{sa{sv}}}" direction="out"/></method>
</interface></node>`;

const PASSWORD_XML = `<node><interface name="${NS}.PasswordBased">
  <method name="GetPassword"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
</interface></node>`;

const OAUTH2_XML = `<node><interface name="${NS}.OAuth2Based">
  <method name="GetAccessToken"><arg type="s" direction="out"/><arg type="i" direction="out"/></method>
</interface></node>`;

// A D-Bus error reply, which gjs does not log. A thrown plain `Error` is reported as a JS
// exception on stderr for every refused id, which the suite does on purpose.
function dbusError(message: string): Error {
    const Ctor = GLib.Error as unknown as new (domain: number, code: number, message: string) => Error;
    return new Ctor(Gio.dbus_error_quark(), Gio.DBusError.FAILED, message);
}

const str = (value: string) => new GLib.Variant('s', value);
const bool = (value: boolean) => new GLib.Variant('b', value);

function accountPath(account: FakeAccount): string {
    return `${ROOT}/Accounts/${account.id}`;
}

function managedObjects(
    accounts: readonly FakeAccount[],
): Record<string, Record<string, Record<string, GLib.Variant>>> {
    const objects: Record<string, Record<string, Record<string, GLib.Variant>>> = {};
    for (const account of accounts) {
        const disabled = account.disabled ?? {};
        const interfaces: Record<string, Record<string, GLib.Variant>> = {
            [`${NS}.Account`]: {
                Id: str(account.id),
                ProviderType: str(account.provider ?? 'imap_smtp'),
                ProviderName: str('Fake provider'),
                Identity: str(account.identity ?? 'user@example.test'),
                PresentationIdentity: str(account.identity ?? 'user@example.test'),
                MailDisabled: bool(!!disabled.mail),
                CalendarDisabled: bool(!!disabled.calendar),
                ContactsDisabled: bool(!!disabled.contacts),
                FilesDisabled: bool(!!disabled.files),
            },
        };
        const { mail } = account;
        if (mail) {
            interfaces[`${NS}.Mail`] = {
                EmailAddress: str(mail.email),
                Name: str(mail.name),
                ImapSupported: bool(!!mail.imap),
                ImapHost: str(mail.imap?.host ?? ''),
                ImapUserName: str(mail.imap?.user ?? ''),
                ImapUseSsl: bool(!!mail.imap?.ssl),
                ImapUseTls: bool(!!mail.imap?.tls),
                SmtpSupported: bool(!!mail.smtp),
                SmtpHost: str(mail.smtp?.host ?? ''),
                SmtpUserName: str(mail.smtp?.user ?? ''),
                SmtpUseAuth: bool(!!mail.smtp?.auth),
                SmtpUseSsl: bool(!!mail.smtp?.ssl),
                SmtpUseTls: bool(!!mail.smtp?.tls),
            };
        }
        if (account.calendar) interfaces[`${NS}.Calendar`] = { Uri: str('https://calendar.example.test/') };
        if (account.contacts) interfaces[`${NS}.Contacts`] = { Uri: str('https://contacts.example.test/') };
        if (account.files) interfaces[`${NS}.Files`] = { Uri: str('https://files.example.test/') };
        if (account.passwords) interfaces[`${NS}.PasswordBased`] = {};
        if (account.oauth2) interfaces[`${NS}.OAuth2Based`] = { ClientId: str('fake-client'), ClientSecret: str('') };
        objects[accountPath(account)] = interfaces;
    }
    return objects;
}

function dial(address: string): Promise<Gio.DBusConnection> {
    return new Promise((resolve, reject) => {
        Gio.bus_get(Gio.BusType.SESSION, null, (_source, result) => {
            // The address is read from the environment at this call, so the promise settles on the fake or rejects.
            try {
                resolve(Gio.bus_get_finish(result));
            } catch (error) {
                reject(new Error(`the session bus at ${address} is unreachable: ${(error as Error).message}`));
            }
        });
    });
}

let started: Promise<FakeGoa> | undefined;

/** One fake per process; later calls return the same one, so a test sets its own accounts. */
export function startFakeGoa(): Promise<FakeGoa> {
    started ??= start();
    return started;
}

async function start(): Promise<FakeGoa> {
    let accounts: readonly FakeAccount[] = [];
    let managedCalls = 0;
    const requestedPasswordIds: string[] = [];
    const exportedAccounts: Gio.DBusExportedObject[] = [];
    let connection: Gio.DBusConnection | undefined;

    const guid = Gio.dbus_generate_guid();
    const server = Gio.DBusServer.new_sync(
        `unix:tmpdir=${GLib.get_tmp_dir()}`,
        Gio.DBusServerFlags.AUTHENTICATION_REQUIRE_SAME_USER,
        guid,
        null,
        null,
    );

    server.connect('new-connection', (_server, peer) => {
        connection = peer;
        Gio.DBusExportedObject.wrapJSObject(BUS_XML, {
            Hello: () => ':1.1',
            GetNameOwner: () => ':1.1',
            StartServiceByName: () => 1,
            AddMatch: () => undefined,
            RemoveMatch: () => undefined,
        }).export(peer, '/org/freedesktop/DBus');
        Gio.DBusExportedObject.wrapJSObject(MANAGER_XML, {
            GetManagedObjects: () => {
                managedCalls++;
                return managedObjects(accounts);
            },
        }).export(peer, ROOT);
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
        requestedPasswordIds,
        managedObjectsCalls: () => managedCalls,
        setAccounts(next) {
            accounts = next;
            requestedPasswordIds.length = 0;
            for (const exported of exportedAccounts.splice(0)) exported.unexport();
            if (!connection) throw new Error('the fake has no client yet: call setAccounts after the first dial');
            for (const account of next) {
                if (account.passwords) {
                    const secrets = account.passwords;
                    const exported = Gio.DBusExportedObject.wrapJSObject(PASSWORD_XML, {
                        GetPassword(id: string) {
                            requestedPasswordIds.push(id);
                            if (!Object.hasOwn(secrets, id)) {
                                throw dbusError('no such secret id');
                            }
                            return secrets[id];
                        },
                    });
                    exported.export(connection, accountPath(account));
                    exportedAccounts.push(exported);
                }
                if (account.oauth2) {
                    const { token, expiresIn } = account.oauth2;
                    const exported = Gio.DBusExportedObject.wrapJSObject(OAUTH2_XML, {
                        GetAccessToken: () => [token, expiresIn],
                    });
                    exported.export(connection, accountPath(account));
                    exportedAccounts.push(exported);
                }
            }
        },
    };
}
