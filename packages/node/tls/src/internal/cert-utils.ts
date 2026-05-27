// Peer-certificate extraction. Converts a Gio.TlsCertificate to the Node
// `getPeerCertificate()` shape: subject / issuer (parsed from DN strings),
// subjectaltname (DNS: / IP Address: list), valid_from / valid_to,
// fingerprint (SHA-1) / fingerprint256 (SHA-256), raw DER bytes, and the
// optional `issuerCertificate` chain when `detailed=true`.

import type Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { pemToDer } from './pem.js';

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
export function parseDistinguishedName(dn: string | null): CertSubject {
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
export function formatCertDate(dt: GLib.DateTime | null): string {
    if (!dt) return '';
    try {
        return dt.format('%b %d %H:%M:%S %Y GMT') ?? '';
    } catch {
        return '';
    }
}

/** Build the "subjectaltname" string from DNS names + IP addresses (Node format). */
export function formatAltNames(cert: Gio.TlsCertificate): string {
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
    } catch {
        /* not all backends support this */
    }
    try {
        const ips = cert.get_ip_addresses();
        if (ips) for (const ip of ips) parts.push(`IP Address:${ip.to_string()}`);
    } catch {
        /* same */
    }
    return parts.join(', ');
}

/** Compute SHA-1 / SHA-256 fingerprint strings from raw DER bytes (`AA:BB:CC:…`). */
export function fingerprintFromBytes(bytes: Uint8Array, algo: GLib.ChecksumType): string {
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

/** Convert a single TlsCertificate to the Node `getPeerCertificate()` shape. */
export function tlsCertToPeerCert(cert: Gio.TlsCertificate, detailed: boolean): PeerCertificate {
    const out: PeerCertificate = {};
    try {
        out.subject = parseDistinguishedName(cert.get_subject_name());
    } catch {
        /* */
    }
    try {
        out.issuer = parseDistinguishedName(cert.get_issuer_name());
    } catch {
        /* */
    }
    out.subjectaltname = formatAltNames(cert);
    try {
        out.valid_from = formatCertDate(cert.get_not_valid_before());
        out.valid_to = formatCertDate(cert.get_not_valid_after());
    } catch {
        /* */
    }
    try {
        const c = cert as unknown as { certificate_pem?: string; certificatePem?: string };
        const pemProp = c.certificate_pem ?? c.certificatePem;
        if (pemProp) {
            const der = pemToDer(pemProp);
            out.raw = der;
            out.fingerprint = fingerprintFromBytes(der, GLib.ChecksumType.SHA1);
            out.fingerprint256 = fingerprintFromBytes(der, GLib.ChecksumType.SHA256);
        }
    } catch {
        /* */
    }
    if (detailed) {
        try {
            const issuerCert = cert.get_issuer();
            if (issuerCert && !issuerCert.is_same(cert)) {
                out.issuerCertificate = tlsCertToPeerCert(issuerCert, true);
            } else if (issuerCert) {
                out.issuerCertificate = out; // self-signed: Node returns self-ref
            }
        } catch {
            /* */
        }
    }
    return out;
}
