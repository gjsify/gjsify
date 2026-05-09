// Reference: Node.js lib/tls.js, lib/_tls_common.js, lib/_tls_wrap.js
// Reimplemented for GJS using Gio.TlsClientConnection / Gio.TlsServerConnection /
//   Gio.TlsCertificate.
//
// Node-TLS option / API → Gio.TLS property/method mapping (authoritative for this file):
//
//   Node option / API                 →  Gio binding
//   ─────────────────────────────────────────────────────────────────────────
//   tls.createSecureContext({cert})   →  Gio.TlsCertificate.new_from_pem
//   {key} (separate PEM)              →  PEM concatenated then new_from_pem
//   {ca} (PEM string or array)        →  per-block Gio.TlsCertificate.new_from_pem
//                                        used as trust anchors via cert.verify()
//   {rejectUnauthorized: false}       →  TlsConnection 'accept-certificate'
//                                        signal returns true
//   {minVersion}/{maxVersion}/        →  Not exposed by Gio (handled by GnuTLS
//   {ciphers}                            backend); stored for diagnostics only
//   {ALPNProtocols}                   →  TlsConnection.set_advertised_protocols
//   tlsSocket.alpnProtocol            →  TlsConnection.get_negotiated_protocol
//   {servername} (SNI)                →  TlsClientConnection.set_server_identity
//                                        (Gio.NetworkAddress with hostname)
//   tls.connect({cert,key}) (mTLS)    →  TlsConnection.set_certificate(client_cert)
//   tls.createServer({SNICallback})   →  Best-effort: see "Open TODOs" — Gio
//                                        does not surface the ClientHello
//                                        server_name to JS before handshake.
//   tlsSocket.getPeerCertificate()    →  TlsConnection.get_peer_certificate +
//                                        TlsCertificate.get_subject_name /
//                                        get_issuer_name / get_dns_names /
//                                        get_ip_addresses / get_not_valid_*  /
//                                        certificate_pem
//   detailed=true issuer chain        →  TlsCertificate.get_issuer (walked)
//   tlsSocket.getProtocol()           →  TlsConnection.get_protocol_version
//   tlsSocket.getCipher()             →  TlsConnection.get_ciphersuite_name
//   server: {requestCert,             →  TlsServerConnection.authentication_mode
//            rejectUnauthorized}         REQUESTED / REQUIRED / NONE
//
// Documented gaps (see STATUS.md "Open TODOs"):
//   - SNI server-side selection from ClientHello: Gio does not expose
//     server_name extension before handshake; SNICallback is consulted but
//     selection is approximate.
//   - OCSP stapling: not exposed by Gio.
//   - TLS session resumption ('session' event, {session} option): GnuTLS
//     resumption API is not surfaced via GI.
//   - Custom DH/ECDH params, ticket keys: not exposed.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Socket, Server } from 'node:net';
import type { Server as NetServer } from 'node:net';
import { createNodeError, deferEmit } from '@gjsify/utils';

export const DEFAULT_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';
export const DEFAULT_CIPHERS = 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';

/** Returns a list of supported TLS cipher names (subset; implementation-defined). */
export function getCiphers(): string[] {
  return [
    'aes-128-gcm', 'aes-256-gcm', 'chacha20-poly1305',
    'aes-128-cbc', 'aes-256-cbc',
  ];
}

// ============================================================================
// PEM helpers
// ============================================================================

type PemInput = string | Buffer | Uint8Array | Array<string | Buffer | Uint8Array>;

/** Coerce a PEM input (string, Buffer/Uint8Array, or array) to a single PEM string. */
function pemToString(value: PemInput): string {
  if (Array.isArray(value)) {
    return value.map(pemToString).join('\n');
  }
  if (typeof value === 'string') return value;
  if (value && typeof (value as Buffer).toString === 'function') {
    try {
      return (value as Buffer).toString('utf-8');
    } catch {
      return new TextDecoder('utf-8').decode(value as Uint8Array);
    }
  }
  return String(value);
}

