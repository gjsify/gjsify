// The colour scheme, without React — so the hook is three lines and this is testable.
//
// ADR 0032 § 3's first measured property of the styling surface: **no `dark:`
// variant occurs at all** in the measured application. Dark mode runs through CSS
// variables that a root class redefines, and on GTK that is one variable block per
// scheme with `Adw.StyleManager` doing the switching — so `bg-grey-100` flips by
// itself and nothing re-renders. `useColorScheme` is therefore not the mechanism
// that themes an application; it is the escape hatch for the handful of places that
// genuinely branch in JavaScript.
//
// `Adw.StyleManager:dark` rather than `:color-scheme`, and the difference matters:
// `color-scheme` is what the APPLICATION ASKED FOR (its default is `DEFAULT`,
// measured as the numeric 0), while `dark` is what the user is actually LOOKING AT
// after the desktop's own preference has been folded in. React Native's
// `useColorScheme` reports the latter.

import Adw from 'gi://Adw?version=1';

import { PrimitiveError } from '../primitives/errors.js';

/** React Native's own type. `null` is its "unknown", which does not occur here. */
export type ColorSchemeName = 'light' | 'dark';

function manager(): Adw.StyleManager {
    const styleManager = Adw.StyleManager.get_default();
    if (styleManager === null) {
        throw new PrimitiveError(
            'useColorScheme',
            '',
            'needs `Adw.StyleManager.get_default()`, which answers null before libadwaita is initialised. Construct the application first — `runAdwaitaApp` and `AppRegistry.runApplication` both do it',
        );
    }
    return styleManager;
}

/** What the user is looking at right now. */
export const currentColorScheme = (): ColorSchemeName => (manager().dark ? 'dark' : 'light');

/**
 * Ask for a scheme, or hand the choice back to the desktop.
 *
 * The WRITE side of the same object, and the one place `Adw.StyleManager:color-scheme`
 * is the right property rather than `dark`: `color-scheme` is what the APPLICATION
 * asked for, which is exactly what `Appearance.setColorScheme` sets, while `dark` is
 * read-only and is what the user ends up looking at.
 *
 * MEASURED on libadwaita 1.9.3: `Adw.ColorScheme` is DEFAULT=0, FORCE_LIGHT=1,
 * PREFER_LIGHT=2, PREFER_DARK=3, FORCE_DARK=4. React Native's three values are
 * `'light'`, `'dark'` and `null` (follow the system), so the FORCE members are the
 * mapping and the PREFER members are not: `PREFER_DARK` means "dark unless the
 * desktop insists otherwise", which is a fourth state React Native cannot express and
 * would make `setColorScheme('dark')` a request the desktop could refuse.
 *
 * The two are round-trip verifiable and the spec does it: setting FORCE_LIGHT made
 * `dark` false and raised `notify::dark`, and FORCE_DARK made it true again.
 */
export function setColorSchemePreference(scheme: ColorSchemeName | null): void {
    const styleManager = manager();
    styleManager.colorScheme =
        scheme === null
            ? Adw.ColorScheme.DEFAULT
            : scheme === 'dark'
              ? Adw.ColorScheme.FORCE_DARK
              : Adw.ColorScheme.FORCE_LIGHT;
}

/** What the application has ASKED for, which is not what it is looking at. */
export const requestedColorScheme = (): ColorSchemeName | null => {
    const scheme = manager().colorScheme;
    if (scheme === Adw.ColorScheme.FORCE_DARK) return 'dark';
    if (scheme === Adw.ColorScheme.FORCE_LIGHT) return 'light';
    return null;
};

/**
 * Call `listener` whenever the scheme changes; returns the unsubscribe.
 *
 * `notify::dark` and not `notify::color-scheme`: the desktop switching from light
 * to dark does not change what the application asked for, so a subscriber on
 * `color-scheme` would never fire for the one event this API exists to report.
 *
 * The disposer disconnects rather than tracking a flag, because GJS blocks JS
 * callbacks during GC — a handler that is not disconnected stays connected for the
 * life of the process, which is the leak `gtk-host`'s own lifetime rules exist for.
 */
export function onColorSchemeChange(listener: (scheme: ColorSchemeName) => void): () => void {
    const styleManager = manager();
    const handler = styleManager.connect('notify::dark', () => {
        listener(styleManager.dark ? 'dark' : 'light');
    });
    return () => styleManager.disconnect(handler);
}
