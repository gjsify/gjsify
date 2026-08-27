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

// The default light/dark fills moved to the headless `@gjsify/adwaita-core`
// (ADR 0004 — they belong to the color-scheme observable); re-exported here so
// existing `icon-path` / `icons` consumers keep working unchanged.
export { DEFAULT_ICON_COLOR, DEFAULT_ICON_COLOR_DARK } from '@gjsify/adwaita-core';

/** Options for rendering a symbolic icon to a native image. */
export interface SymbolicIconOptions {
    /** Rendered square size in DIPs (default {@link ADWAITA_ICON_GRID} = 16). */
    size?: number;
    /** Fill colour as a hex string (`#RRGGBB` / `#AARRGGBB`). Default = light fg. */
    color?: string;
}

/**
 * A 2D affine transform in SVG's own `matrix(a b c d e f)` order.
 *
 * `[a c e; b d f; 0 0 1]` — the same six numbers `android.graphics.Matrix.setValues`
 * and `CGAffineTransformMake` take, so neither renderer has to convert anything.
 */
export type IconTransform = readonly [number, number, number, number, number, number];

/** The identity — nothing to apply. */
export const IDENTITY_TRANSFORM: IconTransform = [1, 0, 0, 1, 0, 0];

/** One fillable path of a symbolic icon. */
export interface IconPath {
    /** SVG `d` path data (the `androidx` `PathParser` `pathData` grammar). */
    d: string;
    /** Per-path fill opacity in [0, 1] — Adwaita dims accent sub-shapes (e.g. the
     *  filled panel of `sidebar-show`); defaults to 1 when the path has none. */
    opacity: number;
    /**
     * This path's own `transform`, composed under every enclosing `<g transform=…>`.
     *
     * {@link IDENTITY_TRANSFORM} for the icons that need none. NOT optional: an
     * optional field is one a renderer forgets to read, and forgetting it is exactly
     * the defect this exists to fix.
     */
    transform: IconTransform;
    /**
     * `fill-rule` — `evenodd`, or `nonzero` (SVG's initial value) when unset.
     *
     * Neither renderer set one, so both drew the platform default and every icon
     * declaring `evenodd` filled a hole it should have carved.
     */
    fillRule: 'nonzero' | 'evenodd';
    /**
     * The path's own `fill`, when it names a colour instead of inheriting one.
     *
     * `null` means "use the caller's colour" — the symbolic case, and the common one.
     * A shipped icon that hardcodes `#ed333b` for a critical battery is NOT symbolic,
     * and drawing it in one colour is what turned a red battery grey. The icon
     * generator rewrites the four neutral greys to `currentColor`, so anything still
     * literal here was meant to be literal.
     */
    fill: string | null;
}

/** `a × b` for two affine transforms — apply `b` first, then `a`. */
function composeTransforms(a: IconTransform, b: IconTransform): IconTransform {
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ];
}

const TRANSFORM_FN_RE = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
const DEG = Math.PI / 180;

/**
 * Parse an SVG `transform` attribute into one affine matrix.
 *
 * The whole grammar, not the two functions the shipped icons happen to use
 * (`translate` 33×, `matrix` 9×): SVG's transform list is exactly matrix / translate /
 * scale / rotate / skewX / skewY, all affine, and supporting five of six would sit
 * silently wrong the first time an icon set grows the sixth. Returns `null` for a
 * string it cannot read, which a caller must treat as a refusal rather than as
 * identity — quietly dropping a transform is the failure being repaired here.
 */
