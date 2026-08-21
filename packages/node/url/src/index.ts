// Node.js url module for GJS
// Uses GLib.Uri for WHATWG URL parsing since globalThis.URL is not available in GJS 1.86
// See refs/deno/ext/node/polyfills/url.ts, refs/bun/src/js/node/url.ts, refs/node/lib/url.js

import GLib from '@girs/glib-2.0';
// `/core` — the pure half. `path-shape` owns the ONE path↔`file://` conversion in the tree,
// so `@gjsify/fetch` building a base URL and `pathToFileURL` here cannot drift apart (#1143).
import { hostOs, isWin32, isWindowsPath, pathToFileUrlHref } from '@gjsify/utils/core';

const PARSE_FLAGS = GLib.UriFlags.HAS_PASSWORD | GLib.UriFlags.ENCODED | GLib.UriFlags.SCHEME_NORMALIZE;

/**
 * Should a path be read as win32 when the caller did not say?
 *
 * The HOST decides wherever the host can be identified — that is Node's rule and keeping it
 * means `pathToFileURL('C:/x')` on Linux stays relative-to-CWD there, as Node has it, rather
 * than being promoted to a drive path because a directory happens to be called `C:`.
 *
 * Where the host CANNOT be identified, the path's own shape is the only evidence there is.
 * That case is real and is not an edge: `hostPlatform()` reads the `process` global that
 * `@gjsify/process` installs, and a GJS bundle built without the node globals has none — so a
 * host-only reading would answer "not Windows" on win32 and reintroduce #1143. `hostOs()`
 * returns `undefined` there precisely so a caller can tell "unknown" from "POSIX" instead of
 * collapsing the two.
 */
function platformOrShapeIsWindows(filepath: string): boolean {
    return hostOs() === undefined ? isWindowsPath(filepath) : isWin32();
}

/**
 * The WHATWG "update steps", keyed by the params object the owning {@link URL} installed them on.
 *
 * The spec makes `url.searchParams` a LIVE view: mutating it re-serialises the list back into the
 * URL's query. Without this the two drifted — the params object was correct and `url.href` silently
 * kept the query it was parsed with, so a URL built the ordinary way (`new URL(base);
 * u.searchParams.set(...)`) serialised with NO query string at all. On Node the same code produced
 * the full URL, so nothing failed locally; the request just went out unfiltered.
 *
 * A WeakMap and not a property, so it cannot be enumerated (`Object.keys(params)` must be `[]`, as
 * on Node), cannot be carried to another object by `Object.assign`, and cannot be switched off by
 * assigning over it.
 */
const UPDATE_STEPS = new WeakMap<URLSearchParams, () => void>();

export class URLSearchParams {
    _entries: [string, string][] = [];

    constructor(init?: string | Record<string, string> | [string, string][] | URLSearchParams) {
        if (!init) return;
        if (typeof init === 'string') {
            const s = init.startsWith('?') ? init.slice(1) : init;
            if (s) {
                for (const pair of s.split('&')) {
                    // "If bytes is the empty byte sequence, then continue." A trailing or doubled
                    // `&` is ordinary in real query strings, and inventing a nameless empty
                    // parameter for it used to be invisible — it only polluted the params object.
                    // Now that mutations write back, that invention lands in `href`: one no-op
                    // `delete()` on `?type=release&` turned it into `?type=release&=`.
                    if (pair === '') continue;
                    const eqIdx = pair.indexOf('=');
                    if (eqIdx === -1) {
                        this._entries.push([decodeComponent(pair), '']);
                    } else {
                        this._entries.push([
                            decodeComponent(pair.slice(0, eqIdx)),
                            decodeComponent(pair.slice(eqIdx + 1)),
                        ]);
                    }
                }
            }
        } else if (Array.isArray(init)) {
            for (const [k, v] of init) {
                this._entries.push([String(k), String(v)]);
            }
        } else if (init instanceof URLSearchParams) {
            this._entries = init._entries.map(([k, v]) => [k, v] as [string, string]);
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
                if (!found) {
                    found = true;
                    return true;
                }
                return false;
            }
            return true;
        });
        if (found) {
            for (let i = 0; i < this._entries.length; i++) {
                if (this._entries[i][0] === name) {
                    this._entries[i][1] = value;
                    break;
                }
            }
        } else {
            this._entries.push([name, value]);
        }
        UPDATE_STEPS.get(this)?.();
    }

    has(name: string, value?: string): boolean {
        if (value === undefined) return this._entries.some(([k]) => k === name);
        return this._entries.some(([k, v]) => k === name && v === value);
    }

    /**
     * The `value` argument is not optional decoration: ignoring it silently — as this did — turns
     * `delete('a', '1')` on `?a=1&a=2` into "delete every a", and with the update steps in place
     * that wipes the whole query out of `href` instead of leaving `?a=2`.
     */
    delete(name: string, value?: string): void {
        this._entries =
            value === undefined
                ? this._entries.filter(([k]) => k !== name)
                : this._entries.filter(([k, v]) => !(k === name && v === value));
        UPDATE_STEPS.get(this)?.();
    }

    append(name: string, value: string): void {
        this._entries.push([name, value]);
        UPDATE_STEPS.get(this)?.();
    }

    sort(): void {
        this._entries.sort((a, b) => {
            if (a[0] < b[0]) return -1;
            if (a[0] > b[0]) return 1;
            return 0;
        });
        UPDATE_STEPS.get(this)?.();
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
    try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
        return s;
    }
}

