// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/net/lib.deno_net.d.ts

/// <reference no-default-lib="true" />
/// <reference lib="esnext" />

import type { Reader, Writer, Closer } from './deno.js';

/** @category Network */
export interface NetAddr {
    transport: "tcp" | "udp";
    hostname: string;
    port: number;
}

/** @category Network */
export interface UnixAddr {
    transport: "unix" | "unixpacket";
    path: string;
}

/** @category Network */
export type Addr = NetAddr | UnixAddr;

/** A generic network listener for stream-oriented protocols.
 *
 * @category Network
 */
export interface Listener extends AsyncIterable<Conn> {
    /** Waits for and resolves to the next connection to the `Listener`. */
    accept(): Promise<Conn>;
    /** Close closes the listener. Any pending accept promises will be rejected
     * with errors. */
    close(): void;
    /** Return the address of the `Listener`. */
    readonly addr: Addr;

    /** Return the rid of the `Listener`. */
    readonly rid: number;

    [Symbol.asyncIterator](): AsyncIterableIterator<Conn>;
}

/** @category Network */
export interface Listener extends AsyncIterable<Conn> {
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * Make the listener block the event loop from finishing.
     *
     * Note: the listener blocks the event loop from finishing by default.
     * This method is only meaningful after `.unref()` is called.
     */
    ref(): void;
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * Make the listener not block the event loop from finishing.
     */
    unref(): void;
}

/** Specialized listener that accepts TLS connections.
 *
 * @category Network
 */
export interface TlsListener extends Listener, AsyncIterable<TlsConn> {
    /** Waits for a TLS client to connect and accepts the connection. */
    accept(): Promise<TlsConn>;
    [Symbol.asyncIterator](): AsyncIterableIterator<TlsConn>;
}

/** @category Network */
export interface Conn extends Reader, Writer, Closer {
    /** The local address of the connection. */
    readonly localAddr: Addr;
    /** The remote address of the connection. */
    readonly remoteAddr: Addr;
    /** The resource ID of the connection. */
    readonly rid: number;
    /** Shuts down (`shutdown(2)`) the write side of the connection. Most
     * callers should just use `close()`. */
    closeWrite(): Promise<void>;

    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
}

/** @category Network */
// deno-lint-ignore no-empty-interface
export interface TlsHandshakeInfo {}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * @category Network
 */
export interface TlsHandshakeInfo {
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * Contains the ALPN protocol selected during negotiation with the server.
     * If no ALPN protocol selected, returns `null`.
     */
    alpnProtocol: string | null;
}

/** @category Network */
export interface TlsConn extends Conn {
    /** Runs the client or server handshake protocol to completion if that has
     * not happened yet. Calling this method is optional; the TLS handshake
     * will be completed automatically as soon as data is sent or received. */
    handshake(): Promise<TlsHandshakeInfo>;
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * @category Network
 */
 export interface TlsConn extends Conn {
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * Runs the client or server handshake protocol to completion if that has
     * not happened yet. Calling this method is optional; the TLS handshake
     * will be completed automatically as soon as data is sent or received.
     */
    handshake(): Promise<TlsHandshakeInfo>;
}

/** @category Network */
export interface ListenOptions {
    /** The port to listen on. */
    port: number;
    /** A literal IP address or host name that can be resolved to an IP address.
     * If not specified, defaults to `0.0.0.0`.
     *
     * __Note about `0.0.0.0`__ While listening `0.0.0.0` works on all platforms,
     * the browsers on Windows don't work with the address `0.0.0.0`.
     * You should show the message like `server running on localhost:8080` instead of
     * `server running on 0.0.0.0:8080` if your program supports Windows. */
    hostname?: string;
}

/** @category Network */
// deno-lint-ignore no-empty-interface
export interface TcpListenOptions extends ListenOptions {
}

/**
 * @category Network
 */
 export interface TcpListenOptions extends ListenOptions {
    /** When `true` the SO_REUSEPORT flag will be set on the listener. This
     * allows multiple processes to listen on the same address and port.
     *
     * On Linux this will cause the kernel to distribute incoming connections
     * across the different processes that are listening on the same address and
     * port.
     *
     * This flag is only supported on Linux. It is silently ignored on other
     * platforms. Defaults to `false`. */
    reusePort?: boolean;
}

/** Listen announces on the local transport address.
 *
 * ```ts
 * const listener1 = Deno.listen({ port: 80 })
 * const listener2 = Deno.listen({ hostname: "192.0.2.1", port: 80 })
 * const listener3 = Deno.listen({ hostname: "[2001:db8::1]", port: 80 });
 * const listener4 = Deno.listen({ hostname: "golang.org", port: 80, transport: "tcp" });
 * ```
 *
 * Requires `allow-net` permission.
 *
 * @tags allow-net
 * @category Network
 */
export type ListenFn1 = ( // TODO function listen
    options: TcpListenOptions & { transport?: "tcp" },
) => Listener;

/** @category Network */
export interface ListenTlsOptions extends TcpListenOptions {
    /** Server private key in PEM format */
    key?: string;
    /** Cert chain in PEM format */
    cert?: string;
    /** Path to a file containing a PEM formatted CA certificate. Requires
     * `--allow-read`.
     *
     * @tags allow-read
     * @deprecated This option is deprecated and will be removed in Deno 2.0.
     */
    certFile?: string;
    /** Server private key file. Requires `--allow-read`.
     *
     * @tags allow-read
     * @deprecated This option is deprecated and will be removed in Deno 2.0.
     */
    keyFile?: string;

