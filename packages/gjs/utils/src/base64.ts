// Base64 encoding/decoding utilities for GJS
// Shared by @gjsify/buffer and @gjsify/string_decoder
// Reference: RFC 4648

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;

/** Decode a base64 string to a binary string. Uses native atob when available. */
export function atobPolyfill(str: string): string {
  if (typeof globalThis.atob === 'function') return globalThis.atob(str);
  const cleaned = str.replace(/[=\s]/g, '');
  let result = '';
  let bits = 0;
  let collected = 0;
  for (let i = 0; i < cleaned.length; i++) {
    bits = (bits << 6) | B64_LOOKUP[cleaned.charCodeAt(i)];
    collected += 6;
    if (collected >= 8) {
      collected -= 8;
      result += String.fromCharCode((bits >> collected) & 0xff);
    }
  }
  return result;
}

/** Encode a binary string to base64. Uses native btoa when available. */
export function btoaPolyfill(str: string): string {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(str);
  let result = '';
  let i = 0;
  for (; i + 2 < str.length; i += 3) {
    const n = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8) | str.charCodeAt(i + 2);
    result += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63];
  }
  if (i + 1 === str.length) {
    const n = str.charCodeAt(i) << 16;
    result += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + '==';
  } else if (i + 2 === str.length) {
    const n = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8);
    result += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + '=';
  }
  return result;
}

/** Decode a base64 string directly to Uint8Array (avoids lossy atob string round-trip). */
export function base64Decode(str: string): Uint8Array {
  const cleaned = str.replace(/[=\s]/g, '');
  const bytes = new Uint8Array((cleaned.length * 3) >> 2);
  let bits = 0;
  let collected = 0;
  let pos = 0;
  for (let i = 0; i < cleaned.length; i++) {
    bits = (bits << 6) | B64_LOOKUP[cleaned.charCodeAt(i)];
    collected += 6;
    if (collected >= 8) {
      collected -= 8;
      bytes[pos++] = (bits >> collected) & 0xff;
    }
  }
  return bytes.subarray(0, pos);
}

/** Encode a Uint8Array to base64 string. */
export function base64Encode(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += B64_CHARS[b0 >> 2];
    result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? B64_CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return result;
}
