// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gtk-runtime — locate + activate a batteries-included, relocated
// GTK/GObject-Introspection runtime bundle so gi:// namespaces load with NO system
// or Homebrew GTK (Phase 2 of cross-platform node-gi). Bundles ship for darwin-arm64,
// darwin-x64 and win32-x64 (@gjsify/gtk-runtime-<platform>-<arch>); NOTHING below
// keys on a specific target — the tag is derived from the running process, so a new
// bundle is found by the mechanism that found the first. This is a no-op on every
// platform without a bundle, and harmless when no bundle is present (the addon then
// uses the host's GTK exactly as before).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix, win32 } from 'node:path';
import { existsSync } from 'node:fs';
import { composeDyldFallback, pathCovers, splitSearchPath, systemGiLibraryDirs } from './system-gi.js';
import { nativeCandidates, prebuildAddonPath } from './native-paths.js';

// NB: node:child_process is intentionally NOT imported at module top level. It is
// pulled in lazily (via `require` below) ONLY on the darwin re-exec path — importing
// it eagerly put it in every runtime's module graph, and under Deno that tripped a
// teardown regression on an unrelated conformance file (all its tests passed but the
// process exited non-zero). This keeps non-darwin loads free of that side effect.
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url)); // package root

// Sentinel: set on the re-exec so a bundle-activated child never re-execs again.
const REEXEC_SENTINEL = 'GJSIFY_GTK_REEXEC';

/**
 * Resolve the GTK runtime bundle directory for this platform, or `null`. A valid
 * bundle dir contains the native-code dir (`lib/` relocated dylibs on darwin,
 * `bin/` DLLs on win32) + `girepository-1.0/` (typelibs).
 * Search order (first hit wins):
 *   1. GJSIFY_GTK_RUNTIME env (an explicit bundle dir),
 *   2. node-gi's own prebuilds/<platform>-<arch>/gtk/ (CI/dev staging path),
 *   3. the sibling monorepo dir ../gtk-runtime-<platform>-<arch>/gtk,
 *   4. the published optional dep @gjsify/gtk-runtime-<platform>-<arch>.
 * @returns {{ dir: string, libDir: string, typelibDir: string } | null}
 */
export function resolveGtkRuntimeBundle() {
    const tag = `${process.platform}-${process.arch}`;
    const candidates = [];

    if (process.env.GJSIFY_GTK_RUNTIME) candidates.push(process.env.GJSIFY_GTK_RUNTIME);
    candidates.push(join(here, 'prebuilds', tag, 'gtk'));
    candidates.push(join(here, '..', `gtk-runtime-${tag}`, 'gtk'));
    try {
        // The package's index.js sits at its root; the bundle is ./gtk beside it.
        const pkgIndex = require.resolve(`@gjsify/gtk-runtime-${tag}`);
        candidates.push(join(dirname(pkgIndex), 'gtk'));
    } catch {
        // Not installed — fine.
    }

    // The loadable native code lives in `lib` (dylibs) on macOS and `bin` (DLLs) on
    // Windows. `libDir` is the dir node-gi adds to the OS library search path
    // (DYLD_FALLBACK on darwin, PATH on win32) — its NAME differs, its ROLE does not.
    const nativeSubdir = process.platform === 'win32' ? 'bin' : 'lib';
    for (const dir of candidates) {
        if (!dir) continue;
        const libDir = join(dir, nativeSubdir);
        const typelibDir = join(dir, 'girepository-1.0');
        if (existsSync(libDir) && existsSync(typelibDir)) return { dir, libDir, typelibDir };
    }
    return null;
}

