// Test vectors:
//   - libsignal-protocol-c, src/curve25519/ed25519/tests/internal_fast_tests.c `xeddsa_fast_test`
//     (spec-conformant signer: sign bit 0)
//     https://github.com/signalapp/libsignal-protocol-c
//   - libsignal (Rust), rust/core/src/curve/curve25519.rs `test_signature` (sign bit carried in
//     the signature's top bit) https://github.com/signalapp/libsignal
//   - RFC 7748 §6.1 (X25519 Alice key pair), RFC 8032 §7.1 TEST 1 (Ed25519 key pair); the
//     Montgomery form of TEST 1's key was computed with Node's OpenSSL X25519 from the clamped
//     SHA-512(seed) scalar.

import { describe, it, expect } from '@gjsify/unit';

import { curveToEdPrivate, curveToEdPublic, edToCurvePublic, xeddsaSign, xeddsaVerify } from './index.js';

const fromHex = (hex: string): Uint8Array => new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// RFC 7748 §6.1
const alicePrivate = fromHex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
const alicePublic = fromHex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');

export default async () => {
    await describe('XEdDSA: libsignal-protocol-c vector', async () => {
        const privateKey = new Uint8Array(32);
        privateKey[8] = 189;
        const message = new Uint8Array(200);
        const random = new Uint8Array(64);
        const expected =
            '11c7f3e6c4df9e8a5150e1db3b30f92de3a3b3aa438656545fa7390f4bcc7bb2' +
            '6c431d9e90643e4f0eaa0e9c557766fa69ada576d63dcaf2ac326c11d0b97702';

        await it('signs to the published signature', async () => {
            expect(toHex(xeddsaSign(privateKey, message, random))).toBe(expected);
        });

        await it('verifies it with the matching Curve25519 public key', async () => {
            const { publicKey } = curveToEdPrivate(privateKey);
            expect(xeddsaVerify(edToCurvePublic(publicKey), message, fromHex(expected))).toBe(true);
        });

        await it('rejects a flipped bit and an all-0xFF public key', async () => {
            const publicKey = edToCurvePublic(curveToEdPrivate(privateKey).publicKey);
            const bad = fromHex(expected);
            bad[0] ^= 1;
            expect(xeddsaVerify(publicKey, message, bad)).toBe(false);
            expect(xeddsaVerify(new Uint8Array(32).fill(0xff), message, fromHex(expected))).toBe(false);
        });
    });

    await describe('XEdDSA: libsignal (Rust) vector', async () => {
        const publicKey = fromHex('ab7e717d4a163b7d9a1d8071dfe9dcf8cdcd1cea3339b6356be84d887e322c64');
        const message = fromHex('05edce9d9c415ca78cb7252e72c2c4a554d3eb29485a0e1d503118d1a82d99fb4a');
        const signature = fromHex(
            '5de88ca9a89b4a115da79109c67c9c7464a3e4180274f1cb8c63c2984e286dfb' +
                'ede82deb9dcd9fae0bfbb821569b3d9001bd8130cd11d486cef047bd60b86e88',
        );

        await it('verifies a signature carrying the sign bit in byte 63', async () => {
            expect(xeddsaVerify(publicKey, message, signature)).toBe(true);
        });

        await it('rejects every single-bit flip of it', async () => {
            for (let i = 0; i < signature.length; i++) {
                const copy = new Uint8Array(signature);
                copy[i] ^= 1;
                expect(xeddsaVerify(publicKey, message, copy)).toBe(false);
            }
        });
    });

    await describe('XEdDSA: round trips', async () => {
        await it('verifies its own signatures for random keys and messages', async () => {
            for (let i = 0; i < 32; i++) {
                const privateKey = crypto.getRandomValues(new Uint8Array(32));
                const message = crypto.getRandomValues(new Uint8Array(i * 7));
                const signature = xeddsaSign(privateKey, message, crypto.getRandomValues(new Uint8Array(64)));
                expect(signature[63] & 0x80).toBe(0);
                const publicKey = edToCurvePublic(curveToEdPrivate(privateKey).publicKey);
                expect(xeddsaVerify(publicKey, message, signature)).toBe(true);
            }
        });

        await it('returns false for malformed input instead of throwing', async () => {
            expect(xeddsaVerify(new Uint8Array(31), new Uint8Array(0), new Uint8Array(64))).toBe(false);
            expect(xeddsaVerify(alicePublic, new Uint8Array(0), new Uint8Array(63))).toBe(false);
            expect(xeddsaVerify(alicePublic, new Uint8Array(0), new Uint8Array(64))).toBe(false);
        });

        await it('rejects a wrong-length random', async () => {
            expect(() => xeddsaSign(alicePrivate, new Uint8Array(0), new Uint8Array(32))).toThrow();
        });
    });

    await describe('Curve25519 ⇄ Ed25519 key mapping', async () => {
        await it('maps the RFC 7748 Alice key pair consistently', async () => {
            const { publicKey } = curveToEdPrivate(alicePrivate);
            expect(publicKey[31] & 0x80).toBe(0);
            expect(toHex(curveToEdPublic(alicePublic))).toBe(toHex(publicKey));
            expect(toHex(edToCurvePublic(publicKey))).toBe(toHex(alicePublic));
        });

        await it('maps the RFC 8032 TEST 1 public key to its X25519 form', async () => {
            const edPublic = fromHex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
            const curvePublic = 'd85e07ec22b0ad881537c2f44d662d1a143cf830c57aca4305d85c7a90f6b62e';
            expect(toHex(edToCurvePublic(edPublic))).toBe(curvePublic);
            expect(toHex(curveToEdPublic(fromHex(curvePublic)))).toBe(toHex(edPublic));
            // u carries no sign; signBit 1 selects the negated point, which differs only in bit 255.
            const negated = curveToEdPublic(fromHex(curvePublic), 1);
            expect(negated[31]).toBe(edPublic[31] | 0x80);
            expect(toHex(edToCurvePublic(negated))).toBe(curvePublic);
        });

        await it('rejects u = p - 1, which has no Edwards point', async () => {
            const minusOne = new Uint8Array(32).fill(0xff);
            minusOne[0] = 0xec;
            minusOne[31] = 0x7f;
            expect(() => curveToEdPublic(minusOne)).toThrow();
        });
    });
};
