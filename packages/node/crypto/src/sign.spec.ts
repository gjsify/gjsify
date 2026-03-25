// Ported from refs/node-test/parallel/test-crypto-sign-verify.js
// Original: MIT license, Copyright (c) Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { createSign, createVerify, publicEncrypt, privateDecrypt } from 'node:crypto';
import { Buffer } from 'node:buffer';

// 2048-bit RSA key pair in PKCS#8/SPKI format for cross-platform compatibility
const RSA_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDVJethEusbgt7c
sPDaTGP+gKEdQhCSVM3Lyc4RSD1gfxLjU14zONlAeR1szp5PEWUQ2SCBykAcDa4t
wy/pYCx1TXoHozLb9XKPqMKEBgWWiXh0d1Lwl2RYZViw+veBlTc3yc60Bmv5vb75
S203jBAu5NbBlPbiMtiCffYXsppTVqyaDYuPUTZCga/mJUgPFupi/e5yyqqpYo44
JyCSskGJ/0c7+cvsQaaF5zlbB4SJY5oFqaDAQIpY/I26mU8+fUY8CiDA3WFc+EzD
2d7mFyhp9J83hVFBRP+LGx+MQ+ZHQanWECNHfe3+K08tlU88cnCGzZuX1gPPFDdH
G6ugIelxAgMBAAECggEAYx8QOAOBPDj/BOhwCUSPF9KfmiiX5kTzszp0zwqmKFLP
6NFjNDTSqy3npirr6d8v/cbLXDA+4gzmnDdx93iXFDHkdtrJEwswrGgRlS3ruVbS
om6/Lk1pB8aRmTQMl8FZfWMm8gcufWRlBC+0aamD+RrIWBu7N/PnRb/oCpsvM2N4
+ZYxT3OJ21egUEF5WecVf5IyXJM8MWhfugtDnh24XtJAktXMNW4oQoBXyjgopTv6
Gcx+vkbpDkPSWWGpI8ztt4CB2U17eWAGx6S72DECkJurmBpJW59cerAKYMpcsrwY
eZ0NSNb1MGBe/Q3EFIg71ll7kjlKRQf1qbWEdhEA5QKBgQDrvxiqgB3Rfrn/1ma4
F0iY4CiguUVdEK9OiDmfkWlIzvhpxiQJOBOoPzb+3taUmnAdaB2UYyHk5d4yBm46
zGAQjVYagWN2jDy0E2QmQWDioT7gLXCQvHVDYXVt9u+L9orimOGoKF3ph6lxKtT4
C/elC9sulWEwITIjwvwuK6lR8wKBgQDndc4W/1Frk/bluonw6kDhLOOmp7D+B0Uk
tCCx7BB6oOpCsZRZ47X/JOhnWh0bQ7mPIWKMgRcox1pCoPU5efvvD9hCEqCGRW9i
S4yMOdwS2doXI12KZlkLmVWvbQ4EcYzpeprOKaXgQ/YMxMvwhlkTNZ71OQw0GPp0
eBfPrOwMCwKBgDLVvkfl4IgwP4N/hB7mRm1QyPH/gYmT83mHvoU+IenlV4PXiiXC
xdpd50oGW1coBk0RCm/ZAJIPT16SLGrZb02ibJLCm+QQUXazR8FID9BO3PQSWFed
i9u/xEa2HOmdfE1okiBks/uLmWohxlLGodwhNl5RL+flAJ7diOub1qMpAoGBAMn8
3GTlWsBu17+TEl3Tj9rxuZjuLl8BKS3mo8GhKKBbXRPmtHfdaC3In6fR1CS+7Wgi
0kWbQgKsNfB/VoFaGql9QlQmvT9vyMwW8ghNVeh9hP08N51Xw82Demsk2F64WShH
fmD7p24W4Nozw2WbWJCS8q09o5CzW53YT69EUJoRAoGAQ8IoK50pzLpWD5HBHpqU
/El/jaozqwctQAv5nREqG9BBHaRcCpKfPAfINF31Xy1CssYe8W8xPNkZyrNPYVC/
Yi7MeKZhG0BYTXq8CW0O1x8P2fA2KfxmvCPIEKn1QudJw4gAbDpnsKJD14hQtGYb
CJbXIFhqfWsYSVJJwIK9uL4=
-----END PRIVATE KEY-----`;

const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1SXrYRLrG4Le3LDw2kxj
/oChHUIQklTNy8nOEUg9YH8S41NeMzjZQHkdbM6eTxFlENkggcpAHA2uLcMv6WAs
dU16B6My2/Vyj6jChAYFlol4dHdS8JdkWGVYsPr3gZU3N8nOtAZr+b2++UttN4wQ
LuTWwZT24jLYgn32F7KaU1asmg2Lj1E2QoGv5iVIDxbqYv3ucsqqqWKOOCcgkrJB
if9HO/nL7EGmhec5WweEiWOaBamgwECKWPyNuplPPn1GPAogwN1hXPhMw9ne5hco
afSfN4VRQUT/ixsfjEPmR0Gp1hAjR33t/itPLZVPPHJwhs2bl9YDzxQ3RxuroCHp
cQIDAQAB
-----END PUBLIC KEY-----`;

