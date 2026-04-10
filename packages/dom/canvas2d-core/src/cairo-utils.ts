// Cairo utility helpers for Canvas 2D context
// Handles format conversions and path operations not directly available in Cairo.

import type Cairo from 'cairo';

/**
 * Convert quadratic Bezier control point to cubic Bezier control points.
 * Canvas 2D has quadraticCurveTo but Cairo only has cubic curveTo.
 *
 * Given current point (cx, cy), quadratic control point (cpx, cpy), and end (x, y):
 *   cp1 = current + 2/3 * (cp - current)
 *   cp2 = end + 2/3 * (cp - end)
 */
export function quadraticToCubic(
    cx: number, cy: number,
    cpx: number, cpy: number,
    x: number, y: number,
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } {
    return {
        cp1x: cx + (2 / 3) * (cpx - cx),
        cp1y: cy + (2 / 3) * (cpy - cy),
        cp2x: x + (2 / 3) * (cpx - x),
        cp2y: y + (2 / 3) * (cpy - y),
    };
}

/**
 * Compute arcTo parameters.
 * Canvas arcTo(x1,y1,x2,y2,radius) draws a line from current point to the tangent point,
 * then an arc of the given radius tangent to both lines (current→p1 and p1→p2).
 *
 * Returns the two tangent points and arc center, or null if degenerate (collinear points).
 */
export function computeArcTo(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    radius: number,
): { tx0: number; ty0: number; tx1: number; ty1: number; cx: number; cy: number; startAngle: number; endAngle: number; counterclockwise: boolean } | null {
    // Direction vectors
    const dx0 = x0 - x1;
    const dy0 = y0 - y1;
    const dx1 = x2 - x1;
    const dy1 = y2 - y1;

    // Lengths
    const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

    if (len0 === 0 || len1 === 0) return null;

    // Normalize
    const ux0 = dx0 / len0;
    const uy0 = dy0 / len0;
    const ux1 = dx1 / len1;
    const uy1 = dy1 / len1;

    // Cross product to determine direction
    const cross = ux0 * uy1 - uy0 * ux1;
    if (Math.abs(cross) < 1e-10) return null; // Collinear

    // Half-angle between the two direction vectors
    const dot = ux0 * ux1 + uy0 * uy1;
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, dot))) / 2;

    // Distance from p1 to tangent point
    const tanDist = radius / Math.tan(halfAngle);

    // Tangent points
    const tx0 = x1 + ux0 * tanDist;
    const ty0 = y1 + uy0 * tanDist;
    const tx1 = x1 + ux1 * tanDist;
    const ty1 = y1 + uy1 * tanDist;

    // Center of the arc circle: perpendicular to the bisector, distance = radius / sin(halfAngle)
    const centerDist = radius / Math.sin(halfAngle);
    const bisectX = (ux0 + ux1) / 2;
    const bisectY = (uy0 + uy1) / 2;
    const bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY);
    const cx = x1 + (bisectX / bisectLen) * centerDist;
    const cy = y1 + (bisectY / bisectLen) * centerDist;

    // Start and end angles
    const startAngle = Math.atan2(ty0 - cy, tx0 - cx);
    const endAngle = Math.atan2(ty1 - cy, tx1 - cx);

    // Counterclockwise if cross product is positive
    const counterclockwise = cross > 0;

    return { tx0, ty0, tx1, ty1, cx, cy, startAngle, endAngle, counterclockwise };
}

/**
 * Apply an arcTo operation to a Cairo context.
 */
export function cairoArcTo(
    ctx: Cairo.Context,
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    radius: number,
): void {
    const result = computeArcTo(x0, y0, x1, y1, x2, y2, radius);
    if (!result) {
        // Degenerate: just draw a line to (x1, y1)
        ctx.lineTo(x1, y1);
        return;
    }

    const { tx0, ty0, cx, cy, startAngle, endAngle, counterclockwise } = result;

    // Line from current point to first tangent point
    ctx.lineTo(tx0, ty0);

    // Arc
    if (counterclockwise) {
        ctx.arcNegative(cx, cy, radius, startAngle, endAngle);
    } else {
        ctx.arc(cx, cy, radius, startAngle, endAngle);
    }
}

/**
 * Draw an ellipse on a Cairo context.
 * Canvas ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise)
 * is implemented via save/translate/rotate/scale/arc/restore.
 */
