// SVG path data → absolute draw commands. Pure, platform-agnostic.
//
// Android gets this for free: `androidx.core.graphics.PathParser` speaks the SVG
// `d` grammar natively, so `icons.android.ts` hands it the string. iOS has no
// equivalent — neither UIKit nor CoreGraphics parses path data — so the iOS
// rasteriser needs the geometry itself, and this module produces it.
//
// The output is deliberately reduced to the four primitives every 2D drawing API
// has (`moveTo`, `lineTo`, `curveTo`, `closePath`): H/V become lines, Q/T become
// cubics (exactly), S/T resolve their reflected control points, and elliptical
// arcs are converted to cubic segments. A renderer therefore needs no SVG
// knowledge at all — which is the point, because the next renderer that lacks a
// path parser should not have to write a second one.
//
// Being pure is what makes it testable: the rasterising half of an icon backend
// cannot run off-device, but this half — where the actual complexity is — runs
// on GJS and Node in CI.
//
// Reference: SVG 1.1 §8.3 (path data grammar) and §F.6.5 (endpoint → centre arc
// parameterisation, whose formulae the arc conversion follows step for step).
// Original implementation.

/** One absolute drawing command. Every SVG command reduces to these four. */
export type SvgPathCommand =
    | { type: 'M'; x: number; y: number }
    | { type: 'L'; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' };

const COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';

/** How many numbers each command letter consumes per repetition. */
const ARITY: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
};

/**
 * Split path data into `{ command, args }` groups.
 *
 * The grammar allows numbers to run together (`1.5.5` is two numbers, `1-2` is
 * two numbers), and allows a command's arguments to repeat without repeating the
 * letter. Arc FLAGS may be single digits glued to what follows, which is why the
 * arc branch reads them positionally rather than as numbers — the same reason
 * `normalizeArcFlags` exists for Android's parser.
 */
function tokenize(d: string): Array<{ command: string; args: number[] }> {
    const groups: Array<{ command: string; args: number[] }> = [];
    let i = 0;

    const isWs = (c: string) => c === ' ' || c === ',' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
    const skipWs = () => {
        while (i < d.length && isWs(d[i]!)) i++;
    };
    const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

    const readNumber = (): number | null => {
        skipWs();
        const start = i;
        if (d[i] === '+' || d[i] === '-') i++;
        while (isDigit(d[i])) i++;
        if (d[i] === '.') {
            i++;
            while (isDigit(d[i])) i++;
        }
        if (d[i] === 'e' || d[i] === 'E') {
            const mark = i;
            i++;
            if (d[i] === '+' || d[i] === '-') i++;
            if (isDigit(d[i])) {
                while (isDigit(d[i])) i++;
            } else {
                i = mark; // a bare `e` was not an exponent after all
            }
        }
        if (i === start) return null;
        const value = Number.parseFloat(d.slice(start, i));
        return Number.isFinite(value) ? value : null;
    };

    // A flag is exactly one `0` or `1` digit and may be glued to the next token.
    const readFlag = (): number | null => {
        skipWs();
        const c = d[i];
        if (c !== '0' && c !== '1') return null;
        i++;
        return c === '1' ? 1 : 0;
    };

    while (i < d.length) {
        skipWs();
        if (i >= d.length) break;
        const command = d[i]!;
        if (!COMMANDS.includes(command)) {
            i++; // skip anything the grammar does not allow here
            continue;
        }
        i++;
        if (command === 'Z' || command === 'z') {
            groups.push({ command, args: [] });
            continue;
        }

        const arity = ARITY[command.toUpperCase()]!;
        const isArc = command === 'A' || command === 'a';
        for (;;) {
            const args: number[] = [];
            let complete = true;
            for (let slot = 0; slot < arity; slot++) {
                // Arc slots 3 and 4 are the large-arc / sweep flags.
                const value = isArc && (slot === 3 || slot === 4) ? readFlag() : readNumber();
                if (value === null) {
                    complete = false;
                    break;
                }
                args.push(value);
            }
            if (!complete) break;
            groups.push({ command, args });
            // A repeated implicit group only continues while numbers follow.
            skipWs();
            const next = d[i];
            if (next === undefined || COMMANDS.includes(next)) break;
        }
    }
    return groups;
}

