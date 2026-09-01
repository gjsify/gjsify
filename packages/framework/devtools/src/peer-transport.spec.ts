// @gjsify/devtools — the bus-less peer transport, end to end.
//
// This suite is the positive proof that the control plane comes up WITHOUT a
// session bus. It runs on plain gjs with no display and no bus daemon, which is
// exactly the shape of a macOS/Windows host — and of CI, so the busless path is
// covered on every affected PR rather than only on a Mac someone owns.
//
// It asserts POSITIVE facts on purpose: a test that passes when nothing was
// exported would be worthless here, since "the service was constructed but never
// reachable" is the precise failure this transport removes.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { describe, expect, it } from '@gjsify/unit';
import { DEVTOOLS_INTERFACE, devtoolsAddressFilePath } from '@gjsify/devtools-protocol';
import { chooseDevtoolsTransport, describeMissingConnection, installDevtools, uninstallDevtools } from './install.js';
import { startDevtoolsPeerServer, writeDevtoolsAddressFile, removeDevtoolsAddressFile } from './peer-transport.js';
import { DevtoolsService } from './devtools-service.js';

/**
 * Connect a genuinely separate `Gio.DBusConnection` over a peer address. Async
 * throughout: the server's `new-connection` handler is dispatched on the main
 * context, so a synchronous client call from the same process would deadlock
 * against the export it is waiting for.
 */
function connectPeer(address: string): Promise<Gio.DBusConnection> {
    return new Promise((resolve, reject) => {
        Gio.DBusConnection.new_for_address(
            address,
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT,
            null,
            null,
            (_source, res) => {
                try {
                    resolve(Gio.DBusConnection.new_for_address_finish(res));
                } catch (error) {
                    reject(error as Error);
                }
            },
        );
    });
}

/** Call a devtools method over a PEER connection — no bus name, so destination `null`. */
function peerCall(
    connection: Gio.DBusConnection,
    objectPath: string,
    method: string,
    params: GLib.Variant | null,
    replyType: string,
): Promise<GLib.Variant> {
    return new Promise((resolve, reject) => {
        connection.call(
            null,
            objectPath,
            DEVTOOLS_INTERFACE,
            method,
            params,
            GLib.VariantType.new(replyType),
            Gio.DBusCallFlags.NONE,
            10_000,
            null,
            (conn, res) => {
                try {
                    resolve((conn as Gio.DBusConnection).call_finish(res));
                } catch (error) {
                    reject(error as Error);
                }
            },
        );
    });
}

