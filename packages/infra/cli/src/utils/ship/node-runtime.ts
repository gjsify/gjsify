// Finding the bundled Node interpreter a macOS or Windows artifact carries.
//
// WHO DECLARES IT — the question this module answers, and it is settled the same
// way it was settled for GTK. `@gjsify/node-runtime-<target>` is resolved BY NAME
// by whoever SHIPS an application, with no `optionalDependencies` edge anywhere:
// not on `@gjsify/cli`, not on the app. Making a runtime bundle a dependency of
// the library that uses it was #910 — a from-source addon met a foreign GTK,
// produced wrong method entries and a 29-minute timeout, reverted in #920 — and
// `docs/publishing.md` records the rule that replaced it. The consequence worth
// stating: `verify-published-closure.mjs` has no edge to check here, so the
// package's own publish job is the guard.
//
// WHAT THE ABSENT EDGE DOES AND DOES NOT BUY, because this header used to claim
// the app author had "nothing to add to `package.json`" and the shipped behaviour
// says otherwise. What is absent is GJSIFY's edge: installing `@gjsify/cli` drags
// in no interpreter for a platform nobody is shipping to. Finding one is still the
// SHIPPER's job and it looks in the consumer's own `node_modules` — which is why
// `stageAppRuntime` names the package when there is none: "no bundled interpreter
// — install `@gjsify/node-runtime-<target>`". So an author who wants a
// self-contained artifact installs, and therefore declares, the runtime for the
// target they package; `GJSIFY_NODE_RUNTIME` is the override that skips it.
//
// LINUX IS ABSENT ON PURPOSE and is not an omission to be filled in later: a
// `.deb`/`.rpm` declares a dependency on the distribution's Node instead
// (`depends.ts` → `NODE_PACKAGE`), the way a `--app gjs` package declares `gjs`.
// Every Linux distribution ships a Node; macOS and Windows ship none.
//
// THE CALLER IS `utils/ship/app-runtime.ts` (#1354 M2b), and this paragraph used
// to say there was none — "⚠️ NOTHING CALLS THIS YET, outside its own spec … a
// promise to a caller that does not exist yet". It exists: the macOS layout stages
// `nodePath` into `Contents/MacOS/node` and `licensePath` beside it, and the
// `null`-not-throw contract is what lets that caller stage the GTK closure it DID
// find while naming the interpreter package it did not. #1354 M3 adds the second
// caller — the Windows program directory stages `node.exe` beside its `.cmd` — so
// both non-Linux rows of the table above are now used, and this paragraph no
// longer has a "still has none" half to record.
//
// The tests keep the by-name claim honest independently of any caller: they
// resolve a real installed package out of a throwaway consumer tree holding
// nothing of gjsify, so the resolution is checked against a stranger's layout
// rather than against this monorepo's.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveInstalledPackage } from '../resolve-npm-package.js';

/** The targets a bundled interpreter is published for. */
export const NODE_RUNTIME_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const;

export type NodeRuntimeTarget = (typeof NODE_RUNTIME_TARGETS)[number];

/** Is this `<platform>-<arch>` one of the published targets? */
export function isNodeRuntimeTarget(target: string): target is NodeRuntimeTarget {
    return (NODE_RUNTIME_TARGETS as readonly string[]).includes(target);
}

/** The npm name carrying the interpreter for a target. One spelling, derived. */
export function nodeRuntimePackageName(target: NodeRuntimeTarget): string {
    return `@gjsify/node-runtime-${target}`;
}

/**
 * The interpreter's filename inside the package, from the TARGET.
 *
 * Never from `process.platform`. Assembling a Windows artifact on Linux or macOS
 * is a supported path (ADR 0024 § A1 — the packers are pure JavaScript and run
 * anywhere), and a host-derived name would look for `node` inside the win32
 * package, find nothing, and report it as a missing payload.
 *
 * `string`, not {@link NodeRuntimeTarget}, and the widening is what keeps this
 * ONE rule: `utils/ship/app-runtime.ts` has to name the interpreter's file inside
 * the ARTIFACT and holds a `GtkRuntimeTarget` when it does. Those two unions are
 * deliberately separate tables (see `GTK_RUNTIME_TARGETS`), so a narrow parameter
 * here would have forced a second `startsWith('win32-')` over there — and a stage
 * whose source is `node.exe` and whose destination is `node` is a program
 * directory whose launcher execs a file nothing staged.
 */
