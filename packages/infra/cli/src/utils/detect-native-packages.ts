// Utility to find npm packages with gjsify native prebuilds.
// Packages declare: "gjsify": { "prebuilds": "<dir>" } in their package.json,
// and (since the OS-axis audit) the `<os>-<arch>[-musl]` targets they promise in
// "gjsify": { "platforms": [...] }. The libc half of that token is the newest
// axis; which libc a package's artifacts actually NEED is a separate, measured
// claim (npm's `libc` field + `gjsify.glibcRequires`, held to the binaries by the
// `prebuild-libc` conformance rule) — this file only resolves DIRECTORIES.
//
// TWO passes, and the second one exists because the first cannot see an isolated
// (pnpm-style) layout: `detectNativePackages(startDir)` walks up from `startDir`
// and exhaustively scans every `node_modules` it finds, then resolves any package
// that DECLARED a prebuild without shipping one through its per-platform
// companion package (`<name>-<token>`), searching from THAT package's own
// directory. See `resolvePlatformSibling`. Used by:
//   * `gjsify run`, `gjsify info`, `gjsify install` — startDir = process.cwd()
//   * `runGjsBundle()` — startDir = dirname(bundlePath), so DLX-cache layouts
//     (`~/.cache/gjsify/dlx/<sha>/.../node_modules/<pkg>/dist/bundle.js`) get
//     their full transitive prebuild set picked up automatically. The
//     transitive walk is what makes `gjsify showcase` / `gjsify dlx` work
//     for packages whose Vala typelibs live in *indirect* deps.
//
// PLATFORM RESOLUTION IS A PURE FUNCTION. Everything that depends on the host
// OS/CPU/libc lives in `resolvePrebuildDirName()` / `buildNativeEnv()` /
// `resolveHostLibc()`, all of which take `platform` / `arch` / `libc` as
// parameters instead of reading `process.platform` inline. That is what makes
// the darwin, win32 AND musl branches unit-testable from a glibc Linux host
// (see `detect-native-packages.spec.ts`) — the host values are only read at the
// outermost call site, as a default.

import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readPackageJson } from './pkg-json.js';

export interface NativePackage {
    /** npm package name, e.g. "@gjsify/webgl" */
    name: string;
    /** Absolute path to the arch-specific prebuilds dir, e.g. "/…/@gjsify/webgl/prebuilds/linux-x64" */
    prebuildsDir: string;
}

/**
 * Which C library an artifact is built against. npm's own `libc` manifest field
 * uses exactly these two tokens, and it is LINUX-ONLY there — every other OS has
 * one C library, so the axis does not exist off Linux and is `null` there rather
 * than defaulted to something.
 */
export type HostLibc = 'glibc' | 'musl';

