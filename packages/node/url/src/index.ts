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
            // The `?` strip belongs to the CONSTRUCTOR, not to the parser — see
            // {@link parseFormUrlencoded}.
            this._entries = parseFormUrlencoded(init.startsWith('?') ? init.slice(1) : init);
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

/**
 * The `application/x-www-form-urlencoded` PARSER, over text that has already had any leading `?`
 * removed by the caller.
 *
 * Keeping the strip out of here is the whole point. It belongs to the `URLSearchParams`
 * constructor — "if init starts with U+003F (?), remove the first code point" — and to nothing
 * else. The `search` setter has already removed its own single leading `?` by the time it fills
 * the params list, so routing that text back through the constructor stripped a SECOND one:
 * `url.search = '??a=b'` serialised the query correctly as `??a=b` while the params object
 * recorded the name `a` instead of `?a`. The two then disagreed, and because the update steps
 * write the params list back, the next `append()` on that object would have replaced the correct
 * query with the wrong one — the #1245 drift, re-entered through the new setter.
 */
function parseFormUrlencoded(input: string): [string, string][] {
    const entries: [string, string][] = [];
    if (!input) return entries;
    for (const pair of input.split('&')) {
        // "If bytes is the empty byte sequence, then continue." A trailing or doubled `&` is
        // ordinary in real query strings, and inventing a nameless empty parameter for it used to
        // be invisible — it only polluted the params object. Now that mutations write back, that
        // invention lands in `href`: one no-op `delete()` on `?type=release&` turned it into
        // `?type=release&=`.
        if (pair === '') continue;
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
            entries.push([decodeComponent(pair), '']);
        } else {
            entries.push([decodeComponent(pair.slice(0, eqIdx)), decodeComponent(pair.slice(eqIdx + 1))]);
        }
    }
    return entries;
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

/**
 * The WHATWG "special scheme" table: scheme → default port (`null` where there is none).
 *
 * Membership decides the query percent-encode set, whether `protocol` may be reassigned, whether
 * an empty host is legal, and which port serialises away. One table, because the spec has one.
 */
const SPECIAL_SCHEMES = new Map<string, number | null>([
    ['ftp', 21],
    ['file', null],
    ['http', 80],
    ['https', 443],
    ['ws', 80],
    ['wss', 443],
]);

function isSpecialScheme(scheme: string): boolean {
    return SPECIAL_SCHEMES.has(scheme);
}

function defaultPort(scheme: string): number | null {
    return SPECIAL_SCHEMES.get(scheme) ?? null;
}

/**
 * The five WHATWG percent-encode sets, each written as what it ADDS to "C0 controls, space, and
 * everything above `~`".
 *
 * Measured against Node's own URL rather than transcribed from the prose: `^` is in the path set
 * and `|` is not, which is the opposite of what the spec text reads like at a glance. A shared
 * escape function over one set would be wrong for four of the five.
 */
const FRAGMENT_EXTRA = '"<>`';
const QUERY_EXTRA = '"#<>';
const SPECIAL_QUERY_EXTRA = '"#<>\'';
const PATH_EXTRA = '"#<>?^`{}';
const USERINFO_EXTRA = '"#/:;<=>?@[\\]^`{|}';

function percentEncode(value: string, extra: string): string {
    let out = '';
    for (const ch of value) {
        const cp = ch.codePointAt(0)!;
        out += cp <= 0x20 || cp > 0x7e || extra.includes(ch) ? percentEncodeUtf8(ch) : ch;
    }
    return out;
}

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
    return percentEncode(query, special ? SPECIAL_QUERY_EXTRA : QUERY_EXTRA);
}

/**
 * ASCII tab and newline, which the basic URL parser removes from its input before anything else.
 *
 * So every setter that runs a value through the parser drops them — which is all of them except
 * `username` and `password`, whose spec steps percent-encode the value directly. Assuming the
 * rule is uniform gets those two wrong: `u.username = 'a\tb'` must keep the tab as `%09`.
 */
const TAB_NEWLINE = /[\t\n\r]/g;