export function nodeRuntimeBinaryName(target: string): string {
    return target.startsWith('win32-') ? 'node.exe' : 'node';
}

/** Where the interpreter and its licence are, once found. */
export interface ResolvedNodeRuntime {
    /** The npm package it came from, or `'GJSIFY_NODE_RUNTIME'` for the override. */
    source: string;
    /** The payload directory holding both files. */
    binDir: string;
    /** Absolute path to the interpreter. */
    nodePath: string;
    /**
     * Absolute path to Node's own LICENSE.
     *
     * Part of the RESULT rather than something a caller looks up afterwards: an
     * interpreter copied into an artifact without its licence is redistribution
     * with no terms attached, and a shape that hands out the binary alone makes
     * forgetting the easier path.
     */
    licensePath: string;
}

export interface ResolveNodeRuntimeOptions {
    /** Project directory to resolve from — the consumer's, not gjsify's. */
    cwd?: string;
    /** Environment to read `GJSIFY_NODE_RUNTIME` from. Injected so it is testable. */
    env?: Record<string, string | undefined>;
}

/**
 * Locate the bundled Node interpreter for `target`, or `null`.
 *
 * Search order, mirroring `resolveGtkRuntimeBundle()` in
 * `packages/node-gi/node-gi/gtk-runtime.js` rather than inventing a second shape:
 *
 *  1. `GJSIFY_NODE_RUNTIME` — a `bin/` directory, for a maintainer holding an
 *     unpublished or patched interpreter.
 *  2. `@gjsify/node-runtime-<target>` resolved by name through
 *     {@link resolveNpmPackage}, which walks the CONSUMER's `node_modules` chain
 *     as well as the CLI bundle's own. That multi-anchor walk is what makes the
 *     "only `@gjsify/cli` installed, no gjsify checkout" case work, and it is
 *     also why this does not use a bare `createRequire`: GJS's ESM loader has no
 *     node_modules walker at all.
 *
 * `null`, never a throw. Whether a missing interpreter is fatal depends on what
 * the caller is building — and the caller is the only one that can say so
 * usefully. A package resolved but not POPULATED (the payload is gitignored, so
 * this is exactly what an in-repo checkout looks like) is also `null`: a path to
 * a file that is not there would be the worse answer, since it fails later, in a
 * copy, with the target's name nowhere in the message.
 */
export function resolveNodeRuntime(
    target: NodeRuntimeTarget,
    options: ResolveNodeRuntimeOptions = {},
): ResolvedNodeRuntime | null {
    const env = options.env ?? process.env;
    const binaryName = nodeRuntimeBinaryName(target);

    const override = env['GJSIFY_NODE_RUNTIME'];
    if (override) {
        const found = complete('GJSIFY_NODE_RUNTIME', override, binaryName);
        if (found) return found;
    }

    const packageName = nodeRuntimePackageName(target);
    // `resolveInstalledPackage`, because this binary is COPIED into a `.app` that
    // gets redistributed: under Bun a bare `resolveNpmPackage` answers from the
    // runtime's global install cache for any project without a `node_modules`, and
    // an interpreter shipped out of a cache is one the author never declared.
    const entry = resolveInstalledPackage(packageName, { cwd: options.cwd, bundleUrl: import.meta.url });
    if (entry === null) return null;
    return complete(packageName, join(dirname(entry), 'bin'), binaryName);
}

/** Both files or nothing — see {@link ResolvedNodeRuntime.licensePath}. */
function complete(source: string, binDir: string, binaryName: string): ResolvedNodeRuntime | null {
    const nodePath = join(binDir, binaryName);
    const licensePath = join(binDir, 'LICENSE');
    if (!existsSync(nodePath) || !existsSync(licensePath)) return null;
    return { source, binDir, nodePath, licensePath };
}
