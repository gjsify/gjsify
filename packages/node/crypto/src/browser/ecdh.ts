// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by crypto-browserify
// (Calvin Metcalf + browserify contributors, MIT) and aligned with WebCrypto
// (W3C). Sync APIs that have no WebCrypto equivalent throw ENOTSUP; the
// async variants are preferred.
//
// Reference: refs/create-ecdh/browser.js, Node.js lib/internal/crypto/diffiehellman.js.
//
// ECDH (Elliptic Curve Diffie-Hellman) is implemented here with pure-BigInt
// (ES2024) elliptic curve arithmetic — no native dependency and no GLib import —
// so it bundles cleanly for the browser target while keeping Node's *synchronous*
// `createECDH()` / `generateKeys()` / `computeSecret()` API shape. WebCrypto's
// `subtle.deriveBits({name:"ECDH",…})` is async-only and does not expose
// secp256k1, so the BigInt path is the faithful drop-in. This is a self-contained
// copy of the GJS `ecdh.ts` math, differing only in pulling `randomBytes` from
// the browser (WebCrypto-backed) random module instead of the GLib-backed one.
//
// Curve parameters from NIST FIPS 186-4 and SEC 2.

import { Buffer } from 'node:buffer';
import { randomBytes } from './random.js';

// ---------------------------------------------------------------------------
// Elliptic curve types
// ---------------------------------------------------------------------------

/** A point on an elliptic curve, or null for the point at infinity. */
type ECPoint = { x: bigint; y: bigint } | null;

interface CurveParams {
    /** Field prime */
    p: bigint;
    /** Curve coefficient a */
    a: bigint;
    /** Curve coefficient b */
    b: bigint;
    /** Generator x-coordinate */
    Gx: bigint;
    /** Generator y-coordinate */
    Gy: bigint;
    /** Order of the generator */
    n: bigint;
    /** Byte length of a field element */
    byteLength: number;
}

// ---------------------------------------------------------------------------
// Curve parameter definitions (NIST FIPS 186-4 / SEC 2)
// ---------------------------------------------------------------------------

const CURVES: Record<string, CurveParams> = {
    secp256k1: {
        p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn,
        a: 0n,
        b: 7n,
        Gx: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
        Gy: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
        n: 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
        byteLength: 32,
    },
    prime256v1: {
        p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
        a: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn - 3n,
        b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
        Gx: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
        Gy: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
        n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
        byteLength: 32,
    },
    secp384r1: {
        p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffffn,
        a: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffffn - 3n,
        b: 0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aefn,
        Gx: 0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7n,
        Gy: 0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5fn,
        n: 0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n,
        byteLength: 48,
    },
    secp521r1: {
        p: 0x01ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
        a:
            0x01ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn -
            3n,
        b: 0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00n,
        Gx: 0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66n,
        Gy: 0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650n,
        n: 0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409n,
        byteLength: 66,
    },
};

// Curve name aliases — Node.js accepts multiple names for the same curve
const CURVE_ALIASES: Record<string, string> = {
    secp256k1: 'secp256k1',
    prime256v1: 'prime256v1',
    secp256r1: 'prime256v1',
    'p-256': 'prime256v1',
    p256: 'prime256v1',
    secp384r1: 'secp384r1',
    'p-384': 'secp384r1',
    p384: 'secp384r1',
    secp521r1: 'secp521r1',
    'p-521': 'secp521r1',
    p521: 'secp521r1',
};

// ---------------------------------------------------------------------------
// BigInt modular arithmetic
// ---------------------------------------------------------------------------

/** Modular exponentiation using square-and-multiply (BigInt). */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
    if (m === 1n) return 0n;
    base = mod(base, m);
    let result = 1n;
    while (exp > 0n) {
        if (exp & 1n) {
            result = (result * base) % m;
        }
        exp >>= 1n;
        base = (base * base) % m;
    }
    return result;
}

/** Non-negative modulus: always returns a value in [0, mod). */
function mod(a: bigint, m: bigint): bigint {
    const r = a % m;
    return r < 0n ? r + m : r;
}

/**
 * Modular multiplicative inverse using extended Euclidean algorithm.
 * Returns x such that (a * x) mod m = 1.
 */
function modInverse(a: bigint, m: bigint): bigint {
    a = mod(a, m);
    if (a === 0n) {
        throw new Error('No modular inverse for zero');
    }

    let [old_r, r] = [a, m];
    let [old_s, s] = [1n, 0n];

    while (r !== 0n) {
        const q = old_r / r;
        [old_r, r] = [r, old_r - q * r];
        [old_s, s] = [s, old_s - q * s];
    }

    if (old_r !== 1n) {
        throw new Error('Modular inverse does not exist');
    }

    return mod(old_s, m);
}

