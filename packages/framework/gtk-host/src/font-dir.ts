// WHICH directory holds the application's own faces — decided without touching the platform.
//
// Free of imports for the same reason `@gjsify/adwaita-app`'s `locale-dir.ts` is: the environment
// arrives as a plain record, so the decision is exercised on Node as well as on GJS. `fonts.ts`
// supplies the real environment and performs the registration.

/**
 * The desktop face extensions `gjsify ship` stages, lower-cased.
 *
 * The same four the writing half accepts (`discoverFonts`, ADR 0038), and deliberately not a
 * shared constant: this package cannot depend on `@gjsify/cli` — wrong direction and wrong tier —
 * so the pairing is a specification both ends implement rather than a value one imports.
 *
 * `.woff`/`.woff2`/`.eot` are absent from BOTH ends. The writer refuses them by name because
 * whether FreeType opens one is `FT_CONFIG_OPTION_USE_BROTLI`, a build option of whichever
 * FreeType the SHIPPED artifact loads rather than of the packaging host; a reader that accepted
 * them would hand the font map a file it may decline on the target and nowhere else.
 */
export const FONT_FACE_EXTENSIONS: readonly string[] = ['.ttf', '.otf', '.ttc', '.otc'];

export interface ResolveFontDirOptions {
    /** Wins over everything — a dev tree (`data/fonts`), or a test fixture. */
    fontDir?: string;
    /** Environment to read `GJSIFY_FONT_DIR` from. */
    env?: Record<string, string | undefined>;
}

/** A directory of faces, and who put it there. */
export interface FontSource {
    readonly dir: string;
    /**
     * `runtime` = the GTK runtime bundle's own faces (the GNOME UI typeface, shipped by
     * `@gjsify/gtk-runtime-<target>` and named by `@gjsify/node-gi`'s loader);
     * `app` = the faces THIS application staged with `gjsify ship`.
     */
    readonly origin: 'runtime' | 'app';
}

export interface ResolveFontSourcesOptions extends ResolveFontDirOptions {
    /** Wins over `GJSIFY_GTK_RUNTIME_FONT_DIR` — a bundle checkout, or a test fixture. */
    runtimeFontDir?: string;
}

/**
 * Every directory of faces this process should register, RUNTIME first.
 *
 * TWO SOURCES, NOT ONE, and they answer different questions. `GJSIFY_FONT_DIR` is the
 * application's own brand face, staged by `gjsify ship` (ADR 0038).
 * `GJSIFY_GTK_RUNTIME_FONT_DIR` is the GNOME UI typeface the GTK runtime bundle carries,
 * because off Linux nothing installs it: measured on Windows 11 against the published 0.50.0
 * bundle, `Adwaita Sans 11` and `Cantarell 11` both resolve to Tahoma, and Pango reports that
 * substitution by rendering it. An application must never have to choose between its own face
 * and the platform's, which is why this is a second variable rather than a contested one.
 *
 * RUNTIME FIRST, so the platform faces are on the map before an application's — the order the
 * two were designed in. Duplicates collapse: pointing both variables at one directory
 * registers it once instead of handing every face to `add_font_file` twice.
 */
export function resolveFontSources(options: ResolveFontSourcesOptions = {}): FontSource[] {
    const runtime = nonEmpty(options.runtimeFontDir) ?? nonEmpty(options.env?.GJSIFY_GTK_RUNTIME_FONT_DIR);
    const app = resolveFontDir(options);
    const sources: FontSource[] = [];
    if (runtime !== undefined) sources.push({ dir: runtime, origin: 'runtime' });
    if (app !== undefined && app !== runtime) sources.push({ dir: app, origin: 'app' });
    return sources;
}

/**
 * Resolve the directory holding the application's shipped faces, or `undefined` when none is named.
 *
 * Precedence: explicit option, then `GJSIFY_FONT_DIR` — exported by the `gjsify ship` launcher,
 * which is the only party that knows whether the payload became `/usr`, a `--prefix` tree, `/app`,
 * a bundle's `Contents/Resources` or a Windows program directory.
 *
 * There is NO system fallback, and that is the one place this parts company with
 * `resolveLocaleDir`, whose `/usr/share/locale` default is both correct and free. The analogous
 * `/usr/share/fonts` is neither: fontconfig has already scanned it, so walking it again would add
 * hundreds of `add_font_file` calls to every startup to arrive at families the font map holds
 * anyway. `undefined` therefore means "this application ships no faces of its own" — the ordinary
 * case, and a quiet one, because the launcher exports the variable only when it staged a face.
 */
export function resolveFontDir(options: ResolveFontDirOptions = {}): string | undefined {
    // An EMPTY value counts as unset, on `resolveLocaleDir`'s precedent and for a sharper version
    // of its reason. A wrapper script that exports `GJSIFY_FONT_DIR` unconditionally hands over
    // `''`, and enumerating `''` reads the CURRENT DIRECTORY — so the same application would
    // register whatever faces happen to sit beside it when started from a source tree, and none
    // when started from anywhere else. A font map that depends on the caller's `cwd` is the
    // silent-substitution class this whole mechanism exists against.
    return nonEmpty(options.fontDir) ?? nonEmpty(options.env?.GJSIFY_FONT_DIR);
}

/**
 * Is `name` a face {@link FONT_FACE_EXTENSIONS} covers?
 *
 * Extension-only and case-insensitive: `BRAND.TTF` is an ordinary name on the case-preserving
 * filesystems macOS and Windows have, and a lowercase-only test would drop it into exactly the
 * substituted-family failure this mechanism exists to prevent.
 */
export function isFontFace(name: string): boolean {
    const lower = name.toLowerCase();
    return FONT_FACE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function nonEmpty(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
