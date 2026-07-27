// Utility to find npm packages with gjsify native prebuilds.
// Packages declare: "gjsify": { "prebuilds": "<dir>" } in their package.json,
// and (since the OS-axis audit) the `<os>-<arch>` targets they promise in
// "gjsify": { "platforms": [...] }.
//
// One algorithm — `detectNativePackages(startDir)` — walks up from `startDir`
// and exhaustively scans every `node_modules` it finds. Used by:
//   * `gjsify run`, `gjsify info`, `gjsify install` — startDir = process.cwd()
//   * `runGjsBundle()` — startDir = dirname(bundlePath), so DLX-cache layouts
//     (`~/.cache/gjsify/dlx/<sha>/.../node_modules/<pkg>/dist/bundle.js`) get
//     their full transitive prebuild set picked up automatically. The
//     transitive walk is what makes `gjsify showcase` / `gjsify dlx` work
//     for packages whose Vala typelibs live in *indirect* deps.
//
// PLATFORM RESOLUTION IS A PURE FUNCTION. Everything that depends on the host
// OS/CPU lives in `resolvePrebuildDirName()` / `buildNativeEnv()`, both of
// which take `platform` / `arch` as parameters instead of reading
// `process.platform` inline. That is what makes the darwin and win32 branches
// unit-testable from a Linux host (see `detect-native-packages.spec.ts`) —
// the host values are only read at the outermost call site, as a default.

import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readPackageJson } from './pkg-json.js';

export interface NativePackage {
    /** npm package name, e.g. "@gjsify/webgl" */
    name: string;
    /** Absolute path to the arch-specific prebuilds dir, e.g. "/…/@gjsify/webgl/prebuilds/linux-x64" */
    prebuildsDir: string;
}

/** The host target a resolution is performed for. Defaults to the running process. */
export interface HostTarget {
    /** `process.platform` value — `linux` | `darwin` | `win32` | … */
    platform?: string;
    /** `process.arch` value — `x64` | `arm64` | `ppc64` | `s390x` | `riscv64` | … */
    arch?: string;
}

/**
 * Environment a GJS process needs so `gi://Gjsify…` imports resolve against
 * the detected prebuilds. `GI_TYPELIB_PATH` is universal (girepository reads
 * it on every OS); the *library* search path is whatever the host's dynamic
 * loader actually consults, which is a different variable per OS — see
 * {@link buildNativeEnv}.
 *
 * The index signature exists for the Windows case, where the key is the host's
 * own `PATH` spelling (`Path` on a stock Windows env block) rather than a
 * fixed literal.
 */
export interface NativeEnv {
    GI_TYPELIB_PATH: string;
    /** ELF loader (Linux and other ELF platforms). */
    LD_LIBRARY_PATH?: string;
    /** Mach-O loader (macOS). `dyld` ignores `LD_LIBRARY_PATH` entirely. */
    DYLD_LIBRARY_PATH?: string;
    [key: string]: string | undefined;
}

/**
 * Map a Node `process.arch` value to the uname-style spelling the Vala/meson
 * bridges used to stage into (`prebuilds/linux-x86_64/`, the output of
 * `uname -m` on the build host).
 *
 * LEGACY. Every `@gjsify/*` package now declares and stages the node spelling
 * (`linux-x64`); this table exists only so the CLI can still load a prebuild
 * out of a tarball published before the rename. See
 * {@link prebuildDirCandidates}.
 */
const NODE_ARCH_TO_LEGACY_UNAME: Record<string, string> = {
    x64: 'x86_64',
    arm64: 'aarch64',
    arm: 'armv7',
    ia32: 'i686',
};

/**
 * Arch spellings that name the same target, folded onto the NODE spelling.
 * Mirrors `ARCH_ALIASES` in `scripts/audit-runtimes.mjs` — that script
 * canonicalises `package.json#gjsify.platforms` the same way for the
 * platform-support matrix, and the two MUST agree or a package could pass the
 * audit while the CLI fails to find its artifact.
 *
 * The direction matters: `${process.platform}-${process.arch}` is what a
 * running process can compute about itself, so folding *onto* it means the
 * host identity never has to be translated in the hot path.
 */
const ARCH_ALIASES: Record<string, string> = {
    x86_64: 'x64',
    amd64: 'x64',
    aarch64: 'arm64',
};

/**
 * Canonical `<os>-<arch>` form — the node spelling — so `linux-x86_64` and
 * `linux-x64` compare equal. Only the *arch* half is normalised; the OS half
 * is always a `process.platform` token (`linux`/`darwin`/`win32`), which has
 * no competing spelling.
 */
export function canonicalPlatformToken(token: string): string {
    const dash = token.indexOf('-');
    if (dash < 0) return token;
    const os = token.slice(0, dash);
    const arch = token.slice(dash + 1);
    return `${os}-${ARCH_ALIASES[arch] ?? arch}`;
}

