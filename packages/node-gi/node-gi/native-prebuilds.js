// SPDX-License-Identifier: MIT
// Put EVERY staged prebuild typelib on GI's search path, not only the GTK bundle's.
//
// THE GAP THIS CLOSES. `@gjsify/*` packages that ship a native library plus its
// GObject-Introspection typelib declare `"gjsify": { "prebuilds": "<dir>" }` and stage
// the artifacts under `<dir>/<os>-<arch>/` (ADR 0017). The CLI already finds them —
// `detectNativePackages()` walks `node_modules` and composes `GI_TYPELIB_PATH` for
// `gjsify run` — but a bundle started as plain `node app.node.mjs` never goes through
// the CLI, so it got nothing. The GTK runtime bundle was the one exception, activated
// env-free by `activateBundledGtkRuntime`; every OTHER prebuilt typelib was reachable
// only by exporting an environment variable by hand.
//
// ADR 0021 makes launcher-free prebuild resolution the rule rather than a courtesy, so
// the exception was the bug. This module generalises what the GTK bundle already had,
// using the same two env-free primitives: `prependSearchPath` for the typelib and
// `prependLibraryPath` for the library it names.
//
// MEASURED, and it is what motivated this file. `@gjsify/webkit-native` ships
// `WebKit-6.0.typelib` + `libgjsifywebkit.dylib` — Apple's WKWebView behind the
// WebKitGTK 6.0 API (ADR 0022) and the ONLY WebKit any darwin host has. Under Node on
// macOS, `requireGi('WebKit', '6.0')` failed with "Typelib file for namespace 'WebKit',
// version '6.0' not found" while the typelib sat installed in `node_modules`, two
// directories away. Nothing was missing but the search path. That matters beyond one
// package: ADR 0024 § 4 puts macOS and Windows applications on Node + node-gi, so the
// runtime that could not see these typelibs is the only runtime those platforms have.
//
// ## Why this duplicates `detect-native-packages.ts` instead of importing it
//
// That file is the source of truth for prebuild resolution and this one deliberately
// mirrors its two decisions rather than inventing a second answer. It cannot be
// imported: node-gi lives OUTSIDE the npm workspace (ADR 0031) and must load with no
// dependency on the CLI. So the shapes are copied, and named here so a reader can
// diff them:
//
//   * `prebuildDirCandidates()` — the directory names to probe, most-specific first.
//     A single `${platform}-${arch}` is NOT enough: `hostPlatformTokens()` calls itself
//     "the SINGLE definition of the musl preference order … so it cannot drift", and
//     the root AGENTS.md keeps the retired `linux-x86_64` spelling readable so
//     pre-rename tarballs still load. Hardcoding one spelling broke both.
//   * `resolvePlatformSibling()` — the SECOND pass, for a package that declares
//     `gjsify.prebuilds` while the artifacts live in a per-target companion
//     (`<name>-<token>`). Walking up from node-gi never enters that package's own
//     `node_modules`, so pass one cannot see a companion nested under it.
//
// A LIMIT BOTH RESOLVERS SHARE, measured rather than assumed, because the obvious
// reading of the paragraph above is wrong. `checkPackage()` requires
// `gjsify.prebuilds` to be a string before a package is a candidate at all — and the
// PUBLISHED `@gjsify/webkit-native` does not declare it. It declares `gjsify.platforms`
// and two `optionalDependencies`, and ships `"files": []`. So when npm nests the
// companion under that facade (a version conflict, or pnpm with hoisting off), neither
// this module NOR `detectNativePackages()` finds the typelib: there is no declaring
// package to start the second pass from. Verified on the darwin VM against a real
// nested install — `requireGi('WebKit', '6.0')` fails there under both resolvers.
//
// That is a gap in the SHARED contract, not something to paper over here with a third
// mechanism keyed off `optionalDependencies`. The ordinary hoisted layout, which is
// what npm produces absent a conflict, resolves — and is what the acceptance below
// measures.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Mirrors NODE_ARCH_TO_LEGACY_UNAME in detect-native-packages.ts. */
const LEGACY_UNAME_ARCH = { x64: 'x86_64', arm64: 'aarch64' };

/** Mirrors MUSL_SUFFIX. Linux-only by construction, as the grammar has it. */
const MUSL_SUFFIX = '-musl';

/**
 * Directory names to probe for a host, most-specific first.
 *
 * The declared-spelling probe of the CLI's version is folded into the caller, which
 * has the manifest in hand; what is reproduced here is the host-token order and the
 * legacy fallback, which is where the drift would be invisible.
 */
function targetCandidates(platform, arch, musl) {
    const canonical = `${platform}-${arch}`;
    const out = musl && platform === 'linux' ? [`${canonical}${MUSL_SUFFIX}`, canonical] : [canonical];
    const legacy = `${platform}-${LEGACY_UNAME_ARCH[arch] ?? arch}`;
    if (!out.includes(legacy)) out.push(legacy);
    return out;
}

