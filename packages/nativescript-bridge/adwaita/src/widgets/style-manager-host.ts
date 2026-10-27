// The platform half of `Adw.StyleManager` on NativeScript: hands `Application.systemAppearance()` and
// its `systemAppearanceChanged` event to the source in `style-manager.ts`, so the scheme follows the
// system and `system_supports_color_schemes` is true where the system reports a preference — the
// "follow system" choice an app offers only then. `namespace/adw.ts` exports the class from here; the
// source subscribes to the event only once a manager is in use, so importing `Adw` touches nothing.

import { Application } from '@nativescript/core';
import { nearestAccent, type AdwAccentColorName, type AdwColorScheme } from '@gjsify/adwaita-core';

import { applyAdwaitaNsAccent } from './adw-accent.js';
import { AdwStyleManager, setAccentPainter, setSystemAppearance } from './style-manager.js';

function asScheme(value: unknown): AdwColorScheme | null {
    return value === 'dark' || value === 'light' ? value : null;
}

// The slice of the `android` global read here; absent off Android, so every hop is a refusal.
declare const android:
    | {
          os: { Build: { VERSION: { SDK_INT: number } } };
          content: { Context: { UI_MODE_SERVICE: string } };
          R: { color: Record<string, number> };
      }
    | undefined;

interface AndroidContext {
    getSystemService(name: string): { getContrast?(): number } | null;
    getColor(id: number): number;
}

function androidContext(): AndroidContext | null {
    return (Application.android?.context ?? null) as AndroidContext | null;
}

// `UiModeManager.getContrast()` is 0, 0.5 or 1; `Adw.StyleManager:high-contrast` is the top level.
function highContrast(): boolean {
    if (android === undefined || android.os.Build.VERSION.SDK_INT < 34) return false;
    const manager = androidContext()?.getSystemService(android.content.Context.UI_MODE_SERVICE);
    return (manager?.getContrast?.() ?? 0) >= 1;
}

// Material You's `system_accent1_500`, snapped to the nearest of the nine like libadwaita does.
function accentColor(): AdwAccentColorName | null {
    if (android === undefined || android.os.Build.VERSION.SDK_INT < 31) return null;
    const id = android.R.color.system_accent1_500;
    const argb = id === undefined ? undefined : androidContext()?.getColor(id);
    if (argb === undefined) return null;
    return nearestAccent({
        red: ((argb >> 16) & 0xff) / 255,
        green: ((argb >> 8) & 0xff) / 255,
        blue: (argb & 0xff) / 255,
    });
}

setSystemAppearance({
    highContrast,
    accentColor,
    current() {
        // Before the first Activity there is no configuration to read; that is "cannot tell".
        try {
            return asScheme(Application.systemAppearance());
        } catch {
            return null;
        }
    },
    subscribe(changed) {
        const handler = (args: unknown) => {
            const scheme = asScheme((args as { newValue?: unknown }).newValue);
            if (scheme !== null) changed(scheme);
        };
        // Contrast and accent changes arrive as a configuration change, not as a scheme: re-read on resume.
        const reread = () => changed(null);
        Application.on('systemAppearanceChanged', handler);
        Application.on('resume', reread);
        return () => {
            Application.off('systemAppearanceChanged', handler);
            Application.off('resume', reread);
        };
    },
});

setAccentPainter(applyAdwaitaNsAccent);

export { AdwStyleManager };
