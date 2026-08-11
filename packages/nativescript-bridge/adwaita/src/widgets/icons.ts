// Adwaita symbolic-icon → native image rendering (base / unsupported platform).
//
// NativeScript's `Image` has no SVG decoder, so symbolic icons are rasterised per
// platform: `icons.android.ts` draws the path data onto a `Bitmap`, `icons.ios.ts`
// replays it into a `UIBezierPath`. The gjsify NS build's `platformResolvePlugin`
// swaps this base module for the matching variant on-device. This base returns
// `null` (off-device / unsupported), so callers fall back to no icon.
//
// `extractPathData` + option defaults live in the pure `icon-path.ts` so they are
// shared without a platform-resolve cycle (a re-export from here would re-resolve
// to the platform variant). See that module for the SVG-grammar details.
//
// Original implementation.

import type { ImageSource } from '@nativescript/core';
import type { SymbolicIconOptions } from './icon-path.js';

export {
    ADWAITA_ICON_GRID,
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    extractIconPaths,
    extractPathData,
} from './icon-path.js';
export type { IconPath, SymbolicIconOptions } from './icon-path.js';

/**
 * Render an Adwaita symbolic SVG string to a native {@link ImageSource}. The base
 * implementation returns `null` — only the platform variants rasterise. Callers
 * treat `null` as "no icon available" (the widget shows nothing / its fallback).
 */
export function renderSymbolicIcon(_svg: string, _options?: SymbolicIconOptions): ImageSource | null {
    return null;
}
