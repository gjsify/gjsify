// Based on https://github.com/philipphoffmann/gjsunit

import '@girs/gjs';

import type GLib from '@girs/glib-2.0';
export * from './spy.js';
import nodeAssert from 'node:assert';
import type { AssertPredicate } from 'node:assert';
import { quitMainLoop } from '@gjsify/utils/main-loop';

/**
 * Module-internal typed view of the cross-runtime globals this test runner
 * reads from. `@gjsify/unit` must run on plain GJS (no Node polyfills loaded),
 * Node.js, and browsers — so every access into `globalThis` is potentially
 * undefined. Centralising those shapes here lets the call sites use
 * `runtimeGlobals().<field>?.<...>` instead of scattering `as any` casts.
 */
interface _RuntimeGlobals {
    imports?: {
        mainloop?: GLib.MainLoop;
        gi?: { GLib?: typeof GLib };
        system?: { exit: (code: number) => never };
    };
    process?: {
        env?: Partial<Record<string, string>>;
        versions?: { gjs?: string; node?: string };
        exit?: (code: number) => never;
    };
    performance?: { now?: () => number };
    document?: {
        documentElement: { dataset: Record<string, string> };
    };
    __gjsify_test_results?: {
        passed: number;
        failed: number;
        total: number;
        errors: Array<{ suite: string; test: string; message: string }>;
    };
}

const runtimeGlobals = (): _RuntimeGlobals => globalThis as unknown as _RuntimeGlobals;

/**
 * Brand for `Error` instances produced by our own matchers / `assert.*`
 * helpers. It marks an error as a *deliberate assertion-failure signal* (vs an
 * unexpected impl error). The throw/rejection matchers (`toThrow`, `toReject`,
 * `toResolve`) read it to recognise an inner matcher throw they are *expecting*
 * and must not re-surface.
 *
 * It deliberately does NOT mean "already added to the failure count". Failure
 * counting is owned exclusively by the boundary that OBSERVES the outcome —
 * `it()` (and the run/suite timeout handlers) — never by the throw site. See
 * `triggerResult`.
 */
interface _CountedError {
    __testFailureCounted?: boolean;
}

// Decide the run/exit strategy by the ACTUAL runtime, NOT by `imports.mainloop`
// presence. GJS drives async tests by blocking on `imports.mainloop.run()` and
// quitting from a callback; Node/Bun/Deno instead exit via `process.exit()` after
// the (promise-based) run settles. `@gjsify/node-gi` now legitimately provides
// `imports.mainloop` on Node too (a GJS-compat feature), so keying on its presence
// would wrongly send node-gi consumers down the GJS path — a blocking mainloop
// whose quit (queued as a promise continuation) never drains under the blocking
// loop, so the process hangs forever. Gate on `process.versions.gjs` (the same
// signal getRuntime() uses) so only real GJS runs the blocking mainloop.
const mainloop: GLib.MainLoop | undefined =
    typeof runtimeGlobals().process?.versions?.gjs === 'string' ? runtimeGlobals().imports?.mainloop : undefined;

let countTestsOverall = 0;
let countTestsFailed = 0;
let countTestsIgnored = 0;
/** Tests marked `it.failing` that failed as expected (see `it.failing`). */
let countTestsXfail = 0;

/**
 * True only while an `it()` callback is on the stack. A matcher/assert that
 * throws while this is false escaped its test (a leaked late assertion fired by
 * a settled test's timer/promise, or an `expect()` used outside any `it`). Such
 * a stray throw must NOT corrupt the global pass/fail tally of a bystander test
 * — `it()` only counts errors that escape ITS OWN callback. This flag lets the
 * (rare) out-of-band failure be surfaced as its own distinct entry instead of
 * silently poisoning whichever test happens to be active. See `it()` and
 * `noteStrayFailure`.
 */
let activeTestDepth = 0;
const strayFailures: Array<{ suite: string; message: string }> = [];

/**
 * Record an assertion failure that fired with no `it()` on the stack. These are
 * real bugs in a test (a missing `await`, an unclosed socket, a late callback),
 * but they belong to NO currently-running test, so they get their own pseudo-
 * test in the summary rather than being charged to an innocent bystander.
 */
const noteStrayFailure = (message: string): void => {
    ++countTestsFailed;
    strayFailures.push({ suite: currentSuite, message });
    testErrors.push({
        suite: currentSuite,
        test: '<stray assertion outside any it()>',
        message,
    });
};
let runtime = '';
let runStartTime = 0;
let currentSuite = '';
let testErrors: Array<{ suite: string; test: string; message: string }> = [];

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

/**
 * Opt-in per-test skip map (test name → reason), populated by `run()` from its
 * `skip` option. An `it()` whose `expectation` is a key here is reported as
 * skipped (with the reason) instead of run — the honest way for a caller to run
 * a suite on a runtime that cannot pass a known subset (e.g. a `@gjsify/node-gi`
 * consumer skipping tests that hit an unimplemented GI-marshalling surface),
 * WITHOUT editing or weakening the shared spec files. Empty by default, so it is
 * a no-op for every normal run.
 */
