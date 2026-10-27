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
    type AdwAccentColorName,
    type AdwColorScheme,
    type StyleSource,
} from '@gjsify/adwaita-core';

/** The system's light/dark preference as a platform reports it. */
export interface SystemAppearance {
    /** The current preference, `null` while the platform cannot tell. */
    current(): AdwColorScheme | null;
    /** Calls `changed` with each new preference; returns the unsubscribe. */
    subscribe(changed: (scheme: AdwColorScheme | null) => void): () => void;
    /** Whether the system asks for more contrast; absent means it cannot. */
    highContrast?(): boolean;
    /** The system accent snapped to one of the nine; `null` or absent when it has none. */
    accentColor?(): AdwAccentColorName | null;
}

let system: SystemAppearance | null = null;
let unfollow: (() => void) | null = null;
// Whether a style manager listens yet. The system is attached only then, never on import: a bundle
// that merely names `Adw` (a stub host, a tree that never asks for the manager) must not reach the
// platform's event bus.
let inUse = false;
let forced = false;
// DEFAULT hands the scheme back to the system; without one, to what it was before the first force.
let beforeForce: AdwColorScheme | null = null;

// Contrast and accent are not part of the scheme, so a system change of either reaches the manager
// through these listeners; the host reports it as `changed(null)`.
const appearanceListeners = new Set<() => void>();

function follow(scheme: AdwColorScheme | null): void {
    if (!forced && scheme !== null) setAdwaitaColorScheme(scheme);
    for (const listener of Array.from(appearanceListeners)) listener();
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
    if (inUse) attach();
}

function attach(): void {
    if (system === null || unfollow !== null) return;
    unfollow = system.subscribe(follow);
    follow(system.current());
}

export const nativeScriptStyleSource: StyleSource = {
    dark: () => adwaitaColorScheme() === 'dark',
    subscribe(changed) {
        // Listen first, so a scheme the system changes on attach still reaches the manager.
        const off = onAdwaitaColorSchemeChanged(changed);
        appearanceListeners.add(changed);
        inUse = true;
        attach();
        return () => {
            off();
            appearanceListeners.delete(changed);
        };
    },
    highContrast: () => system?.highContrast?.() ?? false,
    accentColor: () => system?.accentColor?.() ?? null,
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
    supportsColorSchemes() {
        attach();
        return (system?.current() ?? null) !== null;
    },
};

export class AdwStyleManager extends StyleManagerBase {
    static readonly GTypeName: string = 'AdwStyleManager';
    static readonly ColorScheme = ColorScheme;

    static override source = nativeScriptStyleSource;
}
