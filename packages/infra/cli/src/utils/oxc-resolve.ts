// oxc (oxlint + oxfmt) resolution + spawn helpers.
//
// Replaces the former `biome-resolve.ts`. oxc ships its tools differently
// from Biome:
//
//   - The user-facing npm packages `oxlint` and `oxfmt` are thin Node ESM
//     launchers (`bin/oxlint` → `dist/cli.js`, `bin/oxfmt` → `dist/cli.js`).
//   - The actual native code lives in per-platform NAPI binding packages
//     (`@oxlint/binding-<target>`, `@oxfmt/binding-<target>`, e.g.
//     `@oxlint/binding-linux-x64-gnu`), declared as optionalDependencies of
//     the launcher package and loaded via napi-rs's `requireNative()`.
//
// Unlike Biome — whose per-platform package was a single self-contained Rust
// binary we could spawn directly, skipping its Node launcher — oxlint's JS
// plugin API (used by the internal `oxlint-plugin-gjsify` rule) lives in the
// JS launcher (`dist/cli.js`). The plugin host loads `.ts`/`.js` plugin files
// at runtime, so a configured plugin REQUIRES spawning oxlint through its Node
// launcher rather than calling a bare binary. We therefore resolve and spawn
// the package launcher with `node` for both tools — uniform and correct for
// the plugin case.
//
// Resolution order (workspace-aware) for each launcher:
//   1. Project's local node_modules (cwd)
//   2. Workspace root's node_modules (walk up via findWorkspaceRoot)
//   3. Parent dirs as a last resort
//   4. ENOENT → install hint
//
// We still reuse Biome's platform/arch/musl detection — it's used to name the
// expected NAPI binding package in the not-found install hint, so the user
// knows exactly which optionalDependency npm failed to place.
//
// NATIVE ENGINE (GJS) — `@gjsify/oxfmt-native`
// ────────────────────────────────────────────
// Under GJS the Node launcher path is a dead end: there is no Node host to
// spawn. For oxfmt the dual-engine pick mirrors `bundler-pick.ts`'s
// native/npm pattern exactly: `shouldUseNativeOxfmt()` prefers the
// `@gjsify/oxfmt-native` GI bridge (Vala/Rust prebuild wrapping the full
// pure-Rust oxfmt CLI — config resolution, ignore handling, file walking,
// --write/--check/--list-different) when running under GJS and the prebuild
// is loadable, and falls back to spawning the Node launcher otherwise.
// `GJSIFY_OXFMT=native|npm` is the explicit override (native throws when the
// prebuild isn't loadable instead of silently switching engines).
//
// oxlint has NO native path yet: its JS-plugin host (the internal
// `gjsify/register-class-order` rule wired via `.oxlintrc.json` jsPlugins)
// lives in the Node launcher, so a native oxlint bridge could only run the
// Rust rule subset. Lint stays Node-spawned until that trade-off is decided
// (tracked in status/open-todos.md).

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hostLibc } from './platform-check.js';
import { findWorkspaceRoot } from './workspace-root.js';
import { resolveNpmPackage } from './resolve-npm-package.js';
import { activateNativePrebuilds } from './gi-search-path.js';
import { nodeBinary } from './run-node.js';
import { spawnToCompletion } from './spawn.js';
import { isGjs, gjsExit } from '@gjsify/rolldown-plugin-gjsify/runtime';

export type OxcTool = 'oxlint' | 'oxfmt';

/**
 * Map Node.js `process.platform` + `arch` (+ musl on Linux) to the
 * napi-rs binding-package suffix oxc uses, e.g. `linux-x64-gnu`,
 * `linux-x64-musl`, `darwin-arm64`, `win32-x64-msvc`.
 *
 * Mirrors biome-resolve's platform detection (same musl probe), adapted to
 * oxc's napi-rs target naming (gnu/musl libc suffix on Linux, -msvc on
 * Windows).
 */