// ---- WHICH GTK WINS ---------------------------------------------------------
//
// Two GTKs can be reachable at once: a batteries-included bundle
// (@gjsify/gtk-runtime-<os>-<arch>) and the host's own. Until now the answer was
// implicit — "a bundle, if one is present" — and the rule keeping that safe was
// "a bundle must NEVER be a dependency of @gjsify/node-gi", because #910 made it
// one and a CI job that had COMPILED the addon against Homebrew GTK then re-exec'd
// onto the BUNDLE's typelibs: wrong method entries, then a 29-minute timeout
// (#920 reverted it). That rule protected the from-source case and left every end
// user on Windows with no GTK at all (#1063) — nothing installs the bundle there
// and Windows ships no system GTK.
//
// The repair separates two things that were tangled:
//
//   • WHO INSTALLS IT is not this package's business. node-gi still declares no
//     bundle — whoever SHIPS an app declares it (for the showcases that is the
//     gjsify CLI, which already supplies @gjsify/node-gi the same way). A
//     from-source build therefore never receives a bundle it did not ask for,
//     which is #910's accident removed at the source rather than caught later.
//
//   • WHICH ONE WINS when both are present is a POLICY — stated per-OS, and
//     overridable.
//
// PER-OS DEFAULTS, and why they are spelled out rather than derived. The cheaper
// rule "prefer a bundle wherever we ship one" gives identical answers today,
// since bundles exist exactly for the platforms without a dependable system
// stack. It is a trap: the day someone builds a Linux bundle (Flatpak, a CI
// image) that rule would SILENTLY flip Linux from system-first to bundle-first
// with nobody deciding it. Stating each default now means a new bundle cannot
// move an existing platform's behaviour.
//
//   linux  → system first. dnf/apt/pacman resolve GTK *and* its typelibs
//            correctly; that is the combination the distro tested.
//   win32  → bundle first. There is no system GTK; a host with gvsbuild has it
//            deliberately and stays reachable as the fallback.
//   darwin → bundle first. Homebrew is usually present yet measurably NOT
//            findable (gjs's own rpath points into glib's keg alone), which is
//            the reason the darwin bundle exists at all.
//
// `GJSIFY_GTK_PREFER=bundle|system` overrides. Deliberately NOT the same knob as
// `GJSIFY_GTK_RUNTIME`, which names a bundle DIRECTORY: where a bundle is and
// which source wins are two questions, and one variable answering both leaves a
// user unable to say "I have a bundle, use the system anyway".

/** @typedef {'bundle' | 'system' | 'none'} GtkSource */
/** @typedef {'prebuild' | 'source' | 'unknown'} AddonProvenance */

/** Per-OS default: which source is consulted FIRST. See the note above. */
export const DEFAULT_GTK_PREFERENCE = Object.freeze({
    linux: 'system',
    win32: 'bundle',
    darwin: 'bundle',
});

/**
 * Decide which GTK this process should use. PURE — every input is a parameter,
 * so all three platforms' branches are executable from any host.
 *
 * The result is an ordered preference filtered by availability, never an
 * exclusion: "prefer system" on a host with no system GTK still falls back to a
 * bundle, because a preference that silently also means "and nothing else" turns
 * a working setup into a hard failure.
 *
 * THE ONE HARD PART. A `source` addon was linked against whatever GTK the builder
 * had, so pairing it with a bundle is not a preference but an ABI error — it is
 * #910 exactly. The bundle is therefore dropped from the order for a from-source
 * addon. `GJSIFY_GTK_PREFER=bundle` can still lift it, because building against a
 * bundle on purpose is legitimate and an explicitly-set variable is consent;
 * what #910 was is an accident nobody chose, and the DEFAULT must never
 * reproduce it.
 *
 * @param {object} opts
 * @param {NodeJS.Platform | string} opts.platform
 * @param {boolean} opts.hasBundle a complete bundle is installed
 * @param {boolean} opts.hasSystem a host GTK is worth trying (`hostGtkIsWorthTrying`)
 * @param {AddonProvenance} [opts.provenance] which addon binary will load
 * @param {string} [opts.override] raw `GJSIFY_GTK_PREFER` value, if any
 * @returns {GtkSource}
 */
export function decideGtkSource({ platform, hasBundle, hasSystem, provenance = 'unknown', override }) {
    const bundleFirst =
        override === 'bundle' ? true : override === 'system' ? false : DEFAULT_GTK_PREFERENCE[platform] !== 'system';
    let order = bundleFirst ? ['bundle', 'system'] : ['system', 'bundle'];

    if (provenance === 'source' && override !== 'bundle') {
        order = order.filter((source) => source !== 'bundle');
    }

    const available = { bundle: hasBundle, system: hasSystem };
    for (const source of order) {
        if (available[source]) return source;
    }
    return 'none';
}

/**
 * Which binary `loadNative()` will pick, WITHOUT loading it.
 *
 * Load-bearing on Windows: the DLL search path must be set BEFORE the addon is
 * dlopen'd, so the provenance question cannot wait until we hold the loaded
 * module. `nativeCandidates()` is a pure, ordered list and the same one the
 * loader walks, so probing it here cannot disagree with what actually loads.
 *
 * An explicit `NODE_GI_NATIVE=<path>` pin answers `unknown`, not `source`: the
 * caller named a binary and we cannot tell what it was built against, so the safe
 * reading is that a deliberate choice does not get the from-source veto.
 * @returns {AddonProvenance}
 */
