// Adwaita Sans font support for NativeScript.
//
// NativeScript does NOT load fonts from CSS `@font-face` the way a browser does.
// Instead it picks up `.ttf`/`.otf` files placed in the platform resource dirs:
//   - Android: `App_Resources/Android/src/main/assets/fonts/`
//   - iOS:     `App_Resources/iOS/fonts/`
// and a `font-family` is then matched DUALLY:
//   - on Android by the TTF FILE NAME (without extension), e.g. `AdwaitaSans-Regular`
//   - on iOS by the font's POSTSCRIPT NAME, e.g. `Adwaita Sans`
//
// To make one `font-family` string work on both platforms, NativeScript lets you
// list BOTH names, comma-separated; it tries each until one resolves. That dual
// name is exported below as {@link ADWAITA_SANS_FONT_FAMILY}.
//
// The TTF payloads come from `@gjsify/adwaita-fonts` (SIL OFL 1.1) — the SAME
// files the browser `@gjsify/adwaita-web` stack uses — so there is a single
// source of truth for the typeface across the web and NativeScript targets.
// This module only documents/exposes the wiring; the actual files must be COPIED
// into `App_Resources` by the consumer (a bundler can't drop files into the
// native resource dirs for you). See {@link adwaitaFontInstallInstructions}.

import { isNativeScript } from '@gjsify/native-platform';

/**
 * `font-family` value that resolves Adwaita Sans on BOTH Android and iOS.
 *
 * Order matters: `'Adwaita Sans'` is the iOS PostScript name; `'AdwaitaSans-Regular'`
 * is the Android TTF file name (drop `adwaita-sans-400.ttf` in renamed, or rename
 * it on copy — see {@link ADWAITA_SANS_TTF_FILES}). Apply it via CSS
 * `font-family: 'Adwaita Sans', 'AdwaitaSans-Regular';` or a widget's `.style.fontFamily`.
 */
export const ADWAITA_SANS_FONT_FAMILY = "'Adwaita Sans', 'AdwaitaSans-Regular'";

/** The TTF assets shipped by `@gjsify/adwaita-fonts`, with their target NS file names. */
export const ADWAITA_SANS_TTF_FILES = {
    /** Regular 400. Source path within `@gjsify/adwaita-fonts`. */
    regular: {
        source: '@gjsify/adwaita-fonts/files/adwaita-sans-400.ttf',
        /** File name to use under `App_Resources/.../fonts/` (Android matches on this). */
        target: 'AdwaitaSans-Regular.ttf',
        /** iOS PostScript family name. */
        postscriptName: 'Adwaita Sans',
    },
    /** Italic 400. */
    italic: {
        source: '@gjsify/adwaita-fonts/files/adwaita-sans-400-italic.ttf',
        target: 'AdwaitaSans-Italic.ttf',
        postscriptName: 'Adwaita Sans',
    },
} as const;

/**
 * Human-readable, copy-pasteable instructions for installing the Adwaita Sans
 * TTFs into a NativeScript app's `App_Resources`. Returned as a string so it can
 * be logged from a setup script or surfaced in docs/tests.
 */
export function adwaitaFontInstallInstructions(): string {
    const { regular, italic } = ADWAITA_SANS_TTF_FILES;
    return [
        'Install Adwaita Sans into your NativeScript app:',
        '',
        '1. Resolve the TTFs from @gjsify/adwaita-fonts:',
        `     ${regular.source}`,
        `     ${italic.source}`,
        '',
        '2. Copy them into BOTH platform resource font dirs, renamed so the',
        '   Android file name matches the font-family:',
        `     App_Resources/Android/src/main/assets/fonts/${regular.target}`,
        `     App_Resources/Android/src/main/assets/fonts/${italic.target}`,
        `     App_Resources/iOS/fonts/${regular.target}`,
        `     App_Resources/iOS/fonts/${italic.target}`,
        '',
        `3. Use the dual font-family string: ${ADWAITA_SANS_FONT_FAMILY}`,
        '   (iOS resolves the PostScript name "Adwaita Sans"; Android resolves the',
        '   file name "AdwaitaSans-Regular".)',
    ].join('\n');
}

/**
 * Returns whether Adwaita Sans can be relied upon — true only under NativeScript
 * (where the resource-dir fonts apply). Off NativeScript this is always `false`;
 * it never throws, so callers can branch on it to fall back to a system font.
 */
export function hasAdwaitaSans(): boolean {
    return isNativeScript;
}
