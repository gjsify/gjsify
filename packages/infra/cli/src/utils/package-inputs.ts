// SPDX-License-Identifier: MIT
// ONE answer to "what are this package's build inputs" — read by the build
// cache (`build-cache.ts`) and by `gjsify test`'s freshness check. Add a
// fourth READER, never a fourth answer.
//
// It was answered three times, each an ALLOW-list over a guessed layout, and
// each is wrong for a package that already exists here: `src/**` misses
// `@gjsify/adwaita-fonts` (no `src/` at all) and the tracked source in
// `resolve-npm/lib` + `manifest-conformance/lib` (#821); `dirname(<test
// entry>)` missed `src/**` entirely, so `gjsify test` reran the PREVIOUS
// bundle and reported on it (#1651).
//
// So: a DENY-list. An input is any file in the package that is not a
// dependency, not tool/VCS state, and not something the package produces —
// which covers a layout nobody anticipated by construction. **In doubt, a
// file is an input**: a false input costs one rebuild, a false non-input
// costs a green test run about code that is not in the artifact.
//
// The incident, the measurements behind every number below, and the copy
// still open (CI's `actions/cache` glob): docs/build-artifacts.md.

import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hasWildcard, segmentToRegExp } from './clear-targets.js';
import { gjsifyCommandArgv } from './simple-command.js';

/** One file the build may read. `link` is set for a symlink (never followed). */
export interface PackageInputFile {
    /** Package-relative path, forward slashes. */
    rel: string;
    abs: string;
    /** Raw symlink target, when this entry is a symlink. */
    link?: string;
}

/**
 * Where the toolchain writes when the package does not say otherwise.
 *
 * Used for a package with NO `clear` script (a consumer project we know
 * nothing about), and unioned onto the declared set for one that has one:
 * `gjsify test` writes `dist/test.{gjs,node}.mjs` into packages whose `clear`
 * line predates that command and names only `lib`, and an output left in the
 * input set makes every run see a newer file than the artifact it is judging.
 */
export const CONVENTIONAL_OUTPUT_DIRS = ['lib', 'dist', 'dist-templates'] as const;

/**
 * Files whose change means the installed dependency tree may have moved.
 *
 * `node_modules` is deliberately not walked — too large to stat per run, and
 * the reason the old `gjsify test` walk skipped it too — so the lockfile is
 * the cheap proxy for it. That substitution is not new: `actions/build.ts`
 * has made it since the plugin bundle cache existed, and this is the list it
 * uses, kept in one place so a fifth package manager is added once.
 */
export const DEP_CHANGE_LOCKFILES = ['gjsify-lock.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'] as const;

export interface PackageBuildInputOptions {
    /** Parsed `package.json`, when the caller already has it. */
    manifest?: { scripts?: Record<string, string> } | null;
    /** Extra package-relative paths to treat as output (e.g. a `--outdir`). */
    extraOutputs?: readonly string[];
}

/**
 * The paths this package PRODUCES, package-relative — DERIVED from the
 * package's own `clear` script rather than re-declared, the same move
 * `utils/dev-plan.ts` makes for build flags.
 *
 * Three cases, and the middle one is the one that matters:
 *   - `clear` is `gjsify clear a b c` → `a b c` plus the conventional dirs.
 *     127 of 212 workspace packages, naming `tmp`, `build`, `*.tsbuildinfo`,
 *     `test.gjs.mjs`, and in two of them `src/*.generated.ts` — a generated
 *     file INSIDE `src/` that the old walk hashed as an input.
 *   - `clear` is anything else (`echo 'nothing to do'`, 74 packages) →
 *     NOTHING. The package states it has nothing to delete, so its `lib/` is
 *     source, not output. Exactly two of the 74 have a conventional output dir
 *     on disk, `resolve-npm/lib` and `manifest-conformance/lib`, and in both
 *     it is tracked source — so the script is a trustworthy oracle both ways.
 *   - no `clear` script (11 packages, and any consumer project) → the
 *     conventional dirs, the only guess available.
 */
export function packageOutputPaths(manifest: { scripts?: Record<string, string> } | null): string[] {
    const clear = manifest?.scripts?.clear;
    if (clear === undefined) return [...CONVENTIONAL_OUTPUT_DIRS];
    // `allowGlobs`: five packages here clear `*.tsbuildinfo`, and the pattern
    // is what we want — this reads the targets, it does not run them.
    const argv = gjsifyCommandArgv(clear, { allowGlobs: true });
    if (argv === null || argv[0] !== 'clear') return [];
    const targets = argv.slice(1).filter((token) => !token.startsWith('-'));
    return [...targets, ...CONVENTIONAL_OUTPUT_DIRS];
}

/** `package.json` at `pkgRoot`, or `null` when absent/unreadable. */
export function readPackageManifest(pkgRoot: string): { scripts?: Record<string, string> } | null {
    try {
        return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> };
    } catch {
        return null;
    }
}

