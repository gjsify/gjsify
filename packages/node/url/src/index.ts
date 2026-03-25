// Node.js url module for GJS
// Uses GLib.Uri for WHATWG URL parsing since globalThis.URL is not available in GJS 1.86
// See refs/deno/ext/node/polyfills/url.ts, refs/bun/src/js/node/url.ts, refs/node/lib/url.js

import GLib from '@girs/glib-2.0';

// ---- URLSearchParams ----

const PARSE_FLAGS = GLib.UriFlags.HAS_PASSWORD | GLib.UriFlags.ENCODED | GLib.UriFlags.SCHEME_NORMALIZE;

export class URLSearchParams {
  _entries: [string, string][] = [];

  constructor(init?: string | Record<string, string> | [string, string][] | URLSearchParams) {
    if (!init) return;
    if (typeof init === 'string') {
      const s = init.startsWith('?') ? init.slice(1) : init;
      if (s) {
        for (const pair of s.split('&')) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx === -1) {
            this._entries.push([decodeComponent(pair), '']);
          } else {
            this._entries.push([decodeComponent(pair.slice(0, eqIdx)), decodeComponent(pair.slice(eqIdx + 1))]);
          }
        }
      }
    } else if (Array.isArray(init)) {
      for (const [k, v] of init) {
        this._entries.push([String(k), String(v)]);
      }
    } else if (init instanceof URLSearchParams) {
      this._entries = init._entries.slice();
    } else {
      for (const key of Object.keys(init)) {
        this._entries.push([key, String(init[key])]);
      }
    }
  }

  get(name: string): string | null {
    for (const [k, v] of this._entries) {
      if (k === name) return v;
    }
    return null;
  }

  getAll(name: string): string[] {
    return this._entries.filter(([k]) => k === name).map(([, v]) => v);
  }

  set(name: string, value: string): void {
    let found = false;
    this._entries = this._entries.filter(([k]) => {
      if (k === name) {
        if (!found) { found = true; return true; }
        return false;
      }
      return true;
    });
    if (found) {
      for (let i = 0; i < this._entries.length; i++) {
        if (this._entries[i][0] === name) { this._entries[i][1] = value; break; }
      }
    } else {
      this._entries.push([name, value]);
    }
  }

  has(name: string): boolean {
    return this._entries.some(([k]) => k === name);
  }

  delete(name: string): void {
    this._entries = this._entries.filter(([k]) => k !== name);
  }

  append(name: string, value: string): void {
    this._entries.push([name, value]);
  }

  toString(): string {
    return this._entries.map(([k, v]) => encodeComponent(k) + '=' + encodeComponent(v)).join('&');
  }

  forEach(callback: (value: string, key: string, parent: URLSearchParams) => void): void {
    for (const [k, v] of this._entries) {
      callback(v, k, this);
    }
  }

  *entries(): IterableIterator<[string, string]> {
    yield* this._entries;
  }

  *keys(): IterableIterator<string> {
    for (const [k] of this._entries) yield k;
  }

  *values(): IterableIterator<string> {
    for (const [, v] of this._entries) yield v;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  get size(): number {
    return this._entries.length;
  }
}

function decodeComponent(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

function encodeComponent(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '+');
}

// ---- URL class using GLib.Uri ----

export class URL {
  #uri: any; // GLib.Uri
  #searchParams: URLSearchParams;

  constructor(url: string | URL, base?: string | URL) {
    const urlStr = url instanceof URL ? url.href : String(url);

    try {
      if (base !== undefined) {
        const baseStr = base instanceof URL ? base.href : String(base);
        const baseUri = GLib.Uri.parse(baseStr, PARSE_FLAGS);
        this.#uri = baseUri.parse_relative(urlStr, PARSE_FLAGS);
      } else {
        this.#uri = GLib.Uri.parse(urlStr, PARSE_FLAGS);
      }
    } catch (e: any) {
      throw new TypeError(`Invalid URL: ${urlStr}`);
    }

    if (!this.#uri) {
      throw new TypeError(`Invalid URL: ${urlStr}`);
    }

    this.#searchParams = new URLSearchParams(this.#uri.get_query() || '');
  }

  get protocol(): string {
    return this.#uri.get_scheme() + ':';
  }