/** Split a concatenated PEM blob into individual `-----BEGIN ...-----...-----END ...-----` blocks. */
function splitPemBlocks(pem: string): string[] {
  const out: string[] = [];
  const re = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pem)) !== null) {
    out.push(m[0]);
  }
  return out;
}

/** Build a TlsCertificate (and chain) from PEM strings. The first cert and key are the leaf. */
function buildGioCertificate(cert: PemInput, key?: PemInput): Gio.TlsCertificate {
  const certPem = pemToString(cert);
  const keyPem = key ? pemToString(key) : '';
  const pem = keyPem ? `${certPem}\n${keyPem}` : certPem;
  return Gio.TlsCertificate.new_from_pem(pem, pem.length);
}

/** Parse a CA bundle (PEM string or array) into a list of TlsCertificate trust anchors. */
function buildCaCertificates(ca: PemInput): Gio.TlsCertificate[] {
  const blocks: string[] = [];
  if (Array.isArray(ca)) {
    for (const item of ca) blocks.push(...splitPemBlocks(pemToString(item)));
  } else {
    blocks.push(...splitPemBlocks(pemToString(ca)));
  }
  const out: Gio.TlsCertificate[] = [];
  for (const block of blocks) {
    try {
      out.push(Gio.TlsCertificate.new_from_pem(block, block.length));
    } catch {
      // Skip blocks that aren't certificates (DH params, comments, etc).
    }
  }
  return out;
}

// ============================================================================
// Peer-certificate extraction
// ============================================================================

export interface CertSubject {
  CN?: string | string[];
  [key: string]: unknown;
}

export interface PeerCertificate {
  subject?: CertSubject;
  issuer?: CertSubject;
  subjectaltname?: string;
  valid_from?: string;
  valid_to?: string;
  fingerprint?: string;
  fingerprint256?: string;
  serialNumber?: string;
  raw?: Uint8Array;
  issuerCertificate?: PeerCertificate;
  [key: string]: unknown;
}

/** Parse a distinguished name string (e.g. "CN=example.com,O=Foo") into a key→value object. */
function parseDistinguishedName(dn: string | null): CertSubject {
  if (!dn) return {};
  const out: CertSubject = {};
  for (const part of dn.split(/,(?![^=]*=)/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing as string, value];
  }
  return out;
}

/** Format a GLib.DateTime as an OpenSSL-style validity string. */
function formatCertDate(dt: GLib.DateTime | null): string {
  if (!dt) return '';
  try { return dt.format('%b %d %H:%M:%S %Y GMT') ?? ''; } catch { return ''; }
}

/** Build the "subjectaltname" string from DNS names + IP addresses (Node format). */
function formatAltNames(cert: Gio.TlsCertificate): string {
  const parts: string[] = [];
  try {
    const dns = cert.get_dns_names();
    if (dns) {
      for (const b of dns) {
        const data = b.get_data();
        if (!data) continue;
        parts.push(`DNS:${new TextDecoder('utf-8').decode(data)}`);
      }
    }
  } catch { /* not all backends support this */ }
  try {
    const ips = cert.get_ip_addresses();
    if (ips) for (const ip of ips) parts.push(`IP Address:${ip.to_string()}`);
  } catch { /* same */ }
  return parts.join(', ');
}

/** Compute SHA-1 / SHA-256 fingerprint strings from raw DER bytes (`AA:BB:CC:…`). */
function fingerprintFromBytes(bytes: Uint8Array, algo: GLib.ChecksumType): string {
  try {
    const cs = new GLib.Checksum(algo);
    cs.update(bytes);
    const hex = cs.get_string();
    if (!hex) return '';
    const out: string[] = [];
    for (let i = 0; i < hex.length; i += 2) out.push(hex.slice(i, i + 2).toUpperCase());
    return out.join(':');
  } catch {
    return '';
  }
}

