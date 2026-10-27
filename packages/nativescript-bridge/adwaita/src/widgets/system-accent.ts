// What the Android platform says about contrast and accent, read without `android.R`: the NativeScript
// runtime's metadata exposes no `android.R` inner classes, so `android.R.color.system_accent1_500` is
// `undefined.…` and throws. The resource id is looked up by NAME instead (`0` = the device has none).
// The `android` global is passed in, never read here, so a host that lacks pieces of it is testable.

import { nearestAccent, type AdwAccentColorName } from '@gjsify/adwaita-core';

/** The slice of the `android` global read here; absent off Android, so every hop is a refusal. */
export interface AndroidGlobals {
    os?: { Build?: { VERSION?: { SDK_INT?: number } } };
}

export interface AndroidContext {
    getSystemService(name: string): { getContrast?(): number } | null;
    getResources?(): { getIdentifier(name: string, type: string, pkg: string): number } | null;
    getColor?(id: number): number;
}

// `Context.UI_MODE_SERVICE`, spelled out: the constant is one more member to be missing at runtime.
const UI_MODE_SERVICE = 'uimode';

function sdk(android: AndroidGlobals | undefined): number {
    return android?.os?.Build?.VERSION?.SDK_INT ?? 0;
}

// `UiModeManager.getContrast()` is 0, 0.5 or 1; `Adw.StyleManager:high-contrast` is the top level.
export function systemHighContrast(android: AndroidGlobals | undefined, context: AndroidContext | null): boolean {
    if (sdk(android) < 34) return false;
    const manager = context?.getSystemService(UI_MODE_SERVICE);
    return (manager?.getContrast?.() ?? 0) >= 1;
}

// Material You's `system_accent1_500`, snapped to the nearest of the nine like libadwaita does.
export function systemAccent(
    android: AndroidGlobals | undefined,
    context: AndroidContext | null,
): AdwAccentColorName | null {
    if (sdk(android) < 31) return null;
    const id = context?.getResources?.()?.getIdentifier('system_accent1_500', 'color', 'android') ?? 0;
    if (id === 0) return null;
    const argb = context?.getColor?.(id);
    if (argb === undefined) return null;
    return nearestAccent({
        red: ((argb >> 16) & 0xff) / 255,
        green: ((argb >> 8) & 0xff) / 255,
        blue: (argb & 0xff) / 255,
    });
}
