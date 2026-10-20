// On-device test reporter for the NativeScript V8 runtime.
//
// We do NOT use @gjsify/unit's run() here: its terminal path calls
// process.exit() / imports.system.exit() (neither exists on NS V8 — silently
// swallowed by its try/catch) and its result counters are not exported. Instead
// this is a tiny self-contained describe/it/expect tally that prints
// unambiguous, machine-parseable markers via console.log → adb logcat.
//
// Importing @gjsify/unit would also drag its GJS-aware getRuntime() +
// import('node:process') paths into the NS bundle; keeping the on-device specs
// dependent only on the portable package under test + this reporter keeps the
// bundle free of gi:// / system / process.exit leakage (mirrors the browser-test
// "clean test files, not more aliases" rule).
//
// Marker grammar (one per line, parsed by scripts/parse-logcat.mjs):
//   __GJSIFY_NS__ BEGIN <runId>
//   __GJSIFY_NS__ CASE <PASS|FAIL> <suite> :: <name> [-- <message>]
//   __GJSIFY_NS__ INFO <suite> :: <text>
//   __GJSIFY_NS__ SUMMARY passed=<n> failed=<n> total=<n> <runId>
//   __GJSIFY_NS__ END <PASS|FAIL> <runId>
//
// INFO is this suite's one addition over the polyfill suite's reporter, and it exists
// because the device is the only place some of these facts can be read at all: which link
// of node-gi's native-require chain actually fires under Vite's ESM output, which engine
// name came back, what `uname` the ABI resolved to. They are MEASUREMENTS, not assertions
// — an INFO never passes or fails anything — but a run that reports "18/18 passed" and
// nothing else cannot answer "on what", and that question is most of stage 4.

export interface Summary {
    passed: number;
    failed: number;
    total: number;
}

const M = '__GJSIFY_NS__';
let passed = 0;
let failed = 0;
let currentSuite = 'unknown';

export function begin(runId: string): void {
    passed = 0;
    failed = 0;
    console.log(`${M} BEGIN ${runId}`);
}

export async function describe(name: string, fn: () => void | Promise<void>): Promise<void> {
    currentSuite = name;
    await fn();
}

export async function it(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
        await fn();
        passed++;
        console.log(`${M} CASE PASS ${currentSuite} :: ${name}`);
    } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`${M} CASE FAIL ${currentSuite} :: ${name} -- ${msg}`);
    }
}

/** Record a fact about the run. Tallies nothing; `scripts/parse-logcat.mjs` collects them. */
export function info(text: string): void {
    console.log(`${M} INFO ${currentSuite} :: ${text}`);
}

// Minimal Jest-shaped matcher set — enough for portable-package smoke specs.
export function expect(actual: unknown) {
    const fail = (m: string): never => {
        throw new Error(m);
    };
    const eq = (a: unknown, b: unknown): boolean => {
        if (a === b) return true;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            return JSON.stringify(a) === JSON.stringify(b);
        }
        return false;
    };
    return {
        toBe(v: unknown) {
            if (actual !== v) fail(`expected ${String(actual)} to be ${String(v)}`);
        },
        toEqual(v: unknown) {
            if (!eq(actual, v)) fail(`expected ${JSON.stringify(actual)} to equal ${JSON.stringify(v)}`);
        },
        toStrictEqual(v: unknown) {
            if (!eq(actual, v)) fail(`expected ${JSON.stringify(actual)} to strictly equal ${JSON.stringify(v)}`);
        },
        toBeTruthy() {
            if (!actual) fail(`expected ${String(actual)} to be truthy`);
        },
        toContain(v: unknown) {
            const ok =
                typeof actual === 'string' ? actual.includes(String(v)) : Array.isArray(actual) && actual.includes(v);
            if (!ok) fail(`expected ${JSON.stringify(actual)} to contain ${String(v)}`);
        },
        /** `actual` is the CALL, not its result: `expect(() => w.disconnect(id)).toThrow()`. */
        toThrow() {
            if (typeof actual !== 'function') fail(`expected a function to call, got ${String(actual)}`);
            try {
                (actual as () => unknown)();
            } catch {
                return;
            }
            fail('expected the call to throw, it returned');
        },
    };
}

export function summary(runId: string): Summary {
    const total = passed + failed;
    console.log(`${M} SUMMARY passed=${passed} failed=${failed} total=${total} ${runId}`);
    console.log(`${M} END ${failed === 0 ? 'PASS' : 'FAIL'} ${runId}`);
    return { passed, failed, total };
}
