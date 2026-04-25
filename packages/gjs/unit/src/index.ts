// Based on https://github.com/philipphoffmann/gjsunit

import "@girs/gjs";

import type GLib from '@girs/glib-2.0';
export * from './spy.js';
import nodeAssert from 'node:assert';
import { quitMainLoop } from '@gjsify/utils/main-loop';

const mainloop: GLib.MainLoop | undefined = (globalThis as any)?.imports?.mainloop;

let countTestsOverall = 0;
let countTestsFailed = 0;
let countTestsIgnored = 0;
let runtime = '';
let runStartTime = 0;

export interface TimeoutConfig {
	/** Per-it() timeout in ms. Default: 5000. 0 = disabled. */
	testTimeout: number;
	/** Per-describe() timeout in ms. Default: 30000. 0 = disabled. */
	suiteTimeout: number;
	/** Global run timeout in ms. Default: 120000. 0 = disabled. */
	runTimeout: number;
}

const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
	testTimeout: 5000,
	suiteTimeout: 30000,
	runTimeout: 120000,
};

let timeoutConfig: TimeoutConfig = { ...DEFAULT_TIMEOUT_CONFIG };

class TimeoutError extends Error {
	constructor(label: string, timeoutMs: number) {
		super(`Timeout: "${label}" exceeded ${timeoutMs}ms`);
		this.name = 'TimeoutError';
	}
}

async function withTimeout<T>(
	fn: () => T | Promise<T>,
	timeoutMs: number,
	label: string
): Promise<T> {
	if (timeoutMs <= 0) return fn();

	let timeoutId: ReturnType<typeof setTimeout>;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
	});

	const fnPromise = Promise.resolve(fn());
	fnPromise.catch(() => {}); // Prevent unhandled rejection if it fails after timeout

	try {
		return await Promise.race([fnPromise, timeoutPromise]);
	} finally {
		clearTimeout(timeoutId!);
	}
}

export const configure = (overrides: Partial<TimeoutConfig>) => {
	timeoutConfig = { ...timeoutConfig, ...overrides };
};

function applyEnvOverrides() {
	try {
		const env = (globalThis as any).process?.env;
		if (!env) return;
		const t = parseInt(env.GJSIFY_TEST_TIMEOUT, 10);
		if (!isNaN(t) && t >= 0) timeoutConfig.testTimeout = t;
		const s = parseInt(env.GJSIFY_SUITE_TIMEOUT, 10);
		if (!isNaN(s) && s >= 0) timeoutConfig.suiteTimeout = s;
		const r = parseInt(env.GJSIFY_RUN_TIMEOUT, 10);
		if (!isNaN(r) && r >= 0) timeoutConfig.runTimeout = r;
	} catch (_e) { /* process.env may not be available */ }
}

const RED = '\x1B[31m';
const GREEN = '\x1B[32m';
const BLUE = '\x1b[34m';
const GRAY = '\x1B[90m';
const RESET = '\x1B[39m';

const now = (): number =>
	(globalThis as any).performance?.now?.() ?? Date.now();

const formatDuration = (ms: number): string => {
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	if (ms >= 100) return `${Math.round(ms)}ms`;
	return `${ms.toFixed(1)}ms`;
};

export interface Namespaces {
	[key: string]: () => (Promise<void>) | Namespaces;
}

export type Callback = () => Promise<void>;

export type Runtime = 'Gjs' | 'Deno' | 'Node.js' | 'Unknown' | 'Browser' | 'Display';

// Makes this work on Gjs and Node.js
// In browsers, globalThis.print is window.print() (the print dialog), not text output.
// Use console.log in browser contexts to avoid triggering print dialogs.
export const print = (typeof (globalThis as any).document !== 'undefined')
    ? console.log
    : (globalThis.print || console.log);

class MatcherFactory {

	public not: MatcherFactory;

	constructor(protected readonly actualValue: any, protected readonly positive: boolean, negated?: MatcherFactory) {
		if(negated) {
			this.not = negated;
		} else {
			this.not = new MatcherFactory(actualValue, !positive, this);
		}
	}

	triggerResult(success: boolean, msg: string) {
		if( (success && !this.positive) ||
			(!success && this.positive) ) {
			const error = new Error(msg);
			(error as any).__testFailureCounted = true;
			++countTestsFailed;
			throw error;
		}
	}

	to(callback: (actualValue: any) => boolean) {
		this.triggerResult(callback(this.actualValue),
			`      Expected callback to validate`
		);
	}

