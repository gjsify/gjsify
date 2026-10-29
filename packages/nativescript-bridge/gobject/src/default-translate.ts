// The default `translate` of a `.blp` tree — GtkBuilder's own: GLib's gettext in the default
// domain. `dgettext(null, …)` and `dpgettext2(null, ctx, …)` are the calls GtkBuilder makes for a
// string marked `_()` / `C_()` when no translation domain was set, so a device with the real
// engine reads the catalogue `textdomain()` / `@gjsify/node-gi/gettext` bound.

import type { DefaultTranslate } from '@gjsify/adwaita-core';

import type { RequireGi } from './engine.js';

interface GLibGettext {
    dgettext(domain: string | null, text: string): string;
    dpgettext2(domain: string | null, context: string, text: string): string;
}

/** Resolves GLib lazily, on the first marked string, and leaves an empty string untouched. */
export function glibTranslate(requireGi: RequireGi): DefaultTranslate {
    let glib: GLibGettext | undefined;
    return (text, context) => {
        if (text === '') return text;
        glib ??= requireGi('GLib', '2.0') as GLibGettext;
        return context === undefined ? glib.dgettext(null, text) : glib.dpgettext2(null, context, text);
    };
}
