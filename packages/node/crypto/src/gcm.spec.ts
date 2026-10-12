// Tests for AES-GCM cipher mode
// Reference: NIST SP 800-38D test vectors

import { describe, it, expect } from '@gjsify/unit';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { Buffer } from 'node:buffer';

export default async () => {
    await describe('AES-GCM', async () => {
        await it('should support aes-256-gcm algorithm', async () => {
            const key = Buffer.alloc(32, 'a');
            const iv = Buffer.alloc(12, 'b');
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            expect(cipher).toBeDefined();
        });

        await it('should support aes-128-gcm algorithm', async () => {
            const key = Buffer.alloc(16, 'a');
            const iv = Buffer.alloc(12, 'b');
            const cipher = createCipheriv('aes-128-gcm', key, iv);
            expect(cipher).toBeDefined();
        });

        await it('should encrypt and decrypt round-trip', async () => {
            const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
            const iv = Buffer.alloc(12, 0);
            const plaintext = 'Hello, AES-GCM!';

            // Encrypt
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            let encrypted = cipher.update(plaintext, 'utf8');
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const tag = cipher.getAuthTag();
            expect(tag).toBeDefined();
            expect(tag.length).toBe(16);

            // Decrypt
            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            expect(decrypted.toString('utf8')).toBe(plaintext);
        });

        await it('should fail with wrong auth tag', async () => {
            const key = Buffer.alloc(32, 'k');
            const iv = Buffer.alloc(12, 'i');
            const plaintext = 'secret data';

            const cipher = createCipheriv('aes-256-gcm', key, iv);
            let encrypted = cipher.update(plaintext, 'utf8');
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const tag = cipher.getAuthTag();

            // Tamper with the tag
            const badTag = Buffer.from(tag);
            badTag[0] ^= 0xff;

            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(badTag);
            decipher.update(encrypted);
            expect(() => decipher.final()).toThrow();
        });

        await it('should support AAD (additional authenticated data)', async () => {
            const key = Buffer.alloc(32, 'k');
            const iv = Buffer.alloc(12, 'i');
            const plaintext = 'encrypted part';
            const aad = Buffer.from('authenticated but not encrypted');

            // Encrypt with AAD
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(aad);
            let encrypted = cipher.update(plaintext, 'utf8');
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const tag = cipher.getAuthTag();

            // Decrypt with same AAD
            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            decipher.setAAD(aad);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            expect(decrypted.toString('utf8')).toBe(plaintext);
        });

        await it('should fail with wrong AAD', async () => {
            const key = Buffer.alloc(32, 'k');
            const iv = Buffer.alloc(12, 'i');
            const plaintext = 'test';
            const aad = Buffer.from('original AAD');

            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(aad);
            let encrypted = cipher.update(plaintext, 'utf8');
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const tag = cipher.getAuthTag();

            // Decrypt with different AAD
            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            decipher.setAAD(Buffer.from('tampered AAD'));
            decipher.update(encrypted);
            expect(() => decipher.final()).toThrow();
        });

        await it('should handle empty plaintext', async () => {
            const key = Buffer.alloc(32, 'k');
            const iv = Buffer.alloc(12, 'i');

            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const encrypted = cipher.final();
            const tag = cipher.getAuthTag();

            expect(encrypted.length).toBe(0);
            expect(tag.length).toBe(16);

            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            const decrypted = decipher.final();
            expect(decrypted.length).toBe(0);
        });

        await it('should produce different ciphertext for different IVs', async () => {
            const key = Buffer.alloc(32, 'k');
            const plaintext = 'same data';

            const cipher1 = createCipheriv('aes-256-gcm', key, Buffer.alloc(12, 1));
            let enc1 = cipher1.update(plaintext, 'utf8');
            enc1 = Buffer.concat([enc1, cipher1.final()]);

            const cipher2 = createCipheriv('aes-256-gcm', key, Buffer.alloc(12, 2));
            let enc2 = cipher2.update(plaintext, 'utf8');
            enc2 = Buffer.concat([enc2, cipher2.final()]);

            expect(enc1.toString('hex')).not.toBe(enc2.toString('hex'));
        });

        await it('should carry the block counter past 255 (ciphertext beyond 4064 bytes)', async () => {
            // Known answer computed with Node's OpenSSL. Block 254 uses counter 256, which needs
            // a carry from the last counter byte into the one before it.
            const key = Buffer.alloc(32, 7);
            const iv = Buffer.alloc(12, 1);
            const plaintext = Buffer.from(Array.from({ length: 4300 }, (_, i) => i % 251));
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            expect(ciphertext.subarray(4056, 4088).toString('hex')).toBe(
                '0f653b51025b57e8221041114cfc82638ce3e16ac74f4e5a3b89330f79a0c3cd',
            );
            expect(cipher.getAuthTag().toString('hex')).toBe('db8820f968fc16628f4b13db40e04219');
        });

        // IVs other than 96 bits derive J0 = GHASH_H(IV || pad || 0^64 || [len(IV)]_64)
        // (NIST SP 800-38D §7.1). OMEMO (XEP-0384) uses 16-byte IVs.
        const nistKey = Buffer.from('feffe9928665731c6d6a8f9467308308', 'hex');
        const nistPlaintext = Buffer.from(
            'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
                '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
            'hex',
        );
        const nistAad = Buffer.from('feedfacedeadbeeffeedfacedeadbeefabaddad2', 'hex');

        await it('should accept a 64-bit IV (NIST SP 800-38D test case 5)', async () => {
            const iv = Buffer.from('cafebabefacedbad', 'hex');
            const cipher = createCipheriv('aes-128-gcm', nistKey, iv);
            cipher.setAAD(nistAad);
            const ciphertext = Buffer.concat([cipher.update(nistPlaintext), cipher.final()]);
            expect(ciphertext.toString('hex')).toBe(
                '61353b4c2806934a777ff51fa22a4755699b2a714fcdc6f83766e5f97b6c7423' +
                    '73806900e49f24b22b097544d4896b424989b5e1ebac0f07c23f4598',
            );
            expect(cipher.getAuthTag().toString('hex')).toBe('3612d2e79e3b0785561be14aaca2fccb');
        });

        await it('should accept a 128-bit IV and round-trip it', async () => {
            // Known answer computed with Node's OpenSSL.
            const iv = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
            const cipher = createCipheriv('aes-128-gcm', nistKey, iv);
            cipher.setAAD(nistAad);
            const ciphertext = Buffer.concat([cipher.update(nistPlaintext), cipher.final()]);
            const tag = cipher.getAuthTag();
            expect(ciphertext.toString('hex')).toBe(
                '9333269f7190747c0c40f4e68b264bccb425eb7f01668da81e32f7c519b37524' +
                    '9297ea2dc3f88c3a2b1c70373831df37959db053642fb009a4710555',
            );
            expect(tag.toString('hex')).toBe('e2982c8b98fdd5eaa7d9f52990d8978b');

            const decipher = createDecipheriv('aes-128-gcm', nistKey, iv);
            decipher.setAAD(nistAad);
            decipher.setAuthTag(tag);
            const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            expect(plaintext.toString('hex')).toBe(nistPlaintext.toString('hex'));
        });
    });
};
