// SPDX-License-Identifier: MIT
// The process locale, and the translation that depends on it.
//
// THE DEFECT THIS PINS. A C program starts in the "C" locale and Node never leaves
// it — neither does node-gtk, the derivation source. GNU gettext refuses to
// translate while LC_MESSAGES is C, so EVERY `--app node` application shipped
// untranslated on every platform, with the catalogs present and found. GJS does not
// have the bug because its entry point opens with `setlocale(LC_ALL, "")`
// (refs/gjs/gjs/console.cpp), so the same source translated under `--app gjs` and
// not under `--app node`.
//
// The discriminator has to be a msgid whose translation DIFFERS from it. Measured
// while diagnosing this: "Tutorial" is its own German translation, so a catalog
// that is never consulted answers it correctly and the test proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Gettext from '../gettext.js';
import { writeMoCatalog } from './mo-catalog.mjs';
import { FIXTURE_LANGUAGE, NO_LOCALE_DIAGNOSTIC, findTranslatableLocale } from './locale-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// `fixtures/` sits beside `test/`, not inside it: node's default test glob claims
// every `.mjs` under a `test/` directory, so a probe placed there is ALSO run as a
// test file — with no arguments, reporting its own usage error as a suite failure.
const probe = join(here, '..', 'fixtures', 'locale-probe.mjs');

const DOMAIN = 'nodegi-locale-test';
const MSGID = 'Stack filled';
const MSGSTR = 'Stapel voll';

// One catalog for the whole file, in a temp dir the fixture writer creates.
const localeRoot = mkdtempSync(join(tmpdir(), 'node-gi-locale-'));
writeMoCatalog(join(localeRoot, FIXTURE_LANGUAGE, 'LC_MESSAGES', `${DOMAIN}.mo`), [
    { msgid: MSGID, msgstr: MSGSTR },
    { msgid: '%d file', plural: '%d files', plurals: ['%d Datei', '%d Dateien'] },
    { msgid: 'Open', msgstr: 'Öffnen (ohne Kontext)' },
    { msgid: 'Open', context: 'toolbar', msgstr: 'Öffnen (Werkzeugleiste)' },
]);
process.on('exit', () => rmSync(localeRoot, { recursive: true, force: true }));

const locale = findTranslatableLocale();
if (locale === null) console.error(`# locale.test.mjs: ${NO_LOCALE_DIAGNOSTIC}`);

/** Run the probe in a fresh process under `env` and parse its report. */
function runProbe(env) {
    const out = execFileSync(process.execPath, [probe, localeRoot, DOMAIN, MSGID], {
        encoding: 'utf8',
        env: { ...process.env, NODE_GI_NATIVE: process.env.NODE_GI_NATIVE ?? 'build', ...env },
    });
    return JSON.parse(out);
}

// The locale the child is asked to adopt. With a generated locale available this
// is that one; otherwise C.UTF-8, which glibc always accepts and which is still a
// discriminator — the defect leaves the process in plain "C", never in "C.UTF-8".
const childLocale = locale ?? 'C.UTF-8';

test('a fresh node-gi process adopts the environment locale, not "C"', () => {
    const report = runProbe({ LC_ALL: childLocale, LANGUAGE: '' });
    assert.equal(
        report.startupMessages,
        childLocale,
        `the process was in ${JSON.stringify(report.startupMessages)} after loading node-gi, ` +
            `not ${childLocale} — gettext does not translate outside a real locale`,
    );
    // LC_ALL is asserted by SHAPE, not by name: `setlocale(LC_ALL, NULL)` answers
    // with a single name only while every category agrees, and reports a composite
    // (`de_DE.UTF-8/de_DE.UTF-8/…` on darwin, `LC_CTYPE=…;LC_NUMERIC=…` on glibc)
    // otherwise. The category gettext actually reads is asserted exactly above.
    assert.equal(typeof report.startupAll, 'string');
    assert.notEqual(report.startupAll, 'C');
});

test(
    'setlocale reports the locale rather than the addon guessing it',
    { skip: locale === null && NO_LOCALE_DIAGNOSTIC },
    () => {
        // Query form: `setlocale(category, null)` REPORTS the locale — a null answer is
        // the stub's, and it is what let the gate that once used this call report "no
        // locale on this host" for the very defect it was gating.
        const before = Gettext.setlocale(Gettext.LocaleCategory.ALL, null);
        assert.equal(typeof before, 'string', 'setlocale(ALL, null) must report the current locale');
        assert.equal(Gettext.setlocale(Gettext.LocaleCategory.ALL, null), before);
        // A locale the host does not have answers null and changes nothing. Asked on
        // CTYPE because every C library has that category — the MSVC CRT has no
        // LC_MESSAGES and answers null there for valid values too, which would make
        // the rejection indistinguishable from the category simply not existing.
        assert.equal(Gettext.setlocale(Gettext.LocaleCategory.CTYPE, 'no-such-locale.invalid'), null);
        assert.equal(Gettext.setlocale(Gettext.LocaleCategory.ALL, null), before);
    },
);

