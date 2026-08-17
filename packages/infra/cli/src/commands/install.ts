// `gjsify install [pkg...]` — project install, `<pkg>` add, or `-g` user-global
// install (XDG prefix + GJS-runnable bin), plus gjsify-aware post-checks.
//
// All three modes route through `installPackagesNative`
// (`@gjsify/{semver,npm-registry,tar}`) — no Node/npm at runtime.
// `--backend=npm` / `GJSIFY_INSTALL_BACKEND=npm` is the escape hatch for what
// the native backend does not model (Yarn PnP, lifecycle scripts).
//
// A workspace install hoists every member's externals into the root
// `node_modules/` and symlinks `workspace:` refs to their source. Members with
// conflicting ranges of the same external still share ONE hoisted copy; the
// resolver warns naming both ranges, both requesters and the winner (per-member
// dedup is the open Phase D.8 item in status/open-todos.md).
//
// Concurrency (ADR 0001): every prefix mutation runs under a per-prefix
// cross-process lock (utils/install-lock.ts), so installs into different
// prefixes stay parallel. The shared XDG tarball/packument caches need no lock
// because their writes are atomic tmp+rename.

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
import { resolveHostPlatform } from '../utils/platform-check.js';
import { pruneAfterInstall } from '../utils/prune-prefix.js';
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
 * Windows cannot create a directory *symlink* without elevation or Developer
 * Mode (`EPERM`), but any user can create an NTFS junction — which is why npm
 * and yarn both use junctions for workspace links.
 */
const WORKSPACE_LINK_TYPE: 'junction' | undefined = process.platform === 'win32' ? 'junction' : undefined;

