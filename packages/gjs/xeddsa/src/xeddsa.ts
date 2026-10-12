// SPDX-License-Identifier: MIT
// XEdDSA over Curve25519 per https://signal.org/docs/specifications/xeddsa/ (revision 1, 2016-10-20).
// The group and field arithmetic comes from @noble/curves and SHA-512 from @noble/hashes (both
// audited, MIT) — the same pair @gjsify/crypto builds its X25519/Ed25519 on.
//
// Signing follows the specification: calculate_key_pair negates the scalar so the Edwards public
// key has sign bit 0, and bit 7 of the last signature byte is 0. libsignal (Rust, Java) instead
// keeps the scalar and stores the sign bit there; its verifier reads that bit back. Verification
// here does the same, so it accepts both kinds of signature, and a spec signature verifies in
// libsignal because bit 0 is the sign bit it then uses.

import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToNumberLE, equalBytes, numberToBytesLE } from '@noble/curves/utils.js';
import { sha512 } from '@noble/hashes/sha2.js';

const Point = ed25519.Point;
const Fp = Point.Fp;
const L = Point.Fn.ORDER;

export const SIGNATURE_LENGTH = 64;
export const KEY_LENGTH = 32;
export const RANDOM_LENGTH = 64;

// hash_1 prefix: 2^256 - 1 - 1 as 32 little-endian bytes (§2.5 hash_i, i = 1).
const HASH1_PREFIX = new Uint8Array(32).fill(0xff);
HASH1_PREFIX[0] = 0xfe;

function assertLength(name: string, bytes: Uint8Array, length: number): void {
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
        throw new TypeError(`${name} must be a Uint8Array of ${length} bytes`);
    }
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function clamp(k: Uint8Array): Uint8Array {
    const c = new Uint8Array(k);
    c[0] &= 248;
    c[31] &= 127;
    c[31] |= 64;
    return c;
}

function hashToScalar(bytes: Uint8Array): bigint {
    return bytesToNumberLE(sha512(bytes)) % L;
}

/**
 * calculate_key_pair (§2.3): the Edwards key pair `(A, a)` for a Curve25519 private key, with `a`
 * negated where needed so `A`'s sign bit is 0. The input is clamped first, as X25519 does.
 */
function calculateKeyPair(curvePrivate: Uint8Array): { A: Uint8Array; a: bigint } {
    let a = bytesToNumberLE(clamp(curvePrivate)) % L;
    let A = Point.BASE.multiply(a).toBytes();
    if (A[31] & 0x80) {
        a = (L - a) % L;
        A = Point.BASE.multiply(a).toBytes();
    }
    return { A, a };
}

/**
 * The Ed25519 private scalar `a` (32 bytes, little-endian) and public key `A` that XEdDSA signs
 * with for a Curve25519 private key. `A` always has sign bit 0, so `A ===
 * curveToEdPublic(x25519.getPublicKey(curvePrivate))`. `a` is a scalar, NOT an RFC 8032 seed —
 * do not feed it to `ed25519.sign`.
 */
export function curveToEdPrivate(curvePrivate: Uint8Array): { privateScalar: Uint8Array; publicKey: Uint8Array } {
    assertLength('curvePrivate', curvePrivate, KEY_LENGTH);
    const { A, a } = calculateKeyPair(curvePrivate);
    return { privateScalar: numberToBytesLE(a, KEY_LENGTH), publicKey: A };
}

/**
 * The Ed25519 public key for a Curve25519 (Montgomery u) public key: `y = (u - 1) / (u + 1)`
 * (§2.2, RFC 7748 §4.1). `u` carries no sign, so the caller picks it; 0 is what XEdDSA and
 * `curveToEdPrivate` use. Throws for u = -1 (no Edwards point) and for a non-canonical u.
 */
export function curveToEdPublic(curvePublic: Uint8Array, signBit: 0 | 1 = 0): Uint8Array {
    assertLength('curvePublic', curvePublic, KEY_LENGTH);
    const ed = montgomeryToEdwards(curvePublic, signBit);
    if (!ed) throw new RangeError('curvePublic has no Edwards25519 counterpart');
    return ed;
}

/** The Curve25519 public key for an Ed25519 public key: `u = (1 + y) / (1 - y)` (RFC 7748 §4.1). */
export function edToCurvePublic(edPublic: Uint8Array): Uint8Array {
    assertLength('edPublic', edPublic, KEY_LENGTH);
    return ed25519.utils.toMontgomery(edPublic);
}

function montgomeryToEdwards(curvePublic: Uint8Array, signBit: number): Uint8Array | null {
    // RFC 7748 §5: the top bit of u is masked; a u >= p is rejected rather than reduced, as
    // libsignal's verify and the spec's "u >= p → false" do.
    const u = bytesToNumberLE(curvePublic) & ((1n << 255n) - 1n);
    if (u >= Fp.ORDER || u === Fp.ORDER - 1n) return null;
    const y = Fp.div(Fp.sub(u, 1n), Fp.add(u, 1n));
    const bytes = numberToBytesLE(y, KEY_LENGTH);
    bytes[31] |= signBit << 7;
    return bytes;
}

/**
 * xeddsa_sign (§2.5) with a Curve25519 private key. `random` is 64 bytes of fresh secure
 * randomness per signature (§2.5 Z); reusing it is safe, the signature is then deterministic, but
 * the spec asks for fresh bytes to resist fault and side-channel attacks.
 */
export function xeddsaSign(curvePrivate: Uint8Array, message: Uint8Array, random: Uint8Array): Uint8Array {
    assertLength('curvePrivate', curvePrivate, KEY_LENGTH);
    assertLength('random', random, RANDOM_LENGTH);
    const { A, a } = calculateKeyPair(curvePrivate);
    const r = hashToScalar(concat(HASH1_PREFIX, numberToBytesLE(a, KEY_LENGTH), message, random));
    const R = Point.BASE.multiply(r).toBytes();
    const h = hashToScalar(concat(R, A, message));
    const s = (r + h * a) % L;
    return concat(R, numberToBytesLE(s, KEY_LENGTH));
}

/**
 * xeddsa_verify (§2.6) against a Curve25519 public key. Bit 7 of the last signature byte selects
 * the Edwards sign bit (libsignal's convention; 0 in a spec signature). Never throws for a
 * malformed key or signature — it returns false.
 */
export function xeddsaVerify(curvePublic: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    if (!(curvePublic instanceof Uint8Array) || curvePublic.length !== KEY_LENGTH) return false;
    if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LENGTH) return false;

    const Abytes = montgomeryToEdwards(curvePublic, signature[63] >> 7);
    if (!Abytes) return false;

    const Rbytes = signature.subarray(0, 32);
    const sBytes = new Uint8Array(signature.subarray(32));
    sBytes[31] &= 0x7f;
    // s >= 2^253 can never be < L; libsignal rejects it the same way before the reduction check.
    if (sBytes[31] & 0xe0) return false;
    const s = bytesToNumberLE(sBytes);
    if (s >= L) return false;

    let A: InstanceType<typeof Point>;
    try {
        A = Point.fromBytes(Abytes);
    } catch {
        return false;
    }
    // Stricter than §2.6: anyone can forge for a small-order key, so it never verifies.
    if (A.isSmallOrder()) return false;

    const h = hashToScalar(concat(Rbytes, Abytes, message));
    const Rcheck = Point.BASE.multiplyUnsafe(s).subtract(A.multiplyUnsafe(h));
    // Comparing encodings also rejects a non-canonical R (§2.6: R.y >= 2^|p|).
    return equalBytes(Rcheck.toBytes(), Rbytes);
}
