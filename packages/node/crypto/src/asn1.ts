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
// DER encoder
// ============================================================================

/**
 * Encode a length value in DER format.
 */
function encodeLength(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let val = length;
  while (val > 0) {
    bytes.unshift(val & 0xff);
    val >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

/**
 * Encode a TLV (tag-length-value).
 */
function encodeTlv(tag: number, data: Uint8Array): Uint8Array {
  const len = encodeLength(data.length);
  const result = new Uint8Array(1 + len.length + data.length);
  result[0] = tag;
  result.set(len, 1);
  result.set(data, 1 + len.length);
  return result;
}

/**
 * Encode a BigInt as an ASN.1 INTEGER.
 */
export function bigintToAsn1Integer(value: bigint): Uint8Array {
  if (value === 0n) {
    return encodeTlv(ASN1_INTEGER, new Uint8Array([0]));
  }
  const hex = value.toString(16);
  const paddedHex = hex.length % 2 ? '0' + hex : hex;
  const bytes: number[] = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
  }
  // Add leading 0x00 if high bit is set (to keep integer positive)
  if (bytes[0] & 0x80) {
    bytes.unshift(0);
  }
  return encodeTlv(ASN1_INTEGER, new Uint8Array(bytes));
}

/**
 * Encode an ASN.1 SEQUENCE from its children.
 */
export function encodeSequence(children: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const child of children) totalLen += child.length;
  const data = new Uint8Array(totalLen);
  let offset = 0;
  for (const child of children) {
    data.set(child, offset);
    offset += child.length;
  }
  return encodeTlv(ASN1_SEQUENCE, data);
}

/**
 * Encode an ASN.1 BIT STRING (with 0 unused bits).
 */
function encodeBitString(data: Uint8Array): Uint8Array {
  const inner = new Uint8Array(1 + data.length);
  inner[0] = 0; // 0 unused bits
  inner.set(data, 1);
  return encodeTlv(ASN1_BIT_STRING, inner);
}

/**
 * Encode an ASN.1 OCTET STRING.
 */
function encodeOctetString(data: Uint8Array): Uint8Array {
  return encodeTlv(ASN1_OCTET_STRING, data);
}

/**
 * Encode an ASN.1 OID.
 */
function encodeOid(oidBytes: Uint8Array): Uint8Array {
  return encodeTlv(ASN1_OID, oidBytes);
}

/**
 * Encode ASN.1 NULL.
 */
function encodeNull(): Uint8Array {
  return new Uint8Array([ASN1_NULL, 0]);
}

/**
 * Encode RSA public key components as PKCS#1 RSAPublicKey DER.
 */
export function encodeRsaPublicKeyPkcs1(components: RsaPublicComponents): Uint8Array {
  return encodeSequence([
    bigintToAsn1Integer(components.n),
    bigintToAsn1Integer(components.e),
  ]);
}

/**
 * Encode RSA public key as PKCS#8 SubjectPublicKeyInfo DER.
 */
export function encodeSubjectPublicKeyInfo(components: RsaPublicComponents): Uint8Array {
  const algorithmId = encodeSequence([encodeOid(RSA_OID), encodeNull()]);
  const rsaPublicKey = encodeRsaPublicKeyPkcs1(components);
  const bitString = encodeBitString(rsaPublicKey);
  return encodeSequence([algorithmId, bitString]);
}

/**
 * Encode RSA private key components as PKCS#1 RSAPrivateKey DER.
 */
export function encodeRsaPrivateKeyPkcs1(components: RsaPrivateComponents): Uint8Array {
  // Compute dp, dq, qi from p, q, d
  const dp = components.d % (components.p - 1n);
  const dq = components.d % (components.q - 1n);
  const qi = modInverse(components.q, components.p);
  return encodeSequence([
    bigintToAsn1Integer(0n), // version
    bigintToAsn1Integer(components.n),
    bigintToAsn1Integer(components.e),
    bigintToAsn1Integer(components.d),
    bigintToAsn1Integer(components.p),
    bigintToAsn1Integer(components.q),
    bigintToAsn1Integer(dp),
    bigintToAsn1Integer(dq),
    bigintToAsn1Integer(qi),
  ]);
}

/**
 * Encode RSA private key as PKCS#8 PrivateKeyInfo DER.
 */
