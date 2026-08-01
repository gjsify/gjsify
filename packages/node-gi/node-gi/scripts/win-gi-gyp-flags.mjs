// SPDX-License-Identifier: MIT
// Emit Windows/MSVC-ready include dirs or import-lib paths for binding.gyp's
// `OS=="win"` branch, derived from pkg-config/pkgconf (gvsbuild ships pkgconf.exe
// + a pkg-config.exe copy in bin/, put on PATH by the CI job).
//
//   node scripts/win-gi-gyp-flags.mjs --includes   -> one bare include dir per line
//   node scripts/win-gi-gyp-flags.mjs --libs        -> one import-lib path per line
//
// gyp's msvs generator ignores `cflags`/`cflags_cc`/`xcode_settings` (those feed
// the make/xcode generators only), so the Windows branch must feed BARE include
// dirs into `include_dirs` and FULL .lib paths into `libraries` — the exact shapes
// gyp hands straight to cl.exe / link.exe. Emitting resolved paths here avoids the
// `-I`/`-l`/`-L`→MSVC translation ambiguity of raw pkg-config output going through
// gyp.
//
// --libs uses `--static` so the PRIVATE closure is pulled: girepository-2.0.pc has
// `Requires.private: gmodule-no-export-2.0, gio-2.0, libffi` and node-gi calls
// ffi_call / Gio directly. On Linux the dynamic linker resolves those lazily from
// the shared-object global scope, but MSVC/PE resolves every import at link time,
// so the private libs must be named explicitly.
//
// `--define-prefix` makes pkgconf recompute each .pc's `prefix` from the .pc file
// location, so the bundle works regardless of where gvsbuild's tree is extracted
// (its .pc files bake an absolute build-machine prefix otherwise).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PKGS = ['girepository-2.0', 'cairo'];
const mode = process.argv[2];
const pkgConfig = process.env.PKG_CONFIG || 'pkg-config';

function pkgConfigOut(extraArgs) {
    // Exit-tolerant: gvsbuild's pkgconf can exit non-zero (e.g. `--static` walks a
    // Requires.private graph and trips over a missing .pc) yet still print the
    // resolvable flags. execFileSync THROWS on a non-zero exit — so capture the
    // stdout it attached to the error instead of letting the whole helper crash
    // (that empty-stdout crash left include_dirs blank → C1083 on ffi.h).
    try {
        return execFileSync(pkgConfig, ['--define-prefix', ...extraArgs, ...PKGS], {
            encoding: 'utf8',
        }).trim();
    } catch (error) {
        return typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    }
}

function tokens(s) {
    // pkg-config separates with spaces; paths from gvsbuild carry no spaces.
    return s.split(/\s+/).filter(Boolean);
}

function stripQuotes(s) {
    return s.replace(/^"(.*)"$/, '$1');
}

// gyp/MSBuild + cl.exe accept forward slashes and treat them uniformly; emit them
// so an include dir / .lib path never carries a backslash that a downstream
// generator might mis-handle (the pkg-config dirs already use forward slashes).
function toGyp(p) {
    return p.replace(/\\/g, '/');
}

// Shallow BFS for a header under `root` (bounded depth so we never walk the whole
// ~300 MB GTK tree). Returns the CONTAINING directory, or null.
function findHeaderDir(root, filename, maxDepth = 4) {
    const queue = [[root, 0]];
    while (queue.length) {
        const [dir, depth] = queue.shift();
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (e.isFile() && e.name === filename) return dir;
        }
        if (depth < maxDepth) {
            for (const e of entries) {
                if (e.isDirectory()) queue.push([join(dir, e.name), depth + 1]);
            }
        }
    }
    return null;
}

