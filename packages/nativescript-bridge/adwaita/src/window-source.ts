// The platform half of a window's state members — the base, for a host with none (the unit tests,
// a bundle for neither): every call is refused, loudly and by name. The platform variants sit
// beside this file (`.android.ts`, `.ios.ts`); the host that wraps them is `window-host.ts`.

import type { View } from '@nativescript/core';

/**
 * Whether {@link finishWindow} can end the window on this platform. A FUNCTION, not a constant: the
 * library build (`--library`, one module per file) folds an imported `const` into its importer, so
 * `window-host.js` would carry this base file's `false` whatever platform variant the app's bundle
 * resolves in its place.
 */
export function canFinishWindow(): boolean {
    return false;
}

export function finishWindow(): void {
    throw new Error('there is no platform window to close on this host');
}

export function isViewFocused(_view: View): boolean {
    throw new Error('there is no platform focus to read on this host');
}

export function focusView(_view: View): void {
    throw new Error('there is no platform focus to move on this host');
}

export function blurView(_view: View): void {
    throw new Error('there is no platform focus to clear on this host');
}

/** Back-button event data NativeScript hands its listeners: `cancel` stops the system's own back. */
export interface BackPressedEvent {
    cancel: boolean;
}

/** This host has no back button to hear; nothing to unsubscribe. */
export function watchBackButton(_onBack: (event: BackPressedEvent) => void): () => void {
    return () => {};
}