/** The cubic control points of one unit-circle arc segment, `delta` <= 90°. */
function unitArcSegment(theta: number, delta: number): [number, number, number, number, number, number] {
    const alpha = (4 / 3) * Math.tan(delta / 4);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosE = Math.cos(theta + delta);
    const sinE = Math.sin(theta + delta);
    return [cosT - alpha * sinT, sinT + alpha * cosT, cosE + alpha * sinE, sinE - alpha * cosE, cosE, sinE];
}

/**
 * Convert one elliptical arc to cubic segments (SVG §F.6.5, then §F.6.6's
 * out-of-range correction).
 *
 * Degenerate radii, and endpoints that coincide, are not errors in SVG: the
 * first draws a straight line, the second draws nothing at all.
 */
function arcToCubics(
    x1: number,
    y1: number,
    rxIn: number,
    ryIn: number,
    rotationDeg: number,
    largeArc: number,
    sweep: number,
    x2: number,
    y2: number,
): SvgPathCommand[] {
    if (x1 === x2 && y1 === y2) return [];
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0) return [{ type: 'L', x: x2, y: y2 }];

    const phi = (rotationDeg * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    // §F.6.6.2 — scale the radii up when they cannot span the endpoints.
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        const scale = Math.sqrt(lambda);
        rx *= scale;
        ry *= scale;
    }

    const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
    const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coefficient = (largeArc === sweep ? -1 : 1) * Math.sqrt(denominator === 0 ? 0 : numerator / denominator);
    const cxp = (coefficient * (rx * y1p)) / ry;
    const cyp = (coefficient * -(ry * x1p)) / rx;

    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    const startX = (x1p - cxp) / rx;
    const startY = (y1p - cyp) / ry;
    const endX = (-x1p - cxp) / rx;
    const endY = (-y1p - cyp) / ry;

    const theta1 = Math.atan2(startY, startX);
    let deltaTheta = Math.atan2(endY, endX) - theta1;
    if (sweep === 0 && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
    if (sweep === 1 && deltaTheta < 0) deltaTheta += 2 * Math.PI;

    // A cubic approximates at most a quarter turn within tolerable error.
    const segments = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
    const step = deltaTheta / segments;

    const map = (ux: number, uy: number): [number, number] => [
        cx + rx * ux * cosPhi - ry * uy * sinPhi,
        cy + rx * ux * sinPhi + ry * uy * cosPhi,
    ];

    const out: SvgPathCommand[] = [];
    for (let segment = 0; segment < segments; segment++) {
        const [u1x, u1y, u2x, u2y, uex, uey] = unitArcSegment(theta1 + segment * step, step);
        const [c1x, c1y] = map(u1x, u1y);
        const [c2x, c2y] = map(u2x, u2y);
        const [ex, ey] = map(uex, uey);
        out.push({ type: 'C', x1: c1x, y1: c1y, x2: c2x, y2: c2y, x: ex, y: ey });
    }
    // The final point must be the requested endpoint exactly, not the result of
    // accumulated trigonometry — a renderer closing the subpath would otherwise
    // leave a hairline gap.
    const last = out[out.length - 1];
    if (last && last.type === 'C') {
        last.x = x2;
        last.y = y2;
    }
    return out;
}

/**
 * Parse SVG path data into absolute `M`/`L`/`C`/`Z` commands.
 *
 * Unparsable input yields the commands read so far rather than throwing: a
 * single malformed icon must not take down the view that renders it, which is
 * the same call the Android backend makes when `PathParser` rejects a subpath.
 */
