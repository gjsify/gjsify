// Based on https://github.com/philipphoffmann/gjsunit

import '@girs/gjs';

import type GLib from '@girs/glib-2.0';
export * from './spy.js';
import nodeAssert from 'node:assert';
import type { AssertPredicate } from 'node:assert';
import { quitMainLoop } from '@gjsify/utils/main-loop';

/**
 * Typed view of the cross-runtime globals this runner reads. `@gjsify/unit` must
 * run on plain GJS (no Node polyfills loaded), Node.js and browsers, so every
 * `globalThis` access is potentially undefined; centralising the shapes keeps the
 * call sites on `runtimeGlobals().<field>?.…` instead of scattered `as any`.
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
        on?: (event: string, listener: (error: unknown) => void) => unknown;
        listenerCount?: (event: string) => number;
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
 * Brand for `Error`s produced by our own matchers / `assert.*` helpers: a
 * deliberate assertion-failure signal, as opposed to an unexpected impl error.
 * `toThrow`/`toReject`/`toResolve` read it to recognise an inner matcher throw
 * they are expecting and must not re-surface.
 *
 * It does NOT mean "already added to the failure count": counting is owned
 * exclusively by the boundary that OBSERVES the outcome — `it()` and the
 * run/suite timeout handlers — never by the throw site. See `triggerResult`.
 */
interface _CountedError {
    __testFailureCounted?: boolean;
}

// Decide the run/exit strategy by the ACTUAL runtime, NOT by `imports.mainloop`
// presence: GJS blocks on `imports.mainloop.run()` and quits from a callback,
// Node/Bun/Deno exit via `process.exit()` once the run settles. `@gjsify/node-gi`
// legitimately provides `imports.mainloop` on Node too, so keying on presence
// sends node-gi consumers down the GJS path, where the quit is queued as a promise
// continuation that never drains under the blocking loop — the process hangs
// forever. Gate on `process.versions.gjs`, the same signal `getRuntime()` uses.
const mainloop: GLib.MainLoop | undefined =
    typeof runtimeGlobals().process?.versions?.gjs === 'string' ? runtimeGlobals().imports?.mainloop : undefined;

let countTestsOverall = 0;
let countTestsFailed = 0;
let countTestsIgnored = 0;
/** Tests marked `it.failing` that failed as expected (see `it.failing`). */
let countTestsXfail = 0;

/**
 * Non-zero only while an `it()` callback is on the stack. A matcher throwing at
 * depth 0 escaped its test (a late assertion from a settled test's timer, or an
 * `expect()` outside any `it`); such a throw must not corrupt a bystander test's
 * tally, so it is surfaced as its own entry. See `it()` and `noteStrayFailure`.
 */
let activeTestDepth = 0;
const strayFailures: Array<{ suite: string; message: string }> = [];

/**
 * Non-gating observations: things a reader must SEE, that the runner refuses to
 * turn into a verdict because it cannot know whether they are intended.
 *
 * Distinct from the other counters: `countTestsFailed` gates the run,
 * `it.failing`'s xfail is a DECLARED expectation that self-retires, and
 * `countTestsIgnored` means "did not run". A warning ran, claims nothing and has
 * nothing to retire, so it stays out of the exit code. Anything an owner COULD
 * declare belongs in `it.failing` instead — a warning that could self-retire just
 * rots into background noise.
 */
const warnings: Array<{ suite: string; message: string }> = [];

const noteWarning = (message: string): void => {
    warnings.push({ suite: currentSuite, message });
};

