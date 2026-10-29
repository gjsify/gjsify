// Window members on Android. Unverified on a device; the calls are the documented ones.
//   close  — `Activity.finish()` of the foreground activity: what the system does for "close this
//            screen", and the closest thing an Android app has to destroying its window.
//   back   — NativeScript's own `activityBackPressed` event on `Application.android`. NS 9.1 routes
//            both the legacy `Activity.onBackPressed` (API < 33) and the AndroidX
//            `OnBackPressedCallback` it registers on the activity's dispatcher (API >= 33, where
//            predictive back needs the callback) into that one event, before it hands back to the
//            root view or a `Frame`; `cancel = true` stops the activity from finishing. Registering a
//            second dispatcher callback here would race NS's own for the gesture.
//   focus  — `View.isFocused()` / `requestFocus()` / `clearFocus()` on the view's native peer.

import { Application, type View } from '@nativescript/core';

import type { BackPressedEvent } from './window-source.js';

interface AndroidViewLike {
    isFocused?(): boolean;
    requestFocus?(): boolean;
    clearFocus?(): void;
}

// A function, not a constant: see `window-source.ts`.
export function canFinishWindow(): boolean {
    return true;
}

/** `AndroidApplication.activityBackPressedEvent`. */
const ACTIVITY_BACK_PRESSED = 'activityBackPressed';

export function watchBackButton(onBack: (event: BackPressedEvent) => void): () => void {
    const android = Application.android;
    if (!android) return () => {};
    android.on(ACTIVITY_BACK_PRESSED, onBack);
    return () => android.off(ACTIVITY_BACK_PRESSED, onBack);
}

export function finishWindow(): void {
    const activity = Application.android?.foregroundActivity ?? Application.android?.startActivity;
    if (!activity?.finish) throw new Error('Android has no activity to finish for this window');
    activity.finish();
}

const peer = (view: View): AndroidViewLike | undefined => view.nativeViewProtected as AndroidViewLike | undefined;

export function isViewFocused(view: View): boolean {
    return peer(view)?.isFocused?.() === true;
}

export function focusView(view: View): void {
    peer(view)?.requestFocus?.();
}

export function blurView(view: View): void {
    peer(view)?.clearFocus?.();
}
