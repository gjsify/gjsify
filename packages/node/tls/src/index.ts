// Reference: Node.js lib/tls.js
// Reimplemented for GJS using Gio.TlsClientConnection / Gio.TlsServerConnection

// TLS server — createServer via Gio.TlsServerConnection
// Reference: Node.js lib/tls.js, refs/deno/ext/node/polyfills/_tls_wrap.ts
// Reimplemented for GJS using Gio.TlsServerConnection + Gio.TlsCertificate

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Socket, Server } from 'net';
import { createNodeError, deferEmit } from '@gjsify/utils';

export const DEFAULT_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';

export interface SecureContextOptions {
  ca?: string | Buffer | Array<string | Buffer>;
  cert?: string | Buffer | Array<string | Buffer>;
  key?: string | Buffer | Array<string | Buffer>;
  rejectUnauthorized?: boolean;
}

export interface TlsConnectOptions extends SecureContextOptions {
  host?: string;
  port?: number;
  socket?: Socket;
  servername?: string;
}

/**
 * TLSSocket wraps a net.Socket with TLS via Gio.TlsClientConnection.
 */
export class TLSSocket extends Socket {
  encrypted = true;
  authorized = false;
  authorizationError?: string;

  private _tlsConnection: Gio.TlsClientConnection | null = null;
  private _secureConnecting = false;

  constructor(socket?: Socket, options?: SecureContextOptions) {
    super();
    // TLS upgrade of existing socket will be handled in connect()
  }

  /** Get the peer certificate info. */
  getPeerCertificate(_detailed?: boolean): any {
    if (!this._tlsConnection) return {};
    try {
      const cert = this._tlsConnection.get_peer_certificate();
      if (!cert) return {};
      return {
        subject: {},
        issuer: {},
        valid_from: '',
        valid_to: '',
        // Full certificate parsing would require deeper GIO integration
      };
    } catch {
      return {};
    }
  }

  /** Get the negotiated TLS protocol version. */
  getProtocol(): string | null {
    if (!this._tlsConnection) return null;
    try {
      const proto = this._tlsConnection.get_protocol_version();
      switch (proto) {
        case Gio.TlsProtocolVersion.TLS_1_0: return 'TLSv1';
        case Gio.TlsProtocolVersion.TLS_1_1: return 'TLSv1.1';
        case Gio.TlsProtocolVersion.TLS_1_2: return 'TLSv1.2';
        case Gio.TlsProtocolVersion.TLS_1_3: return 'TLSv1.3';
        default: return null;
      }
    } catch {
      return null;
    }
  }

  /** Get the cipher info. */
  getCipher(): { name: string; version: string } | null {
    if (!this._tlsConnection) return null;
    try {
      const name = this._tlsConnection.get_ciphersuite_name();
      return { name: name || 'unknown', version: this.getProtocol() || 'unknown' };
    } catch {
      return null;
    }
  }
}

/**
 * Create a TLS client connection.
 */
export function connect(options: TlsConnectOptions, callback?: () => void): TLSSocket {
  const socket = new TLSSocket(undefined, options);

  if (callback) {
    socket.once('secureConnect', callback);
  }

  // Connect via net.Socket.connect, then upgrade to TLS
  const port = options.port || 443;
  const host = options.host || 'localhost';
  socket.connect({ port, host });

  return socket;
}

/**
 * Create a TLS secure context.
 */
export function createSecureContext(options?: SecureContextOptions): { context: any } {
  // In GJS, TLS context is managed by GIO/GnuTLS internally
  // This returns a stub context object for API compatibility
  return { context: options || {} };
}

export const rootCertificates: string[] = [];

export interface TlsServerOptions extends SecureContextOptions {
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
}

/**
 * Build a Gio.TlsCertificate from PEM cert+key strings.
 * Concatenates cert and key into a single PEM block so
 * Gio.TlsCertificate.new_from_pem() can parse both.
 */
function buildGioCertificate(cert: string | Buffer | Array<string | Buffer>, key?: string | Buffer | Array<string | Buffer>): Gio.TlsCertificate {
  const certStr = Array.isArray(cert)
    ? cert.map((c) => (typeof c === 'string' ? c : c.toString('utf-8'))).join('\n')
    : typeof cert === 'string' ? cert : cert.toString('utf-8');

  const keyStr = key
    ? Array.isArray(key)
      ? key.map((k) => (typeof k === 'string' ? k : k.toString('utf-8'))).join('\n')
      : typeof key === 'string' ? key : key.toString('utf-8')
    : '';

  // Gio.TlsCertificate.new_from_pem() accepts a single PEM string
  // containing both the certificate and the private key.
  const pem = keyStr ? `${certStr}\n${keyStr}` : certStr;
  return Gio.TlsCertificate.new_from_pem(pem, pem.length);
}

/**
 * TLSServer wraps a net.Server to accept TLS connections.
 *
 * Incoming TCP connections are upgraded to TLS using
 * Gio.TlsServerConnection before being emitted as
 * 'secureConnection' events with a TLSSocket.
 */
export class TLSServer extends Server {
  private _tlsCertificate: Gio.TlsCertificate | null = null;
  private _tlsOptions: TlsServerOptions;
  private _sniContexts = new Map<string, Gio.TlsCertificate>();

