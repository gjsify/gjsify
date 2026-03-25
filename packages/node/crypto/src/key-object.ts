// KeyObject implementation for GJS
// Reference: Node.js lib/internal/crypto/keys.js
// Reimplemented for GJS using existing ASN.1 parser

import { Buffer } from 'node:buffer';
import {
  parsePemKey, rsaKeySize,
  encodeSubjectPublicKeyInfo, encodeRsaPublicKeyPkcs1,
  encodeRsaPrivateKeyPkcs1, encodePrivateKeyInfo,
  derToPem,
} from './asn1.js';
import type { ParsedKey, RsaPublicComponents, RsaPrivateComponents } from './asn1.js';

// ---- Helpers ----

/** Convert BigInt to base64url-encoded string (no padding). */
function bigintToBase64url(value: bigint): string {
  if (value === 0n) return 'AA';
  const hex = value.toString(16);
  const paddedHex = hex.length % 2 ? '0' + hex : hex;
  const bytes: number[] = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
  }
  return Buffer.from(bytes).toString('base64url');
}

/** Convert base64url-encoded string to BigInt. */
function base64urlToBigint(b64: string): bigint {
  const buf = Buffer.from(b64, 'base64url');
  let result = 0n;
  for (let i = 0; i < buf.length; i++) {
    result = (result << 8n) | BigInt(buf[i]);
  }
  return result;
}

// ---- KeyObject base class ----

export class KeyObject {
  readonly type: 'secret' | 'public' | 'private';

  /** @internal */
  _handle: unknown;

  constructor(type: 'secret' | 'public' | 'private', handle: unknown) {
    if (type !== 'secret' && type !== 'public' && type !== 'private') {
      throw new TypeError(`Invalid KeyObject type: ${type}`);
    }
    this.type = type;
    this._handle = handle;
  }

  get symmetricKeySize(): number | undefined {
    if (this.type !== 'secret') return undefined;
    return (this._handle as Uint8Array).byteLength;
  }

  get asymmetricKeyType(): string | undefined {
    if (this.type === 'secret') return undefined;
    const handle = this._handle as { parsed: ParsedKey; pem: string };
    if (handle.parsed.type === 'rsa-public' || handle.parsed.type === 'rsa-private') {
      return 'rsa';
    }
    return undefined;
  }

  get asymmetricKeySize(): number | undefined {
    if (this.type === 'secret') return undefined;
    const handle = this._handle as { parsed: ParsedKey; pem: string };
    if (handle.parsed.type === 'rsa-public') {
      return rsaKeySize(handle.parsed.components.n) / 8;
    }
    if (handle.parsed.type === 'rsa-private') {
      return rsaKeySize(handle.parsed.components.n) / 8;
    }
    return undefined;
  }