/** The host target a resolution is performed for. Defaults to the running process. */
export interface HostTarget {
    /** `process.platform` value — `linux` | `darwin` | `win32` | … */
    platform?: string;
    /** `process.arch` value — `x64` | `arm64` | `ppc64` | `s390x` | `riscv64` | … */
    arch?: string;
    /**
     * Host C library, or `undefined`/`null` when the axis does not apply (any
     * non-Linux OS) or could not be determined. Both non-values mean the same
     * thing to the resolver: behave exactly as before the libc axis existed —
     * never offer a `-musl` directory. That is deliberately the conservative
     * direction: an unsuffixed directory is the DEFAULT build, so a host we
     * cannot classify still resolves what it always did.
     */
    libc?: HostLibc | null;
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
 * Mirrors `ARCH_ALIASES` in `packages/infra/manifest-conformance/lib/platforms.mjs`
 * — the table `scripts/audit-runtimes.mjs` canonicalises
 * `package.json#gjsify.platforms` through for the platform-support matrix and the
 * prebuild rules. The two MUST agree or a package could pass the audit while the
 * CLI fails to find its artifact.
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
 * The libc suffix a prebuild target may carry. Only ONE value is spelled out,
 * and that asymmetry is the whole design of the grammar — see
 * {@link canonicalPlatformToken}.
 */
const MUSL_SUFFIX = '-musl';

/**
 * Split a prebuild target into its three axes.
 *
 * TOKEN GRAMMAR: `<os>-<arch>[-musl]`.
 *
 * An UNSUFFIXED token means "the default build". Note what it does NOT mean: it
 * is not a synonym for glibc. For an artifact that links `libc.so.6` the default
 * build IS glibc; for one that links only GLib/GObject/GIO (plus GnuTLS resp.
 * GStreamer) it is libc-AGNOSTIC and loads against whatever libc the host's GLib
 * was built for. The directory name cannot express that difference and does not
 * need to: the package's own `libc` field answers it at install time, and the
 * `prebuild-libc` conformance rule verifies that field against the binaries
 * (`readElfNeeded` — the DT_NEEDED list is where the answer actually lives).
 *
 * DELIBERATELY NOT CHOSEN: renaming every existing `linux-<arch>` directory to
 * `linux-<arch>-gnu`, which is what a symmetric grammar would demand. It would
 * rename ~60 COMMITTED directories, and — per `status/open-todos.md`'s
 * "Nine fixtures re-implement the prebuild-target name instead of importing it"
 * — nine e2e fixtures COMPOSE the token themselves instead of importing it, so
 * the rename would have to be swept by hand in two shapes (the literal path and
 * the computed one), which is exactly how the last vocabulary change missed
 * `tests/e2e/self-host/run.mjs`. The asymmetric grammar buys the same
 * expressiveness for zero renames, and the cost — that "unsuffixed" is not
 * self-describing — is paid by a field that is machine-checked anyway.
 *
 * A `-musl` suffix is only meaningful when the OS half is `linux`: musl targets
 * no other kernel, and npm's own `libc` field is documented as Linux-only. A
 * `darwin-arm64-musl` token is therefore not a target with an odd name, it is a
 * malformed one, and this returns `libc: null` for it so callers report the
 * token rather than half-honouring it.
 */
export function parsePlatformToken(token: string): { os: string; arch: string; libc: HostLibc | null } {
    const isMusl = token.endsWith(MUSL_SUFFIX);
    const base = isMusl ? token.slice(0, -MUSL_SUFFIX.length) : token;
    const dash = base.indexOf('-');
    const os = dash < 0 ? base : base.slice(0, dash);
    const arch = dash < 0 ? '' : base.slice(dash + 1);
    return { os, arch, libc: isMusl && os === 'linux' ? 'musl' : null };
}

/**
 * Canonical `<os>-<arch>[-musl]` form — the node spelling — so `linux-x86_64`
 * and `linux-x64` compare equal. Only the *arch* half is normalised: the OS half
 * is always a `process.platform` token (`linux`/`darwin`/`win32`), which has no
 * competing spelling, and the libc half has exactly one spelling by
 * construction.
 *
 * A `-musl` suffix on a non-Linux token is preserved verbatim rather than
 * dropped. Silently canonicalising `darwin-arm64-musl` to `darwin-arm64` would
 * make a malformed declaration compare EQUAL to a valid one, so the audit that
 * rejects it would never see it — the same class of bug as folding the legacy
 * uname spelling on a WRITE path.
 */
export function canonicalPlatformToken(token: string): string {
    const { os, arch, libc } = parsePlatformToken(token);
    if (!arch) return token;
    const canonical = `${os}-${ARCH_ALIASES[arch] ?? arch}`;
    if (libc === 'musl') return `${canonical}${MUSL_SUFFIX}`;
    // Not a Linux musl token, so `-musl` (if present at all) is not a libc
    // suffix this grammar recognises — keep the token intact.
    return token.endsWith(MUSL_SUFFIX) ? `${canonical}${MUSL_SUFFIX}` : canonical;
}

/**
 * The target tokens that describe THIS host, most-specific first — the WRITE-side
 * vocabulary.
 *
 * This is the single definition of the musl preference order, and three callers
 * share it so it cannot drift: the directory probe ({@link prebuildDirCandidates}),
 * the per-platform sibling package probe ({@link platformPackageName}), and
 * `scripts/stage-prebuild.mjs`, which must stage a musl build into
 * `linux-x64-musl/` and never into `linux-x64/`.
 *
 * On a musl host the suffixed token comes FIRST and the unsuffixed one stays as a
 * fallback: an unsuffixed directory is the default build, which for the
 * libc-agnostic bridges (they record no `libc.so.6` at all) genuinely does load
 * on musl. On glibc the `-musl` token is not offered at all — a musl artifact
 * cannot load against glibc, so probing for it could only ever produce a
 * false positive.
 *
 * @param platform `process.platform` value.
 * @param arch `process.arch` value.
 * @param libc host C library; `undefined`/`null` behaves as glibc (see
 *   {@link HostTarget.libc} for why that is the safe default).
 */
export function hostPlatformTokens(platform: string, arch: string, libc?: HostLibc | null): string[] {
    const canonical = `${platform}-${arch}`;
    // The suffix is Linux-only by construction, so a `libc: 'musl'` handed in
    // for darwin/win32 is ignored rather than trusted — the caller's host facts
    // do not get to invent a target the grammar does not have.
    if (libc === 'musl' && platform === 'linux') return [`${canonical}${MUSL_SUFFIX}`, canonical];
    return [canonical];
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
 * The LIBC AXIS rides in front of all of that: on a musl host the
 * `<os>-<arch>-musl` token is preferred over `<os>-<arch>`, and on glibc the
 * suffixed token is NEVER offered (a musl artifact cannot load against glibc, so
 * a probe for it can only produce a false positive). The `libc` value is a
 * PARAMETER rather than a `process` read for the same reason `platform` and
 * `arch` are: it is the only way the musl branch gets exercised at all, since CI
 * and every developer machine here run glibc.
 *
 * @param platform `process.platform` value.
 * @param arch `process.arch` value.
 * @param declaredPlatforms `package.json#gjsify.platforms`, when present.
 * @param libc host C library; `undefined`/`null` = behave as before the axis
 *   existed.
 */
export function prebuildDirCandidates(
    platform: string,
    arch: string,
    declaredPlatforms?: readonly string[] | undefined,
    libc?: HostLibc | null,
): string[] {
    const hostTokens = hostPlatformTokens(platform, arch, libc);
    const legacyArch = NODE_ARCH_TO_LEGACY_UNAME[arch] ?? arch;

    const out: string[] = [];
    const push = (name: string) => {
        if (!out.includes(name)) out.push(name);
    };

    // 1. The package's own declared spelling for each host token, most-specific
    //    token first. Keyed off the SAME host-token list as step 2, so a musl
    //    host that finds `linux-x64-musl` in `gjsify.platforms` prefers it over
    //    a declared `linux-x64` — the declaration probe must not be able to
    //    reorder the libc preference.
    for (const token of hostTokens) {
        for (const declared of declaredPlatforms ?? []) {
            if (typeof declared !== 'string') continue;
            if (canonicalPlatformToken(declared) === token) push(declared);
        }
        // 2. The canonical node spelling — what everything in the train stages.
        push(token);
    }
    // 3. The legacy uname spelling, for undeclared pre-rename tarballs. No musl
    //    variant: the rename predates the libc axis by years, so no tarball on
    //    npm can carry a uname-spelled musl directory.
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
    libc?: HostLibc | null;
}): string | null {
    const { platform, arch, declaredPlatforms, existingDirs, libc } = input;
    for (const candidate of prebuildDirCandidates(platform, arch, declaredPlatforms, libc)) {
        if (existingDirs.includes(candidate)) return candidate;
    }
    return null;
}

/**
 * The npm name of the per-platform companion package for a target.
 *
 * `@gjsify/rolldown-native` + `linux-x64` → `@gjsify/rolldown-native-linux-x64`,
 * the pattern `@gjsify/gtk-runtime-darwin-arm64` already ships (and the one
 * napi-rs uses for its `<pkg>-<triple>` siblings, which
 * `napi-node-addon.ts`'s `isNapiRsSibling` already knows).
 *
 * Exported so there is exactly ONE definition of it. The heavy bridges are being
 * split into per-platform packages, and that rollout, the sibling resolution
 * below and the workspace audit all need this string — three independent
 * `` `${name}-${token}` `` template literals would be three places for the
 * separator, the scope handling or the token spelling to drift, and a drifted
 * copy fails as "prebuild not found" in a consumer while every test here stays
 * green.
 *
 * @param baseName the depending package's npm name, scope included.
 * @param token an `<os>-<arch>[-musl]` target.
 */
export function platformPackageName(baseName: string, token: string): string {
    return `${baseName}-${token}`;
}

/**
 * A package that DECLARES `gjsify.prebuilds` but has no directory for this host
 * inside its own tree.
 *
 * Recorded rather than discarded because it is precisely the shape a package
 * whose prebuilds have been SPLIT into per-platform npm packages has: the
 * declaration stays on the depending package, the binary moves to
 * `<name>-<token>`. Before the split there was nothing to do with such a package
 * and it was dropped on the floor; now it is the input to
 * {@link resolvePlatformSibling}.
 */
interface PrebuildCandidate {
    name: string;
    /** The package's OWN root — the directory the sibling probe starts from. */
    pkgDir: string;
}

/** What one package directory turned out to be, for this host. */
type PackageProbe =
    | { kind: 'resolved'; pkg: NativePackage }
    | { kind: 'declared'; candidate: PrebuildCandidate }
    | null;

/**
 * Scan all packages in a node_modules directory for gjsify native prebuilds.
 * Handles scoped packages (@scope/name) as well as flat packages.
 */
function scanNodeModules(
    nodeModulesDir: string,
    target: Required<HostTarget>,
): { resolved: NativePackage[]; declared: PrebuildCandidate[] } {
    const resolved: NativePackage[] = [];
    const declared: PrebuildCandidate[] = [];
    if (!existsSync(nodeModulesDir)) return { resolved, declared };

    let entries: string[];
    try {
        entries = readdirSync(nodeModulesDir);
    } catch {
        return { resolved, declared };
    }

    const take = (probe: PackageProbe) => {
        if (!probe) return;
        if (probe.kind === 'resolved') resolved.push(probe.pkg);
        else declared.push(probe.candidate);
    };

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
                take(checkPackage(pkgDir, `${entry}/${scopedPkg}`, target));
            }
        } else {
            const pkgDir = join(nodeModulesDir, entry);
            take(checkPackage(pkgDir, entry, target));
        }
    }

    return { resolved, declared };
}