/**
 * Match a package-relative path against output targets — the target itself and
 * everything under it.
 *
 * Wildcards are honoured in the LAST segment only, which is `gjsify clear`'s
 * own rule (`utils/clear-targets.ts`), so the set matched here is the set that
 * command would delete.
 */
function makeOutputMatcher(targets: readonly string[]): (rel: string) => boolean {
    const compiled = targets
        .map((target) =>
            target
                .split(/[\\/]+/)
                .filter((segment) => segment !== '' && segment !== '.')
                .map((segment) => (hasWildcard(segment) ? segmentToRegExp(segment) : segment)),
        )
        .filter((segments) => segments.length > 0);
    return (rel: string): boolean => {
        const parts = rel.split('/');
        for (const target of compiled) {
            if (target.length > parts.length) continue;
            let matched = true;
            for (let i = 0; i < target.length; i++) {
                const segment = target[i]!;
                const got = parts[i]!;
                if (typeof segment === 'string' ? segment !== got : !segment.test(got)) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    };
}

function walk(dir: string, prefix: string, isOutput: (rel: string) => boolean, out: PackageInputFile[]): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    entries.sort();
    for (const entry of entries) {
        // `node_modules` is the dependency tree, not this package's source, and
        // a dot-entry is VCS/editor/cache state — `.git` alone would make the
        // walk unbounded. Measured across every package here: no file under any
        // `src/` is dot-prefixed, so nothing the old hash covered is lost.
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const rel = prefix === '' ? entry : `${prefix}/${entry}`;
        if (isOutput(rel)) continue;
        const abs = join(dir, entry);
        let st: ReturnType<typeof lstatSync>;
        try {
            st = lstatSync(abs);
        } catch {
            continue;
        }
        if (st.isSymbolicLink()) {
            // Not followed: a directory symlink can loop, and a workspace
            // `node_modules` link would drag the whole tree in. The target
            // string participates instead; file links are read by content where
            // the consumer asks for content.
            out.push({ rel, abs, link: readLinkTarget(abs) });
        } else if (st.isDirectory()) {
            walk(abs, rel, isOutput, out);
        } else if (st.isFile()) {
            out.push({ rel, abs });
        }
    }
}

function readLinkTarget(abs: string): string {
    try {
        return readlinkSync(abs);
    } catch {
        // Dropped between lstat and readlink. An empty target still differs
        // from the file being absent, which is all the hash needs.
        return '';
    }
}

/**
 * Every file the build of the package at `pkgRoot` may read, sorted by
 * package-relative path.
 *
 * Enumeration only — the caller decides whether to hash contents (build cache)
 * or take mtimes (`gjsify test` freshness). That split is deliberate: the two
 * must agree on the SET, and they legitimately differ on what they do with it.
 */
export function packageBuildInputs(pkgRoot: string, options: PackageBuildInputOptions = {}): PackageInputFile[] {
    const manifest = options.manifest !== undefined ? options.manifest : readPackageManifest(pkgRoot);
    const outputs = [...packageOutputPaths(manifest), ...(options.extraOutputs ?? [])];
    const files: PackageInputFile[] = [];
    walk(pkgRoot, '', makeOutputMatcher(outputs), files);
    return files;
}

/** Newest mtime (ms) among `files`, or 0 for an empty set. */
export function newestInputMtimeMs(files: readonly PackageInputFile[]): number {
    let newest = 0;
    for (const file of files) {
        try {
            const { mtimeMs } = statSync(file.abs);
            if (mtimeMs > newest) newest = mtimeMs;
        } catch {
            // Vanished mid-walk. Treat as a change: an input we cannot read is
            // not evidence that the artifact is current.
            return Number.POSITIVE_INFINITY;
        }
    }
    return newest;
}

/**
 * Newest lockfile mtime (ms) at or above `startDir`, or 0 when there is none.
 *
 * Walks up because in a monorepo the lockfile that governs a package's
 * `node_modules` sits at the workspace root, several levels away — and a
 * dependency bump that rewrites it is precisely the case #1651 was found in
 * (postbote, gjsify 0.33.0 → 0.49.0, not one source file touched).
 */
export function newestDepSignalMtimeMs(startDir: string): number {
    let newest = 0;
    let dir = startDir;
    for (;;) {
        for (const name of DEP_CHANGE_LOCKFILES) {
            const candidate = join(dir, name);
            if (!existsSync(candidate)) continue;
            try {
                const { mtimeMs } = statSync(candidate);
                if (mtimeMs > newest) newest = mtimeMs;
            } catch {
                /* raced away — the other lockfiles still answer */
            }
        }
        const parent = dirname(dir);
        if (parent === dir) return newest;
        dir = parent;
    }
}
