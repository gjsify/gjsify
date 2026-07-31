// PEM helpers — coerce arbitrary PEM input shapes (string / Buffer /
// Uint8Array / arrays of those) into a single string, split a concatenated
// blob into individual `-----BEGIN ... END-----` blocks, and turn the result
// into Gio.TlsCertificate instances.

import Gio from '@girs/gio-2.0';

export type PemInput = string | Buffer | Uint8Array | Array<string | Buffer | Uint8Array>;

/** Coerce a PEM input (string, Buffer/Uint8Array, or array) to a single PEM string. */
export function pemToString(value: PemInput): string {
    if (Array.isArray(value)) {
        return value.map(pemToString).join('\n');
    }
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) {
        // Covers Buffer too (a Uint8Array subclass). The old
        // `value.toString('utf-8')` + catch was wrong twice over: for a plain
        // Uint8Array it silently produced "45,45,45,…" (TypedArrays inherit
        // Array.prototype.toString, which ignores the encoding argument and
        // never throws), so the TextDecoder fallback was unreachable AND the
        // PEM got corrupted. TextDecoder decodes both shapes correctly.
        return new TextDecoder('utf-8').decode(value);
    }
    return String(value);
}

/** Split a concatenated PEM blob into individual `-----BEGIN ...-----...-----END ...-----` blocks. */
export function splitPemBlocks(pem: string): string[] {
    const out: string[] = [];
    const re = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pem)) !== null) {
        out.push(m[0]);
    }
    return out;
}

/** Build a TlsCertificate (and chain) from PEM strings. The first cert and key are the leaf. */
export function buildGioCertificate(cert: PemInput, key?: PemInput): Gio.TlsCertificate {
    const certPem = pemToString(cert);
    const keyPem = key ? pemToString(key) : '';
    const pem = keyPem ? `${certPem}\n${keyPem}` : certPem;
    return Gio.TlsCertificate.new_from_pem(pem, pem.length);
}

/** Parse a CA bundle (PEM string or array) into a list of TlsCertificate trust anchors. */
export function buildCaCertificates(ca: PemInput): Gio.TlsCertificate[] {
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

/** Decode a single PEM cert block into raw DER bytes. */
export function pemToDer(pem: string): Uint8Array {
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
