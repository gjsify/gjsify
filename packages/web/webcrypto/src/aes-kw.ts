// AES Key Wrap / Unwrap — RFC 3394, over a 16-byte AES-ECB block primitive.
//
// Reference: RFC 3394 §2.2.1 (wrap) / §2.2.2 (unwrap).
// The caller supplies a `(block16) => block16` AES-ECB encrypt/decrypt closure
// (single block, no padding); this module owns only the wrapping construction,
// so it stays platform-agnostic and is unit-testable directly against the RFC
// 3394 test vectors.

/** The RFC 3394 default initial value (`A6A6A6A6A6A6A6A6`). */
const DEFAULT_IV = Uint8Array.of(0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6);

/** A single 16-byte AES-ECB block transform (encrypt or decrypt, no padding). */
export type AesBlockFn = (block: Uint8Array) => Uint8Array;

/** XOR the 64-bit big-endian counter `t` into the last 8 bytes of `a`. */
function xorCounter(a: Uint8Array, t: number): void {
    for (let k = 0; k < 8 && t > 0; k++) {
        a[7 - k] ^= t & 0xff;
        t = Math.floor(t / 0x100);
    }
}

/**
 * RFC 3394 AES Key Wrap. `plaintext` is the key material to wrap — a multiple of
 * 8 bytes, at least 16 (two semiblocks). Returns `plaintext.length + 8` bytes.
 */
export function aesKeyWrap(plaintext: Uint8Array, encryptBlock: AesBlockFn): Uint8Array {
    if (plaintext.length < 16 || plaintext.length % 8 !== 0) {
        throw new DOMException(
            'AES-KW: key data must be a multiple of 8 bytes and at least 16 bytes',
            'OperationError',
        );
    }
    const n = plaintext.length / 8;
    const a = DEFAULT_IV.slice();
    const r: Uint8Array[] = [];
    for (let i = 0; i < n; i++) r.push(plaintext.slice(i * 8, i * 8 + 8));

    const block = new Uint8Array(16);
    for (let j = 0; j <= 5; j++) {
        for (let i = 1; i <= n; i++) {
            block.set(a, 0);
            block.set(r[i - 1], 8);
            const b = encryptBlock(block);
            a.set(b.subarray(0, 8));
            xorCounter(a, n * j + i);
            r[i - 1] = b.slice(8, 16);
        }
    }

    const out = new Uint8Array((n + 1) * 8);
    out.set(a, 0);
    for (let i = 0; i < n; i++) out.set(r[i], (i + 1) * 8);
    return out;
}

/**
 * RFC 3394 AES Key Unwrap. `ciphertext` is `key.length + 8` bytes. Throws
 * `OperationError` when the integrity check (recovered IV ≠ default) fails.
 */
export function aesKeyUnwrap(ciphertext: Uint8Array, decryptBlock: AesBlockFn): Uint8Array {
    if (ciphertext.length < 24 || ciphertext.length % 8 !== 0) {
        throw new DOMException(
            'AES-KW: wrapped key must be a multiple of 8 bytes and at least 24 bytes',
            'OperationError',
        );
    }
    const n = ciphertext.length / 8 - 1;
    const a = ciphertext.slice(0, 8);
    const r: Uint8Array[] = [];
    for (let i = 0; i < n; i++) r.push(ciphertext.slice((i + 1) * 8, (i + 2) * 8));

    const block = new Uint8Array(16);
    for (let j = 5; j >= 0; j--) {
        for (let i = n; i >= 1; i--) {
            xorCounter(a, n * j + i);
            block.set(a, 0);
            block.set(r[i - 1], 8);
            const b = decryptBlock(block);
            a.set(b.subarray(0, 8));
            r[i - 1] = b.slice(8, 16);
        }
    }

    let ok = true;
    for (let k = 0; k < 8; k++) if (a[k] !== DEFAULT_IV[k]) ok = false;
    if (!ok) throw new DOMException('AES-KW: integrity check failed', 'OperationError');

    const out = new Uint8Array(n * 8);
    for (let i = 0; i < n; i++) out.set(r[i], i * 8);
    return out;
}
