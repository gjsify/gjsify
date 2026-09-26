// The desktop's appearance as one portable value, and the handoff format that
// carries it from a process that can read the desktop to a page that cannot
// (ADR 0078).
//
// A web page has no API for the desktop's accent beyond the CSS system colour
// `AccentColor`, whose support is uneven and which a page cannot tell apart
// from a default. The GJS process that serves the page CAN read the desktop
// (`@gjsify/adwaita-app/appearance`), so it hands the answer over: in the HTML
// it renders (two `<meta>` tags) and, for live updates, as the JSON form of
// `DesktopAppearance` over whatever channel the app already has.
//
// BOTH SIDES OF THE FORMAT LIVE HERE so the writer (GJS) and the reader
// (`@gjsify/adwaita-web`) cannot drift: the server renders with
// `renderAppearanceMeta`, the page reads with `appearanceFromMeta`, and an
// untrusted JSON payload goes through `parseDesktopAppearance`.

import { type AdwAccentColorName, isAdwAccentColorName, parseAdwRgb, formatAdwRgb } from './accent.js';

/**
 * The system's colour-scheme preference, in the XDG Settings portal's own terms
 * (`org.freedesktop.appearance color-scheme`: 0 no preference, 1 dark, 2 light).
 * `no-preference` is an ANSWER — the user chose nothing — and differs from the
 * field being absent, which means nothing could be read.
 */
export type AdwSystemColorScheme = 'light' | 'dark' | 'no-preference';

/** Every {@link AdwSystemColorScheme}. */
export const ADW_SYSTEM_COLOR_SCHEMES: readonly AdwSystemColorScheme[] = ['light', 'dark', 'no-preference'];

/**
 * What the desktop says about its appearance. Every field is optional and an
 * absent field means UNKNOWN: a reader that cannot answer leaves it out rather
 * than guessing the default, so a consumer can tell "the user picked blue"
 * from "nothing was read".
 */
export interface DesktopAppearance {
    /** The system accent, snapped to libadwaita's nine with `nearestAccent`. */
    readonly accent?: AdwAccentColorName;
    /** The raw system accent as `#rrggbb`, when the source reports a colour rather than a name. */
    readonly accentRgb?: string;
    /** The colour-scheme preference. */
    readonly colorScheme?: AdwSystemColorScheme;
}

/** `<meta name="adw-accent" content="purple">` — one of the nine names, or `system` (see ADR 0078). */
export const ADW_ACCENT_META = 'adw-accent';
/** `<meta name="adw-color-scheme" content="dark">` — an {@link AdwSystemColorScheme}. */
export const ADW_COLOR_SCHEME_META = 'adw-color-scheme';
/**
 * The `adw-accent` value that asks the page to follow the browser's CSS
 * `AccentColor` instead of a named accent — for a server that knows it cannot
 * read the desktop but wants the page to try.
 */
export const ADW_ACCENT_META_SYSTEM = 'system';

export function isAdwSystemColorScheme(value: unknown): value is AdwSystemColorScheme {
    return typeof value === 'string' && (ADW_SYSTEM_COLOR_SCHEMES as readonly string[]).includes(value);
}

/**
 * Validate an untrusted value — a JSON payload, a message from another
 * process — into a {@link DesktopAppearance}. Unknown or malformed fields are
 * DROPPED, never guessed, so the result can be applied without further checks.
 */
export function parseDesktopAppearance(raw: unknown): DesktopAppearance {
    if (typeof raw !== 'object' || raw === null) return {};
    const input = raw as Record<string, unknown>;
    const accent = typeof input.accent === 'string' && isAdwAccentColorName(input.accent) ? input.accent : undefined;
    const rgb = typeof input.accentRgb === 'string' ? parseAdwRgb(input.accentRgb) : null;
    const colorScheme = isAdwSystemColorScheme(input.colorScheme) ? input.colorScheme : undefined;
    return {
        ...(accent ? { accent } : {}),
        ...(rgb ? { accentRgb: formatAdwRgb(rgb) } : {}),
        ...(colorScheme ? { colorScheme } : {}),
    };
}

/**
 * The `<meta>` tags that hand `appearance` to a page using
 * `@gjsify/adwaita-web`, for the server to put in `<head>`. An unknown field
 * renders no tag, so the page falls through to its next source. The values come
 * from closed sets, so nothing here needs HTML escaping — anything outside them
 * is dropped by {@link parseDesktopAppearance} first.
 */
export function renderAppearanceMeta(appearance: DesktopAppearance): string {
    const { accent, colorScheme } = parseDesktopAppearance(appearance);
    const tags: string[] = [];
    if (accent) tags.push(`<meta name="${ADW_ACCENT_META}" content="${accent}">`);
    if (colorScheme) tags.push(`<meta name="${ADW_COLOR_SCHEME_META}" content="${colorScheme}">`);
    return tags.join('\n');
}

/** What the handoff tags say, read back. `accent: 'system'` asks for the CSS system colour. */
export interface AppearanceMeta {
    readonly accent?: AdwAccentColorName | typeof ADW_ACCENT_META_SYSTEM;
    readonly colorScheme?: AdwSystemColorScheme;
}

/**
 * Read the handoff tags through `content(name)`, which returns a `<meta>`
 * tag's `content` or `null` — `document.querySelector` in a browser, a
 * template's own lookup anywhere else. Unknown values are ignored.
 */
export function appearanceFromMeta(content: (name: string) => string | null | undefined): AppearanceMeta {
    const accent = content(ADW_ACCENT_META)?.trim().toLowerCase();
    const colorScheme = content(ADW_COLOR_SCHEME_META)?.trim().toLowerCase();
    return {
        ...(accent && (accent === ADW_ACCENT_META_SYSTEM || isAdwAccentColorName(accent)) ? { accent } : {}),
        ...(isAdwSystemColorScheme(colorScheme) ? { colorScheme } : {}),
    };
}
