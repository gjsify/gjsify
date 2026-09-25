// What each desktop's raw settings MEAN, as pure functions (ADR 0078).
//
// The I/O beside this file only fetches strings and numbers; every decision
// about them is here, with no `gi://` import, so it runs and is tested on Node
// as well as GJS — including the Windows and macOS answers, which no Linux
// runner could otherwise reach.
//
// ONE RULE ACROSS ALL FOUR SOURCES: an accent the source reports as a COLOUR
// is snapped with `nearestAccent`, exactly as libadwaita snaps the portal's,
// WinRT's and AppKit's colour (`adw-settings-impl-{portal,win32,macos}.c`), so
// a web page and a native Adwaita window on the same desktop pick the same one
// of the nine. And an absent or unreadable value leaves the field ABSENT, never
// a guessed default.

import {
    type AdwAccentColorName,
    type AdwRgb,
    type AdwSystemColorScheme,
    type DesktopAppearance,
    formatAdwRgb,
    isAdwAccentColorName,
    nearestAccent,
    parseAdwRgb,
} from '@gjsify/adwaita-core';

function fromRgb(rgb: AdwRgb): Pick<DesktopAppearance, 'accent' | 'accentRgb'> {
    return { accent: nearestAccent(rgb), accentRgb: formatAdwRgb(rgb) };
}

function compact(appearance: {
    accent?: AdwAccentColorName;
    accentRgb?: string;
    colorScheme?: AdwSystemColorScheme;
}): DesktopAppearance {
    const out: { accent?: AdwAccentColorName; accentRgb?: string; colorScheme?: AdwSystemColorScheme } = {};
    if (appearance.accent) out.accent = appearance.accent;
    if (appearance.accentRgb) out.accentRgb = appearance.accentRgb;
    if (appearance.colorScheme) out.colorScheme = appearance.colorScheme;
    return out;
}

/** Field by field: `primary` wins, `fallback` fills what it left unknown. */
export function mergeAppearance(primary: DesktopAppearance, fallback: DesktopAppearance): DesktopAppearance {
    const accentFromPrimary = primary.accent !== undefined;
    return compact({
        accent: primary.accent ?? fallback.accent,
        // The colour belongs to whichever source supplied the name, or the two could disagree.
        accentRgb: accentFromPrimary ? primary.accentRgb : fallback.accentRgb,
        colorScheme: primary.colorScheme ?? fallback.colorScheme,
    });
}

/** Whether two appearances say the same thing — what a watcher dedupes on. */
export function sameAppearance(a: DesktopAppearance, b: DesktopAppearance): boolean {
    return a.accent === b.accent && a.accentRgb === b.accentRgb && a.colorScheme === b.colorScheme;
}

/**
 * The XDG Settings portal's `org.freedesktop.appearance` namespace, as
 * `ReadAll` returns it unpacked.
 *
 * - `color-scheme` (`u`): 0 no preference, 1 prefer dark, 2 prefer light. Any
 *   other number is invalid and dropped (libadwaita warns and uses the default).
 * - `accent-color` (`(ddd)`): sRGB in 0…1. The spec says a value outside that
 *   range means "not set" — xdg-desktop-portal-gnome sends `(-1,-1,-1)` for a
 *   desktop with no accent — so it is dropped, not clamped.
 *
 * Reference: xdg-desktop-portal `org.freedesktop.impl.portal.Settings` docs
 * Reference: refs/libadwaita/src/adw-settings-impl-portal.c#get_fdo_accent_color
 */
export function appearanceFromPortal(namespace: Readonly<Record<string, unknown>>): DesktopAppearance {
    const scheme = namespace['color-scheme'];
    const colorScheme: AdwSystemColorScheme | undefined =
        scheme === 0 ? 'no-preference' : scheme === 1 ? 'dark' : scheme === 2 ? 'light' : undefined;

    const accent = namespace['accent-color'];
    let rgb: AdwRgb | undefined;
    if (
        Array.isArray(accent) &&
        accent.length === 3 &&
        accent.every((c) => typeof c === 'number' && c >= 0 && c <= 1)
    ) {
        rgb = { red: accent[0], green: accent[1], blue: accent[2] };
    }
    return compact({ ...(rgb ? fromRgb(rgb) : {}), colorScheme });
}

