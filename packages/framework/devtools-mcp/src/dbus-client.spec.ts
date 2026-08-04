// @gjsify/devtools-mcp — the bridge's address resolution against REAL sockets.
//
// The published address file outranks the session bus, on the claim that it exists
// only while an app of exactly this id is listening. This suite is what makes that
// claim safe to rank: it proves a LIVE file is used, and that a STALE one (the
// normal state after Ctrl-C, SIGKILL or a crash — and, on macOS/Windows, after a
// REBOOT, since `GLib.get_user_runtime_dir()` degrades to the user cache dir) is
// detected, deleted and fallen past, instead of bricking the bridge with a raw
// localised GIO error out of its very first statement.
//
// Runs on plain gjs with no bus daemon and no display: the shape of CI and of a
// macOS host. Every case asserts positive facts — which transport was resolved,
// which address was dialled, which file exists afterwards — never "nothing threw".
//
// One harness note, deliberately narrow: a peer server and its client cannot be
// dialled SYNCHRONOUSLY in one process (GDBus services the new connection on the
// main context, which a sync dial blocks — it deadlocks). So where a spec needs a
// live connection it dials ASYNC and hands that REAL, open `Gio.DBusConnection`
// back through the `dial` seam. What is stubbed is the synchronous call, never the
// connection: the dead-address cases below use the real `dial` untouched, because a
// dial to a socket that is gone fails immediately without touching the loop.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { describe, expect, it } from '@gjsify/unit';
import { devtoolsAddressFilePath } from '@gjsify/devtools-protocol';
import { DbusDevtoolsClient, connectToDevtools } from './dbus-client.js';

/** A bare `Gio.DBusServer` — the specs only dial it, so it exports no interface. */
function startPeerServer(): { address: string; stop: () => void } {
    const server = Gio.DBusServer.new_sync(
        `unix:tmpdir=${GLib.get_tmp_dir()}`,
        Gio.DBusServerFlags.AUTHENTICATION_REQUIRE_SAME_USER,
        Gio.dbus_generate_guid(),
        null,
        null,
    );
    const connections = new Set<Gio.DBusConnection>();
    server.connect('new-connection', (_server, connection) => {
        // TRUE claims the connection; GDBus drops it as soon as the last handler
        // returns FALSE, and a dropped connection would make `is_closed()` true and
        // the "this claim is live" assertions meaningless.
        connections.add(connection);
        return true;
    });
    server.start();
    return {
        address: server.get_client_address(),
        stop: () => {
            server.stop();
            for (const connection of connections) if (!connection.is_closed()) connection.close_sync(null);
            connections.clear();
        },
    };
}

/** Dial a peer address asynchronously, so the server's handler can run meanwhile. */
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

/**
 * Run `fn` with the given env vars unset, restoring them afterwards. The bridge
 * reads `DBUS_SESSION_BUS_ADDRESS` and `GJSIFY_DEVTOOLS_ADDRESS` from the
 * environment, so a developer desktop (which has a bus) and CI (which has none)
 * would otherwise take different rows through the same test.
 */
function withoutEnv<T>(names: readonly string[], fn: () => T): T {
    const saved = names.map((name) => [name, GLib.getenv(name)] as const);
    for (const [name] of saved) GLib.unsetenv(name);
    try {
        return fn();
    } finally {
        for (const [name, value] of saved) if (value != null) GLib.setenv(name, value, true);
    }
}

const BUS_ENV = ['DBUS_SESSION_BUS_ADDRESS', 'GJSIFY_DEVTOOLS_ADDRESS', 'GJSIFY_DEVTOOLS_INSTANCE'] as const;

function addressFileFor(appId: string): string {
    return devtoolsAddressFilePath(GLib.get_user_runtime_dir(), appId);
}

function publishAddress(appId: string, address: string): string {
    const path = addressFileFor(appId);
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    expect(GLib.file_set_contents(path, `${address}\n`)).toBe(true);
    return path;
}

/** A `unix:path=` address whose socket does not exist — the shape a killed app leaves. */
function deadAddress(): string {
    return `unix:path=${GLib.get_tmp_dir()}/gjsify-devtools-mcp-dead-${GLib.random_int_range(0, 1_000_000)}.sock`;
}

