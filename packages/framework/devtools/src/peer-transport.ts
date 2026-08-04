// @gjsify/devtools — the BUS-LESS peer-to-peer transport for org.gjsify.Devtools.
// Original implementation.
//
// WHY THIS EXISTS: the devtools CAPTURE path is already OS-agnostic — a GSK
// snapshot rendered in-process (`screenshot.ts`), no grim, no portal, no OS
// branch, CI-proven on darwin-arm64. The only Linux-shaped part was the
// TRANSPORT: `installDevtools` needed `app.get_dbus_connection()`, i.e. a
// session bus. macOS has none (Homebrew's dbus listens on launchd, and
// `dbus-run-session` there dies with "DBUS_LAUNCHD_SESSION_BUS_SOCKET is
// empty"), and Windows has none either. Standing up an external dbus-daemon by
// hand is a prerequisite nobody remembers.
//
// GDBus already speaks peer-to-peer: `Gio.DBusServer` listens on a socket
// address and hands out a `Gio.DBusConnection` per client, with no bus daemon,
// no name ownership and no bespoke protocol. The same
// `DevtoolsService.export(connection, path)` works on those connections
// unchanged, so the whole interface — all 26 methods — comes up over a socket.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type { DevtoolsService } from './devtools-service.js';

/** A running peer-to-peer server hosting one `DevtoolsService`. */
export interface DevtoolsPeerServer {
    /** The address a CLIENT must dial (concrete — `unix:tmpdir=` resolves to a real socket path here). */
    readonly address: string;
    /** The object path the interface is exported at on every peer connection. */
    readonly objectPath: string;
    /** How many peer connections are currently open. */
    readonly connectionCount: number;
    /** Stop listening and drop every peer connection. Idempotent. */
    stop(): void;
}

/**
 * `true` when GLib was built for Windows. `G_DIR_SEPARATOR` is GLib's own
 * compile-time platform constant (`\` = 92 on win32, `/` = 47 elsewhere) and it
 * is introspectable, so this needs no `uname` probe, no subprocess and no
 * dependency — which matters because this package is GJS-only and must not pull
 * a Node polyfill in just to answer "which OS".
 */
function isWin32(): boolean {
    return GLib.DIR_SEPARATOR === 92;
}

/**
 * The address to listen on when the caller named none.
 *
 * POSIX gets `unix:tmpdir=<tmp>`: GDBus generates a fresh unique socket name in
 * that directory, so there is no stale-socket / second-instance collision to
 * handle (the deterministic `unix:path=` alternative has both). win32 gets
 * `nonce-tcp:host=127.0.0.1` because GLib implements no unix-socket transport
 * there — MEASURED to work under gjs 1.88.1 (loopback port + a nonce file whose
 * filesystem permissions are the secret).
 */
function defaultListenAddress(): string {
    return isWin32() ? 'nonce-tcp:host=127.0.0.1' : `unix:tmpdir=${GLib.get_tmp_dir()}`;
}

/**
 * Server flags per ADDRESS FAMILY, not per platform.
 *
 * `AUTHENTICATION_REQUIRE_SAME_USER` pins the peer's uid to ours via the
 * EXTERNAL mechanism — the right default for a control plane that can drive the
 * UI, and cheap on a unix socket. It CANNOT be used over TCP: measured on gjs
 * 1.88.1, a `nonce-tcp:` server carrying that flag rejects every client with
 * `Gio.IOErrorEnum: Unexpected lack of content when trying to read a line`,
 * because TCP carries no peer credentials to compare. There the nonce file is
 * the access control: the client must read a secret only our uid can open.
 */
function flagsForAddress(address: string): Gio.DBusServerFlags {
    const isTcp = address.startsWith('tcp:') || address.startsWith('nonce-tcp:');
    return isTcp ? Gio.DBusServerFlags.NONE : Gio.DBusServerFlags.AUTHENTICATION_REQUIRE_SAME_USER;
}