/**
 * The `target` argument for a workspace link.
 *
 * Node normalises a `'junction'` target with `path.resolve()` — against the
 * process CWD, not the link's own directory — so a junction must be given an
 * absolute path. POSIX symlinks stay relative so the tree survives a move.
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
    prune?: boolean;
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

// 30 min, not minutes: this monorepo (212+ members × 600+ externals) legitimately
// takes 10-20 min on a fresh CI install behind a slow npm CDN, so a tighter
// default would false-positive. The per-fetch timeout (30s, retried) catches the
// truly stuck case inside this budget.
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
            })
            .option('prune', {
                description:
                    'After installing, remove packages an earlier install left behind that this host cannot use (foreign os/cpu/libc). Use --no-prune to disable. Skipped automatically under --immutable, and whenever --os/--cpu/--libc is given: an install must never delete against a target the user typed.',
                type: 'boolean',
                default: true,
            }),
    handler: async (args) => {
        // Must run before anything resolves — `--os/--cpu/--libc/--force` are npm
        // config keys, see applyPlatformConfigFromFlags for why via the environment.
        applyPlatformConfigFromFlags(args);

        // --immutable rejects `<pkg>` adds and `--global` (no lockfile concept),
        // matching yarn, where `yarn add --immutable` is a hard error.
        if (args.immutable) {
            if (args.packages && args.packages.length > 0) {
                console.error(
                    'gjsify install --immutable does not accept package arguments. ' +
                        'Remove the package names or drop --immutable.',
                );
                // `return` — a bare `process.exit()` is deferred under GJS, and the
                // install would proceed past a refused flag combination. Same for
                // every `return process.exit()` below.
                return process.exit(1);
            }
            if (args.global) {
                console.error('gjsify install --immutable is incompatible with --global.');
                return process.exit(1);
            }
            if (args['refresh-lockfile']) {
                console.error(
                    'gjsify install --immutable is incompatible with --refresh-lockfile ' +
                        '(--immutable forbids rewriting the lockfile). Drop one.',
                );
                return process.exit(1);
            }
        }
        if (args.global) {
            if (!args.packages || args.packages.length === 0) {
                console.error('gjsify install --global requires at least one <pkg> argument.');
                return process.exit(1);
            }
            for (const flag of ['save-dev', 'save-peer', 'save-optional'] as const) {
                if (args[flag]) {
                    console.warn(
                        `gjsify install --global ignores --${flag}: global installs do not modify a project package.json.`,
                    );
                }
            }
            await installGlobalAndLink(args.packages, { verbose: args.verbose, prune: args.prune });
            return;
        }

        // Before the heavy install, so the skew is visible even if a later phase
        // is slow — it is the root cause the slow phase would otherwise mask.
        warnOnCliVersionSkew(process.cwd());

        const backend = args.backend ?? process.env.GJSIFY_INSTALL_BACKEND ?? 'native';

        if (backend === 'npm') {
            await projectInstallViaNpm(args);
            pruneProjectPrefix(args);
            await runPostInstallChecks(args);
            return;
        }

        // On timeout this controller aborts every in-flight registry fetch, so a
        // signal-aware await rejects and the process exits with an actionable
        // message.
        //
        // But the abort only rescues awaits that OBSERVE the signal, and some on
        // the fresh-resolve path do not — notably tarball extraction (a Gio-backed
        // decompress whose stream close-event can be dropped under GJS) and the
        // workspace symlink fs-pool. `hardExitTimerId` below is the backstop that
        // turns any residual never-settling await into a non-zero exit instead of a
        // silent 0%-CPU hang. `extractOne` also caps each extract with its own
        // stall timeout, so the common case fails long before either.
        const overallTimeoutMs = args.timeout > 0 ? args.timeout : 0;
        const overallController = overallTimeoutMs > 0 ? new AbortController() : null;
        const overallTimerId =
            overallController !== null
                ? setTimeout(() => overallController.abort(new Error('install-overall-timeout')), overallTimeoutMs)
                : null;
        // Long enough for a signal-aware reject to propagate through the catch (the
        // clean path), short enough that a wedged await does not hang for minutes.
        const HARD_EXIT_GRACE_MS = 10_000;
        const hardExitTimerId =
            overallTimeoutMs > 0
                ? setTimeout(() => {
                      const secs = Math.round(overallTimeoutMs / 100) / 10;
                      // Do NOT assert a cause here: this timer cannot tell the two
                      // shapes apart, and naming the rarer one sends the next reader
                      // after a bug that is not there. Extraction has multi-second
                      // SYNCHRONOUS stretches (tar parse + file writes) and 16 run
                      // concurrently, so a healthy install can miss the grace window
                      // with nothing wedged — measured: ~1.4 GB on a cold tree here.
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
        // Node keeps the loop up while a timer is armed, so `unref` lets the process
        // end the instant the install returns.
        (hardExitTimerId as { unref?: () => void } | null)?.unref?.();
        try {
            await projectInstallNative(args, overallController?.signal);
            pruneProjectPrefix(args);
            await runPostInstallChecks(args);
        } catch (err) {
            if (overallController !== null && overallController.signal.aborted && isAbortedFromOverallTimeout(err)) {
                const secs = Math.round(overallTimeoutMs / 100) / 10;
                console.error(
                    `gjsify install: timed out after ${secs}s — likely a registry slowdown or a wedged extract.\n` +
                        `Re-run, or override with --timeout <ms> (set --timeout 0 to disable the overall budget).`,
                );
                // `return` — the deferred GJS exit otherwise fell through into the
                // rethrow below and reported the timeout twice.
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
 * `os`, `cpu`, `libc` and `force` are npm CONFIG KEYS, and npm's transport for a
 * config key is the environment (`--libc=musl` ≡ `npm_config_libc=musl`), so the
 * flags come with the env spelling for free. Not threaded as a parameter because
 * one env write reaches EVERY prefix an invocation may install into (project,
 * workspace root, `-g`, the `dlx` cache) and is inherited by children, so a
 * nested install cannot quietly resolve for a different machine than its parent.
 *
 * Empty/whitespace values are ignored rather than written as the empty string —
 * `--os=` must not mean "the nameless platform", and `readPlatformOverrides`
 * drops them on the read side too.
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
 * Was this error raised because the overall-install AbortSignal fired? Matched
 * permissively on purpose: intermediate layers (fetch, GJS Soup, our own
 * `delay()`) re-wrap the `install-overall-timeout` reason in their own
 * AbortError instances.
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
 * Version of the `@gjsify/cli` that is ACTUALLY running: walks up from
 * `import.meta.url` to the nearest `@gjsify/cli` package.json, the same
 * discovery as `self-update`'s `readCurrentVersion`.
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
 * Version of the `@gjsify/cli` the workspace at `cwd` pins. Prefers the resolved
 * install, falling back to the in-repo source so the check also fires on a fresh,
 * not-yet-installed checkout of the gjsify monorepo itself.
 */
function readWorkspaceCliVersion(cwd: string): string | null {
    return (
        readCliVersionFrom(join(cwd, 'node_modules', CLI_PACKAGE_NAME, 'package.json')) ??
        readCliVersionFrom(join(cwd, 'packages', 'infra', 'cli', 'package.json'))
    );
}

