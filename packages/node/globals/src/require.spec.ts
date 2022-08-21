import { describe, it, expect } from '@gjsify/unit';

export function testSuite() {
	describe('require', function() {

		it('should be able to import and use querystring', function() {
			const qs = require('querystring');
			expect(typeof qs.decode).toBe('function');
			expect(typeof qs.encode).toBe('function');

			expect(qs.encode({ foo: 'bar', baz: ['qux', 'quux'], corge: '' })).toBe('foo=bar&baz=qux&baz=quux&corge=');
			expect(qs.decode('foo=bar&baz=qux&baz=quux&corge=').foo).toBe('bar');
		});

	});
}