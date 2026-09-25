// TLS for the http Server when it backs an `https.Server`.
// Reference: Node.js lib/https.js (tls.Server + the HTTP parser) and lib/_tls_wrap.js for the
// server-side `requestCert` / `rejectUnauthorized` / `ca` semantics.
//
// Lives in @gjsify/http, not @gjsify/https, because it needs Gio and the listener is created
// here — @gjsify/https stays a runtime-neutral layer over `node:http` + `node:tls`.

import Gio from '@girs/gio-2.0';
import { createSecureContext } from '@gjsify/tls';

type PemInput = string | Uint8Array | Array<string | Uint8Array>;

/** The `https.createServer()` options that shape the listener. */
export interface ServerTlsOptions {
    key?: PemInput;
    cert?: PemInput;
    ca?: PemInput;
    passphrase?: string;
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
}

/** What Soup.Server needs, derived from ServerTlsOptions. */
export interface ServerTlsSettings {
    certificate: Gio.TlsCertificate;
    authenticationMode: Gio.TlsAuthenticationMode;
    /** Anchors a client certificate must chain to (`ca` with `requestCert`); may be empty. */
    clientCa: Gio.TlsCertificate[];
}

/**
 * Translates Node's options. Returns null without a certificate; throws on PEM that does not
 * parse, as Node's createSecureContext (and so its https.Server) does.
 */
export function resolveServerTls(options: ServerTlsOptions): ServerTlsSettings | null {
    const context = createSecureContext(options);
    if (options.cert && !context.certificate) {
        throw new Error('https.Server: cannot parse the key/cert pair as PEM');
    }
    if (!context.certificate) return null;

    let authenticationMode = Gio.TlsAuthenticationMode.NONE;
    if (options.requestCert) {
        authenticationMode =
            options.rejectUnauthorized === false
                ? Gio.TlsAuthenticationMode.REQUESTED
                : Gio.TlsAuthenticationMode.REQUIRED;
    }
    return {
        certificate: context.certificate,
        authenticationMode,
        clientCa: options.requestCert ? context.caCertificates : [],
    };
}

/**
 * Builds the database that verifies client certificates against `ca`. `Gio.TlsFileDatabase` is
 * GIO's only public database constructor, and it reads its file when it verifies — not when it
 * is created (measured: a file deleted right after `new()` makes every client certificate fail).
 * So the anchors live in a temporary file for as long as the listener does; the caller removes
 * it on close. The file holds only the public CA certificates.
 */
export function createTrustDatabase(anchors: Gio.TlsCertificate[]): { database: Gio.TlsDatabase; file: Gio.File } {
    const [file, stream] = Gio.File.new_tmp('gjsify-https-ca-XXXXXX.pem');
    try {
        const pem = anchors.map((cert) => cert.certificate_pem).join('\n');
        stream.get_output_stream().write_all(new TextEncoder().encode(pem), null);
        stream.close(null);
        return { database: Gio.TlsFileDatabase.new(file.get_path() as string), file };
    } catch (err) {
        removeFile(file);
        throw err;
    }
}

export function removeFile(file: Gio.File): void {
    try {
        file.delete(null);
    } catch {
        // Already gone — nothing to clean up.
    }
}
