// Subresource-Integrity (SRI) verification of downloaded bytes via SubtleCrypto.

/**
 * Verify an SRI string (e.g. `sha512-base64==`) against bytes.
 * Multiple hashes (space-separated) accepted; any match passes.
 */
export async function verifyIntegrity(data: Uint8Array, integrity: string): Promise<boolean> {
    const parts = integrity.trim().split(/\s+/);
    for (const part of parts) {
        const dash = part.indexOf('-');
        if (dash < 0) continue;
        const algo = part.slice(0, dash).toLowerCase();
        const expected = part.slice(dash + 1);
        const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
        if (!subtle) throw new Error('@gjsify/npm-registry: globalThis.crypto.subtle is missing');
        const algoName = subriToWebCryptoAlgo(algo);
        if (!algoName) continue;
        const digest = await subtle.digest(algoName, dataAsArrayBuffer(data));
        const got = bytesToBase64(new Uint8Array(digest));
        if (got === expected) return true;
    }
    return false;
}

function subriToWebCryptoAlgo(sri: string): 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | null {
    switch (sri) {
        case 'sha1':
            return 'SHA-1';
        case 'sha256':
            return 'SHA-256';
        case 'sha384':
            return 'SHA-384';
        case 'sha512':
            return 'SHA-512';
        default:
            return null;
    }
}

function dataAsArrayBuffer(data: Uint8Array): ArrayBuffer {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        return data.buffer as ArrayBuffer;
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
    // Standard base64 — no URL-safe variant. Cross-platform: btoa exists in
    // both Node and GJS (the latter via @gjsify/web-globals).
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}