  equals(otherKeyObject: KeyObject): boolean {
    if (!(otherKeyObject instanceof KeyObject)) return false;
    if (this.type !== otherKeyObject.type) return false;

    if (this.type === 'secret') {
      const a = this._handle as Uint8Array;
      const b = otherKeyObject._handle as Uint8Array;
      if (a.byteLength !== b.byteLength) return false;
      for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

    // For asymmetric keys, compare PEM strings
    const a = this._handle as { pem: string };
    const b = otherKeyObject._handle as { pem: string };
    return a.pem === b.pem;
  }

  export(options?: { type?: string; format?: string }): Buffer | string | object {
    if (this.type === 'secret') {
      const key = this._handle as Uint8Array;
      if (options?.format === 'jwk') {
        return {
          kty: 'oct',
          k: Buffer.from(key).toString('base64url'),
        };
      }
      return Buffer.from(key);
    }

    const handle = this._handle as { parsed: ParsedKey; pem: string };
    const format = options?.format ?? 'pem';
    const keyType = options?.type;

    if (format === 'jwk') {
      return exportJwk(handle.parsed, this.type);
    }

    if (format === 'pem') {
      // If we have a valid PEM (not derived marker), return it directly
      if (handle.pem && !handle.pem.startsWith('[')) {
        return handle.pem;
      }
      // Generate PEM from components
      return generatePem(handle.parsed, this.type, keyType);
    }

    if (format === 'der') {
      // If we have a valid PEM, extract DER from it
      if (handle.pem && !handle.pem.startsWith('[')) {
        const lines = handle.pem.trim().split(/\r?\n/);
        const headerIdx = lines.findIndex((l) => l.startsWith('-----BEGIN '));
        const footerIdx = lines.findIndex((l, i) => i > headerIdx && l.startsWith('-----END '));
        const base64Body = lines.slice(headerIdx + 1, footerIdx).join('');
        return Buffer.from(base64Body, 'base64');
      }
      // Generate DER from components
      return generateDer(handle.parsed, this.type, keyType);
    }

    throw new TypeError(`Unsupported export format: ${format}`);
  }

  get [Symbol.toStringTag]() {
    return 'KeyObject';
  }
}

// ---- JWK export/import ----

function exportJwk(parsed: ParsedKey, keyType: 'public' | 'private'): object {
  if (parsed.type === 'rsa-public') {
    return {
      kty: 'RSA',
      n: bigintToBase64url(parsed.components.n),
      e: bigintToBase64url(parsed.components.e),
    };
  }
  if (parsed.type === 'rsa-private') {
    if (keyType === 'public') {
      return {
        kty: 'RSA',
        n: bigintToBase64url(parsed.components.n),
        e: bigintToBase64url(parsed.components.e),
      };
    }
    const { n, e, d, p, q } = parsed.components;
    const dp = d % (p - 1n);
    const dq = d % (q - 1n);
    const qi = modInverse(q, p);
    return {
      kty: 'RSA',
      n: bigintToBase64url(n),
      e: bigintToBase64url(e),
      d: bigintToBase64url(d),
      p: bigintToBase64url(p),
      q: bigintToBase64url(q),
      dp: bigintToBase64url(dp),
      dq: bigintToBase64url(dq),
      qi: bigintToBase64url(qi),
    };
  }
  throw new Error('Unsupported key type for JWK export');
}

function importJwkRsa(jwk: any): { parsed: ParsedKey; pem: string } {
  if (jwk.d) {
    // Private key
    const components: RsaPrivateComponents = {
      n: base64urlToBigint(jwk.n),
      e: base64urlToBigint(jwk.e),
      d: base64urlToBigint(jwk.d),
      p: base64urlToBigint(jwk.p),
      q: base64urlToBigint(jwk.q),
    };
    const parsed: ParsedKey = { type: 'rsa-private', components };
    const der = encodeRsaPrivateKeyPkcs1(components);
    const pem = derToPem(der, 'RSA PRIVATE KEY');
    return { parsed, pem };
  }
  // Public key
  const components: RsaPublicComponents = {
    n: base64urlToBigint(jwk.n),
    e: base64urlToBigint(jwk.e),
  };
  const parsed: ParsedKey = { type: 'rsa-public', components };
  const der = encodeSubjectPublicKeyInfo(components);
  const pem = derToPem(der, 'PUBLIC KEY');
  return { parsed, pem };
}

// ---- PEM/DER generation ----

function generatePem(parsed: ParsedKey, keyType: 'public' | 'private', type?: string): string {
  if (parsed.type === 'rsa-public') {
    if (type === 'pkcs1') {
      const der = encodeRsaPublicKeyPkcs1(parsed.components);
      return derToPem(der, 'RSA PUBLIC KEY');
    }
    // Default: SPKI
    const der = encodeSubjectPublicKeyInfo(parsed.components);
    return derToPem(der, 'PUBLIC KEY');
  }
  if (parsed.type === 'rsa-private' && keyType === 'public') {
    // Exporting public part of private key
    const pubComponents: RsaPublicComponents = {
      n: parsed.components.n,
      e: parsed.components.e,
    };
    if (type === 'pkcs1') {
      const der = encodeRsaPublicKeyPkcs1(pubComponents);
      return derToPem(der, 'RSA PUBLIC KEY');
    }
    const der = encodeSubjectPublicKeyInfo(pubComponents);
    return derToPem(der, 'PUBLIC KEY');
  }
  if (parsed.type === 'rsa-private') {
    if (type === 'pkcs8') {
      const der = encodePrivateKeyInfo(parsed.components);
      return derToPem(der, 'PRIVATE KEY');
    }
    // Default: PKCS#1
    const der = encodeRsaPrivateKeyPkcs1(parsed.components);
    return derToPem(der, 'RSA PRIVATE KEY');
  }
  throw new Error('Cannot generate PEM for this key type');
}

function generateDer(parsed: ParsedKey, keyType: 'public' | 'private', type?: string): Buffer {
  if (parsed.type === 'rsa-public') {
    if (type === 'pkcs1') {
      return Buffer.from(encodeRsaPublicKeyPkcs1(parsed.components));
    }
    return Buffer.from(encodeSubjectPublicKeyInfo(parsed.components));
  }
  if (parsed.type === 'rsa-private' && keyType === 'public') {
    const pubComponents: RsaPublicComponents = {
      n: parsed.components.n,
      e: parsed.components.e,
    };
    if (type === 'pkcs1') {
      return Buffer.from(encodeRsaPublicKeyPkcs1(pubComponents));
    }
    return Buffer.from(encodeSubjectPublicKeyInfo(pubComponents));
  }
  if (parsed.type === 'rsa-private') {
    if (type === 'pkcs8') {
      return Buffer.from(encodePrivateKeyInfo(parsed.components));
    }
    return Buffer.from(encodeRsaPrivateKeyPkcs1(parsed.components));
  }
  throw new Error('Cannot generate DER for this key type');
}

function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % m) + m) % m;
}

