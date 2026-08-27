// `Appearance` — the imperative sibling of `useColorScheme`, over the SAME reader.
//
// There is exactly one place in this package that asks GTK what the colour scheme is
// (`apis/color-scheme.ts`) and exactly one that subscribes to it, and this file adds
// neither. That is the whole point of the split the hook already has: `useColorScheme`
// is three lines of `useSyncExternalStore` over `currentColorScheme` /
// `onColorSchemeChange`, and `Appearance.getColorScheme` /
// `Appearance.addChangeListener` are three lines over the same two functions. A second
// reader would be a second answer, and the two would disagree in the one moment that
// matters — while the desktop is switching.
//
// `Adw.StyleManager:dark` versus `:color-scheme` is the distinction that makes
// `getColorScheme` and `setColorScheme` different properties: `dark` is what the user
// is LOOKING AT (the desktop's preference folded in) and `color-scheme` is what the
// application ASKED FOR. React Native's getter means the first and its setter means
// the second, which is why `color-scheme.ts` exports both.

import {
    currentColorScheme,
    onColorSchemeChange,
    setColorSchemePreference,
    type ColorSchemeName,
} from './color-scheme.js';
import { PrimitiveError } from '../primitives/errors.js';
import type { EventSubscription } from '../event-emitter.js';

/** React Native's own payload for a scheme change. */
export interface AppearancePreferences {
    readonly colorScheme: ColorSchemeName | null;
}

export const Appearance = {
    /**
     * What the user is looking at. Never `null` here.
     *
     * React Native returns `null` for "the platform does not report one", which a
     * desktop always does: `Adw.StyleManager:dark` is a boolean, so the answer is one
     * of the two. Ported code that branches on `null` simply never takes that branch,
     * which is the same thing it does on a phone that answers.
     */
    getColorScheme(): ColorSchemeName {
        return currentColorScheme();
    },

    /** Ask for light, dark, or `null` to follow the desktop again. */
    setColorScheme(scheme: ColorSchemeName | null): void {
        if (scheme !== null && scheme !== 'light' && scheme !== 'dark') {
            throw new PrimitiveError(
                'Appearance',
                `setColorScheme("${String(scheme)}")`,
                'is not a scheme React Native defines. It has three: "light", "dark", and null to follow the system',
            );
        }
        setColorSchemePreference(scheme);
    },

    /**
     * Subscribe to scheme changes, imperatively.
     *
     * The same subscription `useColorScheme` uses, so a component and an imperative
     * caller cannot see different schemes. The disposer disconnects the GObject
     * handler rather than setting a flag: GJS blocks JS callbacks during GC, so a
     * handler left connected stays connected for the life of the process.
     */
    addChangeListener(listener: (preferences: AppearancePreferences) => void): EventSubscription {
        const dispose = onColorSchemeChange((colorScheme) => listener({ colorScheme }));
        return { remove: dispose };
    },
} as const;
