// Bundle inputs manifest — record which WORKSPACE PACKAGES a bundle inlined.
//
// The committed GJS bundles (`packages/infra/cli/dist/{cli,affected}.gjs.mjs`,
// `packages/infra/tsc/dist/tsc.gjs.mjs`) inline the `lib/esm` of their whole
// transitive workspace-dep closure, so editing ANY of those packages stales
// them. The pre-commit hook that auto-rebuilds the bundles used to trigger on
// a hand-maintained five-path list — a list that structurally cannot keep up
// with the real closure, and repeatedly did not (`@gjsify/fetch`, `@gjsify/
// utils`+`@gjsify/fs`, `@gjsify/zlib` each cost a ~20-minute CI round trip
// against `scripts/verify-committed-bundles.mjs` in a single day, and one of
// the misses was misdiagnosed as bundle non-reproducibility precisely because
// the diff did not touch the bundle's own package).
//
// So the trigger set is DERIVED, not maintained: `gjsify build
// --inputs-manifest <path>` writes a small committed JSON next to the bundle
// listing the workspace packages whose modules the bundler's REAL module graph
// contains. The same build that writes the bundle writes the manifest, and
// `scripts/verify-committed-bundles.mjs` byte-compares both against a rebuild
// from source — the manifest cannot go stale independently of the bundle, and
// a hand edit cannot survive CI. Same pattern as `verify-package-outputs`
// deriving its path set from `workspaces` globs: an input set that cannot
// drift from reality.
//
// The oracle is the bundler's own module graph (each chunk's `moduleIds`) —
// the SAME oracle `gjs-bundle-guard.ts` reads, for the same reason: it is
// exact, post-tree-shaking, and free. NOTE the native engine
// (`@gjsify/rolldown-native`) does not forward `moduleIds` through
// `synthRolldownOutput` (it fills `[]`), so a manifest build must run the
// Node CLI entry — which every committed-bundle build script already does.
// `assertModuleGraphReported` turns that gap into a loud error instead of a
// silently empty manifest.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** The filesystem the derivation reads — injectable so specs stay pure. */
export interface InputsManifestFs {
    /** Resolve symlinks (`node_modules/@gjsify/*` → `packages/…`); may throw. */
    realpath(path: string): string;
    /** Whether `dir` directly contains a `package.json`. */
    hasPackageJson(dir: string): boolean;
    /** The `name` field of `dir`'s `package.json`, or undefined. */
    readPackageName(dir: string): string | undefined;
}

/** The slice of `@gjsify/workspace`'s `Workspace` this module needs. */
export interface InputsWorkspaceRef {
    /** Package name (`@gjsify/zlib`). */
    name: string;
    /** Absolute workspace directory. */
    location: string;
    /** Root-relative POSIX location (`packages/node/zlib`). */
    relativeLocation: string;
}

const defaultFs: InputsManifestFs = {
    realpath: (path) => realpathSync(path),
    hasPackageJson: (dir) => existsSync(resolve(dir, 'package.json')),
    readPackageName: (dir) => {
        try {
            const raw = readFileSync(resolve(dir, 'package.json'), 'utf-8');
            const name = (JSON.parse(raw) as { name?: unknown }).name;
            return typeof name === 'string' ? name : undefined;
        } catch {
            return undefined;
        }
    },
};

function safeRealpath(path: string, fs: InputsManifestFs): string {
    try {
        return fs.realpath(path);
    } catch {
        return path;
    }
}

function toPosix(path: string): string {
    return path.split(sep).join('/');
}

/** `true` when `path` equals `root` or lives underneath it. */
function isInside(path: string, root: string): boolean {
    return path === root || path.startsWith(root + sep);
}

/**
 * Nearest ancestor of `dir` (inclusive, bounded by `root`) that contains a
 * `package.json` — the module's owning package. `null` when `dir` is outside
 * `root` or no package.json is found up to and including `root`.
 */
function nearestPackageDir(dir: string, root: string, fs: InputsManifestFs): string | null {
    let current = dir;
    while (isInside(current, root)) {
        if (fs.hasPackageJson(current)) return current;
        if (current === root) break;
        current = dirname(current);
    }
    return null;
}

