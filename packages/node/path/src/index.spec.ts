// Ported from refs/node-test/parallel/test-path-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';

import path from 'node:path';
import process from 'node:process';

export default async () => {

	// ===== path.basename =====

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

		await it('should return empty when ext matches base exactly', async () => {
			expect(path.basename('.js', '.js')).toBe('');
			expect(path.basename('a', 'a')).toBe('');
		});

		await it('should not strip mismatched extension', async () => {
			expect(path.basename('file.js', '.ts')).toBe('file.js');
			expect(path.basename('js', '.js')).toBe('js');
			expect(path.basename('file', '.js')).toBe('file');
		});

		await it('should strip compound extension', async () => {
			expect(path.basename('file.js.old', '.js.old')).toBe('file');
		});

		await it('should handle double trailing slashes', async () => {
			expect(path.basename('basename.ext//')).toBe('basename.ext');
		});

		await it('should handle partial ext match', async () => {
			expect(path.basename('aaa/bbb', 'bb')).toBe('b');
			expect(path.basename('aaa/bbb', 'b')).toBe('bb');
			expect(path.basename('/aaa/bbb', 'bb')).toBe('b');
			expect(path.basename('/aaa/bbb', 'b')).toBe('bb');
		});

		await it('should handle ext containing path separator', async () => {
			expect(path.basename('aaa/bbb', '/bbb')).toBe('bbb');
			expect(path.basename('aaa/bbb', 'a/bbb')).toBe('bbb');
			expect(path.basename('/aaa/bbb', '/bbb')).toBe('bbb');
			expect(path.basename('/aaa/bbb', 'a/bbb')).toBe('bbb');
		});

		await it('should handle various absolute paths', async () => {
			expect(path.basename('/dir/basename.ext')).toBe('basename.ext');
			expect(path.basename('/basename.ext')).toBe('basename.ext');
			expect(path.basename('/aaa/')).toBe('aaa');
			expect(path.basename('/aaa/b')).toBe('b');
			expect(path.basename('/a/b')).toBe('b');
			expect(path.basename('//a')).toBe('a');
		});
	});

	// ===== path.dirname =====

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

		await it('should handle posix paths correctly', async () => {
			expect(path.posix.dirname('/a/b/')).toBe('/a');
			expect(path.posix.dirname('/a/b')).toBe('/a');
			expect(path.posix.dirname('/a')).toBe('/');
			expect(path.posix.dirname('/')).toBe('/');
			expect(path.posix.dirname('////')).toBe('/');
			expect(path.posix.dirname('//a')).toBe('//');
			expect(path.posix.dirname('foo')).toBe('.');
		});
	});

	// ===== path.extname =====

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

		await it('should return dot for trailing dot', async () => {
			expect(path.extname('index.')).toBe('.');
		});

		await it('should handle paths with directories', async () => {
			expect(path.extname('/path/to/file')).toBe('');
			expect(path.extname('/path/to/file.ext')).toBe('.ext');
			expect(path.extname('/path.to/file.ext')).toBe('.ext');
			expect(path.extname('/path.to/file')).toBe('');
			expect(path.extname('/path.to/.file')).toBe('');
			expect(path.extname('/path.to/.file.ext')).toBe('.ext');
			expect(path.extname('/path/to/f.ext')).toBe('.ext');
			expect(path.extname('/path/to/..ext')).toBe('.ext');
			expect(path.extname('/path/to/..')).toBe('');
		});

		await it('should handle dotfile edge cases', async () => {
			expect(path.extname('.file')).toBe('');
			expect(path.extname('.file.ext')).toBe('.ext');
			expect(path.extname('.file.')).toBe('.');
			expect(path.extname('.file..')).toBe('.');
			expect(path.extname('..file.ext')).toBe('.ext');
			expect(path.extname('..file')).toBe('.file');
			expect(path.extname('..file.')).toBe('.');
			expect(path.extname('..file..')).toBe('.');
		});

		await it('should handle multiple dots', async () => {
			expect(path.extname('...')).toBe('.');
			expect(path.extname('...ext')).toBe('.ext');
			expect(path.extname('....')).toBe('.');
			expect(path.extname('file.ext.ext')).toBe('.ext');
		});

		await it('should handle trailing slashes', async () => {
			expect(path.extname('./')).toBe('');
			expect(path.extname('../')).toBe('');
			expect(path.extname('file.ext/')).toBe('.ext');
			expect(path.extname('file.ext//')).toBe('.ext');
			expect(path.extname('file/')).toBe('');
			expect(path.extname('file//')).toBe('');
			expect(path.extname('file./')).toBe('.');
			expect(path.extname('file.//')).toBe('.');
		});

		await it('should handle root paths', async () => {
			expect(path.extname('.')).toBe('');
			expect(path.extname('..')).toBe('');
			expect(path.extname('/file')).toBe('');
			expect(path.extname('/file.ext')).toBe('.ext');
			expect(path.extname('/.file')).toBe('');
			expect(path.extname('/.file.ext')).toBe('.ext');
		});
	});

	// ===== path.join =====

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

		await it('should handle dot segments', async () => {
			expect(path.join('.', 'x/b', '..', '/b/c.js')).toBe('x/b/c.js');
			expect(path.join('/.', 'x/b', '..', '/b/c.js')).toBe('/x/b/c.js');
		});

		await it('should resolve parent traversal beyond root', async () => {
			expect(path.join('/foo', '../../../bar')).toBe('/bar');
			expect(path.join('foo', '../../../bar')).toBe('../../bar');
			expect(path.join('foo/', '../../../bar')).toBe('../../bar');
			expect(path.join('foo/x', '../../../bar')).toBe('../bar');
		});

		await it('should handle ./bar joins', async () => {
			expect(path.join('foo/x', './bar')).toBe('foo/x/bar');
			expect(path.join('foo/x/', './bar')).toBe('foo/x/bar');
			expect(path.join('foo/x/', '.', 'bar')).toBe('foo/x/bar');
		});

		await it('should handle trailing ./', async () => {
			expect(path.join('./')).toBe('./');
			expect(path.join('.', './')).toBe('./');
		});

		await it('should handle multiple dot segments', async () => {
			expect(path.join('.', '.', '.')).toBe('.');
			expect(path.join('.', './', '.')).toBe('.');
			expect(path.join('.', '/./', '.')).toBe('.');
			expect(path.join('.', '/////./', '.')).toBe('.');
			expect(path.join('.')).toBe('.');
		});

		await it('should handle empty string arguments', async () => {
			expect(path.join('', '.')).toBe('.');
			expect(path.join('', 'foo')).toBe('foo');
			expect(path.join('', '/foo')).toBe('/foo');
			expect(path.join('', '', '/foo')).toBe('/foo');
			expect(path.join('', '', 'foo')).toBe('foo');
			expect(path.join('foo', '')).toBe('foo');
			expect(path.join('foo/', '')).toBe('foo/');
			expect(path.join('foo', '', '/bar')).toBe('foo/bar');
			expect(path.join('')).toBe('.');
			expect(path.join('', '')).toBe('.');
		});

		await it('should handle complex .. chains', async () => {
			expect(path.join('./', '..', '/foo')).toBe('../foo');
			expect(path.join('./', '..', '..', '/foo')).toBe('../../foo');
			expect(path.join('.', '..', '..', '/foo')).toBe('../../foo');
			expect(path.join('', '..', '..', '/foo')).toBe('../../foo');
		});

		await it('should handle root paths', async () => {
			expect(path.join('/')).toBe('/');
			expect(path.join('/', '.')).toBe('/');
			expect(path.join('/', '..')).toBe('/');
			expect(path.join('/', '..', '..')).toBe('/');
		});

		await it('should handle leading space in paths', async () => {
			expect(path.join(' /foo')).toBe(' /foo');
			expect(path.join(' ', 'foo')).toBe(' /foo');
			expect(path.join(' ', '.')).toBe(' ');
			expect(path.join(' ', '/')).toBe(' /');
			expect(path.join(' ', '')).toBe(' ');
		});

		await it('should handle multiple absolute segments', async () => {
			expect(path.join('/', 'foo')).toBe('/foo');
			expect(path.join('/', '/foo')).toBe('/foo');
			expect(path.join('/', '//foo')).toBe('/foo');
			expect(path.join('/', '', '/foo')).toBe('/foo');
			expect(path.join('', '/', 'foo')).toBe('/foo');
			expect(path.join('', '/', '/foo')).toBe('/foo');
		});
	});

	// ===== path.normalize =====

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

		await it('should normalize fixtures path with ..', async () => {
			expect(path.posix.normalize('./fixtures///b/../b/c.js')).toBe('fixtures/b/c.js');
		});

		await it('should not go above root with ..', async () => {
			expect(path.posix.normalize('/foo/../../../bar')).toBe('/bar');
		});

		await it('should collapse double slashes and ..', async () => {
			expect(path.posix.normalize('a//b//../b')).toBe('a/b');
		});

		await it('should collapse double slashes and .', async () => {
			expect(path.posix.normalize('a//b//./c')).toBe('a/b/c');
			expect(path.posix.normalize('a//b//.')).toBe('a/b');
		});

		await it('should handle deeply nested ..', async () => {
			expect(path.posix.normalize('/a/b/c/../../../x/y/z')).toBe('/x/y/z');
		});

		await it('should handle leading triple slashes and dots', async () => {
			expect(path.posix.normalize('///..//./foo/.//bar')).toBe('/foo/bar');
		});

		await it('should handle foo.. patterns (not real ..)', async () => {
			expect(path.posix.normalize('bar/foo../../')).toBe('bar/');
			expect(path.posix.normalize('bar/foo../..')).toBe('bar');
			expect(path.posix.normalize('bar/foo../../baz')).toBe('bar/baz');
			expect(path.posix.normalize('bar/foo../')).toBe('bar/foo../');
			expect(path.posix.normalize('bar/foo..')).toBe('bar/foo..');
		});

		await it('should handle complex relative .. chains', async () => {
			expect(path.posix.normalize('../foo../../../bar')).toBe('../../bar');
			expect(path.posix.normalize('../.../.././.../../../bar')).toBe('../../bar');
			expect(path.posix.normalize('../../../foo/../../../bar')).toBe('../../../../../bar');
			expect(path.posix.normalize('../../../foo/../../../bar/../../')).toBe('../../../../../../');
			expect(path.posix.normalize('../foobar/barfoo/foo/../../../bar/../../')).toBe('../../');
			expect(path.posix.normalize('../.../../foobar/../../../bar/../../baz')).toBe('../../../../baz');
		});

		await it('should treat backslash as normal character on posix', async () => {
			expect(path.posix.normalize('foo/bar\\baz')).toBe('foo/bar\\baz');
		});
	});

	// ===== path.isAbsolute =====

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

		await it('posix: should detect absolute paths', async () => {
			expect(path.posix.isAbsolute('/home/foo')).toBeTruthy();
			expect(path.posix.isAbsolute('/home/foo/..')).toBeTruthy();
		});

		await it('posix: should detect relative paths', async () => {
			expect(path.posix.isAbsolute('bar/')).toBeFalsy();
			expect(path.posix.isAbsolute('./baz')).toBeFalsy();
		});

		await it('win32: should detect absolute paths', async () => {
			expect(path.win32.isAbsolute('/')).toBeTruthy();
			expect(path.win32.isAbsolute('//')).toBeTruthy();
			expect(path.win32.isAbsolute('//server')).toBeTruthy();
			expect(path.win32.isAbsolute('//server/file')).toBeTruthy();
			expect(path.win32.isAbsolute('\\\\server\\file')).toBeTruthy();
			expect(path.win32.isAbsolute('\\\\server')).toBeTruthy();
			expect(path.win32.isAbsolute('\\\\')).toBeTruthy();
			expect(path.win32.isAbsolute('c:\\')).toBeTruthy();
			expect(path.win32.isAbsolute('c:/')).toBeTruthy();
			expect(path.win32.isAbsolute('c://')).toBeTruthy();
			expect(path.win32.isAbsolute('C:/Users/')).toBeTruthy();
			expect(path.win32.isAbsolute('C:\\Users\\')).toBeTruthy();
		});

		await it('win32: should detect relative paths', async () => {
			expect(path.win32.isAbsolute('c')).toBeFalsy();
			expect(path.win32.isAbsolute('c:')).toBeFalsy();
			expect(path.win32.isAbsolute('C:cwd/another')).toBeFalsy();
			expect(path.win32.isAbsolute('C:cwd\\another')).toBeFalsy();
			expect(path.win32.isAbsolute('directory/directory')).toBeFalsy();
			expect(path.win32.isAbsolute('directory\\directory')).toBeFalsy();
		});
	});

	// ===== path.resolve =====

	await describe('path.resolve', async () => {
		await it('should resolve absolute path with relative segment', async () => {
			const result = path.resolve('/foo/bar', './baz');
			expect(result).toBe('/foo/bar/baz');
		});

		await it('should resolve with absolute segment (later arg wins)', async () => {
			const result = path.resolve('/foo/bar', '/tmp/file/');
			expect(result).toBe('/tmp/file');
		});

		await it('should handle relative paths by prepending cwd', async () => {
			const result = path.resolve('foo', 'bar', 'baz');
			expect(path.isAbsolute(result)).toBeTruthy();
		});

		await it('posix: should resolve /var/lib with ../ and file/', async () => {
			expect(path.posix.resolve('/var/lib', '../', 'file/')).toBe('/var/file');
		});

		await it('posix: should resolve /../ to root', async () => {
			expect(path.posix.resolve('/var/lib', '/../', 'file/')).toBe('/file');
		});

		await it('posix: should resolve with later absolute overriding earlier', async () => {
			expect(path.posix.resolve('/some/dir', '.', '/absolute/')).toBe('/absolute');
		});

		await it('posix: should resolve relative cycles with ..', async () => {
			expect(path.posix.resolve('/foo/tmp.3/', '../tmp.3/cycles/root.js')).toBe('/foo/tmp.3/cycles/root.js');
		});

		await it('should resolve no args or empty string to cwd', async () => {
			const cwd = process.cwd();
			expect(path.resolve()).toBe(cwd);
			expect(path.resolve('')).toBe(cwd);
			expect(path.resolve('.')).toBe(cwd);
		});

		await it('should always return an absolute path', async () => {
			expect(path.isAbsolute(path.resolve('a', 'b', 'c'))).toBeTruthy();
			expect(path.isAbsolute(path.resolve('/a', 'b', 'c'))).toBeTruthy();
			expect(path.isAbsolute(path.resolve('.'))).toBeTruthy();
		});
	});

	// ===== path.relative =====

	await describe('path.relative', async () => {
		await it('should compute relative path', async () => {
			expect(path.relative('/data/orandea/test/aaa', '/data/orandea/impl/bbb')).toBe('../../impl/bbb');
		});

		await it('should return empty string for same path', async () => {
			expect(path.relative('/foo/bar', '/foo/bar')).toBe('');
		});

		await it('posix: should compute parent with ..', async () => {
			expect(path.posix.relative('/var/lib', '/var')).toBe('..');
		});

		await it('posix: should compute sibling directory', async () => {
			expect(path.posix.relative('/var/lib', '/bin')).toBe('../../bin');
			expect(path.posix.relative('/var/lib', '/var/apache')).toBe('../apache');
		});

		await it('posix: should compute child from trailing slash', async () => {
			expect(path.posix.relative('/var/', '/var/lib')).toBe('lib');
		});

		await it('posix: should compute child from root', async () => {
			expect(path.posix.relative('/', '/var/lib')).toBe('var/lib');
		});

		await it('posix: should compute child with nested path', async () => {
			expect(path.posix.relative('/foo/test', '/foo/test/bar/package.json')).toBe('bar/package.json');
		});

		await it('posix: should traverse up multiple levels', async () => {
			expect(path.posix.relative('/Users/a/web/b/test/mails', '/Users/a/web/b')).toBe('../..');
		});

		await it('posix: should handle baz-quux vs baz (not a prefix match)', async () => {
			expect(path.posix.relative('/foo/bar/baz-quux', '/foo/bar/baz')).toBe('../baz');
			expect(path.posix.relative('/foo/bar/baz', '/foo/bar/baz-quux')).toBe('../baz-quux');
		});

		await it('posix: should handle root-level baz-quux vs baz', async () => {
			expect(path.posix.relative('/baz-quux', '/baz')).toBe('../baz');
			expect(path.posix.relative('/baz', '/baz-quux')).toBe('../baz-quux');
		});

		await it('posix: should traverse from deep path to root', async () => {
			expect(path.posix.relative('/page1/page2/foo', '/')).toBe('../../..');
		});

		await it('should handle empty strings as cwd', async () => {
			const cwd = process.cwd();
			expect(path.relative('', cwd)).toBe('');
			expect(path.relative(cwd, '')).toBe('');
			expect(path.relative(cwd, cwd)).toBe('');
		});
	});

	// ===== path.parse =====

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
			expect(parsed.dir).toBe('/');
			expect(parsed.base).toBe('');
			expect(parsed.ext).toBe('');
			expect(parsed.name).toBe('');
		});

		await it('should handle relative path', async () => {
			const parsed = path.parse('file.txt');
			expect(parsed.root).toBe('');
			expect(parsed.base).toBe('file.txt');
			expect(parsed.name).toBe('file');
			expect(parsed.ext).toBe('.txt');
			expect(parsed.dir).toBe('');
		});

		await it('should return all string-typed fields', async () => {
			const parsed = path.parse('/home/user/dir/file.txt');
			expect(typeof parsed.root).toBe('string');
			expect(typeof parsed.dir).toBe('string');
			expect(typeof parsed.base).toBe('string');
			expect(typeof parsed.ext).toBe('string');
			expect(typeof parsed.name).toBe('string');
		});

		await it('should roundtrip with format for unix paths', async () => {
			const unixPaths = [
				'/home/user/dir/file.txt',
				'/home/user/a dir/another File.zip',
				'/home/user/a dir//another&File.',
				'/home/user/a$$$dir//another File.zip',
				'user/dir/another File.zip',
				'file',
				'.\\file',
				'./file',
				'C:\\foo',
				'/',
				'',
				'.',
				'..',
				'/foo',
				'/foo.',
				'/foo.bar',
				'/.',
				'/.foo',
				'/.foo.bar',
				'/foo/bar.baz',
			];
			for (const p of unixPaths) {
				const output = path.posix.parse(p);
				expect(path.posix.format(output)).toBe(p);
			}
		});

		await it('should parse dotfiles correctly', async () => {
			const parsed = path.parse('/.foo');
			expect(parsed.root).toBe('/');
			expect(parsed.base).toBe('.foo');
			expect(parsed.ext).toBe('');
			expect(parsed.name).toBe('.foo');
		});

		await it('should parse dotfile with extension', async () => {
			const parsed = path.parse('/.foo.bar');
			expect(parsed.root).toBe('/');
			expect(parsed.base).toBe('.foo.bar');
			expect(parsed.ext).toBe('.bar');
			expect(parsed.name).toBe('.foo');
		});

		await it('should handle filename with trailing dot', async () => {
			const parsed = path.parse('/foo.');
			expect(parsed.root).toBe('/');
			expect(parsed.base).toBe('foo.');
			expect(parsed.ext).toBe('.');
			expect(parsed.name).toBe('foo');
		});

		await it('should handle empty root for relative paths', async () => {
			const tests: [string, string][] = [
				['user/dir/another File.zip', ''],
				['file', ''],
				['.\\file', ''],
				['./file', ''],
				['C:\\foo', ''],
				['.', ''],
				['..', ''],
			];
			for (const [p, expectedRoot] of tests) {
				const parsed = path.posix.parse(p);
				expect(parsed.root).toBe(expectedRoot);
			}
		});

		await it('should have dir starting with root', async () => {
			const pathsToCheck = [
				'/home/user/dir/file.txt',
				'/foo',
				'/foo.bar',
				'/foo/bar.baz',
			];
			for (const p of pathsToCheck) {
				const parsed = path.parse(p);
				expect(parsed.dir.startsWith(parsed.root)).toBeTruthy();
			}
		});

		await it('posix: should handle trailing separators on parse', async () => {
			let parsed = path.posix.parse('./');
			expect(parsed.root).toBe('');
			expect(parsed.dir).toBe('');
			expect(parsed.base).toBe('.');
			expect(parsed.ext).toBe('');
			expect(parsed.name).toBe('.');

			parsed = path.posix.parse('//');
			expect(parsed.root).toBe('/');
			expect(parsed.dir).toBe('/');
			expect(parsed.base).toBe('');
			expect(parsed.name).toBe('');

			parsed = path.posix.parse('///');
			expect(parsed.root).toBe('/');
			expect(parsed.dir).toBe('/');
			expect(parsed.base).toBe('');
			expect(parsed.name).toBe('');

			parsed = path.posix.parse('/foo///');
			expect(parsed.root).toBe('/');
			expect(parsed.dir).toBe('/');
			expect(parsed.base).toBe('foo');
			expect(parsed.name).toBe('foo');
			expect(parsed.ext).toBe('');

			parsed = path.posix.parse('/foo///bar.baz');
			expect(parsed.root).toBe('/');
			expect(parsed.dir).toBe('/foo//');
			expect(parsed.base).toBe('bar.baz');
			expect(parsed.ext).toBe('.baz');
			expect(parsed.name).toBe('bar');
		});
	});

	// ===== path.format =====

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

		await it('should format with dir only (adds trailing sep)', async () => {
			expect(path.format({ dir: 'some/dir' })).toBe('some/dir/');
		});

		await it('should format with base only', async () => {
			expect(path.format({ base: 'index.html' })).toBe('index.html');
		});

		await it('should format with root only', async () => {
			expect(path.format({ root: '/' })).toBe('/');
		});

		await it('should format with name and ext only', async () => {
			expect(path.format({ name: 'index', ext: '.html' })).toBe('index.html');
		});

		await it('should prefer dir over root when both present with name+ext', async () => {
			expect(path.format({ dir: 'some/dir', name: 'index', ext: '.html' })).toBe('some/dir/index.html');
			expect(path.format({ root: '/', name: 'index', ext: '.html' })).toBe('/index.html');
		});

		await it('should return empty string for empty object', async () => {
			expect(path.format({})).toBe('');
		});

		await it('should handle ext without leading dot', async () => {
			expect(path.format({ name: 'x', ext: 'png' })).toBe('x.png');
			expect(path.format({ name: 'x', ext: '.png' })).toBe('x.png');
		});
	});

	// ===== path.sep and path.delimiter =====

	await describe('path.sep and path.delimiter', async () => {
		await it('should have correct separator', async () => {
			expect(path.sep).toBe('/');
		});

		await it('should have correct delimiter', async () => {
			expect(path.delimiter).toBe(':');
		});

		await it('posix should have : delimiter', async () => {
			expect(path.posix.delimiter).toBe(':');
		});

		await it('win32 should have ; delimiter', async () => {
			expect(path.win32.delimiter).toBe(';');
		});
	});

	// ===== path.toNamespacedPath =====

	await describe('path.toNamespacedPath', async () => {
		await it('should be a no-op on POSIX', async () => {
			expect(path.toNamespacedPath('/foo/bar')).toBe('/foo/bar');
		});

		await it('should return the same value for any string on posix', async () => {
			expect(path.posix.toNamespacedPath('/foo/bar')).toBe('/foo/bar');
			expect(path.posix.toNamespacedPath('foo/bar')).toBe('foo/bar');
			expect(path.posix.toNamespacedPath('')).toBe('');
		});
	});

	// ===== path.posix and path.win32 =====

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

		await it('posix should export all path methods', async () => {
			expect(typeof path.posix.resolve).toBe('function');
			expect(typeof path.posix.normalize).toBe('function');
			expect(typeof path.posix.isAbsolute).toBe('function');
			expect(typeof path.posix.relative).toBe('function');
			expect(typeof path.posix.dirname).toBe('function');
			expect(typeof path.posix.basename).toBe('function');
			expect(typeof path.posix.extname).toBe('function');
			expect(typeof path.posix.format).toBe('function');
			expect(typeof path.posix.parse).toBe('function');
			expect(typeof path.posix.toNamespacedPath).toBe('function');
		});

		await it('win32 should export all path methods', async () => {
			expect(typeof path.win32.resolve).toBe('function');
			expect(typeof path.win32.normalize).toBe('function');
			expect(typeof path.win32.isAbsolute).toBe('function');
			expect(typeof path.win32.relative).toBe('function');
			expect(typeof path.win32.dirname).toBe('function');
			expect(typeof path.win32.basename).toBe('function');
			expect(typeof path.win32.extname).toBe('function');
			expect(typeof path.win32.format).toBe('function');
			expect(typeof path.win32.parse).toBe('function');
			expect(typeof path.win32.toNamespacedPath).toBe('function');
		});
	});

	// ===== path.win32 specific tests =====

	await describe('path.win32', async () => {
		await it('win32.basename should handle backslashes', async () => {
			expect(path.win32.basename('\\dir\\basename.ext')).toBe('basename.ext');
			expect(path.win32.basename('\\basename.ext')).toBe('basename.ext');
			expect(path.win32.basename('basename.ext')).toBe('basename.ext');
			expect(path.win32.basename('basename.ext\\')).toBe('basename.ext');
			expect(path.win32.basename('basename.ext\\\\')).toBe('basename.ext');
			expect(path.win32.basename('foo')).toBe('foo');
		});

		await it('win32.basename should handle drive letters', async () => {
			expect(path.win32.basename('C:')).toBe('');
			expect(path.win32.basename('C:.')).toBe('.');
			expect(path.win32.basename('C:\\')).toBe('');
			expect(path.win32.basename('C:\\dir\\base.ext')).toBe('base.ext');
			expect(path.win32.basename('C:\\basename.ext')).toBe('basename.ext');
			expect(path.win32.basename('C:basename.ext')).toBe('basename.ext');
			expect(path.win32.basename('C:basename.ext\\')).toBe('basename.ext');
			expect(path.win32.basename('C:basename.ext\\\\')).toBe('basename.ext');
			expect(path.win32.basename('C:foo')).toBe('foo');
		});

		await it('win32.basename should handle file:stream', async () => {
			expect(path.win32.basename('file:stream')).toBe('file:stream');
		});

		await it('win32.dirname should handle drive letters and UNC', async () => {
			expect(path.win32.dirname('c:\\')).toBe('c:\\');
			expect(path.win32.dirname('c:\\foo')).toBe('c:\\');
			expect(path.win32.dirname('c:\\foo\\')).toBe('c:\\');
			expect(path.win32.dirname('c:\\foo\\bar')).toBe('c:\\foo');
			expect(path.win32.dirname('c:\\foo\\bar\\')).toBe('c:\\foo');
			expect(path.win32.dirname('c:\\foo\\bar\\baz')).toBe('c:\\foo\\bar');
		});

		await it('win32.dirname should handle UNC paths', async () => {
			expect(path.win32.dirname('\\\\unc\\share')).toBe('\\\\unc\\share');
			expect(path.win32.dirname('\\\\unc\\share\\foo')).toBe('\\\\unc\\share\\');
			expect(path.win32.dirname('\\\\unc\\share\\foo\\')).toBe('\\\\unc\\share\\');
			expect(path.win32.dirname('\\\\unc\\share\\foo\\bar')).toBe('\\\\unc\\share\\foo');
		});

		await it('win32.normalize should handle various paths', async () => {
			expect(path.win32.normalize('./fixtures///b/../b/c.js')).toBe('fixtures\\b\\c.js');
			expect(path.win32.normalize('/foo/../../../bar')).toBe('\\bar');
			expect(path.win32.normalize('a//b//../b')).toBe('a\\b');
			expect(path.win32.normalize('a//b//./c')).toBe('a\\b\\c');
			expect(path.win32.normalize('a//b//.')).toBe('a\\b');
		});

		await it('win32.normalize should handle C: paths', async () => {
			expect(path.win32.normalize('C:')).toBe('C:.');
			expect(path.win32.normalize('C:\\.')).toBe('C:\\');
			expect(path.win32.normalize('file:stream')).toBe('file:stream');
		});

		await it('win32.parse should handle windows paths', async () => {
			const parsed = path.win32.parse('C:\\path\\dir\\index.html');
			expect(parsed.root).toBe('C:\\');
			expect(parsed.dir).toBe('C:\\path\\dir');
			expect(parsed.base).toBe('index.html');
			expect(parsed.ext).toBe('.html');
			expect(parsed.name).toBe('index');
		});

		await it('win32.parse should handle UNC paths', async () => {
			const parsed = path.win32.parse('\\\\server\\share\\file_path');
			expect(parsed.root).toBe('\\\\server\\share\\');
		});

		await it('win32.format should format windows paths', async () => {
			expect(path.win32.format({ dir: 'some\\dir' })).toBe('some\\dir\\');
			expect(path.win32.format({ base: 'index.html' })).toBe('index.html');
			expect(path.win32.format({ root: 'C:\\' })).toBe('C:\\');
			expect(path.win32.format({ name: 'index', ext: '.html' })).toBe('index.html');
			expect(path.win32.format({ dir: 'some\\dir', name: 'index', ext: '.html' })).toBe('some\\dir\\index.html');
			expect(path.win32.format({ root: 'C:\\', name: 'index', ext: '.html' })).toBe('C:\\index.html');
			expect(path.win32.format({})).toBe('');
		});

		await it('win32.relative should compute relative paths', async () => {
			expect(path.win32.relative('c:/aaaa/bbbb', 'c:/aaaa')).toBe('..');
			expect(path.win32.relative('c:/aaaa/bbbb', 'c:/cccc')).toBe('..\\..\\cccc');
			expect(path.win32.relative('c:/aaaa/bbbb', 'c:/aaaa/bbbb')).toBe('');
			expect(path.win32.relative('c:/aaaa/bbbb', 'c:/aaaa/cccc')).toBe('..\\cccc');
			expect(path.win32.relative('c:/aaaa/', 'c:/aaaa/cccc')).toBe('cccc');
			expect(path.win32.relative('c:/', 'c:\\aaaa\\bbbb')).toBe('aaaa\\bbbb');
		});

		await it('win32: case-insensitive drive letter comparison', async () => {
			expect(path.win32.relative('c:/AaAa/bbbb', 'c:/aaaa/bbbb')).toBe('');
		});

		await it('win32.relative should handle cross-drive paths', async () => {
			expect(path.win32.relative('c:/aaaa/bbbb', 'd:\\')).toBe('d:\\');
			expect(path.win32.relative('c:/blah\\blah', 'd:/games')).toBe('d:\\games');
		});
	});

	// ===== Edge cases: zero-length strings =====

	await describe('path zero-length strings', async () => {
		await it('join should return . for zero-length input', async () => {
			expect(path.posix.join('')).toBe('.');
			expect(path.posix.join('', '')).toBe('.');
			expect(path.win32.join('')).toBe('.');
			expect(path.win32.join('', '')).toBe('.');
		});

		await it('normalize should return . for zero-length input', async () => {
			expect(path.posix.normalize('')).toBe('.');
			expect(path.win32.normalize('')).toBe('.');
		});

		await it('isAbsolute should return false for empty string', async () => {
			expect(path.posix.isAbsolute('')).toBeFalsy();
			expect(path.win32.isAbsolute('')).toBeFalsy();
		});

		await it('resolve should return cwd for empty string args', async () => {
			const cwd = process.cwd();
			expect(path.resolve('')).toBe(cwd);
			expect(path.resolve('', '')).toBe(cwd);
		});
	});

	// ===== Edge cases: misc =====

	await describe('path edge cases', async () => {
		await it('parse should have consistent dirname and basename', async () => {
			const testPaths = [
				'/home/user/dir/file.txt',
				'/foo',
				'/foo.bar',
				'file',
				'./file',
			];
			for (const p of testPaths) {
				const parsed = path.parse(p);
				expect(parsed.base).toBe(path.basename(p));
				expect(parsed.ext).toBe(path.extname(p));
				if (parsed.dir) {
					expect(parsed.dir).toBe(path.dirname(p));
				}
			}
		});

		await it('posix.basename should treat backslash as normal char', async () => {
			expect(path.posix.basename('\\dir\\basename.ext')).toBe('\\dir\\basename.ext');
			expect(path.posix.basename('\\basename.ext')).toBe('\\basename.ext');
			expect(path.posix.basename('basename.ext\\')).toBe('basename.ext\\');
			expect(path.posix.basename('basename.ext\\\\')).toBe('basename.ext\\\\');
		});

		await it('posix.extname should treat backslash as normal char', async () => {
			expect(path.posix.extname('.\\')).toBe('');
			expect(path.posix.extname('..\\')).toBe('.\\');
			expect(path.posix.extname('file.ext\\')).toBe('.ext\\');
			expect(path.posix.extname('file.ext\\\\')).toBe('.ext\\\\');
			expect(path.posix.extname('file\\')).toBe('');
			expect(path.posix.extname('file\\\\')).toBe('');
			expect(path.posix.extname('file.\\')).toBe('.\\');
			expect(path.posix.extname('file.\\\\')).toBe('.\\\\');
		});

		await it('join should preserve cwd when joining with it', async () => {
			const cwd = process.cwd();
			expect(path.join(cwd)).toBe(cwd);
			expect(path.join(cwd, '')).toBe(cwd);
		});

		await it('normalize should preserve cwd', async () => {
			const cwd = process.cwd();
			expect(path.normalize(cwd)).toBe(cwd);
		});
	});
}
