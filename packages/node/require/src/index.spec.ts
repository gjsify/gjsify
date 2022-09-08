import { describe, on, it, expect } from '@gjsify/unit';

export async function testSuite() {
	await describe('require.resolve', async () => {

		await it('should return the path to the @gjsify/unit entry file', async () => {
			const path = require.resolve('@gjsify/unit');
			expect(typeof path).toBe('string');
			expect(path.endsWith("packages/gjs/unit/dist/index.cjs")).toBeTruthy();
		});

		await on('Gjs', async () => {
			await it('Gjs should return the alias to the @gjsify/querystring entry file for "querystring"', async () => {
				const path = require.resolve('querystring');
				expect(typeof path).toBe('string');
				expect(path.includes("/@gjsify/querystring/") || path.includes('/packages/node/querystring/')).toBeTruthy();
			});
		});

		await on('Node.js', async () => {
			await it('Node.js should just return intern package name for "querystring"', async () => {
				const path = require.resolve('querystring');
				expect(typeof path).toBe('string');
				expect(path).toBe("querystring");
			});
		});

		await it('should return the path to the cowsay2 entry file', async () => {
			const path = require.resolve('cowsay2');
			expect(typeof path).toBe('string');
			expect(path.endsWith("node_modules/cowsay2/index.js")).toBeTruthy();
		});

		await it('should return the path to the cowsay2/package.json', async () => {
			const path = require.resolve('cowsay2/package.json');
			// console.log("path", path);
			expect(typeof path).toBe('string');
			expect(path.endsWith("node_modules/cowsay2/package.json")).toBeTruthy();
		});
	});

	await describe('require', async () => {

		await it('should be able to import and use querystring', async () => {
			const qs = require('querystring');
			expect(typeof qs.decode).toBe('function');
			expect(typeof qs.encode).toBe('function');

			expect(qs.encode({ foo: 'bar', baz: ['qux', 'quux'], corge: '' })).toBe('foo=bar&baz=qux&baz=quux&corge=');
			expect(qs.decode('foo=bar&baz=qux&baz=quux&corge=').foo).toBe('bar');
		});

		await it('should be able to import and use cowsay2', async () => {
			const cowsay = require('cowsay2');
			expect(typeof cowsay.say).toBe('function');

			const muhh: string = cowsay.say('Hello from GJS!');
			console.log("\n" + muhh);

			expect(muhh.includes('< Hello from GJS! >')).toBeTruthy();
			expect(muhh.includes('(oo)')).toBeTruthy();
		});

	});

}