/**
 * The prebuild directory names to probe for a host, most-specific first.
 *
 * The canonical name is `${process.platform}-${process.arch}` — `linux-x64`,
 * `linux-arm64`, `darwin-arm64`, `win32-x64`. Every package in the release
 * train declares it (`gjsify.platforms`), `scripts/stage-prebuild.mjs` is the
 * only thing that creates it, and `scripts/audit-runtimes.mjs --check` rejects
 * any other spelling, so the three can no longer drift.
 *
 * Two probes remain BEHIND that canonical name, and both are backward
 * compatibility with tarballs already on npm — not a second convention:
 *
 *   1. **The package's own declared spelling.** A tarball published before the
 *      rename declares (and ships) `linux-x86_64`; probing its declaration
 *      first loads it without the CLI having to guess. This is also what makes
 *      the rename work in the OTHER direction — an older CLI resolving a newer
 *      package — because `canonicalPlatformToken` folds both spellings onto
 *      one form at both ends.
 *   2. **The legacy uname spelling.** Only reachable for a package that ships
 *      a prebuild dir and declares NO `gjsify.platforms` at all — i.e. a
 *      tarball predating the OS-axis audit, or a third-party package using
 *      `gjsify.prebuilds` without the declaration. Inside this repo the audit
 *      makes that state impossible.
 *
 * Both are pure array entries matched against an already-read directory
 * listing — no extra I/O — so tolerance on the READ side costs nothing, while
 * the single spelling is enforced everywhere a name is WRITTEN.
 *
 * @param platform `process.platform` value.
 * @param arch `process.arch` value.
 * @param declaredPlatforms `package.json#gjsify.platforms`, when present.
 */
export function prebuildDirCandidates(
    platform: string,
    arch: string,
    declaredPlatforms?: readonly string[] | undefined,
): string[] {
    const canonical = `${platform}-${arch}`;
    const legacyArch = NODE_ARCH_TO_LEGACY_UNAME[arch] ?? arch;

    const out: string[] = [];
    const push = (name: string) => {
        if (!out.includes(name)) out.push(name);
    };

    // 1. The package's own declared spelling for THIS host, if it declares one.
    for (const declared of declaredPlatforms ?? []) {
        if (typeof declared !== 'string') continue;
        if (canonicalPlatformToken(declared) === canonical) push(declared);
    }
    // 2. The canonical node spelling — what everything in the train stages.
    push(canonical);
    // 3. The legacy uname spelling, for undeclared pre-rename tarballs.
    push(`${platform}-${legacyArch}`);

    return out;
}

/**
 * Pick the prebuild directory a host should load, given the directories that
 * actually exist under `<pkg>/<prebuilds>/`.
 *
 * Pure: no `process.*` reads, no filesystem access. This is the function the
 * darwin and win32 branches are unit-tested through on a Linux host.
 *
 * @returns the chosen directory NAME (not a path), or `null` when the package
 * ships nothing loadable on this host.
 */
export function resolvePrebuildDirName(input: {
    platform: string;
    arch: string;
    declaredPlatforms?: readonly string[] | undefined;
    existingDirs: readonly string[];
}): string | null {
    const { platform, arch, declaredPlatforms, existingDirs } = input;
    for (const candidate of prebuildDirCandidates(platform, arch, declaredPlatforms)) {
        if (existingDirs.includes(candidate)) return candidate;
    }
    return null;
}

/**
 * Scan all packages in a node_modules directory for gjsify native prebuilds.
 * Handles scoped packages (@scope/name) as well as flat packages.
 */
function scanNodeModules(nodeModulesDir: string, target: Required<HostTarget>): NativePackage[] {
    const results: NativePackage[] = [];
    if (!existsSync(nodeModulesDir)) return results;

    let entries: string[];
    try {
        entries = readdirSync(nodeModulesDir);
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (entry.startsWith('.')) continue;

        if (entry.startsWith('@')) {
            // Scoped packages — one more level deep
            const scopeDir = join(nodeModulesDir, entry);
            let scopeEntries: string[];
            try {
                scopeEntries = readdirSync(scopeDir);
            } catch {
                continue;
            }
            for (const scopedPkg of scopeEntries) {
                const pkgDir = join(scopeDir, scopedPkg);
                const native = checkPackage(pkgDir, `${entry}/${scopedPkg}`, target);
                if (native) results.push(native);
            }
        } else {
            const pkgDir = join(nodeModulesDir, entry);
            const native = checkPackage(pkgDir, entry, target);
            if (native) results.push(native);
        }
    }

    return results;
}

/** Check a single package directory for gjsify prebuilds metadata. */
function checkPackage(pkgDir: string, name: string, target: Required<HostTarget>): NativePackage | null {
    const pkgJson = readPackageJson(join(pkgDir, 'package.json'));
    if (!pkgJson) return null;

    const gjsifyMeta = pkgJson['gjsify'];
    if (!gjsifyMeta || typeof gjsifyMeta !== 'object') return null;

    const meta = gjsifyMeta as Record<string, unknown>;
    const prebuildsField = meta['prebuilds'];
    if (typeof prebuildsField !== 'string') return null;

    const declaredRaw = meta['platforms'];
    const declaredPlatforms = Array.isArray(declaredRaw)
        ? declaredRaw.filter((p): p is string => typeof p === 'string')
        : undefined;

    const prebuildsRoot = join(pkgDir, prebuildsField);
    let existingDirs: string[];
    try {
        // A prebuild dir may legitimately be a symlink (workspace/dev layouts),
        // so accept both real directories and links.
        existingDirs = readdirSync(prebuildsRoot, { withFileTypes: true })
            .filter((e) => e.isDirectory() || e.isSymbolicLink())
            .map((e) => e.name);
    } catch {
        return null;
    }

    const dirName = resolvePrebuildDirName({
        platform: target.platform,
        arch: target.arch,
        declaredPlatforms,
        existingDirs,
    });
    if (!dirName) return null;

    return { name, prebuildsDir: join(prebuildsRoot, dirName) };
}