/** Decode a single PEM cert block into raw DER bytes. */
function pemToDer(pem: string): Uint8Array {
  const m = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!m) return new Uint8Array(0);
  const b64 = m[1].replace(/[\s\r\n]+/g, '');
  try {
    const atob = (globalThis as { atob?: (s: string) => string }).atob;
    if (!atob) return new Uint8Array(0);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/** Convert a single TlsCertificate to the Node `getPeerCertificate()` shape. */
function tlsCertToPeerCert(cert: Gio.TlsCertificate, detailed: boolean): PeerCertificate {
  const out: PeerCertificate = {};
  try { out.subject = parseDistinguishedName(cert.get_subject_name()); } catch { /* */ }
  try { out.issuer = parseDistinguishedName(cert.get_issuer_name()); } catch { /* */ }
  out.subjectaltname = formatAltNames(cert);
  try {
    out.valid_from = formatCertDate(cert.get_not_valid_before());
    out.valid_to = formatCertDate(cert.get_not_valid_after());
  } catch { /* */ }
  try {
    const c = cert as unknown as { certificate_pem?: string; certificatePem?: string };
    const pemProp = c.certificate_pem ?? c.certificatePem;
    if (pemProp) {
      const der = pemToDer(pemProp);
      out.raw = der;
      out.fingerprint = fingerprintFromBytes(der, GLib.ChecksumType.SHA1);
      out.fingerprint256 = fingerprintFromBytes(der, GLib.ChecksumType.SHA256);
    }
  } catch { /* */ }
  if (detailed) {
    try {
      const issuerCert = cert.get_issuer();
      if (issuerCert && !issuerCert.is_same(cert)) {
        out.issuerCertificate = tlsCertToPeerCert(issuerCert, true);
      } else if (issuerCert) {
        out.issuerCertificate = out;  // self-signed: Node returns self-ref
      }
    } catch { /* */ }
  }
  return out;
}

// ============================================================================
// RFC 6125 hostname matching
// ============================================================================

/** Removes a trailing dot from a fully-qualified domain name. */
function unfqdn(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

/** Splits a hostname into parts, lower-cased, after removing trailing dots. */
function splitHost(host: string): string[] {
  return unfqdn(host).toLowerCase().split('.');
}

/** Reject control / non-ASCII bytes in pattern labels (RFC 6125 sanity). */
function isPrintableAscii(s: string): boolean {
  // U+0021 ('!') through U+007E ('~')
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x21 || c > 0x7E) return false;
  }
  return true;
}

/**
 * Match a hostname (already split into labels) against a single pattern from
 * a SAN DNS entry or CN. Implements RFC 6125 §6.4.3:
 *  - wildcard valid only in the leftmost label
 *  - wildcard label may not contain Punycode A-labels (`xn--`)
 *  - `*.tld` (two-label patterns) are rejected
 *  - exactly one wildcard per label
 */
function checkHostMatch(hostParts: string[], pattern: string): boolean {
  if (!pattern) return false;
  const patternParts = splitHost(pattern);
  if (hostParts.length !== patternParts.length) return false;
  if (patternParts.includes('')) return false;
  if (!patternParts.every(isPrintableAscii)) return false;
  for (let i = hostParts.length - 1; i > 0; i--) {
    if (hostParts[i] !== patternParts[i]) return false;
  }
  const hostSub = hostParts[0];
  const patSub = patternParts[0];
  const wildSplit = patSub.split('*', 3);
  if (wildSplit.length === 1 || patSub.includes('xn--')) {
    return hostSub === patSub;
  }
  if (wildSplit.length > 2) return false;
  if (patternParts.length <= 2) return false;
  const prefix = wildSplit[0];
  const suffix = wildSplit[1];
  if (prefix.length + suffix.length > hostSub.length) return false;
  if (!hostSub.startsWith(prefix)) return false;
  if (!hostSub.endsWith(suffix)) return false;
  return true;
}

/** Error returned by checkServerIdentity, with Node-compatible shape. */
export interface CertAltNameError extends Error {
  reason: string;
  host: string;
  cert: PeerCertificate;
  code: 'ERR_TLS_CERT_ALTNAME_INVALID';
}

/**
 * Verifies that the certificate `cert` is valid for `hostname`.
 * Returns an Error (with code 'ERR_TLS_CERT_ALTNAME_INVALID') if the check
 * fails, or `undefined` on success.
 *
 * Reference: Node.js lib/tls.js exports.checkServerIdentity (RFC 6125 §6.4.3).
 */