/**
 * The distinct root-relative directories of the WORKSPACE packages that own
 * `moduleIds`, sorted. This is the bundle's real staleness surface: editing
 * any of these packages requires rebuilding the bundle.
 *
 * Per module id:
 *   - virtual modules (`\0…`) and non-absolute ids are skipped — they have no
 *     committed source of their own;
 *   - the id is realpath'd, so a module reached through a `node_modules`
 *     workspace symlink maps back to its `packages/…` source dir;
 *   - a module still under `node_modules` after realpath is third-party UNLESS
 *     its package `name` matches a workspace (a copied — not symlinked —
 *     workspace install), in which case the workspace dir is recorded.
 *     Genuine third-party deps are excluded on purpose: their staleness signal
 *     is the lockfile, not a source dir, and the CI byte-compare remains the
 *     exhaustive net;
 *   - the workspace ROOT itself is never recorded (root files are already
 *     global triggers everywhere that matters).
 */
export function deriveInputPackages(options: {
    moduleIds: Iterable<string>;
    workspaceRoot: string;
    workspaces: readonly InputsWorkspaceRef[];
    fs?: InputsManifestFs;
}): string[] {
    const fs = options.fs ?? defaultFs;
    const root = safeRealpath(resolve(options.workspaceRoot), fs);

    const byLocation = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const ws of options.workspaces) {
        byLocation.set(safeRealpath(ws.location, fs), ws.relativeLocation);
        byName.set(ws.name, ws.relativeLocation);
    }

    const out = new Set<string>();
    for (const rawId of options.moduleIds) {
        if (!rawId || rawId.includes('\0')) continue;
        if (!isAbsolute(rawId)) continue;

        const real = safeRealpath(rawId, fs);
        if (!isInside(real, root)) continue;

        const pkgDir = nearestPackageDir(dirname(real), root, fs);
        if (!pkgDir || pkgDir === root) continue;

        const known = byLocation.get(pkgDir);
        if (known) {
            out.add(known);
            continue;
        }

        const relDir = toPosix(relative(root, pkgDir));
        if (relDir.split('/').includes('node_modules')) {
            const name = fs.readPackageName(pkgDir);
            const wsRel = name === undefined ? undefined : byName.get(name);
            if (wsRel !== undefined) out.add(wsRel);
            continue;
        }

        // A source dir inside the repo that the workspace enumeration does not
        // know (e.g. an entry outside any enumerated workspace). Still a
        // committed input — record it rather than silently dropping it.
        out.add(relDir);
    }
    return [...out].sort();
}

/**
 * Union of `moduleIds` across the emitted chunks — the derivation input.
 * Defensive field access on purpose: the native engine's
 * `synthRolldownOutput` fills `moduleIds: []`, and older shapes may omit it.
 */
export function collectChunkModuleIds(
    output: readonly { type: string; moduleIds?: readonly string[] }[],
): Set<string> {
    const ids = new Set<string>();
    for (const item of output) {
        if (item.type !== 'chunk') continue;
        for (const id of item.moduleIds ?? []) ids.add(id);
    }
    return ids;
}

/**
 * Fail LOUDLY when the engine reported no module graph at all. Writing an
 * empty manifest instead would make the pre-commit hook trigger on nothing —
 * a silently wrong declaration, which is the exact failure class this
 * mechanism exists to remove.
 */
export function assertModuleGraphReported(moduleIds: ReadonlySet<string>, manifestLabel: string): void {
    if (moduleIds.size > 0) return;
    throw new Error(
        `gjsify build --inputs-manifest: the bundler engine reported NO module graph, so ${manifestLabel} ` +
            'cannot be derived. The native `@gjsify/rolldown-native` engine does not forward `moduleIds` — ' +
            'run the build through the Node CLI entry (`node lib/index.js build …`), which uses npm rolldown.',
    );
}

/**
 * Deterministic manifest text: sorted entries, one per line (4-space JSON
 * indent), trailing newline. `.githooks/pre-commit` parses exactly this shape
 * with `sed` (no jq/node dependency in the hook), so keep the array entries
 * one-per-line.
 */
export function renderInputsManifest(packages: readonly string[]): string {
    const manifest = {
        '//': 'Workspace packages inlined into the sibling bundle — derived from the bundler module graph by `gjsify build --inputs-manifest`. DO NOT EDIT: `.githooks/pre-commit` derives its rebuild-trigger set from this file, and `scripts/verify-committed-bundles.mjs` fails CI when a rebuild from source does not reproduce it byte-identically.',
        packages: [...packages],
    };
    return `${JSON.stringify(manifest, null, 4)}\n`;
}