	toBe(expectedValue: any) {
		this.triggerResult(this.actualValue === expectedValue,
			`      Expected values to match using ===\n` +
			`      Expected: ${expectedValue} (${typeof expectedValue})\n` +
			`      Actual: ${this.actualValue} (${typeof this.actualValue})`
		);
	}

	toEqual(expectedValue: any) {
		this.triggerResult(this.actualValue == expectedValue,
			`      Expected values to match using ==\n` +
			`      Expected: ${expectedValue} (${typeof expectedValue})\n` +
			`      Actual: ${this.actualValue} (${typeof this.actualValue})`
		);
	}

	toStrictEqual(expectedValue: any) {
		let success = true;
		let errorMessage = '';
		try {
			nodeAssert.deepStrictEqual(this.actualValue, expectedValue);
		} catch (e) {
			success = false;
			errorMessage = e.message || '';
		}
		this.triggerResult(success,
			`      Expected values to be deeply strictly equal\n` +
			`      Expected: ${JSON.stringify(expectedValue)}\n` +
			`      Actual: ${JSON.stringify(this.actualValue)}` +
			(errorMessage ? `\n      ${errorMessage}` : '')
		);
	}

	toEqualArray(expectedValue: Array<any> | Uint8Array) {

		let success = Array.isArray(this.actualValue) && Array.isArray(expectedValue) && this.actualValue.length === expectedValue.length;

		for (let i = 0; i < this.actualValue.length; i++) {
			const actualVal = this.actualValue[i];
			const expectedVal = expectedValue[i];
			success = actualVal == expectedVal;
			if(!success) break;
		}

		this.triggerResult(success,
			`      Expected array items to match using ==\n` +
			`      Expected: ${expectedValue} (${typeof expectedValue})\n` +
			`      Actual: ${this.actualValue} (${typeof this.actualValue})`
		);
	}

	toBeInstanceOf(expectedType: Function) {
		this.triggerResult(this.actualValue instanceof expectedType,
			`      Expected value to be instance of ${expectedType.name || expectedType}\n` +
			`      Actual: ${this.actualValue?.constructor?.name || typeof this.actualValue}`
		);
	}

	toHaveLength(expectedLength: number) {
		const actualLength = this.actualValue?.length;
		this.triggerResult(actualLength === expectedLength,
			`      Expected length: ${expectedLength}\n` +
			`      Actual length: ${actualLength}`
		);
	}

	toMatch(expectedValue: any) {
		if(typeof this.actualValue.match !== 'function') {
			throw new Error(`You can not use toMatch on type ${typeof this.actualValue}`);
		}
		this.triggerResult(!!this.actualValue.match(expectedValue),
			'      Expected values to match using regular expression\n' +
			'      Expression: ' + expectedValue + '\n' +
			'      Actual: ' + this.actualValue
		);
	}

	toBeDefined() {
		this.triggerResult(typeof this.actualValue !== 'undefined',
			`      Expected value to be defined`
		);
	}

	toBeUndefined() {
		this.triggerResult(typeof this.actualValue === 'undefined',
			`      Expected value to be undefined`
		);
	}

	toBeNull() {
		this.triggerResult(this.actualValue === null,
			`      Expected value to be null`
		);
	}

	toBeTruthy() {
		this.triggerResult(this.actualValue as unknown as boolean,
			`      Expected value to be truthy`
		);
	}

	toBeFalsy() {
		this.triggerResult(!this.actualValue,
			`      Expected value to be falsy`
		);
	}

