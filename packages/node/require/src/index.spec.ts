import { describe, it, expect } from '@gjsify/unit';

export function testSuite() {
	describe('require.resolve', () => {

		it('should return the path to the @gjsify/unit entry file', () => {
			const path = require.resolve('@gjsify/unit');
			// console.log("path", path);
			expect(typeof path).toBe('string');
			expect(path.endsWith("packages/unit/dist/index.cjs")).toBeTruthy();
		});

		it('should return the path to the cowsay2 entry file', () => {
			const path = require.resolve('cowsay2');
			// console.log("path", path);
			expect(typeof path).toBe('string');
			expect(path.endsWith("node_modules/cowsay2/index.js")).toBeTruthy();
		});

		it('should return the path to the cowsay2/package.json', () => {
			const path = require.resolve('cowsay2/package.json');
			// console.log("path", path);
			expect(typeof path).toBe('string');
			expect(path.endsWith("node_modules/cowsay2/package.json")).toBeTruthy();
		});
	});

	describe('require', () => {

		it('should be able to import and use querystring', () => {
			const qs = require('querystring');
			expect(typeof qs.decode).toBe('function');
			expect(typeof qs.encode).toBe('function');

			expect(qs.encode({ foo: 'bar', baz: ['qux', 'quux'], corge: '' })).toBe('foo=bar&baz=qux&baz=quux&corge=');
			expect(qs.decode('foo=bar&baz=qux&baz=quux&corge=').foo).toBe('bar');
		});

		it('should be able to import and use cowsay2', () => {
			const cowsay = require('cowsay2');
			expect(typeof cowsay.say).toBe('function');

			const muhh: string = cowsay.say('Hello from GJS!');
			console.log("\n" + muhh);

			expect(muhh.includes('< Hello from GJS! >')).toBeTruthy();
			expect(muhh.includes('(oo)')).toBeTruthy();
		});

	});

}