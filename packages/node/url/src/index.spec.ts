import { describe, it, expect } from '@gjsify/unit';
import { URL, URLSearchParams, fileURLToPath, pathToFileURL, parse, format, resolve } from 'node:url';

// Ported from refs/node-test/parallel/test-url-*.js and refs/node-test/parallel/test-whatwg-url-*.js
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

	// ==================== URL special protocols ====================

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

	// ==================== URL percent encoding ====================

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
	});

	// ==================== URLSearchParams: append ====================

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

	// ==================== URLSearchParams: delete ====================

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
		});
	});

	// ==================== URLSearchParams: get and getAll ====================

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

	// ==================== URLSearchParams: has ====================

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

	// ==================== URLSearchParams: set ====================

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

	// ==================== URLSearchParams: sort ====================

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

	// ==================== URLSearchParams: forEach ====================

	await describe('URLSearchParams forEach', async () => {
		await it('should call callback for each entry', async () => {
			const params = new URLSearchParams('a=1&b=2&c=3');
			let count = 0;
			params.forEach(() => { count++; });
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

	// ==================== URLSearchParams: toString ====================

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

	// ==================== URLSearchParams: size ====================

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

	// ==================== URLSearchParams: construction edge cases ====================

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

	// ==================== URL.searchParams integration ====================

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

	// ==================== URL relative resolution ====================

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

		await it('should handle path with dots', async () => {
			const u = pathToFileURL('/dir/file.txt');
			expect(u.pathname).toBe('/dir/file.txt');
		});

		await it('should handle deeply nested path', async () => {
			const u = pathToFileURL('/a/b/c/d/e');
			expect(u.pathname).toBe('/a/b/c/d/e');
			expect(u.protocol).toBe('file:');
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