export function addonProvenance() {
    const pinned = process.env.NODE_GI_NATIVE;
    if (pinned && pinned !== 'build' && pinned !== 'prebuild') return 'unknown';
    const prebuild = prebuildAddonPath();
    for (const candidate of nativeCandidates()) {
        if (!existsSync(candidate)) continue;
        return candidate === prebuild ? 'prebuild' : 'source';
    }
    return 'unknown';
}

/**
 * Is the HOST's own GI stack worth trying?
 *
 * Deliberately cheap and conservative rather than a probe that pretends to know.
 * On linux and win32 "system" means "change nothing and let the OS loader do its
 * job", which is always worth attempting — and on win32 the failure that follows
 * is what produces the actionable diagnosis in `index.js` instead of a raw OS
 * string. Only darwin has a real question, because there the loader needs the
 * libdirs handed to it and `systemGiLibraryDirs()` is what finds them.
 * @param {NodeJS.Platform | string} [platform]
 * @returns {boolean}
 */
export function hostGtkIsWorthTrying(platform = process.platform) {
    if (platform !== 'darwin') return true;
    return systemGiLibraryDirs().length > 0;
}

let decidedSource = null;

/**
 * The decision for THIS process, memoized — every entry point below must reach
 * the same answer, and re-deciding per call is how two of them drift apart.
 * @returns {GtkSource}
 */
export function gtkSource() {
    if (decidedSource === null) {
        decidedSource = decideGtkSource({
            platform: process.platform,
            hasBundle: resolveGtkRuntimeBundle() !== null,
            hasSystem: hostGtkIsWorthTrying(),
            provenance: addonProvenance(),
            override: process.env.GJSIFY_GTK_PREFER,
        });
    }
    return decidedSource;
}

/** TEST-ONLY: drop the memoized decision so a spec can vary the environment. */
export function resetGtkSourceForTests() {
    decidedSource = null;
}

/**
 * Make GTK genuinely env-free on macOS by RE-EXECING this process once with
 * `DYLD_FALLBACK_LIBRARY_PATH` pointing at the dylibs a typelib names by bare
 * leaf — the BUNDLED runtime when one ships, otherwise the HOST's system GI stack
 * (`systemGiLibraryDirs()`; Homebrew at either prefix, MacPorts, custom).
 *
 * Why a re-exec and not just `process.env` mutation: on macOS, dyld captures
 * `DYLD_FALLBACK_LIBRARY_PATH` at PROCESS LAUNCH, so setting it from JS never
 * affects the running dyld. Measured on macOS 15.7.8 / Node 24.18.1 — mutating
 * `process.env` before the first `requireGi('Gtk','4.0')` reproduces the failure
 * verbatim. It is load-bearing beyond the addon's own link closure:
 * GObject-Introspection resolves a type's `get_type()` (e.g. for `registerClass`
 * subclassing) — and the Pango/Gdk/Graphene/GdkPixbuf backers — via
 * `g_module_open(<leaf soname>)`, and dyld will NOT satisfy a bare-leaf dlopen
 * from an `@loader_path`-loaded image, nor from a prefix absent from its default
 * fallback path. Re-launching with the fallback set (exactly what the
 * Homebrew-based CI legs export by hand) resolves every such leaf lookup.
 *
 * ONE re-exec path for both sources, on purpose. The BUNDLE still wins whenever
 * one is installed and its behaviour here is byte-unchanged (its libDir alone,
 * plus the bundle's `GI_TYPELIB_PATH`) — #920 reverted making a bundle a
 * dependency of this package precisely because an installed bundle silently beats
 * the GTK the addon was built against, so the system branch is reached ONLY when
 * `resolveGtkRuntimeBundle()` finds nothing and it never touches typelib
 * resolution (the host's typelibs are already found; only the loader is blind).
 *
 * Sentinel-guarded so it fires AT MOST ONCE, and skipped entirely when the
 * launching environment already covers the directories — so a CI job or a
 * launcher that exported the variable pays nothing, and the re-exec'd child never
 * re-execs again. A host with no GI stack under any probed or pkg-config-reported
 * prefix yields no directories and is left byte-unchanged.
 *
 * MUST be called at module top-level BEFORE the native addon (and thus its GTK
 * dependency closure) is dlopen'd — the re-exec then loads everything correctly.
 * On re-exec this calls `process.exit()` and never returns to the caller.
 * @returns {void}
 */
