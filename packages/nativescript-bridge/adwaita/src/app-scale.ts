// How large the interface is, as ONE number — the NativeScript half.
//
// The reasoning (why 360, why never below 1, why tablets are left alone, why this is not the
// system font scale) lives with the pure code in `@gjsify/adwaita-core/app-scale`. This file is
// the part that cannot be tested off-device: reading the real screen, and the one
// `Application.addCss` call.
//
// APPEND-ONLY, like every other runtime override on this port (`widgets/adw-accent.ts`).
// `addCss` adds rules and cannot take them back, so going from 1.5 back to 1.143 is not a
// removal but a later override with the 1.143 values — which is why `scaleAdwaitaCss` emits at
// every factor, 1 included. The sheet is length-only, so it never touches the accent and named
// colour overrides however the two are ordered.
//
// THE APP HANDS OVER ITS OWN STYLESHEET. NativeScript applies `app.css` itself and keeps no
// readable copy, so there is nothing here to re-read; the app passes the processed text in
// (Vite's `?inline`), which is also the only way the app's OWN rules — its Tailwind utilities,
// its button and gamepad CSS — are scaled along with the Adwaita theme. An app that registers
// nothing gets no override, not a half-scaled interface.

import { Application, Screen } from '@nativescript/core';
import {
    type AppScaleSetting,
    APP_SCALE_MIN,
    deriveAppScale,
    resolveAppScale,
    scaleDip as scaleDipBy,
} from '@gjsify/adwaita-core/app-scale';
import { cssPxToDip, scaleAdwaitaCss } from '@gjsify/adwaita-core/css-length';

// The pure parts an app needs to offer the setting — so a settings UI imports this one module
// and never has to know that half of the feature lives in `adwaita-core`.
export {
    APP_SCALE_MAX,
    APP_SCALE_MIN,
    appScaleChoices,
    parseAppScaleSetting,
    type AppScaleSetting,
} from '@gjsify/adwaita-core/app-scale';

let sheet = '';
let setting: AppScaleSetting = 'auto';
let applied = APP_SCALE_MIN;
let appended = false;

/** The scale this screen asks for — what `'auto'` resolves to. */
export function defaultAppScale(): number {
    const screen = Screen.mainScreen;
    return deriveAppScale({ widthDips: screen.widthDIPs, heightDips: screen.heightDIPs });
}

/** The factor currently in effect. */
export function appScale(): number {
    return applied;
}

/** What the scale is SET to: a factor, or `'auto'` for {@link defaultAppScale}. */
export function appScaleSetting(): AppScaleSetting {
    return setting;
}

/**
 * A length this code sets itself, at the scale in effect — for the sizes no stylesheet reaches.
 *
 * Read at the moment the length is used, not cached: a scale set later has to reach the next
 * widget that is built. What is already drawn keeps its size until the view is rebuilt, which is
 * the one place the CSS half and this one differ.
 */
export function scaleDip(length: number): number {
    return scaleDipBy(length, applied);
}

function apply(): void {
    const next = resolveAppScale(setting, defaultAppScale());
    // No stylesheet handed over, so there is nothing to scale — and an interface whose
    // code-set lengths grew while its CSS stayed put is worse than one left as authored.
    if (sheet === '') return;
    // Nothing to undo and nothing to scale: the app is already drawn as authored.
    if (!appended && next === APP_SCALE_MIN) {
        applied = next;
        return;
    }
    applied = next;
    const css = scaleAdwaitaCss(sheet, next);
    if (css === '') return;
    Application.addCss(css);
    appended = true;
}

/**
 * Put the scale back on top after something else was appended.
 *
 * Position decides between two rules of the same specificity, so whoever appends LAST wins. A
 * theme change re-appends the theme's own lengths (`platform-host.ts`, `setStyles`), which is an
 * override of this override; the only way to keep the scale is to append it again behind it.
 */
export function reapplyAppScaleCss(): void {
    if (!appended) return;
    apply();
}

/**
 * Hand the app's processed stylesheet over, so its lengths can be scaled.
 *
 * Call it once, after NativeScript has applied `app.css` — from the application's `activate`,
 * not from module scope: an override appended BEFORE the sheet it overrides loses on position.
 *
 * @param css  the processed stylesheet, e.g. `import css from './app.css?inline'`.
 */
export function registerAppScaleCss(css: string): void {
    sheet = cssPxToDip(css);
    apply();
}

/**
 * Set the interface scale: a factor, or `'auto'` to go back to the one derived from the screen.
 *
 * Takes effect immediately — `addCss` re-resolves the style of every live view. Persisting the
 * choice is the app's, since only the app knows where its settings live.
 */
export function setAppScale(next: AppScaleSetting): void {
    setting = next;
    apply();
}
