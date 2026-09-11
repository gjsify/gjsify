// SPDX-License-Identifier: MIT
// "Can this host translate at all?" — one answer, shared by the locale tests.
//
// GNU gettext refuses to translate while LC_MESSAGES is the C locale, and
// `setlocale` only leaves C for a locale the host has actually GENERATED. So a
// translation test needs a real locale the way a GTK test needs a display, and
// the gate states that requirement instead of letting the suite go quietly
// vacuous where it is unmet.
//
// MEASURED, and it is why `C.UTF-8` is not in the candidate list: on glibc 2.43
// a catalog bound under `LC_ALL=C.UTF-8 LANGUAGE=de` still returns the untranslated
// msgid — glibc treats the C.UTF-8 locale as the C locale for message lookup and
// ignores LANGUAGE there, exactly as it does for plain `C`. C.UTF-8 is the ONLY
// locale `glibc-minimal-langpack` (the Fedora container base) generates, which is
// why `.docker/ci-fedora.Dockerfile` installs a langpack for the suite.
//
// The language the CATALOG is written for is independent of the locale that is
// set: with LC_MESSAGES at any non-C locale, `LANGUAGE` picks the catalog
// directory (measured: `LC_ALL=en_US.utf8 LANGUAGE=de` reads `de/LC_MESSAGES/`).
// So the tests need ONE fixture language and ANY usable locale, not a matching pair.
import { execFileSync } from 'node:child_process';

/** The catalog directory the fixtures are written to, selected via `LANGUAGE`. */
export const FIXTURE_LANGUAGE = 'de';

/**
 * Locales to try when the host cannot enumerate them (`locale -a` is POSIX and
 * absent on Windows). Ordered by how reliably a runner has them generated.
 */
const FALLBACK_CANDIDATES = ['en_US.UTF-8', 'de_DE.UTF-8', 'en_US.utf8', 'de_DE.utf8'];

function enumerateLocales() {
    if (process.platform === 'win32') return FALLBACK_CANDIDATES;
    try {
        const out = execFileSync('locale', ['-a'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return out
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
    } catch {
        // `locale(1)` is not installed (a minimal container) — fall back to probing
        // the usual names, which costs one setlocale each and answers the same question.
        return FALLBACK_CANDIDATES;
    }
}

/**
 * A locale name this host can actually switch to, or `null`.
 *
 * The authority is `locale -a`, which lists the locales that have been GENERATED —
 * deliberately NOT node-gi's own `setlocale`, which is the thing these tests
 * measure. A gate built on the code under test reports "nothing to run here" for
 * exactly the defect it was written to catch, and the suite goes green by
 * skipping itself.
 *
 * Plain `C`, `POSIX` and the `C.*` family are excluded: they are always present
 * and never translate, so accepting one would hand the tests a locale that makes
 * every assertion pass for the wrong reason.
 *
 * @returns {string | null}
 */
export function findTranslatableLocale() {
    const isCLocale = (name) => name === 'C' || name === 'POSIX' || name.startsWith('C.');
    const candidates = enumerateLocales().filter((name) => !isCLocale(name));
    // UTF-8 first: a legacy-charset locale makes gettext transcode the catalog, so
    // a mismatch would show up as mojibake rather than as the thing under test.
    return candidates.find((n) => /utf-?8$/i.test(n)) ?? candidates[0] ?? null;
}

/** What to print when the gate is closed, so a vacuous run is never silent. */
export const NO_LOCALE_DIAGNOSTIC =
    'no non-C locale is generated on this host — install a langpack ' +
    '(Fedora: glibc-langpack-de, Debian/Ubuntu: locales + locale-gen de_DE.UTF-8)';