function isSchemeChar(ch: string): boolean {
    return (
        (ch >= 'a' && ch <= 'z') ||
        (ch >= 'A' && ch <= 'Z') ||
        (ch >= '0' && ch <= '9') ||
        ch === '+' ||
        ch === '-' ||
        ch === '.'
    );
}

function isAsciiDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string | undefined): boolean {
    return ch !== undefined && /^[0-9A-Fa-f]$/.test(ch);
}

/** The ASCII-digit prefix of a value, which is all the WHATWG port parser reads. */
function digitPrefix(value: string): string {
    let digits = '';
    for (const ch of value) {
        if (!isAsciiDigit(ch)) break;
        digits += ch;
    }
    return digits;
}

/**
 * Forbidden host code points — the set an OPAQUE host (one on a non-special scheme) is checked
 * against. A domain adds C0 controls, `%` and DEL to it.
 */
const FORBIDDEN_HOST = new Set([
    '\u0000',
    '\t',
    '\n',
    '\r',
    ' ',
    '#',
    '/',
    ':',
    '<',
    '>',
    '?',
    '@',
    '[',
    '\\',
    ']',
    '^',
    '|',
]);

function hasForbiddenDomainCodePoint(domain: string): boolean {
    for (const ch of domain) {
        const cp = ch.codePointAt(0)!;
        if (cp <= 0x1f || cp === 0x7f || ch === '%' || FORBIDDEN_HOST.has(ch)) return true;
    }
    return false;
}

/**
 * The WHATWG IPv6 parser, returning the CANONICAL serialisation or `undefined` for "not an IPv6
 * address".
 *
 * Both halves are load-bearing. Without the parser, `[` and `]` would have to be waved through
 * whenever they bracket something, and `u.hostname = '[google.com]'` — which the spec refuses —
 * would install a host that is not an address; with it, the rejection and the shortest-form
 * serialisation (`[::0:01]` → `[::1]`) fall out of the same code.
 */
function parseIPv6(input: string): string | undefined {
    const address = [0, 0, 0, 0, 0, 0, 0, 0];
    let pieceIndex = 0;
    let compress: number | null = null;
    let pointer = 0;
    // Past the end reads as `undefined`, which is what the spec calls the EOF code point: every
    // comparison against a real character is false there, exactly as the algorithm wants.
    const at = () => input[pointer];

    if (at() === ':') {
        if (input[pointer + 1] !== ':') return undefined;
        pointer += 2;
        pieceIndex++;
        compress = pieceIndex;
    }

    while (pointer < input.length) {
        if (pieceIndex === 8) return undefined;
        if (at() === ':') {
            if (compress !== null) return undefined;
            pointer++;
            pieceIndex++;
            compress = pieceIndex;
            continue;
        }
        let value = 0;
        let length = 0;
        while (length < 4 && isHexDigit(at())) {
            value = value * 16 + Number.parseInt(at(), 16);
            pointer++;
            length++;
        }
        if (at() === '.') {
            // An embedded IPv4 tail (`::1.2.3.4`) occupies the last two pieces.
            if (length === 0) return undefined;
            pointer -= length;
            if (pieceIndex > 6) return undefined;
            let numbersSeen = 0;
            while (pointer < input.length) {
                let ipv4Piece: number | null = null;
                if (numbersSeen > 0) {
                    if (at() === '.' && numbersSeen < 4) pointer++;
                    else return undefined;
                }
                if (!isAsciiDigit(at())) return undefined;
                while (isAsciiDigit(at())) {
                    const digit = Number(at());
                    if (ipv4Piece === null) ipv4Piece = digit;
                    else if (ipv4Piece === 0) return undefined;
                    else ipv4Piece = ipv4Piece * 10 + digit;
                    if (ipv4Piece > 255) return undefined;
                    pointer++;
                }
                address[pieceIndex] = address[pieceIndex] * 256 + (ipv4Piece as number);
                numbersSeen++;
                if (numbersSeen === 2 || numbersSeen === 4) pieceIndex++;
            }
            if (numbersSeen !== 4) return undefined;
            break;
        }
        if (at() === ':') {
            pointer++;
            if (pointer >= input.length) return undefined;
        } else if (pointer < input.length) {
            return undefined;
        }
        address[pieceIndex] = value;
        pieceIndex++;
    }

    if (compress !== null) {
        let swaps = pieceIndex - compress;
        pieceIndex = 7;
        while (pieceIndex !== 0 && swaps > 0) {
            const swap = address[compress + swaps - 1];
            address[compress + swaps - 1] = address[pieceIndex];
            address[pieceIndex] = swap;
            pieceIndex--;
            swaps--;
        }
    } else if (pieceIndex !== 8) {
        return undefined;
    }

    return serializeIPv6(address);
}

