// @gjsify/devtools — the BUS-LESS peer-to-peer transport for org.gjsify.Devtools.
//
// The capture path is already OS-agnostic (an in-process GSK snapshot); the only
// Linux-shaped part was the TRANSPORT, since `installDevtools` needed
// `app.get_dbus_connection()` and therefore a session bus. macOS has none (Homebrew's
// dbus listens on launchd, and `dbus-run-session` there dies with
// "DBUS_LAUNCHD_SESSION_BUS_SOCKET is empty") and neither has Windows.
//
// `Gio.DBusServer` speaks D-Bus peer-to-peer: a socket address, one
// `Gio.DBusConnection` per client, no daemon, no name ownership, no bespoke protocol.
// `DevtoolsService.export(connection, path)` works on those connections unchanged.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import { DEVTOOLS_ADDRESS_ENV } from '@gjsify/devtools-protocol';
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
 * `true` when GLib was built for Windows, read from its own introspectable
 * compile-time constant (`\` = 92 on win32, `/` = 47 elsewhere) — no `uname` probe and
 * no Node polyfill pulled into a GJS-only package just to answer "which OS".
 */
function isWin32(): boolean {
    return GLib.DIR_SEPARATOR === 92;
}

/**
 * The address to listen on when the caller named none.
 *
 * POSIX gets `unix:tmpdir=<tmp>`, where GDBus generates a fresh unique socket name, so
 * there is no stale-socket or second-instance collision to handle (deterministic
 * `unix:path=` has both). win32 gets `nonce-tcp:host=127.0.0.1`, because GLib implements
 * no unix-socket transport there — measured under gjs 1.88.1: a loopback port plus a
 * nonce file whose filesystem permissions are the secret.
 */
function defaultListenAddress(): string {
    return isWin32() ? 'nonce-tcp:host=127.0.0.1' : `unix:tmpdir=${GLib.get_tmp_dir()}`;
}

/**
 * A peer transport that could not be stood up. `message` is already the operator-facing
 * sentence, which `installDevtools` logs verbatim: the bare `Gio.DBusServer` failure is
 * LOCALISED and names neither the address nor a way out.
 */
export class DevtoolsPeerServerError extends Error {
    /**
     * The GIO failure underneath, as a field rather than `Error(message, { cause })`:
     * this package compiles to `lib: es2020`, which predates that option.
     */
    readonly cause?: unknown;

    constructor(
        message: string,
        readonly address: string,
        readonly reason: 'address-in-use' | 'occupied-by-other-file' | 'listen-failed',
        cause?: unknown,
    ) {
        super(message);
        this.name = 'DevtoolsPeerServerError';
        this.cause = cause;
    }
}

/** How long to wait for a verdict when probing whether an existing socket still answers. */
const SOCKET_PROBE_TIMEOUT_SECONDS = 2;

function isAddressInUse(error: unknown): boolean {
    return error instanceof GLib.Error && error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.ADDRESS_IN_USE);
}

/**
 * The filesystem path a `unix:path=` address names, or `null` for every other
 * address form — the only form that can go stale.
 *
 * Only a pathname socket outlives its process: `unix:tmpdir=` names a DIRECTORY that
 * GDBus invents a unique name in, `unix:abstract=` leaves no inode, and the kernel
 * releases a TCP port when the process dies.
 */
function unixSocketPath(address: string): string | null {
    if (!address.startsWith('unix:')) return null;
    for (const pair of address.slice('unix:'.length).split(',')) {
        const eq = pair.indexOf('=');
        if (eq < 0 || pair.slice(0, eq) !== 'path') continue;
        try {
            // D-Bus address values are %XX-escaped; a value we cannot decode is one
            // we must not act on.
            return decodeURIComponent(pair.slice(eq + 1));
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * What is sitting at `path`: a socket someone still answers on, a socket nobody
 * listens on any more, or something that is not a socket at all.
 *
 * The three-way answer is the point: `stop()` unlinks the socket but an abnormal exit
 * (Ctrl-C, SIGKILL, a crash) does not, so a leftover inode is the normal state after the
 * first Ctrl-C — and binding over it fails with `ADDRESS_IN_USE` exactly like a live
 * server does (both measured under gjs 1.88.1). Only a real connect attempt separates
 * them: a dead pathname socket refuses the connection.
 */
function inspectExistingSocket(path: string): 'live' | 'dead' | 'not-a-socket' {
    // Every delete below is gated on this being a SOCKET, so a typo'd
    // `GJSIFY_DEVTOOLS_ADDRESS=unix:path=<some file>` can never become a delete
    // primitive. A filesystem with no unix mode (win32) answers "not a socket", which is
    // also the honest answer there: it has no pathname sockets at all.
    try {
        const info = Gio.File.new_for_path(path).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
        if ((info.get_attribute_uint32('unix::mode') & 0o170000) !== 0o140000) return 'not-a-socket';
    } catch {
        return 'not-a-socket';
    }
    const probe = new Gio.SocketClient();
    probe.set_timeout(SOCKET_PROBE_TIMEOUT_SECONDS);
    let connection: Gio.SocketConnection;
    try {
        connection = probe.connect(Gio.UnixSocketAddress.new(path), null);
    } catch {
        // Measured: `G_IO_ERROR_CONNECTION_REFUSED` on an inode nobody accepts on.
        return 'dead';
    }
    connection.close(null);
    return 'live';
}

/**
 * Make an explicitly requested `unix:path=` address bindable, or explain why it
 * cannot be — before `Gio.DBusServer` collapses both cases into one localised
 * `ADDRESS_IN_USE`.
 *
 * Reclaimed rather than moved to a fresh address, because an explicit address is a
 * CONTRACT: `GJSIFY_DEVTOOLS_ADDRESS` is set on the app AND on `gjsify debug`, so
 * listening elsewhere would leave the bridge dialling what it was told to dial and
 * finding nothing — a visible failure traded for an invisible one. Unlinking is gated on
 * PROOF (the inode is a socket and a connect attempt was refused), and a LIVE socket is
 * never touched, since taking it would cut a running app's control plane.
 */
function clearReclaimableSocket(address: string): void {
    const path = unixSocketPath(address);
    if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) return;
    const state = inspectExistingSocket(path);
    if (state === 'live') {
        throw new DevtoolsPeerServerError(
            `cannot listen on ${address}: another process is already listening there. Stop it, or point ` +
                `${DEVTOOLS_ADDRESS_ENV} (or options.address) at a different socket — GJSIFY_DEVTOOLS_INSTANCE=<label> ` +
                'lets two devtools-enabled apps run side by side.',
            address,
            'address-in-use',
        );
    }
    if (state === 'not-a-socket') {
        throw new DevtoolsPeerServerError(
            `cannot listen on ${address}: ${path} already exists and is not a socket, so it will NOT be removed. ` +
                `Point ${DEVTOOLS_ADDRESS_ENV} (or options.address) at a free path.`,
            address,
            'occupied-by-other-file',
        );
    }
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch (error) {
        throw new DevtoolsPeerServerError(
            `cannot listen on ${address}: ${path} is a socket nothing listens on, but removing it failed ` +
                `(${error}). Delete it by hand, or point ${DEVTOOLS_ADDRESS_ENV} at a free path.`,
            address,
            'address-in-use',
            error,
        );
    }
    console.log(
        `[gjsify-devtools] reclaimed the stale socket ${path}: nothing was listening on it (an abnormal exit — ` +
            'Ctrl-C, SIGKILL, a crash — leaves the inode behind).',
    );
}

/**
 * Server flags per ADDRESS FAMILY, not per platform.
 *
 * `AUTHENTICATION_REQUIRE_SAME_USER` pins the peer's uid to ours through the EXTERNAL
 * mechanism, the right default for a control plane that can drive the UI. It CANNOT be
 * used over TCP, which carries no peer credentials: measured on gjs 1.88.1, a
 * `nonce-tcp:` server with that flag rejects every client with "Unexpected lack of
 * content when trying to read a line".
 *
 * There the nonce file IS the access control, and the spec asserts what that is worth on
 * a shared machine: GDBus writes it mode 0600, binds 127.0.0.1 only, and a client that
 * connects without sending the 16 nonce bytes gets no reply at all. Another local user
 * can reach the socket and still not speak the protocol.
 */
function flagsForAddress(address: string): Gio.DBusServerFlags {
    const isTcp = address.startsWith('tcp:') || address.startsWith('nonce-tcp:');
    return isTcp ? Gio.DBusServerFlags.NONE : Gio.DBusServerFlags.AUTHENTICATION_REQUIRE_SAME_USER;
}

/**
 * Listen on `address` (auto-picked when omitted) and export `service` at
 * `objectPath` on every incoming peer connection.
 *
 * Each peer connection is its own `Gio.DBusConnection` with no shared name registry, so
 * the interface must be exported PER CONNECTION — hence `DevtoolsService.export()`
 * tracking exports per connection. A second client would otherwise attach to a
 * connection with nothing on it and see `UnknownMethod` for every call.
 *
 * Throws a {@link DevtoolsPeerServerError} when the address cannot be listened on, with
 * a message saying what to do about it; `installDevtools` catches it, because an opt-in
 * diagnostic must never abort an app's lifecycle.
 */
export function startDevtoolsPeerServer(
    service: DevtoolsService,
    objectPath: string,
    address?: string,
): DevtoolsPeerServer {
    const listenAddress = address && address !== '' ? address : defaultListenAddress();
    clearReclaimableSocket(listenAddress);
    let server: Gio.DBusServer;
    try {
        server = Gio.DBusServer.new_sync(
            listenAddress,
            flagsForAddress(listenAddress),
            Gio.dbus_generate_guid(),
            null,
            null,
        );
    } catch (error) {
        // Everything that is not a reclaimable stale socket lands here: a peer that
        // grabbed the path between probe and bind, a busy TCP port, an address form GDBus
        // does not implement here, an unwritable directory.
        const inUse = isAddressInUse(error);
        throw new DevtoolsPeerServerError(
            inUse
                ? `cannot listen on ${listenAddress}: the address is already in use (${error}). Stop whatever ` +
                      `holds it, or point ${DEVTOOLS_ADDRESS_ENV} (or options.address) at a different address.`
                : `cannot listen on ${listenAddress}: ${error}. Check the address form — ` +
                      '`unix:path=/tmp/app.sock`, `unix:tmpdir=/tmp` or `nonce-tcp:host=127.0.0.1`.',
            listenAddress,
            inUse ? 'address-in-use' : 'listen-failed',
            error,
        );
    }

    // GC root: once the signal handler returns, a peer connection is reachable only from
    // GDBus' C side, and the exported object only through its own DBus self-cycle — both
    // collectable by SpiderMonkey while still live (see `install.ts`).
    const connections = new Set<Gio.DBusConnection>();

    server.connect('new-connection', (_server, connection) => {
        connections.add(connection);
        connection.connect('closed', () => {
            service.unexport(connection);
            connections.delete(connection);
        });
        service.export(connection, objectPath);
        // TRUE claims the connection: GDBus drops it when the last handler returns FALSE,
        // closing the socket we just exported on.
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
                // An explicit callback, not the promise form: GJS returns a Promise when the
                // callback is omitted, and a peer that already vanished would reject it into
                // an unhandled rejection mid-teardown. `close_finish` does throw
                // (G_IO_ERROR_CLOSED) — which is the outcome we asked for.
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
    // Tightened to 0600 AFTER the write (`file_set_contents` creates 0666 & ~umask),
    // because this address is a capability: whoever dials it can drive the UI. A
    // filesystem without unix modes (win32) has no such attribute, so the failure is
    // reported, not fatal — the file is already written.
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
        // Already gone, or never written; a failure here must not take an app's shutdown
        // down with it.
    }
}