/**
 * Record an assertion failure that fired with no `it()` on the stack — a real test
 * bug (missing `await`, unclosed socket, late callback) that belongs to no running
 * test, so it gets its own pseudo-test instead of an innocent bystander's tally.
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

/**
 * Per-`it()` ledgers of assertion errors THROWN while that test was on the stack.
 * `it()` removes the one its `catch` observes; anything left never reached the
 * awaited chain at all.
 *
 * That leftover is a failure class the runner was blind to: an `expect` inside a
 * host callback (`stat(p, (err, st) => { expect(…); resolve(); })`) unwinds into
 * libuv/GLib, not into the promise — so the promise never settles, and the error
 * goes wherever the HOST sends it. On Node that is `uncaughtException`, which
 * prints the minified bundle and KILLS THE PROCESS; on GJS a logged warning,
 * leaving a 5 s timeout naming neither the assertion nor the file. Measured on
 * Windows: one such `expect` in `@gjsify/fs`'s `callback.spec.ts` ended the run
 * inside the first of 19 spec modules with no summary line.
 *
 * A STACK, not a single set: `it.failing` legitimately runs nested inside an
 * `it()` (see `it-failing.spec.ts`), and a throw belongs to the INNERMOST test.
 *
 * Known limit, as for `activeTestDepth`: a late callback from an ALREADY SETTLED
 * test is charged to whichever test is running when it fires. Attribution across
 * that boundary is ambiguous — the fix is to not leak the callback.
 */
const assertionLedgers: Array<Set<Error>> = [];

/** Record a branded assertion error against the innermost running test. */
const noteThrownAssertion = (error: unknown): void => {
    const ledger = assertionLedgers[assertionLedgers.length - 1];
    if (ledger && error instanceof Error) ledger.add(error);
};

/**
 * Un-ledger an error a matcher DELIBERATELY absorbed.
 *
 * The throw `toThrow`/`toReject`/`toResolve` catch is often a nested `expect`
 * (`expect(() => expect(a).toBe(b)).toThrow()` is how their own specs are
 * written). That error is handled, not lost; leaving it in the ledger turns every
 * negative-matcher test into a phantom failure — 9 of them in this package's suite
 * the first time the ledger ran without this.
 *
 * Every site that swallows a caught error must call this: the ledger is only as
 * exact as its absorbers are honest.
 */
const forgetThrownAssertion = (error: unknown): void => {
    if (!(error instanceof Error)) return;
    for (const ledger of assertionLedgers) ledger.delete(error);
};
let runtime = '';
let runStartTime = 0;
let currentSuite = '';
/**
 * Name of the `it()` on the stack, for attributing an out-of-band observation (see
 * `noteWarning`). Only meaningful while `activeTestDepth > 0`; a settled test
 * leaves the last name in place on purpose, because a late callback naming its
 * likely origin beats naming nothing.
 */
let currentTest = '';
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
 * Opt-in per-test skip map (test name → reason), populated by `run()`'s `skip`
 * option. Lets a caller run a suite on a runtime that cannot pass a known subset
 * (e.g. a `@gjsify/node-gi` consumer hitting an unimplemented GI-marshalling
 * surface) without editing or weakening the shared spec files. Empty by default.
 */
let skipReasons: Map<string, string> = new Map();

class TimeoutError extends Error {
    constructor(label: string, timeoutMs: number) {
        super(`Timeout: "${label}" exceeded ${timeoutMs}ms`);
        this.name = 'TimeoutError';
    }
}

/**
 * Reject hooks for the `withTimeout` calls in flight (innermost last).
 *
 * An exception the HOST raises out of its own callback (Node's
 * `uncaughtException`) belongs to whichever test armed that callback; failing THAT
 * test instead of letting the host tear the process down turns a run-ending crash
 * into one reported failure with the other suites still to come. See
 * `installUncaughtHooks`.
 */
const abortHooks: Array<(error: unknown) => void> = [];

