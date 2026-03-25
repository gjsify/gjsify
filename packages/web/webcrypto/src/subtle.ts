// W3C SubtleCrypto for GJS
// Reference: refs/deno/ext/crypto/00_crypto.js
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Reimplemented for GJS using @gjsify/crypto primitives.

import {
  CryptoKey,
  type CryptoKeyPair,
  type KeyUsage,
  type KeyAlgorithm,
  type AlgorithmIdentifier,
  type AesKeyGenParams,
  type HmacKeyGenParams,
  type EcKeyGenParams,
  type HmacImportParams,
  type EcKeyImportParams,
  type AesCbcParams,
  type AesCtrParams,
  type AesGcmParams,
  type RsaOaepParams,
  type EcdsaParams,
  type RsaPssParams,
  type Pbkdf2Params,
  type HkdfParams,
  type EcdhKeyDeriveParams,
  type AesKeyAlgorithm,
  type HmacKeyAlgorithm,
  type EcKeyAlgorithm,
  type RsaHashedKeyAlgorithm,
  type EcKeyPairHandle,
  type RsaPemHandle,
  type HashLike,
  type HmacLike,
  type CipherLike,
  type DecipherLike,
  type SignerLike,
  type VerifierLike,
  type EcdhLike,
} from './crypto-key.js';
import {
  normalizeAlgorithm,
  toNodeHashName,
  toNodeCurveName,
  hashSize,
  validateUsages,
  checkUsage,
  base64urlEncode,
  base64urlDecode,
  toUint8Array,
} from './util.js';

// Lazy-loaded crypto imports to avoid circular deps during bundling
let _cryptoLoaded = false;
let _createHash: (alg: string) => HashLike;
let _createHmac: (alg: string, key: Uint8Array) => HmacLike;
let _createCipheriv: (alg: string, key: Uint8Array, iv: Uint8Array) => CipherLike;
let _createDecipheriv: (alg: string, key: Uint8Array, iv: Uint8Array) => DecipherLike;
let _createSign: (alg: string) => SignerLike;
let _createVerify: (alg: string) => VerifierLike;
let _pbkdf2Sync: (pass: Uint8Array, salt: Uint8Array, iter: number, keylen: number, digest: string) => Uint8Array;
let _hkdfSync: (digest: string, ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, keylen: number) => ArrayBuffer;
let _createECDH: (curve: string) => EcdhLike;
let _randomBytes: (size: number) => Uint8Array;
let _publicEncrypt: (key: unknown, buffer: Uint8Array) => Uint8Array;
let _privateDecrypt: (key: unknown, buffer: Uint8Array) => Uint8Array;
let _createPublicKey: (key: unknown) => unknown;
let _createPrivateKey: (key: unknown) => unknown;
let _ecdsaSign: (hashAlgo: string, privKeyBytes: Uint8Array, data: Uint8Array, curveName: string) => Uint8Array;
let _ecdsaVerify: (hashAlgo: string, pubKeyBytes: Uint8Array, signature: Uint8Array, data: Uint8Array, curveName: string) => boolean;
let _rsaPssSign: (hashAlgo: string, privKeyPem: string, data: Uint8Array, saltLength: number) => Uint8Array;
let _rsaPssVerify: (hashAlgo: string, pubKeyPem: string, signature: Uint8Array, data: Uint8Array, saltLength: number) => boolean;
let _rsaOaepEncrypt: (hashAlgo: string, pubKeyPem: string, plaintext: Uint8Array, label?: Uint8Array) => Uint8Array;
let _rsaOaepDecrypt: (hashAlgo: string, privKeyPem: string, ciphertext: Uint8Array, label?: Uint8Array) => Uint8Array;

