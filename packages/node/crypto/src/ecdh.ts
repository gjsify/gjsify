// ECDH (Elliptic Curve Diffie-Hellman) for GJS
// Reference: refs/create-ecdh/browser.js, Node.js lib/internal/crypto/diffiehellman.js
// Reimplemented for GJS using native BigInt (ES2024) elliptic curve arithmetic
// Curve parameters from NIST FIPS 186-4 and SEC 2

import { Buffer } from 'buffer';
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
    p: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn,
    a: 0n,
    b: 7n,
    Gx: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
    Gy: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n,
    n: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n,
    byteLength: 32,
  },
  prime256v1: {
    p: 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn,
    a: 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn - 3n,
    b: 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604Bn,
    Gx: 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296n,
    Gy: 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5n,
    n: 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n,
    byteLength: 32,
  },
  secp384r1: {
    p: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFFn,
    a: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFFn - 3n,
    b: 0xB3312FA7E23EE7E4988E056BE3F82D19181D9C6EFE8141120314088F5013875AC656398D8A2ED19D2A85C8EDD3EC2AEFn,
    Gx: 0xAA87CA22BE8B05378EB1C71EF320AD746E1D3B628BA79B9859F741E082542A385502F25DBF55296C3A545E3872760AB7n,
    Gy: 0x3617DE4A96262C6F5D9E98BF9292DC29F8F41DBD289A147CE9DA3113B5F0B8C00A60B1CE1D7E819D7A431D7C90EA0E5Fn,
    n: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973n,
    byteLength: 48,
  },
  secp521r1: {
    p: 0x01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn,
    a: 0x01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn - 3n,
    b: 0x0051953EB9618E1C9A1F929A21A0B68540EEA2DA725B99B315F3B8B489918EF109E156193951EC7E937B1652C0BD3BB1BF073573DF883D2C34F1EF451FD46B503F00n,
    Gx: 0x00C6858E06B70404E9CD9E3ECB662395B4429C648139053FB521F828AF606B4D3DBAA14B5E77EFE75928FE1DC127A2FFA8DE3348B3C1856A429BF97E7E31C2E5BD66n,
    Gy: 0x011839296A789A3BC0045C8A5FB42C7D1BD998F54449579B446817AFBD17273E662C97EE72995EF42640C550B9013FAD0761353C7086A272C24088BE94769FD16650n,
    n: 0x01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA51868783BF2F966B7FCC0148F709A5D03BB5C9B8899C47AEBB6FB71E91386409n,
    byteLength: 66,
  },
};

// Curve name aliases — Node.js accepts multiple names for the same curve
const CURVE_ALIASES: Record<string, string> = {
  'secp256k1': 'secp256k1',
  'prime256v1': 'prime256v1',
  'secp256r1': 'prime256v1',
  'p-256': 'prime256v1',
  'p256': 'prime256v1',
  'secp384r1': 'secp384r1',
  'p-384': 'secp384r1',
  'p384': 'secp384r1',
  'secp521r1': 'secp521r1',
  'p-521': 'secp521r1',
  'p521': 'secp521r1',
};

// ---------------------------------------------------------------------------
// BigInt modular arithmetic
// ---------------------------------------------------------------------------

/**
 * Non-negative modulus: always returns a value in [0, mod).
 */
function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

/**
 * Modular exponentiation via square-and-multiply.
 */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  base = mod(base, m);
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) {
      result = mod(result * base, m);
    }
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}

/**
 * Modular multiplicative inverse using extended Euclidean algorithm.
 * Returns x such that (a * x) mod m = 1.
 * Throws if a and m are not coprime.
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

/**
 * Add two points on the curve.
 * Returns the point at infinity (null) when appropriate.
 */
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

  // Standard addition formula:
  // lambda = (Qy - Py) / (Qx - Px)  mod p
  const dx = mod(Q.x - P.x, p);
  const dy = mod(Q.y - P.y, p);
  const lambda = mod(dy * modInverse(dx, p), p);

  const x3 = mod(lambda * lambda - P.x - Q.x, p);
  const y3 = mod(lambda * (P.x - x3) - P.y, p);

  return { x: x3, y: y3 };
}

/**
 * Double a point on the curve.
 */
function pointDouble(P: ECPoint, curve: CurveParams): ECPoint {
  if (P === null) return null;

  const { a, p } = curve;

  // If y === 0, the tangent is vertical → point at infinity
  if (P.y === 0n) return null;

  // lambda = (3 * x^2 + a) / (2 * y)  mod p
  const num = mod(3n * P.x * P.x + a, p);
  const den = mod(2n * P.y, p);
  const lambda = mod(num * modInverse(den, p), p);

  const x3 = mod(lambda * lambda - 2n * P.x, p);
  const y3 = mod(lambda * (P.x - x3) - P.y, p);

  return { x: x3, y: y3 };
}