function oxcBindingSuffix(): string {
    const platform = process.platform;
    const arch = process.arch;

    let plat: string;
    if (platform === 'linux') plat = 'linux';
    else if (platform === 'darwin') plat = 'darwin';
    else if (platform === 'win32') plat = 'win32';
    else throw new Error(`[gjsify oxc] Unsupported platform: ${platform}`);

    let a: string;
    if (arch === 'x64') a = 'x64';
    else if (arch === 'arm64') a = 'arm64';
    else throw new Error(`[gjsify oxc] Unsupported arch on ${plat}: ${arch}`);

    if (plat === 'linux') {
        // musl detection on Linux — oxc ships separate musl/gnu bindings.
        //
        // ONE DEFINITION, in `platform-check.ts`. This used to be a local
        // `readdirSync('/lib')` scan for `ld-musl-*`, which is the same question
        // the install backend asks about a package's `libc` field — and the local
        // copy is the one that broke: its `readdirSync` was a lazy
        // `require('node:fs')`, a bare `require` in an ESM module, so it threw
        // ReferenceError, the surrounding catch swallowed it, and every host was
        // silently told to install the `-gnu` binding. `hostLibc()` is the shared
        // probe (ldd text → process.report → loader scan), memoized and unit-
        // tested with injected hosts, so a musl box gets the right answer here
        // and in the resolver from the same code.
        //
        // Vocabulary hop: npm spells the families `glibc`/`musl`, napi-rs target
        // triples spell them `gnu`/`musl`. An UNKNOWN libc maps to `gnu` — this
        // string only names a package in an install HINT, and gnu is the right
        // guess for the overwhelming majority of hosts we cannot probe.
        const libc = hostLibc('linux') === 'musl' ? 'musl' : 'gnu';
        return `${plat}-${a}-${libc}`;
    }

    if (plat === 'win32') return `${plat}-${a}-msvc`;
    // darwin
    return `${plat}-${a}`;
}

/** NAPI binding scope per tool: `@oxlint/binding-*` / `@oxfmt/binding-*`. */
function bindingPackageName(tool: OxcTool): string {
    const scope = tool === 'oxlint' ? '@oxlint' : '@oxfmt';
    return `${scope}/binding-${oxcBindingSuffix()}`;
}

/**
 * Search a starting directory's `node_modules/<pkg>/<relPath>` and return the
 * absolute path if it exists, else null.
 */
function probeNodeModules(dir: string, pkg: string, relPath: string): string | null {
    const candidate = join(dir, 'node_modules', pkg, relPath);
    return existsSync(candidate) ? candidate : null;
}

/**
 * Resolve the absolute path to a tool's Node ESM launcher
 * (`node_modules/<tool>/bin/<tool>`). Walks cwd → workspace-root → parents.
 *
 * Throws {@link OxcNotFoundError} with a clear install hint when not found.
 */
export function findOxcLauncher(tool: OxcTool, cwd: string = process.cwd()): string {
    const relPath = join('bin', tool);

    // 1. Local node_modules
    const local = probeNodeModules(cwd, tool, relPath);
    if (local) return local;

    // 2. Walk up to workspace root, probe its node_modules
    const wsRoot = findWorkspaceRoot(cwd);
    if (wsRoot && wsRoot !== cwd) {
        const fromRoot = probeNodeModules(wsRoot, tool, relPath);
        if (fromRoot) return fromRoot;
    }

    // 3. Walk parent dirs as a last resort (nested-without-workspace setups)
    let dir = resolve(cwd, '..');
    for (let i = 0; i < 6; i++) {
        const found = probeNodeModules(dir, tool, relPath);
        if (found) return found;
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }

    throw new OxcNotFoundError(tool, cwd);
}

