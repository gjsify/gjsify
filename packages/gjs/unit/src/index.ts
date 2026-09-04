// Based on https://github.com/philipphoffmann/gjsunit

import '@girs/gjs';

import type GLib from '@girs/glib-2.0';
export * from './spy.js';
import nodeAssert from 'node:assert';
import type { AssertPredicate } from 'node:assert';
import { runtimeName, runtimeVersion } from '@gjsify/runtime';
import { hostOs } from '@gjsify/utils/core';
import { quitMainLoop } from '@gjsify/utils/main-loop';
import { canRealizeGl, canRealizeSurface, type DisplayEnv } from './capabilities.js';

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
        cwd?: () => string;
        on?: (event: string, listener: (error: unknown) => void) => unknown;
        listenerCount?: (event: string) => number;
    };
    performance?: { now?: () => number };
    document?: {
        documentElement: { dataset: Record<string, string> };
    };
    __gjsify_test_results?: {
        /** Tests that ran and did not fail. */
        passed: number;
        failed: number;
        /** Tests that ran — NOT assertions, which is what this used to carry (#1557). */
        total: number;
        /** Assertions executed, kept beside the total rather than instead of it. */
        assertions: number;
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

/**
 * ASSERTIONS executed — `expect()`, `assert()` and friends each add one.
 *
 * Named for what it counts since #1557, because the old name (`countTestsOverall`,
 * printed as "N completed") read as tests to every consumer that ever quoted it,
 * including two commit messages now on `main`. It is also not comparable across
 * commits: a suite that asserts inside data-driven loops moves this number without
 * changing what it verifies — measured on `@gjsify/react-native`, where 25 tests
 * were ADDED, 58 `expect(` call sites were added, nothing was skipped or deleted,
 * and the number FELL by 114. The number worth comparing is {@link countTestsRun}.
 */
let countAssertions = 0;
/**
 * TESTS that ran: one per `it()` that was not skipped, plus each `it.failing`
 * whose expectation was active.
 *
 * Stable under refactoring, which is the property `countAssertions` lacks and the
 * reason a falling count could not be read as a regression without diffing the
 * executed test NAMES by hand (#1557).
 */
let countTestsRun = 0;
let countTestsFailed = 0;
let countTestsIgnored = 0;
/**
 * Did a throw escape a suite BODY (rather than an `it()`)?
 *
 * Deliberately not part of `countTestsFailed`: the tally counts tests that RAN, and
 * a suite body that threw says nothing about the suites that never started. But the
 * process must still fail, and the summary must not read green — see the `.catch` in
 * `run` for the incident.
 */
let suiteBodyThrew = false;
/** Tests marked `it.failing` that failed as expected (see `it.failing`). */
let countTestsXfail = 0;

/**
 * What each `on()` gate actually DID, per axis it named.
 *
 * `on()` answers "is this host on that axis" and returns silently when it is not,
 * which is correct — `on('Deno', …)` is supposed to contribute nothing under Node.
 * The gap is that a gate which SHOULD have fired and did not is indistinguishable
 * from one that correctly stood down: a miss only does `++countTestsIgnored`, the
 * count is printed, and the exit code reads `countTestsFailed` alone. So an axis
 * that stopped running leaves nothing behind — strictly worse than a deleted test
 * file, which at least shows up as a file that is gone.
 *
 * `tests` is the delta the matched blocks actually executed, not the number of
 * `it()` calls they contain: a block that matched and then registered nothing is
 * the exact silent shape being measured, and it must not look like coverage.
 */
export interface AxisRecord {
    /** Gated blocks that matched this host and ran. */
    matched: number;
    /** Gated blocks that named this axis and stood down. */
    ignored: number;
    /** Tests the matched blocks executed. */
    tests: number;
}

const axisLedger = new Map<string, AxisRecord>();

const axisRecord = (axis: string): AxisRecord => {
    let rec = axisLedger.get(axis);
    if (!rec) {
        rec = { matched: 0, ignored: 0, tests: 0 };
        axisLedger.set(axis, rec);
    }
    return rec;
};

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
 * Whether the process CWD was still readable the last time a test ended.
 *
 * A spec that `chdir`s into a temp directory and then removes it leaves the whole
 * PROCESS in a deleted CWD, and every later `process.cwd()` — including one inside
 * a child this runner spawns — dies with `ENOENT … uv_cwd`. Specs share one
 * process, so the cost lands on whichever test runs next: on darwin-x64 that was
 * `@gjsify/cli`'s classifier suite failing ~30 % of runs in a spec that never
 * touches the CWD, while the spec that broke it passed.
 *
 * Latched, so only the TRANSITION is reported. Without that every remaining test in
 * the run fails too, and the culprit is buried under its own fallout.
 */
let cwdReadable = true;

/**
 * `false` once `process.cwd()` cannot resolve; `true` where there is nothing to ask.
 *
 * NODE-SIDE ONLY, and deliberately not papered over: `@gjsify/process` implements
 * `cwd()` as `GLib.get_current_dir() || '/'`, which returns a string rather than
 * throwing, so the GJS leg cannot answer this question and always reads readable.
 * That matches where the hazard is measured — the failures are `uv_cwd` from Node
 * and from Node children — and a probe that pretended otherwise would report a
 * clean CWD on the one host that cannot check.
 */
const probeCwd = (): boolean => {
    const cwd = runtimeGlobals().process?.cwd;
    if (typeof cwd !== 'function') return true;
    try {
        cwd();
        return true;
    } catch {
        // The one throw this catch exists for, and it is a real path: Node raises
        // `ENOENT: uv_cwd` from `process.cwd()` once the directory is gone. Nothing
        // else here can throw, and swallowing is the point — the verdict is the
        // return value, recorded by the caller against the test that did it.
        return false;
    }
};

/**
 * Charge a destroyed process CWD to the test that destroyed it.
 *
 * Called as each test ends. See `cwdReadable` for why attribution is the whole
 * value: the failure is otherwise reported against an innocent later test, in a
 * different suite, only sometimes.
 */
const noteIfCwdDestroyed = (expectation: string): void => {
    if (!cwdReadable || probeCwd()) return;
    cwdReadable = false;
    ++countTestsFailed;
    const message =
        `this test left the process in a deleted working directory — every later ` +
        `\`process.cwd()\`, including one inside a spawned child, now fails with ENOENT. ` +
        `A spec that \`chdir\`s into a temp dir must chdir BACK before removing it, and ` +
        `the whole run shares one process.`;
    testErrors.push({ suite: currentSuite, test: expectation, message });
    print(`  ${RED}❌ ${expectation} — ${message}${RESET}`);
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

/**
 * What `on()` gates on: a runtime IDENTITY, or a host CAPABILITY.
 *
 * `'Display'` and `'Gl'` are capabilities and deliberately separate — a gate must
 * state the thing it actually requires. They were one name until the WebGL suites
 * (which need a realizable GL context) and any plain GTK-surface test shared
 * `'Display'`, which made each wrong on a different OS. See `hasDisplay`/`hasGl`.
 */
export type Runtime = 'Gjs' | 'Deno' | 'Bun' | 'Node.js' | 'Unknown' | 'Browser' | 'Display' | 'Gl';

export interface RunOptions {
    /** Wall-clock budget for the whole run. */
    timeout?: number;
    /** Per-`it()` budget. */
    testTimeout?: number;
    /** Per-`describe()` budget. */
    suiteTimeout?: number;
    /** `expectation` → reason; skips that test and prints the reason. */
    skip?: Record<string, string>;
    /**
     * Axes this entry claims to exercise — checked, not decorative.
     *
     * Each named axis that THIS host matches must have executed at least one test
     * through an `on()` gate, or the run fails. An axis the host does not match is
     * skipped, so one built entry can declare every axis it serves and each leg is
     * held only to its own (see `failUnexercisedAxes`).
     */
    requireAxes?: readonly Runtime[];
}

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
    // This suite's own hooks, popped in `finally` below: a describe whose body
    // throws must not leave its hooks running over its siblings.
    hookFrames.push({ before: [], after: [] });
    try {
        await withTimeout(callback, suiteTimeoutMs, `describe: ${moduleName}`);
    } catch (e) {
        if (e instanceof TimeoutError) {
            // Counted AND recorded. This used to raise the tally without entering the
            // failure ledger, so the run reported "1 of N tests failed" over a ledger
            // that named nothing — which is the whole of #1159. A recap alone would
            // not have fixed it: there was nothing to recap.
            ++countTestsFailed;
            testErrors.push({ suite: moduleName, test: '<suite timed out>', message: e.message });
            print(`  ${RED}⏱ Suite timed out: ${e.message}${RESET}`);
        } else {
            throw e;
        }
    } finally {
        hookFrames.pop();
    }
    currentSuite = prevSuite;
    const duration = now() - t0;
    print(`  ${GRAY}↳ ${formatDuration(duration)}${RESET}`);
};

describe.skip = async function (moduleName: string, _callback?: Callback) {
    ++countTestsIgnored;
    print(`\n${BLUE}- ${moduleName} (skipped)${RESET}`);
};

/** Read an env var through whichever of the two hosts can answer. */
const envVar = (name: string): string | undefined => {
    const env = runtimeGlobals().process?.env;
    if (env) return env[name];
    // GJS fallback for before the process polyfill exists. The optional-chained
    // probe is non-throwing off GJS, and on GJS the GLib typelib is the runtime's
    // own hard dependency — a try/catch would only hide which runtime we are on.
    const GLib = runtimeGlobals().imports?.gi?.GLib;
    return GLib ? (GLib.getenv(name) ?? undefined) : undefined;
};

/** The real host's display env, read once per gate call (env can change mid-run). */
const displayEnv = (): DisplayEnv => ({ DISPLAY: envVar('DISPLAY'), WAYLAND_DISPLAY: envVar('WAYLAND_DISPLAY') });

const hasDisplay = (): boolean => canRealizeSurface(hostOs(), displayEnv());

const hasGl = (): boolean => canRealizeGl(hostOs(), displayEnv());

const runtimeMatch = async function (onRuntime: Runtime[], version?: string) {
    // Capabilities, not runtime identity — each answers its own question. They name
    // themselves as the matched axis for the same reason the runtime arm does: the
    // ledger must credit the axis that actually decided, never every axis listed.
    if (onRuntime.includes('Display')) {
        return { matched: hasDisplay(), runtime: 'Display' as Runtime };
    }
    if (onRuntime.includes('Gl')) {
        return { matched: hasGl(), runtime: 'Gl' as Runtime };
    }

    const currRuntime = await getRuntime();

    const foundRuntime = onRuntime.find((r) => currRuntime.includes(r));

    if (!foundRuntime) {
        return {
            matched: false,
        };
    }

    if (typeof version === 'string') {
        // TODO(open-todos: small API gaps): allow version wildcards like 16.x.x
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

// TODO(open-todos: small API gaps): add support for Browser (tests/browser/ exists, this matcher cannot name it)
/** Run `callback` only on the named runtime(s): `on('Deno', () => { it(…) })`. */
export const on = async function (onRuntime: Runtime | Runtime[], version: string | Callback, callback?: Callback) {
    if (typeof onRuntime === 'string') {
        onRuntime = [onRuntime];
    }

    if (typeof version === 'function') {
        callback = version;
        version = undefined;
    }

    const { matched, runtime: matchedAxis } = await runtimeMatch(onRuntime, version as string | undefined);

    if (!matched) {
        ++countTestsIgnored;
        // Every named axis stood down: none of them decided in favour of running.
        for (const axis of onRuntime) ++axisRecord(axis).ignored;
        return;
    }

    print(`\nOn ${onRuntime.join(', ')}${version ? ' ' + version : ''}`);

    // Measured across the gate, so a block that matched and then registered
    // nothing scores zero rather than counting as coverage (see `AxisRecord`).
    const testsBefore = countTestsRun;
    await callback();

    // ONLY the axis that matched is credited. `on(['Node.js', 'Gjs'], …)` running
    // under Node exercised Node and nothing else, and booking those tests against
    // 'Gjs' too would let the Node leg satisfy a Gjs declaration — the precise
    // false claim this ledger exists to make impossible.
    const rec = axisRecord(matchedAxis ?? onRuntime[0]);
    ++rec.matched;
    rec.tests += countTestsRun - testsBefore;
};

/**
 * The hooks in scope, one frame per enclosing `describe` plus a module-level root.
 *
 * ONE SLOT PER MODULE IS WHAT THIS REPLACES, and it failed in two directions at
 * once (#1554). A second `beforeEach` REPLACED the first silently, so a block
 * that registered its own pair switched off whatever gate was already there —
 * measured in `@gjsify/react-native`'s `widgets.spec.ts`, where the diagnostics
 * gate ran for 12 of 49 cases and a test named "…with no diagnostic" was green
 * with two `GLib-GObject-CRITICAL`s printed inside it. And `describe` nulled
 * both slots on RETURN, so hooks registered around several sibling describes
 * stopped applying after the first one — measured in `host.spec.ts`, where a GTK
 * critical injected into describe #15 surfaced twelve tests later on an innocent
 * neighbour.
 *
 * Both are the same missing structure: hooks have a SCOPE, and one variable
 * cannot hold one. A frame is pushed per `describe` and popped when it returns,
 * so a nested block inherits its parents' hooks and cannot unhook them, and two
 * registrations in one scope both run rather than one winning silently.
 *
 * ORDER is the unwinding one: `beforeEach` outermost-first in registration order,
 * `afterEach` innermost-first in reverse, so a setup/teardown pair nests the way
 * the `try`/`finally` a reader pictures would.
 */
interface HookFrame {
    before: Callback[];
    after: Callback[];
}

const hookFrames: HookFrame[] = [{ before: [], after: [] }];

const currentHookFrame = (): HookFrame => hookFrames[hookFrames.length - 1] as HookFrame;

export const beforeEach = function (callback?: Callback) {
    if (typeof callback === 'function') currentHookFrame().before.push(callback);
};

export const afterEach = function (callback?: Callback) {
    if (typeof callback === 'function') currentHookFrame().after.push(callback);
};

/** Every `beforeEach` in scope, outermost frame first. */
const runBeforeEachHooks = async (): Promise<void> => {
    for (const frame of hookFrames) for (const hook of frame.before) await hook();
};

/** Every `afterEach` in scope, unwinding: innermost frame first, reverse registration. */
const runAfterEachHooks = async (): Promise<void> => {
    for (let i = hookFrames.length - 1; i >= 0; --i) {
        const frame = hookFrames[i] as HookFrame;
        for (let j = frame.after.length - 1; j >= 0; --j) await (frame.after[j] as Callback)();
    }
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
    // Counted where the test COMMITS to running — after every skip path above, so
    // a skipped test is not a test that ran, which is the distinction a total can
    // never carry on its own (#1557).
    ++countTestsRun;
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
        await runBeforeEachHooks();

        await withTimeout(callback, timeoutMs, expectation);

        await runAfterEachHooks();
    } catch (e) {
        threw = true;
        observed = e;
        // Observed by this boundary → not lost. Anything still in the ledger is.
        if (e instanceof Error) ledger.delete(e);
    } finally {
        --activeTestDepth;
        assertionLedgers.pop();
        noteIfCwdDestroyed(expectation);
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
    /** Assertions executed. NOT comparable across commits — see {@link countAssertions}. */
    assertions: number;
    /** Tests that ran. The number that survives a refactor. */
    tests: number;
    failed: number;
    ignored: number;
    xfail: number;
    warnings: number;
} => ({
    assertions: countAssertions,
    tests: countTestsRun,
    failed: countTestsFailed,
    ignored: countTestsIgnored,
    xfail: countTestsXfail,
    warnings: warnings.length,
});

/**
 * Snapshot of what each `on()` gate did, keyed by the axis it named.
 *
 * The read side of `RunOptions.requireAxes` — a copy, so a caller cannot mutate the
 * runner's tally. Same seam and same reason as `getTestCounters()`: assert against
 * the numbers the verdict is computed from, not against printed text.
 */
export const getAxisLedger = (): Record<string, AxisRecord> => {
    const out: Record<string, AxisRecord> = {};
    for (const [axis, rec] of axisLedger) out[axis] = { ...rec };
    return out;
};

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
    // An active expectation still RUNS the test; only its verdict is inverted. The
    // `when: false` branch above delegates to `it()` and is counted there.
    ++countTestsRun;
    ++activeTestDepth;
    // Own ledger frame, so an assertion thrown inside THIS probe cannot leak into
    // the enclosing it()'s ledger (`it.failing` runs nested inside an `it()` — see
    // `it-failing.spec.ts`). Nothing reads it: a lost assertion makes the probe time
    // out, which already satisfies the marker below.
    assertionLedgers.push(new Set<Error>());
    let threw = false;
    try {
        await runBeforeEachHooks();
        await withTimeout(callback, timeoutMs, expectation);
        await runAfterEachHooks();
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
    ++countAssertions;

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
    ++countAssertions;
    try {
        nodeAssert(success, message);
    } catch (error) {
        failAssertion(error);
    }
};

assert.strictEqual = function <T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T {
    ++countAssertions;
    try {
        nodeAssert.strictEqual(actual, expected, message);
    } catch (error) {
        failAssertion(error);
    }
};

assert.throws = function (promiseFn: () => unknown, ...args: [AssertPredicate?, string?]) {
    ++countAssertions;
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
    ++countAssertions;
    try {
        nodeAssert.deepStrictEqual(actual, expected, message);
    } catch (error) {
        failAssertion(error);
    }
};

// TODO(open-todos: small API gaps): wrap more assert methods

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
        passed: countTestsRun - countTestsFailed,
        failed: countTestsFailed,
        total: countTestsRun,
        assertions: countAssertions,
        errors: testErrors,
    };
    doc.documentElement.dataset.testsDone = 'true';
};

/**
 * Hold the run to the axes it declared it would exercise.
 *
 * The declaration is HOST-CONDITIONAL on purpose: `test.mts` is built once and run
 * on every leg, so a static "must run the Gjs axis" would be a lie under Node. An
 * axis the host does not match claims nothing and is skipped here; an axis the host
 * DOES match must have executed at least one test, or the leg ran green having
 * exercised none of what it was launched for.
 *
 * Failing is the point. Reporting was already there — `countTestsIgnored` is printed
 * on every run — and it never once stopped a merge, because nothing read it.
 */
const failUnexercisedAxes = async (declared: readonly Runtime[]): Promise<void> => {
    for (const axis of declared) {
        const { matched } = await runtimeMatch([axis]);
        if (!matched) continue;

        const rec = axisLedger.get(axis);
        if (rec && rec.tests > 0) continue;

        ++countTestsFailed;
        const detail = rec
            ? `${rec.matched} gate(s) matched but executed no test, ${rec.ignored} stood down`
            : 'no on() gate named it';
        const message = `declared axis '${axis}' ran on this host but exercised nothing — ${detail}`;
        testErrors.push({ suite: '<axis declaration>', test: axis, message });
        print(`\n${RED}❌ ${message}${RESET}`);
    }
};

/**
 * The process exit code, as a pure function of the two things that decide it.
 *
 * Extracted for the same reason `formatFailureRecap` is: the two exit sites read
 * module state and call `process.exit`, neither of which a spec can reach — and this
 * rule is exactly where the regression lived. `bodyThrew` with a zero tally used to
 * answer 0, so a run that dropped eight of nine suites reported success.
 */
export const exitCodeFor = (failed: number, bodyThrew: boolean): number => (failed > 0 || bodyThrew ? 1 : 0);

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

    if (axisLedger.size) {
        // One line per axis any `on()` gate named, so "which axes did this leg
        // actually exercise" is answerable from the log alone. A `0 tests` entry is
        // the shape worth seeing: the gate fired and produced nothing.
        print(`\n${BLUE}⊞ axes exercised${RESET}`);
        for (const [axis, rec] of axisLedger) {
            print(
                `  ${BLUE}↳ ${axis}: ${rec.tests} test${rec.tests === 1 ? '' : 's'} from ${rec.matched} gate${rec.matched === 1 ? '' : 's'}${rec.ignored ? `, ${rec.ignored} stood down` : ''}${RESET}`,
            );
        }
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
        printFailureRecap(rtTag);
        print(
            `\n${RED}❌ ${rtTag}${countTestsFailed} of ${countTestsRun} tests failed${countsSuffix()}${durationStr}${RESET}`,
        );
    } else if (suiteBodyThrew) {
        // Every test that ran passed, and the run is still not a pass: a suite body
        // threw, so later suites never started. Printing the green line here — with
        // the process about to exit 1 — is the mixed signal a reader resolves in
        // favour of the colour.
        print(
            `\n${RED}❌ ${rtTag}${countTestsRun} test${countTestsRun === 1 ? '' : 's'} passed, ` +
                `then a suite body threw — the run is INCOMPLETE${countsSuffix()}${durationStr}${RESET}`,
        );
    } else {
        print(
            `\n${GREEN}✔ ${rtTag}${countTestsRun} test${countTestsRun === 1 ? '' : 's'} passed` +
                `${countsSuffix()}${durationStr}${RESET}`,
        );
    }
};

