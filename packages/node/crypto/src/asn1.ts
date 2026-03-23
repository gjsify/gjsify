// ASN.1/DER/PEM parser for crypto keys — original implementation for GJS
// Reference: refs/browserify-sign/browser/sign.js (parse-asn1 patterns)

import { Buffer } from 'buffer';

// ============================================================================
// PEM parsing
// ============================================================================

/**
 * Strip PEM armor (header/footer lines), base64-decode the body to DER bytes.
 */
function pemToDer(pem: string): { type: string; der: Uint8Array } {
  const lines = pem.trim().split(/\r?\n/);

  // Find header line
  const headerIdx = lines.findIndex((l) => l.startsWith('-----BEGIN '));
  if (headerIdx === -1) {
    throw new Error('Invalid PEM: no BEGIN line found');
  }
  const headerLine = lines[headerIdx];
  const headerMatch = headerLine.match(/^-----BEGIN (.+)-----$/);
  if (!headerMatch) {
    throw new Error('Invalid PEM header format');
  }
  const type = headerMatch[1];

  // Find footer line
  const footerIdx = lines.findIndex((l, i) => i > headerIdx && l.startsWith('-----END '));
  if (footerIdx === -1) {
    throw new Error('Invalid PEM: no END line found');
  }

  // Base64-decode the body between header and footer
  const base64Body = lines.slice(headerIdx + 1, footerIdx).join('');
  const der = Buffer.from(base64Body, 'base64');

  return { type, der: new Uint8Array(der.buffer, der.byteOffset, der.byteLength) };
}

// ============================================================================
// DER / ASN.1 parser
// ============================================================================

/** ASN.1 tag constants */
const ASN1_INTEGER = 0x02;
const ASN1_BIT_STRING = 0x03;
const ASN1_OCTET_STRING = 0x04;
const ASN1_NULL = 0x05;
const ASN1_OID = 0x06;
const ASN1_SEQUENCE = 0x30;

interface DerValue {
  tag: number;
  data: Uint8Array;
  children?: DerValue[];
}

/**
 * Parse one TLV (tag-length-value) from the DER buffer starting at `offset`.
 * Returns the parsed value and the new offset past it.
 */
function parseTlv(buf: Uint8Array, offset: number): { value: DerValue; next: number } {
  if (offset >= buf.length) {
    throw new Error('ASN.1 parse error: unexpected end of data');
  }

  const tag = buf[offset++];

  // Parse length
  let length: number;
  const firstLenByte = buf[offset++];
  if (firstLenByte < 0x80) {
    // Short form
    length = firstLenByte;
  } else {
    // Long form: firstLenByte & 0x7f = number of subsequent length bytes
    const numLenBytes = firstLenByte & 0x7f;
    if (numLenBytes === 0) {
      throw new Error('ASN.1 parse error: indefinite length not supported');
    }
    length = 0;
    for (let i = 0; i < numLenBytes; i++) {
      length = (length << 8) | buf[offset++];
    }
  }

  const data = buf.slice(offset, offset + length);
  const next = offset + length;

  const result: DerValue = { tag, data };

  // If the tag is a SEQUENCE (constructed), parse children
  if (tag === ASN1_SEQUENCE) {
    result.children = parseSequenceChildren(data);
  }

  return { value: result, next };
}

/**
 * Parse all TLV children within a SEQUENCE's data bytes.
 */
function parseSequenceChildren(data: Uint8Array): DerValue[] {
  const children: DerValue[] = [];
  let pos = 0;
  while (pos < data.length) {
    const { value, next } = parseTlv(data, pos);
    children.push(value);
    pos = next;
  }
  return children;
}

/**
 * Parse the entire DER buffer as a single top-level TLV.
 */
function parseDer(buf: Uint8Array): DerValue {
  const { value } = parseTlv(buf, 0);
  return value;
}

// ============================================================================
// Integer extraction
// ============================================================================

/**
 * Convert an ASN.1 INTEGER's raw data bytes to a non-negative BigInt.
 * ASN.1 INTEGERs are big-endian two's-complement. For RSA keys all values
 * are positive, so we just strip any leading 0x00 padding byte.
 */
function integerToBigInt(data: Uint8Array): bigint {
  let start = 0;
  // Strip leading zero byte used to keep the integer positive
  while (start < data.length - 1 && data[start] === 0) {
    start++;
  }
  let result = 0n;
  for (let i = start; i < data.length; i++) {
    result = (result << 8n) | BigInt(data[i]);
  }
  return result;
}

// ============================================================================
// OID matching
// ============================================================================

/** RSA encryption OID: 1.2.840.113549.1.1.1 */
const RSA_OID = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);

function oidsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// Key component types
// ============================================================================

export interface RsaPublicComponents {
  n: bigint;
  e: bigint;
}

export interface RsaPrivateComponents {
  n: bigint;
  e: bigint;
  d: bigint;
  p: bigint;
  q: bigint;
}

export type ParsedKey =
  | { type: 'rsa-public'; components: RsaPublicComponents }
  | { type: 'rsa-private'; components: RsaPrivateComponents };

// ============================================================================
// PKCS#1 RSAPublicKey / RSAPrivateKey
// ============================================================================

/**
 * Parse PKCS#1 RSAPublicKey:
 *   SEQUENCE { INTEGER n, INTEGER e }
 */
function parseRsaPublicKeyPkcs1(seq: DerValue): RsaPublicComponents {
  const children = seq.children;
  if (!children || children.length < 2) {
    throw new Error('Invalid PKCS#1 RSAPublicKey structure');
  }
  return {
    n: integerToBigInt(children[0].data),
    e: integerToBigInt(children[1].data),
  };
}