/**
 * Walk up the directory tree from `startDir` and merge native packages found
 * in every `node_modules` encountered.
 *
 * We keep walking past the first node_modules because yarn v4 / pnpm hoisting
 * puts a project's direct deps in a local node_modules (often just `.cache/`
 * or a subset) while hoisted transitive deps live in a root `node_modules`
 * higher up. Node's own resolver also walks the chain — returning only the
 * first hit would miss root-hoisted native packages.
 *
 * Deduplication: the first match for a given package name wins (closer
 * node_modules shadows outer ones), matching Node.js resolution semantics.
 *
 * @param target overrides the host platform/arch. Only tests pass this; the
 * production call sites take the defaults.
 */
export function detectNativePackages(startDir: string, target: HostTarget = {}): NativePackage[] {
    const resolved: Required<HostTarget> = {
        platform: target.platform ?? process.platform,
        arch: target.arch ?? process.arch,
    };
    const merged: NativePackage[] = [];
    const seen = new Set<string>();
    let dir = resolve(startDir);

    while (true) {
        const nodeModulesDir = join(dir, 'node_modules');
        if (existsSync(nodeModulesDir)) {
            for (const pkg of scanNodeModules(nodeModulesDir, resolved)) {
                if (seen.has(pkg.name)) continue;
                seen.add(pkg.name);
                merged.push(pkg);
            }
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }

    return merged;
}

/**
 * The environment-variable name the host's dynamic loader consults for an
 * additional shared-library search path, plus the separator its search paths
 * use.
 *
 *   * **Linux / other ELF** — `LD_LIBRARY_PATH`, `:`-separated.
 *   * **macOS** — `DYLD_LIBRARY_PATH`. `dyld` does not read `LD_LIBRARY_PATH`
 *     at all, which is why `.github/workflows/napi.yml` sets `DYLD_LIBRARY_PATH`
 *     by hand on every macOS gate step.
 *   * **Windows** — there is no dedicated variable; `LoadLibrary` searches the
 *     process `PATH`, `;`-separated. This is the same mechanism
 *     `@gjsify/node-gi`'s `maybePrependGtkRuntimeDllPath()` uses to make its
 *     bundled GTK DLLs resolvable.
 */
export function libraryPathVar(platform: string): { name: string; separator: string } {
    if (platform === 'darwin') return { name: 'DYLD_LIBRARY_PATH', separator: ':' };
    if (platform === 'win32') return { name: 'PATH', separator: ';' };
    return { name: 'LD_LIBRARY_PATH', separator: ':' };
}

/**
 * Build the typelib + shared-library search-path environment for the detected
 * native packages. Prepends the new paths to any existing values.
 *
 * Pure w.r.t. the host: `platform` and `env` are parameters, so the darwin and
 * win32 branches are exercised by unit tests running on Linux.
 *
 * On Windows the `PATH` key is written back under the *host's own* spelling
 * (a stock Windows env block uses `Path`) — Windows env names are
 * case-insensitive, but a plain JS object is not, and `{...process.env,
 * PATH: …}` would hand a child process two competing entries.
 */
export function buildNativeEnv(
    packages: NativePackage[],
    opts: { platform?: string; env?: Record<string, string | undefined> } = {},
): NativeEnv {
    const platform = opts.platform ?? process.platform;
    const env = opts.env ?? process.env;
    const dirs = packages.map((p) => p.prebuildsDir);

    // GLib's search-path separator is `;` on Windows (G_SEARCHPATH_SEPARATOR),
    // `:` everywhere else — the same split as the loader variable below.
    const giSeparator = platform === 'win32' ? ';' : ':';
    const { name: libVarName, separator: libSeparator } = libraryPathVar(platform);

    // Windows env names are case-insensitive; reuse whatever casing the host
    // block already uses so we replace rather than shadow it.
    const libVarKey =
        platform === 'win32'
            ? (Object.keys(env).find((k) => k.toLowerCase() === libVarName.toLowerCase()) ?? libVarName)
            : libVarName;

    const prepend = (value: string | undefined, separator: string): string =>
        [...dirs, ...(value ? [value] : [])].join(separator);

    const out: NativeEnv = {
        GI_TYPELIB_PATH: prepend(env['GI_TYPELIB_PATH'], giSeparator),
    };
    out[libVarKey] = prepend(env[libVarKey], libSeparator);
    return out;
}