let skipReasons: Map<string, string> = new Map();

class TimeoutError extends Error {
    constructor(label: string, timeoutMs: number) {
        super(`Timeout: "${label}" exceeded ${timeoutMs}ms`);
        this.name = 'TimeoutError';
    }
}

async function withTimeout<T>(fn: () => T | Promise<T>, timeoutMs: number, label: string): Promise<T> {
    if (timeoutMs <= 0) return fn();

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
    });
    // The race below is normally this promise's only consumer, so once `fn`
    // settles first nobody observes the rejection. Claim it here rather than
    // leaving it to become an unhandled rejection.
    timeoutPromise.catch(() => {});

    try {
        // `fn()` belongs INSIDE the try. A synchronous throw — which is what
        // EVERY failed `expect` in a non-async `it` is — escaped before the
        // `finally` was installed, so `clearTimeout` never ran. The armed timer
        // then rejected `timeoutPromise` with nobody listening: `timeoutMs`
        // later the run died on an unhandled rejection reporting a TimeoutError
        // in place of the assertion message, and every suite after the failing
        // one never ran. Observed as `Timeout: "resolves from the caller cwd"
        // exceeded 5000ms` masking a one-line path mismatch.
        const fnPromise = Promise.resolve(fn());
        fnPromise.catch(() => {}); // Prevent unhandled rejection if it fails after timeout
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
        const env = runtimeGlobals().process?.env;
        if (!env) return;
        const t = parseInt(env.GJSIFY_TEST_TIMEOUT, 10);
        if (!isNaN(t) && t >= 0) timeoutConfig.testTimeout = t;
        const s = parseInt(env.GJSIFY_SUITE_TIMEOUT, 10);
        if (!isNaN(s) && s >= 0) timeoutConfig.suiteTimeout = s;
        const r = parseInt(env.GJSIFY_RUN_TIMEOUT, 10);
        if (!isNaN(r) && r >= 0) timeoutConfig.runTimeout = r;
    } catch (_e) {
        /* Deno throws NotCapable on env property reads without --allow-env;
           a missing process.env is the `if (!env)` early return, not a throw */
    }
}

const RED = '\x1B[31m';
const GREEN = '\x1B[32m';
const BLUE = '\x1b[34m';
const GRAY = '\x1B[90m';
const RESET = '\x1B[39m';

const now = (): number => runtimeGlobals().performance?.now?.() ?? Date.now();

const formatDuration = (ms: number): string => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    if (ms >= 100) return `${Math.round(ms)}ms`;
    return `${ms.toFixed(1)}ms`;
};

export interface Namespaces {
    [key: string]: () => Promise<void> | Namespaces;
}

export type Callback = () => void | Promise<void>;

export type Runtime = 'Gjs' | 'Deno' | 'Node.js' | 'Unknown' | 'Browser' | 'Display';

// Makes this work on Gjs and Node.js
// In browsers, globalThis.print is window.print() (the print dialog), not text output.
// Use console.log in browser contexts to avoid triggering print dialogs.
// GJS check takes priority: @gjsify/dom-elements can set globalThis.document on GJS,
// which would otherwise cause a false-positive browser detection.
const _isGjsProcess = typeof runtimeGlobals().process?.versions?.gjs === 'string';
export const print =
    !_isGjsProcess && typeof runtimeGlobals().document !== 'undefined' ? console.log : globalThis.print || console.log;

/**
 * Render any value as a human-readable string for assertion failure messages
 * WITHOUT throwing. Template-literal / `+` interpolation throws a TypeError on
 * `symbol` and `bigint` operands (`Cannot convert a Symbol value to a string`),
 * which would mask the real assertion result, so matchers route operands
 * through this instead of interpolating them directly.
 */
export function formatValue(value: unknown): string {
    switch (typeof value) {
        case 'symbol':
            return value.toString(); // "Symbol(desc)" — never throws
        case 'bigint':
            return `${value}n`;
        case 'string':
            return value;
        case 'function':
            return (value as { name?: string }).name
                ? `[Function ${(value as { name?: string }).name}]`
                : '[Function (anonymous)]';
        case 'object': {
            if (value === null) return 'null';
            try {
                return JSON.stringify(value) ?? String(value);
            } catch {
                return Object.prototype.toString.call(value);
            }
        }
        default:
            return String(value); // number, boolean, undefined
    }
}

/** Deep partial match: every key/index in `expected` must be present and match in `actual` (extra actual keys ignored). */
function matchesObject(actual: unknown, expected: unknown): boolean {
    if (Object.is(actual, expected)) return true;
    if (typeof expected !== 'object' || expected === null) return actual === expected;
    if (typeof actual !== 'object' || actual === null) return false;
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length !== expected.length) return false;
        return expected.every((v, i) => matchesObject((actual as unknown[])[i], v));
    }
    if (Array.isArray(actual)) return false;
    return Object.keys(expected as Record<string, unknown>).every((k) =>
        matchesObject((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k]),
    );
}