// ---------------------------------------------------------------------------
// Elliptic curve point operations
// ---------------------------------------------------------------------------

/** Add two points on the curve. Returns null for the point at infinity. */
function pointAdd(P: ECPoint, Q: ECPoint, curve: CurveParams): ECPoint {
    if (P === null) return Q;
    if (Q === null) return P;

    const { p } = curve;

    if (P.x === Q.x) {
        if (mod(P.y + Q.y, p) === 0n) {
            // P + (-P) = O (point at infinity)
            return null;
        }
        // P === Q, use point doubling
        return pointDouble(P, curve);
    }

    // lambda = (Qy - Py) / (Qx - Px) mod p
    const dx = mod(Q.x - P.x, p);
    const dy = mod(Q.y - P.y, p);
    const lambda = mod(dy * modInverse(dx, p), p);

    const x3 = mod(lambda * lambda - P.x - Q.x, p);
    const y3 = mod(lambda * (P.x - x3) - P.y, p);

    return { x: x3, y: y3 };
}

/** Double a point on the curve. */
function pointDouble(P: ECPoint, curve: CurveParams): ECPoint {
    if (P === null) return null;

    const { a, p } = curve;

    // If y === 0, the tangent is vertical → point at infinity
    if (P.y === 0n) return null;

    // lambda = (3 * x^2 + a) / (2 * y) mod p
    const num = mod(3n * P.x * P.x + a, p);
    const den = mod(2n * P.y, p);
    const lambda = mod(num * modInverse(den, p), p);

    const x3 = mod(lambda * lambda - 2n * P.x, p);
    const y3 = mod(lambda * (P.x - x3) - P.y, p);

    return { x: x3, y: y3 };
}

/**
 * Scalar multiplication using a Montgomery-ladder variant — matches the
 * behaviour of refs/create-ecdh (which uses elliptic.js).
 */
function scalarMul(k: bigint, P: ECPoint, curve: CurveParams): ECPoint {
    if (P === null) return null;
    if (k === 0n) return null;

    const { n } = curve;
    k = mod(k, n);
    if (k === 0n) return null;

    let R0: ECPoint = null; // identity
    let R1: ECPoint = P;

    const bits = k.toString(2);
    for (let i = 0; i < bits.length; i++) {
        if (bits[i] === '1') {
            R0 = pointAdd(R0, R1, curve);
            R1 = pointDouble(R1, curve);
        } else {
            R1 = pointAdd(R0, R1, curve);
            R0 = pointDouble(R0, curve);
        }
    }

    return R0;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Convert a BigInt to a Buffer of exactly `len` bytes (big-endian, zero-padded). */
function bigintToBuffer(n: bigint, len: number): Buffer {
    const hex = n.toString(16).padStart(len * 2, '0');
    return Buffer.from(hex, 'hex');
}

/** Convert a Buffer (big-endian unsigned) to a BigInt. */
function bufferToBigint(buf: Buffer | Uint8Array): bigint {
    const hex = Buffer.from(buf).toString('hex');
    if (hex.length === 0) return 0n;
    return BigInt('0x' + hex);
}

/**
 * Encode a public key point to a Buffer.
 *   'uncompressed' (default) — 0x04 || x || y
 *   'compressed'             — 0x02 (even y) / 0x03 (odd y) || x
 *   'hybrid'                 — 0x06 (even y) / 0x07 (odd y) || x || y
 */
function encodePublicKey(
    point: ECPoint,
    byteLength: number,
    format: 'uncompressed' | 'compressed' | 'hybrid' = 'uncompressed',
): Buffer {
    if (point === null) {
        throw new Error('Cannot encode the point at infinity');
    }

    const xBuf = bigintToBuffer(point.x, byteLength);

    if (format === 'compressed') {
        const prefix = point.y % 2n === 0n ? 0x02 : 0x03;
        return Buffer.concat([Buffer.from([prefix]), xBuf]);
    }

    const yBuf = bigintToBuffer(point.y, byteLength);

    if (format === 'hybrid') {
        const prefix = point.y % 2n === 0n ? 0x06 : 0x07;
        return Buffer.concat([Buffer.from([prefix]), xBuf, yBuf]);
    }

    return Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);
}

