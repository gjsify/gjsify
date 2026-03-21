import { describe, it, expect } from '@gjsify/unit';

import path from 'path';

export default async () => {

	await describe('path.basename', async () => {
		await it('should return the last portion of a path', async () => {
			expect(path.basename('/foo/bar/baz.html')).toBe('baz.html');
		});

		await it('should strip the extension when provided', async () => {
			expect(path.basename('/foo/bar/baz.html', '.html')).toBe('baz');
		});

		await it('should handle paths without directory', async () => {
			expect(path.basename('baz.html')).toBe('baz.html');
		});

		await it('should handle trailing separators', async () => {
			expect(path.basename('/foo/bar/')).toBe('bar');
		});

		await it('should return empty string for empty input', async () => {
			expect(path.basename('')).toBe('');
		});
	});

	await describe('path.dirname', async () => {
		await it('should return the directory of a path', async () => {
			expect(path.dirname('/foo/bar/baz.html')).toBe('/foo/bar');
		});

		await it('should return . for filename only', async () => {
			expect(path.dirname('baz.html')).toBe('.');
		});

		await it('should return / for root path', async () => {
			expect(path.dirname('/foo')).toBe('/');
		});

		await it('should return . for empty string', async () => {
			expect(path.dirname('')).toBe('.');
		});
	});

	await describe('path.extname', async () => {
		await it('should return the extension of a path', async () => {
			expect(path.extname('index.html')).toBe('.html');
		});

		await it('should return the last extension', async () => {
			expect(path.extname('index.coffee.md')).toBe('.md');
		});

		await it('should return empty string for no extension', async () => {
			expect(path.extname('index')).toBe('');
		});

		await it('should return empty string for dotfiles', async () => {
			expect(path.extname('.index')).toBe('');
		});

		await it('should handle dotfile with extension', async () => {
			expect(path.extname('.index.md')).toBe('.md');
		});

		await it('should return empty string for trailing dot', async () => {
			expect(path.extname('index.')).toBe('.');
		});
	});

	await describe('path.join', async () => {
		await it('should join path segments', async () => {
			expect(path.join('/foo', 'bar', 'baz/asdf', 'quux', '..')).toBe('/foo/bar/baz/asdf');
		});

		await it('should return . for no arguments', async () => {
			expect(path.join()).toBe('.');
		});

		await it('should normalize the result', async () => {
			expect(path.join('foo', 'bar', '..', 'baz')).toBe('foo/baz');
		});

		await it('should handle absolute paths', async () => {
			expect(path.join('/foo', '/bar')).toBe('/foo/bar');
		});
	});

	await describe('path.normalize', async () => {
		await it('should resolve .. and .', async () => {
			expect(path.normalize('/foo/bar//baz/asdf/quux/..')).toBe('/foo/bar/baz/asdf');
		});

		await it('should return . for empty string', async () => {
			expect(path.normalize('')).toBe('.');
		});

		await it('should preserve trailing slash', async () => {
			expect(path.normalize('/foo/bar/')).toBe('/foo/bar/');
		});
	});

	await describe('path.isAbsolute', async () => {
		await it('should return true for absolute paths', async () => {
			expect(path.isAbsolute('/foo/bar')).toBeTruthy();
			expect(path.isAbsolute('/baz/..')).toBeTruthy();
		});

		await it('should return false for relative paths', async () => {
			expect(path.isAbsolute('qux/')).toBeFalsy();
			expect(path.isAbsolute('.')).toBeFalsy();
			expect(path.isAbsolute('')).toBeFalsy();
		});
	});

	await describe('path.resolve', async () => {
		await it('should resolve absolute path', async () => {
			const result = path.resolve('/foo/bar', './baz');
			expect(result).toBe('/foo/bar/baz');
		});

		await it('should resolve with absolute segment', async () => {
			const result = path.resolve('/foo/bar', '/tmp/file/');
			expect(result).toBe('/tmp/file');
		});

		await it('should handle relative paths', async () => {
			const result = path.resolve('foo', 'bar', 'baz');
			expect(path.isAbsolute(result)).toBeTruthy();
		});
	});

	await describe('path.relative', async () => {
		await it('should compute relative path', async () => {
			expect(path.relative('/data/orandea/test/aaa', '/data/orandea/impl/bbb')).toBe('../../impl/bbb');
		});

		await it('should return empty string for same path', async () => {
			expect(path.relative('/foo/bar', '/foo/bar')).toBe('');
		});
	});

	await describe('path.parse', async () => {
		await it('should parse a path into components', async () => {
			const parsed = path.parse('/home/user/dir/file.txt');
			expect(parsed.root).toBe('/');
			expect(parsed.dir).toBe('/home/user/dir');
			expect(parsed.base).toBe('file.txt');
			expect(parsed.ext).toBe('.txt');
			expect(parsed.name).toBe('file');
		});

		await it('should handle root path', async () => {
			const parsed = path.parse('/');
			expect(parsed.root).toBe('/');
		});

		await it('should handle relative path', async () => {
			const parsed = path.parse('file.txt');
			expect(parsed.root).toBe('');
			expect(parsed.base).toBe('file.txt');
		});
	});

	await describe('path.format', async () => {
		await it('should format a path object', async () => {
			expect(path.format({
				root: '/',
				dir: '/home/user/dir',
				base: 'file.txt'
			})).toBe('/home/user/dir/file.txt');
		});

		await it('should use name and ext if base is not provided', async () => {
			expect(path.format({
				root: '/',
				name: 'file',
				ext: '.txt'
			})).toBe('/file.txt');
		});
	});

	await describe('path.sep and path.delimiter', async () => {
		await it('should have correct separator', async () => {
			expect(path.sep).toBe('/');
		});

		await it('should have correct delimiter', async () => {
			expect(path.delimiter).toBe(':');
		});
	});

	await describe('path.toNamespacedPath', async () => {
		await it('should be a no-op on POSIX', async () => {
			expect(path.toNamespacedPath('/foo/bar')).toBe('/foo/bar');
		});
	});

	await describe('path.posix and path.win32', async () => {
		await it('should export posix sub-module', async () => {
			expect(path.posix).toBeDefined();
			expect(typeof path.posix.join).toBe('function');
		});

		await it('should export win32 sub-module', async () => {
			expect(path.win32).toBeDefined();
			expect(typeof path.win32.join).toBe('function');
		});

		await it('posix should have / separator', async () => {
			expect(path.posix.sep).toBe('/');
		});

		await it('win32 should have \\\\ separator', async () => {
			expect(path.win32.sep).toBe('\\');
		});
	});
}
