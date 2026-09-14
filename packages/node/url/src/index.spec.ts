import { describe, it, expect } from '@gjsify/unit';
import { URL, URLSearchParams, fileURLToPath, pathToFileURL, parse, format, resolve } from 'node:url';

// Ported from refs/node-test/parallel/test-url-*.js and refs/node-test/parallel/test-whatwg-url-*.js
// Original: MIT license, Node.js contributors
// The setter suites below are ported from refs/wpt/url/resources/setters_tests.json
// Original: Copyright the Web Platform Tests contributors. BSD-3-Clause.

/** True on real GJS — the same signal `@gjsify/unit` gates its host hooks on. */
const IS_GJS = typeof (globalThis as { process?: { versions?: { gjs?: string } } }).process?.versions?.gjs === 'string';

/**
 * Whether the host refuses an undecodable IDNA label, which only real Node does
 * and only up to a point. See the `xn--` case for the measurement; the boundary
 * sits somewhere in (26.4.0, 26.8.2] and 26.8 is where it is drawn, because those
 * are the two majors CI runs.
 *
 * `IS_GJS` IS CHECKED FIRST, and not out of tidiness: `@gjsify/process` reports
 * `process.versions.node === '20.0.0'` under GJS, so a version test alone reads
 * GJS as an old Node and takes the refusing branch. Measured — written that way
 * this gate turned the GJS leg red while Node stayed green, which is the same
 * shape as the `instanceof Error` mistake recorded two packages over: one signal,
 * two hosts, and the leg that disagrees is the one you did not have in mind.
 */
const NODE_REFUSES_UNDECODABLE_IDNA = (() => {
    if (IS_GJS) return false;
    const version = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
    if (typeof version !== 'string') return false;
    const [major = 0, minor = 0] = version.split('.').map(Number);
    return major < 26 || (major === 26 && minor < 8);
})();

