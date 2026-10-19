// The platform half of `Adw.StyleManager` on NativeScript: hands `Application.systemAppearance()` and
// its `systemAppearanceChanged` event to the source in `style-manager.ts`, so the scheme follows the
// system and `system_supports_color_schemes` is true where the system reports a preference — the
// "follow system" choice an app offers only then. `namespace/adw.ts` exports the class from here so
// that reaching `Adw.StyleManager` is what wires it.

import { Application } from '@nativescript/core';
import type { AdwColorScheme } from '@gjsify/adwaita-core';

import { AdwStyleManager, setSystemAppearance } from './style-manager.js';

function asScheme(value: unknown): AdwColorScheme | null {
    return value === 'dark' || value === 'light' ? value : null;
}

setSystemAppearance({
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
        Application.on('systemAppearanceChanged', handler);
        return () => Application.off('systemAppearanceChanged', handler);
    },
});

export { AdwStyleManager };
