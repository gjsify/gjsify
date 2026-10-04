// How an app deals with the system bars (status bar, navigation / gesture bar).
//
// WHY THIS IS A PURE MODULE. The Android half (`system-bars-source.android.ts`) can
// only be imported on a device, but every DECISION in it is arithmetic over a colour
// scheme and a few options, so the decisions live here and a Linux runner checks them.
//
// THE DEFAULT is "just work": edge-to-edge, the top and bottom bars are paid for with
// padding (see `window-insets.ts`), the icon colour follows the Adwaita colour scheme
// (dark scheme → light icons) and re-follows it when the scheme flips at runtime, and
// the window behind the bars wears the Adwaita window background.
//
// EVERY PART CAN BE OVERRIDDEN, globally with {@link configureSystemBars} or per
// toolbar view with `AdwToolbarView.systemInsets`:
//
//   configureSystemBars({
//       insets: { bottom: false },          // pay the status bar only
//       statusBarIcons: 'light',            // force light icons; 'dark', or 'auto' (default)
//       navigationBarIcons: 'auto',
//       background: 'transparent',          // 'window' (default) | 'transparent' | '#rrggbb'
//   });
//
// `insets: false` switches the padding off for both edges (the app then draws under the
// bars on purpose, e.g. a full-bleed image); `true` is the default.
//
// Only top and bottom are modelled: left and right insets are non-zero only in landscape
// with a cutout, and nothing in this tree pays them (see `window-insets.ts`).

import type { AdwColorScheme } from '@gjsify/adwaita-core';

import type { WindowInsets } from './window-insets.js';

/** The colour of a bar's icons: follow the colour scheme, or force one. */
export type BarIcons = 'auto' | 'light' | 'dark';

/** Which edges get padding for their system bar. */
export interface SystemBarEdges {
    readonly top: boolean;
    readonly bottom: boolean;
}

/** What the caller may pass. Every field is optional; the rest keeps the default. */
export interface SystemBarsOptions {
    /** `true` / `false` for both edges, or per edge. Default: both. */
    readonly insets?: boolean | Partial<SystemBarEdges>;
    /** Colour of the status bar's icons and clock. Default `'auto'`. */
    readonly statusBarIcons?: BarIcons;
    /** Colour of the navigation bar's icons / gesture pill. Default `'auto'`. */
    readonly navigationBarIcons?: BarIcons;
    /** What shows behind the bars: the Adwaita window colour, nothing, or a colour. */
    readonly background?: 'window' | 'transparent' | string;
}

/** {@link SystemBarsOptions} with every default filled in. */
export interface ResolvedSystemBars {
    readonly insets: SystemBarEdges;
    readonly statusBarIcons: BarIcons;
    readonly navigationBarIcons: BarIcons;
    readonly background: string;
}

/** The Adwaita window background per scheme (`.adw-window` in the theme). */
export const WINDOW_BACKGROUND: Record<AdwColorScheme, string> = {
    light: '#fafafb',
    dark: '#222226',
};

export const DEFAULT_SYSTEM_BARS: ResolvedSystemBars = {
    insets: { top: true, bottom: true },
    statusBarIcons: 'auto',
    navigationBarIcons: 'auto',
    background: 'window',
};

/** Fold a boolean or per-edge `insets` option into both edges. */
export function resolveEdges(
    insets: boolean | Partial<SystemBarEdges> | null | undefined,
    base: SystemBarEdges = DEFAULT_SYSTEM_BARS.insets,
): SystemBarEdges {
    if (typeof insets === 'boolean') return { top: insets, bottom: insets };
    if (!insets) return base;
    return { top: insets.top ?? base.top, bottom: insets.bottom ?? base.bottom };
}

/** Layer `options` over `base`; an absent field keeps the base value. */
export function resolveSystemBars(
    options: SystemBarsOptions | null | undefined,
    base: ResolvedSystemBars = DEFAULT_SYSTEM_BARS,
): ResolvedSystemBars {
    return {
        insets: resolveEdges(options?.insets, base.insets),
        statusBarIcons: options?.statusBarIcons ?? base.statusBarIcons,
        navigationBarIcons: options?.navigationBarIcons ?? base.navigationBarIcons,
        background: options?.background ?? base.background,
    };
}

/** Zero the edges whose padding is switched off. */
export function insetsForEdges(insets: WindowInsets, edges: SystemBarEdges): WindowInsets {
    return {
        top: edges.top ? insets.top : 0,
        bottom: edges.bottom ? insets.bottom : 0,
        left: insets.left,
        right: insets.right,
    };
}

/**
 * The value for `setAppearanceLightStatusBars` / `setAppearanceLightNavigationBars`.
 *
 * The flag is named for the BAR, not the icons: "light bars" means a light background,
 * which needs DARK icons. So the light scheme sets it and the dark scheme clears it —
 * the inversion that is easy to get backwards, hence a tested function.
 */
export function lightBarFlag(icons: BarIcons, scheme: AdwColorScheme): boolean {
    if (icons === 'light') return false;
    if (icons === 'dark') return true;
    return scheme === 'light';
}

/** The colour behind the bars, or `null` for fully transparent. */
export function barBackgroundColor(background: string, scheme: AdwColorScheme): string | null {
    if (background === 'transparent') return null;
    if (background === 'window') return WINDOW_BACKGROUND[scheme];
    return background;
}

/** What the native side must apply for `bars` under `scheme`. */
export interface SystemBarsAppearance {
    readonly lightStatusBars: boolean;
    readonly lightNavigationBars: boolean;
    readonly background: string | null;
}

export function systemBarsAppearance(bars: ResolvedSystemBars, scheme: AdwColorScheme): SystemBarsAppearance {
    return {
        lightStatusBars: lightBarFlag(bars.statusBarIcons, scheme),
        lightNavigationBars: lightBarFlag(bars.navigationBarIcons, scheme),
        background: barBackgroundColor(bars.background, scheme),
    };
}

/** Notified when the global options change. */
export type SystemBarsListener = (bars: ResolvedSystemBars) => void;

/** The global options and who listens to them. Exported for tests; apps use `configureSystemBars`. */
export class SystemBarsConfig {
    private _bars: ResolvedSystemBars = DEFAULT_SYSTEM_BARS;
    private readonly _listeners = new Set<SystemBarsListener>();

    get bars(): ResolvedSystemBars {
        return this._bars;
    }

    /** Layer `options` over the CURRENT options (not over the defaults). */
    configure(options: SystemBarsOptions): void {
        this._bars = resolveSystemBars(options, this._bars);
        for (const listener of [...this._listeners]) listener(this._bars);
    }

    /** Back to the defaults. */
    reset(): void {
        this._bars = DEFAULT_SYSTEM_BARS;
        for (const listener of [...this._listeners]) listener(this._bars);
    }

    subscribe(listener: SystemBarsListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }
}

export const systemBarsConfig = new SystemBarsConfig();

/** Change how the app treats the system bars. Options not given keep their current value. */
export function configureSystemBars(options: SystemBarsOptions): void {
    systemBarsConfig.configure(options);
}

/** `className` with the theme's window class added once, so the page paints the Adwaita window colour. */
export function withPageClass(className: string | null | undefined): string {
    const classes = (className ?? '').split(/\s+/).filter(Boolean);
    if (!classes.includes('adw-window')) classes.push('adw-window');
    return classes.join(' ');
}