  get hostname(): string {
    return (this.#uri.get_host() || '').toLowerCase();
  }

  get port(): string {
    const p = this.#uri.get_port();
    if (p === -1) return '';
    // WHATWG URL spec: port should be empty string for default ports
    const scheme = this.#uri.get_scheme();
    if ((scheme === 'http' || scheme === 'ws') && p === 80) return '';
    if ((scheme === 'https' || scheme === 'wss') && p === 443) return '';
    if (scheme === 'ftp' && p === 21) return '';
    return String(p);
  }

  get host(): string {
    const hostname = this.hostname;
    const port = this.port;
    return port ? `${hostname}:${port}` : hostname;
  }

  get pathname(): string {
    return this.#uri.get_path() || '/';
  }

  get search(): string {
    const q = this.#uri.get_query();
    return q ? '?' + q : '';
  }

  get hash(): string {
    const f = this.#uri.get_fragment();
    return f ? '#' + f : '';
  }

  get origin(): string {
    const p = this.protocol;
    if (p === 'http:' || p === 'https:' || p === 'ftp:') {
      return `${p}//${this.host}`;
    }
    return 'null';
  }

  get username(): string {
    return this.#uri.get_user() || '';
  }

  get password(): string {
    return this.#uri.get_password() || '';
  }

  get href(): string {
    let result = this.protocol;
    const scheme = this.#uri.get_scheme();
    const isSpecial = scheme === 'http' || scheme === 'https' || scheme === 'ftp' || scheme === 'file' || scheme === 'ws' || scheme === 'wss';

    if (isSpecial || this.hostname) {
      result += '//';
    }

    const user = this.username;
    const pass = this.password;
    if (user) {
      result += user;
      if (pass) result += ':' + pass;
      result += '@';
    }

    result += this.hostname;
    if (this.port) result += ':' + this.port;

    const pathname = this.pathname;
    result += pathname;

    result += this.search;
    result += this.hash;

    return result;
  }

  get searchParams(): URLSearchParams {
    return this.#searchParams;
  }

  toString(): string {
    return this.href;
  }

  toJSON(): string {
    return this.href;
  }
}

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
      ? Object.fromEntries(new URLSearchParams(rest.slice(qIdx + 1)))
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

    const atIdx = hostPart.lastIndexOf('@');
    if (atIdx !== -1) {
      result.auth = decodeURIComponent(hostPart.slice(0, atIdx));
      const hostWithPort = hostPart.slice(atIdx + 1);
      parseHostPort(hostWithPort, result);
    } else {
      parseHostPort(hostPart, result);
    }
  }

  result.pathname = rest || (result.slashes ? '/' : null);

  if (result.pathname !== null || result.search !== null) {
    result.path = (result.pathname || '') + (result.search || '');
  }

  result.href = format(result);

  return result;
}

function parseHostPort(hostPart: string, result: Url): void {
  if (!hostPart) return;

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

export function format(urlObject: UrlObject | string | URL): string {
  if (typeof urlObject === 'string') {
    return urlObject;
  }

  if (urlObject instanceof URL) {
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
    const qs = new URLSearchParams(obj.query as Record<string, string>).toString();
    if (qs) result += '?' + qs;
  }

  if (obj.hash) {
    result += obj.hash;
  }

  return result;
}

export function resolve(from: string, to: string): string {
  return new URL(to, new URL(from, 'resolve://')).href.replace(/^resolve:\/\//, '');
}

// ---- File URL helpers ----

export function fileURLToPath(url: string | URL): string {
  if (typeof url === 'string') {
    url = new URL(url);
  }

  if (!(url instanceof URL)) {
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
  for (let i = 0; i < pathname.length; i++) {
    if (pathname[i] === '%') {
      const third = pathname.codePointAt(i + 2)! | 0x20;
      if (pathname[i + 1] === '2' && third === 102) {
        throw new TypeError('File URL path must not include encoded / characters');
      }
    }
  }

  return decodeURIComponent(pathname);
}

export function pathToFileURL(filepath: string): URL {
  let resolved = filepath;

  if (filepath[0] !== '/') {
    if (typeof globalThis.process?.cwd === 'function') {
      resolved = globalThis.process.cwd() + '/' + filepath;
    } else {
      try {
        if (GLib?.get_current_dir) {
          resolved = GLib.get_current_dir() + '/' + filepath;
        }
      } catch {
        // Fall through
      }
    }
  }

  return new URL('file://' + encodePathForURL(resolved));
}

function encodePathForURL(filepath: string): string {
  let result = '';
  for (let i = 0; i < filepath.length; i++) {
    const ch = filepath[i];
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '/' || ch === '-' || ch === '_' || ch === '.' || ch === '~' ||
      ch === ':' || ch === '@' || ch === '!'
    ) {
      result += ch;
    } else {
      result += encodeURIComponent(ch);
    }
  }
  return result;
}

export function domainToASCII(domain: string): string {
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return '';
  }
}

export function domainToUnicode(domain: string): string {
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return '';
  }
}

// Default export
export default {
  URL,
  URLSearchParams,
  parse,
  format,
  resolve,
  fileURLToPath,
  pathToFileURL,
  domainToASCII,
  domainToUnicode,
};
