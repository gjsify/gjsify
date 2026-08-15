// Window insets on iOS — the safe area, read off the key window.
//
// UNVERIFIED ON DEVICE. There is no iOS runner and no Mac in this project's CI (the
// same wall the iOS symbolic-icon backend sits behind, #1051), so this file is
// written from the documented API and has never been run. It exists because the
// conformance rule demands both platform variants of any `.android.ts` — and that
// rule exists BECAUSE `icons.android.ts` once shipped without an iOS twin and iOS
// silently rendered no icons at all. A guessed-but-declared implementation that is
// marked as such beats a silent zero.
//
// iOS needs no equivalent of `setDecorFitsSystemWindows`: a UIWindow always reports
// `safeAreaInsets`, and they are already in points, which is what NS `padding`
// speaks — so there is no density conversion here, unlike the Android side.
//
// The reading is taken on every layout pass rather than through an observer:
// `safeAreaInsetsDidChange` is a UIView override, and overriding it needs a
// subclass this package has no place creating.

import { Application } from '@nativescript/core';

import { type WindowInsetsListener, WindowInsetsBroadcast } from './window-insets.js';

/** The slice of UIKit this file reads, structurally typed and possibly absent. */
interface IosWindowLike {
    safeAreaInsets?: { top: number; bottom: number; left: number; right: number };
}

const broadcast = new WindowInsetsBroadcast();

/** Read the key window's safe area, or nothing if UIKit is not answering. */
function read(): void {
    const window = (Application.ios as { window?: IosWindowLike } | undefined)?.window;
    const insets = window?.safeAreaInsets;
    if (insets) broadcast.publish(insets);
}

/**
 * The application events that change a safe area without a view controller being
 * involved. `orientationChanged` is the one that matters in practice — landscape puts
 * a cutout on the leading edge and shrinks the bottom bar — and `resume` covers the
 * case where the change happened while the app was away (a call status bar, or a
 * rotation in the app switcher).
 */
const REREAD_ON = ['orientationChanged', 'resume'] as const;

/** Subscribe to safe-area changes. Returns the unsubscribe. */
export function observeWindowInsets(listener: WindowInsetsListener): () => void {
    read();
    const detach = broadcast.subscribe(listener);
    const reread = () => read();
    for (const event of REREAD_ON) Application.on?.(event, reread);
    return () => {
        for (const event of REREAD_ON) Application.off?.(event, reread);
        detach();
    };
}
