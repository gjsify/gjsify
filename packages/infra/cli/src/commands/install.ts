// `gjsify install [pkg...]` — install packages with gjsify-aware post-checks.
//
// Modes:
//   gjsify install                    → project install (native, reads pkg.json)
//   gjsify install <pkg> [<pkg>...]   → add package(s) to project (native)
//   gjsify install -g <pkg> [...]     → user-global install (XDG, GJS-runnable bin)
//
// All three modes route through `@gjsify/{semver,npm-registry,tar}` via
// `installPackagesNative` — no Node/npm required at runtime. Pass
// `--backend=npm` (or set the legacy `GJSIFY_INSTALL_BACKEND=npm` env var)
// to opt back into the `npm install` subprocess flow — useful as an
// escape hatch for projects that hit a missing native-backend feature
// (Yarn PnP repos, lifecycle scripts, npm's `overrides` quirks).
//
// Workspace install (`gjsify install` in a monorepo root with a
// `"workspaces"` field) hoists every workspace's externals into the root
// `node_modules/` and symlinks `workspace:*` / `workspace:^` / `workspace:~`
// refs to their target source. Conflicting version ranges of the same
// external dep from different workspaces still share ONE hoisted root copy
// (a real per-workspace dedup pass is Phase D.8, see status/open-todos.md), but since
// ADR 0001 step 3 the resolver surfaces every such conflict loudly —
// `[gjsify] warning: version conflict for <pkg> …` names both ranges, the
// workspaces that requested them, and the version that actually won.
//
// Concurrency (ADR 0001 step 2): every mutation of an install prefix —
// project node_modules/, gjsify-lock.json, the user-global prefix — runs
// under a per-prefix cross-process lock (utils/install-lock.ts). Installs
// into different prefixes stay parallel; the shared XDG tarball/packument
// caches need no lock because their writes are atomic tmp+rename.

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { forceExit } from '../utils/force-exit.js';
import { discoverWorkspaces } from '@gjsify/workspace';
import type { Command } from '../types/index.js';
import { buildInstallCommand, detectPackageManager, runMinimalChecks } from '../utils/check-system-deps.js';
import { detectNativePackages } from '../utils/detect-native-packages.js';
import { buildLauncherShims, buildNativeEnvPreamble } from '../utils/bin-shim.js';
import { installPackages, makeProgressReporter } from '../utils/install-backend.js';
import { atomicWriteStrict } from '../utils/install-cache-fs.js';
import { acquireInstallLock } from '../utils/install-lock.js';
import { nodeBinary } from '../utils/run-node.js';
import { spawnToCompletion } from '../utils/spawn.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import {
    binDirOnPath,
    BUNDLER_ENGINE_PACKAGE,
    defaultGlobalLayout,
    hasBundlerEngineInstalled,
    installGjsEnginePackages,
    linkGlobalBins,
    specToPackageName,
} from '../utils/install-global.js';
import {
    addDependencyEntry,
    defaultRangeFromVersion,
    parseSpec,
    projectSpecsFromPackageJson,
    readPackageJson,
    writePackageJson,
    type DependencyKind,
    type PackageJson,
} from '../utils/pkg-json-edit.js';
import type { NativeInstallOptions } from '../utils/install-backend-native.js';

/**
 * Link type for the workspace↔workspace directory links.
 *
 * Windows cannot create a *directory symlink* without elevation or Developer
 * Mode (`EPERM`), but any user can create an NTFS **junction** — which is why
 * npm and yarn both use junctions for workspace links. These two call sites had
 * no try/catch, so a non-elevated Windows workspace install hard-failed here.
 */
const WORKSPACE_LINK_TYPE: 'junction' | undefined = process.platform === 'win32' ? 'junction' : undefined;

/**
 * The `target` argument for a workspace link.
 *
 * Node normalises a `'junction'` target with `path.resolve()` — i.e. against
 * the process CWD, NOT the link's own directory — so a junction MUST be given
 * an absolute path. POSIX symlinks stay relative so the tree survives being
 * moved.
 */
function workspaceLinkTarget(linkPath: string, absTarget: string): string {
    return WORKSPACE_LINK_TYPE === 'junction' ? resolve(absTarget) : relative(dirname(linkPath), absTarget);
}

interface InstallOptions {
    packages?: string[];
    global?: boolean;
    'save-dev'?: boolean;
    'save-peer'?: boolean;
    'save-optional'?: boolean;
    immutable?: boolean;
    'refresh-lockfile'?: boolean;
    verbose: boolean;
    quiet?: boolean;
    progress?: boolean;
    backend?: 'native' | 'npm';
    timeout: number;
    os?: string;
    cpu?: string;
    libc?: string;
    force?: boolean;
}

// Default 30min wall-clock budget for the full install. Big workspaces
// (212+ sub-packages × 600+ external deps in the gjsify monorepo itself)
// can legitimately take 10-20 min on a fresh CI install when the npm CDN
// is slow — a 5-min default would false-positive on those legitimate
// flows. Per-fetch timeout (30s, retried) catches the truly stuck case
// inside this budget. Set --timeout 0 to disable the wall-clock guard
// entirely.
const DEFAULT_INSTALL_TIMEOUT_MS = 1_800_000;

