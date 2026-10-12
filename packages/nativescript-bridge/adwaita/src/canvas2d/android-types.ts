// The slice of the Android SDK `native-canvas.android.ts` calls, typed structurally.
//
// `android.*` is a global the NativeScript V8 runtime injects; `@nativescript/types-android`
// would describe all of it but is not installed here. Naming the used members also gives one
// list to keep in step with `native-api-usage.json` (R8 strips what that file does not name).

export interface AndroidPaint {
    setColor(color: number): void;
    setAntiAlias(enabled: boolean): void;
    setFilterBitmap(enabled: boolean): void;
    setStyle(style: unknown): void;
    setStrokeWidth(width: number): void;
    setXfermode(mode: unknown): unknown;
}

export interface AndroidPath {
    reset(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    addRect(left: number, top: number, right: number, bottom: number, direction: unknown): void;
    close(): void;
}

export interface AndroidCanvas {
    scale(sx: number, sy: number): void;
    drawRect(left: number, top: number, right: number, bottom: number, paint: AndroidPaint): void;
    drawPath(path: AndroidPath, paint: AndroidPaint): void;
}

export interface AndroidBitmap {
    setDensity(density: number): void;
    recycle(): void;
}

export interface AndroidDrawable {
    setFilterBitmap(enabled: boolean): void;
}

export interface AndroidImageView {
    setScaleType(type: unknown): void;
    setImageDrawable(drawable: AndroidDrawable | null): void;
    invalidate(): void;
    getWidth(): number;
    getHeight(): number;
    getContext(): { getResources(): { getDisplayMetrics(): { density: number } } };
    addOnLayoutChangeListener(listener: unknown): void;
    removeOnLayoutChangeListener(listener: unknown): void;
}

export interface AndroidNamespace {
    graphics: {
        Bitmap: {
            createBitmap(width: number, height: number, config: unknown): AndroidBitmap;
            Config: { ARGB_8888: unknown };
        };
        Canvas: new (bitmap: AndroidBitmap) => AndroidCanvas;
        Paint: (new () => AndroidPaint) & { Style: { FILL: unknown; STROKE: unknown } };
        Path: (new () => AndroidPath) & { Direction: { CW: unknown } };
        PorterDuff: { Mode: { CLEAR: unknown } };
        PorterDuffXfermode: new (mode: unknown) => unknown;
        drawable: {
            BitmapDrawable: new (resources: unknown, bitmap: AndroidBitmap) => AndroidDrawable;
        };
    };
    widget: {
        ImageView: (new (context: unknown) => AndroidImageView) & { ScaleType: { MATRIX: unknown } };
    };
    view: {
        View: {
            OnLayoutChangeListener: new (implementation: {
                onLayoutChange(
                    view: unknown,
                    left: number,
                    top: number,
                    right: number,
                    bottom: number,
                    oldLeft: number,
                    oldTop: number,
                    oldRight: number,
                    oldBottom: number,
                ): void;
            }) => unknown;
        };
    };
}
