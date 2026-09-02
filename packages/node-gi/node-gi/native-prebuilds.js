// SPDX-License-Identifier: MIT
// Put EVERY staged prebuild typelib on GI's search path, not only the GTK bundle's.
//
// THE GAP THIS CLOSES. `@gjsify/*` packages that ship a native library plus its
// GObject-Introspection typelib declare `"gjsify": { "prebuilds": "<dir>" }` and put
// the artifacts under `<dir>/<os>-<arch>/` (ADR 0017). The CLI already finds them —
// `detectNativePackages()` walks `node_modules` and composes `GI_TYPELIB_PATH` for
// `gjsify run` — but a bundle started as plain `node app.node.mjs` never goes through
// the CLI, so it got nothing. The GTK runtime bundle was the one exception, activated
// env-free by {@link activateBundledGtkRuntime}; every OTHER prebuilt typelib was
// reachable only by exporting an environment variable by hand.
//
// ADR 0021 makes launcher-free prebuild resolution the rule rather than a courtesy,
// so the exception was the bug. This module generalises what the GTK bundle already
// had, using the same two env-free primitives: `prependSearchPath` for the typelib
// and `prependLibraryPath` for the library it names.
//
// MEASURED, and it is what motivated this file. `@gjsify/webkit-native` ships
// `WebKit-6.0.typelib` + `libgjsifywebkit.dylib` — Apple's WKWebView behind the
// WebKitGTK 6.0 API (ADR 0022) and the ONLY WebKit any darwin host has. Under Node on
// macOS, `requireGi('WebKit', '6.0')` failed with "Typelib file for namespace
// 'WebKit', version '6.0' not found" while the typelib sat installed in
// `node_modules`, two directories away. Hand-calling `prependSearchPath` on that
// directory made the same call succeed, construct a `WebKit.WebView`, and drive a
// real page load to `LoadEvent.FINISHED`. Nothing was missing but the search path.
//
// WHY THE GTK BUNDLE IS EXCLUDED HERE. Which GTK a process uses is a POLICY decision
// (ADR 0023: bundle vs. the host's own), and `activateBundledGtkRuntime` is where that
// policy is applied. Prepending the bundle a second time from here would put a second
// copy of the same typelibs on the path and defeat a `gtkSource()` of `system` — the
// two-copies hazard #920 records. So `gtk-runtime-*` is skipped by name and stays that
// module's business.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Packages whose activation belongs to gtk-runtime.js, not here. See the header. */
const GTK_RUNTIME_PREFIX = 'gtk-runtime-';

/**
 * Default filesystem surface, injectable so the pure discovery below is testable from
 * any host — the same reason `detect-native-packages.ts` takes platform/arch as
 * parameters rather than reading `process.*` inline.
 */
const REAL_FS = {
    exists: (p) => existsSync(p),
    readDir: (p) => {
        try {
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

/**
 * Every `node_modules` directory from `startDir` up to the filesystem root.
 *
 * Walking UP rather than reading one directory is what makes a hoisted layout and a
 * nested one behave the same: npm may place `@gjsify/webkit-native-darwin-x64` beside
 * the app or inside `@gjsify/webkit-native`, and both are correct installs.
 */
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

/** The package directories inside one `node_modules`, scopes expanded one level. */
function packageDirsIn(nodeModules, fs) {
    const out = [];
    for (const entry of fs.readDir(nodeModules)) {
        if (!entry.isDirectory) continue;
        if (entry.name.startsWith('.')) continue;
        const full = join(nodeModules, entry.name);
        if (!entry.name.startsWith('@')) {
            out.push(full);
            continue;
        }
        for (const scoped of fs.readDir(full)) {
            if (scoped.isDirectory && !scoped.name.startsWith('.')) out.push(join(full, scoped.name));
        }
    }
    return out;
}

/**
 * Directories holding a staged typelib for `<platform>-<arch>`, nearest install first.
 *
 * PURE apart from the injected `fs`, and takes the target as parameters, so the darwin
 * and win32 branches are exercisable from a Linux host.
 *
 * A package qualifies when it declares `gjsify.prebuilds`, that directory has a
 * `<platform>-<arch>` subdirectory, and that subdirectory actually CONTAINS a
 * `.typelib`. The last condition is the load-bearing one: a package may declare
 * prebuilds and ship only a `.node` addon or a bare `.dylib`, and adding those
 * directories would put noise on GI's search path for no namespace.
 *
 * @param {object} options
 * @param {string} options.startDir where to begin the upward `node_modules` walk
 * @param {string} options.platform `process.platform` value to resolve for
 * @param {string} options.arch `process.arch` value to resolve for
 * @param {typeof REAL_FS} [options.fs] injectable filesystem surface
 * @returns {string[]} absolute directories, de-duplicated, nearest first
 */
export function discoverPrebuiltTypelibDirs({ startDir, platform, arch, fs = REAL_FS }) {
    const target = `${platform}-${arch}`;
    const found = [];
    const seen = new Set();

    for (const nodeModules of nodeModulesChain(startDir, fs)) {
        for (const packageDir of packageDirsIn(nodeModules, fs)) {
            const manifest = fs.readJson(join(packageDir, 'package.json'));
            const prebuilds = manifest?.gjsify?.prebuilds;
            if (typeof prebuilds !== 'string' || prebuilds === '') continue;
            if (typeof manifest.name === 'string' && manifest.name.includes(GTK_RUNTIME_PREFIX)) continue;

            const dir = join(packageDir, prebuilds, target);
            if (seen.has(dir) || !fs.isDirectory(dir)) continue;
            if (!fs.readDir(dir).some((e) => !e.isDirectory && e.name.endsWith('.typelib'))) continue;

            seen.add(dir);
            found.push(dir);
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
 * no environment variable — the same reasoning {@link activateGiLibraryPath} records.
 *
 * Never fatal. An addon predating either binding, an unreadable `node_modules`, or a
 * package with no prebuild for this target all leave the search path exactly as it
 * was; the caller then fails at `requireGi` with GI's own message, which is the
 * behaviour before this module existed.
 *
 * @param {{ prependSearchPath?: (p: string) => void, prependLibraryPath?: (p: string) => void }} native
 * @param {object} [options] test seam; defaults to this module's location and the host target
 * @returns {string[]} the directories handed to GI (empty when there was nothing to add)
 */
export function activateNativePrebuilds(native, options = {}) {
    if (activated !== null) return activated;
    activated = [];
    if (typeof native?.prependSearchPath !== 'function') return activated;

    const {
        startDir = dirname(new URL(import.meta.url).pathname),
        platform = process.platform,
        arch = process.arch,
        fs = REAL_FS,
    } = options;

    const dirs = discoverPrebuiltTypelibDirs({ startDir, platform, arch, fs });
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
