// Text-rendering methods for CanvasRenderingContext2D (fillText / strokeText
// / measureText), backed by PangoCairo.
//
// Reference: refs/node-canvas, refs/peachy (Pango text rendering patterns).
// Original: see canvas-rendering-context-2d.ts pre-split.

import Cairo from 'cairo';
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

import type { CanvasRenderingContext2D } from '../canvas-rendering-context-2d.js';
import { parseColor } from '../color.js';

export interface TextMethods {
    fillText(text: string, x: number, y: number, maxWidth?: number): void;
    strokeText(text: string, x: number, y: number, maxWidth?: number): void;
    measureText(text: string): TextMetrics;
}

declare module '../canvas-rendering-context-2d.js' {
    interface CanvasRenderingContext2D extends TextMethods {}
}

/** Parse a CSS font string (e.g. "bold 16px Arial") into a Pango.FontDescription. */
function parseFontToDescription(cssFont: string): Pango.FontDescription {
    // CSS font: [style] [variant] [weight] size[/line-height] family[, family...]
    const match = cssFont.match(
        /^\s*(italic|oblique|normal)?\s*(small-caps|normal)?\s*(bold|bolder|lighter|[1-9]00|normal)?\s*(\d+(?:\.\d+)?)(px|pt|em|rem|%)?\s*(?:\/\S+)?\s*(.+)?$/i,
    );

    if (!match) {
        // Fallback: pass directly to Pango (may have DPI-scaling quirks)
        return Pango.font_description_from_string(cssFont);
    }

    const style = match[1] || '';
    const weight = match[3] || '';
    let size = parseFloat(match[4]) || 10;
    const unit = (match[5] || 'px').toLowerCase();
    const family = (match[6] || 'sans-serif').replace(/['"]/g, '').trim();

    // Normalise everything to CSS pixels.
    // We use set_absolute_size() below which bypasses Pango's DPI scaling,
    // so 1 CSS pixel == 1 device pixel on a 1:1 surface (standard for Canvas2D).
    if (unit === 'pt')
        size = (size * 96) / 72; // 1pt = 96/72 px
    else if (unit === 'em' || unit === 'rem')
        size = size * 16; // assume 16px base
    else if (unit === '%') size = (size / 100) * 16;
    // 'px' stays as-is

    // Build description string WITHOUT size — size is set via set_absolute_size.
    let pangoStr = family;
    if (style === 'italic') pangoStr += ' Italic';
    else if (style === 'oblique') pangoStr += ' Oblique';
    if (weight === 'bold' || weight === 'bolder' || parseInt(weight) >= 600) pangoStr += ' Bold';
    else if (weight === 'lighter' || (parseInt(weight) > 0 && parseInt(weight) <= 300)) pangoStr += ' Light';

    const desc = Pango.font_description_from_string(pangoStr);
    // Absolute size: Pango.SCALE units per device pixel, no DPI conversion.
    // This ensures "9px Round9x13" renders at exactly 9 pixels — pixel-perfect.
    desc.set_absolute_size(size * Pango.SCALE);
    return desc;
}

/** Create a PangoCairo layout configured with current font/text settings. */
function createTextLayout(ctx: CanvasRenderingContext2D, text: string): Pango.Layout {
    const layout = PangoCairo.create_layout(ctx._ctx);
    layout.set_text(text, -1);

    // Force LTR base direction so text is never rendered mirrored
    // regardless of system locale or Pango context defaults.
    const pangoCtx = layout.get_context();
    pangoCtx.set_base_dir(Pango.Direction.LTR);
    layout.context_changed();

    // Parse CSS font string into Pango font description
    const fontDesc = parseFontToDescription(ctx._state.font);
    layout.set_font_description(fontDesc);

    return layout;
}

/** Compute the x-offset for text alignment relative to the given x coordinate. */
function getTextAlignOffset(ctx: CanvasRenderingContext2D, layout: Pango.Layout): number {
    const [, logicalRect] = layout.get_pixel_extents();
    const width = logicalRect.width;

    switch (ctx._state.textAlign) {
        case 'center':
            return -width / 2;
        case 'right':
        case 'end':
            return -width;
        case 'left':
        case 'start':
        default:
            return 0;
    }
}

/**
 * Compute the y-offset for text baseline positioning.
 *
 * PangoCairo.show_layout() places the layout TOP-LEFT at the current Cairo
 * point (not the baseline). Within the layout, the first line's baseline is
 * at approximately `ascent` pixels below the layout top.
 *
 * For CSS textBaseline semantics, we shift the current point UP (negative
 * offset) so the layout top lands at the right position relative to the
 * user's y coordinate.
 */
function getTextBaselineOffset(ctx: CanvasRenderingContext2D, layout: Pango.Layout): number {
    const fontDesc = layout.get_font_description() || parseFontToDescription(ctx._state.font);
    const context = layout.get_context();
    const metrics = context.get_metrics(fontDesc, null);
    const ascent = metrics.get_ascent() / Pango.SCALE;
    const descent = metrics.get_descent() / Pango.SCALE;
    const height = ascent + descent;

    // layout top = current point; baseline within layout ≈ ascent below top.
    // yOff is added to user's y to get the layout top-left y.
    switch (ctx._state.textBaseline) {
        case 'top':
            return 0; // top of em square = y
        case 'hanging':
            return -(ascent * 0.2); // hanging ≈ 0.2*ascent below top
        case 'middle':
            return -(height / 2); // center of em square = y
        case 'alphabetic':
            return -ascent; // baseline = y
        case 'ideographic':
            return -(ascent + descent * 0.5); // below alphabetic baseline
        case 'bottom':
            return -height; // bottom of em square = y
        default:
            return -ascent; // default = alphabetic
    }
}

const textMethods: TextMethods & ThisType<CanvasRenderingContext2D> = {
    fillText(this: CanvasRenderingContext2D, text: string, x: number, y: number, _maxWidth?: number): void {
        this._ensureSurface();
        if (this._state.transformIsSingular) return;
        this._applyCompositing();

        const layout = createTextLayout(this, text);
        const xOff = getTextAlignOffset(this, layout);
        const yOff = getTextBaselineOffset(this, layout);

        // Shadow pass: draw text at offset position with shadowColor.
        // shadowOffsetX/Y are in CSS pixels (not scaled by CTM per Canvas2D spec),
        // so we convert them to user-space before applying to moveTo.
        // shadowBlur is approximated with a 5-tap cross kernel: one center tap at full
        // alpha plus four arm taps at half alpha, spread by blur_u in each direction.
        // This simulates Gaussian spreading without an actual blur pass.
        if (this._hasShadow()) {
            const sc = parseColor(this._state.shadowColor);
            if (sc) {
                const [sdx, sdy] = this._deviceToUserDistance(this._state.shadowOffsetX, this._state.shadowOffsetY);
                const blur = this._state.shadowBlur;
                type Tap = [number, number, number];
                let taps: Tap[];
                if (blur > 0) {
                    const [bu] = this._deviceToUserDistance(blur, 0);
                    const [, bv] = this._deviceToUserDistance(0, blur);
                    taps = [
                        [sdx, sdy, sc.a],
                        [sdx + bu, sdy, sc.a * 0.5],
                        [sdx - bu, sdy, sc.a * 0.5],
                        [sdx, sdy + bv, sc.a * 0.5],
                        [sdx, sdy - bv, sc.a * 0.5],
                    ];
                } else {
                    taps = [[sdx, sdy, sc.a]];
                }
                const aa = this._state.imageSmoothingEnabled ? Cairo.Antialias.DEFAULT : Cairo.Antialias.NONE;
                for (const [tx, ty, ta] of taps) {
                    this._ctx.save();
                    this._ctx.setAntialias(aa);
                    this._ctx.setSourceRGBA(sc.r, sc.g, sc.b, ta);
                    this._ctx.moveTo(x + xOff + tx, y + yOff + ty);
                    PangoCairo.show_layout(this._ctx, layout);
                    this._ctx.restore();
                }
            }
        }

        this._applyFillStyle();
        this._ctx.save();
        // Disable anti-aliasing so pixel/bitmap fonts render crisp (matching browser
        // behaviour for fonts with no outline hints). cairo_save/restore covers antialias.
        this._ctx.setAntialias(this._state.imageSmoothingEnabled ? Cairo.Antialias.DEFAULT : Cairo.Antialias.NONE);
        this._ctx.moveTo(x + xOff, y + yOff);
        PangoCairo.show_layout(this._ctx, layout);
        this._ctx.restore();
    },

    strokeText(this: CanvasRenderingContext2D, text: string, x: number, y: number, _maxWidth?: number): void {
        this._ensureSurface();
        if (this._state.transformIsSingular) return;
        this._applyCompositing();
        this._applyStrokeStyle();
        this._applyLineStyle();

        const layout = createTextLayout(this, text);
        const xOff = getTextAlignOffset(this, layout);
        const yOff = getTextBaselineOffset(this, layout);

        this._ctx.save();
        this._ctx.setAntialias(this._state.imageSmoothingEnabled ? Cairo.Antialias.DEFAULT : Cairo.Antialias.NONE);
        this._ctx.moveTo(x + xOff, y + yOff);
        PangoCairo.layout_path(this._ctx, layout);
        this._ctx.stroke();
        this._ctx.restore();
    },

    measureText(this: CanvasRenderingContext2D, text: string): TextMetrics {
        this._ensureSurface();
        const layout = createTextLayout(this, text);
        const [inkRect, logicalRect] = layout.get_pixel_extents();

        // Baseline of first line in pixels from layout top (Pango.SCALE units → px).
        const baselinePx = layout.get_baseline() / Pango.SCALE;

        // actualBoundingBox: ink-based, relative to baseline (positive = above/right of baseline).
        // inkRect.y is pixels below layout top — compare against baseline to get baseline-relative values.
        const actualAscent = Math.max(0, baselinePx - inkRect.y);
        const actualDescent = Math.max(0, inkRect.y + inkRect.height - baselinePx);

        // fontBoundingBox: font-level metrics (same for all glyphs at this font/size).
        const fontDesc = layout.get_font_description() || parseFontToDescription(this._state.font);
        const metrics = layout.get_context().get_metrics(fontDesc, null);
        const fontAscent = metrics.get_ascent() / Pango.SCALE;
        const fontDescent = metrics.get_descent() / Pango.SCALE;

        return {
            width: logicalRect.width,
            actualBoundingBoxAscent: actualAscent,
            actualBoundingBoxDescent: actualDescent,
            actualBoundingBoxLeft: Math.max(0, -inkRect.x),
            actualBoundingBoxRight: inkRect.x + inkRect.width,
            fontBoundingBoxAscent: fontAscent,
            fontBoundingBoxDescent: fontDescent,
            alphabeticBaseline: 0,
            emHeightAscent: fontAscent,
            emHeightDescent: fontDescent,
            hangingBaseline: fontAscent * 0.8,
            ideographicBaseline: -fontDescent,
        };
    },
};

/** Install text-rendering methods on CanvasRenderingContext2D.prototype. */
export function installTextMethods(proto: object): void {
    Object.assign(proto, textMethods);
}
