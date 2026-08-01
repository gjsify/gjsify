// SPDX-License-Identifier: MIT
// @gjsify/node-gi/system — the GJS `System` module on Node.
//
// GJS exposes a built-in `system` module (`import System from 'system'` /
// `imports.system`) for process identity + lifecycle: `exit`, `gc`, the
// program-identity accessors (`programInvocationName`/`programPath`/
// `programArgs`), `version`, plus the introspection/debug helpers
// (`addressOf`/`refcount`/`breakpoint`/`dumpHeap`/…). On Node these don't
// exist, so this module re-creates the surface, routed through Node's
// `process` where there is an equivalent and a safe no-op otherwise.
//
// This is the single source of truth for the System surface: the legacy
// `imports.system` exposed by `@gjsify/node-gi/globals` re-uses this module's
// default export (no duplicated logic). The gjsify `--app node` build aliases
// the bare `system` specifier to this module (kept external — `ALIASES_GJS_FOR_NODE`).
//
// Reference: GJS's `system` module (refs/gjs/modules/esm/system.js + the native
// modules/system.cpp). Members with no meaningful Node equivalent
// (addressOf/refcount/clearDateCaches/dumpHeap/dumpMemoryInfo) are safe no-ops
// returning the same shape GJS does — they exist so GJS source that calls them
// keeps running unmodified, not to reproduce SpiderMonkey internals.

// The RUNTIME's own `process`, bound ONCE at module evaluation.
//
// `globalThis.process` is NOT a safe source for this module: a GJS program run
// through the reverse bridge routinely installs the gjsify `@gjsify/process`
// polyfill over it (`@gjsify/node-globals/register` defines it unconditionally),
// and that polyfill's `exit()` takes its GJS path whenever `imports.system.exit`
// exists — i.e. it delegates back into THIS module. Reading `globalThis.process`
// in `exit()` closes that loop into an infinite, GLib-idle-driven recursion
// (exit → polyfill → system.exit → polyfill → …) that spins at 100 % CPU and
// never terminates. `getBuiltinModule('node:process')` (Node ≥ 22.3 / Bun /
// Deno 2) returns the real builtin regardless of what the global currently is;
// the module-evaluation capture is the fallback for hosts without it — this
// module is loaded from `@gjsify/node-gi/globals`, before any bundle body (and
// therefore before any register side effect) runs.
const runtimeProcess = (() => {
    const hostProcess = typeof process !== 'undefined' ? process : undefined;
    try {
        const builtin = hostProcess?.getBuiltinModule?.('node:process');
        if (builtin && typeof builtin.exit === 'function') return builtin;
    } catch {
        // getBuiltinModule missing or refusing the specifier — use the captured one.
    }
    return hostProcess;
})();

const runtimeExit = typeof runtimeProcess?.exit === 'function' ? runtimeProcess.exit.bind(runtimeProcess) : undefined;

// `programArgs` mirrors GJS's ARGV: the script arguments, excluding the
// interpreter (argv[0]) and the script path (argv[1]).
function readProgramArgs() {
    return Array.isArray(runtimeProcess?.argv) ? runtimeProcess.argv.slice(2) : [];
}

// `programInvocationName` / `programPath` track the running script — Node's
// `process.argv[1]`.
function readProgramInvocationName() {
    return runtimeProcess?.argv?.[1] || '';
}

function readProgramPath() {
    return runtimeProcess?.argv?.[1] || null;
}

/**
 * Exit the process (GJS `System.exit`).
 *
 * Terminal by contract: under gjs this is the `exit()` syscall — it never
 * returns and nothing a program installs can intercept it. The Node/Bun/Deno
 * equivalent is the RUNTIME's own `process.exit`, resolved above; routing
 * through `globalThis.process` instead is what produced the never-exiting
 * reverse-bridge process (see the `runtimeProcess` note and
 * `conformance/programs/system-exit-lifetime.conf.mjs`).
 */
export function exit(code) {
    if (runtimeExit !== undefined) runtimeExit(code ?? 0);
}

/** Trigger a garbage collection if the host exposed `globalThis.gc` (`--expose-gc`). */
export function gc() {
    if (typeof globalThis.gc === 'function') globalThis.gc();
}

/** The SpiderMonkey/mozjs version number — no equivalent on Node, reported as 0. */
export const version = 0;

/** The script arguments (GJS ARGV) — Node `process.argv.slice(2)`. */
export const programArgs = readProgramArgs();

/** The running script's invocation name — Node `process.argv[1]`. */
export const programInvocationName = readProgramInvocationName();

/** The running script's path — Node `process.argv[1]` (or null). */
export const programPath = readProgramPath();

/** Return the address of a JS object as a string. No Node equivalent — stub. */
export function addressOf() {
    return '0x0';
}

/** Return the address of a GObject as a string. No Node equivalent — stub. */
export function addressOfGObject() {
    return '0x0';
}

/** Return the refcount of a GObject. No Node equivalent — stub. */
export function refcount() {
    return 0;
}

/** Trigger a debugger breakpoint. No-op on Node. */
export function breakpoint() {}

/** Clear the Date timezone caches (GJS calls this after a TZ change). No-op on Node. */
export function clearDateCaches() {}

/** Dump the JS heap to a file. No-op on Node. */
export function dumpHeap() {}

/** Dump memory info to a file. No-op on Node. */
export function dumpMemoryInfo() {}

/**
 * The GJS `System` module as a default export — the object shape
 * `import System from 'system'` returns. The program-identity members are live
 * getters (read `process.argv` on access) for fidelity with GJS, where they
 * track the running script.
 */
const System = {
    exit,
    gc,
    version,
    addressOf,
    addressOfGObject,
    refcount,
    breakpoint,
    clearDateCaches,
    dumpHeap,
    dumpMemoryInfo,
    get programArgs() {
        return readProgramArgs();
    },
    get programInvocationName() {
        return readProgramInvocationName();
    },
    get programPath() {
        return readProgramPath();
    },
};

export default System;
