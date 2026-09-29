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
// Deciding freshness stays cheap: the manifest is written once per build and
// read as `stat` calls.
//
// `package-inputs.ts` is not replaced by this. Its walk answers "what MAY this
// package's build read", which covers a file the current build does not import
// yet; this answers "what DID this build read", which reaches outside the
// package. The union is the honest input set, and both halves must exist.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RolldownPluginOption } from 'rolldown';

/** Bumped when the shape changes; a manifest of any other version is ignored. */
export const BUNDLE_INPUTS_VERSION = 1;

interface BundleInputsManifest {
    version: number;
    /** Absolute paths, sorted. */
    inputs: string[];
}

/** The manifest that belongs to `outfile`. */
export function bundleInputsPath(outfile: string): string {
    return `${outfile}.inputs.json`;
}

export interface BundleInputsRecorder {
    /** Pass to the bundler as a plugin; it observes, it never transforms. */
    plugin: RolldownPluginOption;
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
 * A plugin that records every module the build transforms, plus the writer for
 * the manifest.
 *
 * `transform` rather than a graph API (`getModuleIds`/`getModuleInfo`) because
 * it is the one hook both engines run and the native bridge translates
 * (`bundler-pick.ts` picks it verbatim). Every module that reaches the
 * transform stage was LOADED from disk, so the observed set is what the build
 * read — the modules it then tree-shook away are still inputs of the next
 * build, which is the direction that errs safely.
 */
export function createBundleInputsRecorder(outfile: string): BundleInputsRecorder {
    const seen = new Set<string>();
    const plugin: RolldownPluginOption = {
        name: 'gjsify:bundle-inputs',
        transform(_code: string, id: string): undefined {
            // `\0` is the bundler's marker for a virtual module: no file, no mtime.
            if (typeof id === 'string' && id !== '' && !id.startsWith('\0')) seen.add(id);
            return undefined;
        },
    };

    const inputs = (): string[] =>
        [...seen]
            .filter((abs) => {
                try {
                    return statSync(abs).isFile();
                } catch {
                    return false;
                }
            })
            .sort();

    return {
        plugin,
        inputs,
        write(): void {
            const path = bundleInputsPath(outfile);
            const manifest: BundleInputsManifest = { version: BUNDLE_INPUTS_VERSION, inputs: inputs() };
            try {
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
            } catch (err) {
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
export function readBundleInputs(outfile: string): string[] | null {
    let parsed: Partial<BundleInputsManifest>;
    try {
        parsed = JSON.parse(readFileSync(bundleInputsPath(outfile), 'utf-8')) as Partial<BundleInputsManifest>;
    } catch {
        return null;
    }
    if (parsed?.version !== BUNDLE_INPUTS_VERSION || !Array.isArray(parsed.inputs)) return null;
    return parsed.inputs.filter((abs): abs is string => typeof abs === 'string');
}

/**
 * Newest mtime (ms) among recorded inputs, or 0 for an empty set.
 *
 * A recorded input that has since VANISHED is skipped, not treated as a
 * change: the build's own scratch does not outlive it — the globals-inject stub
 * `--app gjs` writes is a temp file — and treating it as a change would rebuild
 * on every run, forever. A file that no longer exists cannot have been edited,
 * and a re-created one arrives with a fresh mtime the package walk also sees.
 */
export function newestBundleInputMtimeMs(inputs: readonly string[]): number {
    let newest = 0;
    for (const abs of inputs) {
        try {
            const { mtimeMs } = statSync(abs);
            if (mtimeMs > newest) newest = mtimeMs;
        } catch {
            continue;
        }
    }
    return newest;
}