/** Decode a public key from a Buffer to an ECPoint. */
function decodePublicKey(buf: Buffer | Uint8Array, curve: CurveParams): ECPoint {
    const data = Buffer.from(buf);
    if (data.length === 0) {
        throw new Error('Invalid public key: empty buffer');
    }

    const prefix = data[0];
    const { p, a, b, byteLength } = curve;

    if (prefix === 0x04 || prefix === 0x06 || prefix === 0x07) {
        if (data.length !== 1 + 2 * byteLength) {
            throw new Error(`Invalid public key length: expected ${1 + 2 * byteLength} bytes, got ${data.length}`);
        }
        const x = bufferToBigint(data.subarray(1, 1 + byteLength));
        const y = bufferToBigint(data.subarray(1 + byteLength));

        // Validate that the point is on the curve: y^2 ≡ x^3 + ax + b (mod p)
        const lhs = mod(y * y, p);
        const rhs = mod(x * x * x + a * x + b, p);
        if (lhs !== rhs) {
            throw new Error('Invalid public key: point is not on the curve');
        }

        return { x, y };
    }

    if (prefix === 0x02 || prefix === 0x03) {
        if (data.length !== 1 + byteLength) {
            throw new Error(`Invalid public key length: expected ${1 + byteLength} bytes, got ${data.length}`);
        }
        const x = bufferToBigint(data.subarray(1, 1 + byteLength));

        // Recover y from x: y^2 = x^3 + ax + b (mod p)
        const ySquared = mod(x * x * x + a * x + b, p);
        const y = sqrtMod(ySquared, p);
        if (y === null) {
            throw new Error('Invalid public key: no valid y coordinate for the given x');
        }

        const isOdd = prefix === 0x03;
        const finalY = (y % 2n !== 0n) === isOdd ? y : mod(p - y, p);

        return { x, y: finalY };
    }

    throw new Error(`Invalid public key prefix: 0x${prefix.toString(16).padStart(2, '0')}`);
}

/**
 * Compute the modular square root of a modulo p (Tonelli-Shanks).
 * Uses the simpler p ≡ 3 (mod 4) formula where applicable (all four NIST curves).
 * Returns null if a is not a quadratic residue mod p.
 */
function sqrtMod(a: bigint, p: bigint): bigint | null {
    a = mod(a, p);
    if (a === 0n) return 0n;

    if (modPow(a, (p - 1n) / 2n, p) !== 1n) {
        return null;
    }

    if (mod(p, 4n) === 3n) {
        return modPow(a, (p + 1n) / 4n, p);
    }

    // General Tonelli-Shanks
    let S = 0n;
    let Q = p - 1n;
    while (mod(Q, 2n) === 0n) {
        Q /= 2n;
        S++;
    }

    let z = 2n;
    while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) {
        z++;
    }

    let M = S;
    let c = modPow(z, Q, p);
    let t = modPow(a, Q, p);
    let R = modPow(a, (Q + 1n) / 2n, p);

    while (true) {
        if (t === 0n) return 0n;
        if (t === 1n) return R;

        let i = 1n;
        let temp = mod(t * t, p);
        while (temp !== 1n) {
            temp = mod(temp * temp, p);
            i++;
        }

        const bExp = modPow(c, modPow(2n, M - i - 1n, p - 1n), p);
        M = i;
        c = mod(bExp * bExp, p);
        t = mod(t * c, p);
        R = mod(R * bExp, p);
    }
}

/** Coerce an input value to a Buffer. */
function toBuffer(value: string | Buffer | Uint8Array | ArrayBufferView, encoding?: BufferEncoding): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') {
        return Buffer.from(value, encoding || 'utf8');
    }
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('The "key" argument must be of type string or an instance of Buffer, TypedArray, or DataView.');
}

/** Optionally encode a Buffer to a string. */
function formatReturnValue(buf: Buffer, encoding?: BufferEncoding | null): Buffer | string {
    if (encoding) {
        return buf.toString(encoding);
    }
    return buf;
}

/** Resolve curve name through aliases. */
function resolveCurve(curveName: string): { canonical: string; params: CurveParams } {
    const lower = curveName.toLowerCase();
    const canonical = CURVE_ALIASES[lower];
    if (!canonical) {
        throw new Error(`Unsupported curve: ${curveName}`);
    }
    const params = CURVES[canonical];
    if (!params) {
        throw new Error(`Unsupported curve: ${curveName}`);
    }
    return { canonical, params };
}

// ---------------------------------------------------------------------------
// ECDH class
// ---------------------------------------------------------------------------

class ECDH {
    private _curve: CurveParams;
    private _curveName: string;
    private _privateKey: bigint | null = null;
    private _publicKey: ECPoint = null;

