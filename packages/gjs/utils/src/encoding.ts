// Shared encoding normalization utilities.
// Used by buffer, string_decoder, crypto, and other packages that deal with encodings.

/** Canonical encoding names (matches BufferEncoding from @types/node). */
export type Encoding = 'utf8' | 'ascii' | 'latin1' | 'base64' | 'base64url' | 'hex' | 'utf16le' | 'binary' | 'ucs2' | 'ucs-2' | 'utf-8';

const VALID_ENCODINGS = ['utf8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'ucs2', 'utf16le'];

/**
 * Normalize an encoding string to a canonical encoding value.
 * Returns 'utf8' as default for undefined/null/empty input.
 */
export function normalizeEncoding(enc?: string): Encoding {
  if (!enc || enc === 'utf8' || enc === 'utf-8') return 'utf8';
  const lower = ('' + enc).toLowerCase().replace(/-/g, '');
  switch (lower) {
    case 'utf8': return 'utf8';
    case 'ascii': return 'ascii';
    case 'latin1': case 'binary': return 'latin1';
    case 'base64': return 'base64';
    case 'base64url': return 'base64url';
    case 'hex': return 'hex';
    case 'ucs2': case 'utf16le': return 'utf16le';
    default: return 'utf8';
  }
}

/**
 * Check that an encoding string is valid. Throws TypeError if not.
 */
export function checkEncoding(encoding: string): void {
  const lower = ('' + encoding).toLowerCase().replace(/-/g, '');
  if (!VALID_ENCODINGS.includes(lower)) {
    throw new TypeError(`Unknown encoding: ${encoding}`);
  }
}