    transport?: "tcp";
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * @category Network
 */
 export interface ListenTlsOptions {
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * Application-Layer Protocol Negotiation (ALPN) protocols to announce to
     * the client. If not specified, no ALPN extension will be included in the
     * TLS handshake.
     */
    alpnProtocols?: string[];
}

/** Listen announces on the local transport address over TLS (transport layer
 * security).
 *
 * ```ts
 * const lstnr = Deno.listenTls({ port: 443, certFile: "./server.crt", keyFile: "./server.key" });
 * ```
 *
 * Requires `allow-net` permission.
 *
 * @tags allow-net
 * @category Network
 */
export type ListenTlsFn = (options: ListenTlsOptions) => TlsListener;

/** @category Network */
export interface ConnectOptions {
    /** The port to connect to. */
    port: number;
    /** A literal IP address or host name that can be resolved to an IP address.
     * If not specified, defaults to `127.0.0.1`. */
    hostname?: string;
    transport?: "tcp";
}

/**
 * Connects to the hostname (default is "127.0.0.1") and port on the named
 * transport (default is "tcp"), and resolves to the connection (`Conn`).
 *
 * ```ts
 * const conn1 = await Deno.connect({ port: 80 });
 * const conn2 = await Deno.connect({ hostname: "192.0.2.1", port: 80 });
 * const conn3 = await Deno.connect({ hostname: "[2001:db8::1]", port: 80 });
 * const conn4 = await Deno.connect({ hostname: "golang.org", port: 80, transport: "tcp" });
 * ```
 *
 * Requires `allow-net` permission for "tcp".
 *
 * @tags allow-net
 * @category Network
 */
export type ConnectFn = (options: ConnectOptions) => Promise<TcpConn>;

/** @category Network */
export interface TcpConn extends Conn {
    /**
     * **UNSTABLE**: new API, see https://github.com/denoland/deno/issues/13617.
     *
     * Enable/disable the use of Nagle's algorithm. Defaults to true.
     */
    setNoDelay(nodelay?: boolean): void;
    /**
     * **UNSTABLE**: new API, see https://github.com/denoland/deno/issues/13617.
     *
     * Enable/disable keep-alive functionality.
     */
    setKeepAlive(keepalive?: boolean): void;
}

/** @category Network */
// deno-lint-ignore no-empty-interface
export interface UnixConn extends Conn {}

/** @category Network */
export interface ConnectTlsOptions {
    /** The port to connect to. */
    port: number;
    /** A literal IP address or host name that can be resolved to an IP address.
     * If not specified, defaults to `127.0.0.1`. */
    hostname?: string;
    /**
     * Server certificate file.
     *
     * @deprecated This option is deprecated and will be removed in a future
     * release.
     */
    certFile?: string;
    /** A list of root certificates that will be used in addition to the
     * default root certificates to verify the peer's certificate.
     *
     * Must be in PEM format. */
    caCerts?: string[];
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * @category Network
 */
 export interface ConnectTlsOptions {
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * PEM formatted client certificate chain.
     */
    certChain?: string;
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * PEM formatted (RSA or PKCS8) private key of client certificate.
     */
    privateKey?: string;
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * Application-Layer Protocol Negotiation (ALPN) protocols supported by
     * the client. If not specified, no ALPN extension will be included in the
     * TLS handshake.
     */
    alpnProtocols?: string[];
}

/** Establishes a secure connection over TLS (transport layer security) using
 * an optional cert file, hostname (default is "127.0.0.1") and port.  The
 * cert file is optional and if not included Mozilla's root certificates will
 * be used (see also https://github.com/ctz/webpki-roots for specifics)
 *
 * ```ts
 * const caCert = await Deno.readTextFile("./certs/my_custom_root_CA.pem");
 * const conn1 = await Deno.connectTls({ port: 80 });
 * const conn2 = await Deno.connectTls({ caCerts: [caCert], hostname: "192.0.2.1", port: 80 });
 * const conn3 = await Deno.connectTls({ hostname: "[2001:db8::1]", port: 80 });
 * const conn4 = await Deno.connectTls({ caCerts: [caCert], hostname: "golang.org", port: 80});
 * ```
 *
 * Requires `allow-net` permission.
 *
 * @tags allow-net
 * @category Network
 */
export type ConnectTlsFn1 = (options: ConnectTlsOptions) => Promise<TlsConn>; // TODO function connectTls

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * Create a TLS connection with an attached client certificate.
 *
 * ```ts
 * const conn = await Deno.connectTls({
 *   hostname: "deno.land",
 *   port: 443,
 *   certChain: "---- BEGIN CERTIFICATE ----\n ...",
 *   privateKey: "---- BEGIN PRIVATE KEY ----\n ...",
 * });
 * ```
 *
 * Requires `allow-net` permission.
 *
 * @tags allow-net
 * @category Network
 */
export type ConnectTlsFn2 = (options: ConnectTlsOptions) => Promise<TlsConn>; // TODO function connectTls

/** @category Network */
export interface StartTlsOptions {
    /** A literal IP address or host name that can be resolved to an IP address.
     * If not specified, defaults to `127.0.0.1`. */
    hostname?: string;
    /** A list of root certificates that will be used in addition to the
     * default root certificates to verify the peer's certificate.
     *
     * Must be in PEM format. */
    caCerts?: string[];
}

/** **UNSTABLE**: New API, yet to be vetted.
 *
 * @category Network
 */
export interface StartTlsOptions {
    /** **UNSTABLE**: New API, yet to be vetted.
     *
     * Application-Layer Protocol Negotiation (ALPN) protocols to announce to
     * the client. If not specified, no ALPN extension will be included in the
     * TLS handshake.
     */
    alpnProtocols?: string[];
}

/** Start TLS handshake from an existing connection using an optional list of
 * CA certificates, and hostname (default is "127.0.0.1"). Specifying CA certs
 * is optional. By default the configured root certificates are used. Using
 * this function requires that the other end of the connection is prepared for
 * a TLS handshake.
 *
 * Note that this function *consumes* the TCP connection passed to it, thus the
 * original TCP connection will be unusable after calling this. Additionally,
 * you need to ensure that the TCP connection is not being used elsewhere when
 * calling this function in order for the TCP connection to be consumed properly.
 * For instance, if there is a `Promise` that is waiting for read operation on
 * the TCP connection to complete, it is considered that the TCP connection is
 * being used elsewhere. In such a case, this function will fail.
 *
 * ```ts
 * const conn = await Deno.connect({ port: 80, hostname: "127.0.0.1" });
 * const caCert = await Deno.readTextFile("./certs/my_custom_root_CA.pem");
 * // `conn` becomes unusable after calling `Deno.startTls`
 * const tlsConn = await Deno.startTls(conn, { caCerts: [caCert], hostname: "localhost" });
 * ```
 *
 * Requires `allow-net` permission.
 *
 * @tags allow-net
 * @category Network
 */
export type StartTlsFn = ( // TODO function startTls
    conn: Conn,
    options?: StartTlsOptions,
) => Promise<TlsConn>;

/** Shutdown socket send operations.
 *
 * Matches behavior of POSIX shutdown(3).
 *
 * ```ts
 * const listener = Deno.listen({ port: 80 });
 * const conn = await listener.accept();
 * Deno.shutdown(conn.rid);
 * ```
 *
 * @category Network
 */
export type ShutdownFn = (rid: number) => Promise<void>; // TODO function shutdown
  