// The iOS half of `Canvas2DBridge`: a `UIImageView` showing a bitmap that a CoreGraphics
// `CGContext` draws into — the UIKit analogue of `native-canvas.android.ts`'s
// `Bitmap`+`Canvas`+`ImageView`.
//
// PHYSICAL PIXELS, LOGICAL COORDINATES, same split as Android: the context is allocated at
// `width * scale` by `height * scale` device pixels (`UIScreen.mainScreen.scale`) and scaled by
// `scale` up front (`CGContextScaleCTM`), so the app draws in the logical points `canvas.width`
// reports. `UIImage`'s own `scale` parameter is what makes the `UIImageView` show it 1:1 at that
// logical size — no manual matrix, unlike Android's `ScaleType.MATRIX`.
//
// RECTANGLES ARE NOT ANTI-ALIASED, same reason as Android: an axis-aligned fill at a fractional
// scale would otherwise blend its edges and leave seams between the cells of a grid; paths keep
// anti-aliasing. `CGContextSetShouldAntialias` toggles it per draw call — there is no separate
// paint object to hold it on, as Android's two `Paint`s do.
//
// A PATH IS RECORDED, NOT BUILT DIRECTLY ON THE CONTEXT. `CGContextFillPath`/`CGContextStrokePath`
// CONSUME the context's current path, where `android.graphics.Path` is a value the Android driver
// draws from repeatedly. Recording the `moveTo`/`lineTo`/`rect`/`closePath` calls and replaying
// them onto the context before each fill/stroke keeps the two platforms' semantics the same: a
// path filled and then stroked without being rebuilt draws twice, not once.
//
// Not device-verified: written against CoreGraphics/UIKit and run off-device through the fake the
// specs use (`canvas2d-bridge.spec.ts`); see the package README.

import type { CGContextRef, CGImageRef, CGRect, ObjCClass, UIImageClass, UIImageViewNative } from './ios-types.js';
import type { NativeCanvasDriver } from './native-driver.js';

declare const UIImageView: ObjCClass<UIImageViewNative>;
declare const UIImage: UIImageClass;
declare const UIScreen: { mainScreen: { scale: number } };
declare function CGColorSpaceCreateDeviceRGB(): object;
declare function CGBitmapContextCreate(
    data: null,
    width: number,
    height: number,
    bitsPerComponent: number,
    bytesPerRow: number,
    space: object,
    bitmapInfo: number,
): CGContextRef;
declare function CGContextScaleCTM(ctx: CGContextRef, sx: number, sy: number): void;
declare function CGContextSetShouldAntialias(ctx: CGContextRef, enabled: boolean): void;
declare function CGContextSetRGBFillColor(ctx: CGContextRef, r: number, g: number, b: number, a: number): void;
declare function CGContextSetRGBStrokeColor(ctx: CGContextRef, r: number, g: number, b: number, a: number): void;
declare function CGContextSetLineWidth(ctx: CGContextRef, width: number): void;
declare function CGContextFillRect(ctx: CGContextRef, rect: CGRect): void;
declare function CGContextClearRect(ctx: CGContextRef, rect: CGRect): void;
declare function CGContextBeginPath(ctx: CGContextRef): void;
declare function CGContextMoveToPoint(ctx: CGContextRef, x: number, y: number): void;
declare function CGContextAddLineToPoint(ctx: CGContextRef, x: number, y: number): void;
declare function CGContextAddRect(ctx: CGContextRef, rect: CGRect): void;
declare function CGContextClosePath(ctx: CGContextRef): void;
declare function CGContextFillPath(ctx: CGContextRef): void;
declare function CGContextStrokePath(ctx: CGContextRef): void;
declare function CGBitmapContextCreateImage(ctx: CGContextRef): CGImageRef;

/** `kCGImageAlphaPremultipliedLast` — RGBA, alpha last, host byte order. No separate byte-order flag needed at 8 bits/component. */
const ALPHA_PREMULTIPLIED_LAST = 1;
/** `UIImageOrientation.up` — the bitmap is already drawn right-side up; nothing to rotate. */
const ORIENTATION_UP = 0;

/** `UIColor`'s 0–1 float components, from the `0xAARRGGBB` integer the backend takes. */
function argbParts(argb: number): { red: number; green: number; blue: number; alpha: number } {
    return {
        red: ((argb >>> 16) & 0xff) / 255,
        green: ((argb >>> 8) & 0xff) / 255,
        blue: (argb & 0xff) / 255,
        alpha: ((argb >>> 24) & 0xff) / 255,
    };
}

type PathOp =
    | { kind: 'move'; x: number; y: number }
    | { kind: 'line'; x: number; y: number }
    | { kind: 'rect'; x: number; y: number; width: number; height: number }
    | { kind: 'close' };

/** `this` inside an `.extend()` implementation: the ObjC instance plus the runtime's `super` proxy. */
type ExtendedImageView = UIImageViewNative & { super: { layoutSubviews(): void } };

let imageViewClass: ObjCClass<UIImageViewNative> | undefined;

/** Built on first use: `.extend()` needs the ObjC runtime, which merely importing this module has not. */
function canvasImageView(): ObjCClass<UIImageViewNative> {
    if (imageViewClass) return imageViewClass;
    imageViewClass = UIImageView.extend(
        {
            layoutSubviews(this: ExtendedImageView) {
                this.super.layoutSubviews();
                (this.driver as IosNativeCanvas | undefined)?._layoutChanged(
                    this.bounds.size.width,
                    this.bounds.size.height,
                );
            },
        },
        { name: 'GjsifyCanvas2DImageView' },
    );
    return imageViewClass;
}