    constructor(curveName: string) {
        const resolved = resolveCurve(curveName);
        this._curve = resolved.params;
        this._curveName = resolved.canonical;
    }

    /** Generate a random private key + derive the public key. Returns the public key. */
    generateKeys(): Buffer;
    generateKeys(encoding: BufferEncoding, format?: 'uncompressed' | 'compressed' | 'hybrid'): string;
    generateKeys(encoding?: BufferEncoding, format?: 'uncompressed' | 'compressed' | 'hybrid'): Buffer | string {
        const { n, byteLength } = this._curve;

        let k: bigint;
        do {
            const bytes = randomBytes(byteLength);
            k = bufferToBigint(bytes);
        } while (k === 0n || k >= n);

        this._privateKey = k;

        const G: ECPoint = { x: this._curve.Gx, y: this._curve.Gy };
        this._publicKey = scalarMul(k, G, this._curve);

        return encoding === undefined ? this.getPublicKey() : this.getPublicKey(encoding, format);
    }

    /** Compute the shared secret using the other party's public key. */
    computeSecret(
        otherPublicKey: string | Buffer | Uint8Array | ArrayBufferView,
        inputEncoding?: BufferEncoding,
        outputEncoding?: BufferEncoding,
    ): Buffer | string {
        if (this._privateKey === null) {
            throw new Error('ECDH key not generated. Call generateKeys() or setPrivateKey() first.');
        }

        const pubBuf = toBuffer(otherPublicKey, inputEncoding);
        const otherPoint = decodePublicKey(pubBuf, this._curve);

        if (otherPoint === null) {
            throw new Error('Invalid public key: point at infinity');
        }

        const sharedPoint = scalarMul(this._privateKey, otherPoint, this._curve);
        if (sharedPoint === null) {
            throw new Error('Shared secret computation resulted in the point at infinity');
        }

        const secret = bigintToBuffer(sharedPoint.x, this._curve.byteLength);
        return formatReturnValue(secret, outputEncoding) as Buffer | string;
    }

    /** Return the public key. Optionally encode as a string. */
    getPublicKey(): Buffer;
    getPublicKey(encoding: BufferEncoding, format?: 'uncompressed' | 'compressed' | 'hybrid'): string;
    getPublicKey(encoding?: BufferEncoding | null, format?: 'uncompressed' | 'compressed' | 'hybrid'): Buffer | string {
        if (this._publicKey === null) {
            throw new Error('ECDH key not generated. Call generateKeys() or setPrivateKey() first.');
        }

        const buf = encodePublicKey(this._publicKey, this._curve.byteLength, format || 'uncompressed');
        return formatReturnValue(buf, encoding) as Buffer | string;
    }

    /** Return the private key. Optionally encode as a string. */
    getPrivateKey(): Buffer;
    getPrivateKey(encoding: BufferEncoding): string;
    getPrivateKey(encoding?: BufferEncoding): Buffer | string {
        if (this._privateKey === null) {
            throw new Error('ECDH key not generated. Call generateKeys() or setPrivateKey() first.');
        }

        const buf = bigintToBuffer(this._privateKey, this._curve.byteLength);
        return formatReturnValue(buf, encoding) as Buffer | string;
    }

    /** Set the public key. */
    setPublicKey(key: string | Buffer | Uint8Array | ArrayBufferView, encoding?: BufferEncoding): void {
        const buf = toBuffer(key, encoding);
        this._publicKey = decodePublicKey(buf, this._curve);
    }

    /** Set the private key and derive the corresponding public key. */
    setPrivateKey(key: string | Buffer | Uint8Array | ArrayBufferView, encoding?: BufferEncoding): void {
        const buf = toBuffer(key, encoding);
        const k = bufferToBigint(buf);

        if (k === 0n || k >= this._curve.n) {
            throw new Error('Private key is out of range [1, n-1]');
        }

        this._privateKey = k;

        const G: ECPoint = { x: this._curve.Gx, y: this._curve.Gy };
        this._publicKey = scalarMul(k, G, this._curve);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an ECDH key exchange object for the specified curve.
 * Supported curves: secp256k1, prime256v1 (P-256), secp384r1 (P-384), secp521r1 (P-521).
 */
export function createECDH(curveName: string): ECDH {
    return new ECDH(curveName);
}

/** Return a list of supported elliptic curve names. */
export function getCurves(): string[] {
    return ['secp256k1', 'prime256v1', 'secp256r1', 'secp384r1', 'secp521r1'];
}

export { ECDH };