export function cairoEllipse(
    ctx: Cairo.Context,
    x: number, y: number,
    radiusX: number, radiusY: number,
    rotation: number,
    startAngle: number, endAngle: number,
    counterclockwise: boolean,
): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(radiusX, radiusY);

    if (counterclockwise) {
        ctx.arcNegative(0, 0, 1, startAngle, endAngle);
    } else {
        ctx.arc(0, 0, 1, startAngle, endAngle);
    }

    ctx.restore();
}

/**
 * Draw a rounded rectangle path on a Cairo context.
 * Implements the Canvas roundRect(x, y, w, h, radii) method.
 */
export function cairoRoundRect(
    ctx: Cairo.Context,
    x: number, y: number,
    w: number, h: number,
    radii: number | number[],
): void {
    // Normalize radii to [topLeft, topRight, bottomRight, bottomLeft]
    let tl: number, tr: number, br: number, bl: number;
    if (typeof radii === 'number') {
        tl = tr = br = bl = radii;
    } else if (radii.length === 1) {
        tl = tr = br = bl = radii[0];
    } else if (radii.length === 2) {
        tl = br = radii[0];
        tr = bl = radii[1];
    } else if (radii.length === 3) {
        tl = radii[0];
        tr = bl = radii[1];
        br = radii[2];
    } else {
        tl = radii[0];
        tr = radii[1];
        br = radii[2];
        bl = radii[3];
    }

    // Clamp radii so they don't exceed half the width/height
    const maxR = Math.min(w / 2, h / 2);
    tl = Math.min(tl, maxR);
    tr = Math.min(tr, maxR);
    br = Math.min(br, maxR);
    bl = Math.min(bl, maxR);

    const PI_2 = Math.PI / 2;

    ctx.newSubPath();
    // Top-left corner
    ctx.arc(x + tl, y + tl, tl, Math.PI, Math.PI + PI_2);
    // Top-right corner
    ctx.arc(x + w - tr, y + tr, tr, -PI_2, 0);
    // Bottom-right corner
    ctx.arc(x + w - br, y + h - br, br, 0, PI_2);
    // Bottom-left corner
    ctx.arc(x + bl, y + h - bl, bl, PI_2, Math.PI);
    ctx.closePath();
}

/**
 * Map Canvas globalCompositeOperation to Cairo.Operator values.
 *
 * Cairo.Operator enum (verified runtime in GJS 1.86):
 *   CLEAR=0, SOURCE=1, OVER=2, IN=3, OUT=4, ATOP=5,
 *   DEST=6, DEST_OVER=7, DEST_IN=8, DEST_OUT=9, DEST_ATOP=10,
 *   XOR=11, ADD=12, SATURATE=13,
 *   MULTIPLY=14, SCREEN=15, OVERLAY=16, DARKEN=17, LIGHTEN=18,
 *   COLOR_DODGE=19, COLOR_BURN=20, HARD_LIGHT=21, SOFT_LIGHT=22,
 *   DIFFERENCE=23, EXCLUSION=24, HSL_HUE=25, HSL_SATURATION=26,
 *   HSL_COLOR=27, HSL_LUMINOSITY=28
 */
export const COMPOSITE_OP_MAP: Record<string, number> = {
    'source-over': 2,      // OVER
    'source-in': 3,        // IN
    'source-out': 4,       // OUT
    'source-atop': 5,      // ATOP
    'destination-over': 7, // DEST_OVER
    'destination-in': 8,   // DEST_IN
    'destination-out': 9,  // DEST_OUT
    'destination-atop': 10,// DEST_ATOP
    'lighter': 12,         // ADD
    'copy': 1,             // SOURCE
    'xor': 11,             // XOR
    'multiply': 14,        // MULTIPLY
    'screen': 15,          // SCREEN
    'overlay': 16,         // OVERLAY
    'darken': 17,          // DARKEN
    'lighten': 18,         // LIGHTEN
    'color-dodge': 19,     // COLOR_DODGE
    'color-burn': 20,      // COLOR_BURN
    'hard-light': 21,      // HARD_LIGHT
    'soft-light': 22,      // SOFT_LIGHT
    'difference': 23,      // DIFFERENCE
    'exclusion': 24,       // EXCLUSION
    'hue': 25,             // HSL_HUE
    'saturation': 26,      // HSL_SATURATION
    'color': 27,           // HSL_COLOR
    'luminosity': 28,      // HSL_LUMINOSITY
};

/** Map Canvas lineCap to Cairo.LineCap values */
export const LINE_CAP_MAP: Record<string, number> = {
    'butt': 0,
    'round': 1,
    'square': 2,
};

/** Map Canvas lineJoin to Cairo.LineJoin values */
export const LINE_JOIN_MAP: Record<string, number> = {
    'miter': 0,
    'round': 1,
    'bevel': 2,
};
