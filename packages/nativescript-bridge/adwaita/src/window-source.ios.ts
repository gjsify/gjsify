// Window members on iOS. Unverified on a device; the calls are the documented ones.
//   close  — REFUSED: iOS has no public API for an app to close its own screen, and calling
//            `exit()` is both an App Store rejection and not a close.
//   focus  — the first responder: `isFirstResponder` / `becomeFirstResponder()` /
//            `resignFirstResponder()` on the view's native peer.

import type { View } from '@nativescript/core';

interface IosViewLike {
    isFirstResponder?: boolean;
    becomeFirstResponder?(): boolean;
    resignFirstResponder?(): boolean;
}

export const canFinishWindow = false;

export function finishWindow(): void {
    throw new Error('iOS has no public API for an app to close its own window');
}

const peer = (view: View): IosViewLike | undefined => view.nativeViewProtected as IosViewLike | undefined;

export function isViewFocused(view: View): boolean {
    return peer(view)?.isFirstResponder === true;
}

export function focusView(view: View): void {
    peer(view)?.becomeFirstResponder?.();
}

export function blurView(view: View): void {
    peer(view)?.resignFirstResponder?.();
}