/**
 * Warn (never block) when the running gjsify CLI differs from the `@gjsify/cli`
 * the workspace pins. A mismatched CLI is the measured root of two
 * hard-to-diagnose failures: install stalls (the lock is discarded → full fresh
 * resolve → wedge-prone extract) and silent-wrong-builds (stale bundle
 * semantics). Suppress with `GJSIFY_NO_VERSION_SKEW_WARNING=1`.
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
 * The specs handed to the backend are flat `"<name>@<range>"` strings, so the
 * kind has to travel beside them. It decides exactly one thing: an incompatible
 * `os`/`cpu`/`libc` skips an OPTIONAL dependency and fails a REQUIRED one (see
 * `NativeInstallOptions.optionalSpecs`).
 *
 * REQUIRED WINS ACROSS MANIFESTS, OPTIONAL WINS WITHIN ONE — two rules with two
 * reasons, neither a special case of the other:
 *   - Across manifests: one package can be a plain dependency of one member and
 *     an optionalDependency of another. Those are two real edges, and an edge
 *     that may not be missing must not be silently missed. Subtracting rather
 *     than "last block seen" also makes the answer order-independent.
 *   - Within one manifest: a name in BOTH blocks is OPTIONAL because npm says so
 *     ("entries in optionalDependencies will override entries of the same name
 *     in dependencies") — one edge, and the optional block names its kind.
 *     Treating it as required is the root-edge twin of the defect
 *     `requiredDepEntries` fixes: `optionalDependencies: { fsevents }` beside a
 *     `dependencies: { fsevents }` line failed every Linux install with
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
                // Overridden by THIS manifest's own optional block — not a required
                // edge, so it must not veto another manifest's optional declaration.
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

    // This is a node_modules-linker installer, and the two resolution strategies
    // cannot coexist: a leftover `.pnp.cjs` makes Node ignore the node_modules/
    // tree we write, leaving a silently broken project.
    //
    // Native PnP *generation* is out of scope on purpose — it would mean
    // replicating yarn's libzip-deterministic archives, SHA-512 cache keys,
    // cache-version tracking and virtual-locator synthesis, and would only ever
    // match one yarn release. Better to stop with actionable guidance.
    //
    // The error deliberately does NOT point at `GJSIFY_INSTALL_BACKEND=npm`: that
    // backend rejects `workspace:` specs (`EUNSUPPORTEDPROTOCOL`), which is exactly
    // what the repos reaching this branch have.
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

    // Workspace install (no args), from the root OR from any member — npm/yarn/pnpm
    // all resolve the monorepo root when you `install` inside a member. Without the
    // walk up, a child install treats the child as the root and tries to resolve
    // its `workspace:`/sibling deps from the registry.
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
        // Combine new specs with the existing manifest deps: resolving the new ones
        // alone would drop every previously-pinned lockfile entry. A new spec
        // overrides an existing dep of the same name.
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
    const progress = makeProgressReporter({
        enabled: !args.verbose && !args.quiet && args.progress !== false,
    });
    // Held across the install AND the manifest/lockfile sync that follows, so a
    // concurrent `gjsify install <pkg>` in the same project cannot interleave its
    // package.json / gjsify-lock.json writes with ours. `installPackages`
    // re-acquires the same lock re-entrantly.
    const lock = await acquireInstallLock(cwd, { signal });
    try {
        // Typed as NativeInstallOptions so the native-backend-only `optionalSpecs`
        // is CHECKED here instead of smuggled past an excess-property check;
        // `installPackages` forwards the object to that backend unchanged.
        const nativeOpts: NativeInstallOptions = {
            prefix: cwd,
            specs,
            verbose: args.verbose,
            // --immutable consumes the lockfile verbatim and must NOT rewrite it:
            // byte-stability under CI is the point.
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

        // Only the `gjsify install <pkg>...` add-a-dep flow mutates the manifest;
        // the no-args refresh must not.
        if (args.packages && args.packages.length > 0 && pkg) {
            const kind = depKindFromArgs(args);
            for (const spec of args.packages) {
                const { name, range } = parseSpec(spec);
                const installed = result.installed.find((r) => r.name === name);
                const finalRange = range ?? (installed ? defaultRangeFromVersion(installed.version) : 'latest');
                addDependencyEntry(pkg, name, finalRange, kind);
            }
            writePackageJson(pkgPath, pkg);

            // Re-sync `requested` with what `projectSpecsFromPackageJson()` returns
            // next time. Without this, `gjsify install foo` (bare name, lockfile
            // records `"foo"`) followed by `gjsify install --immutable` (reads
            // package.json → `"foo@^1.2.3"`) reports a spurious drift error.
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
        // Atomic tmp+rename: a torn gjsify-lock.json breaks the next `--immutable`.
        atomicWriteStrict(lockPath, JSON.stringify(lock, null, 2) + '\n');
    } catch {
        // Best-effort; a malformed lockfile is rewritten from scratch by the next
        // non-immutable install.
    }
}

/**
 * Workspace-aware install, mirroring `yarn install` at a monorepo root: discover
 * the members, aggregate their external (non-`workspace:`) deps, install them
 * ONCE at the root prefix, and symlink every workspace-named dep to the local
 * source so `import '@gjsify/utils'` resolves there.
 *
 * Hoisting is deliberately minimal — members with conflicting ranges of the same
 * dep share one hoisted copy and the resolver warns. Per-member dedup and nested
 * `node_modules/` are the open Phase D.8 item in status/open-todos.md.
 */
