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
 * A peer transport that could not be stood up. `message` is already the
 * operator-facing sentence — `installDevtools` logs it verbatim rather than
 * paraphrasing a localised GIO error (on a German desktop the bare
 * `Gio.DBusServer` failure reads `Fehler beim Binden an Adresse
 * (GUnixSocketAddress): Die Adresse wird bereits verwendet`, which names neither
 * the address nor a way out).
 */
export class DevtoolsPeerServerError extends Error {
    /**
     * The GIO failure underneath, when there was one. A field rather than the
     * `Error(message, { cause })` option because this package compiles to
     * `lib: es2020`, which predates it.
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
 * `unix:tmpdir=` names a DIRECTORY (GDBus invents a fresh unique socket name in
 * it, so it cannot collide), `unix:abstract=` lives in the abstract namespace and
 * leaves no inode behind, and a TCP port is released by the kernel when the
 * process dies. Only a pathname socket outlives its process.
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
 * The three-way answer is the point. `unix:path=` is the README's headline recipe,
 * `stop()` unlinks the socket but an ABNORMAL exit (Ctrl-C, SIGKILL, a crash) does
 * not — so a leftover inode is the normal state after the first Ctrl-C, and
 * binding over it fails with `ADDRESS_IN_USE` exactly like a live server does
 * (both measured under gjs 1.88.1). Telling the two apart needs a real connect
 * attempt: a dead pathname socket refuses the connection.
 */
function inspectExistingSocket(path: string): 'live' | 'dead' | 'not-a-socket' {
    // Every delete below is gated on this being a SOCKET, so a typo'd
    // `GJSIFY_DEVTOOLS_ADDRESS=unix:path=<some file>` can never become a delete
    // primitive. A filesystem with no unix mode (win32) answers "not a socket",
    // which is also the honest answer there: it has no pathname sockets at all.
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
 * WHY RECLAIM RATHER THAN MOVE TO A FRESH ADDRESS: an explicit address is a
 * CONTRACT with the other side. `GJSIFY_DEVTOOLS_ADDRESS` is set on the app *and*
 * on `gjsify debug`, so quietly listening somewhere else would leave the bridge
 * dialling the address it was told to dial and finding nothing — trading a visible
 * failure for an invisible one. Unlinking is safe here precisely because it is
 * gated on PROOF: the inode is a socket, and a connect attempt was refused. Where
 * there is no such contract — the auto-picked address — "pick a fresh one" is
 * already what happens, because `unix:tmpdir=` generates a unique name per server.
 *
 * A LIVE socket is never touched: taking the path from a running instance would
 * cut that app's control plane while its server still believes it is listening.
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
 * `AUTHENTICATION_REQUIRE_SAME_USER` pins the peer's uid to ours via the
 * EXTERNAL mechanism — the right default for a control plane that can drive the
 * UI, and cheap on a unix socket. It CANNOT be used over TCP: measured on gjs
 * 1.88.1, a `nonce-tcp:` server carrying that flag rejects every client with
 * `Gio.IOErrorEnum: Unexpected lack of content when trying to read a line`,
 * because TCP carries no peer credentials to compare. There the nonce file is
 * the access control, and on a SHARED machine that has to be more than a slogan
 * — so it is measured too, under gjs 1.88.1, and asserted in the spec: GDBus
 * creates the nonce file with mode 0600 (unreadable to other users), binds only
 * 127.0.0.1 (`ss -ltn` shows `127.0.0.1:<port>`, not `0.0.0.0`), and a client
 * that connects to the port WITHOUT sending the 16 nonce bytes gets no reply at
 * all — the server waits and the connection times out. Another local user can
 * therefore reach the socket and still not speak the protocol.
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
 * Throws a {@link DevtoolsPeerServerError} when the address cannot be listened on
 * — an explicitly requested address that does not work is a configuration error
 * the operator must see, and the message says what to do about it. `installDevtools`
 * catches it: an opt-in diagnostic must never abort an app's lifecycle.
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
        // Everything that is not a reclaimable stale socket lands here: a live
        // peer that grabbed the path between the probe and the bind, a busy TCP
        // port, an address form GDBus does not implement on this platform, an
        // unwritable directory. One typed error, one actionable sentence.
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