export const installCommand: Command<unknown, InstallOptions> = {
    command: 'install [packages..]',
    description:
        'Install npm dependencies in the current project (or globally with -g), then run gjsify-aware post-checks.',
    builder: (yargs) =>
        yargs
            .positional('packages', {
                description: 'Optional package specs. With none, runs a full project install.',
                type: 'string',
                array: true,
            })
            .option('global', {
                description: 'Install into the user-global XDG location and symlink bins into ~/.local/bin.',
                type: 'boolean',
                alias: 'g',
                default: false,
            })
            .option('save-dev', { type: 'boolean', alias: 'D' })
            .option('save-peer', { type: 'boolean' })
            .option('save-optional', { type: 'boolean', alias: 'O' })
            .option('immutable', {
                description:
                    'CI mode: install strictly from gjsify-lock.json, fail if the lockfile is missing or stale. Equivalent to yarn --immutable / npm ci --frozen-lockfile.',
                type: 'boolean',
                default: false,
            })
            .option('refresh-lockfile', {
                description:
                    'Re-resolve every dependency to the newest version satisfying its range and rewrite the lockfile (bumps in-range transitive deps). Without it, a resolve preserves versions already pinned in the lockfile and only resolves new/changed deps — the npm/yarn/pnpm default. Mirrors yarn install --mode=update-lockfile.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Verbose install logging.',
                type: 'boolean',
                default: false,
            })
            .option('quiet', {
                description: 'Silence the progress bar.',
                type: 'boolean',
                default: false,
            })
            .option('progress', {
                description:
                    'Show a TTY-aware progress bar for resolve / download / extract phases. Auto-enabled when stderr is a TTY (override with --no-progress). Implicitly off under --verbose (per-package log lines replace the bar) or --quiet.',
                type: 'boolean',
                default: true,
            })
            .option('backend', {
                description:
                    'Install backend. `native` (default) routes through `@gjsify/{semver,npm-registry,tar}` — no Node/npm at runtime. `npm` shells out to `npm install` as an escape hatch for cases the native backend does not yet model (Yarn PnP repos, lifecycle scripts). Overrides `GJSIFY_INSTALL_BACKEND` if both are set.',
                type: 'string',
                choices: ['native', 'npm'] as const,
            })
            .option('timeout', {
                description:
                    'Overall install wall-clock timeout in ms (default 1800000 = 30 min). On timeout, all in-flight registry fetches are aborted and the install exits non-zero with a clear "install timed out — likely a registry slowdown" message. Per-request timeouts in @gjsify/npm-registry (default 30s) still apply within this budget. Set to 0 to disable the overall budget.',
                type: 'number',
                default: DEFAULT_INSTALL_TIMEOUT_MS,
            })
            .option('os', {
                description:
                    'Resolve/install for this OS instead of the running one (npm config key `os`, e.g. darwin, win32, linux). Affects which packages pass the os/cpu/libc compatibility check; the lockfile stays platform-independent either way.',
                type: 'string',
            })
            .option('cpu', {
                description:
                    'Resolve/install for this CPU architecture instead of the running one (npm config key `cpu`, e.g. x64, arm64).',
                type: 'string',
            })
            .option('libc', {
                description:
                    'Resolve/install for this libc family instead of probing the host (npm config key `libc`: glibc or musl). Only meaningful with --os=linux. A package declaring a libc is incompatible when the target libc is unknown.',
                type: 'string',
            })
            .option('force', {
                description:
                    'Install a REQUIRED dependency even when its os/cpu/libc excludes the target, instead of failing with EBADPLATFORM (npm config key `force`). Incompatible OPTIONAL dependencies stay skipped — npm ignores --force for those too, and a binary that cannot load is not worth downloading.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        // Publish `--os/--cpu/--libc/--force` as npm CONFIG KEYS before anything
        // resolves — see applyPlatformConfigFromFlags for why the environment is
        // the right channel for them rather than a parameter.
        applyPlatformConfigFromFlags(args);

        // --immutable is incompatible with explicit `<pkg>` adds and with
        // `--global` (which has no lockfile concept). Matches yarn's
        // behavior: `yarn add --immutable` is a hard error.
        if (args.immutable) {
            if (args.packages && args.packages.length > 0) {
                console.error(
                    'gjsify install --immutable does not accept package arguments. ' +
                        'Remove the package names or drop --immutable.',
                );
                // `return` — a bare `process.exit()` is deferred under GJS and
                // the install would proceed past a refused flag combination.
                return process.exit(1);
            }
            if (args.global) {
                console.error('gjsify install --immutable is incompatible with --global.');
                // `return` — see the deferred-exit note above.
                return process.exit(1);
            }
            if (args['refresh-lockfile']) {
                console.error(
                    'gjsify install --immutable is incompatible with --refresh-lockfile ' +
                        '(--immutable forbids rewriting the lockfile). Drop one.',
                );
                // `return` — see the deferred-exit note above.
                return process.exit(1);
            }
        }
        if (args.global) {
            if (!args.packages || args.packages.length === 0) {
                console.error('gjsify install --global requires at least one <pkg> argument.');
                // `return` — see the deferred-exit note above.
                return process.exit(1);
            }
            for (const flag of ['save-dev', 'save-peer', 'save-optional'] as const) {
                if (args[flag]) {
                    console.warn(
                        `gjsify install --global ignores --${flag}: global installs do not modify a project package.json.`,
                    );
                }
            }
            await installGlobalAndLink(args.packages, { verbose: args.verbose });
            return;
        }

        // Surface a CLI/workspace version skew BEFORE the heavy install, so
        // it's visible even if a later phase is slow. A gjsify CLI that is out
        // of step with the @gjsify/cli the workspace pins is the root cause of
        // both the mysterious install stall (a mismatched CLI resolves a
        // differently-shaped lock → full fresh resolve → a wedge-prone extract)
        // and silent-wrong-builds (the stale CLI builds with stale semantics).
        warnOnCliVersionSkew(process.cwd());

        // Backend selection (in precedence order):
        //   1. --backend flag (explicit user choice)
        //   2. GJSIFY_INSTALL_BACKEND env (back-compat shape from pre-flag era)
        //   3. native (default)
        const backend = args.backend ?? process.env.GJSIFY_INSTALL_BACKEND ?? 'native';

        if (backend === 'npm') {
            await projectInstallViaNpm(args);
            await runPostInstallChecks(args);
            return;
        }

        // Overall wall-clock budget for the install (default 30 min — big
        // workspaces on slow networks legitimately take a while). On timeout
        // we abort every in-flight registry fetch via this controller so a
        // signal-aware await rejects and the process exits cleanly with an
        // actionable message. Per-request timeouts inside @gjsify/npm-registry
        // (default 30s, retried) still apply within this budget.
        //
        // The abort only rescues awaits that OBSERVE the signal. Some awaits on
        // the fresh-resolve path do not — most notably tarball extraction (a
        // Gio-backed decompress whose stream close-event can be dropped under
        // GJS) and the workspace symlink fs-pool — so an aborted controller
        // alone cannot guarantee the process ever stops. `hardExitTimerId`
        // below is the backstop: a grace period after the abort, if the install
        // STILL hasn't returned, force a non-zero exit. This converts any
        // residual never-settling await into a clean failure instead of a
        // silent 0%-CPU hang (the observed "it never completed; I killed it"
        // pathology). `extractOne` additionally caps each extract with its own
        // stall timeout so the common case fails fast, long before this.
        const overallTimeoutMs = args.timeout > 0 ? args.timeout : 0;
        const overallController = overallTimeoutMs > 0 ? new AbortController() : null;
        const overallTimerId =
            overallController !== null
                ? setTimeout(() => overallController.abort(new Error('install-overall-timeout')), overallTimeoutMs)
                : null;
        // Grace after the abort before we pull the plug. Long enough for a
        // signal-aware reject to propagate through the catch (the clean path),
        // short enough that a genuinely-wedged await doesn't hang for minutes.
        const HARD_EXIT_GRACE_MS = 10_000;
        const hardExitTimerId =
            overallTimeoutMs > 0
                ? setTimeout(() => {
                      const secs = Math.round(overallTimeoutMs / 100) / 10;
                      // Do NOT assert a cause here — this timer cannot tell the
                      // two shapes apart, and claiming the rarer one sends the
                      // next reader after a bug that isn't there. Measured on a
                      // cold tree of this workspace WHEN THIS TIMER WAS WRITTEN:
                      // 1597 packages / ~4.8 GB extracted, of which ~3.4 GB were
                      // foreign-platform optional deps (`os`/`cpu` excluding the
                      // host) that npm would never place. Those are no longer
                      // downloaded — the resolver now records `os`/`cpu`/`libc`
                      // and marks incompatible optional nodes inert
                      // (`utils/platform-check.ts` + `applyPlatformFilter`), which
                      // leaves ~1.4 GB of that same tree to extract. The budget
                      // still exists for the same reason: extraction has
                      // multi-second SYNCHRONOUS stretches (tar parse + file
                      // writes) and 16 run concurrently, so the clean abort path
                      // can easily miss the grace window with nothing wedged.
                      console.error(
                          `gjsify install: the ${secs}s budget elapsed and the abort did not unwind within ` +
                              `${Math.round(HARD_EXIT_GRACE_MS / 1000)}s — forcing exit. That means one of two ` +
                              `things, and this timer cannot distinguish them: the install was still WORKING ` +
                              `(a cold tree here extracts several GB, and extraction blocks the loop in ` +
                              `multi-second synchronous stretches), or a step genuinely wedged. Re-running tells ` +
                              `you which, and is safe: extraction is idempotent, every package already on disk ` +
                              `is skipped, so a second run finishes the remainder in a fraction of the time. A ` +
                              `re-run that makes NO further progress is a real wedge — file an issue.`,
                      );
                      forceExit(1);
                  }, overallTimeoutMs + HARD_EXIT_GRACE_MS)
                : null;
        // Don't let the backstop timer keep an otherwise-finished process alive
        // (Node keeps the loop up while a timer is armed). `unref` lets the
        // process end the instant the install returns; `finally` clears it too.
        (hardExitTimerId as { unref?: () => void } | null)?.unref?.();
        try {
            await projectInstallNative(args, overallController?.signal);
            await runPostInstallChecks(args);
        } catch (err) {
            if (overallController !== null && overallController.signal.aborted && isAbortedFromOverallTimeout(err)) {
                const secs = Math.round(overallTimeoutMs / 100) / 10;
                console.error(
                    `gjsify install: timed out after ${secs}s — likely a registry slowdown or a wedged extract.\n` +
                        `Re-run, or override with --timeout <ms> (set --timeout 0 to disable the overall budget).`,
                );
                // `return` — the deferred GJS exit otherwise fell through into
                // the rethrow below and reported the timeout twice. The
                // `finally` still runs on the way out and clears the timers.
                return process.exit(1);
            }
            throw err;
        } finally {
            if (overallTimerId !== null) clearTimeout(overallTimerId);
            if (hardExitTimerId !== null) clearTimeout(hardExitTimerId);
        }
    },
};

/**
 * Hand the platform target + force bypass to the install backend.
 *
 * `os`, `cpu`, `libc` and `force` are npm CONFIG KEYS, and npm's own transport
 * for a config key is the environment: `--libc=musl` and `npm_config_libc=musl`
 * are the same input, which is why supporting the flags gives users the env
 * spelling for free. That is also why this is not threaded through as a
 * parameter: the config channel is already what this installer reads
 * (`loadNpmrc` honours `npm_config_registry` exactly so), one write reaches
 * EVERY prefix an invocation may install into (project, workspace root, `-g`,
 * the `dlx` cache) instead of one call site each, and a child process inherits
 * it — so a nested install can't quietly resolve for a different machine than
 * the run that spawned it.
 *
 * Empty/whitespace values are ignored rather than written as the empty string:
 * `--os=` must not mean "the nameless platform" (`readPlatformOverrides` drops
 * them on the read side too, so the two ends agree).
 */
function applyPlatformConfigFromFlags(args: InstallOptions): void {
    const keys = [
        ['os', 'npm_config_os'],
        ['cpu', 'npm_config_cpu'],
        ['libc', 'npm_config_libc'],
    ] as const;
    for (const [flag, envKey] of keys) {
        const value = args[flag];
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed !== '') process.env[envKey] = trimmed;
    }
    // Only ever SET: a `false` flag is the default, and clearing the key would
    // override an `npm_config_force` the user deliberately exported.
    if (args.force) process.env.npm_config_force = 'true';
}

/**
 * Heuristic: was this error raised because the overall-install AbortSignal
 * fired? The signal's `reason` is the sentinel `Error('install-overall-timeout')`
 * we installed above; the abort surfaces either as that exact reason or as
 * any AbortError thrown by a downstream fetch / setTimeout-on-abort path.
 * We match permissively because intermediate layers (fetch, GJS Soup, our
 * own delay()) re-wrap the reason in their own AbortError instances.
 */
function isAbortedFromOverallTimeout(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const name = (err as { name?: unknown }).name;
    if (name === 'AbortError') return true;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes('install-overall-timeout')) return true;
    // RegistryTimeoutError surfaces the per-request budget — distinct from
    // the overall budget but typically the symptom the overall timer reports.
    if (name === 'RegistryTimeoutError') return true;
    return false;
}

const CLI_PACKAGE_NAME = '@gjsify/cli';