async function withTimeout<T>(fn: () => T | Promise<T>, timeoutMs: number, label: string): Promise<T> {
    if (timeoutMs <= 0) return fn();

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
    });
    // Once `fn` settles first nobody observes this rejection; claim it here so it
    // cannot become an unhandled rejection.
    timeoutPromise.catch(() => {});

    // Third racer: a host-level exception attributed to this call (see
    // `abortHooks`). Armed before `fn()` can schedule anything, and removed by
    // identity in `finally` — an index would be wrong the moment a nested
    // `withTimeout` settles out of order.
    let abort!: (error: unknown) => void;
    const abortPromise = new Promise<never>((_, reject) => {
        abort = reject;
    });
    abortPromise.catch(() => {});
    abortHooks.push(abort);

    try {
        // `fn()` belongs INSIDE the try. A synchronous throw — every failed
        // `expect` in a non-async `it` is one — used to escape before the `finally`
        // was installed, so `clearTimeout` never ran and the armed timer rejected
        // `timeoutPromise` with nobody listening: `timeoutMs` later the run died on
        // an unhandled rejection reporting a TimeoutError in place of the
        // assertion, and every later suite never ran.
        const fnPromise = Promise.resolve(fn());
        fnPromise.catch(() => {}); // Prevent unhandled rejection if it fails after timeout
        return await Promise.race([fnPromise, timeoutPromise, abortPromise]);
    } finally {
        clearTimeout(timeoutId!);
        const i = abortHooks.lastIndexOf(abort);
        if (i !== -1) abortHooks.splice(i, 1);
    }
}

/**
 * Route a host-level uncaught exception into the test that is in flight, instead
 * of letting the host end the process.
 *
 * The Node-family half of the callback-assertion fix; the ledger
 * (`assertionLedgers`) is the half that works everywhere. Neither subsumes the
 * other: without the hook the process dies before any ledger is drained, and
 * without the ledger a GJS run — where the host only logs the exception — still
 * reports a bare 5 s timeout instead of the assertion.
 *
 * BOTH events are needed, because the runtimes disagree:
 *
 * - a SYNCHRONOUS throw in a host callback arrives as `uncaughtException`
 *   everywhere;
 * - an ASYNC callback's throw rejects that function's promise, and Node (measured,
 *   v24/v26) re-raises that as `uncaughtException` under its default
 *   `--unhandled-rejections=throw` *only when no rejection listener exists*, while
 *   Bun (measured, v1.3.14) terminates the process instead — killing the run with
 *   no summary, the exact failure this hook exists to remove.
 *
 * The runner's own late rejections cannot be mis-charged here: each carries a
 * `.catch(() => {})` (see `withTimeout`), which makes it HANDLED.
 */
let uncaughtHooksInstalled = false;

const installUncaughtHooks = (): void => {
    if (uncaughtHooksInstalled) return;
    const proc = runtimeGlobals().process;
    if (typeof proc?.on !== 'function') return;
    // Real GJS has no host hook for this: `@gjsify/process` provides `on()` as an
    // EventEmitter method but nothing ever emits these events, so registering would
    // be a silent no-op that reads like coverage.
    if (typeof proc.versions?.gjs === 'string') return;

    uncaughtHooksInstalled = true;

    const handle = (event: 'uncaughtException' | 'unhandledRejection') => (error: unknown) => {
        // An escaped ASSERTION is unambiguously a test failure — that is the
        // whole class this hook exists for, and it is claimed unconditionally.
        const isAssertion = (error as _CountedError)?.__testFailureCounted === true;

        // Anything else may be an error a SPEC provokes on purpose:
        // `@gjsify/diagnostics_channel` makes a subscriber throw, installs its own
        // `uncaughtException` listener to swallow it, and asserts the remaining
        // subscribers still ran — Node invokes every listener, so this hook fired
        // too and failed a test that worked as intended. A spec's own listener is
        // therefore the signal that the escape is deliberate; ignoring all
        // non-assertion errors instead would SILENTLY swallow genuine impl errors,
        // since merely registering here already suppresses the default crash.
        //
        // "A listener exists" is only a PROXY for "this one was expected" — a spec
        // listening for ONE anticipated error is equally deaf to a real error
        // escaping beside it. Hence a non-gating WARNING: the runner cannot decide
        // it, the reader can.
        const otherListeners = (proc.listenerCount?.(event) ?? 1) - 1;
        if (!isAssertion && otherListeners > 0) {
            const text = (error as { message?: string })?.message ?? String(error);
            const where = activeTestDepth > 0 ? ` during "${currentTest}"` : '';
            noteWarning(`${event}: ${text}${where} — absorbed by a listener the spec installed itself`);
            return;
        }

        const hook = abortHooks[abortHooks.length - 1];
        // No test in flight → charge no bystander, same rule as a stray assertion.
        if (hook) hook(error);
        else noteStrayFailure((error as { message?: string })?.message ?? String(error));
    };

    // Not double-handling: an unhandled rejection is routed to `unhandledRejection`
    // once a listener exists, and re-raised as `uncaughtException` only when none
    // does, so a given error reaches exactly one of these.
    proc.on('uncaughtException', handle('uncaughtException'));
    proc.on('unhandledRejection', handle('unhandledRejection'));
};

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