/** Check a single package directory for gjsify prebuilds metadata. */
function checkPackage(pkgDir: string, name: string, target: Required<HostTarget>): PackageProbe {
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
        // No `prebuilds/` tree at all. Still a DECLARED prebuild package — the
        // per-platform-package layout puts the binaries in a sibling, so the
        // absence of a local directory is now a normal state, not an absence of
        // information.
        return { kind: 'declared', candidate: { name, pkgDir } };
    }

    const dirName = resolvePrebuildDirName({
        platform: target.platform,
        arch: target.arch,
        declaredPlatforms,
        existingDirs,
        libc: target.libc,
    });
    if (!dirName) return { kind: 'declared', candidate: { name, pkgDir } };

    return { kind: 'resolved', pkg: { name, prebuildsDir: join(prebuildsRoot, dirName) } };
}

/**
 * Find a declared package's prebuild in its PER-PLATFORM COMPANION PACKAGE.
 *
 * The heavy bridges are being split the way napi-rs and `@gjsify/gtk-runtime-*`
 * already are: `@gjsify/rolldown-native` keeps the declaration and the JS facade,
 * `@gjsify/rolldown-native-linux-x64` carries the binary. `detectNativePackages`
 * finds such a companion in a HOISTED layout by accident — the up-walk from the
 * start directory eventually lists it as just another `node_modules` entry — but
 * NOT in an isolated one, where pnpm places it in the virtual store under the
 * depending package and no ancestor of the CWD ever contains it.
 *
 * So the search starts at the DEPENDING PACKAGE's own directory instead of the
 * caller's. That is not a second algorithm; it is the SAME up-walk with a
 * different origin, and the first step of that walk — `<pkgDir>/node_modules/…` —
 * is the isolated-layout case. It is also exactly what napi-rs achieves
 * implicitly by calling `require()` from inside the package: Node's resolver
 * walks up from the requiring FILE, not from the process CWD. We cannot use
 * `require`/`import.meta.resolve` here because the companion package's `exports`
 * map need not expose anything importable — the artifact is a directory, not a
 * module — so the walk is done by hand.
 *
 * @returns the companion's own resolved prebuild directory, or null.
 */
