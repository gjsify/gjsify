// WHERE the compiled gettext catalogues live — decided without touching the platform.
//
// Free of imports for the same reason `dev-hooks.ts` is: the environment arrives as a plain
// record, so the decision is exercised on Node as well as GJS. `locale.ts` supplies the real
// environment and performs the binding.
//
// THE PLATFORM IS A PARAMETER, never read here — the same discipline `StyleSheet.selectDefault`
// keeps in `@gjsify/gtk-host`. It is what lets a test ask "what does a `.app` get?" from Linux.
//
// This branch is why the package declares `gjsify.os` (ADR 0018) — `locale.ts` reads
// `process.platform`, which is what the rule derives the obligation from. darwin and win32 are
// `partial`, NOT `supported`, and the distinction is the one `@gjsify/path` already draws for
// win32: the DECISION below is complete and `locale-dir.spec.ts` asserts every one of its
// answers from any host, because the platform is an argument. The SELECTION — `locale.ts`
// reading a real `process.platform` and skipping `bindtextdomain` — is observed by no runner:
// `gtk-os-suites.yml`'s darwin and win32 legs run `@gjsify/gtk-host` and `@gjsify/react-native`,
// and this package's suite has never run on either OS. Complete code and measured code are not
// the same claim, and `supported` is the word for the second one.

/**
 * `bindtextdomain`'s directory for a system install — **on Linux**, where it exists.
 *
 * Deliberately not a cross-platform answer: see {@link systemLocaleDir}.
 */
export const SYSTEM_LOCALE_DIR = '/usr/share/locale';

/** Platforms that have no system catalogue directory at all — `process.platform` spellings. */
const NO_SYSTEM_LOCALE_DIR: readonly string[] = ['darwin', 'win32'];

/**
 * The system catalogue directory for `platform`, or `undefined` where there is none.
 *
 * `undefined` for **darwin** and **win32**, and the darwin half is the reason this function
 * exists rather than a constant. `/usr/share/locale` does not exist on Windows, so naming it
 * there was merely useless — but it DOES exist on macOS, holding Apple's own locale data and
 * never an application's catalogues. So the old unconditional fallback bound a real directory
 * that could not resolve a single msgid: no error, no translation, and `Translator.localeDir`
 * reporting a plausible path as if the lookup had somewhere to go. A directory that is absent
 * is the better answer of the two, because it is the true one.
 *
 * Any OTHER platform keeps {@link SYSTEM_LOCALE_DIR}. `process.platform` has more values than
 * the three desktops this project targets — `freebsd`, `openbsd`, `sunos`, … — and it is also
 * `undefined` in a GJS bundle built with `--globals none`. Answering those with "no directory"
 * would change behaviour nobody measured; answering them as today changes nothing.
 */
export function systemLocaleDir(platform?: string): string | undefined {
    return platform !== undefined && NO_SYSTEM_LOCALE_DIR.includes(platform) ? undefined : SYSTEM_LOCALE_DIR;
}

export interface ResolveLocaleDirOptions {
    /** Wins over everything — a dev tree (`dist/locale`), or a test fixture. */
    localeDir?: string;
    /** Environment to read `GJSIFY_LOCALE_DIR` from. */
    env?: Record<string, string | undefined>;
    /** Used when neither the option nor the environment names a directory. */
    fallbackDir?: string;
    /** `process.platform`, for the last step only. Omitted keeps the Linux answer. */
    platform?: string;
}

/**
 * Resolve the directory to bind a text domain to, or `undefined` when there is none to bind.
 *
 * Precedence: explicit option, then `GJSIFY_LOCALE_DIR` (exported by the `gjsify ship` launcher,
 * which is the only party that knows whether the payload became `/usr`, a `--prefix` tree or
 * `/app`), then the caller's fallback, then the platform's system directory — if it has one.
 *
 * A shipped app reaches an answer at step two on every OS, so `undefined` means the app carries
 * no catalogues AND the platform has no system ones. `locale.ts` then skips `bindtextdomain`
 * rather than binding somewhere arbitrary, and every lookup returns its msgid — which is what an
 * untranslated application is supposed to do.
 */
export function resolveLocaleDir(options: ResolveLocaleDirOptions = {}): string | undefined {
    // An EMPTY value counts as unset. The launcher exports `GJSIFY_LOCALE_DIR` only when it
    // actually staged catalogues, but a wrapper script that sets it unconditionally hands over
    // `''` — and `bindtextdomain(domain, '')` binds to the CURRENT DIRECTORY, where the lookup
    // finds nothing and reports it exactly as "this app has no translation".
    return (
        nonEmpty(options.localeDir) ??
        nonEmpty(options.env?.GJSIFY_LOCALE_DIR) ??
        nonEmpty(options.fallbackDir) ??
        systemLocaleDir(options.platform)
    );
}

function nonEmpty(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