// --- vitest-compatible mock + environment-stub helpers (`vi`) ---
// oxlint-disable-next-line typescript/no-explicit-any -- a mock must wrap any function signature
type AnyFn = (...args: any[]) => any;

/** A vitest-style mock function: callable with any args + records `.mock.calls`. */
export interface MockFn<T extends AnyFn = AnyFn> {
    // oxlint-disable-next-line typescript/no-explicit-any -- a mock replaces arbitrary functions, so it accepts any call shape
    (...args: any[]): ReturnType<T>;
    // oxlint-disable-next-line typescript/no-explicit-any -- recorded call args are intentionally untyped
    mock: { calls: any[][] };
}

const stubbedGlobals: Array<{ key: string; had: boolean; prev: unknown }> = [];
const stubbedEnvs: Array<{ key: string; had: boolean; prev: string | undefined }> = [];

function envBag(): Record<string, string | undefined> | undefined {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}

/** Minimal vitest-compatible `vi`: fn, stubGlobal/unstubAllGlobals, stubEnv/unstubAllEnvs. */
export const vi = {
    fn<T extends AnyFn>(impl?: T): MockFn<T> {
        // oxlint-disable-next-line typescript/no-explicit-any -- recorded call args are intentionally untyped
        const calls: any[][] = [];
        // oxlint-disable-next-line typescript/no-explicit-any -- a mock accepts any call shape
        const f = function (this: unknown, ...args: any[]): ReturnType<T> {
            calls.push(args);
            return (impl ? impl.apply(this, args) : undefined) as ReturnType<T>;
        } as MockFn<T>;
        f.mock = { calls };
        return f;
    },
    stubGlobal(name: string, value: unknown): void {
        const g = globalThis as Record<string, unknown>;
        stubbedGlobals.push({ key: name, had: name in g, prev: g[name] });
        g[name] = value;
    },
    unstubAllGlobals(): void {
        const g = globalThis as Record<string, unknown>;
        for (let i = stubbedGlobals.length - 1; i >= 0; i--) {
            const s = stubbedGlobals[i]!;
            if (s.had) g[s.key] = s.prev;
            else delete g[s.key];
        }
        stubbedGlobals.length = 0;
    },
    stubEnv(name: string, value: string | undefined): void {
        const env = envBag();
        if (!env) return;
        stubbedEnvs.push({ key: name, had: name in env, prev: env[name] });
        if (value === undefined) delete env[name];
        else env[name] = value;
    },
    unstubAllEnvs(): void {
        const env = envBag();
        if (!env) return;
        for (let i = stubbedEnvs.length - 1; i >= 0; i--) {
            const s = stubbedEnvs[i]!;
            if (s.had) env[s.key] = s.prev;
            else delete env[s.key];
        }
        stubbedEnvs.length = 0;
    },
};

class MatcherFactory {
    public not: MatcherFactory;

    constructor(
        protected readonly actualValue: unknown,
        protected readonly positive: boolean,
        negated?: MatcherFactory,
    ) {
        if (negated) {
            this.not = negated;
        } else {
            this.not = new MatcherFactory(actualValue, !positive, this);
        }
    }

    triggerResult(success: boolean, msg: string) {
        if ((success && !this.positive) || (!success && this.positive)) {
            const error = new Error(msg);
            (error as Error & _CountedError).__testFailureCounted = true;
            // Counting is owned by the observing boundary, not the throw site.
            // While an it() is on the stack, that it()'s catch will count this
            // error exactly once. If NO it() is active, the throw escaped its
            // test (a leaked late assertion); attribute it to its own pseudo-
            // test instead of corrupting whichever it() is mid-flight.
            if (activeTestDepth === 0) noteStrayFailure(msg);
            throw error;
        }
    }

    to(callback: (actualValue: unknown) => boolean) {
        this.triggerResult(callback(this.actualValue), `      Expected callback to validate`);
    }

    toBe(expectedValue: unknown) {
        this.triggerResult(
            this.actualValue === expectedValue,
            `      Expected values to match using ===\n` +
                `      Expected: ${formatValue(expectedValue)} (${typeof expectedValue})\n` +
                `      Actual: ${formatValue(this.actualValue)} (${typeof this.actualValue})`,
        );
    }

    toEqual(expectedValue: unknown) {
        this.triggerResult(
            this.actualValue == expectedValue,
            `      Expected values to match using ==\n` +
                `      Expected: ${formatValue(expectedValue)} (${typeof expectedValue})\n` +
                `      Actual: ${formatValue(this.actualValue)} (${typeof this.actualValue})`,
        );
    }

    toStrictEqual(expectedValue: unknown) {
        let success = true;
        let errorMessage = '';
        try {
            nodeAssert.deepStrictEqual(this.actualValue, expectedValue);
        } catch (e) {
            success = false;
            errorMessage = e.message || '';
        }
        this.triggerResult(
            success,
            `      Expected values to be deeply strictly equal\n` +
                `      Expected: ${JSON.stringify(expectedValue)}\n` +
                `      Actual: ${JSON.stringify(this.actualValue)}` +
                (errorMessage ? `\n      ${errorMessage}` : ''),
        );
    }