if (mode === '--includes') {
    // NON-static --cflags-only-I: on gvsbuild `--static` exits non-zero (a private
    // .pc misses) and once threw the whole helper, blanking include_dirs. The plain
    // form resolves glib-2.0/lib-glib-2.0-include/cairo cleanly. It does NOT emit
    // libffi's include dir (libffi is Requires.private), but the addon needs <ffi.h>
    // via girffi.h — the GTK_PREFIX fallback below supplies it.
    const dirs = tokens(pkgConfigOut(['--cflags-only-I']))
        .filter((t) => t.startsWith('-I'))
        .map((t) => stripQuotes(t.slice(2)));
    const prefix = process.env.GTK_PREFIX;
    if (prefix) {
        // Guaranteed base from the known gvsbuild layout (in case pkg-config yields
        // nothing) PLUS the bare include root, where gvsbuild installs libffi's
        // ffi.h + ffitarget.h (MSVC does not auto-search a prefix include root).
        dirs.push(
            join(prefix, 'include'),
            join(prefix, 'include', 'glib-2.0'),
            join(prefix, 'lib', 'glib-2.0', 'include'),
            join(prefix, 'include', 'cairo'),
        );
        // Last resort: locate ffi.h anywhere under the tree and add its dir.
        if (!dirs.some((d) => existsSync(join(d, 'ffi.h')))) {
            const ffiDir =
                findHeaderDir(join(prefix, 'include'), 'ffi.h') ?? findHeaderDir(join(prefix, 'lib'), 'ffi.h');
            if (ffiDir) dirs.push(ffiDir);
        }
    }
    process.stdout.write([...new Set(dirs.filter((d) => existsSync(d)).map(toGyp))].join('\n'));
} else if (mode === '--libs') {
    // A SHARED addon links each GTK/GLib DLL through its DIRECT import lib and lets
    // that DLL resolve its own private deps at load — so link only the import libs
    // whose symbols the addon's own object files reference, NOT pkg-config's
    // `--static` transitive closure (which over-pulls cairo's/glib's private static
    // deps — libpng/freetype/harfbuzz/pcre2/`-lz`→zlib.lib — whose `-l`→`.lib` names
    // don't all map on gvsbuild, breaking the link). This DIRECT set is known + stable:
    //   girepository-2.0  the gi_* engine
    //   glib/gobject/gio/gmodule-2.0  g_*/GObject/GValue/GSignal/GClosure/Gio
    //   ffi  ffi_call / ffi_closure_alloc (girffi + the vfunc/callback trampolines)
    //   cairo  the native cairo foreign-struct binding (src/cairo.cc)
    // Pango/GdkPixbuf/Graphene are NOT linked — the conformance programs load their
    // typelibs at RUNTIME (girepository dlopens the DLL by soname), not at link time.
    const DIRECT_LIBS = ['girepository-2.0', 'gio-2.0', 'gobject-2.0', 'gmodule-2.0', 'glib-2.0', 'ffi', 'cairo'];
    // Locate the import-lib dir: GTK_PREFIX/lib, else pkg-config's -L.
    const searchDirs = [];
    if (process.env.GTK_PREFIX) searchDirs.push(join(process.env.GTK_PREFIX, 'lib'));
    for (const t of tokens(pkgConfigOut(['--libs-only-L']))) {
        if (t.startsWith('-L')) searchDirs.push(stripQuotes(t.slice(2)));
    }
    const resolved = [];
    for (const name of new Set(DIRECT_LIBS)) {
        let found = null;
        for (const dir of new Set(searchDirs)) {
            for (const cand of [`${name}.lib`, `lib${name}.lib`]) {
                const p = join(dir, cand);
                if (existsSync(p)) {
                    found = p;
                    break;
                }
            }
            if (found) break;
        }
        if (found) resolved.push(found);
        else if (name !== 'gmodule-2.0') {
            // gmodule is optional (girepository may pull it internally); everything
            // else is required — surface a missing import lib loudly.
            throw new Error(`win-gi-gyp-flags: import lib for '${name}' not found under ${searchDirs.join(', ')}`);
        }
    }
    process.stdout.write([...new Set(resolved.map(toGyp))].join('\n'));
} else {
    console.error('usage: node scripts/win-gi-gyp-flags.mjs <--includes|--libs>');
    process.exit(2);
}
