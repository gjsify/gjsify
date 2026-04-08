// WebCrypto utility functions
// Reference: refs/deno/ext/crypto/00_crypto.js
// Reimplemented for GJS.

import type { KeyUsage } from './crypto-key.js';
// Named import of the DOMException polyfill — no global side-effect. Callers
// who need globalThis.DOMException should `import '@gjsify/dom-exception/register'`.
import { DOMException } from '@gjsify/dom-exception';

/** Normalize algorithm identifier to {name: string, ...} form */
export function normalizeAlgorithm(
  algorithm: string | { name: string; [key: string]: unknown },
): { name: string; [key: string]: unknown } {
  if (typeof algorithm === 'string') {
    return { name: algorithm };
  }
  if (!algorithm || typeof algorithm.name !== 'string') {
    throw new TypeError('Algorithm must have a name property');
  }
  return algorithm;
}

/** Map WebCrypto algorithm names to Node.js crypto names */
const HASH_NAMES: Record<string, string> = {
  'SHA-1': 'sha1',
  'SHA-256': 'sha256',
  'SHA-384': 'sha384',
  'SHA-512': 'sha512',
};

export function toNodeHashName(name: string): string {
  const resolved = HASH_NAMES[name.toUpperCase()] || HASH_NAMES[name];
  if (!resolved) {
    throw new DOMException(`Unrecognized hash name: ${name}`, 'NotSupportedError');
  }
  return resolved;
}

export function toWebCryptoHashName(name: string): string {
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const [web, node] of Object.entries(HASH_NAMES)) {
    if (node === name || upper === web.replace('-', '')) return web;
  }
  throw new DOMException(`Unrecognized hash name: ${name}`, 'NotSupportedError');
}

/** Map WebCrypto curve names to Node.js crypto names */
const CURVE_NAMES: Record<string, string> = {
  'P-256': 'prime256v1',
  'P-384': 'secp384r1',
  'P-521': 'secp521r1',
};

export function toNodeCurveName(name: string): string {
  const resolved = CURVE_NAMES[name];
  if (!resolved) {
    throw new DOMException(`Unrecognized curve name: ${name}`, 'NotSupportedError');
  }
  return resolved;
}

/** Get hash output size in bytes */
export function hashSize(hash: string): number {
  switch (toNodeHashName(hash)) {
    case 'sha1': return 20;
    case 'sha256': return 32;
    case 'sha384': return 48;
    case 'sha512': return 64;
    default: throw new DOMException(`Unsupported hash: ${hash}`, 'NotSupportedError');
  }
}

/** Validate key usages */
export function validateUsages(usages: KeyUsage[], allowed: KeyUsage[]): void {
  for (const usage of usages) {
    if (!allowed.includes(usage)) {
      throw new DOMException(`Invalid key usage: ${usage}`, 'SyntaxError');
    }
  }
  if (usages.length === 0) {
    throw new DOMException('Key usages must not be empty', 'SyntaxError');
  }
}

/** Check key has required usage */
export function checkUsage(key: { usages: KeyUsage[] }, required: KeyUsage): void {
  if (!key.usages.includes(required)) {
    throw new DOMException(
      `Key does not support the '${required}' usage`,
      'InvalidAccessError',
    );
  }
}

// Base64 lookup tables (avoid dependency on btoa/atob which may not exist on GJS)
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += B64_CHARS[(b0 >> 2) & 0x3f];
    result += B64_CHARS[((b0 << 4) | (b1 >> 4)) & 0x3f];
    result += i + 1 < len ? B64_CHARS[((b1 << 2) | (b2 >> 6)) & 0x3f] : '=';
    result += i + 2 < len ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return result;
}

function base64ToBytes(str: string): Uint8Array {
  // Strip padding
  let s = str;
  while (s.endsWith('=')) s = s.slice(0, -1);
  const out: number[] = [];
  let bits = 0;
  let val = 0;
  for (let i = 0; i < s.length; i++) {
    val = (val << 6) | B64_LOOKUP[s.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((val >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Base64url encode */
export function base64urlEncode(data: Uint8Array): string {
  return bytesToBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode */
export function base64urlDecode(str: string): Uint8Array {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return base64ToBytes(s);
}

/** Convert ArrayBuffer or view to Uint8Array */
export function toUint8Array(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('Expected BufferSource');
}

// DOMException polyfill provided by @gjsify/dom-exception import above
