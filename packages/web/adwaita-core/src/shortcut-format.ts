// Platform-aware keyboard-shortcut display — the counterpart to
// `./shortcut-label` for the OTHER string convention a consumer hands us.
//
// `shortcut-label.ts` already parses libadwaita's accelerator grammar
// (`<Control><Shift>b`) and already resolves `<Primary>` to the platform's
// real modifier (Control everywhere, Command on Apple — GDK's own mapping).
// `formatAcceleratorLabel` below is a thin wrapper over that: it owns no
// modifier table of its own, so it cannot drift from the parser a GTK host
// renders with.
//
// A WebExtension manifest (`suggested_key`, `browser.commands.getAll()`)
// spells a shortcut a DIFFERENT way — `"Alt+Shift+B"`, built for Windows and
// Linux even when the browser runs on a Mac, because that is the manifest key
// spelling, not a display string. Chrome's own docs call out that `Ctrl` in
// such a string means Command once macOS runs it — the actual Control key is
// the separate token `MacCtrl`. `formatManifestShortcut` reads THAT grammar.
//
// Both keep the same shape: pure, no platform read inside — the caller passes
// `platform`, because a browser extension gets it from
// `browser.runtime.getPlatformInfo()` and a GTK app from its own host, and
// this package stays headless (`gjsify.headless: true`, no globalThis reads,
// no DOM assumptions — see the file header of `./index.ts`).

import { shortcutKeycaps } from './shortcut-label.js';

/** `'mac'` picks Apple's glyphs and modifier order; `'other'` leaves the input alone. */
export type ShortcutPlatform = 'mac' | 'other';

/** libadwaita has no opinion here; this is Apple's own modifier order (HIG), left to right. */
const MANIFEST_MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'] as const;

/**
 * What each manifest modifier word becomes on a Mac. `ctrl`/`control` map to
 * Command: a manifest that says `Ctrl+Shift+B` is interpreted by Chrome as the
 * Command key once it runs on macOS (its own docs call this out), so the
 * token a `commands.getAll()` result carries there means ⌘, not ⌃. The actual
 * Control key is the separate manifest token `MacCtrl`.
 */
const MANIFEST_MAC_MODIFIERS: Readonly<Record<string, string>> = {
    macctrl: '⌃',
    ctrl: '⌘',
    control: '⌘',
    command: '⌘',
    cmd: '⌘',
    meta: '⌘',
    alt: '⌥',
    option: '⌥',
    shift: '⇧',
};

/**
 * Non-letter manifest keys macOS shows as something other than their own
 * name. Deliberately small: only the keys a consumer actually hits (arrows,
 * the editing/navigation keys) — an unlisted key passes through unchanged, as
 * `Delete` or `F1` already read fine on every platform. `Space` stays a word,
 * not a glyph: unlike the others there is no single mark macOS uses for it in
 * a shortcut label (it names the key, the way `⌘Space` reads in the Spotlight
 * shortcut).
 */
const MANIFEST_MAC_KEYS: Readonly<Record<string, string>> = {
    return: '↩',
    enter: '↩',
    escape: '⎋',
    delete: '⌫',
    tab: '⇥',
    left: '←',
    up: '↑',
    right: '→',
    down: '↓',
    space: 'Space',
};

/** A raw value some engine already rendered as glyphs, e.g. Safari's own "⌥⇧B". */
const HAS_GLYPHS = /[⌃⌥⇧⌘]/;

/**
 * `raw` as a WebExtension manifest or `browser.commands.getAll()` spells it
 * (e.g. `"Alt+Shift+B"`, `"MacCtrl+Shift+B"`). Empty input stays empty:
 * whether that means "show nothing" or "show a fallback" is a decision for
 * the caller, not this formatter. A value some engine already rendered as
 * glyphs (Safari, Chromium in places) passes through unchanged — formatting
 * it twice would be wrong twice — and so does every non-mac platform, because
 * that IS how Windows/Linux/ChromeOS show it.
 */
export function formatManifestShortcut(raw: string, platform: ShortcutPlatform): string {
    const trimmed = raw.trim();
    if (!trimmed || HAS_GLYPHS.test(trimmed) || platform !== 'mac') return trimmed;

    const parts = trimmed.split('+').map((part) => part.trim());
    const key = parts.pop() ?? '';
    const glyphs = new Set(
        parts.map((part) => MANIFEST_MAC_MODIFIERS[part.toLowerCase()]).filter((glyph) => glyph !== undefined),
    );
    const ordered = MANIFEST_MAC_ORDER.filter((glyph) => glyphs.has(glyph));
    const keyLabel = MANIFEST_MAC_KEYS[key.toLowerCase()] ?? key;

    return [...ordered, keyLabel].join('');
}

/**
 * `accelerator` as GTK spells it (`"<Control><Shift>b"`, `"<Primary>q"`,
 * `"<Alt>F4"`). Delegates the actual parse to `shortcutKeycaps` so the
 * modifier table — including `<Primary>` resolving to ⌘ on mac and `<Control>`
 * staying ⌃, GTK's own macOS behaviour — lives in exactly one place. Returns
 * the accelerator unchanged if it fails to parse (an unknown modifier, an
 * unterminated `<`).
 *
 * Non-mac renders the GTK-style human label (`"Ctrl+Shift+B"`, `+`-joined,
 * letter keys upper-cased); mac renders Apple's glyphs in HIG order with no
 * separator (`"⌃⇧B"`), matching `formatManifestShortcut`.
 */
export function formatAcceleratorLabel(accelerator: string, platform: ShortcutPlatform): string {
    const keys = shortcutKeycaps(accelerator, platform === 'mac' ? 'apple' : 'default');
    if (!keys) return accelerator;

    return keys.map((keycap) => keycap.label).join(platform === 'mac' ? '' : '+');
}