/**
 * Whether GSettings `org.gnome.desktop.interface` describes THIS desktop, from
 * `XDG_CURRENT_DESKTOP` (a colon-separated list such as `ubuntu:GNOME`).
 *
 * The schema is installed far beyond GNOME: KDE and Xfce ship
 * gsettings-desktop-schemas, and so does Homebrew on macOS. There nobody writes
 * the keys, so `get_string` answers the schema DEFAULT, and a reader that took it
 * would report `blue` for a desktop set to purple (measured on macOS with
 * `AppleAccentColor = 5`, JumpLink/beifahrer#19). Outside GNOME the answer is
 * therefore "unknown", never the default.
 */
export function isGnomeDesktop(currentDesktop: string | null | undefined): boolean {
    return (currentDesktop ?? '').split(':').some((name) => name.trim().toUpperCase() === 'GNOME');
}

/**
 * GSettings `org.gnome.desktop.interface` — the fallback where no portal
 * answers. `accent-color` (GNOME 47+) is already one of the nine NAMES, so no
 * snapping and no colour; `color-scheme` (GNOME 42+) is `default`,
 * `prefer-dark` or `prefer-light`.
 */
export function appearanceFromGnomeSettings(values: {
    readonly accentColor?: string | null;
    readonly colorScheme?: string | null;
}): DesktopAppearance {
    const accent = values.accentColor && isAdwAccentColorName(values.accentColor) ? values.accentColor : undefined;
    const colorScheme: AdwSystemColorScheme | undefined =
        values.colorScheme === 'default'
            ? 'no-preference'
            : values.colorScheme === 'prefer-dark'
              ? 'dark'
              : values.colorScheme === 'prefer-light'
                ? 'light'
                : undefined;
    return compact({ accent, colorScheme });
}

/** The raw registry values the Windows reader fetches; `null` where the value does not exist. */
export interface WindowsRegistryValues {
    /** `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent` `AccentPalette` (REG_BINARY, 32 bytes). */
    readonly accentPalette?: Uint8Array | null;
    /** `HKCU\Software\Microsoft\Windows\DWM` `AccentColor` (REG_DWORD, `0xAABBGGRR`). */
    readonly dwmAccentColor?: number | null;
    /** `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` `AppsUseLightTheme` (REG_DWORD). */
    readonly appsUseLightTheme?: number | null;
}

/**
 * Windows. The accent libadwaita reads is WinRT's `UIColorType_Accent`
 * (`adw-settings-impl-win32.c`), which Explorer persists as entry 3 of the
 * eight RGBA quads in `AccentPalette` (light 3/2/1, ACCENT, dark 1/2/3,
 * unused). Where that value is missing, DWM's `AccentColor` — the title-bar
 * accent, stored `0xAABBGGRR` — is the closest the registry offers.
 *
 * `AppsUseLightTheme` is the "choose your app mode" switch: 0 dark, 1 light.
 * Absent (Windows before 10 1809) leaves the scheme unknown.
 *
 * NOT MEASURED ON WINDOWS: the palette layout is Microsoft's undocumented
 * persistence format, taken from its long-standing public descriptions; the
 * registry paths match JumpLink/beifahrer#18.
 */
export function appearanceFromWindowsRegistry(values: WindowsRegistryValues): DesktopAppearance {
    let rgb: AdwRgb | undefined;
    const palette = values.accentPalette;
    if (palette && palette.length >= 16) {
        rgb = { red: palette[12] / 255, green: palette[13] / 255, blue: palette[14] / 255 };
    } else if (typeof values.dwmAccentColor === 'number') {
        const abgr = values.dwmAccentColor;
        rgb = { red: (abgr & 0xff) / 255, green: ((abgr >>> 8) & 0xff) / 255, blue: ((abgr >>> 16) & 0xff) / 255 };
    }
    const light = values.appsUseLightTheme;
    const colorScheme: AdwSystemColorScheme | undefined = light === 0 ? 'dark' : light === 1 ? 'light' : undefined;
    return compact({ ...(rgb ? fromRgb(rgb) : {}), colorScheme });
}

