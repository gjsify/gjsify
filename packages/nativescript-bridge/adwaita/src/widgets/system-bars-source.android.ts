// System-bar appearance on Android: icon colour and the window colour behind the bars.
//
// `WindowInsetsControllerCompat.setAppearanceLightStatusBars(true)` means DARK icons
// (the bar is light), which `lightBarFlag` in `system-bars.ts` gets right. The colour
// behind the bars is the decor view's background: from API 35 the framework no longer
// paints `statusBarColor` / `navigationBarColor`, so whatever shows through is the window.
// Re-applied on every colour-scheme flip and every `configureSystemBars` call.

import { Application } from '@nativescript/core';
import { adwaitaColorScheme, onAdwaitaColorSchemeChanged } from '@gjsify/adwaita-core';

import { type ResolvedSystemBars, systemBarsAppearance, systemBarsConfig } from './system-bars.js';

declare const android: any;
declare const androidx: any;

function apply(bars: ResolvedSystemBars): void {
    const activity = Application.android?.foregroundActivity ?? Application.android?.startActivity;
    const window = activity?.getWindow?.() as any;
    const decor = window?.getDecorView?.() as any;
    const compat = androidx?.core?.view;
    if (!window || !decor || !compat) return;

    const look = systemBarsAppearance(bars, adwaitaColorScheme());
    const controller = compat.WindowCompat.getInsetsController(window, decor);
    controller?.setAppearanceLightStatusBars(look.lightStatusBars);
    controller?.setAppearanceLightNavigationBars(look.lightNavigationBars);
    // The window drawable, not only the decor view: it is what shows under a transparent bar.
    // Contrast enforcement would otherwise lay a white scrim over the gesture area (API 29+).
    const color = look.background === null ? 0 : android.graphics.Color.parseColor(look.background);
    window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(color));
    decor.setBackgroundColor(color);
    if (android.os.Build.VERSION.SDK_INT >= 29) window.setNavigationBarContrastEnforced(false);
}

let users = 0;
let stop: Array<() => void> = [];

/** Apply now and again on every change. Reference-counted: one subscription for many views. */
export function observeSystemBars(): () => void {
    if (users++ === 0) {
        apply(systemBarsConfig.bars);
        stop = [onAdwaitaColorSchemeChanged(() => apply(systemBarsConfig.bars)), systemBarsConfig.subscribe(apply)];
    }
    return () => {
        if (--users === 0) {
            for (const s of stop) s();
            stop = [];
        }
    };
}