export function encodePrivateKeyInfo(components: RsaPrivateComponents): Uint8Array {
  const algorithmId = encodeSequence([encodeOid(RSA_OID), encodeNull()]);
  const rsaPrivateKey = encodeRsaPrivateKeyPkcs1(components);
  const octetString = encodeOctetString(rsaPrivateKey);
  return encodeSequence([
    bigintToAsn1Integer(0n), // version
    algorithmId,
    octetString,
  ]);
}

/**
 * Convert DER bytes to PEM string.
 */
export function derToPem(der: Uint8Array, type: string): string {
  const base64 = Buffer.from(der).toString('base64');
  const lines: string[] = [`-----BEGIN ${type}-----`];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.substring(i, i + 64));
  }
  lines.push(`-----END ${type}-----`);
  return lines.join('\n');
}

/**
 * Modular inverse: a^(-1) mod m using extended Euclidean algorithm.
 */
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

// ============================================================================
// X.509 Certificate parsing
// ============================================================================

export interface X509Components {
  raw: Uint8Array;
  tbsCertificate: Uint8Array;
  serialNumber: bigint;
  issuer: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
  publicKey: RsaPublicComponents | null;
  publicKeyAlgorithm: string;
  signatureAlgorithm: string;
  signature: Uint8Array;
  subjectAltName?: string[];
  extensions?: DerValue[];
}

/**
 * Parse an X.509 certificate from PEM or DER.
 */
export function parseX509(pem: string): X509Components {
  const { der } = pemToDer(pem);
  return parseX509Der(der);
}

/**
 * Parse an X.509 certificate from DER bytes.
 */
export function parseX509Der(der: Uint8Array): X509Components {
  const root = parseDer(der);
  if (root.tag !== ASN1_SEQUENCE || !root.children || root.children.length < 3) {
    throw new Error('Invalid X.509 certificate structure');
  }

  const tbsCertificate = root.children[0];
  const signatureAlgorithm = root.children[1];
  const signatureBitString = root.children[2];

  if (!tbsCertificate.children || tbsCertificate.children.length < 6) {
    throw new Error('Invalid TBSCertificate structure');
  }

  let idx = 0;
  // Check for explicit [0] version tag (0xa0)
  if (tbsCertificate.children[0].tag === 0xa0) {
    idx++; // skip version wrapper
  }

  // Serial number
  const serialNumber = integerToBigInt(tbsCertificate.children[idx].data);
  idx++;

  // Signature algorithm inside TBS (skip, use outer one)
  idx++;

  // Issuer
  const issuer = parseDN(tbsCertificate.children[idx]);
  idx++;

  // Validity
  const validity = tbsCertificate.children[idx];
  const validFrom = parseAsn1Time(validity.children![0]);
  const validTo = parseAsn1Time(validity.children![1]);
  idx++;

  // Subject
  const subject = parseDN(tbsCertificate.children[idx]);
  idx++;

  // Subject Public Key Info
  let publicKey: RsaPublicComponents | null = null;
  let publicKeyAlgorithm = 'unknown';
  if (idx < tbsCertificate.children.length) {
    const spki = tbsCertificate.children[idx];
    try {
      if (spki.children && spki.children.length >= 2) {
        const algId = spki.children[0];
        if (algId.children && algId.children.length >= 1) {
          const oid = algId.children[0];
          if (oid.tag === ASN1_OID && oidsEqual(oid.data, RSA_OID)) {
            publicKeyAlgorithm = 'rsa';
            publicKey = parseSubjectPublicKeyInfo(spki);
          }
        }
      }
    } catch {
      // Non-RSA key or parse error — leave null
    }
    idx++;
  }

  // Parse extensions (optional, context tag [3] = 0xa3)
  let subjectAltName: string[] | undefined;
  let extensions: DerValue[] | undefined;
  for (let i = idx; i < tbsCertificate.children.length; i++) {
    const child = tbsCertificate.children[i];
    if (child.tag === 0xa3 && child.data.length > 0) {
      // Extensions wrapper
      const extSeq = parseDer(child.data);
      if (extSeq.children) {
        extensions = extSeq.children;
        // Look for SAN extension (OID 2.5.29.17)
        const SAN_OID = new Uint8Array([0x55, 0x1d, 0x11]);
        for (const ext of extSeq.children) {
          if (ext.children && ext.children.length >= 2) {
            const extOid = ext.children[0];
            if (extOid.tag === ASN1_OID && oidsEqual(extOid.data, SAN_OID)) {
              const extValue = ext.children[ext.children.length - 1];
              subjectAltName = parseSAN(extValue.data);
            }
          }
        }
      }
    }
  }

  // Signature algorithm OID
  let sigAlg = 'unknown';
  if (signatureAlgorithm.children && signatureAlgorithm.children.length >= 1) {
    sigAlg = oidToName(signatureAlgorithm.children[0].data);
  }

  // Signature value
  const signature = signatureBitString.tag === ASN1_BIT_STRING
    ? signatureBitString.data.slice(1) // skip unused-bits byte
    : signatureBitString.data;

  return {
    raw: der,
    tbsCertificate: tbsCertificate.data,
    serialNumber,
    issuer,
    subject,
    validFrom,
    validTo,
    publicKey,
    publicKeyAlgorithm,
    signatureAlgorithm: sigAlg,
    signature,
    subjectAltName,
    extensions,
  };
}

