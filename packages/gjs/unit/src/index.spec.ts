import { describe, it, expect, assert, beforeEach, afterEach } from '@gjsify/unit';

export default async () => {

	await describe('assert', async () => {

		await it('should consider truthy values as valid', async () => {
			assert(true);
			assert(1);
			assert({});
			assert([]);
		});
	})

	await describe('beforeEach', async () => {

		let foo = '';
		let count = 0;
		let countAfter = 0;

		beforeEach(async () => {
			console.log("beforeEach");
			foo = 'bar';
			++count;
		});

		afterEach(async () => {
			console.log("afterEach");
			--countAfter;
		});

		await it('foo should be "bar"', async () => {
			expect(foo).toBe('bar');
			foo = 'override me again'
		});

		await it('foo should be "bar" again', async () => {
			expect(foo).toBe('bar');
		});

		await it('count should be 3 again', async () => {
			expect(count).toBe(3);
		});

		await it('countAfter should be -3', async () => {
			expect(countAfter).toBe(-3);
		});
	});

	await describe('expect::to', async () => {
		await it('should be possible to validate expectations by callback', async () => {
			expect(3).to(function(actualValue) {
				return actualValue === 3;
			});
		});

		await it('should be possible to invalidate expectations by callback', async () => {
			expect(3).not.to(function(actualValue) {
				return actualValue === 5;
			});
		});
	});

	await describe('expect::toBe', async () => {
		var obj = {};
		var obj2 = {};

		await it('should compare using ===', async () => {
			expect(true).toBe(true);
			expect(false).toBe(false);
			expect('test').toBe('test');
			expect(obj).toBe(obj);
		});

		await it('should compare using !==', async () => {
			expect(true).not.toBe(false);
			expect(true).not.toBe(1);
			expect(false).not.toBe(true);
			expect(false).not.toBe(0);
			expect('test').not.toBe('test2');
			expect(obj).not.toBe(obj2);
		});
	});

	await describe('expect::toEqual', async () => {
		var obj = {};
		var obj2 = {};

		await it('should compare using ==', async () => {
			expect(true).toEqual(true);
			expect(true).toEqual(1);
			expect(false).toEqual(false);
			expect(false).toEqual(0);
			expect('test').toEqual('test');
			expect(obj).toEqual(obj);
		});

		await it('should compare using !=', async () => {
			expect(true).not.toEqual(false);
			expect(false).not.toEqual(true);
			expect('test').not.toEqual('test2');
			expect(obj).not.toEqual(obj2);
		});
	});

	await describe('expect::toMatch', async () => {
		await it('should consider matching regular expressions as valid', async () => {
			expect('test').toMatch(/test/);
			expect('test').toMatch(/est/);
			expect('test').toMatch('test');
		});

		await it('should consider non matching regular expressions as invalid', async () => {
			expect('test').not.toMatch(/tester/);
		});
	});

	await describe('expect::toBeDefined', async () => {
		var obj = {key: 'value'};

		await it('should consider defined values as valid', async () => {
			expect(obj.key).toBeDefined();
		});

		await it('should consider undefined values as invalid', async () => {
			expect((obj as any).invalidKey).not.toBeDefined();
		});
	});

	await describe('expect::toBeUndefined', async () => {
		var obj = {key: 'value'};

		await it('should consider undefined values as valid', async () => {
			expect((obj as any).invalidKey).toBeUndefined();
		});

		await it('should consider defined values as invalid', async () => {
			expect(obj.key).not.toBeUndefined();
		});
	});

	await describe('expect::toBeNull', async () => {
		await it('should consider null values as valid', async () => {
			expect(null).toBeNull();
		});

		await it('should consider non null values as invalid', async () => {
			expect(0).not.toBeNull();
			expect(false).not.toBeNull();
			expect('').not.toBeNull();
			expect('null').not.toBeNull();
			expect(undefined).not.toBeNull();
			expect({}).not.toBeNull();
		});
	});

	await describe('expect::toBeTruthy', async () => {
		await it('should consider truthy values as valid', async () => {
			expect(true).toBeTruthy();
			expect(1).toBeTruthy();
			expect({}).toBeTruthy();
			expect([]).toBeTruthy();
		});

		await it('should consider non truthy values as invalid', async () => {
			expect(false).not.toBeTruthy();
			expect(0).not.toBeTruthy();
			expect('').not.toBeTruthy();
			expect(null).not.toBeTruthy();
			expect(undefined).not.toBeTruthy();
		});
	});

	await describe('expect::toBeFalsy', async () => {
		await it('should consider truthy values as valid', async () => {
			expect(false).toBeFalsy();
			expect(0).toBeFalsy();
			expect('').toBeFalsy();
			expect(null).toBeFalsy();
			expect(undefined).toBeFalsy();
		});

		await it('should consider non truthy values as invalid', async () => {
			expect(true).not.toBeFalsy();
			expect(1).not.toBeFalsy();
			expect({}).not.toBeFalsy();
			expect([]).not.toBeFalsy();
		});
	});

	await describe('expect::toContain', async () => {
		var testArray = [1, 'a'];

		await it('should consider array containing a value as valid', async () => {
			expect(testArray).toContain(1);
			expect(testArray).toContain('a');
		});

		await it('should consider arrays not containing a value as invalid', async () => {
			expect(testArray).not.toContain(0);
			expect(testArray).not.toContain('b');
		});
	});

	await describe('expect::toBeLessThan', async () => {
		await it('should consider greater values as valid', async () => {
			expect(1).toBeLessThan(2);
			expect(1).toBeLessThan(200);
		});

		await it('should consider equal values as invalid', async () => {
			expect(1).not.toBeLessThan(1);
		});

		await it('should consider smaller values as invalid', async () => {
			expect(1).not.toBeLessThan(0);
			expect(1).not.toBeLessThan(-5);
		});
	});

	await describe('expect::toBeGreaterThan', async () => {
		await it('should consider smaller values as valid', async () => {
			expect(2).toBeGreaterThan(1);
			expect(2).toBeGreaterThan(0);
			expect(2).toBeGreaterThan(-5);
		});

		await it('should consider equal values as invalid', async () => {
			expect(1).not.toBeGreaterThan(1);
		});

		await it('should consider greater values as invalid', async () => {
			expect(1).not.toBeGreaterThan(2);
			expect(1).not.toBeGreaterThan(200);
		});
	});

	await describe('expect::toBeCloseTo', async () => {
		var pi = 3.1415926, e = 2.78;

		await it('should consider close numbers as valid', async () => {
			expect(pi).toBeCloseTo(e, 0);
		});

		await it('should consider non close numbers as invalid', async () => {
			expect(pi).not.toBeCloseTo(e, 2);
		});
	});

	await describe('expect::toBeCloseTo', async () => {
		function throwException() {	throw {}; }
		function dontThrowException() {}

		await it('should consider functions throwing an exception as valid', async () => {
			expect(throwException).toThrow();
		});

		await it('should consider functions not throwing an exception as invalid', async () => {
			expect(dontThrowException).not.toThrow();
		});
	});
}