// ---- Factory functions ----

interface KeyInput {
  key: string | Buffer | KeyObject | object;
  format?: 'pem' | 'der' | 'jwk';
  type?: 'pkcs1' | 'spki' | 'pkcs8' | 'sec1';
  passphrase?: string | Buffer;
  encoding?: BufferEncoding;
}

/**
 * Create a secret key from raw bytes.
 */
export function createSecretKey(key: Buffer | Uint8Array | string, encoding?: BufferEncoding): KeyObject {
  let keyBuf: Uint8Array;
  if (typeof key === 'string') {
    keyBuf = Buffer.from(key, encoding ?? 'utf8');
  } else {
    keyBuf = new Uint8Array(key);
  }
  return new KeyObject('secret', keyBuf);
}

/**
 * Create a public key from PEM, DER, JWK, or another KeyObject.
 */
export function createPublicKey(key: string | Buffer | KeyInput | KeyObject): KeyObject {
  if (key instanceof KeyObject) {
    if (key.type === 'public') return key;
    if (key.type === 'private') {
      // Derive public key from private key
      const handle = key._handle as { parsed: ParsedKey; pem: string };
      if (handle.parsed.type === 'rsa-private') {
        const pubComponents: RsaPublicComponents = {
          n: handle.parsed.components.n,
          e: handle.parsed.components.e,
        };
        const pubParsed: ParsedKey = { type: 'rsa-public', components: pubComponents };
        // Generate proper PEM from components
        const der = encodeSubjectPublicKeyInfo(pubComponents);
        const pem = derToPem(der, 'PUBLIC KEY');
        return new KeyObject('public', { parsed: pubParsed, pem });
      }
    }
    throw new TypeError('Cannot create public key from secret key');
  }

  // JWK input
  if (typeof key === 'object' && !Buffer.isBuffer(key) && 'key' in key) {
    const input = key as KeyInput;
    if (input.format === 'jwk') {
      const jwk = input.key as any;
      if (jwk.kty === 'RSA') {
        const { parsed, pem } = importJwkRsa({ n: jwk.n, e: jwk.e }); // public only
        return new KeyObject('public', { parsed, pem });
      }
      throw new Error(`Unsupported JWK key type: ${jwk.kty}`);
    }
  }

  const pem = normalizePem(key);
  const parsed = parsePemKey(pem);
  if (parsed.type === 'rsa-private') {
    // Extract public components from private key
    const pubComponents: RsaPublicComponents = {
      n: parsed.components.n,
      e: parsed.components.e,
    };
    const pubParsed: ParsedKey = { type: 'rsa-public', components: pubComponents };
    // Generate proper public key PEM
    const der = encodeSubjectPublicKeyInfo(pubComponents);
    const pubPem = derToPem(der, 'PUBLIC KEY');
    return new KeyObject('public', { parsed: pubParsed, pem: pubPem });
  }
  return new KeyObject('public', { parsed, pem });
}

/**
 * Create a private key from PEM, DER, JWK, or KeyInput.
 */
export function createPrivateKey(key: string | Buffer | KeyInput): KeyObject {
  // JWK input
  if (typeof key === 'object' && !Buffer.isBuffer(key) && 'key' in key) {
    const input = key as KeyInput;
    if (input.format === 'jwk') {
      const jwk = input.key as any;
      if (jwk.kty === 'RSA' && jwk.d) {
        const { parsed, pem } = importJwkRsa(jwk);
        return new KeyObject('private', { parsed, pem });
      }
      throw new Error('JWK does not contain a private key');
    }
  }

  const pem = normalizePem(key);
  const parsed = parsePemKey(pem);
  if (parsed.type !== 'rsa-private') {
    throw new TypeError('Key is not a private key');
  }
  return new KeyObject('private', { parsed, pem });
}

function normalizePem(key: string | Buffer | KeyInput): string {
  if (typeof key === 'string') return key;
  if (Buffer.isBuffer(key)) return key.toString('utf8');
  if (key && typeof key === 'object' && 'key' in key) {
    const input = key as KeyInput;
    if (typeof input.key === 'string') return input.key;
    if (Buffer.isBuffer(input.key)) return input.key.toString(input.encoding ?? 'utf8');
    if (input.key instanceof KeyObject) {
      return input.key.export({ format: 'pem' }) as string;
    }
  }
  throw new TypeError('Invalid key input');
}
