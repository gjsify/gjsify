// The runtime-detection RULE, as a pure function of the host globals.
//
// Split out of `index.ts` so the rule can be CHECKED. The exported constants are
// module-eval reads of the one host this process is on, so a spec running on Node
// can only ever confirm the Node branch — which is how the Bun branch stayed wrong
// while every leg was green (`process.versions.node` is set on Bun, Deno and, via
// `@gjsify/process`, on GJS). Passing the globals in as an argument lets
// `detect.spec.ts` table every host shape, including the ones no CI leg runs:
// bare GJS with no `process`, and `@gjsify/node-gi` on Node with an injected
// `imports.gi`.
//
// Nothing here reads `globalThis` — `index.ts` owns that single read.

/** The host globals the detection rule reads, all optional by construction. */
export interface RuntimeHost {
    Bun?: { version?: string };
    Deno?: { version?: { deno?: string } };
    imports?: { gi?: unknown };
    process?: { versions?: { gjs?: string; node?: string } };
}

/** The runtime as the CLI vocabulary spells it (`--runtime`, `gjsify.example.runtimes`). */
export type RuntimeTarget = 'gjs' | 'node' | 'bun' | 'deno';

/** Prose name for a user interface. `'Unknown'` where no branch matched. */
export type RuntimeLabel = 'GJS' | 'Node.js' | 'Bun' | 'Deno' | 'Unknown';

export interface RuntimeIdentity {
    target: RuntimeTarget | undefined;
    name: RuntimeLabel;
    /** The version OF THIS RUNTIME, never the Node version Bun/Deno emulate. */
    version: string | undefined;
}

const LABEL: Record<RuntimeTarget, RuntimeLabel> = {
    gjs: 'GJS',
    node: 'Node.js',
    bun: 'Bun',
    deno: 'Deno',
};

/**
 * Which runtime do these globals describe?
 *
 * PROBE ORDER IS LOAD-BEARING, and each step earns its position:
 *
 *   1. `Bun` / `Deno` — the only globals unique to those two. Both fake
 *      `process.versions.node` for npm compatibility, so any version-table read
 *      before this point is a false Node positive on two of the four runtimes.
 *   2. GJS via `process.versions.gjs`, which only `@gjsify/process` sets.
 *   3. GJS via ambient `imports.gi`, but ONLY where there is no `process` at all
 *      — a bare GJS program that never pulled the Node globals in. It must not
 *      come earlier: `@gjsify/node-gi` provides `imports.gi` ON NODE, so an
 *      unconditional read names a V8 process `'GJS'`, and callers branch on this
 *      to pick a run/exit strategy (`@gjsify/unit` would take the blocking
 *      main-loop path and never return).
 *   4. real Node.
 */
export function detectRuntime(host: RuntimeHost): RuntimeIdentity {
    const target = detectTarget(host);
    if (target === undefined) return { target: undefined, name: 'Unknown', version: undefined };
    return { target, name: LABEL[target], version: versionOf(host, target) };
}

function detectTarget(host: RuntimeHost): RuntimeTarget | undefined {
    if (host.Bun !== undefined) return 'bun';
    if (host.Deno !== undefined) return 'deno';
    if (typeof host.process?.versions?.gjs === 'string') return 'gjs';
    if (host.process === undefined && host.imports?.gi !== undefined) return 'gjs';
    if (typeof host.process?.versions?.node === 'string') return 'node';
    return undefined;
}

function versionOf(host: RuntimeHost, target: RuntimeTarget): string | undefined {
    switch (target) {
        case 'bun':
            return host.Bun?.version;
        case 'deno':
            return host.Deno?.version?.deno;
        case 'gjs':
            return host.process?.versions?.gjs;
        case 'node':
            return host.process?.versions?.node;
    }
}
