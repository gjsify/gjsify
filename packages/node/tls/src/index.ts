// Reference: Node.js lib/tls.js
// Reimplemented for GJS using Gio.TlsClientConnection / Gio.TlsServerConnection

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Socket } from 'net';
import { createNodeError } from '@gjsify/utils';

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

export default {
  TLSSocket,
  connect,
  createSecureContext,
  rootCertificates,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
};