/** Shortest-form IPv6 serialisation: the longest run of two or more zero pieces becomes `::`. */
function serializeIPv6(address: number[]): string {
    let compress: number | null = null;
    let longest = 1;
    let runStart = -1;
    let runLength = 0;
    for (let i = 0; i < 8; i++) {
        if (address[i] !== 0) {
            runStart = -1;
            runLength = 0;
            continue;
        }
        if (runStart === -1) runStart = i;
        runLength++;
        if (runLength > longest) {
            longest = runLength;
            compress = runStart;
        }
    }

    let out = '';
    let ignoreZero = false;
    for (let pieceIndex = 0; pieceIndex < 8; pieceIndex++) {
        if (ignoreZero && address[pieceIndex] === 0) continue;
        ignoreZero = false;
        if (compress === pieceIndex) {
            out += pieceIndex === 0 ? '::' : ':';
            ignoreZero = true;
            continue;
        }
        out += address[pieceIndex].toString(16);
        if (pieceIndex !== 7) out += ':';
    }
    return out;
}

/**
 * The WHATWG host parser. `undefined` means failure — and in a setter every failure is a silent
 * no-op, never a throw.
 *
 * Two normalisations the spec asks for are deliberately absent, because they belong to the host
 * parser the CONSTRUCTOR shares and `new URL()` goes through `GLib.Uri`, which has neither: IDNA
 * ToASCII and the IPv4 number forms. Adding them here alone would make `new URL('http://0x7F000001/')`
 * and `u.hostname = '0x7F000001'` disagree, which is worse than the gap. Both are declared
 * `it.failing` in `index.spec.ts` so they retire the day a shared host parser lands.
 */
function parseHost(input: string, isOpaque: boolean): string | undefined {
    if (input.startsWith('[')) {
        if (!input.endsWith(']')) return undefined;
        const address = parseIPv6(input.slice(1, -1));
        return address === undefined ? undefined : `[${address}]`;
    }
    if (isOpaque) {
        for (const ch of input) {
            if (FORBIDDEN_HOST.has(ch)) return undefined;
        }
        return percentEncode(input, '');
    }
    if (hasForbiddenDomainCodePoint(input)) return undefined;
    return input.toLowerCase();
}

/** What a `host`/`hostname` assignment resolves to; `port` absent = leave the port alone. */
interface HostAssignment {
    host: string;
    port?: number | null;
}

/**
 * The WHATWG host state run as a state override — the shared half of `host` and `hostname`.
 *
 * `hostnameOnly` is the whole difference between the two: it returns at the `:` instead of going
 * on to the port state, which is why `u.hostname = 'example.com:8080'` is a no-op rather than a
 * truncation.
 */