	toContain(needle: any) {
		const value = this.actualValue;
		let contains: boolean;
		if (typeof value === 'string') {
			contains = value.includes(String(needle));
		} else if (value instanceof Array) {
			contains = value.indexOf(needle) !== -1;
		} else {
			contains = false;
		}
		this.triggerResult(contains,
			`      Expected ` + value + ` to contain ` + needle
		);
	}
	toBeLessThan(greaterValue: number) {
		this.triggerResult(this.actualValue < greaterValue,
			`      Expected ` + this.actualValue + ` to be less than ` + greaterValue
		);
	}
	toBeGreaterThan(smallerValue: number) {
		this.triggerResult(this.actualValue > smallerValue,
			`      Expected ` + this.actualValue + ` to be greater than ` + smallerValue
		);
	}
	toBeGreaterThanOrEqual(value: number) {
		this.triggerResult(this.actualValue >= value,
			`      Expected ${this.actualValue} to be greater than or equal to ${value}`
		);
	}
	toBeLessThanOrEqual(value: number) {
		this.triggerResult(this.actualValue <= value,
			`      Expected ${this.actualValue} to be less than or equal to ${value}`
		);
	}
	toBeCloseTo(expectedValue: number, precision: number) {
		const shiftHelper = Math.pow(10, precision);
		this.triggerResult(Math.round((this.actualValue as unknown as number) * shiftHelper) / shiftHelper === Math.round(expectedValue * shiftHelper) / shiftHelper,
			`      Expected ` + this.actualValue + ` with precision ` + precision + ` to be close to ` + expectedValue
		);
	}
	toThrow(expected?: typeof Error | string | RegExp) {
		let errorMessage = '';
		let didThrow = false;
		let typeMatch = true;
		let messageMatch = true;
		try {
			this.actualValue();
			didThrow = false;
		}
		catch(e) {
			errorMessage = e.message || '';
			didThrow = true;
			if (typeof expected === 'function') {
				typeMatch = (e instanceof expected);
			} else if (typeof expected === 'string') {
				messageMatch = errorMessage.includes(expected);
			} else if (expected instanceof RegExp) {
				messageMatch = expected.test(errorMessage);
			}
		}
		const functionName = this.actualValue.name || typeof this.actualValue === 'function' ? "[anonymous function]" : this.actualValue.toString();
		this.triggerResult(didThrow,
			`      Expected ${functionName} to ${this.positive ? 'throw' : 'not throw'} an exception ${!this.positive && errorMessage ? `, but an error with the message "${errorMessage}" was thrown` : ''}`
		);

		if (typeof expected === 'function') {
			this.triggerResult(typeMatch,
				`      Expected Error type '${expected.name}', but the error is not an instance of it`
			);
		} else if (expected !== undefined) {
			this.triggerResult(messageMatch,
				`      Expected error message to match ${expected}\n` +
				`      Actual message: "${errorMessage}"`
			);
		}
	}

	async toReject(expected?: typeof Error | string | RegExp) {
		let didReject = false;
		let errorMessage = '';
		let typeMatch = true;
		let messageMatch = true;
		try {
			await this.actualValue;
			didReject = false;
		} catch (e) {
			didReject = true;
			errorMessage = e?.message || String(e);
			if (typeof expected === 'function') {
				typeMatch = (e instanceof expected);
			} else if (typeof expected === 'string') {
				messageMatch = errorMessage.includes(expected);
			} else if (expected instanceof RegExp) {
				messageMatch = expected.test(errorMessage);
			}
		}
		this.triggerResult(didReject,
			`      Expected promise to ${this.positive ? 'reject' : 'resolve'}${!this.positive && errorMessage ? `, but it rejected with "${errorMessage}"` : ''}`
		);
		if (didReject && typeof expected === 'function') {
			this.triggerResult(typeMatch,
				`      Expected rejection type '${expected.name}', but the error is not an instance of it`
			);
		} else if (didReject && expected !== undefined) {
			this.triggerResult(messageMatch,
				`      Expected rejection message to match ${expected}\n` +
				`      Actual message: "${errorMessage}"`
			);
		}
	}

	async toResolve() {
		let didResolve = false;
		let errorMessage = '';
		try {
			await this.actualValue;
			didResolve = true;
		} catch (e) {
			didResolve = false;
			errorMessage = e?.message || String(e);
		}
		this.triggerResult(didResolve,
			`      Expected promise to ${this.positive ? 'resolve' : 'reject'}${!didResolve ? `, but it rejected with "${errorMessage}"` : ''}`
		);
	}
}

export const describe = async function(moduleName: string, callback: Callback, options?: { timeout?: number } | number) {
	const suiteTimeoutMs = typeof options === 'number'
		? options
		: (options?.timeout ?? timeoutConfig.suiteTimeout);

	print('\n' + moduleName);

	const t0 = now();
	try {
		await withTimeout(callback, suiteTimeoutMs, `describe: ${moduleName}`);
	} catch (e) {
		if (e instanceof TimeoutError) {
			++countTestsFailed;
			print(`  ${RED}⏱ Suite timed out: ${e.message}${RESET}`);
		} else {
			throw e;
		}
	}
	const duration = now() - t0;
	print(`  ${GRAY}↳ ${formatDuration(duration)}${RESET}`);

	// Reset after and before callbacks
	beforeEachCb = null;
	afterEachCb = null;
};

describe.skip = async function(moduleName: string, _callback?: Callback) {
	++countTestsIgnored;
	print(`\n${BLUE}- ${moduleName} (skipped)${RESET}`);
};