async function workspaceInstall(cwd: string, args: InstallOptions, signal?: AbortSignal): Promise<void> {
    // Held for the WHOLE flow: bin shims, workspace symlinks and the external
    // install all mutate the root node_modules/, and a second concurrent workspace
    // install interleaving its rm+symlink/extract steps corrupts both. The inner
    // `installPackages` calls re-acquire this lock re-entrantly, or take the
    // child-workspace lock for scoped overrides — always root→child, so there is
    // no lock-ordering cycle.
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
    // `"<name>@<range>"` → the members that declared it. Feeds the resolver's
    // version-conflict warning so it can attribute both sides of a conflict.
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
                // A dep whose NAME matches a local workspace is always satisfied by
                // that workspace, never by a same-named package on npm — whatever
                // the spec form (`workspace:`, `^1.2.3`, a dist-tag), because that
                // is what yarn/npm do. Routing one into the fetch/extract queue is a
                // DATA-LOSS bug: `extractOne` would `rmSync` the workspace's own
                // source tree and unpack the published tarball over it, and that
                // tarball ships only `files`, so `src/**` is wiped.
                const localWorkspace = byName.get(depName);
                if (localWorkspace) {
                    // Only an EXPLICIT out-of-workspace protocol opts out.
                    const explicitOverride = /^(link|file|portal|git\+|https?):/.test(spec);
                    if (!explicitOverride) {
                        symlinks.push({
                            fromWorkspaceName: ws.name,
                            depName,
                            targetLocation: localWorkspace.location,
                        });
                        continue;
                    }
                }
                if (spec.startsWith('workspace:')) {
                    // `workspace:` against a name that is not a discovered workspace
                    // is a hard error (typo / missing package).
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

    // EARLY, before the download/extract phase: the shims derive from workspace
    // manifests alone, while the heavy phase that follows can die mid-way (network,
    // timeout, crash). Writing them up front means a failed install can never leave
    // the workspace without its runner shim (`node_modules/.bin/gjsify`), and a
    // stale shim is refreshed even when a later phase aborts. Rewritten at the end
    // of this function so the GJS preamble reflects the installed tree.
    writeWorkspaceBinShims(cwd, workspaces);

    // Per-requester links (`<requester>/node_modules/<dep>`) plus a root hoist of
    // every workspace into `node_modules/<name>`, so transitive workspace deps
    // resolve by Node's parent-walk from any descendant. Idempotent, hence callable
    // more than once.
    const wireWorkspaceSymlinks = async (): Promise<void> => {
        // Bounded-concurrency async, because the sync version dominated the tail of
        // large installs: ~793 symlinks × ~10 ms of mkdir+rm+symlink is ~24 s of
        // serial syscalls, versus 1-2 s with a 32-wide pool.
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
            // One mkdir per unique parent — ~213 instead of ~793.
            await Promise.all([...parentDirs].map((dir) => fsp.mkdir(dir, { recursive: true })));
            // Bounded so a huge monorepo cannot blow up the fd table.
            const SYMLINK_CONCURRENCY = 32;
            let cursor = 0;
            const workers: Promise<void>[] = [];
            const wireOne = async (linkPath: string, relTarget: string) => {
                // Clear any prior entry of any shape — dir, file, broken or live
                // symlink; `{ recursive, force }` covers all of them.
                try {
                    await fsp.rm(linkPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                } catch {
                    /* the symlink call below surfaces the real cause if it persists */
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

        // Hoist EVERY workspace package to the root `node_modules/`, like yarn's
        // `nodeLinker: node-modules`, so the whole graph is reachable from any
        // descendant by parent-walk. Without it a member's `node_modules/` holds
        // only its declared deps, and an auto-injected register import for an
        // undeclared workspace package (auto-globals injection at build time, e.g.
        // `@gjsify/abort-controller/register`) externalises and the bundle fails at
        // runtime with `Module not found`.
        const rootBinDir = join(cwd, 'node_modules');
        let rootHoisted = 0;
        for (const ws of workspaces) {
            // The root workspace cannot symlink itself into its own node_modules.
            if (ws.location === cwd) continue;
            if (!ws.name) continue;
            const linkPath = join(rootBinDir, ws.name);
            // An existing symlink here (from the per-requester loop above) already
            // points at the right place. Deliberately not remove+recreate: under
            // GJS's Gio-backed fs polyfill `rmSync` on a symlink can race
            // `symlinkSync` and surface EEXIST. A real directory is left alone too —
            // npm or yarn seeded it and clobbering it is not ours to do.
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

    // EARLY too, for the same reason as the bin shims: these links point at local
    // source and never depend on the external download, but when they ran only at
    // the tail, an interrupted external fetch left the tree with NO workspace
    // symlinks, so cross-package imports failed to resolve even with every package
    // on disk. Safe here because `installPackages` only fetches NON-workspace names
    // (workspace-named deps are excluded from `externalSpecs`), and `extractOne`
    // only `rm`s the one external dest it is about to write.
    await wireWorkspaceSymlinks();

    // `overrides` (npm) / `resolutions` (yarn). Flat `name → range` entries apply to
    // every member; nested `<workspace> → {dep → range}` entries become
    // workspace-local installs, so a monorepo can pin one member to an older
    // `typescript` without dragging the rest of the tree along.
    const rootManifest = workspaces.find((w) => w.location === cwd)?.manifest as
        | { overrides?: unknown; resolutions?: unknown }
        | undefined;
    const extracted = extractOverrides(rootManifest);
    const overrides = extracted?.global;

    // Move specs carrying a workspace-scoped override out of `externalSpecs` into a
    // per-workspace map, so the root resolver never sees the conflicting versions.
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
                    const targetRange = override;
                    const wsKey = ws.location;
                    let bucket = wsLocalSpecs.get(wsKey);
                    if (!bucket) {
                        bucket = new Set<string>();
                        wsLocalSpecs.set(wsKey, bucket);
                    }
                    bucket.add(`${depName}@${targetRange}`);
                    // Only the EXACT `name@spec` this member declared is dropped from
                    // the root set; other members' instances of the same pair stay.
                    droppedFromExternal.add(`${depName}@${spec}`);
                }
            }
        }
        // Only drop a spec no OTHER member declared — otherwise it still has
        // legitimate root requesters.
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
            // Workspace-named packages are symlinked above; the backend must never
            // fetch a same-named published version over those symlinks (e.g. a
            // `types-dev/<lib>` workspace that also exists on npm and is pinned
            // transitively in the lockfile).
            workspaceNames: new Set(byName.keys()),
            specOrigins: new Map([...specOrigins].map(([k, v]) => [k, [...v]] as const)),
            // Aggregated over EVERY member, because the specs are: a name any member
            // declares as a plain dependency stays required.
            optionalSpecs: optionalDependencyNames(workspaces.map((w) => w.manifest as PackageJson)),
        };
        await installPackages(rootOpts);
    } else if (args.verbose) {
        console.log('gjsify install: no external deps to fetch');
    }

    // Scoped overrides, one `installPackages` per member: the resulting
    // `node_modules/<dep>` shadows the root-hoisted version by parent-walk.
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
            // A thin lockfile next to the member's package.json, same `--immutable`
            // semantics as the root install.
            lockfile: !args.immutable,
            frozen: args.immutable,
            signal,
            workspaceNames: new Set(byName.keys()),
            // Same aggregated answer as the root install: these specs are a SUBSET of
            // the root's, so classifying them differently would make one dep optional
            // at the root and required in a member.
            optionalSpecs: optionalDependencyNames(workspaces.map((w) => w.manifest as PackageJson)),
        };
        await installPackages(scopedOpts);
    }

    // A near no-op safety net in case a later step disturbed a link.
    await wireWorkspaceSymlinks();

    // Now that the tree is materialised, refresh the shims' GJS preamble with the
    // native prebuild dirs that only became discoverable after the install (on a
    // fresh checkout `detectNativePackages` finds nothing before extraction).
    // Running last also keeps workspace shims authoritative over any same-named
    // external bin the backend linked — yarn semantics: workspace bins win.
    const wsBinsCreated = writeWorkspaceBinShims(cwd, workspaces);
    if (wsBinsCreated > 0) {
        console.log(`gjsify install: linked ${wsBinsCreated} workspace bin(s) into node_modules/.bin/`);
    }
}

