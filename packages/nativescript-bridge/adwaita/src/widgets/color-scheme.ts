// Adwaita light/dark color-scheme state — re-exported from `@gjsify/adwaita-core`.
//
// The observable is HEADLESS in `@gjsify/adwaita-core` (ADR 0004); this shim
// re-exports it so consumers keep importing from `@gjsify/adwaita-nativescript`.
//
// The NS-specific halves stay with their owners: the HOST APP toggles `ns-dark` on
// its root view (NS re-applies CSS on a class change) and seeds the scheme from
// `Application.systemAppearance()`; `GtkImage` / `AdwImageButton` subscribe here and
// RE-RENDER their pre-coloured symbolic-icon `Bitmap` on a change, because the NS CSS
// subset cannot recolour a bitmap — UNLESS the caller set an explicit colour, which
// must survive both schemes.

export {
    adwaitaColorScheme,
    isThemeIconColor,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    themeIconColor,
    toggleAdwaitaColorScheme,
} from '@gjsify/adwaita-core';
export type { AdwColorScheme } from '@gjsify/adwaita-core';
