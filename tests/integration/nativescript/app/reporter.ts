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
//   __GJSIFY_NS__ SUMMARY passed=<n> failed=<n> total=<n> <runId>
//   __GJSIFY_NS__ END <PASS|FAIL> <runId>

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
    };
}

export function summary(runId: string): Summary {
    const total = passed + failed;
    console.log(`${M} SUMMARY passed=${passed} failed=${failed} total=${total} ${runId}`);
    console.log(`${M} END ${failed === 0 ? 'PASS' : 'FAIL'} ${runId}`);
    return { passed, failed, total };
}
