// SPDX-License-Identifier: MIT
// gi-runtime-android's libintl (the .mo reader that replaces the sysroot's proxy-libintl),
// compiled for the HOST and driven by a C probe: the catalog reader, plural forms, msgctxt,
// language fallback, and — the reason it exists — LANGUAGE honoured under a C locale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../gi-runtime-android/libintl/libintl.c');
const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const skip = !have('cc') || !have('msgfmt') ? 'needs cc and msgfmt' : false;

const PO = (lang, plural, body) => `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: ${lang}\\n"
"Plural-Forms: ${plural}\\n"
${body}`;

const DE = PO(
    'de',
    'nplurals=2; plural=(n != 1);',
    `
msgid "Save"
msgstr "Speichern"

msgctxt "menu"
msgid "Open"
msgstr "Öffnen"

msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d Datei"
msgstr[1] "%d Dateien"
`,
);
const PL = PO(
    'pl',
    'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
    `
msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d plik"
msgstr[1] "%d pliki"
msgstr[2] "%d plików"
`,
);

const PROBE = `
#include <stdio.h>
#include <stdlib.h>
char *g_libintl_bindtextdomain(const char *, const char *);
char *g_libintl_dgettext(const char *, const char *);
char *g_libintl_dngettext(const char *, const char *, const char *, unsigned long);
int main(int argc, char **argv) {
    (void)argc;
    g_libintl_bindtextdomain("t", argv[1]);
    printf("%s\\n", g_libintl_dgettext("t", "Save"));
    printf("%s\\n", g_libintl_dgettext("t", "menu\\004Open"));
    printf("%s\\n", g_libintl_dgettext("t", "Missing"));
    printf("%s\\n", g_libintl_dngettext("t", "%d file", "%d files", 1));
    printf("%s\\n", g_libintl_dngettext("t", "%d file", "%d files", 5));
    printf("%s\\n", g_libintl_dngettext("t", "%d file", "%d files", 22));
    printf("%s\\n", g_libintl_dngettext("t", "%d file", "%d files", 12));
    return 0;
}`;

function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'libintl-'));
    for (const [lang, po] of [
        ['de', DE],
        ['pl', PL],
    ]) {
        mkdirSync(join(dir, 'locale', lang, 'LC_MESSAGES'), { recursive: true });
        writeFileSync(join(dir, `${lang}.po`), po);
        const r = spawnSync('msgfmt', [
            '-o',
            join(dir, 'locale', lang, 'LC_MESSAGES', 't.mo'),
            join(dir, `${lang}.po`),
        ]);
        assert.equal(r.status, 0, String(r.stderr));
    }
    writeFileSync(join(dir, 'probe.c'), PROBE);
    const cc = spawnSync('cc', ['-Wall', '-Wextra', '-Werror', '-o', join(dir, 'probe'), join(dir, 'probe.c'), src]);
    assert.equal(cc.status, 0, String(cc.stderr));
    return dir;
}

function run(dir, env) {
    const r = spawnSync(join(dir, 'probe'), [join(dir, 'locale')], {
        env: { PATH: process.env.PATH, ...env },
        encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim().split('\n');
}

test('LANGUAGE selects the catalog although the locale is C (UTF-8, msgctxt, plurals)', { skip }, () => {
    const dir = setup();
    assert.deepEqual(run(dir, { LANGUAGE: 'de_DE:de:C', LC_ALL: 'C' }), [
        'Speichern',
        'Öffnen',
        'Missing',
        '%d Datei',
        '%d Dateien',
        '%d Dateien',
        '%d Dateien',
    ]);
});

test('three-form plural expression (Polish) is evaluated, not guessed', { skip }, () => {
    const dir = setup();
    assert.deepEqual(run(dir, { LANGUAGE: 'pl' }).slice(3), ['%d plik', '%d plików', '%d pliki', '%d plików']);
});

test('no language, or C first, answers the msgid; LANG is the fallback', { skip }, () => {
    const dir = setup();
    assert.equal(run(dir, {})[0], 'Save');
    assert.equal(run(dir, { LANGUAGE: 'C:de' })[0], 'Save');
    assert.equal(run(dir, { LANG: 'de_DE.UTF-8' })[0], 'Speichern');
    assert.equal(run(dir, { LANGUAGE: 'fr:de' })[0], 'Speichern');
});
