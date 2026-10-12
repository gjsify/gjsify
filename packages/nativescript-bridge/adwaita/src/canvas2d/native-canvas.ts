// The native surface behind `Canvas2DBridge`, off Android.
//
// `native-canvas.android.ts` replaces this file on Android (`platformResolvePlugin` resolves the
// platform file first). Everywhere else — iOS, GJS, Node, the specs — there is no surface, and
// creating one says so with the message `assertNativeScript()` uses.

import type { Canvas2DBackend } from './canvas-subset.js';

export interface NativeCanvasDriver extends Canvas2DBackend {
    /** Called from `createNativeView()` with the Android `Context`. */
    createNativeView(context: unknown): object;
    /**
     * The view `createNativeView()` returned is live. `allocated` receives its size in LOGICAL
     * pixels, once per layout that changes it.
     */
    attach(nativeView: unknown, allocated: (width: number, height: number) => void): void;
    detach(): void;
}

class UnsupportedNativeCanvas implements NativeCanvasDriver {
    createNativeView(): never {
        throw new Error('Platform not supported: Canvas2DBridge is implemented for Android only');
    }
    attach(): void {}
    detach(): void {}
    resize(): void {}
    fillRect(): void {}
    clearRect(): void {}
    resetPath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    rect(): void {}
    closePath(): void {}
    fillPath(): void {}
    strokePath(): void {}
    setImageSmoothing(): void {}
    invalidate(): void {}
}

export function createNativeCanvasDriver(): NativeCanvasDriver {
    return new UnsupportedNativeCanvas();
}
