// KeyObject implementation for GJS
// Reference: Node.js lib/internal/crypto/keys.js
// Reimplemented for GJS using existing ASN.1 parser

import { Buffer } from 'buffer';
import { parsePemKey, rsaKeySize } from './asn1.js';
import type { ParsedKey, RsaPublicComponents, RsaPrivateComponents } from './asn1.js';

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

  export(options?: { type?: string; format?: string }): Buffer | string {
    if (this.type === 'secret') {
      const key = this._handle as Uint8Array;
      if (options?.format === 'jwk') {
        throw new Error('JWK export not yet supported for secret keys');
      }
      return Buffer.from(key);
    }

    const handle = this._handle as { parsed: ParsedKey; pem: string };
    const format = options?.format ?? 'pem';

    if (format === 'pem') {
      return handle.pem;
    }
    if (format === 'der') {
      // Extract base64 body from PEM
      const lines = handle.pem.trim().split(/\r?\n/);
      const headerIdx = lines.findIndex((l) => l.startsWith('-----BEGIN '));
      const footerIdx = lines.findIndex((l, i) => i > headerIdx && l.startsWith('-----END '));
      const base64Body = lines.slice(headerIdx + 1, footerIdx).join('');
      return Buffer.from(base64Body, 'base64');
    }

    throw new TypeError(`Unsupported export format: ${format}`);
  }

  get [Symbol.toStringTag]() {
    return 'KeyObject';
  }
}

// ---- Factory functions ----

interface KeyInput {
  key: string | Buffer | KeyObject;
  format?: 'pem' | 'der';
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
 * Create a public key from PEM, DER, or another KeyObject.
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
        // We don't have a PEM encoder, so store a synthetic marker
        return new KeyObject('public', { parsed: pubParsed, pem: '[derived-public-key]' });
      }
    }
    throw new TypeError('Cannot create public key from secret key');
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
    return new KeyObject('public', { parsed: pubParsed, pem });
  }
  return new KeyObject('public', { parsed, pem });
}

/**
 * Create a private key from PEM, DER, or KeyInput.
 */
export function createPrivateKey(key: string | Buffer | KeyInput): KeyObject {
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