/**
 * What the summary line carries besides the verdict: assertions, and skips.
 *
 * BOTH ARE THERE BECAUSE OF WHAT THE OLD LINE HID (#1557). It read `N completed`,
 * `N` was assertions, and every consumer quoted it as tests — so a number that
 * fell because a table got tidier read exactly like a gate that had started
 * skipping. Refuting that needed the skipped count and the executed test names,
 * and neither was in the line everyone quotes. A skip is arithmetically
 * indistinguishable from a deleted test in a total, so the total alone can never
 * separate them; the count of skips can, and costs one clause.
 */
const countsSuffix = (): string => {
    const parts = [`${countAssertions} assertion${countAssertions === 1 ? '' : 's'}`];
    if (countTestsIgnored) parts.push(`${countTestsIgnored} ignored`);
    return `  ${GRAY}· ${parts.join(' · ')}${RESET}`;
};

/**
 * Name every failure, right above the summary that counts them.
 *
 * WHY (#1159). The summary line was the only failure signal and it names nothing, and
 * NO marker distinguished a failing line from a passing one: a grep for `✖`, `✘`,
 * `❌`, `not ok` or `AssertionError` over a 9305-line CI log returned the summary and
 * nothing else. Locating one test name in a red macOS run took about fifteen minutes
 * of pure retrieval — and at the time `macos-suites.yml` / `windows-suites.yml` ran on
 * `main` and the nightly only, so the least readable legs were exactly the ones nobody
 * watched live, read by someone deciding whether their merge did it. Those two now run
 * on PRs as well (ADR 0018, § 5 re-measured), which raises the value of this rather
 * than lowering it: the logs are read by more people, earlier, and still advisory —
 * nothing forces the reading.
 *
 * `✖` is the marker because it appears nowhere else in this runner's output (`✗` is
 * expected failures, `❌` is the per-test line and the summary), so `grep '✖'` alone
 * answers "what failed" without any recap being read.
 *
 * IT ALSO REPORTS ITS OWN BLIND SPOT. The tally and the ledger are two counters, and
 * they were out of step: both timeout paths raised the tally without recording
 * anything, which is why the incident that motivated #1159 had nothing to recap in
 * the first place. Rather than silently listing fewer failures than it counted, a
 * mismatch is stated — a gap that announces itself cannot be mistaken for a clean
 * list.
 */