// In browsers `globalThis.print` is `window.print()` — the print DIALOG, not text
// output — so browser contexts must use console.log. The GJS check takes priority
// because `@gjsify/dom-elements` can set `globalThis.document` on GJS, which would
// otherwise read as a browser.
const _isGjsProcess = typeof runtimeGlobals().process?.versions?.gjs === 'string';
export const print =
    !_isGjsProcess && typeof runtimeGlobals().document !== 'undefined' ? console.log : globalThis.print || console.log;

/**
 * Are two values deeply equal? Used ONLY to enrich a `toEqual` failure message
 * with the "you probably meant `toStrictEqual`" hint — never to decide a verdict.
 *
 * The try/catch is this function's API, not defensive padding: `deepStrictEqual`
 * signals inequality by throwing, so catching IS reading its answer. It is the
 * same oracle `toStrictEqual` uses, so the hint cannot recommend a matcher that
 * would then fail.
 */
function isStructurallyEqual(actual: unknown, expected: unknown): boolean {
    try {
        nodeAssert.deepStrictEqual(actual, expected);
        return true;
    } catch {
        return false;
    }
}

/**
 * Render any value for an assertion failure message WITHOUT throwing.
 * Template-literal / `+` interpolation throws a TypeError on `symbol` and `bigint`
 * operands, which would mask the real assertion result, so matchers route operands
 * through this rather than interpolating them.
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
            // Otherwise ledger it, so `it()` can tell "my catch saw this" from
            // "this vanished into a host callback" (see `assertionLedgers`).
            else noteThrownAssertion(error);
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
        // `==` on two objects compares REFERENCES, so this matcher can only pass for
        // primitives — while its name is the one every Jest/Vitest author reaches for
        // to compare structure. The failure then prints two identical-looking lines
        // and reads like a framework bug (it cost a CI round on #988), so detect that
        // shape and name the right matcher.
        const success = this.actualValue == expectedValue;
        let hint = '';
        if (!success && isStructurallyEqual(this.actualValue, expectedValue)) {
            hint =
                `\n      The two values are structurally equal but are not the same reference.` +
                `\n      \`toEqual\` compares with \`==\` — use \`toStrictEqual\` for deep equality.`;
        }
        this.triggerResult(
            success,
            `      Expected values to match using ==\n` +
                `      Expected: ${formatValue(expectedValue)} (${typeof expectedValue})\n` +
                `      Actual: ${formatValue(this.actualValue)} (${typeof this.actualValue})${hint}`,
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
            forgetThrownAssertion(e);
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
            forgetThrownAssertion(e);
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
            forgetThrownAssertion(e);
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

    beforeEachCb = null;
    afterEachCb = null;
};

describe.skip = async function (moduleName: string, _callback?: Callback) {
    ++countTestsIgnored;
    print(`\n${BLUE}- ${moduleName} (skipped)${RESET}`);
};

const hasDisplay = (): boolean => {
    const env = runtimeGlobals().process?.env;
    if (env) {
        return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
    }
    // GJS fallback for before the process polyfill exists. The optional-chained
    // probe is non-throwing off GJS, and on GJS the GLib typelib is the runtime's
    // own hard dependency — a try/catch would only hide which runtime we are on.
    const GLib = runtimeGlobals().imports?.gi?.GLib;
    if (GLib) {
        return !!(GLib.getenv('DISPLAY') || GLib.getenv('WAYLAND_DISPLAY'));
    }
    return false;
};

const runtimeMatch = async function (onRuntime: Runtime[], version?: string) {
    // 'Display' asks for a graphical display, not for runtime identity.
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
        // TODO(open-todos: 10 small API gaps): allow version wildcards like 16.x.x
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

// TODO(open-todos: 10 small API gaps): add support for Browser (tests/browser/ exists, this matcher cannot name it)
/** Run `callback` only on the named runtime(s): `on('Deno', () => { it(…) })`. */
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
    // Opt-in skip from `run(…, { skip })` — see `skipReasons`.
    const skipReason = skipReasons.get(expectation);
    if (skipReason !== undefined) {
        ++countTestsIgnored;
        print(`  ${BLUE}-${RESET} ${GRAY}${expectation} (skipped: ${skipReason})${RESET}`);
        return;
    }

    const timeoutMs = typeof options === 'number' ? options : (options?.timeout ?? timeoutConfig.testTimeout);

    const t0 = now();
    // Attributes a matcher throw to THIS test rather than to a stray pseudo-test.
    // Balanced in `finally`, so an assertion firing after this test resolved is
    // correctly recognised as out-of-band (see triggerResult / noteStrayFailure).
    ++activeTestDepth;
    currentTest = expectation;
    // Thrown-but-not-yet-observed assertions; whatever survives to the drain below
    // never reached the `catch` (see `assertionLedgers`).
    const ledger = new Set<Error>();
    assertionLedgers.push(ledger);

    let observed: unknown;
    let threw = false;
    try {
        if (typeof beforeEachCb === 'function') {
            await beforeEachCb();
        }

        await withTimeout(callback, timeoutMs, expectation);

        if (typeof afterEachCb === 'function') {
            await afterEachCb();
        }
    } catch (e) {
        threw = true;
        observed = e;
        // Observed by this boundary → not lost. Anything still in the ledger is.
        if (e instanceof Error) ledger.delete(e);
    } finally {
        --activeTestDepth;
        assertionLedgers.pop();
    }

    const duration = now() - t0;

    // A ledger leftover only means "lost" when the test TIMED OUT — that is the
    // signature of the class, since the throw unwound into the host instead of the
    // promise and the test could not end any other way. A test that FINISHED proves
    // its chain completed, so a leftover there was caught on purpose; that pattern
    // is spec'd (`vitest-compat.spec.ts`: "a matcher throw caught inside the test
    // does not count as a failure") and reporting it invented 2 phantom failures
    // before this narrowing.
    const lost = observed instanceof TimeoutError ? [...ledger] : [];

    if (!threw) {
        print(`  ${GREEN}✔${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
        return;
    }

    // The error escaped THIS test's callback → one failure, counted here and not at
    // the throw site, however many assertions vanished inside it.
    ++countTestsFailed;

    const messages: string[] = [];
    if (threw) messages.push((observed as { message?: string })?.message ?? String(observed));
    for (const l of lost) {
        messages.push(
            `${l.message}\n      ${GRAY}↳ thrown from a callback OUTSIDE this test's awaited chain, so it ` +
                `could not reach the test boundary. Reject the promise from that callback (or await a ` +
                `helper that does) to surface it directly.${RESET}`,
        );
    }
    const message = messages.join('\n');

    // A timeout WITH a lost assertion is not a timeout: the unsettled promise is
    // the symptom, the assertion is the cause. Report the cause, and drop the ⏱.
    const primary = lost[0] ?? observed;
    const icon = threw && observed instanceof TimeoutError && lost.length === 0 ? '⏱' : '❌';

    testErrors.push({ suite: currentSuite, test: expectation, message });
    print(`  ${RED}${icon}${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
    print(`${RED}${message}${RESET}`);
    if ((primary as { stack?: string })?.stack) print((primary as { stack: string }).stack);
};

it.skip = async function (expectation: string, _callback?: () => void | Promise<void>) {
    ++countTestsIgnored;
    print(`  ${BLUE}-${RESET} ${GRAY}${expectation} (skipped)${RESET}`);
};

/**
 * Live view of the run counters. Exposed so `it.failing`'s own spec can assert on
 * what the CI gate reads instead of scraping printed text — the summary's wording
 * is free to change, its accounting is not.
 */
export const getTestCounters = (): {
    overall: number;
    failed: number;
    ignored: number;
    xfail: number;
    warnings: number;
} => ({
    overall: countTestsOverall,
    failed: countTestsFailed,
    ignored: countTestsIgnored,
    xfail: countTestsXfail,
    warnings: warnings.length,
});

/**
 * An EXPECTED failure — a test asserting the correct behaviour against a defect we
 * cannot fix from here (an upstream bug, a platform gap).
 *
 * Categorically NOT `it.skip`: a skip stops running the code, so it hides forever
 * and nothing tells you the day the bug is fixed, whereas `it.failing` RUNS the
 * test, tolerates the failure it was told to expect, and **fails the suite the
 * moment the test starts passing** — the marker has then outlived its cause. It is
 * self-retiring, and the assertion is never weakened, which is what makes the
 * pass-detection meaningful.
 *
 * `reason` is mandatory and should name the upstream defect and where it is
 * tracked, so the next reader need not re-derive why this is here.
 */
it.failing = async function (
    expectation: string,
    callback: () => void | Promise<void>,
    reason: string,
    // `timeout` mirrors `it()`'s third argument: a probe whose expected failure IS a
    // timeout should not wait the full default. `when` scopes the EXPECTATION
    // without touching the test — see below.
    options?: { timeout?: number; when?: boolean } | number,
) {
    const timeoutMs = typeof options === 'number' ? options : (options?.timeout ?? timeoutConfig.testTimeout);

    // `when: false` → an ordinary `it()`: the test runs and must PASS, exactly as if
    // the marker were absent. This is for assertions a PLATFORM cannot satisfy
    // (`chmod` reading back 0o666 on NTFS, a stat-able character device, `S_IRUSR` —
    // correct on POSIX, impossible on win32), where the alternatives were a
    // permanently red CI or guarding the test away and losing it. Scoping the marker
    // keeps both properties: the assertion is never weakened, and it still fails the
    // run the day it starts passing on the platform where it was declared failing —
    // which a plain platform `if` gives up, and that is the half that stops the note
    // from rotting.
    if (typeof options === 'object' && options?.when === false) {
        return it(expectation, callback, { timeout: timeoutMs });
    }
    const t0 = now();
    ++activeTestDepth;
    // Own ledger frame, so an assertion thrown inside THIS probe cannot leak into
    // the enclosing it()'s ledger (`it.failing` runs nested inside an `it()` — see
    // `it-failing.spec.ts`). Nothing reads it: a lost assertion makes the probe time
    // out, which already satisfies the marker below.
    assertionLedgers.push(new Set<Error>());
    let threw = false;
    try {
        if (typeof beforeEachCb === 'function') await beforeEachCb();
        await withTimeout(callback, timeoutMs, expectation);
        if (typeof afterEachCb === 'function') await afterEachCb();
    } catch {
        // The expected outcome: tolerating THIS failure is the contract, and the
        // pass-branch below is what keeps the marker honest.
        threw = true;
    } finally {
        --activeTestDepth;
        assertionLedgers.pop();
    }

    const duration = now() - t0;
    if (threw) {
        ++countTestsXfail;
        print(`  ${BLUE}✗${RESET} ${GRAY}${expectation}  (expected failure — ${reason})${RESET}`);
        return;
    }

    // It PASSED: the defect is gone, so the marker is now the lie. Fail loudly, in
    // the run that proves whoever fixed upstream can delete it.
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

// The optional second argument mirrors vitest/jest `expect(value, message?)`: a
// human label that does not affect matching.
export const expect = function (actualValue: unknown, _message?: string) {
    ++countTestsOverall;

    const expecter = new MatcherFactory(actualValue, true);

    return expecter;
};

/**
 * Brand an assertion error and rethrow. Mirrors `MatcherFactory.triggerResult`:
 * counting belongs to the observing boundary, so with no `it()` active the failure
 * gets its own stray pseudo-test rather than a bystander's tally.
 */
const failAssertion = (error: unknown): never => {
    (error as Error & _CountedError).__testFailureCounted = true;
    if (activeTestDepth === 0) noteStrayFailure((error as { message?: string })?.message ?? String(error));
    else noteThrownAssertion(error);
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

// TODO(open-todos: 10 small API gaps): wrap more assert methods

const runTests = async function (namespaces: Namespaces) {
    for (const subNamespace in namespaces) {
        const namespace = namespaces[subNamespace];
        if (typeof namespace === 'function') {
            await namespace();
        } else if (typeof namespace === 'object') {
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
    // concatenated multi-package, multi-runtime CI log — a native-Node failure reads
    // as `[Node.js …]`, not as a GJS/gjsify problem.
    const rtTag = runtime ? `[${runtime}] ` : '';

    if (countTestsIgnored) {
        print(`\n${BLUE}✔ ${countTestsIgnored} ignored test${countTestsIgnored > 1 ? 's' : ''}${RESET}`);
    }

    if (countTestsXfail) {
        // Expected failures get their own line so a reader sees the suite is gating
        // around a known upstream defect, and so the count going DOWN is visible.
        print(
            `\n${BLUE}✗ ${countTestsXfail} expected failure${countTestsXfail > 1 ? 's' : ''} (it.failing — upstream defects)${RESET}`,
        );
    }

    if (warnings.length) {
        // Non-gating by design (see `warnings`); its own glyph plus an explicit "not
        // counted" so nobody reads it as part of the verdict.
        print(
            `\n${BLUE}⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''} (not counted — nothing is claimed about these)${RESET}`,
        );
        for (const w of warnings) {
            print(`  ${BLUE}↳ ${w.message.trim().split('\n')[0]}${RESET}`);
        }
    }

    if (strayFailures.length) {
        // Late assertions that fired with no it() on the stack (a leaked timer or
        // unawaited promise), on their own line so they read as a distinct problem
        // rather than a corrupted bystander test.
        print(
            `\n${RED}⚠ ${strayFailures.length} assertion${strayFailures.length > 1 ? 's' : ''} fired outside any it() (leaked from a settled test)${RESET}`,
        );
        for (const s of strayFailures) {
            print(`  ${RED}↳ ${s.message.trim().split('\n')[0]}${RESET}`);
        }
    }

    if (countTestsFailed) {
        print(`\n${RED}❌ ${rtTag}${countTestsFailed} of ${countTestsOverall} tests failed${durationStr}${RESET}`);
    } else {
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

    // Check process (GJS / Node) BEFORE document: `@gjsify/dom-elements` can set
    // `globalThis.document` on GJS, which would otherwise read as a browser. The
    // dynamic `import('process')` throws in the browser, hence the catch.
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

    // Browser only after no Node/GJS process was found.
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
    installUncaughtHooks();
    runStartTime = now();
    skipReasons = new Map();
    countTestsXfail = 0;
    warnings.length = 0;

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

            // Node.js exits here: without a mainloop, the code after `mainloop?.run()`
            // below would already have run before any test did.
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

    // Blocks until `mainloop.quit()`.
    mainloop?.run();

    // GJS exits only after the mainloop returns — `system.exit()` from inside a
    // mainloop callback does not terminate immediately.
    if (mainloop) {
        const exitCode = countTestsFailed > 0 ? 1 : 0;
        // Real-GJS-only path (see the `mainloop` gate above), where `imports.system`
        // is a native builtin that always resolves and `exit()` never throws.
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
