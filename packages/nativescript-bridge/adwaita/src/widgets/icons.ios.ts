// Adwaita symbolic-icon → native image rendering (iOS).
//
// The Android backend hands its path data straight to
// `androidx.core.graphics.PathParser`. iOS has no such parser — neither UIKit
// nor CoreGraphics reads SVG path data — so this backend builds the geometry
// itself from `parseSvgPath` (pure, and unit-tested off-device in
// `src/svg-path.spec.ts`, including a sweep over every shipped symbolic icon)
// and replays it into a `UIBezierPath`.
//
// Resolved in place of the base `icons.ts` by the gjsify NS build's
// `platformResolvePlugin` on the iOS target. Until this module existed, that
// resolution found nothing and the base returned `null`, so EVERY icon-bearing
// widget — AdwIcon, AdwImageButton, GtkMenuButton, AdwButtonContent and every
// row with an icon — silently rendered no icon at all on iOS, while
// `package.json` declared `nativescriptPlatforms: ['android', 'ios']`.
//
// `UI*` / `CG*` are ambient globals the NativeScript iOS runtime injects (the
// ObjC bridge, the analogue of GJS's `imports.gi.*`); only the members used are
// declared here, mirroring how `icons.android.ts` types `android.graphics` and
// how `@gjsify/devtools-nativescript`'s `screenshot.ios.ts` types UIKit.
//
// NOT YET VERIFIED ON A DEVICE — no iOS hardware has been available. The
// geometry half is covered by CI; this half is the ObjC call sequence, which
// mirrors the Android backend step for step.
//
// Original implementation.

import { ImageSource, Screen } from '@nativescript/core';

import {
    ADWAITA_ICON_GRID,
    DEFAULT_ICON_COLOR,
    extractIconPaths,
    parseHexColor,
    parseHexColorOrNull,
    type SymbolicIconOptions,
} from './icon-path.js';
import { parseSvgPath } from './svg-path.js';

// ===== Ambient UIKit / CoreGraphics globals (typed, no `any`) =====

interface CGPoint {
    x: number;
    y: number;
}
interface CGSize {
    width: number;
    height: number;
}
interface CGAffineTransform {
    a: number;
}

interface UIBezierPathInstance {
    moveToPoint(point: CGPoint): void;
    addLineToPoint(point: CGPoint): void;
    addCurveToPointControlPoint1ControlPoint2(end: CGPoint, control1: CGPoint, control2: CGPoint): void;
    closePath(): void;
    applyTransform(transform: CGAffineTransform): void;
    fill(): void;
    /** `fill()` uses the even-odd rule instead of the non-zero default. */
    usesEvenOddFillRule: boolean;
}

interface UIColorInstance {
    setFill(): void;
}

declare const UIBezierPath: { bezierPath(): UIBezierPathInstance } | undefined;
declare const UIColor:
    | { colorWithRedGreenBlueAlpha(red: number, green: number, blue: number, alpha: number): UIColorInstance }
    | undefined;
declare const CGPointMake: ((x: number, y: number) => CGPoint) | undefined;
declare const CGSizeMake: ((width: number, height: number) => CGSize) | undefined;
declare const CGAffineTransformMakeScale: ((sx: number, sy: number) => CGAffineTransform) | undefined;
declare const CGAffineTransformMake:
    | ((a: number, b: number, c: number, d: number, tx: number, ty: number) => CGAffineTransform)
    | undefined;
declare const UIGraphicsBeginImageContextWithOptions:
    | ((size: CGSize, opaque: boolean, scale: number) => void)
    | undefined;
declare const UIGraphicsGetImageFromCurrentImageContext: (() => unknown) | undefined; // UIImage
declare const UIGraphicsEndImageContext: (() => void) | undefined;

/**
 * Render an Adwaita symbolic SVG to a native {@link ImageSource} on iOS, or
 * `null` when the SVG has no path data / UIKit is unavailable.
 *
 * Drawn at `size` points × the screen scale so it stays crisp on Retina; place
 * it in an `Image` sized `size`×`size` with `stretch:'aspectFit'`, exactly as on
 * Android.
 */
