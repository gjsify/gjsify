// The colour a `Gtk.Image`'s style classes give its symbolic icon — the pure half of
// `GtkImage.styleClasses`.
//
// WHY A COLOUR FUNCTION AND NOT A STYLESHEET RULE. libadwaita colours a symbolic icon through
// the CSS `color` of its `image` node; here the icon is a `Bitmap` already rasterised in its
// fill colour, and NativeScript drops a CSS value for any property the widget set as a LOCAL
// one (the reason `status/nativescript-theme-classes.json` reviews `adw-icon` as inert for
// `color`). So a colour utility class can only reach an icon by being RESOLVED into the colour
// the bitmap is drawn in, and resolved again whenever the scheme or the accent moves — which is
// what `GtkImage` does with the answer below.
//
// THE CLASS ITSELF STAYS ON `className` regardless, so the rules that CAN reach an icon
// (`opacity` from `.dim-label` and `.dimmed`, margin, background) apply through the stylesheet
// like on every other widget; only colour needs this.
//
// ONLY `accent` HAS A COLOUR HERE. `success`, `warning` and `error` are the same utility set
// (`_colors.scss`) but their standalone colours are not derived in this port yet — the open entry
// in `status/open-todos/nativescript.md` — so they are carried as classes and colour nothing, the
// same as on a `Label`. Taking them here first would give an icon a colour its neighbouring
// label cannot have.
//
// STANDALONE, NOT FILL: `.accent` is `--accent-color`, the derived text-on-surface colour
// (`min(l, 0.5)` on a light page, `max(l, 0.85)` on a dark one), not `--accent-bg-color` — see
// `accent-theme.ts` for the roles.
//
// Free of `@nativescript/core` value imports so a spec can exercise the shipping function.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwAccentColorName, AdwColorScheme } from '@gjsify/adwaita-core';
import { adwaitaNsAccentColor } from './accent-theme.js';

/** The style class that paints an icon in the standalone accent colour. */
export const IMAGE_ACCENT_CLASS = 'accent';

/**
 * The fill the style classes ask for, or `null` when none of them names a colour (the icon then
 * follows the colour scheme's default fill).
 */
export function imageClassColor(
    classes: readonly string[],
    accent: AdwAccentColorName,
    scheme: AdwColorScheme,
): string | null {
    if (!classes.includes(IMAGE_ACCENT_CLASS)) return null;
    return adwaitaNsAccentColor(accent, scheme === 'dark' ? 'standalone-dark' : 'shade');
}
