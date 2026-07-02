// Adwaita light/dark color-scheme state — re-exported from `@gjsify/adwaita-core`.
//
// The observable itself (state + subscribe/notify + the light/dark fg colour
// constants) is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004); this
// shim re-exports it so existing consumers keep importing it from
// `@gjsify/adwaita-nativescript` unchanged.
//
// The NS-specific halves stay with their owners: the HOST APP toggles the
// `ns-dark` class on its root view (NS re-applies CSS on a class change, so
// backgrounds / text / borders flip for free) and seeds the scheme from
// `Application.systemAppearance()`; `AdwIcon` / `AdwImageButton` subscribe here
// and RE-RENDER their pre-coloured symbolic-icon `Bitmap` in `themeIconColor()`
// on a change (the NS CSS subset cannot recolour a bitmap) — UNLESS the caller
// set an explicit colour (white on a suggested button, destructive red), which
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
