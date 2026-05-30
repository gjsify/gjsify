// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Reference: refs/crypto-browserify/* (+ sub-ref: create-hmac).
//
// Architectural note: same async-only contract as `Hash` — `digest()` throws
// `ENOTSUP_SYNC_DIGEST`, `digestAsync()` returns Promise<Buffer>.

import { Buffer } from 'node:buffer';

const WEBCRYPTO_HMAC_ALGOS: Record<string, string> = {
    sha1: 'SHA-1',
    sha256: 'SHA-256',
    sha384: 'SHA-384',
    sha512: 'SHA-512',
};

function normalizeAlgorithm(algorithm: string): string {
    return algorithm.toLowerCase().replace(/-/g, '');
}

function getWebSubtle(): SubtleCrypto {
    if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
        throw new Error('WebCrypto SubtleCrypto is unavailable in this environment');
    }
    return globalThis.crypto.subtle;
}

function makeSyncUnsupportedError(algorithm: string): Error {
    const err: NodeJS.ErrnoException = new Error(
        `Synchronous Hmac digest is not supported in browser builds (algorithm: ${algorithm}). ` +
            `Call hmac.digestAsync(encoding) or await crypto.subtle.sign('HMAC', …) instead.`,
    );
    err.code = 'ENOTSUP_SYNC_DIGEST';
    return err;
}

/** Hmac class backed by WebCrypto `subtle.importKey` + `subtle.sign('HMAC')`. */
export class Hmac {
    private _algorithm: string;
    private _webAlgo: string;
    private _keyBytes: Uint8Array;
    private _chunks: Uint8Array[] = [];
    private _totalLen = 0;
    private _finalized = false;

    constructor(algorithm: string, key: string | Buffer | Uint8Array) {
        const normalized = normalizeAlgorithm(algorithm);
        const webAlgo = WEBCRYPTO_HMAC_ALGOS[normalized];
        if (!webAlgo) {
            const err: NodeJS.ErrnoException = new Error(`Unknown or unsupported message digest: ${algorithm}`);
            err.code = 'ERR_CRYPTO_HASH_UNKNOWN';
            throw err;
        }
        this._algorithm = normalized;
        this._webAlgo = webAlgo;

        if (typeof key === 'string') {
            this._keyBytes = Buffer.from(key, 'utf8');
        } else {
            this._keyBytes = key instanceof Uint8Array ? key : Buffer.from(key);
        }
    }

    update(data: string | Buffer | Uint8Array, inputEncoding?: BufferEncoding): this {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        let bytes: Uint8Array;
        if (typeof data === 'string') {
            bytes = Buffer.from(data, inputEncoding ?? 'utf8');
        } else {
            bytes = data instanceof Uint8Array ? data : Buffer.from(data);
        }
        this._chunks.push(bytes);
        this._totalLen += bytes.byteLength;
        return this;
    }

    async digestAsync(encoding?: BufferEncoding): Promise<Buffer | string> {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        this._finalized = true;
        const subtle = getWebSubtle();
        const cryptoKey = await subtle.importKey(
            'raw',
            this._keyBytes as BufferSource,
            { name: 'HMAC', hash: this._webAlgo },
            false,
            ['sign'],
        );
        const signature = await subtle.sign('HMAC', cryptoKey, this._concat() as BufferSource);
        const buf = Buffer.from(signature);
        if (encoding) return buf.toString(encoding);
        return buf;
    }

    digest(_encoding?: BufferEncoding): Buffer | string {
        throw makeSyncUnsupportedError(this._algorithm);
    }

    private _concat(): Uint8Array {
        if (this._chunks.length === 0) return new Uint8Array(0);
        if (this._chunks.length === 1) return this._chunks[0];
        const out = new Uint8Array(this._totalLen);
        let offset = 0;
        for (const chunk of this._chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return out;
    }
}

export function createHmac(algorithm: string, key: string | Buffer | Uint8Array): Hmac {
    return new Hmac(algorithm, key);
}