export function maybeReexecForGtkRuntime() {
    if (process.platform !== 'darwin') return; // strict no-op on every non-darwin runtime
    // Node only: the argv/execArgv reconstruction below is Node-shaped, and Node is
    // the runtime the conformance proves. Bun/Deno set globals of their own — skip the
    // re-exec there (they still get env-free TYPELIBS via activateBundledGtkRuntime;
    // their DYLD path for non-addon-linked backers is a documented follow-up), so the
    // darwin path can never spawn a malformed re-exec under a non-Node runtime.
    if (typeof globalThis.Bun !== 'undefined' || typeof globalThis.Deno !== 'undefined') return;
    // GJS host mode (@gjsify/napi loads this addon inside gjs): the process is
    // `gjs`, so process.execPath/execArgv describe an interpreter that cannot be
    // re-launched with a Node argv — and `createRequire` there is
    // @gjsify/module's polyfill, which rejects synchronous BUILTIN loads, so even
    // REACHING the child_process require below would throw during module init.
    // The re-exec is therefore IMPOSSIBLE here, not merely unnecessary — and the
    // gap is real: gjs's own rpath covers the GLIB-family leaves it links against,
    // but MEASURED on the macOS 15.7.8 VM that rpath points at glib's keg ALONE
    // (`…/opt/glib/lib`), so a bare-leaf `libgtk-4.1.dylib` fails under plain gjs
    // exactly as it did under node. Repairing it belongs to whoever LAUNCHES the
    // gjs process, one hop earlier: `buildNativeEnv()` in `@gjsify/cli` puts
    // `systemGiLibraryDirs()` on the child's `DYLD_FALLBACK_LIBRARY_PATH` (its
    // `system-gi.ts` is the pinned mirror of this module's `system-gi.js`). A gjs
    // launched by hand keeps the gap — tracked in `status/open-todos.md`.
    // Same probe index.js uses for RUNTIME — as with the Bun/Deno pair above, the
    // check has to live here too because this runs before that const is defined.
    if (typeof globalThis.imports !== 'undefined' && typeof globalThis.print === 'function') return;
    if (process.env[REEXEC_SENTINEL]) return; // already re-exec'd — the child path

    // A bundle THE POLICY CHOSE is the whole answer and stays the ONLY entry (see
    // the #920 note above). Otherwise the host's own GI libdirs are the answer —
    // which is also what a from-source addon gets, since `gtkSource()` refuses it
    // a bundle by default.
    const bundle = gtkSource() === 'bundle' ? resolveGtkRuntimeBundle() : null;
    const libDirs = bundle ? [bundle.libDir] : systemGiLibraryDirs();
    if (libDirs.length === 0) return; // no bundle and no host GI stack — nothing to point at

    const curDyld = process.env.DYLD_FALLBACK_LIBRARY_PATH ?? '';
    const curDyldDirs = splitSearchPath(curDyld);
    if (pathCovers(libDirs, curDyldDirs)) return; // the launch env already covers it

    // Lazily load node:child_process ONLY here (darwin + something to point at +
    // not yet covered) — see the top-of-file note; keeps it out of non-darwin
    // module graphs.
    const { spawnSync } = require('node:child_process');
    const curTypelib = process.env.GI_TYPELIB_PATH ?? '';
    const env = {
        ...process.env,
        [REEXEC_SENTINEL]: '1',
        // Our dirs first, then whatever the host asked for, then dyld's own
        // default list — setting the variable REPLACES that list, so carrying
        // it is what keeps the re-exec'd child from searching LESS than the
        // process that spawned it.
        DYLD_FALLBACK_LIBRARY_PATH: composeDyldFallback(libDirs),
    };
    // Only a bundle relocates typelibs; a host GI stack's are already on GI's own
    // search path, so the system branch deliberately leaves GI_TYPELIB_PATH alone.
    if (bundle) {
        env.GI_TYPELIB_PATH = curTypelib ? `${bundle.typelibDir}:${curTypelib}` : bundle.typelibDir;
    }
    // Reproduce this exact invocation (node flags + argv) with the augmented env.
    const res = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        stdio: 'inherit',
        env,
    });
    if (res.error) throw res.error; // spawn failed outright — surface it, don't silently continue mis-linked
    process.exit(res.status === null ? 1 : res.status);
}

