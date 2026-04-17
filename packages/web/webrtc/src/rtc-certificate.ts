// W3C RTCCertificate for GJS.
//
// Lightweight certificate representation for RTCPeerConnection.
// generateCertificate() validates algorithm parameters and returns a
// certificate with a future expiry. The actual DTLS certificate used by
// webrtcbin is generated internally by GStreamer — this class provides
// the W3C API surface for certificate management.
//
// Reference: W3C WebRTC spec § 4.10
// Reference: refs/wpt/webrtc/RTCPeerConnection-generateCertificate.html
// Reference: refs/wpt/webrtc/RTCCertificate.html

import GLib from 'gi://GLib?version=2.0';

export interface RTCDtlsFingerprint {
    algorithm?: string;
    value?: string;
}

// Default certificate lifetime: 30 days
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export class RTCCertificate {
    readonly expires: number; // DOMTimeStamp (ms since epoch)
    private _fingerprints: RTCDtlsFingerprint[];
    private _algorithm: string;

    /** @internal — use RTCPeerConnection.generateCertificate() */
    constructor(algorithm: string, expires: number, fingerprints: RTCDtlsFingerprint[]) {
        this._algorithm = algorithm;
        this.expires = expires;
        this._fingerprints = fingerprints;
    }

    getFingerprints(): RTCDtlsFingerprint[] {
        return [...this._fingerprints];
    }

    /** @internal — the algorithm name for debugging/inspection */
    get _algorithmName(): string {
        return this._algorithm;
    }
}

export type AlgorithmIdentifier = string | Record<string, unknown>;

/**
 * Generate a self-signed certificate for use with RTCPeerConnection.
 * Supports ECDSA P-256 and RSASSA-PKCS1-v1_5 with SHA-256.
 *
 * The actual DTLS certificate used by webrtcbin is generated internally
 * by GStreamer — this provides the spec-compliant JS API surface.
 */
export async function generateCertificate(keygenAlgorithm: AlgorithmIdentifier): Promise<RTCCertificate> {
    let name: string;

    if (typeof keygenAlgorithm === 'string') {
        name = keygenAlgorithm.toLowerCase();
    } else if (keygenAlgorithm && typeof keygenAlgorithm === 'object' && typeof keygenAlgorithm.name === 'string') {
        name = (keygenAlgorithm.name as string).toLowerCase();
    } else {
        throw new DOMException(
            'generateCertificate: algorithm must have a name property',
            'NotSupportedError',
        );
    }

    // Validate supported algorithms
    if (name === 'ecdsa') {
        const curve = (keygenAlgorithm as any).namedCurve;
        if (curve && curve !== 'P-256') {
            throw new DOMException(
                `generateCertificate: unsupported ECDSA curve '${curve}'`,
                'NotSupportedError',
            );
        }
    } else if (name === 'rsassa-pkcs1-v1_5') {
        const hash = (keygenAlgorithm as any).hash;
        const hashName = typeof hash === 'string' ? hash : hash?.name;
        if (hashName && hashName.toUpperCase() === 'SHA-1') {
            throw new DOMException(
                'generateCertificate: SHA-1 is not supported for RSA certificates',
                'NotSupportedError',
            );
        }
    } else {
        throw new DOMException(
            `generateCertificate: unsupported algorithm '${name}'`,
            'NotSupportedError',
        );
    }

    // Generate a pseudo-random fingerprint using GLib
    const uuid = GLib.uuid_string_random();
    const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
    checksum!.update(new TextEncoder().encode(uuid + Date.now()));
    const fingerprintHex = checksum!.get_string()!;

    // Format as colon-separated hex pairs (sha-256 fingerprint format)
    const formatted = fingerprintHex.slice(0, 64)
        .match(/.{2}/g)!
        .join(':')
        .toUpperCase();

    const expires = Date.now() + DEFAULT_EXPIRY_MS;

    return new RTCCertificate(name, expires, [
        { algorithm: 'sha-256', value: formatted },
    ]);
}
