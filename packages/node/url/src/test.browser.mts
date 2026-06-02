// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/url.
//
// Uses the browser-native `URL` / `URLSearchParams` globals directly (WHATWG
// URL standard). The Node-only legacy surface (`parse`, `format`, `resolve`,
// `fileURLToPath`, `pathToFileURL`) is intentionally out of scope — it has no
// browser pendant. This entry validates the WHATWG URL contract our GJS
// polyfill mirrors.

import { run, describe, it, expect } from '@gjsify/unit';

run({
    async UrlTest() {
        await describe('URL constructor', async () => {
            await it('parses a full HTTP URL', async () => {
                const u = new URL('http://example.com:8080/path?query=1#hash');
                expect(u.protocol).toBe('http:');
                expect(u.hostname).toBe('example.com');
                expect(u.port).toBe('8080');
                expect(u.pathname).toBe('/path');
                expect(u.search).toBe('?query=1');
                expect(u.hash).toBe('#hash');
            });

            await it('parses credentials from an HTTPS URL', async () => {
                const u = new URL('https://user:pass@example.com/path');
                expect(u.protocol).toBe('https:');
                expect(u.username).toBe('user');
                expect(u.password).toBe('pass');
                expect(u.hostname).toBe('example.com');
            });

            await it('resolves a relative URL against a base', async () => {
                const u = new URL('/path', 'http://example.com');
                expect(u.pathname).toBe('/path');
                expect(u.hostname).toBe('example.com');
            });

            await it('resolves .. in a relative path against a base', async () => {
                const u = new URL('../bar', 'http://example.com/a/b/');
                expect(u.pathname).toBe('/a/bar');
            });

            await it('throws on an invalid URL', async () => {
                expect(() => new URL('not-a-url')).toThrow();
                expect(() => new URL('')).toThrow();
            });

            await it('accepts a URL object as input and base', async () => {
                const base = new URL('http://example.com/base/');
                const u = new URL('relative', base);
                expect(u.hostname).toBe('example.com');
                expect(u.pathname).toBe('/base/relative');
            });
        });

        await describe('URL properties', async () => {
            await it('exposes searchParams', async () => {
                const u = new URL('http://example.com/?a=1&b=2');
                expect(u.searchParams.get('a')).toBe('1');
                expect(u.searchParams.get('b')).toBe('2');
            });

            await it('computes origin for special protocols', async () => {
                expect(new URL('http://example.com:8080/path').origin).toBe('http://example.com:8080');
                expect(new URL('https://example.com/path').origin).toBe('https://example.com');
            });

            await it('strips default ports', async () => {
                expect(new URL('http://example.com:80/path').port).toBe('');
                expect(new URL('https://example.com:443/path').port).toBe('');
            });

            await it('returns "null" origin for data: URLs', async () => {
                expect(new URL('data:text/plain,hello').origin).toBe('null');
            });

            await it('serializes via href / toString / toJSON', async () => {
                const u = new URL('http://user:pass@example.com:8080/path?q=1#h');
                expect(u.href).toBe('http://user:pass@example.com:8080/path?q=1#h');
                expect(u.toString()).toBe(u.href);
                expect(u.toJSON()).toBe(u.href);
            });
        });

        await describe('URL percent encoding', async () => {
            await it('decodes percent-encoded query values', async () => {
                const u = new URL('http://example.com/?name=hello%20world');
                expect(u.searchParams.get('name')).toBe('hello world');
            });

            await it('preserves encoded characters in the path', async () => {
                const u = new URL('http://example.com/path%3Fwith%23special');
                expect(u.pathname).toBe('/path%3Fwith%23special');
            });
        });

        await describe('URLSearchParams', async () => {
            await it('constructs from a string', async () => {
                const params = new URLSearchParams('a=1&b=2');
                expect(params.get('a')).toBe('1');
                expect(params.get('b')).toBe('2');
            });

            await it('constructs from an object and from entries', async () => {
                expect(new URLSearchParams({ foo: 'bar' }).get('foo')).toBe('bar');
                expect(
                    new URLSearchParams([
                        ['a', '1'],
                        ['b', '2'],
                    ]).get('b'),
                ).toBe('2');
            });

            await it('supports get / set / has / delete', async () => {
                const params = new URLSearchParams('a=1');
                expect(params.has('a')).toBeTruthy();
                params.set('a', '2');
                expect(params.get('a')).toBe('2');
                params.delete('a');
                expect(params.has('a')).toBeFalsy();
                expect(params.get('a')).toBeNull();
            });

            await it('supports append / getAll', async () => {
                const params = new URLSearchParams();
                params.append('a', '1');
                params.append('a', '2');
                expect(params.getAll('a').length).toBe(2);
                expect(params.get('a')).toBe('1');
            });

            await it('supports toString and iteration', async () => {
                const params = new URLSearchParams('a=1&b=2');
                expect(params.toString()).toBe('a=1&b=2');
                const keys: string[] = [];
                params.forEach((_val, key) => keys.push(key));
                expect(keys.length).toBe(2);
            });
        });
    },
});
