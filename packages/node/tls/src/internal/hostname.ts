// RFC 6125 §6.4.3 hostname matching + Node-shaped `checkServerIdentity`.
//
// Reference: Node.js lib/tls.js `exports.checkServerIdentity`.
// - Wildcard valid only in the leftmost label.
// - Wildcard label may not contain Punycode A-labels (`xn--`).
// - Two-label patterns (`*.tld`) are rejected.
// - Exactly one wildcard per label.

import type { PeerCertificate } from './cert-utils.js';

/** Removes a trailing dot from a fully-qualified domain name. */
export function unfqdn(host: string): string {
    return host.endsWith('.') ? host.slice(0, -1) : host;
}

/** Splits a hostname into parts, lower-cased, after removing trailing dots. */
export function splitHost(host: string): string[] {
    return unfqdn(host).toLowerCase().split('.');
}

/** Reject control / non-ASCII bytes in pattern labels (RFC 6125 sanity). */
export function isPrintableAscii(s: string): boolean {
    // U+0021 ('!') through U+007E ('~')
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x21 || c > 0x7e) return false;
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
export function checkHostMatch(hostParts: string[], pattern: string): boolean {
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
        valid = ips.some((ip) => ip.toLowerCase() === hostname.toLowerCase());
        if (!valid) {
            reason = `IP: ${hostname} is not in the cert's list: ${ips.join(', ')}`;
        }
    } else if (dnsNames.length > 0 || subject?.CN) {
        const hostParts = splitHost(hostname);

        if (dnsNames.length > 0) {
            valid = dnsNames.some((pattern) => checkHostMatch(hostParts, pattern.trim()));
            if (!valid) {
                reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
            }
        } else {
            const cn = subject?.CN;
            if (Array.isArray(cn)) {
                valid = cn.some((c) => checkHostMatch(hostParts, c));
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
