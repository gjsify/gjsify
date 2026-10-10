// `Adw.StyleManager` on NativeScript: `dark` is the scheme the app is in (`adwaitaColorScheme`, which
// follows the system until the app sets one). The behaviour is the core's (`style-manager.ts`); this
// file is the SOURCE: the scheme's own change listener.

import {
    StyleManagerBase,
    adwaitaColorScheme,
    onAdwaitaColorSchemeChanged,
    type StyleSource,
} from '@gjsify/adwaita-core';

export const nativeScriptStyleSource: StyleSource = {
    dark: () => adwaitaColorScheme() === 'dark',
    subscribe: onAdwaitaColorSchemeChanged,
};

export class AdwStyleManager extends StyleManagerBase {
    static readonly GTypeName: string = 'AdwStyleManager';

    static override source = nativeScriptStyleSource;
}
