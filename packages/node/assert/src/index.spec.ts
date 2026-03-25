import { describe, it, expect } from '@gjsify/unit';
import {
	equal,
	notEqual,
	strictEqual,
	notStrictEqual,
	deepEqual,
	notDeepEqual,
	deepStrictEqual,
	notDeepStrictEqual,
	throws,
	doesNotThrow,
	fail,
	ok,
	ifError,
	match,
	doesNotMatch,
	rejects,
	doesNotReject,
	AssertionError,
	strict,
} from 'node:assert';
import assert from 'node:assert';

export default async () => {

	// ---- AssertionError ----

	await describe('AssertionError', async () => {
		await it('should be an instance of Error', async () => {
			const err = new AssertionError({ message: 'test' });
			expect(err instanceof Error).toBe(true);
		});

		await it('should have name "AssertionError"', async () => {
			const err = new AssertionError({ message: 'test' });
			expect(err.name).toBe('AssertionError');
		});

		await it('should have code "ERR_ASSERTION"', async () => {
			const err = new AssertionError({ message: 'test' });
			expect(err.code).toBe('ERR_ASSERTION');
		});

		await it('should store actual and expected', async () => {
			const err = new AssertionError({ actual: 1, expected: 2, operator: 'strictEqual' });
			expect(err.actual).toBe(1);
			expect(err.expected).toBe(2);
		});

		await it('should store operator', async () => {
			const err = new AssertionError({ operator: 'strictEqual' });
			expect(err.operator).toBe('strictEqual');
		});

		await it('should set generatedMessage to true when no message provided', async () => {
			const err = new AssertionError({ actual: 1, expected: 2, operator: 'strictEqual' });
			expect(err.generatedMessage).toBe(true);
		});

		await it('should set generatedMessage to false when message provided', async () => {
			const err = new AssertionError({ message: 'custom msg', operator: 'strictEqual' });
			expect(err.generatedMessage).toBe(false);
		});
	});

	// ---- assert / ok ----

	await describe('assert / ok', async () => {
		await it('should pass for truthy values', async () => {
			expect(() => ok(true)).not.toThrow();
			expect(() => ok(1)).not.toThrow();
			expect(() => ok('string')).not.toThrow();
			expect(() => ok({})).not.toThrow();
			expect(() => ok([])).not.toThrow();
		});

		await it('should throw for falsy values', async () => {
			expect(() => ok(false)).toThrow();
			expect(() => ok(0)).toThrow();
			expect(() => ok('')).toThrow();
			expect(() => ok(null)).toThrow();
			expect(() => ok(undefined)).toThrow();
		});

		await it('should work as default export', async () => {
			expect(() => assert(true)).not.toThrow();
			expect(() => assert(false)).toThrow();
		});

		await it('should throw Error instance when message is an Error', async () => {
			const customErr = new TypeError('custom');
			expect(() => {
				ok(false, customErr as any);
			}).toThrow();
		});
	});

	// ---- equal / notEqual ----

	await describe('assert.equal', async () => {
		await it('should do nothing if both values are equal', async () => {
			expect(() => equal(true, true)).not.toThrow();
		});

		await it('should throw if both values are not equal', async () => {
			expect(() => equal(true, false)).toThrow();
		});

		await it('should use loose equality (==)', async () => {
			expect(() => equal(1, '1')).not.toThrow();
			expect(() => equal(null, undefined)).not.toThrow();
			expect(() => equal(0, false)).not.toThrow();
		});

		await it('should throw for values that are not loosely equal', async () => {
			expect(() => equal(1, 2)).toThrow();
			expect(() => equal('a', 'b')).toThrow();
		});
	});

	await describe('assert.notEqual', async () => {
		await it('should pass for unequal values', async () => {
			expect(() => notEqual(1, 2)).not.toThrow();
			expect(() => notEqual('a', 'b')).not.toThrow();
		});

		await it('should throw for loosely equal values', async () => {
			expect(() => notEqual(1, '1')).toThrow();
			expect(() => notEqual(null, undefined)).toThrow();
		});
	});

	// ---- strictEqual / notStrictEqual ----

	await describe('assert.strictEqual', async () => {
		await it('should pass for strictly equal values', async () => {
			expect(() => strictEqual(1, 1)).not.toThrow();
			expect(() => strictEqual('a', 'a')).not.toThrow();
			expect(() => strictEqual(null, null)).not.toThrow();
			expect(() => strictEqual(undefined, undefined)).not.toThrow();
		});

		await it('should throw for different types', async () => {
			expect(() => strictEqual(1, '1')).toThrow();
			expect(() => strictEqual(null, undefined)).toThrow();
		});

		await it('should handle NaN (Object.is semantics)', async () => {
			expect(() => strictEqual(NaN, NaN)).not.toThrow();
		});

		await it('should distinguish +0 and -0', async () => {
			expect(() => strictEqual(+0, -0)).toThrow();
		});
	});

	await describe('assert.notStrictEqual', async () => {
		await it('should pass for non-identical values', async () => {
			expect(() => notStrictEqual(1, '1')).not.toThrow();
			expect(() => notStrictEqual(1, 2)).not.toThrow();
		});

		await it('should throw for identical values', async () => {
			expect(() => notStrictEqual(1, 1)).toThrow();
			expect(() => notStrictEqual('a', 'a')).toThrow();
		});
	});

	// ---- deepEqual / notDeepEqual ----

	await describe('assert.deepEqual', async () => {
		await it('should pass for equal objects', async () => {
			expect(() => deepEqual({ a: 1 }, { a: 1 })).not.toThrow();
		});

		await it('should pass for equal arrays', async () => {
			expect(() => deepEqual([1, 2, 3], [1, 2, 3])).not.toThrow();
		});

		await it('should handle nested objects', async () => {
			expect(() => deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).not.toThrow();
		});

		await it('should use loose equality for primitives', async () => {
			expect(() => deepEqual({ a: 1 }, { a: '1' })).not.toThrow();
		});

		await it('should pass for Date objects with same time', async () => {
			const d = new Date('2024-01-01');
			expect(() => deepEqual(new Date(d.getTime()), new Date(d.getTime()))).not.toThrow();
		});

		await it('should pass for RegExp with same pattern/flags', async () => {
			expect(() => deepEqual(/abc/gi, /abc/gi)).not.toThrow();
		});

		await it('should throw for different objects', async () => {
			expect(() => deepEqual({ a: 1 }, { a: 2 })).toThrow();
		});

		await it('should throw for different arrays', async () => {
			expect(() => deepEqual([1, 2], [1, 3])).toThrow();
		});
	});

	await describe('assert.notDeepEqual', async () => {
		await it('should pass for different objects', async () => {
			expect(() => notDeepEqual({ a: 1 }, { a: 2 })).not.toThrow();
		});

		await it('should throw for equal objects', async () => {
			expect(() => notDeepEqual({ a: 1 }, { a: 1 })).toThrow();
		});
	});

	// ---- deepStrictEqual / notDeepStrictEqual ----

	await describe('assert.deepStrictEqual', async () => {
		await it('should pass for strictly equal objects', async () => {
			expect(() => deepStrictEqual({ a: 1 }, { a: 1 })).not.toThrow();
		});

		await it('should be type-sensitive (unlike deepEqual)', async () => {
			expect(() => deepStrictEqual({ a: 1 }, { a: '1' })).toThrow();
		});

		await it('should check prototypes', async () => {
			const a = Object.create(null);
			a.x = 1;
			expect(() => deepStrictEqual(a, { x: 1 })).toThrow();
		});

		await it('should handle Map objects', async () => {
			const m1 = new Map([['a', 1]]);
			const m2 = new Map([['a', 1]]);
			expect(() => deepStrictEqual(m1, m2)).not.toThrow();
		});

		await it('should handle Set objects', async () => {
			const s1 = new Set([1, 2, 3]);
			const s2 = new Set([1, 2, 3]);
			expect(() => deepStrictEqual(s1, s2)).not.toThrow();
		});

		await it('should handle nested arrays', async () => {
			expect(() => deepStrictEqual([[1, 2], [3]], [[1, 2], [3]])).not.toThrow();
		});

		await it('should handle Date objects', async () => {
			const d = new Date();
			expect(() => deepStrictEqual(new Date(d.getTime()), new Date(d.getTime()))).not.toThrow();
		});

		await it('should throw for different Date objects', async () => {
			expect(() => deepStrictEqual(new Date(0), new Date(1))).toThrow();
		});

		await it('should throw for different RegExp', async () => {
			expect(() => deepStrictEqual(/abc/, /def/)).toThrow();
		});
	});

	await describe('assert.notDeepStrictEqual', async () => {
		await it('should pass when values differ by type', async () => {
			expect(() => notDeepStrictEqual({ a: 1 }, { a: '1' })).not.toThrow();
		});

		await it('should throw when values are deep strict equal', async () => {
			expect(() => notDeepStrictEqual({ a: 1 }, { a: 1 })).toThrow();
		});
	});

	// ---- throws / doesNotThrow ----

	await describe('assert.throws', async () => {
		await it('should pass when function throws', async () => {
			expect(() => {
				throws(() => { throw new Error('test'); });
			}).not.toThrow();
		});

		await it('should throw when function does NOT throw', async () => {
			expect(() => {
				throws(() => { /* no throw */ });
			}).toThrow();
		});

		await it('should validate error class', async () => {
			expect(() => {
				throws(() => { throw new TypeError('test'); }, TypeError);
			}).not.toThrow();
		});

		await it('should validate error message with RegExp', async () => {
			expect(() => {
				throws(() => { throw new Error('hello world'); }, /hello/);
			}).not.toThrow();
		});

		await it('should validate with validation function', async () => {
			expect(() => {
				throws(
					() => { throw new Error('test'); },
					(err: any) => err instanceof Error && err.message === 'test',
				);
			}).not.toThrow();
		});
	});

	await describe('assert.doesNotThrow', async () => {
		await it('should pass when function does not throw', async () => {
			expect(() => {
				doesNotThrow(() => { return 42; });
			}).not.toThrow();
		});

		await it('should throw when function throws', async () => {
			expect(() => {
				doesNotThrow(() => { throw new Error('oops'); });
			}).toThrow();
		});
	});

	// ---- fail ----

	await describe('assert.fail', async () => {
		await it('should always throw AssertionError', async () => {
			expect(() => fail()).toThrow();
		});

		await it('should use "Failed" as default message', async () => {
			let caught = false;
			try {
				fail();
			} catch (e: any) {
				caught = true;
				expect(e.message).toBe('Failed');
			}
			expect(caught).toBe(true);
		});

		await it('should use custom message', async () => {
			let caught = false;
			try {
				fail('custom message');
			} catch (e: any) {
				caught = true;
				expect(e.message).toBe('custom message');
			}
			expect(caught).toBe(true);
		});
	});

	// ---- ifError ----

	await describe('assert.ifError', async () => {
		await it('should pass for null', async () => {
			expect(() => ifError(null)).not.toThrow();
		});

		await it('should pass for undefined', async () => {
			expect(() => ifError(undefined)).not.toThrow();
		});

		await it('should throw for truthy values', async () => {
			expect(() => ifError(1)).toThrow();
			expect(() => ifError('error')).toThrow();
			expect(() => ifError(true)).toThrow();
		});

		await it('should throw for Error instances', async () => {
			expect(() => ifError(new Error('test'))).toThrow();
		});
	});

	// ---- match / doesNotMatch ----

	await describe('assert.match', async () => {
		await it('should pass when string matches regexp', async () => {
			expect(() => match('hello world', /hello/)).not.toThrow();
		});

		await it('should throw when string does not match', async () => {
			expect(() => match('hello', /world/)).toThrow();
		});
	});

	await describe('assert.doesNotMatch', async () => {
		await it('should pass when string does not match', async () => {
			expect(() => doesNotMatch('hello', /world/)).not.toThrow();
		});

		await it('should throw when string matches', async () => {
			expect(() => doesNotMatch('hello world', /hello/)).toThrow();
		});
	});

	// ---- rejects / doesNotReject ----

	await describe('assert.rejects', async () => {
		await it('should pass for rejected promise', async () => {
			let threw = false;
			try {
				await rejects(async () => { throw new Error('rejected'); });
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		await it('should throw for resolved promise', async () => {
			let threw = false;
			try {
				await rejects(async () => { return 42; });
			} catch {
				threw = true;
			}
			expect(threw).toBe(true);
		});
	});

	await describe('assert.doesNotReject', async () => {
		await it('should pass for resolved promise', async () => {
			let threw = false;
			try {
				await doesNotReject(async () => { return 42; });
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		await it('should throw for rejected promise', async () => {
			let threw = false;
			try {
				await doesNotReject(async () => { throw new Error('rejected'); });
			} catch {
				threw = true;
			}
			expect(threw).toBe(true);
		});
	});

	// ---- strict ----

	await describe('assert.strict', async () => {
		await it('should be a function', async () => {
			expect(typeof strict).toBe('function');
		});

		await it('should have strictEqual as equal', async () => {
			expect(strict.equal).toBe(strict.strictEqual);
		});

		await it('should have deepStrictEqual as deepEqual', async () => {
			expect(strict.deepEqual).toBe(strict.deepStrictEqual);
		});

		await it('should act as ok when called', async () => {
			expect(() => strict(true)).not.toThrow();
			expect(() => strict(false)).toThrow();
		});

		await it('should have self-reference', async () => {
			expect(strict.strict).toBe(strict);
		});
	});

	// ---- assert default export properties ----

	await describe('assert default export', async () => {
		await it('should have all methods', async () => {
			expect(typeof assert.ok).toBe('function');
			expect(typeof assert.equal).toBe('function');
			expect(typeof assert.notEqual).toBe('function');
			expect(typeof assert.strictEqual).toBe('function');
			expect(typeof assert.notStrictEqual).toBe('function');
			expect(typeof assert.deepEqual).toBe('function');
			expect(typeof assert.notDeepEqual).toBe('function');
			expect(typeof assert.deepStrictEqual).toBe('function');
			expect(typeof assert.notDeepStrictEqual).toBe('function');
			expect(typeof assert.throws).toBe('function');
			expect(typeof assert.doesNotThrow).toBe('function');
			expect(typeof assert.rejects).toBe('function');
			expect(typeof assert.doesNotReject).toBe('function');
			expect(typeof assert.fail).toBe('function');
			expect(typeof assert.ifError).toBe('function');
			expect(typeof assert.match).toBe('function');
			expect(typeof assert.doesNotMatch).toBe('function');
			expect(typeof assert.strict).toBe('function');
		});

		await it('should work as a function (like ok)', async () => {
			expect(() => assert(true)).not.toThrow();
			expect(() => assert(false)).toThrow();
		});
	});
};
