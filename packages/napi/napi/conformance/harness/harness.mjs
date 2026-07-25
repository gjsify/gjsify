// SPDX-License-Identifier: MIT
// @gjsify/napi — conformance harness (shared by the Node golden + the
// GJS-under-shim twin). PURE JS: no runtime-specific imports, so the SAME
// module loads unchanged on Node and on GJS (`gjs -m`).
//
// A conformance PROGRAM (conformance/programs/<name>.mjs) is runtime-agnostic:
// it exports `meta` (which addon dir + targets it needs) and a default async
// `run(h)` that exercises the addon and prints a deterministic transcript via
// `h.emit(...)`. The golden is the transcript Node produces; GJS-under-shim
// must reproduce it byte-for-byte. The orchestrator (scripts/conformance.mjs)
// generates a per-runtime twin that wires the runtime primitives (loadAddon /
// write / gc) into `makeHarness` and calls `run`.
//
// Determinism is the whole point: emit() stringifies every value the SAME way
// on both runtimes (engine-specific `String(fn)` / object `toString` output is
// never printed raw), so a diff is a genuine behavioral divergence, never a
// formatting artifact.

/** Deterministic, cross-engine stringification of a single value. */
function fmtArg(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    switch (typeof v) {
        case 'number':
            return Object.is(v, -0) ? '-0' : String(v);
        case 'bigint':
            return String(v) + 'n';
        case 'string':
            return JSON.stringify(v); // quoted + escaped → byte-stable
        case 'boolean':
            return String(v);
        case 'symbol':
            return v.toString(); // "Symbol(desc)" — engine-stable
        case 'function':
            // NEVER String(fn): SpiderMonkey and V8 print function source
            // differently. Print only the stable shape.
            return `[function ${v.name || '(anonymous)'}]`;
        default: {
            // object: print a controlled shape. Arrays get their elements
            // (recursively via fmtArg); plain objects a sorted key list.
            if (Array.isArray(v)) return '[' + v.map(fmtArg).join(',') + ']';
            const tag = Object.prototype.toString.call(v); // "[object Object]" etc — engine-stable
            return tag;
        }
    }
}

/**
 * Build the harness object passed to a program's `run(h)`.
 * @param {object} prims
 * @param {(name: string) => object} prims.loadAddon  resolve a built target → its exports
 * @param {(line: string) => void}   prims.write      write ONE line (incl. its trailing newline)
 * @param {() => void}               prims.gc         force a full GC (Node global.gc / GJS system.gc)
 * @param {() => Promise<void>}      [prims.tick]     yield a MACROTASK (Node setImmediate /
 *   GJS main-context iteration) — the turn a deferred finalizer needs to run. A
 *   microtask (`Promise.resolve`) is NOT enough: Node schedules JS finalizers on
 *   the immediate/loop tick, not the microtask queue.
 */
export function makeHarness({ loadAddon, write, gc, tick }) {
    const gcFn = () => {
        if (gc) gc();
    };
    const tickFn = tick ?? (() => Promise.resolve());

    /** Print a deterministic, space-joined line. */
    const emit = (...args) => write(args.map(fmtArg).join(' '));

    /**
     * GC until `pred()` is true or the budget is exhausted. Prints NOTHING —
     * only the final observable state a program emits separately is compared,
     * so the (nondeterministic) iteration count never leaks into the golden.
     * A timeout throws (the driver then fails loudly on both runtimes only if
     * the invariant genuinely does not hold — on the reference it must).
     */
    async function gcUntil(pred, label = '') {
        for (let i = 0; i < 200; i++) {
            if (pred()) return;
            gcFn();
            // Yield a macrotask so a finalizer scheduled off the GC drain can run.
            await tickFn();
        }
        if (!pred()) throw new Error(`gcUntil timeout: ${label}`);
    }

    /** Hard driver invariant (throws → the twin exits non-zero). Not printed. */
    function assert(cond, msg) {
        if (!cond) throw new Error(`driver-assert failed: ${msg || ''}`);
    }

    /**
     * Run `fn`, returning the thrown error's `.message` (or the coerced value)
     * as a string, or null when it did not throw. The deterministic stand-in
     * for `assert.throws(fn, /re/)`: emit the caught message and the golden
     * pins it — a different message or a missing throw fails the diff.
     */
    function caught(fn) {
        try {
            fn();
            return null;
        } catch (e) {
            return e && e.message !== undefined ? String(e.message) : String(e);
        }
    }

    /**
     * Like `caught`, but returns the error's CONSTRUCTOR NAME (e.g. 'TypeError')
     * or 'no-throw'. Use this for errors the JS ENGINE throws (not the addon /
     * shim) — their `.message` differs between V8 and SpiderMonkey, while the
     * error TYPE is the invariant the upstream test actually asserts
     * (`assert.throws(fn, TypeError)`). Engine-neutral, never weakened.
     */
    function caughtName(fn) {
        try {
            fn();
            return 'no-throw';
        } catch (e) {
            return e && e.constructor && e.constructor.name ? e.constructor.name : String(e);
        }
    }

    /**
     * `${name}: ${message}` of a thrown error (or 'no-throw'). For errors the
     * ADDON/shim raises — name (Error/TypeError/…) and message are the shim's,
     * stable across engines — matching the upstream `assert.throws(fn, /^Name: msg$/)`.
     */
    function caughtFull(fn) {
        try {
            fn();
            return 'no-throw';
        } catch (e) {
            if (e && typeof e === 'object' && 'name' in e && 'message' in e) return `${e.name}: ${e.message}`;
            return String(e);
        }
    }

    return { loadAddon, emit, gc: gcFn, gcUntil, assert, caught, caughtName, caughtFull, fmt: fmtArg };
}
