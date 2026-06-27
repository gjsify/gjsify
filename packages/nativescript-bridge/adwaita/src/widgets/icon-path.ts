// Pure, platform-agnostic helpers for rendering Adwaita symbolic icons.
//
// NativeScript's `Image` decodes raster bitmaps (PNG/JPG via `BitmapFactory`) but
// has NO SVG decoder, so the Adwaita symbolic SVGs (`@gjsify/adwaita-icons`) can't
// be fed to it directly. The Android renderer (`icons.android.ts`) instead parses
// the SVG path data with `androidx.core.graphics.PathParser` (whose `pathData`
// grammar IS the SVG `d` grammar) and draws it onto a `Bitmap` in a theme color.
//
// This module holds only the parts that are pure data — extracting the path data
// out of the SVG string + the option/colour defaults — so they are unit-testable
// off-device and shared by both the base (`icons.ts`) and the Android variant
// without a platform-resolve cycle.
//
// Reference: refs/adwaita-icon-theme (symbolic icon grid). Copyright (c) GNOME
// contributors, LGPL-3.0+/CC-BY-SA-3.0.

/** The native grid (viewBox) Adwaita symbolic icons are authored on: 16×16. */
export const ADWAITA_ICON_GRID = 16;

/** Default symbolic-icon fill for light theme — Adwaita's ~`rgba(0,0,0,0.8)` fg. */
export const DEFAULT_ICON_COLOR = '#33333A';

/** Default symbolic-icon fill for dark theme — near-white fg. */
export const DEFAULT_ICON_COLOR_DARK = '#FFFFFF';

/** Options for rendering a symbolic icon to a native image. */
export interface SymbolicIconOptions {
    /** Rendered square size in DIPs (default {@link ADWAITA_ICON_GRID} = 16). */
    size?: number;
    /** Fill colour as a hex string (`#RRGGBB` / `#AARRGGBB`). Default = light fg. */
    color?: string;
}

/** One fillable path of a symbolic icon: its path data + its own fill opacity. */
export interface IconPath {
    /** SVG `d` path data (the `androidx` `PathParser` `pathData` grammar). */
    d: string;
    /** Per-path fill opacity in [0, 1] — Adwaita dims accent sub-shapes (e.g. the
     *  filled panel of `sidebar-show`); defaults to 1 when the path has none. */
    opacity: number;
}

/**
 * Extract every fillable `<path>` of a symbolic SVG as `{ d, opacity }`. Each path
 * must be drawn SEPARATELY (not concatenated): Adwaita icons frequently pair a
 * solid outline with a dimmed (`fill-opacity`) inner shape, and a single path's
 * subpaths carve holes via the non-zero winding rule — flattening all paths into
 * one fill destroys both. Returns `[]` when the SVG carries no path data.
 */
export function extractIconPaths(svg: string): IconPath[] {
    const paths: IconPath[] = [];
    const tagRe = /<path\b[^>]*>/g;
    let tag: RegExpExecArray | null;
    while ((tag = tagRe.exec(svg)) !== null) {
        const d = /\bd="([^"]*)"/.exec(tag[0])?.[1]?.trim();
        if (!d) continue;
        const opAttr = /\bfill-opacity="([^"]*)"/.exec(tag[0])?.[1];
        const opacity = opAttr !== undefined ? Number.parseFloat(opAttr) : 1;
        // Space-separate arc flags so Android's PathParser can read the compact form
        // (see normalizeArcFlags) — a no-op for paths without arcs / glued flags.
        paths.push({ d: normalizeArcFlags(d), opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1 });
    }
    return paths;
}

/**
 * Concatenate every `d="…"` path-data string of a symbolic SVG into one. Useful
 * for the single-path common case; for multi-path icons prefer
 * {@link extractIconPaths} (which preserves per-path opacity + winding). Returns
 * `''` when the SVG carries no path data.
 */
export function extractPathData(svg: string): string {
    return extractIconPaths(svg)
        .map((p) => p.d)
        .join(' ');
}

/**
 * Space-separate the two single-digit ARC FLAGS (large-arc, sweep) in every
 * elliptical-arc command (`A`/`a`) of an SVG path-data string.
 *
 * Android's `androidx.core.graphics.PathParser` (and `VectorDrawable`) tokenise
 * arc flags as standalone numbers and THROW ("Error in parsing …") when the SVG
 * compact form glues a flag to the next flag or coordinate — e.g.
 * `a3 3 0 00-1.6-.1` packs `large-arc=0`, `sweep=0`, `x=-1.6`. The SVG grammar
 * permits this (each flag is a single `0`/`1` digit), and many Adwaita symbolic
 * icons (notably the `legacy` set) use it, so they crash the renderer. This
 * re-emits each arc argument group with explicit spaces; every other command
 * passes through unchanged. (Assumes the standard `x-axis-rotation 0` Adwaita
 * icons use — a multi-digit rotation glued directly to the flags is not split.)
 */
export function normalizeArcFlags(d: string): string {
    if (d.indexOf('a') === -1 && d.indexOf('A') === -1) return d; // no arcs → unchanged
    const n = d.length;
    const isWs = (c: string): boolean => c === ' ' || c === ',' || c === '\t' || c === '\n' || c === '\r';
    const isNumStart = (c: string): boolean => (c >= '0' && c <= '9') || c === '.' || c === '+' || c === '-';
    let i = 0;
    let out = '';
    const skipWs = (): void => {
        while (i < n && isWs(d[i] as string)) i++;
    };
    const readNumber = (): string => {
        const start = i;
        if (d[i] === '+' || d[i] === '-') i++;
        while (i < n && (d[i] as string) >= '0' && (d[i] as string) <= '9') i++;
        if (d[i] === '.') {
            i++;
            while (i < n && (d[i] as string) >= '0' && (d[i] as string) <= '9') i++;
        }
        if (d[i] === 'e' || d[i] === 'E') {
            i++;
            if (d[i] === '+' || d[i] === '-') i++;
            while (i < n && (d[i] as string) >= '0' && (d[i] as string) <= '9') i++;
        }
        return d.slice(start, i);
    };
    while (i < n) {
        const c = d[i] as string;
        if (c === 'a' || c === 'A') {
            out += c;
            i++;
            // Each arc group: rx ry x-axis-rotation large-arc-flag sweep-flag x y.
            for (;;) {
                skipWs();
                if (i >= n || !isNumStart(d[i] as string)) break;
                out += ' ' + readNumber(); // rx
                skipWs();
                out += ' ' + readNumber(); // ry
                skipWs();
                out += ' ' + readNumber(); // x-axis-rotation
                skipWs();
                out += ' ' + (d[i++] as string); // large-arc-flag (single digit, may be glued)
                skipWs();
                out += ' ' + (d[i++] as string); // sweep-flag (single digit, may be glued)
                skipWs();
                out += ' ' + readNumber(); // x
                skipWs();
                out += ' ' + readNumber(); // y
            }
        } else {
            out += c;
            i++;
        }
    }
    return out;
}
