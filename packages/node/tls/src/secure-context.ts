// tls.createSecureContext — parses PEM material into Gio.TlsCertificates
// + CA trust anchors. Shared by `tls.connect()` (client) and `TLSServer`
// (server-side cert + addContext SNI map). Node-compat shape: the returned
// SecureContext has a self-referencing `context` field that mirrors
// upstream's `SecureContext.context` (native handle, opaque on Node).

import type Gio from '@girs/gio-2.0';
import { buildCaCertificates, buildGioCertificate, type PemInput } from './internal/pem.js';

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
        try {
            certificate = buildGioCertificate(opts.cert, opts.key);
        } catch {
            certificate = null;
        }
    }
    const caCertificates = opts.ca ? buildCaCertificates(opts.ca) : [];
    const ctx = { certificate, caCertificates, options: opts } as SecureContext;
    ctx.context = ctx; // Node-compat self-reference
    return ctx;
}
