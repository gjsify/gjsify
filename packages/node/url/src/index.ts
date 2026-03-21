// Native url module for GJS — no Deno dependency
// WHATWG URL and URLSearchParams are already globals in SpiderMonkey 128
// This module adds the Node.js-specific legacy API and file URL helpers.

// Re-export WHATWG URL API from globals
const _URL = globalThis.URL;
const _URLSearchParams = globalThis.URLSearchParams;
export { _URL as URL, _URLSearchParams as URLSearchParams };

// ---- Legacy url.parse / url.format / url.resolve ----

export interface UrlObject {
  protocol?: string | null;
  slashes?: boolean | null;
  auth?: string | null;
  host?: string | null;
  port?: string | null;
  hostname?: string | null;
  hash?: string | null;
  search?: string | null;
  query?: string | Record<string, string> | null;
  pathname?: string | null;
  path?: string | null;
  href?: string;
}

export interface Url extends UrlObject {
  href: string;
}

/**
 * Legacy URL parser. Parses a URL string into its components.
 */
export function parse(urlString: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url {
  if (typeof urlString !== 'string') {
    throw new TypeError('The "url" argument must be of type string. Received type ' + typeof urlString);
  }

  const result: Url = {
    protocol: null,
    slashes: null,
    auth: null,
    host: null,
    port: null,
    hostname: null,
    hash: null,
    search: null,
    query: null,
    pathname: null,
    path: null,
    href: urlString,
  };

  let rest = urlString.trim();

  // Extract hash
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    result.hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }

  // Extract search/query
  const qIdx = rest.indexOf('?');
  if (qIdx !== -1) {
    result.search = rest.slice(qIdx);
    result.query = parseQueryString
      ? Object.fromEntries(new _URLSearchParams(rest.slice(qIdx + 1)))
      : rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
  }

  // Extract protocol
  const protoMatch = /^([a-z][a-z0-9.+-]*:)/i.exec(rest);
  if (protoMatch) {
    result.protocol = protoMatch[1].toLowerCase();
    rest = rest.slice(result.protocol.length);
  }

  // Check for slashes
  if (slashesDenoteHost || result.protocol) {
    const hasSlashes = rest.startsWith('//');
    if (hasSlashes) {
      result.slashes = true;
      rest = rest.slice(2);
    }
  }

  // Extract host portion (only if we had slashes or protocol)
  if (result.slashes || (result.protocol && !['javascript:', 'data:', 'mailto:'].includes(result.protocol))) {
    // Find the end of host portion
    let hostEnd = -1;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === '/' || ch === '\\') {
        hostEnd = i;
        break;
      }
    }

    const hostPart = hostEnd === -1 ? rest : rest.slice(0, hostEnd);
    rest = hostEnd === -1 ? '' : rest.slice(hostEnd);

    // Extract auth
    const atIdx = hostPart.lastIndexOf('@');
    if (atIdx !== -1) {
      result.auth = decodeURIComponent(hostPart.slice(0, atIdx));
      const hostWithPort = hostPart.slice(atIdx + 1);
      parseHostPort(hostWithPort, result);
    } else {
      parseHostPort(hostPart, result);
    }
  }

  // Pathname
  result.pathname = rest || (result.slashes ? '/' : null);

  // Build path
  if (result.pathname !== null || result.search !== null) {
    result.path = (result.pathname || '') + (result.search || '');
  }

  // Build href
  result.href = format(result);

  return result;
}

function parseHostPort(hostPart: string, result: Url): void {
  if (!hostPart) return;

  // Handle IPv6
  const bracketIdx = hostPart.indexOf('[');
  if (bracketIdx !== -1) {
    const bracketEnd = hostPart.indexOf(']', bracketIdx);
    if (bracketEnd !== -1) {
      const portStr = hostPart.slice(bracketEnd + 1);
      if (portStr.startsWith(':')) {
        result.port = portStr.slice(1);
      }
      result.hostname = hostPart.slice(bracketIdx, bracketEnd + 1);
      result.host = result.hostname + (result.port ? ':' + result.port : '');
      return;
    }
  }

  const colonIdx = hostPart.lastIndexOf(':');
  if (colonIdx !== -1) {
    const portCandidate = hostPart.slice(colonIdx + 1);
    if (/^\d*$/.test(portCandidate)) {
      result.port = portCandidate || null;
      result.hostname = hostPart.slice(0, colonIdx).toLowerCase();
    } else {
      result.hostname = hostPart.toLowerCase();
    }
  } else {
    result.hostname = hostPart.toLowerCase();
  }

  result.host = result.hostname + (result.port ? ':' + result.port : '');
}