export default async () => {

  await describe('crypto.createSign', async () => {
    await it('should be a function', async () => {
      expect(typeof createSign).toBe('function');
    });

    await it('should create a Sign instance', async () => {
      const sign = createSign('SHA256');
      expect(sign).toBeDefined();
      expect(typeof sign.update).toBe('function');
      expect(typeof sign.sign).toBe('function');
    });

    await it('should sign data with RSA-SHA256', async () => {
      const sign = createSign('SHA256');
      sign.update('Hello, World!');
      const signature = sign.sign(RSA_PRIVATE_KEY);
      expect(Buffer.isBuffer(signature)).toBe(true);
      expect(signature.length).toBeGreaterThan(0);
    });

    await it('should produce different signatures for different data', async () => {
      const sign1 = createSign('SHA256');
      sign1.update('data1');
      const sig1 = sign1.sign(RSA_PRIVATE_KEY);

      const sign2 = createSign('SHA256');
      sign2.update('data2');
      const sig2 = sign2.sign(RSA_PRIVATE_KEY);

      expect(sig1.toString('hex')).not.toBe(sig2.toString('hex'));
    });
  });

  await describe('crypto.createVerify', async () => {
    await it('should be a function', async () => {
      expect(typeof createVerify).toBe('function');
    });

    await it('should verify a valid signature', async () => {
      const data = 'test data for signing';

      const sign = createSign('SHA256');
      sign.update(data);
      const signature = sign.sign(RSA_PRIVATE_KEY);

      const verify = createVerify('SHA256');
      verify.update(data);
      const isValid = verify.verify(RSA_PUBLIC_KEY, signature);
      expect(isValid).toBe(true);
    });

    await it('should reject invalid signature', async () => {
      const sign = createSign('SHA256');
      sign.update('original data');
      const signature = sign.sign(RSA_PRIVATE_KEY);

      const verify = createVerify('SHA256');
      verify.update('tampered data');
      const isValid = verify.verify(RSA_PUBLIC_KEY, signature);
      expect(isValid).toBe(false);
    });

    await it('should support multiple update calls', async () => {
      const sign = createSign('SHA256');
      sign.update('part1');
      sign.update('part2');
      const signature = sign.sign(RSA_PRIVATE_KEY);

      const verify = createVerify('SHA256');
      verify.update('part1');
      verify.update('part2');
      expect(verify.verify(RSA_PUBLIC_KEY, signature)).toBe(true);
    });

    await it('should support hex encoding for signature', async () => {
      const sign = createSign('SHA256');
      sign.update('test');
      const sigHex = sign.sign(RSA_PRIVATE_KEY, 'hex');
      expect(typeof sigHex).toBe('string');

      const verify = createVerify('SHA256');
      verify.update('test');
      expect(verify.verify(RSA_PUBLIC_KEY, sigHex, 'hex')).toBe(true);
    });
  });

  await describe('crypto.publicEncrypt / privateDecrypt', async () => {
    await it('should be functions', async () => {
      expect(typeof publicEncrypt).toBe('function');
      expect(typeof privateDecrypt).toBe('function');
    });

    await it('should encrypt and decrypt round-trip', async () => {
      const plaintext = Buffer.from('secret message');
      const encrypted = publicEncrypt(RSA_PUBLIC_KEY, plaintext);
      expect(Buffer.isBuffer(encrypted)).toBe(true);
      expect(encrypted.length).toBeGreaterThan(0);

      const decrypted = privateDecrypt(RSA_PRIVATE_KEY, encrypted);
      expect(decrypted.toString()).toBe('secret message');
    });

    await it('should produce different ciphertext each time (PKCS#1 random padding)', async () => {
      const plaintext = Buffer.from('test');
      const enc1 = publicEncrypt(RSA_PUBLIC_KEY, plaintext);
      const enc2 = publicEncrypt(RSA_PUBLIC_KEY, plaintext);
      // Due to random padding, ciphertexts should differ
      expect(enc1.toString('hex')).not.toBe(enc2.toString('hex'));
    });
  });
};
