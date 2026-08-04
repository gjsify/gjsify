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

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';
import { describe, expect, it } from '@gjsify/unit';
import { DEVTOOLS_INTERFACE, devtoolsAddressFilePath } from '@gjsify/devtools-protocol';
import { chooseDevtoolsTransport, describeMissingConnection, installDevtools } from './install.js';
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