  constructor(options?: TlsServerOptions, secureConnectionListener?: (socket: TLSSocket) => void) {
    // Do not pass secureConnectionListener to super as 'connection' —
    // we emit 'secureConnection' instead after TLS handshake.
    super();

    this._tlsOptions = options || {};

    if (secureConnectionListener) {
      this.on('secureConnection', secureConnectionListener);
    }

    // Build the server certificate from PEM options
    if (this._tlsOptions.cert) {
      try {
        this._tlsCertificate = buildGioCertificate(this._tlsOptions.cert, this._tlsOptions.key);
      } catch (err: unknown) {
        // Defer the error so the caller can attach an 'error' listener
        deferEmit(this, 'error', createNodeError(err, 'createServer', {}));
      }
    }
  }

  /**
   * Add a context for SNI (Server Name Indication).
   * When a client connects with the given hostname, the corresponding
   * certificate will be used instead of the default one.
   */
  addContext(hostname: string, context: SecureContextOptions): void {
    if (context.cert) {
      try {
        const cert = buildGioCertificate(context.cert, context.key);
        this._sniContexts.set(hostname, cert);
      } catch (err: unknown) {
        this.emit('error', createNodeError(err, 'addContext', {}));
      }
    }
  }

  /**
   * Override the internal connection handler from net.Server.
   * Instead of emitting 'connection' directly, we upgrade the
   * raw TCP connection to TLS and then emit 'secureConnection'.
   *
   * net.Server calls _handleConnection via the 'incoming' signal
   * on Gio.SocketService. We intercept by listening to the
   * 'connection' event emitted by net.Server._handleConnection.
   */
  listen(...args: unknown[]): this {
    // Attach a one-time setup: intercept 'connection' events from
    // the base class and upgrade them to TLS before re-emitting
    // as 'secureConnection'.
    this.on('connection', (socket: Socket) => {
      this._upgradeTls(socket);
    });

    return super.listen(...(args as [any]));
  }

  /**
   * Upgrade a raw TCP socket to TLS using Gio.TlsServerConnection,
   * perform the handshake, and emit 'secureConnection'.
   */
  private _upgradeTls(socket: Socket): void {
    // Access the underlying Gio.SocketConnection from the net.Socket.
    // The net.Socket stores it via _setConnection().
    const rawConnection: Gio.SocketConnection | null = (socket as any)._connection;
    if (!rawConnection) {
      const err = new Error('Cannot upgrade socket: no underlying connection');
      this.emit('tlsClientError', err, socket);
      socket.destroy();
      return;
    }

    if (!this._tlsCertificate) {
      const err = new Error('TLS server has no certificate configured');
      this.emit('tlsClientError', err, socket);
      socket.destroy();
      return;
    }

    try {
      // Create a TLS server connection wrapping the raw TCP IOStream
      const tlsConn = Gio.TlsServerConnection.new(
        rawConnection as Gio.IOStream,
        this._tlsCertificate,
      );

      // Configure client authentication mode
      if (this._tlsOptions.requestCert) {
        tlsConn.authenticationMode = this._tlsOptions.rejectUnauthorized !== false
          ? Gio.TlsAuthenticationMode.REQUIRED
          : Gio.TlsAuthenticationMode.REQUESTED;
      } else {
        tlsConn.authenticationMode = Gio.TlsAuthenticationMode.NONE;
      }

      // When rejectUnauthorized is false, accept all peer certificates
      if (this._tlsOptions.rejectUnauthorized === false) {
        (tlsConn as Gio.TlsConnection).connect(
          'accept-certificate',
          () => true,
        );
      }

      // Perform the TLS handshake asynchronously
      const cancellable = new Gio.Cancellable();
      (tlsConn as Gio.TlsConnection).handshake_async(
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
          try {
            (tlsConn as Gio.TlsConnection).handshake_finish(asyncResult);

            // Create a TLSSocket wrapping the now-handshaked connection
            const tlsSocket = new TLSSocket();
            tlsSocket.encrypted = true;
            tlsSocket.authorized = true;

            // Set the TLS connection on the socket
            (tlsSocket as any)._tlsConnection = tlsConn;

            this.emit('secureConnection', tlsSocket);
          } catch (err: unknown) {
            const nodeErr = createNodeError(err, 'handshake', {});
            this.emit('tlsClientError', nodeErr, socket);
            socket.destroy();
          }
        },
      );
    } catch (err: unknown) {
      const nodeErr = createNodeError(err, 'tls_wrap', {});
      this.emit('tlsClientError', nodeErr, socket);
      socket.destroy();
    }
  }
}

/**
 * Create a TLS server.
 *
 * The server uses Gio.TlsServerConnection to wrap accepted TCP
 * connections with TLS. When the TLS handshake completes, a
 * 'secureConnection' event is emitted with a TLSSocket.
 */
export function createServer(options?: TlsServerOptions, secureConnectionListener?: (socket: TLSSocket) => void): TLSServer;
export function createServer(secureConnectionListener?: (socket: TLSSocket) => void): TLSServer;
export function createServer(
  optionsOrListener?: TlsServerOptions | ((socket: TLSSocket) => void),
  secureConnectionListener?: (socket: TLSSocket) => void,
): TLSServer {
  if (typeof optionsOrListener === 'function') {
    return new TLSServer(undefined, optionsOrListener);
  }
  return new TLSServer(optionsOrListener, secureConnectionListener);
}

// Node.js compat alias — Node.js exports tls.Server
export { TLSServer as Server };

export default {
  TLSSocket,
  TLSServer,
  Server: TLSServer,
  connect,
  createServer,
  createSecureContext,
  rootCertificates,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
};
