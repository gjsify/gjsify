// Untranslated `Gettext` stand-in for NativeScript platforms with no native gettext bridge.
//
// `@gjsify/node-gi/gettext` is the GLib gettext answer for `import Gettext from 'gettext'`
// (`ALIASES_NODE_FOR_NATIVESCRIPT`), but it is Android-only by construction: its first import
// eagerly loads `libnode_gi.so` (`@gjsify/node-gi/index.js`'s module-level `loadNativeHost()`),
// and there is no node-gi payload for iOS (same fact `engine-target.ios.ts` encodes for the
// GObject engine). Routing the bare `gettext` specifier there on iOS crashes every app at
// import time, before any of its own code runs — measured on Learn6502's iOS build, 2026-11-02.
//
// This stands in wherever that routing points elsewhere (iOS, visionOS, an undetected
// platform): every lookup returns its English `msgid`/`msgid_plural` unchanged, so the app
// runs — untranslated — instead of crashing. Only the five functions `@gjsify/adwaita-app`'s
// `locale-nativescript.js` actually calls are implemented; the rest of the GJS `Gettext`
// surface (`gettext`, `pgettext`, `domain`, …) is deliberately not — add them here, backed by a
// real NSBundle/CFBundle lookup, the day iOS translation is built.

/** No catalog to bind on a platform with no gettext backend; always reports success. */
export function bindtextdomain(_domainName: string, _dirName: string | null): string | null {
    return null;
}

/** Tracks the active domain name so `textdomain(null)` can report it back, as GJS's does. */
let activeDomain: string | null = null;

export function textdomain(domainName: string | null): string | null {
    if (domainName !== null) activeDomain = domainName;
    return activeDomain;
}

/** No catalog is loaded, so every msgid is its own translation. */
export function dgettext(_domain: string | null, msgid: string): string {
    return msgid;
}

/** `n === 1` picks the singular, as every real gettext plural rule does for English. */
export function dngettext(_domain: string | null, msgid: string, msgidPlural: string, n: number): string {
    return n === 1 ? msgid : msgidPlural;
}

/** No catalog is loaded, so a context lookup is just its own msgid. */
export function dpgettext(_domain: string | null, _context: string, msgid: string): string {
    return msgid;
}

// `import Gettext from 'gettext'` takes the DEFAULT export, as `@gjsify/node-gi/gettext` ships
// one (its `locale-nativescript.js` caller reads `Gettext.bindtextdomain`, never a named import).
export default { bindtextdomain, textdomain, dgettext, dngettext, dpgettext };
