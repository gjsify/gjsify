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
//
// The probe is a CHILD because `setlocale` is process-global and the addon adopts
// the environment locale once, at load — but the child is launched on a NAMED
// runtime (`probeLauncher()` in locale-gate.mjs), never on `process.execPath`,
// and the claim this file exists for is asserted IN-PROCESS as well so it does not
// depend on one runtime being able to re-launch itself. See locale-gate.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Gettext from '../gettext.js';
import { writeMoCatalog } from './mo-catalog.mjs';
import {
    DEFAULT_PROBE_RUNTIME,
    FIXTURE_LANGUAGE,
    HOST_RUNTIME,
    NO_LOCALE_DIAGNOSTIC,
    PROBE_CHILD_ARGS,
    PROBE_RUNTIME_ENV,
    findTranslatableLocale,
    probeLauncher,
} from './locale-gate.mjs';

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

// The child runs on a runtime the HARNESS named, not on whatever happens to be
// hosting this file. Resolved once, at load: an unnamed runtime is a
// configuration error and must fail the file loudly rather than be skipped.
const launcher = probeLauncher();

// A spawn with no timeout is how a hung child took the PARENT down with it: on
// `windows-latest` under bun the child never returned, and the only thing that
// ended the wait was bun's own 5s per-test timeout SIGTERMing this process — so
// the log named the test and not the child. Bounded here, the error names the
// child and the runtime it was launched on.
//
// It is a BACKSTOP, not the fix, and it does not bind on every host: `bun test`
// times a test out at 5s and `node --test`/`deno test` do not, so under a bun
// parent bun still reaches the parent first. What actually closed the win32 ×
// bun cell is `DEFAULT_PROBE_RUNTIME` above — the child no longer runs on the
// runtime that hung. The value is two orders of magnitude over the measured
// probe (50–110ms warm here, on node and on bun alike), because the thing it
// must not do is fire on a cold CI runner loading the addon for the first time.
const PROBE_TIMEOUT_MS = 60_000;

