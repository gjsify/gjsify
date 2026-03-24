// W3C CryptoKey for GJS
// Reference: refs/deno/ext/crypto/00_crypto.js
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Reimplemented for GJS using @gjsify/crypto primitives.

export type KeyType = 'public' | 'private' | 'secret';
export type KeyUsage = 'encrypt' | 'decrypt' | 'sign' | 'verify' | 'deriveKey' | 'deriveBits' | 'wrapKey' | 'unwrapKey';

export interface KeyAlgorithm {
  name: string;
  [key: string]: unknown;
}

/**
 * CryptoKey represents a cryptographic key obtained from SubtleCrypto methods.
 * It stores algorithm metadata, key type, extractability, and usage flags
 * alongside the raw key material (internal handle).
 */
export class CryptoKey {
  readonly type: KeyType;
  readonly extractable: boolean;
  readonly algorithm: KeyAlgorithm;
  readonly usages: KeyUsage[];

  /** @internal Raw key material — not visible to user code */
  _handle: unknown;

  constructor(
    type: KeyType,
    extractable: boolean,
    algorithm: KeyAlgorithm,
    usages: KeyUsage[],
    handle: unknown,
  ) {
    this.type = type;
    this.extractable = extractable;
    this.algorithm = Object.freeze({ ...algorithm });
    this.usages = Object.freeze([...usages]) as unknown as KeyUsage[];
    this._handle = handle;
  }

  get [Symbol.toStringTag](): string {
    return 'CryptoKey';
  }
}

export interface CryptoKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}