async function loadCrypto(): Promise<void> {
  if (_cryptoLoaded) return;
  const crypto = await import('crypto') as Record<string, unknown>;
  _createHash = crypto.createHash as typeof _createHash;
  _createHmac = crypto.createHmac as typeof _createHmac;
  _createCipheriv = crypto.createCipheriv as typeof _createCipheriv;
  _createDecipheriv = crypto.createDecipheriv as typeof _createDecipheriv;
  _createSign = crypto.createSign as typeof _createSign;
  _createVerify = crypto.createVerify as typeof _createVerify;
  _pbkdf2Sync = crypto.pbkdf2Sync as typeof _pbkdf2Sync;
  _hkdfSync = crypto.hkdfSync as typeof _hkdfSync;
  _createECDH = crypto.createECDH as typeof _createECDH;
  _randomBytes = crypto.randomBytes as typeof _randomBytes;
  _publicEncrypt = crypto.publicEncrypt as typeof _publicEncrypt;
  _privateDecrypt = crypto.privateDecrypt as typeof _privateDecrypt;
  _createPublicKey = crypto.createPublicKey as typeof _createPublicKey;
  _createPrivateKey = crypto.createPrivateKey as typeof _createPrivateKey;
  _ecdsaSign = crypto.ecdsaSign as typeof _ecdsaSign;
  _ecdsaVerify = crypto.ecdsaVerify as typeof _ecdsaVerify;
  _rsaPssSign = crypto.rsaPssSign as typeof _rsaPssSign;
  _rsaPssVerify = crypto.rsaPssVerify as typeof _rsaPssVerify;
  _rsaOaepEncrypt = crypto.rsaOaepEncrypt as typeof _rsaOaepEncrypt;
  _rsaOaepDecrypt = crypto.rsaOaepDecrypt as typeof _rsaOaepDecrypt;
  _cryptoLoaded = true;
}

// Eagerly start loading
const cryptoReady = loadCrypto();

function ensureCrypto(): void {
  if (!_cryptoLoaded) {
    throw new Error('crypto not yet loaded. Ensure module initialization is complete.');
  }
}

/**
 * SubtleCrypto provides cryptographic primitives per the W3C WebCrypto API.
 */
export class SubtleCrypto {

  // ==================== digest ====================

  async digest(
    algorithm: string | { name: string },
    data: BufferSource,
  ): Promise<ArrayBuffer> {
    await cryptoReady;
    const alg = normalizeAlgorithm(algorithm);
    const nodeName = toNodeHashName(alg.name);
    const bytes = toUint8Array(data);
    const hash = _createHash(nodeName);
    hash.update(bytes);
    const result = hash.digest();
    return (result.buffer as ArrayBuffer).slice(result.byteOffset, result.byteOffset + result.byteLength);
  }

  // ==================== generateKey ====================