export function renderSymbolicIcon(svg: string, options?: SymbolicIconOptions): ImageSource | null {
    if (
        !UIBezierPath ||
        !UIColor ||
        !CGPointMake ||
        !CGSizeMake ||
        !CGAffineTransformMakeScale ||
        !CGAffineTransformMake ||
        !UIGraphicsBeginImageContextWithOptions ||
        !UIGraphicsGetImageFromCurrentImageContext ||
        !UIGraphicsEndImageContext
    ) {
        return null;
    }

    const iconPaths = extractIconPaths(svg);
    if (iconPaths.length === 0) return null;

    const sizePt = options?.size ?? ADWAITA_ICON_GRID;
    const scale = Screen.mainScreen?.scale || 1;
    const pathScale = sizePt / ADWAITA_ICON_GRID;
    const { red, green, blue, alpha } = parseHexColor(options?.color ?? DEFAULT_ICON_COLOR);

    // Points, not pixels: UIKit's image context takes the scale separately and
    // multiplies for us — the Android backend has to size its bitmap in pixels.
    UIGraphicsBeginImageContextWithOptions(CGSizeMake(sizePt, sizePt), false, scale);

    let drew = false;
    try {
        // Draw each `<path>` SEPARATELY, for the same two reasons as on Android:
        // Adwaita pairs a solid outline with a dimmed (`fill-opacity`) inner
        // shape, and a single path's subpaths carve holes by winding rule.
        for (const { d, opacity, transform, fillRule, fill } of iconPaths) {
            const commands = parseSvgPath(d);
            if (commands.length === 0) continue;

            const path = UIBezierPath.bezierPath();
            for (const command of commands) {
                switch (command.type) {
                    case 'M':
                        path.moveToPoint(CGPointMake(command.x, command.y));
                        break;
                    case 'L':
                        path.addLineToPoint(CGPointMake(command.x, command.y));
                        break;
                    case 'C':
                        path.addCurveToPointControlPoint1ControlPoint2(
                            CGPointMake(command.x, command.y),
                            CGPointMake(command.x1, command.y1),
                            CGPointMake(command.x2, command.y2),
                        );
                        break;
                    case 'Z':
                        path.closePath();
                        break;
                }
            }
            // `evenOdd` where the path asks for it. `UIBezierPath.usesEvenOddFillRule`
            // is a property of the PATH, so it has to be set before `fill()` — the
            // default is the non-zero rule, which fills the holes those icons carve.
            if (fillRule === 'evenodd') path.usesEvenOddFillRule = true;
            // The icon's OWN transform first, then the 16×16 grid scale — the order
            // the SVG means. A path authored at x≈684 under `translate(-680,-180)`
            // has to come back onto the grid before the grid is scaled, not after.
            // `CGAffineTransformMake` takes SVG's six numbers in SVG's own order.
            path.applyTransform(
                CGAffineTransformMake(
                    transform[0],
                    transform[1],
                    transform[2],
                    transform[3],
                    transform[4],
                    transform[5],
                ),
            );
            path.applyTransform(CGAffineTransformMakeScale(pathScale, pathScale));
            // A path that names its own fill is not symbolic: a critical battery is
            // red whatever colour the caller asked for. An unreadable spelling falls
            // back rather than costing the icon.
            const own = fill === null ? null : parseHexColorOrNull(fill);
            const rgba = own ?? { red, green, blue, alpha };
            UIColor.colorWithRedGreenBlueAlpha(rgba.red, rgba.green, rgba.blue, rgba.alpha * opacity).setFill();
            path.fill();
            drew = true;
        }

        if (!drew) return null;
        const image = UIGraphicsGetImageFromCurrentImageContext();
        return image ? new ImageSource(image) : null;
    } finally {
        // The context is process-global state: leaving one open corrupts every
        // later drawing call, so it is ended on the throwing path too.
        UIGraphicsEndImageContext();
    }
}

export {
    ADWAITA_ICON_GRID,
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    extractIconPaths,
    extractPathData,
} from './icon-path.js';
export type { IconPath, SymbolicIconOptions } from './icon-path.js';