const printFailureRecap = (rtTag: string): void => {
    for (const line of formatFailureRecap(testErrors, countTestsFailed, rtTag)) print(line);
    // On Actions, also put the names on the run's SUMMARY page. That is where the
    // person who just merged is already looking, and until now the only annotation
    // there was `Process completed with exit code 1`.
    if (envVar('GITHUB_ACTIONS')) for (const line of formatFailureAnnotations(testErrors, rtTag)) print(line);
};

/**
 * The failures as GitHub Actions `::error::` workflow commands.
 *
 * Separate from the human recap because the constraints differ: a command must start
 * at column 0, carry no SGR codes (they would be printed literally in the annotation),
 * and encode newlines as `%0A`. Emitting a coloured recap line here would put escape
 * sequences on the summary page.
 *
 * Capped, because Actions renders at most ten annotations per step and this runner is
 * launched once per runtime per shard — a 200-failure leg would spend the whole budget
 * on one shard and push every other leg's first failure off the page. The count is
 * stated when it truncates, so the cap can never read as "that was all of them".
 */
export const formatFailureAnnotations = (
    entries: ReadonlyArray<{ suite: string; test: string; message: string }>,
    rtTag = '',
    max = 10,
): string[] => {
    const escape = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const lines = entries
        .slice(0, max)
        .map(
            (e) =>
                `::error title=${escape(`${rtTag}${e.suite} › ${e.test}`)}::${escape(e.message.trim().split('\n')[0]!)}`,
        );
    if (entries.length > max) {
        lines.push(
            `::error title=${escape(`${rtTag}more failures`)}::${entries.length - max} further failure(s) — see the ✖ recap in the log`,
        );
    }
    return lines;
};

