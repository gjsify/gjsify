import { describe, it, expect, run } from '@gjsify/unit';

export function testSuite() {
	describe('expect::to', function() {
		it('should be possible to validate expectations by callback', function() {
			expect(3).to(function(actualValue) {
				return actualValue === 3;
			});
		});

		it('should be possible to invalidate expectations by callback', function() {
			expect(3).not.to(function(actualValue) {
				return actualValue === 5;
			});
		});
	});

	describe('expect::toBe', function() {
		var obj = {};
		var obj2 = {};

		it('should compare using ===', function() {
			expect(true).toBe(true);
			expect(false).toBe(false);
			expect('test').toBe('test');
			expect(obj).toBe(obj);
		});

		it('should compare using !==', function() {
			expect(true).not.toBe(false);
			expect(true).not.toBe(1);
			expect(false).not.toBe(true);
			expect(false).not.toBe(0);
			expect('test').not.toBe('test2');
			expect(obj).not.toBe(obj2);
		});
	});

	describe('expect::toEqual', function() {
		var obj = {};
		var obj2 = {};

		it('should compare using ==', function() {
			expect(true).toEqual(true);
			expect(true).toEqual(1);
			expect(false).toEqual(false);
			expect(false).toEqual(0);
			expect('test').toEqual('test');
			expect(obj).toEqual(obj);
		});

		it('should compare using !=', function() {
			expect(true).not.toEqual(false);
			expect(false).not.toEqual(true);
			expect('test').not.toEqual('test2');
			expect(obj).not.toEqual(obj2);
		});
	});

	describe('expect::toMatch', function() {
		it('should consider matching regular expressions as valid', function() {
			expect('test').toMatch(/test/);
			expect('test').toMatch(/est/);
			expect('test').toMatch('test');
		});

		it('should consider non matching regular expressions as invalid', function() {
			expect('test').not.toMatch(/tester/);
		});
	});

	describe('expect::toBeDefined', function() {
		var obj = {key: 'value'};

		it('should consider defined values as valid', function() {
			expect(obj.key).toBeDefined();
		});

		it('should consider undefined values as invalid', function() {
			expect((obj as any).invalidKey).not.toBeDefined();
		});
	});

	describe('expect::toBeUndefined', function() {
		var obj = {key: 'value'};

		it('should consider undefined values as valid', function() {
			expect((obj as any).invalidKey).toBeUndefined();
		});

		it('should consider defined values as invalid', function() {
			expect(obj.key).not.toBeUndefined();
		});
	});

	describe('expect::toBeNull', function() {
		it('should consider null values as valid', function() {
			expect(null).toBeNull();
		});

		it('should consider non null values as invalid', function() {
			expect(0).not.toBeNull();
			expect(false).not.toBeNull();
			expect('').not.toBeNull();
			expect('null').not.toBeNull();
			expect(undefined).not.toBeNull();
			expect({}).not.toBeNull();
		});
	});

	describe('expect::toBeTruthy', function() {
		it('should consider truthy values as valid', function() {
			expect(true).toBeTruthy();
			expect(1).toBeTruthy();
			expect({}).toBeTruthy();
			expect([]).toBeTruthy();
		});

		it('should consider non truthy values as invalid', function() {
			expect(false).not.toBeTruthy();
			expect(0).not.toBeTruthy();
			expect('').not.toBeTruthy();
			expect(null).not.toBeTruthy();
			expect(undefined).not.toBeTruthy();
		});
	});

	describe('expect::toBeFalsy', function() {
		it('should consider truthy values as valid', function() {
			expect(false).toBeFalsy();
			expect(0).toBeFalsy();
			expect('').toBeFalsy();
			expect(null).toBeFalsy();
			expect(undefined).toBeFalsy();
		});

		it('should consider non truthy values as invalid', function() {
			expect(true).not.toBeFalsy();
			expect(1).not.toBeFalsy();
			expect({}).not.toBeFalsy();
			expect([]).not.toBeFalsy();
		});
	});

	describe('expect::toContain', function() {
		var testArray = [1, 'a'];

		it('should consider array containing a value as valid', function() {
			expect(testArray).toContain(1);
			expect(testArray).toContain('a');
		});

		it('should consider arrays not containing a value as invalid', function() {
			expect(testArray).not.toContain(0);
			expect(testArray).not.toContain('b');
		});
	});

	describe('expect::toBeLessThan', function() {
		it('should consider greater values as valid', function() {
			expect(1).toBeLessThan(2);
			expect(1).toBeLessThan(200);
		});

		it('should consider equal values as invalid', function() {
			expect(1).not.toBeLessThan(1);
		});

		it('should consider smaller values as invalid', function() {
			expect(1).not.toBeLessThan(0);
			expect(1).not.toBeLessThan(-5);
		});
	});

	describe('expect::toBeGreaterThan', function() {
		it('should consider smaller values as valid', function() {
			expect(2).toBeGreaterThan(1);
			expect(2).toBeGreaterThan(0);
			expect(2).toBeGreaterThan(-5);
		});

		it('should consider equal values as invalid', function() {
			expect(1).not.toBeGreaterThan(1);
		});

		it('should consider greater values as invalid', function() {
			expect(1).not.toBeGreaterThan(2);
			expect(1).not.toBeGreaterThan(200);
		});
	});

	describe('expect::toBeCloseTo', function() {
		var pi = 3.1415926, e = 2.78;

		it('should consider close numbers as valid', function() {
			expect(pi).toBeCloseTo(e, 0);
		});

		it('should consider non close numbers as invalid', function() {
			expect(pi).not.toBeCloseTo(e, 2);
		});
	});

	describe('expect::toBeCloseTo', function() {
		function throwException() {	throw {}; }
		function dontThrowException() {}

		it('should consider functions throwing an exception as valid', function() {
			expect(throwException).toThrow();
		});

		it('should consider functions not throwing an exception as invalid', function() {
			expect(dontThrowException).not.toThrow();
		});
	});
}