export class OxcNotFoundError extends Error {
    constructor(
        public tool: OxcTool,
        public cwd: string,
        /**
         * The interpreter that could not be executed, when the LAUNCHER resolved
         * and the spawn still failed with `ENOENT`.
         *
         * Then the missing file is the interpreter, not the tool, and saying
         * "install <tool>" sends the user in a circle: on a Node-less GJS host
         * (postmarketOS/aarch64, gjs present, no node) `gjsify install -D oxlint`
         * succeeds, the launcher lands on disk, and the next run repeats the very
         * same advice. `spawnToCompletion`'s `notFound` fires for the COMMAND, and
         * the command here is `node` — never the launcher, which
         * {@link findOxcLauncher} already proved exists by not throwing.
         */
        public missingInterpreter?: string,
    ) {
        const binding = (() => {
            try {
                return bindingPackageName(tool);
            } catch {
                return `@${tool === 'oxlint' ? 'oxlint' : 'oxfmt'}/binding-<platform>`;
            }
        })();
        super(
            missingInterpreter === undefined
                ? `[gjsify oxc] ${tool} not found.\n` +
                      `  Expected: ${tool}/bin/${tool} in node_modules of ${cwd} or any workspace root above it.\n` +
                      `  Install it via: gjsify install -D ${tool}\n` +
                      `  (this adds ${tool} to devDependencies; the matching ${binding} ` +
                      `napi binding lands automatically as an optionalDependency.)`
                : `[gjsify oxc] cannot run ${tool}: no \`${missingInterpreter}\` binary on PATH.\n` +
                      `  ${tool} IS installed — its launcher was found. What is missing is the\n` +
                      `  interpreter that runs it: ${tool}'s launcher is a Node ESM script.\n` +
                      (tool === 'oxfmt'
                          ? `  For a Node-free formatter install the GI bridge:\n` +
                            `    gjsify install -D @gjsify/oxfmt-native\n` +
                            `  (\`gjsify format\`/\`fix\` then run oxfmt in-process under GJS.)`
                          : `  oxlint has no native GJS bridge yet — its JS-plugin host lives in the\n` +
                            `  Node launcher — so \`gjsify lint\` needs Node on the host for now.`),
        );
        this.name = 'OxcNotFoundError';
    }
}

/**
 * Walk up from a starting directory to find the nearest oxlint config
 * (`.oxlintrc.json`). Returns absolute path or null.
 */
export function findOxlintConfig(cwd: string = process.cwd()): string | null {
    return findConfigFile(cwd, ['.oxlintrc.json']);
}

/**
 * Walk up from a starting directory to find the nearest oxfmt config
 * (`.oxfmtrc` / `.oxfmtrc.json`). Returns absolute path or null.
 */
export function findOxfmtConfig(cwd: string = process.cwd()): string | null {
    return findConfigFile(cwd, ['.oxfmtrc', '.oxfmtrc.json']);
}

