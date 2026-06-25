// @gjsify/devtools-nativescript — Android view → base64 PNG capture.
//
// Rasterises a NativeScript view through its backing `android.view.View` into
// an ARGB bitmap, then PNG-encodes + base64-encodes it — fully in-process, no
// `adb screencap` and no MediaProjection permission. Resolved in place of the
// base `screenshot.ts` by the gjsify NS build's `platformResolvePlugin` on the
// Android target.
//
// `android.*` / `java.*` are ambient globals the NativeScript V8 runtime
// injects at load time (like GJS's `imports.gi.*`); they are declared
// structurally here — only the members the capture calls — so the module
// type-checks under `gjsify tsc` (which loads only `@types/node`) without a
// hard `@nativescript/types` dependency. android.graphics usage mirrors
// easy6502 `app-android/.../game-console/display.ts`.
//
// Original implementation.

import type { NsView } from './view-tree.js';

// ===== Ambient NativeScript / Android globals (typed, no `any`) =====

interface AndroidBitmap {
    getWidth(): number;
    getHeight(): number;
    compress(format: unknown, quality: number, stream: JavaByteArrayOutputStream): boolean;
    recycle(): void;
}

interface AndroidCanvas {
    drawColor(color: number): void;
}

interface AndroidNativeView {
    getMeasuredWidth(): number;
    getMeasuredHeight(): number;
    getWidth(): number;
    getHeight(): number;
    draw(canvas: AndroidCanvas): void;
}

/** A native Android Activity window (reached for a full-window decor-view capture). */
interface AndroidActivityLike {
    getWindow?(): { getDecorView?(): AndroidNativeView } | null;
}

/**
 * NativeScript `Frame.android` is NOT a native view — it is an `AndroidFrame`
 * helper exposing the real content `rootViewGroup` + the host `activity`. So a
 * Frame must be captured via its decor view / root view group, not `.android`.
 */
interface AndroidFrameLike {
    rootViewGroup?: AndroidNativeView;
    activity?: AndroidActivityLike;
    currentActivity?: AndroidActivityLike;
}

interface JavaByteArrayOutputStream {
    toByteArray(): number[];
    close(): void;
}

declare const android:
    | {
          graphics: {
              Bitmap: {
                  createBitmap(width: number, height: number, config: unknown): AndroidBitmap;
                  Config: { ARGB_8888: unknown };
                  CompressFormat: { PNG: unknown };
              };
              Canvas: { new (bitmap: AndroidBitmap): AndroidCanvas };
              Color: { TRANSPARENT: number };
          };
          util: {
              Base64: {
                  encodeToString(input: number[], flags: number): string;
                  NO_WRAP: number;
              };
          };
      }
    | undefined;

declare const java:
    | {
          io: { ByteArrayOutputStream: { new (): JavaByteArrayOutputStream } };
      }
    | undefined;

/**
 * Most NS views expose their backing `android.view.View` as `view.android` (and
 * `view.nativeViewProtected`); a `Frame` exposes an `AndroidFrame` helper there
 * instead (see {@link AndroidFrameLike}).
 */
interface NsAndroidView extends NsView {
    android?: AndroidNativeView | AndroidFrameLike;
    nativeViewProtected?: AndroidNativeView;
}

/** A value is a drawable native view if it can be measured AND rasterised. */
function isDrawable(v: unknown): v is AndroidNativeView {
    return (
        !!v &&
        typeof (v as AndroidNativeView).getMeasuredWidth === 'function' &&
        typeof (v as AndroidNativeView).draw === 'function'
    );
}

/**
 * Resolve a real, drawable `android.view.View` for a NativeScript view. Tries
 * the view's own native view first; for a `Frame` (whose `.android` is an
 * `AndroidFrame` helper, not a view) it falls back to the host activity's decor
 * view (a full-window capture incl. the ActionBar), then the Frame's content
 * `rootViewGroup`. Returns `null` when nothing drawable is available yet.
 */
function resolveNativeView(view: NsView): AndroidNativeView | null {
    const v = view as NsAndroidView;
    const frame = v.android as AndroidFrameLike | undefined;
    const decor =
        frame?.activity?.getWindow?.()?.getDecorView?.() ?? frame?.currentActivity?.getWindow?.()?.getDecorView?.();
    const candidates: unknown[] = [v.nativeViewProtected, v.android, decor, frame?.rootViewGroup];
    for (const c of candidates) {
        if (isDrawable(c)) return c;
    }
    return null;
}

/**
 * Capture a NativeScript view to a base64-encoded PNG string (no data-uri
 * prefix). Returns `null` when the view has no backing native view yet or
 * measures zero (not laid out), so the caller can surface a clear "not ready"
 * error rather than a blank image.
 */
export function captureViewPng(view: NsView): string | null {
    const native = resolveNativeView(view);
    if (!native) return null;

    // Prefer measured dimensions; fall back to the laid-out size.
    const width = native.getMeasuredWidth() || native.getWidth() || view.getMeasuredWidth?.() || 0;
    const height = native.getMeasuredHeight() || native.getHeight() || view.getMeasuredHeight?.() || 0;
    if (width <= 0 || height <= 0) return null;

    const gfx = (android as NonNullable<typeof android>).graphics;
    const bitmap = gfx.Bitmap.createBitmap(width, height, gfx.Bitmap.Config.ARGB_8888);
    const canvas = new gfx.Canvas(bitmap);
    canvas.drawColor(gfx.Color.TRANSPARENT);

    // Render the view hierarchy into the off-screen canvas.
    native.draw(canvas);

    const baos = new (java as NonNullable<typeof java>).io.ByteArrayOutputStream();
    try {
        bitmap.compress(gfx.Bitmap.CompressFormat.PNG, 100, baos);
        const bytes = baos.toByteArray();
        const util = (android as NonNullable<typeof android>).util;
        return util.Base64.encodeToString(bytes, util.Base64.NO_WRAP);
    } finally {
        baos.close();
        bitmap.recycle();
    }
}
