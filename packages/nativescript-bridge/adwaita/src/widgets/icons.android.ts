// Adwaita symbolic-icon → native image rendering (Android).
//
// NativeScript's `Image` has no SVG decoder, so a symbolic icon is rasterised: the
// SVG path data is parsed with `androidx.core.graphics.PathParser` (its `pathData`
// grammar IS the SVG `d` grammar), scaled from the 16×16 Adwaita grid to the target
// device-pixel size, and filled in the requested theme colour on an ARGB bitmap.
// The bitmap is wrapped in an `ImageSource` for `Image.imageSource`. Resolved in
// place of the base `icons.ts` by the gjsify NS build's `platformResolvePlugin` on
// the Android target.
//
// `android.*` / `androidx.*` are ambient globals the NativeScript V8 runtime injects
// at load time (like GJS's `imports.gi.*`); only the members used are declared here
// — no hard `@nativescript/types-android` dependency — mirroring how
// `@gjsify/devtools-nativescript`'s `screenshot.android.ts` types `android.graphics`.
//
// Original implementation.

import { ImageSource, Screen } from '@nativescript/core';
import { ADWAITA_ICON_GRID, DEFAULT_ICON_COLOR, extractIconPaths, type SymbolicIconOptions } from './icon-path.js';

// ===== Ambient Android graphics globals (typed, no `any`) =====

interface AndroidPath {
    transform(matrix: AndroidMatrix): void;
    setFillType(fillType: unknown): void;
}
interface AndroidMatrix {
    /** Row-major `[a c e; b d f; 0 0 1]` — nine floats, not six. */
    setValues(values: number[]): void;
    postScale(sx: number, sy: number): void;
}
interface AndroidPaint {
    setAntiAlias(aa: boolean): void;
    setColor(color: number): void;
    setAlpha(alpha: number): void;
    setStyle(style: unknown): void;
}
interface AndroidBitmap {
    recycle(): void;
}
interface AndroidCanvas {
    drawPath(path: AndroidPath, paint: AndroidPaint): void;
}

declare const android:
    | {
          graphics: {
              Bitmap: {
                  createBitmap(width: number, height: number, config: unknown): AndroidBitmap;
                  Config: { ARGB_8888: unknown };
              };
              Canvas: { new (bitmap: AndroidBitmap): AndroidCanvas };
              Paint: { new (): AndroidPaint; Style: { FILL: unknown } };
              Matrix: { new (): AndroidMatrix };
              Path: { FillType: { EVEN_ODD: unknown } };
              Color: { parseColor(color: string): number };
          };
      }
    | undefined;

declare const androidx:
    | {
          core: { graphics: { PathParser: { createPathFromPathData(pathData: string): AndroidPath | null } } };
      }
    | undefined;

/**
 * Render an Adwaita symbolic SVG to a native {@link ImageSource} on Android, or
 * `null` when the SVG has no path data / the native graphics stack is unavailable.
 * The icon is drawn at `size` DIPs × the screen density so it stays crisp; place it
 * in an `Image` sized `size`×`size` DIP with `stretch:'aspectFit'`.
 */
export function renderSymbolicIcon(svg: string, options?: SymbolicIconOptions): ImageSource | null {
    const gfx = android?.graphics;
    const parser = androidx?.core?.graphics?.PathParser;
    if (!gfx || !parser) return null;

    const iconPaths = extractIconPaths(svg);
    if (iconPaths.length === 0) return null;

    const sizeDip = options?.size ?? ADWAITA_ICON_GRID;
    const density = Screen.mainScreen?.scale || 1;
    const px = Math.max(1, Math.round(sizeDip * density));
    const scale = px / ADWAITA_ICON_GRID;

    const bitmap = gfx.Bitmap.createBitmap(px, px, gfx.Bitmap.Config.ARGB_8888);
    const canvas = new gfx.Canvas(bitmap);
    const colorInt = gfx.Color.parseColor(options?.color ?? DEFAULT_ICON_COLOR);
    const paint = new gfx.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(gfx.Paint.Style.FILL);

    // Draw each `<path>` SEPARATELY: Adwaita icons pair a solid outline with a
    // dimmed (`fill-opacity`) inner shape, and each path's subpaths carve holes via
    // the non-zero winding rule — concatenating them into one fill destroys both.
    let drew = false;
    for (const { d, opacity, transform, fillRule, fill } of iconPaths) {
        // `extractIconPaths` already runs `normalizeArcFlags` over `d`; still guard
        // the native call — a path PathParser cannot tokenise THROWS a Java
        // exception, which must NOT crash the whole view (onCreateView). Skip the
        // offending sub-path and render the rest of the icon.
        let path: AndroidPath | null = null;
        try {
            path = parser.createPathFromPathData(d);
        } catch {
            path = null;
        }
        if (!path) continue;
        // Set BEFORE the transform: `Path.transform` preserves the fill type, but
        // `createPathFromPathData` starts every path at the WINDING default — so
        // leaving it alone filled the holes `fill-rule="evenodd"` exists to carve.
        if (fillRule === 'evenodd') path.setFillType(gfx.Path.FillType.EVEN_ODD);
        const matrix = new gfx.Matrix();
        // `Matrix.setValues` is ROW-major (`[a c e; b d f; 0 0 1]`) while SVG's
        // `matrix(a b c d e f)` is column-major, so the six numbers interleave here
        // rather than copying across.
        matrix.setValues([transform[0], transform[2], transform[4], transform[1], transform[3], transform[5], 0, 0, 1]);
        // The icon's own transform FIRST, then the grid scale — the order the SVG
        // means. A path authored at x≈684 under `translate(-680,-180)` has to come
        // back onto the grid before the grid is scaled, not after.
        matrix.postScale(scale, scale);
        path.transform(matrix);
        // A path that names its own fill is not symbolic: a critical battery is red
        // whatever colour the caller asked for. `parseColor` throws on a spelling it
        // does not know, and one unreadable fill must not cost the whole icon.
        let pathColor = colorInt;
        if (fill !== null) {
            try {
                pathColor = gfx.Color.parseColor(fill);
            } catch {
                pathColor = colorInt;
            }
        }
        paint.setColor(pathColor);
        paint.setAlpha(Math.round(255 * opacity));
        canvas.drawPath(path, paint);
        drew = true;
    }
    if (!drew) return null;

    return new ImageSource(bitmap);
}

export {
    ADWAITA_ICON_GRID,
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    extractIconPaths,
    extractPathData,
} from './icon-path.js';
export type { IconPath, SymbolicIconOptions } from './icon-path.js';