/** Whether this Linux process is on musl. Cheap, and `null` off Linux. */
function hostIsMusl(platform) {
    if (platform !== 'linux') return false;
    try {
        // The same signal the CLI uses: a glibc report names itself.
        return !String(process.report?.getReport()?.header?.glibcVersionRuntime ?? '').length;
    } catch {
        return false;
    }
}

/** `@scope/name` + token -> `@scope/name-token`, as `platformPackageName` spells it. */
function platformPackageName(name, token) {
    return `${name}-${token}`;
}

const REAL_FS = {
    readDir: (p) => {
        try {
            // A symlink counts as a directory here because that is how npm and pnpm
            // place a workspace or hoisted package, and the walk must follow it.
            // Nothing else asks `isDirectory` about a FILE — the typelib test matches
            // on the name alone, so a symlinked `*.typelib` is not lost to this.
            return readdirSync(p, { withFileTypes: true }).map((e) => ({
                name: e.name,
                isDirectory: e.isDirectory() || e.isSymbolicLink(),
            }));
        } catch {
            return [];
        }
    },
    readJson: (p) => {
        try {
            return JSON.parse(readFileSync(p, 'utf8'));
        } catch {
            return null;
        }
    },
    isDirectory: (p) => {
        try {
            return statSync(p).isDirectory();
        } catch {
            return false;
        }
    },
};