/**
 * Scalar multiplication using the double-and-add method (constant-time-ish
 * with respect to the bit length of the scalar, but not fully
 * constant-time — acceptable since we are not a production crypto library
 * and match the behaviour of refs/create-ecdh which uses elliptic.js).
 *
 * Uses a fixed-window approach of width 1 (Montgomery ladder variant) to
 * avoid the most trivial timing leaks.
 */
function scalarMul(k: bigint, P: ECPoint, curve: CurveParams): ECPoint {
  if (P === null) return null;
  if (k === 0n) return null;

  const { n } = curve;
  // Reduce k mod n
  k = mod(k, n);
  if (k === 0n) return null;

  // Montgomery ladder
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

/**
 * Convert a BigInt to a Buffer of exactly `len` bytes (big-endian,
 * zero-padded on the left).
 */
function bigintToBuffer(n: bigint, len: number): Buffer {
  const hex = n.toString(16).padStart(len * 2, '0');
  return Buffer.from(hex, 'hex');
}

/**
 * Convert a Buffer (big-endian unsigned) to a BigInt.
 */
function bufferToBigint(buf: Buffer | Uint8Array): bigint {
  const hex = Buffer.from(buf).toString('hex');
  if (hex.length === 0) return 0n;
  return BigInt('0x' + hex);
}

/**
 * Encode a public key point to a Buffer.
 *
 * Formats:
 *   'uncompressed' (default) — 0x04 || x || y
 *   'compressed'             — 0x02 (even y) or 0x03 (odd y) || x
 *   'hybrid'                 — 0x06 (even y) or 0x07 (odd y) || x || y
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

  // uncompressed
  return Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);
}

/**
 * Decode a public key from a Buffer to an ECPoint.
 *
 * Supports uncompressed (0x04), compressed (0x02/0x03), and hybrid (0x06/0x07).
 */
function decodePublicKey(buf: Buffer | Uint8Array, curve: CurveParams): ECPoint {
  const data = Buffer.from(buf);
  if (data.length === 0) {
    throw new Error('Invalid public key: empty buffer');
  }

  const prefix = data[0];
  const { p, a, b, byteLength } = curve;

  if (prefix === 0x04 || prefix === 0x06 || prefix === 0x07) {
    // Uncompressed or hybrid: prefix || x || y
    if (data.length !== 1 + 2 * byteLength) {
      throw new Error(
        `Invalid public key length: expected ${1 + 2 * byteLength} bytes, got ${data.length}`,
      );
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
    // Compressed: prefix || x
    if (data.length !== 1 + byteLength) {
      throw new Error(
        `Invalid public key length: expected ${1 + byteLength} bytes, got ${data.length}`,
      );
    }
    const x = bufferToBigint(data.subarray(1, 1 + byteLength));

    // Recover y from x: y^2 = x^3 + ax + b (mod p)
    const ySquared = mod(x * x * x + a * x + b, p);
    const y = sqrtMod(ySquared, p);
    if (y === null) {
      throw new Error('Invalid public key: no valid y coordinate for the given x');
    }

    // Choose the correct root based on the prefix parity
    const isOdd = prefix === 0x03;
    const finalY = (y % 2n !== 0n) === isOdd ? y : mod(p - y, p);

    return { x, y: finalY };
  }

  throw new Error(`Invalid public key prefix: 0x${prefix.toString(16).padStart(2, '0')}`);
}

/**
 * Compute the modular square root of a modulo p (Tonelli-Shanks algorithm).
 *
 * For the special case p ≡ 3 (mod 4), uses the simpler formula: a^((p+1)/4) mod p.
 * All four supported NIST curves have p ≡ 3 (mod 4), but we include
 * Tonelli-Shanks for completeness.
 *
 * Returns null if a is not a quadratic residue mod p.
 */
function sqrtMod(a: bigint, p: bigint): bigint | null {
  a = mod(a, p);
  if (a === 0n) return 0n;

  // Euler's criterion: a is a QR iff a^((p-1)/2) ≡ 1 (mod p)
  if (modPow(a, (p - 1n) / 2n, p) !== 1n) {
    return null;
  }

  // Special case: p ≡ 3 (mod 4) — applies to all our supported curves
  if (mod(p, 4n) === 3n) {
    return modPow(a, (p + 1n) / 4n, p);
  }

  // General case: Tonelli-Shanks
  // Factor out powers of 2 from p - 1: p - 1 = Q * 2^S
  let S = 0n;
  let Q = p - 1n;
  while (mod(Q, 2n) === 0n) {
    Q /= 2n;
    S++;
  }

  // Find a quadratic non-residue z
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

    // Find the least i such that t^(2^i) ≡ 1 (mod p)
    let i = 1n;
    let temp = mod(t * t, p);
    while (temp !== 1n) {
      temp = mod(temp * temp, p);
      i++;
    }

    // Update
    const b = modPow(c, modPow(2n, M - i - 1n, p - 1n), p);
    M = i;
    c = mod(b * b, p);
    t = mod(t * c, p);
    R = mod(R * b, p);
  }
}

/**
 * Coerce an input value to a Buffer. Accepts Buffer, Uint8Array, or a string
 * with an optional encoding.
 */
function toBuffer(
  value: string | Buffer | Uint8Array | ArrayBufferView,
  encoding?: BufferEncoding,
): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    return Buffer.from(value, encoding || 'utf8');
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(
    'The "key" argument must be of type string or an instance of Buffer, TypedArray, or DataView.',
  );
}

