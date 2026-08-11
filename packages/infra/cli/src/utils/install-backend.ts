// Install backend abstraction.
//
// Default: native backend (resolves packuments via @gjsify/npm-registry, extracts
// tarballs via @gjsify/tar — no Node, no npm required at runtime). Fallback:
// `npm install`. Switched via `GJSIFY_INSTALL_BACKEND=native|npm`.
//
// `gjsify dlx` uses this seam — installing under a cache prefix, with no
// package.json update to the user's project.
//
// On the npm path, `--no-package-lock` keeps the cache prepare dir hermetic (the
// cache key already covers reproducibility) and `--no-audit --no-fund` cuts ~5s
// off cold runs.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { spawnToCompletion } from './spawn.js';
import type { ProgressReporter } from './install-progress.js';

export type { ProgressEvent, ProgressPhase, ProgressReporter } from './install-progress.js';
export { makeProgressReporter } from './install-progress.js';

export interface InstallOptions {
    /** Directory to install into (npm `--prefix`). Created by caller. */
    prefix: string;
    /** npm-resolvable specs: `name`, `name@version`, `git+https://...`, tarball URL, ... */
    specs: string[];
    /** Verbose logging passes through `--loglevel verbose`. */
    verbose?: boolean;
    /** Optional registry override (writes a temp `.npmrc` in prefix). */
    registry?: string;
    /**
     * Native backend only: write `<prefix>/gjsify-lock.json` after a successful
     * resolve. When the file exists on next call AND `frozen: true`, the
     * resolver is skipped and downloads use the pinned tarball URL + integrity.
     */
    lockfile?: boolean;
    /** Use `<prefix>/gjsify-lock.json` as the source of truth — fail if missing. */
    frozen?: boolean;
    /**
     * Native backend only: force a fresh re-resolution that bumps every spec to the
     * newest version satisfying its range, rewriting the lockfile. Off, a resolve
     * that has to run PRESERVES the versions already pinned and only resolves the
     * genuinely new/changed deps, as `npm`/`yarn`/`pnpm install` do. Set it to
     * intentionally pick up in-range updates (≈ `npm update`).
     */
    refreshLockfile?: boolean;
    /**
     * Per-package version overrides — `<name> → <range>`, applied to every edge
     * during resolution irrespective of the requester. Mirrors npm's top-level
     * `overrides` and yarn's `resolutions` (name-only flavour; pattern keys like
     * `typescript@*` are normalised to bare `typescript` by the caller). Lets a
     * workspace root pin a transitive dep the deduplicated tree would otherwise
     * resolve differently.
     */
    overrides?: Record<string, string>;
    /**
     * Native backend only: install only the top-level requested packages, skipping
     * transitive resolution. For self-contained bundles whose declared
     * `dependencies` are either bundled into the artifact (e.g. `@gjsify/cli`'s GJS
     * bundle) or workspace-only and never published, where resolution would only
     * produce spurious packument fetches.
     *
     * No effect under `frozen: true` (the lockfile holds the full resolved tree and
     * is used verbatim) or `GJSIFY_INSTALL_BACKEND=npm` (npm resolves for itself).
     */
    skipDeps?: boolean;
    /**
     * Native backend only: overall wall-clock budget. On firing, in-flight packument
     * + tarball fetches abort via their AbortSignals (surfaced as a normal
     * AbortError), so a stall fails cleanly instead of hanging. Zero/undefined
     * disables the overall budget; per-request timeouts in @gjsify/npm-registry
     * still apply.
     */
    signal?: AbortSignal;
    /**
     * Native backend only: progress reporter for the resolve / download / extract /
     * link phases. Defaults to a TTY-aware reporter; pass a custom one (or the
     * `NOOP` from `makeProgressReporter({enabled:false})`) to override.
     */
    progress?: ProgressReporter;
    /**
     * Native backend only: the monorepo's own workspace package names. A name in
     * this set is materialised as a symlink to its workspace source by
     * `workspaceInstall` and never fetched, even when the lockfile or a transitive
     * edge references a same-named PUBLISHED version (e.g. a `types-dev/<lib>`
     * workspace that also exists on npm). Such names are dropped from `resolveDeps`
     * AND from the fetch/extract set, so `extractOne` never tries to `rm` +
     * overwrite a workspace source symlink — its data-loss guard would abort the
     * whole install. The `npm` backend ignores this and resolves workspaces itself.
     */
    workspaceNames?: Set<string>;
    /**
     * Native backend only: requester labels for top-level specs, keyed by the exact
     * `"<name>@<range>"` string, so the resolver's version-conflict warning can name
     * BOTH sides ("^1 requested by @scope/a, ^2 requested by @scope/b"). Optional —
     * flows without per-requester attribution (single-project installs, dlx) omit it
     * and the warning falls back to bare ranges.
     */
    specOrigins?: Map<string, string[]>;
}

const DEFAULT_BACKEND = process.env.GJSIFY_INSTALL_BACKEND ?? 'native';

export interface InstallResult {
    /** Requested top-level packages with the version each resolved to. Empty for
     *  the npm backend — parsing npm's stdout would be unreliable, so a caller that
     *  needs this must use the native backend. */
    installed: Array<{ name: string; version: string }>;
}

export async function installPackages(opts: InstallOptions): Promise<InstallResult> {
    if (DEFAULT_BACKEND === 'npm') {
        await installViaNpm(opts);
        return { installed: [] };
    }
    const { installPackagesNative } = await import('./install-backend-native.js');
    const installed = await installPackagesNative(opts);
    return { installed };
}

async function installViaNpm({ prefix, specs, verbose, registry }: InstallOptions): Promise<void> {
    if (specs.length === 0) {
        throw new Error('installPackages: empty specs list');
    }

    // Seed an empty package.json so npm doesn't walk up from prefix and pick up the
    // user's project metadata. Cosmetic name/version only.
    writeFileSync(
        join(prefix, 'package.json'),
        JSON.stringify({ name: 'gjsify-dlx-cache', version: '0.0.0', private: true }, null, 2),
    );

    if (registry) {
        writeFileSync(join(prefix, '.npmrc'), `registry=${registry}\n`);
    }

    const args = [
        'install',
        '--no-package-lock',
        '--no-audit',
        '--no-fund',
        '--prefix',
        prefix,
        ...(verbose ? ['--loglevel', 'verbose'] : ['--loglevel', 'warn']),
        ...specs,
    ];

    // Through `spawnToCompletion` because a bare `spawn('npm', …)` is ENOENT on
    // Windows — `CreateProcess` appends only `.exe` and npm ships a `.cmd` shim
    // (see utils/win32-command.ts). That made this backend unusable there while the
    // ENOENT hint below misdiagnosed it as npm being absent from PATH.
    //
    // `completion: 'return'` — this resolves a promise to its caller instead of
    // exiting, so under GJS it must not leave a main loop armed. (Moot in practice:
    // this backend needs npm, hence Node.)
    const { code } = await spawnToCompletion('npm', args, {
        completion: 'return',
        notFound: (err) =>
            new Error(
                `npm not found on PATH — install Node.js, or unset GJSIFY_INSTALL_BACKEND to use the default native backend (${err.message})`,
            ),
    });
    if (code !== 0) throw new Error(`npm install exited with code ${code}`);
}