/** Every `node_modules` from `startDir` up to the filesystem root. */
function nodeModulesChain(startDir, fs) {
    const dirs = [];
    let current = resolve(startDir);
    for (;;) {
        const candidate = join(current, 'node_modules');
        if (fs.isDirectory(candidate)) dirs.push(candidate);
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return dirs;
}

/** Package directories inside one `node_modules`, scopes expanded one level. */
function packageDirsIn(nodeModules, fs) {
    const out = [];
    for (const entry of fs.readDir(nodeModules)) {
        if (!entry.isDirectory || entry.name.startsWith('.')) continue;
        const full = join(nodeModules, entry.name);
        if (!entry.name.startsWith('@')) {
            out.push({ dir: full, name: entry.name });
            continue;
        }
        for (const scoped of fs.readDir(full)) {
            if (scoped.isDirectory && !scoped.name.startsWith('.')) {
                out.push({ dir: join(full, scoped.name), name: `${entry.name}/${scoped.name}` });
            }
        }
    }
    return out;
}

/** The staged directory of `pkgDir` for this host, or null. */
function stagedDirFor(pkgDir, manifest, tokens, fs) {
    const declaredDir = manifest?.gjsify?.prebuilds;
    if (typeof declaredDir !== 'string' || declaredDir === '') return null;
    const declaredPlatforms = manifest?.gjsify?.platforms;
    const names = [];
    // The package's OWN declared spelling first, per host token — what makes a
    // pre-rename tarball load without guessing.
    for (const token of tokens) {
        if (Array.isArray(declaredPlatforms)) {
            for (const declared of declaredPlatforms) {
                if (typeof declared === 'string' && declared === token && !names.includes(declared)) {
                    names.push(declared);
                }
            }
        }
        if (!names.includes(token)) names.push(token);
    }
    for (const name of names) {
        const dir = join(pkgDir, declaredDir, name);
        if (!fs.isDirectory(dir)) continue;
        // Name only: a staged typelib may be a symlink, which `readDir` reports as a
        // directory so the package walk can follow one. Nothing is ever a DIRECTORY
        // named `*.typelib`, so the suffix alone is the honest test. A package staging
        // only a `.node` addon or a bare dylib is skipped — those directories would be
        // noise on GI's search path for no namespace.
        if (fs.readDir(dir).some((e) => e.name.endsWith('.typelib'))) return dir;
    }
    return null;
}

/**
 * The second pass: a facade declares the prebuilds, a per-target companion carries
 * them. Restart the walk from the DECLARING package's own directory, which is the
 * whole trick — `resolvePlatformSibling` in the CLI exists for the same reason and its
 * comment says so.
 */
function siblingStagedDir(pkgDir, pkgName, tokens, fs) {
    let dir = resolve(pkgDir);
    for (;;) {
        for (const token of tokens) {
            const siblingName = platformPackageName(pkgName, token);
            const siblingDir = join(dir, 'node_modules', ...siblingName.split('/'));
            const manifest = fs.readJson(join(siblingDir, 'package.json'));
            const staged = stagedDirFor(siblingDir, manifest, tokens, fs);
            if (staged !== null) return staged;
        }
        const parent = resolve(dir, '..');
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Directories holding a staged typelib for this host, nearest install first.
 *
 * PURE apart from the injected `fs`, and takes the target as parameters, so the darwin
 * and win32 branches are exercisable from a Linux host — the discipline
 * `detect-native-packages.ts` already states.
 *
 * COST, and it is NOT cheap: this reads every `package.json` in the tree — 940 reads
 * and about 14 ms warm on a 1315-package install — before any namespace is required,
 * on every addon load, and an application with no native prebuild pays it too.
 *
 * A cheaper pre-filter was tried and is recorded here because it looked right and was
 * not. Skipping a package that has no `prebuilds/` directory (a cheap `stat`) cut the
 * reads to 109 — and broke the second pass entirely, because the FACADE is exactly the
 * package that declares prebuilds while shipping none: `@gjsify/webkit-native` has
 * `"files": []`. Skipping it skips the sibling walk that is the whole point. Measured
 * on the darwin VM against a real nested install: `requireGi('WebKit', '6.0')` back to
 * "Typelib file … not found". A package is a facade only according to its MANIFEST, so
 * the manifest is what has to be read.
 *
 * Narrowing the scan to `@gjsify/*` would cut it honestly, but it is a different
 * contract — "any package declaring `gjsify.prebuilds`" is what the CLI implements —
 * and it should be decided rather than smuggled in as an optimisation.
 */
export function discoverPrebuiltTypelibDirs({ startDir, platform, arch, musl, fs = REAL_FS }) {
    const tokens = targetCandidates(platform, arch, musl ?? hostIsMusl(platform));
    const found = [];
    const seen = new Set();

    for (const nodeModules of nodeModulesChain(startDir, fs)) {
        for (const { dir: pkgDir, name } of packageDirsIn(nodeModules, fs)) {
            // Which GTK a process uses is a POLICY decision (ADR 0023) applied in
            // gtk-runtime.js against `gtkSource()`. Its bundle is not staged under a
            // declared `gjsify.prebuilds` at all — it lives at `<pkg>/gtk/` — so this
            // walk would not reach it either way. The skip is kept because the two are
            // one decision apart: a gtk-runtime package that ever DID declare prebuilds
            // would be prepended from here as well, and a second copy of those typelibs
            // on the path is the hazard #920 records.
            if (name.includes('gtk-runtime-')) continue;

            const manifest = fs.readJson(join(pkgDir, 'package.json'));
            if (manifest?.gjsify?.prebuilds === undefined) continue;

            const staged =
                stagedDirFor(pkgDir, manifest, tokens, fs) ??
                siblingStagedDir(pkgDir, manifest.name ?? name, tokens, fs);
            if (staged === null || seen.has(staged)) continue;
            seen.add(staged);
            found.push(staged);
        }
    }
    return found;
}

let activated = null; // memoize: idempotent, like the GTK activation beside it

/** TEST-ONLY: allow a spec to run the activation again. */
export function resetNativePrebuildsForTests() {
    activated = null;
}

/**
 * Prepend every discovered prebuild directory to GI's typelib AND library search
 * paths.
 *
 * Both paths, because a typelib is only half an answer: `WebKit-6.0.typelib` names
 * `libgjsifywebkit.dylib`, which sits beside it and which dyld would not find either.
 * `gi_repository_prepend_library_path()` is GI's own mechanism and captures nothing at
 * process launch, so this works identically on node, bun and deno with no re-exec and
 * no environment variable — the same reasoning `activateGiLibraryPath` records.
 *
 * Never fatal. An addon predating either binding, an unreadable `node_modules`, or a
 * package with no prebuild for this target all leave the search path exactly as it
 * was; the caller then fails at `requireGi` with GI's own message, which is the
 * behaviour before this module existed.
 *
 * @param {{ prependSearchPath?: (p: string) => void, prependLibraryPath?: (p: string) => void }} native
 * @param {object} [options] test seam; defaults to this module's location and the host
 * @returns {string[]} the directories handed to GI (empty when there was nothing to add)
 */
export function activateNativePrebuilds(native, options = {}) {
    if (activated !== null) return activated;
    activated = [];
    if (typeof native?.prependSearchPath !== 'function') return activated;

    const {
        // fileURLToPath, NOT `new URL(...).pathname`: on Windows that yields "/C:/…",
        // which `dirname` turns into a path that resolves to nothing — and win32 is one
        // of the two platforms this discovery exists for.
        startDir = dirname(fileURLToPath(import.meta.url)),
        platform = process.platform,
        arch = process.arch,
        musl,
        fs = REAL_FS,
    } = options;

    const dirs = discoverPrebuiltTypelibDirs({ startDir, platform, arch, musl, fs });
    // LAST wins with a prepend, so walking in reverse leaves `dirs`' own order —
    // nearest install first — intact in GI's search path.
    for (const dir of [...dirs].reverse()) {
        try {
            native.prependSearchPath(dir);
            if (typeof native.prependLibraryPath === 'function') native.prependLibraryPath(dir);
            activated.unshift(dir);
        } catch {
            // A stubbed/old addon without one of the bindings — skip this directory.
        }
    }
    return activated;
}