const hasDisplay = (): boolean => {
	// Check process.env (Node.js and GJS with @gjsify/globals)
	const env = (globalThis as any).process?.env;
	if (env) {
		return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
	}
	// GJS fallback via imports.gi.GLib (before process polyfill is available)
	try {
		const GLib = (globalThis as any)?.imports?.gi?.GLib;
		if (GLib) {
			return !!(GLib.getenv('DISPLAY') || GLib.getenv('WAYLAND_DISPLAY'));
		}
	} catch (_) {}
	return false;
};

const runtimeMatch = async function(onRuntime: Runtime[], version?: string) {

	// Special case: 'Display' checks for a graphical display, not runtime identity
	if (onRuntime.includes('Display')) {
		return { matched: hasDisplay() };
	}

	const currRuntime = (await getRuntime());

	const foundRuntime = onRuntime.find((r) => currRuntime.includes(r));

	if (!foundRuntime) {
		return {
			matched: false
		}
	}

	if(typeof version === 'string') {
		// TODO allow version wildcards like 16.x.x
		if(!currRuntime.includes(version)) {
			return {
				matched: false
			}
		}
	}

	return {
		matched: true,
		runtime: foundRuntime,
		version: version,
	}
}

// TODO add support for Browser
/** E.g on('Deno', () {  it(...) }) */
export const on = async function(onRuntime: Runtime | Runtime[], version: string | Callback, callback?: Callback) {

	if(typeof onRuntime === 'string') {
		onRuntime = [onRuntime];
	}

	if(typeof version === 'function') {
		callback = version;
		version = undefined;
	}

	const { matched } = await runtimeMatch(onRuntime, version as string | undefined);

	if(!matched) {
		++countTestsIgnored;
		return;
	}

	print(`\nOn ${onRuntime.join(', ')}${version ? ' ' + version : ''}`);

	await callback();
}

let beforeEachCb: Callback | undefined | null;
let afterEachCb: Callback | undefined | null;

export const beforeEach = function (callback?: Callback) {
	beforeEachCb = callback;
}

export const afterEach = function (callback?: Callback) {
	afterEachCb = callback;
}


