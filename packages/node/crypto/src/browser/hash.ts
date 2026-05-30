// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Reference: refs/crypto-browserify/* (+ sub-refs: hash-base, create-hash).
//
// Architectural note: WebCrypto's `subtle.digest()` is asynchronous, but
// Node's `Hash#digest()` is synchronous. We expose a `digestAsync()` method
// that returns a Promise<Buffer>; the synchronous `digest()` throws
// ENOTSUP_SYNC_DIGEST with a clear "use digestAsync()" message. This matches
// the documented "partial" runtime slot — async paths are first-class,
// sync paths degrade with a structured failure.

import { Buffer } from 'node:buffer';

const WEBCRYPTO_ALGOS: Record<string, string> = {
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
        `Synchronous digest is not supported in browser builds (algorithm: ${algorithm}). ` +
            `Call hash.digestAsync(encoding) or await crypto.subtle.digest() instead.`,
    );
    err.code = 'ENOTSUP_SYNC_DIGEST';
    return err;
}

/** Hash class backed by WebCrypto `subtle.digest`. */
export class Hash {
    private _algorithm: string;
    private _webAlgo: string;
    private _chunks: Uint8Array[] = [];
    private _totalLen = 0;
    private _finalized = false;

    constructor(algorithm: string) {
        const normalized = normalizeAlgorithm(algorithm);
        const webAlgo = WEBCRYPTO_ALGOS[normalized];
        if (!webAlgo) {
            const err: NodeJS.ErrnoException = new Error(`Unknown or unsupported message digest: ${algorithm}`);
            err.code = 'ERR_CRYPTO_HASH_UNKNOWN';
            throw err;
        }
        this._algorithm = normalized;
        this._webAlgo = webAlgo;
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

    /** Async digest — preferred entry in browser builds. */
    async digestAsync(encoding?: BufferEncoding): Promise<Buffer | string> {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        this._finalized = true;
        const subtle = getWebSubtle();
        const merged = this._concat();
        const hashed = await subtle.digest(this._webAlgo, merged as BufferSource);
        const buf = Buffer.from(hashed);
        if (encoding) return buf.toString(encoding);
        return buf;
    }

    /** Sync digest — throws ENOTSUP_SYNC_DIGEST in browser builds. */
    digest(_encoding?: BufferEncoding): Buffer | string {
        throw makeSyncUnsupportedError(this._algorithm);
    }

    /** Snapshot copy — `_chunks` are reused (Uint8Array views are read-only here). */
    copy(): Hash {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        const copy = new Hash(this._algorithm);
        copy._chunks = [...this._chunks];
        copy._totalLen = this._totalLen;
        return copy;
    }

    private _concat(): Uint8Array {
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

export function createHash(algorithm: string): Hash {
    return new Hash(algorithm);
}

export function getHashes(): string[] {
    return Object.keys(WEBCRYPTO_ALGOS);
}

/** Convenience: one-shot hash (Node 21+). Async — use await. */
export async function hash(
    algorithm: string,
    data: string | Buffer | Uint8Array,
    encoding?: BufferEncoding,
): Promise<Buffer | string> {
    return new Hash(algorithm).update(data).digestAsync(encoding);
}
