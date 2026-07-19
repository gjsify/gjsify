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
    return execFileSync(pkgConfig, ['--define-prefix', ...extraArgs, ...PKGS], {
        encoding: 'utf8',
    }).trim();
}

function tokens(s) {
    // pkg-config separates with spaces; paths from gvsbuild carry no spaces.
    return s.split(/\s+/).filter(Boolean);
}

function stripQuotes(s) {
    return s.replace(/^"(.*)"$/, '$1');
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
    // `--static` pulls the Requires.private include dirs too — girepository-2.0.pc
    // has `Requires.private: … libffi`, and girffi.h does `#include <ffi.h>`; the
    // non-static --cflags omits libffi's include dir, so the addon fails to compile
    // (C1083: Cannot open include file 'ffi.h').
    const dirs = tokens(pkgConfigOut(['--static', '--cflags-only-I']))
        .filter((t) => t.startsWith('-I'))
        .map((t) => stripQuotes(t.slice(2)));
    // Belt-and-suspenders: gvsbuild installs libffi's ffi.h into the bare include
    // root (which MSVC does not auto-search). Add GTK_PREFIX/include, and if ffi.h
    // still isn't covered, locate it under the tree and add its dir.
    const prefix = process.env.GTK_PREFIX;
    if (prefix) {
        dirs.push(join(prefix, 'include'));
        if (!dirs.some((d) => existsSync(join(d, 'ffi.h')))) {
            const ffiDir =
                findHeaderDir(join(prefix, 'include'), 'ffi.h') ??
                findHeaderDir(join(prefix, 'lib'), 'ffi.h');
            if (ffiDir) dirs.push(ffiDir);
        }
    }
    process.stdout.write([...new Set(dirs.filter((d) => existsSync(d)))].join('\n'));
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
    const DIRECT_LIBS = [
        'girepository-2.0',
        'gio-2.0',
        'gobject-2.0',
        'gmodule-2.0',
        'glib-2.0',
        'ffi',
        'cairo',
    ];
    // Locate the import-lib dir: GTK_PREFIX/lib, else pkg-config's -L.
    const searchDirs = [];
    if (process.env.GTK_PREFIX) searchDirs.push(join(process.env.GTK_PREFIX, 'lib'));
    for (const t of tokens(pkgConfigOut(['--libs-only-L']))) {
        if (t.startsWith('-L')) searchDirs.push(stripQuotes(t.slice(2)));
    }
    const resolved = [];
    for (const name of [...new Set(DIRECT_LIBS)]) {
        let found = null;
        for (const dir of [...new Set(searchDirs)]) {
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
    process.stdout.write([...new Set(resolved)].join('\n'));
} else {
    console.error('usage: node scripts/win-gi-gyp-flags.mjs <--includes|--libs>');
    process.exit(2);
}