/**
 * The recap's LINES, as a pure function of the ledger and the tally.
 *
 * Split out so a spec can drive the shipping formatter: `printFailureRecap` reads
 * module-level state and writes to stdout, neither of which a test can reach — and a
 * reporter nothing tests is how the gap in #1159 lasted this long. The colour codes
 * are applied here too, so assertions see the shipped strings rather than a parallel
 * spelling of them.
 */
export const formatFailureRecap = (
    entries: ReadonlyArray<{ suite: string; test: string; message: string }>,
    countFailed: number,
    rtTag = '',
): string[] => {
    const lines = [`\n${RED}✖ ${rtTag}failed test${entries.length === 1 ? '' : 's'}${RESET}`];
    for (const e of entries) {
        // First line only: an assertion's message can be a multi-line diff, and this
        // block exists to be SCANNED. The full text is already above, at the failure.
        const reason = e.message.trim().split('\n')[0];
        lines.push(`  ${RED}✖ ${e.suite} › ${e.test}${RESET}${GRAY} — ${reason}${RESET}`);
    }

    if (entries.length !== countFailed) {
        lines.push(
            `  ${RED}✖ ${countFailed} failure${countFailed === 1 ? '' : 's'} counted but ` +
                `${entries.length} named — a failure path is raising the tally without recording ` +
                `itself, so this list is INCOMPLETE${RESET}`,
        );
    }
    return lines;
};

