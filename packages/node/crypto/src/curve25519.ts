// Curve25519 primitives — Ed25519 (RFC 8032) and X25519 (RFC 7748).
//
// The field and group arithmetic comes from @noble/curves (audited, MIT —
// Copyright (c) 2022 Paul Miller, https://paulmillr.com): its scalar
// multiplications are written to avoid secret-dependent branches (Montgomery
// ladder with arithmetic cswap for X25519, fixed-window base multiplication
// for Ed25519 signing). BigInt arithmetic cannot promise constant time on any
// JS engine; this is the closest a pure-JS path gets, and the reason the math
// is not hand-rolled here.
//
// What IS written here is the verification rule, because it is where
// @noble/curves and OpenSSL (what Node exposes) disagree: noble checks the
// cofactored equation [8][S]B = [8]R + [8][k]A, OpenSSL the cofactorless
// encode([S]B - [k]A) == R. A signature built with a small-order component
// verifies under one and not the other, and the WebCrypto spec (§ Ed25519
// verify) additionally demands that small-order A or R return false. Both are
// pinned by the WPT small-order vectors in the specs, run on Node and GJS.

import { ed25519, ed25519ctx, x25519 } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { fillRandomBytes, isSecureRandomSource, type RandomSource } from '@gjsify/webcrypto/random';
import { codedError } from './crypto-utils.js';

export type OkpCurve = 'ed25519' | 'x25519';

export const OKP_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

const Point = ed25519.Point;
const L = Point.Fn.ORDER;

/**
 * RFC 7748 § 5 clamping. OpenSSL clamps the stored X25519 private key at
 * generation, so a generated key exports the same bytes Node's would.
 */
function clampX25519(k: Uint8Array): Uint8Array {
    k[0] &= 248;
    k[31] &= 127;
    k[31] |= 64;
    return k;
}

/**
 * A fresh private key: the Ed25519 seed, or the (clamped) X25519 scalar.
 *
 * Long-term keys refuse the non-cryptographic tail of the entropy chain
 * (GLib.Random, Math.random) that `randomBytes` falls back to with only a
 * warning: a key from those is guessable, and nothing downstream could tell.
 * `fill` is the seam the spec uses to exercise that refusal.
 */
export function generateOkpPrivateKey(
    curve: OkpCurve,
    fill: (view: Uint8Array) => RandomSource = fillRandomBytes,
): Uint8Array {
    const k = new Uint8Array(OKP_KEY_BYTES);
    const source = fill(k);
    if (!isSecureRandomSource(source)) {
        k.fill(0);
        throw codedError(
            'ERR_CRYPTO_INSECURE_RANDOM',
            `Refusing to generate a ${curve} key: no cryptographically secure random source ` +
                `(got "${source}"; expected WebCrypto or /dev/urandom)`,
        );
    }
    return curve === 'x25519' ? clampX25519(k) : k;
}

export function okpPublicFromPrivate(curve: OkpCurve, priv: Uint8Array): Uint8Array {
    return curve === 'ed25519' ? ed25519.getPublicKey(priv) : x25519.getPublicKey(priv);
}

/** Ed25519 (empty context) or Ed25519ctx (non-empty context), RFC 8032 § 5.1.6. */
export function ed25519Sign(seed: Uint8Array, message: Uint8Array, context?: Uint8Array): Uint8Array {
    if (context && context.length > 0) return ed25519ctx.sign(message, seed, { context });
    return ed25519.sign(message, seed);
}

function dom2(context: Uint8Array | undefined): Uint8Array {
    if (!context || context.length === 0) return new Uint8Array(0);
    const prefix = new TextEncoder().encode('SigEd25519 no Ed25519 collisions');
    const out = new Uint8Array(prefix.length + 2 + context.length);
    out.set(prefix, 0);
    out[prefix.length] = 0; // phflag: 0 = not prehashed
    out[prefix.length + 1] = context.length;
    out.set(context, prefix.length + 2);
    return out;
}

function leToBigInt(bytes: Uint8Array): bigint {
    let n = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
    return n;
}

/**
 * RFC 8032 § 5.1.7 with the cofactorless equation (see file header), strict
 * point decoding, S < L, and small-order A / R rejected. Every input is
 * public, so the variable-time multiplications are fine here.
 */
export function ed25519Verify(
    pub: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array,
    context?: Uint8Array,
): boolean {
    if (pub.length !== OKP_KEY_BYTES || signature.length !== ED25519_SIGNATURE_BYTES) return false;
    if (context && context.length > 255) return false;
    const r = signature.subarray(0, 32);
    const s = leToBigInt(signature.subarray(32));
    if (s >= L) return false;

    let A: InstanceType<typeof Point>;
    let R: InstanceType<typeof Point>;
    try {
        A = Point.fromBytes(pub, false);
        R = Point.fromBytes(r, false);
    } catch {
        // fromBytes throws for a non-canonical or off-curve encoding — a
        // verification failure, not an error, in Node and in WebCrypto.
        return false;
    }
    if (A.isSmallOrder() || R.isSmallOrder()) return false;

    const d = dom2(context);
    const h = new Uint8Array(d.length + 64 + message.length);
    h.set(d, 0);
    h.set(r, d.length);
    h.set(pub, d.length + 32);
    h.set(message, d.length + 64);
    const k = leToBigInt(sha512(h)) % L;

    const check = Point.BASE.multiplyUnsafe(s).subtract(A.multiplyUnsafe(k)).toBytes();
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= check[i] ^ r[i];
    return diff === 0;
}

/**
 * X25519 shared secret. Throws for a low-order peer key, the inputs that
 * yield the all-zero secret RFC 7748 § 6.1 tells implementations to reject —
 * @noble/curves rejects them BEFORE running the ladder on the private scalar.
 */
export function x25519SharedSecret(priv: Uint8Array, peerPub: Uint8Array): Uint8Array {
    return x25519.getSharedSecret(priv, peerPub);
}
