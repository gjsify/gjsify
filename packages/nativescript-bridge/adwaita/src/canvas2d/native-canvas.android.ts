// The Android half of `Canvas2DBridge`: an `ImageView` showing a `Bitmap` that an
// `android.graphics.Canvas` draws into.
//
// PHYSICAL PIXELS, LOGICAL COORDINATES. The bitmap is `width * density` by `height * density`
// and the canvas is pre-scaled by `density`, so the app draws in the logical pixels `canvas.width`
// reports while a 32x32 grid still lands on whole device pixels. The `ImageView` shows the bitmap
// 1:1 at the top-left (`ScaleType.MATRIX`, identity), the GJS widget's unscaled blit at (0, 0),
// and its drawable has `setFilterBitmap(false)`, so any scaling the platform adds is
// nearest-neighbour. `imageSmoothingEnabled` drives the same flag on the paints.
//
// RECTANGLES ARE NOT ANTI-ALIASED. An axis-aligned fill at a fractional density would otherwise
// blend its edges and leave seams between the cells of a grid; paths keep anti-aliasing.
//
// Not device-verified: written against the Android API and run off-device through the fake the
// specs use (`canvas-subset.spec.ts`); see the package README.

import type { AndroidBitmap, AndroidCanvas, AndroidImageView, AndroidNamespace, AndroidPaint, AndroidPath } from './android-types.js';
import type { NativeCanvasDriver } from './native-canvas.js';

declare const android: AndroidNamespace;

class AndroidNativeCanvas implements NativeCanvasDriver {
    private view: AndroidImageView | null = null;
    private bitmap: AndroidBitmap | null = null;
    private canvas: AndroidCanvas | null = null;
    private listener: unknown = null;
    private density = 1;
    private logicalWidth = 0;
    private logicalHeight = 0;
    private smoothing = true;
    private readonly path: AndroidPath;
    private readonly rectPaint: AndroidPaint;
    private readonly pathPaint: AndroidPaint;
    private readonly clearPaint: AndroidPaint;

    constructor() {
        const { Paint, Path, PorterDuff, PorterDuffXfermode } = android.graphics;
        this.path = new Path();
        this.rectPaint = new Paint();
        this.rectPaint.setAntiAlias(false);
        this.pathPaint = new Paint();
        this.pathPaint.setAntiAlias(true);
        this.clearPaint = new Paint();
        this.clearPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
        this.applySmoothing();
    }

    createNativeView(context: unknown): object {
        const view = new android.widget.ImageView(context);
        view.setScaleType(android.widget.ImageView.ScaleType.MATRIX);
        this.view = view;
        return view;
    }

    attach(nativeView: unknown, allocated: (width: number, height: number) => void): void {
        const view = nativeView as AndroidImageView;
        this.view = view;
        this.density = view.getContext().getResources().getDisplayMetrics().density || 1;
        this.allocate();
        let width = -1;
        let height = -1;
        this.listener = new android.view.View.OnLayoutChangeListener({
            onLayoutChange: (_view, left, top, right, bottom) => {
                const w = Math.round((right - left) / this.density);
                const h = Math.round((bottom - top) / this.density);
                if (w === width && h === height) return;
                width = w;
                height = h;
                allocated(w, h);
            },
        });
        view.addOnLayoutChangeListener(this.listener);
    }

    detach(): void {
        if (this.view !== null && this.listener !== null) this.view.removeOnLayoutChangeListener(this.listener);
        this.listener = null;
        this.bitmap?.recycle();
        this.bitmap = null;
        this.canvas = null;
        this.view = null;
    }

    resize(width: number, height: number): void {
        this.logicalWidth = width;
        this.logicalHeight = height;
        this.allocate();
    }

    private allocate(): void {
        if (this.view === null) return;
        this.bitmap?.recycle();
        const pixelWidth = Math.max(1, Math.round(this.logicalWidth * this.density));
        const pixelHeight = Math.max(1, Math.round(this.logicalHeight * this.density));
        const { Bitmap, Canvas, drawable } = android.graphics;
        const bitmap = Bitmap.createBitmap(pixelWidth, pixelHeight, Bitmap.Config.ARGB_8888);
        // DENSITY_NONE: the drawable must not rescale the bitmap by the screen density again.
        bitmap.setDensity(0);
        this.bitmap = bitmap;
        this.canvas = new Canvas(bitmap);
        this.canvas.scale(this.density, this.density);
        const bitmapDrawable = new drawable.BitmapDrawable(null, bitmap);
        bitmapDrawable.setFilterBitmap(false);
        this.view.setImageDrawable(bitmapDrawable);
    }

    private applySmoothing(): void {
        for (const paint of [this.rectPaint, this.pathPaint]) paint.setFilterBitmap(this.smoothing);
    }

    fillRect(x: number, y: number, width: number, height: number, argb: number): void {
        const { Paint } = android.graphics;
        this.rectPaint.setStyle(Paint.Style.FILL);
        this.rectPaint.setColor(argb);
        this.canvas?.drawRect(x, y, x + width, y + height, this.rectPaint);
    }

    clearRect(x: number, y: number, width: number, height: number): void {
        this.canvas?.drawRect(x, y, x + width, y + height, this.clearPaint);
    }

    resetPath(): void {
        this.path.reset();
    }

    moveTo(x: number, y: number): void {
        this.path.moveTo(x, y);
    }

    lineTo(x: number, y: number): void {
        this.path.lineTo(x, y);
    }

    rect(x: number, y: number, width: number, height: number): void {
        this.path.addRect(x, y, x + width, y + height, android.graphics.Path.Direction.CW);
    }

    closePath(): void {
        this.path.close();
    }

    fillPath(argb: number): void {
        this.pathPaint.setStyle(android.graphics.Paint.Style.FILL);
        this.pathPaint.setColor(argb);
        this.canvas?.drawPath(this.path, this.pathPaint);
    }

    strokePath(argb: number, lineWidth: number): void {
        this.pathPaint.setStyle(android.graphics.Paint.Style.STROKE);
        this.pathPaint.setStrokeWidth(lineWidth);
        this.pathPaint.setColor(argb);
        this.canvas?.drawPath(this.path, this.pathPaint);
    }

    setImageSmoothing(enabled: boolean): void {
        this.smoothing = enabled;
        this.applySmoothing();
    }

    invalidate(): void {
        this.view?.invalidate();
    }
}

export function createNativeCanvasDriver(): NativeCanvasDriver {
    return new AndroidNativeCanvas();
}
