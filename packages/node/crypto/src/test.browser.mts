// Browser-target test suite for @gjsify/crypto.
// Exercises the WebCrypto-backed + pure-BigInt browser implementations that
// ship in `src/browser.ts` / `src/browser/*`. Imports the browser entry
// directly (these APIs are module exports, not globals).

import { run, describe, it, expect } from '@gjsify/unit';
import { Buffer } from 'node:buffer';

import { createECDH, getCurves, pbkdf2, hkdf } from './browser.js';

run({
    async CryptoBrowserTest() {
        await describe('getCurves (browser)', async () => {
            await it('returns the supported curve names', async () => {
                const curves = getCurves();
                expect(Array.isArray(curves)).toBe(true);
                expect(curves).toContain('secp256k1');
                expect(curves).toContain('prime256v1');
                expect(curves).toContain('secp384r1');
                expect(curves).toContain('secp521r1');
            });
        });

        await describe('createECDH (browser, pure-BigInt)', async () => {
            await it('generates an uncompressed secp256k1 public key', async () => {
                const ecdh = createECDH('secp256k1');
                const pub = ecdh.generateKeys() as Buffer;
                expect(Buffer.isBuffer(pub)).toBe(true);
                // 0x04 || 32-byte X || 32-byte Y = 65 bytes
                expect(pub.length).toBe(65);
                expect(pub[0]).toBe(0x04);
            });

            await it('derives a matching shared secret on prime256v1', async () => {
                const alice = createECDH('prime256v1');
                alice.generateKeys();
                const bob = createECDH('prime256v1');
                bob.generateKeys();

                const aliceSecret = alice.computeSecret(bob.getPublicKey()) as Buffer;
                const bobSecret = bob.computeSecret(alice.getPublicKey()) as Buffer;

                expect(aliceSecret.toString('hex')).toBe(bobSecret.toString('hex'));
                expect(aliceSecret.length).toBe(32);
            });

            await it('round-trips a known private key (set → derive public)', async () => {
                // Deterministic vector: derive the public key from a fixed scalar
                // and verify the shared secret with a fresh peer matches both ways.
                const fixed = createECDH('prime256v1');
                fixed.setPrivateKey(Buffer.from('11'.repeat(32), 'hex'));
                const peer = createECDH('prime256v1');
                peer.generateKeys();

                const s1 = fixed.computeSecret(peer.getPublicKey()) as Buffer;
                const s2 = peer.computeSecret(fixed.getPublicKey()) as Buffer;
                expect(s1.toString('hex')).toBe(s2.toString('hex'));
            });

            await it('supports the compressed public-key format', async () => {
                const ecdh = createECDH('secp256k1');
                ecdh.generateKeys();
                const compressed = ecdh.getPublicKey(null, 'compressed') as Buffer;
                expect(compressed.length).toBe(33);
                expect(compressed[0] === 0x02 || compressed[0] === 0x03).toBe(true);
            });

            await it('throws for an unknown curve', async () => {
                expect(() => createECDH('nonexistent-curve')).toThrow();
            });
        });

        await describe('pbkdf2 (browser, WebCrypto deriveBits)', async () => {
            await it('matches the RFC 6070 PBKDF2-HMAC-SHA1 vector', async () => {
                await new Promise<void>((resolve, reject) => {
                    pbkdf2('password', 'salt', 1, 20, 'sha1', (err, key) => {
                        try {
                            expect(err).toBeNull();
                            expect(key.length).toBe(20);
                            expect(key.toString('hex')).toBe('0c60c80f961f0e71f3a9b524af6012062fe037a6');
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            });
        });

        await describe('hkdf (browser, WebCrypto deriveBits)', async () => {
            await it('matches the RFC 5869 HKDF-SHA256 test case 1', async () => {
                // RFC 5869 A.1: IKM = 0x0b*22, salt = 0x000102...0c, info = 0xf0f1...f9, L = 42
                const ikm = Buffer.from('0b'.repeat(22), 'hex');
                const salt = Buffer.from('000102030405060708090a0b0c', 'hex');
                const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
                const expected =
                    '3cb25f25faacd57a90434f64d0362f2a' + '2d2d0a90cf1a5a4c5db02d56ecc4c5bf' + '34007208d5b887185865';
                await new Promise<void>((resolve, reject) => {
                    hkdf('sha256', ikm, salt, info, 42, (err, derived) => {
                        try {
                            expect(err).toBeNull();
                            expect(Buffer.from(derived).toString('hex')).toBe(expected);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            });
        });
    },
});
