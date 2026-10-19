// `Adw.StyleManager` on NativeScript: `dark` is the scheme the app is in (`adwaitaColorScheme`). The
// behaviour is the core's (`style-manager.ts`); this file is the SOURCE: the scheme's own change
// listener, and — once a host hands one in — the system's appearance, which the scheme follows while
// nothing is forced (`ADW_COLOR_SCHEME_DEFAULT` in libadwaita follows the settings portal the same way).
//
// The system is INJECTED (`setSystemAppearance`) rather than read from `@nativescript/core` here, so
// this file stays platform-free and its spec runs under plain Node; `style-manager-host.ts` is the
// one place that reads `Application`.

import {
    ColorScheme,
    StyleManagerBase,
    adwaitaColorScheme,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    type AdwColorScheme,
    type StyleSource,
} from '@gjsify/adwaita-core';

/** The system's light/dark preference as a platform reports it. */
export interface SystemAppearance {
    /** The current preference, `null` while the platform cannot tell. */
    current(): AdwColorScheme | null;
    /** Calls `changed` with each new preference; returns the unsubscribe. */
    subscribe(changed: (scheme: AdwColorScheme) => void): () => void;
}

let system: SystemAppearance | null = null;
let unfollow: (() => void) | null = null;
let forced = false;
// DEFAULT hands the scheme back to the system; without one, to what it was before the first force.
let beforeForce: AdwColorScheme | null = null;

function follow(scheme: AdwColorScheme | null): void {
    if (!forced && scheme !== null) setAdwaitaColorScheme(scheme);
}

/**
 * Hand the source the system's appearance (or take it away with `null`). From then on the scheme
 * follows the system while no `FORCE_*` scheme pins it, and `system_supports_color_schemes` answers
 * whether the system reports a preference.
 */
export function setSystemAppearance(next: SystemAppearance | null): void {
    unfollow?.();
    unfollow = null;
    system = next;
    if (next === null) return;
    unfollow = next.subscribe(follow);
    follow(next.current());
}

export const nativeScriptStyleSource: StyleSource = {
    dark: () => adwaitaColorScheme() === 'dark',
    subscribe: onAdwaitaColorSchemeChanged,
    force(dark) {
        if (dark === null) {
            if (!forced) return;
            forced = false;
            const back = system?.current() ?? beforeForce;
            beforeForce = null;
            if (back !== null) setAdwaitaColorScheme(back);
            return;
        }
        if (!forced) beforeForce = adwaitaColorScheme();
        forced = true;
        setAdwaitaColorScheme(dark ? 'dark' : 'light');
    },
    supportsColorSchemes: () => (system?.current() ?? null) !== null,
};

export class AdwStyleManager extends StyleManagerBase {
    static readonly GTypeName: string = 'AdwStyleManager';
    static readonly ColorScheme = ColorScheme;

    static override source = nativeScriptStyleSource;
}