/** Read a `version` from a package.json IFF its `name` is `@gjsify/cli`. */
function readCliVersionFrom(pkgJsonPath: string): string | null {
    try {
        if (!existsSync(pkgJsonPath)) return null;
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { name?: string; version?: string };
        if (pkg.name === CLI_PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version;
    } catch {
        /* unreadable / malformed — treat as unknown */
    }
    return null;
}

/**
 * Version of the @gjsify/cli that is ACTUALLY running (this bundle / lib entry).
 * Walks up from `import.meta.url` to the nearest `@gjsify/cli` package.json —
 * same discovery as `self-update`'s `readCurrentVersion`.
 */
function readRunningCliVersion(): string | null {
    try {
        let dir = dirname(resolve(fileURLToPath(import.meta.url)));
        for (let i = 0; i < 8 && dir !== dirname(dir); i++) {
            const v = readCliVersionFrom(join(dir, 'package.json'));
            if (v) return v;
            dir = dirname(dir);
        }
    } catch {
        /* not a recognizable layout (e.g. tests) */
    }
    return null;
}

/**
 * Version of the @gjsify/cli the workspace at `cwd` pins/ships. Prefers the
 * resolved install (`node_modules/@gjsify/cli`, a hoisted symlink in the
 * gjsify monorepo or a real install in a consumer), falling back to the
 * in-repo source so the check also fires on a fresh, not-yet-installed
 * checkout of the gjsify monorepo itself.
 */
function readWorkspaceCliVersion(cwd: string): string | null {
    return (
        readCliVersionFrom(join(cwd, 'node_modules', CLI_PACKAGE_NAME, 'package.json')) ??
        readCliVersionFrom(join(cwd, 'packages', 'infra', 'cli', 'package.json'))
    );
}

/**
 * Warn (never block) when the running gjsify CLI is a different version than
 * the @gjsify/cli the workspace pins. Running a mismatched CLI is the root of
 * two hard-to-diagnose failures documented on real sessions: install stalls (a
 * mismatched CLI discards the lock → full fresh resolve → a wedge-prone
 * extract) and silent-wrong-builds (stale CLI, stale bundle semantics). A
 * single actionable line pointing at `gjsify self-update` beats both silently.
 * Suppress with GJSIFY_NO_VERSION_SKEW_WARNING=1.
 */
function warnOnCliVersionSkew(cwd: string): void {
    if (process.env.GJSIFY_NO_VERSION_SKEW_WARNING === '1') return;
    const running = readRunningCliVersion();
    const pinned = readWorkspaceCliVersion(cwd);
    if (!running || !pinned || running === pinned) return;
    console.warn(
        `gjsify install: version skew — you are running @gjsify/cli v${running}, but this workspace pins ` +
            `v${pinned}.\n` +
            `  A mismatched CLI can stall the install (lock discarded → full re-resolve) or silently produce a ` +
            `wrong build.\n` +
            `  Align them: run \`gjsify self-update\` (global CLI) or use the workspace-local \`node_modules/.bin/` +
            `gjsify\`.\n` +
            `  Suppress this with GJSIFY_NO_VERSION_SKEW_WARNING=1.`,
    );
}

function isWorkspaceRoot(cwd: string): boolean {
    const pkgPath = join(cwd, 'package.json');
    const pkg = readPackageJson(pkgPath);
    if (!pkg) return false;
    return pkg.workspaces !== undefined;
}

/**
 * Which dependency NAMES are optional across the given manifests.
 *
 * The specs handed to the install backend are flat `"<name>@<range>"` strings —
 * `projectSpecsFromPackageJson` merges the three dependency blocks — so the kind
 * has to travel beside them. It matters for exactly one decision: an
 * incompatible `os`/`cpu`/`libc` skips an OPTIONAL dependency and fails a
 * REQUIRED one (see `NativeInstallOptions.optionalSpecs`).
 *
 * REQUIRED WINS ACROSS MANIFESTS, OPTIONAL WINS WITHIN ONE — and the two halves
 * are different rules for different reasons, so neither is a special case of the
 * other:
 *   - Across manifests: in a workspace the same package can be a plain dependency
 *     of one member and an optionalDependency of another. Those are two real
 *     edges; if one of them is not allowed to be missing, the install is not
 *     allowed to silently miss it. Subtracting rather than "last block seen" also
 *     makes the answer independent of manifest iteration order.
 *   - Within one manifest: a name in BOTH blocks is OPTIONAL, because npm says so
 *     ("entries in optionalDependencies will override entries of the same name in
 *     dependencies") — there is only ONE edge and the optional block names its
 *     kind. Treating it as required is the root-edge twin of the transitive defect
 *     `requiredDepEntries` fixes: `optionalDependencies: { fsevents }` alongside a
 *     `dependencies: { fsevents }` line would fail every Linux install with
 *     EBADPLATFORM over a package npm never installs there.
 */
export function optionalDependencyNames(manifests: readonly PackageJson[]): Set<string> {
    const optional = new Set<string>();
    const required = new Set<string>();
    for (const manifest of manifests) {
        const optionalHere = new Set(Object.keys(manifest.optionalDependencies ?? {}));
        for (const name of optionalHere) optional.add(name);
        for (const kind of ['dependencies', 'devDependencies'] as const) {
            for (const name of Object.keys(manifest[kind] ?? {})) {
                // Overridden by THIS manifest's own optional block — not a
                // required edge, so it must not veto another manifest's optional
                // declaration either.
                if (optionalHere.has(name)) continue;
                required.add(name);
            }
        }
    }
    for (const name of required) optional.delete(name);
    return optional;
}

function depKindFromArgs(args: InstallOptions): DependencyKind {
    if (args['save-dev']) return 'devDependencies';
    if (args['save-peer']) return 'peerDependencies';
    if (args['save-optional']) return 'optionalDependencies';
    return 'dependencies';
}

async function projectInstallNative(args: InstallOptions, signal?: AbortSignal): Promise<void> {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');

    // gjsify install is a node_modules-linker installer (like `npm install`
    // or `yarn --nodeLinker node-modules`): it materialises a node_modules/
    // tree + gjsify-lock.json. It deliberately does NOT produce a Yarn PnP
    // install, and the two resolution strategies cannot coexist — a leftover
    // `.pnp.cjs` makes Node ignore the node_modules/ tree we write, leaving a
    // silently broken project.
    //
    // Native PnP *generation* (a byte-identical `.pnp.cjs` + `.yarn/cache/*.zip`
    // that yarn itself would accept) is intentionally out of scope: it would
    // mean replicating yarn's libzip-deterministic archives, SHA-512 cache
    // keys, cache-version tracking and virtual-locator synthesis, and would
    // only ever match a single yarn release. So we stop here with actionable
    // guidance instead of half-doing it.
    //
    // We do NOT point users at `GJSIFY_INSTALL_BACKEND=npm` from this error:
    // that backend chokes on `workspace:` specs (`EUNSUPPORTEDPROTOCOL`),
    // which is exactly what the workspace repos that reach this branch have.
    const pnpResidue = ['.pnp.cjs', '.pnp.loader.mjs'].filter((f) => existsSync(join(cwd, f)));
    if (pnpResidue.length > 0) {
        throw new Error(
            `gjsify install uses the node_modules linker and cannot run in a Yarn PnP ` +
                `project (found ${pnpResidue.join(', ')} in ${cwd}).\n\n` +
                `• If this project uses \`gjsify install\` to manage dependencies, these PnP ` +
                `files are stale residue from an earlier \`yarn install\` — remove them and re-run:\n` +
                `      rm -f .pnp.cjs .pnp.loader.mjs && rm -rf .yarn/cache .yarn/unplugged\n` +
                `      gjsify install\n\n` +
                `• If instead you want Yarn to manage dependencies, set \`nodeLinker: node-modules\` ` +
                `in .yarnrc.yml and run \`yarn install\` (not \`gjsify install\`).`,
        );
    }

    // Workspace install (no args). Runs from the root, OR from any workspace
    // child — npm/yarn/pnpm resolve the monorepo root when you `install`
    // inside a member, so `findWorkspaceRoot` walks up from cwd (sanity-checked
    // that cwd is actually one of that root's workspaces) and installs the whole
    // workspace there. Without this, a child install treats the child as the
    // root and tries to resolve its `workspace:`/sibling deps from the registry.
    // Project-local `gjsify install <pkg>` inside a child still adds the dep to
    // that child via the single-package path below (this branch is no-args only).
    if (!args.packages || args.packages.length === 0) {
        const wsRoot = isWorkspaceRoot(cwd) ? cwd : findWorkspaceRoot(cwd);
        if (wsRoot) {
            if (wsRoot !== cwd) {
                console.log(
                    `gjsify install: resolved workspace root ${wsRoot} (from ${cwd}); installing the workspace.`,
                );
            }
            await workspaceInstall(wsRoot, args, signal);
            return;
        }
    }

    let specs: string[];
    const pkg = readPackageJson(pkgPath);

    const existingSpecs = pkg ? projectSpecsFromPackageJson(pkg) : [];

    if (args.packages && args.packages.length > 0) {
        // Combine new specs with existing manifest deps so a single
        // `gjsify install <new>` doesn't churn the lockfile (would drop
        // every previously-pinned entry otherwise). New specs with the
        // same name as an existing dep override.
        const newNames = new Set(args.packages.map((s) => parseSpec(s).name));
        const carryover = existingSpecs.filter((s) => !newNames.has(parseSpec(s).name));
        specs = [...carryover, ...args.packages];
    } else {
        if (!pkg) {
            throw new Error(`gjsify install: no package.json in ${cwd}`);
        }
        specs = existingSpecs;
        if (specs.length === 0) {
            console.log('gjsify install: no dependencies declared in package.json — nothing to do.');
            return;
        }
    }

    mkdirSync(cwd, { recursive: true });
    // Progress bar is auto-enabled when stderr is a TTY (and `--verbose` /
    // `--quiet` / `--no-progress` aren't set). When piped to a log file the
    // reporter falls back to one line per phase begin/end.
    const progress = makeProgressReporter({
        enabled: !args.verbose && !args.quiet && args.progress !== false,
    });
    // Hold the per-prefix lock across the install AND the manifest/lockfile
    // sync that follows, so a concurrent `gjsify install <pkg>` in the same
    // project can't interleave its package.json / gjsify-lock.json writes
    // with ours. `installPackages` re-acquires the same lock re-entrantly.
    const lock = await acquireInstallLock(cwd, { signal });
    try {
        // Typed as NativeInstallOptions so the native-backend-only
        // `optionalSpecs` is CHECKED at this call site instead of being smuggled
        // past an object-literal excess-property check; `installPackages`
        // forwards the object to that backend unchanged.
        const nativeOpts: NativeInstallOptions = {
            prefix: cwd,
            specs,
            verbose: args.verbose,
            // --immutable consumes the lockfile verbatim and must NOT rewrite
            // it (the whole point is byte-stability under CI).
            lockfile: !args.immutable,
            frozen: args.immutable,
            refreshLockfile: args['refresh-lockfile'],
            signal,
            progress,
            // `gjsify install -O <pkg>` saves to optionalDependencies, but the
            // manifest is only written AFTER this install — so the flag, not the
            // manifest, is what makes this run treat the added specs as optional.
            optionalSpecs: new Set([
                ...optionalDependencyNames(pkg ? [pkg] : []),
                ...(args['save-optional'] ? (args.packages ?? []).map((s) => parseSpec(s).name) : []),
            ]),
        };
        const result = await installPackages(nativeOpts);

        // Update package.json only when the user passed explicit packages
        // (the `gjsify install <pkg>...` add-a-dep flow). The no-args refresh
        // flow doesn't mutate manifest entries.
        if (args.packages && args.packages.length > 0 && pkg) {
            const kind = depKindFromArgs(args);
            for (const spec of args.packages) {
                const { name, range } = parseSpec(spec);
                const installed = result.installed.find((r) => r.name === name);
                const finalRange = range ?? (installed ? defaultRangeFromVersion(installed.version) : 'latest');
                addDependencyEntry(pkg, name, finalRange, kind);
            }
            writePackageJson(pkgPath, pkg);

            // Re-sync the lockfile's `requested` field with what
            // `projectSpecsFromPackageJson()` will return on the next
            // invocation. Without this, a `gjsify install foo` (bare name,
            // lockfile records `"foo"`) followed by `gjsify install
            // --immutable` (reads package.json → spec `"foo@^1.2.3"`) would
            // surface a spurious drift error.
            if (!args.immutable) {
                syncLockfileRequested(cwd, projectSpecsFromPackageJson(pkg));
            }
        }
    } finally {
        lock.release();
    }
}

function syncLockfileRequested(cwd: string, specs: string[]): void {
    const lockPath = join(cwd, 'gjsify-lock.json');
    if (!existsSync(lockPath)) return;
    try {
        const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { requested?: string[] };
        const sorted = [...specs].sort();
        const current = [...(lock.requested ?? [])].sort();
        if (sorted.length === current.length && sorted.every((s, i) => s === current[i])) {
            return; // Already in sync; preserve byte-stability.
        }
        lock.requested = specs;
        // Atomic tmp+rename — same rationale as the backend's lockfile
        // writer: a torn gjsify-lock.json breaks the next `--immutable`.
        atomicWriteStrict(lockPath, JSON.stringify(lock, null, 2) + '\n');
    } catch {
        // Best-effort sync; if the lockfile is malformed, the next
        // non-immutable install will rewrite it from scratch.
    }
}

/**
 * Workspace-aware install. Mirrors what `yarn install` does at a monorepo root:
 *   1. Discover every workspace under the root.
 *   2. Aggregate the union of their external (non-`workspace:`) deps.
 *   3. Run the native install backend ONCE at the root prefix so all
 *      externals land in a single `node_modules/` (poor-man's hoisting —
 *      workspaces with conflicting ranges of the same dep share one hoisted
 *      copy; the resolver emits a loud `[gjsify] warning: version conflict`
 *      naming both sides and the version that won).
 *   4. For every `workspace:` reference, symlink the target workspace's
 *      directory into the requesting workspace's `node_modules/<dep>`
 *      so `import '@gjsify/utils'` resolves to the local source.
 *
 * Hoisting strategy is intentionally minimal — per-workspace dedup +
 * nested `node_modules/` for cross-workspace version conflicts are the
 * Phase D.8 follow-up tracked in status/open-todos.md.
 */
async function workspaceInstall(cwd: string, args: InstallOptions, signal?: AbortSignal): Promise<void> {
    // Hold the root-prefix lock for the WHOLE workspace flow: bin shims,
    // workspace symlinks and the external install all mutate the root
    // node_modules/, and a second concurrent workspace install interleaving
    // its rm+symlink/extract steps with ours corrupts both. The inner
    // `installPackages` calls re-acquire the same lock re-entrantly (root
    // prefix) or take the child-workspace lock (scoped overrides) — always
    // in root→child order, so there is no lock-ordering cycle.
    const lock = await acquireInstallLock(cwd, { signal });
    try {
        await workspaceInstallLocked(cwd, args, signal);
    } finally {
        lock.release();
    }
}

/** Body of {@link workspaceInstall}, run while holding the root-prefix lock. */
async function workspaceInstallLocked(cwd: string, args: InstallOptions, signal?: AbortSignal): Promise<void> {
    const workspaces = discoverWorkspaces(cwd, { includeRoot: true });
    if (workspaces.length === 0) {
        throw new Error(`gjsify install: ${cwd} has a "workspaces" field but no workspaces were discovered`);
    }
    const byName = new Map(workspaces.map((w) => [w.name, w] as const));
    const externalSpecs = new Set<string>();
    // Which workspace(s) declared each external spec — `"<name>@<range>"` →
    // workspace names. Feeds the resolver's version-conflict warning so it
    // can attribute both sides of a cross-workspace range conflict.
    const specOrigins = new Map<string, Set<string>>();
    interface SymlinkPlan {
        fromWorkspaceName: string;
        depName: string;
        targetLocation: string;
    }
    const symlinks: SymlinkPlan[] = [];

    for (const ws of workspaces) {
        const m = ws.manifest;
        for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
            const block = m[kind];
            if (!block) continue;
            for (const [depName, spec] of Object.entries(block)) {
                if (typeof spec !== 'string') continue;
                // A dependency whose NAME matches a local workspace is always
                // satisfied by that workspace — never by a same-named package on
                // npm. This holds regardless of the spec form: an explicit
                // `workspace:` protocol, a plain semver range (`^1.2.3`), or even
                // a dist-tag. Yarn/npm resolve a workspace-named dep to the local
                // package first; we MUST do the same. Routing such a dep into the
                // native fetch/extract queue is the data-loss bug this guards
                // against — `extractOne` would `rmSync` + drop the published
                // tarball over the workspace's OWN source tree (the published
                // tarball ships only `files`, so `src/**` gets wiped). Symlink
                // it instead, exactly like a `workspace:` ref.
                const localWorkspace = byName.get(depName);
                if (localWorkspace) {
                    // Only an EXPLICIT out-of-workspace protocol (link:/file:/
                    // portal:/git+/http(s):) opts out of the local workspace. Any
                    // other shape — `workspace:` or a plain semver range/dist-tag
                    // (`^1.2.3`, `*`, `latest`) — resolves to the local package.
                    const explicitOverride = /^(link|file|portal|git\+|https?):/.test(spec);
                    if (!explicitOverride) {
                        symlinks.push({
                            fromWorkspaceName: ws.name,
                            depName,
                            targetLocation: localWorkspace.location,
                        });
                        continue;
                    }
                    // explicit override → fall through to the existing handling.
                }
                if (spec.startsWith('workspace:')) {
                    // `workspace:` against a name that is NOT a discovered
                    // workspace is a hard error (typo / missing package).
                    throw new Error(
                        `gjsify install: ${ws.name} declares "${depName}: ${spec}" but ` +
                            `no workspace with that name exists`,
                    );
                }
                if (/^(link|file|portal|git\+|https?):/.test(spec)) continue;
                const specKey = `${depName}@${spec}`;
                externalSpecs.add(specKey);
                let origins = specOrigins.get(specKey);
                if (!origins) {
                    origins = new Set<string>();
                    specOrigins.set(specKey, origins);
                }
                origins.add(ws.name);
            }
        }
    }

    console.log(
        `gjsify install: ${workspaces.length} workspace(s), ${externalSpecs.size} external dep spec(s), ${symlinks.length} workspace symlink(s)`,
    );

    // Write workspace bin shims EARLY — before the download/extract phase.
    // The shims are cheap derived artifacts (workspace manifests only), and
    // the heavy phase that follows can fail or die mid-way (network errors,
    // timeouts, runtime crashes). Writing them up-front guarantees the
    // workspace never loses its runner shim (`node_modules/.bin/gjsify`) to
    // a failed install, and an in-place re-install on an already-materialized
    // tree refreshes a stale shim even when a later phase aborts. The same
    // shims are re-written at the end of this function so the GJS-preamble
    // (GI_TYPELIB_PATH for native prebuilds) reflects the freshly installed
    // tree — see the final `writeWorkspaceBinShims` call below.
    writeWorkspaceBinShims(cwd, workspaces);

    // Materialise the workspace↔workspace symlinks: per-requester links
    // (`<requester>/node_modules/<dep>`) plus a root hoist of every workspace
    // into `node_modules/<name>` so transitive workspace deps resolve via
    // Node's parent-walk from any descendant. Idempotent (rm + symlink, and
    // the hoist skips entries that already exist), so it's safe to run more
    // than once.
    const wireWorkspaceSymlinks = async (): Promise<void> => {
        // Per-requester symlinks — pre-dedup the parent-dir mkdirs (every
        // symlink for the same workspace shares a single `node_modules`
        // parent), then run the per-link rm + symlink steps with bounded
        // concurrency. Pure sync loops here used to dominate the tail of large
        // installs (~793 symlinks × ~10ms each for mkdir+rm+symlink = ~24s of
        // serial syscalls). With async + a 32-wide pool the same set lands in
        // 1-2s.
        if (symlinks.length > 0) {
            const fsp = await import('node:fs/promises');
            const parentDirs = new Set<string>();
            const plans: Array<{ linkPath: string; relTarget: string }> = [];
            for (const link of symlinks) {
                const target = byName.get(link.fromWorkspaceName);
                if (!target) continue;
                const linkPath = join(target.location, 'node_modules', link.depName);
                parentDirs.add(dirname(linkPath));
                const relTarget = workspaceLinkTarget(linkPath, link.targetLocation);
                plans.push({ linkPath, relTarget });
            }
            // Phase 1: one mkdir per unique parent (max ~213 instead of ~793).
            await Promise.all([...parentDirs].map((dir) => fsp.mkdir(dir, { recursive: true })));
            // Phase 2: per-link rm + symlink, pooled. A semaphore-style cursor
            // keeps the concurrent in-flight count bounded so we don't blow up
            // the file-descriptor table on huge monorepos.
            const SYMLINK_CONCURRENCY = 32;
            let cursor = 0;
            const workers: Promise<void>[] = [];
            const wireOne = async (linkPath: string, relTarget: string) => {
                // Remove any prior entry — regular dir, broken symlink, file,
                // or a normal symlink left over from a previous install.
                // `{ recursive: true, force: true }` handles every shape (rm
                // no-ops on missing paths under force; recursive covers dirs).
                try {
                    await fsp.rm(linkPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                } catch {
                    /* unexpected; symlink call below will surface the real
                       cause if it persists. */
                }
                await fsp.symlink(relTarget, linkPath, WORKSPACE_LINK_TYPE);
            };
            for (let i = 0; i < Math.min(SYMLINK_CONCURRENCY, plans.length); i++) {
                workers.push(
                    (async () => {
                        while (true) {
                            const idx = cursor++;
                            if (idx >= plans.length) return;
                            const p = plans[idx];
                            if (!p) return;
                            await wireOne(p.linkPath, p.relTarget);
                        }
                    })(),
                );
            }
            await Promise.all(workers);
            console.log(`gjsify install: wired ${symlinks.length} workspace symlink(s)`);
        }

        // Hoist EVERY workspace package to the repo root's `node_modules/` so
        // transitive workspace deps are reachable from any descendant via
        // standard Node parent-walk resolution. yarn's `nodeLinker:
        // node-modules` does the same thing — the entire workspace graph is
        // materialised at the root, which is how rolldown's resolver finds
        // e.g. `@gjsify/abort-controller/register` injected from a
        // deeply-nested package's `node_modules/.cache/gjsify/` cache file
        // when the consumer didn't declare a direct dep on it (auto-globals
        // injection at build time).
        //
        // Without this hoist, each workspace's `node_modules/` only contains
        // its direct declared deps, and any auto-injected register import for
        // a workspace package the consumer didn't list as a dep externalises
        // and the bundle fails at runtime with `Module not found`.
        const rootBinDir = join(cwd, 'node_modules');
        let rootHoisted = 0;
        for (const ws of workspaces) {
            // Skip the root workspace itself (its location IS cwd; it can't
            // symlink itself into its own node_modules).
            if (ws.location === cwd) continue;
            if (!ws.name) continue;
            const linkPath = join(rootBinDir, ws.name);
            // If a symlink already exists here (from the per-requester loop
            // above when the root workspace declared this dep directly), it
            // already points at the right place — skip. We don't try to
            // remove + recreate because under GJS's Gio-backed fs polyfill,
            // `rmSync` on a symlink can race with `symlinkSync` and surface
            // EEXIST. A real directory at this path is also left alone —
            // someone else (npm, yarn) seeded it and we shouldn't clobber.
            let existsHere = false;
            try {
                lstatSync(linkPath);
                existsHere = true;
            } catch {
                /* ENOENT */
            }
            if (existsHere) continue;
            mkdirSync(dirname(linkPath), { recursive: true });
            symlinkSync(workspaceLinkTarget(linkPath, ws.location), linkPath, WORKSPACE_LINK_TYPE);
            rootHoisted++;
        }
        if (rootHoisted > 0) {
            console.log(`gjsify install: hoisted ${rootHoisted} workspace(s) to root node_modules/`);
        }
    };

    // Wire workspace↔workspace symlinks EARLY too — same rationale as the bin
    // shims. These symlinks point at local workspace source trees and never
    // depend on the external download, yet they USED to run only at the tail
    // of the install. An interrupted/timed-out external fetch then left the
    // tree with NO workspace symlinks at all, so cross-package imports
    // (`@gjsify/native-fs-bridge` → `@gjsify/native-platform`) failed to
    // resolve even though every package was on disk. Materialising them here
    // makes workspace resolution survive a failed external phase. Safe to run
    // before `installPackages`: that phase only fetches NON-workspace names
    // (workspace-named deps are routed to symlinks and excluded from
    // `externalSpecs`), and `extractOne` only `rm`s the individual external
    // package dest it is about to write — never a workspace symlink.
    await wireWorkspaceSymlinks();

    // Read top-level package.json's `overrides` (npm-native) or `resolutions`
    // (yarn-native, kept as the existing field name in pre-Phase-D.8 repos).
    // Flat `name → range` entries become global overrides applied to every
    // workspace; nested `<workspace> → {dep → range}` entries become
    // workspace-local installs that place the overridden dep inside that
    // workspace's own `node_modules/`. Lets a monorepo pin one workspace to
    // an older `typescript` (e.g. a downstream integration test) without
    // forcing the rest of the tree to the same version.
    const rootManifest = workspaces.find((w) => w.location === cwd)?.manifest as
        | { overrides?: unknown; resolutions?: unknown }
        | undefined;
    const extracted = extractOverrides(rootManifest);
    const overrides = extracted?.global;

    // Second pass: pluck specs that have a workspace-scoped override out of
    // `externalSpecs` and re-collect them into a per-workspace map. Those
    // specs will be installed into the workspace's own `node_modules/` after
    // the root install completes, so the resolver in the root pass does NOT
    // see the conflicting versions.
    const wsLocalSpecs = new Map<string, Set<string>>(); // wsLocation → name@range set
    const droppedFromExternal = new Set<string>();
    if (extracted && extracted.scoped.size > 0) {
        for (const ws of workspaces) {
            const wsManifest = ws.manifest;
            for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
                const deps = wsManifest[kind] as Record<string, string> | undefined;
                if (!deps) continue;
                for (const [depName, spec] of Object.entries(deps)) {
                    const override = scopedOverrideFor(ws, depName, extracted);
                    if (!override) continue;
                    // Re-route this dep to the workspace's own install
                    const targetRange = override;
                    const wsKey = ws.location;
                    let bucket = wsLocalSpecs.get(wsKey);
                    if (!bucket) {
                        bucket = new Set<string>();
                        wsLocalSpecs.set(wsKey, bucket);
                    }
                    bucket.add(`${depName}@${targetRange}`);
                    // Drop the un-overridden version from the root spec set:
                    // the workspace will see its scoped version via parent-walk
                    // resolution. Note we only drop the EXACT `name@spec` the
                    // workspace declared; other workspaces' instances of the
                    // same name+spec stay in the root set.
                    droppedFromExternal.add(`${depName}@${spec}`);
                }
            }
        }
        // Apply the drops only when no OTHER workspace declared the same spec
        // — otherwise it has legitimate root requesters and must stay.
        const stillNeeded = new Set<string>();
        for (const ws of workspaces) {
            for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
                const deps = ws.manifest[kind] as Record<string, string> | undefined;
                if (!deps) continue;
                for (const [depName, spec] of Object.entries(deps)) {
                    if (scopedOverrideFor(ws, depName, extracted)) continue;
                    stillNeeded.add(`${depName}@${spec}`);
                }
            }
        }
        for (const dropped of droppedFromExternal) {
            if (!stillNeeded.has(dropped)) externalSpecs.delete(dropped);
        }
        if (wsLocalSpecs.size > 0) {
            console.log(
                `gjsify install: ${wsLocalSpecs.size} workspace(s) have scoped overrides — they will install their overridden deps locally after the root install`,
            );
        }
    }

    if (externalSpecs.size > 0) {
        const progress = makeProgressReporter({
            enabled: !args.verbose && !args.quiet && args.progress !== false,
        });
        const rootOpts: NativeInstallOptions = {
            prefix: cwd,
            specs: [...externalSpecs],
            verbose: args.verbose,
            lockfile: !args.immutable,
            frozen: args.immutable,
            refreshLockfile: args['refresh-lockfile'],
            overrides,
            signal,
            progress,
            // Workspace-named packages are symlinked above — the native backend
            // must never fetch a same-named published version over those
            // symlinks (e.g. a `types-dev/<lib>` workspace that also exists on
            // npm and is pinned transitively in the lockfile).
            workspaceNames: new Set(byName.keys()),
            specOrigins: new Map([...specOrigins].map(([k, v]) => [k, [...v]] as const)),
            // Aggregated over EVERY member: the specs are aggregated the same
            // way, so the optional-vs-required answer has to be too (a name that
            // any member declares as a plain dependency stays required).
            optionalSpecs: optionalDependencyNames(workspaces.map((w) => w.manifest as PackageJson)),
        };
        await installPackages(rootOpts);
    } else if (args.verbose) {
        console.log('gjsify install: no external deps to fetch');
    }

    // Workspace-local installs for scoped overrides. Each runs as its own
    // `installPackages` call inside the workspace location — the resulting
    // `node_modules/<dep>` shadows the root-hoisted version via standard
    // Node parent-walk resolution.
    for (const [wsLocation, specSet] of wsLocalSpecs) {
        if (specSet.size === 0) continue;
        const wsName = workspaces.find((w) => w.location === wsLocation)?.name ?? wsLocation;
        if (args.verbose) {
            console.log(
                `gjsify install: ${wsName} — installing ${specSet.size} scoped-override spec(s) into ${wsLocation}/node_modules/`,
            );
        }
        const scopedOpts: NativeInstallOptions = {
            prefix: wsLocation,
            specs: [...specSet],
            verbose: args.verbose,
            // Per-workspace installs get a thin lockfile next to the workspace
            // package.json. Same `--immutable` semantics as the root install.
            lockfile: !args.immutable,
            frozen: args.immutable,
            signal,
            workspaceNames: new Set(byName.keys()),
            // Same aggregated answer as the root install: these specs are a
            // SUBSET of the root's, so classifying them differently here would
            // make one dep optional at the root and required in a member.
            optionalSpecs: optionalDependencyNames(workspaces.map((w) => w.manifest as PackageJson)),
        };
        await installPackages(scopedOpts);
    }

    // Re-wire workspace symlinks once more now that the external + scoped
    // installs are done. The EARLY pass above already created them so workspace
    // resolution survives a failed external phase; this final idempotent pass
    // is a cheap safety net in case any later step disturbed one (the per-link
    // rm+symlink re-establishes them, the root hoist skips entries that already
    // exist — so it's a near no-op when nothing changed).
    await wireWorkspaceSymlinks();

    // Re-write workspace bins into `node_modules/.bin/` now that the tree is
    // fully materialized. The early pass at the top of this function already
    // guaranteed the shims exist; this final pass refreshes their GJS-preamble
    // with the native prebuild dirs that only became discoverable after the
    // install (fresh checkout: `detectNativePackages` finds nothing before the
    // packages are extracted). Running last also keeps workspace shims
    // authoritative over any same-named external bin linked by the install
    // backend (yarn semantics: workspace bins win).
    const wsBinsCreated = writeWorkspaceBinShims(cwd, workspaces);
    if (wsBinsCreated > 0) {
        console.log(`gjsify install: linked ${wsBinsCreated} workspace bin(s) into node_modules/.bin/`);
    }
}