    toMatchObject(expected: unknown) {
        this.triggerResult(
            matchesObject(this.actualValue, expected),
            `      Expected value to match object (partial deep match)\n` +
                `      Expected: ${formatValue(expected)}\n` +
                `      Actual: ${formatValue(this.actualValue)}`,
        );
    }

    /** Read the recorded calls off a vi.fn() mock (empty when the value is not a mock). */
    private mockCalls(): unknown[][] {
        return (this.actualValue as { mock?: { calls?: unknown[][] } })?.mock?.calls ?? [];
    }

    toHaveBeenCalled() {
        this.triggerResult(this.mockCalls().length > 0, `      Expected mock function to have been called`);
    }

    toHaveBeenCalledTimes(times: number) {
        const actual = this.mockCalls().length;
        this.triggerResult(
            actual === times,
            `      Expected mock to have been called ${times} time(s)\n      Actual: ${actual} time(s)`,
        );
    }

    toHaveBeenCalledWith(...args: unknown[]) {
        const matched = this.mockCalls().some((call) => {
            try {
                nodeAssert.deepStrictEqual(call, args);
                return true;
            } catch {
                return false;
            }
        });
        this.triggerResult(matched, `      Expected mock to have been called with ${formatValue(args)}`);
    }

    toEqualArray(expectedValue: Array<unknown> | Uint8Array) {
        const arr = this.actualValue as unknown[];
        let success = Array.isArray(arr) && Array.isArray(expectedValue) && arr.length === expectedValue.length;

        for (let i = 0; i < arr.length; i++) {
            const actualVal = arr[i];
            const expectedVal = expectedValue[i];
            success = actualVal == expectedVal;
            if (!success) break;
        }

        this.triggerResult(
            success,
            `      Expected array items to match using ==\n` +
                `      Expected: ${formatValue(expectedValue)} (${typeof expectedValue})\n` +
                `      Actual: ${formatValue(this.actualValue)} (${typeof this.actualValue})`,
        );
    }

    toBeInstanceOf(expectedType: Function) {
        this.triggerResult(
            this.actualValue instanceof expectedType,
            `      Expected value to be instance of ${expectedType.name || expectedType}\n` +
                `      Actual: ${this.actualValue?.constructor?.name || typeof this.actualValue}`,
        );
    }

    toHaveLength(expectedLength: number) {
        const actualLength = (this.actualValue as { length?: number })?.length;
        this.triggerResult(
            actualLength === expectedLength,
            `      Expected length: ${expectedLength}\n` + `      Actual length: ${actualLength}`,
        );
    }

    toMatch(expectedValue: unknown) {
        const v = this.actualValue as { match?: (pattern: unknown) => unknown[] | null };
        if (typeof v.match !== 'function') {
            throw new Error(`You can not use toMatch on type ${typeof this.actualValue}`);
        }
        this.triggerResult(
            !!v.match(expectedValue),
            '      Expected values to match using regular expression\n' +
                '      Expression: ' +
                formatValue(expectedValue) +
                '\n' +
                '      Actual: ' +
                formatValue(this.actualValue),
        );
    }

    toBeDefined() {
        this.triggerResult(typeof this.actualValue !== 'undefined', `      Expected value to be defined`);
    }

    toBeUndefined() {
        this.triggerResult(typeof this.actualValue === 'undefined', `      Expected value to be undefined`);
    }

    toBeNull() {
        this.triggerResult(this.actualValue === null, `      Expected value to be null`);
    }

    toBeTruthy() {
        this.triggerResult(this.actualValue as unknown as boolean, `      Expected value to be truthy`);
    }

    toBeFalsy() {
        this.triggerResult(!this.actualValue, `      Expected value to be falsy`);
    }

    toBeNaN() {
        this.triggerResult(
            Number.isNaN(this.actualValue as number),
            `      Expected value to be NaN\n      Actual: ${formatValue(this.actualValue)}`,
        );
    }

