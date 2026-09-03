// SPDX-License-Identifier: MIT
//
// Every quoted `#include` in this package's sources must resolve against the
// include path meson gives the library target.
//
// THE INCIDENT. `src/cpp/gjsify-webview2-win32.cpp` includes
// `"gjsify-webview2-backend.h"`, which lives in `src/c/`. A quoted include
// searches the INCLUDING file's directory first and the target's include path
// after that, so with no `include_directories` on the target the seam header was
// unreachable from `src/cpp/` — on every compiler. The first Windows run of this
// package failed with MSVC C1083 after the Fedora job that compiles the portable
// half had already gone green, because `src/cpp/` is the one translation unit no
// other host compiles.
//
// So this is the cheap half of a win32-only failure, the same trade
// `check-def-exports.mjs` makes: the symptom needs MSVC, the cause is a path that
// does not exist, and a path is readable anywhere. It runs on the FEDORA job, on
// every pull request, in milliseconds — including for the sources that job never
// hands to a compiler.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const meson = readFileSync(join(pkgDir, 'meson.build'), 'utf8');

// The target's include path, as meson will pass it. A `include_directories()`
// call this script cannot see is the failure mode worth naming rather than
// guessing around: an empty set here means every cross-directory include is
// reported, which is what happened.
const includeDirs = [...meson.matchAll(/include_directories\(([^)]*)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((a) => a[1]))
    .map((dir) => join(pkgDir, dir));

function sourcesUnder(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...sourcesUnder(full));
        } else if (/\.(c|h|cc|cpp|hpp)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const findings = [];
for (const file of sourcesUnder(join(pkgDir, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)) {
        const included = m[1];
        // The including file's own directory, then the target's include path —
        // the order both MSVC and GCC search a quoted include in.
        const candidates = [join(dirname(file), included), ...includeDirs.map((d) => join(d, included))];
        if (!candidates.some((c) => existsSync(c))) {
            findings.push({ file: relative(pkgDir, file), included });
        }
    }
}

if (findings.length > 0) {
    for (const { file, included } of findings) {
        console.error(
            `::error file=packages/framework/webview2-native/${file}::#include "${included}" ` +
                'resolves neither beside this file nor on the include path meson gives the ' +
                `library target (${includeDirs.length === 0 ? 'which is empty — no include_directories() in meson.build' : includeDirs.map((d) => relative(pkgDir, d)).join(', ')}). ` +
                'The compiler that reaches this translation unit fails with C1083 / "No such file or directory".',
        );
    }
    process.exit(1);
}

console.log(
    `check-include-paths: every quoted #include in src/ resolves against ${includeDirs.length} include ` +
        'directory/ies plus its own.',
);
