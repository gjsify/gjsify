// SPDX-License-Identifier: MIT
// Reference: Node.js lib/child_process.js (surface mirror only).
//
// The BROWSER platform entry for `@gjsify/child_process` — the module
// `gjsify build --app browser` resolves for `child_process` / `node:child_process`
// (see `ALIASES_NODE_FOR_BROWSER_TABLE` in
// `packages/infra/resolve-npm/lib/index.mjs`).
//
// ## Why this file exists at all
//
// Nothing here works, and nothing here CAN work: a browser sandbox has no
// process model. There is no Web API that creates, signals or reaps an OS
// process, and there never will be one — it is a deliberate property of the
// sandbox, not a gap waiting for a polyfill.
//
// That is precisely why the previous mapping (`child_process` → `@gjsify/empty`)
// was wrong, in two separate ways:
//
//   1. It was SILENT. `@gjsify/empty` is a shared, anonymous `export default {}`
//      that a dozen unrelated specifiers also resolve to, so a bundle could not
//      distinguish "deliberately stubbed because impossible" from "accidentally
//      aliased because someone forgot to wire the entry". Both produced the same
//      module, which is exactly the camouflage that let `@gjsify/canvas2d`'s
//      build emit a stray `@gjsify/empty` import unnoticed.
//   2. It exported NOTHING. `import { spawn } from 'child_process'` therefore
//      either failed to link under strict ESM or bound `spawn` to `undefined`,
//      and the program then died at `spawn is not a function` — a TypeError
//      thrown arbitrarily far from the import that caused it, naming neither the
//      module nor the platform.
//
// So this entry exports the module's REAL named shape (the same value exports
// `src/index.ts` declares — the oracle `collectValueExports` in
// `@gjsify/manifest-conformance` reads, which is also what the audit's
// `platform-entry-parity` check uses) and every one of them throws a structured
// error that names the module, the target runtime and the calling site.
//
// Slot: browser:"none" — a NAMED unsupported stub, not a polyfill and not a
// partial. That declaration is still the truth: `none` says the MODULE is not
// usable on this runtime, and it is not. This entry does not make it usable, it
// makes the unusability legible. `scripts/audit-runtimes.mjs` reads the marker
// on the line above (same mechanism as the `Slot: browser:"partial"` marker
// `@gjsify/http`'s browser entry carries) so its drift heuristic does not read
// the mere EXISTENCE of a `src/browser.ts` as a promotion to `polyfill`.
//
// NB the `unsupported()` helper below is deliberately LOCAL rather than shared.
// It is the same choice `src/browser.ts` in `@gjsify/http` and `@gjsify/dns`
// already made (each carries its own `notSupported` / `makeNotSupported`), and
// it keeps this entry free of ANY import — a browser platform entry that
// imports nothing cannot leak a GJS dependency into a browser bundle. If this
// pattern grows past a handful of modules, lift it into `@gjsify/utils/core`
// (the cross-runtime half, ADR 0014) rather than copying it a tenth time.

const MODULE = 'child_process';
const RUNTIME = 'browser';
const REASON = 'a browser sandbox has no process model — no Web API can create, signal or reap an OS process';

interface UnsupportedError extends Error {
    code: string;
    errno: number;
    syscall: string;
    /** The Node module whose surface was called. */
    gjsifyModule: string;
    /** The build target this entry was resolved for. */
    gjsifyRuntime: string;
    /** Best-effort call site of the importer, extracted from the stack. */
    gjsifyImporter?: string;
}

/**
 * Best-effort "who called us" from a stack trace.
 *
 * In a bundled browser build every module is inlined into one file, so a frame
 * cannot be attributed by filename — but it CAN be attributed by position in
 * the stack, which is fixed by construction: `unsupported()` is only ever
 * called directly from one of this module's exported bindings, so after
 * dropping this helper's own frames the FIRST survivor is that exported
 * binding (still inside this stub) and the SECOND is the importer's call site.
 * Falls back to the first survivor if the engine gave us only one frame.
 */
function callerFrame(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    const frames: string[] = [];
    for (const raw of stack.split('\n').slice(1)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.includes('unsupported') || line.includes('callerFrame')) continue;
        frames.push(line.replace(/^at\s+/, ''));
        if (frames.length === 2) break;
    }
    return frames[1] ?? frames[0];
}

/** Throw a structured, self-describing "not on this platform" error. */
function unsupported(name: string): never {
    const importer = callerFrame(new Error().stack);
    const err = new Error(
        `[@gjsify/${MODULE}/${RUNTIME}] ${MODULE}.${name} is not available on the ${RUNTIME} platform: ` +
            `${REASON}.${importer ? ` Called from ${importer}.` : ''}`,
    ) as UnsupportedError;
    err.code = 'ENOTSUP';
    err.errno = -45;
    err.syscall = name;
    err.gjsifyModule = MODULE;
    err.gjsifyRuntime = RUNTIME;
    if (importer !== undefined) err.gjsifyImporter = importer;
    throw err;
}

/**
 * `child_process.ChildProcess` — constructing one implies an OS process handle,
 * which does not exist here. Present so `import { ChildProcess } from
 * 'child_process'` links and so `instanceof` checks compile; throws on `new`.
 */
export class ChildProcess {
    constructor() {
        unsupported('ChildProcess');
    }
}

export function spawn(..._args: unknown[]): ChildProcess {
    return unsupported('spawn');
}

export function spawnSync(..._args: unknown[]): never {
    return unsupported('spawnSync');
}

export function exec(..._args: unknown[]): ChildProcess {
    return unsupported('exec');
}

export function execSync(..._args: unknown[]): never {
    return unsupported('execSync');
}

export function execFile(..._args: unknown[]): ChildProcess {
    return unsupported('execFile');
}

export function execFileSync(..._args: unknown[]): never {
    return unsupported('execFileSync');
}

const childProcessDefault = {
    ChildProcess,
    spawn,
    spawnSync,
    exec,
    execSync,
    execFile,
    execFileSync,
};

export default childProcessDefault;
