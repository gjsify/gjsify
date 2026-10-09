// Live light/dark switching for the NativeScript view tree.
//
// WHY THIS EXISTS. `ViewBase.className`'s `valueChanged` re-adds the system CSS classes
// (`ns-dark`, `ns-android`, …) to the view's own `cssClasses` as they were at THAT moment, and
// every widget of this port writes a `className`. On a scheme change `Application` swaps
// `ns-dark`/`ns-light` on the ROOT view only, so each view below it keeps the old copy and
// every `.ns-dark …` rule keeps matching: the status bar and the root-level colours follow, the
// panels, header and cards stay in the old scheme. Cold starts are fine, the copy is right then.
//
// GTK does this through `Adw.StyleManager:dark`; here `adwaitaColorScheme` is that property, and
// `syncColorSchemeClasses` is what makes the tree follow it. Pure and NS-core-free on purpose:
// it walks a structural view so a spec can drive it without a platform.

import type { AdwColorScheme } from '@gjsify/adwaita-core';

/** The slice of a NativeScript `View` the walk reads. */
export interface SchemeClassView {
    readonly cssClasses?: Set<string>;
    eachChild(callback: (child: SchemeClassView) => boolean): void;
    _onCssStateChange?(): void;
}

const SCHEME_CLASS: Record<AdwColorScheme, string> = { light: 'ns-light', dark: 'ns-dark' };

function swap(view: SchemeClassView, scheme: AdwColorScheme): void {
    const classes = view.cssClasses;
    if (classes === undefined) return;
    const stale = SCHEME_CLASS[scheme === 'dark' ? 'light' : 'dark'];
    // Only a view that already carries a system-class copy gets the new one: a `Label` that
    // never wrote a `className` has none, and must not gain a scheme class it never had.
    if (!classes.has(stale)) return;
    classes.delete(stale);
    classes.add(SCHEME_CLASS[scheme]);
}

/**
 * Point every view under `root` (and `root` itself) at `scheme`'s system class and re-match
 * its CSS once. Returns how many views were swapped.
 */
export function syncColorSchemeClasses(root: SchemeClassView, scheme: AdwColorScheme): number {
    let swapped = 0;
    const visit = (view: SchemeClassView): boolean => {
        const before = view.cssClasses?.has(SCHEME_CLASS[scheme]) === true;
        swap(view, scheme);
        if (!before && view.cssClasses?.has(SCHEME_CLASS[scheme]) === true) swapped++;
        view.eachChild(visit);
        return true;
    };
    visit(root);
    // `_onCssStateChange` re-matches the view AND its descendants.
    root._onCssStateChange?.();
    return swapped;
}
