// Install backend abstraction.
//
// Default: native backend (resolves packuments via @gjsify/npm-registry,
// extracts tarballs via @gjsify/tar — no Node, no npm required at runtime).
// Fallback: `npm install --no-package-lock --no-audit --no-fund --prefix <dir> <specs...>`,
// for parity with the legacy code path. Switched via
// `GJSIFY_INSTALL_BACKEND=native|npm`.
//
// `gjsify dlx` uses this seam — installing under a cache prefix, with no
// package.json update to the user's project. The native backend matches that
// workflow without ever shelling out to Node.
//
// `--no-package-lock` keeps the cache prepare dir hermetic; the cache key
// already covers reproducibility. `--no-audit --no-fund` cuts ~5s off cold runs.

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
     * Native backend only: force a fresh re-resolution that bumps every spec to
     * the newest version satisfying its range, rewriting the lockfile — the
     * pre-0.7.x behaviour. By default (this flag off) a resolve that has to run
     * (a new/changed/removed dep) PRESERVES the versions already pinned in the
     * existing lockfile and only resolves the genuinely new/changed deps, the
     * way `npm install` / `yarn install` / `pnpm install` do. Set this to
     * intentionally pick up in-range updates (≈ `yarn install
     * --mode=update-lockfile` / `npm update` / `pnpm update`).
     */
    refreshLockfile?: boolean;
    /**
     * Per-package version overrides — `<name> → <range>`. Applied to every
     * edge during dependency resolution, irrespective of the requester.
     * Mirrors npm's top-level `overrides` field and yarn's `resolutions`
     * (the simple, name-only flavour; pattern keys like `typescript@*` are
     * normalised to bare `typescript` by the caller before passing in).
     *
     * Lets a workspace root pin a transitive dep version when the
     * deduplicated tree would otherwise pick a different one — e.g. for
     * forcing `typescript@~5.9` across every `typescript@*` devDep.
     */
    overrides?: Record<string, string>;
    /**
     * Native backend only: skip transitive dependency resolution and only
     * install the top-level requested packages. Use this when the packages
     * are self-contained bundles whose declared `dependencies` are either
     * bundled into the artifact (e.g. `@gjsify/cli`'s GJS bundle) or
     * workspace-only packages not published to npm separately. Setting this
     * avoids spurious packument fetches for workspace-internal packages.
     *
     * Has no effect when `frozen: true` (the lockfile already contains the
     * full resolved tree and is used verbatim) or when `GJSIFY_INSTALL_BACKEND=npm`
     * (npm does its own resolution and does not consult this flag).
     */
    skipDeps?: boolean;
    /**
     * Native backend only: overall wall-clock budget for the install. When
     * fired, in-flight packument + tarball fetches are aborted via their
     * AbortSignals (the resolver/extractor surface the abort as a normal
     * AbortError), so the user gets a clean failure instead of a silent
     * hang. Zero or undefined disables the overall budget — per-request
     * timeouts in @gjsify/npm-registry still apply.
     */
    signal?: AbortSignal;
    /**
     * Native backend only: progress reporter for resolve / download / extract /
     * link phases. The CLI auto-creates a TTY-aware reporter by default; pass
     * a custom reporter (or the `NOOP` from `makeProgressReporter({enabled:false})`)
     * to override.
     */
    progress?: ProgressReporter;
    /**
     * Native backend only: the names of the monorepo's own workspace packages.
     * A package whose name is in this set is materialised as a symlink to its
     * workspace source by `workspaceInstall`, never fetched from the registry —
     * even when the lockfile or a transitive edge references a same-named
     * published version (e.g. a `types-dev/<lib>` workspace that ALSO exists on
     * npm). The native backend drops such names from `resolveDeps` AND from the
     * fetch/extract set, so `extractOne` never tries to `rm` + overwrite a
     * workspace source symlink (its data-loss guard would otherwise abort the
     * whole install). The `npm` backend ignores this — npm resolves workspaces
     * itself.
     */
    workspaceNames?: Set<string>;
    /**
     * Native backend only: requester labels for top-level specs, keyed by the
     * exact `"<name>@<range>"` spec string. `workspaceInstall` records which
     * workspace(s) declared each aggregated external spec so the resolver's
     * version-conflict warning can name BOTH sides of a conflict ("^1 requested
     * by @scope/a, ^2 requested by @scope/b"). Optional — flows without
     * per-requester attribution (single-project installs, dlx) omit it and the
     * warning falls back to the bare ranges.
     */
    specOrigins?: Map<string, string[]>;
}

const DEFAULT_BACKEND = process.env.GJSIFY_INSTALL_BACKEND ?? 'native';

export interface InstallResult {
    /** Top-level packages that were requested, with the version each
     *  resolved to. Empty for the npm backend (parsing npm's stdout would
     *  be unreliable; callers that need this should set
     *  GJSIFY_INSTALL_BACKEND=native). */
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

    // Seed an empty package.json so npm doesn't walk up from prefix and pick
    // up the user's project metadata. Cosmetic name/version only.
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

    // Through `spawnToCompletion` so `npm` is resolved the way every other
    // spawn in the CLI resolves it. A bare `spawn('npm', …)` is ENOENT on
    // Windows — `CreateProcess` appends only `.exe` and npm ships a `.cmd`
    // shim (see utils/win32-command.ts). That made this backend unusable
    // there, and the ENOENT hint below actively misdiagnosed it: npm IS on
    // PATH on such a host, and it told the user to select the backend that
    // was already the default while calling it unsupported.
    //
    // `completion: 'return'` — `installPackages` resolves a promise to its
    // caller instead of exiting, so under GJS this must not leave a main loop
    // armed. (Moot in practice: this backend needs npm, hence Node.)
    const { code } = await spawnToCompletion('npm', args, {
        completion: 'return',
        notFound: (err) =>
            new Error(
                `npm not found on PATH — install Node.js, or unset GJSIFY_INSTALL_BACKEND to use the default native backend (${err.message})`,
            ),
    });
    if (code !== 0) throw new Error(`npm install exited with code ${code}`);
}