function resolvePlatformSibling(candidate: PrebuildCandidate, target: Required<HostTarget>): NativePackage | null {
    const tokens = hostPlatformTokens(target.platform, target.arch, target.libc);
    let dir = resolve(candidate.pkgDir);
    while (true) {
        for (const token of tokens) {
            const siblingName = platformPackageName(candidate.name, token);
            const siblingDir = join(dir, 'node_modules', ...siblingName.split('/'));
            const probe = checkPackage(siblingDir, siblingName, target);
            // A companion package resolves through the ORDINARY path: it
            // declares its own `gjsify.prebuilds` + the one target it exists
            // for. Reusing `checkPackage` is what keeps the split layout from
            // becoming a second contract nothing audits.
            if (probe?.kind === 'resolved') return probe.pkg;
        }
        const parent = resolve(dir, '..');
        if (parent === dir) return null; // reached filesystem root
        dir = parent;
    }
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
    const host: Required<HostTarget> = {
        platform: target.platform ?? process.platform,
        arch: target.arch ?? process.arch,
        // The ONE place the host's libc is read, and only as a default — every
        // function below takes it as a parameter so the musl branch is reachable
        // from a glibc test host.
        //
        // `!== undefined` rather than `??`: an explicit `libc: null` means "no
        // libc axis / do not classify", and `??` would treat it as absent and
        // probe the host anyway — which is the one value a caller passes when it
        // specifically does NOT want the host consulted.
        libc: target.libc !== undefined ? target.libc : detectHostLibc(target.platform ?? process.platform),
    };
    const merged: NativePackage[] = [];
    const seen = new Set<string>();
    /** Declared-but-unresolved packages, first occurrence wins as above. */
    const candidates: PrebuildCandidate[] = [];
    let dir = resolve(startDir);

    while (true) {
        const nodeModulesDir = join(dir, 'node_modules');
        if (existsSync(nodeModulesDir)) {
            const found = scanNodeModules(nodeModulesDir, host);
            for (const pkg of found.resolved) {
                if (seen.has(pkg.name)) continue;
                seen.add(pkg.name);
                merged.push(pkg);
            }
            for (const candidate of found.declared) {
                if (candidates.some((c) => c.name === candidate.name)) continue;
                candidates.push(candidate);
            }
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }

    // Second pass: per-platform companion packages. Runs AFTER the whole walk so
    // it can dedupe against everything the walk found — in a hoisted layout the
    // companion is already in `merged` under its own name (the walk lists it like
    // any other package), and adding it twice would put the same directory on
    // `GI_TYPELIB_PATH` twice for no benefit. It also cannot ADD a name that a
    // closer `node_modules` already resolved, which keeps Node's
    // nearest-wins semantics intact.
    for (const candidate of candidates) {
        if (seen.has(candidate.name)) continue;
        const sibling = resolvePlatformSibling(candidate, host);
        if (!sibling || seen.has(sibling.name)) continue;
        seen.add(sibling.name);
        merged.push(sibling);
    }

    return merged;
}

/**
 * Decide a host's C library from independently-gathered facts. PURE.
 *
 * Two probes, because neither is available everywhere this CLI runs:
 *
 *   1. `process.report.getReport().header.glibcVersionRuntime` — present iff the
 *      running process is linked against glibc. This is the probe `detect-libc`
 *      and node-gyp use, and it is authoritative when it answers. It is a
 *      NODE-only API: under the committed GJS bundle `@gjsify/process` has no
 *      `report`, so on the runtime this project targets FIRST it never answers.
 *   2. Whether musl's dynamic loader is installed. musl always installs it as
 *      `/lib/ld-musl-<arch>.so.1`, which is a fact about the SYSTEM rather than
 *      about the running process, so it answers under GJS too.
 *
 * The order matters only for speed; the two cannot disagree on a sane host.
 * When NEITHER answers we return `'glibc'`, and that is a claim about the
 * evidence rather than a guess: probe 2 not finding a musl loader means the host
 * has no musl at all, so `-musl` directories are not what it wants. The failure
 * mode of the opposite default — treating an unclassified host as musl — is
 * probing for suffixed directories on every glibc machine, which is noise with no
 * upside.
 *
 * @param platform `process.platform` value; the axis is Linux-only (as npm's own
 *   `libc` field is), so every other OS returns null.
 */
export function resolveHostLibc(input: {
    platform: string;
    glibcVersionRuntime?: string | undefined;
    muslLoaderPresent?: boolean;
}): HostLibc | null {
    if (input.platform !== 'linux') return null;
    if (typeof input.glibcVersionRuntime === 'string' && input.glibcVersionRuntime.length > 0) return 'glibc';
    return input.muslLoaderPresent ? 'musl' : 'glibc';
}

/**
 * Gather the two host facts {@link resolveHostLibc} decides from.
 *
 * BOTH are gathered unconditionally, even though the first one alone usually
 * answers. They are independent observations — one about the running process, one
 * about the system — and a host can genuinely exhibit both (a glibc-linked Node
 * on a distro that also installs musl, e.g. under gcompat). Collecting them
 * separately keeps the decision itself in one pure function a test can pin,
 * instead of encoding the precedence in an if/else chain here where nothing can
 * reach it.
 */
export function detectHostLibc(platform: string): HostLibc | null {
    if (platform !== 'linux') return null;
    const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: unknown } } | undefined)?.header;
    const glibcVersionRuntime =
        typeof header?.glibcVersionRuntime === 'string' ? header.glibcVersionRuntime : undefined;
    // Read the directory rather than testing per-arch loader names: those names
    // (`ld-musl-x86_64`, `ld-musl-aarch64`, …) are a THIRD arch vocabulary, and
    // this file already documents why the repo keeps exactly one.
    const muslLoaderPresent = existsSync('/lib') && readdirSync('/lib').some((f) => f.startsWith('ld-musl-'));
    return resolveHostLibc({ platform, glibcVersionRuntime, muslLoaderPresent });
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