test(
    'GLib.dgettext translates — the C path, no JS shim involved',
    { skip: locale === null && NO_LOCALE_DIAGNOSTIC },
    () => {
        const report = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE });
        assert.equal(report.glibDgettext, MSGSTR);
    },
);

test(
    'the Gettext surface translates through the bound domain',
    { skip: locale === null && NO_LOCALE_DIAGNOSTIC },
    () => {
        const report = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE });
        assert.equal(report.dgettext, MSGSTR);
        // textdomain() made it the default domain, so the undecorated call resolves too.
        assert.equal(report.gettext, MSGSTR);
        assert.equal(report.domainGettext, MSGSTR);
    },
);

test('plural and context lookups read the catalog', { skip: locale === null && NO_LOCALE_DIAGNOSTIC }, () => {
    const report = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE });
    assert.equal(report.ngettextOne, '%d Datei');
    assert.equal(report.ngettextMany, '%d Dateien');
    assert.equal(report.pgettext, 'Öffnen (Werkzeugleiste)');
    // The context key is part of the lookup, not decoration: the same msgid without
    // one must reach the OTHER entry.
    assert.equal(report.gettextOpen, 'Öffnen (ohne Kontext)');
});

// Where LC_MESSAGES is a real category — glibc and Darwin — the constant is proved
// BEHAVIOURALLY, with no table of LC_* values to keep in sync: forcing it back to
// "C" must stop message lookup. This is the assertion that catches a wrong number,
// and a wrong number is what the module used to ship (glibc's table everywhere, so
// its MESSAGES addressed LC_TIME on macOS).
//
// NOT on Windows, and this is a platform TRUTH rather than a skipped case: the MSVC
// CRT has no LC_MESSAGES, GNU gettext resolves messages from the environment there,
// and `setlocale` answers null for that category whatever it is handed. The Windows
// test below asserts exactly that, so neither platform goes unmeasured.
const messagesIsACategory = process.platform !== 'win32';

test(
    "LocaleCategory.MESSAGES is the C library's LC_MESSAGES, not a guessed number",
    {
        skip:
            (locale === null && NO_LOCALE_DIAGNOSTIC) ||
            (!messagesIsACategory && 'the MSVC CRT has no LC_MESSAGES — see the win32 case below'),
    },
    () => {
        const report = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE });
        assert.equal(report.dgettext, MSGSTR);
        const off = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE, NODE_GI_TEST_MESSAGES_C: '1' });
        assert.equal(
            off.dgettext,
            MSGID,
            'setting LocaleCategory.MESSAGES to "C" did not stop message lookup — the constant does not address LC_MESSAGES',
        );
    },
);

test(
    'on win32 LANGUAGE outranks LC_MESSAGES, so forcing it to C keeps translating',
    {
        skip:
            (locale === null && NO_LOCALE_DIAGNOSTIC) ||
            (messagesIsACategory && 'POSIX host — the behavioural case above applies'),
    },
    () => {
        // MEASURED on the Windows CI leg, and it corrected an assumption: the MSVC
        // CRT has no LC_MESSAGES, but GNU gettext's <libintl.h> redirects setlocale
        // to its own libintl_setlocale on native Windows, which DOES carry the
        // category. So the call takes and reports the prior name (a string, not the
        // null a CRT-only category would give).
        assert.equal(typeof Gettext.setlocale(Gettext.LocaleCategory.MESSAGES, 'C'), 'string');
        // What differs from POSIX is the PRECEDENCE. glibc ignores LANGUAGE once the
        // message locale is "C", which is what makes the behavioural assertion above
        // a discriminator there; gettext's Windows port keeps honouring LANGUAGE, so
        // the same program goes on translating. Asserted rather than skipped, so the
        // day that changes this leg says so.
        const off = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE, NODE_GI_TEST_MESSAGES_C: '1' });
        assert.equal(off.dgettext, MSGSTR);
        const report = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE });
        assert.equal(report.dgettext, MSGSTR);
    },
);

test('the language list and the catalog agree', { skip: locale === null && NO_LOCALE_DIAGNOSTIC }, () => {
    // GLib.get_language_names() reads the environment directly and was ALREADY
    // correct while every gettext lookup was English — the split that made the
    // Windows report read as "only some strings are translated".
    const report = runProbe({ LC_ALL: locale, LANGUAGE: FIXTURE_LANGUAGE });
    assert.ok(
        report.languageNames.includes(FIXTURE_LANGUAGE),
        `expected ${FIXTURE_LANGUAGE} in ${JSON.stringify(report.languageNames)}`,
    );
    assert.equal(report.dgettext, MSGSTR);
});