function parseHostSetterValue(
    value: string,
    scheme: string,
    hasCredentials: boolean,
    hasPort: boolean,
    hostnameOnly: boolean,
): HostAssignment | undefined {
    const input = value.replace(TAB_NEWLINE, '');
    const special = isSpecialScheme(scheme);

    if (scheme === 'file') {
        // File host state. `:` is an ordinary — and forbidden — host character here, never a port
        // delimiter, so `file://y/` + `x:123` is refused instead of being split into host + port.
        let end = input.length;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (ch === '/' || ch === '\\' || ch === '?' || ch === '#') {
                end = i;
                break;
            }
        }
        const buffer = input.slice(0, end);
        if (buffer === '') return { host: '' };
        const host = parseHost(buffer, false);
        if (host === undefined) return undefined;
        return { host: host === 'localhost' ? '' : host };
    }

    let insideBrackets = false;
    let buffer = '';
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === ':' && !insideBrackets) {
            if (buffer === '') return undefined;
            if (hostnameOnly) return undefined;
            const host = parseHost(buffer, !special);
            if (host === undefined) return undefined;
            const digits = digitPrefix(input.slice(i + 1));
            // An empty or overflowing port leaves the port ALONE rather than failing the whole
            // assignment: by the time the port parser gives up, the host half has already been
            // applied. `u.host = 'example.com:'` keeps the port it had.
            if (digits === '') return { host };
            const port = Number(digits);
            if (port > 0xffff) return { host };
            return { host, port: port === defaultPort(scheme) ? null : port };
        }
        if (ch === '/' || ch === '?' || ch === '#' || (special && ch === '\\')) break;
        if (ch === '[') insideBrackets = true;
        else if (ch === ']') insideBrackets = false;
        buffer += ch;
    }

    if (buffer === '') {
        // A special URL must have a non-empty host; a non-special one may drop its host, but not
        // while a username, a password or a port still hangs off it.
        if (special || hasCredentials || hasPort) return undefined;
    }
    const host = parseHost(buffer, !special);
    return host === undefined ? undefined : { host };
}

function isDoubleDotSegment(segment: string): boolean {
    const lower = segment.toLowerCase();
    return lower === '..' || lower === '.%2e' || lower === '%2e.' || lower === '%2e%2e';
}

function isSingleDotSegment(segment: string): boolean {
    const lower = segment.toLowerCase();
    return lower === '.' || lower === '%2e';
}

/** The path start + path states, run as a state override: what `url.pathname = value` resolves to. */
function parsePathSetterValue(value: string, special: boolean, hostIsNull: boolean): string {
    let input = value.replace(TAB_NEWLINE, '');
    // `\` is a segment delimiter on a special scheme and an ordinary path character everywhere else.
    if (special) input = input.replace(/\\/g, '/');

    if (input === '') {
        // "Special URLs cannot have their paths erased", and neither can a path-only URL: both keep
        // one empty segment, which serialises as `/`. A non-special URL that HAS a host can.
        return special || hostIsNull ? '/' : '';
    }

    const segments: string[] = [];
    const parts = (input.startsWith('/') ? input.slice(1) : input).split('/');
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        if (isDoubleDotSegment(part)) {
            segments.pop();
            // A dot segment in FINAL position still leaves a trailing slash behind it.
            if (isLast) segments.push('');
        } else if (isSingleDotSegment(part)) {
            if (isLast) segments.push('');
        } else {
            segments.push(percentEncode(part, PATH_EXTRA));
        }
    }
    return '/' + segments.join('/');
}

/**
 * Put back the brackets `GLib.Uri` strips from an IPv6 literal.
 *
 * A colon cannot occur in any other kind of host, so the test is unambiguous — and without this
 * both `hostname` and `href` answered `::1` for `http://[::1]/`, which re-parses as a different
 * URL entirely.
 */
