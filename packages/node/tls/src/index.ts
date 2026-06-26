// @gjsify/tls — Node.js `node:tls` polyfill for GJS.
//
// Reference: Node.js lib/tls.js, lib/_tls_common.js, lib/_tls_wrap.js
// Reimplemented for GJS using Gio.TlsClientConnection / Gio.TlsServerConnection /
//   Gio.TlsCertificate.
//
// Node-TLS option / API → Gio.TLS property/method mapping:
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
//   tls.createServer({SNICallback})   →  Real ClientHello-driven selection:
//                                        peek the inbound bytes via
//                                        Gio.BufferedInputStream, parse the
//                                        server_name extension out, then pick
//                                        a SecureContext via addContext() /
//                                        SNICallback. See tls-server.ts.
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
// Composition layout (see each module's header for details):
//   - internal/pem.ts          — PEM helpers, Gio.TlsCertificate builders
//   - internal/cert-utils.ts   — Peer-cert extraction (Gio → Node shape)
//   - internal/hostname.ts     — RFC 6125 §6.4.3 + checkServerIdentity
//   - internal/sni-parser.ts   — ClientHello server_name extension parser
//   - secure-context.ts        — createSecureContext + types
//   - tls-socket.ts            — TLSSocket class + getters
//   - connect.ts               — tls.connect (client)
//   - tls-server.ts            — TLSServer class + createServer + SNI peek
//   - ocsp.ts                  — parseOcspResponse re-exports from @gjsify/tls-native
//   - index.ts                 — this file: re-exports + default object
//
// Documented gaps (see STATUS.md "Open TODOs"):
//   - OCSP stapling on the Gio side: not exposed (parser surfaced via ocsp.ts).
//   - TLS session resumption ('session' event, {session} option) + channel
//     binding (getFinished/getPeerFinished): SURFACE PRESENT (Phase 2 POC,
//     v0.4.30). The native side throws "not supported" today (GnuTLS
//     session_t access through Gio.TlsConnection's GIO-internal struct
//     pending — see docs/poc/tls-phase2-session-access.md). The JS surface
//     is locked in so flipping the native bits flips the consumer behavior
//     transparently. Gate via hasTlsSessionAccess().
//   - Custom DH/ECDH params, ticket keys: not exposed.

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
export { checkServerIdentity, __TLS_BUILD_MARKER } from './internal/hostname.js';
export type { SecureContext, SecureContextOptions } from './secure-context.js';
export { createSecureContext } from './secure-context.js';
export type { TlsConnectOptions } from './tls-socket.js';
export { TLSSocket } from './tls-socket.js';
export { connect } from './connect.js';
export type { SNICallback, TlsServerOptions } from './tls-server.js';
export { TLSServer, createServer } from './tls-server.js';
export { TLSServer as Server } from './tls-server.js';

// OCSP-response parsing — re-exported from @gjsify/tls-native. Gated by
// hasOcspSupport() since the underlying bridge is a GJS-only Vala prebuild
// wrapping GnuTLS. See ocsp.ts for the consumer flow.
export {
    parseOcspResponse,
    hasOcspSupport,
    OcspCertStatus,
    OcspResponseStatus,
    type OcspResponseInfo,
} from './ocsp.js';

// Phase 2: session resumption + channel binding — surface re-exports
// from @gjsify/tls-native via session-access.ts. The TLSSocket getters
// (`getSession`, `getFinished`, `getPeerFinished`, `isSessionReused`,
// the `'session'` event, the `{session}` option on `connect()`) are
// always present; their NO-OP / throw-into-undefined behavior is
// gated by `hasTlsSessionAccess()`. See session-access.ts for the
// full consumer flow.
export {
    hasTlsSessionAccess,
    TlsChannelBindingType,
    type NativeSessionAccess as TlsSessionAccess,
} from './session-access.js';

// --- default-object export (Node CJS-compat) -------------------------------
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