/**
 * Parse PKCS#1 RSAPrivateKey:
 *   SEQUENCE {
 *     INTEGER version,
 *     INTEGER n,
 *     INTEGER e,
 *     INTEGER d,
 *     INTEGER p,
 *     INTEGER q,
 *     INTEGER dp,
 *     INTEGER dq,
 *     INTEGER qi
 *   }
 */
function parseRsaPrivateKeyPkcs1(seq: DerValue): RsaPrivateComponents {
  const children = seq.children;
  if (!children || children.length < 6) {
    throw new Error('Invalid PKCS#1 RSAPrivateKey structure');
  }
  // children[0] = version (should be 0)
  return {
    n: integerToBigInt(children[1].data),
    e: integerToBigInt(children[2].data),
    d: integerToBigInt(children[3].data),
    p: integerToBigInt(children[4].data),
    q: integerToBigInt(children[5].data),
  };
}

// ============================================================================
// PKCS#8 SubjectPublicKeyInfo / PrivateKeyInfo
// ============================================================================

/**
 * Parse PKCS#8 SubjectPublicKeyInfo:
 *   SEQUENCE {
 *     SEQUENCE { OID algorithm, NULL }     -- AlgorithmIdentifier
 *     BIT STRING                            -- wraps PKCS#1 RSAPublicKey
 *   }
 */
function parseSubjectPublicKeyInfo(seq: DerValue): RsaPublicComponents {
  const children = seq.children;
  if (!children || children.length < 2) {
    throw new Error('Invalid SubjectPublicKeyInfo structure');
  }

  // Verify algorithm OID is RSA
  const algIdSeq = children[0];
  if (!algIdSeq.children || algIdSeq.children.length < 1) {
    throw new Error('Invalid AlgorithmIdentifier');
  }
  const oid = algIdSeq.children[0];
  if (oid.tag !== ASN1_OID || !oidsEqual(oid.data, RSA_OID)) {
    throw new Error('Unsupported algorithm: only RSA is supported');
  }

  // The BIT STRING wraps the PKCS#1 RSAPublicKey
  const bitString = children[1];
  if (bitString.tag !== ASN1_BIT_STRING) {
    throw new Error('Expected BIT STRING for public key data');
  }
  // BIT STRING has a leading byte for unused-bits count (should be 0)
  const innerDer = bitString.data.slice(1);
  const innerSeq = parseDer(innerDer);
  return parseRsaPublicKeyPkcs1(innerSeq);
}

/**
 * Parse PKCS#8 PrivateKeyInfo:
 *   SEQUENCE {
 *     INTEGER version,
 *     SEQUENCE { OID algorithm, NULL }     -- AlgorithmIdentifier
 *     OCTET STRING                          -- wraps PKCS#1 RSAPrivateKey
 *   }
 */
function parsePrivateKeyInfo(seq: DerValue): RsaPrivateComponents {
  const children = seq.children;
  if (!children || children.length < 3) {
    throw new Error('Invalid PrivateKeyInfo structure');
  }

  // children[0] = version INTEGER (should be 0)
  // Verify algorithm OID is RSA
  const algIdSeq = children[1];
  if (!algIdSeq.children || algIdSeq.children.length < 1) {
    throw new Error('Invalid AlgorithmIdentifier');
  }
  const oid = algIdSeq.children[0];
  if (oid.tag !== ASN1_OID || !oidsEqual(oid.data, RSA_OID)) {
    throw new Error('Unsupported algorithm: only RSA is supported');
  }

  // The OCTET STRING wraps the PKCS#1 RSAPrivateKey
  const octetString = children[2];
  if (octetString.tag !== ASN1_OCTET_STRING) {
    throw new Error('Expected OCTET STRING for private key data');
  }
  const innerSeq = parseDer(octetString.data);
  return parseRsaPrivateKeyPkcs1(innerSeq);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a PEM-encoded RSA key. Supports:
 * - RSA PUBLIC KEY (PKCS#1)
 * - PUBLIC KEY (PKCS#8 SubjectPublicKeyInfo)
 * - RSA PRIVATE KEY (PKCS#1)
 * - PRIVATE KEY (PKCS#8 PrivateKeyInfo)
 */
export function parsePemKey(pem: string): ParsedKey {
  const { type, der } = pemToDer(pem);
  const root = parseDer(der);

  if (root.tag !== ASN1_SEQUENCE) {
    throw new Error('Invalid key format: expected top-level SEQUENCE');
  }

  switch (type) {
    case 'RSA PUBLIC KEY':
      // PKCS#1 RSAPublicKey
      return { type: 'rsa-public', components: parseRsaPublicKeyPkcs1(root) };

    case 'PUBLIC KEY':
      // PKCS#8 SubjectPublicKeyInfo
      return { type: 'rsa-public', components: parseSubjectPublicKeyInfo(root) };

    case 'RSA PRIVATE KEY':
      // PKCS#1 RSAPrivateKey
      return { type: 'rsa-private', components: parseRsaPrivateKeyPkcs1(root) };

    case 'PRIVATE KEY':
      // PKCS#8 PrivateKeyInfo
      return { type: 'rsa-private', components: parsePrivateKeyInfo(root) };

    default:
      throw new Error(`Unsupported PEM type: ${type}`);
  }
}

/**
 * Get the key size in bytes (byte length of modulus n).
 */
export function rsaKeySize(n: bigint): number {
  let bits = 0;
  let val = n;
  while (val > 0n) {
    bits++;
    val >>= 1n;
  }
  return Math.ceil(bits / 8);
}
