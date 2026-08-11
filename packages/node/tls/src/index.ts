// @gjsify/tls — `node:tls` over Gio.Tls{ClientConnection,ServerConnection,Certificate}.
//
// Reference: Node.js lib/tls.js, lib/_tls_common.js, lib/_tls_wrap.js
//
// Where the Gio mapping is not a rename:
//   - {minVersion}/{maxVersion}/{ciphers} are INERT — the GnuTLS backend owns
//     them and Gio exposes no knob; we store them for diagnostics only.
//   - {ca} anchors are verified by hand (per-PEM Gio.TlsCertificate +
//     cert.verify()), and {rejectUnauthorized:false} means the
//     'accept-certificate' signal returns true.
//   - {SNICallback} needs a real ClientHello: peek via Gio.BufferedInputStream,
//     parse the server_name extension, then pick the context (tls-server.ts).
//   - server {requestCert,rejectUnauthorized} collapse onto one Gio property,
//     TlsServerConnection.authentication_mode.
//
// Gaps (status/open-todos.md): Gio-side OCSP stapling — the parser is surfaced
// via ocsp.ts but responses never arrive over the handshake; custom DH/ECDH
// params; ticket keys.

export const DEFAULT_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';
export const DEFAULT_CIPHERS =
    'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';

/** Returns a list of supported TLS cipher names (subset; implementation-defined). */
export function getCiphers(): string[] {
    return ['aes-128-gcm', 'aes-256-gcm', 'chacha20-poly1305', 'aes-128-cbc', 'aes-256-cbc'];
}

export const rootCertificates: string[] = [];

// Type + class re-exports
export type { CertSubject, PeerCertificate } from './internal/cert-utils.js';
export type { CertAltNameError } from './internal/hostname.js';
export { checkServerIdentity } from './internal/hostname.js';
export type { SecureContext, SecureContextOptions } from './secure-context.js';
export { createSecureContext } from './secure-context.js';
export type { TlsConnectOptions } from './tls-socket.js';
export { TLSSocket } from './tls-socket.js';
export { connect } from './connect.js';
export type { SNICallback, TlsServerOptions } from './tls-server.js';
export { TLSServer, createServer } from './tls-server.js';
export { TLSServer as Server } from './tls-server.js';

// Gated by hasOcspSupport(): the bridge is a GJS-only Vala prebuild over GnuTLS.
export {
    parseOcspResponse,
    hasOcspSupport,
    OcspCertStatus,
    OcspResponseStatus,
    type OcspResponseInfo,
} from './ocsp.js';

// Session resumption + channel binding. The TLSSocket surface (`getSession`,
// `getFinished`, `getPeerFinished`, `isSessionReused`, the `'session'` event,
// `connect({session})`) is always present; without a GnuTLS backend it degrades
// to Node's no-session contract, gated by `hasTlsSessionAccess()`.
export {
    hasTlsSessionAccess,
    TlsChannelBindingType,
    type NativeSessionAccess as TlsSessionAccess,
} from './session-access.js';

// Default object, for a Node CJS consumer.
import { checkServerIdentity as _checkServerIdentity } from './internal/hostname.js';
import { createSecureContext as _createSecureContext } from './secure-context.js';
import { TLSSocket as _TLSSocket } from './tls-socket.js';
import { connect as _connect } from './connect.js';
import { TLSServer as _TLSServer, createServer as _createServer } from './tls-server.js';
import {
    parseOcspResponse as _parseOcspResponse,
    hasOcspSupport as _hasOcspSupport,
    OcspCertStatus as _OcspCertStatus,
    OcspResponseStatus as _OcspResponseStatus,
} from './ocsp.js';
import {
    hasTlsSessionAccess as _hasTlsSessionAccess,
    TlsChannelBindingType as _TlsChannelBindingType,
} from './session-access.js';

const tlsExports = {
    TLSSocket: _TLSSocket,
    TLSServer: _TLSServer,
    Server: _TLSServer,
    connect: _connect,
    createServer: _createServer,
    createSecureContext: _createSecureContext,
    checkServerIdentity: _checkServerIdentity,
    getCiphers,
    rootCertificates,
    DEFAULT_MIN_VERSION,
    DEFAULT_MAX_VERSION,
    DEFAULT_CIPHERS,
    parseOcspResponse: _parseOcspResponse,
    hasOcspSupport: _hasOcspSupport,
    OcspCertStatus: _OcspCertStatus,
    OcspResponseStatus: _OcspResponseStatus,
    hasTlsSessionAccess: _hasTlsSessionAccess,
    TlsChannelBindingType: _TlsChannelBindingType,
};

export default tlsExports;