// ---- Distinguished Name (DN) parsing ----

const OID_NAMES: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'emailAddress',
};

const SIG_ALG_NAMES: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
};

function decodeOidString(data: Uint8Array): string {
  if (data.length === 0) return '';
  const components: number[] = [];
  components.push(Math.floor(data[0] / 40));
  components.push(data[0] % 40);
  let value = 0;
  for (let i = 1; i < data.length; i++) {
    value = (value << 7) | (data[i] & 0x7f);
    if (!(data[i] & 0x80)) {
      components.push(value);
      value = 0;
    }
  }
  return components.join('.');
}

function oidToName(data: Uint8Array): string {
  const oidStr = decodeOidString(data);
  return SIG_ALG_NAMES[oidStr] || oidStr;
}

function parseDN(seq: DerValue): string {
  if (!seq.children) return '';
  const parts: string[] = [];
  for (const rdn of seq.children) {
    // Each RDN is a SET containing one or more SEQUENCE { OID, value }
    const rdnChildren = rdn.tag === 0x31 ? parseSequenceChildren(rdn.data) : (rdn.children || []);
    for (const atv of rdnChildren) {
      if (atv.children && atv.children.length >= 2) {
        const oidData = atv.children[0].data;
        const oidStr = decodeOidString(oidData);
        const name = OID_NAMES[oidStr] || oidStr;
        const valueBytes = atv.children[1].data;
        const value = new TextDecoder().decode(valueBytes);
        parts.push(`${name}=${value}`);
      }
    }
  }
  return parts.join(', ');
}

function parseAsn1Time(tlv: DerValue): Date {
  const str = new TextDecoder().decode(tlv.data);
  if (tlv.tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ
    let year = parseInt(str.substring(0, 2), 10);
    year = year >= 50 ? 1900 + year : 2000 + year;
    const month = parseInt(str.substring(2, 4), 10) - 1;
    const day = parseInt(str.substring(4, 6), 10);
    const hour = parseInt(str.substring(6, 8), 10);
    const minute = parseInt(str.substring(8, 10), 10);
    const second = parseInt(str.substring(10, 12), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
  if (tlv.tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMMSSZ
    const year = parseInt(str.substring(0, 4), 10);
    const month = parseInt(str.substring(4, 6), 10) - 1;
    const day = parseInt(str.substring(6, 8), 10);
    const hour = parseInt(str.substring(8, 10), 10);
    const minute = parseInt(str.substring(10, 12), 10);
    const second = parseInt(str.substring(12, 14), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
  throw new Error(`Unsupported time tag: 0x${tlv.tag.toString(16)}`);
}

function parseSAN(data: Uint8Array): string[] {
  const names: string[] = [];
  try {
    const seq = parseDer(data);
    if (seq.tag === ASN1_SEQUENCE && seq.children) {
      for (const child of seq.children) {
        // context-specific tags: [2] = dNSName, [7] = iPAddress
        if (child.tag === 0x82) {
          // dNSName
          names.push('DNS:' + new TextDecoder().decode(child.data));
        } else if (child.tag === 0x87) {
          // iPAddress
          if (child.data.length === 4) {
            names.push('IP Address:' + child.data.join('.'));
          } else if (child.data.length === 16) {
            const parts: string[] = [];
            for (let i = 0; i < 16; i += 2) {
              parts.push(((child.data[i] << 8) | child.data[i + 1]).toString(16));
            }
            names.push('IP Address:' + parts.join(':'));
          }
        }
      }
    }
  } catch {
    // Parse error in SAN — return empty
  }
  return names;
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