  async generateKey(
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey | CryptoKeyPair> {
    await cryptoReady;
    const alg = normalizeAlgorithm(algorithm);
    const name = alg.name.toUpperCase();

    switch (name) {
      case 'AES-CBC':
      case 'AES-CTR':
      case 'AES-GCM': {
        const length = (algorithm as AesKeyGenParams).length;
        if (![128, 192, 256].includes(length)) {
          throw new DOMException(`Invalid AES key length: ${length}`, 'OperationError');
        }
        validateUsages(keyUsages, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
        const keyData = _randomBytes(length / 8);
        return new CryptoKey('secret', extractable, { name: alg.name, length }, keyUsages, new Uint8Array(keyData));
      }
      case 'HMAC': {
        const hmacParams = algorithm as HmacKeyGenParams;
        const hashAlg = normalizeAlgorithm(hmacParams.hash);
        const length = hmacParams.length || hashSize(hashAlg.name) * 8;
        validateUsages(keyUsages, ['sign', 'verify']);
        const keyData = _randomBytes(Math.ceil(length / 8));
        return new CryptoKey('secret', extractable, { name: 'HMAC', hash: { name: hashAlg.name }, length }, keyUsages, new Uint8Array(keyData));
      }
      case 'ECDH': {
        const namedCurve = (algorithm as EcKeyGenParams).namedCurve;
        const nodeCurve = toNodeCurveName(namedCurve);
        validateUsages(keyUsages, ['deriveKey', 'deriveBits']);
        const ecdh = _createECDH(nodeCurve);
        ecdh.generateKeys();
        const pubBytes = new Uint8Array(ecdh.getPublicKey());
        const privBytes = new Uint8Array(ecdh.getPrivateKey());
        const pubKey = new CryptoKey('public', true, { name: 'ECDH', namedCurve }, [], pubBytes);
        const privKey = new CryptoKey('private', extractable, { name: 'ECDH', namedCurve }, keyUsages, { pub: pubBytes, priv: privBytes } satisfies EcKeyPairHandle);
        return { publicKey: pubKey, privateKey: privKey } as CryptoKeyPair;
      }
      case 'ECDSA': {
        const namedCurve = (algorithm as EcKeyGenParams).namedCurve;
        const nodeCurve = toNodeCurveName(namedCurve);
        validateUsages(keyUsages, ['sign', 'verify']);
        const ecdh = _createECDH(nodeCurve);
        ecdh.generateKeys();
        const pubBytes = new Uint8Array(ecdh.getPublicKey());
        const privBytes = new Uint8Array(ecdh.getPrivateKey());
        const pubKey = new CryptoKey('public', true, { name: 'ECDSA', namedCurve }, ['verify'], pubBytes);
        const privKey = new CryptoKey('private', extractable, { name: 'ECDSA', namedCurve }, ['sign'], { pub: pubBytes, priv: privBytes } satisfies EcKeyPairHandle);
        return { publicKey: pubKey, privateKey: privKey } as CryptoKeyPair;
      }
      default:
        throw new DOMException(`Unsupported algorithm: ${alg.name}`, 'NotSupportedError');
    }
  }

  // ==================== importKey ====================

  async importKey(
    format: 'raw' | 'jwk' | 'pkcs8' | 'spki',
    keyData: BufferSource | JsonWebKey,
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> {
    await cryptoReady;
    const alg = normalizeAlgorithm(algorithm);
    const name = alg.name.toUpperCase();

    switch (name) {
      case 'AES-CBC':
      case 'AES-CTR':
      case 'AES-GCM': {
        if (format === 'raw') {
          const bytes = toUint8Array(keyData as BufferSource);
          if (![16, 24, 32].includes(bytes.length)) {
            throw new DOMException(`Invalid AES key length: ${bytes.length * 8}`, 'DataError');
          }
          validateUsages(keyUsages, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
          return new CryptoKey('secret', extractable, { name: alg.name, length: bytes.length * 8 }, keyUsages, new Uint8Array(bytes));
        }
        if (format === 'jwk') {
          const jwk = keyData as JsonWebKey;
          if (jwk.kty !== 'oct') throw new DOMException('JWK kty must be "oct"', 'DataError');
          const bytes = base64urlDecode(jwk.k!);
          if (![16, 24, 32].includes(bytes.length)) {
            throw new DOMException(`Invalid AES key length: ${bytes.length * 8}`, 'DataError');
          }
          validateUsages(keyUsages, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
          return new CryptoKey('secret', extractable, { name: alg.name, length: bytes.length * 8 }, keyUsages, bytes);
        }
        throw new DOMException(`Unsupported format: ${format}`, 'NotSupportedError');
      }
      case 'HMAC': {
        const hmacParams = algorithm as HmacImportParams;
        const hashAlg = normalizeAlgorithm(hmacParams.hash);
        if (format === 'raw') {
          const bytes = toUint8Array(keyData as BufferSource);
          validateUsages(keyUsages, ['sign', 'verify']);
          return new CryptoKey('secret', extractable, { name: 'HMAC', hash: { name: hashAlg.name }, length: bytes.length * 8 }, keyUsages, new Uint8Array(bytes));
        }
        if (format === 'jwk') {
          const jwk = keyData as JsonWebKey;
          if (jwk.kty !== 'oct') throw new DOMException('JWK kty must be "oct"', 'DataError');
          const bytes = base64urlDecode(jwk.k!);
          validateUsages(keyUsages, ['sign', 'verify']);
          return new CryptoKey('secret', extractable, { name: 'HMAC', hash: { name: hashAlg.name }, length: bytes.length * 8 }, keyUsages, bytes);
        }
        throw new DOMException(`Unsupported format: ${format}`, 'NotSupportedError');
      }
      case 'PBKDF2': {
        if (format === 'raw') {
          const bytes = toUint8Array(keyData as BufferSource);
          validateUsages(keyUsages, ['deriveKey', 'deriveBits']);
          return new CryptoKey('secret', false, { name: 'PBKDF2' }, keyUsages, new Uint8Array(bytes));
        }
        throw new DOMException(`Unsupported format: ${format}`, 'NotSupportedError');
      }
      case 'HKDF': {
        if (format === 'raw') {
          const bytes = toUint8Array(keyData as BufferSource);
          validateUsages(keyUsages, ['deriveKey', 'deriveBits']);
          return new CryptoKey('secret', false, { name: 'HKDF' }, keyUsages, new Uint8Array(bytes));
        }
        throw new DOMException(`Unsupported format: ${format}`, 'NotSupportedError');
      }
      case 'ECDH':
      case 'ECDSA': {
        const namedCurve = (algorithm as EcKeyImportParams).namedCurve;
        if (format === 'raw') {
          // Raw import of public key (uncompressed point)
          const bytes = toUint8Array(keyData as BufferSource);
          validateUsages(keyUsages, name === 'ECDH' ? ['deriveKey', 'deriveBits'] : ['verify']);
          return new CryptoKey('public', extractable, { name: alg.name, namedCurve }, keyUsages, new Uint8Array(bytes));
        }
        if (format === 'jwk') {
          const jwk = keyData as JsonWebKey;
          if (jwk.kty !== 'EC') throw new DOMException('JWK kty must be "EC"', 'DataError');
          if (jwk.d) {
            // Private key
            const privBytes = base64urlDecode(jwk.d);
            const xBytes = base64urlDecode(jwk.x!);
            const yBytes = base64urlDecode(jwk.y!);
            // Reconstruct uncompressed public key point: 0x04 || x || y
            const pubBytes = new Uint8Array(1 + xBytes.length + yBytes.length);
            pubBytes[0] = 0x04;
            pubBytes.set(xBytes, 1);
            pubBytes.set(yBytes, 1 + xBytes.length);
            const allowedUsages: KeyUsage[] = name === 'ECDH' ? ['deriveKey', 'deriveBits'] : ['sign'];
            validateUsages(keyUsages, allowedUsages);
            return new CryptoKey('private', extractable, { name: alg.name, namedCurve }, keyUsages, { pub: pubBytes, priv: privBytes } satisfies EcKeyPairHandle);
          } else {
            // Public key
            const xBytes = base64urlDecode(jwk.x!);
            const yBytes = base64urlDecode(jwk.y!);
            const pubBytes = new Uint8Array(1 + xBytes.length + yBytes.length);
            pubBytes[0] = 0x04;
            pubBytes.set(xBytes, 1);
            pubBytes.set(yBytes, 1 + xBytes.length);
            const allowedUsages: KeyUsage[] = name === 'ECDH' ? [] : ['verify'];
            validateUsages(keyUsages.length > 0 ? keyUsages : allowedUsages, name === 'ECDH' ? ['deriveKey', 'deriveBits'] : ['verify']);
            return new CryptoKey('public', extractable, { name: alg.name, namedCurve }, keyUsages, pubBytes);
          }
        }
        throw new DOMException(`Unsupported format: ${format}`, 'NotSupportedError');
      }
      default:
        throw new DOMException(`Unsupported algorithm: ${alg.name}`, 'NotSupportedError');
    }
  }

  // ==================== exportKey ====================

  async exportKey(
    format: 'raw' | 'jwk' | 'pkcs8' | 'spki',
    key: CryptoKey,
  ): Promise<ArrayBuffer | JsonWebKey> {
    if (!key.extractable) {
      throw new DOMException('Key is not extractable', 'InvalidAccessError');
    }

    const name = key.algorithm.name.toUpperCase();

    if (format === 'raw') {
      if (key.type === 'secret') {
        const handle = key._handle as Uint8Array;
        return (handle.buffer as ArrayBuffer).slice(handle.byteOffset, handle.byteOffset + handle.byteLength);
      }
      if (key.type === 'public' && (name === 'ECDH' || name === 'ECDSA')) {
        const handle = key._handle as Uint8Array;
        return (handle.buffer as ArrayBuffer).slice(handle.byteOffset, handle.byteOffset + handle.byteLength);
      }
      throw new DOMException('Cannot export in raw format', 'InvalidAccessError');
    }

    if (format === 'jwk') {
      if (key.type === 'secret') {
        const handle = key._handle as Uint8Array;
        const jwk: JsonWebKey = {
          kty: 'oct',
          k: base64urlEncode(handle),
          ext: key.extractable,
          key_ops: [...key.usages],
        };
        if (name.startsWith('AES-')) {
          jwk.alg = `A${(key.algorithm as AesKeyAlgorithm).length}${name.replace('AES-', '')}`;
        } else if (name === 'HMAC') {
          const hashName = (key.algorithm as HmacKeyAlgorithm).hash.name;
          jwk.alg = `HS${hashName.replace('SHA-', '')}`;
        }
        return jwk;
      }
      if ((name === 'ECDH' || name === 'ECDSA') && (key.type === 'public' || key.type === 'private')) {
        const namedCurve = (key.algorithm as EcKeyAlgorithm).namedCurve;
        let pubBytes: Uint8Array;
        if (key.type === 'public') {
          pubBytes = key._handle as Uint8Array;
        } else {
          pubBytes = (key._handle as EcKeyPairHandle).pub;
        }
        // Parse uncompressed point: 0x04 || x || y
        const coordLen = (pubBytes.length - 1) / 2;
        const x = pubBytes.slice(1, 1 + coordLen);
        const y = pubBytes.slice(1 + coordLen);
        const jwk: JsonWebKey = {
          kty: 'EC',
          crv: namedCurve,
          x: base64urlEncode(x),
          y: base64urlEncode(y),
          ext: key.extractable,
          key_ops: [...key.usages],
        };
        if (key.type === 'private') {
          jwk.d = base64urlEncode((key._handle as EcKeyPairHandle).priv);
        }
        return jwk;
      }
      throw new DOMException(`JWK export not supported for ${name} ${key.type}`, 'NotSupportedError');
    }

    throw new DOMException(`Unsupported export format: ${format}`, 'NotSupportedError');
  }

  // ==================== encrypt ====================

  async encrypt(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer> {
    await cryptoReady;
    checkUsage(key, 'encrypt');
    const alg = normalizeAlgorithm(algorithm);
    const name = alg.name.toUpperCase();
    const plaintext = toUint8Array(data);

    switch (name) {
      case 'AES-CBC': {
        const iv = toUint8Array((algorithm as AesCbcParams).iv);
        const keyBytes = key._handle as Uint8Array;
        const keyLen = keyBytes.length * 8;
        const cipher = _createCipheriv(`aes-${keyLen}-cbc`, keyBytes, iv);
        const part1 = cipher.update(plaintext);
        const part2 = cipher.final();
        const result = new Uint8Array(part1.length + part2.length);
        result.set(new Uint8Array(part1), 0);
        result.set(new Uint8Array(part2), part1.length);
        return result.buffer;
      }
      case 'AES-CTR': {
        const counter = toUint8Array((algorithm as AesCtrParams).counter);
        const keyBytes = key._handle as Uint8Array;
        const keyLen = keyBytes.length * 8;
        const cipher = _createCipheriv(`aes-${keyLen}-ctr`, keyBytes, counter);
        const part1 = cipher.update(plaintext);
        const part2 = cipher.final();
        const result = new Uint8Array(part1.length + part2.length);
        result.set(new Uint8Array(part1), 0);
        result.set(new Uint8Array(part2), part1.length);
        return result.buffer;
      }
      case 'AES-GCM': {
        const gcmParams = algorithm as AesGcmParams;
        const iv = toUint8Array(gcmParams.iv);
        const aad = gcmParams.additionalData ? toUint8Array(gcmParams.additionalData) : undefined;
        const keyBytes = key._handle as Uint8Array;
        const keyLen = keyBytes.length * 8;
        const cipher = _createCipheriv(`aes-${keyLen}-gcm`, keyBytes, iv);
        if (aad) cipher.setAAD!(aad);
        const part1 = cipher.update(plaintext);
        const part2 = cipher.final();
        const tag = cipher.getAuthTag!();
        const result = new Uint8Array(part1.length + part2.length + tag.length);
        result.set(new Uint8Array(part1), 0);
        result.set(new Uint8Array(part2), part1.length);
        result.set(new Uint8Array(tag), part1.length + part2.length);
        return result.buffer;
      }
      case 'RSA-OAEP': {
        const hashName = (key.algorithm as RsaHashedKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const handle = key._handle as RsaPemHandle;
        const rsaOaepParams = algorithm as RsaOaepParams;
        const label = rsaOaepParams.label ? toUint8Array(rsaOaepParams.label) : undefined;
        const ct = _rsaOaepEncrypt(nodeHash, handle.pem, plaintext, label);
        return (ct.buffer as ArrayBuffer).slice(ct.byteOffset, ct.byteOffset + ct.byteLength);
      }
      default:
        throw new DOMException(`Unsupported algorithm: ${alg.name}`, 'NotSupportedError');
    }
  }

  // ==================== decrypt ====================

  async decrypt(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer> {
    await cryptoReady;
    checkUsage(key, 'decrypt');
    const alg = normalizeAlgorithm(algorithm);
    const name = alg.name.toUpperCase();
    const ciphertext = toUint8Array(data);

    switch (name) {
      case 'AES-CBC': {
        const iv = toUint8Array((algorithm as AesCbcParams).iv);
        const keyBytes = key._handle as Uint8Array;
        const keyLen = keyBytes.length * 8;
        const decipher = _createDecipheriv(`aes-${keyLen}-cbc`, keyBytes, iv);
        const part1 = decipher.update(ciphertext);
        const part2 = decipher.final();
        const result = new Uint8Array(part1.length + part2.length);
        result.set(new Uint8Array(part1), 0);
        result.set(new Uint8Array(part2), part1.length);
        return result.buffer;
      }
      case 'AES-CTR': {
        const counter = toUint8Array((algorithm as AesCtrParams).counter);
        const keyBytes = key._handle as Uint8Array;
        const keyLen = keyBytes.length * 8;
        const decipher = _createDecipheriv(`aes-${keyLen}-ctr`, keyBytes, counter);
        const part1 = decipher.update(ciphertext);
        const part2 = decipher.final();
        const result = new Uint8Array(part1.length + part2.length);
        result.set(new Uint8Array(part1), 0);
        result.set(new Uint8Array(part2), part1.length);
        return result.buffer;
      }
      case 'AES-GCM': {
        const gcmParams = algorithm as AesGcmParams;
        const iv = toUint8Array(gcmParams.iv);
        const tagLength = (gcmParams.tagLength || 128) / 8;
        const aad = gcmParams.additionalData ? toUint8Array(gcmParams.additionalData) : undefined;
        const keyBytes = key._handle as Uint8Array;
        const keyLen = keyBytes.length * 8;
        const actualCiphertext = ciphertext.slice(0, ciphertext.length - tagLength);
        const tag = ciphertext.slice(ciphertext.length - tagLength);
        const decipher = _createDecipheriv(`aes-${keyLen}-gcm`, keyBytes, iv);
        decipher.setAuthTag!(tag);
        if (aad) decipher.setAAD!(aad);
        const part1 = decipher.update(actualCiphertext);
        const part2 = decipher.final();
        const result = new Uint8Array(part1.length + part2.length);
        result.set(new Uint8Array(part1), 0);
        result.set(new Uint8Array(part2), part1.length);
        return result.buffer;
      }
      case 'RSA-OAEP': {
        const hashName = (key.algorithm as RsaHashedKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const handle = key._handle as RsaPemHandle;
        const rsaOaepParams = algorithm as RsaOaepParams;
        const label = rsaOaepParams.label ? toUint8Array(rsaOaepParams.label) : undefined;
        const pt = _rsaOaepDecrypt(nodeHash, handle.pem, ciphertext, label);
        return (pt.buffer as ArrayBuffer).slice(pt.byteOffset, pt.byteOffset + pt.byteLength);
      }
      default:
        throw new DOMException(`Unsupported algorithm: ${alg.name}`, 'NotSupportedError');
    }
  }

  // ==================== sign ====================

  async sign(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer> {
    await cryptoReady;
    checkUsage(key, 'sign');
    const alg = normalizeAlgorithm(algorithm);
    const name = alg.name.toUpperCase();
    const bytes = toUint8Array(data);

    switch (name) {
      case 'HMAC': {
        const hashName = (key.algorithm as HmacKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const keyBytes = key._handle as Uint8Array;
        const hmac = _createHmac(nodeHash, keyBytes);
        hmac.update(bytes);
        const sig = hmac.digest();
        return (sig.buffer as ArrayBuffer).slice(sig.byteOffset, sig.byteOffset + sig.byteLength);
      }
      case 'RSASSA-PKCS1-V1_5': {
        const hashName = (key.algorithm as RsaHashedKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const handle = key._handle as RsaPemHandle;
        const signer = _createSign(nodeHash);
        signer.update(bytes);
        const sig = signer.sign(handle.pem);
        return (sig.buffer as ArrayBuffer).slice(sig.byteOffset, sig.byteOffset + sig.byteLength);
      }
      case 'ECDSA': {
        const ecdsaParams = algorithm as EcdsaParams;
        const hashName = typeof ecdsaParams.hash === 'string' ? ecdsaParams.hash : ecdsaParams.hash.name;
        const nodeHash = toNodeHashName(hashName);
        const namedCurve = (key.algorithm as EcKeyAlgorithm).namedCurve;
        const handle = key._handle as EcKeyPairHandle;
        const sig = _ecdsaSign(nodeHash, handle.priv, bytes, namedCurve);
        return (sig.buffer as ArrayBuffer).slice(sig.byteOffset, sig.byteOffset + sig.byteLength);
      }
      case 'RSA-PSS': {
        const hashName = (key.algorithm as RsaHashedKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const handle = key._handle as RsaPemHandle;
        const saltLen = (algorithm as RsaPssParams).saltLength ?? hashSize(hashName);
        const sig = _rsaPssSign(nodeHash, handle.pem, bytes, saltLen);
        return (sig.buffer as ArrayBuffer).slice(sig.byteOffset, sig.byteOffset + sig.byteLength);
      }
      default:
        throw new DOMException(`Unsupported algorithm: ${alg.name}`, 'NotSupportedError');
    }
  }

  // ==================== verify ====================

  async verify(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean> {
    await cryptoReady;
    checkUsage(key, 'verify');
    const alg = normalizeAlgorithm(algorithm);
    const name = alg.name.toUpperCase();
    const bytes = toUint8Array(data);
    const sig = toUint8Array(signature);

    switch (name) {
      case 'HMAC': {
        const hashName = (key.algorithm as HmacKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const keyBytes = key._handle as Uint8Array;
        const hmac = _createHmac(nodeHash, keyBytes);
        hmac.update(bytes);
        const expected = new Uint8Array(hmac.digest());
        if (expected.length !== sig.length) return false;
        // Constant-time compare
        let diff = 0;
        for (let i = 0; i < expected.length; i++) {
          diff |= expected[i] ^ sig[i];
        }
        return diff === 0;
      }
      case 'RSASSA-PKCS1-V1_5': {
        const hashName = (key.algorithm as RsaHashedKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const handle = key._handle as RsaPemHandle;
        const verifier = _createVerify(nodeHash);
        verifier.update(bytes);
        return verifier.verify(handle.pem, sig);
      }
      case 'ECDSA': {
        const ecdsaParams = algorithm as EcdsaParams;
        const hashName = typeof ecdsaParams.hash === 'string' ? ecdsaParams.hash : ecdsaParams.hash.name;
        const nodeHash = toNodeHashName(hashName);
        const namedCurve = (key.algorithm as EcKeyAlgorithm).namedCurve;
        const pubBytes = key._handle as Uint8Array;
        return _ecdsaVerify(nodeHash, pubBytes, sig, bytes, namedCurve);
      }
      case 'RSA-PSS': {
        const hashName = (key.algorithm as RsaHashedKeyAlgorithm).hash.name;
        const nodeHash = toNodeHashName(hashName);
        const handle = key._handle as RsaPemHandle;
        const saltLen = (algorithm as RsaPssParams).saltLength ?? hashSize(hashName);
        return _rsaPssVerify(nodeHash, handle.pem, sig, bytes, saltLen);
      }
      default:
        throw new DOMException(`Unsupported algorithm: ${alg.name}`, 'NotSupportedError');
    }
  }

  // ==================== deriveBits ====================

  async deriveBits(
    algorithm: AlgorithmIdentifier,
    baseKey: CryptoKey,
    length: number,
  ): Promise<ArrayBuffer> {
    await cryptoReady;
    checkUsage(baseKey, 'deriveBits');
    const alg = normalizeAlgorithm(algorithm);
    const name = alg.name.toUpperCase();

    switch (name) {
      case 'PBKDF2': {
        const pbkdf2Params = algorithm as Pbkdf2Params;
        const hashName = toNodeHashName(normalizeAlgorithm(pbkdf2Params.hash).name);
        const salt = toUint8Array(pbkdf2Params.salt);
        const iterations = pbkdf2Params.iterations;
        const keyBytes = baseKey._handle as Uint8Array;
        const result = _pbkdf2Sync(keyBytes, salt, iterations, length / 8, hashName);
        return (result.buffer as ArrayBuffer).slice(result.byteOffset, result.byteOffset + result.byteLength);
      }
      case 'HKDF': {
        const hkdfParams = algorithm as HkdfParams;
        const hashName = toNodeHashName(normalizeAlgorithm(hkdfParams.hash).name);
        const salt = toUint8Array(hkdfParams.salt);
        const info = toUint8Array(hkdfParams.info);
        const keyBytes = baseKey._handle as Uint8Array;
        const result = _hkdfSync(hashName, keyBytes, salt, info, length / 8);
        return result;
      }
      case 'ECDH': {
        const ecdhParams = algorithm as EcdhKeyDeriveParams;
        const publicKey = ecdhParams.public;
        const namedCurve = (baseKey.algorithm as EcKeyAlgorithm).namedCurve;
        const nodeCurve = toNodeCurveName(namedCurve);
        const ecdh = _createECDH(nodeCurve);
        const privHandle = baseKey._handle as EcKeyPairHandle;
        ecdh.setPrivateKey(privHandle.priv);
        const pubBytes = publicKey._handle instanceof Uint8Array ? publicKey._handle : (publicKey._handle as EcKeyPairHandle).pub;
        const secret = ecdh.computeSecret(pubBytes);
        const secretBytes = new Uint8Array(secret);
        if (length) {
          return secretBytes.buffer.slice(0, length / 8);
        }
        return secretBytes.buffer.slice(secretBytes.byteOffset, secretBytes.byteOffset + secretBytes.byteLength);
      }
      default:
        throw new DOMException(`Unsupported algorithm: ${alg.name}`, 'NotSupportedError');
    }
  }

  // ==================== deriveKey ====================

  async deriveKey(
    algorithm: AlgorithmIdentifier,
    baseKey: CryptoKey,
    derivedKeyAlgorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey> {
    const derivedAlg = normalizeAlgorithm(derivedKeyAlgorithm);
    let length: number;
    const dName = derivedAlg.name.toUpperCase();

    if (dName === 'AES-CBC' || dName === 'AES-CTR' || dName === 'AES-GCM') {
      length = (derivedKeyAlgorithm as AesKeyGenParams).length;
    } else if (dName === 'HMAC') {
      const hmacParams = derivedKeyAlgorithm as HmacKeyGenParams;
      const hashAlg = normalizeAlgorithm(hmacParams.hash);
      length = hmacParams.length || hashSize(hashAlg.name) * 8;
    } else {
      throw new DOMException(`Unsupported derived key algorithm: ${derivedAlg.name}`, 'NotSupportedError');
    }

    const bits = await this.deriveBits(algorithm, baseKey, length);
    return this.importKey('raw', bits, derivedKeyAlgorithm, extractable, keyUsages);
  }

  // ==================== wrapKey / unwrapKey (stubs) ====================

  async wrapKey(
    _format: 'raw' | 'jwk' | 'pkcs8' | 'spki',
    _key: CryptoKey,
    _wrappingKey: CryptoKey,
    _wrapAlgorithm: AlgorithmIdentifier,
  ): Promise<ArrayBuffer> {
    throw new DOMException('wrapKey not yet implemented', 'NotSupportedError');
  }

  async unwrapKey(
    _format: 'raw' | 'jwk' | 'pkcs8' | 'spki',
    _wrappedKey: BufferSource,
    _unwrappingKey: CryptoKey,
    _unwrapAlgorithm: AlgorithmIdentifier,
    _unwrappedKeyAlgorithm: AlgorithmIdentifier,
    _extractable: boolean,
    _keyUsages: KeyUsage[],
  ): Promise<CryptoKey> {
    throw new DOMException('unwrapKey not yet implemented', 'NotSupportedError');
  }
}
