// WHERE the compiled gettext catalogues live — decided without touching the platform.
//
// Free of imports for the same reason `dev-hooks.ts` is: the environment arrives as a plain
// record, so the decision is exercised on Node as well as GJS. `locale.ts` supplies the real
// environment and performs the binding.

/** `bindtextdomain`'s directory for a system install, when nothing else names one. */
export const SYSTEM_LOCALE_DIR = '/usr/share/locale';

export interface ResolveLocaleDirOptions {
    /** Wins over everything — a dev tree (`dist/locale`), or a test fixture. */
    localeDir?: string;
    /** Environment to read `GJSIFY_LOCALE_DIR` from. */
    env?: Record<string, string | undefined>;
    /** Used when neither the option nor the environment names a directory. */
    fallbackDir?: string;
}

/**
 * Resolve the directory to bind a text domain to.
 *
 * Precedence: explicit option, then `GJSIFY_LOCALE_DIR` (exported by the `gjsify ship` launcher,
 * which is the only party that knows whether the payload became `/usr`, a `--prefix` tree or
 * `/app`), then the caller's fallback, then the system directory.
 */
export function resolveLocaleDir(options: ResolveLocaleDirOptions = {}): string {
    // An EMPTY value counts as unset. The launcher exports `GJSIFY_LOCALE_DIR` only when it
    // actually staged catalogues, but a wrapper script that sets it unconditionally hands over
    // `''` — and `bindtextdomain(domain, '')` binds to the CURRENT DIRECTORY, where the lookup
    // finds nothing and reports it exactly as "this app has no translation".
    return (
        nonEmpty(options.localeDir) ??
        nonEmpty(options.env?.GJSIFY_LOCALE_DIR) ??
        nonEmpty(options.fallbackDir) ??
        SYSTEM_LOCALE_DIR
    );
}

function nonEmpty(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
