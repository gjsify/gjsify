// @gjsify/devtools-nativescript — iOS view → base64 PNG capture.
//
// UNTESTED iOS-prep stub written from the UIKit docs (no device available in
// this environment). Rasterises a NativeScript view's backing `UIView` through
// `UIGraphicsImageRenderer`, PNG-encodes via `UIImagePNGRepresentation`, then
// base64-encodes the bytes. Resolved in place of the base `screenshot.ts` by
// the gjsify NS build's `platformResolvePlugin` on the iOS target.
//
// `UI*` / `NSData` are ambient globals the NativeScript V8 runtime injects on
// iOS (the Objective-C bridge); declared structurally here — only the members
// the capture calls — so the module type-checks under `gjsify tsc` without a
// hard `@nativescript/types` dependency.
//
// Original implementation.

import type { NsView } from './view-tree.js';

// ===== Ambient NativeScript / iOS (UIKit + Foundation) globals =====

interface CGRect {
    origin: { x: number; y: number };
    size: { width: number; height: number };
}

interface UIViewNative {
    bounds: CGRect;
    drawViewHierarchyInRectAfterScreenUpdates(rect: CGRect, afterUpdates: boolean): boolean;
}

interface UIImageNative {
    /* opaque — passed straight to UIImagePNGRepresentation */
    readonly __uiImage?: never;
}

interface UIGraphicsImageRendererNative {
    imageWithActions(actions: () => void): UIImageNative;
}

interface NSDataNative {
    base64EncodedStringWithOptions(options: number): string;
}

declare const UIGraphicsImageRenderer:
    | { alloc(): { initWithBounds(bounds: CGRect): UIGraphicsImageRendererNative } }
    | undefined;
declare const UIImagePNGRepresentation: ((image: UIImageNative) => NSDataNative | null) | undefined;

/** The NS iOS view exposes its backing `UIView` as `view.ios`. */
interface NsIosView extends NsView {
    ios?: UIViewNative;
}

/**
 * Capture a NativeScript view to a base64-encoded PNG string (no data-uri
 * prefix). Returns `null` when the view has no backing `UIView` or measures
 * zero. UNTESTED — verify on a real iOS target before relying on it.
 */
export function captureViewPng(view: NsView): string | null {
    const native = (view as NsIosView).ios;
    if (!native || typeof UIGraphicsImageRenderer === 'undefined' || typeof UIImagePNGRepresentation === 'undefined') {
        return null;
    }
    const bounds = native.bounds;
    if (bounds.size.width <= 0 || bounds.size.height <= 0) return null;

    const renderer = UIGraphicsImageRenderer.alloc().initWithBounds(bounds);
    const image = renderer.imageWithActions(() => {
        native.drawViewHierarchyInRectAfterScreenUpdates(bounds, true);
    });

    const data = UIImagePNGRepresentation(image);
    if (!data) return null;
    return data.base64EncodedStringWithOptions(0);
}