/**
 * Percent-encode one code point as UTF-8.
 *
 * Iterating by code point rather than by UTF-16 unit is what makes a lone surrogate survivable:
 * `TextEncoder` maps one to U+FFFD, exactly as Node does, where `encodeURIComponent` throws
 * `URIError` instead.
 */
function percentEncodeUtf8(ch: string): string {
    let out = '';
    for (const b of new TextEncoder().encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    return out;
}

/**
 * The `application/x-www-form-urlencoded` serializer.
 *
 * Only `A-Za-z0-9 * - . _` stay literal and a space becomes `+`. `encodeURIComponent` is NOT that
 * set — it also leaves `!`, `~`, `'`, `(` and `)` alone, which is a wire-format difference for
 * anything that canonicalises and signs a query — and, worse, it THROWS on a lone surrogate. That
 * throw happens inside the update steps, i.e. after `_entries` has already changed, leaving the
 * params object ahead of `href` and every later mutation throwing too: precisely the drift the
 * update steps exist to prevent, reintroduced by one truncated emoji.
 */
function encodeComponent(s: string): string {
    let out = '';
    for (const ch of s) {
        if (ch === ' ') out += '+';
        else if (/^[A-Za-z0-9*\-._]$/.test(ch)) out += ch;
        else out += percentEncodeUtf8(ch);
    }
    return out;
}

/** Schemes whose query percent-encode set also covers `'`. */
const SPECIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:']);

/**
 * The WHATWG query percent-encode set: C0 controls, everything above `~`, and `space " # < >` —
 * plus `'` for special schemes.
 *
 * `#` is the one that matters. Assigning a query containing it without encoding lets it escape into
 * the fragment, so `u.search = 'q=C#&lang=de'` produces a URL that re-parses as a DIFFERENT url —
 * `q=C`, no `lang`, and the rest swallowed as a fragment. A raw space is not even a legal HTTP
 * request target, and `@gjsify/http` builds one straight from `pathname + search`.
 */
function encodeQuery(query: string, special: boolean): string {
    let out = '';
    for (const ch of query) {
        const cp = ch.codePointAt(0)!;
        const encode =
            cp <= 0x20 || cp > 0x7e || ch === '"' || ch === '#' || ch === '<' || ch === '>' || (special && ch === "'");
        out += encode ? percentEncodeUtf8(ch) : ch;
    }
    return out;
}

export class URL {
    #uri: GLib.Uri;
    #searchParams: URLSearchParams;
    /**
     * The URL's query, shadowing `GLib.Uri`'s.
     *
     * `GLib.Uri` is immutable, so the query cannot live there once it can change. Parsing keeps
     * the RAW query — re-serialising it through URLSearchParams would re-encode a URL nobody
     * asked to modify — and a mutation replaces it with the serialised parameter list. That is
     * exactly what the WHATWG algorithm does, and it is why `new URL(s).href === s` still holds
     * for a URL that is only read.
     */
    #query: string | null;

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
        } catch (_e: unknown) {
            throw new TypeError(`Invalid URL: ${urlStr}`);
        }

        if (!this.#uri) {
            throw new TypeError(`Invalid URL: ${urlStr}`);
        }

        this.#query = this.#uri.get_query() ?? null;
        this.#searchParams = new URLSearchParams(this.#query || '');
        UPDATE_STEPS.set(this.#searchParams, () => {
            // "If query is the empty string, then set url's query to null" — so removing the last
            // parameter takes the `?` with it.
            const serialised = this.#searchParams.toString();
            this.#query = serialised === '' ? null : serialised;
        });
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
        return this.#query ? '?' + this.#query : '';
    }

    /**
     * Replace the whole query.
     *
     * A setter and not merely a getter: assigning `url.search` is how Node code sets a query in
     * one go, and without it the obvious workaround for the missing write-back — building a
     * string and assigning it — threw `TypeError: setting getter-only property`, leaving no way
     * to put a query on a URL at all.
     *
     * The existing `searchParams` object is refilled in place rather than replaced, because the
     * spec makes it a stable identity: code that captured `const p = url.searchParams` before
     * the assignment must still see the new values.
     */
    set search(value: string) {
        // The spec's steps, and each one earns its line:
        //   - `search` is a non-nullable USVString, so `null` stringifies to "null" rather than
        //     clearing the query. Being helpful here is a silent divergence from Node.
        //   - the empty string sets the query to null (no `?`); a bare "?" sets it to the EMPTY
        //     query, which still serialises as `?`. Three states, not two.
        //   - ASCII tab and newline are removed, then the rest is run through the query
        //     percent-encode set. Without that, an assigned `#` escapes into the fragment.
        // `_entries` is filled from the UNENCODED text, so `get()` keeps returning decoded values,
        // and refilled IN PLACE because the spec makes `searchParams`' identity stable.
        const stripped = String(value).replace(/[\t\n\r]/g, '');
        if (stripped === '') {
            this.#query = null;
            this.#searchParams._entries = [];
            return;
        }
        const query = stripped.startsWith('?') ? stripped.slice(1) : stripped;
        this.#query = encodeQuery(query, SPECIAL_SCHEMES.has(this.protocol));
        this.#searchParams._entries = new URLSearchParams(query)._entries;
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
        const isSpecial =
            scheme === 'http' ||
            scheme === 'https' ||
            scheme === 'ftp' ||
            scheme === 'file' ||
            scheme === 'ws' ||
            scheme === 'wss';

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

        // NOT `this.search`: the getter answers '' for both a null and an empty query, but only
        // one of them drops the `?` from the URL.
        result += this.#query === null ? '' : `?${this.#query}`;
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

    //
    // Consumers like Excalibur.js do `const src = URL.createObjectURL(blob);
    // image.src = src;`. For that to work on GJS we need `src` to be a path
    // `HTMLImageElement` / `HTMLAudioElement` / `FontFace` can actually read —
    // i.e. a `file://` URL. We implement this as a static method on our own
    // URL class (no globalThis monkey-patching):
    //
    //   - Fast path: if the Blob already carries a `_tmpPath` (e.g. written
    //     by `@gjsify/fetch` XHR when `responseType='blob'`), wrap it as
    //     `file://<_tmpPath>`.
    //   - Slow path: if the Blob has `arrayBuffer()`/bytes but no `_tmpPath`,
    //     materialise the bytes into a GLib temp file and wrap that. This
    //     path is async in the spec — but W3C `createObjectURL` is sync. We
    //     read the bytes via `GLib.Bytes`-style synchronous access when
    //     possible and fall back to a sentinel if not.
    //
    // Reference: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL

    static _objectURLPaths = new Map<string, string>();
    static _objectURLCounter = 0;

    static createObjectURL(blob: { _tmpPath?: string; type?: string; size?: number }): string {
        const tmp = blob?._tmpPath;
        if (typeof tmp === 'string' && tmp.length > 0) {
            const url = `file://${tmp}`;
            URL._objectURLPaths.set(url, tmp);
            return url;
        }
        // No backing file — cannot hand this to GdkPixbuf / Gst / GLib. Surface
        // a clear sentinel so callers fail fast instead of silently loading a
        // phantom resource.
        return 'file:///dev/null';
    }

    static revokeObjectURL(url: string): void {
        const path = URL._objectURLPaths.get(url);
        if (!path) return;
        // Best-effort temp-file cleanup — GLib.unlink reports failure via its
        // return value (-1); it has no throw path (no `throws` in the GIR).
        GLib.unlink(path);
        URL._objectURLPaths.delete(url);
    }
}

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