    toContain(needle: unknown) {
        const value = this.actualValue;
        let contains: boolean;
        if (typeof value === 'string') {
            contains = value.includes(String(needle));
        } else if (value instanceof Array) {
            contains = value.indexOf(needle) !== -1;
        } else {
            contains = false;
        }
        this.triggerResult(contains, `      Expected ` + formatValue(value) + ` to contain ` + formatValue(needle));
    }
    toBeLessThan(greaterValue: number) {
        this.triggerResult(
            (this.actualValue as number) < greaterValue,
            `      Expected ` + formatValue(this.actualValue) + ` to be less than ` + greaterValue,
        );
    }
    toBeGreaterThan(smallerValue: number) {
        this.triggerResult(
            (this.actualValue as number) > smallerValue,
            `      Expected ` + formatValue(this.actualValue) + ` to be greater than ` + smallerValue,
        );
    }
    toBeGreaterThanOrEqual(value: number) {
        this.triggerResult(
            (this.actualValue as number) >= value,
            `      Expected ${formatValue(this.actualValue)} to be greater than or equal to ${value}`,
        );
    }
    toBeLessThanOrEqual(value: number) {
        this.triggerResult(
            (this.actualValue as number) <= value,
            `      Expected ${formatValue(this.actualValue)} to be less than or equal to ${value}`,
        );
    }
    toBeCloseTo(expectedValue: number, precision: number) {
        const shiftHelper = Math.pow(10, precision);
        this.triggerResult(
            Math.round((this.actualValue as unknown as number) * shiftHelper) / shiftHelper ===
                Math.round(expectedValue * shiftHelper) / shiftHelper,
            `      Expected ` +
                formatValue(this.actualValue) +
                ` with precision ` +
                precision +
                ` to be close to ` +
                expectedValue,
        );
    }
    toThrow(expected?: typeof Error | string | RegExp) {
        let errorMessage = '';
        let didThrow = false;
        let typeMatch = true;
        let messageMatch = true;
        const fn = this.actualValue as () => void;
        try {
            fn();
            didThrow = false;
        } catch (e) {
            errorMessage = (e as { message?: string })?.message || '';
            didThrow = true;
            if (typeof expected === 'function') {
                typeMatch = e instanceof expected;
            } else if (typeof expected === 'string') {
                messageMatch = errorMessage.includes(expected);
            } else if (expected instanceof RegExp) {
                messageMatch = expected.test(errorMessage);
            }
        }
        const functionName =
            (this.actualValue as { name?: string })?.name || typeof this.actualValue === 'function'
                ? '[anonymous function]'
                : String(this.actualValue);
        this.triggerResult(
            didThrow,
            `      Expected ${functionName} to ${this.positive ? 'throw' : 'not throw'} an exception ${!this.positive && errorMessage ? `, but an error with the message "${errorMessage}" was thrown` : ''}`,
        );

        if (typeof expected === 'function') {
            this.triggerResult(
                typeMatch,
                `      Expected Error type '${expected.name}', but the error is not an instance of it`,
            );
        } else if (expected !== undefined) {
            this.triggerResult(
                messageMatch,
                `      Expected error message to match ${expected}\n` + `      Actual message: "${errorMessage}"`,
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
                typeMatch = e instanceof expected;
            } else if (typeof expected === 'string') {
                messageMatch = errorMessage.includes(expected);
            } else if (expected instanceof RegExp) {
                messageMatch = expected.test(errorMessage);
            }
        }
        this.triggerResult(
            didReject,
            `      Expected promise to ${this.positive ? 'reject' : 'resolve'}${!this.positive && errorMessage ? `, but it rejected with "${errorMessage}"` : ''}`,
        );
        if (didReject && typeof expected === 'function') {
            this.triggerResult(
                typeMatch,
                `      Expected rejection type '${expected.name}', but the error is not an instance of it`,
            );
        } else if (didReject && expected !== undefined) {
            this.triggerResult(
                messageMatch,
                `      Expected rejection message to match ${expected}\n` + `      Actual message: "${errorMessage}"`,
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
        this.triggerResult(
            didResolve,
            `      Expected promise to ${this.positive ? 'resolve' : 'reject'}${!didResolve ? `, but it rejected with "${errorMessage}"` : ''}`,
        );
    }

    /** vitest-compatible async chain: `await expect(promise).rejects.toThrow(expected?)`. */
    get rejects() {
        return {
            toThrow: (expected?: typeof Error | string | RegExp) => this.toReject(expected),
            toReject: (expected?: typeof Error | string | RegExp) => this.toReject(expected),
        };
    }

    /** vitest-compatible async chain: `await expect(promise).resolves.toResolve()`. */
    get resolves() {
        return {
            toResolve: () => this.toResolve(),
        };
    }
}

export const describe = async function (
    moduleName: string,
    callback: Callback,
    options?: { timeout?: number } | number,
) {
    const suiteTimeoutMs = typeof options === 'number' ? options : (options?.timeout ?? timeoutConfig.suiteTimeout);

    print('\n' + moduleName);

    const prevSuite = currentSuite;
    currentSuite = moduleName;
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
    currentSuite = prevSuite;
    const duration = now() - t0;
    print(`  ${GRAY}↳ ${formatDuration(duration)}${RESET}`);

    // Reset after and before callbacks
    beforeEachCb = null;
    afterEachCb = null;
};

describe.skip = async function (moduleName: string, _callback?: Callback) {
    ++countTestsIgnored;
    print(`\n${BLUE}- ${moduleName} (skipped)${RESET}`);
};

const hasDisplay = (): boolean => {
    // Check process.env (Node.js and GJS with @gjsify/globals)
    const env = runtimeGlobals().process?.env;
    if (env) {
        return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
    }
    // GJS fallback via imports.gi.GLib (before process polyfill is available).
    // The optional-chained probe is non-throwing off GJS (`imports` is simply
    // undefined), and on GJS the GLib typelib is the runtime's own hard
    // dependency — no try/catch, which would only hide which runtime we are on.
    const GLib = runtimeGlobals().imports?.gi?.GLib;
    if (GLib) {
        return !!(GLib.getenv('DISPLAY') || GLib.getenv('WAYLAND_DISPLAY'));
    }
    return false;
};

const runtimeMatch = async function (onRuntime: Runtime[], version?: string) {
    // Special case: 'Display' checks for a graphical display, not runtime identity
    if (onRuntime.includes('Display')) {
        return { matched: hasDisplay() };
    }

    const currRuntime = await getRuntime();

    const foundRuntime = onRuntime.find((r) => currRuntime.includes(r));

    if (!foundRuntime) {
        return {
            matched: false,
        };
    }

    if (typeof version === 'string') {
        // TODO allow version wildcards like 16.x.x
        if (!currRuntime.includes(version)) {
            return {
                matched: false,
            };
        }
    }

    return {
        matched: true,
        runtime: foundRuntime,
        version: version,
    };
};

// TODO add support for Browser
/** E.g on('Deno', () {  it(...) }) */
export const on = async function (onRuntime: Runtime | Runtime[], version: string | Callback, callback?: Callback) {
    if (typeof onRuntime === 'string') {
        onRuntime = [onRuntime];
    }

    if (typeof version === 'function') {
        callback = version;
        version = undefined;
    }

    const { matched } = await runtimeMatch(onRuntime, version as string | undefined);

    if (!matched) {
        ++countTestsIgnored;
        return;
    }

    print(`\nOn ${onRuntime.join(', ')}${version ? ' ' + version : ''}`);

    await callback();
};

let beforeEachCb: Callback | undefined | null;
let afterEachCb: Callback | undefined | null;

export const beforeEach = function (callback?: Callback) {
    beforeEachCb = callback;
};

export const afterEach = function (callback?: Callback) {
    afterEachCb = callback;
};

export const it = async function (
    expectation: string,
    callback: () => void | Promise<void>,
    options?: { timeout?: number } | number,
) {
    // Opt-in skip: a caller-supplied `run({...}, { skip })` entry for this test
    // name reports it as skipped (with the reason) instead of running it. No-op
    // unless the caller populated `skip` (see `skipReasons`).
    const skipReason = skipReasons.get(expectation);
    if (skipReason !== undefined) {
        ++countTestsIgnored;
        print(`  ${BLUE}-${RESET} ${GRAY}${expectation} (skipped: ${skipReason})${RESET}`);
        return;
    }

    const timeoutMs = typeof options === 'number' ? options : (options?.timeout ?? timeoutConfig.testTimeout);

    const t0 = now();
    // Mark an it() as on the stack so a matcher throw is attributed to THIS
    // test (counted once in the catch below) rather than routed to a stray
    // pseudo-test. Balanced in `finally` so a settled test leaves depth at 0 —
    // a late assertion that fires after this test resolved is then correctly
    // recognised as out-of-band (see triggerResult / noteStrayFailure).
    ++activeTestDepth;
    try {
        if (typeof beforeEachCb === 'function') {
            await beforeEachCb();
        }

        await withTimeout(callback, timeoutMs, expectation);

        if (typeof afterEachCb === 'function') {
            await afterEachCb();
        }

        const duration = now() - t0;
        print(`  ${GREEN}✔${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
    } catch (e) {
        const duration = now() - t0;
        // The error escaped THIS test's callback → it is this test's single
        // failure. Count it exactly once here (the throw site no longer counts).
        ++countTestsFailed;
        testErrors.push({ suite: currentSuite, test: expectation, message: e.message ?? String(e) });
        const icon = e instanceof TimeoutError ? '⏱' : '❌';
        print(`  ${RED}${icon}${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
        print(`${RED}${e.message}${RESET}`);
        if (e.stack) print(e.stack);
    } finally {
        --activeTestDepth;
    }
};

it.skip = async function (expectation: string, _callback?: () => void | Promise<void>) {
    ++countTestsIgnored;
    print(`  ${BLUE}-${RESET} ${GRAY}${expectation} (skipped)${RESET}`);
};

/**
 * An EXPECTED failure — a test that asserts the correct behaviour against a
 * defect we cannot fix from here (an upstream bug, a platform gap).
 *
 * This is categorically NOT `it.skip`, and the difference is the whole point:
 *
 * - a skip stops running the code, so it hides forever and nothing ever tells
 *   you the day the bug is fixed;
 * - `it.failing` RUNS the test, tolerates the failure it was told to expect —
 *   and **fails the suite the moment the test starts passing**, because that
 *   means the marker has outlived its cause and must be removed.
 *
 * So it is self-retiring: it keeps the suite honest today without turning the
 * gate off, and it turns itself into a task the moment upstream lands the fix.
 * The assertion is never weakened — the test still asserts the spec-correct
 * behaviour, which is what makes the pass-detection meaningful.
 *
 * `reason` is mandatory and should name the upstream defect and where it is
 * tracked, so the next reader does not have to re-derive why this is here.
 *
 * ```ts
 * await it.failing(
 *     'send/receive empty string',
 *     async () => { … },
 *     'GStreamer webrtcdatachannel sends a zero-length buffer for the ' +
 *         'STRING_EMPTY PPID; RFC 8831 §6.6 requires one zero byte. Not ' +
 *         'reachable from JS — needs an upstream fix.',
 * );
 * ```
 */
/**
 * Live view of the run counters. Exposed so `it.failing`'s own spec can assert
 * on what the CI gate reads (the counters) instead of scraping printed text —
 * the summary's wording is free to change, its accounting is not.
 */
export const getTestCounters = (): { overall: number; failed: number; ignored: number; xfail: number } => ({
    overall: countTestsOverall,
    failed: countTestsFailed,
    ignored: countTestsIgnored,
    xfail: countTestsXfail,
});

it.failing = async function (expectation: string, callback: () => void | Promise<void>, reason: string) {
    const timeoutMs = timeoutConfig.testTimeout;
    const t0 = now();
    ++activeTestDepth;
    let threw = false;
    try {
        if (typeof beforeEachCb === 'function') await beforeEachCb();
        await withTimeout(callback, timeoutMs, expectation);
        if (typeof afterEachCb === 'function') await afterEachCb();
    } catch {
        // The expected outcome. Deliberately swallowed — tolerating THIS
        // failure is the contract; the assertion itself is unchanged and the
        // pass-branch below is what keeps the marker honest.
        threw = true;
    } finally {
        --activeTestDepth;
    }

    const duration = now() - t0;
    if (threw) {
        ++countTestsXfail;
        print(`  ${BLUE}✗${RESET} ${GRAY}${expectation}  (expected failure — ${reason})${RESET}`);
        return;
    }

    // It PASSED. The defect this marker documents is gone, so the marker is
    // now the lie. Fail loudly rather than let it rot: whoever fixed upstream
    // gets told to delete the marker, in the run that proves they can.
    ++countTestsFailed;
    testErrors.push({
        suite: currentSuite,
        test: expectation,
        message:
            `it.failing("${expectation}") PASSED — the expected failure no longer happens, ` +
            `so this marker is stale and must be removed (turn it back into a plain it()). ` +
            `It was marked expected-failing because: ${reason}`,
    });
    print(`  ${RED}❌${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
    print(`${RED}it.failing passed unexpectedly — remove the marker. Reason it carried: ${reason}${RESET}`);
};

// The optional second argument mirrors vitest/jest `expect(value, message?)`;
// it is a human label for the assertion and does not affect matching.
export const expect = function (actualValue: unknown, _message?: string) {
    ++countTestsOverall;

    const expecter = new MatcherFactory(actualValue, true);

    return expecter;
};

/**
 * Brand an assertion error and rethrow. Failure counting is owned by the
 * observing boundary: while an it() is on the stack its catch counts the
 * escaped error once; with no it() active the failure is out-of-band and gets
 * its own stray pseudo-test (never charged to a bystander). Mirrors
 * `MatcherFactory.triggerResult`.
 */
const failAssertion = (error: unknown): never => {
    (error as Error & _CountedError).__testFailureCounted = true;
    if (activeTestDepth === 0) noteStrayFailure((error as { message?: string })?.message ?? String(error));
    throw error;
};

export const assert = function (success: unknown, message?: string | Error) {
    ++countTestsOverall;
    try {
        nodeAssert(success, message);
    } catch (error) {
        failAssertion(error);
    }
};

assert.strictEqual = function <T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T {
    ++countTestsOverall;
    try {
        nodeAssert.strictEqual(actual, expected, message);
    } catch (error) {
        failAssertion(error);
    }
};

assert.throws = function (promiseFn: () => unknown, ...args: [AssertPredicate?, string?]) {
    ++countTestsOverall;
    let error: unknown;
    try {
        promiseFn();
    } catch (e) {
        error = e;
    }

    try {
        nodeAssert.throws(
            () => {
                if (error) throw error;
            },
            args[0],
            args[1],
        );
    } catch (assertionError) {
        failAssertion(assertionError);
    }
};

assert.deepStrictEqual = function <T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T {
    ++countTestsOverall;
    try {
        nodeAssert.deepStrictEqual(actual, expected, message);
    } catch (error) {
        failAssertion(error);
    }
};

// TODO wrap more assert methods

const runTests = async function (namespaces: Namespaces) {
    // recursively check the test directory for executable tests
    for (const subNamespace in namespaces) {
        const namespace = namespaces[subNamespace];
        // execute any test functions
        if (typeof namespace === 'function') {
            await namespace();
        }
        // descend into subfolders and objects
        else if (typeof namespace === 'object') {
            await runTests(namespace);
        }
    }
};

const browserSignalDone = () => {
    const g = runtimeGlobals();
    const doc = g.document;
    if (!doc) return;
    g.__gjsify_test_results = {
        passed: countTestsOverall - countTestsFailed,
        failed: countTestsFailed,
        total: countTestsOverall,
        errors: testErrors,
    };
    doc.documentElement.dataset.testsDone = 'true';
};

const printResult = () => {
    const totalMs = runStartTime > 0 ? now() - runStartTime : 0;
    const durationStr = totalMs > 0 ? `  ${GRAY}(${formatDuration(totalMs)})` : '';
    // Tag the summary with the runtime so a failure is self-identifying in a
    // concatenated multi-package, multi-runtime CI log — a native-Node failure
    // reads as `[Node.js …]`, not as a GJS/gjsify problem. `runtime` is set by
    // getRuntime() during the run's startup printRuntime().
    const rtTag = runtime ? `[${runtime}] ` : '';

    if (countTestsIgnored) {
        // some tests ignored
        print(`\n${BLUE}✔ ${countTestsIgnored} ignored test${countTestsIgnored > 1 ? 's' : ''}${RESET}`);
    }

    if (countTestsXfail) {
        // Expected failures are NOT silent: they are printed as their own line
        // so a reader sees the suite is gating around a known upstream defect,
        // and so the count going DOWN is visible when one gets fixed.
        print(
            `\n${BLUE}✗ ${countTestsXfail} expected failure${countTestsXfail > 1 ? 's' : ''} (it.failing — upstream defects)${RESET}`,
        );
    }

    if (strayFailures.length) {
        // Late assertions that fired with no it() on the stack (a leaked timer
        // / unawaited promise in some test). Surface them as their own line so
        // they read as a distinct problem, not a corrupted bystander test.
        print(
            `\n${RED}⚠ ${strayFailures.length} assertion${strayFailures.length > 1 ? 's' : ''} fired outside any it() (leaked from a settled test)${RESET}`,
        );
        for (const s of strayFailures) {
            print(`  ${RED}↳ ${s.message.trim().split('\n')[0]}${RESET}`);
        }
    }

    if (countTestsFailed) {
        // some tests failed
        print(`\n${RED}❌ ${rtTag}${countTestsFailed} of ${countTestsOverall} tests failed${durationStr}${RESET}`);
    } else {
        // all tests okay
        print(`\n${GREEN}✔ ${rtTag}${countTestsOverall} completed${durationStr}${RESET}`);
    }
};

const getRuntime = async () => {
    if (runtime && runtime !== 'Unknown') {
        return runtime;
    }

    if (globalThis.Deno?.version?.deno) {
        return 'Deno ' + globalThis.Deno?.version?.deno;
    }

    // Check process (GJS / Node) BEFORE document: @gjsify/dom-elements can set
    // globalThis.document on GJS, which would otherwise cause a false browser-positive.
    // dynamic import('process') throws in the browser so this stays safe there.
    {
        let process = globalThis.process;

        if (!process) {
            try {
                process = await import('node:process');
            } catch (_e) {
                // browser or runtime without process — fall through to document check
            }
        }

        if (process?.versions?.gjs) {
            runtime = 'Gjs ' + process.versions.gjs;
            return runtime;
        } else if (process?.versions?.node) {
            runtime = 'Node.js ' + process.versions.node;
            return runtime;
        }
    }

    // Only treat as Browser after confirming no Node/GJS process is present.
    // dynamic imports throw in browsers, so we are safely past that path here.
    if (typeof runtimeGlobals().document !== 'undefined') {
        runtime = 'Browser';
        return runtime;
    }

    return runtime || 'Unknown';
};

const printRuntime = async () => {
    const runtime = await getRuntime();
    print(`\nRunning on ${runtime}`);
};

export const run = async (
    namespaces: Namespaces,
    options?: { timeout?: number; testTimeout?: number; suiteTimeout?: number; skip?: Record<string, string> } | number,
) => {
    applyEnvOverrides();
    runStartTime = now();
    skipReasons = new Map();
    countTestsXfail = 0;

    if (options) {
        if (typeof options === 'number') {
            timeoutConfig.runTimeout = options;
        } else {
            if (options.timeout !== undefined) timeoutConfig.runTimeout = options.timeout;
            if (options.testTimeout !== undefined) timeoutConfig.testTimeout = options.testTimeout;
            if (options.suiteTimeout !== undefined) timeoutConfig.suiteTimeout = options.suiteTimeout;
            if (options.skip) skipReasons = new Map(Object.entries(options.skip));
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
            browserSignalDone();
            print();

            quitMainLoop(); // Pre-quit ensureMainLoop's loop so it exits immediately when the hook fires
            mainloop?.quit();

            // Node.js: exit here (code after mainloop?.run() executes before tests on Node.js)
            if (!mainloop) {
                const exitCode = countTestsFailed > 0 ? 1 : 0;
                try {
                    const process = globalThis.process || (await import('node:process'));
                    process.exit(exitCode);
                } catch (_e) {
                    /* process unavailable */
                }
            }
        });

    // Run the GJS mainloop for async operations (blocks until mainloop.quit() is called)
    mainloop?.run();

    // GJS: exit after mainloop returns (system.exit() inside a mainloop
    // callback does not terminate immediately)
    if (mainloop) {
        const exitCode = countTestsFailed > 0 ? 1 : 0;
        // Real-GJS-only path (see the `mainloop` gate above): `imports.system`
        // is a native builtin that always resolves there, `exit()` never
        // throws, and the `?.` chain already covers a host without it.
        runtimeGlobals().imports?.system?.exit(exitCode);
    }
};

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
    vi,
};