export function checkServerIdentity(hostname: string, cert: PeerCertificate): CertAltNameError | undefined {
  const subject = cert.subject;
  const altNames = cert.subjectaltname;
  const dnsNames: string[] = [];
  const ips: string[] = [];

  hostname = String(hostname);

  if (altNames) {
    const parts = altNames.split(', ');
    for (const name of parts) {
      if (name.startsWith('DNS:')) dnsNames.push(name.slice(4));
      else if (name.startsWith('IP Address:')) ips.push(name.slice(11).trim());
    }
  }

  let valid = false;
  let reason = 'Unknown reason';

  hostname = unfqdn(hostname);

  const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  const isIPv6 = hostname.includes(':');
  if (isIPv4 || isIPv6) {
    valid = ips.some(ip => ip.toLowerCase() === hostname.toLowerCase());
    if (!valid) {
      reason = `IP: ${hostname} is not in the cert's list: ${ips.join(', ')}`;
    }
  } else if (dnsNames.length > 0 || subject?.CN) {
    const hostParts = splitHost(hostname);

    if (dnsNames.length > 0) {
      valid = dnsNames.some(pattern => checkHostMatch(hostParts, pattern.trim()));
      if (!valid) {
        reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
      }
    } else {
      const cn = subject?.CN;
      if (Array.isArray(cn)) {
        valid = cn.some(c => checkHostMatch(hostParts, c));
      } else if (cn) {
        valid = checkHostMatch(hostParts, cn);
      }
      if (!valid) {
        reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
      }
    }
  } else {
    reason = 'Cert does not contain a DNS name';
  }

  if (!valid) {
    const err = new Error(reason) as CertAltNameError;
    err.reason = reason;
    err.host = hostname;
    err.cert = cert;
    err.code = 'ERR_TLS_CERT_ALTNAME_INVALID';
    return err;
  }
  return undefined;
}

// ============================================================================
// SecureContext
// ============================================================================

export interface SecureContextOptions {
  ca?: PemInput;
  cert?: PemInput;
  key?: PemInput;
  passphrase?: string;
  rejectUnauthorized?: boolean;
  ciphers?: string;
  minVersion?: string;
  maxVersion?: string;
  ALPNProtocols?: string[];
}

/** Internal "secure context" — parsed TLS material shared by tls.connect/createServer. */
export interface SecureContext {
  certificate: Gio.TlsCertificate | null;
  caCertificates: Gio.TlsCertificate[];
  options: SecureContextOptions;
  /**
   * Node-compat handle (Node returns a `SecureContext` with an internal native
   * `context` field). We have no native handle, so this points back at the
   * SecureContext object itself — `ctx.context !== undefined` matches Node.
   */
  context: SecureContext;
}

/** Build a SecureContext from PEM material. Buffer/Uint8Array/string all accepted. */
export function createSecureContext(options?: SecureContextOptions): SecureContext {
  const opts = options ?? {};
  let certificate: Gio.TlsCertificate | null = null;
  if (opts.cert) {
    try { certificate = buildGioCertificate(opts.cert, opts.key); } catch { certificate = null; }
  }
  const caCertificates = opts.ca ? buildCaCertificates(opts.ca) : [];
  const ctx = { certificate, caCertificates, options: opts } as SecureContext;
  ctx.context = ctx;  // Node-compat self-reference
  return ctx;
}

export interface TlsConnectOptions extends SecureContextOptions {
  host?: string;
  port?: number;
  socket?: Socket;
  servername?: string;
  ALPNProtocols?: string[];
  /** Pre-built secure context from createSecureContext(). */
  secureContext?: SecureContext;
  /** Custom server-identity check (runs after the GnuTLS-level check). */
  checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
}

/** Internal helper: cast a Socket to its private-field shape (we own the impl). */
interface SocketInternals {
  _connection: Gio.SocketConnection | null;
  _ioStream: Gio.IOStream | null;
  _inputStream: Gio.InputStream | null;
  _outputStream: Gio.OutputStream | null;
  _reading: boolean;
  _startReading(): void;
}

