// The platform half of `Adw.StyleManager` on NativeScript: hands `Application.systemAppearance()` and
// its `systemAppearanceChanged` event to the source in `style-manager.ts`, so the scheme follows the
// system and `system_supports_color_schemes` is true where the system reports a preference — the
// "follow system" choice an app offers only then. `namespace/adw.ts` exports the class from here; the
// source subscribes to the event only once a manager is in use, so importing `Adw` touches nothing.

import { Application } from '@nativescript/core';
import type { AdwAccentColorName, AdwColorScheme } from '@gjsify/adwaita-core';

import { applyAdwaitaNsAccent } from './adw-accent.js';
import { AdwStyleManager, setAccentPainter, setSystemAppearance } from './style-manager.js';
import { systemAccent, systemHighContrast, type AndroidContext, type AndroidGlobals } from './system-accent.js';

function asScheme(value: unknown): AdwColorScheme | null {
    return value === 'dark' || value === 'light' ? value : null;
}

declare const android: AndroidGlobals | undefined;

function androidContext(): AndroidContext | null {
    return (Application.android?.context ?? null) as AndroidContext | null;
}

function highContrast(): boolean {
    return systemHighContrast(typeof android === 'undefined' ? undefined : android, androidContext());
}

function accentColor(): AdwAccentColorName | null {
    return systemAccent(typeof android === 'undefined' ? undefined : android, androidContext());
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