export function parseIconTransform(value: string): IconTransform | null {
    let out: IconTransform = IDENTITY_TRANSFORM;
    let matched = false;
    TRANSFORM_FN_RE.lastIndex = 0;
    let fn: RegExpExecArray | null;
    while ((fn = TRANSFORM_FN_RE.exec(value)) !== null) {
        const args = (fn[2] as string)
            .split(/[\s,]+/)
            .filter((part) => part !== '')
            .map(Number);
        if (args.some((n) => !Number.isFinite(n))) return null;
        let step: IconTransform;
        switch (fn[1]) {
            case 'matrix':
                if (args.length !== 6) return null;
                step = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!];
                break;
            case 'translate':
                // `translate(tx)` is `translate(tx, 0)` — and `translate(118)` is one of
                // the forms actually shipped, so the one-argument case is load-bearing.
                if (args.length < 1 || args.length > 2) return null;
                step = [1, 0, 0, 1, args[0]!, args[1] ?? 0];
                break;
            case 'scale':
                // `scale(s)` is uniform.
                if (args.length < 1 || args.length > 2) return null;
                step = [args[0]!, 0, 0, args[1] ?? args[0]!, 0, 0];
                break;
            case 'rotate': {
                if (args.length !== 1 && args.length !== 3) return null;
                const cos = Math.cos(args[0]! * DEG);
                const sin = Math.sin(args[0]! * DEG);
                const rot: IconTransform = [cos, sin, -sin, cos, 0, 0];
                if (args.length === 1) {
                    step = rot;
                    break;
                }
                const [cx, cy] = [args[1]!, args[2]!];
                step = composeTransforms(composeTransforms([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
                break;
            }
            case 'skewX':
                if (args.length !== 1) return null;
                step = [1, 0, Math.tan(args[0]! * DEG), 1, 0, 0];
                break;
            case 'skewY':
                if (args.length !== 1) return null;
                step = [1, Math.tan(args[0]! * DEG), 0, 1, 0, 0];
                break;
            default:
                return null;
        }
        out = composeTransforms(out, step);
        matched = true;
    }
    return matched ? out : null;
}

const NORMALIZED_ATTR_RE = /\b(d|fill|fill-rule|fill-opacity|transform|style)="([^"]*)"/g;

/** Attributes of one tag as a map. Only the ones this module reads. */
function tagAttributes(tag: string): Map<string, string> {
    const out = new Map<string, string>();
    NORMALIZED_ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = NORMALIZED_ATTR_RE.exec(tag)) !== null) out.set(attr[1] as string, attr[2] as string);
    return out;
}

/**
 * A presentation attribute, preferring the `style="…"` declaration when there is one.
 *
 * `style` wins over the attribute in CSS, and it is not academic here: shipped icons
 * carry their primary fill as `style="fill:#2e3436"`, where the icon generator's
 * `fill="…"` rewrite never reached — so reading the attribute alone saw no fill at all
 * and reported the path as symbolic.
 */
function presentationValue(attrs: Map<string, string>, name: string): string | undefined {
    const style = attrs.get('style');
    if (style !== undefined) {
        const declared = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style)?.[1];
        if (declared !== undefined) return declared.trim();
    }
    return attrs.get(name);
}

/**
 * Extract every fillable `<path>` of a symbolic SVG.
 *
 * Each path must be drawn SEPARATELY (not concatenated): Adwaita icons frequently pair
 * a solid outline with a dimmed (`fill-opacity`) inner shape, and a single path's
 * subpaths carve holes via the winding rule — flattening all paths into one fill
 * destroys both. Returns `[]` when the SVG carries no path data.
 *
 * WHY THIS WALKS `<g>` AND NOT JUST `<path>`. It used to be one regex over `<path>`
 * tags, and the geometry of a grouped icon is authored in the group's coordinate space:
 * icons whose paths live at x≈684, y≈180 under a `translate(-680,-180)` were extracted
 * with the translate dropped, scaled by `size/16`, and drawn onto a 16×16 bitmap that
 * their geometry misses entirely. Measured before this change: 12 shipped icons —
 * eleven `battery-level-*-charging` and one parental-controls glyph — rendered
 * COMPLETELY EMPTY on NativeScript, with no diagnostic anywhere.
 */
