import { describe, it, expect } from '@gjsify/unit';
import { URL, URLSearchParams, fileURLToPath, pathToFileURL, parse, format, resolve } from 'url';

// Ported from refs/node/test/parallel/test-url-*.js
// Original: MIT license, Node.js contributors

export default async () => {
	// ==================== URL constructor ====================

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
	});

	// ==================== URL properties ====================

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
	});

	// ==================== URLSearchParams ====================

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
			const params = new URLSearchParams([['a', '1'], ['b', '2']]);
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

		// sort() may not be implemented in GJS URLSearchParams
	});

	// ==================== fileURLToPath ====================

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

	// ==================== pathToFileURL ====================

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
	});

	// ==================== legacy parse ====================

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
	});

	// ==================== legacy format ====================

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
	});

	// ==================== legacy resolve ====================

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
	});
};
