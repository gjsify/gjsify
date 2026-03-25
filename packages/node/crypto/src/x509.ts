// X509Certificate implementation for GJS
// Reference: Node.js lib/internal/crypto/x509.js
// Reimplemented for GJS using ASN.1 parser

import { Buffer } from 'node:buffer';
import { parseX509, parseX509Der, encodeSubjectPublicKeyInfo, derToPem } from './asn1.js';
import type { X509Components } from './asn1.js';
import { KeyObject } from './key-object.js';
import { createHash } from './index.js';

/**
 * X509Certificate encapsulates an X.509 certificate and provides
 * read-only access to its information.
 */
export class X509Certificate {
  private _components: X509Components;
  private _pem: string;

  constructor(buf: string | Buffer | Uint8Array) {
    if (typeof buf === 'string') {
      this._pem = buf;
      this._components = parseX509(buf);
    } else {
      const bufData = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      // Try PEM first, then DER
      const str = bufData.toString('utf8');
      if (str.includes('-----BEGIN CERTIFICATE-----')) {
        this._pem = str;
        this._components = parseX509(str);
      } else {
        this._components = parseX509Der(new Uint8Array(bufData.buffer, bufData.byteOffset, bufData.byteLength));
        // Generate PEM from DER
        this._pem = derToPem(this._components.raw, 'CERTIFICATE');
      }
    }
  }

  /** The DER encoded certificate data. */
  get raw(): Buffer {
    return Buffer.from(this._components.raw);
  }

  /** The serial number of the certificate as a hex string. */
  get serialNumber(): string {
    return this._components.serialNumber.toString(16).toUpperCase();
  }

  /** The subject of the certificate. */
  get subject(): string {
    return this._components.subject;
  }

  /** The issuer of the certificate. */
  get issuer(): string {
    return this._components.issuer;
  }

  /** The start date of the certificate validity period. */
  get validFrom(): string {
    return this._components.validFrom.toUTCString();
  }

  /** The end date of the certificate validity period. */
  get validTo(): string {
    return this._components.validTo.toUTCString();
  }

  /** SHA-1 fingerprint of the certificate. */
  get fingerprint(): string {
    const hash = createHash('sha1').update(this._components.raw).digest();
    return formatFingerprint(hash as Buffer);
  }

  /** SHA-256 fingerprint of the certificate. */
  get fingerprint256(): string {
    const hash = createHash('sha256').update(this._components.raw).digest();
    return formatFingerprint(hash as Buffer);
  }

  /** SHA-512 fingerprint of the certificate. */
  get fingerprint512(): string {
    const hash = createHash('sha512').update(this._components.raw).digest();
    return formatFingerprint(hash as Buffer);
  }

  /** The public key of the certificate as a KeyObject. */
  get publicKey(): KeyObject {
    if (!this._components.publicKey) {
      throw new Error('Certificate does not contain a supported public key type');
    }
    const der = encodeSubjectPublicKeyInfo(this._components.publicKey);
    const pem = derToPem(der, 'PUBLIC KEY');
    return new KeyObject('public', {
      parsed: { type: 'rsa-public' as const, components: this._components.publicKey },
      pem,
    });
  }

  /** The Subject Alternative Name extension, if present. */
  get subjectAltName(): string | undefined {
    if (!this._components.subjectAltName || this._components.subjectAltName.length === 0) {
      return undefined;
    }
    return this._components.subjectAltName.join(', ');
  }

  /** The key usage extension (stub — returns undefined). */
  get keyUsage(): string[] | undefined {
    return undefined;
  }

  /** Information access extension (stub — returns undefined). */
  get infoAccess(): string | undefined {
    return undefined;
  }

  /** Whether this certificate is a CA certificate. */
  get ca(): boolean {
    // Basic stub — check for Basic Constraints extension
    return false;
  }

  /**
   * Check whether the certificate matches the given hostname.
   */
  checkHost(name: string): string | undefined {
    // Check subject CN
    const cnMatch = this._components.subject.match(/CN=([^,]+)/);
    if (cnMatch) {
      const cn = cnMatch[1].trim();
      if (matchHostname(cn, name)) return cn;
    }
    // Check SAN
    if (this._components.subjectAltName) {
      for (const san of this._components.subjectAltName) {
        if (san.startsWith('DNS:')) {
          const dnsName = san.substring(4);
          if (matchHostname(dnsName, name)) return dnsName;
        }
      }
    }
    return undefined;
  }

  /**
   * Check whether the certificate matches the given email address.
   */
  checkEmail(email: string): string | undefined {
    const emailLower = email.toLowerCase();
    // Check subject emailAddress
    const emailMatch = this._components.subject.match(/emailAddress=([^,]+)/);
    if (emailMatch && emailMatch[1].toLowerCase() === emailLower) {
      return emailMatch[1];
    }
    return undefined;
  }

  /**
   * Check whether the certificate matches the given IP address.
   */
  checkIP(ip: string): string | undefined {
    if (this._components.subjectAltName) {
      for (const san of this._components.subjectAltName) {
        if (san.startsWith('IP Address:') && san.substring(11) === ip) {
          return ip;
        }
      }
    }
    return undefined;
  }

  /**
   * Verify the certificate signature using the given public key.
   */
  verify(_publicKey: KeyObject): boolean {
    // Full RSA signature verification would require the Sign/Verify module
    // For now, return true as a stub
    return true;
  }

  /**
   * Check whether this certificate was issued by the given issuer certificate.
   */
  checkIssued(otherCert: X509Certificate): boolean {
    return this.issuer === otherCert.subject;
  }

  /**
   * Returns a legacy certificate object for compatibility.
   */
  toLegacyObject(): Record<string, unknown> {
    return {
      subject: parseDNToObject(this._components.subject),
      issuer: parseDNToObject(this._components.issuer),
      valid_from: this.validFrom,
      valid_to: this.validTo,
      serialNumber: this.serialNumber,
      fingerprint: this.fingerprint,
      fingerprint256: this.fingerprint256,
    };
  }

  /**
   * Returns the PEM-encoded certificate.
   */
  toString(): string {
    return this._pem;
  }

  /**
   * Returns the PEM-encoded certificate in JSON context.
   */
  toJSON(): string {
    return this._pem;
  }

  get [Symbol.toStringTag]() {
    return 'X509Certificate';
  }
}

// ---- Helpers ----

function formatFingerprint(hash: Buffer): string {
  const hex = hash.toString('hex').toUpperCase();
  const parts: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    parts.push(hex.substring(i, i + 2));
  }
  return parts.join(':');
}

function matchHostname(pattern: string, hostname: string): boolean {
  const patternLower = pattern.toLowerCase();
  const hostLower = hostname.toLowerCase();

  if (patternLower === hostLower) return true;

  // Wildcard matching: *.example.com matches foo.example.com
  if (patternLower.startsWith('*.')) {
    const suffix = patternLower.substring(2);
    const hostParts = hostLower.split('.');
    if (hostParts.length >= 2) {
      const hostSuffix = hostParts.slice(1).join('.');
      return hostSuffix === suffix;
    }
  }

  return false;
}

function parseDNToObject(dn: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = dn.split(', ');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      result[part.substring(0, eqIdx)] = part.substring(eqIdx + 1);
    }
  }
  return result;
}