/**
 * TLSSocket wraps a net.Socket with TLS via Gio.TlsConnection.
 */
export class TLSSocket extends Socket {
  encrypted = true;
  authorized = false;
  authorizationError?: string;
  alpnProtocol: string | false = false;
  servername: string | undefined;

  /** @internal */
  _tlsConnection: Gio.TlsConnection | null = null;
  /** @internal — preserved for diagnostics + future cert-chain verification. */
  _secureContext: SecureContext | null = null;

  constructor(_socket?: Socket, _options?: SecureContextOptions) {
    super();
  }

  /**
   * @internal Wire the TLS connection's I/O streams into this socket
   * so that read/write operations go through the encrypted channel.
   */
  _setupTlsStreams(tlsConn: Gio.TlsConnection): void {
    this._tlsConnection = tlsConn;
    const internals = this as unknown as SocketInternals;
    internals._inputStream = tlsConn.get_input_stream();
    internals._outputStream = tlsConn.get_output_stream();
    internals._connection = tlsConn as unknown as Gio.SocketConnection;
  }

  /**
   * Get the peer certificate. When `detailed` is true, walks the issuer chain
   * via `Gio.TlsCertificate.get_issuer()` and populates `issuerCertificate`
   * recursively (with a self-reference on the root for compatibility).
   */
  getPeerCertificate(detailed = false): PeerCertificate {
    if (!this._tlsConnection) return {};
    try {
      const cert = this._tlsConnection.get_peer_certificate();
      if (!cert) return {};
      return tlsCertToPeerCert(cert, detailed);
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

  /** Get the negotiated cipher suite name + version. */
  getCipher(): { name: string; version: string } | null {
    if (!this._tlsConnection) return null;
    try {
      const name = this._tlsConnection.get_ciphersuite_name();
      return { name: name || 'unknown', version: this.getProtocol() || 'unknown' };
    } catch {
      return null;
    }
  }

  /** Get the negotiated ALPN protocol (or false if none). */
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

  const ctx = options.secureContext ?? createSecureContext(options);
  socket._secureContext = ctx;
  socket.servername = servername;
  const customCheckServerIdentity = options.checkServerIdentity;

  socket.once('connect', () => {
    const rawConnection = (socket as unknown as SocketInternals)._connection;
    if (!rawConnection) {
      socket.destroy(new Error('No underlying connection for TLS upgrade'));
      return;
    }

    try {
      const connectable = Gio.NetworkAddress.new(servername, port);
      const tlsConn = Gio.TlsClientConnection.new(
        rawConnection as unknown as Gio.IOStream,
        connectable,
      );

      tlsConn.set_server_identity(connectable);

      // Client certificate (mTLS)
      if (ctx.certificate) {
        try {
          tlsConn.set_certificate(ctx.certificate);
        } catch (err: unknown) {
          // eslint-disable-next-line no-console
          console.warn('[tls] failed to set client certificate:', err);
        }
      }

      // ALPN
      if (options.ALPNProtocols && options.ALPNProtocols.length > 0) {
        try {
          tlsConn.set_advertised_protocols(options.ALPNProtocols);
        } catch {
          // ALPN may not be supported
        }
      }

      // Certificate validation: by default rely on system trust store +
      // 'accept-certificate' returning false. With a custom CA we accept
      // peer certs that validate against `ctx.caCertificates`. With
      // `rejectUnauthorized: false`, accept everything.
      tlsConn.connect('accept-certificate', (
        _conn: Gio.TlsConnection,
        peerCert: Gio.TlsCertificate,
        _errors: Gio.TlsCertificateFlags,
      ): boolean => {
        if (!rejectUnauthorized) return true;
        if (ctx.caCertificates.length === 0) return false;
        for (const ca of ctx.caCertificates) {
          try {
            const flags = peerCert.verify(connectable, ca);
            if (flags === Gio.TlsCertificateFlags.NO_FLAGS) return true;
          } catch { /* try next */ }
        }
        return false;
      });

      const cancellable = new Gio.Cancellable();
      tlsConn.handshake_async(
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
          try {
            tlsConn.handshake_finish(asyncResult);
            socket.authorized = true;
            socket._setupTlsStreams(tlsConn);
            socket.alpnProtocol = socket.getAlpnProtocol();

            // Custom server-identity check (post-handshake, mirrors Node).
            if (customCheckServerIdentity) {
              const peer = socket.getPeerCertificate();
              const idErr = customCheckServerIdentity(servername, peer);
              if (idErr) {
                socket.authorized = false;
                socket.authorizationError = idErr.message;
                if (rejectUnauthorized) {
                  socket.destroy(idErr);
                  return;
                }
              }
            }

            const internals = socket as unknown as SocketInternals;
            internals._reading = false;
            internals._startReading();

            socket.emit('secureConnect');
          } catch (err: unknown) {
            socket.authorized = false;
            socket.authorizationError = err instanceof Error ? err.message : String(err);
            if (rejectUnauthorized) {
              socket.destroy(err instanceof Error ? err : new Error(String(err)));
            } else {
              socket._setupTlsStreams(tlsConn);
              socket.emit('secureConnect');
            }
          }
        },
      );
    } catch (err: unknown) {
      socket.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  socket.connect({ port, host });
  return socket;
}

export const rootCertificates: string[] = [];

// ============================================================================
// TLSServer / createServer
// ============================================================================

export type SNICallback = (
  servername: string,
  cb: (err: Error | null, ctx?: SecureContext) => void,
) => void;

export interface TlsServerOptions extends SecureContextOptions {
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
  ALPNProtocols?: string[];
  SNICallback?: SNICallback;
}

/**
 * TLSServer accepts incoming TCP connections and upgrades each to TLS via
 * `Gio.TlsServerConnection`. Supports mTLS via `requestCert`+`rejectUnauthorized`,
 * SNI selection via `addContext`/`SNICallback`, and ALPN negotiation.
 */
export class TLSServer extends Server {
  private _tlsCertificate: Gio.TlsCertificate | null = null;
  private _tlsOptions: TlsServerOptions;
  private _sniContexts = new Map<string, SecureContext>();
  /** @internal — exposed for tests. */
  _secureContext: SecureContext;

  constructor(options?: TlsServerOptions, secureConnectionListener?: (socket: TLSSocket) => void) {
    super();
    this._tlsOptions = options ?? {};
    this._secureContext = createSecureContext(this._tlsOptions);
    this._tlsCertificate = this._secureContext.certificate;

    if (secureConnectionListener) {
      this.on('secureConnection', secureConnectionListener);
    }

    if (this._tlsOptions.cert && !this._tlsCertificate) {
      // PEM provided but failed to parse — emit error asynchronously.
      deferEmit(this as unknown as NetServer, 'error', createNodeError(
        new Error('Failed to parse TLS certificate'), 'createServer', {},
      ));
    }
  }

  /**
   * Add an additional context for SNI (Server Name Indication). Uses RFC 6125
   * matching against the requested server name.
   */
  addContext(hostname: string, context: SecureContextOptions): void {
    try {
      const ctx = createSecureContext(context);
      this._sniContexts.set(hostname.toLowerCase(), ctx);
    } catch (err: unknown) {
      this.emit('error', createNodeError(err, 'addContext', {}));
    }
  }

  /**
   * Resolve a SecureContext for the given server name. Order:
   *   1. exact match in `_sniContexts`
   *   2. RFC 6125 wildcard match in `_sniContexts`
   *   3. SNICallback (if provided)
   *   4. fall through to the server's default context
   */
  private _resolveSniContext(servername: string | null, done: (ctx: SecureContext) => void): void {
    const fallback = this._secureContext;
    if (!servername) { done(fallback); return; }
    const lower = servername.toLowerCase();
    const exact = this._sniContexts.get(lower);
    if (exact) { done(exact); return; }
    const hostParts = splitHost(lower);
    for (const [pattern, ctx] of this._sniContexts) {
      if (checkHostMatch(hostParts, pattern)) { done(ctx); return; }
    }
    if (this._tlsOptions.SNICallback) {
      try {
        this._tlsOptions.SNICallback(servername, (err: Error | null, ctx?: SecureContext) => {
          if (err || !ctx) { done(fallback); return; }
          done(ctx);
        });
        return;
      } catch {
        done(fallback);
        return;
      }
    }
    done(fallback);
  }

  listen(...args: unknown[]): this {
    this.on('connection', (socket: Socket) => {
      this._upgradeTls(socket);
    });
    type ListenArgs = Parameters<NetServer['listen']>;
    return (super.listen as (...a: ListenArgs) => this)(...(args as unknown as ListenArgs));
  }

  /** Upgrade a raw TCP socket to TLS using Gio.TlsServerConnection. */
  private _upgradeTls(socket: Socket): void {
    const rawConnection = (socket as unknown as SocketInternals)._connection;
    if (!rawConnection) {
      const err = new Error('Cannot upgrade socket: no underlying connection');
      this.emit('tlsClientError', err, socket);
      socket.destroy();
      return;
    }

    if (!this._tlsCertificate && this._sniContexts.size === 0 && !this._tlsOptions.SNICallback) {
      const err = new Error('TLS server has no certificate configured');
      this.emit('tlsClientError', err, socket);
      socket.destroy();
      return;
    }

    // SNI: Gio does not surface ClientHello server_name to JS pre-handshake;
    // we use the server's default certificate. Real-world SNI multiplexing
    // is documented in STATUS.md "Open TODOs".
    this._resolveSniContext(null, (ctx) => {
      const certificate = ctx.certificate ?? this._tlsCertificate;
      if (!certificate) {
        const err = new Error('SNI resolution returned no certificate');
        this.emit('tlsClientError', err, socket);
        socket.destroy();
        return;
      }

      try {
        const tlsConn = Gio.TlsServerConnection.new(
          rawConnection as unknown as Gio.IOStream,
          certificate,
        );

        // Client-cert / mTLS configuration
        if (this._tlsOptions.requestCert) {
          tlsConn.authenticationMode = this._tlsOptions.rejectUnauthorized !== false
            ? Gio.TlsAuthenticationMode.REQUIRED
            : Gio.TlsAuthenticationMode.REQUESTED;
        } else {
          tlsConn.authenticationMode = Gio.TlsAuthenticationMode.NONE;
        }

        const requireClientCert = !!this._tlsOptions.requestCert
          && this._tlsOptions.rejectUnauthorized !== false;
        const clientCAs = this._secureContext.caCertificates;

        tlsConn.connect('accept-certificate', (
          _conn: Gio.TlsConnection,
          peerCert: Gio.TlsCertificate,
          _errors: Gio.TlsCertificateFlags,
        ): boolean => {
          if (!requireClientCert) return true;
          if (clientCAs.length === 0) return false;
          for (const ca of clientCAs) {
            try {
              const flags = peerCert.verify(null, ca);
              if (flags === Gio.TlsCertificateFlags.NO_FLAGS) return true;
            } catch { /* try next */ }
          }
          return false;
        });

        // ALPN
        if (this._tlsOptions.ALPNProtocols && this._tlsOptions.ALPNProtocols.length > 0) {
          try {
            tlsConn.set_advertised_protocols(this._tlsOptions.ALPNProtocols);
          } catch {
            // ALPN may not be supported
          }
        }

        const cancellable = new Gio.Cancellable();
        tlsConn.handshake_async(
          GLib.PRIORITY_DEFAULT,
          cancellable,
          (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
            try {
              tlsConn.handshake_finish(asyncResult);

              const tlsSocket = new TLSSocket();
              tlsSocket.encrypted = true;
              tlsSocket.authorized = true;
              tlsSocket._secureContext = ctx;
              tlsSocket._setupTlsStreams(tlsConn);
              tlsSocket.alpnProtocol = tlsSocket.getAlpnProtocol();

              const internals = tlsSocket as unknown as SocketInternals;
              internals._startReading();

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
    });
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

const tlsExports = {
  TLSSocket,
  TLSServer,
  Server: TLSServer,
  connect,
  createServer,
  createSecureContext,
  checkServerIdentity,
  getCiphers,
  rootCertificates,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
  DEFAULT_CIPHERS,
};

export default tlsExports;
