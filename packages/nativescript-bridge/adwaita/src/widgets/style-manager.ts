// `Adw.StyleManager` on NativeScript: `dark` is the scheme the app is in (`adwaitaColorScheme`, which
// follows the system until the app sets one). The behaviour is the core's (`style-manager.ts`); this
// file is the SOURCE: the scheme's own change listener.

import {
    ColorScheme,
    StyleManagerBase,
    adwaitaColorScheme,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    type AdwColorScheme,
    type StyleSource,
} from '@gjsify/adwaita-core';

// DEFAULT hands the scheme back to what it was before the first force: the app seeded it from the
// system (`Application.systemAppearance()`), and this source has no second way to ask.
let beforeForce: AdwColorScheme | null = null;

export const nativeScriptStyleSource: StyleSource = {
    dark: () => adwaitaColorScheme() === 'dark',
    subscribe: onAdwaitaColorSchemeChanged,
    force(dark) {
        if (dark === null) {
            if (beforeForce !== null) setAdwaitaColorScheme(beforeForce);
            beforeForce = null;
            return;
        }
        beforeForce ??= adwaitaColorScheme();
        setAdwaitaColorScheme(dark ? 'dark' : 'light');
    },
};

export class AdwStyleManager extends StyleManagerBase {
    static readonly GTypeName: string = 'AdwStyleManager';
    static readonly ColorScheme = ColorScheme;

    static override source = nativeScriptStyleSource;
}
