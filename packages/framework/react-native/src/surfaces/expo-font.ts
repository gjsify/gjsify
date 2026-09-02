// `expo-font` — a desktop does not load fonts the way a phone does.
//
// THE HONEST COUNTERPART IS DISCOVERY, NOT LOADING. On a phone `useFonts` registers
// font files with the runtime and returns `[false, null]` until they are in. On a
// desktop, fonts are INSTALLED — system-wide, in `~/.local/share/fonts`, or shipped
// with the application (`gjsify.ship.fonts`, ADR 0037) — and the platform's font map
// has already found them by the time any JavaScript runs. There is nothing to wait
// for, so the hook reports ready on its first render.
//
// "ALREADY FOUND THEM" IS NOT UNIFORM, and the exception is worth knowing before a
// consumer trusts this row on three operating systems. fontconfig scans the
// installed directory on Linux and macOS activates a bundle's own faces from
// `ATSApplicationFontsPath` before the process starts, so on both the discovery has
// genuinely happened already. GTK4 on Windows is pangowin32/DirectWrite, which
// reaches no font file by configuration at all — a bundled face there is registered
// by the APP at startup (`PangoCairo.FontMap.get_default().add_font_file()`, over
// the directory `gjsify ship` names in `GJSIFY_FONT_DIR`). This hook is still right
// to answer immediately: it is not what performs that registration, and where the
// registration belongs to the app it has necessarily already run.
//
// AND THAT IS BETTER THAN A STUB, because the failure it removes is real: a screen
// written as `if (!loaded) return null` renders immediately instead of flashing, and
// on the platform where the wait does not exist the wait should not be simulated.
//
// `isLoaded` IS A REAL ANSWER, and it is the one thing here that reads the machine:
// `PangoCairo.FontMap.get_default().list_families()` is the set of families this
// process can use. MEASURED on this host: 118 families, `Cantarell` and
// `Adwaita Sans` among them, and the map is reachable with NO WIDGET — which matters,
// because a font question is asked from module scope as often as from a component.
//
// `loadAsync` REFUSES rather than resolving, and the reason is what it is HANDED,
// not what GI exposes. This comment used to say GTK 4 exposes no per-process font
// registration at all, citing fontconfig's `FcConfigAppFontAddFile` as absent from
// every typelib — and the second half is true while the conclusion is not:
// `pango_font_map_add_font_file()` has been in `Pango-1.0.gir` since Pango 1.56 and
// `@gjsify/dom-elements` already calls it for Canvas `FontFace`. Corrected rather
// than deleted, because a rule whose stated reason is false is one somebody
// "un-refuses" the first time they check it.
//
// The reason that holds: `loadAsync`'s argument is a `require("./Inter.ttf")` id
// into React Native's asset registry, which ADR 0032 § 12 leaves to the consumer's
// build chain — the same reason `useFonts` ignores its map's VALUES and this layer
// refuses one for `Image.source`. There is no path to register. And the call would
// not be portable if there were: it answers `G_IO_ERROR_NOT_SUPPORTED` on the
// CoreText font map, so it would work on Linux and Windows and lie on macOS. A
// promise that resolved would be claiming a font was installed when it was not, and
// the symptom is Pango silently substituting a fallback family — the exit-0 failure
// this layer exists against.

import PangoCairo from 'gi://PangoCairo?version=1.0';

/** What `useFonts` answers: `[loaded, error]`, React Native's own shape. */
export type FontHookResult = readonly [boolean, Error | null];

/**
 * The families Pango knows, lower-cased, read once.
 *
 * Cached because a font question is asked per render and `list_families()` walks
 * fontconfig's configuration. The cache is also the limit `isLoaded` declares: a font
 * installed while the process runs is not seen, which is also true of Pango's own map
 * until something reloads it.
 */
let families: Set<string> | null = null;

const knownFamilies = (): Set<string> => {
    if (families !== null) return families;
    const found = new Set<string>();
    for (const family of PangoCairo.FontMap.get_default().list_families()) {
        found.add(family.get_name().toLowerCase());
    }
    families = found;
    return found;
};

/** For the spec: drop the cache so a vector can assert the read rather than the memo. */
export const resetFontCache = (): void => {
    families = null;
};

/**
 * Is a font family available to this process?
 *
 * Compared on the FAMILY name, case-insensitively, which is what Pango matches on. A
 * PostScript name (`Inter-SemiBold`) or a file path answers false — correctly: neither
 * is a family, and a `true` there would send an author looking for a bug in their
 * styles.
 */
export function isLoaded(family: string): boolean {
    return knownFamilies().has(family.toLowerCase());
}

/**
 * Always false. Nothing loads asynchronously, so nothing is ever loading.
 *
 * React Native's own answer once a font has arrived, which is the state a desktop
 * process starts in.
 */
export function isLoading(): boolean {
    return false;
}

/**
 * Ready, immediately.
 *
 * The map's VALUES are ignored and that is stated in the table: a `require('./x.ttf')`
 * id is an index into React Native's asset registry, which ADR 0032 § 12 leaves to
 * the consumer's build chain — the same reason `Image.source` refuses one.
 *
 * It does NOT verify the families, deliberately. `isLoaded` is there for that, and a
 * hook that threw here would fail an application whose font is installed under a
 * family name the map's key does not spell — which is the ordinary case, since the
 * key in a `useFonts` map is a name the application chose.
 */
export function useFonts(_map?: Readonly<Record<string, unknown>> | readonly unknown[]): FontHookResult {
    return [true, null];
}

// `loadAsync`, `unloadAsync`, `unloadAllAsync` and `FontDisplay` are NOT written here.
// They are `refused` in the table, so the generated module below is the only place
// they come from — a hand-written throwing function beside a generated refusal is two
// answers to one question, and `support-table.spec.ts` holds exactly that line: an
// importable name must be a real value and every other one a refusing proxy.

export * from '../generated/unsupported-expo-font.js';
