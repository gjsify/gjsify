// Node-semantics verification of a TLS server certificate, over Gio.
//
// Reference: Node.js lib/internal/tls/wrap.js `onConnectSecure` (chain error
// first, then `checkServerIdentity` on the verified peer) + lib/_tls_common.js
// (`ca` REPLACES the default trust store, it does not extend it).
//
// Any client that sees the peer in an `accept-certificate` handler can use
// this — `Gio.TlsClientConnection` and `Soup.Message` hand over the same
// `(peer, errors)` pair. The caller must give its connection NO database
// (`set_database(null)` / `Soup.Session.set_tls_database(null)`): only then
// does glib-networking emit `accept-certificate` for EVERY peer (it adds
// UNKNOWN_CA itself), so the chain check, the identity check and the error
// code are always ours and always Node's. With the system database left in
// place Gio would accept a system-trusted peer without asking — past a `ca`
// that should have replaced the system roots, and past a custom
// `checkServerIdentity`.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { tlsCertToPeerCert, type PeerCertificate } from './internal/cert-utils.js';
import { checkServerIdentity as defaultCheckServerIdentity } from './internal/hostname.js';

export { createSecureContext, type SecureContext, type SecureContextOptions } from './secure-context.js';
export type { PeerCertificate } from './internal/cert-utils.js';

/** Error carrying Node's OpenSSL-derived `code` (e.g. `DEPTH_ZERO_SELF_SIGNED_CERT`). */
export interface TlsVerifyError extends Error {
    code: string;
}

export interface PeerVerifierOptions {
    /** Trust anchors (`SecureContext.caCertificates`). Empty ⇒ the system trust store. */
    caCertificates?: Gio.TlsCertificate[];
    /** Unset ⇒ verify, unless `NODE_TLS_REJECT_UNAUTHORIZED=0` (Node's rule: explicit wins). */
    rejectUnauthorized?: boolean;
    /** Name the certificate must be valid for — Node's `servername || host`. */
    host: string;
    checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
}

export interface PeerVerifier {
    /** `accept-certificate` handler: true accepts the peer. */
    accept(peer: Gio.TlsCertificate): boolean;
    /** Why the peer is not authorized (null when it is) — the error a rejected request reports. */
    readonly error: Error | null;
    readonly authorized: boolean;
    /** Node's `TLSSocket.authorizationError`: the error's code, else its message. */
    readonly authorizationError: string | undefined;
}

/** Resolve `rejectUnauthorized` the way Node's tls.connect does. */
export function resolveRejectUnauthorized(rejectUnauthorized: boolean | undefined): boolean {
    if (rejectUnauthorized !== undefined) return rejectUnauthorized !== false;
    return GLib.getenv('NODE_TLS_REJECT_UNAUTHORIZED') !== '0';
}

/** Build a verifier for one connection attempt. */
export function createPeerVerifier(options: PeerVerifierOptions): PeerVerifier {
    const rejectUnauthorized = resolveRejectUnauthorized(options.rejectUnauthorized);
    const check = options.checkServerIdentity ?? defaultCheckServerIdentity;
    const anchors = options.caCertificates ?? [];
    let error: Error | null = null;
    return {
        accept(peer: Gio.TlsCertificate): boolean {
            // Node runs checkServerIdentity only on a chain that verified.
            error = chainError(peer, anchors) ?? check(options.host, tlsCertToPeerCert(peer, true)) ?? null;
            return error === null || !rejectUnauthorized;
        },
        get error() {
            return error;
        },
        get authorized() {
            return error === null;
        },
        get authorizationError() {
            if (!error) return undefined;
            return (error as Partial<TlsVerifyError>).code ?? error.message;
        },
    };
}

// Identity is checkServerIdentity's job (Node's message + custom callback), so
// Gio's own identity verdict never counts; verification runs without identity.
const CHAIN_FLAGS = Gio.TlsCertificateFlags.VALIDATE_ALL & ~Gio.TlsCertificateFlags.BAD_IDENTITY;

function chainFlags(peer: Gio.TlsCertificate, anchors: Gio.TlsCertificate[]): Gio.TlsCertificateFlags {
    if (anchors.length === 0) {
        const db = Gio.TlsBackend.get_default().get_default_database();
        return db.verify_chain(
            peer,
            Gio.TLS_DATABASE_PURPOSE_AUTHENTICATE_SERVER,
            null,
            null,
            Gio.TlsDatabaseVerifyFlags.NONE,
            null,
        );
    }
    let best = Gio.TlsCertificateFlags.UNKNOWN_CA;
    for (const anchor of anchors) {
        const flags = peer.verify(null, anchor) & CHAIN_FLAGS;
        if (flags === Gio.TlsCertificateFlags.NO_FLAGS) return flags;
        // An anchor that roots the chain but finds it expired says more than one that does not root it.
        if (!(flags & Gio.TlsCertificateFlags.UNKNOWN_CA)) best = flags;
    }
    return best;
}

function isSelfSigned(cert: Gio.TlsCertificate): boolean {
    return cert.get_subject_name() === cert.get_issuer_name();
}

function verifyError(code: string, message: string): TlsVerifyError {
    const err = new Error(message) as TlsVerifyError;
    err.code = code;
    return err;
}

/**
 * The chain's verdict as the error Node (OpenSSL) reports for it, or null.
 * An unknown issuer splits four ways by the shape of the presented chain,
 * matching X509_V_ERR_{DEPTH_ZERO_SELF_SIGNED_CERT,SELF_SIGNED_CERT_IN_CHAIN,
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE,UNABLE_TO_GET_ISSUER_CERT_LOCALLY}.
 */
export function chainError(peer: Gio.TlsCertificate, anchors: Gio.TlsCertificate[] = []): TlsVerifyError | null {
    const flags = chainFlags(peer, anchors) & CHAIN_FLAGS;
    const F = Gio.TlsCertificateFlags;
    if (flags === F.NO_FLAGS) return null;
    if (flags & F.UNKNOWN_CA) {
        if (isSelfSigned(peer)) return verifyError('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate');
        let top = peer;
        for (let next = top.get_issuer(); next && !next.is_same(top); next = top.get_issuer()) top = next;
        if (top === peer) {
            return verifyError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate');
        }
        if (isSelfSigned(top)) {
            return verifyError('SELF_SIGNED_CERT_IN_CHAIN', 'self-signed certificate in certificate chain');
        }
        return verifyError('UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'unable to get local issuer certificate');
    }
    if (flags & F.REVOKED) return verifyError('CERT_REVOKED', 'certificate revoked');
    if (flags & F.EXPIRED) return verifyError('CERT_HAS_EXPIRED', 'certificate has expired');
    if (flags & F.NOT_ACTIVATED) return verifyError('CERT_NOT_YET_VALID', 'certificate is not yet valid');
    if (flags & F.INSECURE) return verifyError('CA_MD_TOO_WEAK', 'CA signature digest algorithm too weak');
    return verifyError('CERT_REJECTED', 'certificate rejected');
}
