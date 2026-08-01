// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gtk-runtime — locate + activate a batteries-included, relocated
// GTK/GObject-Introspection runtime bundle so gi:// namespaces load with NO system
// or Homebrew GTK (Phase 2 of cross-platform node-gi). Today only darwin-arm64
// ships such a bundle (@gjsify/gtk-runtime-darwin-arm64); this is a no-op on every
// other platform, and harmless when no bundle is present (the addon then uses the
// host's GTK exactly as before).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

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

/**
 * Make the bundled GTK runtime genuinely env-free by RE-EXECING this process once
 * with `DYLD_FALLBACK_LIBRARY_PATH` (+ `GI_TYPELIB_PATH`) pointed at the bundle.
 *
 * Why a re-exec and not just `process.env` mutation: on macOS, dyld captures
 * `DYLD_FALLBACK_LIBRARY_PATH` at PROCESS LAUNCH, so setting it from JS never
 * affects the running dyld. It is load-bearing beyond the addon's own link
 * closure: GObject-Introspection resolves a type's `get_type()` (e.g. for
 * `registerClass` subclassing) — and the Pango/Gdk/Graphene backers — via
 * `g_module_open(<leaf soname>)`, and dyld will NOT satisfy a bare-leaf dlopen
 * from an `@loader_path`-loaded image. Re-launching with the fallback set (exactly
 * what the Homebrew-based CI leg does) resolves every such leaf lookup from the
 * bundle. Guarded by a sentinel env var so it fires AT MOST ONCE; a no-op unless
 * darwin + a bundle is present + the fallback does not already cover it.
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
    if (process.env[REEXEC_SENTINEL]) return; // already re-exec'd — the child path
    const bundle = resolveGtkRuntimeBundle();
    if (!bundle) return; // strict no-op when no bundle is present

    const curDyld = process.env.DYLD_FALLBACK_LIBRARY_PATH ?? '';
    if (curDyld.split(':').filter(Boolean).includes(bundle.libDir)) return; // already covered

    // Lazily load node:child_process ONLY here (darwin + bundle present + not yet
    // covered) — see the top-of-file note; keeps it out of non-darwin module graphs.
    const { spawnSync } = require('node:child_process');
    const curTypelib = process.env.GI_TYPELIB_PATH ?? '';
    const env = {
        ...process.env,
        [REEXEC_SENTINEL]: '1',
        DYLD_FALLBACK_LIBRARY_PATH: curDyld ? `${bundle.libDir}:${curDyld}` : `${bundle.libDir}:/usr/lib`,
        GI_TYPELIB_PATH: curTypelib ? `${bundle.typelibDir}:${curTypelib}` : bundle.typelibDir,
    };
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
            process.env.DYLD_FALLBACK_LIBRARY_PATH = existing
                ? `${bundle.libDir}:${existing}`
                : `${bundle.libDir}:/usr/lib`;
        }
    }

    activated = bundle;
    return bundle;
}
