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
}
interface AndroidMatrix {
    setScale(sx: number, sy: number): void;
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
    for (const { d, opacity } of iconPaths) {
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
        const matrix = new gfx.Matrix();
        matrix.setScale(scale, scale);
        path.transform(matrix);
        paint.setColor(colorInt);
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
