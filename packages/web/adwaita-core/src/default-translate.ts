// The translator a builder falls back to when its caller passed none — the slot a platform
// fills with its REAL gettext, so a `.blp` string marked `_()` / `C_()` reads in the user's
// language without every call site threading `translate` through.
//
// GtkBuilder translates a marked string in its translation domain, and the default domain
// (`textdomain()`) when none was set. A pure-JS renderer has no gettext of its own, so the slot
// starts EMPTY and an empty slot means "carried, not acted on": the string stays as authored.
// `@gjsify/adwaita-gobject-native`'s opt-in is what fills it on a device, over GLib's
// `dgettext` / `dpgettext2` — the functions GtkBuilder itself calls.
//
// A slot rather than an import: the core stays free of any platform binding, and a renderer
// that needs no translation (the web one, today) never reads it.

/** Translates `text`, disambiguated by the `C_()` `context` when there is one. */
export type DefaultTranslate = (text: string, context?: string) => string;

let registered: DefaultTranslate | undefined;

/** Install the translator; the last registration wins, as a later `textdomain()` call would. */
export function registerDefaultTranslate(translate: DefaultTranslate | undefined): void {
    registered = translate;
}

/** The installed translator, or `undefined` when no platform filled the slot. */
export function registeredDefaultTranslate(): DefaultTranslate | undefined {
    return registered;
}