export default async () => {
    await describe('the bridge verifies the published address', async () => {
        await it('dials a LIVE published address and keeps the file', async () => {
            // The positive control for everything below: self-healing must not have
            // made the file worthless. A claim that holds still wins over the bus.
            const server = startPeerServer();
            const appId = `org.gjsify.McpLive${GLib.random_int_range(0, 1_000_000)}`;
            const file = publishAddress(appId, server.address);
            const live = await connectPeer(server.address);
            try {
                let dialled: string | null = null;
                let sessionBusConsulted = false;
                const { bus, transport } = connectToDevtools(
                    {
                        busNameBase: appId,
                        addressFilePath: file,
                        envAddress: null,
                        addressFileValue: server.address,
                        sessionBusAvailable: true,
                    },
                    {
                        dial: (address) => {
                            dialled = address;
                            return live;
                        },
                        sessionBus: () => {
                            sessionBusConsulted = true;
                            return live;
                        },
                    },
                );
                expect(dialled).toBe(server.address);
                expect(transport).toStrictEqual({ kind: 'peer', address: server.address, source: 'address-file' });
                expect(bus).toBe(live);
                expect(bus.is_closed()).toBe(false);
                // The bus outranks nothing here — a working file must short-circuit it.
                expect(sessionBusConsulted).toBe(false);
                // Still published: a live app's claim must survive a bridge run.
                expect(GLib.file_test(file, GLib.FileTest.EXISTS)).toBe(true);
            } finally {
                Gio.File.new_for_path(file).delete(null);
                if (!live.is_closed()) live.close_sync(null);
                server.stop();
            }
        });

        await it('deletes a STALE published address and reports the three ways in', async () => {
            // End to end through the real client and the real GDBus dial: with a
            // socket that is gone, `Gio.DBusConnection.new_for_address_sync` throws
            // G_IO_ERROR_NOT_FOUND ("Verbindung ist gescheitert: Datei oder
            // Verzeichnis nicht gefunden" on a German desktop) — measured under gjs
            // 1.88.1. That error used to escape `new DbusDevtoolsClient()`, the FIRST
            // statement of `runDevtoolsMcp`, naming neither the app, nor the
            // address, nor any way in.
            const appId = `org.gjsify.McpStale${GLib.random_int_range(0, 1_000_000)}`;
            const dead = deadAddress();
            const file = publishAddress(appId, dead);
            let message = '';
            withoutEnv(BUS_ENV, () => {
                try {
                    new DbusDevtoolsClient(appId);
                } catch (error) {
                    message = error instanceof Error ? error.message : String(error);
                }
            });
            expect(message).toContain(`no way to reach ${appId}`);
            expect(message).toContain('GJSIFY_DEVTOOLS=1');
            expect(message).toContain('--address');
            // It names the dead claim it just dropped, not only the generic advice.
            expect(message).toContain(`${dead}, is dead`);
            // SELF-HEALED: the next bridge run must not repeat the dead dial.
            expect(GLib.file_test(file, GLib.FileTest.EXISTS)).toBe(false);
        });

        await it('falls back to the session bus past a stale address file', async () => {
            // The Linux-regression row: a leftover file must never cost a developer
            // the session-bus path that worked before this transport existed.
            const server = startPeerServer();
            const appId = `org.gjsify.McpFallback${GLib.random_int_range(0, 1_000_000)}`;
            const dead = deadAddress();
            const file = publishAddress(appId, dead);
            const live = await connectPeer(server.address);
            try {
                const { bus, transport } = connectToDevtools(
                    {
                        busNameBase: appId,
                        addressFilePath: file,
                        envAddress: null,
                        addressFileValue: dead,
                        sessionBusAvailable: true,
                    },
                    // The real dial runs (and really fails) for the dead address; only
                    // the session-bus step is supplied, because CI has no bus daemon.
                    { sessionBus: () => live },
                );
                expect(transport).toStrictEqual({ kind: 'session-bus' });
                expect(bus).toBe(live);
                expect(GLib.file_test(file, GLib.FileTest.EXISTS)).toBe(false);
            } finally {
                if (!live.is_closed()) live.close_sync(null);
                server.stop();
            }
        });

        await it('does NOT silently move off an explicitly requested dead address', async () => {
            // `--address` / GJSIFY_DEVTOOLS_ADDRESS is pinned on BOTH sides. Falling
            // back to a bus there would answer a different question than the one
            // asked and hide the typo, so this one fails — with the address named.
            const server = startPeerServer();
            const dead = deadAddress();
            const live = await connectPeer(server.address);
            let sessionBusConsulted = false;
            let message = '';
            try {
                connectToDevtools(
                    {
                        busNameBase: 'org.gjsify.McpPinned',
                        addressFilePath: addressFileFor('org.gjsify.McpPinned'),
                        optionAddress: dead,
                        envAddress: null,
                        addressFileValue: null,
                        sessionBusAvailable: true,
                    },
                    {
                        sessionBus: () => {
                            sessionBusConsulted = true;
                            return live;
                        },
                    },
                );
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            } finally {
                if (!live.is_closed()) live.close_sync(null);
                server.stop();
            }
            expect(message).toContain(dead);
            expect(message).toContain('--address');
            expect(sessionBusConsulted).toBe(false);
        });
    });
};