/**
 * Listen on `address` (auto-picked when omitted) and export `service` at
 * `objectPath` on every incoming peer connection.
 *
 * Each peer connection is its own `Gio.DBusConnection` with no shared name
 * registry, so the interface has to be exported per connection — which is why
 * `DevtoolsService.export()` tracks exports per connection rather than once. A
 * second client would otherwise attach to a connection with nothing on it and
 * see `UnknownMethod` for every call, the exact silent-absence failure this
 * whole transport exists to remove.
 *
 * Throws when the address cannot be listened on — an explicitly requested
 * address that does not work is a configuration error the operator must see.
 */
export function startDevtoolsPeerServer(
    service: DevtoolsService,
    objectPath: string,
    address?: string,
): DevtoolsPeerServer {
    const listenAddress = address && address !== '' ? address : defaultListenAddress();
    const server = Gio.DBusServer.new_sync(
        listenAddress,
        flagsForAddress(listenAddress),
        Gio.dbus_generate_guid(),
        null,
        null,
    );

    // GC roots. A peer connection is reachable only from GDBus' C side once the
    // signal handler returns, and the exported object only through its own DBus
    // self-cycle — both are collectable by SpiderMonkey while still live (the
    // failure `install.ts` already roots services against).
    const connections = new Set<Gio.DBusConnection>();

    server.connect('new-connection', (_server, connection) => {
        connections.add(connection);
        connection.connect('closed', () => {
            service.unexport(connection);
            connections.delete(connection);
        });
        service.export(connection, objectPath);
        // TRUE claims the connection: GDBus drops it as soon as the last handler
        // returns FALSE, so returning anything else closes the socket we just
        // exported on.
        return true;
    });

    server.start();

    let stopped = false;
    return {
        address: server.get_client_address(),
        objectPath,
        get connectionCount() {
            return connections.size;
        },
        stop() {
            if (stopped) return;
            stopped = true;
            server.stop();
            for (const connection of connections) {
                service.unexport(connection);
                if (connection.is_closed()) continue;
                // An explicit callback, not the promise form: GJS returns a
                // Promise when the callback is omitted, and a peer that already
                // vanished would reject it into an unhandled rejection during
                // teardown. close_finish DOES throw (G_IO_ERROR_CLOSED on a
                // connection the peer dropped first) — which is exactly the
                // outcome we are asking for, so it is swallowed here and nowhere
                // else.
                connection.close(null, (source, res) => {
                    try {
                        (source as Gio.DBusConnection).close_finish(res);
                    } catch {
                        // Already gone — teardown got what it wanted.
                    }
                });
            }
            connections.clear();
        },
    };
}

/**
 * Publish `address` where a bridge can find it without any environment: the
 * bus-less analogue of `DBUS_SESSION_BUS_ADDRESS`. Returns the file path, or
 * `null` when it could not be written (never fatal — the address is also logged,
 * and an explicit `GJSIFY_DEVTOOLS_ADDRESS` on both sides needs no file).
 */
export function writeDevtoolsAddressFile(path: string, address: string): string | null {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
        if (!GLib.file_set_contents(path, `${address}\n`)) return null;
    } catch (error) {
        console.error(`[gjsify-devtools] could not publish the peer address to ${path}: ${error}`);
        return null;
    }
    // Tighten to 0600 AFTER the write (file_set_contents creates 0666 & ~umask):
    // this address is a capability — whoever can dial it can drive the UI. A
    // filesystem without unix modes (win32) simply has no such attribute, which
    // is why the failure is reported and not fatal: the file is already written.
    try {
        Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
    } catch (error) {
        console.error(`[gjsify-devtools] could not restrict ${path} to the current user: ${error}`);
    }
    return path;
}

/** Delete a previously published address file, so a dead address cannot be dialled. */
export function removeDevtoolsAddressFile(path: string): void {
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch {
        // Already gone (or never written) — nothing to clean up, and a failure
        // here must not take an app's shutdown down with it.
    }
}
