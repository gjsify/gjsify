// The slice of UIKit/CoreGraphics `native-canvas.ios.ts` calls, typed structurally.
//
// `UI*`/`CG*` are globals the NativeScript iOS runtime injects (the ObjC + C bridge) — see
// `gtksource/src/ios-types.ts` for why this workspace declares its own slice instead of
// depending on `@nativescript/types-ios`. Sibling of `android-types.ts`.

export interface CGPoint {
    x: number;
    y: number;
}

export interface CGSize {
    width: number;
    height: number;
}

export interface CGRect {
    origin: CGPoint;
    size: CGSize;
}

/** Opaque CoreGraphics handles: never read, only threaded from one call to the next. */
export type CGColorSpaceRef = object;
export type CGContextRef = object;
export type CGImageRef = object;

/** An ObjC class as the bridge exposes it: `new`/`alloc().init()` construct, `extend` subclasses. */
export interface ObjCClass<T> {
    new: () => T;
    alloc(): { init(): T };
    extend(implementation: object, options?: { name?: string; protocols?: readonly unknown[] }): ObjCClass<T>;
}

export interface UIImageInstance {
    readonly size: CGSize;
}

export interface UIImageClass {
    alloc(): {
        initWithCGImageScaleOrientation(cgImage: CGImageRef, scale: number, orientation: number): UIImageInstance;
    };
}

export interface UIViewNative {
    frame: CGRect;
    bounds: CGRect;
    contentMode: number;
    clipsToBounds: boolean;
    /** Set on the view this driver creates, as the Android driver sets it on its `ImageView`. */
    driver?: object;
    setNeedsDisplay(): void;
}

export interface UIImageViewNative extends UIViewNative {
    image: UIImageInstance | null;
}