function bracketIPv6Host(host: string): string {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * The WHATWG URL record: the eight components a URL is made of, held separately.
 *
 * `GLib.Uri` is IMMUTABLE, so it can parse a URL but cannot be one that changes. The query was
 * already broken out of it for that reason (#1245); every other component still delegated to the
 * parsed object, which is why nine of the ten setters could not exist. This holds all eight
 * instead, and `GLib.Uri` is used once, in the constructor, to fill them.
 *
 * The alternative — rebuild the href on every assignment and re-parse it through `GLib.Uri` — was
 * measured and rejected. GLib's parser normalises percent-encoding (`%c3%89` → `%C3%89`, `%2e` →
 * `.`), and the spec requires the opposite: "bytes already percent-encoded are left as-is"
 * (`refs/wpt/url/resources/setters_tests.json`). A re-parse therefore rewrites components nobody
 * assigned to, and `u.username = '%c3%89té'` comes back as `%C3%89t%C3%A9` rather than the
 * `%c3%89t%C3%A9` the spec asks for.
 */
export class URL {
    #scheme: string;
    #username: string;
    #password: string;
    /** `null` = no host at all (`mailto:`, `foo:/path`); `''` = present and empty (`file:///a`). */
    #host: string | null;
    /** Already default-stripped: `https://x:443/` and `https://x/` are the same URL. */
    #port: number | null;
    #path: string;
    /**
     * An "opaque path" is the spec's name for a cannot-be-a-base URL — `mailto:me@x`, `data:…`,
     * `javascript:…`. It is the gate on four setters (`pathname`, `host`, `hostname`, and through
     * them `port`), so it is decided once, at parse time, rather than re-derived per setter.
     */
    #opaquePath: boolean;
    #fragment: string | null;
    #searchParams: URLSearchParams;
    /**
     * The URL's query.
     *
     * Parsing keeps the RAW query — re-serialising it through URLSearchParams would re-encode a
     * URL nobody asked to modify — and a mutation replaces it with the serialised parameter list.
     * That is exactly what the WHATWG algorithm does, and it is why `new URL(s).href === s` still
     * holds for a URL that is only read.
     */
    #query: string | null;

    constructor(url: string | URL, base?: string | URL) {
        const urlStr = url instanceof URL ? url.href : String(url);

        let uri: GLib.Uri;
        try {
            if (base !== undefined) {
                const baseStr = base instanceof URL ? base.href : String(base);
                const baseUri = GLib.Uri.parse(baseStr, PARSE_FLAGS);
                uri = baseUri.parse_relative(urlStr, PARSE_FLAGS);
            } else {
                uri = GLib.Uri.parse(urlStr, PARSE_FLAGS);
            }
        } catch (_e: unknown) {
            throw new TypeError(`Invalid URL: ${urlStr}`);
        }

        if (!uri) {
            throw new TypeError(`Invalid URL: ${urlStr}`);
        }

        this.#scheme = uri.get_scheme();
        const special = isSpecialScheme(this.#scheme);
        this.#username = uri.get_user() ?? '';
        this.#password = uri.get_password() ?? '';
        const host = uri.get_host();
        // A special URL always HAS a host, even an empty one — `file:` is `file:///`. A non-special
        // URL may genuinely have none, and that is what separates `foo:/path` (a path-only URL,
        // whose path can be reassigned) from `foo:path` (an opaque one, whose path cannot).
        //
        // `localhost` on a `file:` URL is the EMPTY host, not a host named localhost: file host
        // state maps it away, so `file://localhost/` and `file:///` are one URL. GLib keeps it,
        // and the setter side already mapped it — which left the two halves disagreeing, and took
        // a documented refusal down with it. `protocol` must refuse to leave a `file:` URL whose
        // host is empty, and against an unmapped `localhost` that test never fired:
        // `new URL('file://localhost/').protocol = 'http'` silently produced `http://localhost/`.
        const parsed = host === null ? null : bracketIPv6Host(host.toLowerCase());
        this.#host =
            parsed === null ? (special ? '' : null) : this.#scheme === 'file' && parsed === 'localhost' ? '' : parsed;
        const port = uri.get_port();
        this.#port = port === -1 || port === defaultPort(this.#scheme) ? null : port;
        this.#path = uri.get_path() ?? '';
        if (special && this.#path === '') this.#path = '/';
        this.#opaquePath = this.#host === null && !this.#path.startsWith('/');
        // The inverse of the `/.` the serialiser writes (see `href`): it is an ESCAPE that keeps a
        // host-less `//…` path from re-parsing as an authority, never part of the path itself.
        // GLib.Uri resolves every other dot segment but keeps this one, for the same reason.
        if (this.#host === null && !this.#opaquePath && this.#path.startsWith('/.//')) {
            this.#path = this.#path.slice(2);
        }
        this.#fragment = uri.get_fragment() ?? null;
        this.#query = uri.get_query() ?? null;
        // `#query` is the text AFTER the `?` already, so it goes through the parser rather than
        // the `URLSearchParams` constructor — which would strip a second one and lose the name of
        // the first parameter of `http://x/??a=b`.
        this.#searchParams = new URLSearchParams();
        this.#searchParams._entries = parseFormUrlencoded(this.#query ?? '');
        UPDATE_STEPS.set(this.#searchParams, () => {
            // "If query is the empty string, then set url's query to null" — so removing the last
            // parameter takes the `?` with it.
            const serialised = this.#searchParams.toString();
            this.#query = serialised === '' ? null : serialised;
        });
    }

    get protocol(): string {
        return this.#scheme + ':';
    }

    /**
     * Replace the scheme — but only where the spec allows it, and never by throwing.
     *
     * Three refusals, all silent, all real: a scheme may not cross the special/non-special
     * boundary (`http:` → `b:` would leave a special URL with a host nothing would validate), a
     * URL with credentials or a port may not become `file:` (which can have neither), and a
     * `file:` URL with no host may not become anything else. An invalid scheme is IGNORED rather
     * than reported, so a consumer feeding user input in cannot be made to throw.
     */
    set protocol(value: string) {
        // The trailing `:` the spec appends is what terminates the scheme state, which is why
        // "stuff after the first colon is ignored" needs no separate rule.
        const input = String(value).replace(TAB_NEWLINE, '') + ':';
        if (!/^[A-Za-z]/.test(input)) return;

        let buffer = '';
        for (const ch of input) {
            if (ch === ':') break;
            if (!isSchemeChar(ch)) return;
            buffer += ch.toLowerCase();
        }

        if (isSpecialScheme(this.#scheme) !== isSpecialScheme(buffer)) return;
        if (buffer === 'file' && (this.#username !== '' || this.#password !== '' || this.#port !== null)) return;
        if (this.#scheme === 'file' && (this.#host === null || this.#host === '')) return;

        this.#scheme = buffer;
        if (this.#port !== null && this.#port === defaultPort(buffer)) this.#port = null;
    }

    get hostname(): string {
        return this.#host ?? '';
    }

    /** Unlike {@link host}, a `:` in the value invalidates the whole assignment. */
    set hostname(value: string) {
        if (this.#opaquePath) return;
        const assignment = parseHostSetterValue(
            String(value),
            this.#scheme,
            this.#username !== '' || this.#password !== '',
            this.#port !== null,
            true,
        );
        if (assignment === undefined) return;
        this.#host = assignment.host;
    }

    get port(): string {
        return this.#port === null ? '' : String(this.#port);
    }

    /**
     * A port is the ASCII-digit PREFIX of the value — `'8080stuff'` is 8080, not an error — and a
     * value equal to the scheme's default serialises away, so `https://x/` and `https://x:443/`
     * stay the same URL.
     */
    set port(value: string) {
        if (this.#cannotHaveCredentialsOrPort()) return;
        const raw = String(value);
        // The clear is decided on the RAW value: `''` clears the port, while `'\n\t'` — which is
        // empty only after the parser strips it — is a no-op instead.
        if (raw === '') {
            this.#port = null;
            return;
        }
        const digits = digitPrefix(raw.replace(TAB_NEWLINE, ''));
        if (digits === '') return;
        const port = Number(digits);
        if (port > 0xffff) return;
        this.#port = port === defaultPort(this.#scheme) ? null : port;
    }

    get host(): string {
        const hostname = this.hostname;
        const port = this.port;
        return port ? `${hostname}:${port}` : hostname;
    }

    /** Carries an optional port after a `:`; a value without one leaves the port untouched. */
    set host(value: string) {
        if (this.#opaquePath) return;
        const assignment = parseHostSetterValue(
            String(value),
            this.#scheme,
            this.#username !== '' || this.#password !== '',
            this.#port !== null,
            false,
        );
        if (assignment === undefined) return;
        this.#host = assignment.host;
        if (assignment.port !== undefined) this.#port = assignment.port;
    }

    get pathname(): string {
        return this.#path;
    }

    /**
     * Replace the path — ignored outright on a URL with an opaque path, where there is no path
     * list to replace.
     */
    set pathname(value: string) {
        if (this.#opaquePath) return;
        this.#path = parsePathSetterValue(String(value), isSpecialScheme(this.#scheme), this.#host === null);
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
        const raw = String(value);
        if (raw === '') {
            this.#query = null;
            this.#searchParams._entries = [];
            return;
        }
        // Order is observable: the `?` comes off the RAW value, so `'\t?a=b'` — whose first
        // character is a tab, not a `?` — keeps its question mark as query content.
        const query = (raw.startsWith('?') ? raw.slice(1) : raw).replace(TAB_NEWLINE, '');
        this.#query = encodeQuery(query, isSpecialScheme(this.#scheme));
        // The form-urlencoded PARSER, not the `URLSearchParams` constructor: the single leading
        // `?` came off on the line above, and the constructor would take a second one.
        this.#searchParams._entries = parseFormUrlencoded(query);
    }

    get hash(): string {
        return this.#fragment ? '#' + this.#fragment : '';
    }

    /**
     * Three states, as with {@link search}: no fragment, the empty fragment (which still
     * serialises as a bare `#`), and a fragment with content. Only ONE leading `#` comes off, so
     * `'##nav'` is the fragment `#nav`.
     */
    set hash(value: string) {
        const raw = String(value);
        if (raw === '') {
            this.#fragment = null;
            return;
        }
        const input = (raw.startsWith('#') ? raw.slice(1) : raw).replace(TAB_NEWLINE, '');
        this.#fragment = percentEncode(input, FRAGMENT_EXTRA);
    }

    /**
     * Every SPECIAL scheme but `file:` has a tuple origin — `ws:` and `wss:` included, and they
     * were answering `'null'` because this list was written out by hand instead of asking the one
     * special-scheme table. A WebSocket URL's origin is what a server checks a handshake against,
     * so `'null'` there is not a harmless approximation.
     */
    get origin(): string {
        if (isSpecialScheme(this.#scheme) && this.#scheme !== 'file') {
            return `${this.protocol}//${this.host}`;
        }
        return 'null';
    }

    get username(): string {
        return this.#username;
    }

    set username(value: string) {
        if (this.#cannotHaveCredentialsOrPort()) return;
        this.#username = percentEncode(String(value), USERINFO_EXTRA);
    }

    get password(): string {
        return this.#password;
    }

    set password(value: string) {
        if (this.#cannotHaveCredentialsOrPort()) return;
        this.#password = percentEncode(String(value), USERINFO_EXTRA);
    }

    /**
     * The spec's "cannot have a username/password/port": there is nowhere to hang credentials on a
     * URL with no host or an empty one, and a `file:` URL has no userinfo or port by definition.
     */
    #cannotHaveCredentialsOrPort(): boolean {
        return this.#host === null || this.#host === '' || this.#scheme === 'file';
    }

    get href(): string {
        let result = this.#scheme + ':';

        if (this.#host !== null) {
            result += '//';
            // NOT `if (username)`: `http://:secret@x/` has an empty username and a password, and
            // keying the whole userinfo block on the username alone dropped the password.
            if (this.#username !== '' || this.#password !== '') {
                result += this.#username;
                if (this.#password !== '') result += ':' + this.#password;
                result += '@';
            }
            result += this.#host;
            if (this.#port !== null) result += ':' + this.#port;
        } else if (!this.#opaquePath && this.#path.startsWith('//')) {
            // A host-less URL whose path starts with `//` would re-parse as one WITH an authority,
            // so the serialiser writes `/.` in front of it.
            result += '/.';
        }

        result += this.#path;

        // NOT `this.search`/`this.hash`: those getters answer '' for both a null and an empty
        // component, and only one of the two drops its delimiter from the URL.
        result += this.#query === null ? '' : `?${this.#query}`;
        result += this.#fragment === null ? '' : `#${this.#fragment}`;

        return result;
    }

    /**
     * Re-parse the whole URL — the ONE setter that throws, because there is no component left to
     * fall back on when the value is not a URL at all.
     *
     * The existing `searchParams` is refilled rather than replaced, for the same reason as in
     * {@link search}: the spec makes its identity stable across the assignment.
     */
    set href(value: string) {
        const next = new URL(String(value));
        this.#scheme = next.#scheme;
        this.#username = next.#username;
        this.#password = next.#password;
        this.#host = next.#host;
        this.#port = next.#port;
        this.#path = next.#path;
        this.#opaquePath = next.#opaquePath;
        this.#query = next.#query;
        this.#fragment = next.#fragment;
        this.#searchParams._entries = parseFormUrlencoded(this.#query ?? '');
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