/**
 * @param options.windows read the URL as naming a win32 path — Node's own escape hatch
 *   (`refs/node/lib/internal/url.js`), and the only way to ask for the non-host answer from
 *   a POSIX runner. Defaults to the host.
 */
export function fileURLToPath(url: string | URL, options?: { windows?: boolean }): string {
    if (typeof url === 'string') {
        url = new URL(url);
    }

    if (!(url instanceof URL)) {
        throw new TypeError('The "url" argument must be of type string or URL. Received type ' + typeof url);
    }

    if (url.protocol !== 'file:') {
        throw new TypeError('The URL must be of scheme file');
    }

    const pathname = url.pathname;
    // The shape probe reads the pathname RAW. Decoding first would move the `URIError` a
    // malformed `%` sequence raises ahead of the encoded-separator check below, changing which
    // error a caller sees for `file:///a%2Fb%ZZ`; and a drive letter is never percent-encoded,
    // so there is nothing to decode for this question anyway.
    const windows = options?.windows ?? platformOrShapeIsWindows(pathname.slice(1));

    // An encoded separator would decode into one MORE path component than the URL names, so
    // it is refused before anything is decoded. Node's rule is ASYMMETRIC and both halves are
    // measured against it: win32 refuses `%2F` AND `%5C` (both are separators there) under one
    // message, while POSIX refuses only `%2F` and reads `%5C` as an ordinary character in a
    // filename (`refs/node/lib/internal/url.js`).
    for (let i = 0; i < pathname.length; i++) {
        if (pathname[i] !== '%') continue;
        const third = pathname.codePointAt(i + 2)! | 0x20;
        const encodedSlash = pathname[i + 1] === '2' && third === 102;
        const encodedBackslash = pathname[i + 1] === '5' && third === 99;
        if (windows && (encodedSlash || encodedBackslash)) {
            throw new TypeError('File URL path must not include encoded \\ or / characters');
        }
        if (encodedSlash) {
            throw new TypeError('File URL path must not include encoded / characters');
        }
    }

    // A UNC path is the one shape where a file URL legitimately HAS a host, and it only means
    // that on win32. The message named `linux` unconditionally while the check refused UNC on
    // every platform (#1143).
    if (url.hostname !== '' && url.hostname !== 'localhost') {
        if (!windows) {
            throw new TypeError(`File URL host must be "localhost" or empty on ${hostOs() ?? 'this platform'}`);
        }
        return `\\\\${url.hostname}${decodeURIComponent(pathname).replace(/\//g, '\\')}`;
    }

    if (windows) {
        // `/C:/app/dist` → `C:\app\dist`: the leading slash is the URL's empty host, not part
        // of the path.
        const decoded = decodeURIComponent(pathname);
        if (/^\/[A-Za-z]:/.test(decoded)) return decoded.slice(1).replace(/\//g, '\\');
        return decoded.replace(/\//g, '\\');
    }

    return decodeURIComponent(pathname);
}

/**
 * @param options.windows treat `filepath` as a win32 path even where the host is not — Node's
 *   own escape hatch (`refs/node/lib/internal/url.js`), and how the win32 behaviour is checked
 *   from the Linux runner CI actually has (#1143).
 *
 * Not yet at Node parity: Node runs `path.win32.resolve()` first, so a RELATIVE path gets the
 * current drive. Here a relative path is still joined to the CWD with `/`. Recorded in
 * `status/open-todos.md` rather than half-done.
 */
export function pathToFileURL(filepath: string, options?: { windows?: boolean }): URL {
    const windows = options?.windows ?? platformOrShapeIsWindows(filepath);
    let resolved = filepath;

    // Absoluteness is a per-platform question: `filepath[0] !== '/'` called every win32
    // absolute path relative and prepended the CWD to it (#1143).
    const absolute = windows ? isWindowsPath(filepath) || filepath.startsWith('/') : filepath.startsWith('/');
    if (!absolute) {
        if (typeof globalThis.process?.cwd === 'function') {
            resolved = globalThis.process.cwd() + '/' + filepath;
        } else if (GLib?.get_current_dir) {
            // g_get_current_dir has no throw path (no `throws` in the GIR);
            // the presence guard covers non-GJS builds where GLib is stubbed.
            resolved = GLib.get_current_dir() + '/' + filepath;
        }
    }

    return new URL(pathToFileUrlHref(resolved, { windows }));
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
