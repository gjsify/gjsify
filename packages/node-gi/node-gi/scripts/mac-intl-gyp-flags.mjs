// SPDX-License-Identifier: MIT
// Emit the link flags the darwin addon needs for libintl, for binding.gyp's
// `OS=="mac"` branch.
//
//   node scripts/mac-intl-gyp-flags.mjs   -> "-L<dir> -lintl", or nothing
//
// WHY ONLY DARWIN. `bindtextdomain` / `textdomain` / `bind_textdomain_codeset` are
// GNU gettext. glibc absorbs them into libc, so Linux needs no flag at all
// (`nm -D libc.so.6` lists both as weak symbols); Windows resolves them out of
// gvsbuild's `intl.dll` through the `--static` pkg-config closure the Windows
// branch already walks. macOS's libSystem has NO gettext — Homebrew's `gettext`
// formula supplies `libintl.dylib`, and GLib links it, which is how `g_dgettext`
// works there. But a Mach-O is two-level-namespaced: the addon must name the
// library it takes symbols from, so "GLib already loaded it" is not enough at LINK
// time, only at run time.
//
// Emitting NOTHING when no libintl is found is deliberate: the failure then is a
// named undefined-symbol error at link, which says more than a guessed `-L` that
// silently points somewhere wrong.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

if (process.platform !== 'darwin') process.exit(0);

function brewPrefix() {
    try {
        return execFileSync('brew', ['--prefix'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        // No Homebrew on this host — the fixed paths below still cover the two
        // standard prefixes, and MacPorts users get the honest link error.
        return '';
    }
}

function pkgConfigLibDirs() {
    const pkgConfig = process.env.PKG_CONFIG || 'pkg-config';
    try {
        const out = execFileSync(pkgConfig, ['--libs-only-L', 'glib-2.0'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out
            .split(/\s+/)
            .filter((t) => t.startsWith('-L'))
            .map((t) => t.slice(2));
    } catch {
        return [];
    }
}

// Homebrew symlinks every keg's lib/ into <prefix>/lib, so the gettext keg is
// reachable from the prefix even though glib's own .pc points at glib's cellar dir.
const prefix = brewPrefix();
const candidates = [
    ...pkgConfigLibDirs(),
    ...(prefix ? [join(prefix, 'lib')] : []),
    '/opt/homebrew/lib',
    '/usr/local/lib',
];

for (const dir of candidates) {
    if (existsSync(join(dir, 'libintl.dylib')) || existsSync(join(dir, 'libintl.a'))) {
        process.stdout.write(`-L${dir} -lintl`);
        break;
    }
}
