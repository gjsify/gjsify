import { describe, it, expect } from '@gjsify/unit';

export function testSuite() {
	describe('require', () => {

		it('should be able to import and use querystring', () => {
			const qs = require('querystring');
			expect(typeof qs.decode).toBe('function');
			expect(typeof qs.encode).toBe('function');

			expect(qs.encode({ foo: 'bar', baz: ['qux', 'quux'], corge: '' })).toBe('foo=bar&baz=qux&baz=quux&corge=');
			expect(qs.decode('foo=bar&baz=qux&baz=quux&corge=').foo).toBe('bar');
		});

	});

	describe('require.resolve', () => {

		it('should return the path to the @gjsify/unit entry file', () => {
			const path = require.resolve('@gjsify/unit');
			console.log("path", path);
			expect(typeof path).toBe('string');
			expect(path.endsWith("packages/unit/dist/index.cjs")).toBeTruthy();
		});

		it('should return the path to the cowsay entry file', () => {
			const path = require.resolve('cowsay');
			console.log("path", path);
			expect(typeof path).toBe('string');
			expect(path.endsWith("node_modules/cowsay/index.js")).toBeTruthy();
		});

		it('should return the path to the cowsay/package.json', () => {
			const path = require.resolve('cowsay/package.json');
			console.log("path", path);
			expect(typeof path).toBe('string');
			expect(path.endsWith("node_modules/cowsay/package.json")).toBeTruthy();
		});
	});
}