export function parseSvgPath(d: string): SvgPathCommand[] {
    const out: SvgPathCommand[] = [];
    // Current point, subpath start, and the reflections S/T need.
    let cx = 0;
    let cy = 0;
    let startX = 0;
    let startY = 0;
    let lastCubicC2x = 0;
    let lastCubicC2y = 0;
    let lastQuadCx = 0;
    let lastQuadCy = 0;
    let previous = '';

    const quadraticToCubic = (qx: number, qy: number, x: number, y: number) => {
        // Exact conversion: a quadratic IS a cubic with both controls at 2/3.
        out.push({
            type: 'C',
            x1: cx + (2 / 3) * (qx - cx),
            y1: cy + (2 / 3) * (qy - cy),
            x2: x + (2 / 3) * (qx - x),
            y2: y + (2 / 3) * (qy - y),
            x,
            y,
        });
        lastQuadCx = qx;
        lastQuadCy = qy;
        lastCubicC2x = x + (2 / 3) * (qx - x);
        lastCubicC2y = y + (2 / 3) * (qy - y);
        cx = x;
        cy = y;
    };

    for (const { command, args } of tokenize(d)) {
        const relative = command >= 'a' && command <= 'z';
        const upper = command.toUpperCase();
        const ox = relative ? cx : 0;
        const oy = relative ? cy : 0;

        switch (upper) {
            case 'M': {
                const x = args[0]! + ox;
                const y = args[1]! + oy;
                out.push({ type: 'M', x, y });
                cx = x;
                cy = y;
                startX = x;
                startY = y;
                break;
            }
            case 'L': {
                const x = args[0]! + ox;
                const y = args[1]! + oy;
                out.push({ type: 'L', x, y });
                cx = x;
                cy = y;
                break;
            }
            case 'H': {
                const x = args[0]! + ox;
                out.push({ type: 'L', x, y: cy });
                cx = x;
                break;
            }
            case 'V': {
                const y = args[0]! + oy;
                out.push({ type: 'L', x: cx, y });
                cy = y;
                break;
            }
            case 'C': {
                const x1 = args[0]! + ox;
                const y1 = args[1]! + oy;
                const x2 = args[2]! + ox;
                const y2 = args[3]! + oy;
                const x = args[4]! + ox;
                const y = args[5]! + oy;
                out.push({ type: 'C', x1, y1, x2, y2, x, y });
                lastCubicC2x = x2;
                lastCubicC2y = y2;
                cx = x;
                cy = y;
                break;
            }
            case 'S': {
                // The first control is the reflection of the previous cubic's
                // second control — or the current point when there was none.
                const smooth = previous === 'C' || previous === 'S';
                const x1 = smooth ? 2 * cx - lastCubicC2x : cx;
                const y1 = smooth ? 2 * cy - lastCubicC2y : cy;
                const x2 = args[0]! + ox;
                const y2 = args[1]! + oy;
                const x = args[2]! + ox;
                const y = args[3]! + oy;
                out.push({ type: 'C', x1, y1, x2, y2, x, y });
                lastCubicC2x = x2;
                lastCubicC2y = y2;
                cx = x;
                cy = y;
                break;
            }
            case 'Q': {
                quadraticToCubic(args[0]! + ox, args[1]! + oy, args[2]! + ox, args[3]! + oy);
                break;
            }
            case 'T': {
                const smooth = previous === 'Q' || previous === 'T';
                const qx = smooth ? 2 * cx - lastQuadCx : cx;
                const qy = smooth ? 2 * cy - lastQuadCy : cy;
                quadraticToCubic(qx, qy, args[0]! + ox, args[1]! + oy);
                break;
            }
            case 'A': {
                const x = args[5]! + ox;
                const y = args[6]! + oy;
                out.push(...arcToCubics(cx, cy, args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, x, y));
                cx = x;
                cy = y;
                break;
            }
            case 'Z': {
                out.push({ type: 'Z' });
                cx = startX;
                cy = startY;
                break;
            }
        }
        previous = upper;
    }
    return out;
}