export function extractIconPaths(svg: string): IconPath[] {
    const paths: IconPath[] = [];
    // `<g …>`, `</g>` and `<path …>` in document order, so the group stack is real
    // nesting rather than a guess from attribute order.
    const tokenRe = /<(g|path)\b([^>]*)>|<\/g\s*>/g;
    const stack: IconTransform[] = [];
    let token: RegExpExecArray | null;
    while ((token = tokenRe.exec(svg)) !== null) {
        const [whole, tag, rest] = token;
        if (tag === undefined) {
            stack.pop();
            continue;
        }
        const attrs = tagAttributes(whole);
        const own = attrs.has('transform') ? parseIconTransform(attrs.get('transform') as string) : IDENTITY_TRANSFORM;
        // An unreadable transform is NOT identity. Dropping it is what drew those
        // twelve icons off-canvas; skipping the subtree loses the same pixels but
        // leaves the rest of the icon correct, and the shape is at least not wrong.
        const inherited = stack.length > 0 ? (stack[stack.length - 1] as IconTransform) : IDENTITY_TRANSFORM;
        const effective = own === null ? null : composeTransforms(inherited, own);

        if (tag === 'g') {
            // A self-closing `<g …/>` opens nothing.
            if (!(rest as string).trimEnd().endsWith('/')) {
                stack.push(effective ?? inherited);
            }
            continue;
        }

        const d = attrs.get('d')?.trim();
        if (!d || effective === null) continue;
        const opAttr = presentationValue(attrs, 'fill-opacity');
        const opacity = opAttr !== undefined ? Number.parseFloat(opAttr) : 1;
        const fill = presentationValue(attrs, 'fill');
        paths.push({
            // Space-separate arc flags so Android's PathParser can read the compact
            // form (see normalizeArcFlags) — a no-op for paths without glued flags.
            d: normalizeArcFlags(d),
            opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
            transform: effective,
            fillRule: presentationValue(attrs, 'fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero',
            // `currentColor` and `none` are not colours to pin: the first IS the
            // caller's colour by definition, and the second is handled by the path
            // simply not being filled — which the renderers already do by drawing
            // every extracted path.
            fill: fill === undefined || fill === 'currentColor' || fill === 'none' ? null : fill,
        });
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

/** A colour split into the 0..1 components UIKit and CoreGraphics take. */
export interface IconColorComponents {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

/**
 * Parse `#RGB` / `#RRGGBB` / `#AARRGGBB` into 0..1 components.
 *
 * Android does not need this — `android.graphics.Color.parseColor` takes the
 * string directly — but UIKit has no hex constructor, so the iOS backend has to
 * do the arithmetic. Note the ALPHA-FIRST order in the 8-digit form: that is the
 * Android convention {@link SymbolicIconOptions.color} is documented in, and the
 * two backends must read the same string the same way.
 *
 * Returns opaque black for anything unparsable, so a typo in a caller's colour
 * yields a visible icon rather than an invisible one. Where the caller has a better
 * fallback than black — a path's own `fill`, which should fall back to the icon
 * colour rather than to black — use {@link parseHexColorOrNull}.
 */
export function parseHexColor(hex: string): IconColorComponents {
    return parseHexColorOrNull(hex) ?? { red: 0, green: 0, blue: 0, alpha: 1 };
}

/**
 * {@link parseHexColor} without the black fallback: `null` says "not a colour I read".
 *
 * Two callers want different answers to the same failure. A caller's own
 * `options.color` has no better candidate than black — an invisible icon is worse
 * than a wrong-coloured one. A path's `fill` does: the icon colour the caller passed
 * in. Folding both into one black default made the second silently draw black.
 */
export function parseHexColorOrNull(hex: string): IconColorComponents | null {
    const raw = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]+$/.test(raw)) return null;

    let alpha = 255;
    let red: number;
    let green: number;
    let blue: number;
    if (raw.length === 3) {
        // `#abc` — each digit doubled.
        red = Number.parseInt(raw[0]! + raw[0], 16);
        green = Number.parseInt(raw[1]! + raw[1], 16);
        blue = Number.parseInt(raw[2]! + raw[2], 16);
    } else if (raw.length === 6) {
        red = Number.parseInt(raw.slice(0, 2), 16);
        green = Number.parseInt(raw.slice(2, 4), 16);
        blue = Number.parseInt(raw.slice(4, 6), 16);
    } else if (raw.length === 8) {
        alpha = Number.parseInt(raw.slice(0, 2), 16);
        red = Number.parseInt(raw.slice(2, 4), 16);
        green = Number.parseInt(raw.slice(4, 6), 16);
        blue = Number.parseInt(raw.slice(6, 8), 16);
    } else {
        return null;
    }
    return { red: red / 255, green: green / 255, blue: blue / 255, alpha: alpha / 255 };
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