/**
 * (Re)write the shell shims for every workspace-declared bin into the root
 * `node_modules/.bin/`. Without this, `npm run <script>` (or any
 * `node_modules/.bin`-PATH consumer) cannot find the `gjsify` binary on a
 * fresh checkout — yarn creates these shims at install time; we match.
 *
 * Each workspace's `bin` entry maps `<binName>` → `<relative-target>`.
 * For GJS-runnable bins, `gjsify.bin` is preferred — its target is the
 * committed `dist/cli.gjs.mjs` bundle that exists on a fresh checkout,
 * versus the `bin` field which typically points at `lib/index.js`
 * (a build artifact that may not yet exist). The shim wraps the
 * target in a shell script that picks the right interpreter (`gjs -m`
 * for `.mjs` bundles, `node` for `.js` files).
 *
 * IDEMPOTENT + UNCONDITIONAL: shims are derived artifacts and are always
 * regenerated — never skipped because a file already exists, never a
 * failure because one is missing. `workspaceInstall` calls this twice:
 * once BEFORE the download/extract phase (so a failed/aborted install can
 * never leave the workspace without its runner shim, and a stale shim is
 * refreshed even when a later phase dies) and once after (to pick up
 * native prebuild dirs that only exist post-extract).
 */
function writeWorkspaceBinShims(cwd: string, workspaces: ReturnType<typeof discoverWorkspaces>): number {
    const wsBinDir = join(cwd, 'node_modules', '.bin');
    // Discover native prebuilds reachable from the workspace cwd so the
    // workspace-local `node_modules/.bin/gjsify` shim sets GI_TYPELIB_PATH /
    // LD_LIBRARY_PATH for them. Same rationale as the global launcher in
    // install-global.ts — the bin shim invokes the CLI bundle via `gjs -m`
    // directly, with no chance to set env after the fact, so without this
    // preamble `imports.gi.GjsifyTerminal` etc. fail and process.stdout
    // collapses to no-color, 80-col defaults.
    const nativePrebuildDirs = detectNativePackages(cwd).map((p) => p.prebuildsDir);
    let wsBinsCreated = 0;
    for (const ws of workspaces) {
        const m = ws.manifest as Record<string, unknown>;
        const gjsifyBin = (m.gjsify as { bin?: string | Record<string, string> } | undefined)?.bin;
        const nodeBin = m.bin as string | Record<string, string> | undefined;
        // For each bin name, collect both the Node-target and GJS-target
        // when they exist. The shim prefers Node at invocation time
        // because Node's child_process is more reliable than GJS's
        // Gio.Subprocess polyfill (parallel-spawn close-event delivery
        // races under heavy concurrency); GJS is the fallback for fresh
        // checkouts where the Node target hasn't been built yet.
        const merged = mergeWorkspaceBins(ws.name, gjsifyBin, nodeBin);
        if (merged.size === 0) continue;
        mkdirSync(wsBinDir, { recursive: true });
        for (const [binName, { nodeTarget, gjsTarget }] of merged) {
            const linkPath = join(wsBinDir, binName);
            for (const file of [linkPath, `${linkPath}.cmd`, `${linkPath}.ps1`]) {
                try {
                    rmSync(file, { force: true, maxRetries: 10, retryDelay: 100 });
                } catch {
                    /* fine */
                }
            }
            writeFileSync(
                linkPath,
                buildBinShim(ws.location, nodeTarget, gjsTarget, nativePrebuildDirs, process.platform, cwd),
                { mode: 0o755 },
            );
            chmodSync(linkPath, 0o755);
            // Windows executes neither an extension-less file nor a `#!` line —
            // the sh shim above is only reachable from git-bash/MSYS/WSL. Write
            // the `.cmd`/`.ps1` companions cmd.exe and pwsh need, mirroring what
            // npm's cmd-shim lays down next to every linked bin.
            if (process.platform === 'win32') {
                for (const [suffix, contents] of Object.entries(
                    buildWorkspaceBinShimsForWindows(ws.location, nodeTarget, gjsTarget, nativePrebuildDirs),
                )) {
                    writeFileSync(`${linkPath}.${suffix}`, contents, { mode: 0o755 });
                }
            }
            wsBinsCreated++;
        }
    }
    return wsBinsCreated;
}