/**
 * Optionally encode a Buffer to a string. If encoding is null/undefined,
 * return the raw Buffer.
 */
function formatReturnValue(buf: Buffer, encoding?: BufferEncoding | null): Buffer | string {
  if (encoding) {
    return buf.toString(encoding);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Resolve curve name through aliases
// ---------------------------------------------------------------------------

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

  /**
   * Generate a random private key and derive the corresponding public key.
   * Returns the public key.
   */
  generateKeys(): Buffer;
  generateKeys(encoding: BufferEncoding, format?: 'uncompressed' | 'compressed' | 'hybrid'): string;
  generateKeys(
    encoding?: BufferEncoding,
    format?: 'uncompressed' | 'compressed' | 'hybrid',
  ): Buffer | string {
    const { n, byteLength } = this._curve;

    // Generate a random private key in [1, n-1]
    let k: bigint;
    do {
      const bytes = randomBytes(byteLength);
      k = bufferToBigint(bytes);
    } while (k === 0n || k >= n);

    this._privateKey = k;

    // Compute the public key: Q = k * G
    const G: ECPoint = { x: this._curve.Gx, y: this._curve.Gy };
    this._publicKey = scalarMul(k, G, this._curve);

    return this.getPublicKey(encoding as any, format);
  }

  /**
   * Compute the shared secret using the other party's public key.
   */
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

    // Shared secret = x-coordinate of (privateKey * otherPublicKey)
    const sharedPoint = scalarMul(this._privateKey, otherPoint, this._curve);
    if (sharedPoint === null) {
      throw new Error('Shared secret computation resulted in the point at infinity');
    }

    const secret = bigintToBuffer(sharedPoint.x, this._curve.byteLength);
    return formatReturnValue(secret, outputEncoding) as Buffer | string;
  }

  /**
   * Return the public key. Optionally encode as a string.
   */
  getPublicKey(): Buffer;
  getPublicKey(encoding: BufferEncoding, format?: 'uncompressed' | 'compressed' | 'hybrid'): string;
  getPublicKey(
    encoding?: BufferEncoding | null,
    format?: 'uncompressed' | 'compressed' | 'hybrid',
  ): Buffer | string {
    if (this._publicKey === null) {
      throw new Error('ECDH key not generated. Call generateKeys() or setPrivateKey() first.');
    }

    const buf = encodePublicKey(this._publicKey, this._curve.byteLength, format || 'uncompressed');
    return formatReturnValue(buf, encoding) as Buffer | string;
  }

  /**
   * Return the private key. Optionally encode as a string.
   */
  getPrivateKey(): Buffer;
  getPrivateKey(encoding: BufferEncoding): string;
  getPrivateKey(encoding?: BufferEncoding): Buffer | string {
    if (this._privateKey === null) {
      throw new Error('ECDH key not generated. Call generateKeys() or setPrivateKey() first.');
    }

    const buf = bigintToBuffer(this._privateKey, this._curve.byteLength);
    return formatReturnValue(buf, encoding) as Buffer | string;
  }

  /**
   * Set the public key. The key can be in uncompressed, compressed, or hybrid format.
   */
  setPublicKey(
    key: string | Buffer | Uint8Array | ArrayBufferView,
    encoding?: BufferEncoding,
  ): void {
    const buf = toBuffer(key, encoding);
    this._publicKey = decodePublicKey(buf, this._curve);
  }

  /**
   * Set the private key and derive the corresponding public key.
   */
  setPrivateKey(
    key: string | Buffer | Uint8Array | ArrayBufferView,
    encoding?: BufferEncoding,
  ): void {
    const buf = toBuffer(key, encoding);
    const k = bufferToBigint(buf);

    if (k === 0n || k >= this._curve.n) {
      throw new Error('Private key is out of range [1, n-1]');
    }

    this._privateKey = k;

    // Derive the public key from the private key
    const G: ECPoint = { x: this._curve.Gx, y: this._curve.Gy };
    this._publicKey = scalarMul(k, G, this._curve);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an ECDH key exchange object for the specified curve.
 *
 * Supported curves: secp256k1, prime256v1 (P-256), secp384r1 (P-384), secp521r1 (P-521).
 */
export function createECDH(curveName: string): ECDH {
  return new ECDH(curveName);
}

/**
 * Return a list of supported elliptic curve names.
 */
export function getCurves(): string[] {
  return [
    'secp256k1',
    'prime256v1',
    'secp256r1',
    'secp384r1',
    'secp521r1',
  ];
}