/**
 * This runner's name for the host, e.g. `'Gjs 1.88.1'`, `'Bun 1.3.14'`, `'Browser'`.
 *
 * The identity comes from `@gjsify/runtime`, which is the one place the four-way
 * probe order is written down and the one place it is table-checked. This runner
 * re-derived it and had no Bun branch at all, so `process.versions.node` — which
 * Bun fakes — made every `on('Node.js', …)` suite RUN on Bun while reporting
 * itself as Node. `'Gjs'` and `'Browser'` are this API's own vocabulary (`on()`
 * has always spelled it that way, and a browser is not one of the four runtimes),
 * hence the mapping rather than a direct re-export.
 */
const RUNTIME_LABEL: Record<string, string> = { GJS: 'Gjs', 'Node.js': 'Node.js', Bun: 'Bun', Deno: 'Deno' };

const getRuntime = async () => {
    if (runtime && runtime !== 'Unknown') {
        return runtime;
    }

    const label = RUNTIME_LABEL[runtimeName];
    if (label) {
        runtime = runtimeVersion ? `${label} ${runtimeVersion}` : label;
        return runtime;
    }

    // Only after no runtime answered: `@gjsify/dom-elements` can set
    // `globalThis.document` on GJS, so this must never be asked first.
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

export const run = async (namespaces: Namespaces, options?: RunOptions | number) => {
    applyEnvOverrides();
    installUncaughtHooks();
    runStartTime = now();
    skipReasons = new Map();
    countTestsXfail = 0;
    warnings.length = 0;
    axisLedger.clear();
    cwdReadable = probeCwd();

    suiteBodyThrew = false;
    let requireAxes: readonly Runtime[] = [];
    if (options) {
        if (typeof options === 'number') {
            timeoutConfig.runTimeout = options;
        } else {
            if (options.timeout !== undefined) timeoutConfig.runTimeout = options.timeout;
            if (options.testTimeout !== undefined) timeoutConfig.testTimeout = options.testTimeout;
            if (options.suiteTimeout !== undefined) timeoutConfig.suiteTimeout = options.suiteTimeout;
            if (options.skip) skipReasons = new Map(Object.entries(options.skip));
            if (options.requireAxes) requireAxes = options.requireAxes;
        }
    }

    printRuntime()
        .then(async () => {
            try {
                await withTimeout(() => runTests(namespaces), timeoutConfig.runTimeout, 'entire test run');
            } catch (e) {
                if (e instanceof TimeoutError) {
                    // Recorded for the same reason as the suite timeout above: a
                    // counted failure that is absent from the ledger cannot be named
                    // in the recap, and the recap is the only place a CI reader looks.
                    print(`\n${RED}⏱ ${e.message}${RESET}`);
                    ++countTestsFailed;
                    testErrors.push({ suite: '<test run>', test: '<run timed out>', message: e.message });
                } else {
                    throw e;
                }
            }
        })
        .then(() => failUnexercisedAxes(requireAxes))
        .catch((error: unknown) => {
            // A throw that ESCAPED a suite body rather than an `it()` — an `expect()`
            // called directly in a `describe` callback, a failing top-level import, a
            // gate that threw. `describe` rethrows anything that is not a
            // `TimeoutError`, deliberately, and until this `catch` existed that
            // rejection simply broke the chain: the `.then` below was skipped, so
            // `printResult()` never printed AND `process.exit(exitCode)` never ran —
            // and Node, with nothing left pending, exited **0** with the log cut off
            // mid-suite. Every remaining suite was silently dropped and CI read the
            // run as a pass.
            //
            // MEASURED, and it is why this was found at all: gtk-host's
            // `buildable.spec.ts` asserts directly in a `describe` body, that
            // assertion holds on GJS and fails under node-gi (`vfunc_add_child` is
            // `undefined` there), and the node leg reported SUCCESS having run one
            // suite out of nine. Reproduced with no GTK involved: a two-describe
            // fixture whose first body throws prints the first `it`, drops the second
            // describe entirely, and exits 0.
            //
            // This branch deliberately touches NEITHER `countTestsFailed` NOR
            // `testErrors`, and that is the second thing measured. An escaped
            // ASSERTION is already owned by the assertion ledger, which drains it as
            // a stray failure — counting it again here reported "2 of 2 tests failed"
            // for one `expect()`. And the brand on a matcher error cannot be used to
            // tell the two apart: it means "produced by our matchers", explicitly not
            // "already counted". Pushing an entry without raising the tally is no
            // better, because the recap's own consistency check reads that as a
            // failure path hiding itself.
            //
            // So the ledger keeps the tally and this branch owns exactly one thing:
            // the run must not be able to end at 0. The printed line sits directly
            // above the recap, which is where a CI reader is already looking.
            suiteBodyThrew = true;
            const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
            print(
                `\n${RED}❌ a suite body threw, so the run is INCOMPLETE and every later suite was skipped` +
                    `${currentSuite ? ` (in "${currentSuite}")` : ''} — ${message}${RESET}`,
            );
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
                const exitCode = exitCodeFor(countTestsFailed, suiteBodyThrew);
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
        const exitCode = exitCodeFor(countTestsFailed, suiteBodyThrew);
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
