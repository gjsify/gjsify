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
import { existsSync } from 'node:fs';
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

if (mode === '--includes') {
    const dirs = tokens(pkgConfigOut(['--cflags-only-I']))
        .filter((t) => t.startsWith('-I'))
        .map((t) => stripQuotes(t.slice(2)));
    process.stdout.write([...new Set(dirs)].join('\n'));
} else if (mode === '--libs') {
    const out = pkgConfigOut(['--static', '--libs']);
    const libDirs = [];
    const libNames = [];
    for (const t of tokens(out)) {
        if (t.startsWith('-L')) libDirs.push(stripQuotes(t.slice(2)));
        else if (t.startsWith('-l')) libNames.push(t.slice(2));
        else if (t.toLowerCase().endsWith('.lib')) libNames.push(t.replace(/\.lib$/i, ''));
    }
    const searchDirs = [...new Set(libDirs)];
    const resolved = [];
    for (const name of libNames) {
        let found = null;
        for (const dir of searchDirs) {
            for (const cand of [`${name}.lib`, `lib${name}.lib`]) {
                const p = join(dir, cand);
                if (existsSync(p)) {
                    found = p;
                    break;
                }
            }
            if (found) break;
        }
        // Fall back to the bare `<name>.lib`: a system import lib (ws2_32.lib, …)
        // lives on the linker's default search path, not in the gvsbuild tree.
        resolved.push(found ?? `${name}.lib`);
    }
    process.stdout.write([...new Set(resolved)].join('\n'));
} else {
    console.error('usage: node scripts/win-gi-gyp-flags.mjs <--includes|--libs>');
    process.exit(2);
}