export default async () => {
    // The live-view contract between `url.searchParams` and `url.href`.
    //
    // This block is the regression guard for a defect that produced no error anywhere: mutating
    // `searchParams` updated the params object and left `href` with whatever query the URL was
    // parsed with — which, for a URL built from a bare base, was none. Every request assembled
    // that way went out without its query string, and on Node the identical code worked, so
    // nothing looked wrong until the answers did.
    //
    // Each assertion below is Node's own behaviour, so this suite is meaningful on both runtimes
    // rather than pinning a GJS-only quirk.
    await describe('URL ↔ searchParams live view', async () => {
        await it('reflects set() in search, href and toString', async () => {
            const u = new URL('https://example.com/p');
            u.searchParams.set('a', '1');
            expect(u.search).toBe('?a=1');
            expect(u.href).toBe('https://example.com/p?a=1');
            expect(u.toString()).toBe('https://example.com/p?a=1');
        });

        await it('reflects append(), delete() and sort()', async () => {
            const u = new URL('https://example.com/p');
            u.searchParams.append('b', '2');
            u.searchParams.append('a', '1');
            expect(u.search).toBe('?b=2&a=1');
            u.searchParams.sort();
            expect(u.search).toBe('?a=1&b=2');
            u.searchParams.delete('a');
            expect(u.search).toBe('?b=2');
        });

        await it('drops the "?" entirely once the last parameter goes', async () => {
            const u = new URL('https://example.com/p?a=1');
            u.searchParams.delete('a');
            expect(u.search).toBe('');
            expect(u.href).toBe('https://example.com/p');
        });

        await it('adds to a query the URL was parsed with', async () => {
            const u = new URL('https://example.com/p?a=1');
            u.searchParams.set('b', '2');
            expect(u.href).toBe('https://example.com/p?a=1&b=2');
        });

        await it('leaves a URL that is only READ byte-identical', async () => {
            // Re-serialising on parse would re-encode a URL nobody asked to change.
            const raw = 'https://example.com/p?a=%20b&c=d';
            expect(new URL(raw).href).toBe(raw);
        });

        await it('accepts an assignment to search', async () => {
            const u = new URL('https://example.com/p');
            u.search = '?a=1&b=2';
            expect(u.href).toBe('https://example.com/p?a=1&b=2');
            expect(u.searchParams.get('b')).toBe('2');
            u.search = '';
            expect(u.href).toBe('https://example.com/p');
        });

        await it('keeps searchParams the same object across an assignment to search', async () => {
            const u = new URL('https://example.com/p?a=1');
            const params = u.searchParams;
            u.search = '?b=2';
            expect(u.searchParams === params).toBe(true);
            expect(params.get('b')).toBe('2');
            expect(params.get('a')).toBe(null);
        });

        await it('writes back when an EXISTING parameter is overwritten', async () => {
            // `set()` has two branches, and only this one looks like nothing happened when the
            // update steps are missing: the value changes in place, so a test that only ever adds
            // new names stays green while overwriting silently stops reaching href.
            const u = new URL('https://example.com/p?a=1&b=2');
            u.searchParams.set('a', '9');
            expect(u.search).toBe('?a=9&b=2');
            expect(u.href).toBe('https://example.com/p?a=9&b=2');
        });

        await it('keeps the rest of the URL when the query changes', async () => {
            const u = new URL('https://user:pw@example.com:8443/p?a=1#frag');
            u.searchParams.set('b', '2');
            expect(u.href).toBe('https://user:pw@example.com:8443/p?a=1&b=2#frag');
            u.searchParams.delete('a');
            u.searchParams.delete('b');
            expect(u.href).toBe('https://user:pw@example.com:8443/p#frag');
        });

        await it('percent-encodes a query assigned as a raw string', async () => {
            // Without the query-state parse an assigned '#' escapes into the fragment and the URL
            // re-parses as a DIFFERENT url; a raw space is not even a legal HTTP request target,
            // and @gjsify/http builds one straight from `pathname + search`.
            const u = new URL('https://example.com/p#frag');
            u.search = 'a=b#fake';
            expect(u.href).toBe('https://example.com/p?a=b%23fake#frag');
            expect(new URL(u.href).hash).toBe('#frag');
            u.search = 'q=a b';
            expect(u.search).toBe('?q=a%20b');
            expect(new URL(u.href).search).toBe('?q=a%20b');
        });

        await it('strips ASCII tab and newline from an assigned query', async () => {
            const u = new URL('https://example.com/p');
            u.search = 'a=b\nc\td';
            expect(u.search).toBe('?a=bcd');
        });

        await it('decodes what an assignment to search puts into the parameters', async () => {
            const u = new URL('https://example.com/p');
            u.search = '?x=%C3%A4&y=a+b';
            expect(u.searchParams.get('x')).toBe('ä');
            expect(u.searchParams.get('y')).toBe('a b');
            // …and a later mutation must not double-encode what it re-serialises.
            u.searchParams.append('z', '1');
            expect(u.href).toBe('https://example.com/p?x=%C3%A4&y=a+b&z=1');
        });

        await it('stringifies a non-string assigned to search', async () => {
            // `search` is a non-nullable USVString: null is the four characters "null", not a clear.
            const u = new URL('https://example.com/p');
            (u as unknown as { search: unknown }).search = null;
            expect(u.href).toBe('https://example.com/p?null');
            u.search = '';
            expect(u.href).toBe('https://example.com/p');
        });

        await it('tells an empty query from no query at all', async () => {
            const u = new URL('https://example.com/p');
            u.search = '?';
            expect(u.search).toBe('');
            expect(u.href).toBe('https://example.com/p?');
            u.search = '';
            expect(u.href).toBe('https://example.com/p');
        });

        await it('does not invent a parameter from an empty pair', async () => {
            // A trailing `&` is ordinary. Before the update steps existed, inventing a nameless
            // parameter for it only polluted the params object; now any mutation — even a delete
            // that removes nothing — would write the invention into href.
            const u = new URL('https://example.com/v1/items?type=release&');
            u.searchParams.delete('cursor');
            expect(u.href).toBe('https://example.com/v1/items?type=release');
            u.searchParams.set('page', '2');
            expect(u.href).toBe('https://example.com/v1/items?type=release&page=2');
            expect(new URL('https://example.com/p?a&&b').searchParams.size).toBe(2);
        });

        await it('serialises with the urlencoded set, not encodeURIComponent', async () => {
            const u = new URL('https://example.com/p');
            u.searchParams.set('k', "a!b~c'd(e)");
            expect(u.search).toBe('?k=a%21b%7Ec%27d%28e%29');
        });

        await it('replaces a lone surrogate instead of throwing mid-update', async () => {
            // The update steps run AFTER _entries changed. A throw there leaves href stale while
            // the params object already holds the value — the exact drift this suite guards
            // against — and every later mutation throws too.
            const u = new URL('https://example.com/s?lang=de');
            u.searchParams.set('q', '\uD83D');
            expect(u.href).toBe('https://example.com/s?lang=de&q=%EF%BF%BD');
            u.searchParams.set('page', '2');
            expect(u.searchParams.get('page')).toBe('2');
        });

        await it('honours the value argument of has() and delete()', async () => {
            const u = new URL('https://example.com/p?a=1&a=2');
            expect(u.searchParams.has('a', '9')).toBe(false);
            expect(u.searchParams.has('a', '1')).toBe(true);
            u.searchParams.delete('a', '1');
            expect(u.href).toBe('https://example.com/p?a=2');
        });

        await it('keeps duplicate names and empty values', async () => {
            const u = new URL('https://example.com/p');
            u.searchParams.append('a', '1');
            u.searchParams.append('a', '2');
            u.searchParams.set('e', '');
            expect(u.search).toBe('?a=1&a=2&e=');
            expect(new URL(u.href).searchParams.getAll('a').length).toBe(2);
        });

        await it('reflects a mutation made after the URL was serialised', async () => {
            const u = new URL('https://example.com/p');
            expect(u.toString()).toBe('https://example.com/p');
            u.searchParams.set('a', '1');
            expect(u.toString()).toBe('https://example.com/p?a=1');
        });

        await it('keeps the update steps off the public surface', async () => {
            // On Node `Object.keys` of a URLSearchParams is empty. An enumerable hook would also
            // ride along through `Object.assign` and could be switched off by assigning over it.
            const u = new URL('https://example.com/p?a=1');
            expect(Object.keys(u.searchParams).includes('_onUpdate')).toBe(false);
        });

        await it('works on a base-only URL and on file:', async () => {
            const a = new URL('https://example.com');
            a.searchParams.set('q', '1');
            expect(a.href).toBe('https://example.com/?q=1');
            const b = new URL('/p', 'https://example.com');
            b.searchParams.set('q', '1');
            expect(b.href).toBe('https://example.com/p?q=1');
            const f = new URL('file:///tmp/x');
            f.searchParams.set('q', '1');
            expect(f.href).toBe('file:///tmp/x?q=1');
        });

        await it('encodes values on the way into the URL', async () => {
            const u = new URL('https://example.com/p');
            u.searchParams.set('q', 'Bandsäge gebraucht');
            expect(u.href.includes('Bands')).toBe(true);
            expect(u.href.includes(' ')).toBe(false);
            expect(new URL(u.href).searchParams.get('q')).toBe('Bandsäge gebraucht');
        });
    });

    await describe('URL constructor', async () => {
        await it('should parse HTTP URL', async () => {
            const u = new URL('http://example.com:8080/path?query=1#hash');
            expect(u.protocol).toBe('http:');
            expect(u.hostname).toBe('example.com');
            expect(u.port).toBe('8080');
            expect(u.pathname).toBe('/path');
            expect(u.search).toBe('?query=1');
            expect(u.hash).toBe('#hash');
        });

        await it('should parse HTTPS URL', async () => {
            const u = new URL('https://user:pass@example.com/path');
            expect(u.protocol).toBe('https:');
            expect(u.username).toBe('user');
            expect(u.password).toBe('pass');
            expect(u.hostname).toBe('example.com');
            expect(u.pathname).toBe('/path');
        });

        await it('should parse file URL', async () => {
            const u = new URL('file:///tmp/test.txt');
            expect(u.protocol).toBe('file:');
            expect(u.pathname).toBe('/tmp/test.txt');
        });

        await it('should parse relative URL with base', async () => {
            const u = new URL('/path', 'http://example.com');
            expect(u.pathname).toBe('/path');
            expect(u.hostname).toBe('example.com');
        });

        await it('should throw on invalid URL', async () => {
            expect(() => new URL('not-a-url')).toThrow();
        });

        await it('should support toString', async () => {
            const u = new URL('http://example.com:8080/path');
            const str = u.toString();
            expect(str.includes('example.com')).toBeTruthy();
            expect(str.includes('/path')).toBeTruthy();
        });

        await it('should parse FTP URL', async () => {
            const u = new URL('ftp://files.example.com/pub/docs');
            expect(u.protocol).toBe('ftp:');
            expect(u.hostname).toBe('files.example.com');
            expect(u.pathname).toBe('/pub/docs');
        });

        await it('should parse URL with empty port', async () => {
            const u = new URL('http://example.com:/path');
            expect(u.hostname).toBe('example.com');
            expect(u.port).toBe('');
            expect(u.pathname).toBe('/path');
        });

        await it('should parse URL with only protocol and host', async () => {
            const u = new URL('http://example.com');
            expect(u.protocol).toBe('http:');
            expect(u.hostname).toBe('example.com');
            expect(u.pathname).toBe('/');
        });

        await it('should parse URL with trailing slash', async () => {
            const u = new URL('http://example.com/');
            expect(u.pathname).toBe('/');
        });

        await it('should parse URL with multiple path segments', async () => {
            const u = new URL('http://example.com/a/b/c/d');
            expect(u.pathname).toBe('/a/b/c/d');
        });

        await it('should parse URL with hash only', async () => {
            const u = new URL('http://example.com#frag');
            expect(u.hash).toBe('#frag');
            expect(u.search).toBe('');
        });

        await it('should parse URL with search only', async () => {
            const u = new URL('http://example.com?key=val');
            expect(u.search).toBe('?key=val');
            expect(u.hash).toBe('');
        });

        await it('should parse URL with search and hash', async () => {
            const u = new URL('http://example.com?a=1#frag');
            expect(u.search).toBe('?a=1');
            expect(u.hash).toBe('#frag');
        });

        await it('should throw on empty string without base', async () => {
            expect(() => new URL('')).toThrow();
        });

        await it('should resolve relative path with base', async () => {
            const u = new URL('foo/bar', 'http://example.com/base/');
            expect(u.pathname).toBe('/base/foo/bar');
        });

        await it('should resolve .. in relative path with base', async () => {
            const u = new URL('../bar', 'http://example.com/a/b/');
            expect(u.pathname).toBe('/a/bar');
        });

        await it('should handle base with query and hash', async () => {
            const u = new URL('/new', 'http://example.com/old?q=1#h');
            expect(u.pathname).toBe('/new');
            expect(u.search).toBe('');
            expect(u.hash).toBe('');
        });

        await it('should accept URL object as input', async () => {
            const original = new URL('http://example.com/path');
            const copy = new URL(original);
            expect(copy.href).toBe(original.href);
        });

        await it('should accept URL object as base', async () => {
            const base = new URL('http://example.com/base/');
            const u = new URL('relative', base);
            expect(u.hostname).toBe('example.com');
            expect(u.pathname).toBe('/base/relative');
        });
    });

    await describe('URL properties', async () => {
        await it('should return correct searchParams', async () => {
            const u = new URL('http://example.com/?a=1&b=2');
            expect(u.searchParams.get('a')).toBe('1');
            expect(u.searchParams.get('b')).toBe('2');
        });

        await it('should handle empty search', async () => {
            const u = new URL('http://example.com/path');
            expect(u.search).toBe('');
        });

        await it('should handle empty hash', async () => {
            const u = new URL('http://example.com/path');
            expect(u.hash).toBe('');
        });

        await it('should return correct origin for HTTP', async () => {
            const u = new URL('http://example.com:8080/path');
            expect(u.origin).toBe('http://example.com:8080');
        });

        await it('should return correct origin for HTTPS with default port', async () => {
            const u = new URL('https://example.com/path');
            expect(u.origin).toBe('https://example.com');
        });

        await it('should return correct host with port', async () => {
            const u = new URL('http://example.com:9090/');
            expect(u.host).toBe('example.com:9090');
        });

        await it('should return correct host without port', async () => {
            const u = new URL('http://example.com/');
            expect(u.host).toBe('example.com');
        });

        await it('should strip default port 80 for HTTP', async () => {
            const u = new URL('http://example.com:80/path');
            expect(u.port).toBe('');
        });

        await it('should strip default port 443 for HTTPS', async () => {
            const u = new URL('https://example.com:443/path');
            expect(u.port).toBe('');
        });

        await it('should strip default port 21 for FTP', async () => {
            const u = new URL('ftp://example.com:21/pub');
            expect(u.port).toBe('');
        });

        await it('should return non-default port', async () => {
            const u = new URL('http://example.com:3000/');
            expect(u.port).toBe('3000');
        });

        await it('should return username from URL', async () => {
            const u = new URL('http://admin@example.com/');
            expect(u.username).toBe('admin');
            expect(u.password).toBe('');
        });

        await it('should return password from URL', async () => {
            const u = new URL('http://admin:secret@example.com/');
            expect(u.username).toBe('admin');
            expect(u.password).toBe('secret');
        });

        await it('should return empty username and password when absent', async () => {
            const u = new URL('http://example.com/');
            expect(u.username).toBe('');
            expect(u.password).toBe('');
        });

        await it('should return null origin for non-special protocols', async () => {
            const u = new URL('data:text/plain,hello');
            expect(u.origin).toBe('null');
        });

        await it('should return a tuple origin for every special scheme but file', async () => {
            expect(new URL('ws://example.com/socket').origin).toBe('ws://example.com');
            expect(new URL('wss://example.com:8443/socket').origin).toBe('wss://example.com:8443');
            expect(new URL('ftp://example.com/pub').origin).toBe('ftp://example.com');
            expect(new URL('file:///a').origin).toBe('null');
        });

        await it('toJSON should return href', async () => {
            const u = new URL('http://example.com/path');
            expect(u.toJSON()).toBe(u.href);
        });

        await it('toString should return href', async () => {
            const u = new URL('http://example.com/path');
            expect(u.toString()).toBe(u.href);
        });

        await it('should correctly serialize full URL', async () => {
            const u = new URL('http://user:pass@example.com:8080/path?q=1#h');
            expect(u.href).toBe('http://user:pass@example.com:8080/path?q=1#h');
        });
    });

    await describe('URL special protocols', async () => {
        await it('should handle http protocol', async () => {
            const u = new URL('http://example.com');
            expect(u.protocol).toBe('http:');
            expect(u.origin).toBe('http://example.com');
        });

        await it('should handle https protocol', async () => {
            const u = new URL('https://example.com');
            expect(u.protocol).toBe('https:');
            expect(u.origin).toBe('https://example.com');
        });

        await it('should handle ftp protocol', async () => {
            const u = new URL('ftp://example.com');
            expect(u.protocol).toBe('ftp:');
            expect(u.origin).toBe('ftp://example.com');
        });

        await it('should handle file protocol', async () => {
            const u = new URL('file:///path/to/file');
            expect(u.protocol).toBe('file:');
            expect(u.pathname).toBe('/path/to/file');
        });

        await it('should handle ws protocol', async () => {
            const u = new URL('ws://example.com/socket');
            expect(u.protocol).toBe('ws:');
            expect(u.pathname).toBe('/socket');
        });

        await it('should handle wss protocol', async () => {
            const u = new URL('wss://example.com/socket');
            expect(u.protocol).toBe('wss:');
            expect(u.pathname).toBe('/socket');
        });

        await it('should handle data URL', async () => {
            const u = new URL('data:text/plain,hello');
            expect(u.protocol).toBe('data:');
        });
    });

    await describe('URL percent encoding', async () => {
        await it('should encode spaces in path', async () => {
            const u = new URL('http://example.com/hello%20world');
            expect(u.pathname).toBe('/hello%20world');
        });

        await it('should handle percent-encoded characters in query', async () => {
            const u = new URL('http://example.com/?name=hello%20world');
            expect(u.searchParams.get('name')).toBe('hello world');
        });

        await it('should preserve encoded characters in hash', async () => {
            const u = new URL('http://example.com/#section%201');
            expect(u.hash).toBe('#section%201');
        });

        await it('should handle encoded special characters', async () => {
            const u = new URL('http://example.com/path%3Fwith%23special');
            expect(u.pathname).toBe('/path%3Fwith%23special');
        });

        await it('should decode percent-encoded username', async () => {
            const u = new URL('http://user%40name@example.com/');
            expect(u.username).toBe('user%40name');
        });
    });

    // The ten WHATWG URL setters.
    //
    // Ported from refs/wpt/url/resources/setters_tests.json (Web Platform Tests, BSD-3-Clause),
    // rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
    //
    // Nine of the ten were simply ABSENT. `url.protocol = 'ftp:'` and its eight siblings threw
    // `TypeError: setting getter-only property` under GJS while the identical line worked on
    // Node, so any consumer that builds a URL by mutation — which is the ordinary way to do it —
    // was broken, and broken only on GJS. `search` was fixed alone in #1245, and the note saying
    // so read as if the class had been made mutable, which is how the other nine sat unnoticed.
    //
    // Nothing here is GJS-specific: every assertion is Node's own answer, so the Node leg proves
    // the test and the GJS leg proves the implementation.
    await describe('URL.protocol setter', async () => {
        await it('assigns a new scheme, lower-casing it', async () => {
            const u = new URL('a://example.net');
            u.protocol = 'B';
            expect(u.protocol).toBe('b:');
            expect(u.href).toBe('b://example.net');
        });

        await it('accepts the full scheme charset', async () => {
            const u = new URL('a://example.net');
            u.protocol = 'bC0+-.';
            expect(u.protocol).toBe('bc0+-.:');
        });

        await it('ignores an invalid scheme rather than throwing', async () => {
            // The only setter that throws is `href`. Everything else is a silent no-op, and a
            // consumer feeding user input into `protocol` depends on that.
            for (const bad of ['', 'é', '0b', '+b', 'b,c', 'bé', 'https\u0000', 'https\f', 'https ']) {
                const u = new URL('a://example.net');
                u.protocol = bad;
                expect(u.protocol).toBe('a:');
                expect(u.href).toBe('a://example.net');
            }
        });

        await it('ignores everything after the first colon', async () => {
            const u = new URL('http://test/');
            u.protocol = 'https:foo : bar';
            expect(u.href).toBe('https://test/');
        });

        await it('strips ASCII tab and newline', async () => {
            const u = new URL('http://test/');
            u.protocol = 'h\r\ntt\tps';
            expect(u.protocol).toBe('https:');
        });

        await it('refuses to cross the special/non-special boundary', async () => {
            const special = new URL('http://example.net');
            special.protocol = 'b';
            expect(special.protocol).toBe('http:');

            const nonSpecial = new URL('ssh://me@example.net');
            nonSpecial.protocol = 'https';
            expect(nonSpecial.protocol).toBe('ssh:');
        });

        await it('refuses "file" when the URL carries credentials or a port', async () => {
            const withUser = new URL('http://test@example.net');
            withUser.protocol = 'file';
            expect(withUser.protocol).toBe('http:');

            const withPort = new URL('https://example.net:1234');
            withPort.protocol = 'file';
            expect(withPort.protocol).toBe('https:');

            const withBoth = new URL('wss://x:x@example.net:1234');
            withBoth.protocol = 'file';
            expect(withBoth.protocol).toBe('wss:');
        });

        await it('refuses to leave "file" when the host is empty', async () => {
            const u = new URL('file:///test');
            u.protocol = 'https';
            expect(u.href).toBe('file:///test');
        });

        // THE SAME REFUSAL, SPELLED THE OTHER WAY — and the spelling that got through.
        //
        // `file://localhost/` is a file URL with an EMPTY host, not one hosted at `localhost`:
        // file host state maps the label away at parse time. The refusal above was written and
        // measured against `file:///test`, where the host is empty however it is derived, so it
        // passed while `file://localhost/` walked straight past the same check and turned into
        // `http://localhost/` — a different origin, silently, from a setter documented as
        // refusing. Two WPT cases cover it and both were failing.
        await it('refuses to leave "file" when the host is a mapped localhost', async () => {
            const u = new URL('file://localhost/');
            u.protocol = 'http';
            expect(u.protocol).toBe('file:');
            expect(u.href).toBe('file:///');
        });

        await it('drops a port that is the new scheme default', async () => {
            const u = new URL('http://foo.com:443/');
            u.protocol = 'https';
            expect(u.port).toBe('');
            expect(u.href).toBe('https://foo.com/');
        });

        await it('changes the scheme of an opaque-path URL', async () => {
            const u = new URL('javascript:alert(1)');
            u.protocol = 'defuse';
            expect(u.href).toBe('defuse:alert(1)');
        });

        await it('leaves a cannot-be-a-base URL alone when the new scheme is special', async () => {
            const u = new URL('mailto:me@example.net');
            u.protocol = 'http';
            expect(u.href).toBe('mailto:me@example.net');
        });
    });

    await describe('URL.username and URL.password setters', async () => {
        await it('sets a username on a URL that has a host', async () => {
            const u = new URL('http://example.net');
            u.username = 'me';
            expect(u.username).toBe('me');
            expect(u.href).toBe('http://me@example.net/');
        });

        await it('sets a password, keeping an empty username', async () => {
            const u = new URL('http://example.net');
            u.password = 'secret';
            expect(u.password).toBe('secret');
            expect(u.href).toBe('http://:secret@example.net/');
        });

        await it('clears a username and keeps the password', async () => {
            const u = new URL('http://me:secret@example.net');
            u.username = '';
            expect(u.href).toBe('http://:secret@example.net/');
        });

        await it('clears a password and keeps the username', async () => {
            const u = new URL('http://me:secret@example.net');
            u.password = '';
            expect(u.href).toBe('http://me@example.net/');
        });

        await it('is a no-op where the URL cannot have credentials', async () => {
            // "Cannot have a username/password/port" is host-null, host-empty, or scheme file.
            for (const href of [
                'file:///home/you/index.html',
                'unix:/run/foo.socket',
                'mailto:you@example.net',
                'javascript:alert(1)',
                'sc:///',
                'file://test/',
            ]) {
                const u = new URL(href);
                u.username = 'me';
                u.password = 'secret';
                expect(u.username).toBe('');
                expect(u.password).toBe('');
                expect(u.href).toBe(href);
            }
        });

        await it('percent-encodes with the userinfo set', async () => {
            const u = new URL('http://example.net');
            u.username = '\u0000\u0001\u001f !"#$%&\'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~\u007f\u0080\u0081Éé';
            expect(u.username).toBe(
                "%00%01%1F%20!%22%23$%&'()*+,-.%2F09%3A%3B%3C%3D%3E%3F%40AZ%5B%5C%5D%5E_%60az%7B%7C%7D~%7F%C2%80%C2%81%C3%89%C3%A9",
            );
        });

        await it('leaves bytes that are already percent-encoded as they are', async () => {
            const u = new URL('http://example.net');
            u.username = '%c3%89té';
            expect(u.username).toBe('%c3%89t%C3%A9');
        });

        await it('does NOT strip tab and newline, unlike every other setter', async () => {
            // The other nine run the value through the basic URL parser, which removes ASCII tab
            // and newline. `username`/`password` do not go through it, so the characters survive
            // as percent-encoded bytes.
            const u = new URL('http://example.net');
            u.username = 'a\t\n\rb';
            expect(u.username).toBe('a%09%0A%0Db');
        });
    });

    await describe('URL.host setter', async () => {
        await it('sets hostname and port together', async () => {
            const u = new URL('http://example.net');
            u.host = 'example.com:8080';
            expect(u.host).toBe('example.com:8080');
            expect(u.hostname).toBe('example.com');
            expect(u.port).toBe('8080');
        });

        await it('leaves the port alone when the value names none', async () => {
            const withoutColon = new URL('http://example.net:8080');
            withoutColon.host = 'example.com';
            expect(withoutColon.host).toBe('example.com:8080');

            const emptyPort = new URL('http://example.net:8080');
            emptyPort.host = 'example.com:';
            expect(emptyPort.host).toBe('example.com:8080');
        });

        await it('drops a port equal to the scheme default', async () => {
            const u = new URL('http://example.net:8080');
            u.host = 'example.com:80';
            expect(u.port).toBe('');
            expect(u.href).toBe('http://example.com/');
        });

        await it('keeps a default port that belongs to a different scheme', async () => {
            const u = new URL('https://example.net');
            u.host = 'example.com:80';
            expect(u.host).toBe('example.com:80');
        });

        await it('stops the port parser at the first non-digit without failing', async () => {
            for (const value of ['example.com:8080stuff2', 'example.com:8080+2']) {
                const u = new URL('http://example.net/path');
                u.host = value;
                expect(u.host).toBe('example.com:8080');
            }
        });

        await it('sets the hostname but leaves the port when the port overflows', async () => {
            const u = new URL('http://example.net/path');
            u.host = 'example.com:65536';
            expect(u.hostname).toBe('example.com');
            expect(u.port).toBe('');
        });

        await it('ignores everything after a delimiter', async () => {
            for (const value of ['example.com/stuff', 'example.com?stuff', 'example.com#stuff', 'example.com\\stuff']) {
                const u = new URL('http://example.net/path');
                u.host = value;
                expect(u.href).toBe('http://example.com/path');
            }
        });

        await it('does not treat a backslash as a delimiter on a non-special scheme', async () => {
            // `\` is forbidden in a host, so the whole value is refused rather than truncated.
            const u = new URL('view-source+http://example.net/path');
            u.host = 'example.com\\stuff';
            expect(u.host).toBe('example.net');
        });

        await it('is a no-op on a URL with an opaque path', async () => {
            for (const href of ['mailto:me@example.net', 'data:text/plain,Stuff']) {
                const u = new URL(href);
                u.host = 'example.com';
                expect(u.host).toBe('');
                expect(u.href).toBe(href);
            }
        });

        await it('lets a path-only URL gain a host', async () => {
            const u = new URL('a:/foo');
            u.host = 'example.net';
            expect(u.href).toBe('a://example.net/foo');
        });

        await it('keeps IPv6 brackets and reads the port after them', async () => {
            const u = new URL('http://example.net:8080/test');
            u.host = '[::1]';
            expect(u.hostname).toBe('[::1]');
            expect(u.host).toBe('[::1]:8080');

            const withPort = new URL('http://example.net');
            withPort.host = '[2001:db8::2]:4002';
            expect(withPort.href).toBe('http://[2001:db8::2]:4002/');
        });

        await it('refuses a broken IPv6 literal', async () => {
            for (const value of ['[google.com]', '[::1.2.3.4x]', '[::1.2.3.]', '[::1.2.]', '[::1.]']) {
                const u = new URL('http://example.net/');
                u.host = value;
                expect(u.hostname).toBe('example.net');
            }
        });

        await it('normalizes an IPv6 literal to its shortest form', async () => {
            const u = new URL('http://example.net');
            u.host = '[::0:01]:2';
            expect(u.hostname).toBe('[::1]');
            expect(u.port).toBe('2');
        });

        // THE CONSTRUCTOR SIDE OF THE SAME INVARIANT, which nothing else in this file reaches.
        //
        // Every IPv6 case above assigns through a setter, and the setter's own parser puts the
        // brackets back. The constructor takes the host from `GLib.Uri`, which STRIPS them, and
        // the re-bracketing there was covered by no test at all: deleting it left the suite green
        // while `new URL('http://[::1]/').href` became `http://::1/` — a string that re-parses as
        // a different URL, with `::1` read as a host and `1` as a port.
        await it('restores the brackets GLib strips from a parsed IPv6 host', async () => {
            const plain = new URL('http://[::1]/');
            expect(plain.hostname).toBe('[::1]');
            expect(plain.host).toBe('[::1]');
            expect(plain.href).toBe('http://[::1]/');

            const withPort = new URL('http://[::1]:8080/p');
            expect(withPort.hostname).toBe('[::1]');
            expect(withPort.host).toBe('[::1]:8080');
            expect(withPort.href).toBe('http://[::1]:8080/p');

            // Round-trip: the serialisation has to parse back to the same URL.
            expect(new URL(plain.href).href).toBe('http://[::1]/');
        });

        await it('percent-encodes an opaque host on a non-special scheme', async () => {
            const u = new URL('sc://x/');
            u.host = 'ß';
            expect(u.hostname).toBe('%C3%9F');
        });

        await it.failing(
            'normalizes IPv4 address syntax',
            async () => {
                const u = new URL('http://example.net');
                u.host = '0x7F000001:8080';
                expect(u.hostname).toBe('127.0.0.1');
            },
            'The WHATWG IPv4 parser (hex/octal/dotless forms collapsed to dotted-quad) lives in the ' +
                'HOST parser, which `new URL()` and the host setters share. @gjsify/url parses through ' +
                'GLib.Uri, which is RFC 3986 and does no such canonicalisation, so implementing it in the ' +
                'setter alone would make `new URL("http://0x7F000001/").hostname` and `u.hostname = ' +
                '"0x7F000001"` disagree — a worse defect than the one it fixes. It belongs to a host-parser ' +
                'change that covers both, not to this one.',
            { when: IS_GJS },
        );

        await it.failing(
            'runs a non-ASCII host through IDNA',
            async () => {
                const u = new URL('https://x/');
                u.host = 'ß';
                expect(u.hostname).toBe('xn--zca');
            },
            'IDNA ToASCII (UTS #46 mapping plus Punycode) has no GLib equivalent — GLib.Uri leaves a ' +
                'non-ASCII host as typed. Same argument as the IPv4 marker above: the conversion belongs to ' +
                'the shared host parser, so the constructor and the setter must gain it together.',
            { when: IS_GJS },
        );
    });

    await describe('URL.hostname setter', async () => {
        await it('refuses a value containing a colon', async () => {
            // The port delimiter invalidates the whole assignment — it does not merely truncate.
            const u = new URL('http://example.net/path');
            u.hostname = 'example.com:8080';
            expect(u.hostname).toBe('example.net');

            const trailing = new URL('http://example.net:8080/path');
            trailing.hostname = 'example.com:';
            expect(trailing.host).toBe('example.net:8080');
        });

        await it('truncates at a delimiter', async () => {
            for (const value of ['example.com/stuff', 'example.com?stuff', 'example.com#stuff']) {
                const u = new URL('http://example.net/path');
                u.hostname = value;
                expect(u.hostname).toBe('example.com');
            }
        });

        await it('refuses the empty host on a special scheme', async () => {
            const u = new URL('http://example.net');
            u.hostname = '';
            expect(u.hostname).toBe('example.net');
        });

        await it('accepts the empty host on a non-special scheme', async () => {
            const u = new URL('view-source+http://example.net/foo');
            u.hostname = '';
            expect(u.href).toBe('view-source+http:///foo');
        });

        await it('refuses the empty host when credentials or a port are present', async () => {
            const withUser = new URL('sc://test@test/');
            withUser.hostname = '';
            expect(withUser.hostname).toBe('test');

            const withPort = new URL('sc://test:12/');
            withPort.hostname = '';
            expect(withPort.host).toBe('test:12');
        });

        await it('refuses a forbidden host code point', async () => {
            for (const value of ['><', 'x@x']) {
                const u = new URL('https://test.invalid/');
                u.hostname = value;
                expect(u.hostname).toBe('test.invalid');
            }
            for (const value of ['\u0000', ' ', '@']) {
                const u = new URL('sc://x/');
                u.hostname = value;
                expect(u.hostname).toBe('x');
            }
        });

        await it('reads a terminator as the empty host on a non-special scheme', async () => {
            for (const value of ['\t', '\n', '\r', '#', '/', '?']) {
                const u = new URL('sc://x/');
                u.hostname = value;
                expect(u.href).toBe('sc:///');
            }
        });

        await it('does not strip a leading slash', async () => {
            const special = new URL('http://example.com/');
            special.hostname = '///bad.com';
            expect(special.hostname).toBe('example.com');

            const nonSpecial = new URL('sc://example.com/');
            nonSpecial.hostname = '///bad.com';
            expect(nonSpecial.href).toBe('sc:///');
        });

        await it('strips ASCII tab and newline from the middle of a value', async () => {
            const u = new URL('https://test.invalid/');
            u.hostname = 'foo\t\r\nbar';
            expect(u.hostname).toBe('foobar');
        });

        // AN ASCII LABEL IDNA CANNOT DECODE, and the one case in this file where
        // the reference itself moved.
        //
        // Measured, same three lines on each: 24.19.0, 25.2.1 and 26.4.0 all
        // REFUSE `xn--` and leave the hostname alone; 26.8.2 ACCEPTS it and
        // reports `https://xn--/`. The change is WPT's — `setters_tests.json`
        // has always expected the label to be accepted — so Node moved onto the
        // side `@gjsify/url` was already on, and the divergence this case was
        // written to document closed from the reference's end rather than ours.
        //
        // It cannot pin one literal. CI runs both 24 and 26.8, so either literal
        // is wrong on one of them, and it was: the suite went red on 26.8.2
        // reporting `xn--` where `test.invalid` was expected. The gate is the
        // node version rather than a re-probe, because on Node the subject IS
        // the reference and asking it would only assert that it agrees with
        // itself.
        await it('handles an ASCII label that IDNA cannot decode as its host does', async () => {
            const u = new URL('https://test.invalid/');
            u.hostname = 'xn--';

            if (NODE_REFUSES_UNDECODABLE_IDNA) {
                expect(u.hostname).toBe('test.invalid');
                expect(u.href).toBe('https://test.invalid/');
            } else {
                expect(u.hostname).toBe('xn--');
                expect(u.href).toBe('https://xn--/');
            }
        });

        await it('does not treat a colon as a port delimiter on a file URL', async () => {
            // In file host state `:` is an ordinary — and forbidden — host character, so the
            // whole value is refused instead of being split into host and port.
            const u = new URL('file://y/');
            u.hostname = 'x:123';
            expect(u.hostname).toBe('y');
        });

        await it('lets a file URL drop its host', async () => {
            const u = new URL('file://hi/x');
            u.hostname = '';
            expect(u.href).toBe('file:///x');
        });

        // `localhost` on a `file:` URL IS the empty host — file host state maps it away, so
        // `file://localhost/x` and `file:///x` are one URL and neither side may keep the label.
        //
        // Both halves are asserted here because for a while only one of them did it: the setter
        // mapped `localhost` and the constructor kept whatever GLib returned. Deleting the
        // setter's mapping left the whole suite green, and the constructor's absence of one was
        // invisible until it took a REFUSAL down with it — see the protocol setter's case below.
        await it('maps localhost to the empty host, on both sides', async () => {
            const assigned = new URL('file://hi/x');
            assigned.hostname = 'localhost';
            expect(assigned.hostname).toBe('');
            expect(assigned.href).toBe('file:///x');

            const parsed = new URL('file://localhost/x');
            expect(parsed.hostname).toBe('');
            expect(parsed.href).toBe('file:///x');
        });

        await it('lower-cases an assigned domain', async () => {
            const u = new URL('http://example.net/');
            u.hostname = 'EXAMPLE.COM';
            expect(u.hostname).toBe('example.com');
            expect(u.href).toBe('http://example.com/');
        });

        await it('is a no-op on a URL with an opaque path', async () => {
            const u = new URL('mailto:me@example.net');
            u.hostname = 'example.com';
            expect(u.href).toBe('mailto:me@example.net');
        });

        // A PATH-ONLY URL CAN GAIN AN EMPTY HOST — and here @gjsify/url follows the spec text
        // where Node does not, so the expectation is selected by host rather than asserted flat.
        //
        // Host state has exactly one refusal for an empty buffer: "if state override is given,
        // buffer is the empty string, and either url includes credentials or url's port is
        // non-null, then return". `foo:/path` has neither, so the empty host is installed and the
        // URL serialises with an authority. WPT pins the neighbouring case — `non-spec:/.//p` <-
        // `''` gives `non-spec:////p`, which this implementation passes — but leaves this one
        // uncovered, and Node keeps the host null instead. Pinned on both sides so the difference
        // is a recorded decision rather than something that drifts unnoticed.
        await it('installs an empty host on a path-only URL, as the spec text has it', async () => {
            const u = new URL('foo:/path');
            u.hostname = '';
            expect(u.href).toBe(IS_GJS ? 'foo:///path' : 'foo:/path');

            // The case WPT does pin, where the two agree.
            const escaped = new URL('non-spec:/.//p');
            escaped.hostname = '';
            expect(escaped.href).toBe('non-spec:////p');
        });
    });

    await describe('URL.port setter', async () => {
        await it('sets a port', async () => {
            const u = new URL('http://example.net');
            u.port = '8080';
            expect(u.port).toBe('8080');
            expect(u.href).toBe('http://example.net:8080/');
        });

        await it('clears the port on the empty string', async () => {
            const u = new URL('http://example.net:8080');
            u.port = '';
            expect(u.port).toBe('');
            expect(u.href).toBe('http://example.net/');
        });

        await it('drops a value equal to the scheme default', async () => {
            const u = new URL('http://example.net:8080');
            u.port = '80';
            expect(u.port).toBe('');
        });

        await it('keeps a default port that belongs to a different scheme', async () => {
            const u = new URL('https://example.net');
            u.port = '80';
            expect(u.port).toBe('80');
        });

        await it('stops at the first non-digit without failing', async () => {
            for (const [value, expected] of [
                ['8080/stuff', '8080'],
                ['8080?stuff', '8080'],
                ['8080#stuff', '8080'],
                ['8080\\stuff', '8080'],
                ['8080stuff2', '8080'],
                ['8080+2', '8080'],
            ] as const) {
                const u = new URL('http://example.net/path');
                u.port = value;
                expect(u.port).toBe(expected);
            }
        });

        await it('uses only the ASCII-digit prefix', async () => {
            const u = new URL('https://www.google.com:4343');
            u.port = '4wpt';
            expect(u.port).toBe('4');
        });

        await it('accepts the top of the 16-bit range and refuses what overflows it', async () => {
            const max = new URL('http://example.net/path');
            max.port = '65535';
            expect(max.port).toBe('65535');

            const over = new URL('http://example.net:8080/path');
            over.port = '65536';
            expect(over.port).toBe('8080');
        });

        await it('ignores a value that does not start with a digit', async () => {
            const u = new URL('http://example.net:8080/path');
            u.port = 'randomstring';
            expect(u.port).toBe('8080');
        });

        await it('strips ASCII tab and newline before parsing', async () => {
            const leading = new URL('https://domain.com:443');
            leading.port = '\t8080';
            expect(leading.port).toBe('8080');

            const interleaved = new URL('https://domain.com:3000');
            interleaved.port = '\n\t80\n\t80\n\t';
            expect(interleaved.port).toBe('8080');
        });

        await it('leaves the port alone when stripping empties the value', async () => {
            // The empty string clears the port; a value that only LOOKS empty after tab/newline
            // removal is a no-op instead, because the clear is decided before the parse.
            const u = new URL('https://domain.com:3000');
            u.port = '\n\n\t\t';
            expect(u.port).toBe('3000');
        });

        await it('is a no-op where the URL cannot have a port', async () => {
            for (const href of ['file://test/', 'non-base:value', 'sc:///']) {
                const u = new URL(href);
                u.port = '12';
                expect(u.port).toBe('');
                expect(u.href).toBe(href);
            }
        });

        await it('sets a port on a non-special scheme', async () => {
            const u = new URL('sc://x/');
            u.port = '12';
            expect(u.href).toBe('sc://x:12/');
        });
    });

    await describe('URL.pathname setter', async () => {
        await it('is a no-op on a URL with an opaque path', async () => {
            for (const href of ['mailto:me@example.net', 'data:original', 'sc:original']) {
                const u = new URL(href);
                u.pathname = 'new value';
                expect(u.href).toBe(href);
            }
        });

        await it('gives a relative value its leading slash', async () => {
            const u = new URL('https://example.net#nav');
            u.pathname = 'home';
            expect(u.pathname).toBe('/home');
            expect(u.href).toBe('https://example.net/home#nav');
        });

        await it('resolves dot segments', async () => {
            const up = new URL('https://example.net#nav');
            up.pathname = '../home';
            expect(up.pathname).toBe('/home');

            const mixed = new URL('unix:/run/foo.socket?timeout=10');
            mixed.pathname = '/var/log/../run/bar.socket';
            expect(mixed.href).toBe('unix:/var/run/bar.socket?timeout=10');

            const trailing = new URL('foo://path/to');
            trailing.pathname = '/..';
            expect(trailing.pathname).toBe('/');

            // A dot segment in FINAL position leaves the trailing slash behind it — "if c is
            // neither / nor \, append the empty string to url's path". The `/..` case above
            // cannot see that rule: it pops the only segment there is, so appending the empty
            // string and not appending it both serialise as `/`. It needs a segment to survive
            // the pop, and then the two answers differ: `/a/` against `/a`.
            const survivor = new URL('https://example.net/z');
            survivor.pathname = '/a/b/..';
            expect(survivor.pathname).toBe('/a/');

            const singleDot = new URL('https://example.net/z');
            singleDot.pathname = '/a/b/.';
            expect(singleDot.pathname).toBe('/a/b/');

            // ...and a dot segment that is NOT final appends nothing.
            const interior = new URL('https://example.net/z');
            interior.pathname = '/a/b/../c';
            expect(interior.pathname).toBe('/a/c');
        });

        await it('reads a backslash as a segment delimiter only on a special scheme', async () => {
            const special = new URL('http://example.net/home?lang=fr#nav');
            special.pathname = '\\a\\%2E\\b\\%2e.\\c';
            expect(special.pathname).toBe('/a/c');
            expect(special.href).toBe('http://example.net/a/c?lang=fr#nav');

            const nonSpecial = new URL('view-source+http://example.net/home?lang=fr#nav');
            nonSpecial.pathname = '\\a\\%2E\\b\\%2e.\\c';
            expect(nonSpecial.pathname).toBe('/\\a\\%2E\\b\\%2e.\\c');
        });

        await it('percent-encodes with the path set', async () => {
            const u = new URL('a:/');
            u.pathname = '\u0000\u0001\t\n\r\u001f !"#$%&\'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~\u007f\u0080\u0081Éé';
            expect(u.pathname).toBe(
                "/%00%01%1F%20!%22%23$%&'()*+,-./09:;%3C=%3E%3F@AZ[\\]%5E_%60az%7B|%7D~%7F%C2%80%C2%81%C3%89%C3%A9",
            );
        });

        await it('encodes a question mark and a hash so the value cannot escape the path', async () => {
            const question = new URL('http://example.net');
            question.pathname = '?';
            expect(question.href).toBe('http://example.net/%3F');

            const hash = new URL('http://example.net');
            hash.pathname = '#';
            expect(hash.href).toBe('http://example.net/%23');

            const nonSpecial = new URL('sc://example.net');
            nonSpecial.pathname = '#';
            expect(nonSpecial.href).toBe('sc://example.net/%23');
        });

        await it('leaves bytes that are already percent-encoded as they are', async () => {
            const u = new URL('http://example.net');
            u.pathname = '%2e%2E%c3%89té';
            expect(u.pathname).toBe('/%2e%2E%c3%89t%C3%A9');
        });

        await it('encodes a trailing space and a trailing C0 control', async () => {
            const space = new URL('http://example.net');
            space.pathname = ' ';
            expect(space.pathname).toBe('/%20');

            const nul = new URL('http://example.net');
            nul.pathname = '\u0000';
            expect(nul.pathname).toBe('/%00');
        });

        await it('refuses to erase the path of a special URL', async () => {
            const u = new URL('file:///some/path');
            u.pathname = '';
            expect(u.pathname).toBe('/');
            expect(u.href).toBe('file:///');
        });

        await it('erases the path of a non-special URL that has a host', async () => {
            const withHost = new URL('foo://somehost/some/path');
            withHost.pathname = '';
            expect(withHost.pathname).toBe('');
            expect(withHost.href).toBe('foo://somehost');

            const emptyHost = new URL('foo:///some/path');
            emptyHost.pathname = '';
            expect(emptyHost.href).toBe('foo://');
        });

        await it('refuses to erase the path of a path-only URL', async () => {
            const u = new URL('foo:/some/path');
            u.pathname = '';
            expect(u.pathname).toBe('/');
            expect(u.href).toBe('foo:/');
        });

        await it('keeps a doubled leading slash out of the authority position', async () => {
            // A host-less URL whose path starts with `//` would re-parse as having an authority,
            // so the serializer writes `/.` in front of it.
            const u = new URL('non-spec:/');
            u.pathname = '//p';
            expect(u.pathname).toBe('//p');
            expect(u.href).toBe('non-spec:/.//p');
        });

        await it('takes the /. escape back off a parsed path', async () => {
            // The other direction of the rule above. `/.` is how a host-less `//…` path avoids
            // re-parsing as one with an authority, so it belongs to the serialisation and not to
            // the path — `href` keeps it, `pathname` must not.
            const u = new URL('non-spec:/.//p');
            expect(u.pathname).toBe('//p');
            expect(u.href).toBe('non-spec:/.//p');
        });

        await it('drops the /. prefix again once the path no longer needs it', async () => {
            const u = new URL('non-spec:/.//');
            u.pathname = 'p';
            expect(u.href).toBe('non-spec:/p');
        });

        await it('reads both slashes on a file URL', async () => {
            const u = new URL('file://monkey/');
            u.pathname = '\\\\';
            expect(u.pathname).toBe('//');
            expect(u.href).toBe('file://monkey//');
        });
    });

    await describe('URL.hash setter', async () => {
        await it('sets a fragment with or without the leading #', async () => {
            const bare = new URL('https://example.net');
            bare.hash = 'main';
            expect(bare.hash).toBe('#main');
            expect(bare.href).toBe('https://example.net/#main');

            const withHash = new URL('https://example.net#nav');
            withHash.hash = '#main';
            expect(withHash.hash).toBe('#main');
        });

        await it('strips only ONE leading #', async () => {
            const u = new URL('https://example.net?lang=en-US');
            u.hash = '##nav';
            expect(u.hash).toBe('##nav');
            expect(u.href).toBe('https://example.net/?lang=en-US##nav');
        });

        await it('distinguishes no fragment from an empty one', async () => {
            const empty = new URL('https://example.net?lang=en-US#nav');
            empty.hash = '#';
            expect(empty.hash).toBe('');
            expect(empty.href).toBe('https://example.net/?lang=en-US#');

            const none = new URL('https://example.net?lang=en-US#nav');
            none.hash = '';
            expect(none.hash).toBe('');
            expect(none.href).toBe('https://example.net/?lang=en-US');
        });

        await it('percent-encodes with the fragment set', async () => {
            const u = new URL('a:/');
            u.hash = '\u0000\u0001\t\n\r\u001f !"#$%&\'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~\u007f\u0080\u0081Éé';
            expect(u.hash).toBe(
                "#%00%01%1F%20!%22#$%&'()*+,-./09:;%3C=%3E?@AZ[\\]^_%60az{|}~%7F%C2%80%C2%81%C3%89%C3%A9",
            );
        });

        await it('leaves bytes that are already percent-encoded as they are', async () => {
            const u = new URL('http://example.net');
            u.hash = '%c3%89té';
            expect(u.hash).toBe('#%c3%89t%C3%A9');
        });

        await it('sets a fragment on an opaque-path URL', async () => {
            const u = new URL('javascript:alert(1)');
            u.hash = 'castle';
            expect(u.href).toBe('javascript:alert(1)#castle');
        });

        await it('removes the # before the tab and newline strip, not after', async () => {
            // Order is observable: the leading `#` is removed from the RAW value, so a value that
            // only starts with `#` once tabs are gone keeps it as fragment content.
            const u = new URL('https://example.net/p');
            u.hash = '\t#f';
            expect(u.hash).toBe('##f');
        });
    });

    await describe('URL.search setter (spec details)', async () => {
        await it('strips only ONE leading ?', async () => {
            const u = new URL('https://example.net?lang=en-US#nav');
            u.search = '??lang=fr';
            expect(u.search).toBe('??lang=fr');
            expect(u.href).toBe('https://example.net/??lang=fr#nav');
        });

        // THE SAME `?`, READ OFF THE OTHER SIDE — and the side that was wrong.
        //
        // The case above passed while the params object silently disagreed with the query it is
        // supposed to be a view of. The setter removes its one leading `?` and then handed the
        // remainder to the `URLSearchParams` CONSTRUCTOR, which removes one of its own: the query
        // serialised correctly as `??lang=fr` while the parameter was recorded as `lang` instead
        // of `?lang`.
        //
        // Not a cosmetic disagreement. `searchParams` writes back through the update steps, so
        // the next `append()` on that object replaces the correct query with the wrong one — the
        // #1245 drift, re-entered through a setter added in the course of fixing it. Asserting
        // `search` and `href` alone structurally cannot see it, which is why it went unseen.
        await it('fills searchParams from the query the ? was already taken off', async () => {
            const u = new URL('http://example.net/');
            u.search = '??a=b';
            expect(u.search).toBe('??a=b');
            expect(u.searchParams.get('?a')).toBe('b');
            expect(u.searchParams.toString()).toBe('%3Fa=b');

            // The write-back still agrees with the query after a mutation.
            u.searchParams.append('c', 'd');
            expect(u.href).toBe('http://example.net/?%3Fa=b&c=d');
        });

        await it('takes only one ? in the constructor and the href setter too', async () => {
            expect(new URL('http://example.net/??a=b').searchParams.get('?a')).toBe('b');

            const u = new URL('http://example.net/');
            u.href = 'http://other.test/??a=b';
            expect(u.searchParams.get('?a')).toBe('b');
            expect(u.searchParams.toString()).toBe('%3Fa=b');
        });

        await it('distinguishes no query from an empty one', async () => {
            const u = new URL('https://example.net?lang=en-US#nav');
            u.search = '?';
            expect(u.search).toBe('');
            expect(u.href).toBe('https://example.net/?#nav');
        });

        await it('removes the ? before the tab and newline strip, not after', async () => {
            const u = new URL('https://example.net/p');
            u.search = '\t?a=b';
            expect(u.search).toBe('??a=b');
        });

        await it('does not encode an apostrophe on a non-special scheme', async () => {
            // The query percent-encode set gains `'` only for special schemes.
            const special = new URL('http://example.net');
            special.search = "a'b";
            expect(special.search).toBe('?a%27b');

            const nonSpecial = new URL('sc://example.net');
            nonSpecial.search = "a'b";
            expect(nonSpecial.search).toBe("?a'b");
        });
    });

    await describe('URL.href setter', async () => {
        await it('replaces every component', async () => {
            const u = new URL('https://user:pw@example.com:8443/p?a=1#frag');
            u.href = 'http://other.test/q?b=2';
            expect(u.protocol).toBe('http:');
            expect(u.username).toBe('');
            expect(u.password).toBe('');
            expect(u.host).toBe('other.test');
            expect(u.pathname).toBe('/q');
            expect(u.search).toBe('?b=2');
            expect(u.hash).toBe('');
            expect(u.href).toBe('http://other.test/q?b=2');
        });

        await it('is the only setter that throws', async () => {
            const u = new URL('https://example.net/');
            let threw: unknown;
            try {
                u.href = 'not a url';
            } catch (e) {
                threw = e;
            }
            expect(threw instanceof TypeError).toBe(true);
            expect(u.href).toBe('https://example.net/');
        });

        await it('refills searchParams in place, keeping its identity', async () => {
            const u = new URL('https://example.net/p?a=1');
            const params = u.searchParams;
            u.href = 'https://other.test/q?b=2';
            expect(u.searchParams === params).toBe(true);
            expect(params.get('a')).toBe(null);
            expect(params.get('b')).toBe('2');
        });
    });

    await describe('URL mutation keeps the rest of the URL intact', async () => {
        await it('carries query and fragment across every component change', async () => {
            const u = new URL('https://example.net/p?a=1#frag');
            u.protocol = 'http';
            u.username = 'me';
            u.password = 'secret';
            u.hostname = 'other.test';
            u.port = '8080';
            u.pathname = '/q';
            expect(u.href).toBe('http://me:secret@other.test:8080/q?a=1#frag');
        });

        await it('keeps searchParams in step with a search assignment after other mutations', async () => {
            const u = new URL('https://example.net/p');
            u.hostname = 'other.test';
            u.searchParams.set('a', '1');
            u.pathname = '/q';
            u.searchParams.append('b', '2');
            expect(u.href).toBe('https://other.test/q?a=1&b=2');
        });
    });

    await describe('URLSearchParams', async () => {
        await it('should construct from string', async () => {
            const params = new URLSearchParams('a=1&b=2');
            expect(params.get('a')).toBe('1');
            expect(params.get('b')).toBe('2');
        });

        await it('should construct from object', async () => {
            const params = new URLSearchParams({ foo: 'bar', baz: 'qux' });
            expect(params.get('foo')).toBe('bar');
            expect(params.get('baz')).toBe('qux');
        });

        await it('should construct from entries', async () => {
            const params = new URLSearchParams([
                ['a', '1'],
                ['b', '2'],
            ]);
            expect(params.get('a')).toBe('1');
            expect(params.get('b')).toBe('2');
        });

        await it('should support get/set/has/delete', async () => {
            const params = new URLSearchParams('a=1');
            expect(params.has('a')).toBeTruthy();
            expect(params.get('a')).toBe('1');
            params.set('a', '2');
            expect(params.get('a')).toBe('2');
            params.delete('a');
            expect(params.has('a')).toBeFalsy();
        });

        await it('should support append', async () => {
            const params = new URLSearchParams();
            params.append('a', '1');
            params.append('a', '2');
            expect(params.getAll('a').length).toBe(2);
        });

        await it('should support toString', async () => {
            const params = new URLSearchParams({ a: '1', b: '2' });
            const str = params.toString();
            expect(str.includes('a=1')).toBeTruthy();
            expect(str.includes('b=2')).toBeTruthy();
        });

        await it('should support forEach', async () => {
            const params = new URLSearchParams('a=1&b=2');
            const keys: string[] = [];
            params.forEach((_val, key) => keys.push(key));
            expect(keys.length).toBe(2);
        });

        await it('should support iteration', async () => {
            const params = new URLSearchParams('a=1&b=2');
            const entries: string[][] = [];
            for (const [key, value] of params) {
                entries.push([key, value]);
            }
            expect(entries.length).toBe(2);
        });
    });

    await describe('URLSearchParams append', async () => {
        await it('should append multiple values for same key', async () => {
            const params = new URLSearchParams();
            params.append('key', 'val1');
            params.append('key', 'val2');
            params.append('key', 'val3');
            expect(params.getAll('key').length).toBe(3);
            expect(params.get('key')).toBe('val1');
        });

        await it('should append empty value', async () => {
            const params = new URLSearchParams();
            params.append('key', '');
            expect(params.get('key')).toBe('');
            expect(params.has('key')).toBeTruthy();
        });

        await it('should append and show in toString', async () => {
            const params = new URLSearchParams();
            params.append('a', '1');
            params.append('b', '2');
            expect(params.toString()).toBe('a=1&b=2');
        });
    });

    await describe('URLSearchParams delete', async () => {
        await it('should delete all values for a key', async () => {
            const params = new URLSearchParams('a=1&a=2&b=3');
            params.delete('a');
            expect(params.has('a')).toBeFalsy();
            expect(params.get('a')).toBeNull();
            expect(params.get('b')).toBe('3');
        });

        await it('should not throw when deleting nonexistent key', async () => {
            const params = new URLSearchParams('a=1');
            params.delete('b');
            expect(params.toString()).toBe('a=1');
        });

        await it('should update URL search when deleting all params', async () => {
            const url = new URL('http://domain?var=1&var=2&var=3');
            for (const param of url.searchParams.keys()) {
                url.searchParams.delete(param);
            }
            expect(url.searchParams.toString()).toBe('');
            // The assertions that would have caught the original defect: the params object was
            // always right, `search` and `href` were not.
            expect(url.search).toBe('');
            expect(url.href).toBe('http://domain/');
        });
    });

    await describe('URLSearchParams get and getAll', async () => {
        await it('should return null for nonexistent key', async () => {
            const params = new URLSearchParams('a=1');
            expect(params.get('b')).toBeNull();
        });

        await it('should return first value for duplicate keys', async () => {
            const params = new URLSearchParams('a=1&a=2&a=3');
            expect(params.get('a')).toBe('1');
        });

        await it('should return all values with getAll', async () => {
            const params = new URLSearchParams('a=1&a=2&a=3');
            const all = params.getAll('a');
            expect(all.length).toBe(3);
            expect(all[0]).toBe('1');
            expect(all[1]).toBe('2');
            expect(all[2]).toBe('3');
        });

        await it('should return empty array for nonexistent key with getAll', async () => {
            const params = new URLSearchParams('a=1');
            const all = params.getAll('b');
            expect(all.length).toBe(0);
        });

        await it('should handle empty value', async () => {
            const params = new URLSearchParams('a=');
            expect(params.get('a')).toBe('');
        });

        await it('should handle key without value', async () => {
            const params = new URLSearchParams('a');
            expect(params.get('a')).toBe('');
        });
    });

    await describe('URLSearchParams has', async () => {
        await it('should return true for existing key', async () => {
            const params = new URLSearchParams('a=1&b=2');
            expect(params.has('a')).toBeTruthy();
            expect(params.has('b')).toBeTruthy();
        });

        await it('should return false for nonexistent key', async () => {
            const params = new URLSearchParams('a=1');
            expect(params.has('b')).toBeFalsy();
        });

        await it('should return true for key with empty value', async () => {
            const params = new URLSearchParams('a=');
            expect(params.has('a')).toBeTruthy();
        });

        await it('should return false after delete', async () => {
            const params = new URLSearchParams('a=1');
            params.delete('a');
            expect(params.has('a')).toBeFalsy();
        });
    });

    await describe('URLSearchParams set', async () => {
        await it('should set value for new key', async () => {
            const params = new URLSearchParams();
            params.set('a', '1');
            expect(params.get('a')).toBe('1');
        });

        await it('should replace existing value', async () => {
            const params = new URLSearchParams('a=old');
            params.set('a', 'new');
            expect(params.get('a')).toBe('new');
        });

        await it('should replace all duplicate values with single value', async () => {
            const params = new URLSearchParams('a=1&a=2&a=3');
            params.set('a', 'single');
            expect(params.get('a')).toBe('single');
            expect(params.getAll('a').length).toBe(1);
        });

        await it('should preserve other keys when setting', async () => {
            const params = new URLSearchParams('a=1&b=2&c=3');
            params.set('b', 'new');
            expect(params.get('a')).toBe('1');
            expect(params.get('b')).toBe('new');
            expect(params.get('c')).toBe('3');
        });
    });

    await describe('URLSearchParams sort', async () => {
        await it('should sort parameters by key name', async () => {
            const params = new URLSearchParams('z=a&c=d&a=b');
            params.sort();
            const result = params.toString();
            expect(result).toBe('a=b&c=d&z=a');
        });

        await it('should sort with empty key', async () => {
            const params = new URLSearchParams('z=a&=b&c=d');
            params.sort();
            const keys: string[] = [];
            for (const [k] of params) {
                keys.push(k);
            }
            expect(keys[0]).toBe('');
            expect(keys[1]).toBe('c');
            expect(keys[2]).toBe('z');
        });

        await it('should sort searchParams from URL', async () => {
            const url = new URL('https://example.com/?z=1&a=2');
            url.searchParams.sort();
            const keys: string[] = [];
            for (const [k] of url.searchParams) {
                keys.push(k);
            }
            expect(keys[0]).toBe('a');
            expect(keys[1]).toBe('z');
            // The iterator order alone said nothing about the URL — sort() is a mutation and has
            // to reach href like every other one.
            expect(url.search).toBe('?a=2&z=1');
        });

        await it('should be stable sort for same keys', async () => {
            const params = new URLSearchParams('a=2&a=1&a=3');
            params.sort();
            const values = params.getAll('a');
            expect(values[0]).toBe('2');
            expect(values[1]).toBe('1');
            expect(values[2]).toBe('3');
        });
    });

    // ==================== URLSearchParams: entries, keys, values ====================

    await describe('URLSearchParams iterators', async () => {
        await it('entries should return key-value pairs', async () => {
            const params = new URLSearchParams('a=1&b=2');
            const result: [string, string][] = [];
            for (const entry of params.entries()) {
                result.push(entry);
            }
            expect(result.length).toBe(2);
            expect(result[0][0]).toBe('a');
            expect(result[0][1]).toBe('1');
            expect(result[1][0]).toBe('b');
            expect(result[1][1]).toBe('2');
        });

        await it('keys should return all keys', async () => {
            const params = new URLSearchParams('a=1&b=2&c=3');
            const result: string[] = [];
            for (const key of params.keys()) {
                result.push(key);
            }
            expect(result.length).toBe(3);
            expect(result[0]).toBe('a');
            expect(result[1]).toBe('b');
            expect(result[2]).toBe('c');
        });

        await it('values should return all values', async () => {
            const params = new URLSearchParams('a=1&b=2&c=3');
            const result: string[] = [];
            for (const val of params.values()) {
                result.push(val);
            }
            expect(result.length).toBe(3);
            expect(result[0]).toBe('1');
            expect(result[1]).toBe('2');
            expect(result[2]).toBe('3');
        });

        await it('Symbol.iterator should be entries', async () => {
            const params = new URLSearchParams('a=1');
            const result: [string, string][] = [];
            for (const entry of params) {
                result.push(entry);
            }
            expect(result.length).toBe(1);
            expect(result[0][0]).toBe('a');
            expect(result[0][1]).toBe('1');
        });

        await it('keys should include duplicate keys', async () => {
            const params = new URLSearchParams('a=1&a=2');
            const result: string[] = [];
            for (const key of params.keys()) {
                result.push(key);
            }
            expect(result.length).toBe(2);
            expect(result[0]).toBe('a');
            expect(result[1]).toBe('a');
        });
    });

    await describe('URLSearchParams forEach', async () => {
        await it('should call callback for each entry', async () => {
            const params = new URLSearchParams('a=1&b=2&c=3');
            let count = 0;
            params.forEach(() => {
                count++;
            });
            expect(count).toBe(3);
        });

        await it('should pass value, key, and searchParams to callback', async () => {
            const params = new URLSearchParams('x=42');
            params.forEach((value, key, parent) => {
                expect(key).toBe('x');
                expect(value).toBe('42');
                expect(parent).toBe(params);
            });
        });

        await it('should iterate in insertion order', async () => {
            const params = new URLSearchParams();
            params.append('c', '3');
            params.append('a', '1');
            params.append('b', '2');
            const order: string[] = [];
            params.forEach((_v, k) => order.push(k));
            expect(order[0]).toBe('c');
            expect(order[1]).toBe('a');
            expect(order[2]).toBe('b');
        });
    });

    await describe('URLSearchParams toString', async () => {
        await it('should return empty string for empty params', async () => {
            const params = new URLSearchParams();
            expect(params.toString()).toBe('');
        });

        await it('should encode spaces as +', async () => {
            const params = new URLSearchParams('q=hello world');
            expect(params.toString()).toBe('q=hello+world');
        });

        await it('should encode special characters', async () => {
            const params = new URLSearchParams();
            params.append('key', 'value&with=special');
            const str = params.toString();
            expect(str.includes('key=')).toBeTruthy();
            // should not contain raw & or = in value
            expect(str.split('&').length).toBe(1);
        });

        await it('should handle multiple params', async () => {
            const params = new URLSearchParams('a=1&b=2&c=3');
            expect(params.toString()).toBe('a=1&b=2&c=3');
        });

        await it('should encode plus signs in values', async () => {
            const params = new URLSearchParams();
            params.set('a', '1+2');
            const str = params.toString();
            // plus signs in values should be encoded
            expect(str.includes('1%2B2') || str.includes('1+2')).toBeTruthy();
        });
    });

    await describe('URLSearchParams size', async () => {
        await it('should return 0 for empty params', async () => {
            const params = new URLSearchParams();
            expect(params.size).toBe(0);
        });

        await it('should return correct count', async () => {
            const params = new URLSearchParams('a=1&b=2&c=3');
            expect(params.size).toBe(3);
        });

        await it('should count duplicate keys separately', async () => {
            const params = new URLSearchParams();
            params.append('a', '1');
            params.append('a', '2');
            params.append('b', '3');
            expect(params.size).toBe(3);
        });

        await it('should decrease after delete', async () => {
            const params = new URLSearchParams('a=1&b=2');
            expect(params.size).toBe(2);
            params.delete('a');
            expect(params.size).toBe(1);
        });

        await it('should increase after append', async () => {
            const params = new URLSearchParams('a=1');
            expect(params.size).toBe(1);
            params.append('b', '2');
            expect(params.size).toBe(2);
        });
    });

    await describe('URLSearchParams construction edge cases', async () => {
        await it('should handle string with leading ?', async () => {
            const params = new URLSearchParams('?a=1&b=2');
            expect(params.get('a')).toBe('1');
            expect(params.get('b')).toBe('2');
        });

        await it('should handle empty string', async () => {
            const params = new URLSearchParams('');
            expect(params.size).toBe(0);
        });

        await it('should handle string with only ?', async () => {
            const params = new URLSearchParams('?');
            expect(params.size).toBe(0);
        });

        await it('should construct from another URLSearchParams', async () => {
            const original = new URLSearchParams('a=1&b=2');
            const copy = new URLSearchParams(original);
            expect(copy.get('a')).toBe('1');
            expect(copy.get('b')).toBe('2');
            // modifying copy should not affect original
            copy.set('a', 'changed');
            expect(original.get('a')).toBe('1');
        });

        await it('should handle plus signs as spaces', async () => {
            const params = new URLSearchParams('q=hello+world');
            expect(params.get('q')).toBe('hello world');
        });

        await it('should handle encoded characters', async () => {
            const params = new URLSearchParams('q=%E2%82%AC');
            expect(params.get('q')).toBe('\u20AC'); // Euro sign
        });

        await it('should handle param without value', async () => {
            const params = new URLSearchParams('key');
            expect(params.has('key')).toBeTruthy();
            expect(params.get('key')).toBe('');
        });

        await it('should handle multiple equal signs', async () => {
            const params = new URLSearchParams('a=1=2=3');
            expect(params.get('a')).toBe('1=2=3');
        });

        await it('should handle empty key and value', async () => {
            const params = new URLSearchParams('=');
            expect(params.has('')).toBeTruthy();
            expect(params.get('')).toBe('');
        });

        await it('should handle object with hasOwnProperty key', async () => {
            const params = new URLSearchParams({ hasOwnProperty: '1' } as Record<string, string>);
            expect(params.get('hasOwnProperty')).toBe('1');
        });
    });

    await describe('URL.searchParams integration', async () => {
        await it('should return searchParams linked to URL', async () => {
            const u = new URL('http://example.com/?a=1');
            const sp = u.searchParams;
            expect(sp.get('a')).toBe('1');
        });

        await it('should return same searchParams instance', async () => {
            const u = new URL('http://example.com/?a=1');
            expect(u.searchParams).toBe(u.searchParams);
        });

        await it('should return empty searchParams for no query', async () => {
            const u = new URL('http://example.com/');
            expect(u.searchParams.toString()).toBe('');
            expect(u.searchParams.size).toBe(0);
        });

        await it('should handle complex query params via URL', async () => {
            const u = new URL('http://example.com/?a=1&b=2&c=3&a=4');
            expect(u.searchParams.get('a')).toBe('1');
            expect(u.searchParams.getAll('a').length).toBe(2);
            expect(u.searchParams.get('b')).toBe('2');
            expect(u.searchParams.get('c')).toBe('3');
        });
    });

    await describe('URL relative resolution', async () => {
        await it('should resolve absolute path against base', async () => {
            const u = new URL('/new/path', 'http://example.com/old/path');
            expect(u.pathname).toBe('/new/path');
            expect(u.hostname).toBe('example.com');
        });

        await it('should resolve relative path against base directory', async () => {
            const u = new URL('sub', 'http://example.com/dir/');
            expect(u.pathname).toBe('/dir/sub');
        });

        await it('should resolve query-only relative URL', async () => {
            const u = new URL('?newquery', 'http://example.com/path');
            expect(u.pathname).toBe('/path');
            expect(u.search).toBe('?newquery');
        });

        await it('should resolve hash-only relative URL', async () => {
            const u = new URL('#newhash', 'http://example.com/path');
            expect(u.pathname).toBe('/path');
            expect(u.hash).toBe('#newhash');
        });

        await it('should resolve full URL ignoring base', async () => {
            const u = new URL('http://other.com/page', 'http://example.com/');
            expect(u.hostname).toBe('other.com');
            expect(u.pathname).toBe('/page');
        });

        await it('should handle double dot path resolution', async () => {
            const u = new URL('../../file', 'http://example.com/a/b/c/');
            expect(u.pathname).toBe('/a/file');
        });

        await it('should handle single dot path resolution', async () => {
            const u = new URL('./', 'http://example.com/a/b/');
            expect(u.pathname).toBe('/a/b/');
        });
    });

    await describe('fileURLToPath', async () => {
        const testCases = [
            { path: '/foo', fileURL: 'file:///foo' },
            { path: '/FOO', fileURL: 'file:///FOO' },
            { path: '/dir/foo', fileURL: 'file:///dir/foo' },
            { path: '/dir/', fileURL: 'file:///dir/' },
            { path: '/foo.mjs', fileURL: 'file:///foo.mjs' },
            { path: '/foo bar', fileURL: 'file:///foo%20bar' },
            { path: '/foo?bar', fileURL: 'file:///foo%3Fbar' },
            { path: '/foo#bar', fileURL: 'file:///foo%23bar' },
            { path: '/foo&bar', fileURL: 'file:///foo&bar' },
            { path: '/foo%bar', fileURL: 'file:///foo%25bar' },
            { path: '/fóóbàr', fileURL: 'file:///f%C3%B3%C3%B3b%C3%A0r' },
            { path: '/€', fileURL: 'file:///%E2%82%AC' },
            { path: '/🚀', fileURL: 'file:///%F0%9F%9A%80' },
        ];

        for (const tc of testCases) {
            await it(`should convert ${tc.fileURL} to ${tc.path}`, async () => {
                expect(fileURLToPath(tc.fileURL)).toBe(tc.path);
            });

            await it(`should convert URL object for ${tc.path}`, async () => {
                expect(fileURLToPath(new URL(tc.fileURL))).toBe(tc.path);
            });
        }

        await it('should throw for non-file protocol', async () => {
            expect(() => fileURLToPath('https://example.com')).toThrow();
        });
    });

    await describe('pathToFileURL', async () => {
        await it('should convert absolute path', async () => {
            const u = pathToFileURL('/foo/bar');
            expect(u.protocol).toBe('file:');
            expect(u.pathname).toBe('/foo/bar');
        });

        await it('should encode special characters', async () => {
            const u = pathToFileURL('/foo bar');
            expect(u.href).toBe('file:///foo%20bar');
        });

        await it('should handle root path', async () => {
            const u = pathToFileURL('/');
            expect(u.pathname).toBe('/');
        });

        await it('should handle path with dots', async () => {
            const u = pathToFileURL('/dir/file.txt');
            expect(u.pathname).toBe('/dir/file.txt');
        });

        await it('should handle deeply nested path', async () => {
            const u = pathToFileURL('/a/b/c/d/e');
            expect(u.pathname).toBe('/a/b/c/d/e');
            expect(u.protocol).toBe('file:');
        });

        await it('should encode a non-BMP character instead of throwing', async () => {
            // The encoder this replaced walked the string by UTF-16 INDEX and handed
            // `encodeURIComponent` one half of a surrogate pair, which raises
            // `URIError: URI malformed` — so every path containing an emoji threw (#1143).
            // The `fileURLToPath` direction has had a 🚀 case all along; this one did not.
            expect(pathToFileURL('/🚀').href).toBe('file:///%F0%9F%9A%80');
            expect(fileURLToPath(pathToFileURL('/dir/🚀.png'))).toBe('/dir/🚀.png');
        });

        await it('should not treat a win32 absolute path as relative', async () => {
            // `filepath[0] !== '/'` called every drive path relative and prepended the CWD.
            // Forced through `{ windows }` — Node's own escape hatch — so the win32 answer
            // is checked on the Linux runner instead of only on a win32 host.
            expect(pathToFileURL('C:\\app\\dist', { windows: true }).href).toBe('file:///C:/app/dist');
            expect(pathToFileURL('C:\\Program Files\\app', { windows: true }).href).toBe(
                'file:///C:/Program%20Files/app',
            );
        });

        await it('should map a UNC path to a URL with a host', async () => {
            const u = pathToFileURL('\\\\server\\share\\app', { windows: true });
            expect(u.href).toBe('file://server/share/app');
            expect(u.hostname).toBe('server');
            expect(u.pathname).toBe('/share/app');
        });

        await it('should round-trip a win32 path through fileURLToPath', async () => {
            for (const path of ['C:\\app\\dist\\main.js', 'C:\\Program Files\\a b\\x.png', '\\\\srv\\share\\x']) {
                const url = pathToFileURL(path, { windows: true });
                expect(fileURLToPath(url, { windows: true })).toBe(path);
            }
        });

        await it('should keep the POSIX answer when the shape does not say win32', async () => {
            // The regression guard for the whole change: a POSIX path must be untouched by
            // the win32 support, on every host.
            expect(pathToFileURL('/opt/app/dist').href).toBe('file:///opt/app/dist');
            expect(pathToFileURL('/tmp/back\\slash').href).toBe('file:///tmp/back%5Cslash');
        });
    });

    await describe('fileURLToPath (win32)', async () => {
        await it('should strip the URL slash before a drive letter', async () => {
            expect(fileURLToPath('file:///C:/app/dist', { windows: true })).toBe('C:\\app\\dist');
            expect(fileURLToPath('file:///C:/Program%20Files/app', { windows: true })).toBe('C:\\Program Files\\app');
        });

        await it('should read a host as a UNC server rather than refusing it', async () => {
            expect(fileURLToPath('file://server/share/x', { windows: true })).toBe('\\\\server\\share\\x');
        });

        await it('should still refuse a host off win32', async () => {
            // The message used to name `linux` on macOS too.
            expect(() => fileURLToPath('file://server/share/x', { windows: false })).toThrow('File URL host');
        });

        await it('should refuse an encoded separator in either spelling', async () => {
            // Node's rule is asymmetric, and the wording differs with it: on win32 BOTH
            // encodings are separators, on POSIX `%5C` is an ordinary character.
            expect(() => fileURLToPath('file:///C:/a%2Fb', { windows: true })).toThrow(
                'must not include encoded \\ or / characters',
            );
            expect(() => fileURLToPath('file:///C:/a%5Cb', { windows: true })).toThrow(
                'must not include encoded \\ or / characters',
            );
            expect(fileURLToPath('file:///a%5Cb', { windows: false })).toBe('/a\\b');
            expect(() => fileURLToPath('file:///a%2Fb', { windows: false })).toThrow(
                'must not include encoded / characters',
            );
        });
    });

    await describe('url.parse (legacy)', async () => {
        await it('should parse simple HTTP URL', async () => {
            const parsed = parse('http://example.com/path?query=value#hash');
            expect(parsed.protocol).toBe('http:');
            expect(parsed.hostname).toBe('example.com');
            expect(parsed.pathname).toBe('/path');
            expect(parsed.hash).toBe('#hash');
        });

        await it('should parse URL with port', async () => {
            const parsed = parse('http://example.com:8080/path');
            expect(parsed.port).toBe('8080');
            expect(parsed.hostname).toBe('example.com');
        });

        await it('should parse URL with auth', async () => {
            const parsed = parse('http://user:pass@example.com/');
            expect(parsed.auth).toBe('user:pass');
        });

        await it('should parse URL without path', async () => {
            const parsed = parse('http://example.com');
            expect(parsed.hostname).toBe('example.com');
        });

        await it('should parse query string', async () => {
            const parsed = parse('http://example.com?foo=bar&baz=quux');
            expect(parsed.search).toBe('?foo=bar&baz=quux');
        });

        await it('should parse HTTPS URL', async () => {
            const parsed = parse('https://secure.example.com/login');
            expect(parsed.protocol).toBe('https:');
            expect(parsed.hostname).toBe('secure.example.com');
            expect(parsed.pathname).toBe('/login');
        });

        await it('should handle URL with only hash', async () => {
            const parsed = parse('http://example.com#fragment');
            expect(parsed.hash).toBe('#fragment');
            expect(parsed.hostname).toBe('example.com');
        });

        await it('should return null for missing protocol', async () => {
            const parsed = parse('/path/to/resource');
            expect(parsed.protocol).toBeNull();
            expect(parsed.pathname).toBe('/path/to/resource');
        });

        await it('should handle empty search/query', async () => {
            const parsed = parse('http://example.com/path');
            expect(parsed.search).toBeNull();
            expect(parsed.query).toBeNull();
        });
    });

    await describe('url.format (legacy)', async () => {
        await it('should format parsed URL back to string', async () => {
            const original = 'http://example.com/path?query=1#hash';
            const parsed = parse(original);
            const formatted = format(parsed);
            expect(formatted).toBe(original);
        });

        await it('should format URL from object', async () => {
            const result = format({
                protocol: 'http:',
                hostname: 'example.com',
                pathname: '/path',
            });
            expect(result).toBe('http://example.com/path');
        });

        await it('should format URL with port', async () => {
            const result = format({
                protocol: 'http:',
                hostname: 'example.com',
                port: '3000',
                pathname: '/',
            });
            expect(result).toBe('http://example.com:3000/');
        });

        await it('should format URL with search', async () => {
            const result = format({
                protocol: 'https:',
                hostname: 'example.com',
                pathname: '/search',
                search: '?q=test',
            });
            expect(result).toBe('https://example.com/search?q=test');
        });

        await it('should format URL with hash', async () => {
            const result = format({
                protocol: 'http:',
                hostname: 'example.com',
                pathname: '/page',
                hash: '#section',
            });
            expect(result).toBe('http://example.com/page#section');
        });

        await it('should format URL with all components', async () => {
            const result = format({
                protocol: 'http:',
                hostname: 'example.com',
                port: '8080',
                pathname: '/path',
                search: '?a=1',
                hash: '#top',
            });
            expect(result).toBe('http://example.com:8080/path?a=1#top');
        });
    });

    await describe('url.resolve (legacy)', async () => {
        await it('should resolve absolute URL', async () => {
            const result = resolve('http://example.com/a/b', 'http://other.com/c');
            expect(result.includes('other.com')).toBeTruthy();
        });

        await it('should resolve relative path', async () => {
            const result = resolve('http://example.com/a/b', '/c');
            expect(result.includes('example.com')).toBeTruthy();
            expect(result.includes('/c')).toBeTruthy();
        });

        await it('should resolve sibling path', async () => {
            const result = resolve('http://example.com/a/b', 'c');
            expect(result).toBe('http://example.com/a/c');
        });

        await it('should resolve parent path with ..', async () => {
            const result = resolve('http://example.com/a/b/c', '../d');
            expect(result).toBe('http://example.com/a/d');
        });

        await it('should resolve with query string', async () => {
            const result = resolve('http://example.com/path', '?q=1');
            expect(result.includes('example.com')).toBeTruthy();
            expect(result.includes('q=1')).toBeTruthy();
        });

        await it('should resolve with hash', async () => {
            const result = resolve('http://example.com/path', '#frag');
            expect(result.includes('#frag')).toBeTruthy();
        });
    });
};
