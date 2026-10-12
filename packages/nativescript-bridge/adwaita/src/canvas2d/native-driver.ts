// The seam between the bridge view and the platform that draws: what a driver is, and the one that
// refuses. `native-canvas.android.ts` is the real driver; every other target gets the refusal.

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

export function createUnsupportedCanvasDriver(): NativeCanvasDriver {
    return new UnsupportedNativeCanvas();
}
