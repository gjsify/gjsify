// What a window's state members read and do on the platform: whether the application is in the
// foreground, which view holds focus, how a window ends. The platform's own calls are
// `./window-source.ts` and its `.android` / `.ios` variants; this file adds the one part every
// platform shares — NativeScript's `resume` / `suspend` application events — and the seam the
// specs replace.

import { Application, type View } from '@nativescript/core';

import { blurView, canFinishWindow, finishWindow, focusView, isViewFocused } from './window-source.js';

export interface WindowHost {
    /** Whether {@link finish} can end the window; asked BEFORE a `close-request` is emitted. */
    readonly canFinish: boolean;
    /** Whether the application is in the foreground right now. */
    isForeground(): boolean;
    /** Call `onChange` whenever the application enters or leaves the foreground; returns the unsubscribe. */
    watchForeground(onChange: (foreground: boolean) => void): () => void;
    /** End the window. Throws where the platform has no way to. */
    finish(): void;
    isFocused(view: View): boolean;
    requestFocus(view: View): void;
    clearFocus(view: View): void;
}

let replacement: WindowHost | null = null;

/** @internal A seam for the specs: `null` restores the platform's own. */
export function useWindowHost(host: WindowHost | null): void {
    replacement = host;
}

// `resume` / `suspend` fire on both platforms when the application comes to the foreground and
// leaves it (Android `onResume`/`onPause` of the activity, iOS `didBecomeActive`/`willResignActive`).
// The application is in the foreground whenever a window is on screen to ask.
export const nativeWindowHost: WindowHost = {
    canFinish: canFinishWindow,
    isForeground: () => true,
    watchForeground(onChange) {
        const resume = (): void => onChange(true);
        const suspend = (): void => onChange(false);
        Application.on('resume', resume);
        Application.on('suspend', suspend);
        return () => {
            Application.off('resume', resume);
            Application.off('suspend', suspend);
        };
    },
    finish: finishWindow,
    isFocused: isViewFocused,
    requestFocus: focusView,
    clearFocus: blurView,
};

export function windowHost(): WindowHost {
    return replacement ?? nativeWindowHost;
}