function findConfigFile(cwd: string, names: string[]): string | null {
    let dir = cwd;
    for (let i = 0; i < 12; i++) {
        for (const name of names) {
            const path = join(dir, name);
            if (existsSync(path)) return path;
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

export interface RunOxcOptions {
    cwd?: string;
    verbose?: boolean;
}

/** Surface of `@gjsify/oxfmt-native` that the CLI consumes. */
interface NativeOxfmtSurface {
    hasNativeOxfmt(): boolean;
    runOxfmt(args: string[]): number;
}

let _nativeOxfmtProbe: Promise<NativeOxfmtSurface | null> | null = null;

/**
 * Try to load `@gjsify/oxfmt-native` (GJS only). Same multi-anchor
 * resolution as `bundler-pick.ts`'s `tryLoadNative()` — GJS's native ESM
 * loader has no node_modules walker, so bare specifiers must be resolved
 * to a `file://` URL via createRequire/resolveNpmPackage first.
 */
async function tryLoadNativeOxfmt(): Promise<NativeOxfmtSurface | null> {
    if (_nativeOxfmtProbe) return _nativeOxfmtProbe;
    _nativeOxfmtProbe = (async (): Promise<NativeOxfmtSurface | null> => {
        if (!isGjs()) return null;
        try {
            // Same reason as `bundler-pick.ts`'s `tryLoadNative()`: put the
            // prebuild on girepository's own search paths so the bridge loads
            // without the `gjsify` launcher having exported anything. ADR 0021.
            activateNativePrebuilds();

            const specifier = '@gjsify/oxfmt-native';
            const resolved =
                resolveNpmPackage(specifier, { bundleUrl: import.meta.url }) ??
                createRequire(import.meta.url).resolve(specifier);
            const target = pathToFileURL(resolved).href;
            const mod = (await import(/* @vite-ignore */ target)) as NativeOxfmtSurface;
            if (!mod.hasNativeOxfmt()) return null;
            return mod;
        } catch {
            return null;
        }
    })();
    return _nativeOxfmtProbe;
}

/**
 * Engine pick for oxfmt — mirrors `bundler-pick.ts`'s `shouldUseNative()`:
 *   - `GJSIFY_OXFMT=npm` forces the Node launcher.
 *   - `GJSIFY_OXFMT=native` forces the GI bridge and throws when it is not
 *     loadable (instead of silently switching engines).
 *   - Default: native under GJS when loadable (the Node launcher cannot run
 *     without a Node host), npm launcher on Node.
 */
export async function shouldUseNativeOxfmt(): Promise<boolean> {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const choice = env.GJSIFY_OXFMT;

    if (choice === 'npm') return false;
    if (choice === 'native') {
        const native = await tryLoadNativeOxfmt();
        if (!native) {
            throw new Error(
                'GJSIFY_OXFMT=native but @gjsify/oxfmt-native is not loadable (no prebuild for this architecture, or not running under GJS).',
            );
        }
        return true;
    }

    if (!isGjs()) return false;
    return (await tryLoadNativeOxfmt()) !== null;
}

/**
 * Run an oxc tool (oxlint / oxfmt).
 *
 * oxfmt: dual-engine — under GJS the `@gjsify/oxfmt-native` GI bridge runs
 * the full oxfmt CLI in-process (Node-free); otherwise the npm Node ESM
 * launcher is spawned. `GJSIFY_OXFMT=native|npm` overrides the pick.
 *
 * oxlint: always spawned via its Node ESM launcher on a real Node host
 * (`nodeBinary()`: `process.execPath` under Node, PATH `node` under the GJS
 * bundle where `process.execPath` is the bundle itself) so the JS plugin host
 * is available — required for the `jsPlugins`-wired `gjsify/register-class-order`
 * rule. Under GJS a `node` on PATH is required (oxlint has no native bridge
 * yet); its absence surfaces as a clear OxcNotFoundError, never a hang.
 *
 * Inherits stdio so the tool's own output (diagnostics, reformatted files,
 * summary lines) reaches the user.
 *
 * Returns the exit code; never throws on non-zero exit (callers check it).
 */
export async function runOxc(tool: OxcTool, args: string[], opts: RunOxcOptions = {}): Promise<number> {
    if (tool === 'oxfmt' && (await shouldUseNativeOxfmt())) {
        const native = await tryLoadNativeOxfmt();
        if (!native) {
            // Unreachable: shouldUseNativeOxfmt() returned true above.
            throw new Error('@gjsify/oxfmt-native not loadable');
        }
        if (opts.verbose) {
            console.log(`[gjsify oxc] @gjsify/oxfmt-native (in-process) ${args.join(' ')}`);
        }
        // The native runner walks from the process working directory; the
        // command handlers always pass cwd = process.cwd(), so no chdir is
        // needed here.
        return native.runOxfmt(args);
    }
    return spawnOxcLauncher(tool, args, opts);
}

/**
 * Spawn an oxc tool via its Node ESM launcher (`node_modules/<tool>/bin/…`) on
 * a real Node host. CRITICAL: use `nodeBinary()`, not `process.execPath`
 * directly — under the committed GJS bundle `process.execPath` is the CLI
 * bundle path (`gjs`/the `.mjs`), so spawning it re-executes the CLI with the
 * launcher as its first positional (yargs prints top-level help) and the parent
 * hangs waiting on a child that never does the intended work. `nodeBinary()`
 * resolves to PATH `node` under GJS, so the launcher runs on Node as required.
 *
 * `completion: 'return'`: `lint` / `format` / `fix` hand the tool's exit code
 * to `setOxcExitCode`, which deliberately does NOT terminate the process on a
 * clean run — so under GJS this must take `spawnToCompletion`'s blocking path
 * (see `utils/spawn.ts`; the async one would leave the main loop `spawn()`
 * arms parked at 0% CPU on the way out). That path also captures and re-emits
 * the tool's stdout/stderr with a raised `maxBuffer`, which is exactly what a
 * full-workspace lint needs.
 */
function spawnOxcLauncher(tool: OxcTool, args: string[], opts: RunOxcOptions = {}): Promise<number> {
    const cwd = opts.cwd ?? process.cwd();
    const launcher = findOxcLauncher(tool, cwd);
    const node = nodeBinary();

    if (opts.verbose) {
        console.log(`[gjsify oxc] ${node} ${launcher} ${args.join(' ')}`);
    }

    return spawnToCompletion(node, [launcher, ...args], {
        completion: 'return',
        cwd,
        // ENOENT here is the COMMAND — `node` — not the launcher: `findOxcLauncher`
        // above already proved that exists by not throwing.
        notFound: () => new OxcNotFoundError(tool, cwd, node),
    }).then(({ code, signal }) => {
        if (signal !== null) {
            console.error(`[gjsify oxc] ${tool} terminated by signal ${signal}`);
            return 1;
        }
        return code ?? 0;
    });
}

/** Convenience wrappers. */
export function runOxlint(args: string[], opts: RunOxcOptions = {}): Promise<number> {
    return runOxc('oxlint', args, opts);
}

export function runOxfmt(args: string[], opts: RunOxcOptions = {}): Promise<number> {
    return runOxc('oxfmt', args, opts);
}

/**
 * Lazy-load the embedded `.oxlintrc.json` scaffold template. The
 * static-read-inliner matches this `readFileSync(new URL(<lit>,
 * import.meta.url), 'utf-8')` shape at build time and inlines the file into
 * the GJS bundle, so the template is available without runtime file I/O
 * against the install dir. (Same mechanism the old `loadBiomeTemplate()`
 * relied on — the shape must stay exactly this for the inliner to fire.)
 */
export function loadOxlintTemplate(): string {
    return readFileSync(new URL('../templates/oxlintrc.json.tmpl', import.meta.url), 'utf-8');
}

/** Lazy-load the embedded `.oxfmtrc` scaffold template (same inliner shape). */
export function loadOxfmtTemplate(): string {
    return readFileSync(new URL('../templates/oxfmtrc.tmpl', import.meta.url), 'utf-8');
}

/** Helper for callers to surface the install hint to the user cleanly. */
export function printOxcNotFound(err: OxcNotFoundError): void {
    console.error(err.message);
}

/**
 * Propagate an oxc tool's exit code from a command handler.
 *
 * On Node, setting `process.exitCode` is the gentle idiom (streams flush,
 * the process ends naturally). Under GJS there is no atexit hook, so
 * `process.exitCode` alone is NOT honored at natural shutdown — the gjs
 * process would exit 0 after a failed `--check`. Call `imports.system.exit`
 * directly for non-zero codes there: SpiderMonkey raises its uncatchable
 * exit exception from any context — including the yargs `parseAsync`
 * microtask continuation this runs in — and stdout writes are synchronous
 * under GJS, so the tool's report is already flushed. (`process.exit`'s
 * idle-scheduled path is NOT used here: the scheduled idle never fires from
 * this continuation — the module's top-level await is still pending and gjs
 * exits 0 before the hook-registered loop runs.)
 */
export function setOxcExitCode(code: number): void {
    process.exitCode = code;
    if (code === 0) return;
    gjsExit(code);
}

/**
 * Has the given oxc tool's npm package (or its companion) been declared in the
 * project's dependencies? Useful as a cheap pre-flight check — `gjsify flatpak
 * init`'s post-format hook uses this to decide whether to auto-format outputs.
 *
 * Checks for `oxfmt` by default (the formatter), since that is what the
 * post-format hook would invoke.
 */
export function hasOxcDevDep(cwd: string = process.cwd(), tool: OxcTool = 'oxfmt'): boolean {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return false;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return Boolean(pkg?.devDependencies?.[tool] || pkg?.dependencies?.[tool]);
    } catch {
        return false;
    }
}