class IosNativeCanvas implements NativeCanvasDriver {
    private view: UIImageViewNative | null = null;
    private context: CGContextRef | null = null;
    private scale = 1;
    private logicalWidth = 0;
    private logicalHeight = 0;
    private ops: PathOp[] = [];
    private allocated: ((width: number, height: number) => void) | null = null;
    private lastWidth = -1;
    private lastHeight = -1;

    createNativeView(): object {
        const view = canvasImageView().new();
        view.driver = this;
        view.clipsToBounds = true;
        this.view = view;
        return view;
    }

    attach(nativeView: unknown, allocated: (width: number, height: number) => void): void {
        const view = nativeView as UIImageViewNative;
        this.view = view;
        this.scale = UIScreen.mainScreen.scale || 1;
        this.allocated = allocated;
        this._layoutChanged(view.bounds.size.width, view.bounds.size.height);
    }

    detach(): void {
        this.allocated = null;
        this.context = null;
        this.view = null;
        this.lastWidth = -1;
        this.lastHeight = -1;
    }

    /** @internal called from the `UIImageView` subclass's `layoutSubviews`. */
    _layoutChanged(width: number, height: number): void {
        const w = Math.round(width);
        const h = Math.round(height);
        if (w === this.lastWidth && h === this.lastHeight) return;
        this.lastWidth = w;
        this.lastHeight = h;
        this.allocated?.(w, h);
    }

    resize(width: number, height: number): void {
        this.logicalWidth = width;
        this.logicalHeight = height;
        this.ops = [];
        this.allocate();
    }

    private allocate(): void {
        const pixelWidth = Math.max(1, Math.round(this.logicalWidth * this.scale));
        const pixelHeight = Math.max(1, Math.round(this.logicalHeight * this.scale));
        const space = CGColorSpaceCreateDeviceRGB();
        const ctx = CGBitmapContextCreate(null, pixelWidth, pixelHeight, 8, 0, space, ALPHA_PREMULTIPLIED_LAST);
        CGContextScaleCTM(ctx, this.scale, this.scale);
        this.context = ctx;
    }

    fillRect(x: number, y: number, width: number, height: number, argb: number): void {
        const ctx = this.context;
        if (!ctx) return;
        CGContextSetShouldAntialias(ctx, false);
        const { red, green, blue, alpha } = argbParts(argb);
        CGContextSetRGBFillColor(ctx, red, green, blue, alpha);
        CGContextFillRect(ctx, { origin: { x, y }, size: { width, height } });
    }

    clearRect(x: number, y: number, width: number, height: number): void {
        const ctx = this.context;
        if (!ctx) return;
        CGContextClearRect(ctx, { origin: { x, y }, size: { width, height } });
    }

    resetPath(): void {
        this.ops = [];
    }

    moveTo(x: number, y: number): void {
        this.ops.push({ kind: 'move', x, y });
    }

    lineTo(x: number, y: number): void {
        this.ops.push({ kind: 'line', x, y });
    }

    rect(x: number, y: number, width: number, height: number): void {
        this.ops.push({ kind: 'rect', x, y, width, height });
    }

    closePath(): void {
        this.ops.push({ kind: 'close' });
    }

    /** Rebuilds the context's current path from the recorded ops — see the file header. */
    private replayPath(ctx: CGContextRef): void {
        CGContextBeginPath(ctx);
        for (const op of this.ops) {
            switch (op.kind) {
                case 'move':
                    CGContextMoveToPoint(ctx, op.x, op.y);
                    break;
                case 'line':
                    CGContextAddLineToPoint(ctx, op.x, op.y);
                    break;
                case 'rect':
                    CGContextAddRect(ctx, {
                        origin: { x: op.x, y: op.y },
                        size: { width: op.width, height: op.height },
                    });
                    break;
                case 'close':
                    CGContextClosePath(ctx);
                    break;
            }
        }
    }

    fillPath(argb: number): void {
        const ctx = this.context;
        if (!ctx) return;
        CGContextSetShouldAntialias(ctx, true);
        this.replayPath(ctx);
        const { red, green, blue, alpha } = argbParts(argb);
        CGContextSetRGBFillColor(ctx, red, green, blue, alpha);
        CGContextFillPath(ctx);
    }

    strokePath(argb: number, lineWidth: number): void {
        const ctx = this.context;
        if (!ctx) return;
        CGContextSetShouldAntialias(ctx, true);
        this.replayPath(ctx);
        CGContextSetLineWidth(ctx, lineWidth);
        const { red, green, blue, alpha } = argbParts(argb);
        CGContextSetRGBStrokeColor(ctx, red, green, blue, alpha);
        CGContextStrokePath(ctx);
    }

    /** No bitmap drawing in this subset (ADR 0107) — Android's rect anti-alias is likewise fixed; nothing to toggle. */
    setImageSmoothing(): void {}

    invalidate(): void {
        const ctx = this.context;
        const view = this.view;
        if (!ctx || !view) return;
        const cgImage = CGBitmapContextCreateImage(ctx);
        view.image = UIImage.alloc().initWithCGImageScaleOrientation(cgImage, this.scale, ORIENTATION_UP);
    }
}

export function createNativeCanvasDriver(): NativeCanvasDriver {
    return new IosNativeCanvas();
}