/**
 * The colour each `AppleAccentColor` index stands for. macOS stores an INDEX,
 * not a colour, so these are the `NSColor.controlAccentColor` values libadwaita's
 * own test uses for its macOS cases (`tests/test-accent-color.c`) — the same
 * colours `adw-settings-impl-macos.c` snaps at runtime. An ABSENT key is
 * "multicolour", whose accent is blue (Firefox 156 on macOS 27 reports CSS
 * `AccentColor` as `rgb(0, 122, 255)` there, which snaps to blue as well).
 */
export const MACOS_ACCENT_COLORS: Readonly<Record<string, string>> = {
    '-1': '#8c8c8c', // graphite
    0: '#ff5257', // red
    1: '#f7821a', // orange
    2: '#ffc602', // yellow
    3: '#62ba46', // green
    4: '#017bff', // blue
    5: '#a550a7', // purple
    6: '#f8509e', // pink
};

/** The raw `defaults read -g <key>` answers; `null` where the key does not exist. */
export interface MacDefaultsValues {
    readonly appleAccentColor?: string | null;
    readonly appleInterfaceStyle?: string | null;
    readonly appleInterfaceStyleSwitchesAutomatically?: string | null;
}

/**
 * macOS global defaults. Measured on macOS 27 (JumpLink/beifahrer#18): with
 * default settings all three keys are ABSENT, and absence is itself a value —
 * multicolour accent, light appearance.
 *
 * One exception makes absence ambiguous: with "Auto" appearance
 * (`AppleInterfaceStyleSwitchesAutomatically = 1`) the system flips between
 * light and dark by time of day, and a missing `AppleInterfaceStyle` no longer
 * proves light. The scheme is then left UNKNOWN, so a page falls back to
 * `prefers-color-scheme`, which the browser tracks live.
 */
export function appearanceFromMacDefaults(values: MacDefaultsValues): DesktopAppearance {
    const index = values.appleAccentColor?.trim();
    const hex =
        index === undefined || index === null || index === '' ? MACOS_ACCENT_COLORS[4] : MACOS_ACCENT_COLORS[index];
    const rgb = hex ? parseAdwRgb(hex) : null;

    const style = values.appleInterfaceStyle?.trim();
    const automatic = values.appleInterfaceStyleSwitchesAutomatically?.trim() === '1';
    const colorScheme: AdwSystemColorScheme | undefined =
        style === 'Dark' ? 'dark' : style ? undefined : automatic ? undefined : 'light';

    return compact({ ...(rgb ? fromRgb(rgb) : {}), colorScheme });
}

/**
 * Parse one value out of `reg.exe query <key> /v <name>` output:
 *
 *     HKEY_CURRENT_USER\Software\Microsoft\Windows\DWM
 *         AccentColor    REG_DWORD    0xffd47800
 *
 * Returns a number for `REG_DWORD`, bytes for `REG_BINARY`, `null` when the
 * value is not in the output (reg.exe then exits 1 with an error instead).
 */
export function parseRegQuery(stdout: string, name: string): number | Uint8Array | null {
    for (const line of stdout.split(/\r?\n/)) {
        const match = /^\s+(.+?)\s{2,}(REG_\w+)\s{2,}(\S*)\s*$/.exec(line);
        if (!match || match[1] !== name) continue;
        const [, , type, data] = match;
        if (type === 'REG_DWORD') {
            const value = Number.parseInt(data, 16);
            return Number.isFinite(value) ? value >>> 0 : null;
        }
        if (type === 'REG_BINARY') {
            if (data.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(data)) return null;
            const bytes = new Uint8Array(data.length / 2);
            for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(data.slice(i * 2, i * 2 + 2), 16);
            return bytes;
        }
        return null;
    }
    return null;
}