/**
 * Prepend the bundled GTK runtime's DLL dir (`gtk/bin`) to `process.env.PATH` so a
 * later `LoadLibrary` resolves against the bundle with NO gvsbuild/system GTK — both
 * the native addon's OWN static imports (glib/gobject/gio/girepository/cairo/ffi/…)
 * AND every runtime `g_module_open(<soname>)` a typelib does for its backers
 * (Pango/Gdk/Graphene). This is the Windows analog of the darwin re-exec, but
 * SIMPLER: Windows re-reads the DLL search path at EACH `LoadLibrary` (unlike dyld,
 * which captures `DYLD_FALLBACK_LIBRARY_PATH` only at process launch), so an
 * in-process `process.env.PATH` mutation is sufficient — no re-exec, and no native
 * `AddDllDirectory` (which would be chicken-and-egg: the addon must already be loaded
 * to expose it). MUST be called at module top-level BEFORE the addon is `require()`'d
 * (index.js does exactly that, before loadNative()). Strict no-op off win32 / without
 * a bundle / when the dir is already on PATH. Idempotent.
 * @returns {void}
 */
export function maybePrependGtkRuntimeDllPath() {
    if (process.platform !== 'win32') return; // strict no-op on every non-win32 runtime
    // Gated on the POLICY, not on mere presence: an installed bundle does not win
    // for a from-source addon, and `GJSIFY_GTK_PREFER=system` opts out entirely.
    if (gtkSource() !== 'bundle') return;
    const bundle = resolveGtkRuntimeBundle();
    if (!bundle) return; // strict no-op when no bundle is present
    const binDir = bundle.libDir; // on win32 the native-code dir is gtk/bin (the DLLs)
    const cur = process.env.PATH ?? '';
    if (cur.split(';').filter(Boolean).includes(binDir)) return; // already on PATH
    process.env.PATH = cur ? `${binDir};${cur}` : binDir;
}

/**
 * Wire the env a bundled FULL-WINDOWING GTK runtime needs so a REAL GTK WINDOW
 * finds its runtime DATA on Windows: compiled GSettings schemas
 * (`GSETTINGS_SCHEMA_DIR`), the gdk-pixbuf image loaders (`GDK_PIXBUF_MODULEDIR` +
 * `GDK_PIXBUF_MODULE_FILE`), the icon themes (`XDG_DATA_DIRS` → `<bundle>/share`),
 * and — when bundled — Fontconfig (`FONTCONFIG_PATH`/`FONTCONFIG_FILE`). These live
 * beside the DLLs the display-free path already wires (maybePrependGtkRuntimeDllPath).
 *
 * STRICT no-op off win32, without a bundle, or when the bundle carries NO windowing
 * data — keyed on the `share/glib-2.0/schemas/gschemas.compiled` marker the
 * --windowing build produces, so the DEFAULT display-free bundle is byte-unchanged.
 * Windows re-reads these vars at first use (schema/loader/icon-theme init runs AFTER
 * the addon loads), so an in-process mutation here suffices — no re-exec, the DLL-
 * search analog. Each var is set only when currently unset (a host override wins).
 * Idempotent; MUST run at module top-level with maybePrependGtkRuntimeDllPath, before
 * the app initializes GTK. GLib uses `;` as the win32 search-path separator.
 * @returns {void}
 */
