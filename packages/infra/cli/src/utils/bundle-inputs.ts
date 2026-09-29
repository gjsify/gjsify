// SPDX-License-Identifier: MIT
// The SECOND half of "what are this bundle's build inputs" — what the BUNDLER
// read, recorded at build time beside the bundle it produced.
//
// `package-inputs.ts` answers the other half by walking the package, and that
// walk cannot see outside the package. A consumer's test bundle routinely reads
// outside it: a workspace package reached through `node_modules/<name>` — a
// SYMLINK into a sibling directory — is a file the build read and the walk
// never enumerates. An edit there left `gjsify test` judging a fresh bundle and
// rerunning it: a stale GREEN, the worst kind of wrong, and the only remedy a
// consumer had was `rm -rf dist`.
//
// The set is recorded from the bundler's own module graph rather than guessed
// from a directory list: a bare specifier's resolution is known to the bundler
// and to nobody else, and a list of "likely dirs" is wrong for every layout
// nobody anticipated — the same failure `package-inputs.ts` documents twice.
//
// TWO halves, because the bundler is not the only reader: a `transform`
// observer sees every MODULE, and the engine's watch list carries what a plugin
// read and declared itself (a stylesheet's `@import` chain is read by
// `gjsify-css-as-string`, not by the bundler, so no graph names it). Neither
// engine reports both, so the recorder takes the union. Deciding freshness
// stays cheap: the manifest is written once per build and read as `stat` calls.
//
// `package-inputs.ts` is not replaced by this. Its walk answers "what MAY this
// package's build read", which covers a file the current build does not import
// yet; this answers "what DID this build read", which reaches outside the
// package. The union is the honest input set, and both halves must exist.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { RolldownPluginOption } from 'rolldown';

/**
 * Bumped when the shape changes; a manifest of any other version is ignored.
 *
 * v2 adds `watchList`. A v1 manifest says nothing about whether the engine that
 * wrote it could report a watch list at all, and the safe reading of "unknown"
 * is "do not trust it": see {@link readBundleInputs}.
 */
export const BUNDLE_INPUTS_VERSION = 2;

interface BundleInputsManifest {
    version: number;
    /** Absolute paths, sorted. */
    inputs: string[];
    /**
     * `false` when the engine that built this bundle could report NO watch list
     * — so a file only a plugin read (a stylesheet's `@import` chain, an inlined
     * `readFileSync`) is not in `inputs` and no amount of stat-ing can find it.
     */
    watchList: boolean;
}

/** What a manifest says, once parsed. */
export interface BundleInputs {
    inputs: string[];
    /** `false` = this bundle's build could not see plugin-read inputs at all. */
    watchList: boolean;
}

/** The manifest that belongs to `outfile`. */
export function bundleInputsPath(outfile: string): string {
    return `${outfile}.inputs.json`;
}

export interface BundleInputsRecorder {
    /** Pass to the bundler as a plugin; it observes, it never transforms. */
    plugin: RolldownPluginOption;
    /**
     * The build's own watch list — what the engine reports, which is its module
     * set PLUS everything a plugin declared with `this.addWatchFile`. That is
     * the only account of a file the bundler never turned into a module: the
     * CSS plugin follows a stylesheet's `@import` chain with its own `readFile`,
     * and no graph mentions the imported file.
     */
    addWatchFiles(watch: { files: readonly string[]; reportedByEngine: boolean }): void;
    /** The recorded inputs so far: sorted, deduplicated, existing files only. */
    inputs(): string[];
    /**
     * Persist the manifest beside `outfile`, so the NEXT freshness check can
     * judge against the same set. Never throws: a manifest that cannot be
     * written must not fail a test run — it degrades the check to the package
     * walk, and says so.
     */
    write(): void;
}

/**
 * A module id as a path, or `null` when it names no file we can stat.
 *
 * A query or a hash is PART OF THE ID, not of the path: `@scope/pkg/x.css?raw`
 * and `main-window.blp?shared-tree` (the blueprint plugin's shared-tree exit)
 * both stat as ENOENT, and dropping the id silently would drop the file with
 * it. `\0` is the bundler's virtual-module marker — no file, ever.
 */