/**
 * Build a shell shim that prefers Node when its target file exists at
 * invocation time, falling back to GJS otherwise. The runtime check is
 * per-invocation (not at install time) so the same shim works both
 * before and after the workspace's `lib/` has been built — a fresh
 * checkout only has the committed `dist/cli.gjs.mjs`, while every
 * subsequent `npm run build` produces `lib/index.js`.
 *
 * Both targets are absolute paths so the shim is portable across the
 * different cwds that consumers (`yarn run`, `npm run`, direct PATH
 * invocation) call us from.
 */
/**
 * Flatten npm `overrides` or yarn `resolutions` into a bare name → range map.
 *
 * Supports two input shapes:
 *
 *   "overrides": { "typescript": "~5.9.2" }                       (npm)
 *   "resolutions": { "typescript@*": "~5.9.2" }                   (yarn pattern)
 *
 * Pattern keys with a version glob (`name@*`, `name@^x`) are normalised to the
 * bare name — gjsify's resolver doesn't yet support per-incoming-range
 * scoping. Object-valued nested overrides (npm's per-parent shape, e.g.
 * `"foo": { ".": "1.0", "bar": "2.0" }`) are intentionally ignored; they would
 * silently misbehave without per-parent support, so we surface a warning
 * instead of half-applying them.
 *
 * Keys beginning with `_` are skipped (convention for documentation entries
 * like `"_comment_typescript"` used in the wild).
 */
