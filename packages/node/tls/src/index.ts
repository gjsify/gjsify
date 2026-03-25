// Reference: Node.js lib/tls.js
// Reimplemented for GJS using Gio.TlsClientConnection / Gio.TlsServerConnection

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Socket, Server } from 'node:net';
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
  ALPNProtocols?: string[];
}

/**
 * TLSSocket wraps a net.Socket with TLS via Gio.TlsConnection.
 */
export class TLSSocket extends Socket {
  encrypted = true;
  authorized = false;
  authorizationError?: string;
  alpnProtocol: string | false = false;

  /** @internal */
  _tlsConnection: Gio.TlsConnection | null = null;

  constructor(socket?: Socket, options?: SecureContextOptions) {
    super();
  }

  /**
   * @internal Wire the TLS connection's I/O streams into this socket
   * so that read/write operations go through the encrypted channel.
   */
  _setupTlsStreams(tlsConn: Gio.TlsConnection): void {
    this._tlsConnection = tlsConn;
    // Replace the underlying I/O streams with the TLS connection's streams
    (this as any)._inputStream = tlsConn.get_input_stream();
    (this as any)._outputStream = tlsConn.get_output_stream();
    // Store connection for teardown
    (this as any)._connection = tlsConn as unknown as Gio.SocketConnection;
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

  /** Get the negotiated ALPN protocol. */
  getAlpnProtocol(): string | false {
    if (!this._tlsConnection) return false;
    try {
      const proto = this._tlsConnection.get_negotiated_protocol();
      return proto || false;
    } catch {
      return false;
    }
  }
}

/**
 * Create a TLS client connection.
 *
 * Connects via TCP first (using net.Socket.connect), then upgrades
 * the connection to TLS using Gio.TlsClientConnection.
 */
export function connect(options: TlsConnectOptions, callback?: () => void): TLSSocket {
  const socket = new TLSSocket(undefined, options);

  if (callback) {
    socket.once('secureConnect', callback);
  }

  const port = options.port || 443;
  const host = options.host || 'localhost';
  const servername = options.servername || host;
  const rejectUnauthorized = options.rejectUnauthorized !== false;

  // Listen for TCP connect, then upgrade to TLS
  socket.once('connect', () => {
    const rawConnection: Gio.SocketConnection | null = (socket as any)._connection;
    if (!rawConnection) {
      socket.destroy(new Error('No underlying connection for TLS upgrade'));
      return;
    }

    try {
      // Create TLS client connection wrapping the raw TCP connection
      const connectable = Gio.NetworkAddress.new(servername, port);
      const tlsConn = Gio.TlsClientConnection.new(
        rawConnection as Gio.IOStream,
        connectable,
      ) as Gio.TlsClientConnection;

      // Set server identity for certificate validation
      tlsConn.set_server_identity(connectable);

      // Set ALPN protocols if provided
      if (options.ALPNProtocols && options.ALPNProtocols.length > 0) {
        try {
          (tlsConn as Gio.TlsClientConnection).set_advertised_protocols(options.ALPNProtocols);
        } catch {
          // ALPN may not be supported on all GnuTLS versions
        }
      }

      // Handle certificate validation
      if (!rejectUnauthorized) {
        (tlsConn as Gio.TlsConnection).connect(
          'accept-certificate',
          () => true,
        );
      }

      // Perform TLS handshake asynchronously
      const cancellable = new Gio.Cancellable();
      (tlsConn as Gio.TlsConnection).handshake_async(
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
          try {
            (tlsConn as Gio.TlsConnection).handshake_finish(asyncResult);
            socket.authorized = true;
            socket._setupTlsStreams(tlsConn as Gio.TlsConnection);

            // Get ALPN result
            socket.alpnProtocol = socket.getAlpnProtocol();

            // Restart reading with TLS streams
            (socket as any)._reading = false;
            (socket as any)._startReading();

            socket.emit('secureConnect');
          } catch (err: unknown) {
            socket.authorized = false;
            socket.authorizationError = err instanceof Error ? err.message : String(err);
            if (rejectUnauthorized) {
              socket.destroy(err instanceof Error ? err : new Error(String(err)));
            } else {
              // Still emit secureConnect but with authorized=false
              socket._setupTlsStreams(tlsConn as Gio.TlsConnection);
              socket.emit('secureConnect');
            }
          }
        },
      );
    } catch (err: unknown) {
      socket.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  // Initiate TCP connection
  socket.connect({ port, host });
  return socket;
}

/**
 * Create a TLS secure context.
 */
export function createSecureContext(options?: SecureContextOptions): { context: any } {
  return { context: options || {} };
}

export const rootCertificates: string[] = [];

export interface TlsServerOptions extends SecureContextOptions {
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
  ALPNProtocols?: string[];
}

/**
 * Build a Gio.TlsCertificate from PEM cert+key strings.
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

  const pem = keyStr ? `${certStr}\n${keyStr}` : certStr;
  return Gio.TlsCertificate.new_from_pem(pem, pem.length);
}

/**
 * TLSServer wraps a net.Server to accept TLS connections.
 */
export class TLSServer extends Server {
  private _tlsCertificate: Gio.TlsCertificate | null = null;
  private _tlsOptions: TlsServerOptions;
  private _sniContexts = new Map<string, Gio.TlsCertificate>();

  constructor(options?: TlsServerOptions, secureConnectionListener?: (socket: TLSSocket) => void) {
    super();
    this._tlsOptions = options || {};

    if (secureConnectionListener) {
      this.on('secureConnection', secureConnectionListener);
    }

    if (this._tlsOptions.cert) {
      try {
        this._tlsCertificate = buildGioCertificate(this._tlsOptions.cert, this._tlsOptions.key);
      } catch (err: unknown) {
        deferEmit(this, 'error', createNodeError(err, 'createServer', {}));
      }
    }
  }

  /**
   * Add a context for SNI (Server Name Indication).
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

  listen(...args: unknown[]): this {
    this.on('connection', (socket: Socket) => {
      this._upgradeTls(socket);
    });
    return super.listen(...(args as [any]));
  }

  /**
   * Upgrade a raw TCP socket to TLS using Gio.TlsServerConnection.
   */
  private _upgradeTls(socket: Socket): void {
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
      const tlsConn = Gio.TlsServerConnection.new(
        rawConnection as Gio.IOStream,
        this._tlsCertificate,
      );

      // Configure client authentication
      if (this._tlsOptions.requestCert) {
        tlsConn.authenticationMode = this._tlsOptions.rejectUnauthorized !== false
          ? Gio.TlsAuthenticationMode.REQUIRED
          : Gio.TlsAuthenticationMode.REQUESTED;
      } else {
        tlsConn.authenticationMode = Gio.TlsAuthenticationMode.NONE;
      }

      if (this._tlsOptions.rejectUnauthorized === false) {
        (tlsConn as Gio.TlsConnection).connect(
          'accept-certificate',
          () => true,
        );
      }

      // Set ALPN protocols
      if (this._tlsOptions.ALPNProtocols && this._tlsOptions.ALPNProtocols.length > 0) {
        try {
          (tlsConn as any).set_advertised_protocols(this._tlsOptions.ALPNProtocols);
        } catch {
          // ALPN may not be supported
        }
      }

      // Perform TLS handshake
      const cancellable = new Gio.Cancellable();
      (tlsConn as Gio.TlsConnection).handshake_async(
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
          try {
            (tlsConn as Gio.TlsConnection).handshake_finish(asyncResult);

            // Create TLSSocket with TLS I/O streams wired up
            const tlsSocket = new TLSSocket();
            tlsSocket.encrypted = true;
            tlsSocket.authorized = true;
            tlsSocket._setupTlsStreams(tlsConn as Gio.TlsConnection);

            // Get ALPN result
            tlsSocket.alpnProtocol = tlsSocket.getAlpnProtocol();

            // Start reading on the TLS streams
            (tlsSocket as any)._startReading();

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