export function maybeWireGtkWindowingEnv() {
    // win32 AND darwin ship a batteries-included --windowing bundle whose runtime
    // DATA (gschemas / icons / loaders / gtksource / fonts) is located by these env
    // vars — GLib/GTK read them at init, not at launch (unlike dyld's DYLD_FALLBACK),
    // so setting them in-process works on both. The only platform difference is the
    // XDG_DATA_DIRS separator (';' on win32, ':' on unix/darwin).
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;
    // Same gate as the DLL/dylib path: the runtime DATA belongs to the bundle, so
    // it is wired only when the bundle is the source the policy picked.
    if (gtkSource() !== 'bundle') return;
    const bundle = resolveGtkRuntimeBundle();
    if (!bundle) return; // strict no-op when no bundle is present

    const schemaDir = join(bundle.dir, 'share', 'glib-2.0', 'schemas');
    // gschemas.compiled = the windowing-data marker; absent → display-free bundle.
    if (!existsSync(join(schemaDir, 'gschemas.compiled'))) return;

    const pathSep = process.platform === 'win32' ? ';' : ':';
    const setIfUnset = (name, value) => {
        if (!process.env[name]) process.env[name] = value;
    };
    setIfUnset('GSETTINGS_SCHEMA_DIR', schemaDir);

    // MODULE_FILE is the load-bearing one on BOTH platforms — it is the cache, and the
    // cache is what names the modules. It is also the ONLY variable gdk-pixbuf's runtime
    // reads: `GDK_PIXBUF_MODULEDIR` is read by queryloaders.c, the GENERATOR, where it
    // merely picks the directory to scan. This comment used to claim the opposite — that
    // MODULEDIR is "what its bare-leaf cache needs" on win32 — and the win32 builder wrote
    // a bare-leaf cache on the strength of it. gdk-pixbuf 2.44.6's `build_module_path()`
    // joins a relative cache entry with the bundle TOPLEVEL instead, so every leaf resolved
    // to `<bundle>\<leaf>` and no SVG icon has ever decoded from a win32 bundle (#996).
    // The cache is written toplevel-relative now; see scripts/pixbuf-loader-cache.mjs.
    //
    // darwin needs neither: Homebrew's gdk-pixbuf 2.44.7 has no `GDK_PIXBUF_MODULEDIR`
    // string in the dylib at all, so that cache names each module `@loader_path/…`
    // (relative to the image that dlopens it, i.e. the bundle's lib/) and dyld resolves it
    // with no env beyond this file.
    //
    // MODULEDIR is still set, and still only if unset: it costs nothing, and it is what a
    // consumer regenerating the cache in-process would need. Nothing here depends on it.
    const loaderCache = join(bundle.dir, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders.cache');
    if (existsSync(loaderCache)) {
        setIfUnset('GDK_PIXBUF_MODULEDIR', join(bundle.dir, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders'));
        setIfUnset('GDK_PIXBUF_MODULE_FILE', loaderCache);
    }

    // XDG_DATA_DIRS → <bundle>/share so the icon themes (share/icons) AND GtkSource's
    // language-specs/styles (share/gtksourceview-5) resolve.
    const shareDir = join(bundle.dir, 'share');
    if (existsSync(shareDir)) {
        const cur = process.env.XDG_DATA_DIRS ?? '';
        if (!cur.split(pathSep).filter(Boolean).includes(shareDir)) {
            process.env.XDG_DATA_DIRS = cur ? `${shareDir}${pathSep}${cur}` : shareDir;
        }
    }

    const fontsConf = join(bundle.dir, 'etc', 'fonts', 'fonts.conf');
    if (existsSync(fontsConf)) {
        setIfUnset('FONTCONFIG_PATH', join(bundle.dir, 'etc', 'fonts'));
        setIfUnset('FONTCONFIG_FILE', fontsConf);
    }

    // GStreamer, which finds its plugins the way GTK finds its schemas: by env,
    // read at init. Without this the bundle can ship every Gst typelib and still
    // play nothing — `Gst.init()` succeeds against an EMPTY registry, so the
    // failure surfaces far away as "no element decodebin" rather than as a missing
    // library. That is the same shape as the 0.27.1 bundles, which carried
    // `Adw-1.typelib` with no libadwaita behind it.
    //
    // SYSTEM_PATH, not GST_PLUGIN_PATH: the latter is the USER's additive override
    // and the bundle has no business consuming it. SYSTEM_PATH also suppresses the
    // compiled-in default, which is what we want — that default is the build
    // machine's prefix, and on a user's box it is either absent or, worse, a
    // foreign GStreamer whose plugins would be mixed with the bundle's.
    const gstPlugins = join(bundle.dir, 'lib', 'gstreamer-1.0');
    if (existsSync(gstPlugins)) {
        setIfUnset('GST_PLUGIN_SYSTEM_PATH', gstPlugins);
        // The scanner is a separate EXECUTABLE that GStreamer forks to inspect each
        // plugin out-of-process, so a plugin that crashes on load cannot take the
        // app with it. Its compiled-in path is the build machine's too, so without
        // this GStreamer silently degrades to in-process scanning — which works,
        // until the first bad plugin takes the process down instead of itself.
        const scanner = join(bundle.dir, 'libexec', 'gstreamer-1.0', gstScannerLeaf());
        if (existsSync(scanner)) setIfUnset('GST_PLUGIN_SCANNER', scanner);
    }
}

/** The plugin scanner's leaf name — the bundles ship the same tree on both OSes. */
function gstScannerLeaf() {
    return process.platform === 'win32' ? 'gst-plugin-scanner.exe' : 'gst-plugin-scanner';
}

let libraryPathActivated = false;

/**
 * Where an APPLICATION carries the shared libraries ITS OWN typelibs name by bare
 * leaf — `GJSIFY_GI_LIBRARY_PATH`, `:`-separated (`;` on win32).
 *
 * THE GAP THIS CLOSES is a different one from the note below. An app shipping a GI
 * library of its own (`gjsify.ship.bundledTypelibs`) stages the typelib and its
 * backer side by side and points `GI_TYPELIB_PATH` there, so GI finds the typelib
 * and then `g_module_open`s a bare leaf nothing has located. The launcher's
 * `LD_LIBRARY_PATH` covers that on linux; on macOS no environment variable can,
 * because dyld strips every `DYLD_*` from a restricted process and a signed,
 * hardened `.app` IS restricted — so a launcher depending on one works unsigned and
 * breaks at signing time. The dirs below do not cover it either: they answer "where
 * is the GTK stack", never "where are this application's own libraries". Neither
 * does `dirname(GI_TYPELIB_PATH entry)`: {@link systemGiLibraryDirs} derives a
 * libdir that way because GI's INSTALL layout puts typelibs in
 * `<libdir>/girepository-1.0/`, and an app stages the pair FLAT, so that derivation
 * yields the directory's PARENT — a real path holding nothing.
 *
 * Only ABSOLUTE entries are kept: a relative one resolves against the working
 * directory, which for a double-clicked `.app` is `/`. PURE in its inputs, so the
 * win32 dialect is executable from any host.
 * @param {object} [opts]
 * @param {NodeJS.Platform | string} [opts.platform]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {string[]} absolute directories, in the order the variable listed them
 */
export function appGiLibraryDirs({ platform = process.platform, env = process.env } = {}) {
    const isAbsolute = platform === 'win32' ? win32.isAbsolute : posix.isAbsolute;
    const out = [];
    for (const dir of splitSearchPath(env.GJSIFY_GI_LIBRARY_PATH, platform === 'win32' ? ';' : ':')) {
        if (isAbsolute(dir) && !out.includes(dir)) out.push(dir);
    }
    return out;
}

/**
 * Tell GI where the shared libraries its typelibs name by BARE LEAF actually are
 * — for whichever GTK the policy chose plus whatever the app carries itself, and
 * WITHOUT a loader environment variable.
 *
 * `GJSIFY_GI_LIBRARY_PATH` is not a counter-example: it is read by THIS process, in
 * JS, and handed to GI through the binding. dyld never sees it — which is the whole
 * point, because dyld is what refuses to see `DYLD_*` in a signed, hardened app.
 *
 * THE GAP THIS CLOSES. A typelib records its backer as `libgtk-4.1.dylib`, and on
 * macOS neither a relocated bundle's `lib` dir nor Homebrew's `/usr/local/lib` is
 * on dyld's search path. Node papers over it in {@link maybeReexecForGtkRuntime}
 * by re-execing with `DYLD_FALLBACK_LIBRARY_PATH` set — a Node-shaped re-exec, so
 * it returns early on bun and deno, which got NO loader repair and died at the
 * first widget behind three errors that all point elsewhere (`GtkWidget is not
 * registered…`, `Adw.Application has no property 'application-id'`, `Gtk.GLArea is
 * not a subclassable GObject type`). Measured on the macOS 15.7.9 x86_64 VM.
 *
 * `gi_repository_prepend_library_path()` is GI's own answer, so nothing is
 * captured at process launch: identical on node, bun and deno, no re-exec, and the
 * environment is left alone. The env paths elsewhere in this module stay — they
 * still cover a dylib pulled in by ANOTHER dylib's link closure, which never
 * passes through GI.
 *
 * The GTK dirs come from `gtkSource()`, not a second opinion: the bundle's
 * `libDir` for `bundle`, `systemGiLibraryDirs()` for `system` — the pair the
 * re-exec composes. Mixing them is the two-copies hazard #920 records. The
 * application's own dirs ({@link appGiLibraryDirs}) are added on TOP of whichever
 * of those the policy picked, and independently of it: an app carrying its own GI
 * library needs it found whether the GTK behind it is a bundle, the host's, or —
 * `source === 'none'` — neither.
 *
 * ORDER: the app's entries come FIRST. That only decides an OVERLAP — a leaf both
 * places hold — since a name only one of them has is found either way. An
 * explicitly-set variable is consent and outranks an inferred location (the
 * precedence `GJSIFY_GTK_RUNTIME` already has over the probed bundle candidates),
 * and on an overlap the app's copy is the one its OWN typelib was compiled against:
 * the pair ships as a unit, and splitting it is not a missing library but an ABI
 * mismatch — #910's failure shape, the expensive one.
 *
 * Idempotent, and never fatal: an addon predating the binding changes nothing.
 * @param {{ prependLibraryPath?: (p: string) => void }} native the loaded addon
 * @returns {string[]} the directories handed to GI (empty when there was nothing to add)
 */
export function activateGiLibraryPath(native) {
    if (libraryPathActivated) return [];
    libraryPathActivated = true;
    if (typeof native?.prependLibraryPath !== 'function') return [];

    const source = gtkSource();
    const gtkDirs =
        source === 'bundle' ? [resolveGtkRuntimeBundle()?.libDir] : source === 'system' ? systemGiLibraryDirs() : [];
    const dirs = [];
    // Deduplicated: an app that names a directory the policy already found would
    // otherwise grow GI's search path by a second, identical entry.
    for (const dir of [...appGiLibraryDirs(), ...gtkDirs.filter(Boolean)]) {
        if (!dirs.includes(dir)) dirs.push(dir);
    }
    const applied = [];
    // LAST wins with a prepend, so walking in reverse leaves the array's own
    // order intact in GI's search path.
    for (const dir of dirs.reverse()) {
        native.prependLibraryPath(dir);
        applied.unshift(dir);
    }
    return applied;
}

/** TEST-ONLY: allow a spec to run the activation again. */
export function resetGiLibraryPathForTests() {
    libraryPathActivated = false;
}

let activated = null; // memoize: the activation result (idempotent)

/**
 * Activate the bundled GTK runtime for the native engine, if one is present.
 *   • typelibs — prepend the bundle's girepository-1.0 dir to the GIRepository
 *     search path (env-free, via the native prependSearchPath); this alone lets
 *     node-gi FIND the bundled typelibs without GI_TYPELIB_PATH.
 *   • native code — darwin: prepend the bundle's lib dir to
 *     process.env.DYLD_FALLBACK_LIBRARY_PATH. NB dyld captures that variable at
 *     LAUNCH, so setting it here only helps child processes / a re-exec; a bundle
 *     whose dylibs a namespace loads by leaf name still needs the value present in
 *     the launching environment (see the package README's env-free caveat).
 *     Namespaces whose dylib is already in-process via the addon's link closure
 *     (GLib/GObject/Gio/cairo) resolve regardless. win32: prepend the bundle's bin
 *     dir to process.env.PATH — already done by maybePrependGtkRuntimeDllPath before
 *     the addon loaded; re-asserted here for child processes + the runtime
 *     g_module_open of typelib backers. Windows re-reads PATH per LoadLibrary, so no
 *     launch-time capture applies (see the package README).
 * Scoped to darwin + win32 (the platforms shipping a batteries-included bundle).
 * @param {{ prependSearchPath: (p: string) => void }} native the loaded addon
 * @returns {{ dir: string, libDir: string, typelibDir: string } | null}
 */
export function activateBundledGtkRuntime(native) {
    if (activated !== null) return activated || null;
    activated = false;
    if (process.platform !== 'darwin' && process.platform !== 'win32') return null;
    if (gtkSource() !== 'bundle') return null; // the policy chose the host's GTK

    const bundle = resolveGtkRuntimeBundle();
    if (!bundle) return null;

    try {
        native.prependSearchPath(bundle.typelibDir);
    } catch {
        // A stubbed/old addon without prependSearchPath — non-fatal.
    }

    if (process.platform === 'win32') {
        const existing = process.env.PATH ?? '';
        if (!existing.split(';').filter(Boolean).includes(bundle.libDir)) {
            process.env.PATH = existing ? `${bundle.libDir};${existing}` : bundle.libDir;
        }
    } else {
        const existing = process.env.DYLD_FALLBACK_LIBRARY_PATH;
        if (!existing || !existing.split(':').includes(bundle.libDir)) {
            // Same composition as the re-exec above: the bundle's libdir first,
            // then the inherited value, then dyld's default list — which this
            // variable REPLACES rather than extends.
            process.env.DYLD_FALLBACK_LIBRARY_PATH = composeDyldFallback([bundle.libDir]);
        }
    }

    activated = bundle;
    return bundle;
}
