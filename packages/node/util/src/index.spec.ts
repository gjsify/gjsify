import { describe, it, expect } from '@gjsify/unit';
import * as util from 'util';

// Ported from refs/node/test/parallel/test-util-format.js,
// test-util-promisify.js, test-util-inherits.js, test-util-types.js
// Original: MIT license, Node.js contributors

// Helper to strip ANSI colors
const ANSI_PATTERN = new RegExp(
	[
		"[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
		"(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
	].join("|"),
	"g",
);

function stripColor(string: string): string {
	return string.replace(ANSI_PATTERN, "");
}

export default async () => {
	// ==================== format — no args / single values ====================

	await describe('util.format: basic', async () => {
		await it('should return empty string with no args', async () => {
			expect(util.format()).toBe('');
		});

		await it('should format empty string', async () => {
			expect(util.format('')).toBe('');
		});

		await it('should format object', async () => {
			expect(util.format({})).toBe('{}');
		});

		await it('should format null', async () => {
			expect(util.format(null)).toBe('null');
		});

		await it('should format true/false', async () => {
			expect(util.format(true)).toBe('true');
			expect(util.format(false)).toBe('false');
		});

		await it('should format plain string', async () => {
			expect(util.format('test')).toBe('test');
		});

		await it('should join multiple args with space', async () => {
			expect(util.format('foo', 'bar', 'baz')).toBe('foo bar baz');
		});

		await it('should format Symbol', async () => {
			expect(util.format(Symbol('foo'))).toBe('Symbol(foo)');
		});
	});

	// ==================== format — %% (literal percent) ====================

	await describe('util.format: %%', async () => {
		await it('should handle %% with args', async () => {
			expect(util.format('%% %s', 'foo')).toBe('% foo');
			expect(util.format('%%', 'x')).toBe('% x');
		});
	});

	// ==================== format — %d (number) ====================

	await describe('util.format: %d', async () => {
		await it('should format integers', async () => {
			expect(util.format('%d', 42.0)).toBe('42');
			expect(util.format('%d', 42)).toBe('42');
		});

		await it('should format floats', async () => {
			expect(util.format('%d', 1.5)).toBe('1.5');
			expect(util.format('%d', -0.5)).toBe('-0.5');
		});

		await it('should format -0', async () => {
			expect(util.format('%d', -0.0)).toBe('-0');
		});

		await it('should format Symbol as NaN', async () => {
			expect(util.format('%d', Symbol())).toBe('NaN');
		});

		await it('should format BigInt', async () => {
			expect(util.format('%d', 1180591620717411303424n)).toBe('1180591620717411303424n');
		});

		await it('should format Infinity', async () => {
			expect(util.format('%d', Infinity)).toBe('Infinity');
			expect(util.format('%d', -Infinity)).toBe('-Infinity');
		});

		await it('should handle multiple %d', async () => {
			expect(util.format('%d %d', 42, 43)).toBe('42 43');
		});

		await it('should return %d with no args', async () => {
			expect(util.format('%d')).toBe('%d');
		});
	});

	// ==================== format — %i (integer) ====================

	await describe('util.format: %i', async () => {
		await it('should truncate to integer', async () => {
			expect(util.format('%i', 42)).toBe('42');
			expect(util.format('%i', 1.5)).toBe('1');
		});

		await it('should format -0.5 as -0', async () => {
			expect(util.format('%i', -0.5)).toBe('-0');
		});

		await it('should format Infinity as NaN', async () => {
			expect(util.format('%i', Infinity)).toBe('NaN');
		});

		await it('should format BigInt', async () => {
			expect(util.format('%i', 1180591620717411303424n)).toBe('1180591620717411303424n');
		});
	});

	// ==================== format — %f (float) ====================

	await describe('util.format: %f', async () => {
		await it('should format numbers', async () => {
			expect(util.format('%f', 42)).toBe('42');
			expect(util.format('%f', 1.5)).toBe('1.5');
		});

		await it('should format Symbol as NaN', async () => {
			expect(util.format('%f', Symbol('foo'))).toBe('NaN');
		});

		await it('should format BigInt', async () => {
			expect(util.format('%f', 5n)).toBe('5');
		});
	});

	// ==================== format — %s (string) ====================

	await describe('util.format: %s', async () => {
		await it('should format primitives', async () => {
			expect(util.format('%s', undefined)).toBe('undefined');
			expect(util.format('%s', null)).toBe('null');
			expect(util.format('%s', 'foo')).toBe('foo');
			expect(util.format('%s', 42)).toBe('42');
			expect(util.format('%s', true)).toBe('true');
		});

		await it('should format -0', async () => {
			expect(util.format('%s', -0)).toBe('-0');
		});

		await it('should format BigInt with n suffix', async () => {
			expect(util.format('%s', 42n)).toBe('42n');
		});

		await it('should format Symbol', async () => {
			expect(util.format('%s', Symbol('foo'))).toBe('Symbol(foo)');
		});

		await it('should format Infinity', async () => {
			expect(util.format('%s', Infinity)).toBe('Infinity');
		});

		await it('should handle multiple %s', async () => {
			expect(util.format('%s %s', 42, 43)).toBe('42 43');
		});
	});

	// ==================== format — %j (JSON) ====================

	await describe('util.format: %j', async () => {
		await it('should format objects as JSON', async () => {
			expect(util.format('%j', { foo: 'bar' })).toBe('{"foo":"bar"}');
		});

		await it('should handle circular references', async () => {
			const obj: Record<string, unknown> = {};
			obj.self = obj;
			expect(util.format('%j', obj)).toBe('[Circular]');
		});
	});

	// ==================== inspect ====================

	await describe('util.inspect', async () => {
		await it('should inspect objects', async () => {
			expect(stripColor(util.inspect({ foo: 123 }))).toBe('{ foo: 123 }');
		});

		await it('should inspect strings with quotes', async () => {
			expect(stripColor(util.inspect("Deno's logo is so cute.")))
				.toBe(`"Deno's logo is so cute."`);
		});

		await it('should have custom symbol', async () => {
			expect(util.inspect.custom.description).toBe('nodejs.util.inspect.custom');
		});

		await it('should handle custom inspect', async () => {
			const obj = {
				[Symbol.for('nodejs.util.inspect.custom')]() {
					return 'custom output';
				}
			};
			expect(util.inspect(obj)).toBe('custom output');
		});
	});

	// ==================== promisify ====================

	await describe('util.promisify', async () => {
		await it('should promisify a callback function', async () => {
			function callbackFn(val: string, cb: (err: Error | null, result?: string) => void) {
				cb(null, val + ' done');
			}
			const promisified = util.promisify(callbackFn);
			const result = await promisified('test');
			expect(result).toBe('test done');
		});

		await it('should reject on error', async () => {
			function callbackFn(cb: (err: Error | null) => void) {
				cb(new Error('test error'));
			}
			const promisified = util.promisify(callbackFn);
			try {
				await promisified();
				expect(false).toBeTruthy(); // should not reach
			} catch (err: unknown) {
				expect((err as Error).message).toBe('test error');
			}
		});

		await it('should use custom promisify symbol', async () => {
			function customFn() { /* noop */ }
			(customFn as any)[util.promisify.custom] = () => Promise.resolve('custom');
			const promisified = util.promisify(customFn);
			const result = await promisified();
			expect(result).toBe('custom');
		});

		await it('should throw on non-function', async () => {
			expect(() => util.promisify('not a function' as any)).toThrow();
		});
	});

	// ==================== callbackify ====================

	await describe('util.callbackify', async () => {
		await it('should throw on non-function', async () => {
			expect(() => util.callbackify('not a function' as any)).toThrow();
		});

		await it('should return a function', async () => {
			async function asyncFn() { return 'resolved'; }
			const callbacked = util.callbackify(asyncFn);
			expect(typeof callbacked).toBe('function');
		});
	});

	// ==================== inherits ====================

	await describe('util.inherits', async () => {
		await it('should set up prototype chain', async () => {
			function Parent() { /* noop */ }
			Parent.prototype.hello = function () { return 'hello'; };
			function Child() { /* noop */ }
			util.inherits(Child, Parent);
			expect(Object.getPrototypeOf(Child.prototype)).toBe(Parent.prototype);
		});

		await it('should set super_ property', async () => {
			function Parent() { /* noop */ }
			function Child() { /* noop */ }
			util.inherits(Child, Parent);
			expect((Child as any).super_).toBe(Parent);
		});

		await it('should throw on null constructor', async () => {
			expect(() => util.inherits(null as any, function () { /* noop */ })).toThrow();
		});

		await it('should throw on null super constructor', async () => {
			expect(() => util.inherits(function () { /* noop */ }, null as any)).toThrow();
		});

		await it('should throw on super without prototype', async () => {
			const fn = function () { /* noop */ };
			(fn as any).prototype = undefined;
			expect(() => util.inherits(function () { /* noop */ }, fn)).toThrow();
		});
	});

	// ==================== types ====================

	await describe('util.types', async () => {
		await it('isDate', async () => {
			expect(util.types.isDate(new Date())).toBeTruthy();
			expect(util.types.isDate(Date.now())).toBeFalsy();
			expect(util.types.isDate('2024-01-01')).toBeFalsy();
		});

		await it('isRegExp', async () => {
			expect(util.types.isRegExp(/abc/)).toBeTruthy();
			expect(util.types.isRegExp(new RegExp('abc'))).toBeTruthy();
			expect(util.types.isRegExp('abc')).toBeFalsy();
		});

		await it('isMap', async () => {
			expect(util.types.isMap(new Map())).toBeTruthy();
			expect(util.types.isMap({})).toBeFalsy();
		});

		await it('isSet', async () => {
			expect(util.types.isSet(new Set())).toBeTruthy();
			expect(util.types.isSet([])).toBeFalsy();
		});

		await it('isWeakMap', async () => {
			expect(util.types.isWeakMap(new WeakMap())).toBeTruthy();
			expect(util.types.isWeakMap(new Map())).toBeFalsy();
		});

		await it('isWeakSet', async () => {
			expect(util.types.isWeakSet(new WeakSet())).toBeTruthy();
			expect(util.types.isWeakSet(new Set())).toBeFalsy();
		});

		await it('isPromise', async () => {
			expect(util.types.isPromise(Promise.resolve())).toBeTruthy();
			expect(util.types.isPromise({})).toBeFalsy();
		});

		await it('isArrayBuffer', async () => {
			expect(util.types.isArrayBuffer(new ArrayBuffer(8))).toBeTruthy();
			expect(util.types.isArrayBuffer(new Uint8Array(8))).toBeFalsy();
		});

		await it('isTypedArray', async () => {
			expect(util.types.isTypedArray(new Uint8Array())).toBeTruthy();
			expect(util.types.isTypedArray(new Float64Array())).toBeTruthy();
			expect(util.types.isTypedArray(new ArrayBuffer(8))).toBeFalsy();
		});

		await it('isUint8Array', async () => {
			expect(util.types.isUint8Array(new Uint8Array())).toBeTruthy();
			expect(util.types.isUint8Array(new Uint16Array())).toBeFalsy();
		});

		await it('isDataView', async () => {
			const buf = new ArrayBuffer(8);
			expect(util.types.isDataView(new DataView(buf))).toBeTruthy();
			expect(util.types.isDataView(new Uint8Array(buf))).toBeFalsy();
		});

		await it('isAsyncFunction', async () => {
			expect(util.types.isAsyncFunction(async function () { /* noop */ })).toBeTruthy();
			expect(util.types.isAsyncFunction(function () { /* noop */ })).toBeFalsy();
		});

		await it('isGeneratorFunction', async () => {
			expect(util.types.isGeneratorFunction(function* () { /* noop */ })).toBeTruthy();
			expect(util.types.isGeneratorFunction(function () { /* noop */ })).toBeFalsy();
		});

		await it('isNativeError', async () => {
			expect(util.types.isNativeError(new Error())).toBeTruthy();
			expect(util.types.isNativeError(new TypeError())).toBeTruthy();
			expect(util.types.isNativeError({ message: 'error' })).toBeFalsy();
		});
	});

	// ==================== isDeepStrictEqual ====================

	await describe('util.isDeepStrictEqual', async () => {
		await it('should compare primitives', async () => {
			expect(util.isDeepStrictEqual(1, 1)).toBeTruthy();
			expect(util.isDeepStrictEqual('a', 'a')).toBeTruthy();
			expect(util.isDeepStrictEqual(1, 2)).toBeFalsy();
			expect(util.isDeepStrictEqual(1, '1')).toBeFalsy();
		});

		await it('should compare objects', async () => {
			expect(util.isDeepStrictEqual({ a: 1 }, { a: 1 })).toBeTruthy();
			expect(util.isDeepStrictEqual({ a: 1 }, { a: 2 })).toBeFalsy();
			expect(util.isDeepStrictEqual({ a: 1 }, { b: 1 })).toBeFalsy();
		});

		await it('should compare arrays', async () => {
			expect(util.isDeepStrictEqual([1, 2, 3], [1, 2, 3])).toBeTruthy();
			expect(util.isDeepStrictEqual([1, 2], [1, 2, 3])).toBeFalsy();
		});

		await it('should compare nested objects', async () => {
			expect(util.isDeepStrictEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBeTruthy();
			expect(util.isDeepStrictEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBeFalsy();
		});

		await it('should compare Date objects', async () => {
			const d = new Date('2024-01-01');
			expect(util.isDeepStrictEqual(d, new Date('2024-01-01'))).toBeTruthy();
			expect(util.isDeepStrictEqual(d, new Date('2024-01-02'))).toBeFalsy();
		});

		await it('should compare RegExp objects', async () => {
			expect(util.isDeepStrictEqual(/abc/g, /abc/g)).toBeTruthy();
			expect(util.isDeepStrictEqual(/abc/g, /abc/i)).toBeFalsy();
		});
	});

	// ==================== TextEncoder / TextDecoder ====================

	await describe('util.TextEncoder/TextDecoder', async () => {
		await it('TextEncoder should be available', async () => {
			expect(util.TextEncoder === TextEncoder).toBeTruthy();
		});

		await it('TextDecoder should be available', async () => {
			expect(util.TextDecoder === TextDecoder).toBeTruthy();
		});
	});

	// ==================== isArray ====================

	await describe('util.isArray', async () => {
		await it('should detect arrays', async () => {
			expect(util.isArray([])).toBeTruthy();
			expect(util.isArray({})).toBeFalsy();
			expect(util.isArray(null)).toBeFalsy();
		});
	});
};
