// Window members on Android. Unverified on a device; the calls are the documented ones.
//   close  — `Activity.finish()` of the foreground activity: what the system does for "close this
//            screen", and the closest thing an Android app has to destroying its window.
//   focus  — `View.isFocused()` / `requestFocus()` / `clearFocus()` on the view's native peer.

import { Application, type View } from '@nativescript/core';

interface AndroidViewLike {
    isFocused?(): boolean;
    requestFocus?(): boolean;
    clearFocus?(): void;
}

export const canFinishWindow = true;

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
