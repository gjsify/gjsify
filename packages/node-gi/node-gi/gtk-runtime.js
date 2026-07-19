// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gtk-runtime — locate + activate a batteries-included, relocated
// GTK/GObject-Introspection runtime bundle so gi:// namespaces load with NO system
// or Homebrew GTK (Phase 2 of cross-platform node-gi). Today only darwin-arm64
// ships such a bundle (@gjsify/gtk-runtime-darwin-arm64); this is a no-op on every
// other platform, and harmless when no bundle is present (the addon then uses the
// host's GTK exactly as before).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url)); // package root

// Sentinel: set on the re-exec so a bundle-activated child never re-execs again.
const REEXEC_SENTINEL = 'GJSIFY_GTK_REEXEC';

/**
 * Resolve the GTK runtime bundle directory for this platform, or `null`. A valid
 * bundle dir contains `lib/` (relocated dylibs) + `girepository-1.0/` (typelibs).
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

    for (const dir of candidates) {
        if (!dir) continue;
        const libDir = join(dir, 'lib');
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
    if (process.platform !== 'darwin') return;
    if (process.env[REEXEC_SENTINEL]) return; // already re-exec'd — the child path
    const bundle = resolveGtkRuntimeBundle();
    if (!bundle) return;

    const curDyld = process.env.DYLD_FALLBACK_LIBRARY_PATH ?? '';
    if (curDyld.split(':').filter(Boolean).includes(bundle.libDir)) return; // already covered

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

let activated = null; // memoize: the activation result (idempotent)

/**
 * Activate the bundled GTK runtime for the native engine, if one is present.
 *   • typelibs — prepend the bundle's girepository-1.0 dir to the GIRepository
 *     search path (env-free, via the native prependSearchPath); this alone lets
 *     node-gi FIND the bundled typelibs without GI_TYPELIB_PATH.
 *   • dylibs — prepend the bundle's lib dir to process.env.DYLD_FALLBACK_LIBRARY_PATH.
 *     NB dyld captures that variable at LAUNCH, so setting it here only helps
 *     child processes / a re-exec; a bundle whose dylibs a namespace loads by
 *     leaf name still needs the value present in the launching environment (see
 *     the package README's env-free caveat). Namespaces whose dylib is already
 *     in-process via the addon's link closure (GLib/GObject/Gio/cairo) resolve
 *     regardless.
 * Currently scoped to darwin (the only platform shipping a relocated bundle).
 * @param {{ prependSearchPath: (p: string) => void }} native the loaded addon
 * @returns {{ dir: string, libDir: string, typelibDir: string } | null}
 */
export function activateBundledGtkRuntime(native) {
    if (activated !== null) return activated || null;
    activated = false;
    if (process.platform !== 'darwin') return null;

    const bundle = resolveGtkRuntimeBundle();
    if (!bundle) return null;

    try {
        native.prependSearchPath(bundle.typelibDir);
    } catch {
        // A stubbed/old addon without prependSearchPath — non-fatal.
    }

    const existing = process.env.DYLD_FALLBACK_LIBRARY_PATH;
    if (!existing || !existing.split(':').includes(bundle.libDir)) {
        process.env.DYLD_FALLBACK_LIBRARY_PATH = existing ? `${bundle.libDir}:${existing}` : `${bundle.libDir}:/usr/lib`;
    }

    activated = bundle;
    return bundle;
}