export const it = async function(expectation: string, callback: () => void | Promise<void>, options?: { timeout?: number } | number) {
	const timeoutMs = typeof options === 'number'
		? options
		: (options?.timeout ?? timeoutConfig.testTimeout);

	const t0 = now();
	try {
		if(typeof beforeEachCb === 'function') {
			await beforeEachCb();
		}

		await withTimeout(callback, timeoutMs, expectation);

		if(typeof afterEachCb === 'function') {
			await afterEachCb();
		}

		const duration = now() - t0;
		print(`  ${GREEN}✔${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
	}
	catch(e) {
		const duration = now() - t0;
		if (!e.__testFailureCounted) {
			++countTestsFailed;
		}
		const icon = e instanceof TimeoutError ? '⏱' : '❌';
		print(`  ${RED}${icon}${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
		print(`${RED}${e.message}${RESET}`);
		if (e.stack) print(e.stack);
	}
}

it.skip = async function(expectation: string, _callback?: () => void | Promise<void>) {
	++countTestsIgnored;
	print(`  ${BLUE}-${RESET} ${GRAY}${expectation} (skipped)${RESET}`);
}

export const expect = function(actualValue: any) {
	++countTestsOverall;

	const expecter = new MatcherFactory(actualValue, true);

	return expecter;
}

export const assert = function(success: any, message?: string | Error) {
	++countTestsOverall;

	if(!success) {
		++countTestsFailed;
	}

	try {
		nodeAssert(success, message);
	} catch (error) {
		(error as any).__testFailureCounted = true;
		throw error;
	}
}

assert.strictEqual = function<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T {
	++countTestsOverall;
	try {
		nodeAssert.strictEqual(actual, expected, message);
	} catch (error) {
		++countTestsFailed;
		(error as any).__testFailureCounted = true;
		throw error;
	}
}

assert.throws = function(promiseFn: () => unknown, ...args: any[]) {
	++countTestsOverall;
	let error: any;
	try {
		promiseFn();
	} catch (e) {
		error = e;
	}

	if(!error) ++countTestsFailed;

	nodeAssert.throws(() => { if(error) throw error }, args[0], args[1])
};

assert.deepStrictEqual = function<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T {
	++countTestsOverall;
	try {
		nodeAssert.deepStrictEqual(actual, expected, message);
	} catch (error) {
		++countTestsFailed;
		(error as any).__testFailureCounted = true;
		throw error;
	}
}

// TODO wrap more assert methods

const runTests = async function(namespaces: Namespaces) {
	// recursively check the test directory for executable tests
	for( const subNamespace in namespaces ) {
		const namespace = namespaces[subNamespace];
		// execute any test functions
		if(typeof namespace === 'function' ) {
			await namespace();
		}
		// descend into subfolders and objects
		else if( typeof namespace === 'object' ) {
			await runTests(namespace);
		}
	}
}

const printResult = () => {
	const totalMs = runStartTime > 0 ? now() - runStartTime : 0;
	const durationStr = totalMs > 0 ? `  ${GRAY}(${formatDuration(totalMs)})` : '';

	if( countTestsIgnored ) {
		// some tests ignored
		print(`\n${BLUE}✔ ${countTestsIgnored} ignored test${ countTestsIgnored > 1 ? 's' : ''}${RESET}`);
	}

	if( countTestsFailed ) {
		// some tests failed
		print(`\n${RED}❌ ${countTestsFailed} of ${countTestsOverall} tests failed${durationStr}${RESET}`);
	}
	else {
		// all tests okay
		print(`\n${GREEN}✔ ${countTestsOverall} completed${durationStr}${RESET}`);
	}
}

const getRuntime = async () => {
	if(runtime && runtime !== 'Unknown') {
		return runtime;
	}

	// Check browser before attempting dynamic import('process') — dynamic imports
	// are NOT aliased by esbuild, so import('process') throws in the browser,
	// which previously caused the catch block to set runtime='Unknown' before
	// reaching the document check.
	if (typeof (globalThis as any).document !== 'undefined') {
		runtime = 'Browser';
		return runtime;
	}

	if(globalThis.Deno?.version?.deno) {
		return 'Deno ' + globalThis.Deno?.version?.deno;
	} else {
		let process = globalThis.process;

		if(!process) {
			try {
				process = await import('process');
			} catch (error) {
				console.error(error)
				console.warn(error.message);
				runtime = 'Unknown'
			}
		}

		if(process?.versions?.gjs) {
			runtime = 'Gjs ' + process.versions.gjs;
		} else if (process?.versions?.node) {
			runtime = 'Node.js ' + process.versions.node;
		}
	}
	return runtime || 'Unknown';
}

const printRuntime = async () => {
	const runtime = await getRuntime()
	print(`\nRunning on ${runtime}`);	
}

export const run = async (namespaces: Namespaces, options?: { timeout?: number; testTimeout?: number; suiteTimeout?: number } | number) => {

	applyEnvOverrides();
	runStartTime = now();

	if (options) {
		if (typeof options === 'number') {
			timeoutConfig.runTimeout = options;
		} else {
			if (options.timeout !== undefined) timeoutConfig.runTimeout = options.timeout;
			if (options.testTimeout !== undefined) timeoutConfig.testTimeout = options.testTimeout;
			if (options.suiteTimeout !== undefined) timeoutConfig.suiteTimeout = options.suiteTimeout;
		}
	}

	printRuntime()
	.then(async () => {
		try {
			await withTimeout(() => runTests(namespaces), timeoutConfig.runTimeout, 'entire test run');
		} catch (e) {
			if (e instanceof TimeoutError) {
				print(`\n${RED}⏱ ${e.message}${RESET}`);
				++countTestsFailed;
			} else {
				throw e;
			}
		}
	})
	.then(async () => {
		printResult();
		print();

		quitMainLoop(); // Pre-quit ensureMainLoop's loop so it exits immediately when the hook fires
		mainloop?.quit();

		// Node.js: exit here (code after mainloop?.run() executes before tests on Node.js)
		if (!mainloop) {
			const exitCode = countTestsFailed > 0 ? 1 : 0;
			try {
				const process = globalThis.process || await import('process');
				process.exit(exitCode);
			} catch (_e) { /* process unavailable */ }
		}
	});

	// Run the GJS mainloop for async operations (blocks until mainloop.quit() is called)
	mainloop?.run();

	// GJS: exit after mainloop returns (system.exit() inside a mainloop
	// callback does not terminate immediately)
	if (mainloop) {
		const exitCode = countTestsFailed > 0 ? 1 : 0;
		try {
			(globalThis as any).imports.system.exit(exitCode);
		} catch (_e) { /* system.exit unavailable */ }
	}
}

export default {
	run,
	assert,
	expect,
	it,
	afterEach,
	beforeEach,
	on,
	describe,
	configure,
	print,
}