/**
 * (Re)write the shell shims for every workspace-declared bin into the root
 * `node_modules/.bin/`. Without them `npm run <script>` — or any
 * `node_modules/.bin`-on-PATH consumer — cannot find `gjsify` on a fresh
 * checkout; yarn writes these at install time and we match.
 *
 * `gjsify.bin` is preferred for the GJS target because it names the committed
 * `dist/cli.gjs.mjs` bundle, which exists on a fresh checkout, while `bin`
 * typically names `lib/index.js`, a build artifact that may not.
 *
 * IDEMPOTENT + UNCONDITIONAL: shims are derived artifacts, always regenerated,
 * never skipped for existing and never fatal for missing. `workspaceInstall`
 * calls this before AND after the download/extract phase.
 */
function writeWorkspaceBinShims(cwd: string, workspaces: ReturnType<typeof discoverWorkspaces>): number {
    const wsBinDir = join(cwd, 'node_modules', '.bin');
    // The shim invokes the CLI bundle via `gjs -m` directly, with no chance to set
    // env after the fact, so GI_TYPELIB_PATH / LD_LIBRARY_PATH have to be in its
    // preamble — otherwise `imports.gi.GjsifyTerminal` and friends fail and
    // process.stdout collapses to no-color, 80-col defaults.
    const nativePrebuildDirs = detectNativePackages(cwd).map((p) => p.prebuildsDir);
    let wsBinsCreated = 0;
    for (const ws of workspaces) {
        const m = ws.manifest as Record<string, unknown>;
        const gjsifyBin = (m.gjsify as { bin?: string | Record<string, string> } | undefined)?.bin;
        const nodeBin = m.bin as string | Record<string, string> | undefined;
        // Collect both the Node and GJS target per bin name when they exist; which
        // one the shim tries first is `buildBinShim`'s per-platform decision.
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
            // Windows executes neither an extension-less file nor a `#!` line, so the
            // sh shim above is reachable only from git-bash/MSYS/WSL. The
            // `.cmd`/`.ps1` companions are what cmd.exe and pwsh need, mirroring
            // npm's cmd-shim.
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
 * Result of extracting `overrides` + `resolutions` from the root manifest.
 *
 * - `global`: flat `depName → range`, applied to every member unless a scoped
 *   entry matches.
 * - `scoped`: `<scopeKey> → {depName → range}`, where scopeKey matches a member's
 *   `name` OR its `relativeLocation` — both accepted so users can write whichever
 *   reads better. A scoped entry triggers a workspace-local install, giving that
 *   member its own `node_modules/<dep>` instead of the hoisted root version.
 */
interface ExtractedOverrides {
    global: Record<string, string>;
    scoped: Map<string, Record<string, string>>;
}

/**
 * Flatten npm `overrides` / yarn `resolutions` into a bare name → range map,
 * accepting both `{ "typescript": "~5.9.2" }` and yarn's pattern form
 * `{ "typescript@*": "~5.9.2" }`.
 *
 * Pattern keys with a version glob are normalised to the bare name because the
 * resolver has no per-incoming-range scoping. npm's per-parent nested shape
 * (`"foo": { ".": "1.0", "bar": "2.0" }`) is warned about rather than
 * half-applied, since without per-parent support it would misbehave silently.
 *
 * Keys beginning with `_` are skipped — the in-the-wild convention for
 * documentation entries like `"_comment_typescript"`.
 */
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
                // Normalise pattern keys (`name@*`, `name@^range`) to the bare name,
                // preserving the leading `@` of a scoped package.
                let name = key;
                const atIdx = key.startsWith('@') ? key.indexOf('@', 1) : key.indexOf('@');
                if (atIdx > 0) name = key.slice(0, atIdx);
                global[name] = value;
                continue;
            }
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                // `<workspace> → {dep → range}`: npm's nested overrides shape and
                // yarn's resolutions selectors, collapsed to per-workspace level.
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

/** Scoped override for a workspace + dep, matched by name OR relative location. */
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

/**
 * Build the `sh` shim for one bin. Which interpreter it tries first is decided
 * per platform below; the probe is per-INVOCATION, not per-install, so the same
 * shim works before and after the workspace's `lib/` has been built.
 *
 * Both targets are absolute so the shim survives the different cwds consumers
 * (`yarn run`, `npm run`, a direct PATH invocation) call it from.
 */
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
    // Scoped to the gjs branch because Node ignores GI_TYPELIB_PATH.
    //
    // `scanRoot` is the INSTALL prefix (the tree holding `node_modules/.bin`), not
    // the workspace package dir: `buildNativeEnvPreamble` globs its `node_modules`
    // at LAUNCH time rather than embedding what was installed the day the shim was
    // written, so a later `gjsify install <x>-native` is picked up without a re-link.
    const gjsPreamble = buildNativeEnvPreamble(scanRoot, nativePrebuildDirs, { platform });
    if (nodeAbs && gjsAbs) {
        // GJS-FIRST by default: gjsify is a GJS-first toolchain that stays fully
        // runnable under Node. This is only safe because `gjsify run` dispatches a
        // single `gjsify <cmd>` IN-PROCESS under GJS (see cli-app.ts) instead of
        // spawning another gjs per script — the earlier gjs-first attempt chained ~5
        // heavyweight gjs per package and turned a ~83s build into a multi-hour hang
        // on CI's few cores.
        //
        // macOS and Windows invert the order. Windows is a capability limit: there is
        // no prebuilt `libgjs` at all (website/src/content/docs/platform-support.md),
        // so the gjs probe can never succeed, and leading with Node also makes the
        // `sh` shim agree with the Node-only `.cmd`/`.ps1` companions
        // {@link buildLauncherShims} writes. macOS is NOT: `@gjsify/rolldown-native`
        // now ships darwin-arm64 + darwin-x64 prebuilds, so the original reason (no
        // bundler engine under GJS there, npm `rolldown` being a Rust napi crate GJS
        // cannot load) has expired, and only the "Homebrew gjs is an afterthought"
        // preference is left holding `darwin` in this branch.
        //
        // The Node probe stays symmetric with the gjs one — `command -v node`, not a
        // bare file test — so a host carrying the bundle but no Node still falls
        // through to gjs and keeps every non-build command working.
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
 * There is no GJS host on Windows at all (no prebuilt `libgjs` — see
 * `website/src/content/docs/platform-support.md`), so a workspace shipping both
 * targets resolves to Node here, and a GJS-only workspace gets an honest
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
        // Windows has no dedicated library-path variable — LoadLibrary searches PATH
        // — so the prebuild dirs go there, `;`-separated, which is also GLib's
        // G_SEARCHPATH_SEPARATOR on Windows, hence the same join for GI_TYPELIB_PATH.
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
 * Merge a workspace's `bin` (Node) and `gjsify.bin` (GJS) declarations into one
 * `<binName> → {nodeTarget?, gjsTarget?}` map for {@link buildBinShim}.
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
    // `completion: 'return'` — the `--backend npm` branch RETURNS after
    // `runPostInstallChecks()` instead of exiting, so under GJS it must not leave the
    // main loop arms `spawn()` parks (see utils/spawn.ts). The npm backend needs a
    // Node host anyway, so the blocking path costs nothing here.
    return spawnToCompletion('npm', npmArgs, {
        completion: 'return',
        notFound: () => new Error('npm not found on PATH — install Node.js first.'),
    })
        .then(({ code }) => {
            if (code !== 0) throw new Error(`npm install exited with code ${code}`);
        })
        .catch((err: Error) => {
            // A raw spawn failure still carries an errno `code`; the mapped not-found
            // hint and the non-zero-exit error do not, and already read as sentences.
            const errno = (err as NodeJS.ErrnoException).code;
            console.error(errno === undefined ? err.message : `npm install failed: ${err.message}`);
            process.exit(1);
        });
}

async function installGlobalAndLink(specs: string[], opts: { verbose: boolean; prune?: boolean }): Promise<void> {
    const layout = defaultGlobalLayout();
    mkdirSync(layout.prefix, { recursive: true });

    console.log(`gjsify install --global  → ${layout.prefix}`);
    console.log(`                  bins → ${layout.binDir}`);

    // The global prefix is SHARED user-wide state: two concurrent `gjsify install -g`
    // runs interleaved rm+extract on the same package dirs and raced the launcher
    // writes in ~/.local/bin. The lock spans the install, the engine top-up AND the
    // bin linking (ADR 0001).
    const lock = await acquireInstallLock(layout.prefix, {});
    try {
        const result = await installPackages({
            prefix: layout.prefix,
            specs,
            verbose: opts.verbose,
        });

        const packageNames = specs.map(specToPackageName);

        // A global install of `@gjsify/cli` must also lay down the GJS bundler engine
        // + the sibling format/CSS bridges. They are OPTIONAL PEERS of the CLI (so a
        // plain `npm install @gjsify/cli` on Node does not force a prebuild) and the
        // native backend does not resolve peerDependencies at all, so without this
        // they never arrive and `gjsify build` hard-fails under GJS with "no usable
        // bundler engine". Pinned to the CLI's resolved version so they move in
        // lockstep with the bundle; a platform with no published prebuild warns.
        //
        // Must run BEFORE linkGlobalBins, so the launcher's detectNativePackages()
        // bakes the engine's prebuild dirs into GI_TYPELIB_PATH/LD_LIBRARY_PATH.
        if (packageNames.includes('@gjsify/cli')) {
            const cliVersion = result.installed.find((r) => r.name === '@gjsify/cli')?.version ?? 'latest';
            await installGjsEnginePackages(layout.prefix, cliVersion, { verbose: opts.verbose });
        }

        // Before the LINK on purpose: `linkGlobalBins`' launchers bake the resolved
        // prebuild directories into GI_TYPELIB_PATH/LD_LIBRARY_PATH, and must not name
        // a directory this pass is about to delete.
        if (opts.prune !== false) {
            pruneAfterInstall(layout.prefix, resolveHostPlatform({ env: {} }), {
                hint: 'gjsify prune -g --dry-run',
            });
        }

        const created = linkGlobalBins(packageNames, layout);
        reportLinkedBins(created, layout.binDir);
    } finally {
        lock.release();
    }
}

/**
 * The automatic pass for a PROJECT prefix.
 *
 * Hooked at the command level rather than inside `installPackages`, so `dlx`'s
 * throwaway cache prefix — created, used once and dropped — pays nothing for it.
 */
function pruneProjectPrefix(args: InstallOptions): void {
    if (args.prune === false) return;
    pruneAfterInstall(process.cwd(), resolveHostPlatform({ env: {} }), {
        immutable: args.immutable === true,
        hint: 'gjsify prune --dry-run',
    });
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

export interface EnsureProjectGjsEngineDeps {
    /** Project root. Defaults to `process.cwd()`. */
    cwd?: string;
    /** Injected so the decision is testable without a registry — the shape
     *  `installGjsEnginePackages` already uses for the same reason. */
    installFn?: (prefix: string, version: string, opts: { verbose?: boolean }) => Promise<void>;
    /** Injected so a host that HAS an engine can still exercise the missing branch. */
    hasEngineFn?: (dir: string) => boolean;
}

/**
 * Lay the GJS bundler engine down after a PROJECT install, when the host will need
 * it and does not have it (#1005).
 *
 * The engine is an OPTIONAL PEER of `@gjsify/cli` on purpose — a plain
 * `npm install @gjsify/cli` on Node must not fetch prebuilds — but nobody resolves
 * it for a project: npm 7+ skips optional peers and the native backend does not
 * resolve `peerDependencies` at all. Under GJS there is no npm `rolldown`
 * fallback, so `gjsify build` had nothing to load.
 *
 * Four conditions, and (b) is the one worth reading:
 *
 *   (a) `@gjsify/cli` is in this tree — otherwise the engine has no caller.
 *   (b) THE HOST CAN RUN GJS, which is NOT the `isGjs()` question. `isGjs()` asks
 *       which runtime is executing the installer, but the launcher prefers the GJS
 *       bundle whenever `command -v gjs` succeeds, so a tree installed BY NODE is
 *       routinely built BY GJS. Gating on the interpreter reproduces #1005 for
 *       every contributor who installs on Node and builds through the shim.
 *       `runMinimalChecks()` already probed for gjs, so this costs no extra spawn.
 *   (c) No engine is already reachable — asked with the same walk the BUILD uses.
 *   (d) Not `--immutable`: a frozen install cannot acquire what its lockfile does
 *       not name, so that case warns and installs nothing.
 *
 * NOT gated on `gjsify.app` or on "declares a build script": neither failing
 * consumer declares the former, and the latter means pattern-matching script
 * bodies, the drifting hand-maintained judgement ADR 0017 rejects by name.
 * ADR 0020 records the simpler `optionalDependencies` shape that would retire
 * this policy entirely.
 *
 * NOT recorded in the lockfile — `installPackages` writes one only when both
 * `resolved` and `opts.lockfile` hold — so a consumer's `gjsify-lock.json` is
 * never rewritten by this; an e2e row pins it. Ordering is free here, unlike the
 * global path: `buildNativeEnvPreamble` scans the prefix at LAUNCH time, so a shim
 * written before the engine arrives still exports its dir
 * (`tests/e2e/global-install-engine/`).
 */
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
        // Name the DURABLE fix: a frozen CI install cannot be repaired by anything
        // happening now, so the answer is to put the engine in the lockfile.
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

    // Before the prebuild report, so the report reflects what the tree ACTUALLY has:
    // an engine installed a moment ago belongs in the "Detected N …" list.
    await ensureProjectGjsEngine(args, results.find((r) => r.id === 'gjs')?.found ?? false);

    const native = detectNativePackages(process.cwd());
    if (native.length > 0) {
        console.log(`\nDetected ${native.length} @gjsify/* package(s) with native prebuilds:`);
        for (const pkg of native) {
            console.log(`  • ${pkg.name}`);
        }
        console.log('\nUse `gjsify run <bundle>` to launch with LD_LIBRARY_PATH/GI_TYPELIB_PATH set.');
    }

    maybeInstallGitHooks();
}

/**
 * Wire `core.hooksPath = .githooks` when `gjsify install` runs inside a git
 * checkout that ships `scripts/install-git-hooks.mjs` — i.e. the gjsify monorepo
 * and not a consumer project, which has no hooks to install. Idempotent; the
 * script handles its own no-op cases (extracted tarball, already configured,
 * `SKIP_GJSIFY_HOOKS=1`).
 */
function maybeInstallGitHooks(): void {
    const cwd = process.cwd();
    const scriptPath = join(cwd, 'scripts', 'install-git-hooks.mjs');
    if (!existsSync(scriptPath)) return;
    // The script also checks, but skipping here avoids a spawn.
    if (!existsSync(join(cwd, '.git'))) return;
    try {
        // `nodeBinary()`, NOT `process.execPath`: under the committed GJS bundle
        // `process.execPath` is `gjs`, so `spawnSync(process.execPath, [script])` ran
        // `gjs cli.gjs.mjs install-git-hooks.mjs` — wrong argv. The hook installer is
        // a plain Node ESM script and needs a real node binary.
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
        // A quality-of-life touchup, not an install requirement — never let it abort
        // the surrounding install.
        console.warn(
            `[gjsify install] git hook installation skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}
