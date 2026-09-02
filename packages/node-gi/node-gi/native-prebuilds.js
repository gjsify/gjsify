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
// `packageRoot` rather than a second `dirname(fileURLToPath(import.meta.url))` here:
// native-paths.js exists to be the ONE definition of this package's own root, and a
// second copy of the expression is a second chance to spell it wrong — which is
// exactly what happened to this one (`new URL(…).pathname`, "/C:/…" on Windows)
// while the copy in native-paths.js was right the whole time.
import { packageRoot } from './native-paths.js';

/**
 * Mirrors NODE_ARCH_TO_LEGACY_UNAME in detect-native-packages.ts. ALL FOUR rows, not
 * the two this host happens to use: a short table reads as complete and the missing
 * rows fail as "typelib not found" on the arch nobody here tests on.
 */
const LEGACY_UNAME_ARCH = { x64: 'x86_64', arm64: 'aarch64', arm: 'armv7', ia32: 'i686' };

/** Mirrors ARCH_ALIASES: spellings that name the same arch, folded onto the node one. */
const ARCH_ALIASES = { x86_64: 'x64', amd64: 'x64', aarch64: 'arm64' };

/** Mirrors MUSL_SUFFIX. Linux-only by construction, as the grammar has it. */
const MUSL_SUFFIX = '-musl';

/**
 * Mirrors `canonicalPlatformToken()`: fold the ARCH half onto the node spelling so a
 * package's own declared token compares equal to a host token.
 *
 * Load-bearing rather than tidiness. Without it the declared-spelling probe below
 * compares two RAW strings, which can only ever match a token the probe beside it
 * already adds — so the whole declaration branch was dead code, and a package
 * declaring + staging `linux-amd64` resolved in the CLI and not here.
 */
function canonicalPlatformToken(token) {
    const isMusl = token.endsWith(MUSL_SUFFIX);
    const base = isMusl ? token.slice(0, -MUSL_SUFFIX.length) : token;
    const dash = base.indexOf('-');
    if (dash < 0) return token;
    const os = base.slice(0, dash);
    const arch = base.slice(dash + 1);
    if (arch === '') return token;
    return `${os}-${ARCH_ALIASES[arch] ?? arch}${isMusl ? MUSL_SUFFIX : ''}`;
}

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

/**
 * Mirrors `resolveHostLibc()`: decide a host's C library from two independently
 * gathered facts. PURE, and exported so a test can pin the decision — the CLI keeps
 * it that way for the same reason, since neither probe answers everywhere.
 *
 * TWO probes, and the SECOND is what makes the default correct:
 *
 *   1. `process.report.…glibcVersionRuntime` — present iff the running process is
 *      linked against glibc, authoritative when it answers, and a NODE-only API. It
 *      does not answer on bun, on deno, or under GJS, where `@gjsify/process` has no
 *      `report` at all — and node-gi runs on all four.
 *   2. musl's dynamic loader, `/lib/ld-musl-<arch>.so.1`. A fact about the SYSTEM
 *      rather than about the process, so it answers on the three runtimes probe 1
 *      cannot.
 *
 * NEITHER answering means glibc, which is a claim about the evidence and not a guess:
 * probe 2 finding no musl loader means the host has no musl. Reading probe 1's silence
 * as "musl" — which is what this did before, having copied only the first half — makes
 * every bun/deno/GJS host on glibc prefer a `-musl` directory, and a musl-linked
 * library staged there cannot load on the platform it would be chosen for. Silent
 * wrong artifact, not a loud refusal.
 *
 * @param {{platform: string, glibcVersionRuntime?: string, muslLoaderPresent?: boolean}} input
 * @returns {boolean} whether to offer `-musl` directories; false off Linux, where the
 *   axis does not exist (npm's own `libc` field is Linux-only).
 */
export function resolveHostMusl(input) {
    if (input.platform !== 'linux') return false;
    if (typeof input.glibcVersionRuntime === 'string' && input.glibcVersionRuntime.length > 0) return false;
    return input.muslLoaderPresent === true;
}

/** Gather the two host facts {@link resolveHostMusl} decides from. */
function hostIsMusl(platform) {
    if (platform !== 'linux') return false;
    let glibcVersionRuntime;
    try {
        // Two ways probe 1 declines: a missing `report` short-circuits to undefined,
        // while a bare `process` (a GJS host with no polyfill registered) or a partial
        // `getReport` shim THROWS. Both mean the same thing here.
        const header = process.report?.getReport()?.header;
        if (typeof header?.glibcVersionRuntime === 'string') glibcVersionRuntime = header.glibcVersionRuntime;
    } catch {
        // Probe 2 still answers.
    }
    let muslLoaderPresent = false;
    try {
        // Read the directory rather than testing per-arch loader names: those
        // (`ld-musl-x86_64`, `ld-musl-aarch64`, …) are a THIRD arch vocabulary, and
        // this file already carries the two the repo keeps. Throws on a host with no
        // `/lib` at all, which is the same answer as finding no loader in one.
        muslLoaderPresent = readdirSync('/lib').some((f) => f.startsWith('ld-musl-'));
    } catch {
        // No `/lib` to read ⇒ no musl loader installed.
    }
    return resolveHostMusl({ platform, glibcVersionRuntime, muslLoaderPresent });
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
                if (typeof declared !== 'string') continue;
                if (canonicalPlatformToken(declared) === token && !names.includes(declared)) {
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
 * COST, and it is NOT cheap. Two parts, and the accounting has to name both or the
 * second one grows unwatched: ONE `package.json` read per package in the tree, PLUS
 * the second pass's probes for every package that declares prebuilds and resolves
 * nothing locally — those walk to the filesystem root, per host token, opening a
 * companion manifest that is not there. Measured on a 1691-package install
 * (linux-x64, warm page cache): 1691 + 848 = 2539 reads, ~40 ms; ~306 ms cold. It is
 * paid before any namespace is required, on every addon load, and by an application
 * with no native prebuild at all.
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
        // This package's own directory, which inside an installed application IS that
        // application's tree — so the upward walk sees every `node_modules` above it.
        // Deliberately NOT merged with `process.cwd()` the way the GJS-side helper in
        // `gi-search-path.ts` does: that one serves a globally installed CLI sitting
        // away from the project, while a cwd anchor here would make which typelibs a
        // library loads depend on the shell's working directory. ADR 0021 § The Node host.
        startDir = packageRoot,
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