export default async () => {
    await describe('chooseDevtoolsTransport', async () => {
        await it('lets an explicitly requested address win over everything', async () => {
            expect(
                chooseDevtoolsTransport({
                    requestedAddress: 'unix:path=/tmp/x.sock',
                    hasAppConnection: true,
                    sessionBusUsable: true,
                }),
            ).toStrictEqual({ kind: 'peer', address: 'unix:path=/tmp/x.sock', reason: 'requested' });
        });

        await it('keeps the session bus when the app holds a connection (Linux unchanged)', async () => {
            expect(chooseDevtoolsTransport({ hasAppConnection: true, sessionBusUsable: true })).toStrictEqual({
                kind: 'session-bus',
            });
            // Even with no bus in the environment: an app that HAS a connection
            // has already answered the question by existing.
            expect(chooseDevtoolsTransport({ hasAppConnection: true, sessionBusUsable: false })).toStrictEqual({
                kind: 'session-bus',
            });
        });

        await it('auto-picks a peer socket when no bus answers, instead of giving up', async () => {
            expect(chooseDevtoolsTransport({ hasAppConnection: false, sessionBusUsable: false })).toStrictEqual({
                kind: 'peer',
                address: null,
                reason: 'no-session-bus',
            });
        });

        await it('blames the call site only when the bus really does answer', async () => {
            expect(chooseDevtoolsTransport({ hasAppConnection: false, sessionBusUsable: true })).toStrictEqual({
                kind: 'unregistered',
            });
        });
    });

    await describe('describeMissingConnection', async () => {
        await it('says NO SESSION BUS when the variable is unset', async () => {
            const message = describeMissingConnection(null, false);
            expect(message).toContain('no session bus');
            expect(message).toContain('DBUS_SESSION_BUS_ADDRESS is unset');
            expect(message).toContain('GJSIFY_DEVTOOLS_ADDRESS');
            // The old message blamed the call site for this case; it must not.
            expect(message).not.toContain('"startup" handler');
        });

        await it('says the advertised bus does not answer when it is set but dead', async () => {
            const message = describeMissingConnection('launchd:env=DBUS_LAUNCHD_SESSION_BUS_SOCKET', false);
            expect(message).toContain('no bus answers there');
            expect(message).toContain('launchd');
            expect(message).not.toContain('"startup" handler');
        });

        await it('blames the call site only when the bus answers', async () => {
            const message = describeMissingConnection('unix:path=/run/user/1000/bus', true);
            expect(message).toContain('"startup" handler');
            expect(message).toContain('not registered');
        });
    });

    await describe('startDevtoolsPeerServer', async () => {
        await it('serves a real GetStatus round trip over an auto-picked socket', async () => {
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerSpec' });
            const service = new DevtoolsService(app, { instance: 'spec' });
            const objectPath = '/org/gjsify/PeerSpec/devtools';
            const peer = startDevtoolsPeerServer(service, objectPath);
            try {
                expect(peer.address.length).toBeGreaterThan(0);
                expect(peer.objectPath).toBe(objectPath);

                const connection = await connectPeer(peer.address);
                const reply = await peerCall(connection, objectPath, 'GetStatus', null, '(s)');
                const [json] = reply.recursiveUnpack() as [string];
                const status = JSON.parse(json) as { appId: string; instance: string; paused: boolean };
                // POSITIVE facts: the interface answered, and it answered with
                // this app's live state rather than a default-constructed shape.
                expect(status.appId).toBe('org.gjsify.PeerSpec');
                expect(status.instance).toBe('spec');
                expect(status.paused).toBe(false);
                expect(peer.connectionCount).toBe(1);

                connection.close_sync(null);
            } finally {
                peer.stop();
            }
        });

        await it('serves EVERY peer connection, not just the first', async () => {
            // A single-slot export served connection #1 and left #2 talking to a
            // connection with nothing on it — UnknownMethod for all 26 methods.
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerSpecTwo' });
            const service = new DevtoolsService(app, {});
            const objectPath = '/org/gjsify/PeerSpecTwo/devtools';
            const peer = startDevtoolsPeerServer(service, objectPath);
            try {
                const first = await connectPeer(peer.address);
                const second = await connectPeer(peer.address);
                const reply = await peerCall(second, objectPath, 'GetStatus', null, '(s)');
                const [json] = reply.recursiveUnpack() as [string];
                expect((JSON.parse(json) as { appId: string }).appId).toBe('org.gjsify.PeerSpecTwo');
                expect(peer.connectionCount).toBe(2);
                first.close_sync(null);
                second.close_sync(null);
            } finally {
                peer.stop();
            }
        });

        await it('answers the async Screenshot method over the peer wire', async () => {
            // Screenshot is the one method that replies through the invocation
            // (gjs 1.86.0 mis-marshals a Promise-returning exported method), so
            // it is the transport's async-reply regression guard. With no display
            // there is no realised window, so the contract under test is the
            // MARSHALLING: an `(ay)` reply rather than a JSError.ValueError.
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerSpecShot' });
            const service = new DevtoolsService(app, {});
            const objectPath = '/org/gjsify/PeerSpecShot/devtools';
            const peer = startDevtoolsPeerServer(service, objectPath);
            try {
                const connection = await connectPeer(peer.address);
                const reply = await peerCall(
                    connection,
                    objectPath,
                    'Screenshot',
                    GLib.Variant.new_tuple([GLib.Variant.new_string('window')]),
                    '(ay)',
                );
                const [png] = reply.recursiveUnpack() as [Uint8Array];
                expect(png instanceof Uint8Array).toBe(true);
                connection.close_sync(null);
            } finally {
                peer.stop();
            }
        });

        await it('READS the Screenshot `scope` argument instead of ignoring it', async () => {
            // The guard for a declared-but-unread argument, which is invisible from every
            // other angle: `scope` was in the interface XML and on the MCP `screenshot`
            // tool from the start, and the service took it as `_params` and captured the
            // active window whatever it said. Asking for a child widget returned the whole
            // window, successfully, and no test could tell — a shot of the wrong widget is
            // still a valid PNG.
            //
            // A path matching NO live widget is the one input whose two readings differ
            // OBSERVABLY: unread it is the active window (here: none, so empty bytes and a
            // happy reply), read it is `not-found`. That is why this asserts an ERROR and
            // needs no display — with nothing realised, the success path proves nothing.
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerSpecShotScope' });
            const service = new DevtoolsService(app, {});
            const objectPath = '/org/gjsify/PeerSpecShotScope/devtools';
            const peer = startDevtoolsPeerServer(service, objectPath);
            try {
                const connection = await connectPeer(peer.address);
                let message = '';
                try {
                    await peerCall(
                        connection,
                        objectPath,
                        'Screenshot',
                        GLib.Variant.new_tuple([GLib.Variant.new_string('toplevel:99/child:0')]),
                        '(ay)',
                    );
                } catch (error) {
                    message = error instanceof Error ? error.message : String(error);
                }
                expect(message).toContain('toplevel:99/child:0');
                expect(message).toContain('not-found');

                // And the default vocabulary still means the active window, so routing the
                // argument did not turn every pre-existing caller into an error.
                for (const scope of ['', 'window', 'active']) {
                    const reply = await peerCall(
                        connection,
                        objectPath,
                        'Screenshot',
                        GLib.Variant.new_tuple([GLib.Variant.new_string(scope)]),
                        '(ay)',
                    );
                    const [png] = reply.recursiveUnpack() as [Uint8Array];
                    expect(png instanceof Uint8Array).toBe(true);
                }
                connection.close_sync(null);
            } finally {
                peer.stop();
            }
        });

        await it('keeps nonce-tcp access control on the nonce FILE, readable only by us', async () => {
            // `nonce-tcp:` must be served with `DBusServerFlags.NONE`, because
            // AUTHENTICATION_REQUIRE_SAME_USER rejects every TCP client (no peer
            // credentials on TCP). That is only defensible if the nonce is a real
            // secret, so assert what GDBus actually does rather than assume it:
            // the nonce file is mode 0600 and the listener is loopback-only. On a
            // shared machine another user can open the port but cannot read the
            // nonce, and without those 16 bytes the server never speaks (measured:
            // the connection just times out).
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerSpecNonce' });
            const service = new DevtoolsService(app, {});
            const peer = startDevtoolsPeerServer(
                service,
                '/org/gjsify/PeerSpecNonce/devtools',
                'nonce-tcp:host=127.0.0.1',
            );
            try {
                expect(peer.address).toContain('nonce-tcp:host=127.0.0.1');
                const nonce = /noncefile=([^,]+)/.exec(peer.address)?.[1];
                expect(typeof nonce).toBe('string');
                if (!nonce) return;
                const info = Gio.File.new_for_path(decodeURIComponent(nonce)).query_info(
                    'unix::mode',
                    Gio.FileQueryInfoFlags.NONE,
                    null,
                );
                expect(info.get_attribute_uint32('unix::mode') & 0o777).toBe(0o600);
            } finally {
                peer.stop();
            }
        });

        await it('honours an explicit unix:path address', async () => {
            const path = `${GLib.get_tmp_dir()}/gjsify-devtools-spec-${GLib.random_int_range(0, 1_000_000)}.sock`;
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerSpecPath' });
            const service = new DevtoolsService(app, {});
            const peer = startDevtoolsPeerServer(service, '/org/gjsify/PeerSpecPath/devtools', `unix:path=${path}`);
            try {
                expect(peer.address).toBe(`unix:path=${path}`);
                expect(GLib.file_test(path, GLib.FileTest.EXISTS)).toBe(true);
            } finally {
                peer.stop();
                removeDevtoolsAddressFile(path);
            }
        });
    });

    await describe('installDevtools on the peer transport', async () => {
        await it('exports over an explicit address with no bus involved at all', async () => {
            // Goes through the REAL entry point, on an application that never
            // registered: no bus connection, no object path, no session bus
            // needed. This is the macOS shape.
            const path = `${GLib.get_tmp_dir()}/gjsify-devtools-install-${GLib.random_int_range(0, 1_000_000)}.sock`;
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerInstall' });
            const service = installDevtools(app, { enabled: true, address: `unix:path=${path}`, instance: 'busless' });
            expect(service).not.toBeNull();
            if (!service) return;
            try {
                expect(app.get_dbus_connection()).toBeNull();
                expect(service.peerAddress).toBe(`unix:path=${path}`);

                const connection = await connectPeer(`unix:path=${path}`);
                // installDevtools derives the object path from the app id when the
                // application has none of its own.
                const objectPath = '/org/gjsify/PeerInstall/devtools';
                const reply = await peerCall(connection, objectPath, 'GetStatus', null, '(s)');
                const [json] = reply.recursiveUnpack() as [string];
                expect((JSON.parse(json) as { appId: string }).appId).toBe('org.gjsify.PeerInstall');

                // The address is published where a bridge can find it without any
                // environment — the bus-less analogue of DBUS_SESSION_BUS_ADDRESS.
                const file = devtoolsAddressFilePath(GLib.get_user_runtime_dir(), 'org.gjsify.PeerInstall', 'busless');
                const [read, contents] = GLib.file_get_contents(file);
                expect(read).toBe(true);
                expect(new TextDecoder().decode(contents).trim()).toBe(`unix:path=${path}`);

                connection.close_sync(null);
                removeDevtoolsAddressFile(file);
            } finally {
                service.unexport();
            }
        });

        await it('removes the published address on unexport, not only on shutdown', async () => {
            // The file is a CLAIM that an app of this id is listening now, and the
            // bridge ranks it above the session bus. `uninstallDevtools` stops the
            // socket, so leaving the file behind pointed the bridge at a dead
            // address — with `GApplication::shutdown` never firing here at all.
            const path = `${GLib.get_tmp_dir()}/gjsify-devtools-unexport-${GLib.random_int_range(0, 1_000_000)}.sock`;
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerUnexport' });
            const service = installDevtools(app, { enabled: true, address: `unix:path=${path}`, instance: 'gone' });
            expect(service).not.toBeNull();
            if (!service) return;
            const file = devtoolsAddressFilePath(GLib.get_user_runtime_dir(), 'org.gjsify.PeerUnexport', 'gone');
            // Positive fact first: it really was published (a test that passes
            // because nothing was ever written would prove nothing).
            expect(service.addressFile).toBe(file);
            expect(GLib.file_test(file, GLib.FileTest.EXISTS)).toBe(true);

            uninstallDevtools(service);
            expect(GLib.file_test(file, GLib.FileTest.EXISTS)).toBe(false);
            // The socket is gone too, so the claim and the reality retract together.
            expect(GLib.file_test(path, GLib.FileTest.EXISTS)).toBe(false);
        });
    });

    await describe('installDevtools stays TOTAL', async () => {
        await it('keeps the app running when the pinned address is already taken', async () => {
            // Two apps on one pinned address is the README's headline recipe used
            // twice ("two devtools apps from one shell"), and `Gio.DBusServer` then
            // throws G_IO_ERROR_ADDRESS_IN_USE (measured, gjs 1.88.1). An OPT-IN
            // diagnostic must not be able to abort the app lifecycle.
            const path = `${GLib.get_tmp_dir()}/gjsify-devtools-collide-${GLib.random_int_range(0, 1_000_000)}.sock`;
            const address = `unix:path=${path}`;
            const firstApp = new Gtk.Application({ application_id: 'org.gjsify.PeerCollideA' });
            const holder = installDevtools(firstApp, { enabled: true, address, instance: 'a' });
            expect(holder).not.toBeNull();
            if (!holder) return;
            try {
                const secondApp = new Gtk.Application({ application_id: 'org.gjsify.PeerCollideB' });
                let second: DevtoolsService | null | undefined;
                let windowPresented = false;
                // Call it from a real GObject signal handler, because that is where
                // both consumers call it (storybook's `activate`, adwaita-app's
                // `startup`) and GJS LOGS a throw from a handler and SWALLOWS it:
                // everything after it in the handler — `this._window.present()`,
                // `options.onStartup?.(this)` — is silently skipped, and the app is
                // diagnosed as "hangs with no window".
                const startup = Gio.SimpleAction.new('startup', null);
                startup.connect('activate', () => {
                    second = installDevtools(secondApp, { enabled: true, address, instance: 'b' });
                    windowPresented = true;
                });
                startup.activate(null);

                expect(windowPresented).toBe(true);
                expect(second).toBeNull();
                // No address was published for the app that failed to listen: the
                // bridge must not be handed a claim nothing is behind.
                const orphan = devtoolsAddressFilePath(GLib.get_user_runtime_dir(), 'org.gjsify.PeerCollideB', 'b');
                expect(GLib.file_test(orphan, GLib.FileTest.EXISTS)).toBe(false);

                // And the FIRST app's control plane is untouched — the collision
                // must never unlink a LIVE socket out from under a running app.
                const connection = await connectPeer(address);
                const reply = await peerCall(connection, '/org/gjsify/PeerCollideA/devtools', 'GetStatus', null, '(s)');
                const [json] = reply.recursiveUnpack() as [string];
                expect((JSON.parse(json) as { appId: string }).appId).toBe('org.gjsify.PeerCollideA');
                connection.close_sync(null);
            } finally {
                uninstallDevtools(holder);
            }
        });

        await it('reclaims a socket inode a killed process left behind', async () => {
            // `stop()` unlinks the socket; an abnormal exit (Ctrl-C, SIGKILL,
            // crash) does not. Binding over that leftover inode fails with
            // ADDRESS_IN_USE exactly like a live server does (measured), so
            // "Ctrl-C then restart" bricked the pinned address until someone
            // deleted the file by hand.
            const path = `${GLib.get_tmp_dir()}/gjsify-devtools-stale-${GLib.random_int_range(0, 1_000_000)}.sock`;
            const orphaned = Gio.Socket.new(Gio.SocketFamily.UNIX, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT);
            orphaned.bind(Gio.UnixSocketAddress.new(path), true);
            orphaned.listen();
            orphaned.close();
            expect(GLib.file_test(path, GLib.FileTest.EXISTS)).toBe(true);

            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerStale' });
            const service = installDevtools(app, { enabled: true, address: `unix:path=${path}`, instance: 'stale' });
            expect(service).not.toBeNull();
            if (!service) return;
            try {
                // POSITIVE proof the reclaim actually produced a working control
                // plane at the address the operator pinned — not merely "no throw".
                expect(service.peerAddress).toBe(`unix:path=${path}`);
                const connection = await connectPeer(`unix:path=${path}`);
                const reply = await peerCall(connection, '/org/gjsify/PeerStale/devtools', 'GetStatus', null, '(s)');
                const [json] = reply.recursiveUnpack() as [string];
                expect((JSON.parse(json) as { appId: string }).appId).toBe('org.gjsify.PeerStale');
                connection.close_sync(null);
            } finally {
                uninstallDevtools(service);
            }
        });

        await it('never deletes a non-socket file that happens to sit at the address', async () => {
            // `GJSIFY_DEVTOOLS_ADDRESS=unix:path=<typo>` must not be a delete
            // primitive: only a proven-dead SOCKET is reclaimable.
            const path = `${GLib.get_tmp_dir()}/gjsify-devtools-notasocket-${GLib.random_int_range(0, 1_000_000)}`;
            expect(GLib.file_set_contents(path, 'precious user data\n')).toBe(true);
            try {
                const app = new Gtk.Application({ application_id: 'org.gjsify.PeerNotASocket' });
                const service = installDevtools(app, { enabled: true, address: `unix:path=${path}` });
                expect(service).toBeNull();
                const [read, contents] = GLib.file_get_contents(path);
                expect(read).toBe(true);
                expect(new TextDecoder().decode(contents)).toBe('precious user data\n');
            } finally {
                removeDevtoolsAddressFile(path);
            }
        });

        await it('reports an unusable address family instead of throwing', async () => {
            const app = new Gtk.Application({ application_id: 'org.gjsify.PeerBadAddress' });
            expect(installDevtools(app, { enabled: true, address: 'not-a-dbus-address' })).toBeNull();
        });
    });

    await describe('writeDevtoolsAddressFile', async () => {
        await it('creates the directory and round-trips the address', async () => {
            const dir = `${GLib.get_tmp_dir()}/gjsify-devtools-spec-${GLib.random_int_range(0, 1_000_000)}`;
            const file = devtoolsAddressFilePath(dir, 'org.example.App');
            expect(writeDevtoolsAddressFile(file, 'unix:path=/tmp/example.sock')).toBe(file);
            const [read, contents] = GLib.file_get_contents(file);
            expect(read).toBe(true);
            expect(new TextDecoder().decode(contents).trim()).toBe('unix:path=/tmp/example.sock');

            removeDevtoolsAddressFile(file);
            expect(GLib.file_test(file, GLib.FileTest.EXISTS)).toBe(false);
            // Removing an absent file is a no-op, not a throw: shutdown must not
            // fail because the address file is already gone.
            removeDevtoolsAddressFile(file);
        });
    });
};