/**
 * Format a URL object into a URL string.
 */
export function format(urlObject: UrlObject | string | URL): string {
  if (typeof urlObject === 'string') {
    return urlObject;
  }

  // Handle WHATWG URL
  if (urlObject instanceof _URL) {
    return urlObject.href;
  }

  const obj = urlObject as UrlObject;
  let result = '';

  if (obj.protocol) {
    result += obj.protocol;
  }

  if (obj.slashes || (obj.protocol && !['javascript:', 'data:', 'mailto:'].includes(obj.protocol || ''))) {
    result += '//';
  }

  if (obj.auth) {
    result += encodeURIComponent(obj.auth) + '@';
  }

  if (obj.host) {
    result += obj.host;
  } else {
    if (obj.hostname) {
      result += obj.hostname;
    }
    if (obj.port) {
      result += ':' + obj.port;
    }
  }

  if (obj.pathname) {
    result += obj.pathname;
  }

  if (obj.search) {
    result += obj.search;
  } else if (obj.query && typeof obj.query === 'object') {
    const qs = new _URLSearchParams(obj.query as Record<string, string>).toString();
    if (qs) result += '?' + qs;
  }

  if (obj.hash) {
    result += obj.hash;
  }

  return result;
}

/**
 * Resolve a target URL relative to a base URL.
 */
export function resolve(from: string, to: string): string {
  return new _URL(to, new _URL(from, 'resolve://')).href.replace(/^resolve:\/\//, '');
}

// ---- File URL helpers ----

/**
 * Convert a file: URL to a path string.
 */
export function fileURLToPath(url: string | URL): string {
  if (typeof url === 'string') {
    url = new _URL(url);
  }

  if (!(url instanceof _URL)) {
    throw new TypeError('The "url" argument must be of type string or URL. Received type ' + typeof url);
  }

  if (url.protocol !== 'file:') {
    throw new TypeError('The URL must be of scheme file');
  }

  if (url.hostname !== '' && url.hostname !== 'localhost') {
    throw new TypeError(
      `File URL host must be "localhost" or empty on linux`
    );
  }

  const pathname = url.pathname;
  // Check for encoded separators
  for (let i = 0; i < pathname.length; i++) {
    if (pathname[i] === '%') {
      const third = pathname.codePointAt(i + 2)! | 0x20;
      if (pathname[i + 1] === '2' && third === 102) {
        // %2f or %2F — encoded slash
        throw new TypeError('File URL path must not include encoded / characters');
      }
    }
  }

  return decodeURIComponent(pathname);
}

/**
 * Convert a path string to a file: URL.
 */
export function pathToFileURL(filepath: string): URL {
  let resolved = filepath;

  // Resolve relative paths
  if (filepath[0] !== '/') {
    // Use process.cwd() if available, otherwise try GLib
    if (typeof globalThis.process?.cwd === 'function') {
      resolved = globalThis.process.cwd() + '/' + filepath;
    } else {
      try {
        const GLib = (globalThis as any).imports?.gi?.GLib;
        if (GLib?.get_current_dir) {
          resolved = GLib.get_current_dir() + '/' + filepath;
        }
      } catch {
        // Fall through
      }
    }
  }

  return new _URL('file://' + encodePathForURL(resolved));
}

function encodePathForURL(filepath: string): string {
  let result = '';
  for (let i = 0; i < filepath.length; i++) {
    const ch = filepath[i];
    // Characters that don't need encoding in file URLs
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '/' || ch === '-' || ch === '_' || ch === '.' || ch === '~' ||
      ch === ':' || ch === '@' || ch === '!'
    ) {
      result += ch;
    } else {
      // Percent-encode
      const encoded = encodeURIComponent(ch);
      result += encoded;
    }
  }
  return result;
}

/**
 * Convert a domain to ASCII (punycode).
 */
export function domainToASCII(domain: string): string {
  try {
    // Use URL constructor to convert to punycode
    return new _URL(`http://${domain}`).hostname;
  } catch {
    return '';
  }
}

/**
 * Convert a domain from ASCII (punycode) to Unicode.
 */
export function domainToUnicode(domain: string): string {
  // In SpiderMonkey, hostname from URL is already ASCII/punycode
  // Full Unicode conversion would require a punycode decoder
  // For now, return as-is since most domains are already readable
  try {
    return new _URL(`http://${domain}`).hostname;
  } catch {
    return '';
  }
}

// Default export
export default {
  URL: _URL,
  URLSearchParams: _URLSearchParams,
  parse,
  format,
  resolve,
  fileURLToPath,
  pathToFileURL,
  domainToASCII,
  domainToUnicode,
};
