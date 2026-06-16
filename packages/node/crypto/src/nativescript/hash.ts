// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify NativeScript target — NativeScript V8 has no
// GLib and no crypto.subtle, but does ship crypto.getRandomValues and a
// full V8 ES2024 engine. Pure-JS hashing via @noble/hashes.
//
// Reference: Node.js lib/internal/crypto/hash.js
// @noble/hashes: Copyright (c) 2022 Paul Miller (https://paulmillr.com), MIT.

import { Buffer } from 'node:buffer';
import { getNobleHash, normalizeAlgorithm, SUPPORTED_HASHES } from './algos.js';

// Minimal interface matching what @noble/hashes hashers expose.
// Using a structural interface avoids the recursive generic constraint.
interface NobleHasher {
    update(data: Uint8Array): this;
    digest(): Uint8Array;
    clone(): NobleHasher;
}

/**
 * Hash backed by @noble/hashes — fully synchronous, zero native deps.
 * Compatible with the Node.js Hash API subset expected by NS consumers.
 */
export class Hash {
    private _algorithm: string;
    private _hasher: NobleHasher;
    private _finalized = false;

    // `existing` lets copy() reuse a cloned hasher instead of creating a fresh
    // one only to discard it.
    constructor(algorithm: string, existing?: NobleHasher) {
        this._algorithm = normalizeAlgorithm(algorithm);
        this._hasher = existing ?? (getNobleHash(algorithm).create() as unknown as NobleHasher);
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
        this._hasher.update(bytes);
        return this;
    }

    digest(encoding?: BufferEncoding): Buffer | string {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        this._finalized = true;
        const result = this._hasher.digest();
        const buf = Buffer.from(result);
        if (encoding) return buf.toString(encoding);
        return buf;
    }

    copy(): Hash {
        if (this._finalized) {
            throw new Error('Digest already called');
        }
        return new Hash(this._algorithm, this._hasher.clone());
    }
}

export function createHash(algorithm: string): Hash {
    return new Hash(algorithm);
}

export function getHashes(): string[] {
    return [...SUPPORTED_HASHES];
}

export function hash(
    algorithm: string,
    data: string | Buffer | Uint8Array,
    encoding?: BufferEncoding,
): Buffer | string {
    return new Hash(algorithm).update(data).digest(encoding);
}
