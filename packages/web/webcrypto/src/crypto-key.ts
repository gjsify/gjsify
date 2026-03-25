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

// ---- Specific KeyAlgorithm sub-interfaces ----

export interface AesKeyAlgorithm extends KeyAlgorithm {
  length: number;
}

export interface HmacKeyAlgorithm extends KeyAlgorithm {
  hash: { name: string };
  length: number;
}

export interface EcKeyAlgorithm extends KeyAlgorithm {
  namedCurve: string;
}

export interface RsaHashedKeyAlgorithm extends KeyAlgorithm {
  hash: { name: string };
  modulusLength: number;
  publicExponent: Uint8Array;
}

// ---- Algorithm parameter interfaces (W3C WebCrypto) ----

export interface AesKeyGenParams {
  name: string;
  length: number;
  [key: string]: unknown;
}

export interface HmacKeyGenParams {
  name: string;
  hash: string | { name: string };
  length?: number;
  [key: string]: unknown;
}

export interface EcKeyGenParams {
  name: string;
  namedCurve: string;
  [key: string]: unknown;
}

export interface HmacImportParams {
  name: string;
  hash: string | { name: string };
  length?: number;
  [key: string]: unknown;
}

export interface EcKeyImportParams {
  name: string;
  namedCurve: string;
  [key: string]: unknown;
}

export interface AesCbcParams {
  name: string;
  iv: BufferSource;
  [key: string]: unknown;
}

export interface AesCtrParams {
  name: string;
  counter: BufferSource;
  length: number;
  [key: string]: unknown;
}

export interface AesGcmParams {
  name: string;
  iv: BufferSource;
  additionalData?: BufferSource;
  tagLength?: number;
  [key: string]: unknown;
}

export interface RsaOaepParams {
  name: string;
  label?: BufferSource;
  [key: string]: unknown;
}

export interface EcdsaParams {
  name: string;
  hash: string | { name: string };
  [key: string]: unknown;
}

export interface RsaPssParams {
  name: string;
  saltLength: number;
  [key: string]: unknown;
}

export interface Pbkdf2Params {
  name: string;
  hash: string | { name: string };
  salt: BufferSource;
  iterations: number;
  [key: string]: unknown;
}

export interface HkdfParams {
  name: string;
  hash: string | { name: string };
  salt: BufferSource;
  info: BufferSource;
  [key: string]: unknown;
}

export interface EcdhKeyDeriveParams {
  name: string;
  public: CryptoKey;
  [key: string]: unknown;
}

/** Union of all supported algorithm parameter types */
export type AlgorithmIdentifier = string | { name: string; [key: string]: unknown };

// ---- Internal handle types (not part of public API) ----

/** Handle for EC private keys: contains both public and private bytes */
export interface EcKeyPairHandle {
  pub: Uint8Array;
  priv: Uint8Array;
}

/** Handle for RSA keys: PEM-encoded key */
export interface RsaPemHandle {
  pem: string;
}

// ---- Lazy-loaded Node.js crypto function types ----

export interface HashLike {
  update(data: Uint8Array): void;
  digest(): Uint8Array;
}

export interface HmacLike {
  update(data: Uint8Array): void;
  digest(): Uint8Array;
}

export interface CipherLike {
  update(data: Uint8Array): Uint8Array;
  final(): Uint8Array;
  setAAD?(aad: Uint8Array): void;
  getAuthTag?(): Uint8Array;
}

export interface DecipherLike {
  update(data: Uint8Array): Uint8Array;
  final(): Uint8Array;
  setAuthTag?(tag: Uint8Array): void;
  setAAD?(aad: Uint8Array): void;
}

export interface SignerLike {
  update(data: Uint8Array): void;
  sign(key: string): Uint8Array;
}

export interface VerifierLike {
  update(data: Uint8Array): void;
  verify(key: string, sig: Uint8Array): boolean;
}

export interface EcdhLike {
  generateKeys(): void;
  getPublicKey(): Uint8Array;
  getPrivateKey(): Uint8Array;
  setPrivateKey(key: Uint8Array): void;
  computeSecret(key: Uint8Array): Uint8Array;
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