/**
 * Result of extracting `overrides` + `resolutions` from the root manifest.
 *
 * - `global`: flat `depName → range` map. Applied to every workspace unless
 *   a more specific scoped entry matches.
 * - `scoped`: per-workspace `<scopeKey> → {depName → range}`. The scopeKey
 *   matches either a workspace's `name` (e.g. `@gjsify/integration-loro-crdt`)
 *   or its `relativeLocation` (e.g. `tests/integration/loro-crdt`) — both are
 *   accepted so users can write whichever is more readable. The scoped layer
 *   triggers a workspace-local install (the integration package gets its own
 *   `node_modules/<dep>` instead of the hoisted root version).
 */
interface ExtractedOverrides {
    global: Record<string, string>;
    scoped: Map<string, Record<string, string>>;
}

function extractOverrides(
    rootManifest: { overrides?: unknown; resolutions?: unknown } | undefined,
): ExtractedOverrides | undefined {
    if (!rootManifest) return undefined;
    const global: Record<string, string> = {};
    const scoped = new Map<string, Record<string, string>>();
    const merge = (source: Record<string, unknown> | undefined, fieldName: string) => {
        if (!source) return;
        for (const [key, value] of Object.entries(source)) {
            if (key.startsWith('_')) continue;
            if (typeof value === 'string') {
                // Flat `name → range` entry. Normalise pattern keys (`name@*`,
                // `name@^range`) → bare name. For scoped packages preserve the
                // leading `@`.
                let name = key;
                const atIdx = key.startsWith('@') ? key.indexOf('@', 1) : key.indexOf('@');
                if (atIdx > 0) name = key.slice(0, atIdx);
                global[name] = value;
                continue;
            }
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                // Scoped entry — `<workspace> → {dep → range}`. This is the
                // npm-overrides nested shape and yarn's resolutions
                // selectors collapsed to per-workspace level.
                const sub: Record<string, string> = {};
                for (const [depKey, depValue] of Object.entries(value as Record<string, unknown>)) {
                    if (depKey.startsWith('_')) continue;
                    if (typeof depValue !== 'string') {
                        console.warn(
                            `gjsify install: ${fieldName}["${key}"]["${depKey}"] is not a string — only one level of nesting is supported, skipping`,
                        );
                        continue;
                    }
                    let depName = depKey;
                    const atIdx = depKey.startsWith('@') ? depKey.indexOf('@', 1) : depKey.indexOf('@');
                    if (atIdx > 0) depName = depKey.slice(0, atIdx);
                    sub[depName] = depValue;
                }
                if (Object.keys(sub).length > 0) {
                    const existing = scoped.get(key) ?? {};
                    scoped.set(key, { ...existing, ...sub });
                }
                continue;
            }
            console.warn(`gjsify install: ${fieldName}["${key}"] is not a string or object — skipping`);
        }
    };
    merge(rootManifest.overrides as Record<string, unknown> | undefined, 'overrides');
    merge(rootManifest.resolutions as Record<string, unknown> | undefined, 'resolutions');
    if (Object.keys(global).length === 0 && scoped.size === 0) return undefined;
    return { global, scoped };
}

/**
 * Look up the scoped override for a given workspace + dep. Matches by
 * workspace name OR relative location (both accepted for readability).
 */
function scopedOverrideFor(
    ws: { name: string; relativeLocation: string },
    depName: string,
    extracted: ExtractedOverrides | undefined,
): string | undefined {
    if (!extracted || extracted.scoped.size === 0) return undefined;
    const candidates = [ws.name, ws.relativeLocation];
    for (const key of candidates) {
        const entry = extracted.scoped.get(key);
        if (entry?.[depName]) return entry[depName];
    }
    return undefined;
}