function idToPath(id: string): string | null {
    if (id === '' || id.startsWith('\0')) return null;
    const cut = id.search(/[?#]/);
    if (cut === -1) return id;
    const stripped = id.slice(0, cut);
    // The fallback is not a nicety: `#` is LEGAL in a Linux filename, and
    // `a#b.blp` is that file's whole name. Stripping turned it into `a`, which
    // does not exist, and the input was dropped. So the unstripped id gets its
    // turn — and when neither is a file, `inputs()` drops it as before.
    return isFile(stripped) ? stripped : id;
}

function isFile(abs: string): boolean {
    try {
        return statSync(abs).isFile();
    } catch {
        return false;
    }
}

/**
 * Files the TOOLCHAIN writes and deletes between builds, which therefore must
 * never enter the input set.
 *
 * Not a filter on staleness but on membership: a vanished recorded input forces
 * a rebuild (see {@link newestBundleInputMtimeMs}), so recording the
 * globals-inject stub — `node_modules/.cache/gjsify/auto-globals-<hash>.mjs`,
 * rewritten per build and DELETED when its config changes — would rebuild every
 * run, forever. The same directory holds the cached GJS plugin bundles, which
 * carry their own freshness rule (`bundleFileForGjsCached`).
 *
 * **Not a `tmpdir()` test**, which is the obvious wrong answer and the one this
 * started as: the stub is written into the project's own cache directory
 * (`utils/scan-globals.ts`), never to a temp dir, while a PROJECT under
 * `/tmp` is a project — a CI job, a container, this suite's own fixtures. A
 * freshness check that goes blind in those trees is the defect being fixed,
 * reached from the other side.
 */
function isToolchainScratch(abs: string): boolean {
    return abs.includes(`${sep}node_modules${sep}.cache${sep}`);
}

/**
 * The resolution files of the package a recorded input belongs to: the nearest
 * `package.json` above it, and the `tsconfig.json` beside it when there is one.
 *
 * Neither is ever a module. A workspace package reached through a symlink
 * contributes its files, but a `package.json#exports` edit — which moves what
 * every bare specifier in the app resolves to — or a `tsconfig.json` that turns
 * on a `paths` mapping changes the output with no file of its own in the graph.
 * Per package, deduplicated, so the walk is a handful of stats however many
 * modules that package contributed.
 */
function resolutionFilesFor(abs: string): string[] {
    const found: string[] = [];
    for (let dir = dirname(abs); ; dir = dirname(dir)) {
        const manifest = join(dir, 'package.json');
        if (existsSync(manifest)) {
            found.push(manifest);
            const tsconfig = join(dir, 'tsconfig.json');
            if (existsSync(tsconfig)) found.push(tsconfig);
            return found;
        }
        const parent = dirname(dir);
        if (parent === dir) return found;
    }
}

/**
 * A plugin that records every module the build transforms, plus the writer for
 * the manifest.
 *
 * `transform` rather than a graph API (`getModuleIds`/`getModuleInfo`) because
 * it is the one hook both engines run and the native bridge translates
 * (`bundler-pick.ts` picks it verbatim). Every module that reaches the
 * transform stage was LOADED from disk, so the observed set is what the build
 * read — the modules it then tree-shook away are still inputs of the next
 * build, which is the direction that errs safely.
 *
 * The observation is KEPT alongside {@link BundleInputsRecorder.addWatchFiles}
 * rather than replaced by it, and neither engine is the reason: the native
 * engine has no watch list to hand over (`BundleResult` carries warnings and
 * output only, and its JS context had no `addWatchFile` at all until
 * `rolldown-native` grew one), so on GJS the observed set is the only account
 * of the modules; on npm the watch list is a superset of it. Union: the cost of
 * a redundant path is a `stat`, the cost of a missing one is a stale green.
 */
export function createBundleInputsRecorder(outfile: string): BundleInputsRecorder {
    const seen = new Set<string>();
    // Sticky, and pessimistic: ONE pass without a watch list is enough to know
    // the build cannot see a plugin-read input, and the artifact must not be
    // judged fresh on the strength of the passes that could.
    let watchList = true;
    const record = (raw: string): void => {
        const abs = idToPath(raw);
        if (abs !== null) seen.add(abs);
    };
    const plugin: RolldownPluginOption = {
        name: 'gjsify:bundle-inputs',
        transform(_code: string, id: string): undefined {
            record(id);
            return undefined;
        },
    };

    const inputs = (): string[] => {
        const out: string[] = [];
        const packages = new Set<string>();
        for (const abs of seen) {
            let isFile: boolean;
            try {
                isFile = statSync(abs).isFile();
            } catch {
                continue;
            }
            if (!isFile || isToolchainScratch(abs)) continue;
            out.push(abs);
            // `resolutionFilesFor` walks to the package root; one call per
            // DIRECTORY keeps a 1000-module bundle from walking 1000 times.
            const dir = dirname(abs);
            if (packages.has(dir)) continue;
            packages.add(dir);
            for (const meta of resolutionFilesFor(abs)) out.push(meta);
        }
        return [...new Set(out)].sort();
    };

    return {
        plugin,
        addWatchFiles(watch: { files: readonly string[]; reportedByEngine: boolean }): void {
            if (!watch.reportedByEngine) watchList = false;
            for (const id of watch.files) record(id);
        },
        inputs,
        write(): void {
            const path = bundleInputsPath(outfile);
            const manifest: BundleInputsManifest = { version: BUNDLE_INPUTS_VERSION, inputs: inputs(), watchList };
            const tmp = `${path}.tmp`;
            try {
                mkdirSync(dirname(path), { recursive: true });
                // Rename, not write: a manifest is read by the NEXT process, and
                // a half-written one is a parse error there — which reads as "no
                // manifest" and silently degrades the check to the package walk.
                writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
                renameSync(tmp, path);
            } catch (err) {
                try {
                    rmSync(tmp, { force: true });
                } catch {
                    // Nothing left to clean up — the write never got that far.
                }
                console.warn(
                    `[gjsify test] could not record the build inputs beside ${path} (${(err as Error).message}) — ` +
                        'the next run judges freshness by the package walk alone, which cannot see outside this package.',
                );
            }
        },
    };
}

/**
 * The inputs recorded for `outfile` by the build that wrote it, or `null` when
 * there is none to trust — never written, unreadable, or written by another
 * version of this shape. `null` is the fallback the caller must handle, not an
 * error: a bundle built by an older CLI, or copied in from elsewhere, has no
 * manifest and is judged by the package walk alone.
 */
export function readBundleInputs(outfile: string): BundleInputs | null {
    let parsed: Partial<BundleInputsManifest>;
    try {
        parsed = JSON.parse(readFileSync(bundleInputsPath(outfile), 'utf-8')) as Partial<BundleInputsManifest>;
    } catch {
        return null;
    }
    if (parsed?.version !== BUNDLE_INPUTS_VERSION || !Array.isArray(parsed.inputs)) return null;
    return {
        inputs: parsed.inputs.filter((abs): abs is string => typeof abs === 'string'),
        // v2 only, so a missing flag cannot be v2 — but the pessimistic reading
        // is kept anyway: a manifest that does not vouch for its engine's watch
        // list is not one to judge freshness on.
        watchList: parsed.watchList === true,
    };
}

/**
 * Newest mtime (ms) among recorded inputs, or 0 for an empty set.
 *
 * A recorded input that has since VANISHED counts as CHANGED, exactly as the
 * package walk counts one that vanished mid-walk: an input we cannot read is
 * not evidence that the artifact is current. A workspace-package source deleted
 * while the bundle still imports it is precisely that case, and skipping it
 * would rerun a bundle built from a file that no longer exists.
 *
 * Safe only because the toolchain's own scratch is never RECORDED
 * ({@link isToolchainScratch}): the globals-inject stub and the cached plugin
 * bundles are written and deleted between builds, and treating their absence as
 * a change would rebuild on every run, forever.
 */
export function newestBundleInputMtimeMs(inputs: readonly string[]): number {
    let newest = 0;
    for (const abs of inputs) {
        try {
            const { mtimeMs } = statSync(abs);
            if (mtimeMs > newest) newest = mtimeMs;
        } catch {
            return Number.POSITIVE_INFINITY;
        }
    }
    return newest;
}