/** Run the probe in a fresh process under `env` and parse its report. */
function runProbe(env) {
    const out = execFileSync(launcher.command, [...launcher.args, probe, localeRoot, DOMAIN, MSGID], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
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

// THE CROSS-RUNTIME CLAIM, and the reason it lives here rather than only in the
// child. What this suite proves is that the ADDON's `Init` — one native binary —
// ran `setlocale(LC_ALL, "")`, so a C program under Bun or Deno leaves "C" no
// longer. That is a statement about the addon in the process hosting THIS file,
// so it is asserted in that process, with no spawn anywhere in it: measured to
// report the ambient `LC_ALL` back verbatim under node, bun and deno alike.
//
// Before, that claim was only reachable through the probe child, which made the
// whole cross-runtime cell depend on the HOST runtime being able to re-launch
// itself — the unstated coupling `locale-gate.mjs` documents. This test removes
// the dependency rather than the claim: the child cases still run and still prove
// the per-case environments, and the file no longer measures the addon by way of
// a runtime's child-launch policy.
//
// `scripts/cross-runtime.mjs` exports a real `LC_ALL` for this file precisely so
// this runs on all three runtimes; `npm test` pins `LC_ALL=C` (pinned-env.mjs,
// because other files' assertions match untranslated GLib error text) and there
// the ambient locale is C, the defect's own answer, and there is nothing to say.
const ambientLocale = process.env.LC_ALL ?? '';
const ambientIsTranslatable =
    ambientLocale !== '' && ambientLocale !== 'C' && ambientLocale !== 'POSIX' && !ambientLocale.startsWith('C.');
const AMBIENT_LOCALE_REASON =
    `this process was launched with LC_ALL=${JSON.stringify(ambientLocale)} — no non-C locale to adopt, so ` +
    'the in-process assertion has nothing to discriminate. `node scripts/cross-runtime.mjs <runtime>` exports ' +
    'one for this file; `npm test` pins LC_ALL=C on purpose (see locale-gate.mjs).';

test(
    `the addon adopted THIS process's ambient locale (${HOST_RUNTIME}, no child)`,
    { skip: !ambientIsTranslatable && AMBIENT_LOCALE_REASON },
    () => {
        assert.equal(
            Gettext.setlocale(Gettext.LocaleCategory.MESSAGES, null),
            ambientLocale,
            `after loading node-gi this ${HOST_RUNTIME} process is in ` +
                `${JSON.stringify(Gettext.setlocale(Gettext.LocaleCategory.MESSAGES, null))}, not the ` +
                `${JSON.stringify(ambientLocale)} its environment asked for — the addon's Init did not adopt it`,
        );
        assert.notEqual(Gettext.setlocale(Gettext.LocaleCategory.ALL, null), 'C');
    },
);

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

// ---------------------------------------------------------------------------
// THE LAUNCHER DECISION, held without a Windows host
// ---------------------------------------------------------------------------
//
// The decision that fixed the `windows-latest` × Bun cell is a pure-function one,
// so it is pinned here rather than only by the CI leg that surfaced it. Nothing
// below spawns, loads the addon or reads a platform: the whole classifier runs on
// any host, on any runtime, which is the point — the red cell was a red cell
// because the decision had never been written down anywhere a host-independent
// test could see it.

test('the probe child is launched on a NAMED runtime, and each name carries its own flags', () => {
    for (const [runtime, expectedArgs] of Object.entries(PROBE_CHILD_ARGS)) {
        const launcher = probeLauncher({ [PROBE_RUNTIME_ENV]: runtime });
        assert.equal(launcher.runtime, runtime);
        assert.deepEqual(
            launcher.args,
            [...expectedArgs],
            `the ${runtime} child must be given its own flags, not inherit the parent's — deno's child dies ` +
                `NotCapable without them (see locale-gate.mjs)`,
        );
        // The host's own binary ONLY when that is the runtime being named; anything
        // else is a bare name for PATH, so a missing runtime fails naming itself.
        assert.equal(launcher.command, runtime === HOST_RUNTIME ? process.execPath : runtime);
    }
});

test('an unnamed probe runtime fails by name instead of falling back to process.execPath', () => {
    // The shape this whole change removes: a runtime nobody named being launched
    // anyway, on whatever binary happened to be hosting. It is what made the test's
    // correctness a property of the HOST runtime instead of of node-gi.
    assert.throws(
        () => probeLauncher({ [PROBE_RUNTIME_ENV]: 'quickjs' }),
        (err) => {
            assert.match(err.message, /NODE_GI_PROBE_RUNTIME="quickjs"/);
            assert.ok(
                err.message.includes(Object.keys(PROBE_CHILD_ARGS).join(', ')),
                'the failure must list the runtimes it will accept',
            );
            return true;
        },
    );
    // And the default is stated, not incidental.
    const fallback = probeLauncher({});
    assert.equal(fallback.runtime, DEFAULT_PROBE_RUNTIME);
    assert.equal(DEFAULT_PROBE_RUNTIME, 'node', 'the default is the one runtime whose child needs no flags');
});

test('the launcher this file actually resolved is the named one, not the hosting binary', () => {
    const named = process.env[PROBE_RUNTIME_ENV] ?? DEFAULT_PROBE_RUNTIME;
    assert.equal(launcher.runtime, named);
    assert.ok(launcher.command.length > 0, 'a resolved launcher with no command would fall through to execPath');
    // The host's binary is the RIGHT answer only when the runtime being named IS
    // the host's. Anything else must resolve to the bare name for PATH — which is
    // what `windows-latest` × Bun was silently not doing.
    if (named !== HOST_RUNTIME) {
        assert.equal(launcher.command, named);
        assert.notEqual(launcher.command, process.execPath);
    } else {
        assert.equal(launcher.command, process.execPath);
    }
});