export function buildBinShim(
    wsLocation: string,
    nodeTarget?: string,
    gjsTarget?: string,
    nativePrebuildDirs: string[] = [],
    platform: string = process.platform,
    scanRoot: string = wsLocation,
): string {
    const nodeAbs = nodeTarget ? join(wsLocation, nodeTarget) : null;
    const gjsAbs = gjsTarget ? join(wsLocation, gjsTarget) : null;
    // GJS-only env preamble — Node ignores GI_TYPELIB_PATH so we scope the
    // export to the gjs branch, keeping the shim minimal when no native pkgs
    // exist or only the Node bin is in play.
    //
    // `scanRoot` is the INSTALL prefix (the tree holding `node_modules/.bin`),
    // not the workspace package dir: the preamble globs its `node_modules` at
    // launch time instead of embedding what was installed the day the shim was
    // written, so `gjsify install <some>-native` afterwards is picked up without
    // a re-link. See `buildNativeEnvPreamble`.
    const gjsPreamble = buildNativeEnvPreamble(scanRoot, nativePrebuildDirs, { platform });
    if (nodeAbs && gjsAbs) {
        // GJS-FIRST: prefer the committed Node-free GJS bundle when `gjs` is on
        // PATH AND the bundle exists; fall back to the Node entry otherwise (a
        // Node-only machine, or before the bundle is built). gjsify is
        // GJS-first but stays fully runnable under Node.
        //
        // Safe to default to GJS now that the blockers earlier flip attempts
        // surfaced are all fixed: css-as-string file://-resolve, `foreach`
        // fail-fast, the @gjsify/tsc lib-refresh race, native-rolldown
        // node-target externals — and the make-or-break one, the nested-gjs
        // build thrash: `gjsify run` now dispatches a single `gjsify <cmd>`
        // script IN-PROCESS under GJS (see cli-app.ts) instead of spawning yet
        // another gjs, so the build no longer chains ~5 heavyweight gjs per
        // package and oversubscribes CI's few cores. Verified: the faithful
        // `foreach build -tp --jobs 4` over @gjsify/* with a piped stdout
        // completes in ~83s under GJS (was a multi-hour hang).
        // …EXCEPT on macOS and Windows, where the order is inverted — and not
        // as a preference but as a capability. GJS is a GNOME-desktop host: on
        // those two platforms it is at best a Homebrew/MSYS afterthought, while
        // Node is what a developer already has. The tooling agrees:
        //
        //   - macOS: the only bundler engine under GJS is
        //     `@gjsify/rolldown-native` (npm `rolldown` is a Rust napi crate
        //     GJS cannot load), and it declares `linux-x64`/`linux-arm64` only.
        //     So the gjs branch cannot run `gjsify build`, nor any script that
        //     ends in one — it dies with "no usable bundler engine under GJS",
        //     whose own closing line is "Running the build under Node also
        //     works". Preferring gjs routed the user into a dead end the error
        //     message tells them to leave while the shim offered no way out.
        //     Measured on a cold macOS tree: root `build:infra` fails at the
        //     first `gjsify build --library` (`@gjsify/utils`) with the
        //     gjs-first shim and completes with this one.
        //   - Windows: there is no prebuilt `libgjs` at all (see
        //     `website/src/content/docs/platform-support.md`), so the gjs probe
        //     can never succeed. This also makes the `sh` shim — the git-bash /
        //     MSYS entry point — agree with the `.cmd`/`.ps1` companions
        //     {@link buildLauncherShims} already writes as Node-only, instead
        //     of leading with a branch that is dead by construction.
        //
        // The probe stays symmetric with the gjs one — `command -v node`, not a
        // bare file test — so a host carrying the bundle but no Node still
        // falls through to gjs and keeps every non-build command working. That
        // is what keeps GJS on these platforms supported-and-tested rather than
        // merely absent. Revert a platform to the shared gjs-first form once it
        // has a working engine (macOS: status/open-todos.md,
        // "@gjsify/rolldown-native's darwin-arm64 leg is PROVEN but not
        // promoted").
        const nodeFirstPlatform = platform === 'darwin' || platform === 'win32';
        const gjsFirst =
            `if command -v gjs >/dev/null 2>&1 && [ -f "${gjsAbs}" ]; then\n` +
            `${gjsPreamble}exec gjs -m "${gjsAbs}" "$@"\n` +
            `fi\n` +
            `exec node "${nodeAbs}" "$@"\n`;
        const nodeFirst =
            `if command -v node >/dev/null 2>&1 && [ -f "${nodeAbs}" ]; then\n` +
            `exec node "${nodeAbs}" "$@"\n` +
            `fi\n` +
            `${gjsPreamble}exec gjs -m "${gjsAbs}" "$@"\n`;
        return `#!/bin/sh\n` + (nodeFirstPlatform ? nodeFirst : gjsFirst);
    }
    if (nodeAbs) return `#!/bin/sh\nexec node "${nodeAbs}" "$@"\n`;
    if (gjsAbs) return `#!/bin/sh\n${gjsPreamble}exec gjs -m "${gjsAbs}" "$@"\n`;
    throw new Error('buildBinShim: either nodeTarget or gjsTarget must be provided');
}

/**
 * `.cmd` / `.ps1` companions for {@link buildBinShim}.
 *
 * The `sh` shim's gjs-first / node-fallback probe has no Windows counterpart to
 * express: there is no GJS host on Windows at all (no prebuilt `libgjs` — see
 * `website/src/content/docs/platform-support.md`), so a workspace that ships
 * both targets resolves to Node here, and a GJS-only workspace gets an honest
 * `gjs`-invoking shim that fails exactly the way the `sh` one does.
 *
 * Exported + platform-free so it is unit-tested from Linux.
 */
export function buildWorkspaceBinShimsForWindows(
    wsLocation: string,
    nodeTarget?: string,
    gjsTarget?: string,
    nativePrebuildDirs: string[] = [],
): { cmd: string; ps1: string } {
    const nodeAbs = nodeTarget ? join(wsLocation, nodeTarget) : null;
    const gjsAbs = gjsTarget ? join(wsLocation, gjsTarget) : null;
    if (nodeAbs) return buildLauncherShims({ interpreter: 'node', target: nodeAbs });
    if (gjsAbs) {
        // Windows has no dedicated library-path variable — LoadLibrary searches
        // PATH — so the prebuild dirs go there, `;`-separated (which is also
        // GLib's G_SEARCHPATH_SEPARATOR on Windows, hence the same join for
        // GI_TYPELIB_PATH).
        const joined = nativePrebuildDirs.join(';');
        return buildLauncherShims({
            interpreter: 'gjs',
            interpreterArgs: ['-m'],
            target: gjsAbs,
            prependEnv: nativePrebuildDirs.length === 0 ? {} : { GI_TYPELIB_PATH: joined, PATH: joined },
        });
    }
    throw new Error('buildWorkspaceBinShimsForWindows: either nodeTarget or gjsTarget must be provided');
}

/**
 * Walk a workspace's `bin` (Node) + `gjsify.bin` (GJS) declarations
 * into a unified `<binName> → {nodeTarget?, gjsTarget?}` map. The
 * shim built from this picks Node at runtime when its target exists,
 * GJS otherwise.
 */
function mergeWorkspaceBins(
    pkgName: string,
    gjsifyBin: string | Record<string, string> | undefined,
    nodeBin: string | Record<string, string> | undefined,
): Map<string, { nodeTarget?: string; gjsTarget?: string }> {
    const out = new Map<string, { nodeTarget?: string; gjsTarget?: string }>();
    const baseName = pkgName.startsWith('@') ? pkgName.slice(pkgName.indexOf('/') + 1) : pkgName;
    const get = (key: string) => {
        let entry = out.get(key);
        if (!entry) {
            entry = {};
            out.set(key, entry);
        }
        return entry;
    };
    if (typeof nodeBin === 'string') {
        get(baseName).nodeTarget = nodeBin;
    } else if (nodeBin && typeof nodeBin === 'object') {
        for (const [k, v] of Object.entries(nodeBin)) {
            if (typeof v === 'string' && v.length > 0) get(k).nodeTarget = v;
        }
    }
    if (typeof gjsifyBin === 'string') {
        get(baseName).gjsTarget = gjsifyBin;
    } else if (gjsifyBin && typeof gjsifyBin === 'object') {
        for (const [k, v] of Object.entries(gjsifyBin)) {
            if (typeof v === 'string' && v.length > 0) get(k).gjsTarget = v;
        }
    }
    return out;
}

async function projectInstallViaNpm(args: InstallOptions): Promise<void> {
    const npmArgs = ['install'];
    if (args['save-dev']) npmArgs.push('--save-dev');
    if (args['save-peer']) npmArgs.push('--save-peer');
    if (args['save-optional']) npmArgs.push('--save-optional');
    if (args.verbose) npmArgs.push('--loglevel', 'verbose');
    if (args.packages && args.packages.length > 0) {
        npmArgs.push(...args.packages);
    }
    await spawnNpm(npmArgs);
}

async function spawnNpm(npmArgs: string[]): Promise<void> {
    // `completion: 'return'` — the `--backend npm` branch of the handler
    // RETURNS after `runPostInstallChecks()` instead of exiting, so under GJS
    // this must not leave the main loop `spawn()` arms parked (see
    // utils/spawn.ts). The npm backend needs a Node host anyway, so the
    // blocking path costs nothing in practice.
    return spawnToCompletion('npm', npmArgs, {
        completion: 'return',
        notFound: () => new Error('npm not found on PATH — install Node.js first.'),
    })
        .then(({ code }) => {
            if (code !== 0) throw new Error(`npm install exited with code ${code}`);
        })
        .catch((err: Error) => {
            // A raw spawn failure still carries an errno `code`; the mapped
            // not-found hint and the non-zero-exit error do not, and already
            // read as finished sentences.
            const errno = (err as NodeJS.ErrnoException).code;
            console.error(errno === undefined ? err.message : `npm install failed: ${err.message}`);
            process.exit(1);
        });
}

async function installGlobalAndLink(specs: string[], opts: { verbose: boolean }): Promise<void> {
    const layout = defaultGlobalLayout();
    mkdirSync(layout.prefix, { recursive: true });

    console.log(`gjsify install --global  → ${layout.prefix}`);
    console.log(`                  bins → ${layout.binDir}`);

    // The global prefix is SHARED user-wide state — two concurrent
    // `gjsify install -g` runs (e.g. parallel agent sessions bootstrapping
    // tooling) used to interleave rm+extract on the same package dirs and
    // race the launcher writes in ~/.local/bin. Hold the prefix lock across
    // the install, the engine-package top-up AND the bin linking (ADR 0001).
    const lock = await acquireInstallLock(layout.prefix, {});
    try {
        const result = await installPackages({
            prefix: layout.prefix,
            specs,
            verbose: opts.verbose,
        });

        const packageNames = specs.map(specToPackageName);

        // A global GJS install of `@gjsify/cli` must also lay down the GJS-native
        // bundler engine (`@gjsify/rolldown-native`) + the sibling format/CSS
        // bridges. They are declared OPTIONAL peers of `@gjsify/cli` (so plain
        // `npm install @gjsify/cli` on Node doesn't force a linux prebuild), and
        // the native backend doesn't resolve peerDependencies at all — so without
        // this they'd never be installed, and `gjsify build` would hard-fail under
        // GJS ("no usable bundler engine"). Installed best-effort at the cli's
        // resolved version so they move in lockstep with the bundle; a platform
        // with no published prebuild degrades to a warning. Must run BEFORE
        // linkGlobalBins so the launcher's detectNativePackages() bakes the
        // engine's prebuild dirs into the wrapper's GI_TYPELIB_PATH/LD_LIBRARY_PATH.
        if (packageNames.includes('@gjsify/cli')) {
            const cliVersion = result.installed.find((r) => r.name === '@gjsify/cli')?.version ?? 'latest';
            await installGjsEnginePackages(layout.prefix, cliVersion, { verbose: opts.verbose });
        }

        const created = linkGlobalBins(packageNames, layout);
        reportLinkedBins(created, layout.binDir);
    } finally {
        lock.release();
    }
}

