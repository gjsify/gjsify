// SPDX-License-Identifier: MIT
//
// Every `G_*` / `GTK_*` / `GDK_*` name this package's sources use must actually
// exist in the installed GLib, GObject, Gio and GTK headers.
//
// THE INCIDENT. `src/cpp/gjsify-webview2-win32.cpp` set an error with
// `G_IO_ERROR_WRONG_TYPE`. There is no such value in Gio. The invented name sat
// in the tree unnoticed because `src/cpp/` is the ONE translation unit no other
// host compiles, and the single job that compiles it had never reached that line:
// it was failing earlier, on a missing include path. Two defects in a row in a
// file nothing else builds, each hiding the next, one expensive Windows cycle
// apart.
//
// So this is the trade `check-def-exports.mjs` and `check-include-paths.mjs` also
// make: the symptom needs MSVC, the cause is a name that does not exist, and a
// name can be checked on the cheap host — on every pull request, in about a
// second, for the sources that job never hands to a compiler.
//
// THE COMPILER DECIDES, not a grep over headers. A name is real if it is a macro
// (`#ifdef`) or if it compiles as a value expression. That covers function-like
// macros, object-like macros and enum constants alike, which no header grep does
// reliably — `G_IO_ERROR_WRONG_TYPE` and `G_IO_ERROR_WRONG_ETAG` are one letter
// apart and only one of them is in an enum.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// PASS 2 READS gcc's DIAGNOSTIC TEXT, and gcc translates it: on a German
// workstation the message is "nicht deklariert", on an English CI runner
// "undeclared". A check whose parse depends on the host's language passes in one
// place and not the other — measured, on the first run of this script, and the
// guard below is what refused to call that a pass. So the compiler is pinned to
// the C locale rather than the parse being taught every translation.
const C_LOCALE = { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' };

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Names that CANNOT be checked here, each with the reason. An explicit list
// rather than a pattern: a silent skip is how the thing this script exists to
// catch got in.
const UNCHECKABLE = new Map([
    [
        'GDK_IS_WIN32_SURFACE',
        'declared in gdk/win32/gdkwin32.h, which only a Windows GTK build installs — ' +
            'checking it needs the gvsbuild prefix, i.e. the very job this script exists to ' +
            'stop depending on for a spelling mistake',
    ],
]);

const PRELUDE = [
    '#include <glib.h>',
    '#include <glib-object.h>',
    '#include <gio/gio.h>',
    '#include <gtk/gtk.h>',
    '',
].join('\n');

function sourcesUnder(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourcesUnder(full));
        else if (/\.(c|h|cc|cpp|hpp)$/.test(entry.name)) out.push(full);
    }
    return out;
}

// Where each name is used, so a finding names a line rather than a token.
const sites = new Map();
for (const file of sourcesUnder(join(pkgDir, 'src'))) {
    readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
            // Comments carry prose that mentions these names, so a doc comment
            // must not be able to invent one.
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
            for (const m of line.matchAll(/\b(?:G|GTK|GDK)_[A-Z0-9_]{2,}\b/g)) {
                if (m[0].startsWith('GJSIFY_')) continue;
                if (!sites.has(m[0])) sites.set(m[0], `${relative(pkgDir, file)}:${i + 1}`);
            }
        });
}

const checkable = [...sites.keys()].filter((n) => !UNCHECKABLE.has(n)).sort();
if (checkable.length === 0) {
    console.log('check-glib-constants: no GLib-family names in src/ — nothing to check.');
    process.exit(0);
}

const cflags = execFileSync('pkg-config', ['--cflags', 'glib-2.0', 'gobject-2.0', 'gio-2.0', 'gtk4'], {
    encoding: 'utf8',
})
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const dir = mkdtempSync(join(tmpdir(), 'gjsify-glib-constants-'));

// PASS 1 — which names are macros, in ONE preprocessor run. The marker holds the
// name inside a STRING LITERAL, which the preprocessor does not expand, so a
// function-like macro's name survives into the output intact.
const macroProbe = join(dir, 'macros.c');
writeFileSync(macroProbe, PRELUDE + checkable.map((n) => `#ifdef ${n}\n"@@GJSIFY_MACRO@@${n}@@"\n#endif\n`).join(''));
const preprocessed = execFileSync('gcc', ['-E', '-P', ...cflags, macroProbe], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: C_LOCALE,
});
const macros = new Set([...preprocessed.matchAll(/@@GJSIFY_MACRO@@([A-Z0-9_]+)@@/g)].map((m) => m[1]));

// PASS 2 — everything else has to compile as a VALUE. One compile; gcc reports
// each undeclared identifier once per function, and they are all in one.
const values = checkable.filter((n) => !macros.has(n));
const missing = [];
if (values.length > 0) {
    const valueProbe = join(dir, 'values.c');
    writeFileSync(
        valueProbe,
        `${PRELUDE}void gjsify_probe(void)\n{\n${values.map((n) => `    (void) (${n});`).join('\n')}\n}\n`,
    );
    try {
        execFileSync('gcc', ['-fsyntax-only', ...cflags, valueProbe], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: C_LOCALE,
        });
    } catch (error) {
        const stderr = String(error.stderr ?? '');
        for (const m of stderr.matchAll(/['‘]([A-Z0-9_]+)['’] undeclared/g)) {
            if (!missing.includes(m[1])) missing.push(m[1]);
        }
        if (missing.length === 0) {
            console.error(
                '::error::the value probe failed but named no undeclared identifier, so this ' +
                    'check is no longer reading anything. Fix the probe rather than trusting the ' +
                    `pass.\n${stderr}`,
            );
            process.exit(1);
        }
    }
}

for (const name of missing) {
    console.error(
        `::error file=packages/framework/webview2-native/${sites.get(name).split(':')[0]},` +
            `line=${sites.get(name).split(':')[1]}::${name} does not exist in the installed ` +
            'GLib/GObject/Gio/GTK headers — it is neither a macro nor a value. MSVC reports it ' +
            'as "C2065: undeclared identifier", but only once the win32 build gets that far.',
    );
}

for (const [name, reason] of UNCHECKABLE) {
    if (sites.has(name)) {
        console.log(`check-glib-constants: ${name} NOT CHECKED — ${reason}.`);
    }
}

if (missing.length > 0) {
    process.exit(1);
}

console.log(
    `check-glib-constants: ${checkable.length} GLib-family name(s) in src/ all exist ` +
        `(${macros.size} macro(s), ${values.length} value(s)).`,
);