function reportLinkedBins(created: ReturnType<typeof linkGlobalBins>, binDir: string): void {
    if (created.length === 0) {
        console.warn('\nNo bins declared (neither `gjsify.bin` nor `bin` in package.json) — nothing was symlinked.');
    } else {
        console.log(`\nLinked ${created.length} bin(s):`);
        for (const e of created) {
            console.log(`  • ${e.link}  →  ${e.target}`);
        }
    }

    if (created.length > 0 && !binDirOnPath(binDir)) {
        console.warn(
            `\nNote: ${binDir} is not on your PATH.\n` +
                `Add it to your shell rc file:\n  export PATH="${binDir}:$PATH"`,
        );
    }
}

/**
 * Lay the GJS bundler engine down after a PROJECT install, when the host will
 * need it and does not have it. Closes #1005.
 *
 * The engine is an OPTIONAL PEER of `@gjsify/cli`, deliberately: a plain
 * `npm install @gjsify/cli` on Node/macOS/Windows must not fetch Linux
 * prebuilds. But nobody resolves it for a project — npm 7+ skips optional peers,
 * and the native backend does not resolve peerDependencies at all
 * (`install-backend-native.ts:76`). Under GJS there is no npm `rolldown`
 * fallback, so `gjsify build` simply cannot work. Every consumer in the
 * workspace independently discovered this and hand-declared the engine.
 *
 * Four conditions, and the second is the one worth reading:
 *
 *   (a) `@gjsify/cli` is in this tree — otherwise the engine has no caller.
 *   (b) THE HOST CAN RUN GJS, which is NOT the same question as `isGjs()`.
 *       `isGjs()` asks which runtime is executing the installer; the launcher
 *       (`bin-shim.ts:616`) prefers the GJS bundle whenever `command -v gjs`
 *       succeeds, so a tree installed BY NODE is routinely built BY GJS. Gating
 *       on the interpreter would reproduce #1005 for every contributor who
 *       installs on Node and builds through the shim. `runMinimalChecks()` above
 *       already probed for gjs, so this costs no extra spawn — and it goes
 *       nowhere near `which`.
 *   (c) No engine is already reachable — asked with the same walk the BUILD uses.
 *   (d) Not `--immutable`. A frozen install cannot acquire something its
 *       lockfile does not name without breaking the contract `--immutable`
 *       exists to hold, so that case warns and installs nothing.
 *
 * Deliberately NOT gated on `gjsify.app` or on "declares a build script":
 * neither of the failing consumers declares the former, and the latter would
 * mean pattern-matching script bodies — the hand-maintained judgement that
 * drifts, which ADR 0017 rejects by name.
 *
 * NOT recorded in the lockfile. `installPackages` writes one only under
 * `if (resolved && opts.lockfile)` and the default is falsy, so a consumer's
 * `gjsify-lock.json` is never rewritten by this. An e2e row pins that.
 *
 * Ordering is not a constraint here, unlike the global path (which must precede
 * `linkGlobalBins`): `buildNativeEnvPreamble` scans the prefix at LAUNCH time
 * (`bin-shim.ts:432-444`), so a shim written before the engine arrives still
 * exports its dir. `tests/e2e/global-install-engine/run.mjs:361-374` asserts
 * exactly that case.
 */
export interface EnsureProjectGjsEngineDeps {
    /** Project root. Defaults to `process.cwd()`. */
    cwd?: string;
    /** Injected so the decision is testable without a registry — the shape
     *  `installGjsEnginePackages` already uses for the same reason. */
    installFn?: (prefix: string, version: string, opts: { verbose?: boolean }) => Promise<void>;
    /** Injected so a host that HAS an engine can still exercise the missing branch. */
    hasEngineFn?: (dir: string) => boolean;
}

export async function ensureProjectGjsEngine(
    args: InstallOptions,
    gjsFound: boolean,
    deps: EnsureProjectGjsEngineDeps = {},
): Promise<void> {
    const cwd = deps.cwd ?? process.cwd();
    const hasEngine = deps.hasEngineFn ?? hasBundlerEngineInstalled;
    if (!existsSync(join(cwd, 'node_modules', '@gjsify', 'cli', 'package.json'))) return;
    if (!gjsFound) return;
    if (hasEngine(cwd)) return;

    if (args.immutable) {
        // Name the DURABLE fix, not a transient one: a frozen CI install cannot
        // be repaired by anything that happens at this moment, so the answer is
        // to put the engine in the lockfile.
        console.warn(
            `\nWarning: \`gjsify build\` will fail under GJS — ${BUNDLER_ENGINE_PACKAGE} is not installed, and\n` +
                '  --immutable cannot add it (the lockfile does not name it). Declare it so the lockfile carries it:\n' +
                `    gjsify install ${BUNDLER_ENGINE_PACKAGE}\n` +
                '  Under Node the npm `rolldown` engine is used instead and this does not apply.',
        );
        return;
    }

    const cliVersion = readCliVersionFrom(join(cwd, 'node_modules', '@gjsify', 'cli', 'package.json')) ?? 'latest';
    console.log(
        `\n${BUNDLER_ENGINE_PACKAGE} is missing and this host can run gjs, so \`gjsify build\` would have no\n` +
            `  bundler engine (there is no npm \`rolldown\` fallback under GJS). Installing the GJS engine set at\n` +
            `  ${cliVersion}, in lockstep with the CLI.`,
    );
    const install = deps.installFn ?? installGjsEnginePackages;
    await install(cwd, cliVersion, { verbose: args.verbose });
}

async function runPostInstallChecks(args: InstallOptions): Promise<void> {
    console.log('\n--- gjsify post-install checks ---');

    // 1. System deps that GJS apps typically need.
    const results = runMinimalChecks();
    const missing = results.filter((r) => !r.found && r.severity === 'required');
    if (missing.length > 0) {
        console.warn('Missing required system dependencies:\n');
        for (const dep of missing) {
            console.warn(`  ✗  ${dep.name}`);
        }
        const pm = detectPackageManager();
        const cmd = buildInstallCommand(pm, missing);
        if (cmd) console.warn(`\nInstall with:\n  ${cmd}`);
    } else {
        console.log('System dependencies OK.');
    }

    // 2. Close #1005 before reporting the prebuild set, so the report reflects
    //    what the tree ACTUALLY has rather than what it had a moment ago.
    await ensureProjectGjsEngine(args, results.find((r) => r.id === 'gjs')?.found ?? false);

    // 3. Surface @gjsify/* packages with native prebuilds — `gjsify run`
    //    will set LD_LIBRARY_PATH / GI_TYPELIB_PATH for these automatically.
    //    Runs AFTER step 2 on purpose: an engine installed a moment ago belongs
    //    in this list, and a consumer reading "Detected N …" needs it to be the
    //    tree's current state rather than its state on entry.
    const native = detectNativePackages(process.cwd());
    if (native.length > 0) {
        console.log(`\nDetected ${native.length} @gjsify/* package(s) with native prebuilds:`);
        for (const pkg of native) {
            console.log(`  • ${pkg.name}`);
        }
        console.log('\nUse `gjsify run <bundle>` to launch with LD_LIBRARY_PATH/GI_TYPELIB_PATH set.');
    }

    // 3. Install workspace git hooks (only fires inside the gjsify monorepo
    //    itself, NOT in consumer projects that depend on @gjsify/cli — gated
    //    by the presence of `scripts/install-git-hooks.mjs` + a `.git`
    //    checkout). Idempotent; safe to re-run on every install.
    maybeInstallGitHooks();
}

/**
 * Wire `core.hooksPath = .githooks` when running `gjsify install` inside a
 * git checkout that ships `scripts/install-git-hooks.mjs` (i.e. the gjsify
 * monorepo). Consumer projects that don't ship the script are skipped
 * silently — they wouldn't have hooks to install.
 *
 * The script itself handles its own no-op cases (extracted tarball, already
 * configured, SKIP_GJSIFY_HOOKS=1).
 */
function maybeInstallGitHooks(): void {
    const cwd = process.cwd();
    const scriptPath = join(cwd, 'scripts', 'install-git-hooks.mjs');
    if (!existsSync(scriptPath)) return;
    // Need a git checkout — the script also checks, but skipping here
    // avoids spawning a process when we know the answer.
    if (!existsSync(join(cwd, '.git'))) return;
    try {
        // `nodeBinary()`, NOT `process.execPath`: under the committed GJS bundle
        // `process.execPath` is `gjs`, so `spawnSync(process.execPath, [script])`
        // ran `gjs cli.gjs.mjs install-git-hooks.mjs` (wrong argv). The hook
        // installer is a plain Node ESM script; run it with a real node binary
        // (PATH `node` under GJS, the current node otherwise). Best-effort —
        // wrapped in try/catch, so a missing node just warns and continues.
        const result = spawnSync(nodeBinary(), [scriptPath, '--quiet'], {
            cwd,
            stdio: 'inherit',
            env: process.env,
        });
        if (result.status !== 0) {
            console.warn(
                `[gjsify install] scripts/install-git-hooks.mjs exited ${result.status} — git hooks may not be active.`,
            );
        }
    } catch (err) {
        // Hook installation is a quality-of-life touchup, not a hard install
        // requirement. Never let it abort the surrounding install.
        console.warn(
            `[gjsify install] git hook installation skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}
